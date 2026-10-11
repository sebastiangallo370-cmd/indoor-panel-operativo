"""Historial de versiones de los diseños (mockups D1, D2…) de cada orden.

Los diseños salen del Excel del listado en la NAS. Cada vez que el panel lee un diseño y su imagen es distinta a las que ya conocía,
la guarda como una versión nueva (V1, V2…): nada se borra, la anterior queda en el historial. Regla del negocio: lo que está en el listado
ES el diseño aprobado por el cliente, así que la versión en uso siempre es la aprobada y no hay que marcar nada. Las tarjetas de Producción
solo avisan cuando el diseño cambió hace poco y la orden va para Impresión, para que se imprima la versión nueva. Todo vive en su propia carpeta y base (DISENO_VERSIONES_DIR): no toca la base de producción ni escribe en la NAS."""
import hashlib
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

DIR = Path(os.getenv('DISENO_VERSIONES_DIR', '/data/state/diseno_versiones'))
_EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/tiff': '.tif'}
_lock = threading.Lock()
_vistos: dict = {}   # (orden, referencia) -> firma de los diseños ya registrados (evita ir a la base en cada lectura)
_autenticar = None
_fila = lambda fila: None      # fila -> {'orden', 'referencia'} o None
_filas = lambda: []            # [(fila, orden, referencia, va_para_impresion)]
router = APIRouter(prefix='/api/disenos')


def configurar(autenticar, fila, filas):
    global _autenticar, _fila, _filas
    _autenticar, _fila, _filas = autenticar, fila, filas


def _usuario(request: Request):
    return _autenticar(request)


def _ahora() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).isoformat(timespec='seconds')


def _db():
    DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DIR / 'versiones.sqlite3', timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS versiones (id INTEGER PRIMARY KEY AUTOINCREMENT, orden TEXT, referencia TEXT, diseno INTEGER, digest TEXT, '
               'mime TEXT, bytes INTEGER, creado TEXT, UNIQUE(orden, referencia, diseno, digest))')
    db.execute('CREATE TABLE IF NOT EXISTS vigente (orden TEXT, referencia TEXT, diseno INTEGER, digest TEXT, visto TEXT, PRIMARY KEY(orden, referencia, diseno))')
    return db


def _clave(orden, referencia):
    return str(orden or '').strip().upper(), str(referencia or '').strip().upper()


def registrar(orden, referencia, designs) -> None:
    """designs: [(número, mime, bytes)] tal como salen del Excel. Guarda las imágenes nuevas como versiones y anota cuál es la vigente."""
    orden, referencia = _clave(orden, referencia)
    if not orden or not designs:
        return
    actuales = [(int(n), mime, hashlib.sha256(data).hexdigest()[:32], data) for n, mime, data in designs]
    firma = tuple(sorted((n, d) for n, _m, d, _b in actuales))
    if _vistos.get((orden, referencia)) == firma:
        return
    with _lock:
        (DIR / 'img').mkdir(parents=True, exist_ok=True)
        db = _db()
        try:
            for n, mime, digest, data in actuales:
                archivo = DIR / 'img' / (digest + _EXT.get(mime, '.img'))
                if not archivo.exists():
                    temporal = archivo.with_suffix(archivo.suffix + '.tmp')
                    temporal.write_bytes(data)
                    temporal.replace(archivo)
                db.execute('INSERT OR IGNORE INTO versiones(orden, referencia, diseno, digest, mime, bytes, creado) VALUES (?,?,?,?,?,?,?)',
                           (orden, referencia, n, digest, mime, len(data), _ahora()))
                db.execute('INSERT INTO vigente(orden, referencia, diseno, digest, visto) VALUES (?,?,?,?,?) '
                           'ON CONFLICT(orden, referencia, diseno) DO UPDATE SET digest=excluded.digest, visto=excluded.visto WHERE vigente.digest<>excluded.digest',
                           (orden, referencia, n, digest, _ahora()))
            numeros = [n for n, _m, _d, _b in actuales]
            db.execute('DELETE FROM vigente WHERE orden=? AND referencia=? AND diseno NOT IN (%s)' % ','.join('?' * len(numeros)), (orden, referencia, *numeros))
            db.commit()
        finally:
            db.close()
        _vistos[(orden, referencia)] = firma


