#!/usr/bin/env python3
"""Vigila produccion.tech y avisa por correo si deja de responder.

Pensado para correr cada 5 minutos por cron en el VPS (fuera de Docker).
Solo envia correo cuando el estado cambia (cae o se recupera), nunca en
cada chequeo, para no llenar el correo de alertas repetidas.
"""
import smtplib
import ssl
import time
import urllib.request
from email.mime.text import MIMEText
from pathlib import Path

URL = "https://produccion.cloud/salud"
BASE_DIR = Path(__file__).resolve().parent.parent
STATE_FILE = BASE_DIR / "monitor_produccion.state"
TIMEOUT = 10


def load_env(path: Path) -> dict:
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def check() -> bool:
    try:
        with urllib.request.urlopen(URL, timeout=TIMEOUT) as response:
            return response.status == 200
    except Exception:
        return False


def send_mail(env: dict, subject: str, body: str) -> None:
    message = MIMEText(body)
    message["Subject"] = subject
    message["From"] = env["SMTP_EMAIL"]
    message["To"] = env["SMTP_EMAIL"]
    context = ssl.create_default_context()
    with smtplib.SMTP(env.get("SMTP_SERVER", "smtp.gmail.com"), int(env.get("SMTP_PORT", "587"))) as server:
        server.starttls(context=context)
        server.login(env["SMTP_EMAIL"], env["SMTP_PASSWORD"])
        server.send_message(message)


def main() -> None:
    env = load_env(BASE_DIR / ".env")
    ok = check()
    if not ok:
        # Un solo fallo puede ser un bache pasajero de red; se confirma con
        # un segundo intento antes de avisar a nadie.
        time.sleep(30)
        ok = check()

    previous = STATE_FILE.read_text().strip() if STATE_FILE.exists() else "up"
    current = "up" if ok else "down"
    print(f"produccion.tech: {current}")

    if current != previous:
        if current == "down":
            send_mail(
                env, "⚠ produccion.tech no responde",
                "produccion.tech dejo de responder (dos intentos fallidos con 30s de diferencia).\n"
                "Revisa el panel del servidor (Hostinger) y los contenedores docker.",
            )
        else:
            send_mail(
                env, "✓ produccion.tech se recupero",
                "produccion.tech volvio a responder con normalidad.",
            )
        STATE_FILE.write_text(current)


if __name__ == "__main__":
    main()
