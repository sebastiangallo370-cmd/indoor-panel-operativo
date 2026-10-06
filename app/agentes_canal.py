"""Canal de comunicación con los agentes de edición (TAVO, LEO, JACK, OLVER, OLIVER, TERRY).

Los agentes corren en el PC con Illustrator (carpeta agentes_uniformes). El panel no se conecta al PC: el PC
pregunta cada pocos segundos por mensajes nuevos (sondeo saliente, sin abrir puertos) y devuelve la respuesta.
Las personas del panel solo hablan con TAVO; el panel guarda la conversación de cada usuario.
Datos en /data/state/agentes_canal.json y el token del PC en /data/state/agentes_token.txt.
"""
import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix='/api/agentes', tags=['agentes'])            # personas (con sesión)
pc_router = APIRouter(prefix='/api/agentes/pc', tags=['agentes-pc'])   # el PC con Illustrator (con token)
_file = Path(os.getenv('AGENTES_FILE', '/data/state/agentes_canal.json'))
_token_file = Path(os.getenv('AGENTES_TOKEN_FILE', '/data/state/agentes_token.txt'))
_lock = threading.Lock()
MAX_MENSAJES = 400
MAX_EVENTOS = 900
LATIDO_SEG = 25          # el PC se considera conectado si sondeó hace menos de esto
ESPERA_MAX_SEG = 600     # si el PC toma un mensaje y no responde en 10 min, se avisa y se libera el chat
_auth: Callable = lambda request: None
_es_admin: Callable[[str], bool] = lambda usuario: False


def configurar(autenticar: Callable, es_admin: Callable) -> None:
    global _auth, _es_admin
    _auth, _es_admin = autenticar, es_admin


def _ahora() -> float:
    return time.time()


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _leer() -> dict:
    try:
        datos = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('contador', 0)
    datos.setdefault('mensajes', [])
    datos.setdefault('latido', {})
    datos.setdefault('trabajo', {})
    datos.setdefault('eventos', [])   # avance de los agentes para dibujar el flujo (por persona y mensaje)
    datos.setdefault('cont_ev', 0)
    return datos


def _guardar(datos: dict) -> None:
    datos['mensajes'] = datos['mensajes'][-MAX_MENSAJES:]
    datos['eventos'] = datos['eventos'][-MAX_EVENTOS:]
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _token() -> str:
    try:
        valor = _token_file.read_text(encoding='utf-8').strip()
    except OSError:
        valor = ''
    return valor


def _crear_token() -> str:
    _token_file.parent.mkdir(parents=True, exist_ok=True)
    valor = secrets.token_urlsafe(32)
    _token_file.write_text(valor, encoding='utf-8')
    try:
        os.chmod(_token_file, 0o600)
    except OSError:
        pass
    return valor


def _pc(request: Request) -> None:
    esperado = _token()
    recibido = request.headers.get('x-agentes-token', '')
    if not esperado or not secrets.compare_digest(recibido, esperado):
        raise HTTPException(401, 'Token del PC no válido')


def _nuevo(datos: dict, sesion: str, rol: str, texto: str, **extra) -> dict:
    datos['contador'] += 1
    msg = {'id': datos['contador'], 'sesion': sesion, 'rol': rol, 'texto': texto, 'creado': _iso(), **extra}
    datos['mensajes'].append(msg)
    return msg


def _tabla(valor) -> dict | None:
    """Tabla enviada por los agentes (p. ej. el desglose del listado): se limpia y se limita su tamaño."""
    if not isinstance(valor, dict):
        return None
    columnas = [str(c)[:40] for c in (valor.get('columnas') or [])][:12]
    if not columnas:
        return None
    filas = [[str(c)[:200] for c in list(f)[:len(columnas)]] for f in (valor.get('filas') or []) if isinstance(f, (list, tuple))][:1500]
    return {'titulo': str(valor.get('titulo', ''))[:150], 'columnas': columnas, 'filas': filas}


def _conectado(datos: dict) -> bool:
    return _ahora() - float(datos['latido'].get('at', 0)) < LATIDO_SEG


