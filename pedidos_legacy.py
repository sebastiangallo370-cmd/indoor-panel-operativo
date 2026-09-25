"""
ASISTENTE DE TRAZABILIDAD INDOOR  -  monitor_archivos.py
=======================================================

Vigila una carpeta de la NAS. Cuando cae la pareja Excel de pedido + su PDF
(cotizacion/remision) con el mismo numero CO####/RM####, procesa la orden:
  - el EXCEL ("listado") hace TODO: crea la estructura de carpetas del cliente,
    copia ahi los archivos, sube a Supabase y ESCRIBE LAS FILAS DE LA HOJA DE
    PRODUCCION (una por referencia);
  - el PDF SOLO registra la fila en CONTROL DE PAGOS COTIZACIONES, y unicamente
    si es una COTIZACION (un PDF de REMISION no escribe en ninguna hoja).


LECCIONES APRENDIDAS  (por que el codigo esta armado asi - NO revertir)
----------------------------------------------------------------------
1. La carpeta vigilada vive en una ruta de RED (UNC \\\\192.168.0.120\\...).
   watchdog.Observer (ReadDirectoryChangesW) NO recibe eventos sobre SMB, asi
   que los archivos soltados nunca se detectaban aunque el proceso siguiera vivo.
   -> Se usa SIEMPRE PollingObserver.  validar_entorno() aborta el arranque si
      algun dia el import vuelve a quedar en el Observer nativo.

2. Corriendo desde UNC, Python no escribe de forma fiable al lado del script.
   Todo lo volatil (log, pid, estado de salud) va a  %TEMP%  -> ver PID_DIR.
   El  asistente.log  de la carpeta del proyecto queda CONGELADO; el log real
   es  %TEMP%\\asistente.log , y main() lo imprime en la primera linea.

3. El proceso puede quedar VIVO PERO CIEGO (observer colgado) o morir sin dejar
   rastro en el log. Por eso hay tres redes de seguridad:
     - LATIDO:  %TEMP%\\monitor_health.json  se reescribe cada LOOP_SEG con el
       estado (pid, contadores, observers vivos, resultado del autotest).
     - AUTOTEST activo: cada SELFTEST_SEG se deja caer un archivo señuelo en la
       carpeta vigilada; si el observer no lo "ve" en SELFTEST_TIMEOUT s, el
       proceso se cierra con exit(1) para que la tarea VIGIA lo relance.
     - vigilar_asistente.vbs (tarea programada cada 5 min) revisa la frescura y
       las banderas de monitor_health.json, no solo si el PID existe.

4. Nunca deben quedar 2 instancias -> guarda de instancia unica en
   registrar_pid_unico(), que verifica la LINEA DE COMANDOS del PID previo
   (no solo el numero, que Windows recicla).

5. Reparto Excel/PDF (2026-09-06): la HOJA DE PRODUCCION se llena desde el EXCEL
   del pedido, NO desde el PDF. El PDF solo alimenta CONTROL DE PAGOS
   COTIZACIONES (y solo si es COTIZACION; una REMISION no toca ninguna hoja).
   Antes las filas de produccion salian de parsear los items del PDF; se cambio
   a peticion del negocio. Ver procesar_orden(): NO revertir a
   `datos_lista = datos_pdf`.

6. VIVO PERO SIN PROCESAR (2026-09-14): el latido lo escribe el hilo principal,
   asi que si el WORKER se colgaba (gspread sin timeout, NAS sin responder) el
   health seguia "sano" y VIGIA nunca relanzaba -> habia que reiniciar a mano.
   Ahora bucle_principal() vigila procesando_desde / worker_latido y sale con
   exit(1) pasados MAX_PROCESO_SEG. Ademas: timeout en gspread y SMTP, y
   on_moved (un archivo RENOMBRADO en la carpeta no se detectaba).

7. SE CORRE CON pythonw.exe, NO python.exe (2026-09-14): Windows cerraba el
   monitor por "no responder" (eventos AppHang 1002 del 3/09, 4/09 y 8/09 con
   el PID exacto del monitor): la consola oculta de python.exe cuenta como
   ventana. pythonw no tiene consola -> nada que declarar colgado. Por eso los
   subprocess llevan CREATE_NO_WINDOW (si no, abririan ventanas negras) y el
   log no escribe a stdout si no existe. Rastro de cierres: monitor_fatal.log.

8. UNIDADES = "TOTAL UNIFORMES" DEL EXCEL (2026-09-21): la columna CANTIDAD de la
   hoja de produccion sale de la celda "TOTAL UNIFORMES" de cada hoja de
   referencia del Excel (extraer_items_excel), NO de contar filas: no siempre
   coinciden (CO6072: 499 filas vs 466 en el Excel). Solo si esa celda no existe
   o no trae valor se cae al conteo de filas.

9. ARCHIVOS EXTRA (2026-09-21): todo archivo que caiga en la carpeta vigilada y no
   sea el Excel/PDF del pedido (imagenes, etc.; ver es_archivo_extra) se COPIA a
   la carpeta de la orden (procesar_orden paso 5b) y se borra del origen. Un
   extra con el numero de otra orden en el nombre (RM7604_logo.png) espera a esa
   orden. Uno que llega justo despues de terminar una orden se le asigna si
   pasaron >= EXTRAS_ASENTAMIENTO_SEG y <= EXTRAS_GRACIA_TARDIO_SEG
   (_despachar_extras). config["extensiones_permitidas"] sigue siendo SOLO la
   lista de tipos que forman pareja; los extras son "todo lo demas".


MAPA DEL ARCHIVO
----------------
  - Configuracion y constantes
  - Salud del proceso        (latido, autotest, estado global _estado)
  - Utilidades varias        (fechas, sanitize, reintentos)
  - Conexiones externas      (Supabase, Google Sheets, DNS)
  - Correos de alerta al comercial
  - Extraccion de datos: Excel
  - Extraccion de datos: PDF
  - Generacion del Excel de produccion
  - Procesamiento y movimiento de archivos
  - Handlers de watchdog
  - Arranque (validacion de entorno, instancia unica, bucle principal)
"""

# ======================================================================
#  CONFIGURACION Y CONSTANTES
# ======================================================================
import os
import sys
import time
import json
import shutil
import logging
import re
import socket
from datetime import datetime, timedelta
from pathlib import Path

import glob
import io
import queue
import threading
import subprocess
import smtplib
from email.mime.text import MIMEText
import openpyxl
import pdfplumber
import gspread
from google.oauth2.service_account import Credentials
from supabase import create_client
# PollingObserver en vez de Observer: la carpeta monitoreada vive en la NAS
# (ruta UNC \\192.168.0.120\...). watchdog.Observer usa ReadDirectoryChangesW,
# que NO recibe notificaciones sobre recursos de red/SMB, asi que los archivos
# soltados nunca se detectaban. PollingObserver lista la carpeta cada
# POLL_INTERVAL segundos y compara: funciona igual sobre red.
# OJO: si esto vuelve a quedar como `from watchdog.observers import Observer`,
# validar_entorno() aborta el arranque cuando se corre desde UNC.
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

_IS_UNC = str(BASE_DIR).startswith("\\\\")
_LOCAL_WORK = Path(os.environ.get("TEMP", os.environ.get("TMP", str(Path.home()))))
PID_DIR = _LOCAL_WORK if _IS_UNC else BASE_DIR

# --- Intervalos y salud ----------------------------------------------------
POLL_INTERVAL      = 5      # segundos entre barridos del PollingObserver
LOOP_SEG           = 1      # periodo del bucle principal
REINTENTO_ALERTAS  = 180    # loops entre reintentos de correos encolados
SELFTEST_SEG       = 300    # cada cuanto se corre el autotest de deteccion
SELFTEST_TIMEOUT   = 30     # margen para que el observer "vea" el señuelo
MAX_PROCESO_SEG    = 600    # una orden tarda <=2 min (max visto: 124 s); mas = worker colgado
MAX_WORKER_SEG     = 600    # libre, el worker marca latido cada <=5 s
TIMEOUT_RED_SEG    = 60     # tope por peticion a Google Sheets / SMTP
# Corriendo con pythonw.exe (sin consola) cada subprocess de consola abriria una
# ventana negra visible: CREATE_NO_WINDOW lo evita.
_SIN_VENTANA = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
HEARTBEAT_PATH     = PID_DIR / "monitor_health.json"
PID_PATH           = PID_DIR / "monitor.pid"
PARES_PENDIENTES_PATH = PID_DIR / "pares_pendientes.json"  # ordenes con solo el PDF o solo el Excel
ORDENES_PROCESADAS_PATH = PID_DIR / "ordenes_procesadas.json"  # anti-duplicado tras archivar
PAREJA_TIMEOUT_MIN_DEFAULT = 45   # aviso al comercial si una orden queda sin su pareja
DIAS_MEMORIA_PROCESADAS = 21      # cuanto se recuerda una orden ya procesada
DNS_HOSTS = [
    "oolxeihvydqnszmnthzs.supabase.co",
    "sheets.googleapis.com",
    "www.googleapis.com",
]
PREFIJOS_TEMP = (".__selftest__", ".__wtest__")  # archivos internos, nunca se procesan
# Archivos "extra" (imagenes, etc. = todo lo que no sea el Excel/PDF del pedido):
EXTRAS_ASENTAMIENTO_SEG = 20    # un extra suelto debe llevar >= esto en la carpeta antes de repartirlo
EXTRAS_GRACIA_TARDIO_SEG = 300  # ventana tras terminar una orden en la que un extra tardio se le asigna
EXTRAS_IGNORAR_NOMBRES = {"thumbs.db", "desktop.ini", ".ds_store"}
EXTRAS_IGNORAR_EXT = {".tmp", ".crdownload", ".part", ".partial"}
ORDEN_EN_NOMBRE_RE = re.compile(r"(?<![A-Z0-9])(CO|RM)[ _-]?(\d{4,5})(?!\d)")


class ErrorTecnico(Exception):
    """Fallo transitorio o de infraestructura: el archivo todavia se esta copiando
    por SMB, la NAS no responde, Supabase/Sheets caidos, un PDF ilegible por un
    instante, etc. NO es culpa de la orden.

    Ante un ErrorTecnico el asistente NO envia correo al comercial y NO deja el
    archivo rechazado: lo REINTENTA mas tarde. Solo las reglas de negocio
    incumplidas (falta genero/diseno/cliente/proyecto/items) generan rechazo y
    correo de correccion.
    """


_supabase = None
_gspread = None

def get_supabase():
    global _supabase
    if _supabase is None:
        config = load_config()
        _supabase = create_client(config["supabase_url"], config["supabase_key"])
    return _supabase

def get_gspread():
    global _gspread
    if _gspread is None:
        config = load_config()
        scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
        creds = Credentials.from_service_account_file(
            str(BASE_DIR / config["google_credentials"]), scopes=scopes
        )
        gc = gspread.authorize(creds)
        # Sin esto gspread espera a Google PARA SIEMPRE: si la red se corta a mitad
        # de una escritura, el worker queda colgado y el health sigue "sano".
        gc.set_timeout(TIMEOUT_RED_SEG)
        sh = gc.open_by_url(config["google_sheets_url"])
        _gspread = sh.get_worksheet_by_id(config["google_sheets_gid"])
    return _gspread

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8-sig") as f:
        return json.load(f)

def setup_logging(log_file):
    root = logging.getLogger()
    # Si la instancia anterior (o un reinicio en caliente) ya dejo handlers,
    # limpiarlos evita el log duplicado que se vio el 2026-09-01.
    for h in list(root.handlers):
        root.removeHandler(h)
    handlers = [logging.FileHandler(log_file, encoding="utf-8")]
    if sys.stdout is not None:   # con pythonw.exe no hay consola y sys.stdout es None
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )


# ======================================================================
#  SALUD DEL PROCESO  (latido + autotest de deteccion)
# ======================================================================
#
# _estado es el unico estado global mutable del proceso. Lo leen escribir_latido()
# y el autotest; lo escriben los handlers y el bucle principal. monitor_health.json
# es la proyeccion en disco que consume vigilar_asistente.vbs.

_estado = {
    "arranque": None,
    "procesados_ok": 0,
    "procesados_error": 0,
    "ultimo_archivo": None,
    "ultimo_evento_fs": 0.0,   # timestamp del ultimo evento de watchdog (lo pone HandlerArchivos.dispatch)
    "deteccion_ok": True,      # False = observer ciego / entorno invalido -> VIGIA debe relanzar
    "ultimo_selftest": None,
    "procesando_desde": 0.0,   # epoch de inicio del archivo en proceso (0 = ninguno)
    "worker_latido": 0.0,      # epoch del ultimo ciclo del hilo de procesamiento
}

def escribir_latido(observer=None, observer_clientes=None):
    """Reescribe monitor_health.json. Su MTIME es la señal de 'sigo vivo';
    las banderas dicen si ademas sigo *funcionando*."""
    try:
        datos = dict(_estado)
        datos["pid"] = os.getpid()
        datos["timestamp"] = datetime.now().isoformat(timespec="seconds")
        datos["observer_vivo"] = bool(observer and observer.is_alive())
        datos["observer_clientes_vivo"] = bool(observer_clientes and observer_clientes.is_alive())
        tmp = str(HEARTBEAT_PATH) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(HEARTBEAT_PATH))
    except Exception as e:
        logging.error(f"No se pudo escribir el latido de salud: {e}")

