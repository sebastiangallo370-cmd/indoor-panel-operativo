"""ECOMMERCE_PUENTE: conecta el PC de los bots de Effi con el panel (https://produccion.cloud → ECOMMERCE).

Maneja los tres agentes de las ÓRDENES DE VENTA (agente_ov.py): ALMA descarga los PDF de Effi, BRISA exporta las tallas en
Illustrator y CIRO genera los PDF por jugador y llena Google Sheets. Las órdenes llegan desde el panel web:
  · iniciar  → lanza el agente sin ventana, con su salida capturada
  · detener  → termina el proceso del agente (y sus hijos)
  · reiniciar
Cada pocos segundos avisa al panel que está vivo, le manda el estado de cada agente, las líneas nuevas de su log y cuántas
órdenes hay en cada etapa de la cola.
Solo hace peticiones salientes al panel (reserva el puerto local 8764 únicamente para no correr dos copias a la vez).

Uso (normalmente lo arranca iniciar_oculto.vbs / iniciar.bat de los agentes de edición, en la misma carpeta, con --iniciar-agentes):
    python puente_ecommerce.py --iniciar-agentes   arranca BRISA, CIRO y ALMA y atiende al panel (con o sin panel enlazado)
    python puente_ecommerce.py                 solo atiende al panel (los agentes se inician desde la página)
    python puente_ecommerce.py --simulado      PRUEBA: no toca Effi ni Illustrator; los «bots» solo imprimen líneas de ejemplo
    python puente_ecommerce.py --conectar      pide la dirección y el código que muestra el panel y los guarda
Config en datos\\panel.json (dirección y código) y datos\\config.json (carpeta de los bots).
"""
import argparse
import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / 'datos'
SONDEO_SEG = 3
CREATE_NO_WINDOW = 0x08000000
RUTA_BOTS = r'\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\Automatizacion\AUTOMATIZACION_PAGINA WEB'

# id del agente en el panel -> rol de agente_ov.py (el flujo de órdenes de venta repartido en tres agentes)
AGENTES = {
    'alma': {'rol': 'descarga'},    # descarga el PDF de cada orden de venta de Effi
    'brisa': {'rol': 'tallas'},     # lee el PDF y exporta las tallas del maestro en Illustrator
    'ciro': {'rol': 'pdfs'},        # nombre y número (PDF por jugador), listado, Google Sheets
}
ETAPAS = {'descargadas': '1_descargadas', 'tallas': '2_tallas', 'terminadas': '3_terminadas', 'errores': 'errores'}
MARCA_FILA, MARCA_ERROR = '[Fila]', '[Error'


def leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return defecto


