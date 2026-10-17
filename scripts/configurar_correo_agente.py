"""Configura en el servidor la cuenta de Gmail que ENVÍA los correos del panel (verificación de correos, órdenes de compra del AGENTE INVENTARIO,
avisos de tela que no alcanza y avisos de salud).

Se ejecuta en TU terminal y te pide los datos ahí mismo: la contraseña de aplicación se escribe oculta y viaja directo al servidor por SSH
(no queda en el chat, ni en el historial de comandos, ni en el repositorio). Hace una copia del .env antes de tocarlo y reinicia el panel.

Uso (PowerShell, desde la carpeta del proyecto):   python scripts\\configurar_correo_agente.py
"""
import getpass
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HOST = 'root@179.236.66.149'
LLAVE = Path.home() / '.ssh' / 'hostinger_indoor'
CARPETA = '/opt/asistente-reprogramaciones'
CORREO = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')


def pedir_correo(texto: str, defecto: str = '') -> str:
    while True:
        valor = input(f'{texto}{f" [{defecto}]" if defecto else ""}: ').strip().lower() or defecto
        if CORREO.match(valor):
            return valor
        print('  Eso no parece un correo. Intenta de nuevo.')


def armar_lineas(cuenta: str, clave: str, destino: str) -> str:
    """Las 3 variables que lee el panel (alertas_correo.py)."""
    return f'ALERTA_EMAIL_A={destino}\nALERTA_SMTP_USER={cuenta}\nALERTA_SMTP_PASSWORD={clave}\n'


def ssh(comando: str, entrada: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(['ssh', '-i', str(LLAVE), '-o', 'StrictHostKeyChecking=accept-new', HOST, comando], input=entrada, text=True, capture_output=True, timeout=300)


def main() -> int:
    if not LLAVE.exists():
        print(f'No encuentro la llave SSH del servidor en {LLAVE}.')
        return 1
    print('Configurar la cuenta de Gmail que envía los correos del panel.\n')
    cuenta = pedir_correo('Correo Gmail del agente (el que ENVÍA)')
    clave = getpass.getpass('Contraseña de aplicación de esa cuenta (16 letras; no se verá al escribir): ').replace(' ', '').strip()
    if len(clave) < 12:
        print('La contraseña de aplicación de Google tiene 16 letras. Revísala (no es la contraseña normal de la cuenta).')
        return 1
    destino = pedir_correo('Correo que recibe los avisos de salud del panel', cuenta)
    print(f'\nSe va a configurar: envía {cuenta} · avisos de salud a {destino} · contraseña oculta ({len(clave)} caracteres).')
    if input('¿Aplicar en el servidor y reiniciar el panel? (s/n): ').strip().lower() != 's':
        print('Cancelado: no se cambió nada.')
        return 0
    copia = f'.env.bak_{datetime.now():%Y%m%d_%H%M%S}'
    r = ssh(f'cd {CARPETA} && cp .env {copia} && grep -v "^ALERTA_" .env > .env.nuevo && cat >> .env.nuevo && mv .env.nuevo .env && chmod 600 .env', armar_lineas(cuenta, clave, destino))
    if r.returncode:
        print('No se pudo escribir en el servidor:', r.stderr.strip()[:300])
        return 1
    print(f'Listo: guardado en el servidor (copia de seguridad: {copia}). Reiniciando el panel…')
    r = ssh(f'cd {CARPETA} && docker compose up -d asistente')
    if r.returncode:
        print('No se pudo reiniciar el panel:', r.stderr.strip()[:300])
        return 1
    for _ in range(30):
        time.sleep(4)
        try:
            if urllib.request.urlopen('https://produccion.cloud/salud', timeout=10).status == 200:
                print('El panel volvió a estar en línea. Ya puedes pulsar «Reenviar» en el AGENTE INVENTARIO para que salga el mensaje de verificación.')
                return 0
        except Exception:  # noqa: BLE001
            continue
    print('El panel tardó más de lo normal en responder; revisa https://produccion.cloud/salud en un minuto.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
