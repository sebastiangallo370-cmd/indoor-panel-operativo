"""Control de Cartera · INDOOR SPORT S.A.S.
Backend: API endpoints + PDF parser + JSON persistence.
Data lives in /data/cartera.json; backups in /data/respaldos/.
"""
import csv
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import Body, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse

# ── Paths ────────────────────────────────────────────────────────────────────
DATA_DIR = Path("/data")
CARTERA_JSON = DATA_DIR / "cartera.json"
RESPALDOS_DIR = DATA_DIR / "respaldos"
_LOCK = threading.Lock()

# ── Default data ─────────────────────────────────────────────────────────────
DEFAULT_DATA: dict = {
    "config": {
        "plazoDesde": "entrega",
        "contadoEquivale": "mismo_dia_entrega",
        "anticipoMinimoPct": 50,
    },
    "usuarios": ["DANIEL", "ANDRES", "SEBASTIAN GALLO"],
    "documentos": [],
    "comprobantes": [],
    "contadorComprobante": 1,
}


# ── Persistence ───────────────────────────────────────────────────────────────
def _load() -> dict:
    try:
        return json.loads(CARTERA_JSON.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_DATA))


def _save(data: dict) -> None:
    CARTERA_JSON.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=CARTERA_JSON.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        shutil.move(tmp, CARTERA_JSON)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    _auto_backup(data)


def _auto_backup(data: dict) -> None:
    RESPALDOS_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    dest = RESPALDOS_DIR / f"cartera-{today}.json"
    if not dest.exists():
        try:
            dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            # Keep last 30 backups
            backups = sorted(RESPALDOS_DIR.glob("cartera-*.json"))
            for old in backups[:-30]:
                old.unlink(missing_ok=True)
        except Exception:
            pass


# ── Business-logic helpers ────────────────────────────────────────────────────
def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _vencimiento(doc: dict, config: dict) -> date | None:
    plazo_desde = config.get("plazoDesde", "entrega")
    contado_eq = config.get("contadoEquivale", "mismo_dia_entrega")

    base: date | None = None
    if plazo_desde == "entrega":
        base = _parse_date(doc.get("fechaEntrega")) or _parse_date(doc.get("fechaCreacion"))
    else:
        base = _parse_date(doc.get("fechaCreacion"))

    if base is None:
        return None

    plazo = doc.get("plazoDias")
    if plazo is None:
        forma = (doc.get("formaPago") or "").lower()
        if "contado" in forma or not forma:
            plazo = 0 if contado_eq == "mismo_dia_entrega" else 1
        else:
            m = re.search(r"\d+", forma)
            plazo = int(m.group()) if m else 0

    from datetime import timedelta
    return base + timedelta(days=int(plazo))


def _calc_pagado(numero: int | str, comprobantes: list) -> float:
    total = 0.0
    for c in comprobantes:
        if not c.get("anulado") and str(c.get("cotizacionNumero")) == str(numero):
            total += float(c.get("valor") or 0)
    return total


def _enrich_doc(doc: dict, comprobantes: list, config: dict) -> dict:
    pagado = _calc_pagado(doc["numero"], comprobantes)
    total = float(doc.get("total") or 0)
    saldo = max(0.0, total - pagado)
    venc = _vencimiento(doc, config)
    hoy = date.today()
    dias: int | None = None
    if venc:
        dias = (hoy - venc).days
    estado_raw = doc.get("estado", "pedido")
    if estado_raw in ("anulada", "excluida"):
        estado_visual = "Anulada" if estado_raw == "anulada" else "Excluida"
    elif saldo <= 0:
        estado_visual = "Pagada"
    elif pagado > 0:
        estado_visual = "Abonada"
    elif dias is not None and dias > 0:
        estado_visual = f"Vencida {dias} d"
    else:
        estado_visual = "En cartera"
    return {
        **doc,
        "pagado": pagado,
        "saldo": saldo,
        "fechaVencimiento": venc.isoformat() if venc else None,
        "dias": dias,
        "estadoVisual": estado_visual,
    }


