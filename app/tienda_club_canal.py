"""AGENTES TIENDA CLUB: control web de los agentes que atienden las reprogramaciones de la tienda del club una vez el comercial las APRUEBA.

Es el mismo esquema que ECOMMERCE (panel + puente en el PC + token + interruptor) pero totalmente independiente: otros agentes, otra cola, otro token,
otros archivos y ninguna relación con ALMA/BRISA/CIRO ni con los agentes de edición.
  NOVA     recibe la reprogramación aprobada y la valida (cotización de EFFITRON lista, PDF, líneas válidas, sin duplicar)
  BRUJULA  prepara el paquete: PDF de la cotización, listado en un solo libro y mockups del pedido anterior
  SELLO    programa el pedido en Producción (en modo prueba solo verifica y deja «lista»; no escribe en Producción hasta que se active «programar de verdad»)
Los agentes corren en el PC de la oficina; el PC pregunta cada pocos segundos (sondeo saliente) y, en cada vuelta, le pide al panel que haga el siguiente paso de su
rol (`/pc/paso`). El panel guarda la cola y hace el trabajo contra la NAS y Producción. Nunca pone EDICIÓN en proceso: los agentes de edición no se enteran.
Datos en /data/state/tienda_club.json y el token del PC en /data/state/tienda_club_token.txt.
"""
import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from app import memoria_agentes
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

router = APIRouter(prefix='/api/tienda-club-agentes', tags=['tienda-club-agentes'])            # personas (con sesión)
pc_router = APIRouter(prefix='/api/tienda-club-agentes/pc', tags=['tienda-club-agentes-pc'])   # el PC con los agentes (con token)
_file = Path(os.getenv('TIENDA_CLUB_FILE', '/data/state/tienda_club.json'))
_token_file = Path(os.getenv('TIENDA_CLUB_TOKEN_FILE', '/data/state/tienda_club_token.txt'))
_lock = threading.Lock()
LATIDO_SEG = 25
MAX_LOG = 1500
MAX_ORDENES = 120
ORDEN_VENCE_SEG = 120
MAX_INTENTOS = 3
_auth: Callable = lambda request: None
_permitido: Callable[[str], bool] = lambda usuario: False

AGENTES = [
    {'id': 'nova', 'nombre': 'NOVA', 'titulo': 'Recibe y valida', 'rol': 'recibe', 'color': '#8bd450', 'paso': 1,
     'funciones': ['Toma cada reprogramación que el comercial aprueba en la tienda del club',
                   'Comprueba que EFFITRON ya dejó la cotización lista (número y PDF) y que cada referencia tiene su línea de producto',
                   'Revisa que la cotización no esté ya programada en Producción ni tenga carpeta en la NAS']},
    {'id': 'brujula', 'nombre': 'BRUJULA', 'titulo': 'Prepara el paquete', 'rol': 'prepara', 'color': '#6cb6ff', 'paso': 2,
     'funciones': ['Arma el listado de la reprogramación en un solo libro (una hoja por referencia)',
                   'Copia los mockups del pedido anterior de cada referencia',
                   'Deja el PDF de la cotización, el listado y los mockups listos para programar']},
    {'id': 'sello', 'nombre': 'SELLO', 'titulo': 'Programa en Producción', 'rol': 'programa', 'color': '#ffb04a', 'paso': 3,
     'funciones': ['Registra la reprogramación en Producción con la línea de cada referencia (sin poner EDICIÓN en proceso)',
                   'En modo prueba solo verifica todo y la deja «lista»; no escribe en Producción',
                   'Si Producción la rechaza, queda «con avisos» con el motivo']},
]
POR_ID = {a['id']: a for a in AGENTES}
POR_ROL = {a['rol']: a for a in AGENTES}
ACCIONES = ('iniciar', 'detener', 'reiniciar')
ESTADOS_ACTIVOS = ('CORRIENDO', 'EN_FILA')
ETAPAS_COLA = ('aprobadas', 'validadas', 'preparadas', 'programadas', 'errores')
ETAPA_DE = {'aprobada': 'aprobadas', 'validada': 'validadas', 'preparada': 'preparadas', 'programando': 'preparadas', 'programada': 'programadas', 'error': 'errores'}
# etapa del pedido que atiende cada rol
SIGUIENTE = {'recibe': 'aprobada', 'prepara': 'validada', 'programa': 'preparada'}

