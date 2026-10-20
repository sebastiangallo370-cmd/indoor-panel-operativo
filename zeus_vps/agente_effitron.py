"""EFFITRON: crea en Effi la cotización de una reposición de la Tienda Club y baja su PDF.
Sondea el panel (/api/effitron/pc/sondeo, mismo código de enlace que ZEUS), recibe el cuerpo de la cotización ya preparado por el panel
(artículos y precios de la cotización anterior, solo los diseños que el cliente eligió), la crea por la API de Effi (idempotency_key: un reintento
no duplica) y baja el PDF de Ventas > Cotizaciones con la sesión web. Devuelve al panel el número y el PDF.
Seguridad: NUNCA anula ni borra nada en Effi; una cotización por vez; si algo falla lo informa y el panel decide el reintento.
Reutiliza la sesión de Effi y el cliente de la API de agente_zeus.py / effi_api.py (mismas credenciales: zeus.env)."""
import base64
import os
import socket
import sys
import time
import urllib.error

import agente_zeus as z
import effi_api

SONDEO_SEG = 15


def pdf_de_cotizacion(effi, cot_id: str) -> str:
    """PDF de la cotización desde Ventas > Cotizaciones («Ver PDF»), con la sesión abierta. Devuelve base64 o lanza RuntimeError."""
    d = effi.driver
    d.get('https://effi.com.co/app/cotizacion')
    time.sleep(5)
    href = ''
    for _ in range(3):
        href = d.execute_script("""
          const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.children.length >= 7 && (t.children[3].innerText||'').trim() === arguments[0]);
          if (!tr) return '';
          const a = [...tr.querySelectorAll('a')].find(x => /consultar_pdf/.test(x.getAttribute('href') || '')); return a ? a.href : '';""", str(cot_id))
        if href:
            break
        time.sleep(3)
        d.refresh()
        time.sleep(4)
    if not href:
        raise RuntimeError(f'No encontré el enlace «Ver PDF» de la cotización {cot_id}')
    d.set_script_timeout(60)
    b64 = d.execute_async_script("""
      const fin = arguments[arguments.length - 1];
      fetch(arguments[0], {credentials: 'include'}).then(r => r.blob()).then(b => { const f = new FileReader(); f.onloadend = () => fin(String(f.result).split(',')[1] || ''); f.readAsDataURL(b); }).catch(() => fin(''));""", href)
    if not b64 or base64.b64decode(b64)[:4] != b'%PDF':
        raise RuntimeError('Effi no devolvió un PDF válido')
    return b64


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:   # noqa: BLE001
        pass
    panel = {'url': os.environ.get('ZEUS_PANEL_URL', ''), 'token': os.environ.get('ZEUS_AGENT_TOKEN', '')}
    if not panel['url'] or not panel['token']:
        print('Falta ZEUS_PANEL_URL / ZEUS_AGENT_TOKEN en el entorno.')
        sys.exit(1)
    cred = z.credenciales()
    tiene_cred = bool(cred.get('ZEUS_EFFI_USERNAME') and cred.get('ZEUS_EFFI_PASSWORD'))
    url = panel['url'].rstrip('/') + '/api/effitron/pc/sondeo'
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
    effi = z.Effi(z._Bov, By, EC, WebDriverWait, cred)
    equipo = socket.gethostname()
    resultados, estado, ultima = [], 'LIBRE' if tiene_cred else 'ESPERANDO_EFFI', 'Iniciado'
    z.log(f'EFFITRON · {equipo} · panel {panel["url"]}')
    try:
        while True:
            try:
                resp = z.peticion(url, panel['token'], {'equipo': equipo, 'estado': estado, 'ultima': ultima, 'puede_trabajar': tiene_cred and estado != 'ERROR', 'resultados': resultados})
                resultados = []
                for job in resp.get('trabajos', []):
                    estado = 'TRABAJANDO'
                    pid = job['id']
                    try:
                        if job.get('tipo') == 'pdf':
                            cot = {'id': str(job['cot_id']), 'prefijo': '', 'total': None}
                        else:
                            effi_api.usar_llave((job.get('api') or {}).get('llave', ''))
                            if not effi_api.disponible():
                                raise RuntimeError('El panel no mandó la llave de la API de Effi')
                            z.log(f'Creando la cotización del pedido #{pid}')
                            cot = effi_api.crear_cotizacion(job['cuerpo'])
                            z.log(f"Cotización {cot['id']} creada en Effi")
                        # el panel debe saber YA que la cotización existe (aunque el PDF falle, no se vuelve a crear)
                        pdf_b64 = ''
                        try:
                            effi.abrir()
                            pdf_b64 = pdf_de_cotizacion(effi, cot['id'])
                        except Exception as e:   # noqa: BLE001
                            z.log(f'Sin PDF de la cotización {cot["id"]}: {str(e)[:120]}')
                            effi.cerrar()
                        resultados.append({'id': pid, 'ok': True, 'cot_id': cot['id'], 'numero': cot['id'], 'total': cot.get('total'), 'pdf_b64': pdf_b64})
                        ultima = f"Cotización {cot['id']} del pedido #{pid} " + ('lista con PDF' if pdf_b64 else 'creada (falta el PDF)')
                    except Exception as e:   # noqa: BLE001
                        resultados.append({'id': pid, 'ok': False, 'detalle': str(e)[:290]})
                        ultima = f'Error en el pedido #{pid}: {str(e)[:160]}'
                        effi.cerrar()
                    z.log(ultima)
                    estado = 'LIBRE'
                if resultados:   # se reportan ya, sin esperar el siguiente sondeo
                    try:
                        z.peticion(url, panel['token'], {'equipo': equipo, 'estado': estado, 'ultima': ultima, 'puede_trabajar': False, 'resultados': resultados})
                        resultados = []
                    except Exception:   # noqa: BLE001
                        pass
            except urllib.error.HTTPError as e:
                z.log(f'El panel respondió {e.code} (¿código de enlace vencido?)')
            except Exception as e:   # noqa: BLE001
                z.log(f'Sin conexión con el panel: {e}')
            if effi.driver and time.time() - effi.ultimo_uso > z.OCIOSO_CIERRA_SEG:
                effi.cerrar()
            time.sleep(SONDEO_SEG)
    except KeyboardInterrupt:
        pass
    finally:
        effi.cerrar()


if __name__ == '__main__':
    main()
