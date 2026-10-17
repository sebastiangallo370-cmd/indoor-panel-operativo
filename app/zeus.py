"""ZEUS: agente de inventario que pide la tela que falta.

El panel calcula qué tela no alcanza para los pedidos programados (pestaña «Tela programada»). ZEUS junta lo que falta POR TELA y lo convierte en
una orden de compra pendiente. Un agente en el PC de la oficina (con la sesión de Effi) toma cada pendiente, crea la orden de compra en Effi ERP
con exactamente los MTS que faltan (el proveedor sale de Effi con el código de la tela) y devuelve el número; el panel avisa por correo al
encargado de pedir la tela. Igual que ECOMMERCE, el PC pregunta al panel (sondeo saliente con el mismo token); el panel nunca se conecta al PC.

Estados de cada compra: pendiente (esperando al agente) · entregada (el agente la tiene) · creada (orden de compra hecha en Effi) · error · cancelada (ya alcanzó).
Datos en /data/state/zeus.json.
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from app import proveedores_tela
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

log = logging.getLogger('zeus')
router = APIRouter(prefix='/api/zeus', tags=['zeus'])
pc_router = APIRouter(prefix='/api/zeus/pc', tags=['zeus-pc'])
public_router = APIRouter(prefix='/api/zeus', tags=['zeus-publico'])   # solo el enlace de confirmación del correo (sin sesión)
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
CONFIRMA_VENCE_SEG = 48 * 3600   # el enlace del mensaje de verificación dura 48 horas
REENVIO_MIN_SEG = 60
URL_PUBLICA = os.getenv('PUBLIC_URL', 'https://produccion.cloud').rstrip('/')
_CORREO = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')


_usuarios: Callable[[], list[dict]] = lambda: []
NOTIFICA_DIAS = 7


def configurar_usuarios(fn: Callable[[], list[dict]]) -> None:
    global _usuarios
    _usuarios = fn


def alertas_para(usuario: str) -> list[dict]:
    """Avisos de la campana: «se envió un requerimiento de compra». Solo para las cuentas elegidas en el panel del agente."""
    with _lock:
        d = _leer()
    elegidos = {u.lower() for u in d['config']['notificar']}
    if usuario.lower() not in elegidos:
        return []
    limite = _ahora() - NOTIFICA_DIAS * 86400
    salida = []
    for i in reversed(d['items']):
        if i.get('estado') != 'creada' or not i.get('oc'):
            continue
        try:
            if time.mktime(time.strptime(str(i.get('creada') or i.get('actualizado'))[:19], '%Y-%m-%dT%H:%M:%S')) < limite - 5 * 3600:
                continue
        except (ValueError, TypeError):
            pass
        pedidos = ', '.join(o.get('orden', '') for o in i.get('ordenes', [])[:4] if o.get('orden'))
        salida.append({'tipo': 'compra', 'orden': 'OC ' + str(i['oc']), 'cliente': '', 'severidad': 'media',
                       'titulo': f"Se envió un requerimiento de compra: {i['tela']}",
                       'detalle': f"{i['falta']:g} MTS · orden de compra {i['oc']} en Effi" + (f' · pedidos {pedidos}' if pedidos else ''),
                       'texto': f"Requerimiento de compra {i['tela']} {i['falta']:g} MTS · OC {i['oc']}"})
    return salida[:15]


def auth_agente(pc_auth: Callable[[Request], None]) -> Callable[[Request], None]:
    """El agente instalado en el VPS usa ZEUS_AGENT_TOKEN (variable del .env del servidor); los PC siguen usando su código de ECOMMERCE."""
    def comprobar(request: Request) -> None:
        esperado = os.getenv('ZEUS_AGENT_TOKEN', '')
        recibido = request.headers.get('x-ecommerce-token', '')
        if esperado and recibido and len(esperado) >= 32 and secrets.compare_digest(recibido, esperado):
            return
        pc_auth(request)
    return comprobar


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
    d['config'].setdefault('notificar', [])   # cuentas del panel a las que les suena la campana cuando se envía una orden de compra
    d['config']['correos'] = [c if isinstance(c, dict) else {'correo': str(c), 'estado': 'verificado'} for c in d['config']['correos']]
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
        correos = [c['correo'] for c in _leer()['config']['correos'] if c.get('estado') == 'verificado']
    return ', '.join(correos) or os.getenv('ZEUS_EMAIL_A') or os.getenv('ALERTA_EMAIL_A') or ''


def _correo_creada(item: dict) -> None:
    try:
        from app import alertas_correo
        if not alertas_correo.puede_enviar():
            return
        para = destinatarios()
        lineas = [f"- {o['orden']} · {o['referencia']} · {o.get('cliente', '')}: falta {o['falta']:g} MTS (entrega {o.get('entrega') or 'sin fecha'})" for o in item['ordenes']]
        alertas_correo.enviar(f"Orden de compra de tela creada en Effi: {item['tela']}",
                              f"El AGENTE INVENTARIO creó la orden de compra {item['oc'] or '(sin número)'} en Effi.\n\nTela: {item['tela']}\nMetros pedidos: {item['falta']:g} MTS\n\n"
                              'Pedidos que la necesitan:\n' + '\n'.join(lineas) + '\n\nVer: https://produccion.cloud (menú de la cuenta > Agente inventario)', para=para)
    except Exception:   # noqa: BLE001
        log.exception('No se pudo enviar el correo de la orden de compra')


MENSAJE_PROVEEDOR = (
    'Cordial saludo,\n\n'
    'Desde INDOOR SPORT SAS le enviamos la orden de compra N.° {oc}:\n\n'
    '  · Tela: {tela}\n'
    '  · Cantidad: {falta:g} metros\n\n'
    'La orden oficial le llega adjunta en el mensaje de nuestro sistema (Effi). '
    'Por favor confirme la recepción de este pedido y la fecha estimada de despacho respondiendo a este correo.\n\n'
    'Muchas gracias por su atención.\n\n'
    'INDOOR SPORT SAS\nÁrea de Compras e Inventario\nhttps://produccion.cloud'
)


def _correo_proveedor(item: dict, correo: str) -> str:
    """Mensaje predeterminado de Indoor para el proveedor (acompaña la orden que Effi le envía). Devuelve '' si salió o el motivo si no."""
    try:
        from app import alertas_correo
        if not alertas_correo.puede_enviar():
            return 'Falta configurar la cuenta de correo del servidor.'
        alertas_correo.enviar(f"INDOOR SPORT SAS · Orden de compra {item['oc']} · {item['tela']}",
                              MENSAJE_PROVEEDOR.format(oc=item['oc'], tela=item['tela'], falta=float(item['falta'])), para=correo)
        return ''
    except Exception as e:   # noqa: BLE001
        log.exception('No se pudo enviar el mensaje de Indoor al proveedor')
        return str(e)[:120]


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
                'correo': {'configurado': alertas_correo.puede_enviar(), 'cuenta': alertas_correo.cuenta()[0], 'encargado': bool(any(c.get('estado') == 'verificado' for c in d['config']['correos']) or os.getenv('ZEUS_EMAIL_A') or os.getenv('ALERTA_EMAIL_A'))},
                'correos': _correos_vista(d), 'notificar': d['config']['notificar'], 'usuarios': _usuarios()}


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'Solo Administración / Coordinación puede cambiar los correos del agente')
    return usuario


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _correos_vista(d: dict) -> list[dict]:
    """Lo que ve el navegador: nunca el token."""
    return [{'correo': c['correo'], 'estado': c.get('estado', 'pendiente'), 'enviado': c.get('enviado_iso', ''), 'verificado': c.get('verificado_iso', ''),
             'detalle': c.get('detalle', '')} for c in d['config']['correos']]


def _validar(correo: str) -> str:
    c = str(correo or '').strip().lower()
    if not c or not _CORREO.match(c) or len(c) > 120:
        raise HTTPException(400, f'«{c[:60]}» no es un correo válido')
    return c


def _enviar_verificacion(correo: str, token: str, pidio: str) -> str:
    """Manda el mensaje con el enlace de confirmación. Devuelve '' si salió o el motivo si no pudo."""
    from app import alertas_correo
    if not alertas_correo.puede_enviar():
        return 'Falta configurar la cuenta de correo del servidor: no se pudo enviar el mensaje de verificación.'
    enlace = f'{URL_PUBLICA}/api/zeus/confirmar?c={correo}&t={token}'
    try:
        alertas_correo.enviar('Confirma tu correo para recibir las órdenes de compra de tela',
                              f'{pidio or "Alguien"} agregó este correo en el panel de Indoor Sport para recibir las órdenes de compra de tela que crea el AGENTE INVENTARIO.\n\n'
                              f'Para activarlo, confirma que es tuyo abriendo este enlace (vale 48 horas):\n\n{enlace}\n\n'
                              'Si no esperabas este mensaje, ignóralo: sin tu confirmación no recibirás nada.', para=correo)
    except Exception as e:   # noqa: BLE001
        log.exception('No se pudo enviar el mensaje de verificación')
        return f'No se pudo enviar el mensaje: {str(e)[:120]}'
    return ''


@router.get('/config')
def ver_config():
    with _lock:
        d = _leer()
        return {'correos': _correos_vista(d), 'notificar': d['config']['notificar'], 'usuarios': _usuarios()}


@router.post('/enviar-proveedor')
def enviar_proveedor(request: Request, payload: dict):
    """Botón de la página: el agente envía la orden de compra al correo del proveedor desde Effi (más el mensaje de Indoor)."""
    usuario = _usuario(request)
    with _lock:
        d = _leer()
        item = next((i for i in d['items'] if i['id'] == payload.get('id')), None)
        if not item or item.get('estado') != 'creada' or not item.get('oc'):
            raise HTTPException(404, 'Esa orden de compra todavía no está creada en Effi')
        e = item.get('envio_proveedor') or {}
        if e.get('estado') in ('pendiente', 'entregada'):
            raise HTTPException(409, 'Ya hay un envío en curso para esta orden')
        if e.get('estado') == 'enviada' and not payload.get('otra_vez'):
            raise HTTPException(409, 'Esta orden ya se envió al proveedor')
        item['envio_proveedor'] = {'estado': 'pendiente', 'por': usuario, 'pedido_at': _ahora(), 'at': _iso()}
        _guardar(d)
    return {'ok': True}


@router.put('/notificar')
def elegir_notificar(payload: dict):
    """Cuentas del panel a las que les llega la notificación (campana) cuando el agente envía una orden de compra."""
    validos = {u['nombre'].lower(): u['nombre'] for u in _usuarios()}
    elegidos = []
    for u in payload.get('usuarios') or []:
        real = validos.get(str(u).strip().lower())
        if real and real not in elegidos:
            elegidos.append(real)
    with _lock:
        d = _leer()
        d['config']['notificar'] = elegidos
        _guardar(d)
    return {'notificar': elegidos}


@router.post('/correos')
def agregar_correo(request: Request, payload: dict):
    """Agrega un correo en estado «pendiente» y le manda un mensaje de verificación; solo recibe órdenes cuando su dueño confirma."""
    usuario = _usuario(request)
    correo = _validar(payload.get('correo'))
    token = secrets.token_urlsafe(24)
    with _lock:
        d = _leer()
        lista = d['config']['correos']
        if any(c['correo'] == correo for c in lista):
            raise HTTPException(409, 'Ese correo ya está en la lista')
        if len(lista) >= MAX_CORREOS:
            raise HTTPException(400, f'Máximo {MAX_CORREOS} correos')
        lista.append({'correo': correo, 'estado': 'pendiente', 'token': _hash(token), 'enviado_at': _ahora(), 'enviado_iso': _iso(), 'pidio': usuario})
        _guardar(d)
    motivo = _enviar_verificacion(correo, token, usuario)
    with _lock:
        d = _leer()
        c = next(x for x in d['config']['correos'] if x['correo'] == correo)
        c['detalle'] = motivo
        _guardar(d)
        return {'ok': True, 'enviado': not motivo, 'detalle': motivo, 'correos': _correos_vista(d)}


@router.post('/correos/reenviar')
def reenviar_correo(request: Request, payload: dict):
    usuario = _usuario(request)
    correo = _validar(payload.get('correo'))
    token = secrets.token_urlsafe(24)
    with _lock:
        d = _leer()
        c = next((x for x in d['config']['correos'] if x['correo'] == correo), None)
        if not c:
            raise HTTPException(404, 'Ese correo no está en la lista')
        if c.get('estado') == 'verificado':
            raise HTTPException(409, 'Ese correo ya está confirmado')
        if _ahora() - float(c.get('enviado_at') or 0) < REENVIO_MIN_SEG:
            raise HTTPException(429, 'Espera un minuto antes de reenviar el mensaje')
        c.update(token=_hash(token), enviado_at=_ahora(), enviado_iso=_iso(), pidio=usuario)
        _guardar(d)
    motivo = _enviar_verificacion(correo, token, usuario)
    with _lock:
        d = _leer()
        next(x for x in d['config']['correos'] if x['correo'] == correo)['detalle'] = motivo
        _guardar(d)
        return {'ok': True, 'enviado': not motivo, 'detalle': motivo, 'correos': _correos_vista(d)}


@router.delete('/correos')
def quitar_correo(request: Request, correo: str):
    _usuario(request)
    c = _validar(correo)
    with _lock:
        d = _leer()
        antes = len(d['config']['correos'])
        d['config']['correos'] = [x for x in d['config']['correos'] if x['correo'] != c]
        if len(d['config']['correos']) == antes:
            raise HTTPException(404, 'Ese correo no está en la lista')
        _guardar(d)
        return {'ok': True, 'correos': _correos_vista(d)}


def _pagina(titulo: str, texto: str, ok: bool) -> HTMLResponse:
    color = '#d0f44c' if ok else '#ff8a80'
    return HTMLResponse(f'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Indoor Sport</title>'
                        f'<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b100b;color:#eef3ea;font-family:Arial,sans-serif;padding:24px">'
                        f'<main style="max-width:440px;text-align:center"><div style="font-size:3rem;color:{color}">{"✔" if ok else "✕"}</div>'
                        f'<h1 style="font-size:1.4rem">{html.escape(titulo)}</h1><p style="color:#b9c6b3;line-height:1.5">{html.escape(texto)}</p></main></body></html>',
                        status_code=200 if ok else 400)


@public_router.get('/confirmar')
def confirmar_correo(c: str = '', t: str = ''):
    """Enlace del mensaje de verificación: lo abre el dueño del correo (no necesita sesión). Sirve una sola vez y vence a las 48 h."""
    correo = str(c or '').strip().lower()
    with _lock:
        d = _leer()
        item = next((x for x in d['config']['correos'] if x['correo'] == correo), None)
        if not item or not t or not item.get('token') or not secrets.compare_digest(item['token'], _hash(t)):
            return _pagina('Enlace no válido', 'Este enlace ya se usó o no corresponde a ningún correo pendiente. Pide que te reenvíen el mensaje desde el panel.', False)
        if _ahora() - float(item.get('enviado_at') or 0) > CONFIRMA_VENCE_SEG:
            return _pagina('Enlace vencido', 'El enlace duró 48 horas. Pide que te reenvíen el mensaje desde el panel.', False)
        item.update(estado='verificado', verificado_iso=_iso(), detalle='')
        item.pop('token', None)
        _guardar(d)
    return _pagina('Correo confirmado', f'{correo} recibirá las órdenes de compra de tela que cree el AGENTE INVENTARIO.', True)


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
    correos_envio = [c.strip() for c in destinatarios().split(',') if c.strip()]   # fuera del candado: destinatarios() lo usa
    with _lock:
        d = _leer()
        d['latido'] = {'at': _ahora(), 'estado': str(payload.get('estado', 'LIBRE'))[:24], 'ultima': str(payload.get('ultima', ''))[:300], 'equipo': str(payload.get('equipo', ''))[:60]}
        for r in (payload.get('resultados') or [])[:20]:
            item = next((i for i in d['items'] if i['id'] == r.get('id')), None)
            if not item:
                continue
            item['actualizado'] = _iso()
            if r.get('tipo') == 'enviar_proveedor':
                correo = str(r.get('correo', ''))[:120]
                envio = {'estado': 'enviada' if r.get('ok') else 'error', 'correo': correo, 'detalle': str(r.get('detalle', ''))[:200], 'at': _iso(),
                         'por': (item.get('envio_proveedor') or {}).get('por', '')}
                item['envio_proveedor'] = envio
                if r.get('ok') and correo:
                    motivo = _correo_proveedor(item, correo)
                    envio['mensaje'] = 'enviado' if not motivo else 'no salió: ' + motivo
                continue
            if r.get('ok'):
                item.update(estado='creada', oc=str(r.get('oc', ''))[:40], detalle=str(r.get('detalle', ''))[:300], creada=_iso())
                item['encargado_enviado'] = ' · enviada a ' in str(r.get('detalle', ''))   # Effi mandó la orden a los correos del encargado
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
                    codigo = next((c for c in (proveedores_tela.codigo_de(b) for b in i.get('bodega', [])) if c), '')
                    prov = proveedores_tela.proveedor_de(codigo) if codigo else {}
                    entregar.append({'id': i['id'], 'tela': i['tela'], 'falta': i['falta'], 'ordenes': [o['orden'] for o in i['ordenes']], 'bodega': i.get('bodega', []),
                                     'codigo': codigo, 'proveedor': prov.get('proveedor', ''), 'nit': prov.get('nit', ''),
                                     'correos': correos_envio})
        if payload.get('puede_trabajar'):
            for i in d['items']:
                e = i.get('envio_proveedor') or {}
                if e.get('estado') == 'pendiente' and i.get('oc'):
                    e['estado'], e['entregada_at'] = 'entregada', _ahora()
                    entregar.append({'tipo': 'enviar_proveedor', 'id': i['id'], 'oc': i['oc'], 'tela': i['tela'], 'falta': i['falta']})
        for i in d['items']:   # un envío que el agente recibió y nunca confirmó no queda colgado
            e = i.get('envio_proveedor') or {}
            if e.get('estado') in ('pendiente', 'entregada') and _ahora() - float(e.get('entregada_at') or e.get('pedido_at') or 0) > 900:
                e.update(estado='error', detalle='El agente no confirmó el envío (¿estaba apagado?). Puedes intentarlo otra vez.')
        _guardar(d)
    for item in avisos:
        _correo_creada(item)
    return {'trabajos': entregar}
