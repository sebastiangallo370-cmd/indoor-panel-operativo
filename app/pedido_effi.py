"""PEDIDO EN EFFI (COMERCIALES): formulario con la misma estructura de «Crear cotización» de Effi (encabezado, conceptos, detalles, totales y formas de pago).
Al confirmar, el panel crea en Effi una COTIZACIÓN o una REMISIÓN DE VENTA por la API (POST /api/cotizacion o /api/remision_v).

Seguridad:
  - Solo cuentas que ven COMERCIALES (mismo permiso que CREAR CLIENTE). La llave de Effi es la que guarda ZEUS en el servidor.
  - APAGADO por defecto: sin el archivo /data/state/pedido_effi_activo (o PEDIDO_EFFI_ACTIVO=1) NO se crea nada en Effi; «Vista previa» siempre funciona.
    La cuenta «Indoor Sport» lo enciende y apaga desde el mismo formulario.
  - Cada envío lleva una idempotency_key: un doble clic o un reintento no duplica el documento (Effi responde 409 con el ya creado).
  - La remisión descuenta inventario y registra cobros: por eso aquí solo se aceptan formas de pago a crédito o «Contado a 1 día» (el cobro en caja se hace en Effi).
Los totales los calcula Effi y los compara con los enviados: aquí se calculan igual (descuento por concepto e impuestos en porcentaje)."""
from __future__ import annotations

import os
import re
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from app import effi_api

router = APIRouter(prefix='/api/pedido-effi', tags=['pedido-effi'])

ACTIVO_ARCHIVO = Path(os.getenv('PEDIDO_EFFI_ACTIVO_FILE', '/data/state/pedido_effi_activo'))
MAX_CONCEPTOS = 60
CLAVE = re.compile(r'^[A-Za-z0-9._:-]{8,36}$')
TIPOS = {'cotizacion': 'cotización', 'remision': 'remisión de venta'}

_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
_llave: Callable[[], str] = lambda: ''
_admin: Callable[[str], bool] = lambda usuario: False
_cache: dict = {}


def configurar(auth: Callable, permitido: Callable[[str], bool], llave: Callable[[], str], admin: Callable[[str], bool]) -> None:
    global _auth, _permitido, _llave, _admin
    _auth, _permitido, _llave, _admin = auth, permitido, llave, admin


def activo() -> bool:
    return os.getenv('PEDIDO_EFFI_ACTIVO', '') == '1' or ACTIVO_ARCHIVO.exists()


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'PEDIDO EN EFFI es solo para el equipo comercial')
    return usuario


def _con_llave() -> None:
    k = (_llave() or '').strip()
    if k:
        effi_api.usar_llave(k)
    if not effi_api.disponible():
        raise HTTPException(409, 'Falta la API key de Effi: la guarda la cuenta Indoor Sport en la pestaña «API Effi» de ZEUS.')


def _effi(fn, *a, **k):
    try:
        return fn(*a, **k)
    except effi_api.EffiError as e:
        raise HTTPException(e.estado if e.estado in (400, 401, 403, 409) else 502, str(e))


def _entero(v, campo: str) -> int:
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        raise HTTPException(400, f'Falta elegir: {campo}')
    if n <= 0:
        raise HTTPException(400, f'Falta elegir: {campo}')
    return n


def _num(v, campo: str, minimo: Decimal = Decimal(0), mayor: bool = False) -> Decimal:
    d = effi_api._d(v)
    if d < minimo or (mayor and d <= minimo):
        raise HTTPException(400, f'{campo} no es válido')
    return d