# lo conecta main.py (así este módulo se prueba sin la NAS ni Producción)
_pedido: Callable[[int], dict] = lambda pid: {}
_cotizacion_pdf: Callable[[int], bytes | None] = lambda pid: None
_excel_unico: Callable[[dict], bytes] = lambda p: b''
_imagenes: Callable[[int], list] = lambda row: []          # rutas de imágenes del pedido anterior de esa fila de Producción
_ya_programada: Callable[[str, str], str] = lambda orden, hash_: ''   # motivo si ya existe, '' si está libre
_programar: Callable[..., int] = lambda *a, **k: 0
_estado_job: Callable[[int], tuple] = lambda jid: ('', '')
_linea_de: Callable[[int], str] = lambda row: ''
_carpeta_trabajo: Callable[[], Path] = lambda: Path('/tmp')
_lanzar_edicion: Callable[[dict], tuple[bool, str]] = lambda ped: (False, 'No se configuró el lanzamiento de EDICIÓN')


def configurar(autenticar: Callable, permitido: Callable[[str], bool], **funciones) -> None:
    global _auth, _permitido
    _auth, _permitido = autenticar, permitido
    for nombre, f in funciones.items():
        globals()['_' + nombre] = f


def _ahora() -> float:
    return time.time()


def _iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0).isoformat()


