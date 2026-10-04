"""Inicio de sesión con Face ID / huella (llaves de acceso WebAuthn).

La clave privada nunca sale del teléfono: el servidor solo guarda la clave pública
de cada dispositivo. Solo se admite ES256 (P-256), que es lo que usan Face ID,
Touch ID, Android y Windows Hello.
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import struct
import time
from datetime import datetime, timezone
from typing import Any, Callable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix='/api/passkey', tags=['passkey'])
RP_ID = os.getenv('PASSKEY_RP_ID', 'produccion.tech')
ORIGIN = os.getenv('PASSKEY_ORIGIN', 'https://' + RP_ID)
RP_NAME = 'Indoor Sport'

_connect: Callable[[], sqlite3.Connection]
_sign: Callable[[str], str]
_user_exists: Callable[[str], bool]
_canonical_name: Callable[[str], str]
_open_session: Callable[[JSONResponse, str], None]
_authenticate: Callable
_too_many: Callable


def configurar(connect, sign, user_exists, canonical_name, open_session, authenticate, too_many) -> None:
    global _connect, _sign, _user_exists, _canonical_name, _open_session, _authenticate, _too_many
    _connect, _sign, _user_exists, _canonical_name = connect, sign, user_exists, canonical_name
    _open_session, _authenticate, _too_many = open_session, authenticate, too_many
    with _connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS passkeys (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE,
            credential_id TEXT NOT NULL UNIQUE, public_key BLOB NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
            label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_used TEXT)""")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def _b64d(text: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(str(text) + '=' * (-len(str(text)) % 4))
    except (ValueError, TypeError):
        raise HTTPException(400, 'Datos no válidos')


# ---- CBOR mínimo (lo que usa WebAuthn) ----
def _cbor(data: bytes, pos: int = 0) -> tuple[Any, int]:
    initial = data[pos]
    major, extra = initial >> 5, initial & 31
    pos += 1
    if extra < 24:
        value = extra
    elif extra in (24, 25, 26, 27):
        size = {24: 1, 25: 2, 26: 4, 27: 8}[extra]
        value = int.from_bytes(data[pos:pos + size], 'big')
        pos += size
    else:
        raise ValueError('CBOR no soportado')
    if major == 0:
        return value, pos
    if major == 1:
        return -1 - value, pos
    if major in (2, 3):
        chunk = data[pos:pos + value]
        return (chunk if major == 2 else chunk.decode('utf-8')), pos + value
    if major == 4:
        items = []
        for _ in range(value):
            item, pos = _cbor(data, pos)
            items.append(item)
        return items, pos
    if major == 5:
        mapping = {}
        for _ in range(value):
            key, pos = _cbor(data, pos)
            mapping[key], pos = _cbor(data, pos)
        return mapping, pos
    if major == 7:
        return {20: False, 21: True, 22: None}.get(value), pos
    raise ValueError('CBOR no soportado')


# ---- desafíos firmados (sin guardar nada en el servidor) ----
def _challenge(purpose: str, username: str = '') -> tuple[str, str]:
    raw = secrets.token_bytes(32)
    payload = f'{purpose}|{_b64e(raw)}|{int(time.time()) + 300}|{username}'
    token = _b64e(payload.encode('utf-8')) + '.' + _sign('passkey|' + payload)
    return _b64e(raw), token


def _check_challenge(token: str, purpose: str) -> tuple[str, str]:
    try:
        body, signature = str(token).split('.', 1)
        payload = _b64d(body).decode('utf-8')
        ok = secrets.compare_digest(signature, _sign('passkey|' + payload))
        kind, challenge, expires, username = payload.split('|', 3)
    except (ValueError, HTTPException):
        raise HTTPException(400, 'La solicitud no es válida. Intenta de nuevo.')
    if not ok or kind != purpose or int(expires) < time.time():
        raise HTTPException(400, 'La solicitud venció. Intenta de nuevo.')
    return challenge, username


def _check_client_data(raw: str, expected_type: str, challenge_b64: str) -> bytes:
    client_bytes = _b64d(raw)
    try:
        client = json.loads(client_bytes)
    except ValueError:
        raise HTTPException(400, 'Datos no válidos')
    if client.get('type') != expected_type or client.get('challenge') != challenge_b64 or client.get('origin') != ORIGIN:
        raise HTTPException(400, 'La verificación del dispositivo falló')
    return client_bytes


def _check_auth_data(auth: bytes, need_credential: bool) -> int:
    if len(auth) < 37 or auth[:32] != hashlib.sha256(RP_ID.encode()).digest():
        raise HTTPException(400, 'La verificación del dispositivo falló')
    flags = auth[32]
    if not (flags & 0x01) or not (flags & 0x04):  # presencia y verificación del usuario (Face ID)
        raise HTTPException(400, 'No se verificó tu identidad en el dispositivo')
    if need_credential and not (flags & 0x40):
        raise HTTPException(400, 'Datos no válidos')
    return struct.unpack('>I', auth[33:37])[0]


# ---- registro (con la sesión iniciada) ----
@router.post('/registro/opciones')
def registro_opciones(request: Request):
    username = _authenticate(request)
    name = _canonical_name(username)
    challenge, token = _challenge('registro', name)
    with _connect() as db:
        existing = [r[0] for r in db.execute('SELECT credential_id FROM passkeys WHERE username=? COLLATE NOCASE', (name,))]
    return {'token': token, 'publicKey': {
        'challenge': challenge, 'rp': {'id': RP_ID, 'name': RP_NAME},
        'user': {'id': _b64e(hashlib.sha256(name.lower().encode()).digest()), 'name': name, 'displayName': name},
        'pubKeyCredParams': [{'type': 'public-key', 'alg': -7}], 'timeout': 60000, 'attestation': 'none',
        'authenticatorSelection': {'authenticatorAttachment': 'platform', 'residentKey': 'required', 'requireResidentKey': True, 'userVerification': 'required'},
        'excludeCredentials': [{'type': 'public-key', 'id': c} for c in existing]}}


@router.post('/registro/verificar')
def registro_verificar(request: Request, payload: dict):
    username = _authenticate(request)
    challenge, owner = _check_challenge(payload.get('token', ''), 'registro')
    if owner.lower() != _canonical_name(username).lower():
        raise HTTPException(400, 'La solicitud no es válida')
    _check_client_data(payload.get('clientDataJSON', ''), 'webauthn.create', challenge)
    try:
        attestation, _ = _cbor(_b64d(payload.get('attestationObject', '')))
        auth = attestation['authData']
        sign_count = _check_auth_data(auth, True)
        cred_len = int.from_bytes(auth[53:55], 'big')
        cred_id = auth[55:55 + cred_len]
        key, _ = _cbor(auth, 55 + cred_len)
        if key.get(1) != 2 or key.get(3) != -7 or key.get(-1) != 1:
            raise HTTPException(400, 'Este dispositivo usa un tipo de llave no compatible')
        public = ec.EllipticCurvePublicNumbers(int.from_bytes(key[-2], 'big'), int.from_bytes(key[-3], 'big'), ec.SECP256R1()).public_key()
        der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, 'No se pudo leer la llave del dispositivo')
    label = ' '.join(str(payload.get('label') or 'Dispositivo').split())[:60]
    try:
        with _connect() as db:
            db.execute('INSERT INTO passkeys(username,credential_id,public_key,sign_count,label,created_at) VALUES (?,?,?,?,?,?)',
                       (_canonical_name(username), _b64e(cred_id), der, sign_count, label, datetime.now(timezone.utc).isoformat()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Este dispositivo ya estaba activado')
    return {'ok': True}


@router.get('/mis')
def mis_llaves(request: Request):
    username = _authenticate(request)
    with _connect() as db:
        rows = db.execute('SELECT id,label,created_at,last_used FROM passkeys WHERE username=? COLLATE NOCASE ORDER BY id', (_canonical_name(username),)).fetchall()
    return [dict(r) for r in rows]


@router.delete('/{key_id}')
def borrar_llave(key_id: int, request: Request):
    username = _authenticate(request)
    with _connect() as db:
        db.execute('DELETE FROM passkeys WHERE id=? AND username=? COLLATE NOCASE', (key_id, _canonical_name(username)))
    return {'ok': True}


# ---- inicio de sesión (sin sesión) ----
@router.post('/login/opciones')
def login_opciones(request: Request):
    if _too_many('passkey', request, 20):
        raise HTTPException(429, 'Demasiados intentos. Espera un minuto.')
    challenge, token = _challenge('login')
    return {'token': token, 'publicKey': {'challenge': challenge, 'rpId': RP_ID, 'timeout': 60000, 'userVerification': 'required', 'allowCredentials': []}}


@router.post('/login/verificar')
def login_verificar(request: Request, payload: dict):
    if _too_many('passkey', request, 20):
        raise HTTPException(429, 'Demasiados intentos. Espera un minuto.')
    challenge, _ = _check_challenge(payload.get('token', ''), 'login')
    cred_id = str(payload.get('id', ''))
    with _connect() as db:
        row = db.execute('SELECT id,username,public_key,sign_count FROM passkeys WHERE credential_id=?', (cred_id,)).fetchone()
    if not row:
        raise HTTPException(401, 'Este dispositivo no está activado. Entra con tu contraseña y actívalo en el menú.')
    client_bytes = _check_client_data(payload.get('clientDataJSON', ''), 'webauthn.get', challenge)
    auth = _b64d(payload.get('authenticatorData', ''))
    count = _check_auth_data(auth, False)
    public = serialization.load_der_public_key(bytes(row['public_key']))
    try:
        public.verify(_b64d(payload.get('signature', '')), auth + hashlib.sha256(client_bytes).digest(), ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        raise HTTPException(401, 'No se pudo verificar tu identidad')
    if (count or row['sign_count']) and count <= row['sign_count']:
        raise HTTPException(401, 'La llave del dispositivo ya no es válida. Actívala de nuevo.')
    if not _user_exists(row['username']):
        raise HTTPException(401, 'La cuenta ya no existe')
    with _connect() as db:
        db.execute('UPDATE passkeys SET sign_count=?, last_used=? WHERE id=?', (count, datetime.now(timezone.utc).isoformat(), row['id']))
    response = JSONResponse({'ok': True})
    _open_session(response, row['username'])
    return response
