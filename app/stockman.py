"""STOCKMAN: alinea el inventario del panel con el de Effi (agente de INVENTARIOS, vive en el VPS). El inventario REAL es el del panel.
Panel -> Effi: si el panel cambia en una bodega, STOCKMAN hace en Effi UN ajuste de inventario SOLO de esa bodega y por lo que cambió (no iguala las demás), tras comprobar que el cambio se mantiene unos minutos.
Las diferencias que ya existían al arrancar no se tocan solas: se igualan con el botón de la tarjeta.
Effi -> panel: Effi no avisa, así que STOCKMAN revisa cada pocos minutos los ajustes de inventario nuevos de Effi y los registra en el panel (ingreso o salida) para que el
panel quede igual; los ajustes que hizo el propio STOCKMAN se reconocen y no rebotan. Solo con STOCKMAN ACTIVO; apagado muestra lo que haría.

Primera parte (nombres): cada tela del panel se muestra con el MISMO nombre que tiene su artículo en Effi. El nombre interno del inventario (el del Google Sheet, que usan
los agentes y los movimientos) no se toca: se guarda un alias código -> nombre de Effi en /data/state/stockman.json y el navegador lo aplica al mostrar (nombres-effi.js).
El artículo de Effi se busca por el «ID Effi» de INFORMACIÓN TELA y, si no hay, por la referencia exacta (el código de la tela). Solo lectura en Effi."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app import effi_api, proveedores_tela

_auth = lambda request: ''


def configurar(auth) -> None:
    global _auth
    _auth = auth


log = logging.getLogger('stockman')
router = APIRouter(prefix='/api/stockman', tags=['stockman'])
webhook_router = APIRouter(prefix='/api/stockman', tags=['stockman'])   # sin sesión: lo llama Effi; se protege con la clave que va en la dirección
_despertar = threading.Event()
_file = Path(os.getenv('STOCKMAN_FILE', '/data/state/stockman.json'))
_lock = threading.RLock()
INTERVALO = 1800         # lectura completa de Effi (nombres y stock de todas las telas)
CICLO = 120              # cada cuánto mira los ajustes nuevos de Effi y las diferencias
ESTABLE_SEG = 300        # una diferencia panel/Effi debe mantenerse 5 minutos antes de ajustarla (así no pisa un cambio a medias)
PROPIO = 'Alineado con el panel por STOCKMAN'
MAX_TELAS = 5            # tope de telas que ajusta solo por revisión
GRANDE_PCT = 0.5         # una diferencia total de más del 50 % (y de más de 1.000 mts) no se ajusta sola: pide que una persona pulse AJUSTAR
GRANDE_MTS = 1000.0
# bodegas del panel -> id de la bodega con el mismo nombre en Effi
BODEGAS = {'BODEGA GLORIA': '23', 'BODEGA SEGUNDO PISO': '22', 'BODEGA CASA': '24', 'BODEGA INDOOR': '21'}
_NOMBRE_BODEGA = {'23': 'GLORIA', '22': 'INDOOR_2P', '24': 'CASA', '21': 'INDOOR'}
_OTRAS = {'1': 'Principal', '5': 'Materia Prima', '6': 'Punto de venta PT', '8': 'calcetines', '9': 'tela', '10': 'Insumos', '11': 'tienda', '13': 'Linea Copa', '14': 'Plus', '17': 'Estandar', '20': 'Premium'}
NOMBRE = 'STOCKMAN'


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('activo', False)
    d.setdefault('ajustes', [])     # historial: ajustes hechos en Effi (tipo a_effi) y movimientos traídos al panel (tipo a_panel)
    d.setdefault('ajuste_base', None)   # id del último ajuste de Effi que ya existía al empezar: solo lo posterior se trae al panel
    d.setdefault('vistos', [])
    d.setdefault('pendientes', [])  # ajustes de Effi por traer al panel (STOCKMAN apagado)
    d.setdefault('estables', {})
    d.setdefault('panel_base', None)   # metros por bodega del panel la última vez que se procesó: solo lo que cambie respecto a esto se manda a Effi
    d.setdefault('ultimo_completo', 0)
    d.setdefault('webhook', {'clave': '', 'recibidos': 0, 'ultimo': ''})
    d.setdefault('nombres', {})      # código de la tela -> {'nombre_panel', 'nombre_effi', 'id_effi', 'at'}
    d.setdefault('ultima', '')
    d.setdefault('error', '')
    return d


def _guardar(d: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _usar_api() -> bool:
    from app import minimaximan   # misma llave y ajustes de la API que ya usa el agente de inventario
    return minimaximan._usar_api()


def refrescar_nombres() -> dict:
    """Lee en Effi el nombre de cada tela del panel y guarda el alias. Si Effi falla o no ve la tela, se queda con el último nombre conocido."""
    if not _usar_api():
        with _lock:
            d = _leer()
            d.update(ultima=_iso(), error='Falta conectar la API de Effi (pantalla «API Effi» del agente de inventario).')
            _guardar(d)
        return {'ok': False, 'cambiadas': 0}
    telas = proveedores_tela.telas()
    if not telas:
        return {'ok': False, 'cambiadas': 0}   # el inventario llegó vacío: no se toca nada
    previos = _leer()['nombres']
    nuevos, sin = {}, []
    for t in telas:
        codigo = str(t['codigo'])
        try:
            a = effi_api.articulo(codigo, str(t.get('id_effi') or (previos.get(codigo) or {}).get('id_effi') or ''))
        except Exception:   # noqa: BLE001
            sin.append(codigo)
            continue
        nombre = re.sub(r'\s+', ' ', str(a.get('descripcion') or '')).strip()
        if nombre:
            stock = {}
            for b in a.get('stock_bodegas') or []:
                try:
                    stock[str(b['bodega'])] = round(float(b.get('stock') or 0), 2)
                except (KeyError, TypeError, ValueError):
                    pass
            nuevos[codigo] = {'nombre_panel': t['nombre'], 'nombre_effi': nombre, 'id_effi': str(a.get('id') or ''), 'stock_effi': stock, 'at': _iso()}
    with _lock:
        d = _leer()
        cambiadas = sum(1 for c, v in nuevos.items() if (d['nombres'].get(c) or {}).get('nombre_effi') != v['nombre_effi'])
        d['nombres'].update(nuevos)
        d.update(ultima=_iso(), error=(f'{len(sin)} telas sin artículo exacto en Effi: ' + ', '.join(sin[:8])) if sin else '')
        _guardar(d)
    return {'ok': True, 'cambiadas': cambiadas, 'sin_articulo': sin}


def mapa() -> dict:
    """Todas las formas con que el panel muestra cada tela -> nombre de Effi."""
    salida = {}
    for codigo, v in _leer()['nombres'].items():
        efi, pan = v.get('nombre_effi'), v.get('nombre_panel')
        if not efi or not pan:
            continue
        for clave, valor in ((pan, efi), (f'({codigo}) {pan}', f'({codigo}) {efi}')):
            clave = re.sub(r'\s+', ' ', clave).strip()
            if clave != valor:
                salida[clave] = valor
    return salida


def _stock_panel() -> dict[str, dict[str, float]]:
    """Metros de cada tela por bodega, tal como los ve el panel, con el id de la bodega de Effi como clave. Los rollos sin bodega cuentan en BODEGA INDOOR (la de por defecto)."""
    from app import inventario_api
    por_tela: dict[str, dict[str, float]] = {}
    for t in inventario_api.inventory_bodegas().get('telas') or []:
        codigo = proveedores_tela.codigo_de(t.get('nombre'))
        if not codigo:
            continue
        reparto: dict[str, float] = {}
        for r in t.get('rollos') or []:
            bodega = BODEGAS.get(r.get('bodega') or inventario_api.DEFAULT_PLACE)
            if bodega:
                reparto[bodega] = reparto.get(bodega, 0.0) + float(r.get('v') or 0)
        total = round(float(t.get('mts') or 0), 2)   # el total real de la tela (ya con las salidas, que no descuentan rollos)
        suma = sum(reparto.values())
        if total > 0 and suma <= 0:
            reparto = {BODEGAS[inventario_api.DEFAULT_PLACE]: total}
        elif total >= 0 and suma > 0 and abs(suma - total) > 0.01:
            reparto = {b: v * total / suma for b, v in reparto.items()}   # las salidas se reparten en proporción entre las bodegas
        por_tela[codigo] = {b: round(v, 2) for b, v in reparto.items()}
    return por_tela


def evaluar() -> list[dict]:
    """Por tela: lo que dice el panel por bodega contra lo que dice Effi, y la diferencia que habría que ajustar en Effi (el panel manda)."""
    panel = _stock_panel()
    d = _leer()
    filas = []
    for t in proveedores_tela.telas():
        codigo = str(t['codigo'])
        v = d['nombres'].get(codigo)
        fila = {'codigo': codigo, 'tela': (v or {}).get('nombre_effi') or t['nombre'], 'id_effi': (v or {}).get('id_effi', ''), 'estado': 'sin_articulo', 'bodegas': [], 'panel': 0.0, 'effi': 0.0, 'diferencia': 0.0}
        if v:
            pan, efi = panel.get(codigo, {}), v.get('stock_effi') or {}
            ids = sorted(set(pan) | set(efi) | set(BODEGAS.values()), key=lambda i: (i not in _NOMBRE_BODEGA, int(i)))
            for b in ids:
                p_, e_ = round(pan.get(b, 0.0), 2), round(efi.get(b, 0.0), 2)
                if p_ == 0 and e_ == 0 and b not in _NOMBRE_BODEGA:
                    continue
                fila['bodegas'].append({'bodega': b, 'nombre': _NOMBRE_BODEGA.get(b) or _OTRAS.get(b, b), 'panel': p_, 'effi': e_, 'delta': round(p_ - e_, 2)})
            fila['panel'] = round(sum(pan.values()), 2)
            fila['effi'] = round(sum(efi.values()), 2)
            fila['diferencia'] = round(fila['panel'] - fila['effi'], 2)
            hay = any(abs(b['delta']) >= 0.01 for b in fila['bodegas'])
            grande = hay and abs(fila['diferencia']) > GRANDE_MTS and abs(fila['diferencia']) > GRANDE_PCT * max(fila['panel'], fila['effi'], 1)
            fila['estado'] = 'igual' if not hay else ('grande' if grande else 'ajustar')
            fila['nombre_panel'] = t['nombre']
            fila['nombre_igual'] = (v.get('nombre_effi') or '') == (v.get('nombre_panel') or '')
        filas.append(fila)
    orden = {'grande': 0, 'ajustar': 1, 'igual': 2, 'sin_articulo': 3}
    return sorted(filas, key=lambda f: (orden[f['estado']], -abs(f['diferencia']), f['tela']))


def _releer(codigo: str) -> None:
    """Vuelve a leer en Effi el stock de una tela (por su ID) y lo guarda."""
    v = _leer()['nombres'].get(codigo)
    if not v or not v.get('id_effi'):
        return
    try:
        a = effi_api.articulo(codigo, v['id_effi'])
    except Exception:   # noqa: BLE001
        return
    with _lock:
        d = _leer()
        d['nombres'][codigo]['stock_effi'] = {str(x['bodega']): round(float(x.get('stock') or 0), 2) for x in a.get('stock_bodegas') or []}
        _guardar(d)


def aplicar_tela(codigo: str, usuario: str) -> dict:
    """Escribe en Effi, un ajuste por bodega, la diferencia para que la tela quede igual que en el panel; después vuelve a leer la tela en Effi."""
    if not _usar_api():
        raise HTTPException(400, 'Falta conectar la API de Effi (pantalla «API Effi» del agente de inventario).')
    _releer(str(codigo))   # siempre con el stock de Effi de este momento
    fila = next((f for f in evaluar() if f['codigo'] == str(codigo)), None)
    if not fila or fila['estado'] in ('sin_articulo', 'igual'):
        raise HTTPException(404, 'Esa tela no tiene nada que ajustar.')
    hechos = []

    def registrar(estado, tipo_op, origen, destino, cantidad, ident='', detalle=''):
        hechos.append({'codigo': codigo, 'tela': fila['tela'], 'bodega': (f"{origen} → {destino}" if tipo_op == 'traslado' else destino), 'delta': cantidad, 'estado': estado, 'tipo': 'a_effi',
                       'operacion': tipo_op, 'ajuste': ident, 'detalle': detalle, 'por': usuario, 'at': _iso()})

    def fallo(exc, tipo_op, origen, destino, cantidad):
        registrar('error', tipo_op, origen, destino, cantidad, detalle=str(exc)[:200])
        with _lock:
            d = _leer()
            d['ajustes'] = (d['ajustes'] + hechos)[-200:]
            _guardar(d)
        raise HTTPException(502, f"Effi no aceptó el {tipo_op} ({origen} → {destino}): {str(exc)[:150]}")

    # 1) lo que sobra en una bodega de Effi y falta en otra se MUEVE con un traslado (el total no cambia)
    sobran = sorted([[b['bodega'], -b['delta']] for b in fila['bodegas'] if b['delta'] <= -0.01], key=lambda x: -x[1])
    faltan = sorted([[b['bodega'], b['delta']] for b in fila['bodegas'] if b['delta'] >= 0.01], key=lambda x: -x[1])
    nombre = lambda i: _NOMBRE_BODEGA.get(i) or _OTRAS.get(i, i)
    for o in sobran:
        for f in faltan:
            mover = round(min(o[1], f[1]), 2)
            if mover < 0.01:
                continue
            clave = 'sm-t-' + hashlib.sha1(f"{codigo}|{o[0]}|{f[0]}|{mover}|{fila['panel']}|{fila['effi']}".encode()).hexdigest()[:22]
            try:
                r = effi_api.crear_traslado(clave, int(o[0]), int(f[0]), fila['id_effi'], mover, f'{PROPIO} ({usuario})')
            except Exception as exc:   # noqa: BLE001
                fallo(exc, 'traslado', nombre(o[0]), nombre(f[0]), mover)
            registrar('hecho', 'traslado', nombre(o[0]), nombre(f[0]), mover, r['id'])
            log.warning('STOCKMAN: traslado %s · %s · %s → %s %g mts (por %s)', r['id'], fila['tela'], nombre(o[0]), nombre(f[0]), mover, usuario)
            o[1] = round(o[1] - mover, 2)
            f[1] = round(f[1] - mover, 2)
    # 2) lo que falta en Effi (el panel tiene más) se SUMA con un ajuste de inventario
    for f in faltan:
        if f[1] < 0.01:
            continue
        clave = 'sm-a-' + hashlib.sha1(f"{codigo}|{f[0]}|{f[1]}|{fila['panel']}|{fila['effi']}".encode()).hexdigest()[:22]
        try:
            r = effi_api.crear_ajuste(clave, int(f[0]), fila['id_effi'], f[1], f'{PROPIO} ({usuario})')
        except Exception as exc:   # noqa: BLE001
            fallo(exc, 'ajuste', '', nombre(f[0]), f[1])
        registrar('hecho', 'ajuste', '', nombre(f[0]), f[1], r['id'])
        log.warning('STOCKMAN: ajuste %s · %s · %s +%g mts (por %s)', r['id'], fila['tela'], nombre(f[0]), f[1], usuario)
    # 3) lo que sobra en Effi y el panel no tiene: restar no se puede por ajuste (la API solo acepta cantidades mayores que cero)
    for o in sobran:
        if o[1] >= 0.01:
            registrar('pendiente', 'salida', nombre(o[0]), '', -o[1], detalle='Effi tiene más que el panel y por la API no se puede restar: hazlo en Effi')
    with _lock:
        d = _leer()
        d['ajustes'] = (d['ajustes'] + hechos)[-200:]
        _guardar(d)
    _base_a_actual([codigo])
    try:   # relee la tela en Effi para que la pantalla muestre ya el stock nuevo
        a = effi_api.articulo(codigo, fila['id_effi'])
        with _lock:
            d = _leer()
            d['nombres'][codigo]['stock_effi'] = {str(x['bodega']): round(float(x.get('stock') or 0), 2) for x in a.get('stock_bodegas') or []}
            _guardar(d)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude releer la tela tras ajustarla')
    return {'ok': True, 'ajustes': len(hechos)}


def _base_a_actual(codigos) -> None:
    """Da por procesado lo que hoy dice el panel de esas telas (después de traer un ajuste de Effi o de igualar una tela), para no devolverlo a Effi."""
    try:
        actual = _stock_panel()
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude leer el panel para actualizar la base')
        return
    with _lock:
        d = _leer()
        if d['panel_base'] is None:
            return
        for c in codigos:
            d['panel_base'][str(c)] = dict(actual.get(str(c), {}))
        _guardar(d)


def cambios_panel(fijar_base: bool = False) -> list[dict]:
    """Lo que cambió en el panel, bodega por bodega, desde la última vez que se procesó. La primera vez solo se anota cómo está el panel (sin mandar nada a Effi)."""
    actual = _stock_panel()
    with _lock:
        d = _leer()
        if d['panel_base'] is None:
            if fijar_base:
                d['panel_base'] = {c: dict(v) for c, v in actual.items()}
                _guardar(d)
            return []
        base = d['panel_base']
    salida = []
    for codigo, por_bodega in actual.items():
        if codigo not in base:   # tela nueva en el panel: se toma como punto de partida
            continue
        for b, ahora in por_bodega.items():
            antes = float(base[codigo].get(b, 0.0))
            if abs(ahora - antes) >= 0.01:
                salida.append({'codigo': codigo, 'bodega': b, 'antes': round(antes, 2), 'ahora': round(ahora, 2), 'delta': round(ahora - antes, 2)})
        for b, antes in base[codigo].items():   # una bodega que quedó en cero (ya no aparece en el panel)
            if b not in por_bodega and abs(float(antes)) >= 0.01:
                salida.append({'codigo': codigo, 'bodega': b, 'antes': round(float(antes), 2), 'ahora': 0.0, 'delta': round(-float(antes), 2)})
    return salida


def aplicar_cambio(c: dict, usuario: str) -> dict:
    """Un ajuste en Effi, de UNA bodega y por lo que cambió en el panel."""
    v = _leer()['nombres'].get(c['codigo'])
    if not v or not v.get('id_effi'):
        raise HTTPException(404, 'Esa tela no tiene artículo en Effi.')
    if c['delta'] <= 0:   # la API de Effi solo suma en un ajuste: una salida del panel todavía no se puede restar en Effi
        raise HTTPException(501, 'Restar en Effi no se puede hacer por la API de ajustes (solo suma): queda pendiente.')
    clave = 'sm-' + hashlib.sha1(f"{c['codigo']}|{c['bodega']}|{c['antes']}|{c['ahora']}".encode()).hexdigest()[:24]
    nombre = _NOMBRE_BODEGA.get(c['bodega']) or _OTRAS.get(c['bodega'], c['bodega'])
    try:
        r = effi_api.crear_ajuste(clave, int(c['bodega']), v['id_effi'], c['delta'], f'{PROPIO} ({usuario})')
    except Exception as exc:   # noqa: BLE001
        with _lock:
            d = _leer()
            d['ajustes'] = (d['ajustes'] + [{'codigo': c['codigo'], 'tela': v.get('nombre_effi') or c['codigo'], 'bodega': nombre, 'delta': c['delta'], 'estado': 'error', 'tipo': 'a_effi', 'detalle': str(exc)[:200], 'por': usuario, 'at': _iso()}])[-200:]
            _guardar(d)
        raise HTTPException(502, f'Effi no aceptó el ajuste de {nombre}: {str(exc)[:150]}')
    with _lock:
        d = _leer()
        d['ajustes'] = (d['ajustes'] + [{'codigo': c['codigo'], 'tela': v.get('nombre_effi') or c['codigo'], 'bodega': nombre, 'delta': c['delta'], 'estado': 'hecho', 'tipo': 'a_effi', 'ajuste': r['id'], 'por': usuario, 'at': _iso()}])[-200:]
        if d['panel_base'] is not None:
            d['panel_base'].setdefault(c['codigo'], {})[c['bodega']] = c['ahora']
        _guardar(d)
    log.warning('STOCKMAN: ajuste %s en Effi · %s · %s %+g mts (por %s)', r['id'], v.get('nombre_effi'), nombre, c['delta'], usuario)
    _releer(c['codigo'])
    return r


def _bodega_panel(effi_id: str) -> str:
    return next((nombre for nombre, i in BODEGAS.items() if i == str(effi_id)), '')


def traer_de_effi(aplicar: bool) -> list[dict]:
    """Ajustes de inventario NUEVOS hechos en Effi sobre telas del panel. Con aplicar=True se registran en el panel (INGRESO si suma, SALIDA si resta); si no, quedan como pendientes."""
    d = _leer()
    por_id = {v['id_effi']: c for c, v in d['nombres'].items() if v.get('id_effi')}
    lista = effi_api._lista('ajuste_inventario')
    ids = [int(a['id']) for a in lista if str(a.get('id') or '').isdigit()]
    if not ids:
        return []
    if d['ajuste_base'] is None:   # primera vez: lo anterior no se trae, solo lo que pase desde ahora
        with _lock:
            d = _leer()
            d['ajuste_base'] = max(ids)
            _guardar(d)
        return []
    propios = {str(h.get('ajuste')) for h in d['ajustes'] if h.get('tipo') == 'a_effi' and h.get('ajuste')}
    vistos = set(d['vistos'])
    telas = {str(t['codigo']): t for t in proveedores_tela.telas()}
    nuevos, pendientes, marcar = [], [], []
    for a in sorted(lista, key=lambda x: int(x['id'])):
        i = str(a['id'])
        if int(i) <= int(d['ajuste_base']) or i in vistos:
            continue
        codigo = por_id.get(str(a.get('articulo')))
        if i in propios or str(a.get('observacion') or '').startswith(PROPIO) or not codigo or str(a.get('vigente', '1')) != '1':
            marcar.append(i)   # los ajustes del propio STOCKMAN, de otros artículos o anulados no se traen
            continue
        try:
            delta = round(float(a.get('cantidad') or 0), 2)
        except ValueError:
            marcar.append(i)
            continue
        bodega = _bodega_panel(str(a.get('bodega')))
        item = {'codigo': codigo, 'tela': (d['nombres'].get(codigo) or {}).get('nombre_effi') or codigo, 'bodega': _NOMBRE_BODEGA.get(str(a.get('bodega'))) or _OTRAS.get(str(a.get('bodega')), str(a.get('bodega'))),
                'delta': delta, 'ajuste': i, 'tipo': 'a_panel', 'por': str(a.get('nombre_responsable') or ''), 'at': str(a.get('fecha_trans') or '')}
        if abs(delta) < 0.01:
            marcar.append(i)
        elif not bodega:
            nuevos.append({**item, 'estado': 'otra_bodega', 'detalle': 'Bodega de Effi que no es del panel: no se trae'})
            marcar.append(i)
        elif aplicar:
            try:
                from app import inventario_api
                t = telas.get(codigo) or {}
                inventario_api.inventory_movement(inventario_api.InventoryMovement(type='INGRESO' if delta > 0 else 'SALIDA', name=f"({codigo}) {t.get('nombre', '')}".strip(), code=codigo, mts=abs(delta), rolls=1,
                                                                                     source=f'STOCKMAN · ajuste {i} de Effi', bodega=bodega if delta > 0 else ''))
                nuevos.append({**item, 'estado': 'hecho'})
                marcar.append(i)
                log.warning('STOCKMAN: ajuste %s de Effi traído al panel: %s %s %+g mts', i, item['tela'], bodega, delta)
            except Exception as exc:   # noqa: BLE001
                nuevos.append({**item, 'estado': 'error', 'detalle': str(exc)[:160]})
        else:
            pendientes.append({**item, 'estado': 'pendiente'})
    _base_a_actual({n['codigo'] for n in nuevos if n.get('estado') == 'hecho'})
    with _lock:
        d = _leer()
        d['vistos'] = (d['vistos'] + marcar)[-500:]
        d['ajustes'] = (d['ajustes'] + nuevos)[-200:]
        d['pendientes'] = pendientes
        _guardar(d)
    return nuevos


def ciclo(completo: bool = False) -> dict:
    """Un ciclo de STOCKMAN: (1) lo que cambió en Effi pasa al panel, (2) lo que cambió en el panel pasa a Effi. En ese orden, para no pisar un ajuste hecho en Effi."""
    if not _usar_api():
        return {'ok': False}
    d = _leer()
    r = {'ok': True}
    if completo or time.time() - float(d['ultimo_completo']) > INTERVALO or not d['nombres']:
        r = refrescar_nombres()
        with _lock:
            dd = _leer()
            dd['ultimo_completo'] = time.time()
            _guardar(dd)
    activo = _leer()['activo']
    traidos = []
    try:
        traidos = traer_de_effi(activo)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude revisar los ajustes de Effi')
    ajustadas = 0
    try:
        cambios = cambios_panel(fijar_base=True)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude leer el panel')
        cambios = []
    ahora = time.time()
    with _lock:   # un cambio debe mantenerse ESTABLE_SEG antes de mandarlo a Effi
        dd = _leer()
        estables = {}
        for c in cambios:
            k = f"{c['codigo']}|{c['bodega']}"
            previo = dd['estables'].get(k)
            estables[k] = previo if previo and previo['ahora'] == c['ahora'] else {'ahora': c['ahora'], 'desde': ahora}
        dd['estables'] = estables
        _guardar(dd)
    if activo and r.get('ok') and not _leer()['pendientes']:
        for c in cambios:
            if ajustadas >= MAX_TELAS * 4:
                break
            if abs(c['delta']) > GRANDE_MTS or ahora - estables[f"{c['codigo']}|{c['bodega']}"]['desde'] < ESTABLE_SEG:
                continue   # un cambio enorme espera a una persona (botón de la tarjeta)
            try:
                aplicar_cambio(c, 'STOCKMAN')
                ajustadas += 1
            except HTTPException:
                continue
    with _lock:
        dd = _leer()
        dd['ultima'] = _iso()
        _guardar(dd)
    return {**r, 'ajustadas': ajustadas, 'traidos': len(traidos)}


def revisar() -> dict:
    return ciclo(completo=True)


def _clave_webhook() -> str:
    with _lock:
        d = _leer()
        if not d['webhook'].get('clave'):
            d['webhook']['clave'] = secrets.token_urlsafe(24)
            _guardar(d)
        return d['webhook']['clave']


def _verificar_firma(secreto: str, cuerpo: bytes, cabeceras: dict) -> str:
    """Si Effi firma el aviso (HMAC-SHA256 con el secreto del webhook en alguna cabecera de firma), comprueba la firma. Solo informa: la clave de la dirección ya autentica."""
    if not secreto:
        return 'sin_secreto'
    esperado = hmac.new(secreto.encode(), cuerpo, hashlib.sha256).hexdigest()
    recibidas = [v for k, v in cabeceras.items() if any(t in k for t in ('signature', 'firma', 'hmac', 'sign'))]
    if not recibidas:
        return 'sin_firma'
    return 'valida' if any(hmac.compare_digest(str(v).strip().lower().removeprefix('sha256=').removeprefix('v1='), esperado) for v in recibidas) else 'no_coincide'


@webhook_router.api_route('/webhook/{clave}', methods=['POST', 'PUT', 'GET'])
async def webhook(clave: str, request: Request):
    """Aviso de Effi (webhook): hay algo nuevo. No se confía en lo que traiga: solo despierta a STOCKMAN, que lee en Effi por la API qué cambió."""
    if not hmac.compare_digest(str(clave), _clave_webhook()):
        raise HTTPException(404, 'No encontrado')
    cuerpo = await request.body()
    cabeceras = {k.lower(): v for k, v in request.headers.items()}
    with _lock:
        d = _leer()
        secreto = str(d['webhook'].get('secreto') or '')
        d['webhook'].update(recibidos=int(d['webhook'].get('recibidos', 0)) + 1, ultimo=_iso(), bytes=len(cuerpo),
                            cabeceras=sorted(k for k in cabeceras if k not in ('host', 'content-length', 'connection', 'accept', 'accept-encoding', 'user-agent', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip')),
                            firma=_verificar_firma(secreto, cuerpo, cabeceras))
        _guardar(d)
    _despertar.set()
    return {'ok': True}


def _cambios_para_ver() -> list[dict]:
    try:
        nombres = _leer()['nombres']
        return [{**c, 'tela': (nombres.get(c['codigo']) or {}).get('nombre_effi') or c['codigo'], 'bodega_nombre': _NOMBRE_BODEGA.get(c['bodega']) or _OTRAS.get(c['bodega'], c['bodega'])} for c in cambios_panel()]
    except Exception:   # noqa: BLE001
        return []


@router.post('/webhook-direccion')
def webhook_direccion(request: Request):
    """Botón «GENERAR WEBHOOK»: entrega la dirección (con su clave) para pegarla en Effi. No cambia la clave, así que un webhook ya creado en Effi sigue funcionando."""
    return {'ruta': f"/api/stockman/webhook/{_clave_webhook()}"}


@router.get('/estado')
def estado(request: Request):
    d = _leer()
    filas = evaluar()
    cuenta = lambda k: sum(1 for f in filas if f['estado'] == k)
    return {'agente': {'nombre': NOMBRE, 'activo': d['activo'], 'ultima': d['ultima'], 'error': d['error']},
            'resumen': {'telas': len(filas), 'ajustar': cuenta('ajustar'), 'grande': cuenta('grande'), 'igual': cuenta('igual'), 'sin_articulo': cuenta('sin_articulo')},
            'telas': filas, 'ajustes': d['ajustes'][-30:][::-1], 'pendientes': d['pendientes'], 'cambios': _cambios_para_ver(),
            'webhook': {'recibidos': d['webhook'].get('recibidos', 0), 'ultimo': d['webhook'].get('ultimo', ''),
                        'firma': d['webhook'].get('firma', ''), 'cabeceras': d['webhook'].get('cabeceras', []), 'secreto': bool(d['webhook'].get('secreto'))}}


@router.post('/revisar')
def revisar_ahora(request: Request):
    return revisar()


@router.post('/ajustar')
def ajustar(request: Request, payload: dict):
    """Botón AJUSTAR de la tarjeta: deja esa tela en Effi igual que en el panel."""
    usuario = str(_auth(request) or '')
    return aplicar_tela(str(payload.get('codigo') or ''), usuario)


@router.put('/activar')
def activar(request: Request, payload: dict):
    usuario = str(_auth(request) or '')
    with _lock:
        d = _leer()
        d['activo'] = bool(payload.get('activo'))
        _guardar(d)
    log.warning('STOCKMAN %s por %s', 'ACTIVADO' if d['activo'] else 'APAGADO', usuario)
    return {'ok': True, 'activo': d['activo']}


@router.get('/nombres')
def nombres():
    return {'mapa': mapa()}


@router.post('/nombres/actualizar')
def actualizar(request: Request):
    return refrescar_nombres()


def _bucle() -> None:
    time.sleep(90)
    while True:
        try:
            ciclo()
        except Exception:   # noqa: BLE001
            log.exception('STOCKMAN: fallo en el ciclo')
        if _despertar.wait(CICLO):   # un aviso de Effi (webhook) lo despierta ya; si no, revisa cada 2 minutos
            _despertar.clear()
            time.sleep(3)   # unos segundos para que Effi termine de guardar el ajuste


def start() -> None:
    threading.Thread(target=_bucle, name='stockman', daemon=True).start()
