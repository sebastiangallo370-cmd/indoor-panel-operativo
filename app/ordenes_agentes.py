"""Lista de órdenes para el selector de Agentes: «orden · proyecto · referencia».

Solo lee la base de producción que ya tiene el panel; no escribe nada.
"""
from __future__ import annotations

import re
import unicodedata


def _sin_tildes(texto: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c)).strip().upper()


def lista_para_agentes(base: dict, limite: int = 500, parse_fecha=None) -> list[dict]:
    """Una opción por cada combinación orden + proyecto + referencia de la base de producción.

    `parse_fecha` convierte el texto de FECHA DE ENTREGA en fecha; así el filtro de la pantalla compara fechas reales.
    """
    headers = [_sin_tildes(h) for h in base.get('headers') or []]
    if 'ORDEN' not in headers:
        return []
    i_orden = headers.index('ORDEN')
    i_proyecto = headers.index('NOMBRE PROYECTO') if 'NOMBRE PROYECTO' in headers else -1
    i_ref = headers.index('REFERENCIA') if 'REFERENCIA' in headers else -1
    i_entrega = headers.index('FECHA DE ENTREGA') if 'FECHA DE ENTREGA' in headers else -1

    def celda(valores: list, indice: int) -> str:
        return str(valores[indice]).strip() if 0 <= indice < len(valores) and valores[indice] is not None else ''

    vistos: dict[tuple[str, str, str], dict] = {}
    for fila in base.get('rows') or []:
        valores = fila.get('values') or []
        orden = re.sub(r'\s+', '', celda(valores, i_orden)).upper()
        if not orden:
            continue
        proyecto = celda(valores, i_proyecto)
        referencia = re.sub(r'\s+', '', celda(valores, i_ref)).upper()
        clave = (orden, proyecto, referencia)
        if clave not in vistos:
            etiqueta = f"{orden} · {proyecto or 'sin proyecto'} · {referencia or 'sin referencia'}"
            entrega = celda(valores, i_entrega)
            fecha = parse_fecha(entrega) if parse_fecha and entrega else None
            vistos[clave] = {'valor': orden, 'etiqueta': etiqueta, 'entrega': entrega,
                             'entrega_iso': fecha.isoformat() if fecha else ''}
    # Las más próximas primero; las que no tienen fecha van al final.
    return sorted(vistos.values(), key=lambda o: (o['entrega_iso'] == '', o['entrega_iso'], o['etiqueta']))[:limite]
