"""Revisa una orden de venta REAL (por defecto OV1216) con el código real de BOT_ORDENES_VENTA, SIN efectos:
lee el PDF, busca los maestros y recorre la cola de los 3 agentes, pero Illustrator, el listado y Google Sheets son simulados."""
import importlib.util, os, sys, tempfile
from pathlib import Path

numero = sys.argv[1] if len(sys.argv) > 1 else '1216'
RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
tmp = Path(tempfile.mkdtemp())
ag.COLA = tmp / 'cola'
ag.time.sleep = lambda s: None
real, _, ruta = ag.cargar_ov(con_effi=False)
pdf = ruta / 'PDF_OV' / f'OV_{numero}.pdf'
print('PDF:', pdf.name, '| existe:', pdf.exists(), '| tamaño:', pdf.stat().st_size if pdf.exists() else 0)


class Mixto:
    """Lee con el código REAL; todo lo que escribiría (Illustrator, Excel, Sheets) solo se anota."""
    def __init__(self): self.escrituras = []
    def leer_items(self, p): return real.leer_items(p)
    def buscar_maestro(self, it): return real.buscar_maestro(it)
    def leer_encabezado(self, p): return real.leer_encabezado(p)
    def desempacar_tallas(self, m, it): self.escrituras.append(f'TALLAS {m.name} -> Montajes D{it["diseno"]}/{it["prenda"]}{it["linea"]}'); return Path('(simulado)')
    def aplicar_bot_jsx(self, m, it, orden): self.escrituras.append(f'PDF {len(it["jugadores"])} jugador(es) talla {it["talla"]} con {m.name} (OV{orden})'); return True
    def generar_listado(self, p, items): self.escrituras.append(f'LISTADO ({len([i for i in items if i.get("maestro")])} líneas)'); return Path('(simulado)')
    def registrar_en_sheets(self, p, items): self.escrituras.append('SHEETS 1 fila'); return True


ag.registrar_procesada = lambda *a, **k: None   # no se toca el historial real
mo = Mixto()
enc = real.leer_encabezado(str(pdf))
print('Encabezado:', {k: enc[k] for k in ('orden', 'cliente', 'unidades', 'creacion', 'entrega')})
ag.guardar_trabajo('1_descargadas', {'numero': numero, 'pdf': str(pdf), 'intentos': 0})
ag.ciclo_tallas(mo, ag.trabajos('1_descargadas')[0])
job = ag.leer_trabajo(ag.trabajos('2_tallas')[0])
for it in job['items']:
    print('  item:', it['ref'], f"D{it['diseno']}", 'talla', it['talla'], it['linea'], '|', it['nombre'], '#' + str(it['numero']), '| maestro:', Path(it['maestro']).name if it['maestro'] else '(NO ENCONTRADO)')
ag.ciclo_pdfs(mo, tmp, ag.trabajos('2_tallas')[0])
print('Lo que habrían escrito los agentes (simulado):'); [print('  ·', e) for e in mo.escrituras]
print('Cola al final:', ag.conteos())
# lo que dejó la ejecución real anterior del bot original
base = Path(r'\\192.168.0.120\nas indoor\CLIENTES\INDOOR SPORT SAS') / f'OV{numero}_INTERCLASES 2027'
print('Resultado real previo en la NAS:')
for p in sorted(base.rglob('*')):
    if p.is_file(): print('  ·', p.relative_to(base))
