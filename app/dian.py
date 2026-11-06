"""Lotes centralizados para descargar comprobantes electrónicos DIAN.

El token temporal no se guarda ni se registra: vive solo en memoria mientras
un worker independiente procesa un CUFE por vez y descarga en la NAS.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.settings import STATE_DIR

router = APIRouter(prefix='/api/dian', tags=['dian'])
worker_router = APIRouter(prefix='/api/dian/worker', tags=['dian-worker'])
_CUFE = re.compile(r'(?i)\b[a-f0-9]{64,128}\b')
MAX_CUFES = 1000
LEASE_SECONDS = 10 * 60
_db_file = Path(os.getenv('DIAN_DOWNLOAD_DB_FILE', str(STATE_DIR / 'dian_descargas.sqlite3')))
_root = Path(os.getenv('DIAN_DOWNLOAD_ROOT', '/mnt/nas/DIAN DESCARGAS'))
_token_file = Path(os.getenv('DIAN_WORKER_TOKEN_FILE', str(STATE_DIR / 'dian_worker_token')))
_lock = threading.RLock()
_auth: Callable[[Request], str] = lambda request: ''
_active_tokens: dict[str, str] = {}


def configurar(auth: Callable[[Request], str]) -> None:
    global _auth
    _auth = auth


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _connect() -> sqlite3.Connection:
    _db_file.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(_db_file, timeout=15, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA foreign_keys=ON')
    con.executescript('''
      CREATE TABLE IF NOT EXISTS dian_batches (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, destination TEXT NOT NULL,
        format TEXT NOT NULL, status TEXT NOT NULL, total INTEGER NOT NULL,
        downloaded INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
        uncertain INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS dian_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL REFERENCES dian_batches(id) ON DELETE CASCADE,
        cufe TEXT NOT NULL, cufe_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        filename TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
        technical_note TEXT NOT NULL DEFAULT '', claimed_at TEXT, updated_at TEXT NOT NULL,
        UNIQUE(batch_id, cufe_hash)
      );
      CREATE INDEX IF NOT EXISTS dian_docs_claim ON dian_documents(batch_id, status, id);
    ''')
    return con


def _user(request: Request) -> str:
    user = str(_auth(request) or '').strip()
    if not user:
        raise HTTPException(401, 'Sesión no válida.')
    return user


def _worker(request: Request) -> None:
    expected = os.getenv('DIAN_WORKER_TOKEN', '')
    if not expected:
        try:
            expected = _token_file.read_text(encoding='utf-8').strip()
        except OSError:
            expected = ''
    given = request.headers.get('x-dian-worker-token', '')
    if not expected or len(expected) < 32 or not given or not secrets.compare_digest(expected, given):
        raise HTTPException(401, 'Worker DIAN no autorizado.')


def _cufes(raw: str) -> tuple[list[str], int]:
    values = [value.upper() for value in _CUFE.findall(str(raw or '')[:500_000])]
    unique = list(dict.fromkeys(values))[:MAX_CUFES]
    return unique, max(0, len(values) - len(unique))


def _safe_part(value: str) -> str:
    clean = re.sub(r'[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ _.-]', '_', str(value or '')).strip(' .')
    return clean[:80] or 'sin_nombre'


def _destination(raw: str) -> tuple[str, Path]:
    relative = str(raw or '').strip().replace('\\', '/') or 'pendientes'
    if relative.startswith('/') or '..' in relative.split('/'):
        raise ValueError('La carpeta debe estar dentro del destino DIAN permitido.')
    normalized = '/'.join(_safe_part(part) for part in relative.split('/') if part)
    folder = (_root / normalized).resolve()
    root = _root.resolve()
    if folder != root and root not in folder.parents:
        raise ValueError('La carpeta debe estar dentro del destino DIAN permitido.')
    return normalized, folder


def _owned(con: sqlite3.Connection, batch_id: str, user: str) -> sqlite3.Row:
    row = con.execute('SELECT * FROM dian_batches WHERE id=? AND owner=?', (batch_id, user)).fetchone()
    if not row:
        raise HTTPException(404, 'No encontramos ese lote.')
    return row


@router.get('/carpetas')
def folders(request: Request, path: str = ''):
    _user(request)
    try:
        relative, directory = _destination(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    for child in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))[:100]:
        stat = child.stat()
        entries.append({'name': child.name, 'directory': child.is_dir(), 'size': stat.st_size,
                        'modified_at': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()})
    return {'root': str(_root), 'path': relative, 'entries': entries}


@router.post('/lotes')
async def create_batch(request: Request):
    user = _user(request)
    payload = await request.json()
    token = str(payload.get('token') or '').strip()
    values, duplicates = _cufes(payload.get('cufes') or '')
    fmt = str(payload.get('format') or 'XML').upper()
    if not token or len(token) > 12_000:
        raise HTTPException(400, 'Pega un token temporal DIAN válido.')
    if not values:
        raise HTTPException(400, 'Pega al menos un CUFE válido de 64 a 128 caracteres.')
    if fmt not in {'XML', 'PDF'}:
        raise HTTPException(400, 'El formato debe ser XML o PDF.')
    try:
        relative, directory = _destination(payload.get('carpeta') or '')
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    directory.mkdir(parents=True, exist_ok=True)
    batch_id, now = uuid.uuid4().hex, _now()
    with _lock:
        con = _connect()
        try:
            con.execute('BEGIN IMMEDIATE')
            con.execute('''INSERT INTO dian_batches(id,owner,destination,format,status,total,created_at,updated_at)
              VALUES (?,?,?,?,\'queued\',?,?,?)''', (batch_id, user, relative, fmt, len(values), now, now))
            con.executemany('''INSERT INTO dian_documents(batch_id,cufe,cufe_hash,status,updated_at)
              VALUES (?,?,?,\'pending\',?)''', [(batch_id, value, hashlib.sha256(value.encode()).hexdigest(), now) for value in values])
            con.execute('COMMIT')
            _active_tokens[batch_id] = token
        except Exception:
            con.execute('ROLLBACK')
            raise
        finally:
            con.close()
    return {'ok': True, 'batch_id': batch_id, 'total': len(values), 'duplicates': duplicates,
            'status': 'queued', 'destination': relative,
            'message': 'Lote en cola. El servidor descargará un comprobante a la vez.'}


@router.get('/lotes/{batch_id}')
def get_batch(batch_id: str, request: Request):
    user = _user(request)
    with _lock:
        con = _connect()
        try:
            row = _owned(con, batch_id, user)
            counts = {item['status']: item['n'] for item in con.execute(
                'SELECT status,COUNT(*) n FROM dian_documents WHERE batch_id=? GROUP BY status', (batch_id,))}
            result = dict(row)
            result['counts'], result['token_active'] = counts, batch_id in _active_tokens
            return result
        finally:
            con.close()


@router.get('/lotes/{batch_id}/archivos')
def batch_files(batch_id: str, request: Request):
    user = _user(request)
    with _lock:
        con = _connect()
        try:
            batch = _owned(con, batch_id, user)
        finally:
            con.close()
    _, folder = _destination(batch['destination'])
    batch_names = set()
    with _lock:
        con = _connect()
        try:
            batch_names = {row['filename'] for row in con.execute(
                "SELECT filename FROM dian_documents WHERE batch_id=? AND status='downloaded' AND filename<>''", (batch_id,))}
        finally:
            con.close()
    files, batch_files = [], []
    if folder.exists():
        for item in sorted(folder.iterdir(), key=lambda value: value.stat().st_mtime, reverse=True)[:100]:
            if item.is_file():
                value = {'name': item.name, 'size': item.stat().st_size,
                         'modified_at': datetime.fromtimestamp(item.stat().st_mtime, timezone.utc).isoformat(),
                         'from_batch': item.name in batch_names}
                files.append(value)
                if value['from_batch']:
                    batch_files.append(value)
    return {'destination': batch['destination'], 'files': files, 'batch_files': batch_files}


@router.get('/lotes/{batch_id}/archivos/{filename}')
def download_batch_file(batch_id: str, filename: str, request: Request):
    """Entrega solo un archivo que pertenece al lote del usuario autenticado."""
    user = _user(request)
    if Path(filename).name != filename:
        raise HTTPException(400, 'Nombre de archivo inválido.')
    with _lock:
        con = _connect()
        try:
            batch = _owned(con, batch_id, user)
            allowed = con.execute("SELECT 1 FROM dian_documents WHERE batch_id=? AND status='downloaded' AND filename=?", (batch_id, filename)).fetchone()
        finally:
            con.close()
    if not allowed:
        raise HTTPException(404, 'Ese archivo no pertenece al lote.')
    _, folder = _destination(batch['destination'])
    target = (folder / filename).resolve()
    if folder.resolve() not in target.parents or not target.is_file():
        raise HTTPException(404, 'Archivo no disponible.')
    return FileResponse(target, filename=filename)


@router.post('/lotes/{batch_id}/pausar')
def pause_batch(batch_id: str, request: Request):
    user = _user(request)
    with _lock:
        con = _connect()
        try:
            _owned(con, batch_id, user)
            con.execute("UPDATE dian_batches SET status='paused',updated_at=? WHERE id=?", (_now(), batch_id))
            _active_tokens.pop(batch_id, None)
        finally:
            con.close()
    return {'ok': True, 'status': 'paused'}


@router.post('/lotes/{batch_id}/reanudar')
async def resume_batch(batch_id: str, request: Request):
    """Vincula un token nuevo al lote sin persistirlo en SQLite."""
    user = _user(request)
    payload = await request.json()
    token = str(payload.get('token') or '').strip()
    if not token or len(token) > 12_000:
        raise HTTPException(400, 'Pega un token temporal DIAN válido para reanudar.')
    with _lock:
        con = _connect()
        try:
            batch = _owned(con, batch_id, user)
            if batch['status'] not in {'requires_token', 'paused'}:
                raise HTTPException(409, 'Este lote no necesita un token nuevo.')
            pending = con.execute("SELECT COUNT(*) n FROM dian_documents WHERE batch_id=? AND status='pending'", (batch_id,)).fetchone()['n']
            if not pending:
                raise HTTPException(409, 'Este lote ya no tiene comprobantes pendientes.')
            _active_tokens[batch_id] = token
            con.execute("UPDATE dian_batches SET status='queued',updated_at=?,last_error='' WHERE id=?", (_now(), batch_id))
        finally:
            con.close()
    return {'ok': True, 'status': 'queued', 'message': 'Lote reanudado con el token temporal actual.'}


@worker_router.post('/claim')
def worker_claim(request: Request):
    """Reserva atómicamente solo un CUFE para el navegador automatizado."""
    _worker(request)
    with _lock:
        con = _connect()
        try:
            con.execute('BEGIN IMMEDIATE')
            # Nunca se reintenta a ciegas: una reserva abandonada queda para revisión.
            expiry = (datetime.now(timezone.utc) - timedelta(seconds=LEASE_SECONDS)).replace(microsecond=0).isoformat()
            abandoned = [item['batch_id'] for item in con.execute(
                "SELECT DISTINCT batch_id FROM dian_documents WHERE status='processing' AND claimed_at<?", (expiry,))]
            if abandoned:
                con.execute("UPDATE dian_documents SET status='uncertain',technical_note=?,updated_at=? WHERE status='processing' AND claimed_at<?", ('El worker se interrumpió antes de confirmar la descarga.', _now(), expiry))
                for abandoned_batch in abandoned:
                    con.execute("UPDATE dian_batches SET status='queued',uncertain=(SELECT COUNT(*) FROM dian_documents WHERE batch_id=? AND status='uncertain'),updated_at=?,last_error=? WHERE id=?", (abandoned_batch, _now(), 'Un comprobante requiere revisión por interrupción del worker.', abandoned_batch))
            row = con.execute('''SELECT d.*, b.destination, b.format FROM dian_documents d
              JOIN dian_batches b ON b.id=d.batch_id
              WHERE b.status='queued' AND d.status='pending' ORDER BY b.created_at,d.id LIMIT 1''').fetchone()
            if not row:
                con.execute('COMMIT')
                return {'job': None}
            if row['batch_id'] not in _active_tokens:
                con.execute("UPDATE dian_batches SET status='requires_token',updated_at=?,last_error=? WHERE id=?",
                            (_now(), 'El token temporal ya no está disponible; pega uno nuevo para reanudar.', row['batch_id']))
                con.execute('COMMIT')
                return {'job': None}
            now = _now()
            con.execute("UPDATE dian_documents SET status='processing',attempts=attempts+1,claimed_at=?,updated_at=? WHERE id=? AND status='pending'", (now, now, row['id']))
            con.execute("UPDATE dian_batches SET status='processing',updated_at=? WHERE id=?", (now, row['batch_id']))
            con.execute('COMMIT')
            return {'job': {'document_id': row['id'], 'batch_id': row['batch_id'], 'cufe': row['cufe'],
                            'token': _active_tokens[row['batch_id']], 'format': row['format'], 'destination': row['destination']}}
        except Exception:
            con.execute('ROLLBACK')
            raise
        finally:
            con.close()


@worker_router.post('/result')
async def worker_result(request: Request):
    _worker(request)
    payload = await request.json()
    doc_id, status = int(payload.get('document_id') or 0), str(payload.get('status') or '')
    if status not in {'downloaded', 'failed', 'uncertain'}:
        raise HTTPException(400, 'Resultado no válido.')
    filename, evidence = _safe_part(payload.get('filename') or '')[:180], str(payload.get('evidence') or '')[:240]
    note = str(payload.get('note') or '')[:240]
    with _lock:
        con = _connect()
        try:
            con.execute('BEGIN IMMEDIATE')
            row = con.execute("SELECT batch_id FROM dian_documents WHERE id=? AND status='processing'", (doc_id,)).fetchone()
            if not row:
                raise HTTPException(409, 'El trabajo no está reservado.')
            now, batch_id = _now(), row['batch_id']
            con.execute('UPDATE dian_documents SET status=?,filename=?,evidence=?,technical_note=?,updated_at=? WHERE id=?', (status, filename, evidence, note, now, doc_id))
            pending = con.execute("SELECT COUNT(*) n FROM dian_documents WHERE batch_id=? AND status IN ('pending','processing')", (batch_id,)).fetchone()['n']
            counts = {item['status']: item['n'] for item in con.execute('SELECT status,COUNT(*) n FROM dian_documents WHERE batch_id=? GROUP BY status', (batch_id,))}
            batch_status = 'completed' if pending == 0 else 'queued'
            con.execute('''UPDATE dian_batches SET status=?,downloaded=?,failed=?,uncertain=?,updated_at=?,last_error=? WHERE id=?''', (batch_status, counts.get('downloaded', 0), counts.get('failed', 0), counts.get('uncertain', 0), now, note if status != 'downloaded' else '', batch_id))
            if pending == 0:
                _active_tokens.pop(batch_id, None)
            con.execute('COMMIT')
            return {'ok': True, 'batch_id': batch_id, 'batch_status': batch_status}
        except Exception:
            con.execute('ROLLBACK')
            raise
        finally:
            con.close()


@router.get('/estado')
def estado(request: Request):
    _user(request)
    return {'token_persistido': False, 'download_root': str(_root), 'maximo_cufes': MAX_CUFES,
            'worker_configured': bool(os.getenv('DIAN_WORKER_TOKEN', '') or _token_file.exists()),
            'mode': 'cola central por usuario'}


@router.get('/dian.js')
def script():
    return FileResponse(Path(__file__).with_name('dian.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})
