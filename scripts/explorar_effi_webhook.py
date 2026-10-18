"""EXPLORACIÓN SOLO LECTURA: abre «Crear» en Webhooks de Effi y lee los campos y los eventos disponibles. NO guarda nada (se sale sin crear).
Uso: python explorar_effi_webhook.py <carpeta_salida>"""
import json, re, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
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

JS = """
const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
const et = e => { const l = e.id && document.querySelector('label[for="'+e.id+'"]'); return (l ? l.textContent : ((e.closest('.form-group,.col-md-3,.col-md-4,.col-md-6,.col-md-12,.row')||document).querySelector('label')||{}).textContent||'').trim().replace(/\\s+/g,' ').slice(0,70); };
return {url: location.href,
  campos: [...document.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden' && vis(e)).map(e => ({tag: e.tagName.toLowerCase(), type: e.type||'', id: e.id||'', name: e.name||'', ph: (e.placeholder||'').slice(0,60), etiqueta: et(e),
     requerido: !!e.required, opciones: e.tagName==='SELECT' ? [...e.options].map(o => o.text.trim()).slice(0, 80) : undefined})),
  botones: [...document.querySelectorAll('button,a.btn,.btn')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40) + ' | ' + (e.id||'')).slice(0,20),
  texto: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,1500)};"""

driver = bov.setup_driver()
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/webhook')
    time.sleep(4)
    driver.execute_script("document.getElementById('crear').click()")
    time.sleep(5)
    res = driver.execute_script(JS)
    res['selects'] = driver.execute_script("return [...document.querySelectorAll('select')].filter(s => /evento|plataforma|webhook|destino/i.test((s.id||'')+(s.name||''))).map(s => ({id: s.id, name: s.name, opciones: [...s.options].map(o => o.value + '=' + o.text.trim())}))")
    (salida / 'webhook_crear.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    driver.save_screenshot(str(salida / 'webhook_crear.png'))
    print('url', res['url'], '| campos', len(res['campos']))
    for c in res['campos']:
        print(' ', c['tag'], c['id'] or c['name'], '|', c['etiqueta'], '|', (c.get('opciones') or [])[:6])
    print('botones:', res['botones'])
    for sel in res['selects']:
        print('SELECT', sel['id'] or sel['name'], len(sel['opciones']), sel['opciones'][:60])
finally:
    try:
        driver.quit()
    except Exception:
        pass
