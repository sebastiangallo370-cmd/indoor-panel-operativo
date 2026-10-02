"""Respaldo diario de toda la informacion de /data (no solo la base) con rotacion.

Cada respaldo es un .tar.gz con: la base jobs.sqlite3 (copia consistente), los JSON de
inventario/cartera/configuracion y las carpetas de documentos. No incluye cachés
regenerables (excel_mockup_cache) ni los respaldos anteriores. Se puede descargar desde
la pagina para tener una copia fuera del servidor.
"""
import json
import logging
import shutil
import sqlite3
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

KEEP_LAST = 14
INTERVAL_SEGUNDOS = 24 * 60 * 60
MIN_FREE_BYTES = 1_500_000_000
SKIP_NAMES = {'excel_mockup_cache.sqlite3', 'backup-tmp', 'backups', 'jobs.sqlite3', 'jobs.sqlite3-wal',
              'jobs.sqlite3-shm', 'generated', 'asistente.log'}
status = {'last_ok_at': None, 'last_error': None, 'last_name': None, 'last_size': 0}
_lock = threading.Lock()


def backups_dir(data_dir: Path) -> Path:
    return Path(data_dir) / 'backups'


def _status_file(data_dir: Path) -> Path:
    return backups_dir(data_dir) / 'estado.json'


def load_status(data_dir: Path) -> dict:
    try:
        status.update(json.loads(_status_file(data_dir).read_text(encoding='utf-8')))
    except Exception:
        pass
    return status


def listing(data_dir: Path) -> list[dict]:
    folder = backups_dir(data_dir)
    if not folder.is_dir():
        return []
    return [{'name': p.name, 'size': p.stat().st_size, 'at': datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat()}
            for p in sorted(folder.glob('respaldo-*.tar.gz'), reverse=True)]


def _save(data_dir: Path):
    try:
        _status_file(data_dir).write_text(json.dumps(status), encoding='utf-8')
    except Exception:
        pass


def run_once(data_dir: Path, db_path: Path) -> str:
    data_dir = Path(data_dir)
    with _lock:
        folder = backups_dir(data_dir)
        folder.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(folder).free < MIN_FREE_BYTES:
            status['last_error'] = 'Poco espacio libre en el servidor: no se hizo el respaldo'
            _save(data_dir)
            raise RuntimeError(status['last_error'])
        stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        final = folder / f'respaldo-{stamp}.tar.gz'
        partial = folder / f'.respaldo-{stamp}.tar.gz.partial'
        try:
            with tempfile.TemporaryDirectory(dir=folder) as tmp:
                snap = Path(tmp) / 'jobs.sqlite3'
                source = sqlite3.connect(db_path)
                try:
                    dest = sqlite3.connect(snap)
                    try:
                        source.backup(dest)
                    finally:
                        dest.close()
                finally:
                    source.close()
                check = sqlite3.connect(snap)
                try:
                    if check.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise RuntimeError('La copia de la base no paso la verificacion')
                finally:
                    check.close()
                with tarfile.open(partial, 'w:gz') as tar:
                    tar.add(snap, arcname='state/jobs.sqlite3')
                    for item in sorted(data_dir.iterdir()):
                        if item.name in SKIP_NAMES:
                            continue
                        if item.name == 'state':
                            for sub in sorted(item.iterdir()):
                                if sub.name in SKIP_NAMES or sub.name.startswith('before-'):
                                    continue
                                tar.add(sub, arcname=f'state/{sub.name}')
                        else:
                            tar.add(item, arcname=item.name)
            with tarfile.open(partial) as tar:  # se comprueba que el archivo se pueda leer completo
                if not tar.getnames():
                    raise RuntimeError('Respaldo vacio')
            partial.rename(final)
        except Exception as error:
            partial.unlink(missing_ok=True)
            status['last_error'] = str(error)[:300]
            _save(data_dir)
            raise
        status.update(last_ok_at=datetime.now(timezone.utc).isoformat(), last_error=None, last_name=final.name,
                      last_size=final.stat().st_size)
        for old in sorted(folder.glob('respaldo-*.tar.gz'))[:-KEEP_LAST]:
            old.unlink(missing_ok=True)
        _save(data_dir)
        logging.info('respaldo: %s (%d bytes)', final.name, final.stat().st_size)
        return final.name


def start(data_dir: Path, db_path: Path):
    load_status(data_dir)

    def worker():
        time.sleep(180)
        while True:
            try:
                last = status.get('last_ok_at')
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds() if last else 1e9
                if age >= INTERVAL_SEGUNDOS - 600:
                    run_once(data_dir, db_path)
            except Exception:
                logging.exception('respaldo: fallo el respaldo diario')
            time.sleep(1800)
    threading.Thread(target=worker, name='respaldo-diario', daemon=True).start()
