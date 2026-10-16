import json, sqlite3, re, collections
db = sqlite3.connect('file:/data/state/jobs.sqlite3?mode=ro', uri=True)
headers = json.loads(db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()[0])
print([ (i, h) for i, h in enumerate(headers)])
rows = db.execute('SELECT source_row, values_json FROM production_rows').fetchall()
print('filas', len(rows))
import sys; sys.path.insert(0, '/app'); from app.sublimacion_stock import norm
H = [norm(h) for h in headers]; print([h for h in H if h in ('SUBLIMACION','ENVIO','FACTURACION','EMPAQUE')])
si, ti, ci, ri = H.index('SUBLIMACION'), H.index('TELA'), H.index('CANTIDAD'), H.index('REFERENCIA')
env = H.index('ENVIO') if 'ENVIO' in H else None
from app.sublimacion_stock import parse_date
import datetime
hoy=datetime.date.today().isoformat()
ent=H.index('FECHA DE ENTREGA'); ini=H.index('FECHA DE INICIO')
res=collections.Counter(); ej=[]
for r,raw in rows:
    v=json.loads(raw)
    s_=norm(v[si]) if len(v)>si else ''
    if s_ not in ('','P'): continue
    d=parse_date(v[ent]) if len(v)>ent else ''; d0=parse_date(v[ini]) if len(v)>ini else ''
    res[('entrega>=hoy-7' if d and d>=(datetime.date.today()-datetime.timedelta(days=7)).isoformat() else 'entrega vieja/vacia')]+=1
    if d and d>=(datetime.date.today()-datetime.timedelta(days=7)).isoformat(): ej.append((r,v[4],v[ri],v[ti],v[ci],s_,d))
print(res); [print(x) for x in ej]
