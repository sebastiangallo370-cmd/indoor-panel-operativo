"""OLVER: exporta cada mesa de trabajo del .ai como archivo independiente (cliente_referencia_mesa)."""
import json
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path

import config
from core import illustrator, ordenes, seleccion, util
from core.log import log
from core.vista import vista_previa

AGENTE = "OLVER"
FORMATOS = ("ai", "pdf", "png", "ambos")   # «ai»: cada mesa como archivo .ai (formato por defecto)


class _VigiaCarpeta:
    """Mira una carpeta mientras Illustrator trabaja y avisa (una sola vez por archivo) apenas aparece y deja de crecer."""

    def __init__(self, carpeta, patron, al_ver):
        self.carpeta, self.patron, self.al_ver = Path(carpeta), patron, al_ver
        self.vistos = {f.name: f.stat().st_mtime_ns for f in self.carpeta.glob(patron)} if self.carpeta.exists() else {}
        self.avisados, self.tamanos = set(), {}
        self.fin = False
        self.hilo = threading.Thread(target=self._correr, daemon=True)
        self.hilo.start()

    def _revisar(self, definitivo=False):
        try:
            for f in sorted(self.carpeta.glob(self.patron), key=lambda x: x.stat().st_mtime_ns):
                est = f.stat()
                if f.name in self.avisados or self.vistos.get(f.name) == est.st_mtime_ns:
                    continue
                estable = self.tamanos.get(f.name) == est.st_size   # ya no crece: Illustrator terminó de escribirlo
                self.tamanos[f.name] = est.st_size
                if estable or definitivo:
                    self.avisados.add(f.name)
                    self.al_ver(f)
        except OSError:
            pass

    def _correr(self):
        while not self.fin:
            self._revisar()
            time.sleep(0.5)

    def parar(self):
        self.fin = True
        self.hilo.join(2)
        self._revisar(definitivo=True)


# Primero se exportan TODAS las mesas de trabajo de cada plantilla que sí
# corresponde al pedido. Después, PDF por jugador filtra estrictamente por
# talla, diseño y género del listado para aplicar el JSX solo donde corresponde.
# Las mesas ya existentes se conservan salvo un reproceso con reemplazo.
SIEMPRE_TODAS_LAS_MESAS = True

def _cache_maestro(ai):
    """Ruta de la copia local incrustada del maestro (cambia sola si el .ai de la NAS cambia de tamaño o fecha)."""
    import hashlib
    try:
        st = Path(ai).stat()
        clave = hashlib.sha1(f"{Path(ai).name}|{st.st_size}|{st.st_mtime_ns}".encode("utf-8")).hexdigest()[:20]   # sin la ruta: igual en todos los PC
        carpeta = config.DATOS / "cache_maestros"
        carpeta.mkdir(parents=True, exist_ok=True)
        for viejo in carpeta.glob(f"{Path(ai).stem[:20]}_*.ai"):   # limpia versiones anteriores de este mismo maestro
            if clave not in viejo.name:
                viejo.unlink(missing_ok=True)
        return (carpeta / f"{Path(ai).stem[:20]}_{clave}.ai").as_posix()
    except OSError:
        return ""


def _destino_corto(carpeta):
    """Últimas carpetas del destino («Montajes (EPSON JESAM) / D1 / FUT01M») para mostrarlas en el panel."""
    partes = Path(carpeta).parts
    return " / ".join(partes[-3:])


def _evento_montaje(f):
    datos = {"tipo": "montaje", "nombre": f.stem, "carpeta": _destino_corto(f.parent)}
    try:   # imagen de la mesa para la pantalla en vivo del panel: el .ai se guarda compatible con PDF y se lee igual que un PDF. Es opcional: si falla, sigue sin imagen
        f = Path(f)
        if f.is_file() and f.stat().st_size <= 400 * 1024 * 1024:
            vista = vista_previa(f)
            if vista:
                datos["vista_local"] = str(vista)
    except Exception:  # noqa: BLE001
        pass
    log(AGENTE, f"EXPORTADA: {Path(f).stem}", archivo=datos)


class _VigiaTraslado:
    """Como en EDICION_AUTOMATICA (illustrator_local): Illustrator solo GUARDA, en una carpeta LOCAL (una subcarpeta por mesa, con su nombre final);
    no copia nada, porque en algunos PC su File.copy da «Error de E/S» hasta en local. Python traslada cada mesa a la NAS apenas queda completa
    y avisa «EXPORTADA»."""

    def __init__(self, local, destino):
        self.local, self.destino = Path(local), Path(destino)
        self.errores, self.hechos, self.tamanos, self.fin = [], set(), {}, False
        self.hilo = threading.Thread(target=self._correr, daemon=True)
        self.hilo.start()

    def _revisar(self, definitivo=False):
        try:
            for f in sorted(self.local.glob("*/*.ai"), key=lambda x: x.stat().st_mtime_ns):
                clave = str(f)
                if clave in self.hechos:
                    continue
                tam = f.stat().st_size
                # Illustrator terminó de guardarlo: no está vacío, no crece y nadie lo modificó en los últimos 3 s. Si se traslada (y se borra su carpeta) mientras Illustrator
                # todavía escribe, Illustrator responde «the operation was cancelled» (pasaba siempre con la 3.ª mesa).
                estable = tam > 0 and self.tamanos.get(clave) == tam and (time.time() - f.stat().st_mtime) > 3
                self.tamanos[clave] = tam
                if estable or definitivo:
                    self.hechos.add(clave)
                    self._trasladar(f)
        except OSError:
            pass

    def _trasladar(self, f):
        nombre = f.parent.name + ".ai"
        ultimo = None
        for intento in range(1, 6):
            try:
                self.destino.mkdir(parents=True, exist_ok=True)
                final = self.destino / nombre
                # Si otra ejecución ya dejó esa mesa, es la versión que se
                # reutiliza. No la reemplazamos ni hacemos que Illustrator
                # pierda tiempo exportándola otra vez.
                if final.is_file() and final.stat().st_size > 0:
                    shutil.rmtree(f.parent, ignore_errors=True)
                    log(AGENTE, f"Reutilizo mesa ya exportada: {final.name}")
                    return
                shutil.copy2(f, final)
                shutil.rmtree(f.parent, ignore_errors=True)
                _evento_montaje(final)
                return
            except OSError as e:
                ultimo = e
                time.sleep(1.5 * intento)
        self.errores.append(f"{nombre}: {ultimo}")
        log(AGENTE, f"No pude copiar {nombre} a {self.destino}: {ultimo}", "ERROR")

    def _correr(self):
        while not self.fin:
            self._revisar()
            time.sleep(0.5)

    def parar(self):
        self.fin = True
        self.hilo.join(2)
        self._revisar(definitivo=True)


class _Vigia(_VigiaCarpeta):
    """Avisa «EXPORTADA: Talla_XS_Tipo_D1_Gen_M» en el panel apenas cada mesa queda guardada."""

    def __init__(self, carpeta):
        super().__init__(carpeta, "*.ai", _evento_montaje)


