"""Prueba del backend de ECOMMERCE con lo nuevo: latidos (cuenta regresiva), órdenes de la cola, cifras de hoy, historial y alertas."""
import os, sys, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
tmp = Path(tempfile.mkdtemp())
os.environ['ECOMMERCE_FILE'] = str(tmp / 'e.json')
os.environ['ECOMMERCE_TOKEN_FILE'] = str(tmp / 't.txt')
sys.path.insert(0, str(RAIZ))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import ecommerce_canal as ec

usuario = {'u': 'Indoor Sport'}
ec.configurar(lambda r: usuario['u'], lambda u: u == 'Indoor Sport')
app = FastAPI(); app.include_router(ec.router); app.include_router(ec.pc_router)
c = TestClient(app)
token = c.post('/api/ecommerce/conexion/regenerar').json()['token']
H = {'X-Ecommerce-Token': token}
hoy = datetime.now(timezone(timedelta(hours=-5))).replace(microsecond=0)
iso = lambda seg: (hoy - timedelta(seconds=seg)).replace(tzinfo=None).isoformat()
cuerpo = {'equipo': 'PC', 'agentes': {'alma': {'estado': 'CORRIENDO', 'ultima': 'x'}, 'brisa': {'estado': 'ERROR', 'ultima': 'Illustrator no responde'}, 'ciro': {'estado': 'CORRIENDO', 'ultima': ''}},
          'cola': {'descargadas': 1, 'tallas': 0, 'terminadas': 1, 'errores': 1},
          'latidos': {'alma': {'actividad': 'Vigilando Effi', 'hace_seg': 2, 'ultima_hace': 18, 'proxima_en': 42, 'intervalo': 60}, 'brisa': {'actividad': 'x', 'hace_seg': 1}},
          'trabajos': [
              {'numero': '1216', 'etapa': 'terminadas', 'cliente': 'edwin', 'descargada': iso(900), 'terminada': iso(600), 'avisos': [], 'items': [], 'eventos': []},
              {'numero': '1214', 'etapa': 'errores', 'cliente': 'tienda', 'descargada': iso(4000), 'terminada': iso(3600), 'avisos': ['No se registró en Google Sheets'], 'items': [], 'eventos': []},
              {'numero': '1217', 'etapa': 'descargadas', 'cliente': '', 'descargada': iso(30), 'avisos': [], 'items': [], 'eventos': []}],
          'lineas': []}
r = c.post('/api/ecommerce/pc/sondeo', json=cuerpo, headers=H); print('sondeo:', r.status_code)
c.post('/api/ecommerce/pc/sondeo', json=cuerpo, headers=H)   # un segundo sondeo igual NO debe duplicar el historial
e = c.get('/api/ecommerce/estado').json()
print('hoy:', e['hoy'], '| historial:', len(e['historial']), '(esperado 2)')
print('latido alma:', {k: e['latidos']['alma'][k] for k in ('actividad', 'proxima_en', 'intervalo')}, '| trabajos:', [(t['numero'], t['etapa']) for t in e['trabajos']])
log = c.get('/api/ecommerce/log').json()['lineas']
print('registro:', [l['texto'][:48] for l in log if 'OV' in l['texto']])
al = ec.alertas()
print('alertas ecommerce:', [(a['severidad'], a['titulo']) for a in al])
print("«revisar» a ALMA ->", c.post('/api/ecommerce/agentes/alma/revisar').status_code, "| a BRISA ->", c.post('/api/ecommerce/agentes/brisa/revisar').status_code, '(esperado 200 y 409)')
usuario['u'] = 'Maria'
print('otra cuenta:', c.get('/api/ecommerce/estado').status_code, c.post('/api/ecommerce/agentes/alma/revisar').status_code)
