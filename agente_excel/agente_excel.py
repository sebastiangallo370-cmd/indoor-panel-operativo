"""AGENTE EXCEL de Indoor Sport (Windows y Mac).

Se instala una vez en el computador del comercial. Pregunta al panel (https://produccion.cloud) si hay un listado para llenar y, cuando lo hay,
abre Microsoft Excel A LA VISTA y lo llena solo: encabezado, cada fila del listado y los mockups. Guarda el archivo en Documentos/Indoor Pedidos.
Todo lo demás (la orden en Producción, la NAS, Effi) lo sigue haciendo el servidor: si este agente está apagado, el pedido se programa igual.

Requisitos del PC: Microsoft Excel de ESCRITORIO con licencia (Windows o Mac). En Mac, permitir en Ajustes → Privacidad → Automatización que
«AgenteExcelIndoor» controle «Microsoft Excel».
"""
from __future__ import annotations

import datetime as dt
import json
import os
import platform
import socket
import sys
import tempfile
import time
import tkinter as tk
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from tkinter import messagebox, simpledialog

VERSION = '1.0.4'
URL = os.getenv('AGENTE_EXCEL_URL', 'https://produccion.cloud').rstrip('/')
CONFIG = Path.home() / '.agente_excel_indoor.json'
SALIDA = Path.home() / 'Documents' / 'Indoor Pedidos'
SONDEO_MS = 3000
PAUSA_CELDA = float(os.getenv('AGENTE_EXCEL_PAUSA', '0.12'))   # segundos entre celda y celda: se ve escribirse
ES_MAC = platform.system() == 'Darwin'
RELEASE = 'https://github.com/sebastiangallo370-cmd/indoor-panel-operativo/releases/download/agente-excel/'
REVISAR_VERSION_SEG = 600   # cada 10 min mira si hay versión nueva y se actualiza sola