def _evento_pdf(f, jugadores, talla, diseno, genero):
    m = re.search(r"_(\d+)\.pdf$", f.name)
    j = jugadores[int(m.group(1)) - 1] if m and 0 < int(m.group(1)) <= len(jugadores) else {}
    mu = re.search(r"_(\d+)unds\.pdf$", f.name)
    nombre, numero = " ".join((j.get("nombre") or "").split()), str(j.get("numero") or "").strip()   # en pantalla y registro el nombre va en un renglón
    datos = {"tipo": "pdf", "nombre": nombre, "numero": numero, "talla": talla, "diseno": f"D{diseno}", "genero": genero,
             "detalle": f.name, "carpeta": _destino_corto(f.parent), "ruta": str(f)}   # ruta completa: el botón «Abrir en Illustrator» del panel
    vista = None
    for intento in range(8):   # el PDF puede seguir ocupado un instante después de que Illustrator lo cierra: se reintenta
        vista = vista_previa(f)
        if vista:
            break
        time.sleep(0.6)
    if not vista:
        from core import vista as _vista_mod
        log(AGENTE, f"Sin imagen en pantalla en vivo de {f.name}: {_vista_mod.ultimo_error or 'no hay librería de PDF'}", "WARN")
    if vista:
        datos["vista_local"] = str(vista)
    if mu:
        datos["cantidad"] = int(mu.group(1))
    log(AGENTE, f"PDF listo: {mu.group(1) + ' unds sin nombre ni número' if mu else (nombre or 'sin nombre') + ' #' + numero} (talla {talla})", archivo=datos)


def carpeta_mesas(cliente, referencia, orden=None):
    return util.carpeta_pedido(cliente, referencia, orden) / "mesas"


