import io, json, os, re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

cartera_router = APIRouter(prefix="/api/cartera", tags=["cartera"])

_STATE = Path(os.getenv("CARTERA_STATE_DIR", "/data/state")) / "cartera_v2.json"


def _load():
    if _STATE.exists():
        return json.loads(_STATE.read_text(encoding="utf-8"))
    return {"documentos": [], "ultima_sync": None}


def _save(data):
    tmp = _STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_STATE)


def _amt(v):
    if not v:
        return 0.0
    try:
        return float(re.sub(r"[^0-9,.\-]", "", str(v)).replace(",", "."))
    except ValueError:
        return 0.0


def _date(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    s = str(v or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s


@cartera_router.get("/datos")
def get_datos():
    return _load()


@cartera_router.post("/sincronizar")
def sincronizar():
    creds_path = Path(os.getenv("GOOGLE_CREDENTIALS", "/run/secrets/google-service-account.json"))
    file_id    = os.getenv("PAGOS_COTIZACIONES_FILE_ID", "").strip()
    sheet_name = os.getenv("PAGOS_COTIZACIONES_HOJA", "").strip()

    if not file_id:
        raise HTTPException(503, "Falta configurar PAGOS_COTIZACIONES_FILE_ID en el servidor")
    if not creds_path.is_file():
        raise HTTPException(503, "Falta la credencial de Google en /run/secrets/google-service-account.json")

    try:
        import openpyxl
        from google.oauth2.service_account import Credentials
        from google.auth.transport.requests import AuthorizedSession

        sess = AuthorizedSession(Credentials.from_service_account_file(
            str(creds_path), scopes=["https://www.googleapis.com/auth/drive.readonly"]
        ))
        resp = sess.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            timeout=60,
        )
        resp.raise_for_status()
        wb = openpyxl.load_workbook(io.BytesIO(resp.content), data_only=True, read_only=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"No se pudo leer el archivo de Google Drive: {exc}") from exc

    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    headers = [str(c or "").upper().strip() for c in (next(rows, []))]

    def col(*words):
        for i, h in enumerate(headers):
            if all(w in h for w in words):
                return i
        return None

    c_num = col("COTIZACION") or 0
    c_cli = col("CLIENTE") or 1
    c_ven = col("VENDEDOR") or 2
    c_tot = col("TOTAL") or 3
    c_fec = col("FECHA")
    c_pag = col("PAGADO")
    c_est = col("ESTADO")

    def v(row, i):
        return row[i] if i is not None and i < len(row) else ""

    docs = []
    for row in rows:
        num = str(v(row, c_num) or "").strip()
        if not num:
            continue
        total  = _amt(v(row, c_tot))
        pagado = _amt(v(row, c_pag))
        estado_raw = str(v(row, c_est) or "").lower()
        estado = "anulada" if "anulad" in estado_raw else "activa"
        docs.append({
            "numero":   num,
            "cliente":  str(v(row, c_cli) or "").strip() or "SIN CLIENTE",
            "vendedor": str(v(row, c_ven) or "").strip(),
            "fecha":    _date(v(row, c_fec)),
            "total":    total,
            "pagado":   pagado,
            "saldo":    round(total - pagado, 2),
            "estado":   estado,
        })

    data = {"documentos": docs, "ultima_sync": datetime.now(timezone.utc).isoformat()}
    _save(data)
    return {"ok": True, "documentos": len(docs), "hoja": ws.title}


@cartera_router.get("/cartera.js")
def serve_js():
    return FileResponse(Path(__file__).with_name("cartera.js"), media_type="application/javascript")
