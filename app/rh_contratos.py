"""R.HUMANO > CONTRATOS y C.LABORAL: cada empleado descarga la copia de SU contrato, o su carta (certificación) laboral generada al momento,
escribiendo nombre completo y cédula (el cargo ya no se pide: pedido del usuario, 2026-10-09).

Los PDF y el índice viven en /data/state/rh_contratos (no se versionan; se suben desde el PC de administración porque el servidor no tiene permiso
sobre la carpeta de nómina de la NAS). El índice no guarda la cédula en claro, solo su huella. Nunca se entrega la lista de empleados: solo se
responde «coincide / no coincide», y tras varios intentos fallidos se bloquea un rato.
"""
import datetime
import hashlib
import io
import json
import logging
import os
import re
import threading
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response

DATOS = Path(os.getenv('RH_CONTRATOS_DIR', '/data/state/rh_contratos'))
MAX_FALLOS, VENTANA = 5, 15 * 60   # intentos fallidos permitidos por cuenta en 15 minutos
_fallos: dict = {}
_lock = threading.Lock()
_NO_COINCIDE = 'Los datos no coinciden con ningún contrato. Revisa el nombre completo y la cédula tal como están en tu contrato.'


def _plano(texto) -> str:
    sin = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Za-z0-9 ]+', ' ', sin)).strip().upper()


