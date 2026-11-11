"""Control local y seguro de WhatsApp Web para el agente de Confección.

Usa un perfil separado; nunca comparte credenciales con el panel ni envía mensajes.
"""
from pathlib import Path
import re
import tempfile
import urllib.request
from urllib.parse import quote, urljoin
from playwright.sync_api import sync_playwright

PERFIL = Path(__file__).resolve().parent / 'datos' / 'whatsapp-playwright'

class WhatsAppConfeccion:
    def __init__(self):
        self.p = sync_playwright().start()
        PERFIL.mkdir(parents=True, exist_ok=True)
        self.browser = self.p.chromium.launch_persistent_context(str(PERFIL), headless=False, viewport={'width': 1400, 'height': 900}, args=['--disable-notifications'])
        self.page = self.browser.pages[0] if self.browser.pages else self.browser.new_page()
        self.page.goto('https://web.whatsapp.com/', wait_until='domcontentloaded')

    def preparar(self, job):
        phone = re.sub(r'\D', '', str(job.get('whatsapp') or ''))
        if not phone: raise ValueError('La tarea no tiene WhatsApp')
        curva = '\n'.join(f"{x.get('talla')}: {x.get('cantidad')}" for x in job.get('curva', []))
        texto = '\n'.join([
            'Hola ' + str(job.get('confeccionista') or ''), '',
            'Preparación de confección:',
            f"Cliente: {job.get('cliente') or '—'}",
            f"Orden: {job.get('orden') or '—'}",
            f"Referencia: {job.get('referencia') or '—'}",
            f"Cantidad: {job.get('cantidad') or '—'} prendas",
            f"Precio por prenda: $ {job.get('precio_prenda') or 0}", '',
            'Curva del listado:', curva or '—', '',
            'Los mockups están adjuntos en la tarjeta de la orden.',
            'Por favor confirmar recepción y disponibilidad. Gracias.',
        ])
        # Abrimos el chat sin texto en la caja normal. El texto debe quedar
        # como descripción de la imagen, igual que en el flujo manual de
        # WhatsApp: imagen arriba, caption abajo y solo el botón Enviar listo.
        self.page.goto('https://web.whatsapp.com/send?phone=' + phone, wait_until='domcontentloaded')
        self.page.wait_for_timeout(2500)
        archivos = []
        for i, item in enumerate(job.get('mockups', [])):
            url = item.get('share_url') or item.get('url') if isinstance(item, dict) else str(item)
            if not url: continue
            url = urljoin(str(job.get('panel_url') or 'https://produccion.cloud/'), str(url))
            destino = Path(tempfile.gettempdir()) / f"confeccion_mockup_{job.get('id','job')}_{i}.png"
            urllib.request.urlretrieve(url, destino)
            archivos.append(str(destino))
        if archivos:
            attach = self.page.get_by_role('button', name=re.compile('Adjuntar|Attach', re.I))
            with self.page.expect_file_chooser(timeout=5000) as chooser_info:
                attach.click(timeout=5000)
            chooser_info.value.set_files(archivos)
            self.page.wait_for_timeout(1800)
            cajas = self.page.locator('div[contenteditable="true"]')
            visibles = []
            for i in range(cajas.count()):
                caja = cajas.nth(i)
                try:
                    if caja.is_visible(): visibles.append(caja)
                except Exception:
                    pass
            if visibles:
                visibles[-1].fill(texto)
            else:
                # Selector alternativo de WhatsApp cuando cambia el marcado
                # del editor de caption.
                self.page.get_by_role('textbox').last().fill(texto)
            self.page.wait_for_timeout(500)
        return len(archivos)

    def cerrar(self):
        self.browser.close(); self.p.stop()

def abrir_whatsapp():
    PERFIL.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            str(PERFIL), headless=False, viewport={'width': 1400, 'height': 900},
            args=['--disable-notifications']
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto('https://web.whatsapp.com/', wait_until='domcontentloaded')
        page.wait_for_timeout(5000)
        print('WhatsApp Web abierto con perfil separado. No se envió ningún mensaje.')
        input('Inicia sesión si hace falta y presiona ENTER para cerrar la prueba...')
        browser.close()

if __name__ == '__main__':
    abrir_whatsapp()
