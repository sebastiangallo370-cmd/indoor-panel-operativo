"""Datos persistentes de Contabilidad Confección para el panel.

La API sirve una copia JSON 2026 almacenada en el VPS. El Excel se usa solo
para generar o actualizar esa copia fuera del ciclo normal de la aplicación.
"""
from __future__ import annotations

import copy
import hashlib
import os
import json
import uuid
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
YEAR = 2026
DEFAULT_FILE = '/data/contabilidad_confeccion_2026.json'
# Liquidaciones hechas desde el panel: archivo aparte para que sobrevivan a regenerar la copia 2026 desde el Excel
LIQ_DEFAULT_FILE = '/data/contabilidad_confeccion_liquidaciones.json'

# Las hojas de apoyo no son confeccionistas. Todas las demás hojas que tengan
# filas con fechas 2026 se incorporan automáticamente, incluidas las variantes
# .Unif/.Unifo/.conf que aparecen en el libro consolidado del usuario.
EXCLUDED_SHEETS = {'inicio', 'hoja1', 'hoja2', 'hoja3', 'maestro'}
SHEET_LABELS = {
    'yenni monsalve confec': 'Yenni Monsalve', 'alba confeccion': 'Alba Confección',
    'noelia ciro confec': 'Noelia Ciro', 'liliana marin conf': 'Liliana Marín',
    'omaira bergara conf': 'Omaira Bergara', 'juan esteban confecc': 'Juan Esteban',
    'Blanca emilce': 'Blanca Emilce', 'madelin tulas': 'Madelin Tulas', 'Aida.Unifo': 'Aida',
}
_cache: dict = {'mtime': None, 'data': None}
_lock = Lock()


def _source() -> Path:
    return Path(os.getenv('CONFECCION_DATA_PATH', DEFAULT_FILE))


def _number(value) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _is_2026(value) -> bool:
    return isinstance(value, (datetime, date)) and value.year == YEAR


def _paid(value) -> bool:
    """Una fecha, 'cancelado' o un valor en la columna de pago marca el renglón pagado."""
    if isinstance(value, (datetime, date)):
        return True
    return bool(str(value or '').strip())


_MESES = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8,
          'sep': 9, 'set': 9, 'oct': 10, 'nov': 11, 'dic': 12}
_DIAS = {'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo'}


def _fecha_pago(value):
    """Fecha de una marca de pago: celda fecha o texto tipo 'lunes 23 de noviembre 2026' (tolera 'enro')."""
    if isinstance(value, (datetime, date)):
        return _day(value)
    import re
    texto = ' '.join(str(value or '').lower().split())
    anio = re.search(r'(20\d\d)', texto)
    dia = re.search(r'(?<!\d)(\d{1,2})(?!\d)', texto)   # también «martes23»
    palabras = [pal for pal in re.findall(r'[a-záéíóúñ]+', texto) if pal not in _DIAS]   # «martes» no es marzo
    mes = next((num for pal in palabras for clave, num in _MESES.items()
                if pal.startswith(clave) or (clave == 'ene' and pal.startswith('en'))
                or (clave == 'ago' and pal.startswith('ag'))), None)   # «enro», «agisto»
    if anio and dia and mes:
        try:
            fecha = date(int(anio.group(1)), mes, int(dia.group(1)))
        except ValueError:
            return None
        if fecha > date.today() and fecha.year != YEAR:
            try:   # «lunes 30 de marzo 2028»: el año está mal digitado; en 2026 sí cae lunes
                corregida = fecha.replace(year=YEAR)
                return corregida if corregida <= date.today() else fecha
            except ValueError:
                return fecha
        return fecha
    return None


def _day(value):
    """Convierte fechas de Excel a fecha sin perder compatibilidad con celdas vacías."""
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def _payment_label(value) -> str | None:
    """Expone solo la marca de pago del Excel, sin interpretar abonos."""
    payment_day = _day(value)
    if payment_day:
        return payment_day.isoformat()
    text = ' '.join(str(value or '').split())
    return text[:48] if text else None


