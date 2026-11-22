"""Bot de Telegram del panel: recibe los mensajes por webhook y guía al comercial con el flujo de botones (telegram_flujo.py).

Seguridad:
- Solo responde a cuentas VINCULADAS con un usuario del panel (código de 6 dígitos que confirma un administrador).
- Crear documentos exige el permiso de comercial del panel y el interruptor TELEGRAM_CREAR_ACTIVO=1 (apagado por defecto).
- El webhook exige la cabecera X-Telegram-Bot-Api-Secret-Token igual a TELEGRAM_SECRETO.
- Apagado por defecto: sin TELEGRAM_ACTIVO=1 el webhook no hace nada.

Variables (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_SECRETO, TELEGRAM_ACTIVO, TELEGRAM_CREAR_ACTIVO, VOZ_URL, VOZ_TOKEN.
"""
import hmac
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app import effi_api
from app import pedido_effi as pe
from app import telegram_flujo as flujo

ESTADO_DIR = Path(os.getenv('TELEGRAM_ESTADO_DIR', '/data/state/telegram'))
VINCULOS = ESTADO_DIR / 'vinculos.json'
CODIGOS = ESTADO_DIR / 'codigos.json'
CHATS = ESTADO_DIR / 'chats.json'
VENCE_CODIGO_SEG = 600

router = APIRouter(prefix='/api/telegram', tags=['telegram'])


def _env(nombre: str, defecto: str = '') -> str:
    return (os.getenv(nombre) or defecto).strip()


def activo() -> bool:
    return _env('TELEGRAM_ACTIVO') == '1' and bool(_env('TELEGRAM_BOT_TOKEN'))


def crear_activo() -> bool:
    return _env('TELEGRAM_CREAR_ACTIVO') == '1'


def _leer(ruta: Path) -> dict:
    try:
        return json.loads(ruta.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _guardar(ruta: Path, datos: dict) -> None:
    ESTADO_DIR.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(ruta)


# ---------- vínculo cuenta de Telegram <-> usuario del panel
def usuario_vinculado(telegram_id) -> str:
    return (_leer(VINCULOS).get(str(telegram_id)) or {}).get('usuario', '')


def pedir_codigo(telegram_id, nombre: str) -> str:
    """Genera un código de 6 dígitos que un administrador escribe en el panel para vincular la cuenta."""
    codigos = {c: v for c, v in _leer(CODIGOS).items() if v.get('vence', 0) > time.time()}
    codigo = f'{random.randint(0, 999999):06d}'
    codigos[codigo] = {'telegram_id': str(telegram_id), 'nombre': nombre, 'vence': time.time() + VENCE_CODIGO_SEG}
    _guardar(CODIGOS, codigos)
    return codigo


def vincular(codigo: str, usuario: str) -> dict:
    """Lo llama el administrador desde el panel. Asocia la cuenta de Telegram que pidió el código con `usuario`."""
    codigos = _leer(CODIGOS)
    dato = codigos.get(str(codigo).strip())
    if not dato or dato.get('vence', 0) < time.time():
        raise HTTPException(400, 'El código no existe o ya venció. Pide uno nuevo con /start en el bot.')
    vinculos = _leer(VINCULOS)
    vinculos[dato['telegram_id']] = {'usuario': usuario, 'nombre': dato.get('nombre', '')}
    _guardar(VINCULOS, vinculos)
    codigos.pop(str(codigo).strip(), None)
    _guardar(CODIGOS, codigos)
    return {'ok': True, 'telegram_id': dato['telegram_id'], 'usuario': usuario}


# ---------- estado de la conversación por chat
def _estado_de(chat_id) -> dict | None:
    return (_leer(CHATS).get(str(chat_id)) or {}).get('estado')


def _guardar_estado(chat_id, estado: dict) -> None:
    chats = _leer(CHATS)
    chats[str(chat_id)] = {'estado': estado, 'actualizado': time.time()}
    _guardar(CHATS, chats)


# ---------- llamadas a Telegram
def _api(metodo: str, datos: dict | None = None) -> dict:
    url = f"https://api.telegram.org/bot{_env('TELEGRAM_BOT_TOKEN')}/{metodo}"
    cuerpo = urllib.parse.urlencode({k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in (datos or {}).items()}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=cuerpo), timeout=20) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as exc:  # noqa: BLE001 - no debe tumbar el webhook
        return {'ok': False, 'error': exc.__class__.__name__}


