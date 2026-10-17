"""Crea UNA orden de compra de tela en Effi (cuenta del agente de inventario).
Uso: python crear_oc_effi.py <carpeta_salida> <codigo_tela> <mts> <proveedor> [--guardar]
Sin --guardar solo llena el formulario y toma capturas (NO crea nada). Nunca imprime usuario ni contraseña."""
import json, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
GUARDAR = '--guardar' in sys.argv
salida = Path(args[0]); salida.mkdir(parents=True, exist_ok=True)
CODIGO, MTS, PROVEEDOR = args[1], float(args[2]), args[3]
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
return {id: m.id, inputs: [...m.querySelectorAll('input,select')].filter(e => e.type !== 'hidden' && vis(e)).map(e => ({id: e.id, ph: e.placeholder || '', label: ((e.closest('.form-group')||{}).innerText||'').trim().slice(0,30)})),
  botones: [...m.querySelectorAll('button')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30)),
  filas: [...m.querySelectorAll('table tbody tr')].filter(vis).map(tr => tr.innerText.replace(/\\s+/g,' ').slice(0,200)).slice(0, 15)};"""
# elige una opción de un select «chosen» por texto que EMPIECE con el dado
JS_CHOSEN = """
const s = document.getElementById(arguments[0]); const t = arguments[1];
const o = [...s.options].find(o => o.text.trim().startsWith(t));
if (!o) return null; s.value = o.value; $(s).trigger('chosen:updated').trigger('change'); return o.text.trim();"""

def snap(driver, nombre):
    driver.save_screenshot(str(salida / (nombre + '.png')))

def modal_buscar(driver, abrir_js, etiqueta, texto, filtro_js):
    """Abre la lupa, escribe `texto` en el campo con esa etiqueta, busca y devuelve las filas; filtro_js decide cuál se elige."""
    driver.execute_script(abrir_js); time.sleep(3)
    info = driver.execute_script(JS_MODAL)
    campo = driver.execute_script("""
      const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
      const l = [...m.querySelectorAll('label')].find(x => new RegExp('^\\\\s*' + arguments[0], 'i').test(x.textContent));
      const e = l ? (l.closest('.form-group')||l.parentElement).querySelector('input') : null;
      if (e) { e.setAttribute('data-zeus', '1'); return true; } return false;""", etiqueta)
    if not campo:
        return info, None, None
    c = driver.find_element(By.CSS_SELECTOR, '[data-zeus="1"]'); c.click(); c.send_keys(texto)
    driver.execute_script("[...document.querySelectorAll('.modal button')].filter(b => /buscar/i.test(b.textContent) && b.getBoundingClientRect().width>0)[0].click()")
    time.sleep(4)
    res = driver.execute_script(JS_MODAL)
    elegida = driver.execute_script(filtro_js)
    return info, res, elegida

driver = bov.setup_driver()
out = {'guardar': GUARDAR}
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/orden_c'); time.sleep(3)
    driver.execute_script("document.getElementById('crear').click()"); time.sleep(4)
    out['sucursal'] = driver.execute_script(JS_CHOSEN, 'sucursal_CR', '1 -')
    for _ in range(6):   # al cambiar la sucursal Effi vuelve a cargar bodega y centro: se reintenta hasta que queden
        time.sleep(2)
        out['bodega'] = driver.execute_script(JS_CHOSEN, 'bodega_CR', '10 -')
        out['centro'] = driver.execute_script(JS_CHOSEN, 'centro_costos_CR', '1 -')
        time.sleep(1.5)
        ok = driver.execute_script("const t = id => { const s = document.getElementById(id); return ((s.options[s.selectedIndex]||{}).text||'').trim(); }; return t('bodega_CR').startsWith('10 -') && t('centro_costos_CR').startsWith('1 -');")
        if ok:
            break
    time.sleep(1)
    # artículo: la fila cuya Referencia es EXACTAMENTE el código (la búsqueda es por «contiene»)
    pick_art = """
      const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
      const tr = [...m.querySelectorAll('table tbody tr')].find(t => t.getBoundingClientRect().width > 0 && t.innerText.trim().split(/\\s+/)[1] === arguments[0]);
      if (!tr) return null; const txt = tr.innerText.replace(/\\s+/g,' ').slice(0,120); tr.click(); return txt;"""
    # (execute_script con argumentos: se pasa el código dentro del texto)
    pick_art = pick_art.replace('arguments[0]', json.dumps(CODIGO))
    i1, r1, el1 = modal_buscar(driver, "document.getElementById('articulo_CR').closest('.input-group').querySelector('.input-group-addon').click()", 'Referencia', CODIGO, pick_art)
    out['articulo_fila'] = el1
    time.sleep(3); snap(driver, '1_articulo')
    if not el1:
        out['error'] = 'No hay un artículo con Referencia exacta ' + CODIGO; out['filas'] = (r1 or {}).get('filas')
        raise SystemExit
    pick_prov = """
      const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
      const filas = [...m.querySelectorAll('table tbody tr')].filter(t => t.getBoundingClientRect().width > 0);
      const tr = filas.find(t => t.innerText.toUpperCase().includes(%s));
      if (!tr) return null; const txt = tr.innerText.replace(/\\s+/g,' ').slice(0,160); tr.click(); return txt;""" % json.dumps(PROVEEDOR.upper())
    i2, r2, el2 = modal_buscar(driver, "document.getElementById('proveedor_CR').closest('.buscar_proveedor').querySelector('.input-group-addon').click()", 'Nombre|Proveedor|Raz', PROVEEDOR, pick_prov)
    out['proveedor_modal'] = i2; out['proveedor_filas'] = (r2 or {}).get('filas'); out['proveedor_fila'] = el2
    time.sleep(3); snap(driver, '2_proveedor')
    if not el2:
        out['error'] = 'No encontré el proveedor ' + PROVEEDOR
        raise SystemExit
    time.sleep(2)
    out['direccion'] = driver.execute_script("const s=document.getElementById('direccion_proveedor_CR'); return [...s.options].map(o=>o.text.trim());")
    # cantidad
    driver.execute_script("""
      const e = document.getElementById('cantidad_CR'); e.value = arguments[0];
      ['input','keyup','change','blur'].forEach(n => e.dispatchEvent(new Event(n, {bubbles: true})));""", f'{MTS:g}')
    time.sleep(2)
    out['formulario'] = driver.execute_script("""
      const g = id => { const e = document.getElementById(id); return !e ? null : (e.tagName === 'SELECT' ? ((e.options[e.selectedIndex]||{}).text||'') : e.value); };
      return {sucursal: g('sucursal_CR'), bodega: g('bodega_CR'), centro: g('centro_costos_CR'), moneda: g('divisa_CR'), proveedor: g('nombre_proveedor_CR'), nit: g('proveedor_CR'), direccion: g('direccion_proveedor_CR'),
        articulo: g('articulo_CR'), descripcion: g('descripcion_CR'), cantidad: g('cantidad_CR'), precio: g('precio_CR'), bruto: g('bruto_CR'), total: g('total_concepto_CR'), forma_pago: g('t_forma_pago_CR'), valor_pago: g('valor_forma_pago_CR')};""")
    driver.execute_script("document.getElementById('sucursal_CR').scrollIntoView({block: 'start'}); window.scrollBy(0, -120)")
    snap(driver, '3_lleno')
    if GUARDAR:
        driver.execute_script("document.getElementById('btnValidarCrear').click()"); time.sleep(8)
        snap(driver, '4_creada')
        out['url_final'] = driver.current_url
        out['texto_final'] = driver.execute_script("return document.body.innerText.replace(/\\s+/g,' ').slice(0,400)")
        out['mensajes'] = driver.execute_script("return [...document.querySelectorAll('.alert,.toast,.swal2-popup,.bootbox,.modal.in,.noty_message')].map(e=>e.innerText.replace(/\\s+/g,' ').slice(0,200)).slice(0,5)")
except SystemExit:
    pass
except Exception as e:   # noqa: BLE001
    out['excepcion'] = repr(e)[:400]
    try: snap(driver, 'error')
    except Exception: pass
finally:
    (salida / 'oc.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False)[:3000])
    try: driver.quit()
    except Exception: pass
