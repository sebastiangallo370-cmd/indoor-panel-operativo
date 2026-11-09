"""Localiza la carpeta y el .ai de una orden (ej. CO7890, RM7640, OV739).

Estructura esperada en la NAS:   CLIENTES / <cliente> / <CODIGO>_<nombre de la orden> / ...archivos .ai
También funciona si las carpetas de orden están directamente dentro de la carpeta configurada.
Como hay cientos de clientes, se arma un índice (datos/indice_ordenes.json) que se renueva solo
cuando una orden no aparece o cuando tiene más de 12 horas.
"""
import json
import os
import re
import time
import unicodedata
from pathlib import Path

import config
from core import illustrator
from core.log import log

_CODIGO = re.compile(r"\b([A-Za-z]{1,3})-?(\d{3,7})\b")
_INICIO_ORDEN = re.compile(r"^([A-Za-z]{1,3})-?(\d{3,7})(?![0-9])")
INDICE = config.DATOS / "indice_ordenes.json"
VIGENCIA_SEG = 12 * 3600
MIN_ENTRE_RECARGAS = 120


# Admite tanto «D1 FUT02M XS A 4XL.ai» como «D1_FUT02M_XS-4XL.ai»,
# «D1 CP03 M XS A 4XL.ai» y el formato unisex «D1 CA42 XS A 5XL.ai».
# Hay maestros antiguos donde el género es un
# campo separado; no reconocerlos hacía que TAVO descartara una referencia
# válida antes de contrastarla con el listado.
# «_» es un carácter de palabra para \b, por eso un límite de palabra solo no
# reconocía los maestros que separan el género y las tallas con guion bajo.
# «D1 PE03N(F).ai» / «D1 PE03N(M).ai» son los maestros infantiles:
# la letra N puede venir seguida del sexo entre paréntesis. Sin ese caso el
# selector trataba PE03N como si fuera la referencia y omitía talla 2–16.
MESA_AI = re.compile(r"^D(?:ISE\S{1,2}O)?\s*(\d+)[\s_-]+([A-Za-z]+\d+)(?:[\s_-]*([MFN])(?=$|[.(\s_-]))?", re.I)  # D1 FUT02M / D1 PE03N(F) / D1 CP03 M / D1 CA42
# Formato histórico alterno. Se declara aquí (y no solo en seleccion.py) para
# que buscar_ai no lo descarte antes de que el selector pueda evaluarlo.
MESA_ALT = re.compile(r"^Talla_([^_]+)_Tipo_D(\d+)_Gen_([MFN])", re.I)
# Formato histórico: «BZ02M TALLA XS A XL.ai». El diseño se infiere de la
# carpeta contenedora («BZ02_D1»).
MESA_LEGACY = re.compile(r"^([A-Za-z]+\d+)([MFN])(?:[\s_-]+)TALLA(?:[\s_-]+)", re.I)


def simulado():
    return illustrator.modo_simulado() or not [r for r in config.ORDENES_DIRS if str(r).strip()]


def codigo_en(texto):
    """Devuelve el código de orden que aparece en el texto (CO7890, co-7890...) o None."""
    m = _CODIGO.search(texto or "")
    return (m.group(1) + m.group(2)).upper() if m else None


def _hijos_dir(ruta):
    try:
        with os.scandir(ruta) as it:
            return [e for e in it if e.is_dir(follow_symlinks=False)]
    except OSError:
        return []


def _armar_indice(roots):
    """{codigo: [carpetas de orden]} recorriendo solo 2 niveles: raíz/cliente/orden."""
    inicio, indice = time.time(), {}
    for root in roots:
        for hijo in _hijos_dir(root):
            m = _INICIO_ORDEN.match(hijo.name)
            if m:  # la orden está directamente en la raíz
                indice.setdefault((m.group(1) + m.group(2)).upper(), []).append(hijo.path)
                continue
            for orden in _hijos_dir(hijo.path):  # raíz/cliente/orden
                m = _INICIO_ORDEN.match(orden.name)
                if m:
                    indice.setdefault((m.group(1) + m.group(2)).upper(), []).append(orden.path)
    log("TAVO", f"Índice de órdenes armado: {len(indice)} órdenes en {time.time() - inicio:.0f} s")
    datos = {"creado": time.time(), "roots": [str(r) for r in roots], "ordenes": indice}
    try:
        INDICE.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return datos


