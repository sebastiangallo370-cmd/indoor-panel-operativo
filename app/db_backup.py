"""Copias de seguridad automaticas de la base de datos hacia Supabase Storage.

Cada cierto tiempo se toma una foto consistente de jobs.sqlite3 (usando el respaldo
en linea que ya trae sqlite3, sin bloquear la app) y se sube al bucket 'db-backups'
del mismo proyecto de Supabase que ya usa la app para clientes/referencias. Se
conservan solo las ultimas copias para no llenar el almacenamiento; todo lo demas
sigue viviendo en la base real, esto es solo la red de seguridad por si el disco
falla o alguien borra algo por error.
"""
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone

BUCKET = "db-backups"
KEEP_LAST = 30
INTERVAL_SEGUNDOS = 6 * 60 * 60  # cada 6 horas

status = {"last_ok_at": None, "last_error": None, "last_name": None}


def _ensure_bucket(supabase):
    try:
        buckets = {b.name if hasattr(b, "name") else b["name"] for b in supabase.storage.list_buckets()}
    except Exception:
        buckets = set()
    if BUCKET not in buckets:
        try:
            supabase.storage.create_bucket(BUCKET, options={"public": False})
        except Exception as error:
            # Puede que ya exista o que la llave no tenga permiso de crear buckets;
            # en ese caso solo se intenta subir igual, y si falla se registra abajo.
            logging.info("db_backup: no se pudo confirmar/crear el bucket (%s), se intenta subir igual", error)


def _snapshot(db_path, state_dir):
    """Copia consistente de la base, aunque la app este escribiendo en ese momento."""
    tmp_dir = state_dir / "backup-tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    tmp_path = tmp_dir / f"jobs-{stamp}.sqlite3"
    source = sqlite3.connect(db_path)
    try:
        destination = sqlite3.connect(tmp_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    return tmp_path, stamp


def _prune(supabase, keep_last):
    try:
        files = supabase.storage.from_(BUCKET).list()
    except Exception as error:
        logging.warning("db_backup: no se pudo listar backups anteriores: %s", error)
        return
    names = sorted(f["name"] for f in files if f.get("name", "").startswith("jobs-"))
    stale = names[:-keep_last] if len(names) > keep_last else []
    if stale:
        try:
            supabase.storage.from_(BUCKET).remove(stale)
        except Exception as error:
            logging.warning("db_backup: no se pudieron borrar backups viejos: %s", error)


def run_once(db_path, state_dir, supabase_provider):
    supabase = supabase_provider()
    _ensure_bucket(supabase)
    tmp_path, stamp = _snapshot(db_path, state_dir)
    try:
        with open(tmp_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                f"jobs-{stamp}.sqlite3", f, file_options={"content-type": "application/octet-stream"}
            )
        logging.info("db_backup: copia de seguridad subida (jobs-%s.sqlite3)", stamp)
        status["last_ok_at"] = datetime.now(timezone.utc).isoformat()
        status["last_error"] = None
        status["last_name"] = f"jobs-{stamp}.sqlite3"
        _prune(supabase, KEEP_LAST)
    except Exception as error:
        status["last_error"] = str(error)[:300]
        raise
    finally:
        tmp_path.unlink(missing_ok=True)


def start(db_path, state_dir, supabase_provider):
    """Arranca el respaldo periodico en un hilo de fondo. No hace nada si Supabase
    no esta configurado (por ejemplo, en desarrollo local sin esas variables)."""
    def worker():
        # Una primera copia poco despues de arrancar, y luego cada INTERVAL_SEGUNDOS.
        time.sleep(120)
        while True:
            try:
                run_once(db_path, state_dir, supabase_provider)
            except Exception:
                logging.exception("db_backup: fallo la copia de seguridad automatica")
            time.sleep(INTERVAL_SEGUNDOS)
    threading.Thread(target=worker, name="db-backup", daemon=True).start()
