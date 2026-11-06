"""EXPLORACIÓN SOLO LECTURA: abre en Effi el menú de una orden de compra > «Enviar por correo electrónico» y lee la ventana (campos y botones).
NO envía nada. Uso: python explorar_effi_correo.py <carpeta_salida> <id_orden>"""
import json, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
ID = sys.argv[2]
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

JS_MODAL = """
const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const m = [...document.querySelectorAll('.modal')].filter(e => vis(e) && getComputedStyle(e).display !== 'none').pop();
if (!m) return null;
return {id: m.id, titulo: ((m.querySelector('.modal-title,h4,h3')||{}).textContent||'').trim().slice(0,80),
  campos: [...m.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden' && vis(e)).map(e => ({id: e.id, name: e.name, tipo: e.type, ph: e.placeholder||'', valor: (e.type==='password'?'':String(e.value||'').slice(0,80)), etiqueta: ((e.closest('.form-group')||{}).innerText||'').trim().replace(/\\s+/g,' ').slice(0,50)})),
  botones: [...m.querySelectorAll('button,a.btn')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40) + ' | ' + (e.id||'')),
  texto: m.innerText.replace(/\\s+/g,' ').slice(0,500)};"""

driver = bov.setup_driver()
res = {}
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/orden_c'); time.sleep(4)
    res['celdas'] = driver.execute_script("const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.getBoundingClientRect().width > 0); return tr ? [...tr.children].map(c => (c.innerText||'').replace(/\s+/g,' ').trim().slice(0,30)) : null;")
    print(res['celdas'])
    # fila de la orden y su menú desplegable (solo se abre el menú)
    res['fila'] = driver.execute_script("""
      const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.children.length >= 6 && (t.children[3].innerText||'').trim() === arguments[0]);
      if (!tr) return null;
      const b = tr.querySelector('.dropdown-toggle, button.dropdown-toggle, [data-toggle="dropdown"]'); if (b) b.click();
      return {texto: tr.innerText.replace(/\\s+/g,' ').slice(0,120), tiene_menu: !!b};""", ID)
    time.sleep(1)
    res['opciones'] = driver.execute_script("return [...document.querySelectorAll('.dropdown-menu.show a, .dropdown-menu a, .open .dropdown-menu a')].filter(a => a.getBoundingClientRect().width > 0).map(a => (a.textContent||'').trim().replace(/\\s+/g,' ') + ' | ' + (a.getAttribute('href')||'') + ' | ' + (a.className||''))")
    driver.save_screenshot(str(salida / 'menu.png'))
    abierto = driver.execute_script("""
      const a = [...document.querySelectorAll('.dropdown-menu a')].find(a => a.getBoundingClientRect().width > 0 && /enviar por correo/i.test(a.textContent));
      if (!a) return false; a.click(); return true;""")
    res['abrio_enviar'] = abierto
    time.sleep(3)
    res['ventana'] = driver.execute_script(JS_MODAL)
    driver.save_screenshot(str(salida / 'enviar.png'))
    (salida / 'correo.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False)[:2500])
finally:
    try:
        driver.quit()
    except Exception:
        pass
