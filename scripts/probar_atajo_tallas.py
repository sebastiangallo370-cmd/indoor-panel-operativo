"""Prueba el atajo de tallas con datos REALES (OV1217) sin abrir Illustrator: con la talla ya exportada no debe abrir el maestro; sin ella, sí."""
import importlib.util, sys, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ag)
real, _, ruta = ag.cargar_ov(con_effi=False)   # instala el atajo sobre el desempacar_tallas real
pdf = ruta / 'PDF_OV' / 'OV_1217.pdf'
items = real.leer_items(str(pdf))
it = items[0]
it['maestro'] = str(real.buscar_maestro(it))
print('orden OV1217:', it['ref'], f"D{it['diseno']}", 'talla', it['talla'], '| maestro:', Path(it['maestro']).name)

t = time.time()
destino = real.desempacar_tallas(Path(it['maestro']), it)   # con el atajo: no debe abrir Illustrator (tardaría ~8 min)
print('talla EXISTENTE -> volvió en %.1f s sin abrir el maestro:' % (time.time() - t), destino)

# talla que NO existe: debe seguir al código original (aquí un doble que solo anota la llamada)
llamadas = []
sin_atajo = importlib_original = None
import maestros_ov as m   # el mismo módulo ya cargado
cierre = m.desempacar_tallas.__closure__
original = [c.cell_contents for c in cierre if callable(c.cell_contents)][0] if cierre else None
m.desempacar_tallas = None
m._atajo_tallas = False
m.desempacar_tallas = lambda maestro, item: llamadas.append(('ORIGINAL', item['talla'])) or Path('(simulado)')
ag.instalar_atajo_tallas(m)
falta = dict(it, talla='99')
m.desempacar_tallas(Path(it['maestro']), falta)
m.desempacar_tallas(Path(it['maestro']), it)
print('talla FALTANTE (99) llama al original:', ('ORIGINAL', '99') in llamadas, '| talla existente NO lo llama:', ('ORIGINAL', it['talla']) not in llamadas)