def _leer() -> dict:
    try:
        datos = json.loads(_file.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = {}
    datos.setdefault('seq', 0)
    datos.setdefault('latido', {})
    datos.setdefault('agentes', {})
    datos.setdefault('ordenes', [])
    datos.setdefault('log', [])
    datos.setdefault('latidos', {})
    datos.setdefault('pedidos', {})     # id del pedido del club -> su avance por los 3 agentes
    datos.setdefault('historial', [])
    datos.setdefault('configuracion', {})
    datos['configuracion'].setdefault('tienda_club_activo', False)
    datos['configuracion'].setdefault('programar_de_verdad', False)
    return datos


def _guardar(datos: dict) -> None:
    datos['log'] = datos['log'][-MAX_LOG:]
    datos['ordenes'] = datos['ordenes'][-MAX_ORDENES:]
    datos['historial'] = datos['historial'][-300:]
    if len(datos['pedidos']) > 400:
        for k in sorted(datos['pedidos'], key=int)[:-400]:
            datos['pedidos'].pop(k, None)
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
        raise HTTPException(403, 'AGENTES TIENDA CLUB solo está disponible para Administración / Coordinación')
    return str(usuario)


def _pc(request: Request) -> None:
    recibido = request.headers.get('x-tiendaclub-token', '')
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


def _pendiente_de(datos: dict, agente: str) -> bool:
    return any(o['estado'] in ('pendiente', 'entregada') and o['agente'] == agente for o in datos['ordenes'])


def _nota(datos: dict, agente: str, nivel: str, texto: str) -> None:
    datos['seq'] += 1
    datos['log'].append({'id': datos['seq'], 'at': _ahora(), 'agente': agente, 'nivel': nivel, 'texto': str(texto)[:600]})
    if nivel == 'error':
        memoria_agentes.registrar(agente, str(texto), 'ERROR')


def _evento(p: dict, agente: str, texto: str) -> None:
    p.setdefault('eventos', []).append({'at': _iso(), 'agente': agente, 'texto': str(texto)[:200]})
    del p['eventos'][:-20]


# ------------------------------------------------------------------ la reprogramación aprobada entra a la cola
def encolar(pedido_id: int, por: str = '') -> None:
    """Lo llama club.resolver_pedido al APROBAR. Siempre se anota (aunque los agentes estén apagados); los agentes solo la toman si están activos."""
    try:
        with _lock:
            datos = _leer()
            if str(pedido_id) in datos['pedidos']:
                return
            p = _pedido(pedido_id)
            datos['pedidos'][str(pedido_id)] = {'id': int(pedido_id), 'numero': str(p.get('cot_numero') or ''), 'cliente': str(p.get('cliente') or '')[:60],
                                                'etapa': 'aprobada', 'detalle': 'Aprobada por ' + (por or 'Comercial'), 'intentos': 0, 'por': por,
                                                'creado': _iso(), 'actualizado': _iso(), 'eventos': []}
            _nota(datos, 'nova', 'info', f'Reprogramación #{pedido_id} aprobada por {por or "Comercial"}: entra a la cola')
            _guardar(datos)
    except Exception:   # noqa: BLE001  (nunca debe impedir que el comercial apruebe)
        pass


def _orden_de(p: dict) -> str:
    return 'CO' + str(p.get('cot_numero') or p.get('cot_id') or '').strip()


# ------------------------------------------------------------------ los tres pasos (los pide el PC y los hace el panel)
def _paso_recibe(ped: dict) -> tuple[bool, str]:
    p = _pedido(ped['id'])
    if not p.get('cot_numero') or p.get('cot_estado') not in ('lista', 'sin_pdf'):
        return False, 'ESPERA: la cotización de EFFITRON todavía no está lista'
    pdf = _cotizacion_pdf(ped['id'])
    if not pdf:
        return False, 'ESPERA: la cotización existe pero su PDF todavía no está guardado'
    sin_linea = [l.get('referencia', '?') for l in p['lineas'] if not (l.get('linea') or _linea_de(l['row']))]
    if sin_linea:
        raise ValueError('Falta la línea de producto de: ' + ', '.join(sin_linea) + '. Corrígela en la tarjeta del pedido anterior.')
    motivo = _ya_programada(_orden_de(p), hashlib.sha256(pdf).hexdigest())
    if motivo:
        raise ValueError(motivo)
    ped['numero'] = str(p['cot_numero'])
    return True, f'Cotización {ped["numero"]} lista y válida ({len(p["lineas"])} referencia(s))'


def _paso_prepara(ped: dict) -> tuple[bool, str]:
    p = _pedido(ped['id'])
    pdf = _cotizacion_pdf(ped['id'])
    if not pdf:
        raise ValueError('El PDF de la cotización ya no está disponible')
    orden = _orden_de(p)
    carpeta = _carpeta_trabajo() / f'club-{ped["id"]}-{int(_ahora())}'
    carpeta.mkdir(parents=True, exist_ok=False)
    try:
        import re
        cli = re.sub(r'[^A-Za-z0-9]+', '_', str(p['cliente']))[:40]
        (carpeta / f'{orden}_{cli}.pdf').write_bytes(pdf)
        (carpeta / f'{orden}_LISTADO.xlsm').write_bytes(_excel_unico(p))
        copiadas = 0
        for l in p['lineas']:
            imagenes = list(_imagenes(l['row']))
            if not imagenes:
                raise ValueError(f"No encontré el mockup de {l.get('referencia')} en el pedido anterior ({l.get('orden_base')})")
            for src in imagenes:
                destino = carpeta / Path(src).name
                if destino.exists():
                    destino = carpeta / f'{copiadas}_{Path(src).name}'
                destino.write_bytes(Path(src).read_bytes())
                copiadas += 1
    except Exception:
        import shutil
        shutil.rmtree(carpeta, ignore_errors=True)
        raise
    ped['carpeta'] = str(carpeta)
    return True, f'Paquete listo: PDF, listado y {copiadas} mockup(s)'


def _paso_programa(ped: dict, de_verdad: bool) -> tuple[bool, str]:
    if ped['etapa'] == 'programando':   # ya se envió a Producción: se revisa cómo va
        estado, detalle = _estado_job(int(ped.get('job') or 0))
        if estado == 'COMPLETADO':
            try:
                lanzada, detalle_edicion = _lanzar_edicion(ped)
            except Exception as exc:  # nunca duplicar la programación; se reintenta solo el enlace de PDFs
                return False, 'ESPERA: Producción ya fue programada, pero no pude abrir EDICIÓN: ' + str(exc)[:160]
            if not lanzada:
                return False, 'ESPERA: Producción ya fue programada, pero EDICIÓN sigue pendiente: ' + str(detalle_edicion)[:160]
            ped['edicion_lanzada'] = True
            ped['edicion_detalle'] = detalle_edicion
            return True, 'Programada en Producción: ' + str(detalle)[:120] + '. ' + detalle_edicion
        if estado in ('ERROR', 'REVISAR'):
            raise ValueError('Producción no la programó: ' + str(detalle)[:200])
        return False, 'ESPERA: Producción la está procesando'
    if not de_verdad:
        ped['prueba'] = True
        return False, 'PRUEBA: todo verificado, lista para programar (activa «programar de verdad» para registrarla)'
    p = _pedido(ped['id'])
    carpeta = Path(ped['carpeta'])
    archivos = sorted(carpeta.iterdir())
    pdf = next(f for f in archivos if f.suffix.lower() == '.pdf')
    excel = next(f for f in archivos if f.suffix.lower() == '.xlsm')
    linea = (p['lineas'][0].get('linea') or _linea_de(p['lineas'][0]['row']))
    ped['job'] = _programar(carpeta, pdf, excel, f'Reprogramación de club #{ped["id"]} aprobada por {ped.get("por") or "Comercial"}', 'AGENTES TIENDA CLUB', linea)
    ped['etapa'] = 'programando'
    return False, 'Enviada a Producción: esperando que termine'


def hacer_paso(rol: str) -> dict:
    """El PC pide el siguiente paso de su rol. Devuelve {'hubo': bool, 'pedido': id, 'ok': bool, 'detalle': str}."""
    if rol not in POR_ROL:
        raise HTTPException(404, 'Rol desconocido')
    agente = POR_ROL[rol]
    with _lock:
        datos = _leer()
        if not datos['configuracion']['tienda_club_activo']:
            return {'hubo': False, 'detalle': 'AGENTES TIENDA CLUB desactivados desde el panel'}
        etapa_buscada = SIGUIENTE[rol]
        candidatos = [p for p in datos['pedidos'].values() if p['etapa'] == etapa_buscada or (rol == 'programa' and p['etapa'] == 'programando')]
        ahora = _ahora()
        candidatos = [p for p in candidatos if ahora >= float(p.get('reintentar_a') or 0)]
        if not candidatos:
            return {'hubo': False, 'detalle': 'Sin pedidos para ' + agente['nombre']}
        ped = sorted(candidatos, key=lambda p: p['id'])[0]
        etiqueta = f'Reprogramación #{ped["id"]}'
        try:
            if rol == 'recibe':
                avanza, detalle = _paso_recibe(ped)
            elif rol == 'prepara':
                avanza, detalle = _paso_prepara(ped)
            else:
                avanza, detalle = _paso_programa(ped, bool(datos['configuracion']['programar_de_verdad']))
            ped['detalle'] = detalle
            if avanza:
                ped['etapa'] = {'recibe': 'validada', 'prepara': 'preparada', 'programa': 'programada'}[rol]
                ped['intentos'] = 0
                _evento(ped, agente['nombre'], detalle)
                _nota(datos, agente['id'], 'info', f'{etiqueta}: {detalle}')
                if ped['etapa'] == 'programada':
                    datos['historial'].append({'numero': ped.get('numero', ''), 'cliente': ped['cliente'], 'etapa': 'terminadas', 'at': _iso(), 'seg': None, 'avisos': []})
            else:
                ped['reintentar_a'] = _ahora() + (60 if detalle.startswith(('ESPERA', 'PRUEBA')) else 15)
            ok = True
        except Exception as e:   # noqa: BLE001
            ped['intentos'] = int(ped.get('intentos') or 0) + 1
            detalle = str(e)[:240]
            ped['detalle'] = detalle
            ok = False
            _nota(datos, agente['id'], 'error', f'{etiqueta}: {detalle}')
            if ped['intentos'] >= MAX_INTENTOS or isinstance(e, ValueError):
                ped['etapa'] = 'error'   # con avisos: se corrige y se reintenta desde el panel
                _evento(ped, agente['nombre'], 'Con avisos: ' + detalle)
            else:
                ped['reintentar_a'] = _ahora() + 20
        ped['actualizado'] = _iso()
        _guardar(datos)
    return {'hubo': True, 'pedido': ped['id'], 'ok': ok, 'detalle': detalle}


# ------------------------------------------------------------------ personas
@router.get('/mi')
def mi_acceso(request: Request):
    _usuario(request)
    return {'ok': True}


def _hoy_iso() -> str:
    return datetime.now(timezone(timedelta(hours=-5))).date().isoformat()


def _cola(datos: dict) -> dict:
    c = {e: 0 for e in ETAPAS_COLA}
    for p in datos['pedidos'].values():
        c[ETAPA_DE.get(p['etapa'], 'errores')] += 1
    return c


def _hoy(datos: dict) -> dict:
    hoy = _hoy_iso()
    de_hoy = [h for h in datos.get('historial', []) if str(h.get('at', ''))[:10] == hoy]
    return {'terminadas': len([h for h in de_hoy if h.get('etapa') == 'terminadas']), 'avisos': len([p for p in datos['pedidos'].values() if p['etapa'] == 'error']),
            'promedio_seg': None}


def _latidos_vivos(datos: dict) -> dict:
    transcurrido = _ahora() - float((datos.get('latido') or {}).get('at') or 0)
    return {aid: {**d, 'proxima_en': (d['proxima_en'] - round(transcurrido)) if d.get('proxima_en') is not None else None,
                  'ultima_hace': (d['ultima_hace'] + round(transcurrido)) if d.get('ultima_hace') is not None else None}
            for aid, d in (datos.get('latidos') or {}).items()}


def _trabajos(datos: dict) -> list:
    sal = []
    for p in sorted(datos['pedidos'].values(), key=lambda x: x['id'], reverse=True)[:60]:
        etapa = ETAPA_DE.get(p['etapa'], 'errores')
        sal.append({'numero': str(p['id']), 'cotizacion': p.get('numero', ''), 'etapa': etapa, 'cliente': p['cliente'], 'resultado': p.get('detalle', ''),
                    'avisos': [p['detalle']] if p['etapa'] == 'error' else [], 'intentos': p.get('intentos', 0), 'eventos': (p.get('eventos') or [])[-10:],
                    'prueba': bool(p.get('prueba')), 'modificada': p.get('actualizado', ''), 'descargada': p.get('creado', '')})
    return sal


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
                'cola': _cola(datos), 'ultimo_log': datos['seq'], 'latidos': _latidos_vivos(datos), 'trabajos': _trabajos(datos), 'hoy': _hoy(datos),
                'historial': datos['historial'][-40:][::-1],
                'configuracion': {'tienda_club_activo': bool(datos['configuracion']['tienda_club_activo']), 'programar_de_verdad': bool(datos['configuracion']['programar_de_verdad'])}}


