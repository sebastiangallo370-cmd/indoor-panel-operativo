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


# Directorio de proveedores: los datos de contacto que se escriben al registrar un proveedor en una tela quedan guardados por proveedor,
# para que al escogerlo en otra tela salga en la lista y sus datos se llenen solos.
_dir_file = _file.with_name('proveedores_directorio.json')
CAMPOS_DIRECTORIO = ('vendedor', 'wpp', 'correo')


def directorio() -> dict:
    try:
        d = json.loads(_dir_file.read_text(encoding='utf-8'))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _anotar_en_directorio(g: dict) -> None:
    """Guarda o completa el proveedor de la tela en el directorio (solo pisa un dato si viene escrito)."""
    nombre = str(g.get('proveedor') or '').strip()
    if not nombre:
        return
    d = directorio()
    p = dict(d.get(nombre) or {})
    for campo in CAMPOS_DIRECTORIO:
        if g.get(campo):
            p[campo] = g[campo]
    p['actualizado'] = time.strftime('%Y-%m-%d %H:%M:%S')
    d[nombre] = p
    _dir_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _dir_file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(_dir_file)


def codigo_de(texto: str) -> str:
    """«(700) TOUR ...» -> '700'."""
    m = re.match(r'\s*\((\d+)\)', str(texto or ''))
    return m.group(1) if m else ''


def proveedor_de(codigo: str) -> dict:
    return _leer().get(str(codigo), {})


CAMPOS_EXTRA = ('composicion', 'gramaje', 'tipo', 'stock_minimo', 'stock_maximo', 'vendedor', 'correo', 'precio_sin_iva', 'wpp')   # opcionales: se guardan por separado, nunca son obligatorios

_NO_PROVEEDOR = {'VARIAS', 'DON ALVEIRO', ''}   # «VARIAS» no es un proveedor y DON ALVEIRO es otra empresa: no se sugieren


# Razón social y NIT de cada proveedor, tal como salen en sus facturas electrónicas. El proveedor de INFORMACIÓN TELA se muestra y
# se guarda con la razón social; los nombres cortos de siempre (los del Sheet o los escritos antes) se reconocen como alias.
RAZONES_SOCIALES = (
    ('TEJIDOS DE PUNTO LINDATEXTIL S.A.S.', '901018972-1', ('LINDATEXTIL', 'LINDA TEXTIL', 'TEJIDOS DE PUNTO LINDATEXTIL')),
    ('TEXTILES LAFAYETTE SAS', '860001965', ('LAFAYETTE', 'LA FAYETTE', 'TELAS LAFAYETTE', 'TEXTILES LAFAYETTE')),
    ('MANUFACTURAS ELIOT S.A.S', '860000452', ('ELIOT', 'MANUFACTURAS ELIOT')),
    ('SARAXY S.A.S', '900306394-6', ('SARAXY',)),
    ('MERCANTIL DE TEXTILES S.A.S.', '890914669', ('MERCANTIL DE TEXTILES', 'MERCANTIL')),
    ('COMERCIALIZADORA SPIRIT SAS', '901208883-1', ('SPIRIT', 'TEXTILES SPIRIT', 'COMERCIALIZADORA SPIRIT')),
)


