import os
import json
import uuid
import shutil
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import HTMLResponse
from typing import List, Dict, Any

from cartera_pdf import parse_effi_pdf

cartera_router = APIRouter(prefix="/api/cartera", tags=["cartera"])

DATOS_DIR = "datos"
RESPALDOS_DIR = os.path.join(DATOS_DIR, "respaldos")
CARTERA_FILE = os.path.join(DATOS_DIR, "cartera.json")

os.makedirs(RESPALDOS_DIR, exist_ok=True)

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
    # Escritura atómica
    temp_file = CARTERA_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, CARTERA_FILE)

def backup_cartera():
    if not os.path.exists(CARTERA_FILE): return
    today = datetime.now().strftime("%Y-%m-%d")
    backup_file = os.path.join(RESPALDOS_DIR, f"cartera_{today}.json")
    if not os.path.exists(backup_file):
        shutil.copy2(CARTERA_FILE, backup_file)
    # Limpiar viejos
    backups = sorted(os.listdir(RESPALDOS_DIR))
    while len(backups) > 30:
        oldest = backups.pop(0)
        os.remove(os.path.join(RESPALDOS_DIR, oldest))

@cartera_router.get("/datos")
def get_datos():
    backup_cartera()
    return load_cartera()

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
