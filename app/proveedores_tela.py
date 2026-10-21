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


CAMPOS_EXTRA = ('composicion', 'gramaje', 'tipo', 'vendedor', 'correo', 'precio_sin_iva', 'wpp')   # opcionales: se guardan por separado, nunca son obligatorios

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
        t.update({k: g.get(k, '') for k in CAMPOS_EXTRA})   # datos opcionales de la ficha de la tela
        try:   # para los agentes: el precio como número, aunque en la tarjeta se muestre tal como se escribió
            t['precio_num'] = _numero(str(t.get('precio_sin_iva') or '')) if t.get('precio_sin_iva') else None
        except HTTPException:
            t['precio_num'] = None
        t['faltan'] = [n for n, v in (('proveedor', t['proveedor']), ('ancho', t['ancho'])) if not v]   # los 4 datos obligatorios: nombre y código siempre vienen del inventario
    return sorted(por_codigo.values(), key=lambda t: (int(t['codigo']), t['nombre']))


def _limpiar_extra(campo: str, valor) -> str:
    texto = re.sub(r'\s+', ' ', str(valor or '')).strip()
    if not texto:
        return ''
    if campo in ('gramaje', 'precio_sin_iva'):
        n = _numero(texto, campo)
        if campo == 'precio_sin_iva':
            return texto[:30]   # el precio se guarda y se muestra TAL COMO SE ESCRIBIÓ (solo se valida que sea un número)
        return format(n, '.4f').rstrip('0').rstrip('.')
    return _limpiar_texto(campo, texto)


def _numero(texto: str, campo: str = 'precio_sin_iva') -> float:
    """Lee un número escrito a la colombiana o con punto decimal («$ 18.500», «7,93», «1.250.000», «150»)."""
    numero = texto.replace('$', '').replace(' ', '')
    if re.fullmatch(r'\d{1,3}(\.\d{3})+(,\d+)?', numero):   # 12.500 o 1.250.000,50 (formato colombiano)
        numero = numero.replace('.', '').replace(',', '.')
    else:
        numero = numero.replace(',', '.')
    try:
        n = float(numero)
    except ValueError:
        raise HTTPException(400, ('El gramaje' if campo == 'gramaje' else 'El precio') + ' debe ser un número')
    if n < 0 or n > 100000000:
        raise HTTPException(400, 'Valor fuera de rango')
    return n


def _limpiar_texto(campo: str, texto: str) -> str:
    if campo == 'correo':
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', texto):
            raise HTTPException(400, 'El correo del proveedor no es válido')
        return texto.lower()[:120]
    if campo == 'wpp':
        digitos = re.sub(r'[^\d+]', '', texto)
        if len(re.sub(r'\D', '', digitos)) < 7:
            raise HTTPException(400, 'El WhatsApp del proveedor debe tener al menos 7 dígitos')
        return digitos[:20]
    return texto[:160]


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
        for campo in CAMPOS_EXTRA:   # composición, gramaje, tipo, correo, precio sin IVA y WhatsApp del proveedor (todos opcionales)
            if campo in payload:
                g[campo] = _limpiar_extra(campo, payload.get(campo))
        if g.get('proveedor') or g.get('ancho') or g.get('id_effi') or any(g.get(c) for c in CAMPOS_EXTRA):
            g['actualizado'] = time.strftime('%Y-%m-%d %H:%M:%S')
            d[codigo] = g
        else:
            d.pop(codigo, None)
        _guardar(d)
    return {'ok': True}
