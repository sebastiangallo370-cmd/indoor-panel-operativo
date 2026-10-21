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


_referencias: Callable[[], list[str]] = lambda: []
_REF = re.compile(r'A(\d{2,5})([A-Z]+\d+)')


def configurar(items: Callable[[], list[dict]], referencias: Callable[[], list[str]] | None = None) -> None:
    global _items, _referencias
    _items = items
    if referencias:
        _referencias = referencias


def referencias_por_tela() -> dict[str, list[str]]:
    """Código de tela → referencias que lo usan en Producción (A2102SD02 → tela 2102, referencia SD02)."""
    por_tela: dict[str, set] = {}
    try:
        textos = _referencias()
    except Exception:  # noqa: BLE001
        textos = []
    for texto in textos:
        for codigo, ref in _REF.findall(str(texto or '').upper()):
            por_tela.setdefault(codigo, set()).add(ref)
    return {c: sorted(v) for c, v in por_tela.items()}


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


_NO_PROVEEDOR = {'VARIAS', 'DON ALVEIRO', ''}   # «VARIAS» no es un proveedor y DON ALVEIRO es otra empresa: no se sugieren


def _prov_inventario(texto) -> str:
    """Proveedor que dice el inventario (el encabezado de columna del Sheet), con el nombre como se guarda en Effi."""
    t = re.sub(r'\s+', ' ', str(texto or '')).strip().upper()
    if t in _NO_PROVEEDOR or t.startswith('CAMPO '):
        return ''
    return {'LINDA TEXTIL': 'LINDATEXTIL'}.get(t, t)


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
        # datos de la ficha de la tela: rollos reales, uso en pedidos y el proveedor que ya dice el inventario (la columna del Sheet donde está la tela)
        try:
            t['rollos_reales'] = t.get('rollos_reales', 0) + int(i.get('rolls') or 0)
            t['uso_pedidos'] = t.get('uso_pedidos', 0) + int(i.get('uso_pedidos') or 0)
            t['uso_mts'] = round(t.get('uso_mts', 0.0) + float(i.get('uso_mts') or 0), 1)
        except (TypeError, ValueError):
            pass
        if not t.get('prov_inventario'):
            t['prov_inventario'] = _prov_inventario(i.get('proveedor'))
    refs = referencias_por_tela()
    for c, t in por_codigo.items():
        g = guardado.get(c) or {}
        t['referencias'] = refs.get(c, [])
        t.update(proveedor=g.get('proveedor', ''), nit=g.get('nit', ''), ancho=g.get('ancho', ''), id_effi=g.get('id_effi', ''))
        t['faltan'] = [n for n, v in (('proveedor', t['proveedor']), ('ancho', t['ancho'])) if not v]   # los 4 datos obligatorios: nombre y código siempre vienen del inventario
    return sorted(por_codigo.values(), key=lambda t: (int(t['codigo']), t['nombre']))


@router.get('')
def listar():
    t = telas()
    return {'telas': t, 'proveedores': sorted({x['proveedor'] for x in t if x['proveedor']})}


@router.put('')
def guardar(payload: dict, request: Request):
    codigo = str(payload.get('codigo', '')).strip()
    if not re.fullmatch(r'\d{1,6}', codigo):
        raise HTTPException(400, 'Código de tela no válido')
    with _lock:
        d = _leer()
        g = dict(d.get(codigo) or {})
        if 'proveedor' in payload:   # lo que no viene en la petición se conserva (el ancho y el proveedor se guardan por separado)
            g['proveedor'] = str(payload.get('proveedor') or '').strip()[:120]
            g['nit'] = str(payload.get('nit', g.get('nit', '')) or '').strip()[:30]
        if 'ancho' in payload:
            texto = str(payload.get('ancho') or '').strip().replace(',', '.')
            if texto:
                try:
                    valor = float(texto)
                except ValueError:
                    raise HTTPException(400, 'El ancho debe ser un número (en centímetros)')
                if not 10 <= valor <= 400:
                    raise HTTPException(400, 'El ancho debe estar entre 10 y 400 cm')
                texto = f'{valor:g}'
            g['ancho'] = texto
        if 'id_effi' in payload:   # opcional: el id del artículo en Effi, se va llenando de a poco
            ide = str(payload.get('id_effi') or '').strip()
            if ide and not re.fullmatch(r'\d{1,12}', ide):
                raise HTTPException(400, 'El ID de Effi son solo números')
            g['id_effi'] = ide
        if g.get('proveedor') or g.get('ancho') or g.get('id_effi'):
            g['actualizado'] = time.strftime('%Y-%m-%d %H:%M:%S')
            d[codigo] = g
        else:
            d.pop(codigo, None)
        _guardar(d)
    return {'ok': True}
