"""EXPLORACIÓN SOLO LECTURA de Effi: lista todos los enlaces del menú lateral y prueba direcciones probables de «órdenes de compra».
Solo abre páginas (GET) con el login que ya usa el bot de órdenes de venta; no guarda ni crea nada. Salida: carpeta pasada como argumento."""
import json, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
import importlib.util
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
mo, bov, ruta = ag.cargar_ov(con_effi=True)
from selenium.webdriver.support.ui import WebDriverWait

driver = bov.setup_driver()
res = {}
try:
    bov.login(driver, WebDriverWait(driver, 90))
    time.sleep(3)
    res['enlaces'] = driver.execute_script("""
      return [...document.querySelectorAll('a')].map(a => ({t: (a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60), h: a.getAttribute('href')||''}))
        .filter(x => x.t && x.h && x.h !== '#' && !x.h.startsWith('javascript')).slice(0, 400);""")
    # el menú a veces tiene grupos plegados: se abren (solo se despliegan) para ver sus enlaces
    driver.execute_script("document.querySelectorAll('.sidebar .dropdown-toggle, .sidebar [data-toggle=collapse], .sidebar .has-submenu > a').forEach(e => { try { e.click(); } catch (x) {} })")
    time.sleep(2)
    res['enlaces_desplegados'] = driver.execute_script("""
      return [...document.querySelectorAll('.sidebar a')].map(a => ({t: (a.textContent||'').trim().replace(/\\s+/g,' ').slice(0,60), h: a.getAttribute('href')||''}))
        .filter(x => x.t && x.h && x.h !== '#').slice(0, 400);""")
    prueba = {}
    for sufijo in ('orden_compra', 'ordenes_compra', 'compra', 'compras', 'orden_c', 'orden_de_compra', 'oc', 'proveedor', 'cotizacion_compra', 'factura_compra'):
        driver.get('https://effi.com.co/app/' + sufijo)
        time.sleep(2.5)
        prueba[sufijo] = {'url': driver.current_url, 'titulo': driver.title, 'h1': (driver.execute_script("return (document.querySelector('h1,h2,.page-title')||{}).textContent||''") or '').strip()[:80]}
    res['prueba'] = prueba
    driver.save_screenshot(str(salida / 'ultima.png'))
    (salida / 'menu.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print('ok', len(res['enlaces']), len(res['enlaces_desplegados']))
finally:
    try:
        driver.quit()
    except Exception:
        pass