class Bot:
    """Un bot lanzado como proceso de Windows, con su salida capturada línea por línea."""

    def __init__(self, aid: str, spec: dict, base: Path, simulado: bool, salida: 'queue.Queue'):
        self.aid, self.spec, self.base, self.simulado, self.salida = aid, spec, base, simulado, salida
        self.proc = None
        self.estado = 'INACTIVO'
        self.ultima = ''
        self.manual = False
        self.lock = threading.Lock()

    def corriendo(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def comando(self):
        if self.simulado:
            codigo = ("import time,sys\n"
                      "sys.stdout.reconfigure(encoding='utf-8')\n"
                      "print('[Simulado] %s listo (prueba, no toca nada)',flush=True)\n"
                      "n=0\n"
                      "while True:\n"
                      "    time.sleep(6); n+=1\n"
                      "    print('[Simulado] revisión %%d: sin trabajo pendiente'%%n,flush=True)\n" % self.aid.upper())
            return [sys.executable, '-c', codigo], str(AQUI)
        # mismo entorno de Python que INICIAR_BOT_OV.bat (trae selenium, pdfplumber, gspread, pywin32…); si no existe, el de los agentes
        py = Path(os.environ.get('LOCALAPPDATA', '')) / 'IndoorBot_OrdenesVenta' / 'venv' / 'Scripts' / 'python.exe'
        return [str(py if py.exists() else sys.executable), str(AQUI / 'agente_ov.py'), '--rol', self.spec['rol']], str(AQUI)

    def iniciar(self) -> str:
        with self.lock:
            if self.corriendo():
                return 'ya estaba corriendo'
            cmd, cwd = self.comando()
            if not self.simulado and not (self.base / 'BOT_ORDENES_VENTA').exists():
                raise RuntimeError(f'No encuentro BOT_ORDENES_VENTA en {self.base} (pon "ruta_bots" en datos/config.json)')
            self.manual = False
            entorno = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            self.proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                         text=True, encoding='utf-8', errors='replace', bufsize=1, env=entorno)
            self.estado = 'CORRIENDO'
            threading.Thread(target=self._leer, args=(self.proc,), daemon=True).start()
            threading.Thread(target=self._vigilar, args=(self.proc,), daemon=True).start()
            return 'iniciado'

    def detener(self) -> str:
        with self.lock:
            self.manual = True
            if not self.corriendo():
                self.estado = 'INACTIVO'
                return 'no estaba corriendo'
            pid = self.proc.pid
            try:
                if os.name == 'nt':   # el bot lanza Chrome y a su agente: se cierra todo el árbol
                    subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=20)
                else:
                    self.proc.terminate()
                self.proc.wait(timeout=10)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
            self.estado = 'INACTIVO'
            return 'detenido'

    def _leer(self, proc):
        try:
            for linea in proc.stdout:
                linea = linea.rstrip('\n')
                if not linea.strip():
                    continue
                self.ultima = linea
                self.salida.put((self.aid, linea))
                if MARCA_FILA in linea:
                    self.estado = 'EN_FILA'
                elif MARCA_ERROR in linea:
                    self.estado = 'ERROR'
                elif self.estado == 'EN_FILA':
                    self.estado = 'CORRIENDO'
                elif self.estado == 'ERROR' and 'Reintentando' not in linea:
                    self.estado = 'CORRIENDO'   # el agente se recuperó solo (por ejemplo volvió a entrar a Effi) y sigue trabajando
        except Exception:
            pass

    def _vigilar(self, proc):
        proc.wait()
        if self.proc is not proc or self.manual:
            return
        codigo = proc.returncode
        if codigo not in (0, None):
            self.salida.put((self.aid, f'[Error] El proceso terminó solo (código {codigo}).'))
            self.estado = 'ERROR'
        else:
            self.estado = 'INACTIVO'


def cola_actual() -> dict:
    """Cuántas órdenes hay en cada etapa de la cola de agente_ov.py."""
    return {nombre: len(list((AQUI / 'cola' / carpeta).glob('OV*.json'))) for nombre, carpeta in ETAPAS.items()}


def latidos_actuales() -> dict:
    """Estado en vivo de cada agente (lo escribe agente_ov.py): qué hace ahora y cuánto falta para su próxima revisión."""
    salida, ahora = {}, time.time()
    for aid, spec in AGENTES.items():
        d = leer_json(AQUI / 'cola' / f"estado_{spec['rol']}.json", {})
        if not d:
            continue
        salida[aid] = {'actividad': str(d.get('actividad', ''))[:120], 'hace_seg': max(0, round(ahora - float(d.get('at', ahora)))),
                       'ultima_hace': round(ahora - float(d['ultima'])) if d.get('ultima') else None,
                       'proxima_en': round(float(d['proxima']) - ahora) if d.get('proxima') else None, 'intervalo': d.get('intervalo')}
    return salida


