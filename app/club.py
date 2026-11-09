"""Tienda de reposiciones por club.

Comercial genera un ENLACE PRIVADO para un cliente (club). Con ese enlace el cliente ve los diseños que ya produjo con Indoor y arma una reposición
(jugadores con nombre, número, talla y cantidad). La reposición llega a comercial como «pendiente»: comercial la revisa y la aprueba o la rechaza
(después la programa como cualquier pedido). Sin precios ni pagos en esta versión.

Datos en jobs.sqlite3: club_links (enlaces) y club_pedidos (reposiciones). El token del enlace es largo y aleatorio; se puede revocar.
Los diseños salen de Producción (mismos mockups firmados de la consulta pública), y solo los del cliente dueño del enlace.
"""
from __future__ import annotations

import io
import hashlib
import json
import logging
import os
import re
import secrets
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Callable

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import HTMLResponse, Response

log = logging.getLogger('club')
router = APIRouter(prefix='/api/club', tags=['club'])            # comercial (con sesión)
public = APIRouter(prefix='/api/club', tags=['club-publico'])    # cliente (con el enlace privado)
pagina = APIRouter(tags=['club-pagina'])
_connect: Callable = lambda: None
_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda u: False
_too_many: Callable = lambda bucket, request, limit, seconds=60: False
_mockups: Callable[[int], dict] = lambda row: {'mockups': [], 'mockups_lista': None}
_clientes_root: Callable[[], str] = lambda: ''
_programar: Callable[[int, str], dict] | None = None
COL = timezone(timedelta(hours=-5))
TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']   # las mismas de la plantilla de Indoor
MAX_JUGADORES = 300
EXCEL_DIR = Path(os.getenv('CLUB_EXCEL_DIR', '/data/state/club_excel'))
_MESES = {'ENE': 1, 'FEB': 2, 'MAR': 3, 'ABR': 4, 'MAY': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DIC': 12}


def configurar(connect: Callable, auth: Callable, permitido: Callable[[str], bool], too_many: Callable, mockups: Callable[[int], dict], clientes_root: Callable[[], str] = lambda: '') -> None:
    global _connect, _auth, _permitido, _too_many, _mockups, _clientes_root
    _connect, _auth, _permitido, _too_many, _mockups, _clientes_root = connect, auth, permitido, too_many, mockups, clientes_root
    with _connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS club_links(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, cliente TEXT, creado_por TEXT, creado TEXT, vence TEXT, activo INTEGER DEFAULT 1)')
        db.execute('CREATE TABLE IF NOT EXISTS club_pedidos(id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER, cliente TEXT, contacto TEXT, telefono TEXT, notas TEXT, '
                   'lineas TEXT, estado TEXT DEFAULT \'pendiente\', creado TEXT, resuelto_por TEXT, resuelto TEXT, nota_comercial TEXT)')
        existentes = {r[1] for r in db.execute('PRAGMA table_info(club_pedidos)')}
        for columna, definicion in (('produccion_job', 'INTEGER'), ('produccion_estado', 'TEXT'), ('produccion_detalle', 'TEXT')):
            if columna not in existentes:
                db.execute(f'ALTER TABLE club_pedidos ADD COLUMN {columna} {definicion}')


def configurar_programador(fn: Callable[[int, str], dict]) -> None:
    """main.py registra el puente seguro Tienda Club → Producción."""
    global _programar
    _programar = fn


def marcar_programacion(pedido_id: int, estado: str, detalle: str = '') -> None:
    with _connect() as db:
        db.execute('UPDATE club_pedidos SET produccion_estado=?, produccion_detalle=? WHERE id=?', (estado[:30], detalle[:500], pedido_id))


def _ahora() -> str:
    return datetime.now(COL).replace(microsecond=0).isoformat()


def _plano(t) -> str:
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if unicodedata.category(c) != 'Mn')).strip().upper()


def _mismo_cliente(a, b) -> bool:
    """Compara el cliente de la NAS con el del listado sin mezclar clubes.

    En los maestros de algunos clubes el directorio conserva el sufijo
    deportivo ``FC`` mientras que las órdenes históricas del Sheet no lo
    tienen. Es el mismo cliente, pero la comparación estricta hacía que se
    perdiera la fila real (referencia, orden y PDF de cotización) y se creara
    una fila sintética ``MAESTRO`` que EFFITRON no puede cotizar.
    """
    uno, dos = _plano(a), _plano(b)
    if not uno or not dos:
        return False
    if uno == dos:
        return True
    return (uno.endswith(' FC') and uno[:-3] == dos) or (dos.endswith(' FC') and dos[:-3] == uno)


