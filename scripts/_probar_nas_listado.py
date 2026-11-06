import io, os, time
t = time.time()
base = '/mnt/nas/CLIENTES'
ds = os.listdir(base)
print('clientes', len(ds), round(time.time() - t, 2), 's')
t = time.time()
hall = []
for d in ds:
    p = os.path.join(base, d)
    try:
        for n in os.listdir(p):
            if n.upper().startswith(('RM7648_', 'CO6196_')):
                hall.append(os.path.join(p, n))
    except OSError:
        pass
print('busqueda por carpetas', hall, round(time.time() - t, 2), 's')
import openpyxl
for h in hall:
    for n in os.listdir(h):
        if n.lower().endswith(('.xlsm', '.xlsx')) and not n.startswith('~$'):
            t = time.time()
            wb = openpyxl.load_workbook(io.BytesIO(open(os.path.join(h, n), 'rb').read()), read_only=True, data_only=True)
            print(n, 'hojas', [ws.title for ws in wb.worksheets][:8], round(time.time() - t, 2), 's')
            for ws in wb.worksheets[:3]:
                filas = [["" if c is None else str(c).strip() for c in f] for f in ws.iter_rows(values_only=True)]
                filas = [f for f in filas if any(f)]
                print('  ', ws.title, len(filas), filas[:3])