def _etiqueta_pago(value) -> str | None:
    """Fecha ISO si la marca de pago se puede leer (y no es futura por error de digitación); si no, el texto."""
    fecha = _fecha_pago(value)
    return fecha.isoformat() if fecha and fecha <= date.today() else _payment_label(value)


def _weighted_days(rows: list[dict]) -> float | None:
    timed = [row for row in rows if row['duration'] is not None and row['received'] > 0]
    if not timed:
        return None
    total_units = sum(row['received'] for row in timed)
    return round(sum(row['duration'] * row['received'] for row in timed) / total_units, 1)


def _clean_label(value, fallback: str) -> str:
    label = ' '.join(str(value or '').split())
    return label[:72] if label else fallback


def _client_type(value) -> str:
    text = ' '.join(str(value or '').upper().split())
    if any(word in text for word in ('CLUB', 'FC ', 'FÚTBOL', 'FUTBOL')):
        return 'Clubes'
    if any(word in text for word in ('ACADEMIA', 'ESCUELA', 'SEMILLERO')):
        return 'Academias'
    if any(word in text for word in ('COLEGIO', 'COLEGIA', 'INSTITUCIÓN', 'INSTITUCION')):
        return 'Colegios'
    if any(word in text for word in ('UNIVERSIDAD', 'UNIVERSIT')):
        return 'Universidades'
    if any(word in text for word in ('SAS', 'EMPRESA', 'INDUSTRIA', 'CORPORACION', 'CORPORACIÓN')):
        return 'Empresas'
    if any(word in text for word in ('TORNEO', 'COPA', 'COMPETENCIA', 'INTERCLASES')):
        return 'Torneos'
    if any(word in text for word in ('ECOMMERCE', 'E-COMMERCE', 'ONLINE', 'WEB')):
        return 'Ecommerce'
    return 'Distribuidores'


def _product_category(value) -> str:
    text = ' '.join(str(value or '').upper().split())
    if any(word in text for word in ('CAMISETA', 'CAMIBUSO', 'POLO')):
        return 'Camisetas'
    if any(word in text for word in ('UNIFORME', 'CONJUNTO')):
        return 'Conjuntos'
    if 'PANTALONETA' in text:
        return 'Pantalonetas'
    if any(word in text for word in ('CHAQUETA', 'CHOMPA', 'SUDADERA')):
        return 'Chaquetas'
    if any(word in text for word in ('MEDIA', 'MEDIAS')):
        return 'Medias'
    return 'Personalizados'


def _maker_label(sheet_name: str) -> str:
    clean_name = sheet_name.strip()
    return SHEET_LABELS.get(clean_name, clean_name.title())


