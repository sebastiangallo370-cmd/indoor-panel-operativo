"""Worker central y visible para el portal DIAN.

Se ejecuta en el VPS, no dentro de FastAPI. Solo toma un CUFE por turno y no
intenta evadir controles ni repetir resultados inciertos. Los selectores se
configuran por variables de entorno para poder ajustarlos cuando DIAN cambie su
interfaz, sin editar ni registrar datos de usuarios.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_URL = os.getenv('DIAN_PANEL_URL', 'https://produccion.cloud').rstrip('/')
WORKER_TOKEN = os.getenv('DIAN_WORKER_TOKEN', '')
PROFILE = Path(os.getenv('DIAN_BROWSER_PROFILE', '/data/dian-browser-profile'))
WAIT_SECONDS = max(3, int(os.getenv('DIAN_WORKER_WAIT_SECONDS', '8')))

# Se definen tras validar el portal DIAN real con un CUFE de prueba.
SEARCH_URL = os.getenv('DIAN_SEARCH_URL', '')
CUFE_SELECTOR = os.getenv('DIAN_CUFE_SELECTOR', '')
SEARCH_SELECTOR = os.getenv('DIAN_SEARCH_SELECTOR', '')
XML_SELECTOR = os.getenv('DIAN_XML_SELECTOR', '')
PDF_SELECTOR = os.getenv('DIAN_PDF_SELECTOR', '')


def api(path: str, body: dict | None = None) -> dict:
    if len(WORKER_TOKEN) < 32:
        raise RuntimeError('Falta DIAN_WORKER_TOKEN; el worker no inicia.')
    response = requests.post(
        BASE_URL + path, json=body or {},
        headers={'X-DIAN-Worker-Token': WORKER_TOKEN}, timeout=45,
    )
    response.raise_for_status()
    return response.json()


def complete(document_id: int, status: str, note: str = '', evidence: str = '', filename: str = '') -> None:
    api('/api/dian/worker/result', {
        'document_id': document_id, 'status': status, 'note': note[:240],
        'evidence': evidence[:240], 'filename': filename[:180],
    })


def process_one(page, job: dict) -> tuple[str, str, str, str]:
    """Descarga un documento solo si hay evidencia visible de aceptación."""
    if not all((SEARCH_URL, CUFE_SELECTOR, SEARCH_SELECTOR)):
        return ('uncertain', '', '', 'Faltan los selectores DIAN validados; no se automatizó este CUFE.')
    try:
        page.goto(job['token'], wait_until='domcontentloaded', timeout=60_000)
        page.goto(SEARCH_URL, wait_until='domcontentloaded', timeout=60_000)
        field = page.locator(CUFE_SELECTOR)
        field.wait_for(state='visible', timeout=25_000)
        field.fill(job['cufe'])
        page.locator(SEARCH_SELECTOR).click()
        selector = XML_SELECTOR if job['format'] == 'XML' else PDF_SELECTOR
        if not selector:
            return ('uncertain', '', '', f'No existe selector configurado para {job["format"]}.')
        with page.expect_download(timeout=35_000) as pending:
            page.locator(selector).wait_for(state='visible', timeout=25_000)
            page.locator(selector).click()
        download = pending.value
        filename = download.suggested_filename
        target = Path('/mnt/nas/DIAN DESCARGAS') / job['destination'] / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        download.save_as(str(target))
        if not target.is_file() or target.stat().st_size == 0:
            return ('uncertain', '', '', 'DIAN indicó descarga, pero no apareció un archivo utilizable.')
        return ('downloaded', filename, 'Descarga visible aceptada por DIAN y archivo guardado.', '')
    except PlaywrightTimeoutError:
        return ('uncertain', '', '', 'DIAN no mostró un control o descarga verificable; requiere revisión.')
    except Exception as exc:
        return ('failed', '', '', f'Error conocido del worker: {type(exc).__name__}.')


def main() -> None:
    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(str(PROFILE), headless=True, accept_downloads=True)
        page = context.pages[0] if context.pages else context.new_page()
        while True:
            try:
                job = api('/api/dian/worker/claim').get('job')
                if not job:
                    time.sleep(WAIT_SECONDS)
                    continue
                status, filename, evidence, note = process_one(page, job)
                complete(job['document_id'], status, note, evidence, filename)
            except requests.RequestException:
                time.sleep(WAIT_SECONDS)
            except Exception:
                # Si el resultado no pudo reportarse, queda reservado para
                # revisión; el worker no vuelve a enviar ni descargar a ciegas.
                time.sleep(WAIT_SECONDS)


if __name__ == '__main__':
    main()
