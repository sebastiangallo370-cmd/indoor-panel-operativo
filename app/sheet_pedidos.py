"""Registra en la hoja de Producción (pestaña ORDENES DE PRODUCCION) cada pedido programado:
una fila por referencia, en las columnas B a L, debajo de la última fila con datos.
No toca las columnas M a T ni la fórmula de DÍAS ENTREGA FINAL. Un fallo nunca impide programar el pedido."""
import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata
from datetime import date, datetime
from pathlib import Path

import gspread
from fastapi import APIRouter, Body, HTTPException, Request
from google.oauth2.service_account import Credentials

log = logging.getLogger('sheet_pedidos')
SPREADSHEET_ID = '1n7t5F1ZTX4Fwj3_ZAS1hdHnF7g16kTXfmFFkNa7M3tg'
HOJA = 'ORDENES DE PRODUCCION'
COL_ORDEN, COL_REFERENCIA = 5, 7          # E y G (1-based)
MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
_lock = threading.Lock()
REGISTROS = Path(os.getenv('STATE_DIR', '/data/state')) / 'hoja_produccion_registros.json'   # qué filas agregó el sistema, por orden


def _leer_registros() -> dict:
    try:
        return json.loads(REGISTROS.read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001
        return {}


def _guardar_registros(datos: dict) -> None:
    REGISTROS.parent.mkdir(parents=True, exist_ok=True)
    REGISTROS.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')


def anotar(codigo: str, refs: list) -> None:
    datos = _leer_registros()
    lista = datos.setdefault(codigo.upper(), [])
    for r in refs:
        if str(r).upper() not in lista:
            lista.append(str(r).upper())
    _guardar_registros(datos)
ESTADO = Path(os.getenv('STATE_DIR', '/data/state')) / 'hoja_produccion_activa.json'   # interruptor: por defecto APAGADO
_puede = lambda usuario: False
_auth = None


def activo() -> bool:
    try:
        return bool(json.loads(ESTADO.read_text(encoding='utf-8')).get('activo', False))
    except Exception:  # noqa: BLE001
        return False


def guardar(valor: bool) -> bool:
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    ESTADO.write_text(json.dumps({'activo': bool(valor)}), encoding='utf-8')
    return bool(valor)


def configurar(puede, auth) -> None:
    global _puede, _auth
    _puede, _auth = puede, auth


router = APIRouter(prefix='/api/hoja-produccion', tags=['hoja-produccion'])


def _admin(request: Request) -> str:
    usuario = str(_auth(request) or '') if _auth else ''
    if not _puede(usuario):
        raise HTTPException(403, 'Solo la cuenta Indoor Sport puede cambiar este interruptor')
    return usuario


@router.get('')
def leer_interruptor(request: Request):
    _admin(request)
    return {'activo': activo()}


@router.put('')
def cambiar_interruptor(request: Request, body: dict = Body(...)):
    _admin(request)
    return {'activo': guardar(bool(body.get('activo')))}


def _fecha_texto(valor) -> str:
    """'2026-12-09' o date -> '09-dic-2026' (como en la hoja)."""
    try:
        d = valor if isinstance(valor, date) else date.fromisoformat(str(valor)[:10])
    except ValueError:
        return ''
    return f"{d.day:02d}-{MESES[d.month - 1]}-{d.year}"


def _hoja():
    ruta = os.getenv('GOOGLE_CREDENTIALS', '/run/secrets/google-service-account.json')
    cred = Credentials.from_service_account_file(ruta, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    return gspread.authorize(cred).open_by_key(SPREADSHEET_ID).worksheet(HOJA)


def _sin_tildes(texto: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', texto) if not unicodedata.combining(c)).upper().strip()


# Iniciales fijas por vendedor (como las pide el equipo comercial en la hoja)
INICIALES_FIJAS = {
    'DAVID HINCAPIE': 'DH',
    'CESAR ANDRES LOPEZ ZULUAGA': 'AL',
    'CESAR AUGUSTO LOPEZ ZULUAGA': 'AU',
    'YENIFER SANCHEZ': 'YS',
}


def iniciales_de(vendedor: str) -> str:
    """Nombre del vendedor -> sus iniciales de la cuenta del panel (DH, YS, AL...). Sin cuenta: vacío."""
    buscado = _sin_tildes(vendedor or '')
    if not buscado:
        return ''
    fija = INICIALES_FIJAS.get(buscado)
    if fija:
        return fija
    try:
        db = sqlite3.connect(f"file:{Path(os.getenv('STATE_DIR', '/data/state')) / 'jobs.sqlite3'}?mode=ro", uri=True)
        filas = db.execute('SELECT name, display_name FROM users').fetchall()
        db.close()
    except Exception:  # noqa: BLE001
        return ''
    for nombre, visible in filas:
        if _sin_tildes(visible or '') == buscado:
            return str(nombre or '').upper()
    return ''


def tela_de(ref: str) -> str:
    """Tela de la referencia según INFORMACIÓN TELA (A100CA01 -> código 100). Sin una sola coincidencia: vacío."""
    m = re.search(r'A(\d{2,5})', str(ref or '').upper())
    if not m:
        return ''
    try:
        from app import proveedores_tela
        telas = proveedores_tela.telas()
    except Exception:  # noqa: BLE001
        return ''
    nombres = {str(t.get('nombre') or '').strip().upper() for t in telas if str(t.get('codigo')) == m.group(1) and str(t.get('nombre') or '').strip()}
    return nombres.pop() if len(nombres) == 1 else ''


def _textura_texto(textura, tipos) -> str:
    """APLIQUE como se escribe en la columna TEXTURIZADO del Sheet: solo «SI», «NO» o vacío.
    Los tipos de aplique NO van al Sheet: van en el listado (OBSERVACIONES Y NOTAS)."""
    textura = str(textura or '').upper()
    return textura if textura in ('SI', 'NO') else ''


def filas_del_pedido(codigo: str, datos: dict, grupos: list) -> list:
    """Filas de 14 campos: B:L (11), luego RESP (P), TELA (Q) y TEXTURIZADO (T). Cada referencia lleva SU línea, proyecto y aplique;
    si el grupo no los trae, se usan los del documento (pedidos anteriores)."""
    doc = datos.get('doc') or {}
    resp = iniciales_de(str(doc.get('vendedor') or ''))
    cliente = doc.get('cliente') or {}
    nombre = str(cliente.get('nombre') or '').strip().upper()
    correo = str(cliente.get('correo') or '').strip()
    obs = str(datos.get('observaciones') or doc.get('observacion') or '').strip()
    inicio = _fecha_texto(datetime.now().date())
    entrega = _fecha_texto(doc.get('fecha_entrega'))
    filas = []
    for g in grupos:
        ref = str(g.get('referencia') or '').upper()
        linea = str(g.get('linea', datos.get('linea')) or '').strip().upper()
        proyecto = str(g.get('proyecto', doc.get('proyecto')) or '').strip().upper()
        textura = _textura_texto(g.get('textura', datos.get('textura')), g.get('tipos', datos.get('tipos')))
        filas.append([linea, nombre, proyecto, codigo, correo, ref,
                      int(g.get('cantidad') or 0), '', obs, inicio, entrega, resp, tela_de(ref), textura])
    return filas


def registrar(codigo: str, datos: dict, grupos: list) -> dict:
    """Agrega las filas al final de la hoja. Devuelve lo que hizo (para el registro)."""
    if not activo():
        return {'modo': 'apagado', 'filas': []}
    filas = filas_del_pedido(codigo, datos, grupos)
    if os.getenv('SHEET_PEDIDOS_PRUEBA', '0') == '1':
        return {'modo': 'prueba', 'filas': filas}
    with _lock:
        ws = _hoja()
        ordenes = ws.col_values(COL_ORDEN)
        refs = ws.col_values(COL_REFERENCIA)
        existentes = {(ordenes[i].strip().upper(), refs[i].strip().upper()) for i in range(min(len(ordenes), len(refs)))}
        nuevas = [f for f in filas if (codigo.upper(), str(f[5]).upper()) not in existentes]
        if not nuevas:
            return {'modo': 'ya_estaba', 'filas': []}
        ultima = max((i + 1 for i, v in enumerate(ordenes) if str(v).strip()), default=0)
        inicio = max(ultima + 1, 2)
        fin = inicio + len(nuevas) - 1
        ws.update(f'B{inicio}:L{fin}', [f[:11] for f in nuevas], value_input_option='USER_ENTERED')
        ws.update(f'P{inicio}:Q{fin}', [f[11:13] for f in nuevas], value_input_option='USER_ENTERED')
        ws.update(f'T{inicio}:T{fin}', [[f[13]] for f in nuevas], value_input_option='USER_ENTERED')
        anotar(codigo, [f[5] for f in nuevas])
        log.info('Sheet producción: %s filas desde la %s (%s)', len(nuevas), inicio, codigo)
        return {'modo': 'escrito', 'desde': inicio, 'filas': nuevas}


def registrar_seguro(codigo: str, datos: dict, grupos: list):
    try:
        return registrar(codigo, datos, grupos)
    except Exception:  # noqa: BLE001 - nunca debe impedir programar el pedido
        log.exception('No se pudo registrar %s en la hoja de Producción', codigo)
        return None


def borrar(codigo: str) -> dict:
    """Borra de la hoja solo las filas que registró el sistema para esta orden (CO/RM + referencia)."""
    codigo = codigo.upper()
    with _lock:
        datos = _leer_registros()
        refs = set(datos.get(codigo, []))
        if not refs:
            return {'borradas': 0}
        ws = _hoja()
        ordenes = ws.col_values(COL_ORDEN)
        referencias = ws.col_values(COL_REFERENCIA)
        filas = [i + 1 for i in range(min(len(ordenes), len(referencias)))
                 if ordenes[i].strip().upper() == codigo and referencias[i].strip().upper() in refs]
        for n in sorted(filas, reverse=True):
            ws.delete_rows(n)
        datos.pop(codigo, None)
        _guardar_registros(datos)
        log.info('Sheet producción: %s filas borradas de %s', len(filas), codigo)
        return {'borradas': len(filas)}
