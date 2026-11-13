"""TIENDA_CLUB_PUENTE: conecta el PC de los agentes de la tienda del club con el panel (https://produccion.cloud → AGENTES TIENDA CLUB).

Maneja los tres agentes (agente_club.py): NOVA recibe y valida la reposición aprobada, BRUJULA prepara el paquete (PDF, listado y mockups) y SELLO la programa en
Producción. Es independiente de ECOMMERCE y de los agentes de edición: otra carpeta, otra cola, otro token y otro puerto de guardia. Las órdenes llegan desde el panel:
  · iniciar  → lanza el agente sin ventana, con su salida capturada
  · detener  → termina el proceso del agente (y sus hijos)
  · reiniciar
  · instalar   → botón «Instalar todo»: baja de la NAS todo el paquete de agentes y lo reinicia
Cada pocos segundos avisa al panel que está vivo, le manda el estado de cada agente y las líneas nuevas de su log.
Solo hace peticiones salientes al panel (reserva el puerto local 8765 únicamente para no correr dos copias a la vez).

Uso:
    python puente_tienda_club.py --iniciar-agentes   arranca NOVA, BRUJULA y SELLO y atiende al panel
    python puente_tienda_club.py                     solo atiende al panel (los agentes se inician desde la página)
    python puente_tienda_club.py --simulado          PRUEBA: los agentes solo imprimen líneas de ejemplo
    python puente_tienda_club.py --conectar          pide la dirección y el código que muestra el panel y los guarda
Config en datos\\panel.json (dirección y código).
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
AGENTES = {
    'nova': {'rol': 'recibe'},       # valida la reposición aprobada
    'brujula': {'rol': 'prepara'},   # arma el paquete: PDF, listado y mockups
    'sello': {'rol': 'programa'},    # la programa en Producción
}
MARCA_ERROR = '[Error'


def leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return defecto


class Bot:
    """Un agente lanzado como proceso de Windows, con su salida capturada línea por línea."""

    def __init__(self, aid: str, spec: dict, simulado: bool, salida: 'queue.Queue'):
        self.aid, self.spec, self.simulado, self.salida = aid, spec, simulado, salida
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
            return [sys.executable, '-c', codigo]
        return [sys.executable, str(AQUI / 'agente_club.py'), '--rol', self.spec['rol']]

    def iniciar(self) -> str:
        with self.lock:
            if self.corriendo():
                return 'ya estaba corriendo'
            self.manual = False
            entorno = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
            self.proc = subprocess.Popen(self.comando(), cwd=str(AQUI), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0,
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
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(self.proc.pid), '/T', '/F'], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=20)
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
                if MARCA_ERROR in linea:
                    self.estado = 'ERROR'
                elif self.estado == 'ERROR' and 'Reintentando' not in linea:
                    self.estado = 'CORRIENDO'
        except Exception:
            pass

    def _vigilar(self, proc):
        proc.wait()
        if self.proc is not proc or self.manual:
            return
        if proc.returncode not in (0, None):
            self.salida.put((self.aid, f'[Error] El proceso terminó solo (código {proc.returncode}).'))
            self.estado = 'ERROR'
        else:
            self.estado = 'INACTIVO'


def latidos_actuales() -> dict:
    """Estado en vivo de cada agente (lo escribe agente_club.py): qué hace ahora y cuánto falta para su próxima revisión."""
    salida, ahora = {}, time.time()
    for aid, spec in AGENTES.items():
        d = leer_json(AQUI / 'cola' / f"estado_{spec['rol']}.json", {})
        if not d:
            continue
        salida[aid] = {'actividad': str(d.get('actividad', ''))[:120], 'hace_seg': max(0, round(ahora - float(d.get('at', ahora)))),
                       'ultima_hace': round(ahora - float(d['ultima'])) if d.get('ultima') else None,
                       'proxima_en': round(float(d['proxima']) - ahora) if d.get('proxima') else None, 'intervalo': d.get('intervalo')}
    return salida


NAS_AGENTES = r'\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR'


def instalar_todo() -> str:
    """Botón «Instalar todo» del panel: deja en este PC la última versión de TODO el paquete de agentes (edición, ECOMMERCE y TIENDA CLUB) y lo reinicia.
    Copia los lanzadores y el código desde la NAS (igual que INSTALAR_AGENTES_EDICION.vbs) y arranca todo con iniciar_oculto.vbs. Lo hace un script aparte,
    unos segundos DESPUÉS de avisar al panel, porque detiene también a este puente. Solo funciona en un PC que ya tiene los agentes instalados."""
    raiz = AQUI.parent
    nas = Path(os.getenv('AGENTES_NAS', NAS_AGENTES))
    if not (nas / 'codigo').is_dir():
        raise RuntimeError('No alcanzo la carpeta de los agentes en la NAS: ' + str(nas))
    if not (raiz / 'iniciar_oculto.vbs').is_file():
        raise RuntimeError('No encuentro iniciar_oculto.vbs junto a la carpeta tienda_club: este PC no tiene los agentes instalados (usa INSTALAR_AGENTES_EDICION.vbs)')
    logs = raiz / 'logs'
    logs.mkdir(exist_ok=True)
    guion = logs / 'instalar_todo.ps1'
    guion.write_text(
        "$nas = '%s'\n$raiz = '%s'\nStart-Sleep -Seconds 4   # deja que el puente avise al panel\n"
        "robocopy \"$nas\\lanzadores\" $raiz *.vbs *.bat *.ps1 /NJH /NJS /NP /R:2 /W:2 | Out-Null\n"
        "& \"$raiz\\actualizar_desde_nas.bat\" | Out-Null\n"
        "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n"
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'puente_ecommerce|agente_ov|puente_tienda_club|agente_club' -and $_.CommandLine -notmatch 'instalar_todo' -and $_.ProcessId -ne $PID } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }\n"
        "Start-Sleep -Seconds 2\n"
        "Start-Process wscript.exe -ArgumentList ('\"' + $raiz + '\\iniciar_oculto.vbs\"') -WorkingDirectory $raiz\n"
        % (str(nas).replace("'", "''"), str(raiz).replace("'", "''")), encoding='utf-8-sig')
    flags = (CREATE_NO_WINDOW | 0x00000008) if os.name == 'nt' else 0   # 0x08 = DETACHED_PROCESS: sobrevive a que este puente se cierre
    subprocess.Popen(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(guion)], cwd=str(raiz), creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 'instalando todo el paquete desde la NAS: los agentes se reinician en ~30 segundos'


def peticion(url: str, token: str, cuerpo: dict):
    datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=datos, headers={'Content-Type': 'application/json', 'X-TiendaClub-Token': token}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


def conectar():
    DATOS.mkdir(exist_ok=True)
    try:
        url = input('Dirección del panel (ej. https://produccion.cloud): ').strip().rstrip('/')
        token = input('Código que muestra el panel en AGENTES TIENDA CLUB → PC de los agentes: ').strip()
    except (EOFError, OSError):
        print('Falta enlazar este PC con el panel (tienda_club/datos/panel.json): ejecuta ENLAZAR_TIENDA_CLUB.bat con una ventana.')
        return 2
    if not url.startswith('http') or len(token) < 20:
        print('Dirección o código no válidos.')
        return 1
    (DATOS / 'panel.json').write_text(json.dumps({'url': url, 'token': token}), encoding='utf-8')
    print('Guardado. Iniciando…')
    return 0


def limpiar_huerfanos():
    """Si un puente anterior se cerró a la fuerza, sus agentes siguen vivos: se cierran antes de arrancar los nuevos (no deben correr dos NOVA ni dos SELLO)."""
    if os.name != 'nt':
        return
    ps = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agente_club\\.py' -and $_.ProcessId -ne %d } | "
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
        guardia.bind(('127.0.0.1', int(os.getenv('TIENDA_CLUB_PUERTO_GUARDIA', '8765'))))
    except OSError:
        return None
    return guardia


def main():
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--simulado', action='store_true')
    ap.add_argument('--conectar', action='store_true')
    ap.add_argument('--una-vez', action='store_true', help='un solo sondeo y salir (prueba de conexión)')
    ap.add_argument('--iniciar-agentes', action='store_true', help='arranca NOVA, BRUJULA y SELLO al abrir el puente')
    args = ap.parse_args()
    if args.conectar:
        sys.exit(conectar())
    guardia = una_sola_copia()
    if guardia is None:
        print('El puente de TIENDA CLUB ya está corriendo en este PC.')
        return
    if not args.simulado:
        limpiar_huerfanos()
    panel = leer_json(DATOS / 'panel.json', {})
    if not panel.get('url') or not panel.get('token'):
        print('Primera vez en este PC: falta enlazarlo con el panel (AGENTES TIENDA CLUB → PC de los agentes).')
        codigo = conectar()
        if codigo == 2:
            panel = {}
        elif codigo != 0:
            sys.exit(1)
        else:
            panel = leer_json(DATOS / 'panel.json', {})
    salida: 'queue.Queue' = queue.Queue()
    bots = {aid: Bot(aid, spec, args.simulado, salida) for aid, spec in AGENTES.items()}
    equipo = socket.gethostname()
    resultados, pendientes, url = [], [], (panel.get('url') or '').rstrip('/') + '/api/tienda-club-agentes/pc/sondeo'
    print(f'TIENDA_CLUB_PUENTE · {equipo} · panel {panel.get("url") or "(sin enlazar)"}' + (' · MODO PRUEBA' if args.simulado else ''))
    if args.iniciar_agentes:
        for aid in ('nova', 'brujula', 'sello'):
            try:
                print(f'[{time.strftime("%H:%M:%S")}] {aid} · inicio automático · {bots[aid].iniciar()}')
            except Exception as e:  # noqa: BLE001
                print(f'[{time.strftime("%H:%M:%S")}] {aid} · inicio automático · ERROR {e}')
            time.sleep(2)
    try:
        while True:
            while True:
                try:
                    aid, texto = salida.get_nowait()
                except queue.Empty:
                    break
                pendientes.append({'agente': aid, 'texto': texto[:500]})
                print(f'[{aid}] {texto[:300]}')
            del pendientes[:-2000]
            lineas = pendientes[:150]
            if not panel.get('token'):
                if args.una_vez:
                    break
                time.sleep(SONDEO_SEG)
                continue
            cuerpo = {'equipo': equipo, 'simulado': args.simulado, 'lineas': lineas, 'resultados': resultados, 'latidos': latidos_actuales(),
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
                        elif orden['accion'] == 'instalar':
                            detalle = instalar_todo()
                        else:
                            raise RuntimeError('acción desconocida')
                        resultados.append({'orden': orden['id'], 'ok': True, 'detalle': detalle})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · {detalle}')
                    except Exception as e:  # noqa: BLE001
                        resultados.append({'orden': orden['id'], 'ok': False, 'detalle': str(e)[:250]})
                        print(f'[{time.strftime("%H:%M:%S")}] {orden["agente"]} · {orden["accion"]} · ERROR {e}')
            except urllib.error.HTTPError as e:
                print(f'[{time.strftime("%H:%M:%S")}] El panel respondió {e.code} (¿código de enlace vencido? vuelve a enlazar con ENLAZAR_TIENDA_CLUB.bat)')
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
