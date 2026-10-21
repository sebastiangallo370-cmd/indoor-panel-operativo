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


def marcar_no_aplica(base: dict, proceso_de) -> None:
    """En lo que ve la web (no en la base ni en el Sheet), las columnas de TRAZO/CORTE/PLT vacías de una referencia que no lo usa se muestran «N/A»:
    así esa referencia no aparece en la cola de ese proceso ni frena su avance. `proceso_de(encabezado)` da la etiqueta del proceso de esa columna."""
    headers = base.get('headers') or []
    plano = [_plano(h) for h in headers]
    ref = plano.index('REFERENCIA') if 'REFERENCIA' in plano else -1
    cols = [i for i, h in enumerate(headers) if proceso_de(h) == ETIQUETA]
    if ref < 0 or not cols:
        return
    for row in base.get('rows') or []:
        v = row['values']
        if ref < len(v) and not aplica_trazo(v[ref]):
            for i in cols:
                if i < len(v) and not str(v[i] or '').strip():
                    v[i] = 'N/A'
