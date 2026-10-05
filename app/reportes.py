"""Reportes de daño / incidente de planta con firma digital (formato «INDOOR SPORT SAS - Reporte de Incidente»).

Flujo: la administración crea el reporte (fecha, hora, OP/lote, operario, cargo, qué pasó y material perdido) →
el operario lo lee, escribe su versión y lo firma dibujando su firma → la administración registra la decisión
(llamado de atención, citación a descargos o sin sanción) y firma como gerencia.
Se guarda quién firmó, cuándo y desde qué IP, más una huella SHA-256 del contenido para detectar alteraciones.
Datos en /data/state/reportes.json (escritura atómica).
"""
import base64
import hashlib
import html
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

router = APIRouter(prefix='/api/reportes', tags=['reportes'])
_file = Path(os.getenv('REPORTES_FILE', '/data/state/reportes.json'))
_lock = threading.Lock()

DECISIONES = ['Llamado de atención', 'Citación a descargos', 'Sin sanción / Incidente operativo']
MAX_FIRMA = 250_000  # caracteres del data URL
_auth: Callable = lambda request: None
_es_admin: Callable[[str], bool] = lambda usuario: False
_usuarios: Callable[[], list] = lambda: []
_ip: Callable = lambda request: ''


def configurar(autenticar: Callable, es_admin: Callable, usuarios: Callable, ip: Callable) -> None:
    global _auth, _es_admin, _usuarios, _ip
    _auth, _es_admin, _usuarios, _ip = autenticar, es_admin, usuarios, ip


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _leer() -> dict:
    try:
        datos = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('contador', 0)
    datos.setdefault('reportes', [])
    return datos


