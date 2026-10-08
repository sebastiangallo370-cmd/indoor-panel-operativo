"""Foto de perfil de cada usuario: se sube desde «Mi perfil», se recorta en cuadrado y se guarda en el servidor (/data, fuera del repositorio).
La foto se guarda por id de usuario (si cambia su nombre, la conserva); las cuentas compartidas sin fila propia usan un código del nombre.
"""
import hashlib
import io
import os
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

router = APIRouter(prefix='/api/perfil', tags=['perfil'])

CARPETA = Path(os.getenv('FOTOS_PERFIL_DIR', '/data/state/fotos_perfil'))
LADO = 320
MAX_BYTES = 12 * 1024 * 1024
_auth: Callable = lambda: ''
_claves: Callable = lambda nombre: ''           # nombre de usuario -> clave estable de archivo
_usuarios: Callable = lambda: []                # lista de nombres de usuario


def configurar(authenticate: Callable, clave_de: Callable, nombres: Callable) -> None:
    global _auth, _claves, _usuarios
    _auth, _claves, _usuarios = authenticate, clave_de, nombres


def _archivo(nombre: str) -> Path:
    clave = _claves(nombre) or ('n' + hashlib.sha1(nombre.lower().encode()).hexdigest()[:12])
    return CARPETA / f'{clave}.jpg'


def _yo(request: Request) -> str:
    return _auth(request)


@router.get('/fotos')
def fotos(request: Request):
    """Quién tiene foto (y su versión, para refrescar la imagen cuando la cambian)."""
    yo = _yo(request)
    out = {}
    for n in _usuarios():
        try:
            out[n.lower()] = int(_archivo(n).stat().st_mtime)
        except OSError:
            continue
    try:
        propia = int(_archivo(yo).stat().st_mtime)
        out[yo.lower()] = propia
    except OSError:
        pass
    return {'yo': yo, 'fotos': out}


@router.get('/foto')
def foto(request: Request, usuario: str = ''):
    nombre = (usuario or _yo(request)).strip()
    _yo(request)
    p = _archivo(nombre)
    if not p.is_file():
        raise HTTPException(404, 'Sin foto')
    return FileResponse(p, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@router.post('/foto')
async def subir(request: Request):
    """Sube o reemplaza la foto del usuario que tiene la sesión. El cuerpo es la imagen tal cual (JPG, PNG o WEBP)."""
    yo = _yo(request)
    datos = await request.body()
    if not datos:
        raise HTTPException(400, 'No llegó ninguna imagen')
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, 'La imagen pesa demasiado (máx. 12 MB)')
    try:
        from PIL import Image, ImageOps
        with Image.open(io.BytesIO(datos)) as im:
            im = ImageOps.exif_transpose(im).convert('RGB')
            lado = min(im.size)
            izq, arr = (im.width - lado) // 2, (im.height - lado) // 3     # recorte cuadrado, un poco hacia arriba (donde suele estar la cara)
            im = im.crop((izq, max(0, arr), izq + lado, max(0, arr) + lado)).resize((LADO, LADO), Image.LANCZOS)
            CARPETA.mkdir(parents=True, exist_ok=True)
            destino = _archivo(yo)
            tmp = destino.with_suffix('.tmp')
            im.save(tmp, 'JPEG', quality=86, optimize=True)
            tmp.replace(destino)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, 'No pude leer esa imagen; prueba con un JPG o PNG') from e
    return {'ok': True, 'version': int(destino.stat().st_mtime)}


@router.delete('/foto')
def quitar(request: Request):
    yo = _yo(request)
    try:
        _archivo(yo).unlink()
    except OSError:
        pass
    return Response(status_code=204)
