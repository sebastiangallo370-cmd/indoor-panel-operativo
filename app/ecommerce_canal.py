"""ECOMMERCE: control web de los bots de Effi (carpeta «AUTOMATIZACION_PAGINA WEB»).

Hace desde el panel lo mismo que el PANEL_CONTROL de escritorio: iniciar, detener y vigilar los bots que corren
en el PC de la oficina (descargan documentos de Effi ERP, los convierten en filas de Google Sheets, listados de
producción, stickers y PDF de Illustrator). El panel no se conecta al PC: el PC pregunta cada pocos segundos
(sondeo saliente, sin abrir puertos), recibe las órdenes pendientes (iniciar / detener / reiniciar) y devuelve
el estado y las últimas líneas del log de cada bot.

Agentes (nombres propios, distintos de los de AGENTES):
  ALMA   remisiones de venta         (coordinador --tipo remision)
  BRISA  cotizaciones, impresión      (coordinador --tipo cotizacion)
  CIRO   cotizaciones, edición        (coordinador --tipo cotizacion_edicion)
  DARIO  órdenes de venta             (bot_ordenes_venta.py)
ALMA, BRISA y CIRO comparten Illustrator: el panel no deja correr dos a la vez (igual que el bot original).
Datos en /data/state/ecommerce.json y el token del PC en /data/state/ecommerce_token.txt.
"""
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix='/api/ecommerce', tags=['ecommerce'])            # personas (con sesión)
pc_router = APIRouter(prefix='/api/ecommerce/pc', tags=['ecommerce-pc'])   # el PC con los bots (con token)
_file = Path(os.getenv('ECOMMERCE_FILE', '/data/state/ecommerce.json'))
_token_file = Path(os.getenv('ECOMMERCE_TOKEN_FILE', '/data/state/ecommerce_token.txt'))
_lock = threading.Lock()
LATIDO_SEG = 25         # el PC se considera conectado si sondeó hace menos de esto
MAX_LOG = 1500
MAX_ORDENES = 120
ORDEN_VENCE_SEG = 120   # una orden que el PC no tomó en este tiempo se descarta (el PC estaba apagado)
_auth: Callable = lambda request: None
_permitido: Callable[[str], bool] = lambda usuario: False

AGENTES = [
    {'id': 'alma', 'nombre': 'ALMA', 'titulo': 'Remisiones de venta', 'tipo': 'coordinador', 'arg': 'remision', 'color': '#8bd450',
     'funciones': ['Entra a Effi ERP con la cuenta de la empresa y vigila las REMISIONES DE VENTA nuevas (no anuladas, desde la fecha mínima)',
                   'Descarga cada remisión como RM_<número>.pdf a la bandeja PDF',
                   'Lanza al agente de producción: lee el PDF, escribe una fila por referencia en Google Sheets y arma el listado de producción (Excel)',
                   'Genera los stickers y los PDF de producción en Illustrator']},
    {'id': 'brisa', 'nombre': 'BRISA', 'titulo': 'Cotizaciones · Impresión', 'tipo': 'coordinador', 'arg': 'cotizacion', 'color': '#6cb6ff',
     'funciones': ['Vigila las COTIZACIONES de Effi del centro de costos 4-Impresión',
                   'Descarga cada una como COT_<id>.pdf a la bandeja PDF',
                   'Lanza al agente de producción: fila por referencia en Google Sheets, listado de producción, stickers y PDF de Illustrator']},
    {'id': 'ciro', 'nombre': 'CIRO', 'titulo': 'Cotizaciones · Edición', 'tipo': 'coordinador', 'arg': 'cotizacion_edicion', 'color': '#ffb04a',
     'funciones': ['Vigila las COTIZACIONES de Effi del centro de costos 5-Edición',
                   'Descarga cada una como COT_<id>.pdf a la bandeja PDF (historial propio, separado del de BRISA)',
                   'Lanza al agente de producción con el mismo flujo de cotizaciones']},
    {'id': 'dario', 'nombre': 'DARIO', 'titulo': 'Órdenes de venta', 'tipo': 'ov', 'arg': '', 'color': '#b794f4',
     'funciones': ['Entra a Effi ERP y vigila las ÓRDENES DE VENTA nuevas',
                   'Descarga el PDF de cada orden (carpeta PDF_OV)',
                   'Busca el maestro en MAESTROS\\INTERCLASES 2027 y lo abre en Illustrator',
                   'Registra la orden en Google Sheets (ORDENES DE PRODUCCION)']},
]
POR_ID = {a['id']: a for a in AGENTES}
COORDINADORES = [a['id'] for a in AGENTES if a['tipo'] == 'coordinador']
ACCIONES = ('iniciar', 'detener', 'reiniciar')
ESTADOS_ACTIVOS = ('CORRIENDO', 'EN_FILA')


