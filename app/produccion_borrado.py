"""Al eliminar una tarjeta de Producción hay que quitarla de TODOS los lados de la página (solo de produccion.cloud: ni el Google Sheets ni otros sistemas).

main.py ya borra la fila (production_rows), sus notas y archiva la actividad (inicios, finales, reprocesos, eventos de operarios).
Esto cubre lo demás que queda ligado a la tarjeta por su fila: MTS requeridos calculados, pausas y el espacio de equipo/diseño.
Todo se archiva (recuperable) en production_activity_archive antes de borrarse.
"""
import json
from datetime import datetime, timezone

# Tablas de la página ligadas a una tarjeta por source_row. NO se tocan: production_sheet_links / production_sheet_audit / production_sheet_notes
# (la sincronización con el Sheet las usa para no volver a traer la orden eliminada) ni production_deleted_rows / production_nas_deletions (constancia).
TABLAS_LIGADAS = (
    'production_mts_required',
    'production_paused',
    'team_workspaces',
    'team_events',
    'team_links',
    'team_requests',
)


def purgar_resto_de_la_tarjeta(db, row: int, motivo: str) -> dict:
    """Archiva y borra de las tablas ligadas todo lo de la fila `row`. Devuelve cuántas filas quitó por tabla."""
    db.execute('CREATE TABLE IF NOT EXISTS production_activity_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, source_table TEXT, payload TEXT, reason TEXT, archived_at TEXT)')
    ahora = datetime.now(timezone.utc).isoformat()
    quitadas = {}
    for tabla in TABLAS_LIGADAS:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (tabla,)).fetchone():
            continue
        registros = [dict(r) for r in db.execute(f'SELECT * FROM {tabla} WHERE source_row=?', (row,))]
        if not registros:
            continue
        db.execute('INSERT INTO production_activity_archive(source_row,source_table,payload,reason,archived_at) VALUES (?,?,?,?,?)',
                   (row, tabla, json.dumps(registros, ensure_ascii=False, default=str), motivo, ahora))
        db.execute(f'DELETE FROM {tabla} WHERE source_row=?', (row,))
        quitadas[tabla] = len(registros)
    return quitadas