@router.post('/configuracion/{clave}')
def configurar_interruptor(request: Request, clave: str, payload: dict):
    """Interruptores: «activar» (los agentes procesan la cola) y «programar» (SELLO escribe de verdad en Producción; apagado solo verifica)."""
    usuario = _usuario(request)
    campo = {'activar': 'tienda_club_activo', 'programar': 'programar_de_verdad'}.get(clave)
    activo = payload.get('activo')
    if not campo:
        raise HTTPException(404, 'Interruptor desconocido')
    if not isinstance(activo, bool):
        raise HTTPException(422, '«activo» debe ser verdadero o falso')
    with _lock:
        datos = _leer()
        if datos['configuracion'][campo] != activo:
            datos['configuracion'][campo] = activo
            if campo == 'programar_de_verdad' and activo:   # los que quedaron «en prueba» vuelven a intentarse ya
                for p in datos['pedidos'].values():
                    p.pop('reintentar_a', None)
                    p.pop('prueba', None)
            _nota(datos, 'sello' if campo == 'programar_de_verdad' else 'nova', 'info',
                  f'{usuario} ' + ('activó' if activo else 'desactivó') + (' «programar de verdad»: SELLO registra en Producción' if campo == 'programar_de_verdad' else ' AGENTES TIENDA CLUB'))
            _guardar(datos)
    return {'ok': True, campo: activo}


