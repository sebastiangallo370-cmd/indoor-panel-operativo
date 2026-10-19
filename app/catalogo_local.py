"""Catálogos del panel (clientes, referencias, telas y vendedores) guardados en SQLite, sin conexión a Supabase.

Antes estos datos vivían en tablas de Supabase y el código los pedía con `create_client(...).table(...).select/upsert(...)`.
Este módulo trae un `create_client` con la misma forma mínima, así `monitor_archivos.py` y `pedidos_legacy.py` siguen igual:
solo cambia a dónde van los datos (/data/state/catalogo.sqlite3, que también entra en el respaldo diario de /data).

Tablas (las mismas del proyecto de Supabase): clientes, referencias, telas, vendedores y sus copias de REPROGRAMACIONES
(reprog_clientes, reprog_referencias, reprog_telas, reprog_vendedores).
"""
from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.getenv('CATALOGO_DB', '/data/state/catalogo.sqlite3'))

# columnas de cada catálogo; la primera de «unica» es la llave con la que se actualiza (on_conflict)
_BASE = {
    'clientes': (['nombre', 'telefono', 'email', 'direccion', 'nit_cc', 'carpeta_nas'], 'nombre'),
    'referencias': (['codigo', 'nombre'], 'codigo'),
    'telas': (['codigo', 'nombre'], 'codigo'),
    'vendedores': (['nombre', 'sigla', 'email'], 'nombre'),
}
TABLAS = {**_BASE, **{'reprog_' + k: v for k, v in _BASE.items()}}

_lock = threading.RLock()
_listo = False


def _ruta() -> Path:
    return Path(os.getenv('CATALOGO_DB', str(DB_PATH)))


def conectar() -> sqlite3.Connection:
    ruta = _ruta()
    ruta.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(ruta), timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    return db


def crear_tablas() -> None:
    global _listo
    with _lock:
        db = conectar()
        try:
            for nombre, (columnas, unica) in TABLAS.items():
                cols = ', '.join(f'{c} TEXT' + (' NOT NULL UNIQUE' if c == unica else '') for c in columnas)
                db.execute(f'CREATE TABLE IF NOT EXISTS {nombre} (id INTEGER PRIMARY KEY AUTOINCREMENT, {cols}, fecha_registro TEXT)')
            db.commit()
        finally:
            db.close()
        _listo = True


class _Respuesta:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Consulta:
    """Lo mínimo que el código viejo usa de Supabase: .select(cols).execute() y .upsert(payload, on_conflict=...).execute()."""

    def __init__(self, tabla: str):
        if tabla not in TABLAS:
            raise ValueError(f'Tabla de catálogo desconocida: {tabla}')
        self.tabla, self._op, self._cols, self._limite, self._payload, self._conflicto = tabla, 'select', '*', None, None, None

    def select(self, columnas='*', count=None):
        self._op, self._cols = 'select', columnas
        return self

    def limit(self, n):
        self._limite = int(n)
        return self

    def upsert(self, payload, on_conflict=None):
        self._op, self._payload, self._conflicto = 'upsert', payload, on_conflict
        return self

    def execute(self):
        if not _listo:
            crear_tablas()
        columnas, unica = TABLAS[self.tabla]
        with _lock:
            db = conectar()
            try:
                if self._op == 'select':
                    pedidas = ['id', *columnas, 'fecha_registro'] if self._cols.strip() == '*' else [c.strip() for c in self._cols.split(',')]
                    invalidas = [c for c in pedidas if c not in ('id', 'fecha_registro', *columnas)]
                    if invalidas:
                        raise ValueError(f'Columnas desconocidas en {self.tabla}: {invalidas}')
                    sql = f'SELECT {", ".join(pedidas)} FROM {self.tabla} ORDER BY id' + (f' LIMIT {self._limite}' if self._limite else '')
                    filas = [dict(r) for r in db.execute(sql)]
                    return _Respuesta(filas, len(filas))
                llave = self._conflicto or unica
                registros = self._payload if isinstance(self._payload, list) else [self._payload]
                ahora = datetime.now(timezone.utc).isoformat()
                for reg in registros:
                    datos = {k: v for k, v in reg.items() if k in columnas}
                    if llave not in datos or not datos[llave]:
                        raise ValueError(f'Falta {llave} para guardar en {self.tabla}')
                    nombres = [*datos, 'fecha_registro']
                    marcas = ', '.join('?' * len(nombres))
                    cambios = ', '.join(f'{k}=excluded.{k}' for k in datos if k != llave) or f'{llave}=excluded.{llave}'
                    db.execute(f'INSERT INTO {self.tabla} ({", ".join(nombres)}) VALUES ({marcas}) ON CONFLICT({llave}) DO UPDATE SET {cambios}',
                               [*datos.values(), ahora])
                db.commit()
                return _Respuesta(registros)
            finally:
                db.close()


class _Cliente:
    def table(self, nombre: str) -> _Consulta:
        return _Consulta(nombre)


def create_client(*_args, **_kwargs) -> _Cliente:
    """Sustituye al create_client de Supabase: ignora la dirección y la llave y usa la base local."""
    crear_tablas()
    return _Cliente()