def _liberar_vencidos(datos: dict) -> bool:
    """Un mensaje tomado por el PC que no se responde en ESPERA_MAX_SEG se cierra con un aviso."""
    cambio = False
    for m in list(datos['mensajes']):
        if m['rol'] == 'yo' and not m.get('respondido') and _ahora() - m.get('t', _ahora()) > ESPERA_MAX_SEG:
            m['respondido'] = True
            if m.get('oculto'):
                continue
            _nuevo(datos, m['sesion'], 'bot', 'No recibí respuesta del PC de los agentes. Revisa que esté encendido y con iniciar.bat abierto, y vuelve a intentarlo.',
                   estado='ERROR', botones=[], agentes=['TAVO'], respondido=True)
            datos['trabajo'].pop(m['sesion'], None)
            cambio = True
    return cambio


# ------------------------------------------------------------------ personas
@router.get('/estado')
def estado(request: Request):
    _auth(request)
    with _lock:
        datos = _leer()
    latido = datos['latido']
    return {'conectado': _conectado(datos), 'illustrator': latido.get('illustrator', ''), 'sheets': latido.get('sheets', ''),
            'visto': latido.get('iso', '')}


@router.get('/mensajes')
def mensajes(request: Request, desde: int = 0, desde_ev: int = 0):
    usuario = _auth(request)
    with _lock:
        datos = _leer()
        if _liberar_vencidos(datos):
            _guardar(datos)
        propios = [m for m in datos['mensajes'] if m['sesion'] == usuario and not m.get('oculto')]
        esperando = any(m['rol'] == 'yo' and not m.get('respondido') for m in propios)
        trabajo = datos['trabajo'].get(usuario) if esperando else None
        nuevos = [{k: v for k, v in m.items() if k not in ('t',)} for m in propios if m['id'] > desde]
        eventos = [e for e in datos['eventos'] if e['sesion'] == usuario and e['id'] > desde_ev]
        return {'mensajes': nuevos, 'esperando': esperando, 'trabajo': trabajo, 'conectado': _conectado(datos), 'ultimo': datos['contador'],
                'eventos': eventos, 'ultimo_ev': datos['cont_ev']}


@router.post('/mensaje')
def enviar(request: Request, payload: dict):
    usuario = _auth(request)
    texto = str(payload.get('mensaje') or '').strip()[:2000]
    if not texto:
        raise HTTPException(400, 'Escribe un mensaje')
    with _lock:
        datos = _leer()
        _liberar_vencidos(datos)
        if any(m['sesion'] == usuario and m['rol'] == 'yo' and not m.get('respondido') and not m.get('oculto') for m in datos['mensajes']):
            raise HTTPException(409, 'Espera la respuesta de TAVO antes de enviar otro mensaje')
        msg = _nuevo(datos, usuario, 'yo', texto, t=_ahora(), tomado=False, respondido=False)
        _guardar(datos)
        return {'ok': True, 'id': msg['id'], 'conectado': _conectado(datos)}


@router.post('/limpiar')
def limpiar(request: Request):
    """Borra la conversación de quien la pide (no toca la de otras personas)."""
    usuario = _auth(request)
    with _lock:
        datos = _leer()
        datos['mensajes'] = [m for m in datos['mensajes'] if m['sesion'] != usuario]
        datos['eventos'] = [e for e in datos['eventos'] if e['sesion'] != usuario]
        datos['trabajo'].pop(usuario, None)
        # mensaje oculto: el PC reinicia la sesión de TAVO de esta persona (no aparece en el chat)
        _nuevo(datos, usuario, 'yo', 'cancelar', t=_ahora(), tomado=False, respondido=False, oculto=True)
        _guardar(datos)
    return {'ok': True}


@router.get('/conexion')
def conexion(request: Request):
    """Solo administración: token y pasos para conectar el PC con Illustrator."""
    if not _es_admin(_auth(request)):
        raise HTTPException(403, 'Solo la administración puede conectar el PC de los agentes')
    with _lock:
        token = _token() or _crear_token()
    return {'token': token, 'url': str(request.base_url).rstrip('/')}


@router.post('/conexion/regenerar')
def regenerar(request: Request):
    if not _es_admin(_auth(request)):
        raise HTTPException(403, 'Solo la administración puede conectar el PC de los agentes')
    with _lock:
        token = _crear_token()
    return {'token': token, 'url': str(request.base_url).rstrip('/')}


