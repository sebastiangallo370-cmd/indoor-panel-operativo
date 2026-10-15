"""Arma el video final de la prueba: tarjeta de título + tramos con Illustrator + tarjeta de resultado (vista del PDF generado)."""
import subprocess, sys, tempfile, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FF = r'C:\Users\Administrador\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
corto, final, pdf_resultado = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
tmp = Path(tempfile.mkdtemp(prefix='armar_'))
F = lambda n: ImageFont.truetype(r'C:\Windows\Fonts\segoeui.ttf' if n < 100 else r'C:\Windows\Fonts\segoeuib.ttf', n % 100 if n >= 100 else n)
FONDO, VERDE, TEXTO, GRIS = (11, 15, 9), (208, 244, 76), (238, 243, 234), (160, 172, 152)


def tarjeta(lineas, ruta, imagen=None):
    im = Image.new('RGB', (1280, 720), FONDO)
    d = ImageDraw.Draw(im)
    x0 = 70
    if imagen is not None:
        imagen.thumbnail((470, 620))
        im.paste(imagen, (1280 - imagen.width - 60, (720 - imagen.height) // 2))
        x0 = 70
    y = 130 if imagen is None else 90
    for texto, tam, color in lineas:
        fuente = ImageFont.truetype(r'C:\Windows\Fonts\segoeuib.ttf' if tam >= 34 else r'C:\Windows\Fonts\segoeui.ttf', tam)
        d.text((x0, y), texto, font=fuente, fill=color)
        y += int(tam * 1.55)
    im.save(ruta)


tarjeta([('PRUEBA REAL · OV1216', 54, VERDE), ('ECOMMERCE · agentes BRISA y CIRO', 34, TEXTO), ('', 20, TEXTO),
         ('BRISA  abre el maestro y exporta las tallas', 28, TEXTO), ('CIRO   pone nombre y número, genera el PDF', 28, TEXTO),
         ('        arma el listado y prepara Google Sheets', 28, TEXTO), ('', 20, TEXTO),
         ('Solo se muestran los tramos con Illustrator (x3).', 24, GRIS), ('La prueba no dejó rastro en producción.', 24, GRIS)], tmp / 'titulo.png')
import pdfplumber
with pdfplumber.open(pdf_resultado) as p:
    pagina = p.pages[0].to_image(resolution=110).original.convert('RGB')
tarjeta([('RESULTADO: CORRECTO', 50, VERDE), ('Vista del PDF de producción de la orden', 30, TEXTO), ('Talla 6 · Diseño 1 · EDWIN #2', 30, TEXTO), ('', 20, TEXTO),
         ('También se generó el listado de', 26, GRIS), ('producción (Excel) de la orden.', 26, GRIS), ('', 14, TEXTO),
         ('Google Sheets: simulado a propósito', 26, GRIS), ('(no se escribió en la hoja real).', 26, GRIS), ('', 14, TEXTO),
         ('La cola quedó: 1 terminada, 0 con avisos.', 26, GRIS)], tmp / 'resultado.png', pagina)


def clip(png, seg, salida):
    subprocess.run([FF, '-y', '-loop', '1', '-i', str(png), '-t', str(seg), '-r', '6', '-vf', 'scale=1280:720,format=yuv420p', '-c:v', 'libx264',
                    '-preset', 'fast', '-crf', '24', str(salida)], capture_output=True)


clip(tmp / 'titulo.png', 5, tmp / 'titulo.mp4')
clip(tmp / 'resultado.png', 10, tmp / 'resultado.mp4')
lista = tmp / 'lista.txt'
lista.write_text(''.join(f"file '{(tmp / n).as_posix() if n != 'corto' else corto.as_posix()}'\n" for n in ('titulo.mp4', 'corto', 'resultado.mp4')), encoding='utf-8')
# se recodifica el tramo corto a los mismos parámetros para poder unir sin problemas
subprocess.run([FF, '-y', '-i', str(corto), '-r', '6', '-vf', 'scale=1280:720,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', str(tmp / 'corto2.mp4')], capture_output=True)
lista.write_text(''.join(f"file '{(tmp / n).as_posix()}'\n" for n in ('titulo.mp4', 'corto2.mp4', 'resultado.mp4')), encoding='utf-8')
r = subprocess.run([FF, '-y', '-f', 'concat', '-safe', '0', '-i', str(lista), '-c', 'copy', str(final)], capture_output=True, text=True)
print('ffmpeg:', r.returncode, 'ok' if r.returncode == 0 else r.stderr[-300:])
shutil.rmtree(tmp, ignore_errors=True)
