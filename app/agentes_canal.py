"""Canal de comunicación con los agentes de edición (TAVO, LEO, JACK, OLVER, OLIVER, TERRY).

Los agentes corren en el PC con Illustrator (carpeta agentes_uniformes). El panel no se conecta al PC: el PC
pregunta cada pocos segundos por mensajes nuevos (sondeo saliente, sin abrir puertos) y devuelve la respuesta.
Las personas del panel solo hablan con TAVO; el panel guarda la conversación de cada usuario.
Datos en /data/state/agentes_canal.json y el token del PC en /data/state/agentes_token.txt.
"""
import hashlib
import json
import os
import re
from urllib.parse import unquote
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(prefix='/api/agentes', tags=['agentes'])            # personas (con sesión)
pc_router = APIRouter(prefix='/api/agentes/pc', tags=['agentes-pc'])   # el PC con Illustrator (con token)
_file = Path(os.getenv('AGENTES_FILE', '/data/state/agentes_canal.json'))
_token_file = Path(os.getenv('AGENTES_TOKEN_FILE', '/data/state/agentes_token.txt'))
_lock = threading.Lock()
MAX_MENSAJES = 400
MAX_EVENTOS = 900
MAX_VISTAS = 150                  # imágenes de los PDF recién creados que se conservan (pantalla en vivo y flechita ↗ para verlos)
MAX_ARCHIVOS = 160                 # PDF/imágenes que los agentes suben para verlos en el chat
MAX_BYTES_ARCHIVO = 25 * 1024 * 1024
_dir_archivos = Path(os.getenv('AGENTES_ARCHIVOS_DIR', '/data/state/agentes_archivos'))
_dir_vistas = _dir_archivos / 'vistas'
_vistas: dict[str, dict] = {}   # id -> {sesion, nombre, ext}: se pierden al reiniciar (son temporales)
_lock_vistas = threading.Lock()
_TIPOS = {'pdf': ('application/pdf', b'%PDF'), 'png': ('image/png', b'\x89PNG'), 'jpg': ('image/jpeg', b'\xff\xd8\xff'), 'jpeg': ('image/jpeg', b'\xff\xd8\xff')}
LATIDO_SEG = 25          # el PC se considera conectado si sondeó hace menos de esto
ESPERA_MAX_SEG = 2700    # un lote de PDF de producción por jugador puede tardar varios minutos (hasta 45 min antes de avisar)
_auth: Callable = lambda request: None
_es_admin: Callable[[str], bool] = lambda usuario: False
_lista_usuarios: Callable[[], list] = lambda: []
PRINCIPAL = 'principal'   # el PC que ya estaba conectado con el token de siempre (agentes_token.txt)


def configurar(autenticar: Callable, es_admin: Callable) -> None:
    global _auth, _es_admin
    _auth, _es_admin = autenticar, es_admin


def configurar_usuarios(fn: Callable) -> None:
    """main.py registra cómo listar los usuarios del panel (para asignarles su PC)."""
    global _lista_usuarios
    _lista_usuarios = fn


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
    datos.setdefault('archivos', {})   # id -> {sesion, nombre, ext, size, creado}
    datos.setdefault('ordenes', {})    # sesion -> orden activa (CO6133): todo lo que pide esa persona se hace con ella
    datos.setdefault('auto', {'activo': True, 'vistos': None})   # inicio automático: tarjetas de EDICIÓN que pasan a «en proceso»
    datos.setdefault('pcs', {})        # id -> {nombre, usuarios, token_hash, latido}: cada PC con Illustrator (el «principal» usa el token de siempre)
    datos.setdefault('ultimo_pc', {})  # usuario -> PC que atendió su último mensaje
    datos.setdefault('pc_activo', '')  # PC elegido a mano para hacer el proceso ('' = automático: el PC de la persona o el que esté conectado)
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


def _hash(valor: str) -> str:
    return hashlib.sha256(valor.encode('utf-8')).hexdigest()


def _pc(request: Request) -> str:
    """Valida el token del PC y devuelve su id («principal» o el de un PC agregado después)."""
    recibido = request.headers.get('x-agentes-token', '')
    esperado = _token()
    if esperado and recibido and secrets.compare_digest(recibido, esperado):
        return PRINCIPAL
    if recibido:
        huella = _hash(recibido)
        for pid, info in _leer()['pcs'].items():
            if info.get('token_hash') and secrets.compare_digest(info['token_hash'], huella):
                return pid
    raise HTTPException(401, 'Token del PC no válido')


def _ids_pcs(datos: dict) -> list:
    return [PRINCIPAL] + [p for p in datos['pcs'] if p != PRINCIPAL]


def _nombre_pc(datos: dict, pid: str) -> str:
    return (datos['pcs'].get(pid) or {}).get('nombre') or ('EDICION' if pid == PRINCIPAL else pid)   # el principal es el PC de EDICIÓN


def _latido_pc(datos: dict, pid: str) -> dict:
    return datos['latido'] if pid == PRINCIPAL else (datos['pcs'].get(pid) or {}).get('latido', {})


