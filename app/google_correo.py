"""Cuenta de envío de correos con «Iniciar sesión con Google» (OAuth), sin guardar la contraseña del correo.

Flujo: el botón del panel abre /api/zeus/google/inicio → Google pide elegir la cuenta y aceptar «enviar correos» → vuelve a
/api/zeus/google/retorno con un código → el panel lo cambia por un permiso de larga duración (refresh token) y lo guarda en
/data/state/google_correo.json. Los correos se envían con la API de Gmail (alcance gmail.send, solo enviar).
El ID de cliente y el secreto OAuth los crea la persona en Google Cloud y se guardan desde el panel (nunca en el repo).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from pathlib import Path

log = logging.getLogger('google_correo')
ARCHIVO = Path(os.getenv('GOOGLE_CORREO_FILE', '/data/state/google_correo.json'))
URL_PUBLICA = os.getenv('PUBLIC_URL', 'https://produccion.cloud').rstrip('/')
REDIRECT = URL_PUBLICA + '/api/zeus/google/retorno'
SCOPES = 'https://www.googleapis.com/auth/gmail.send openid email'
_lock = threading.Lock()
_estados: dict[str, float] = {}   # state -> vence (anti falsificación del retorno)
_token = {'v': '', 'vence': 0.0}


def _leer() -> dict:
    try:
        d = json.loads(ARCHIVO.read_text(encoding='utf-8'))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _guardar(d: dict) -> None:
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ARCHIVO.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(ARCHIVO)


def estado() -> dict:
    d = _leer()
    return {'cliente': bool(d.get('cliente_id') and d.get('cliente_secreto')), 'conectado': bool(d.get('refresh_token')), 'correo': d.get('correo', ''), 'redirect': REDIRECT}


def activo() -> bool:
    d = _leer()
    return bool(d.get('refresh_token') and d.get('correo') and d.get('cliente_id') and d.get('cliente_secreto'))


def correo() -> str:
    return _leer().get('correo', '')


def guardar_cliente(cliente_id: str, secreto: str) -> None:
    with _lock:
        d = _leer()
        if d.get('cliente_id') != cliente_id:
            d.pop('refresh_token', None)
            d.pop('correo', None)
            _token.update(v='', vence=0.0)
        d.update(cliente_id=cliente_id, cliente_secreto=secreto)
        _guardar(d)


def desconectar() -> None:
    with _lock:
        d = _leer()
        d.pop('refresh_token', None)
        d.pop('correo', None)
        _guardar(d)
        _token.update(v='', vence=0.0)


def _post(url: str, datos: dict, cabeceras: dict | None = None, json_body: bool = False) -> dict:
    cuerpo = json.dumps(datos).encode() if json_body else urllib.parse.urlencode(datos).encode()
    req = urllib.request.Request(url, data=cuerpo, headers={'Content-Type': 'application/json' if json_body else 'application/x-www-form-urlencoded', **(cabeceras or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            detalle = json.loads(e.read().decode())
            detalle = detalle.get('error_description') or (detalle.get('error') if isinstance(detalle.get('error'), str) else (detalle.get('error') or {}).get('message')) or str(detalle)
        except Exception:   # noqa: BLE001
            detalle = f'HTTP {e.code}'
        raise RuntimeError(f'Google respondió: {detalle}')


def url_inicio() -> str:
    d = _leer()
    if not (d.get('cliente_id') and d.get('cliente_secreto')):
        raise ValueError('Primero guarda el ID de cliente y el secreto de Google')
    ahora = time.time()
    for k in [k for k, v in _estados.items() if v < ahora]:
        _estados.pop(k, None)
    estado_ = secrets.token_urlsafe(24)
    _estados[estado_] = ahora + 600
    q = {'client_id': d['cliente_id'], 'redirect_uri': REDIRECT, 'response_type': 'code', 'scope': SCOPES, 'access_type': 'offline',
         'prompt': 'consent select_account', 'state': estado_}
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(q)


def completar(code: str, state: str) -> str:
    """Cambia el código por el permiso de envío y guarda la cuenta. Devuelve el correo conectado."""
    if _estados.pop(state, 0) < time.time():
        raise ValueError('El enlace venció o no es válido. Vuelve a pulsar el botón.')
    with _lock:
        d = _leer()
        r = _post('https://oauth2.googleapis.com/token', {'code': code, 'client_id': d.get('cliente_id', ''), 'client_secret': d.get('cliente_secreto', ''),
                                                           'redirect_uri': REDIRECT, 'grant_type': 'authorization_code'})
        if not r.get('refresh_token'):
            raise ValueError('Google no entregó el permiso permanente. Quita el acceso de «Indoor Sport» en tu cuenta de Google y vuelve a intentar.')
        req = urllib.request.Request('https://openidconnect.googleapis.com/v1/userinfo', headers={'Authorization': 'Bearer ' + r['access_token']})
        with urllib.request.urlopen(req, timeout=30) as u:
            correo_ = (json.loads(u.read().decode()).get('email') or '').strip().lower()
        if not correo_:
            raise ValueError('No pude leer el correo de la cuenta elegida')
        d.update(refresh_token=r['refresh_token'], correo=correo_)
        _guardar(d)
        _token.update(v=r['access_token'], vence=time.time() + int(r.get('expires_in', 3000)) - 60)
        return correo_


def _acceso() -> str:
    with _lock:
        if _token['v'] and _token['vence'] > time.time():
            return _token['v']
        d = _leer()
        r = _post('https://oauth2.googleapis.com/token', {'client_id': d.get('cliente_id', ''), 'client_secret': d.get('cliente_secreto', ''),
                                                           'refresh_token': d.get('refresh_token', ''), 'grant_type': 'refresh_token'})
        _token.update(v=r['access_token'], vence=time.time() + int(r.get('expires_in', 3000)) - 60)
        return _token['v']


def enviar(asunto: str, cuerpo: str, para: str, adjuntos: list | None = None) -> None:
    msg = EmailMessage()
    msg['Subject'] = asunto
    msg['From'] = correo()
    msg['To'] = para
    msg.set_content(cuerpo)
    for nombre, datos in (adjuntos or []):
        msg.add_attachment(datos, maintype='application', subtype='pdf', filename=nombre)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    _post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {'raw': raw}, {'Authorization': 'Bearer ' + _acceso()}, json_body=True)