def _recencia(fecha, fila: int) -> tuple[int, int]:
    """Clave de la última orden: fecha de inicio real y fila solo como desempate."""
    texto = _plano(fecha)
    m = re.search(r'\b(\d{1,2})\s*[-/]\s*([A-Z]{3}|\d{1,2})\s*[-/]\s*(\d{4})\b', texto)
    if m:
        try:
            token_mes = m.group(2)
            mes = _MESES.get(token_mes, int(token_mes) if token_mes.isdigit() else 0)
            return (datetime(int(m.group(3)), mes, int(m.group(1))).toordinal(), int(fila or 0))
        except ValueError:
            pass
    return (0, int(fila or 0))


# Algunas carpetas antiguas terminan en "_" (PE01_D1_D2_), aunque los
# JPG internos sí llevan la máquina; también son maestros válidos.
_CARPETA_MAESTRA = re.compile(r'^(?P<referencia>[A-Z0-9-]+)_D[0-9]+(?:_D[0-9]+)*_(?:[A-Z0-9-]+)?$', re.I)
_catalogos_maestros: dict[str, list[dict]] = {}
_catalogos_pendientes: dict[str, object] = {}
_catalogos_lock = Lock()
_catalogos_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='club-maestros')


def _leer_proyectos_maestros(cliente: str) -> list[dict]:
    """Proyectos reutilizables del NAS.

    Se usan únicamente las carpetas de referencia que siguen el mismo formato
    de sus JPG: REFERENCIA_DISEÑO_MÁQUINA (por ejemplo FUT01_D1_D2_PLUS).
    Así se excluyen recursos y archivos sueltos sin abrir todos los JPG del
    NAS en cada visita.
    """
    try:
        raiz = Path(str(_clientes_root() or '')).expanduser()
        if not raiz.is_dir():
            return []
        cliente_dir = next((p for p in raiz.iterdir() if p.is_dir() and _plano(p.name) == _plano(cliente)), None)
        maestros = cliente_dir / 'MAESTROS' if cliente_dir else None
        if not maestros or not maestros.is_dir():
            return []
        salida = []
        for proyecto in sorted((p for p in maestros.iterdir() if p.is_dir()), key=lambda p: _plano(p.name)):
            referencias: dict[str, set[str]] = {}
            try:
                # Cada referencia es una carpeta directa del proyecto. Su
                # nombre ya identifica los JPG de impresión que contiene;
                # abrir cada archivo desde la NAS puede tardar minutos.
                for carpeta in (p for p in proyecto.iterdir() if p.is_dir()):
                    carpeta_match = _CARPETA_MAESTRA.match(carpeta.name.strip())
                    if not carpeta_match:
                        continue
                    ref = carpeta_match.group('referencia').upper()
                    disenos = re.findall(r'_D([0-9]+)', carpeta.name.upper())
                    referencias.setdefault(ref, set()).update('D' + n for n in disenos)
            except OSError:
                continue
            if referencias:
                salida.append({'proyecto': proyecto.name, 'referencias': sorted(referencias),
                               'disenos': sum(len(x) for x in referencias.values())})
        return salida
    except OSError:
        log.warning('No pude listar los maestros del cliente %s', cliente, exc_info=True)
        return []


def _catalogo_terminado(cliente: str, futuro) -> None:
    try:
        catalogo = futuro.result()
    except Exception:  # noqa: BLE001
        log.warning('No pude preparar el catálogo maestro de %s', cliente, exc_info=True)
        catalogo = []
    with _catalogos_lock:
        _catalogos_maestros[_plano(cliente)] = catalogo
        _catalogos_pendientes.pop(_plano(cliente), None)


def proyectos_maestros_de(cliente: str) -> list[dict]:
    """Entrega el catálogo sin dejar esperando al cliente por la NAS."""
    raiz = str(_clientes_root() or '').replace('\\', '/')
    # La NAS remota puede tardar varios segundos en enumerar directorios. Para
    # rutas de pruebas/locales se conserva la lectura inmediata.
    if not raiz.startswith('/mnt/nas/'):
        return _leer_proyectos_maestros(cliente)
    clave = _plano(cliente)
    with _catalogos_lock:
        if clave in _catalogos_maestros:
            return _catalogos_maestros[clave]
        futuro = _catalogos_pendientes.get(clave)
        if futuro is None:
            futuro = _catalogos_pool.submit(_leer_proyectos_maestros, cliente)
            _catalogos_pendientes[clave] = futuro
            futuro.add_done_callback(lambda f, c=cliente: _catalogo_terminado(c, f))
    return []


def catalogo_maestros_pendiente(cliente: str) -> bool:
    with _catalogos_lock:
        return _plano(cliente) in _catalogos_pendientes


