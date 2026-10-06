"""Promedios maestros: consumo de tela por referencia (maestro).

Sale de lo que ya se registra en Producción: los MTS REQUERIDOS (nota de la celda de la tela) de cada orden dividido
entre su CANTIDAD de prendas. Se agrupa por REFERENCIA. Solo lee; no escribe nada.
"""
import json
import re
from typing import Callable

from fastapi import APIRouter

router = APIRouter(prefix='/api/promedios', tags=['promedios'])

_connect: Callable | None = None
_MTS = re.compile(r'(\d+(?:[.,]\d+)?)\s*MTS', re.I)
COLUMNA_TELA = 17   # el MTS REQUERIDO se anota en la celda de la tela (columna 17), igual que las tarjetas de producción


def configurar(connect: Callable) -> None:
    global _connect
    _connect = connect


def _numero(texto) -> float | None:
    try:
        return float(str(texto).replace(',', '.'))
    except ValueError:
        return None


def _mts_de(notas: list[str]) -> float | None:
    """Último «NNN MTS» de la nota; si no dice MTS pero es solo un número, se toma tal cual."""
    for nota in notas:
        encontrados = _MTS.findall(nota or '')
        if encontrados:
            return _numero(encontrados[-1])
    for nota in notas:
        limpio = str(nota or '').strip()
        if re.fullmatch(r'\d+(?:[.,]\d+)?', limpio):
            return _numero(limpio)
    return None


def _prendas(texto) -> int:
    digitos = re.sub(r'[^\d]', '', str(texto or '').split('.')[0].split(',')[0])
    return int(digitos) if digitos else 0


def calcular(headers: list, filas: list[tuple[int, list]], notas: dict[int, dict[int, str]]) -> dict:
    titulos = [str(h or '').strip().upper() for h in headers]
    idx = lambda nombre: next((i for i, t in enumerate(titulos) if t == nombre), -1)
    i_ref, i_cant, i_ord, i_cli, i_tela = idx('REFERENCIA'), idx('CANTIDAD'), idx('ORDEN'), idx('NOMBRE DEL CLIENTE'), idx('TELA')
    grupos: dict[str, dict] = {}
    sin_mts = 0
    for fila, valores in filas:
        celda = lambda i: str(valores[i]).strip() if 0 <= i < len(valores) and valores[i] is not None else ''
        referencia = celda(i_ref).upper()
        if not referencia:
            continue
        prendas = _prendas(celda(i_cant))
        propias = notas.get(fila, {})
        mts = _mts_de([propias.get(COLUMNA_TELA, '')] + [v for k, v in propias.items() if k != COLUMNA_TELA])
        if not mts or not prendas:
            sin_mts += 1
            continue
        g = grupos.setdefault(referencia, {'referencia': referencia, 'pedidos': 0, 'prendas': 0, 'mts': 0.0, 'telas': set(), 'ordenes': []})
        g['pedidos'] += 1
        g['prendas'] += prendas
        g['mts'] += mts
        tela = celda(i_tela)
        if tela:
            g['telas'].add(tela)
        g['ordenes'].append({'orden': celda(i_ord), 'cliente': celda(i_cli), 'tela': tela, 'prendas': prendas,
                             'mts': round(mts, 2), 'promedio': round(mts / prendas, 3)})
    lista = []
    for g in grupos.values():
        promedios = [o['promedio'] for o in g['ordenes']]
        lista.append({'referencia': g['referencia'], 'telas': sorted(g['telas']), 'pedidos': g['pedidos'], 'prendas': g['prendas'],
                      'mts': round(g['mts'], 2), 'promedio': round(g['mts'] / g['prendas'], 3),
                      'minimo': min(promedios), 'maximo': max(promedios), 'ordenes': sorted(g['ordenes'], key=lambda o: o['orden'], reverse=True)})
    lista.sort(key=lambda g: g['referencia'])
    return {'maestros': lista, 'sin_registrar': sin_mts}


@router.get('')
def promedios():
    db = _connect()
    try:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key, value FROM production_meta')}
        headers = json.loads(meta.get('headers') or '[]')
        filas = [(r['source_row'], json.loads(r['values_json'])) for r in db.execute('SELECT source_row, values_json FROM production_rows')]
        notas: dict[int, dict[int, str]] = {}
        for r in db.execute('SELECT source_row, column_number, note FROM production_notes'):
            notas.setdefault(r['source_row'], {})[r['column_number']] = r['note']
    finally:
        db.close()
    return calcular(headers, filas, notas)