# ---------------------------------------------------------------- catálogos (cambian poco: se guardan 10 min)
def _catalogos() -> dict:
    ahora = time.time()
    if _cache.get('t', 0) > ahora - 600:
        return _cache['d']
    formas = [{'id': int(f['id']), 'nombre': str(f.get('nombre') or ''), 'credito': str(f.get('contado_credito')) != '1', 'defecto': str(f.get('default_option')) == '1'}
              for f in effi_api._lista('forma_pago') if str(f.get('vigente', '1')) == '1']
    d = {
        'sucursales': [{'id': int(s['id']), 'nombre': str(s.get('nombre') or '')} for s in effi_api._lista('sucursal') if str(s.get('vigente', '1')) == '1'],
        'bodegas': [{'id': int(b['id']), 'nombre': str(b.get('nombre') or ''), 'sucursal': int(b.get('sucursal') or 0)} for b in effi_api._lista('bodega') if str(b.get('vigente', '1')) == '1'],
        'centros': [{'id': int(c['id']), 'nombre': str(c.get('nombre') or '')} for c in effi_api._lista('centro_costos') if str(c.get('ingresos')) == '1' and str(c.get('vigente', '1')) == '1'],
        'vendedores': [{'id': int(e['tercero']), 'nombre': str(e.get('nombre') or '')} for e in effi_api._lista('empleado') if str(e.get('vendedor')) == '1' and str(e.get('vigente', '1')) == '1'],
        'formas_pago': formas,
    }
    _cache.update(t=ahora, d=d)
    return d


def _precio_de(art: dict) -> float:
    """Precio de venta de la tarifa normal si el artículo lo trae (los nombres de esas columnas varían); si no, 0 y el comercial lo escribe."""
    for k in ('precio_venta', 'precio_1', 'precio', 'precio_tarifa_normal'):
        v = effi_api._d(art.get(k))
        if v > 0:
            return float(v)
    for k, v in art.items():
        if str(k).startswith('precio') and 'min' not in str(k) and effi_api._d(v) > 0:
            return float(effi_api._d(v))
    return 0.0


@router.get('/estado')
def estado(request: Request):
    usuario = _usuario(request)
    return {'activo': activo(), 'llave': bool((_llave() or '').strip() or effi_api.disponible()), 'puede_activar': bool(_admin(usuario))}


@router.post('/activo')
def cambiar_activo(request: Request, payload: dict):
    usuario = _usuario(request)
    if not _admin(usuario):
        raise HTTPException(403, 'Solo la cuenta Indoor Sport enciende o apaga la creación en Effi')
    if bool((payload or {}).get('activo')):
        ACTIVO_ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
        ACTIVO_ARCHIVO.write_text(datetime.now().isoformat(timespec='seconds') + f' {usuario}\n', encoding='utf-8')
    else:
        ACTIVO_ARCHIVO.unlink(missing_ok=True)
    return {'activo': activo()}


@router.get('/catalogos')
def catalogos(request: Request):
    _usuario(request)
    _con_llave()
    return _effi(_catalogos)


@router.get('/clientes')
def clientes(request: Request, q: str = ''):
    _usuario(request)
    _con_llave()
    q = re.sub(r'\s+', ' ', q or '').strip()
    if len(q) < 3:
        return {'clientes': []}
    filas = _effi(effi_api._lista, 'cliente', {'nombre': q})[:25]
    salida = []
    for c in filas:
        if not c.get('tercero'):
            continue
        salida.append({'tercero': int(c['tercero']), 'nombre': str(c.get('nombre') or ''), 'documento': f"{c.get('abreviacion') or ''} {c.get('id') or ''}".strip(),
                       'forma_pago': c.get('t_forma_pago'), 'vendedor': c.get('vendedor'),
                       'direcciones': [{k: d.get(k) for k in ('id_pais', 'id_provincia', 'id_ciudad', 'direccion', 'referencia', 'ciudad')} for d in (c.get('direcciones') or [])]})
    return {'clientes': salida}


@router.get('/articulos')
def articulos(request: Request, q: str = ''):
    _usuario(request)
    _con_llave()
    q = re.sub(r'\s+', ' ', q or '').strip()
    if len(q) < 2:
        return {'articulos': []}
    filas = _effi(effi_api._lista, 'articulo', {'referencia': q + '%'})
    if len(filas) < 25:
        vistos = {a['id'] for a in filas}
        filas += [a for a in _effi(effi_api._lista, 'articulo', {'descripcion': q}) if a['id'] not in vistos]
    return {'articulos': [{'id': int(a['id']), 'referencia': str(a.get('referencia') or ''), 'descripcion': str(a.get('descripcion') or ''), 'precio': _precio_de(a),
                           'impuesto': str(a.get('impuesto') or '')} for a in filas if str(a.get('ventas', '1')) != '0'][:25]}


