"""STOCKMAN: alinea el inventario del panel con el de Effi (agente de INVENTARIOS, vive en el VPS).

Primera parte (nombres): cada tela del panel se muestra con el MISMO nombre que tiene su artículo en Effi. El nombre interno del inventario (el del Google Sheet, que usan
los agentes y los movimientos) no se toca: se guarda un alias código -> nombre de Effi en /data/state/stockman.json y el navegador lo aplica al mostrar (nombres-effi.js).
El artículo de Effi se busca por el «ID Effi» de INFORMACIÓN TELA y, si no hay, por la referencia exacta (el código de la tela). Solo lectura en Effi."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
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
_file = Path(os.getenv('STOCKMAN_FILE', '/data/state/stockman.json'))
_lock = threading.RLock()
INTERVALO = 1800
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
    d.setdefault('ajustes', [])     # historial de ajustes hechos en Effi
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
    nuevos, sin = {}, []
    for t in telas:
        codigo = str(t['codigo'])
        try:
            a = effi_api.articulo(codigo, str(t.get('id_effi') or ''))
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
        for r in t.get('rollos') or []:
            bodega = BODEGAS.get(r.get('bodega') or inventario_api.DEFAULT_PLACE)
            if bodega:
                por_tela.setdefault(codigo, {})
                por_tela[codigo][bodega] = round(por_tela[codigo].get(bodega, 0.0) + float(r.get('v') or 0), 2)
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


def aplicar_tela(codigo: str, usuario: str) -> dict:
    """Escribe en Effi, un ajuste por bodega, la diferencia para que la tela quede igual que en el panel; después vuelve a leer la tela en Effi."""
    if not _usar_api():
        raise HTTPException(400, 'Falta conectar la API de Effi (pantalla «API Effi» del agente de inventario).')
    fila = next((f for f in evaluar() if f['codigo'] == str(codigo)), None)
    if not fila or fila['estado'] in ('sin_articulo', 'igual'):
        raise HTTPException(404, 'Esa tela no tiene nada que ajustar.')
    hechos = []
    for b in fila['bodegas']:
        if abs(b['delta']) < 0.01:
            continue
        clave = 'sm-' + hashlib.sha1(f"{codigo}|{b['bodega']}|{b['panel']}|{b['effi']}".encode()).hexdigest()[:24]
        try:
            r = effi_api.crear_ajuste(clave, int(b['bodega']), fila['id_effi'], b['delta'], f'Alineado con el panel por STOCKMAN ({usuario})')
        except Exception as exc:   # noqa: BLE001
            with _lock:
                d = _leer()
                d['ajustes'] = (d['ajustes'] + [{'codigo': codigo, 'tela': fila['tela'], 'bodega': b['nombre'], 'delta': b['delta'], 'estado': 'error', 'detalle': str(exc)[:200], 'por': usuario, 'at': _iso()}])[-200:]
                _guardar(d)
            raise HTTPException(502, f"Effi no aceptó el ajuste de {b['nombre']}: {str(exc)[:150]}")
        hechos.append({'codigo': codigo, 'tela': fila['tela'], 'bodega': b['nombre'], 'delta': b['delta'], 'estado': 'hecho', 'ajuste': r['id'], 'por': usuario, 'at': _iso()})
        log.warning('STOCKMAN: ajuste %s · %s · %s %+g mts (por %s)', r['id'], fila['tela'], b['nombre'], b['delta'], usuario)
    with _lock:
        d = _leer()
        d['ajustes'] = (d['ajustes'] + hechos)[-200:]
        _guardar(d)
    try:   # relee la tela en Effi para que la pantalla muestre ya el stock nuevo
        a = effi_api.articulo(codigo, fila['id_effi'])
        with _lock:
            d = _leer()
            d['nombres'][codigo]['stock_effi'] = {str(x['bodega']): round(float(x.get('stock') or 0), 2) for x in a.get('stock_bodegas') or []}
            _guardar(d)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude releer la tela tras ajustarla')
    return {'ok': True, 'ajustes': len(hechos)}


def revisar() -> dict:
    """Actualiza lo que dice Effi y, si STOCKMAN está ACTIVO, ajusta solo las telas con diferencia normal (las grandes esperan a una persona)."""
    r = refrescar_nombres()
    ajustadas = 0
    if r.get('ok') and _leer()['activo']:
        for f in [x for x in evaluar() if x['estado'] == 'ajustar'][:MAX_TELAS]:
            try:
                aplicar_tela(f['codigo'], 'STOCKMAN')
                ajustadas += 1
            except HTTPException:
                continue
    return {**r, 'ajustadas': ajustadas}


@router.get('/estado')
def estado(request: Request):
    d = _leer()
    filas = evaluar()
    cuenta = lambda k: sum(1 for f in filas if f['estado'] == k)
    return {'agente': {'nombre': NOMBRE, 'activo': d['activo'], 'ultima': d['ultima'], 'error': d['error']},
            'resumen': {'telas': len(filas), 'ajustar': cuenta('ajustar'), 'grande': cuenta('grande'), 'igual': cuenta('igual'), 'sin_articulo': cuenta('sin_articulo')},
            'telas': filas, 'ajustes': d['ajustes'][-30:][::-1]}


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
            revisar()
        except Exception:   # noqa: BLE001
            log.exception('STOCKMAN: fallo en la revisión periódica')
        time.sleep(INTERVALO)


def start() -> None:
    threading.Thread(target=_bucle, name='stockman', daemon=True).start()
