"""ECOMMERCE: control web de los agentes de las ÓRDENES DE VENTA (flujo de la carpeta «AUTOMATIZACION_PAGINA WEB» · BOT_ORDENES_VENTA).

El bot original hace todo seguido con cada orden; aquí el trabajo se reparte en tres agentes que se pasan las órdenes por una cola:
  ALMA   descarga el PDF de cada orden de venta nueva de Effi ERP
  BRISA  lee el PDF, busca el maestro y exporta las tallas en Illustrator
  CIRO   pone nombre y número (un PDF por jugador), arma el listado de producción, llena Google Sheets y marca la orden como procesada
Los agentes corren en el PC de la oficina, en la misma carpeta que los de edición (agentes_uniformes/ecommerce). El panel no se conecta
al PC: el PC pregunta cada pocos segundos (sondeo saliente, sin abrir puertos), recibe las órdenes pendientes (iniciar / detener /
reiniciar) y devuelve el estado de cada agente, las últimas líneas de su log y cuántas órdenes hay en cada etapa de la cola.
Datos en /data/state/ecommerce.json y el token del PC en /data/state/ecommerce_token.txt.
"""
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix='/api/ecommerce', tags=['ecommerce'])            # personas (con sesión)
pc_router = APIRouter(prefix='/api/ecommerce/pc', tags=['ecommerce-pc'])   # el PC con los bots (con token)
_file = Path(os.getenv('ECOMMERCE_FILE', '/data/state/ecommerce.json'))
_token_file = Path(os.getenv('ECOMMERCE_TOKEN_FILE', '/data/state/ecommerce_token.txt'))
_lock = threading.Lock()
LATIDO_SEG = 25         # el PC se considera conectado si sondeó hace menos de esto
MAX_LOG = 1500
MAX_ORDENES = 120
ORDEN_VENCE_SEG = 120   # una orden que el PC no tomó en este tiempo se descarta (el PC estaba apagado)
_auth: Callable = lambda request: None
_permitido: Callable[[str], bool] = lambda usuario: False

AGENTES = [
    {'id': 'alma', 'nombre': 'ALMA', 'titulo': 'Descarga las órdenes', 'tipo': 'ov', 'arg': 'descarga', 'color': '#8bd450', 'paso': 1,
     'funciones': ['Entra a Effi ERP con la cuenta de la empresa y vigila las ÓRDENES DE VENTA nuevas (no anuladas, desde la fecha mínima)',
                   'Descarga el PDF de cada orden (OV_<número>.pdf) y la deja en la cola para BRISA',
                   'No repite órdenes que ya están en la cola o en el historial de procesadas']},
    {'id': 'brisa', 'nombre': 'BRISA', 'titulo': 'Exporta las tallas', 'tipo': 'ov', 'arg': 'tallas', 'color': '#6cb6ff', 'paso': 2,
     'funciones': ['Lee el PDF de la orden: referencia, diseño, talla, nombre y número de cada prenda',
                   'Busca el maestro en MAESTROS/INTERCLASES 2027 y lo abre en Illustrator',
                   'Exporta (desempaca) las mesas de cada talla en Montajes y deja la orden lista para CIRO',
                   'Si Illustrator falla reintenta; a los 3 intentos la orden pasa a «con avisos»']},
    {'id': 'ciro', 'nombre': 'CIRO', 'titulo': 'PDF por jugador + Google Sheets', 'tipo': 'ov', 'arg': 'pdfs', 'color': '#ffb04a', 'paso': 3,
     'funciones': ['Abre cada talla exportada y pone el nombre y el número de cada jugador: un PDF por jugador',
                   'Arma el listado de producción (Excel) de la orden',
                   'Llena la fila de la orden en Google Sheets (ORDENES DE PRODUCCION)',
                   'Marca la orden como procesada; si algo falló queda en «con avisos» para revisarla']},
]
POR_ID = {a['id']: a for a in AGENTES}
ACCIONES = ('iniciar', 'detener', 'reiniciar', 'revisar')   # «revisar» = ALMA mira Effi ya, sin esperar su próxima vuelta
ESTADOS_ACTIVOS = ('CORRIENDO', 'EN_FILA')
ETAPAS_COLA = ('descargadas', 'tallas', 'terminadas', 'errores')   # órdenes en cada etapa: esperan a BRISA / esperan a CIRO / terminadas / con avisos


def configurar(autenticar: Callable, permitido: Callable[[str], bool]) -> None:
    global _auth, _permitido
    _auth, _permitido = autenticar, permitido