def _conectado(datos: dict, pid: str | None = None) -> bool:
    ids = [pid] if pid else _ids_pcs(datos)
    return any(_ahora() - float(_latido_pc(datos, p).get('at', 0)) < LATIDO_SEG for p in ids)


def _sesion(usuario: str, pid: str) -> str:
    """Canal de conversación de una persona con un PC. El del PC principal conserva el nombre de siempre (compatibilidad); los demás
    llevan el id del PC. Así se puede trabajar en un PC mientras el otro está ocupado."""
    return usuario if (not pid or pid == PRINCIPAL) else f'{usuario}|{pid}'


def _base(sesion: str) -> str:
    return str(sesion or '').split('|', 1)[0]


def _pc_de(datos: dict, usuario: str) -> str:
    """En qué PC se abre Illustrator: el del canal si la sesión lo dice («usuario|pc»); si no, el que se eligió a mano en el panel;
    si no, el asignado a la persona; si no, el que atendió su último mensaje; si no, algún PC conectado; si no, el principal."""
    if '|' in str(usuario or ''):
        canal = str(usuario).split('|', 1)[1]
        if canal == PRINCIPAL or canal in datos['pcs']:
            return canal
    elegido = datos.get('pc_activo') or ''
    if elegido and (elegido == PRINCIPAL or elegido in datos['pcs']):
        return elegido
    clave = str(usuario or '').strip().lower()
    for pid, info in datos['pcs'].items():
        if clave and clave in [str(u).strip().lower() for u in info.get('usuarios', [])]:
            return pid
    ultimo = datos['ultimo_pc'].get(usuario)
    if ultimo and (ultimo == PRINCIPAL or ultimo in datos['pcs']):
        return ultimo
    for pid in _ids_pcs(datos):
        if _conectado(datos, pid):
            return pid
    return PRINCIPAL


def _nuevo(datos: dict, sesion: str, rol: str, texto: str, **extra) -> dict:
    if rol == 'yo' and 'pc' not in extra:
        extra['pc'] = _pc_de(datos, sesion)   # el mensaje solo lo recoge el PC de esta persona
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


def _borrar_archivo(datos: dict, aid: str) -> None:
    info = datos['archivos'].pop(aid, None)
    if info:
        try:
            (_dir_archivos / f"{aid}.{info['ext']}").unlink()
        except OSError:
            pass


def _tarjetas(datos: dict, sesion: str, valor) -> list:
    """Archivos que acompañan una respuesta: solo se conserva el vínculo con lo que el PC subió para esta persona."""
    tarjetas = []
    for a in (valor or [])[:30]:
        if not isinstance(a, dict):
            continue
        aid = str(a.get('id') or '')
        info = datos['archivos'].get(aid)
        t = {'nombre': str(a.get('nombre', ''))[:160], 'titulo': str(a.get('titulo', ''))[:160], 'tipo': str(a.get('tipo', ''))[:20],
             'subtitulo': str(a.get('subtitulo', ''))[:200], 'ruta': str(a.get('ruta', ''))[:400]}
        if info and info['sesion'] == sesion:
            t.update(id=aid, ext=info['ext'], size=info['size'])
        tarjetas.append(t)
    return tarjetas


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
def _canal(datos: dict, usuario: str, pc: str) -> tuple[str, str]:
    """(PC, sesión) del canal que pide la persona; sin PC explícito usa el de siempre."""
    pid = pc if (pc == PRINCIPAL or pc in datos['pcs']) else (_pc_de(datos, usuario) if not pc else PRINCIPAL)
    return pid, _sesion(usuario, pid)


@router.get('/estado')
def estado(request: Request, pc: str = ''):
    usuario = _auth(request)
    with _lock:
        datos = _leer()
    pid, _ses = _canal(datos, usuario, pc)   # el PC (pestaña) que se está mirando
    latido = _latido_pc(datos, pid)
    pcs = []
    for p in _ids_pcs(datos):
        ses = _sesion(usuario, p)
        ocupado = any(m['sesion'] == ses and m['rol'] == 'yo' and not m.get('respondido') and not m.get('oculto') for m in datos['mensajes'])
        trabajo = datos['trabajo'].get(ses) if ocupado else None
        pcs.append({'id': p, 'nombre': _nombre_pc(datos, p), 'conectado': _conectado(datos, p), 'ocupado': ocupado, 'visto': _latido_pc(datos, p).get('iso', ''),
                    'trabajo': (f"{trabajo.get('agente', '')}: {trabajo.get('msg', '')}"[:120] if trabajo else '')})
    return {'conectado': _conectado(datos, pid), 'illustrator': latido.get('illustrator', ''), 'sheets': latido.get('sheets', ''),
            'visto': latido.get('iso', ''), 'auto': bool(datos['auto'].get('activo', True)),
            'pc': {'id': pid, 'nombre': _nombre_pc(datos, pid), 'equipo': latido.get('equipo', ''), 'elegido': bool(datos.get('pc_activo'))},
            'pc_activo': datos.get('pc_activo') or '', 'pcs': pcs}