@router.post('/pedidos/{pedido_id}/reintentar')
def reintentar(request: Request, pedido_id: int):
    """Un pedido «con avisos» vuelve a empezar desde NOVA (ya corregido lo que faltaba)."""
    usuario = _usuario(request)
    with _lock:
        datos = _leer()
        p = datos['pedidos'].get(str(pedido_id))
        if not p:
            raise HTTPException(404, 'Ese pedido no está en la cola')
        if p['etapa'] != 'error':
            raise HTTPException(409, 'Solo se reintentan los pedidos con avisos')
        p.update(etapa='aprobada', intentos=0, detalle='Reintento pedido por ' + usuario)
        p.pop('reintentar_a', None)
        _nota(datos, 'nova', 'info', f'{usuario} reintenta la reprogramación #{pedido_id}')
        _guardar(datos)
    return {'ok': True}


CODIGO_PC = Path(__file__).resolve().parent / 'pc_tienda_club'   # copia del código de los agentes del PC (tienda_club_pc/*.py); la prueba exige que sea idéntica
NAS_CODIGO = Path(os.getenv('TIENDA_CLUB_NAS_CODIGO', '/mnt/nas/DIRECCION PRODUCCION/CARPETAS PERSONALES/GALLO/AGENTES_INDOOR/codigo/tienda_club'))