def configurar(autenticar: Callable, permitido: Callable[[str], bool]) -> None:
    global _auth, _permitido
    _auth, _permitido = autenticar, permitido


def _ahora() -> float:
    return time.time()


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _leer() -> dict:
    try:
        datos = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('seq', 0)
    datos.setdefault('latido', {})
    datos.setdefault('agentes', {})   # id -> {estado, desde, pid, ultima}
    datos.setdefault('ordenes', [])   # órdenes iniciar/detener/reiniciar para el PC
    datos.setdefault('log', [])
    return datos


def _guardar(datos: dict) -> None:
    datos['log'] = datos['log'][-MAX_LOG:]
    datos['ordenes'] = datos['ordenes'][-MAX_ORDENES:]
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _hash(valor: str) -> str:
    return hashlib.sha256(valor.encode('utf-8')).hexdigest()


def _token_hash() -> str:
    try:
        return _token_file.read_text(encoding='utf-8').strip()
    except OSError:
        return ''


def _usuario(request: Request) -> str:
    usuario = _auth(request)
    if not _permitido(str(usuario)):
        raise HTTPException(403, 'ECOMMERCE solo está disponible para Administración / Coordinación')
    return str(usuario)


def _pc(request: Request) -> None:
    recibido = request.headers.get('x-ecommerce-token', '')
    esperado = _token_hash()
    if not (recibido and esperado and secrets.compare_digest(_hash(recibido), esperado)):
        raise HTTPException(401, 'Token del PC no válido')


def _conectado(datos: dict) -> bool:
    return _ahora() - float((datos.get('latido') or {}).get('at') or 0) < LATIDO_SEG


def _vencer(datos: dict) -> None:
    for o in datos['ordenes']:
        if o['estado'] == 'pendiente' and _ahora() - o['at'] > ORDEN_VENCE_SEG:
            o['estado'], o['detalle'] = 'vencida', 'El PC no la tomó a tiempo (¿estaba apagado o sin conexión?)'
        elif o['estado'] == 'entregada' and _ahora() - o['at'] > 5 * ORDEN_VENCE_SEG:
            o['estado'], o['detalle'] = 'vencida', 'El PC la recibió pero no confirmó el resultado'


def _activos(datos: dict) -> list:
    return [i for i in COORDINADORES if (datos['agentes'].get(i) or {}).get('estado') in ESTADOS_ACTIVOS]


def _pendiente_de(datos: dict, agente: str, accion: str | None = None) -> bool:
    return any(o['estado'] in ('pendiente', 'entregada') and o['agente'] == agente and (accion is None or o['accion'] == accion) for o in datos['ordenes'])


def _nota(datos: dict, agente: str, nivel: str, texto: str) -> None:
    datos['seq'] += 1
    datos['log'].append({'id': datos['seq'], 'at': _ahora(), 'agente': agente, 'nivel': nivel, 'texto': str(texto)[:600]})


# ------------------------------------------------------------------ personas
@router.get('/mi')
def mi_acceso(request: Request):
    _usuario(request)
    return {'ok': True}


@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    with _lock:
        datos = _leer()
        _vencer(datos)
        agentes = []
        for a in AGENTES:
            info = datos['agentes'].get(a['id']) or {}
            agentes.append({**a, 'estado': info.get('estado', 'INACTIVO'), 'desde': info.get('desde'), 'ultima': info.get('ultima', ''),
                            'pendiente': next((o['accion'] for o in datos['ordenes'] if o['estado'] in ('pendiente', 'entregada') and o['agente'] == a['id']), '')})
        latido = datos.get('latido') or {}
        return {'agentes': agentes, 'pc': {'conectado': _conectado(datos), 'equipo': latido.get('equipo', ''), 'hace': round(_ahora() - float(latido.get('at') or 0)) if latido.get('at') else None,
                                          'hay_token': bool(_token_hash()), 'simulado': bool(latido.get('simulado'))},
                'ordenes': [{k: o[k] for k in ('id', 'agente', 'accion', 'por', 'estado', 'detalle', 'iso')} for o in datos['ordenes'][-8:]][::-1],
                'ultimo_log': datos['seq']}


