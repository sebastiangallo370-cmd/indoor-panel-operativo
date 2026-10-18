"""CREAR CLIENTE (COMERCIALES): el comercial sube fotos, PDFs o pega texto con los datos de un cliente; el panel los lee (OCR / texto del PDF),
propone los campos, el comercial los revisa y, al confirmar, se crea el cliente en Effi por la API (POST /api/cliente).
Solo lo usan las cuentas que ven COMERCIALES. La API key de Effi es la misma que guarda ZEUS en el servidor."""
from __future__ import annotations

import io
import os
import re
import subprocess
import tempfile
import unicodedata
from typing import Callable

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app import effi_api

router = APIRouter(prefix='/api/cliente-effi', tags=['cliente-effi'])

_auth: Callable = lambda request: ''
_permitido: Callable[[str], bool] = lambda usuario: True
_llave: Callable[[], str] = lambda: ''

MAX_ARCHIVOS = 8
MAX_BYTES = 15 * 1024 * 1024
TIPOS_DNI = {1: 'NIT', 2: 'Cédula de ciudadanía', 3: 'Pasaporte', 4: 'Cédula de extranjería'}


def configurar(auth: Callable, permitido: Callable[[str], bool], llave: Callable[[], str]) -> None:
    global _auth, _permitido, _llave
    _auth, _permitido, _llave = auth, permitido, llave


def _usuario(request: Request) -> str:
    usuario = str(_auth(request) or '')
    if not _permitido(usuario):
        raise HTTPException(403, 'CREAR CLIENTE es solo para el equipo comercial')
    return usuario


def _con_llave() -> None:
    k = (_llave() or '').strip()
    if k:
        effi_api.usar_llave(k)
    if not effi_api.disponible():
        raise HTTPException(409, 'Falta la API key de Effi: la guarda la cuenta Indoor Sport en la pestaña «API Effi» de ZEUS.')


# ---------------------------------------------------------------- lectura de archivos
def _tesseract(ruta: str, *args: str) -> str:
    r = subprocess.run(['tesseract', ruta, 'stdout', *(args or ('-l', 'spa', '--psm', '6'))], capture_output=True, text=True, timeout=120)
    return r.stdout or ''


def _ocr_imagen(datos: bytes) -> str:
    from PIL import Image, ImageOps
    img = Image.open(io.BytesIO(datos))
    img = ImageOps.exif_transpose(img).convert('L')
    if max(img.size) < 1600:   # las fotos pequeñas se agrandan: el OCR lee mucho mejor
        f = 1600 / max(img.size)
        img = img.resize((int(img.width * f), int(img.height * f)))
    with tempfile.TemporaryDirectory() as d:
        ruta = os.path.join(d, 'x.png')
        img.save(ruta)
        return _tesseract(ruta)


def _texto_pdf(datos: bytes) -> str:
    import pdfplumber
    partes = []
    with pdfplumber.open(io.BytesIO(datos)) as pdf:
        for pagina in pdf.pages[:6]:
            t = (pagina.extract_text() or '').strip()
            if len(t) < 25:   # página escaneada: se lee como imagen
                with tempfile.TemporaryDirectory() as d:
                    ruta = os.path.join(d, 'p.png')
                    pagina.to_image(resolution=200).save(ruta)
                    t = _tesseract(ruta)
            partes.append(t)
    return '\n'.join(partes)


def leer_archivo(nombre: str, datos: bytes) -> str:
    n = (nombre or '').lower()
    if n.endswith('.pdf') or datos[:4] == b'%PDF':
        return _texto_pdf(datos)
    if n.endswith(('.txt', '.csv', '.md')):
        return datos.decode('utf-8', 'replace')
    return _ocr_imagen(datos)


# ---------------------------------------------------------------- RUT por casillas
# El formulario 001 de la DIAN siempre tiene la misma forma: cada casilla se lee recortada (mucho más fiable que el OCR de toda la página).
# Cajas en fracción de la página: (izquierda, arriba, derecha, abajo).
ZONAS_RUT = {
    'nit': (.05, .221, .31, .242), 'tipo': (.05, .262, .34, .280),
    'ap1': (.05, .322, .27, .344), 'ap2': (.255, .322, .455, .344), 'nom1': (.46, .322, .65, .344), 'nom2': (.655, .322, .97, .344),
    'razon': (.05, .356, .97, .375), 'depto': (.33, .433, .61, .450), 'ciudad': (.64, .433, .90, .450),
    'dir': (.05, .466, .60, .482), 'mail': (.17, .477, .50, .499), 'tel1': (.49, .493, .645, .515),
}


