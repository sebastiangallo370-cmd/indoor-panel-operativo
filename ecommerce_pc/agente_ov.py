"""ECOMMERCE · agentes de las ÓRDENES DE VENTA (el flujo de BOT_ORDENES_VENTA repartido en tres agentes).

El bot original hace todo seguido con una orden: descargar el PDF de Effi → desempacar las tallas del maestro en
Illustrator → poner nombre y número y sacar un PDF por jugador → listado de producción → Google Sheets. Aquí cada paso
lo hace un agente distinto, y las órdenes pasan de uno a otro por una cola de carpetas (cola\\...):

    ALMA   (--rol descarga)  Effi → PDF_OV\\OV_<n>.pdf                          cola\\1_descargadas
    BRISA  (--rol tallas)    lee el PDF, busca el maestro y exporta las tallas      cola\\2_tallas
    CIRO   (--rol pdfs)      nombre/número → PDF por jugador, listado Excel,       cola\\3_terminadas
                             llena Google Sheets y marca la orden como procesada   (con avisos → cola\\errores)

No se reescribe la lógica de negocio: se usan las mismas funciones de BOT_ORDENES_VENTA (maestros_ov.py y bot_ordenes_venta.py,
que se leen de su carpeta en la NAS con su .env). No corras a la vez INICIAR_BOT_OV.bat y estos agentes: harían lo mismo dos veces.
Illustrator lo usan BRISA y CIRO: un candado en cola\\illustrator.lock hace que se turnen.
"""
import argparse
import contextlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / 'datos'
COLA = AQUI / 'cola'
ETAPAS = ('1_descargadas', '2_tallas', '3_terminadas', 'errores')
RUTA_BOTS = r'\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\Automatizacion\AUTOMATIZACION_PAGINA WEB'
ESPERA_COLA_SEG = 5
INTENTOS_MAX = 3


def log(texto: str):
    print(texto, flush=True)