def _ahora() -> float:
    return time.time()


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _leer() -> dict:
    try:
        datos = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('seq', 0)
    datos.setdefault('latido', {})
    datos.setdefault('agentes', {})   # id -> {estado, desde, pid, ultima}
    datos.setdefault('ordenes', [])   # órdenes iniciar/detener/reiniciar para el PC
    datos.setdefault('log', [])
    datos.setdefault('cola', {})   # órdenes en cada etapa de la cola del PC
    datos.setdefault('latidos', {})     # agente -> qué hace ahora y cuánto falta para su próxima revisión
    datos.setdefault('trabajos', [])    # órdenes de venta que hay ahora en la cola (con su detalle)
    datos.setdefault('historial', [])   # órdenes que terminaron (para las cifras de hoy)
    datos.setdefault('vistos', [])
    return datos


def _guardar(datos: dict) -> None:
    datos['log'] = datos['log'][-MAX_LOG:]
    datos['ordenes'] = datos['ordenes'][-MAX_ORDENES:]
    datos['historial'] = datos['historial'][-300:]
    datos['vistos'] = datos['vistos'][-600:]
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _hash(valor: str) -> str:
    return hashlib.sha256(valor.encode('utf-8')).hexdigest()


def _token_hash() -> str:
    try:
        return _token_file.read_text(encoding='utf-8').strip()
    except OSError:
        return ''


def _usuario(request: Request) -> str:
    usuario = _auth(request)
    if not _permitido(str(usuario)):
        raise HTTPException(403, 'ECOMMERCE solo está disponible para Administración / Coordinación')
    return str(usuario)


def _pc(request: Request) -> None:
    recibido = request.headers.get('x-ecommerce-token', '')
    esperado = _token_hash()
    if not (recibido and esperado and secrets.compare_digest(_hash(recibido), esperado)):
        raise HTTPException(401, 'Token del PC no válido')


def _conectado(datos: dict) -> bool:
    return _ahora() - float((datos.get('latido') or {}).get('at') or 0) < LATIDO_SEG


def _vencer(datos: dict) -> None:
    for o in datos['ordenes']:
        if o['estado'] == 'pendiente' and _ahora() - o['at'] > ORDEN_VENCE_SEG:
            o['estado'], o['detalle'] = 'vencida', 'El PC no la tomó a tiempo (¿estaba apagado o sin conexión?)'
        elif o['estado'] == 'entregada' and _ahora() - o['at'] > 5 * ORDEN_VENCE_SEG:
            o['estado'], o['detalle'] = 'vencida', 'El PC la recibió pero no confirmó el resultado'


def _pendiente_de(datos: dict, agente: str, accion: str | None = None) -> bool:
    return any(o['estado'] in ('pendiente', 'entregada') and o['agente'] == agente and (accion is None or o['accion'] == accion) for o in datos['ordenes'])


def _nota(datos: dict, agente: str, nivel: str, texto: str) -> None:
    datos['seq'] += 1
    datos['log'].append({'id': datos['seq'], 'at': _ahora(), 'agente': agente, 'nivel': nivel, 'texto': str(texto)[:600]})


# ------------------------------------------------------------------ personas
@router.get('/mi')
def mi_acceso(request: Request):
    _usuario(request)
    return {'ok': True}


def _hoy_iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).date().isoformat()


def _hoy(datos: dict) -> dict:
    """Cifras del día (hora de Colombia): órdenes terminadas, con avisos y cuánto tardaron en promedio."""
    hoy = _hoy_iso()
    de_hoy = [h for h in datos.get('historial', []) if str(h.get('at', ''))[:10] == hoy]
    ok = [h for h in de_hoy if h.get('etapa') == 'terminadas']
    segs = [h['seg'] for h in ok if h.get('seg')]
    return {'terminadas': len(ok), 'avisos': len([h for h in de_hoy if h.get('etapa') == 'errores']),
            'promedio_seg': round(sum(segs) / len(segs)) if segs else None}


def _latidos_vivos(datos: dict) -> dict:
    """Lo que reportó cada agente, con los segundos que faltan HOY (descontando lo que tardó en llegar el aviso)."""
    transcurrido = _ahora() - float((datos.get('latido') or {}).get('at') or 0)
    salida = {}
    for aid, d in (datos.get('latidos') or {}).items():
        salida[aid] = {**d, 'proxima_en': (d['proxima_en'] - round(transcurrido)) if d.get('proxima_en') is not None else None,
                       'ultima_hace': (d['ultima_hace'] + round(transcurrido)) if d.get('ultima_hace') is not None else None}
    return salida


