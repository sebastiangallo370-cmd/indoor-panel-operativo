"""
Worker local para INDOOR SPORT - PC de la fábrica.

Este script corre en segundo plano en el PC de la fábrica.
Vigila el panel web (nube) y cuando hay órdenes nuevas completadas:
  1. Descarga los archivos (PDF, Excel, imágenes)
  2. Crea la carpeta en el NAS
  3. Copia los archivos al NAS
  4. Confirma al servidor que el NAS está sincronizado

Requisitos:
  - Python 3.10+
  - requests (pip install requests)
  - Acceso al NAS (\\192.168.0.120\nas indoor\CLIENTES)
  - Archivo .env con SERVIDOR_URL, APP_USER, APP_PASSWORD, NAS_CLIENTES_PATH
"""

import os
import sys
import time
import json
import shutil
import logging
import re
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
except ImportError:
    pass
else:
    load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

try:
    import requests
except ImportError:
    print("[ERROR] Falta la libreria requests. Ejecuta: pip install requests")
    sys.exit(1)

# --- Configuración ---
SERVIDOR_URL = os.getenv("SERVIDOR_URL", "").rstrip("/")
APP_USER = os.getenv("APP_USER", "indoor")
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
NAS_PATH = os.getenv("NAS_CLIENTES_PATH", r"\\192.168.0.120\nas indoor\CLIENTES")
INTERVALO = int(os.getenv("WORKER_INTERVALO", "30"))
WORKER_DIR = Path(__file__).resolve().parent / "data" / "worker"
DESCARGAS_DIR = WORKER_DIR / "descargas"
SYNC_FILE = WORKER_DIR / "synced_jobs.json"

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, handlers=[
    logging.StreamHandler(),
    logging.FileHandler(WORKER_DIR / "worker.log", encoding="utf-8") if WORKER_DIR.exists() or not WORKER_DIR.mkdir(parents=True, exist_ok=True) else logging.StreamHandler(),
])
log = logging.getLogger("worker")


def sanitize(name):
    name = re.sub(r'[<>:"/\\|?*]', '_', str(name).strip())
    return re.sub(r'_+', '_', name).strip('_. ') or "SIN_NOMBRE"


