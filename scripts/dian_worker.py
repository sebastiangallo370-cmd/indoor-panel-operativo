"""Worker central y visible para el portal DIAN.

Se ejecuta en el VPS, no dentro de FastAPI. Solo toma un CUFE por turno y no
intenta evadir controles ni repetir resultados inciertos. Los selectores se
configuran por variables de entorno para poder ajustarlos cuando DIAN cambie su
interfaz, sin editar ni registrar datos de usuarios.
"""
from __future__ import annotations

import os
import time
import zipfile
from datetime import datetime
from pathlib import Path

import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

BASE_URL = os.getenv('DIAN_PANEL_URL', 'https://produccion.cloud').rstrip('/')
WORKER_TOKEN = os.getenv('DIAN_WORKER_TOKEN', '')
WORKER_TOKEN_FILE = Path(os.getenv('DIAN_WORKER_TOKEN_FILE', '/data/state/dian_worker_token'))
PROFILE = Path(os.getenv('DIAN_BROWSER_PROFILE', '/data/dian-browser-profile'))
WAIT_SECONDS = max(3, int(os.getenv('DIAN_WORKER_WAIT_SECONDS', '8')))

# El flujo automático usa únicamente las consultas autenticadas por el token.
# La búsqueda pública de DIAN exige CAPTCHA y queda fuera de este worker.
SEARCH_URLS = tuple(url.strip() for url in os.getenv(
    'DIAN_SEARCH_URLS',
    'https://catalogo-vpfe.dian.gov.co/Document/Received,'
    'https://catalogo-vpfe.dian.gov.co/Document/Sent',
).split(',') if url.strip())
CUFE_SELECTOR = os.getenv('DIAN_CUFE_SELECTOR', '#DocumentKey')
SEARCH_SELECTOR = os.getenv('DIAN_SEARCH_SELECTOR', 'button.btn-search')
DATE_SELECTOR = os.getenv('DIAN_DATE_SELECTOR', '#dashboard-report-range')
NO_RESULTS_TEXT = 'Ningún documento disponible para mostrar.'
# En las páginas autenticadas la descarga oficial es un ZIP por documento,
# disparado por el botón de la primera celda de su fila. No usamos la
# búsqueda pública ni controles que requieran CAPTCHA.
DOWNLOAD_BUTTON_SELECTOR = os.getenv(
    'DIAN_DOWNLOAD_BUTTON_SELECTOR',
    'table tbody tr:not(:has-text("Ningún documento disponible para mostrar.")) button',
)
RESULT_ROW_SELECTOR = os.getenv(
    'DIAN_RESULT_ROW_SELECTOR',
    'table tbody tr:not(:has-text("Ningún documento disponible para mostrar."))',
)
MONTHS_ES = ('ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
             'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE')


def api(path: str, body: dict | None = None) -> dict:
    token = WORKER_TOKEN
    if len(token) < 32:
        try:
            token = WORKER_TOKEN_FILE.read_text(encoding='utf-8').strip()
        except OSError:
            token = ''
    if len(token) < 32:
        raise RuntimeError('Falta DIAN_WORKER_TOKEN; el worker no inicia.')
    response = requests.post(
        BASE_URL + path, json=body or {},
        headers={'X-DIAN-Worker-Token': token}, timeout=45,
    )
    response.raise_for_status()
    return response.json()


def complete(document_id: int, status: str, note: str = '', evidence: str = '', filename: str = '') -> None:
    api('/api/dian/worker/result', {
        'document_id': document_id, 'status': status, 'note': note[:240],
        'evidence': evidence[:240], 'filename': filename[:180],
    })