def _cargar_indice(roots):
    try:
        datos = json.loads(INDICE.read_text(encoding="utf-8"))
        if datos.get("roots") == [str(r) for r in roots] and time.time() - datos["creado"] < VIGENCIA_SEG:
            return datos
    except (OSError, ValueError, KeyError):
        pass
    return _armar_indice(roots)


def carpetas_de_orden(codigo):
    roots = [Path(r) for r in config.ORDENES_DIRS if str(r).strip() and Path(r).exists()]
    if not roots:
        return []
    clave = codigo.upper()
    datos = _cargar_indice(roots)
    guardadas = datos["ordenes"].get(clave, [])
    vivas = [c for c in guardadas if os.path.isdir(c)]
    # Si la orden SÍ estaba en el índice pero su carpeta ya no existe (la renombraron o la movieron) se arma el índice YA, sin esperar los MIN_ENTRE_RECARGAS:
    # esperar hacía que LEO dijera «la orden no aparece en el listado» durante dos minutos tras renombrar una carpeta (RM7671, 2026-10-23).
    if not vivas and (guardadas or time.time() - datos["creado"] > MIN_ENTRE_RECARGAS):
        # orden nueva, o la carpeta fue renombrada/movida después de armar el índice
        datos = _armar_indice(roots)
        vivas = [c for c in datos["ordenes"].get(clave, []) if os.path.isdir(c)]
    return vivas


def _norm(t):
    # sin acentos: «ACTUALIZACION DISEÑOS» (orden) y «ACTUALIZACIÓN DISEÑOS» (MAESTROS) son la misma carpeta
    t = "".join(c for c in unicodedata.normalize("NFKD", str(t)) if not unicodedata.combining(c))
    return re.sub(r"[\W_]+", "", t).lower()


def _carpeta_maestros(padre):
    """La carpeta de maestros del cliente: se llama MAESTROS en casi todos, pero algunos clientes la tienen como MAESTRO (singular) o con otras mayúsculas."""
    for nombre in ("MAESTROS", "MAESTRO"):
        c = Path(padre) / nombre
        if c.is_dir():
            return c
    for h in _hijos_dir(Path(padre)):
        if _norm(h.name) in ("maestro", "maestros"):
            return Path(h.path)
    return None


