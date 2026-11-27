"""ESTADÍSTICAS de COMERCIALES (PROGRAMAR CLUB): pedidos programados del panel + dinero de Effi.

Regla del usuario: TODO valor en pesos sale de Effi (nada de hojas, cálculos a mano ni supuestos). Los valores van SIN IVA
(campo `subtotal` de Effi) y el IVA aparte (campo `impuestos`). Las unidades son prendas (cantidad de `lista_detalles`).

Fuentes de Effi (API, solo lectura):
  - cotizacion  -> cotizaciones (estado `est_cotizacion`: 1 pendiente de venta; 2/3/4 convertida a orden/remisión/factura)
  - remision_v  -> remisiones de venta (`est_remision_v`: 1 pendiente de facturar, 2 facturada; `id_factura_v` enlaza su factura)
  - factura_v   -> facturas de venta
Cruce con el panel: un pedido CO#### es la cotización #### de Effi; un RM#### es la remisión #### de Effi.

Se baja todo desde el primer día del mes de hace MESES_ATRAS meses (filtro `desde` de la API) y se guarda unos minutos:
la API permite 120 peticiones por minuto y cada tipo trae 100 documentos por página.
"""
import io
import re
import threading
import time
import unicodedata
from datetime import date, datetime, timedelta
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app import effi_api

router = APIRouter(prefix='/api/estadisticas-comerciales', tags=['estadisticas-comerciales'])

MESES_ATRAS = 6
PEDIDOS_DESDE = '2026-10-01'   # el Sheet de producción se cuenta desde aquí (main.ESTADISTICAS_SHEET_DESDE)
CACHE_SEG = 600          # 10 min: después se refresca en segundo plano
DIAS_VENCIDA = 30        # una cotización pendiente de venta con más de 30 días se muestra como «vencida»

_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
_llave: Callable[[], str] = lambda: ''
_programados: Callable[[], list] = lambda: []

_cache: dict = {'t': 0.0, 'datos': None, 'error': ''}
_lock = threading.Lock()
_refrescando = threading.Event()

# Comerciales del panel (quien programa en EMPEZAR PEDIDO) y su nombre en Effi. Se reconocen por TODAS las palabras de `clave`.
# «Indoor Sport» es la cuenta de Administración: siempre se muestra como «Administración».
# Siglas de la columna RESP del Sheet de producción (verificado 2026-11-26 cruzando 89 pedidos con su vendedor en Effi):
#   AL = Andrés López (Effi: CESAR ANDRES LOPEZ ZULUAGA) · AU = Augusto López (Effi: CESAR AUGUSTO LOPEZ ZULUAGA) · DH = David Hincapié
COMERCIALES = [
    {'id': 'andres', 'nombre': 'Cesar Andrés López Zuluaga', 'sigla': 'AL', 'clave': 'ANDRES LOPEZ', 'panel': ['AL', 'ANDRES LOPEZ', 'ANRES LOPES', 'CESAR LOPEZ']},
    {'id': 'augusto', 'nombre': 'Cesar Augusto López Zuluaga', 'sigla': 'AU', 'clave': 'AUGUSTO LOPEZ', 'panel': ['AU', 'AUGUSTO LOPEZ']},
    {'id': 'david', 'nombre': 'David Hincapié Román', 'sigla': 'DH', 'clave': 'DAVID HINCAPIE', 'panel': ['DH', 'DAVID HINCAPIE']},
]
SIN_COMERCIAL = {'id': 'sin-comercial', 'nombre': 'Sin comercial', 'sigla': '—', 'panel': False}


def configurar(auth: Callable, permitido: Callable[[str], bool], llave: Callable[[], str], programados: Callable[[], list]) -> None:
    global _auth, _permitido, _llave, _programados
    _auth, _permitido, _llave, _programados = auth, permitido, llave, programados


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'ESTADÍSTICAS es solo para el equipo comercial')
    return usuario


