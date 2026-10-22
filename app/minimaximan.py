"""MINIMAXIMAN: agente de inventario que mantiene cada tela entre su stock MÍNIMO y su stock MÁXIMO. Corre INDEPENDIENTE, en el VPS, sin usar a ZEUS ni a ningún otro agente.

Qué hace: para cada tela de INFORMACIÓN TELA que tiene stock mínimo y stock máximo (los de Effi), mira cuánta tela hay en Bodega. Si lo que hay (más lo que ya
está pedido y aún no llega) baja del mínimo, pide la diferencia hasta llegar al máximo. La orden de compra la crea ÉL MISMO en Effi por la API (sin navegador ni
agente de por medio), y avisa por correo y en la campana del panel.

Lo que ya está pedido se cuenta con lo que Effi tiene «por recibir» en órdenes de compra abiertas del artículo (stock_empresa_orden_c): ahí entran también las
órdenes que haya creado ZEUS u otra persona. Si Effi no responde o la tela no existe allá con su referencia, NO se pide (no se adivina).

Seguridad: arranca APAGADO. Apagado calcula y muestra lo que pediría, pero no crea ninguna compra; hay que activarlo a propósito (cuesta dinero).
Comparte con el AGENTE INVENTARIO solo la configuración (la llave de la API de Effi, el descuento/retenciones y los correos del encargado); no usa su fila de compras.
Datos en /data/state/minimaximan.json."""
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

from app import effi_api, memoria_agentes, proveedores_tela, zeus

log = logging.getLogger('minimaximan')
router = APIRouter(prefix='/api/minimaximan', tags=['minimaximan'])
_file = Path(os.getenv('MINIMAXIMAN_FILE', '/data/state/minimaximan.json'))
_lock = threading.RLock()
INTERVALO = 600
MIN_PEDIDO = 1.0        # no se piden menos de 1 metro
MAX_NUEVAS = 5          # tope de órdenes nuevas por revisión (por si algo sale raro)
MAX_INTENTOS = 3        # una orden con error se reintenta hasta 3 veces; después espera a que una persona la revise
NOTIFICA_DIAS = 7
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
    d.setdefault('compras', [])
    d.setdefault('seq', 0)
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


def _usar_api() -> bool:
    """Carga la llave y los ajustes de la API de Effi (los guarda el panel en la pantalla «API Effi» del agente de inventario)."""
    with zeus._lock:
        d = zeus._leer()
        cfg = zeus.api_para_agente(d)
    if not cfg:
        return False
    effi_api.usar_llave(cfg.get('llave', ''))
    effi_api.configurar(cfg.get('descuento_pct'), cfg.get('retenciones'))
    return effi_api.disponible()


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
    con_api = _usar_api()
    with _lock:
        compras = _leer()['compras']
    filas = []
    for t in proveedores_tela.telas():
        mn, mx = _num(t.get('stock_minimo')), _num(t.get('stock_maximo'))
        if mn <= 0 or mx <= 0:
            continue
        codigo = str(t['codigo'])
        stock = round(float(t.get('mts') or 0), 2)
        fila = {'codigo': codigo, 'tela': t['nombre'], 'proveedor': t.get('proveedor', ''), 'stock': stock, 'minimo': mn, 'maximo': mx,
                'por_recibir': None, 'pedir': 0.0, 'estado': 'ok', 'nota': ''}
        if mx < mn:
            fila.update(estado='revisar', nota='El máximo es menor que el mínimo: corrígelo en INFORMACIÓN TELA.')
        elif stock < mn:   # solo si por stock ya está bajo se consulta a Effi lo que viene en camino
            pr = _por_recibir(codigo) if con_api else None
            fila['por_recibir'] = pr
            if pr is None:
                fila.update(estado='sin_effi', nota='No pude ver en Effi lo que ya está pedido de esta tela: no pido nada hasta confirmarlo.' if con_api else 'Falta la llave de la API de Effi (pantalla «API Effi» del agente de inventario).')
            elif stock + pr >= mn:
                fila.update(estado='en_camino', nota='Está bajo el mínimo, pero ya hay órdenes de compra abiertas que la completan.')
            else:
                falta = round(mx - (stock + pr), 2)
                trabada = next((c for c in compras if c['codigo'] == codigo and c['estado'] == 'error' and c.get('intentos', 0) >= MAX_INTENTOS), None)
                if not fila['proveedor']:
                    fila.update(estado='sin_proveedor', pedir=falta, nota='Falta elegir el proveedor de esta tela en INFORMACIÓN TELA.')
                elif falta < MIN_PEDIDO:
                    fila.update(estado='ok')
                elif trabada:
                    fila.update(estado='error', pedir=falta, nota='La orden falló 3 veces: ' + str(trabada.get('detalle', ''))[:140])
                else:
                    fila.update(estado='pedir', pedir=falta, nota=f'Pedir {falta:g} mts para llegar al máximo ({mx:g}).')
        filas.append(fila)
    orden = {'pedir': 0, 'error': 1, 'sin_proveedor': 2, 'sin_effi': 3, 'revisar': 4, 'en_camino': 5, 'ok': 6}
    return sorted(filas, key=lambda f: (orden.get(f['estado'], 9), f['tela']))


