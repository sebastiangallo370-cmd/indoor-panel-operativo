"""Lectura consolidada del inventario de Indoor desde Google Sheets."""

from __future__ import annotations

import hashlib
import os
import json
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any

import gspread
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from google.oauth2.service_account import Credentials

from app import ingreso_documento, sublimacion_stock


inventario_router = APIRouter(prefix="/api/inventarios", tags=["inventarios"])

SOURCE_TABS = (
    ("STOCK PARA MERCAR", "Stock para mercar"),
    ("INSUMOS", "Insumos"),
    ("MATERIA PRIMA IMPRESION", "Materia prima impresión"),
    ("BODEGA TELA", "Bodega tela"),
    ("RETAL CANASTAS", "Retal canastas"),
    ("DOCUMENTACION PROCESO", "Documentación proceso"),
)
CACHE_SECONDS = 90
_cache: dict[str, Any] = {"at": 0.0, "data": None}
_lock = threading.Lock()
_movement_file = os.getenv('INVENTORY_MOVEMENTS_FILE', '/data/inventory_movements.json')
_snapshot_file = os.getenv('INVENTORY_SNAPSHOT_FILE', '/data/inventory_snapshot.json')


def _load_snapshot() -> dict[str, Any] | None:
    try:
        with open(_snapshot_file, encoding='utf-8') as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) and data.get('items') is not None else None
    except (OSError, ValueError):
        return None


def _save_snapshot(data: dict[str, Any]) -> None:
    folder = os.path.dirname(_snapshot_file)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(_snapshot_file, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False)


def _local_inventory() -> dict[str, Any]:
    """Catálogo inmediato para que Inventarios nunca dependa de Sheets para abrir."""
    try:
        with open(os.path.join(os.path.dirname(__file__), "fabrics.json"), encoding="utf-8") as handle:
            fabrics = json.load(handle)
    except (OSError, ValueError):
        fabrics = []
    items = [{
        "id": f"BODEGA TELA:LOCAL:{index}",
        "categoria": "BODEGA TELA",
        "categoria_label": "Bodega tela",
        "nombre": f"({fabric.get('code', '')}) {fabric.get('name', '')}".strip(),
        "total": 0.0,
        "total_label": "0",
        "mts": 0.0,
        "rolls": 0,
        "campos": {},
    } for index, fabric in enumerate(fabrics, start=1) if fabric.get("name")]
    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "categories": [{"key": "BODEGA TELA", "label": "Bodega tela", "items": len(items), "units": 0, "units_label": "0", "available": True}],
        "items": items,
        "summary": {"items": len(items), "units": 0, "units_label": "0", "sources": 1},
    }


class InventoryMovement(BaseModel):
    type: str = Field(pattern='^(INGRESO|SALIDA)$')
    name: str
    code: str = ''
    mts: float = Field(gt=0)
    rolls: int = Field(default=1, ge=1)
    source: str = ''


