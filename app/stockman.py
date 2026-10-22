"""STOCKMAN: alinea el inventario del panel con el de Effi.

Primera parte (nombres): cada tela del panel se muestra con el MISMO nombre que tiene su artículo en Effi. El nombre interno del inventario (el del Google Sheet, que usan
los agentes y los movimientos) no se toca: se guarda un alias código -> nombre de Effi en /data/state/stockman.json y el navegador lo aplica al mostrar (nombres-effi.js).
El artículo de Effi se busca por el «ID Effi» de INFORMACIÓN TELA y, si no hay, por la referencia exacta (el código de la tela). Solo lectura en Effi."""
from __future__ import annotations

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

log = logging.getLogger('stockman')
router = APIRouter(prefix='/api/stockman', tags=['stockman'])
_file = Path(os.getenv('STOCKMAN_FILE', '/data/state/stockman.json'))
_lock = threading.RLock()
INTERVALO = 1800
NOMBRE = 'STOCKMAN'


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
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
            nuevos[codigo] = {'nombre_panel': t['nombre'], 'nombre_effi': nombre, 'id_effi': str(a.get('id') or ''), 'at': _iso()}
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
            refrescar_nombres()
        except Exception:   # noqa: BLE001
            log.exception('STOCKMAN: no se pudieron actualizar los nombres')
        time.sleep(INTERVALO)


def start() -> None:
    threading.Thread(target=_bucle, name='stockman', daemon=True).start()