def _crear(f: dict) -> dict | None:
    """Crea (o reintenta) la orden de compra de esa tela directamente en Effi por la API. Devuelve la compra guardada."""
    with _lock:
        e = _leer()
        previa = next((c for c in e['compras'] if c['codigo'] == f['codigo'] and c['estado'] == 'error' and c.get('intentos', 0) < MAX_INTENTOS), None)
        if previa:
            compra = previa
            compra.update(metros=f['pedir'], intentos=compra.get('intentos', 0) + 1)
        else:
            e['seq'] += 1
            compra = {'id': e['seq'], 'codigo': f['codigo'], 'tela': f['tela'], 'proveedor': f['proveedor'], 'metros': f['pedir'], 'estado': 'pendiente', 'oc': '',
                      'detalle': '', 'intentos': 1, 'creado': _iso(), 'stock': f['stock'], 'minimo': f['minimo'], 'maximo': f['maximo']}
            e['compras'].append(compra)
        _guardar(e)
    try:
        r = effi_api.crear_orden(f'mm{compra["id"]}', f['codigo'], float(f['pedir']), f['proveedor'], observacion='Orden creada por MINIMAXIMAN (reposición al stock máximo)')
        compra.update(estado='creada', oc=str(r['oc']), detalle=str(r['detalle'])[:300], creada=_iso())
    except Exception as exc:   # noqa: BLE001
        compra.update(estado='error', detalle=str(exc)[:300])
        try:
            memoria_agentes.registrar(NOMBRE, str(exc), 'ERROR')
        except Exception:   # noqa: BLE001
            pass
    with _lock:
        e = _leer()
        e['compras'] = [compra if c['id'] == compra['id'] else c for c in e['compras']][-200:]
        _guardar(e)
    if compra['estado'] == 'creada':
        _correo_creada(compra)
    return compra


def _correo_creada(c: dict) -> None:
    try:
        from app import alertas_correo
        if not alertas_correo.puede_enviar():
            return
        alertas_correo.enviar(f"Orden de compra de tela creada en Effi: {c['tela']} (MINIMAXIMAN)",
                              f"MINIMAXIMAN creó la orden de compra {c['oc']} en Effi para dejar la tela en su stock máximo.\n\nTela: {c['tela']}\nMetros pedidos: {c['metros']:g} MTS\n"
                              f"Había {c['stock']:g} mts (mínimo {c['minimo']:g}, máximo {c['maximo']:g}).\nProveedor: {c['proveedor']}\n\nEl PDF de la orden está en Effi (Compras > Órdenes de compra).\n\n"
                              'Ver: https://produccion.cloud (robot de agentes > INVENTARIOS > MINIMAXIMAN)', para=zeus.destinatarios())
    except Exception:   # noqa: BLE001
        log.exception('MINIMAXIMAN: no se pudo enviar el correo de la orden')


def revisar(crear: bool | None = None) -> dict:
    """Calcula y, si MINIMAXIMAN está activo (o se pide crear=True), crea las órdenes de compra que hagan falta."""
    with _lock:
        activo = _leer()['activo'] if crear is None else bool(crear)
    try:
        filas = evaluar()
        error = ''
    except Exception as exc:   # noqa: BLE001
        log.exception('MINIMAXIMAN: no se pudo evaluar')
        filas, error = [], f'No pude evaluar: {exc}'
    nuevas = 0
    if activo and not error:
        for f in [x for x in filas if x['estado'] == 'pedir'][:MAX_NUEVAS]:
            c = _crear(f)
            if c and c['estado'] == 'creada':
                nuevas += 1
                log.warning('MINIMAXIMAN: orden %s · %s mts de %s (había %s, mínimo %s, máximo %s)', c['oc'], f['pedir'], f['tela'], f['stock'], f['minimo'], f['maximo'])
        if nuevas:
            filas = evaluar()   # ya con lo recién pedido contado como «por recibir»
    with _lock:
        e = _leer()
        e.update(ultima=_iso(), resultado=filas, error=error)
        _guardar(e)
    return {'telas': len(filas), 'nuevas': nuevas, 'activo': activo, 'error': error}


def alertas_para(usuario: str) -> list[dict]:
    """Avisos de la campana: «MINIMAXIMAN creó una orden de compra». Para quienes tienen acceso al agente de inventario."""
    if not _permitido(usuario):
        return []
    with _lock:
        compras = _leer()['compras']
    limite = time.time() - NOTIFICA_DIAS * 86400
    salida = []
    for c in reversed(compras):
        if c['estado'] != 'creada' or not c.get('oc'):
            continue
        try:
            if time.mktime(time.strptime(str(c.get('creada'))[:19], '%Y-%m-%dT%H:%M:%S')) < limite - 5 * 3600:
                continue
        except (ValueError, TypeError):
            pass
        salida.append({'tipo': 'compra', 'orden': 'OC ' + str(c['oc']), 'cliente': '', 'severidad': 'media', 'titulo': f"MINIMAXIMAN pidió tela: {c['tela']}",
                       'detalle': f"{c['metros']:g} MTS para llegar al máximo · orden de compra {c['oc']} en Effi", 'texto': f"MINIMAXIMAN {c['tela']} {c['metros']:g} MTS · OC {c['oc']}"})
    return salida[:10]


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
                                     'Cuenta lo que ya está pedido: las órdenes de compra abiertas en Effi («por recibir»)',
                                     'Si queda bajo el mínimo, crea él mismo la orden de compra en Effi por la API, por lo que falta hasta el máximo',
                                     'Corre solo en el servidor, sin usar a ZEUS ni a los agentes de los PC. Nunca pide si no ve en Effi lo que ya está en camino']},
            'resumen': {'telas': len(r), 'pedir': cuenta('pedir'), 'en_camino': cuenta('en_camino'), 'sin_proveedor': cuenta('sin_proveedor'), 'sin_effi': cuenta('sin_effi'),
                        'error': cuenta('error'), 'ok': cuenta('ok')},
            'telas': r, 'compras': e['compras'][-15:][::-1]}


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
