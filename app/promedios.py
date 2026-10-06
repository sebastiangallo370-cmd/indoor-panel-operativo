"""Promedios maestros: consumo promedio de tela por maestro y talla (mismos formularios que el sistema de promedios de la red).

Cada maestro (referencia base: BZ03, PE14…) guarda su consumo en MTS por talla para FEMENINO y MASCULINO (XS a 4XL) y NIÑA y NIÑO (2 a 16),
sus plantillas y complementos, y puede tener notas/reglas. El «consumo promedio» es la media de todos los valores distintos de cero.
Datos en /data/state/promedios_maestros.json; la primera vez se siembran con app/promedios_semilla.txt.
"""
import json
import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix='/api/promedios', tags=['promedios'])

ARCHIVO = Path(os.getenv('PROMEDIOS_FILE', '/data/state/promedios_maestros.json'))
SEMILLA = Path(__file__).with_name('promedios_semilla.txt')
_lock = threading.Lock()
_auth: Callable = lambda: ''

TALLAS_ADULTO = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']
TALLAS_NINO = ['2', '4', '6', '8', '10', '12', '14', '16']
GRUPOS = {'fem': TALLAS_ADULTO, 'masc': TALLAS_ADULTO, 'nina': TALLAS_NINO, 'nino': TALLAS_NINO}
TIPOS_NOTA = ('NOTA', 'OMITIR_MANUAL', 'SIN_FUSIONADO', 'SIN_SUBCARPETAS')
DISENOS = ('D1', 'D2', 'D3', 'D4', 'D5', 'D6')
TEXTOS = ('c_adulto', 'c_nino', 'p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short')


def configurar(authenticate: Callable) -> None:
    global _auth
    _auth = authenticate


def _sembrar() -> dict:
    maestros, notas = [], []
    try:
        lineas = SEMILLA.read_text(encoding='utf-8').splitlines()
    except OSError:
        return {'maestros': [], 'notas': []}
    for linea in lineas:
        if linea.startswith('M|'):
            a = linea.split('|')
            if len(a) < 13:
                continue
            g = {k: [float(x or 0) for x in a[9 + i].split(',')] for i, k in enumerate(('fem', 'masc', 'nina', 'nino'))}
            maestros.append({'ref': a[1], 'diseno': a[2], 'c_adulto': a[3], 'c_nino': a[4], 'p_masculino': a[5], 'p_femenino': a[6],
                             'p_femenino_short': '', 'p_nino': a[7], 'p_nina': a[8], 'p_nina_short': '', **g})
        elif linea.startswith('N|'):
            a = linea.split('|', 5)
            if len(a) >= 6:
                notas.append({'id': uuid.uuid4().hex[:10], 'ref': a[1], 'tipo': a[2], 'texto': a[3], 'por': a[4], 'fecha': a[5]})
    return {'maestros': maestros, 'notas': notas}


