"""MINIMAXIMAN: agente de inventario que mantiene cada tela entre su stock MÍNIMO y su stock MÁXIMO.

Qué hace: para cada tela de INFORMACIÓN TELA que tiene stock mínimo y stock máximo (los de Effi), mira cuánta tela hay en Bodega. Si lo que hay (más lo que ya
está pedido y aún no llega) baja del mínimo, pide la diferencia hasta llegar al máximo. El pedido entra a la MISMA fila de compras que ZEUS: el agente que
tiene la sesión de Effi (en el VPS) crea la orden de compra, el panel avisa por correo, etc. Aquí solo se decide qué y cuánto pedir.

Lo que ya está pedido se cuenta así: (1) la tela de pedidos de este mismo agente o de ZEUS que aún no se crean en Effi (cola) y (2) lo que Effi tiene «por recibir»
en órdenes de compra abiertas del artículo (stock_empresa_orden_c). Si Effi no responde o la tela no existe allá con su referencia, NO se pide (no se adivina).

Seguridad: arranca APAGADO. Apagado calcula y muestra lo que pediría, pero no crea ninguna compra; hay que activarlo a propósito (cuesta dinero).
Datos en /data/state/minimaximan.json. Solo lectura sobre Effi (stock); las órdenes las crea el agente de ZEUS."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

from app import effi_api, proveedores_tela, zeus

log = logging.getLogger('minimaximan')
router = APIRouter(prefix='/api/minimaximan', tags=['minimaximan'])
_file = Path(os.getenv('MINIMAXIMAN_FILE', '/data/state/minimaximan.json'))
_lock = threading.RLock()
INTERVALO = 600
MIN_PEDIDO = 1.0        # no se piden menos de 1 metro
MAX_NUEVAS = 5          # tope de compras nuevas por revisión (por si algo sale raro)
NOMBRE = 'MINIMAXIMAN'
_permitido: Callable[[str], bool] = lambda usuario: True
_auth: Callable = lambda request: ''


def configurar(auth: Callable, permitido: Callable[[str], bool]) -> None:
    global _auth, _permitido
    _auth, _permitido = auth, permitido


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('activo', False)
    d.setdefault('ultima', '')
    d.setdefault('resultado', [])
    d.setdefault('error', '')
    d.setdefault('cambio', {})
    return d


def _guardar(d: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _num(v) -> float:
    try:
        return float(str(v or '').replace(',', '.'))
    except ValueError:
        return 0.0


def _en_cola(codigo: str) -> float:
    """Metros de esa tela que ya están pedidos en el agente pero Effi todavía no crea (pendiente, entregada, con error)."""
    total = 0.0
    with zeus._lock:
        d = zeus._leer()
        for i in d['items']:
            if i.get('estado') in ('pendiente', 'entregada', 'error') and zeus._enriquecer(i).get('codigo') == codigo:
                total += float(i.get('falta') or 0)
    return round(total, 2)


def _por_recibir(codigo: str) -> float | None:
    """Metros en órdenes de compra abiertas del artículo en Effi (stock por recibir). None si Effi no lo dice."""
    try:
        a = effi_api.articulo(codigo)
    except Exception:   # noqa: BLE001
        return None
    v = str(a.get('stock_empresa_orden_c') or '0').replace(',', '')
    try:
        return round(float(v), 2)
    except ValueError:
        return None


def evaluar() -> list[dict]:
    """Una fila por cada tela con mínimo y máximo: cuánta hay, qué está en camino y cuánto habría que pedir."""
    llave = zeus._leer_secreto().get('llave', '')
    if llave:
        effi_api.usar_llave(llave)
    filas = []
    for t in proveedores_tela.telas():
        mn, mx = _num(t.get('stock_minimo')), _num(t.get('stock_maximo'))
        if mn <= 0 or mx <= 0:
            continue
        codigo = str(t['codigo'])
        stock = round(float(t.get('mts') or 0), 2)
        fila = {'codigo': codigo, 'tela': t['nombre'], 'proveedor': t.get('proveedor', ''), 'stock': stock, 'minimo': mn, 'maximo': mx,
                'en_cola': 0.0, 'por_recibir': None, 'pedir': 0.0, 'estado': 'ok', 'nota': ''}
        if mx < mn:
            fila.update(estado='revisar', nota='El máximo es menor que el mínimo: corrígelo en INFORMACIÓN TELA.')
        else:
            cola = _en_cola(codigo)
            fila['en_cola'] = cola
            if stock + cola < mn:   # solo si por stock ya está bajo se consulta a Effi lo que viene en camino
                pr = _por_recibir(codigo) if llave else None
                fila['por_recibir'] = pr
                if pr is None:
                    fila.update(estado='sin_effi', nota='No pude ver en Effi lo que ya está pedido de esta tela: no pido nada hasta confirmarlo.')
                elif stock + cola + pr >= mn:
                    fila.update(estado='en_camino', nota='Está bajo el mínimo, pero ya hay órdenes de compra que la completan.')
                else:
                    falta = round(mx - (stock + cola + pr), 2)
                    if not fila['proveedor']:
                        fila.update(estado='sin_proveedor', pedir=falta, nota='Falta elegir el proveedor de esta tela en INFORMACIÓN TELA.')
                    elif falta < MIN_PEDIDO:
                        fila.update(estado='ok')
                    else:
                        fila.update(estado='pedir', pedir=falta, nota=f'Pedir {falta:g} mts para llegar al máximo ({mx:g}).')
            elif stock < mn:
                fila.update(estado='en_camino', nota='Está bajo el mínimo, pero lo que ya está en la cola de compras la completa.')
        filas.append(fila)
    orden = {'pedir': 0, 'sin_proveedor': 1, 'sin_effi': 2, 'revisar': 3, 'en_camino': 4, 'ok': 5}
    return sorted(filas, key=lambda f: (orden.get(f['estado'], 9), f['tela']))


def _encolar(f: dict) -> bool:
    """Deja la compra en la fila de ZEUS. Una sola compra abierta de MINIMAXIMAN por tela: si ya hay una por comprar, solo se actualiza su cantidad."""
    with zeus._lock:
        d = zeus._leer()
        abierta = next((i for i in d['items'] if i.get('origen') == NOMBRE and i.get('codigo_forzado') == f['codigo'] and i['estado'] in ('pendiente', 'error')), None)
        if abierta:
            if abierta['estado'] == 'pendiente':
                abierta.update(falta=f['pedir'], actualizado=zeus._iso())
                zeus._guardar(d)
            return False
        if any(i.get('origen') == NOMBRE and i.get('codigo_forzado') == f['codigo'] and i['estado'] == 'entregada' for i in d['items']):
            return False   # el agente la está creando ahora mismo
        d['seq'] += 1
        d['items'].append({'id': d['seq'], 'tela': f['tela'], 'falta': f['pedir'], 'bodega': [f['tela']], 'estado': 'pendiente', 'oc': '', 'detalle': '',
                           'intentos': 0, 'creado': zeus._iso(), 'actualizado': zeus._iso(), 'manual': True, 'origen': NOMBRE,
                           'codigo_forzado': f['codigo'], 'proveedor_forzado': f['proveedor'],
                           'ordenes': [{'orden': NOMBRE, 'cliente': 'Reposición al stock máximo', 'proyecto': f"mín {f['minimo']:g} · máx {f['maximo']:g} · hay {f['stock']:g}",
                                        'referencia': '', 'entrega': '', 'mts': f['pedir'], 'falta': f['pedir'], 'situacion': 'minimax'}]})
        d['items'] = d['items'][-200:]
        zeus._guardar(d)
    return True


def revisar(crear: bool | None = None) -> dict:
    """Calcula y, si MINIMAXIMAN está activo (o se pide crear=True), deja las compras en la fila de ZEUS."""
    with _lock:
        estado = _leer()
        activo = estado['activo'] if crear is None else bool(crear)
    try:
        filas = evaluar()
        error = ''
    except Exception as exc:   # noqa: BLE001
        log.exception('MINIMAXIMAN: no se pudo evaluar')
        filas, error = [], f'No pude evaluar: {exc}'
    nuevas = 0
    if activo and not error:
        for f in [x for x in filas if x['estado'] == 'pedir'][:MAX_NUEVAS]:
            try:
                if _encolar(f):
                    nuevas += 1
                    log.info('MINIMAXIMAN: pide %s mts de %s (hay %s, mínimo %s, máximo %s)', f['pedir'], f['tela'], f['stock'], f['minimo'], f['maximo'])
            except Exception:   # noqa: BLE001
                log.exception('MINIMAXIMAN: no se pudo dejar la compra de %s', f['tela'])
    with _lock:
        e = _leer()
        e.update(ultima=_iso(), resultado=filas, error=error)
        _guardar(e)
    return {'telas': len(filas), 'nuevas': nuevas, 'activo': activo, 'error': error}


def _bucle() -> None:
    time.sleep(150)
    while True:
        try:
            revisar()
        except Exception:   # noqa: BLE001
            log.exception('MINIMAXIMAN: fallo en la revisión periódica')
        time.sleep(INTERVALO)


def start() -> None:
    threading.Thread(target=_bucle, name='minimaximan', daemon=True).start()


def _usuario(request: Request) -> str:
    u = str(_auth(request) or '')
    if not _permitido(u):
        raise HTTPException(403, 'Sin acceso al agente de inventario')
    return u


@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    with _lock:
        e = _leer()
    r = e['resultado']
    cuenta = lambda k: sum(1 for f in r if f['estado'] == k)
    return {'agente': {'nombre': NOMBRE, 'titulo': 'Mantiene cada tela entre su stock mínimo y su stock máximo', 'activo': e['activo'], 'ultima': e['ultima'], 'error': e['error'],
                       'funciones': ['Revisa cada tela con stock mínimo y máximo (INFORMACIÓN TELA) contra lo que hay en Bodega',
                                     'Cuenta lo que ya está pedido: la cola de compras y las órdenes de compra abiertas en Effi',
                                     'Si queda bajo el mínimo, pide la diferencia hasta el máximo con la misma fila de compras de ZEUS',
                                     'Nunca pide si no puede ver en Effi lo que ya está en camino']},
            'resumen': {'telas': len(r), 'pedir': cuenta('pedir'), 'en_camino': cuenta('en_camino'), 'sin_proveedor': cuenta('sin_proveedor'), 'sin_effi': cuenta('sin_effi'), 'ok': cuenta('ok')},
            'telas': r}


@router.post('/revisar')
def revisar_ahora(request: Request):
    _usuario(request)
    return revisar()


@router.put('/activar')
def activar(request: Request, payload: dict):
    usuario = _usuario(request)
    with _lock:
        e = _leer()
        e['activo'] = bool(payload.get('activo'))
        e['cambio'] = {'por': usuario, 'at': _iso()}
        _guardar(e)
    log.warning('MINIMAXIMAN %s por %s', 'ACTIVADO' if e['activo'] else 'APAGADO', usuario)
    return {'ok': True, 'activo': e['activo']}
