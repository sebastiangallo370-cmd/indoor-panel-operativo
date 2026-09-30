import os
import json
import uuid
import shutil
import io
import re
import os
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import HTMLResponse
from typing import List, Dict, Any

from app.cartera_pdf import parse_effi_pdf

cartera_router = APIRouter(prefix="/api/cartera", tags=["cartera"])

DATOS_DIR = Path(os.getenv("CARTERA_STATE_DIR", "/data/state"))
RESPALDOS_DIR = DATOS_DIR / "cartera_respaldos"
CARTERA_FILE = DATOS_DIR / "cartera.json"

RESPALDOS_DIR.mkdir(parents=True, exist_ok=True)

@cartera_router.get("/app", response_class=HTMLResponse)
def serve_cartera_app():
    with open("app/cartera_app.html", "r", encoding="utf-8") as f:
        return f.read()

@cartera_router.get("/cartera.css")
def serve_cartera_css():
    from fastapi.responses import FileResponse
    return FileResponse("app/cartera.css", media_type="text/css")

@cartera_router.get("/cartera.js")
def serve_cartera_js():
    from fastapi.responses import FileResponse
    return FileResponse("app/cartera.js", media_type="application/javascript")

def load_cartera():
    if not os.path.exists(CARTERA_FILE):
        return {
            "config": {
                "plazoDesde": "entrega",
                "contadoEquivale": "mismo_dia_entrega",
                "anticipoMinimoPct": 50
            },
            "usuarios": ["DANIEL", "ANDRES", "SEBASTIAN GALLO", "ADMINISTRACION"],
            "documentos": [],
            "comprobantes": [],
            "contadorComprobante": 1
        }
    with open(CARTERA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_cartera(data):
    """Guarda el estado de Cartera de forma atómica y persistente.

    El archivo vive en el volumen ``/data`` de Docker. Escribimos primero en
    un temporal del mismo directorio y después lo reemplazamos para no dejar
    un JSON incompleto si el proceso se reinicia durante el guardado.
    """
    temp_file = CARTERA_FILE.with_suffix(f"{CARTERA_FILE.suffix}.tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_file, CARTERA_FILE)

def backup_cartera():
    if not os.path.exists(CARTERA_FILE): return
    today = datetime.now().strftime("%Y-%m-%d")
    backup_file = RESPALDOS_DIR / f"cartera_{today}.json"
    if not backup_file.exists():
        shutil.copy2(CARTERA_FILE, backup_file)
    # Limpiar viejos
    backups = sorted(RESPALDOS_DIR.iterdir())
    while len(backups) > 30:
        oldest = backups.pop(0)
        oldest.unlink()


def _header_key(value: Any) -> str:
    """Normaliza encabezados de Excel sin depender de tildes o mayúsculas."""
    text = str(value or "").upper().strip()
    return re.sub(r"[^A-Z0-9]+", " ", text)


def _find_column(headers: List[Any], words: List[str], fallback: int | None = None) -> int | None:
    for index, header in enumerate(headers):
        normalized = _header_key(header)
        if all(word in normalized for word in words):
            return index
    return fallback


def _amount(value: Any) -> float:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return float(value)
    digits = re.sub(r"[^0-9,.-]", "", str(value))
    if not digits:
        return 0
    if digits.count(",") == 1 and digits.count(".") >= 1:
        digits = digits.replace(".", "").replace(",", ".")
    elif digits.count(",") > 1 or (digits.count(",") == 1 and digits.count(".") == 0):
        digits = digits.replace(",", "")
    try:
        return float(digits)
    except ValueError:
        return 0


def _date_value(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()[:10]
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def sync_from_indoor_control() -> Dict[str, Any]:
    """Lee el Excel real de CONTROL DE PAGOS COTIZACIONES desde Drive.

    La misma cuenta de servicio que usan los procesos de pedidos se utiliza en
    modo lectura. No se modifica el archivo comercial desde este módulo.
    """
    credentials_path = Path(os.getenv("GOOGLE_CREDENTIALS", "/run/secrets/google-service-account.json"))
    file_id = os.getenv("PAGOS_COTIZACIONES_FILE_ID", "").strip()
    sheet_name = os.getenv("PAGOS_COTIZACIONES_HOJA", "").strip()
    if not file_id or file_id == "REEMPLAZAR":
        raise HTTPException(503, "Falta configurar PAGOS_COTIZACIONES_FILE_ID en el servidor")
    if not credentials_path.is_file():
        raise HTTPException(503, "Falta la credencial de Google en /run/secrets/google-service-account.json")

    try:
        import openpyxl
        from google.oauth2.service_account import Credentials
        from google.auth.transport.requests import AuthorizedSession

        credentials = Credentials.from_service_account_file(
            str(credentials_path), scopes=["https://www.googleapis.com/auth/drive.readonly"]
        )
        response = AuthorizedSession(credentials).get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"}, timeout=60,
        )
        response.raise_for_status()
        workbook = openpyxl.load_workbook(io.BytesIO(response.content), data_only=True, read_only=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"No fue posible leer CONTROL DE PAGOS COTIZACIONES: {exc}") from exc

    worksheet = workbook[sheet_name] if sheet_name in workbook.sheetnames else workbook[workbook.sheetnames[0]]
    rows = worksheet.iter_rows(values_only=True)
    headers = list(next(rows, []))
    if not headers:
        raise HTTPException(422, "El archivo de CONTROL DE PAGOS COTIZACIONES no tiene encabezados")

    col_number = _find_column(headers, ["COTIZACION"], 0)
    col_client = _find_column(headers, ["CLIENTE"], 1)
    col_seller = _find_column(headers, ["VENDEDOR"], 2)
    col_total = _find_column(headers, ["TOTAL"], 3)
    col_created = _find_column(headers, ["FECHA"], None)
    col_paid = _find_column(headers, ["PAGADO"], None)
    col_status = _find_column(headers, ["ESTADO"], None)

    documents = []
    for row in rows:
        if not row or col_number is None or col_number >= len(row) or row[col_number] in (None, ""):
            continue
        raw_number = str(row[col_number]).strip()
        number = re.sub(r"^(?:CO|COTIZACION)\s*", "", raw_number, flags=re.IGNORECASE).strip()
        if not number:
            continue
        value_at = lambda column: row[column] if column is not None and column < len(row) else ""
        status_text = str(value_at(col_status)).lower()
        documents.append({
            "numero": number,
            "cliente": str(value_at(col_client)).strip() or "SIN CLIENTE",
            "vendedor": str(value_at(col_seller)).strip(),
            "fechaCreacion": _date_value(value_at(col_created)),
            "fechaEntrega": "",
            "formaPago": "",
            "total": _amount(value_at(col_total)),
            "pagadoImportado": _amount(value_at(col_paid)),
            "estado": "anulada" if "anulad" in status_text else "pedido",
            "origen": "CONTROL DE PAGOS COTIZACIONES",
            "revisar": False,
            "notas": "Sincronizado desde Indoor",
        })

    db = load_cartera()
    previous = {str(item.get("numero")): item for item in db["documentos"]}
    merged = []
    imported_numbers = set()
    for document in documents:
        imported_numbers.add(document["numero"])
        old = previous.get(document["numero"], {})
        document["historial"] = old.get("historial", [])
        document["historial"].append({"fecha": datetime.now(timezone.utc).isoformat(), "accion": "Sincronizado desde Indoor"})
        merged.append(document)
    # Conserva únicamente los documentos creados manualmente o desde PDF que no
    # pertenecen al control comercial de Indoor.
    merged.extend(item for number, item in previous.items() if number not in imported_numbers and item.get("origen") != "CONTROL DE PAGOS COTIZACIONES")
    db["documentos"] = merged
    db["ultimaSincronizacionIndoor"] = datetime.now(timezone.utc).isoformat()
    save_cartera(db)
    return {"ok": True, "documentos": len(documents), "hoja": worksheet.title, "sincronizado_en": db["ultimaSincronizacionIndoor"]}

@cartera_router.get("/datos")
def get_datos():
    backup_cartera()
    return load_cartera()


@cartera_router.post("/sincronizar-indoor")
def sincronizar_indoor():
    return sync_from_indoor_control()

@cartera_router.post("/documentos")
def upsert_documentos(docs: List[Dict[Any, Any]]):
    db = load_cartera()
    existentes = {d["numero"]: i for i, d in enumerate(db["documentos"])}
    
    for doc in docs:
        num = doc.get("numero")
        if num in existentes:
            # Actualizar campos pero mantener historial/pagos si los hay
            idx = existentes[num]
            doc["historial"] = db["documentos"][idx].get("historial", [])
            doc["historial"].append({"fecha": datetime.now(timezone.utc).isoformat(), "accion": "Actualizado"})
            db["documentos"][idx] = doc
        else:
            doc["historial"] = [{"fecha": datetime.now(timezone.utc).isoformat(), "accion": "Creado"}]
            db["documentos"].append(doc)
            
    save_cartera(db)
    return {"ok": True, "documentos": db["documentos"]}

@cartera_router.post("/comprobantes")
def add_comprobante(comp: Dict[Any, Any]):
    db = load_cartera()
    comp["id"] = f"CI-{db['contadorComprobante']:04d}"
    db["contadorComprobante"] += 1
    comp["fecha_registro"] = datetime.now(timezone.utc).isoformat()
    db["comprobantes"].append(comp)
    save_cartera(db)
    return {"ok": True, "comprobante": comp}

@cartera_router.put("/comprobantes/{comp_id}/anular")
def anular_comprobante(comp_id: str, payload: Dict[Any, Any]):
    db = load_cartera()
    for c in db["comprobantes"]:
        if c["id"] == comp_id:
            c["anulado"] = True
            c["motivoAnulacion"] = payload.get("motivo", "Sin motivo")
            c["editado"] = True
            save_cartera(db)
            return {"ok": True}
    raise HTTPException(404, "Comprobante no encontrado")

@cartera_router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Solo se admiten archivos PDF")
    
    # Escribir a disco temporal
    temp_pdf = f"temp_{uuid.uuid4().hex}.pdf"
    with open(temp_pdf, "wb") as f:
        f.write(await file.read())
        
    try:
        data = parse_effi_pdf(temp_pdf)
    except Exception as e:
        os.remove(temp_pdf)
        raise HTTPException(500, f"Error leyendo PDF: {str(e)}")
        
    os.remove(temp_pdf)
    if not data["numero"]:
        raise HTTPException(400, "No se encontró el número de cotización en el PDF")
        
    return {"ok": True, "documento": data}
