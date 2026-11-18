"""PEDIDO EN EFFI (COMERCIALES): formulario con la misma estructura de «Crear cotización» de Effi (encabezado, conceptos, detalles, totales y formas de pago).
Al confirmar, el panel crea en Effi una COTIZACIÓN o una REMISIÓN DE VENTA por la API (POST /api/cotizacion o /api/remision_v).

Seguridad:
  - Solo cuentas que ven COMERCIALES (mismo permiso que CREAR CLIENTE). La llave de Effi es la que guarda ZEUS en el servidor.
  - SIEMPRE ACTIVO (sin interruptor en pantalla). Protecciones que quedan: vista previa obligatoria, cuadro de confirmación antes de crear, idempotency_key y permisos.
    Freno de emergencia solo desde el servidor: crear el archivo /data/state/pedido_effi_apagado (o PEDIDO_EFFI_ACTIVO=0) y «Vista previa» sigue funcionando pero no se crea nada en Effi.
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

APAGADO_ARCHIVO = Path(os.getenv('PEDIDO_EFFI_APAGADO_FILE', '/data/state/pedido_effi_apagado'))
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
    """Siempre activo, salvo el freno de emergencia del servidor (archivo pedido_effi_apagado o PEDIDO_EFFI_ACTIVO=0)."""
    return os.getenv('PEDIDO_EFFI_ACTIVO', '') != '0' and not APAGADO_ARCHIVO.exists()


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
        'sucursales': [{'id': int(s['id']), 'nombre': str(s.get('nombre') or ''), 'direccion': str(s.get('direccion') or ''), 'ciudad': str(s.get('nombre_ciudad') or ''), 'telefonos': str(s.get('telefonos') or '')}
                       for s in effi_api._lista('sucursal') if str(s.get('vigente', '1')) == '1'],
        'bodegas': [{'id': int(b['id']), 'nombre': str(b.get('nombre') or ''), 'sucursal': int(b.get('sucursal') or 0)} for b in effi_api._lista('bodega') if str(b.get('vigente', '1')) == '1'],
        'centros': [{'id': int(c['id']), 'nombre': str(c.get('nombre') or '')} for c in effi_api._lista('centro_costos') if str(c.get('ingresos')) == '1' and str(c.get('vigente', '1')) == '1'],
        'vendedores': [{'id': int(e['tercero']), 'nombre': str(e.get('nombre') or '')} for e in effi_api._lista('empleado') if str(e.get('vendedor')) == '1' and str(e.get('vigente', '1')) == '1'],
        'formas_pago': formas,
        'monedas': [{'id': 'COP', 'nombre': 'Peso Colombiano $ COP'}, {'id': 'USD', 'nombre': 'Dólar Estadounidense $ USD'}, {'id': 'EUR', 'nombre': 'Euro € EUR'}],
        'retenciones': [{'id': int(r['id']), 'nombre': f"{r.get('etiqueta') or r.get('nombre')} ({effi_api._d(r.get('valor')).normalize():f}%)", 'valor': str(r.get('valor') or '0'), 'tipo': str(r.get('tipo_calculo') or ''),
                         'base': str(r.get('base') or '0'), 'base_excluida': str(r.get('base_excluida') or '0'), 'base_maxima': str(r.get('base_maxima') or '0')}
                        for r in effi_api._lista('retencion') if str(r.get('vigente', '1')) == '1'],
    }
    _cache.update(t=ahora, d=d)
    return d


def _precio_de(art: dict) -> float:
    """Precio de venta de la «Tarifa normal» (Effi lo entrega como texto: «Tarifa normal: 71000.0000; Tarifa Mayorista: 0.0000»); si no hay, el primer precio mayor que cero; si no, 0 y el comercial lo escribe."""
    texto = str(art.get('precios_venta') or '')
    m = re.search(r'tarifa normal\s*:\s*([\d.,]+)', texto, re.I)
    if m and effi_api._d(m.group(1)) > 0:
        return float(effi_api._d(m.group(1)))
    for v in re.findall(r':\s*([\d.]+)', texto):
        if effi_api._d(v) > 0:
            return float(effi_api._d(v))
    for k in ('precio_venta', 'precio_1', 'precio'):
        if effi_api._d(art.get(k)) > 0:
            return float(effi_api._d(art.get(k)))
    return 0.0


def _articulo_json(a: dict, **extra) -> dict:
    return {'id': int(a['id']), 'referencia': str(a.get('referencia') or ''), 'descripcion': str(a.get('descripcion') or ''), 'precio': _precio_de(a), 'impuesto': str(a.get('impuesto') or ''), **extra}


@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    return {'activo': activo(), 'llave': bool((_llave() or '').strip() or effi_api.disponible())}


@router.get('/catalogos')
def catalogos(request: Request):
    _usuario(request)
    _con_llave()
    from app import listado_pedido
    return {**_effi(_catalogos), 'listado': {'tallas': listado_pedido.TALLAS, 'lineas': listado_pedido.LINEAS, 'max_disenos': 20}}


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
                       'telefono': str(c.get('celular') or c.get('telefono_1') or ''), 'email': str(c.get('email') or ''),
                       'direcciones': [{k: d.get(k) for k in ('id_pais', 'id_provincia', 'id_ciudad', 'direccion', 'referencia', 'ciudad', 'provincia', 'pais')} for d in (c.get('direcciones') or [])]})
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
        def _buscar(filtro: dict) -> list:
            try:
                return _effi(effi_api._lista, 'articulo', filtro)
            except Exception:  # noqa: BLE001 - una búsqueda extra que falle nunca debe tumbar los resultados que ya hay
                return []
        extra = _buscar({'descripcion': q})
        sin = not filas and not extra   # los respaldos solo cuando no apareció nada
        if sin and ' ' in q:   # varias palabras en otro orden («futbol uniforme»): se busca la más larga y se filtra por todas
            palabras = [w for w in q.split(' ') if w]
            extra = [a for a in _buscar({'descripcion': max(palabras, key=len)})
                     if all(w.upper() in (str(a.get('descripcion') or '') + ' ' + str(a.get('referencia') or '')).upper() for w in palabras)]
        if sin and not extra and len(q) >= 3:   # la referencia puede estar a mitad de texto
            extra = _buscar({'referencia': '%' + q + '%'})
        for a in extra:
            if a['id'] not in vistos:
                vistos.add(a['id']); filas.append(a)
    return {'articulos': [_articulo_json(a) for a in filas if str(a.get('ventas', '1')) != '0'][:25]}


# ---------------------------------------------------------------- Capturar series (F8): pegar o escanear códigos
SEPARADOR = re.compile(r'[\s,.;]+')   # los mismos separadores de Effi: espacio, tab, salto de línea, coma, punto y punto y coma
MAX_CODIGOS = 80                      # Effi limita a 120 peticiones por minuto


def _resolver_codigo(codigo: str) -> dict | None:
    """Código → artículo: GTIN/EPC, otro código de barras, serie (código exacto) o ID del artículo. Devuelve {'articulo': {...}, 'id_serie': int|None} o None si no existe."""
    for filtro in ('gtin', 'c_barras'):
        for a in _effi(effi_api._lista, 'articulo', {filtro: codigo}):
            if str(a.get('ventas', '1')) != '0':
                return {'articulo': a, 'id_serie': None}
    for sr in _effi(effi_api._lista, 'serie', {'codigo': codigo}):
        aid = str(sr.get('articulo') or '').strip()
        if aid.isdigit():
            art = next(iter(_effi(effi_api._lista, 'articulo', {'id': aid})), None)
            if art:
                return {'articulo': art, 'id_serie': int(sr['id'])}
    if codigo.isdigit() and len(codigo) <= 7:
        art = next(iter(_effi(effi_api._lista, 'articulo', {'id': codigo})), None)
        if art and str(art.get('ventas', '1')) != '0':
            return {'articulo': art, 'id_serie': None}
    return None


def capturar_codigos(texto: str) -> dict:
    """Cada código agrega un concepto de cantidad 1; el mismo artículo repetido suma cantidad; una serie va en su propio concepto (cantidad 1, sin repetir)."""
    codigos = [c for c in SEPARADOR.split(str(texto or '')) if c]
    if not codigos:
        raise HTTPException(400, 'Pega o escanea al menos un código')
    if len(codigos) > MAX_CODIGOS:
        raise HTTPException(400, f'Máximo {MAX_CODIGOS} códigos por vez')
    conceptos: list[dict] = []
    por_articulo: dict[int, dict] = {}
    vistos_serie: set[int] = set()
    no_encontrados: list[str] = []
    repetidos: list[str] = []
    cache: dict[str, dict | None] = {}
    for c in codigos:
        if c not in cache:
            cache[c] = _resolver_codigo(c)
        r = cache[c]
        if r is None:
            if c not in no_encontrados:
                no_encontrados.append(c)
            continue
        a = r['articulo']
        if r['id_serie'] is not None:
            if r['id_serie'] in vistos_serie:
                repetidos.append(c)
                continue
            vistos_serie.add(r['id_serie'])
            conceptos.append({**_articulo_json(a, id_serie=r['id_serie'], serie=c), 'cantidad': 1})
        elif int(a['id']) in por_articulo:
            por_articulo[int(a['id'])]['cantidad'] += 1
        else:
            por_articulo[int(a['id'])] = {**_articulo_json(a, id_serie=None), 'cantidad': 1}
            conceptos.append(por_articulo[int(a['id'])])
    return {'conceptos': conceptos, 'no_encontrados': no_encontrados, 'repetidos': repetidos}


@router.post('/capturar')
def capturar(request: Request, payload: dict):
    _usuario(request)
    _con_llave()
    return capturar_codigos((payload or {}).get('codigos'))


# ---------------------------------------------------------------- cuerpo del documento
def _retencion(r: dict, subtotal: Decimal, impuestos: Decimal) -> Decimal:
    """Valor de una retención (misma regla que effi_api.construir_pedido): «Sobre base» = % de lo gravable si llega a la base mínima; «Sobre impuesto principal» = % del IVA."""
    tipo = str(r.get('tipo') or '').lower()
    if effi_api._d(r.get('base_maxima')) > 0:
        raise HTTPException(400, f"La retención «{r.get('nombre')}» tiene base máxima: no sé calcularla; elige otra")
    pct = effi_api._d(r.get('valor'))
    if tipo == 'sobre base':
        gravable = subtotal - effi_api._d(r.get('base_excluida'))
        return effi_api._redondear(gravable * pct / 100) if gravable >= effi_api._d(r.get('base')) else Decimal(0)
    if tipo == 'sobre impuesto principal':
        return effi_api._redondear(impuestos * pct / 100)
    raise HTTPException(400, f"La retención «{r.get('nombre')}» ({r.get('tipo')}) no es de un tipo que sepa calcular")


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
    divisa = str(p.get('divisa') or 'COP').upper()
    if not re.fullmatch(r'[A-Z]{3}', divisa):
        raise HTTPException(400, 'La moneda no es válida')
    trm = Decimal(1) if divisa == 'COP' else _num(p.get('trm'), 'La TRM', mayor=True)
    desc_global = _num(p.get('descuento_global') or 0, 'El descuento global')
    if desc_global > 100:
        raise HTTPException(400, 'El descuento global no puede pasar de 100 %')
    lineas = p.get('conceptos') or []
    if not isinstance(lineas, list) or not lineas:
        raise HTTPException(400, 'Agrega al menos un concepto')
    if len(lineas) > MAX_CONCEPTOS:
        raise HTTPException(400, f'Máximo {MAX_CONCEPTOS} conceptos por documento')
    cat = _catalogos()
    formas_cat = {f['id']: f for f in cat['formas_pago']}
    arts: dict[int, tuple[dict, list]] = {}
    out = {'articulo': [], 'descripcion': [], 'cantidad': [], 'precio': [], 'descuento': []}
    gift, obs_c, series = [], [], []
    impuestos: dict[str, list[int]] = {}
    detalle, bruto_t, desc_t, imp_t = [], Decimal(0), Decimal(0), Decimal(0)
    grupos_iva: dict[int, dict] = {}   # Effi redondea el impuesto UNA vez por cada impuesto sobre la suma de sus bases (no línea por línea): 137.999,99 y no 138.000,00
    for i, l in enumerate(lineas, 1):
        aid = _entero(l.get('articulo'), f'Artículo del concepto {i}')
        cant = _num(l.get('cantidad'), f'La cantidad del concepto {i}', mayor=True)
        id_serie = int(l['id_serie']) if str(l.get('id_serie') or '').isdigit() else None
        if id_serie is not None:
            if cant != 1:
                raise HTTPException(400, f'El concepto {i} lleva una serie: su cantidad es 1')
            if id_serie in series:
                raise HTTPException(400, f'La serie del concepto {i} está repetida')
        series.append(id_serie)
        precio = _num(l.get('precio'), f'El precio del concepto {i}')
        obsequio = bool(l.get('obsequio'))
        desc = Decimal(0) if obsequio else _num(l.get('descuento') or 0, f'El descuento del concepto {i}')
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
        if l.get('sin_iva'):   # el comercial pidió quitar el IVA de este concepto: se crea sin impuestos
            imps = []
        efectivo = bruto if obsequio else desc   # un obsequio se descuenta al 100 %
        base = bruto - efectivo
        base_imp = bruto if obsequio else base   # comprobado en Effi: el obsequio NO deja de pagar IVA (se calcula sobre el valor completo y el total de la línea son solo los impuestos)
        imp = effi_api._redondear(sum((base_imp * effi_api._d(x.get('valor')) / 100 for x in imps), Decimal(0)))
        out['articulo'].append(str(aid))
        out['descripcion'].append(str(l.get('descripcion') or art.get('descripcion') or art.get('referencia') or '')[:120])
        out['cantidad'].append(float(cant)); out['precio'].append(float(precio)); out['descuento'].append(float(desc))
        gift.append(1 if obsequio else 0); obs_c.append(str(l.get('observacion') or '').strip()[:250])
        if imps:
            impuestos[str(i)] = [int(x['id']) for x in imps]
        bruto_t += bruto; desc_t += efectivo
        for x in imps:
            g = grupos_iva.setdefault(int(x['id']), {'base': Decimal(0), 'pct': effi_api._d(x.get('valor')), 'partes': []})
            g['base'] += base_imp
            g['partes'].append((len(detalle), effi_api._redondear(base_imp * g['pct'] / 100)))
        detalle.append({'referencia': art.get('referencia'), 'bruto': float(bruto), 'descuento': float(efectivo), 'impuesto': float(imp), 'total': float(base + imp),
                        'impuestos': ', '.join(str(x.get('etiqueta') or '') for x in imps)})
    for g in grupos_iva.values():
        exacto = effi_api._redondear(g['base'] * g['pct'] / 100)
        imp_t += exacto
        resto = exacto - sum((v for _, v in g['partes']), Decimal(0))   # la diferencia de centavos se deja en la última línea de ese impuesto para que las líneas sumen lo mismo que Effi
        if resto and g['partes']:
            fila = detalle[g['partes'][-1][0]]
            fila['impuesto'] = float(Decimal(str(fila['impuesto'])) + resto); fila['total'] = float(Decimal(str(fila['total'])) + resto)
    propina = effi_api._redondear(_num(p.get('propina') or 0, 'La propina'))
    subtotal = bruto_t - desc_t
    ret_ids = []
    for x in (p.get('retenciones') or []):
        rid = _entero(x, 'Retención')
        if rid not in ret_ids:
            ret_ids.append(rid)
    ret_cat = {r['id']: r for r in cat['retenciones']}
    ret_valor, ret_detalle = Decimal(0), []
    for rid in ret_ids:
        if rid not in ret_cat:
            raise HTTPException(400, f'La retención {rid} no existe en Effi')
        v = _retencion(ret_cat[rid], subtotal, imp_t)
        ret_valor += v; ret_detalle.append({'id': rid, 'nombre': ret_cat[rid]['nombre'], 'valor': float(v)})
    # Total neto como en «Crear cotización» de Effi (comprobado en su pantalla): subtotal + IVA + propina − retenciones. Las formas de pago deben sumar ese total neto.
    total = effi_api._redondear(subtotal + imp_t + propina - ret_valor)
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
    cuerpo = {'idempotency_key': clave, 'sucursal': sucursal, 'bodega': bodega, 'centro_costos': centro, 'fecha_entrega': entrega.isoformat(), 'divisa': divisa, 'trm': float(trm),
              'cliente': cliente, **out, 't_forma_pago': ids, 'valor_forma_pago': [float(v) for v in valores], 'observacion': obs}
    if impuestos:
        cuerpo['impuestos'] = impuestos
    if any(gift):
        cuerpo['gift'] = gift
    if any(x is not None for x in series):
        cuerpo['id_serie'] = series
    if any(obs_c):
        cuerpo['observacion_concepto'] = obs_c
    if desc_global > 0:
        cuerpo['descuento_global'] = float(desc_global)
    if ret_ids:
        cuerpo['retencion'] = ret_ids
    if propina > 0:
        cuerpo['propina'] = float(propina)
    pronto = effi_api._redondear(_num(p.get('prontopago') or 0, 'El descuento por pronto pago'))
    if pronto > 0:
        try:
            fpp = date.fromisoformat(str(p.get('fecha_prontopago') or ''))
        except ValueError:
            raise HTTPException(400, 'Falta la fecha del descuento por pronto pago')
        cuerpo['prontopago'] = float(pronto); cuerpo['fecha_prontopago'] = fpp.isoformat()
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
    return {'cuerpo': cuerpo, 'resumen': {'tipo': TIPOS[tipo], 'lineas': detalle, 'bruto': float(bruto_t), 'descuento': float(desc_t), 'subtotal': float(subtotal),
                                          'impuestos': float(imp_t), 'propina': float(propina), 'retenciones': float(ret_valor), 'retenciones_detalle': ret_detalle,
                                          'total': float(total), 'neto_con_retencion': float(total), 'formas': [{'id': i, 'valor': float(v)} for i, v in zip(ids, valores)]}}


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
        raise HTTPException(409, 'Crear documentos en Effi está frenado desde el servidor (freno de emergencia). Avisa a administración.')
    _con_llave()
    r = construir(payload or {}, usuario)
    tipo = str(payload.get('tipo'))
    hecho = _effi(effi_api.crear_cotizacion if tipo == 'cotizacion' else effi_api.crear_remision, r['cuerpo'])
    if tipo == 'cotizacion':   # se pide el PDF de Effi YA, sin esperar a que el navegador lo pida: así EFFITRON empieza antes
        try:
            from app import effitron
            effitron.solicitar_pdf_cotizacion(int(hecho['id']))
        except Exception:  # noqa: BLE001 - nunca debe afectar la creación
            pass
    return {'ok': True, 'tipo': TIPOS[tipo], 'id': hecho['id'], 'numero': f"{hecho.get('prefijo') or ''}{hecho['id']}", 'total': hecho.get('total') or r['resumen']['total']}

# ---------------------------------------------------------------- Proyectos del cliente (carpeta MAESTROS en la NAS)
_PALABRAS_SUELTAS = {'SAS', 'SA', 'S', 'A', 'LTDA', 'CIA', 'E', 'U', 'Y', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EN', 'EL', 'CLUB', 'FC', 'FUTBOL', 'DEPORTIVO',
                     'CORPORACION', 'FUNDACION', 'ASOCIACION', 'LIQUIDACION', 'ESCUELA', 'ACADEMIA', 'COLEGIO'}
_cache_carpetas: dict = {'t': 0.0, 'nombres': []}
_cache_proyectos: dict[str, tuple[float, dict]] = {}
CACHE_SEG = 300


def _palabras(texto: str) -> set[str]:
    """Palabras que identifican a un cliente (sin acentos, sin «SAS», «CLUB», «FC»…): «CORPORACION SOCIOCULTURAL CERROS FC» -> {SOCIOCULTURAL, CERROS}."""
    import unicodedata
    plano = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c)).upper()
    return {w for w in re.split(r'[^A-Z0-9]+', plano) if len(w) >= 3 and w not in _PALABRAS_SUELTAS}


def carpeta_de_cliente(nombre: str, carpetas: list[str]) -> str | None:
    """Carpeta de la NAS que corresponde al cliente de Effi (los nombres no son idénticos: «…CERROS FUTBOL CLUB DE MEDELLIN S.A.S. EN LIQUIDACION» vs «…CERROS FC»).
    Gana la carpeta cuyas palabras clave están todas en el nombre del cliente y, entre varias, la más específica. Sin coincidencia clara devuelve None."""
    pc = _palabras(nombre)
    if not pc:
        return None
    exacta = next((c for c in carpetas if re.sub(r'[^A-Z0-9]', '', c.upper()) == re.sub(r'[^A-Z0-9]', '', str(nombre).upper())), None)
    if exacta:
        return exacta
    buenas = [(len(pf), c) for c in carpetas for pf in [_palabras(c)] if pf and pf <= pc]
    if buenas:
        return max(buenas, key=lambda x: (x[0], -len(x[1])))[1]
    inversas = [(len(pc), c) for c in carpetas for pf in [_palabras(c)] if pf and pc <= pf]
    return min(inversas, key=lambda x: len(x[1]))[1] if inversas else None


def _raiz_clientes() -> Path | None:
    from app import club
    try:
        raiz = Path(str(club._clientes_root() or '')).expanduser()
        return raiz if raiz.is_dir() else None
    except Exception:  # noqa: BLE001
        return None


def _listar_carpetas(raiz: Path) -> list[str]:
    nombres = [p.name for p in raiz.iterdir() if p.is_dir()]
    _cache_carpetas.update(t=time.time(), nombres=nombres)
    return nombres


_pool_nas = None
_futuro_carpetas = None


def _carpetas_clientes(raiz: Path, espera: float = 6.0) -> list[str] | None:
    """Carpetas de clientes de la NAS. Listar la NAS puede tardar: se hace en segundo plano y si no llega en `espera` segundos devuelve None (el navegador reintenta)."""
    global _pool_nas, _futuro_carpetas
    if _cache_carpetas['nombres'] and time.time() - _cache_carpetas['t'] < CACHE_SEG:
        return _cache_carpetas['nombres']
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as Espera
    if _pool_nas is None:
        _pool_nas = ThreadPoolExecutor(max_workers=1, thread_name_prefix='pedido-nas')
    if _futuro_carpetas is None or _futuro_carpetas.done():
        _futuro_carpetas = _pool_nas.submit(_listar_carpetas, raiz)
    try:
        return _futuro_carpetas.result(timeout=espera)
    except Espera:
        return None
    except OSError:
        return []


def proyectos_de_cliente(nombre: str) -> dict:
    """Nombres de las carpetas de proyecto dentro de CLIENTE/MAESTROS en la NAS. Solo lectura, con caché de 5 minutos (la NAS es lenta).
    Primero prueba la carpeta con el nombre exacto del cliente (rápido); si no existe, busca la más parecida entre las carpetas de clientes."""
    clave = re.sub(r'[^A-Z0-9]', '', str(nombre or '').upper())
    ahora = time.time()
    hit = _cache_proyectos.get(clave)
    if hit and ahora - hit[0] < CACHE_SEG:
        return hit[1]
    raiz = _raiz_clientes()
    resultado = {'carpeta': None, 'proyectos': []}
    if raiz is not None:
        try:
            carpeta = None
            for cand in dict.fromkeys([str(nombre).strip(), str(nombre).replace('.', '').strip(), re.sub(r'\s+', ' ', str(nombre)).strip()]):
                if cand and (raiz / cand).is_dir():
                    carpeta = cand
                    break
            if carpeta is None:
                carpetas = _carpetas_clientes(raiz)
                if carpetas is None:
                    return {'carpeta': None, 'proyectos': [], 'pendiente': True}   # la NAS aún está listando: no se guarda en caché
                carpeta = carpeta_de_cliente(nombre, carpetas)
            if carpeta:
                resultado['carpeta'] = carpeta
                maestros = next((p for p in (raiz / carpeta).iterdir() if p.is_dir() and p.name.strip().upper() == 'MAESTROS'), None)
                if maestros is not None:
                    resultado['proyectos'] = sorted((p.name for p in maestros.iterdir() if p.is_dir() and not p.name.startswith('.')), key=lambda n: n.upper())
        except OSError:
            return {'carpeta': None, 'proyectos': [], 'error': 'No pude leer la NAS ahora'}
    _cache_proyectos[clave] = (ahora, resultado)
    return resultado


@router.get('/referencias-cliente')
def referencias_cliente(request: Request, cliente: str = ''):
    """Referencias que este cliente ya tuvo programadas (para elegir la del pedido sin tener que saberla de memoria)."""
    _usuario(request)
    import json
    clave = re.sub(r'\s+', ' ', (cliente or '')).strip().upper()
    if len(clave) < 3:
        return {'referencias': []}
    try:
        ruta = Path(os.getenv('PEDIDO_EFFI_EXCEL_DIR', '/data/state/pedido_effi_excel')) / '_programados.json'
        programados = json.loads(ruta.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        programados = []
    cuenta: dict = {}
    for x in programados:
        if re.sub(r'\s+', ' ', str(x.get('cliente') or '')).strip().upper() != clave:
            continue
        for ref in x.get('referencias') or []:
            r = str(ref).strip().upper()
            if not r:
                continue
            c = cuenta.setdefault(r, {'referencia': r, 'veces': 0, 'ultimo_proyecto': '', 'ultima_fecha': ''})
            c['veces'] += 1
            if str(x.get('fecha') or '') >= c['ultima_fecha']:
                c['ultima_fecha'] = str(x.get('fecha') or '')
                c['ultimo_proyecto'] = str(x.get('proyecto') or '')
    lista = sorted(cuenta.values(), key=lambda c: (-c['veces'], c['referencia']))
    return {'referencias': lista}


@router.get('/proyectos')
def proyectos(request: Request, cliente: str = ''):
    """Proyectos que ya existen en la carpeta MAESTROS de la NAS del cliente (para la lista desplegable del campo Proyecto)."""
    _usuario(request)
    if len((cliente or '').strip()) < 3:
        return {'carpeta': None, 'proyectos': []}
    return proyectos_de_cliente(cliente)

# ---------------------------------------------------------------- Mockups de un proyecto (CLIENTE/MAESTROS/PROYECTO/REFERENCIA_D1_D2/REFERENCIA_D1_MAQUINA.jpg)
EXT_IMAGEN = {'.jpg', '.jpeg', '.png', '.webp'}


def _plano_ref(texto: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', str(texto or '').upper())


def referencias_base(ref: str) -> list[str]:
    """«A200FUT01» -> ['FUT01'] (se quita el código de tela); «A100CA02-A100PT01» -> ['CA02', 'PT01']."""
    from app import promedios
    partes = promedios.partes_de_hoja(str(ref or '').strip().upper().replace(' ', ''))
    return [_plano_ref(p) for p in partes if _plano_ref(p)]


def _dir_proyecto(cliente: str, proyecto: str) -> tuple[Path, str] | None:
    """(carpeta del proyecto, nombre de la carpeta del cliente) o None. Solo carpetas reales dentro de CLIENTE/MAESTROS: sin rutas de otro lado."""
    info = proyectos_de_cliente(cliente)
    raiz = _raiz_clientes()
    if raiz is None or not info.get('carpeta') or proyecto not in info.get('proyectos', []):
        return None
    base = raiz / info['carpeta']
    maestros = next((p for p in base.iterdir() if p.is_dir() and p.name.strip().upper() == 'MAESTROS'), None)
    if maestros is None:
        return None
    destino = maestros / proyecto
    try:
        destino.resolve().relative_to(maestros.resolve())
    except ValueError:
        return None
    return (destino, info['carpeta']) if destino.is_dir() else None


def _mockups_en(carpeta_proyecto: Path, bases: list[str], proyecto: str) -> list[dict]:
    items = []
    for sub in sorted((p for p in carpeta_proyecto.iterdir() if p.is_dir() and 'MUESTRA' not in p.name.upper()), key=lambda p: p.name.upper()):   # las MUESTRAS no son mockups del maestro
        nombre = _plano_ref(sub.name)
        base = next((b for b in bases if nombre.startswith(b)), None)
        if not base:
            continue
        for f in sorted((x for x in sub.iterdir() if x.is_file() and x.suffix.lower() == '.jpg'), key=lambda x: x.name.upper()):
            m = re.match(r'^\s*' + re.escape(base) + r'[\s_-]*D\s*(\d+)', f.name, re.I)
            if m:
                items.append({'ref': base, 'diseno': int(m.group(1)), 'carpeta': sub.name, 'archivo': f.name, 'proyecto': proyecto})
    items.sort(key=lambda i: (i['ref'], i['diseno'], i['archivo'].upper()))
    return items


def mockups_de(cliente: str, proyecto: str, ref: str) -> dict:
    """Imágenes (JPG de impresión: REFERENCIA_Dn_MAQUINA.jpg) de las carpetas de esa referencia dentro del proyecto. Solo lectura.
    SOLO del proyecto elegido: si no las tiene, no se muestran las de otro proyecto (se pueden subir con SUBIR MOCKUP)."""
    ubicado = _dir_proyecto(cliente, proyecto)
    if ubicado is None:
        return {'items': [], 'motivo': 'El proyecto no está en la carpeta MAESTROS del cliente.'}
    carpeta_proyecto, _ = ubicado
    bases = referencias_base(ref)
    try:
        items = _mockups_en(carpeta_proyecto, bases, proyecto)
        if items:
            return {'items': items, 'motivo': '', 'otro_proyecto': ''}
    except OSError:
        return {'items': [], 'motivo': 'No pude leer la NAS ahora.'}
    return {'items': [], 'motivo': 'El proyecto ' + proyecto + ' no tiene mockups de la referencia ' + ', '.join(bases) + '. Puedes subirlos con SUBIR MOCKUP.', 'otro_proyecto': ''}


@router.get('/mockups')
def mockups(request: Request, cliente: str = '', proyecto: str = '', ref: str = ''):
    """Lista de mockups del proyecto del cliente para la referencia elegida (para la vista previa del pedido)."""
    _usuario(request)
    if len(cliente.strip()) < 3 or not proyecto.strip() or not ref.strip():
        raise HTTPException(400, 'Faltan el cliente, el proyecto o la referencia')
    return mockups_de(cliente, proyecto, ref)


_cache_mockups_proyecto: dict = {}   # (cliente, proyecto) -> (momento, respuesta): la NAS es lenta, se reutiliza 5 min


@router.get('/mockups-proyecto')
def mockups_proyecto(request: Request, cliente: str = '', proyecto: str = ''):
    """Todos los mockups del proyecto (sin elegir referencia): para verlos en el listado antes de tener referencias."""
    _usuario(request)
    if len(cliente.strip()) < 3 or not proyecto.strip():
        raise HTTPException(400, 'Faltan el cliente o el proyecto')
    clave_cache = (cliente.strip().upper(), proyecto.strip().upper())
    hit = _cache_mockups_proyecto.get(clave_cache)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    ubicado = _dir_proyecto(cliente, proyecto)
    if ubicado is None:
        return {'items': [], 'motivo': 'El proyecto no está en la carpeta MAESTROS del cliente.'}
    carpeta_proyecto, _ = ubicado
    items = []
    try:
        for sub in sorted((p for p in carpeta_proyecto.iterdir() if p.is_dir() and 'MUESTRA' not in p.name.upper()), key=lambda p: p.name.upper()):   # las MUESTRAS no son mockups del maestro
            for f in sorted((x for x in sub.iterdir() if x.is_file() and x.suffix.lower() == '.jpg'), key=lambda x: x.name.upper()):
                if re.search(r'[0-9A-F]{8}-[0-9A-F]{4}-', f.name, re.I):   # nombres generados (UUID), no mockups
                    continue
                m = re.match(r'^\s*(.+?)[\s_-]*D\s*(\d+)(?=[\s_.-]|$)', f.name, re.I)
                if m:
                    items.append({'ref': _plano_ref(m.group(1)), 'diseno': int(m.group(2)), 'carpeta': sub.name, 'archivo': f.name, 'proyecto': proyecto})
    except OSError:
        return {'items': [], 'motivo': 'No pude leer la NAS ahora.'}
    items.sort(key=lambda i: (i['ref'], i['diseno'], i['archivo'].upper()))
    respuesta = {'items': items[:400], 'motivo': ''}
    _cache_mockups_proyecto[clave_cache] = (time.time(), respuesta)
    return respuesta


def ruta_mockup(cliente: str, proyecto: str, carpeta: str, archivo: str) -> Path:
    """Ruta (validada) de un mockup dentro de MAESTROS: para copiarlo idéntico a la carpeta de la orden."""
    if any(x in (carpeta + archivo) for x in ('/', '\\', '..')) or Path(archivo).suffix.lower() not in EXT_IMAGEN:
        raise ValueError('Archivo no válido')
    ubicado = _dir_proyecto(cliente, proyecto)
    if ubicado is None:
        raise FileNotFoundError('No existe ese proyecto')
    ruta = ubicado[0] / carpeta / archivo
    ruta.resolve().relative_to(ubicado[0].resolve())
    if not ruta.is_file():
        raise FileNotFoundError('No existe esa imagen')
    return ruta


@router.get('/mockup-img')
def mockup_img(request: Request, cliente: str = '', proyecto: str = '', carpeta: str = '', archivo: str = ''):
    from fastapi.responses import FileResponse
    _usuario(request)
    if any(x in (carpeta + archivo) for x in ('/', '\\', '..')) or Path(archivo).suffix.lower() not in EXT_IMAGEN:
        raise HTTPException(400, 'Archivo no válido')
    ubicado = _dir_proyecto(cliente, proyecto)
    if ubicado is None:
        raise HTTPException(404, 'No existe ese proyecto')
    ruta = ubicado[0] / carpeta / archivo
    try:
        ruta.resolve().relative_to(ubicado[0].resolve())
    except ValueError:
        raise HTTPException(400, 'Archivo no válido')
    if not ruta.is_file():
        raise HTTPException(404, 'No existe esa imagen')
    return FileResponse(ruta, headers={'Cache-Control': 'private, max-age=300'})

# ---------------------------------------------------------------- El MISMO PDF que genera Effi (lo baja EFFITRON con su sesión web)
@router.get('/pdf-estado/{numero}')
def pdf_estado(request: Request, numero: int):
    """Pide el PDF de la cotización a EFFITRON (la primera vez) y dice cómo va. Para remisiones no hay PDF por esta vía."""
    _usuario(request)
    from app import effitron
    r = effitron.solicitar_pdf_cotizacion(numero)
    if r.get('estado') == 'listo':
        r['paginas'] = paginas_pdf(numero)
    return r


def paginas_pdf(numero: int) -> int:
    from app import effitron
    import pdfplumber
    ruta = effitron.pdf_cotizacion_ruta(numero)
    try:
        with pdfplumber.open(str(ruta)) as pdf:
            return len(pdf.pages)
    except Exception:  # noqa: BLE001
        return 1


@router.get('/pdf-img/{numero}/{pagina}')
def pdf_imagen(request: Request, numero: int, pagina: int):
    """Cada página del PDF de Effi como imagen: se ve igual en cualquier navegador y en el celular (sin visor de PDF ni marcos bloqueados)."""
    from fastapi.responses import FileResponse
    _usuario(request)
    from app import effitron
    import pdfplumber
    ruta = effitron.pdf_cotizacion_ruta(numero)
    if not ruta.is_file():
        raise HTTPException(404, 'El PDF de Effi todavía no está listo')
    png = ruta.with_name(f'{ruta.stem}-p{int(pagina)}-n250.png')   # 250 dpi: nítido también en pantallas de alta densidad (el de 150 dpi se veía borroso)
    if not png.is_file() or png.stat().st_mtime < ruta.stat().st_mtime:
        with pdfplumber.open(str(ruta)) as pdf:
            if not 1 <= pagina <= len(pdf.pages):
                raise HTTPException(404, 'Esa página no existe')
            pdf.pages[pagina - 1].to_image(resolution=250).original.convert('RGB').save(png, 'PNG', optimize=True)
    return FileResponse(png, media_type='image/png', headers={'Cache-Control': 'private, max-age=300'})


@router.get('/pdf/{numero}')
def pdf_cotizacion(request: Request, numero: int, descargar: int = 0):
    from fastapi.responses import Response
    _usuario(request)
    from app import effitron
    datos = effitron.pdf_cotizacion_bytes(numero)
    if not datos:
        raise HTTPException(404, 'El PDF de Effi todavía no está listo')
    return Response(datos, media_type='application/pdf', headers={'Content-Disposition': ('attachment' if descargar else 'inline') + f'; filename="Cotizacion_{numero}.pdf"', 'Cache-Control': 'private, max-age=300'})


@router.get('/tela')
def tela_de_referencia(request: Request, ref: str = '', cantidad: float = 0):
    """Tela y promedio general de una referencia (A200FUT01 -> tela 200, maestro FUT01). Solo lectura: Promedios maestros + Bodega."""
    _usuario(request)
    from app import promedios, tela_necesaria
    with promedios._lock:
        datos = promedios._leer()
    maestros = {str(m.get('ref') or '').upper(): m for m in datos.get('maestros') or [] if isinstance(m, dict)}
    materiales = tela_necesaria.materiales_de_referencia(ref, maestros)
    if not materiales:
        return {'encontrado': False, 'referencia': ref, 'materiales': []}
    codigos = tela_necesaria.codigos_de_materiales(ref)
    items = []
    try:
        from app import inventario_api
        items = inventario_api._inventory_payload().get('items') or []
    except Exception:  # noqa: BLE001 - sin Bodega igual se muestra el promedio
        pass
    salida = []
    for i, m in enumerate(materiales):
        codigo = codigos[i] if i < len(codigos) else (codigos[0] if len(codigos) == 1 else '')
        enc = tela_necesaria._telas_de_bodega(items, m.get('tela') or '', {codigo} if codigo else set()) if items else []
        stock = round(sum(sum(float(x) for x in (it.get('roll_values') or [])) for it in enc), 2) if enc else None
        salida.append({'material': m['material'], 'codigo': codigo, 'tela': (enc[0].get('nombre') if enc else '') or m.get('tela') or '',
                       'promedio': m['promedio'], 'requerido': round(m['promedio'] * cantidad, 2) if cantidad else None, 'bodega': stock})
    return {'encontrado': True, 'referencia': ref, 'materiales': salida, 'promedio_total': round(sum(x['promedio'] for x in salida), 2)}
