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
def _tesseract(ruta: str) -> str:
    r = subprocess.run(['tesseract', ruta, 'stdout', '-l', 'spa', '--psm', '6'], capture_output=True, text=True, timeout=120)
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


# ---------------------------------------------------------------- interpretación del texto
def _plano(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').lower()


def _solo_digitos(s: str) -> str:
    return re.sub(r'\D', '', s or '')


RE_EMAIL = re.compile(r'[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+')
RE_NIT = re.compile(r'\bN\.?\s?I\.?\s?T\.?\s*[:#.\-]?\s*([\d][\d.\s]{6,13}\d)(?:\s*[-–]\s*\d)?', re.I)
RE_CC = re.compile(r'(?:\bC\.?\s?C\.?\b|c[eé]dula(?: de ciudadan[ií]a)?|\bidentificaci[oó]n|\bdocumento|\bCED\.?)\s*(?:No\.?|N[°º]|n[uú]mero|#)?\s*[:#.\-]?\s*([\d][\d.\s]{5,12}\d)', re.I)
RE_CE = re.compile(r'c[eé]dula de extranjer[ií]a\s*(?:No\.?|N[°º])?\s*[:#.\-]?\s*([\d][\d.\s]{5,12}\d)', re.I)
RE_CALLE = re.compile(r'\b(calle|cl\.?|carrera|cra\.?|kr\.?|cr\.?|avenida|av\.?|diagonal|dg\.?|transversal|tv\.?|circular|autopista|manzana|mz\.?|vereda|kil[oó]metro|km)\b\s*[\w#\-°º. ]*\d', re.I)
ETIQUETAS_NOMBRE = re.compile(r'^\s*(?:nombre(?: completo)?|raz[oó]n social|cliente|se[ñn]or(?:es)?|empresa|titular)\s*[:\-]\s*(.+)$', re.I)
ETIQUETAS_CIUDAD = re.compile(r'^\s*(?:ciudad|municipio|ciudad/municipio)\s*[:\-]\s*(.+)$', re.I)
ETIQUETAS_DIR = re.compile(r'^\s*(?:direcci[oó]n(?: de (?:env[ií]o|entrega|residencia))?|dir\.?|domicilio)\s*[:\-]\s*(.+)$', re.I)
PALABRAS_NO_NOMBRE = re.compile(r'\b(nit|c\.?c\.?|c[eé]dula|tel[eé]fono|tel|celular|cel|whatsapp|correo|email|direcci[oó]n|ciudad|barrio|http|www|factura|cotizaci[oó]n|orden|fecha|total|valor)\b', re.I)


def _quitar_sufijo_dv(nit: str) -> str:
    return _solo_digitos(nit)


def interpretar(texto: str) -> dict:
    """Saca del texto lo que se reconoce: tipo y número de identificación, nombre, correo, teléfonos, dirección y ciudad (sin tocar Effi)."""
    t = (texto or '').replace('\r', '')
    lineas = [re.sub(r'\s+', ' ', l).strip() for l in t.split('\n')]
    lineas = [l for l in lineas if l]
    c: dict = {}

    m = RE_EMAIL.search(t)
    if m:
        c['email'] = m.group(0).lower().strip('.,;')

    m = RE_NIT.search(t)
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
    if not c.get('numero'):
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
        elif len(d) in (7, 10) and (d.startswith('60') or len(d) == 7) and d not in fijos:
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
    if c.get('nombre'):
        c['nombre'] = re.sub(r'\s+', ' ', c['nombre'])[:120]
        if c.get('t_persona') != 2 and re.search(r'\b(s\.?a\.?s?\.?|ltda\.?|s\.?a\.?|e\.?u\.?|& ?cia|sas)\b', c['nombre'], re.I):
            c['t_persona'] = 2
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


def resolver_ciudad(candidatos: list[str]) -> dict | None:
    """Busca la ciudad en Effi (tabla global). Gana la que coincide exacta (sin tildes); si no, la primera parcial."""
    for nombre in candidatos:
        try:
            lista = effi_api._lista('ciudad', {'nombre': nombre})
        except effi_api.EffiError:
            continue
        if not lista:
            continue
        exacta = [x for x in lista if _plano(x.get('nombre', '')) == _plano(nombre)]
        elegida = (exacta or lista)[0]
        return {'id_ciudad': int(elegida['id']), 'id_provincia': int(elegida['provincia']), 'ciudad': elegida.get('nombre', ''), 'provincia': elegida.get('nombre_provincia', '')}
    return None


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
    partes, avisos = [], []
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
        if not t:
            avisos.append(f'«{a.filename}» no tiene texto legible.')
        partes.append(t)
    leido = '\n'.join(p for p in partes if p)
    if not leido.strip():
        raise HTTPException(422, 'No se encontró texto en lo que subiste. Prueba con una foto más clara o escribe los datos.')
    campos = interpretar(leido)
    ciudad = None
    if effi_api.disponible() or (_llave() or '').strip():
        try:
            _con_llave()
            ciudad = resolver_ciudad(_candidatos_ciudad(campos, leido))
        except HTTPException:
            pass
    if ciudad:
        campos.update(ciudad)
    elif campos.get('ciudad_texto') or campos.get('direccion'):
        avisos.append('No pude identificar la ciudad: escríbela en el cuadro de ciudad.')
    return {'texto': leido[:6000], 'campos': campos, 'avisos': avisos}


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
