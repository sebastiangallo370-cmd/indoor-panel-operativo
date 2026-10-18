"""Crea en Effi el webhook «Creación de Orden de venta» que avisa al panel. Uso:
  python crear_webhook_effi.py <carpeta_salida>              -> solo lista las plataformas destino (no crea nada)
  python crear_webhook_effi.py <carpeta_salida> --crear      -> crea el webhook (la URL con el código secreto viene en la variable de entorno WEBHOOK_URL)"""
import json, os, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
CREAR = '--crear' in sys.argv
ENV = Path(r'C:\Users\Administrador\Desktop\agentes_uniformes\ecommerce\datos\zeus_effi.env')
datos = {}
for linea in ENV.read_text(encoding='utf-8').splitlines():
    if '=' in linea and not linea.lstrip().startswith('#'):
        k, v = linea.split('=', 1)
        datos[k.strip()] = v.strip().strip('"').strip("'")
import importlib.util
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
mo, bov, ruta = ag.cargar_ov(con_effi=True)
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

JS_ELEGIR = """
const s = document.getElementById(arguments[0]); if (!s) return null;
const o = [...s.options].find(o => o.value === arguments[1] || o.text.trim() === arguments[1]); if (!o) return null;
s.value = o.value; $(s).trigger('chosen:updated').trigger('change'); return o.text.trim();"""

driver = bov.setup_driver()
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/webhook'); time.sleep(4)
    driver.execute_script("document.getElementById('crear').click()"); time.sleep(4)
    selects = driver.execute_script("return [...document.querySelectorAll('select')].filter(s => /_CR$/.test(s.id)).map(s => ({id: s.id, n: s.options.length, primeras: [...s.options].slice(0, 12).map(o => o.value + '=' + o.text.trim())}))")
    for s in selects:
        print('SELECT', s['id'], s['n'], s['primeras'] if 'evento' not in s['id'] else '...')
    if CREAR:
        url = os.environ['WEBHOOK_URL']
        plataforma_id = 'api_CR'   # «Plataforma destino»: única opción «Servidor propio»
        plataforma = os.environ.get('WEBHOOK_PLATAFORMA', 'default')
        print('evento ->', driver.execute_script(JS_ELEGIR, 't_evento_webhook_CR', 'orden_v.crear'))
        print('plataforma ->', driver.execute_script(JS_ELEGIR, plataforma_id, plataforma))
        driver.execute_script("const n = document.getElementById('nombre_CR'); n.value = arguments[0]; n.dispatchEvent(new Event('input', {bubbles: true}));", 'Panel Indoor · orden de venta nueva')
        driver.execute_script("const u = document.getElementById('url_CR'); u.value = arguments[0]; u.dispatchEvent(new Event('input', {bubbles: true}));", url)
        driver.save_screenshot(str(salida / 'webhook_lleno.png'))
        driver.execute_script("document.getElementById('btnValidarCrear').click()"); time.sleep(6)
        driver.save_screenshot(str(salida / 'webhook_creado.png'))
        fila = driver.execute_script("const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.children.length >= 6); return tr ? [...tr.children].map(c => (c.innerText||'').replace(/\\s+/g,' ').trim().slice(0, 50).replace(/webhook\\/[\\w\\-]+/, 'webhook/«código»')) : null")
        print('fila creada:', fila)
        print('mensajes:', driver.execute_script("return [...document.querySelectorAll('.alert,.swal2-popup,.noty_message,.has-error')].map(e => e.innerText.replace(/\\s+/g,' ').trim().slice(0,160)).slice(0,3)"))
finally:
    try:
        driver.quit()
    except Exception:
        pass
