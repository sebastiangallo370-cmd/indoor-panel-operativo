"""R.HUMANO > CONTRATOS: cada empleado descarga la copia de SU contrato escribiendo nombre completo, cédula y cargo.

Los PDF y el índice viven en /data/state/rh_contratos (no se versionan; se suben desde el PC de administración porque el servidor no tiene permiso
sobre la carpeta de nómina de la NAS). El índice no guarda la cédula en claro, solo su huella. Nunca se entrega la lista de empleados: solo se
responde «coincide / no coincide», y tras varios intentos fallidos se bloquea un rato.
"""
import hashlib
import json
import logging
import os
import re
import threading
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

DATOS = Path(os.getenv('RH_CONTRATOS_DIR', '/data/state/rh_contratos'))
MAX_FALLOS, VENTANA = 5, 15 * 60   # intentos fallidos permitidos por cuenta en 15 minutos
_fallos: dict = {}
_lock = threading.Lock()
_NO_COINCIDE = 'Los datos no coinciden con ningún contrato. Revisa el nombre completo, la cédula y el cargo tal como están en tu contrato.'


def _plano(texto) -> str:
    sin = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Za-z0-9 ]+', ' ', sin)).strip().upper()


def _indice() -> dict:
    try:
        return json.loads((DATOS / 'indice.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'sal': '', 'empleados': []}


def disponibles() -> int:
    return len(_indice().get('empleados', []))


def _nombre_ok(escrito: str, registrado: str) -> bool:
    """Nombre completo: las palabras del contrato deben estar en lo escrito (el orden no importa). Con cuatro o más palabras se tolera que falte
    una (un segundo nombre); nunca valen palabras que no estén en el contrato."""
    a, b = set(_plano(escrito).split()), set(_plano(registrado).split())
    if len(b) < 2 or not a or not a <= b:
        return False
    return len(b - a) <= (1 if len(b) >= 4 else 0)


def _cargo_ok(escrito: str, cargos: list) -> bool:
    """Cargo: igual o casi igual al del contrato («OPERARIO CORTE LASER» vale para «OPERARIO MAQUINA CORTE LASER»)."""
    e = _plano(escrito)
    pe = {w for w in e.split() if len(w) >= 4}
    if not pe:
        return False
    for cargo in cargos:
        c = _plano(cargo)
        pc = {w for w in c.split() if len(w) >= 4}
        if e == c or SequenceMatcher(None, e, c).ratio() >= 0.82 or (len(pe) >= 2 and pe <= pc) or (len(pc) >= 2 and pc <= pe):
            return True
    return False


def _buscar(nombre: str, cedula: str, cargo: str):
    datos = _indice()
    digitos = re.sub(r'\D', '', str(cedula or ''))
    if not 6 <= len(digitos) <= 10:
        return None
    huella = hashlib.sha256((datos.get('sal', '') + digitos).encode()).hexdigest()
    for e in datos.get('empleados', []):
        if e.get('cedula_sha') == huella and _nombre_ok(nombre, e.get('nombre', '')) and _cargo_ok(cargo, e.get('cargos', [])):
            return e
    return None


def entregar(usuario: str, payload: dict):
    """Devuelve el PDF del contrato si los tres datos coinciden con un empleado activo; si no, 403 sin decir qué dato falló."""
    ahora = time.time()
    with _lock:
        recientes = [t for t in _fallos.get(usuario, []) if ahora - t < VENTANA]
        _fallos[usuario] = recientes
        if len(recientes) >= MAX_FALLOS:
            espera = int((VENTANA - (ahora - recientes[0])) / 60) + 1
            raise HTTPException(429, f'Demasiados intentos. Vuelve a intentarlo en {espera} minutos o pide ayuda en Administración.')
    empleado = _buscar(payload.get('nombre', ''), payload.get('cedula', ''), payload.get('cargo', ''))
    if not empleado:
        with _lock:
            _fallos.setdefault(usuario, []).append(ahora)
        logging.warning('RH contratos: intento fallido de la cuenta %s', usuario)
        raise HTTPException(403, _NO_COINCIDE)
    ruta = DATOS / str(empleado.get('archivo', ''))
    if not re.fullmatch(r'[a-z0-9-]+\.pdf', str(empleado.get('archivo', ''))) or not ruta.is_file():
        raise HTTPException(404, 'Tu contrato todavía no está cargado. Pídelo en Administración.')
    logging.info('RH contratos: la cuenta %s descargó el contrato %s', usuario, empleado.get('id'))
    nombre = 'Contrato ' + ' '.join(p.capitalize() for p in str(empleado.get('nombre', '')).split()) + '.pdf'
    return FileResponse(ruta, media_type='application/pdf', filename=nombre, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