def _usuario(request: Request) -> str:
    u = str(_auth(request) or '')
    if not _permitido(u):
        raise HTTPException(403, 'Solo Comercial puede administrar la tienda de clubes')
    return u


def _enlace(token: str) -> dict:
    with _connect() as db:
        r = db.execute('SELECT * FROM club_links WHERE token=?', (token,)).fetchone()
    if not r or not r['activo'] or (r['vence'] and r['vence'] < _ahora()):
        raise HTTPException(404, 'Este enlace no existe o ya venció. Pídele uno nuevo a tu asesor comercial.')
    return dict(r)


# ------------------------------------------------------------------ tela y código de tela de la vez pasada
def tela_de(row: int) -> tuple[str, str]:
    """(nombre de la tela, código) del pedido anterior: la TELA sale de la tarjeta de Producción y el código de la Bodega tela del inventario.
    Si el nombre coincide con varias telas (colores), se listan todos los códigos para que comercial elija."""
    with _connect() as db:
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        r = db.execute('SELECT values_json FROM production_rows WHERE source_row=?', (row,)).fetchone()
    if not meta or not r:
        return '', ''
    h = [str(x or '').strip().upper() for x in json.loads(meta['value'])]
    v = json.loads(r['values_json'])
    tela = str(v[h.index('TELA')] or '').strip() if 'TELA' in h and h.index('TELA') < len(v) else ''
    if not tela:
        return '', ''
    try:
        from app import proveedores_tela
        buscada = _plano(tela)
        coincide = [t for t in proveedores_tela.telas() if buscada and buscada in _plano(t['nombre'])]
    except Exception:   # noqa: BLE001
        coincide = []
    exactas = [t for t in coincide if _plano(t['nombre']) == buscada]
    elegidas = exactas or coincide
    return tela, ' / '.join(dict.fromkeys(str(t['codigo']) for t in elegidas))


PLANTILLA_NAS = Path(os.getenv('CLUB_PLANTILLA', '/mnt/nas/DIRECCION COMERCIAL_ANDRES LOPEZ/HERRAMIENTAS COMERCIALES/EXCEL/Plantilla.xlsm'))
PLANTILLA_COPIA = Path(os.getenv('CLUB_PLANTILLA_COPIA', '/data/state/club_plantilla.xlsm'))
LINEAS = ('COPA', 'PLUS', 'MAQUILA', 'PREMIUM', 'ESTANDAR')


def _plantilla() -> bytes:
    """La plantilla de listado de Indoor (la misma que usa el equipo comercial): del NAS; si el NAS no responde, la última copia guardada."""
    try:
        datos = PLANTILLA_NAS.read_bytes()
        PLANTILLA_COPIA.parent.mkdir(parents=True, exist_ok=True)
        PLANTILLA_COPIA.write_bytes(datos)
        return datos
    except OSError:
        if PLANTILLA_COPIA.is_file():
            return PLANTILLA_COPIA.read_bytes()
        raise


def _linea_de(row: int) -> str:
    with _connect() as db:
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        r = db.execute('SELECT values_json FROM production_rows WHERE source_row=?', (row,)).fetchone()
    if not meta or not r:
        return ''
    h = [str(x or '').strip().upper() for x in json.loads(meta['value'])]
    v = json.loads(r['values_json'])
    x = _plano(v[h.index('LINEA')]) if 'LINEA' in h and h.index('LINEA') < len(v) else ''
    return x if x in LINEAS else ''