def _norm(t) -> str:
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Z0-9 ]', ' ', t)).strip()


def comercial_de(nombre: str, fuente: str = 'effi') -> dict:
    """Comercial al que pertenece un nombre del panel o un vendedor de Effi. Si no es ninguno de los del panel, queda con su propio nombre."""
    n = _norm(nombre)
    palabras = set(n.split())
    for c in COMERCIALES:
        claves = c['panel'] if fuente == 'panel' else [c['clave']]
        if any(set(k.split()) <= palabras for k in claves if k):
            return {'id': c['id'], 'nombre': c['nombre'], 'sigla': c['sigla'], 'panel': True}
    if fuente == 'panel':   # RESP vacío, «AGENT», «Indoor Sport»…: el pedido no tiene comercial asignado
        return dict(SIN_COMERCIAL)
    if not n:
        return {'id': 'sin-vendedor', 'nombre': 'Sin vendedor', 'sigla': '—', 'panel': False}
    titulo = ' '.join(p.capitalize() for p in str(nombre).split())
    return {'id': 'effi-' + n.lower().replace(' ', '-'), 'nombre': titulo, 'sigla': ''.join(p[0] for p in n.split()[:2]), 'panel': False}


def _cifra(v) -> float:
    try:
        return float(str(v).replace(',', '').strip() or 0)
    except ValueError:
        return 0.0


def _doc(f: dict, tipo: str) -> dict:
    """Documento de Effi reducido a lo que usa la pestaña."""
    detalles = [d for d in (f.get('lista_detalles') or []) if isinstance(d, dict)]
    unidades = sum(_cifra(d.get('cantidad')) for d in detalles)
    vend = comercial_de(f.get('nombre_vendedor') or '')
    base = {
        'tipo': tipo, 'id': str(f.get('id') or ''), 'numero': str(f.get('id_transaccion') or f.get('id') or ''),
        'fecha': str(f.get('fecha_trans') or '')[:10], 'entrega': str(f.get('fecha_entrega') or '')[:10],
        'cliente': str(f.get('nombre_cliente') or '').strip(), 'vendedor_effi': str(f.get('nombre_vendedor') or '').strip(),
        'comercial': vend['id'],
        'unidades': round(unidades, 2), 'sin_iva': round(_cifra(f.get('subtotal')), 2), 'iva': round(_cifra(f.get('impuestos')), 2),
        'total': round(_cifra(f.get('total')), 2), 'divisa': str(f.get('divisa') or 'COP'),
        'vigente': str(f.get('vigente', '1')) != '0',
        'refs': [{'ref': str(d.get('referencia') or d.get('descripcion') or '').strip(), 'desc': str(d.get('descripcion') or '').strip(),
                  'cantidad': _cifra(d.get('cantidad')), 'precio': _cifra(d.get('p_venta'))} for d in detalles],
    }
    if tipo == 'cotizacion':
        est = int(_cifra(f.get('est_cotizacion')) or 1)
        base.update(est_effi=str(f.get('estado_cotizacion') or ''), convertida=est in (2, 3, 4),
                    id_orden_v=str(f.get('id_orden_v') or ''), id_remision_v=str(f.get('id_remision_v') or ''), id_factura_v=str(f.get('id_factura_v') or ''))
    elif tipo == 'remision':
        # Effi deja la remisión con vigente=0 cuando la FACTURA (la factura pasa a ser el documento vigente). Anulada de verdad = no vigente y sin factura.
        facturada = int(_cifra(f.get('est_remision_v')) or 1) == 2 or bool(f.get('id_factura_v'))
        base.update(est_effi=str(f.get('estado') or ''), facturada=facturada,
                    id_factura_v=str(f.get('id_factura_v') or ''), cartera=str(f.get('estado_c_x_c') or ''))
        base['anulada'] = not base['vigente'] and not facturada
    else:
        base.update(est_effi=str(f.get('estado_c_x_c') or f.get('estado') or ''), numero_factura=str(f.get('prefijo_id_facturacion') or ''))
    base.setdefault('anulada', not base['vigente'])
    base['comercial_info'] = vend
    return base


