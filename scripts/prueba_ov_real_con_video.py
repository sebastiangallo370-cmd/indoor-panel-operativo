"""Prueba REAL de una orden de venta (por defecto OV1216) por los pasos de BRISA y CIRO, grabando la pantalla.

Usa Illustrator de verdad y el código real de BOT_ORDENES_VENTA, pero NO deja rastro en producción:
  · los PDF, el listado y la copia para la impresora se escriben en una carpeta de prueba que se borra al final;
  · Google Sheets NO se escribe (se muestra la fila que se agregaría) y el historial de procesadas no se toca;
  · la cola es temporal.
Graba el escritorio con ffmpeg (el que trae imageio_ffmpeg).  Uso: python prueba_ov_real_con_video.py 1216 salida.mp4
"""
import contextlib, ctypes, importlib.util, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

numero = sys.argv[1] if len(sys.argv) > 1 else '1216'
video = Path(sys.argv[2] if len(sys.argv) > 2 else f'prueba_OV{numero}.mp4')
RAIZ = Path(__file__).resolve().parent.parent
base = Path(tempfile.mkdtemp(prefix=f'prueba_OV{numero}_'))
cliente, copia = base / 'cliente', base / 'copia_impresora'
cliente.mkdir(); copia.mkdir()
os.environ['CARPETA_CLIENTE_OV'] = str(cliente)         # antes de importar maestros_ov
os.environ['CARPETA_COPIA_PDF_OV'] = str(copia)


def titulo(texto):
    print('\n' + '=' * 70 + f'\n  {texto}\n' + '=' * 70, flush=True)


def al_frente():
    with contextlib.suppress(Exception):
        h = ctypes.windll.kernel32.GetConsoleWindow()
        ctypes.windll.user32.ShowWindow(h, 9)
        ctypes.windll.user32.SetForegroundWindow(h)


ffmpeg = None
with contextlib.suppress(Exception):
    sys.path.append(str(Path(os.environ.get('APPDATA', '')) / 'Python' / 'Python314' / 'site-packages'))   # donde está imageio_ffmpeg
    import imageio_ffmpeg
    ffmpeg = subprocess.Popen(
        [imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-f', 'gdigrab', '-framerate', '6', '-i', 'desktop', '-vf', 'scale=1280:-2',
         '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', str(video)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('Grabación de pantalla:', 'iniciada' if ffmpeg else 'NO disponible', flush=True)
time.sleep(3)

resultado = {'ok': False}
try:
    titulo(f'PRUEBA REAL · OV{numero} · agentes BRISA y CIRO (sin dejar rastro en producción)')
    spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
    ag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ag)
    real, _, ruta = ag.cargar_ov(con_effi=False)
    ag.COLA = base / 'cola'
    COLA_REAL = Path(r'C:\Users\Administrador\Desktop\agentes_uniformes\ecommerce\cola')   # el candado de Illustrator sí es el de producción
    pdf = ruta / 'PDF_OV' / f'OV_{numero}.pdf'
    print('PDF de la orden:', pdf.name, '|', pdf.stat().st_size, 'bytes')

    class Mixto:
        """Todo es el código real de maestros_ov.py, salvo Google Sheets (solo se muestra la fila)."""
        def __getattr__(self, nombre): return getattr(real, nombre)
        def registrar_en_sheets(self, p, items):
            enc = real.leer_encabezado(p)
            print('  [SIMULADO] Google Sheets: se agregaría 1 fila ->', f"OV{enc['orden']} | {enc['cliente']} | "
                  + ', '.join(dict.fromkeys(i['ref'] for i in items)) + f" | {enc['unidades']} und. | entrega {real.sumar_dias_habiles(enc['creacion'], real.DIAS_HABILES_ENTREGA)}")
            print('             (no se escribe: esta prueba no toca la hoja de producción)')
            return True

    candado_prueba = ag.illustrator

    @contextlib.contextmanager
    def candado_real(rol):
        propia = ag.COLA
        ag.COLA = COLA_REAL
        try:
            with candado_prueba(rol):
                ag.COLA = propia
                yield
        finally:
            ag.COLA = propia
    ag.illustrator = candado_real
    ag.registrar_procesada = lambda *a, **k: print('  [SIMULADO] historial de procesadas: no se modifica')

    mo = Mixto()
    ag.guardar_trabajo('1_descargadas', {'numero': numero, 'pdf': str(pdf), 'intentos': 0, 'origen': 'prueba con video'})
    titulo('BRISA · exporta las tallas en Illustrator')
    ag.ciclo_tallas(mo, ag.trabajos('1_descargadas')[0])
    titulo('CIRO · nombre y número (PDF por jugador), listado Excel y Google Sheets')
    ag.ciclo_pdfs(mo, base, ag.trabajos('2_tallas')[0])

    titulo('RESULTADO')
    archivos = sorted(p for p in base.rglob('*') if p.is_file() and 'cola' not in p.parts)
    for p in archivos:
        print('  ·', str(p.relative_to(base)), f'({p.stat().st_size // 1024} KB)')
    pdfs = [p for p in archivos if p.suffix.lower() == '.pdf' and p.parent.name != 'copia_impresora']
    texto = ''
    for p in pdfs:
        with contextlib.suppress(Exception):
            import pdfplumber
            with pdfplumber.open(p) as d:
                texto += ' '.join((pg.extract_text() or '') for pg in d.pages)
    print('  Texto del PDF generado contiene «EDWIN»:', 'EDWIN' in texto.upper())
    estado = ag.conteos()
    print('  Cola de la prueba:', estado)
    resultado = {'ok': estado.get('3_terminadas') == 1 and bool(pdfs), 'cola': estado, 'pdfs': [p.name for p in pdfs],
                 'listado': any(p.suffix.lower() == '.xlsm' for p in archivos), 'nombre_en_pdf': 'EDWIN' in texto.upper()}
    print('\n  RESULTADO FINAL:', 'CORRECTO ✔' if resultado['ok'] else 'CON PROBLEMAS ✖', flush=True)
except Exception as e:  # noqa: BLE001
    import traceback
    traceback.print_exc()
    resultado = {'ok': False, 'error': str(e)}
finally:
    al_frente()
    time.sleep(7)   # que el video termine mostrando el resultado
    if ffmpeg:
        with contextlib.suppress(Exception):
            ffmpeg.stdin.write(b'q'); ffmpeg.stdin.flush()
        with contextlib.suppress(Exception):
            ffmpeg.wait(timeout=60)
    shutil.rmtree(base, ignore_errors=True)   # borra los PDF, el listado y la cola de la prueba
    (Path(tempfile.gettempdir()) / f'resultado_OV{numero}.json').write_text(json.dumps(resultado, ensure_ascii=False), encoding='utf-8')
    print('\nCarpeta de prueba borrada:', not base.exists(), '| video:', video, video.exists(), flush=True)
    time.sleep(2)
