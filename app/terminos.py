"""Términos y condiciones de uso del panel: todos los usuarios los aceptan al entrar (y de nuevo cada vez que cambian).

El texto y las aceptaciones viven en /data/state/terminos.json. El texto lo editan Administración/Coordinador, la cuenta «Indoor Sport» y la cuenta
maestra; al guardarlo sube la versión y todos deben volver a aceptar.
"""
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

from app import permisos

_lock = threading.Lock()
MAX_TEXTO = 40000

TEXTO_BASE = """TÉRMINOS Y CONDICIONES DE USO DEL PANEL OPERATIVO · INDOOR SPORT S.A.S.

1. OBJETO
El panel operativo es una herramienta interna de Indoor Sport S.A.S. para programar, seguir y controlar la producción, los inventarios, la cartera y la información del personal. Al ingresar, el usuario acepta estos términos.

2. CUENTA Y CONTRASEÑA
La cuenta es personal e intransferible. El usuario responde por lo que se haga con ella, no debe compartir su contraseña y debe avisar de inmediato si cree que otra persona la conoce.

3. USO PERMITIDO
El panel se usa únicamente para las labores asignadas por la empresa. No se permite registrar información falsa, alterar datos de otras áreas sin autorización, ni intentar entrar a módulos a los que la cuenta no tiene acceso.

4. CONFIDENCIALIDAD
La información del panel (clientes, pedidos, diseños, moldes, fichas técnicas, precios, cartera, inventarios y datos del personal) es confidencial y propiedad de Indoor Sport S.A.S. No puede copiarse, fotografiarse, descargarse ni compartirse con terceros sin autorización de la empresa. Esta obligación continúa después de terminar el vínculo con la empresa.

5. DATOS PERSONALES
El usuario autoriza el tratamiento de sus datos personales para fines laborales y administrativos, conforme a la Ley 1581 de 2012 y a la política de tratamiento de datos de la empresa. Quien consulte datos de otras personas en el panel debe usarlos solo para su labor.

6. REGISTRO DE ACTIVIDAD
El panel guarda registro de los ingresos y de las acciones de cada cuenta (quién hizo qué y cuándo) con fines de control, trazabilidad y seguridad.

7. DOCUMENTOS DESCARGADOS
Los contratos, cartas laborales, fichas técnicas, moldes y demás archivos descargados del panel son para uso exclusivo del fin con que se entregan.

8. INCUMPLIMIENTO
El uso indebido del panel puede llevar a la suspensión de la cuenta y a las medidas disciplinarias y legales que correspondan.

9. CAMBIOS
La empresa puede actualizar estos términos. Cuando cambien, el panel pedirá aceptarlos de nuevo al ingresar.
"""


def _archivo() -> Path:
    return Path(os.getenv('TERMINOS_FILE', '/data/state/terminos.json'))   # la variable permite probar con una copia aislada


def _leer() -> dict:
    try:
        d = json.loads(_archivo().read_text(encoding='utf-8'))
        if isinstance(d, dict) and d.get('texto'):
            d.setdefault('version', 1)
            d.setdefault('aceptaciones', {})
            d.setdefault('publicado', False)
            return d
    except (OSError, ValueError):
        pass
    return {'version': 1, 'texto': TEXTO_BASE, 'actualizado': '', 'por': '', 'aceptaciones': {}, 'publicado': False}


def _guardar(d: dict) -> None:
    destino = _archivo()
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(destino)


def _ahora() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).strftime('%Y-%m-%d %H:%M')


def _clave(usuario: str) -> str:
    return str(usuario or '').strip().upper()


def puede_editar(usuario: str) -> bool:
    return _clave(usuario) == 'INDOOR SPORT' or permisos.administracion_permitido(usuario)


def estado(usuario: str) -> dict:
    d = _leer()
    a = d['aceptaciones'].get(_clave(usuario)) or {}
    return {'version': d['version'], 'texto': d['texto'], 'actualizado': d.get('actualizado', ''), 'por': d.get('por', ''),
            'aceptado': a.get('version') == d['version'], 'aceptado_fecha': a.get('fecha', '') if a.get('version') == d['version'] else '',
            'puede_editar': puede_editar(usuario), 'publicado': bool(d.get('publicado'))}   # sin publicar no se le exige a nadie


def aceptar(usuario: str, version) -> dict:
    with _lock:
        d = _leer()
        if not d.get('publicado'):
            raise HTTPException(409, 'Los términos todavía no están publicados')
        if version != d['version']:
            raise HTTPException(409, 'Los términos cambiaron: vuelve a leerlos')
        d['aceptaciones'][_clave(usuario)] = {'usuario': str(usuario)[:60], 'version': d['version'], 'fecha': _ahora()}
        _guardar(d)
    return estado(usuario)


def guardar_texto(usuario: str, texto) -> dict:
    if not puede_editar(usuario):
        raise HTTPException(403, 'Tu cuenta no puede cambiar los términos y condiciones')
    texto = str(texto or '').replace('\r', '').strip()
    if len(texto) < 20:
        raise HTTPException(400, 'El texto está vacío o es demasiado corto')
    if len(texto) > MAX_TEXTO:
        raise HTTPException(400, 'El texto es demasiado largo')
    with _lock:
        d = _leer()
        if texto != d['texto'] or not _archivo().exists():   # un borrador se corrige sin subir versión; ya publicado, cambiarlo obliga a aceptar de nuevo
            d.update(texto=texto, version=int(d['version']) + (1 if d.get('publicado') else 0), actualizado=_ahora(), por=str(usuario)[:60])
            _guardar(d)
    return estado(usuario)


def publicar(usuario: str) -> dict:
    """Pone en vigencia el texto: desde ese momento todos los usuarios deben aceptarlo al entrar."""
    if not puede_editar(usuario):
        raise HTTPException(403, 'Tu cuenta no puede publicar los términos y condiciones')
    with _lock:
        d = _leer()
        if not d.get('publicado'):
            d.update(publicado=True, actualizado=_ahora(), por=str(usuario)[:60])
            _guardar(d)
    return estado(usuario)


def aceptaciones(usuario: str, cuentas: list) -> dict:
    """Quién aceptó la versión vigente y quién falta (solo para quien puede editar)."""
    if not puede_editar(usuario):
        raise HTTPException(403, 'Tu cuenta no puede ver las aceptaciones')
    d = _leer()
    filas = []
    for nombre in cuentas:
        a = d['aceptaciones'].get(_clave(nombre)) or {}
        al_dia = a.get('version') == d['version']
        filas.append({'usuario': nombre, 'aceptado': al_dia, 'fecha': a.get('fecha', '') if al_dia else '', 'version': a.get('version') or 0})
    filas.sort(key=lambda x: (x['aceptado'], x['usuario'].casefold()))
    return {'version': d['version'], 'usuarios': filas, 'aceptaron': sum(1 for x in filas if x['aceptado']), 'total': len(filas)}
