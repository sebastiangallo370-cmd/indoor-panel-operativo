"""AGENTE EXCEL: el listado del pedido se llena SOLO, a la vista, en el Excel de escritorio del computador del comercial (Windows o Mac).

Todo vive en el VPS; en cada PC solo corre un agente pequeño (carpeta agente_excel/ del repo, instaladores en GitHub Releases):
  1. El comercial descarga el agente desde PROGRAMAR CLUB → AGENTE EXCEL, lo abre y pega el código de vinculación que le da el panel.
  2. El agente pregunta cada pocos segundos si hay trabajo (token propio, guardado en su PC).
  3. Al pulsar PROGRAMAR PEDIDO, el panel arma el Excel como siempre y, si ese comercial tiene su agente conectado, le deja un trabajo:
     la plantilla «base» (sin datos ni mockups) + el «plan» (qué escribir en cada celda y dónde va cada mockup).
  4. El agente abre Excel, escribe celda por celda, inserta los mockups, guarda el archivo y avisa. La orden en Producción/NAS la sigue haciendo el VPS.
Datos: /data/state/agente_excel.json (códigos, equipos con el hash del token, trabajos) y /data/state/agente_excel/<trabajo>/ (base, imágenes, plan).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(prefix='/api/agente-excel', tags=['agente-excel'])
pc_router = APIRouter(prefix='/api/agente-excel/pc', tags=['agente-excel-pc'])

ESTADO = Path(os.getenv('AGENTE_EXCEL_ESTADO', '/data/state/agente_excel.json'))
CARPETA = Path(os.getenv('AGENTE_EXCEL_DIR', '/data/state/agente_excel'))
CODIGO_VENCE = 600          # el código de vinculación sirve 10 minutos
CONECTADO_SEG = 90          # un agente que preguntó hace menos de esto se considera conectado
TRABAJO_VENCE = 3 * 3600    # los trabajos viejos se borran
REPO = os.getenv('AGENTE_EXCEL_REPO', 'sebastiangallo370-cmd/indoor-panel-operativo')
DESCARGAS = {
    'windows': f'https://github.com/{REPO}/releases/download/agente-excel/AgenteExcelIndoor-Windows.zip',
    'mac': f'https://github.com/{REPO}/releases/download/agente-excel/AgenteExcelIndoor-Mac.zip',
}
_lock = threading.Lock()
_auth: Callable = lambda request: ''


def configurar(auth: Callable) -> None:
    global _auth
    _auth = auth


def _usuario(request: Request) -> str:
    u = str(_auth(request) or '').strip()
    if not u:
        raise HTTPException(401, 'Inicia sesión')
    return u


def _leer() -> dict:
    try:
        d = json.loads(ESTADO.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    for k in ('codigos', 'equipos', 'trabajos'):
        d.setdefault(k, {})
    return d


def _guardar(d: dict) -> None:
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(ESTADO)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _limpiar(d: dict, ahora: float) -> None:
    d['codigos'] = {k: v for k, v in d['codigos'].items() if v.get('vence', 0) > ahora}
    for tid in [t for t, v in d['trabajos'].items() if ahora - v.get('creado', 0) > TRABAJO_VENCE]:
        d['trabajos'].pop(tid, None)
        shutil.rmtree(CARPETA / tid, ignore_errors=True)


# ---------------------------------------------------------------- plan y base a partir del Excel ya armado
def _es_dato(r: int, c: int) -> bool:
    """Celdas que llena el panel (listado_pedido._llenar_hoja): cabecera J2:J6, P2:P3, AG3 y, desde la fila 8, NOMBRE..OBSERVACIÓN (C..R)."""
    return (2 <= r <= 6 and c == 10) or (r in (2, 3) and c == 16) or (r == 3 and c == 33) or (r >= 8 and 3 <= c <= 18)


def preparar_trabajo(final: Path, destino: Path) -> dict:
    """Desde el Excel final (con datos y mockups) guarda la BASE (misma plantilla, sin datos ni mockups), las imágenes y el PLAN de llenado."""
    from io import BytesIO
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    destino.mkdir(parents=True, exist_ok=True)
    wb = load_workbook(final, keep_vba=True)
    plan = {'hojas': []}
    n_img = 0
    for ws in wb.worksheets:
        celdas = []
        ultima = 7
        for r in range(8, min(ws.max_row, 700) + 1):
            if any(ws.cell(row=r, column=c).value not in (None, '') for c in range(3, 19)):
                ultima = r
        filas = [2, 3, 4, 5, 6] + list(range(8, ultima + 1))
        for r in filas:
            for c in range(3, 34):
                if not _es_dato(r, c):
                    continue
                v = ws.cell(row=r, column=c).value
                if v in (None, ''):
                    continue
                valor = v.strftime('%Y-%m-%d') if hasattr(v, 'strftime') else v
                celdas.append({'celda': f'{get_column_letter(c)}{r}', 'valor': valor, 'fecha': hasattr(v, 'strftime')})
                ws.cell(row=r, column=c).value = None
        imagenes, quedan = [], []
        for im in list(getattr(ws, '_images', [])):
            de = getattr(im.anchor, '_from', None)
            if de is not None and de.col <= 4 and de.row <= 6:      # el logo de la plantilla se queda
                quedan.append(im)
                continue
            ext = getattr(im.anchor, 'ext', None)
            hasta = getattr(im.anchor, 'to', None)
            n_img += 1
            nombre = f'mockup_{n_img}.png'
            try:
                from PIL import Image
                Image.open(BytesIO(im._data())).convert('RGB').save(destino / nombre, 'PNG')
            except Exception:  # noqa: BLE001
                continue
            celda = f'{get_column_letter((de.col if de else 0) + 1)}{(de.row if de else 0) + 1}'
            ancho = int(ext.width / 12700) if ext is not None and getattr(ext, 'width', None) else None      # EMU -> puntos (lo que usa Excel)
            alto = int(ext.height / 12700) if ext is not None and getattr(ext, 'height', None) else None
            hasta_celda = f'{get_column_letter(hasta.col + 1)}{hasta.row + 1}' if hasta is not None else ''
            imagenes.append({'archivo': nombre, 'celda': celda, 'hasta': hasta_celda, 'ancho': ancho, 'alto': alto})
        ws._images = quedan
        plan['hojas'].append({'nombre': ws.title, 'celdas': celdas, 'imagenes': imagenes})
    base = destino / ('base' + final.suffix)
    wb.save(base)
    (destino / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, default=str), encoding='utf-8')
    return plan


def conectado(usuario: str, d: dict | None = None) -> bool:
    d = d or _leer()
    ahora = time.time()
    return any(e.get('usuario') == usuario and ahora - e.get('visto', 0) < CONECTADO_SEG for e in d['equipos'].values())


def encolar(usuario: str, final: Path, nombre: str) -> str | None:
    """Deja el trabajo al agente de ESE comercial (si está conectado). Devuelve el id del trabajo o None."""
    with _lock:
        d = _leer()
        if not conectado(usuario, d):
            return None
        tid = secrets.token_hex(8)
    plan = preparar_trabajo(Path(final), CARPETA / tid)
    with _lock:
        d = _leer()
        d['trabajos'][tid] = {'usuario': usuario, 'nombre': nombre, 'estado': 'pendiente', 'detalle': 'Esperando a tu agente Excel…', 'creado': time.time(),
                              'base': 'base' + Path(final).suffix, 'celdas': sum(len(h['celdas']) for h in plan['hojas'])}
        _guardar(d)
    return tid


# ---------------------------------------------------------------- lo que usa el panel (con sesión)
@router.post('/codigo')
def nuevo_codigo(request: Request):
    u = _usuario(request)
    codigo = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
    with _lock:
        d = _leer(); _limpiar(d, time.time())
        d['codigos'][codigo] = {'usuario': u, 'vence': time.time() + CODIGO_VENCE}
        _guardar(d)
    return {'codigo': codigo, 'vence_seg': CODIGO_VENCE}


@router.get('/estado')
def estado(request: Request):
    u = _usuario(request)
    d = _leer(); ahora = time.time()
    equipos = [{'equipo': e.get('equipo', ''), 'so': e.get('so', ''), 'version': e.get('version', ''), 'conectado': ahora - e.get('visto', 0) < CONECTADO_SEG,
                'visto_hace': int(ahora - e.get('visto', 0)) if e.get('visto') else None} for e in d['equipos'].values() if e.get('usuario') == u]
    return {'equipos': equipos, 'conectado': any(x['conectado'] for x in equipos), 'descargas': DESCARGAS}


@router.get('/trabajo/{tid}')
def ver_trabajo(request: Request, tid: str):
    u = _usuario(request)
    t = _leer()['trabajos'].get(tid)
    if not t or t.get('usuario') != u:
        raise HTTPException(404, 'No existe ese trabajo')
    return {'estado': t['estado'], 'detalle': t.get('detalle', '')}


@router.post('/abrir/{codigo}')
def abrir_pedido(request: Request, codigo: str):
    """Vuelve a abrir y llenar en Excel (en el PC del usuario) el listado de un pedido ya programado desde el panel, p. ej. CO6379."""
    import os
    import re
    u = _usuario(request)
    codigo = re.sub(r'[^A-Z0-9]', '', codigo.upper())
    carpeta = Path(os.getenv('PEDIDO_EFFI_EXCEL_DIR', '/data/state/pedido_effi_excel')) / codigo
    archivos = sorted(carpeta.glob('*.xls*')) if codigo and carpeta.is_dir() else []
    if not archivos:
        raise HTTPException(404, f'No encuentro el listado de {codigo or "ese pedido"}: debe haberse programado desde EMPEZAR PEDIDO')
    tid = encolar(u, archivos[0], archivos[0].name)
    if not tid:
        raise HTTPException(409, 'Tu agente Excel no está conectado: ábrelo en este computador y vuelve a intentar')
    return {'trabajo': tid, 'nombre': archivos[0].name}


# ---------------------------------------------------------------- lo que usa el agente del PC (con su token)
def _equipo(request: Request) -> tuple[str, dict]:
    token = (request.headers.get('authorization') or '').removeprefix('Bearer ').strip()
    if not token:
        raise HTTPException(401, 'Falta el token del agente')
    h = _hash(token)
    e = _leer()['equipos'].get(h)
    if not e:
        raise HTTPException(401, 'Este agente no está vinculado: pide un código nuevo en el panel')
    return h, e


@pc_router.post('/enlazar')
def enlazar(payload: dict):
    codigo = re.sub(r'[^A-Z0-9]', '', str(payload.get('codigo') or '').upper())
    with _lock:
        d = _leer(); _limpiar(d, time.time())
        c = d['codigos'].pop(codigo, None)
        if not c:
            _guardar(d)
            raise HTTPException(400, 'Código no válido o vencido: genera uno nuevo en PROGRAMAR CLUB → AGENTE EXCEL')
        token = secrets.token_urlsafe(32)
        d['equipos'][_hash(token)] = {'usuario': c['usuario'], 'equipo': str(payload.get('equipo') or '')[:60], 'so': str(payload.get('so') or '')[:30],
                                      'creado': time.time(), 'visto': time.time()}
        _guardar(d)
    return {'token': token, 'usuario': c['usuario']}


@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    h, e = _equipo(request)
    ahora = time.time()
    with _lock:
        d = _leer()
        if h not in d['equipos']:
            raise HTTPException(401, 'Agente no vinculado')
        d['equipos'][h]['visto'] = ahora
        if payload.get('version'):
            d['equipos'][h]['version'] = str(payload['version'])[:20]
        viejo = tuple(int(x) for x in re.findall(r'\d+', d['equipos'][h].get('version') or '0')[:3]) < (1, 0, 3)
        for r in (payload.get('resultados') or [])[:20]:
            t = d['trabajos'].get(str(r.get('id') or ''))
            if t and t['usuario'] == e['usuario'] and r.get('estado') in ('llenando', 'listo', 'error'):
                t['estado'] = r['estado']; t['detalle'] = str(r.get('detalle') or '')[:300]
        trabajos = []
        if payload.get('puede_trabajar', True):
            for tid, t in d['trabajos'].items():
                if t['usuario'] == e['usuario'] and t['estado'] == 'pendiente':
                    if viejo:   # la 1.0.2 abría siempre «base.xlsm» y Excel no deja abrir dos libros con ese nombre
                        t['estado'] = 'error'; t['detalle'] = 'Tu agente Excel está desactualizado: cierra Excel y el agente (Ctrl+Q), descarga el nuevo en PROGRAMAR CLUB → AGENTE EXCEL y ábrelo.'
                        continue
                    plan = json.loads((CARPETA / tid / 'plan.json').read_text(encoding='utf-8'))
                    trabajos.append({'id': tid, 'nombre': t['nombre'], 'base': f'/api/agente-excel/pc/archivo/{tid}/{t["base"]}', 'plan': plan,
                                     'imagenes_url': f'/api/agente-excel/pc/archivo/{tid}/'})
                    t['estado'] = 'entregado'; t['detalle'] = 'Tu agente lo recibió: abriendo Excel…'
                    break
        _guardar(d)
    return {'trabajos': trabajos, 'usuario': e['usuario']}


@pc_router.get('/archivo/{tid}/{nombre}')
def archivo(request: Request, tid: str, nombre: str):
    h, e = _equipo(request)
    t = _leer()['trabajos'].get(tid)
    if not t or t['usuario'] != e['usuario'] or not re.fullmatch(r'[A-Za-z0-9_.-]{1,60}', nombre) or nombre == 'plan.json':
        raise HTTPException(404, 'No existe')
    ruta = CARPETA / tid / nombre
    if not ruta.is_file():
        raise HTTPException(404, 'No existe')
    return FileResponse(ruta, filename=nombre)