def _load_movements() -> list[dict[str, Any]]:
    try:
        with open(_movement_file, encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return []


def _save_movements(movements: list[dict[str, Any]]) -> None:
    folder = os.path.dirname(_movement_file)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(_movement_file, 'w', encoding='utf-8') as handle:
        json.dump(movements, handle, ensure_ascii=False)


def _normalized(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", text.upper()).strip()


def _number(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    text = text.replace(".", "").replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else 0.0


def _display_total(value: float) -> str:
    return str(int(value)) if value.is_integer() else f"{value:,.2f}".replace(",", " ")


def _header_positions(row: list[str]) -> tuple[int | None, int | None]:
    headers = [_normalized(value) for value in row]
    name_index = next(
        (index for index, value in enumerate(headers)
         if value in {"REFERENCIA", "NOMBRE", "NOMBRE TELA", "NOMBRE INSUMO"}
         or value.startswith("NOMBRE ")),
        None,
    )
    total_index = next((index for index, value in enumerate(headers) if value == "TOTAL" or value.startswith("TOTAL ")), None)
    return name_index, total_index


def _is_header(row: list[str]) -> bool:
    name_index, total_index = _header_positions(row)
    return name_index is not None and total_index is not None


def _records_for_tab(values: list[list[str]], tab_key: str, tab_label: str, grid_rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    if tab_key == "DOCUMENTACION PROCESO":
        records = []
        for row_index, row in enumerate(values, start=1):
            name = str(row[1] if len(row) > 1 else "").strip()
            location = str(row[2] if len(row) > 2 else "").strip()
            registration = str(row[3] if len(row) > 3 else "").strip()
            if not name or _normalized(name) in {"MATERIA PRIMA O PRODUCTO", "UBICACIONES"}:
                continue
            display_name = f"{name} · {location}" if location else name
            records.append({
                "id": f"{tab_key}:{row_index}",
                "categoria": tab_key,
                "categoria_label": tab_label,
                "nombre": display_name,
                "total": 0.0,
                "total_label": registration or "Sin registro",
                "detalle": registration or location or "Sin registro",
                "campos": {
                    "Materia prima o producto": name,
                    "Ubicación": location or "—",
                    "Registro": registration or "—",
                },
            })
        return records
    def roll_status(row_index: int, index: int) -> str:
        cell_format = ((grid_rows[row_index - 1].get('values', [])[index]
                        if grid_rows and row_index - 1 < len(grid_rows)
                        and index < len(grid_rows[row_index - 1].get('values', [])) else {})
                      .get('effectiveFormat', {}) if grid_rows else {})
        fmt = cell_format.get('backgroundColor', {}) or cell_format.get('backgroundColorStyle', {}).get('rgbColor', {})
        default = 0 if fmt else 1
        red, green, blue = float(fmt.get('red', default)), float(fmt.get('green', default)), float(fmt.get('blue', default))
        if (red > .9 and .5 < green < .7 and blue < .2) or (red > .9 and .65 < green < .88 and blue < .8):
            return 'started'
        return 'new'

    last_record: dict[str, Any] | None = None
    records: list[dict[str, Any]] = []
    active_name: int | None = None
    active_total: int | None = None
    active_headers: list[str] = []
    seen: set[tuple[str, str, float]] = set()
    for row_index, row in enumerate(values, start=1):
        if _is_header(row):
            active_name, active_total = _header_positions(row)
            active_headers = [str(value or "").strip() or f"Campo {index + 1}" for index, value in enumerate(row)]
            last_record = None
            continue
        if active_name is None or active_total is None:
            continue
        name = str(row[active_name] if active_name < len(row) else "").strip()
        total = _number(row[active_total] if active_total < len(row) else "")
        normalized_name = _normalized(name)
        if not name and last_record is not None:
            extra = [(index, _number(value)) for index, value in enumerate(row)
                     if active_name < index < active_total and str(value or '').strip() and _number(value) > 0]
            if extra or total > 0:
                for index, value in extra:
                    last_record['roll_values'].append(value)
                    last_record['roll_statuses'].append(roll_status(row_index, index))
                last_record['total'] += total
                last_record['mts'] = last_record.get('mts', 0) + total
                last_record['total_label'] = _display_total(last_record['total'])
                if last_record.get('rolls'):
                    last_record['rolls'] += len(extra)
            continue
        if not name or normalized_name in {"TOTAL", "SUBTOTAL", "NOMBRE", "REFERENCIA"}:
            last_record = None
            continue
        if total == 0 and not any(str(cell or "").strip() for cell in row[active_name + 1:active_total + 1]):
            last_record = None
            continue
        identity = (tab_key, normalized_name, total)
        if identity in seen:
            continue
        seen.add(identity)
        fields = {
            active_headers[index] if index < len(active_headers) else f"Campo {index + 1}": str(value).strip()
            for index, value in enumerate(row)
            if str(value or "").strip()
        }
        meters = next((value for key, value in fields.items() if 'MTS' in _normalized(key) or 'METROS' in _normalized(key)), '')
        rolls = next((value for key, value in fields.items() if 'ROLLO' in _normalized(key)), '')
        roll_values = []
        roll_statuses = []
        for index, value in enumerate(row):
            if index in {active_name, active_total} or not str(value or '').strip() or _number(value) <= 0:
                continue
            roll_values.append(_number(value))
            roll_statuses.append(roll_status(row_index, index))
        supplier = active_headers[active_name + 1] if active_name + 1 < len(active_headers) else ''
        records.append({
            "id": f"{tab_key}:{row_index}:{len(records)}",
            "categoria": tab_key,
            "categoria_label": tab_label,
            "proveedor": '' if supplier.startswith('Campo ') or 'TOTAL' in _normalized(supplier) else supplier,
            "nombre": name,
            "total": total,
            "total_label": _display_total(total),
            "mts": _number(meters) if meters else total,
            "rolls": int(_number(rolls)) if rolls else 0,
            "roll_values": roll_values,
            "roll_statuses": roll_statuses,
            "campos": fields,
        })
        last_record = records[-1]
    return records


def _open_inventory_sheet():
    url = os.getenv("INVENTARIOS_GOOGLE_SHEETS_URL", "https://docs.google.com/spreadsheets/d/1MKEfOXLmKObM8zXmtZ_1W_xjbTK6k2HLd6XjwdFphWQ/edit").strip()
    credentials_path = os.getenv("GOOGLE_CREDENTIALS", "/run/secrets/google-service-account.json")
    if not url or "REEMPLAZAR" in url:
        raise RuntimeError("Falta configurar INVENTARIOS_GOOGLE_SHEETS_URL en el servidor.")
    credentials = Credentials.from_service_account_file(
        credentials_path,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    return gspread.authorize(credentials).open_by_url(url)


def _read_inventory() -> dict[str, Any]:
    workbook = _open_inventory_sheet()
    categories: list[dict[str, Any]] = []
    all_records: list[dict[str, Any]] = []
    for tab_key, tab_label in SOURCE_TABS:
        try:
            worksheet = workbook.worksheet(tab_key)
        except gspread.WorksheetNotFound:
            categories.append({"key": tab_key, "label": tab_label, "items": 0, "units": 0, "available": False})
            continue
        values = worksheet.get_all_values()
        grid_rows = None
        if tab_key == 'BODEGA TELA':
            try:
                metadata = workbook.fetch_sheet_metadata(params={'includeGridData': True, 'ranges': [f"'{tab_key}'!A1:Z{len(values)}"]})
                grid_rows = next((sheet.get('data', [{}])[0].get('rowData', []) for sheet in metadata.get('sheets', []) if sheet.get('properties', {}).get('title') == tab_key), None)
            except Exception:
                grid_rows = None
        records = _records_for_tab(values, tab_key, tab_label, grid_rows)
        units = sum(record["total"] for record in records)
        categories.append({"key": tab_key, "label": tab_label, "items": len(records), "units": units, "units_label": _display_total(units), "available": True})
        all_records.extend(records)
    existing = {record['nombre'] for record in all_records if record['categoria'] == 'BODEGA TELA'}
    added = 0
    for fabric in _load_new_fabrics():
        nombre = f"({fabric['codigo']}) {fabric['nombre']}"
        if nombre in existing:
            continue
        all_records.append({
            "id": f"BODEGA TELA:NUEVA:{fabric['codigo']}", "categoria": "BODEGA TELA", "categoria_label": "Bodega tela",
            "nombre": nombre, "total": 0.0, "total_label": "0", "mts": 0.0, "rolls": 0,
            "roll_values": [], "roll_statuses": [], "campos": {},
        })
        added += 1
    if added:
        for category in categories:
            if category['key'] == 'BODEGA TELA':
                category['items'] += added
    for movement in _load_movements():
        target = next((record for record in all_records if record['nombre'] == movement.get('name') or (movement.get('code') and f"({movement.get('code')})" in record['nombre'])), None)
        if not target:
            continue
        sign = 1 if movement.get('type') == 'INGRESO' else -1
        delta = sign * float(movement.get('mts') or 0)
        target['total'] = max(0, target['total'] + delta)
        target['mts'] = max(0, float(target.get('mts') or 0) + delta)
        target['total_label'] = _display_total(target['total'])
        if sign > 0:
            count = max(1, int(movement.get('rolls') or 1))
            values = target.setdefault('roll_values', [])
            statuses = target.setdefault('roll_statuses', ['new'] * len(values))
            for _ in range(count):
                values.append(round(float(movement.get('mts') or 0) / count, 2))
                statuses.append('new')
            target['rolls'] = len(values)
            fields = target.setdefault('campos', {})
            base = 'Movimiento ingreso'
            index = 1
            while f'{base} {index}' in fields:
                index += 1
            for roll in range(int(movement.get('rolls') or 1)):
                fields[f'{base} {index + roll}'] = str(movement.get('mts') or 0)
        else:
            fields = target.setdefault('campos', {})
            roll_keys = [key for key, value in fields.items() if not re.search(r'total', key, re.I) and _number(value) or False]
            for key in roll_keys[-int(movement.get('rolls') or 1):]:
                fields.pop(key, None)
    all_records.sort(key=lambda record: (record["categoria_label"], record["nombre"].casefold()))
    total_units = sum(record["total"] for record in all_records)
    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "categories": categories,
        "items": all_records,
        "summary": {"items": len(all_records), "units": total_units, "units_label": _display_total(total_units), "sources": len([category for category in categories if category["available"]])},
    }


def _with_sublimacion(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        items, plan = sublimacion_stock.reconcile(payload.get('items') or [])
    except Exception:
        return payload
    return {**payload, "items": items, "sublimacion": plan}


@inventario_router.get("")
def inventory_snapshot(refresh: bool = False):
    return _with_sublimacion(_inventory_payload(refresh))


LOW_STOCK_MTS = 100


def _supplier(item: dict[str, Any]) -> str:
    if item.get('proveedor'):
        return item['proveedor']
    fields = item.get('campos') or {}
    keys = list(fields.keys())
    names = [key for key in keys if fields[key] == item.get('nombre')]
    start = keys.index(names[0]) + 1 if names else 1
    for key in keys[start:]:
        normalized = _normalized(key)
        if not key.startswith('Campo ') and 'TOTAL' not in normalized and 'MOVIMIENTO' not in normalized:
            return key
    return 'Sin proveedor'


@inventario_router.get("/dashboard")
def inventory_dashboard():
    """Estadísticas de Bodega tela para el dashboard."""
    payload = _with_sublimacion(_inventory_payload())
    items = [item for item in payload.get('items') or [] if item.get('categoria') == 'BODEGA TELA']
    rolls_new = rolls_started = 0
    mts_new = mts_started = 0.0
    suppliers: dict[str, dict[str, Any]] = {}
    for item in items:
        values = item.get('roll_values') or []
        statuses = item.get('roll_statuses') or []
        for index, value in enumerate(values):
            if index < len(statuses) and statuses[index] == 'started':
                rolls_started += 1
                mts_started += float(value)
            else:
                rolls_new += 1
                mts_new += float(value)
        entry = suppliers.setdefault(_supplier(item), {'nombre': _supplier(item), 'mts': 0.0, 'telas': 0})
        entry['mts'] += float(item.get('total') or 0)
        entry['telas'] += 1
    stock = [item for item in items if float(item.get('total') or 0) > 0]
    simple = lambda item: {'nombre': item['nombre'], 'mts': round(float(item.get('total') or 0), 2), 'rollos': len(item.get('roll_values') or []),
                           'valores': item.get('roll_values') or [], 'estados': item.get('roll_statuses') or []}
    plans = payload.get('sublimacion') or []
    try:
        ready = sublimacion_stock.forecast(payload.get('items') or [])
    except Exception:
        ready = []
    plan_card = lambda plan: {'label': plan.get('label', ''), 'mts': plan.get('mts', 0), 'short': plan.get('short', False),
                              'missing': plan.get('missing', 0), 'rollos': len(plan.get('rolls') or []),
                              'encontrada': bool(plan.get('owners')), 'tela': plan.get('tela', ''), 'fecha': plan.get('fecha', ''),
                              'valores': [roll.get('value') for roll in plan.get('rolls') or []],
                              'estados': ['started' if roll.get('started') else 'new' for roll in plan.get('rolls') or []],
                              'disponible': plan.get('disponible'),
                              'telas': plan.get('telas') or sorted({roll.get('item', '') for roll in plan.get('rolls') or []})}
    ledger = sublimacion_stock._load_ledger()
    consumptions = []
    for done in ledger.get('done', {}).values():
        consumptions.append({'orden': done.get('orden', ''), 'fecha': done.get('ts', ''),
                             'mts': round(sum(float(roll.get('take') or 0) for roll in done.get('rolls', [])), 2),
                             'telas': sorted({roll.get('item', '') for roll in done.get('rolls', [])})})
    consumptions.sort(key=lambda entry: entry['fecha'], reverse=True)
    month_ago = datetime.now(timezone.utc).timestamp() - 30 * 86400
    recent = [entry for entry in consumptions if entry['fecha'] and datetime.fromisoformat(entry['fecha']).timestamp() >= month_ago]
    movements = _load_movements()
    ingresos = [m for m in movements if m.get('type') == 'INGRESO']
    salidas = [m for m in movements if m.get('type') == 'SALIDA']
    return {
        'updated_at': payload.get('updated_at'),
        'umbral_bajo': LOW_STOCK_MTS,
        'telas': sorted({item['nombre'] for item in items}),
        'kpis': {
            'mts': round(sum(float(item.get('total') or 0) for item in items), 2),
            'telas': len(items), 'telas_con_stock': len(stock), 'telas_sin_stock': len(items) - len(stock),
            'rollos': rolls_new + rolls_started,
            'rollos_nuevos': rolls_new, 'mts_nuevos': round(mts_new, 2),
            'rollos_empezados': rolls_started, 'mts_empezados': round(mts_started, 2),
        },
        'top': [simple(item) for item in sorted(stock, key=lambda item: -float(item['total']))[:10]],
        'bajo_stock': [simple(item) for item in sorted((i for i in stock if float(i['total']) < LOW_STOCK_MTS), key=lambda i: float(i['total']))[:12]],
        'sin_stock': [item['nombre'] for item in items if float(item.get('total') or 0) <= 0],
        'proveedores_telas': {name: sorted(((item['nombre'], round(float(item.get('total') or 0), 2)) for item in items if _supplier(item) == name), key=lambda pair: -pair[1])[:3] for name in suppliers},
        'proveedores': [{**entry, 'mts': round(entry['mts'], 2)} for entry in sorted(suppliers.values(), key=lambda entry: -entry['mts'])],
        'listas': [plan_card(plan) for plan in ready],
        'listas_no_alcanzan': sum(1 for plan in ready if plan.get('short')),
        'sublimacion': {
            'ordenes': len(plans),
            'mts': round(sum(float(plan.get('mts') or 0) for plan in plans), 2),
            'no_alcanzan': sum(1 for plan in plans if plan.get('short')),
            'faltan': round(sum(float(plan.get('missing') or 0) for plan in plans), 2),
            'lista': [plan_card(plan) for plan in plans],
        },
        'consumos': {'mts_30d': round(sum(entry['mts'] for entry in recent), 2), 'ordenes_30d': len(recent), 'ultimos': consumptions[:8]},
        'movimientos': {
            'ingresos': len(ingresos), 'ingresos_mts': round(sum(float(m.get('mts') or 0) for m in ingresos), 2),
            'salidas': len(salidas), 'salidas_mts': round(sum(float(m.get('mts') or 0) for m in salidas), 2),
            'ultimos': [{'tipo': m.get('type'), 'nombre': m.get('name'), 'mts': m.get('mts'), 'rollos': m.get('rolls'),
                         'fecha': m.get('fecha', ''), 'origen': m.get('source', '')} for m in movements[-8:][::-1]],
        },
        'documentos': len(_imported_documents()),
    }


def start_sublimacion_worker() -> None:
    sublimacion_stock.start_worker(_load_snapshot)


def _inventory_payload(refresh: bool = False):
    with _lock:
        cached = _cache["data"]
        if cached and not refresh and time.monotonic() - _cache["at"] < CACHE_SECONDS:
            return cached
        snapshot = _load_snapshot()
        if not refresh and snapshot is not None and len(snapshot.get('categories', [])) > 1:
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(snapshot['updated_at'])).total_seconds()
            except (KeyError, ValueError):
                age = 0
            if age > 300:
                try:
                    snapshot = _read_inventory()
                    _save_snapshot(snapshot)
                except Exception:
                    pass
            _cache.update({"at": time.monotonic(), "data": snapshot})
            return snapshot
        try:
            # La apertura normal usa la copia local. Solo una actualización
            # explícita consulta Sheets para importar metros, rollos y demás
            # columnas al snapshot del servidor.
            payload = _read_inventory() if (refresh or _load_snapshot() is None or len((_load_snapshot() or {}).get('categories', [])) <= 1) else _local_inventory()
            _save_snapshot(payload)
        except Exception as exc:
            snapshot = _load_snapshot()
            if snapshot is None:
                raise HTTPException(status_code=503, detail="Inventario aún no sincronizado. Ejecuta una sincronización inicial.") from exc
            payload = snapshot
        _cache.update({"at": time.monotonic(), "data": payload})
        return payload


def _refresh_snapshot() -> None:
    try:
        payload = _read_inventory()
        _save_snapshot(payload)
        _cache.update({"at": time.monotonic(), "data": payload})
    except Exception:
        _cache.update({'at': 0.0, 'data': None})


_new_fabrics_file = os.getenv('INVENTORY_NEW_FABRICS_FILE', '/data/inventory_telas_nuevas.json')


def _load_new_fabrics() -> list[dict[str, Any]]:
    try:
        with open(_new_fabrics_file, encoding='utf-8') as handle:
            data = json.load(handle)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


_documents_file = os.getenv('INVENTORY_DOCUMENTS_FILE', '/data/inventory_documentos.json')
_documents_dir = os.getenv('INVENTORY_DOCUMENTS_DIR', '/data/inventory_documentos')


def _imported_documents() -> dict[str, Any]:
    try:
        with open(_documents_file, encoding='utf-8') as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


@inventario_router.post('/movimiento')
def inventory_movement(movement: InventoryMovement):
    with _lock:
        movements = _load_movements()
        movements.append({**movement.model_dump(), 'fecha': datetime.now(timezone.utc).isoformat()})
        _save_movements(movements)
        _refresh_snapshot()
    return {'ok': True}


class InventoryBatch(BaseModel):
    movements: list[InventoryMovement] = Field(min_length=1, max_length=300)
    doc_hash: str = ''
    doc_name: str = ''


class NewFabric(BaseModel):
    codigo: str = Field(min_length=1, max_length=12, pattern=r'^[A-Za-z0-9-]+$')
    nombre: str = Field(min_length=2, max_length=80)


@inventario_router.post('/tela')
def inventory_new_fabric(fabric: NewFabric):
    codigo = fabric.codigo.strip()
    nombre = re.sub(r'\s+', ' ', fabric.nombre.strip()).upper()
    with _lock:
        known = [item['nombre'] for item in (_load_snapshot() or {}).get('items', []) if item.get('categoria') == 'BODEGA TELA']
        known += [f"({f['codigo']}) {f['nombre']}" for f in _load_new_fabrics()]
        for name in known:
            match = re.match(r'^\s*\(([^)]+)\)\s*(.*)$', name)
            if match and match.group(1) == codigo:
                raise HTTPException(status_code=409, detail=f'El código {codigo} ya existe: {name}')
            if match and _normalized(match.group(2)) == _normalized(nombre):
                raise HTTPException(status_code=409, detail=f'Ya existe una tela con ese nombre: {name}')
        fabrics = _load_new_fabrics()
        fabrics.append({'codigo': codigo, 'nombre': nombre, 'fecha': datetime.now(timezone.utc).isoformat()})
        os.makedirs(os.path.dirname(_new_fabrics_file) or '.', exist_ok=True)
        with open(_new_fabrics_file, 'w', encoding='utf-8') as handle:
            json.dump(fabrics, handle, ensure_ascii=False)
        _refresh_snapshot()
    return {'ok': True, 'nombre': f'({codigo}) {nombre}'}


@inventario_router.post('/movimientos')
def inventory_movements(batch: InventoryBatch):
    with _lock:
        imported = _imported_documents()
        if batch.doc_hash and batch.doc_hash in imported:
            raise HTTPException(status_code=409, detail='Este documento ya fue registrado antes.')
        movements = _load_movements()
        now = datetime.now(timezone.utc).isoformat()
        movements.extend({**movement.model_dump(), 'source': batch.doc_name, 'fecha': now} for movement in batch.movements)
        _save_movements(movements)
        if batch.doc_hash:
            imported[batch.doc_hash] = {'nombre': batch.doc_name, 'fecha': datetime.now(timezone.utc).isoformat(), 'movimientos': len(batch.movements)}
            os.makedirs(os.path.dirname(_documents_file) or '.', exist_ok=True)
            with open(_documents_file, 'w', encoding='utf-8') as handle:
                json.dump(imported, handle, ensure_ascii=False)
        _refresh_snapshot()
    return {'ok': True, 'registrados': len(batch.movements)}


_bodegas_file = os.getenv('INVENTORY_BODEGAS_FILE', '/data/inventory_bodegas.json')
DEFAULT_BODEGAS = ['BODEGA GLORIA', 'SEGUNDO PISO', 'BODEGA CASA']
_bodegas_lock = threading.Lock()


def _load_bodegas() -> dict[str, Any]:
    try:
        with open(_bodegas_file, encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            data.setdefault('bodegas', list(DEFAULT_BODEGAS))
            data.setdefault('asignaciones', {})
            return data
    except (OSError, ValueError):
        pass
    return {'bodegas': list(DEFAULT_BODEGAS), 'asignaciones': {}}


def _save_bodegas(data: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(_bodegas_file) or '.', exist_ok=True)
    tmp = _bodegas_file + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False)
    os.replace(tmp, _bodegas_file)


def _fabric_rolls() -> list[dict[str, Any]]:
    payload = _with_sublimacion(_inventory_payload())
    return [item for item in payload.get('items') or [] if item.get('categoria') == 'BODEGA TELA']


def _resolve_rolls(values: list[float], saved: list[dict[str, Any]]) -> list[str]:
    """Bodega de cada rollo actual. Se reconoce el rollo por posición y metros; si sus metros
    cambiaron (se consumió una parte) se mantiene la bodega de la misma posición."""
    result = [''] * len(values)
    pending = list(saved)
    for index, value in enumerate(values):
        match = next((s for s in pending if s['i'] == index and abs(float(s['v']) - float(value)) < 1e-6), None)
        if match:
            result[index] = match['b']
            pending.remove(match)
    for index, value in enumerate(values):
        if result[index]:
            continue
        match = next((s for s in pending if abs(float(s['v']) - float(value)) < 1e-6), None) \
            or next((s for s in pending if s['i'] == index), None)
        if match:
            result[index] = match['b']
            pending.remove(match)
    return result


@inventario_router.get('/bodegas')
def inventory_bodegas():
    data = _load_bodegas()
    telas = []
    totals = {name: {'nombre': name, 'mts': 0.0, 'rollos': 0, 'telas': set()} for name in data['bodegas'] + ['']}
    for item in _fabric_rolls():
        values = [float(v) for v in item.get('roll_values') or []]
        statuses = item.get('roll_statuses') or []
        places = _resolve_rolls(values, data['asignaciones'].get(item['nombre'], []))
        rolls = []
        for index, value in enumerate(values):
            place = places[index] if places[index] in totals else ''
            rolls.append({'i': index, 'v': value, 'estado': statuses[index] if index < len(statuses) else 'new', 'bodega': place})
            totals[place]['mts'] += value
            totals[place]['rollos'] += 1
            totals[place]['telas'].add(item['nombre'])
        telas.append({'nombre': item['nombre'], 'mts': round(float(item.get('total') or 0), 2), 'rollos': rolls})
    return {
        'bodegas': data['bodegas'],
        'resumen': [{'nombre': entry['nombre'], 'mts': round(entry['mts'], 2), 'rollos': entry['rollos'], 'telas': len(entry['telas'])}
                    for entry in totals.values()],
        'telas': telas,
    }


class BodegaAssignment(BaseModel):
    nombre: str
    rollos: list[int] = Field(min_length=1, max_length=500)
    bodega: str = ''


@inventario_router.post('/bodegas/asignar')
def inventory_bodegas_assign(assignment: BodegaAssignment):
    items = _fabric_rolls()
    with _bodegas_lock:
        data = _load_bodegas()
        if assignment.bodega and assignment.bodega not in data['bodegas']:
            raise HTTPException(status_code=404, detail='Esa bodega no existe.')
        item = next((i for i in items if i['nombre'] == assignment.nombre), None)
        if not item:
            raise HTTPException(status_code=404, detail='Esa tela no existe en Bodega tela.')
        values = [float(v) for v in item.get('roll_values') or []]
        if any(index < 0 or index >= len(values) for index in assignment.rollos):
            raise HTTPException(status_code=409, detail='Los rollos cambiaron; recarga la página.')
        places = _resolve_rolls(values, data['asignaciones'].get(item['nombre'], []))
        for index in assignment.rollos:
            places[index] = assignment.bodega
        data['asignaciones'][item['nombre']] = [{'i': i, 'v': values[i], 'b': b} for i, b in enumerate(places) if b]
        if not data['asignaciones'][item['nombre']]:
            data['asignaciones'].pop(item['nombre'])
        _save_bodegas(data)
    return {'ok': True}


class NewBodega(BaseModel):
    nombre: str = Field(min_length=2, max_length=40)


@inventario_router.post('/bodegas')
def inventory_bodegas_create(bodega: NewBodega):
    name = re.sub(r'\s+', ' ', bodega.nombre.strip()).upper()
    with _bodegas_lock:
        data = _load_bodegas()
        if any(_normalized(existing) == _normalized(name) for existing in data['bodegas']):
            raise HTTPException(status_code=409, detail=f'La bodega {name} ya existe.')
        data['bodegas'].append(name)
        _save_bodegas(data)
    return {'ok': True, 'nombre': name}


@inventario_router.post('/documento')
async def inventory_document(file: UploadFile = File(...)):
    data = await file.read()
    if not data or len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='El archivo está vacío o supera los 15 MB.')
    name = file.filename or 'documento'
    if not (data[:4] == b'%PDF' or (file.content_type or '').startswith('image/') or name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))):
        raise HTTPException(status_code=415, detail='Sube un PDF o una imagen (JPG, PNG).')
    digest = hashlib.sha256(data).hexdigest()
    try:
        os.makedirs(_documents_dir, exist_ok=True)
        with open(os.path.join(_documents_dir, digest + os.path.splitext(name)[1].lower()), 'wb') as handle:
            handle.write(data)
    except OSError:
        pass
    try:
        parsed = await run_in_threadpool(ingreso_documento.parse_document, data, name)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f'No se pudo leer el documento: {exc}') from exc
    snapshot = _load_snapshot() or {}
    items = [item for item in snapshot.get('items', []) if item.get('categoria') in ('BODEGA TELA', 'RETAL CANASTAS')]
    for line in parsed['lineas']:
        line['sugerencias'] = ingreso_documento.suggest_items(line['descripcion'], items)
    already = _imported_documents().get(digest)
    return {**parsed, 'hash': digest, 'nombre': name, 'duplicado': already}