@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    with _lock:
        datos = _leer()
        _vencer(datos)
        agentes = []
        for a in AGENTES:
            info = datos['agentes'].get(a['id']) or {}
            agentes.append({**a, 'estado': info.get('estado', 'INACTIVO'), 'desde': info.get('desde'), 'ultima': info.get('ultima', ''),
                            'pendiente': next((o['accion'] for o in datos['ordenes'] if o['estado'] in ('pendiente', 'entregada') and o['agente'] == a['id']), '')})
        latido = datos.get('latido') or {}
        return {'agentes': agentes, 'pc': {'conectado': _conectado(datos), 'equipo': latido.get('equipo', ''), 'hace': round(_ahora() - float(latido.get('at') or 0)) if latido.get('at') else None,
                                          'hay_token': bool(_token_hash()), 'simulado': bool(latido.get('simulado'))},
                'ordenes': [{k: o[k] for k in ('id', 'agente', 'accion', 'por', 'estado', 'detalle', 'iso')} for o in datos['ordenes'][-8:]][::-1],
                'cola': {e: int((datos.get('cola') or {}).get(e, 0)) for e in ETAPAS_COLA}, 'ultimo_log': datos['seq'],
                'latidos': _latidos_vivos(datos), 'trabajos': datos.get('trabajos') or [], 'hoy': _hoy(datos), 'historial': datos['historial'][-40:][::-1]}


@router.post('/agentes/{agente}/{accion}')
def ordenar(request: Request, agente: str, accion: str):
    usuario = _usuario(request)
    if agente not in POR_ID or accion not in ACCIONES:
        raise HTTPException(404, 'Agente o acción desconocidos')
    with _lock:
        datos = _leer()
        _vencer(datos)
        if not _conectado(datos):
            raise HTTPException(409, 'El PC de los bots no está conectado al panel. Enciéndelo y abre «ECOMMERCE · conectar» en ese PC.')
        if _pendiente_de(datos, agente):
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} ya tiene una orden en curso: espera a que el PC la termine.')
        actual = (datos['agentes'].get(agente) or {}).get('estado', 'INACTIVO')
        if accion == 'revisar' and (agente != 'alma' or actual not in ESTADOS_ACTIVOS):
            raise HTTPException(409, 'Solo ALMA puede revisar Effi, y debe estar vigilando.')
        if accion == 'iniciar' and actual in ESTADOS_ACTIVOS:
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} ya está corriendo.')
        if accion == 'detener' and actual not in ESTADOS_ACTIVOS and actual != 'ERROR':
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} no está corriendo.')
        datos['seq'] += 1
        orden = {'id': datos['seq'], 'agente': agente, 'accion': accion, 'por': usuario, 'estado': 'pendiente', 'detalle': '', 'at': _ahora(), 'iso': _iso()}
        datos['ordenes'].append(orden)
        _nota(datos, agente, 'info', f'{usuario} pidió «{accion}» desde el panel')
        _guardar(datos)
    return {'ok': True, 'orden': orden['id']}


@router.get('/log')
def ver_log(request: Request, desde: int = 0, agente: str = '', limite: int = 200):
    _usuario(request)
    with _lock:
        datos = _leer()
    lineas = [l for l in datos['log'] if l['id'] > desde and (not agente or l['agente'] == agente)]
    return {'lineas': lineas[-max(1, min(limite, 500)):], 'ultimo': datos['seq']}


@router.post('/conexion/regenerar')
def regenerar(request: Request):
    """Código nuevo para el PC (el anterior deja de servir). Se muestra una sola vez."""
    _usuario(request)
    token = secrets.token_urlsafe(32)
    with _lock:
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
        try:
            os.chmod(_token_file, 0o600)
        except OSError:
            pass
    return {'token': token, 'url': str(request.base_url).rstrip('/')}


def _registrar_terminadas(datos: dict) -> None:
    """Cada orden que llega a «terminadas» o «con avisos» se anota una sola vez en el historial y en el registro."""
    for t in datos['trabajos']:
        if t.get('etapa') not in ('terminadas', 'errores'):
            continue
        cuando = str(t.get('terminada') or t.get('modificada') or '')
        clave = f"{t['numero']}|{t['etapa']}|{cuando}"
        if clave in datos['vistos']:
            continue
        datos['vistos'].append(clave)
        seg = None
        try:
            if t.get('descargada') and t.get('terminada'):
                seg = round((datetime.fromisoformat(t['terminada']) - datetime.fromisoformat(t['descargada'])).total_seconds())
        except ValueError:
            pass
        datos['historial'].append({'numero': str(t['numero']), 'cliente': str(t.get('cliente', ''))[:60], 'etapa': t['etapa'], 'at': cuando, 'seg': seg,
                                   'avisos': (t.get('avisos') or [])[:3]})
        if t['etapa'] == 'terminadas':
            _nota(datos, 'ciro', 'info', f"OV{t['numero']} terminada" + (f" · {t['cliente']}" if t.get('cliente') else ''))
        else:
            _nota(datos, 'ciro', 'error', f"OV{t['numero']} terminó con avisos: " + '; '.join((t.get('avisos') or ['revisa la orden'])[:2]))