def construir_excels(p: dict) -> list[tuple[str, bytes]]:
    """Un listado por referencia, con la plantilla de Indoor: la hoja se llama como la referencia, el encabezado lleva cliente, proyecto y comercial,
    y cada prenda es una fila (NOMBRE, TALLA, NÚMERO, X en el DISEÑO elegido y en MASC o FEM). Se agrega la tela y su código del pedido anterior."""
    from openpyxl import load_workbook
    salida = []
    for l in p['lineas']:
        wb = load_workbook(io.BytesIO(_plantilla()), keep_vba=True)
        ws = wb.worksheets[0]
        ws.title = re.sub(r'[\\/*?:\[\]]', '', l['referencia'])[:31] or 'REFERENCIA'
        ws['J2'] = p['cliente']
        ws['J3'] = l.get('proyecto', '')
        ws['J4'] = p.get('comercial', '')
        linea = _linea_de(l['row'])
        if linea:
            ws['J6'] = linea
        ws['P2'] = 'TELA (pedido anterior)'
        ws['P3'] = (l.get('tela') or '—') + ('  ·  código ' + l['codigo_tela'] if l.get('codigo_tela') else '')
        ws['P4'] = 'Reposición club #%s · base %s' % (p['id'], l.get('orden_base', ''))
        fila, maximo = 8, 1
        for j in l['jugadores']:
            for _ in range(max(1, int(j.get('cantidad') or 1))):
                ws.cell(row=fila, column=3, value=j.get('nombre') or None)
                ws.cell(row=fila, column=4, value=j.get('talla') or None)
                ws.cell(row=fila, column=5, value=j.get('numero') or None)
                d = max(1, min(int(j.get('diseno') or 1), 20))
                maximo = max(maximo, d)
                if d <= 6:   # la plantilla trae las columnas DISEÑO 1 a 6 en la tabla
                    ws.cell(row=fila, column=9 + d, value='X')
                obs = (f'DISEÑO {d}' if d > 6 else '') + (' · ' if d > 6 and j.get('observacion') else '') + (j.get('observacion') or '')   # más de 6 diseños: no hay columna en la tabla, el número va en OBSERVACIONES
                if obs:
                    ws.cell(row=fila, column=18, value=obs)
                if j.get('genero') == 'MASC':
                    ws.cell(row=fila, column=16, value='X')
                elif j.get('genero') == 'FEM':
                    ws.cell(row=fila, column=17, value='X')
                fila += 1
        ws['AG3'] = max(int(ws['AG3'].value or 1), min(maximo, 20))
        buf = io.BytesIO()
        wb.save(buf)
        nombre = re.sub(r'[^A-Za-z0-9_-]+', '_', f"{l['referencia']}_{p['cliente']}")[:60]
        salida.append((f"Reposicion_{p['id']}_{nombre}.xlsm", buf.getvalue()))
    return salida


def _pedido(pedido_id: int) -> dict:
    with _connect() as db:
        r = db.execute('SELECT * FROM club_pedidos WHERE id=?', (pedido_id,)).fetchone()
    if not r:
        raise HTTPException(404, 'No existe esa reposición')
    p = dict(r)
    p['lineas'] = json.loads(p['lineas'] or '[]')
    with _connect() as db:
        l = db.execute('SELECT creado_por FROM club_links WHERE id=?', (p['link_id'],)).fetchone()
    p['comercial'] = l['creado_por'] if l else ''
    return p


def actualizar_maestros_pedido(pedido_id: int) -> dict:
    """Actualiza una reposición antigua que quedó con una fila MAESTRO sintética.

    El reintento comercial es la única ocasión en la que se escribe. Conserva
    los jugadores y los mockups del maestro, pero recupera de Producción la
    referencia vendible, la orden/PDF base y la tela de la última orden real.
    """
    pedido = _pedido(pedido_id)
    catalogo = proyectos_maestros_de(pedido['cliente'])
    disenos = disenos_de(pedido['cliente'], catalogo)
    reales = {( _plano(d.get('proyecto')), _plano(d.get('maestro'))): d for d in disenos if not d.get('maestro_nas')}
    cambio = False
    for linea in pedido['lineas']:
        if not linea.get('maestro_nas') and int(linea.get('row') or 0) > 0:
            continue
        maestro = (re.findall(r'[A-Z]+\d+', str(linea.get('referencia') or '').upper()) or [str(linea.get('referencia') or '').upper()])[-1]
        base = reales.get((_plano(linea.get('proyecto')), maestro))
        if not base:
            continue
        tela, codigo = tela_de(int(base['row']))
        linea.update(row=base['row'], referencia=base['referencia'], orden_base=base['orden'],
                     tela=tela, codigo_tela=codigo, maestro_nas=True)
        cambio = True
    if cambio:
        with _connect() as db:
            db.execute('UPDATE club_pedidos SET lineas=? WHERE id=?', (json.dumps(pedido['lineas'], ensure_ascii=False), pedido_id))
    return pedido


