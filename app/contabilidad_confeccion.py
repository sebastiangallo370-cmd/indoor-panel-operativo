"""Datos persistentes de Contabilidad Confección para el panel.

La API sirve una copia JSON 2026 almacenada en el VPS. El Excel se usa solo
para generar o actualizar esa copia fuera del ciclo normal de la aplicación.
"""
from __future__ import annotations

import os
import json
import sqlite3
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from threading import RLock

from fastapi import APIRouter, Body, File, HTTPException, UploadFile

router = APIRouter()
YEAR = 2026
DEFAULT_FILE = '/data/contabilidad_confeccion_2026.json'

# Las hojas de apoyo no son confeccionistas. Todas las demás hojas que tengan
# filas con fechas 2026 se incorporan automáticamente, incluidas las variantes
# .Unif/.Unifo/.conf que aparecen en el libro consolidado del usuario.
EXCLUDED_SHEETS = {'inicio', 'hoja1', 'hoja2', 'hoja3', 'maestro'}
SHEET_LABELS = {
    # Nombre de la hoja del Excel -> nombre que se muestra (el mismo del panel de confección)
    'Gloria.Unifo': 'Gloria Vallejo', 'Aida.Unifo': 'Aida Henao', 'nury.Unif': 'Nury Serna',
    'carmen jhon.Unif': 'Jhon Duque', 'Eucaris.Unif': 'Eucaris Clavijo', 'Fanny.Unif': 'Fanny Gomez',
    'sandra.Unif': 'Sandra Gutierrez', 'Blanca.Unif': 'Blanca San Pio', 'omaira.Unif': 'Omaira Villegas',
    'Blanca emilce': 'Blanca Emilce.', 'jose bordados.Unif': 'Jose Bordados', 'madelin tulas': 'Madelin',
    'juan esteban confecc': 'Juan Esteban', 'Gloria.lopez conf': 'Gloria Lopez', 'ofelia  conf': 'Ofelia Orozco',
    'patricia gaviria conf': 'Patricia Gaviria', 'omaira bergara conf': 'Omaira Bergara', 'alba confeccion': 'Alba',
    'angela vecaltex confeccion': 'Angela Vecaltex', 'noelia ciro confec': 'Noelia Ciro',
    'yenni monsalve confec': 'Yenni Momsalve', 'liliana marin conf': 'Liliana Marin',
}
# Nombre en mayúsculas (como llega del panel) -> nombre que se muestra, para no duplicar confeccionistas
_NOMBRES_CANONICOS = {valor.upper(): valor for valor in SHEET_LABELS.values()}
_cache: dict = {'mtime': None, 'data': None}
_lock = RLock()


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
    # No es de solo lectura: hace falta leer las celdas combinadas de «Fecha de pago»
    book = load_workbook(path, read_only=False, data_only=True)
    makers = []
    all_rows = []
    for sheet_name in book.sheetnames:
        if sheet_name.strip().lower() in EXCLUDED_SHEETS:
            continue
        label = _maker_label(sheet_name)
        sheet = book[sheet_name]
        # Una fecha de pago puede estar combinada en varias filas (ej. L4318:L4346): solo la primera trae el valor.
        pago_combinado = {}
        for rango in sheet.merged_cells.ranges:
            if rango.min_col <= 12 <= rango.max_col:
                top = sheet.cell(rango.min_row, rango.min_col).value
                for fila in range(rango.min_row, rango.max_row + 1):
                    pago_combinado[fila] = top
        rows = []
        for numero_fila, values in enumerate(sheet.iter_rows(min_col=2, max_col=12, values_only=True), start=1):
            values = list(values)
            if values[10] in (None, '') and numero_fila in pago_combinado:
                values[10] = pago_combinado[numero_fila]
            _client, _quote, reference, description, sent_date, received_date, sent, received, unit_value, value, payment = values
            if not (_is_2026(sent_date) or _is_2026(received_date)):
                continue
            sent, received, unit_value, value = map(_number, (sent, received, unit_value, value))
            if not any((sent, received, unit_value, value)):
                continue
            amount = value or received * unit_value
            sent_day, received_day = _day(sent_date), _day(received_date)
            duration = (received_day - sent_day).days if sent_day and received_day and received_day >= sent_day else None
            rows.append({
                'maker': label, 'client': _clean_label(_client, 'Sin cliente'), 'client_type': _client_type(_client),
                'product_category': _product_category(description), 'sent': sent, 'received': received, 'amount': amount,
                'paid': _paid(payment), 'duration': duration, 'sent_date': sent_day,
                'received_date': received_day, 'description': _clean_label(description, 'Sin descripción'),
                'reference': _clean_label(reference, ''), 'quote': _clean_label(_quote, ''),
                'unit_value': unit_value, 'payment': _payment_label(payment),
            })
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


