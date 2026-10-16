"""Aviso por correo cuando aparece (o se resuelve) un problema de salud del panel.

Revisa cada 5 min la misma lista que muestra /api/salud-panel. Un problema debe verse en 2 revisiones
seguidas antes de avisar (evita falsas alarmas). Se avisa una sola vez por problema y otra al resolverse.
Variables en el .env: ALERTA_EMAIL_A (uno o varios, separados por coma), ALERTA_SMTP_USER, ALERTA_SMTP_PASSWORD
(contraseña de aplicación), opcionales ALERTA_SMTP_HOST (smtp.gmail.com) y ALERTA_SMTP_PORT (465).
Sin ALERTA_EMAIL_A o sin credenciales el aviso queda apagado.
"""
import json
import logging
import os
import smtplib
import threading
import time
from email.message import EmailMessage
from pathlib import Path
from typing import Callable

log = logging.getLogger('alertas_correo')
INTERVALO = 300
CONFIRMAR = 2


def configurado() -> bool:
    return bool(os.getenv('ALERTA_EMAIL_A') and os.getenv('ALERTA_SMTP_USER') and os.getenv('ALERTA_SMTP_PASSWORD'))


def enviar(asunto: str, cuerpo: str) -> None:
    msg = EmailMessage()
    msg['Subject'] = asunto
    msg['From'] = os.environ['ALERTA_SMTP_USER']
    msg['To'] = os.environ['ALERTA_EMAIL_A']
    msg.set_content(cuerpo)
    with smtplib.SMTP_SSL(os.getenv('ALERTA_SMTP_HOST', 'smtp.gmail.com'), int(os.getenv('ALERTA_SMTP_PORT', '465')), timeout=30) as s:
        s.login(os.environ['ALERTA_SMTP_USER'], os.environ['ALERTA_SMTP_PASSWORD'])
        s.send_message(msg)


class Vigia:
    """Decide qué avisar; separado del hilo para poder probarlo."""

    def __init__(self, archivo: Path | None = None):
        self.archivo = archivo
        self.vistos: dict[str, int] = {}
        self.avisados: set[str] = set(self._leer())

    def _leer(self) -> list[str]:
        try:
            return json.loads(self.archivo.read_text(encoding='utf-8')) if self.archivo else []
        except (OSError, ValueError):
            return []

    def _guardar(self) -> None:
        if self.archivo:
            try:
                self.archivo.write_text(json.dumps(sorted(self.avisados), ensure_ascii=False), encoding='utf-8')
            except OSError:
                pass

    def revisar(self, problemas: list[str]) -> tuple[list[str], list[str]]:
        """Devuelve (nuevos a avisar, resueltos a avisar)."""
        actuales = set(problemas)
        self.vistos = {p: self.vistos.get(p, 0) + 1 for p in actuales}
        nuevos = [p for p in problemas if self.vistos[p] >= CONFIRMAR and p not in self.avisados]
        resueltos = sorted(self.avisados - actuales)
        self.avisados = (self.avisados | set(nuevos)) - set(resueltos)
        if nuevos or resueltos:
            self._guardar()
        return nuevos, resueltos


def _bucle(get_problemas: Callable[[], list[str]], vigia: Vigia) -> None:
    time.sleep(60)
    while True:
        try:
            nuevos, resueltos = vigia.revisar(get_problemas())
            if nuevos:
                enviar('⚠ Panel Indoor: problema detectado', 'Se detectó:\n\n- ' + '\n- '.join(nuevos) + '\n\nhttps://produccion.cloud')
            if resueltos:
                enviar('✔ Panel Indoor: problema resuelto', 'Ya no se detecta:\n\n- ' + '\n- '.join(resueltos))
        except Exception:
            log.exception('Falló la revisión de alertas por correo')
        time.sleep(INTERVALO)


def start(get_problemas: Callable[[], list[str]], state_dir: Path) -> None:
    if not configurado():
        log.info('Alertas por correo apagadas (faltan ALERTA_EMAIL_A / ALERTA_SMTP_USER / ALERTA_SMTP_PASSWORD)')
        return
    threading.Thread(target=_bucle, args=(get_problemas, Vigia(Path(state_dir) / 'alertas_correo.json')), name='alertas-correo', daemon=True).start()