# ------------------------------------------------------------------ diseños del cliente (desde Producción)
def disenos_de(cliente: str, catalogo: list[dict] | None = None) -> list[dict]:
    """Proyectos maestros ya producidos para el cliente, uno por carpeta base.

    Una misma referencia puede existir en varias órdenes históricas. Solo se
    expone la más reciente de cada maestro (FUT01, FUT02, PE01, etc.) para que
    el cliente no vea ni reutilice órdenes anteriores.
    """
    catalogo = proyectos_maestros_de(cliente) if catalogo is None else catalogo
    # Si la NAS está disponible, no se cuelan filas antiguas sin su JPG maestro.
    proyecto_por_referencia = {ref: item['proyecto'] for item in catalogo for ref in item['referencias']}
    with _connect() as db:
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not meta:
            return []
        h = [str(x or '').strip().upper() for x in json.loads(meta['value'])]
        ix = {n: h.index(n) for n in ('NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO', 'ORDEN', 'REFERENCIA', 'CANTIDAD', 'FECHA DE INICIO', 'TIPO DE DISEÑO') if n in h}
        if 'NOMBRE DEL CLIENTE' not in ix or 'REFERENCIA' not in ix:
            return []
        salida: dict[str, dict] = {}
        for r in db.execute('SELECT source_row, values_json FROM production_rows ORDER BY source_row DESC'):
            v = json.loads(r['values_json'])
            cel = lambda n: str(v[ix[n]] or '').strip() if n in ix and ix[n] < len(v) else ''
            if not _mismo_cliente(cel('NOMBRE DEL CLIENTE'), cliente):
                continue
            ref = cel('REFERENCIA').upper()
            partes_maestro = re.findall(r'[A-Z]+\d+', ref)
            maestro = partes_maestro[-1] if partes_maestro else ref
            if catalogo and maestro not in proyecto_por_referencia:
                continue
            proyecto = proyecto_por_referencia.get(maestro) or cel('NOMBRE PROYECTO')
            clave = f"{_plano(proyecto)}|{maestro}"
            if not ref:
                continue
            candidato = {'row': r['source_row'], 'referencia': ref, 'maestro': maestro, 'proyecto': proyecto, 'orden': cel('ORDEN'), 'cantidad': cel('CANTIDAD'), 'fecha': cel('FECHA DE INICIO'),
                         'tipo': cel('TIPO DE DISEÑO')}
            anterior = salida.get(clave)
            # El Sheet puede mover o reordenar filas; una fila mayor no
            # necesariamente es más nueva. Para cotizar se conserva la última
            # orden por fecha, con su referencia/precio y PDF reales.
            if anterior is None or _recencia(candidato['fecha'], candidato['row']) > _recencia(anterior['fecha'], anterior['row']):
                salida[clave] = candidato
    # Los maestros que ya están en la NAS también se pueden reprogramar aunque
    # su orden histórica no esté en la copia local del Sheet.
    existentes = {(d['proyecto'], d['maestro']) for d in salida.values()}
    for item in catalogo:
        for ref in item['referencias']:
            if (item['proyecto'], ref) in existentes:
                continue
            semilla = f'{_plano(cliente)}|{_plano(item["proyecto"])}|{ref}'.encode('utf-8')
            fila = -int.from_bytes(hashlib.sha256(semilla).digest()[:4], 'big')
            salida[f'{_plano(item["proyecto"])}|{ref}'] = {
                'row': fila, 'referencia': ref, 'maestro': ref, 'proyecto': item['proyecto'],
                'orden': 'MAESTRO', 'cantidad': '', 'fecha': '', 'tipo': '',
                'maestro_nas': True, 'disenos': 1,
            }
    return list(salida.values())[:200]


def copiar_mockups_maestros(cliente: str, linea: dict, destino: Path) -> int:
    """Copia los JPG maestros al aprobar una reposición sin orden histórica."""
    ref = str(linea.get('referencia') or '').upper()
    proyecto = _plano(linea.get('proyecto'))
    requeridos = {max(1, min(int(j.get('diseno') or 1), 20)) for j in linea.get('jugadores') or []}
    raiz = Path(str(_clientes_root() or ''))
    cliente_dir = next((p for p in raiz.iterdir() if p.is_dir() and _plano(p.name) == _plano(cliente)), None)
    base = cliente_dir / 'MAESTROS' if cliente_dir else None
    proy = next((p for p in base.iterdir() if p.is_dir() and _plano(p.name) == proyecto), None) if base and base.is_dir() else None
    if not proy:
        raise ValueError(f'No encontré el proyecto maestro de {ref}.')
    candidatos = [p for p in proy.iterdir() if p.is_dir() and _CARPETA_MAESTRA.match(p.name) and _CARPETA_MAESTRA.match(p.name).group('referencia').upper() == ref]
    copiados = 0
    for n in requeridos:
        patron = re.compile(rf'^{re.escape(ref)}_D{n}_[A-Z0-9-]+\.jpe?g$', re.I)
        origen = next((f for carpeta in candidatos for f in carpeta.iterdir() if f.is_file() and patron.match(f.name)), None)
        if not origen:
            raise ValueError(f'No encontré el JPG maestro {ref}_D{n}_MÁQUINA.')
        import shutil
        shutil.copy2(origen, destino / f'{ref}_D{n}_MAESTRO{origen.suffix.lower()}')
        copiados += 1
    return copiados


