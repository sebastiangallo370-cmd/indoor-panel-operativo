"""Diagnóstico: abre una COPIA LOCAL de un maestro y guarda cada mesa (artboard) como .ai en una carpeta temporal, anotando cuáles fallan y con qué mensaje.
Uso: python diagnosticar_mesas_maestro.py "<maestro .ai>" salida.json   (no toca la NAS)"""
import json, re, shutil, sys, tempfile, time
from pathlib import Path

origen, salida = Path(sys.argv[1]), Path(sys.argv[2])
res = {'maestro': origen.name, 'mesas': []}
tmp = Path(tempfile.mkdtemp(prefix='diag_mesas_'))
JSX = r'''
(function () {
  var doc = app.activeDocument, out = [];
  var ou = new IllustratorSaveOptions(); ou.pdfCompatible = true; ou.compressed = true; ou.saveMultipleArtboards = true;
  for (var k = 0; k < doc.artboards.length; k++) {
    var nombre = doc.artboards[k].name, t0 = new Date().getTime(), estado = 'ok';
    try {
      doc.artboards.setActiveArtboardIndex(k);
      try { app.executeMenuCommand('fitin'); app.redraw(); $.sleep(350); } catch (ev) {}
      ou.artboardRange = String(k + 1);
      var d = new Folder(CARPETA + '/' + k); d.create();
      doc.saveAs(new File(d.fsName + '/m.ai'), ou);
      var ow = new IllustratorSaveOptions(); ow.pdfCompatible = true; ow.compressed = true; ow.saveMultipleArtboards = true; ow.embedLinkedFiles = true; ow.artboardRange = String(k + 1);
      var d2 = new Folder(CARPETA + '/w' + k); d2.create();
      doc.saveAs(new File(d2.fsName + '/m.ai'), ow);
    } catch (e) { estado = 'ERROR: ' + e; }
    out.push((k + 1) + '|' + nombre + '|' + estado + '|' + Math.round((new Date().getTime() - t0) / 1000) + 's');
  }
  return out.join('\n');
})();
'''
try:
    import pythoncom, win32com.client
    pythoncom.CoInitialize()
    copia = tmp / origen.name
    shutil.copy2(origen, copia)
    app = win32com.client.Dispatch('Illustrator.Application')
    t = time.time(); doc = app.Open(str(copia)); res['abrir_seg'] = round(time.time() - t, 1)
    r = app.DoJavaScript('var CARPETA = "' + (tmp / 'out').as_posix() + '";\n' + JSX)
    res['mesas'] = str(r).split('\n')
    doc.Close(2)
    res['ok'] = True
except Exception as e:  # noqa: BLE001
    res['ok'] = False; res['error'] = str(e)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    salida.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(res, ensure_ascii=False))