_ANUAL_RE = re.compile(r'^\s*DATOS DE (\d{4})\s*$', re.IGNORECASE)
_ANUAL_CAMPOS = {
    'TOTAL ENVIADAS': 'enviadas',
    'TOTAL RECIBIDAS': 'recibidas',
    'VALOR TOTAL': 'valor_total',
    'VALOR PAGAR': 'valor_pagar',
    'UNIDADES CONFECCION': 'unidades_confeccion',
}


def _sin_acentos(texto) -> str:
    return unicodedata.normalize('NFD', str(texto or '')).encode('ascii', 'ignore').decode('ascii').strip().upper()


def _datos_anuales(path: Path) -> dict:
    """{nombre de la confeccionista: [{anio, enviadas, recibidas, valor_total, valor_pagar, unidades_confeccion}]}.

    Cada hoja trae un bloque «DATOS DE 2026», «DATOS DE 2025»… con encabezados y una fila de valores.
    Se lee el bloque donde esté (la fila puede variar entre hojas) y se toman solo los años con datos.
    """
    from openpyxl import load_workbook
    if not path.is_file():
        return {}
    book = load_workbook(path, read_only=True, data_only=True)
    resultado = {}
    for nombre in book.sheetnames:
        if nombre.strip().lower() in EXCLUDED_SHEETS:
            continue
        filas = [list(f) for f in book[nombre].iter_rows(min_row=1, max_row=60, values_only=True)]
        bloques = []
        for r, fila in enumerate(filas):
            for c, valor in enumerate(fila):
                encontrado = _ANUAL_RE.match(str(valor or ''))
                if not encontrado:
                    continue
                anio = int(encontrado.group(1))
                for h in range(r + 1, min(r + 4, len(filas))):
                    cabecera = [_sin_acentos(x) for x in filas[h]]
                    if 'TOTAL ENVIADAS' not in cabecera or h + 1 >= len(filas):
                        continue
                    valores = filas[h + 1]
                    bloque = {'anio': anio}
                    for texto, campo in _ANUAL_CAMPOS.items():
                        if texto in cabecera:
                            i = cabecera.index(texto)
                            v = valores[i] if i < len(valores) else None
                            bloque[campo] = round(float(v), 1) if isinstance(v, (int, float)) else None
                        else:
                            bloque[campo] = None
                    bloques.append(bloque)
                    break
        # Solo el año 2026: los bloques de años anteriores no se muestran en el panel
        bloques = [b for b in bloques if b['anio'] == 2026]
        if bloques:
            resultado[_maker_label(nombre)] = sorted({b['anio']: b for b in bloques}.values(), key=lambda b: -b['anio'])
    book.close()
    return resultado


_anual_cache = {'clave': None, 'data': {}}


def _datos_anuales_cached(json_path: Path) -> dict:
    excel = Path(os.getenv('CONFECCION_EXCEL_PATH', str(json_path.parent / 'CONFECCIONES_2026_CONFECCION.xlsx')))
    clave = (excel.stat().st_mtime_ns if excel.is_file() else 0, str(excel))
    with _lock:
        if _anual_cache['clave'] != clave:
            try:
                _anual_cache['data'] = _datos_anuales(excel)
            except Exception:
                _anual_cache['data'] = {}
            _anual_cache['clave'] = clave
        return _anual_cache['data']


@router.get('/api/contabilidad-confeccion')
def contabilidad_confeccion():
    try:
        return get_data()
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503, 'No se pudo cargar la copia local de contabilidad: ' + str(exc)[:180]) from exc


# ---- Editar y eliminar envíos registrados desde el panel (tabla confeccion_envios de jobs.sqlite3).
# No toca el Excel: solo los registros que se crearon con el botón «Registra en contabilidad».
def _jobs_db() -> sqlite3.Connection:
    con = sqlite3.connect(os.getenv('JOBS_DB_PATH', '/data/state/jobs.sqlite3'))
    con.row_factory = sqlite3.Row
    return con


@router.put('/api/confeccion/envios/{envio_id}')
def editar_envio_confeccion(envio_id: int, payload: dict = Body(...)):
    con = _jobs_db()
    try:
        fila = con.execute('SELECT * FROM confeccion_envios WHERE id=?', (envio_id,)).fetchone()
        if not fila:
            raise HTTPException(404, 'El envío ya no existe.')
        try:
            unidades = int(float(payload.get('unidades', fila['unidades'])))
            precio = float(payload.get('precio', fila['precio']))
        except (TypeError, ValueError):
            raise HTTPException(400, 'Unidades o precio no válidos.')
        if unidades < 0 or precio < 0:
            raise HTTPException(400, 'Las unidades y el precio no pueden ser negativos.')
        confeccionista = re.sub(r'\s+', ' ', str(payload.get('confeccionista', fila['confeccionista']) or '')).strip().upper()[:80]
        if not confeccionista:
            raise HTTPException(400, 'Falta la confeccionista.')
        con.execute('UPDATE confeccion_envios SET unidades=?, precio=?, confeccionista=? WHERE id=?', (unidades, precio, confeccionista, envio_id))
        con.commit()
        return {'ok': True, 'id': envio_id, 'unidades': unidades, 'precio': precio, 'confeccionista': confeccionista}
    finally:
        con.close()