# ------------------------------------------------------------------ comercial
@router.get('/clientes')
def clientes(request: Request, q: str = ''):
    """Nombres de cliente que existen en Producción (para elegir a quién se le genera el enlace)."""
    _usuario(request)
    with _connect() as db:
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        h = [str(x or '').strip().upper() for x in json.loads(meta['value'])] if meta else []
        if 'NOMBRE DEL CLIENTE' not in h:
            return {'clientes': []}
        i = h.index('NOMBRE DEL CLIENTE')
        nombres: dict[str, int] = {}
        for r in db.execute('SELECT values_json FROM production_rows'):
            v = json.loads(r['values_json'])
            n = str(v[i] or '').strip() if i < len(v) else ''
            if n:
                nombres[n] = nombres.get(n, 0) + 1
    buscar = _plano(q)
    lista = sorted(((n, c) for n, c in nombres.items() if not buscar or buscar in _plano(n)), key=lambda x: -x[1])[:30]
    return {'clientes': [{'nombre': n, 'pedidos': c} for n, c in lista]}


@router.post('/enlaces')
def crear_enlace(request: Request, payload: dict = Body(...)):
    u = _usuario(request)
    cliente = str(payload.get('cliente') or '').strip()
    dias = max(1, min(int(payload.get('dias') or 30), 365))
    if len(cliente) < 3:
        raise HTTPException(400, 'Elige el cliente')
    if not disenos_de(cliente):
        raise HTTPException(400, 'Ese cliente no tiene pedidos en Producción: no habría diseños para reponer')
    token = secrets.token_urlsafe(24)
    with _connect() as db:
        db.execute('INSERT INTO club_links(token,cliente,creado_por,creado,vence,activo) VALUES(?,?,?,?,?,1)',
                   (token, cliente, u, _ahora(), (datetime.now(COL) + timedelta(days=dias)).replace(microsecond=0).isoformat()))
    return {'ok': True, 'token': token}


@router.get('/enlaces')
def listar_enlaces(request: Request):
    _usuario(request)
    with _connect() as db:
        filas = [dict(r) for r in db.execute('SELECT l.*, (SELECT COUNT(*) FROM club_pedidos p WHERE p.link_id=l.id) AS pedidos FROM club_links l WHERE activo=1 ORDER BY id DESC LIMIT 100')]
    ahora = _ahora()
    return {'enlaces': [{**f, 'vencido': bool(f['vence'] and f['vence'] < ahora)} for f in filas]}


@router.delete('/enlaces/{link_id}')
def revocar_enlace(request: Request, link_id: int):
    _usuario(request)
    with _connect() as db:
        db.execute('UPDATE club_links SET activo=0 WHERE id=?', (link_id,))
    return {'ok': True}


@router.get('/pedidos')
def listar_pedidos(request: Request, estado: str = ''):
    _usuario(request)
    with _connect() as db:
        q = 'SELECT * FROM club_pedidos' + (' WHERE estado=?' if estado else '') + ' ORDER BY id DESC LIMIT 200'
        filas = [dict(r) for r in db.execute(q, (estado,) if estado else ())]
    for f in filas:
        f['lineas'] = json.loads(f['lineas'] or '[]')
        f['prendas'] = sum(int(j.get('cantidad') or 1) for l in f['lineas'] for j in l.get('jugadores', []))
    return {'pedidos': [{k: v for k, v in f.items() if k != 'cot_cuerpo'} for f in filas]}


@router.post('/pedidos/{pedido_id}/resolver')
def resolver_pedido(request: Request, pedido_id: int, payload: dict = Body(...)):
    u = _usuario(request)
    estado = str(payload.get('estado') or '')
    if estado not in ('aprobada', 'rechazada', 'pendiente'):
        raise HTTPException(400, 'Estado no válido')
    with _connect() as db:
        if not db.execute('SELECT 1 FROM club_pedidos WHERE id=?', (pedido_id,)).fetchone():
            raise HTTPException(404, 'No existe esa reposición')
        db.execute('UPDATE club_pedidos SET estado=?, resuelto_por=?, resuelto=?, nota_comercial=? WHERE id=?',
                   (estado, u, _ahora(), str(payload.get('nota') or '')[:300], pedido_id))
    if estado != 'aprobada':
        return {'ok': True}
    if _programar is None:
        raise HTTPException(503, 'El puente hacia Producción no está configurado todavía')
    try:
        resultado = _programar(pedido_id, u)
    except ValueError as error:
        marcar_programacion(pedido_id, 'REVISAR', str(error))
        return {'ok': True, 'programacion': 'REVISAR', 'detalle': str(error)}
    return {'ok': True, **resultado}


@router.get('/pedidos/{pedido_id}/cotizacion/vista')
def vista_cotizacion(request: Request, pedido_id: int):
    """VISTA PREVIA (solo lectura): lo que EFFITRON enviaría a Effi para esta reposición. No crea nada."""
    _usuario(request)
    from app import effitron
    try:
        r = effitron.preparar(_pedido(pedido_id))
    except Exception as e:   # noqa: BLE001
        return {'ok': False, 'motivo': str(e)[:400]}
    return {'ok': True, 'resumen': r['resumen'], 'cuerpo': r['cuerpo']}


