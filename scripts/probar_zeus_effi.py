"""Comprueba (SOLO LECTURA) que la cuenta de Effi del AGENTE INVENTARIO entra y llega a Compras > Órdenes de compra.
Lee ecommerce\\datos\\zeus_effi.env (nunca imprime usuario ni contraseña). No crea ni guarda nada en Effi."""
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
usuario, clave = datos.get('ZEUS_EFFI_USERNAME', ''), datos.get('ZEUS_EFFI_PASSWORD', '')
res = {'usuario_cargado': bool(usuario), 'clave_cargada': bool(clave), 'largo_clave': len(clave)}
if not (usuario and clave):
    (salida / 'zeus.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res)); sys.exit(1)

import importlib.util
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
mo, bov, ruta = ag.cargar_ov(con_effi=True)
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

driver = bov.setup_driver()
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(usuario)
    driver.find_element(By.ID, 'password').send_keys(clave)
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    try:
        espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
        res['entro'] = True
    except Exception:
        res['entro'] = False
        res['pagina'] = (driver.find_element(By.TAG_NAME, 'body').text or '')[:300]
        driver.save_screenshot(str(salida / 'zeus_login_fallo.png'))
    if res.get('entro'):
        res['usuario_effi'] = (driver.execute_script("return (document.querySelector('.navbar .user-name, .dropdown-toggle .hidden-xs, [class*=user]')||{}).textContent||''") or '').strip()[:60]
        driver.get('https://effi.com.co/app/orden_c')
        time.sleep(4)
        res['url'] = driver.current_url
        res['titulo'] = driver.title
        res['texto'] = (driver.execute_script("return (document.querySelector('h1,h2,.page-title')||{}).textContent||''") or '').strip()[:80]
        res['hay_boton_crear'] = bool(driver.execute_script("return [...document.querySelectorAll('a,button')].some(e => /crear/i.test(e.textContent||''))"))
        res['ordenes'] = driver.execute_script("return ((document.body.innerText.match(/(\\d+) órdenes de compra encontradas/i)||[])[1])||''")
        res['en_compras'] = 'orden_c' in res['url']
        driver.save_screenshot(str(salida / 'zeus_orden_c.png'))
    (salida / 'zeus.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False))
finally:
    try:
        driver.quit()
    except Exception:
        pass