# ---------------------------------------------------------------- cuerpo del documento
def construir(p: dict, usuario: str = '') -> dict:
    """Arma el cuerpo de POST /cotizacion o /remision_v con los datos del formulario y calcula lo que Effi va a verificar. No envía nada."""
    tipo = str(p.get('tipo') or '')
    if tipo not in TIPOS:
        raise HTTPException(400, 'Elige si es cotización o remisión')
    clave = str(p.get('clave') or '')
    if not CLAVE.match(clave):
        raise HTTPException(400, 'Recarga la página: falta la clave de seguridad del envío')
    sucursal, bodega, centro = _entero(p.get('sucursal'), 'Sucursal'), _entero(p.get('bodega'), 'Bodega'), _entero(p.get('centro_costos'), 'Centro de costos')
    cliente = _entero(p.get('cliente'), 'Cliente')
    try:
        entrega = date.fromisoformat(str(p.get('fecha_entrega') or ''))
    except ValueError:
        raise HTTPException(400, 'Falta la fecha de entrega')
    lineas = p.get('conceptos') or []
    if not isinstance(lineas, list) or not lineas:
        raise HTTPException(400, 'Agrega al menos un concepto')
    if len(lineas) > MAX_CONCEPTOS:
        raise HTTPException(400, f'Máximo {MAX_CONCEPTOS} conceptos por documento')
    formas_cat = {f['id']: f for f in _catalogos()['formas_pago']}
    arts: dict[int, tuple[dict, list]] = {}
    out = {'articulo': [], 'descripcion': [], 'cantidad': [], 'precio': [], 'descuento': []}
    impuestos: dict[str, list[int]] = {}
    detalle, bruto_t, desc_t, imp_t = [], Decimal(0), Decimal(0), Decimal(0)
    for i, l in enumerate(lineas, 1):
        aid = _entero(l.get('articulo'), f'Artículo del concepto {i}')
        cant = _num(l.get('cantidad'), f'La cantidad del concepto {i}', mayor=True)
        precio = _num(l.get('precio'), f'El precio del concepto {i}')
        desc = _num(l.get('descuento') or 0, f'El descuento del concepto {i}')
        bruto = effi_api._redondear(cant * precio)
        if desc > bruto:
            raise HTTPException(400, f'El descuento del concepto {i} es mayor que su valor')
        if aid not in arts:
            art = _effi(effi_api.articulo, '', str(aid))
            imps = _effi(effi_api.impuestos_de, art.get('impuesto'))
            for x in imps:
                if str(x.get('tipo_calculo') or '').lower() != 'porcentaje':
                    raise HTTPException(400, f"El impuesto «{x.get('etiqueta')}» del artículo {art.get('referencia')} no es de porcentaje: no sé calcularlo")
            arts[aid] = (art, imps)
        art, imps = arts[aid]
        base = bruto - desc
        imp = effi_api._redondear(sum((base * effi_api._d(x.get('valor')) / 100 for x in imps), Decimal(0)))
        out['articulo'].append(str(aid))
        out['descripcion'].append(str(l.get('descripcion') or art.get('descripcion') or art.get('referencia') or '')[:120])
        out['cantidad'].append(float(cant)); out['precio'].append(float(precio)); out['descuento'].append(float(desc))
        if imps:
            impuestos[str(i)] = [int(x['id']) for x in imps]
        bruto_t += bruto; desc_t += desc; imp_t += imp
        detalle.append({'referencia': art.get('referencia'), 'bruto': float(bruto), 'descuento': float(desc), 'impuesto': float(imp), 'total': float(base + imp)})
    total = effi_api._redondear(bruto_t - desc_t + imp_t)
    formas = p.get('formas_pago') or []
    if not isinstance(formas, list) or not formas:
        raise HTTPException(400, 'Agrega la forma de pago')
    ids, valores = [], []
    for j, f in enumerate(formas, 1):
        fid = _entero(f.get('id'), f'Forma de pago {j}')
        if fid not in formas_cat:
            raise HTTPException(400, f'La forma de pago {j} no existe en Effi')
        if tipo == 'remision' and not formas_cat[fid]['credito']:
            raise HTTPException(400, f"En una remisión no uses «{formas_cat[fid]['nombre']}» (pide medio de pago y caja): usa «Contado a 1 día» o un plazo, y registra el cobro en Effi")
        ids.append(fid)
        valores.append(effi_api._redondear(effi_api._d(f.get('valor'))) if str(f.get('valor') or '').strip() != '' else None)
    if None in valores:
        if valores.count(None) > 1:
            raise HTTPException(400, 'Solo una forma de pago puede ir sin valor (toma el resto)')
        resto = total - sum((v for v in valores if v is not None), Decimal(0))
        valores[valores.index(None)] = resto
    if any(v < 0 for v in valores):
        raise HTTPException(400, 'Hay un valor de forma de pago negativo')
    if sum(valores, Decimal(0)) != total:
        raise HTTPException(400, f'Las formas de pago suman ${sum(valores, Decimal(0)):,.2f} y el total es ${total:,.2f}: deben ser iguales')
    obs = str(p.get('observacion') or '').strip()
    marca = f'Creada desde el panel por {usuario}' if usuario else 'Creada desde el panel'
    limite = 1020 if tipo == 'cotizacion' else 255
    obs = ((obs + ' · ' if obs else '') + marca)[:limite]
    cuerpo = {'idempotency_key': clave, 'sucursal': sucursal, 'bodega': bodega, 'centro_costos': centro, 'fecha_entrega': entrega.isoformat(), 'divisa': 'COP', 'trm': 1,
              'cliente': cliente, **out, 't_forma_pago': ids, 'valor_forma_pago': [float(v) for v in valores], 'observacion': obs}
    if impuestos:
        cuerpo['impuestos'] = impuestos
    d = p.get('direccion') or {}
    if all(d.get(k) for k in ('id_pais', 'id_provincia', 'id_ciudad', 'direccion')):
        cuerpo.update(id_pais_cliente=int(d['id_pais']), id_provincia_cliente=int(d['id_provincia']), id_ciudad_cliente=int(d['id_ciudad']),
                      direccion_cliente=str(d['direccion'])[:200])
        if d.get('referencia'):
            cuerpo['referencia_cliente'] = str(d['referencia'])[:100]
    if p.get('vendedor'):
        cuerpo['vendedor'] = _entero(p.get('vendedor'), 'Vendedor')
    garantia = str(p.get('garantia') or '').strip()
    if garantia:
        cuerpo['garantia'] = garantia[:255]
    return {'cuerpo': cuerpo, 'resumen': {'tipo': TIPOS[tipo], 'lineas': detalle, 'bruto': float(bruto_t), 'descuento': float(desc_t), 'subtotal': float(bruto_t - desc_t),
                                          'impuestos': float(imp_t), 'total': float(total), 'formas': [{'id': i, 'valor': float(v)} for i, v in zip(ids, valores)]}}


@router.post('/vista-previa')
def vista_previa(request: Request, payload: dict):
    usuario = _usuario(request)
    _con_llave()
    r = construir(payload or {}, usuario)
    return {'ok': True, 'resumen': r['resumen']}


@router.post('/crear')
def crear(request: Request, payload: dict):
    usuario = _usuario(request)
    if not activo():
        raise HTTPException(409, 'Crear documentos en Effi está APAGADO. La cuenta Indoor Sport lo enciende con el interruptor de arriba del formulario.')
    _con_llave()
    r = construir(payload or {}, usuario)
    tipo = str(payload.get('tipo'))
    hecho = _effi(effi_api.crear_cotizacion if tipo == 'cotizacion' else effi_api.crear_remision, r['cuerpo'])
    return {'ok': True, 'tipo': TIPOS[tipo], 'id': hecho['id'], 'numero': f"{hecho.get('prefijo') or ''}{hecho['id']}", 'total': hecho.get('total') or r['resumen']['total']}
