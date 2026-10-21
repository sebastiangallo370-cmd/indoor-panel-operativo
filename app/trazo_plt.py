"""TRAZO/CORTE/PLT: proceso de Producción que solo usan las referencias de tela que NO es blanca."""
import re
import unicodedata

ETIQUETA = 'TRAZO/CORTE/PLT'
_TELA_EN_REFERENCIA = re.compile(r'(?:^|[^A-Z0-9])A(\d{2,5})(?=[A-Z])')


def aplica_trazo(referencia) -> bool:
    """El código de tela de la referencia (A200CA01 → 200) no termina en 00 (A2102SD02 → 2102 sí aplica). Una referencia con varias partes
    aplica si alguna lo cumple; sin código de tela no aplica."""
    return any(not c.endswith('00') for c in _TELA_EN_REFERENCIA.findall(str(referencia or '').upper()))


def _plano(texto) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(texto or '')) if not unicodedata.combining(c)).strip().upper()


def marcar_no_aplica(base: dict, proceso_de, es_fecha=lambda texto: False) -> None:
    """En lo que ve la web (no en la base ni en el Sheet), las columnas de TRAZO/CORTE/PLT:
      · en una referencia que no lo usa (tela blanca o sin código) todo lo que no sea una fecha, incluida una «P» puesta por error, se muestra «N/A»;
      · en un pedido ya ENTREGADO (con fecha en esa columna del Sheet) todo lo que no sea una fecha o «N/A» (vacío, «P», notas viejas como «PLT» o «26-05»)
        se muestra «N/A»: un pedido entregado ya terminó todo, así no queda en la cola.
    `proceso_de(encabezado)` da la etiqueta del proceso de esa columna; `es_fecha(texto)` dice si el texto es una fecha."""
    headers = base.get('headers') or []
    plano = [_plano(h) for h in headers]
    ref = plano.index('REFERENCIA') if 'REFERENCIA' in plano else -1
    ent = plano.index('ENTREGADO') if 'ENTREGADO' in plano else -1
    cols = [i for i, h in enumerate(headers) if proceso_de(h) == ETIQUETA]
    if ref < 0 or not cols:
        return
    for row in base.get('rows') or []:
        v = row['values']
        entregado = 0 <= ent < len(v) and bool(es_fecha(str(v[ent] or '')))
        sin_uso = ref < len(v) and not aplica_trazo(v[ref])
        for i in cols:
            if i >= len(v):
                continue
            celda = str(v[i] or '').strip()
            cerrada = celda.upper() == 'N/A' or bool(es_fecha(celda))
            if (entregado or sin_uso) and not cerrada:
                v[i] = 'N/A'
