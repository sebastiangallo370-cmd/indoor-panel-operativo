"""Bitácora: registro automático de los cambios que hacen los usuarios en el panel.

Un middleware ASGI mira cada petición que escribe (POST/PUT/PATCH/DELETE) hecha con una sesión válida
y, si terminó bien, guarda quién, cuándo, en qué módulo y qué cambió. No toca ninguna ruta existente y nunca
rompe una petición si falla. La consulta es SOLO para la cuenta «Indoor Sport».
"""
import json
import logging
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query

_connect: Callable = None          # función que abre la base (la registra main.py)
_usuario_de_sesion: Callable = None  # token de sesión -> usuario o None
_autenticar: Callable = None
_describir_fila: Callable = None   # fila de producción -> "ORDEN · cliente"
_ver = lambda usuario: False       # quién puede consultar la bitácora

RETENCION_DIAS = 365
MAX_CUERPO = 64 * 1024
METODOS = {'POST', 'PUT', 'PATCH', 'DELETE'}
# No son cambios de un usuario (sesión, sondeos, procesos del sistema, portal de clientes por token)
IGNORAR = re.compile(r'^/(login|logout|registro|api/agentes/pc|api/equipo|api/produccion/sheets-sync|api/produccion/backup|api/respaldos|api/terminos/aceptar|api/nas|api/bitacora)(/|$)')
SECRETOS = re.compile(r'pass|clave|contrase|token|secret|key', re.I)

