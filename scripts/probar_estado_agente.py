"""Prueba del estado que el puente reporta: un [Error] pasa a ERROR y, cuando el agente se recupera, vuelve a CORRIENDO."""
import importlib.util, queue
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pe', RAIZ / 'ecommerce_pc' / 'puente_ecommerce.py')
pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pe)


class Proc:
    def __init__(self, lineas): self.stdout = lineas


b = pe.Bot('alma', {'rol': 'descarga'}, Path('.'), True, queue.Queue())
casos = [
    ('ALMA vigilando', 'CORRIENDO'),
    ('[Error] Unable to obtain driver for chrome', 'ERROR'),
    ('Reintentando en 30 segundos…', 'ERROR'),
    ('Iniciando sesion en Effi...', 'CORRIENDO'),
    ('[Fila] Esperando a Illustrator', 'EN_FILA'),
    ('Illustrator libre: sigo.', 'CORRIENDO'),
    ('[Error] otra falla', 'ERROR'),
    ('[19:26:16] No hay órdenes de venta nuevas.', 'CORRIENDO'),
]
for linea, esperado in casos:
    b.estado = b.estado
    b._leer(Proc([linea + '\n']))
    print(('OK ' if b.estado == esperado else 'MAL'), f'{linea[:48]:48} -> {b.estado}')
