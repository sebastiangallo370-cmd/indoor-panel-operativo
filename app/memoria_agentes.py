"""Memoria de los agentes: cada error que llega de un agente (TAVO, LEO, JACK, OLVER, OLIVER, TERRY, STICKERS, ALMA, BRISA, CIRO, ZEUS...) se guarda con una huella
(el texto sin números, rutas ni identificadores). Cuando una persona lo marca como CORREGIDO con una nota, queda como lección aprendida; si esa misma huella vuelve a
aparecer es una REGRESIÓN: sale en la campana y en la pantalla «Memoria de agentes» hasta que se revise. Las lecciones iniciales (errores ya corregidos)
viven en app/lecciones_agentes.json (versionadas), y las nuevas se agregan desde la pantalla o ese archivo.
Los agentes no necesitan cambios: el servidor ya recibe sus avisos de error (eventos de los agentes de edición, líneas de ECOMMERCE y resultados de ZEUS)."""
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

log = logging.getLogger(__name__)
router = APIRouter(prefix='/api/memoria', tags=['memoria'])
_file = Path(os.getenv('MEMORIA_FILE', '/data/state/memoria_agentes.json'))
_semillas = Path(__file__).with_name('lecciones_agentes.json')
_lock = threading.Lock()
_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
MAX_ITEMS = 600
_cache: dict | None = None


def configurar(auth: Callable, permitido: Callable[[str], bool]) -> None:
    global _auth, _permitido
    _auth, _permitido = auth, permitido


def _iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def huella(texto: str) -> str:
    """El mismo error con otro número de orden, ruta o identificador da la misma huella."""
    t = str(texto or '').lower()
    t = re.sub(r'[a-z]:\\[^\s"\']+|(?:/[\w.\-]+){2,}', ' <ruta> ', t)
    t = re.sub(r'\b[0-9a-f]{8,}\b', '<id>', t)
    t = re.sub(r'\b[a-z]{1,4}\d{3,}[a-z0-9_\-]*', '<orden>', t)   # RM7653, CO6128, A700CA00...
    t = re.sub(r'\d+(?:[.,]\d+)?', '#', t)
    t = re.sub(r'\s+', ' ', t).strip()[:160]
    return hashlib.sha1(t.encode('utf-8')).hexdigest()[:12] + '|' + t


def _cargar() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('items', {})
    try:   # lecciones iniciales (errores ya corregidos): se agregan las que falten, sin tocar las que ya existen
        for s in json.loads(_semillas.read_text(encoding='utf-8')):
            if s['id'] not in d['items']:
                d['items'][s['id']] = {'id': s['id'], 'agente': s['agente'], 'patron': s.get('titulo', ''), 'ejemplo': s.get('titulo', ''), 'veces': 0, 'primera': s.get('fecha', ''),
                                       'ultima': '', 'estado': 'corregido', 'nota': s['nota'], 'corregido_por': s.get('por', 'Claude'), 'corregido_at': s.get('fecha', ''),
                                       'veces_despues': 0, 'origen': 'leccion', 'regex': s.get('regex', '')}
    except (OSError, ValueError, KeyError):
        log.exception('memoria: no se pudieron leer las lecciones iniciales')
    _cache = d
    return d


def _guardar(d: dict) -> None:
    try:
        _file.parent.mkdir(parents=True, exist_ok=True)
        tmp = _file.with_suffix('.tmp')
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding='utf-8')
        tmp.replace(_file)
    except OSError:
        log.exception('memoria: no se pudo guardar')


_FALLO = re.compile(r'no pude|no se pudo|falló|fallo|error|excepci|no encontr|sin respuesta|tiempo agotado|cancel', re.I)


def _es_error(nivel: str, texto: str) -> bool:
    """Los agentes avisan sus fallos como ERROR, pero muchos los dejan en WARN («No pude hacer los stickers»): también cuentan si el texto dice que algo falló."""
    n, t = str(nivel or '').upper(), str(texto or '').strip()
    if not t:
        return False
    return n.startswith('ERR') or (n.startswith('WARN') and bool(_FALLO.search(t)))