def exportar_mesas(cliente, referencia, ruta_ai, formato="ai", sobrescribir=False, orden=None, destino=None, generos=None, limpiar=True, lineas=None, tallas_forzadas=None):
    """Devuelve {"ok": True, "carpeta", "archivos": [...]} | {"ok": False, "existe": True, ...} | {"ok": False, "error"}"""
    formato = (formato or "ai").lower()
    if formato not in FORMATOS:
        return {"ok": False, "error": f"Formato no válido ({formato}). Usa: ai, pdf, png o ambos."}

    ai = Path(str(ruta_ai).strip().strip('"'))
    simulado = illustrator.modo_simulado()
    if not simulado and not ai.exists():
        log(AGENTE, f"No encuentro el archivo {ai}", "ERROR")
        return {"ok": False, "error": f"No encuentro el archivo: {ai}"}

    # Nombre de cada mesa: D1_FUT01M (diseño + referencia + M/F/N). Referencia y diseños salen de la carpeta del .ai (FUT01_ D1_D2_)
    mn = _maestro_match(ai)   # formato moderno o histórico «FUT02M TALLA XS A 4XL.ai»
    if mn and getattr(mn, "sin_genero", False):
        try:
            mn = _maestro_con_genero_del_listado(mn, lineas)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
    ref, ds = ordenes.ref_y_disenos(ai.parent.name)
    ref = (ref or "").upper()
    disenos = sorted(ds, key=int)
    if mn:
        ref, disenos, generos = mn.group(2).upper(), [mn.group(1)], [mn.group(3).upper()]
    # Un solo archivo por maestro (D1 FUT01M XS A 4XL.ai) con SOLO las mesas de las tallas que pide el listado
    tallas, nombre_final = [], ""
    if mn and lineas:
        por_talla = _solo_sexo_del_maestro(_jugadores_de(lineas, mn.group(1), mn.group(3).upper()), mn.group(4))
        tallas = [str(t).upper() for t in (tallas_forzadas or [t for t, _ in por_talla])]
        if not tallas:
            return {"ok": False, "sin_tallas": True, "error": f"El listado no pide tallas de diseño {mn.group(1)} y género {mn.group(3).upper()} para {ai.name}."}
        nombre_final = f"D{mn.group(1)}_{ref}{mn.group(3).upper()}"
    if destino:  # carpeta IMPRESIÓN (MÁQUINA) de la orden: NO se borra nada; solo se avisa si un archivo ya existe
        carpeta = Path(destino["carpeta"])
        if tallas:   # Montajes (MÁQUINA)\D1\FUT01M\Talla_M_Tipo_D1_Gen_M.ai
            carpeta = carpeta / f"D{mn.group(1)}" / f"{ref}{mn.group(3).upper()}{(mn.group(4) or '').upper()}"
        generos = generos or destino.get("generos") or []
        prefijo = ""
    else:
        carpeta = util.carpeta_pedido(cliente, referencia, orden) / "mesas"
        # También fuera del flujo de Producción, las mesas de un maestro
        # Fusionado se guardan juntas y no al lado de las mesas normales.
        if "FUSIONADO" in ai.name.upper():
            carpeta = carpeta / "Fusionado"
        if limpiar:
            previos = [f for f in carpeta.glob("*") if f.is_file()] if carpeta.exists() else []
            if previos and not sobrescribir:
                return {"ok": False, "existe": True, "carpeta": str(carpeta), "n": len(previos)}
            for f in previos:  # solo llega aquí si el usuario confirmó sobrescribir
                f.unlink()
        prefijo = f"{util.limpiar(cliente)}_{util.limpiar(referencia)}"
    if not simulado or not destino or tallas:
        carpeta.mkdir(parents=True, exist_ok=True)
    if tallas and not sobrescribir and not simulado and carpeta.exists():   # siempre verifica Montajes antes de exportar (antes se saltaba con SIEMPRE_TODAS_LAS_MESAS)
        # Las mesas por talla que ya están exportadas no se vuelven a exportar: solo se exportan las que faltan
        # En los maestros de niño (N) la mesa NO se llama Gen_N: se guarda como Gen_M o Gen_F (el sexo del maestro «N(F)»/«N(M)» o el de los
        # jugadores de esa talla). Antes solo se buscaba Gen_N, no se encontraba nunca y las tallas de niño se exportaban en cada ejecución.
        gen_maestro, suf_sexo = mn.group(3).upper(), (mn.group(4) or "").strip("()").upper()
        sexos_talla = {t: sorted({(j.get("sexo") or "M") for j in js}) for t, js in por_talla}

        def _hay(t, g):
            f = carpeta / f"Talla_{t}_Tipo_D{mn.group(1)}_Gen_{g}.ai"
            try:
                return f.is_file() and f.stat().st_size > 0
            except OSError:
                return False

        def _exportada(t):
            if _hay(t, gen_maestro):
                return True
            if gen_maestro != "N":
                return False
            necesarios = [suf_sexo] if suf_sexo else (sexos_talla.get(t) or ["M"])
            return all(_hay(t, g) for g in necesarios)
        ya = [t for t in tallas if _exportada(t)]
        faltan = [t for t in tallas if t not in ya]
        ruta_montajes = str(carpeta)
        log(AGENTE, f"Revisé Montajes ({ruta_montajes}): existen [{', '.join(ya) or 'ninguna'}]; faltan [{', '.join(faltan) or 'ninguna'}]")
        if ya:
            log(AGENTE, f"Ya estaban exportadas {len(ya)} talla(s) ({', '.join(ya)}): no las exporto de nuevo")
            tallas = faltan
            if not tallas:
                log(AGENTE, f"{ai.name}: todas las mesas pedidas ya existían, sigo sin exportar")
                return {"ok": True, "carpeta": str(carpeta), "archivos": sorted(f.name for f in carpeta.glob("*") if f.is_file()), "simulado": simulado, "ya_existian": len(ya)}
            log(AGENTE, f"Exporto solo las que faltan: {', '.join(tallas)}")
    alcance_mesas = "todas las mesas de trabajo" if SIEMPRE_TODAS_LAS_MESAS else "las mesas solicitadas"
    log(AGENTE, f"Exportando {alcance_mesas} de {ai.name} a {carpeta} ({formato})" + (" [simulado]" if simulado else ""))
    try:
        if simulado:
            for n in ("frente", "espalda", "mangas"):
                if tallas:
                    for t in ("XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"):   # todas las mesas del maestro
                        _evento_montaje(carpeta / f"Talla_{t}_Tipo_D{mn.group(1)}_Gen_{mn.group(3).upper()}.ai"); util.pdf_simulado(carpeta / f"Talla_{t}_Tipo_D{mn.group(1)}_Gen_{mn.group(3).upper()}.ai", ["MESA SIMULADA (.ai)", t])
                    break
                if formato == "ai":   # simulado: un .ai moderno es un PDF por dentro
                    util.pdf_simulado(carpeta / f"{prefijo}_{ai.stem}_{n}.ai", ["MESA SIMULADA (.ai)", n])
                if formato in ("pdf", "ambos"):
                    util.pdf_simulado(carpeta / f"{prefijo}_{ai.stem}_{n}.pdf", ["MESA SIMULADA", n])
                if formato in ("png", "ambos"):
                    util.png_simulado(carpeta / f"{prefijo}_{ai.stem}_{n}.png")
        else:
            local = Path(tempfile.gettempdir()) / "indoor_agentes_mesas" / f"{int(time.time() * 1000)}"
            local.mkdir(parents=True, exist_ok=True)
            vigia = _VigiaTraslado(local, carpeta) if tallas else None
            trabajo = _dir_trabajo(carpeta) if tallas else None
            if trabajo:
                _limpiar_trabajo_viejo()
                shutil.rmtree(trabajo, ignore_errors=True)
                trabajo.mkdir(parents=True, exist_ok=True)
            cache = ""   # OLVER no incrusta imágenes ni crea copias: deja las mesas tal cual (las imágenes las trata quien pone nombre y número)
            res = illustrator.ejecutar_jsx(
                "exportar_mesas.jsx",
                {"ai": ai.as_posix(), "carpeta": carpeta.as_posix(), "prefijo": prefijo, "formato": formato,
                 "conGenero": bool(ref), "ref": ref, "disenos": disenos, "sobrescribir": bool(sobrescribir) or not limpiar,
                 "generoUnico": generos[0] if generos and len(generos) == 1 else "",
                 "tallas": tallas, "nombre": nombre_final, "todas": SIEMPRE_TODAS_LAS_MESAS, "cache": cache, "local": local.as_posix() if tallas else "", "trabajo": trabajo.as_posix() if trabajo else ""},
            )
            if vigia:
                vigia.parar()
                if vigia.errores:
                    raise RuntimeError("No pude copiar a la carpeta de destino: " + "; ".join(vigia.errores))
                shutil.rmtree(local, ignore_errors=True)
            if trabajo:   # cada subcarpeta <mesa>/m_*.ai -> <mesa>.ai
                for sub in [d for d in trabajo.iterdir() if d.is_dir()]:
                    arch = sorted(sub.glob("*.ai"))
                    if arch:
                        shutil.move(str(arch[0]), str(trabajo / f"{sub.name}.ai"))
                    shutil.rmtree(sub, ignore_errors=True)
                # La copia de trabajo (imágenes incrustadas) se queda SOLO en este PC, en la carpeta temporal de trabajo.
                # Las mesas que quedan en Montajes NO llevan imágenes incrustadas: se guardan tal cual (vinculadas).
                # La copia incrustada local la usa el paso de PDF por jugador para no volver a incrustar.
                for lista in trabajo.glob("*.ai"):
                    log(AGENTE, f"Copia de trabajo local (no va a Montajes): {lista.name}")
            if res.startswith("FALTAN"):   # se exportó, pero el maestro no tiene la mesa de alguna talla pedida
                log(AGENTE, f"{ai.name}: el maestro no tiene mesa de las tallas {res.split('|', 1)[1]}", "WARN")
                res = "OK|0"
            if res.startswith("EXISTE"):
                return {"ok": False, "existe": True, "carpeta": str(carpeta), "n": 1, "archivo": res.split("|", 1)[1]}
            avisos = []
            if res.startswith("PARCIAL|"):   # alguna mesa no se guardó, pero las demás sí: se exporta lo que salió y se avisa
                _, buenas, sin = (res.split("|", 2) + ["", ""])[:3]
                if buenas in ("0", ""):
                    raise RuntimeError(res)
                log(AGENTE, f"{ai.name}: exportadas {buenas} mesas; NO se pudieron exportar: {sin}", "WARN")
                avisos.append(f"Mesas sin exportar: {sin}")
                res = "OK|" + buenas
            if not res.startswith("OK"):
                raise RuntimeError(res)
    except Exception as e:  # noqa: BLE001
        if "vigia" in dir() and vigia:
            vigia.parar()
        log(AGENTE, f"Falló la exportación: {e}", "ERROR")
        return {"ok": False, "error": f"Illustrator no pudo exportar las mesas: {e}"}

    archivos = sorted(f.name for f in carpeta.glob("*") if f.is_file())
    if not archivos:
        log(AGENTE, "No se generó ningún archivo", "ERROR")
        return {"ok": False, "error": "No se generó ningún archivo. Revisa el .ai."}
    log(AGENTE, f"{len(archivos)} archivos exportados")
    return {"ok": True, "carpeta": str(carpeta), "archivos": archivos, "simulado": simulado, "avisos": avisos}


# =====================================================================================================
# PDF DE PRODUCCIÓN POR JUGADOR
# Usa el script BOT.jsx de EDICION_AUTOMATICA (el mismo que ya usan en producción): abre el .ai del maestro (D1 FUT02F XS A 4XL.ai),
# toma la mesa de trabajo de la talla (Talla_M_Tipo_D1_Gen_F) y, por cada jugador, cambia SOLO los textos «NOMBRE» y «00»
# (centrados, sin tocar capas) y guarda un PDF. Cada PDF es de un jugador.
# =====================================================================================================
def _bot_jsx():
    """(código, ruta) del BOT.jsx: el de la red si se puede leer, si no la copia local jsx/BOT.jsx."""
    for ruta in (config.BOT_JSX, config.JSX / "BOT.jsx"):
        try:
            return Path(ruta).read_text(encoding="utf-8-sig"), str(ruta)
        except OSError:
            continue
    raise RuntimeError("No encuentro BOT.jsx (ni en la red ni en jsx/BOT.jsx).")


def _seguro(texto):
    return re.sub(r"[^A-Za-z0-9]+", "_", util.limpiar(texto)).strip("_")


_SALTO = "{{SALTO}}"   # marca de «cambio de renglón» dentro del nombre; BOT.jsx (parchado en memoria) la convierte en salto de línea


