"""Qué archivos de mesas (D1 FUT01M XS A 4XL.ai) hay que exportar según lo que dice el listado.

Un archivo del maestro se llama «D<diseño> <REF><M|F|N> <tallas>.ai». Se exporta si el listado tiene al menos una
línea de ese género con una talla dentro del rango del archivo (y, si el listado indica el diseño, de ese diseño).
"""
import re
import unicodedata

from core.ordenes import MESA_AI, MESA_ALT, MESA_LEGACY, diseno_en_archivo

ADULTO = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL", "6XL"]
_ALIAS_TALLA = {"XXL": "2XL", "XXXL": "3XL"}


def _n(t):
    return unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().upper().strip()


def genero_de(texto):
    """M / F / N a partir de lo que diga el listado (MASC, FEM, NIÑO, NIÑA, HOMBRE, DAMA...). None si no se entiende."""
    t = _n(texto)
    if not t:
        return None
    # NIÑO/NIÑA como palabra completa: «FEMENINO» termina en «NINO» y no es niño
    encontrados = [g for g, patron in (("N", r"\bNIN[OA]S?\b|KID|INFANT|JUVENIL|^N$"), ("F", r"FEM|MUJER|DAMA|SENORA|^F$"),
                                       ("M", r"MASC|HOMBRE|CABALLERO|VARON|^M$")) if re.search(patron, t)]
    if len(encontrados) == 1:   # si el listado marca dos géneros a la vez (MASC/FEM) es ambiguo: no se adivina
        return encontrados[0]
    return None


def disenos_de(lineas):
    """Diseños que pide el listado (1, 2…): entiende «DISEÑO 1», «D1» y «D 1». Vacío si el listado no dice el diseño (entonces valen todos)."""
    nums = set()
    for l in lineas:
        for m in re.finditer(r"(?:\bDISENO|\bD)\s*(\d+)\b", _n(l.get("diseno", ""))):
            nums.add(int(m.group(1)))
    return nums


def diseno_del_archivo(nombre):
    """Número de diseño que dice el nombre de un archivo (FUT01_D1_MUESTRA.ai, D2 FUT02F XS A 4XL.ai); None si no lo dice."""
    m = re.search(r"(?:^|[_\s-])D(?:ISE\S{1,2}O)?(\d+)(?=[_\s.\-]|$)", str(nombre), re.I)
    return int(m.group(1)) if m else None


def filtrar_por_diseno(rutas, lineas):
    """(rutas que corresponden al listado, números de diseño omitidos). Si el listado no dice el diseño, devuelve todas."""
    pedidos = disenos_de(lineas)
    if not pedidos:
        return list(rutas), []
    elegidas, omitidas = [], []
    for r in rutas:
        d = diseno_del_archivo(getattr(r, "name", r))
        (elegidas if d is None or d in pedidos else omitidas).append(r)
    return elegidas, sorted({diseno_del_archivo(getattr(r, "name", r)) for r in omitidas})


_TELA = re.compile(r"^A\d+(?=[A-Z]{1,5}\d)")
_TELA_GUION = re.compile(r"\bA\d+-\d+(?=[A-Z]{1,5}\d)")


def referencias_del_listado(lineas):
    """Referencias (CA02, SD02…) de las hojas del listado: «A200CA02» -> CA02; «A100CB02-A100PT01» -> CB02, PT01; «A50CA00M» -> CA00."""
    refs = set()
    for l in lineas:
        hoja = _TELA_GUION.sub("", _n(l.get("hoja", "")))   # «A2100-502CH01»: la tela lleva guion (A2100-502) y la referencia es CH01
        for parte in re.split(r"[-+/]", hoja):
            parte = _TELA.sub("", parte.strip())
            if not parte:
                continue
            refs.add(parte)
            if re.fullmatch(r"[A-Z]{1,5}\d{2,3}[MFN]", parte):
                refs.add(parte[:-1])
    return refs


def referencia_del_archivo(nombre):
    """Referencia que dice el nombre de un archivo (CA02_D1_MUESTRA.ai, D1 CA02F XS A 4XL.ai) o None."""
    for t in re.findall(r"[A-Za-z]{1,5}\d{2,3}[MFN]?", str(nombre)):
        t = t.upper()
        if re.fullmatch(r"D\d+", t):
            continue
        return t[:-1] if re.fullmatch(r"[A-Z]{1,5}\d{2,3}[MFN]", t) else t
    return None


