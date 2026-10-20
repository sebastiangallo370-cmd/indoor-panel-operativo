"""EFFITRON: agente que crea en Effi la cotización de una reposición de club y baja su PDF.

Flujo (Tienda Club, app/club.py):
  1. El cliente confirma su pedido → el panel PREPARA la cotización: lee del PDF de la cotización anterior (carpeta del pedido en el NAS) los artículos y
     precios de cada diseño (D1, D2…) y género (MAS/FEM), y del encabezado de esa cotización en Effi el cliente, vendedor, sucursal, bodega y centro de costos.
     Solo van líneas de los diseños que el cliente eligió, con la cantidad que escribió. Si algo no cuadra (impuestos, artículo sin precio…) NO se crea nada.
  2. EFFITRON (contenedor en el VPS, zeus_vps/agente_effitron.py) sondea el panel, recibe ese cuerpo, crea la cotización por la API de Effi
     (idempotency_key: un reintento no duplica) y baja el PDF de Effi con su sesión web.
  3. El panel guarda el PDF, lo copia a la carpeta de la orden en el NAS (con el listado en Excel) y lo muestra en el enlace del cliente.
Estados de club_pedidos.cot_estado: preparando · pendiente (esperando al agente) · entregada (el agente la tiene) · sin_pdf (creada en Effi, falta bajar el PDF) · lista · error.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Request

from app import effi_api, memoria_agentes

log = logging.getLogger('effitron')
ACTIVO = os.getenv('EFFITRON_ACTIVO', '') == '1'   # APAGADO por defecto: sin esto no se crea ninguna cotización
pc_router = APIRouter(prefix='/api/effitron/pc', tags=['effitron-pc'])
COT_DIR = Path(os.getenv('CLUB_COT_DIR', '/data/state/club_cotizaciones'))
COL = timezone(timedelta(hours=-5))
MAX_INTENTOS = 3
ENTREGADA_VENCE = 600
_lock = threading.Lock()
_connect: Callable = lambda: None
_pc_auth: Callable[[Request], None] = lambda r: None
_llave: Callable[[], str] = lambda: ''
_archivos: Callable[[int], list] = lambda row: []       # PDFs de la carpeta del pedido anterior (NAS)
_carpeta: Callable[[str, str, str], Path] = lambda orden, cliente, proyecto: Path('/tmp')   # carpeta de la orden nueva en el NAS
_pedido: Callable[[int], dict] = lambda n: {}
_excels: Callable[[dict], list] = lambda p: []
latido = {'at': 0.0, 'estado': 'SIN_CONECTAR', 'ultima': '', 'equipo': ''}


def configurar(connect, pc_auth, llave, archivos, carpeta, pedido, excels) -> None:
    global _connect, _pc_auth, _llave, _archivos, _carpeta, _pedido, _excels
    _connect, _pc_auth, _llave, _archivos, _carpeta, _pedido, _excels = connect, pc_auth, llave, archivos, carpeta, pedido, excels
    with _connect() as db:
        cols = {r['name'] for r in db.execute('PRAGMA table_info(club_pedidos)')}
        for c, t in (('cot_estado', "TEXT DEFAULT ''"), ('cot_cuerpo', 'TEXT'), ('cot_numero', 'TEXT'), ('cot_total', 'REAL'), ('cot_pdf', 'TEXT'),
                     ('cot_detalle', 'TEXT'), ('cot_intentos', 'INTEGER DEFAULT 0'), ('cot_entregada_at', 'REAL'), ('cot_carpeta', 'TEXT'), ('cot_id', 'TEXT')):
            if c not in cols:
                db.execute(f'ALTER TABLE club_pedidos ADD COLUMN {c} {t}')


def _ahora() -> float:
    return time.time()


def _plano(t) -> str:
    return re.sub(r'\s+', ' ', str(t or '')).strip().upper()


def _dinero(t: str) -> float:
    return float(re.sub(r'[^\d]', '', str(t)) or 0)


# ------------------------------------------------------------------ preparar el cuerpo de la cotización
LINEA_PDF = re.compile(r'^(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+\$([\d.,]+)\s+\$([\d.,]+)(?:\s+\$([\d.,]+))?\s+\$([\d.,]+)\s*$')


def leer_cotizacion_pdf(ruta) -> dict:
    """Del PDF de la cotización anterior: su número, las líneas (ref, descripción, diseño, género, precio), los días de pago y si trae impuestos."""
    import pdfplumber
    texto = ''
    with pdfplumber.open(str(ruta)) as pdf:
        for pg in pdf.pages:
            texto += (pg.extract_text() or '') + '\n'
    numero = re.search(r'No\.\s*(\d+)', texto)
    lineas = []
    for l in texto.splitlines():
        m = LINEA_PDF.match(l.strip())
        if not m:
            continue
        desc = m.group(3).strip()
        d = re.search(r'\bD(\d+)\b', desc)
        g = 'FEM' if re.search(r'\bFEM\b', desc, re.I) else 'MASC' if re.search(r'\bMAS[C]?\b', desc, re.I) else ''
        lineas.append({'ref': m.group(2), 'desc': desc, 'diseno': int(d.group(1)) if d else 1, 'genero': g, 'precio': _dinero(m.group(5))})
    dias = re.search(r'(\d+)\s*d[ií]as', texto, re.I)
    sub, tot = re.search(r'SUBTOTAL\s*\$([\d.,]+)', texto), re.search(r'TOTAL NETO\s*\$([\d.,]+)', texto)
    return {'numero': numero.group(1) if numero else '', 'lineas': lineas, 'dias': int(dias.group(1)) if dias else 0,
            'impuestos': bool(sub and tot and _dinero(sub.group(1)) != _dinero(tot.group(1))), 'texto': texto}


def _linea_base(base: dict, ref: str, d: int, g: str) -> dict:
    """La línea del PDF anterior más parecida: misma referencia y diseño y género; si no, mismo diseño; si no, mismo género; si no, la primera de esa referencia."""
    ls = [x for x in base['lineas'] if x['ref'] == ref]
    for f in (lambda x: x['diseno'] == d and x['genero'] == g, lambda x: x['diseno'] == d, lambda x: x['genero'] == g, lambda x: True):
        c = [x for x in ls if f(x)]
        if c:
            return c[0]
    raise ValueError(f'La cotización anterior no tiene líneas de la referencia {ref}')


def preparar(p: dict) -> dict:
    """Arma el cuerpo de POST /cotizacion para una reposición. Lanza ValueError con el motivo si no se puede hacer con seguridad."""
    if not _llave():
        raise ValueError('Falta la llave de la API de Effi (Agente Inventario → API Effi)')
    effi_api.usar_llave(_llave())
    conceptos, base_ref, cab = [], None, None
    for l in p['lineas']:
        pdfs = [f for f in _archivos(l['row']) if str(f).lower().endswith('.pdf')]
        elegido = next((f for f in pdfs if _plano(Path(f).name).startswith(_plano(l.get('orden_base')))), pdfs[0] if pdfs else None)
        if not elegido:
            raise ValueError(f"No encontré el PDF de la cotización anterior ({l.get('orden_base')}) en la carpeta del pedido")
        base = leer_cotizacion_pdf(elegido)
        if not base['numero'] or not base['lineas']:
            raise ValueError(f"No pude leer las líneas del PDF de la cotización anterior {l.get('orden_base')}")
        if base['impuestos']:
            raise ValueError(f"La cotización anterior {l.get('orden_base')} tiene impuestos: no sé calcularlos, la hace comercial")
        if cab is None:
            base_ref, cab = base, effi_api.cotizacion_de(base['numero'])
        art = effi_api.articulo(l['referencia'])
        por: dict = {}
        for j in l['jugadores']:
            k = (int(j.get('diseno') or 1), j.get('genero') or 'MASC')
            por[k] = por.get(k, 0) + max(1, int(j.get('cantidad') or 1))
        for (d, g), cant in sorted(por.items()):
            b = _linea_base(base, l['referencia'], d, g)
            desc = re.sub(r'\bD\d+\b', f'D{d}', b['desc'])
            desc = re.sub(r'\b(MASC?|FEM)\b', 'FEM' if g == 'FEM' else 'MAS', desc, flags=re.I)
            conceptos.append({'articulo': int(art['id']), 'descripcion': desc[:120], 'cantidad': cant, 'precio': b['precio']})
    if not conceptos:
        raise ValueError('El pedido no tiene prendas')
    total = sum(c['cantidad'] * c['precio'] for c in conceptos)
    hoy = datetime.now(COL).date()
    cuerpo = {
        'idempotency_key': f"club-{p['id']}-{p['cliente'][:10]}".replace(' ', '')[:36],
        'sucursal': int(cab['sucursal']), 'bodega': int(cab['bodega']), 'centro_costos': int(cab['centro_costos']),
        'fecha_entrega': str(hoy + timedelta(days=20)), 'divisa': 'COP', 'trm': 1,
        'cliente': int(cab['cliente']), 'id_pais_cliente': int(cab['pais_cliente']), 'id_provincia_cliente': int(cab['provincia_cliente']),
        'id_ciudad_cliente': int(cab['ciudad_cliente']), 'direccion_cliente': str(cab['direccion_cliente'] or '')[:200],
        'vendedor': int(cab['vendedor']),
        'observacion': f"REPOSICIÓN CLUB #{p['id']} · base CO{base_ref['numero']} · creada por EFFITRON"[:250],
        'articulo': [c['articulo'] for c in conceptos], 'descripcion': [c['descripcion'] for c in conceptos],
        'cantidad': [c['cantidad'] for c in conceptos], 'precio': [c['precio'] for c in conceptos], 'descuento': [0] * len(conceptos),
        't_forma_pago': [effi_api.forma_pago_id(base_ref['dias'] or 0)], 'valor_forma_pago': [total],
    }
    if not cab.get('direccion_cliente'):
        for k in ('id_pais_cliente', 'id_provincia_cliente', 'id_ciudad_cliente', 'direccion_cliente'):
            cuerpo.pop(k, None)
    return {'cuerpo': cuerpo, 'resumen': {'base': base_ref['numero'], 'lineas': conceptos, 'total': total}}


# ------------------------------------------------------------------ cola de trabajo
def _set(pedido_id: int, **campos) -> None:
    with _connect() as db:
        db.execute('UPDATE club_pedidos SET ' + ', '.join(f'{k}=?' for k in campos) + ' WHERE id=?', (*campos.values(), pedido_id))


def encolar(pedido_id: int) -> None:
    """El cliente confirmó: se prepara la cotización en segundo plano y queda lista para que EFFITRON la tome."""
    _set(pedido_id, cot_estado='preparando', cot_detalle='Preparando la cotización…')

    def correr():
        try:
            p = _pedido(pedido_id)
            r = preparar(p)
            _set(pedido_id, cot_cuerpo=json.dumps(r['cuerpo'], ensure_ascii=False), cot_estado='pendiente',
                 cot_detalle=f"Lista para crear: {len(r['resumen']['lineas'])} línea(s) · total ${r['resumen']['total']:,.0f} · base CO{r['resumen']['base']}")
        except Exception as e:   # noqa: BLE001
            log.warning('EFFITRON: no se pudo preparar la cotización del pedido %s: %s', pedido_id, e)
            _set(pedido_id, cot_estado='error', cot_detalle=str(e)[:290])
            memoria_agentes.registrar('EFFITRON', str(e), 'ERROR')
    threading.Thread(target=correr, name=f'effitron-prep-{pedido_id}', daemon=True).start()


def reintentar(pedido_id: int) -> None:
    _set(pedido_id, cot_intentos=0)
    p = _pedido(pedido_id)
    if p.get('cot_id') and not p.get('cot_pdf'):
        _set(pedido_id, cot_estado='sin_pdf', cot_detalle='Reintentando bajar el PDF…')
    elif p.get('cot_cuerpo') and p.get('cot_estado') != 'preparando':
        _set(pedido_id, cot_estado='pendiente', cot_detalle='Reintentando…')
    else:
        encolar(pedido_id)


def estado_publico(pedido_id: int) -> dict:
    p = _pedido(pedido_id)
    return {'estado': p.get('cot_estado') or '', 'numero': p.get('cot_numero') or '', 'pdf': bool(p.get('cot_pdf'))}


def _guardar_pdf(pedido_id: int, b64: str) -> str:
    raw = base64.b64decode(b64)
    if raw[:4] != b'%PDF' or len(raw) > 12 * 1024 * 1024:
        raise ValueError('El PDF que mandó el agente no es válido')
    COT_DIR.mkdir(parents=True, exist_ok=True)
    nombre = f'cotizacion-club-{pedido_id}.pdf'
    (COT_DIR / nombre).write_bytes(raw)
    return nombre


def pdf_bytes(pedido_id: int) -> bytes | None:
    p = _pedido(pedido_id)
    f = COT_DIR / str(p.get('cot_pdf') or '')
    return f.read_bytes() if p.get('cot_pdf') and f.is_file() else None


def _a_la_carpeta(pedido_id: int) -> str:
    """Copia la cotización (y el listado en Excel) a la carpeta de la orden nueva en el NAS. Devuelve el nombre de la carpeta o '' si el NAS no responde."""
    p = _pedido(pedido_id)
    orden = f"CO{p['cot_numero'] or p['cot_id']}"
    l0 = p['lineas'][0]
    carpeta = _carpeta(orden, p['cliente'], l0.get('proyecto') or 'REPOSICION')
    base = re.sub(r'[\\/:*?"<>|]+', ' ', f"{orden}_{l0.get('proyecto') or 'REPOSICION'}").strip()
    (carpeta / f'{base}.pdf').write_bytes(pdf_bytes(pedido_id) or b'')
    for nombre, datos in _excels(p):
        (carpeta / nombre).write_bytes(datos)
    return carpeta.name


def _resultado(r: dict) -> None:
    pid = int(r.get('id') or 0)
    if not pid:
        return
    p = _pedido(pid)
    if not p:
        return
    if r.get('ok'):
        cot_id = str(r.get('cot_id') or p.get('cot_id') or '')
        campos = {'cot_id': cot_id, 'cot_numero': str(r.get('numero') or cot_id), 'cot_total': r.get('total'), 'cot_entregada_at': None}
        if r.get('pdf_b64'):
            try:
                campos['cot_pdf'] = _guardar_pdf(pid, r['pdf_b64'])
            except Exception as e:   # noqa: BLE001
                campos.update(cot_estado='sin_pdf', cot_detalle=f'Cotización {cot_id} creada en Effi, pero el PDF falló: {e}')
        if campos.get('cot_pdf'):
            _set(pid, **campos, cot_estado='lista', cot_detalle=f'Cotización {campos["cot_numero"]} creada en Effi por EFFITRON')
            try:
                carpeta = _a_la_carpeta(pid)
                _set(pid, cot_carpeta=carpeta, cot_detalle=f'Cotización {campos["cot_numero"]} creada y guardada en la carpeta {carpeta} del NAS')
            except Exception as e:   # noqa: BLE001   (la cotización ya existe y el cliente la ve: se avisa que la carpeta falló)
                log.exception('EFFITRON: no se pudo copiar al NAS la cotización del pedido %s', pid)
                _set(pid, cot_detalle=f'Cotización {campos["cot_numero"]} creada. No pude copiarla a la carpeta del NAS: {str(e)[:120]}')
        elif 'cot_estado' not in campos:
            _set(pid, **campos, cot_estado='sin_pdf', cot_detalle=f'Cotización {cot_id} creada en Effi; falta bajar el PDF')
        else:
            _set(pid, **{k: v for k, v in campos.items()})
        return
    intentos = int(p.get('cot_intentos') or 0) + 1
    detalle = str(r.get('detalle') or 'Error de EFFITRON')[:290]
    memoria_agentes.registrar('EFFITRON', detalle, 'ERROR')
    vuelve = 'sin_pdf' if p.get('cot_id') else 'pendiente'
    _set(pid, cot_intentos=intentos, cot_entregada_at=None, cot_estado=vuelve if intentos < MAX_INTENTOS else 'error', cot_detalle=detalle)


@pc_router.post('/sondeo')
def sondeo(request: Request, payload: dict):
    """El agente avisa que está vivo, entrega resultados y recibe trabajos: crear la cotización o solo bajar un PDF."""
    _pc_auth(request)
    latido.update(at=_ahora(), estado=str(payload.get('estado', 'LIBRE'))[:24], ultima=str(payload.get('ultima', ''))[:300], equipo=str(payload.get('equipo', ''))[:60])
    for r in (payload.get('resultados') or [])[:10]:
        try:
            _resultado(r)
        except Exception:   # noqa: BLE001
            log.exception('EFFITRON: no pude procesar un resultado')
    trabajos = []
    with _lock, _connect() as db:
        db.execute("UPDATE club_pedidos SET cot_estado=CASE WHEN cot_id IS NOT NULL AND cot_id!='' THEN 'sin_pdf' ELSE 'pendiente' END, cot_entregada_at=NULL "
                   "WHERE cot_estado='entregada' AND ? - COALESCE(cot_entregada_at,0) > ?", (_ahora(), ENTREGADA_VENCE))
        if payload.get('puede_trabajar'):
            for r in db.execute("SELECT id, cot_cuerpo, cot_id, cot_estado FROM club_pedidos WHERE cot_estado IN ('pendiente','sin_pdf') ORDER BY id LIMIT 3").fetchall():
                if r['cot_estado'] == 'sin_pdf':
                    trabajos.append({'id': r['id'], 'tipo': 'pdf', 'cot_id': r['cot_id']})
                else:
                    trabajos.append({'id': r['id'], 'tipo': 'crear', 'cuerpo': json.loads(r['cot_cuerpo'] or '{}'), 'api': {'llave': _llave()}})
                db.execute("UPDATE club_pedidos SET cot_estado='entregada', cot_entregada_at=? WHERE id=?", (_ahora(), r['id']))
    return {'trabajos': trabajos}


def agente() -> dict:
    vivo = _ahora() - latido['at'] < 60
    return {'nombre': 'EFFITRON', 'conectado': vivo, 'estado': latido['estado'] if vivo else 'SIN_CONECTAR', 'ultima': latido['ultima'] if vivo else '', 'equipo': latido['equipo']}
