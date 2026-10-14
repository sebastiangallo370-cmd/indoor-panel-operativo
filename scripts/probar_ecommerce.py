"""Prueba de extremo a extremo de ECOMMERCE (servidor local + puente en modo simulado). No toca Effi ni Illustrator."""
import json, os, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
tmp = Path(tempfile.mkdtemp())
os.environ['ECOMMERCE_FILE'] = str(tmp / 'ecommerce.json')
os.environ['ECOMMERCE_TOKEN_FILE'] = str(tmp / 'tok.txt')
sys.path.insert(0, str(RAIZ))
import uvicorn
from fastapi import FastAPI, Request
from app import ecommerce_canal as ec

usuario = {'actual': 'Indoor Sport'}
app = FastAPI()
ec.configurar(lambda request: usuario['actual'], lambda u: u == 'Indoor Sport')
app.include_router(ec.router); app.include_router(ec.pc_router)
srv = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8777, log_level='error'))
threading.Thread(target=srv.run, daemon=True).start()
time.sleep(1.5)
URL = 'http://127.0.0.1:8777'

def llamar(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(URL + ruta, data=json.dumps(cuerpo).encode() if cuerpo is not None else None, method=metodo, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

print('1 sin PC enlazado, estado:', llamar('GET', '/api/ecommerce/estado')[1]['pc'])
c, d = llamar('POST', '/api/ecommerce/agentes/alma/iniciar'); print('2 iniciar sin PC conectado ->', c, d.get('detail', '')[:60])
c, tok = llamar('POST', '/api/ecommerce/conexion/regenerar'); print('3 token generado:', c, len(tok['token']))
usuario['actual'] = 'Maria'
print('4 otra cuenta ->', llamar('GET', '/api/ecommerce/estado')[0], llamar('POST', '/api/ecommerce/agentes/alma/iniciar')[0], llamar('POST', '/api/ecommerce/conexion/regenerar')[0])
usuario['actual'] = 'Indoor Sport'
req = urllib.request.Request(URL + '/api/ecommerce/pc/sondeo', data=b'{}', headers={'Content-Type': 'application/json', 'X-Ecommerce-Token': 'falso'}, method='POST')
try: urllib.request.urlopen(req, timeout=5)
except urllib.error.HTTPError as e: print('5 token falso ->', e.code)
# puente simulado
(RAIZ / 'ecommerce_pc' / 'datos').mkdir(exist_ok=True)
backup = (RAIZ / 'ecommerce_pc' / 'datos' / 'panel.json')
backup.write_text(json.dumps({'url': URL, 'token': tok['token']}), encoding='utf-8')
puente = subprocess.Popen([sys.executable, str(RAIZ / 'ecommerce_pc' / 'puente_ecommerce.py'), '--simulado'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
try:
    time.sleep(5)
    e = llamar('GET', '/api/ecommerce/estado')[1]; print('6 PC conectado:', e['pc']['conectado'], '| simulado:', e['pc']['simulado'])
    print('7 iniciar ALMA ->', llamar('POST', '/api/ecommerce/agentes/alma/iniciar'))
    time.sleep(8)
    e = llamar('GET', '/api/ecommerce/estado')[1]; print('8 estados:', {a['id']: a['estado'] for a in e['agentes']}, '| órdenes:', [(o['agente'], o['accion'], o['estado']) for o in e['ordenes']])
    c, d = llamar('POST', '/api/ecommerce/agentes/brisa/iniciar'); print('9 BRISA mientras corre ALMA ->', c, d.get('detail', '')[:80])
    print('10 DARIO (independiente) ->', llamar('POST', '/api/ecommerce/agentes/dario/iniciar')[0])
    time.sleep(8)
    log = llamar('GET', '/api/ecommerce/log?limite=30')[1]['lineas']; print('11 líneas de log:', len(log)); [print('   ', l['agente'], l['nivel'], l['texto'][:70]) for l in log[-4:]]
    print('12 detener ALMA ->', llamar('POST', '/api/ecommerce/agentes/alma/detener')[0]); time.sleep(8)
    e = llamar('GET', '/api/ecommerce/estado')[1]; print('13 estados:', {a['id']: a['estado'] for a in e['agentes']})
    c, d = llamar('POST', '/api/ecommerce/agentes/brisa/iniciar'); print('14 BRISA tras detener ALMA ->', c)
    print('15 detener a todos:', [llamar('POST', f'/api/ecommerce/agentes/{i}/detener')[0] for i in ('brisa', 'dario')]); time.sleep(8)
    e = llamar('GET', '/api/ecommerce/estado')[1]; print('16 final:', {a['id']: a['estado'] for a in e['agentes']})
finally:
    puente.terminate()
    try: puente.wait(8)
    except Exception: puente.kill()
    backup.unlink(missing_ok=True)
    srv.should_exit = True