def _leer() -> dict:
    try:
        return json.loads(ARCHIVO.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        datos = _sembrar()
        _guardar(datos)
        return datos


def _guardar(datos: dict) -> None:
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ARCHIVO.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(ARCHIVO)


def promedio(maestro: dict) -> float:
    valores = [v for k in GRUPOS for v in maestro.get(k, []) if v]
    return round(sum(valores) / len(valores), 2) if valores else 0.0


def _vista(maestro: dict) -> dict:
    return {**maestro, 'promedio': promedio(maestro)}


def _limpiar(payload: dict) -> dict:
    ref = re.sub(r'\s+', '', str(payload.get('ref') or '')).upper()
    if not re.fullmatch(r'[A-Z0-9]{2,14}', ref):
        raise HTTPException(400, 'La referencia base debe tener entre 2 y 14 letras o números (ej: BZ03).')
    diseno = str(payload.get('diseno') or 'D6').upper()
    if diseno not in DISENOS:
        raise HTTPException(400, 'El diseño debe ser D1 a D6.')
    limpio = {'ref': ref, 'diseno': diseno}
    for campo in TEXTOS:
        limpio[campo] = str(payload.get(campo) or '').strip()[:80]
    for grupo, tallas in GRUPOS.items():
        valores = payload.get(grupo) or []
        if not isinstance(valores, list) or len(valores) != len(tallas):
            raise HTTPException(400, f'Faltan consumos del grupo {grupo.upper()}.')
        fila = []
        for v in valores:
            try:
                n = float(str(v).replace(',', '.') or 0)
            except ValueError:
                raise HTTPException(400, 'Los consumos deben ser números (ej: 1,25).')
            if not 0 <= n <= 99:
                raise HTTPException(400, 'Cada consumo debe estar entre 0 y 99 MTS.')
            fila.append(round(n, 2))
        limpio[grupo] = fila
    return limpio


@router.get('')
def listar():
    with _lock:
        datos = _leer()
    return {'maestros': [_vista(m) for m in datos['maestros']], 'notas': datos['notas'],
            'tallas': {'adulto': TALLAS_ADULTO, 'nino': TALLAS_NINO}, 'tipos_nota': list(TIPOS_NOTA), 'disenos': list(DISENOS)}


@router.post('/maestro')
def guardar_maestro(payload: dict):
    """Crea o actualiza (por referencia base) un maestro."""
    nuevo = _limpiar(payload)
    with _lock:
        datos = _leer()
        lista = datos['maestros']
        existente = next((i for i, m in enumerate(lista) if m['ref'] == nuevo['ref']), None)
        if existente is None:
            lista.append(nuevo)
        else:
            lista[existente] = nuevo
        _guardar(datos)
    return {'ok': True, 'maestro': _vista(nuevo), 'creado': existente is None}


@router.delete('/maestro/{ref}')
def borrar_maestro(ref: str):
    with _lock:
        datos = _leer()
        antes = len(datos['maestros'])
        datos['maestros'] = [m for m in datos['maestros'] if m['ref'] != ref.upper()]
        if len(datos['maestros']) == antes:
            raise HTTPException(404, 'Ese maestro ya no existe.')
        _guardar(datos)
    return {'ok': True}


@router.post('/nota')
def agregar_nota(request: Request, payload: dict):
    usuario = str(_auth(request) or '')
    ref = re.sub(r'\s+', '', str(payload.get('ref') or '')).upper()
    tipo = str(payload.get('tipo') or 'NOTA').upper()
    texto = str(payload.get('texto') or '').strip()[:500]
    if tipo not in TIPOS_NOTA or not ref or not texto:
        raise HTTPException(400, 'La nota necesita referencia, tipo y texto.')
    nota = {'id': uuid.uuid4().hex[:10], 'ref': ref, 'tipo': tipo, 'texto': texto, 'por': usuario,
            'fecha': datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    with _lock:
        datos = _leer()
        datos['notas'].insert(0, nota)
        _guardar(datos)
    return {'ok': True, 'nota': nota}


@router.delete('/nota/{nota_id}')
def borrar_nota(nota_id: str):
    with _lock:
        datos = _leer()
        antes = len(datos['notas'])
        datos['notas'] = [n for n in datos['notas'] if n['id'] != nota_id]
        if len(datos['notas']) == antes:
            raise HTTPException(404, 'Esa nota ya no existe.')
        _guardar(datos)
    return {'ok': True}


# ---------------------------------------------------------------- MTS REQUERIDOS de una orden (lo usa el agente TERRY)
_CODIGO_TELA = re.compile(r'^A\d+(?=[A-Z]{1,4}\d)')


def _plano(texto: str) -> str:
    import unicodedata
    sin = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', sin.upper())


def partes_de_hoja(hoja: str) -> list[str]:
    """«A100FUT01» -> [FUT01] (quita el código de tela A100); una referencia compuesta «A100CB02-A100PT01» -> [CB02, PT01]."""
    partes = [p.strip().upper() for p in re.split(r'[-+/]', str(hoja or '')) if p.strip()]
    return [_CODIGO_TELA.sub('', p) for p in partes]


def _grupo_de_genero(genero: str) -> str:
    g = _plano(genero)
    if g.startswith('MASC') or g == 'M':
        return 'masc'
    if g.startswith('FEM') or g == 'F':
        return 'fem'
    if g.startswith('NINA'):
        return 'nina'
    return 'nino'   # NIÑO y el «N» genérico


def _talla(talla: str) -> str:
    t = _plano(talla)
    return '2XL' if t == 'XXL' else t


def calcular_hoja(hoja: str, lineas: list[dict], datos: dict | None = None) -> dict:
    """MTS requeridos de una referencia del listado: por cada talla, el consumo promedio del maestro × la cantidad de prendas; todo sumado.
    Cada línea del listado es una prenda. Si falta el maestro o el consumo de alguna talla, `faltan` lo dice y `completo` es False."""
    if datos is None:
        with _lock:
            datos = _leer()
    maestros = {m['ref']: m for m in datos['maestros']}
    # La hoja puede traer el código de la plantilla (A50CA00M = tela A50 + plantilla CA00M del maestro CA00): también se reconoce por ahí
    plantillas = {}
    for m in datos['maestros']:
        for campo in ('p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short'):
            codigo = str(m.get(campo) or '').strip().upper()
            if codigo:
                plantillas.setdefault(codigo, m)
    partes = partes_de_hoja(hoja)
    cuenta: dict[tuple, int] = {}
    for linea in lineas:
        clave = (_grupo_de_genero(linea.get('genero', '')), _talla(linea.get('talla', '')))
        cuenta[clave] = cuenta.get(clave, 0) + int(linea.get('cantidad') or 1)
    detalle, faltan, total = [], set(), 0.0
    for (grupo, talla), cantidad in sorted(cuenta.items()):
        consumo = 0.0
        for parte in partes:
            maestro = maestros.get(parte) or plantillas.get(parte)
            if not maestro:
                faltan.add(f'no existe el maestro {parte} en Promedios maestros')
                continue
            tallas = GRUPOS[grupo]
            valor = maestro[grupo][tallas.index(talla)] if talla in tallas else 0
            if not valor:
                faltan.add(f'{parte}: sin consumo para {grupo.upper()} talla {talla}')
            consumo += valor
        subtotal = round(consumo * cantidad, 4)
        total += subtotal
        detalle.append({'grupo': grupo, 'talla': talla, 'cantidad': cantidad, 'promedio': round(consumo, 2), 'subtotal': round(subtotal, 2)})
    return {'hoja': hoja, 'partes': partes, 'prendas': sum(cuenta.values()), 'mts': round(total, 2), 'detalle': detalle,
            'faltan': sorted(faltan), 'completo': not faltan and bool(cuenta)}