def _parchar_saltos(codigo):
    """BOT.jsx pone el nombre en un solo renglón. Con este parche en memoria (no se toca el archivo, ni el de la red) un nombre que en el
    listado está en dos renglones queda en dos renglones en el PDF. Devuelve (código, aplicado)."""
    viejo = 'var texto = (nuevoTexto || "").toString();'
    if codigo and viejo in codigo:
        return codigo.replace(viejo, viejo[:-1] + '.split("' + _SALTO + '").join("\\r");', 1), True
    return codigo, False


def _csv_jugadores(filas, saltos=False):
    """CSV que espera BOT.jsx: NOMBRE_1;NUMERO_1 (una fila = un jugador = un PDF). Si el nombre viene en varios renglones y BOT.jsx lo
    soporta (saltos=True) se conservan; si no, se junta en un solo renglón como antes."""
    limpio = lambda v: re.sub(r"[;\r\n\"]+", " ", str(v or "")).strip()

    def nombre(v):
        renglones = [limpio(r) for r in re.split(r"[\r\n]+", str(v or ""))]
        return (_SALTO if saltos else " ").join(r for r in renglones if r)
    if any(f.get("sufijo") for f in filas):   # BOT.jsx nombra el PDF «<base>_<sufijo>.pdf» (p. ej. …_32unds.pdf)
        return "\r\n".join(["NOMBRE_1;NUMERO_1;SUFIJO_CANTIDAD_1"] + [f"{nombre(f['nombre'])};{limpio(f['numero'])};{limpio(f.get('sufijo'))}" for f in filas])
    return "\r\n".join(["NOMBRE_1;NUMERO_1"] + [f"{nombre(f['nombre'])};{limpio(f['numero'])}" for f in filas])


def _jugadores_de(lineas, diseno, genero):
    """Líneas del listado que corresponden a este archivo (diseño D<n> y género M/F/N), agrupadas por talla en el orden de tallas."""
    orden = {t: i for i, t in enumerate(config.TALLAS_PERMITIDAS)}
    grupos = {}

    def dato(v):
        # Excel/Sheets puede entregar la celda vacía como None, NaN o texto
        # «SIN NUMERO» o el guion visual «—». Ninguno es personalización.
        texto = "" if v is None else str(v).strip()
        clave = texto.casefold()
        vacios = ("", "none", "nan", "null", "sin numero", "sin número", "sin nombre", "s/n", "n/a")
        return "" if clave in vacios or re.fullmatch(r"[-–—_./]+", texto) else texto

    for l in lineas:
        if seleccion._genero_efectivo(l) != genero:   # talla numérica en MASC/FEM = niño/niña
            continue
        d = re.search(r"(\d+)", str(l.get("diseno", "")))
        if d and d.group(1) != str(diseno):
            continue
        talla = str(l.get("talla", "")).upper().strip()
        talla = "2XL" if talla == "XXL" else talla   # en las mesas del maestro se llama Talla_2XL
        if talla:   # sin nombre o sin número igual se exporta: el PDF queda en blanco en ese dato
            grupos.setdefault(talla, []).append({"nombre": dato(l.get("nombre")), "numero": dato(l.get("numero")), "hoja": l.get("hoja", ""), "sexo": seleccion._sexo(l) or ""})
    return sorted(grupos.items(), key=lambda kv: (orden.get(kv[0], 99), kv[0]))


# Nombre del maestro: «D1 BAL01N(F) 4 A 16.ai» -> diseño 1, referencia BAL01, género N y sufijo (F). Las carpetas llevan el MISMO nombre que la plantilla (BAL01N(F)).
_RE_MAESTRO = r"^D(?:ISE\S{1,2}O)?\s*(\d+)[\s_]+([A-Za-z]+\d+)([MFN])(\([MF]\))?(?![A-Za-z0-9])"   # también «DISEÑO1 PT01M XS A 4XL.ai»
_RE_MAESTRO_UNISEX = re.compile(r"^D(?:ISE\S{1,2}O)?\s*(\d+)[\s_]+([A-Za-z]+\d+)(?=[\s_.-]|$)", re.I)
_RE_MAESTRO_HISTORICO = re.compile(r"^([A-Za-z]+\d+)([MFN])(?:[\s_-]+)TALLA(?:[\s_-]+)", re.I)
# Mesa independiente que exporta OLVER desde un maestro. Su nombre no trae la
# referencia porque esta ya vive en la carpeta de producción del pedido.
_RE_MESA_INDEPENDIENTE = r"^(?:.+_)?Talla_([^_]+)_Tipo_D(\d+)_Gen_([MFN])$"


class _MaestroHistorico:
    """Compatibilidad mínima con Match para los maestros antiguos sin D<n>."""
    def __init__(self, diseno, referencia, genero):
        self._grupos = (str(diseno), referencia, genero, "")

    def group(self, indice):
        return self._grupos[indice - 1]


class _MaestroUnisex:
    """Maestro «D1 CA42 XS A 5XL.ai»: su género se toma del listado."""
    sin_genero = True

    def __init__(self, diseno, referencia):
        self._grupos = (str(diseno), referencia, "", "")

    def group(self, indice):
        return self._grupos[indice - 1]


def _maestro_match(ai):
    """Lee ambos formatos sin modificar los archivos del cliente."""
    m = re.match(_RE_MAESTRO, Path(ai).name, re.I)
    if m:
        return m
    unisex = _RE_MAESTRO_UNISEX.match(Path(ai).name)
    if unisex:
        return _MaestroUnisex(unisex.group(1), unisex.group(2).upper())
    antiguo = _RE_MAESTRO_HISTORICO.match(Path(ai).name)
    diseno = ordenes.diseno_en_archivo(Path(ai).parent.name) if antiguo else None
    if antiguo and diseno:
        return _MaestroHistorico(diseno, antiguo.group(1).upper(), antiguo.group(2).upper())
    return None


def _maestro_con_genero_del_listado(maestro, lineas):
    """Un maestro sin M/F/N se ejecuta solo para el género único solicitado."""
    if not getattr(maestro, "sin_genero", False):
        return maestro
    generos = {seleccion._genero_efectivo(linea) for linea in (lineas or [])}
    generos.discard(None)
    if len(generos) != 1:
        raise ValueError("El maestro unisex necesita un único género en el listado para exportar la plantilla correcta.")
    return _MaestroHistorico(maestro.group(1), maestro.group(2), generos.pop())


def _solo_sexo_del_maestro(por_talla, sufijo):
    """Un maestro de niño «N(F)» solo es para niñas y «N(M)» solo para niños: se dejan solo los jugadores de ese sexo."""
    suf = (sufijo or "").strip("()").upper()
    if not suf:
        return por_talla
    filtrado = [(t, [j for j in js if (j.get("sexo") or "M") == suf]) for t, js in por_talla]
    return [(t, js) for t, js in filtrado if js]


def _dir_trabajo(carpeta_mesas):
    """Carpeta LOCAL con las copias de trabajo (imágenes incrustadas) de las mesas de esa carpeta de la NAS. Solo para poner nombre y número."""
    import hashlib
    clave = str(carpeta_mesas).replace("\\", "/").rstrip("/").lower()
    return Path(tempfile.gettempdir()) / "indoor_agentes_trabajo" / hashlib.md5(clave.encode("utf-8")).hexdigest()[:12]


