"""Personalización de la página que ve el cliente (Tienda Club): el escudo del club y sus colores.

El escudo sale, en este orden, de lo que subió el comercial o de un archivo «ESCUDO»/«LOGO» de la carpeta del cliente en la NAS (raíz, OTROS, LOGOS,
MAESTROS…). Los dos colores se sacan solos del escudo y el comercial puede corregirlos. Todo se guarda por enlace en /data/state/club_temas/<id>/:
escudo.png (recortado, máx. 512 px) y tema.json {origen, c1, c2, manual, buscado}. Sin escudo la página queda con el logo y los colores de Indoor.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import time
from pathlib import Path

from app import listado_tallas

log = logging.getLogger('club_tema')
DIR = Path(os.getenv('CLUB_TEMAS_DIR', '/data/state/club_temas'))
CARPETAS = {'OTROS', 'LOGO', 'LOGOS', 'ESCUDO', 'ESCUDOS', 'MAESTROS', 'DISENO', 'DISEÑO', 'MARCA', 'BRANDING'}
EXT = {'.png': 4, '.jpg': 3, '.jpeg': 3, '.webp': 3, '.pdf': 2}
REINTENTO_SEG = 3600          # si no hay escudo en la NAS, se vuelve a buscar cada hora
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')


def _carpeta_cliente(cliente: str) -> Path | None:
    base = listado_tallas.NAS_CLIENTES
    directo = base / cliente
    if directo.is_dir():
        return directo
    clave = listado_tallas._codigo(cliente)
    try:
        return next((base / d for d in os.listdir(base) if listado_tallas._codigo(d) == clave), None)
    except OSError:
        return None


def _puntos(nombre: str) -> int:
    n = listado_tallas._codigo(nombre)
    if 'INDOOR' in n:
        return 0
    return 3 if 'ESCUDO' in n else 2 if 'LOGO' in n else 0


def buscar_escudo(cliente: str) -> Path | None:
    """El mejor archivo de escudo/logo del cliente en la NAS (sin recorrer las carpetas de cada orden)."""
    raiz = _carpeta_cliente(cliente)
    if not raiz:
        return None
    sitios = [raiz]
    try:
        sitios += [raiz / d for d in os.listdir(raiz) if d.upper() in CARPETAS and (raiz / d).is_dir()]
    except OSError:
        return None
    mejor, mejor_p = None, 0
    for sitio in sitios:
        try:
            archivos = list(os.scandir(sitio))
        except OSError:
            continue
        for a in archivos:
            ext = os.path.splitext(a.name)[1].lower()
            p = _puntos(a.name)
            if not a.is_file() or ext not in EXT or not p:
                continue
            p = p * 10 + EXT[ext]
            if p > mejor_p:
                mejor, mejor_p = Path(a.path), p
    return mejor


def a_png(datos: bytes, nombre: str = '') -> bytes:
    """Imagen o PDF → PNG recortado al contenido y de máximo 512 px. Lanza ValueError si no se puede leer."""
    from PIL import Image, ImageChops
    try:
        if nombre.lower().endswith('.pdf') or datos[:4] == b'%PDF':
            import pdfplumber
            with pdfplumber.open(io.BytesIO(datos)) as pdf:
                im = pdf.pages[0].to_image(resolution=160).original.convert('RGBA')
        else:
            im = Image.open(io.BytesIO(datos)).convert('RGBA')
    except Exception as e:   # noqa: BLE001
        raise ValueError('No pude leer ese archivo como imagen') from e
    fondo = Image.new('RGBA', im.size, (255, 255, 255, 255))
    plano = Image.alpha_composite(fondo, im)
    plano = _una_pieza(plano)
    caja = ImageChops.difference(plano.convert('RGB'), Image.new('RGB', im.size, (255, 255, 255))).getbbox()
    if caja:
        mx, my = int((caja[2] - caja[0]) * .04), int((caja[3] - caja[1]) * .04)
        caja = (max(0, caja[0] - mx), max(0, caja[1] - my), min(im.width, caja[2] + mx), min(im.height, caja[3] + my))
        plano = plano.crop(caja)
    plano.thumbnail((512, 512))
    salida = io.BytesIO()
    plano.convert('RGB').save(salida, 'PNG', optimize=True)
    return salida.getvalue()


def _una_pieza(plano):
    """Los archivos de escudo para vinilo/sticker suelen traer el mismo escudo repetido en una hoja (con marcas de corte). Si hay varias piezas iguales
    se queda con la primera (arriba a la izquierda); si es un solo escudo, no toca nada."""
    from PIL import ImageChops, Image
    ancho = 300
    esc = ancho / plano.width
    chico = plano.convert('RGB').resize((ancho, max(1, int(plano.height * esc))), Image.BOX)
    dif = ImageChops.difference(chico, Image.new('RGB', chico.size, (255, 255, 255))).convert('L').point(lambda v: 255 if v > 40 else 0)
    w, h = dif.size
    px = dif.load()
    visto = [[False] * w for _ in range(h)]
    piezas = []
    for y0 in range(h):
        for x0 in range(w):
            if px[x0, y0] and not visto[y0][x0]:
                cola, visto[y0][x0] = [(x0, y0)], True
                x1 = x2 = x0
                y1 = y2 = y0
                n = 0
                while cola:
                    x, y = cola.pop()
                    n += 1
                    x1, x2, y1, y2 = min(x1, x), max(x2, x), min(y1, y), max(y2, y)
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not visto[ny][nx]:
                                visto[ny][nx] = True
                                cola.append((nx, ny))
                piezas.append((n, x1, y1, x2, y2))
    if not piezas:
        return plano
    mayor = max(p[0] for p in piezas)
    grandes = [p for p in piezas if p[0] >= mayor * .5]
    if len(grandes) < 3:
        return plano
    a0 = grandes[0]
    parecidas = [p for p in grandes if .7 <= (p[3] - p[1] + 1) / (a0[3] - a0[1] + 1) <= 1.4 and .7 <= (p[4] - p[2] + 1) / (a0[4] - a0[2] + 1) <= 1.4]
    if len(parecidas) < 3:
        return plano
    n, x1, y1, x2, y2 = min(parecidas, key=lambda p: (p[2] // 20, p[1]))
    return plano.crop((max(0, int(x1 / esc) - 3), max(0, int(y1 / esc) - 3), min(plano.width, int((x2 + 1) / esc) + 3), min(plano.height, int((y2 + 1) / esc) + 3)))


def _hex(rgb) -> str:
    return '#%02x%02x%02x' % tuple(int(v) for v in rgb)


def colores(png: bytes) -> tuple[str, str]:
    """Los dos colores más presentes del escudo, sin blancos, negros ni grises (si no hay otros, se aceptan)."""
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert('RGB')
    im.thumbnail((96, 96))
    cuenta: dict[tuple, int] = {}
    for r, g, b in im.getdata():
        mx, mn = max(r, g, b), min(r, g, b)
        if mn > 225 or mx < 45 or (mx - mn) < 40:
            continue
        k = (r // 32 * 32 + 16, g // 32 * 32 + 16, b // 32 * 32 + 16)
        cuenta[k] = cuenta.get(k, 0) + 1
    orden = sorted(cuenta.items(), key=lambda x: -x[1])
    if not orden:
        return '#d0f44c', '#8bd450'
    c1 = orden[0][0]
    c2 = next((c for c, _ in orden[1:] if sum(abs(a - b) for a, b in zip(c, c1)) > 120), None)
    return _hex(c1), _hex(c2 or c1)


def _dir(link_id: int) -> Path:
    return DIR / str(int(link_id))


def leer(link_id: int) -> dict:
    try:
        return json.loads((_dir(link_id) / 'tema.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _guardar(link_id: int, t: dict) -> None:
    d = _dir(link_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / 'tema.json').write_text(json.dumps(t, ensure_ascii=False), encoding='utf-8')


def png_de(link_id: int) -> bytes | None:
    try:
        return (_dir(link_id) / 'escudo.png').read_bytes()
    except OSError:
        return None


def tema(link_id: int, cliente: str, buscar: bool = True) -> dict:
    """{escudo: bool, origen, c1, c2, manual}. Si todavía no hay escudo, lo busca en la NAS (como mucho una vez por hora)."""
    t = leer(link_id)
    tiene = png_de(link_id) is not None
    if not tiene and buscar and time.time() - float(t.get('buscado') or 0) > REINTENTO_SEG:
        t['buscado'] = time.time()
        try:
            f = buscar_escudo(cliente)
            if f and f.stat().st_size < 25 * 1024 * 1024:
                png = a_png(f.read_bytes(), f.name)
                _dir(link_id).mkdir(parents=True, exist_ok=True)
                (_dir(link_id) / 'escudo.png').write_bytes(png)
                t['v'] = int(t.get('v') or 0) + 1
                t['origen'] = f'NAS · {f.name}'
                if not t.get('manual'):
                    t['c1'], t['c2'] = colores(png)
                tiene = True
        except Exception:   # noqa: BLE001  (NAS caída o archivo raro: se queda con el logo de Indoor)
            log.exception('No pude buscar el escudo de %s', cliente)
        _guardar(link_id, t)
    return {'escudo': tiene, 'origen': t.get('origen', ''), 'c1': t.get('c1', ''), 'c2': t.get('c2', ''), 'manual': bool(t.get('manual')),
            'v': int(t.get('v') or 0)}


def subir_escudo(link_id: int, datos: bytes, nombre: str) -> dict:
    png = a_png(datos, nombre)
    _dir(link_id).mkdir(parents=True, exist_ok=True)
    (_dir(link_id) / 'escudo.png').write_bytes(png)
    t = leer(link_id)
    t.update(origen='Subido por comercial', v=int(t.get('v') or 0) + 1)
    if not t.get('manual'):
        t['c1'], t['c2'] = colores(png)
    _guardar(link_id, t)
    return tema(link_id, '', buscar=False)


def poner_colores(link_id: int, c1: str, c2: str) -> dict:
    if not (HEX.match(c1 or '') and HEX.match(c2 or '')):
        raise ValueError('Los colores deben ser como #1a2b3c')
    t = leer(link_id)
    t.update(c1=c1.lower(), c2=c2.lower(), manual=True)
    _guardar(link_id, t)
    return tema(link_id, '', buscar=False)


def restablecer_colores(link_id: int) -> dict:
    t = leer(link_id)
    t['manual'] = False
    png = png_de(link_id)
    if png:
        t['c1'], t['c2'] = colores(png)
    else:
        t.pop('c1', None), t.pop('c2', None)
    _guardar(link_id, t)
    return tema(link_id, '', buscar=False)