def autotest_deteccion(carpeta):
    """Deja caer un archivo señuelo en la carpeta vigilada y confirma que el
    observer dispara un evento. Detecta el caso 'proceso vivo pero ciego'."""
    senuelo = os.path.join(carpeta, f".__selftest__{int(time.time()*1000)}.tmp")
    marca = time.time()
    try:
        with open(senuelo, "w") as f:
            f.write("selftest")
    except Exception as e:
        logging.error(f"AUTOTEST: no se pudo escribir el señuelo en {carpeta}: {e}")
        return False

    detectado = False
    try:
        limite = time.time() + SELFTEST_TIMEOUT
        while time.time() < limite:
            if _estado["ultimo_evento_fs"] >= marca:
                detectado = True
                break
            time.sleep(1)
    finally:
        try:
            os.remove(senuelo)
        except OSError:
            pass

    _estado["ultimo_selftest"] = datetime.now().isoformat(timespec="seconds")
    if detectado:
        logging.info("AUTOTEST OK: el observer detecto el señuelo, el monitoreo esta activo.")
    else:
        logging.error(
            f"AUTOTEST FALLIDO: el observer no vio el señuelo en {SELFTEST_TIMEOUT}s. "
            "El monitoreo esta CIEGO; el proceso se cerrara para que VIGIA lo relance."
        )
    return detectado


# ======================================================================
#  UTILIDADES VARIAS
# ======================================================================

MESES_ES = {1:"ene", 2:"feb", 3:"mar", 4:"abr", 5:"may", 6:"jun", 7:"jul", 8:"ago", 9:"sept", 10:"oct", 11:"nov", 12:"dic"}

def fecha_es(fecha):
    if isinstance(fecha, datetime):
        return "{}-{}-{}".format(fecha.day, MESES_ES[fecha.month], fecha.year)
    return ""