def _read(path: Path) -> dict:
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=True, data_only=True)
    makers = []
    all_rows = []
    for sheet_name in book.sheetnames:
        if sheet_name.strip().lower() in EXCLUDED_SHEETS:
            continue
        label = _maker_label(sheet_name)
        sheet = book[sheet_name]
        rows = []
        # En el Excel la fecha de pago se escribe solo en la PRIMERA fila de cada lote pagado y el lote
        # llega hasta la fila anterior a la siguiente marca. El último lote está abierto: de él solo
        # cuentan como pagadas las filas entregadas hasta su fecha de pago (lo demás es el ciclo en curso).
        marcas, lote_de = [], []
        for values in sheet.iter_rows(min_col=2, max_col=12, values_only=True):
            _client, _quote, reference, description, sent_date, received_date, sent, received, unit_value, value, payment = values
            if _paid(payment):
                marcas.append((_fecha_pago(payment), _etiqueta_pago(payment)))
            if not (_is_2026(sent_date) or _is_2026(received_date)):
                continue
            sent, received, unit_value, value = map(_number, (sent, received, unit_value, value))
            if not any((sent, received, unit_value, value)):
                continue
            if not _paid(payment) and marcas and received > 0:
                lote_de.append((len(rows), len(marcas) - 1))
            amount = value or received * unit_value
            sent_day, received_day = _day(sent_date), _day(received_date)
            duration = (received_day - sent_day).days if sent_day and received_day and received_day >= sent_day else None
            rows.append({
                'maker': label, 'client': _clean_label(_client, 'Sin cliente'), 'client_type': _client_type(_client),
                'product_category': _product_category(description), 'sent': sent, 'received': received, 'amount': amount,
                'paid': _paid(payment), 'duration': duration, 'sent_date': sent_day,
                'received_date': received_day, 'description': _clean_label(description, 'Sin descripción'),
                'reference': _clean_label(reference, ''), 'quote': _clean_label(_quote, ''),
                'unit_value': unit_value, 'payment': _etiqueta_pago(payment),
            })
        # Último pago de la hoja (se ignoran fechas futuras, que son errores de digitación del año).
        ultimo_pago = max((f for f, _ in marcas if f and f <= date.today()), default=None)
        for indice, lote in lote_de:
            row = rows[indice]
            entrega = row['received_date'] or row['sent_date']
            if ultimo_pago is None:
                if lote == len(marcas) - 1:
                    continue   # lote abierto sin fecha legible: no se da por pagado
            elif not (entrega and entrega <= ultimo_pago):
                continue       # entregado después del último pago: es del ciclo en curso
            row['paid'], row['payment'] = True, marcas[lote][1]
        if not rows:
            continue
        sent = sum(row['sent'] for row in rows)
        received = sum(row['received'] for row in rows)
        amount = sum(row['amount'] for row in rows)
        paid = sum(row['amount'] for row in rows if row['paid'])
        makers.append({
            'name': label, 'orders': len(rows), 'sent': round(sent), 'received': round(received),
            'pending_units': round(max(0, sent - received)), 'amount': round(amount),
            'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(rows),
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'average_value_per_unit': round(amount / received) if received else None,
            'details': [{
                'sent_date': row['sent_date'].isoformat() if row['sent_date'] else None,
                'received_date': row['received_date'].isoformat() if row['received_date'] else None,
                'sent': round(row['sent']), 'received': round(row['received']), 'amount': round(row['amount']),
                'paid': row['paid'], 'payment': row['payment'], 'product': row['description'],
                'reference': row['reference'], 'quote': row['quote'], 'unit_value': round(row['unit_value']),
                'client': row['client'], 'client_type': row['client_type'],
                'product_category': row['product_category'],
            } for row in sorted(rows, key=lambda row: (row['received_date'] or row['sent_date'] or date.min), reverse=True)],
        })
        all_rows.extend(rows)
    if not makers:
        raise ValueError('El archivo no tiene registros 2026 de las hojas de confección configuradas.')
    sent = sum(row['sent'] for row in all_rows)
    received = sum(row['received'] for row in all_rows)
    amount = sum(row['amount'] for row in all_rows)
    paid = sum(row['amount'] for row in all_rows if row['paid'])
    monthly = defaultdict(lambda: {'sent': 0.0, 'received': 0.0, 'amount': 0.0})
    products = defaultdict(lambda: {'units': 0.0, 'amount': 0.0})
    pending = []
    for row in all_rows:
        if row['sent_date'] and row['sent_date'].year == YEAR:
            monthly[row['sent_date'].month]['sent'] += row['sent']
            monthly[row['sent_date'].month]['amount'] += row['amount']
        if row['received_date'] and row['received_date'].year == YEAR:
            monthly[row['received_date'].month]['received'] += row['received']
        products[row['description']]['units'] += row['received']
        products[row['description']]['amount'] += row['amount']
        if row['sent'] > row['received']:
            age_days = max(0, (date.today() - row['sent_date']).days) if row['sent_date'] else None
            pending.append({
                'maker': row['maker'], 'units': round(row['sent'] - row['received']),
                'sent_date': row['sent_date'].isoformat() if row['sent_date'] else None,
                'age_days': age_days, 'product': row['description'], 'reference': row['reference'],
            })

    monthly_data = [
        {'month': month, **{key: round(value) for key, value in monthly[month].items()}}
        for month in range(1, 13)
    ]
    products_data = [
        {'name': name, 'units': round(values['units']), 'amount': round(values['amount'])}
        for name, values in products.items() if values['units'] or values['amount']
    ]
    return {
        'year': YEAR, 'source_updated_at': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        'summary': {
            'orders': len(all_rows), 'sent': round(sent), 'received': round(received), 'pending_units': round(max(0, sent - received)),
            'amount': round(amount), 'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(all_rows), 'average_order_units': round(sent / len(all_rows), 1),
            'average_value_per_unit': round(amount / received) if received else None,
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'payment_marked_rate': round(paid / amount * 100, 1) if amount else None,
        },
        'makers': sorted(makers, key=lambda item: item['amount'], reverse=True),
        'details': [{
            'maker': row['maker'], 'sent_date': row['sent_date'].isoformat() if row['sent_date'] else None,
            'received_date': row['received_date'].isoformat() if row['received_date'] else None,
            'sent': round(row['sent']), 'received': round(row['received']), 'amount': round(row['amount']),
            'paid': row['paid'], 'payment': row['payment'], 'product': row['description'],
            'reference': row['reference'], 'quote': row['quote'], 'unit_value': round(row['unit_value']),
            'client': row['client'], 'client_type': row['client_type'],
            'product_category': row['product_category'],
        } for row in all_rows],
        'monthly': monthly_data,
        'products': sorted(products_data, key=lambda item: item['units'], reverse=True)[:8],
        'pending': sorted(pending, key=lambda item: (item['age_days'] or 0, item['units']), reverse=True),
    }


