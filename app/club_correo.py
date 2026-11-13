"""Aviso por correo al comercial cuando una reprogramación de la Tienda Club queda con su cotización CREADA Y LISTA (la crea EFFITRON en Effi).

El correo lleva el cliente, quien pidió, las referencias y las prendas, el número y total de la cotización, el vendedor, un enlace al panel para aprobarla
y el PDF de la cotización adjunto. Se envía UNA sola vez por reprogramación (aunque EFFITRON reintente) y nunca debe impedir que la cotización quede lista:
cualquier error solo queda en el registro.
Destinatarios: los comerciales que se escriban en Comercial → Tienda club → «Aviso por correo» (una línea «NOMBRE : correo» por persona). Va al comercial dueño
de la reprogramación (el vendedor de la cotización) y, si no se conoce, a todos. Sin comerciales escritos no se envía a nadie.
Datos en /data/state/club_correos.json.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from pathlib import Path

log = logging.getLogger('club_correo')
ARCHIVO = Path(os.getenv('CLUB_CORREO_FILE', '/data/state/club_correos.json'))
PANEL = os.getenv('PANEL_URL_PUBLICA', 'https://produccion.cloud')
SECRETO = Path(os.getenv('CLUB_CORREO_SECRETO', '/data/state/club_correo_secreto.txt'))
VIGENCIA_SEG = 7 * 86400   # el enlace del correo vale 7 días
_lock = threading.Lock()
_CORREO = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')


def _leer() -> dict:
    try:
        d = json.loads(ARCHIVO.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        d = {}
    d.setdefault('comerciales', [])
    d.setdefault('enviados', [])
    return d


def _guardar(d: dict) -> None:
    d['enviados'] = d['enviados'][-500:]
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ARCHIVO.with_suffix('.tmp')
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    tmp.replace(ARCHIVO)


def _secreto() -> bytes:
    """Clave con que se firman los enlaces del correo (se crea la primera vez; vive solo en el servidor)."""
    try:
        t = SECRETO.read_text(encoding='utf-8').strip()
        if len(t) >= 32:
            return t.encode()
    except OSError:
        pass
    t = secrets.token_urlsafe(48)
    SECRETO.parent.mkdir(parents=True, exist_ok=True)
    SECRETO.write_text(t, encoding='utf-8')
    try:
        os.chmod(SECRETO, 0o600)
    except OSError:
        pass
    return t.encode()


def firmar(pedido_id: int, accion: str = 'aprobar', vence: float | None = None) -> str:
    """Enlace firmado «<id>.<acción>.<vence>.<firma>»: solo sirve para ESA reprogramación y ESA acción, y vence."""
    vence = int(vence if vence is not None else time.time() + VIGENCIA_SEG)
    base = f'{int(pedido_id)}.{accion}.{vence}'
    return base + '.' + hmac.new(_secreto(), base.encode(), hashlib.sha256).hexdigest()[:40]


def verificar(token: str) -> tuple[int, str]:
    """(id de la reprogramación, acción) si la firma es válida y no venció; lanza ValueError con el motivo si no."""
    partes = str(token or '').split('.')
    if len(partes) != 4 or not partes[0].isdigit() or not partes[2].isdigit():
        raise ValueError('Enlace no válido')
    base = '.'.join(partes[:3])
    esperado = hmac.new(_secreto(), base.encode(), hashlib.sha256).hexdigest()[:40]
    if not hmac.compare_digest(esperado, partes[3]):
        raise ValueError('Enlace no válido')
    if int(partes[2]) < time.time():
        raise ValueError('Este enlace venció. Aprueba la reprogramación desde el panel (Comercial → Tienda club).')
    if partes[1] != 'aprobar':
        raise ValueError('Enlace no válido')
    return int(partes[0]), partes[1]


def _lista(texto: str) -> list[str]:
    return [c.strip() for c in re.split(r'[,;\s]+', str(texto or '')) if c.strip()]


def validar(texto: str) -> list[str]:
    """Lista de correos válidos; lanza ValueError con el primero que no lo es."""
    correos = _lista(texto)
    for c in correos:
        if not _CORREO.match(c):
            raise ValueError(f'«{c}» no es un correo válido')
    return correos[:10]


def _plano(t: str) -> str:
    import unicodedata
    return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFD', str(t or '')) if unicodedata.category(c) != 'Mn')).strip().upper()


def validar_comerciales(texto: str) -> list[dict]:
    """Una persona por línea: «NOMBRE : correo». Lanza ValueError con la primera línea que no sirva."""
    lista = []
    for linea in str(texto or '').splitlines():
        linea = linea.strip()
        if not linea:
            continue
        if ':' not in linea:
            raise ValueError(f'«{linea}»: escribe «NOMBRE : correo» (un comercial por línea)')
        nombre, correo = (x.strip() for x in linea.rsplit(':', 1))
        if len(nombre) < 2 or not _CORREO.match(correo):
            raise ValueError(f'«{linea}»: el nombre o el correo no son válidos')
        lista.append({'nombre': nombre, 'correo': correo})
    return lista[:20]


def comerciales() -> list[dict]:
    with _lock:
        return [c for c in _leer().get('comerciales', []) if c.get('correo')]


def configurados() -> str:
    """Los comerciales como texto, una línea «NOMBRE : correo» por persona (lo que se edita en el panel)."""
    return '\n'.join(f"{c['nombre']} : {c['correo']}" for c in comerciales())


def guardar(texto: str) -> str:
    lista = validar_comerciales(texto)
    with _lock:
        d = _leer()
        d['comerciales'] = lista
        _guardar(d)
    return configurados()


def _mismo(a: str, b: str) -> bool:
    """El vendedor de la cotización es esa persona (sin importar mayúsculas ni tildes; o uno contiene el nombre del otro)."""
    a, b = _plano(a), _plano(b)
    if not a or not b:
        return False
    if a == b:
        return True
    pa, pb = set(a.split()), set(b.split())
    return (len(pa) >= 2 and pa <= pb) or (len(pb) >= 2 and pb <= pa)


def sin_vendedor() -> str:
    """Correo al que va el aviso cuando NO se reconoce al comercial dueño de la cotización."""
    with _lock:
        return str(_leer().get('sin_vendedor') or '')


def guardar_sin_vendedor(correo: str) -> str:
    correo = str(correo or '').strip()
    if correo and not _CORREO.match(correo):
        raise ValueError(f'«{correo}» no es un correo válido')
    with _lock:
        d = _leer()
        d['sin_vendedor'] = correo
        _guardar(d)
    return correo


def destinatarios_para(p: dict) -> str:
    """El correo del comercial dueño de la reprogramación (por el vendedor de la cotización). Si NO se reconoce al comercial, va SOLO al correo de «sin vendedor»
    (sin_vendedor). No hay respaldo hacia otras listas: sin nada configurado no se envía a nadie."""
    dueno = [c for c in comerciales() if _mismo(p.get('cot_vendedor') or '', c['nombre'])]
    if dueno:
        return ', '.join(dict.fromkeys(c['correo'] for c in dueno))
    return sin_vendedor()


def destinatarios() -> str:
    """Todos los correos que pueden recibir el aviso (para mostrar en el panel)."""
    return ', '.join(dict.fromkeys([c['correo'] for c in comerciales()] + ([sin_vendedor()] if sin_vendedor() else [])))


def _texto(p: dict) -> tuple[str, str]:
    lineas = p.get('lineas') or []
    prendas = sum(int(j.get('cantidad') or 1) for l in lineas for j in l.get('jugadores', []))
    refs = '\n'.join(f"  · {l.get('referencia', '?')} · {l.get('proyecto', '')} (base {l.get('orden_base', '')}): "
                     f"{sum(int(j.get('cantidad') or 1) for j in l.get('jugadores', []))} prenda(s)" for l in lineas) or '  (sin detalle)'
    numero = str(p.get('cot_numero') or p.get('cot_id') or '')
    total = p.get('cot_total')
    asunto = f"Reprogramación de club #{p['id']} · cotización {numero} lista · {p.get('cliente', '')}"
    cuerpo = (
        f"Hola,\n\nEl cliente {p.get('cliente', '')} confirmó una reprogramación desde la Tienda Club y EFFITRON ya creó su cotización en Effi.\n\n"
        f"Reprogramación: #{p['id']}\n"
        f"Cotización: N° {numero}" + (f" · total ${float(total):,.0f}" if total not in (None, '') else '') + "\n"
        + (f"Vendedor: {p['cot_vendedor']}\n" if p.get('cot_vendedor') else '')
        + f"Pidió: {p.get('contacto', '')} · tel. {p.get('telefono', '')}\n"
        + (f"Notas del cliente: {p['notas']}\n" if p.get('notas') else '')
        + f"\nPrendas: {prendas}\n{refs}\n\n"
        f"APROBAR AHORA (un clic, pide una confirmación):\n{PANEL}/club/aprobar/{firmar(p['id'])}\n\n"
        f"Al aprobarla, los agentes de TIENDA CLUB la preparan y la programan. El enlace es solo para esta reprogramación y vence en 7 días.\n"
        f"Si prefieres revisarla antes en el panel: {PANEL} (Comercial → Tienda club → Reprogramaciones de los clubes).\n\n"
        "Adjunto el PDF de la cotización.\n\nINDOOR SPORT SAS · Tienda Club"
    )
    return asunto, cuerpo


def _html(p: dict) -> str:
    """El mismo correo con formato: datos de la reprogramación y un BOTÓN «APROBAR REPROGRAMACIÓN» (tabla con estilos en línea: se ve igual en Gmail y Outlook)."""
    from html import escape
    lineas = p.get('lineas') or []
    prendas = sum(int(j.get('cantidad') or 1) for l in lineas for j in l.get('jugadores', []))
    numero = escape(str(p.get('cot_numero') or p.get('cot_id') or '—'))
    total = p.get('cot_total')
    enlace = f"{PANEL}/club/aprobar/{firmar(p['id'])}"
    filas = ''.join(f'<tr><td style="padding:4px 12px 4px 0;color:#667;font-size:14px;white-space:nowrap">{k}</td><td style="padding:4px 0;font-size:14px;color:#111"><b>{v}</b></td></tr>'
                    for k, v in (('Cliente', escape(str(p.get('cliente') or ''))), ('Reprogramación', f"#{p['id']}"),
                                 ('Cotización', f"N° {numero}" + (f" · ${float(total):,.0f}" if total not in (None, '') else '')),
                                 ('Pidió', escape(f"{p.get('contacto', '')} · {p.get('telefono', '')}")), ('Prendas', str(prendas)))
                    + ((('Vendedor', escape(str(p['cot_vendedor']))),) if p.get('cot_vendedor') else ()))
    notas = f'<p style="margin:10px 0 0;font-size:14px;color:#334"><b>Notas del cliente:</b> {escape(str(p["notas"]))}</p>' if p.get('notas') else ''
    return (
        '<div style="background:#f3f5f1;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:26px">'
        '<tr><td>'
        '<div style="font-size:11px;font-weight:bold;letter-spacing:2px;color:#5a7d0a">TIENDA CLUB</div>'
        '<h2 style="margin:6px 0 4px;font-size:22px;color:#111">Nueva reprogramación lista para aprobar</h2>'
        '<p style="margin:0 0 14px;font-size:14px;color:#445">El cliente confirmó una reprogramación y EFFITRON ya creó su cotización en Effi.</p>'
        f'<table role="presentation" cellpadding="0" cellspacing="0">{filas}</table>{notas}'
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td align="center" bgcolor="#d0f44c" style="border-radius:12px">'
        f'<a href="{enlace}" target="_blank" style="display:inline-block;padding:16px 34px;font-size:16px;font-weight:bold;letter-spacing:.5px;color:#142017;text-decoration:none;border-radius:12px;background:#d0f44c">APROBAR REPROGRAMACIÓN</a>'
        '</td></tr></table>'
        '<p style="margin:0 0 14px;font-size:12px;color:#667">Al pulsar el botón la reprogramación se aprueba y los agentes de TIENDA CLUB la preparan y la programan. '
        'El enlace es solo para esta reprogramación y vence en 7 días.</p>'
        f'<p style="margin:0;font-size:12px;color:#667">¿Prefieres revisarla antes? <a href="{PANEL}" style="color:#3b5d00">Abrir el panel</a> (Comercial → Tienda club). La cotización va adjunta en PDF.</p>'
        '</td></tr></table></div>')


def avisar(p: dict, pdf: bytes | None) -> bool:
    """Envía el correo de «cotización lista» (una sola vez por reprogramación). Devuelve True si salió. Corre en un hilo aparte para no demorar a EFFITRON."""
    try:
        pid = int(p['id'])
        from app import alertas_correo
        if not alertas_correo.puede_enviar():
            log.warning('Correo de la reprogramación %s: no hay cuenta de correo configurada', pid)
            return False
        para = destinatarios_para(p)
        if not para:
            log.warning('Correo de la reprogramación %s: no hay comerciales configurados (Comercial → Tienda club → Aviso por correo)', pid)
            return False
        with _lock:
            d = _leer()
            if pid in d['enviados']:
                return False
            d['enviados'].append(pid)
            _guardar(d)
        asunto, cuerpo = _texto(p)
        adj = [(f"Cotizacion_{p.get('cot_numero') or pid}.pdf", pdf)] if pdf else []

        def enviar():
            try:
                alertas_correo.enviar(asunto, cuerpo, para=para, adjuntos=adj, html=_html(p))
                log.info('Correo de la reprogramación %s enviado a %s', pid, para)
            except Exception:   # noqa: BLE001
                log.exception('No se pudo enviar el correo de la reprogramación %s', pid)
                with _lock:   # no llegó: se permite reintentar
                    dd = _leer()
                    if pid in dd['enviados']:
                        dd['enviados'].remove(pid)
                        _guardar(dd)
        threading.Thread(target=enviar, name=f'club-correo-{pid}', daemon=True).start()
        return True
    except Exception:   # noqa: BLE001
        log.exception('Correo de la reprogramación: error inesperado')
        return False
