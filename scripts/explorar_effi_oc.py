"""EXPLORACIÓN SOLO LECTURA de la pantalla de órdenes de compra de Effi (con el login que ya usa el bot de órdenes de venta).
No guarda, no envía y no crea nada: solo abre páginas (GET), toma capturas y vuelca los textos y campos del formulario.
Salida: carpeta pasada como argumento."""
import json, os, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'ecommerce_pc'))
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
import importlib.util
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
mo, bov, ruta = ag.cargar_ov(con_effi=True)
from selenium.webdriver.support.ui import WebDriverWait

res = {}
driver = bov.setup_driver()
try:
    wait = WebDriverWait(driver, 40)
    try:
        bov.login(driver, WebDriverWait(driver, 90))
    except Exception:
        driver.save_screenshot(str(salida / '0_login_fallo.png'))
        (salida / '0_login_fallo.txt').write_text(driver.current_url + '\n' + driver.find_element('tag name', 'body').text[:1500], encoding='utf-8')
        raise

    def volcar(nombre):
        time.sleep(3)
        driver.save_screenshot(str(salida / f'{nombre}.png'))
        info = driver.execute_script("""
          const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
          const etiqueta = e => { const id = e.id; const l = id && document.querySelector('label[for="'+id+'"]'); return (l ? l.textContent : (e.closest('.form-group,.row,div')?.querySelector('label')?.textContent || e.placeholder || '')).trim().replace(/\\s+/g,' ').slice(0,80); };
          return {
            url: location.href, titulo: document.title,
            encabezados: [...document.querySelectorAll('h1,h2,h3,h4,.page-title,.card-title')].filter(vis).map(e => e.textContent.trim().replace(/\\s+/g,' ')).slice(0,15),
            botones: [...document.querySelectorAll('a.btn,button,.btn')].filter(vis).map(e => (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,50) + ' | ' + (e.getAttribute('href')||e.getAttribute('onclick')||e.id||'')).slice(0,60),
            tabla_cols: [...document.querySelectorAll('table thead th')].filter(vis).map(e => e.textContent.trim().replace(/\\s+/g,' ')).slice(0,30),
            campos: [...document.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'hidden').map(e => ({tag: e.tagName.toLowerCase(), type: e.type||'', id: e.id||'', name: e.name||'', etiqueta: etiqueta(e), visible: vis(e), opciones: e.tagName==='SELECT' ? [...e.options].slice(0,8).map(o=>o.text.trim()) : undefined})).slice(0,120),
            menu: [...document.querySelectorAll('.sidebar a')].map(a => a.textContent.trim().replace(/\\s+/g,' ') + ' -> ' + (a.getAttribute('href')||'')).filter(x => /compra|proveed|inventario|producto|orden/i.test(x)).slice(0,60)
          };""")
        (salida / f'{nombre}.json').write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding='utf-8')
        return info

    driver.get('https://effi.com.co/app/orden_c')
    lista = volcar('1_listado_ordenes_compra')
    res['listado'] = {'url': lista['url'], 'titulo': lista['titulo'], 'cols': lista['tabla_cols']}
    # el botón para crear una nueva (solo se abre su dirección con GET; no se guarda nada)
    nuevo = next((b.split(' | ')[1] for b in lista['botones'] if any(k in b.lower() for k in ('nueva', 'nuevo', 'crear', 'agregar')) and b.split(' | ')[1].startswith(('http', '/'))), None)
    res['boton_nueva'] = nuevo
    if nuevo:
        driver.get(nuevo if nuevo.startswith('http') else 'https://effi.com.co' + nuevo)
        form = volcar('2_formulario_nueva_orden')
        res['formulario'] = {'url': form['url'], 'titulo': form['titulo'], 'campos': len(form['campos'])}
    (salida / 'resumen.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False))
finally:
    try:
        driver.quit()
    except Exception:
        pass
