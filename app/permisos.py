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
    'contabilidad_confeccion': ('Contabilidad de confección', ('ver', 'editar')),
    'dian': ('Agente DIAN', ('ver', 'editar')),
    'promedios': ('Promedios maestros', ('ver', 'editar')),
    'molderia': ('Moldería', ('ver', 'editar')),
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
    # El agente DIAN se abre desde el panel de Agentes. Por defecto sigue la
    # misma regla de acceso; Administración puede autorizar casos puntuales.
    matriz['comercial']['dian'] = {'ver': False, 'editar': False}
    matriz['operario']['dian'] = {'ver': False, 'editar': False}
    # Estándar 2026 (Promedios maestros + Fichas técnicas) lo ve todo el mundo; solo Administración y Edición lo editan
    matriz['operario']['promedios'] = {'ver': True, 'editar': False}
    matriz['comercial']['promedios'] = {'ver': True, 'editar': False}
    # Conectar libros de fichas escribe en el NAS: solo Coordinación/Administración y Edición.
    matriz['operario']['molderia'] = {'ver': True, 'editar': False}
    matriz['comercial']['molderia'] = {'ver': True, 'editar': False}
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


def _guardado() -> dict:
    try:
        value = json.loads(_file.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def permiso_personalizado(username: str, modulo: str, accion: str) -> bool | None:
    """Decisión explícita por persona; None significa que sigue la regla de rol."""
    usuarios = _guardado().get('usuarios', {})
    personalizado = next((v for k, v in usuarios.items() if _plano(k) == _plano(username)), {})
    value = ((personalizado.get(modulo) or {}).get(accion)) if isinstance(personalizado, dict) else None
    return value if isinstance(value, bool) else None


def permisos_usuario(username: str) -> dict:
    """Permisos efectivos editables por persona, antes de las reglas fijas."""
    resultado = json.loads(json.dumps(matriz().get(rol_de(username), {})))
    for modulo, (_, acciones) in MODULOS.items():
        for accion in acciones:
            value = permiso_personalizado(username, modulo, accion)
            if isinstance(value, bool):
                resultado[modulo][accion] = value
    return resultado


def guardar_permisos_usuario(username: str, permisos: dict) -> dict:
    """Guarda solo las excepciones explícitas de una cuenta; no permite limitar administración."""
    if rol_de(username) == 'administracion':
        raise HTTPException(400, 'Las cuentas de administración conservan todos sus permisos.')
    limpia = {m: {a: bool((permisos.get(m) or {}).get(a)) for a in acciones}
              for m, (_, acciones) in MODULOS.items()}
    with _lock:
        data = _guardado()
        usuarios = data.setdefault('usuarios', {})
        anterior = next((k for k in usuarios if _plano(k) == _plano(username)), username)
        usuarios[anterior] = limpia
        _file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _file.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp.replace(_file)
    return limpia


_PROCESOS_AGENTES = {'EDICION', 'COORDINADOR'}   # los agentes de edición solo los ven las cuentas con proceso Edición o Coordinador

_CONTABILIDAD_CONFECCION_USUARIOS = {'INDOOR SPORT', 'DB', 'CESAR AUGUSTO LOPEZ', 'AU', 'AL'}  # DB = Dagoberto Botero (solo consulta); CESAR AUGUSTO LOPEZ = solo consulta
_CONTABILIDAD_CONFECCION_EDITAN = {'INDOOR SPORT', 'DB', 'CESAR AUGUSTO LOPEZ', 'AU', 'AL'}  # editan y eliminan (DB = Dagoberto, operario que paga a confección)


def contabilidad_confeccion_permitido(username: str) -> bool:
    """La contabilidad de talleres es privada: solo la cuenta designada y la maestra."""
    return username == os.getenv('APP_USER', 'indoor') or _plano(username) in _CONTABILIDAD_CONFECCION_USUARIOS


def agentes_permitido(username: str) -> bool:
    """Regla fija (no se cambia desde /permisos): solo Edición y Coordinador, más la cuenta maestra de la aplicación."""
    personal = permiso_personalizado(username, 'agentes', 'ver')
    if personal is not None:
        return personal
    if username == os.getenv('APP_USER', 'indoor'):
        return True
    return _plano(_lookup(username)) in _PROCESOS_AGENTES


def dian_permitido(username: str) -> bool:
    """DIAN es un agente local: Coordinación/Administración y los usuarios
    autorizados explícitamente pueden abrirlo desde el robot de Agentes."""
    personal = permiso_personalizado(username, 'dian', 'ver')
    if personal is not None:
        return personal
    return administracion_permitido(username) or agentes_permitido(username)


_TESORERIA_EXTRA = {'INDOOR SPORT'}   # además de los comerciales, solo esta cuenta entra a Tesorería (donde vive Cartera)
_TESORERIA_ADMINISTRATIVOS = {'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO'}   # las cuentas administrativas también ven Tesorería (pedido del usuario, 2026-10-10)


def tesoreria_permitido(username: str) -> bool:
    """Regla fija (no se cambia desde /permisos): Tesorería, y con ella Cartera, son para las cuentas con proceso Comercial o Administración (administrativos) y la cuenta «Indoor Sport»."""
    personal = permiso_personalizado(username, 'cartera', 'ver')
    if personal is not None:
        return personal
    if _plano(username) in _TESORERIA_EXTRA:
        return True
    return _plano(_lookup(username)) in (_COMERCIAL | _TESORERIA_ADMINISTRATIVOS)


_DASHBOARD_ADMIN_USUARIOS = {'INDOOR SPORT', 'CESAR AUGUSTO', 'CESAR ANDRES'}


def dashboard_administrativo_permitido(username: str) -> bool:
    """Vista corporativa: únicamente las tres cuentas autorizadas por gerencia."""
    return _plano(username) in _DASHBOARD_ADMIN_USUARIOS


_PROCESOS_COMERCIALES = _COMERCIAL | {'COORDINADOR', 'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO'}


def comerciales_permitido(username: str) -> bool:
    """Regla fija: el módulo COMERCIALES (REPROGRAMACIONES, PROGRAMAR y EXCEL) lo ven solo las cuentas con proceso Comercial, Coordinador o Administración, más la cuenta maestra."""
    if username == os.getenv('APP_USER', 'indoor'):
        return True
    return _plano(_lookup(username)) in _PROCESOS_COMERCIALES


_PROCESOS_ADMINISTRACION = {'COORDINADOR', 'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO'}


def administracion_permitido(username: str) -> bool:
    """Regla fija: el módulo ADMINISTRACIÓN lo ven las cuentas con proceso Coordinador o Administración, más la cuenta maestra."""
    if username == os.getenv('APP_USER', 'indoor'):
        return True
    return _plano(_lookup(username)) in _PROCESOS_ADMINISTRACION


_ZEUS_EXTRA = {'SS'}   # cuentas que ven y usan el AGENTE INVENTARIO además de Administración/Coordinación (SS = Stiven Sánchez)


def zeus_permitido(username: str) -> bool:
    """AGENTE INVENTARIO: Administración y Coordinación, más las cuentas de _ZEUS_EXTRA. (La pestaña «API Effi» sigue solo para «Indoor Sport».)"""
    return administracion_permitido(username) or str(username or '').strip().upper() in _ZEUS_EXTRA


_EDITAN_FICHAS = {'INDOOR SPORT'}   # cuentas que pueden corregir los textos de las fichas técnicas, además de las de proceso Patronaje


def fichas_editar_permitido(username: str) -> bool:
    """Regla fija: los textos de las fichas técnicas los editan la cuenta «Indoor Sport», las cuentas con proceso Patronaje y la cuenta maestra."""
    if username == os.getenv('APP_USER', 'indoor') or _plano(username) in _EDITAN_FICHAS:
        return True
    return _plano(_lookup(username)) == 'PATRONAJE'


def rhumano_permitido(username: str) -> bool:
    """El módulo R.HUMANO (recurso humano) y su submódulo CONTRATOS Y C.LABORAL los ven TODOS los usuarios con sesión (pedido del usuario, 2026-10-09)."""
    return True


_SIN_MODULO = {'cartera': {'AP'}}   # cuentas a las que no se les muestra un módulo aunque su rol lo tenga (excepciones por persona)


def sin_modulo(username: str, modulo: str) -> bool:
    return _plano(username) in {_plano(u) for u in _SIN_MODULO.get(modulo, set())}


def puede(username: str, modulo: str, accion: str) -> bool:
    if modulo == 'contabilidad_confeccion' and not contabilidad_confeccion_permitido(username):
        return False
    if modulo == 'contabilidad_confeccion' and accion == 'editar':
        # Editar y eliminar en contabilidad: solo las cuentas que editan y la maestra
        return _plano(username) in _CONTABILIDAD_CONFECCION_EDITAN or username == os.getenv('APP_USER', 'indoor')
    personal = permiso_personalizado(username, modulo, accion)
    if personal is not None:
        return personal
    if sin_modulo(username, modulo):
        return False
    if modulo in ('cartera', 'tesoreria') and not tesoreria_permitido(username):
        return False
    if modulo == 'agentes' and not agentes_permitido(username):
        return False
    if modulo == 'dian' and not dian_permitido(username):
        return False
    if modulo == 'comerciales' and not comerciales_permitido(username):
        return False
    if modulo == 'rhumano' and not rhumano_permitido(username):
        return False
    if modulo == 'administracion' and not administracion_permitido(username):
        return False
    return bool(permisos_usuario(username).get(modulo, {}).get(accion))


def guardar(nueva: dict) -> dict:
    limpia = {}
    for rol in ROLES:
        limpia[rol] = {m: {a: bool(((nueva.get(rol) or {}).get(m) or {}).get(a)) for a in acciones}
                       for m, (_, acciones) in MODULOS.items()}
    limpia['administracion'] = _todo(True)
    with _lock:
        data = _guardado()
        data['matriz'] = limpia
        _file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _file.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
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


def exigir_info_tela():
    """Información de tela pertenece al módulo Estándar/Promedios.

    Mantiene el control de lectura y edición por método HTTP sin duplicar una
    regla de permisos para el router de proveedores.
    """
    return exigir('promedios')


_autenticar: Callable = lambda: None  # lo registra main.py (es la función authenticate)


def registrar_autenticacion(fn: Callable) -> None:
    global _autenticar
    _autenticar = fn


@router.get('/mi')
def mis_permisos(request: Request):
    usuario = _autenticar(request)
    rol = rol_de(usuario)
    permisos = permisos_usuario(usuario)
    if not agentes_permitido(usuario):
        permisos['agentes'] = {'ver': False, 'editar': False}
    if not contabilidad_confeccion_permitido(usuario):
        permisos['contabilidad_confeccion'] = {'ver': False, 'editar': False}
    else:
        permisos.setdefault('contabilidad_confeccion', {})['editar'] = _plano(usuario) in _CONTABILIDAD_CONFECCION_EDITAN or usuario == os.getenv('APP_USER', 'indoor')
    if not tesoreria_permitido(usuario):
        permisos['cartera'] = {accion: False for accion in permisos['cartera']}
    for modulo in list(permisos):
        if sin_modulo(usuario, modulo):
            permisos[modulo] = {accion: False for accion in permisos[modulo]}
    return {'usuario': usuario, 'rol': rol, 'rol_nombre': ROLES[rol], 'admin': rol == 'administracion',
            'tesoreria': tesoreria_permitido(usuario), 'comerciales': comerciales_permitido(usuario), 'rhumano': rhumano_permitido(usuario), 'administracion': administracion_permitido(usuario), 'fichas_editar': fichas_editar_permitido(usuario), 'permisos': permisos}


# (Se eliminó la pantalla y los endpoints para cambiar la matriz de permisos: rigen los valores por defecto de _defaults().)


def bitacora_permitido(username: str) -> bool:
    """Regla fija: la bitácora de cambios solo la ve la cuenta «Indoor Sport»."""
    return _plano(username) == 'INDOOR SPORT'
