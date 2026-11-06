"""Asistente de ventas: prepara y crea documentos de venta en Effi.

La interfaz nunca habla con Effi directamente. Primero consulta el catálogo,
después valida el borrador en el servidor y solo el segundo clic confirmado crea
el documento. Así la API key no llega al navegador y un reintento no duplica
la transacción.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import re
import threading
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app import effi_api

router = APIRouter(prefix='/api/ventas-effi', tags=['ventas-effi'])

_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
_llave: Callable[[], str] = lambda: ''
_raiz_clientes: Callable[[], str] = lambda: ''
_inventario: Callable[[], dict] = lambda: {}
_proyectos_cache: dict[str, tuple[float, list[str], str, bool]] = {}
_opciones_cache: tuple[float, dict] | None = None
_catalogo_lock = threading.Lock()
_catalogo: dict = {'estado': 'Sincronización pendiente', 'ejecutando': False, 'error': '', 'actualizado': 0.0,
                   'recurso': '', 'pagina': 0, 'clientes': [], 'articulos': []}

TIPOS = {
    'cotizacion': ('Cotización', 'cotizacion'),
    'orden': ('Orden de venta', 'orden_v'),
    'remision': ('Remisión de venta', 'remision_v'),
}


def configurar(auth: Callable, permitido: Callable[[str], bool], llave: Callable[[], str],
               raiz_clientes: Callable[[], str] = lambda: '', inventario: Callable[[], dict] = lambda: {}) -> None:
    global _auth, _permitido, _llave, _raiz_clientes, _inventario
    _auth, _permitido, _llave, _raiz_clientes, _inventario = auth, permitido, llave, raiz_clientes, inventario


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'VENTAS es solo para el equipo comercial')
    return usuario


def _con_llave() -> None:
    llave = (_llave() or '').strip()
    if llave:
        effi_api.usar_llave(llave)
    if not effi_api.disponible():
        raise HTTPException(409, 'Falta la API key de Effi. Pídela a Indoor Sport en la pestaña API Effi de ZEUS.')


def _texto(valor, largo=255) -> str:
    return re.sub(r'\s+', ' ', str(valor or '')).strip()[:largo]


def _clave(valor: str) -> str:
    """Clave segura para comparar carpetas de NAS sin depender de tildes."""
    import unicodedata
    limpio = ''.join(c for c in unicodedata.normalize('NFD', _texto(valor, 255)) if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]+', '', limpio.upper())


def _carpeta_hija(padre: Path, nombre: str) -> Path | None:
    try:
        # Effi puede devolver “S.A.S.”, mientras la NAS guarda “SAS”. Probar
        # primero ambas rutas directas evita recorrer toda la carpeta CLIENTES.
        for candidato in (nombre, re.sub(r'[^\w\s-]+', '', nombre)):
            directo = padre / candidato
            if directo.is_dir():
                return directo
        return next((p for p in padre.iterdir() if p.is_dir() and _clave(p.name) == _clave(nombre)), None)
    except OSError:
        return None


def _decimal(valor, nombre: str, minimo=Decimal('0')) -> Decimal:
    try:
        numero = Decimal(str(valor).replace(',', '').strip())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f'{nombre} no es válido') from exc
    if numero < minimo:
        raise HTTPException(400, f'{nombre} debe ser mayor que {minimo}')
    return numero


def _redondear(valor: Decimal) -> Decimal:
    return valor.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _precio(articulo: dict) -> Decimal:
    """Los artículos antiguos y los nuevos de Effi devuelven nombres distintos."""
    candidatos = ('p_tarifa_normal', 'p_venta', 'p_tarifa', 'precio_venta')
    for campo in candidatos:
        valor = _decimal(articulo.get(campo) or 0, 'Precio sugerido')
        if valor > 0:
            return valor
    for fila in articulo.get('precios') or []:
        if str(fila.get('tarifa_precio') or fila.get('tarifa') or '') in ('1', 'normal'):
            valor = _decimal(fila.get('p_venta') or fila.get('precio') or 0, 'Precio sugerido')
            if valor > 0:
                return valor
    # El listado de artículos actual de Effi resume las tarifas en un texto,
    # por ejemplo: “Tarifa normal: 45000.0000; Tarifa especial...”.
    tarifa = re.search(r'tarifa\s+normal\s*:\s*([\d.,]+)', str(articulo.get('precios_venta') or ''), re.I)
    if tarifa:
        texto_tarifa = tarifa.group(1)
        if ',' in texto_tarifa and '.' in texto_tarifa:
            texto_tarifa = texto_tarifa.replace('.', '').replace(',', '.')
        else:
            texto_tarifa = texto_tarifa.replace(',', '')
        valor = _decimal(texto_tarifa, 'Precio sugerido')
        if valor > 0:
            return valor
    return Decimal('0')


def _cliente(fila: dict) -> dict:
    direcciones = fila.get('direcciones') or []
    direccion = next((x for x in direcciones if x.get('direccion')), {})
    direcciones_limpias = [
        {'direccion': _texto(x.get('direccion'), 200), 'id_pais': x.get('id_pais') or '',
         'id_provincia': x.get('id_provincia') or '', 'id_ciudad': x.get('id_ciudad') or ''}
        for x in direcciones if x.get('direccion')
    ][:30]
    return {'tercero': str(fila.get('tercero') or fila.get('codigo_tercero') or ''),
            'nombre': _texto(fila.get('nombre') or fila.get('nombre_razon_social'), 120),
            'documento': _texto(fila.get('id') or fila.get('numero'), 30),
            'direccion': _texto(direccion.get('direccion'), 200),
            'id_pais': direccion.get('id_pais') or '', 'id_provincia': direccion.get('id_provincia') or '',
            'id_ciudad': direccion.get('id_ciudad') or '', 'direcciones': direcciones_limpias}


def _articulo(fila: dict) -> dict:
    return {'id': str(fila.get('id') or ''), 'referencia': _texto(fila.get('referencia'), 40),
            'nombre': _texto(fila.get('descripcion') or fila.get('nombre'), 120),
            'precio': float(_precio(fila)), 'impuesto': _texto(fila.get('impuesto'), 255)}


def _filtrar_catalogo(filas: list[dict], q: str, campos: tuple[str, ...], limite: int = 20) -> list[dict]:
    texto = _clave(q)
    if not texto:
        return []
    return [fila for fila in filas if any(texto in _clave(str(fila.get(campo) or '')) for campo in campos)][:limite]


def _leer_catalogo_completo(ruta: str, convertir: Callable[[dict], dict], destino: str) -> list[dict]:
    """Lee páginas de Effi con una pausa deliberada para respetar su límite de API.

    Si la API ignorara el número de página, el conjunto de ids repetido detiene
    la lectura en vez de repetir solicitudes indefinidamente.
    """
    filas, vistos, huellas = [], set(), set()
    for pagina in range(1, 501):
        with _catalogo_lock:
            _catalogo.update(recurso=destino, pagina=pagina, estado=f'Leyendo {destino} · página {pagina}')
        respuesta = effi_api._peticion('GET', ruta, {'por_pagina': 100, 'pagina': pagina})
        datos = respuesta.get('data') or []
        huella = tuple(str(x.get('id') or x.get('tercero') or x.get('codigo_tercero') or '') for x in datos)
        if not datos or huella in huellas:
            break
        huellas.add(huella)
        for fila in datos:
            dato = convertir(fila)
            clave = dato.get('id') or dato.get('tercero')
            if clave and clave not in vistos:
                vistos.add(clave)
                filas.append(dato)
        # Publicar cada página permite buscar de inmediato, sin esperar a que
        # termine un catálogo grande de artículos.
        with _catalogo_lock:
            _catalogo[destino] = list(filas)
        if len(datos) < 100:
            break
        time.sleep(1.15)
    return filas


def _sincronizar_catalogo() -> None:
    try:
        clientes = _leer_catalogo_completo('cliente', _cliente, 'clientes')
        articulos = _leer_catalogo_completo('articulo', _articulo, 'artículos')
        with _catalogo_lock:
            _catalogo.update(estado='Catálogo actualizado', ejecutando=False, error='', actualizado=time.time(),
                             recurso='', pagina=0, clientes=clientes, articulos=articulos)
    except effi_api.EffiError as exc:
        with _catalogo_lock:
            _catalogo.update(estado='No se pudo terminar la sincronización', ejecutando=False, error=str(exc))
    except Exception as exc:  # La interfaz debe seguir utilizable si un catálogo falla.
        with _catalogo_lock:
            _catalogo.update(estado='No se pudo terminar la sincronización', ejecutando=False, error=str(exc))


def _iniciar_catalogo() -> bool:
    with _catalogo_lock:
        if _catalogo['ejecutando']:
            return False
        _catalogo.update(ejecutando=True, estado='Iniciando sincronización…', error='', recurso='', pagina=0)
    threading.Thread(target=_sincronizar_catalogo, name='effi-catalogo-comercial', daemon=True).start()
    return True


@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    return {'api': bool((_llave() or '').strip() or effi_api.disponible()), 'tipos_activos': list(TIPOS)}


@router.get('/catalogo')
def catalogo(request: Request):
    _usuario(request); _con_llave()
    with _catalogo_lock:
        return {clave: _catalogo[clave] for clave in ('estado', 'ejecutando', 'error', 'actualizado', 'recurso', 'pagina')} | {
            'clientes': len(_catalogo['clientes']), 'articulos': len(_catalogo['articulos'])}


@router.post('/catalogo/sincronizar')
def sincronizar_catalogo(request: Request):
    _usuario(request); _con_llave()
    iniciado = _iniciar_catalogo()
    with _catalogo_lock:
        return {'iniciado': iniciado, 'estado': _catalogo['estado'], 'ejecutando': _catalogo['ejecutando']}


@router.get('/clientes')
def clientes(request: Request, q: str = ''):
    _usuario(request); _con_llave()
    q = _texto(q, 80)
    if len(q) < 1:
        return {'clientes': []}
    with _catalogo_lock:
        cache = list(_catalogo['clientes'])
    salida_cache = _filtrar_catalogo(cache, q, ('nombre',), 15)
    if salida_cache:
        return {'clientes': salida_cache, 'origen': 'catálogo local'}
    try:
        # Filtro dinámico solo por nombre o razón social, como lo pidió el
        # equipo comercial; nunca consulta por NIT/documento.
        filas = effi_api._lista('cliente', {'nombre': q})
        vistos, salida = set(), []
        for fila in filas:
            dato = _cliente(fila)
            if dato['tercero'] and dato['tercero'] not in vistos:
                vistos.add(dato['tercero'])
                salida.append(dato)
        return {'clientes': salida[:15]}
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))


@router.get('/proyectos')
def proyectos(request: Request, cliente: str = ''):
    """Proyectos = carpetas directas de MAESTROS del cliente en la NAS.

    Solo se lee el listado de carpetas y se guarda brevemente en caché: nunca
    crea ni modifica archivos del cliente.
    """
    _usuario(request)
    cliente = _texto(cliente, 120)
    if not cliente:
        return {'proyectos': [], 'estado': 'Selecciona primero un cliente.', 'puede_crear': False}
    key, now = _clave(cliente), time.monotonic()
    guardado = _proyectos_cache.get(key)
    if guardado and now - guardado[0] < 120:
        return {'proyectos': guardado[1], 'estado': guardado[2], 'puede_crear': guardado[3]}
    try:
        raiz = Path(_raiz_clientes() or '').resolve()
        if not raiz.is_dir():
            raise OSError
        carpeta_cliente = _carpeta_hija(raiz, cliente)
        if not carpeta_cliente:
            salida, estado, puede_crear = [], 'No encontré una carpeta MAESTROS para este cliente.', False
        else:
            maestros = _carpeta_hija(carpeta_cliente, 'MAESTROS') or _carpeta_hija(carpeta_cliente, 'MAESTRO')
            if not maestros:
                salida, estado, puede_crear = [], 'Este cliente no tiene carpeta MAESTROS.', False
            else:
                salida = sorted((p.name for p in maestros.iterdir() if p.is_dir() and not p.name.startswith(('.', '_', '~'))), key=str.casefold)[:150]
                estado = f'{len(salida)} proyecto(s) disponibles en MAESTROS.' if salida else 'La carpeta MAESTROS no tiene proyectos visibles.'
                puede_crear = True
    except OSError:
        salida, estado, puede_crear = [], 'La NAS no está disponible para consultar los proyectos.', False
    _proyectos_cache[key] = (now, salida, estado, puede_crear)
    return {'proyectos': salida, 'estado': estado, 'puede_crear': puede_crear}


@router.post('/proyectos')
def crear_proyecto(request: Request, payload: dict):
    """Crea una carpeta directa dentro de MAESTROS del cliente seleccionado."""
    _usuario(request)
    cliente = _texto((payload or {}).get('cliente'), 120)
    proyecto = _texto((payload or {}).get('proyecto'), 100)
    if not cliente:
        raise HTTPException(status_code=400, detail='Selecciona un cliente.')
    if not proyecto:
        raise HTTPException(status_code=400, detail='Escribe el nombre del nuevo proyecto.')
    if proyecto in {'.', '..'} or any(char in proyecto for char in '<>:"/\\|?*'):
        raise HTTPException(status_code=400, detail='El nombre contiene caracteres no permitidos.')
    try:
        raiz = Path(_raiz_clientes() or '').resolve()
        if not raiz.is_dir():
            raise OSError('La carpeta de clientes no está disponible')
        carpeta_cliente = _carpeta_hija(raiz, cliente)
        if not carpeta_cliente:
            raise HTTPException(status_code=404, detail='No encontré la carpeta de este cliente en la NAS.')
        maestros = _carpeta_hija(carpeta_cliente, 'MAESTROS') or _carpeta_hija(carpeta_cliente, 'MAESTRO')
        if not maestros:
            raise HTTPException(status_code=404, detail='Este cliente no tiene carpeta MAESTROS.')
        destino = (maestros / proyecto).resolve()
        if maestros.resolve() not in destino.parents:
            raise HTTPException(status_code=400, detail='Ruta de proyecto inválida.')
        creado = False
        try:
            destino.mkdir()
            creado = True
        except FileExistsError:
            if not destino.is_dir():
                raise HTTPException(status_code=409, detail='Ya existe un archivo con ese nombre en MAESTROS.')
        nombres = sorted(
            (item.name for item in maestros.iterdir() if item.is_dir() and not item.name.startswith(('.', '_', '~'))),
            key=str.casefold,
        )[:150]
        _proyectos_cache.pop(_clave(cliente), None)
        return {'ok': True, 'creado': creado, 'proyecto': destino.name, 'proyectos': nombres}
    except OSError as exc:
        raise HTTPException(status_code=503, detail='No fue posible crear la carpeta en la NAS.') from exc


@router.get('/stock-tela')
def stock_tela(request: Request, referencia: str = ''):
    """Devuelve las telas y metros del inventario que corresponden a los códigos de una REF."""
    _usuario(request)
    return _stock_de(referencia)


def _stock_de(referencia: str) -> dict:
    referencia = _texto(referencia, 120).upper()
    # A100CA01 y A100-11400CA02F se traducen a los códigos 100, 100 y 11400.
    codigos = []
    for grupo in re.findall(r'A(\d+(?:-\d+)*)(?=[A-Z]{1,5}\d{2,3})', referencia):
        for codigo in grupo.split('-'):
            if codigo not in codigos:
                codigos.append(codigo)
    if not codigos:
        return {'referencia': referencia, 'codigos': [], 'telas': [], 'mts_total': 0, 'estado': 'Escribe una referencia válida para consultar tela.'}
    try:
        items = (_inventario() or {}).get('items') or []
    except Exception:  # La consulta de stock es ayuda visual; no bloquea la venta.
        items = []
    telas = []
    for codigo in codigos:
        encontrados = [i for i in items if str(i.get('categoria') or '').upper() == 'BODEGA TELA'
                       and re.match(r'^\s*\(' + re.escape(codigo) + r'\)\s*', str(i.get('nombre') or ''))]
        for item in encontrados:
            telas.append({'codigo': codigo, 'nombre': _texto(item.get('nombre'), 120),
                          'mts': round(float(item.get('mts') or item.get('total') or 0), 2),
                          'rollos': len(item.get('roll_values') or [])})
    total = round(sum(x['mts'] for x in telas), 2)
    estado = f'{len(telas)} tela(s) · {total:g} mts disponibles' if telas else 'No encontré tela asociada a los códigos de esta referencia.'
    return {'referencia': referencia, 'codigos': codigos, 'telas': telas, 'mts_total': total, 'estado': estado}


@router.get('/articulos')
def articulos(request: Request, q: str = ''):
    _usuario(request); _con_llave()
    q = _texto(q, 80)
    if len(q) < 1:
        return {'articulos': []}
    with _catalogo_lock:
        cache = list(_catalogo['articulos'])
    salida_cache = _filtrar_catalogo(cache, q, ('id', 'referencia', 'nombre'), 20)
    if salida_cache:
        exactos = [x for x in salida_cache if str(x['id']) == q] if q.isdigit() else []
        return {'articulos': exactos or salida_cache, 'origen': 'catálogo local'}
    try:
        # También admite el ID numérico que muestra Effi, además de la
        # referencia y la descripción.
        filas = effi_api._lista('articulo', {'id': q}) if q.isdigit() else []
        if not filas:
            filas = effi_api._lista('articulo', {'referencia': q})
        if not filas:
            filas = effi_api._lista('articulo', {'descripcion': q})
        salida = [_articulo(x) for x in filas if x.get('id')]
        if q.isdigit():
            exactos = [x for x in salida if str(x['id']) == q]
            if exactos:
                salida = exactos
        return {'articulos': salida[:20]}
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))


@router.get('/terceros')
def terceros(request: Request, q: str = ''):
    """Busca el tercero multipropósito por nombre, igual que el selector de Effi."""
    _usuario(request); _con_llave()
    q = _texto(q, 80)
    if not q:
        return {'terceros': []}
    try:
        filas = effi_api._lista('tercero', {'nombre': q})
        vistos, salida = set(), []
        for fila in filas:
            codigo = str(fila.get('tercero') or fila.get('codigo_tercero') or fila.get('id') or '')
            nombre = _texto(fila.get('nombre') or fila.get('nombre_razon_social') or fila.get('descripcion'), 120)
            if codigo and codigo not in vistos:
                vistos.add(codigo)
                salida.append({'tercero': codigo, 'nombre': nombre,
                               'documento': _texto(fila.get('id') or fila.get('numero'), 30)})
        return {'terceros': salida[:20]}
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))


@router.get('/opciones')
def opciones(request: Request):
    _usuario(request); _con_llave()
    global _opciones_cache
    ahora = time.monotonic()
    if _opciones_cache and ahora - _opciones_cache[0] < 300:
        return _opciones_cache[1]
    try:
        formas = effi_api._lista('forma_pago')
        sucursales = effi_api._lista('sucursal')
        # Effi muestra todas las bodegas disponibles en la cotización. No se
        # filtra por sucursal aquí, porque ocultaría bodegas válidas como
        # Materia Prima, Punto de venta PT, Tela o Insumos.
        bodegas = effi_api._lista('bodega')
        centros = effi_api._lista('centro_costos')
        impuestos = effi_api._lista('impuesto')
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))
    # Vendedor y ubicación no son obligatorios en todas las empresas. Si la
    # configuración de Effi no los usa, se deja el desplegable vacío sin
    # impedir la creación del documento.
    try:
        vendedores = effi_api._lista('empleado')
    except effi_api.EffiError:
        vendedores = []
    try:
        # Igual que en el selector del ERP: se entregan todas las ubicaciones
        # autorizadas para la empresa y el usuario de la API key.
        ubicaciones = effi_api._lista('ubicacion_venta')
    except effi_api.EffiError:
        ubicaciones = []
    try:
        retenciones = effi_api._lista('retencion')
    except effi_api.EffiError:
        retenciones = []
    plano = lambda x: {'id': x.get('id') or x.get('tercero'), 'nombre': _texto(x.get('nombre') or x.get('descripcion') or x.get('nombre_razon_social'), 80), 'dias': x.get('dias')}
    plano_impuesto = lambda x: {'id': x.get('id'), 'nombre': _texto(x.get('etiqueta') or x.get('nombre') or x.get('descripcion'), 80),
                                'valor': x.get('valor') or 0, 'tipo_calculo': _texto(x.get('tipo_calculo'), 40)}
    plano_retencion = lambda x: {**plano_impuesto(x), 'base': x.get('base') or 0,
                                 'base_excluida': x.get('base_excluida') or 0, 'base_maxima': x.get('base_maxima') or 0,
                                 'etiqueta': _texto(x.get('etiqueta'), 80), 'detalle': _texto(x.get('nombre'), 160)}
    respuesta = {'formas_pago': [plano(x) for x in formas if x.get('id')], 'sucursales': [plano(x) for x in sucursales if x.get('id')],
                 'bodegas': [plano(x) for x in bodegas if x.get('id')], 'centros_costos': [plano(x) for x in centros if x.get('id')],
                 'vendedores': [plano(x) for x in vendedores if x.get('id') or x.get('tercero')], 'ubicaciones': [plano(x) for x in ubicaciones if x.get('id')],
                 'impuestos': [plano_impuesto(x) for x in impuestos if x.get('id')],
                 'retenciones': [plano_retencion(x) for x in retenciones if x.get('id')]}
    _opciones_cache = (ahora, respuesta)
    return respuesta


# Estados de cada documento según Effi (filtros est_cotizacion / est_remision_v).
_ESTADOS = {
    'cotizacion': ('est_cotizacion', {1: 'Pendiente de venta', 2: 'Convertida a orden', 3: 'Convertida a remisión', 4: 'Convertida a factura'}),
    'remision': ('est_remision_v', {1: 'Pendiente de facturar', 2: 'Facturada'}),
}
_DOCUMENTOS_POR_PAGINA = 50
_documentos_cache: dict[tuple[str, int], tuple[float, dict]] = {}


def _primero(fila: dict, *claves: str):
    for clave in claves:
        valor = fila.get(clave)
        if valor not in (None, ''):
            return valor
    return ''


def _entero(valor) -> int | None:
    try:
        return int(float(str(valor).strip()))
    except (TypeError, ValueError):
        return None


def _cifra(valor) -> float:
    try:
        return float(str(valor).replace(',', '').strip() or 0)
    except ValueError:
        return 0.0


def _nombre(fila: dict, base: str) -> str:
    """Effi pone el nombre junto al id de cada tabla; se prueban las formas que usa."""
    for clave in (f'nombre_{base}', f'{base}_nombre', f'nombre_razon_social_{base}', f'descripcion_{base}'):
        if fila.get(clave):
            return _texto(fila[clave], 160)
    valor = fila.get(base)
    if isinstance(valor, dict):
        return _texto(valor.get('nombre') or valor.get('nombre_razon_social') or valor.get('descripcion'), 160)
    if valor not in (None, '') and _entero(valor) is None:
        return _texto(valor, 160)
    return ''


def _conceptos(fila: dict) -> list[dict]:
    """Artículos de la cotización o remisión, si Effi los entrega en el listado."""
    lista = fila.get('conceptos') or fila.get('articulos') or fila.get('detalle') or []
    return [c for c in lista if isinstance(c, dict)] if isinstance(lista, list) else []


def _archivo_conceptos() -> Path:
    return Path(os.getenv('CARTERA_STATE_DIR', '/data/state')) / 'ventas_conceptos.json'


def _leer_conceptos() -> dict:
    try:
        return json.loads(_archivo_conceptos().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _guardar_conceptos(payload: dict, data: dict, tipo: str) -> None:
    """Guarda referencia y cantidad de un documento creado desde el panel (Effi no las entrega en el listado)."""
    id_doc = str(data.get('id') or '')
    if not id_doc:
        return
    arts = [x for x in (payload.get('articulos') or []) if isinstance(x, dict)]
    refs = [_texto(x.get('referencia') or x.get('descripcion'), 40) for x in arts]
    cantidad = sum(_cifra(x.get('cantidad')) for x in arts)
    datos = _leer_conceptos()
    datos[f"{tipo}:{_texto(payload.get('sucursal'), 10)}:{id_doc}"] = {
        'referencia': ', '.join(dict.fromkeys(r for r in refs if r)), 'cantidad': cantidad}
    archivo = _archivo_conceptos()
    archivo.parent.mkdir(parents=True, exist_ok=True)
    temporal = archivo.with_suffix('.tmp')
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    temporal.replace(archivo)


def _cifra(valor) -> float:
    try:
        return float(str(valor or 0).replace(',', ''))
    except ValueError:
        return 0.0


# ---------- Referencia y cantidad desde el PDF de la cotización (lo lee el agente de Effi con su sesión) ----------
_FILA_PDF = re.compile(r'^\d+\s+(\S+)\s+(.*?)\s+(\d+)\s+\$', re.M)


def leer_referencia_cantidad(texto: str) -> dict:
    """Saca las columnas REF. y CANT. de las filas de artículos del PDF de una cotización de Effi."""
    filas = _FILA_PDF.findall(texto or '')
    refs = list(dict.fromkeys(r for r in (ref.strip().upper() for ref, _, _ in filas) if re.match(r'[A-Z]', r)))
    cantidad = sum(int(cant) for _, _, cant in filas)
    return {'referencia': ', '.join(refs), 'cantidad': cantidad, 'filas': len(filas)}


def _agente_autorizado(request: Request) -> None:
    """Solo el agente de Effi, con su token (VENTAS_AGENT_TOKEN en el .env). Sin token configurado, se niega."""
    esperado = os.getenv('VENTAS_AGENT_TOKEN', '').strip()
    if not esperado:
        raise HTTPException(503, 'El agente de Ventas no está configurado en el servidor.')
    recibido = (request.headers.get('authorization') or '').replace('Bearer ', '', 1).strip()
    if not hmac.compare_digest(recibido, esperado):
        raise HTTPException(401, 'Token de agente no válido.')


@router.get('/agente/pendientes')
def agente_pendientes(request: Request, limite: int = 20):
    """Cotizaciones recientes de Effi cuya referencia y cantidad aún no se conocen."""
    _agente_autorizado(request); _con_llave()
    registro = _leer_conceptos()
    pendientes = []
    try:
        for pagina in (1, 2):
            datos = effi_api._peticion('GET', 'cotizacion', {'por_pagina': 50, 'pagina': pagina}).get('data') or []
            for fila in datos:
                if not isinstance(fila, dict):
                    continue
                clave = f"cotizacion:{_texto(fila.get('sucursal'), 10)}:{fila.get('id')}"
                if fila.get('id') and (clave not in registro or not (_carpeta_pdfs() / f"{fila.get('id')}.pdf").is_file()):
                    pendientes.append({'tipo': 'cotizacion', 'sucursal': _texto(fila.get('sucursal'), 10), 'id': str(fila.get('id')),
                                       'numero': _texto(fila.get('id_transaccion') or fila.get('id'), 20)})
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))
    return {'pendientes': pendientes[:max(1, min(limite, 50))]}


def _carpeta_pdfs() -> Path:
    return Path(os.getenv('CARTERA_STATE_DIR', '/data/state')) / 'cartera_pdfs'


@router.post('/agente/pdf')
def agente_pdf(request: Request, payload: dict):
    """El agente de Effi manda el PDF (base64) de una cotización para que «Ver PDF» lo abra."""
    _agente_autorizado(request)
    id_doc = _texto((payload or {}).get('id'), 20)
    if not re.fullmatch(r'\d{1,12}', id_doc):
        raise HTTPException(400, 'Número de documento no válido.')
    try:
        datos = base64.b64decode(str((payload or {}).get('pdf') or ''), validate=True)
    except ValueError:
        raise HTTPException(400, 'PDF no válido.')
    if datos[:4] != b'%PDF' or len(datos) > 15_000_000:
        raise HTTPException(400, 'El archivo no es un PDF válido.')
    carpeta = _carpeta_pdfs()
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / f'{id_doc}.pdf'
    temporal = destino.with_suffix('.tmp')
    temporal.write_bytes(datos)
    temporal.replace(destino)
    return {'ok': True}


@router.post('/agente/conceptos')
def agente_guardar(request: Request, payload: dict):
    """El agente manda la referencia y la cantidad que leyó del PDF de una cotización."""
    _agente_autorizado(request)
    tipo = _texto((payload or {}).get('tipo'), 20).lower()
    sucursal = _texto((payload or {}).get('sucursal'), 10)
    id_doc = _texto((payload or {}).get('id'), 20)
    if tipo not in _ESTADOS or not sucursal or not re.fullmatch(r'\d{1,12}', id_doc):
        raise HTTPException(400, 'Datos del documento no válidos.')
    try:
        referencia = _texto((payload or {}).get('referencia'), 200)
        cantidad = int(float((payload or {}).get('cantidad') or 0))
    except (TypeError, ValueError):
        raise HTTPException(400, 'Cantidad no válida.')
    datos = _leer_conceptos()
    datos[f'{tipo}:{sucursal}:{id_doc}'] = {'referencia': referencia, 'cantidad': cantidad}
    archivo = _archivo_conceptos()
    archivo.parent.mkdir(parents=True, exist_ok=True)
    temporal = archivo.with_suffix('.tmp')
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    temporal.replace(archivo)
    return {'ok': True}


def _documento(fila: dict, tipo: str, guardados: dict | None = None) -> dict:
    campo_estado, nombres = _ESTADOS[tipo]
    estado_id = _entero(_primero(fila, campo_estado, f'id_{campo_estado}'))
    vigencia = str(_primero(fila, 'vigente', 'vigencia')).strip().lower()
    numero = _primero(fila, 'id_transaccion') or '-'.join(x for x in (str(fila.get('prefijo') or ''), str(fila.get('id') or '')) if x)
    # Todo lo que Effi entrega como texto o número se muestra en «Ver toda la información».
    campos = {}
    for clave, valor in fila.items():
        if isinstance(valor, (str, int, float)) and str(valor).strip() and len(campos) < 120:
            campos[str(clave)[:60]] = _texto(valor, 300)
    return {
        'id': str(fila.get('id') or ''), 'numero': _texto(numero, 40),
        'sucursal': _nombre(fila, 'sucursal') or _texto(fila.get('sucursal'), 40),
        'fecha': _texto(_primero(fila, 'fecha_trans', 'fecha_creacion', 'fecha'), 19),
        'entrega': _texto(_primero(fila, 'fecha_entrega'), 19),
        'cliente': _nombre(fila, 'cliente'), 'vendedor': _nombre(fila, 'vendedor'),
        'bodega': _nombre(fila, 'bodega'), 'centro_costos': _nombre(fila, 'centro_costos'),
        'forma_pago': _nombre(fila, 'forma_pago'),
        'proyecto': _texto(_primero(fila, 'garantia'), 160),
        'observacion': _texto(_primero(fila, 'observacion'), 300),
        'responsable': _texto(_primero(fila, 'responsable'), 80),
        'total': _cifra(_primero(fila, 'total')), 'subtotal': _cifra(_primero(fila, 'subtotal')),
        'impuestos': _cifra(_primero(fila, 'impuestos', 'impuesto')), 'descuento': _cifra(_primero(fila, 'descuento')),
        'saldo': _cifra(_primero(fila, 'pdte_cobro')),
        'referencia': ', '.join(dict.fromkeys(_texto(c.get('referencia') or c.get('descripcion'), 40) for c in _conceptos(fila) if _texto(c.get('referencia') or c.get('descripcion'), 40))) or (guardados or {}).get('referencia', ''),
        'cantidad': sum(_cifra(c.get('cantidad')) for c in _conceptos(fila)) or (guardados or {}).get('cantidad', 0),
        'estado_id': estado_id, 'estado': _nombre(fila, campo_estado) or nombres.get(estado_id or 0, ''),
        'vigente': vigencia not in ('0', 'no', 'false', 'anulada', 'anulado'),
        'campos': campos,
    }


@router.get('/documentos')
def documentos(request: Request, tipo: str = 'cotizacion', pagina: int = 1):
    """Cotizaciones o remisiones ya creadas en Effi, de la más reciente a la más antigua."""
    _usuario(request); _con_llave()
    tipo = _texto(tipo, 20).lower()
    if tipo not in _ESTADOS:
        raise HTTPException(400, 'Solo se pueden consultar cotizaciones o remisiones.')
    pagina = max(1, min(int(pagina or 1), 200))
    ahora = time.monotonic()
    guardado = _documentos_cache.get((tipo, pagina))
    if guardado and ahora - guardado[0] < 60:   # un minuto: respeta el límite de peticiones de Effi
        return guardado[1]
    try:
        respuesta = effi_api._peticion('GET', TIPOS[tipo][1], {'por_pagina': _DOCUMENTOS_POR_PAGINA, 'pagina': pagina})
    except effi_api.EffiError as exc:
        raise HTTPException(502, str(exc))
    filas = [f for f in (respuesta.get('data') or []) if isinstance(f, dict)]
    registro = _leer_conceptos()
    salida = {'tipo': tipo, 'pagina': pagina,
              'documentos': [_documento(f, tipo, registro.get(f"{tipo}:{_texto(f.get('sucursal'), 10)}:{f.get('id')}")) for f in filas],
              'hay_mas': len(filas) >= _DOCUMENTOS_POR_PAGINA}
    _documentos_cache[(tipo, pagina)] = (ahora, salida)
    return salida


@router.post('/requerimiento-tela')
def requerimiento_tela(request: Request, payload: dict):
    """El comercial pide la tela que no alcanza: el servidor recalcula lo que falta (no confía en el navegador) y deja la compra al agente de inventario."""
    usuario = _usuario(request)
    referencia = _texto(payload.get('referencia'), 120)
    try:
        cantidad = float(payload.get('cantidad') or 0)
    except (TypeError, ValueError):
        cantidad = 0.0
    if not referencia or cantidad <= 0:
        raise HTTPException(400, 'Falta la referencia o la cantidad.')
    stock = _stock_de(referencia)
    por_unidad = float(_consumo_de(referencia).get('mts_por_unidad') or 0)
    if por_unidad <= 0:
        raise HTTPException(400, 'Esa referencia no tiene consumo en Promedios: no puedo calcular cuánta tela falta.')
    telas = stock.get('telas') or []
    if not telas:
        raise HTTPException(400, 'No encontré la tela de esta referencia en Bodega: pídela directamente a Inventarios.')
    codigo = str(payload.get('codigo') or '')
    if codigo not in (stock.get('codigos') or []):
        codigo = str(telas[0].get('codigo'))
    elegida = next((t for t in telas if str(t.get('codigo')) == codigo), telas[0])
    faltan = round(cantidad * por_unidad - float(stock.get('mts_total') or 0), 2)
    if faltan <= 0:
        raise HTTPException(400, 'La tela ya alcanza: no hace falta pedirla.')
    from app import zeus
    r = zeus.pedir_tela_ventas(usuario, codigo, elegida.get('nombre', ''), faltan, referencia, cantidad,
                               _texto(payload.get('cliente'), 120), _texto(payload.get('proyecto'), 120), _texto(payload.get('fecha_entrega'), 20))
    return {**r, 'faltan': faltan, 'tela': elegida.get('nombre', '')}


@router.get('/consumo')
def consumo(request: Request, referencia: str = ''):
    """Metros de tela que lleva cada unidad de una referencia: el promedio del maestro en Promedios (solo lectura)."""
    _usuario(request)
    return _consumo_de(referencia)


def _consumo_de(referencia: str) -> dict:
    referencia = _texto(referencia, 40)
    if not referencia:
        raise HTTPException(400, 'Escribe la referencia.')
    from app import promedios, tela_necesaria  # importación diferida: evita ciclos con el módulo de tela necesaria
    maestros = {m['ref']: m for m in promedios._leer().get('maestros', [])}
    mts, usados, faltan = tela_necesaria._consumo(referencia, maestros, {})
    return {'referencia': referencia, 'mts_por_unidad': mts, 'maestros': usados, 'faltan': faltan}


@router.get('/pdf')
def pdf_documento(request: Request, numero: str = ''):
    """PDF de una cotización o remisión guardado en Cartera (Effi no entrega el PDF por API). Solo lectura."""
    _usuario(request)
    numero = _texto(numero, 40)
    # Acepta «CO-6247», «CO6247» o «6247». Cartera guarda el PDF solo con el número de Effi («6247.pdf»).
    if not re.fullmatch(r'[A-Za-z]{0,4}-?\d{1,12}', numero):
        raise HTTPException(400, 'Número de documento no válido.')
    solo_numero = re.sub(r'\D', '', numero)
    carpeta = Path(os.getenv('CARTERA_STATE_DIR', '/data/state')) / 'cartera_pdfs'
    for nombre in dict.fromkeys([numero, solo_numero]):
        archivo = carpeta / f'{nombre}.pdf'
        if archivo.is_file():
            return FileResponse(archivo, media_type='application/pdf', filename=f'{numero}.pdf')
    raise HTTPException(404, f'No hay PDF guardado para {numero}. Súbelo en Cartera.')


def _cuerpo(payload: dict, usuario: str) -> tuple[str, dict, dict]:
    tipo = _texto(payload.get('tipo'), 20).lower()
    if tipo not in TIPOS:
        raise HTTPException(400, 'Este tipo de documento todavía no se puede crear desde el asistente.')
    proyecto = _texto(payload.get('proyecto'), 255)
    lineas_producto = _texto(payload.get('lineas_producto'), 1020)
    if not proyecto:
        raise HTTPException(400, 'Escribe el nombre del proyecto.')
    if not lineas_producto:
        raise HTTPException(400, 'Escribe las líneas de producto.')
    try:
        cliente = int(payload.get('cliente') or 0); sucursal = int(payload.get('sucursal') or 0)
        bodega = int(payload.get('bodega') or 0); centro = int(payload.get('centro_costos') or 0); forma = int(payload.get('forma_pago') or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, 'Selecciona cliente, sucursal, bodega, centro de costos y forma de pago.') from exc
    if not all((cliente, sucursal, bodega, centro, forma)):
        raise HTTPException(400, 'Selecciona cliente, sucursal, bodega, centro de costos y forma de pago.')
    fecha = _texto(payload.get('fecha_entrega'), 10)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha):
        raise HTTPException(400, 'Elige una fecha de entrega válida.')
    filas = payload.get('articulos') or []
    if not isinstance(filas, list) or not filas:
        raise HTTPException(400, 'Agrega por lo menos un artículo.')

    try:
        descuento_global = _decimal(payload.get('descuento_global') or 0, 'Descuento global')
        propina = _decimal(payload.get('propina') or 0, 'Propina')
        prontopago = _decimal(payload.get('prontopago') or 0, 'Descuento pronto pago')
    except HTTPException:
        raise
    if descuento_global > 100:
        raise HTTPException(400, 'El descuento global no puede superar el 100 %.')
    if propina < 0 or prontopago < 0:
        raise HTTPException(400, 'Propina y descuento pronto pago no pueden ser negativos.')
    conceptos, impuestos, total, bruto_total, descuento_total = [], {}, Decimal('0'), Decimal('0'), Decimal('0')
    impuestos_empresa = None
    for indice, fila in enumerate(filas, 1):
        try:
            art_id = int(fila.get('id') or 0)
        except (ValueError, TypeError):
            art_id = 0
        if not art_id:
            raise HTTPException(400, f'El artículo de la fila {indice} no es válido.')
        try:
            actual = effi_api.articulo('', str(art_id))
            cantidad = _decimal(fila.get('cantidad'), f'Cantidad de la fila {indice}', Decimal('0.0001'))
            precio = _decimal(fila.get('precio'), f'Precio de la fila {indice}', Decimal('0'))
            descuento = _decimal(fila.get('descuento') or 0, f'Descuento de la fila {indice}', Decimal('0'))
        except effi_api.EffiError as exc:
            raise HTTPException(502, str(exc))
        bruto = cantidad * precio
        descuento += _redondear(bruto * descuento_global / 100)
        if descuento > bruto:
            raise HTTPException(400, f'El descuento de la fila {indice} supera el valor del artículo.')
        base = bruto - descuento
        try:
            impuesto_elegido = fila.get('impuesto_id')
            if str(impuesto_elegido or '').strip():
                if impuestos_empresa is None:
                    impuestos_empresa = {str(x.get('id')): x for x in effi_api._lista('impuesto') if x.get('id')}
                imp = impuestos_empresa.get(str(impuesto_elegido))
                if not imp:
                    raise HTTPException(400, f'El impuesto de la fila {indice} no existe en Effi.')
                imp_lista = [imp]
            else:
                imp_lista = effi_api.impuestos_de(actual.get('impuesto'))
        except effi_api.EffiError as exc:
            raise HTTPException(502, str(exc))
        for imp in imp_lista:
            if str(imp.get('tipo_calculo') or '').lower() not in ('porcentaje', ''):
                raise HTTPException(400, f'El impuesto de la fila {indice} no es porcentual y no se puede calcular en el panel.')
        impuestos[str(indice)] = [int(x['id']) for x in imp_lista]
        impuesto_valor = sum((base * _decimal(x.get('valor') or 0, 'Impuesto') / 100 for x in imp_lista), Decimal('0'))
        bruto_total += bruto
        descuento_total += descuento
        total += base + impuesto_valor
        conceptos.append({'id': int(actual['id']), 'descripcion': _texto(fila.get('descripcion') or actual.get('descripcion') or actual.get('nombre'), 120),
                          'cantidad': float(cantidad), 'precio': float(precio), 'descuento': float(descuento),
                          'nota': _texto(fila.get('nota'), 255)})
    total = _redondear(total)
    if prontopago > total + propina:
        raise HTTPException(400, 'El descuento pronto pago no puede superar el total de la cotización.')
    total_a_pagar = _redondear(total + propina - prontopago)
    fecha_prontopago = _texto(payload.get('fecha_prontopago'), 10)
    if fecha_prontopago and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha_prontopago):
        raise HTTPException(400, 'La fecha de pronto pago debe tener formato AAAA-MM-DD.')
    observacion = f'LÍNEAS DE PRODUCTO: {lineas_producto} · Creado desde el panel por {usuario}'[:1020]
    cuerpo = {'idempotency_key': f'vp-{tipo}-{uuid.uuid4().hex[:20]}', 'sucursal': sucursal, 'bodega': bodega, 'centro_costos': centro,
              'fecha_entrega': fecha, 'divisa': 'COP', 'trm': 1, 'cliente': cliente, 'garantia': proyecto,
              'observacion': observacion, 'articulo': [x['id'] for x in conceptos], 'descripcion': [x['descripcion'] for x in conceptos],
              'cantidad': [x['cantidad'] for x in conceptos], 'precio': [x['precio'] for x in conceptos],
              'descuento': [x['descuento'] for x in conceptos], 'observacion_concepto': [x['nota'] for x in conceptos],
              'impuestos': impuestos, 't_forma_pago': [forma], 'valor_forma_pago': [float(total_a_pagar)]}
    for campo in ('tercero',):
        try:
            valor = int(payload.get(campo) or 0)
        except (TypeError, ValueError):
            valor = 0
        if valor:
            cuerpo[campo] = valor
    if propina:
        cuerpo['propina'] = float(propina)
    if prontopago:
        cuerpo['prontopago'] = float(prontopago)
    if fecha_prontopago:
        cuerpo['fecha_prontopago'] = fecha_prontopago
    referencia_cliente = _texto(payload.get('referencia_cliente'), 120)
    if referencia_cliente:
        cuerpo['referencia_cliente'] = referencia_cliente
    retenciones = []
    for valor in payload.get('retenciones') or []:
        try:
            retenciones.append(int(valor))
        except (TypeError, ValueError):
            raise HTTPException(400, 'Una retención seleccionada no es válida.')
    retencion_valor = Decimal('0')
    if retenciones:
        try:
            retenciones_effi = effi_api.retenciones_de(retenciones)
        except effi_api.EffiError as exc:
            raise HTTPException(502, str(exc))
        base_retencion = bruto_total - descuento_total
        impuesto_total = total - base_retencion
        for retencion in retenciones_effi:
            tipo_ret = str(retencion.get('tipo_calculo') or '').lower()
            if tipo_ret not in ('porcentaje', 'sobre base', 'sobre impuesto principal', ''):
                raise HTTPException(400, f"La retención «{retencion.get('etiqueta') or retencion.get('nombre')}» no es porcentual.")
            if tipo_ret == 'sobre base':
                if _decimal(retencion.get('base_maxima') or 0, 'Base máxima') > 0:
                    raise HTTPException(400, f"La retención «{retencion.get('etiqueta') or retencion.get('nombre')}» tiene base máxima y debe revisarse directamente en Effi.")
                gravable = base_retencion - _decimal(retencion.get('base_excluida') or 0, 'Base excluida')
                if gravable < _decimal(retencion.get('base') or 0, 'Base mínima'):
                    continue
                base_calculo = gravable
            elif tipo_ret == 'sobre impuesto principal':
                base_calculo = impuesto_total
            else:
                base_calculo = base_retencion
            retencion_valor += base_calculo * _decimal(retencion.get('valor') or 0, 'Retención') / 100
        cuerpo['retenciones'] = retenciones
    for campo in ('id_pais_cliente', 'id_provincia_cliente', 'id_ciudad_cliente'):
        try:
            valor = int(payload.get(campo) or 0)
        except (TypeError, ValueError):
            valor = 0
        if valor:
            cuerpo[campo] = valor
    direccion_cliente = _texto(payload.get('direccion_cliente'), 200)
    if direccion_cliente:
        cuerpo['direccion_cliente'] = direccion_cliente
    for campo in ('vendedor', 'ubicacion_venta'):
        try:
            valor = int(payload.get(campo) or 0)
        except (TypeError, ValueError):
            valor = 0
        if valor:
            cuerpo[campo] = valor
    if tipo in ('orden', 'remision'):
        cuerpo['gift'] = [0] * len(conceptos)
    resumen = {'tipo': TIPOS[tipo][0], 'proyecto': proyecto, 'lineas_producto': lineas_producto, 'fecha_entrega': fecha,
               'lineas': conceptos, 'bruto': float(_redondear(bruto_total)), 'descuentos': float(_redondear(descuento_total)),
               'retenciones': float(_redondear(retencion_valor)), 'propina': float(propina),
               'prontopago': float(prontopago), 'total_estimado': float(total_a_pagar),
               'neto_estimado': float(_redondear(total_a_pagar - retencion_valor))}
    return tipo, cuerpo, resumen


@router.post('/previsualizar')
def previsualizar(request: Request, payload: dict):
    usuario = _usuario(request); _con_llave()
    _, _, resumen = _cuerpo(payload or {}, usuario)
    return {'ok': True, 'resumen': resumen}


def _pedir_tela_al_crear(usuario: str, payload: dict, documento: str) -> list[dict]:
    """Apenas se crea la cotización/remisión, si la tela de sus artículos no alcanza, ZEUS recibe la compra por lo que falta (una por tela).
    Nunca impide ni deshace el documento: si algo falla, solo no se pide y el comercial puede usar el botón del formulario."""
    pedidas = []
    try:
        por_tela: dict[str, dict] = {}
        for a in payload.get('articulos') or []:
            referencia = _texto(a.get('referencia') or a.get('descripcion'), 120)
            try:
                cantidad = float(a.get('cantidad') or 0)
            except (TypeError, ValueError):
                continue
            if not referencia or cantidad <= 0:
                continue
            stock = _stock_de(referencia)
            por_unidad = float(_consumo_de(referencia).get('mts_por_unidad') or 0)
            telas = stock.get('telas') or []
            if por_unidad <= 0 or not telas:
                continue
            codigo = str(telas[0].get('codigo'))
            g = por_tela.setdefault(codigo, {'nombre': telas[0].get('nombre', ''), 'necesario': 0.0, 'disponible': float(stock.get('mts_total') or 0), 'ref': referencia, 'cant': 0.0})
            g['necesario'] += cantidad * por_unidad
            g['cant'] += cantidad
        from app import zeus
        for codigo, g in por_tela.items():
            faltan = round(g['necesario'] - g['disponible'], 2)
            if faltan <= 0:
                continue
            r = zeus.pedir_tela_ventas(usuario, codigo, g['nombre'], faltan, g['ref'], g['cant'], _texto(payload.get('cliente_nombre'), 120),
                                       _texto(payload.get('proyecto'), 120), _texto(payload.get('fecha_entrega'), 20), documento)
            pedidas.append({'tela': re.sub(r'^\s*\(\d+\)\s*', '', g['nombre']), 'mts': faltan, 'estado': r.get('estado', '')})
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger('ventas').exception('No se pudo pedir la tela a ZEUS al crear %s', documento)
    return pedidas


@router.post('/crear')
def crear(request: Request, payload: dict):
    usuario = _usuario(request); _con_llave()
    if not bool((payload or {}).get('confirmado')):
        raise HTTPException(400, 'Revisa el resumen y confirma antes de crear el documento.')
    tipo, cuerpo, resumen = _cuerpo(payload or {}, usuario)
    try:
        data = effi_api._peticion('POST', TIPOS[tipo][1], cuerpo=cuerpo).get('data') or {}
    except effi_api.EffiError as exc:
        raise HTTPException(exc.estado if exc.estado in (400, 401, 403, 409) else 502, str(exc))
    try:
        _guardar_conceptos(payload, data, tipo)
    except OSError:
        pass  # el documento ya existe en Effi; solo no se guarda la referencia para la tarjeta
    numero = str(data.get('id_transaccion') or (str(data.get('prefijo') or '') + '-' + str(data.get('id') or '')).strip('-'))
    tela_pedida = _pedir_tela_al_crear(usuario, payload or {}, f"{TIPOS[tipo][0]} {numero}".strip())
    return {'ok': True, 'documento': TIPOS[tipo][0], 'id': str(data.get('id') or ''), 'numero': numero,
            'total': data.get('total'), 'resumen': resumen, 'tela_pedida': tela_pedida}


@router.post('/anular')
def anular(request: Request, payload: dict):
    """Anula una cotización o remisión vigente en Effi (DELETE). Solo con confirmación explícita del usuario."""
    usuario = _usuario(request); _con_llave()
    tipo = _texto((payload or {}).get('tipo'), 20).lower()
    id_doc = _texto((payload or {}).get('id'), 20)
    if tipo not in ('cotizacion', 'remision') or not re.fullmatch(r'\d{1,12}', id_doc):
        raise HTTPException(400, 'Documento no válido.')
    if not bool((payload or {}).get('confirmado')):
        raise HTTPException(400, 'Confirma que quieres anular el documento.')
    motivo = _texto((payload or {}).get('motivo'), 200) or f'Anulada desde el panel por {usuario}'
    sucursal = _texto((payload or {}).get('sucursal'), 5)
    cuerpo = {'sucursal': int(sucursal) if sucursal.isdigit() else int(os.getenv('EFFI_SUCURSAL', '1')), 'id': int(id_doc), 'observacion_anular': motivo[:255]}
    try:
        effi_api._peticion('DELETE', TIPOS[tipo][1], cuerpo=cuerpo)
    except effi_api.EffiError as exc:
        if exc.estado == 400 and 'anulad' in str(exc).lower():
            return {'ok': True, 'ya_anulada': True}
        raise HTTPException(exc.estado if exc.estado in (400, 401, 403, 404, 409) else 502, str(exc))
    return {'ok': True}