def _read_json(path: Path) -> dict:
    with path.open('r', encoding='utf-8') as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or not data.get('makers') or not data.get('summary'):
        raise ValueError('La copia local de contabilidad está incompleta.')
    data['source_updated_at'] = datetime.fromtimestamp(path.stat().st_mtime).isoformat()
    return data


def _liq_path() -> Path:
    return Path(os.getenv('CONFECCION_LIQUIDACIONES_PATH', LIQ_DEFAULT_FILE))


def _cargar_liquidaciones() -> list[dict]:
    path = _liq_path()
    if not path.is_file():
        return []
    with path.open('r', encoding='utf-8') as stream:
        return list(json.load(stream).get('liquidaciones', []))


def _guardar_liquidaciones(registros: list[dict]) -> None:
    path = _liq_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    with tmp.open('w', encoding='utf-8') as stream:
        json.dump({'liquidaciones': registros}, stream, ensure_ascii=False, indent=2)
    os.replace(tmp, path)   # escritura atómica: nunca queda un archivo a medias


def _clave(detalle: dict, maker: str) -> str:
    """Huella estable de un renglón: sirve para reconocer lo ya liquidado aunque el Excel se regenere."""
    partes = [maker, detalle.get('client'), detalle.get('quote'), detalle.get('reference'), detalle.get('product'),
              detalle.get('sent_date'), detalle.get('received_date'), detalle.get('sent'), detalle.get('received'), detalle.get('amount')]
    return hashlib.sha1('|'.join(str(p) for p in partes).encode('utf-8')).hexdigest()


