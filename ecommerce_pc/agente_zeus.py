"""AGENTE INVENTARIO (ZEUS): crea en Effi las órdenes de compra de la tela que falta.
Sondea el panel (https://produccion.cloud → /api/zeus/pc/sondeo, mismo código de enlace que ECOMMERCE), recibe las compras pendientes
(tela, código, metros que faltan, proveedor elegido en Estándar 2026 > PROVEEDORES DE TELA) y por cada una crea la orden en
Compras > Órdenes de compra: sucursal 1, bodega 10 - Insumos, centro 1, artículo con Referencia = código de la tela, proveedor elegido,
precio y forma de pago los que propone Effi. Devuelve al panel el número de la orden (el panel manda el correo).
Credenciales: datos\\zeus_effi.env (ZEUS_EFFI_USERNAME / ZEUS_EFFI_PASSWORD). Nunca se imprimen.
Seguridad: sin proveedor elegido NO crea nada (avisa); nunca borra ni anula; una orden por vez; el panel no repite una compra ya creada.
Uso: python agente_zeus.py            (bucle normal)
     python agente_zeus.py --una-vez  (un sondeo y salir)"""
import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / 'datos'
ENV = DATOS / 'zeus_effi.env'
SONDEO_SEG = 20
OCIOSO_CIERRA_SEG = 120    # sin trabajo, se cierra el navegador de Effi (no deja sesiones abiertas)


def log(t: str):
    print(f'[{time.strftime("%H:%M:%S")}] {t}', flush=True)


def leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return defecto