# ------------------------------------------------------------------ PC con Illustrator
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El PC avisa que está vivo y recibe los mensajes pendientes."""
    _pc(request)
    with _lock:
        datos = _leer()
        datos['latido'] = {'at': _ahora(), 'iso': _iso(), 'illustrator': str(payload.get('illustrator', ''))[:60], 'sheets': str(payload.get('sheets', ''))[:60]}
        pendientes = []
        for m in datos['mensajes']:
            if m['rol'] == 'yo' and not m.get('tomado'):
                m['tomado'] = True
                pendientes.append({'id': m['id'], 'sesion': m['sesion'], 'mensaje': m['texto']})
                if m.get('oculto'):
                    continue
                datos['trabajo'][m['sesion']] = {'agente': 'TAVO', 'msg': 'Recibí tu mensaje', 'hora': datetime.now().strftime('%H:%M:%S'), 'agentes': ['TAVO']}
        _guardar(datos)
    return {'pendientes': pendientes}


@pc_router.post('/evento')
def evento(request: Request, payload: dict):
    """Avance en vivo mientras los agentes trabajan: lista de {agente, msg, nivel, hora}."""
    _pc(request)
    sesion = str(payload.get('sesion', ''))
    lista = [e for e in (payload.get('eventos') or []) if isinstance(e, dict)][-40:]
    if not sesion or not lista:
        return {'ok': True}
    with _lock:
        datos = _leer()
        msg_id = payload.get('msg_id')
        origen = next((m for m in datos['mensajes'] if m['id'] == msg_id and m['rol'] == 'yo'), None)
        if origen is not None and origen.get('oculto'):
            return {'ok': True}   # reinicio interno de TAVO: no se muestra
        if origen is not None:
            for e in lista:
                datos['cont_ev'] += 1
                datos['eventos'].append({'id': datos['cont_ev'], 'sesion': sesion, 'msg_id': msg_id, 'agente': str(e.get('agente', 'TAVO')).upper()[:10],
                                         'msg': str(e.get('msg', ''))[:300], 'nivel': str(e.get('nivel', 'INFO'))[:8], 'hora': str(e.get('hora', ''))[:8],
                                         't': float(e.get('t') or _ahora())})
        actual = datos['trabajo'].get(sesion) or {'agentes': ['TAVO']}
        agentes = list(actual.get('agentes') or ['TAVO'])
        for e in lista:
            nombre = str(e.get('agente', 'TAVO')).upper()[:10]
            if nombre not in agentes:
                agentes.append(nombre)
        ultimo = lista[-1]
        datos['trabajo'][sesion] = {'agente': str(ultimo.get('agente', 'TAVO')).upper()[:10], 'msg': str(ultimo.get('msg', ''))[:300],
                                    'nivel': str(ultimo.get('nivel', 'INFO'))[:8], 'hora': str(ultimo.get('hora', ''))[:8], 'agentes': agentes}
        _guardar(datos)
    return {'ok': True}


@pc_router.post('/respuesta')
def respuesta(request: Request, payload: dict):
    _pc(request)
    with _lock:
        datos = _leer()
        origen = next((m for m in datos['mensajes'] if m['id'] == payload.get('id') and m['rol'] == 'yo'), None)
        if not origen:
            raise HTTPException(404, 'Mensaje no encontrado')
        if origen.get('respondido'):
            return {'ok': True, 'repetido': True}
        origen['respondido'] = True
        if origen.get('oculto'):
            _guardar(datos)
            return {'ok': True}
        botones = [str(b)[:60] for b in (payload.get('botones') or [])][:8]
        agentes = [str(a).upper()[:10] for a in (payload.get('agentes') or ['TAVO'])][:8]
        extra = {'tabla': _tabla(payload.get('tabla'))} if payload.get('tabla') else {}
        _nuevo(datos, origen['sesion'], 'bot', str(payload.get('respuesta', ''))[:30000], estado=str(payload.get('estado', ''))[:30],
               botones=botones, agentes=agentes, respondido=True, en_respuesta_a=origen['id'], **extra)
        datos['trabajo'].pop(origen['sesion'], None)
        _guardar(datos)
    return {'ok': True}