def publicar_en_nas() -> list[str]:
    """Copia el código de TIENDA CLUB a su carpeta en la NAS (de donde lo bajan los PC). Solo escribe en esa carpeta si ya existe y guarda antes una copia
    del archivo anterior en _prev. Devuelve los archivos que cambiaron."""
    if not NAS_CODIGO.is_dir():
        raise HTTPException(503, 'No encuentro la carpeta de TIENDA CLUB en la NAS (¿la NAS está conectada?)')
    prev = NAS_CODIGO / '_prev'
    cambiados = []
    for f in sorted(CODIGO_PC.glob('*.py')):
        nuevo = f.read_bytes()
        destino = NAS_CODIGO / f.name
        if destino.is_file() and destino.read_bytes() == nuevo:
            continue
        if destino.is_file():
            prev.mkdir(exist_ok=True)
            (prev / f.name).write_bytes(destino.read_bytes())
        destino.write_bytes(nuevo)
        cambiados.append(f.name)
    return cambiados


PANEL_URL = os.getenv('PANEL_URL_PUBLICA', 'https://produccion.cloud')


def _nombre_archivo_equipo(equipo: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]', '_', str(equipo or ''))[:60]


@router.get('/instalar-todo/opciones')
def instalar_todo_opciones(request: Request):
    """Para el formulario de «Instalar todo»: si ya hay un PC enlazado solo se actualiza; si no, se elige en cuál PC de los agentes de edición instalar."""
    _usuario(request)
    from app import agentes_canal
    with _lock:
        datos = _leer()
        conectado = _conectado(datos)
    return {'modo': 'actualizar' if conectado else 'primera', 'url': PANEL_URL, 'pcs': [p for p in agentes_canal.pcs_resumen() if p.get('equipo')]}


NAS_AGENTES_WIN = '\\\\192.168.0.120\\nas indoor\\DIRECCION PRODUCCION\\CARPETAS PERSONALES\\GALLO\\AGENTES_INDOOR'   # la ruta de la NAS vista desde los PC con Windows


@router.get('/instalador')
def descargar_instalador(request: Request, token: str = '', url: str = ''):
    """Instalador de un solo clic (INSTALAR_TIENDA_CLUB.bat) con la dirección y el código de enlace ya puestos. Se abre con doble clic en el PC de los agentes:
    busca la carpeta de los agentes de edición, copia TIENDA CLUB desde la NAS, enlaza el PC y reinicia los agentes. Solo para la primera instalación."""
    _usuario(request)
    token = token.strip()
    with _lock:
        if _conectado(_leer()):
            raise HTTPException(409, 'Ya hay un PC de TIENDA CLUB enlazado: no hace falta el instalador (usa «Instalar todo» para actualizar).')
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,64}', token):
            token = secrets.token_urlsafe(24)
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
    url = url.strip().rstrip('/')
    if not re.fullmatch(r'https://[A-Za-z0-9.-]{3,100}(:[0-9]{2,5})?', url):
        url = PANEL_URL
    plantilla = (Path(__file__).with_name('fragmentos') / 'instalar_tienda_club.plantilla').read_text(encoding='utf-8')
    cuerpo = plantilla.replace('__URL__', url).replace('__TOKEN__', token).replace('__NAS__', NAS_AGENTES_WIN)
    cuerpo = cuerpo.replace('\r\n', '\n').replace('\n', '\r\n')   # saltos de línea de Windows
    return Response(cuerpo.encode('ascii'), media_type='application/octet-stream',
                    headers={'Content-Disposition': 'attachment; filename="INSTALAR_TIENDA_CLUB.bat"', 'Cache-Control': 'no-store'})


@router.post('/instalar-todo/codigo')
def instalar_todo_codigo(request: Request):
    """Código de enlace para mostrarlo (y poder copiarlo) en el formulario de «Instalar todo». Solo en la primera instalación: si ya hay un PC enlazado no se
    cambia el código, para no desconectarlo."""
    _usuario(request)
    with _lock:
        if _conectado(_leer()):
            raise HTTPException(409, 'Ya hay un PC de TIENDA CLUB enlazado: no hace falta un código nuevo.')
        token = secrets.token_urlsafe(24)
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
    return {'token': token, 'url': PANEL_URL}


