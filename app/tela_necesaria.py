"""Tela necesaria por los pedidos programados.

Apenas un pedido entra a Producción se mira su REFERENCIA (A700CA00 -> maestro CA00), se toma el consumo PROMEDIO GENERAL de ese maestro
(Promedios maestros: media de todos los consumos por talla distintos de cero) y se multiplica por la CANTIDAD de la orden. Lo de todas las órdenes
se acumula por tela y se compara con lo que hay en Bodega. Solo lectura: no toca el inventario ni el Sheet.

Cuentan las filas con Sublimación vacía (aún sin tela asignada) o en proceso (P). Una fila vacía solo cuenta si su entrega no está vencida por más de 7 días
(así no pesan las filas viejas que nunca se llenaron). Las que ya pasaron por Sublimación ya descontaron su tela del inventario.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone

import os
import threading
import time
from pathlib import Path

from app import listado_tallas, promedios, sublimacion_stock
from app.sublimacion_stock import DB_FILE, norm, parse_date

DIAS_GRACIA = 7
BRECHA_POR_DEFECTO = 14   # días entre Sublimación y entrega si aún no hay historial suficiente
INTERVALO_TALLAS = 600
_STATE = Path(os.getenv('STATE_DIR', '/data/state'))
_tallas_lock = threading.Lock()
_tallas: dict[str, dict] = {}   # orden -> {'ruta', 'mtime', 'hojas': {hoja: [líneas]}, 'ts'}


def _cargar_tallas() -> None:
    try:
        with _tallas_lock:
            _tallas.update(json.loads((_STATE / 'tela_tallas.json').read_text(encoding='utf-8')))
    except (OSError, ValueError):
        pass


def _guardar_tallas() -> None:
    try:
        tmp = _STATE / 'tela_tallas.tmp'
        tmp.write_text(json.dumps(_tallas, ensure_ascii=False), encoding='utf-8')
        tmp.replace(_STATE / 'tela_tallas.json')
    except OSError:
        pass


def refrescar_tallas() -> int:
    """Lee (solo si cambió) el listado Excel de cada orden programada para tener sus tallas. Va en segundo plano: la NAS por VPN es lenta."""
    cambios = 0
    pedidos = _pedidos() or []
    por_orden = {}
    for p in pedidos:
        por_orden.setdefault(p['orden'], p['cliente'])
    for orden, cliente in por_orden.items():
        try:
            previo = _tallas.get(orden)
            carpeta = Path(previo['ruta']).parent if previo and Path(previo['ruta']).exists() else listado_tallas.carpeta_de_orden(cliente, orden)
            ruta = listado_tallas.excel_de_orden(carpeta, orden) if carpeta else None
            if not ruta:
                continue
            mtime = ruta.stat().st_mtime
            if previo and previo.get('ruta') == str(ruta) and previo.get('mtime') == mtime:
                continue
            hojas = listado_tallas.leer_hojas(ruta)
            with _tallas_lock:
                _tallas[orden] = {'ruta': str(ruta), 'mtime': mtime, 'hojas': hojas, 'ts': time.time()}
            cambios += 1
        except Exception:   # noqa: BLE001 - una orden con Excel raro no debe frenar a las demás
            continue
    if cambios:
        _guardar_tallas()
    return cambios


def _bucle_tallas() -> None:
    time.sleep(45)
    while True:
        try:
            refrescar_tallas()
        except Exception:   # noqa: BLE001
            pass
        time.sleep(INTERVALO_TALLAS)


def start() -> None:
    _cargar_tallas()
    threading.Thread(target=_bucle_tallas, name='tela-tallas', daemon=True).start()


def _exacto(orden: str, referencia: str, datos: dict) -> dict | None:
    """Consumo talla por talla (promedio del maestro de cada talla × prendas de esa talla) si el listado de la orden tiene la hoja de esa referencia."""
    entrada = _tallas.get(orden)
    if not entrada:
        return None
    clave = listado_tallas._codigo(referencia)
    titulo = next((t for t in entrada['hojas'] if listado_tallas._codigo(t) == clave), None)
    if not titulo:
        return None
    r = promedios.calcular_hoja(titulo, entrada['hojas'][titulo], datos)
    if not r.get('completo') or r['mts'] <= 0:
        return None
    return {'mts': r['mts'], 'prendas': r['prendas'], 'detalle': r['detalle'], 'partes': r['partes']}


_brecha_cache: dict = {'at': 0.0, 'dias': BRECHA_POR_DEFECTO}


def brecha_sublimacion() -> int:
    """Días que suelen pasar entre que una orden entra a Sublimación y su fecha de entrega: la mediana de las órdenes ya sublimadas (se recalcula cada hora).
    Con eso se estima cuándo le toca a una orden pendiente: fecha de entrega menos esa brecha."""
    if time.time() - _brecha_cache['at'] < 3600:
        return _brecha_cache['dias']
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
        try:
            raw = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
            headers = [norm(h) for h in json.loads(raw[0])]
            si, ei = headers.index('SUBLIMACION'), headers.index('FECHA DE ENTREGA')
            brechas = []
            for (valores_json,) in db.execute('SELECT values_json FROM production_rows'):
                v = json.loads(valores_json)
                if len(v) <= max(si, ei):
                    continue
                sub, ent = parse_date(v[si]), parse_date(v[ei])
                if sub and ent:
                    dias = (date.fromisoformat(ent) - date.fromisoformat(sub)).days
                    if 0 <= dias <= 45:   # fuera de ese rango son fechas mal digitadas o casos raros
                        brechas.append(dias)
        finally:
            db.close()
        if len(brechas) >= 10:
            brechas.sort()
            _brecha_cache.update(at=time.time(), dias=round(brechas[len(brechas) // 2]))
            return _brecha_cache['dias']
    except Exception:   # noqa: BLE001
        pass
    _brecha_cache['at'] = time.time() - 3000   # reintenta en ~10 min
    return _brecha_cache['dias']


def _hoy() -> date:
    """Hoy en Colombia (el servidor está en UTC y de noche ya marcaría el día siguiente)."""
    return datetime.now(timezone(timedelta(hours=-5))).date()


def _cantidad(valor) -> int:
    digitos = re.sub(r'[^0-9]', '', str(valor or ''))
    return int(digitos) if digitos else 0


def _mts_nota(valor) -> float:
    """Último valor «N.NN MTS» de la tarjeta de Producción, o 0.

    Es una lectura de respaldo: permite que Tela programada muestre una
    referencia que ya tiene sus metros validados en Producción, aunque aún no
    tenga el maestro configurado para recalcularla aquí.
    """
    encontrados = re.findall(r'(\d+(?:[.,]\d+)?)\s*MTS', str(valor or ''), re.I)
    try:
        return float(encontrados[-1].replace(',', '.')) if encontrados else 0.0
    except (TypeError, ValueError):
        return 0.0


def _consumo(referencia: str, maestros: dict, plantillas: dict) -> tuple[float, list[str], list[str]]:
    """Consumo promedio general por prenda de una referencia (suma las partes si es compuesta) y lo que no se encontró."""
    total, usados, faltan = 0.0, [], []
    for parte in promedios.partes_de_hoja(referencia):
        if not parte:
            continue
        maestro = maestros.get(parte) or plantillas.get(parte)
        if not maestro:
            faltan.append(parte)
            continue
        promedio = promedios.promedio(maestro)
        if not promedio:
            faltan.append(maestro['ref'])
            continue
        total += promedio
        usados.append(maestro['ref'])
    return round(total, 2), usados, faltan


def _codigo_tela(referencia: str) -> str:
    """«A700CA00» -> '700' (código de tela que va delante de la referencia); «A4403-4400-…» -> '4403'."""
    m = re.match(r'\s*A(\d+)', str(referencia or '').upper())
    return m.group(1) if m else ''


def codigos_de_materiales(referencia: str) -> list[str]:
    """Códigos de tela escritos delante de la referencia.

    Por ejemplo, ``A11300-1800FUT04`` se interpreta como FUT04 con los
    materiales 11300 y 1800. No intenta adivinar telas por el nombre: este
    dato sale únicamente del código de la referencia.
    """
    texto = re.sub(r'\s+', '', str(referencia or '')).upper()
    m = re.match(r'^A(\d+(?:-\d+)*)(?=[A-Z]{1,8}\d)', texto)
    return m.group(1).split('-') if m else []


def _referencia_base(referencia: str, maestros: dict) -> str:
    """Encuentra la referencia base sin confundirla con los códigos de tela.

    ``partes_de_hoja`` cubre los nombres usuales, pero una referencia como
    ``A100-11400CB11-1`` tiene un segundo código que hace que la expresión
    histórica devuelva ``A100``.  Para estas órdenes buscamos también el
    identificador que queda después de *todos* los códigos iniciales. Así la
    ficha ``CB11`` sigue siendo el respaldo real cuando no hay maestro.
    """
    texto = re.sub(r'\s+', '', str(referencia or '')).upper()
    sin_codigos = re.sub(r'^A\d+(?:-\d+)*(?=[A-Z]{1,8}\d{2,4})', '', texto)
    extraidas = re.findall(r'[A-Z]{1,8}\d{2,4}', sin_codigos)
    partes = extraidas + promedios.partes_de_hoja(texto)
    candidatas = []
    for parte in partes:
        parte = str(parte or '').upper().strip()
        # A100 es un código de tela, no la referencia A100-11400CB11-1.
        if not parte or re.fullmatch(r'A\d+', parte) or parte in candidatas:
            continue
        candidatas.append(parte)
    for parte in candidatas:
        if parte in maestros:
            return parte
        # CB11-1 puede estar definido como CB11 en el maestro, pero solo se
        # usa esa alternativa cuando no existe la versión completa.
        sin_sufijo = re.sub(r'-\d+$', '', parte)
        if sin_sufijo in maestros:
            return sin_sufijo
    return candidatas[0] if candidatas else ''


def _promedio_ficha(valores) -> float:
    if isinstance(valores, dict):
        numeros = []
        for grupo in valores.values():
            if isinstance(grupo, list):
                numeros.extend(float(v or 0) for v in grupo if float(v or 0) > 0)
            else:
                try:
                    numero = float(grupo or 0)
                except (TypeError, ValueError):
                    numero = 0
                if numero > 0:
                    numeros.append(numero)
        return round(sum(numeros) / len(numeros), 2) if numeros else 0.0
    return 0.0


def _materiales_de_ficha(ref: str, fichas: dict) -> list[dict]:
    """Convierte el resumen de ficha técnica en materiales usables.

    Las fichas se usan solo de respaldo: Promedios maestros siempre gana.
    ``PROMEDIO M1`` se asocia con la tela cuyo material es ``M1``.
    """
    ficha = fichas.get(ref) if isinstance(fichas, dict) else None
    if not isinstance(ficha, dict):
        return []
    promedios_ficha = {}
    for promedio_ficha in ficha.get('promedios') or []:
        if not isinstance(promedio_ficha, dict):
            continue
        etiqueta = str(promedio_ficha.get('nombre') or '').upper()
        match = re.search(r'\bM(\d+)\b', etiqueta)
        if match:
            promedios_ficha[f'M{match.group(1)}'] = promedio_ficha.get('valores') or promedio_ficha
    materiales = []
    vistos = set()
    for indice, tela in enumerate(ficha.get('telas') or [], start=1):
        if not isinstance(tela, dict):
            continue
        material = str(tela.get('material') or f'M{indice}').upper().strip()
        # Algunas fichas antiguas repiten M1 para variantes de la misma tela.
        # La ficha no separa sus consumos, por eso se usa una sola vez: evita
        # asignar el segundo código a otra variante y dejar M2 sin código.
        if material in vistos:
            continue
        valores = promedios_ficha.get(material)
        if valores:
            materiales.append({'material': material, 'tela': str(tela.get('tela') or '').strip(),
                               'promedio': _promedio_ficha(valores), 'origen': 'FICHA TÉCNICA'})
            vistos.add(material)
    return [m for m in materiales if m['promedio'] > 0]


def materiales_de_referencia(referencia: str, maestros: dict, fichas: dict | None = None) -> list[dict]:
    """Obtiene los materiales de una referencia sin cambiar datos reales.

    Solo usa Promedios Maestros. Una ficha técnica puede describir una prenda,
    pero no es una fuente autorizada de consumo para programar tela; si la
    referencia no está configurada en Promedios Maestros, la tarjeta queda sin
    metros hasta que se complete su maestro.

    ``fichas`` se mantiene por compatibilidad con llamadas antiguas, pero no
    participa en el cálculo.
    """
    fichas = fichas or {}
    ref = _referencia_base(referencia, maestros)
    maestro = maestros.get(ref) if ref else None
    materiales = []
    if isinstance(maestro, dict):
        for indice, bruto in enumerate(maestro.get('materiales') or [], start=1):
            if not isinstance(bruto, dict):
                continue
            material = str(bruto.get('material') or f'M{indice}').upper().strip()
            promedio_material = promedios.promedio(bruto)
            if promedio_material > 0:
                materiales.append({
                    'material': material,
                    'tela': str(bruto.get('tela') or '').strip(),
                    'promedio': promedio_material,
                    'consumos': {grupo: list(bruto.get(grupo) or []) for grupo in promedios.GRUPOS},
                    'origen': 'PROMEDIOS MAESTROS',
                })
    if materiales:
        return materiales
    # Los maestros antiguos tienen los consumos directamente en la referencia
    # (masc/fem/nino/nina), sin el bloque ``materiales``. Siguen siendo la
    # fuente prioritaria: una ficha técnica solo es respaldo cuando el maestro
    # realmente no existe o no tiene ningún consumo documentado.
    if isinstance(maestro, dict):
        promedio_maestro = promedios.promedio(maestro)
        if promedio_maestro > 0:
            return [{
                'material': 'M1',
                'tela': str(maestro.get('tela') or '').strip(),
                'promedio': promedio_maestro,
                'consumos': {grupo: list(maestro.get(grupo) or []) for grupo in promedios.GRUPOS},
                'origen': 'PROMEDIOS MAESTROS',
            }]
    return []


def reparto_materiales(referencia: str, maestros: dict, fichas: dict | None, mts_total: float) -> list[dict]:
    """Distribuye un total ya calculado por el consumo de cada material.

    Sirve de transición segura para órdenes antiguas que aún solo tienen un
    total de MTS. Las órdenes nuevas podrán calcularse talla por talla con
    ``calcular_materiales_por_talla``.
    """
    materiales = materiales_de_referencia(referencia, maestros, fichas)
    suma = sum(float(m['promedio']) for m in materiales)
    try:
        total = float(mts_total or 0)
    except (TypeError, ValueError):
        total = 0.0
    if not materiales or suma <= 0 or total <= 0:
        return []
    codigos = codigos_de_materiales(referencia)
    resultado = []
    acumulado = 0.0
    for indice, material in enumerate(materiales):
        # El último absorbe el redondeo para que las líneas siempre sumen el
        # total de la tarjeta, sin crear ni perder metraje.
        mts = round(total - acumulado, 2) if indice == len(materiales) - 1 else round(total * material['promedio'] / suma, 2)
        acumulado += mts
        resultado.append({**material, 'codigo': codigos[indice] if indice < len(codigos) else '', 'mts': mts})
    return resultado


def calcular_materiales_por_talla(referencia: str, lineas: list[dict], maestros: dict, fichas: dict | None = None) -> list[dict]:
    """Calcula MTS por material usando talla, género y cantidad del listado.

    Solo calcula con consumos documentados en Promedios Maestros.
    """
    materiales = materiales_de_referencia(referencia, maestros, fichas)
    if not materiales:
        return []
    codigos = codigos_de_materiales(referencia)
    resultado = [{**m, 'codigo': codigos[i] if i < len(codigos) else '', 'mts': 0.0} for i, m in enumerate(materiales)]
    sin_detalle = False
    for linea in lineas or []:
        grupo = promedios._grupo_de_genero(linea.get('genero', ''))
        talla = promedios._talla(linea.get('talla', ''))
        if grupo in ('masc', 'fem') and talla not in promedios.GRUPOS[grupo] and talla in promedios.GRUPOS['nino']:
            grupo = 'nino' if grupo == 'masc' else 'nina'
        try:
            cantidad = int(linea.get('cantidad') or 1)
        except (TypeError, ValueError):
            cantidad = 1
        for material in resultado:
            consumos = material.get('consumos') or {}
            tallas = promedios.GRUPOS[grupo]
            valor = consumos.get(grupo, [])[tallas.index(talla)] if talla in tallas and len(consumos.get(grupo, [])) > tallas.index(talla) else 0
            if valor:
                material['mts'] += float(valor) * max(0, cantidad)
            else:
                sin_detalle = True
    # Si el listado trae una talla/género sin consumo registrado no se debe
    # sumar solo la parte que sí coincidió: daría un total engañosamente bajo
    # (ej. 56 prendas y 2,68 mts). En ese caso se usa el promedio completo del
    # mismo Promedio Maestro para todas las prendas de esa tarjeta.
    if sin_detalle:
        prendas = sum(max(0, int(linea.get('cantidad') or 1)) for linea in (lineas or []))
        return reparto_materiales(referencia, maestros, fichas, prendas * sum(float(m['promedio']) for m in materiales))
    for material in resultado:
        material['mts'] = round(material['mts'], 2)
    return resultado


def _lineas_listado(orden: str, referencia: str) -> list[dict]:
    """Devuelve las líneas ya leídas del Excel para una referencia de la orden.

    Nunca abre la NAS desde la tarjeta: el hilo de ``refrescar_tallas`` es el
    único que la consulta. Así la vista de Producción sigue respondiendo rápido.
    """
    with _tallas_lock:
        entrada = _tallas.get(str(orden or ''))
        hojas = dict((entrada or {}).get('hojas') or {})
    clave = listado_tallas._codigo(referencia)
    titulo = next((t for t in hojas if listado_tallas._codigo(t) == clave), None)
    return list(hojas.get(titulo) or []) if titulo else []


def detalles_mts_produccion(rows: list[dict], headers: list[str], ficha_resolver=None) -> dict[str, dict]:
    """Desglose de MTS reales para las tarjetas de Producción.

    El cálculo es de solo lectura y usa exclusivamente consumos por talla de
    Promedios Maestros. Si no hay listado aún, usa el promedio documentado en
    ese maestro. Una ficha técnica nunca completa ni estima metros requeridos.
    """
    indice = {str(h or '').strip().upper(): i for i, h in enumerate(headers or [])}
    ref_i = indice.get('REFERENCIA')
    orden_i = indice.get('ORDEN')
    cant_i = indice.get('CANTIDAD', indice.get('CANT.'))
    if ref_i is None or orden_i is None:
        return {}
    try:
        with promedios._lock:
            datos = promedios._leer()
    except Exception:  # noqa: BLE001 - no debe impedir mostrar Producción
        return {}
    maestros = {str(x.get('ref') or '').upper(): x for x in datos.get('maestros') or [] if isinstance(x, dict)}
    plantillas = {str(x.get('ref') or '').upper(): x for x in datos.get('plantillas') or [] if isinstance(x, dict)}
    respuesta: dict[str, dict] = {}
    for row in rows or []:
        valores = list(row.get('values') or [])
        referencia = str(valores[ref_i] if ref_i < len(valores) else '').strip().upper()
        orden = str(valores[orden_i] if orden_i < len(valores) else '').strip()
        cantidad = _cantidad(valores[cant_i] if cant_i is not None and cant_i < len(valores) else '')
        codigos = codigos_de_materiales(referencia)
        if not referencia or not cantidad or not codigos:
            continue
        # Los metros de programación salen únicamente del maestro. Una ficha
        # técnica no se consulta como respaldo: evita promedios no aprobados.
        materiales = materiales_de_referencia(referencia, maestros, {})
        calculados: list[dict] = []
        if materiales:
            lineas = _lineas_listado(orden, referencia)
            # Una orden puede tener la misma referencia en más de una fila.
            # El listado pertenece a la orden completa; solo es exacto para
            # esta tarjeta si su cantidad coincide. Si no, reutilizarlo haría
            # que, por ejemplo, una fila de 6 prendas heredara los 27 mts de
            # otra fila de la misma referencia.
            cantidad_listado = sum(_cantidad(linea.get('cantidad') or 1) for linea in lineas)
            if lineas and cantidad_listado == cantidad:
                calculados = calcular_materiales_por_talla(referencia, lineas, maestros, {})
            else:
                # Aún no se ha indexado el listado: el promedio documentado en
                # Promedios Maestros sirve como estimación temporal.
                calculados = reparto_materiales(
                    referencia, maestros, {},
                    cantidad * sum(float(m.get('promedio') or 0) for m in materiales),
                )
        elif len(codigos) == 1:
            # Referencias de un solo material conservan la regla histórica.
            promedio, _, _ = _consumo(referencia, maestros, plantillas)
            if promedio > 0:
                calculados = [{'codigo': codigos[0], 'mts': round(promedio * cantidad, 2), 'origen': 'PROMEDIOS MAESTROS'}]
        # No todos los materiales tienen código dentro de la referencia. Por
        # ejemplo, CB11 declara 100 y 11400 para M1/M2, pero M4 (Fusionado)
        # también es consumo real. Se conserva su identificador de material
        # para que no desaparezca de Producción ni de Tela programada.
        lineas_reales = [
            {
                'codigo': str(m.get('codigo') or '').strip(),
                'material': str(m.get('material') or '').strip().upper(),
                'tela': str(m.get('tela') or '').strip(),
                'mts': round(float(m.get('mts') or 0), 2),
                'origen': str(m.get('origen') or ''),
            }
            for m in calculados
            if (str(m.get('codigo') or '').strip() or str(m.get('material') or '').strip())
            and float(m.get('mts') or 0) > 0
        ]
        if lineas_reales:
            respuesta[str(row.get('source_row'))] = {
                'materiales': lineas_reales,
                'total': round(sum(m['mts'] for m in lineas_reales), 2),
            }
    return respuesta


def _telas_de_bodega(items: list[dict], tela: str, codigos: set[str]) -> list[dict]:
    """Telas de Bodega que corresponden a la de Producción: primero por el CÓDIGO de la referencia («A7202SHT01» -> (7202)) y, si no hay, por nombre."""
    codigos = {c for c in codigos if c}
    por_codigo = []
    for i in items:
        if i.get('categoria') != 'BODEGA TELA':
            continue
        nombre = ' ' + sublimacion_stock.norm(i.get('nombre')) + ' '
        m = re.match(r'\s*\((\d+)\)', nombre)
        if m and m.group(1) in codigos and not any(x in nombre for x in sublimacion_stock.EXCLUDED_NAMES) and ' RIB ' not in nombre:
            por_codigo.append(i)
    blancas = [i for i in por_codigo if ' BLANCO ' in ' ' + sublimacion_stock.norm(i.get('nombre')) + ' ']
    return blancas or por_codigo or sublimacion_stock._matched(items, tela)


USUARIO_NOTA = 'AGENTE INVENTARIO'


def autollenar_mts(ordenes: list[dict]) -> dict:
    """Anota «NN.NN MTS» en MTS REQUERIDOS (nota de la columna 17) de las tarjetas que todavía no la tienen, con los MTS calculados con el promedio.
    Solo toca el panel: nunca escribe en el Google Sheets. No pisa lo que puso una persona ni lo que ya trae el Sheet; sí actualiza sus propias notas
    cuando el cálculo mejora (por ejemplo al leer el listado de tallas)."""
    # SOLO los cálculos EXACTOS: talla por talla con Promedios maestros (tallas del listado × consumo de cada talla). El promedio general (aproximado) ya no se anota.
    candidatas = [o for o in ordenes if o.get('fila') and float(o.get('mts') or 0) > 0 and o.get('situacion') != 'sin_promedio' and o.get('exacto')]
    if not candidatas:
        return {'escritas': 0}
    try:
        db = sqlite3.connect(str(DB_FILE), timeout=10)
    except sqlite3.Error:
        return {'escritas': 0}
    escritas = 0
    try:
        hay_sheet = bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='production_sheet_notes'").fetchone())
        ahora = datetime.now(timezone.utc).isoformat()
        for o in candidatas:
            fila, texto = int(o['fila']), f"{float(o['mts']):.2f} MTS"
            if hay_sheet:
                sh = db.execute('SELECT note FROM production_sheet_notes WHERE source_row=? AND column_number=17', (fila,)).fetchone()
                if sh and re.search(r'\d+(?:[.,]\d+)?\s*MTS', str(sh[0]), re.I):
                    continue   # el equipo ya los registró en el Sheet
            previa = db.execute('SELECT note, username FROM production_notes WHERE source_row=? AND column_number=17', (fila,)).fetchone()
            if previa and str(previa[0]).strip() and previa[1] != USUARIO_NOTA:
                continue   # una persona (o TERRY) ya puso los MTS
            if previa and str(previa[0]).strip() == texto:
                continue
            if previa and str(previa[0]).strip() and not o.get('exacto'):
                continue   # ya hay un valor del agente: solo se cambia por uno exacto (por talla), nunca por el aproximado
            db.execute('INSERT OR REPLACE INTO production_notes(source_row, column_number, note, username, updated_at) VALUES (?,?,?,?,?)', (fila, 17, texto, USUARIO_NOTA, ahora))
            escritas += 1
        if escritas:
            db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (ahora,))
        db.commit()
    except sqlite3.Error:
        pass
    finally:
        db.close()
    return {'escritas': escritas}


def _pedidos() -> list[dict] | None:
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
    except sqlite3.Error:
        return None
    try:
        raw = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        if not raw:
            return None
        headers = [norm(h) for h in json.loads(raw[0])]
        need = ('SUBLIMACION', 'TELA', 'ORDEN', 'REFERENCIA', 'CANTIDAD')
        if any(h not in headers for h in need):
            return None
        si, ti, oi, ri, ci = (headers.index(h) for h in need)
        ei = headers.index('FECHA DE ENTREGA') if 'FECHA DE ENTREGA' in headers else None
        ki = headers.index('NOMBRE DEL CLIENTE') if 'NOMBRE DEL CLIENTE' in headers else None
        pi = headers.index('NOMBRE PROYECTO') if 'NOMBRE PROYECTO' in headers else None
        texto = lambda v, i: str(v[i]).strip() if i is not None and i < len(v) else ''
        limite = (_hoy() - timedelta(days=DIAS_GRACIA)).isoformat()
        # Misma prioridad que las tarjetas: nota web, después nota del Sheet.
        web = {r: n for r, n in db.execute('SELECT source_row,note FROM production_notes WHERE column_number=17')}
        try:
            sheet = {r: n for r, n in db.execute('SELECT source_row,note FROM production_sheet_notes WHERE column_number=17')}
        except sqlite3.Error:
            sheet = {}
        pedidos = []
        for fila, valores_json in db.execute('SELECT source_row, values_json FROM production_rows'):
            v = json.loads(valores_json)
            if len(v) <= max(si, ti, oi, ri, ci):
                continue
            estado = norm(v[si])
            if estado == 'P':
                activo = True
            elif estado in ('', 'R'):
                entrega = parse_date(v[ei]) if ei is not None and ei < len(v) else ''
                activo = bool(entrega) and entrega >= limite
            else:
                activo = False   # fecha (ya consumida) o N/A
            tela = norm(v[ti])
            cantidad = _cantidad(v[ci])
            if not activo or not tela or not cantidad:
                continue
            pedidos.append({'fila': fila, 'orden': str(v[oi]).strip(), 'referencia': str(v[ri]).strip(), 'tela': tela, 'cantidad': cantidad,
                            'cliente': texto(v, ki), 'proyecto': texto(v, pi),
                            'estado': 'P' if estado == 'P' else '',
                            'entrega': parse_date(v[ei]) if ei is not None and ei < len(v) else '',
                            'mts_tarjeta': _mts_nota(web.get(fila) or sheet.get(fila) or '')})
        return pedidos
    except (sqlite3.Error, ValueError, KeyError):
        return None
    finally:
        db.close()


def _detalles_de_tarjetas() -> dict[str, dict]:
    """MTS por material que ya calcula Producción para sus tarjetas.

    Esta función es estrictamente de lectura. Se usa como respaldo para que
    Tela programada no deje una referencia en «Sin promedio» cuando Producción
    ya la puede calcular desde Promedios Maestros.
    """
    try:
        db = sqlite3.connect(f'file:{DB_FILE}?mode=ro', uri=True, timeout=5)
        try:
            raw = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
            if not raw:
                return {}
            headers = json.loads(raw[0])
            filas = [
                {'source_row': fila, 'values': json.loads(valores)}
                for fila, valores in db.execute('SELECT source_row,values_json FROM production_rows')
            ]
        finally:
            db.close()
        return detalles_mts_produccion(filas, headers)
    except (sqlite3.Error, ValueError, TypeError):
        return {}


def calcular(items: list[dict]) -> dict:
    """Necesidad de tela por pedidos programados, agrupada por tela y comparada con el stock de Bodega."""
    pedidos = _pedidos()
    if pedidos is None:
        return {'disponible': False, 'telas': [], 'ordenes': [], 'sin_promedio': [], 'mts': 0.0, 'pedidos': 0, 'faltan': 0.0, 'telas_no_alcanzan': 0}
    with promedios._lock:
        datos = promedios._leer()
    maestros = {m['ref']: m for m in datos['maestros']}
    plantillas = {}
    for m in datos['maestros']:
        for campo in ('p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short'):
            codigo = str(m.get(campo) or '').strip().upper()
            if codigo:
                plantillas.setdefault(codigo, m)
    por_tela: dict[str, dict] = {}
    sin_promedio = []
    brecha = brecha_sublimacion()
    detalles_tarjetas = _detalles_de_tarjetas()
    for p in sorted(pedidos, key=lambda x: (x['entrega'] or '9999', x['orden'])):
        consumo, usados, faltan = _consumo(p['referencia'], maestros, plantillas)
        exacto = _exacto(p['orden'], p['referencia'], datos)
        base = {'fila': p['fila'], 'orden': p['orden'], 'cliente': p['cliente'], 'proyecto': p['proyecto'], 'referencia': p['referencia'], 'tela': p['tela'],
                'cantidad': p['cantidad'], 'estado': p['estado'], 'entrega': p['entrega']}
        if p['estado'] != 'P' and p['entrega']:
            est = date.fromisoformat(p['entrega']) - timedelta(days=brecha)
            base.update(sublim_est=est.isoformat(), dias_sublim=(est - _hoy()).days)
        base['en_sublim'] = p['estado'] == 'P'
        detalle_tarjeta = detalles_tarjetas.get(str(p['fila'])) or {}
        mts_tarjeta = float(detalle_tarjeta.get('total') or p.get('mts_tarjeta') or 0)
        # Desglose que verá Tela programada: una referencia puede consumir
        # varias telas (p. ej. código 100 y 11400). Conserva el mismo reparto
        # de MTS que ya calcula la tarjeta de Producción.
        materiales_tarjeta = []
        for material in detalle_tarjeta.get('materiales') or []:
            codigo = str(material.get('codigo') or '').strip()
            etiqueta_material = str(material.get('material') or '').strip().upper()
            mts_material = round(float(material.get('mts') or 0), 2)
            if not (codigo or etiqueta_material) or mts_material <= 0:
                continue
            tela_material = str(material.get('tela') or p['tela']).strip()
            encontradas_material = _telas_de_bodega(items, tela_material, {codigo} if codigo else set())
            materiales_tarjeta.append({
                'codigo': codigo, 'material': etiqueta_material, 'mts': mts_material,
                'tela': str((encontradas_material[0] if encontradas_material else {}).get('nombre') or tela_material).strip(),
            })
        # Producción ya tiene un consumo validado (por TERRY o una persona):
        # úsalo únicamente cuando Tela programada aún no puede resolver el
        # maestro. Así ambos paneles muestran la misma referencia y metros,
        # sin escribir ni alterar inventario, notas o el Sheet.
        respaldo_tarjeta = not consumo and not exacto and mts_tarjeta > 0
        if respaldo_tarjeta:
            consumo, usados, faltan = round(mts_tarjeta / max(1, p['cantidad']), 2), ['TARJETA DE PRODUCCIÓN'], []
        if not consumo and not exacto:
            sin_promedio.append({**base, 'situacion': 'sin_promedio', 'promedio': 0, 'mts': 0, 'falta': 0, 'maestros': [], 'telas': [],
                                 'motivo': ('Sin promedio para ' + ', '.join(faltan)) if faltan else 'La referencia no dice qué maestro es'})
            continue
        if exacto:
            mts, consumo, usados = exacto['mts'], round(exacto['mts'] / max(1, exacto['prendas']), 2), exacto['partes']
        elif respaldo_tarjeta:
            mts = round(mts_tarjeta, 2)
        else:
            mts = round(consumo * p['cantidad'], 2)
        entrada = por_tela.setdefault(p['tela'], {'tela': p['tela'], 'mts': 0.0, 'prendas': 0, 'pedidos': [], 'codigos': set()})
        entrada['codigos'].add(_codigo_tela(p['referencia']))
        entrada['mts'] += mts
        entrada['prendas'] += p['cantidad']
        entrada['pedidos'].append({**base, 'promedio': consumo, 'mts': mts, 'maestros': usados, 'parcial': bool(faltan) and not exacto,
                                   'exacto': bool(exacto), 'prendas_talla': (exacto or {}).get('prendas', 0),
                                   'origen_tarjeta': respaldo_tarjeta,
                                   'materiales': materiales_tarjeta,
                                   'tallas': [{'grupo': d['grupo'], 'talla': d['talla'], 'cantidad': d['cantidad'], 'promedio': d['promedio'], 'mts': d['subtotal']}
                                              for d in (exacto or {}).get('detalle', [])]})
    resultado, por_orden = [], []
    for tela, entrada in por_tela.items():
        encontradas = _telas_de_bodega(items, tela, entrada['codigos'])
        disponible = round(sum(sum(float(x) for x in (i.get('roll_values') or [])) for i in encontradas), 2)
        mts = round(entrada['mts'], 2)
        restante = disponible
        for ped in entrada['pedidos']:   # las órdenes se sirven por fecha de entrega: cada una descuenta su tela de lo que queda en Bodega
            if not encontradas:
                ped.update(situacion='sin_tela', falta=ped['mts'], disponible=0.0)
            elif restante >= ped['mts']:
                ped.update(situacion='alcanza', falta=0.0, disponible=round(restante, 2))
                restante -= ped['mts']
            else:
                ped.update(situacion='no_alcanza', falta=round(ped['mts'] - max(restante, 0.0), 2), disponible=round(max(restante, 0.0), 2))
                restante = max(0.0, restante - ped['mts'])
            ped['telas'] = [i['nombre'] for i in encontradas]
            ped['bodega'] = disponible   # todo lo que hay en Bodega de esa tela (antes de servir las órdenes)
            ped['quedan'] = round(max(restante, 0.0), 2)   # lo que sobra en Bodega después de esta orden
            por_orden.append(ped)
        entrada.pop('codigos', None)
        resultado.append({**entrada, 'mts': mts, 'disponible': disponible, 'encontrada': bool(encontradas),
                          'telas': [i['nombre'] for i in encontradas], 'faltan': round(max(0.0, mts - disponible), 2) if encontradas else mts,
                          'alcanza': bool(encontradas) and disponible >= mts})

    # Una tarjeta puede llevar más de una tela. El saldo debe calcularse por
    # material, no contra la primera tela escrita en la fila de Producción:
    # de otro modo Montecatini, Triatlón y Fusionado mostrarían el mismo
    # inventario y un descuento engañoso. Se atienden en el mismo orden de
    # entrega que las tarjetas principales, sin modificar inventario alguno.
    por_material: dict[str, list[tuple[dict, dict]]] = {}
    for pedido in por_orden:
        materiales_pedido = pedido.get('materiales') or []
        for material in pedido.get('materiales') or []:
            codigo = str(material.get('codigo') or '').strip()
            tela = str(material.get('tela') or pedido.get('tela') or '').strip()
            # «Fusionado» (M4) no existe como rollo separado: es la misma
            # tela base que pasa por Sublimación una segunda vez. Conservamos
            # su línea y su descuento, pero compartimos el saldo de M1 para
            # no reportarlo erróneamente como una tela sin existencia.
            if str(material.get('material') or '').strip().upper() == 'M4' or norm(tela) == 'FUSIONADO':
                base = next((x for x in materiales_pedido if str(x.get('material') or '').strip().upper() == 'M1'), None)
                if base:
                    codigo = str(base.get('codigo') or '').strip()
                    tela = str(base.get('tela') or pedido.get('tela') or '').strip()
                    material['stock_compartido'] = 'M1'
            clave = 'COD:' + codigo if codigo else 'TELA:' + norm(tela)
            por_material.setdefault(clave, []).append((pedido, material))
    for pares in por_material.values():
        muestra_pedido, muestra_material = pares[0]
        codigo = str(muestra_material.get('codigo') or '').strip()
        tela = str(muestra_material.get('tela') or muestra_pedido.get('tela') or '').strip()
        encontradas = _telas_de_bodega(items, tela, {codigo} if codigo else set())
        disponible = round(sum(sum(float(x) for x in (item.get('roll_values') or [])) for item in encontradas), 2)
        restante = disponible
        for pedido, material in pares:
            mts_material = round(float(material.get('mts') or 0), 2)
            material['bodega'] = disponible if encontradas else None
            material['disponible'] = round(restante, 2)
            if not encontradas:
                material.update(situacion='sin_tela', falta=mts_material, queda=0.0)
            elif restante >= mts_material:
                restante = round(restante - mts_material, 2)
                material.update(situacion='alcanza', falta=0.0, queda=restante)
            else:
                falta = round(mts_material - max(restante, 0.0), 2)
                restante = 0.0
                material.update(situacion='no_alcanza', falta=falta, queda=0.0)
    for sp in sin_promedio:   # aunque no tenga promedio, se muestra cuánta tela hay en Bodega
        enc = sublimacion_stock._matched(items, sp['tela'])
        sp['bodega'] = round(sum(sum(float(x) for x in (i.get('roll_values') or [])) for i in enc), 2) if enc else None
    resultado.sort(key=lambda r: (r['alcanza'], -r['mts']))
    por_orden.sort(key=lambda o: (o['entrega'] or '9999', o['orden']))
    return {'disponible': True, 'brecha_sublimacion': brecha, 'telas': resultado, 'ordenes': por_orden + sin_promedio, 'sin_promedio': sin_promedio,
            'mts': round(sum(r['mts'] for r in resultado), 2), 'pedidos': sum(len(r['pedidos']) for r in resultado),
            'faltan': round(sum(r['faltan'] for r in resultado), 2), 'telas_no_alcanzan': sum(1 for r in resultado if not r['alcanza'])}
