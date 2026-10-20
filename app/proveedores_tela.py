"""Proveedor de cada tela (por código de Bodega tela). Lo elige el usuario en Estándar 2026 > PROVEEDORES DE TELA;
el agente de inventario lo usa al crear la orden de compra en Effi (Effi no rellena el proveedor al elegir el artículo)."""
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix='/api/proveedores-tela', tags=['proveedores-tela'])
_file = Path(os.getenv('PROVEEDORES_TELA_FILE', '/data/state/proveedores_tela.json'))
_lock = threading.Lock()
_items: Callable[[], list[dict]] = lambda: []


def configurar(items: Callable[[], list[dict]]) -> None:
    global _items
    _items = items


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _guardar(d: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(_file)


def codigo_de(texto: str) -> str:
    """«(700) TOUR ...» -> '700'."""
    m = re.match(r'\s*\((\d+)\)', str(texto or ''))
    return m.group(1) if m else ''


def proveedor_de(codigo: str) -> dict:
    return _leer().get(str(codigo), {})


def telas() -> list[dict]:
    guardado = _leer()
    por_codigo: dict[str, dict] = {}
    for i in _items():
        if i.get('categoria') != 'BODEGA TELA':
            continue
        c = codigo_de(i.get('nombre'))
        if not c:
            continue
        t = por_codigo.setdefault(c, {'codigo': c, 'nombre': re.sub(r'^\s*\(\d+\)\s*', '', str(i.get('nombre') or '')).strip(), 'rollos': 0, 'mts': 0.0})
        t['rollos'] += 1
        try:
            t['mts'] = round(t['mts'] + float(i.get('mts') or i.get('total') or 0), 1)   # metros en bodega, para que la tarjeta informe cuánta tela hay
        except (TypeError, ValueError):
            pass
    for c, t in por_codigo.items():
        g = guardado.get(c) or {}
        t.update(proveedor=g.get('proveedor', ''), nit=g.get('nit', ''))
    return sorted(por_codigo.values(), key=lambda t: (int(t['codigo']), t['nombre']))


@router.get('')
def listar():
    t = telas()
    return {'telas': t, 'proveedores': sorted({x['proveedor'] for x in t if x['proveedor']})}


@router.put('')
def guardar(payload: dict, request: Request):
    codigo = str(payload.get('codigo', '')).strip()
    proveedor = str(payload.get('proveedor', '')).strip()[:120]
    nit = str(payload.get('nit', '')).strip()[:30]
    if not re.fullmatch(r'\d{1,6}', codigo):
        raise HTTPException(400, 'Código de tela no válido')
    with _lock:
        d = _leer()
        if proveedor:
            d[codigo] = {'proveedor': proveedor, 'nit': nit, 'actualizado': time.strftime('%Y-%m-%d %H:%M:%S')}
        else:
            d.pop(codigo, None)
        _guardar(d)
    return {'ok': True}
