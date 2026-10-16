import json
d = json.load(open('/data/state/agentes_canal.json'))
for m in d['mensajes'][-14:]:
    print(m['id'], m.get('creado', '')[11:19], m.get('sesion'), m.get('rol'), 'oculto=' + str(m.get('oculto')), repr(m.get('texto', ''))[:90])
print('---')
for e in d['eventos'][-40:]:
    t = json.dumps(e, ensure_ascii=False)
    print(t[:200])
