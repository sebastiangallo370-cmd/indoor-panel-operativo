"""Tienda de reposiciones por club.

Comercial genera un ENLACE PRIVADO para un cliente (club). Con ese enlace el cliente ve los diseños que ya produjo con Indoor y arma una reposición
(jugadores con nombre, número, talla y cantidad). La reposición llega a comercial como «pendiente»: comercial la revisa y la aprueba o la rechaza
(después la programa como cualquier pedido). Sin precios ni pagos en esta versión.

Datos en jobs.sqlite3: club_links (enlaces) y club_pedidos (reposiciones). El token del enlace es largo y aleatorio; se puede revocar.
Los diseños salen de Producción (mismos mockups firmados de la consulta pública), y solo los del cliente dueño del enlace.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import secrets
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
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
COL = timezone(timedelta(hours=-5))
TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']
MAX_JUGADORES = 300
EXCEL_DIR = Path(os.getenv('CLUB_EXCEL_DIR', '/data/state/club_excel'))


def configurar(connect: Callable, auth: Callable, permitido: Callable[[str], bool], too_many: Callable, mockups: Callable[[int], dict]) -> None:
    global _connect, _auth, _permitido, _too_many, _mockups
    _connect, _auth, _permitido, _too_many, _mockups = connect, auth, permitido, too_many, mockups
    with _connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS club_links(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, cliente TEXT, creado_por TEXT, creado TEXT, vence TEXT, activo INTEGER DEFAULT 1)')
        db.execute('CREATE TABLE IF NOT EXISTS club_pedidos(id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER, cliente TEXT, contacto TEXT, telefono TEXT, notas TEXT, '
                   'lineas TEXT, estado TEXT DEFAULT \'pendiente\', creado TEXT, resuelto_por TEXT, resuelto TEXT, nota_comercial TEXT)')


def _ahora() -> str:
    return datetime.now(COL).replace(microsecond=0).isoformat()


def _plano(t) -> str:
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if unicodedata.category(c) != 'Mn')).strip().upper()


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


def construir_excel(p: dict) -> bytes:
    """Listado de la reposición en un formato fijo: cada fila repite la REFERENCIA y el CÓDIGO DE TELA del pedido anterior."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = 'LISTADO'
    negrita, lima = Font(bold=True), PatternFill('solid', fgColor='D0F44C')
    ws.append(['REPOSICIÓN CLUB #%s' % p['id'], '', '', '', '', '', ''])
    ws['A1'].font = Font(bold=True, size=14)
    for etiqueta, valor in (('CLIENTE', p['cliente']), ('CONTACTO', p['contacto']), ('TELÉFONO', p['telefono']), ('FECHA', str(p['creado'])[:16].replace('T', ' ')), ('NOTAS', p.get('notas') or '')):
        ws.append([etiqueta, valor])
        ws.cell(row=ws.max_row, column=1).font = negrita
    ws.append([])
    cab = ['REFERENCIA', 'CÓDIGO TELA', 'TELA', 'PEDIDO BASE', 'N° CAMISETA', 'NOMBRE EN LA PRENDA', 'TALLA', 'CANTIDAD']
    ws.append(cab)
    for c in range(1, len(cab) + 1):
        ws.cell(row=ws.max_row, column=c).font = negrita
        ws.cell(row=ws.max_row, column=c).fill = lima
    total = 0
    for l in p['lineas']:
        for j in l['jugadores']:
            ws.append([l['referencia'], l.get('codigo_tela', ''), l.get('tela', ''), l.get('orden_base', ''), j.get('numero', ''), j.get('nombre', ''), j.get('talla', ''), int(j.get('cantidad') or 1)])
            total += int(j.get('cantidad') or 1)
    ws.append([])
    ws.append(['TOTAL PRENDAS', '', '', '', '', '', '', total])
    ws.cell(row=ws.max_row, column=1).font = negrita
    ws.cell(row=ws.max_row, column=8).font = negrita
    for col, ancho in zip('ABCDEFGH', (16, 14, 20, 14, 14, 30, 8, 10)):
        ws.column_dimensions[col].width = ancho
    for fila in ws.iter_rows():
        for celda in fila:
            celda.alignment = Alignment(vertical='center')
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _pedido(pedido_id: int) -> dict:
    with _connect() as db:
        r = db.execute('SELECT * FROM club_pedidos WHERE id=?', (pedido_id,)).fetchone()
    if not r:
        raise HTTPException(404, 'No existe esa reposición')
    p = dict(r)
    p['lineas'] = json.loads(p['lineas'] or '[]')
    return p


