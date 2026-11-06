"""Worker local de WhatsApp Web para la cola de produccion.cloud.

Se ejecuta en el PC que tiene la cuenta de WhatsApp. Usa un perfil propio y
visible de Playwright; nunca copia cookies ni perfiles del navegador habitual.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
from pathlib import Path

import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_URL = os.getenv('WHATSAPP_PANEL_URL', 'https://produccion.cloud').rstrip('/')
TOKEN = os.getenv('WHATSAPP_WORKER_TOKEN', '')
PROFILE = Path(os.getenv('WHATSAPP_PROFILE_DIR', str(Path.home() / '.indoor-whatsapp-profile')))
WAIT_SECONDS = max(3, int(os.getenv('WHATSAPP_WORKER_WAIT_SECONDS', '8')))
DEFAULT_CHROME = Path(os.getenv('PROGRAMFILES', r'C:\Program Files')) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'
CHROME_EXECUTABLE = os.getenv('WHATSAPP_CHROME_EXECUTABLE', str(DEFAULT_CHROME))


def api(path: str, payload: dict | None = None) -> dict:
    if not TOKEN or len(TOKEN) < 32:
        raise RuntimeError('Falta WHATSAPP_WORKER_TOKEN; no se iniciará el worker.')
    response = requests.post(BASE_URL + path, json=payload or {}, headers={'X-WhatsApp-Worker-Token': TOKEN}, timeout=25)
    response.raise_for_status()
    return response.json()


def heartbeat(state: str) -> None:
    try:
        api('/api/whatsapp/worker/heartbeat', {'state': state})
    except requests.RequestException:
        pass


def send_one(page, message: dict) -> tuple[str, str, str]:
    """Retorna estado, evidencia breve, nota. No deduce entrega o lectura."""
    if message['test_mode']:
        return 'prepared', '', 'Modo prueba activo: mensaje preparado, no enviado.'
    encoded = urllib.parse.urlencode({'phone': message['phone'].lstrip('+'), 'text': message['body']})
    page.goto('https://web.whatsapp.com/send?' + encoded, wait_until='domcontentloaded', timeout=60000)
    try:
        send = page.get_by_role('button', name='Enviar').last
        send.wait_for(state='visible', timeout=25000)
        send.click()
        # La evidencia solo significa que WhatsApp Web aceptó el clic de envío.
        page.wait_for_timeout(1200)
        return 'sent', 'Botón Enviar visible y accionado en WhatsApp Web.', ''
    except PlaywrightTimeoutError:
        # WhatsApp cambia su interfaz con frecuencia: no se reintenta automáticamente.
        return 'uncertain', '', 'No apareció el control Enviar; revisar sesión, número o interfaz de WhatsApp Web.'


def main() -> None:
    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        # Usamos el Chrome ya instalado por la oficina: Playwright no necesita
        # descargar otro navegador ni tocar el perfil diario de Chrome.
        executable = CHROME_EXECUTABLE if Path(CHROME_EXECUTABLE).is_file() else None
        browser = pw.chromium.launch_persistent_context(str(PROFILE), headless=False, executable_path=executable)
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto('https://web.whatsapp.com', wait_until='domcontentloaded', timeout=60000)
        heartbeat('Abierto; si aparece QR, escanéalo en este navegador del worker.')
        while True:
            try:
                data = api('/api/whatsapp/worker/claim')
                message = data.get('message')
                if not message:
                    heartbeat('Conectado; cola ' + str(data.get('reason', 'vacía')))
                    time.sleep(WAIT_SECONDS)
                    continue
                heartbeat('Procesando un mensaje')
                status, evidence, note = send_one(page, message)
                api('/api/whatsapp/worker/complete', {'id': message['id'], 'status': status, 'evidence': evidence, 'note': note})
                heartbeat('Conectado; resultado ' + status)
            except requests.RequestException as exc:
                heartbeat('Sin conexión al panel')
                time.sleep(WAIT_SECONDS)
            except Exception as exc:  # el trabajo reservado vence como incierto, nunca se reenvía solo
                heartbeat('Error local del worker')
                time.sleep(WAIT_SECONDS)


if __name__ == '__main__':
    main()