# ── PDF parser (Effi quotation format) ───────────────────────────────────────
def _parse_effi_pdf(content: bytes) -> list[dict]:
    """Parse an Effi quotation PDF. Returns a list of document dicts.
    Works on single PDFs and consolidated multi-quote PDFs.
    Since Effi generates structured PDFs, we use pdfplumber for reliable extraction.
    """
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        try:
            import pypdf as _pypdf  # type: ignore
            return _parse_effi_pypdf(content)
        except ImportError:
            raise HTTPException(500, "Instala pdfplumber o pypdf para leer PDFs en el servidor.")

    docs: list[dict] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    # Split by document boundary (Effi prints a header per quotation)
    # Common patterns: "Cotización No." "Cotizacion No." "COTIZACION" with a number
    doc_blocks = _split_effi_blocks(full_text)
    for block in doc_blocks:
        parsed = _parse_effi_block(block)
        if parsed:
            docs.append(parsed)
    return docs


def _split_effi_blocks(text: str) -> list[str]:
    """Split full PDF text into one block per quotation."""
    # Effi uses headers like "Cotización No. XXXX" or "COTIZACION No. XXXX"
    pattern = re.compile(r"(?=(?:Cotizaci[oó]n|COTIZACI[OÓ]N)\s+(?:No\.?|Nro\.?|#)\s*\d{3,})", re.IGNORECASE)
    parts = pattern.split(text)
    return [p.strip() for p in parts if p.strip()]


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _re_find(pattern: str, text: str, group: int = 1, flags: int = re.IGNORECASE) -> str | None:
    m = re.search(pattern, text, flags)
    return m.group(group).strip() if m else None


def _parse_effi_block(block: str) -> dict | None:
    anulada = bool(re.search(r"TRANSACCI[OÓ]N\s+ANULADA|ANULAD[AO]", block, re.IGNORECASE))

    # Number
    numero_str = _re_find(r"(?:Cotizaci[oó]n|COTIZACI[OÓ]N)\s+(?:No\.?|Nro\.?|#)\s*(\d{3,})", block)
    if not numero_str:
        return None
    numero = int(numero_str)

    # Dates — Effi format: dd/mm/yyyy or dd-mm-yyyy
    fecha_creacion = _re_find(r"Fecha\s*(?:de\s*)?(?:emisi[oó]n|creaci[oó]n|elaboraci[oó]n)?\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})", block)
    fecha_entrega = _re_find(r"(?:Fecha\s*(?:de\s*)?entrega|Entrega estimada)\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})", block)

    def norm_date(s: str | None) -> str | None:
        if not s:
            return None
        d = _parse_date(s)
        return d.isoformat() if d else None

    fecha_creacion = norm_date(fecha_creacion)
    fecha_entrega = norm_date(fecha_entrega)

    # Client
    cliente = _re_find(r"(?:Cliente|Se[ñn]or\(es\)|Comprador)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][^\n]{3,60})", block)
    cc_nit = _re_find(r"(?:NIT|CC|C\.C\.|Nit|RUC|Identificaci[oó]n)\s*[:\.\-]?\s*([\d\.\-]{5,20})", block)
    telefono = _re_find(r"(?:Tel[eé]fono|Cel|M[oó]vil|Tel\.)\s*[:\-]?\s*([\d\s\-\+]{7,15})", block)
    correo = _re_find(r"(?:Correo|Email|E-mail)\s*[:\-]?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})", block)
    ciudad = _re_find(r"(?:Ciudad|Municipio)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ\s]{2,30})", block)

    # Staff
    vendedor = _re_find(r"(?:Vendedor|Asesor|Comercial)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][^\n]{2,40})", block)
    elaborado_por = _re_find(r"(?:Elaborado por|Elabor[oó]|Creado por)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][^\n]{2,40})", block)

    # Project/club
    club = _re_find(r"(?:Proyecto|Club|Referencia|Descripci[oó]n del proyecto)\s*[:\-]?\s*([^\n]{3,60})", block)

    # Payment terms
    forma_pago = _re_find(r"(?:Forma de pago|Condiciones de pago|Plazo)\s*[:\-]?\s*([^\n]{3,40})", block)
    plazo_dias: int | None = None
    if forma_pago:
        m = re.search(r"(\d+)\s*d[ií]as?", forma_pago, re.IGNORECASE)
        if m:
            plazo_dias = int(m.group(1))
        elif re.search(r"contado", forma_pago, re.IGNORECASE):
            plazo_dias = 0

    # Totals — Effi shows "Total: $X" or "TOTAL $X" at the bottom
    total_str = _re_find(r"(?:TOTAL|Total general|Total cotizaci[oó]n)\s*[:\$]?\s*\$?\s*([\d\.,]+)", block)
    total: float = 0.0
    if total_str:
        total = float(re.sub(r"[^\d]", "", total_str) or "0")

    iva_str = _re_find(r"IVA\s*(?:19\s*%?)?\s*[:\$]?\s*\$?\s*([\d\.,]+)", block)
    iva: float | None = None
    if iva_str:
        iva = float(re.sub(r"[^\d]", "", iva_str) or "0")

    # Items — look for table rows: reference qty unit_price total
    items = _parse_effi_items(block)
    unidades = sum(int(i.get("cantidad") or 0) for i in items)

    # Validation: sum of items vs total
    items_sum = sum(float(i.get("total") or 0) for i in items)
    revisar = bool(items) and abs(items_sum - total) > 1.0

    now = datetime.now(timezone.utc).isoformat()
    return {
        "numero": numero,
        "fechaCreacion": fecha_creacion,
        "fechaEntrega": fecha_entrega,
        "cliente": cliente or "",
        "ccNit": cc_nit or "",
        "telefono": telefono or "",
        "correo": correo or "",
        "ciudad": ciudad or "",
        "vendedor": vendedor or "",
        "elaboradoPor": elaborado_por or "",
        "club": club or "",
        "formaPago": forma_pago or "",
        "plazoDias": plazo_dias,
        "total": total,
        "iva": iva,
        "unidades": unidades,
        "items": items,
        "estado": "anulada" if anulada else "pedido",
        "revisar": revisar,
        "notas": "",
        "historial": [{"accion": "Cargado desde PDF", "usuario": "sistema", "fecha": now}],
    }


