"""Mide cuánto tarda Illustrator en abrir un maestro: con su vínculo roto y después de corregirlo. Trabaja sobre una COPIA LOCAL (no toca la NAS).
Uso: python medir_apertura_maestro.py "<ruta del maestro .ai>" salida.json
Respeta el candado de Illustrator de los agentes de ECOMMERCE (no se pisan con BRISA / CIRO)."""
import contextlib, json, os, shutil, sys, tempfile, threading, time
from pathlib import Path

origen = Path(sys.argv[1])
salida = Path(sys.argv[2])
COLA_REAL = Path(r'C:\Users\Administrador\Desktop\agentes_uniformes\ecommerce\cola')
LOCK = COLA_REAL / 'illustrator.lock'
res = {'maestro': origen.name, 'mb': round(origen.stat().st_size / 1048576, 1)}

JSX_RELINK = r'''
(function () {
  var doc = app.activeDocument, items = doc.placedItems, n = 0, err = 0;
  var destino = new File(DISENO_REAL);
  if (!destino.exists) return 'no existe el diseno: ' + DISENO_REAL;
  for (var i = 0; i < items.length; i++) {
    try { items[i].file = destino; n++; } catch (e) { err++; }
  }
  return 'vinculos=' + items.length + ' arreglados=' + n + ' errores=' + err;
})();
'''


def esperar_candado():
    t0 = time.time()
    while True:
        try:
            fd = os.open(str(LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, b'medicion')
            os.close(fd)
            return time.time() - t0
        except FileExistsError:
            if time.time() - LOCK.stat().st_mtime > 1500:
                LOCK.unlink(missing_ok=True)
            time.sleep(3)


def abrir_con_tiempo(app, ruta, limite=1800):
    """app.Open con límite de tiempo (si Illustrator quedara esperando algo, no se cuelga para siempre)."""
    caja = {}
    def trabajo():
        import pythoncom
        pythoncom.CoInitialize()
        try:
            app2 = __import__('win32com.client', fromlist=['Dispatch']).Dispatch('Illustrator.Application')
            t = time.time()
            caja['doc'] = app2.Open(str(ruta))
            caja['seg'] = time.time() - t
        except Exception as e:  # noqa: BLE001
            caja['error'] = str(e)
    h = threading.Thread(target=trabajo, daemon=True)
    h.start(); h.join(limite)
    if h.is_alive():
        raise TimeoutError(f'Illustrator no terminó de abrir {Path(ruta).name} en {limite} s')
    if 'error' in caja:
        raise RuntimeError(caja['error'])
    return caja['doc'], caja['seg']


tmp = Path(tempfile.mkdtemp(prefix='medir_maestro_'))
try:
    import pythoncom, win32com.client
    pythoncom.CoInitialize()
    t = time.time(); copia = tmp / origen.name; shutil.copy2(origen, copia); res['copiar_a_local_seg'] = round(time.time() - t, 1)
    res['espera_candado_seg'] = round(esperar_candado())
    app = win32com.client.Dispatch('Illustrator.Application')
    print('1) abriendo la copia local CON el vínculo roto…', flush=True)
    doc, seg = abrir_con_tiempo(app, copia)
    res['abrir_con_vinculo_roto_seg'] = round(seg, 1)
    print(f'   tardó {seg:.1f} s', flush=True)
    carpeta_real = str(origen.parent).replace('\\', '/')
    r = app.DoJavaScript('var DISENO_REAL = "' + carpeta_real + '/' + __import__('glob').glob(str(origen.parent) + '/' + sys.argv[3])[0].replace(chr(92), '/').split('/')[-1] + '";\n' + JSX_RELINK)
    res['relink'] = str(r)
    print('   relink:', r, flush=True)
    doc.Save()
    doc.Close(2)
    print('2) abriendo la copia local DESPUÉS de corregir…', flush=True)
    doc, seg = abrir_con_tiempo(app, copia)
    res['abrir_corregido_seg'] = round(seg, 1)
    print(f'   tardó {seg:.1f} s', flush=True)
    doc.Close(2)
    res['ok'] = True
except Exception as e:  # noqa: BLE001
    res['ok'] = False
    res['error'] = str(e)
    print('ERROR:', e, flush=True)
finally:
    with contextlib.suppress(Exception):
        LOCK.unlink(missing_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    salida.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False), flush=True)
