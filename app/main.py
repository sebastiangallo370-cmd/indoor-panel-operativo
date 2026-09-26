import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from openpyxl import load_workbook

from app.excel_linux import crear_excel_listado
from app.excel_mockups import listing_designs
from app.uploaded_mockups import sync_order_uploads, require_mockup_upload
from app import sheets_sync
from app.creator_xlsx import _data_from_source, create_from_images, create_from_sheet_bundle, normalize_output_name
from app.settings import STATE_DIR, UPLOAD_DIR, prepare_pedidos_runtime, prepare_runtime

import monitor_archivos as legacy
import pedidos_legacy as pedidos

legacy.crear_excel_listado = crear_excel_listado
CONFIG = prepare_runtime()
PEDIDOS_CONFIG = prepare_pedidos_runtime()
pedidos.CONFIG_PATH = STATE_DIR / "pedidos_config.json"
DB_PATH = STATE_DIR / "jobs.sqlite3"
security = HTTPBasic(auto_error=False)
app = FastAPI(title="Asistente de Reprogramaciones", version="1.0.0")
PRODUCTION_START_ROW = 726
PRODUCTION_CACHE = {"at": 0.0, "data": None}
PRODUCTION_CACHE_LOCK = threading.Lock()
LOGO_FILE = Path(__file__).resolve().parent / "indoor-logo.png"
LOGO_SVG_FILE = Path(__file__).resolve().parent / "indoor-logo.svg"
FAVICON_FILE = Path(__file__).resolve().parent / "favicon.png"
FAVICON_SVG_FILE = Path(__file__).resolve().parent / "favicon.svg"


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        order_number TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
        )"""
    )
    columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
    if "kind" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'reprogramacion'")
    if "result_file" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN result_file TEXT")
    if "progress" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
    if "input_summary" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN input_summary TEXT")
    db.execute(
        """CREATE TABLE IF NOT EXISTS production_rows (
        source_row INTEGER PRIMARY KEY,
        values_json TEXT NOT NULL
        )"""
    )
    db.execute("""CREATE TABLE IF NOT EXISTS production_notes (
        source_row INTEGER NOT NULL, column_number INTEGER NOT NULL,
        note TEXT NOT NULL, username TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(source_row, column_number)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_rework (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, process TEXT NOT NULL,
        reason TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_started (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_finished (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    production_columns = {row[1] for row in db.execute("PRAGMA table_info(production_rows)")}
    if "sort_order" not in production_columns:
        db.execute("ALTER TABLE production_rows ADD COLUMN sort_order INTEGER")
        db.execute("UPDATE production_rows SET sort_order = source_row WHERE sort_order IS NULL")
    db.execute(
        """CREATE TABLE IF NOT EXISTS production_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        process TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
        )"""
    )
    db.commit()
    return db


def _session_signature(value: str) -> str:
    secret = os.getenv("APP_SESSION_SECRET") or (os.getenv("APP_PASSWORD", "") + "|indoor-session")
    return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(username: str) -> str:
    payload = f"{username}|{int(time.time()) + 43200}"
    signed = f"{payload}|{_session_signature(payload)}"
    return base64.urlsafe_b64encode(signed.encode("utf-8")).decode("ascii")


def password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)
    return base64.urlsafe_b64encode(salt).decode("ascii") + "$" + base64.urlsafe_b64encode(digest).decode("ascii")


def password_matches(password: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def account_exists(username: str) -> bool:
    if username == os.getenv("APP_USER", "indoor"):
        return True
    with connect() as db:
        return db.execute("SELECT 1 FROM users WHERE name=? COLLATE NOCASE", (username,)).fetchone() is not None


def session_username(token: str) -> str | None:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        username, expires, signature = decoded.rsplit("|", 2)
        payload = f"{username}|{expires}"
        if int(expires) >= int(time.time()) and secrets.compare_digest(signature, _session_signature(payload)) and account_exists(username):
            return username
    except (ValueError, TypeError, UnicodeError):
        pass
    return None


def authenticate(request: Request):
    session_token = request.cookies.get("indoor_session", "")
    username = session_username(session_token)
    if username:
        return username
    if request.url.path == "/":
        raise HTTPException(status_code=307, headers={"Location": "/login"})
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida")


def update_job(job_id: int, state: str, detail: str = "", order_number: str = ""):
    now = datetime.now(timezone.utc).isoformat()
    detail_lower = detail.lower()
    if state in ("COMPLETADO", "ERROR", "REVISAR"):
        progress = 100
    elif "validando" in detail_lower or "leyendo" in detail_lower:
        progress = 15
    elif "analizando" in detail_lower:
        progress = 30
    elif "generando" in detail_lower:
        progress = 40
    elif "creando la orden" in detail_lower or "sincronizando" in detail_lower:
        progress = 55
    else:
        progress = 5 if state == "RECIBIDO" else 10
    with connect() as db:
        db.execute(
            "UPDATE jobs SET status=?, detail=?, order_number=COALESCE(NULLIF(?, ''), order_number), "
            "progress=MAX(COALESCE(progress,0),?), updated_at=? WHERE id=?",
            (state, detail, order_number, progress, now, job_id),
        )


def update_job_progress(job_id: int, progress: int, detail: str):
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute(
            "UPDATE jobs SET status='PROCESANDO', detail=?, progress=?, updated_at=? WHERE id=?",
            (detail, max(1, min(99, int(progress))), now, job_id),
        )


def run_with_live_progress(job_id: int, start: int, ceiling: int, detail: str, operation):
    """Ejecuta una etapa bloqueante y publica avance visible mientras termina."""
    result, failure = [], []

    def worker():
        try:
            result.append(operation())
        except Exception as error:
            failure.append(error)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    progress = start
    update_job_progress(job_id, progress, detail)
    while thread.is_alive():
        thread.join(timeout=.75)
        if thread.is_alive() and progress < ceiling:
            progress += 1
            update_job_progress(job_id, progress, detail)
    if failure:
        raise failure[0]
    return result[0] if result else None


def append_local_production(record: dict, row_builder=None, observations: str = '', author: str = ''):
    """Registra una referencia directamente en la trazabilidad local."""
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        meta = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM production_meta")}
        headers = json.loads(meta.get("headers") or "[]")
        if not headers:
            raise RuntimeError("La base local de Producción no está inicializada")
        if row_builder:
            values = list(row_builder(record))
        else:
            values = [""] * len(headers)
        width = len(headers)
        values = (values + [""] * width)[:width]
        groups = json.loads(meta.get('groups') or '[]')
        values = fresh_production_values(values, headers, groups)
        # Never recycle a row identity, even if the last order was deleted.
        highest = max(PRODUCTION_START_ROW - 1, int(meta.get('last_allocated_row') or 0))
        for table in ('production_rows', 'production_notes', 'production_started', 'production_finished', 'production_rework', 'production_operator_events'):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                highest = max(highest, int(db.execute(f'SELECT COALESCE(MAX(source_row),0) FROM {table}').fetchone()[0]))
        source_row = highest + 1
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('last_allocated_row',?)", (str(source_row),))
        sort_order = int(db.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM production_rows").fetchone()[0])
        db.execute(
            "INSERT INTO production_rows(source_row, values_json, sort_order) VALUES (?, ?, ?)",
            (source_row, json.dumps(values, ensure_ascii=False), sort_order),
        )
        now = datetime.now(timezone.utc).isoformat()
        if observations.strip():
            # Save the programming instruction atomically with each new card.
            note_column = next((i + 1 for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), 1)
            db.execute('INSERT INTO production_notes(source_row,column_number,note,username,updated_at) VALUES(?,?,?,?,?)',
                       (source_row, note_column, observations.strip(), author, now))
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return source_row
    finally:
        db.close()


def verify_order_mockups(order_dir, records):
    """Use the same reader as cards; never publish a reference without a design."""
    files = [p for p in Path(order_dir).iterdir() if p.is_file() and not p.is_symlink()]
    if not records:
        raise ValueError('No hay referencias para programar')
    for record in records:
        reference = str(record.get('referencia') or '').strip()
        designs, status = listing_designs(files, reference)
        if not designs:
            raise ValueError(f'No se programó la tarjeta: falta el mockup de {reference}. {status}. '
                             'Sube la imagen con la referencia correcta en el nombre y vuelve a procesar.')


def process_job(job_id: int, pdf_path: Path, extra_paths: list[Path], observations: str = '', author: str = ''):
    try:
        pending_records = []
        parsed = run_with_live_progress(
            job_id, 8, 34, "Leyendo y verificando el PDF",
            lambda: legacy.extraer_info_pdf(str(pdf_path)),
        )
        _, header, _, warnings = parsed
        order_number = header.get("orden") or legacy.extraer_prefijo_numero_nombre(pdf_path.name)[1]
        if not order_number:
            raise ValueError("No se pudo identificar el número de orden")
        update_job_progress(job_id, 36, "Preparando la orden " + order_number)
        ok = run_with_live_progress(
            job_id, 38, 92, "Creando archivos y registrando en Producción local",
            lambda: legacy.procesar_orden(
                order_number, str(pdf_path), CONFIG,
                production_writer=lambda record: pending_records.append(dict(record)),
                write_google_sheets=False,
            ),
        )
        if ok:
            cliente = legacy.sanitize(header.get("cliente") or "")
            proyecto = legacy.sanitize(header.get("proyecto") or "")
            order_dir = Path(CONFIG["ruta_nas_clientes"]) / cliente / f"{order_number}_{proyecto}"
            copied = 0
            for extra_path in extra_paths:
                update_job_progress(job_id, min(98, 93 + copied), "Copiando imágenes anexas a la orden")
                # Las imagenes usadas para crear el Excel ya fueron copiadas y
                # eliminadas por el procesador. Las restantes tambien se anexan.
                if extra_path.exists():
                    legacy.copiar_archivo(str(extra_path), str(order_dir))
                    extra_path.unlink()
                copied += 1
            detail = "NAS y trazabilidad local de Producción actualizados"
            inserted, image_issues = sync_order_uploads(order_dir, STATE_DIR / 'mockup-backups', uploaded_names={p.name for p in extra_paths})
            detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
            if image_issues:
                detail += ". Revisar imágenes: " + " | ".join(image_issues)
            if copied:
                detail += f". {copied} imagen(es) anexada(s) a la orden"
            if warnings:
                detail += ". Avisos: " + " | ".join(warnings)
            if image_issues:
                raise ValueError('No se programó: ' + ' | '.join(image_issues))
            verify_order_mockups(order_dir, pending_records)
            for record in pending_records:
                append_local_production(record, legacy._fila_produccion, observations, author)
            update_job(job_id, "COMPLETADO", detail, order_number)
        else:
            update_job(job_id, "REVISAR", "El documento incumple una regla de negocio", order_number)
    except Exception as error:
        logging.exception("Error procesando trabajo %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_reprogram_excel_job(job_id: int, excel_path: Path, extra_paths: list[Path], observations: str = '', author: str = ''):
    try:
        update_job_progress(job_id, 8, "Leyendo el listado Excel")
        workbook = load_workbook(excel_path, read_only=True, data_only=True)
        sheets = [sheet for sheet in workbook.worksheets if sheet.title.upper() != "BASE_DATOS"]
        if not sheets:
            raise ValueError("El Excel no contiene pestañas de listado")
        first = sheets[0]
        cliente = str(first["K2"].value or "").strip()
        proyecto = str(first["K3"].value or "").strip()
        vendedor = str(first["K4"].value or "").strip()
        fecha_entrega = first["K5"].value
        if not cliente or not proyecto:
            raise ValueError("El Excel debe contener cliente en K2 y proyecto en K3")
        prefix, number = legacy.extraer_prefijo_numero_nombre(excel_path.name)
        if not number:
            raise ValueError("El nombre del Excel debe incluir el número CO#### o RM####")
        order_number = f"{prefix or 'CO'}{number}"
        update_job(job_id, "PROCESANDO", "Orden identificada desde el Excel", order_number)
        cliente_safe, proyecto_safe = legacy.sanitize(cliente), legacy.sanitize(proyecto)
        order_dir = Path(CONFIG["ruta_nas_clientes"]) / cliente_safe / f"{order_number}_{proyecto_safe}"
        update_job_progress(job_id, 24, "Creando la carpeta de la reprogramación")
        legacy.crear_carpeta(str(order_dir.parent))
        legacy.crear_carpeta(str(order_dir))
        for subfolder in ("APLIQUE (BORDADO,VINILOS,TRANSFER)", "CORTE PLT", "IMPRESION (NOMBRE MAQUINA)"):
            legacy.crear_carpeta(str(order_dir / subfolder))
        legacy.copiar_archivo(str(excel_path), str(order_dir))
        update_job_progress(job_id, 42, "Leyendo referencias y cantidades del Excel")
        records = []
        for sheet in sheets:
            reference = sheet.title.strip()
            quantity = 0
            for row in range(8, sheet.max_row + 1):
                if any(sheet.cell(row, column).value not in (None, "") for column in (3, 4, 5)):
                    quantity += 1
            if not reference or quantity == 0:
                continue
            records.append({
                "cliente": cliente_safe, "proyecto": proyecto_safe, "orden": order_number,
                "referencia": reference, "cantidad": str(quantity),
                "fecha_creacion": legacy.fecha_es(datetime.now()),
                "fecha_entrega": legacy.fecha_es(datetime.combine(fecha_entrega, datetime.min.time())) if hasattr(fecha_entrega, "year") else str(fecha_entrega or ""),
                "vendedor": vendedor, "tela": legacy.buscar_tela_por_ref(reference),
                "logo_texturizado": "NO",
            })
        workbook.close()
        if not records:
            raise ValueError("No se encontraron referencias con prendas en el Excel")
        update_job_progress(job_id, 58, "Actualizando clientes y referencias")
        legacy.guardar_cliente_supabase(cliente_safe, str(order_dir.parent))
        total_records = len(records)
        for index, record in enumerate(records, start=1):
            update_job_progress(job_id, 58 + int(index * 30 / total_records), f"Registrando referencia {index} de {total_records} en Producción local")
            legacy.guardar_referencia_supabase(record["referencia"], proyecto_safe)
        copied = 0
        for extra_path in extra_paths:
            update_job_progress(job_id, min(98, 90 + copied), "Copiando anexos de la reprogramación")
            if extra_path.exists():
                legacy.copiar_archivo(str(extra_path), str(order_dir))
                extra_path.unlink()
            copied += 1
        detail = "Excel archivado en NAS y reprogramación registrada en Producción local"
        inserted, image_issues = sync_order_uploads(order_dir, STATE_DIR / 'mockup-backups', uploaded_names={p.name for p in extra_paths})
        detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
        if image_issues:
            detail += ". Revisar imágenes: " + " | ".join(image_issues)
        if copied:
            detail += f". {copied} anexo(s) copiado(s)"
        if image_issues:
            raise ValueError('No se programó: ' + ' | '.join(image_issues))
        verify_order_mockups(order_dir, records)
        for record in records:
            append_local_production(record, legacy._fila_produccion, observations, author)
        update_job(job_id, "COMPLETADO", detail, order_number)
    except Exception as error:
        logging.exception("Error procesando reprogramación Excel %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_order_job(job_id: int, job_dir: Path, pdf_path: Path, excel_path: Path, observations: str = '', author: str = ''):
    try:
        pending_records = []
        # The legacy processor moves/removes attachments: remember them beforehand.
        uploaded_names = {p.name for p in job_dir.iterdir() if p.is_file() and p not in (pdf_path, excel_path)}
        update_job_progress(job_id, 8, "Validando la pareja PDF + Excel")
        pdf_prefix, pdf_number = pedidos.extraer_prefijo_numero_nombre(pdf_path.name)
        xls_prefix, xls_number = pedidos.extraer_prefijo_numero_nombre(excel_path.name)
        if not pdf_number or not xls_number:
            raise ValueError("El PDF y el Excel deben incluir el numero CO#### o RM#### en el nombre")
        if (pdf_prefix, pdf_number) != (xls_prefix, xls_number):
            raise ValueError("El PDF y el Excel no corresponden a la misma orden")
        order_number = f"{pdf_prefix}{pdf_number}"
        update_job(job_id, "PROCESANDO", "Orden identificada. Preparando archivos", order_number)
        update_job_progress(job_id, 18, "Preparando la orden " + order_number)
        ok = run_with_live_progress(
            job_id, 20, 93, "Creando la orden y registrando en Producción local",
            lambda: pedidos.procesar_orden(
                order_number, str(pdf_path), str(excel_path), PEDIDOS_CONFIG,
                production_writer=lambda record: pending_records.append(dict(record)),
                write_google_sheets=False,
            ),
        )
        if ok:
            copied = 0
            for attachment in job_dir.iterdir():
                if not attachment.is_file() or attachment in (pdf_path, excel_path):
                    continue
                update_job_progress(job_id, min(98, 94 + copied), "Copiando anexos del pedido")
                pedidos.copiar_archivo(str(attachment), str(ok))
                uploaded_names.add(attachment.name)
                attachment.unlink()
                copied += 1
            detail = "Pedido creado en NAS y registrado en Producción local"
            inserted, image_issues = sync_order_uploads(Path(ok), STATE_DIR / 'mockup-backups', uploaded_names=uploaded_names)
            detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
            if image_issues:
                detail += ". Revisar imágenes: " + " | ".join(image_issues)
            if copied:
                detail += f". {copied} anexo(s) copiado(s)"
            if image_issues:
                raise ValueError('No se programó: ' + ' | '.join(image_issues))
            verify_order_mockups(Path(ok), pending_records)
            for record in pending_records:
                append_local_production(record, pedidos._fila_produccion, observations, author)
            update_job(job_id, "COMPLETADO", detail, order_number)
        else:
            update_job(job_id, "REVISAR", "El pedido incumple una regla de negocio", order_number)
    except Exception as error:
        logging.exception("Error procesando pedido normal %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_creator_job(job_id: int, data_image: Path, images: list[tuple[int, Path]], output_name: str, sheet_name: str = ""):
    try:
        update_job(job_id, "PROCESANDO", "La IA esta analizando las imagenes")
        output = create_from_images(
            data_image=data_image, images=images, output_dir=STATE_DIR / "generated",
            output_name=output_name, sheet_name=sheet_name,
            progress_callback=lambda value, detail: update_job_progress(job_id, value, detail),
        )
        now = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute(
                "UPDATE jobs SET status=?, detail=?, result_file=?, progress=100, updated_at=? WHERE id=?",
                ("COMPLETADO", "Listado XLSX creado. Ya puedes descargarlo", str(output), now, job_id),
            )
    except Exception as error:
        logging.exception("Error creando XLSX %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_creator_bundle_job(job_id: int, sheets: list[dict], output_name: str):
    try:
        update_job(job_id, "PROCESANDO", f"Analizando {len(sheets)} pestaña(s) de Excel")
        output = create_from_sheet_bundle(
            sheets=sheets, output_dir=STATE_DIR / "generated", output_name=output_name,
            progress_callback=lambda value, detail: update_job_progress(job_id, value, detail),
        )
        now = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute(
                "UPDATE jobs SET status=?, detail=?, result_file=?, progress=100, updated_at=? WHERE id=?",
                ("COMPLETADO", f"Libro creado con {len(sheets)} pestaña(s). Ya puedes descargarlo", str(output), now, job_id),
            )
    except Exception as error:
        logging.exception("Error creando XLSX con varias pestañas %s", job_id)
        update_job(job_id, "ERROR", str(error))


@app.on_event("startup")
def startup():
    with connect():
        pass
    legacy.setup_logging(CONFIG["log_file"])
    sheets_sync.start(connect, legacy.get_gspread, STATE_DIR)


@app.get("/salud")
def health():
    nas = Path(CONFIG["ruta_nas_clientes"])
    db = connect()
    local_rows = db.execute("SELECT COUNT(*) FROM production_rows").fetchone()[0]
    db.close()
    return {
        "estado": "ok",
        "nas_disponible": nas.is_dir(),
        "produccion_local": local_rows,
        "pedidos_habilitados": True,
    }


INPUT_CONTRAST_STYLE = """<style id="indoor-input-contrast">
/* Keep typed and autofilled text legible, including focused browser autofill. */
input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, select {
  color-scheme:dark; background-color:#25312a!important; color:#f4f7f2!important;
  -webkit-text-fill-color:#f4f7f2!important; caret-color:#e0fc82!important;
}
input::placeholder,textarea::placeholder {color:#b8c4bb!important;-webkit-text-fill-color:#b8c4bb!important;opacity:1}
input:autofill,input:autofill:hover,input:autofill:focus,input:autofill:active {
  background-color:#25312a!important;color:#f4f7f2!important;
  box-shadow:0 0 0 1000px #25312a inset!important;
}
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active {
  -webkit-text-fill-color:#f4f7f2!important;caret-color:#e0fc82!important;
  -webkit-box-shadow:0 0 0 1000px #25312a inset!important;box-shadow:0 0 0 1000px #25312a inset!important;
}
input:focus-visible,textarea:focus-visible,select:focus-visible {outline:2px solid #d4ec98!important;outline-offset:2px}
input::selection,textarea::selection {background:#d4ec98;color:#142014;-webkit-text-fill-color:#142014}
select option {background:#25312a;color:#f4f7f2}
</style>"""


def login_page(error: str = "") -> str:
    template = Path(__file__).with_name("login.html").read_text(encoding="utf-8")
    return template.replace("__LOGIN_ERROR__", escape(error)).replace('</head>', INPUT_CONTRAST_STYLE + '</head>')


@app.get("/login-sport.jpg")
def login_sport_image():
    return FileResponse(Path(__file__).with_name("login-sport.jpg"), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    if session_username(request.cookies.get("indoor_session", "")):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(login_page())


@app.post("/login")
def login_submit(username: str = Form(...), password: str = Form(...)):
    expected_user = os.getenv("APP_USER", "indoor")
    expected_password = os.getenv("APP_PASSWORD", "")
    with connect() as db:
        user = db.execute("SELECT name, password_hash FROM users WHERE name = ? COLLATE NOCASE", (username.strip(),)).fetchone()
    valid = bool(user) and password_matches(password, user["password_hash"])
    if not user:
        valid = secrets.compare_digest(username.strip(), expected_user)
        valid &= bool(expected_password) and secrets.compare_digest(password, expected_password)
    if not valid:
        return HTMLResponse(login_page("Usuario o contraseña incorrectos."), status_code=401)
    response = RedirectResponse("/", status_code=303)
    session_name = user["name"] if user and password_matches(password, user["password_hash"]) else expected_user
    response.set_cookie("indoor_session", create_session_token(session_name), max_age=43200, httponly=True, secure=True, samesite="lax")
    return response


def register_page(error: str = "") -> str:
    template = Path(__file__).with_name('register.html').read_text(encoding='utf-8')
    return template.replace('__REGISTER_ERROR__', escape(error)).replace('</head>', INPUT_CONTRAST_STYLE + '</head>')


@app.get("/registro", response_class=HTMLResponse)
def register_form(request: Request):
    if session_username(request.cookies.get("indoor_session", "")):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(register_page())


@app.post("/registro")
def register_submit(name: str = Form(...), process: str = Form(...), password: str = Form(...)):
    clean_name = " ".join(name.split())
    clean_process = " ".join(process.split())
    if len(clean_name) < 3 or len(clean_process) < 2:
        return HTMLResponse(register_page("Completa el nombre y el proceso del operario."), status_code=400)
    if len(password) < 6:
        return HTMLResponse(register_page("La contraseña debe tener al menos 6 caracteres."), status_code=400)
    try:
        with connect() as db:
            db.execute(
                "INSERT INTO users(name, process, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (clean_name, clean_process, password_hash(password), datetime.now(timezone.utc).isoformat()),
            )
    except sqlite3.IntegrityError:
        return HTMLResponse(register_page("Ya existe un operario registrado con ese nombre."), status_code=409)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie("indoor_session", create_session_token(clean_name), max_age=43200, httponly=True, secure=True, samesite="lax")
    return response


@app.get("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie("indoor_session")
    return response


@app.get("/marca-indoor.png")
def indoor_brand():
    return FileResponse(LOGO_FILE, media_type="image/png")


@app.get("/marca-indoor.svg")
def indoor_brand_svg():
    return FileResponse(LOGO_SVG_FILE, media_type="image/svg+xml")


@app.get("/favicon.png")
def indoor_favicon():
    return FileResponse(FAVICON_FILE, media_type="image/png")


@app.get("/favicon.svg")
def indoor_favicon_svg():
    return FileResponse(FAVICON_SVG_FILE, media_type="image/svg+xml")


@app.get("/trace-ui.js")
def trace_ui_script():
    return FileResponse(Path(__file__).with_name("trace-ui.js"), media_type="application/javascript")


@app.get("/manifest.webmanifest")
def web_manifest():
    """Permite instalar el panel en el teléfono y abrirlo a pantalla completa, sin barras del navegador."""
    return JSONResponse({
        "name": "Indoor Sport · Panel operativo",
        "short_name": "Indoor",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#050605",
        "theme_color": "#050605",
        "icons": [
            {"src": "/favicon.svg?v=6", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
            {"src": "/favicon.png", "sizes": "64x64", "type": "image/png"},
        ],
    }, media_type="application/manifest+json")


def read_production_sheet() -> dict:
    """Lee la línea de producción desde la fila 726 sin modificar Google Sheets."""
    now = time.time()
    with PRODUCTION_CACHE_LOCK:
        cached = PRODUCTION_CACHE.get("data")
        if cached and now - float(PRODUCTION_CACHE.get("at") or 0) < 45:
            return cached
        worksheet = legacy.get_gspread()
        last_row = max(PRODUCTION_START_ROW, int(worksheet.row_count or PRODUCTION_START_ROW))
        ranges = ["A2:CE3"]
        for start in range(PRODUCTION_START_ROW, last_row + 1, 250):
            ranges.append(f"A{start}:CE{min(start + 249, last_row)}")
        blocks = worksheet.batch_get(ranges)
        heading_rows = blocks[0] if blocks else []
        groups = list(heading_rows[0]) if heading_rows else []
        headers = list(heading_rows[1]) if len(heading_rows) > 1 else []
        width = max(len(groups), len(headers), 83)
        groups += [""] * (width - len(groups))
        headers += [""] * (width - len(headers))
        current_group = "GENERAL"
        normalized_groups = []
        for value in groups:
            if str(value or "").strip():
                current_group = str(value).strip()
            normalized_groups.append(current_group)
        normalized_headers = [
            str(value or "").strip() or f"COLUMNA {index + 1}"
            for index, value in enumerate(headers)
        ]
        rows = []
        for range_name, block in zip(ranges[1:], blocks[1:]):
            source_row = int(re.search(r"A(\d+)", range_name).group(1))
            for offset, raw in enumerate(block):
                row = list(raw) + [""] * (width - len(raw))
                if any(str(value or "").strip() for value in row):
                    rows.append({"source_row": source_row + offset, "values": row[:width]})
        data = {
            "sheet": worksheet.title,
            "start_row": PRODUCTION_START_ROW,
            "groups": normalized_groups,
            "headers": normalized_headers,
            "rows": rows,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        PRODUCTION_CACHE.update({"at": now, "data": data})
        return data


def import_production_from_google() -> dict:
    """Importación administrativa de una sola vez; la web no llama esta función."""
    with PRODUCTION_CACHE_LOCK:
        PRODUCTION_CACHE.update({"at": 0.0, "data": None})
    data = read_production_sheet()
    db = connect()
    try:
        db.execute("DELETE FROM production_rows")
        db.executemany(
            "INSERT INTO production_rows(source_row, values_json, sort_order) VALUES (?, ?, ?)",
            [(int(row["source_row"]), json.dumps(row["values"], ensure_ascii=False), index) for index, row in enumerate(data["rows"], start=1)],
        )
        meta = {
            "sheet": data.get("sheet", "PRODUCCIÓN LOCAL"),
            "start_row": str(data.get("start_row", PRODUCTION_START_ROW)),
            "groups": json.dumps(data.get("groups", []), ensure_ascii=False),
            "headers": json.dumps(data.get("headers", []), ensure_ascii=False),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        db.executemany(
            "INSERT OR REPLACE INTO production_meta(key, value) VALUES (?, ?)",
            list(meta.items()),
        )
        db.commit()
        return {"rows": len(data["rows"]), "updated_at": meta["updated_at"]}
    finally:
        db.close()


def parse_production_date(value: str):
    text = str(value or "").strip().lower().replace(".", "")
    if not text:
        return None
    months = {
        "ene": 1, "enero": 1, "jan": 1, "feb": 2, "febrero": 2,
        "mar": 3, "marzo": 3, "abr": 4, "abril": 4, "apr": 4,
        "may": 5, "mayo": 5, "jun": 6, "junio": 6, "jul": 7,
        "julio": 7, "ago": 8, "agosto": 8, "aug": 8, "sept": 9,
        "sep": 9, "septiembre": 9, "oct": 10, "octubre": 10,
        "nov": 11, "noviembre": 11, "dic": 12, "diciembre": 12, "dec": 12,
    }
    match = re.fullmatch(r"(\d{1,2})[-/\s]([a-záéíóú]+|\d{1,2})[-/\s](\d{2,4})", text)
    if not match:
        return None
    day, month_text, year = match.groups()
    month = int(month_text) if month_text.isdigit() else months.get(month_text)
    if not month:
        return None
    year = int(year)
    if year < 100:
        year += 2000
    try:
        return datetime(year, month, int(day)).date()
    except ValueError:
        return None


def business_days_remaining(value: str):
    due = parse_production_date(value)
    if not due:
        return ""
    today = datetime.now(timezone(timedelta(hours=-5))).date()
    direction = 1 if due >= today else -1
    current = today
    total = 0
    while True:
        if current.weekday() < 5:
            total += 1
        if current == due:
            break
        current += timedelta(days=direction)
    return str(total if direction > 0 else -total)


def read_local_production() -> dict:
    db = connect()
    try:
        meta = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM production_meta")}
        if not meta.get("headers"):
            raise RuntimeError("La base local de Producción todavía no ha sido inicializada")
        rows = [
            {"source_row": row["source_row"], "values": json.loads(row["values_json"])}
            for row in db.execute("SELECT source_row, values_json FROM production_rows ORDER BY COALESCE(sort_order, source_row), source_row")
        ]
        headers = json.loads(meta["headers"])
        normalized = [str(header or "").strip().upper() for header in headers]
        identity_indexes = [
            index for index, title in enumerate(normalized)
            if title in {"ORDEN", "NOMBRE DEL CLIENTE", "REFERENCIA"}
        ]
        rows.sort(
            key=lambda row: not any(
                index < len(row["values"]) and str(row["values"][index] or "").strip()
                for index in identity_indexes
            )
        )
        due_index = next((index for index, title in enumerate(normalized) if title == "FECHA DE ENTREGA"), -1)
        days_index = next((index for index, title in enumerate(normalized) if "DÍAS ENTREGA FINAL" in title or "DIAS ENTREGA FINAL" in title), -1)
        if due_index >= 0 and days_index >= 0:
            for row in rows:
                row["values"][days_index] = business_days_remaining(row["values"][due_index])
        groups = json.loads(meta["groups"])
        started = {(r["source_row"], r["column_number"] - 1): r["id"]
                   for r in db.execute("SELECT id,source_row,column_number FROM production_started ORDER BY id")}
        finished = {}
        for event in db.execute("SELECT id,source_row,column_number,value FROM production_finished ORDER BY id"):
            finished[(event["source_row"], event["column_number"] - 1, event["value"])] = event["id"]
        def process_label(i):
            stage = official_process(headers[i]) if i < len(headers) else None
            return PROCESS_FLOW[stage]['label'] if stage is not None else ''
        for row in rows:
            values = row["values"]
            active = [i for i, value in enumerate(values) if i < len(headers) and process_label(i) and str(value).strip().upper() == "P"]
            completed = [(i, parse_production_date(value)) for i, value in enumerate(values)
                         if i < len(headers) and process_label(i)]
            completed = [(i, date) for i, date in completed if date]
            if active:
                i = max(active, key=lambda i: (started.get((row["source_row"], i), 0), i))
                row["current_process"] = {"label": process_label(i), "state": "active"}
            elif completed:
                i, _date = max(completed, key=lambda item: (
                    finished.get((row["source_row"], item[0], str(values[item[0]])), 0),
                    item[1].toordinal(), item[0]))
                row["current_process"] = {"label": process_label(i), "state": "finished"}
            else:
                row["current_process"] = {"label": "Sin iniciar", "state": "pending"}
        return sheets_sync.decorate(db, {
            "sheet": meta.get("sheet", "PRODUCCIÓN LOCAL"),
            "start_row": int(meta.get("start_row", PRODUCTION_START_ROW)),
            "groups": json.loads(meta["groups"]),
            "headers": headers,
            "rows": rows,
            "updated_at": meta.get("updated_at", datetime.now(timezone.utc).isoformat()),
            "source": "local",
            "process_responsibles": {f"{event['source_row']}:{event['column_number']}": event['responsible'] for event in db.execute("SELECT source_row,column_number,responsible FROM production_operator_events WHERE action IN ('start','rework','finish','na') ORDER BY id")} if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_operator_events'").fetchone() else {},
            "auto_closed": [f"{event['source_row']}:{event['column_number']}" for event in db.execute("SELECT source_row,column_number FROM production_operator_events WHERE action='Cierre automático'")] if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_operator_events'").fetchone() else [],
            "notes": {f"{n['source_row']}:{n['column_number']}": n["note"]
                      for n in db.execute("SELECT source_row,column_number,note FROM production_notes")},
        })
    finally:
        db.close()


@app.put("/api/produccion/nota")
def save_production_note(payload: dict = Body(...), _=Depends(authenticate)):
    row, column, note = payload.get("row"), payload.get("column"), payload.get("note")
    if type(row) is not int or type(column) is not int or not isinstance(note, str) or len(note) > 5000:
        raise HTTPException(400, "Nota inválida. Máximo 5000 caracteres.")
    with connect() as db:
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row=?", (row,)).fetchone()
        if not record or not 1 <= column <= len(json.loads(record["values_json"])):
            raise HTTPException(404, "La celda ya no existe")
        now = datetime.now(timezone.utc).isoformat()
        note = note.strip()
        if note:
            db.execute("INSERT OR REPLACE INTO production_notes VALUES (?,?,?,?,?)", (row, column, note, str(_), now))
        else:
            db.execute("DELETE FROM production_notes WHERE source_row=? AND column_number=?", (row, column))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (now,))
    return {"ok": True, "note": note}


@app.get("/api/produccion")
async def production_data(force: bool = False, _=Depends(authenticate)):
    try:
        return await asyncio.to_thread(read_local_production)
    except Exception as exc:
        logging.exception("No se pudo consultar la base local de producción")
        raise HTTPException(503, f"No se pudo abrir Producción: {exc}") from exc


PROCESS_STATUS_HEADERS = {
    "EDICION", "MATERIALES ESPECIALES", "MTS REQUERIDO", "IMPRESION",
    "SUBLIMACION", "CORTE LASER", "TRAZO", "BORDADO",
    "TEXTURIZADO-APLIQUE-BORDADO", "INSUMOS", "EMPACADO Y EMBALAJE",
    "ENTREGADO", "FACTURADO",
}


def is_process_status_header(header):
    normalized = "".join(c for c in unicodedata.normalize("NFD", str(header or ""))
                         if not unicodedata.combining(c)).strip().upper()
    return normalized in PROCESS_STATUS_HEADERS


OPERATOR_PROCESS_HEADERS = PROCESS_STATUS_HEADERS | {'DISEÑO', 'DISENO', 'CONFECCION', 'CORTE TEXTIL', 'CORTE TEXTIL/PLT'}

PROCESS_FLOW = json.loads(Path(__file__).with_name('process-flow.json').read_text(encoding='utf-8'))


def official_process(header):
    key = ''.join(c for c in unicodedata.normalize('NFD', str(header)) if not unicodedata.combining(c)).strip().upper()
    return next((i for i, process in enumerate(PROCESS_FLOW) if key in process['headers']), None)


def fresh_production_values(values, headers, groups):
    """Keep the order specifications, never copy execution state into a new order."""
    result = list(values)
    for i, header in enumerate(headers):
        title = str(header).strip().upper()
        group = str(groups[i] if i < len(groups) else '').strip('" ').upper()
        operational = group and group != 'GENERAL' and 'LINEA PRODUCCION' not in group and 'METODOLOG' not in group
        status = official_process(header) is not None or title in ('CORTE TEXTIL', 'CORTE TEXTIL/PLT', 'TRAZO')
        if status or (operational and (title.startswith(('RESP', 'HORA ')) or title in ('ESTADO', 'CONFECCIONISTA'))):
            result[i] = ''
    return result


def archive_production_activity(db, row, reason):
    """Recoverably separate a prior lifecycle from an explicitly reset order."""
    db.execute('CREATE TABLE IF NOT EXISTS production_activity_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, source_table TEXT, payload TEXT, reason TEXT, archived_at TEXT)')
    now = datetime.now(timezone.utc).isoformat()
    counts = {}
    for table in ('production_notes', 'production_started', 'production_finished', 'production_rework', 'production_operator_events'):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        records = [dict(r) for r in db.execute(f'SELECT * FROM {table} WHERE source_row=?', (row,))]
        counts[table] = len(records)
        if records:
            db.execute('INSERT INTO production_activity_archive(source_row,source_table,payload,reason,archived_at) VALUES (?,?,?,?,?)', (row,table,json.dumps(records,ensure_ascii=False),reason,now))
            db.execute(f'DELETE FROM {table} WHERE source_row=?', (row,))
    return counts


def operator_process_header(header):
    key = ''.join(c for c in unicodedata.normalize('NFD', str(header)) if not unicodedata.combining(c)).strip().upper()
    return key in OPERATOR_PROCESS_HEADERS


def ensure_operator_events(db):
    db.execute('CREATE TABLE IF NOT EXISTS production_operator_events (id INTEGER PRIMARY KEY, source_row INTEGER, column_number INTEGER, action TEXT, username TEXT, responsible TEXT, reason TEXT, created_at TEXT)')


@app.post('/api/produccion/operacion')
def production_operator_action(payload: dict = Body(...), _=Depends(authenticate)):
    row, column, action = payload.get('row'), payload.get('column'), payload.get('action')
    if type(row) is not int or type(column) is not int or action not in ('start', 'rework', 'finish', 'na'):
        raise HTTPException(400, 'Operación inválida')
    reason = str(payload.get('reason') or '').strip()
    responsible = str(_).strip()
    if not responsible or len(responsible) > 80:
        raise HTTPException(400, 'Indica el responsable (máximo 80 caracteres)')
    if len(reason) > 2000 or (action == 'rework' and not reason):
        raise HTTPException(400, 'El reproceso requiere un motivo de hasta 2000 caracteres')
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        record = db.execute('SELECT values_json FROM production_rows WHERE source_row=?', (row,)).fetchone()
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers, groups = json.loads(meta.get('headers', '[]')), json.loads(meta.get('groups', '[]'))
        if not record or not 1 <= column <= len(headers) or official_process(headers[column-1]) is None:
            raise HTTPException(400, 'Selecciona un proceso válido de esta orden')
        values = json.loads(record['values_json'])
        values.extend([''] * max(0, len(headers)-len(values)))
        previous = str(values[column-1] or '')
        if payload.get('expected') != previous:
            raise HTTPException(409, 'Otro usuario actualizó este proceso. Cierra y vuelve a abrir Producción.')
        if action != 'rework' and (previous.strip().upper() == 'N/A' or parse_production_date(previous)):
            raise HTTPException(409, 'Este proceso ya fue terminado. Para reabrirlo registra un reproceso con su motivo.')
        now = datetime.now(timezone(timedelta(hours=-5)))
        timestamp = now.isoformat()
        value = {'start':'P', 'rework':'R', 'finish':now.strftime('%d/%m/%Y'), 'na':'N/A'}[action]
        if previous == value and action in ('start','finish','na'):
            raise HTTPException(409, 'El proceso ya tiene ese estado. Actualiza antes de continuar.')
        values[column-1] = value
        process_index = official_process(headers[column-1])
        # Multiple legacy applique columns belong to one official production stage.
        for i, header in enumerate(headers):
            if i != column-1 and official_process(header) == process_index and str(values[i] or '').strip().upper() in ('', 'P', 'R'):
                values[i] = value
        group = groups[column-1] if column <= len(groups) else ''
        # Keep existing layout and stamp the process's own time/responsible fields.
        for i in range(column, len(headers)):
            if i >= len(groups) or groups[i] != group or operator_process_header(headers[i]):
                break
            title = str(headers[i]).strip().upper()
            if action == 'start' and title == 'HORA INICIO': values[i] = now.strftime('%H:%M')
            if action == 'start' and title == 'HORA FINAL': values[i] = ''
            if action == 'finish' and title == 'HORA FINAL': values[i] = now.strftime('%H:%M')
            if title.startswith('RESP') or title == 'CONFECCIONISTA': values[i] = responsible
        ensure_operator_events(db)
        db.execute('INSERT INTO production_operator_events(source_row,column_number,action,username,responsible,reason,created_at) VALUES (?,?,?,?,?,?,?)', (row,column,action,str(_),responsible,reason,timestamp))
        if action == 'start': db.execute('INSERT INTO production_started(source_row,column_number,created_at) VALUES (?,?,?)',(row,column,timestamp))
        if action == 'finish':
            for prior_index in range(process_index):
                indexes = [i for i, header in enumerate(headers) if official_process(header) == prior_index]
                changed = []
                # Preserve existing dates, N/A, quantities, responsible users and actual times.
                for i in indexes:
                    if operator_process_header(headers[i]) and str(values[i] or '').strip().upper() in ('', 'P', 'R'):
                        values[i] = value
                        changed.append(i)
                        db.execute('INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)',(row,i+1,value,timestamp))
                if not changed:
                    continue
                automatic_reason = f'Cierre automático al terminar {headers[column-1]}. No indica la hora real de ejecución del proceso anterior.'
                db.execute('INSERT INTO production_operator_events(source_row,column_number,action,username,responsible,reason,created_at) VALUES (?,?,?,?,?,?,?)',(row,changed[0]+1,'Cierre automático',str(_),'Sin atribuir',automatic_reason,timestamp))
            db.execute('INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)',(row,column,value,timestamp))
        if action == 'rework': db.execute('INSERT INTO production_rework(source_row,column_number,process,reason,username,created_at) VALUES (?,?,?,?,?,?)',(row,column,group,reason,str(_),timestamp))
        db.execute('UPDATE production_rows SET values_json=? WHERE source_row=?',(json.dumps(values,ensure_ascii=False),row))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)",(timestamp,))
        db.commit()
        return {'ok':True,'values':values,'created_at':timestamp}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get('/api/produccion/operaciones/{row}')
def production_operator_history(row: int, _=Depends(authenticate)):
    db = connect()
    try:
        ensure_operator_events(db)
        db.commit()
        return [dict(r) for r in db.execute('SELECT column_number,action,username,responsible,reason,created_at FROM production_operator_events WHERE source_row=? ORDER BY id DESC LIMIT 100',(row,))]
    finally:
        db.close()


def stamp_edition_start(values, headers, groups, column, previous, value):
    index = column - 1
    header = str(headers[index]).strip().upper() if index < len(headers) else ""
    if not is_process_status_header(header):
        return
    now = datetime.now(timezone(timedelta(hours=-5)))
    is_start = value.strip().upper() == "P"
    is_today = parse_production_date(value) == now.date()
    if not is_start and not is_today:
        return
    target_header = "HORA INICIO" if is_start else "HORA FINAL"
    group = groups[index] if index < len(groups) else None
    for start_index in range(index + 1, len(headers)):
        if group is not None and (start_index >= len(groups) or groups[start_index] != group):
            break
        title = str(headers[start_index]).strip().upper()
        if title in ("OK", "HORA INICIO") and title != target_header:
            continue
        if title != target_header:
            if is_process_status_header(title):
                continue
            break
        if len(values) <= start_index:
            values.extend([""] * (start_index + 1 - len(values)))
        if previous != value or not str(values[start_index] or "").strip():
            values[start_index] = now.strftime("%H:%M")
        break


@app.patch("/api/produccion/celda")
async def update_production_cell(payload: dict = Body(...), _=Depends(authenticate)):
    try:
        row = int(payload.get("row"))
        column = int(payload.get("column"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Fila o columna inválida") from exc
    value = str(payload.get("value", ""))
    if row < PRODUCTION_START_ROW or column < 1 or column > 83:
        raise HTTPException(400, "La celda está fuera del área editable de Producción")
    if len(value) > 5000:
        raise HTTPException(400, "El contenido de la celda es demasiado largo")
    try:
        db = connect()
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row = ?", (row,)).fetchone()
        if not record:
            db.close()
            raise HTTPException(404, "La fila no existe en la base local")
        values = json.loads(record["values_json"])
        if column > len(values):
            values.extend([""] * (column - len(values)))
        previous = values[column - 1]
        values[column - 1] = value
        header_record = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
        headers = json.loads(header_record["value"]) if header_record else []
        group_record = db.execute("SELECT value FROM production_meta WHERE key = 'groups'").fetchone()
        groups = json.loads(group_record["value"]) if group_record else []
        header = str(headers[column - 1]).strip().upper() if column <= len(headers) else ""
        if is_process_status_header(header) and value.strip().upper() == "R":
            reason = payload.get("reason")
            if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 2000:
                db.close()
                raise HTTPException(400, "Escribe el motivo del reproceso (máximo 2000 caracteres)")
            value = "R"
            values[column - 1] = value
            db.execute("INSERT INTO production_rework(source_row, column_number, process, reason, username, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                       (row, column, str(groups[column - 1]) if column <= len(groups) else header,
                        reason.strip(), str(_), datetime.now(timezone.utc).isoformat()))
        stamp_edition_start(values, headers, groups, column, previous, value)
        if value != previous and parse_production_date(value):
            db.execute("INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)",
                       (row, column, value, datetime.now(timezone.utc).isoformat()))
        if value.strip().upper() == "P" and str(previous).strip().upper() != "P":
            db.execute("INSERT INTO production_started(source_row,column_number,created_at) VALUES (?,?,?)",
                       (row, column, datetime.now(timezone.utc).isoformat()))
        now = datetime.now(timezone.utc).isoformat()
        db.execute("UPDATE production_rows SET values_json = ? WHERE source_row = ?", (json.dumps(values, ensure_ascii=False), row))
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        db.close()
        return {"ok": True, "row": row, "column": column, "value": value, "values": values}
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logging.exception("No se pudo editar la celda de producción")
        raise HTTPException(503, f"No se pudo guardar el cambio: {exc}") from exc


@app.get("/api/produccion/reprocesos/{row}/{column}")
def production_rework_history(row: int, column: int, _=Depends(authenticate)):
    with connect() as db:
        records = db.execute("SELECT process, reason, username, created_at FROM production_rework WHERE source_row = ? AND column_number = ? ORDER BY id DESC", (row, column)).fetchall()
    return [dict(record) for record in records]


@app.get("/api/produccion/proceso-orden")
def order_active_process(order: str, _=Depends(authenticate)):
    with connect() as db:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers = json.loads(meta.get('headers', '[]'))
        groups = json.loads(meta.get('groups', '[]'))
        order_index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), -1)
        if order_index < 0:
            return {'process': '', 'basis': 'none'}
        records = [(r['source_row'], json.loads(r['values_json'])) for r in db.execute('SELECT source_row,values_json FROM production_rows')]
        rows = {row: values for row, values in records if len(values) > order_index and str(values[order_index]).strip().upper() == order.strip().upper()}
        def process_at(index):
            stage = official_process(headers[index]) if 0 <= index < len(headers) else None
            return PROCESS_FLOW[stage]['label'] if stage is not None else ''
        active = [(row, i) for row, values in rows.items() for i, value in enumerate(values) if str(value).strip().upper() == 'P' and process_at(i)]
        history = [(r['source_row'], r['column_number']-1) for r in db.execute('SELECT source_row,column_number FROM production_started ORDER BY id DESC') if r['source_row'] in rows and process_at(r['column_number']-1)]
        latest_active = next((item for item in history if item in active), None)
        if latest_active:
            return {'process': process_at(latest_active[1]), 'basis': 'active'}
        if active:
            return {'process': process_at(max(active, key=lambda item:item[1])[1]), 'basis': 'legacy'}
        completed = {(row, i): date for row, values in rows.items() for i, value in enumerate(values)
                     if process_at(i) and (date := parse_production_date(str(value)))}
        for item in db.execute('SELECT source_row,column_number,value FROM production_finished ORDER BY id DESC'):
            key = (item['source_row'], item['column_number'] - 1)
            if key in completed and str(rows[key[0]][key[1]]) == item['value']:
                return {'process': process_at(key[1]), 'basis': 'finished'}
        if completed:
            key = max(completed, key=lambda item: (completed[item], item[1]))
            return {'process': process_at(key[1]), 'basis': 'finished_legacy'}
        return {'process': '', 'basis': 'none'}


@app.post("/api/produccion/orden")
async def update_production_order(payload: dict = Body(...), _=Depends(authenticate)):
    raw_rows = payload.get("rows")
    if not isinstance(raw_rows, list):
        raise HTTPException(400, "El orden de filas no es válido")
    try:
        rows = [int(value) for value in raw_rows]
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "El orden contiene una fila inválida") from exc
    if len(rows) != len(set(rows)):
        raise HTTPException(400, "El orden contiene filas repetidas")
    db = connect()
    try:
        existing = {int(row[0]) for row in db.execute("SELECT source_row FROM production_rows")}
        if set(rows) != existing:
            raise HTTPException(400, "Debes ordenar todas las filas visibles sin aplicar filtros")
        db.executemany(
            "UPDATE production_rows SET sort_order = ? WHERE source_row = ?",
            [(index, source_row) for index, source_row in enumerate(rows, start=1)],
        )
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return {"ok": True, "rows": len(rows), "updated_at": now}
    finally:
        db.close()


@app.post("/api/produccion/ordenar-entrega")
def sort_production_by_delivery(_=Depends(authenticate)):
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        headers = json.loads(meta["value"]) if meta else []
        index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == "FECHA DE ENTREGA"), -1)
        if index < 0:
            raise HTTPException(400, "No se encontró la columna Fecha de entrega")
        records = list(db.execute("SELECT source_row,values_json FROM production_rows ORDER BY COALESCE(sort_order,source_row),source_row"))
        def date_key(record):
            values = json.loads(record["values_json"])
            date = parse_production_date(values[index]) if index < len(values) else None
            return (date is None, date.toordinal() if date else 0)
        records.sort(key=date_key)
        db.executemany("UPDATE production_rows SET sort_order=? WHERE source_row=?",
                       [(position, record["source_row"]) for position, record in enumerate(records, 1)])
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (now,))
        db.commit()
        return {"ok": True, "rows": len(records)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def can_delete_production_profile(profile):
    normalized = ''.join(c for c in unicodedata.normalize('NFD', str(profile)) if not unicodedata.combining(c))
    return ' '.join(normalized.upper().split()) in {'ADMINISTRACION', 'EDICION', 'COMERCIAL', 'COMERCIALES', 'ASISTENTE COMERCIAL', 'ASISTENTES COMERCIALES'}


def production_delete_target(db, row, username):
    profile = db.execute('SELECT process FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    if username != os.getenv('APP_USER', 'indoor') and not (profile and can_delete_production_profile(profile['process'])):
        raise HTTPException(403, 'Solo Administración y Edición pueden eliminar órdenes')
    record = db.execute('SELECT * FROM production_rows WHERE source_row=?', (row,)).fetchone()
    if not record:
        raise HTTPException(404, 'La tarjeta ya no existe')
    meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
    headers = json.loads(meta['value']) if meta else []
    values = json.loads(record['values_json'])
    def field(items, title):
        index = next((i for i,h in enumerate(headers) if str(h).strip().upper()==title), -1)
        return str(items[index] or '').strip() if 0 <= index < len(items) else ''
    order, client_name = field(values, 'ORDEN').upper(), legacy.sanitize(field(values, 'NOMBRE DEL CLIENTE'))
    if not client_name or not re.fullmatch(r'[A-Z0-9_-]{2,40}', order) or not any(c.isdigit() for c in order):
        raise HTTPException(409, 'La tarjeta no identifica un cliente y una orden válidos. No se eliminó nada.')
    for other in db.execute('SELECT source_row,values_json FROM production_rows WHERE source_row<>?', (row,)):
        other_values = json.loads(other['values_json'])
        if field(other_values,'ORDEN').upper()==order:
            raise HTTPException(409, 'Otra tarjeta comparte esta orden. No se puede borrar su carpeta mientras siga programada.')
    root = Path(CONFIG['ruta_nas_clientes']).resolve(strict=True)
    client = root / client_name
    if client.is_symlink() or client.resolve().parent != root or not client.is_dir():
        raise HTTPException(409, 'No se pudo confirmar la carpeta exacta del cliente. No se eliminó nada.')
    client = client.resolve(strict=True)
    matches = [p for p in client.iterdir() if p.is_dir() and (p.name.upper()==order or any(p.name.upper().startswith(order+s) for s in ('_', ' ', '-')))]
    if len(matches)!=1:
        raise HTTPException(409, 'Debe existir una única carpeta de esta orden en el cliente. No se eliminó nada.')
    candidate = matches[0]
    target = candidate.resolve(strict=True)
    if candidate.is_symlink() or target.parent!=client or len(target.relative_to(root).parts)!=2:
        raise HTTPException(403, 'Ruta de orden no permitida')
    # Reject links/junctions and nested mount points before any recursive deletion.
    for parent, dirs, files in os.walk(target, followlinks=False):
        for name in dirs + files:
            entry = Path(parent) / name
            if entry.is_symlink() or (hasattr(entry, 'is_junction') and entry.is_junction()) or os.path.ismount(entry) or not entry.resolve().is_relative_to(target):
                raise HTTPException(409, 'La carpeta contiene enlaces o rutas externas. Se requiere revisión manual.')
    relative = str(target.relative_to(root)).replace('\\','/')
    fingerprint = hashlib.sha256((record['values_json']+'\n'+relative).encode()).hexdigest()
    return record, target, order, relative, fingerprint


@app.get('/api/produccion/fila/{row}/eliminacion')
def preview_production_delete(row: int, _=Depends(authenticate)):
    db = connect()
    try:
        record, target, order, relative, fingerprint = production_delete_target(db,row,_)
        return dict(order=order, folder='\\\\192.168.0.120\\NAS INDOOR\\CLIENTES\\'+relative.replace('/','\\'), confirmation=fingerprint)
    except OSError as error:
        raise HTTPException(503, 'No se pudo acceder al NAS. No se eliminó nada.') from error
    finally:
        db.close()


def verify_delete_password(db, username, password):
    db.execute('CREATE TABLE IF NOT EXISTS production_delete_attempts (username TEXT PRIMARY KEY COLLATE NOCASE, attempts INTEGER, started REAL)')
    now = time.time()
    attempt = db.execute('SELECT attempts,started FROM production_delete_attempts WHERE username=?', (username,)).fetchone()
    count = attempt['attempts'] if attempt and now-attempt['started']<900 else 0
    if count >= 5:
        raise HTTPException(429, 'Demasiados intentos de contraseña. Espera 15 minutos antes de volver a eliminar.')
    user = db.execute('SELECT password_hash FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    valid = isinstance(password,str) and 0 < len(password) <= 256 and (
        password_matches(password,user['password_hash']) if user else
        username==os.getenv('APP_USER','indoor') and bool(os.getenv('APP_PASSWORD','')) and secrets.compare_digest(password.encode(),os.getenv('APP_PASSWORD','').encode()))
    if not valid:
        db.execute('INSERT OR REPLACE INTO production_delete_attempts(username,attempts,started) VALUES (?,?,?)',
                   (username,count+1,attempt['started'] if count else now))
        db.commit()
        raise HTTPException(403, 'Contraseña incorrecta. No se eliminó la tarjeta ni la carpeta.')
    db.execute('DELETE FROM production_delete_attempts WHERE username=?',(username,))


@app.delete("/api/produccion/fila/{row}")
def delete_production_row(row: int, payload: dict = Body(...), _=Depends(authenticate)):
    if row < PRODUCTION_START_ROW:
        raise HTTPException(400, "La fila está fuera del área de Producción")
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        record, target, order, relative, fingerprint = production_delete_target(db,row,_)
        verify_delete_password(db, _, payload.get('password'))
        if payload.get('confirmation')!=fingerprint or payload.get('order')!=order:
            raise HTTPException(409, 'Confirma la carpeta y la orden actual antes de eliminarla.')
        backup_dir = STATE_DIR / 'deleted-order-backups'
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_base = backup_dir / (str(row)+'-'+secrets.token_hex(12))
        # Complete a server-side recovery copy before touching NAS files.
        backup = shutil.make_archive(str(backup_base), 'zip', root_dir=str(target.parent), base_dir=target.name)
        db.execute('CREATE TABLE IF NOT EXISTS production_nas_deletions (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, folder TEXT, backup TEXT, actor TEXT, deleted_at TEXT)')
        db.execute('INSERT INTO production_nas_deletions(source_row,folder,backup,actor,deleted_at) VALUES (?,?,?,?,?)',
                   (row,relative,backup,_,datetime.now(timezone.utc).isoformat()))
        # Resolve again after backup and require the same exact target and row.
        verified_record, verified, verified_order, verified_relative, verified_fingerprint = production_delete_target(db,row,_)
        if verified!=target or verified_fingerprint!=fingerprint:
            raise HTTPException(409, 'La orden cambió durante la operación. No se eliminó nada.')
        shutil.rmtree(verified)
        db.execute('CREATE TABLE IF NOT EXISTS production_deleted_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, payload TEXT, deleted_by TEXT, deleted_at TEXT)')
        db.execute('INSERT INTO production_deleted_rows(source_row,payload,deleted_by,deleted_at) VALUES (?,?,?,?)',
                   (row, json.dumps(dict(record), ensure_ascii=False), _, datetime.now(timezone.utc).isoformat()))
        archive_production_activity(db, row, 'Orden eliminada por ' + str(_))
        highest = max(row, int((db.execute("SELECT value FROM production_meta WHERE key='last_allocated_row'").fetchone() or [0])[0]))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('last_allocated_row',?)", (str(highest),))
        db.execute("DELETE FROM production_rows WHERE source_row = ?", (row,))
        db.execute("DELETE FROM production_notes WHERE source_row = ?", (row,))
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return {"ok": True, "row": row, "updated_at": now, "nas_deleted": relative}
    except OSError as error:
        db.rollback()
        logging.exception('No se completó la eliminación NAS de fila %s', row)
        raise HTTPException(503, 'No se completó la eliminación del NAS. La tarjeta se conserva; si comenzó el borrado, hay un respaldo en el servidor para recuperación.') from error
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/descargar-conector-nas")
def download_nas_connector(_=Depends(authenticate)):
    handler = r'''param([string]$Uri)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IndoorExplorerWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@
function Get-ViewIdentity($view) {
    $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($view)
    try { return $pointer.ToInt64().ToString() }
    finally { [Runtime.InteropServices.Marshal]::Release($pointer) | Out-Null }
}
function Open-OrderAndMasters([string]$OrderPath) {
    $masters = Join-Path ([System.IO.Path]::GetDirectoryName($OrderPath.TrimEnd('\'))) "MAESTROS"
    Start-Process explorer.exe -ArgumentList ('"' + $OrderPath + '"')
    if (-not (Test-Path -LiteralPath $masters -PathType Container)) {
        [System.Windows.MessageBox]::Show("Se abrió la orden. Este cliente no tiene una carpeta MAESTROS disponible.", "Indoor NAS") | Out-Null
        return
    }
    try {
        $shellApp = New-Object -ComObject Shell.Application
        $orderView = $null
        for ($attempt = 0; $attempt -lt 40 -and $null -eq $orderView; $attempt++) {
            foreach ($view in @($shellApp.Windows())) {
                try {
                    if ($view.Document.Folder.Self.Path.TrimEnd('\') -ieq $OrderPath.TrimEnd('\')) { $orderView = $view; break }
                } catch {}
            }
            if ($null -eq $orderView) { Start-Sleep -Milliseconds 200 }
        }
        if ($null -eq $orderView) { throw "No se identificó la ventana de la orden." }
        $windowHandle = [IntPtr]([long]$orderView.HWND)
        $before = @($shellApp.Windows() | ForEach-Object { Get-ViewIdentity $_ })
        [IndoorExplorerWindow]::ShowWindow($windowHandle, 9) | Out-Null
        [IndoorExplorerWindow]::SetForegroundWindow($windowHandle) | Out-Null
        Start-Sleep -Milliseconds 250
        if ([IndoorExplorerWindow]::GetForegroundWindow() -ne $windowHandle) { throw "No se pudo activar la ventana de la orden." }
        # Only the shortcut is sent to the verified Explorer window; paths use COM, never keystrokes.
        [System.Windows.Forms.SendKeys]::SendWait("^t")
        $newTab = $null
        for ($attempt = 0; $attempt -lt 30 -and $null -eq $newTab; $attempt++) {
            Start-Sleep -Milliseconds 150
            foreach ($view in @($shellApp.Windows())) {
                try {
                    if ([long]$view.HWND -eq $windowHandle.ToInt64() -and (Get-ViewIdentity $view) -notin $before) { $newTab = $view; break }
                } catch {}
            }
        }
        if ($null -eq $newTab) { throw "Windows no expuso la nueva pestaña." }
        $newTab.Navigate2($masters)
    } catch {
        # Compatibility fallback: still provide both folders without navigating an unrelated tab.
        Start-Process explorer.exe -ArgumentList ('"' + $masters + '"')
    }
}
try {
    $parsed = [System.Uri]$Uri
    if ($parsed.Host -eq "folder") {
        $parts = $parsed.AbsolutePath.Trim('/').Split('/')
        if ($parts.Count -ne 2) { throw "Ruta de carpeta inválida." }
        $clientName = [System.Uri]::UnescapeDataString($parts[0])
        $folderName = [System.Uri]::UnescapeDataString($parts[1])
        foreach ($part in @($clientName, $folderName)) {
            if ([string]::IsNullOrWhiteSpace($part) -or $part -in @(".", "..") -or $part.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw "Nombre de carpeta inválido." }
        }
        $base = "\\192.168.0.120\NAS INDOOR\CLIENTES"
        $target = Join-Path (Join-Path $base $clientName) $folderName
        if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw "No existe la carpeta de la orden o no hay conexión al NAS." }
        Open-OrderAndMasters $target
        exit 0
    }
    $order = [System.Uri]::UnescapeDataString($parsed.AbsolutePath.Trim('/')).Trim()
    if ([string]::IsNullOrWhiteSpace($order)) { throw "La orden no fue especificada." }
    $root = "\\192.168.0.120\NAS INDOOR\CLIENTES"
    $found = $null
    foreach ($client in Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop) {
        $found = Get-ChildItem -LiteralPath $client.FullName -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like ($order + "*") } |
            Select-Object -First 1
        if ($null -ne $found) { break }
    }
    if ($null -eq $found) {
        [System.Windows.MessageBox]::Show("No se encontró la carpeta de la orden $order en el NAS.", "Indoor NAS") | Out-Null
        exit 2
    }
    Open-OrderAndMasters $found.FullName
} catch {
    [System.Windows.MessageBox]::Show("No fue posible abrir la orden. Verifica que estés conectado a la red de Indoor.`n`n" + $_.Exception.Message, "Indoor NAS") | Out-Null
    exit 1
}
'''
    encoded = base64.b64encode(handler.encode("utf-8")).decode("ascii")
    launcher = r'''Set shell = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
scriptPath = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\IndoorNAS\open-order.ps1"
uri = Replace(WScript.Arguments(0), Chr(34), Chr(34) & Chr(34))
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34) & " " & Chr(34) & uri & Chr(34)
shell.Run command, 0, False
'''
    launcher_encoded = base64.b64encode(launcher.encode("utf-8")).decode("ascii")
    installer = fr'''@echo off
setlocal
title Instalador Indoor NAS
set "INDOOR_DIR=%LOCALAPPDATA%\IndoorNAS"
if not exist "%INDOOR_DIR%" mkdir "%INDOOR_DIR%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$handler=[Convert]::FromBase64String('{encoded}'); $launcher=[Convert]::FromBase64String('{launcher_encoded}'); [IO.File]::WriteAllBytes($env:LOCALAPPDATA+'\IndoorNAS\open-order.ps1',$handler); [IO.File]::WriteAllBytes($env:LOCALAPPDATA+'\IndoorNAS\open-order.vbs',$launcher); $key='HKCU:\Software\Classes\indoor-nas'; New-Item -Path $key -Force | Out-Null; Set-Item -Path $key -Value 'URL:Indoor NAS'; New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -Force | Out-Null; $commandKey=$key+'\shell\open\command'; New-Item -Path $commandKey -Force | Out-Null; Set-Item -Path $commandKey -Value ('wscript.exe "'+$env:LOCALAPPDATA+'\IndoorNAS\open-order.vbs" "%%1"')"
if errorlevel 1 (
  echo No fue posible instalar el conector.
  pause
  exit /b 1
)
echo.
echo Conector Indoor NAS instalado correctamente.
echo Ya puedes cerrar esta ventana y pulsar una fila en Produccion.
echo.
pause
'''
    return Response(
        content=installer.encode("utf-8"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="Instalar-Conector-Indoor-NAS.cmd"'},
    )
def nas_client_key(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', str(value))
                           if not unicodedata.combining(c)).casefold().split())


def resolve_nas_client(root: Path, client_name: str) -> Path:
    root = root.resolve()
    if not root.is_dir():
        raise HTTPException(503, 'El NAS no está disponible')
    if not client_name or (root / client_name).resolve().parent != root:
        raise HTTPException(400, 'Nombre de cliente inválido')
    matches = [p.resolve() for p in root.iterdir()
               if nas_client_key(p.name) == nas_client_key(client_name)
               and p.is_dir() and p.resolve().parent == root]
    if len(matches) > 1:
        raise HTTPException(409, 'Hay varias carpetas con el mismo nombre de cliente al ignorar tildes. Revisa cuál corresponde a la orden.')
    if not matches:
        raise HTTPException(404, f'No se encontró la carpeta del cliente {client_name}, incluso ignorando tildes y mayúsculas.')
    return matches[0]


def find_nas_order(order: str) -> Path:
    clean = str(order or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", clean):
        raise HTTPException(400, "Número de orden inválido")
    root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    if not root.is_dir():
        raise HTTPException(503, "El NAS no está disponible")
    matches = []
    for client_dir in root.iterdir():
        if not client_dir.is_dir() or client_dir.resolve().parent != root:
            continue
        for candidate in client_dir.iterdir():
            name = candidate.name.upper()
            if candidate.is_dir() and (name == clean or any(name.startswith(clean + separator) for separator in ('_', ' ', '-'))):
                target = candidate.resolve()
                if target.parent == client_dir.resolve():
                    matches.append(target)
    if len(matches) > 1:
        raise HTTPException(409, f'Hay varias carpetas para la orden {clean}. Revisa la carpeta correcta; no se abrió ninguna.')
    if matches:
        return matches[0]
    raise HTTPException(404, f"No se encontró la orden {clean} en el NAS")


def production_row_files(source_row: int, excel_only=False):
    with connect() as db:
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row = ?", (source_row,)).fetchone()
        meta = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
    if not record or not meta:
        raise HTTPException(404, "Fila no encontrada")
    values, headers = json.loads(record['values_json']), json.loads(meta['value'])
    def field(name):
        index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == name), -1)
        return str(values[index] or '').strip() if 0 <= index < len(values) else ''
    root = Path(CONFIG['ruta_nas_clientes']).resolve()
    def normalized_name(value):
        return ' '.join(''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.combining(c)).casefold().split())
    client_name = legacy.sanitize(field('NOMBRE DEL CLIENTE'))
    order = field('ORDEN').upper()
    if not client_name or not re.fullmatch(r'[A-Z0-9_-]{2,40}', order):
        raise HTTPException(404, "La fila no tiene cliente u orden válidos")
    client = resolve_nas_client(root, client_name)
    matches = [p.resolve() for p in client.iterdir() if p.is_dir() and
               (p.name.upper() == order or any(p.name.upper().startswith(order + s) for s in ('_', ' ', '-')))]
    files = []
    if len(matches) == 1 and matches[0].parent == client:
        files = [p for p in matches[0].iterdir() if p.is_file() and p.resolve().parent == matches[0]]
    reference = field('REFERENCIA').upper()
    if excel_only:
        return [p for p in files if not p.name.startswith('~$') and p.suffix.lower() in ('.xlsx', '.xlsm', '.xls', '.pdf', '.csv')], [], client
    def child(parent, name):
        found = [p.resolve() for p in parent.iterdir() if p.is_dir() and p.name.casefold() == name.casefold() and p.resolve().parent == parent]
        return found[0] if len(found) == 1 else None
    masters = child(client, 'MAESTROS')
    project_name = legacy.sanitize(field('NOMBRE PROYECTO'))
    # Explicit client/project correspondences confirmed by the user.
    client_key = normalized_name(client_name)
    if client_key == 'corporacion deportiva inter club' and project_name.upper() == 'UNIFORMES PROFES':
        project_name = 'PROFES 2027'
    if client_key == 'andrea villada villada' and project_name.upper() == 'CORPORACION FCV':
        masters = child(client, 'Maestro')
        project_name = 'CORPORACION'
    project = child(masters, project_name) if masters and project_name else None
    images = []
    if project and reference:
        # Match complete reference tokens, never a substring from another model.
        tokens = set(re.findall(r'[A-Z]+\d+', reference))
        if client_key == 'dimelo jara company sas' and project_name.upper() == 'ALCALDIA DE ITAGUI' and reference == 'A11200CA02-A11200PT01':
            tokens = {'FUT02'}
        designs = []
        for folder in project.iterdir():
            if not folder.is_dir() or folder.resolve().parent != project:
                continue
            code = re.split(r'[_\s-]', folder.name.upper())[0]
            if code == reference or code in tokens:
                designs.append(folder.resolve())
        if len(designs) == 1:
            images = [p for p in designs[0].iterdir() if p.is_file() and p.resolve().parent == designs[0] and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
            # Up to four versions within the uniquely matched design folder.
            images = sorted(images, key=lambda p: p.name.casefold())[:4]
    # Verified NAS naming exception: same client's 2018-2019 flag project.
    if normalized_name(client_name) == 'corporacion cracks antioquia' and field('NOMBRE PROYECTO').upper() == 'BANDERA 2018-2019' and reference == 'A3000BN01' and masters:
        flag_project = child(masters, 'BANDERA 18-19')
        if flag_project:
            flags = [p for p in flag_project.iterdir() if p.is_file() and p.resolve().parent == flag_project and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
            if len(flags) == 1:
                images = flags
    # These current orders were explicitly requested without mockups.
    if order in {'RM7585', 'RM7603', 'CO6072', 'CO6073'}:
        images = []
    files = [p for p in files if p.suffix.lower() in ('.xlsx', '.xls', '.pdf', '.csv')] + images
    return files, images, client


@app.get('/api/produccion/fila/{source_row}/archivos')
def production_card_assets(source_row: int, _=Depends(authenticate)):
    try:
        files, mockups, client = production_row_files(source_row, excel_only=True)
        designs, status = production_excel_designs(source_row, files)
    except OSError:
        raise HTTPException(503, 'El NAS no está disponible')
    images, documents = [], []
    for path in sorted(files, key=lambda p: p.name.lower()):
        url = f'/api/produccion/fila/{source_row}/archivo?name=' + quote(path.relative_to(client).as_posix(), safe='')
        if path in mockups:
            images.append({'name': path.name, 'url': url})
        if path.suffix.lower() in ('.xlsx', '.xls', '.pdf', '.csv'):
            documents.append({'name': path.name, 'url': url})
    images = [{'name': f'D{number} · imagen del listado Excel', 'design': number,
               'url': f'/api/produccion/fila/{source_row}/mockup-excel/{number}?v=' + hashlib.sha256(data).hexdigest()[:20]}
              for number, mime, data in designs]
    return {'images': images, 'documents': documents[:20], 'image_status': status, 'image_source': 'excel'}


def production_excel_designs(source_row, files):
    with connect() as db:
        record = db.execute('SELECT values_json FROM production_rows WHERE source_row = ?', (source_row,)).fetchone()
        meta = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
    if not record or not meta:
        raise HTTPException(404, 'Fila no encontrada')
    values, headers = json.loads(record['values_json']), json.loads(meta['value'])
    fields = {str(h).strip().upper(): str(v or '').strip() for h, v in zip(headers, values)}
    order, reference = fields.get('ORDEN', '').upper(), fields.get('REFERENCIA', '').upper()
    # Previously confirmed correspondence for this exact order/reference.
    if order == 'RM7613' and reference == 'A11200CA02-A11200PT01':
        reference = 'A11200FUT02'
    # CO6032 has a blank reference in Sheets; its order listing identifies IBOLDEP.
    if order == 'CO6032' and not reference:
        reference = 'IBOLDEP'
    try:
        return listing_designs(files, reference)
    except OSError:
        raise
    except Exception:
        logging.exception('No se pudo leer el mockup Excel de la fila %s', source_row)
        return (), 'No se pudo leer la imagen del listado'


@app.get('/api/produccion/fila/{source_row}/mockup-excel/{design}')
def production_excel_image(source_row: int, design: int, request: Request = None, _=Depends(authenticate)):
    if design not in (1, 2, 3, 4):
        raise HTTPException(404, 'Diseño no encontrado')
    try:
        files, _, _client = production_row_files(source_row, excel_only=True)
        images, _status = production_excel_designs(source_row, files)
    except OSError:
        raise HTTPException(503, 'El NAS no está disponible')
    target = next((image for image in images if image[0] == design), None)
    if target is None:
        raise HTTPException(404, 'Diseño no encontrado en el Excel')
    etag = '"' + hashlib.sha256(target[2]).hexdigest() + '"'
    headers = {'Cache-Control': 'private, no-cache', 'ETag': etag,
               'X-Content-Type-Options': 'nosniff'}
    if request is not None and request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    return Response(target[2], media_type=target[1], headers=headers)


@app.get('/api/produccion/fila/{source_row}/archivo')
def production_card_file(source_row: int, name: str, _=Depends(authenticate)):
    files, mockups, client = production_row_files(source_row)
    target = next((p for p in files if p.relative_to(client).as_posix() == name), None)
    if target is None or target.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.pdf', '.csv'):
        raise HTTPException(404, 'Archivo no encontrado')
    if target.stat().st_size > 30 * 1024 * 1024:
        raise HTTPException(413, 'Archivo demasiado grande; ábrelo desde el NAS')
    return FileResponse(target, headers={'Cache-Control': 'private, max-age=120', 'X-Content-Type-Options': 'nosniff'})


@app.post("/api/nas/progreso")
def nas_order_progress(payload: dict = Body(...), _=Depends(authenticate)):
    order = str(payload.get("order") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", order):
        raise HTTPException(400, "Número de orden inválido")

    def stream():
        def event(percent, message, **extra):
            return json.dumps(dict(percent=percent, message=message, **extra), ensure_ascii=False) + "\n"
        try:
            yield event(5, "Conectando con el NAS…")
            root = Path(CONFIG["ruta_nas_clientes"]).resolve()
            if not root.is_dir():
                raise HTTPException(503, "El NAS no está disponible")
            client_name = legacy.sanitize(str(payload.get("client") or "").strip())
            yield event(20, f"Consultando únicamente el cliente: {client_name}")
            try:
                if not client_name:
                    raise HTTPException(404, 'La fila no tiene nombre de cliente')
                client_dir = resolve_nas_client(root, client_name)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
                yield event(25, f'Cliente no encontrado. Buscando la orden exacta {order} en el NAS…')
                target = find_nas_order(order)
                relative = target.relative_to(root)
                yield event(100, 'ORDEN ENCONTRADA', done=True, ok=True,
                            windows_url='indoor-nas://folder/' + '/'.join(quote(p, safe='') for p in relative.parts),
                            smb_url='smb://192.168.0.120/NAS%20INDOOR/CLIENTES/' + '/'.join(quote(p, safe='') for p in relative.parts))
                return
            yield event(30, "CLIENTE ENCONTRADO")
            orders = list(client_dir.iterdir())
            total = len(orders)
            for index, candidate in enumerate(orders):
                name = candidate.name.upper()
                matches = name == order or any(name.startswith(order + separator) for separator in ("_", " ", "-"))
                if candidate.is_dir() and matches:
                    target = candidate.resolve()
                    if target.parent != client_dir:
                        raise HTTPException(403, "Ruta de orden no permitida")
                    relative = target.relative_to(root)
                    unc = "\\\\192.168.0.120\\NAS INDOOR\\CLIENTES\\" + "\\".join(relative.parts)
                    yield event(100, "ORDEN ENCONTRADA", done=True, ok=True,
                                windows_url="indoor-nas://folder/" + "/".join(quote(p, safe="") for p in relative.parts),
                                smb_url="smb://192.168.0.120/NAS%20INDOOR/CLIENTES/" + "/".join(quote(p, safe="") for p in relative.parts))
                    return
                yield event(20 + int(70 * (index + 1) / max(total, 1)),
                            f"{client_name}: {index + 1} de {total} órdenes revisadas.")
            raise HTTPException(404, f"No se encontró la orden {order} en la carpeta del cliente {client_name}.")
        except Exception as error:
            message = error.detail if isinstance(error, HTTPException) else "No se pudo consultar el NAS. Intenta nuevamente."
            yield event(0, str(message), done=True, ok=False)

    return StreamingResponse(stream(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.post("/api/nas/preparar")
def prepare_nas_order(payload: dict = Body(...), _=Depends(authenticate)):
    order = str(payload.get("order") or "").strip().upper()
    client = str(payload.get("client") or "").strip()
    project = str(payload.get("project") or "").strip()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", order):
        raise HTTPException(400, "Número de orden inválido")
    if not client:
        raise HTTPException(400, "La fila no tiene nombre de cliente")
    root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    if not root.is_dir():
        raise HTTPException(503, "El NAS no está disponible")
    try:
        existing = find_nas_order(order)
        return {"ok": True, "created": False, "folder": existing.name}
    except HTTPException as error:
        if error.status_code != 404:
            raise
    client_name = legacy.sanitize(client)
    project_name = legacy.sanitize(project) if project else "ORDEN"
    client_dir = (root / client_name).resolve()
    if root not in client_dir.parents:
        raise HTTPException(400, "Nombre de cliente inválido")
    order_dir = (client_dir / f"{order}_{project_name}").resolve()
    if client_dir not in order_dir.parents:
        raise HTTPException(400, "Nombre de proyecto inválido")
    try:
        order_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logging.exception("No se pudo preparar la carpeta NAS %s", order_dir)
        raise HTTPException(500, f"No se pudo crear la carpeta en el NAS: {error}") from error
    return {"ok": True, "created": True, "folder": order_dir.name}


@app.get("/nas/orden/{order}/abrir-explorador")
def open_nas_order_in_explorer(order: str, request: Request, _=Depends(authenticate)):
    order_root = find_nas_order(order)
    nas_root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    relative = order_root.relative_to(nas_root)
    parts = ["CLIENTES", *relative.parts]
    smb_url = "smb://192.168.0.120/NAS%20INDOOR/" + "/".join(quote(part, safe="") for part in parts)
    if "Windows" in request.headers.get("user-agent", ""):
        unc_path = "\\\\192.168.0.120\\NAS INDOOR\\" + "\\".join(parts)
        explorer_url = "search-ms:query=*&crumb=location:" + quote(unc_path, safe="")
        return RedirectResponse(explorer_url, status_code=307)
    return RedirectResponse(smb_url, status_code=307)


@app.get("/nas/orden/{order}", response_class=HTMLResponse)
@app.get("/nas/orden/{order}/{relative_path:path}")
def browse_nas_order(order: str, relative_path: str = "", _=Depends(authenticate)):
    order_root = find_nas_order(order)
    target = (order_root / relative_path).resolve()
    if target != order_root and order_root not in target.parents:
        raise HTTPException(403, "Ruta no permitida")
    if not target.exists():
        raise HTTPException(404, "El archivo o carpeta ya no existe")
    if target.is_file():
        return FileResponse(target, filename=target.name)
    items = sorted(target.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
    parent = ""
    if target != order_root:
        parent_rel = target.parent.relative_to(order_root).as_posix()
        parent = f"<a class='nas-back' href='/nas/orden/{quote(order)}/{quote(parent_rel)}'>← Volver</a>"
    cards = []
    for item in items:
        rel = item.relative_to(order_root).as_posix()
        href = f"/nas/orden/{quote(order)}/{quote(rel)}"
        kind = "Carpeta" if item.is_dir() else "Archivo"
        icon = "▣" if item.is_dir() else "↧"
        cards.append(f"<a class='nas-item' href='{href}'><span>{icon}</span><div><strong>{escape(item.name)}</strong><small>{kind}</small></div></a>")
    content = "".join(cards) or "<div class='nas-empty'>Esta carpeta está vacía.</div>"
    breadcrumb = escape(target.relative_to(order_root).as_posix() or order_root.name)
    return HTMLResponse(f"""<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{escape(order)} · NAS Indoor</title><style>
    :root{{--lime:#d0f44c;--bg:#080b08;--panel:#111610;--line:rgba(208,244,76,.22);--muted:#98a393}}*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 85% 0,rgba(92,121,34,.16),transparent 35%),var(--bg);color:#f4f7f1;font-family:Inter,Arial,sans-serif}}header{{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);background:rgba(8,11,8,.94);backdrop-filter:blur(12px)}}header img{{width:125px}}header i{{width:28px;height:1px;background:var(--lime)}}header b{{color:var(--lime);letter-spacing:.08em}}main{{max-width:1180px;margin:auto;padding:34px 24px}}.nas-title{{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}}h1{{margin:0 0 7px;font-size:clamp(1.5rem,3vw,2.4rem)}}p{{margin:0;color:var(--muted)}}.nas-back{{display:inline-flex;margin-bottom:18px;padding:9px 13px;border:1px solid var(--line);border-radius:10px;color:#e9eee5;text-decoration:none}}.nas-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:12px}}.nas-item{{display:flex;align-items:center;gap:13px;min-height:76px;padding:15px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:var(--panel);color:#fff;text-decoration:none;transition:.18s}}.nas-item:hover{{transform:translateY(-2px);border-color:rgba(208,244,76,.5);background:#182016}}.nas-item>span{{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:10px;background:rgba(208,244,76,.12);color:var(--lime);font-size:1.15rem}}.nas-item div{{min-width:0}}.nas-item strong{{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.nas-item small{{display:block;margin-top:5px;color:var(--muted)}}.nas-empty{{padding:40px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}}</style></head><body><header><img src='/marca-indoor.svg' alt='Indoor'><i></i><b>NAS · ORDEN {escape(order.upper())}</b></header><main><div class='nas-title'><div><h1>{escape(order_root.name)}</h1><p>{breadcrumb}</p></div></div>{parent}<div class='nas-grid'>{content}</div></main></body></html>""")


@app.post("/api/cuenta/password")
def change_account_password(payload: dict = Body(...), username=Depends(authenticate)):
    current, password = payload.get("current"), payload.get("password")
    if not isinstance(current, str) or not isinstance(password, str) or not 6 <= len(password) <= 256:
        raise HTTPException(400, "La nueva contraseña debe tener entre 6 y 256 caracteres")
    with connect() as db:
        user = db.execute("SELECT password_hash FROM users WHERE name = ? COLLATE NOCASE", (username,)).fetchone()
        valid = password_matches(current, user["password_hash"]) if user else (
            username == os.getenv("APP_USER", "indoor") and bool(os.getenv("APP_PASSWORD", ""))
            and secrets.compare_digest(current, os.getenv("APP_PASSWORD", "")))
        if not valid:
            raise HTTPException(400, "La contraseña actual es incorrecta")
        if user:
            db.execute("UPDATE users SET password_hash = ? WHERE name = ? COLLATE NOCASE", (password_hash(password), username))
        else:
            db.execute("INSERT INTO users(name, process, password_hash, created_at) VALUES (?, ?, ?, ?)",
                       (username, "Administración", password_hash(password), datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def home(_=Depends(authenticate)):
    # These HTML strings also appear inside JavaScript template literals.
    from html import escape as html_escape
    def escape(value):
        return html_escape(value).replace('`', '&#96;').replace('$', '&#36;').replace('\\', '&#92;')
    with connect() as db:
        profile = db.execute("SELECT process FROM users WHERE name = ? COLLATE NOCASE", (_,)).fetchone()
    user_process = profile["process"] if profile else "Administración"
    user_initials = ''.join(part[0] for part in str(_).split()[:2]).upper()
    fabrics = json.loads(Path(__file__).with_name('fabrics.json').read_text(encoding='utf-8'))
    fabric_rows = ''.join("<tr><td>" + escape(item['code']) + "</td><td>" + escape(item['name']) + "</td><td aria-label='Stock sin registrar'>—</td></tr>" for item in fabrics)
    rows = "<tr class='empty-row'><td colspan='5'><div class='empty-icon'>↗</div><strong>Envía una orden para comenzar</strong><span>Aquí aparecerá únicamente el proceso actual.</span></td></tr>"
    return f"""<!doctype html><html lang='es'><head><meta charset='utf-8'>
    <meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>
    <meta name='theme-color' content='#050605'>
    {INPUT_CONTRAST_STYLE}
    <link rel='manifest' href='/manifest.webmanifest'><link rel='apple-touch-icon' href='/favicon.png'>
    <meta name='mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-status-bar-style' content='black'><meta name='apple-mobile-web-app-title' content='Indoor'>
    <link rel='icon' type='image/svg+xml' href='/favicon.svg?v=6'>
    <title>SISTEMA &quot;INDOOR SPORT&quot;</title><style>
    :root{{--lime:#d0f44c;--lime-2:#8eaa25;--metal:linear-gradient(135deg,#6f871d 0%,#d0f44c 24%,#efffa5 48%,#d0f44c 68%,#78921e 100%);--ink:#f7f9f2;--muted:#a7b0a0;--line:rgba(208,244,76,.22);--glass:rgba(20,24,19,.62);--panel:#11150f}}
    *{{box-sizing:border-box}} body{{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#050605;margin:0;color:var(--ink);font-size:16px;line-height:1.5;min-height:100vh;min-height:100dvh;overflow-x:hidden}}
    body:before,body:after{{content:"";position:fixed;z-index:-2;border-radius:50%;filter:blur(80px);opacity:.13;background:var(--lime)}}
    body:before{{width:360px;height:360px;left:-180px;top:130px}} body:after{{width:430px;height:430px;right:-240px;bottom:-180px}}
    .topbar{{position:fixed;z-index:90;inset:0 0 auto;height:4px;background:linear-gradient(90deg,#71891e,#d0f44c,#a7ca32,#d0f44c,#71891e);box-shadow:0 0 26px rgba(208,244,76,.32)}}
    main{{max-width:none;margin:0 0 0 248px;padding:18px 18px 68px;position:relative;transition:margin-left .24s ease}}
    main:before{{content:"";position:absolute;z-index:-1;inset:80px 12% auto;height:480px;background:radial-gradient(circle,rgba(208,244,76,.08),transparent 68%);filter:blur(22px)}}
    .sidebar{{position:fixed;z-index:80;inset:4px auto 0 0;width:248px;display:flex;flex-direction:column;background:linear-gradient(180deg,#11160f 0%,#080b08 100%);border-right:1px solid rgba(208,244,76,.24);box-shadow:18px 0 55px rgba(0,0,0,.38);transition:transform .24s ease}} body.sidebar-hidden .sidebar{{transform:translateX(-105%)}} body.sidebar-hidden main{{margin-left:0}} .sidebar-brand{{height:86px;display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}} .sidebar-brand img{{width:136px;height:52px;object-fit:contain;object-position:left center}} .session-card{{display:grid;grid-template-columns:48px 1fr;gap:11px;align-items:center;padding:18px 17px;border-bottom:1px solid var(--line);background:rgba(208,244,76,.045)}} .session-avatar{{display:grid;place-items:center;width:48px;height:48px;border:1px solid rgba(208,244,76,.5);border-radius:50%;background:var(--metal);color:#11150e;font-weight:950;letter-spacing:-.04em}} .session-copy strong,.session-copy span{{display:block}} .session-copy strong{{font-size:.83rem;color:#fff}} .session-copy span{{margin-top:2px;color:var(--muted);font-size:.72rem}} .sidebar-label{{padding:16px 18px 8px;color:#778272;font-size:.68rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}} .sidebar .tabs{{display:flex;flex-direction:column;align-items:stretch;gap:5px;margin:0;padding:0 10px;overflow:visible}} .nav-parent{{display:grid;grid-template-columns:34px 1fr auto;align-items:center;width:100%;padding:11px 10px;border:1px solid rgba(208,244,76,.17);border-radius:10px;background:rgba(208,244,76,.065);color:#f2f7ec;text-align:left;font:inherit;font-size:.79rem;font-weight:850;box-shadow:none}} .nav-parent:after{{content:'⌃';color:var(--lime);font-size:.9rem}} .nav-group.collapsed .nav-parent:after{{content:'⌄'}} .nav-group.collapsed .nav-children{{display:none}} .nav-children{{display:flex;flex-direction:column;gap:3px;margin:5px 0 9px 13px;padding-left:10px;border-left:1px solid rgba(208,244,76,.2)}} .sidebar .tab{{display:grid;grid-template-columns:34px 1fr auto;align-items:center;width:100%;padding:10px;border:1px solid transparent;border-radius:10px;background:transparent;color:#c8d0c3;text-align:left;font-size:.76rem}} .sidebar .tab strong{{font-size:.76rem}} .sidebar .tab:after{{content:'›';color:#809077;font-size:1.15rem;font-weight:900}} .sidebar .tab:hover{{background:rgba(208,244,76,.075);border-color:rgba(208,244,76,.16)}} .sidebar .tab.active{{background:linear-gradient(90deg,rgba(208,244,76,.2),rgba(208,244,76,.055));border-color:rgba(208,244,76,.35);color:#f3ffc5;box-shadow:inset 3px 0 0 var(--lime)}} .sidebar .tab.active:after{{color:var(--lime)}} .sidebar .production-nav{{margin-top:3px}} .nav-icon{{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:rgba(255,255,255,.055);color:var(--lime);font-size:.65rem;font-weight:950}} .sidebar-foot{{margin-top:auto;padding:15px 18px;border-top:1px solid var(--line);color:#6f796b;font-size:.69rem}} .menu-toggle{{display:grid;place-items:center;position:fixed;z-index:95;left:202px;top:18px;width:34px;height:34px;padding:0;border-radius:10px;background:rgba(10,14,9,.92);color:var(--lime);border-color:rgba(208,244,76,.4);box-shadow:0 8px 24px rgba(0,0,0,.38);transition:left .24s ease}} body.sidebar-hidden .menu-toggle{{left:14px;background:var(--metal);color:#11150e}}
    .brand{{position:sticky;top:4px;z-index:50;display:flex;align-items:center;gap:13px;margin:0;padding:8px 6px 13px;border-bottom:1px solid rgba(208,244,76,.18);background:linear-gradient(180deg,rgba(3,5,4,.98),rgba(3,5,4,.9));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}} .brand-logo{{display:block;width:125px;height:50px;overflow:hidden;flex:0 0 auto}} .brand-logo img{{display:block;width:100%;height:100%;object-fit:contain}} .brand-line{{width:32px;height:2px;background:linear-gradient(90deg,#748d1f,#d0f44c,#99b92a)}}
    .brand .systems{{margin-left:auto}}
    header{{display:block;text-align:center;margin:0 auto;padding:76px 20px 42px}}
    body.production-mode header{{display:none}} body.production-mode .panel[data-panel='produccion']{{margin-top:18px}}
    .eyebrow{{color:var(--lime);font-size:.76rem;font-weight:850;letter-spacing:.17em;text-transform:uppercase;margin-bottom:7px}}
    h1{{font-size:clamp(2.8rem,6vw,5.25rem);letter-spacing:-.065em;line-height:.96;margin:0 auto;color:#fff;max-width:960px}}
    .subtitle{{color:var(--muted);margin:18px auto 0;max-width:660px;font-size:1.03rem}}
    .systems{{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}}
    .system{{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid var(--line);border-radius:999px;padding:9px 13px;color:#e7ecdf;font-size:.82rem;font-weight:700;backdrop-filter:blur(14px)}}
    .system i,.state i{{width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#efffa5,#d0f44c 45%,#71891e);box-shadow:0 0 0 3px rgba(208,244,76,.13),0 0 9px rgba(208,244,76,.42)}}
    .workspace{{display:grid;grid-template-columns:minmax(330px,.82fr) minmax(0,1.55fr);gap:22px;align-items:stretch}}
    .card{{position:relative;background:linear-gradient(145deg,rgba(22,25,21,.94),rgba(7,9,7,.92));border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.055);overflow:hidden;backdrop-filter:blur(22px) saturate(125%);-webkit-backdrop-filter:blur(22px) saturate(125%)}}
    .card:before{{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,var(--lime),transparent);opacity:.45}}
    .card-head{{padding:24px 26px 0}} h2{{font-size:1.16rem;letter-spacing:-.015em;margin:0 0 5px;color:#fff}}
    .card-head p{{color:var(--muted);font-size:.91rem;margin:0}} .upload-wrap{{padding:20px 26px 26px}}
    .dropzone{{display:flex;min-height:230px;align-items:center;justify-content:center;text-align:center;border:1px dashed rgba(208,244,76,.5);border-radius:18px;background:rgba(255,255,255,.035);padding:28px 20px;cursor:pointer;transition:.2s ease}}
    .dropzone:hover,.dropzone.drag{{border-color:var(--lime);background:rgba(208,244,76,.075);transform:translateY(-1px);box-shadow:inset 0 0 40px rgba(208,244,76,.05)}}
    .upload-icon{{width:56px;height:56px;margin:0 auto 14px;border-radius:17px;display:grid;place-items:center;background:var(--metal);color:#10140d;border:1px solid #d0f44c;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 12px 28px rgba(208,244,76,.24)}}
    .upload-icon svg{{width:27px;height:27px}} .dropzone strong{{display:block;font-size:1rem;color:#fff}}
    .dropzone span{{display:block;color:var(--muted);font-size:.85rem;margin-top:5px}} input[type=file]{{position:absolute;opacity:0;pointer-events:none}}
    .selected{{display:none;margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(208,244,76,.1);border:1px solid rgba(208,244,76,.24);color:#eef0ed;font-size:.86rem;overflow-wrap:anywhere}}
    .selected.show{{display:block}} .actions{{display:flex;gap:10px;margin-top:14px}}
    button{{width:100%;border:1px solid #d0f44c;border-radius:12px;background:var(--metal);color:#111318;font:inherit;font-weight:900;padding:13px 18px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(0,0,0,.28),0 10px 24px rgba(208,244,76,.18);transition:.18s ease}}
    button:hover{{filter:brightness(1.05);transform:translateY(-1px)}} button:disabled{{opacity:.48;cursor:not-allowed;transform:none}}
    #creator-submit,#submit,#order-submit{{position:relative;overflow:hidden;transition:background .35s ease,color .2s ease}} #creator-submit.is-progress,#submit.is-progress,#order-submit.is-progress{{opacity:1;background:linear-gradient(90deg,#b5dc2d 0%,#d0f44c var(--creator-progress,5%),#20280e var(--creator-progress,5%),#0f1309 100%);color:#fff;border-color:#d0f44c;text-shadow:0 1px 3px #000,0 0 8px #000;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 0 30px rgba(208,244,76,.42);animation:creatorWorking .75s ease-in-out infinite alternate;padding-left:48px}} #creator-submit.is-progress:disabled,#submit.is-progress:disabled,#order-submit.is-progress:disabled{{cursor:progress}} #creator-submit.is-progress:before,#submit.is-progress:before,#order-submit.is-progress:before{{content:'';position:absolute;left:17px;top:50%;width:17px;height:17px;margin-top:-10px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;filter:drop-shadow(0 1px 2px #000);animation:progressSpin .7s linear infinite}} #creator-submit.is-progress:after,#submit.is-progress:after,#order-submit.is-progress:after{{content:'';position:absolute;inset:0;width:38%;transform:translateX(-150%) skewX(-20deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);animation:progressSweep 1.25s linear infinite;pointer-events:none}} @keyframes creatorWorking{{from{{filter:brightness(.9)}}to{{filter:brightness(1.18)}}}} @keyframes progressSpin{{to{{transform:rotate(360deg)}}}} @keyframes progressSweep{{to{{transform:translateX(390%) skewX(-20deg)}}}}
    .message{{display:none;margin-top:14px;padding:11px 13px;border-radius:11px;font-size:.86rem;font-weight:650}} .message.show{{display:block}}
    .message.ok{{background:rgba(208,244,76,.12);color:#eaff9a}} .message.error{{background:rgba(255,70,70,.12);color:#ffaaaa}}
    .history{{min-width:0;min-height:430px}} .history-head{{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:24px 26px 16px}}
    .history-head h2:before{{content:'01';display:inline-grid;place-items:center;width:34px;height:24px;margin-right:10px;border:1px solid rgba(208,244,76,.4);border-radius:999px;color:var(--lime);font-size:.65rem;letter-spacing:.08em;vertical-align:3px}}
    .history-head p{{margin:0;color:var(--muted);font-size:.84rem}} .refresh{{width:auto;padding:8px 12px;background:rgba(255,255,255,.08);color:#eef3e8;border:1px solid var(--line);box-shadow:none;font-size:.82rem}}
    .table-wrap{{overflow:auto}} table{{width:100%;border-collapse:collapse;min-width:700px}} th{{padding:11px 16px;background:rgba(255,255,255,.045);color:#adb7a6;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;text-align:left}}
    td{{padding:20px 16px;border-top:1px solid rgba(255,255,255,.09);vertical-align:middle;font-size:.86rem}} tbody tr:hover{{background:rgba(255,255,255,.035)}} .id{{color:var(--lime);font-variant-numeric:tabular-nums;font-weight:850}}
    .file-name{{display:block;max-width:235px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#f5f7ef}}
    .detail{{color:#aab3a5;max-width:310px;line-height:1.55}} .state{{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:7px 11px;font-size:.7rem;font-weight:850;letter-spacing:.03em;background:rgba(255,255,255,.08);color:#dce3d6}}
    .progress-track{{width:100%;height:6px;margin-top:10px;border-radius:99px;background:rgba(208,244,76,.1);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}} .progress-fill{{height:100%;border-radius:inherit;background:linear-gradient(90deg,#71891e,#d0f44c 48%,#a8ca34);box-shadow:0 0 16px rgba(208,244,76,.4);transition:width .45s ease}}
    .state i{{width:6px;height:6px;box-shadow:none;background:#8eaa25}} .state.completado{{background:rgba(208,244,76,.13);color:#eaff9a}} .state.completado i{{background:var(--lime)}}
    .state.procesando,.state.recibido{{background:rgba(100,170,255,.13);color:#a9d2ff}} .state.procesando i,.state.recibido i{{background:#73b5ff;animation:pulse 1.2s infinite}}
    .state.error,.state.revisar{{background:rgba(255,70,70,.12);color:#ffaaaa}} .state.error i,.state.revisar i{{background:#ff7070}}
    .preview-modal{{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}} .preview-modal.open{{display:flex}} .preview-dialog{{width:min(1180px,96vw);max-height:90vh;display:flex;flex-direction:column;border:1px solid rgba(208,244,76,.45);border-radius:20px;background:#0d100d;box-shadow:0 30px 90px rgba(0,0,0,.7),0 0 40px rgba(208,244,76,.12);overflow:hidden}} .preview-head{{display:grid;grid-template-columns:minmax(280px,.9fr) minmax(440px,1.4fr) auto;gap:20px;align-items:center;padding:16px 24px;border-bottom:1px solid var(--line)}} .preview-head h2{{font-size:1.25rem}} .preview-head p{{margin:5px 0 0;color:var(--muted);font-size:.88rem}} .preview-overview{{display:flex;align-items:center;gap:10px;min-width:0}} .preview-designs{{display:flex;gap:7px;flex:0 0 auto}} .preview-design{{position:relative;width:66px;height:66px;border:1px solid rgba(208,244,76,.4);border-radius:10px;overflow:hidden;background:#181d15}} .preview-design img{{width:100%;height:100%;object-fit:contain;background:#fff}} .preview-design span{{position:absolute;left:3px;bottom:3px;padding:2px 5px;border-radius:5px;background:rgba(0,0,0,.82);color:#fff;font-size:.62rem;font-weight:800}} .preview-no-design{{padding:8px 10px;border:1px dashed rgba(208,244,76,.32);border-radius:10px;color:var(--muted);font-size:.75rem;white-space:nowrap}} .preview-size-summary{{display:flex;flex:1;flex-wrap:wrap;align-items:center;justify-content:center;gap:7px;min-height:48px;padding:8px 10px;border:1px solid rgba(208,244,76,.28);border-radius:12px;background:rgba(208,244,76,.045)}} .size-total,.size-chip{{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;white-space:nowrap;font-size:.82rem;font-weight:850}} .size-total{{background:var(--lime);color:#0a0d08}} .size-chip{{border:1px solid rgba(208,244,76,.34);background:#181d15;color:#fff}} .size-chip b{{color:var(--lime)}} .preview-close{{width:auto;padding:7px 11px;background:transparent;color:#fff;border-color:var(--line);box-shadow:none}} .preview-content{{padding:18px 24px;overflow:auto}} .preview-sheet{{margin-bottom:22px}} .preview-sheet-title{{display:flex;align-items:center;gap:12px;margin-bottom:10px}} .preview-sheet-title input{{max-width:320px}} .preview-table{{width:100%;min-width:760px;border-collapse:separate;border-spacing:0}} .preview-table th{{position:sticky;top:0;z-index:1;background:#20251e}} .preview-table td{{padding:7px;border-top:1px solid rgba(255,255,255,.08)}} .preview-table input,.preview-table select{{width:100%;min-width:70px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#171b17;color:#fff;font:inherit}} .preview-table tr.warning td{{background:rgba(255,184,52,.08)}} .preview-row-actions{{width:46px;text-align:center}} .preview-delete{{width:auto;padding:6px 9px;background:transparent;color:#ffaaaa;border-color:rgba(255,90,90,.35);box-shadow:none}} .preview-warnings{{margin:0 0 14px;padding:11px 13px;border-radius:10px;background:rgba(255,184,52,.1);color:#ffd28a;font-size:.84rem}} .preview-actions{{display:flex;gap:10px;padding:16px 24px;border-top:1px solid var(--line)}} .preview-actions button{{width:auto;min-width:190px}} .preview-cancel{{background:#222722;color:#fff;border-color:var(--line);box-shadow:none}} @media(max-width:850px){{.preview-head{{grid-template-columns:1fr auto}}.preview-overview{{grid-column:1/-1;grid-row:2;align-items:stretch;flex-direction:column}}.preview-size-summary{{justify-content:flex-start}}}}
    .empty-row td{{height:245px;text-align:center;color:var(--muted)}} .empty-row strong,.empty-row span{{display:block}} .empty-row strong{{color:#eef3e8;margin-top:10px}} .empty-icon{{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;margin:auto;background:rgba(208,244,76,.12);color:var(--lime);font-weight:900}}
    .footer-note{{text-align:center;color:#778071;font-size:.75rem;margin-top:22px}}
    .tabs{{display:flex;align-items:center;gap:7px;margin-left:8px}}
    .tab{{width:auto;min-height:0;box-shadow:none;background:rgba(255,255,255,.035);color:#aeb5ab;padding:9px 12px;border:1px solid rgba(255,255,255,.12);border-radius:11px;text-align:center;font-size:.72rem;white-space:nowrap}}
    .tab strong{{display:block;color:inherit;font-size:.72rem;margin:0}} .tab small{{display:none}}
    .tab:hover{{background:rgba(208,244,76,.09);border-color:rgba(208,244,76,.38);filter:none}} .tab.active{{background:var(--metal);border-color:#d0f44c;color:#111318;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 5px 16px rgba(208,244,76,.18)}}
    .panel{{display:none;margin-left:0}} .panel.active{{display:grid}}
    .panel[data-panel='creador'].active,.panel[data-panel='produccion'].active{{display:block}} .creator-history{{display:none!important}} .creator-form{{width:100%}} .creator-workbook-name{{display:flex;align-items:center;gap:16px;max-width:720px;margin:0 auto 20px;padding:15px 18px;border:1px solid rgba(208,244,76,.42);border-radius:15px;background:linear-gradient(145deg,rgba(208,244,76,.1),rgba(12,14,13,.94))}} .creator-workbook-name label{{flex:0 0 auto;color:#fff;font-size:.82rem;font-weight:850}} .creator-workbook-name input{{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;padding:11px 12px;font:inherit;font-weight:750;outline:none}} .creator-cards{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;gap:16px;width:100%;padding:2px 2px 18px}} .creator-main-card,.excel-sheet{{width:100%;min-width:0}} #extra-sheets{{display:contents}} .creator-actions{{max-width:620px;margin:4px auto 0}}
    .production-shell{{overflow:hidden;border-radius:15px}} .production-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 16px;border-bottom:1px solid var(--line);background:#0c100b}} .production-title h2{{font-size:1.15rem;margin:0 0 2px}} .production-title p{{margin:0;color:var(--muted);font-size:.74rem}} .production-controls{{display:flex;align-items:center;gap:8px;min-width:min(690px,64vw)}} .production-search{{flex:1;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.055);color:#fff;padding:8px 10px;font:inherit;font-size:.82rem;outline:none;transition:.2s}} .production-search:focus{{border-color:var(--lime);box-shadow:0 0 0 3px rgba(208,244,76,.1)}} .production-zoom{{width:82px;flex:0 0 82px;border:1px solid rgba(208,244,76,.38);border-radius:9px;background:#151b12;color:#fff;padding:8px;font:inherit;font-size:.8rem;font-weight:800;outline:none;cursor:pointer}} .production-zoom:focus{{border-color:var(--lime)}} .production-zoom option{{background:#151b12;color:#fff}} .production-refresh,.production-connector{{width:auto;white-space:nowrap;padding:8px 11px;border:1px solid rgba(208,244,76,.38);border-radius:9px;background:rgba(208,244,76,.1);color:#efffb0;box-shadow:none;font:inherit;font-size:.8rem;font-weight:800;text-decoration:none;cursor:pointer}} .production-connector:hover{{border-color:var(--lime);background:rgba(208,244,76,.17)}} .production-kpis{{display:flex;align-items:center;gap:18px;padding:8px 16px;background:#10140e;border-bottom:1px solid rgba(255,255,255,.06)}} .production-kpi{{display:flex;align-items:center;gap:7px;padding:0;border:0;background:none}} .production-kpi span{{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}} .production-kpi strong{{color:var(--lime);font-size:.83rem}} .production-status{{margin-left:auto;color:#7f8a79;font-size:.69rem}} .production-x-scroll{{height:16px;overflow-x:auto;overflow-y:hidden;background:#0a0d09;border-bottom:1px solid rgba(208,244,76,.2)}} .production-x-scroll>div{{height:1px}} .production-table-wrap{{max-height:calc(100vh - 206px);max-height:calc(100dvh - 206px);min-height:430px;overflow:auto;background:#080a08;border-top:1px solid rgba(208,244,76,.18)}} .production-table{{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;zoom:var(--production-zoom,1);font-size:.76rem}} .production-table th{{position:sticky;z-index:3;min-width:96px;max-width:180px;padding:7px 7px;background:#182014;border-right:1px solid rgba(208,244,76,.17);border-bottom:1px solid rgba(208,244,76,.34);color:#d9e0d3;white-space:normal;text-align:center;line-height:1.25}} .production-table .production-groups th{{top:0;height:34px;background:linear-gradient(180deg,#27351d,#172012);color:#efffb0;font-size:.68rem;letter-spacing:.055em;text-transform:uppercase;box-shadow:inset 0 -2px rgba(208,244,76,.14)}} .production-table .production-groups th:nth-child(3n){{background:linear-gradient(180deg,#30391e,#202715)}} .production-table .production-groups th:nth-child(3n+1){{background:linear-gradient(180deg,#1d3425,#14251a)}} .production-table .production-columns th{{top:34px;height:42px;background:#151b12;color:#dce5d5;font-size:.65rem}} .production-table th.production-row-head{{min-width:58px;width:58px}} .production-table td{{height:38px;min-width:96px;max-width:190px;padding:6px 7px;border-right:1px solid rgba(255,255,255,.075);border-top:1px solid rgba(255,255,255,.075);color:#e9eee5;white-space:normal;overflow-wrap:anywhere;line-height:1.25;cursor:cell;transition:background .15s,color .15s}} .production-table td:first-child{{min-width:58px;width:58px;color:var(--lime);font-weight:850;text-align:center;cursor:default}} .production-table .production-frozen{{position:sticky;background:#0f140d}} .production-table th.production-frozen{{z-index:7;background:#182014}} .production-table td.production-frozen{{z-index:2}} .production-table .production-frozen-edge{{box-shadow:10px 0 18px rgba(0,0,0,.58),2px 0 0 rgba(208,244,76,.42)}} .production-table tr:nth-child(even) td{{background:#0b0e0b}} .production-table tr:nth-child(even) td.production-frozen{{background:#10150e}} .production-table tr:hover td,.production-table tr:hover td.production-frozen{{background:#1b2417}} .production-table tr.is-selected td,.production-table tr.is-selected td.production-frozen{{background:#25341b;box-shadow:inset 0 1px rgba(208,244,76,.18),inset 0 -1px rgba(208,244,76,.18)}} .production-table td.cell-positive{{background:rgba(126,164,25,.2);color:#efffb0;font-weight:800}} .production-table td.cell-warning{{background:rgba(255,174,0,.18);color:#ffd77f;font-weight:800;text-align:center}} .production-table td.cell-chip{{color:#dfff6f;font-weight:800}} .production-resp-select{{width:100%;min-width:72px;border:1px solid rgba(208,244,76,.4);border-radius:999px;background:linear-gradient(135deg,#243313,#17220f);color:#dfff6f;padding:5px 22px 5px 9px;font:inherit;font-weight:900;outline:none;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.22);transition:.2s}} .production-resp-select:hover,.production-resp-select:focus{{border-color:var(--lime);background:#2c4015;box-shadow:0 0 0 2px rgba(208,244,76,.14)}} .production-resp-select option{{background:#151b12;color:#fff}} .production-table td.is-editing{{padding:2px;background:#1a2415!important;box-shadow:inset 0 0 0 2px var(--lime)}} .production-cell-input{{width:100%;min-width:80px;height:32px;border:0;background:#f6f8f2;color:#10130e;padding:4px 6px;font:inherit;font-weight:750;outline:none}} .production-table td.is-saving{{opacity:.55;cursor:wait}} .production-table td.is-saved{{animation:cellSaved .8s ease}} @keyframes cellSaved{{50%{{background:#52720f;color:white;box-shadow:inset 0 0 0 2px var(--lime)}}}} .production-empty{{padding:50px 24px;text-align:center;color:var(--muted)}}
    .production-table td.semaphore-green,.production-table td.semaphore-yellow,.production-table td.semaphore-orange,.production-table td.semaphore-red{{position:relative;padding-left:24px;font-weight:900}} .production-table td.semaphore-green::before,.production-table td.semaphore-yellow::before,.production-table td.semaphore-orange::before,.production-table td.semaphore-red::before{{content:'';position:absolute;left:8px;top:50%;width:9px;height:9px;border-radius:50%;transform:translateY(-50%);box-shadow:0 0 8px currentColor}} .production-table td.semaphore-green{{color:#cfff67;background:rgba(58,145,38,.2)}} .production-table td.semaphore-green::before{{background:#74ef4b}} .production-table td.semaphore-yellow{{color:#ffe36b;background:rgba(218,167,0,.2)}} .production-table td.semaphore-yellow::before{{background:#ffd52f}} .production-table td.semaphore-orange{{color:#ffc078;background:rgba(218,111,0,.2)}} .production-table td.semaphore-orange::before{{background:#ff8a24}} .production-table td.semaphore-red{{color:#ff9189;background:rgba(200,45,35,.2)}} .production-table td.semaphore-red::before{{background:#ff5147}}
    .production-table td{{overflow:hidden}} .production-table th{{overflow:hidden}} .production-table td.production-frozen{{z-index:6!important;isolation:isolate;overflow:hidden!important;background:#0f140d!important;background-clip:border-box!important}} .production-table tr:nth-child(even) td.production-frozen{{background:#11170f!important}} .production-table tr:hover td.production-frozen{{background:#1b2417!important}} .production-table tr.is-selected td.production-frozen{{background:#25341b!important}} .production-table th.production-frozen{{z-index:10!important;isolation:isolate;overflow:hidden!important;background:#182014!important;background-clip:border-box!important}} .production-table .production-frozen-edge{{border-right:3px solid var(--lime)!important;box-shadow:18px 0 24px rgba(0,0,0,1)!important}}
    .production-table td.production-frozen.semaphore-green,.production-table td.production-frozen.semaphore-yellow,.production-table td.production-frozen.semaphore-orange,.production-table td.production-frozen.semaphore-red{{position:sticky!important}}
    .production-table .production-groups th{{background:linear-gradient(180deg,#222821,#171c17);color:#d8dfd3;box-shadow:inset 0 -2px #687b42}} .production-table .production-groups th:nth-child(3n){{background:linear-gradient(180deg,#252725,#191b19);box-shadow:inset 0 -2px #6f746a}} .production-table .production-groups th:nth-child(3n+1){{background:linear-gradient(180deg,#1e2725,#151c1a);box-shadow:inset 0 -2px #4d7770}} .production-table .production-columns th{{background:#151916;color:#cbd2c7}} .production-table td{{color:#d6dcd3}} .production-table td.cell-chip{{color:#d7ddd4}} .production-table tr:hover td,.production-table tr:hover td.production-frozen{{background:#171e18!important}} .production-table tr.is-selected td,.production-table tr.is-selected td.production-frozen{{background:#202a21!important;box-shadow:inset 0 1px rgba(185,211,112,.22),inset 0 -1px rgba(185,211,112,.22)}} .production-resp-select{{border-color:#4f5e43;background:#1a201a;color:#dce4d7;box-shadow:none}} .production-resp-select:hover,.production-resp-select:focus{{border-color:#9ab64b;background:#222b1d;box-shadow:0 0 0 2px rgba(154,182,75,.1)}} .production-table td.semaphore-green{{color:#dce6d8;background:rgba(71,128,58,.09)}} .production-table td.semaphore-yellow{{color:#e4dfd1;background:rgba(161,126,42,.09)}} .production-table td.semaphore-red{{color:#e5d8d6;background:rgba(148,63,55,.09)}} .production-table td.semaphore-green::before{{background:#79bd68;box-shadow:0 0 6px rgba(121,189,104,.55)}} .production-table td.semaphore-yellow::before{{background:#d2ae55;box-shadow:0 0 6px rgba(210,174,85,.5)}} .production-table td.semaphore-red::before{{background:#cf7169;box-shadow:0 0 6px rgba(207,113,105,.5)}}
    .production-row-open{{display:inline-flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:4px;min-width:46px;padding:5px 7px;border:1px solid rgba(208,244,76,.32);border-radius:8px;background:#182016;color:#d9ea9c;text-decoration:none;font-weight:900;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;transition:.18s}} .production-row-open span{{flex:0 0 auto;font-size:.75rem;opacity:.65}} .production-row-open:hover{{border-color:var(--lime);background:#26331d;color:#fff;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3)}}
    .file-pair{{display:grid;gap:10px}} .file-row{{position:relative;display:flex;align-items:flex-start;gap:12px;width:100%;min-width:0;padding:13px 14px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.04);cursor:pointer}}
    .file-row>div{{display:flex;flex-direction:column;gap:3px;min-width:0;width:100%}} .file-row:hover{{border-color:rgba(208,244,76,.55)}} .file-row b{{display:block;color:#fff;font-size:.87rem;line-height:1.35;overflow-wrap:anywhere}} .file-row span{{display:block;color:var(--muted);font-size:.78rem;line-height:1.4;white-space:normal;overflow-wrap:anywhere;word-break:break-word}} .file-row input{{inset:0;width:100%;height:100%;cursor:pointer}}
    .file-row.has-file{{border-color:#d0f44c;background:linear-gradient(135deg,rgba(208,244,76,.24),rgba(112,137,27,.13));box-shadow:inset 4px 0 0 #d0f44c,0 0 18px rgba(208,244,76,.12)}} .file-row.has-file:after{{content:'✓';display:grid;place-items:center;flex:0 0 25px;width:25px;height:25px;border-radius:50%;background:#d0f44c;color:#10140d;font-size:.84rem;font-weight:950;box-shadow:0 0 12px rgba(208,244,76,.38)}} .file-row.has-file span{{color:#dff986}} .dropzone.has-file{{border-color:#d0f44c;background:rgba(208,244,76,.12);box-shadow:inset 0 0 45px rgba(208,244,76,.08),0 0 20px rgba(208,244,76,.12)}}
    .mockup-slot{{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:stretch}} .mockup-slot[hidden]{{display:none}} .mockup-slot .file-row{{height:100%}}
    .add-mockup{{margin-top:2px;background:rgba(255,255,255,.045);color:#eef0ed;border:1px dashed rgba(208,244,76,.42);box-shadow:none}} .add-mockup:hover{{background:rgba(208,244,76,.1);filter:none}}
    .remove-mockup{{width:44px;padding:0;background:rgba(255,255,255,.04);color:#b8c0b5;border:1px solid var(--line);box-shadow:none;font-size:1.15rem}} .remove-mockup:hover{{color:#fff;background:rgba(255,90,90,.12);border-color:rgba(255,120,120,.35);filter:none}}
    .excel-sheet{{padding:0;border:1px solid var(--line);border-radius:22px;background:linear-gradient(145deg,#151815,#090b09);overflow:hidden}} .excel-sheet-head{{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}} .excel-sheet-head>div{{min-width:0}} .excel-sheet-head h2{{margin:0 0 6px;color:#fff;font-size:1.05rem}} .excel-sheet-head p{{margin:0;color:var(--muted);font-size:.8rem;line-height:1.45}} .remove-sheet{{width:auto;padding:7px 10px;background:rgba(255,255,255,.04);color:#c5ccc2;border-color:var(--line);box-shadow:none;font-size:.76rem;flex:0 0 auto}}
    .add-sheet{{width:100%;min-height:280px;margin:0;background:linear-gradient(145deg,rgba(208,244,76,.1),rgba(12,14,13,.94));color:#fff;border:1px dashed rgba(208,244,76,.48);box-shadow:none;font-size:1rem}} .add-sheet:hover{{background:rgba(208,244,76,.12);filter:none}}
    .form-grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}} .field{{display:flex;flex-direction:column;gap:6px;min-width:0}} .field.full{{grid-column:1/-1}} .field label{{font-size:.76rem;font-weight:800;color:#cfd6ca}} .field input,.field select,.field textarea{{width:100%;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.055);color:#fff;padding:11px 12px;font:inherit;font-size:.85rem;outline:none}} .field textarea{{min-height:82px;resize:vertical}} .field input:focus,.field select:focus,.field textarea:focus{{border-color:var(--lime)}} .field select option{{background:#161a15}} .download{{display:inline-block;margin-top:6px;color:var(--lime);font-weight:850;text-decoration:none}}
    @keyframes pulse{{50%{{opacity:.35}}}} @media(max-width:1120px){{.brand{{flex-wrap:wrap}}header{{padding-top:56px}}.workspace{{grid-template-columns:1fr}}.dropzone{{min-height:190px}}.creator-cards{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
    @media(max-width:720px){{.creator-cards{{grid-template-columns:1fr}}}}
    @media(max-width:860px){{main,body.sidebar-hidden main{{margin-left:0;padding-top:70px}}.sidebar,body.sidebar-hidden .sidebar{{transform:translateX(-105%)}}body.menu-open .sidebar{{transform:translateX(0)}}.menu-toggle,body.sidebar-hidden .menu-toggle{{left:14px;width:42px;height:42px;background:var(--metal);color:#11150e}}body.menu-open:after{{content:'';position:fixed;z-index:70;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px)}}.brand{{top:4px}}}}
    @media(max-width:620px){{main{{padding:70px 14px 44px}}header{{padding:38px 4px 34px}}.brand .eyebrow,.brand-line,.brand-logo{{display:none}}.brand .systems{{margin-left:auto}}.brand .systems .system:last-child{{display:none}}.card-head,.upload-wrap,.history-head{{padding-left:18px;padding-right:18px}}.system{{font-size:.72rem;padding:7px 10px}}.workspace{{gap:14px}}.creator-workbook-name{{align-items:stretch;flex-direction:column;gap:8px}}.production-toolbar{{align-items:stretch;flex-direction:column}}.production-controls{{min-width:0;width:100%}}.production-kpis{{grid-template-columns:1fr}}}}
    .production-connector{{font-size:0}} .production-connector::after{{content:'NAS';font-size:.8rem}}
    body.inventory-mode header{{display:none}}.fabric-card{{padding:24px;margin-top:20px}}.fabric-heading{{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}}.fabric-heading h2{{margin:8px 0}}.fabric-heading p{{color:#b7c2ae;font-size:.85rem}}#fabric-search{{width:min(100%,360px);padding:12px;background:#182014;color:#fff;border:1px solid #718b38;border-radius:10px;font:inherit}}.fabric-count{{margin:20px 0;color:#d0f44c;font-size:.85rem}}.fabric-table{{width:100%;border-collapse:collapse;table-layout:fixed}}.fabric-table th,.fabric-table td{{padding:14px 12px;text-align:left;border-bottom:1px solid #ffffff18;overflow-wrap:anywhere}}.fabric-table th{{background:#20291a;color:#d0f44c}}.fabric-table th:first-child{{width:100px}}.fabric-table td:first-child{{font-weight:800;color:#d0f44c}}.fabric-table tr:hover{{background:#d0f44c09}}.fabric-table tr[hidden]{{display:none}}@media(max-width:620px){{.fabric-card{{padding:16px}}.fabric-heading{{display:block}}#fabric-search{{margin-top:16px;width:100%}}.fabric-table td{{padding:12px 8px;font-size:.8rem}}}}
    .production-process-filter{{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#10160e;border-bottom:1px solid var(--line)}}.production-process-filter label{{font-size:.8rem;color:#d0f44c;font-weight:800}}.production-process-filter select{{min-width:220px;max-width:100%;padding:9px 12px;border:1px solid #657c32;border-radius:9px;background:#182014;color:#f3f7ed;font:inherit;font-size:.82rem}}@media(max-width:620px){{.production-process-filter select{{min-width:0;flex:1}}}}
    .user-menu{{position:relative;color:#efffb0}}.user-menu summary{{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;padding:7px 12px;border:1px solid var(--line);border-radius:24px;background:#151b12}}.user-menu summary::-webkit-details-marker{{display:none}}.user-avatar{{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:50%;background:#d0f44c;color:#10140d;font-weight:900}}.user-info{{display:grid;text-align:left;max-width:220px}}.user-info strong{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}}.user-info small,.user-dropdown p{{font-size:.72rem;color:#b4bfa9}}.user-dropdown{{position:absolute;right:0;top:calc(100% + 8px);width:230px;padding:12px;background:#151b12;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 30px #0008;z-index:1100}}.user-dropdown button,.user-dropdown a{{display:block;width:100%;text-align:left;padding:10px;background:transparent;color:#f0f5e8;border:0;box-shadow:none;text-decoration:none;font:inherit;font-size:.82rem}}.user-dropdown button:hover,.user-dropdown a:hover{{background:#28351b;border-radius:8px}}.account-dialog{{width:min(440px,92vw);padding:28px;background:#11180f;color:#f1f5eb;border:1px solid #8aa332;border-radius:20px}}.account-dialog::backdrop{{background:#000a}}.account-close{{float:right;width:auto;padding:3px 10px}}.account-dialog label{{display:block;margin:16px 0}}.account-dialog input{{display:block;width:100%;padding:12px;margin-top:6px;background:#1c2518;color:white;border:1px solid #77864a;border-radius:8px;font:inherit}}.account-dialog p{{color:#c5d5b8}}@media(max-width:620px){{.user-info small{{display:none}}.user-info{{max-width:140px}}.user-menu summary{{padding:5px 8px}}}}
    .brand .systems .session-user{{display:inline-flex;align-items:center;gap:8px;max-width:min(48vw,340px);padding:9px 14px;border:1px solid var(--line);border-radius:24px;background:#151b12;color:#efffb0;font-size:.8rem;overflow-wrap:anywhere}} .brand .systems .logout-link{{display:inline-flex!important;font-size:.74rem}}
    .production-table th{{min-width:124px;max-width:230px;padding:9px 11px;line-height:1.35}} .production-table td{{min-width:124px;max-width:230px;height:46px;padding:8px 11px;line-height:1.4}} .production-table th.production-row-head,.production-table td:first-child{{min-width:76px;width:76px;max-width:76px}} .production-table .production-columns th{{height:48px}} .production-table .production-groups th{{height:38px}}
    .production-table{{font-size:var(--production-body-font,.76rem);text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}} .production-table thead{{position:sticky;top:0;z-index:1000;isolation:isolate}} .production-table tbody{{position:relative;z-index:1}} .production-table th{{top:auto;z-index:1001!important;font-weight:900;text-shadow:0 1px 1px rgba(0,0,0,.85)}} .production-table thead th.production-frozen{{z-index:1002!important}} .production-table tbody td.production-frozen{{z-index:2}} .production-table .production-groups th{{font-size:var(--production-group-font,.68rem)}} .production-table .production-columns th{{font-size:var(--production-head-font,.65rem)}} .production-table td{{text-align:center;vertical-align:middle;font-weight:700;letter-spacing:.005em}} .production-table td .production-resp-select,.production-table td .production-cell-input{{text-align:center;text-align-last:center;font-size:inherit}}
    .production-line-select{{border-width:1px;color:#10140e!important;box-shadow:inset 0 1px rgba(255,255,255,.22)!important}} .production-line-select.line-empty{{background:#1a201a!important;color:#dce4d7!important}} .production-line-select.line-copa{{background:#eac878!important;border-color:#f4d995!important}} .production-line-select.line-mundial{{background:#eead78!important;border-color:#ffc59a!important}} .production-line-select.line-olimpica{{background:#88aaa4!important;border-color:#afd0ca!important}} .production-line-select.line-muestra{{background:#82c998!important;border-color:#a8dfb8!important}} .production-line-select.line-plus{{background:#b79bd8!important;border-color:#d1b9ec!important}} .production-line-select.line-bot{{background:#6f9fcd!important;border-color:#98bee2!important}} .production-line-select option{{background:#eef1ea;color:#121612}}
    .production-table td.is-active-cell{{outline:2px solid var(--lime);outline-offset:-2px;background:#26301f!important}}
    @media(max-width:620px){{html{{max-width:100%;overflow-x:hidden;overflow-y:auto;touch-action:pan-y}}html body.schedule-mode{{max-width:100vw;overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y;-webkit-overflow-scrolling:touch}}html body.schedule-mode main,html body.schedule-mode .schedule-shell,html body.schedule-mode .schedule-grid{{max-width:100%;overflow-x:hidden!important;touch-action:pan-y}}html body.schedule-mode .schedule-events{{overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y}}}}
    @media(max-width:620px){{body.schedule-mode{{overflow-x:hidden;overflow-y:auto}}body.schedule-mode main{{width:100%;margin:0;padding:68px 7px 18px}}body.schedule-mode .brand{{left:58px;right:8px;width:auto;padding:8px}}body.schedule-mode .brand .systems{{gap:5px}}body.schedule-mode .system{{padding:6px 8px;font-size:.62rem}}body.schedule-mode .schedule-shell{{width:100%;overflow:hidden!important;border-radius:13px}}body.schedule-mode .schedule-toolbar{{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:12px 10px}}body.schedule-mode .schedule-title{{min-width:0}}body.schedule-mode .schedule-title .eyebrow{{font-size:.55rem;letter-spacing:.1em}}body.schedule-mode .schedule-title h2{{font-size:1.12rem;white-space:nowrap}}body.schedule-mode .schedule-title p{{font-size:.65rem;line-height:1.35}}body.schedule-mode .schedule-actions{{gap:4px}}body.schedule-mode .schedule-actions button{{min-width:32px;padding:7px 8px;font-size:.7rem}}body.schedule-mode .schedule-summary{{gap:8px;padding:7px 9px}}body.schedule-mode .schedule-summary strong{{font-size:.78rem;white-space:nowrap}}body.schedule-mode .schedule-summary span{{font-size:.59rem;text-align:right}}body.schedule-mode .schedule-weekdays,body.schedule-mode .schedule-grid{{width:100%;min-width:0!important;grid-template-columns:repeat(7,minmax(0,1fr))!important}}body.schedule-mode .schedule-weekdays div{{min-width:0;padding:6px 1px;font-size:.5rem}}body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,82px)}}body.schedule-mode .schedule-day{{min-width:0;height:auto!important;padding:3px 2px}}body.schedule-mode .schedule-day-number{{width:19px;height:19px;margin:0 1px 2px auto;font-size:.58rem}}body.schedule-mode .schedule-events{{max-height:56px;overflow-y:auto;overflow-x:hidden;gap:2px}}body.schedule-mode .schedule-event{{min-width:0;padding:3px 1px;border-radius:5px}}body.schedule-mode .schedule-event strong{{font-size:.48rem;letter-spacing:-.02em;white-space:normal;line-height:1.15}}}}
    .system.logout-link{{color:#ffb0aa;text-decoration:none;border-color:rgba(255,104,94,.3)}} .system.logout-link:hover{{background:rgba(255,104,94,.1);border-color:#ff746b}}
    .production-delete-row{{display:inline-grid;place-items:center;flex:0 0 29px;width:29px;height:29px;padding:0;border:1px solid rgba(255,103,94,.65);border-radius:8px;background:#251210;color:#ff8c84;font-size:16px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-delete-row:hover{{background:#481b17;color:#fff;border-color:#ff746b;filter:none}} body.production-mode .production-table th.production-row-head,body.production-mode .production-table td:first-child{{min-width:154px!important;width:154px!important;max-width:154px!important}}
    body.schedule-mode .schedule-events{{overflow-x:hidden}} body.schedule-mode .schedule-event{{text-align:center;white-space:nowrap}} body.schedule-mode .schedule-event strong{{font-size:.72rem;overflow:hidden;text-overflow:ellipsis}}
    html{{scroll-behavior:auto}}body{{text-rendering:optimizeLegibility}}main,.brand,.panel,.card{{transform:translateZ(0)}}.panel.active{{animation:panelReveal .18s ease-out}}@keyframes panelReveal{{from{{opacity:.72;transform:translateY(3px)}}to{{opacity:1;transform:none}}}}.production-table-wrap,.production-x-scroll,.schedule-events{{-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-gutter:stable}}.production-table-wrap{{contain:layout paint;touch-action:pan-x pan-y}}.production-table td,.production-table th{{backface-visibility:hidden}}button,.tab,.nav-parent,.production-row-open,.file-row,.schedule-event{{transition-duration:.14s!important}}@media(prefers-reduced-motion:reduce){{*,*::before,*::after{{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}}}@media(max-width:860px){{.sidebar,.brand{{will-change:transform}}body.menu-open:after{{backdrop-filter:none!important}}}}
    body.schedule-mode{{overflow:hidden}} body.schedule-mode main{{padding-top:18px;padding-bottom:0}} body.schedule-mode .schedule-toolbar{{padding-top:14px;padding-bottom:14px}} body.schedule-mode .schedule-title h2{{margin-top:2px;margin-bottom:3px}} body.schedule-mode .schedule-summary{{padding-top:8px;padding-bottom:8px}} body.schedule-mode .schedule-weekdays div{{padding-top:7px;padding-bottom:7px}} body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,minmax(68px,calc((100dvh - 352px)/6)))}} body.schedule-mode .schedule-day{{min-height:0;height:auto;padding:6px 8px}} body.schedule-mode .schedule-day-number{{height:20px;margin-bottom:3px}} body.schedule-mode .schedule-events{{gap:3px;max-height:calc(100% - 23px);overflow:auto;scrollbar-width:thin}} body.schedule-mode .schedule-event{{padding:4px 6px}}
    body.schedule-mode header{{display:none}} .panel[data-panel='cronograma'].active{{display:block}} .schedule-shell{{overflow:hidden;border-radius:18px}} .schedule-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 26px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#121810,#0b0e0b)}} .schedule-title h2{{margin:4px 0 5px;font-size:1.45rem}} .schedule-title p{{color:var(--muted);font-size:.84rem}} .schedule-actions{{display:flex;gap:8px}} .schedule-actions button{{width:auto;min-width:42px;padding:9px 13px;background:#171e14;color:#efffb0;border:1px solid rgba(208,244,76,.38);box-shadow:none}} .schedule-actions button:hover{{background:#243019;filter:none}} .schedule-summary{{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;background:#10150e;border-bottom:1px solid var(--line)}} .schedule-summary strong{{color:var(--lime);font-size:1rem;text-transform:capitalize}} .schedule-summary span{{color:var(--muted);font-size:.78rem}} .schedule-weekdays,.schedule-grid{{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}} .schedule-weekdays{{background:#161d13;border-bottom:1px solid var(--line)}} .schedule-weekdays div{{padding:10px 8px;text-align:center;color:#aeb9a7;font-size:.66rem;font-weight:900;letter-spacing:.08em}} .schedule-day{{min-height:126px;padding:9px;border-right:1px solid rgba(255,255,255,.075);border-bottom:1px solid rgba(255,255,255,.075);background:#0d110d;overflow:hidden}} .schedule-day:nth-child(7n){{border-right:0}} .schedule-day.outside{{background:#090c09;color:#596255}} .schedule-day.today{{box-shadow:inset 0 0 0 2px var(--lime)}} .schedule-day-number{{display:grid;place-items:center;width:25px;height:25px;margin:0 0 7px auto;border-radius:50%;font-size:.75rem;font-weight:900}} .schedule-day.today .schedule-day-number{{background:var(--lime);color:#10140d}} .schedule-events{{display:grid;gap:5px}} .schedule-event{{width:100%;padding:6px 7px;border:1px solid rgba(208,244,76,.28);border-radius:7px;background:#1b2516;color:#edf6e8;box-shadow:none;text-align:left;line-height:1.25;cursor:pointer}} .schedule-event:hover{{background:#29371e;filter:none;border-color:var(--lime)}} .schedule-event strong{{display:block;color:#dfff75;font-size:.7rem}} .schedule-event span{{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cad3c4;font-size:.64rem}} @media(max-width:900px){{.schedule-day{{min-height:95px;padding:5px}}.schedule-event span{{display:none}}}} @media(max-width:620px){{.schedule-toolbar{{align-items:flex-start;flex-direction:column;padding:18px}}.schedule-grid,.schedule-weekdays{{min-width:720px}}.schedule-shell{{overflow:auto}}}}
    .production-table td.delivery-days-cell{{position:sticky!important;z-index:30!important;text-align:center!important;font-size:.82rem!important;font-weight:950!important;opacity:1!important}} .production-table td.delivery-days-cell.semaphore-green{{color:#dfffc4!important;background:#193719!important}} .production-table td.delivery-days-cell.semaphore-orange{{color:#ffe0b3!important;background:#4a2d12!important}} .production-table td.delivery-days-cell.semaphore-red{{color:#ffd0cc!important;background:#461a18!important}} .production-table td.delivery-days-cell::before{{display:block!important}} .production-table tr.row-semaphore-green td:not(.delivery-days-cell){{background:rgba(42,104,38,.16)!important}} .production-table tr.row-semaphore-orange td:not(.delivery-days-cell){{background:rgba(151,85,22,.16)!important}} .production-table tr.row-semaphore-red td:not(.delivery-days-cell){{background:rgba(133,43,38,.16)!important}} .production-table tr.row-semaphore-green:hover td:not(.delivery-days-cell){{background:rgba(53,126,47,.24)!important}} .production-table tr.row-semaphore-orange:hover td:not(.delivery-days-cell){{background:rgba(177,99,27,.24)!important}} .production-table tr.row-semaphore-red:hover td:not(.delivery-days-cell){{background:rgba(158,52,46,.24)!important}} .production-table th.production-row-head,.production-table td:first-child{{min-width:112px!important;width:112px!important;max-width:112px!important}} .production-row-tools{{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;white-space:nowrap}} .production-drag-handle{{display:inline-grid;place-items:center;flex:0 0 29px;width:29px;height:29px;padding:0;border:1px solid #769329;border-radius:8px;background:#11170e;color:#d0f44c;font-size:16px;line-height:1;cursor:grab;user-select:none;touch-action:none;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-row-tools .production-row-open{{flex:0 0 auto;min-width:50px;border-color:#9abb36;background:#263119;color:#f1ffb8;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-drag-handle:hover{{background:#253218;border-color:#d0f44c}} .production-drag-handle:active{{cursor:grabbing}} .production-table tr.is-dragging{{opacity:.45}} .production-table tr.drag-target td{{box-shadow:inset 0 2px #d0f44c!important}}

    /* Móvil y pantalla completa */
    .schedule-units .u-full,.schedule-units .u-short{{display:inline!important}}.schedule-units .u-short{{display:none!important}}
    @media(max-width:700px){{.schedule-units .u-full{{display:none!important}}.schedule-units .u-short{{display:inline!important}}}}
    @media(max-width:860px){{
      .sidebar-brand{{padding-left:68px}}
      .sidebar{{width:min(300px,86vw);padding-bottom:env(safe-area-inset-bottom)}}
      main,body.sidebar-hidden main,body.schedule-mode main,body.production-mode.trace-cards-mode main{{padding-left:max(8px,env(safe-area-inset-left))!important;padding-right:max(8px,env(safe-area-inset-right))!important}}
      body.schedule-mode main,body.production-mode main{{padding-bottom:env(safe-area-inset-bottom)!important}}
    }}
    @media(max-width:620px){{main{{padding-top:64px}}.card{{border-radius:16px}}}}
    /* Trazabilidad en móvil: encabezado compacto para que las tarjetas usen la pantalla */
    @media(max-width:860px){{
      body.production-mode.trace-cards-mode .production-title p,
      body.production-mode.trace-cards-mode .production-status,
      body.production-mode.trace-cards-mode .production-zoom-group,
      body.production-mode.trace-cards-mode .production-tools-menu{{display:none!important}}
      body.production-mode.trace-cards-mode .production-toolbar{{gap:8px;padding:10px 12px}}
      body.production-mode.trace-cards-mode .production-title h2{{margin:0;font-size:1.05rem}}
      body.production-mode.trace-cards-mode .production-controls{{display:flex;flex-wrap:nowrap;gap:8px;width:100%;min-width:0}}
      body.production-mode.trace-cards-mode .production-search{{flex:1 1 auto;min-width:0;width:auto}}
      body.production-mode.trace-cards-mode .production-controls button{{flex:0 0 auto;white-space:nowrap}}
      body.production-mode.trace-cards-mode .production-process-filter{{flex-wrap:nowrap;overflow-x:auto;gap:8px;padding:8px 12px;-webkit-overflow-scrolling:touch}}
      body.production-mode.trace-cards-mode .production-process-filter>label{{display:none}}
      body.production-mode.trace-cards-mode .production-process-filter select{{flex:1 0 150px;min-width:150px}}
      body.production-mode.trace-cards-mode .production-process-filter button{{flex:0 0 auto;white-space:nowrap}}
      body.production-mode.trace-cards-mode .production-kpis{{padding:6px 12px;gap:14px}}
    }}
    @media(hover:none) and (pointer:coarse){{.tab,.nav-parent,.user-menu summary,.menu-toggle{{min-height:44px}}input,select,textarea{{font-size:16px}}}}
    </style></head><body class='schedule-mode'><div class='topbar'></div><button id='menu-toggle' class='menu-toggle' type='button' aria-label='Ocultar menú' aria-expanded='true'>‹</button><aside class='sidebar' aria-label='Menú principal'><div class='sidebar-brand'><img src='/marca-indoor.svg' alt='Indoor'></div><div class='session-card'><div class='session-avatar'>IS</div><div class='session-copy'><strong>INDOOR SPORT SAS</strong><span>Panel operativo</span></div></div><div class='sidebar-label'>Menú principal</div><nav class='tabs' aria-label='Navegación principal'><button class='tab schedule-nav active' data-kind='cronograma' type='button'><span class='nav-icon'>CR</span><strong>CRONOGRAMA</strong></button><div class='nav-group'><button id='commercial-toggle' class='nav-parent' type='button'><span class='nav-icon'>AC</span><span>Asistentes Comerciales</span></button><div class='nav-children'><button class='tab' data-kind='reprogramacion' type='button'><span class='nav-icon'>RP</span><strong>Reprogramaciones</strong></button><button class='tab' data-kind='pedido' type='button'><span class='nav-icon'>PN</span><strong>Pedidos normales</strong></button><button class='tab' data-kind='creador' type='button'><span class='nav-icon'>XL</span><strong>Creador XLSX</strong></button></div></div><div class='nav-group collapsed'><button id='production-toggle' class='nav-parent' type='button'><span class='nav-icon'>PR</span><span>Producción</span></button><div class='nav-children'><button class='tab production-nav' data-kind='produccion' type='button'><span class='nav-icon'>TR</span><strong>TRAZABILIDAD</strong></button><button class='tab' data-kind='inventario' type='button'><span class='nav-icon'>IT</span><strong>INVENTARIO TELAS</strong></button></div></div></nav><div class='sidebar-foot'>Indoor Sport · Operación interna</div></aside><main>
    <section class='panel' data-panel='inventario'><div class='card fabric-card'><div class='fabric-heading'><div><span class='eyebrow'>Producción · Catálogo</span><h2>INVENTARIO TELAS</h2><p>Consulta las telas y sus códigos.</p></div><input id='fabric-search' type='search' placeholder='Buscar tela o código' aria-label='Buscar tela o código'></div><div id='fabric-count' class='fabric-count' role='status'>{len(fabrics)} telas registradas</div><table class='fabric-table'><thead><tr><th scope='col'>Código</th><th scope='col'>Tela</th><th scope='col'>STOCK</th></tr></thead><tbody id='fabric-body'>{fabric_rows}</tbody></table><p id='fabric-empty' hidden>No se encontraron telas con esa búsqueda.</p></div></section>
    <div class='brand'><span class='brand-logo' aria-label='Indoor'><img src='/marca-indoor.svg' alt='Indoor'></span><span class='brand-line'></span><span class='eyebrow'>Panel operativo</span><div class='systems'><span class='session-user' aria-label='Usuario conectado'>{escape(str(_))}</span></div></div>
    <header><div><div class='eyebrow'>Asistentes comerciales</div><h1>Convierte documentos<br>en órdenes listas.</h1><p class='subtitle'>Tres flujos especializados, una sola operación y seguimiento en tiempo real.</p></div></header>
    <section class='panel active' data-panel='cronograma'><div class='card schedule-shell'><div class='schedule-toolbar'><div class='schedule-title'><span class='eyebrow'>Planeación de entregas</span><h2>CRONOGRAMA</h2><p>Fechas de entrega de todos los pedidos registrados en Producción.</p></div><div class='schedule-actions'><button id='schedule-prev' type='button' aria-label='Mes anterior'>‹</button><button id='schedule-today' type='button'>Hoy</button><button id='schedule-next' type='button' aria-label='Mes siguiente'>›</button></div></div><div class='schedule-summary'><strong id='schedule-month'>—</strong><span id='schedule-count'>Cargando pedidos…</span></div><div class='schedule-weekdays'><div>LUN</div><div>MAR</div><div>MIÉ</div><div>JUE</div><div>VIE</div><div>SÁB</div><div>DOM</div></div><div id='schedule-grid' class='schedule-grid'></div></div></section>
    <section class='workspace panel' data-panel='reprogramacion'><div class='card'><div class='card-head'><h2>Nueva reprogramación</h2><p>Selecciona una cotización, remisión o listado en PDF o Excel.</p></div><div class='upload-wrap'>
    <form id='upload-form' method='post' action='/procesar' enctype='multipart/form-data'>
    <label class='dropzone' id='dropzone' for='archivo'><div><div class='upload-icon'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' aria-hidden='true'><path d='M12 16V4m0 0L7 9m5-5 5 5'/><path d='M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'/></svg></div><strong>Arrastra el PDF o Excel aquí</strong><span>o haz clic para buscar · máximo 25 MB</span></div></label>
    <input required id='archivo' type='file' name='archivo' accept='application/pdf,.pdf,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'><div id='selected' class='selected'></div>
    <label class='file-row' style='margin-top:14px'><div><b>MOCKUP OBLIGATORIO</b><span id='repro-extras-label'>Adjunta la imagen que aparecerá en la tarjeta</span></div><input id='repro-extras' type='file' name='extras' accept='image/*,.ai,.eps,.svg' multiple required></label>
    <div class='actions'><button id='submit' type='submit' disabled>Procesar documento</button></div><div id='message' class='message' role='status' aria-live='polite'></div></form></div></div>
    <div class='card history'><div class='history-head'><div><h2>Orden actual</h2><p class='count'>Sin una orden seleccionada</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Archivo</th><th>Orden</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id='jobs'>{rows}</tbody></table></div></div></section>
    <section class='workspace panel' data-panel='pedido'><div class='card'><div class='card-head'><h2>Nuevo pedido normal</h2><p>Sube juntos el PDF y el Excel de la misma orden. Puedes añadir imágenes u otros anexos.</p></div><div class='upload-wrap'>
    <form id='order-form' method='post' action='/procesar/pedido' enctype='multipart/form-data'><div class='file-pair'>
    <label class='file-row'><div><b>Documento PDF</b><span id='pdf-label'>Seleccionar cotización o remisión</span></div><input required id='pedido-pdf' type='file' name='pdf' accept='application/pdf,.pdf'></label>
    <label class='file-row'><div><b>Listado Excel</b><span id='excel-label'>Seleccionar archivo .xlsx o .xlsm</span></div><input required id='pedido-excel' type='file' name='excel' accept='.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'></label>
    <label class='file-row'><div><b>MOCKUP OBLIGATORIO Y ANEXOS</b><span id='extras-label'>Adjunta la imagen que aparecerá en la tarjeta</span></div><input id='pedido-extras' type='file' name='extras' multiple required></label></div>
    <div class='actions'><button id='order-submit' type='submit' disabled>Procesar pedido</button></div><div id='order-message' class='message' role='status' aria-live='polite'></div></form></div></div>
    <div class='card history'><div class='history-head'><div><h2>Pedido actual</h2><p class='count'>Sin un pedido seleccionado</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Archivos</th><th>Orden</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id='order-jobs'></tbody></table></div></div></section>
    <section class='workspace panel' data-panel='creador'><form class='creator-form' id='creator-form' method='post' action='/crear-xlsx' enctype='multipart/form-data'><div class='creator-workbook-name'><label for='creator-name'>Nombre del archivo Excel</label><input id='creator-name' type='text' name='nombre_archivo' maxlength='120' placeholder='Ej. LISTADO ASCUN 2026' required></div><div class='creator-cards'><div class='card creator-main-card'><div class='card-head'><h2>CREADOR XLSX</h2><p>Sube la foto de datos y el mockup principal de esta pestaña.</p></div><div class='upload-wrap'>
    <div class='field full' style='margin-bottom:14px'><label for='first-sheet-name'>Nombre de la pestaña</label><input id='first-sheet-name' class='sheet-name-input' type='text' name='nombre_hoja' maxlength='31' placeholder='Ej. UNIFORME NEGRO'></div><div class='file-pair'>
    <label class='file-row' style='border-color:rgba(208,244,76,.5);background:rgba(208,244,76,.07)'><div><b>Archivo con los datos del listado</b><span id='datos-label'>Excel, Word, PDF, CSV, TXT, JPG o PNG</span></div><input id='datos-listado' type='file' name='datos' accept='.xlsx,.xls,.xlsm,.doc,.docx,.pdf,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff' required></label>
    <label class='file-row'><div><b>D1 · Mockup principal (opcional)</b><span id='d1-label'>JPG o PNG · se insertará en la celda S3</span></div><input id='d1' type='file' name='d1' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label>
    <div class='mockup-slot' data-design='2' hidden><label class='file-row'><div><b>D2 · Segundo diseño (opcional)</b><span id='d2-label'>JPG o PNG · se insertará en la celda Y3</span></div><input id='d2' type='file' name='d2' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D2' title='Quitar mockup'>×</button></div>
    <div class='mockup-slot' data-design='3' hidden><label class='file-row'><div><b>D3 · Tercer diseño (opcional)</b><span id='d3-label'>JPG o PNG · se insertará en la celda AE3</span></div><input id='d3' type='file' name='d3' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D3' title='Quitar mockup'>×</button></div>
    <div class='mockup-slot' data-design='4' hidden><label class='file-row'><div><b>D4 · Cuarto diseño (opcional)</b><span id='d4-label'>JPG o PNG · se insertará en la celda AK3</span></div><input id='d4' type='file' name='d4' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D4' title='Quitar mockup'>×</button></div>
    <button class='add-mockup' id='add-mockup' type='button'>＋ Agregar otro mockup</button></div></div></div>
    <div id='extra-sheets'></div><button class='add-sheet' id='add-excel-sheet' type='button'>＋ Agregar pestaña de Excel</button></div>
    <div class='creator-actions'><div class='actions'><button id='creator-submit' type='submit'>Crear listado XLSX</button></div><div id='creator-message' class='message' role='status' aria-live='polite'></div></div></form>
    <div class='card history creator-history' aria-hidden='true'><div class='history-head'><div><h2>Listado actual</h2><p class='count'>Sin un listado seleccionado</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Referencia</th><th>Orden</th><th>Estado</th><th>Resultado</th></tr></thead><tbody id='creator-jobs'></tbody></table></div></div></section>
    <section class='panel' data-panel='produccion'><div class='card production-shell'><div class='production-toolbar'><div class='production-title'><h2>Producción</h2><p>Órdenes de producción desde la fila 726 · doble clic para editar</p></div><div class='production-controls'><input id='production-search' class='production-search' type='search' placeholder='Buscar cliente, orden, referencia o responsable'><a class='production-connector' href='/descargar-conector-nas' title='Instalar una sola vez en este PC'>Instalar conexión NAS</a><select id='production-zoom' class='production-zoom' aria-label='Tamaño de la tabla'><option value='0.5'>50%</option><option value='0.6'>60%</option><option value='0.75'>75%</option><option value='0.9'>90%</option><option value='1' selected>100%</option><option value='1.25'>125%</option><option value='1.5'>150%</option></select><button id='production-refresh' class='production-refresh' type='button'>Actualizar</button></div></div><div class='production-kpis'><div class='production-kpi'><span>Registros visibles</span><strong id='production-records'>—</strong></div><div class='production-kpi'><span>Unidades</span><strong id='production-units'>—</strong></div><div id='production-status' class='production-status'>Abre esta pestaña para consultar la información.</div></div><div id='production-x-scroll' class='production-x-scroll' aria-label='Desplazamiento horizontal de procesos'><div id='production-x-scroll-inner'></div></div><div class='production-table-wrap' id='production-table-wrap'><table class='production-table' id='production-table'><thead id='production-head'></thead><tbody id='production-body'></tbody></table><div id='production-empty' class='production-empty' hidden>No hay registros para mostrar.</div></div></div></section>
    <div id='preview-modal' class='preview-modal' role='dialog' aria-modal='true' aria-labelledby='preview-title'><div class='preview-dialog'><div class='preview-head'><div><h2 id='preview-title'>Revisar datos antes de crear</h2><p>Corrige cualquier valor. El Excel se generará exactamente con estas filas.</p></div><div class='preview-overview'><div id='preview-designs' class='preview-designs'></div><div id='preview-size-summary' class='preview-size-summary' aria-live='polite'></div></div><button id='preview-close' class='preview-close' type='button'>Cerrar</button></div><div id='preview-content' class='preview-content'></div><div class='preview-actions'><button id='preview-confirm' type='button'>Confirmar y crear XLSX</button><button id='preview-cancel' class='preview-cancel' type='button'>Volver a los archivos</button></div></div></div>
    <p class='footer-note'>Los documentos se procesan de forma segura en el servidor de Indoor.</p></main><script>
    const deleteProductionAllowed={json.dumps(can_delete_production_profile(user_process))};
    const form=document.getElementById('upload-form'),input=document.getElementById('archivo'),drop=document.getElementById('dropzone'),selected=document.getElementById('selected'),submit=document.getElementById('submit'),message=document.getElementById('message'),reproExtras=document.getElementById('repro-extras');
    const tbody=document.getElementById('jobs'),orderBody=document.getElementById('order-jobs'),creatorBody=document.getElementById('creator-jobs'); let allJobs=[],hydratedCreatorJob=0;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}}[c]));
    function choose(file){{if(!file)return;const ext=file.name.toLowerCase().split('.').pop();if(!['pdf','xlsx','xlsm'].includes(ext)){{show('Selecciona un archivo PDF, XLSX o XLSM válido.','error');input.value='';drop.classList.remove('has-file');submit.disabled=true;return}} if(file.size>25*1024*1024){{show('El archivo supera el límite de 25 MB.','error');input.value='';drop.classList.remove('has-file');submit.disabled=true;return}} selected.textContent=file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB';selected.classList.add('show');drop.classList.add('has-file');submit.disabled=false;message.className='message'}}
    function show(text,type){{message.textContent=text;message.className='message show '+type}}
    document.addEventListener('change',event=>{{const field=event.target;if(!field.matches('input[type="file"]'))return;const row=field.closest('.file-row');if(row){{row.classList.toggle('has-file',field.files.length>0);const label=row.querySelector('span');if(label&&field.files.length)label.textContent=field.files.length===1?field.files[0].name:field.files.length+' archivos seleccionados'}}}});
    input.addEventListener('change',()=>{{choose(input.files[0]);if(input.files.length){{localStorage.removeItem(currentKeys.reprogramacion);resetProgressButton(submit,'Procesar documento')}}}}); ['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{{x.preventDefault();drop.classList.add('drag')}})); ['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{{x.preventDefault();drop.classList.remove('drag')}}));
    function accumulateAttachments(field){{
      let files=[];
      const row=field.closest('.file-row'),list=document.createElement('div'),hint=document.createElement('p');
      list.className='attachment-list';list.setAttribute('aria-label','Archivos seleccionados');
      hint.textContent='Anexos adicionales: puedes añadir archivos de distintas carpetas. Los mockups se cargan arriba, en D1–D4 (hasta 10 MB por imagen).';
      hint.style.cssText='font-size:12px;color:#aebcae;line-height:1.5;margin:8px 0';
      row.after(hint,list);
      function sync(){{
        const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));field.files=transfer.files;
        list.replaceChildren();row.classList.toggle('has-file',files.length>0);
        row.querySelector('span').textContent=files.length?files.length+' archivo(s) seleccionado(s) · Añadir más':'Seleccionar anexos opcionales';
        files.forEach((file,index)=>{{
          const item=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');
          item.style.cssText='display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #39443a';
          name.textContent=(index+1)+'. '+file.name+' · '+(file.size/1024/1024).toFixed(2)+' MB';name.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px';
          remove.type='button';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar archivo '+(index+1)+': '+file.name);remove.style.cssText='width:auto;padding:8px 12px;margin:0;background:#263429;color:#e5eddf;box-shadow:none';
          remove.addEventListener('click',()=>{{files.splice(index,1);sync()}});item.append(name,remove);list.appendChild(item);
        }});
      }}
      field.addEventListener('change',()=>{{files.push(...field.files);sync()}});
      field.addEventListener('cancel',sync);
      field.form.addEventListener('reset',event=>queueMicrotask(()=>{{if(!event.defaultPrevented){{files=[];sync()}}}}));
      sync();
    }}
    [reproExtras,document.getElementById('pedido-extras')].forEach(accumulateAttachments);
    for (const [formId,fieldId,messageId] of [['upload-form','repro-extras','message'],['order-form','pedido-extras','order-message']]){{
      const targetForm=document.getElementById(formId),annex=document.getElementById(fieldId),annexRow=annex.closest('.file-row');
      annex.required=false;annexRow.querySelector('b').textContent='ANEXOS ADICIONALES (OPCIONAL)';
      const annexList=annexRow.nextElementSibling?.nextElementSibling,annexHint=annexRow.nextElementSibling;
      const optional=document.createElement('details'),optionalTitle=document.createElement('summary');
      optionalTitle.textContent='＋ Anexos adicionales (opcional)';optional.style.cssText='margin:8px 0;font-size:12px';
      annexRow.before(optional);optional.append(optionalTitle,annexRow);
      if(annexHint)optional.append(annexHint);if(annexList)optional.append(annexList);
      const designs=document.createElement('fieldset');designs.className='required-mockups';
      designs.style.cssText='border:1px solid #526344;border-radius:12px;padding:10px;margin:10px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px';
      designs.innerHTML='<legend style="font-size:12px">MOCKUPS · AL MENOS UNO OBLIGATORIO</legend>';
      for(let number=1;number<=4;number++){{
        const slot=document.createElement('label');slot.className='file-row';
        slot.innerHTML='<div><b>D'+number+'</b><span>Seleccionar imagen</span></div><input type="file" name="mockup_d'+number+'" accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff">';
        designs.appendChild(slot);
      }}
      optional.before(designs);
      targetForm.addEventListener('reset',()=>queueMicrotask(()=>{{
        designs.querySelectorAll('.file-row').forEach(row=>{{row.classList.remove('has-file');row.querySelector('span').textContent='Seleccionar imagen'}});
      }}));
      document.getElementById(formId).addEventListener('submit',event=>{{
        const files=[...designs.querySelectorAll('input')].flatMap(field=>[...field.files]);
        if(!files.some(file=>/\\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name))){{
          event.preventDefault();event.stopImmediatePropagation();
          const notice=document.getElementById(messageId);notice.className='message show error';
          notice.textContent='Adjunta un mockup JPG, PNG o WEBP. La orden no se programará sin imagen en su tarjeta.';
        }}
      }},true);
    }}
    drop.addEventListener('drop',e=>{{const file=e.dataTransfer.files[0];if(file){{const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;choose(file)}}}});
    const currentKeys={{reprogramacion:'indoor-current-reprogramacion',pedido:'indoor-current-pedido',creador:'indoor-current-creador'}};
    const currentId=kind=>Number(localStorage.getItem(currentKeys[kind])||0); const remember=(kind,id)=>localStorage.setItem(currentKeys[kind],String(id));
    function resetProgressButton(button,label){{button.classList.remove('is-progress');button.style.removeProperty('--creator-progress');button.textContent=label}}
    function updateFlowButton(group,button,idleLabel,messageTarget){{const job=group[0];if(!job)return;const p=progressOf(job);button.classList.add('is-progress');button.style.setProperty('--creator-progress',p+'%');if(job.status==='ERROR'||job.status==='REVISAR'){{button.disabled=false;button.textContent='Intentar nuevamente · '+p+'%';messageTarget.textContent=job.detail||'El proceso necesita revisión.';messageTarget.className='message show error';return}}button.disabled=true;button.textContent=(job.status==='COMPLETADO'?'Completado':(job.detail||'Procesando'))+' · '+p+'%'}}
    function stateClass(s){{return esc(String(s).toLowerCase())}} function progressOf(j){{if(['COMPLETADO','ERROR','REVISAR'].includes(j.status))return 100;return Math.max(5,Math.min(99,Number(j.progress)||5))}} function tableRows(data){{return data.length?data.map(j=>{{const p=progressOf(j);return `<tr><td class="id">#${{esc(j.id)}}</td><td><span class="file-name" title="${{esc(j.filename)}}">${{esc(j.filename)}}</span></td><td>${{esc(j.order_number||'Por identificar')}}</td><td><span class="state ${{stateClass(j.status)}}"><i></i>${{esc(j.status)}} · ${{p}}%</span><div class="progress-track"><div class="progress-fill" style="width:${{p}}%"></div></div></td><td class="detail">${{esc(j.detail||'Preparando proceso…')}}${{j.result_file?`<br><a class="download" href="/descargar/${{esc(j.id)}}">Descargar XLSX</a>`:''}}</td></tr>`}}).join(''):'<tr class="empty-row"><td colspan="5"><div class="empty-icon">↗</div><strong>Envía una orden para comenzar</strong><span>Aquí aparecerá únicamente el proceso actual.</span></td></tr>'}}
    function autoDownloadCreator(group){{const job=group[0];if(!job||job.status!=='COMPLETADO'||!job.result_file)return;const key='indoor-downloaded-creator',signature=job.id+':'+job.result_file,saved=localStorage.getItem(key)||'';if(saved===signature){{resetCreatorWorkspace();return}}localStorage.setItem(key,signature);creatorMessage.textContent='Listado completado. La descarga comenzó automáticamente.';creatorMessage.className='message show ok';const link=document.createElement('a');link.href='/descargar/'+job.id;link.download='';link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(resetCreatorWorkspace,1400)}}
    function updateCreatorButton(group){{const job=group[0];if(!job)return;const p=progressOf(job);if(job.status==='ERROR'){{creatorSubmit.disabled=false;creatorSubmit.classList.remove('is-progress');creatorSubmit.style.removeProperty('--creator-progress');creatorSubmit.textContent='Intentar nuevamente';creatorMessage.textContent=job.detail||'No se pudo crear el Excel.';creatorMessage.className='message show error';return}}creatorSubmit.classList.add('is-progress');creatorSubmit.style.setProperty('--creator-progress',p+'%');creatorSubmit.disabled=job.status!=='COMPLETADO';creatorSubmit.textContent=job.status==='COMPLETADO'?'Completado · 100%':(job.detail||'Creando el Excel')+' · '+p+'%'}}
    function render(data){{allJobs=data;const groups=['reprogramacion','pedido','creador'].map(kind=>{{const candidates=data.filter(j=>(kind==='reprogramacion'&&(j.kind==='reprogramacion'||!j.kind))||j.kind===kind),own=candidates.filter(j=>j.id===currentId(kind));if(own.length)return own;const active=candidates.filter(j=>j.status==='RECIBIDO'||j.status==='PROCESANDO').slice(0,1);if(active.length)remember(kind,active[0].id);return active}});tbody.innerHTML=tableRows(groups[0]);orderBody.innerHTML=tableRows(groups[1]);creatorBody.innerHTML=tableRows(groups[2]);document.querySelectorAll('.count').forEach((e,i)=>e.textContent=groups[i].length?'Seguimiento en tiempo real':'Sin una orden seleccionada');hydrateCreatorWorkspace(groups[2][0]);updateFlowButton(groups[0],submit,'Procesar documento',message);updateFlowButton(groups[1],orderSubmit,'Procesar pedido',orderMessage);updateCreatorButton(groups[2]);autoDownloadCreator(groups[2])}}
    async function refresh(){{try{{const r=await fetch('/api/procesos');if(r.ok)render(await r.json())}}catch(e){{}}}}
    const completedCleanup=new Set();function resetCompletedFlows(){{['reprogramacion','pedido'].forEach(kind=>{{const id=currentId(kind);if(!id||completedCleanup.has(kind+':'+id))return;const job=allJobs.find(item=>item.id===id);if(!job||job.status!=='COMPLETADO')return;completedCleanup.add(kind+':'+id);setTimeout(()=>{{if(currentId(kind)!==id)return;localStorage.removeItem(currentKeys[kind]);if(kind==='reprogramacion'){{form.reset();selected.textContent='';selected.classList.remove('show');drop.classList.remove('has-file','drag');form.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));document.getElementById('repro-extras-label').textContent='Opcional · selecciona una o varias imágenes';resetProgressButton(submit,'Procesar documento');submit.disabled=true;message.textContent='';message.className='message'}}else{{orderForm.reset();orderForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));checkOrder();resetProgressButton(orderSubmit,'Procesar pedido');orderSubmit.disabled=true;orderMessage.textContent='';orderMessage.className='message'}}refresh()}},2200)}})}}setInterval(resetCompletedFlows,500);
    document.querySelectorAll('.refresh').forEach(b=>b.addEventListener('click',refresh)); form.addEventListener('submit',async e=>{{e.preventDefault();submit.disabled=true;submit.classList.add('is-progress');submit.style.setProperty('--creator-progress','5%');submit.textContent='Enviando documento · 5%';show('Documento recibido. Iniciando el proceso…','ok');try{{const r=await fetch('/procesar',{{method:'POST',body:new FormData(form)}});const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo procesar');remember('reprogramacion',data.id);show('Orden enviada. El avance se actualizará en tiempo real.','ok');form.reset();selected.classList.remove('show');drop.classList.remove('has-file');form.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));await refresh()}}catch(err){{resetProgressButton(submit,'Procesar documento');submit.disabled=!input.files.length;show(err.message,'error')}}}});
    const productionZoomSelect=document.getElementById('production-zoom'),productionZoomInput=document.createElement('input');productionZoomInput.id='production-zoom';productionZoomInput.className='production-zoom';productionZoomInput.type='number';productionZoomInput.min='25';productionZoomInput.max='200';productionZoomInput.step='1';productionZoomInput.value=String(Math.round(Number(productionZoomSelect.value||1)*100));productionZoomInput.setAttribute('aria-label','Tamaño de la tabla en porcentaje');productionZoomInput.title='Escribe cualquier porcentaje entre 25 y 200';productionZoomSelect.replaceWith(productionZoomInput);
    const productionSearch=document.getElementById('production-search'),productionZoom=document.getElementById('production-zoom'),productionTable=document.getElementById('production-table'),productionHead=document.getElementById('production-head'),productionBody=document.getElementById('production-body'),productionStatus=document.getElementById('production-status'),productionEmpty=document.getElementById('production-empty'),productionRefresh=document.getElementById('production-refresh'),productionTableWrap=document.getElementById('production-table-wrap'),productionXScroll=document.getElementById('production-x-scroll'),productionXScrollInner=document.getElementById('production-x-scroll-inner');let productionData=null,productionTimer=null,productionScrollSync=false;
    function productionGroupSegments(groups){{const result=[];(groups||[]).forEach(name=>{{const label=String(name||'GENERAL').replace(/^["']|["']$/g,'').trim()||'GENERAL',last=result[result.length-1];if(last&&last.label===label)last.count+=1;else result.push({{label,count:1}})}});return result}}
    function productionCellClass(value,header){{const text=String(value||'').trim().toUpperCase(),title=String(header||'').trim().toUpperCase(),number=Number(text.replace(',','.').replace(/[^0-9.-]/g,''));if((title.includes('DÍAS ENTREGA FINAL')||title.includes('DIAS ENTREGA FINAL'))&&text&&Number.isFinite(number))return 'delivery-days-cell '+(number<=9?'semaphore-red':number<=14?'semaphore-orange':'semaphore-green');if(title.includes('FECHA')&&text)return 'semaphore-green';if(text==='P')return 'semaphore-orange';if(text==='R')return 'semaphore-red';if(title==='ESTADO'&&text&&Number.isFinite(number))return number<0?'semaphore-red':number===0?'semaphore-yellow':'semaphore-green';if(['SI','SÍ','OK','COMPLETADO','FINALIZADO'].includes(text))return 'semaphore-green';if(text==='NO'||text==='VENCIDO'||text==='ATRASADO')return 'semaphore-red';if((title.includes('RESP')||title==='LINEA'||title==='LÍNEA'||title==='TELA')&&text)return 'cell-chip';return ''}}
    const productionResponsibles=[['','Sin asignar'],['EJ','Ediht Johana Londoño'],['AM','Alejandro Mora'],['AP','Alejandro Padilla'],['AL','Andrés López'],['AU','Augusto López'],['CC','Carlos Cáceres'],['K','Keyner'],['DB','Dagoberto Botero'],['EE','Edwin Espinosa'],['ES','Esteban Estrada'],['HL','Hesleidy Londoño'],['JP','Jeison Padilla'],['JO','Julian Ocampo'],['JD','Juliana Diaz'],['SV','Santiago Vásquez'],['SG','Sebastian Gallo'],['SS','Stiven Sánchez'],['DD','Dairo Diaz'],['YS','Yenifer Sánchez Arcila'],['G','Gloria'],['DH','David Hincapie'],['GP','Geovanny Piedrahita'],['BOT','Automatización'],['DG','Daniel Gonzales']];
    const productionLines=['','COPA','MUNDIAL','OLIMPICA','MUESTRA','PLUS','BOT'];
    function isResponsibleHeader(header){{const title=String(header||'').trim().toUpperCase();return title.startsWith('RESP')||['CONFECCIONISTA','COMERCIAL','VENDEDOR'].includes(title)}}
    function isLineHeader(header){{const title=String(header||'').trim().toUpperCase();return title==='LINEA'||title==='LÍNEA'}}
    const sewingResponsibles=['ALBA','ANGELA','BLANCA','BLANCA EMILSE','EUCARIS','FANNY','GLORIA','GLORIA LOPEZ','CARMEN','JUAN ESTEBAN','MIRYAM','NOELIA','NURY','OMAIRA','OMAIRA BERGARA','PATRICIA','SANDRA','OFELIA','YINI','LILIANA','YENNY','CANDELARIA','EJ','JO','DB'];
    const processResponsibles={{EDICION:['SG','AM','BOT','CO','JD','EE'],IMPRESION:['SG','SV','K'],SUBLIMACION:['G','CC','GP','JP'],'CORTE LASER':['CC','DD','ES','JP','K','HL','G','SV','SG'],APLIQUES:['HL'],CONFECCION:sewingResponsibles,TERMINACION:sewingResponsibles,EMPAQUE:['JO','JHO'],COMERCIAL:['AU','AL','YS','DH'],VENDEDOR:['AU','AL','YS','DH']}};
    function responsibleSelect(value,row,column){{const current=String(value||'').trim(),normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('"','').trim().toUpperCase(),group=normalize(productionData.groups[column-1]),header=normalize(productionData.headers[column-1]),key=group==='LINEA PRODUCCION INDOOR SPORT SAS'?'COMERCIAL':(['COMERCIAL','VENDEDOR'].includes(header)?header:group),allowed=processResponsibles[key],choices=allowed?[['','Sin asignar'],...allowed.map(code=>[code,code])]:productionResponsibles,known=choices.some(item=>item[0]===current),legacyOption=known?'':'<option disabled selected value="'+esc(current)+'">'+esc(current)+' · anterior</option>';return '<select class="production-resp-select production-responsible" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(current)+'" aria-label="Responsable de '+esc(key)+'">'+legacyOption+choices.map(item=>'<option value="'+esc(item[0])+'" title="'+esc(item[1])+'" '+(item[0]===current?'selected':'')+'>'+esc(item[0]||'—')+'</option>').join('')+'</select>'}}
    function lineSelect(value,row,column){{const current=String(value||'').trim().toUpperCase(),choices=productionLines.includes(current)?productionLines:[current,...productionLines],colorClass='line-'+(current?current.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-'):'empty');return '<select class="production-resp-select production-line-select '+colorClass+'" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(current)+'" aria-label="Línea">'+choices.map(item=>'<option value="'+esc(item)+'" '+(item===current?'selected':'')+'>'+esc(item||'—')+'</option>').join('')+'</select>'}}
    function productionRowButton(row,order,client,project){{const clean=String(order||'').trim();if(!clean)return '—';const record=productionData?.rows.find(item=>Number(item.source_row)===Number(row)),indexOf=name=>productionData?.headers.findIndex(header=>String(header||'').trim().toUpperCase()===name)??-1,clientIndex=indexOf('NOMBRE DEL CLIENTE'),projectIndex=indexOf('NOMBRE PROYECTO');client=client||((record&&clientIndex>=0)?record.values[clientIndex]:'');project=project||((record&&projectIndex>=0)?record.values[projectIndex]:'');const isMac=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent),nativeUrl=isMac?'smb://192.168.0.120/NAS%20INDOOR/CLIENTES':'indoor-nas://open/'+encodeURIComponent(clean);return '<a class="production-row-open" href="'+esc(nativeUrl)+'" data-order="'+esc(clean)+'" data-client="'+esc(client||'')+'" data-project="'+esc(project||'')+'" title="Preparar y abrir orden '+esc(clean)+' en '+(isMac?'Finder':'el Explorador de archivos')+'">NAS <span>↗</span></a>'}}
    const nasNotice=document.createElement('aside');nasNotice.hidden=true;nasNotice.setAttribute('aria-label','Acceso a carpeta NAS');nasNotice.style.cssText='position:fixed;right:20px;bottom:20px;width:min(390px,calc(100vw - 40px));padding:20px;background:#142017;color:#f2f7ed;border:1px solid #91ac36;border-radius:14px;box-shadow:0 12px 40px #0008;z-index:10000';
    nasNotice.innerHTML='<button type="button" aria-label="Cerrar progreso NAS" style="float:right;background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer">×</button><strong class="nas-title"></strong><p class="nas-status" role="status" style="font-size:13px;line-height:1.5"></p><progress max="100" value="0" aria-label="Progreso de preparación del acceso" style="width:100%;height:12px;accent-color:#d0f44c"></progress><p class="nas-percent" style="margin:8px 0;color:#d0f44c;font-weight:700"></p><a class="nas-retry" hidden style="color:#d0f44c;text-decoration:underline">Abrir carpeta</a>';
    document.body.appendChild(nasNotice);nasNotice.querySelector('button').addEventListener('click',()=>{{nasNotice.hidden=true}});let nasBusy=false;
    function nasProgress(value,message){{nasNotice.querySelector('progress').value=value;nasNotice.querySelector('.nas-percent').textContent=value+'% · Preparación del acceso';nasNotice.querySelector('.nas-status').textContent=message}}
    productionBody.addEventListener('click',async event=>{{const link=event.target.closest('.production-row-open');if(!link)return;event.preventDefault();event.stopPropagation();nasNotice.hidden=false;if(nasBusy)return;nasBusy=true;nasNotice.querySelector('.nas-title').textContent='Carpeta de la orden '+link.dataset.order;const retry=nasNotice.querySelector('.nas-retry');retry.hidden=true;nasProgress(10,'Consultando la carpeta en el NAS…');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{{const response=await fetch('/api/nas/progreso',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{order:link.dataset.order,client:link.dataset.client,project:link.dataset.project}}),signal:controller.signal}});if(!response.ok){{const error=await response.json();throw Error(error.detail||'No se pudo consultar el NAS')}}if(!response.body)throw Error('El navegador no permite recibir el progreso.');const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',complete=false,nativeUrl='';while(true){{const chunk=await reader.read();pending+=decoder.decode(chunk.value||new Uint8Array(),{{stream:!chunk.done}});const lines=pending.split('\\n');pending=lines.pop();for(const line of lines){{if(!line.trim())continue;const update=JSON.parse(line);if(update.done&&!update.ok)throw Error(update.message);nasProgress(update.percent,update.message);if(update.message==='CLIENTE ENCONTRADO'||update.message==='ORDEN ENCONTRADA')await new Promise(resolve=>setTimeout(resolve,1200));if(update.done){{complete=true;nativeUrl=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)?update.smb_url:update.windows_url}}}}if(chunk.done)break}}if(!complete)throw Error('Se interrumpió la conexión con el NAS. Vuelve a intentar.');if(!nativeUrl)throw Error('No se recibió la ruta de la carpeta');retry.href=nativeUrl;retry.hidden=false;nasProgress(100,'ABRIENDO CARPETA');window.location.assign(nativeUrl);const noticeOrder=link.dataset.order;setTimeout(()=>{{if(!nasBusy&&nasNotice.querySelector('.nas-title').textContent==='Carpeta de la orden '+noticeOrder)nasNotice.hidden=true}},3500)}}
    catch(error){{nasNotice.querySelector('.nas-percent').textContent='No se completó';nasNotice.querySelector('.nas-status').textContent=error.name==='AbortError'?'El NAS tardó demasiado. Vuelve a pulsar el botón NAS para intentar de nuevo.':error.message}}
    finally{{clearTimeout(timeout);nasBusy=false}}}},true);
    function freezeProductionColumns(){{const columnsRow=productionHead.querySelector('.production-columns'),rowHead=productionHead.querySelector('.production-row-head');if(!columnsRow||!rowHead)return;const bodyRows=[...productionBody.querySelectorAll('tr')],headers=[...columnsRow.children],deliveryIndex=headers.findIndex(header=>{{const title=header.textContent.trim().toUpperCase();return title.includes('DÍAS ENTREGA FINAL')||title.includes('DIAS ENTREGA FINAL')}}),freezeCount=deliveryIndex>=0?deliveryIndex+1:Math.min(10,headers.length),zoom=(Number(productionZoom.value)||100)/100,layoutWidth=element=>element.getBoundingClientRect().width/zoom;rowHead.classList.add('production-frozen');rowHead.style.left='0px';bodyRows.forEach(row=>{{const cell=row.children[0];if(cell){{cell.classList.add('production-frozen');cell.style.left='0px'}}}});let left=layoutWidth(rowHead);for(let index=0;index<freezeCount;index++){{const edge=index===freezeCount-1,header=headers[index];header.classList.add('production-frozen');header.classList.toggle('production-frozen-edge',edge);header.style.left=left+'px';bodyRows.forEach(row=>{{const cell=row.children[index+1];if(!cell)return;cell.classList.add('production-frozen');cell.classList.toggle('production-frozen-edge',edge);cell.style.left=left+'px'}});left+=layoutWidth(header)}}}}
    function syncProductionWidth(){{productionXScrollInner.style.width=productionTable.scrollWidth+'px'}}
   const processStatusHeaders=new Set({json.dumps(sorted(PROCESS_STATUS_HEADERS))});
   function editionDropdowns(){{if(!productionData)return;const columns=new Set(productionData.headers.flatMap((header,index)=>processStatusHeaders.has(processKey(header))?[String(index+1)]:[]));productionBody.querySelectorAll('td[data-column]').forEach(cell=>{{if(!columns.has(cell.dataset.column)||cell.querySelector('select'))return;const original=String(productionData.rows.find(row=>String(row.source_row)===cell.dataset.row)?.values[Number(cell.dataset.column)-1]||'').trim(),select=document.createElement('select');select.className='production-resp-select edition-status';select.setAttribute('aria-label','Estado de '+productionData.headers[Number(cell.dataset.column)-1]);select.dataset.original=original;const state=original.toUpperCase(),tone=state==='P'?'#f5a623':state==='R'?'#c93636':state==='N/A'||scheduleParseDate(original)?'#31834a':null;if(tone){{select.style.setProperty('background',tone,'important');select.style.setProperty('color',state==='P'?'#241800':'#fff','important');select.style.setProperty('border','1px solid '+tone,'important');select.style.setProperty('font-weight','700','important')}}const options=[['','Vacío'],['P','P'],['R','R'],['__today','Fecha de hoy'],['N/A','N/A']];if(original&&!['P','R','N/A'].includes(original))options.unshift([original,displayProductionDate(original)]);options.forEach(([value,label])=>select.add(new Option(label,value,false,value===original)));cell.textContent='';cell.appendChild(select);if(original==='R'){{const history=document.createElement('button');history.type='button';history.className='rework-history';history.textContent=original==='R'?'R · Ver motivo':'Reprocesos';history.title='Consultar motivos, usuario y fecha';history.style.cssText='display:block;width:100%;padding:3px;margin-top:4px;background:#201916;color:#ffd2c5;border:1px solid #78564b;box-shadow:none;font:inherit;font-size:.85em';cell.appendChild(history);}}cell.title='Selecciona P, R, Fecha de hoy o N/A'}})}}const editionObserver=new MutationObserver(editionDropdowns);editionObserver.observe(productionBody,{{childList:true}});
    productionBody.addEventListener('click',async event=>{{const button=event.target.closest('.rework-history');if(!button)return;event.stopPropagation();const cell=button.closest('td');button.disabled=true;try{{const response=await fetch('/api/produccion/reprocesos/'+cell.dataset.row+'/'+cell.dataset.column),items=await response.json();if(!response.ok)throw new Error(items.detail||'No se pudo consultar');alert(items.length?items.map(item=>item.process+' · '+item.username+' · '+new Date(item.created_at).toLocaleString('es-CO',{{timeZone:'America/Bogota'}})+'\\n'+item.reason).join('\\n\\n'):'No hay motivos registrados para esta celda.')}}catch(error){{alert(error.message)}}finally{{button.disabled=false}}}});
   productionBody.addEventListener('change',async event=>{{const select=event.target.closest('.edition-status');if(!select)return;event.stopImmediatePropagation();const cell=select.closest('td'),original=select.dataset.original;let value=select.value;if(value==='__today')value=productionDateShortcut(new Date());select.disabled=true;cell.classList.add('is-editing');const ok=await saveProductionCell(cell,value,original);select.disabled=false;cell.classList.remove('is-editing');if(ok)renderProduction();else select.value=original}});
    const processFilterBar=document.createElement('div');processFilterBar.className='production-process-filter';processFilterBar.innerHTML='<label for="production-process">Proceso</label><select id="production-process" aria-label="Filtrar columnas por proceso"><option value="">Todos los procesos</option></select>';document.querySelector('.production-toolbar').insertAdjacentElement('afterend',processFilterBar);const productionProcess=document.getElementById('production-process');let selectedProcess=localStorage.getItem('indoor-production-process')||'';
    const deliverySortButton=document.createElement('button');deliverySortButton.type='button';deliverySortButton.className='production-refresh';deliverySortButton.textContent='Ordenar por fecha de entrega';deliverySortButton.title='Ordena todas las filas: fechas más próximas primero y sin fecha al final. Se guarda para todos.';processFilterBar.appendChild(deliverySortButton);deliverySortButton.addEventListener('click',async()=>{{if(!productionData||productionBody.querySelector('.is-editing'))return;if(!confirm('¿Ordenar todas las filas por fecha de entrega, de la más antigua a la más lejana? Las filas sin fecha irán al final. El orden se guardará para todos los usuarios.'))return;deliverySortButton.disabled=true;deliverySortButton.textContent='Ordenando…';try{{const response=await fetch('/api/produccion/ordenar-entrega',{{method:'POST'}}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo ordenar');await loadProduction();productionTableWrap.scrollTop=0;productionStatus.textContent='✓ Filas ordenadas por fecha de entrega para todos los usuarios'}}catch(error){{productionStatus.textContent=error.message}}finally{{deliverySortButton.disabled=false;deliverySortButton.textContent='Ordenar por fecha de entrega'}}}});
    const productionTools=document.createElement('details');productionTools.className='production-tools-menu';productionTools.innerHTML='<summary>Herramientas</summary><div class="production-tools-popover"></div>';document.querySelector('.production-controls').appendChild(productionTools);productionTools.querySelector('div').appendChild(document.querySelector('.production-connector'));const zoomGroup=document.createElement('label');zoomGroup.className='production-zoom-group';zoomGroup.append('Tamaño ');zoomGroup.appendChild(productionZoom);zoomGroup.append(' %');processFilterBar.appendChild(zoomGroup);document.querySelector('.production-title h2').textContent='Trazabilidad de producción';document.querySelector('.production-title p').textContent='Doble clic para editar · Clic derecho para notas';productionSearch.placeholder='Buscar cliente, orden o referencia';deliverySortButton.textContent='Ordenar entregas';document.addEventListener('click',event=>{{if(!productionTools.contains(event.target))productionTools.open=false}});
    const cleanProductionStyle=document.createElement('style');cleanProductionStyle.textContent=`
body.production-mode{{--line:rgba(180,195,167,.16)}}
body.production-mode .production-shell{{border-color:#344032;box-shadow:none}}
body.production-mode .production-toolbar{{gap:20px;padding:16px 20px;background:#111610;flex-wrap:wrap;overflow:visible}}
body.production-mode .production-title h2{{font-size:18px;font-weight:650}}
body.production-mode .production-title p{{font-size:12px;font-weight:400;color:#a6b09f;margin-top:4px}}
body.production-mode .production-controls{{min-width:0;flex:1;max-width:680px;flex-wrap:wrap}}
body.production-mode .production-search{{min-width:170px;height:38px;background:#1b221a;border-color:#3b4635;font-weight:400}}
body.production-mode .production-refresh,body.production-mode .production-tools-menu summary{{font-size:12px;font-weight:550;min-height:36px;padding:8px 12px;border-radius:7px;border:1px solid #46543b;background:#202a1c;color:#e6eddf;box-shadow:none;cursor:pointer;list-style:none}}
body.production-mode .production-process-filter{{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 20px;background:#111610;border-bottom:1px solid #30392b}}
body.production-mode .production-process-filter>label{{font-size:12px;color:#abb69f;font-weight:500}}
body.production-mode #production-process{{font-size:12px;font-weight:500;min-height:36px;background:#20271c;border-color:#47543b;max-width:230px}}
body.production-mode .production-zoom-group{{display:flex;gap:7px;align-items:center;margin-left:auto}}
body.production-mode .production-zoom{{width:66px;flex-basis:66px;font-size:12px;min-height:34px;background:#1a2117;border-color:#47543b;font-weight:500}}
body.production-mode .production-kpis{{padding:8px 20px;gap:22px;background:#10160e}}
body.production-mode .production-kpi span{{font-size:10px;font-weight:500;letter-spacing:.03em}}
body.production-mode .production-kpi strong{{font-size:13px;font-weight:650}}
body.production-mode .production-status{{font-size:11px;font-weight:400;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
body.production-mode .production-table{{font-family:Arial,sans-serif}}
body.production-mode .production-table td{{font-size:.98rem}}
body.production-mode .production-table .production-columns th{{font-size:1.15rem;padding:14px 12px;height:68px;overflow-wrap:break-word}}
body.production-mode .production-table .production-groups th{{font-size:1rem;padding:12px;height:44px}}
body.production-mode .production-table td.delivery-days-cell{{font-size:.94rem!important}}
body.production-mode .production-table td{{font-weight:400!important;line-height:1.45;padding:10px 9px;border-right-color:rgba(180,195,167,.065);border-top-color:rgba(180,195,167,.12);text-shadow:none!important}}
body.production-mode .production-table th{{font-weight:600!important;letter-spacing:.015em;line-height:1.35;border-right-color:#3a4333;border-bottom-color:#505f3e}}
body.production-mode .production-table .production-groups th{{background:#26301f!important;color:#b8c9a0;font-weight:500!important}}
body.production-mode .production-table .production-columns th{{background:#182014!important;color:#e3ead9}}
body.production-mode .production-resp-select,body.production-mode .production-machine-picker{{border-color:transparent!important;background:transparent!important;box-shadow:none!important;border-radius:5px!important;color:#e2ebd6!important;font-weight:500!important}}
body.production-mode .production-resp-select:hover,body.production-mode .production-resp-select:focus,body.production-mode .production-machine-picker:hover{{border-color:#637650!important;background:#25341f!important}}
body.production-mode .production-line-select{{background:#253c45!important;color:#cae9f4!important}}
body.production-mode .production-table .production-responsible{{background:#9ac9ee!important;color:#15334b!important;border:1px solid #b8ddf7!important;font-weight:700!important}}
body.production-mode .production-table .production-responsible:hover,body.production-mode .production-table .production-responsible:focus{{background:#b5dcf6!important;color:#15334b!important;border-color:#d8edfc!important}}
body.production-mode .production-table td:not(.delivery-days-cell)::before{{display:none!important}}
body.production-mode .production-table td.delivery-days-cell{{font-weight:700!important;box-shadow:none!important}}
body.production-mode .production-frozen-edge{{box-shadow:2px 0 0 #52613b!important}}
body.production-mode .production-row-tools{{gap:6px}}
body.production-mode .production-row-open{{background:#26311c!important;border-color:#58673f!important;color:#d1e2b2!important;box-shadow:none!important;font-weight:600}}
body.production-mode .production-drag-handle{{box-shadow:none;border-color:#4f5d3e;background:#1b2516;color:#9cab86}}
body.production-mode .production-delete-row{{box-shadow:none!important;background:transparent!important;border-color:#67483d!important;color:#d8a293!important}}
body.production-mode .production-tools-menu{{position:relative}}
body.production-mode .production-tools-popover{{position:absolute;right:0;top:42px;z-index:120;background:#1c2517;padding:10px;border:1px solid #596745;border-radius:9px;box-shadow:0 10px 25px #0008;min-width:185px}}
body.production-mode .production-tools-popover a{{display:block;font-size:12px}}
@media(max-width:860px){{body.production-mode .production-toolbar{{padding:12px}}body.production-mode .production-controls{{max-width:none;width:100%}}body.production-mode .production-process-filter{{padding:10px 12px;gap:8px}}body.production-mode .production-status{{display:none}}body.production-mode .production-zoom-group{{margin-left:0}}}}
`;document.head.appendChild(cleanProductionStyle);
    const orderProgress=document.createElement('p');orderProgress.hidden=true;orderProgress.style.cssText='padding:12px 16px;margin:0;color:#d0f44c;background:#182014;font-weight:700';processFilterBar.insertAdjacentElement('afterend',orderProgress);
    let exactScheduleOrder='';productionSearch.addEventListener('input',()=>{{exactScheduleOrder='';orderProgress.hidden=true}});
    function processKey(value){{return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('"','').trim().toUpperCase()}}
    function fixedDeliveryIndex(){{return productionData.headers.findIndex(header=>processKey(header)==='DIAS ENTREGA FINAL')}}
    function processColumnVisible(column){{return !selectedProcess||column.sourceIndex<=fixedDeliveryIndex()||processKey(column.group)===selectedProcess}}
    function updateProcessFilter(){{const labels=new Map();productionData.groups.forEach((group,index)=>{{const key=processKey(group);if(index>fixedDeliveryIndex()&&key&&key!=='GENERAL'&&!key.includes('LINEA PRODUCCION')&&!key.includes('METODOLOG'))labels.set(key,String(group).replaceAll('"',''))}});if(selectedProcess&&!labels.has(selectedProcess))selectedProcess='';const signature=JSON.stringify([...labels]);if(productionProcess.dataset.signature!==signature){{productionProcess.replaceChildren(new Option('Todos los procesos',''));labels.forEach((label,key)=>productionProcess.add(new Option(label,key)));productionProcess.dataset.signature=signature}}productionProcess.value=selectedProcess}}
    productionProcess.addEventListener('change',()=>{{selectedProcess=productionProcess.value;localStorage.setItem('indoor-production-process',selectedProcess);productionTableWrap.scrollLeft=0;productionXScroll.scrollLeft=0;renderProduction()}});
    const printingMachines=['SHUREZ','EPSON','GRAPHTEC','GT','JET','M2','SNAKE','N/A','ROLAND','SNAKE CE','EPSON YEINSON','EPSON JESAM','M2 DIC 2025','SNAKE CE OLD NEGRO','SNAKE STS INKS','SNAKE CE OLD','IMPRES. UV','DTF','PLT','BORDADO'];
    function isMachineHeader(header){{return String(header||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()==='MAQUINA DE IMPRESION'}}
    function machineSelect(value,row,column){{const current=String(value||'').trim();return '<button type="button" class="production-machine-picker" style="width:100%;background:#182016;color:#e9f7d4;border:1px solid #647448;border-radius:8px;padding:5px;font:inherit;cursor:pointer" data-original="'+esc(current)+'" aria-label="Seleccionar máquinas de impresión">'+esc(current||'Seleccionar')+' ▾</button>'}}
    const machineDialog=document.createElement('dialog');machineDialog.style.cssText='width:min(440px,92vw);max-height:85vh;overflow:auto;background:#142017;color:#f4f8ed;border:1px solid #91ac36;border-radius:16px;padding:24px';machineDialog.innerHTML='<h3 style="margin-top:0">Máquinas de impresión</h3><p>Selecciona una o varias máquinas.</p><div class="machine-choices"></div><p class="machine-error" role="alert"></p><div style="display:flex;gap:10px;margin-top:20px"><button type="button" class="machine-cancel">Cancelar</button><button type="button" class="machine-save">Guardar selección</button></div>';document.body.appendChild(machineDialog);let machineCell=null,machineOriginal='';
    productionBody.addEventListener('click',event=>{{const picker=event.target.closest('.production-machine-picker');if(!picker)return;machineCell=picker.closest('td');machineOriginal=picker.dataset.original;const selected=machineOriginal.split(/\\s*[,;]\\s*/).filter(Boolean),choices=[...new Set([...printingMachines,...selected])];machineDialog.querySelector('.machine-choices').innerHTML=choices.map(name=>'<label style="display:flex;align-items:center;gap:12px;padding:9px 0"><input type="checkbox" style="width:18px;height:18px;flex:none" value="'+esc(name)+'" '+(selected.includes(name)?'checked':'')+'><span>'+esc(name)+'</span></label>').join('');machineDialog.querySelector('.machine-error').textContent='';machineDialog.showModal()}});
    machineDialog.querySelector('.machine-cancel').addEventListener('click',()=>machineDialog.close());
    machineDialog.querySelector('.machine-save').addEventListener('click',async()=>{{const button=machineDialog.querySelector('.machine-save'),value=[...machineDialog.querySelectorAll('input:checked')].map(input=>input.value).join(', ');button.disabled=true;machineDialog.querySelector('.machine-cancel').disabled=true;try{{const ok=await saveProductionCell(machineCell,value,machineOriginal);if(ok){{machineDialog.close();renderProduction()}}else machineDialog.querySelector('.machine-error').textContent='No se pudo guardar. Intenta nuevamente.'}}finally{{button.disabled=false;machineDialog.querySelector('.machine-cancel').disabled=false}}}});
    machineDialog.addEventListener('cancel',event=>{{if(machineDialog.querySelector('.machine-save').disabled)event.preventDefault()}});
    const noteDialog=document.createElement('dialog');noteDialog.style.cssText='width:min(460px,92vw);background:#142017;color:#fff;border:1px solid #91ac36;border-radius:14px;padding:24px';noteDialog.innerHTML='<h3>Nota de la celda</h3><label for="cell-note-text">Escribe tu nota (máximo 5000 caracteres)</label><textarea id="cell-note-text" maxlength="5000" rows="7" style="width:100%;margin:12px 0;background:#fdfdf4;color:#17221b;padding:12px;font:inherit"></textarea><p class="note-error" role="alert"></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="note-save">Guardar nota</button><button type="button" class="note-delete">Eliminar nota</button><button type="button" class="note-cancel">Cancelar</button></div>';document.body.appendChild(noteDialog);let noteTarget=null;
    function decorateNotes(){{productionBody.querySelectorAll('td[data-row][data-column]').forEach(cell=>{{const note=productionData.notes?.[cell.dataset.row+':'+cell.dataset.column];cell.tabIndex=0;if(note){{cell.style.setProperty('background-image','linear-gradient(#78a9d5,#78a9d5)','important');cell.style.setProperty('background-repeat','no-repeat','important');cell.style.setProperty('background-position','right top','important');cell.style.setProperty('background-size','4px 4px','important');cell.removeAttribute('title');cell.dataset.note=note}}else cell.title+=' · Clic derecho: agregar nota'}})}}
    const notePreview=document.createElement('aside');notePreview.hidden=true;notePreview.setAttribute('aria-label','Nota de la celda');notePreview.style.cssText='position:fixed;z-index:2000;width:min(230px,calc(100vw - 24px));min-height:96px;max-height:45vh;resize:both;overflow:auto;padding:10px;background:#fff;color:#444;border:1px solid #d0d0d0;border-radius:2px;box-shadow:0 2px 6px #0002;font:13px/1.45 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere';notePreview.innerHTML='<div class="note-preview-text"></div>';document.body.appendChild(notePreview);let notePreviewTimer;
    function hideNotePreview(){{clearTimeout(notePreviewTimer);notePreview.hidden=true}}
    function showNotePreview(cell){{const note=productionData.notes?.[cell.dataset.row+':'+cell.dataset.column];if(!note)return;clearTimeout(notePreviewTimer);notePreview.querySelector('.note-preview-text').textContent=note;notePreview.hidden=false;const bounds=cell.getBoundingClientRect(),width=notePreview.offsetWidth,height=notePreview.offsetHeight;notePreview.style.left=Math.max(12,Math.min(bounds.left,innerWidth-width-12))+'px';notePreview.style.top=Math.max(12,bounds.bottom+height+10<innerHeight?bounds.bottom+6:bounds.top-height-6)+'px'}}
    productionBody.addEventListener('pointerover',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(cell)showNotePreview(cell)}});productionBody.addEventListener('focusin',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(cell)showNotePreview(cell)}});productionBody.addEventListener('pointerout',()=>{{notePreviewTimer=setTimeout(hideNotePreview,250)}});notePreview.addEventListener('pointerenter',()=>clearTimeout(notePreviewTimer));notePreview.addEventListener('pointerleave',hideNotePreview);productionTableWrap.addEventListener('scroll',hideNotePreview,{{passive:true}});document.addEventListener('keydown',event=>{{if(event.key==='Escape')hideNotePreview()}});window.addEventListener('resize',hideNotePreview);
    function openNote(cell){{hideNotePreview();noteTarget={{row:Number(cell.dataset.row),column:Number(cell.dataset.column)}};noteDialog.querySelector('textarea').value=productionData.notes?.[noteTarget.row+':'+noteTarget.column]||'';noteDialog.querySelector('.note-error').textContent='';noteDialog.showModal();noteDialog.querySelector('textarea').focus()}}
    productionBody.addEventListener('contextmenu',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell)return;event.preventDefault();openNote(cell)}});
    productionBody.addEventListener('keydown',event=>{{if(event.key==='F10'&&event.shiftKey){{const cell=event.target.closest('td[data-row][data-column]');if(cell){{event.preventDefault();openNote(cell)}}}}}});
    noteDialog.querySelector('.note-cancel').addEventListener('click',()=>noteDialog.close());
    async function persistNote(note){{noteDialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{{const response=await fetch('/api/produccion/nota',{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{...noteTarget,note}})}}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo guardar la nota');productionData.notes=productionData.notes||{{}};productionData.notes[noteTarget.row+':'+noteTarget.column]=data.note;noteDialog.close();renderProduction()}}catch(error){{noteDialog.querySelector('.note-error').textContent=error.message}}finally{{noteDialog.querySelectorAll('button').forEach(b=>b.disabled=false)}}}}
    noteDialog.querySelector('.note-save').addEventListener('click',()=>persistNote(noteDialog.querySelector('textarea').value));noteDialog.querySelector('.note-delete').addEventListener('click',()=>{{if(confirm('¿Eliminar la nota de esta celda?'))persistNote('')}});noteDialog.addEventListener('cancel',event=>{{if(noteDialog.querySelector('.note-save').disabled)event.preventDefault()}});
    function fitProductionHeight(){{if(!document.body.classList.contains('production-mode'))return;const top=productionTableWrap.getBoundingClientRect().top,available=Math.max(240,window.innerHeight-Math.max(0,top)-10);productionTableWrap.style.height=available+'px';productionTableWrap.style.maxHeight=available+'px';productionTableWrap.style.minHeight='0'}}
    productionBody.addEventListener('click',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell||event.target.closest('button,a,input,select,textarea')||cell.classList.contains('delivery-days-cell'))return;hideNotePreview();const select=cell.querySelector('select'),picker=cell.querySelector('.production-machine-picker');if(select){{cell.focus();return}}if(picker){{picker.click();return}}cell.focus()}});
    function guardSelectBody(event){{const select=event.target.closest('select');if(!select||!productionBody.contains(select))return;const bounds=select.getBoundingClientRect(),arrowWidth=Math.min(24,Math.max(12,bounds.width*.22));if(event.clientX<bounds.right-arrowWidth){{event.preventDefault();event.stopImmediatePropagation();const cell=select.closest('td');cell.focus();showNotePreview(cell)}}else hideNotePreview()}}productionBody.addEventListener('pointerdown',guardSelectBody,true);productionBody.addEventListener('mousedown',guardSelectBody,true);productionBody.addEventListener('click',guardSelectBody,true);
    function moveProductionCell(cell,key){{const row=cell.closest('tr'),cells=[...row.querySelectorAll('td[data-column]')],index=cells.indexOf(cell);let next;if(key==='ArrowLeft'||key==='ArrowRight')next=cells[index+(key==='ArrowRight'?1:-1)];else{{const nextRow=key==='ArrowDown'?row.nextElementSibling:row.previousElementSibling;next=nextRow?.querySelector('td[data-column="'+cell.dataset.column+'"]')}}if(next){{next.focus();next.scrollIntoView({{block:'nearest',inline:'nearest'}})}}}}
    productionBody.addEventListener('keydown',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell)return;if(event.target.tagName==='INPUT'&&event.target.classList.contains('production-cell-input')&&['ArrowUp','ArrowDown'].includes(event.key)){{event.preventDefault();event.target.blur();moveProductionCell(cell,event.key);return}}if(event.target.tagName!=='TD')return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){{event.preventDefault();moveProductionCell(cell,event.key);return}}if(['Enter','F2'].includes(event.key)){{event.preventDefault();if(cell.querySelector('select,button'))cell.click();else{{hideNotePreview();editProductionCell(cell)}}return}}if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||cell.querySelector('select,button')||cell.classList.contains('delivery-days-cell'))return;if(event.key.length===1||['Backspace','Delete'].includes(event.key)){{event.preventDefault();hideNotePreview();editProductionCell(cell);const input=cell.querySelector('input');if(input)input.value=event.key.length===1?event.key:''}}}});
    productionBody.addEventListener('paste',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(event.target.tagName!=='TD'||!cell||cell.querySelector('select,button')||cell.classList.contains('delivery-days-cell'))return;const text=event.clipboardData?.getData('text/plain');if(text===undefined)return;event.preventDefault();hideNotePreview();editProductionCell(cell);const input=cell.querySelector('input');if(input)input.value=text}});
    const activeCellStyle=document.createElement('style');activeCellStyle.textContent='.production-table td[data-column]:focus{{outline:2px solid #8fb9e1;outline-offset:-2px}}';document.head.appendChild(activeCellStyle);
    const clickEditStyle=document.createElement('style');clickEditStyle.textContent='body.production-mode .production-table td.is-editing .production-cell-input{{min-height:36px;width:100%;font:inherit;color:inherit;background:transparent!important;border:0!important;border-radius:0;outline:0!important;box-shadow:none!important;caret-color:#f1f5ed;padding:0;text-align:center}}body.production-mode .production-table td.is-editing{{padding:10px 9px}}';document.head.appendChild(clickEditStyle);
    let productionHeightFrame=0;function scheduleProductionHeight(){{if(productionHeightFrame)return;productionHeightFrame=requestAnimationFrame(()=>{{productionHeightFrame=0;fitProductionHeight()}})}}window.addEventListener('resize',scheduleProductionHeight);window.addEventListener('scroll',scheduleProductionHeight,{{passive:true}});new MutationObserver(scheduleProductionHeight).observe(document.body,{{attributes:true,attributeFilter:['class']}});
    const productionSpaceStyle=document.createElement('style');productionSpaceStyle.textContent='body.production-mode .footer-note{{display:none}}body.production-mode main{{padding-bottom:0}}';document.head.appendChild(productionSpaceStyle);
    function isAppliqueHeader(header){{const title=String(header||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();return title.startsWith('APLIQUE')&&title.includes('TEXTURIZADO')}}
    function appliqueSelect(value,row,column){{const original=String(value||'').trim(),current=original.toUpperCase()==='SÍ'?'SI':original.toUpperCase(),choices=['','SI','NO'],legacy=current&&!choices.includes(current)?'<option disabled selected value="'+esc(original)+'">'+esc(original)+' · anterior</option>':'';return '<select class="production-resp-select production-applique-select" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(original)+'" aria-label="¿Lleva apliques?">'+legacy+choices.map(item=>'<option value="'+item+'" '+(item===current?'selected':'')+'>'+(item||'—')+'</option>').join('')+'</select>'}}
    function orderIdentity(value,row){{if(!String(value||'').trim())return '';return '<strong class="order-identity" style="margin-bottom:0">'+esc(value)+'</strong>'}}
    const orderIdentityStyle=document.createElement('style');orderIdentityStyle.textContent='.order-identity{{display:block;color:#f1ffc5;font-size:1.18em;font-weight:750;letter-spacing:.02em;margin-bottom:5px}}.order-process{{display:block;border-radius:5px;padding:4px 6px;font-size:.88em;line-height:1.3;font-weight:600;white-space:normal;background:#283224;color:#c5d1b8}}.order-process.active{{background:#394925;color:#ecffb8;border-left:3px solid #d0f44c}}.order-process.finished{{background:#1d3432;color:#b2ddd6;border-left:3px solid #6bb5a7}}.order-process.pending{{color:#aab0a5}}';document.head.appendChild(orderIdentityStyle);
    const neutralTableStyle=document.createElement('style');neutralTableStyle.textContent=`
body.production-mode .production-table td:not(.delivery-days-cell){{background-color:#181b18!important;color:#dce1d9}}
body.production-mode .production-table th,body.production-mode .production-table .production-groups th,body.production-mode .production-table .production-columns th{{background:#292e29!important;color:#f4f6f2!important;border-color:#495047;font-weight:700!important;text-shadow:none;line-height:1.4}}
body.production-mode .production-table th.production-row-head{{font-size:1rem}}
body.production-mode .production-table .production-line-select{{background:#282e28!important;color:#d4ddd0!important}}
body.production-mode .production-table .production-row-open{{background:#252c23!important;color:#cbd6c2!important;border-color:#485341!important}}
body.production-mode .production-table .production-drag-handle{{background:#252a24;color:#a9b2a3;border-color:#424a3d}}
body.production-mode .production-table .production-delete-row{{color:#aeb5a8!important;border-color:#485043!important}}
body.production-mode .production-table .production-delete-row:hover{{color:#ffc6bc!important;border-color:#b66f64!important}}
body.production-mode .production-table .order-identity{{color:#f0f3ed}}
body.production-mode .production-table .order-process.active{{background:#2d3826;color:#d5e7bd;border-left-color:#93ae6f}}
body.production-mode .production-table .order-process.finished{{background:#263333;color:#bcd3cd;border-left-color:#779c93}}
body.production-mode .production-table .order-process.pending{{background:#282d28;color:#aeb7a8}}
body.production-mode .production-table td.delivery-days-cell.semaphore-green{{background:#243326!important;color:#cee5c5!important}}
body.production-mode .production-table td.delivery-days-cell.semaphore-orange{{background:#3b3023!important;color:#eed7b3!important}}
body.production-mode .production-table td.delivery-days-cell.semaphore-red{{background:#3c2727!important;color:#efc6c1!important}}
`;document.head.appendChild(neutralTableStyle);
    function renderProduction(){{if(!productionData)return;updateProcessFilter();const hiddenHeaders=new Set(['COLUMNA 46','TELA','TA','OK','METODOLOGIA','METODOLOGÍA','PERFIL','ESTADO','TIPO DE DISEÑO','TIPO DE DISENO']),query=productionSearch.value.trim().toLocaleLowerCase('es'),rows=exactScheduleOrder?productionData.rows.filter(row=>String(row.values[scheduleHeaderIndex('ORDEN')]||'').trim().toUpperCase()===exactScheduleOrder.toUpperCase()):query?productionData.rows.filter(row=>row.values.some(value=>String(value||'').toLocaleLowerCase('es').includes(query))):productionData.rows,columns=productionData.headers.map((header,sourceIndex)=>({{header,group:productionData.groups[sourceIndex]||'GENERAL',sourceIndex}})).slice(1).filter(column=>{{const title=String(column.header||'').replace(/^['"]|['"]$/g,'').trim().toUpperCase(),group=String(column.group||'').replace(/^['"]|['"]$/g,'').trim().toUpperCase();return !(group==='CORTE TEXTIL'&&(title==='CORTE TEXTIL'||title.startsWith('RESP')))&&processColumnVisible(column)&&!hiddenHeaders.has(title)&&!title.includes('CORREO')&&!(group.includes('METODOLOG')&&title.startsWith('RESP'))}}),visibleHeaders=columns.map(column=>column.header),groups=productionGroupSegments(columns.map(column=>column.group)),orderIndex=productionData.headers.findIndex(header=>String(header||'').trim().toUpperCase()==='ORDEN');productionHead.innerHTML='<tr class="production-groups"><th class="production-row-head" rowspan="2">FILA</th>'+groups.map(group=>`<th colspan="${{group.count}}">${{esc(group.label)}}</th>`).join('')+'</tr><tr class="production-columns">'+visibleHeaders.map(header=>`<th>${{esc(header)}}</th>`).join('')+'</tr>';productionBody.innerHTML=rows.map(row=>'<tr><td>'+productionRowButton(row.source_row,orderIndex>=0?row.values[orderIndex]:'')+'</td>'+columns.map(column=>{{const value=row.values[column.sourceIndex]||'',sheetColumn=column.sourceIndex+1,selectable=isAppliqueHeader(column.header)||isMachineHeader(column.header)||isResponsibleHeader(column.header)||isLineHeader(column.header),content=column.sourceIndex===orderIndex?orderIdentity(value,row):isAppliqueHeader(column.header)?appliqueSelect(value,row.source_row,sheetColumn):isMachineHeader(column.header)?machineSelect(value,row.source_row,sheetColumn):isResponsibleHeader(column.header)?responsibleSelect(value,row.source_row,sheetColumn):isLineHeader(column.header)?lineSelect(value,row.source_row,sheetColumn):esc((processKey(column.header).includes('FECHA')||processStatusHeaders.has(processKey(column.header)))?displayProductionDate(value):value);return '<td data-row="'+row.source_row+'" data-column="'+sheetColumn+'" title="'+(selectable?'Selecciona una opción':'Doble clic para editar')+'" class="'+productionCellClass(value,column.header)+'">'+content+'</td>'}}).join('')+'</tr>').join('');productionEmpty.hidden=rows.length>0;document.getElementById('production-records').textContent=rows.length.toLocaleString('es-CO');document.getElementById('production-units').textContent=rows.reduce((total,row)=>total+(Number(String(row.values[7]||'').replace(/[^0-9.-]/g,''))||0),0).toLocaleString('es-CO');productionStatus.textContent=query?`Mostrando ${{rows.length}} de ${{productionData.rows.length}} registros · doble clic para editar`:`Todos los procesos disponibles · filas desde la ${{productionData.start_row}} · doble clic para editar`;decorateNotes();requestAnimationFrame(()=>{{freezeProductionColumns();syncProductionWidth();fitProductionHeight()}})}}
async function saveProductionCell(cell,value,original){{let reason=null;const header=String(productionData.headers[Number(cell.dataset.column)-1]||'').trim().toUpperCase();if(value==='R'&&processStatusHeaders.has(processKey(header))){{reason=prompt('REPROCESO · Escribe el motivo (obligatorio, máximo 2000 caracteres):');if(reason===null)return false;reason=reason.trim();if(!reason||reason.length>2000){{alert('Escribe un motivo entre 1 y 2000 caracteres.');return false}}}}if(value===original&&!reason)return true;cell.classList.add('is-saving');productionStatus.textContent=`Guardando fila ${{cell.dataset.row}}…`;try{{const response=await fetch('/api/produccion/celda',{{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{row:Number(cell.dataset.row),column:Number(cell.dataset.column),value,reason}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar');cell.classList.add('is-saved');setTimeout(()=>cell.classList.remove('is-saved'),900);const record=productionData.rows.find(row=>String(row.source_row)===cell.dataset.row);if(record){{if(data.values)record.values=data.values;else record.values[Number(cell.dataset.column)-1]=value;}}productionStatus.textContent=`✓ Cambio guardado en la fila ${{cell.dataset.row}}`;return true}}catch(error){{productionStatus.textContent=error.message;return false}}finally{{cell.classList.remove('is-saving')}}}}
    const productionMonthNames=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
    function displayProductionDate(value){{const date=scheduleParseDate(value);return date?String(date.getDate()).padStart(2,'0')+'-'+productionMonthNames[date.getMonth()]+'-'+String(date.getFullYear()).slice(-2):value}}
    function productionDateShortcut(now,withTime=false,timeOnly=false){{const parts=new Intl.DateTimeFormat('en-CA',{{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'numeric'}}).formatToParts(now),get=type=>parts.find(p=>p.type===type).value,date=get('day')+'-'+productionMonthNames[Number(get('month'))-1]+'-'+get('year').slice(-2),time=new Intl.DateTimeFormat('es-CO',{{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hour12:false}}).format(now);return timeOnly?time:withTime?date+' '+time:date}}
    async function editProductionCell(cell){{if(cell.classList.contains('is-editing')||cell.classList.contains('delivery-days-cell')||cell.querySelector('select'))return;const storedRow=productionData.rows.find(row=>String(row.source_row)===cell.dataset.row),original=String(storedRow?.values[Number(cell.dataset.column)-1]??''),input=document.createElement('input');input.className='production-cell-input';input.value=original;cell.classList.add('is-editing');cell.textContent='';cell.appendChild(input);input.focus();input.select();let finished=false;const finish=async save=>{{if(finished)return;finished=true;const value=input.value;cell.classList.remove('is-editing');cell.textContent=save?value:original;if(save&&value!==original){{const ok=await saveProductionCell(cell,value,original);if(!ok)cell.textContent=original;else setTimeout(renderProduction,120)}}}};input.addEventListener('keydown',event=>{{if(event.ctrlKey&&event.code==='Semicolon'){{event.preventDefault();const now=new Date();input.value=productionDateShortcut(now,event.altKey,event.shiftKey&&!event.altKey);return}}if(event.key==='Enter'){{event.preventDefault();input.blur()}}else if(event.key==='Escape'){{event.preventDefault();finished=true;cell.classList.remove('is-editing');cell.textContent=original}}}});input.addEventListener('blur',()=>finish(true))}}
    async function loadProduction(force=false){{productionRefresh.disabled=true;productionRefresh.textContent='Actualizando…';productionStatus.textContent='Cargando base local…';try{{const response=await fetch('/api/produccion'+(force?'?force=true':''));const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo consultar Producción');productionData=data;renderProduction()}}catch(error){{productionStatus.textContent=error.message;productionEmpty.hidden=false;productionEmpty.textContent='No fue posible cargar la información de producción.'}}finally{{productionRefresh.disabled=false;productionRefresh.textContent='Actualizar'}}}}
    const savedProductionZoom=Number(localStorage.getItem('indoor-production-zoom'));if(Number.isFinite(savedProductionZoom)&&savedProductionZoom>=.25&&savedProductionZoom<=2)productionZoom.value=String(Math.round(savedProductionZoom*100));function applyProductionZoom(){{const percent=Math.min(200,Math.max(25,Number(productionZoom.value)||100)),scale=percent/100;productionZoom.value=String(percent);productionTable.style.setProperty('--production-zoom',scale);localStorage.setItem('indoor-production-zoom',String(scale));requestAnimationFrame(()=>{{freezeProductionColumns();syncProductionWidth()}})}}applyProductionZoom();productionZoom.addEventListener('change',applyProductionZoom);productionZoom.addEventListener('keydown',event=>{{if(event.key==='Enter'){{event.preventDefault();applyProductionZoom();productionZoom.blur()}}}});productionSearch.addEventListener('input',()=>{{clearTimeout(productionTimer);productionTimer=setTimeout(renderProduction,220)}});productionRefresh.addEventListener('click',()=>loadProduction(true));productionBody.addEventListener('dblclick',event=>{{const cell=event.target.closest('td[data-row]');if(cell)editProductionCell(cell)}});productionBody.addEventListener('click',event=>{{const row=event.target.closest('tr');if(!row)return;productionBody.querySelectorAll('tr.is-selected').forEach(item=>item.classList.remove('is-selected'));row.classList.add('is-selected')}});productionBody.addEventListener('change',async event=>{{const select=event.target.closest('.production-resp-select');if(!select)return;const cell=select.closest('td'),original=select.dataset.original,value=select.value,ok=await saveProductionCell(cell,value,original);if(ok){{select.dataset.original=value;if(select.classList.contains('production-line-select')||select.classList.contains('production-applique-select'))renderProduction()}}else select.value=original}});let productionScrollFrame=0,productionScrollSource=null;function scheduleProductionScroll(source){{productionScrollSource=source;if(productionScrollFrame)return;productionScrollFrame=requestAnimationFrame(()=>{{productionScrollFrame=0;productionScrollSync=true;if(productionScrollSource===productionXScroll)productionTableWrap.scrollLeft=productionXScroll.scrollLeft;else productionXScroll.scrollLeft=productionTableWrap.scrollLeft;productionScrollSync=false}})}}productionXScroll.addEventListener('scroll',()=>{{if(!productionScrollSync)scheduleProductionScroll(productionXScroll)}},{{passive:true}});productionTableWrap.addEventListener('scroll',()=>{{if(!productionScrollSync)scheduleProductionScroll(productionTableWrap)}},{{passive:true}});
    let productionActiveCell=null;productionBody.addEventListener('click',event=>{{const cell=event.target.closest('td[data-row]');if(!cell)return;if(productionActiveCell)productionActiveCell.classList.remove('is-active-cell');productionActiveCell=cell;cell.classList.add('is-active-cell')}});document.addEventListener('keydown',async event=>{{if(!event.ctrlKey||event.code!=='Semicolon'||!productionActiveCell||productionActiveCell.classList.contains('delivery-days-cell')||productionActiveCell.querySelector('input,select'))return;event.preventDefault();const cell=productionActiveCell,original=cell.textContent,now=new Date(),value=productionDateShortcut(now,event.altKey,event.shiftKey&&!event.altKey);cell.textContent=value;const ok=await saveProductionCell(cell,value,original);if(ok)setTimeout(renderProduction,120);else cell.textContent=original}});
    const menuToggle=document.getElementById('menu-toggle'),commercialToggle=document.getElementById('commercial-toggle');function syncMenuButton(){{if(window.innerWidth<=860){{const open=document.body.classList.contains('menu-open');menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');menuToggle.textContent=open?'×':'☰'}}else{{const hidden=document.body.classList.contains('sidebar-hidden');menuToggle.setAttribute('aria-expanded',String(!hidden));menuToggle.setAttribute('aria-label',hidden?'Mostrar menú':'Ocultar menú');menuToggle.textContent=hidden?'☰':'‹'}}}}if(localStorage.getItem('indoor-sidebar-hidden')==='1')document.body.classList.add('sidebar-hidden');syncMenuButton();menuToggle.addEventListener('click',()=>{{if(window.innerWidth<=860)document.body.classList.toggle('menu-open');else{{const hidden=document.body.classList.toggle('sidebar-hidden');localStorage.setItem('indoor-sidebar-hidden',hidden?'1':'0')}}syncMenuButton()}});window.addEventListener('resize',()=>{{syncMenuButton();requestAnimationFrame(freezeProductionColumns)}});commercialToggle.addEventListener('click',()=>commercialToggle.closest('.nav-group').classList.toggle('collapsed'));
    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===t.dataset.kind));document.body.classList.toggle('inventory-mode',t.dataset.kind==='inventario');document.body.classList.toggle('production-mode',t.dataset.kind==='produccion');document.body.classList.toggle('schedule-mode',t.dataset.kind==='cronograma');if(t.dataset.kind==='produccion')loadProduction();if(t.dataset.kind==='cronograma')loadSchedule();if(window.innerWidth<=860){{document.body.classList.remove('menu-open');syncMenuButton()}}}}));
    document.getElementById('fabric-search').addEventListener('input',event=>{{const norm=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),query=norm(event.target.value.trim());let visible=0;document.querySelectorAll('#fabric-body tr').forEach(row=>{{row.hidden=!norm(row.textContent).includes(query);if(!row.hidden)visible++}});document.getElementById('fabric-count').textContent=visible+' de {len(fabrics)} telas';document.getElementById('fabric-empty').hidden=visible>0}});
    const orderForm=document.getElementById('order-form'),pdf=document.getElementById('pedido-pdf'),excel=document.getElementById('pedido-excel'),extras=document.getElementById('pedido-extras'),orderSubmit=document.getElementById('order-submit'),orderMessage=document.getElementById('order-message');
    function checkOrder(){{document.getElementById('pdf-label').textContent=pdf.files[0]?.name||'Seleccionar cotización o remisión';document.getElementById('excel-label').textContent=excel.files[0]?.name||'Seleccionar archivo .xlsx o .xlsm';document.getElementById('extras-label').textContent=extras.files.length?extras.files.length+' anexo(s) seleccionado(s)':'Imágenes u otros archivos del pedido';orderSubmit.disabled=!(pdf.files.length&&excel.files.length)}} [pdf,excel,extras].forEach(x=>x.addEventListener('change',()=>{{checkOrder();if(pdf.files.length||excel.files.length){{localStorage.removeItem(currentKeys.pedido);resetProgressButton(orderSubmit,'Procesar pedido')}}}}));
    orderForm.addEventListener('submit',async e=>{{e.preventDefault();orderSubmit.disabled=true;orderSubmit.classList.add('is-progress');orderSubmit.style.setProperty('--creator-progress','5%');orderSubmit.textContent='Enviando archivos · 5%';orderMessage.textContent='Archivos recibidos. Validando la orden…';orderMessage.className='message show ok';try{{const r=await fetch('/procesar/pedido',{{method:'POST',body:new FormData(orderForm)}});const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo procesar el pedido');remember('pedido',data.id);orderMessage.textContent='Pedido enviado. El avance se actualizará en tiempo real.';orderForm.reset();orderForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));checkOrder();await refresh()}}catch(err){{resetProgressButton(orderSubmit,'Procesar pedido');checkOrder();orderMessage.textContent=err.message;orderMessage.className='message show error'}}}}); refresh();setInterval(refresh,750);
    const creatorForm=document.getElementById('creator-form'),creatorName=document.getElementById('creator-name'),dataInput=document.getElementById('datos-listado'),creatorInputs=[1,2,3,4].map(n=>document.getElementById('d'+n)),creatorSubmit=document.getElementById('creator-submit'),creatorMessage=document.getElementById('creator-message'),addMockup=document.getElementById('add-mockup'),mockupSlots=[...document.querySelectorAll('.mockup-slot')],extraSheets=document.getElementById('extra-sheets'),addExcelSheet=document.getElementById('add-excel-sheet');
    const mockupHints=['Opcional · JPG o PNG · celda S3','Opcional · JPG o PNG · celda Y3','Opcional · JPG o PNG · celda AE3','Opcional · JPG o PNG · celda AK3'];
    function updateMockupButton(){{const hidden=mockupSlots.filter(slot=>slot.hidden);addMockup.hidden=!hidden.length;addMockup.textContent=hidden.length?'＋ Agregar otro mockup':''}}
    function resetCreatorWorkspace(){{creatorForm.reset();extraSheets.innerHTML='';creatorForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));mockupSlots.forEach(slot=>slot.hidden=true);creatorInputs.forEach((field,index)=>{{field.value='';document.getElementById('d'+(index+1)+'-label').textContent=mockupHints[index]}});document.getElementById('datos-label').textContent='Excel, Word, PDF, CSV, TXT, JPG o PNG';creatorSubmit.disabled=false;creatorSubmit.classList.remove('is-progress');creatorSubmit.style.removeProperty('--creator-progress');creatorSubmit.textContent='Crear listado XLSX';creatorMessage.textContent='';creatorMessage.className='message';localStorage.removeItem(currentKeys.creador);addExcelSheet.hidden=false;updateMockupButton()}}
    function hydrateCreatorWorkspace(job){{if(!job||hydratedCreatorJob===job.id||!job.input_summary||!['RECIBIDO','PROCESANDO'].includes(job.status))return;let summary;try{{summary=JSON.parse(job.input_summary)}}catch(e){{return}}if(!summary?.sheets?.length)return;hydratedCreatorJob=job.id;creatorForm.reset();extraSheets.innerHTML='';creatorName.value=summary.workbook_name||'';const first=summary.sheets[0],firstData=document.getElementById('datos-listado').closest('.file-row');document.getElementById('first-sheet-name').value=first.name||'';document.getElementById('datos-label').textContent=(first.data_filename||'Archivo recibido')+' · cargado';firstData.classList.add('has-file');mockupSlots.forEach(slot=>slot.hidden=true);(first.mockups||[]).forEach(mock=>{{const design=Number(mock.design);if(design>1&&mockupSlots[design-2])mockupSlots[design-2].hidden=false;const label=document.getElementById('d'+design+'-label');if(label){{label.textContent=mock.filename+' · cargado';label.closest('.file-row').classList.add('has-file')}}}});for(const spec of summary.sheets.slice(1)){{addExcelSheet.click();const sheet=extraSheets.lastElementChild,dataRow=sheet.querySelector('.sheet-data').closest('.file-row');sheet.querySelector('.sheet-name-input').value=spec.name||'';dataRow.querySelector('span').textContent=(spec.data_filename||'Archivo recibido')+' · cargado';dataRow.classList.add('has-file');const mocks=spec.mockups||[];const highest=Math.max(1,...mocks.map(mock=>Number(mock.design)||1));while(sheet.querySelectorAll('.sheet-mockup').length<highest)addDynamicMockup(sheet);mocks.forEach(mock=>{{const field=sheet.querySelector(`.sheet-mockup[data-design="${{mock.design}}"]`);if(field){{field.closest('.file-row').querySelector('span').textContent=mock.filename+' · cargado';field.closest('.file-row').classList.add('has-file')}}}})}}updateMockupButton();creatorMessage.textContent='Carga recuperada del servidor. El proceso continúa en tiempo real.';creatorMessage.className='message show ok'}}
    addMockup.addEventListener('click',()=>{{const next=mockupSlots.find(slot=>slot.hidden);if(next)next.hidden=false;updateMockupButton()}});
    mockupSlots.forEach(slot=>slot.querySelector('.remove-mockup').addEventListener('click',()=>{{const design=Number(slot.dataset.design),field=document.getElementById('d'+design);field.value='';document.getElementById('d'+design+'-label').textContent=mockupHints[design-1];slot.hidden=true;updateMockupButton()}}));
    function renumberSheets(){{[...extraSheets.querySelectorAll('.excel-sheet')].forEach((sheet,i)=>{{sheet.dataset.sheetIndex=i+1;sheet.querySelector('.sheet-title').textContent='CREADOR XLSX'}});addExcelSheet.hidden=extraSheets.children.length>=29}}
    function addDynamicMockup(sheet){{const shown=sheet.querySelectorAll('.sheet-mockup').length;if(shown>=4)return;const design=shown+1,slot=document.createElement('label');slot.className='file-row';slot.innerHTML=`<div><b>D${{design}} · ${{design===1?'Mockup principal':'Mockup adicional'}} (opcional)</b><span>JPG o PNG · se insertará en la celda ${{['S3','Y3','AE3','AK3'][design-1]}}</span></div><input class="sheet-mockup" data-design="${{design}}" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png">`;sheet.querySelector('.sheet-files').appendChild(slot);if(design===4)sheet.querySelector('.sheet-add-mockup').hidden=true}}
    addExcelSheet.addEventListener('click',()=>{{const sheet=document.createElement('div');sheet.className='excel-sheet';sheet.innerHTML=`<div class="excel-sheet-head card-head"><div><h2 class="sheet-title"></h2><p>Sube el archivo de datos y el mockup principal de esta pestaña.</p></div><button class="remove-sheet" type="button">Quitar pestaña</button></div><div class="upload-wrap"><div class="field full" style="margin-bottom:14px"><label>Nombre de la pestaña</label><input class="sheet-name-input" type="text" maxlength="31" placeholder="Ej. UNIFORME BLANCO"></div><div class="file-pair sheet-files"><label class="file-row" style="border-color:rgba(208,244,76,.5);background:rgba(208,244,76,.07)"><div><b>Archivo con los datos del listado</b><span>Excel, Word, PDF, CSV, TXT, JPG o PNG</span></div><input class="sheet-data" type="file" accept=".xlsx,.xls,.xlsm,.doc,.docx,.pdf,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" required></label></div><button class="add-mockup sheet-add-mockup" type="button">＋ Agregar otro mockup</button></div>`;extraSheets.appendChild(sheet);addDynamicMockup(sheet);sheet.querySelector('.sheet-add-mockup').addEventListener('click',()=>addDynamicMockup(sheet));sheet.querySelector('.remove-sheet').addEventListener('click',()=>{{sheet.remove();renumberSheets()}});renumberSheets()}});
    const previewModal=document.getElementById('preview-modal'),previewContent=document.getElementById('preview-content'),previewDesigns=document.getElementById('preview-designs'),previewSizeSummary=document.getElementById('preview-size-summary'),previewConfirm=document.getElementById('preview-confirm'),previewClose=document.getElementById('preview-close'),previewCancel=document.getElementById('preview-cancel');let previewDraft=null;
    function closePreview(){{previewModal.classList.remove('open')}} previewClose.addEventListener('click',closePreview);previewCancel.addEventListener('click',closePreview);
    function creatorPayload(){{const body=new FormData();body.append('nombre_archivo',creatorName.value);const added=[...extraSheets.querySelectorAll('.excel-sheet')],sheets=[null,...added];sheets.forEach((sheet,index)=>{{body.append('hoja_nombres',index===0?document.getElementById('first-sheet-name').value:sheet.querySelector('.sheet-name-input').value);body.append('datos_hoja',index===0?dataInput.files[0]:sheet.querySelector('.sheet-data').files[0]);const mocks=index===0?creatorInputs:[...sheet.querySelectorAll('.sheet-mockup')];mocks.forEach((field,i)=>{{if(field.files.length){{body.append('mockup_slots',index+':'+(Number(field.dataset.design)||i+1));body.append('mockups',field.files[0])}}}})}});return body}}
    function rowMarkup(row,index){{const size=String(row.talla||'').toUpperCase(),gender=String(row.genero||''),design=String(row.diseno||row['diseño']||'1').replace(/[^1-4]/g,'')||'1';return `<tr data-row><td>${{index+1}}</td><td><input data-field="nombre" value="${{esc(row.nombre||'')}}"></td><td><input data-field="talla" value="${{esc(size)}}"></td><td><input data-field="numero" value="${{esc(row.numero||'')}}"></td><td><select data-field="diseno"><option value="1" ${{design==='1'?'selected':''}}>D1</option><option value="2" ${{design==='2'?'selected':''}}>D2</option><option value="3" ${{design==='3'?'selected':''}}>D3</option><option value="4" ${{design==='4'?'selected':''}}>D4</option></select></td><td><select data-field="genero"><option value="" ${{!gender?'selected':''}}>Sin definir</option><option value="MASC" ${{gender==='MASC'?'selected':''}}>MASC</option><option value="FEM" ${{gender==='FEM'?'selected':''}}>FEM</option></select></td><td><input data-field="observaciones" value="${{esc(row.observaciones||'')}}"></td><td class="preview-row-actions"><button class="preview-delete" type="button" title="Quitar fila">×</button></td></tr>`}}
    function updateSizeSummary(){{const counts=new Map();let total=0;previewContent.querySelectorAll('tr[data-row] [data-field="talla"]').forEach(field=>{{const size=field.value.trim().toUpperCase();if(!size)return;counts.set(size,(counts.get(size)||0)+1);total++}});const preferred=['2','4','6','8','10','12','14','16','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL'];const sizes=[...counts.keys()].sort((a,b)=>{{const ai=preferred.indexOf(a),bi=preferred.indexOf(b);if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);return a.localeCompare(b,undefined,{{numeric:true}})}});previewSizeSummary.innerHTML=`<span class="size-total">TOTAL <b>${{total}}</b> UND.</span>${{sizes.map(size=>`<span class="size-chip">${{esc(size)}} <b>${{counts.get(size)}}</b></span>`).join('')}}`;}}
    function validatePreview(){{let warnings=[];document.querySelectorAll('.preview-sheet').forEach((sheet,sheetIndex)=>{{const seen=new Set();sheet.querySelectorAll('tr[data-row]').forEach((row,rowIndex)=>{{row.classList.remove('warning');const number=row.querySelector('[data-field="numero"]').value.trim(),size=row.querySelector('[data-field="talla"]').value.trim().toUpperCase();let issue=false;if(!size||!/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|[0-9]{{1,2}})$/.test(size)){{warnings.push(`Pestaña ${{sheetIndex+1}}, fila ${{rowIndex+1}}: talla por revisar`);issue=true}}if(!number){{warnings.push(`Pestaña ${{sheetIndex+1}}, fila ${{rowIndex+1}}: falta el número`);issue=true}}else if(seen.has(number)){{warnings.push(`Pestaña ${{sheetIndex+1}}: número ${{number}} repetido`);issue=true}}seen.add(number);row.classList.toggle('warning',issue)}})}});document.querySelectorAll('.preview-warnings').forEach(e=>e.remove());if(warnings.length){{previewContent.insertAdjacentHTML('afterbegin',`<div class="preview-warnings"><strong>Datos para revisar:</strong> ${{esc(warnings.slice(0,8).join(' · '))}}${{warnings.length>8?' · y '+(warnings.length-8)+' más':''}}</div>`)}}updateSizeSummary();return warnings}}
    function renderPreview(data){{previewDraft=data;const designs=data.sheets.flatMap((sheet,sheetIndex)=>(sheet.mockups||[]).map((mockup,designIndex)=>({{...mockup,sheetIndex,designIndex}})));previewDesigns.innerHTML=designs.length?designs.map(item=>`<div class="preview-design" title="Pestaña ${{item.sheetIndex+1}} · Diseño ${{item.design}}"><img src="${{esc(item.url)}}" alt="Diseño de la pestaña ${{item.sheetIndex+1}}"><span>P${{item.sheetIndex+1}} · D${{item.design}}</span></div>`).join(''):'<span class="preview-no-design">Sin diseño cargado</span>';previewContent.innerHTML=data.sheets.map((sheet,sheetIndex)=>`<section class="preview-sheet" data-sheet="${{sheetIndex}}"><div class="preview-sheet-title"><strong>Pestaña ${{sheetIndex+1}}</strong><input data-sheet-name value="${{esc(sheet.name||'')}}" placeholder="Nombre de la pestaña"><span>${{sheet.rows.length}} filas detectadas</span></div><div class="table-wrap"><table class="preview-table"><thead><tr><th>#</th><th>Nombre dorsal</th><th>Talla</th><th>Número</th><th>Diseño</th><th>Género</th><th>Observaciones</th><th></th></tr></thead><tbody>${{sheet.rows.map(rowMarkup).join('')}}</tbody></table></div><button class="preview-add" type="button">＋ Agregar fila</button></section>`).join('');previewContent.querySelectorAll('.preview-delete').forEach(button=>button.addEventListener('click',()=>{{button.closest('tr').remove();validatePreview()}}));previewContent.querySelectorAll('.preview-add').forEach(button=>button.addEventListener('click',()=>{{const tbody=button.closest('.preview-sheet').querySelector('tbody');tbody.insertAdjacentHTML('beforeend',rowMarkup({{}},tbody.children.length));tbody.lastElementChild.querySelector('.preview-delete').addEventListener('click',e=>{{e.currentTarget.closest('tr').remove();validatePreview()}})}}));previewContent.oninput=validatePreview;previewContent.onchange=validatePreview;validatePreview();previewModal.classList.add('open')}}
    dataInput.addEventListener('change',()=>{{document.getElementById('datos-label').textContent=dataInput.files[0]?dataInput.files[0].name:'Excel, Word, PDF, CSV, TXT, JPG o PNG'}});creatorInputs.forEach((input,i)=>input.addEventListener('change',()=>{{document.getElementById('d'+(i+1)+'-label').textContent=input.files[0]?input.files[0].name:mockupHints[i]}}));creatorForm.addEventListener('submit',async e=>{{e.preventDefault();if(!creatorName.value.trim()){{creatorMessage.textContent='Escribe el nombre que tendrá el archivo Excel.';creatorMessage.className='message show error';return}}if(!dataInput.files.length){{creatorMessage.textContent='Selecciona el archivo con los datos del listado.';creatorMessage.className='message show error';return}}const added=[...extraSheets.querySelectorAll('.excel-sheet')];if(added.some(sheet=>!sheet.querySelector('.sheet-data').files.length)){{creatorMessage.textContent='Cada pestaña de Excel debe tener su archivo con los datos.';creatorMessage.className='message show error';return}}creatorSubmit.disabled=true;creatorSubmit.classList.add('is-progress');let previewProgress=8;creatorSubmit.style.setProperty('--creator-progress',previewProgress+'%');creatorSubmit.textContent='Subiendo archivos · '+previewProgress+'%';creatorMessage.textContent='Leyendo y validando los datos antes de crear el Excel.';creatorMessage.className='message show ok';const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000),progressTimer=setInterval(()=>{{previewProgress=Math.min(88,previewProgress+(previewProgress<45?4:previewProgress<70?2:1));creatorSubmit.style.setProperty('--creator-progress',previewProgress+'%');creatorSubmit.textContent=(previewProgress<35?'Subiendo archivos':previewProgress<70?'Analizando datos':'Preparando vista previa')+' · '+previewProgress+'%'}},1400);try{{const r=await fetch('/crear-xlsx/vista-previa',{{method:'POST',body:creatorPayload(),signal:controller.signal}}),data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo preparar la vista previa');creatorSubmit.style.setProperty('--creator-progress','100%');creatorSubmit.textContent='Vista previa lista · 100%';renderPreview(data);setTimeout(()=>resetProgressButton(creatorSubmit,'Crear listado XLSX'),350);creatorSubmit.disabled=false;creatorMessage.textContent='Vista previa lista. Revisa los datos y confirma la creación.'}}catch(err){{resetProgressButton(creatorSubmit,'Crear listado XLSX');creatorSubmit.disabled=false;creatorMessage.textContent=err.name==='AbortError'?'La lectura tardó demasiado. Intenta nuevamente; tus archivos siguen seleccionados.':err.message;creatorMessage.className='message show error'}}finally{{clearTimeout(timeout);clearInterval(progressTimer)}}}});
    previewConfirm.addEventListener('click',async()=>{{if(!previewDraft)return;const sheets=[...previewContent.querySelectorAll('.preview-sheet')].map(sheet=>({{name:sheet.querySelector('[data-sheet-name]').value,rows:[...sheet.querySelectorAll('tr[data-row]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(field=>[field.dataset.field,field.value.trim()])) )}}));if(sheets.some(sheet=>!sheet.rows.length)){{alert('Cada pestaña debe tener al menos una fila.');return}}previewConfirm.disabled=true;previewConfirm.textContent='Creando Excel…';try{{const r=await fetch('/crear-xlsx/confirmar',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{draft_id:previewDraft.draft_id,workbook_name:previewDraft.workbook_name,sheets}})}}),data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo crear el Excel');remember('creador',data.id);closePreview();creatorSubmit.classList.add('is-progress');creatorSubmit.disabled=true;creatorMessage.textContent='Datos confirmados. El avance se actualizará en tiempo real.';creatorMessage.className='message show ok';await refresh()}}catch(err){{alert(err.message)}}finally{{previewConfirm.disabled=false;previewConfirm.textContent='Confirmar y crear XLSX'}}}});
    function enhanceProductionReadability(){{const scale=Math.min(2,Math.max(.25,(Number(productionZoom.value)||100)/100)),bodyPx=Math.max(12,10/scale),headPx=Math.max(10.5,8.5/scale);productionTable.style.setProperty('--production-body-font',bodyPx+'px');productionTable.style.setProperty('--production-head-font',headPx+'px');productionTable.style.setProperty('--production-group-font',headPx+'px')}}enhanceProductionReadability();productionZoom.addEventListener('input',enhanceProductionReadability);productionZoom.addEventListener('change',enhanceProductionReadability);function applyProductionRowSemaphores(){{productionBody.querySelectorAll('tr').forEach(row=>{{row.classList.remove('row-semaphore-green','row-semaphore-orange','row-semaphore-red');const delivery=row.querySelector('.delivery-days-cell');if(!delivery)return;if(delivery.classList.contains('semaphore-green'))row.classList.add('row-semaphore-green');else if(delivery.classList.contains('semaphore-orange'))row.classList.add('row-semaphore-orange');else if(delivery.classList.contains('semaphore-red'))row.classList.add('row-semaphore-red')}})}}const productionSemaphoreObserver=new MutationObserver(applyProductionRowSemaphores);productionSemaphoreObserver.observe(productionBody,{{childList:true}});applyProductionRowSemaphores();
    function enforceProductionRowColors(){{productionBody.querySelectorAll('tr').forEach(row=>{{const delivery=row.querySelector('.delivery-days-cell');if(!delivery)return;let tone='';if(delivery.classList.contains('semaphore-green'))tone='green';else if(delivery.classList.contains('semaphore-orange'))tone='orange';else if(delivery.classList.contains('semaphore-red'))tone='red';if(!tone)return;const rowColors={{green:'#181b18',orange:'#181b18',red:'#181b18'}},deliveryColors={{green:'#193719',orange:'#4a2d12',red:'#461a18'}},textColors={{green:'#dfffc4',orange:'#ffe0b3',red:'#ffd0cc'}};row.querySelectorAll('td').forEach(cell=>cell.style.setProperty('background-color',rowColors[tone],'important'));delivery.style.setProperty('background-color',deliveryColors[tone],'important');delivery.style.setProperty('color',textColors[tone],'important')}})}}const productionColorObserver=new MutationObserver(enforceProductionRowColors);productionColorObserver.observe(productionBody,{{childList:true}});enforceProductionRowColors();
    let productionDragArmed=null,productionDraggedRow=null,productionDragTarget=null,productionDragPointerY=0,productionDragFrame=0;function enhanceProductionDragHandles(){{const filtered=Boolean(productionSearch.value.trim());productionBody.querySelectorAll('tr').forEach(row=>{{const dataCell=row.querySelector('td[data-row]'),first=row.children[0];if(!dataCell||!first)return;row.dataset.sourceRow=dataCell.dataset.row;row.draggable=!filtered;if(filtered||first.querySelector('.production-drag-handle'))return;const existing=[...first.childNodes],tools=document.createElement('div'),handle=document.createElement('span');tools.className='production-row-tools';handle.className='production-drag-handle';handle.textContent='☰';handle.title='Arrastra para mover esta fila';handle.setAttribute('aria-label','Mover fila');tools.appendChild(handle);existing.forEach(node=>tools.appendChild(node));first.appendChild(tools)}})}}const productionDragObserver=new MutationObserver(enhanceProductionDragHandles);productionDragObserver.observe(productionBody,{{childList:true}});enhanceProductionDragHandles();function pauseProductionObservers(){{productionSemaphoreObserver.disconnect();productionColorObserver.disconnect();productionDragObserver.disconnect()}}function resumeProductionObservers(){{productionSemaphoreObserver.observe(productionBody,{{childList:true}});productionColorObserver.observe(productionBody,{{childList:true}});productionDragObserver.observe(productionBody,{{childList:true}});applyProductionRowSemaphores();enforceProductionRowColors();enhanceProductionDragHandles()}}productionBody.addEventListener('pointerdown',event=>{{const handle=event.target.closest('.production-drag-handle');productionDragArmed=handle?handle.closest('tr'):null}});productionBody.addEventListener('dragstart',event=>{{const row=event.target.closest('tr');if(!row||row!==productionDragArmed||productionSearch.value.trim()){{event.preventDefault();return}}pauseProductionObservers();productionDraggedRow=row;row.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',row.dataset.sourceRow)}});productionBody.addEventListener('dragover',event=>{{if(!productionDraggedRow)return;event.preventDefault();const target=event.target.closest('tr');if(!target||target===productionDraggedRow)return;productionDragTarget=target;productionDragPointerY=event.clientY;if(productionDragFrame)return;productionDragFrame=requestAnimationFrame(()=>{{productionDragFrame=0;const activeTarget=productionDragTarget;if(!activeTarget||activeTarget===productionDraggedRow)return;productionBody.querySelectorAll('.drag-target').forEach(row=>row.classList.remove('drag-target'));activeTarget.classList.add('drag-target');const rect=activeTarget.getBoundingClientRect(),after=productionDragPointerY>rect.top+rect.height/2;productionBody.insertBefore(productionDraggedRow,after?activeTarget.nextSibling:activeTarget);const wrapRect=productionTableWrap.getBoundingClientRect(),edge=70;if(productionDragPointerY<wrapRect.top+edge)productionTableWrap.scrollTop-=18;else if(productionDragPointerY>wrapRect.bottom-edge)productionTableWrap.scrollTop+=18}})}});productionBody.addEventListener('drop',event=>{{if(productionDraggedRow)event.preventDefault()}});productionBody.addEventListener('dragend',async()=>{{if(!productionDraggedRow)return;if(productionDragFrame)cancelAnimationFrame(productionDragFrame);productionDragFrame=0;productionDraggedRow.classList.remove('is-dragging');productionBody.querySelectorAll('.drag-target').forEach(row=>row.classList.remove('drag-target'));productionDraggedRow=null;productionDragTarget=null;productionDragArmed=null;resumeProductionObservers();const orderedRows=[...productionBody.querySelectorAll('tr[data-source-row]')].map(row=>Number(row.dataset.sourceRow));productionStatus.textContent='Guardando nuevo orden…';try{{const response=await fetch('/api/produccion/orden',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{rows:orderedRows}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar el orden');const byRow=new Map(productionData.rows.map(row=>[Number(row.source_row),row]));productionData.rows=orderedRows.map(row=>byRow.get(row)).filter(Boolean);productionStatus.textContent='✓ Nuevo orden guardado para todos los operarios'}}catch(error){{productionStatus.textContent=error.message;await loadProduction()}}}});
    function enhanceProductionDeleteButtons(){{productionBody.querySelectorAll('tr[data-source-row] .production-row-tools').forEach(tools=>{{if(tools.querySelector('.production-delete-row'))return;const button=document.createElement('button');button.type='button';button.className='production-delete-row';button.textContent='×';button.title='Eliminar esta fila';button.setAttribute('aria-label','Eliminar fila');const handle=tools.querySelector('.production-drag-handle');handle.insertAdjacentElement('afterend',button)}})}}const productionDeleteObserver=new MutationObserver(enhanceProductionDeleteButtons);productionDeleteObserver.observe(productionBody,{{childList:true,subtree:true}});enhanceProductionDeleteButtons();productionBody.addEventListener('click',async event=>{{const button=event.target.closest('.production-delete-row');if(!button)return;event.preventDefault();event.stopPropagation();const row=button.closest('tr'),sourceRow=Number(row.dataset.sourceRow),record=productionData?.rows.find(item=>Number(item.source_row)===sourceRow),orderIndex=productionData?.headers.findIndex(header=>String(header||'').trim().toUpperCase()==='ORDEN')??-1,order=record&&orderIndex>=0?String(record.values[orderIndex]||'').trim():'';if(!confirm(`¿Eliminar definitivamente la fila${{order?' de la orden '+order:''}}?`))return;button.disabled=true;productionStatus.textContent='Eliminando fila…';try{{const response=await fetch('/api/produccion/fila/'+sourceRow,{{method:'DELETE'}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo eliminar la fila');productionData=null;await loadProduction();productionStatus.textContent='✓ Fila eliminada correctamente'}}catch(error){{button.disabled=false;productionStatus.textContent=error.message}}}});
    function sealFrozenProductionColumns(){{productionBody.querySelectorAll('tr').forEach(row=>{{let color='#0f140d';if(row.classList.contains('row-semaphore-green'))color='#142714';else if(row.classList.contains('row-semaphore-orange'))color='#2d2012';else if(row.classList.contains('row-semaphore-red'))color='#2b1715';row.querySelectorAll('td.production-frozen').forEach(cell=>{{cell.style.setProperty('background-color',color,'important');cell.style.setProperty('opacity','1','important')}})}})}}let frozenSealFrame=0;function scheduleFrozenSeal(){{if(frozenSealFrame)return;frozenSealFrame=requestAnimationFrame(()=>{{frozenSealFrame=0;sealFrozenProductionColumns()}})}}const frozenSealObserver=new MutationObserver(scheduleFrozenSeal);frozenSealObserver.observe(productionBody,{{childList:true,subtree:true}});window.addEventListener('resize',scheduleFrozenSeal,{{passive:true}});
const scheduleGrid=document.getElementById('schedule-grid'),scheduleMonth=document.getElementById('schedule-month'),scheduleCount=document.getElementById('schedule-count');
function scheduleToday(){{const p=new Intl.DateTimeFormat('en-CA',{{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}}).formatToParts(new Date());const get=k=>Number(p.find(x=>x.type===k).value);return new Date(get('year'),get('month')-1,get('day'))}}
let scheduleDate=scheduleToday();const scheduleView='month';
const scheduleExtras=document.createElement('div');scheduleExtras.className='schedule-extras';scheduleExtras.innerHTML='<div class="schedule-metrics" aria-label="Resumen de entregas"></div><div class="schedule-filters"><input id="schedule-search" type="search" placeholder="Buscar cliente u orden" aria-label="Buscar cliente u orden"></div>';
document.querySelector('.schedule-summary').before(scheduleExtras);
const scheduleSearch=document.getElementById('schedule-search');
scheduleSearch.addEventListener('input',renderSchedule);
function scheduleMove(direction){{scheduleDate=scheduleView==='week'?new Date(scheduleDate.getFullYear(),scheduleDate.getMonth(),scheduleDate.getDate()+direction*7):new Date(scheduleDate.getFullYear(),scheduleDate.getMonth()+direction,1);renderSchedule()}}

    function scheduleHeaderIndex(name){{const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();return productionData?productionData.headers.findIndex(header=>normalize(header)===normalize(name)):-1}}
    function scheduleParseDate(value){{const raw=String(value||'').trim().toLowerCase().replaceAll('.','');if(!raw)return null;const parts=raw.split(/[-/ ]+/);if(parts.length<3)return null;const months={{ene:0,enero:0,feb:1,febrero:1,mar:2,marzo:2,abr:3,abril:3,may:4,mayo:4,jun:5,junio:5,jul:6,julio:6,ago:7,agosto:7,sep:8,sept:8,septiembre:8,oct:9,octubre:9,nov:10,noviembre:10,dic:11,diciembre:11}};let day=Number(parts[0]),month=/^[0-9]+$/.test(parts[1])?Number(parts[1])-1:months[parts[1]],year=Number(parts[2]);if(year<100)year+=2000;if(!Number.isInteger(day)||month===undefined||!Number.isInteger(year))return null;const date=new Date(year,month,day);return date.getFullYear()===year&&date.getMonth()===month&&date.getDate()===day?date:null}}
    function scheduleISO(date){{return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}}
    function scheduleOrders(){{if(!productionData)return[];const delivery=scheduleHeaderIndex('FECHA DE ENTREGA'),order=scheduleHeaderIndex('ORDEN'),client=scheduleHeaderIndex('NOMBRE DEL CLIENTE'),project=scheduleHeaderIndex('NOMBRE PROYECTO'),quantity=scheduleHeaderIndex('CANTIDAD'),reference=scheduleHeaderIndex('REFERENCIA'),delivered=scheduleHeaderIndex('ENTREGADO');if(delivery<0)return[];const grouped=new Map();productionData.rows.forEach(row=>{{const values=row.values||row;const date=scheduleParseDate(values[delivery]);if(!date)return;const orderName=String(values[order]||'SIN ORDEN').trim(),key=scheduleISO(date)+'|'+orderName;let item=grouped.get(key);if(!item){{item={{date,order:orderName,client:String(values[client]||'').trim(),project:String(values[project]||'').trim(),units:0,references:0,delivered:true}};grouped.set(key,item)}}item.delivered=item.delivered&&(delivered>=0&&(!!scheduleParseDate(values[delivered])||String(values[delivered]||'').trim().toUpperCase()==='SI'));item.units+=Number(String(values[quantity]||'0').replace(/[^0-9.-]/g,''))||0;if(String(values[reference]||'').trim())item.references++}});return[...grouped.values()]}}
function renderSchedule(){{
if(!scheduleGrid||!productionData)return;
const today=scheduleToday(),todayKey=scheduleISO(today),weekStart=new Date(today);weekStart.setDate(today.getDate()-(today.getDay()+6)%7);const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+7);
const all=scheduleOrders(),query=scheduleSearch.value.trim().toLocaleLowerCase('es'),orders=all.filter(item=>!query||(item.order+' '+item.client).toLocaleLowerCase('es').includes(query));
document.querySelector('.schedule-metrics').innerHTML=[['Hoy',all.filter(i=>scheduleISO(i.date)===todayKey).length],['Esta semana',all.filter(i=>i.date>=weekStart&&i.date<weekEnd).length],['Vencidas sin entregar',all.filter(i=>i.date<today&&!i.delivered).length]].map(([label,count])=>'<div><span>'+label+'</span><strong>'+count+'</strong></div>').join('');
const month=scheduleDate.getMonth(),start=scheduleView==='week'?new Date(scheduleDate):new Date(scheduleDate.getFullYear(),month,1);start.setDate(start.getDate()-(start.getDay()+6)%7);
const days=scheduleView==='week'?7:42,end=new Date(start);end.setDate(start.getDate()+days);const last=new Date(end);last.setDate(last.getDate()-1);
scheduleMonth.textContent=scheduleView==='week'?start.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}})+' — '+last.toLocaleDateString('es-CO',{{day:'numeric',month:'short',year:'numeric'}}):scheduleDate.toLocaleDateString('es-CO',{{month:'long',year:'numeric'}});
const visible=orders.filter(i=>i.date>=start&&i.date<end);scheduleCount.textContent=visible.length+' pedidos en vista'+(query?' · búsqueda activa':'');
scheduleGrid.classList.toggle('week-view',scheduleView==='week');
scheduleExtras.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===scheduleView)));
document.getElementById('schedule-prev').setAttribute('aria-label',scheduleView==='week'?'Semana anterior':'Mes anterior');document.getElementById('schedule-next').setAttribute('aria-label',scheduleView==='week'?'Semana siguiente':'Mes siguiente');
const byDate=new Map();visible.forEach(item=>{{const key=scheduleISO(item.date);if(!byDate.has(key))byDate.set(key,[]);byDate.get(key).push(item)}});
let html='';for(let n=0;n<days;n++){{const date=new Date(start);date.setDate(start.getDate()+n);const key=scheduleISO(date),events=byDate.get(key)||[];html+='<div class="schedule-day'+(scheduleView==='month'&&date.getMonth()!==month?' outside':'')+(key===todayKey?' today':'')+(events.length>1?' multiple-deliveries':'')+'">'+(events.length>1?'<button type="button" class="schedule-day-total" aria-label="Ver las '+events.length+' entregas">'+events.length+' entregas</button>':'')+'<div class="schedule-day-number">'+date.getDate()+'</div><div class="schedule-events">'+events.map(item=>{{const status=item.delivered?'Entregado':item.date<today?'Vencido':key===todayKey?'Hoy':'Programado',tone=item.delivered?'done':item.date<today?'late':key===todayKey?'due':'planned';return '<button class="schedule-event" type="button" data-order="'+esc(item.order)+'" title="Abrir '+esc(item.order)+' · '+esc(item.client)+' en Trazabilidad"><strong>'+esc(item.order)+'</strong><span class="schedule-client">'+esc(item.client||item.project||'Sin cliente')+'</span><span class="schedule-units">'+item.units.toLocaleString('es-CO')+' <span class="u-full">unidades</span><span class="u-short">u.</span></span><small class="schedule-badge '+tone+'">'+status+'</small></button>'}}).join('')+(!events.length&&scheduleView==='week'?'<span class="schedule-no-orders">Sin entregas</span>':'')+'</div></div>'}}scheduleGrid.innerHTML=html;requestAnimationFrame(fitDeliveryChips);
}}
    async function loadSchedule(){{if(productionData){{renderSchedule();return}}scheduleCount.textContent='Cargando pedidos…';try{{const response=await fetch('/api/produccion'),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo cargar el cronograma');productionData=data;renderSchedule()}}catch(error){{scheduleCount.textContent=error.message;scheduleGrid.innerHTML='<div class="schedule-empty">No fue posible cargar las fechas de los pedidos.</div>'}}}}
document.getElementById('schedule-prev').addEventListener('click',()=>scheduleMove(-1));document.getElementById('schedule-next').addEventListener('click',()=>scheduleMove(1));document.getElementById('schedule-today').addEventListener('click',()=>{{scheduleDate=scheduleToday();renderSchedule()}});scheduleGrid.addEventListener('click',async event=>{{const button=event.target.closest('.schedule-event');if(!button)return;button.disabled=true;try{{const response=await fetch('/api/produccion/proceso-orden?order='+encodeURIComponent(button.dataset.order)),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo consultar el proceso');orderProgress.hidden=false;orderProgress.textContent=button.dataset.order+' · '+(data.process?(data.basis.startsWith('finished')?'Último proceso terminado: ':'En proceso: ')+data.process:'Sin proceso en curso ni fecha de terminado');selectedProcess=processKey(data.process);localStorage.setItem('indoor-production-process',selectedProcess);exactScheduleOrder=button.dataset.order;productionSearch.value=button.dataset.order;productionTableWrap.scrollLeft=0;productionTableWrap.scrollTop=0;productionXScroll.scrollLeft=0;document.getElementById('production-toggle').closest('.nav-group').classList.remove('collapsed');document.querySelector('.tab[data-kind="produccion"]').click();renderProduction()}}catch(error){{alert(error.message)}}finally{{button.disabled=false}}}});loadSchedule();
const scheduleStyle=document.createElement('style');scheduleStyle.textContent=`
body.schedule-mode{{overflow-y:auto}}
body.schedule-mode .schedule-toolbar{{padding:18px 24px}}
.schedule-extras{{padding:14px 20px;background:#171b18;border-bottom:1px solid #343b34}}
.schedule-metrics{{display:flex;gap:36px;margin-bottom:14px}}.schedule-metrics>div{{display:flex;gap:12px;align-items:center}}.schedule-metrics span{{font-size:12px;color:#b6bfb6}}.schedule-metrics strong{{font-size:22px;color:#f3f5f2}}
.schedule-filters{{display:flex;gap:14px;justify-content:space-between}}.schedule-filters input{{width:min(440px,65%);padding:10px 12px;background:#222723;border:1px solid #485047;border-radius:8px;color:white;font:inherit;font-size:14px}}.schedule-view{{display:flex;gap:5px}}.schedule-view button{{width:auto;padding:9px 18px;background:#232924;border:1px solid #465044;color:#c9d2c5;box-shadow:none}}.schedule-view button[aria-pressed=true]{{background:#3a4630;color:#f1f6e9;border-color:#899967}}
body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,minmax(120px,auto))}}
body.schedule-mode .schedule-grid.week-view{{grid-template-rows:minmax(330px,auto)}}
body.schedule-mode .schedule-day{{background:#171b18;padding:10px;min-height:120px}}
body.schedule-mode .schedule-day.outside{{background:#111512}}
body.schedule-mode .schedule-day.today{{box-shadow:inset 0 0 0 1px #a2b878}}
body.schedule-mode .schedule-events{{max-height:220px;display:flex;flex-direction:column;gap:7px;overflow:auto}}
body.schedule-mode .week-view .schedule-events{{max-height:55vh}}
body.schedule-mode .schedule-event{{background:#252c27;border:1px solid #424b41;border-radius:8px;padding:10px;text-align:left;white-space:normal;flex-shrink:0;box-shadow:none}}
body.schedule-mode .schedule-event:hover{{background:#303a31;border-color:#8a9c79}}
body.schedule-mode .schedule-event strong{{font-size:14px;color:#f1f5ed;line-height:1.4}}
body.schedule-mode .schedule-event span{{display:block;white-space:normal;font-size:12px;line-height:1.45;margin-top:4px;color:#c1cbbd;overflow-wrap:anywhere}}
body.schedule-mode .schedule-event .schedule-units{{color:#a3aea0;font-size:11px}}
.schedule-badge{{display:inline-block;margin-top:8px;padding:2px 6px;border-radius:4px;background:#353e36;color:#c4cec2;font-size:10px}}
.schedule-badge.late{{background:#49302e;color:#f3b9af}}.schedule-badge.due{{background:#49422d;color:#ead99e}}.schedule-badge.done{{background:#294239;color:#bbd9cb}}
.schedule-no-orders{{font-size:12px;color:#798477;padding-top:12px}}
body.schedule-mode .schedule-day-number{{font-size:13px}}
@media(max-width:700px){{.schedule-metrics{{gap:14px;flex-wrap:wrap}}.schedule-metrics>div{{gap:7px}}.schedule-metrics strong{{font-size:18px}}body.schedule-mode .schedule-grid.week-view{{display:flex;flex-direction:column}}body.schedule-mode .week-view .schedule-day{{min-height:100px}}body.schedule-mode .schedule-event{{padding:6px}}body.schedule-mode .schedule-event strong{{font-size:11px}}body.schedule-mode .schedule-event span{{font-size:10px}}.schedule-extras{{padding:12px}}.schedule-view button{{padding:8px}}.schedule-filters input{{min-width:0}}}}
`;document.head.appendChild(scheduleStyle);
    const scheduleFitStyle=document.createElement('style');scheduleFitStyle.textContent=`
html:has(body.schedule-mode),html body.schedule-mode{{overflow:hidden!important;height:100dvh}}
body.schedule-mode main{{padding-bottom:0!important}}
body.schedule-mode .footer-note{{display:none}}
body.schedule-mode .schedule-shell{{display:grid;grid-template-rows:auto auto auto auto minmax(0,1fr);height:var(--schedule-height,calc(100dvh - 150px));min-height:0;overflow:hidden!important}}
body.schedule-mode .schedule-toolbar{{padding:9px 16px;gap:8px}}
body.schedule-mode .schedule-title .eyebrow,body.schedule-mode .schedule-title p{{display:none}}
body.schedule-mode .schedule-title h2{{font-size:18px;margin:0}}
body.schedule-mode .schedule-actions button{{padding:6px 10px;min-width:36px}}
body.schedule-mode .schedule-extras{{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 16px}}
body.schedule-mode .schedule-metrics{{margin:0;gap:20px;flex-wrap:nowrap}}
body.schedule-mode .schedule-metrics strong{{font-size:18px}}
body.schedule-mode .schedule-filters{{flex:0 1 320px;min-width:0}}
body.schedule-mode .schedule-filters input{{width:100%;padding:7px 10px}}
body.schedule-mode .schedule-summary{{padding:6px 16px}}
body.schedule-mode .schedule-grid{{min-height:0;overflow:hidden;grid-template-rows:repeat(6,minmax(0,1fr))!important}}
body.schedule-mode .schedule-day{{display:flex;flex-direction:column;min-height:0;height:auto!important;padding:4px 6px;overflow:hidden}}
body.schedule-mode .schedule-day-number{{flex:0 0 18px;height:18px;margin-bottom:2px;font-size:12px}}
@media(max-width:860px){{body.schedule-mode .sidebar{{transform:translateX(-105%)}}body.schedule-mode.menu-open .sidebar{{transform:translateX(0)}}body.schedule-mode main{{margin-left:0!important;width:100%;padding:68px 7px 0!important}}body.schedule-mode .brand{{position:fixed;top:4px;left:64px;right:7px;width:auto}}}}
@media(max-height:500px) and (min-width:621px){{body.schedule-mode .brand{{display:none}}body.schedule-mode main{{padding-top:4px!important}}body.schedule-mode .schedule-toolbar{{padding-left:65px}}}}
body.schedule-mode .schedule-events{{flex:1;min-height:0;max-height:none!important;gap:4px;overflow-y:auto!important;overscroll-behavior:contain}}
body.schedule-mode .schedule-event{{padding:4px 6px;text-align:center}}
body.schedule-mode .schedule-event strong{{font-size:12px}}
body.schedule-mode .schedule-event span{{font-size:11px;margin-top:1px;line-height:1.2}}
body.schedule-mode .schedule-event .schedule-client{{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
body.schedule-mode .schedule-badge{{margin-top:3px;font-size:9px}}
@media(max-width:700px){{
body.schedule-mode .schedule-extras{{display:block;padding:5px 8px}}
body.schedule-mode .schedule-metrics{{justify-content:space-between;gap:6px;margin-bottom:4px}}
body.schedule-mode .schedule-metrics>div{{gap:5px}}
body.schedule-mode .schedule-metrics span{{font-size:10px}}
body.schedule-mode .schedule-metrics strong{{font-size:15px}}
body.schedule-mode .schedule-filters input{{font-size:16px;padding:4px 8px}}
body.schedule-mode .schedule-toolbar{{padding:6px 8px;display:flex;flex-direction:row}}
body.schedule-mode .schedule-title h2{{font-size:15px}}
body.schedule-mode .schedule-summary{{padding:4px 8px}}
body.schedule-mode .schedule-summary strong{{font-size:12px}}
body.schedule-mode .schedule-summary span{{font-size:9px}}
body.schedule-mode .schedule-day{{padding:2px}}
body.schedule-mode .schedule-event{{padding:3px 2px}}
body.schedule-mode .schedule-event strong{{font-size:9px;white-space:normal;overflow-wrap:anywhere}}
body.schedule-mode .schedule-event span{{font-size:9px}}
body.schedule-mode .schedule-event .schedule-units{{font-size:8px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}}
body.schedule-mode .schedule-events{{scrollbar-gutter:auto;scrollbar-width:thin}}
body.schedule-mode .schedule-badge{{font-size:8px;padding:1px 2px}}
}}
`;document.head.appendChild(scheduleFitStyle);
    const deliveryChipStyle=document.createElement('style');deliveryChipStyle.textContent=`
body.schedule-mode .schedule-day{{position:relative}}
body.schedule-mode .schedule-events{{overflow:hidden!important;scrollbar-gutter:auto}}
body.schedule-mode .schedule-events{{display:grid;grid-template-columns:repeat(auto-fit,minmax(85px,1fr));grid-auto-rows:max-content;align-content:start;gap:3px}}
body.schedule-mode .schedule-event{{padding:3px;min-width:0;height:auto;border-radius:5px}}
body.schedule-mode .schedule-event strong{{font-size:11px;white-space:nowrap}}
body.schedule-mode .schedule-event span{{display:block;font-size:10px;line-height:1.15;margin-top:2px}}
body.schedule-mode .schedule-event .schedule-client{{white-space:normal;overflow-wrap:anywhere}}
body.schedule-mode .schedule-badge{{display:inline-block;margin-top:2px;font-size:8px}}
.schedule-day-total{{position:absolute;top:3px;left:5px;width:auto;padding:0 3px;border:0;background:transparent;color:#cdddbb;font-size:10px;line-height:18px;box-shadow:none;cursor:pointer}}
.schedule-deliveries-dialog{{width:min(520px,94vw);max-height:85dvh;overflow:auto;background:#1b211c;color:#eef3e9;border:1px solid #647456;border-radius:14px;padding:20px}}
.schedule-deliveries-dialog::backdrop{{background:#000a}}
.schedule-deliveries-dialog h2{{font-size:18px;margin-bottom:15px}}
.schedule-deliveries-dialog .schedule-event{{display:block;text-align:center;margin-top:8px;width:100%}}
.schedule-deliveries-close{{width:auto;float:right;background:#323b2c;color:#fff;padding:5px 10px;box-shadow:none}}
@media(max-width:700px){{body.schedule-mode .schedule-events{{grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;gap:2px}}body.schedule-mode .schedule-event{{height:auto;padding:2px}}body.schedule-mode .schedule-event strong{{font-size:9px}}body.schedule-mode .schedule-event span{{font-size:9px}}body.schedule-mode .multiple-deliveries .schedule-day-number{{margin-bottom:15px}}.schedule-day-total{{top:20px;left:1px;font-size:8px;line-height:13px;padding:0}}}}
`;document.head.appendChild(deliveryChipStyle);
    const simpleDeliveryStyle=document.createElement('style');simpleDeliveryStyle.textContent='body.schedule-mode .schedule-event .schedule-client,body.schedule-mode .schedule-event .schedule-badge{{display:none!important}}body.schedule-mode .schedule-event{{text-align:center}}body.schedule-mode .schedule-event .schedule-units{{display:block;white-space:normal;font-size:10px;line-height:1.25;margin-top:2px}}';document.head.appendChild(simpleDeliveryStyle);
    function fitDeliveryChips(){{document.querySelectorAll('.multiple-deliveries .schedule-events').forEach(list=>{{const buttons=[...list.children];buttons.forEach(button=>button.style.visibility='');const bottom=list.getBoundingClientRect().bottom;buttons.forEach(button=>{{if(button.getBoundingClientRect().bottom>bottom+1)button.style.visibility='hidden'}})}})}}window.addEventListener('resize',()=>requestAnimationFrame(fitDeliveryChips));new ResizeObserver(fitDeliveryChips).observe(scheduleGrid);
    const deliveriesDialog=document.createElement('dialog');deliveriesDialog.className='schedule-deliveries-dialog';deliveriesDialog.innerHTML='<button type="button" class="schedule-deliveries-close" aria-label="Cerrar entregas">×</button><h2>Entregas del día</h2><div class="schedule-deliveries-list"></div>';document.body.appendChild(deliveriesDialog);deliveriesDialog.querySelector('.schedule-deliveries-close').onclick=()=>deliveriesDialog.close();let deliverySourceButtons=[];scheduleGrid.addEventListener('click',event=>{{const total=event.target.closest('.schedule-day-total');if(!total)return;deliverySourceButtons=[...total.closest('.schedule-day').querySelectorAll('.schedule-event')];deliveriesDialog.querySelector('h2').textContent=total.textContent+' · día '+total.closest('.schedule-day').querySelector('.schedule-day-number').textContent;const list=deliveriesDialog.querySelector('.schedule-deliveries-list');list.replaceChildren();deliverySourceButtons.forEach(source=>{{const clone=source.cloneNode(true);clone.style.visibility='';clone.onclick=()=>{{deliveriesDialog.close();source.click()}};list.appendChild(clone)}});deliveriesDialog.showModal()}});
    let scheduleFitFrame=0;function fitScheduleViewport(){{if(scheduleFitFrame)return;scheduleFitFrame=requestAnimationFrame(()=>{{scheduleFitFrame=0;if(!document.body.classList.contains('schedule-mode'))return;const shell=document.querySelector('.schedule-shell'),viewport=window.visualViewport,top=shell.getBoundingClientRect().top,bottom=viewport?viewport.height+viewport.offsetTop:window.innerHeight;shell.style.setProperty('--schedule-height',Math.max(0,Math.floor(bottom-top-6))+'px')}})}}window.addEventListener('resize',fitScheduleViewport);window.visualViewport?.addEventListener('resize',fitScheduleViewport);new MutationObserver(fitScheduleViewport).observe(document.body,{{attributes:true,attributeFilter:['class']}});new ResizeObserver(fitScheduleViewport).observe(document.querySelector('.brand'));fitScheduleViewport();
    let realtimeSyncBusy=false;async function syncProductionRealtime(){{if(realtimeSyncBusy||document.hidden||productionDraggedRow||productionBody.querySelector('.is-editing'))return;realtimeSyncBusy=true;try{{const response=await fetch('/api/produccion',{{cache:'no-store'}});if(!response.ok)return;const data=await response.json(),changed=!productionData||data.updated_at!==productionData.updated_at||data.rows.length!==productionData.rows.length;if(!changed)return;productionData=data;const active=document.querySelector('.tab.active')?.dataset.kind;if(active==='produccion'){{renderProduction();productionStatus.textContent='✓ Datos sincronizados automáticamente'}}else if(active==='cronograma')renderSchedule()}}catch(error){{console.warn('Sincronización pendiente',error)}}finally{{realtimeSyncBusy=false}}}}setInterval(syncProductionRealtime,3000);document.addEventListener('visibilitychange',()=>{{if(!document.hidden)syncProductionRealtime()}});window.addEventListener('focus',syncProductionRealtime);
    const userArea=document.querySelector('.systems');userArea.innerHTML=`<details class="user-menu"><summary><span class="user-avatar">{escape(user_initials)}</span><span class="user-info"><strong>{escape(str(_))}</strong><small>{escape(user_process)}</small></span><span aria-hidden="true">▾</span></summary><div class="user-dropdown"><p>{escape(user_process)}</p><button type="button" id="open-profile">Mi perfil</button><button type="button" id="open-password">Cambiar contraseña</button><a href="/logout">Cerrar sesión</a></div></details>`;
    const accountDialog=document.createElement('dialog');accountDialog.className='account-dialog';accountDialog.innerHTML=`<button type="button" class="account-close" aria-label="Cerrar">×</button><h2 id="account-title">Mi perfil</h2><section id="account-profile"><p>Nombre</p><strong>{escape(str(_))}</strong><p>Proceso</p><strong>{escape(user_process)}</strong></section><form id="account-password" hidden><label>Contraseña actual<input name="current" type="password" autocomplete="current-password" required maxlength="256"></label><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="6" maxlength="256" required></label><label>Confirmar contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="6" maxlength="256" required></label><button type="submit">Guardar contraseña</button></form><p id="account-message" role="status"></p>`;document.body.appendChild(accountDialog);
    function openAccount(password){{document.querySelector('.user-menu').open=false;document.getElementById('account-title').textContent=password?'Cambiar contraseña':'Mi perfil';document.getElementById('account-profile').hidden=password;document.getElementById('account-password').hidden=!password;document.getElementById('account-password').reset();document.getElementById('account-message').textContent='';accountDialog.showModal()}}document.getElementById('open-profile').onclick=()=>openAccount(false);document.getElementById('open-password').onclick=()=>openAccount(true);accountDialog.querySelector('.account-close').onclick=()=>accountDialog.close();document.addEventListener('click',event=>{{if(!event.target.closest('.user-menu'))document.querySelector('.user-menu').open=false}});document.addEventListener('keydown',event=>{{if(event.key==='Escape')document.querySelector('.user-menu').open=false}});
    document.getElementById('account-password').onsubmit=async event=>{{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),message=document.getElementById('account-message'),button=form.querySelector('button');if(fields.get('password')!==fields.get('confirm')){{message.textContent='Las contraseñas no coinciden.';return}}button.disabled=true;try{{const response=await fetch('/api/cuenta/password',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{current:fields.get('current'),password:fields.get('password')}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar');form.reset();message.textContent='Contraseña actualizada correctamente.'}}catch(error){{message.textContent=error.message}}finally{{button.disabled=false}}}};
const traceViewBar=document.createElement('div');traceViewBar.className='trace-view-bar';traceViewBar.innerHTML='<span>Vista</span><button type="button" data-trace-view="cards">Tarjetas</button><button type="button" data-trace-view="table">Tabla</button>';
document.querySelector('.production-process-filter').appendChild(traceViewBar);
const traceScheduleButton=document.createElement('button');traceScheduleButton.type='button';traceScheduleButton.className='production-refresh';traceScheduleButton.id='trace-schedule-order';traceScheduleButton.textContent='+ Programar pedido';traceScheduleButton.onclick=()=>{{document.getElementById('commercial-toggle').closest('.nav-group').classList.remove('collapsed');document.querySelector('.tab[data-kind="pedido"]').click();document.getElementById('order-form').scrollIntoView({{block:'start',behavior:'smooth'}})}};traceViewBar.after(traceScheduleButton);
const traceCards=document.createElement('div');traceCards.className='trace-cards';traceCards.hidden=true;productionTableWrap.after(traceCards);
const traceDetail=document.createElement('dialog');traceDetail.className='trace-detail';traceDetail.innerHTML='<button type="button" class="trace-close" aria-label="Cerrar detalle">×</button><div class="trace-detail-content"></div>';document.body.appendChild(traceDetail);traceDetail.querySelector('.trace-close').onclick=()=>traceDetail.close();
const canViewAdministration={json.dumps(' '.join(str(user_process).casefold().split()) in ('administración', 'administracion', 'comercial', 'comerciales', 'asistente comercial', 'asistentes comerciales'))};
let traceView='cards';
const traceAssets=new Map(),traceAssetBusy=new Set();
const traceDesignSelection=new Map();
function traceField(row,name){{const index=scheduleHeaderIndex(name);return index>=0?String(row.values[index]||''):''}}
function traceOpenTable(sourceRow){{openOperatorProduction(Number(sourceRow))}}
function setTraceView(){{if(traceView==='table'&&!canViewAdministration)traceView='cards';localStorage.setItem('indoor-trace-view',traceView);document.body.classList.toggle('trace-cards-mode',traceView==='cards');traceCards.hidden=traceView!=='cards';traceViewBar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.traceView===traceView)));if(traceView==='cards')renderTraceCards();else requestAnimationFrame(()=>{{freezeProductionColumns();fitProductionHeight()}})}}
traceViewBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{{traceView=b.dataset.traceView;setTraceView()}});
function traceAssetsMarkup(sourceRow){{const asset=traceAssets.get(sourceRow);if(!asset)return '<span>Buscando diseño…</span>';if(asset.error)return '<span>'+esc(asset.error)+'</span><button type="button" data-card-retry="'+sourceRow+'">Reintentar</button>';if(!asset.images.length)return '<div class="trace-no-design"><span aria-hidden="true">◇</span><strong>Sin diseño adjunto</strong><small>'+esc(asset.image_status||'Información del pedido disponible')+'</small></div>';const images=asset.images.slice(0,4),selected=Math.min(traceDesignSelection.get(Number(sourceRow))||0,images.length-1),current=images[selected];return '<div class="trace-design-view"><a class="trace-design-main" href="'+esc(current.url)+'" target="_blank" rel="noopener" title="Ampliar diseño del listado Excel"><img loading="lazy" src="'+esc(current.url)+'" alt="'+esc(current.name)+'"></a><div class="trace-design-tabs" aria-label="Diseños del pedido">'+images.map((image,i)=>'<button type="button" data-design-row="'+sourceRow+'" data-design-index="'+i+'" aria-pressed="'+(i===selected)+'">D'+(image.design||i+1)+'</button>').join('')+'</div></div>'}}
function paintTraceAssets(sourceRow){{const card=traceCards.querySelector('[data-card-row="'+sourceRow+'"]');if(card)card.querySelector('.trace-media').innerHTML=traceAssetsMarkup(sourceRow)}}
async function loadTraceAssets(sourceRow,force=false){{if((traceAssets.has(sourceRow)&&!force)||traceAssetBusy.has(sourceRow))return;traceAssetBusy.add(sourceRow);let changed=false;try{{const response=await fetch('/api/produccion/fila/'+sourceRow+'/archivos',{{cache:'no-store'}});const data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo consultar el NAS');if(JSON.stringify(traceAssets.get(sourceRow))!==JSON.stringify(data)){{traceAssets.set(sourceRow,data);changed=true}}}}catch(error){{if(!traceAssets.has(sourceRow)){{traceAssets.set(sourceRow,{{error:error.message}});changed=true}}}}finally{{traceAssetBusy.delete(sourceRow);if(changed)paintTraceAssets(sourceRow)}}}}
let traceSyncBusy=false;
async function syncTraceMockups(){{if(traceSyncBusy||document.hidden||traceCards.hidden||document.querySelector('.tab.active')?.dataset.kind!=='produccion')return;traceSyncBusy=true;try{{const bounds=traceCards.getBoundingClientRect(),rows=[...traceCards.querySelectorAll('[data-card-row]')].filter(card=>{{const r=card.getBoundingClientRect();return r.bottom>Math.max(0,bounds.top)&&r.top<Math.min(innerHeight,bounds.bottom)}}).map(card=>Number(card.dataset.cardRow));for(let i=0;i<rows.length;i+=2){{if(document.hidden||traceCards.hidden)break;await Promise.all(rows.slice(i,i+2).map(id=>loadTraceAssets(id,true)))}}}}finally{{traceSyncBusy=false}}}}
setInterval(syncTraceMockups,15000);window.addEventListener('focus',syncTraceMockups);document.addEventListener('visibilitychange',()=>{{if(!document.hidden)syncTraceMockups()}});
const traceImageObserver=new IntersectionObserver(entries=>{{entries.filter(e=>e.isIntersecting).forEach(e=>{{loadTraceAssets(Number(e.target.dataset.cardRow));traceImageObserver.unobserve(e.target)}})}},{{root:traceCards,rootMargin:'100px'}});
const traceExpandedProcesses=new Set();
traceCards.addEventListener('click',event=>{{const summary=event.target.closest('.trace-process summary');if(!summary)return;const detail=summary.parentElement;traceCards.querySelectorAll('.trace-process[open]').forEach(other=>{{if(other!==detail){{other.open=false;traceExpandedProcesses.delete(other.dataset.processKey)}}}});const info=detail.querySelector('.trace-process-info');if(!info.querySelector('.trace-node-title')){{const title=document.createElement('h4');title.className='trace-node-title';title.textContent=summary.querySelector('strong').textContent+' · '+summary.querySelector('small').textContent;info.prepend(title)}}}});
document.addEventListener('click',event=>{{if(event.target.closest('.trace-process'))return;traceCards.querySelectorAll('.trace-process[open]').forEach(detail=>{{detail.open=false;traceExpandedProcesses.delete(detail.dataset.processKey)}})}});
traceViewBar.hidden=true;
const adminGroup=document.createElement('div');adminGroup.className='nav-group collapsed';adminGroup.innerHTML='<button class="nav-parent" type="button"><span class="nav-icon">AD</span><span>ADMINISTRACIÓN</span></button><div class="nav-children"><button class="tab" data-kind="produccion" data-admin-summary="true" type="button"><span class="nav-icon">RP</span><strong>Resumen pedidos</strong></button></div>';document.querySelector('nav.tabs').appendChild(adminGroup);adminGroup.querySelector('.nav-parent').onclick=()=>adminGroup.classList.toggle('collapsed');
const traceNav=document.querySelector('.tab.production-nav'),adminNav=adminGroup.querySelector('.tab');
traceNav.addEventListener('click',()=>{{traceView='cards';setTraceView();document.body.classList.remove('admin-summary-mode')}});
adminNav.onclick=()=>{{if(!canViewAdministration)return;traceNav.click();document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===adminNav));traceView='table';setTraceView();document.body.classList.add('admin-summary-mode');adminGroup.classList.remove('collapsed')}};
const commercialMenu=commercialToggle.closest('.nav-group');
commercialMenu.querySelectorAll('.nav-children > .tab').forEach(tab=>adminGroup.querySelector('.nav-children').appendChild(tab));
commercialMenu.hidden=true;commercialMenu.style.display='none';
traceScheduleButton.hidden=!canViewAdministration;
traceScheduleButton.onclick=()=>{{if(!canViewAdministration)return;adminGroup.classList.remove('collapsed');adminGroup.querySelector('[data-kind="pedido"]').click();document.getElementById('order-form').scrollIntoView({{block:'start',behavior:'smooth'}})}};
if(!canViewAdministration)adminGroup.remove();
const indoorProcessFlow={json.dumps(PROCESS_FLOW, ensure_ascii=False)};
const operatorHeaders=new Set(indoorProcessFlow.flatMap(p=>p.headers));
const operatorDialog=document.createElement('dialog');operatorDialog.className='operator-dialog';operatorDialog.innerHTML='<form id="operator-form"><button type="button" class="operator-close" aria-label="Cerrar">×</button><h2>Producción</h2><p class="operator-order"></p><label>Proceso<select name="column" required></select></label><p class="operator-current"></p><label>Responsable / iniciales<input name="responsible" required maxlength="80" autocomplete="off"></label><label>Motivo u observación<textarea name="reason" maxlength="2000" rows="3" placeholder="Obligatorio para reproceso"></textarea></label><div class="operator-actions"><button name="action" value="start" type="submit">Iniciar / retomar</button><button name="action" value="rework" type="submit">Reproceso</button><button name="action" value="finish" type="submit">Terminar</button><button name="action" value="na" type="submit">No aplica</button></div><p class="operator-message" role="status"></p></form><h3>Historial de actividad</h3><div class="operator-history"></div>';document.body.appendChild(operatorDialog);
let operatorRow=null,operatorExpected='',operatorSaving=false;
const operatorForm=operatorDialog.querySelector('form');
operatorForm.elements.responsible.readOnly=true;
operatorForm.elements.responsible.closest('label').firstChild.textContent='Responsable · usuario conectado';
operatorDialog.querySelector('.operator-close').onclick=()=>{{if(!operatorSaving)operatorDialog.close()}};operatorDialog.addEventListener('cancel',e=>{{if(operatorSaving)e.preventDefault()}});
function operatorSelection(){{const row=productionData.rows.find(r=>r.source_row===operatorRow),i=Number(operatorForm.elements.column.value)-1;if(!row||i<0)return;operatorExpected=String(row.values[i]||'');operatorDialog.querySelector('.operator-current').textContent='Estado actual: '+(operatorExpected?displayProductionDate(operatorExpected):'Pendiente');operatorForm.elements.responsible.value=document.querySelector('.user-info strong').textContent;operatorForm.elements.reason.value=''}}
operatorForm.elements.column.onchange=operatorSelection;
async function operatorHistory(){{const id=operatorRow;try{{const response=await fetch('/api/produccion/operaciones/'+id,{{cache:'no-store'}});if(!response.ok)throw Error();const events=await response.json();if(id!==operatorRow)return;const labels={{start:'Inicio / retoma',rework:'Reproceso',finish:'Terminado',na:'No aplica'}};operatorDialog.querySelector('.operator-history').innerHTML=events.map(e=>'<article><strong>'+esc(productionData.headers[e.column_number-1]||'Proceso')+' · '+esc(labels[e.action]||e.action)+'</strong><p>'+esc(e.responsible)+' · Registró: '+esc(e.username)+'</p><time>'+esc(new Date(e.created_at).toLocaleString('es-CO',{{timeZone:'America/Bogota'}}))+'</time>'+(e.reason?'<p>'+esc(e.reason)+'</p>':'')+'</article>').join('')||'<p>Sin registros nuevos. Los datos anteriores se conservan en la tarjeta.</p>'}}catch(error){{operatorDialog.querySelector('.operator-history').textContent='No se pudo consultar el historial.'}}}}
function openOperatorProduction(id){{operatorRow=id;const row=productionData.rows.find(r=>r.source_row===id);if(!row)return;operatorDialog.querySelector('.operator-order').textContent=traceField(row,'ORDEN')+' · '+traceField(row,'REFERENCIA')+' · '+traceField(row,'NOMBRE DEL CLIENTE');const area=processKey(document.querySelector('.user-info small')?.textContent||''),eligible=productionData.headers.map((h,i)=>({{h,i}})).filter(item=>operatorHeaders.has(processKey(item.h))),matches=eligible.filter(item=>processKey(item.h)===area),groupMatches=eligible.filter(item=>processKey(productionData.groups[item.i]||'')===area),selected=matches.length===1?matches[0]:groupMatches.length===1?groupMatches[0]:null;operatorForm.elements.column.innerHTML='<option value="">Selecciona un proceso</option>'+eligible.map(({{h,i}})=>'<option value="'+(i+1)+'">'+esc(productionData.groups[i]||h)+' · '+esc(h)+'</option>').join('');if(selected)operatorForm.elements.column.value=String(selected.i+1);operatorDialog.querySelector('.operator-current').textContent='';operatorForm.elements.responsible.value=document.querySelector('.user-info strong').textContent;operatorForm.elements.reason.value='';operatorExpected='';operatorSelection();operatorDialog.querySelector('.operator-message').textContent=selected?'Proceso seleccionado según tu perfil. La fecha y hora se guardan automáticamente.':'Selecciona el proceso de esta actividad. Tu perfil no tiene un proceso único asignado.';operatorDialog.querySelector('.operator-history').textContent='Consultando…';operatorDialog.showModal();operatorHistory()}}
operatorForm.onsubmit=async event=>{{
  event.preventDefault();
  if(operatorSaving)return;
  const action=event.submitter?.value;
  if(!action)return;
  const reason=operatorForm.elements.reason.value.trim(),responsible=operatorForm.elements.responsible.value.trim(),message=operatorDialog.querySelector('.operator-message');
  if(!responsible||action==='rework'&&!reason){{message.textContent='Indica el responsable y, para reproceso, el motivo.';return}}
  operatorSaving=true;
  const controls=[...operatorForm.querySelectorAll('button,input,select,textarea')],payload={{row:operatorRow,column:Number(operatorForm.elements.column.value),action,responsible,reason,expected:operatorExpected}};
  controls.forEach(c=>c.disabled=true);
  message.textContent='Guardando…';
  try{{
    const response=await fetch('/api/produccion/operacion',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(payload)}}),data=await response.json();
    if(!response.ok)throw Error(data.detail||'No se pudo guardar');
    const row=productionData.rows.find(r=>r.source_row===operatorRow);
    if(row)row.values=data.values;
    operatorExpected=String(data.values[payload.column-1]||'');
    operatorForm.elements.reason.value='';
    operatorDialog.close();
    await syncProductionRealtime();
    renderTraceCards();
    productionStatus.textContent='✓ Actividad guardada con fecha y hora.';
  }}catch(error){{message.textContent=error.message}}
  finally{{operatorSaving=false;controls.forEach(c=>c.disabled=false)}}
}};
function traceProcessMarkup(row){{
const groups=[];productionData.headers.forEach((header,index)=>{{const label=String(productionData.groups[index]||'').replace(/^['"]|['"]$/g,'').trim(),key=processKey(label);if(!key||key==='GENERAL'||key.includes('LINEA PRODUCCION')||key.includes('METODOLOG'))return;let group=groups[groups.length-1];if(!group||group.key!==key||group.end!==index-1){{group={{key,label,start:index,end:index,columns:[]}};groups.push(group)}}group.end=index;group.columns.push(index)}});
return '<section class="trace-processes"><h4>Seguimiento de producción</h4><div class="trace-process-grid">'+groups.map(group=>{{
const columns=group.columns.filter(i=>!processKey(productionData.headers[i]).includes('CORREO')),statusColumns=columns.filter(i=>processStatusHeaders.has(processKey(productionData.headers[i]))||processKey(productionData.headers[i])===group.key||['DISEÑO','DISENO','CONFECCION','CORTE TEXTIL/PLT'].includes(processKey(productionData.headers[i]))),states=statusColumns.map(i=>String(row.values[i]||'').trim().toUpperCase());
let tone='pending',status='Pendiente';if(states.includes('R')){{tone='rework';status='Reproceso'}}else if(states.includes('P')){{tone='active';status='En proceso'}}else if(states.length&&states.every(v=>v==='N/A'||scheduleParseDate(v))){{tone='finished';status=states.every(v=>v==='N/A')?'No aplica':'Completado'}}else if(states.some(v=>v==='N/A'||scheduleParseDate(v))){{tone='partial';status='Avance parcial'}}
if(['pending','partial'].includes(tone)&&(productionData.auto_closed||[]).includes(row.source_row+':'+(group.start+1))){{tone='finished';status='Cierre automático'}}
const responsible=columns.filter(i=>isResponsibleHeader(productionData.headers[i])||processKey(productionData.headers[i])==='CONFECCIONISTA').map(i=>String(row.values[i]||'').trim()).filter(Boolean).join(' · '),notes=columns.filter(i=>productionData.notes?.[row.source_row+':'+(i+1)]),id=row.source_row+':'+group.start;
const fields=columns.filter(i=>String(row.values[i]??'').trim()).map(i=>'<div><dt>'+esc(productionData.headers[i])+'</dt><dd>'+esc(displayProductionDate(String(row.values[i])))+'</dd></div>').join('');
return '<details class="trace-process '+tone+'" data-process-key="'+id+'" '+(traceExpandedProcesses.has(id)?'open':'')+'><summary><span class="trace-process-dot" aria-hidden="true"></span><span><strong>'+esc(group.label)+'</strong><small>'+status+'</small></span>'+(notes.length?'<span class="trace-process-note">'+notes.length+' nota'+(notes.length===1?'':'s')+'</span>':'')+'</summary><div class="trace-process-info"><p class="trace-process-responsible">Responsable: '+esc(responsible||'Sin asignar')+'</p><dl>'+fields+'</dl>'+(!fields?'<p>Sin información registrada todavía.</p>':'')+notes.map(i=>'<div class="trace-process-comment"><strong>'+esc(productionData.headers[i])+'</strong><p>'+esc(productionData.notes[row.source_row+':'+(i+1)])+'</p></div>').join('')+'</div></details>'}}).join('')+'</div></section>';
}}
function renderTraceCards(){{
if(!productionData||traceView!=='cards')return;traceImageObserver.disconnect();
const visible=new Set([...productionBody.querySelectorAll('tr')].map(tr=>Number(tr.querySelector('td[data-row]')?.dataset.row))),rows=productionData.rows.filter(row=>visible.has(row.source_row)&&['ORDEN','NOMBRE DEL CLIENTE','NOMBRE PROYECTO','REFERENCIA'].some(name=>traceField(row,name).trim()));
traceCards.innerHTML=rows.map(row=>{{const current=row.current_process||{{label:'Sin iniciar',state:'pending'}},notes=Object.entries(productionData.notes||{{}}).filter(([key,value])=>key.startsWith(row.source_row+':')&&value),processIndex=productionData.groups.findIndex(g=>processKey(g)===processKey(current.label));let responsible='';for(let i=Math.max(0,processIndex);processIndex>=0&&i<productionData.headers.length&&productionData.groups[i]===productionData.groups[processIndex];i++){{if(isResponsibleHeader(productionData.headers[i])){{responsible=row.values[i]||'';break}}}}
return '<article class="trace-card" data-card-row="'+row.source_row+'"><div class="trace-media">'+traceAssetsMarkup(row.source_row)+'</div><div class="trace-card-body"><div class="trace-card-heading"><h3>'+esc(traceField(row,'ORDEN'))+'</h3><span>Fila '+row.source_row+'</span></div><p class="trace-client">'+esc(traceField(row,'NOMBRE DEL CLIENTE'))+'</p><p class="trace-project">'+esc(traceField(row,'NOMBRE PROYECTO'))+'</p><dl><div><dt>Referencia</dt><dd>'+esc(traceField(row,'REFERENCIA'))+'</dd></div><div><dt>Cantidad</dt><dd>'+esc(traceField(row,'CANTIDAD'))+' und.</dd></div><div><dt>Entrega</dt><dd>'+esc(displayProductionDate(traceField(row,'FECHA DE ENTREGA')))+'</dd></div><div><dt>Responsable del proceso</dt><dd>'+esc(responsible||'Sin asignar')+'</dd></div></dl><div class="trace-stage '+esc(current.state)+'">'+esc((current.state==='active'?'En proceso: ':current.state==='finished'?'Último terminado: ':'')+current.label)+'</div><p class="trace-note-count">'+notes.length+' nota'+(notes.length===1?'':'s')+'</p><div class="trace-card-actions"><button type="button" data-card-detail="'+row.source_row+'">Ver detalle</button><button type="button" data-card-edit="'+row.source_row+'">Editar fila</button><button type="button" data-card-nas="'+row.source_row+'">NAS ↗</button></div></div></article>'}}).join('')||'<p class="trace-empty">No hay filas que coincidan con la búsqueda.</p>';
traceCards.querySelectorAll('[data-card-row]').forEach(card=>{{const row=rows.find(r=>r.source_row===Number(card.dataset.cardRow));const action=card.querySelector('[data-card-edit]');action.textContent='Producción';action.classList.add('operator-open');card.insertAdjacentHTML('beforeend',traceProcessMarkup(row));card.querySelectorAll('[data-process-key]').forEach(detail=>detail.addEventListener('toggle',()=>{{if(!detail.isConnected)return;if(detail.open)traceExpandedProcesses.add(detail.dataset.processKey);else traceExpandedProcesses.delete(detail.dataset.processKey)}}));traceImageObserver.observe(card)}});fitTraceCards();
}}
function fitTraceCards(){{if(!document.body.classList.contains('production-mode')||traceView!=='cards')return;traceCards.style.height=Math.max(180,innerHeight-traceCards.getBoundingClientRect().top-12)+'px'}}
window.addEventListener('resize',fitTraceCards);new MutationObserver(()=>{{if(traceView==='cards')renderTraceCards()}}).observe(productionBody,{{childList:true}});
traceCards.addEventListener('click',async event=>{{const button=event.target.closest('button');if(!button)return;
if(button.dataset.cardRetry){{const id=Number(button.dataset.cardRetry);traceAssets.delete(id);paintTraceAssets(id);loadTraceAssets(id);return}}
if(button.dataset.designRow){{const id=Number(button.dataset.designRow);traceDesignSelection.set(id,Number(button.dataset.designIndex));paintTraceAssets(id);traceCards.querySelector('[data-design-row="'+id+'"][data-design-index="'+button.dataset.designIndex+'"]')?.focus();return}}
if(button.dataset.cardEdit){{traceOpenTable(button.dataset.cardEdit);return}}
if(button.dataset.cardNas){{productionBody.querySelector('td[data-row="'+button.dataset.cardNas+'"]')?.closest('tr').querySelector('.production-row-open')?.click();return}}
if(button.dataset.cardDetail){{const id=Number(button.dataset.cardDetail),row=productionData.rows.find(r=>r.source_row===id);if(!row)return;traceDetail.querySelector('.trace-detail-content').innerHTML='<h2>'+esc(traceField(row,'ORDEN'))+' · '+esc(traceField(row,'REFERENCIA'))+'</h2><p>'+esc(traceField(row,'NOMBRE DEL CLIENTE'))+'</p><div class="trace-detail-assets">Consultando archivos…</div><h3>Información de la fila</h3><dl>'+productionData.headers.map((h,i)=>row.values[i]?'<div><dt>'+esc(h)+'</dt><dd>'+esc(row.values[i])+'</dd></div>':'').join('')+'</dl><h3>Notas</h3>'+Object.entries(productionData.notes||{{}}).filter(([key,value])=>key.startsWith(id+':')&&value).map(([key,value])=>'<p class="trace-full-note"><strong>'+esc(productionData.headers[Number(key.split(':')[1])-1])+'</strong><br>'+esc(value)+'</p>').join('');traceDetail.showModal();await loadTraceAssets(id);const asset=traceAssets.get(id);if(!traceDetail.open)return;traceDetail.querySelector('.trace-detail-assets').innerHTML=asset?.error?esc(asset.error):asset?asset.images.map(image=>'<a href="'+esc(image.url)+'" target="_blank" rel="noopener"><img src="'+esc(image.url)+'" alt="'+esc(image.name)+'"></a>').join('')+'<h3>Listados y documentos de la orden</h3>'+(asset.documents.map(file=>'<a class="trace-document" href="'+esc(file.url)+'" target="_blank" rel="noopener">'+esc(file.name)+'</a>').join('')||'<p>No se encontraron documentos en la carpeta principal.</p>'):'La imagen sigue cargando; vuelve a abrir el detalle.'}}
}});
const traceStyle=document.createElement('style');traceStyle.textContent=`
.sidebar nav.tabs button{{text-transform:uppercase}}
.trace-view-bar[hidden]{{display:none!important}}.operator-dialog{{width:min(600px,94vw);max-height:90dvh;overflow:auto;background:#19221c;color:#e5eee7;border:1px solid #53654f;border-radius:16px;padding:24px}}.operator-dialog::backdrop{{background:#000a}}.operator-dialog label{{display:block;margin:14px 0;font-size:13px}}.operator-dialog input,.operator-dialog select,.operator-dialog textarea{{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;background:#27312b;color:#edf3ef;border:1px solid #526355;border-radius:7px;font:14px Arial}}.operator-actions{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}.operator-actions button{{padding:12px;border-radius:8px;font:600 13px Arial;border:1px solid #556955;background:#cfeb96;color:#172116;cursor:pointer}}.operator-actions button[value=rework]{{background:#873737;color:white}}.operator-actions button[value=start]{{background:#efb65c;color:#241a09}}.operator-dialog button:disabled{{opacity:.5;cursor:wait}}.operator-close{{float:right;width:32px!important;background:transparent!important;color:white!important;border:0!important;padding:4px!important}}.operator-history article{{border-top:1px solid #3f4d42;padding:12px 0;font:12px/1.5 Arial}}.operator-history p{{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}}.operator-message{{font-size:13px;color:#cfeb96}}.operator-current{{font-size:13px;color:#a9d5ee}}body.production-mode .trace-card-actions .operator-open{{background:#d4ec98;color:#182315;font-weight:600}}
.trace-processes{{grid-column:1/-1;padding:18px 22px;border-top:1px solid #35403a;background:#171e1a;min-width:0}}.trace-processes h4{{margin:0 0 12px;font:600 14px Arial;color:#e5ece7}}.trace-process-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;align-items:start}}.trace-process{{border:1px solid #374039;border-radius:8px;background:#202823;min-width:0}}.trace-process summary{{display:flex;align-items:center;gap:8px;padding:11px;cursor:pointer;list-style:none}}.trace-process summary::-webkit-details-marker{{display:none}}.trace-process summary strong{{display:block;font:500 11px Arial;overflow-wrap:anywhere;color:#e3eae5}}.trace-process summary small{{display:block;margin-top:5px;font:11px Arial;color:#a8b4ab}}.trace-process-dot{{width:8px;height:8px;flex:none;border-radius:50%;background:#78837b}}.trace-process.active .trace-process-dot{{background:#f5a623}}.trace-process.rework .trace-process-dot{{background:#ef6262}}.trace-process.finished .trace-process-dot{{background:#66c58a}}.trace-process.partial .trace-process-dot{{background:#9ac9ee}}.trace-process-note{{margin-left:auto;font:10px Arial;color:#9ac9ee;white-space:nowrap}}.trace-process-info{{padding:0 11px 12px;font:12px/1.5 Arial;color:#c3cfc6}}.trace-process-info dl{{display:block;margin:10px 0}}.trace-process-info dl div{{margin-bottom:8px}}.trace-process-info dt{{font-size:10px;color:#9aa99f}}.trace-process-info dd{{margin:2px 0;overflow-wrap:anywhere;color:#e6eee9}}.trace-process-responsible{{color:#aad6f4}}.trace-process-comment{{border-top:1px solid #39483e;padding-top:8px;margin-top:8px}}.trace-process-comment p{{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}}.trace-process summary:focus-visible{{outline:2px solid #9ac9ee;border-radius:8px}}
.trace-process-grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 0;align-items:start;overflow:visible;padding:8px 0;counter-reset:process-node}}
.trace-processes h4::after{{content:'Pulsa un punto para ver los detalles';display:block;margin-top:6px;font:11px/1.5 Arial;color:#97aa9d}}
.trace-process{{position:relative;flex:0 0 132px;border:0;border-radius:0;background:transparent;counter-increment:process-node}}
.trace-process::before{{content:'';position:absolute;top:10px;left:0;right:0;height:2px;background:#425147;pointer-events:none}}
.trace-process:nth-child(4n+1)::before{{left:50%}}.trace-process:nth-child(4n)::before,.trace-process:last-child::before{{right:50%}}
.trace-process summary{{position:relative;flex-direction:column;justify-content:flex-start;gap:8px;text-align:center;padding:0 5px 6px;min-height:76px}}
.trace-process-dot{{position:relative;z-index:1;width:22px;height:22px;box-sizing:border-box;display:grid;place-items:center;border:2px solid #718077;background:#202a23;box-shadow:0 0 0 3px #171e1a;color:#becbc2;font:600 10px Arial}}
.trace-process-dot::after{{content:counter(process-node)}}
.trace-process.active .trace-process-dot{{background:#312718;border:3px solid #f5a623;color:#ffd38c;box-shadow:0 0 0 5px #171e1a,0 0 0 8px #f5a62330}}
.trace-process.active .trace-process-dot::after{{content:'';width:6px;height:6px;border-radius:50%;background:#f5a623;animation:trace-node-pulse 1.6s ease-in-out infinite}}
.trace-process.finished .trace-process-dot{{background:#214733;border-color:#70d798;color:#a9f4c5}}.trace-process.finished .trace-process-dot::after{{content:'✓';font-size:22px}}
.trace-process.rework .trace-process-dot{{background:#422525;border-color:#ef6262;color:#ffb2b2}}.trace-process.rework .trace-process-dot::after{{content:'!';font-size:22px}}
.trace-process.partial .trace-process-dot{{background:#213743;border-color:#9ac9ee;color:#c5e6ff}}
.trace-process summary strong{{font-size:11px;line-height:1.4}}.trace-process.active summary small{{color:#ffd38c}}.trace-process.finished summary small{{color:#9ce6b6}}.trace-process.rework summary small{{color:#ffa8a8}}
.trace-process-note{{margin:0;font-size:10px}}.trace-process[open]{{min-width:0}}.trace-process-info{{background:#222e26;border:1px solid #405448;border-radius:10px;margin:0 3px;padding:8px;text-align:left;overflow-wrap:anywhere}}.trace-process.finished .trace-process-dot::after,.trace-process.rework .trace-process-dot::after{{font-size:13px}}
@media(max-width:700px){{.trace-process-grid{{grid-template-columns:repeat(3,minmax(0,1fr))}}.trace-process:nth-child(n)::before{{left:0;right:0}}.trace-process:nth-child(3n+1)::before{{left:50%}}.trace-process:nth-child(3n)::before,.trace-process:last-child::before{{right:50%}}.trace-processes{{padding:16px 12px}}.trace-process summary strong{{font-size:10px}}}}
@keyframes trace-node-pulse{{0%,100%{{opacity:1;transform:scale(1)}}50%{{opacity:.5;transform:scale(.72)}}}}@media(prefers-reduced-motion:reduce){{.trace-process.active .trace-process-dot::after{{animation:none}}}}
.trace-process-grid{{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;align-items:start}}
.trace-process:nth-child(n)::before{{left:0;right:0;top:9px}}.trace-process:first-child::before{{left:50%}}.trace-process:last-child::before{{right:50%}}
.trace-process-dot{{width:20px;height:20px;font-size:9px}}.trace-process summary{{padding:0 2px 8px;gap:8px;min-height:90px}}.trace-process summary strong{{font-size:9px;line-height:1.3;overflow-wrap:anywhere}}.trace-process summary small{{font-size:9px;overflow-wrap:anywhere}}.trace-process-note{{font-size:8px;white-space:normal}}
.trace-process[open] .trace-process-info{{position:fixed;z-index:1200;bottom:20px;left:50%;transform:translateX(-50%);width:min(400px,calc(100vw - 48px));box-sizing:border-box;max-height:50dvh;overflow:auto;box-shadow:0 12px 45px #000b;padding:18px}}.trace-process[open] summary{{background:#ffffff0a;border-radius:6px}}
@media(max-width:700px){{.trace-process-grid{{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}}.trace-process-dot{{width:14px;height:14px;font-size:8px;border-width:1px}}.trace-process.active .trace-process-dot{{border-width:2px;box-shadow:0 0 0 2px #171e1a,0 0 0 3px #f5a62330}}.trace-process:nth-child(n)::before{{top:6px}}.trace-process summary{{min-height:32px;padding:4px 0 8px}}.trace-process:nth-child(n)::before{{top:10px}}.trace-process summary>span:not(.trace-process-dot){{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}.trace-process.finished .trace-process-dot::after,.trace-process.rework .trace-process-dot::after{{font-size:10px}}}}
.trace-process summary>span:not(.trace-process-dot){{min-width:0;max-width:100%}}.trace-process summary strong,.trace-process summary small,.trace-process-note{{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;max-width:100%}}.trace-process summary{{min-height:64px}}.trace-processes h4::after{{content:'Procesos en línea · pulsa un punto para ver su nombre completo y detalles'}}
.trace-view-bar{{display:flex;align-items:center;gap:5px;font-size:13px}}.trace-view-bar button,.trace-card-actions button{{width:auto;padding:8px 12px;background:#273026;color:#e6efdf;border:1px solid #52624a;border-radius:7px;box-shadow:none;font-size:13px}}
.trace-view-bar button[aria-pressed=true]{{background:#caed61;color:#18210d}}
body.production-mode.trace-cards-mode .production-table-wrap,body.production-mode.trace-cards-mode .production-x-scroll{{display:none}}
body.production-mode.trace-cards-mode .production-zoom-group{{display:none}}
.trace-cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(295px,1fr));align-content:start;gap:18px;padding:18px;overflow:auto;background:#111612}}
.trace-cards[hidden]{{display:none}}.trace-card{{border:1px solid #3a4439;border-radius:13px;overflow:hidden;background:#1b221c}}
.trace-media{{height:180px;background:#e9eeea;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#52604f;text-align:center;font-size:13px;padding:8px}}.trace-media img{{width:100%;height:100%;object-fit:contain}}
.trace-card-body{{padding:16px}}.trace-card-heading{{display:flex;align-items:center;justify-content:space-between}}.trace-card-heading h3{{margin:0;color:#e4f7ac;font-size:20px}}.trace-card-heading span{{font-size:12px;color:#899685}}
.trace-client{{font-size:15px;color:#f0f3eb;margin:9px 0 4px}}.trace-project{{font-size:13px;color:#aab6a5;margin:0 0 16px}}
.trace-card dl{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 15px}}.trace-card dt,.trace-detail dt{{font-size:12px;color:#9caa95}}.trace-card dd,.trace-detail dd{{margin:3px 0 0;font-size:14px;color:#ecf0e7;overflow-wrap:anywhere}}
.trace-stage{{padding:8px;border-radius:6px;background:#30392c;font-size:13px;color:#d3ddc9}}.trace-stage.active{{background:#4b3b21;color:#f3d196}}.trace-stage.finished{{background:#254236;color:#bce4c9}}
.trace-note-count{{font-size:12px;color:#aebca5;margin:10px 0}}.trace-card-actions{{display:flex;gap:7px;flex-wrap:wrap}}
.trace-detail{{width:min(880px,94vw);max-height:88dvh;overflow:auto;background:#1b221c;border:1px solid #61704f;border-radius:14px;color:#e8eee2;padding:24px}}.trace-detail::backdrop{{background:#000a}}.trace-close{{float:right;width:auto;background:#303b29;color:white;padding:5px 10px;box-shadow:none}}.trace-detail dl{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}.trace-detail-assets img{{max-width:180px;height:150px;object-fit:contain;background:#eee;margin:8px}}.trace-document{{display:block;color:#acd6ff;margin:8px 0}}.trace-full-note{{white-space:pre-wrap;background:#273025;padding:12px;border-radius:8px}}
@media(max-width:620px){{.trace-cards{{grid-template-columns:1fr;padding:10px;gap:12px}}.trace-detail dl{{grid-template-columns:1fr 1fr}}}}
@media(max-width:860px){{body.production-mode.trace-cards-mode .sidebar{{transform:translateX(-105%)}}body.production-mode.trace-cards-mode.menu-open .sidebar{{transform:translateX(0)}}body.production-mode.trace-cards-mode main{{margin-left:0!important;width:100%;padding:68px 7px 0}}body.production-mode.trace-cards-mode .brand{{position:fixed;top:4px;left:64px;right:7px;width:auto}}}}
body.production-mode .trace-cards{{grid-auto-rows:max-content}}body.production-mode .trace-card{{min-height:480px}}
`;document.head.appendChild(traceStyle);
const tracePolish=document.createElement('style');tracePolish.textContent=`
body.production-mode .trace-cards{{grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:22px;padding:24px;background:#101412}}
body.production-mode .trace-card{{min-height:0;display:flex;flex-direction:column;background:#1a201d;border:1px solid #35403a;border-radius:16px;box-shadow:0 4px 16px #0002;transition:border-color .18s,box-shadow .18s}}
body.production-mode .trace-card:hover{{border-color:#65765c;box-shadow:0 8px 24px #0004}}
body.production-mode .trace-media{{height:210px;padding:14px;background:#edf0ee;border-bottom:1px solid #35403a}}
body.production-mode .trace-media:not(:has(img)){{height:94px;background:linear-gradient(120deg,#252f29,#1d2621);color:#a4b2a7;font-size:13px;padding:20px 26px}}
body.production-mode .trace-media img{{border-radius:6px}}
.trace-mockups{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;height:100%;min-height:0}}.trace-mockups[data-count="1"]{{grid-template-columns:1fr}}.trace-mockups a{{display:flex;flex-direction:column;align-items:center;min-width:0;min-height:0;text-decoration:none;color:#334238}}.trace-mockups img{{flex:1;min-height:0;object-fit:contain}}.trace-mockups span{{flex:none;font-size:11px;line-height:18px}}.trace-mockups a:focus-visible{{outline:2px solid #357bbc;outline-offset:2px}}
body.production-mode .trace-card-body{{padding:22px;display:flex;flex-direction:column;flex:1}}
body.production-mode .trace-card-heading{{gap:10px;margin-bottom:13px}}
body.production-mode .trace-card-heading h3{{font-size:23px;letter-spacing:-.025em;font-weight:700;color:#f4f7f2;line-height:1.2}}
body.production-mode .trace-card-heading>span{{border:1px solid #3c4940;border-radius:20px;padding:3px 8px;font-size:11px;color:#9fafa3;white-space:nowrap}}
body.production-mode .trace-client{{font-size:15px;font-weight:600;line-height:1.45;margin:0 0 5px;color:#e0e7e0}}
body.production-mode .trace-project{{font-size:13px;line-height:1.45;font-weight:400;color:#98a79b;margin:0 0 20px}}
body.production-mode .trace-card dl{{gap:17px 14px;padding:17px 0;margin:0 0 17px;border-top:1px solid #323c35;border-bottom:1px solid #323c35}}
body.production-mode .trace-card dt{{font-size:12px;font-weight:400;color:#92a296;margin-bottom:5px}}
body.production-mode .trace-card dd{{font-size:15px;font-weight:600;line-height:1.35;color:#e8efe8;margin:0}}
body.production-mode .trace-stage{{align-self:flex-start;border-radius:20px;padding:6px 11px;background:#303b34;color:#c2d1c5;font-size:12px;font-weight:600;line-height:1.4}}
body.production-mode .trace-stage.active{{background:#473c26;color:#f3d59a}}
body.production-mode .trace-stage.finished{{background:#243f34;color:#abdbbe}}
body.production-mode .trace-note-count{{font-size:12px;color:#9eafa3;margin:13px 0 16px;font-weight:400}}
body.production-mode .trace-card-actions{{margin-top:auto;display:grid;grid-template-columns:1fr auto auto;gap:8px;padding-top:4px}}
body.production-mode .trace-card-actions button{{padding:9px 10px;font-size:13px;font-weight:600;border:1px solid #455449;background:transparent;color:#c4d2c6;border-radius:8px;box-shadow:none;min-width:0}}
body.production-mode .trace-card-actions button[data-card-detail]{{background:#d1eb89;color:#202a14;border-color:#d1eb89}}
body.production-mode .trace-card-actions button:hover{{filter:brightness(1.1);border-color:#a0b582}}
body.production-mode .trace-view-bar{{border:1px solid #3e4c40;background:#1a231c;padding:4px;border-radius:10px;gap:3px}}
body.production-mode .trace-view-bar>span{{display:none}}
body.production-mode .trace-view-bar button{{border:0;background:transparent;color:#b5c3b6;border-radius:6px;padding:8px 13px}}
body.production-mode .trace-view-bar button[aria-pressed=true]{{background:#d1eb89;color:#202a14}}
.trace-detail{{border-radius:18px;padding:28px;background:#19211c}}
.trace-detail h2{{font-size:23px;line-height:1.3;margin-bottom:8px}}
.trace-detail dl>div{{padding:12px;background:#222d25;border-radius:8px}}
@media(max-width:620px){{body.production-mode .trace-cards{{grid-template-columns:minmax(0,1fr);padding:12px;gap:14px}}body.production-mode .trace-card-body{{padding:18px}}body.production-mode .trace-media:has(img){{height:190px}}}}
`;document.head.appendChild(tracePolish);
const traceFigmaStyle=document.createElement('style');traceFigmaStyle.textContent=`
body.production-mode .trace-cards{{grid-template-columns:repeat(auto-fill,minmax(500px,1fr));gap:20px;padding:24px;align-items:start;background:#111715;font-family:Arial,sans-serif}}
body.production-mode .trace-card{{display:grid;grid-template-columns:38% minmax(0,1fr);min-height:390px;border-radius:18px;background:#1b211f;border:1px solid #35403a;box-shadow:0 5px 20px #0002}}
body.production-mode .trace-media,body.production-mode .trace-media:not(:has(img)),body.production-mode .trace-media:has(img){{height:100%;min-height:390px;padding:16px;background:#edefea;border:0;color:#58655c}}
.trace-design-view{{display:flex;flex-direction:column;width:100%;height:100%;gap:12px}}.trace-design-main{{display:flex;flex:1;min-height:0;align-items:center;justify-content:center}}body.production-mode .trace-design-main img{{height:310px;width:100%;object-fit:contain}}
.trace-design-tabs{{display:flex;gap:5px;justify-content:center}}body.production-mode .trace-design-tabs button{{width:auto;padding:7px 12px;background:transparent;border:1px solid transparent;border-radius:6px;color:#526052;font:600 12px Arial;box-shadow:none}}body.production-mode .trace-design-tabs button[aria-pressed=true]{{background:#fff;border-color:#cbd3c7;color:#263c29}}.trace-design-tabs button:focus-visible{{outline:2px solid #357bbc}}
.trace-no-design{{display:flex;flex-direction:column;gap:9px;align-items:center;max-width:180px}}.trace-no-design>span{{font-size:45px;font-weight:400;color:#8c998e}}.trace-no-design strong{{font-size:13px}}.trace-no-design small{{font-size:11px;line-height:1.5;color:#7c887f}}
body.production-mode .trace-card-body{{padding:24px;gap:0}}body.production-mode .trace-card-heading{{align-items:center;margin-bottom:14px}}body.production-mode .trace-card h3{{font-size:25px;letter-spacing:-.6px;font-weight:600}}body.production-mode .trace-card-heading>span{{font-size:10px;border:0;padding:0;color:#819187}}
body.production-mode .trace-client{{font-size:16px;font-weight:500;line-height:1.4;margin:0 0 5px;color:#f2f5f0}}body.production-mode .trace-project{{font-size:12px;font-weight:400;color:#9cab9f;margin:0 0 17px}}
body.production-mode .trace-card dl{{padding:0;margin:0 0 18px;border:0;gap:13px 16px}}body.production-mode .trace-card dt{{font-size:11px;font-weight:400;color:#93a398;margin-bottom:5px}}body.production-mode .trace-card dd{{font-size:13px;font-weight:500;color:#e4ebe4;line-height:1.45}}
body.production-mode .trace-stage{{font-size:11px;border-radius:6px;padding:8px 10px;max-width:100%;font-weight:500}}body.production-mode .trace-note-count{{font-size:11px;margin:10px 0 14px}}body.production-mode .trace-card-actions{{padding-top:7px;gap:7px;align-items:center}}body.production-mode .trace-card-actions button{{font-size:12px;padding:9px 8px;font-weight:500}}body.production-mode .trace-card-actions button[data-card-detail]{{background:#d4ec98;color:#20291b}}body.production-mode .trace-card-actions button:not([data-card-detail]){{border-color:transparent}}
@media(max-width:700px){{body.production-mode .trace-cards{{grid-template-columns:minmax(0,1fr);padding:12px}}body.production-mode .trace-card{{grid-template-columns:minmax(0,1fr)}}body.production-mode .trace-media,body.production-mode .trace-media:has(img),body.production-mode .trace-media:not(:has(img)){{height:300px;min-height:0}}body.production-mode .trace-design-main img{{height:235px}}body.production-mode .trace-media:not(:has(img)){{height:120px}}.trace-no-design>span{{display:none}}body.production-mode .trace-card-body{{padding:20px}}}}
`;document.head.appendChild(traceFigmaStyle);setTraceView();
    const commercialGroup=commercialToggle.closest('.nav-group');commercialGroup.classList.add('collapsed');const productionToggle=document.getElementById('production-toggle');if(productionToggle)productionToggle.addEventListener('click',()=>productionToggle.closest('.nav-group').classList.toggle('collapsed'));
    </script><script src='/trace-ui.js?v=20260926-20'></script></body></html>"""


def ordered_mockup_uploads(extras, slots):
    uploads = list(extras)
    for number, image in enumerate(slots, 1):
        if image and image.filename:
            image.filename = f'D{number}_' + Path(image.filename).name
            uploads.append(image)
    return uploads


@app.post("/procesar", status_code=202)
async def upload(
    archivo: UploadFile = File(...),
    observaciones: str = Form(default='', max_length=5000),
    extras: list[UploadFile] = File(default=[]),
    mockup_d1: UploadFile = File(default=None),
    mockup_d2: UploadFile = File(default=None),
    mockup_d3: UploadFile = File(default=None),
    mockup_d4: UploadFile = File(default=None),
    _=Depends(authenticate),
):
    extras = ordered_mockup_uploads(extras, [mockup_d1, mockup_d2, mockup_d3, mockup_d4])
    try:
        await require_mockup_upload(extras)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    extension = Path(archivo.filename or "").suffix.lower()
    if extension not in {".pdf", ".xlsx", ".xlsm"}:
        raise HTTPException(400, "Solo se permiten archivos PDF, XLSX o XLSM")
    safe_name = Path(archivo.filename).name
    stamp = datetime.now().strftime('%Y%m%d%H%M%S%f')
    job_dir = UPLOAD_DIR / "reprogramaciones" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    target = job_dir / safe_name
    content = await archivo.read()
    total = len(content)
    if total > 25 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera 25 MB")
    target.write_bytes(content)
    extra_paths = []
    allowed_images = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".ai", ".eps"}
    valid_extras = [item for item in extras if item.filename]
    for index, item in enumerate(valid_extras):
        name = Path(item.filename).name
        if Path(name).suffix.lower() not in allowed_images:
            raise HTTPException(400, f"El anexo {name} no es una imagen permitida")
        data = await item.read()
        total += len(data)
        if total > 75 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 75 MB")
        extra_target = job_dir / name
        if extra_target.exists():
            extra_target = job_dir / f"{index}_{name}"
        extra_target.write_bytes(data)
        extra_paths.append(extra_target)
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?)",
            (safe_name, "RECIBIDO", "En cola", now, now, "reprogramacion", json.dumps({'observaciones': observaciones.strip()}, ensure_ascii=False)),
        )
        job_id = cursor.lastrowid
    processor = process_job if extension == ".pdf" else process_reprogram_excel_job
    asyncio.create_task(asyncio.to_thread(processor, job_id, target, extra_paths, observaciones.strip(), str(_)))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El documento se está procesando"}


@app.post("/procesar/pedido", status_code=202)
async def upload_order(
    pdf: UploadFile = File(...),
    observaciones: str = Form(default='', max_length=5000),
    excel: UploadFile = File(...),
    extras: list[UploadFile] = File(default=[]),
    mockup_d1: UploadFile = File(default=None),
    mockup_d2: UploadFile = File(default=None),
    mockup_d3: UploadFile = File(default=None),
    mockup_d4: UploadFile = File(default=None),
    _=Depends(authenticate),
):
    extras = ordered_mockup_uploads(extras, [mockup_d1, mockup_d2, mockup_d3, mockup_d4])
    try:
        await require_mockup_upload(extras)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not pdf.filename or Path(pdf.filename).suffix.lower() != ".pdf":
        raise HTTPException(400, "El primer archivo debe ser un PDF")
    if not excel.filename or Path(excel.filename).suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HTTPException(400, "El listado debe ser un archivo .xlsx o .xlsm")
    valid_extras = [item for item in extras if item.filename]
    files = [pdf, excel, *valid_extras]
    contents = []
    total = 0
    for item in files:
        content = await item.read()
        total += len(content)
        if total > 75 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 75 MB")
        contents.append(content)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "pedidos" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    saved = []
    for index, (item, content) in enumerate(zip(files, contents)):
        name = Path(item.filename or f"anexo-{index}").name
        target = job_dir / name
        if target.exists():
            target = job_dir / f"{index}_{name}"
        target.write_bytes(content)
        saved.append(target)
    now = datetime.now(timezone.utc).isoformat()
    display_name = f"{saved[0].name} + {saved[1].name}"
    if valid_extras:
        display_name += f" + {len(valid_extras)} anexo(s)"
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?)",
            (display_name, "RECIBIDO", "En cola", now, now, "pedido", json.dumps({'observaciones': observaciones.strip()}, ensure_ascii=False)),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_order_job, job_id, job_dir, saved[0], saved[1], observaciones.strip(), str(_)))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El pedido se está procesando"}


@app.post("/crear-xlsx/vista-previa")
async def preview_xlsx(
    nombre_archivo: str = Form(...),
    hoja_nombres: list[str] = Form(...),
    datos_hoja: list[UploadFile] = File(...),
    mockups: list[UploadFile] = File(default=[]),
    mockup_slots: list[str] = Form(default=[]),
    _=Depends(authenticate),
):
    """Guarda un borrador y devuelve filas editables antes de crear el Excel."""
    if not datos_hoja or len(datos_hoja) != len(hoja_nombres):
        raise HTTPException(400, "Cada pestaña debe tener su archivo con los datos")
    if len(datos_hoja) > 30 or len(mockups) != len(mockup_slots):
        raise HTTPException(400, "La carga no corresponde con las pestañas seleccionadas")
    output_name = normalize_output_name(nombre_archivo)
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    token = secrets.token_urlsafe(24)
    draft_dir = UPLOAD_DIR / "creator-preview" / token
    draft_dir.mkdir(parents=True, exist_ok=False)
    sheets, total = [], 0
    for index, (name, upload) in enumerate(zip(hoja_nombres, datos_hoja)):
        filename = Path(upload.filename or "").name
        if not filename or Path(filename).suffix.lower() not in allowed:
            raise HTTPException(400, f"El archivo de la pestaña {index + 1} no es compatible")
        content = await upload.read()
        total += len(content)
        path = draft_dir / f"H{index + 1}_DATOS_{filename}"
        path.write_bytes(content)
        extracted = await asyncio.to_thread(_data_from_source, path)
        extracted.pop("OCR", None)
        sheets.append({
            "sheet_name": (name or "").strip(), "data_image": str(path),
            "data_filename": filename, "images": [], "extracted": extracted,
        })
    for slot, upload in zip(mockup_slots, mockups):
        try:
            sheet_index, design = (int(value) for value in slot.split(":", 1))
        except (ValueError, AttributeError):
            raise HTTPException(400, "Posición de mockup inválida")
        filename = Path(upload.filename or "").name
        if not (0 <= sheet_index < len(sheets) and 1 <= design <= 4) or Path(filename).suffix.lower() not in image_allowed:
            raise HTTPException(400, "Uno de los mockups no es compatible")
        content = await upload.read()
        total += len(content)
        if total > 100 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 100 MB")
        path = draft_dir / f"H{sheet_index + 1}_D{design}_{filename}"
        path.write_bytes(content)
        sheets[sheet_index]["images"].append([design, str(path)])
    manifest = {"output_name": output_name, "sheets": sheets}
    (draft_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return {
        "draft_id": token, "workbook_name": output_name,
        "sheets": [{
            "name": sheet["sheet_name"], "filename": sheet["data_filename"],
            "rows": sheet["extracted"].get("FILAS") or [],
            "mockups": [{
                "design": design,
                "url": f"/crear-xlsx/vista-previa/{token}/mockup/{index}/{design}",
            } for design, _path in sorted(sheet["images"], key=lambda item: item[0])],
        } for index, sheet in enumerate(sheets)],
    }


@app.get("/crear-xlsx/vista-previa/{token}/mockup/{sheet_index}/{design}")
async def preview_xlsx_mockup(
    token: str, sheet_index: int, design: int, _=Depends(authenticate),
):
    """Muestra de forma segura un mockup guardado en el borrador de vista previa."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
        raise HTTPException(400, "La vista previa no es válida")
    draft_dir = (UPLOAD_DIR / "creator-preview" / token).resolve()
    preview_root = (UPLOAD_DIR / "creator-preview").resolve()
    if preview_root not in draft_dir.parents:
        raise HTTPException(400, "La vista previa no es válida")
    manifest_path = draft_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, "La vista previa venció")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sheets = manifest.get("sheets") or []
    if not 0 <= sheet_index < len(sheets):
        raise HTTPException(404, "El diseño no existe")
    for saved_design, raw_path in sheets[sheet_index].get("images") or []:
        if int(saved_design) == design:
            image_path = Path(raw_path).resolve()
            if draft_dir not in image_path.parents or not image_path.exists():
                raise HTTPException(404, "El diseño no existe")
            return FileResponse(image_path)
    raise HTTPException(404, "El diseño no existe")


@app.post("/crear-xlsx/confirmar", status_code=202)
async def confirm_xlsx(payload: dict = Body(...), _=Depends(authenticate)):
    token = str(payload.get("draft_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
        raise HTTPException(400, "La vista previa no es válida")
    draft_dir = (UPLOAD_DIR / "creator-preview" / token).resolve()
    preview_root = (UPLOAD_DIR / "creator-preview").resolve()
    if preview_root not in draft_dir.parents:
        raise HTTPException(400, "La vista previa no es válida")
    manifest_path = draft_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, "La vista previa venció; vuelve a cargar los archivos")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    edited = payload.get("sheets") or []
    if len(edited) != len(manifest["sheets"]):
        raise HTTPException(400, "Las pestañas editadas no coinciden con la vista previa")
    sheets = []
    for original, changes in zip(manifest["sheets"], edited):
        rows = changes.get("rows") or []
        if not rows:
            raise HTTPException(400, "Cada pestaña debe conservar al menos una fila")
        extracted = dict(original["extracted"])
        extracted["FILAS"] = rows
        extracted["CANTIDAD"] = str(len(rows))
        sheets.append({
            "sheet_name": str(changes.get("name") or original["sheet_name"]).strip(),
            "data_image": Path(original["data_image"]),
            "images": [(int(design), Path(path)) for design, path in original["images"]],
            "extracted_override": extracted,
        })
    output_name = normalize_output_name(str(payload.get("workbook_name") or manifest["output_name"]))
    now = datetime.now(timezone.utc).isoformat()
    summary = json.dumps({"workbook_name": output_name, "sheets": [{"name": s["sheet_name"]} for s in sheets]}, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", f"{len(sheets)} PESTAÑAS", "RECIBIDO", "Datos confirmados; preparando Excel", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_bundle_job, job_id, sheets, output_name))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "Vista previa confirmada"}


@app.post("/crear-xlsx", status_code=202)
async def create_xlsx(
    datos: UploadFile = File(...),
    nombre_archivo: str = Form(...),
    nombre_hoja: str = Form(default=""),
    d1: UploadFile | None = File(None), d2: UploadFile | None = File(None),
    d3: UploadFile | None = File(None), d4: UploadFile | None = File(None),
    _=Depends(authenticate),
):
    valid = [(design, item) for design, item in enumerate((d1, d2, d3, d4), start=1) if item and item.filename]
    if not datos.filename:
        raise HTTPException(400, "Debes subir el archivo con los datos del listado")
    try:
        output_name = normalize_output_name(nombre_archivo)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "creador-xlsx" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    paths, total = [], 0
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    data_name = Path(datos.filename).name
    if Path(data_name).suffix.lower() not in allowed:
        raise HTTPException(400, "El archivo de datos no tiene un formato compatible")
    data_content = await datos.read()
    total += len(data_content)
    data_path = job_dir / f"DATOS_{data_name}"
    data_path.write_bytes(data_content)
    for design, image in valid:
        name = Path(image.filename).name
        if Path(name).suffix.lower() not in image_allowed:
            raise HTTPException(400, f"{name} no es una imagen compatible")
        content = await image.read()
        total += len(content)
        if total > 40 * 1024 * 1024:
            raise HTTPException(413, "Las imágenes superan 40 MB")
        path = job_dir / f"D{design}_{name}"
        path.write_bytes(content)
        paths.append((design, path))
    now = datetime.now(timezone.utc).isoformat()
    auto_ref = f"IMG-{datetime.now():%Y%m%d-%H%M%S}"
    summary = json.dumps({
        "workbook_name": output_name,
        "sheets": [{
            "name": nombre_hoja,
            "data_filename": data_name,
            "mockups": [{"design": design, "filename": Path(image.filename).name} for design, image in valid],
        }],
    }, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", auto_ref, "RECIBIDO", "En cola para análisis visual", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_job, job_id, data_path, paths, output_name, nombre_hoja))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El asistente está analizando los archivos"}


@app.post("/crear-xlsx-multiple", status_code=202)
async def create_xlsx_multiple(
    nombre_archivo: str = Form(...),
    hoja_nombres: list[str] = Form(...),
    datos_hoja: list[UploadFile] = File(...),
    mockups: list[UploadFile] = File(default=[]),
    mockup_slots: list[str] = Form(default=[]),
    _=Depends(authenticate),
):
    if not datos_hoja or len(datos_hoja) != len(hoja_nombres):
        raise HTTPException(400, "Cada pestaña debe tener su archivo con los datos")
    if len(datos_hoja) > 30:
        raise HTTPException(400, "El máximo es de 30 pestañas por archivo")
    if len(mockups) != len(mockup_slots):
        raise HTTPException(400, "Los mockups recibidos no corresponden a sus pestañas")
    try:
        output_name = normalize_output_name(nombre_archivo)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "creador-xlsx-multiple" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    sheets, total = [], 0
    for index, (name, upload) in enumerate(zip(hoja_nombres, datos_hoja)):
        if not upload.filename or Path(upload.filename).suffix.lower() not in allowed:
            raise HTTPException(400, f"El archivo de datos de la pestaña {index + 1} no es compatible")
        content = await upload.read()
        total += len(content)
        path = job_dir / f"H{index + 1}_DATOS_{Path(upload.filename).name}"
        path.write_bytes(content)
        sheets.append({"sheet_name": (name or "").strip(), "data_image": path, "images": []})
    for slot, upload in zip(mockup_slots, mockups):
        try:
            sheet_index, design = (int(value) for value in slot.split(":", 1))
        except (ValueError, AttributeError):
            raise HTTPException(400, "Posición de mockup inválida")
        if not (0 <= sheet_index < len(sheets) and 1 <= design <= 4):
            raise HTTPException(400, "Posición de mockup fuera de rango")
        if not upload.filename or Path(upload.filename).suffix.lower() not in image_allowed:
            raise HTTPException(400, "Uno de los mockups no es una imagen compatible")
        content = await upload.read()
        total += len(content)
        if total > 100 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de imágenes supera 100 MB")
        path = job_dir / f"H{sheet_index + 1}_D{design}_{Path(upload.filename).name}"
        path.write_bytes(content)
        sheets[sheet_index]["images"].append((design, path))
    now = datetime.now(timezone.utc).isoformat()
    summary_sheets = [{
        "name": sheet["sheet_name"],
        "data_filename": Path(sheet["data_image"]).name.split("_DATOS_", 1)[-1],
        "mockups": [{"design": design, "filename": Path(path).name.split(f"_D{design}_", 1)[-1]} for design, path in sheet["images"]],
    } for sheet in sheets]
    summary = json.dumps({"workbook_name": output_name, "sheets": summary_sheets}, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", f"{len(sheets)} PESTAÑAS", "RECIBIDO", "En cola para análisis visual", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_bundle_job, job_id, sheets, output_name))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": f"Analizando {len(sheets)} pestaña(s)"}


@app.get("/descargar/{job_id}")
def download_xlsx(job_id: int, _=Depends(authenticate)):
    with connect() as db:
        row = db.execute("SELECT result_file FROM jobs WHERE id=? AND kind='creador'", (job_id,)).fetchone()
    if not row or not row["result_file"]:
        raise HTTPException(404, "El archivo todavía no está disponible")
    path = Path(row["result_file"]).resolve()
    allowed_root = (STATE_DIR / "generated").resolve()
    if allowed_root not in path.parents or not path.is_file():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/procesos")
def jobs(_=Depends(authenticate)):
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT 100")]
