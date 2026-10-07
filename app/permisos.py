"""Permisos por rol: qué módulos puede ver, editar o exportar cada perfil.

El rol sale del campo "proceso" de la cuenta (Administración, Comercial, Edición…).
Los valores por defecto conservan el comportamiento anterior; la administración
los cambia desde /permisos. La fila de Administración no se puede restringir.
"""
import json
import os
import threading
import unicodedata
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Request

ROLES = {
    'administracion': 'Administración / Coordinador',
    'comercial': 'Comercial',
    'edicion': 'Edición',
    'operario': 'Operarios y demás áreas',
}
MODULOS = {
    'inventario': ('Inventarios', ('ver', 'editar', 'exportar')),
    'cartera': ('Cartera', ('ver', 'editar', 'exportar')),
    'produccion': ('Producción', ('exportar',)),
    'agentes': ('Agentes de edición', ('ver', 'editar')),
    'promedios': ('Promedios maestros', ('ver', 'editar')),
}
ACCIONES = {'ver': 'Ver', 'editar': 'Editar', 'exportar': 'Exportar a Excel'}

_ADMIN = {'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO', 'COORDINADOR'}
_COMERCIAL = {'COMERCIAL', 'COMERCIALES', 'ASISTENTE COMERCIAL', 'ASISTENTES COMERCIALES'}

_file = Path(os.getenv('PERMISOS_FILE', '/data/state/permisos.json'))
_lock = threading.Lock()
_lookup: Callable[[str], str | None] = lambda username: None  # proceso de la cuenta; lo registra main.py
router = APIRouter(prefix='/api/permisos', tags=['permisos'])


def _todo(valor: bool) -> dict:
    return {m: {a: valor for a in acciones} for m, (_, acciones) in MODULOS.items()}


def _defaults() -> dict:
    matriz = {rol: _todo(True) for rol in ROLES}
    matriz['edicion']['cartera'] = {'ver': False, 'editar': False, 'exportar': False}
    matriz['operario']['cartera'] = {'ver': False, 'editar': False, 'exportar': False}
    matriz['operario']['produccion']['exportar'] = False
    matriz['operario']['agentes'] = {'ver': False, 'editar': False}
    matriz['comercial']['agentes'] = {'ver': False, 'editar': False}
    matriz['operario']['promedios'] = {'ver': False, 'editar': False}
    matriz['comercial']['promedios'] = {'ver': False, 'editar': False}
    return matriz


def registrar_lookup(fn: Callable[[str], str | None]) -> None:
    global _lookup
    _lookup = fn


def _plano(texto) -> str:
    sin_tildes = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c))
    return ' '.join(sin_tildes.upper().split())


def rol_de(username: str) -> str:
    if username == os.getenv('APP_USER', 'indoor'):
        return 'administracion'
    proceso = _plano(_lookup(username))
    if proceso in _ADMIN:
        return 'administracion'
    if proceso in _COMERCIAL:
        return 'comercial'
    if proceso == 'EDICION':
        return 'edicion'
    return 'operario'


def matriz() -> dict:
    """Valores por defecto con lo guardado encima; Administración siempre con todo."""
    resultado = _defaults()
    try:
        guardado = json.loads(_file.read_text(encoding='utf-8')).get('matriz', {})
    except (OSError, ValueError):
        guardado = {}
    for rol in ROLES:
        for modulo, (_, acciones) in MODULOS.items():
            for accion in acciones:
                valor = ((guardado.get(rol) or {}).get(modulo) or {}).get(accion)
                if isinstance(valor, bool):
                    resultado[rol][modulo][accion] = valor
    resultado['administracion'] = _todo(True)
    return resultado


_PROCESOS_AGENTES = {'EDICION', 'COORDINADOR'}   # los agentes de edición solo los ven las cuentas con proceso Edición o Coordinador


def agentes_permitido(username: str) -> bool:
    """Regla fija (no se cambia desde /permisos): solo Edición y Coordinador, más la cuenta maestra de la aplicación."""
    if username == os.getenv('APP_USER', 'indoor'):
        return True
    return _plano(_lookup(username)) in _PROCESOS_AGENTES


_SIN_MODULO = {'cartera': {'AP'}}   # cuentas a las que no se les muestra un módulo aunque su rol lo tenga (excepciones por persona)


def sin_modulo(username: str, modulo: str) -> bool:
    return _plano(username) in {_plano(u) for u in _SIN_MODULO.get(modulo, set())}


def puede(username: str, modulo: str, accion: str) -> bool:
    if sin_modulo(username, modulo):
        return False
    if modulo == 'agentes' and not agentes_permitido(username):
        return False
    return bool(matriz().get(rol_de(username), {}).get(modulo, {}).get(accion))


def guardar(nueva: dict) -> dict:
    limpia = {}
    for rol in ROLES:
        limpia[rol] = {m: {a: bool(((nueva.get(rol) or {}).get(m) or {}).get(a)) for a in acciones}
                       for m, (_, acciones) in MODULOS.items()}
    limpia['administracion'] = _todo(True)
    with _lock:
        _file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _file.with_suffix('.tmp')
        tmp.write_text(json.dumps({'matriz': limpia}, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp.replace(_file)
    return limpia


def exigir(modulo: str, accion: str | None = None):
    """Dependencia de FastAPI. Sin `accion`: GET/HEAD piden 'ver' y el resto 'editar'."""
    def comprobar(request: Request, usuario: str = Depends(_autenticar)):
        pedida = accion or ('ver' if request.method in ('GET', 'HEAD') else 'editar')
        if not puede(usuario, modulo, pedida):
            raise HTTPException(403, 'Tu perfil no tiene permiso para esta acción')
        return usuario
    return comprobar


_autenticar: Callable = lambda: None  # lo registra main.py (es la función authenticate)


def registrar_autenticacion(fn: Callable) -> None:
    global _autenticar
    _autenticar = fn


@router.get('/mi')
def mis_permisos(request: Request):
    usuario = _autenticar(request)
    rol = rol_de(usuario)
    permisos = json.loads(json.dumps(matriz()[rol]))
    if not agentes_permitido(usuario):
        permisos['agentes'] = {'ver': False, 'editar': False}
    for modulo in list(permisos):
        if sin_modulo(usuario, modulo):
            permisos[modulo] = {accion: False for accion in permisos[modulo]}
    return {'usuario': usuario, 'rol': rol, 'rol_nombre': ROLES[rol], 'admin': rol == 'administracion',
            'permisos': permisos}


# (Se eliminó la pantalla y los endpoints para cambiar la matriz de permisos: rigen los valores por defecto de _defaults().)
