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
    valores += [x.get('consumo', 0) for grupo in (maestro.get('extras') or {}).values() for x in grupo if x.get('consumo')]
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

    def limpiar_extras(bruto: object) -> dict:
        """Tallas adicionales por familia, sin modificar la tabla estándar."""
        if bruto is None:
            return {}
        if not isinstance(bruto, dict):
            raise HTTPException(400, 'Las tallas adicionales no son válidas.')
        salida = {}
        for grupo in GRUPOS:
            filas = bruto.get(grupo) or []
            if not isinstance(filas, list) or len(filas) > 12:
                raise HTTPException(400, 'Cada familia admite máximo 12 tallas adicionales.')
            vistos, limpias = set(), []
            for fila in filas:
                if not isinstance(fila, dict):
                    raise HTTPException(400, 'Cada talla adicional debe tener nombre y consumo.')
                talla = re.sub(r'\s+', '', str(fila.get('talla') or '')).upper()
                if not re.fullmatch(r'[A-Z0-9+\-]{1,10}', talla) or talla in GRUPOS[grupo] or talla in vistos:
                    raise HTTPException(400, 'Revisa el nombre de la talla adicional: no puede repetirse.')
                vistos.add(talla)
                try:
                    consumo = round(float(str(fila.get('consumo') or 0).replace(',', '.')), 2)
                except ValueError:
                    raise HTTPException(400, 'Los consumos de las tallas adicionales deben ser números.')
                if not 0 <= consumo <= 99:
                    raise HTTPException(400, 'Cada consumo debe estar entre 0 y 99 MTS.')
                limpias.append({'talla': talla, 'consumo': consumo})
            if limpias:
                salida[grupo] = limpias
        return salida

    limpio['extras'] = limpiar_extras(payload.get('extras'))
    # Una referencia puede usar más de una tela.  Cada material conserva su
    # propio consumo por talla; no se mezcla con el promedio general de la
    # referencia.  Es opcional para no alterar los maestros que ya existen.
    materiales = payload.get('materiales')
    if materiales is not None:
        if not isinstance(materiales, list) or len(materiales) > 8:
            raise HTTPException(400, 'Los materiales deben ser una lista de máximo 8 telas.')
        limpio['materiales'] = []
        vistos = set()
        for bruto in materiales:
            if not isinstance(bruto, dict):
                raise HTTPException(400, 'Cada material debe tener su código y consumos por talla.')
            material = str(bruto.get('material') or '').strip().upper()
            if not re.fullmatch(r'M[1-8]', material) or material in vistos:
                raise HTTPException(400, 'Cada material debe identificarse una sola vez como M1 a M8.')
            vistos.add(material)
            tela = str(bruto.get('tela') or '').strip()[:120]
            # Fusionado es una propiedad del material, no un tipo de tela:
            # puede estar presente en M1, M2 o cualquier otro material.
            fila_material = {'material': material, 'tela': tela, 'fusionado': bool(bruto.get('fusionado'))}
            for grupo, tallas in GRUPOS.items():
                valores = bruto.get(grupo) or [0] * len(tallas)
                if not isinstance(valores, list) or len(valores) != len(tallas):
                    raise HTTPException(400, f'Faltan consumos de {material} para {grupo.upper()}.')
                try:
                    fila_material[grupo] = [round(float(str(v).replace(',', '.') or 0), 2) for v in valores]
                except ValueError:
                    raise HTTPException(400, 'Los consumos de cada material deben ser números.')
                if any(not 0 <= n <= 99 for n in fila_material[grupo]):
                    raise HTTPException(400, 'Cada consumo de material debe estar entre 0 y 99 MTS.')
            fila_material['extras'] = limpiar_extras(bruto.get('extras'))
            limpio['materiales'].append(fila_material)
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
            # Las pantallas antiguas todavía no envían ``materiales``. No
            # borrar una configuración multimaterial ya documentada al editar
            # otro campo del maestro desde una de esas pantallas.
            if 'materiales' not in payload and lista[existente].get('materiales'):
                nuevo['materiales'] = lista[existente]['materiales']
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
# El bloque inicial A<codigo> puede llevar varios códigos separados por guión:
# A11300-1800FUT04 = telas 11300 y 1800 para la referencia FUT04.
_CODIGO_TELA = re.compile(r'^A\d+(?:-\d+)*(?=[A-Z]{1,5}\d{2,3})')


def _plano(texto: str) -> str:
    import unicodedata
    sin = ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', sin.upper())


def partes_de_hoja(hoja: str) -> list[str]:
    """Quita códigos de tela sin partir sus materiales.

    «A11300-1800FUT04» -> [FUT04].  Solo se separan referencias completas,
    como «A100CB02-A100PT01» -> [CB02, PT01].
    """
    partes = [p.strip().upper() for p in re.split(r'-(?=A\d+(?:-\d+)*(?:[A-Z]{1,5}\d{2,3}))|[+/]', str(hoja or '')) if p.strip()]
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


def plantillas_de_hoja(hoja: str, datos: dict | None = None) -> dict:
    """Plantillas .ai que corresponden a una referencia del listado, según Promedios maestros:
    {'encontrado', 'maestros': [CA02], 'codigos': ['CA02M','CA02F','CA02N']}. Sin maestro en Promedios, 'encontrado' es False."""
    if datos is None:
        with _lock:
            datos = _leer()
    campos = ('p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short')
    maestros = {m['ref']: m for m in datos['maestros']}
    por_plantilla = {}
    for m in datos['maestros']:
        for campo in campos:
            codigo = str(m.get(campo) or '').strip().upper()
            if codigo:
                por_plantilla.setdefault(codigo, m)
    refs, codigos = [], []
    for parte in partes_de_hoja(hoja):
        maestro = maestros.get(parte) or por_plantilla.get(parte)
        if not maestro:
            continue
        refs.append(maestro['ref'])
        for campo in campos:
            codigo = str(maestro.get(campo) or '').strip().upper()
            if codigo and codigo not in codigos:
                codigos.append(codigo)
    return {'encontrado': bool(refs), 'maestros': refs, 'codigos': codigos}


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
        grupo, talla = _grupo_de_genero(linea.get('genero', '')), _talla(linea.get('talla', ''))
        # Talla numérica (2 a 16) en MASC/FEM: es talla de niño/niña aunque el listado diga solo el género
        if grupo in ('masc', 'fem') and talla not in GRUPOS[grupo] and talla in GRUPOS['nino']:
            grupo = 'nino' if grupo == 'masc' else 'nina'
        clave = (grupo, talla)
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
            if talla in tallas:
                valor = maestro[grupo][tallas.index(talla)]
            else:
                extra = next((x for x in (maestro.get('extras') or {}).get(grupo, []) if x.get('talla') == talla), None)
                valor = extra.get('consumo', 0) if extra else 0
            if not valor:
                faltan.add(f'{parte}: sin consumo para {grupo.upper()} talla {talla}')
            consumo += valor
        subtotal = round(consumo * cantidad, 4)
        total += subtotal
        detalle.append({'grupo': grupo, 'talla': talla, 'cantidad': cantidad, 'promedio': round(consumo, 2), 'subtotal': round(subtotal, 2)})
    return {'hoja': hoja, 'partes': partes, 'prendas': sum(cuenta.values()), 'mts': round(total, 2), 'detalle': detalle,
            'faltan': sorted(faltan), 'completo': not faltan and bool(cuenta)}