@router.post('/instalar-todo')
def instalar_todo(request: Request, payload: dict | None = None):
    """Botón «Instalar todo». Publica en la NAS el código de TIENDA CLUB (y el de ECOMMERCE) y:
    · si el PC ya está enlazado a TIENDA CLUB: le ordena bajar TODO el paquete desde la NAS y reiniciarlo;
    · si es la primera vez: genera el código de enlace, lo deja para ESE PC en la NAS y reinicia sus agentes de edición, que al arrancar se instalan
      y enlazan solos (puente.py, «_autoinstalar_tienda_club»). Sin ejecutar nada a mano."""
    usuario = _usuario(request)
    pid = str((payload or {}).get('pc') or '')
    with _lock:
        datos = _leer()
        _vencer(datos)
        conectado = _conectado(datos)
        if conectado and _pendiente_de(datos, 'nova'):
            raise HTTPException(409, 'El PC todavía tiene una orden en curso: espera a que la termine.')
    equipo = ''
    if not conectado:
        from app import agentes_canal
        elegido = next((p for p in agentes_canal.pcs_resumen() if p['id'] == pid), None)
        if not elegido:
            raise HTTPException(400, 'Elige el PC de los agentes donde se va a instalar')
        if not elegido.get('conectado') or not elegido.get('equipo'):
            raise HTTPException(409, f'El PC «{elegido["nombre"]}» no está conectado al panel: enciéndelo y abre sus agentes para poder instalar desde aquí.')
        equipo = elegido['equipo']
    publicados, avisos = publicar_en_nas(), []
    try:   # el código de ECOMMERCE también se deja al día (si falla, no impide instalar lo demás)
        from app import ecommerce_canal
        publicados += ['ecommerce/' + n for n in ecommerce_canal.publicar_en_nas()]
    except HTTPException as e:
        avisos.append('ECOMMERCE: ' + str(e.detail))
    except Exception as e:   # noqa: BLE001
        avisos.append('ECOMMERCE: ' + str(e)[:120])
    if conectado:
        with _lock:
            datos = _leer()
            datos['seq'] += 1
            orden = {'id': datos['seq'], 'agente': 'nova', 'accion': 'instalar', 'por': usuario, 'estado': 'pendiente', 'detalle': '', 'at': _ahora(), 'iso': _iso()}
            datos['ordenes'].append(orden)
            _nota(datos, 'nova', 'info', f'{usuario} pidió «Instalar todo»: código publicado en la NAS ({", ".join(publicados) or "sin cambios"}) y el PC baja todo el paquete y reinicia')
            _guardar(datos)
        return {'ok': True, 'modo': 'actualizar', 'publicados': publicados, 'avisos': avisos}
    pedido = str((payload or {}).get('token') or '')
    # primera instalación: se usa el código del formulario (el que se mostró o el que la persona escribió/pegó) si tiene un formato válido; si no, uno nuevo.
    # Viaja a ESE PC por la NAS (se borra al conectarse). La dirección también se puede corregir en el formulario (debe ser https).
    token = pedido if re.fullmatch(r'[A-Za-z0-9_-]{20,64}', pedido) else secrets.token_urlsafe(24)
    url_pedida = str((payload or {}).get('url') or '').strip().rstrip('/')
    url = url_pedida if re.fullmatch(r'https://[A-Za-z0-9.-]{3,100}(:[0-9]{2,5})?', url_pedida) else PANEL_URL
    enlace = NAS_CODIGO / f'enlace_{_nombre_archivo_equipo(equipo)}.json'
    enlace.write_text(json.dumps({'url': url, 'token': token}), encoding='utf-8')
    with _lock:
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
        datos = _leer()
        _nota(datos, 'nova', 'info', f'{usuario} pidió «Instalar todo» en {equipo}: código publicado en la NAS ({", ".join(publicados) or "sin cambios"}), enlace creado y reinicio de sus agentes de edición')
        _guardar(datos)
    from app import agentes_canal
    agentes_canal.reiniciar_pc(usuario, pid)
    return {'ok': True, 'modo': 'primera', 'equipo': equipo, 'publicados': publicados, 'avisos': avisos}


@router.post('/agentes/{agente}/{accion}')
def ordenar(request: Request, agente: str, accion: str):
    usuario = _usuario(request)
    if agente not in POR_ID or accion not in ACCIONES:
        raise HTTPException(404, 'Agente o acción desconocidos')
    with _lock:
        datos = _leer()
        _vencer(datos)
        if not _conectado(datos):
            raise HTTPException(409, 'El PC de los agentes no está conectado al panel. Enciéndelo y abre «TIENDA CLUB · conectar» en ese PC.')
        if _pendiente_de(datos, agente):
            raise HTTPException(409, f'{POR_ID[agente]["nombre"]} ya tiene una orden en curso: espera a que el PC la termine.')
        actual = (datos['agentes'].get(agente) or {}).get('estado', 'INACTIVO')
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
    filas = [l for l in datos['log'] if l['id'] > desde and (not agente or l['agente'] == agente)]
    return {'lineas': filas[-max(1, min(limite, 500)):], 'ultimo': datos['seq']}