# (método, patrón de ruta) -> (módulo, descripción)
ETIQUETAS = [
    ('POST', r'^/api/produccion/operacion$', 'Producción', 'Registró una operación de proceso'),
    ('PATCH', r'^/api/produccion/celda$', 'Producción', 'Cambió una celda de producción'),
    ('PUT', r'^/api/produccion/nota$', 'Producción', 'Guardó una nota en producción'),
    ('POST', r'^/api/produccion/orden$', 'Producción', 'Cambió el orden de las tarjetas'),
    ('POST', r'^/api/produccion/ordenar-entrega$', 'Producción', 'Ordenó por fecha de entrega'),
    ('DELETE', r'^/api/produccion/fila/\d+$', 'Producción', 'Eliminó una fila de producción'),
    ('PATCH', r'^/api/produccion/operaciones/evento/\d+$', 'Producción', 'Corrigió un evento de operario'),
    ('DELETE', r'^/api/produccion/operaciones/evento/\d+$', 'Producción', 'Borró un evento de operario'),
    ('PUT', r'^/api/proveedores-tela$', 'Estándar 2026', 'Eligió el proveedor de una tela'),
    ('POST', r'^/api/zeus/anular$', 'Agente inventario', 'Anuló una orden de compra en Effi'),
    ('POST', r'^/api/minimaximan/anular$', 'MINIMAXIMAN', 'Anuló una orden de compra en Effi'),
    ('POST', r'^/api/minimaximan/modificar$', 'MINIMAXIMAN', 'Modificó los metros de una orden de compra'),
    ('POST', r'^/api/minimaximan/enviar-proveedor$', 'MINIMAXIMAN', 'Aprobó y envió una orden de compra al proveedor'),
    ('POST', r'^/api/zeus/enviar-proveedor$', 'Agente inventario', 'Pidió enviar una orden de compra al correo del proveedor'),
    ('POST', r'^/api/memoria/corregir$', 'Memoria de agentes', 'Marcó un error de los agentes como corregido'),
    ('POST', r'^/api/memoria/reabrir$', 'Memoria de agentes', 'Reabrió un error de los agentes'),
    ('POST', r'^/api/memoria/ignorar$', 'Memoria de agentes', 'Ignoró un error de los agentes'),
    ('PUT', r'^/api/zeus/api/llave$', 'Agente inventario', 'Guardó la API key de Effi'),
    ('DELETE', r'^/api/zeus/api/llave$', 'Agente inventario', 'Quitó la API key de Effi'),
    ('PUT', r'^/api/zeus/api/ajustes$', 'Agente inventario', 'Cambió el descuento o las retenciones de las órdenes por API'),
    ('PUT', r'^/api/zeus/notificar$', 'Agente inventario', 'Cambió quién recibe la notificación de las órdenes de compra'),
    ('POST', r'^/api/zeus/correos$', 'Agente inventario', 'Agregó un correo para recibir las órdenes de compra (queda pendiente de confirmar)'),
    ('POST', r'^/api/zeus/correos/reenviar$', 'Agente inventario', 'Reenvió el mensaje de verificación de un correo'),
    ('DELETE', r'^/api/zeus/correos$', 'Agente inventario', 'Quitó un correo de las órdenes de compra'),
    ('POST', r'^/api/programar-pedido$', 'Pedidos', 'Programó un pedido'),
    ('POST', r'^/api/repetir-pedido$', 'Pedidos', 'Repitió un pedido'),
    ('POST', r'^/procesar(/pedido)?$', 'Pedidos', 'Procesó un pedido o reprogramación'),
    ('POST', r'^/crear-xlsx.*$', 'Pedidos', 'Creó un Excel de pedido'),
    ('POST', r'^/cargar-pdf$', 'Pedidos', 'Cargó un PDF'),
    ('POST', r'^/api/inventarios/movimientos?$', 'Inventarios', 'Registró un movimiento de inventario'),
    ('POST', r'^/api/inventarios/tela$', 'Inventarios', 'Creó una tela nueva'),
    ('POST', r'^/api/inventarios/documento$', 'Inventarios', 'Subió un documento de ingreso de tela'),
    ('PUT', r'^/api/inventarios/minimos.*$', 'Inventarios', 'Cambió los mínimos de stock'),
    ('POST', r'^/api/inventarios/bodegas(/asignar)?$', 'Inventarios', 'Cambió las bodegas'),
    ('POST', r'^/api/cartera/comprobantes$', 'Cartera', 'Registró un comprobante'),
    ('POST', r'^/api/cartera/comprobantes/.+/anular$', 'Cartera', 'Anuló un comprobante'),
    ('POST', r'^/api/cartera/sincronizar$', 'Cartera', 'Sincronizó la cartera'),
    ('POST', r'^/api/cartera/pdf/.+$', 'Cartera', 'Subió el PDF de una cotización'),
    ('POST', r'^/api/cartera/vinculo$', 'Cartera', 'Vinculó una cotización'),
    ('POST', r'^/api/cartera/documentos$', 'Cartera', 'Registró un documento'),
    ('DELETE', r'^/api/cartera/documentos/.+$', 'Cartera', 'Eliminó un documento'),
    ('POST', r'^/api/agentes/(mensaje|orden)$', 'Agentes', 'Envió una orden o mensaje a un agente'),
    ('POST', r'^/api/agentes/.*$', 'Agentes', 'Cambió la configuración de agentes'),
    ('PUT', r'^/api/agentes/.*$', 'Agentes', 'Cambió la configuración de agentes'),
    ('DELETE', r'^/api/agentes/.*$', 'Agentes', 'Eliminó algo de agentes'),
    ('POST', r'^/api/promedios/maestro$', 'Estándar 2026', 'Guardó un maestro de promedios'),
    ('DELETE', r'^/api/promedios/maestro/.+$', 'Estándar 2026', 'Eliminó un maestro de promedios'),
    ('POST', r'^/api/promedios/.*$', 'Estándar 2026', 'Cambió promedios'),
    ('POST', r'^/api/fichas/.*$', 'Estándar 2026', 'Cambió fichas técnicas'),
    ('PUT', r'^/api/lineas-producto$', 'Líneas de producto', 'Editó las líneas de producto'),
    ('POST', r'^/api/lineas-producto/mockup/.+$', 'Líneas de producto', 'Subió un mockup de línea'),
    ('DELETE', r'^/api/lineas-producto/mockup/.+$', 'Líneas de producto', 'Quitó un mockup de línea'),
    ('POST', r'^/api/estudio/.+$', 'Estudio', 'Cambió el estudio de una orden'),
    ('DELETE', r'^/api/estudio/.+$', 'Estudio', 'Quitó el enlace del estudio'),
    ('POST', r'^/api/ecommerce/agentes/.+$', 'Ecommerce', 'Dio una orden a un agente de ECOMMERCE (iniciar / detener / reiniciar)'),
    ('POST', r'^/api/ecommerce/conexion/regenerar$', 'Ecommerce', 'Generó un código nuevo para enlazar el PC de ECOMMERCE'),
    ('POST', r'^/api/reposiciones.*$', 'Reposiciones', 'Cambió reposiciones'),
    ('POST', r'^/api/club/enlaces$', 'Tienda club', 'Generó un enlace de club'),
    ('DELETE', r'^/api/club/enlaces/\d+$', 'Tienda club', 'Revocó un enlace de club'),
    ('POST', r'^/api/club/pedidos/\d+/resolver$', 'Tienda club', 'Resolvió una reposición de club'),
    ('POST', r'^/api/molderia.*$', 'Moldería', 'Cambió algo de moldería'),
    ('POST', r'^/api/rhumano/.+$', 'Recursos humanos', 'Generó un documento de RR. HH.'),
    ('POST', r'^/api/terminos(/publicar)?$', 'Términos', 'Publicó los términos y condiciones'),
    ('POST', r'^/api/cuenta/nombre$', 'Cuenta', 'Cambió su nombre de cuenta'),
    ('POST', r'^/api/cuenta/password$', 'Cuenta', 'Cambió su contraseña'),
    ('POST|DELETE', r'^/api/perfil/foto$', 'Cuenta', 'Cambió su foto de perfil'),
    ('POST|PUT|DELETE', r'^/api/notas-personales.*$', 'Notas personales', 'Cambió una nota personal'),
    ('PUT|POST', r'^/api/permisos.*$', 'Permisos', 'Cambió permisos'),
    ('POST', r'^/api/disenos.*$', 'Diseños', 'Cambió versiones de diseño'),
]
ETIQUETAS = [(set(m.split('|')), re.compile(p), mod, texto) for m, p, mod, texto in ETIQUETAS]
CAMPOS = ('order', 'orden', 'cliente', 'client', 'process', 'proceso', 'action', 'accion', 'reason', 'motivo', 'note', 'nota',
          'tela', 'nombre', 'name', 'mts', 'cantidad', 'value', 'valor', 'referencia', 'estado', 'tipo', 'column', 'row', 'source_row')