def alertas() -> list:
    """Alertas de ECOMMERCE para la campana del panel (solo las ven Administración / Coordinación)."""
    with _lock:
        datos = _leer()
    salida = []
    latido = datos.get('latido') or {}
    if _token_hash() and latido.get('at') and not _conectado(datos):
        minutos = round((_ahora() - float(latido['at'])) / 60)
        salida.append({'tipo': 'ecommerce', 'orden': '', 'cliente': '', 'severidad': 'alta', 'titulo': 'ECOMMERCE: el PC de los bots no responde',
                       'detalle': f'Último aviso hace {minutos} min. Revisa que el PC esté encendido y con los agentes abiertos.'})
    for a in AGENTES:
        info = datos['agentes'].get(a['id']) or {}
        if info.get('estado') == 'ERROR':
            salida.append({'tipo': 'ecommerce', 'orden': '', 'cliente': '', 'severidad': 'alta', 'titulo': f"{a['nombre']} tiene un error",
                           'detalle': str(info.get('ultima', ''))[:160]})
    for t in datos.get('trabajos') or []:
        if t.get('etapa') == 'errores':
            salida.append({'tipo': 'ecommerce', 'orden': 'OV' + str(t['numero']), 'cliente': t.get('cliente', ''), 'severidad': 'media',
                           'titulo': f"OV{t['numero']} terminó con avisos", 'detalle': '; '.join((t.get('avisos') or [])[:2])[:200]})
    return salida


# ------------------------------------------------------------------ PC con los bots
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El PC avisa que está vivo, reporta el estado de cada bot y sus últimas líneas, y recibe las órdenes pendientes."""
    _pc(request)
    with _lock:
        datos = _leer()
        datos['latido'] = {'at': _ahora(), 'iso': _iso(), 'equipo': str(payload.get('equipo', ''))[:60], 'simulado': bool(payload.get('simulado'))}
        for aid, info in (payload.get('agentes') or {}).items():
            if aid not in POR_ID or not isinstance(info, dict):
                continue
            previo = datos['agentes'].get(aid) or {}
            nuevo = {'estado': str(info.get('estado', 'INACTIVO'))[:20], 'pid': info.get('pid'), 'ultima': str(info.get('ultima', ''))[:300],
                     'desde': previo.get('desde') if previo.get('estado') == info.get('estado') else _iso()}
            if nuevo['estado'] != previo.get('estado') and previo:
                _nota(datos, aid, 'error' if nuevo['estado'] == 'ERROR' else 'info', f'{POR_ID[aid]["nombre"]}: {previo.get("estado", "—")} → {nuevo["estado"]}')
            datos['agentes'][aid] = nuevo
        if isinstance(payload.get('cola'), dict):
            datos['cola'] = {e: max(0, min(99999, int(payload['cola'].get(e) or 0))) for e in ETAPAS_COLA}
        if isinstance(payload.get('latidos'), dict):
            datos['latidos'] = {aid: {'actividad': str(d.get('actividad', ''))[:120], 'hace_seg': d.get('hace_seg'), 'ultima_hace': d.get('ultima_hace'),
                                      'proxima_en': d.get('proxima_en'), 'intervalo': d.get('intervalo')}
                                for aid, d in payload['latidos'].items() if aid in POR_ID and isinstance(d, dict)}
        if isinstance(payload.get('trabajos'), list):
            datos['trabajos'] = [t for t in payload['trabajos'][:90] if isinstance(t, dict) and t.get('numero')]
            _registrar_terminadas(datos)
        for l in (payload.get('lineas') or [])[:200]:
            if isinstance(l, dict) and l.get('agente') in POR_ID:
                _nota(datos, l['agente'], 'error' if '[Error' in str(l.get('texto', '')) else 'log', l.get('texto', ''))
        for r in (payload.get('resultados') or [])[:20]:
            o = next((x for x in datos['ordenes'] if x['id'] == r.get('orden')), None)
            if o:
                o['estado'] = 'hecha' if r.get('ok') else 'error'
                o['detalle'] = str(r.get('detalle', ''))[:300]
                if not r.get('ok'):
                    _nota(datos, o['agente'], 'error', f'No se pudo «{o["accion"]}»: {o["detalle"]}')
        _vencer(datos)
        entregar = []
        for o in datos['ordenes']:
            if o['estado'] == 'pendiente':
                o['estado'] = 'entregada'
                entregar.append({'id': o['id'], 'agente': o['agente'], 'accion': o['accion']})
        _guardar(datos)
    return {'ordenes': entregar}
