"""Tela necesaria por los pedidos programados.

Apenas un pedido entra a Producción se mira su REFERENCIA (A700CA00 -> maestro CA00), se toma el consumo PROMEDIO GENERAL de ese maestro
(Promedios maestros: media de todos los consumos por talla distintos de cero) y se multiplica por la CANTIDAD de la orden. Lo de todas las órdenes
se acumula por tela y se compara con lo que hay en Bodega. Solo lectura: no toca el inventario ni el Sheet.

Cuentan las filas con Sublimación vacía (aún sin tela asignada) o en proceso (P). Una fila vacía solo cuenta si su entrega no está vencida por más de 7 días
(así no pesan las filas viejas que nunca se llenaron). Las que ya pasaron por Sublimación ya descontaron su tela del inventario.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone

import os
import threading
import time
from pathlib import Path

from app import listado_tallas, promedios, sublimacion_stock
from app.sublimacion_stock import DB_FILE, norm, parse_date

DIAS_GRACIA = 7
BRECHA_POR_DEFECTO = 14   # días entre Sublimación y entrega si aún no hay historial suficiente
INTERVALO_TALLAS = 600
_STATE = Path(os.getenv('STATE_DIR', '/data/state'))
_tallas_lock = threading.Lock()
_tallas: dict[str, dict] = {}   # orden -> {'ruta', 'mtime', 'hojas': {hoja: [líneas]}, 'ts'}


def _cargar_tallas() -> None:
    try:
        with _tallas_lock:
            _tallas.update(json.loads((_STATE / 'tela_tallas.json').read_text(encoding='utf-8')))
    except (OSError, ValueError):
        pass


def _guardar_tallas() -> None:
    try:
        tmp = _STATE / 'tela_tallas.tmp'
        tmp.write_text(json.dumps(_tallas, ensure_ascii=False), encoding='utf-8')
        tmp.replace(_STATE / 'tela_tallas.json')
    except OSError:
        pass


def refrescar_tallas() -> int:
    """Lee (solo si cambió) el listado Excel de cada orden programada para tener sus tallas. Va en segundo plano: la NAS por VPN es lenta."""
    cambios = 0
    pedidos = _pedidos() or []
    por_orden = {}
    for p in pedidos:
        por_orden.setdefault(p['orden'], p['cliente'])
    for orden, cliente in por_orden.items():
        try:
            previo = _tallas.get(orden)
            carpeta = Path(previo['ruta']).parent if previo and Path(previo['ruta']).exists() else listado_tallas.carpeta_de_orden(cliente, orden)
            ruta = listado_tallas.excel_de_orden(carpeta, orden) if carpeta else None
            if not ruta:
                continue
            mtime = ruta.stat().st_mtime
            if previo and previo.get('ruta') == str(ruta) and previo.get('mtime') == mtime:
                continue
            hojas = listado_tallas.leer_hojas(ruta)
            with _tallas_lock:
                _tallas[orden] = {'ruta': str(ruta), 'mtime': mtime, 'hojas': hojas, 'ts': time.time()}
            cambios += 1
        except Exception:   # noqa: BLE001 - una orden con Excel raro no debe frenar a las demás
            continue
    if cambios:
        _guardar_tallas()
    return cambios


def _bucle_tallas() -> None:
    time.sleep(45)
    while True:
        try:
            refrescar_tallas()
        except Exception:   # noqa: BLE001
            pass
        time.sleep(INTERVALO_TALLAS)


def start() -> None:
    _cargar_tallas()
    threading.Thread(target=_bucle_tallas, name='tela-tallas', daemon=True).start()


def _exacto(orden: str, referencia: str, datos: dict) -> dict | None:
    """Consumo talla por talla (promedio del maestro de cada talla × prendas de esa talla) si el listado de la orden tiene la hoja de esa referencia."""
    entrada = _tallas.get(orden)
    if not entrada:
        return None
    clave = listado_tallas._codigo(referencia)
    titulo = next((t for t in entrada['hojas'] if listado_tallas._codigo(t) == clave), None)
    if not titulo:
        return None
    r = promedios.calcular_hoja(titulo, entrada['hojas'][titulo], datos)
    if not r.get('completo') or r['mts'] <= 0:
        return None
    return {'mts': r['mts'], 'prendas': r['prendas'], 'detalle': r['detalle'], 'partes': r['partes']}


_brecha_cache: dict = {'at': 0.0, 'dias': BRECHA_POR_DEFECTO}


def brecha_sublimacion() -> int:
    """Días que suelen pasar entre que una orden entra a Sublimación y su fecha de entrega: la mediana de las órdenes ya sublimadas (se recalcula cada hora).
    Con eso se estima cuándo le toca a una orden pendiente: fecha de entrega menos esa brecha."""
    if time.time() - _brecha_cache['at'] < 3600:
        return _brecha_cache['dias']
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
        try:
            raw = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
            headers = [norm(h) for h in json.loads(raw[0])]
            si, ei = headers.index('SUBLIMACION'), headers.index('FECHA DE ENTREGA')
            brechas = []
            for (valores_json,) in db.execute('SELECT values_json FROM production_rows'):
                v = json.loads(valores_json)
                if len(v) <= max(si, ei):
                    continue
                sub, ent = parse_date(v[si]), parse_date(v[ei])
                if sub and ent:
                    dias = (date.fromisoformat(ent) - date.fromisoformat(sub)).days
                    if 0 <= dias <= 45:   # fuera de ese rango son fechas mal digitadas o casos raros
                        brechas.append(dias)
        finally:
            db.close()
        if len(brechas) >= 10:
            brechas.sort()
            _brecha_cache.update(at=time.time(), dias=round(brechas[len(brechas) // 2]))
            return _brecha_cache['dias']
    except Exception:   # noqa: BLE001
        pass
    _brecha_cache['at'] = time.time() - 3000   # reintenta en ~10 min
    return _brecha_cache['dias']


def _hoy() -> date:
    """Hoy en Colombia (el servidor está en UTC y de noche ya marcaría el día siguiente)."""
    return datetime.now(timezone(timedelta(hours=-5))).date()


def _cantidad(valor) -> int:
    digitos = re.sub(r'[^0-9]', '', str(valor or ''))
    return int(digitos) if digitos else 0


def _consumo(referencia: str, maestros: dict, plantillas: dict) -> tuple[float, list[str], list[str]]:
    """Consumo promedio general por prenda de una referencia (suma las partes si es compuesta) y lo que no se encontró."""
    total, usados, faltan = 0.0, [], []
    for parte in promedios.partes_de_hoja(referencia):
        if not parte:
            continue
        maestro = maestros.get(parte) or plantillas.get(parte)
        if not maestro:
            faltan.append(parte)
            continue
        promedio = promedios.promedio(maestro)
        if not promedio:
            faltan.append(maestro['ref'])
            continue
        total += promedio
        usados.append(maestro['ref'])
    return round(total, 2), usados, faltan


def _codigo_tela(referencia: str) -> str:
    """«A700CA00» -> '700' (código de tela que va delante de la referencia); «A4403-4400-…» -> '4403'."""
    m = re.match(r'\s*A(\d+)', str(referencia or '').upper())
    return m.group(1) if m else ''


def _telas_de_bodega(items: list[dict], tela: str, codigos: set[str]) -> list[dict]:
    """Telas de Bodega que corresponden a la de Producción: por nombre y, si el nombre no coincide («TOUR BUNGAI» vs «(700) TOUR»), por el código de la referencia."""
    encontradas = _telas_de_bodega(items, tela, entrada['codigos'])
    if encontradas:
        return encontradas
    por_codigo = []
    for i in items:
        if i.get('categoria') != 'BODEGA TELA':
            continue
        nombre = ' ' + sublimacion_stock.norm(i.get('nombre')) + ' '
        m = re.match(r'\s*\((\d+)\)', nombre)
        if m and m.group(1) in codigos and not any(x in nombre for x in sublimacion_stock.EXCLUDED_NAMES) and ' RIB ' not in nombre:
            por_codigo.append(i)
    blancas = [i for i in por_codigo if ' BLANCO ' in ' ' + sublimacion_stock.norm(i.get('nombre')) + ' ']
    return blancas or por_codigo


def _pedidos() -> list[dict] | None:
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        raw = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not raw:
            return None
        headers = [norm(h) for h in json.loads(raw[0])]
        need = ('SUBLIMACION', 'TELA', 'ORDEN', 'REFERENCIA', 'CANTIDAD')
        if any(h not in headers for h in need):
            return None
        si, ti, oi, ri, ci = (headers.index(h) for h in need)
        ei = headers.index('FECHA DE ENTREGA') if 'FECHA DE ENTREGA' in headers else None
        ki = headers.index('NOMBRE DEL CLIENTE') if 'NOMBRE DEL CLIENTE' in headers else None
        pi = headers.index('NOMBRE PROYECTO') if 'NOMBRE PROYECTO' in headers else None
        texto = lambda v, i: str(v[i]).strip() if i is not None and i < len(v) else ''
        limite = (_hoy() - timedelta(days=DIAS_GRACIA)).isoformat()
        pedidos = []
        for fila, valores_json in db.execute('SELECT source_row, values_json FROM production_rows'):
            v = json.loads(valores_json)
            if len(v) <= max(si, ti, oi, ri, ci):
                continue
            estado = norm(v[si])
            if estado == 'P':
                activo = True
            elif estado in ('', 'R'):
                entrega = parse_date(v[ei]) if ei is not None and ei < len(v) else ''
                activo = bool(entrega) and entrega >= limite
            else:
                activo = False   # fecha (ya consumida) o N/A
            tela = norm(v[ti])
            cantidad = _cantidad(v[ci])
            if not activo or not tela or not cantidad:
                continue
            pedidos.append({'fila': fila, 'orden': str(v[oi]).strip(), 'referencia': str(v[ri]).strip(), 'tela': tela, 'cantidad': cantidad,
                            'cliente': texto(v, ki), 'proyecto': texto(v, pi),
                            'estado': 'P' if estado == 'P' else '',
                            'entrega': parse_date(v[ei]) if ei is not None and ei < len(v) else ''})
        return pedidos
    except (sqlite3.Error, ValueError, KeyError):
        return None
    finally:
        db.close()


def calcular(items: list[dict]) -> dict:
    """Necesidad de tela por pedidos programados, agrupada por tela y comparada con el stock de Bodega."""
    pedidos = _pedidos()
    if pedidos is None:
        return {'disponible': False, 'telas': [], 'ordenes': [], 'sin_promedio': [], 'mts': 0.0, 'pedidos': 0, 'faltan': 0.0, 'telas_no_alcanzan': 0}
    with promedios._lock:
        datos = promedios._leer()
    maestros = {m['ref']: m for m in datos['maestros']}
    plantillas = {}
    for m in datos['maestros']:
        for campo in ('p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short'):
            codigo = str(m.get(campo) or '').strip().upper()
            if codigo:
                plantillas.setdefault(codigo, m)
    por_tela: dict[str, dict] = {}
    sin_promedio = []
    brecha = brecha_sublimacion()
    for p in sorted(pedidos, key=lambda x: (x['entrega'] or '9999', x['orden'])):
        consumo, usados, faltan = _consumo(p['referencia'], maestros, plantillas)
        exacto = _exacto(p['orden'], p['referencia'], datos)
        base = {'orden': p['orden'], 'cliente': p['cliente'], 'proyecto': p['proyecto'], 'referencia': p['referencia'], 'tela': p['tela'],
                'cantidad': p['cantidad'], 'estado': p['estado'], 'entrega': p['entrega']}
        if p['estado'] != 'P' and p['entrega']:
            est = date.fromisoformat(p['entrega']) - timedelta(days=brecha)
            base.update(sublim_est=est.isoformat(), dias_sublim=(est - _hoy()).days)
        base['en_sublim'] = p['estado'] == 'P'
        if not consumo and not exacto:
            sin_promedio.append({**base, 'situacion': 'sin_promedio', 'promedio': 0, 'mts': 0, 'falta': 0, 'maestros': [], 'telas': [],
                                 'motivo': ('Sin promedio para ' + ', '.join(faltan)) if faltan else 'La referencia no dice qué maestro es'})
            continue
        if exacto:
            mts, consumo, usados = exacto['mts'], round(exacto['mts'] / max(1, exacto['prendas']), 2), exacto['partes']
        else:
            mts = round(consumo * p['cantidad'], 2)
        entrada = por_tela.setdefault(p['tela'], {'tela': p['tela'], 'mts': 0.0, 'prendas': 0, 'pedidos': [], 'codigos': set()})
        entrada['codigos'].add(_codigo_tela(p['referencia']))
        entrada['mts'] += mts
        entrada['prendas'] += p['cantidad']
        entrada['pedidos'].append({**base, 'promedio': consumo, 'mts': mts, 'maestros': usados, 'parcial': bool(faltan) and not exacto,
                                   'exacto': bool(exacto), 'prendas_talla': (exacto or {}).get('prendas', 0),
                                   'tallas': [{'grupo': d['grupo'], 'talla': d['talla'], 'cantidad': d['cantidad'], 'promedio': d['promedio'], 'mts': d['subtotal']}
                                              for d in (exacto or {}).get('detalle', [])]})
    resultado, por_orden = [], []
    for tela, entrada in por_tela.items():
        encontradas = sublimacion_stock._matched(items, tela)
        disponible = round(sum(sum(float(x) for x in (i.get('roll_values') or [])) for i in encontradas), 2)
        mts = round(entrada['mts'], 2)
        restante = disponible
        for ped in entrada['pedidos']:   # las órdenes se sirven por fecha de entrega: cada una descuenta su tela de lo que queda en Bodega
            if not encontradas:
                ped.update(situacion='sin_tela', falta=ped['mts'], disponible=0.0)
            elif restante >= ped['mts']:
                ped.update(situacion='alcanza', falta=0.0, disponible=round(restante, 2))
                restante -= ped['mts']
            else:
                ped.update(situacion='no_alcanza', falta=round(ped['mts'] - max(restante, 0.0), 2), disponible=round(max(restante, 0.0), 2))
                restante = max(0.0, restante - ped['mts'])
            ped['telas'] = [i['nombre'] for i in encontradas]
            por_orden.append(ped)
        entrada.pop('codigos', None)
        resultado.append({**entrada, 'mts': mts, 'disponible': disponible, 'encontrada': bool(encontradas),
                          'telas': [i['nombre'] for i in encontradas], 'faltan': round(max(0.0, mts - disponible), 2) if encontradas else mts,
                          'alcanza': bool(encontradas) and disponible >= mts})
    resultado.sort(key=lambda r: (r['alcanza'], -r['mts']))
    por_orden.sort(key=lambda o: (o['entrega'] or '9999', o['orden']))
    return {'disponible': True, 'brecha_sublimacion': brecha, 'telas': resultado, 'ordenes': por_orden + sin_promedio, 'sin_promedio': sin_promedio,
            'mts': round(sum(r['mts'] for r in resultado), 2), 'pedidos': sum(len(r['pedidos']) for r in resultado),
            'faltan': round(sum(r['faltan'] for r in resultado), 2), 'telas_no_alcanzan': sum(1 for r in resultado if not r['alcanza'])}