@router.post('/conexion/regenerar')
def regenerar(request: Request):
    """Crea un código nuevo de enlace para el PC (el anterior deja de servir)."""
    _usuario(request)
    token = secrets.token_urlsafe(24)
    with _lock:
        _token_file.parent.mkdir(parents=True, exist_ok=True)
        _token_file.write_text(_hash(token), encoding='utf-8')
        try:
            os.chmod(_token_file, 0o600)
        except OSError:
            pass
    return {'token': token, 'url': str(request.base_url).rstrip('/')}


def alertas() -> list:
    """Alertas para la campana del panel (solo Administración / Coordinación)."""
    with _lock:
        datos = _leer()
    salida, latido = [], datos.get('latido') or {}
    if _token_hash() and latido.get('at') and not _conectado(datos):
        minutos = round((_ahora() - float(latido['at'])) / 60)
        salida.append({'tipo': 'tienda-club', 'orden': '', 'cliente': '', 'severidad': 'alta', 'titulo': 'TIENDA CLUB: el PC de los agentes no responde',
                       'detalle': f'Último aviso hace {minutos} min. Revisa que el PC esté encendido y con los agentes abiertos.'})
    for p in datos['pedidos'].values():
        if p['etapa'] == 'error':
            salida.append({'tipo': 'tienda-club', 'orden': 'CO' + p.get('numero', ''), 'cliente': p['cliente'], 'severidad': 'media',
                           'titulo': f"Reprogramación #{p['id']} con avisos", 'detalle': str(p.get('detalle', ''))[:200]})
    return salida


# ------------------------------------------------------------------ PC con los agentes
@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El PC avisa que está vivo, reporta el estado de cada agente y sus últimas líneas, y recibe las órdenes pendientes (iniciar / detener / reiniciar)."""
    _pc(request)
    try:   # el código de enlace que se dejó en la NAS para la primera instalación ya cumplió su función: se borra
        for f in NAS_CODIGO.glob('enlace_*.json'):
            f.unlink()
    except OSError:
        pass
    with _lock:
        datos = _leer()
        datos['latido'] = {'at': _ahora(), 'iso': _iso(), 'equipo': str(payload.get('equipo', ''))[:60], 'simulado': bool(payload.get('simulado'))}
        for aid, info in (payload.get('agentes') or {}).items():
            if aid not in POR_ID or not isinstance(info, dict):
                continue
            previo = datos['agentes'].get(aid) or {}
            estado_rep = str(info.get('estado', 'INACTIVO'))[:20]
            # un ERROR de conexión con el panel (502 / conexión cortada mientras el panel se reiniciaba) ya pasó: este sondeo llegó, así que el panel responde
            if estado_rep == 'ERROR' and any(t in str(info.get('ultima', '')) for t in ('El panel respondió 502', 'El panel respondió 503', 'WinError 10054', 'WinError 10060')):
                estado_rep = 'CORRIENDO'
            nuevo = {'estado': estado_rep, 'pid': info.get('pid'), 'ultima': str(info.get('ultima', ''))[:300],
                     'desde': previo.get('desde') if previo.get('estado') == estado_rep else _iso()}
            if nuevo['estado'] != previo.get('estado') and previo:
                _nota(datos, aid, 'error' if nuevo['estado'] == 'ERROR' else 'info', f'{POR_ID[aid]["nombre"]}: {previo.get("estado", "—")} → {nuevo["estado"]}')
            datos['agentes'][aid] = nuevo
        if isinstance(payload.get('latidos'), dict):
            datos['latidos'] = {aid: {'actividad': str(d.get('actividad', ''))[:120], 'hace_seg': d.get('hace_seg'), 'ultima_hace': d.get('ultima_hace'),
                                      'proxima_en': d.get('proxima_en'), 'intervalo': d.get('intervalo')}
                                for aid, d in payload['latidos'].items() if aid in POR_ID and isinstance(d, dict)}
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
    return {'ordenes': entregar, 'configuracion': {'tienda_club_activo': bool(datos['configuracion']['tienda_club_activo'])}}


@pc_router.post('/paso')
def paso(request: Request, payload: dict):
    """Un agente del PC pide que se haga el siguiente paso de su rol (recibe / prepara / programa)."""
    _pc(request)
    return hacer_paso(str(payload.get('rol') or ''))