def carpetas_maestros(codigo):
    """CLIENTES/<cliente>/MAESTROS/<proyecto>; si el cliente no tiene subcarpeta con el nombre del proyecto
    (las referencias van directo dentro de MAESTROS), se usa la carpeta MAESTROS completa."""
    res = []
    for carpeta in carpetas_de_orden(codigo):
        c = Path(carpeta)
        proyecto = _INICIO_ORDEN.sub("", c.name).strip(" _-.")
        refs = _PISTAS.get(str(codigo).upper())
        maestros = _carpeta_maestros(c.parent)
        if maestros is None:
            # En una reposición nueva puede existir la carpeta de la orden bajo
            # un cliente abreviado, todavía sin MAESTROS. Antes se hacía
            # ``continue`` aquí y jamás se buscaba el cliente histórico
            # (por ejemplo «CERROS» -> «CERROS FC»).
            cliente = c.parent
            clave_cliente = _norm(cliente.name)
            alternas = {}
            if refs and clave_cliente:
                try:
                    hermanos = _hijos_dir(cliente.parent)
                except OSError:
                    hermanos = []
                for hermano in hermanos:
                    otro = Path(hermano.path)
                    if otro == cliente or clave_cliente not in _norm(otro.name):
                        continue
                    maestros_otro = _carpeta_maestros(otro)
                    if maestros_otro is None:
                        continue
                    candidatas = [h.path for h in _hijos_dir(maestros_otro)
                                  if proyecto and _norm(h.name) == _norm(proyecto)] or [str(maestros_otro)]
                    halladas = [ruta for candidata in candidatas for ruta in _carpetas_de_referencia(candidata, refs)]
                    if halladas:
                        alternas[otro.name] = list(dict.fromkeys(halladas))
            if len(alternas) == 1:
                nombre, halladas = next(iter(alternas.items()))
                res += halladas
                log("TAVO", f"El cliente {cliente.name} no tiene MAESTROS: uso el maestro de {nombre} para {', '.join(sorted(refs))}", "WARN")
            continue
        exactas = [h.path for h in _hijos_dir(maestros) if proyecto and _norm(h.name) == _norm(proyecto)]
        elegidas = exactas or [str(maestros)]
        if not exactas and refs:
            # El listado no trae el nombre de un proyecto que exista en MAESTROS (ej. «MUESTRAS2027»): no se recorre toda la carpeta MAESTROS
            # (se cortaba en los primeros .ai por orden alfabético y TAVO nunca veía FUT02); se va directo a la carpeta de la referencia.
            # Si está en varios proyectos se usa el más reciente (la misma referencia suele copiarse a cada proyecto).
            por_proyecto = {}
            for h in _hijos_dir(maestros):
                if "viej" in h.name.lower():
                    continue
                halladas = _carpetas_de_referencia(h.path, refs)
                if halladas:
                    por_proyecto[h.name] = halladas
            if por_proyecto:
                def _reciente(nombre):
                    try:
                        return max(os.path.getmtime(x) for x in por_proyecto[nombre])
                    except OSError:
                        return 0
                anios = set(re.findall(r'\d{4}', proyecto))   # «MUESTRAS2027» prefiere «SEMILLERO 2027» sobre «SEMILLERO ITAGUI 2026»
                nombre = max(por_proyecto, key=lambda n: (bool(anios & set(re.findall(r'\d{4}', n))), _reciente(n)))
                log("TAVO", f"El proyecto de la orden no está en MAESTROS: uso el maestro de {', '.join(sorted(refs))} que está en MAESTROS/{nombre}"
                    + (f" (también está en {', '.join(sorted(k for k in por_proyecto if k != nombre))})" if len(por_proyecto) > 1 else ""), "WARN")
                elegidas = por_proyecto[nombre]
        if refs and exactas and not any(_carpetas_de_referencia(e, refs) for e in exactas):
            # La carpeta del proyecto no tiene la referencia que pide el listado (p. ej. MAESTROS/UNIFORMES2026 solo trae PE01 y el listado pide FUT02):
            # se busca esa referencia en las demás carpetas de MAESTROS del cliente. Solo se usa si está en UN proyecto; si está en varios no se adivina.
            por_proyecto = {}
            for h in _hijos_dir(maestros):
                if h.path in exactas or "viej" in h.name.lower():
                    continue
                halladas = _carpetas_de_referencia(h.path, refs)
                if halladas:
                    por_proyecto[h.name] = halladas
            if len(por_proyecto) == 1:
                nombre, halladas = next(iter(por_proyecto.items()))
                log("TAVO", f"MAESTROS/{Path(exactas[0]).name} no tiene {', '.join(sorted(refs))}: uso el maestro que está en MAESTROS/{nombre}", "WARN")
                elegidas = halladas
            elif por_proyecto:
                # El listado puede programarse bajo un proyecto que todavía no
                # tiene esa referencia (p. ej. UNIFORMES 2027), aunque el
                # maestro exacto sí esté en PRESENTACIÓN 2027. Ya que todas
                # las candidatas se filtraron por la referencia exacta, se
                # prioriza el mismo año y luego la carpeta más reciente. Así
                # PT12 nunca se sustituye por FUT04, pero tampoco se bloquea
                # una orden válida solo porque el maestro vive en otro grupo.
                anios = set(re.findall(r'\d{4}', proyecto))
                def _prioridad(nombre):
                    try:
                        reciente = max(os.path.getmtime(x) for x in por_proyecto[nombre])
                    except OSError:
                        reciente = 0
                    return (bool(anios & set(re.findall(r'\d{4}', nombre))), reciente)
                nombre = max(por_proyecto, key=_prioridad)
                elegidas = por_proyecto[nombre]
                log("TAVO", f"MAESTROS/{Path(exactas[0]).name} no tiene {', '.join(sorted(refs))}: uso el maestro exacto de MAESTROS/{nombre}", "WARN")
        if refs and not any(_carpetas_de_referencia(e, refs) for e in elegidas):
            # Una reposición puede traer el cliente abreviado ("CERROS") mientras
            # los maestros están en la carpeta histórica "CERROS FC". Nunca se
            # inventa otro cliente: solo se admite un hermano cuyo nombre contiene
            # por completo el nombre actual y que tenga EXACTAMENTE la referencia.
            cliente = c.parent
            raiz_clientes = cliente.parent
            clave_cliente = _norm(cliente.name)
            alternas = {}
            try:
                hermanos = _hijos_dir(raiz_clientes)
            except OSError:
                hermanos = []
            for hermano in hermanos:
                otro = Path(hermano.path)
                if otro == cliente or not clave_cliente or clave_cliente not in _norm(otro.name):
                    continue
                maestros_otro = _carpeta_maestros(otro)
                if maestros_otro is None:
                    continue
                candidatas = [h.path for h in _hijos_dir(maestros_otro)
                              if proyecto and _norm(h.name) == _norm(proyecto)] or [str(maestros_otro)]
                halladas = [ruta for candidata in candidatas for ruta in _carpetas_de_referencia(candidata, refs)]
                if halladas:
                    alternas[otro.name] = list(dict.fromkeys(halladas))
            if len(alternas) == 1:
                nombre, halladas = next(iter(alternas.items()))
                elegidas = halladas
                log("TAVO", f"El cliente {cliente.name} no tiene maestro para {', '.join(sorted(refs))}: uso MAESTROS de {nombre}", "WARN")
        res += elegidas
    return res