@router.delete('/api/confeccion/envios/{envio_id}')
def eliminar_envio_confeccion(envio_id: int):
    con = _jobs_db()
    try:
        cur = con.execute('DELETE FROM confeccion_envios WHERE id=?', (envio_id,))
        con.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, 'El envío ya no existe.')
        return {'ok': True, 'id': envio_id}
    finally:
        con.close()


# ==== Base de datos propia de contabilidad (ya no depende del Excel) ====
# Se importa una sola vez desde el Excel; después todo se lee y se edita aquí.
CONTAB_DB = Path(os.getenv('CONTAB_DB_PATH', '/data/state/contabilidad.sqlite3'))
JOBS_DB = os.getenv('JOBS_DB_PATH', '/data/state/jobs.sqlite3')


def _cdb() -> sqlite3.Connection:
    CONTAB_DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(CONTAB_DB)
    con.row_factory = sqlite3.Row
    con.executescript('''
        CREATE TABLE IF NOT EXISTS contab_filas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maker TEXT NOT NULL, client TEXT NOT NULL DEFAULT '', client_type TEXT NOT NULL DEFAULT '',
            product_category TEXT NOT NULL DEFAULT '', sent REAL NOT NULL DEFAULT 0, received REAL NOT NULL DEFAULT 0,
            amount REAL NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, payment TEXT,
            sent_date TEXT, received_date TEXT, description TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
            quote TEXT NOT NULL DEFAULT '', unit_value REAL NOT NULL DEFAULT 0, origen TEXT NOT NULL DEFAULT 'excel',
            created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS contab_anual (
            maker TEXT NOT NULL, anio INTEGER NOT NULL, enviadas REAL, recibidas REAL, valor_total REAL,
            valor_pagar REAL, unidades_confeccion REAL, PRIMARY KEY (maker, anio)
        );
        CREATE TABLE IF NOT EXISTS contab_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ''')
    return con


def _filas_excel(path: Path) -> list:
    """Filas 2026 del Excel, solo para la importación inicial."""
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=False, data_only=True)
    filas = []
    for sheet_name in book.sheetnames:
        if sheet_name.strip().lower() in EXCLUDED_SHEETS:
            continue
        label = _maker_label(sheet_name)
        sheet = book[sheet_name]
        pago_combinado = {}
        for rango in sheet.merged_cells.ranges:
            if rango.min_col <= 12 <= rango.max_col:
                top = sheet.cell(rango.min_row, rango.min_col).value
                for fila in range(rango.min_row, rango.max_row + 1):
                    pago_combinado[fila] = top
        for numero_fila, values in enumerate(sheet.iter_rows(min_col=2, max_col=12, values_only=True), start=1):
            values = list(values)
            if values[10] in (None, '') and numero_fila in pago_combinado:
                values[10] = pago_combinado[numero_fila]
            _client, _quote, reference, description, sent_date, received_date, sent, received, unit_value, value, payment = values
            if not (_is_2026(sent_date) or _is_2026(received_date)):
                continue
            sent, received, unit_value, value = map(_number, (sent, received, unit_value, value))
            if not any((sent, received, unit_value, value)):
                continue
            amount = value or received * unit_value
            sent_day, received_day = _day(sent_date), _day(received_date)
            filas.append({
                'maker': label, 'client': _clean_label(_client, 'Sin cliente'), 'client_type': _client_type(_client),
                'product_category': _product_category(description), 'sent': sent, 'received': received, 'amount': amount,
                'paid': _paid(payment), 'payment': _payment_label(payment), 'sent_date': sent_day, 'received_date': received_day,
                'description': _clean_label(description, 'Sin descripción'), 'reference': _clean_label(reference, ''),
                'quote': _clean_label(_quote, ''), 'unit_value': unit_value,
            })
    book.close()
    return filas