@router.get('/mensajes')
def mensajes(request: Request, desde: int = 0, desde_ev: int = 0, pc: str = ''):
    usuario = _auth(request)
    with _lock:
        datos = _leer()
        if _liberar_vencidos(datos):
            _guardar(datos)
        pid, ses = _canal(datos, usuario, pc)
        propios = [m for m in datos['mensajes'] if m['sesion'] == ses and not m.get('oculto')]
        esperando = any(m['rol'] == 'yo' and not m.get('respondido') for m in propios)
        trabajo = datos['trabajo'].get(ses) if esperando else None
        nuevos = [{k: v for k, v in m.items() if k not in ('t',)} for m in propios if m['id'] > desde]
        eventos = [e for e in datos['eventos'] if e['sesion'] == ses and e['id'] > desde_ev]
        return {'mensajes': nuevos, 'esperando': esperando, 'trabajo': trabajo, 'conectado': _conectado(datos, pid), 'ultimo': datos['contador'],
                'eventos': eventos, 'ultimo_ev': datos['cont_ev'], 'orden': datos['ordenes'].get(ses, ''), 'pc': pid}


@router.post('/mensaje')
def enviar(request: Request, payload: dict):
    usuario = _auth(request)
    texto = str(payload.get('mensaje') or '').strip()[:2000]
    if not texto:
        raise HTTPException(400, 'Escribe un mensaje')
    with _lock:
        datos = _leer()
        _liberar_vencidos(datos)
        pid, ses = _canal(datos, usuario, str(payload.get('pc') or ''))
        if any(m['sesion'] == ses and m['rol'] == 'yo' and not m.get('respondido') and not m.get('oculto') for m in datos['mensajes']):
            raise HTTPException(409, 'Espera la respuesta de TAVO antes de enviar otro mensaje')
        msg = _nuevo(datos, ses, 'yo', texto, t=_ahora(), tomado=False, respondido=False)
        _guardar(datos)
        return {'ok': True, 'id': msg['id'], 'conectado': _conectado(datos, msg.get('pc')), 'pc': _nombre_pc(datos, msg.get('pc') or PRINCIPAL)}


@router.post('/orden')
def fijar_orden(request: Request, payload: dict):
    """Fija (o quita, con texto vacío) la orden activa de esta persona. TAVO reinicia su sesión para no mezclar órdenes."""
    usuario = _auth(request)
    crudo = str(payload.get('orden') or '').strip().upper().replace(' ', '')
    if crudo and not re.fullmatch(r'[A-Z]{1,3}-?\d{3,7}', crudo):
        raise HTTPException(400, 'Escribe la orden como CO6133 (letras y números)')
    codigo = crudo.replace('-', '')
    with _lock:
        datos = _leer()
        _pid, ses = _canal(datos, usuario, str(payload.get('pc') or ''))
        if datos['ordenes'].get(ses, '') != codigo:
            if codigo:
                datos['ordenes'][ses] = codigo
            else:
                datos['ordenes'].pop(ses, None)
            # reinicio interno de TAVO (no aparece en el chat): así no arrastra pasos de la orden anterior
            _nuevo(datos, ses, 'yo', 'cancelar', t=_ahora(), tomado=False, respondido=False, oculto=True)
            _guardar(datos)
    return {'ok': True, 'orden': codigo}


@router.post('/detener')
def detener(request: Request, payload: dict | None = None):
    """Frena a los agentes de esta persona en ese PC: cierra lo que esperaba respuesta y le ordena al PC cortar el trabajo en curso."""
    usuario = _auth(request)
    with _lock:
        datos = _leer()
        _pid, ses = _canal(datos, usuario, str((payload or {}).get('pc') or ''))
        for m in datos['mensajes']:
            if m['sesion'] == ses and m['rol'] == 'yo' and not m.get('respondido'):
                m['respondido'] = True
                m['tomado'] = True   # si el PC aún no lo había tomado, ya no se le entrega
        datos['trabajo'].pop(ses, None)
        _nuevo(datos, ses, 'bot', 'Detuve los agentes. Lo que estaba en curso se cancela; si Illustrator estaba guardando un archivo, termina ese archivo y no sigue con el resto. Escribe cuando quieras continuar.',
               estado='DETENIDO', botones=[], agentes=['TAVO'], respondido=True)
        _nuevo(datos, ses, 'yo', '__detener__', t=_ahora(), tomado=False, respondido=False, oculto=True)
        _guardar(datos)
    return {'ok': True}


@router.post('/reiniciar')
def reiniciar(request: Request, payload: dict | None = None):
    """Le ordena al PC elegido (o a todos) reiniciar el programa de los agentes: se cierra y vuelve a abrir solo, ya con el código más reciente de la NAS."""
    usuario = _auth(request)
    pc = str((payload or {}).get('pc') or '')
    with _lock:
        datos = _leer()
        ids = _ids_pcs(datos) if pc == '*' else [_canal(datos, usuario, pc)[0]]
        for pid in ids:
            _pid, ses = _canal(datos, usuario, pid)
            datos['trabajo'].pop(ses, None)
            _nuevo(datos, ses, 'bot', 'Reiniciando los agentes de ' + _nombre_pc(datos, pid) + '… vuelven solos en unos 30 segundos.',
                   estado='REINICIANDO', botones=[], agentes=['TAVO'], respondido=True)
            _nuevo(datos, ses, 'yo', '__reiniciar__', t=_ahora(), tomado=False, respondido=False, oculto=True, pc=pid)
        _guardar(datos)
    return {'ok': True}


