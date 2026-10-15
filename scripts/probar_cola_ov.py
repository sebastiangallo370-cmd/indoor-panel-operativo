"""Prueba de la cola de ECOMMERCE con un maestros_ov FALSO: no toca Effi, Illustrator ni Google Sheets."""
import importlib.util, json, sys, tempfile, threading, time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
tmp = Path(tempfile.mkdtemp())
spec = importlib.util.spec_from_file_location('agente_ov', RAIZ / 'ecommerce_pc' / 'agente_ov.py')
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
ag.COLA = tmp / 'cola'          # cola aislada: no se toca la real
ag.ESPERA_COLA_SEG = 0.2


class FalsoOV:
    """Mismas firmas que maestros_ov.py; anota qué se llamó y en qué orden."""
    def __init__(self, falla_sheets=False, sin_maestro=False, falla_tallas=0):
        self.llamadas, self.falla_sheets, self.sin_maestro, self.falla_tallas = [], falla_sheets, sin_maestro, falla_tallas
    def leer_items(self, pdf):
        self.llamadas.append('leer_items')
        return [] if self.sin_maestro else [
            {'cantidad': 1, 'ref': 'A100CA01', 'prenda': 'CA01', 'diseno': '1', 'talla': '6', 'linea': 'N', 'nombre': 'ANA', 'numero': '7'},
            {'cantidad': 1, 'ref': 'A100CA01', 'prenda': 'CA01', 'diseno': '1', 'talla': '6', 'linea': 'N', 'nombre': 'LUIS', 'numero': '9'},
            {'cantidad': 1, 'ref': 'A100CA01', 'prenda': 'CA01', 'diseno': '2', 'talla': 'M', 'linea': 'M', 'nombre': 'PEDRO', 'numero': '3'}]
    def buscar_maestro(self, it): return Path('/maestros') / f"D{it['diseno']} {it['prenda']}{it['linea']}.ai"
    def desempacar_tallas(self, maestro, it):
        self.llamadas.append('tallas:' + maestro.name)
        if self.falla_tallas > 0:
            self.falla_tallas -= 1; raise RuntimeError('Illustrator no respondió')
        return Path('/montajes')
    def aplicar_bot_jsx(self, maestro, item, orden):
        self.llamadas.append(f"pdfs:{maestro.name}:{len(item['jugadores'])}j:orden{orden}"); return True
    def leer_encabezado(self, pdf): return {'orden': '100'}
    def generar_listado(self, pdf, items): self.llamadas.append('listado'); return Path('/x.xlsm')
    def registrar_en_sheets(self, pdf, items):
        self.llamadas.append('sheets'); return not self.falla_sheets


def correr(numero, **kw):
    mo = FalsoOV(**kw)
    ag.guardar_trabajo('1_descargadas', {'numero': numero, 'pdf': f'OV_{numero}.pdf', 'intentos': 0})
    for _ in range(4):   # BRISA (reintenta si falla) y luego CIRO
        p = ag.trabajos('1_descargadas')
        if p: ag.ciclo_tallas(mo, p[0])
    p = ag.trabajos('2_tallas')
    if p: ag.ciclo_pdfs(mo, tmp, p[0])
    return mo


ag.time.sleep = lambda s: None   # sin esperas en la prueba
print('1 flujo normal')
mo = correr('100')
print('   llamadas:', mo.llamadas)
print('   cola:', ag.conteos(), '| historial:', (tmp / 'ordenes_venta_procesadas.txt').read_text(encoding='utf-8').split('|')[0].strip())
print('2 Google Sheets falla ->')
mo = correr('101', falla_sheets=True); print('   cola:', ag.conteos(), '| avisos:', ag.leer_trabajo(ag.trabajos('errores')[0])['avisos'])
print('3 orden sin maestro ->')
mo = correr('102', sin_maestro=True); print('   llamadas:', mo.llamadas, '| cola:', ag.conteos())
print('4 Illustrator falla 1 vez en las tallas ->')
mo = correr('103', falla_tallas=1); print('   llamadas tallas:', [c for c in mo.llamadas if c.startswith('tallas')], '| cola:', ag.conteos())
print('5 Illustrator falla siempre ->')
mo = correr('104', falla_tallas=99); print('   cola:', ag.conteos(), '| intentos:', [ag.leer_trabajo(p).get('intentos') for p in ag.trabajos('errores')[-1:]])
print('6 candado de Illustrator: dos agentes se turnan')
orden = []
def uso(rol, seg):
    with ag.illustrator(rol):
        orden.append(rol + ' entra'); time.sleep(seg); orden.append(rol + ' sale')
ag.time.sleep = time.sleep
t1 = threading.Thread(target=uso, args=('tallas', 0.6)); t2 = threading.Thread(target=uso, args=('pdfs', 0.1))
t1.start(); time.sleep(0.15); t2.start(); t1.join(); t2.join()
print('  ', orden)
print('   candado liberado:', not (ag.COLA / 'illustrator.lock').exists())
print('7 numeros en cola (para que ALMA no repita):', sorted(ag.numeros_en_cola()))