def _ocr_zona(img, caja, solo_digitos: bool = False) -> str:
    w, h = img.size
    x0, y0, x1, y1 = caja
    z = img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))).convert('L')
    z = z.resize((z.width * 3, z.height * 3))
    with tempfile.TemporaryDirectory() as d:
        ruta = os.path.join(d, 'z.png')
        z.save(ruta)
        args = ('--psm', '7', '-c', 'tessedit_char_whitelist=0123456789') if solo_digitos else ('-l', 'spa', '--psm', '7')
        return re.sub(r'\s+', ' ', _tesseract(ruta, *args)).strip()


def _ocr_correo(img, caja) -> str:
    from PIL import Image, ImageOps
    w, h = img.size
    x0, y0, x1, y1 = caja
    base = img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))).convert('L')
    for escala in (2, 6):
        z = base.resize((base.width * escala, base.height * escala), Image.LANCZOS).point(lambda px: 255 if px > 150 else 0)
        z = ImageOps.expand(z, 20, 255)
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, 'z.png')
            z.save(ruta)
            t = _tesseract(ruta, '--psm', '7', '-c', 'tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._-').strip().strip('_.- ')
        m = RE_EMAIL.search(t.lower())
        if m:
            return m.group(0)
    return ''


def _arreglar_correo(t: str) -> str:
    t = (t or '').strip().replace(' ', '').strip('.,;|')
    if '@' not in t:   # el OCR suele leer la arroba como 0, O, © o a
        t = re.sub(r'(?i)^(.{3,}?)[0o©@a]?((?:gmail|hotmail|outlook|yahoo|icloud|live|msn)\.[a-z.]{2,})$', r'\1@\2', t)
    return t.lower() if RE_EMAIL.fullmatch(t.lower()) else ''


def rut_por_zonas(img) -> dict:
    """Lee un RUT (formulario 001 de la DIAN) casilla por casilla. Devuelve los campos que pudo leer con sentido."""
    z = {k: (_ocr_correo(img, caja) if k == 'mail' else _ocr_zona(img, caja, solo_digitos=(k in ('nit', 'tel1')))) for k, caja in ZONAS_RUT.items()}
    c: dict = {}
    nit = _solo_digitos(z['nit'])
    if 6 <= len(nit) <= 10:
        c['numero'] = nit
    razon = z['razon'] if re.search(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}', z['razon']) and len(z['razon']) >= 3 else ''
    letras = lambda v: ' '.join(w for w in re.sub(r"[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]", ' ', v).split() if len(w) > 2)
    ap = [letras(z['ap1']), letras(z['ap2'])]
    no = [letras(z['nom1']), letras(z['nom2'])]
    if razon:
        c['nombre'], c['t_dni'], c['t_persona'] = _titulo(razon), 1, 2
    elif any(ap) and any(no):
        c['nombre'] = _titulo(' '.join(x for x in no + ap if x))
        c['t_dni'], c['t_persona'] = 2, 1
    d = _solo_digitos(z['tel1'])
    if len(d) > 10 and d.startswith('3'):
        d = d[:10]
    if len(d) == 10 and d.startswith('3'):
        c['celular'] = d
    elif 7 <= len(d) <= 10:
        c['telefono1'] = d
    if z['dir'] and re.search(r'\d', z['dir']):
        partes_dir = [w for w in z['dir'].split() if re.fullmatch(r'[\w#\-.,°º]+', w)]
        while len(partes_dir) > 2 and partes_dir[-1].isalpha() and len(partes_dir[-1]) <= 4 and any(ch.isdigit() for ch in ' '.join(partes_dir[:-1])) and any(ch.isdigit() for ch in partes_dir[-2]):
            partes_dir.pop()   # restos de la marca de agua o del borde de la casilla
        c['direccion'] = ' '.join(partes_dir)[:200]
    correo = _arreglar_correo(z['mail'])
    if correo:
        c['email'] = correo
    if letras(z['ciudad']):
        c['ciudad_texto'] = letras(z['ciudad'])
    if letras(z['depto']):
        c['provincia_texto'] = letras(z['depto'])   # solo palabras de más de 2 letras
    return c