@contextmanager
def _db():
    conexion = _connect()
    try:
        yield conexion
        conexion.commit()
    finally:
        conexion.close()


def configurar(connect, usuario_de_sesion, autenticar, describir_fila, ver):
    global _connect, _usuario_de_sesion, _autenticar, _describir_fila, _ver
    _connect, _usuario_de_sesion, _autenticar, _describir_fila, _ver = connect, usuario_de_sesion, autenticar, describir_fila, ver
    with _db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS bitacora (
            id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, username TEXT NOT NULL, modulo TEXT NOT NULL,
            accion TEXT NOT NULL, detalle TEXT NOT NULL DEFAULT '', method TEXT, path TEXT, status INTEGER, ip TEXT)""")
        db.execute('CREATE INDEX IF NOT EXISTS ix_bitacora_at ON bitacora(at)')
        db.execute('CREATE INDEX IF NOT EXISTS ix_bitacora_user ON bitacora(username, at)')
        limite = (datetime.now(timezone.utc) - timedelta(days=RETENCION_DIAS)).isoformat()
        db.execute('DELETE FROM bitacora WHERE at < ?', (limite,))


def _etiqueta(metodo: str, ruta: str):
    for metodos, patron, modulo, texto in ETIQUETAS:
        if metodo in metodos and patron.match(ruta):
            return modulo, texto
    partes = [p for p in ruta.split('/') if p and p != 'api']
    return (partes[0].capitalize() if partes else 'Panel'), f'{metodo} {ruta}'


def _detalle(ruta: str, cuerpo: bytes) -> str:
    piezas = []
    m = re.search(r'/fila/(\d+)', ruta)
    filas = [int(m.group(1))] if m else []
    try:
        datos = json.loads(cuerpo.decode('utf-8')) if cuerpo else None
    except Exception:
        datos = None
    if isinstance(datos, dict):
        for k in CAMPOS:
            v = datos.get(k)
            if v in (None, '') or SECRETOS.search(k) or isinstance(v, (dict, list)):
                continue
            if k in ('row', 'source_row'):
                try:
                    filas.append(int(v))
                except (TypeError, ValueError):
                    pass
                continue
            piezas.append(f'{k}: {str(v)[:80]}')
    if filas and _describir_fila:
        try:
            nombre = _describir_fila(filas[0])
            if nombre:
                piezas.insert(0, nombre)
        except Exception:
            pass
    return ' · '.join(piezas)[:400]


def _guardar(usuario, metodo, ruta, status, cuerpo, ip):
    try:
        modulo, accion = _etiqueta(metodo, ruta)
        detalle = '' if modulo == 'Cuenta' else _detalle(ruta, cuerpo)
        with _db() as db:
            db.execute('INSERT INTO bitacora(at,username,modulo,accion,detalle,method,path,status,ip) VALUES (?,?,?,?,?,?,?,?,?)',
                       (datetime.now(timezone.utc).isoformat(), usuario, modulo, accion, detalle, metodo, ruta[:200], status, ip))
    except Exception:
        logging.exception('bitácora: no se pudo guardar')


class BitacoraMiddleware:
    """ASGI puro: copia el cuerpo JSON y el estado de la respuesta sin alterar la petición."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in METODOS or IGNORAR.match(scope['path']) or _usuario_de_sesion is None:
            return await self.app(scope, receive, send)
        headers = {k.decode('latin-1').lower(): v.decode('latin-1') for k, v in scope.get('headers', [])}
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get('cookie', ''))
        except Exception:
            pass
        token = cookie['indoor_session'].value if 'indoor_session' in cookie else ''
        usuario = _usuario_de_sesion(token) if token else None
        if not usuario:
            return await self.app(scope, receive, send)
        guardar_cuerpo = 'json' in headers.get('content-type', '') and scope['path'] != '/api/cuenta/password'
        buffer, estado = bytearray(), {'status': 0}

        async def recibir():
            mensaje = await receive()
            if guardar_cuerpo and mensaje['type'] == 'http.request' and len(buffer) < MAX_CUERPO:
                buffer.extend(mensaje.get('body', b'')[:MAX_CUERPO - len(buffer)])
            return mensaje

        async def enviar(mensaje):
            if mensaje['type'] == 'http.response.start':
                estado['status'] = mensaje['status']
            await send(mensaje)

        try:
            await self.app(scope, recibir, enviar)
        finally:
            if 0 < estado['status'] < 400:
                ip = headers.get('x-forwarded-for', '').split(',')[0].strip() or (scope.get('client') or ['', 0])[0]
                threading.Thread(target=_guardar, args=(usuario, scope['method'], scope['path'], estado['status'], bytes(buffer), ip), daemon=True).start()


