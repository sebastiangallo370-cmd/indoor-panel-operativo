"""ZEUS: agente de inventario que pide la tela que falta.

El panel calcula qué tela no alcanza para los pedidos programados (pestaña «Tela programada»). ZEUS junta lo que falta POR TELA y lo convierte en
una orden de compra pendiente. Un agente en el PC de la oficina (con la sesión de Effi) toma cada pendiente, crea la orden de compra en Effi ERP
con exactamente los MTS que faltan (el proveedor sale de Effi con el código de la tela) y devuelve el número; el panel avisa por correo al
encargado de pedir la tela. Igual que ECOMMERCE, el PC pregunta al panel (sondeo saliente con el mismo token); el panel nunca se conecta al PC.

Estados de cada compra: pendiente (esperando al agente) · entregada (el agente la tiene) · creada (orden de compra hecha en Effi) · error · cancelada (ya alcanzó).
Datos en /data/state/zeus.json.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

log = logging.getLogger('zeus')
router = APIRouter(prefix='/api/zeus', tags=['zeus'])
pc_router = APIRouter(prefix='/api/zeus/pc', tags=['zeus-pc'])
_file = Path(os.getenv('ZEUS_FILE', '/data/state/zeus.json'))
_lock = threading.Lock()
INTERVALO = 300
LATIDO_SEG = 60
ENTREGADA_VENCE_SEG = 900
MARGEN_MTS = 0.5           # diferencias menores no generan otra compra
_faltantes: Callable[[], list[dict]] = lambda: []
_pc_auth: Callable[[Request], None] = lambda request: None
_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
MAX_CORREOS = 10
_CORREO = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')


def configurar(get_faltantes: Callable[[], list[dict]], pc_auth: Callable[[Request], None], auth: Callable | None = None,
               permitido: Callable[[str], bool] | None = None) -> None:
    global _faltantes, _pc_auth, _auth, _permitido
    _faltantes, _pc_auth = get_faltantes, pc_auth
    if auth:
        _auth = auth
    if permitido:
        _permitido = permitido


def _ahora() -> float:
    return time.time()


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('items', [])
    d.setdefault('seq', 0)
    d.setdefault('latido', {})
    d.setdefault('pedido_por_tela', {})
    d.setdefault('config', {}).setdefault('correos', [])
    return d


def _guardar(d: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _por_tela(faltantes: list[dict]) -> dict[str, dict]:
    telas: dict[str, dict] = {}
    for o in faltantes:
        t = telas.setdefault(o['tela'], {'tela': o['tela'], 'falta': 0.0, 'ordenes': [], 'bodega': list(o.get('telas') or [])})
        t['falta'] = round(t['falta'] + float(o.get('falta') or 0), 2)
        t['ordenes'].append({'orden': o['orden'], 'cliente': o.get('cliente', ''), 'proyecto': o.get('proyecto', ''), 'referencia': o['referencia'],
                             'entrega': o.get('entrega', ''), 'mts': o.get('mts', 0), 'falta': o.get('falta', 0), 'situacion': o.get('situacion', '')})
    return telas


def sincronizar() -> dict:
    """Pone al día la lista de compras con la tela que hoy no alcanza. Devuelve cuántas nuevas y cuántas canceladas hubo."""
    faltantes = _por_tela(_faltantes())
    nuevas = canceladas = 0
    with _lock:
        d = _leer()
        activas = {i['tela']: i for i in d['items'] if i['estado'] in ('pendiente', 'entregada', 'error')}
        for tela, f in faltantes.items():
            ya_pedido = float(d['pedido_por_tela'].get(tela, 0))
            necesita = round(f['falta'] - ya_pedido, 2)
            item = activas.get(tela)
            if item:
                if item['estado'] != 'entregada':   # lo que ya tiene el agente no se cambia a media creación
                    item.update(falta=max(necesita, 0.0), ordenes=f['ordenes'], bodega=f['bodega'], actualizado=_iso())
            elif necesita > MARGEN_MTS:
                d['seq'] += 1
                d['items'].append({'id': d['seq'], 'tela': tela, 'falta': necesita, 'ordenes': f['ordenes'], 'bodega': f['bodega'], 'estado': 'pendiente',
                                   'oc': '', 'detalle': '', 'intentos': 0, 'creado': _iso(), 'actualizado': _iso()})
                nuevas += 1
        for item in d['items']:
            if item['estado'] in ('pendiente', 'error') and (item['tela'] not in faltantes or item['falta'] <= MARGEN_MTS):
                item['estado'], item['detalle'], item['actualizado'] = 'cancelada', 'Ya alcanza la tela: no hace falta comprar.', _iso()
                canceladas += 1
        d['items'] = d['items'][-200:]
        _guardar(d)   # también cuando solo cambió lo que falta de una compra pendiente
    return {'nuevas': nuevas, 'canceladas': canceladas}


def _vencer(d: dict) -> None:
    for i in d['items']:
        if i['estado'] == 'entregada' and _ahora() - float(i.get('entregada_at') or 0) > ENTREGADA_VENCE_SEG:
            i['estado'], i['detalle'] = 'pendiente', 'El agente la recibió pero no confirmó; se vuelve a ofrecer.'


def destinatarios() -> str:
    """Correos que reciben la orden de compra: los del panel del agente; si no hay ninguno, los del .env (ZEUS_EMAIL_A / ALERTA_EMAIL_A)."""
    with _lock:
        correos = list(_leer()['config']['correos'])
    return ', '.join(correos) or os.getenv('ZEUS_EMAIL_A') or os.getenv('ALERTA_EMAIL_A') or ''


def _correo_creada(item: dict) -> None:
    try:
        from app import alertas_correo
        if not alertas_correo.configurado():
            return
        para = destinatarios()
        lineas = [f"- {o['orden']} · {o['referencia']} · {o.get('cliente', '')}: falta {o['falta']:g} MTS (entrega {o.get('entrega') or 'sin fecha'})" for o in item['ordenes']]
        alertas_correo.enviar(f"Orden de compra de tela creada en Effi: {item['tela']}",
                              f"El AGENTE INVENTARIO creó la orden de compra {item['oc'] or '(sin número)'} en Effi.\n\nTela: {item['tela']}\nMetros pedidos: {item['falta']:g} MTS\n\n"
                              'Pedidos que la necesitan:\n' + '\n'.join(lineas) + '\n\nVer: https://produccion.cloud (menú de la cuenta > Agente inventario)', para=para)
    except Exception:   # noqa: BLE001
        log.exception('No se pudo enviar el correo de la orden de compra')


def _bucle() -> None:
    time.sleep(100)
    while True:
        try:
            sincronizar()
        except Exception:   # noqa: BLE001
            log.exception('ZEUS: falló la revisión de la tela que falta')
        time.sleep(INTERVALO)


def start() -> None:
    threading.Thread(target=_bucle, name='zeus', daemon=True).start()


def _agente(d: dict) -> dict:
    l = d.get('latido') or {}
    vivo = _ahora() - float(l.get('at') or 0) < LATIDO_SEG
    return {'nombre': 'AGENTE INVENTARIO', 'titulo': 'Órdenes de compra de la tela que falta', 'color': '#c9a6ff', 'conectado': vivo,
            'estado': (l.get('estado') or 'LIBRE') if vivo else 'SIN_CONECTAR', 'ultima': l.get('ultima', '') if vivo else '', 'equipo': l.get('equipo', ''),
            'hace': round(_ahora() - float(l['at'])) if l.get('at') else None,
            'funciones': ['Junta lo que falta de cada tela según los pedidos programados (Tela programada)',
                          'Entra a Effi ERP y crea la orden de compra con exactamente los MTS que faltan; el proveedor sale de Effi con el código de la tela',
                          'Avisa por correo al encargado de pedir la tela con el número de la orden de compra',
                          'Si después falta más tela de la ya pedida, crea otra orden por la diferencia']}


# ------------------------------------------------------------------ personas
@router.get('/estado')
def estado():
    with _lock:
        d = _leer()
        _vencer(d)
        from app import alertas_correo
        return {'agente': _agente(d), 'items': d['items'][-60:][::-1],
                'resumen': {e: sum(1 for i in d['items'] if i['estado'] == e) for e in ('pendiente', 'entregada', 'creada', 'error', 'cancelada')},
                'correo': {'configurado': alertas_correo.configurado(), 'encargado': bool(d['config']['correos'] or os.getenv('ZEUS_EMAIL_A') or os.getenv('ALERTA_EMAIL_A'))},
                'correos': d['config']['correos']}


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'Solo Administración / Coordinación puede cambiar los correos del agente')
    return usuario


@router.get('/config')
def ver_config():
    with _lock:
        return {'correos': _leer()['config']['correos']}


@router.post('/config')
def guardar_config(request: Request, payload: dict):
    """Lista de correos que reciben la orden de compra. Se reemplaza completa (se valida cada dirección)."""
    _usuario(request)
    crudos = payload.get('correos')
    if not isinstance(crudos, list):
        raise HTTPException(400, 'Falta la lista de correos')
    limpios: list[str] = []
    for c in crudos:
        c = str(c or '').strip().lower()
        if not c:
            continue
        if not _CORREO.match(c) or len(c) > 120:
            raise HTTPException(400, f'«{c[:60]}» no es un correo válido')
        if c not in limpios:
            limpios.append(c)
    if len(limpios) > MAX_CORREOS:
        raise HTTPException(400, f'Máximo {MAX_CORREOS} correos')
    with _lock:
        d = _leer()
        d['config']['correos'] = limpios
        _guardar(d)
    return {'ok': True, 'correos': limpios}


@router.post('/sincronizar')
def revisar_ahora():
    try:
        r = sincronizar()
    except Exception as e:   # noqa: BLE001
        raise HTTPException(500, f'No se pudo revisar la tela: {e}')
    return {'ok': True, **r}


# ------------------------------------------------------------------ PC con la sesión de Effi
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El agente avisa su estado, devuelve los resultados de las órdenes de compra que hizo y recibe las pendientes (solo si puede trabajar)."""
    _pc_auth(request)
    entregar = []
    avisos = []
    with _lock:
        d = _leer()
        d['latido'] = {'at': _ahora(), 'estado': str(payload.get('estado', 'LIBRE'))[:24], 'ultima': str(payload.get('ultima', ''))[:300], 'equipo': str(payload.get('equipo', ''))[:60]}
        for r in (payload.get('resultados') or [])[:20]:
            item = next((i for i in d['items'] if i['id'] == r.get('id')), None)
            if not item:
                continue
            item['actualizado'] = _iso()
            if r.get('ok'):
                item.update(estado='creada', oc=str(r.get('oc', ''))[:40], detalle=str(r.get('detalle', ''))[:300], creada=_iso())
                d['pedido_por_tela'][item['tela']] = round(float(d['pedido_por_tela'].get(item['tela'], 0)) + float(item['falta']), 2)
                avisos.append(dict(item))
            else:
                item['intentos'] = int(item.get('intentos', 0)) + 1
                item.update(estado='error', detalle=str(r.get('detalle', ''))[:300])
        _vencer(d)
        if payload.get('puede_trabajar'):
            for i in d['items']:
                if i['estado'] in ('pendiente',) or (i['estado'] == 'error' and int(i.get('intentos', 0)) < 3 and _ahora() - float(i.get('entregada_at') or 0) > 600):
                    i['estado'], i['entregada_at'] = 'entregada', _ahora()
                    entregar.append({'id': i['id'], 'tela': i['tela'], 'falta': i['falta'], 'ordenes': [o['orden'] for o in i['ordenes']], 'bodega': i.get('bodega', [])})
        _guardar(d)
    for item in avisos:
        _correo_creada(item)
    return {'trabajos': entregar}