@router.post('/agentes/{agente}/{accion}')
def ordenar(request: Request, agente: str, accion: str):
    usuario = _usuario(request)
    if agente not in POR_ID or accion not in ACCIONES:
        raise HTTPException(404, 'Agente o acción desconocidos')
    with _lock:
        datos = _leer()
        _vencer(datos)
        if not _conectado(datos):
            raise HTTPException(409, 'El PC de los bots no está conectado al panel. Enciéndelo y abre «ECOMMERCE · conectar» en ese PC.')
        if _pendiente_de(datos, agente):
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} ya tiene una orden en curso: espera a que el PC la termine.')
        actual = (datos['agentes'].get(agente) or {}).get('estado', 'INACTIVO')
        if accion in ('iniciar', 'reiniciar') and POR_ID[agente]['tipo'] == 'coordinador':
            otros = [i for i in _activos(datos) if i != agente] + [o['agente'] for o in datos['ordenes'] if o['estado'] in ('pendiente', 'entregada') and o['accion'] in ('iniciar', 'reiniciar') and o['agente'] in COORDINADORES and o['agente'] != agente]
            if otros:
                raise HTTPException(409, f'{POR_ID[otros[0]]["nombre"]} está trabajando con Illustrator. No corras dos de ALMA / BRISA / CIRO a la vez: detén a {POR_ID[otros[0]]["nombre"]} primero.')
        if accion == 'iniciar' and actual in ESTADOS_ACTIVOS:
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} ya está corriendo.')
        if accion == 'detener' and actual not in ESTADOS_ACTIVOS and actual != 'ERROR':
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} no está corriendo.')
        datos['seq'] += 1
        orden = {'id': datos['seq'], 'agente': agente, 'accion': accion, 'por': usuario, 'estado': 'pendiente', 'detalle': '', 'at': _ahora(), 'iso': _iso()}
        datos['ordenes'].append(orden)
        _nota(datos, agente, 'info', f'{usuario} pidió «{accion}» desde el panel')
        _guardar(datos)
    return {'ok': True, 'orden': orden['id']}


@router.get('/log')
def ver_log(request: Request, desde: int = 0, agente: str = '', limite: int = 200):
    _usuario(request)
    with _lock:
        datos = _leer()
    lineas = [l for l in datos['log'] if l['id'] > desde and (not agente or l['agente'] == agente)]
    return {'lineas': lineas[-max(1, min(limite, 500)):], 'ultimo': datos['seq']}


@router.post('/conexion/regenerar')
def regenerar(request: Request):
    """Código nuevo para el PC (el anterior deja de servir). Se muestra una sola vez."""
    _usuario(request)
    token = secrets.token_urlsafe(32)
    with _lock:
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
        try:
            os.chmod(_token_file, 0o600)
        except OSError:
            pass
    return {'token': token, 'url': str(request.base_url).rstrip('/')}


# ------------------------------------------------------------------ PC con los bots
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El PC avisa que está vivo, reporta el estado de cada bot y sus últimas líneas, y recibe las órdenes pendientes."""
    _pc(request)
    with _lock:
        datos = _leer()
        datos['latido'] = {'at': _ahora(), 'iso': _iso(), 'equipo': str(payload.get('equipo', ''))[:60], 'simulado': bool(payload.get('simulado'))}
        for aid, info in (payload.get('agentes') or {}).items():
            if aid not in POR_ID or not isinstance(info, dict):
                continue
            previo = datos['agentes'].get(aid) or {}
            nuevo = {'estado': str(info.get('estado', 'INACTIVO'))[:20], 'pid': info.get('pid'), 'ultima': str(info.get('ultima', ''))[:300],
                     'desde': previo.get('desde') if previo.get('estado') == info.get('estado') else _iso()}
            if nuevo['estado'] != previo.get('estado') and previo:
                _nota(datos, aid, 'error' if nuevo['estado'] == 'ERROR' else 'info', f'{POR_ID[aid]["nombre"]}: {previo.get("estado", "—")} → {nuevo["estado"]}')
            datos['agentes'][aid] = nuevo
        for l in (payload.get('lineas') or [])[:200]:
            if isinstance(l, dict) and l.get('agente') in POR_ID:
                _nota(datos, l['agente'], 'error' if '[Error' in str(l.get('texto', '')) else 'log', l.get('texto', ''))
        for r in (payload.get('resultados') or [])[:20]:
            o = next((x for x in datos['ordenes'] if x['id'] == r.get('orden')), None)
            if o:
                o['estado'] = 'hecha' if r.get('ok') else 'error'
                o['detalle'] = str(r.get('detalle', ''))[:300]
                if not r.get('ok'):
                    _nota(datos, o['agente'], 'error', f'No se pudo «{o["accion"]}»: {o["detalle"]}')
        _vencer(datos)
        entregar = []
        for o in datos['ordenes']:
            if o['estado'] == 'pendiente':
                o['estado'] = 'entregada'
                entregar.append({'id': o['id'], 'agente': o['agente'], 'accion': o['accion']})
        _guardar(datos)
    return {'ordenes': entregar}