def trabajos_actuales() -> list:
    """Las órdenes que hay en cada etapa de la cola (con lo necesario para dibujarlas en el panel)."""
    lista = []
    for etapa, carpeta in ETAPAS.items():
        archivos = sorted((AQUI / 'cola' / carpeta).glob('OV*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:25]
        for p in archivos:
            j = leer_json(p, {})
            if not j.get('numero'):
                continue
            lista.append({'numero': str(j['numero']), 'etapa': etapa, 'cliente': str(j.get('cliente', ''))[:60], 'unidades': str(j.get('unidades', '')),
                          'descargada': j.get('descargada', ''), 'terminada': j.get('terminada', ''), 'resultado': str(j.get('resultado', ''))[:120],
                          'avisos': [str(a)[:140] for a in (j.get('avisos') or [])][:6], 'intentos': j.get('intentos', 0),
                          'eventos': (j.get('eventos') or [])[-10:],
                          'items': [{k: str(it.get(k, ''))[:30] for k in ('ref', 'diseno', 'talla', 'nombre', 'numero')} | {'maestro': bool(it.get('maestro'))}
                                    for it in (j.get('items') or [])][:20],
                          'modificada': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(p.stat().st_mtime))})
    return lista[:90]


def pedir_revision_ahora():
    """Botón «Revisar Effi ahora» del panel: ALMA lo atiende en menos de 1 segundo."""
    (AQUI / 'cola').mkdir(parents=True, exist_ok=True)
    (AQUI / 'cola' / 'revisar_ahora.flag').write_text(str(time.time()), encoding='utf-8')


def peticion(url: str, token: str, cuerpo: dict):
    datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=datos, headers={'Content-Type': 'application/json', 'X-Ecommerce-Token': token}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def conectar():
    DATOS.mkdir(exist_ok=True)
    try:
        url = input('Dirección del panel (ej. https://produccion.cloud): ').strip().rstrip('/')
        token = input('Código que muestra el panel en ECOMMERCE → Conectar PC: ').strip()
    except (EOFError, OSError):   # arrancó en segundo plano, sin teclado: el enlace lo pide iniciar_oculto.vbs
        print('Falta enlazar este PC con el panel (ecommerce/datos/panel.json): abre iniciar_oculto.vbs de los agentes o ejecuta este archivo con una ventana.')
        return 2
    if not url.startswith('http') or len(token) < 20:
        print('Dirección o código no válidos.')
        return 1
    (DATOS / 'panel.json').write_text(json.dumps({'url': url, 'token': token}), encoding='utf-8')
    print('Guardado. Iniciando…')
    return 0


def limpiar_huerfanos():
    """Si un puente anterior se cerró a la fuerza, sus agentes (procesos hijos) siguen vivos: se cierran antes de arrancar los nuevos,
    para no tener dos ALMA descargando lo mismo de Effi ni dos CIRO escribiendo en Google Sheets."""
    if os.name != 'nt':
        return
    ps = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agente_ov\\.py' -and $_.ProcessId -ne %d } | "
          "ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null; $_.ProcessId }" % os.getpid())
    try:
        r = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, timeout=40, creationflags=CREATE_NO_WINDOW)
        cerrados = [x for x in (r.stdout or '').split() if x.isdigit()]
        if cerrados:
            print(f'Cerré {len(cerrados)} proceso(s) de agentes que quedaron de una sesión anterior.')
    except Exception as e:  # noqa: BLE001
        print(f'No pude revisar procesos viejos de los agentes: {e}')


def una_sola_copia():
    """Evita dos puentes a la vez (los dos ejecutarían cada orden del panel): el primero reserva un puerto local."""
    guardia = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        guardia.bind(('127.0.0.1', int(os.getenv('ECOMMERCE_PUERTO_GUARDIA', '8764'))))   # las pruebas usan otro puerto para no chocar con el puente real
    except OSError:
        return None
    return guardia


