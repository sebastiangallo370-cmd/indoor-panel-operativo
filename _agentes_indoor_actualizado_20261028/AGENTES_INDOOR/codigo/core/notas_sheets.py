"""Escribe NOTAS (comentarios) en la hoja ORDENES DE PRODUCCION, sin cambiar el valor de ninguna celda ni crear pestañas.

Uso: notas_sheets.anotar(orden, {"Q": "MTS requeridos: 26.70", "AP": "Inicio: 26/11 10:20", ...})
La fila se busca por el número de orden en la columna E (ORDEN).
"""
import json
import re

import config

HOJA = "ORDENES DE PRODUCCION"
COLUMNA_ORDEN = "E"


def _col_a_indice(letra: str) -> int:
    """«A» -> 0, «Q» -> 16, «AP» -> 41 (índice de columna base 0)."""
    n = 0
    for ch in letra.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _id_hoja() -> str:
    """ID de la hoja de producción. Separado de SHEET_ID para que las notas no activen la creación de pestañas."""
    cfg = getattr(config, "_cfg", {}) or {}
    return cfg.get("sheet_ordenes_id") or ""


def _fila_de(gc, sh_id: str, orden: str):
    """Número de fila (base 1) donde ORDEN = orden. None si no existe."""
    import gspread
    sh = gc.open_by_key(sh_id)
    ws = sh.worksheet(HOJA)
    valores = ws.col_values(_col_a_indice(COLUMNA_ORDEN) + 1)
    objetivo = str(orden).strip().upper()
    for i, v in enumerate(valores, start=1):
        if str(v).strip().upper() == objetivo:
            return i, ws
    return None, ws


def construir_solicitud(ws_id: int, fila: int, notas: dict) -> dict:
    """Solicitud de Google Sheets que pone una nota en cada celda (fila base 1, columnas por letra)."""
    requests = []
    for letra, texto in notas.items():
        requests.append({
            "updateCells": {
                "range": {"sheetId": ws_id, "startRowIndex": fila - 1, "endRowIndex": fila,
                          "startColumnIndex": _col_a_indice(letra), "endColumnIndex": _col_a_indice(letra) + 1},
                "rows": [{"values": [{"note": str(texto)}]}],
                "fields": "note",
            }
        })
    return {"requests": requests}


def anotar(orden: str, notas: dict) -> dict:
    """Pone las notas en la fila de la orden. Devuelve {ok, ...}; nunca lanza excepciones hacia el agente."""
    sh_id = _id_hoja()
    if not sh_id:
        return {"ok": False, "error": "Falta sheet_ordenes_id en datos/config.json"}
    if not config.GOOGLE_CREDENCIALES.exists():
        return {"ok": False, "error": "Falta credenciales/google.json"}
    try:
        import gspread
        gc = gspread.service_account(filename=str(config.GOOGLE_CREDENCIALES))
        fila, ws = _fila_de(gc, sh_id, orden)
        if not fila:
            return {"ok": False, "error": f"No encuentro la orden {orden} en {HOJA}"}
        cuerpo = construir_solicitud(ws.id, fila, notas)
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sh_id}:batchUpdate"
        r = gc.http_client.session.post(url, data=json.dumps(cuerpo), headers={"Content-Type": "application/json"}, timeout=60)
        if r.status_code >= 300:
            return {"ok": False, "error": f"Google respondió {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "fila": fila, "celdas": list(notas.keys())}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300]}


def construir_escritura(ws_id: int, fila: int, valores: dict, notas: dict) -> dict:
    """valores: texto visible en la celda (sin nota). notas: solo comentario, el valor no cambia."""
    requests = []
    for letra, texto in valores.items():
        col = _col_a_indice(letra)
        requests.append({"updateCells": {
            "range": {"sheetId": ws_id, "startRowIndex": fila - 1, "endRowIndex": fila,
                      "startColumnIndex": col, "endColumnIndex": col + 1},
            "rows": [{"values": [{"userEnteredValue": {"stringValue": str(texto)}, "note": ""}]}],
            "fields": "userEnteredValue,note"}})
    for letra, texto in notas.items():
        col = _col_a_indice(letra)
        requests.append({"updateCells": {
            "range": {"sheetId": ws_id, "startRowIndex": fila - 1, "endRowIndex": fila,
                      "startColumnIndex": col, "endColumnIndex": col + 1},
            "rows": [{"values": [{"note": str(texto)}]}],
            "fields": "note"}})
    return {"requests": requests}


def escribir(orden: str, valores: dict = None, notas: dict = None) -> dict:
    """valores -> celda (EDICION). notas -> comentario (MTS en Q)."""
    sh_id = _id_hoja()
    if not sh_id or not config.GOOGLE_CREDENCIALES.exists():
        return {"ok": False, "error": "Falta sheet_ordenes_id o credenciales/google.json"}
    try:
        import gspread
        gc = gspread.service_account(filename=str(config.GOOGLE_CREDENCIALES))
        fila, ws = _fila_de(gc, sh_id, orden)
        if not fila:
            return {"ok": False, "error": f"No encuentro la orden {orden} en {HOJA}"}
        cuerpo = construir_escritura(ws.id, fila, valores or {}, notas or {})
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sh_id}:batchUpdate"
        r = gc.http_client.session.post(url, data=json.dumps(cuerpo), headers={"Content-Type": "application/json"}, timeout=60)
        if r.status_code >= 300:
            return {"ok": False, "error": f"Google respondió {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "fila": fila, "valores": list((valores or {}).keys()), "notas": list((notas or {}).keys())}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300]}