_PISTAS = {}   # orden -> referencias (FUT02, PE01…) que pide el listado; las deja TAVO cuando LEO lo lee


def pista_referencias(codigo, referencias):
    """Guarda las referencias que pide el listado de la orden, para ubicar su maestro aunque esté en otra carpeta de MAESTROS."""
    refs = set()
    for r in referencias or []:
        r = str(r).upper().strip()
        # El listado de producción usa el código comercial completo
        # (A200FUT01 / A11200FUT01), pero en MAESTROS la carpeta es FUT01.
        # Conservamos únicamente esa referencia final para no buscar un maestro
        # inexistente llamado con el código del artículo.
        referencia_articulo = re.fullmatch(r"[A-Z]\d+([A-Z]{2,5}\d{2,3})", r)
        if referencia_articulo:
            refs.add(referencia_articulo.group(1))
            continue
        if re.fullmatch(r"[A-Z]{1,5}\d{2,3}[MFN]?", r):
            refs.add(r[:-1] if r[-1] in "MFN" else r)
        else:
            # En Producción la referencia puede venir pegada al código de prenda,
            # por ejemplo A11200FUT01. En MAESTROS la carpeta real es FUT01_D1_D2_PLUS.
            # Se toman todos los tokens alfanuméricos de referencia y se descartan
            # los D<n>, que representan diseños, no referencias.
            tokens = re.findall(r"[A-Z]+\d+", r)
            refs.update(t for t in tokens if not re.fullmatch(r"D\d+", t, re.I))
    if codigo and refs:
        _PISTAS[str(codigo).upper()] = refs
    elif codigo:
        _PISTAS.pop(str(codigo).upper(), None)