def main():
    try:   # la salida va a un archivo de registro: que cada línea quede escrita al momento
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--simulado', action='store_true')
    ap.add_argument('--conectar', action='store_true')
    ap.add_argument('--una-vez', action='store_true', help='un solo sondeo y salir (prueba de conexión)')
    ap.add_argument('--iniciar-agentes', action='store_true', help='arranca BRISA, CIRO y ALMA al abrir el puente (así los arranca iniciar_oculto.vbs)')
    args = ap.parse_args()
    if args.conectar:
        sys.exit(conectar())
    guardia = una_sola_copia()
    if guardia is None:
        print('El puente de ECOMMERCE ya está corriendo en este PC.')
        return
    if not args.simulado:
        limpiar_huerfanos()
    panel = leer_json(DATOS / 'panel.json', {})
    if not panel.get('url') or not panel.get('token'):   # primera vez: se pide el enlace aquí mismo y se sigue
        print('Primera vez en este PC: falta enlazarlo con el panel (ECOMMERCE → Conectar PC).')
        codigo = conectar()
        if codigo == 2:   # sin teclado (arrancó en segundo plano): los agentes trabajan igual, solo que sin panel
            print('Sigo SIN panel: los agentes funcionan, pero no se controlan ni se ven desde la página hasta enlazar (ecommerce\\ENLAZAR_ECOMMERCE.bat).')
            panel = {}
        elif codigo != 0:
            sys.exit(1)
        else:
            panel = leer_json(DATOS / 'panel.json', {})
    config = leer_json(DATOS / 'config.json', {})
    base = Path(config.get('ruta_bots') or RUTA_BOTS)
    salida: 'queue.Queue' = queue.Queue()
    bots = {aid: Bot(aid, spec, base, args.simulado, salida) for aid, spec in AGENTES.items()}
    equipo = socket.gethostname()
    resultados, pendientes, url = [], [], (panel.get('url') or '').rstrip('/') + '/api/ecommerce/pc/sondeo'
    print(f'ECOMMERCE_PUENTE · {equipo} · panel {panel.get("url") or "(sin enlazar)"}' + (' · MODO PRUEBA' if args.simulado else ''))
    if args.iniciar_agentes:
        # primero los que esperan trabajo (BRISA y CIRO) y al final ALMA, que es la que trae órdenes nuevas de Effi
        for aid in ('brisa', 'ciro', 'alma'):
            try:
                print(f'[{time.strftime("%H:%M:%S")}] {aid} · inicio automático · {bots[aid].iniciar()}')
            except Exception as e:  # noqa: BLE001
                print(f'[{time.strftime("%H:%M:%S")}] {aid} · inicio automático · ERROR {e}')
            time.sleep(3)
    try:
        while True:
            while True:   # lo que escribieron los agentes: se guarda en el registro y se manda al panel
                try:
                    aid, texto = salida.get_nowait()
                except queue.Empty:
                    break
                pendientes.append({'agente': aid, 'texto': texto[:500]})
                print(f'[{aid}] {texto[:300]}')
            del pendientes[:-2000]   # si el panel no responde mucho rato, solo se guardan las últimas 2000 líneas
            lineas = pendientes[:150]
            if not panel.get('token'):   # sin panel: solo se mantienen vivos los agentes y se guarda su salida
                if args.una_vez:
                    break
                time.sleep(SONDEO_SEG)
                continue
            cuerpo = {'equipo': equipo, 'simulado': args.simulado, 'lineas': lineas, 'resultados': resultados, 'cola': cola_actual(),
                      'latidos': latidos_actuales(), 'trabajos': trabajos_actuales(),
                      'agentes': {aid: {'estado': b.estado, 'pid': b.proc.pid if b.corriendo() else None, 'ultima': b.ultima} for aid, b in bots.items()}}
            try:
                resp = peticion(url, panel['token'], cuerpo)
                del pendientes[:len(lineas)]
                resultados = []
                for orden in resp.get('ordenes', []):
                    bot = bots.get(orden['agente'])
                    try:
                        if bot is None:
                            raise RuntimeError('agente desconocido')
                        if orden['accion'] == 'iniciar':
                            detalle = bot.iniciar()
                        elif orden['accion'] == 'detener':
                            detalle = bot.detener()
                        elif orden['accion'] == 'reiniciar':
                            bot.detener(); time.sleep(2); detalle = bot.iniciar()
                        elif orden['accion'] == 'revisar':
                            pedir_revision_ahora(); detalle = 'revisión pedida'
                        else:
                            raise RuntimeError('acción desconocida')
                        resultados.append({'orden': orden['id'], 'ok': True, 'detalle': detalle})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · {detalle}')
                    except Exception as e:  # noqa: BLE001
                        resultados.append({'orden': orden['id'], 'ok': False, 'detalle': str(e)[:250]})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · ERROR {e}')
            except urllib.error.HTTPError as e:
                print(f'[{time.strftime("%H:%M:%S")}] El panel respondió {e.code} (¿código de enlace vencido? vuelve a enlazar con ecommerce/ENLAZAR_ECOMMERCE.bat)')
            except Exception as e:  # noqa: BLE001
                print(f'[{time.strftime("%H:%M:%S")}] Sin conexión con el panel: {e}')
            if args.una_vez:
                break
            time.sleep(SONDEO_SEG)
    except KeyboardInterrupt:
        pass
    finally:
        if args.una_vez or args.simulado:
            for b in bots.values():
                b.detener()


if __name__ == '__main__':
    main()