def filtrar_por_referencia(rutas, lineas):
    """Archivos de la referencia pedida en el listado, sin sustituciones.

    Es preferible detener el flujo si falta el maestro de CP03 a fabricar FUT04
    (u otra referencia de la misma carpeta). Cada archivo debe declarar la
    referencia en su nombre o en la carpeta que lo contiene.
    """
    refs = referencias_del_listado(lineas)
    if not refs:
        return list(rutas), []
    elegidas, omitidas = [], []
    for r in rutas:
        ref = referencia_del_archivo(getattr(r, "name", r))
        if ref is None and getattr(r, "parent", None) is not None:   # «Z_D1_MUESTRA.ai» no dice su referencia: la dice su carpeta («FUT09_D1_D2», «PE01MFN»)
            ref = referencia_del_archivo(r.parent.name)
        (elegidas if ref in refs else omitidas).append((r, ref))
    # ``None`` indica que el archivo ni su carpeta declaran una referencia.
    # No se puede ordenar junto con referencias de texto (Python compara ambos
    # tipos al aplicar ``sorted``), y ese detalle no debe detener la orden.
    # El archivo queda omitido por seguridad: nunca se usa una mesa/muestra
    # cuya referencia no se pudo identificar.
    omitidas_refs = sorted({ref for _, ref in omitidas if ref})
    return [r for r, _ in elegidas], omitidas_refs


def _norm_talla(t):
    t = _n(t).replace(" ", "")
    return _ALIAS_TALLA.get(t, t)


def _en_rango(talla, rango):
    """«XS A 4XL» / «4 A 16» / «S» -> ¿la talla cae dentro?"""
    # PLUS es un sufijo de la carpeta/archivo del maestro, no una talla.
    # Algunos maestros usan «D1_CP03M_XS-4XL.ai». El guion bajo solo separa
    # campos, no es parte de la talla: se interpreta igual que un espacio.
    rango = re.sub(r"\s+PLUS\s*$", "", _n(rango).replace("_", " "), flags=re.I)
    talla, partes = _norm_talla(talla), [p for p in re.split(r"\s+A\s+|-", re.sub(r"^\s*TALLAS?\b\s*", "", rango)) if p]
    if not talla or not partes:
        return False
    if talla.isdigit():
        if not all(p.isdigit() for p in partes):
            return False
        return int(partes[0]) <= int(talla) <= int(partes[-1])
    lista = [_norm_talla(x) for x in ADULTO]
    ini, fin = _norm_talla(partes[0]), _norm_talla(partes[-1])
    if talla not in lista or ini not in lista or fin not in lista:
        return False
    return lista.index(ini) <= lista.index(talla) <= lista.index(fin)


def _genero_efectivo(l):
    """Género del listado; una talla numérica (2 a 16) en MASC/FEM es de niño/niña (plantilla N)."""
    g = genero_de(l.get("genero", ""))
    return "N" if g in ("M", "F") and _norm_talla(l.get("talla", "")).isdigit() else g

def _sexo(l):
    """M / F del listado para las plantillas de niño «N(M)» y «N(F)»: NIÑO/MASC -> M, NIÑA/FEM -> F; None si no se sabe."""
    t = _n(l.get("genero", ""))
    if re.search(r"NINA|FEM|MUJER|DAMA|SENORA", t):
        return "F"
    if re.search(r"NINO|MASC|HOMBRE|CABALLERO|VARON", t):
        return "M"
    return None


def _talla_ok(talla, genero, rango):
    """¿La talla cae en el archivo? Con rango («XS A 4XL», «4 A 16») se mide; sin rango («D1 PE03F.ai») sirve toda talla del tipo:
    letras para adulto (M, F) y números para niño (N)."""
    if rango:
        return _en_rango(talla, rango)
    t = _norm_talla(talla)
    if not t:
        return False
    return t.isdigit() if genero == "N" else t in [_norm_talla(x) for x in ADULTO]


