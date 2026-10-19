"""Copias de seguridad automáticas de la base de datos, guardadas en el propio VPS (sin Supabase).

Cada cierto tiempo se toma una foto consistente de jobs.sqlite3 (con el respaldo en línea que ya trae sqlite3, sin bloquear la app) y se
guarda en /data/state/db-backups. Se conservan solo las últimas copias para no llenar el disco. Además, respaldo.py hace cada día un
.tar.gz de /data (que incluye la base y los catálogos) y lo copia a la NAS.
"""
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone

CARPETA = "db-backups"
KEEP_LAST = 8
INTERVAL_SEGUNDOS = 6 * 60 * 60  # cada 6 horas

status = {"last_ok_at": None, "last_error": None, "last_name": None}


def _snapshot(db_path, destino, stamp):
    """Copia consistente de la base, aunque la app esté escribiendo en ese momento."""
    destino.mkdir(parents=True, exist_ok=True)
    ruta = destino / f"jobs-{stamp}.sqlite3"
    origen = sqlite3.connect(db_path)
    try:
        copia = sqlite3.connect(ruta)
        try:
            origen.backup(copia)
        finally:
            copia.close()
    finally:
        origen.close()
    return ruta


def _prune(destino, keep_last):
    nombres = sorted(p for p in destino.glob("jobs-*.sqlite3"))
    for viejo in nombres[:-keep_last]:
        try:
            viejo.unlink()
        except OSError as error:
            logging.warning("db_backup: no se pudo borrar la copia vieja %s: %s", viejo.name, error)


def run_once(db_path, state_dir, *_ignorado):
    destino = state_dir / CARPETA
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    try:
        ruta = _snapshot(db_path, destino, stamp)
        logging.info("db_backup: copia de seguridad guardada (%s)", ruta.name)
        status["last_ok_at"] = datetime.now(timezone.utc).isoformat()
        status["last_error"] = None
        status["last_name"] = ruta.name
        _prune(destino, KEEP_LAST)
    except Exception as error:
        status["last_error"] = str(error)[:300]
        raise


def start(db_path, state_dir, *_ignorado):
    """Arranca el respaldo periódico en un hilo de fondo."""
    def worker():
        # Una primera copia poco después de arrancar, y luego cada INTERVAL_SEGUNDOS.
        time.sleep(120)
        while True:
            try:
                run_once(db_path, state_dir)
            except Exception:
                logging.exception("db_backup: falló la copia de seguridad automática")
            time.sleep(INTERVAL_SEGUNDOS)
    threading.Thread(target=worker, name="db-backup", daemon=True).start()