def montar(app, autenticar):
    """Registra las rutas de consulta (solo para quien pase _ver)."""
    def comprobar(usuario=Depends(autenticar)):
        if not _ver(str(usuario)):
            raise HTTPException(403, 'La bitácora no está disponible para tu cuenta')
        return usuario

    r = APIRouter(prefix='/api/bitacora', tags=['bitacora'])

    @r.get('/mi')
    def mi(usuario=Depends(autenticar)):
        if not _ver(str(usuario)):
            raise HTTPException(403, 'Sin acceso')
        return {'ok': True}

    @r.get('')
    def listar(usuario: str = '', modulo: str = '', desde: str = '', hasta: str = '', q: str = '',
               antes: int = 0, limite: int = Query(100, ge=1, le=300), _=Depends(comprobar)):
        donde, args = [], []
        if usuario:
            donde.append('username = ? COLLATE NOCASE'); args.append(usuario)
        if modulo:
            donde.append('modulo = ?'); args.append(modulo)
        # las fechas llegan como día de Colombia (UTC-5)
        try:
            if desde:
                donde.append('at >= ?'); args.append((datetime.fromisoformat(desde) + timedelta(hours=5)).replace(tzinfo=timezone.utc).isoformat())
            if hasta:
                donde.append('at < ?'); args.append((datetime.fromisoformat(hasta) + timedelta(days=1, hours=5)).replace(tzinfo=timezone.utc).isoformat())
        except ValueError:
            raise HTTPException(400, 'Fecha no válida')
        if q:
            donde.append('(accion LIKE ? OR detalle LIKE ? OR username LIKE ?)'); args += [f'%{q}%'] * 3
        if antes:
            donde.append('id < ?'); args.append(antes)
        sql = 'SELECT id,at,username,modulo,accion,detalle FROM bitacora' + (' WHERE ' + ' AND '.join(donde) if donde else '') + ' ORDER BY id DESC LIMIT ?'
        with _db() as db:
            filas = [dict(f) for f in db.execute(sql, args + [limite + 1])]
            hoy = (datetime.now(timezone.utc) - timedelta(hours=5)).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=5)
            hoy_iso = hoy.replace(tzinfo=timezone.utc).isoformat()
            cambios_hoy, usuarios_hoy = db.execute('SELECT COUNT(*), COUNT(DISTINCT username) FROM bitacora WHERE at >= ?', (hoy_iso,)).fetchone()
            usuarios = [f[0] for f in db.execute('SELECT DISTINCT username FROM bitacora ORDER BY username COLLATE NOCASE')]
            modulos = [f[0] for f in db.execute('SELECT DISTINCT modulo FROM bitacora ORDER BY modulo')]
        return {'items': filas[:limite], 'hay_mas': len(filas) > limite, 'cambios_hoy': cambios_hoy,
                'usuarios_hoy': usuarios_hoy, 'usuarios': usuarios, 'modulos': modulos}

    app.include_router(r)
