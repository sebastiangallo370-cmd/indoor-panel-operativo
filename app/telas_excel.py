"""Enlace de Información tela con el Excel de costos (hoja TELAS) de la NAS.

- El Excel es la fuente: al leer, sus valores llenan los datos de cada tela.
- Al guardar un cambio en el panel, la fila de esa tela se escribe en el Excel.
- Si el Excel está abierto (archivo de bloqueo «~$…») o no se puede escribir, el cambio
  queda pendiente y se reintenta en cada lectura hasta que se pueda guardar.
- Antes de cada escritura se guarda una copia del libro en /data (últimas 30).
"""
import json
import os
import re
import shutil
import threading
import time
import zipfile
from pathlib import Path

import openpyxl

RUTA = Path(os.getenv('TELAS_EXCEL_PATH', '/mnt/nas/DIRECCION PRODUCCION/REFERENCIAS EFFI :COSTOS:PRECIO DE VENTA 2026.xlsx'))
HOJA = 'TELAS'
ESTADO = Path(os.getenv('TELAS_EXCEL_ESTADO', '/data/state/telas_excel_estado.json'))
RESPALDOS = Path(os.getenv('TELAS_EXCEL_RESPALDOS', '/data/state/respaldos_telas_excel'))
MAX_RESPALDOS = 30

# campo del panel -> encabezado de la hoja TELAS
MAPA = {
    'proveedor': 'PROVEEDOR', 'ancho': 'ANCHO', 'id_effi': 'ID EFFI', 'composicion': 'COMPOSICION',
    'gramaje': 'GRAMAJE', 'stock_minimo': 'STOCK MIN', 'stock_maximo': 'STOCK MAX',
    'vendedor': 'VENDEDOR', 'correo': 'CORREO', 'precio_sin_iva': 'PRECIO SIN IVA', 'wpp': 'WHATSAPP',
}
CAMPOS_NUMERICOS = {'id_effi', 'stock_minimo', 'stock_maximo'}

_candado = threading.Lock()
_cache = {'t': 0.0, 'mtime': None, 'datos': {}}


def _lock_presente() -> bool:
    return (RUTA.parent / ('~$' + RUTA.name)).exists()


def _texto(valor) -> str:
    if valor is None:
        return ''
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()


def leer() -> dict:
    """Filas de la hoja TELAS por código de Indoor: {codigo: {campo_panel: valor}}. Cacheado 60 s."""
    ahora = time.time()
    try:
        mtime = RUTA.stat().st_mtime
    except OSError:
        return {}
    if ahora - _cache['t'] < 60 and _cache['mtime'] == mtime:
        return _cache['datos']
    wb = openpyxl.load_workbook(RUTA, read_only=True, data_only=True)
    ws = wb[HOJA]
    filas = ws.iter_rows(values_only=True)
    cabecera = [re.sub(r'\s+', ' ', _texto(x).upper()) for x in next(filas, [])]
    col_id = cabecera.index('ID INDOOR')
    inversa = {v: k for k, v in MAPA.items()}
    datos = {}
    for fila in filas:
        codigo = _texto(fila[col_id]) if col_id < len(fila) else ''
        if not re.fullmatch(r'\d{1,6}', codigo):
            continue
        valores = {}
        for i, titulo in enumerate(cabecera):
            campo = inversa.get(titulo)
            if campo and i < len(fila):
                valores[campo] = _texto(fila[i])
        datos[codigo] = valores
    wb.close()
    _cache.update(t=ahora, mtime=mtime, datos=datos)
    return datos


def _pendientes() -> list:
    try:
        return json.loads(ESTADO.read_text(encoding='utf-8')).get('pendientes', [])
    except (OSError, ValueError):
        return []


