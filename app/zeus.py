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

from app import effi_api, memoria_agentes, proveedores_tela
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
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


def estado_tela(tela: str) -> dict:
    """Lo que la alerta de falta de tela muestra del requerimiento de ZEUS: pendiente (Effi aún no lo crea) · creada (OC en Effi y PDF enviado a los correos) · error."""
    with _lock:
        d = _leer()
    item = next((i for i in reversed(d['items']) if i.get('tela') == tela and i.get('estado') != 'cancelada'), None)
    if not item:
        return {'estado': 'pendiente'}
    if item['estado'] == 'creada' and item.get('oc'):
        masc = [re.sub(r'^(.).*?(@.*)$', r'\1***\2', c['correo']) for c in d['config']['correos'] if c.get('estado') == 'verificado']
        return {'estado': 'enviado', 'oc': str(item['oc']), 'para': ', '.join(masc), 'hora': str(item.get('creada') or item.get('actualizado') or '')[11:16]}
    return {'estado': 'error' if item['estado'] == 'error' else 'pendiente'}


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
                if item['estado'] != 'entregada' and not item.get('manual'):   # lo que ya tiene el agente (o lo que pidió una persona a mano) no se cambia
                    item.update(falta=max(necesita, 0.0), ordenes=f['ordenes'], bodega=f['bodega'], actualizado=_iso())
            elif necesita > MARGEN_MTS:
                d['seq'] += 1
                d['items'].append({'id': d['seq'], 'tela': tela, 'falta': necesita, 'ordenes': f['ordenes'], 'bodega': f['bodega'], 'estado': 'pendiente',
                                   'oc': '', 'detalle': '', 'intentos': 0, 'creado': _iso(), 'actualizado': _iso()})
                nuevas += 1
        for item in d['items']:
            if item['estado'] in ('pendiente', 'error') and not item.get('manual') and (item['tela'] not in faltantes or item['falta'] <= MARGEN_MTS):
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


def _pdf_de(item: dict) -> list:
    """[(nombre, bytes)] con el PDF de la orden (el que bajó el agente de Effi), o [] si no hay."""
    try:
        ruta = _pdfs / str(item.get('pdf') or '')
        if item.get('pdf') and ruta.is_file():
            return [(f"Orden de compra {item['oc']}.pdf", ruta.read_bytes())]
    except OSError:
        pass
    return []


def _guardar_pdf(oc: str, b64: str) -> str:
    """Valida y guarda el PDF que manda el agente. Devuelve el nombre del archivo o ''."""
    import base64
    try:
        raw = base64.b64decode(b64, validate=False)
        if raw[:4] != b'%PDF' or len(raw) > MAX_PDF:
            return ''
        nombre = 'OC-' + re.sub(r'[^0-9A-Za-z_-]', '', str(oc))[:20] + '.pdf'
        _pdfs.mkdir(parents=True, exist_ok=True)
        (_pdfs / nombre).write_bytes(raw)
        return nombre
    except (ValueError, OSError):
        return ''


def _correo_creada(item: dict) -> None:
    try:
        from app import alertas_correo
        if not alertas_correo.puede_enviar():
            return
        para = destinatarios()
        lineas = [f"- {o['orden']} · {o['referencia']} · {o.get('cliente', '')}: falta {o['falta']:g} MTS (entrega {o.get('entrega') or 'sin fecha'})" for o in item['ordenes']]
        adj = _pdf_de(item)
        alertas_correo.enviar(f"Orden de compra de tela creada en Effi: {item['tela']}",
                              f"El AGENTE INVENTARIO creó la orden de compra {item['oc'] or '(sin número)'} en Effi.\n\nTela: {item['tela']}\nMetros pedidos: {item['falta']:g} MTS\n\n"
                              'Pedidos que la necesitan:\n' + '\n'.join(lineas) + ('\n\nAdjunto el PDF de la orden.' if adj else '\n\n(El PDF de la orden no se pudo descargar de Effi: está en Compras > Órdenes de compra.)') +
                              '\n\nVer: https://produccion.cloud (menú de la cuenta > Agente inventario)', para=para, adjuntos=adj)
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
                              MENSAJE_PROVEEDOR.format(oc=item['oc'], tela=item['tela'], falta=float(item['falta'])), para=correo, adjuntos=_pdf_de(item))
        return ''
    except Exception as e:   # noqa: BLE001
        log.exception('No se pudo enviar el mensaje de Indoor al proveedor')
        return str(e)[:120]


