"""STOCKMAN: alinea el inventario del panel con el de Effi (agente de INVENTARIOS, vive en el VPS). El inventario REAL es el del panel.
Panel -> Effi: si el panel cambia, STOCKMAN deja la tela en Effi igual (un ajuste de inventario por bodega), tras comprobar que la diferencia se mantiene unos minutos.
Effi -> panel: Effi no avisa, así que STOCKMAN revisa cada pocos minutos los ajustes de inventario nuevos de Effi y los registra en el panel (ingreso o salida) para que el
panel quede igual; los ajustes que hizo el propio STOCKMAN se reconocen y no rebotan. Solo con STOCKMAN ACTIVO; apagado muestra lo que haría.

Primera parte (nombres): cada tela del panel se muestra con el MISMO nombre que tiene su artículo en Effi. El nombre interno del inventario (el del Google Sheet, que usan
los agentes y los movimientos) no se toca: se guarda un alias código -> nombre de Effi en /data/state/stockman.json y el navegador lo aplica al mostrar (nombres-effi.js).
El artículo de Effi se busca por el «ID Effi» de INFORMACIÓN TELA y, si no hay, por la referencia exacta (el código de la tela). Solo lectura en Effi."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app import effi_api, proveedores_tela

_auth = lambda request: ''


def configurar(auth) -> None:
    global _auth
    _auth = auth


log = logging.getLogger('stockman')
router = APIRouter(prefix='/api/stockman', tags=['stockman'])
_file = Path(os.getenv('STOCKMAN_FILE', '/data/state/stockman.json'))
_lock = threading.RLock()
INTERVALO = 1800         # lectura completa de Effi (nombres y stock de todas las telas)
CICLO = 120              # cada cuánto mira los ajustes nuevos de Effi y las diferencias
ESTABLE_SEG = 300        # una diferencia panel/Effi debe mantenerse 5 minutos antes de ajustarla (así no pisa un cambio a medias)
PROPIO = 'Alineado con el panel por STOCKMAN'
MAX_TELAS = 5            # tope de telas que ajusta solo por revisión
GRANDE_PCT = 0.5         # una diferencia total de más del 50 % (y de más de 1.000 mts) no se ajusta sola: pide que una persona pulse AJUSTAR
GRANDE_MTS = 1000.0
# bodegas del panel -> id de la bodega con el mismo nombre en Effi
BODEGAS = {'BODEGA GLORIA': '23', 'BODEGA SEGUNDO PISO': '22', 'BODEGA CASA': '24', 'BODEGA INDOOR': '21'}
_NOMBRE_BODEGA = {'23': 'GLORIA', '22': 'INDOOR_2P', '24': 'CASA', '21': 'INDOOR'}
_OTRAS = {'1': 'Principal', '5': 'Materia Prima', '6': 'Punto de venta PT', '8': 'calcetines', '9': 'tela', '10': 'Insumos', '11': 'tienda', '13': 'Linea Copa', '14': 'Plus', '17': 'Estandar', '20': 'Premium'}
NOMBRE = 'STOCKMAN'


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        d = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('activo', False)
    d.setdefault('ajustes', [])     # historial: ajustes hechos en Effi (tipo a_effi) y movimientos traídos al panel (tipo a_panel)
    d.setdefault('ajuste_base', None)   # id del último ajuste de Effi que ya existía al empezar: solo lo posterior se trae al panel
    d.setdefault('vistos', [])
    d.setdefault('pendientes', [])  # ajustes de Effi por traer al panel (STOCKMAN apagado)
    d.setdefault('estables', {})
    d.setdefault('ultimo_completo', 0)
    d.setdefault('nombres', {})      # código de la tela -> {'nombre_panel', 'nombre_effi', 'id_effi', 'at'}
    d.setdefault('ultima', '')
    d.setdefault('error', '')
    return d


def _guardar(d: dict) -> None:
    _file.parent.mkdir(parents=True, exist_ok=True)
    tmp = _file.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file)


def _usar_api() -> bool:
    from app import minimaximan   # misma llave y ajustes de la API que ya usa el agente de inventario
    return minimaximan._usar_api()


def refrescar_nombres() -> dict:
    """Lee en Effi el nombre de cada tela del panel y guarda el alias. Si Effi falla o no ve la tela, se queda con el último nombre conocido."""
    if not _usar_api():
        with _lock:
            d = _leer()
            d.update(ultima=_iso(), error='Falta conectar la API de Effi (pantalla «API Effi» del agente de inventario).')
            _guardar(d)
        return {'ok': False, 'cambiadas': 0}
    telas = proveedores_tela.telas()
    if not telas:
        return {'ok': False, 'cambiadas': 0}   # el inventario llegó vacío: no se toca nada
    previos = _leer()['nombres']
    nuevos, sin = {}, []
    for t in telas:
        codigo = str(t['codigo'])
        try:
            a = effi_api.articulo(codigo, str(t.get('id_effi') or (previos.get(codigo) or {}).get('id_effi') or ''))
        except Exception:   # noqa: BLE001
            sin.append(codigo)
            continue
        nombre = re.sub(r'\s+', ' ', str(a.get('descripcion') or '')).strip()
        if nombre:
            stock = {}
            for b in a.get('stock_bodegas') or []:
                try:
                    stock[str(b['bodega'])] = round(float(b.get('stock') or 0), 2)
                except (KeyError, TypeError, ValueError):
                    pass
            nuevos[codigo] = {'nombre_panel': t['nombre'], 'nombre_effi': nombre, 'id_effi': str(a.get('id') or ''), 'stock_effi': stock, 'at': _iso()}
    with _lock:
        d = _leer()
        cambiadas = sum(1 for c, v in nuevos.items() if (d['nombres'].get(c) or {}).get('nombre_effi') != v['nombre_effi'])
        d['nombres'].update(nuevos)
        d.update(ultima=_iso(), error=(f'{len(sin)} telas sin artículo exacto en Effi: ' + ', '.join(sin[:8])) if sin else '')
        _guardar(d)
    return {'ok': True, 'cambiadas': cambiadas, 'sin_articulo': sin}


def mapa() -> dict:
    """Todas las formas con que el panel muestra cada tela -> nombre de Effi."""
    salida = {}
    for codigo, v in _leer()['nombres'].items():
        efi, pan = v.get('nombre_effi'), v.get('nombre_panel')
        if not efi or not pan:
            continue
        for clave, valor in ((pan, efi), (f'({codigo}) {pan}', f'({codigo}) {efi}')):
            clave = re.sub(r'\s+', ' ', clave).strip()
            if clave != valor:
                salida[clave] = valor
    return salida


def _stock_panel() -> dict[str, dict[str, float]]:
    """Metros de cada tela por bodega, tal como los ve el panel, con el id de la bodega de Effi como clave. Los rollos sin bodega cuentan en BODEGA INDOOR (la de por defecto)."""
    from app import inventario_api
    por_tela: dict[str, dict[str, float]] = {}
    for t in inventario_api.inventory_bodegas().get('telas') or []:
        codigo = proveedores_tela.codigo_de(t.get('nombre'))
        if not codigo:
            continue
        reparto: dict[str, float] = {}
        for r in t.get('rollos') or []:
            bodega = BODEGAS.get(r.get('bodega') or inventario_api.DEFAULT_PLACE)
            if bodega:
                reparto[bodega] = reparto.get(bodega, 0.0) + float(r.get('v') or 0)
        total = round(float(t.get('mts') or 0), 2)   # el total real de la tela (ya con las salidas, que no descuentan rollos)
        suma = sum(reparto.values())
        if total > 0 and suma <= 0:
            reparto = {BODEGAS[inventario_api.DEFAULT_PLACE]: total}
        elif total >= 0 and suma > 0 and abs(suma - total) > 0.01:
            reparto = {b: v * total / suma for b, v in reparto.items()}   # las salidas se reparten en proporción entre las bodegas
        por_tela[codigo] = {b: round(v, 2) for b, v in reparto.items()}
    return por_tela


def evaluar() -> list[dict]:
    """Por tela: lo que dice el panel por bodega contra lo que dice Effi, y la diferencia que habría que ajustar en Effi (el panel manda)."""
    panel = _stock_panel()
    d = _leer()
    filas = []
    for t in proveedores_tela.telas():
        codigo = str(t['codigo'])
        v = d['nombres'].get(codigo)
        fila = {'codigo': codigo, 'tela': (v or {}).get('nombre_effi') or t['nombre'], 'id_effi': (v or {}).get('id_effi', ''), 'estado': 'sin_articulo', 'bodegas': [], 'panel': 0.0, 'effi': 0.0, 'diferencia': 0.0}
        if v:
            pan, efi = panel.get(codigo, {}), v.get('stock_effi') or {}
            ids = sorted(set(pan) | set(efi) | set(BODEGAS.values()), key=lambda i: (i not in _NOMBRE_BODEGA, int(i)))
            for b in ids:
                p_, e_ = round(pan.get(b, 0.0), 2), round(efi.get(b, 0.0), 2)
                if p_ == 0 and e_ == 0 and b not in _NOMBRE_BODEGA:
                    continue
                fila['bodegas'].append({'bodega': b, 'nombre': _NOMBRE_BODEGA.get(b) or _OTRAS.get(b, b), 'panel': p_, 'effi': e_, 'delta': round(p_ - e_, 2)})
            fila['panel'] = round(sum(pan.values()), 2)
            fila['effi'] = round(sum(efi.values()), 2)
            fila['diferencia'] = round(fila['panel'] - fila['effi'], 2)
            hay = any(abs(b['delta']) >= 0.01 for b in fila['bodegas'])
            grande = hay and abs(fila['diferencia']) > GRANDE_MTS and abs(fila['diferencia']) > GRANDE_PCT * max(fila['panel'], fila['effi'], 1)
            fila['estado'] = 'igual' if not hay else ('grande' if grande else 'ajustar')
            fila['nombre_panel'] = t['nombre']
            fila['nombre_igual'] = (v.get('nombre_effi') or '') == (v.get('nombre_panel') or '')
        filas.append(fila)
    orden = {'grande': 0, 'ajustar': 1, 'igual': 2, 'sin_articulo': 3}
    return sorted(filas, key=lambda f: (orden[f['estado']], -abs(f['diferencia']), f['tela']))


def _releer(codigo: str) -> None:
    """Vuelve a leer en Effi el stock de una tela (por su ID) y lo guarda."""
    v = _leer()['nombres'].get(codigo)
    if not v or not v.get('id_effi'):
        return
    try:
        a = effi_api.articulo(codigo, v['id_effi'])
    except Exception:   # noqa: BLE001
        return
    with _lock:
        d = _leer()
        d['nombres'][codigo]['stock_effi'] = {str(x['bodega']): round(float(x.get('stock') or 0), 2) for x in a.get('stock_bodegas') or []}
        _guardar(d)


def aplicar_tela(codigo: str, usuario: str) -> dict:
    """Escribe en Effi, un ajuste por bodega, la diferencia para que la tela quede igual que en el panel; después vuelve a leer la tela en Effi."""
    if not _usar_api():
        raise HTTPException(400, 'Falta conectar la API de Effi (pantalla «API Effi» del agente de inventario).')
    _releer(str(codigo))   # siempre con el stock de Effi de este momento
    fila = next((f for f in evaluar() if f['codigo'] == str(codigo)), None)
    if not fila or fila['estado'] in ('sin_articulo', 'igual'):
        raise HTTPException(404, 'Esa tela no tiene nada que ajustar.')
    hechos = []
    for b in fila['bodegas']:
        if abs(b['delta']) < 0.01:
            continue
        clave = 'sm-' + hashlib.sha1(f"{codigo}|{b['bodega']}|{b['panel']}|{b['effi']}".encode()).hexdigest()[:24]
        try:
            r = effi_api.crear_ajuste(clave, int(b['bodega']), fila['id_effi'], b['delta'], f'Alineado con el panel por STOCKMAN ({usuario})')
        except Exception as exc:   # noqa: BLE001
            with _lock:
                d = _leer()
                d['ajustes'] = (d['ajustes'] + [{'codigo': codigo, 'tela': fila['tela'], 'bodega': b['nombre'], 'delta': b['delta'], 'estado': 'error', 'tipo': 'a_effi', 'detalle': str(exc)[:200], 'por': usuario, 'at': _iso()}])[-200:]
                _guardar(d)
            raise HTTPException(502, f"Effi no aceptó el ajuste de {b['nombre']}: {str(exc)[:150]}")
        hechos.append({'codigo': codigo, 'tela': fila['tela'], 'bodega': b['nombre'], 'delta': b['delta'], 'estado': 'hecho', 'tipo': 'a_effi', 'ajuste': r['id'], 'por': usuario, 'at': _iso()})
        log.warning('STOCKMAN: ajuste %s · %s · %s %+g mts (por %s)', r['id'], fila['tela'], b['nombre'], b['delta'], usuario)
    with _lock:
        d = _leer()
        d['ajustes'] = (d['ajustes'] + hechos)[-200:]
        _guardar(d)
    try:   # relee la tela en Effi para que la pantalla muestre ya el stock nuevo
        a = effi_api.articulo(codigo, fila['id_effi'])
        with _lock:
            d = _leer()
            d['nombres'][codigo]['stock_effi'] = {str(x['bodega']): round(float(x.get('stock') or 0), 2) for x in a.get('stock_bodegas') or []}
            _guardar(d)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude releer la tela tras ajustarla')
    return {'ok': True, 'ajustes': len(hechos)}


def _bodega_panel(effi_id: str) -> str:
    return next((nombre for nombre, i in BODEGAS.items() if i == str(effi_id)), '')


def traer_de_effi(aplicar: bool) -> list[dict]:
    """Ajustes de inventario NUEVOS hechos en Effi sobre telas del panel. Con aplicar=True se registran en el panel (INGRESO si suma, SALIDA si resta); si no, quedan como pendientes."""
    d = _leer()
    por_id = {v['id_effi']: c for c, v in d['nombres'].items() if v.get('id_effi')}
    lista = effi_api._lista('ajuste_inventario')
    ids = [int(a['id']) for a in lista if str(a.get('id') or '').isdigit()]
    if not ids:
        return []
    if d['ajuste_base'] is None:   # primera vez: lo anterior no se trae, solo lo que pase desde ahora
        with _lock:
            d = _leer()
            d['ajuste_base'] = max(ids)
            _guardar(d)
        return []
    propios = {str(h.get('ajuste')) for h in d['ajustes'] if h.get('tipo') == 'a_effi' and h.get('ajuste')}
    vistos = set(d['vistos'])
    telas = {str(t['codigo']): t for t in proveedores_tela.telas()}
    nuevos, pendientes, marcar = [], [], []
    for a in sorted(lista, key=lambda x: int(x['id'])):
        i = str(a['id'])
        if int(i) <= int(d['ajuste_base']) or i in vistos:
            continue
        codigo = por_id.get(str(a.get('articulo')))
        if i in propios or str(a.get('observacion') or '').startswith(PROPIO) or not codigo or str(a.get('vigente', '1')) != '1':
            marcar.append(i)   # los ajustes del propio STOCKMAN, de otros artículos o anulados no se traen
            continue
        try:
            delta = round(float(a.get('cantidad') or 0), 2)
        except ValueError:
            marcar.append(i)
            continue
        bodega = _bodega_panel(str(a.get('bodega')))
        item = {'codigo': codigo, 'tela': (d['nombres'].get(codigo) or {}).get('nombre_effi') or codigo, 'bodega': _NOMBRE_BODEGA.get(str(a.get('bodega'))) or _OTRAS.get(str(a.get('bodega')), str(a.get('bodega'))),
                'delta': delta, 'ajuste': i, 'tipo': 'a_panel', 'por': str(a.get('nombre_responsable') or ''), 'at': str(a.get('fecha_trans') or '')}
        if abs(delta) < 0.01:
            marcar.append(i)
        elif not bodega:
            nuevos.append({**item, 'estado': 'otra_bodega', 'detalle': 'Bodega de Effi que no es del panel: no se trae'})
            marcar.append(i)
        elif aplicar:
            try:
                from app import inventario_api
                t = telas.get(codigo) or {}
                inventario_api.inventory_movement(inventario_api.InventoryMovement(type='INGRESO' if delta > 0 else 'SALIDA', name=f"({codigo}) {t.get('nombre', '')}".strip(), code=codigo, mts=abs(delta), rolls=1,
                                                                                     source=f'STOCKMAN · ajuste {i} de Effi', bodega=bodega if delta > 0 else ''))
                nuevos.append({**item, 'estado': 'hecho'})
                marcar.append(i)
                log.warning('STOCKMAN: ajuste %s de Effi traído al panel: %s %s %+g mts', i, item['tela'], bodega, delta)
            except Exception as exc:   # noqa: BLE001
                nuevos.append({**item, 'estado': 'error', 'detalle': str(exc)[:160]})
        else:
            pendientes.append({**item, 'estado': 'pendiente'})
    with _lock:
        d = _leer()
        d['vistos'] = (d['vistos'] + marcar)[-500:]
        d['ajustes'] = (d['ajustes'] + nuevos)[-200:]
        d['pendientes'] = pendientes
        _guardar(d)
    return nuevos


def ciclo(completo: bool = False) -> dict:
    """Un ciclo de STOCKMAN: (1) lo que cambió en Effi pasa al panel, (2) lo que cambió en el panel pasa a Effi. En ese orden, para no pisar un ajuste hecho en Effi."""
    if not _usar_api():
        return {'ok': False}
    d = _leer()
    r = {'ok': True}
    if completo or time.time() - float(d['ultimo_completo']) > INTERVALO or not d['nombres']:
        r = refrescar_nombres()
        with _lock:
            dd = _leer()
            dd['ultimo_completo'] = time.time()
            _guardar(dd)
    activo = _leer()['activo']
    traidos = []
    try:
        traidos = traer_de_effi(activo)
    except Exception:   # noqa: BLE001
        log.exception('STOCKMAN: no pude revisar los ajustes de Effi')
    ajustadas = 0
    if activo and r.get('ok') and not _leer()['pendientes']:
        ahora = time.time()
        filas = [x for x in evaluar() if x['estado'] == 'ajustar']
        with _lock:
            dd = _leer()
            estables = {f['codigo']: dd['estables'].get(f['codigo']) for f in filas}
            for f in filas:
                firma = json.dumps([(b['bodega'], b['panel'], b['effi']) for b in f['bodegas']])
                if not estables.get(f['codigo']) or estables[f['codigo']]['firma'] != firma:
                    estables[f['codigo']] = {'firma': firma, 'desde': ahora}
            dd['estables'] = {c: v for c, v in estables.items() if v}
            _guardar(dd)
        for f in filas:
            if ajustadas >= MAX_TELAS:
                break
            if ahora - estables[f['codigo']]['desde'] < ESTABLE_SEG:
                continue
            try:
                aplicar_tela(f['codigo'], 'STOCKMAN')
                ajustadas += 1
            except HTTPException:
                continue
    with _lock:
        dd = _leer()
        dd['ultima'] = _iso()
        _guardar(dd)
    return {**r, 'ajustadas': ajustadas, 'traidos': len(traidos)}


def revisar() -> dict:
    return ciclo(completo=True)


@router.get('/estado')
def estado(request: Request):
    d = _leer()
    filas = evaluar()
    cuenta = lambda k: sum(1 for f in filas if f['estado'] == k)
    return {'agente': {'nombre': NOMBRE, 'activo': d['activo'], 'ultima': d['ultima'], 'error': d['error']},
            'resumen': {'telas': len(filas), 'ajustar': cuenta('ajustar'), 'grande': cuenta('grande'), 'igual': cuenta('igual'), 'sin_articulo': cuenta('sin_articulo')},
            'telas': filas, 'ajustes': d['ajustes'][-30:][::-1], 'pendientes': d['pendientes']}


@router.post('/revisar')
def revisar_ahora(request: Request):
    return revisar()


@router.post('/ajustar')
def ajustar(request: Request, payload: dict):
    """Botón AJUSTAR de la tarjeta: deja esa tela en Effi igual que en el panel."""
    usuario = str(_auth(request) or '')
    return aplicar_tela(str(payload.get('codigo') or ''), usuario)


@router.put('/activar')
def activar(request: Request, payload: dict):
    usuario = str(_auth(request) or '')
    with _lock:
        d = _leer()
        d['activo'] = bool(payload.get('activo'))
        _guardar(d)
    log.warning('STOCKMAN %s por %s', 'ACTIVADO' if d['activo'] else 'APAGADO', usuario)
    return {'ok': True, 'activo': d['activo']}


@router.get('/nombres')
def nombres():
    return {'mapa': mapa()}


@router.post('/nombres/actualizar')
def actualizar(request: Request):
    return refrescar_nombres()


def _bucle() -> None:
    time.sleep(90)
    while True:
        try:
            ciclo()
        except Exception:   # noqa: BLE001
            log.exception('STOCKMAN: fallo en el ciclo')
        time.sleep(CICLO)


def start() -> None:
    threading.Thread(target=_bucle, name='stockman', daemon=True).start()
