"""Puente de MARCAMAN (corte láser). La PC de la cortadora envía al VPS cada dorsal detectado por la cámara.

Mismo esquema que el canal de los agentes de Illustrator: el PC se identifica con el token de agentes
(header x-agentes-token, archivo agentes_token.txt). El VPS guarda la cola en /data/state/marcaman.json,
evita registrar dos veces el mismo dorsal dentro de un pedido y deja ver el estado en el panel.
La X en Excel la marca el programa de la PC (Excel está allí); el VPS solo recibe y conserva lo detectado.
"""
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Request

from app import agentes_canal

_archivo = Path(os.getenv('MARCAMAN_FILE', '/data/state/marcaman.json'))
_candado = threading.Lock()
MAX_DETECCIONES = 5000
LATIDO_SEG = 25   # igual que el canal de Illustrator: el PC está conectado si avisó hace menos de esto

pc_router = APIRouter(prefix='/api/marcaman', tags=['marcaman'])      # lo llama la PC (token)
panel_router = APIRouter(prefix='/api/marcaman', tags=['marcaman'])   # lo ve el panel (sesión)


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _validar_pc(request: Request) -> None:
    recibido = request.headers.get('x-agentes-token', '')
    esperado = agentes_canal._token()
    if not recibido or not esperado or not secrets.compare_digest(recibido, esperado):
        raise HTTPException(401, 'Token del PC no válido')


def _leer() -> dict:
    try:
        datos = json.loads(_archivo.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('detecciones', [])
    datos.setdefault('latido', {})
    datos.setdefault('orden', {})
    return datos


def _guardar(datos: dict) -> None:
    _archivo.parent.mkdir(parents=True, exist_ok=True)
    temporal = _archivo.with_suffix('.tmp')
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    temporal.replace(_archivo)


@pc_router.post('/latido')
def latido(request: Request, payload: dict = Body(default={})):
    """El PC avisa que está vivo (mismo esquema que el sondeo de los agentes de Illustrator)."""
    _validar_pc(request)
    with _candado:
        datos = _leer()
        datos['latido'] = {'at': time.time(), 'iso': _iso(), 'equipo': str((payload or {}).get('equipo', ''))[:60]}
        _guardar(datos)
    return {'ok': True}


@pc_router.get('/orden')
def orden_para_pc(request: Request):
    """La cortadora pregunta qué pedido y hoja están activos."""
    _validar_pc(request)
    return _leer().get('orden') or {}


@pc_router.post('/detecciones')
def recibir_deteccion(request: Request, payload: dict = Body(...)):
    """La cámara vio un dorsal. Si ya estaba en este pedido, no se vuelve a registrar."""
    _validar_pc(request)
    pedido = str(payload.get('pedido') or '').strip()[:40]
    numero = str(payload.get('numero') or '').strip()
    if not pedido or not numero.isdigit() or len(numero) > 4:
        raise HTTPException(400, 'Falta el pedido o el número del dorsal')
    clave = f'{pedido}|{numero}'
    with _candado:
        datos = _leer()
        existente = next((d for d in datos['detecciones'] if d['clave'] == clave), None)
        if existente:
            return {'ok': True, 'duplicado': True, 'id': existente['id'], 'estado': existente['estado']}
        item = {
            'id': secrets.token_hex(6), 'clave': clave, 'pedido': pedido, 'numero': numero,
            'nombre': str(payload.get('nombre') or '').strip()[:80],
            'foto': str(payload.get('foto') or '')[:200],
            'recibido': _iso(), 'estado': 'pendiente_excel', 'detalle': '',
        }
        datos['detecciones'].append(item)
        datos['detecciones'] = datos['detecciones'][-MAX_DETECCIONES:]
        _guardar(datos)
    return {'ok': True, 'duplicado': False, 'id': item['id'], 'estado': item['estado']}


@pc_router.post('/resultado')
def resultado_excel(request: Request, payload: dict = Body(...)):
    """El programa de la PC informa si la X quedó marcada en Excel (o por qué no)."""
    _validar_pc(request)
    did = str(payload.get('id') or '')
    estado = str(payload.get('estado') or '')
    if estado not in ('marcada', 'duplicada', 'error', 'pendiente_excel'):
        raise HTTPException(400, 'Estado no válido')
    with _candado:
        datos = _leer()
        item = next((d for d in datos['detecciones'] if d['id'] == did), None)
        if not item:
            raise HTTPException(404, 'Detección no encontrada')
        item['estado'] = estado
        item['detalle'] = str(payload.get('detalle') or '')[:300]
        item['actualizado'] = _iso()
        _guardar(datos)
    return {'ok': True}


@panel_router.post('/orden')
def fijar_orden(payload: dict = Body(...)):
    """Panel: indica qué pedido y qué hoja (pestaña) se va a cortar. La cortadora la lee y la usa."""
    pedido = str(payload.get('pedido') or '').strip().upper()[:40]
    hoja = str(payload.get('hoja') or '').strip()[:40]
    if not pedido or not hoja:
        raise HTTPException(400, 'Indique el pedido y la hoja que va a cortar')
    with _candado:
        datos = _leer()
        datos['orden'] = {'pedido': pedido, 'hoja': hoja, 'desde': _iso()}
        _guardar(datos)
    return {'ok': True, 'orden': datos['orden']}


@panel_router.get('/estado')
def estado_panel(pedido: str = ''):
    """Panel: últimas detecciones y conteos (opcionalmente de un pedido)."""
    datos = _leer()
    lista = [d for d in datos['detecciones'] if not pedido or d['pedido'] == pedido]
    conteos = {}
    for d in lista:
        conteos[d['estado']] = conteos.get(d['estado'], 0) + 1
    latido = datos.get('latido') or {}
    conectado = time.time() - float(latido.get('at', 0)) < LATIDO_SEG
    return {'total': len(lista), 'conteos': conteos, 'ultimas': list(reversed(lista[-50:])),
            'conectado': conectado, 'visto': latido.get('iso', ''), 'equipo': latido.get('equipo', ''),
            'orden': datos.get('orden') or {}}