def mesas_para(rutas, lineas, plantillas=None):
    """Devuelve (seleccionadas, motivo). Si el listado no permite decidir, seleccionadas == [] y el motivo lo explica.
    `plantillas`: códigos de plantilla que Promedios maestros asigna a las referencias del listado (CA02M, CA02F, CA02N…).
    Si se da, solo se usan los .ai cuya plantilla esté en esa lista (un CA01F no sirve para una orden de CA02)."""
    candidatas = [r for r in rutas if MESA_AI.match(r.name) or MESA_ALT.match(r.name) or MESA_LEGACY.match(r.name)]
    if not candidatas:
        return [], "En el maestro no hay archivos con el formato «D1 FUT01M XS A 4XL»."
    if not lineas:
        return [], "El listado no trae líneas."
    sin_genero = [l for l in lineas if not genero_de(l.get("genero", ""))]
    if sin_genero:
        return [], f"En el listado hay {len(sin_genero)} líneas sin género claro (MASC, FEM o NIÑO)."
    refs = referencias_del_listado(lineas)
    validas = {r for r in refs if re.fullmatch(r"[A-Z]{1,5}\d{2,3}[MFN]?", r)}
    # La referencia puede estar en la carpeta del maestro y no en el nombre del archivo.
    candidatas = filtrar_por_referencia(candidatas, lineas)[0]
    # Cada línea del listado trae su propia referencia (hoja) y su diseño: un archivo solo se exporta si alguna línea pide ESA referencia, ESE diseño,
    # ese género y una talla que el archivo cubra. Nombres como «D1 PE03F.ai» (sin rango de tallas) y «D1 PE03N(M).ai» (niño) también se entienden.
    plantillas_ok = {x.upper() for x in plantillas} if plantillas else None
    sel = []
    for r in candidatas:
        m = MESA_AI.match(r.name)
        alt = MESA_ALT.match(r.name) if not m else None
        legacy = MESA_LEGACY.match(r.name) if not m and not alt else None
        if alt:
            n, g = int(alt.group(2)), alt.group(3).upper()
            ref_arch = ""  # referencia implícita en la carpeta
            resto = alt.group(1)
        elif legacy:
            # «BZ02M TALLA XS A XL.ai» vive en «BZ02_D1»: conserva el
            # archivo original y deduce D1 de su carpeta, sin renombrarlo.
            n = diseno_en_archivo(r.parent.name)
            if n is None:
                continue
            n, g, ref_arch = int(n), legacy.group(2).upper(), legacy.group(1).upper()
            resto = r.name[legacy.end():]
        else:
            n, ref_arch = int(m.group(1)), m.group(2).upper()
            # Algunos maestros son unisex: «D1 CA42 XS A 5XL.ai» no trae
            # M/F/N. En ese caso se contrasta diseño, referencia y talla,
            # sin inventar un género y sin descartar una mesa válida.
            g = m.group(3).upper() if m.group(3) else None
            resto = r.name[m.end():]
        sx = re.match(r"\(([MFmf])\)", resto)
        sexo_archivo = sx.group(1).upper() if sx else None
        if sx:
            resto = resto[sx.end():]
        rango = resto.rsplit(".", 1)[0].strip()
        # «DISEÑO1 CA42.ai» es un archivo de arte, no una plantilla para
        # mesas. Los maestros sin M/F/N son válidos solo si declaran el rango
        # de tallas, por ejemplo «D1 CA42 XS A 5XL.ai».
        if g is None and not rango:
            continue
        if plantillas_ok is not None and ref_arch and g and (ref_arch + g + (f"({sexo_archivo})" if sexo_archivo else "")) not in plantillas_ok:
            continue
        for l in lineas:
            refs_l = {x for x in referencias_del_listado([l]) if re.fullmatch(r"[A-Z]{1,5}\d{2,3}[MFN]?", x)}
            ref_plus = "PLUS" in r.name.upper()
            if ref_arch and refs_l and not ref_plus and not (ref_arch in refs_l or any(x[:-1] == ref_arch for x in refs_l if x[-1] in "MFN")):
                continue
            dis_l = disenos_de([l])
            if dis_l and n not in dis_l:
                continue
            if g and _genero_efectivo(l) != g:
                continue
            if sexo_archivo and _sexo(l) not in (None, sexo_archivo):
                continue
            if not _talla_ok(l.get("talla", ""), g or "M", rango):
                continue
            sel.append(r)
            break
    if not sel:
        return [], "Ninguna talla/género del listado coincide con los archivos del maestro."
    return sel, ""