def _indice() -> dict:
    try:
        return json.loads((DATOS / 'indice.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'sal': '', 'empleados': []}


def disponibles() -> int:
    return len(_indice().get('empleados', []))


def _nombre_ok(escrito: str, registrado: str) -> bool:
    """Nombre completo: las palabras del contrato deben estar en lo escrito (el orden no importa). Con cuatro o más palabras se tolera que falte
    una (un segundo nombre); nunca valen palabras que no estén en el contrato."""
    a, b = set(_plano(escrito).split()), set(_plano(registrado).split())
    if len(b) < 2 or not a or not a <= b:
        return False
    return len(b - a) <= (1 if len(b) >= 4 else 0)


def _cargo_ok(escrito: str, cargos: list) -> bool:
    """Cargo: igual o casi igual al del contrato («OPERARIO CORTE LASER» vale para «OPERARIO MAQUINA CORTE LASER»)."""
    e = _plano(escrito)
    pe = {w for w in e.split() if len(w) >= 4}
    if not pe:
        return False
    for cargo in cargos:
        c = _plano(cargo)
        pc = {w for w in c.split() if len(w) >= 4}
        if e == c or SequenceMatcher(None, e, c).ratio() >= 0.82 or (len(pe) >= 2 and pe <= pc) or (len(pc) >= 2 and pc <= pe):
            return True
    return False


def _buscar(nombre: str, cedula: str):
    datos = _indice()
    digitos = re.sub(r'\D', '', str(cedula or ''))
    if not 6 <= len(digitos) <= 10:
        return None
    huella = hashlib.sha256((datos.get('sal', '') + digitos).encode()).hexdigest()
    for e in datos.get('empleados', []):
        if e.get('cedula_sha') == huella and _nombre_ok(nombre, e.get('nombre', '')):
            return e
    return None


def _validar(usuario: str, payload: dict, para: str):
    """Empleado activo cuyo nombre completo y cédula coinciden; si no, 403 sin decir qué dato falló. Tras varios fallos la cuenta queda bloqueada un rato."""
    ahora = time.time()
    with _lock:
        recientes = [t for t in _fallos.get(usuario, []) if ahora - t < VENTANA]
        _fallos[usuario] = recientes
        if len(recientes) >= MAX_FALLOS:
            espera = int((VENTANA - (ahora - recientes[0])) / 60) + 1
            raise HTTPException(429, f'Demasiados intentos. Vuelve a intentarlo en {espera} minutos o pide ayuda en Administración.')
    empleado = _buscar(payload.get('nombre', ''), payload.get('cedula', ''))
    if not empleado:
        with _lock:
            _fallos.setdefault(usuario, []).append(ahora)
        logging.warning('RH %s: intento fallido de la cuenta %s', para, usuario)
        raise HTTPException(403, _NO_COINCIDE)
    return empleado


def entregar(usuario: str, payload: dict):
    """Devuelve el PDF del contrato si los tres datos coinciden con un empleado activo."""
    empleado = _validar(usuario, payload, 'contratos')
    ruta = DATOS / str(empleado.get('archivo', ''))
    if not re.fullmatch(r'[a-z0-9-]+\.pdf', str(empleado.get('archivo', ''))) or not ruta.is_file():
        raise HTTPException(404, 'Tu contrato todavía no está cargado. Pídelo en Administración.')
    logging.info('RH contratos: la cuenta %s descargó el contrato %s', usuario, empleado.get('id'))
    nombre = 'Contrato ' + ' '.join(p.capitalize() for p in str(empleado.get('nombre', '')).split()) + '.pdf'
    return FileResponse(ruta, media_type='application/pdf', filename=nombre, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


# ------------------------------------------------------------------ C.LABORAL: carta (certificación) laboral generada al momento
_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
_UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
             'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
             'veintiocho', 'veintinueve']
_DECENAS = {30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa'}


def _en_letras(n: int) -> str:
    """1 a 99 en letras («dieciséis», «treinta y uno»)."""
    if n < 30:
        return _UNIDADES[n]
    return _DECENAS[n - n % 10] + (' y ' + _UNIDADES[n % 10] if n % 10 else '')


def _anio_en_letras(a: int) -> str:
    return 'dos mil' + (' ' + _en_letras(a - 2000) if a > 2000 else '')


def _datos_carta() -> dict:
    """Datos fijos de la empresa y del firmante (viven con los contratos, fuera del repositorio)."""
    try:
        return json.loads((DATOS / 'carta' / 'datos.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _pdf_carta(empleado: dict, cedula: str, hoy: datetime.date) -> bytes:
    """Carta laboral con el mismo formato de la plantilla de Indoor: logo, marca de agua, texto, firma del representante legal y pie de página."""
    from reportlab.lib.enums import TA_JUSTIFY
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfgen import canvas
    from reportlab.platypus import Paragraph

    emp = _datos_carta()
    if not emp.get('empresa') or not emp.get('representante'):
        raise HTTPException(503, 'La carta laboral todavía no está configurada. Pídela en Administración.')
    carpeta = DATOS / 'carta'
    alto, x0, ancho = 792, 85, 442
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(612, alto))
    c.setTitle('Certificación laboral'); c.setAuthor(emp['empresa'])

    def imagen(nombre, x, y_sup, w, h):   # y_sup: distancia desde el borde superior, como en la plantilla
        ruta = carpeta / nombre
        if ruta.is_file():
            c.drawImage(str(ruta), x, alto - y_sup - h, width=w, height=h, mask='auto')

    imagen('marca.png', 85, 340, 442, 115)   # marca de agua, debajo del texto
    imagen('logo.png', 85, 35, 101, 29)
    imagen('lema.png', 85, 67, 146, 10)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(x0, alto - 131, emp.get('ciudad', 'Itagüí, Antioquia'))
    c.drawString(x0, alto - 144, f'{_MESES[hoy.month - 1].capitalize()} {hoy.day} de {hoy.year}')
    c.setFont('Helvetica', 12)
    c.drawString(x0, alto - 200, 'A quien pueda interesar:')

    nombre = str(empleado.get('nombre_carta') or empleado.get('nombre', '')).upper()
    nombre_corto = ' '.join(p.capitalize() for p in nombre.split())
    cargo = ' '.join(p.capitalize() if len(p) > 2 else p.lower() for p in str(empleado.get('cargo_actual', '')).split())
    cargo = cargo[:1].upper() + cargo[1:]
    inicio = datetime.date.fromisoformat(empleado['inicio'])
    cc = f'{int(cedula):,}'.replace(',', '.')
    estilo = ParagraphStyle('carta', fontName='Helvetica', fontSize=12, leading=13.8, alignment=TA_JUSTIFY)
    parrafos = [
        f"La empresa <b>{emp['empresa']}</b>, identificada con NIT <b>{emp.get('nit', '')}</b>, se permite certificar que <b>{nombre}</b>, identificado(a) con cédula de "
        f"ciudadanía No. {cc}, se encuentra vinculado(a) laboralmente a nuestra organización desde el {inicio.day} de {_MESES[inicio.month - 1]} de {inicio.year}, "
        f"desempeñando el cargo de {cargo}.",
        f"Durante el tiempo de su vinculación, {nombre_corto} ha desarrollado las funciones propias de su cargo con responsabilidad, profesionalismo y compromiso, "
        "contribuyendo al cumplimiento de los objetivos de la organización y atendiendo las labores asignadas conforme a las políticas y lineamientos de la empresa.",
        f"La presente certificación se expide a solicitud del interesado(a), exclusivamente con fines laborales y/o personales, a los {_en_letras(hoy.day)} ({hoy.day}) "
        f"días del mes de {_MESES[hoy.month - 1]} de <b>{_anio_en_letras(hoy.year)} ({hoy.year}).</b>",
    ]
    y = alto - 217
    for texto in parrafos:
        par = Paragraph(texto, estilo)
        _w, h = par.wrap(ancho, 400)
        par.drawOn(c, x0, y - h)
        y -= h + 14
    c.drawString(x0, y - 12, 'Cordialmente,')

    imagen('firma.png', 85, 553, 161, 68)
    c.drawString(x0, alto - 633, '_________________________')
    c.drawString(x0, alto - 648, emp['representante'])
    c.drawString(x0, alto - 662, 'C.C ' + str(emp.get('representante_cc', '')))
    c.drawString(x0, alto - 676, emp.get('representante_cargo', 'Representante Legal'))
    c.setFont('Helvetica-Bold', 10)
    for k, linea in enumerate(emp.get('pie', [])[:2]):
        c.drawCentredString(306, alto - 730 - 13 * k, linea)
    c.showPage(); c.save()
    return buf.getvalue()


def carta(usuario: str, payload: dict):
    """Genera la carta laboral del empleado cuyos tres datos coinciden. La cédula que va en la carta es la que la persona escribió (ya validada)."""
    empleado = _validar(usuario, payload, 'carta laboral')
    if not empleado.get('inicio') or not empleado.get('cargo_actual'):
        raise HTTPException(409, 'Faltan datos de tu contrato para generar la carta. Pídela en Administración.')
    hoy = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).date()
    pdf = _pdf_carta(empleado, re.sub(r'\D', '', str(payload.get('cedula', ''))), hoy)
    logging.info('RH carta laboral: la cuenta %s generó la carta de %s', usuario, empleado.get('id'))
    nombre = 'Carta laboral ' + ' '.join(p.capitalize() for p in str(empleado.get('nombre', '')).split()) + '.pdf'
    from urllib.parse import quote
    return Response(pdf, media_type='application/pdf', headers={'Content-Disposition': "attachment; filename*=utf-8''" + quote(nombre), 'Cache-Control': 'no-store',
                                                                'X-Content-Type-Options': 'nosniff'})