def _limpiar_trabajo_viejo(dias=3):
    base = Path(tempfile.gettempdir()) / "indoor_agentes_trabajo"
    try:
        limite = time.time() - dias * 86400
        for d in base.iterdir():
            if d.is_dir() and d.stat().st_mtime < limite:
                shutil.rmtree(d, ignore_errors=True)
    except OSError:
        pass


def _agrupar_sin_datos(jugadores):
    """Agrupa las líneas sin nombre ni número en un PDF por talla.

    Las prendas personalizadas conservan su consecutivo normal; las que no
    llevan dato quedan como «3unds», «30unds», etc., según su cantidad."""
    con_datos = [j for j in jugadores if j["nombre"] or j["numero"]]
    n = len(jugadores) - len(con_datos)
    if n:
        hoja = next((j["hoja"] for j in jugadores if j.get("hoja")), "")
        con_datos.append({"nombre": "", "numero": "", "hoja": hoja, "sufijo": f"{n}unds", "cantidad": n})
    return con_datos


def _mesas_de(carpeta_m, talla, diseno, generos):
    """Nombres (sin .ai) de TODAS las mesas independientes de esa talla, diseño y género que hay en Montajes: Talla_10_Tipo_D1_Gen_M, y también
    Frente_Talla_10_Tipo_D1_Gen_M y Espalda_Talla_10_Tipo_D1_Gen_M cuando el maestro separa frente y espalda."""
    patron = re.compile(rf"^(?:.+_)?Talla_{re.escape(str(talla))}_Tipo_D{re.escape(str(diseno))}_Gen_({'|'.join(re.escape(g) for g in generos)})$", re.I)
    try:
        return sorted(f.stem for f in Path(carpeta_m).glob("*.ai") if f.is_file() and f.stat().st_size > 0 and patron.match(f.stem))
    except OSError:
        return []



def _archivo_pdf(carpeta, base, i, j):
    """Ruta del PDF del jugador o del grupo sin datos («…_3unds.pdf»)."""
    return Path(carpeta) / (f"{base}_{j['sufijo']}.pdf" if j.get("sufijo") else f"{base}_{i:02d}.pdf")


def _nombres_esperados(carpeta, base, jugadores):
    return [_archivo_pdf(carpeta, base, i, j) for i, j in enumerate(jugadores, 1)]


def _hermanos_del_maestro(montajes, diseno, ref_actual, genero, suf, tallas):
    """Carpetas HERMANAS de Montajes (otra tela, mismo diseño y mismo género) que ya tienen la mesa independiente de CADA talla pedida.
    Igual que Generador_PDFS.jsx: se busca en la carpeta de diseño, nunca en otro diseño (D2, D3…).
    Devuelve (con_mesas [(referencia, ruta_de_una_mesa.ai)], sin_mesas [referencia])."""
    actual = f"{ref_actual}{genero}{suf}".upper()
    try:
        carpetas = sorted((c for c in (Path(montajes) / f"D{diseno}").iterdir() if c.is_dir()), key=lambda p: p.name)
    except OSError:
        return [], []
    con, sin = [], []
    for c in carpetas:
        nombre = c.name.upper()
        if nombre == actual:
            continue
        m = re.fullmatch(rf"([A-Z0-9]+){re.escape(genero)}{re.escape(suf)}", nombre)
        if not m:
            continue
        mesa_por_talla, faltan = {}, []
        for t in tallas:
            nombres = _mesas_de(c, t, diseno, {genero})
            if not nombres:
                faltan.append(t)
                continue
            principal = [n for n in nombres if n.startswith("Talla_")] or nombres
            mesa_por_talla[t] = c / f"{principal[0]}.ai"
        if faltan:
            sin.append(m.group(1))
        else:
            con.append((m.group(1), next(iter(mesa_por_talla.values()))))
    return con, sin


