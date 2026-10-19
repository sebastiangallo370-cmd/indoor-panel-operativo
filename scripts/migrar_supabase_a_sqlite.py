"""Copia UNA VEZ los catálogos de Supabase (clientes, referencias, telas, vendedores y sus copias reprog_*) a SQLite.

Solo LEE de Supabase; no modifica ni borra nada allá. Es repetible: vuelve a escribir las mismas filas sin duplicar.
Uso, dentro del contenedor:  python /app/scripts/migrar_supabase_a_sqlite.py   (lee supabase_url/supabase_key de /app/config.json)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import catalogo_local  # noqa: E402

CONFIG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/app/config.json')
PAGINA = 1000


def main():
    from supabase import create_client   # solo para esta migración
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    origen = create_client(cfg['supabase_url'], cfg['supabase_key'])
    catalogo_local.crear_tablas()
    db = catalogo_local.conectar()
    try:
        for tabla, (columnas, _unica) in catalogo_local.TABLAS.items():
            filas, desde = [], 0
            while True:
                lote = origen.table(tabla).select('*').range(desde, desde + PAGINA - 1).execute().data
                filas += lote
                if len(lote) < PAGINA:
                    break
                desde += PAGINA
            todas = ['id', *columnas, 'fecha_registro']
            marcas = ', '.join('?' * len(todas))
            for f in filas:
                db.execute(f'INSERT OR REPLACE INTO {tabla} ({", ".join(todas)}) VALUES ({marcas})', [f.get(c) for c in todas])
            db.commit()
            local = db.execute(f'SELECT COUNT(*) FROM {tabla}').fetchone()[0]
            print(f'{tabla}: Supabase {len(filas)} → SQLite {local}', 'OK' if local >= len(filas) else 'REVISAR')
    finally:
        db.close()


if __name__ == '__main__':
    main()