AVISO_HORAS = 48   # un cambio de diseño avisa en la tarjeta durante este tiempo si la orden va para Impresión


def _reciente(iso: str) -> bool:
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(iso) <= timedelta(hours=AVISO_HORAS)
    except (TypeError, ValueError):
        return False


@router.get('/estado')
def estado(_=Depends(_usuario)):
    """Estado del diseño de cada fila que ya tiene versiones: {fila: {estado, disenos, version, cambio, alerta}}.
    'aprobado' = el diseño del listado no ha cambiado; 'cambio' = se reemplazó (hay una versión anterior guardada)."""
    db = _db()
    try:
        cuenta = {(r['orden'], r['referencia'], r['diseno']): r['n'] for r in db.execute('SELECT orden, referencia, diseno, COUNT(*) AS n FROM versiones GROUP BY orden, referencia, diseno')}
        por_fila = {}
        for r in db.execute('SELECT orden, referencia, diseno, visto FROM vigente'):
            por_fila.setdefault((r['orden'], r['referencia']), []).append((cuenta.get((r['orden'], r['referencia'], r['diseno']), 1), r['visto']))
    finally:
        db.close()
    salida = {}
    for fila, orden, referencia, va_impresion in _filas():
        disenos = por_fila.get(_clave(orden, referencia))
        if not disenos:
            continue
        cambiados = [(n, visto) for n, visto in disenos if n > 1]
        ultimo = max((visto for _n, visto in cambiados), default='')
        salida[str(fila)] = {'estado': 'cambio' if cambiados else 'aprobado', 'disenos': len(disenos), 'version': max(n for n, _v in disenos), 'cambio': ultimo,
                             'alerta': bool(va_impresion and cambiados and _reciente(ultimo))}
    return salida


@router.get('/versiones')
def versiones(fila: int, usuario=Depends(_usuario)):
    info = _fila(fila)
    if not info:
        raise HTTPException(404, 'Fila no encontrada')
    orden, referencia = _clave(info['orden'], info['referencia'])
    db = _db()
    try:
        vig = {r['diseno']: dict(r) for r in db.execute('SELECT diseno, digest, visto FROM vigente WHERE orden=? AND referencia=?', (orden, referencia))}
        por_diseno = {}
        for r in db.execute('SELECT diseno, digest, bytes, creado FROM versiones WHERE orden=? AND referencia=? ORDER BY diseno, id', (orden, referencia)):
            lista = por_diseno.setdefault(r['diseno'], [])
            en_uso = (vig.get(r['diseno']) or {}).get('digest') == r['digest']
            lista.append({'v': len(lista) + 1, 'digest': r['digest'], 'creado': r['creado'], 'bytes': r['bytes'], 'vigente': en_uso,
                          'desde': vig[r['diseno']]['visto'] if en_uso else '', 'url': '/api/disenos/imagen/' + r['digest']})
    finally:
        db.close()
    disenos = [{'diseno': n, 'enUso': n in vig, 'estado': 'retirado' if n not in vig else ('cambio' if len(lista) > 1 else 'aprobado'), 'versiones': lista}
               for n, lista in sorted(por_diseno.items())]
    return {'fila': fila, 'orden': orden, 'referencia': referencia, 'disenos': disenos}


@router.get('/imagen/{digest}')
def imagen(digest: str, _=Depends(_usuario)):
    if not re.fullmatch(r'[0-9a-f]{32}', digest):
        raise HTTPException(404, 'Imagen no encontrada')
    db = _db()
    try:
        r = db.execute('SELECT mime FROM versiones WHERE digest=? LIMIT 1', (digest,)).fetchone()
    finally:
        db.close()
    archivo = DIR / 'img' / (digest + _EXT.get(r['mime'], '.img')) if r else None
    if not archivo or not archivo.exists():
        raise HTTPException(404, 'Imagen no encontrada')
    return FileResponse(archivo, media_type=r['mime'], headers={'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'})
