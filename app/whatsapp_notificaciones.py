"""Cola auditable de notificaciones WhatsApp para procesos internos.

El servidor nunca controla WhatsApp Web. Un worker local, autenticado con un
token independiente, reclama un mensaje por vez y confirma el resultado. La
sesión de WhatsApp y el perfil de Playwright permanecen fuera del servidor.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from app import proveedores_tela

router = APIRouter(prefix='/api/whatsapp', tags=['whatsapp'])
worker_router = APIRouter(prefix='/api/whatsapp/worker', tags=['whatsapp-worker'])
_db_file = Path(os.getenv('WHATSAPP_DB_FILE', '/data/state/whatsapp.sqlite3'))
_lock = threading.RLock()
_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: False
_TOKEN_ENV = 'WHATSAPP_WORKER_TOKEN'
_token_file = Path(os.getenv('WHATSAPP_WORKER_TOKEN_FILE', '/data/state/whatsapp_worker_token'))
_PHONE = re.compile(r'^\+[1-9]\d{7,14}$')
LEASE_SECONDS = 180

DEFAULT_TEMPLATE = (
    'El AGENTE INVENTARIO creó la orden de compra {oc} en Effi.\n\n'
    'Tela: {tela}\nMetros pedidos: {mts} MTS\n\n'
    'Pedidos que la necesitan:\n{pedidos}\n\n'
    'Ver: https://produccion.cloud (menú de la cuenta > Agente inventario)'
)


def configurar(auth: Callable, permitido: Callable[[str], bool]) -> None:
    global _auth, _permitido
    _auth, _permitido = auth, permitido


def _now() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _connect() -> sqlite3.Connection:
    _db_file.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(_db_file, timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    con.executescript('''
        CREATE TABLE IF NOT EXISTS wa_settings (
          k TEXT PRIMARY KEY, v TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS wa_recipients (
          phone TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', consent TEXT NOT NULL DEFAULT 'pending',
          source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS wa_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_key TEXT NOT NULL, phone TEXT NOT NULL, recipient_name TEXT NOT NULL DEFAULT '',
          event_name TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, claimed_at TEXT, lease_until REAL,
          attempts INTEGER NOT NULL DEFAULT 0, result_code TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
          technical_note TEXT NOT NULL DEFAULT '', is_test INTEGER NOT NULL DEFAULT 0,
          UNIQUE(event_key, phone)
        );
        CREATE INDEX IF NOT EXISTS wa_messages_claim ON wa_messages(status, lease_until, created_at);
    ''')
    defaults = {'enabled': '0', 'paused': '0', 'test_mode': '1', 'event_zeus_oc_created': '1',
                'template_zeus_oc_created': DEFAULT_TEMPLATE}
    con.executemany('INSERT OR IGNORE INTO wa_settings(k,v) VALUES (?,?)', defaults.items())
    return con


def _setting(con: sqlite3.Connection, key: str) -> str:
    row = con.execute('SELECT v FROM wa_settings WHERE k=?', (key,)).fetchone()
    return row['v'] if row else ''


def _settings(con: sqlite3.Connection) -> dict:
    rows = con.execute('SELECT k,v FROM wa_settings').fetchall()
    d = {r['k']: r['v'] for r in rows}
    return {'enabled': d.get('enabled') == '1', 'paused': d.get('paused') == '1',
            'test_mode': d.get('test_mode') == '1',
            'events': {'zeus_oc_created': d.get('event_zeus_oc_created') == '1'},
            'template': d.get('template_zeus_oc_created', DEFAULT_TEMPLATE)}


def normalizar_telefono(value: str) -> str:
    raw = str(value or '').strip()
    digits = re.sub(r'\D', '', raw)
    if raw.startswith('+'):
        phone = '+' + digits
    elif len(digits) == 10 and digits.startswith('3'):
        phone = '+57' + digits
    elif digits.startswith('57') and len(digits) == 12:
        phone = '+' + digits
    else:
        phone = '+' + digits if digits else ''
    if not _PHONE.fullmatch(phone):
        raise ValueError('El teléfono debe incluir código de país; ejemplo: +573113351601.')
    return phone


def _admin(request: Request) -> str:
    user = _auth(request)
    if not _permitido(user):
        raise HTTPException(403, 'Solo administración autorizada puede gestionar WhatsApp.')
    return str(user)


def _worker(request: Request) -> None:
    expected = os.getenv(_TOKEN_ENV, '')
    if not expected:
        try:
            expected = _token_file.read_text(encoding='utf-8').strip()
        except OSError:
            expected = ''
    received = request.headers.get('x-whatsapp-worker-token', '')
    if not expected or len(expected) < 32 or not received or not secrets.compare_digest(expected, received):
        raise HTTPException(401, 'Worker no autorizado.')


def _mask(phone: str) -> str:
    return phone[:4] + '***' + phone[-3:] if len(phone) > 7 else '***'


def _public_message(row: sqlite3.Row, include_body: bool = False) -> dict:
    result = {k: row[k] for k in ('id', 'event_key', 'event_name', 'status', 'created_at', 'updated_at', 'attempts', 'result_code', 'is_test')}
    result['phone'] = _mask(row['phone'])
    result['recipient_name'] = row['recipient_name']
    result['evidence'] = row['evidence'][:120]
    result['technical_note'] = row['technical_note'][:160]
    if include_body:
        result['body'] = row['body']
    return result


def estado() -> dict:
    with _lock:
        con = _connect()
        try:
            config = _settings(con)
            counts = {s: 0 for s in ('pending', 'processing', 'prepared', 'sent', 'failed', 'uncertain')}
            for row in con.execute('SELECT status, COUNT(*) n FROM wa_messages GROUP BY status'):
                counts[row['status']] = row['n']
            health = con.execute("SELECT updated_at, technical_note FROM wa_messages WHERE status='processing' ORDER BY updated_at DESC LIMIT 1").fetchone()
            return {'config': config, 'counts': counts,
                    'worker_configured': bool(os.getenv(_TOKEN_ENV, '') or _token_file.exists()),
                    'last_processing': dict(health) if health else None}
        finally:
            con.close()


def _body_zeus(item: dict, template: str) -> str:
    lines = []
    for order in item.get('ordenes') or []:
        lines.append(f"- {order.get('orden','')} · {order.get('referencia','')} · {order.get('cliente','')}: falta {float(order.get('falta') or 0):g} MTS (entrega {order.get('entrega') or 'sin fecha'})")
    return template.format(oc=item.get('oc') or '(sin número)', tela=item.get('tela') or '', mts=float(item.get('falta') or 0), pedidos='\n'.join(lines))[:6000]


def _contacto_tela(item: dict) -> tuple[str, str]:
    for stock in item.get('bodega') or []:
        code = proveedores_tela.codigo_de(stock)
        supplier = proveedores_tela.proveedor_de(code) if code else {}
        if supplier.get('wpp'):
            return str(supplier['wpp']), str(supplier.get('vendedor') or supplier.get('proveedor') or item.get('tela') or '')
    return '', ''


def encolar_zeus_oc(item: dict) -> dict:
    """Crea el mensaje para el encargado configurado de la tela. Nunca envía desde el servidor."""
    with _lock:
        con = _connect()
        try:
            cfg = _settings(con)
            if not cfg['events']['zeus_oc_created']:
                return {'queued': False, 'reason': 'evento desactivado'}
            raw_phone, name = _contacto_tela(item)
            if not raw_phone:
                return {'queued': False, 'reason': 'La tela no tiene WhatsApp de encargado configurado.'}
            try:
                phone = normalizar_telefono(raw_phone)
            except ValueError:
                return {'queued': False, 'reason': 'WhatsApp del encargado no tiene un formato válido.'}
            recipient = con.execute('SELECT consent FROM wa_recipients WHERE phone=?', (phone,)).fetchone()
            if not recipient or recipient['consent'] != 'authorized':
                return {'queued': False, 'reason': 'El encargado no ha autorizado mensajes de WhatsApp.'}
            now = _now()
            key = f"zeus_oc_created:{item.get('id','')}:{item.get('oc','')}"
            cur = con.execute('''INSERT OR IGNORE INTO wa_messages
                (event_key,phone,recipient_name,event_name,body,status,created_at,updated_at,is_test)
                VALUES (?,?,?,?,?,'pending',?,?,0)''', (key, phone, name, 'zeus_oc_created', _body_zeus(item, cfg['template']), now, now))
            return {'queued': bool(cur.rowcount), 'duplicate': not bool(cur.rowcount), 'phone': _mask(phone)}
        finally:
            con.close()


@router.get('/status')
def get_status(request: Request):
    _admin(request)
    return estado()


@router.get('/messages')
def get_messages(request: Request, limit: int = 80):
    _admin(request)
    with _lock:
        con = _connect()
        try:
            rows = con.execute('SELECT * FROM wa_messages ORDER BY id DESC LIMIT ?', (max(1, min(int(limit), 200)),)).fetchall()
            return {'messages': [_public_message(r, include_body=True) for r in rows]}
        finally:
            con.close()


@router.post('/config')
async def set_config(request: Request):
    _admin(request)
    payload = await request.json()
    allowed = {'enabled', 'paused', 'test_mode', 'event_zeus_oc_created', 'template_zeus_oc_created'}
    with _lock:
        con = _connect()
        try:
            for key in allowed & set(payload):
                value = payload[key]
                if key == 'template_zeus_oc_created':
                    value = str(value)[:6000]
                    if not value.strip():
                        raise HTTPException(400, 'La plantilla no puede estar vacía.')
                else:
                    value = '1' if bool(value) else '0'
                con.execute('INSERT INTO wa_settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', (key, value))
                if key == 'test_mode' and value == '0':
                    # Al aprobar la prueba, el supervisor decide cuándo activar la cola;
                    # los borradores ya preparados vuelven a estar disponibles una sola vez.
                    con.execute("UPDATE wa_messages SET status='pending',updated_at=?,technical_note='Aprobado después de modo prueba.' WHERE status='prepared'", (_now(),))
            return estado()
        finally:
            con.close()


@router.post('/recipients')
async def upsert_recipient(request: Request):
    _admin(request)
    payload = await request.json()
    try:
        phone = normalizar_telefono(payload.get('phone', ''))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    consent = 'authorized' if payload.get('authorized') is True else 'pending'
    with _lock:
        con = _connect()
        try:
            con.execute('''INSERT INTO wa_recipients(phone,name,consent,source,updated_at) VALUES(?,?,?,?,?)
                         ON CONFLICT(phone) DO UPDATE SET name=excluded.name,consent=excluded.consent,source=excluded.source,updated_at=excluded.updated_at''',
                        (phone, str(payload.get('name') or '')[:100], consent, str(payload.get('source') or 'manual')[:80], _now()))
            return {'phone': _mask(phone), 'consent': consent}
        finally:
            con.close()


@router.post('/test')
async def enqueue_test(request: Request):
    """Modo de prueba: prepara un mensaje; el worker no puede enviarlo mientras test_mode esté activo."""
    _admin(request)
    payload = await request.json()
    try:
        phone = normalizar_telefono(payload.get('phone', ''))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    text = str(payload.get('text') or 'Prueba de notificación de Indoor Sport.').strip()[:6000]
    with _lock:
        con = _connect()
        try:
            allowed = con.execute('SELECT consent FROM wa_recipients WHERE phone=?', (phone,)).fetchone()
            if not allowed or allowed['consent'] != 'authorized':
                raise HTTPException(400, 'El destinatario de prueba debe estar autorizado.')
            now = _now()
            key = 'manual_test:' + hashlib.sha256((phone + text + now).encode()).hexdigest()[:24]
            cur = con.execute("INSERT INTO wa_messages(event_key,phone,event_name,body,status,created_at,updated_at,is_test) VALUES(?,?,?,?, 'pending',?,?,1)",
                              (key, phone, 'manual_test', text, now, now))
            return {'id': cur.lastrowid, 'phone': _mask(phone), 'status': 'pending'}
        finally:
            con.close()


@worker_router.post('/claim')
def claim(request: Request):
    _worker(request)
    with _lock:
        con = _connect()
        try:
            cfg = _settings(con)
            if not cfg['enabled'] or cfg['paused']:
                return {'message': None, 'reason': 'paused' if cfg['paused'] else 'disabled'}
            now_time = time.time()
            # Una reserva vencida no se reenvía: queda para supervisión.
            con.execute("UPDATE wa_messages SET status='uncertain', updated_at=?, result_code='lease_expired', technical_note='La reserva venció; revisar antes de reenviar.' WHERE status='processing' AND lease_until<?", (_now(), now_time))
            row = con.execute("SELECT * FROM wa_messages WHERE status='pending' ORDER BY created_at,id LIMIT 1").fetchone()
            if not row:
                return {'message': None, 'reason': 'empty'}
            # En modo prueba se permite reclamar, pero el worker deberá prepararlo y devolver prepared.
            con.execute("UPDATE wa_messages SET status='processing', claimed_at=?, lease_until=?, attempts=attempts+1, updated_at=?, technical_note='' WHERE id=? AND status='pending'",
                        (_now(), now_time + LEASE_SECONDS, _now(), row['id']))
            reserved = con.execute('SELECT * FROM wa_messages WHERE id=?', (row['id'],)).fetchone()
            return {'message': {'id': reserved['id'], 'phone': reserved['phone'], 'body': reserved['body'],
                                'is_test': bool(reserved['is_test']), 'test_mode': cfg['test_mode']}}
        finally:
            con.close()


@worker_router.post('/complete')
async def complete(request: Request):
    _worker(request)
    payload = await request.json()
    message_id = int(payload.get('id') or 0)
    status = str(payload.get('status') or '')
    if status not in {'sent', 'failed', 'uncertain', 'prepared'}:
        raise HTTPException(400, 'Resultado inválido.')
    evidence = str(payload.get('evidence') or '')[:160]
    note = str(payload.get('note') or '')[:180]
    with _lock:
        con = _connect()
        try:
            row = con.execute('SELECT * FROM wa_messages WHERE id=?', (message_id,)).fetchone()
            if not row or row['status'] != 'processing':
                raise HTTPException(409, 'El mensaje no está reservado por el worker.')
            if status == 'sent' and not evidence:
                raise HTTPException(400, 'No se puede marcar enviado sin evidencia visible de aceptación.')
            if status == 'prepared':
                note = 'Preparado en modo prueba; no fue enviado.'
            con.execute('UPDATE wa_messages SET status=?,updated_at=?,result_code=?,evidence=?,technical_note=?,lease_until=NULL WHERE id=?',
                        (status, _now(), status, evidence, note, message_id))
            return {'ok': True, 'status': status}
        finally:
            con.close()


@worker_router.post('/heartbeat')
async def heartbeat(request: Request):
    _worker(request)
    payload = await request.json()
    # Solo estado técnico, sin mensajes ni teléfonos.
    state = str(payload.get('state') or 'unknown')[:40]
    with _lock:
        con = _connect()
        try:
            con.execute("INSERT INTO wa_settings(k,v) VALUES('worker_state',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (state + ' · ' + _now(),))
            return {'ok': True}
        finally:
            con.close()