def _refs_en_nombre(nombre):
    """Referencias que dice un nombre de carpeta o archivo: «FUT02_D1_D2_-» -> {FUT02}; «D1 FUT02F XS A 4XL.ai» -> {FUT02}."""
    return {t.upper() for t in re.findall(r"[A-Za-z]+\d+", str(nombre)) if not re.fullmatch(r"D\d+", t, re.I)}


def _carpetas_de_referencia(raiz, refs, max_prof=3):
    """Carpetas dentro de `raiz` (hasta 3 niveles, sin las «viejo» ni «Montajes») que son de alguna de esas referencias: por su nombre
    (FUT02_D1_D2) o porque tienen archivos .ai de esa referencia. Si la propia raíz lo es, devuelve la raíz."""
    refs = {r.upper() for r in refs}
    halladas = []
    base = len(Path(raiz).parts)
    for dirpath, dirnames, archivos in os.walk(raiz):
        dirnames[:] = sorted(d for d in dirnames if "viej" not in d.lower() and "montaje" not in d.lower())
        aqui = Path(dirpath)
        es = bool(_refs_en_nombre(aqui.name) & refs) and aqui != Path(raiz)
        es = es or any(a.lower().endswith(".ai") and not a.startswith("~") and (_refs_en_nombre(a) & refs) for a in archivos)
        if es:
            halladas.append(str(aqui))
            dirnames[:] = []   # ya es la carpeta de la referencia: no hace falta bajar más
        elif len(aqui.parts) - base >= max_prof:
            dirnames[:] = []
    return halladas


def buscar_ai(codigo, max_resultados=60, max_prof=6, solo_maestro=False):
    """Archivos .ai de la orden: primero CLIENTES/<cliente>/MAESTROS/<proyecto>, si no, la carpeta de la orden."""
    if not [r for r in config.ORDENES_DIRS if str(r).strip()]:
        if illustrator.modo_simulado():
            return [Path("SIMULADO") / f"{codigo}.ai"]
        return []
    opciones = [(carpetas_maestros(codigo), "MAESTROS")]
    if not solo_maestro:
        opciones.append((carpetas_de_orden(codigo), "orden"))
    for carpetas, etiqueta in opciones:
        # Un proyecto puede contener cientos de referencias. Antes se leían los
        # primeros 300 .ai en orden alfabético y, al recortar a 60, FUT02 podía
        # quedar fuera aunque su carpeta sí existiera. Cuando LEO ya indicó la
        # referencia, se entra primero a ESA carpeta del maestro.
        refs = _PISTAS.get(str(codigo).upper(), set()) if etiqueta == "MAESTROS" else set()
        por_referencia = []
        if refs:
            for carpeta in carpetas:
                por_referencia.extend(_carpetas_de_referencia(carpeta, refs, max_prof=max_prof))
            por_referencia = list(dict.fromkeys(por_referencia))
        origen = por_referencia or carpetas
        # Los .ai dentro de Montajes son mesas independientes ya exportadas.
        # No son maestros: si se devuelven aquí TAVO los procesa una segunda
        # vez como si fueran una plantilla y termina intentando crear PDFs
        # desde una ruta anidada (p. ej. SD02M/Montajes (SHUREZ)).
        encontrados = [a for a in _ai_en(origen, 300, max_prof)
                       if "muestra" not in a.name.lower()
                       and not any("montajes" in parte.lower() for parte in a.parts)]
        mesas = [a for a in encontrados if MESA_AI.match(a.name) or MESA_ALT.match(a.name) or MESA_LEGACY.match(a.name)]
        encontrados = (mesas or encontrados)[:max_resultados]
        if encontrados:
            log("TAVO", f"{len(encontrados)} archivos .ai de {codigo} en la carpeta {etiqueta}")
            return encontrados
    return []