@router.get('/auto')
def auto_estado():
    with _lock:
        a = _leer()['auto']
    return {'activo': bool(a.get('activo', True))}


@router.post('/auto')
def auto_cambiar(payload: dict):
    """Enciende o apaga el inicio automático. Apagado, las tarjetas que pasen a EDICIÓN en proceso se anotan como vistas y no arrancan nada."""
    with _lock:
        datos = _leer()
        datos['auto']['activo'] = bool(payload.get('activo'))
        _guardar(datos)
    return {'activo': datos['auto']['activo']}


@router.post('/limpiar')
def limpiar(request: Request, payload: dict | None = None):
    """Borra la conversación de quien la pide en ese PC (no toca la de otras personas ni la del otro PC)."""
    usuario = _auth(request)
    with _lock:
        datos = _leer()
        _pid, ses = _canal(datos, usuario, str((payload or {}).get('pc') or ''))
        datos['mensajes'] = [m for m in datos['mensajes'] if m['sesion'] != ses]
        datos['eventos'] = [e for e in datos['eventos'] if e['sesion'] != ses]
        for aid in [k for k, v in datos['archivos'].items() if v['sesion'] == ses]:
            _borrar_archivo(datos, aid)
        datos['trabajo'].pop(ses, None)
        # mensaje oculto: el PC reinicia la sesión de TAVO de esta persona (no aparece en el chat)
        _nuevo(datos, ses, 'yo', 'cancelar', t=_ahora(), tomado=False, respondido=False, oculto=True)
        _guardar(datos)
    return {'ok': True}


