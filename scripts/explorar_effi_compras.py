"""EXPLORACIÓN SOLO LECTURA del módulo Compras de Effi con la cuenta del agente de inventario: abre el formulario «Crear orden de compra» y una orden ya hecha
(solo para ver sus campos; NO se guarda, NO se envía y NO se crea nada). Nunca imprime usuario ni contraseña. Salida: carpeta pasada como argumento."""
import json, sys, time
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

JS_CAMPOS = """
const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
const etiqueta = e => { const l = e.id && document.querySelector('label[for="'+e.id+'"]'); return (l ? l.textContent : (e.closest('.form-group,.col-md-3,.col-md-4,.col-md-6,.row')?.querySelector('label')?.textContent || e.placeholder || '')).trim().replace(/\\s+/g,' ').slice(0,70); };
return {
  url: location.href, titulo: document.title,
  encabezados: [...document.querySelectorAll('h1,h2,h3,h4,.panel-title,.box-title')].filter(vis).map(e => e.textContent.trim().replace(/\\s+/g,' ')).slice(0,25),
  campos: [...document.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden').map(e => ({tag: e.tagName.toLowerCase(), type: e.type||'', id: e.id||'', name: e.name||'', etiqueta: etiqueta(e), visible: vis(e), requerido: !!e.required || /required/.test(e.className||''), valor: e.tagName==='SELECT' ? (e.options[e.selectedIndex]||{}).text||'' : (e.type==='password'?'':String(e.value||'').slice(0,40)), opciones: e.tagName==='SELECT' ? [...e.options].slice(0,12).map(o=>o.text.trim()) : undefined})).slice(0,150),
  botones: [...document.querySelectorAll('a.btn,button,.btn')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40) + ' | ' + (e.getAttribute('href')||e.id||'')).slice(0,40),
  tabla_cols: [...document.querySelectorAll('table thead th')].filter(vis).map(e => e.textContent.trim().replace(/\\s+/g,' ')).slice(0,30)
};"""

driver = bov.setup_driver()
res = {}
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/orden_c')
    time.sleep(4)
    # direcciones de «Crear» y de «ver» una orden (solo se leen los href)
    res['enlaces'] = driver.execute_script("""
      return [...document.querySelectorAll('a')].map(a => ({t:(a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40), h:a.getAttribute('href')||''}))
        .filter(x => /orden_c/.test(x.h)).slice(0,30);""")
    # «Crear» es un botón (id=crear): solo se abre el formulario, sin guardar nada
    driver.execute_script("document.getElementById('crear').click()")
    time.sleep(6)
    res['crear_url'] = driver.current_url
    driver.save_screenshot(str(salida / 'crear.png'))
    (salida / 'crear.html').write_text(driver.page_source, encoding='utf-8')
    (salida / 'crear.json').write_text(json.dumps(driver.execute_script(JS_CAMPOS), ensure_ascii=False, indent=1), encoding='utf-8')
    (salida / 'resumen.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False)[:600])
finally:
    try:
        driver.quit()
    except Exception:
        pass
