import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path("/data")
UPLOAD_DIR = DATA_DIR / "uploads"
STATE_DIR = DATA_DIR / "state"


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Falta la variable obligatoria {name}")
    return value


def legacy_config() -> dict:
    return {
        "carpeta_monitoreo": str(UPLOAD_DIR),
        "ruta_nas_clientes": required("NAS_CLIENTES_PATH"),
        "extensiones_permitidas": [".pdf"],
        "log_file": str(STATE_DIR / "asistente.log"),
        "supabase_url": required("SUPABASE_URL"),
        "supabase_key": required("SUPABASE_KEY"),
        "google_sheets_url": required("GOOGLE_SHEETS_URL"),
        "google_sheets_gid": int(os.getenv("GOOGLE_SHEETS_GID", "0")),
        "pagos_cotizaciones_file_id": required("PAGOS_COTIZACIONES_FILE_ID"),
        "pagos_cotizaciones_hoja": required("PAGOS_COTIZACIONES_HOJA"),
        "google_credentials": required("GOOGLE_CREDENTIALS"),
        "smtp_email": required("SMTP_EMAIL"),
        "smtp_password": required("SMTP_PASSWORD"),
        "smtp_server": os.getenv("SMTP_SERVER", "smtp.gmail.com"),
        "smtp_port": int(os.getenv("SMTP_PORT", "587")),
    }


def prepare_runtime() -> dict:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    cfg = legacy_config()
    (BASE_DIR / "config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return cfg


def prepare_pedidos_runtime() -> dict:
    """Configuracion Linux del Programador Automatico (pedidos normales)."""
    cfg = legacy_config()
    cfg.update({
        "carpeta_monitoreo": str(UPLOAD_DIR / "pedidos"),
        "extensiones_permitidas": [".pdf", ".xlsx", ".xlsm"],
        "prefijo_orden": "ORDEN_",
        "log_file": str(STATE_DIR / "pedidos.log"),
        "google_sheets_gid": int(os.getenv("PEDIDOS_GOOGLE_SHEETS_GID", "1514880696")),
        "pareja_timeout_min": 45,
    })
    Path(cfg["carpeta_monitoreo"]).mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / "pedidos_config.json"
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg
