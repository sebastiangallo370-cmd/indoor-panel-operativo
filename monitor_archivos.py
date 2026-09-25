"""
Servidor_Reprogramacion  -  monitor_archivos.py
===============================================
(arranca con Servidor_Reprogramacion.vbs)

COPIA "REPROGRAMACIONES AUTOMATICAS"  -  SOLO PDF  (2026-09-14)
Vigila su carpeta REPROGRAMACIONES. A diferencia del original de la NAS, aqui
NO hay pareja Excel + PDF: cada PDF (cotizacion/remision) CO####/RM#### se
procesa SOLO, en cuanto llega:
  - crea la estructura de carpetas del cliente, copia ahi el PDF, sube a
    Supabase y ESCRIBE LAS FILAS DE LA HOJA DE PRODUCCION (una por referencia,
    con los items del PDF);
  - si es una COTIZACION, ademas registra la fila en CONTROL DE PAGOS
    COTIZACIONES (un PDF de REMISION no toca esa hoja).
Los Excel que caigan en la carpeta se ignoran (config: extensiones_permitidas).


LECCIONES APRENDIDAS  (por que el codigo esta armado asi - NO revertir)
----------------------------------------------------------------------
1. La carpeta vigilada vive en una ruta de RED (UNC \\\\192.168.0.120\\...).
   watchdog.Observer (ReadDirectoryChangesW) NO recibe eventos sobre SMB, asi
   que los archivos soltados nunca se detectaban aunque el proceso siguiera vivo.
   -> Se usa SIEMPRE PollingObserver.  validar_entorno() aborta el arranque si
      algun dia el import vuelve a quedar en el Observer nativo.

2. Corriendo desde UNC, Python no escribe de forma fiable al lado del script.
   Todo lo volatil (log, pid, estado de salud) va a  %TEMP%  -> ver PID_DIR.
   (Copia REPROGRAMACIONES: a %TEMP%\\Servidor_Reprogramacion, propia.)
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
   EXCEPCION: en ESTA copia (REPROGRAMACIONES, solo PDF) las filas de
   produccion salen A PROPOSITO de los items del PDF, porque no llega Excel.

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

8. REF / DESCRIPCION EN VARIOS RENGLONES (copia REPROGRAMACIONES, 2026-09-14):
   en el PDF la celda REF se parte ('A50CA01M-' / 'A50PT01M', 'A2100-502C' /
   'H01M', 'A100PE03F' / '- A7200SHT0' / '1F') y el 2do renglon se leia como
   TALLA: la REF quedaba cortada (RM7578, RM7585, CO6045, RM7514...). Ahora la
   tabla se lee POR COLUMNAS con la posicion X de cada palabra (_lineas_pdf):
   lo que cae en la columna REF se pega al REF sin espacios, lo de DESCRIPCION
   va a la descripcion y lo de otras columnas se ignora. Ver parsear_items_pdf().

9. SIN ESPERA DE IMAGENES (2026-09-15): antes el bot esperaba 60 s sin archivos
   nuevos en la carpeta para que el comercial alcanzara a soltar las imagenes
   de los diseños junto al PDF. Ya no: el PDF se procesa en cuanto termina de
   copiarse y la imagen de cada diseño que pide (REF + D#) se saca de
   CLIENTES\\<cliente>\\MAESTROS\\<proyecto>  -> ver buscar_imagenes_maestros().
   Esas imagenes se COPIAN a la orden y JAMAS se borran de MAESTROS; solo se
   borran las que estaban en la carpeta vigilada.


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
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

import io
import queue
import threading
import subprocess
import smtplib
from email.mime.text import MIMEText
import openpyxl
from PIL import Image as PILImage, ImageOps
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
# Copia REPROGRAMACIONES: todo lo volatil va a SU PROPIA carpeta. En local: la
# subcarpeta OCULTA _estado (ver _asegurar_carpeta_estado). Desde la NAS (UNC):
# %TEMP%\Servidor_Reprogramacion, NUNCA %TEMP% a secas, porque ahi viven el
# pid/health/log del PROGRAMADOR AUTOMATICO original en este mismo PC.
PID_DIR = _LOCAL_WORK / "Servidor_Reprogramacion" if _IS_UNC else BASE_DIR / "_estado"

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
PARES_PENDIENTES_PATH = PID_DIR / "pares_pendientes.json"  # PDFs esperando (re)intento de proceso
ORDENES_PROCESADAS_PATH = PID_DIR / "ordenes_procesadas.json"  # anti-duplicado tras archivar
DIAS_MEMORIA_PROCESADAS = 21      # cuanto se recuerda una orden ya procesada
DNS_HOSTS = [
    "oolxeihvydqnszmnthzs.supabase.co",
    "sheets.googleapis.com",
    "www.googleapis.com",
]
PREFIJOS_TEMP = (".__selftest__", ".__wtest__")  # archivos internos, nunca se procesan
# Copia REPROGRAMACIONES: tablas PROPIAS en Supabase (prefijo reprog_) para que
# este bot y el PROGRAMADOR AUTOMATICO de la NAS no se mezclen datos (2026-09-14).
# reprog_telas y reprog_vendedores se copiaron una vez desde telas/vendedores.
TABLA_CLIENTES    = "reprog_clientes"
TABLA_REFERENCIAS = "reprog_referencias"
TABLA_TELAS       = "reprog_telas"
TABLA_VENDEDORES  = "reprog_vendedores"


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
    "listo": False,            # True cuando el arranque termino y paso el autotest (el .vbs lo espera para avisar)
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
    get_supabase().table(TABLA_CLIENTES).upsert(payload, on_conflict="nombre").execute()

def guardar_cliente_supabase(nombre, carpeta_nas=None):
    payload = {"nombre": nombre.upper().strip(), "carpeta_nas": carpeta_nas}
    if con_reintentos(f"Guardar cliente '{nombre}' en Supabase", lambda: _op_cliente_supabase(payload)):
        logging.info(f"Cliente guardado en Supabase: {nombre}")
    else:
        encolar_registro_pendiente("cliente", payload, nombre)

def _op_referencia_supabase(payload):
    get_supabase().table(TABLA_REFERENCIAS).upsert(payload, on_conflict="codigo").execute()

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
                r = supa.table(TABLA_TELAS).select("codigo, nombre").execute()
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
            r = supa.table(TABLA_VENDEDORES).select("nombre, email").execute()
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

# Trozo de REF partida en varios renglones: 'A50PT01M', 'A100CA01M-', '-',
# '-2100FUT11', 'H01M', '4-1', '1F' (codigos alfanumericos unidos por guiones).
REF_TROZO_RE = re.compile(r"^-?[A-Z0-9]+(?:-[A-Z0-9]+)*-?$|^-$")

def _limpiar_descripcion(texto):
    """Quita genero y diseno de la descripcion. El '\\.?' evita que 'MASC.' deje
    un punto huerfano ('UNIFORME DEP. . QATAR')."""
    texto = re.sub(r"\b(MASCULINO|MASC|MAC|FEMENINO|FEM)\b\.?", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"D\d+\.", "", texto)
    return re.sub(r"\s+", " ", texto).strip()

def _lineas_pdf(pdf):
    """Renglones del PDF con la POSICION de cada palabra: [(texto, palabras, n_pagina)].
    Cada palabra es el dict de pdfplumber (text, x0, x1, top). Permite saber en
    que COLUMNA (REF o DESCRIPCION) cae cada trozo de un renglon de continuacion."""
    lineas = []
    for n_pag, page in enumerate(pdf.pages, 1):
        renglon, top = [], None
        for w in sorted(page.extract_words(), key=lambda p: (p["top"], p["x0"])):
            if renglon and abs(w["top"] - top) > 3:
                renglon.sort(key=lambda p: p["x0"])
                lineas.append((" ".join(p["text"] for p in renglon), renglon, n_pag))
                renglon = []
            if not renglon:
                top = w["top"]
            renglon.append(w)
        if renglon:
            renglon.sort(key=lambda p: p["x0"])
            lineas.append((" ".join(p["text"] for p in renglon), renglon, n_pag))
    return lineas

def _partir_renglon_item(palabras):
    """Parte el renglon de un item en (ref, descripcion, x_desc, x_cant), o None.

    palabras[0] es el numero de item y palabras[1] el inicio del REF. Tambien son
    REF los guiones sueltos y los codigos unidos por guion que siguen
    ('A50CA01M' '-' -> 'A50CA01M-'), pero NO la primera palabra de la
    descripcion. La descripcion llega hasta la CANTIDAD, que es la palabra justo
    antes del primer precio ('$...' o '($...)'). x_desc / x_cant = donde
    empiezan las columnas DESCRIPCION y CANT en este PDF."""
    i_precio = next((i for i, w in enumerate(palabras)
                     if i >= 3 and w["text"].lstrip("(").startswith("$")), None)
    if i_precio is None:
        return None
    i_cant = i_precio - 1
    ref = palabras[1]["text"].upper()
    i = 2
    while i < i_cant:
        t = palabras[i]["text"].upper()
        if (REF_TROZO_RE.match(t) and (t.startswith("-") or ref.endswith("-"))
                and (t == "-" or any(c.isdigit() for c in t))):
            ref += t
            i += 1
        else:
            break
    desc = " ".join(w["text"] for w in palabras[i:i_cant])
    x_desc = palabras[i]["x0"] if i < i_cant else palabras[i - 1]["x1"] + 3
    return ref, desc, x_desc, palabras[i_cant]["x0"]

def _continuacion_por_columnas(actual, palabras, x_desc, x_cant):
    """Renglon de continuacion leido POR COLUMNAS (ver LECCIONES APRENDIDAS #8):
      - lo que cae en la columna REF se pega al REF SIN espacios
        ('A50CA01M-' + 'A50PT01M', 'A2100-502C' + 'H01M', 'A11300CA0' + '4-1');
      - lo que cae en DESCRIPCION es una talla (solo si trae una talla conocida)
        o la cola de la descripcion ('CA01-PT12' es descripcion, no talla);
      - lo de las demas columnas (p.ej. un descuento '($57,500)' partido en 2
        renglones) se ignora."""
    trozo_ref = "".join(w["text"] for w in palabras if w["x1"] < x_desc - 1).upper()
    desc = " ".join(w["text"] for w in palabras if x_desc - 2 <= w["x0"] < x_cant - 1)
    if trozo_ref and not actual["tallas"] and REF_TROZO_RE.match(trozo_ref):
        actual["ref"] += trozo_ref
    if not desc:
        return
    talla = parsear_talla_linea(desc.upper())
    if talla and talla["talla"] in TALLAS_CONOCIDAS:
        actual["tallas"].append(talla)
    elif not actual["tallas"]:
        _fusionar_continuacion_item(actual, desc, pegar_ref=False)

def _fusionar_continuacion_item(actual, linea, pegar_ref=True):
    """Une a `actual` una linea de continuacion: en el PDF la celda REF/DESCRIPCION
    se parte en 2 renglones cuando el texto es largo (p.ej. item 4 del ejemplo:
    1er renglon '... CHAQUETA DEPORTIVA PREMIUM MASC', 2do renglon 'H01 D1.').
    El sufijo del diseno (D1./D2./...) y/o el genero suelen caer en ese 2do
    renglon, por eso antes se emitia un falso aviso 'se asumio D1' y la remision
    entera se rechazaba.
    pegar_ref=False cuando la linea ya trae SOLO la columna DESCRIPCION (lector
    por columnas): la cola del REF ya se pego por su posicion."""
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

    extra = _limpiar_descripcion(cont)
    if not extra:
        return
    toks = extra.split(" ")
    # El primer token suele ser la cola del REF (codigo corto con digitos, p.ej.
    # 'H01'); se pega al REF, el resto es cola de la descripcion.
    if pegar_ref and toks and SEGMENTO_RE.match(toks[0]) and len(toks[0]) <= 6 and any(c.isdigit() for c in toks[0]):
        actual["ref"] = (actual["ref"] + toks[0]).upper()
        toks = toks[1:]
    cola = " ".join(toks).strip()
    if cola:
        actual["descripcion_base"] = (actual["descripcion_base"] + " " + cola).strip()


def parsear_items_pdf(texto, warnings=None, lineas=None):
    """Items del PDF. Con `lineas` (de _lineas_pdf) lee la tabla POR COLUMNAS: la
    REF y la DESCRIPCION pueden ocupar varios renglones y cada trozo va a su
    columna segun su posicion X (LECCIONES APRENDIDAS #8). Sin `lineas`, modo
    texto de siempre."""
    if warnings is None:
        warnings = []
    por_columnas = lineas is not None
    if not por_columnas:
        lineas = [(l, None, None) for l in texto.split("\n")]
    items = []
    actual = None
    x_desc = x_cant = top_ult = None
    en_tabla = not por_columnas
    pag_tabla = None
    for texto_linea, palabras, n_pag in lineas:
        linea = texto_linea.strip()
        if not linea:
            continue
        if por_columnas:
            up = linea.upper()
            if "DESCRIPCI" in up and "REF" in up:
                en_tabla, pag_tabla = True, n_pag   # encabezado de la tabla (se repite en cada pagina)
                continue
            if n_pag != pag_tabla:
                # Cabecera de otra pagina (cliente, telefono...): nada de eso es del item.
                en_tabla, actual = False, None
            if not en_tabla:
                continue
        m = ITEM_PDF_RE.match(linea)
        if m:
            ref = m.group(2).upper()
            descripcion_full = m.group(3)
            if por_columnas:
                top_ult = palabras[0]["top"]
                partes = _partir_renglon_item(palabras)
                if partes:
                    ref, descripcion_full, x_desc, x_cant = partes
            genero = normalizar_genero(descripcion_full)
            diseno = 1
            m_dis = re.search(r"D(\d)\.", descripcion_full)
            diseno_explicito = bool(m_dis)
            if m_dis:
                diseno = int(m_dis.group(1))
            actual = {
                "item": int(m.group(1)),
                "ref": ref,
                "descripcion_base": _limpiar_descripcion(descripcion_full),
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
        if por_columnas and x_desc is not None:
            top = palabras[0]["top"]
            if top - top_ult > 16:
                # Las continuaciones van pegadas (~10 pt). Un salto mayor ya no es
                # la celda de este item (pie de pagina, datos de pago...).
                actual = None
                continue
            top_ult = top
            _continuacion_por_columnas(actual, palabras, x_desc, x_cant)
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

def _monto_pdf(txt):
    """Monto del PDF -> numero: '$63,025.22' -> 63025.22 ; '$470,000' -> 470000 ;
    '63.025,22' -> 63025.22. El separador DECIMAL es el ultimo '.' o ',' seguido de
    1-2 digitos al final; los demas son de miles. (Antes se borraba todo lo que no
    fuera digito: '$63,025.22' quedaba 6302522, 100 veces el valor -> fila 180 de
    CONTROL DE PAGOS COTIZACIONES, CO6040, 2026-09-14.)"""
    txt = (txt or "").strip().rstrip(".,")
    m = re.match(r"^(.*?)[.,](\d{1,2})$", txt)
    if m:
        valor = float(f"{re.sub(r'[^0-9]', '', m.group(1)) or '0'}.{m.group(2)}")
    else:
        d = re.sub(r"[^0-9]", "", txt)
        if not d:
            return None
        valor = float(d)
    return int(valor) if valor == int(valor) else round(valor, 2)

def extraer_info_pdf(ruta):
    try:
        with pdfplumber.open(ruta) as pdf:
            texto = "\n".join(page.extract_text() or "" for page in pdf.pages)
            lineas = _lineas_pdf(pdf)   # posiciones, para leer la tabla por columnas
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
        # 1ro el TITULO del documento: la linea que empieza con COTIZACION o
        # REMISION (DE VENTA). Manda sobre el nombre del archivo: CO7583 venia
        # nombrado CO pero el PDF decia "REMISION DE VENTA" (2026-09-14).
        m_titulo = re.search(r"^\s*(COTIZACI[OÓ]N|REMISI[OÓ]N)\b", texto_up, re.MULTILINE)
        if m_titulo:
            tipo_doc = "COTIZACION" if m_titulo.group(1).startswith("COTIZ") else "REMISION"
        elif "COTIZACI" in texto_up and "REMISI" not in texto_up:
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
            return _monto_pdf(vals[-1])   # respeta los centavos (ver _monto_pdf)

        subtotal   = _ultimo_monto(r"SUBTOTAL")
        total_neto = _ultimo_monto(r"TOTAL\s+NETO")

        nombre_arch = os.path.basename(ruta)
        prefijo, numero_nombre = extraer_prefijo_numero_nombre(nombre_arch)
        # CO/RM lo decide el TIPO del PDF (pedido del usuario: "CO si es cotizacion,
        # RM si es remision"); el prefijo del nombre del archivo solo si no se sabe.
        if tipo_doc in ("COTIZACION", "REMISION"):
            prefijo = "CO" if tipo_doc == "COTIZACION" else "RM"
        elif not prefijo:
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
        items = parsear_items_pdf(texto, warnings, lineas)
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
#  EXCEL DEL LISTADO DE PRODUCCION  (una pestaña por referencia)
# ======================================================================
# Copia REPROGRAMACIONES (2026-09-14): aqui no llega el Excel del pedido, asi que
# el bot lo ARMA desde FORMATO_EXCEL.xlsx (hoja REFERENCIA) con las reglas de la
# skill remision-produccion-tabs:
#   - una pestaña por FAMILIA de REF (el codigo sin los digitos finales:
#     A200FUT01 y A200FUT02 -> A200FUT). La pestaña se llama con el codigo REF,
#     o con la familia si junta varias REF;
#   - dentro de la pestaña cada DISEÑO va en su propio bloque (D1, luego D2...);
#   - una fila por prenda: TALLA y NUMERO del PDF, NOMBRE DORSAL en blanco (lo
#     llena el cliente/produccion despues);
#   - "X" en DISEÑO 1-4 (K-N) y en MASC/FEM (O/P);
#   - encabezado (cliente, proyecto, comercial, entrega) igual en todas las
#     pestañas y titulo F2 = "CODIGO - DESCRIPCION";
#   - NUNCA se insertan filas: se escribe sobre las filas 8..507 que ya trae la
#     plantilla (sus formulas de conteo miran D8:D507).
# El Excel lo arma EXCEL (COM), no openpyxl: la hoja REFERENCIA se duplica tal
# cual y el bot SOLO escribe datos e inserta imagenes; el formato queda identico
# a FORMATO_EXCEL.xlsx (pedido del usuario, 2026-09-14).
#
# Imagenes de diseño (2026-09-15): el bot NO las espera. Las busca en
# CLIENTES\<cliente>\MAESTROS\<proyecto = Garantia del PDF> y sus subcarpetas,
# con nombre REFERENCIA_DISEÑO_MAQUINA (PE03_D1_GT; la maquina se ignora), y
# pone la del diseño que pide cada item (A200PE03 ... D1. -> PE03_D1_GT.jpg).
# Si el comercial igual deja una imagen asi junto al PDF, esa manda. Van
# centradas y sin deformar en el recuadro DISEÑO 1-4 (S3:W27, Y3:AC27, AE3:AI27,
# AK3:AO27) de la pestaña de esa REF (ver _imagen_es_de_ref).

FORMATO_EXCEL_PATH = BASE_DIR / "FORMATO_EXCEL.xlsx"
HOJA_PLANTILLA     = "REFERENCIA"
HOJA_BASE_DATOS    = "BASE_DATOS"
FILA_PRIMER_DATO   = 8
FILA_ULTIMO_DATO   = 507
COL_DISENO = {1: "K", 2: "L", 3: "M", 4: "N"}
COL_GENERO = {"MASC": "O", "FEM": "P"}
_CARACTERES_NO_HOJA_RE = re.compile(r"[\[\]:*?/\\]")
EXT_IMAGENES = (".png", ".jpg", ".jpeg")
IMAGEN_DISENO_RE = re.compile(r"^(?P<ref>[A-Z0-9\-]+)_D(?P<diseno>[1-4])(?:_.*)?$")
CAJA_DISENO = {1: ("S", "W"), 2: ("Y", "AC"), 3: ("AE", "AI"), 4: ("AK", "AO")}
FILAS_CAJA_DISENO = (3, 27)
# Respiro entre la imagen y el borde del recuadro. 8 pt y no menos: Excel guarda
# la imagen amarrada a las celdas y al abrir el archivo recalcula su tamaño con
# los altos de fila redondeados a pixeles (la plantilla esta en zoom 80%); eso
# la agranda o achica hasta ~1% (4-5 pt). Con 8 pt nunca se sale del recuadro.
MARGEN_CAJA_PT = 8

def buscar_imagenes_diseno(carpeta, refs):
    """Imagenes de diseño que el comercial dejo en la carpeta vigilada para las
    REF de este pedido: {ref_del_pdf: {diseno: ruta}}. Las que son de otro pedido
    (su REF no coincide) se quedan en la carpeta para el suyo."""
    refs = list(dict.fromkeys(r.upper() for r in refs))
    encontradas = {}
    try:
        nombres = sorted(os.listdir(carpeta))
    except OSError as e:
        logging.error(f"No se pudo listar {carpeta} buscando imagenes de diseño: {e}")
        return encontradas
    for nombre in nombres:
        base, ext = os.path.splitext(nombre)
        if ext.lower() not in EXT_IMAGENES or nombre.startswith(PREFIJOS_TEMP):
            continue
        m = IMAGEN_DISENO_RE.match(base.strip().upper())
        if not m:
            logging.warning(f"Imagen '{nombre}' no sigue el formato REFERENCIA_D#_MAQUINA (ej. FUT01_D1_GT); se deja en la carpeta.")
            continue
        for ref in (r for r in refs if _imagen_es_de_ref(m.group("ref"), r)):
            encontradas.setdefault(ref, {}).setdefault(int(m.group("diseno")), os.path.join(carpeta, nombre))
    return encontradas

def _imagen_es_de_ref(ref_imagen, ref):
    """True si la imagen REFERENCIA_D# es de esa REF del PDF: su codigo aparece en
    la REF sin una letra justo antes ni un digito justo despues
    (PE03 -> A200PE03 y A100PE03F; no E03, no PE031)."""
    return re.search(r"(?<![A-Z])" + re.escape(ref_imagen) + r"(?!\d)", ref) is not None

def _norm_nombre(texto):
    """'Corporación  Deportiva Inter-Club' -> 'CORPORACION DEPORTIVA INTER CLUB':
    sin tildes, en mayusculas y cualquier signo como un solo espacio."""
    texto = unicodedata.normalize("NFKD", texto or "")
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]+", " ", texto.upper()).strip()

def _subcarpeta_parecida(padre, nombre, contener=False):
    """Subcarpeta de `padre` que corresponde a `nombre` sin importar tildes,
    mayusculas ni signos. Con contener=True, si ninguna es igual acepta la UNICA
    que contenga al nombre (o este contenida en el) por palabras completas."""
    objetivo = _norm_nombre(nombre)
    if not objetivo:
        return None
    try:
        subs = [e.name for e in os.scandir(padre) if e.is_dir()]
    except OSError as e:
        logging.warning(f"No se pudo listar {padre}: {e}")
        return None
    for s in subs:
        if _norm_nombre(s) == objetivo:
            return os.path.join(padre, s)
    if contener:
        parecidas = [
            s for s in subs if _norm_nombre(s)
            and (f" {objetivo} " in f" {_norm_nombre(s)} " or f" {_norm_nombre(s)} " in f" {objetivo} ")
        ]
        if len(parecidas) == 1:
            return os.path.join(padre, parecidas[0])
    return None

def buscar_imagenes_maestros(ruta_cliente, cliente, proyecto, items):
    """Imagenes de diseño de la carpeta MAESTROS del cliente para lo que PIDE el
    PDF: {ref: {diseno: ruta}}, solo los pares (REF, D#) de sus items.

    Busca en  CLIENTES\\<cliente>\\MAESTROS\\<proyecto (Garantia del PDF)>  y todas
    sus subcarpetas: 'A200PE03 PETO VOLEIBOL FEM D1.' con Garantia VOLEIBOL 2026
    -> MAESTROS\\VOLEIBOL 2026\\PE03_D1_D2\\PE03_D1_GT.jpg. SOLO en la carpeta del
    PROYECTO: el mismo PE03_D1 existe en otros proyectos del cliente (TORNEO
    VOLEY) con otro diseño. Varias imagenes para el mismo par (GT / JET) -> la
    mas reciente. Estas imagenes nunca se mueven ni se borran: son los maestros."""
    pedidos = {(it["ref"].upper(), it["diseno"]) for it in items}
    encontradas = {}
    if not pedidos:
        return encontradas

    # La carpeta del cliente es la de la orden; si no tiene el proyecto en
    # MAESTROS se prueba la que se llame igual sin tildes/signos.
    carpeta = None
    for carpeta_cliente in dict.fromkeys(
            [ruta_cliente, _subcarpeta_parecida(os.path.dirname(ruta_cliente), cliente)]):
        maestros = _subcarpeta_parecida(carpeta_cliente, "MAESTROS") if carpeta_cliente else None
        carpeta = _subcarpeta_parecida(maestros, proyecto, contener=True) if maestros else None
        if carpeta:
            break
    if not carpeta:
        logging.warning(
            f"Imagenes de diseño: no se encontro la carpeta del proyecto '{proyecto}' en "
            f"MAESTROS de '{cliente}'; el listado queda sin imagenes."
        )
        return encontradas

    mtimes = {}
    for raiz, _, archivos in os.walk(carpeta):
        for nombre in archivos:
            base, ext = os.path.splitext(nombre)
            if ext.lower() not in EXT_IMAGENES:
                continue
            m = IMAGEN_DISENO_RE.match(base.strip().upper())
            if not m:
                continue
            ruta = os.path.join(raiz, nombre)
            for ref, diseno in pedidos:
                if diseno != int(m.group("diseno")) or not _imagen_es_de_ref(m.group("ref"), ref):
                    continue
                try:
                    mtime = os.path.getmtime(ruta)
                except OSError:
                    continue
                if mtime > mtimes.get((ref, diseno), -1):
                    mtimes[(ref, diseno)] = mtime
                    encontradas.setdefault(ref, {})[diseno] = ruta

    for ref, diseno in sorted(pedidos):
        if diseno in encontradas.get(ref, {}):
            logging.info(f"Imagen de diseño {ref} D{diseno}: {encontradas[ref][diseno]}")
        else:
            logging.warning(f"Imagen de diseño {ref} D{diseno}: no hay imagen REFERENCIA_D{diseno}_MAQUINA en {carpeta}.")
    return encontradas

def _insertar_imagen_diseno(ws, ruta_img, diseno, carpeta_tmp):
    """Pone la imagen centrada y ajustada (sin deformar) en el recuadro DISEÑO n
    de `ws` (hoja de Excel via COM; medidas reales en puntos). True si quedo."""
    col_ini, col_fin = CAJA_DISENO[diseno]
    f_ini, f_fin = FILAS_CAJA_DISENO
    caja = ws.Range(f"{col_ini}{f_ini}:{col_fin}{f_fin}")
    caja_w = caja.Width - 2 * MARGEN_CAJA_PT
    caja_h = caja.Height - 2 * MARGEN_CAJA_PT
    tmp = None
    try:
        with PILImage.open(ruta_img) as original:
            im = ImageOps.exif_transpose(original)          # fotos de celular giradas
            im.thumbnail((int(caja_w * 3), int(caja_h * 3)))  # que una foto grande no infle el Excel
            con_alfa = im.mode in ("RGBA", "LA", "P")
            if not con_alfa and im.mode != "RGB":
                im = im.convert("RGB")
            tmp = os.path.join(carpeta_tmp, f"diseno_{os.getpid()}_{int(time.time() * 1000)}.{'png' if con_alfa else 'jpg'}")
            im.save(tmp, format="PNG" if con_alfa else "JPEG", quality=90)
            ancho_img, alto_img = im.size
        escala = min(caja_w / ancho_img, caja_h / alto_img)
        w, h = ancho_img * escala, alto_img * escala
        # AddPicture(archivo, LinkToFile, SaveWithDocument, izq, arriba, ancho, alto)
        izq = caja.Left + MARGEN_CAJA_PT + (caja_w - w) / 2
        arriba = caja.Top + MARGEN_CAJA_PT + (caja_h - h) / 2
        forma = ws.Shapes.AddPicture(tmp, False, True, izq, arriba, w, h)
        # Excel a veces reajusta el alto al insertar: se fuerzan las medidas
        # calculadas y DESPUES se bloquea la proporcion.
        forma.LockAspectRatio = False
        forma.Width = w
        forma.Height = h
        forma.Left = izq
        forma.Top = arriba
        forma.LockAspectRatio = True
        forma.Placement = 2   # xlMove: si alguien cambia el alto de una fila, la imagen no se deforma
        return True
    except Exception as e:
        logging.warning(f"Excel listado: no se pudo insertar la imagen {os.path.basename(ruta_img)} ({e}); se deja en la carpeta.")
        return False
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass

def _familia_ref(ref):
    """A200FUT01 -> A200FUT ; A11300CA04-1 -> A11300CA04. Si no hay digitos
    finales ('A50CA01M-A50PT01M') la familia es la REF completa."""
    return re.sub(r"[-_]*\d+$", "", ref) or ref

def _nombre_pestana(nombre, usados):
    """Nombre valido de hoja Excel (max 31, sin []:*?/\\) y sin repetir."""
    base = _CARACTERES_NO_HOJA_RE.sub("-", nombre).strip("'")[:31] or "REF"
    candidato, n = base, 2
    while candidato.upper() in usados:
        sufijo = f" ({n})"
        candidato = base[:31 - len(sufijo)] + sufijo
        n += 1
    usados.add(candidato.upper())
    return candidato

def crear_excel_listado(header, items, ruta_destino, imagenes=None):
    """Arma el Excel del listado de produccion (una pestaña por familia de REF)
    a partir de los items del PDF y lo guarda en ruta_destino (reemplaza al
    anterior si la orden se reprocesa). imagenes = {ref: {diseno: ruta}}
    (buscar_imagenes_maestros + buscar_imagenes_diseno).
    Devuelve (ruta, imagenes_insertadas). Lanza excepcion si no pudo.

    Lo hace EXCEL via COM, no openpyxl: REFERENCIA se duplica con Worksheet.Copy
    y el formato queda IDENTICO a la plantilla; el bot solo escribe valores e
    inserta imagenes. (Con openpyxl se perdian bordes de las celdas combinadas:
    136 celdas distintas a la plantilla, 2026-09-14.) Usa una instancia PROPIA
    de Excel (DispatchEx): no toca el Excel que tenga abierto el usuario."""
    import pythoncom
    import win32com.client

    imagenes = imagenes or {}
    familias = {}   # familia -> items, en el orden del PDF
    for it in items:
        familias.setdefault(_familia_ref(it["ref"]), []).append(it)
    fecha_entrega = header.get("fecha_entrega_date")
    usadas = []   # imagenes de diseño que quedaron insertadas
    carpeta = os.path.dirname(ruta_destino)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)

    pythoncom.CoInitialize()   # corre en el hilo worker, no en el principal
    excel = wb = base = ws = None
    pid_excel = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        try:
            import win32process
            pid_excel = win32process.GetWindowThreadProcessId(excel.Hwnd)[1]
        except Exception:
            pid_excel = None
        excel.Visible = False
        excel.DisplayAlerts = False
        excel.ScreenUpdating = False
        excel.EnableEvents = False
        excel.AskToUpdateLinks = False
        wb = excel.Workbooks.Open(str(FORMATO_EXCEL_PATH), 0, True)   # solo lectura: la plantilla nunca se toca
        base = wb.Worksheets(HOJA_PLANTILLA)
        usados = {wb.Worksheets(i).Name.upper() for i in range(1, wb.Worksheets.Count + 1)}
        # Alto de cada fila de la plantilla, agrupado en tramos de filas seguidas
        # con el mismo alto: [(desde, hasta, alto)].
        altos = [base.Rows(r).RowHeight for r in range(1, FILA_ULTIMO_DATO + 1)]
        tramos_alto, desde = [], 1
        for r in range(2, FILA_ULTIMO_DATO + 2):
            if r > FILA_ULTIMO_DATO or altos[r - 1] != altos[desde - 1]:
                tramos_alto.append((desde, r - 1, altos[desde - 1]))
                desde = r

        for familia, its in familias.items():
            refs = list(dict.fromkeys(it["ref"] for it in its))
            codigo = refs[0] if len(refs) == 1 else familia
            base.Copy(Before=base)   # copia exacta: formato, logo, lista de tallas, condicionales
            ws = excel.ActiveSheet
            ws.Name = _nombre_pestana(codigo, usados)
            # ALTOS DE FILA = los de la plantilla, y FIJOS antes de escribir:
            #  - al copiar la hoja, Excel recalcula las filas sin alto propio (la
            #    fila 1 pasaba de 15 a 15.75);
            #  - al recibir datos, Excel auto-ajusta las filas sin alto fijo (fuente
            #    14 en TALLA/NUMERO): cambiaba el formato y estiraba las imagenes.
            for f_desde, f_hasta, alto in tramos_alto:
                ws.Rows(f"{f_desde}:{f_hasta}").RowHeight = alto

            ws.Range("F2").Value = f"{codigo} - {its[0]['descripcion_base']}".strip(" -")
            ws.Range("K2").Value = header.get("cliente") or ""
            ws.Range("K3").Value = header.get("proyecto") or ""
            ws.Range("K4").Value = header.get("vendedor") or ""
            if fecha_entrega:
                # Numero de serie de Excel: la celda ya trae formato dd-mm-yy.
                ws.Range("K5").Value = (fecha_entrega - datetime(1899, 12, 30).date()).days

            # Filas D..P (TALLA, NUMERO, EDICION..EMPAQUE vacias, DISEÑO 1-4, MASC, FEM):
            # se escriben de un solo golpe desde la fila 8, sin insertar filas.
            filas, notas = [], []
            for diseno in sorted({it["diseno"] for it in its}):
                for it in (x for x in its if x["diseno"] == diseno):
                    unidades = list(it["tallas"])
                    if len(unidades) > it["cantidad"]:
                        logging.warning(
                            f"Excel listado: item {it['item']} ({it['ref']}) trae {len(unidades)} "
                            f"tallas pero CANT. {it['cantidad']}; se escriben todas las tallas."
                        )
                    # Prendas sin talla en el PDF: la fila va igual (con su diseño y
                    # genero) para que el total de filas cuadre con la CANT.
                    unidades += [None] * (it["cantidad"] - len(unidades))
                    for u in unidades:
                        fila = [None] * 13
                        if u:
                            fila[0] = u["talla"]
                            if u.get("numero"):
                                fila[1] = int(u["numero"]) if u["numero"].isdigit() else u["numero"]
                        if diseno in COL_DISENO:
                            fila[6 + diseno] = "X"                      # K..N
                        else:
                            notas.append((FILA_PRIMER_DATO + len(filas), f"DISEÑO {diseno}"))
                        fila[11 if it["genero"] != "FEM" else 12] = "X"  # O / P
                        filas.append(fila)
            if filas:
                ultima = FILA_PRIMER_DATO + len(filas) - 1
                for r in range(FILA_ULTIMO_DATO + 1, ultima + 1):   # filas fuera de la plantilla: ver nota del alto
                    ws.Rows(r).RowHeight = ws.Rows(r).RowHeight
                ws.Range(f"D{FILA_PRIMER_DATO}:P{ultima}").Value = tuple(tuple(f) for f in filas)
                if ultima > FILA_ULTIMO_DATO:
                    logging.warning(
                        f"Excel listado: la pestaña {ws.Name} usa {len(filas)} filas; "
                        f"la plantilla solo trae formato/conteos hasta la fila {FILA_ULTIMO_DATO}."
                    )
            for fila_nota, texto in notas:
                ws.Range(f"Q{fila_nota}").Value = texto

            # Imagenes DESPUES de los datos: el recuadro ya tiene sus medidas finales.
            for diseno in CAJA_DISENO:
                rutas = list(dict.fromkeys(
                    imagenes[r][diseno] for r in refs if diseno in imagenes.get(r, {})
                ))
                if not rutas:
                    continue
                if len(rutas) > 1:
                    logging.warning(
                        f"Excel listado: la pestaña {ws.Name} tiene {len(rutas)} imagenes para DISEÑO "
                        f"{diseno}; se usa {os.path.basename(rutas[0])} y las demas se dejan en la carpeta."
                    )
                if _insertar_imagen_diseno(ws, rutas[0], diseno, str(PID_DIR)) and rutas[0] not in usadas:
                    usadas.append(rutas[0])

        base.Delete()
        base = None
        nombres = [wb.Worksheets(i).Name for i in range(1, wb.Worksheets.Count + 1)]
        # BASE_DATOS al final, como en el Excel de los comerciales (Excel no deja
        # mover una hoja detras de si misma si ya es la ultima).
        if HOJA_BASE_DATOS in nombres and nombres[-1] != HOJA_BASE_DATOS:
            wb.Worksheets(HOJA_BASE_DATOS).Move(After=wb.Worksheets(wb.Worksheets.Count))
        wb.Worksheets(1).Activate()
        wb.SaveAs(os.path.abspath(ruta_destino), 51)   # 51 = .xlsx; reemplaza al anterior
    finally:
        ws = base = None
        if wb is not None:
            try:
                wb.Close(False)
            except Exception:
                pass
        if excel is not None:
            try:
                excel.Quit()
            except Exception:
                pass
        wb = excel = None
        pythoncom.CoUninitialize()
        if pid_excel:
            _cerrar_excel_propio(pid_excel)
    return ruta_destino, usadas

def _cerrar_excel_propio(pid, espera_seg=10):
    """Si la instancia de Excel que abrio el bot sigue viva tras Quit (p.ej. por
    un error a mitad de camino), la cierra: nunca queda un EXCEL.EXE colgado.
    Solo toca ESE pid (el de su propia instancia), nunca el Excel del usuario."""
    for _ in range(espera_seg):
        r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                           capture_output=True, text=True, **_SIN_VENTANA)
        if "EXCEL.EXE" not in (r.stdout or "").upper():
            return
        time.sleep(1)
    logging.warning(f"Excel listado: la instancia de Excel (PID {pid}) no se cerro sola; se cierra a la fuerza.")
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, **_SIN_VENTANA)

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

def copiar_archivo(origen, destino_dir):
    """Copia el PDF a la carpeta de la orden y deja el original donde esta.

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

def procesar_orden(orden, ruta_pdf, config, production_writer=None, write_google_sheets=True):
    """Procesa una orden a partir SOLO de su PDF (cotizacion/remision).
    Devuelve True si termino OK. Lanza ErrorTecnico ante fallos transitorios.

    COPIA REPROGRAMACIONES (solo PDF, 2026-09-14): el original de la NAS espera
    la pareja Excel + PDF y saca las filas de produccion del Excel. Aqui no llega
    Excel: el PDF hace TODO, con las mismas reglas y los mismos destinos, y el
    bot ARMA el Excel del listado (ver crear_excel_listado).

    Flujo:
      1. Lee el PDF: encabezado (cliente, proyecto, vendedor, fechas, tipo de
         documento, montos) y sus items, agrupados por referencia.
      2. Si falta cliente/proyecto o el PDF no trae items -> correo al comercial
         y NO procesa.
      3. Crea la estructura de carpetas cliente/orden.
      4. COPIA el PDF a la carpeta de la orden y crea ahi el Excel del listado
         (una pestaña por referencia, desde FORMATO_EXCEL.xlsx) con la imagen
         del diseño que pide cada item, sacada de MAESTROS\\<proyecto> del
         cliente (o la que el comercial dejo junto al PDF). Se copian a la orden.
      5. Sube cliente/referencias a Supabase.
      6. Registra las referencias del PDF en la hoja de PRODUCCION.
      7. SOLO si el PDF es COTIZACION: fila en CONTROL DE PAGOS COTIZACIONES.
      8. Borra el PDF y las imagenes usadas que estaban en la carpeta vigilada
         (ya estan copiados en la orden). Las de MAESTROS NUNCA se borran.
    """
    nombre_pdf = os.path.basename(ruta_pdf)

    # 1. Un ErrorTecnico aqui (PDF aun copiandose / ilegible) se propaga para
    #    reintentar la orden completa mas tarde.
    datos_pdf, header_pdf, items_pdf, _ = extraer_info_pdf(ruta_pdf)   # una fila por referencia
    es_cotizacion = (header_pdf.get("tipo_doc") == "COTIZACION")

    cliente = header_pdf.get("cliente")
    proyecto = header_pdf.get("proyecto")

    # 2. Mismas reglas que el original (cliente, proyecto, referencias). Los avisos
    #    de diseno/genero asumidos del PDF NO rechazan, igual que en el original.
    #    Se exige items_pdf (no datos_pdf): sin items, extraer_info_pdf igual arma
    #    una fila de respaldo con una referencia adivinada del texto.
    motivos = []
    if not cliente:
        motivos.append("No se pudo identificar el nombre del cliente en el PDF.")
    if not proyecto:
        motivos.append("No se pudo identificar el proyecto (campo Garantia) en el PDF.")
    if not items_pdf:
        motivos.append("El PDF no tiene items (referencias de producto) validos.")
    if motivos:
        enviar_alerta_comercial(header_pdf, motivos, nombre_pdf, config)
        logging.warning(f"Orden {orden}: reglas incumplidas, no se procesa -> {motivos}")
        return False

    cliente_safe = sanitize(cliente)
    proyecto_safe = sanitize(proyecto)
    # Misma clave con la que la orden se marca procesada: _orden_en_sheets() la
    # busca en la columna E para permitir reprocesos.
    orden_num = orden
    nombre_orden = f"{orden_num}_{proyecto_safe}"

    logging.info(
        f"Orden {orden_num} ({header_pdf.get('tipo_doc') or 'SIN TIPO'}) | Cliente: {cliente_safe} "
        f"| Proyecto: {proyecto_safe} | Referencias (PDF): {len(datos_pdf)}"
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

    # 4. COPIA (no mueve) el PDF a la carpeta de la orden.
    copiar_archivo(ruta_pdf, ruta_orden)

    # 4b. Excel del listado (una pestaña por referencia) con la imagen del
    #     diseño que pide cada item: de MAESTROS\<proyecto> del cliente, sin
    #     esperar nada del comercial (LECCIONES #9); si igual dejo una junto al
    #     PDF, esa manda. Las usadas se copian a la orden y SOLO las de la
    #     carpeta vigilada se borran en el paso 8. Si falla queda en el log y la
    #     orden sigue: el Excel no bloquea Supabase ni la hoja de PRODUCCION.
    # El listado conserva exactamente el nombre base del PDF recibido.
    # Ejemplo: CO6086_ASCUN2026.pdf -> CO6086_ASCUN2026.xlsx.
    nombre_excel = os.path.splitext(nombre_pdf)[0] + ".xlsx"
    ruta_excel = os.path.join(ruta_orden, nombre_excel)
    carpeta_vigilada = os.path.dirname(ruta_pdf)
    imagenes_copiadas = []   # solo las de la carpeta vigilada (se borran en el paso 8)
    try:
        imagenes = buscar_imagenes_maestros(ruta_cliente, cliente, proyecto, items_pdf)
        for ref, por_diseno in buscar_imagenes_diseno(carpeta_vigilada, [it["ref"] for it in items_pdf]).items():
            imagenes.setdefault(ref, {}).update(por_diseno)
        _, imagenes_usadas = crear_excel_listado(header_pdf, items_pdf, ruta_excel, imagenes)
        logging.info(f"Excel del listado creado: {ruta_excel} ({len(imagenes_usadas)} imagen(es) de diseño)")
        for ruta_img in imagenes_usadas:
            try:
                copiar_archivo(ruta_img, ruta_orden)
                if os.path.dirname(ruta_img) == carpeta_vigilada:
                    imagenes_copiadas.append(ruta_img)
            except OSError as e:
                logging.error(f"No se pudo copiar la imagen {ruta_img} a la orden (se deja en la carpeta): {e}")
    except Exception:
        logging.exception(f"Orden {orden_num}: no se pudo crear el Excel del listado")

    # 5. Supabase.
    guardar_cliente_supabase(cliente_safe, ruta_cliente)

    # 6. Hoja de PRODUCCION: una fila por referencia del PDF.
    for datos in datos_pdf:
        if datos.get("referencia"):
            guardar_referencia_supabase(datos["referencia"], datos.get("proyecto"))
        datos["cliente"] = cliente_safe
        datos["proyecto"] = proyecto_safe
        datos["orden"] = orden_num
        if production_writer:
            production_writer(datos)
        elif write_google_sheets:
            escribir_google_sheets(datos)

    # 7. CONTROL DE PAGOS COTIZACIONES  -  SOLO si el PDF dice COTIZACION.
    if es_cotizacion and write_google_sheets:
        header_pdf["cliente"] = header_pdf.get("cliente") or cliente
        registrar_pago_cotizacion(header_pdf, config)
    else:
        logging.info(
            f"Orden {orden_num}: el PDF es {header_pdf.get('tipo_doc') or 'SIN TIPO'}, "
            "no se toca la hoja de pagos (solo las COTIZACIONES la tocan)."
        )

    # 8. Borrar el PDF y las imagenes usadas de la carpeta vigilada (ya copiados
    #    en la orden). imagenes_copiadas nunca trae rutas de MAESTROS.
    for ruta in [ruta_pdf] + imagenes_copiadas:
        if os.path.exists(ruta):
            archivar_original(ruta)

    return True

# ======================================================================
#  HANDLERS DE WATCHDOG
# ======================================================================

class HandlerArchivos(FileSystemEventHandler):
    """El observer solo ENCOLA rutas; un hilo worker aparte las clasifica y procesa.

    SOLO PDF (copia REPROGRAMACIONES): una orden se procesa en cuanto su PDF
    (cotizacion/remision) CO####/RM#### esta estable en la carpeta; no se
    espera ningun Excel NI imagenes (salen de MAESTROS, LECCIONES #9). Las
    imagenes no son pedidos: nunca entran a la cola (extensiones_permitidas =
    .pdf). Se conserva el buffer 'self.pendientes' (pares_pendientes.json)
    del original porque de el cuelgan los reintentos por fallo tecnico, pero
    cada slot solo usa la clave "pdf". Sin pareja no hay huerfanos que avisar.

    Se conserva la separacion observer/worker: el I/O de red (Supabase, Sheets,
    Drive, NAS) corre SIEMPRE en el hilo worker, nunca en el del observer.
    """

    MAX_FALLOS_TECNICOS = 6       # reintentos ante ErrorTecnico antes de rendirse
    REINTENTO_TECNICO_SEG = 45    # espera entre reintentos

    def __init__(self, config):
        self.config = config
        self.cola = queue.Queue()
        self.encolados = set()          # rutas ya vistas (en cola / en un slot)
        self.pendientes = {}            # orden -> {"pdf": ruta}
        self.rechazados = {}            # ruta -> mtime (no clasificable / regla incumplida)
        self.fallos_tecnicos = {}       # orden -> n
        self.reintentos_orden = {}      # orden -> epoch en que toca reintentar
        self.procesadas = {}            # orden -> iso ts (anti-duplicado si falla el archivado)
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
                if slot.get("pdf") == event.src_path:
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
        if ext not in self.config["extensiones_permitidas"]:
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
                if not slot.get("pdf") or not os.path.exists(slot["pdf"]):
                    self.pendientes.pop(orden, None)
            self._guardar_pendientes()
        n = len(self.pendientes)
        if n:
            logging.info(f"Reconciliacion: {n} orden(es) pendientes de procesar: {', '.join(self.pendientes)}")

    # ---- clasificacion ---------------------------------------------------
    def _clasificar(self, ruta):
        """Numero de orden (CO####/RM####) del PDF, o None si no se resuelve.
        Puede lanzar ErrorTecnico si el PDF aun no se puede leer."""
        # Siempre se lee el PDF: CO/RM sale del TIPO de documento, no del nombre
        # del archivo (ver extraer_info_pdf). Asi carpeta, Excel, hoja y la marca
        # de "ya procesada" usan la misma clave.
        _, header, _, _ = extraer_info_pdf(ruta)   # ErrorTecnico si no se puede leer
        if header.get("orden"):
            return header["orden"]
        prefijo, numero = extraer_prefijo_numero_nombre(os.path.basename(ruta))
        return f"{prefijo}{numero}" if prefijo and numero else None

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

            # Sin espera de imagenes (LECCIONES #9): cada PDF estable se procesa ya.
            ahora = time.time()
            listas = []
            with self._lock:
                for orden, slot in self.pendientes.items():
                    if not slot.get("pdf"):
                        continue
                    venc = self.reintentos_orden.get(orden)
                    if venc and venc > ahora:
                        continue
                    listas.append(orden)
            for orden in listas:
                self._procesar_orden(orden)

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
        if self.rechazados.get(ruta) == mtime:
            return
        with self._lock:
            for slot in self.pendientes.values():
                if slot.get("pdf") == ruta:
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
            orden = self._clasificar(ruta)
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
            self.pendientes[orden] = {"pdf": ruta}
            self._guardar_pendientes()

        logging.info(
            f"Orden {orden}: PDF recibido -> se procesa ya (imagenes de diseño desde "
            "MAESTROS del cliente, sin esperar)."
        )

    def _procesar_orden(self, orden):
        with self._lock:
            slot = self.pendientes.get(orden)
            ruta_pdf = slot.get("pdf") if slot else None
        if not ruta_pdf:
            return
        if not os.path.exists(ruta_pdf):
            # Sin pareja que esperar: si el PDF desaparecio, el slot sobra.
            with self._lock:
                self.pendientes.pop(orden, None)
                self._guardar_pendientes()
            return

        _estado["procesando_desde"] = time.time()
        try:
            logging.info(f"Procesando orden {orden}: {os.path.basename(ruta_pdf)}")
            ok = procesar_orden(orden, ruta_pdf, self.config)
            if ok:
                self._marcar_procesada(orden)
            with self._lock:
                self.pendientes.pop(orden, None)
                self.reintentos_orden.pop(orden, None)
                self.fallos_tecnicos.pop(orden, None)
                self.encolados.discard(ruta_pdf)
                if not ok:
                    try:
                        self.rechazados[ruta_pdf] = os.path.getmtime(ruta_pdf)
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
                try:
                    self.rechazados[ruta_pdf] = os.path.getmtime(ruta_pdf)
                except OSError:
                    pass
                self.encolados.discard(ruta_pdf)
                self.pendientes.pop(orden, None)
                self._guardar_pendientes()
        finally:
            _estado["procesando_desde"] = 0.0

    def _esperar_archivo_estable(self, ruta, lecturas_iguales=3, espera=1.5, max_intentos=40):
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
    return str(PID_DIR / load_config()["log_file"])

def _asegurar_carpeta_estado():
    """Crea PID_DIR (la subcarpeta _estado) y la deja OCULTA. Se oculta la
    CARPETA y no cada archivo: Windows no deja reescribir con open('w') un
    archivo oculto (PermissionError), pero si uno normal dentro de una carpeta
    oculta."""
    PID_DIR.mkdir(parents=True, exist_ok=True)
    if _IS_UNC or os.name != "nt":
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        attrs = k32.GetFileAttributesW(str(PID_DIR))
        if attrs != -1 and not attrs & 0x2:            # 0x2 = FILE_ATTRIBUTE_HIDDEN
            k32.SetFileAttributesW(str(PID_DIR), attrs | 0x2)
    except Exception:
        pass

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

# --- Un solo EQUIPO a la vez (2026-09-14) -----------------------------------
# El bot vive en la NAS y cualquier PC con el vigilante (INSTALAR_VIGILANTE) puede
# lanzarlo. Si corriera en dos PCs a la vez, los dos verian la misma carpeta y
# DUPLICARIAN los pedidos; monitor.pid/health.json son locales (%TEMP% de cada PC)
# y no lo evitan. Por eso el PC que corre el bot lo anota en la NAS y lo renueva
# cada EQUIPO_RENUEVA_SEG:
#   - otro PC con la marca fresca (< EQUIPO_VIGENTE_SEG) -> este queda EN ESPERA
#     (no arranca; su vigilante reintenta y toma el relevo si el otro se apaga);
#   - "relevo": un PC nuevo pide el bot (INSTALAR_VIGILANTE) -> este lo suelta en
#     cuanto no este procesando una orden.
# La edad de la marca es el MTIME del archivo, igual que en Servidor_Reprogramacion.vbs.
EQUIPO_PATH = BASE_DIR / "_compartido" / "equipo_activo.json"
EQUIPO_VIGENTE_SEG = 180
EQUIPO_RENUEVA_SEG = 30
ESTE_EQUIPO = (os.environ.get("COMPUTERNAME") or socket.gethostname()).upper()

def _leer_equipo():
    try:
        with open(str(EQUIPO_PATH), "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {}

def _edad_marca():
    try:
        return time.time() - EQUIPO_PATH.stat().st_mtime
    except Exception:
        return float("inf")

def _escribir_equipo(datos):
    carpeta = EQUIPO_PATH.parent
    if not carpeta.exists():
        carpeta.mkdir(parents=True, exist_ok=True)
        try:   # carpeta oculta (el archivo dentro queda normal: se puede reescribir)
            import ctypes
            k32 = ctypes.windll.kernel32
            attrs = k32.GetFileAttributesW(str(carpeta))
            if attrs != -1:
                k32.SetFileAttributesW(str(carpeta), attrs | 0x2)
        except Exception:
            pass
    tmp = str(EQUIPO_PATH) + f".{ESTE_EQUIPO}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(EQUIPO_PATH))

def _datos_equipo(previo=None):
    d = dict(previo or {})
    d.update({"equipo": ESTE_EQUIPO, "pid": os.getpid(), "latido": time.time(),
              "hora": datetime.now().isoformat(timespec="seconds")})
    return d

def tomar_equipo():
    """True si este PC puede correr el bot; False si ya corre (marca fresca) en otro."""
    d = _leer_equipo()
    otro = (d.get("equipo") or "").upper()
    if otro and otro != ESTE_EQUIPO and _edad_marca() < EQUIPO_VIGENTE_SEG:
        logging.warning(f"El bot ya esta corriendo en el equipo {otro}; este equipo ({ESTE_EQUIPO}) queda EN ESPERA.")
        return False
    _escribir_equipo(_datos_equipo())
    time.sleep(2)   # carrera: si dos PCs la escribieron casi a la vez, gana el ultimo
    if (_leer_equipo().get("equipo") or "").upper() != ESTE_EQUIPO:
        logging.warning("Otro equipo tomo el bot al mismo tiempo; este queda EN ESPERA.")
        return False
    logging.info(f"Equipo activo: {ESTE_EQUIPO} (marca en {EQUIPO_PATH})")
    return True

def soltar_equipo():
    """Borra la marca SOLO si es de este PC."""
    try:
        if (_leer_equipo().get("equipo") or "").upper() == ESTE_EQUIPO:
            EQUIPO_PATH.unlink()
    except Exception:
        pass

def _cerrar_por_equipo():
    _limpiar_pid()
    for h in logging.getLogger().handlers:
        try:
            h.flush()
        except Exception:
            pass
    os._exit(0)

def _hilo_equipo():
    """Renueva la marca; atiende un pedido de relevo o que otro PC tenga el bot."""
    while True:
        time.sleep(EQUIPO_RENUEVA_SEG)
        try:
            d = _leer_equipo()
            dueno = (d.get("equipo") or "").upper()
            if dueno and dueno != ESTE_EQUIPO and _edad_marca() < EQUIPO_VIGENTE_SEG:
                logging.error(f"El equipo {dueno} tiene el bot; este ({ESTE_EQUIPO}) se cierra para no duplicar pedidos.")
                _cerrar_por_equipo()
            relevo = (d.get("relevo") or "").upper()
            if relevo and relevo != ESTE_EQUIPO and not _estado["procesando_desde"]:
                logging.warning(f"Relevo pedido por el equipo {relevo}: este ({ESTE_EQUIPO}) suelta el bot.")
                soltar_equipo()
                _cerrar_por_equipo()
            _escribir_equipo(_datos_equipo(d))   # conserva "relevo" si hay una orden en proceso
        except Exception as e:
            logging.warning(f"No se pudo renovar la marca de equipo activo: {e}")

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
    soltar_equipo()   # la marca de equipo activo, si es de este PC
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
    _asegurar_carpeta_estado()
    log_path = ruta_log()
    setup_logging(log_path)

    logging.info("=" * 60)
    logging.info("Servidor_Reprogramacion - INICIANDO")
    logging.info(f"PID {os.getpid()}  |  Observer: {Observer.__name__}(timeout={POLL_INTERVAL}s)")
    logging.info(f"Log real de esta sesion: {log_path}")
    logging.info(f"Latido de salud        : {HEARTBEAT_PATH}")
    _instalar_diagnostico_de_cierre()

    # --- instancia unica --------------------------------------------------
    if not registrar_pid_unico():
        return
    # --- un solo EQUIPO a la vez (marca en la NAS, ver tomar_equipo) ---------
    if not tomar_equipo():
        _limpiar_pid()
        return
    threading.Thread(target=_hilo_equipo, name="equipo-activo", daemon=True).start()
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
    logging.info(f"Tablas propias       : {TABLA_CLIENTES}, {TABLA_REFERENCIAS}, {TABLA_TELAS}, {TABLA_VENDEDORES}")
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

    logging.info("Servidor_Reprogramacion ACTIVO Y VERIFICADO")
    _estado["listo"] = True
    escribir_latido(observer, observer_clientes)   # que el aviso de "iniciado" salga ya, sin esperar al bucle

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
