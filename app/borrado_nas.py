"""Comprobación barata de la carpeta de una orden antes de borrarla de la NAS.

Antes se recorría con Path.resolve() + os.path.ismount() por CADA archivo: cada llamada es una ida y vuelta a la NAS (por VPN, ~1 s) y una orden de
34 archivos tardaba ~33 s en comprobarse; además se repetía en la vista previa y dos veces al borrar. Aquí se usa os.scandir (el tipo de entrada
viene en la propia lectura de la carpeta, sin consultas extra) y los puntos de montaje se detectan por cambio de dispositivo (st_dev), una sola
consulta por carpeta. La regla de seguridad es la misma: ni enlaces, ni uniones (junctions), ni montajes dentro de la carpeta a borrar.
"""
import os
from pathlib import Path


# En Windows DirEntry.stat() no trae st_dev: allí no se compara (el servidor, donde sí se borra, es Linux).
COMPARAR_DISPOSITIVO = os.name != 'nt'


class CarpetaNoSegura(Exception):
    """La carpeta contiene enlaces, uniones o puntos de montaje: no se borra sin revisión manual."""


def verificar_sin_enlaces(carpeta) -> int:
    """Recorre la carpeta (sin seguir enlaces) y lanza CarpetaNoSegura si encuentra algo que no sea un archivo o carpeta normal.
    Devuelve cuántas entradas revisó."""
    raiz = str(Path(carpeta))
    dispositivo = os.stat(raiz).st_dev
    pendientes, revisadas = [raiz], 0
    while pendientes:
        with os.scandir(pendientes.pop()) as entradas:
            for e in entradas:
                revisadas += 1
                if e.is_symlink() or (hasattr(e, 'is_junction') and e.is_junction()):
                    raise CarpetaNoSegura(e.path)
                if e.is_dir(follow_symlinks=False):
                    if COMPARAR_DISPOSITIVO and e.stat(follow_symlinks=False).st_dev != dispositivo:
                        raise CarpetaNoSegura(e.path)
                    pendientes.append(e.path)
    return revisadas