def _extract_requested_file(archive: Path, destination: Path, file_format: str) -> Path | None:
    """Extrae exclusivamente PDF o XML y evita rutas manipuladas en el ZIP."""
    suffix = '.' + file_format.lower()
    with zipfile.ZipFile(archive) as zipped:
        entries = [entry for entry in zipped.infolist()
                   if not entry.is_dir() and Path(entry.filename).suffix.lower() == suffix]
        if not entries:
            return None
        # DIAN entrega un PDF y un XML por CUFE. Si en el futuro añade otros
        # archivos, se conserva solo el primero del formato solicitado.
        entry = entries[0]
        safe_name = Path(entry.filename).name
        if not safe_name or safe_name in {'.', '..'}:
            return None
        target = (destination / safe_name).resolve()
        destination_resolved = destination.resolve()
        if destination_resolved not in target.parents:
            return None
        with zipped.open(entry) as source, target.open('wb') as output:
            output.write(source.read())
    return target


def _date_folder(raw: str) -> str:
    """Convierte la fecha visible de DIAN a MES_DIA, por ejemplo OCTUBRE_31."""
    value = str(raw or '').strip()
    for pattern in ('%d-%m-%Y', '%d/%m/%Y', '%Y-%m-%d'):
        try:
            date = datetime.strptime(value, pattern)
            return f'{MONTHS_ES[date.month - 1]}_{date.day:02d}'
        except ValueError:
            continue
    return 'SIN_FECHA'


def process_one(page, job: dict) -> tuple[str, str, str, str]:
    """Descarga un documento solo si hay evidencia visible de aceptación."""
    if not SEARCH_URLS:
        return ('uncertain', '', '', 'No hay rutas autenticadas DIAN configuradas.')
    try:
        page.goto(job['token'], wait_until='domcontentloaded', timeout=60_000)
        # Se busca tanto en recibidos como en enviados. El rango amplio evita
        # que el filtro diario de DIAN oculte un CUFE antiguo.
        found = False
        for search_url in SEARCH_URLS:
            page.goto(search_url, wait_until='domcontentloaded', timeout=60_000)
            field = page.locator(CUFE_SELECTOR)
            field.wait_for(state='visible', timeout=25_000)
            if DATE_SELECTOR:
                date = page.locator(DATE_SELECTOR)
                if date.count():
                    start = str(job.get('date_from') or '2020-01-01').replace('-', '/')
                    end = str(job.get('date_to') or '2035-12-31').replace('-', '/')
                    date.fill(f'{start} - {end}')
                    date.press('Enter')
            field.fill(job['cufe'])
            page.locator(SEARCH_SELECTOR).click()
            page.wait_for_timeout(1_500)
            if NO_RESULTS_TEXT not in page.locator('body').inner_text():
                found = True
                break
        if not found:
            return ('failed', '', '', 'DIAN no encontró el CUFE en documentos recibidos ni enviados.')
        row = page.locator(RESULT_ROW_SELECTOR).filter(has=page.locator('button')).first
        cells = row.locator('td')
        # Columnas oficiales: [descarga, recepción, fecha, ...]. La fecha del
        # documento organiza el destino como MES_DIA.
        date_folder = _date_folder(cells.nth(2).inner_text(timeout=10_000))
        selector = DOWNLOAD_BUTTON_SELECTOR
        with page.expect_download(timeout=35_000) as pending:
            page.locator(selector).wait_for(state='visible', timeout=25_000)
            page.locator(selector).click()
        download = pending.value
        base_destination = Path('/mnt/nas/DIAN DESCARGAS') / job['destination']
        destination = base_destination / date_folder
        destination.mkdir(parents=True, exist_ok=True)
        archive = destination / (job['cufe'] + '.zip')
        download.save_as(str(archive))
        if not archive.is_file() or archive.stat().st_size == 0:
            return ('uncertain', '', '', 'DIAN indicó descarga, pero no apareció un archivo utilizable.')
        target = _extract_requested_file(archive, destination, job['format'])
        archive.unlink(missing_ok=True)
        if not target or not target.is_file() or target.stat().st_size == 0:
            return ('uncertain', '', '', f'DIAN entregó el ZIP, pero no incluyó un archivo {job["format"]} utilizable.')
        relative_filename = target.relative_to(base_destination).as_posix()
        return ('downloaded', relative_filename, 'Descarga oficial DIAN visible, ZIP eliminado y formato solicitado guardado por MES_DIA.', '')
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
