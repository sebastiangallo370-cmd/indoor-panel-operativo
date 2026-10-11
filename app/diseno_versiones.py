"""Historial de versiones de los diseños (mockups D1, D2…) de cada orden.

Los diseños salen del Excel del listado en la NAS. Cada vez que el panel lee un diseño y su imagen es distinta a las que ya conocía,
la guarda como una versión nueva (V1, V2…): nada se borra, la anterior queda en el historial. El comercial (o Administración) marca cuál
versión aprobó el cliente; las tarjetas de Producción avisan si una orden va para Impresión con un diseño sin aprobar o cambiado después
de aprobado. Todo vive en su propia carpeta y base (DISENO_VERSIONES_DIR): no toca la base de producción ni escribe en la NAS."""
import hashlib
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import FileResponse

DIR = Path(os.getenv('DISENO_VERSIONES_DIR', '/data/state/diseno_versiones'))
_EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/tiff': '.tif'}
_lock = threading.Lock()
_vistos: dict = {}   # (orden, referencia) -> firma de los diseños ya registrados (evita ir a la base en cada lectura)
_autenticar = None
_puede_aprobar = lambda usuario: False
_fila = lambda fila: None      # fila -> {'orden', 'referencia'} o None
_filas = lambda: []            # [(fila, orden, referencia, va_para_impresion)]
router = APIRouter(prefix='/api/disenos')


def configurar(autenticar, puede_aprobar, fila, filas):
    global _autenticar, _puede_aprobar, _fila, _filas
    _autenticar, _puede_aprobar, _fila, _filas = autenticar, puede_aprobar, fila, filas


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
    db.execute('CREATE TABLE IF NOT EXISTS aprobacion (orden TEXT, referencia TEXT, diseno INTEGER, digest TEXT, usuario TEXT, creado TEXT, '
               'PRIMARY KEY(orden, referencia, diseno))')
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


def _estado_de(vigente_digest, aprobado_digest) -> str:
    if not aprobado_digest:
        return 'pendiente'
    return 'aprobado' if aprobado_digest == vigente_digest else 'cambio'


_PEOR = {'aprobado': 0, 'pendiente': 1, 'cambio': 2}


@router.get('/estado')
def estado(_=Depends(_usuario)):
    """Estado del diseño de cada fila de producción que ya tiene versiones: {fila: {estado, disenos, alerta}}."""
    db = _db()
    try:
        vigentes = {}
        for r in db.execute('SELECT v.orden, v.referencia, v.diseno, v.digest, a.digest AS aprobado FROM vigente v '
                            'LEFT JOIN aprobacion a ON a.orden=v.orden AND a.referencia=v.referencia AND a.diseno=v.diseno'):
            vigentes.setdefault((r['orden'], r['referencia']), []).append(_estado_de(r['digest'], r['aprobado']))
    finally:
        db.close()
    salida = {}
    for fila, orden, referencia, va_impresion in _filas():
        estados = vigentes.get(_clave(orden, referencia))
        if not estados:
            continue
        peor = max(estados, key=lambda e: _PEOR[e])
        salida[str(fila)] = {'estado': peor, 'disenos': len(estados), 'alerta': bool(va_impresion and peor != 'aprobado')}
    return salida


@router.get('/versiones')
def versiones(fila: int, usuario=Depends(_usuario)):
    info = _fila(fila)
    if not info:
        raise HTTPException(404, 'Fila no encontrada')
    orden, referencia = _clave(info['orden'], info['referencia'])
    db = _db()
    try:
        vig = {r['diseno']: r['digest'] for r in db.execute('SELECT diseno, digest FROM vigente WHERE orden=? AND referencia=?', (orden, referencia))}
        apr = {r['diseno']: dict(r) for r in db.execute('SELECT diseno, digest, usuario, creado FROM aprobacion WHERE orden=? AND referencia=?', (orden, referencia))}
        por_diseno = {}
        for r in db.execute('SELECT diseno, digest, bytes, creado FROM versiones WHERE orden=? AND referencia=? ORDER BY diseno, id', (orden, referencia)):
            lista = por_diseno.setdefault(r['diseno'], [])
            a = apr.get(r['diseno'])
            aprobada = bool(a and a['digest'] == r['digest'])
            lista.append({'v': len(lista) + 1, 'digest': r['digest'], 'creado': r['creado'], 'bytes': r['bytes'], 'vigente': vig.get(r['diseno']) == r['digest'],
                          'aprobada': aprobada, 'aprobada_por': a['usuario'] if aprobada else '', 'aprobada_en': a['creado'] if aprobada else '',
                          'url': '/api/disenos/imagen/' + r['digest']})
    finally:
        db.close()
    disenos = [{'diseno': n, 'enUso': n in vig, 'estado': _estado_de(vig.get(n), (apr.get(n) or {}).get('digest')) if n in vig else 'retirado', 'versiones': lista}
               for n, lista in sorted(por_diseno.items())]
    return {'fila': fila, 'orden': orden, 'referencia': referencia, 'disenos': disenos, 'puede_aprobar': bool(_puede_aprobar(str(usuario)))}


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


def _fila_para_aprobar(datos: dict, usuario) -> tuple:
    if not _puede_aprobar(str(usuario)):
        raise HTTPException(403, 'Solo Comercial o Administración pueden aprobar diseños')
    try:
        fila, diseno = int(datos.get('fila')), int(datos.get('diseno'))
    except (TypeError, ValueError):
        raise HTTPException(400, 'Faltan la fila y el diseño')
    info = _fila(fila)
    if not info:
        raise HTTPException(404, 'Fila no encontrada')
    return (*_clave(info['orden'], info['referencia']), diseno)


@router.post('/aprobar')
def aprobar(datos: dict = Body(...), usuario=Depends(_usuario)):
    orden, referencia, diseno = _fila_para_aprobar(datos, usuario)
    digest = str(datos.get('digest') or '')
    with _lock:
        db = _db()
        try:
            if not db.execute('SELECT 1 FROM versiones WHERE orden=? AND referencia=? AND diseno=? AND digest=?', (orden, referencia, diseno, digest)).fetchone():
                raise HTTPException(404, 'Esa versión no existe')
            db.execute('INSERT INTO aprobacion(orden, referencia, diseno, digest, usuario, creado) VALUES (?,?,?,?,?,?) '
                       'ON CONFLICT(orden, referencia, diseno) DO UPDATE SET digest=excluded.digest, usuario=excluded.usuario, creado=excluded.creado',
                       (orden, referencia, diseno, digest, str(usuario), _ahora()))
            db.commit()
        finally:
            db.close()
    return {'ok': True}


@router.post('/desaprobar')
def desaprobar(datos: dict = Body(...), usuario=Depends(_usuario)):
    orden, referencia, diseno = _fila_para_aprobar(datos, usuario)
    with _lock:
        db = _db()
        try:
            db.execute('DELETE FROM aprobacion WHERE orden=? AND referencia=? AND diseno=?', (orden, referencia, diseno))
            db.commit()
        finally:
            db.close()
    return {'ok': True}