def importar_excel_una_vez(path: Path) -> bool:
    """Copia las filas y los bloques 2026 del Excel a la base propia. Solo se hace una vez."""
    con = _cdb()
    try:
        if con.execute("SELECT 1 FROM contab_meta WHERE key='importado_excel'").fetchone():
            return False
        ahora = datetime.now().isoformat(timespec='seconds')
        for f in _filas_excel(path):
            con.execute('''INSERT INTO contab_filas (maker, client, client_type, product_category, sent, received, amount, paid, payment,
                sent_date, received_date, description, reference, quote, unit_value, origen, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (f['maker'], f['client'], f['client_type'], f['product_category'], f['sent'], f['received'], f['amount'],
                 1 if f['paid'] else 0, f['payment'],
                 f['sent_date'].isoformat() if f['sent_date'] else None,
                 f['received_date'].isoformat() if f['received_date'] else None,
                 f['description'], f['reference'], f['quote'], f['unit_value'], 'excel', ahora, ahora))
        for maker, bloques in _datos_anuales(path).items():
            for b in bloques:
                con.execute('INSERT OR REPLACE INTO contab_anual (maker, anio, enviadas, recibidas, valor_total, valor_pagar, unidades_confeccion) VALUES (?,?,?,?,?,?,?)',
                            (maker, b['anio'], b['enviadas'], b['recibidas'], b['valor_total'], b['valor_pagar'], b['unidades_confeccion']))
        con.execute("INSERT INTO contab_meta (key, value) VALUES ('importado_excel', ?)", (ahora,))
        con.commit()
        return True
    finally:
        con.close()


def _fecha_iso(valor) -> date | None:
    return date.fromisoformat(valor) if valor else None


def _filas_de_la_base(con: sqlite3.Connection) -> list:
    filas = []
    for r in con.execute('SELECT * FROM contab_filas').fetchall():
        filas.append({
            'id': f"c{r['id']}", 'origen': r['origen'], 'maker': r['maker'], 'client': r['client'], 'client_type': r['client_type'],
            'product_category': r['product_category'], 'sent': r['sent'], 'received': r['received'], 'amount': r['amount'],
            'paid': bool(r['paid']), 'payment': r['payment'], 'sent_date': _fecha_iso(r['sent_date']),
            'received_date': _fecha_iso(r['received_date']), 'description': r['description'] or 'Sin descripción',
            'reference': r['reference'], 'quote': r['quote'], 'unit_value': r['unit_value'],
        })
    return filas


_MESES_ES = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12}


def _fecha_produccion(valor) -> date | None:
    """Fecha de la columna CONFECCIÓN de producción: 10/11/2026, 5-nov-26 o 2026-11-10."""
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = ''.join(c for c in unicodedata.normalize('NFD', str(valor or '')) if not unicodedata.combining(c)).lower().strip()
    try:
        m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$', texto)
        if m:
            anio = int(m.group(3)); anio += 2000 if anio < 100 else 0
            return date(anio, int(m.group(2)), int(m.group(1)))
        m = re.match(r'^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ](\d{2,4})$', texto)
        if m and m.group(2) in _MESES_ES:
            anio = int(m.group(3)); anio += 2000 if anio < 100 else 0
            return date(anio, _MESES_ES[m.group(2)], int(m.group(1)))
        m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', texto)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return None


def _entregas_confeccion(con: sqlite3.Connection) -> dict:
    """{fila de producción: fecha en que terminó CONFECCIÓN}. Solo las filas con fecha."""
    meta = con.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
    if not meta:
        return {}
    cabeceras = [''.join(c for c in unicodedata.normalize('NFD', str(h or '')) if not unicodedata.combining(c)).upper().strip()
                 for h in json.loads(meta[0])]
    if 'CONFECCION' not in cabeceras:
        return {}
    idx = cabeceras.index('CONFECCION')
    entregas = {}
    for fila in con.execute('SELECT source_row, values_json FROM production_rows').fetchall():
        valores = json.loads(fila[1])
        if idx < len(valores):
            fecha = _fecha_produccion(valores[idx])
            if fecha:
                entregas[int(fila[0])] = fecha
    return entregas


def _filas_automaticas_confeccion(con: sqlite3.Connection, entregas: dict, registrados: set) -> list:
    """Órdenes cuya columna CONFECCIÓN ya tiene fecha de finalizado y que aún no están en la contabilidad.
    Con preparación (confeccionista y precio): valor = unidades × precio. Sin preparación: se muestran en
    «SIN CONFECCIONISTA ASIGNADA» con valor 0 hasta que se asigne. No duplica las órdenes que ya están en el Excel."""
    try:
        preparaciones = {int(r['source_row'] or 0): r for r in con.execute(
            'SELECT source_row, orden, referencia, confeccionista, precio_centavos FROM confeccion_preparaciones').fetchall()}
        meta = con.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
    except sqlite3.Error:
        return []
    if not meta:
        return []
    existentes = set()
    if CONTAB_DB.exists():
        try:
            cdb = sqlite3.connect(CONTAB_DB)
            existentes = {(str(q or '').strip().upper(), str(r or '').strip().upper())
                          for q, r in cdb.execute("SELECT quote, reference FROM contab_filas WHERE origen='excel'").fetchall()}
            cdb.close()
        except sqlite3.Error:
            existentes = set()
    cabeceras = [''.join(c for c in unicodedata.normalize('NFD', str(h or '')) if not unicodedata.combining(c)).upper().replace('\n', ' ').strip()
                 for h in json.loads(meta[0])]
    def indice(*nombres):
        for nombre in nombres:
            if nombre in cabeceras:
                return cabeceras.index(nombre)
        return -1
    i_cant = indice('CANTIDAD')
    i_cli = indice('NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO')
    i_ini = indice('FECHA DE INICIO')
    i_orden = indice('ORDEN')
    i_ref = indice('REFERENCIA')
    desde = date(2026, 11, 1)
    filas = []
    for fila, fecha in entregas.items():
        if fila in registrados or fecha < desde:
            continue
        rec = con.execute('SELECT values_json FROM production_rows WHERE source_row=?', (fila,)).fetchone()
        if not rec:
            continue
        valores = json.loads(rec[0])
        def valor(i):
            return str(valores[i] or '').strip() if 0 <= i < len(valores) else ''
        prep = preparaciones.get(fila)
        orden = (prep['orden'] if prep else valor(i_orden)) or ''
        referencia = (prep['referencia'] if prep else valor(i_ref)) or ''
        if (orden.strip().upper(), referencia.strip().upper()) in existentes:
            continue
        try:
            unidades = float(valor(i_cant).replace(',', '.') or 0)
        except ValueError:
            unidades = 0.0
        if unidades <= 0:
            continue
        cliente = valor(i_cli)
        inicio = _fecha_produccion(valor(i_ini)) if i_ini >= 0 else None
        if prep:
            maker = _NOMBRES_CANONICOS.get(str(prep['confeccionista'] or '').strip().upper(), prep['confeccionista'])
            precio = (prep['precio_centavos'] or 0) / 100
        else:
            maker = 'SIN CONFECCIONISTA ASIGNADA'
            precio = 0.0
        filas.append({
            'id': f'a{fila}', 'origen': 'panel', 'maker': maker,
            'client': cliente, 'client_type': _client_type(cliente), 'product_category': '',
            'sent': unidades, 'received': unidades, 'amount': unidades * precio,
            'paid': False, 'payment': None, 'sent_date': inicio or fecha, 'received_date': fecha,
            'description': '', 'reference': referencia, 'quote': orden, 'unit_value': precio,
        })
    return filas


def _filas_de_envios_panel() -> list:
    """Envíos registrados desde el panel. Sin fecha de terminado en producción = por recibir (sin monto).
    Cuando CONFECCIÓN termina en producción, la fila se marca recibida con esa fecha y entra a la liquidación."""
    if not os.path.exists(JOBS_DB):
        return []
    con = sqlite3.connect(JOBS_DB)
    con.row_factory = sqlite3.Row
    try:
        entregas = _entregas_confeccion(con)
        filas = []
        for r in con.execute('SELECT * FROM confeccion_envios').fetchall():
            detectado = str(r['detectado_at'] or '')[:10]
            unidades = float(r['unidades'] or 0)
            precio = float(r['precio'] or 0)
            fecha_entrega = entregas.get(int(r['source_row'] or 0))
            recibidas = unidades if fecha_entrega else 0.0
            filas.append({
                'id': f"p{r['id']}", 'origen': 'panel',
                'maker': _NOMBRES_CANONICOS.get(str(r['confeccionista'] or '').strip().upper(), r['confeccionista']),
                'client': r['cliente'], 'client_type': _client_type(r['cliente']), 'product_category': '',
                'sent': unidades, 'received': recibidas, 'amount': recibidas * precio,
                'paid': False, 'payment': None,
                'sent_date': _fecha_iso(detectado) if len(detectado) == 10 else None,
                'received_date': fecha_entrega, 'description': '',
                'reference': r['referencia'], 'quote': r['orden'], 'unit_value': precio,
                'registrado_at': str(r['detectado_at'] or ''),
            })
        registrados = {int(r['source_row'] or 0) for r in con.execute('SELECT source_row FROM confeccion_envios').fetchall()}
        filas.extend(_filas_automaticas_confeccion(con, entregas, registrados))
        return filas
    except sqlite3.Error:
        return []
    finally:
        con.close()


def _anual_de_la_base(con: sqlite3.Connection) -> dict:
    anual = defaultdict(list)
    for r in con.execute('SELECT * FROM contab_anual WHERE anio = ?', (YEAR,)).fetchall():
        anual[r['maker']].append({'anio': r['anio'], 'enviadas': r['enviadas'], 'recibidas': r['recibidas'],
                                  'valor_total': r['valor_total'], 'valor_pagar': r['valor_pagar'],
                                  'unidades_confeccion': r['unidades_confeccion']})
    return anual


def _construir(rows: list, anual: dict, actualizado: str | None) -> dict:
    """Arma la misma estructura que el panel espera, a partir de las filas guardadas."""
    if not rows:
        raise ValueError('No hay registros de contabilidad 2026 todavía.')
    for row in rows:
        row['duration'] = (row['received_date'] - row['sent_date']).days if row['received_date'] and row['sent_date'] and row['received_date'] >= row['sent_date'] else None
    por_maker = defaultdict(list)
    for row in rows:
        por_maker[row['maker']].append(row)
    makers = []
    for name, mrows in por_maker.items():
        sent = sum(r['sent'] for r in mrows)
        received = sum(r['received'] for r in mrows)
        amount = sum(r['amount'] for r in mrows)
        paid = sum(r['amount'] for r in mrows if r['paid'])
        makers.append({
            'name': name, 'orders': len(mrows), 'sent': round(sent), 'received': round(received),
            'pending_units': round(max(0, sent - received)), 'amount': round(amount),
            'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(mrows),
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'average_value_per_unit': round(amount / received) if received else None,
            'anual': anual.get(name, []),
            'details': [_detalle(r) for r in sorted(mrows, key=lambda r: (r['received_date'] or r['sent_date'] or date.min), reverse=True)],
        })
    sent = sum(r['sent'] for r in rows)
    received = sum(r['received'] for r in rows)
    amount = sum(r['amount'] for r in rows)
    paid = sum(r['amount'] for r in rows if r['paid'])
    monthly = defaultdict(lambda: {'sent': 0.0, 'received': 0.0, 'amount': 0.0})
    products = defaultdict(lambda: {'units': 0.0, 'amount': 0.0})
    pending = []
    for row in rows:
        if row['sent_date'] and row['sent_date'].year == YEAR:
            monthly[row['sent_date'].month]['sent'] += row['sent']
            monthly[row['sent_date'].month]['amount'] += row['amount']
        if row['received_date'] and row['received_date'].year == YEAR:
            monthly[row['received_date'].month]['received'] += row['received']
        products[row['description']]['units'] += row['received']
        products[row['description']]['amount'] += row['amount']
        if row['sent'] > row['received']:
            age_days = max(0, (date.today() - row['sent_date']).days) if row['sent_date'] else None
            pending.append({'maker': row['maker'], 'units': round(row['sent'] - row['received']),
                            'sent_date': row['sent_date'].isoformat() if row['sent_date'] else None,
                            'age_days': age_days, 'product': row['description'], 'reference': row['reference']})
    return {
        'year': YEAR, 'source_updated_at': actualizado,
        'summary': {
            'orders': len(rows), 'sent': round(sent), 'received': round(received), 'pending_units': round(max(0, sent - received)),
            'amount': round(amount), 'paid': round(paid), 'pending_payment': round(max(0, amount - paid)),
            'average_days': _weighted_days(rows), 'average_order_units': round(sent / len(rows), 1),
            'average_value_per_unit': round(amount / received) if received else None,
            'completion_rate': round(received / sent * 100, 1) if sent else None,
            'payment_marked_rate': round(paid / amount * 100, 1) if amount else None,
        },
        'makers': sorted(makers, key=lambda item: item['amount'], reverse=True),
        'details': [dict(_detalle(r), maker=r['maker']) for r in rows],
        'monthly': [{'month': m, **{k: round(v) for k, v in monthly[m].items()}} for m in range(1, 13)],
        'products': sorted([{'name': n, 'units': round(v['units']), 'amount': round(v['amount'])}
                            for n, v in products.items() if v['units'] or v['amount']],
                           key=lambda item: item['units'], reverse=True)[:8],
        'pending': sorted(pending, key=lambda item: (item['age_days'] or 0, item['units']), reverse=True),
    }


def _detalle(r: dict) -> dict:
    return {
        'id': r['id'], 'origen': r['origen'], 'sent_date': r['sent_date'].isoformat() if r['sent_date'] else None,
        'received_date': r['received_date'].isoformat() if r['received_date'] else None,
        'sent': round(r['sent']), 'received': round(r['received']), 'amount': round(r['amount']),
        'paid': r['paid'], 'payment': r['payment'], 'product': r['description'], 'reference': r['reference'],
        'quote': r['quote'], 'unit_value': round(r['unit_value']), 'client': r['client'],
        'client_type': r['client_type'], 'product_category': r['product_category'],
        'entrega_cliente': r['entrega_cliente'].isoformat() if r.get('entrega_cliente') else None,
        'registrado_at': r.get('registrado_at') or None,
    }


def _aplicar_entregas_a_excel(filas: list) -> None:
    """Las filas del Excel que aún no tienen recibidas toman la fecha en que la tarjeta de producción
    terminó CONFECCIÓN (y el valor = unidades × valor unidad). Se busca por cotización y referencia."""
    if not os.path.exists(JOBS_DB):
        return
    try:
        con = sqlite3.connect(JOBS_DB)
        con.row_factory = sqlite3.Row
    except sqlite3.Error:
        return
    try:
        entregas = _entregas_confeccion(con)
        meta = con.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not entregas or not meta:
            return
        cabeceras = [''.join(c for c in unicodedata.normalize('NFD', str(h or '')) if not unicodedata.combining(c)).upper().replace('\n', ' ').strip()
                     for h in json.loads(meta[0])]
        if 'ORDEN' not in cabeceras or 'REFERENCIA' not in cabeceras:
            return
        i_orden, i_ref = cabeceras.index('ORDEN'), cabeceras.index('REFERENCIA')
        fechas = {}
        for fila, fecha in entregas.items():
            rec = con.execute('SELECT values_json FROM production_rows WHERE source_row=?', (fila,)).fetchone()
            if not rec:
                continue
            valores = json.loads(rec[0])
            if max(i_orden, i_ref) >= len(valores):
                continue
            clave = (str(valores[i_orden] or '').strip().upper(), str(valores[i_ref] or '').strip().upper())
            if clave[0] and clave[1]:
                fechas[clave] = max(fecha, fechas.get(clave, fecha))
    except sqlite3.Error:
        return
    finally:
        con.close()
    for fila in filas:
        if fila.get('origen') != 'excel' or fila.get('received') or fila.get('received_date'):
            continue
        clave = (str(fila.get('quote') or '').strip().upper(), str(fila.get('reference') or '').strip().upper())
        fecha = fechas.get(clave)
        if not fecha or not fila.get('sent'):
            continue
        fila['received'] = fila['sent']
        fila['received_date'] = fecha
        fila['amount'] = fila['sent'] * (fila.get('unit_value') or 0)


def _aplicar_entrega_cliente(filas: list) -> None:
    """Pone a cada fila la FECHA DE ENTREGA al cliente final que aparece en la hoja de producción
    (se busca por cotización y referencia)."""
    if not os.path.exists(JOBS_DB):
        return
    try:
        con = sqlite3.connect(JOBS_DB)
        con.row_factory = sqlite3.Row
    except sqlite3.Error:
        return
    try:
        meta = con.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not meta:
            return
        cabeceras = [''.join(c for c in unicodedata.normalize('NFD', str(h or '')) if not unicodedata.combining(c)).upper().replace('\n', ' ').strip()
                     for h in json.loads(meta[0])]
        if not all(n in cabeceras for n in ('ORDEN', 'REFERENCIA', 'FECHA DE ENTREGA')):
            return
        i_orden, i_ref, i_ent = cabeceras.index('ORDEN'), cabeceras.index('REFERENCIA'), cabeceras.index('FECHA DE ENTREGA')
        mapa = {}
        for rec in con.execute('SELECT values_json FROM production_rows').fetchall():
            valores = json.loads(rec[0])
            if max(i_orden, i_ref, i_ent) >= len(valores):
                continue
            fecha = _fecha_produccion(valores[i_ent])
            clave = (str(valores[i_orden] or '').strip().upper(), str(valores[i_ref] or '').strip().upper())
            if fecha and clave[0] and clave[1]:
                mapa[clave] = fecha
    except sqlite3.Error:
        return
    finally:
        con.close()
    for fila in filas:
        clave = (str(fila.get('quote') or '').strip().upper(), str(fila.get('reference') or '').strip().upper())
        fila['entrega_cliente'] = mapa.get(clave)


def _aplicar_descripcion_fichas(filas: list) -> None:
    """La descripción del producto viene de la ficha técnica de la referencia (CA00 → CAMISETA DEPORTIVA).
    Si la referencia no tiene ficha, se deja la descripción del Excel."""
    try:
        from app import fichas as _fichas
        indice = _fichas.indice().get('fichas') or []
    except Exception:
        return
    prendas = {}
    for f in indice:
        ref = str(f.get('ref') or '').strip().upper()
        prenda = str(f.get('prenda') or '').strip()
        if ref and prenda and ref not in prendas:
            prendas[ref] = prenda
    if not prendas:
        return
    for fila in filas:
        codigos = re.findall(r'[A-Za-z]{1,5}\d{2,3}', str(fila.get('reference') or ''))
        if not codigos:
            continue
        prenda = prendas.get(codigos[-1].upper())
        if prenda:
            fila['description'] = prenda


def get_data() -> dict:
    """Todo sale de la base propia. El Excel solo sirve para la importación inicial."""
    excel = Path(os.getenv('CONFECCION_EXCEL_PATH', str(_source().parent / 'CONFECCIONES_2026_CONFECCION.xlsx')))
    with _lock:
        if excel.is_file():
            importar_excel_una_vez(excel)
        con = _cdb()
        try:
            filas = _filas_de_la_base(con)
            anual = _anual_de_la_base(con)
        finally:
            con.close()
    filas += _filas_de_envios_panel()
    _aplicar_entregas_a_excel(filas)
    _aplicar_entrega_cliente(filas)
    _aplicar_descripcion_fichas(filas)
    datos = _construir(filas, anual, datetime.now().isoformat(timespec='seconds'))
    return datos


@router.put('/api/contabilidad-confeccion/filas/{fila_id}')
def editar_fila_contabilidad(fila_id: int, payload: dict = Body(...)):
    con = _cdb()
    try:
        r = con.execute('SELECT * FROM contab_filas WHERE id=?', (fila_id,)).fetchone()
        if not r:
            raise HTTPException(404, 'La fila ya no existe.')
        try:
            sent = float(payload.get('sent', r['sent']))
            received = float(payload.get('received', r['received']))
            unit_value = float(payload.get('unit_value', r['unit_value']))
        except (TypeError, ValueError):
            raise HTTPException(400, 'Unidades o valor no válidos.')
        if min(sent, received, unit_value) < 0:
            raise HTTPException(400, 'Las unidades y el valor no pueden ser negativos.')
        if received > sent:
            raise HTTPException(400, 'No puede haber más unidades recibidas que enviadas.')
        paid = bool(payload.get('paid', bool(r['paid'])))
        payment = str(payload.get('payment', r['payment']) or '').strip() or None
        received_date = payload.get('received_date', r['received_date'])
        if received <= 0:
            received_date = None
        amount = received * unit_value if (received != r['received'] or unit_value != r['unit_value']) else r['amount']
        con.execute('''UPDATE contab_filas SET sent=?, received=?, unit_value=?, amount=?, paid=?, payment=?, received_date=?, updated_at=?
                       WHERE id=?''', (sent, received, unit_value, amount, 1 if paid else 0, payment, received_date,
                                       datetime.now().isoformat(timespec='seconds'), fila_id))
        con.commit()
        return {'ok': True, 'id': fila_id}
    finally:
        con.close()


@router.delete('/api/contabilidad-confeccion/filas/{fila_id}')
def eliminar_fila_contabilidad(fila_id: int):
    con = _cdb()
    try:
        cur = con.execute('DELETE FROM contab_filas WHERE id=?', (fila_id,))
        con.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, 'La fila ya no existe.')
        return {'ok': True, 'id': fila_id}
    finally:
        con.close()


# ---- Cargar un Excel actualizado: reemplaza las filas que vienen del Excel. Guarda copia de respaldo antes. ----
@router.post('/api/contabilidad-confeccion/reimportar')
async def reimportar_desde_excel(archivo: UploadFile = File(...)):
    import shutil
    contenido = await archivo.read()
    if len(contenido) < 1000 or len(contenido) > 40 * 1024 * 1024 or contenido[:2] != b'PK':
        raise HTTPException(400, 'El archivo no parece un Excel (.xlsx) válido.')
    excel_destino = Path(os.getenv('CONFECCION_EXCEL_PATH', str(_source().parent / 'CONFECCIONES_2026_CONFECCION.xlsx')))
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    temporal = excel_destino.with_name(f'.nuevo-{ts}.xlsx')
    temporal.parent.mkdir(parents=True, exist_ok=True)
    temporal.write_bytes(contenido)
    try:
        filas = _filas_excel(temporal)
        anual = _datos_anuales(temporal)
    except Exception as exc:
        temporal.unlink(missing_ok=True)
        raise HTTPException(400, 'No se pudo leer el Excel: ' + str(exc)[:160])
    if not filas:
        temporal.unlink(missing_ok=True)
        raise HTTPException(400, 'El Excel no tiene registros 2026 de las hojas de confección.')
    with _lock:
        # Respaldo de la base y del Excel anterior
        con = _cdb()
        con.close()
        shutil.copy2(CONTAB_DB, CONTAB_DB.with_name(f'contabilidad.antes-{ts}.sqlite3'))
        if excel_destino.is_file():
            shutil.copy2(excel_destino, excel_destino.with_name(f'{excel_destino.stem}.antes-{ts}.xlsx'))
        excel_destino.write_bytes(contenido)
        temporal.unlink(missing_ok=True)
        con = _cdb()
        try:
            con.execute("DELETE FROM contab_filas WHERE origen='excel'")
            con.execute('DELETE FROM contab_anual')
            ahora = datetime.now().isoformat(timespec='seconds')
            for f in filas:
                con.execute('''INSERT INTO contab_filas (maker, client, client_type, product_category, sent, received, amount, paid, payment,
                    sent_date, received_date, description, reference, quote, unit_value, origen, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (f['maker'], f['client'], f['client_type'], f['product_category'], f['sent'], f['received'], f['amount'],
                     1 if f['paid'] else 0, f['payment'],
                     f['sent_date'].isoformat() if f['sent_date'] else None,
                     f['received_date'].isoformat() if f['received_date'] else None,
                     f['description'], f['reference'], f['quote'], f['unit_value'], 'excel', ahora, ahora))
            for maker, bloques in anual.items():
                for b in bloques:
                    con.execute('INSERT OR REPLACE INTO contab_anual (maker, anio, enviadas, recibidas, valor_total, valor_pagar, unidades_confeccion) VALUES (?,?,?,?,?,?,?)',
                                (maker, b['anio'], b['enviadas'], b['recibidas'], b['valor_total'], b['valor_pagar'], b['unidades_confeccion']))
            con.execute("INSERT OR REPLACE INTO contab_meta (key, value) VALUES ('reimportado_excel', ?)", (ahora,))
            con.commit()
        finally:
            con.close()
    return {'ok': True, 'filas': len(filas), 'confeccionistas': len({f['maker'] for f in filas})}