def latido(rol: str, actividad: str = '', ultima=None, proxima=None, intervalo=None):
    """Estado en vivo del agente para el panel (cola/estado_<rol>.json): qué está haciendo y cuándo vuelve a revisar."""
    try:
        COLA.mkdir(parents=True, exist_ok=True)
        ruta = COLA / f'estado_{rol}.json'
        try:
            datos = json.loads(ruta.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            datos = {}
        datos.update({'actividad': actividad, 'at': time.time()})
        for clave, valor in (('ultima', ultima), ('proxima', proxima), ('intervalo', intervalo)):
            if valor is not None:
                datos[clave] = valor
        tmp = ruta.with_suffix('.tmp')
        tmp.write_text(json.dumps(datos), encoding='utf-8')
        tmp.replace(ruta)
    except OSError:
        pass


def evento(job: dict, agente: str, texto: str):
    """Línea de la historia de la orden (se ve en el panel al abrir la orden)."""
    eventos = job.setdefault('eventos', [])
    eventos.append({'at': datetime.now().isoformat(timespec='seconds'), 'agente': agente, 'texto': texto})
    del eventos[:-30]


def dormir_vigilando(segundos: float):
    """Espera hasta la próxima revisión, pero atiende el botón «Revisar ahora» del panel (archivo cola/revisar_ahora.flag)."""
    bandera = COLA / 'revisar_ahora.flag'
    fin = time.time() + segundos
    while time.time() < fin:
        if bandera.exists():
            bandera.unlink(missing_ok=True)
            log('Revisión pedida desde el panel.')
            return
        time.sleep(1)


# ------------------------------------------------------------------ cola de trabajo (carpetas con un .json por orden)
def carpeta(etapa: str) -> Path:
    ruta = COLA / etapa
    ruta.mkdir(parents=True, exist_ok=True)
    return ruta


def trabajos(etapa: str) -> list:
    return sorted(carpeta(etapa).glob('OV*.json'))


def numeros_en_cola() -> set:
    return {p.stem[2:] for e in ETAPAS for p in carpeta(e).glob('OV*.json')}


def leer_trabajo(ruta: Path) -> dict:
    return json.loads(ruta.read_text(encoding='utf-8'))


def guardar_trabajo(etapa: str, job: dict, quitar: Path | None = None) -> Path:
    destino = carpeta(etapa) / f"OV{job['numero']}.json"
    tmp = destino.with_suffix('.tmp')
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(destino)
    if quitar is not None and quitar != destino:
        quitar.unlink(missing_ok=True)
    return destino


def conteos() -> dict:
    return {e: len(trabajos(e)) for e in ETAPAS}


# ------------------------------------------------------------------ candado de Illustrator (BRISA y CIRO se turnan)
@contextlib.contextmanager
def illustrator(rol: str):
    candado = COLA / 'illustrator.lock'
    COLA.mkdir(parents=True, exist_ok=True)
    avisado = False
    while True:
        try:
            fd = os.open(str(candado), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f'{rol} {os.getpid()}'.encode())
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - candado.stat().st_mtime > 1500:   # quedó de un agente que se cerró a la fuerza
                    candado.unlink(missing_ok=True)
                    continue
            except OSError:
                continue
            if not avisado:
                log('[Fila] Esperando a Illustrator (lo está usando otro agente)…')
                avisado = True
            time.sleep(3)
    try:
        if avisado:
            log('Illustrator libre: sigo.')
        yield
    finally:
        candado.unlink(missing_ok=True)


# ------------------------------------------------------------------ código de BOT_ORDENES_VENTA
def config() -> dict:
    try:
        return json.loads((DATOS / 'config.json').read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return {}


def carpeta_ov() -> Path:
    cfg = config()
    return Path(cfg.get('ruta_ov') or (Path(cfg.get('ruta_bots') or RUTA_BOTS) / 'BOT_ORDENES_VENTA'))


def cargar_ov(con_effi: bool):
    """Importa maestros_ov (y bot_ordenes_venta si hace falta Effi) desde la carpeta del bot, con su .env."""
    ruta = carpeta_ov()
    if not (ruta / 'maestros_ov.py').exists():
        raise RuntimeError(f'No encuentro BOT_ORDENES_VENTA en {ruta} (pon "ruta_ov" en datos/config.json)')
    sys.path.insert(0, str(ruta))
    os.chdir(ruta)
    try:
        from dotenv import load_dotenv
        load_dotenv(ruta / '.env')
    except ImportError:
        pass
    import maestros_ov
    bov = None
    if con_effi:
        salida, errores = sys.stdout, sys.stderr
        import bot_ordenes_venta as bov   # su registro a archivo duplica la salida: se devuelve la salida normal
        sys.stdout, sys.stderr = salida, errores
    return maestros_ov, bov, ruta


def registrar_procesada(ruta: Path, numero: str, pdf: str):
    with open(ruta / 'ordenes_venta_procesadas.txt', 'a', encoding='utf-8') as f:
        f.write(f'{numero} | {datetime.now():%Y-%m-%d %H:%M:%S} | {pdf}\n')


def procesadas(ruta: Path) -> set:
    arch = ruta / 'ordenes_venta_procesadas.txt'
    if not arch.exists():
        return set()
    return {l.split('|')[0].strip() for l in arch.read_text(encoding='utf-8-sig').splitlines() if l.strip()}


def grupos_de(items: list) -> dict:
    """Una corrida de Illustrator por (referencia, diseño, talla, línea), igual que procesar_orden del bot original."""
    grupos = {}
    for it in items:
        if it.get('maestro'):
            grupos.setdefault((it['ref'], it['diseno'], it['talla'], it['linea']), []).append(it)
    return grupos


# ------------------------------------------------------------------ ALMA · descarga
def ciclo_descarga(bov, ruta: Path, driver, wait, fallos: dict) -> bool:
    """Baja el PDF de la orden de venta más antigua que aún no está en la cola ni en el historial. True si hizo algo."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    driver.get(bov.URL_ORDENES)
    wait.until(EC.presence_of_element_located((By.XPATH, f'{bov.TABLA_XPATH}/tbody/tr')))
    hechas = procesadas(ruta) | numeros_en_cola()
    candidatos = []
    for row in driver.find_elements(By.XPATH, f'{bov.TABLA_XPATH}/tbody/tr'):
        if bov.fila_debe_saltarse(row):
            continue
        fecha = bov.fecha_fila(row)
        if fecha and fecha.date() < bov.FECHA_MINIMA:
            continue
        numero = bov.numero_fila(row)
        if numero and numero not in hechas and fallos.get(numero, (0, 0))[0] < INTENTOS_MAX:
            candidatos.append((fecha or datetime.max, numero, row))
    if not candidatos:
        log(f'[{datetime.now():%H:%M:%S}] No hay órdenes de venta nuevas.')
        return False
    candidatos.sort(key=lambda c: (c[0], c[1]))
    _, numero, row = candidatos[0]
    log(f'Nueva orden de venta: OV{numero}')
    latido('descarga', f'Descargando OV{numero}')
    pdf = None
    existente = bov.DOWNLOAD_DIR / f'OV_{numero}.pdf'
    if existente.exists() and existente.stat().st_size > 0:
        pdf = str(existente)
        log(f'  El PDF ya estaba en {pdf}: no lo bajo de nuevo.')
    else:
        pdf = bov.descargar_pdf(driver, row, numero)
    if not pdf:
        n = fallos.get(numero, (0, 0))[0] + 1
        fallos[numero] = (n, time.time())
        log(f'[Error] No pude descargar el PDF de OV{numero} (intento {n} de {INTENTOS_MAX}).')
        return True
    job = {'numero': numero, 'pdf': pdf, 'descargada': datetime.now().isoformat(timespec='seconds'), 'intentos': 0}
    evento(job, 'ALMA', 'Descargó el PDF de Effi')
    guardar_trabajo('1_descargadas', job)
    log(f'  [OK] OV{numero} descargada: pasa a BRISA (tallas).')
    return True


def rol_descarga():
    mo, bov, ruta = cargar_ov(con_effi=True)
    from selenium.webdriver.support.ui import WebDriverWait
    log('ALMA · vigilando las órdenes de venta de Effi (solo descarga el PDF).')
    fallos: dict = {}
    while True:
        driver = None
        try:
            driver = bov.setup_driver()
            wait = WebDriverWait(driver, 30)
            bov.login(driver, wait)
            while True:
                latido('descarga', 'Revisando las órdenes de venta de Effi…')
                hizo = ciclo_descarga(bov, ruta, driver, wait, fallos)
                ahora = time.time()
                if not hizo:
                    espera = bov.INTERVALO_REVISION
                    latido('descarga', 'Vigilando Effi', ultima=ahora, proxima=ahora + espera, intervalo=espera)
                    dormir_vigilando(espera)
                else:
                    latido('descarga', 'Orden descargada', ultima=ahora)
        except KeyboardInterrupt:
            break
        except Exception as e:  # noqa: BLE001
            log(f'[Error] {e}\nReintentando en 30 segundos…')
            time.sleep(30)
        finally:
            if driver:
                with contextlib.suppress(Exception):
                    driver.quit()


# ------------------------------------------------------------------ BRISA · tallas
def ciclo_tallas(mo, ruta_job: Path) -> None:
    job = leer_trabajo(ruta_job)
    numero, pdf = job['numero'], job['pdf']
    log(f'OV{numero}: leyendo el PDF y buscando los maestros…')
    latido('tallas', f'Leyendo OV{numero} y buscando sus maestros')
    items = mo.leer_items(pdf)
    try:
        enc = mo.leer_encabezado(pdf)
        job['cliente'], job['unidades'] = enc.get('cliente', ''), enc.get('unidades', '')
    except Exception:  # noqa: BLE001
        pass
    evento(job, 'BRISA', f'Leyó el PDF: {len(items)} prenda(s)')
    for it in items:
        m = mo.buscar_maestro(it)
        it['maestro'] = str(m) if m else ''
        it['pdf_listo'] = False
        etiqueta = f"{it['prenda']}-D{it['diseno']} talla {it['talla']}"
        log(f'  Maestro para {etiqueta}: ' + (Path(it['maestro']).name if m else '[Aviso] no se encontró'))
    job['items'] = items
    if not items:
        log('  [Aviso] No se encontraron referencias (ej. A100CA01-D1-6) en el PDF.')
    hechos, avisos = set(), []
    with illustrator('tallas'):
        for it in items:
            if not it['maestro']:
                continue
            clave = (it['maestro'], it['prenda'], it['linea'], it['diseno'])
            if clave in hechos:
                continue
            hechos.add(clave)
            log(f"OV{numero}: exportando las tallas de {Path(it['maestro']).name}…")
            latido('tallas', f"Exportando tallas de OV{numero} ({Path(it['maestro']).name})")
            try:
                destino = mo.desempacar_tallas(Path(it['maestro']), it)
                log(f'  [OK] Tallas en {destino}')
            except Exception as e:  # noqa: BLE001
                avisos.append(f"No se pudieron exportar las tallas de {Path(it['maestro']).name}: {e}")
                log(f'  [Error] {avisos[-1]}')
    job['avisos_tallas'] = avisos
    if avisos:
        job['intentos'] = job.get('intentos', 0) + 1
        if job['intentos'] < INTENTOS_MAX:
            guardar_trabajo('1_descargadas', job)   # se vuelve a intentar con las mesas que falten (las ya exportadas se saltan)
            time.sleep(10)
            return
        job['resultado'] = 'No se pudieron exportar las tallas (3 intentos); no se marcó como procesada'
        guardar_trabajo('errores', job, quitar=ruta_job)
        log(f'[Error] OV{numero}: {job["resultado"]}. Revisa Illustrator y mueve el archivo de la carpeta cola/errores a cola/1_descargadas para reintentar.')
        return
    evento(job, 'BRISA', 'Tallas exportadas' if not avisos else 'Tallas exportadas con avisos')
    guardar_trabajo('2_tallas', job, quitar=ruta_job)
    latido('tallas', 'Esperando órdenes descargadas')
    log(f'  OV{numero} lista para CIRO (PDF por jugador y Google Sheets).')


def rol_tallas():
    mo, _, _ = cargar_ov(con_effi=False)
    log('BRISA · esperando órdenes descargadas para exportar sus tallas.')
    while True:
        try:
            pendientes = trabajos('1_descargadas')
            if pendientes:
                ciclo_tallas(mo, pendientes[0])
            else:
                latido('tallas', 'Esperando órdenes descargadas', ultima=None)
                time.sleep(ESPERA_COLA_SEG)
        except KeyboardInterrupt:
            break
        except Exception as e:  # noqa: BLE001
            log(f'[Error] {e}')
            time.sleep(15)


# ------------------------------------------------------------------ CIRO · PDF por jugador + listado + Google Sheets
def ciclo_pdfs(mo, ruta: Path, ruta_job: Path) -> None:
    job = leer_trabajo(ruta_job)
    numero, pdf, items = job['numero'], job['pdf'], job.get('items') or []
    avisos = []
    latido('pdfs', f'Generando los PDF de OV{numero}')
    abrir = os.getenv('ABRIR_ILLUSTRATOR', '1') == '1'
    if items and abrir:
        orden = mo.leer_encabezado(pdf)['orden']
        with illustrator('pdfs'):
            for clave, grupo in grupos_de(items).items():
                primero = dict(grupo[0], jugadores=grupo)
                try:
                    log(f'OV{numero}: PDF por jugador de {clave[0]}-D{clave[1]} talla {clave[2]} ({len(grupo)} jugador/es)…')
                    ok = mo.aplicar_bot_jsx(Path(primero['maestro']), primero, orden)
                except Exception as e:  # noqa: BLE001
                    log(f'  [Error] Illustrator: {e}')
                    ok = False
                for it in grupo:
                    it['pdf_listo'] = ok
                if not ok:
                    avisos.append(f'No se generaron los PDF de {clave[0]}-D{clave[1]} talla {clave[2]}')
    if any(i.get('maestro') for i in items):
        log(f'OV{numero}: armando el listado de producción (Excel)…')
        try:
            if not mo.generar_listado(pdf, items):
                avisos.append('No se pudo crear el listado de producción')
        except Exception as e:  # noqa: BLE001
            avisos.append(f'Listado: {e}')
            log(f'  [Error] {avisos[-1]}')
    log(f'OV{numero}: llenando Google Sheets…')
    latido('pdfs', f'Llenando Google Sheets (OV{numero})')
    try:
        en_sheets = mo.registrar_en_sheets(pdf, items)
    except Exception as e:  # noqa: BLE001
        en_sheets = False
        log(f'  [Error] {e}')
    if not en_sheets:
        avisos.append('No se registró en Google Sheets')
    registrar_procesada(ruta, numero, pdf)
    evento(job, 'CIRO', 'PDF por jugador, listado y Google Sheets' + (' con avisos' if avisos else ' listos'))
    job.update(avisos=avisos, items=items, terminada=datetime.now().isoformat(timespec='seconds'))
    if not items:
        job['resultado'] = 'Sin maestro: la orden no trae referencias de INTERCLASES'
        avisos.append(job['resultado'])
    elif avisos:
        job['resultado'] = 'Terminada con avisos'
    else:
        job['resultado'] = 'Completada'
    if avisos:
        guardar_trabajo('errores', job, quitar=ruta_job)
        log(f'[Error] OV{numero} terminada con avisos: ' + '; '.join(avisos))
    else:
        guardar_trabajo('3_terminadas', job, quitar=ruta_job)
        log(f'OV{numero} exportada y registrada. ✔')


def rol_pdfs():
    mo, _, ruta = cargar_ov(con_effi=False)
    log('CIRO · esperando órdenes con tallas exportadas para generar los PDF y llenar Google Sheets.')
    while True:
        try:
            pendientes = trabajos('2_tallas')
            if pendientes:
                ciclo_pdfs(mo, ruta, pendientes[0])
                latido('pdfs', 'Esperando órdenes con tallas')
            else:
                latido('pdfs', 'Esperando órdenes con tallas')
                time.sleep(ESPERA_COLA_SEG)
        except KeyboardInterrupt:
            break
        except Exception as e:  # noqa: BLE001
            log(f'[Error] {e}')
            time.sleep(15)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rol', choices=('descarga', 'tallas', 'pdfs'), required=True)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:
        pass
    {'descarga': rol_descarga, 'tallas': rol_tallas, 'pdfs': rol_pdfs}[args.rol]()


if __name__ == '__main__':
    main()
