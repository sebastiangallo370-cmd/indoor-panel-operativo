"""EXPLORACIÓN SOLO LECTURA de Effi (cuenta del agente de inventario): en «Crear orden de compra» abre la lupa del campo Artículo, busca cada código de tela
en la columna Referencia, elige la fila y lee qué rellena Effi (descripción, precio, proveedor...). NO se guarda ni se crea nada: el formulario se descarta al salir.
Nunca imprime usuario ni contraseña. Uso: python explorar_effi_articulo.py <carpeta_salida> CODIGO1 CODIGO2 ..."""
import json, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
consultas = sys.argv[2:] or ['700']
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
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

JS_VIS = "const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };"
JS_MODAL = JS_VIS + """
const m = [...document.querySelectorAll('.modal')].filter(e => vis(e) && getComputedStyle(e).display !== 'none').pop();
if (!m) return null;
return {id: m.id, titulo: ((m.querySelector('.modal-title,h4,h3')||{}).textContent||'').trim().slice(0,80),
  inputs: [...m.querySelectorAll('input,select')].filter(e => e.type !== 'hidden' && vis(e)).map(e => ({id: e.id, name: e.name, ph: e.placeholder || '', type: e.type})).slice(0, 14),
  botones: [...m.querySelectorAll('button,a.btn')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30) + ' | ' + (e.id||'')).slice(0, 15),
  filas: [...m.querySelectorAll('table tbody tr')].filter(vis).map(tr => tr.innerText.replace(/\\s+/g,' ').slice(0,220)).slice(0, 12)};"""
LEER = """
const v = id => { const e = document.getElementById(id) || document.querySelector('[name="'+id+'"]'); return e ? (e.tagName==='SELECT' ? ((e.options[e.selectedIndex]||{}).text||'') : e.value) : null; };
const todos = n => [...document.querySelectorAll('[name="'+n+'"]')].map(e => e.tagName==='SELECT' ? ((e.options[e.selectedIndex]||{}).text||'') : e.value);
return {articulo: todos('articulo[]'), descripcion: todos('descripcion[]'), cantidad: todos('cantidad[]'), precio: todos('precio[]'), bruto: todos('bruto[]'), total: todos('total_concepto[]'),
  proveedor: v('nombre_proveedor_CR'), proveedor_id: v('proveedor_CR'), direccion_proveedor: [...document.querySelectorAll('select')].filter(s => /direccion/i.test(s.id+s.name)).map(s => (s.options[s.selectedIndex]||{}).text||''),
  forma_pago: todos('t_forma_pago[]'), tipo_egreso: todos('t_egreso[]'), bodega: v('bodega_CR'), sucursal: v('sucursal_CR'), centro: v('centro_costos_CR'), moneda: v('divisa_CR')};"""

driver = bov.setup_driver()
res = {}
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    for q in consultas:
        driver.get('https://effi.com.co/app/orden_c')
        time.sleep(3)
        driver.execute_script("document.getElementById('crear').click()")
        time.sleep(4)
        driver.execute_script("document.querySelector('.buscar_articulo').click()")
        time.sleep(3)
        item = {'abierta': driver.execute_script(JS_MODAL)}
        if item['abierta']:
            mid = item['abierta']['id']
            # el campo «Referencia» de la ventana (el segundo de la fila de filtros)
            ref = driver.execute_script("""
              const m = document.getElementById(arguments[0]) || [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
              const l = [...m.querySelectorAll('label')].find(x => /^\\s*Referencia/i.test(x.textContent));
              const e = l ? (l.closest('.form-group')||l.parentElement).querySelector('input') : null;
              if (e) { e.setAttribute('data-zeus', '1'); return e.id || e.name || 'sin-id'; } return null;""", mid)
            item['campo_referencia'] = ref
            if ref:
                campo = driver.find_element(By.CSS_SELECTOR, '[data-zeus="1"]')
                campo.click(); campo.send_keys(q)
                driver.execute_script("[...document.querySelectorAll('.modal button')].filter(b => /buscar/i.test(b.textContent) && b.getBoundingClientRect().width>0)[0].click()")
                time.sleep(4)
                driver.save_screenshot(str(salida / ('modal_' + q + '.png')))
                item['resultados'] = driver.execute_script(JS_MODAL)
                # se elige la primera fila (solo para ver qué rellena Effi; el formulario no se guarda)
                elegida = driver.execute_script("""
                  const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
                  const tr = [...m.querySelectorAll('table tbody tr')].find(t => t.getBoundingClientRect().width > 0);
                  if (!tr) return null; const txt = tr.innerText.replace(/\\s+/g,' ').slice(0,120); tr.click(); return txt;""")
                item['fila_elegida'] = elegida
                time.sleep(3)
                driver.save_screenshot(str(salida / ('elegida_' + q + '.png')))
                item['formulario'] = driver.execute_script(LEER)
        res[q] = item
    (salida / 'articulos.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print('ok', list(res))
finally:
    try:
        driver.quit()
    except Exception:
        pass