# ------------------------------------------------------------------ diseños del cliente (desde Producción)
def disenos_de(cliente: str) -> list[dict]:
    """Las referencias que ya se produjeron para ese cliente: la más reciente de cada referencia, con su fila para sacar el mockup."""
    with _connect() as db:
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not meta:
            return []
        h = [str(x or '').strip().upper() for x in json.loads(meta['value'])]
        ix = {n: h.index(n) for n in ('NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO', 'ORDEN', 'REFERENCIA', 'CANTIDAD', 'FECHA DE INICIO', 'TIPO DE DISEÑO') if n in h}
        if 'NOMBRE DEL CLIENTE' not in ix or 'REFERENCIA' not in ix:
            return []
        objetivo = _plano(cliente)
        salida: dict[str, dict] = {}
        for r in db.execute('SELECT source_row, values_json FROM production_rows ORDER BY source_row DESC'):
            v = json.loads(r['values_json'])
            cel = lambda n: str(v[ix[n]] or '').strip() if n in ix and ix[n] < len(v) else ''
            if _plano(cel('NOMBRE DEL CLIENTE')) != objetivo:
                continue
            ref = cel('REFERENCIA').upper()
            if not ref or ref in salida:
                continue
            salida[ref] = {'row': r['source_row'], 'referencia': ref, 'proyecto': cel('NOMBRE PROYECTO'), 'orden': cel('ORDEN'), 'cantidad': cel('CANTIDAD'), 'fecha': cel('FECHA DE INICIO'),
                           'tipo': cel('TIPO DE DISEÑO')}
    return list(salida.values())[:40]


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
    return {'pedidos': filas}


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
    return {'ok': True}


@router.get('/pedidos/{pedido_id}/excel')
def excel_pedido(request: Request, pedido_id: int):
    _usuario(request)
    p = _pedido(pedido_id)
    guardado = EXCEL_DIR / f'reposicion-{pedido_id}.xlsx'
    datos = guardado.read_bytes() if guardado.is_file() else construir_excel(p)
    nombre = re.sub(r'[^A-Za-z0-9_-]+', '_', p['cliente'])[:40]
    return Response(datos, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': f'attachment; filename="Reposicion_{pedido_id}_{nombre}.xlsx"', 'Cache-Control': 'no-store'})


# ------------------------------------------------------------------ cliente (enlace privado)
@public.get('/{token}/disenos')
def disenos(request: Request, token: str):
    if _too_many('club-disenos', request, 40):
        raise HTTPException(429, 'Demasiadas solicitudes. Intenta en un minuto.')
    link = _enlace(token)
    lista = disenos_de(link['cliente'])
    for d in lista:
        try:
            d['mockups'] = _mockups(d['row'])
        except Exception:   # noqa: BLE001  (NAS caída: el diseño se muestra sin imagen)
            d['mockups'] = {'mockups': [], 'mockups_lista': None}
        d.pop('cantidad', None)
    return {'cliente': link['cliente'], 'tallas': TALLAS, 'disenos': lista}


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
            jugadores.append({'nombre': re.sub(r'\s+', ' ', str(j.get('nombre') or '')).strip()[:40], 'numero': re.sub(r'[^0-9A-Za-z]', '', str(j.get('numero') or ''))[:4],
                              'talla': talla, 'cantidad': cant})
            total += cant
        if jugadores:
            tela, codigo = tela_de(d['row'])
            lineas.append({'row': d['row'], 'referencia': d['referencia'], 'proyecto': d['proyecto'], 'orden_base': d['orden'], 'tela': tela, 'codigo_tela': codigo, 'jugadores': jugadores})
    if not lineas:
        raise HTTPException(400, 'Agrega al menos una prenda')
    contacto = re.sub(r'\s+', ' ', str(payload.get('contacto') or '')).strip()[:80]
    telefono = re.sub(r'[^0-9+ ()-]', '', str(payload.get('telefono') or ''))[:25]
    if len(contacto) < 2 or len(re.sub(r'\D', '', telefono)) < 7:
        raise HTTPException(400, 'Escribe tu nombre y un teléfono de contacto')
    with _connect() as db:
        cur = db.execute('INSERT INTO club_pedidos(link_id,cliente,contacto,telefono,notas,lineas,estado,creado) VALUES(?,?,?,?,?,?,\'pendiente\',?)',
                         (link['id'], link['cliente'], contacto, telefono, str(payload.get('notas') or '')[:400], json.dumps(lineas, ensure_ascii=False), _ahora()))
        numero = cur.lastrowid
    log.info('Reposición de club #%s (%s): %s prendas', numero, link['cliente'], total)
    try:   # al confirmar se arma el listado en Excel (referencia y código de tela de la vez pasada) y queda guardado
        EXCEL_DIR.mkdir(parents=True, exist_ok=True)
        (EXCEL_DIR / f'reposicion-{numero}.xlsx').write_bytes(construir_excel(_pedido(numero)))
    except Exception:   # noqa: BLE001
        log.exception('No se pudo guardar el Excel de la reposición %s', numero)
    return {'ok': True, 'numero': numero, 'prendas': total}


@pagina.get('/club/{token}', response_class=HTMLResponse)
def pagina_club(token: str):
    html = (Path(__file__).with_name('fragmentos') / 'club.html').read_text(encoding='utf-8')
    return HTMLResponse(html.replace('__TOKEN__', re.sub(r'[^A-Za-z0-9_-]', '', token)), headers={'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
                                                                                                'Referrer-Policy': 'no-referrer'})