def credenciales() -> dict:
    d = {}
    try:
        for linea in ENV.read_text(encoding='utf-8').splitlines():
            if '=' in linea and not linea.lstrip().startswith('#'):
                k, v = linea.split('=', 1)
                d[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return d


def peticion(url: str, token: str, cuerpo: dict):
    req = urllib.request.Request(url, data=json.dumps(cuerpo, ensure_ascii=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', 'X-Ecommerce-Token': token}, method='POST')
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode('utf-8'))


JS_MODAL = """
const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const m = [...document.querySelectorAll('.modal')].filter(e => vis(e) && getComputedStyle(e).display !== 'none').pop();
return m ? {id: m.id} : null;"""
JS_CHOSEN = """
const s = document.getElementById(arguments[0]); const t = arguments[1];
const o = [...s.options].find(o => o.text.trim().startsWith(t));
if (!o) return null; s.value = o.value; $(s).trigger('chosen:updated').trigger('change'); return o.text.trim();"""


class Effi:
    """Sesión de Selenium en Effi (se abre cuando hay trabajo y se cierra al quedar ocioso)."""

    def __init__(self, bov, By, EC, WebDriverWait, cred):
        self.bov, self.By, self.EC, self.W, self.cred = bov, By, EC, WebDriverWait, cred
        self.driver = None
        self.ultimo_uso = time.time()

    def abrir(self):
        if self.driver:
            return
        d = self.bov.setup_driver()
        try:
            espera = self.W(d, 60)
            d.get(self.bov.URL_LOGIN)
            espera.until(self.EC.presence_of_element_located((self.By.ID, 'email'))).send_keys(self.cred['ZEUS_EFFI_USERNAME'])
            d.find_element(self.By.ID, 'password').send_keys(self.cred['ZEUS_EFFI_PASSWORD'])
            d.find_element(self.By.CSS_SELECTOR, 'button.btn-primary').click()
            espera.until(self.EC.presence_of_element_located((self.By.CLASS_NAME, 'sidebar')))
        except Exception:
            try:
                d.quit()
            except Exception:
                pass
            raise
        self.driver = d

    def cerrar(self):
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None

    def _buscar_en_modal(self, abrir_js: str, etiqueta: str, texto: str, elegir_js: str):
        d = self.driver
        d.execute_script(abrir_js)
        time.sleep(3)
        ok = d.execute_script("""
          const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();
          if (!m) return false;
          const l = [...m.querySelectorAll('label')].find(x => new RegExp('^\\\\s*(' + arguments[0] + ')', 'i').test(x.textContent));
          const e = l ? (l.closest('.form-group')||l.parentElement).querySelector('input') : null;
          if (e) { e.setAttribute('data-zeus', '1'); return true; } return false;""", etiqueta)
        if not ok:
            return None
        c = d.find_element(self.By.CSS_SELECTOR, '[data-zeus="1"]')
        c.click()
        c.send_keys(texto)
        d.execute_script("[...document.querySelectorAll('.modal button')].filter(b => /buscar/i.test(b.textContent) && b.getBoundingClientRect().width>0)[0].click()")
        time.sleep(4)
        return d.execute_script(elegir_js)

    def crear_orden(self, codigo: str, mts: float, proveedor: str) -> dict:
        """Devuelve {'oc': '133', 'detalle': ...}; lanza RuntimeError con el motivo si algo no cuadra (no se crea nada a medias)."""
        d = self.driver
        self.ultimo_uso = time.time()
        d.get('https://effi.com.co/app/orden_c')
        time.sleep(3)
        antes = d.execute_script("return ((document.body.innerText.match(/(\\d+) órdenes de compra encontradas/i)||[])[1])||''")
        d.execute_script("document.getElementById('crear').click()")
        time.sleep(4)
        suc = bod = cen = None
        d.execute_script(JS_CHOSEN, 'sucursal_CR', '1 -')
        for _ in range(6):   # al cambiar la sucursal Effi vuelve a cargar bodega y centro: se reintenta hasta que queden
            time.sleep(2)
            bod = d.execute_script(JS_CHOSEN, 'bodega_CR', '10 -')
            cen = d.execute_script(JS_CHOSEN, 'centro_costos_CR', '1 -')
            time.sleep(1.5)
            if d.execute_script("const t = id => { const s = document.getElementById(id); return ((s.options[s.selectedIndex]||{}).text||'').trim(); }; return t('bodega_CR').startsWith('10 -') && t('centro_costos_CR').startsWith('1 -');"):
                break
        else:
            raise RuntimeError('No pude dejar bodega 10 - Insumos y centro de costos 1 en el formulario')
        elegir_art = ("const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();"
                      "const tr = [...m.querySelectorAll('table tbody tr')].find(t => t.getBoundingClientRect().width > 0 && t.innerText.trim().split(/\\s+/)[1] === " + json.dumps(codigo) + ");"
                      "if (!tr) return null; const txt = tr.innerText.replace(/\\s+/g,' ').slice(0,120); tr.click(); return txt;")
        art = self._buscar_en_modal("document.getElementById('articulo_CR').closest('.input-group').querySelector('.input-group-addon').click()", 'Referencia', codigo, elegir_art)
        if not art:
            raise RuntimeError(f'No hay en Effi un artículo con Referencia exacta {codigo}')
        time.sleep(3)
        elegir_prov = ("const m = [...document.querySelectorAll('.modal')].filter(e => e.getBoundingClientRect().width > 0).pop();"
                       "const filas = [...m.querySelectorAll('table tbody tr')].filter(t => t.getBoundingClientRect().width > 0);"
                       "const tr = filas.find(t => t.innerText.toUpperCase().includes(" + json.dumps(proveedor.upper()) + "));"
                       "if (!tr) return null; const txt = tr.innerText.replace(/\\s+/g,' ').slice(0,160); tr.click(); return txt;")
        prov = self._buscar_en_modal("document.getElementById('proveedor_CR').closest('.buscar_proveedor').querySelector('.input-group-addon').click()", 'Nombre|Proveedor|Raz', proveedor, elegir_prov)
        if not prov:
            raise RuntimeError(f'No encontré el proveedor «{proveedor}» en Effi')
        time.sleep(5)
        d.execute_script("""
          const e = document.getElementById('cantidad_CR'); e.value = arguments[0];
          ['input','keyup','change','blur'].forEach(n => e.dispatchEvent(new Event(n, {bubbles: true})));""", f'{mts:g}')
        time.sleep(2)
        f = d.execute_script("""
          const g = id => { const e = document.getElementById(id); return !e ? '' : (e.tagName === 'SELECT' ? ((e.options[e.selectedIndex]||{}).text||'') : e.value); };
          return {art: g('articulo_CR'), cant: g('cantidad_CR'), prov: g('nombre_proveedor_CR'), dir: g('direccion_proveedor_CR'), bod: g('bodega_CR'), cen: g('centro_costos_CR'), suc: g('sucursal_CR'),
                  pago: g('t_forma_pago_CR'), total: g('total_concepto_CR')};""")
        # revisión final antes de crear: nada de órdenes a medias
        if not (f['art'] and f['prov'] and f['dir'] and f['bod'].startswith('10 -') and f['cen'].startswith('1 -') and f['suc'].startswith('1 -')):
            raise RuntimeError('Formulario incompleto, no se creó la orden: ' + json.dumps(f, ensure_ascii=False)[:200])
        if abs(float(f['cant'].replace(',', '') or 0) - mts) > 0.005:
            raise RuntimeError(f'La cantidad quedó en {f["cant"]} y no en {mts:g}: no se creó la orden')
        d.execute_script("document.getElementById('btnValidarCrear').click()")
        time.sleep(8)
        if d.execute_script("const e = document.getElementById('articulo_CR'); return !!(e && e.getBoundingClientRect().width > 0);"):
            msg = d.execute_script("return [...document.querySelectorAll('.alert,.swal2-popup,.toast,.noty_message,.has-error')].map(e=>e.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(0,3).join(' | ')")
            raise RuntimeError('Effi no aceptó la orden: ' + (msg or 'el formulario sigue abierto')[:200])
        time.sleep(2)
        fila = d.execute_script("""
          const tr = [...document.querySelectorAll('table tbody tr')].find(t => t.children.length >= 6 && t.getBoundingClientRect().width > 0);
          return tr ? {id: (tr.children[2].innerText||'').trim(), proveedor: (tr.children[3].innerText||'').replace(/\\s+/g,' ').trim(), total: (tr.children[4].innerText||'').replace(/\\s+/g,' ').trim(), estado: (tr.children[5].innerText||'').trim()} : null;""")
        despues = d.execute_script("return ((document.body.innerText.match(/(\\d+) órdenes de compra encontradas/i)||[])[1])||''")
        if not fila or not fila['id'].isdigit() or (antes.isdigit() and despues.isdigit() and int(despues) <= int(antes)):
            raise RuntimeError('No pude confirmar el número de la orden creada; revisa Compras > Órdenes de compra en Effi')
        return {'oc': fila['id'], 'detalle': f"Effi {fila['id']} · {fila['proveedor'][:40]} · {f['cant']} MTS · {f['pago']} · {fila['estado']}"}


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--una-vez', action='store_true')
    args = ap.parse_args()
    guardia = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        guardia.bind(('127.0.0.1', 8766))
    except OSError:
        print('El AGENTE INVENTARIO ya está corriendo en este PC.')
        return
    panel = leer_json(DATOS / 'panel.json', {})
    if not panel.get('url') or not panel.get('token'):
        print('Falta enlazar este PC con el panel (ecommerce\\ENLAZAR_ECOMMERCE.bat).')
        sys.exit(1)
    cred = credenciales()
    tiene_cred = bool(cred.get('ZEUS_EFFI_USERNAME') and cred.get('ZEUS_EFFI_PASSWORD'))
    url = panel['url'].rstrip('/') + '/api/zeus/pc/sondeo'
    import importlib.util
    spec = importlib.util.spec_from_file_location('agente_ov', AQUI / 'agente_ov.py')
    ag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ag)
    mo, bov, ruta = ag.cargar_ov(con_effi=True)
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
    effi = Effi(bov, By, EC, WebDriverWait, cred)
    equipo = socket.gethostname()
    resultados, estado, ultima = [], 'LIBRE' if tiene_cred else 'ESPERANDO_EFFI', 'Iniciado'
    log(f'AGENTE INVENTARIO · {equipo} · panel {panel["url"]}' + ('' if tiene_cred else ' · FALTAN LAS CREDENCIALES DE EFFI (datos\\zeus_effi.env)'))
    try:
        while True:
            try:
                resp = peticion(url, panel['token'], {'equipo': equipo, 'estado': estado, 'ultima': ultima, 'puede_trabajar': tiene_cred and estado != 'ERROR', 'resultados': resultados})
                resultados = []
                for job in resp.get('trabajos', []):
                    estado = 'TRABAJANDO'
                    nombre = f"{job.get('tela')} · {job.get('falta')} MTS"
                    try:
                        if not job.get('proveedor'):
                            raise RuntimeError(f"Falta elegir el proveedor de la tela {job.get('codigo') or job.get('tela')} en Estándar 2026 > PROVEEDORES DE TELA")
                        if not job.get('codigo'):
                            raise RuntimeError('No pude saber el código de la tela (no está en Bodega tela)')
                        log(f'Creando orden de compra: {nombre} · {job["proveedor"]}')
                        effi.abrir()
                        r = effi.crear_orden(str(job['codigo']), float(job['falta']), str(job['proveedor']))
                        resultados.append({'id': job['id'], 'ok': True, 'oc': r['oc'], 'detalle': r['detalle']})
                        ultima = f"Orden {r['oc']} creada ({nombre})"
                        log(ultima)
                    except Exception as e:  # noqa: BLE001
                        resultados.append({'id': job['id'], 'ok': False, 'detalle': str(e)[:290]})
                        ultima = f'Error en {nombre}: {str(e)[:160]}'
                        log(ultima)
                        effi.cerrar()   # sesión limpia para el siguiente intento
                    estado = 'LIBRE'
                if resultados:   # se reportan ya, sin esperar el siguiente sondeo
                    try:
                        peticion(url, panel['token'], {'equipo': equipo, 'estado': estado, 'ultima': ultima, 'puede_trabajar': False, 'resultados': resultados})
                        resultados = []
                    except Exception:
                        pass
            except urllib.error.HTTPError as e:
                log(f'El panel respondió {e.code} (¿código de enlace vencido?)')
            except Exception as e:  # noqa: BLE001
                log(f'Sin conexión con el panel: {e}')
            if effi.driver and time.time() - effi.ultimo_uso > OCIOSO_CIERRA_SEG:
                effi.cerrar()
            if args.una_vez:
                break
            time.sleep(SONDEO_SEG)
    except KeyboardInterrupt:
        pass
    finally:
        effi.cerrar()


if __name__ == '__main__':
    main()