# ---------------------------------------------------------------- configuración y panel
def leer_config() -> dict:
    try:
        return json.loads(CONFIG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def guardar_config(c: dict) -> None:
    CONFIG.write_text(json.dumps(c, ensure_ascii=False), encoding='utf-8')


def pedir(ruta: str, datos: dict | None = None, token: str = '', binario: bool = False):
    req = urllib.request.Request(URL + ruta, data=json.dumps(datos).encode() if datos is not None else None, method='POST' if datos is not None else 'GET',
                                 headers={'Content-Type': 'application/json', 'User-Agent': f'AgenteExcelIndoor/{VERSION}', **({'Authorization': 'Bearer ' + token} if token else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        cuerpo = r.read()
    return cuerpo if binario else json.loads(cuerpo or b'{}')


def iniciar_con_el_equipo() -> None:
    """Que el agente arranque solo al prender el computador (una vez configurado)."""
    exe = sys.executable if getattr(sys, 'frozen', False) else ''
    if not exe:
        return
    try:
        if ES_MAC:
            # dentro de la .app el ejecutable está en Contents/MacOS: se registra un LaunchAgent del usuario
            plist = Path.home() / 'Library' / 'LaunchAgents' / 'co.indoorsport.agenteexcel.plist'
            plist.parent.mkdir(parents=True, exist_ok=True)
            plist.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>co.indoorsport.agenteexcel</string>
<key>ProgramArguments</key><array><string>{exe}</string></array><key>RunAtLoad</key><true/></dict></plist>
''', encoding='utf-8')
        elif platform.system() == 'Windows':
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE) as k:
                winreg.SetValueEx(k, 'AgenteExcelIndoor', 0, winreg.REG_SZ, f'"{exe}"')
    except Exception:  # noqa: BLE001 - si no se puede, igual funciona abriéndolo a mano
        pass


# ---------------------------------------------------------------- actualización automática
def _num(v: str) -> tuple:
    import re
    return tuple(int(x) for x in re.findall(r'\d+', v or '')[:3])


def descargar(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': f'AgenteExcelIndoor/{VERSION}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def actualizar_si_hay() -> bool:
    """Si en GitHub hay una versión más nueva, la baja, reemplaza este programa y lo vuelve a abrir. True = el agente debe cerrarse ya."""
    if not getattr(sys, 'frozen', False):
        return False
    try:
        nueva = descargar(RELEASE + 'version.txt').decode().strip()
    except Exception:  # noqa: BLE001
        return False
    if _num(nueva) <= _num(VERSION):
        return False
    import subprocess
    import zipfile
    tmp = Path(tempfile.mkdtemp(prefix='indoor_act_'))
    zipf = tmp / 'nuevo.zip'
    zipf.write_bytes(descargar(RELEASE + ('AgenteExcelIndoor-Mac.zip' if ES_MAC else 'AgenteExcelIndoor-Windows.zip')))
    exe = Path(sys.executable)
    if ES_MAC:
        app = exe.parents[2]      # …/AgenteExcelIndoor.app/Contents/MacOS/AgenteExcelIndoor
        sh = tmp / 'actualizar.sh'
        sh.write_text(f'''#!/bin/sh
sleep 3
rm -rf "{app}"
ditto -x -k "{zipf}" "{app.parent}"
xattr -dr com.apple.quarantine "{app}" 2>/dev/null
open "{app}"
''', encoding='utf-8')
        os.chmod(sh, 0o755)
        subprocess.Popen(['/bin/sh', str(sh)], start_new_session=True)
    else:
        with zipfile.ZipFile(zipf) as z:
            z.extract('AgenteExcelIndoor.exe', tmp)
        bat = tmp / 'actualizar.bat'
        # reintenta copiar hasta que este programa se haya cerrado (mientras corre, Windows bloquea el .exe)
        bat.write_text(f'''@echo off
set n=0
:otra
timeout /t 2 /nobreak >nul
set /a n+=1
copy /y "{tmp / 'AgenteExcelIndoor.exe'}" "{exe}" >nul 2>&1 || (if %n% lss 60 goto otra)
start "" "{exe}"
''', encoding='mbcs')
        subprocess.Popen(['cmd', '/c', str(bat)], creationflags=0x08000000 | 0x00000008)   # sin ventana, independiente
    return True


# ---------------------------------------------------------------- llenar Excel a la vista
def llenar(trabajo: dict, token: str, aviso) -> str:
    import xlwings as xw
    carpeta = Path(tempfile.mkdtemp(prefix='indoor_'))
    datos_base = pedir(trabajo['base'], token=token, binario=True)
    for h in trabajo['plan']['hojas']:
        for im in h['imagenes']:
            (carpeta / im['archivo']).write_bytes(pedir(trabajo['imagenes_url'] + im['archivo'], token=token, binario=True))
    SALIDA.mkdir(parents=True, exist_ok=True)
    # el archivo se abre YA con el nombre del pedido y en su carpeta final (Excel no deja abrir dos libros con el mismo nombre:
    # si uno igual sigue abierto de una prueba anterior, se usa CO6380_2.xlsm, _3…)
    app = xw.apps.active if xw.apps.count else xw.App(visible=True, add_book=False)
    abiertos = {b.name.lower() for b in app.books}
    nombre = Path(trabajo['nombre'])
    destino, k = SALIDA / nombre.name, 2
    while destino.name.lower() in abiertos or destino.exists():
        destino = SALIDA / f'{nombre.stem}_{k}{nombre.suffix}'; k += 1
    destino.write_bytes(datos_base)
    app.visible = True
    try:
        app.activate(steal_focus=True)
    except Exception:  # noqa: BLE001
        pass
    wb = app.books.open(str(destino))
    # Excel al FRENTE y maximizado, para que el comercial lo vea llenarse
    try:
        wb.activate()
        if ES_MAC:
            app.activate(steal_focus=True)
        else:
            app.api.WindowState = -4137                 # xlMaximized
            app.api.ActiveWindow.WindowState = -4137
            import ctypes
            ctypes.windll.user32.ShowWindow(app.hwnd, 3)  # SW_MAXIMIZE
            ctypes.windll.user32.SetForegroundWindow(app.hwnd)
    except Exception:  # noqa: BLE001
        pass
    total = sum(len(h['celdas']) for h in trabajo['plan']['hojas']) or 1
    hechas = 0
    for h in trabajo['plan']['hojas']:
        hoja = wb.sheets[h['nombre']]
        hoja.activate()
        for c in h['celdas']:
            rango = hoja.range(c['celda'])
            try:
                rango.select()
            except Exception:  # noqa: BLE001
                pass
            valor = c['valor']
            if c.get('fecha'):
                try:
                    valor = dt.datetime.strptime(str(valor)[:10], '%Y-%m-%d')
                except ValueError:
                    pass
            rango.value = valor
            hechas += 1
            if hechas % 5 == 0 or hechas == total:
                aviso(f'Llenando {hechas} de {total} celdas…', hechas, total)
            time.sleep(PAUSA_CELDA)
        for im in h['imagenes']:
            aviso(f'Insertando mockup en {h["nombre"]}…', hechas, total)
            celda = hoja.range(im['celda'])
            if im.get('hasta'):
                fin = hoja.range(im['hasta'])
                ancho, alto = max(20, fin.left - celda.left), max(20, fin.top - celda.top)
            else:
                ancho, alto = im.get('ancho') or 200, im.get('alto') or 300
            hoja.pictures.add(str(carpeta / im['archivo']), left=celda.left, top=celda.top, width=ancho, height=alto)
            time.sleep(0.6)
    wb.sheets[0].activate()
    wb.save()
    return str(destino)


# ---------------------------------------------------------------- ventana
class Agente:
    def __init__(self):
        self.ventana = tk.Tk()
        self.ventana.title('Agente Excel · Indoor Sport')
        self.ventana.geometry('380x170')
        self.ventana.configure(bg='#0d140e')
        tk.Label(self.ventana, text='AGENTE EXCEL · INDOOR', fg='#d0f44c', bg='#0d140e', font=('Arial', 13, 'bold')).pack(pady=(14, 4))
        self.estado = tk.Label(self.ventana, text='Iniciando…', fg='#e8f0e0', bg='#0d140e', font=('Arial', 10), wraplength=340, justify='center')
        self.estado.pack(pady=6)
        tk.Label(self.ventana, text='Déjalo abierto o minimizado (la X solo lo minimiza). Arranca solo al prender el PC. Al programar un pedido en el panel, Excel se llenará solo.', fg='#a9b5a3', bg='#0d140e',
                 font=('Arial', 8), wraplength=340).pack(pady=4)
        self.config = leer_config()
        self.resultados = []
        # la X no cierra el agente: lo minimiza (si se cerrara, Excel dejaría de llenarse). Para salir de verdad: Ctrl+Q en la ventana.
        self.ventana.protocol('WM_DELETE_WINDOW', self.ventana.iconify)
        self.ventana.bind('<Control-q>', lambda e: self.ventana.destroy())

    def poner(self, texto):
        self.estado.config(text=texto)
        self.ventana.update()

    def vincular(self) -> bool:
        while not self.config.get('token'):
            codigo = simpledialog.askstring('Vincular con el panel', 'En el panel: PROGRAMAR CLUB → AGENTE EXCEL → «Generar código».\nEscribe aquí ese código:', parent=self.ventana)
            if not codigo:
                return False
            try:
                r = pedir('/api/agente-excel/pc/enlazar', {'codigo': codigo.strip(), 'equipo': socket.gethostname(), 'so': platform.system() + ' ' + platform.release()})
                self.config.update(token=r['token'], usuario=r.get('usuario', ''))
                guardar_config(self.config)
                iniciar_con_el_equipo()
            except urllib.error.HTTPError as e:
                messagebox.showerror('Código no válido', e.read().decode(errors='ignore')[:300] or 'El código no sirvió: genera uno nuevo.')
            except Exception as e:  # noqa: BLE001
                messagebox.showerror('Sin conexión', f'No pude conectar con {URL}: {e}')
        return True

    def ciclo(self):
        try:
            r = pedir('/api/agente-excel/pc/sondeo', {'resultados': self.resultados, 'version': VERSION}, token=self.config['token'])
            self.resultados = []
            self.poner(f'Conectado como {r.get("usuario") or self.config.get("usuario", "")} · esperando pedidos')
            for t in r.get('trabajos', []):
                self.trabajar(t)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                self.config.pop('token', None); guardar_config(self.config)
                self.poner('Este equipo se desvinculó: pide un código nuevo.')
                if not self.vincular():
                    self.ventana.destroy(); return
            else:
                self.poner(f'El panel respondió {e.code}; reintentando…')
        except Exception:  # noqa: BLE001
            self.poner('Sin conexión con el panel; reintentando…')
        if time.time() - getattr(self, '_ultima_revision', 0) > REVISAR_VERSION_SEG:
            self._ultima_revision = time.time()
            try:
                if actualizar_si_hay():
                    self.poner('Actualizando el agente… se vuelve a abrir solo.')
                    self.ventana.after(800, self.ventana.destroy)
                    return
            except Exception:  # noqa: BLE001 - si falla, sigue con la versión actual
                pass
        self.ventana.after(SONDEO_MS, self.ciclo)

    def trabajar(self, t):
        tid = t['id']
        self.poner(f'Abriendo Excel para {t["nombre"]}…')

        def aviso(texto, hechas, total):
            self.poner(texto)
            if hechas % 10 == 0 or hechas == 5:
                try:
                    pedir('/api/agente-excel/pc/sondeo', {'resultados': [{'id': tid, 'estado': 'llenando', 'detalle': texto}], 'puede_trabajar': False}, token=self.config['token'])
                except Exception:  # noqa: BLE001
                    pass
        try:
            ruta = llenar(t, self.config['token'], aviso)
            self.resultados.append({'id': tid, 'estado': 'listo', 'detalle': 'Listo en tu computador: ' + ruta})
            self.poner('Listo ✓ ' + Path(ruta).name)
        except Exception as e:  # noqa: BLE001
            detalle = str(e)[:200] or traceback.format_exc()[-200:]
            if ES_MAC and ('-1743' in detalle or 'not allowed' in detalle.lower()):
                detalle = 'Mac: falta el permiso. Ajustes → Privacidad y seguridad → Automatización → permite que AgenteExcelIndoor controle Microsoft Excel.'
            self.resultados.append({'id': tid, 'estado': 'error', 'detalle': detalle})
            self.poner('No pude llenar Excel: ' + detalle)

    def correr(self):
        self.ventana.after(200, self.empezar)
        self.ventana.mainloop()

    def empezar(self):
        if not self.vincular():
            self.ventana.destroy(); return
        self.ciclo()


if __name__ == '__main__':
    Agente().correr()