def _clave(texto) -> str:
    t = re.sub(r'[^A-Z0-9 ]', ' ', str(texto or '').upper())
    t = re.sub(r'\b(S ?A ?S|SAS|S A|LTDA)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def razon_social(texto) -> tuple[str, str] | None:
    """(razón social, NIT) del proveedor si se reconoce por su nombre corto o por su razón social; si no, None."""
    k = _clave(texto)
    if not k:
        return None
    for razon, nit, alias in RAZONES_SOCIALES:
        if k == _clave(razon) or k in {_clave(a) for a in alias}:
            return razon, nit
    return None


def alias_de(texto) -> list[str]:
    """Nombres cortos de un proveedor (para buscarlo en Effi si allá está registrado con otro nombre)."""
    r = razon_social(texto)
    return [a for razon, _nit, alias in RAZONES_SOCIALES if r and razon == r[0] for a in alias]


def _prov_inventario(texto) -> str:
    """Proveedor que dice el inventario (el encabezado de columna del Sheet), con el nombre como se guarda en Effi."""
    t = re.sub(r'\s+', ' ', str(texto or '')).strip().upper()
    if t in _NO_PROVEEDOR or t.startswith('CAMPO '):
        return ''
    r = razon_social(t)
    return r[0] if r else t


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
        r = razon_social(t['proveedor'])
        if r:   # los guardados con el nombre corto se muestran con su razón social
            t['proveedor'] = r[0]
        inv = t.get('prov_inventario') or ''
        if not t['proveedor'] and inv and not re.search(r'\s-\s', inv):   # sin proveedor elegido: el del inventario (la columna del Sheet), si es uno solo
            t['proveedor'] = inv
            t['proveedor_auto'] = True
        t.update({k: g.get(k, '') for k in CAMPOS_EXTRA})   # datos opcionales de la ficha de la tela
        try:   # para los agentes: el precio como número, aunque en la tarjeta se muestre tal como se escribió
            t['precio_num'] = _numero(str(t.get('precio_sin_iva') or '')) if t.get('precio_sin_iva') else None
            if t['precio_num'] is not None:
                t['precio_sin_iva'] = formato_cop(t['precio_num'])   # los escritos antes de otra forma también se ven igual
        except HTTPException:
            t['precio_num'] = None
        t['faltan'] = [n for n, v in (('proveedor', t['proveedor']), ('ancho', t['ancho'])) if not v]   # los 4 datos obligatorios: nombre y código siempre vienen del inventario
    return sorted(por_codigo.values(), key=lambda t: (int(t['codigo']), t['nombre']))


def _limpiar_extra(campo: str, valor) -> str:
    texto = re.sub(r'\s+', ' ', str(valor or '')).strip()
    if not texto:
        return ''
    if campo in ('gramaje', 'precio_sin_iva', 'stock_minimo', 'stock_maximo'):
        n = _numero(texto, campo)
        if campo == 'precio_sin_iva':
            return formato_cop(n)   # el precio siempre en pesos colombianos, sin importar cómo se copió: «$ 7.930»
        return format(n, '.4f').rstrip('0').rstrip('.')   # gramaje y stocks (metros) se guardan como número limpio
    return _limpiar_texto(campo, texto)


def _numero(texto: str, campo: str = 'precio_sin_iva') -> float:
    """Lee un número escrito de cualquier forma: a la colombiana («$ 18.500», «1.250.000,50», «7,93»), a la gringa («$7,930.50»),
    sin separadores («7930») o con moneda («COP 7.930»). Con punto y coma a la vez, el último es el decimal; con uno solo,
    si todos los grupos que le siguen tienen 3 cifras es de miles, si no es decimal."""
    numero = re.sub(r'[^\d.,-]', '', str(texto))
    if '.' in numero and ',' in numero:
        dec = '.' if numero.rfind('.') > numero.rfind(',') else ','
        numero = numero.replace(',' if dec == '.' else '.', '').replace(dec, '.')
    elif '.' in numero or ',' in numero:
        sep = '.' if '.' in numero else ','
        partes = numero.split(sep)
        if len(partes) > 1 and all(len(p) == 3 for p in partes[1:]) and partes[0].lstrip('-'):
            numero = ''.join(partes)   # 7.930 / 1.250.000 / 7,930 → miles
        else:
            numero = ''.join(partes[:-1]) + '.' + partes[-1]   # 7,93 / 18.5 → decimal
    try:
        n = float(numero)
    except ValueError:
        raise HTTPException(400, ('El gramaje' if campo == 'gramaje' else 'El precio') + ' debe ser un número')
    if n < 0 or n > 100000000:
        raise HTTPException(400, 'Valor fuera de rango')
    return n


def formato_cop(n: float) -> str:
    """Pesos colombianos: «$ 7.930» (miles con punto; centavos con coma solo si los hay: «$ 7.930,50»)."""
    entero, cent = divmod(round(float(n) * 100), 100)
    texto = '$ ' + f'{int(entero):,}'.replace(',', '.')
    return texto + (f',{int(cent):02d}' if cent else '')


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
    dire = directorio()
    for x in t:   # los contactos ya escritos en las telas también sirven (sin pisar lo del directorio)
        if x['proveedor'] and any(x.get(c) for c in CAMPOS_DIRECTORIO):
            p = dire.setdefault(x['proveedor'], {})
            for c in CAMPOS_DIRECTORIO:
                if x.get(c) and not p.get(c):
                    p[c] = x[c]
    return {'telas': t, 'proveedores': sorted({x['proveedor'] for x in t if x['proveedor']} | {r[0] for r in RAZONES_SOCIALES} | set(dire)), 'directorio': dire}


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
            r = razon_social(g['proveedor'])
            if r:   # se guarda con la razón social de la factura
                g['proveedor'] = r[0]
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
            _anotar_en_directorio(g)
        else:
            d.pop(codigo, None)
        _guardar(d)
    return {'ok': True}