def pdfs_por_jugador(ruta_ai, lineas, destino, orden, tela="", sobrescribir=False, tela_archivo=None, referencia="", genero_destino=None,
                      permitir_faltantes=False, solo_mesas=False, _sin_hermanos=False):
    # destino["montajes"]: carpeta Montajes (MÁQUINA) del maestro; si ahí ya están las mesas independientes exportadas, se abre cada talla desde su archivo
    """Crea un PDF por jugador. Devuelve:
        {"ok": True, "pdfs": [{"ruta", "nombre", "numero", "talla"}], "carpeta", "simulado", "omitidas": [...]}
        {"ok": False, "existe": True, "carpeta", "n"}      ya hay PDFs con esos nombres y no se confirmó reemplazar
        {"ok": False, "error": texto}
    """
    ai = Path(str(ruta_ai).strip().strip('"'))
    m = _maestro_match(ai)
    # Los maestros históricos pueden venir sin la letra M/F/N (por ejemplo,
    # «D1 CA42 XS A 5XL.ai»). Al crear los PDF se debe resolver con el
    # listado actual igual que al exportar las mesas; de lo contrario queda
    # un género vacío y OLVER reporta erróneamente que no hay jugadores.
    if m and getattr(m, "sin_genero", False):
        try:
            m = _maestro_con_genero_del_listado(m, lineas)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
    mesa = re.match(_RE_MESA_INDEPENDIENTE, ai.stem, re.I)
    if m:
        diseno, ref, genero_maestro = m.group(1), m.group(2).upper(), m.group(3).upper()
        # Un maestro puede incluir mesas M y F. Si falta el .ai femenino,
        # reutilizamos ese maestro y exportamos su mesa Gen_F; nunca se deja
        # una jugadora sin PDF solo porque el archivo se llamó PE03M.
        genero = str(genero_destino or genero_maestro).upper()
        suf_maestro = (m.group(4) or "").upper()
    elif mesa and str(referencia).strip():
        # «Talla_M_Tipo_D1_Gen_M.ai» es una mesa YA aislada por OLVER. Solo
        # se acepta cuando TAVO entrega la referencia exacta del pedido; así
        # nunca se usa una mesa de otra referencia por accidente.
        diseno, ref, genero = mesa.group(2), str(referencia).strip().upper(), str(genero_destino or mesa.group(3)).upper()
        genero_maestro = mesa.group(3).upper()
        suf_maestro = ""
        log(AGENTE, f"Reconozco {ai.name} como mesa independiente de D{diseno} {ref}{genero}")
    else:
        return {"ok": False, "error": f"El nombre del archivo no dice diseño, referencia y género (D1 FUT02F …): {ai.name}"}
    por_talla = _solo_sexo_del_maestro(_jugadores_de(lineas, diseno, genero), suf_maestro)
    # DIAGNÓSTICO: líneas que recibe el plan, de qué pestañas son y cuántos jugadores quedan para este maestro
    log(AGENTE, f"DIAG plan {ai.name}: {len(lineas)} líneas recibidas · pestañas {sorted({str(l.get('hoja', '')) for l in lineas})} · "
        f"diseño {diseno} género {genero} sufijo '{suf_maestro}' → {sum(len(js) for _, js in por_talla)} jugador(es) en tallas {[t for t, _ in por_talla]}")
    if not por_talla:
        return {"ok": False, "error": f"El listado no tiene jugadores de diseño {diseno} y género {genero} para {ai.name}."}
    simulado = illustrator.modo_simulado()
    if not simulado and not ai.exists():
        return {"ok": False, "error": f"No encuentro el archivo: {ai}"}
    # Regla obligatoria: ningún PDF se crea sin revisar primero las mesas de
    # Montajes. Ahí se reutilizan las que ya existen y se exportan únicamente
    # las tallas faltantes; sin ese destino no se continúa a los PDFs.
    if not simulado and not destino.get("montajes"):
        return {"ok": False, "error": "No encontré la carpeta Montajes para verificar/exportar las tallas; no genero PDFs sin esa revisión."}

    hoja = next((j["hoja"] for _, js in por_talla for j in js if j["hoja"]), "")
    carpeta = Path(destino["carpeta"]) / (_seguro(hoja) or ref) / f"D{diseno}" / f"{ref}{genero}{suf_maestro}"
    prefijo = f"{util.limpiar(orden)}_" if orden else ""
    en_archivo = tela if tela_archivo is None else tela_archivo   # el nombre del archivo lleva la tela sin color (MONTECATINI); dentro del PDF sigue la descripción completa
    if en_archivo:
        prefijo += f"{_seguro(en_archivo)}_"
    # Las mesas y los PDF NUNCA llevan N: siempre Gen_M o Gen_F (un niño es M y una niña F). En los archivos de niño (N) se separa cada talla por sexo.
    plan = []
    for talla, js in por_talla:
        if genero == "N":
            por_sexo = {}
            for j in js:
                por_sexo.setdefault(j.get("sexo") or "M", []).append(j)
            for sx in sorted(por_sexo, key=lambda x: (x != "M", x)):
                nom = f"Talla_{talla}_Tipo_D{diseno}_Gen_{sx}"
                plan.append((talla, nom, f"{prefijo}{nom}", _agrupar_sin_datos(por_sexo[sx])))
        else:
            nom = f"Talla_{talla}_Tipo_D{diseno}_Gen_{genero}"
            plan.append((talla, nom, f"{prefijo}{nom}", _agrupar_sin_datos(js)))

    esperados = [p for _, _, base, js in plan for p in _nombres_esperados(carpeta, base, js)]
    previos = [p for p in esperados if p.exists()]
    if previos and not sobrescribir:
        # No basta con que exista *algún* PDF. Antes esto hacía que una
        # exportación incompleta pareciera terminada y TAVO la conservara.
        # Se marca el faltante para que el reintento reconstruya el conjunto.
        return {"ok": False, "existe": True, "incompleto": len(previos) != len(esperados),
                "carpeta": str(carpeta), "n": len(previos), "esperados": len(esperados)}

    faltan = []
    pendientes_autorizados = []
    if not simulado and destino.get("montajes"):   # RECTIFICA que existan las mesas independientes de TODAS las tallas (adulto o niño) ANTES de poner nombre y número
        carpetas_m = [Path(destino["montajes"]) / f"D{diseno}" / f"{ref}{genero}{suf_maestro}"]
        if genero_maestro != genero:
            carpetas_m.append(Path(destino["montajes"]) / f"D{diseno}" / f"{ref}{genero_maestro}{suf_maestro}")

        def _mesa_ok(art, talla):
            # En los maestros de niño la mesa se llama Gen_M o Gen_F; y en algunos maestros F/M las mesas de trabajo quedaron rotuladas con la otra letra
            # (CA04F con «Talla_XS_Tipo_D1_Gen_M»). Las mesas viven en la carpeta de ESE maestro, así que cualquiera de las dos letras sirve.
            gens = {art.rsplit("_Gen_", 1)[-1]} | {"M", "F"}
            return any(_mesas_de(cm, talla, diseno, gens) for cm in carpetas_m)

        faltan = [t for t, art, _b, _j in plan if not _mesa_ok(art, t)]
        if faltan:
            log(AGENTE, f"{ai.name}: faltan las mesas independientes de las tallas {', '.join(faltan)}; las exporto ANTES de poner nombre y número")
            try:
                # El maestro PE03M puede contener la mesa Gen_F infantil. Al
                # pedir talla 16/N se fuerza esa talla: de otro modo OLVER
                # exportaba solo las tallas adultas masculinas y nunca llegaba
                # a encontrar Talla_16_Tipo_Dn_Gen_F.
                exportar_mesas("", "", str(ai), "ai", True, orden=orden,
                                destino={**destino, "carpeta": destino["montajes"]}, generos=destino.get("generos"),
                                limpiar=False, lineas=lineas, tallas_forzadas=list(faltan))   # solo las tallas que faltan; las mesas ya exportadas no se tocan
            except Exception as e:  # noqa: BLE001
                log(AGENTE, f"No pude exportar las mesas que faltaban de {ai.name}: {e}", "WARN")
            faltan = [t for t, art, _b, _j in plan if not _mesa_ok(art, t)]
        if faltan:
            # Una talla puede ser perfectamente válida en el listado (por
            # ejemplo 5XL) pero no existir físicamente en este maestro (que
            # termina en 4XL). No se puede adivinar ni clonar otra talla. Se
            # pide la decisión de la persona ANTES de abrir Illustrator.
            faltan = list(dict.fromkeys(faltan))
            if solo_mesas:   # fase 1: solo se revisan y exportan las mesas; los PDF se crean después
                return {"ok": False, "faltantes": faltan, "maestro": ai.name, "solo_mesas": True}
            if not permitir_faltantes:
                return {
                    "ok": False,
                    "requiere_confirmacion": True,
                    "faltantes": faltan,
                    "maestro": ai.name,
                    "error": "No existen mesas independientes para: " + ", ".join(faltan),
                }
            pendientes_autorizados = list(dict.fromkeys(
                art for talla, art, _base, _jugadores in plan if talla in faltan
            ))
            log(AGENTE, f"{ai.name}: continúo sin las mesas independientes de {', '.join(faltan)} por confirmación del usuario", "WARN")
        else:
            log(AGENTE, f"{ai.name}: están las mesas independientes de todas las tallas ({', '.join(t for t, _a, _b, _j in plan)})")
    if solo_mesas:   # fase 1 completa: las mesas de este maestro ya están revisadas
        return {"ok": True, "faltantes": [], "maestro": ai.name, "solo_mesas": True}
    if not simulado and destino.get("montajes"):   # nombre y número se aplican a TODAS las mesas que coinciden en talla, diseño y género (p. ej. Frente_ y Espalda_)
        carpetas_m = [Path(destino["montajes"]) / f"D{diseno}" / f"{ref}{genero}{suf_maestro}"]
        if genero_maestro != genero:
            carpetas_m.append(Path(destino["montajes"]) / f"D{diseno}" / f"{ref}{genero_maestro}{suf_maestro}")
        ampliado = []
        for talla, art, base, js in plan:
            if talla in faltan:
                # La persona autorizó continuar con las tallas disponibles.
                # No ejecuto JSX sobre el maestro completo ni repito errores
                # por cada prenda que pertenece a una talla inexistente.
                continue
            # Una orden puede tener varias piezas con la misma talla, diseño
            # y género (frente, espalda, mangas o archivos en más de una
            # carpeta del mismo maestro). El JSX debe pasar por TODAS; no se
            # puede detener al encontrar la primera coincidencia.
            mesas = sorted({
                mesa
                for cm in carpetas_m
                for mesa in _mesas_de(cm, talla, diseno, {art.rsplit("_Gen_", 1)[-1]})
            })
            if len(mesas) > 1:
                log(AGENTE, f"Talla {talla}: {len(mesas)} mesas coinciden en talla, diseño y género ({', '.join(mesas)}): el nombre y el número van en todas")
            # Por jugador: un solo PDF por talla, de la pieza principal («Talla_…»). Costados y Petico no se crean.
            principal = [m for m in mesas if m.startswith("Talla_")]
            if len(mesas) > 1:
                log(AGENTE, f"Talla {talla}: se usa solo la pieza principal {(principal or mesas[:1])[0]} (un PDF por jugador)")
            mesas = principal[:1] or mesas[:1]
            ampliado += [(talla, m, f"{prefijo}{m}", js) for m in mesas] or [(talla, art, base, js)]
        plan = ampliado
        esperados = [p for _, _, base, js in plan for p in _nombres_esperados(carpeta, base, js)]
        previos = [p for p in esperados if p.exists()]
        if previos and not sobrescribir:
            return {"ok": False, "existe": True, "incompleto": len(previos) != len(esperados),
                    "carpeta": str(carpeta), "n": len(previos), "esperados": len(esperados)}
    pdfs, omitidas = [], []
    if faltan:
        omitidas.extend(
            f"talla {t}: no existe mesa independiente en {ai.name}; se dejó pendiente por decisión del usuario"
            for t in faltan
        )
    codigo, ruta_bot = (None, "") if simulado else _bot_jsx()
    codigo, saltos = _parchar_saltos(codigo)
    total_plan = sum(len(js) for _, _, _, js in plan)
    log(AGENTE, f"Plan: {total_plan} PDF de producción para {ai.name}", archivo={"tipo": "plan", "pdfs": total_plan, "nombre": ai.name})
    for talla, artboard, base, jugadores in plan:
        log(AGENTE, f"PDFs de producción · {ai.name} · talla {talla}: {len(jugadores)} jugador(es)")
        if simulado:
            carpeta.mkdir(parents=True, exist_ok=True)
            for i, j in enumerate(jugadores, 1):
                f_sim = _archivo_pdf(carpeta, base, i, j)
                util.pdf_simulado(f_sim, ["PDF DE PRODUCCION SIMULADO", f"{j['cantidad']} unds sin nombre ni numero" if j.get("sufijo") else f"{j['nombre']}  #{j['numero']}", f"Talla {talla}"])
                _evento_pdf(f_sim, jugadores, talla, diseno, genero)
        else:
            # En algunos maestros de niño las mesas se llaman Gen_M o Gen_F en vez de Gen_N: se prueban esos nombres
            candidatas = [artboard]
            if genero == "N":
                sexos = [j["sexo"] for j in jugadores if j.get("sexo")]
                orden_gen = ([max(set(sexos), key=sexos.count)] if sexos else []) + ["M", "F"]
                candidatas += [f"Talla_{talla}_Tipo_D{diseno}_Gen_{x}" for x in dict.fromkeys(orden_gen)]
                candidatas = list(dict.fromkeys(candidatas))
            elif genero in ("M", "F"):   # maestro F con mesas rotuladas Gen_M (o al revés): se prueba primero la propia y luego la otra letra
                candidatas += [f"Talla_{talla}_Tipo_D{diseno}_Gen_{'F' if genero == 'M' else 'M'}"]
            # Tras la verificación/exportación obligatoria se reutiliza la
            # mesa independiente exacta. El JSX corre sobre esa copia local,
            # nunca sobre el archivo guardado en Montajes.
            fuente, usada_trabajo, mesa_independiente = ai, None, False
            for carpeta_m in carpetas_m:
                for cand in candidatas:
                    propia = carpeta_m / f"{cand}.ai"
                    if propia.exists():
                        try:
                            trabajo = _dir_trabajo(carpeta_m)
                            trabajo.mkdir(parents=True, exist_ok=True)
                            # Si la exportación dejó la copia local con imágenes ya incrustadas (y es de esta mesa), se usa esa:
                            # Montajes queda sin incrustar y aquí no se vuelve a incrustar cada vez.
                            embebida = trabajo / f"{cand}.ai"
                            origen = embebida if (embebida.is_file() and embebida.stat().st_size > 0) else propia
                            copia = trabajo / f"pdf_{int(time.time() * 1000)}_{cand}.ai"
                            shutil.copy2(origen, copia)
                            fuente, usada_trabajo = copia, copia
                            candidatas, mesa_independiente = [cand], True
                        except OSError as e:
                            omitidas.append(f"talla {talla}: no pude preparar una copia temporal de {propia.name}: {e}")
                            log(AGENTE, f"Talla {talla}: no pude copiar {propia} para el PDF: {e}", "WARN")
                        break
                if mesa_independiente:
                    break
            if not mesa_independiente:
                omitidas.append(f"talla {talla}: no existe su mesa independiente en Montajes; no ejecuté JSX")
                log(AGENTE, f"Talla {talla}: falta la mesa tras la exportación obligatoria; no ejecuto JSX", "WARN")
                continue
            log(AGENTE, f"Talla {talla}: reutilizo {fuente.name} de Montajes y ejecuto JSX")
            vigia = _VigiaCarpeta(carpeta, f"{base}_*.pdf", lambda f, js=jugadores, t=talla: _evento_pdf(f, js, t, diseno, genero))
            try:
                for cand in candidatas:
                    res = _correr_bot(codigo, fuente, cand, base, carpeta, jugadores, orden, tela, saltos)
                    if cand != artboard and not res.get("error"):
                        log(AGENTE, f"La mesa de niño de la talla {talla} se llama «{cand}» en {fuente.name}: usé esa")
                    if not (res.get("error") and "no tiene la mesa" in res["error"]):
                        break
            finally:
                vigia.parar()
                if usada_trabajo:
                    try:
                        usada_trabajo.unlink()
                    except OSError:
                        pass
            if res.get("error"):
                omitidas.append(f"talla {talla}: {res['error']}")
                continue
        for i, j in enumerate(jugadores, 1):
            f = _archivo_pdf(carpeta, base, i, j)
            if f.exists():
                pdfs.append({"ruta": str(f), "nombre": j["nombre"], "numero": j["numero"], "talla": talla, **({"cantidad": j["cantidad"]} if j.get("sufijo") else {})})
            else:
                omitidas.append(f"talla {talla}: no quedó el PDF de {j['nombre'] or j['numero'] or j.get('sufijo') or 'sin datos'}")
    unidades_extra, esperados_extra = 0, 0
    # HERMANOS: el mismo listado (talla, diseño y género) se aplica también a las demás telas de ese diseño que ya tengan sus mesas
    # (igual que Generador_PDFS.jsx). Nunca exporta mesas nuevas para un hermano: si le falta alguna talla, se avisa y no se crea.
    if not _sin_hermanos and not simulado and destino.get("montajes"):
        con_mesas, sin_mesas = _hermanos_del_maestro(destino["montajes"], diseno, ref, genero, suf_maestro, [t for t, _a, _b, _j in plan])
        for ref_h in sin_mesas:
            omitidas.append(f"hermano {ref_h}{genero}{suf_maestro}: le faltan mesas de alguna talla; no se crearon sus PDF")
            log(AGENTE, f"Hermano {ref_h}{genero}{suf_maestro}: le faltan mesas de alguna talla; no lo proceso", "WARN")
        for ref_h, mesa_h in con_mesas:
            log(AGENTE, f"Hermano {ref_h}{genero}{suf_maestro}: aplico el mismo listado (talla {', '.join(t for t, _a, _b, _j in plan)}, diseño {diseno}, género {genero})")
            r_h = pdfs_por_jugador(mesa_h, lineas, destino, orden, tela=tela, sobrescribir=sobrescribir, tela_archivo=tela_archivo,
                                   referencia=ref_h, genero_destino=genero, _sin_hermanos=True)
            if r_h.get("ok"):
                pdfs.extend(r_h["pdfs"])
                omitidas.extend(r_h.get("omitidas", []))
                esperados_extra += r_h.get("esperados", 0)
                unidades_extra += r_h.get("unidades", 0)
            else:
                omitidas.append(f"hermano {ref_h}{genero}{suf_maestro}: {r_h.get('error') or 'no se crearon PDF'}")
    if not pdfs:
        return {"ok": False, "error": "No se creó ningún PDF de producción. " + "; ".join(omitidas)}
    log(AGENTE, f"{len(pdfs)} PDF(s) de producción en {carpeta}" + (f" · con problemas: {len(omitidas)}" if omitidas else ""),
        "WARN" if omitidas else "INFO")
    return {"ok": True, "pdfs": pdfs, "carpeta": str(carpeta), "simulado": simulado,
            "omitidas": omitidas, "omitidas_autorizadas": [
                f"talla {t}: no existe mesa independiente en {ai.name}; se dejó pendiente por decisión del usuario"
                for t in faltan
            ], "pendientes_autorizados": pendientes_autorizados, "esperados": total_plan + esperados_extra,
            "unidades": sum(sum(int(j.get("cantidad", 1) or 1) for j in js) for _t, _a, _b, js in plan) + unidades_extra}