def _normalizar_fecha_entrega(val):
    """Acepta un datetime, un ISO 8601 con hora/Z ('2026-08-25T05:00:00.000Z',
    como escribe K5 la plantilla nueva) o un texto ya formateado; devuelve el
    string 'd-mmm-aaaa' que usa el resto del flujo."""
    if isinstance(val, datetime):
        return fecha_es(val)
    s = str(val).strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return fecha_es(datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    return s

def _parse_iso(s):
    try:
        return datetime.fromisoformat(str(s))
    except Exception:
        return None

def sanitize(nombre):
    nombre = nombre.strip().upper()
    nombre = re.sub(r"[^\w\s-]", "", nombre)
    nombre = re.sub(r"\s+", " ", nombre)
    return nombre

def con_reintentos(nombre_operacion, func, intentos=3, espera=3):
    """True si `func` termino sin lanzar excepcion; False si agoto los intentos.
    (Antes devolvia el resultado de func o None; ningun llamador usaba ese valor.)"""
    for intento in range(1, intentos + 1):
        try:
            func()
            return True
        except Exception as e:
            logging.error(f"{nombre_operacion} fallo (intento {intento}/{intentos}): {e}")
            if intento < intentos:
                time.sleep(espera)
    return False

# ======================================================================
#  CONEXIONES EXTERNAS  (Supabase / Google Sheets)
# ======================================================================

def _op_cliente_supabase(payload):
    get_supabase().table("clientes").upsert(payload, on_conflict="nombre").execute()

def guardar_cliente_supabase(nombre, carpeta_nas=None):
    payload = {"nombre": nombre.upper().strip(), "carpeta_nas": carpeta_nas}
    if con_reintentos(f"Guardar cliente '{nombre}' en Supabase", lambda: _op_cliente_supabase(payload)):
        logging.info(f"Cliente guardado en Supabase: {nombre}")
    else:
        encolar_registro_pendiente("cliente", payload, nombre)

def _op_referencia_supabase(payload):
    get_supabase().table("referencias").upsert(payload, on_conflict="codigo").execute()

def guardar_referencia_supabase(codigo, nombre=None):
    payload = {"codigo": codigo.upper().strip(), "nombre": (nombre or codigo).upper().strip()}
    if con_reintentos(f"Guardar referencia '{codigo}' en Supabase", lambda: _op_referencia_supabase(payload)):
        logging.info(f"Referencia guardada en Supabase: {codigo}")
    else:
        encolar_registro_pendiente("referencia", payload, codigo)

MAPA_VENDEDORES = {
    "ANDRES LOPEZ": "AL",
    "AUGUSTO LOPEZ": "AU",
    "DAVID HINCAPIE": "DH",
    "YENIFER SANCHEZ ARCILA": "YS",
}

_mapa_telas = None

def get_mapa_telas(intentos=3, espera=3):
    """Cachea el catalogo de telas para el resto del proceso, pero SOLO si la
    consulta a Supabase tuvo exito. Si fallan los reintentos, no cachea nada
    (queda en None) para que el siguiente pedido vuelva a intentarlo, en vez
    de quedar con la columna Q vacia hasta el proximo reinicio del monitor."""
    global _mapa_telas
    if _mapa_telas is None:
        for intento in range(1, intentos + 1):
            try:
                supa = get_supabase()
                r = supa.table("telas").select("codigo, nombre").execute()
                _mapa_telas = {t["codigo"]: t["nombre"] for t in r.data}
                break
            except Exception as e:
                logging.error(f"Cargar catalogo de telas desde Supabase fallo (intento {intento}/{intentos}): {e}")
                if intento < intentos:
                    time.sleep(espera)
        if _mapa_telas is None:
            logging.error("No se pudo cargar el catalogo de telas: la columna 'tela' quedara vacia en este pedido.")
            return {}
    return _mapa_telas

def buscar_tela_por_ref(ref_codigo):
    if not ref_codigo:
        return ""
    mapa = get_mapa_telas()
    m = re.search(r"(\d{3,5})", ref_codigo)
    if m:
        codigo = m.group(1)
        if codigo in mapa:
            return mapa[codigo]
    return ""

def convertir_vendedor(nombre):
    nombre_upper = nombre.upper().strip()
    if nombre_upper in MAPA_VENDEDORES:
        return MAPA_VENDEDORES[nombre_upper]
    for clave, sigla in MAPA_VENDEDORES.items():
        if clave in nombre_upper:
            return sigla
    return nombre

def buscar_email_vendedor(nombre_vendedor, intentos=3):
    if not nombre_vendedor:
        return None
    nombre_upper = nombre_vendedor.upper().strip()
    for intento in range(1, intentos + 1):
        try:
            supa = get_supabase()
            r = supa.table("vendedores").select("nombre, email").execute()
            for v in r.data:
                clave = (v.get("nombre") or "").upper().strip()
                if clave and (clave in nombre_upper or nombre_upper in clave):
                    return v.get("email")
            return None
        except Exception as e:
            logging.error(f"Error buscando email de vendedor en Supabase (intento {intento}/{intentos}): {e}")
            if intento < intentos:
                time.sleep(3)
    return None

# ======================================================================
#  CORREOS DE ALERTA AL COMERCIAL
# ======================================================================

def enviar_correo(destinatario, asunto, cuerpo, config, intentos=3):
    for intento in range(1, intentos + 1):
        try:
            msg = MIMEText(cuerpo, "plain", "utf-8")
            msg["Subject"] = asunto
            msg["From"] = config["smtp_email"]
            msg["To"] = destinatario
            with smtplib.SMTP(config["smtp_server"], config["smtp_port"], timeout=TIMEOUT_RED_SEG) as server:
                server.starttls()
                server.login(config["smtp_email"], config["smtp_password"])
                server.sendmail(config["smtp_email"], [destinatario], msg.as_string())
            logging.info(f"Correo de alerta enviado a {destinatario}")
            return True
        except Exception as e:
            logging.error(f"Error enviando correo a {destinatario} (intento {intento}/{intentos}): {e}")
            if intento < intentos:
                time.sleep(3)
    return False

def construir_correo_alerta(header, warnings, nombre_archivo):
    header = header or {}
    vendedor = header.get("vendedor") or ""
    orden = header.get("orden") or "SIN NUMERO"
    cliente = header.get("cliente") or "SIN CLIENTE"
    proyecto = header.get("proyecto") or "SIN PROYECTO"
    fecha_creacion = header.get("fecha_creacion") or ""
    lista_problemas = "\n".join(f"- {w}" for w in warnings)

    asunto = f"Cotizacion/Remision No. {orden} requiere correccion - {cliente}"
    cuerpo = (
        f"Hola {vendedor},\n\n"
        f"El Asistente de Trazabilidad no pudo procesar completamente el pedido No. {orden}\n"
        f"del cliente {cliente} - proyecto {proyecto} - porque encontro lo siguiente:\n\n"
        f"{lista_problemas}\n\n"
        f"Archivo: {nombre_archivo}\n"
        f"Fecha de creacion: {fecha_creacion}\n\n"
        f"Por favor corrige el documento y vuelve a subirlo a la carpeta de cotizaciones\n"
        f"para que se procese correctamente.\n\n"
        f"Este es un mensaje automatico del Asistente de Trazabilidad Indoor.\n"
    )
    return vendedor, asunto, cuerpo

ALERTAS_PENDIENTES_PATH = PID_DIR / "alertas_pendientes.json"

def cargar_alertas_pendientes():
    try:
        with open(str(ALERTAS_PENDIENTES_PATH), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def guardar_alertas_pendientes(alertas):
    try:
        with open(str(ALERTAS_PENDIENTES_PATH), "w", encoding="utf-8") as f:
            json.dump(alertas, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"Error guardando cola de alertas pendientes: {e}")

def encolar_alerta_pendiente(header, warnings, nombre_archivo):
    alertas = cargar_alertas_pendientes()
    alertas.append({
        "header": header or {},
        "warnings": warnings,
        "nombre_archivo": nombre_archivo,
    })
    guardar_alertas_pendientes(alertas)
    logging.warning(f"Alerta encolada para reintento posterior: {nombre_archivo}")

def reintentar_alertas_pendientes(config):
    alertas = cargar_alertas_pendientes()
    if not alertas:
        return
    restantes = []
    for alerta in alertas:
        header = alerta.get("header") or {}
        vendedor = header.get("vendedor") or ""
        email_destino = buscar_email_vendedor(vendedor)
        if email_destino:
            _, asunto, cuerpo = construir_correo_alerta(header, alerta.get("warnings", []), alerta.get("nombre_archivo", ""))
            if enviar_correo(email_destino, asunto, cuerpo, config):
                logging.info(f"Alerta pendiente enviada al reintentar: {alerta.get('nombre_archivo')}")
                continue
        restantes.append(alerta)
    if len(restantes) != len(alertas):
        guardar_alertas_pendientes(restantes)

def enviar_alerta_comercial(header, warnings, nombre_archivo, config):
    if not warnings:
        return
    header = header or {}
    vendedor = header.get("vendedor") or ""
    email_destino = buscar_email_vendedor(vendedor)
    if not email_destino:
        logging.warning(f"No se encontro correo para el vendedor '{vendedor}' (intentos agotados), se encola alerta de: {nombre_archivo}")
        encolar_alerta_pendiente(header, warnings, nombre_archivo)
        return

    _, asunto, cuerpo = construir_correo_alerta(header, warnings, nombre_archivo)
    if not enviar_correo(email_destino, asunto, cuerpo, config):
        encolar_alerta_pendiente(header, warnings, nombre_archivo)

# ======================================================================
#  COLA DE REGISTROS PENDIENTES  (Supabase / Google Sheets)
# ======================================================================
#
# Cuando el pedido ya se movio a la NAS pero Supabase o Google Sheets estan
# caidos, el dato se perderia (el archivo ya no esta en la carpeta vigilada).
# Aqui se persiste cada escritura fallida y bucle_principal la reintenta cada
# REINTENTO_ALERTAS loops, igual que la cola de correos. Nunca se descarta un
# registro por fallar: solo se sube el nivel de log cada tantos intentos.

REGISTROS_PENDIENTES_PATH = PID_DIR / "registros_pendientes.json"
MAX_REGISTROS_PENDIENTES = 2000
_registros_lock = threading.Lock()

def _clave_registro(r):
    return (r.get("tipo"), json.dumps(r.get("payload"), sort_keys=True, ensure_ascii=False))

def cargar_registros_pendientes():
    try:
        with open(str(REGISTROS_PENDIENTES_PATH), "r", encoding="utf-8") as f:
            datos = json.load(f)
            return datos if isinstance(datos, list) else []
    except Exception:
        return []

def guardar_registros_pendientes(registros):
    try:
        tmp = str(REGISTROS_PENDIENTES_PATH) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(registros, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(REGISTROS_PENDIENTES_PATH))
    except Exception as e:
        logging.error(f"Error guardando cola de registros pendientes: {e}")

def encolar_registro_pendiente(tipo, payload, archivo=""):
    nuevo = {
        "tipo": tipo,
        "payload": payload,
        "archivo": archivo,
        "intentos": 0,
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    with _registros_lock:
        registros = cargar_registros_pendientes()
        clave = _clave_registro(nuevo)
        if any(_clave_registro(r) == clave for r in registros):
            return  # ya estaba encolado, no duplicar
        registros.append(nuevo)
        if len(registros) > MAX_REGISTROS_PENDIENTES:
            registros = registros[-MAX_REGISTROS_PENDIENTES:]
        guardar_registros_pendientes(registros)
    logging.warning(f"Registro '{tipo}' encolado para reintento posterior (ref: {archivo or 'n/d'}).")

_OPS_REGISTRO = {
    "cliente":          lambda p: _op_cliente_supabase(p),
    "referencia":       lambda p: _op_referencia_supabase(p),
    "sheets":           lambda p: _op_sheets(p),
    "pagos_cotizacion": lambda p: _op_pagos_cotizacion(p),
}

def reintentar_registros_pendientes(config=None):
    """Reintenta en bloque toda la cola. Se llama desde bucle_principal.
    El lock solo se toma para leer y para guardar, nunca durante la red, para no
    bloquear al worker si justo encola un registro nuevo."""
    with _registros_lock:
        registros = cargar_registros_pendientes()
    if not registros:
        return

    restantes = []
    enviados = 0
    for r in registros:
        op = _OPS_REGISTRO.get(r.get("tipo"))
        if op is None:
            logging.warning(f"Registro pendiente de tipo desconocido '{r.get('tipo')}', se descarta.")
            continue
        r["intentos"] = r.get("intentos", 0) + 1
        try:
            op(r["payload"])
            enviados += 1
        except Exception as e:
            if r["intentos"] in (5, 20, 100) or r["intentos"] % 300 == 0:
                logging.error(
                    f"Registro pendiente '{r['tipo']}' sigue fallando tras {r['intentos']} "
                    f"intentos (ref: {r.get('archivo') or 'n/d'}): {e}"
                )
            restantes.append(r)

    # Siempre se reescribe: aunque todo siga fallando, hay que persistir el
    # contador de intentos para poder escalar el nivel de log.
    procesados = {_clave_registro(r) for r in registros}
    with _registros_lock:
        actuales = cargar_registros_pendientes()
        # Registros que el worker encolo mientras corria este reintento.
        nuevos = [r for r in actuales if _clave_registro(r) not in procesados]
        guardar_registros_pendientes(restantes + nuevos)

    if enviados:
        logging.info(f"Cola de registros: {enviados} enviado(s), {len(restantes)} pendiente(s).")

# ======================================================================
#  ESCRITURA EN GOOGLE SHEETS
# ======================================================================

# Serializa TODA escritura en la hoja de produccion. Hay DOS hilos que llaman a
# _op_sheets: el worker de ordenes (escribir_google_sheets) y el reintento de la
# cola de registros pendientes, que corre en el hilo del bucle principal
# (_OPS_REGISTRO["sheets"]). Sin este lock, ademas del append no-atomico de
# antes, las dos rutas podian pisarse.
_sheets_lock = threading.Lock()

def _fila_produccion(fila_datos):
    fila = [""] * 20
    fila[1] = "BOT"
    fila[2] = fila_datos.get("cliente", "")
    fila[3] = fila_datos.get("proyecto", "")
    fila[4] = fila_datos.get("orden", "")
    fila[6] = fila_datos.get("referencia", "")
    # Columna H (cantidad) como NUMERO cuando se puede, para que la hoja la sume
    # (con value_input_option="RAW" un int entra como celda numerica y un str
    # como texto; las fechas/orden siguen siendo texto).
    _cant = str(fila_datos.get("cantidad", "")).strip()
    fila[7] = int(_cant) if _cant.lstrip("-").isdigit() and _cant not in ("", "-") else fila_datos.get("cantidad", "")
    fila[10] = fila_datos.get("fecha_creacion", "")
    fila[11] = fila_datos.get("fecha_entrega", "")
    fila[15] = convertir_vendedor(fila_datos.get("vendedor", ""))
    fila[16] = fila_datos.get("tela", "")
    fila[19] = fila_datos.get("logo_texturizado", "")
    return fila

def _op_sheets(fila_datos):
    """Agrega UNA fila a la hoja de produccion.

    La primera fila libre se calcula por la columna C (NOMBRE DEL CLIENTE), que
    es la que marca el fin real de la tabla -la columna N trae una formula
    NETWORKDAYS arrastrada cientos de filas mas abajo, asi que ni get_all_values
    ni values.append de la API sirven para ubicar el final-.

    TODO el bloque (leer fin de tabla + escribir A:M + escribir O:T) va bajo
    _sheets_lock. Sin ese lock, el worker de ordenes y el reintento de la cola
    de registros pendientes -que corren en hilos distintos- calculaban la MISMA
    fila libre y se sobrescribian: el 2026-09-09 se perdieron asi las filas de
    produccion de RM7564 y RM7565, pisadas por CO6008/CO6007. La columna N no se
    toca (se escribe A:M y O:T por separado)."""
    fila = _fila_produccion(fila_datos)
    fila_a_m = fila[0:13]
    fila_o_t = fila[14:20]
    with _sheets_lock:
        ws = get_gspread()
        col_c = ws.col_values(3)          # C: NOMBRE DEL CLIENTE
        next_row = max(len(col_c), 3) + 1
        ws.update(range_name=f"A{next_row}:M{next_row}", values=[fila_a_m])
        ws.update(range_name=f"O{next_row}:T{next_row}", values=[fila_o_t])
        logging.info(
            f"Escrito en Google Sheets fila {next_row} "
            f"({fila_datos.get('orden')}/{fila_datos.get('referencia')})"
        )

def _orden_en_sheets(orden):
    """True si `orden` todavia aparece en la columna E (ORDEN) de la hoja de
    produccion. Permite reprocesar una orden si alguien borro su fila a mano
    en el Sheets (para pedir una correccion) sin tener que editar
    ordenes_procesadas.json a mano. Si Google Sheets no responde, se asume
    que SI esta (falla seguro: mejor no reprocesar que duplicar la fila)."""
    try:
        with _sheets_lock:
            ws = get_gspread()
            col_e = ws.col_values(5)
        return orden in col_e
    except Exception as e:
        logging.warning(
            f"No se pudo verificar en Google Sheets si la orden {orden} sigue "
            f"ahi ({e}); se asume que si para no duplicar la fila."
        )
        return True

def escribir_google_sheets(fila_datos):
    if not con_reintentos("Escribir en Google Sheets", lambda: _op_sheets(fila_datos)):
        ref = fila_datos.get("orden") or fila_datos.get("cliente") or ""
        encolar_registro_pendiente("sheets", fila_datos, ref)

# ======================================================================
#  REGISTRO EN "CONTROL DE PAGOS COTIZACIONES"  (archivo .xlsx en Drive)
# ======================================================================
#
# El archivo NO es un Google Sheet nativo: es un .xlsx subido a Drive, y la API de
# Sheets (gspread) no puede agregarle filas. Por eso aqui se descarga el .xlsx con
# la API de Drive, se le agrega la fila con openpyxl y se vuelve a subir.
#
# RIESGO ACEPTADO: si un vendedor edita las columnas de pagos (G en adelante) en el
# navegador entre la descarga y la resubida, esa edicion se pierde. Mitigacion:
#   - _pagos_lock: el monitor nunca corre dos de estas a la vez.
#   - se compara modifiedTime antes de subir; si cambio, se aborta y se reintenta
#     via la cola de registros pendientes (ErrorTecnico).
# Solo se escriben A:E (y F solo si no trae ya su formula). G+ jamas se tocan.

_pagos_lock = threading.Lock()
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

def _drive_session():
    """Sesion HTTP autenticada contra la API de Drive (usa google-auth + requests,
    sin depender de googleapiclient, que puede no estar instalado en el equipo)."""
    from google.auth.transport.requests import AuthorizedSession
    config = load_config()
    creds = Credentials.from_service_account_file(
        str(BASE_DIR / config["google_credentials"]),
        scopes=['https://www.googleapis.com/auth/drive'],
    )
    return AuthorizedSession(creds)

def _drive_modified_time(sess, fid):
    r = sess.get(
        f"https://www.googleapis.com/drive/v3/files/{fid}",
        params={"fields": "modifiedTime", "supportsAllDrives": "true"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("modifiedTime")

def _limpiar_may(s):
    """'Paola Andrea Florez Hernandez.' -> 'PAOLA ANDREA FLOREZ HERNANDEZ'"""
    return re.sub(r"\s+", " ", (s or "").strip().strip(".").strip()).upper()

def _op_pagos_cotizacion(payload):
    """payload = {file_id, hoja, id_cotizacion, cliente, vendedor, total_bruto, descuento}
    Lanza excepcion si algo falla (el llamador la encola para reintento)."""
    fid  = payload["file_id"]
    hoja = payload["hoja"]
    with _pagos_lock:
        sess = _drive_session()
        mtime0 = _drive_modified_time(sess, fid)

        r = sess.get(
            f"https://www.googleapis.com/drive/v3/files/{fid}",
            params={"alt": "media", "supportsAllDrives": "true"},
            timeout=120,
        )
        r.raise_for_status()
        wb = openpyxl.load_workbook(io.BytesIO(r.content))    # conserva formulas
        ws = wb[hoja] if hoja in wb.sheetnames else wb[wb.sheetnames[0]]

        # Primera fila vacia: ultima fila con la columna A (ID cotizacion) no vacia,
        # + 1. Se empieza en la fila 2 (la 1 son encabezados).
        fila = 2
        for i, row in enumerate(ws.iter_rows(min_row=2, max_col=1, values_only=True), start=2):
            if row[0] not in (None, ""):
                fila = i + 1

        ws.cell(fila, 1, int(payload["id_cotizacion"]))
        ws.cell(fila, 2, _limpiar_may(payload.get("cliente")))
        ws.cell(fila, 3, _limpiar_may(payload.get("vendedor")))
        total_bruto = payload.get("total_bruto")
        if total_bruto is not None:
            ws.cell(fila, 4, total_bruto)   # D: Total bruto
            ws.cell(fila, 6, total_bruto)   # F: se copia el MISMO valor que D (pedido del usuario)
        # Descuentos (E): solo si viene un valor > 0. Nunca escribir 0.
        desc = payload.get("descuento")
        if desc:
            ws.cell(fila, 5, desc)

        bio = io.BytesIO()
        wb.save(bio)
        bio.seek(0)

        # Mitigacion de carrera: si alguien edito el archivo mientras lo teniamos
        # abierto, NO subir (perderiamos su cambio); reintentar mas tarde.
        if _drive_modified_time(sess, fid) != mtime0:
            raise ErrorTecnico(
                "CONTROL DE PAGOS COTIZACIONES cambio durante la edicion; se reintenta "
                "para no pisar una edicion manual."
            )

        up = sess.patch(
            f"https://www.googleapis.com/upload/drive/v3/files/{fid}",
            params={"uploadType": "media", "supportsAllDrives": "true"},
            headers={"Content-Type": _XLSX_MIME},
            data=bio.getvalue(),
            timeout=120,
        )
        up.raise_for_status()
        logging.info(
            f"Pago cotizacion registrado en CONTROL DE PAGOS COTIZACIONES fila {fila} "
            f"(CO{payload['id_cotizacion']} - {payload.get('cliente')})"
        )

def registrar_pago_cotizacion(header, config):
    """Arma el payload desde el header del PDF y lo escribe (o lo encola)."""
    id_cot = header.get("id_cotizacion")
    if not id_cot:
        logging.warning("No se pudo registrar el pago: el PDF no trae numero de cotizacion.")
        return
    if header.get("subtotal") is None:
        logging.warning(
            f"CO{id_cot}: no se detecto SUBTOTAL en el PDF; se registra la fila sin Total bruto."
        )
    payload = {
        "file_id":       config["pagos_cotizaciones_file_id"],
        "hoja":          config.get("pagos_cotizaciones_hoja", "Control de pagos"),
        "id_cotizacion": id_cot,
        "cliente":       header.get("cliente") or "",
        "vendedor":      header.get("vendedor") or "",
        "total_bruto":   header.get("subtotal"),
        "descuento":     header.get("descuento"),
    }
    if not con_reintentos("Registrar pago cotizacion", lambda: _op_pagos_cotizacion(payload), intentos=2):
        encolar_registro_pendiente("pagos_cotizacion", payload, f"CO{id_cot}")

# ======================================================================
#  EXTRACCION DE DATOS: EXCEL  (pedido subido por el comercial)
# ======================================================================

# Referencias historicas: A100..., y nuevas referencias descriptivas como
# A-TELAUCO-CA02. Se exige que las descriptivas contengan al menos un digito
# para no confundir hojas auxiliares (por ejemplo BASE_DATOS) con productos.
REF_HOJA_RE = re.compile(r"^(?:[A-Z]\d{2,}|[A-Z]-[A-Z0-9-]*\d[A-Z0-9-]*)$")

def extraer_items_excel(ruta):
    try:
        wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    except Exception as e:
        raise ErrorTecnico(f"No se pudo abrir el Excel {os.path.basename(ruta)} (¿aun copiandose o bloqueado?): {e}")
    try:
        nombre_arch = os.path.basename(ruta)
        prefijo, numero = extraer_prefijo_numero_nombre(nombre_arch)
        orden = f"{prefijo}{numero}" if prefijo and numero else ""

        MAX_COL_BUSQUEDA = 30
        # El valor de cada campo del encabezado va a la derecha de su etiqueta,
        # entre las columnas F y K. Se toma la ULTIMA celda no vacia de ese rango:
        # en el formato nuevo la fila del cliente trae ademas el titulo
        # "<REF> - <desc>" en la columna F, que hay que ignorar. Antes esto leia
        # una columna fija (K) y se rompia con la plantilla nueva.
        VALOR_COL_MIN = 5   # F (0-based)
        VALOR_COL_MAX = 11  # exclusivo -> hasta K

        def valor_del_campo(fila_valores, col_idx_0based):
            inicio = max(col_idx_0based + 1, VALOR_COL_MIN)
            candidato = None
            for c in range(inicio, min(len(fila_valores), VALOR_COL_MAX)):
                if fila_valores[c] not in (None, ""):
                    candidato = fila_valores[c]
            return candidato

        # El encabezado (cliente/proyecto/comercial/fecha) se lee de la PRIMERA
        # hoja de producto real, no de wb.sheetnames[0]: en el formato nuevo la
        # hoja 0 es la plantilla REFERENCIA (molde vacio, F2..K5 en blanco).
        # Retrocompatible con el formato viejo, donde la hoja 0 ya es un listado.
        hojas_producto = [sn for sn in wb.sheetnames if REF_HOJA_RE.match(sn.strip().upper())]
        hojas_cabecera = hojas_producto or [wb.sheetnames[0]]

        cliente = None
        proyecto = None
        fecha_entrega = None
        comercial = None
        for sheet_cab in hojas_cabecera:
            ws_cab = wb[sheet_cab]
            for row in ws_cab.iter_rows(min_row=1, max_row=10, max_col=MAX_COL_BUSQUEDA, values_only=True):
                for idx, valor in enumerate(row):
                    if not (valor and isinstance(valor, str)):
                        continue
                    val_upper = valor.strip().upper()
                    if "NOMBRE" in val_upper and "CLIENTE" in val_upper and not cliente:
                        val = valor_del_campo(row, idx)
                        if val:
                            cliente = str(val).strip()
                    elif "NOMBRE" in val_upper and "PROYECTO" in val_upper and not proyecto:
                        val = valor_del_campo(row, idx)
                        if val:
                            proyecto = str(val).strip()
                    elif "COMERCIAL" in val_upper and not comercial:
                        val = valor_del_campo(row, idx)
                        if val:
                            comercial = str(val).strip()
                    elif "FECHA" in val_upper and "ENTREGA" in val_upper and not fecha_entrega:
                        val = valor_del_campo(row, idx)
                        if val:
                            fecha_entrega = _normalizar_fecha_entrega(val)
            if cliente and proyecto:
                break

        if not fecha_entrega:
            fecha_entrega = fecha_es(datetime.now() + timedelta(days=15))

        MAX_FILAS_HOJA = 2000

        resultados = []
        for sheet_name in wb.sheetnames:
            ref_codigo = sheet_name.strip().upper()
            if not REF_HOJA_RE.match(ref_codigo):
                logging.info(f"Hoja '{sheet_name}' no parece una referencia de producto, se omite.")
                continue
            ws = wb[sheet_name]

            items = []
            logo_texturizado = "NO"
            total_excel = None    # celda "TOTAL UNIFORMES" de la hoja (valor a la derecha de la etiqueta)
            fila_num = 0
            for row in ws.iter_rows(min_row=1, values_only=True):
                fila_num += 1
                if fila_num > MAX_FILAS_HOJA:
                    break
                if fila_num >= 8:
                    item_val = row[1] if len(row) > 1 else None
                    talla_val = row[3] if len(row) > 3 else None
                    if item_val is not None and talla_val:
                        items.append({"cantidad": str(talla_val)})
                if logo_texturizado == "NO":
                    for cell in row:
                        if cell and "TEXTURIZADO" in str(cell).upper():
                            logo_texturizado = "SI"
                            break
                if total_excel is None:
                    for c_idx, cell in enumerate(row):
                        if isinstance(cell, str) and "TOTAL" in cell.upper() and "UNIFORME" in cell.upper():
                            for v in row[c_idx + 1:]:
                                if isinstance(v, (int, float)) and not isinstance(v, bool):
                                    total_excel = int(round(v))
                                    break
                            break

            # UNIDADES de la referencia = el "TOTAL UNIFORMES" que muestra el propio
            # Excel (2026-09-21). Antes se contaban las filas con item+talla, y no
            # siempre coincidia (p.ej. CO6072: 499 filas vs 466 en el Excel).
            # Respaldo: si la celda no existe o no trae valor guardado (Excel generado
            # sin calcular formulas) o es 0 con filas listadas, se usa el conteo de filas.
            if total_excel is not None and (total_excel > 0 or not items):
                cantidad_ref = str(total_excel)
                if items and total_excel != len(items):
                    logging.info(
                        f"Hoja {ref_codigo}: unidades segun el Excel (TOTAL UNIFORMES) = {total_excel} "
                        f"(filas con talla: {len(items)}); se usa el total del Excel."
                    )
            else:
                cantidad_ref = str(len(items)) if items else ""
                logging.warning(
                    f"Hoja {ref_codigo}: no se encontro un 'TOTAL UNIFORMES' con valor en el Excel; "
                    f"se usa el conteo de filas ({cantidad_ref or 'vacio'})."
                )

            tela = buscar_tela_por_ref(ref_codigo)

            resultados.append({
                "cliente": cliente,
                "proyecto": proyecto,
                "orden": orden,
                "referencia": ref_codigo,
                "cantidad": cantidad_ref,
                "fecha_creacion": fecha_es(datetime.now()),
                "fecha_entrega": fecha_entrega,
                "vendedor": comercial or "",
                "tela": tela,
                "logo_texturizado": logo_texturizado,
            })

        wb.close()
        return resultados
    except Exception:
        logging.exception(f"Error leyendo Excel {ruta}")
        try:
            wb.close()
        except Exception:
            pass
        return []

# ======================================================================
#  EXTRACCION DE DATOS: PDF  (cotizacion / remision)
# ======================================================================

ITEM_PDF_RE = re.compile(
    r"^(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+\$[\d,\.]+\s.*$"
)
GENERO_PDF_RE = re.compile(r"\b(MASCULINO|MASC|MAC|FEMENINO|FEM)\b", re.IGNORECASE)
TALLAS_CONOCIDAS = {"XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "4", "6", "8", "10", "12", "14", "16"}
SEGMENTO_RE = re.compile(r"^[A-Z0-9]{1,10}$")

def normalizar_genero(texto):
    m = GENERO_PDF_RE.search(texto)
    if not m:
        return None
    return "FEM" if m.group(1).upper() in ("FEM", "FEMENINO") else "MASC"

def parsear_talla_linea(linea):
    partes = linea.split("-")
    if not (1 <= len(partes) <= 3):
        return None
    if not all(SEGMENTO_RE.match(p) for p in partes):
        return None
    if len(partes) == 1:
        return {"nombre": None, "talla": partes[0], "numero": None}
    if len(partes) == 2:
        if partes[0] in TALLAS_CONOCIDAS:
            return {"nombre": None, "talla": partes[0], "numero": partes[1]}
        return {"nombre": partes[0], "talla": partes[1], "numero": None}
    return {"nombre": partes[0], "talla": partes[1], "numero": partes[2]}

def _fusionar_continuacion_item(actual, linea):
    """Une a `actual` una linea de continuacion: en el PDF la celda REF/DESCRIPCION
    se parte en 2 renglones cuando el texto es largo (p.ej. item 4 del ejemplo:
    1er renglon '... CHAQUETA DEPORTIVA PREMIUM MASC', 2do renglon 'H01 D1.').
    El sufijo del diseno (D1./D2./...) y/o el genero suelen caer en ese 2do
    renglon, por eso antes se emitia un falso aviso 'se asumio D1' y la remision
    entera se rechazaba."""
    cont = linea.strip()
    if not cont:
        return
    m_dis = re.search(r"D(\d)\.", cont)
    if m_dis and not actual["diseno_explicito"]:
        actual["diseno"] = int(m_dis.group(1))
        actual["diseno_explicito"] = True
    g2 = normalizar_genero(cont)
    if g2 and not actual["genero_explicito"]:
        actual["genero"] = g2
        actual["genero_explicito"] = True

    extra = GENERO_PDF_RE.sub("", cont)
    extra = re.sub(r"D\d+\.", "", extra)
    extra = re.sub(r"\s+", " ", extra).strip()
    if not extra:
        return
    toks = extra.split(" ")
    # El primer token suele ser la cola del REF (codigo corto con digitos, p.ej.
    # 'H01'); se pega al REF, el resto es cola de la descripcion.
    if toks and SEGMENTO_RE.match(toks[0]) and len(toks[0]) <= 6 and any(c.isdigit() for c in toks[0]):
        actual["ref"] = (actual["ref"] + toks[0]).upper()
        toks = toks[1:]
    cola = " ".join(toks).strip()
    if cola:
        actual["descripcion_base"] = (actual["descripcion_base"] + " " + cola).strip()


def parsear_items_pdf(texto, warnings=None):
    if warnings is None:
        warnings = []
    items = []
    actual = None
    for linea in texto.split("\n"):
        linea = linea.strip()
        if not linea:
            continue
        m = ITEM_PDF_RE.match(linea)
        if m:
            descripcion_full = m.group(3)
            genero = normalizar_genero(descripcion_full)
            diseno = 1
            m_dis = re.search(r"D(\d)\.", descripcion_full)
            diseno_explicito = bool(m_dis)
            if m_dis:
                diseno = int(m_dis.group(1))
            descripcion_base = GENERO_PDF_RE.sub("", descripcion_full)
            descripcion_base = re.sub(r"D\d+\.", "", descripcion_base)
            descripcion_base = re.sub(r"\s+", " ", descripcion_base).strip()
            actual = {
                "item": int(m.group(1)),
                "ref": m.group(2).upper(),
                "descripcion_base": descripcion_base,
                "genero": genero or "MASC",
                "genero_explicito": bool(genero),
                "diseno": diseno,
                "diseno_explicito": diseno_explicito,
                "cantidad": int(m.group(4)),
                "tallas": [],
            }
            items.append(actual)
            continue
        if actual is None:
            continue
        if linea.upper().startswith("TOTAL"):
            actual = None
            continue
        talla = parsear_talla_linea(linea.upper())
        if talla:
            actual["tallas"].append(talla)
            continue
        # No es item, ni TOTAL, ni talla: es la continuacion de la celda del item
        # partida en 2 renglones. Solo se acepta antes de que empiecen las tallas.
        if not actual["tallas"]:
            _fusionar_continuacion_item(actual, linea)

    # Avisos diferidos: hasta aqui no sabemos si el diseno/genero venia en una
    # linea de continuacion. Si un item de verdad no lo trae, se avisa (y la
    # remision se rechaza aguas arriba, como antes).
    for it in items:
        if not it["diseno_explicito"]:
            msg = f"Item {it['item']} ({it['ref']}): no se detecto numero de diseno (D1/D2/D3/D4) explicito en el PDF, se asumio D1."
            logging.warning(f"PDF: {msg}")
            warnings.append(msg)
        if not it["genero_explicito"]:
            msg = f"Item {it['item']} ({it['ref']}): no se detecto genero (MASC/FEM) explicito en el PDF, se asumio MASC."
            logging.warning(f"PDF: {msg}")
            warnings.append(msg)
    return items

def extraer_info_pdf(ruta):
    try:
        with pdfplumber.open(ruta) as pdf:
            texto = "\n".join(page.extract_text() or "" for page in pdf.pages)
        cliente = None
        proyecto = None
        numero = None
        vendedor = None
        fecha_creacion = None
        fecha_entrega = None
        logo_texturizado = "NO"

        m_cliente = re.search(r"Cliente:\s*(.+?)(?:\.|CC:|$)", texto, re.IGNORECASE)
        if m_cliente:
            cliente = m_cliente.group(1).strip()
        m_vendedor = re.search(r"Vendedor:\s*(.+?)$", texto, re.IGNORECASE | re.MULTILINE)
        if m_vendedor:
            vendedor = m_vendedor.group(1).strip()
        m_proyecto = re.search(r"Garant[i\xed]a:\s*(.+?)$", texto, re.IGNORECASE | re.MULTILINE)
        if m_proyecto:
            proyecto = m_proyecto.group(1).strip()
        m_numero = re.search(r"No\.\s*(\d+)", texto)
        if m_numero:
            numero = m_numero.group(1)
        m_fecha = re.search(r"Creaci[o\xf3]n:\s*(\d{4}-\d{2}-\d{2})", texto, re.IGNORECASE)
        if m_fecha:
            fecha_creacion = m_fecha.group(1)
        m_entrega = re.search(r"Entrega:\s*(\d{4}-\d{2}-\d{2})", texto, re.IGNORECASE)
        if m_entrega:
            fecha_entrega = m_entrega.group(1)
        if "TEXTURIZADO" in texto.upper():
            logo_texturizado = "SI"

        # --- Tipo de documento y montos (para CONTROL DE PAGOS COTIZACIONES) ---
        texto_up = texto.upper()
        tipo_doc = None
        if "COTIZACI" in texto_up and "REMISI" not in texto_up:
            tipo_doc = "COTIZACION"
        elif "REMISI" in texto_up:
            tipo_doc = "REMISION"
        elif "COTIZACI" in texto_up:
            tipo_doc = "COTIZACION"

        def _ultimo_monto(patron):
            # El bloque de totales esta al final del PDF y SIEMPRE trae el signo $.
            # Se exige el '$' para no confundirse con el encabezado de la tabla
            # ("... IMPUESTOS TOTAL NETO\n1 A100CA02 ...") ni con numeros sueltos.
            vals = re.findall(patron + r"\s*\$\s*([\d.,]+)", texto, re.IGNORECASE)
            if not vals:
                return None
            d = re.sub(r"[^\d]", "", vals[-1])
            return int(d) if d else None

        subtotal   = _ultimo_monto(r"SUBTOTAL")
        total_neto = _ultimo_monto(r"TOTAL\s+NETO")

        nombre_arch = os.path.basename(ruta)
        prefijo, numero_nombre = extraer_prefijo_numero_nombre(nombre_arch)
        if not prefijo:
            if "COTIZACI" in texto.upper():
                prefijo = "CO"
            elif "REMISI" in texto.upper():
                prefijo = "RM"
        if not numero:
            numero = numero_nombre
        orden = ""
        if prefijo and numero:
            orden = f"{prefijo}{numero}"
        if tipo_doc is None and prefijo == "CO":
            tipo_doc = "COTIZACION"
        elif tipo_doc is None and prefijo == "RM":
            tipo_doc = "REMISION"

        if subtotal is not None and total_neto is not None and subtotal != total_neto:
            logging.warning(
                f"PDF {nombre_arch}: SUBTOTAL ({subtotal}) y TOTAL NETO ({total_neto}) "
                "no coinciden; se registra el SUBTOTAL como Total bruto."
            )

        if not fecha_creacion:
            fecha_creacion = fecha_es(datetime.now())
        else:
            try:
                parts = fecha_creacion.split("-")
                fecha_creacion = "{}-{}-{}".format(int(parts[2]), MESES_ES[int(parts[1])], parts[0])
            except:
                pass

        fecha_entrega_date = None
        if fecha_entrega:
            try:
                fecha_entrega_date = datetime.strptime(fecha_entrega, "%Y-%m-%d").date()
            except:
                fecha_entrega_date = None
        if not fecha_entrega_date:
            fecha_entrega_date = (datetime.now() + timedelta(days=15)).date()
        fecha_entrega = fecha_es(datetime.combine(fecha_entrega_date, datetime.min.time()))

        warnings = []
        items = parsear_items_pdf(texto, warnings)
        if not cliente:
            warnings.append("No se pudo identificar el nombre del cliente en el PDF.")
        if not proyecto:
            warnings.append("No se pudo identificar el proyecto (campo Garantia) en el PDF.")
        if not items:
            warnings.append("No se detecto ningun item/talla valido en el documento.")

        por_ref_cant = {}
        orden_refs_vistas = []
        for it in items:
            por_ref_cant[it["ref"]] = por_ref_cant.get(it["ref"], 0) + it["cantidad"]
            if it["ref"] not in orden_refs_vistas:
                orden_refs_vistas.append(it["ref"])

        resultados = []
        for ref in orden_refs_vistas:
            tela = buscar_tela_por_ref(ref)
            resultados.append({
                "cliente": cliente,
                "proyecto": proyecto,
                "orden": orden,
                "referencia": ref,
                "cantidad": str(por_ref_cant[ref]),
                "fecha_creacion": fecha_creacion or "",
                "fecha_entrega": fecha_entrega,
                "vendedor": vendedor or "",
                "tela": tela,
                "logo_texturizado": logo_texturizado,
            })

        if not resultados:
            m_ref = re.search(r"\b([A-Z]\d{3,}[A-Z0-9]+)\b", texto)
            ref_fallback = m_ref.group(1).upper() if m_ref else ""
            resultados = [{
                "cliente": cliente,
                "proyecto": proyecto,
                "orden": orden,
                "referencia": ref_fallback,
                "cantidad": "",
                "fecha_creacion": fecha_creacion or "",
                "fecha_entrega": fecha_entrega,
                "vendedor": vendedor or "",
                "tela": buscar_tela_por_ref(ref_fallback),
                "logo_texturizado": logo_texturizado,
            }]

        header = {
            "cliente": cliente,
            "proyecto": proyecto,
            "vendedor": vendedor,
            "orden": orden,
            "fecha_creacion": fecha_creacion,
            "fecha_entrega_date": fecha_entrega_date,
            "tipo_doc": tipo_doc,                       # "COTIZACION" | "REMISION" | None
            "id_cotizacion": numero if tipo_doc == "COTIZACION" else None,
            "subtotal": subtotal,
            "total_neto": total_neto,
            "descuento": None,
        }
        return resultados, header, items, warnings
    except ErrorTecnico:
        raise
    except Exception as e:
        logging.exception(f"Error leyendo PDF {ruta}")
        raise ErrorTecnico(f"No se pudo leer el PDF {os.path.basename(ruta)} (¿aun copiandose o dañado?): {e}")

# ======================================================================
#  (La generacion del LISTADO_*.xlsm se retiro por decision del negocio:
#   el asistente ya NO crea listados de produccion; solo registra en las hojas.)
# ======================================================================

# ======================================================================
#  PROCESAMIENTO Y MOVIMIENTO DE ARCHIVOS
# ======================================================================

def extraer_prefijo_numero_nombre(nombre):
    nombre_base = os.path.splitext(nombre)[0].upper()
    # Tolerancia a basura al inicio del nombre: se vio repetidamente el Excel
    # del pedido llegando como ' RM7557_...' (un espacio delante), lo que rompia
    # el ^ anclado de la regex y dejaba la orden sin emparejar. Se descartan
    # espacios y separadores iniciales (espacio, guion, guion bajo, punto...).
    nombre_base = re.sub(r"^[\s\W_]+", "", nombre_base)
    m = re.match(r"^(CO|RM)(\d+)", nombre_base)
    if m:
        return m.group(1), m.group(2)
    m = re.search(r"(COTIZACION|REMISION).*?(\d{3,})", nombre_base)
    if m:
        tipo = "CO" if m.group(1) == "COTIZACION" else "RM"
        return tipo, m.group(2)
    return None, None

def normalizar_nombre_archivo(ruta):
    """Si el nombre trae espacios (o separadores sueltos) al principio o al final
    -se vio el Excel llegando como ' RM7557_...'- lo renombra EN DISCO a la
    version limpia y devuelve la ruta nueva. Asi tambien la copia que queda en la
    carpeta de la orden sale con el nombre correcto. Si el rename no se puede
    hacer (archivo bloqueado, ya existe la version limpia, etc.) devuelve la ruta
    original sin tocar nada: extraer_prefijo_numero_nombre() ya tolera el espacio."""
    carpeta, nombre = os.path.split(ruta)
    base, ext = os.path.splitext(nombre)
    limpio = base.strip(" .-_\t") + ext.strip()
    if not limpio or limpio == nombre:
        return ruta
    destino = os.path.join(carpeta, limpio)
    if os.path.exists(destino):
        return ruta
    try:
        os.rename(ruta, destino)
        logging.info(f"Nombre de archivo normalizado: '{nombre}' -> '{limpio}'")
        return destino
    except OSError as e:
        logging.warning(f"No se pudo normalizar el nombre '{nombre}' (se procesa igual): {e}")
        return ruta

def existe_carpeta(ruta):
    return os.path.isdir(ruta)

def crear_carpeta(ruta):
    os.makedirs(ruta, exist_ok=True)
    logging.info(f"Carpeta creada: {ruta}")

def _destino_sin_colision(destino_dir, nombre):
    destino = os.path.join(destino_dir, nombre)
    if os.path.exists(destino):
        base, ext = os.path.splitext(nombre)
        contador = 1
        while os.path.exists(os.path.join(destino_dir, f"{base}_{contador}{ext}")):
            contador += 1
        destino = os.path.join(destino_dir, f"{base}_{contador}{ext}")
    return destino

def mover_archivo(origen, destino_dir):
    os.makedirs(destino_dir, exist_ok=True)
    destino = _destino_sin_colision(destino_dir, os.path.basename(origen))
    shutil.move(origen, destino)
    logging.info(f"Archivo movido: {origen} -> {destino}")
    return destino

def copiar_archivo(origen, destino_dir):
    """Como mover_archivo pero deja el original donde esta (para la carpeta de la orden).

    A proposito NO evita colision: si la orden se reprocesa (correccion), el
    PDF/Excel nuevo debe REEMPLAZAR al viejo en la carpeta del cliente, no
    quedar acumulado al lado como _1, _2, etc."""
    os.makedirs(destino_dir, exist_ok=True)
    destino = os.path.join(destino_dir, os.path.basename(origen))
    shutil.copy2(origen, destino)
    logging.info(f"Archivo copiado: {origen} -> {destino}")
    return destino

def archivar_original(ruta, carpeta_monitoreo=None):
    """Borra el original de la carpeta vigilada una vez procesado.
    (El PDF y el Excel ya quedaron copiados en la carpeta de la orden; la carpeta
    vigilada debe quedar vacia, sin subcarpeta _PROCESADOS.)"""
    try:
        os.remove(ruta)
        logging.info(f"Original eliminado de la carpeta vigilada: {os.path.basename(ruta)}")
        return True
    except FileNotFoundError:
        return True
    except Exception as e:
        logging.error(f"No se pudo eliminar el original {ruta}: {e}")
        return None

def esperar_archivo_estable(ruta, lecturas_iguales=3, espera=1.5, max_intentos=40):
    """Espera a que termine de copiarse por SMB: tamaño repetido varias veces
    seguidas y que el archivo se pueda abrir para lectura."""
    ult = -1
    seguidas = 0
    for _ in range(max_intentos):
        try:
            tam = os.path.getsize(ruta)
        except OSError:
            return False
        if tam > 0 and tam == ult:
            seguidas += 1
            if seguidas >= lecturas_iguales:
                try:
                    with open(ruta, "rb"):
                        pass
                    return True
                except OSError:
                    seguidas = 0
        else:
            seguidas = 0
        ult = tam
        time.sleep(espera)
    logging.warning(f"{os.path.basename(ruta)} no termino de estabilizarse; se intenta procesar igual.")
    return True

def es_archivo_extra(nombre, config):
    """True si `nombre` es un archivo que NO es parte de la pareja Excel/PDF (una
    imagen, etc.) y debe copiarse a la carpeta de la orden. Se descartan los
    internos del monitor y la basura del sistema (.DS_Store, ~$lock, Thumbs.db...)."""
    bajo = nombre.lower()
    if nombre.startswith(PREFIJOS_TEMP) or nombre.startswith((".", "~$")):
        return False
    if bajo in EXTRAS_IGNORAR_NOMBRES:
        return False
    ext = os.path.splitext(bajo)[1]
    if ext in EXTRAS_IGNORAR_EXT or ext in config["extensiones_permitidas"]:
        return False
    return True

def orden_en_nombre(nombre):
    """'CO6075'/'RM7604' si el nombre de un extra trae el numero de una orden
    (p.ej. 'RM7604_logo.png'); None si no trae ninguno."""
    m = ORDEN_EN_NOMBRE_RE.search(os.path.splitext(nombre)[0].upper())
    return f"{m.group(1)}{m.group(2)}" if m else None

def copiar_extra(origen, destino_dir):
    """Copia UN extra a la carpeta de la orden y verifica que quedo completo.
    Devuelve True si la copia esta bien (el original ya se puede borrar)."""
    try:
        if not esperar_archivo_estable(origen, lecturas_iguales=2, espera=1.0, max_intentos=30):
            return False
        destino = copiar_archivo(origen, destino_dir)
        if os.path.getsize(destino) != os.path.getsize(origen):
            logging.error(f"Extra {os.path.basename(origen)}: la copia no coincide en tamaño; se deja el original.")
            return False
        return True
    except Exception as e:
        logging.error(f"No se pudo copiar el extra {os.path.basename(origen)} a {destino_dir}: {e}")
        return False

def copiar_extras_a_orden(carpeta_monitoreo, ruta_orden, orden, config):
    """Copia a la carpeta de la orden todos los archivos sueltos (imagenes, etc.)
    de la carpeta vigilada. Se saltan los que traen en el nombre el numero de OTRA
    orden. Devuelve las rutas de origen copiadas OK (para borrarlas al terminar).
    Un extra que falle NO frena la orden: se deja en la carpeta vigilada."""
    copiados = []
    try:
        nombres = sorted(os.listdir(carpeta_monitoreo))
    except OSError as e:
        logging.warning(f"No se pudieron listar los extras de {carpeta_monitoreo}: {e}")
        return copiados
    for nombre in nombres:
        origen = os.path.join(carpeta_monitoreo, nombre)
        if not os.path.isfile(origen) or not es_archivo_extra(nombre, config):
            continue
        de_orden = orden_en_nombre(nombre)
        if de_orden and de_orden != orden:
            continue   # es de otra orden; se reparte cuando esa orden se procese
        if copiar_extra(origen, ruta_orden):
            copiados.append(origen)
    if copiados:
        logging.info(f"Orden {orden}: {len(copiados)} archivo(s) extra copiados a la carpeta de la orden.")
    return copiados

def procesar_orden(orden, ruta_pdf, ruta_xlsx, config, production_writer=None, write_google_sheets=True):
    """Procesa una orden completa (Excel de pedido + su PDF de cotizacion/remision).
    Devuelve la ruta de la carpeta de la orden si termino OK, o False si no se
    proceso. Lanza ErrorTecnico ante fallos transitorios.

    REPARTO DE ROLES (decision del negocio 2026-09-06 - ver LECCIONES APRENDIDAS #5):
      - El EXCEL del pedido ("listado") hace TODO el proceso y es la UNICA fuente
        de las filas de la HOJA DE PRODUCCION (antes salian del PDF).
      - El PDF SOLO sirve para registrar la fila en CONTROL DE PAGOS COTIZACIONES,
        y unicamente si es una COTIZACION. Un PDF de REMISION no escribe nada.
      - Se mantiene el emparejamiento: la orden no se procesa hasta tener el
        Excel Y el PDF con el mismo numero CO####/RM####.

    Flujo:
      1. Lee el Excel del pedido (fuente de verdad de produccion).
      2. Lee el PDF (solo tipo de documento + montos para la hoja de pagos).
      3. Si falta cliente/proyecto (Excel y PDF) o el Excel no trae referencias
         -> correo al comercial y NO procesa.
      4. Crea la estructura de carpetas cliente/orden en la NAS.
      5. COPIA el Excel y el PDF a la carpeta de la orden, y tambien cualquier
         otro archivo suelto en la carpeta vigilada (imagenes, etc.).
      6. Sube cliente/referencias a Supabase.
      7. Registra las referencias del EXCEL en la hoja de PRODUCCION.
      8. SOLO si el PDF es COTIZACION: fila en CONTROL DE PAGOS COTIZACIONES.
      9. Borra los originales de la carpeta vigilada (ya estan copiados en la orden).
    """
    nombre_pdf = os.path.basename(ruta_pdf)
    nombre_xlsx = os.path.basename(ruta_xlsx)

    # 1. El Excel del pedido es la fuente de verdad para la hoja de produccion.
    datos_xlsx = extraer_items_excel(ruta_xlsx)          # una fila por referencia
    datos_first = (datos_xlsx or [{}])[0] or {}

    # 2. El PDF solo aporta el tipo de documento y, si es COTIZACION, los montos
    #    para CONTROL DE PAGOS COTIZACIONES. Sus items ya NO alimentan produccion.
    #    Un ErrorTecnico aqui (PDF aun copiandose / ilegible) se propaga para
    #    reintentar la orden completa mas tarde.
    _, header_pdf, _, _ = extraer_info_pdf(ruta_pdf)
    es_cotizacion = (header_pdf.get("tipo_doc") == "COTIZACION")

    # 3. Cliente/proyecto: del Excel; si falta, del PDF como respaldo.
    cliente = datos_first.get("cliente") or header_pdf.get("cliente")
    proyecto = datos_first.get("proyecto") or header_pdf.get("proyecto")

    motivos = []
    if not cliente:
        motivos.append("No se pudo identificar el nombre del cliente (ni en el Excel del pedido ni en el PDF).")
    if not proyecto:
        motivos.append("No se pudo identificar el proyecto (ni en el Excel del pedido ni en el PDF).")
    if not any(d.get("referencia") for d in datos_xlsx):
        motivos.append("El Excel del pedido no tiene hojas de referencia (producto) validas.")
    if motivos:
        enviar_alerta_comercial(header_pdf, motivos, nombre_xlsx, config)
        logging.warning(f"Orden {orden}: reglas incumplidas, no se procesa -> {motivos}")
        return False

    cliente_safe = sanitize(cliente)
    proyecto_safe = sanitize(proyecto)
    orden_num = datos_first.get("orden") or orden
    nombre_orden = f"{orden_num}_{proyecto_safe}" if orden_num else f"ORDEN_{proyecto_safe}"

    logging.info(
        f"Orden {orden_num} ({header_pdf.get('tipo_doc') or 'SIN TIPO'}) | Cliente: {cliente_safe} "
        f"| Proyecto: {proyecto_safe} | Referencias (Excel): {len(datos_xlsx)}"
    )

    ruta_cliente = os.path.join(config["ruta_nas_clientes"], cliente_safe)
    ruta_orden = os.path.join(ruta_cliente, nombre_orden)

    if existe_carpeta(ruta_cliente):
        logging.info(f"Cliente ya existe: {cliente_safe}")
    else:
        crear_carpeta(ruta_cliente)
        crear_carpeta(os.path.join(ruta_cliente, "MAESTROS"))

    crear_carpeta(ruta_orden)
    for sub in ("APLIQUE (BORDADO,VINILOS,TRANSFER)", "CORTE PLT", "IMPRESION (NOMBRE MAQUINA)"):
        crear_carpeta(os.path.join(ruta_orden, sub))

    # 5. COPIA (no mueve) el Excel y el PDF a la carpeta de la orden.
    copiar_archivo(ruta_xlsx, ruta_orden)
    copiar_archivo(ruta_pdf, ruta_orden)
    # 5b. Extras (imagenes, etc.): todo lo demas que haya en la carpeta vigilada.
    extras = copiar_extras_a_orden(os.path.dirname(ruta_xlsx), ruta_orden, orden_num, config)

    # 6. Supabase.
    guardar_cliente_supabase(cliente_safe, ruta_cliente)

    # 7. Hoja de PRODUCCION: una fila por referencia del EXCEL del pedido.
    for datos in datos_xlsx:
        if datos.get("referencia"):
            guardar_referencia_supabase(datos["referencia"], datos.get("proyecto"))
        datos["cliente"] = cliente_safe
        datos["proyecto"] = proyecto_safe
        datos["orden"] = orden_num
        if production_writer:
            production_writer(datos)
        elif write_google_sheets:
            escribir_google_sheets(datos)

    # 8. CONTROL DE PAGOS COTIZACIONES  -  SOLO si el PDF dice COTIZACION.
    if es_cotizacion and write_google_sheets:
        header_pdf["cliente"] = header_pdf.get("cliente") or cliente
        registrar_pago_cotizacion(header_pdf, config)
    else:
        logging.info(
            f"Orden {orden_num}: el PDF es {header_pdf.get('tipo_doc') or 'SIN TIPO'}, "
            "no se toca la hoja de pagos (solo las COTIZACIONES la tocan)."
        )

    # 9. Borrar los originales de la carpeta vigilada (ya copiados en la orden).
    for ruta in (ruta_xlsx, ruta_pdf, *extras):
        if os.path.exists(ruta):
            archivar_original(ruta)

    return ruta_orden

# ======================================================================
#  HANDLERS DE WATCHDOG
# ======================================================================

class HandlerArchivos(FileSystemEventHandler):
    """El observer solo ENCOLA rutas; un hilo worker aparte las clasifica y procesa.

    NUEVO (parejas): una orden solo se procesa cuando estan PRESENTES el PDF
    (cotizacion/remision) Y su Excel de pedido, emparejados por el numero
    CO####/RM####. Mientras falta una parte, la otra espera en el buffer
    'self.pendientes' (persistido en %TEMP%\\pares_pendientes.json). Si una orden
    queda con una sola parte mas de 'pareja_timeout_min' minutos, se avisa al
    comercial (revisar_huerfanos, llamado desde bucle_principal).

    Se conserva la separacion observer/worker: el I/O de red (Supabase, Sheets,
    Drive, NAS) corre SIEMPRE en el hilo worker, nunca en el del observer.
    """

    MAX_FALLOS_TECNICOS = 6       # reintentos ante ErrorTecnico antes de rendirse
    REINTENTO_TECNICO_SEG = 45    # espera entre reintentos

    def __init__(self, config):
        self.config = config
        self.pareja_timeout = int(config.get("pareja_timeout_min", PAREJA_TIMEOUT_MIN_DEFAULT)) * 60
        self.cola = queue.Queue()
        self.encolados = set()          # rutas ya vistas (en cola / en un slot)
        self.pendientes = {}            # orden -> {"pdf":ruta|None,"xlsx":ruta|None,"visto":epoch,"avisado":bool}
        self.rechazados = {}            # ruta -> mtime (no clasificable / regla incumplida)
        self.fallos_tecnicos = {}       # orden -> n
        self.reintentos_orden = {}      # orden -> epoch en que toca reintentar
        self.procesadas = {}            # orden -> iso ts (anti-duplicado si falla el archivado)
        self.extras = {}                # ruta de extra suelto (imagen, etc.) -> epoch en que se vio
        self.rutas_orden = {}           # orden -> carpeta de la orden en la NAS (solo esta sesion)
        self.ultima_orden = None        # {"orden","ruta","epoch"} de la ultima orden terminada OK
        self._lock = threading.Lock()
        self._cargar_pendientes()
        self._cargar_procesadas()
        self.worker = threading.Thread(
            target=self._bucle_worker, name="worker-archivos", daemon=True
        )
        self.worker.start()

    # ---- persistencia del buffer de parejas -------------------------------
    def _cargar_pendientes(self):
        try:
            with open(str(PARES_PENDIENTES_PATH), "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                self.pendientes = data
        except Exception:
            self.pendientes = {}

    def _guardar_pendientes(self):
        try:
            tmp = str(PARES_PENDIENTES_PATH) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.pendientes, f, ensure_ascii=False, indent=2)
            os.replace(tmp, str(PARES_PENDIENTES_PATH))
        except Exception as e:
            logging.error(f"No se pudo guardar pares_pendientes.json: {e}")

    def _cargar_procesadas(self):
        try:
            with open(str(ORDENES_PROCESADAS_PATH), "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                corte = datetime.now() - timedelta(days=DIAS_MEMORIA_PROCESADAS)
                self.procesadas = {
                    k: v for k, v in data.items()
                    if _parse_iso(v) and _parse_iso(v) >= corte
                }
        except Exception:
            self.procesadas = {}

    def _marcar_procesada(self, orden):
        with self._lock:
            self.procesadas[orden] = datetime.now().isoformat(timespec="seconds")
            try:
                tmp = str(ORDENES_PROCESADAS_PATH) + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self.procesadas, f, ensure_ascii=False, indent=2)
                os.replace(tmp, str(ORDENES_PROCESADAS_PATH))
            except Exception as e:
                logging.error(f"No se pudo guardar ordenes_procesadas.json: {e}")

    def _desmarcar_procesada(self, orden):
        """Saca la orden de 'procesadas' (en memoria y en disco). Se usa cuando
        la fila de esa orden ya no esta en Google Sheets -alguien la borro a
        mano para pedir una correccion- asi el negocio no depende de que
        alguien edite ordenes_procesadas.json a mano para reprocesar."""
        with self._lock:
            self.procesadas.pop(orden, None)
            try:
                tmp = str(ORDENES_PROCESADAS_PATH) + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self.procesadas, f, ensure_ascii=False, indent=2)
                os.replace(tmp, str(ORDENES_PROCESADAS_PATH))
            except Exception as e:
                logging.error(f"No se pudo actualizar ordenes_procesadas.json: {e}")

    def dispatch(self, event):
        _estado["ultimo_evento_fs"] = time.time()
        super().dispatch(event)

    def on_created(self, event):
        if not event.is_directory:
            self._encolar(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._encolar(event.src_path)

    def on_moved(self, event):
        # Renombrar un archivo DENTRO de la carpeta (p.ej. corregir CO6336 -> CO6036)
        # llega como 'moved', no como 'created'. Sin este handler el archivo
        # corregido no se veia hasta reiniciar el monitor (2026-09-14).
        if event.is_directory:
            return
        with self._lock:
            self.encolados.discard(event.src_path)
            for orden, slot in list(self.pendientes.items()):
                for k in ("pdf", "xlsx"):
                    if slot.get(k) == event.src_path:
                        slot[k] = None
                if not slot.get("pdf") and not slot.get("xlsx"):
                    self.pendientes.pop(orden, None)
            self._guardar_pendientes()
        self._encolar(event.dest_path)

    def _encolar(self, ruta):
        nombre = os.path.basename(ruta)
        if nombre.startswith(PREFIJOS_TEMP):
            return  # archivos internos del autotest / prueba de escritura
        if "_PROCESADOS" in ruta.replace("/", os.sep).split(os.sep):
            return  # originales ya archivados
        ext = os.path.splitext(ruta)[1].lower()
        if ext not in self.config["extensiones_permitidas"] and not es_archivo_extra(nombre, self.config):
            return
        with self._lock:
            if ruta in self.encolados:
                return
            self.encolados.add(ruta)
        self.cola.put(ruta)

    def reconciliar_carpeta(self, carpeta):
        """Al arrancar: re-encola lo que quedo suelto en la carpeta vigilada y
        limpia del buffer las rutas que ya no existen."""
        try:
            for nombre in os.listdir(carpeta):
                ruta = os.path.join(carpeta, nombre)
                if os.path.isfile(ruta):
                    self._encolar(ruta)
        except Exception as e:
            logging.error(f"No se pudo reconciliar la carpeta {carpeta}: {e}")
        with self._lock:
            for orden, slot in list(self.pendientes.items()):
                for k in ("pdf", "xlsx"):
                    if slot.get(k) and not os.path.exists(slot[k]):
                        slot[k] = None
                if not slot.get("pdf") and not slot.get("xlsx"):
                    self.pendientes.pop(orden, None)
            self._guardar_pendientes()
        n = len(self.pendientes)
        if n:
            logging.info(f"Reconciliacion: {n} orden(es) esperando su pareja: {', '.join(self.pendientes)}")

    # ---- clasificacion ---------------------------------------------------
    def _clasificar(self, ruta):
        """(orden, tipo) con tipo in {'pdf','xlsx'}. orden=None si no se resuelve.
        Puede lanzar ErrorTecnico si el PDF aun no se puede leer."""
        ext = os.path.splitext(ruta)[1].lower()
        tipo = "pdf" if ext == ".pdf" else "xlsx"
        prefijo, numero = extraer_prefijo_numero_nombre(os.path.basename(ruta))
        if prefijo and numero:
            return f"{prefijo}{numero}", tipo
        if tipo == "pdf":
            _, header, _, _ = extraer_info_pdf(ruta)   # ErrorTecnico si no se puede leer
            if header.get("orden"):
                return header["orden"], tipo
        return None, tipo

    def _bucle_worker(self):
        while True:
            candidatos = []
            try:
                candidatos.append(self.cola.get(timeout=5))
            except queue.Empty:
                pass
            while True:
                try:
                    candidatos.append(self.cola.get_nowait())
                except queue.Empty:
                    break
            _estado["worker_latido"] = time.time()

            for ruta in candidatos:
                try:
                    self._ingresar_candidato(ruta)
                except Exception:
                    logging.exception(f"Worker: error clasificando {ruta}")
                    with self._lock:
                        self.encolados.discard(ruta)

            ahora = time.time()
            listas = []
            with self._lock:
                for orden, slot in self.pendientes.items():
                    if not (slot.get("pdf") and slot.get("xlsx")):
                        continue
                    venc = self.reintentos_orden.get(orden)
                    if venc and venc > ahora:
                        continue
                    listas.append(orden)
            for orden in listas:
                self._procesar_orden(orden)

            try:
                self._despachar_extras()
            except Exception:
                logging.exception("Worker: error repartiendo archivos extra")

    def _despachar_extras(self):
        """Reparte los extras sueltos que NO se llevo una orden al procesarse:
          - limpia los que ya no estan (los copio y borro procesar_orden);
          - si el nombre trae el numero de una orden ya procesada -> a su carpeta;
          - si no, y no hay ninguna orden esperando su pareja, y una orden termino
            hace <= EXTRAS_GRACIA_TARDIO_SEG -> a la carpeta de esa orden (llegaron
            un poco despues que el Excel/PDF);
          - en cualquier otro caso esperan en la carpeta a la proxima orden.
        Un extra debe llevar >= EXTRAS_ASENTAMIENTO_SEG en la carpeta: asi los que
        se sueltan justo antes que su pareja no se le asignan a la orden anterior."""
        if not self.extras:
            return
        ahora = time.time()
        with self._lock:
            hay_pendientes = bool(self.pendientes)
            ultima = dict(self.ultima_orden) if self.ultima_orden else None
            rutas_orden = dict(self.rutas_orden)
        for ruta, visto in list(self.extras.items()):
            if not os.path.exists(ruta):
                self.extras.pop(ruta, None)
                with self._lock:
                    self.encolados.discard(ruta)
                continue
            if ahora - visto < EXTRAS_ASENTAMIENTO_SEG:
                continue
            destino = None
            de_orden = orden_en_nombre(os.path.basename(ruta))
            if de_orden:
                destino = rutas_orden.get(de_orden)
            elif not hay_pendientes and ultima and ahora - ultima["epoch"] <= EXTRAS_GRACIA_TARDIO_SEG:
                destino = ultima["ruta"]
            if not destino:
                continue
            if copiar_extra(ruta, destino) and archivar_original(ruta):
                logging.info(f"Extra '{os.path.basename(ruta)}' copiado a {destino}")
                self.extras.pop(ruta, None)
                with self._lock:
                    self.encolados.discard(ruta)

    def _ingresar_candidato(self, ruta):
        if not os.path.exists(ruta):
            with self._lock:
                self.encolados.discard(ruta)
            return
        try:
            mtime = os.path.getmtime(ruta)
        except OSError:
            with self._lock:
                self.encolados.discard(ruta)
            return
        if os.path.splitext(ruta)[1].lower() not in self.config["extensiones_permitidas"]:
            # Extra (imagen, etc.): no forma pareja. Se anota; se copia a la
            # carpeta de la orden cuando se procese una (procesar_orden) o, si
            # llega justo despues de terminar una, en _despachar_extras().
            if ruta not in self.extras:
                self.extras[ruta] = time.time()
                logging.info(
                    f"Archivo extra '{os.path.basename(ruta)}' recibido; se copiara a la carpeta de la orden."
                )
            return
        if self.rechazados.get(ruta) == mtime:
            return
        with self._lock:
            for slot in self.pendientes.values():
                if ruta in (slot.get("pdf"), slot.get("xlsx")):
                    return  # ya esta ubicado

        if not self._esperar_archivo_estable(ruta):
            with self._lock:
                self.encolados.discard(ruta)   # aun copiandose: reintenta en el proximo barrido
            return

        # Limpia espacios/separadores al inicio o final del nombre (el Excel
        # llega a veces como ' RM7557_...'). Si se renombra, seguimos con la ruta
        # nueva en esta misma pasada: sobre SMB el PollingObserver no siempre ve
        # el rename por si solo.
        ruta_norm = normalizar_nombre_archivo(ruta)
        if ruta_norm != ruta:
            with self._lock:
                self.encolados.discard(ruta)
                self.encolados.add(ruta_norm)
            self.rechazados.pop(ruta, None)
            ruta = ruta_norm
            try:
                mtime = os.path.getmtime(ruta)
            except OSError:
                with self._lock:
                    self.encolados.discard(ruta)
                return

        try:
            orden, tipo = self._clasificar(ruta)
        except ErrorTecnico as e:
            logging.warning(f"{os.path.basename(ruta)} aun no se puede leer ({e}); se reintenta.")
            with self._lock:
                self.encolados.discard(ruta)
            return

        if not orden:
            logging.warning(
                f"No se pudo determinar el numero de orden (CO####/RM####) de "
                f"'{os.path.basename(ruta)}'. Renombralo con el numero para que se empareje."
            )
            self.rechazados[ruta] = mtime
            with self._lock:
                self.encolados.discard(ruta)
            return

        with self._lock:
            ya_hecha = orden in self.procesadas
        if ya_hecha and not _orden_en_sheets(orden):
            logging.info(
                f"Orden {orden} estaba marcada como procesada pero su fila ya no "
                "esta en Google Sheets (se borro a mano); se libera para reprocesar."
            )
            self._desmarcar_procesada(orden)
            ya_hecha = False
        if ya_hecha:
            logging.info(
                f"Orden {orden} ya fue procesada; se elimina el original suelto '{os.path.basename(ruta)}'."
            )
            archivar_original(ruta)
            with self._lock:
                self.encolados.discard(ruta)
            return

        with self._lock:
            slot = self.pendientes.setdefault(
                orden, {"pdf": None, "xlsx": None, "visto": time.time(), "avisado": False}
            )
            slot[tipo] = ruta
            completo = bool(slot.get("pdf") and slot.get("xlsx"))
            self._guardar_pendientes()

        if completo:
            logging.info(f"Orden {orden}: PDF + Excel presentes -> se procesa.")
        else:
            falta = "EXCEL" if tipo == "pdf" else "PDF"
            logging.info(f"Orden {orden}: recibido {tipo.upper()}, esperando el {falta}.")

    def _procesar_orden(self, orden):
        with self._lock:
            slot = self.pendientes.get(orden)
            ruta_pdf = slot.get("pdf") if slot else None
            ruta_xlsx = slot.get("xlsx") if slot else None
        if not ruta_pdf or not ruta_xlsx:
            return
        if not os.path.exists(ruta_pdf) or not os.path.exists(ruta_xlsx):
            with self._lock:
                if slot:
                    if not os.path.exists(ruta_pdf):
                        slot["pdf"] = None
                    if not os.path.exists(ruta_xlsx):
                        slot["xlsx"] = None
                    self._guardar_pendientes()
            return

        _estado["procesando_desde"] = time.time()
        try:
            logging.info(
                f"Procesando orden {orden}: {os.path.basename(ruta_pdf)} + {os.path.basename(ruta_xlsx)}"
            )
            ok = procesar_orden(orden, ruta_pdf, ruta_xlsx, self.config)
            if ok:
                self._marcar_procesada(orden)
            with self._lock:
                if ok:
                    self.rutas_orden[orden] = ok
                    self.ultima_orden = {"orden": orden, "ruta": ok, "epoch": time.time()}
                self.pendientes.pop(orden, None)
                self.reintentos_orden.pop(orden, None)
                self.fallos_tecnicos.pop(orden, None)
                for r in (ruta_pdf, ruta_xlsx):
                    self.encolados.discard(r)
                    if not ok:
                        try:
                            self.rechazados[r] = os.path.getmtime(r)
                        except OSError:
                            pass
                self._guardar_pendientes()
            if ok:
                _estado["procesados_ok"] += 1
                _estado["ultimo_archivo"] = orden
        except ErrorTecnico as e:
            n = self.fallos_tecnicos.get(orden, 0) + 1
            self.fallos_tecnicos[orden] = n
            _estado["procesados_error"] += 1
            if n >= self.MAX_FALLOS_TECNICOS:
                logging.error(
                    f"FALLO TECNICO PERSISTENTE con la orden {orden} ({n} intentos): {e}. "
                    "Se deja para revision manual; los archivos siguen en la carpeta."
                )
                with self._lock:
                    self.pendientes.pop(orden, None)
                    self._guardar_pendientes()
            else:
                logging.warning(
                    f"Fallo tecnico con la orden {orden} (intento {n}/{self.MAX_FALLOS_TECNICOS}); "
                    f"se reintenta en {self.REINTENTO_TECNICO_SEG}s: {e}"
                )
                self.reintentos_orden[orden] = time.time() + self.REINTENTO_TECNICO_SEG
        except Exception:
            logging.exception(f"Error no controlado procesando la orden {orden}")
            _estado["procesados_error"] += 1
            with self._lock:
                for r in (ruta_pdf, ruta_xlsx):
                    try:
                        self.rechazados[r] = os.path.getmtime(r)
                    except OSError:
                        pass
                    self.encolados.discard(r)
                self.pendientes.pop(orden, None)
                self._guardar_pendientes()
        finally:
            _estado["procesando_desde"] = 0.0

    def revisar_huerfanos(self, config):
        """Aviso (una vez) al comercial si una orden lleva demasiado tiempo con
        una sola parte (PDF sin Excel o Excel sin PDF)."""
        ahora = time.time()
        avisar = []
        with self._lock:
            for orden, slot in self.pendientes.items():
                tiene_pdf = bool(slot.get("pdf"))
                tiene_xlsx = bool(slot.get("xlsx"))
                if tiene_pdf == tiene_xlsx or slot.get("avisado"):
                    continue
                if ahora - slot.get("visto", ahora) < self.pareja_timeout:
                    continue
                slot["avisado"] = True
                avisar.append((orden, "EXCEL" if tiene_pdf else "PDF", slot.get("pdf") or slot.get("xlsx")))
            if avisar:
                self._guardar_pendientes()
        for orden, falta, ruta in avisar:
            logging.warning(
                f"Orden {orden}: mas de {self.pareja_timeout // 60} min sin su {falta}; "
                "no se procesa hasta tener el PDF y el Excel."
            )
            try:
                self._avisar_huerfano(orden, falta, ruta, config)
            except Exception:
                logging.exception(f"No se pudo avisar del huerfano {orden}")

    def _avisar_huerfano(self, orden, falta, ruta, config):
        header = {}
        if str(ruta).lower().endswith(".pdf"):
            try:
                _, header, _, _ = extraer_info_pdf(ruta)
            except Exception:
                header = {}
        vendedor = (header or {}).get("vendedor") or ""
        email = buscar_email_vendedor(vendedor) or config.get("smtp_email")
        if not email:
            return
        asunto = f"Orden {orden}: falta el {falta} para procesar"
        cuerpo = (
            f"La orden {orden} llego a la carpeta del Asistente pero falta el {falta}.\n"
            f"El pedido NO se procesa hasta que esten el PDF y el Excel con el mismo numero.\n\n"
            f"Archivo recibido: {os.path.basename(ruta)}\n\n"
            f"Mensaje automatico del Asistente de Trazabilidad Indoor.\n"
        )
        enviar_correo(email, asunto, cuerpo, config)

    def _esperar_archivo_estable(self, ruta, lecturas_iguales=3, espera=1.5, max_intentos=40):
        return esperar_archivo_estable(ruta, lecturas_iguales, espera, max_intentos)

class HandlerClientesNAS(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            return
        nombre = os.path.basename(event.src_path.rstrip("\\/"))
        if not nombre or nombre.upper() == "MAESTROS":
            return
        nombre_safe = sanitize(nombre)
        logging.info(f"Carpeta de cliente detectada en NAS: {nombre} -> subiendo a Supabase")
        guardar_cliente_supabase(nombre_safe, event.src_path)

# ======================================================================
#  ARRANQUE  (validacion de entorno, instancia unica, bucle principal)
# ======================================================================

def calentar_dns(hosts, intentos=5, espera=2):
    for host in hosts:
        for intento in range(1, intentos + 1):
            try:
                socket.getaddrinfo(host, 443)
                logging.info(f"DNS resuelto para {host}")
                break
            except socket.gaierror as e:
                logging.warning(f"DNS aun no resuelve {host} (intento {intento}/{intentos}): {e}")
                if intento < intentos:
                    time.sleep(espera)

def pid_monitor_vivo(pid):
    """True solo si ese PID sigue vivo Y es realmente un monitor_archivos.py.
    Se verifica la linea de comandos para no confundirse con un PID reciclado
    por Windows hacia otro proceso python cualquiera."""
    try:
        pid = int(str(pid).strip())
    except (TypeError, ValueError):
        return False
    if pid <= 0 or pid == os.getpid():
        return False
    # Windows 11 24H2+ ya no incluye wmic: primero se intenta via CIM/PowerShell.
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId={pid}' "
             f"-ErrorAction SilentlyContinue; if ($p) {{ $p.CommandLine }}"],
            capture_output=True, text=True, timeout=20, **_SIN_VENTANA,
        )
        salida = (r.stdout or "").strip()
        if salida:
            return "monitor_archivos.py" in salida
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine", "/format:list"],
            capture_output=True, text=True, timeout=15, **_SIN_VENTANA,
        )
        salida = (r.stdout or "")
        if "CommandLine=" in salida:
            return "monitor_archivos.py" in salida
    except Exception:
        pass
    # Fallback si wmic no esta disponible: al menos confirmar que el PID existe y es python
    try:
        r = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=15, **_SIN_VENTANA,
        )
        return "python" in (r.stdout or "").lower()
    except Exception:
        return False

def ruta_log():
    return str((PID_DIR if _IS_UNC else BASE_DIR) / load_config()["log_file"])

def validar_entorno(config):
    """Devuelve una lista de problemas bloqueantes. Vacia = entorno OK.
    La idea es fallar RUIDOSAMENTE al arrancar en vez de quedar 'vivo pero inutil'."""
    problemas = []

    # 1. El observer TIENE que ser PollingObserver si corremos desde UNC.
    if _IS_UNC and Observer.__name__ != "PollingObserver":
        problemas.append(
            f"Se corre desde ruta UNC pero el Observer es {Observer.__name__}, no "
            "PollingObserver: los eventos de archivo NO llegan por SMB. Revisar el import."
        )

    # 2. Carpeta vigilada: existe y se puede escribir (si no, no hay autotest posible).
    carpeta = config["carpeta_monitoreo"]
    try:
        os.makedirs(carpeta, exist_ok=True)
        prueba = os.path.join(carpeta, f".__wtest__{os.getpid()}.tmp")
        with open(prueba, "w") as f:
            f.write("ok")
        os.remove(prueba)
    except Exception as e:
        problemas.append(f"No se puede escribir en la carpeta vigilada ({carpeta}): {e}")

    # 3. NAS de clientes accesible.
    ruta_clientes = config["ruta_nas_clientes"]
    if not os.path.isdir(ruta_clientes):
        try:
            os.makedirs(ruta_clientes, exist_ok=True)
        except Exception as e:
            problemas.append(f"NAS de clientes inaccesible ({ruta_clientes}): {e}")

    # 4. Credenciales de Google presentes.
    cred = BASE_DIR / config["google_credentials"]
    if not cred.is_file():
        problemas.append(f"Falta el archivo de credenciales de Google: {cred}")

    # 5. Acceso al archivo CONTROL DE PAGOS COTIZACIONES (NO bloquea el arranque:
    #    si falla, las cotizaciones quedan encoladas y se reintentan).
    fid = config.get("pagos_cotizaciones_file_id")
    if not fid:
        logging.warning("config.json no tiene 'pagos_cotizaciones_file_id'; no se registraran pagos de cotizaciones.")
    else:
        try:
            _drive_modified_time(_drive_session(), fid)
            logging.info("Acceso a CONTROL DE PAGOS COTIZACIONES: OK.")
        except Exception as e:
            logging.warning(
                "SIN acceso a CONTROL DE PAGOS COTIZACIONES "
                f"({str(e)[:120]}). Comparte el archivo como Editor con "
                "bot-indoor-sheets@plasma-apex-485302-p0.iam.gserviceaccount.com. "
                "Las cotizaciones se procesaran igual y el registro de pago quedara en cola."
            )

    return problemas

def _latido_fresco(seg=180):
    """True si monitor_health.json se reescribio hace menos de `seg` segundos."""
    try:
        return (time.time() - HEARTBEAT_PATH.stat().st_mtime) < seg
    except Exception:
        return False

def registrar_pid_unico():
    """True si esta instancia puede seguir; False si ya hay otra monitor_archivos.py viva.

    'Viva' = el PID responde como monitor_archivos.py  Y ADEMAS  el latido de salud
    esta fresco. Un monitor.pid viejo cuyo health.json quedo congelado (proceso
    muerto, o el PID reciclado por Windows a otro python) NO cuenta: se toma el
    relevo. Antes, un PID reciclado hacia cualquier python bloqueaba el arranque.
    """
    if PID_PATH.exists():
        try:
            pid_previo = PID_PATH.read_text(encoding="utf-8").strip()
        except Exception:
            pid_previo = ""
        # (2026-09-15) Primero el latido (leer una fecha) y solo si esta fresco
        # se consulta el PID (abre PowerShell, ~1-3 s en frio). Tras encender el
        # PC el latido siempre esta viejo, asi el arranque se ahorra ese paso.
        if pid_previo and _latido_fresco() and pid_monitor_vivo(pid_previo):
            logging.warning(
                f"Ya hay otro monitor_archivos.py vivo (PID {pid_previo}, latido fresco); "
                f"esta instancia (PID {os.getpid()}) se cierra para no duplicar la vigilancia."
            )
            return False
        if pid_previo:
            logging.info(
                f"monitor.pid previo (PID {pid_previo}) sin latido fresco o proceso ausente; "
                "se asume muerto y esta instancia toma el relevo."
            )
    try:
        PID_PATH.unlink(missing_ok=True)
    except Exception:
        pass
    with open(str(PID_PATH), "w") as pf:
        pf.write(str(os.getpid()))
    # Cierre de la ventana de carrera: si dos instancias arrancaron casi a la vez
    # y ambas pasaron el chequeo de arriba, el ultimo que escribio el PID gana y
    # el resto se cierra sin llegar a levantar observers.
    time.sleep(0.4)
    try:
        if PID_PATH.read_text(encoding="utf-8").strip() != str(os.getpid()):
            logging.warning("Otra instancia gano la carrera por monitor.pid; esta se cierra.")
            return False
    except Exception:
        pass
    return True

def _limpiar_pid():
    try:
        if PID_PATH.exists() and PID_PATH.read_text().strip() == str(os.getpid()):
            PID_PATH.unlink()
    except Exception:
        pass

def bucle_principal(config, carpeta, observer, observer_clientes, handler=None):
    """Gira cada LOOP_SEG. Escribe el latido, reintenta alertas y corre el
    autotest periodico. Devuelve 'senal' si lo paro el usuario (Ctrl+C) o
    'fallo' si detecto que el monitoreo dejo de funcionar."""
    contador = 0
    desde_selftest = 0
    fallos_selftest = 0
    try:
        while True:
            time.sleep(LOOP_SEG)
            contador += 1
            desde_selftest += LOOP_SEG

            if not observer.is_alive() or not observer_clientes.is_alive():
                logging.error("Un hilo del observer murio; cerrando para que VIGIA relance.")
                _estado["deteccion_ok"] = False
                escribir_latido(observer, observer_clientes)
                return "fallo"

            if handler is not None and not handler.worker.is_alive():
                logging.error("El hilo de procesamiento murio; cerrando para que VIGIA relance.")
                _estado["deteccion_ok"] = False
                escribir_latido(observer, observer_clientes)
                return "fallo"

            # Worker VIVO pero COLGADO (red o NAS sin responder): el latido lo
            # escribe este hilo, asi que sin este chequeo VIGIA lo veria sano siempre.
            if handler is not None:
                ahora = time.time()
                procesando = _estado.get("procesando_desde") or 0
                latido_w = _estado.get("worker_latido") or 0
                colgado = None
                if procesando and ahora - procesando > MAX_PROCESO_SEG:
                    colgado = f"lleva {int(ahora - procesando)}s con la misma orden"
                elif latido_w and ahora - latido_w > MAX_WORKER_SEG:
                    colgado = f"sin latido hace {int(ahora - latido_w)}s"
                if colgado:
                    logging.error(f"El hilo de procesamiento esta COLGADO ({colgado}); cerrando para que VIGIA relance.")
                    _estado["deteccion_ok"] = False
                    escribir_latido(observer, observer_clientes)
                    return "fallo"

            if contador % REINTENTO_ALERTAS == 0:
                try:
                    reintentar_alertas_pendientes(config)
                except Exception:
                    logging.exception("Error reintentando alertas pendientes")
                try:
                    reintentar_registros_pendientes(config)
                except Exception:
                    logging.exception("Error reintentando registros pendientes (Supabase/Sheets)")
                if handler is not None:
                    try:
                        handler.revisar_huerfanos(config)
                    except Exception:
                        logging.exception("Error revisando ordenes sin pareja")

            if desde_selftest >= SELFTEST_SEG:
                desde_selftest = 0
                # Si justo hay un archivo procesandose, el observer podria tardar
                # en 'ver' el señuelo aunque este sano: no se cuenta como fallo.
                procesando = _estado.get("procesando_desde") or 0
                if procesando and (time.time() - procesando) < 180:
                    logging.info("Autotest pospuesto: hay un archivo en proceso.")
                elif autotest_deteccion(carpeta):
                    fallos_selftest = 0
                    _estado["deteccion_ok"] = True
                else:
                    fallos_selftest += 1
                    # Un fallo puntual (blip de la NAS al escribir el señuelo) se
                    # tolera; dos seguidos si son motivo de reinicio.
                    if fallos_selftest >= 2:
                        _estado["deteccion_ok"] = False
                        escribir_latido(observer, observer_clientes)
                        return "fallo"
                    logging.warning(
                        f"Autotest fallido ({fallos_selftest}/2); se tolera y se reintenta al proximo ciclo."
                    )
                escribir_latido(observer, observer_clientes)

            escribir_latido(observer, observer_clientes)
    except KeyboardInterrupt:
        logging.info("Deteniendo asistente (Ctrl+C)...")
        return "senal"

def _instalar_diagnostico_de_cierre():
    """Deja rastro de COMO termina el proceso (hubo muertes sin nada en el log):
      - crash nativo            -> traza en %TEMP%\\monitor_fatal.log (faulthandler)
      - cierre de consola/sesion/apagado de Windows -> WARNING en el log
      - salida por codigo       -> 'terminando' en el log (atexit)
    Si no aparece NINGUNA de las tres, lo mato otro proceso desde afuera."""
    import atexit
    import faulthandler
    try:
        f = open(str(PID_DIR / "monitor_fatal.log"), "a", encoding="utf-8")
        f.write(f"--- {datetime.now().isoformat(timespec='seconds')} PID {os.getpid()} arranca ---\n")
        f.flush()
        faulthandler.enable(file=f, all_threads=True)
        globals()["_fatal_log"] = f   # referencia viva: si el GC lo cierra, faulthandler queda mudo
    except Exception as e:
        logging.warning(f"No se pudo activar faulthandler: {e}")

    atexit.register(lambda: logging.info(f"Proceso {os.getpid()} terminando (salida normal por codigo)."))

    if os.name == "nt":
        try:
            import ctypes
            nombres = {0: "CTRL_C", 1: "CTRL_BREAK", 2: "CIERRE DE CONSOLA", 5: "CIERRE DE SESION", 6: "APAGADO DEL PC"}

            @ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_uint32)
            def _aviso_ctrl(tipo):
                logging.warning(f"Windows envio {nombres.get(tipo, tipo)} al proceso {os.getpid()}; se va a cerrar.")
                for h in logging.getLogger().handlers:
                    try:
                        h.flush()
                    except Exception:
                        pass
                return False   # que siga el manejo normal (KeyboardInterrupt / cierre)

            ctypes.windll.kernel32.SetConsoleCtrlHandler(_aviso_ctrl, True)
            globals()["_aviso_ctrl"] = _aviso_ctrl   # que ctypes no libere el callback
        except Exception as e:
            logging.warning(f"No se pudo registrar el aviso de cierre de Windows: {e}")

def main():
    config = load_config()
    log_path = ruta_log()
    setup_logging(log_path)

    logging.info("=" * 60)
    logging.info("ASISTENTE DE TRAZABILIDAD INDOOR - INICIANDO")
    logging.info(f"PID {os.getpid()}  |  Observer: {Observer.__name__}(timeout={POLL_INTERVAL}s)")
    logging.info(f"Log real de esta sesion: {log_path}")
    logging.info(f"Latido de salud        : {HEARTBEAT_PATH}")
    _instalar_diagnostico_de_cierre()

    # --- instancia unica --------------------------------------------------
    if not registrar_pid_unico():
        return
    escribir_latido()  # deja el health.json cuanto antes para que VIGIA no lo mate durante el arranque

    # Latido de ARRANQUE: mientras corren los pasos lentos y bloqueantes del
    # arranque (calentar DNS, y sobre todo el snapshot inicial de \\...\CLIENTES,
    # que sobre SMB puede tardar >1 min), un hilo aparte refresca health.json cada
    # 5 s. Asi VIGIA nunca ve el archivo 'congelado' y no relanza a mitad del
    # arranque. Se detiene justo antes de entrar al bucle principal.
    _hb_arranque_stop = threading.Event()
    def _hb_arranque():
        while not _hb_arranque_stop.is_set():
            escribir_latido()
            _hb_arranque_stop.wait(5)
    threading.Thread(target=_hb_arranque, name="latido-arranque", daemon=True).start()

    # --- validacion de entorno (fallar ruidosamente) --------------------
    problemas = validar_entorno(config)
    if problemas:
        for p in problemas:
            logging.error(f"ENTORNO INVALIDO: {p}")
        logging.error("El asistente NO puede operar; se cierra. VIGIA reintentara en unos minutos.")
        _estado["deteccion_ok"] = False
        escribir_latido()
        _limpiar_pid()
        sys.exit(1)

    calentar_dns(DNS_HOSTS)

    # Vaciar de una vez lo que haya quedado pendiente de una caida anterior de
    # Supabase / Google Sheets, sin esperar al primer ciclo de reintento.
    try:
        reintentar_registros_pendientes(config)
    except Exception:
        logging.exception("Error procesando registros pendientes al arrancar")

    carpeta = config["carpeta_monitoreo"]
    carpeta_clientes = config["ruta_nas_clientes"]
    _estado["arranque"] = datetime.now().isoformat(timespec="seconds")

    # --- observers ------------------------------------------------------
    handler = HandlerArchivos(config)
    observer = Observer(timeout=POLL_INTERVAL)
    observer.schedule(handler, carpeta, recursive=False)
    observer.start()

    handler_clientes = HandlerClientesNAS()
    observer_clientes = Observer(timeout=POLL_INTERVAL)
    observer_clientes.schedule(handler_clientes, carpeta_clientes, recursive=False)
    observer_clientes.start()

    # Re-encola lo que quedo suelto en la carpeta (parejas incompletas de una
    # ejecucion anterior, o archivos dejados mientras el monitor estaba caido).
    try:
        handler.reconciliar_carpeta(carpeta)
    except Exception:
        logging.exception("Error en la reconciliacion inicial de la carpeta")

    logging.info("=" * 60)
    logging.info(f"Vigilando pedidos en : {carpeta}")
    logging.info(f"Vigilando clientes en: {carpeta_clientes}")
    logging.info(f"Supabase             : {config['supabase_url']}")
    logging.info("=" * 60)

    # --- autotest inicial: confirmar que el observer VE la carpeta ------
    #  Se reintenta un par de veces: un fallo puntual de la NAS al escribir el
    #  señuelo no significa que el monitoreo este ciego.
    _estado["deteccion_ok"] = False
    for intento in range(1, 4):
        if autotest_deteccion(carpeta):
            _estado["deteccion_ok"] = True
            break
        logging.warning(f"Autotest inicial fallido (intento {intento}/3); reintentando...")
        time.sleep(3)
    escribir_latido(observer, observer_clientes)
    if not _estado["deteccion_ok"]:
        logging.error("El observer no supero el autotest inicial; cerrando para que VIGIA relance.")
        observer.stop(); observer_clientes.stop()
        _limpiar_pid()
        sys.exit(1)

    logging.info("ASISTENTE ACTIVO Y VERIFICADO")

    _hb_arranque_stop.set()  # el bucle principal toma el relevo del latido

    # --- bucle principal ----------------------------------------------
    motivo = bucle_principal(config, carpeta, observer, observer_clientes, handler)

    observer.stop(); observer_clientes.stop()
    # join con tope: si la NAS no responde, un observer puede quedar trabado en
    # un listdir y un join() sin tope dejaria el proceso vivo para siempre.
    observer.join(timeout=15); observer_clientes.join(timeout=15)
    _limpiar_pid()

    if motivo == "fallo":
        logging.error("El asistente se cierra por fallo de monitoreo (exit 1 -> VIGIA relanza).")
        # os._exit y no sys.exit: el worker puede seguir bloqueado en red/NAS y el
        # cierre normal del interprete podria quedarse esperandolo.
        for h in logging.getLogger().handlers:
            try:
                h.flush()
            except Exception:
                pass
        os._exit(1)
    logging.info("Asistente detenido limpiamente.")

if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        logging.exception("El asistente se detuvo por un error no controlado")
        try:
            _estado["deteccion_ok"] = False
            escribir_latido()
        except Exception:
            pass
        _limpiar_pid()
        raise