def _guardar_pendientes(lista: list) -> None:
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO.with_suffix('.tmp')
    tmp.write_text(json.dumps({'pendientes': lista}, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(ESTADO)


def combinar(guardado: dict) -> dict:
    """Mezcla lo guardado en el panel con el Excel (el Excel manda) y con los cambios pendientes."""
    salida = {k: dict(v) for k, v in guardado.items()}
    for codigo, valores in leer().items():
        g = salida.setdefault(codigo, {})
        for campo, valor in valores.items():
            if valor != '':
                g[campo] = valor
    for p in _pendientes():
        g = salida.setdefault(p['codigo'], {})
        g.update(p['campos'])
    return salida


def _abrir_valido(ruta: Path):
    """Abre el libro y comprueba que sea un Excel completo (la NAS a veces entrega un archivo a medias)."""
    if not zipfile.is_zipfile(ruta):
        raise RuntimeError('El archivo de la NAS no está completo; no se escribe sobre él')
    return openpyxl.load_workbook(ruta)


def _escribir(codigo: str, campos: dict, nombre: str) -> None:
    """Escribe la fila de una tela en la hoja TELAS. Lanza excepción si no se pudo comprobar."""
    if _lock_presente():
        raise RuntimeError('El Excel está abierto en otro equipo')
    RESPALDOS.mkdir(parents=True, exist_ok=True)
    copia = RESPALDOS / time.strftime('telas-%Y%m%d-%H%M%S.xlsx')
    shutil.copy2(RUTA, copia)
    _abrir_valido(copia)   # si la copia base está dañada, no se escribe nada
    for vieja in sorted(RESPALDOS.glob('telas-*.xlsx'))[:-MAX_RESPALDOS]:
        vieja.unlink(missing_ok=True)
    for intento in range(3):
        wb = _abrir_valido(RUTA)
        ws = wb[HOJA]
        cabecera = [re.sub(r'\s+', ' ', _texto(c.value).upper()) for c in ws[1]]
        col = {t: i + 1 for i, t in enumerate(cabecera)}
        col_id = col['ID INDOOR']
        fila = None
        for r in range(2, ws.max_row + 1):
            if _texto(ws.cell(r, col_id).value) == codigo:
                fila = r
                break
        nueva = fila is None
        if nueva:
            fila = ws.max_row + 1
            ws.cell(fila, col_id).value = int(codigo)
            if 'NOMBRE' in col and nombre:
                ws.cell(fila, col['NOMBRE']).value = nombre
        for campo, valor in campos.items():
            titulo = MAPA.get(campo)
            if not titulo or titulo not in col:
                continue
            valor = _texto(valor)
            if campo in CAMPOS_NUMERICOS and re.fullmatch(r'\d+', valor):
                valor = int(valor)
            ws.cell(fila, col[titulo]).value = valor if valor != '' else None
        tmp = ESTADO.parent / 'telas_excel_tmp.xlsx'
        tmp.parent.mkdir(parents=True, exist_ok=True)
        wb.save(tmp)
        shutil.copyfile(tmp, RUTA)
        tmp.unlink(missing_ok=True)
        time.sleep(2)   # deja que la NAS termine de escribir antes de releer
        # comprobación: se relee el archivo y la fila debe estar con lo escrito
        try:
            verif = _abrir_valido(RUTA)[HOJA]
            fila_v = None
            for r in range(2, verif.max_row + 1):
                if _texto(verif.cell(r, col_id).value) == codigo:
                    fila_v = r
                    break
            if fila_v is not None and all(
                    _texto(verif.cell(fila_v, col[MAPA[c]]).value) == _texto(v if not (c in CAMPOS_NUMERICOS and re.fullmatch(r'\d+', _texto(v))) else int(_texto(v)))
                    for c, v in campos.items() if MAPA.get(c) in col and _texto(v) != ''):
                _cache.update(t=0.0)
                return
        except RuntimeError:
            pass
        time.sleep(2)
    raise RuntimeError('La NAS no confirmó la escritura de la tela ' + codigo)


def procesar() -> int:
    """Intenta escribir los cambios pendientes. Devuelve cuántos quedan pendientes."""
    with _candado:
        pendientes = _pendientes()
        if not pendientes:
            return 0
        if _lock_presente():
            return len(pendientes)
        restantes = []
        for i, p in enumerate(pendientes):
            try:
                _escribir(p['codigo'], p['campos'], p.get('nombre', ''))
            except Exception:  # noqa: BLE001 — se reintenta más tarde
                restantes = pendientes[i:]
                break
        _guardar_pendientes(restantes)
        return len(restantes)


def registrar(codigo: str, campos: dict, nombre: str = '') -> str:
    """Guarda un cambio de una tela en el Excel (o lo deja pendiente). Devuelve 'guardado' o 'pendiente'."""
    campos = {k: v for k, v in campos.items() if k in MAPA}
    if not campos:
        return 'guardado'
    with _candado:
        pendientes = _pendientes()
        pendientes.append({'codigo': codigo, 'campos': campos, 'nombre': nombre, 'cuando': time.strftime('%Y-%m-%d %H:%M:%S')})
        _guardar_pendientes(pendientes)
    return 'guardado' if procesar() == 0 else 'pendiente'
