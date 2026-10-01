"""Lectura consolidada del inventario de Indoor desde Google Sheets."""

from __future__ import annotations

import os
import json
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any

import gspread
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from google.oauth2.service_account import Credentials


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
    records: list[dict[str, Any]] = []
    active_name: int | None = None
    active_total: int | None = None
    active_headers: list[str] = []
    seen: set[tuple[str, str, float]] = set()
    for row_index, row in enumerate(values, start=1):
        if _is_header(row):
            active_name, active_total = _header_positions(row)
            active_headers = [str(value or "").strip() or f"Campo {index + 1}" for index, value in enumerate(row)]
            continue
        if active_name is None or active_total is None:
            continue
        name = str(row[active_name] if active_name < len(row) else "").strip()
        total = _number(row[active_total] if active_total < len(row) else "")
        normalized_name = _normalized(name)
        if not name or normalized_name in {"TOTAL", "SUBTOTAL", "NOMBRE", "REFERENCIA"}:
            continue
        if total == 0 and not any(str(cell or "").strip() for cell in row[active_name + 1:active_total + 1]):
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
            fmt = (((grid_rows[row_index - 1].get('values', [])[index] if grid_rows and row_index - 1 < len(grid_rows) and index < len(grid_rows[row_index - 1].get('values', [])) else {})
                    .get('effectiveFormat', {}).get('backgroundColor', {})) if grid_rows else {})
            red, green, blue = float(fmt.get('red', 1)), float(fmt.get('green', 1)), float(fmt.get('blue', 1))
            if red > .9 and .65 < green < .88 and blue < .8:
                roll_statuses.append('started')
            else:
                roll_statuses.append('new')
        records.append({
            "id": f"{tab_key}:{row_index}:{len(records)}",
            "categoria": tab_key,
            "categoria_label": tab_label,
            "nombre": name,
            "total": total,
            "total_label": _display_total(total),
            "mts": _number(meters) if meters else total,
            "rolls": int(_number(rolls)) if rolls else 0,
            "roll_values": roll_values,
            "roll_statuses": roll_statuses,
            "campos": fields,
        })
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
    for movement in _load_movements():
        target = next((record for record in all_records if record['nombre'] == movement.get('name') or (movement.get('code') and f"({movement.get('code')})" in record['nombre'])), None)
        if not target:
            continue
        sign = 1 if movement.get('type') == 'INGRESO' else -1
        target['total'] = max(0, target['total'] + sign * float(movement.get('mts') or 0))
        target['total_label'] = _display_total(target['total'])
        if sign > 0:
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


@inventario_router.get("")
def inventory_snapshot(refresh: bool = False):
    with _lock:
        cached = _cache["data"]
        if cached and not refresh and time.monotonic() - _cache["at"] < CACHE_SECONDS:
            return cached
        if not refresh and cached is None:
            snapshot = _load_snapshot()
            # Una copia local inicial solo contiene nombres. Importar una vez
            # el libro completo para incorporar metros, rollos y categorías.
            if snapshot is not None and len(snapshot.get('categories', [])) > 1 and all('roll_values' in item for item in snapshot.get('items', [])[:5]):
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


@inventario_router.post('/movimiento')
def inventory_movement(movement: InventoryMovement):
    with _lock:
        movements = _load_movements()
        movements.append(movement.model_dump())
        _save_movements(movements)
        _cache.update({'at': 0.0, 'data': None})
    return {'ok': True}