def _imagen_primera_pagina(nombre: str, datos: bytes):
    n = (nombre or '').lower()
    if n.endswith('.pdf') or datos[:4] == b'%PDF':
        import pdfplumber
        with pdfplumber.open(io.BytesIO(datos)) as pdf:
            return pdf.pages[0].to_image(resolution=200).original.convert('RGB')
    if n.endswith(('.txt', '.csv', '.md')):
        return None
    from PIL import Image, ImageOps
    return ImageOps.exif_transpose(Image.open(io.BytesIO(datos))).convert('RGB')


def _es_rut(texto: str) -> bool:
    return bool(re.search(r'registro\s+[uú]nico\s+tributar|\bRUT\b|formulario del registro', texto or '', re.I))


# ---------------------------------------------------------------- interpretación del texto
def _plano(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').lower()


def _solo_digitos(s: str) -> str:
    return re.sub(r'\D', '', s or '')


RE_EMAIL = re.compile(r'[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+')
RE_NIT = re.compile(r'\bN\.?\s?I\.?\s?T\.?\s*[:#.\-]?\s*(\d[\d.]{6,12}\d)(?:\s*[-–]\s*\d)?(?![\d])', re.I)
RE_CC = re.compile(r'(?:\bC\.?\s?C\.?\b|c[eé]dula(?: de ciudadan[ií]a)?|\bidentificaci[oó]n|\bdocumento|\bCED\.?)\s*(?:No\.?|N[°º]|n[uú]mero|#)?\s*[:#.\-]?\s*(\d[\d.]{5,11}\d)(?![\d])', re.I)
RE_CE = re.compile(r'c[eé]dula de extranjer[ií]a\s*(?:No\.?|N[°º])?\s*[:#.\-]?\s*([\d][\d.\s]{5,12}\d)', re.I)
RE_CALLE = re.compile(r'\b(calle|cl\.?|carrera|cra\.?|kr\.?|cr\.?|avenida|av\.?|diagonal|dg\.?|transversal|tv\.?|circular|autopista|manzana|mz\.?|vereda|kil[oó]metro|km)\b\s*[\w#\-°º. ]*\d', re.I)
ETIQUETAS_NOMBRE = re.compile(r'^\s*(?:nombre(?: completo)?|raz[oó]n social|cliente|se[ñn]or(?:es)?|empresa|titular)\s*[:\-]\s*(.+)$', re.I)
ETIQUETAS_CIUDAD = re.compile(r'^\s*(?:ciudad|municipio|ciudad/municipio)\s*[:\-]\s*(.+)$', re.I)
ETIQUETAS_DIR = re.compile(r'^\s*(?:direcci[oó]n(?: de (?:env[ií]o|entrega|residencia))?|dir\.?|domicilio)\s*[:\-]\s*(.+)$', re.I)
PALABRAS_NO_NOMBRE = re.compile(r'\b(ubicaci[oó]n|seccional|lugar|dv|pa[ií]s|departamento|municipio|formulario|registro|tributario|concepto|actualizaci[oó]n|dian|espacio|impuestos|aduanas|apellido|nombres?|raz[oó]n|social|contribuyente|persona|natural|jur[ií]dica|responsabilidades|actividad|econ[oó]mica|nit|c\.?c\.?|c[eé]dula|tel[eé]fono|tel|celular|cel|whatsapp|correo|email|direcci[oó]n|ciudad|barrio|http|www|factura|cotizaci[oó]n|orden|fecha|total|valor)\b', re.I)


SIGLAS = {'SAS', 'S.A.S', 'S.A.S.', 'SA', 'S.A', 'S.A.', 'LTDA', 'LTDA.', 'EU', 'E.U', 'E.U.', 'ESP', 'IPS', 'EPS', 'CIA', 'Y', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'E'}


def _titulo(nombre: str) -> str:
    """Formato título («JUAN PEREZ» → «Juan Perez»); las siglas de sociedad (S.A.S., LTDA) quedan en mayúsculas y los conectores en minúscula."""
    out = []
    for i, w in enumerate(nombre.split(' ')):
        if w.upper() in ('SAS', 'S.A.S', 'S.A.S.', 'SA', 'S.A', 'S.A.', 'LTDA', 'LTDA.', 'E.U', 'E.U.', 'EU', 'ESP', 'IPS', 'EPS'):
            out.append(w.upper())
        elif i and w.lower() in ('y', 'de', 'del', 'la', 'las', 'los', 'el', 'e'):
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return ' '.join(out)


def _quitar_sufijo_dv(nit: str) -> str:
    return _solo_digitos(nit)


def _tras_etiqueta(lineas: list[str], etiqueta: str, valido=None) -> str:
    """Valor de una casilla del RUT: lo que sigue a la etiqueta en su misma línea o, si no hay, la línea de abajo."""
    rx = re.compile(etiqueta, re.I)
    for i, l in enumerate(lineas):
        m = rx.search(l)
        if not m:
            continue
        resto = re.sub(r'^[\s:.\-|)]+', '', l[m.end():]).strip()
        candidatos = ([resto] if resto else []) + lineas[i + 1:i + 3]
        for cand in candidatos:
            if cand and (valido is None or valido(cand)):
                return cand.strip()
    return ''


def _rut(lineas: list[str], t: str) -> dict:
    """Si el texto es un RUT de la DIAN, saca de sus casillas: NIT, razón social o nombres y apellidos, dirección, correo y teléfonos."""
    c: dict = {}
    solo_letras = lambda v: bool(re.fullmatch(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ.&' \-]{3,120}", v)) and not PALABRAS_NO_NOMBRE.search(v)
    nit = _tras_etiqueta(lineas, r'n[uú]mero de identificaci[oó]n tributaria|\b5\.?\s*n[uú]mero de identif', lambda v: bool(re.search(r'\d{6,}', v)) and len(_solo_digitos(v)) <= 11)
    if not nit:   # OCR desordenado: se busca un número de 9-10 dígitos en las líneas que siguen a «Identificación Tributaria»
        for i, l in enumerate(lineas):
            if re.search(r'identi\w*ci\w*n tributaria|\bNIT\b', l, re.I):
                m = re.search(r'(?<![\d])(\d{8,10})(?![\d])(?:\s*[|\-]?\s*\d)?', ' '.join(lineas[i:i + 3]))
                if m:
                    nit = m.group(0)
                    break
    if nit:
        d = _solo_digitos(nit)
        c['numero'] = d[:-1] if len(d) in (10, 11) and re.search(r'\d[\s\-|]+\d$', nit) else d[:10]
    juridica = bool(re.search(r'persona jur[ií]dica', t, re.I)) and not re.search(r'persona natural', t, re.I)
    razon = _tras_etiqueta(lineas, r'35\.?\s*raz[oó]n social|\braz[oó]n social', lambda v: bool(re.search(r'[A-Za-zÁÉÍÓÚÑ]{3}', v)) and len(_solo_digitos(v)) < 6 and not PALABRAS_NO_NOMBRE.search(v) and '@' not in v)
    if razon and juridica or (razon and not re.search(r'primer apellido', t, re.I)):
        c['nombre'] = razon
        c['t_dni'], c['t_persona'] = 1, 2
    else:
        pal = _tras_etiqueta(lineas, r'primer apellido', lambda v: len(v.split()) >= 2 and solo_letras(v))
        w = pal.split()
        if 2 <= len(w) <= 6:
            ap, no = (w[:2], w[2:]) if len(w) >= 4 else ((w[:2], w[2:]) if len(w) == 3 else (w[:1], w[1:]))
            c['nombre'] = ' '.join(no + ap)
            c['t_dni'], c['t_persona'] = 2, 1
    for etiqueta, clave in ((r'41\.?\s*direcci[oó]n principal|\bdirecci[oó]n principal', 'direccion'),):
        v = _tras_etiqueta(lineas, etiqueta, lambda v: bool(re.search(r'\d', v)) and not PALABRAS_NO_NOMBRE.search(v))
        if v:
            c[clave] = v
    tel = _tras_etiqueta(lineas, r'tel[eé]fono\s*1', lambda v: 7 <= len(_solo_digitos(v)) <= 10)
    if tel:
        d = _solo_digitos(tel)
        c['celular' if d.startswith('3') and len(d) == 10 else 'telefono1'] = d
    return c


def interpretar(texto: str) -> dict:
    """Saca del texto lo que se reconoce: tipo y número de identificación, nombre, correo, teléfonos, dirección y ciudad (sin tocar Effi)."""
    t = (texto or '').replace('\r', '')
    lineas = [re.sub(r'\s+', ' ', l).strip() for l in t.split('\n')]
    lineas = [l for l in lineas if l]
    c: dict = {}
    es_rut = bool(re.search(r'registro [uú]nico tributario|\bRUT\b', t, re.I))
    rut = _rut(lineas, t) if es_rut else {}

    m = RE_EMAIL.search(t)
    if m:
        c['email'] = m.group(0).lower().strip('.,;')

    m = RE_NIT.search(t) if not rut.get('numero') else None
    if m:
        c['t_dni'] = 1
        c['t_persona'] = 2
        c['numero'] = _quitar_sufijo_dv(m.group(1))
    else:
        m = RE_CE.search(t)
        if m:
            c['t_dni'], c['numero'] = 4, _solo_digitos(m.group(1))
        else:
            m = RE_CC.search(t)
            if m:
                c['t_dni'], c['numero'] = 2, _solo_digitos(m.group(1))
    if rut.get('numero'):
        c['numero'] = rut['numero']
    if not c.get('numero') and not es_rut:
        sueltos = [x for x in re.findall(r'(?<![\d.])(\d{1,3}(?:\.\d{3}){2}|\d{8,10})(?![\d.])', t) if not _solo_digitos(x).startswith('3') or len(_solo_digitos(x)) != 10]
        if sueltos:
            c['t_dni'], c['numero'] = 2, _solo_digitos(sueltos[0])
    if c.get('numero'):
        c['numero'] = c['numero'][:15]

    celulares, fijos = [], []
    for x in re.findall(r'(?<!\d)(?:\+?57[\s.\-]*)?((?:\d[\s.\-]*){7,10})(?!\d)', t):
        d = _solo_digitos(x)
        if c.get('numero') and d == c['numero']:
            continue
        if len(d) == 10 and d.startswith('3'):
            if d not in celulares:
                celulares.append(d)
        elif len(d) in (7, 10) and d.startswith('60') and d not in fijos:
            fijos.append(d)
    if celulares:
        c['celular'] = celulares[0]
        c['whatsapp'] = celulares[0]
    if fijos:
        c['telefono1'] = fijos[0]
    elif len(celulares) > 1:
        c['telefono1'] = celulares[1]

    for l in lineas:
        m = ETIQUETAS_NOMBRE.match(l)
        if m and not c.get('nombre'):
            c['nombre'] = m.group(1).strip(' .,;')
        m = ETIQUETAS_DIR.match(l)
        if m and not c.get('direccion'):
            c['direccion'] = m.group(1).strip(' .,;')
        m = ETIQUETAS_CIUDAD.match(l)
        if m and not c.get('ciudad_texto'):
            c['ciudad_texto'] = m.group(1).strip(' .,;')
    if not c.get('direccion'):
        for l in lineas:
            if RE_CALLE.search(l):
                c['direccion'] = l.strip(' .,;')
                break
    if not c.get('nombre'):
        for l in lineas:
            if PALABRAS_NO_NOMBRE.search(l) or RE_EMAIL.search(l) or RE_CALLE.search(l) or sum(ch.isdigit() for ch in l) > 2:
                continue
            palabras = [w for w in re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.]+", l) if len(w) > 1]
            if 2 <= len(palabras) <= 7:
                c['nombre'] = l.strip(' ,;:-|')
                break
    if re.search(r'\b49\b\s*[-–]?\s*no responsable', t, re.I) or re.search(r'no responsable de iva', t, re.I):
        c['t_regimen_iva'] = 5
    elif re.search(r'r[eé]gimen simple|responsable del impuesto nacional al consumo|\bsimple de tributaci[oó]n', t, re.I):
        c['t_regimen_iva'] = 3
    elif re.search(r'responsable de iva|\b48\b\s*[-–]?\s*impuesto sobre las ventas', t, re.I):
        c['t_regimen_iva'] = 4
    if c.get('nombre'):
        c['nombre'] = _titulo(re.sub(r'\s+', ' ', c['nombre']))[:120]
        if c.get('t_persona') != 2 and re.search(r'\b(s\.?a\.?s?\.?|ltda\.?|s\.?a\.?|e\.?u\.?|& ?cia|sas)\b', c['nombre'], re.I):
            c['t_persona'] = 2
    for k, v in rut.items():
        if k != 'numero':
            c[k] = v
    if c.get('nombre'):
        c['nombre'] = _titulo(c['nombre'])[:120]
    if c.get('direccion'):
        cola = re.match(r'^(.*\d.*),\s*([A-Za-zÁÉÍÓÚÑáéíóúñ .]{3,30})$', c['direccion'])
        if cola:   # «Carrera 7 # 45-12, Bogotá»: lo último es la ciudad
            c['direccion'] = cola.group(1).strip()
            c.setdefault('ciudad_texto', cola.group(2).strip())
        c['direccion'] = c['direccion'][:200]
    return c


def _candidatos_ciudad(c: dict, texto: str) -> list[str]:
    """Nombres que pueden ser la ciudad, del más probable al menos."""
    out: list[str] = []
    if c.get('ciudad_texto'):
        out += [p.strip() for p in re.split(r'[,/\-–]', c['ciudad_texto']) if p.strip()]
    base = c.get('direccion') or ''
    if base:
        out += [p.strip(' .') for p in reversed(re.split(r'[,\-–]', texto[texto.find(base):texto.find(base) + len(base) + 80])) if p.strip()]
    vistos, res = set(), []
    for x in out:
        k = _plano(x)
        if 3 <= len(k) <= 40 and k not in vistos and not re.search(r'\d', k) and not RE_CALLE.search(x):
            vistos.add(k)
            res.append(x)
    return res[:5]


def resolver_ciudad(candidatos: list[str], provincia: str = '') -> dict | None:
    """Busca la ciudad en Effi (tabla global). Gana la que coincide exacta (sin tildes); si no, la primera parcial."""
    for nombre in candidatos:
        try:
            lista = effi_api._lista('ciudad', {'nombre': nombre})
        except effi_api.EffiError:
            continue
        if not lista:
            continue
        palabras_prov = [w for w in _plano(provincia).split() if len(w) >= 4]
        de_la_provincia = [x for x in lista if palabras_prov and any(w in _plano(x.get('nombre_provincia', '')) for w in palabras_prov)] or lista
        exacta = [x for x in de_la_provincia if _plano(x.get('nombre', '')) == _plano(nombre)]
        elegida = (exacta or de_la_provincia)[0]
        return {'id_ciudad': int(elegida['id']), 'id_provincia': int(elegida['provincia']), 'ciudad': elegida.get('nombre', ''), 'provincia': elegida.get('nombre_provincia', '')}
    return None


def existentes(numero: str, nombre: str) -> list[dict]:
    """Clientes que ya están en Effi con ese número o con un nombre parecido (para no duplicar)."""
    vistos: dict = {}
    consultas = []
    if numero:
        consultas.append({'numero': numero})
    palabras = [w for w in re.findall(r'\w+', nombre or '') if len(w) > 2][:4]
    if palabras:
        consultas.append({'nombre': ' '.join(palabras)})
    for params in consultas:
        try:
            for x in effi_api._lista('cliente', params)[:8]:
                vistos.setdefault(str(x.get('tercero')), {'tercero': str(x.get('tercero')), 'nombre': x.get('nombre', ''), 'documento': f"{x.get('abreviacion') or ''} {x.get('id') or ''}".strip(), 'mismo_numero': bool(numero) and _solo_digitos(str(x.get('id'))) == numero})
        except effi_api.EffiError:
            continue
    return list(vistos.values())[:6]


def conflictos(fuentes: list[str]) -> list[str]:
    """Si dos fuentes dicen cosas distintas (otro número, otro correo, otro celular) se avisa en vez de elegir por cuenta propia."""
    if len(fuentes) < 2:
        return []
    datos = [interpretar(f) for f in fuentes]
    avisos = []
    for k, etiqueta in (('numero', 'número de identificación'), ('email', 'correo'), ('celular', 'celular')):
        valores = sorted({d[k] for d in datos if d.get(k)})
        if len(valores) > 1:
            avisos.append(f'Las fuentes no coinciden en el {etiqueta}: ' + ' / '.join(valores) + '. Revisa cuál es el correcto.')
    return avisos


# ---------------------------------------------------------------- rutas
@router.get('/estado')
def estado(request: Request):
    _usuario(request)
    return {'api': bool((_llave() or '').strip() or effi_api.disponible()), 'tipos_dni': [{'id': k, 'nombre': v} for k, v in TIPOS_DNI.items()]}


@router.post('/leer')
async def leer(request: Request, texto: str = Form(''), archivos: list[UploadFile] = File(default=[])):
    _usuario(request)
    if len(archivos) > MAX_ARCHIVOS:
        raise HTTPException(400, f'Máximo {MAX_ARCHIVOS} archivos por vez')
    partes, avisos, zonas = [], [], {}
    if texto.strip():
        partes.append(texto.strip())
    for a in archivos:
        datos = await a.read()
        if len(datos) > MAX_BYTES:
            avisos.append(f'«{a.filename}» pesa demasiado (máximo 15 MB) y se omitió.')
            continue
        try:
            t = leer_archivo(a.filename or '', datos).strip()
        except Exception:   # archivo dañado o formato no soportado: se avisa y se sigue con los demás
            avisos.append(f'No se pudo leer «{a.filename}».')
            continue
        if _es_rut(t):
            try:
                img = _imagen_primera_pagina(a.filename or '', datos)
                if img is not None:
                    zonas = rut_por_zonas(img)
            except Exception:   # si la lectura por casillas falla se sigue con el texto completo
                zonas = {}
        if not t:
            avisos.append(f'«{a.filename}» no tiene texto legible.')
        partes.append(t)
    leido = '\n'.join(p for p in partes if p)
    if not leido.strip():
        raise HTTPException(422, 'No se encontró texto en lo que subiste. Prueba con una foto más clara o escribe los datos.')
    campos = interpretar(leido)
    if zonas:   # las casillas del RUT leídas una a una mandan sobre el texto corrido
        for k in ('t_dni', 't_persona', 'numero', 'nombre', 'celular', 'telefono1', 'direccion', 'email', 'ciudad_texto'):
            if zonas.get(k):
                campos[k] = zonas[k]
        if zonas.get('celular'):
            campos['whatsapp'] = zonas['celular']
        campos['provincia_texto'] = zonas.get('provincia_texto', '')
    avisos += conflictos(partes)
    ciudad = None
    if effi_api.disponible() or (_llave() or '').strip():
        try:
            _con_llave()
            ciudad = resolver_ciudad(_candidatos_ciudad(campos, leido), campos.pop('provincia_texto', ''))
        except HTTPException:
            pass
    if ciudad:
        campos.update(ciudad)
    elif campos.get('ciudad_texto') or campos.get('direccion'):
        avisos.append('No pude identificar la ciudad: escríbela en el cuadro de ciudad.')
    ya = []
    if (campos.get('numero') or campos.get('nombre')) and ((_llave() or '').strip() or effi_api.disponible()):
        try:
            _con_llave()
            ya = existentes(campos.get('numero', ''), campos.get('nombre', ''))
        except HTTPException:
            pass
    return {'texto': leido[:6000], 'campos': campos, 'avisos': avisos, 'existentes': ya}


@router.get('/ciudades')
def ciudades(request: Request, q: str = ''):
    _usuario(request)
    q = (q or '').strip()
    if len(q) < 3:
        return {'ciudades': []}
    _con_llave()
    try:
        lista = effi_api._lista('ciudad', {'nombre': q})
    except effi_api.EffiError as e:
        raise HTTPException(502, str(e))
    return {'ciudades': [{'id': int(x['id']), 'nombre': x.get('nombre', ''), 'id_provincia': int(x['provincia']), 'provincia': x.get('nombre_provincia', '')} for x in lista[:20]]}


def _cuerpo_cliente(p: dict) -> dict:
    """Arma el cuerpo de POST /api/cliente con lo que confirmó el comercial."""
    def texto(k, largo=255):
        return str(p.get(k) or '').strip()[:largo]
    try:
        t_dni = int(p.get('t_dni') or 0)
    except (TypeError, ValueError):
        t_dni = 0
    if t_dni not in TIPOS_DNI:
        raise HTTPException(400, 'Elige el tipo de identificación.')
    numero = _solo_digitos(texto('numero', 20)) if t_dni != 3 else texto('numero', 20)
    if not numero:
        raise HTTPException(400, 'Escribe el número de identificación (sin dígito de verificación).')
    nombre = texto('nombre', 120)
    if len(nombre) < 3:
        raise HTTPException(400, 'Escribe el nombre o razón social.')
    cuerpo: dict = {'t_dni': t_dni, 'numero': numero, 'nombre': nombre, 't_persona': 2 if str(p.get('t_persona')) == '2' else 1}
    for k, largo in (('email', 255), ('observacion', 255)):
        if texto(k, largo):
            cuerpo[k] = texto(k, largo)
    for k in ('celular', 'whatsapp'):
        d = _solo_digitos(texto(k, 25))
        if d:
            cuerpo[k] = d[-15:]
    for k in ('telefono1', 'telefono2'):
        d = _solo_digitos(texto(k, 25))
        if d:
            cuerpo[k] = d[:15]
    if not re.fullmatch(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+(?:\s*,\s*[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+)*", cuerpo.get('email', '')):
        raise HTTPException(400, 'Falta el correo electrónico del cliente (o no es válido): Effi lo exige. No lo inventes: pídeselo al cliente.')
    if not (texto('direccion', 200) and p.get('id_ciudad') and p.get('id_provincia')):
        raise HTTPException(400, 'Falta la dirección completa (departamento, ciudad y dirección): elige la ciudad de la lista y escribe la dirección.')
    if str(p.get('t_regimen_iva') or '') in ('3', '4', '5'):
        cuerpo['t_regimen_iva'] = int(p['t_regimen_iva'])
    cuerpo.update({'t_cliente': 1, 'divisa': 'COP', 'permitir_venta': 1})
    direccion = {}
    for k_in, k_out in (('id_provincia', 'id_provincia'), ('id_ciudad', 'id_ciudad')):
        try:
            if p.get(k_in):
                direccion[k_out] = int(p[k_in])
        except (TypeError, ValueError):
            raise HTTPException(400, 'La ciudad no es válida: elígela de la lista.')
    if texto('direccion', 200):
        direccion['direccion'] = texto('direccion', 200)
    if texto('referencia', 200):
        direccion['referencia'] = texto('referencia', 200)
    if direccion:
        cuerpo['direcciones'] = [direccion]
    return cuerpo


@router.post('/crear')
def crear(request: Request, payload: dict):
    usuario = _usuario(request)
    _con_llave()
    cuerpo = _cuerpo_cliente(payload or {})
    cuerpo['observacion'] = (cuerpo.get('observacion', '') + (' · ' if cuerpo.get('observacion') else '') + f'Creado desde el panel por {usuario}')[:255]
    try:
        r = effi_api._peticion('POST', 'cliente', cuerpo=cuerpo)
    except effi_api.EffiError as e:
        raise HTTPException(e.estado if e.estado in (400, 401, 403, 409) else 502, str(e))
    d = r.get('data') or {}
    return {'ok': True, 'tercero': d.get('tercero'), 'nombre': d.get('nombre') or cuerpo['nombre'], 'documento': f"{d.get('abreviacion') or TIPOS_DNI.get(cuerpo['t_dni'], '')} {d.get('id') or cuerpo['numero']}" + (f"-{d['dv']}" if d.get('dv') not in (None, '') else '')}
