"""MOLDERIA: explorador de las carpetas de moldería de la NAS (solo lectura), con dos pestañas:
FICHAS TÉCNICAS (DIRECCION PRODUCCION/ESTANDAR 2026/FICHAS TECNICAS) y MOLDERIA (MAESTROS DE MOLDERIA y MOLDERIA).
Solo se puede mirar lo que está dentro de esas carpetas: cualquier ruta que salga de ellas se rechaza.
"""
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from app import fichas as fichas_mod
from fastapi.responses import FileResponse

router = APIRouter(prefix='/api/molderia', tags=['molderia'])

_NAS = Path(os.getenv('NAS_ROOT', '/mnt/nas'))
_PRODUCCION = _NAS / 'DIRECCION PRODUCCION'

TABS = {
    'fichas': {
        'titulo': 'FICHAS TÉCNICAS',
        'raices': {'FICHAS TECNICAS': _PRODUCCION / 'ESTANDAR 2026' / 'FICHAS TECNICAS'},
    },
    'molderia': {
        'titulo': 'MOLDERIA',
        'raices': {'ILLUSTRATOR (EDICION)': _PRODUCCION / 'ESTANDAR 2026' / 'ILLUSTRATOR (EDICION)',
                   'MAESTROS DE MOLDERIA': _PRODUCCION / 'MAESTROS DE MOLDERIA', 'MOLDERIA': _PRODUCCION / 'MOLDERIA'},
    },
}
_VISIBLES_INLINE = {'.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}
MAX_ENTRADAS = 3000


def _resolver(tab: str, ruta: str):
    """(raíz, destino) dentro de la carpeta permitida; (None, None) para la lista de raíces de la pestaña."""
    if tab not in TABS:
        raise HTTPException(404, 'Pestaña no encontrada')
    partes = [p for p in str(ruta or '').replace('\\', '/').split('/') if p]
    if any(p in ('.', '..') for p in partes):
        raise HTTPException(400, 'Ruta no válida')
    raices = TABS[tab]['raices']
    if not partes:
        return None, None
    raiz = raices.get(partes[0])
    if raiz is None:
        raise HTTPException(404, 'Carpeta no encontrada')
    destino = raiz.joinpath(*partes[1:])
    try:
        if not destino.resolve().is_relative_to(raiz.resolve()):
            raise HTTPException(400, 'Ruta no válida')
    except OSError as e:
        raise HTTPException(503, 'El NAS no está disponible') from e
    return raiz, destino


def _info(p: Path, ruta: str) -> dict | None:
    try:
        st = p.stat()
    except OSError:
        return None
    es_dir = p.is_dir()
    return {'nombre': p.name, 'ruta': ruta, 'carpeta': es_dir, 'ext': '' if es_dir else p.suffix.lower().lstrip('.'),
            'bytes': 0 if es_dir else st.st_size, 'modificado': datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()}


@router.get('/pestanas')
def pestanas():
    return {'pestanas': [{'id': k, 'titulo': v['titulo']} for k, v in TABS.items()]}


@router.get('/lista')
def lista(tab: str, ruta: str = ''):
    raiz, destino = _resolver(tab, ruta)
    raices = TABS[tab]['raices']
    if raiz is None:
        if len(raices) == 1:   # una sola carpeta: se entra directo
            nombre = next(iter(raices))
            return lista(tab, nombre)
        return {'ruta': '', 'partes': [], 'entradas': [{'nombre': n, 'ruta': n, 'carpeta': True, 'ext': '', 'bytes': 0, 'modificado': ''} for n in raices],
                'unica_raiz': False}
    if not destino.is_dir():
        raise HTTPException(404, 'La carpeta no existe')
    base = '/'.join(p for p in str(ruta).replace('\\', '/').split('/') if p)
    entradas = []
    try:
        with os.scandir(destino) as it:
            for e in it:
                if e.name.startswith(('~$', '.', '@', '#')) or e.name.lower() in ('thumbs.db', 'desktop.ini'):
                    continue
                datos = _info(Path(e.path), base + '/' + e.name)
                if datos:
                    entradas.append(datos)
                if len(entradas) >= MAX_ENTRADAS:
                    break
    except OSError as e:
        raise HTTPException(503, 'El NAS no está disponible') from e
    entradas.sort(key=lambda x: (not x['carpeta'], x['nombre'].casefold()))
    return {'ruta': base, 'partes': base.split('/'), 'entradas': entradas, 'unica_raiz': len(raices) == 1}


@router.get('/molde-ref')
def molde_de_referencia(ref: str):
    """Carpeta de ILLUSTRATOR (EDICION) donde están los moldes de una referencia (FUT03 -> FUT03F.ai, FUT03M.ai, FUT03N.ai)."""
    ref = re.sub(r'[^A-Z0-9]', '', str(ref or '').upper())[:20]
    nombre = 'ILLUSTRATOR (EDICION)'
    base = TABS['molderia']['raices'][nombre]
    if not ref:
        return {'ruta': nombre, 'archivos': []}
    patron = re.compile(re.escape(ref) + r'(?!\d)', re.I)   # FUT03 no debe coger FUT030
    try:
        for carpeta in sorted((c for c in base.iterdir() if c.is_dir()), key=lambda c: c.name):
            hallados = sorted(a.name for a in carpeta.iterdir() if a.is_file() and patron.match(a.name))
            if hallados:
                return {'ruta': nombre + '/' + carpeta.name, 'archivos': hallados}
    except OSError as e:
        raise HTTPException(503, 'El NAS no está disponible') from e
    return {'ruta': nombre, 'archivos': []}


@router.get('/archivo')
def archivo(tab: str, ruta: str, descargar: int = 0):
    raiz, destino = _resolver(tab, ruta)
    if raiz is None or not destino.is_file():
        raise HTTPException(404, 'Archivo no encontrado')
    tipo = mimetypes.guess_type(destino.name)[0] or 'application/octet-stream'
    inline = destino.suffix.lower() in _VISIBLES_INLINE and not descargar
    disposicion = ('inline' if inline else 'attachment') + "; filename*=UTF-8''" + quote(destino.name)
    return FileResponse(destino, media_type=tipo, headers={'Content-Disposition': disposicion, 'Cache-Control': 'private, max-age=300',
                                                           'X-Content-Type-Options': 'nosniff'})


@router.get('/fichas')
def fichas_lista():
    ind = fichas_mod.indice()
    return {'actualizado': ind.get('actualizado', ''), 'fichas': ind.get('fichas', []), 'estado': dict(fichas_mod.estado), 'mockups': fichas_mod.con_mockup()}


@router.post('/fichas/importar')
def fichas_importar():
    """Lee de nuevo los libros de Excel de la carpeta FICHAS TECNICAS (tarda unos segundos; corre en segundo plano)."""
    carpeta = TABS['fichas']['raices']['FICHAS TECNICAS']
    if not carpeta.is_dir():
        raise HTTPException(503, 'No encuentro la carpeta FICHAS TECNICAS en el NAS')
    return {'iniciada': fichas_mod.correr_importacion(carpeta), 'estado': dict(fichas_mod.estado)}


@router.get('/ficha')
def ficha_detalle(id: str):
    f = fichas_mod.ficha(id)
    if not f:
        raise HTTPException(404, 'Ficha no encontrada')
    from app import fichas_resumen as fr_mod
    f['consumos'] = fr_mod._consumos(f.get('ref', ''))   # consumo por talla de Promedios maestros
    return f


@router.get('/ficha-img')
def ficha_imagen(id: str, archivo: str):
    p = fichas_mod.ruta_imagen(id, archivo)
    if not p:
        raise HTTPException(404, 'Imagen no encontrada')
    return FileResponse(p, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@router.post('/mockup')
async def mockup_subir(request: Request, ref: str):
    """Sube (o reemplaza) el mockup de referencia de una REF. El cuerpo es la imagen tal cual (JPG, PNG o WEBP)."""
    datos = await request.body()
    try:
        r = fichas_mod.guardar_mockup(ref, datos)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {'ok': True, **r}


@router.delete('/mockup')
def mockup_quitar(ref: str):
    try:
        return {'ok': fichas_mod.borrar_mockup(ref)}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# ---------------------------------------------------------------- mockups de cada REF en la carpeta CLIENTES del NAS
_CLIENTES = Path(os.getenv('NAS_CLIENTES_PATH', str(_NAS / 'CLIENTES')))
_IMG_OK = {'.jpg', '.jpeg', '.png', '.webp'}
_IDX_VIDA = 24 * 3600
_IDX_ESTADO = {'indexando': False, 'inicio': 0.0, 'archivos': 0, 'error': ''}
_IDX_MEM: dict = {'mtime': 0.0, 'datos': None}
_PATRON_REF = re.compile(r'(?<![A-Z0-9])(?:A\d{2,4}-?)?([A-Z]{1,5}\d{2,3})(?!\d)', re.I)
_IDX_LOCK = threading.Lock()


def _idx_archivo() -> Path:
    return fichas_mod.DATOS / 'mockups_nas.json'


def _cargar_indice():
    p = _idx_archivo()
    try:
        mt = p.stat().st_mtime
    except OSError:
        return None
    if _IDX_MEM['datos'] is None or _IDX_MEM['mtime'] != mt:
        try:
            _IDX_MEM['datos'] = json.loads(p.read_text(encoding='utf-8'))
            _IDX_MEM['mtime'] = mt
        except (OSError, ValueError):
            return None
    return _IDX_MEM['datos']


def _construir_indice():
    """Recorre CLIENTES una sola vez (tarda varios minutos por el NAS) y guarda, por REF, sus imágenes de mockup."""
    est = _IDX_ESTADO
    try:
        refs = {str(f.get('ref', '')).upper() for f in fichas_mod.indice().get('fichas', [])}
        cmd = ['find', str(_CLIENTES), '-type', 'f', '(', '-iname', '*.jpg', '-o', '-iname', '*.jpeg', '-o', '-iname', '*.png', '-o', '-iname', '*.webp', ')',
               '-size', '+40k', '-printf', '%T@\t%s\t%p\n']
        acc: dict = {}
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors='replace') as pr:
            for linea in pr.stdout:
                est['archivos'] += 1
                try:
                    t, tam, ruta = linea.rstrip('\n').split('\t', 2)
                except ValueError:
                    continue
                nombre = ruta.rsplit('/', 1)[-1]
                vistos = set()
                for m in _PATRON_REF.finditer(nombre):
                    ref = m.group(1).upper()
                    if ref in refs and ref not in vistos:
                        vistos.add(ref)
                        acc.setdefault(ref, []).append((float(t), int(tam), ruta))
        salida = {}
        for ref, lista in acc.items():
            lista.sort(key=lambda x: -x[0])
            items = []
            for t, tam, ruta in lista[:300]:
                try:
                    partes = Path(ruta).relative_to(_CLIENTES).parts
                except ValueError:
                    continue
                if any(x.startswith('@') or x.startswith('.@') for x in partes):
                    continue
                items.append({'ruta': '/'.join(partes), 'nombre': partes[-1], 'cliente': partes[0] if len(partes) > 1 else '', 'carpeta': partes[-2] if len(partes) > 1 else '',
                              'kb': int(tam / 1024), 'fecha': datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%d')})
            salida[ref] = items
        p = _idx_archivo()
        tmp = p.with_suffix('.tmp')
        tmp.write_text(json.dumps({'t': time.time(), 'refs': salida}, ensure_ascii=False), encoding='utf-8')
        tmp.replace(p)
        est['error'] = ''
    except Exception as e:  # noqa: BLE001
        est['error'] = str(e)
    finally:
        est['indexando'] = False


def _iniciar_indice() -> bool:
    with _IDX_LOCK:
        if _IDX_ESTADO['indexando'] or not _CLIENTES.is_dir():
            return False
        _IDX_ESTADO.update(indexando=True, inicio=time.time(), archivos=0, error='')
    threading.Thread(target=_construir_indice, daemon=True).start()
    return True


def _ruta_cliente(ruta: str) -> Path:
    partes = [p for p in str(ruta or '').replace('\\', '/').split('/') if p]
    if not partes or any(p in ('.', '..') for p in partes):
        raise HTTPException(400, 'Ruta no válida')
    destino = _CLIENTES.joinpath(*partes)
    if destino.suffix.lower() not in _IMG_OK:
        raise HTTPException(400, 'Solo imágenes')
    try:
        ok = destino.resolve().is_relative_to(_CLIENTES.resolve()) and destino.is_file()
    except OSError as e:
        raise HTTPException(503, 'El NAS no está disponible') from e
    if not ok:
        raise HTTPException(404, 'No encuentro la imagen')
    return destino


@router.get('/mockups-nas')
def mockups_nas(ref: str, refrescar: int = 0):
    """Imágenes del NAS (carpeta CLIENTES) cuyo nombre lleva la REF, sacadas de un índice que se rehace solo cada día."""
    ref = (ref or '').upper().strip()
    if not re.fullmatch(r'[A-Z]{1,5}\d{2,3}', ref):
        raise HTTPException(400, 'REF no válida')
    if not _CLIENTES.is_dir():
        raise HTTPException(503, 'No encuentro la carpeta CLIENTES del NAS')
    idx = _cargar_indice()
    if idx is None or refrescar or time.time() - idx.get('t', 0) > _IDX_VIDA:
        _iniciar_indice()
    items = (idx or {}).get('refs', {}).get(ref, []) if idx else []
    return {'ref': ref, 'total': len(items), 'items': items, 'indexando': _IDX_ESTADO['indexando'], 'sin_indice': idx is None,
            'archivos': _IDX_ESTADO['archivos'], 'error': _IDX_ESTADO['error'], 'actualizado': (idx or {}).get('t', 0)}


@router.get('/nas-img')
def nas_img(ruta: str, w: int = 0):
    d = _ruta_cliente(ruta)
    if not w:
        return FileResponse(d)
    w = max(80, min(int(w), 900))
    try:
        st = d.stat()
        carpeta = fichas_mod.DATOS / 'nasthumbs'
        carpeta.mkdir(parents=True, exist_ok=True)
        mini = carpeta / (hashlib.sha1(f'{ruta}|{st.st_mtime_ns}|{w}'.encode()).hexdigest() + '.jpg')
        if not mini.exists():
            from PIL import Image
            with Image.open(d) as im:
                im.draft('RGB', (w * 2, w * 2))
                im = im.convert('RGB')
                im.thumbnail((w, w * 2))
                im.save(mini, 'JPEG', quality=80)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, 'No pude leer la imagen') from e
    return FileResponse(mini, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@router.post('/mockup-nas')
def mockup_desde_nas(ref: str, ruta: str):
    """Usa una imagen del NAS como mockup de la REF."""
    d = _ruta_cliente(ruta)
    try:
        if d.stat().st_size > 60 * 1024 * 1024:
            raise HTTPException(413, 'La imagen pesa demasiado (máx. 60 MB)')
        r = fichas_mod.guardar_mockup(ref, d.read_bytes())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except OSError as e:
        raise HTTPException(503, 'El NAS no está disponible') from e
    return {'ok': True, **r}
