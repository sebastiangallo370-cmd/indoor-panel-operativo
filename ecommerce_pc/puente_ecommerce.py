"""ECOMMERCE_PUENTE: conecta el PC de los bots de Effi con el panel (https://produccion.cloud → ECOMMERCE).

Hace lo mismo que PANEL_CONTROL\\worker.py, pero las órdenes llegan desde el panel web:
  · iniciar  → lanza el bot sin ventana, con su salida capturada (IndoorSportBot.exe si existe; si no, el venv + el .py de siempre)
  · detener  → termina el proceso del bot (y sus hijos)
  · reiniciar
Cada pocos segundos avisa al panel que está vivo, le manda el estado de cada bot y las líneas nuevas de su log.
No abre puertos: solo hace peticiones salientes a la dirección del panel.

Uso:
    python puente_ecommerce.py                 normal (arranca/detiene los bots de verdad)
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

# id del agente en el panel -> cómo se lanza (igual que worker.py y los .bat de cada bot)
AGENTES = {
    'alma': {'tipo': 'coordinador', 'arg': 'remision'},
    'brisa': {'tipo': 'coordinador', 'arg': 'cotizacion'},
    'ciro': {'tipo': 'coordinador', 'arg': 'cotizacion_edicion'},
    'dario': {'tipo': 'ov', 'arg': ''},
}
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
            codigo = ("import time,sys\nsys.stdout.reconfigure(encoding='utf-8')\n"
                      "print('[Simulado] %s listo, vigilando Effi (prueba, no toca nada)',flush=True)\n"
                      "n=0\nwhile True:\n    time.sleep(6); n+=1\n    print('[Simulado] revisión %%d: sin documentos nuevos'%%n,flush=True)\n" % self.aid.upper())
            return [sys.executable, '-c', codigo], str(AQUI)
        exe = self.base / 'BOT_EXE' / 'dist' / 'IndoorSportBot.exe'
        if self.spec['tipo'] == 'coordinador':
            if exe.exists():
                return [str(exe), '--rol', 'coordinador', '--tipo', self.spec['arg']], str(self.base)
            py = self.base / 'BOT_COORDINADOR' / 'venv' / 'Scripts' / 'python.exe'
            return [str(py if py.exists() else sys.executable), 'bot_remisiones.py', '--tipo', self.spec['arg']], str(self.base / 'BOT_COORDINADOR')
        carpeta = self.base / 'BOT_ORDENES_VENTA'   # DARIO: igual que INICIAR_BOT_OV.bat (su propio entorno en LOCALAPPDATA)
        py = Path(os.environ.get('LOCALAPPDATA', '')) / 'IndoorBot_OrdenesVenta' / 'venv' / 'Scripts' / 'python.exe'
        return [str(py if py.exists() else sys.executable), 'bot_ordenes_venta.py'], str(carpeta)

    def iniciar(self) -> str:
        with self.lock:
            if self.corriendo():
                return 'ya estaba corriendo'
            cmd, cwd = self.comando()
            if not self.simulado and not Path(cwd).exists():
                raise RuntimeError(f'No encuentro la carpeta del bot: {cwd}')
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


def peticion(url: str, token: str, cuerpo: dict):
    datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=datos, headers={'Content-Type': 'application/json', 'X-Ecommerce-Token': token}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def conectar():
    DATOS.mkdir(exist_ok=True)
    url = input('Dirección del panel (ej. https://produccion.cloud): ').strip().rstrip('/')
    token = input('Código que muestra el panel en ECOMMERCE → Conectar PC: ').strip()
    if not url.startswith('http') or len(token) < 20:
        print('Dirección o código no válidos.')
        return 1
    (DATOS / 'panel.json').write_text(json.dumps({'url': url, 'token': token}), encoding='utf-8')
    print('Guardado. Ahora ejecuta iniciar_ecommerce.bat')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--simulado', action='store_true')
    ap.add_argument('--conectar', action='store_true')
    ap.add_argument('--una-vez', action='store_true', help='un solo sondeo y salir (prueba de conexión)')
    args = ap.parse_args()
    if args.conectar:
        sys.exit(conectar())
    panel = leer_json(DATOS / 'panel.json', {})
    if not panel.get('url') or not panel.get('token'):
        print('Falta enlazar este PC: ejecuta conectar_ecommerce.bat')
        sys.exit(1)
    config = leer_json(DATOS / 'config.json', {})
    base = Path(config.get('ruta_bots') or RUTA_BOTS)
    salida: 'queue.Queue' = queue.Queue()
    bots = {aid: Bot(aid, spec, base, args.simulado, salida) for aid, spec in AGENTES.items()}
    equipo = socket.gethostname()
    resultados, url = [], panel['url'].rstrip('/') + '/api/ecommerce/pc/sondeo'
    print(f'ECOMMERCE_PUENTE · {equipo} · panel {panel["url"]}' + (' · MODO PRUEBA' if args.simulado else ''))
    try:
        while True:
            lineas = []
            while len(lineas) < 150:
                try:
                    aid, texto = salida.get_nowait()
                    lineas.append({'agente': aid, 'texto': texto[:500]})
                except queue.Empty:
                    break
            cuerpo = {'equipo': equipo, 'simulado': args.simulado, 'lineas': lineas, 'resultados': resultados,
                      'agentes': {aid: {'estado': b.estado, 'pid': b.proc.pid if b.corriendo() else None, 'ultima': b.ultima} for aid, b in bots.items()}}
            try:
                resp = peticion(url, panel['token'], cuerpo)
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
                        else:
                            raise RuntimeError('acción desconocida')
                        resultados.append({'orden': orden['id'], 'ok': True, 'detalle': detalle})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · {detalle}')
                    except Exception as e:  # noqa: BLE001
                        resultados.append({'orden': orden['id'], 'ok': False, 'detalle': str(e)[:250]})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · ERROR {e}')
            except urllib.error.HTTPError as e:
                print(f'[{time.strftime("%H:%M:%S")}] El panel respondió {e.code} (¿código de enlace vencido? usa conectar_ecommerce.bat)')
                for l in lineas:   # no se pierden las líneas del log
                    salida.put((l['agente'], l['texto']))
            except Exception as e:  # noqa: BLE001
                print(f'[{time.strftime("%H:%M:%S")}] Sin conexión con el panel: {e}')
                for l in lineas:
                    salida.put((l['agente'], l['texto']))
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