_llenar_mts: Callable[[], dict] = lambda: {}
_llave_ok: Callable[[str], bool] = lambda usuario: False
_secreto = Path(os.getenv('ZEUS_SECRETO_FILE', '/data/state/zeus_secreto.json'))
_pdfs = Path(os.getenv('ZEUS_PDF_DIR', '/data/state/zeus_pdf'))
MAX_PDF = 8 * 1024 * 1024


def configurar_llave(fn: Callable[[str], bool]) -> None:
    global _llave_ok
    _llave_ok = fn


def _leer_secreto() -> dict:
    try:
        return json.loads(_secreto.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _guardar_secreto(d: dict) -> None:
    _secreto.parent.mkdir(parents=True, exist_ok=True)
    tmp = _secreto.with_suffix('.tmp')
    tmp.write_text(json.dumps(d), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(_secreto)


def _api_vista(d: dict) -> dict:
    """Estado de la API de Effi para la pantalla: NUNCA incluye la llave, solo si existe y sus 4 últimas letras."""
    sec = _leer_secreto()
    k = sec.get('llave', '')
    cfg = d['config'].get('api') or {}
    dias = None
    if sec.get('guardada_at'):
        try:
            dias = max(0, 360 - int((time.time() - time.mktime(time.strptime(sec['guardada_at'][:19], '%Y-%m-%dT%H:%M:%S'))) // 86400))
        except ValueError:
            pass
    return {'configurada': bool(k), 'ultimos4': k[-4:] if k else '', 'guardada_at': sec.get('guardada_at', ''), 'vence_en_dias': dias,
            'descuento_pct': cfg.get('descuento_pct', 0), 'retenciones': cfg.get('retenciones', [])}


def api_para_agente(d: dict) -> dict | None:
    sec = _leer_secreto()
    if not sec.get('llave'):
        return None
    cfg = d['config'].get('api') or {}
    return {'llave': sec['llave'], 'descuento_pct': cfg.get('descuento_pct', 0), 'retenciones': cfg.get('retenciones', [])}


def configurar_mts(fn: Callable[[], dict]) -> None:
    global _llenar_mts
    _llenar_mts = fn


def start() -> None:
    """ZEUS no revisa por reloj: el panel lo avisa (main.avisar_zeus) cuando una tarjeta recibe sus MTS REQUERIDOS, y el botón «Revisar» sigue disponible."""
    return


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
def _enriquecer(i: dict) -> dict:
    """Para dibujar la tarjeta: código de la tela y proveedor elegido en Estándar 2026."""
    codigo = i.get('codigo_forzado') or next((c for c in (proveedores_tela.codigo_de(b) for b in i.get('bodega', [])) if c), '')
    prov = proveedores_tela.proveedor_de(codigo) if codigo else {}
    return {**i, 'codigo': codigo, 'proveedor': i.get('proveedor_forzado') or i.get('proveedor_usado') or prov.get('proveedor', '')}


@router.get('/mi')
def mi_acceso(request: Request):
    """La pantalla pregunta aquí si esta cuenta puede ver el AGENTE INVENTARIO."""
    _usuario(request)
    return {'ok': True}


@router.get('/estado')
def estado():
    with _lock:
        d = _leer()
        _vencer(d)
        from app import alertas_correo
        return {'agente': _agente(d), 'items': [_enriquecer(i) for i in d['items'][-60:][::-1]],
                'resumen': {e: sum(1 for i in d['items'] if i['estado'] == e) for e in ('pendiente', 'entregada', 'creada', 'error', 'cancelada', 'anulada')},
                'correo': {'google': __import__('app.google_correo', fromlist=['x']).estado(), 'configurado': alertas_correo.puede_enviar(), 'cuenta': alertas_correo.cuenta()[0], 'encargado': bool(any(c.get('estado') == 'verificado' for c in d['config']['correos']) or os.getenv('ZEUS_EMAIL_A') or os.getenv('ALERTA_EMAIL_A'))},
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


@router.post('/anular')
def anular_orden(request: Request, payload: dict):
    """Botón «Anular orden» de la tarjeta: anula la orden de compra en Effi por la API (DELETE /orden_c) y la marca anulada aquí."""
    usuario = _usuario(request)
    motivo = str(payload.get('motivo', '')).strip() or 'Orden anulada desde el panel de Indoor Sport'
    sec = _leer_secreto()
    if not sec.get('llave'):
        raise HTTPException(400, 'Para anular desde aquí conecta la API de Effi (pestaña «API Effi»).')
    with _lock:
        item = next((i for i in _leer()['items'] if i['id'] == payload.get('id')), None)
    if not item or item.get('estado') != 'creada' or not item.get('oc'):
        raise HTTPException(404, 'Esa orden de compra no está creada en Effi (o ya se anuló)')
    effi_api.usar_llave(sec['llave'])
    ya = False
    try:
        effi_api.anular_orden(item['oc'], motivo)
    except effi_api.EffiError as e:
        if e.estado == 400 and 'anulada' in str(e).lower():
            ya = True   # Effi dice que ya estaba anulada (por ejemplo desde su web): se refleja igual aquí
        else:
            raise HTTPException(400, 'Effi no la anuló: ' + str(e))
    with _lock:
        d = _leer()
        it = next((i for i in d['items'] if i['id'] == item['id']), None)
        if it:
            it.update(estado='anulada', anulada_at=_iso(), anulada_por=usuario, motivo_anulada=motivo[:255], actualizado=_iso())
            d['pedido_por_tela'][it['tela']] = max(0.0, round(float(d['pedido_por_tela'].get(it['tela'], 0)) - float(it['falta']), 2))   # esa tela vuelve a faltar si sigue sin alcanzar
            _guardar(d)
    return {'ok': True, 'ya_anulada': ya}


@router.post('/modificar')
def modificar_orden(request: Request, payload: dict):
    """Botón «Modificar orden»: la persona elige qué cambia (proveedor, referencia y/o cantidad); se anula la orden en Effi y el agente crea una nueva con los cambios."""
    usuario = _usuario(request)
    cambiar = {c for c in (payload.get('cambiar') or []) if c in ('proveedor', 'referencia', 'cantidad')}
    if not cambiar:
        raise HTTPException(400, 'Elige qué quieres modificar: proveedor, referencia o cantidad.')
    sec = _leer_secreto()
    if not sec.get('llave'):
        raise HTTPException(400, 'Para modificar desde aquí conecta la API de Effi (pestaña «API Effi»).')
    with _lock:
        d0 = _leer()
        viejo = next((i for i in d0['items'] if i['id'] == payload.get('id')), None)
        actual = _enriquecer(viejo) if viejo else None
    if not viejo or viejo.get('estado') != 'creada' or not viejo.get('oc'):
        raise HTTPException(404, 'Esa orden de compra no está creada en Effi (o ya se anuló)')
    proveedor = str(payload.get('proveedor') or '').strip()[:120] if 'proveedor' in cambiar else actual['proveedor']
    codigo = str(payload.get('codigo') or '').strip()[:30] if 'referencia' in cambiar else actual['codigo']
    if 'cantidad' in cambiar:
        try:
            cantidad = round(float(str(payload.get('cantidad')).replace(',', '.')), 2)
        except (TypeError, ValueError):
            raise HTTPException(400, 'La cantidad no es un número.')
        if cantidad <= 0 or cantidad > 100000:
            raise HTTPException(400, 'La cantidad debe ser mayor que 0 metros.')
    else:
        cantidad = float(viejo['falta'])
    if not proveedor:
        raise HTTPException(400, 'Falta el proveedor.')
    if not codigo:
        raise HTTPException(400, 'Falta la referencia (código de la tela).')
    effi_api.usar_llave(sec['llave'])
    try:   # se comprueba en Effi ANTES de anular: si el proveedor o la referencia no existen, la orden original queda intacta
        effi_api.articulo(codigo)
        effi_api.proveedor(proveedor)
    except effi_api.EffiError as e:
        raise HTTPException(400, str(e))
    motivo = f'Modificada desde el panel por {usuario}: ' + ', '.join(sorted(cambiar))
    try:
        effi_api.anular_orden(viejo['oc'], motivo)
    except effi_api.EffiError as e:
        if not (e.estado == 400 and 'anulada' in str(e).lower()):
            raise HTTPException(400, 'Effi no anuló la orden original: ' + str(e))
    with _lock:
        d = _leer()
        it = next((i for i in d['items'] if i['id'] == viejo['id']), None)
        if it:
            it.update(estado='anulada', anulada_at=_iso(), anulada_por=usuario, motivo_anulada=motivo[:255], actualizado=_iso())
            d['pedido_por_tela'][it['tela']] = max(0.0, round(float(d['pedido_por_tela'].get(it['tela'], 0)) - float(it['falta']), 2))
        nombre = next((t.get('nombre') for t in proveedores_tela.telas() if str(t.get('codigo')) == codigo), '') if 'referencia' in cambiar else ''
        d['seq'] += 1
        d['items'].append({'id': d['seq'], 'tela': nombre or viejo['tela'], 'falta': cantidad, 'ordenes': viejo.get('ordenes', []), 'bodega': viejo.get('bodega', []) if 'referencia' not in cambiar else [],
                           'estado': 'pendiente', 'oc': '', 'detalle': f'Reemplaza la orden {viejo["oc"]} (modificada por {usuario})', 'intentos': 0, 'manual': True,
                           'codigo_forzado': codigo, 'proveedor_forzado': proveedor, 'modifica_a': viejo['id'], 'creado': _iso(), 'actualizado': _iso()})
        nuevo = d['seq']
        _guardar(d)
    return {'ok': True, 'nuevo_id': nuevo}


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


def _usuario_llave(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _llave_ok(usuario):
        raise HTTPException(403, 'Solo la cuenta Indoor Sport puede ver y cambiar la API de Effi')
    return usuario


@router.get('/resumen')
def resumen_compras(request: Request):
    """Para la pestaña «Tela» de Inicio: lo que falta por pedir, lo que ZEUS ya pidió (últimos 7 días) y lo que falló. Mismos permisos que Agente Inventario."""
    _usuario(request)
    with _lock:
        d = _leer()
    limite = _ahora() - 7 * 86400
    por_pedir, creadas, errores = [], [], []
    for i in reversed(d['items']):
        est = i.get('estado')
        base = {'tela': i.get('tela', ''), 'falta': round(float(i.get('falta') or 0)), 'pedidos': len(i.get('ordenes') or [])}
        if est in ('pendiente', 'entregada'):
            por_pedir.append(base)
        elif est == 'error':
            errores.append({**base, 'detalle': str(i.get('detalle') or '')[:160]})
        elif est == 'creada' and i.get('oc'):
            try:
                t = time.mktime(time.strptime(str(i.get('creada') or i.get('actualizado'))[:19], '%Y-%m-%dT%H:%M:%S')) + 5 * 3600
            except (ValueError, TypeError):
                t = _ahora()
            if t >= limite:
                creadas.append({**base, 'oc': str(i['oc']), 'fecha': str(i.get('creada') or i.get('actualizado') or '')[:16].replace('T', ' ')})
    return {'por_pedir': por_pedir, 'creadas': creadas[:30], 'errores': errores, 'mts_por_pedir': sum(x['falta'] for x in por_pedir),
            'mts_creadas': sum(x['falta'] for x in creadas), 'agente': (_agente(d) or {}).get('conectado', False)}


@router.get('/google')
def google_estado(request: Request):
    from app import google_correo
    _usuario_llave(request)
    return google_correo.estado()


@router.put('/google/cliente')
def google_cliente(request: Request, payload: dict):
    """Guarda el ID de cliente y el secreto OAuth que se crean en Google Cloud (solo en el servidor)."""
    from app import google_correo
    _usuario_llave(request)
    cid, sec = str(payload.get('cliente_id') or '').strip(), str(payload.get('secreto') or '').strip()
    if not cid.endswith('.apps.googleusercontent.com') or len(sec) < 10 or re.search(r'\s', cid + sec):
        raise HTTPException(400, 'Revisa el ID de cliente (termina en .apps.googleusercontent.com) y el secreto')
    google_correo.guardar_cliente(cid, sec)
    return google_correo.estado()


@router.get('/google/inicio')
def google_inicio(request: Request):
    from fastapi.responses import RedirectResponse
    from app import google_correo
    _usuario_llave(request)
    try:
        return RedirectResponse(google_correo.url_inicio())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete('/google')
def google_desconectar(request: Request):
    from app import google_correo
    _usuario_llave(request)
    google_correo.desconectar()
    return google_correo.estado()


@public_router.get('/google/retorno')
def google_retorno(code: str = '', state: str = '', error: str = ''):
    """A donde vuelve Google después de elegir la cuenta (la validez la da el «state» que generó el panel)."""
    from app import google_correo
    if error or not code:
        return _pagina('Cuenta no conectada', 'Google no dio el permiso (' + (error or 'cancelado') + '). Cierra esta ventana y vuelve a intentarlo.', False)
    try:
        correo_ = google_correo.completar(code, state)
    except Exception as e:   # noqa: BLE001
        log.warning('Google correo: %s', e)
        return _pagina('Cuenta no conectada', str(e), False)
    log.info('Cuenta de envío conectada con Google: %s', correo_)
    return _pagina('Cuenta conectada', f'Desde ahora los mensajes del panel salen desde {correo_}. Puedes cerrar esta ventana.', True)


@router.put('/cuenta')
def cambiar_cuenta_envio(request: Request, payload: dict):
    """Cambia la cuenta de Gmail con que el panel envía TODOS sus correos. Antes de guardar inicia sesión con ella (no envía nada). Solo «Indoor Sport»."""
    from app import alertas_correo
    _usuario_llave(request)
    usuario = _validar(payload.get('usuario'))
    clave = re.sub(r'\s+', '', str(payload.get('clave') or ''))
    if len(clave) < 8:
        raise HTTPException(400, 'Escribe la contraseña de aplicación de esa cuenta (16 letras que da Google)')
    try:
        alertas_correo.probar_cuenta(usuario, clave)
    except Exception as e:   # noqa: BLE001
        raise HTTPException(400, 'Google no aceptó esa cuenta o contraseña de aplicación: ' + str(e)[:120])
    alertas_correo.guardar_cuenta(usuario, clave)
    log.info('Cuenta de envío de correos cambiada a %s por %s', usuario, _auth(request))
    return {'ok': True, 'cuenta': usuario}


@router.delete('/cuenta')
def quitar_cuenta_envio(request: Request):
    """Vuelve a la cuenta original del servidor (la del .env)."""
    from app import alertas_correo
    _usuario_llave(request)
    alertas_correo.borrar_cuenta()
    return {'ok': True, 'cuenta': alertas_correo.cuenta()[0]}


@router.get('/api')
def api_estado(request: Request):
    _usuario_llave(request)
    with _lock:
        return _api_vista(_leer())


@router.put('/api/llave')
def api_guardar_llave(request: Request, payload: dict):
    """Guarda la API key de Effi (solo en el servidor) después de comprobar que funciona con una consulta de solo lectura."""
    _usuario_llave(request)
    k = str(payload.get('llave', '')).strip()
    if not re.fullmatch(r'[A-Za-z0-9]{32,40}', k):
        raise HTTPException(400, 'La API key debe tener entre 32 y 40 letras y números, sin espacios')
    previa = effi_api.llave()
    effi_api.usar_llave(k)
    try:
        effi_api._lista('sucursal')
    except effi_api.EffiError as e:
        effi_api.usar_llave(previa)
        raise HTTPException(400, 'Effi no aceptó la llave: ' + str(e))
    with _lock:
        _guardar_secreto({'llave': k, 'guardada_at': _iso()})
        return _api_vista(_leer())


@router.delete('/api/llave')
def api_quitar_llave(request: Request):
    _usuario_llave(request)
    effi_api.usar_llave('')
    with _lock:
        _guardar_secreto({})
        return _api_vista(_leer())


@router.get('/api/catalogo')
def api_catalogo(request: Request):
    """Retenciones de Effi (para elegir cuál lleva cada orden). Usa la llave guardada; solo lectura."""
    _usuario_llave(request)
    sec = _leer_secreto()
    if not sec.get('llave'):
        raise HTTPException(400, 'Primero guarda la API key')
    effi_api.usar_llave(sec['llave'])
    try:
        rets = effi_api._lista('retencion')
    except effi_api.EffiError as e:
        raise HTTPException(400, str(e))
    return {'retenciones': [{'id': int(r['id']), 'etiqueta': r.get('etiqueta') or r.get('nombre'), 'valor': r.get('valor'), 'tipo': r.get('tipo_calculo')} for r in rets]}


@router.put('/api/ajustes')
def api_ajustes(request: Request, payload: dict):
    _usuario_llave(request)
    try:
        desc = float(str(payload.get('descuento_pct', 0)).replace(',', '.') or 0)
        rets = [int(x) for x in (payload.get('retenciones') or [])]
    except ValueError:
        raise HTTPException(400, 'Descuento o retenciones no válidos')
    if not 0 <= desc <= 100:
        raise HTTPException(400, 'El descuento debe estar entre 0 y 100')
    with _lock:
        d = _leer()
        d['config']['api'] = {'descuento_pct': desc, 'retenciones': rets}
        _guardar(d)
        return _api_vista(d)


@router.get('/pdf/{item_id}')
def ver_pdf(request: Request, item_id: int):
    _usuario(request)
    with _lock:
        item = next((i for i in _leer()['items'] if i['id'] == item_id), None)
    ruta = _pdfs / str((item or {}).get('pdf') or '')
    if not item or not item.get('pdf') or not ruta.is_file():
        raise HTTPException(404, 'Esa orden no tiene PDF guardado')
    # inline: el navegador muestra el PDF en la pestaña en vez de descargarlo
    return FileResponse(ruta, media_type='application/pdf', headers={'Content-Disposition': f'inline; filename="orden-de-compra-{item["oc"]}.pdf"', 'Cache-Control': 'private, no-store'})


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
                item['pdf'] = _guardar_pdf(item['oc'], str(r.get('pdf_b64') or '')) if r.get('pdf_b64') else ''
                item['encargado_enviado'] = ' · enviada a ' in str(r.get('detalle', ''))   # Effi mandó la orden a los correos del encargado
                d['pedido_por_tela'][item['tela']] = round(float(d['pedido_por_tela'].get(item['tela'], 0)) + float(item['falta']), 2)
                avisos.append(dict(item))
            else:
                item['intentos'] = int(item.get('intentos', 0)) + 1
                item.update(estado='error', detalle=str(r.get('detalle', ''))[:300])
                memoria_agentes.registrar('ZEUS', str(r.get('detalle', '')), 'ERROR')
        _vencer(d)
        if payload.get('puede_trabajar'):
            for i in d['items']:
                if i['estado'] in ('pendiente',) or (i['estado'] == 'error' and int(i.get('intentos', 0)) < 3 and _ahora() - float(i.get('entregada_at') or 0) > 600):
                    i['estado'], i['entregada_at'] = 'entregada', _ahora()
                    codigo = i.get('codigo_forzado') or next((c for c in (proveedores_tela.codigo_de(b) for b in i.get('bodega', [])) if c), '')
                    prov = proveedores_tela.proveedor_de(codigo) if codigo else {}
                    proveedor = i.get('proveedor_forzado') or prov.get('proveedor', '')
                    i['codigo_usado'], i['proveedor_usado'] = codigo, proveedor
                    entregar.append({'id': i['id'], 'tela': i['tela'], 'falta': i['falta'], 'ordenes': [o['orden'] for o in i['ordenes']], 'bodega': i.get('bodega', []),
                                     'codigo': codigo, 'proveedor': proveedor, 'nit': prov.get('nit', ''),
                                     'correos': correos_envio, 'api': api_para_agente(d)})
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