def _correr_bot(codigo, ai, artboard, base, carpeta, jugadores, orden, tela, saltos=False):
    """Abre el .ai, comprueba la mesa coincidente y ejecuta BOT.jsx solo sobre esa mesa."""
    carpeta.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.gettempdir()) / "indoor_agentes_pdf"
    tmp.mkdir(parents=True, exist_ok=True)
    abrir = ("(function(){var o=app.userInteractionLevel;app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS;"
             "var d=app.open(new File(%s));var hay=false;for(var i=0;i<d.artboards.length;i++){if(d.artboards[i].name.indexOf(%s)!==-1){hay=true;break;}}"
             "app.userInteractionLevel=o;if(!hay){d.close(SaveOptions.DONOTSAVECHANGES);return 'SIN_MESA';}return 'OK';})();") % (
        json.dumps(ai.as_posix()), json.dumps(artboard))
    # Illustrator a veces se cae o se desconecta justo después de cerrar un .ai pesado (lo documentan también en EDICION_AUTOMATICA):
    # se espera, se vuelve a conectar (relanzándolo si hace falta) y se reintenta hasta 3 veces.
    r, ultimo = None, None
    for intento in range(1, 4):
        try:
            app = illustrator.conectar(AGENTE)   # si Illustrator está cerrado lo abre como si lo abrieras tú
            illustrator.traer_al_frente()         # y se ve trabajar: ventana al frente, plantilla abierta
            r = str(app.DoJavaScript(abrir))
            break
        except Exception as e:  # noqa: BLE001
            ultimo = e
            log(AGENTE, f"Illustrator no respondió al abrir {ai.name} (intento {intento}/3): {e}", "WARN")
            time.sleep(8 * intento)
    if r is None:
        return {"error": f"Illustrator no pudo abrir {ai.name}: {ultimo}"}
    if r == "SIN_MESA":
        return {"error": f"el archivo no tiene la mesa de trabajo «{artboard}»"}
    inyeccion = (
        "var INDOOR_CSV_CONTENT = " + json.dumps(_csv_jugadores(jugadores, saltos), ensure_ascii=True) + ";\n"
        "var INDOOR_JSX_MESSAGES = [];\n"
        "var INDOOR_JSX_DIR = " + json.dumps(tmp.as_posix() + "/") + ";\n"
        "var INDOOR_CSV_PATH = \"\";\n"
        "var INDOOR_BASE_NAME = " + json.dumps(base) + ";\n"
        "var INDOOR_PDF_DIR = " + json.dumps(str(carpeta)) + ";\n"
        "var INDOOR_AI_NAME = " + json.dumps(ai.stem) + ";\n"
        "var INDOOR_ORDEN = " + json.dumps(str(orden or "")) + ";\n"
        "var INDOOR_TELA = " + json.dumps(str(tela or "")) + ";\n"
        "var INDOOR_PERMITIR_SIN_GUIAS = " + ("true" if not any((j.get("nombre") or "").strip() or str(j.get("numero") or "").strip() for j in jugadores) else "false") + ";\n"
        "var INDOOR_ARTBOARD_NAME = " + json.dumps(artboard) + ";\n"
        "var INDOOR_ROW_TARGET = undefined;\n"
        "var INDOOR_TMP_DIR = " + json.dumps(tmp.as_posix()) + ";\n")
    try:
        mensajes = str(app.DoJavaScript(inyeccion + codigo + '\nINDOOR_JSX_MESSAGES.join("\\n");'))
    except Exception as e:  # noqa: BLE001
        _cerrar_si_abierto(app, ai)
        return {"error": f"Illustrator falló al aplicar nombre y número: {e}"}
    for linea in mensajes.splitlines():
        log(AGENTE, "[JSX] " + linea, "ERROR" if "ERROR" in linea else "INFO")
    _cerrar_si_abierto(app, ai)   # BOT.jsx ya lo cierra; esto solo cubre un fallo a medias
    sin_guias = ("no se encontro ningun placeholder" in mensajes.lower()
                  or "no conserva los textos guía" in mensajes.lower())
    requiere_personalizacion = any((j.get("nombre") or "").strip() or str(j.get("numero") or "").strip() for j in jugadores)
    if sin_guias:
        # Sin guías NOMBRE/00 el PDF se conserva tal cual (decisión: no bloquear el pedido).
        # Si la orden pedía nombre o número, queda marcado en el registro para revisarlo.
        if requiere_personalizacion:
            log(AGENTE, f"{ai.name}: sin guías NOMBRE/00 y la talla pedía nombre o número: el PDF sale SIN personalizar, revisar", "WARN")
        else:
            log(AGENTE, f"{ai.name}: sin guías NOMBRE/00, pero la talla no tiene personalización; conservo el PDF de producción")
    time.sleep(0.3)               # pausa mínima tras cerrar un .ai pesado antes de abrir el siguiente
    return {"mensajes": mensajes}


def _cerrar_si_abierto(app, ai):
    try:
        app.DoJavaScript("(function(){for(var i=app.documents.length-1;i>=0;i--){if(app.documents[i].name==%s){app.documents[i].close(SaveOptions.DONOTSAVECHANGES);}}return 'ok';})();" % json.dumps(ai.name))
    except Exception:  # noqa: BLE001
        pass