def _bajar(ruta: str, desde: str) -> list:
    filas, pagina = [], 1
    while pagina <= 60:
        d = effi_api._peticion('GET', ruta, {'desde': desde, 'por_pagina': 100, 'pagina': pagina})
        filas += [x for x in (d.get('data') or []) if isinstance(x, dict)]
        pag = d.get('paginacion') or {}
        if pagina >= int(pag.get('total_paginas') or 1):
            break
        pagina += 1
    return filas


def _desde() -> str:
    hoy = date.today()
    m, a = hoy.month - MESES_ATRAS, hoy.year
    while m <= 0:
        m += 12; a -= 1
    return f'{a:04d}-{m:02d}-01'


OPCIONALES = {'APLIQUE', 'FACTURACION'}   # áreas que solo le tocan a la referencia si ya las tocó


def _posicion(fila: dict) -> dict:
    """Dónde va realmente una referencia: {'st': terminado|rework|active|pending, 'area', 'idx'} (idx = orden en el flujo)."""
    areas = [(str(a[0]), a[1]) for a in (fila.get('areas') or []) if isinstance(a, (list, tuple)) and len(a) == 2]
    if not areas:   # filas viejas sin detalle: se usa el foco calculado por el panel
        fo = fila.get('focus') or {}
        st = 'terminado' if int(fila.get('percent') or 0) >= 100 else (fo.get('state') or 'pending')
        return {'st': st, 'area': str(fo.get('label') or 'Producción'), 'idx': int(fila.get('percent') or 0)}
    for i, (lab, st) in enumerate(areas):
        if st == 'rework':
            return {'st': 'rework', 'area': lab, 'idx': i}
    tocadas = [i for i, (_l, st) in enumerate(areas) if st in ('finished', 'active')]
    ultima = max(tocadas) if tocadas else -1
    activas = [i for i, (_l, st) in enumerate(areas) if st == 'active']
    if activas:   # la más avanzada que está en proceso
        i = max(activas)
        return {'st': 'active', 'area': areas[i][0], 'idx': i}
    # la siguiente área que le toca después de la última tocada (se saltan las opcionales no tocadas)
    for i in range(ultima + 1, len(areas)):
        lab = areas[i][0]
        if _norm(lab) in OPCIONALES:
            continue
        return {'st': 'pending', 'area': lab, 'idx': i}
    return {'st': 'terminado', 'area': areas[-1][0], 'idx': len(areas)}


def _estado_pedido(x: dict, hoy: str) -> dict:
    """Estado REAL de un pedido según Producción (no el estado de la programación). Atrasado = fecha de entrega vencida y sin terminar."""
    prod = x.get('prod') or {}
    filas = prod.get('filas') or []
    entrega = str(prod.get('entrega') or '')[:10]
    if str(x.get('estado') or '').upper().startswith(('ERROR', 'FALL')):
        return {'clave': 'error', 'texto': 'Error al programar', 'atrasado': False, 'entrega': entrega}
    if not filas:
        return {'clave': 'sin-produccion', 'texto': 'Sin filas en Producción', 'atrasado': False, 'entrega': entrega}
    # Posición REAL de cada referencia (reglas del panel): las áreas ya superadas con celda vacía no cuentan, y APLIQUE y
    # FACTURACIÓN solo cuentan si la referencia ya las tocó. Así una celda vacía de Aplique no deja el pedido «pendiente» para siempre.
    posiciones = [_posicion(f) for f in filas]
    if all(p['st'] == 'terminado' for p in posiciones):
        return {'clave': 'terminado', 'texto': 'Terminado', 'atrasado': False, 'entrega': entrega}
    # manda la referencia en reproceso; si no hay, la menos avanzada
    pos = next((p for p in posiciones if p['st'] == 'rework'), None) or min((p for p in posiciones if p['st'] != 'terminado'), key=lambda p: p['idx'])
    area, st = pos['area'].capitalize(), pos['st']
    texto = ('Reproceso en ' if st == 'rework' else 'En ' if st == 'active' else 'Pendiente ') + area
    atrasado = bool(entrega) and entrega < hoy
    if atrasado:
        return {'clave': 'atrasado', 'texto': 'Atrasado · ' + texto, 'atrasado': True, 'entrega': entrega}
    return {'clave': 'reproceso' if st == 'rework' else 'proceso' if st == 'active' else 'pendiente', 'texto': texto, 'atrasado': False, 'entrega': entrega}