@router.get('/archivo/{aid}')
def ver_archivo(request: Request, aid: str, descargar: int = 0):
    usuario = _auth(request)
    with _lock:
        info = _vistas.get(aid) or _leer()['archivos'].get(aid)
    if not info or not (_base(info['sesion']) == usuario or _es_admin(usuario)):
        raise HTTPException(404, 'Archivo no encontrado')
    ruta = (_dir_vistas if aid in _vistas else _dir_archivos) / f"{aid}.{info['ext']}"
    if not ruta.exists():
        raise HTTPException(404, 'El archivo ya no está disponible')
    return FileResponse(ruta, media_type=_TIPOS[info['ext']][0], filename=info['nombre'],
                        content_disposition_type='attachment' if descargar else 'inline', headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'"})


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


# ------------------------------------------------------------------ administración de los PC con Illustrator
def _solo_admin(request: Request) -> str:
    usuario = _auth(request)
    if not _es_admin(usuario):
        raise HTTPException(403, 'Solo la administración puede administrar los PC de los agentes')
    return usuario


def _resumen_pc(datos: dict, pid: str) -> dict:
    info = datos['pcs'].get(pid) or {}
    latido = _latido_pc(datos, pid)
    return {'id': pid, 'nombre': _nombre_pc(datos, pid), 'usuarios': list(info.get('usuarios') or []), 'conectado': _conectado(datos, pid),
            'visto': latido.get('iso', ''), 'equipo': latido.get('equipo', ''), 'illustrator': latido.get('illustrator', ''), 'principal': pid == PRINCIPAL}


@router.get('/pcs')
def listar_pcs(request: Request):
    _solo_admin(request)
    with _lock:
        datos = _leer()
    nombres = sorted({str(u) for u in (_lista_usuarios() or []) if u}, key=str.casefold)
    return {'pcs': [_resumen_pc(datos, p) for p in _ids_pcs(datos)], 'usuarios': nombres}


@router.post('/pcs')
def crear_pc(request: Request, payload: dict):
    """Agrega un PC con Illustrator. Devuelve su código de conexión UNA sola vez."""
    _solo_admin(request)
    nombre = re.sub(r'\s+', ' ', str(payload.get('nombre') or '')).strip()[:40]
    if len(nombre) < 2:
        raise HTTPException(400, 'Ponle un nombre al PC, por ejemplo «PC Diseño 2»')
    with _lock:
        datos = _leer()
        if any(_nombre_pc(datos, p).casefold() == nombre.casefold() for p in _ids_pcs(datos)):
            raise HTTPException(409, 'Ya hay un PC con ese nombre')
        pid = 'pc-' + secrets.token_hex(3)
        token = secrets.token_urlsafe(32)
        datos['pcs'][pid] = {'nombre': nombre, 'usuarios': [], 'token_hash': _hash(token), 'creado': _iso()}
        _guardar(datos)
    return {'id': pid, 'nombre': nombre, 'token': token, 'url': str(request.base_url).rstrip('/')}


@router.put('/pcs/{pid}')
def editar_pc(request: Request, pid: str, payload: dict):
    """Cambia el nombre y/o las personas que trabajan con ese PC. Una persona solo puede estar en un PC."""
    _solo_admin(request)
    with _lock:
        datos = _leer()
        if pid != PRINCIPAL and pid not in datos['pcs']:
            raise HTTPException(404, 'PC no encontrado')
        info = datos['pcs'].setdefault(pid, {})
        if 'nombre' in payload:
            nombre = re.sub(r'\s+', ' ', str(payload.get('nombre') or '')).strip()[:40]
            if len(nombre) < 2:
                raise HTTPException(400, 'El nombre es muy corto')
            info['nombre'] = nombre
        if 'usuarios' in payload:
            nuevos = []
            for u in payload.get('usuarios') or []:
                u = str(u).strip()[:60]
                if u and u.casefold() not in [x.casefold() for x in nuevos]:
                    nuevos.append(u)
            for otro, otra in datos['pcs'].items():
                if otro != pid:
                    otra['usuarios'] = [u for u in (otra.get('usuarios') or []) if u.casefold() not in [x.casefold() for x in nuevos]]
            info['usuarios'] = nuevos
        _guardar(datos)
        return _resumen_pc(datos, pid)


@router.post('/pc-activo')
def elegir_pc(request: Request, payload: dict):
    """Elige en qué PC se hace el proceso (abre Illustrator). Vacío = automático. Aplica al inicio automático y a lo que se pida en el chat."""
    _solo_admin(request)
    pid = str(payload.get('pc') or '').strip()
    with _lock:
        datos = _leer()
        if pid and pid != PRINCIPAL and pid not in datos['pcs']:
            raise HTTPException(404, 'PC no encontrado')
        datos['pc_activo'] = pid
        _guardar(datos)
        return {'pc_activo': pid, 'nombre': _nombre_pc(datos, pid) if pid else '', 'conectado': _conectado(datos, pid) if pid else _conectado(datos)}


@router.post('/pcs/{pid}/token')
def token_pc(request: Request, pid: str):
    """Código nuevo para un PC (el anterior deja de servir)."""
    _solo_admin(request)
    with _lock:
        datos = _leer()
        if pid == PRINCIPAL:
            token = _crear_token()
        elif pid in datos['pcs']:
            token = secrets.token_urlsafe(32)
            datos['pcs'][pid]['token_hash'] = _hash(token)
            _guardar(datos)
        else:
            raise HTTPException(404, 'PC no encontrado')
    return {'id': pid, 'token': token, 'url': str(request.base_url).rstrip('/')}


@router.delete('/pcs/{pid}')
def borrar_pc(request: Request, pid: str):
    _solo_admin(request)
    if pid == PRINCIPAL:
        raise HTTPException(400, 'El PC principal no se puede quitar')
    with _lock:
        datos = _leer()
        if datos['pcs'].pop(pid, None) is None:
            raise HTTPException(404, 'PC no encontrado')
        for u, p in list(datos['ultimo_pc'].items()):
            if p == pid:
                datos['ultimo_pc'].pop(u, None)
        _guardar(datos)
    return {'ok': True}


# ------------------------------------------------------------------ PC con Illustrator
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El PC avisa que está vivo y recibe SOLO los mensajes que le tocan a él (los de las personas asignadas a ese PC)."""
    pid = _pc(request)
    with _lock:
        datos = _leer()
        latido = {'at': _ahora(), 'iso': _iso(), 'illustrator': str(payload.get('illustrator', ''))[:60], 'sheets': str(payload.get('sheets', ''))[:60],
                  'equipo': str(payload.get('equipo', ''))[:60]}
        if pid == PRINCIPAL:
            datos['latido'] = latido
        else:
            datos['pcs'].setdefault(pid, {})['latido'] = latido
        pendientes = []
        for m in datos['mensajes']:
            if m['rol'] == 'yo' and not m.get('tomado') and (m.get('pc') or PRINCIPAL) == pid:
                m['tomado'] = True
                if not m.get('oculto'):
                    datos['ultimo_pc'][m['sesion']] = pid
                pendientes.append({'id': m['id'], 'sesion': m['sesion'], 'mensaje': m['texto'], 'orden': datos['ordenes'].get(m['sesion'], '')})
                if m.get('oculto'):
                    continue
                datos['trabajo'][m['sesion']] = {'agente': 'TAVO', 'msg': 'Recibí tu mensaje', 'hora': datetime.now().strftime('%H:%M:%S'), 'agentes': ['TAVO']}
        _guardar(datos)
    return {'pendientes': pendientes}


_escribir_mts: Callable | None = None   # lo registra main.py: guarda el MTS en la tarjeta de producción de la orden

_escribir_maquina: Callable | None = None


_refs_proceso: Callable | None = None   # lo registra main.py: referencias de una orden cuya tarjeta tiene EDICIÓN en proceso


def configurar_refs(fn: Callable) -> None:
    global _refs_proceso
    _refs_proceso = fn


def configurar_maquinas_de(fn: Callable) -> None:
    global _maquinas_de
    _maquinas_de = fn


_maquinas_de: Callable | None = None


@pc_router.post('/maquina-orden')
def maquina_de_orden(request: Request, payload: dict):
    """TAVO: máquina(s) de impresión que las tarjetas de Producción tienen puestas para la orden."""
    _pc(request)
    orden = re.sub(r'\s+', '', str(payload.get('orden') or '')).upper()
    return {'maquinas': _maquinas_de(orden) if (_maquinas_de and orden) else []}


def configurar_maquina(fn: Callable) -> None:
    global _escribir_maquina
    _escribir_maquina = fn


@pc_router.post('/maquina')
def maquina_orden(request: Request, payload: dict):
    """TAVO: la máquina de impresión de la orden (sale de los JPG del maestro) pasa a la tarjeta de producción. Solo llena las tarjetas que no la tienen."""
    _pc(request)
    orden = re.sub(r'\s+', '', str(payload.get('orden') or '')).upper()
    maquina = str(payload.get('maquina') or '').strip()
    if not orden or not maquina or not _escribir_maquina:
        raise HTTPException(400, 'Faltan la orden o la máquina')
    return _escribir_maquina(orden, [str(h) for h in (payload.get('hojas') or [])], maquina)


def configurar_mts(fn: Callable) -> None:
    global _escribir_mts
    _escribir_mts = fn


_sellar: Callable | None = None   # lo registra main.py: anota HORA INICIO / HORA FINAL / RESPONSABLE=AGENT / MÁQUINA en Producción y en el Google Sheets


def configurar_sello(fn: Callable) -> None:
    global _sellar
    _sellar = fn


def _sellar_en_segundo_plano(orden: str, momento: str) -> None:
    """Escribir en el Google Sheets tarda unos segundos: se hace aparte para no frenar a los agentes."""
    if not _sellar or not orden:
        return
    threading.Thread(target=lambda: _sellar(orden, momento), daemon=True).start()


@pc_router.post('/referencias-proceso')
def referencias_proceso(request: Request, payload: dict):
    """TAVO: referencias de la orden que están en proceso de EDICIÓN en Producción (solo esas se ejecutan)."""
    _pc(request)
    orden = re.sub(r'\s+', '', str(payload.get('orden') or '')).upper()
    return {'referencias': sorted(set(_refs_proceso(orden))) if (_refs_proceso and orden) else []}


@pc_router.post('/plantillas')
def plantillas_orden(request: Request, payload: dict):
    """OLVER/TAVO: qué plantillas .ai (CA02M, CA02F, CA02N…) corresponden a cada referencia del listado, según Promedios maestros."""
    _pc(request)
    from app import promedios as promedios_mod
    hojas = [str(h).strip() for h in (payload.get('hojas') or []) if str(h).strip()]
    return {'hojas': {h: promedios_mod.plantillas_de_hoja(h) for h in hojas}}


@pc_router.post('/mts')
def mts_orden(request: Request, payload: dict):
    """TERRY: calcula los MTS requeridos de una orden (promedio por talla × cantidad del listado) y los escribe en su tarjeta de producción."""
    _pc(request)
    from app import promedios as promedios_mod
    orden = re.sub(r'\s+', '', str(payload.get('orden') or '')).upper()
    hojas = payload.get('hojas') or {}
    if not orden or not isinstance(hojas, dict) or not hojas:
        raise HTTPException(400, 'Faltan la orden o las referencias del listado')
    resultados = []
    for hoja, lineas in hojas.items():
        calculo = promedios_mod.calcular_hoja(str(hoja), [l for l in (lineas or []) if isinstance(l, dict)])
        calculo['escrito'] = False
        if payload.get('solo_calcular'):   # stickers: solo se necesita el cálculo, no se escribe nada en la tarjeta
            pass
        elif calculo['completo'] and _escribir_mts:
            escrito = _escribir_mts(orden, str(hoja), f"{calculo['mts']:.2f} MTS")
            calculo.update(escrito=bool(escrito.get('ok')), motivo=escrito.get('motivo', ''), fila=escrito.get('fila'),
                           sheet=bool(escrito.get('sheet')), sheet_motivo=escrito.get('sheet_motivo', ''),
                           finalizado=bool(escrito.get('finalizado')), finalizado_motivo=escrito.get('finalizado_motivo', ''),
                           finalizado_sheet=bool(escrito.get('finalizado_sheet')), finalizado_sheet_motivo=escrito.get('finalizado_sheet_motivo', ''))
        elif not calculo['completo']:
            calculo['motivo'] = 'Faltan consumos en Promedios maestros: no escribí nada en la tarjeta.'
        resultados.append(calculo)
    return {'ok': True, 'resultados': resultados}


def _archivo_evento(valor) -> dict | None:
    """Datos de un archivo recién creado (montaje o PDF de producción) para la pantalla en vivo; solo se aceptan campos conocidos y cortos."""
    if not isinstance(valor, dict) or valor.get('tipo') not in ('montaje', 'pdf', 'plan'):
        return None
    limpio = {k: str(valor.get(k, ''))[:160] for k in ('tipo', 'nombre', 'numero', 'talla', 'diseno', 'genero', 'detalle', 'carpeta')}
    ruta = str(valor.get('ruta') or '')[:500]   # ruta completa del archivo (para «Abrir en Illustrator»)
    limpio['ruta'] = ruta if re.match(r'^(\\\\|[A-Za-z]:\\)', ruta) else ''
    vista = str(valor.get('vista') or '')
    limpio['vista'] = vista if re.fullmatch(r'[0-9a-f]{8,32}', vista) else ''
    try:
        cant = int(valor.get('cantidad') or 0)
        if 0 < cant <= 100000:
            limpio['cantidad'] = cant   # PDF único de una talla sin nombre ni número («…_32unds.pdf»)
    except (TypeError, ValueError):
        pass
    if valor.get('tipo') == 'plan':
        try:
            limpio['pdfs'] = max(0, min(int(valor.get('pdfs') or 0), 5000))
        except (TypeError, ValueError):
            limpio['pdfs'] = 0
    return limpio


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
        if origen is not None and (origen.get('oculto') or origen.get('respondido')):
            return {'ok': True}   # reinicio interno de TAVO: no se muestra
        arranque = ''
        if origen is not None and not origen.get('sello'):
            origen['sello'] = True   # primer aviso de este pedido = los agentes empezaron: HORA INICIO
            arranque = str(datos['ordenes'].get(sesion) or '')
        if origen is not None:
            for e in lista:
                datos['cont_ev'] += 1
                datos['eventos'].append({'id': datos['cont_ev'], 'sesion': sesion, 'msg_id': msg_id, 'agente': str(e.get('agente', 'TAVO')).upper()[:10],
                                         'msg': str(e.get('msg', ''))[:300], 'nivel': str(e.get('nivel', 'INFO'))[:8], 'hora': str(e.get('hora', ''))[:8],
                                         't': float(e.get('t') or _ahora()), 'archivo': _archivo_evento(e.get('archivo'))})
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
    if arranque:
        _sellar_en_segundo_plano(arranque, 'inicio')
    return {'ok': True}


@pc_router.post('/archivo')
async def subir_archivo(request: Request):
    """El PC sube un PDF o imagen (cuerpo binario) para que la persona lo vea en el chat. Devuelve su id."""
    _pc(request)
    sesion = unquote(request.headers.get('x-sesion', ''))[:80]
    nombre = unquote(request.headers.get('x-nombre', 'archivo'))[:160]
    ext = nombre.rsplit('.', 1)[-1].lower() if '.' in nombre else ''
    if not sesion or ext not in _TIPOS:
        raise HTTPException(400, 'Archivo no permitido')
    if int(request.headers.get('content-length') or 0) > MAX_BYTES_ARCHIVO:
        raise HTTPException(413, 'Archivo demasiado grande')
    cuerpo = await request.body()
    if len(cuerpo) > MAX_BYTES_ARCHIVO or not cuerpo.startswith(_TIPOS[ext][1]):
        raise HTTPException(400, 'El contenido no corresponde al tipo de archivo')
    aid = uuid.uuid4().hex[:16]
    if nombre.startswith('vista_'):   # imagen de la pantalla en vivo: ligera, sin tocar el estado compartido; solo se conservan las últimas
        _dir_vistas.mkdir(parents=True, exist_ok=True)
        (_dir_vistas / f'{aid}.{ext}').write_bytes(cuerpo)
        with _lock_vistas:
            _vistas[aid] = {'sesion': sesion, 'nombre': re.sub(r'[\\/]+', '_', nombre), 'ext': ext}
            while len(_vistas) > MAX_VISTAS:
                viejo = next(iter(_vistas))
                info_vieja = _vistas.pop(viejo)
                try:
                    (_dir_vistas / f"{viejo}.{info_vieja['ext']}").unlink()
                except OSError:
                    pass
        return {'id': aid}
    aid = uuid.uuid4().hex[:16]
    _dir_archivos.mkdir(parents=True, exist_ok=True)
    (_dir_archivos / f'{aid}.{ext}').write_bytes(cuerpo)
    with _lock:
        datos = _leer()
        datos['archivos'][aid] = {'sesion': sesion, 'nombre': re.sub(r'[\\/]+', '_', nombre), 'ext': ext, 'size': len(cuerpo), 'creado': _iso()}
        while len(datos['archivos']) > MAX_ARCHIVOS:
            _borrar_archivo(datos, next(iter(datos['archivos'])))
        _guardar(datos)
    return {'id': aid}


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
        if origen.get('sello'):   # los agentes terminaron este pedido: HORA FINAL
            _sellar_en_segundo_plano(str(datos['ordenes'].get(origen['sesion']) or ''), 'fin')
        botones = [str(b)[:60] for b in (payload.get('botones') or [])][:8]
        agentes = [str(a).upper()[:10] for a in (payload.get('agentes') or ['TAVO'])][:8]
        extra = {'tabla': _tabla(payload.get('tabla'))} if payload.get('tabla') else {}
        if payload.get('archivos'):
            extra['archivos'] = _tarjetas(datos, origen['sesion'], payload.get('archivos'))
        _nuevo(datos, origen['sesion'], 'bot', str(payload.get('respuesta', ''))[:30000], estado=str(payload.get('estado', ''))[:30],
               botones=botones, agentes=agentes, respondido=True, en_respuesta_a=origen['id'], **extra)
        datos['trabajo'].pop(origen['sesion'], None)
        _guardar(datos)
    return {'ok': True}


# ------------------------------------------------------------------ inicio automático (EDICIÓN en proceso)
def auto_procesar(candidatos: list[dict]) -> list[str]:
    """candidatos: tarjetas cuya columna EDICIÓN está en proceso: [{'clave', 'orden', 'ref', 'usuario'}].
    La primera vez solo se anotan (para no arrancar de golpe lo que ya estaba en proceso). Después, cada tarjeta nueva inicia el
    «pedido completo» en el chat de quien la puso en proceso (o de quien usó los agentes por última vez). Si esa persona está esperando
    una respuesta o el PC no está conectado, se reintenta en la siguiente vuelta. Devuelve las órdenes lanzadas."""
    lanzadas = []
    with _lock:
        datos = _leer()
        auto = datos['auto']
        if auto.get('vistos') is None:
            auto['vistos'] = [c['clave'] for c in candidatos]
            _guardar(datos)
            return lanzadas
        vistos = set(auto['vistos'])
        cambio = False
        for c in candidatos:
            if c['clave'] in vistos:
                continue
            if not auto.get('activo', True):
                vistos.add(c['clave']); cambio = True   # apagado: se anota como vista, no arranca
                continue
            sesion = c.get('usuario') or next((m['sesion'] for m in reversed(datos['mensajes']) if m['rol'] == 'yo' and not m.get('auto')), '')
            if sesion:
                base = _base(sesion)
                sesion = _sesion(base, _pc_de(datos, base))   # canal del PC elegido para el inicio automático
            if not sesion or not _conectado(datos, _pc_de(datos, sesion)):
                continue   # sin a quién avisarle o sin el PC de esa persona: se reintenta luego
            if any(m['sesion'] == sesion and m['rol'] == 'yo' and not m.get('respondido') and not m.get('oculto') for m in datos['mensajes']):
                continue   # esa persona ya tiene un pedido en curso: se espera
            orden = c['orden']
            datos['ordenes'][sesion] = orden
            _nuevo(datos, sesion, 'yo', 'cancelar', t=_ahora(), tomado=False, respondido=False, oculto=True)   # sesión limpia para la orden nueva
            _nuevo(datos, sesion, 'yo', f"Pedido completo de la orden {orden} (inicio automático: EDICIÓN en proceso)", t=_ahora(),
                   tomado=False, respondido=False, auto=True)
            vistos.add(c['clave']); cambio = True
            lanzadas.append(orden)
        if cambio:
            auto['vistos'] = sorted(vistos)[-3000:]
            _guardar(datos)
    return lanzadas


# ------------------------------------------------------------------ MTS automáticos (EDICIÓN finalizada)
def auto_mts(candidatos: list[dict]) -> list[str]:
    """candidatos: tarjetas con EDICIÓN finalizada y SIN MTS REQUERIDOS: [{'clave', 'orden', 'ref', 'usuario'}].
    Cuando una tarjeta termina EDICIÓN, TERRY calcula cuánta tela se necesita (Promedios maestros) y la anota en la tarjeta, sin pedir
    autorización. La primera vez solo se anotan las que ya estaban así (el historial no se toca). Si el PC no está conectado o la persona está
    esperando una respuesta, se reintenta en la siguiente vuelta. Devuelve las órdenes lanzadas."""
    lanzadas = []
    with _lock:
        datos = _leer()
        auto = datos['auto']
        if auto.get('vistos_mts') is None:
            auto['vistos_mts'] = [c['clave'] for c in candidatos]
            _guardar(datos)
            return lanzadas
        vistos = set(auto['vistos_mts'])
        cambio = False
        for c in candidatos:
            if c['clave'] in vistos:
                continue
            sesion = c.get('usuario') or next((m['sesion'] for m in reversed(datos['mensajes']) if m['rol'] == 'yo' and not m.get('auto')), '')
            if sesion:
                base = _base(sesion)
                sesion = _sesion(base, _pc_de(datos, base))
            if not sesion or not _conectado(datos, _pc_de(datos, sesion)):
                continue
            if any(m['sesion'] == sesion and m['rol'] == 'yo' and not m.get('respondido') and not m.get('oculto') for m in datos['mensajes']):
                continue
            orden = c['orden']
            datos['ordenes'][sesion] = orden
            _nuevo(datos, sesion, 'yo', 'cancelar', t=_ahora(), tomado=False, respondido=False, oculto=True)
            _nuevo(datos, sesion, 'yo', f"Calcula los MTS requeridos de la orden {orden} (automático: EDICIÓN finalizada)", t=_ahora(),
                   tomado=False, respondido=False, auto=True)
            vistos.add(c['clave']); cambio = True
            lanzadas.append(orden)
        if cambio:
            auto['vistos_mts'] = sorted(vistos)[-3000:]
            _guardar(datos)
    return lanzadas