def _parse_effi_items(block: str) -> list[dict]:
    """Extract line items from Effi table block."""
    items: list[dict] = []
    # Effi table rows typically look like:
    # REFERENCIA    DESCRIPCION    CANT    P.UNIT    TOTAL
    # A11400-100    SUBLIMADA...   10      $50.000   $500.000
    # Try to find rows with: code, optionally description, quantity, unit price, total
    pattern = re.compile(
        r"([A-Z0-9\-]{3,20})"          # referencia
        r"[\s\S]{0,80}?"               # descripción (opcional)
        r"(\d{1,4})"                   # cantidad
        r"\s+\$?\s*([\d\.,]+)"         # precio unitario
        r"\s+\$?\s*([\d\.,]+)",        # total
        re.MULTILINE,
    )
    seen: set[str] = set()
    for m in pattern.finditer(block):
        ref = m.group(1).strip()
        # Avoid headers
        if _strip_accents(ref.upper()) in {"REFERENCIA", "CODIGO", "COD", "ITEM", "ARTICULO"}:
            continue
        qty_str = m.group(2)
        unit_str = re.sub(r"[^\d]", "", m.group(3))
        total_str = re.sub(r"[^\d]", "", m.group(4))
        key = f"{ref}|{qty_str}"
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "referencia": ref,
            "cantidad": int(qty_str),
            "precioUnitario": float(unit_str) if unit_str else 0.0,
            "total": float(total_str) if total_str else 0.0,
        })
    return items


