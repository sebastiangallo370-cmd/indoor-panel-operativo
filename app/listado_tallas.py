"""Tallas de cada orden, leídas del Excel del listado que está en la carpeta de la orden en la NAS.

Sirve para calcular la tela necesaria TALLA POR TALLA (como Promedios maestros) en vez de usar un promedio general.
La carpeta se busca por el cliente que dice Producción (CLIENTES/<cliente>/<orden>_<proyecto>), sin recorrer toda la NAS (por la VPN sería lentísimo).
Solo lectura; se lee una copia en memoria del Excel para no dejarlo abierto en la NAS.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata
from pathlib import Path

NAS_CLIENTES = Path(os.getenv('NAS_ROOT', '/mnt/nas')) / 'CLIENTES'

_TALLA = {'talla', 'tallas', 'size'}
_GENERO = {'genero', 'sexo', 'categoria'}
_CANTIDAD = {'cantidad', 'cantidades', 'cant', 'unidades', 'unds', 'und'}
_GENEROS = {'masc', 'masculino', 'hombre', 'caballero', 'fem', 'femenino', 'mujer', 'dama', 'nino', 'nina', 'ninos', 'ninas', 'kids'}
_SIN_MARCA = {'', '0', 'NO', '-', 'N/A'}


def _n(texto) -> str:
    s = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]+', ' ', s).strip()


def _codigo(texto) -> str:
    return re.sub(r'[^A-Z0-9]', '', unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode().upper())


def _es_genero(h: str) -> bool:
    return h in _GENEROS or (h.split() or [''])[0] in _GENEROS


def carpeta_de_orden(cliente: str, orden: str) -> Path | None:
    """CLIENTES/<cliente>/<orden>_<proyecto>; primero el nombre exacto y, si no, comparando nombres sin tildes ni mayúsculas."""
    try:
        directo = NAS_CLIENTES / cliente
        if not directo.is_dir():
            clave = _codigo(cliente)
            directo = next((NAS_CLIENTES / d for d in os.listdir(NAS_CLIENTES) if _codigo(d) == clave), None)
        if not directo:
            return None
        prefijo = _codigo(orden)
        for d in sorted(os.listdir(directo)):
            if (directo / d).is_dir() and _codigo(d.split('_', 1)[0]) == prefijo:
                return directo / d
    except OSError:
        return None
    return None


def excel_de_orden(carpeta: Path, orden: str) -> Path | None:
    """El Excel del listado: el que lleva el código de la orden en el nombre; busca en la carpeta y un nivel más abajo."""
    clave, candidatos = _codigo(orden), []
    try:
        for base in [carpeta] + [carpeta / d for d in os.listdir(carpeta) if (carpeta / d).is_dir()][:12]:
            for a in os.listdir(base):
                if a.startswith('~$') or not a.lower().endswith(('.xlsx', '.xlsm')):
                    continue
                ruta = base / a
                puntos = (3 if clave in _codigo(a) else 0) + (2 if 'listado' in _n(a) else 0) + (1 if base == carpeta else 0)
                candidatos.append((puntos, ruta.stat().st_mtime, ruta))
    except OSError:
        return None
    candidatos.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidatos[0][2] if candidatos else None


def leer_hojas(ruta: Path) -> dict[str, list[dict]]:
    """{nombre de la hoja: [línea {genero, talla, cantidad}]}: solo las hojas con columna TALLA (cada una es una referencia, ej. A700CA00)."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(Path(ruta).read_bytes()), read_only=True, data_only=True)
    hojas: dict[str, list[dict]] = {}
    for ws in wb.worksheets:
        filas = [['' if c is None else str(c).strip() for c in f] for f in ws.iter_rows(values_only=True)]
        filas = [f for f in filas if any(f)]
        for i, enc in enumerate(filas[:40]):
            if not ({_n(c) for c in enc} & _TALLA):
                continue
            sub = filas[i + 1] if i + 1 < len(filas) else []
            i_talla = next(k for k, c in enumerate(enc) if _n(c) in _TALLA)
            cuerpo = filas[i + 1:]
            # formato «ORDEN DE PEDIDO»: dos filas de encabezados (arriba DISEÑOS/GÉNERO y abajo DISEÑO 1…4 / MASCULINO / FEMENINO)
            if (i_talla >= len(sub) or not sub[i_talla]) and any(re.fullmatch(r'diseno\s*\d+', _n(c)) or _es_genero(_n(c)) for c in sub):
                enc = [(sub[k] if k < len(sub) and sub[k] else (enc[k] if k < len(enc) else '')) for k in range(max(len(enc), len(sub)))]
                cuerpo = filas[i + 2:]
            i_gen = next((k for k, h in enumerate(enc) if _n(h) in _GENERO), None)
            i_cant = next((k for k, h in enumerate(enc) if _n(h) in _CANTIDAD), None)
            lineas = []
            for f in cuerpo:
                f = f + [''] * (len(enc) - len(f))
                talla = f[i_talla].strip()
                if not talla:
                    continue
                genero = f[i_gen] if i_gen is not None else ''
                if not genero:   # el género se marca con una X bajo «MASC / FEM…»
                    genero = '/'.join(h.strip() for k, h in enumerate(enc) if h and _es_genero(_n(h)) and k < len(f) and f[k].strip().upper() not in _SIN_MARCA)
                cantidad = 1
                if i_cant is not None and i_cant < len(f):
                    try:
                        n = int(float(f[i_cant].replace(',', '.')))
                        cantidad = n if 1 <= n <= 5000 else 1
                    except ValueError:
                        cantidad = 1
                lineas.append({'genero': genero, 'talla': talla, 'cantidad': cantidad})
            if lineas:
                hojas[ws.title] = lineas
            break
    return hojas