class IndoorWorker:
    def __init__(self):
        self.session = requests.Session()
        self.session.verify = True
        self.logged_in = False
        self.synced = self._load_synced()

        WORKER_DIR.mkdir(parents=True, exist_ok=True)
        DESCARGAS_DIR.mkdir(parents=True, exist_ok=True)

        if not SERVIDOR_URL:
            log.error("SERVIDOR_URL no configurado en .env")
            log.error("Ejemplo: SERVIDOR_URL=https://tu-dominio.ngrok-free.app")
            sys.exit(1)
        if not APP_PASSWORD:
            log.error("APP_PASSWORD no configurado en .env")
            sys.exit(1)

    def _load_synced(self):
        if SYNC_FILE.exists():
            try:
                return set(json.loads(SYNC_FILE.read_text(encoding="utf-8")))
            except Exception:
                pass
        return set()

    def _save_synced(self):
        SYNC_FILE.write_text(json.dumps(sorted(self.synced)), encoding="utf-8")

    def login(self):
        try:
            resp = self.session.post(
                f"{SERVIDOR_URL}/login",
                data={"username": APP_USER, "password": APP_PASSWORD},
                allow_redirects=False,
                timeout=15,
            )
            if resp.status_code in (302, 303) and "indoor_session" in resp.cookies:
                self.logged_in = True
                log.info("Sesión iniciada en el servidor")
                return True
            if resp.status_code in (302, 303):
                for cookie in resp.cookies:
                    if "session" in cookie.name.lower():
                        self.logged_in = True
                        log.info("Sesión iniciada en el servidor")
                        return True
            log.error("Login fallido (status %s)", resp.status_code)
            return False
        except requests.RequestException as e:
            log.error("No se pudo conectar al servidor: %s", e)
            return False

    def api_get(self, path):
        try:
            resp = self.session.get(f"{SERVIDOR_URL}{path}", timeout=30)
            if resp.status_code == 401 or resp.status_code == 307:
                log.info("Sesión expirada, reintentando login...")
                if self.login():
                    resp = self.session.get(f"{SERVIDOR_URL}{path}", timeout=30)
            if resp.status_code == 200:
                return resp.json()
            log.warning("GET %s -> %s", path, resp.status_code)
        except requests.RequestException as e:
            log.error("Error en GET %s: %s", path, e)
        return None

    def api_post(self, path, data=None):
        try:
            resp = self.session.post(f"{SERVIDOR_URL}{path}", json=data, timeout=30)
            if resp.status_code == 401 or resp.status_code == 307:
                if self.login():
                    resp = self.session.post(f"{SERVIDOR_URL}{path}", json=data, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            log.warning("POST %s -> %s", path, resp.status_code)
        except requests.RequestException as e:
            log.error("Error en POST %s: %s", path, e)
        return None

    def descargar_archivo(self, job_id, filename):
        try:
            resp = self.session.get(
                f"{SERVIDOR_URL}/api/worker/descargar/{job_id}/{filename}",
                timeout=60, stream=True,
            )
            if resp.status_code == 401 or resp.status_code == 307:
                if self.login():
                    resp = self.session.get(
                        f"{SERVIDOR_URL}/api/worker/descargar/{job_id}/{filename}",
                        timeout=60, stream=True,
                    )
            if resp.status_code == 200:
                dest = DESCARGAS_DIR / f"{job_id}" / filename
                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "wb") as f:
                    for chunk in resp.iter_content(8192):
                        f.write(chunk)
                log.info("  Descargado: %s (%s bytes)", filename, dest.stat().st_size)
                return dest
            log.warning("  No se pudo descargar %s (status %s)", filename, resp.status_code)
        except requests.RequestException as e:
            log.error("  Error descargando %s: %s", filename, e)
        return None

    def crear_carpeta_nas(self, client, order, project):
        nas_root = Path(NAS_PATH)
        if not nas_root.exists():
            log.error("NAS no disponible en %s", NAS_PATH)
            return None
        client_safe = sanitize(client)
        project_safe = sanitize(project) if project else "ORDEN"
        order_dir = nas_root / client_safe / f"{order}_{project_safe}"
        try:
            order_dir.mkdir(parents=True, exist_ok=True)
            subdirs = [
                "APLIQUE (BORDADO,VINILOS,TRANSFER)",
                "CORTE PLT",
                "IMPRESION (NOMBRE MAQUINA)",
            ]
            for sub in subdirs:
                (order_dir / sub).mkdir(exist_ok=True)
            maestros_dir = nas_root / client_safe / "MAESTROS"
            maestros_dir.mkdir(exist_ok=True)
            log.info("  NAS carpeta lista: %s", order_dir)
            return order_dir
        except OSError as e:
            log.error("  Error creando carpeta NAS: %s", e)
            return None

    def copiar_a_nas(self, archivos_locales, order_dir):
        copiados = 0
        for archivo in archivos_locales:
            if archivo and archivo.exists():
                try:
                    shutil.copy2(str(archivo), str(order_dir / archivo.name))
                    copiados += 1
                    log.info("  Copiado al NAS: %s", archivo.name)
                except OSError as e:
                    log.error("  Error copiando %s al NAS: %s", archivo.name, e)
        return copiados

    def procesar_pendientes(self):
        pendientes = self.api_get("/api/worker/pendientes")
        if pendientes is None:
            return
        if not pendientes:
            return

        log.info("--- %d orden(es) pendiente(s) de sincronizar ---", len(pendientes))

        produccion = self.api_get("/api/worker/produccion-resumen")
        prod_by_order = {}
        if produccion and produccion.get("rows"):
            for row in produccion["rows"]:
                order = str(row.get("order", "")).strip()
                if order and order not in prod_by_order:
                    prod_by_order[order] = row

        for job in pendientes:
            job_id = job["id"]
            order_num = job.get("order_number", "")

            if job_id in self.synced:
                self.api_post(f"/api/worker/confirmar/{job_id}")
                continue

            log.info("Procesando job #%s - orden %s (%s)", job_id, order_num, job.get("kind", ""))

            prod_info = prod_by_order.get(order_num, {})
            client = prod_info.get("client", "")
            project = prod_info.get("project", "")

            if not client:
                log.warning("  Sin datos de cliente para orden %s, saltando NAS", order_num)
                self.synced.add(job_id)
                self._save_synced()
                self.api_post(f"/api/worker/confirmar/{job_id}")
                continue

            archivos_info = self.api_get(f"/api/worker/archivos/{job_id}")
            archivos_descargados = []
            if archivos_info and archivos_info.get("files"):
                for f_info in archivos_info["files"]:
                    if f_info.get("source") == "nas":
                        continue
                    archivo = self.descargar_archivo(job_id, f_info["name"])
                    if archivo:
                        archivos_descargados.append(archivo)

            order_dir = self.crear_carpeta_nas(client, order_num, project)
            if order_dir and archivos_descargados:
                copiados = self.copiar_a_nas(archivos_descargados, order_dir)
                log.info("  %d archivo(s) copiado(s) al NAS", copiados)

            self.synced.add(job_id)
            self._save_synced()
            self.api_post(f"/api/worker/confirmar/{job_id}")
            log.info("  Job #%s sincronizado OK", job_id)

            for archivo in archivos_descargados:
                try:
                    archivo.unlink()
                except OSError:
                    pass

    def run(self):
        log.info("=" * 60)
        log.info("  WORKER LOCAL - Indoor Sport")
        log.info("  Servidor: %s", SERVIDOR_URL)
        log.info("  NAS: %s", NAS_PATH)
        log.info("  Intervalo: %ds", INTERVALO)
        log.info("=" * 60)

        if not self.login():
            log.error("No se pudo iniciar sesion. Verificar credenciales.")
            log.info("Reintentando en 60 segundos...")
            time.sleep(60)
            if not self.login():
                log.error("Segundo intento fallido. Saliendo.")
                sys.exit(1)

        log.info("Worker activo. Vigilando ordenes pendientes...")
        errores_consecutivos = 0

        while True:
            try:
                self.procesar_pendientes()
                errores_consecutivos = 0
            except KeyboardInterrupt:
                log.info("Worker detenido por el usuario.")
                break
            except Exception as e:
                errores_consecutivos += 1
                log.exception("Error inesperado (intento %d): %s", errores_consecutivos, e)
                if errores_consecutivos >= 5:
                    log.info("Demasiados errores. Reintentando login...")
                    self.login()
                    errores_consecutivos = 0

            try:
                time.sleep(INTERVALO)
            except KeyboardInterrupt:
                log.info("Worker detenido por el usuario.")
                break


if __name__ == "__main__":
    worker = IndoorWorker()
    worker.run()