def _parse_effi_pypdf(content: bytes) -> list[dict]:
    """Fallback parser using pypdf."""
    import pypdf  # type: ignore
    reader = pypdf.PdfReader(io.BytesIO(content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    blocks = _split_effi_blocks(text)
    return [d for b in blocks if (d := _parse_effi_block(b)) is not None]


# ── Register routes ───────────────────────────────────────────────────────────
def register_cartera(app, authenticate):
    directory = Path(__file__).parent

    @app.get("/cartera", response_class=__import__("fastapi.responses", fromlist=["HTMLResponse"]).HTMLResponse)
    def cartera_spa(_=Depends(authenticate)):
        html_file = directory / "cartera.html"
        try:
            return html_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise HTTPException(404, "cartera.html not found")

    @app.get("/api/cartera/datos")
    def cartera_get(_=Depends(authenticate)):
        with _LOCK:
            data = _load()
        config = data.get("config", DEFAULT_DATA["config"])
        docs = [_enrich_doc(d, data.get("comprobantes", []), config) for d in data.get("documentos", [])]
        return {
            "config": config,
            "usuarios": data.get("usuarios", DEFAULT_DATA["usuarios"]),
            "documentos": docs,
            "comprobantes": data.get("comprobantes", []),
            "contadorComprobante": data.get("contadorComprobante", 1),
        }

    @app.put("/api/cartera/config")
    def cartera_config_put(body: dict = Body(...), _=Depends(authenticate)):
        allowed = {"plazoDesde", "contadoEquivale", "anticipoMinimoPct"}
        with _LOCK:
            data = _load()
            data.setdefault("config", {}).update({k: v for k, v in body.items() if k in allowed})
            _save(data)
        return {"ok": True}

    @app.put("/api/cartera/usuarios")
    def cartera_usuarios_put(body: dict = Body(...), _=Depends(authenticate)):
        usuarios = body.get("usuarios", [])
        if not isinstance(usuarios, list):
            raise HTTPException(422, "usuarios debe ser una lista")
        with _LOCK:
            data = _load()
            data["usuarios"] = [str(u).strip().upper() for u in usuarios if str(u).strip()]
            _save(data)
        return {"ok": True}

    @app.post("/api/cartera/documentos")
    def cartera_doc_post(body: dict = Body(...), _=Depends(authenticate)):
        numero = body.get("numero")
        if not numero:
            raise HTTPException(422, "El campo 'numero' es obligatorio")
        numero = int(numero)
        now = datetime.now(timezone.utc).isoformat()
        with _LOCK:
            data = _load()
            existing = next((i for i, d in enumerate(data.get("documentos", [])) if d.get("numero") == numero), None)
            doc = {
                "numero": numero,
                "fechaCreacion": body.get("fechaCreacion"),
                "fechaEntrega": body.get("fechaEntrega"),
                "cliente": body.get("cliente", ""),
                "ccNit": body.get("ccNit", ""),
                "telefono": body.get("telefono", ""),
                "correo": body.get("correo", ""),
                "ciudad": body.get("ciudad", ""),
                "vendedor": body.get("vendedor", ""),
                "elaboradoPor": body.get("elaboradoPor", ""),
                "club": body.get("club", ""),
                "formaPago": body.get("formaPago", ""),
                "plazoDias": body.get("plazoDias"),
                "total": float(body.get("total") or 0),
                "iva": body.get("iva"),
                "unidades": int(body.get("unidades") or 0),
                "items": body.get("items", []),
                "estado": body.get("estado", "pedido"),
                "revisar": bool(body.get("revisar", False)),
                "notas": body.get("notas", ""),
                "historial": body.get("historial", [{"accion": "Creado manualmente", "usuario": str(_), "fecha": now}]),
            }
            if existing is not None:
                old = data["documentos"][existing]
                doc["historial"] = old.get("historial", []) + [{"accion": "Actualizado", "usuario": str(_), "fecha": now}]
                data["documentos"][existing] = doc
            else:
                data.setdefault("documentos", []).append(doc)
            _save(data)
        return {"ok": True, "numero": numero}

    @app.put("/api/cartera/documentos/{numero}")
    def cartera_doc_put(numero: int, body: dict = Body(...), _=Depends(authenticate)):
        now = datetime.now(timezone.utc).isoformat()
        allowed = {"fechaCreacion", "fechaEntrega", "cliente", "ccNit", "telefono", "correo",
                   "ciudad", "vendedor", "elaboradoPor", "club", "formaPago", "plazoDias",
                   "total", "iva", "unidades", "items", "estado", "revisar", "notas"}
        with _LOCK:
            data = _load()
            doc = next((d for d in data.get("documentos", []) if d.get("numero") == numero), None)
            if not doc:
                raise HTTPException(404, "Documento no encontrado")
            for k, v in body.items():
                if k in allowed:
                    doc[k] = v
            doc.setdefault("historial", []).append({"accion": "Editado", "usuario": str(_), "fecha": now})
            _save(data)
        return {"ok": True}

    @app.post("/api/cartera/comprobantes")
    def cartera_comp_post(body: dict = Body(...), _=Depends(authenticate)):
        valor = float(body.get("valor") or 0)
        if valor <= 0:
            raise HTTPException(422, "El valor debe ser mayor que cero")
        cot_num = body.get("cotizacionNumero")
        if not cot_num:
            raise HTTPException(422, "Falta el número de cotización")
        now = datetime.now(timezone.utc).isoformat()
        with _LOCK:
            data = _load()
            config = data.get("config", DEFAULT_DATA["config"])
            # Validate saldo
            doc = next((d for d in data.get("documentos", []) if str(d.get("numero")) == str(cot_num)), None)
            if doc:
                pagado = _calc_pagado(cot_num, data.get("comprobantes", []))
                saldo = max(0.0, float(doc.get("total") or 0) - pagado)
                if valor > saldo + 0.01 and body.get("tipo") != "Anticipo":
                    raise HTTPException(422, f"El valor (${valor:,.0f}) supera el saldo (${saldo:,.0f})")
            n = data.get("contadorComprobante", 1)
            comp_id = f"CI-{n:04d}"
            comp = {
                "id": comp_id,
                "fecha": body.get("fecha") or date.today().isoformat(),
                "cotizacionNumero": str(cot_num),
                "cliente": body.get("cliente", doc.get("cliente", "") if doc else ""),
                "medio": body.get("medio", ""),
                "referencia": body.get("referencia", ""),
                "valor": valor,
                "tipo": body.get("tipo", "Abono"),
                "recibio": body.get("recibio", str(_)),
                "anulado": False,
                "motivoAnulacion": "",
                "editado": False,
                "historial": [{"accion": "Creado", "usuario": str(_), "fecha": now}],
            }
            data.setdefault("comprobantes", []).append(comp)
            data["contadorComprobante"] = n + 1
            _save(data)
        return {"ok": True, "id": comp_id}

    @app.put("/api/cartera/comprobantes/{comp_id}")
    def cartera_comp_put(comp_id: str, body: dict = Body(...), _=Depends(authenticate)):
        now = datetime.now(timezone.utc).isoformat()
        with _LOCK:
            data = _load()
            comp = next((c for c in data.get("comprobantes", []) if c.get("id") == comp_id), None)
            if not comp:
                raise HTTPException(404, "Comprobante no encontrado")
            anular = body.get("anular")
            restaurar = body.get("restaurar")
            if anular:
                comp["anulado"] = True
                comp["motivoAnulacion"] = body.get("motivo", "")
                comp.setdefault("historial", []).append({"accion": "Anulado", "usuario": str(_), "fecha": now})
            elif restaurar:
                comp["anulado"] = False
                comp["motivoAnulacion"] = ""
                comp.setdefault("historial", []).append({"accion": "Restaurado", "usuario": str(_), "fecha": now})
            else:
                allowed = {"fecha", "medio", "referencia", "valor", "tipo", "recibio"}
                for k, v in body.items():
                    if k in allowed:
                        comp[k] = v
                comp["editado"] = True
                comp.setdefault("historial", []).append({"accion": "Editado", "usuario": str(_), "fecha": now})
            _save(data)
        return {"ok": True}

    @app.post("/api/cartera/cargar-pdf")
    async def cartera_cargar_pdf(
        files: list[UploadFile] = File(...),
        modo: str = "omitir",
        usuario: str = "",
        _=Depends(authenticate),
    ):
        now = datetime.now(timezone.utc).isoformat()
        stats = {"nuevas": 0, "omitidas": 0, "actualizadas": 0, "anuladas": 0, "revisar": 0, "errores": []}
        parsed_docs: list[dict] = []
        for upload in files:
            try:
                content = await upload.read()
                docs = _parse_effi_pdf(content)
                parsed_docs.extend(docs)
            except Exception as exc:
                stats["errores"].append(f"{upload.filename}: {exc}")

        with _LOCK:
            data = _load()
            existing_map = {d["numero"]: i for i, d in enumerate(data.get("documentos", []))}
            for doc in parsed_docs:
                n = doc["numero"]
                if n in existing_map:
                    if modo == "reemplazar":
                        old = data["documentos"][existing_map[n]]
                        doc["historial"] = old.get("historial", []) + [
                            {"accion": "Reemplazado por PDF", "usuario": usuario or str(_), "fecha": now}
                        ]
                        # Keep payments and manually set estado if not anulada
                        if old.get("estado") not in ("anulada", "excluida") and doc.get("estado") != "anulada":
                            doc["estado"] = old.get("estado", doc["estado"])
                        data["documentos"][existing_map[n]] = doc
                        stats["actualizadas"] += 1
                    else:
                        stats["omitidas"] += 1
                else:
                    doc["historial"] = [{"accion": "Cargado desde PDF", "usuario": usuario or str(_), "fecha": now}]
                    data.setdefault("documentos", []).append(doc)
                    if doc.get("estado") == "anulada":
                        stats["anuladas"] += 1
                    else:
                        stats["nuevas"] += 1
                if doc.get("revisar"):
                    stats["revisar"] += 1
            _save(data)
        return stats

    @app.get("/api/cartera/exportar")
    def cartera_exportar(_=Depends(authenticate)):
        with _LOCK:
            data = _load()
        config = data.get("config", DEFAULT_DATA["config"])
        docs = [_enrich_doc(d, data.get("comprobantes", []), config) for d in data.get("documentos", [])]

        output = io.StringIO()
        output.write("﻿")  # UTF-8 BOM for Excel
        writer = csv.writer(output, delimiter=";")
        writer.writerow([
            "N°", "CLIENTE", "CC/NIT", "CIUDAD", "VENDEDOR", "CLUB",
            "CREACIÓN", "ENTREGA", "FORMA DE PAGO", "VENCE", "DÍAS",
            "TOTAL", "PAGADO", "SALDO", "ESTADO",
        ])
        for d in docs:
            writer.writerow([
                d.get("numero", ""),
                d.get("cliente", ""),
                d.get("ccNit", ""),
                d.get("ciudad", ""),
                d.get("vendedor", ""),
                d.get("club", ""),
                d.get("fechaCreacion", "") or "",
                d.get("fechaEntrega", "") or "",
                d.get("formaPago", "") or "",
                d.get("fechaVencimiento", "") or "",
                d.get("dias", ""),
                d.get("total", 0),
                d.get("pagado", 0),
                d.get("saldo", 0),
                d.get("estadoVisual", ""),
            ])

        csv_bytes = output.getvalue().encode("utf-8")
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="cartera.csv"'},
        )

    @app.get("/api/cartera/respaldo")
    def cartera_respaldo(_=Depends(authenticate)):
        with _LOCK:
            data = _load()
        content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="cartera-{ts}.json"'},
        )

    @app.post("/api/cartera/restaurar")
    async def cartera_restaurar(file: UploadFile = File(...), _=Depends(authenticate)):
        content = await file.read()
        try:
            new_data = json.loads(content)
            if "documentos" not in new_data:
                raise ValueError("JSON inválido: falta la clave 'documentos'")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(422, f"Archivo inválido: {exc}")
        with _LOCK:
            _save(new_data)
        return {"ok": True, "documentos": len(new_data.get("documentos", []))}