def enviar(chat_id, texto: str, teclado=None) -> None:
    datos = {'chat_id': chat_id, 'text': texto[:4000], 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if teclado:
        datos['reply_markup'] = {'inline_keyboard': teclado}
    _api('sendMessage', datos)


def _audio_a_texto(file_id: str) -> str:
    """Descarga la nota de voz de Telegram y la transcribe con el servicio de voz local."""
    info = _api('getFile', {'file_id': file_id})
    ruta = (info.get('result') or {}).get('file_path')
    if not ruta:
        return ''
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/file/bot{_env('TELEGRAM_BOT_TOKEN')}/{ruta}", timeout=30) as r:
            audio = r.read()
        frontera = '----voz' + str(random.randint(10**6, 10**7))
        cuerpo = (f'--{frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="nota.ogg"\r\nContent-Type: audio/ogg\r\n\r\n').encode() + audio + f'\r\n--{frontera}--\r\n'.encode()
        req = urllib.request.Request(_env('VOZ_URL', 'http://asistente-voz:8000') + '/transcribir', data=cuerpo, method='POST',
                                     headers={'Content-Type': f'multipart/form-data; boundary={frontera}', 'X-Voz-Token': _env('VOZ_TOKEN')})
        with urllib.request.urlopen(req, timeout=120) as r:
            return str(json.loads(r.read().decode('utf-8')).get('texto', '')).strip()
    except Exception:  # noqa: BLE001
        return ''


# ---------- búsquedas (inyectables para pruebas; en producción leen Effi y el panel)
def buscar_clientes(texto: str) -> list[str]:
    """Clientes de Effi cuyo nombre contiene el texto (solo lectura)."""
    q = ' '.join((texto or '').split())
    if len(q) < 3:
        return []
    pe._con_llave()
    filas = pe._effi(effi_api._lista, 'cliente', {'nombre': q})[:25]
    return [str(c.get('nombre') or '') for c in filas if c.get('tercero') and c.get('nombre')]


def buscar_referencias(cliente: str, texto: str) -> list[str]:
    """Referencias de Effi que empiezan por el texto (solo lectura)."""
    q = ' '.join((texto or '').split()).upper()
    if len(q) < 2:
        return []
    pe._con_llave()
    filas = pe._effi(effi_api._lista, 'articulo', {'referencia': q + '%'})
    return sorted({str(a.get('referencia') or '') for a in filas if a.get('referencia') and str(a.get('ventas', '1')) != '0'})[:25]


def _tercero(nombre: str) -> int:
    pe._con_llave()
    filas = [c for c in pe._effi(effi_api._lista, 'cliente', {'nombre': nombre})[:25]
             if c.get('tercero') and str(c.get('nombre') or '').strip().upper() == nombre.strip().upper()]
    if len(filas) != 1:
        raise ValueError(f'No encontré un único cliente llamado «{nombre}». Revísalo en Effi.')
    return int(filas[0]['tercero'])


def _articulo(referencia: str) -> tuple[int, float, str]:
    pe._con_llave()
    filas = [a for a in pe._effi(effi_api._lista, 'articulo', {'referencia': referencia}) if str(a.get('referencia') or '').upper() == referencia.upper()]
    if len(filas) != 1:
        raise ValueError(f'No encontré la referencia {referencia} en Effi.')
    precio = pe._precio_de(filas[0])
    if precio <= 0:
        raise ValueError(f'La referencia {referencia} no tiene precio de venta en Effi.')
    return int(filas[0]['id']), precio, str(filas[0].get('descripcion') or referencia)


def _forma_de_pago(cat: dict, pago: str) -> int:
    formas = cat['formas_pago']
    if 'contado' in pago.lower():
        f = next((x for x in formas if not x['credito'] and 'contado' in x['nombre'].lower()), None)
    else:
        dias = '60' if '60' in pago else '30'
        f = next((x for x in formas if x['credito'] and dias in x['nombre']), None)
    if not f:
        raise ValueError(f'No encontré la forma de pago «{pago}» en Effi.')
    return int(f['id'])


def crear_documento(estado: dict, usuario: str) -> str:
    """Arma el documento con las mismas reglas del panel (pedido_effi.construir) y lo crea en Effi.
    Sucursal y bodega: la primera vigente (o TELEGRAM_SUCURSAL / TELEGRAM_CENTRO_COSTOS). Fecha de entrega: 15 días."""
    from datetime import date, timedelta
    import uuid
    if not pe.activo():
        return 'La creación en Effi está frenada desde el servidor. Avisa a administración.'
    tipo = estado.get('tipo') or ''
    if tipo not in ('cotizacion', 'remision') or not estado.get('lineas') or not estado.get('cliente'):
        return 'Faltan datos del documento. Empieza de nuevo con /cotizar o /remision.'
    try:
        cat = pe._catalogos()
        suc_id = int(_env('TELEGRAM_SUCURSAL') or (cat['sucursales'][0]['id'] if cat['sucursales'] else 0))
        bodega = next((b for b in cat['bodegas'] if b['sucursal'] == suc_id), None)
        centro = int(_env('TELEGRAM_CENTRO_COSTOS') or (cat['centros'][0]['id'] if cat['centros'] else 0))
        if not bodega or not centro:
            return 'Falta configurar sucursal, bodega o centro de costos en Effi.'
        conceptos = []
        for l in estado['lineas']:
            aid, precio, desc = _articulo(l['referencia'])
            conceptos.append({'articulo': aid, 'cantidad': l['cantidad'], 'precio': precio, 'descuento': 0,
                              'descripcion': desc, 'observacion': f"Talla {l.get('talla', '')}".strip()})
        payload = {'tipo': tipo, 'clave': 'tg' + uuid.uuid4().hex, 'cliente': _tercero(estado['cliente']),
                   'sucursal': suc_id, 'bodega': int(bodega['id']), 'centro_costos': centro,
                   'fecha_entrega': (date.today() + timedelta(days=15)).isoformat(), 'divisa': 'COP',
                   'formas_pago': [{'id': _forma_de_pago(cat, estado.get('pago', 'Contado')), 'valor': ''}],
                   'conceptos': conceptos, 'observacion': f'Creada desde Telegram por {usuario}'}
        r = pe.construir(payload, usuario)
        if tipo == 'cotizacion':
            hecho = pe._effi(effi_api.crear_cotizacion, r['cuerpo'])
            nombre = 'Cotización'
        else:
            hecho = pe._effi(effi_api.crear_remision, r['cuerpo'])
            nombre = 'Remisión de venta'
        return f"✅ {nombre} creada en Effi: <b>{hecho.get('prefijo') or ''}{hecho['id']}</b>. Total ${r['resumen']['total']:,.0f}."
    except HTTPException as exc:
        return f'No se creó nada: {exc.detail}'
    except ValueError as exc:
        return f'No se creó nada: {exc}'


def procesar_mensaje(chat_id, usuario: str, texto: str | None = None, boton: str | None = None, voz_file_id: str | None = None) -> None:
    from app import permisos as permisos_mod   # import tardío para no ciclar con main
    if voz_file_id:
        transcrito = _audio_a_texto(voz_file_id)
        if not transcrito:
            enviar(chat_id, 'No pude entender la nota de voz. Intenta de nuevo o escribe el dato.')
            return
        estado = _estado_de(chat_id)
        entrada = flujo.interpretar_voz(estado, transcrito)
        enviar(chat_id, f'🎙️ Entendí: <i>{transcrito}</i>')
        texto = entrada
    entrada = boton if boton is not None else (texto or '')
    if entrada == 'crear':
        if not permisos_mod.comerciales_permitido(usuario):
            enviar(chat_id, 'Tu usuario no tiene permiso para crear cotizaciones o remisiones.')
            return
        if not crear_activo():
            enviar(chat_id, 'La creación desde Telegram está apagada por el administrador.')
            return
        estado = _estado_de(chat_id) or {}
        enviar(chat_id, crear_documento(estado, usuario))
        _guardar_estado(chat_id, flujo.inicio())
        return
    estado = _estado_de(chat_id)
    nuevo, respuesta, teclado = flujo.procesar(estado, entrada, buscar_clientes=buscar_clientes, buscar_referencias=buscar_referencias)
    _guardar_estado(chat_id, nuevo)
    enviar(chat_id, respuesta, teclado)


def manejar_update(update: dict) -> None:
    if 'callback_query' in update:
        cb = update['callback_query']
        chat_id = (cb.get('message') or {}).get('chat', {}).get('id')
        telegram_id = (cb.get('from') or {}).get('id')
        _api('answerCallbackQuery', {'callback_query_id': cb.get('id')})
        if not chat_id:
            return
        usuario = usuario_vinculado(telegram_id)
        if not usuario:
            enviar(chat_id, 'Tu cuenta no está vinculada. Escribe /start.')
            return
        procesar_mensaje(chat_id, usuario, boton=cb.get('data', ''))
        return
    msg = update.get('message') or {}
    chat_id = (msg.get('chat') or {}).get('id')
    telegram_id = (msg.get('from') or {}).get('id')
    if not chat_id:
        return
    texto = (msg.get('text') or '').strip()
    if texto.startswith('/start') or texto == '/vincular':
        if usuario_vinculado(telegram_id):
            enviar(chat_id, 'Tu cuenta ya está vinculada. Escribe /cotizar o /remision para empezar.')
        else:
            codigo = pedir_codigo(telegram_id, (msg.get('from') or {}).get('first_name', ''))
            enviar(chat_id, f'Para vincular tu cuenta, un administrador debe escribir este código en el panel:\n<b>{codigo}</b>\nVence en 10 minutos.')
        return
    usuario = usuario_vinculado(telegram_id)
    if not usuario:
        enviar(chat_id, 'Tu cuenta no está vinculada. Escribe /start para obtener un código.')
        return
    if msg.get('voice') or msg.get('audio'):
        procesar_mensaje(chat_id, usuario, voz_file_id=(msg.get('voice') or msg.get('audio'))['file_id'])
        return
    if texto:
        procesar_mensaje(chat_id, usuario, texto=texto)


@router.post('/webhook')
async def webhook(request: Request):
    # Telegram reintenta si no recibe 200: siempre respondemos 200 una vez validado el secreto.
    secreto = _env('TELEGRAM_SECRETO')
    cabecera = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
    if not secreto or not hmac.compare_digest(cabecera, secreto):
        raise HTTPException(403, 'Secreto inválido')
    if not activo():
        return JSONResponse({'ok': True, 'activo': False})
    try:
        update = await request.json()
        manejar_update(update)
    except Exception:  # noqa: BLE001
        pass
    return JSONResponse({'ok': True})


_autenticar = None   # función del panel que devuelve el usuario de la sesión
_es_admin = None     # función del panel que dice si el usuario es administrador


def configurar(autenticar, es_admin) -> None:
    global _autenticar, _es_admin
    _autenticar, _es_admin = autenticar, es_admin


@router.post('/vincular')
def vincular_desde_panel(request: Request, payload: dict):
    """Un administrador escribe aquí el código que le dio el comercial en Telegram."""
    usuario = _autenticar(request) if _autenticar else ''
    if not usuario or not (_es_admin and _es_admin(usuario)):
        raise HTTPException(403, 'Solo un administrador puede vincular cuentas de Telegram')
    return vincular(str(payload.get('codigo', '')), str(payload.get('usuario', '')).strip())


@router.get('/estado')
def estado_bot():
    return {'activo': activo(), 'creacion_activa': crear_activo(), 'token_configurado': bool(_env('TELEGRAM_BOT_TOKEN'))}
