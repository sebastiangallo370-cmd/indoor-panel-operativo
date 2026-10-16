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
from datetime import date, timedelta

from app import promedios, sublimacion_stock
from app.sublimacion_stock import DB_FILE, norm, parse_date

DIAS_GRACIA = 7


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
        limite = (date.today() - timedelta(days=DIAS_GRACIA)).isoformat()
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
    for p in sorted(pedidos, key=lambda x: (x['entrega'] or '9999', x['orden'])):
        consumo, usados, faltan = _consumo(p['referencia'], maestros, plantillas)
        base = {'orden': p['orden'], 'cliente': p['cliente'], 'proyecto': p['proyecto'], 'referencia': p['referencia'], 'tela': p['tela'],
                'cantidad': p['cantidad'], 'estado': p['estado'], 'entrega': p['entrega']}
        if not consumo:
            sin_promedio.append({**base, 'situacion': 'sin_promedio', 'promedio': 0, 'mts': 0, 'falta': 0, 'maestros': [], 'telas': [],
                                 'motivo': ('Sin promedio para ' + ', '.join(faltan)) if faltan else 'La referencia no dice qué maestro es'})
            continue
        mts = round(consumo * p['cantidad'], 2)
        entrada = por_tela.setdefault(p['tela'], {'tela': p['tela'], 'mts': 0.0, 'prendas': 0, 'pedidos': []})
        entrada['mts'] += mts
        entrada['prendas'] += p['cantidad']
        entrada['pedidos'].append({**base, 'promedio': consumo, 'mts': mts, 'maestros': usados, 'parcial': bool(faltan)})
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
        resultado.append({**entrada, 'mts': mts, 'disponible': disponible, 'encontrada': bool(encontradas),
                          'telas': [i['nombre'] for i in encontradas], 'faltan': round(max(0.0, mts - disponible), 2) if encontradas else mts,
                          'alcanza': bool(encontradas) and disponible >= mts})
    resultado.sort(key=lambda r: (r['alcanza'], -r['mts']))
    por_orden.sort(key=lambda o: (o['entrega'] or '9999', o['orden']))
    return {'disponible': True, 'telas': resultado, 'ordenes': por_orden + sin_promedio, 'sin_promedio': sin_promedio,
            'mts': round(sum(r['mts'] for r in resultado), 2), 'pedidos': sum(len(r['pedidos']) for r in resultado),
            'faltan': round(sum(r['faltan'] for r in resultado), 2), 'telas_no_alcanzan': sum(1 for r in resultado if not r['alcanza'])}