def registrar(agente: str, texto: str, nivel: str = 'ERROR') -> None:
    """Llamada desde los puntos donde el servidor recibe errores de agentes. Nunca lanza excepciones."""
    try:
        if not _es_error(nivel, texto):
            return
        agente = str(agente or '?').upper()[:12]
        with _lock:
            d = _cargar()
            items = d['items']
            clave = None
            for i in items.values():   # ¿es una lección conocida? (patrón escrito a mano)
                if i.get('regex') and re.search(i['regex'], str(texto), re.I) and i.get('agente', '').upper() in (agente, '*', ''):
                    clave = i['id']
                    break
            if clave is None:
                clave = huella(texto)
                if clave not in items and len(items) >= MAX_ITEMS:
                    viejo = min((i for i in items.values() if i['estado'] in ('abierto', 'ignorado') and i['veces'] <= 1), key=lambda i: i['ultima'] or '', default=None)
                    if viejo:
                        items.pop(viejo['id'], None)
            it = items.get(clave)
            ahora = _iso()
            if it is None:
                it = items[clave] = {'id': clave, 'agente': agente, 'patron': clave.split('|', 1)[-1], 'ejemplo': str(texto)[:300], 'veces': 0, 'primera': ahora, 'ultima': ahora,
                                     'estado': 'abierto', 'nota': '', 'corregido_por': '', 'corregido_at': '', 'veces_despues': 0, 'origen': 'visto', 'regex': ''}
            it['veces'] += 1
            it['ultima'] = ahora
            it['ejemplo'] = str(texto)[:300]
            if it['estado'] == 'corregido':
                it['estado'] = 'regresion'
                it['veces_despues'] = 1
                log.warning('MEMORIA: volvió un error ya corregido (%s): %s', agente, str(texto)[:120])
            elif it['estado'] == 'regresion':
                it['veces_despues'] = int(it.get('veces_despues', 0)) + 1
            _guardar(d)
    except Exception:   # noqa: BLE001
        log.exception('memoria: no se pudo registrar el error')


def alertas() -> list[dict]:
    """Errores corregidos que volvieron (para la campana de Administración)."""
    with _lock:
        d = _cargar()
        return [{'tipo': 'agentes', 'orden': i['id'][:8], 'cliente': '', 'severidad': 'alta', 'titulo': f"{i['agente']}: volvió un error que ya estaba corregido",
                 'detalle': (i['ejemplo'] or '')[:180] + (f" · {i['veces_despues']} vez/veces desde la corrección" if i.get('veces_despues') else '')}
                for i in d['items'].values() if i['estado'] == 'regresion']


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'Solo Administración / Coordinación puede ver la memoria de los agentes')
    return usuario


ORDEN = {'regresion': 0, 'abierto': 1, 'corregido': 2, 'ignorado': 3}


@router.get('')
def listar(request: Request):
    _usuario(request)
    with _lock:
        d = _cargar()
        items = sorted(d['items'].values(), key=lambda i: i.get('ultima') or i.get('corregido_at') or '', reverse=True)
        items.sort(key=lambda i: ORDEN.get(i['estado'], 9))   # estable: dentro de cada estado, lo más reciente primero
        resumen = {e: sum(1 for i in items if i['estado'] == e) for e in ORDEN}
    return {'items': items, 'resumen': resumen}


def _item(d: dict, iid: str) -> dict:
    it = d['items'].get(iid)
    if not it:
        raise HTTPException(404, 'No encontré ese error')
    return it


@router.post('/corregir')
def corregir(request: Request, payload: dict):
    """Marca el error como corregido con una nota de qué se hizo: desde ese momento, si vuelve, es una regresión."""
    usuario = _usuario(request)
    nota = str(payload.get('nota', '')).strip()
    if len(nota) < 4:
        raise HTTPException(400, 'Escribe qué se corrigió (para recordarlo)')
    with _lock:
        d = _cargar()
        it = _item(d, str(payload.get('id', '')))
        it.update(estado='corregido', nota=nota[:400], corregido_por=usuario, corregido_at=_iso(), veces_despues=0)
        _guardar(d)
    return {'ok': True}


@router.post('/reabrir')
def reabrir(request: Request, payload: dict):
    _usuario(request)
    with _lock:
        d = _cargar()
        it = _item(d, str(payload.get('id', '')))
        it.update(estado='abierto', veces_despues=0)
        _guardar(d)
    return {'ok': True}


@router.post('/ignorar')
def ignorar(request: Request, payload: dict):
    _usuario(request)
    with _lock:
        d = _cargar()
        it = _item(d, str(payload.get('id', '')))
        it.update(estado='ignorado')
        _guardar(d)
    return {'ok': True}