def buscar_muestra(codigo):
    """El archivo .ai llamado MUESTRA dentro de CLIENTES/<cliente>/MAESTROS/<proyecto> (cualquier subcarpeta menos las «viejo»)."""
    if simulado():
        return buscar_ai(codigo)
    res = []
    for carpeta in carpetas_maestros(codigo):
        base = len(Path(carpeta).parts)
        for dirpath, dirnames, archivos in os.walk(carpeta):
            dirnames[:] = sorted(d for d in dirnames if "viej" not in d.lower())
            if len(Path(dirpath).parts) - base >= 4:
                dirnames[:] = []
            res += [Path(dirpath) / a for a in sorted(archivos)
                    if a.lower().endswith(".ai") and "muestra" in a.lower() and not a.startswith("~")]
    log("TAVO", f"Archivos MUESTRA en MAESTROS de {codigo}: {len(res)}")
    return res


def _ai_en(carpetas, max_resultados, max_prof):
    encontrados = []
    for carpeta in carpetas:
        base = len(Path(carpeta).parts)
        for dirpath, dirnames, archivos in os.walk(carpeta):
            # Los maestros actuales viven precisamente dentro de
            # «Montajes/<maquina>/D<n>/<referencia>». Solo excluimos los
            # respaldos viejos; nunca debemos saltarnos Montajes.
            dirnames[:] = sorted(d for d in dirnames if "viej" not in d.lower())
            if len(Path(dirpath).parts) - base >= max_prof:
                dirnames[:] = []
            for a in sorted(archivos):
                if a.lower().endswith(".ai") and not a.startswith("~"):
                    encontrados.append(Path(dirpath) / a)
                    if len(encontrados) >= max_resultados:
                        return encontrados
    return encontrados


# ---------- Carpeta de impresión: IMPRESIÓN (MÁQUINA) dentro de la carpeta de la orden ----------
_JPG = re.compile(r"^([A-Za-z]+\d+)_D(\d+)_([A-Za-z][A-Za-z0-9]*(?:[ _][A-Za-z0-9]+)*?)(?:[-_ ]?(FEM|NI[ÑN]O|NI[ÑN]A|NI[ÑN]OS|NI[ÑN]AS|NINOS))?\.jpe?g$", re.I)


def _jpgs(carpeta, prof=2):
    base = len(Path(carpeta).parts)
    for dirpath, dirnames, archivos in os.walk(carpeta):
        dirnames[:] = [d for d in dirnames if "viej" not in d.lower()]
        if len(Path(dirpath).parts) - base >= prof:
            dirnames[:] = []
        for a in archivos:
            m = _JPG.match(a)
            if m:
                yield m


def ref_y_disenos(nombre):
    """Referencia y diseños que dice el nombre de una carpeta: «FUT01_ D1_D2» (con o sin espacio) -> («FUT01», {"1", "2"})."""
    fichas = re.findall(r"[A-Za-z]+\d+", str(nombre))
    esdiseno = lambda t: re.fullmatch(r"D(\d+)", t, re.I)
    ref = next((t for t in fichas if not esdiseno(t)), None)
    return ref, {esdiseno(t).group(1) for t in fichas if esdiseno(t)}


def diseno_en_archivo(nombre):
    """Número de diseño que dice el nombre del archivo (D1 FUT01M XS A 4XL.ai, FUT01_D5_MUESTRA.ai); None si no lo dice."""
    m = re.search(r"(?:^|[_\s-])D(?:ISE\S{1,2}O)?(\d+)(?=[_\s.\-]|$)", str(nombre), re.I)
    return m.group(1) if m else None


def _carpeta_existente(padre, nombre):
    """Si en `padre` ya hay una carpeta con ese nombre (sin importar mayúsculas ni acentos: IMPRESION = IMPRESIÓN), se usa esa; así no se crea una carpeta duplicada."""
    import unicodedata

    def clave(t):
        return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").casefold().strip()

    try:
        hay = [d for d in Path(padre).iterdir() if d.is_dir() and clave(d.name) == clave(nombre)]
        if hay:
            return min(hay, key=lambda d: d.stat().st_ctime)   # si hubiera varias, la más antigua (la original)
        # carpeta de plantilla «IMPRESION (NOMBRE MAQUINA)» (vacía): se le pone el nombre de la máquina en vez de crear otra al lado
        m = re.match(r"^(.*)\((.+)\)\s*$", nombre)
        if m:
            marcador = f"{m.group(1).strip()} (NOMBRE MAQUINA)"
            for d in Path(padre).iterdir():
                if d.is_dir() and clave(d.name) == clave(marcador) and not any(d.iterdir()):
                    nuevo = d.with_name(f"{d.name.rsplit('(', 1)[0]}({m.group(2)})")
                    try:
                        d.rename(nuevo)
                        return nuevo
                    except OSError:
                        break
    except OSError:
        pass
    return Path(padre) / nombre