def _construir() -> dict:
    llave = (_llave() or '').strip()
    if llave:
        effi_api.usar_llave(llave)
    desde = _desde()
    errores = []
    crudos = {}
    if not effi_api.disponible():
        errores.append('Falta la API key de Effi: no hay valores en pesos.')
    else:
        for tipo, ruta in (('cotizacion', 'cotizacion'), ('remision', 'remision_v'), ('factura', 'factura_v')):
            try:
                crudos[tipo] = _bajar(ruta, desde)
            except effi_api.EffiError as e:
                errores.append(f'Effi ({ruta}): {e}')
                crudos[tipo] = []
    docs = {t: [_doc(f, t) for f in crudos.get(t, [])] for t in ('cotizacion', 'remision', 'factura')}
    cot_por_id = {d['id']: d for d in docs['cotizacion']}
    rem_por_id = {d['id']: d for d in docs['remision']}
    # Vendido = facturas vigentes + remisiones vigentes aún sin facturar (al facturar, Effi anula la remisión: nada se cuenta dos veces)
    fact_de_rem = {d['id_factura_v'] for d in docs['remision'] if d.get('id_factura_v')}
    for f in docs['factura']:
        f['de_remision'] = f['id'] in fact_de_rem
    hoy = date.today().isoformat()
    pedidos = []
    for x in (_programados() or []):
        cod = str(x.get('codigo') or '')
        m = re.fullmatch(r'(CO|RM)(\d+)', cod)
        doc = (cot_por_id if m and m.group(1) == 'CO' else rem_por_id).get(m.group(2)) if m else None
        com = comercial_de(x.get('resp') or x.get('usuario') or '', 'panel')   # el comercial es el RESP del Sheet
        prod = x.get('prod') or {}
        lineas = sorted({str(f.get('linea') or '').strip().upper() for f in (prod.get('filas') or []) if str(f.get('linea') or '').strip()})
        est = _estado_pedido(x, hoy)
        unidades = int(x.get('prendas') or 0) or sum(int(f.get('units') or 0) for f in (prod.get('filas') or []))
        pedidos.append({
            'codigo': cod, 'fecha': str(x.get('fecha') or '')[:10], 'cliente': str(x.get('cliente') or '').strip(), 'proyecto': str(x.get('proyecto') or ''),
            'usuario': str(x.get('usuario') or ''), 'resp': str(x.get('resp') or ''), 'fuente': x.get('fuente') or 'panel', 'comercial': com['id'], 'comercial_info': com,
            'unidades': unidades, 'referencias': x.get('referencias') or [], 'lineas': lineas,
            'estado': est, 'estado_programacion': str(x.get('estado') or ''),
            'effi': ({'tipo': 'cotizacion' if m.group(1) == 'CO' else 'remision', 'id': doc['id'], 'sin_iva': doc['sin_iva'], 'iva': doc['iva'],
                      'unidades': doc['unidades'], 'vigente': doc['vigente'], 'id_remision_v': doc.get('id_remision_v', '')} if doc else None),
        })
    # comerciales: siempre los del panel (aunque no tengan datos) + cada vendedor de Effi que no es de ellos
    coms = {c['id']: {'id': c['id'], 'nombre': c['nombre'], 'sigla': c['sigla'], 'panel': True, 'effi': []} for c in COMERCIALES}
    for t in docs.values():
        for d in t:
            ci = d.pop('comercial_info')
            c = coms.setdefault(ci['id'], {**ci, 'effi': []})
            if d['vendedor_effi'] and d['vendedor_effi'] not in c['effi']:
                c['effi'].append(d['vendedor_effi'])
    for p in pedidos:
        ci = p.pop('comercial_info')
        coms.setdefault(ci['id'], {**ci, 'effi': []})
    return {
        'generado': datetime.now().isoformat(timespec='seconds'), 'desde': desde, 'hoy': hoy, 'errores': errores,
        'pedidos_desde': PEDIDOS_DESDE,   # desde aquí hay pedidos completos (Sheet + panel): sirve para comparar periodos
        'comerciales': list(coms.values()), 'pedidos': pedidos,
        'cotizaciones': docs['cotizacion'], 'remisiones': docs['remision'], 'facturas': docs['factura'],
        'reglas': {'dias_vencida': DIAS_VENCIDA, 'iva': 'Valores SIN IVA (subtotal de Effi); IVA aparte (impuestos de Effi).'},
    }


