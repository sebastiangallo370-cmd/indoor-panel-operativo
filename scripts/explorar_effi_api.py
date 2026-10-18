"""EXPLORACIÓN SOLO LECTURA: abre la documentación de la API de Effi (https://effi.com.co/app/api) con la cuenta del agente y guarda el texto de las secciones
pedidas por su ancla (o todas las anclas si no se pide ninguna). NO llama a la API ni crea nada. Los textos largos que parecen llaves/tokens se tapan.
Uso: python explorar_effi_api.py <carpeta_salida> [ancla1 ancla2 ...]"""
import json, re, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
salida = Path(sys.argv[1]); salida.mkdir(parents=True, exist_ok=True)
anclas_pedidas = sys.argv[2:]
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

TAPAR = re.compile(r'\b[A-Za-z0-9_\-\.]{32,}\b')   # llaves y tokens: nunca se guardan

driver = bov.setup_driver()
try:
    espera = WebDriverWait(driver, 60)
    driver.get(bov.URL_LOGIN)
    espera.until(EC.presence_of_element_located((By.ID, 'email'))).send_keys(datos['ZEUS_EFFI_USERNAME'])
    driver.find_element(By.ID, 'password').send_keys(datos['ZEUS_EFFI_PASSWORD'])
    driver.find_element(By.CSS_SELECTOR, 'button.btn-primary').click()
    espera.until(EC.presence_of_element_located((By.CLASS_NAME, 'sidebar')))
    driver.get('https://effi.com.co/app/api')
    time.sleep(6)
    todas = driver.execute_script("return [...document.querySelectorAll('[id]')].map(e => e.id).filter(i => i && !/^(__|ember|react)/.test(i))")
    (salida / 'todas_las_anclas.txt').write_text('\n'.join(todas), encoding='utf-8')
    print('anclas:', len(todas))
    for a in anclas_pedidas:
        sec = driver.execute_script("""
          const e = document.getElementById(arguments[0]); if (!e) return '';
          const caja = e.closest('section,.panel,.card,.box,div') || e; return caja.innerText;""", a) or ''
        (salida / (a + '.txt')).write_text(TAPAR.sub('«oculto»', sec), encoding='utf-8')
        print(a, len(sec))
finally:
    try:
        driver.quit()
    except Exception:
        pass
