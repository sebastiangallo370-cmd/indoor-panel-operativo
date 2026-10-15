"""Deja del video grabado SOLO los tramos donde Illustrator está al frente (sin consola ni la otra ventana) y lo acelera."""
import subprocess, sys, tempfile, shutil
from pathlib import Path
from PIL import Image

entrada, salida = Path(sys.argv[1]), Path(sys.argv[2])
velocidad = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
FF = r'C:\Users\Administrador\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
tmp = Path(tempfile.mkdtemp(prefix='recorte_'))
PASO = 2   # segundos entre muestras
subprocess.run([FF, '-y', '-i', str(entrada), '-vf', f'fps=1/{PASO},scale=320:-1', str(tmp / 'f_%05d.png')], capture_output=True)
marcas = []
for f in sorted(tmp.glob('f_*.png')):
    im = Image.open(f).convert('RGB')
    w, h = im.size
    # logo naranja de Illustrator arriba a la izquierda
    px = [im.getpixel((x, y)) for x in range(2, 6) for y in range(1, 4)]
    naranja = sum(1 for r, g, b in px if r > 110 and g < 100 and b < 45 and r - g > 50) >= 2
    # consola: bloque casi negro en el centro-izquierda
    caja = im.crop((int(w * .12), int(h * .15), int(w * .55), int(h * .5)))
    brillo = sum(sum(p) / 3 for p in caja.getdata()) / (caja.size[0] * caja.size[1])
    marcas.append(naranja and brillo > 38)
# tramos continuos (se toleran huecos de 1 muestra)
tramos, ini = [], None
for i, ok in enumerate(marcas + [False, False]):
    if ok and ini is None:
        ini = i
    elif not ok and ini is not None and not (i + 1 < len(marcas) and marcas[i + 1]):
        tramos.append((ini * PASO, (i) * PASO))
        ini = None
tramos = [(a, b) for a, b in tramos if b - a >= 2]
print('muestras:', len(marcas), '| con Illustrator al frente:', sum(marcas), '| tramos:', tramos)
if not tramos:
    shutil.rmtree(tmp, ignore_errors=True)
    sys.exit('No hay tramos con Illustrator al frente')
filtros = ''.join(f'[0:v]trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{velocidad}[v{i}];' for i, (a, b) in enumerate(tramos))
union = ''.join(f'[v{i}]' for i in range(len(tramos))) + f'concat=n={len(tramos)}:v=1:a=0[out]'
r = subprocess.run([FF, '-y', '-i', str(entrada), '-filter_complex', filtros + union, '-map', '[out]', '-c:v', 'libx264', '-preset', 'fast',
                    '-crf', '26', '-pix_fmt', 'yuv420p', str(salida)], capture_output=True, text=True)
print('ffmpeg:', r.returncode, (r.stderr or '')[-200:] if r.returncode else 'ok')
shutil.rmtree(tmp, ignore_errors=True)
