import importlib.util, json, sys
sys.path.insert(0, '/app')
spec = importlib.util.spec_from_file_location('tela_necesaria', '/tmp/tn/tela_necesaria.py')
tn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tn)
from app import inventario_api
payload = inventario_api._inventory_payload()
r = tn.calcular(payload.get('items') or [])
print('pedidos', r['pedidos'], 'mts', r['mts'], 'faltan', r['faltan'], 'telas_no_alcanzan', r['telas_no_alcanzan'])
for t in r['telas']:
    print(t['tela'], '| necesita', t['mts'], '| disponible', t['disponible'], '| alcanza', t['alcanza'], '| encontrada', t['encontrada'], t['telas'][:2])
    for p in t['pedidos']:
        print('    ', p['orden'], p['referencia'], p['cantidad'], 'x', p['promedio'], '=', p['mts'], p['estado'], p['entrega'], p['maestros'])
print('SIN PROMEDIO:', json.dumps(r['sin_promedio'], ensure_ascii=False))