def destino_con_maquina(codigo, ruta_ai, maquina):
    """Igual que destino_impresion, pero con la máquina ya conocida (la de la tarjeta de Producción) cuando los JPG del maestro no la dicen."""
    orden = (carpetas_de_orden(codigo) or [None])[0]
    if not orden or not maquina:
        return None
    padre = Path(ruta_ai).parent
    ref, ds = ref_y_disenos(padre.name)
    propio = diseno_en_archivo(Path(ruta_ai).name)
    if propio:
        ds = {propio}
    return {"carpeta": str(_carpeta_existente(orden, f"IMPRESION ({maquina})")), "montajes": str(_carpeta_existente(padre, f"Montajes ({maquina})")),
            "maquina": maquina, "generos": [], "ref": (ref or "").upper(), "disenos": sorted(ds, key=int), "otras": []}


def destino_impresion(codigo, ruta_ai):
    """Devuelve {"carpeta": <orden>/IMPRESIÓN (MÁQUINA), "maquina", "generos": {"M","F","N"}} o None.

    La máquina sale del nombre de los JPG del maestro (BAL01_D1_SHUREZ.jpg → SHUREZ); «-FEM» = F, sin sufijo = M,
    «-NIÑO/-NIÑA» = N. Se usan los JPG de las referencias del .ai (carpeta FUT01_ D1_D2_ → FUT01 D1 y D2).
    """
    orden = (carpetas_de_orden(codigo) or [None])[0]
    if not orden:
        return None
    padre = Path(ruta_ai).parent
    ref, ds = ref_y_disenos(padre.name)
    propio = diseno_en_archivo(Path(ruta_ai).name)
    if propio:   # el archivo dice su diseño (D1 ..., FUT01_D5_MUESTRA): la máquina sale del JPG de ESE diseño (REFERENCIA_DISEÑO_MAQUINA)
        ds = {propio}
    # Primero la carpeta del propio .ai (ahí vive su JPG: CP01_D1_EPSON JESAM.jpg), luego las demás carpetas de maestros y por último la de la orden.
    # Antes solo se miraba la PRIMERA carpeta de maestros; si esa no era la del .ai (cliente con varias carpetas de la misma referencia) no se hallaba la máquina.
    raices = list(dict.fromkeys(str(r) for r in (padre, *carpetas_maestros(codigo), orden) if r))
    cuenta, generos = {}, set()
    for raiz in raices:
        for m in _jpgs(raiz):
            if ref and m.group(1).upper() != ref.upper():
                continue
            if ds and m.group(2) not in ds:
                continue
            maq = " ".join(m.group(3).upper().replace("_", " ").split())   # «EPSON_FLEXI PRINT» y «EPSON FLEXI PRINT» son la misma máquina
            cuenta[maq] = cuenta.get(maq, 0) + 1
            suf = (m.group(4) or "").upper()
            generos.add("F" if suf == "FEM" else "N" if suf.startswith("NI") else "M")
        if cuenta:
            break
    if not cuenta:
        return None
    maquina = max(cuenta, key=cuenta.get)
    return {"carpeta": str(_carpeta_existente(orden, f"IMPRESION ({maquina})")), "montajes": str(_carpeta_existente(padre, f"Montajes ({maquina})")), "maquina": maquina,
            "generos": sorted(generos), "ref": (ref or "").upper(), "disenos": sorted(ds, key=int), "otras": sorted(set(cuenta) - {maquina})}
