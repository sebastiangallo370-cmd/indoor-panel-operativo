"""Corrige los vínculos rotos de los maestros de INTERCLASES 2027 (apuntan a «INDOOR SPORT S.A.S\\...\\CA01_D1_D2» que no existe) para que
apunten al diseño que SÍ está en la misma carpeta del maestro. Con RESPALDO de cada archivo antes de tocarlo y registro de tiempos.

Uso:  python arreglar_vinculos_maestros.py --uno "<ruta del maestro>"      (prueba con uno)
      python arreglar_vinculos_maestros.py --todos [--desde N] [--limite N]
Solo guarda un maestro si logra arreglar al menos un vínculo. Se detiene al primer error. Respeta el candado de Illustrator de ECOMMERCE."""
import argparse, contextlib, hashlib, json, os, re, shutil, sys, threading, time
from datetime import datetime
from pathlib import Path

RAIZ_MAESTROS = Path(r'\\192.168.0.120\nas indoor\CLIENTES\INDOOR SPORT SAS\MAESTROS\INTERCLASES 2027')
RESPALDO = Path(r'\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\AGENTES_INDOOR\_respaldos_maestros_vinculos_20261014')
COLA_REAL = Path(r'C:\Users\Administrador\Desktop\agentes_uniformes\ecommerce\cola')
LOCK = COLA_REAL / 'illustrator.lock'
REGISTRO = Path(__file__).resolve().parent.parent / 'Claude outputs' / 'vinculos_maestros_registro.json'
PATRON = re.compile(rb'192\.168\.0\.120[\\/]+nas indoor[\\/]+CLIENTES[\\/]+([^\x00-\x1f"<>|]{3,260}?\.(?:ai|pdf|png|jpg|jpeg|psd|tif))', re.I)

JSX = r'''
(function () {
  var doc = app.activeDocument, items = doc.placedItems, ok = 0, rotos = 0, arreglados = 0, faltan = [];
  for (var i = 0; i < items.length; i++) {
    var f = null;
    try { f = items[i].file; } catch (e) { rotos++; faltan.push('sin-archivo#' + i); continue; }
    if (f && f.exists) { ok++; continue; }
    rotos++;
    var nombre = f ? decodeURI(f.name) : '';
    var destino = new File(CARPETA_REAL + '/' + nombre);
    if (nombre && destino.exists) { try { items[i].file = destino; arreglados++; } catch (e) { faltan.push(nombre + ' (error al revincular)'); } }
    else faltan.push(nombre || ('#' + i));
  }
  return 'vinculos=' + items.length + ' ok=' + ok + ' rotos=' + rotos + ' arreglados=' + arreglados + (faltan.length ? ' faltan=' + faltan.join('|') : '');
})();
'''


def vinculos_rotos(ruta: Path) -> int:
    datos = ruta.read_bytes()
    malos = 0
    for e in {m.group(1).decode('latin-1') for m in PATRON.finditer(datos)}:
        try:
            nombre = e.encode('latin-1').decode('utf-8')
        except UnicodeError:
            nombre = e
        if '/' in nombre.replace('\\', '/') and not os.path.exists('//192.168.0.120/nas indoor/CLIENTES/' + nombre.replace('\\', '/')):
            malos += 1
    return malos


def sha(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, 'rb') as f:
        for bloque in iter(lambda: f.read(1 << 20), b''):
            h.update(bloque)
    return h.hexdigest()


def candado():
    while True:
        try:
            fd = os.open(str(LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, b'arreglo de vinculos')
            os.close(fd)
            return
        except FileExistsError:
            if time.time() - LOCK.stat().st_mtime > 2400:
                LOCK.unlink(missing_ok=True)
            time.sleep(3)


def abrir(app_nombre, ruta, limite=2400):
    caja = {}

    def trabajo():
        import pythoncom, win32com.client
        pythoncom.CoInitialize()
        try:
            app = win32com.client.Dispatch(app_nombre)
            t = time.time()
            caja['doc'] = app.Open(str(ruta))
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


def arreglar(ruta: Path, medir_despues: bool) -> dict:
    r = {'archivo': str(ruta.relative_to(RAIZ_MAESTROS)), 'inicio': datetime.now().isoformat(timespec='seconds')}
    r['rotos_antes'] = vinculos_rotos(ruta)
    if not r['rotos_antes']:
        r['resultado'] = 'sin vínculos rotos: no se toca'
        return r
    # 1) respaldo verificado
    destino = RESPALDO / ruta.relative_to(RAIZ_MAESTROS)
    destino.parent.mkdir(parents=True, exist_ok=True)
    if not destino.exists():
        shutil.copy2(ruta, destino)
    if sha(destino) != sha(ruta):
        raise RuntimeError('El respaldo no coincide con el original: no se toca el maestro')
    r['respaldo'] = str(destino)
    # 2) abrir (con el vínculo roto), revincular y guardar
    import pythoncom, win32com.client
    pythoncom.CoInitialize()
    app = win32com.client.Dispatch('Illustrator.Application')
    doc, seg = abrir('Illustrator.Application', ruta)
    r['abrir_roto_seg'] = round(seg, 1)
    res = str(app.DoJavaScript('var CARPETA_REAL = "' + str(ruta.parent).replace('\\', '/') + '";\n' + JSX))
    r['jsx'] = res
    arreglados = int(re.search(r'arreglados=(\d+)', res).group(1))
    t = time.time()
    if arreglados:
        doc.Save()
        r['guardar_seg'] = round(time.time() - t, 1)
    doc.Close(2)
    r['guardado'] = bool(arreglados)
    r['rotos_despues'] = vinculos_rotos(ruta)
    if medir_despues and arreglados:
        doc, seg = abrir('Illustrator.Application', ruta)
        r['abrir_corregido_seg'] = round(seg, 1)
        doc.Close(2)
    r['resultado'] = 'corregido' if arreglados and not r['rotos_despues'] else ('corregido en parte' if arreglados else 'no se pudo revincular (ver jsx)')
    r['fin'] = datetime.now().isoformat(timespec='seconds')
    return r


def guardar_registro(r):
    datos = []
    with contextlib.suppress(Exception):
        datos = json.loads(REGISTRO.read_text(encoding='utf-8'))
    datos.append(r)
    REGISTRO.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--uno')
    ap.add_argument('--todos', action='store_true')
    ap.add_argument('--desde', type=int, default=0)
    ap.add_argument('--limite', type=int, default=999)
    a = ap.parse_args()
    if a.uno:
        lista = [Path(a.uno)]
    else:
        lista = sorted(p for p in RAIZ_MAESTROS.rglob('*.ai') if 'viej' not in str(p).lower() and 'MUESTRA' not in p.name.upper() and not p.name.startswith('~'))
        lista = [p for p in lista if vinculos_rotos(p)][a.desde:a.desde + a.limite]
    print(f'{len(lista)} maestro(s) por corregir', flush=True)
    for i, p in enumerate(lista, 1):
        print(f'[{i}/{len(lista)}] {p.name} …', flush=True)
        candado()
        try:
            r = arreglar(p, medir_despues=(i == 1))
        except Exception as e:  # noqa: BLE001
            r = {'archivo': str(p), 'resultado': 'ERROR', 'error': str(e)}
        finally:
            with contextlib.suppress(Exception):
                LOCK.unlink(missing_ok=True)
        guardar_registro(r)
        print('   ', json.dumps(r, ensure_ascii=False), flush=True)
        if r.get('resultado') == 'ERROR':
            print('Me detengo en el primer error.', flush=True)
            sys.exit(1)


if __name__ == '__main__':
    main()
