"""Puente Python -> Illustrator (JSX/ExtendScript vía COM en Windows)."""
import glob
import importlib.util
import json
import os
import subprocess
import sys
import time

import config
from core.log import log


def _disponible():
    return sys.platform == "win32" and importlib.util.find_spec("win32com") is not None


def modo_simulado():
    if config.SIMULAR == "1":
        return True
    if config.SIMULAR == "0":
        if not _disponible():
            raise RuntimeError("SIMULAR=0 pero Illustrator/pywin32 no está disponible en este equipo.")
        return False
    return not _disponible()


def _exe():
    """Illustrator.exe: el configurado (datos/config.json -> illustrator_exe), el que Windows tiene registrado para COM o la versión más nueva instalada."""
    configurado = getattr(config, "ILLUSTRATOR_EXE", "")
    if configurado and os.path.exists(configurado):
        return configurado
    try:
        import winreg

        clsid = winreg.QueryValue(winreg.HKEY_CLASSES_ROOT, r"Illustrator.Application\CLSID")
        ruta = winreg.QueryValue(winreg.HKEY_CLASSES_ROOT, rf"CLSID\{clsid}\LocalServer32").strip().strip('"')
        if ruta.lower().endswith(".exe") and os.path.exists(ruta):
            return ruta
    except OSError:
        pass
    candidatos = sorted(glob.glob(r"C:\Program Files\Adobe\Adobe Illustrator*\Support Files\Contents\Windows\Illustrator.exe"), reverse=True)
    return candidatos[0] if candidatos else ""


def _proceso_activo():
    try:
        salida = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Illustrator.exe", "/NH"], capture_output=True, text=True, timeout=15).stdout
        return "illustrator.exe" in salida.lower()
    except Exception:  # noqa: BLE001
        return False


def conectar(agente="TAVO", espera_seg=240):
    """App COM de Illustrator lista para usar. Si está cerrado lo abre como si lo abrieras tú (doble clic en el programa, sin archivos),
    espera a que termine de cargar y sigue. Si ya estaba abierto lo usa tal cual (no cierra ni toca tus documentos)."""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()

    def listo():
        app = win32com.client.GetActiveObject("Illustrator.Application")
        _ = app.Documents.Count          # responde de verdad (no solo está registrado)
        return app

    try:
        return listo()
    except Exception:  # noqa: BLE001
        pass
    lanzado = False
    if _proceso_activo():                # ya se está abriendo (o cargando): se espera, no se lanza otro
        log(agente, "Illustrator se está abriendo; espero a que termine de cargar")
    else:
        exe = _exe()
        if not exe:
            raise RuntimeError("No encuentro Illustrator.exe en este PC (ni registrado ni en Program Files\\Adobe).")
        log(agente, "Illustrator estaba cerrado: lo abro como si lo abrieras tú (doble clic, sin archivos)")
        os.startfile(exe)
        lanzado = True
    t0, ultimo = time.time(), None
    while time.time() - t0 < espera_seg:
        try:
            app = listo()
            if lanzado:                  # solo si se acaba de abrir: si ya estaba abierto no hay espera
                time.sleep(5)            # que termine de arrancar (paneles, fuentes) antes de pedirle trabajo
            log(agente, f"Illustrator listo ({time.time() - t0:.0f} s)")
            return app
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(2)
    raise RuntimeError(f"Illustrator no respondió tras abrirlo ({espera_seg} s): {ultimo}")


def traer_al_frente():
    """Pone la ventana de Illustrator al frente y a la vista (como si una persona la abriera), para que se vea el trabajo."""
    try:
        import win32com.client
        import win32con
        import win32gui
        hallados = []

        def _ventana(h, _):
            if win32gui.IsWindowVisible(h) and "Adobe Illustrator" in win32gui.GetWindowText(h) and win32gui.GetClassName(h) != "#32770":
                hallados.append(h)

        win32gui.EnumWindows(_ventana, None)
        if not hallados:
            return False
        h = hallados[0]
        if win32gui.IsIconic(h):
            win32gui.ShowWindow(h, win32con.SW_RESTORE)
        try:
            win32com.client.Dispatch("WScript.Shell").SendKeys("%")   # Windows solo deja pasar al frente a quien acaba de recibir una tecla
        except Exception:  # noqa: BLE001
            pass
        win32gui.SetForegroundWindow(h)
        return True
    except Exception:  # noqa: BLE001
        return False