def _guardar(datos: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(_file)


def _huella(r: dict) -> str:
    base = '|'.join(str(r.get(k, '')) for k in ('numero', 'operario', 'cargo', 'orden', 'fechaHecho', 'horaHecho', 'quePaso', 'material', 'creado', 'creadoPor', 'versionOperario'))
    return hashlib.sha256(base.encode('utf-8')).hexdigest()


def _mismo(a: str, b: str) -> bool:
    return str(a or '').strip().casefold() == str(b or '').strip().casefold()


def _publico(r: dict, con_firma: bool = False) -> dict:
    salida = {k: v for k, v in r.items() if k not in ('firma', 'gerencia')}
    for clave in ('firma', 'gerencia'):
        if r.get(clave):
            salida[clave] = dict(r[clave]) if con_firma else {k: v for k, v in r[clave].items() if k != 'imagen'}
    return salida


def _texto(valor, limite: int, obligatorio: bool = False, nombre: str = 'Campo') -> str:
    t = ' '.join(str(valor or '').split()) if limite <= 200 else str(valor or '').strip()
    if obligatorio and not t:
        raise HTTPException(400, f'{nombre} es obligatorio')
    return t[:limite]


def _visible(usuario: str, r: dict) -> bool:
    return _es_admin(usuario) or _mismo(r.get('operario'), usuario)


def _imagen_firma(valor) -> str:
    imagen = str(valor or '')
    if not imagen.startswith('data:image/png;base64,') or len(imagen) > MAX_FIRMA:
        raise HTTPException(400, 'Dibuja tu firma antes de enviar')
    try:
        crudo = base64.b64decode(imagen.split(',', 1)[1], validate=True)
    except ValueError:
        raise HTTPException(400, 'La firma no es válida')
    if not crudo.startswith(b'\x89PNG') or len(crudo) < 400:
        raise HTTPException(400, 'Dibuja tu firma antes de enviar')
    return imagen


def _buscar(datos: dict, rid: str) -> dict:
    for r in datos['reportes']:
        if r['id'] == rid:
            return r
    raise HTTPException(404, 'Reporte no encontrado')


@router.get('/opciones')
def opciones(request: Request):
    usuario = _auth(request)
    admin = _es_admin(usuario)
    return {'admin': admin, 'usuario': usuario, 'decisiones': DECISIONES, 'usuarios': _usuarios() if admin else []}


@router.get('/resumen')
def resumen(request: Request):
    """Pendientes: para el operario, los que debe firmar; para la administración, los que esperan firma o decisión."""
    usuario = _auth(request)
    admin = _es_admin(usuario)
    with _lock:
        lista = _leer()['reportes']
    abiertos = [r for r in lista if _visible(usuario, r) and (r['estado'] == 'pendiente' and not admin or admin and r['estado'] in ('pendiente', 'firmado'))]
    abiertos.sort(key=lambda r: r.get('creado', ''), reverse=True)
    # Identifica este inicio de sesión (cambia cada vez que la persona entra), para avisar una vez por ingreso.
    sesion = hashlib.sha256((request.cookies.get('indoor_login', '') + '|' + request.cookies.get('indoor_session', '')).encode()).hexdigest()[:16]
    items = [{'id': r['id'], 'numero': r['numero'], 'estado': r['estado'], 'operarioNombre': r['operarioNombre'], 'fechaHecho': r['fechaHecho'],
              'orden': r.get('orden', ''), 'quePaso': r['quePaso'][:140]} for r in abiertos[:20]]
    return {'pendientes': len(abiertos), 'admin': admin, 'sesion': sesion, 'items': items}


@router.get('')
def listar(request: Request):
    usuario = _auth(request)
    with _lock:
        lista = _leer()['reportes']
    visibles = [_publico(r) for r in lista if _visible(usuario, r)]
    visibles.sort(key=lambda r: r.get('creado', ''), reverse=True)
    return {'admin': _es_admin(usuario), 'reportes': visibles}


@router.post('')
def crear(request: Request, payload: dict):
    usuario = _auth(request)
    if not _es_admin(usuario):
        raise HTTPException(403, 'Solo la administración puede enviar reportes')
    destino = _texto(payload.get('operario'), 80, True, 'El operario')
    cuenta = next((u for u in _usuarios() if _mismo(u['usuario'], destino)), None)
    if not cuenta:
        raise HTTPException(400, 'Esa persona no existe en el sistema')
    fecha = _texto(payload.get('fechaHecho'), 10, True, 'La fecha')
    try:
        datetime.strptime(fecha, '%Y-%m-%d')
    except ValueError:
        raise HTTPException(400, 'Fecha no válida')
    registro = {
        'id': uuid.uuid4().hex[:12],
        'operario': cuenta['usuario'],
        'operarioNombre': cuenta.get('nombre') or cuenta['usuario'],
        'cargo': _texto(payload.get('cargo'), 80) or cuenta.get('proceso') or '',
        'fechaHecho': fecha,
        'horaHecho': _texto(payload.get('horaHecho'), 5),
        'orden': _texto(payload.get('orden'), 60),
        'quePaso': _texto(payload.get('quePaso'), 3000, True, '¿Qué pasó?'),
        'material': _texto(payload.get('material'), 400),
        'creado': _ahora(),
        'creadoPor': usuario,
        'estado': 'pendiente',
    }
    with _lock:
        datos = _leer()
        datos['contador'] += 1
        registro['numero'] = f"REP-{datos['contador']:04d}"
        registro['huella'] = _huella(registro)
        datos['reportes'].append(registro)
        _guardar(datos)
    return {'ok': True, 'reporte': _publico(registro)}


@router.get('/{rid}')
def detalle(request: Request, rid: str):
    usuario = _auth(request)
    with _lock:
        r = _buscar(_leer(), rid)
    if not _visible(usuario, r):
        raise HTTPException(403, 'No tienes acceso a este reporte')
    return _publico(r, con_firma=True)


def _registrar_firma(request: Request, rid: str, payload: dict, usuario: str, presencial: bool):
    imagen = _imagen_firma(payload.get('firma'))
    version = _texto(payload.get('version'), 3000, True, 'La versión de lo ocurrido')
    if payload.get('acepta') is not True:
        raise HTTPException(400, 'Debes confirmar que se leyó el reporte')
    with _lock:
        datos = _leer()
        r = _buscar(datos, rid)
        if presencial:
            if not _es_admin(usuario):
                raise HTTPException(403, 'Solo la administración puede registrar la firma de otra persona')
        elif not _mismo(r['operario'], usuario):
            raise HTTPException(403, 'Solo la persona a quien va dirigido el reporte puede firmarlo')
        if r['estado'] != 'pendiente':
            raise HTTPException(409, 'Este reporte ya no está pendiente')
        r['versionOperario'] = version
        r['estado'] = 'firmado'
        r['firma'] = {'imagen': imagen, 'firmante': r['operario'], 'fecha': _ahora(), 'ip': _ip(request),
                      'dispositivo': request.headers.get('user-agent', '')[:200], 'huella': _huella(r)}
        if presencial:
            r['firma']['registradoPor'] = usuario
        _guardar(datos)
        return {'ok': True, 'reporte': _publico(r)}


@router.post('/{rid}/firmar')
def firmar(request: Request, rid: str, payload: dict):
    """Firma del operario, con su versión de los hechos."""
    return _registrar_firma(request, rid, payload, _auth(request), False)


@router.post('/{rid}/firmar-presencial')
def firmar_presencial(request: Request, rid: str, payload: dict):
    """La administración registra la firma del operario, que firma en su pantalla en su presencia."""
    return _registrar_firma(request, rid, payload, _auth(request), True)


@router.post('/{rid}/decision')
def decidir(request: Request, rid: str, payload: dict):
    """Uso exclusivo de gerencia / administración: decisión y firma."""
    usuario = _auth(request)
    if not _es_admin(usuario):
        raise HTTPException(403, 'Solo la administración puede registrar la decisión')
    decision = str(payload.get('decision') or '')
    if decision not in DECISIONES:
        raise HTTPException(400, 'Elige una decisión')
    imagen = _imagen_firma(payload.get('firma'))
    with _lock:
        datos = _leer()
        r = _buscar(datos, rid)
        if r['estado'] != 'firmado':
            raise HTTPException(409, 'La decisión se registra cuando el operario ya firmó')
        r['estado'] = 'resuelto'
        r['gerencia'] = {'imagen': imagen, 'decision': decision, 'nota': _texto(payload.get('nota'), 1500), 'firmante': usuario,
                         'fecha': _ahora(), 'ip': _ip(request)}
        _guardar(datos)
        return {'ok': True, 'reporte': _publico(r)}


@router.post('/{rid}/anular')
def anular(request: Request, rid: str):
    usuario = _auth(request)
    if not _es_admin(usuario):
        raise HTTPException(403, 'Solo la administración puede anular reportes')
    with _lock:
        datos = _leer()
        r = _buscar(datos, rid)
        if r['estado'] != 'pendiente':
            raise HTTPException(409, 'Solo se anulan reportes pendientes de firma')
        r['estado'] = 'anulado'
        r['anulado'] = {'por': usuario, 'fecha': _ahora()}
        _guardar(datos)
        return {'ok': True, 'reporte': _publico(r)}


def _fecha(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).astimezone().strftime('%d/%m/%Y %H:%M')
    except ValueError:
        return iso


@router.get('/{rid}/documento', response_class=HTMLResponse)
def documento(request: Request, rid: str):
    """Versión imprimible con el formato del reporte (Ctrl+P → Guardar como PDF)."""
    usuario = _auth(request)
    with _lock:
        r = _buscar(_leer(), rid)
    if not _visible(usuario, r):
        raise HTTPException(403, 'No tienes acceso a este reporte')
    e = html.escape
    def firma(titulo, f, extra=''):
        if not f:
            return '<div class="fr"><div class="vacia"></div><b>' + titulo + '</b><small>Pendiente</small></div>'
        return ('<div class="fr">' + ('<img alt="Firma" src="' + e(f['imagen'], quote=True) + '">' if f.get('imagen') else '<div class="vacia"></div>') + '<b>' + titulo + '</b><small>' + e(f.get('firmante', '')) + ' · ' + e(_fecha(f['fecha'])) +
                ' · IP ' + e(f.get('ip') or '—') + '</small>' + (('<small>Firma registrada en presencia por ' + e(f['registradoPor']) + '</small>') if f.get('registradoPor') else '') + extra + '</div>')
    ger = r.get('gerencia') or {}
    marca = lambda d: '[ X ] ' + d if ger.get('decision') == d else '[   ] ' + d
    fila = lambda k, v: '<tr><th>' + k + '</th><td>' + e(str(v or '—')) + '</td></tr>'
    estado = {'pendiente': 'PENDIENTE DE FIRMA DEL OPERARIO', 'firmado': 'FIRMADO · PENDIENTE DE DECISIÓN', 'resuelto': 'CERRADO', 'anulado': 'ANULADO'}[r['estado']]
    cuerpo = ('<h1>INDOOR SPORT S.A.S.</h1><h2>REPORTE DE DAÑO / INCIDENTE DE PLANTA <small>' + e(r['numero']) + ' · ' + estado + '</small></h2>'
              '<h3>Datos del incidente y personal</h3><table>' + fila('Fecha', r['fechaHecho']) + fila('Hora', r.get('horaHecho')) + fila('OP / Lote', r.get('orden')) +
              fila('Operario', r['operarioNombre']) + fila('Cargo', r.get('cargo')) + '</table>'
              '<h3>1. Detalle del daño o material perdido</h3><p class="txt"><b>¿Qué pasó?</b> ' + e(r['quePaso']) + '</p><p class="txt"><b>Cantidad / Material perdido:</b> ' + e(r.get('material') or '—') + '</p>'
              '<h3>2. Versión rápida del operario</h3><p class="txt">' + e(r.get('versionOperario') or 'Pendiente') + '</p>'
              '<div class="firmas">' + firma('Coordinador de Planta', {'imagen': '', 'firmante': r['creadoPor'], 'fecha': r['creado']}) + firma('Firma Operario', r.get('firma')) + '</div>'
              '<h3>Uso exclusivo de gerencia / administración</h3><p>Decisión: ' + ' &nbsp; '.join(marca(d) for d in DECISIONES) + '</p>' +
              (('<p class="txt"><b>Nota:</b> ' + e(ger['nota']) + '</p>') if ger.get('nota') else '') + firma('Firma Gerencia', r.get('gerencia')) +
              '<p><small>Creado por ' + e(r['creadoPor']) + ' el ' + e(_fecha(r['creado'])) + ' · Huella SHA-256: ' + e((r.get('firma') or r).get('huella', r.get('huella', ''))) + '</small></p>')
    estilo = ('body{font:14px Arial,sans-serif;max-width:780px;margin:24px auto;padding:0 20px;color:#111}h1{margin:0;text-align:center}h2{text-align:center;margin:4px 0 14px}h2 small{display:block;font-size:11px;color:#555}'
              'h3{background:#e9efe2;padding:6px 10px;margin:16px 0 8px;font-size:13px;text-transform:uppercase}table{border-collapse:collapse;width:100%}th{text-align:left;width:150px;background:#f4f7f0}'
              'th,td{border:1px solid #ccd5c3;padding:6px 10px}.txt{white-space:pre-wrap}.firmas{display:flex;gap:30px;margin-top:20px}.fr{flex:1;text-align:center}.fr img{max-width:100%;max-height:90px;border-bottom:1px solid #111;display:block;margin:0 auto 4px}'
              '.vacia{height:60px;border-bottom:1px solid #111;margin-bottom:4px}.fr b{display:block}.fr small{color:#555;font-size:10px;word-break:break-all}button{padding:8px 14px}@media print{button{display:none}}')
    return HTMLResponse('<!doctype html><html lang="es"><meta charset="utf-8"><title>Reporte ' + e(r['numero']) + '</title><style>' + estilo + '</style><body>' + cuerpo +
                        '<p><button onclick="print()">Imprimir / Guardar PDF</button></p></body></html>')