def _aplicar_liquidaciones(data: dict, registros: list[dict]) -> dict:
    """Marca como pagados los renglones liquidados y recalcula saldos. No toca el Excel ni la copia base."""
    marcas = {}
    for reg in registros:
        for clave in reg.get('claves', []):
            marcas[clave] = reg.get('fecha', '')
    if not marcas:
        return data
    for maker in data.get('makers', []):
        for det in maker.get('details', []):
            fecha = marcas.get(_clave(det, maker['name']))
            if fecha and not det.get('paid'):
                det['paid'], det['payment'] = True, f'Liquidado {fecha}'
        pagado = sum(det['amount'] for det in maker.get('details', []) if det.get('paid'))
        maker['paid'] = round(pagado)
        maker['pending_payment'] = round(max(0, maker['amount'] - pagado))
    for det in data.get('details', []):
        fecha = marcas.get(_clave(det, det['maker']))
        if fecha and not det.get('paid'):
            det['paid'], det['payment'] = True, f'Liquidado {fecha}'
    pagado = sum(det['amount'] for det in data.get('details', []) if det.get('paid'))
    resumen = data.get('summary', {})
    resumen['paid'] = round(pagado)
    resumen['pending_payment'] = round(max(0, resumen.get('amount', 0) - pagado))
    resumen['payment_marked_rate'] = round(pagado / resumen['amount'] * 100, 1) if resumen.get('amount') else None
    return data


def get_data() -> dict:
    path = _source()
    if not path.is_file():
        raise FileNotFoundError(f'No se encontró la copia local de confección en {path.name}.')
    mtime = path.stat().st_mtime_ns
    with _lock:
        if _cache['mtime'] != mtime:
            _cache['data'] = _read_json(path)
            _cache['mtime'] = mtime
        base = _cache['data']
    return _aplicar_liquidaciones(copy.deepcopy(base), _cargar_liquidaciones())


class LiquidarIn(BaseModel):
    maker: str
    fecha: str | None = None
    desde: str | None = None   # solo renglones recibidos desde esta fecha (AAAA-MM-DD); vacío = todos


@router.post('/api/contabilidad-confeccion/liquidar')
def liquidar(body: LiquidarIn):
    """Liquida lo pendiente de una confeccionista: marca esos renglones como pagados y el contador vuelve a cero."""
    maker = body.maker.strip()
    if not maker:
        raise HTTPException(400, 'Falta la confeccionista.')
    fecha = (body.fecha or date.today().isoformat()).strip()
    try:
        datetime.strptime(fecha, '%Y-%m-%d')
    except ValueError as exc:
        raise HTTPException(400, 'La fecha debe tener formato AAAA-MM-DD.') from exc
    try:
        data = get_data()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    with _lock:
        registros = _cargar_liquidaciones()
        ya = {c for reg in registros for c in reg.get('claves', [])}
        filas = [det for det in data.get('details', [])
                 if det.get('maker') == maker and not det.get('paid') and det.get('received', 0) > 0
                 and (not body.desde or (det.get('received_date') or '') >= body.desde)
                 and _clave(det, maker) not in ya]
        if not filas:
            raise HTTPException(409, f'{maker} no tiene registros pendientes de liquidar.')
        registro = {
            'id': uuid.uuid4().hex, 'maker': maker, 'fecha': fecha,
            'registros': len(filas), 'unidades': round(sum(det.get('received', 0) for det in filas)),
            'valor': round(sum(det.get('amount', 0) for det in filas)),
            'claves': [_clave(det, maker) for det in filas],
            'creado': datetime.now().isoformat(timespec='seconds'),
        }
        registros.append(registro)
        _guardar_liquidaciones(registros)
    return {'liquidacion': {k: v for k, v in registro.items() if k != 'claves'}}


@router.get('/api/contabilidad-confeccion/liquidaciones')
def listar_liquidaciones():
    return {'liquidaciones': [{k: v for k, v in reg.items() if k != 'claves'} for reg in _cargar_liquidaciones()]}


@router.get('/api/contabilidad-confeccion')
def contabilidad_confeccion():
    try:
        return get_data()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, 'No se pudo cargar la copia local de contabilidad: ' + str(exc)[:180]) from exc