def _vigilar_dialogos(fin, agente):
    """Mientras corre un script, avisa si Illustrator abrió un cuadro de diálogo que lo deja esperando (fuentes o vínculos faltantes, etc.)."""
    try:
        import win32gui
    except Exception:  # noqa: BLE001
        return
    avisado = set()
    t0 = time.time()
    while not fin.wait(5):
        encontrados = []

        def _buscar(h, _):
            if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == "#32770":
                titulo = win32gui.GetWindowText(h)
                if "Illustrator" in titulo:
                    encontrados.append((h, titulo))

        try:
            win32gui.EnumWindows(_buscar, None)
        except Exception:  # noqa: BLE001
            continue
        for h, titulo in encontrados:
            if h not in avisado and time.time() - t0 > 8:
                avisado.add(h)
                textos = []
                try:
                    win32gui.EnumChildWindows(h, lambda c, _: textos.append(win32gui.GetWindowText(c)) or True, None)
                except Exception:  # noqa: BLE001
                    pass
                detalle = " ".join(x for x in textos if x and len(x) > 12)[:160]
                log(agente, f"Illustrator tiene un cuadro de diálogo abierto y está esperando: «{titulo}» {detalle}. Ciérralo o acéptalo en este PC para que siga.", "WARN")


def _unc(valor):
    """Unidad de red asignada (Z:) -> ruta UNC: Illustrator puede no ver las letras de unidad (otra sesión o permisos) y falla con «Error 52: Error de E/S»; la UNC la ve siempre."""
    if isinstance(valor, dict):
        return {k: _unc(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_unc(v) for v in valor]
    if isinstance(valor, str) and len(valor) > 2 and valor[1] == ":" and valor[0].isalpha() and valor[2] in ("\\", "/"):
        try:
            import win32wnet
            r = win32wnet.WNetGetUniversalName(valor.replace("/", "\\"), 1)
            return r.replace("\\", "/") if "/" in valor else r
        except Exception:  # noqa: BLE001  (no es unidad de red o no se pudo traducir: se deja como está)
            return valor
    return valor


def _seguir_progreso(archivo, fin, agente):
    """Muestra en el registro del panel el paso en que va el script (lo escribe el .jsx en un archivo) y avisa si lleva mucho en el mismo paso."""
    ultimo, desde = "", time.time()
    while not fin.wait(2):
        try:
            texto = open(archivo, encoding="utf-8-sig").read().strip()
        except OSError:
            continue
        if texto and texto != ultimo:
            ultimo, desde = texto, time.time()
            log(agente, f"Illustrator: {texto}")
        elif ultimo and time.time() - desde > 180 and int(time.time() - desde) % 60 < 2:
            log(agente, f"Illustrator sigue en «{ultimo}» ({int((time.time() - desde) / 60)} min). Si no avanza, revisa si hay un cuadro de diálogo abierto en ese PC.", "WARN")


def ejecutar_jsx(nombre_jsx, params, agente="OLVER"):
    """Ejecuta jsx/<nombre_jsx> dentro de Illustrator pasando PARAMS. Devuelve el texto que retorna el script.
    Antes trae Illustrator al frente (para que se vea el trabajo) y mientras corre vigila que no quede esperando un cuadro de diálogo."""
    import threading

    jsx = (config.JSX / nombre_jsx).resolve()
    app = conectar()
    traer_al_frente()
    fin = threading.Event()
    threading.Thread(target=_vigilar_dialogos, args=(fin, agente), daemon=True).start()
    params = _unc(params)
    archivo_prog = config.LOCAL / "datos" / f"progreso_{nombre_jsx}.txt"
    try:
        archivo_prog.unlink(missing_ok=True)
    except OSError:
        pass
    params = {**params, "progreso": archivo_prog.as_posix()}
    threading.Thread(target=_seguir_progreso, args=(archivo_prog, fin, agente), daemon=True).start()
    # el texto del script va dentro de la orden (no se le pide a Illustrator leer un archivo: en algunos PC falla con «Error 52: Error de E/S»)
    # Sin cuadros de diálogo: Illustrator no se queda esperando (fuentes o vínculos faltantes) ni cancela la operación.
    sin_alertas = "try { app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (e) {}\n"
    codigo = f"var PARAMS = {json.dumps(params)};\n" + sin_alertas + jsx.read_text(encoding="utf-8-sig")
    try:
        return str(app.DoJavaScript(codigo))
    finally:
        fin.set()
