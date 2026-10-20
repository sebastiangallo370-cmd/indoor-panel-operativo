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


CUENTA_FILE = Path(os.getenv('CORREO_CUENTA_FILE', '/data/state/correo_cuenta.json'))


def cuenta() -> tuple[str, str]:
    """(usuario, contraseña de aplicación) con que se envían los correos: primero el .env y, si no hay, lo guardado desde el panel del agente."""
    from app import google_correo
    if google_correo.activo():   # cuenta conectada con «Iniciar sesión con Google»: sin contraseña (se envía por la API de Gmail)
        return google_correo.correo(), 'google'
    try:
        d = json.loads(CUENTA_FILE.read_text(encoding='utf-8'))
        if d.get('usuario') and d.get('clave'):
            return str(d['usuario']), str(d['clave'])
    except (OSError, ValueError):
        pass
    usuario, clave = os.getenv('ALERTA_SMTP_USER', ''), os.getenv('ALERTA_SMTP_PASSWORD', '')
    if usuario and clave:
        return usuario, clave
    # la cuenta que el panel YA usa para sus correos (SMTP_EMAIL / SMTP_PASSWORD del .env): no hay que configurar nada nuevo
    return os.getenv('SMTP_EMAIL', ''), os.getenv('SMTP_PASSWORD', '')


def puede_enviar() -> bool:
    return all(cuenta())


def configurado() -> bool:
    """Avisos de salud: necesitan además el destinatario fijo (ALERTA_EMAIL_A)."""
    return bool(os.getenv('ALERTA_EMAIL_A') and puede_enviar())


def servidor() -> tuple[str, int]:
    if os.getenv('ALERTA_SMTP_USER'):
        return os.getenv('ALERTA_SMTP_HOST', 'smtp.gmail.com'), int(os.getenv('ALERTA_SMTP_PORT', '465'))
    return os.getenv('SMTP_SERVER', 'smtp.gmail.com'), int(os.getenv('SMTP_PORT', '465'))


def _conexion():
    """Conexión segura: puerto 465 = SSL directo; 587 = STARTTLS."""
    host, puerto = servidor()
    if puerto == 587:
        s = smtplib.SMTP(host, puerto, timeout=30)
        s.starttls()
        return s
    return smtplib.SMTP_SSL(host, puerto, timeout=30)


def probar_cuenta(usuario: str, clave: str) -> None:
    """Solo inicia sesión en el servidor de correo (no envía nada). Lanza el error de Google si rechaza la cuenta o la contraseña."""
    with _conexion() as s:
        s.login(usuario, clave)


def guardar_cuenta(usuario: str, clave: str) -> None:
    CUENTA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CUENTA_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps({'usuario': usuario, 'clave': clave}), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(CUENTA_FILE)


def borrar_cuenta() -> None:
    try:
        CUENTA_FILE.unlink()
    except OSError:
        pass


def enviar(asunto: str, cuerpo: str, para: str | None = None, adjuntos: list | None = None) -> None:
    """adjuntos: lista de (nombre, bytes) en PDF."""
    from app import google_correo
    if google_correo.activo():
        return google_correo.enviar(asunto, cuerpo, para or os.environ['ALERTA_EMAIL_A'], adjuntos)
    usuario, clave = cuenta()
    msg = EmailMessage()
    msg['Subject'] = asunto
    msg['From'] = usuario
    msg['To'] = para or os.environ['ALERTA_EMAIL_A']
    msg.set_content(cuerpo)
    for nombre, datos in (adjuntos or []):
        msg.add_attachment(datos, maintype='application', subtype='pdf', filename=nombre)
    with _conexion() as s:
        s.login(usuario, clave)
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


# ---- Aviso por correo cuando la tela de un pedido programado NO ALCANZA (pestaña «Tela programada») ----
def _bucle_tela(get_faltantes: Callable[[], list[dict]], vigia: Vigia) -> None:
    time.sleep(90)
    while True:
        try:
            faltantes = {f"{o['orden']} · {o['referencia']} · {o['tela']}": o for o in get_faltantes()}
            nuevos, _resueltos = vigia.revisar(list(faltantes))
            if nuevos:
                lineas = []
                for clave in nuevos:
                    o = faltantes[clave]
                    razon = 'la tela no está en Bodega' if o.get('situacion') == 'sin_tela' else f"faltan {o['falta']:g} MTS (en Bodega quedan {o['disponible']:g})"
                    lineas.append(f"- Orden {o['orden']} · {o['tela']} · referencia {o['referencia']} · entrega {o.get('entrega') or 'sin fecha'}: "
                                  f"necesita {o['mts']:g} MTS y {razon}.")
                enviar(f"⚠ Tela que no alcanza: {', '.join(sorted({faltantes[c]['orden'] for c in nuevos}))}",
                       'Pedidos programados cuya tela no alcanza:\n\n' + '\n'.join(lineas) +
                       '\n\nVer: https://produccion.cloud (Inventarios > Panel de control > Tela programada)')
        except Exception:
            log.exception('Falló la revisión de tela que no alcanza')
        time.sleep(INTERVALO)


def start_tela(get_faltantes: Callable[[], list[dict]], state_dir: Path) -> None:
    """get_faltantes() -> órdenes con situacion 'no_alcanza' o 'sin_tela' (cada una con orden, referencia, tela, mts, falta, disponible, entrega)."""
    if not configurado():
        log.info('Aviso de tela que no alcanza apagado (faltan ALERTA_EMAIL_A / ALERTA_SMTP_USER / ALERTA_SMTP_PASSWORD)')
        return
    threading.Thread(target=_bucle_tela, args=(get_faltantes, Vigia(Path(state_dir) / 'alertas_tela_correo.json')), name='alertas-tela-correo', daemon=True).start()