def _refrescar() -> None:
    try:
        datos = _construir()
        with _lock:
            _cache.update(t=time.time(), datos=datos, error='')
    except Exception as e:  # noqa: BLE001
        with _lock:
            _cache['error'] = str(e)
    finally:
        _refrescando.clear()


@router.get('/datos')
def datos(request: Request, refrescar: int = 0):
    _usuario(request)
    with _lock:
        actual, edad = _cache['datos'], time.time() - _cache['t']
    if actual is None or refrescar:
        if not _refrescando.is_set():
            _refrescando.set()
            _refrescar()
        else:   # otro pedido ya la está armando: se espera (máx. 90 s)
            for _ in range(180):
                if not _refrescando.is_set():
                    break
                time.sleep(0.5)
        with _lock:
            actual = _cache['datos']
            if actual is None:
                raise HTTPException(502, 'No pude leer Effi: ' + (_cache['error'] or 'sin respuesta'))
        return actual
    if edad > CACHE_SEG and not _refrescando.is_set():   # viejo: se entrega y se refresca en segundo plano
        _refrescando.set()
        threading.Thread(target=_refrescar, daemon=True).start()
    return actual


@router.post('/excel')
def excel(request: Request, payload: dict):
    """Exporta a Excel lo que se ve en un bloque: {titulo, hojas: [{nombre, columnas: [..], filas: [[..]]}]}."""
    _usuario(request)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    titulo = re.sub(r'[^\w\- ]', '', str(payload.get('titulo') or 'estadisticas'))[:60] or 'estadisticas'
    wb = Workbook()
    wb.remove(wb.active)
    for h in (payload.get('hojas') or [])[:10]:
        ws = wb.create_sheet(re.sub(r'[\[\]:*?/\\]', '', str(h.get('nombre') or 'Hoja'))[:31] or 'Hoja')
        cols = [str(c) for c in (h.get('columnas') or [])][:40]
        ws.append(cols)
        for c in ws[1]:
            c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F3A1F')
        for fila in (h.get('filas') or [])[:20000]:
            ws.append([v if isinstance(v, (int, float)) else str(v if v is not None else '') for v in list(fila)[:40]])
        for i, c in enumerate(cols, 1):
            ancho = max([len(c)] + [len(str(r[i - 1])) for r in (h.get('filas') or [])[:300] if len(r) >= i])
            ws.column_dimensions[ws.cell(1, i).column_letter].width = min(48, max(10, ancho + 2))
    if not wb.worksheets:
        wb.create_sheet('Vacío')
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    nombre = f'{titulo}_{date.today().isoformat()}.xlsx'.replace(' ', '_')
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': f'attachment; filename="{nombre}"'})