@router.post('/pedidos/{pedido_id}/cotizacion/reintentar')
def reintentar_cotizacion(request: Request, pedido_id: int):
    _usuario(request)
    from app import effitron
    if not effitron.activo():
        raise HTTPException(409, 'EFFITRON está apagado: no se crean cotizaciones todavía')
    actualizar_maestros_pedido(pedido_id)
    effitron.reintentar(pedido_id)
    return {'ok': True}


@router.get('/effitron')
def estado_effitron(request: Request):
    _usuario(request)
    from app import effitron
    return {**effitron.agente(), 'activo': effitron.activo()}


@router.get('/pedidos/{pedido_id}/cotizacion.pdf')
def pdf_comercial(request: Request, pedido_id: int):
    """La cotización que creó EFFITRON, para comercial."""
    _usuario(request)
    from app import effitron
    datos = effitron.pdf_bytes(pedido_id)
    if not datos:
        raise HTTPException(404, 'La cotización todavía no está lista')
    return Response(datos, media_type='application/pdf', headers={'Content-Disposition': f'inline; filename="Cotizacion_{pedido_id}.pdf"', 'Cache-Control': 'no-store'})


@router.get('/pedidos/{pedido_id}/excel')
def excel_pedido(request: Request, pedido_id: int):
    """El listado en la plantilla de Indoor (.xlsm): un archivo por referencia; si son varias, vienen juntas en un .zip."""
    _usuario(request)
    p = _pedido(pedido_id)
    try:
        archivos = construir_excels(p)
    except OSError:
        raise HTTPException(503, 'No pude leer la plantilla de listado del NAS')
    if len(archivos) == 1:
        nombre, datos = archivos[0]
        return Response(datos, media_type='application/vnd.ms-excel.sheet.macroEnabled.12', headers={'Content-Disposition': f'attachment; filename="{nombre}"', 'Cache-Control': 'no-store'})
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for nombre, datos in archivos:
            z.writestr(nombre, datos)
    return Response(buf.getvalue(), media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="Reposicion_{pedido_id}.zip"', 'Cache-Control': 'no-store'})


# ------------------------------------------------------------------ cliente (enlace privado)
@public.get('/{token}/disenos')
def disenos(request: Request, token: str):
    if _too_many('club-disenos', request, 40):
        raise HTTPException(429, 'Demasiadas solicitudes. Intenta en un minuto.')
    link = _enlace(token)
    catalogo = proyectos_maestros_de(link['cliente'])
    lista = disenos_de(link['cliente'], catalogo)
    for d in lista:
        try:
            if d.get('maestro_nas'):
                d['mockups'] = {'mockups': [], 'mockups_lista': None}
                d.pop('cantidad', None)
                continue
            d['mockups'] = _mockups(d['row'])
        except Exception:   # noqa: BLE001  (NAS caída: el diseño se muestra sin imagen)
            d['mockups'] = {'mockups': [], 'mockups_lista': None}
        d.pop('cantidad', None)
    disponibles = {_plano(d['proyecto']): 0 for d in lista}
    for d in lista:
        disponibles[_plano(d['proyecto'])] = disponibles.get(_plano(d['proyecto']), 0) + 1
    proyectos = [{'nombre': p['proyecto'], 'referencias': len(p['referencias']), 'disenos': p['disenos'],
                  'disponibles': disponibles.get(_plano(p['proyecto']), 0)} for p in catalogo]
    return {'cliente': link['cliente'], 'tallas': TALLAS, 'disenos': lista, 'proyectos': proyectos,
            'catalogo_pendiente': catalogo_maestros_pendiente(link['cliente'])}


@public.get('/{token}/pedido/{pedido_id}')
def estado_pedido(request: Request, token: str, pedido_id: int):
    """El cliente consulta cómo va su cotización (la página lo repite cada pocos segundos)."""
    if _too_many('club-estado', request, 120):
        raise HTTPException(429, 'Demasiadas solicitudes.')
    link = _enlace(token)
    p = _pedido(pedido_id)
    if p['link_id'] != link['id']:
        raise HTTPException(404, 'No existe ese pedido')
    from app import effitron
    e = effitron.estado_publico(pedido_id)
    e['url'] = f'/api/club/{token}/pedido/{pedido_id}/cotizacion.pdf' if e['pdf'] else ''
    return e


@public.get('/{token}/pedido/{pedido_id}/cotizacion.pdf')
def pdf_pedido(request: Request, token: str, pedido_id: int):
    if _too_many('club-pdf', request, 30):
        raise HTTPException(429, 'Demasiadas solicitudes.')
    link = _enlace(token)
    p = _pedido(pedido_id)
    if p['link_id'] != link['id']:
        raise HTTPException(404, 'No existe ese pedido')
    from app import effitron
    datos = effitron.pdf_bytes(pedido_id)
    if not datos:
        raise HTTPException(404, 'La cotización todavía no está lista')
    return Response(datos, media_type='application/pdf', headers={'Content-Disposition': f'inline; filename="Cotizacion_{p["cot_numero"] or pedido_id}.pdf"', 'Cache-Control': 'private, max-age=300'})


@public.post('/{token}/pedido')
def enviar_pedido(request: Request, token: str, payload: dict = Body(...)):
    if _too_many('club-pedido', request, 6, 3600):
        raise HTTPException(429, 'Ya enviaste varias reposiciones. Intenta de nuevo más tarde.')
    if payload.get('website'):   # campo trampa para bots
        return {'ok': True, 'numero': 0}
    link = _enlace(token)
    validas = {d['row']: d for d in disenos_de(link['cliente'])}
    lineas, total = [], 0
    for l in (payload.get('lineas') or [])[:20]:
        d = validas.get(int(l.get('row') or 0))
        if not d:
            raise HTTPException(400, 'Un diseño no pertenece a este club')
        jugadores = []
        for j in (l.get('jugadores') or [])[:MAX_JUGADORES]:
            talla = str(j.get('talla') or '').strip().upper()
            cant = int(j.get('cantidad') or 1)
            if talla not in TALLAS or not 1 <= cant <= 50:
                raise HTTPException(400, 'Revisa las tallas y las cantidades (de 1 a 50 por jugador)')
            genero = str(j.get('genero') or '').upper()
            jugadores.append({'nombre': re.sub(r'\s+', ' ', str(j.get('nombre') or '')).strip()[:40], 'numero': re.sub(r'[^0-9A-Za-z]', '', str(j.get('numero') or ''))[:4],
                              'talla': talla, 'cantidad': cant, 'diseno': max(1, min(int(j.get('diseno') or 1), 20)), 'genero': genero if genero in ('MASC', 'FEM') else '',
                              'observacion': re.sub(r'\s+', ' ', str(j.get('observacion') or '')).strip()[:80]})
            total += cant
        if jugadores:
            tela, codigo = tela_de(d['row']) if d['row'] > 0 else ('', '')
            lineas.append({'row': d['row'], 'referencia': d['referencia'], 'proyecto': d['proyecto'], 'orden_base': d['orden'], 'tela': tela, 'codigo_tela': codigo, 'maestro_nas': bool(d.get('maestro_nas')), 'jugadores': jugadores})
    if not lineas:
        raise HTTPException(400, 'Agrega al menos una prenda')
    contacto = re.sub(r'\s+', ' ', str(payload.get('contacto') or '')).strip()[:80]
    telefono = re.sub(r'[^0-9+ ()-]', '', str(payload.get('telefono') or ''))[:25]
    with _connect() as db:
        cur = db.execute('INSERT INTO club_pedidos(link_id,cliente,contacto,telefono,notas,lineas,estado,creado) VALUES(?,?,?,?,?,?,\'pendiente\',?)',
                         (link['id'], link['cliente'], contacto, telefono, str(payload.get('notas') or '')[:400], json.dumps(lineas, ensure_ascii=False), _ahora()))
        numero = cur.lastrowid
    log.info('Reposición de club #%s (%s): %s prendas', numero, link['cliente'], total)
    cotiza = False
    try:   # EFFITRON (apagado por defecto: EFFITRON_ACTIVO=1 lo enciende) crea la cotización en Effi
        from app import effitron
        if effitron.activo():
            effitron.encolar(numero)
            cotiza = True
    except Exception:   # noqa: BLE001
        log.exception('No se pudo encolar la cotización del pedido %s', numero)
    try:   # al confirmar se arma el listado en Excel (referencia y código de tela de la vez pasada) y queda guardado
        EXCEL_DIR.mkdir(parents=True, exist_ok=True)
        for nombre, datos in construir_excels(_pedido(numero)):
            (EXCEL_DIR / nombre).write_bytes(datos)
    except Exception:   # noqa: BLE001
        log.exception('No se pudo guardar el Excel de la reposición %s', numero)
    return {'ok': True, 'numero': numero, 'prendas': total, 'cotizacion': cotiza}


@pagina.get('/club/{token}', response_class=HTMLResponse)
def pagina_club(token: str):
    html = (Path(__file__).with_name('fragmentos') / 'club.html').read_text(encoding='utf-8')
    return HTMLResponse(html.replace('__TOKEN__', re.sub(r'[^A-Za-z0-9_-]', '', token)), headers={'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
                                                                                                'Referrer-Policy': 'no-referrer'})
