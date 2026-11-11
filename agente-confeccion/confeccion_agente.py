"""Agente nativo de Confección.

El proceso se ejecuta en el PC que mantiene WhatsApp Web abierto. Su código
canónico está en la NAS; los datos de conexión quedan solo en este equipo.
"""
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from whatsapp_playwright import WhatsAppConfeccion

LOCAL = Path(__file__).resolve().parent
CONFIG = LOCAL / "datos" / "panel.json"
LOG = LOCAL / "logs" / "confeccion-agent.log"


def registrar(texto):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    try:
        # Append evita bloquear el agente por registros antiguos ANSI/CP1252
        # o porque otro proceso mantenga abierto el archivo.
        with LOG.open("a", encoding="utf-8", errors="replace") as stream:
            stream.write(texto + "\n")
    except OSError:
        # Si otro proceso tiene el log abierto, el agente sigue trabajando.
        pass


def cargar():
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
        return str(data["url"]).rstrip("/"), str(data["token"])
    except Exception:
        return None


def post(url, token, ruta, payload):
    req = urllib.request.Request(
        url + ruta, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "X-Agentes-Token": token,
                 "User-Agent": "IndoorConfeccion/1.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def ejecutar():
    cfg = cargar()
    if not cfg:
        registrar("Sin conexión al panel: falta datos/panel.json")
        return 2
    url, token = cfg
    registrar("Agente CONFECCIÓN iniciado en " + socket.gethostname())
    whatsapp = None
    conectado_reportado = False
    while True:
        try:
            respuesta = post(url, token, "/api/agentes/pc/sondeo", {
                "equipo": socket.gethostname(),
                "confeccion": "listo",
                "whatsapp": "activo",
            })
            if not conectado_reportado:
                registrar("Panel conectado; esperando preparaciones de Confección")
                conectado_reportado = True
            # Las órdenes de Confección se atienden aquí cuando el panel las
            # publique. Nunca se envía nada por WhatsApp sin una orden creada
            # explícitamente con Guardar en el panel.
            for pendiente in respuesta.get("pendientes", []):
                registrar("Solicitud recibida: " + str(pendiente.get("id", "")))
            for trabajo in respuesta.get("confeccion", []):
                registrar("Tarea de Confección recibida: " + str(trabajo.get("id", "")) + " · " + str(trabajo.get("orden", "")))
                try:
                    if whatsapp is None: whatsapp = WhatsAppConfeccion()
                    total = whatsapp.preparar(trabajo)
                    registrar(f"Chat preparado para {trabajo.get('orden','')}; mockups cargados: {total}. Envío manual pendiente.")
                except Exception as exc:
                    registrar("No se pudo preparar WhatsApp: " + str(exc))
        except urllib.error.HTTPError as exc:
            registrar("Panel rechazó la conexión: HTTP " + str(exc.code))
        except Exception as exc:
            registrar("Sin conexión: " + str(exc))
        time.sleep(3)


if __name__ == "__main__":
    sys.exit(ejecutar())
