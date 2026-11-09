"""TAVO (coordinador): único agente que habla con el usuario. Decide quién actúa y en qué orden.

Flujo operativo: INICIO -> OLVER (mesas) -> JUGADORES (OLIVER) -> PDF de producción -> TERRY (MTS y Google Sheets) -> FIN.
La muestra es opcional y solo se crea cuando se pide expresamente; nunca bloquea edición.
"""
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

import config
from agents import draco, jack, leo, oliver, olver, stickers, terry
from core import seleccion, telas
from core import db, ordenes
from core import log as registro
from core.log import log

AGENTE = "TAVO"
SESIONES = {}

SI = {"si", "sí", "s", "ok", "dale", "confirmo", "confirmado", "yes", "claro"}
NO = {"no", "n", "cancela esto"}
APROBADA = {"aprobada", "aprobado", "aprobar", "apruebo", "la aprobó", "ok", "si", "sí"}
RECHAZADA = {"rechazada", "rechazado", "rechazar", "no", "corregir"}
ALIAS = {"ref": "referencia", "referencia": "referencia", "cliente": "cliente", "archivo": "archivo",
         "ruta": "archivo", "ai": "archivo", "path": "archivo", "formato": "formato"}


def _nueva():
    return {"estado": "INICIO", "pedido": {"formato": "ai"}, "pend": None, "texto_jugadores": "",
            "jugadores": [], "solo_mesas": False, "opciones": [], "leo": None}


def _r(texto, estado, botones=None):
    return {"respuesta": texto, "estado": estado, "botones": botones or []}


def _err(que, causa, que_hacer="", estado="ERROR", botones=None):
    """Respuesta de error con formato único: qué falló, la CAUSA y qué hacer. Todo error que vea la persona debe decir su causa.
    `estado`: ERROR cuando la orden se detiene; o el estado en que queda esperando (APROBACION, JUGADORES…) cuando se puede reintentar ahí mismo."""
    causa = str(causa or "").strip() or "no quedó registrada la causa: revisa el registro (pestaña AGENTES) con la hora de este mensaje"
    texto = f"ERROR: {que}\n\nCausa: {causa}"
    if que_hacer:
        texto += f"\n\nQué hacer: {que_hacer}"
    return _r(texto, estado, botones)


def _causa_exc(e):
    """Causa legible de una excepción: tipo, mensaje y el punto del código de los agentes donde ocurrió."""
    import traceback
    donde = ""
    for marco in reversed(traceback.extract_tb(e.__traceback__)):
        if "agentes" in marco.filename.lower() or "agents" in marco.filename.lower() or "core" in marco.filename.lower():
            donde = f" (en {Path(marco.filename).name}, línea {marco.lineno}, {marco.name})"
            break
    return f"{type(e).__name__}: {e}{donde}"


def _parse_kv(texto):
    datos = {}
    for parte in re.split(r"[\n;]", texto):
        m = re.match(r"^\s*([A-Za-záéíóúñ]+)\s*[:=]\s*(.+?)\s*$", parte)
        if m and m.group(1).lower() in ALIAS:
            datos[ALIAS[m.group(1).lower()]] = m.group(2).strip().strip('"')
    return datos


def _clave(p):
    return f"{p['orden']}_{p['cliente']}_{p['referencia']}" if p.get("orden") else f"{p['cliente']}_{p['referencia']}"


# ---------------------------------------------------------------- entrada
def responder(sesion, texto, orden=None):
    """Punto de entrada del chatbot. Además de la respuesta informa qué agentes se activaron."""
    antes = registro.total()
    r = _responder(sesion, texto, orden)
    activos = ["TAVO"]
    for linea in registro.desde(antes):
        partes = linea.split(" | ")
        if len(partes) > 1 and partes[1].strip() not in activos:
            activos.append(partes[1].strip())
    r["agentes"] = activos
    _adjuntar_listado(sesion, r)
    return r


def _adjuntar_listado(sesion, r):
    """El panel muestra en el centro el listado que leyó LEO: va en la primera respuesta después de leerlo (haya o no muestra) y de nuevo si cambia."""
    try:
        s = SESIONES.get(sesion) or {}
        fila = s.get("leo")
        if r.get("tabla") or not fila or not fila.get("lineas"):
            if r.get("tabla"):
                s["listado_enviado"] = repr(r["tabla"].get("filas"))
            return
        tabla = leo.tabla(fila)
        firma = repr((tabla or {}).get("filas"))
        if tabla and s.get("listado_enviado") != firma:
            r["tabla"] = tabla
            s["listado_enviado"] = firma
    except Exception:  # noqa: BLE001
        pass   # el listado en pantalla es opcional: nunca debe dañar la respuesta


def _responder(sesion, texto, orden=None):
    s = SESIONES.setdefault(sesion, _nueva())
    t = (texto or "").strip()
    tl = t.lower()
    # Orden activa (la que fijó la persona en el panel): si pide algo sin decir la orden, se hace con esa
    if orden and s["estado"] in ("INICIO", "FIN") and t and not ordenes.codigo_en(t) and _intencion(tl):
        t = f"{t} de la orden {orden}"
        tl = t.lower()
        log(AGENTE, f"Uso la orden activa {orden}")
    try:
        if tl in ("cancelar", "reiniciar", "reset"):
            SESIONES[sesion] = _nueva()
            log(AGENTE, "Sesión reiniciada")
            return _r("Listo, reinicié. Envíame los datos del nuevo pedido.", "INICIO")
        if s["estado"] in ("FIN", "ERROR"):
            # Un error terminal conserva el diagnóstico en el chat, pero no debe
            # bloquear el siguiente intento: antes buscaba un manejador ERROR que
            # no existe y producía KeyError al pedir «reprocesar».
            s = SESIONES[sesion] = _nueva()
        if s["estado"] in ("INICIO", "FIN") and draco.es_para_draco(t):   # «draco …»: el agente de trazos (solo corre en el PC AUTOMATIZACION)
            return draco.atender(t)
        if s["estado"] == "JUGADORES" and re.search(r"\borden\b", tl) and ordenes.codigo_en(t):
            s["estado"] = "INICIO"  # pidió otra orden: no es una lista de jugadores
        manejadores = {
            "INICIO": _inicio, "CONFIRMAR": _confirmar, "APROBACION": _aprobacion, "REPRO": _repro,
            "JUGADORES": _jugadores, "TALLA_RARA": _talla_rara, "CONFIRMAR_TALLAS_MESAS": _confirmar_tallas_mesas,
            "CONFIRMAR_SHEETS": _sheets, "ELEGIR_AI": _elegir_ai,
            "ELEGIR_PROYECTO": _elegir_proyecto, "ELEGIR_PESTANA": _elegir_pestana,
        }
        if re.search(r"cambiar (de )?pesta", tl):   # volver a elegir la pestaña (referencia) del listado
            s.pop("pestana_sel", None)
            return _r("Listo: en la próxima acción directa te pregunto qué pestaña ejecutar.", s["estado"] if s["estado"] != "ELEGIR_PESTANA" else "INICIO")
        return manejadores[s["estado"]](s, t)
    except Exception as e:  # noqa: BLE001
        log(AGENTE, f"Error inesperado: {_causa_exc(e)}", "ERROR")
        return _err("tuve un error interno y no terminé lo que pediste.", _causa_exc(e), "Escribe «cancelar» para reiniciar y vuelve a intentarlo; si se repite, avisa con este mensaje.", s["estado"])


# ---------------------------------------------------------------- estados
_SIN_MUESTRA = r"sin\s+(la\s+|las\s+)?muestras?"   # «Pedido completo sin muestra de la orden CO7890»
_SOLO_DISENO = r"solo\s+(?:el\s+|la\s+)?(?:dise\w?o|d)\s*(\d+)"   # «Pedido completo de la orden CO6190 solo diseño 2»: la muestra es solo de ese diseño


def _intencion(tl):
    if re.search(r"reproces|rehac|rehaz|volver a (hacer|procesar|correr)|de nuevo toda", tl):
        return "reproceso"
    if re.search(_SIN_MUESTRA, tl):   # se ejecuta el pedido completo saltándose la muestra (y su aprobación), aunque el maestro la tenga
        return "completo"
    if re.search(r"\bjugadores\b", tl):
        return "jugadores"
    if re.search(r"\bmts\b|consumo|promedio", tl):
        return "mts"
    if re.search(r"sticker", tl):
        return "stickers"
    if re.search(r"mesa|export", tl):
        return "mesas"
    if re.search(r"muestra|pdf", tl):
        return "muestra"
    if re.search(r"listado|\blee\b|\bleer\b|lectura|revis|qu[eé] (dice|tiene|trae)|informaci|detalle|desgl|resumen|consult|observaci", tl):
        return "listado"
    if re.search(r"complet|todo|flujo|pedido|empie|inici|arranc|procesa", tl):
        return "completo"
    return None


def _inicio(s, t):
    tl = t.lower()
    if tl == "jugadores" and s["pedido"].get("cliente"):
        if s.get("leo"):
            return _jugadores_desde_listado(s)
        s["estado"] = "JUGADORES"
        return _r("Listo, envíame la lista de jugadores.\n" + _AYUDA_LISTA, "JUGADORES")
    kv = _parse_kv(t)
    if "cliente" in kv:  # datos manuales: no arrastrar la orden anterior
        s["pedido"].pop("orden", None)
        s["leo"] = None
    s["pedido"].update(kv)
    p = s["pedido"]
    faltan = [k for k in ("cliente", "referencia", "archivo") if not p.get(k)]
    cod = ordenes.codigo_en(t)
    if cod and not kv:
        return _por_orden(s, cod, tl)
    if faltan:
        return _r(
            "Dime la orden, por ejemplo: «expórtame las mesas de la orden CO7890», "
            "o envíame los datos así:\ncliente: Club Ejemplo\nreferencia: FUT01\narchivo: C:\\Disenos\\club.ai",
            "INICIO",
        )
    s["solo_mesas"] = False
    s["repro"] = None
    log(AGENTE, f"Nuevo pedido {_clave(p)} → exporto mesas sin depender de muestra")
    return _exportar_mesas(s, False)


def _por_orden(s, cod, tl):
    intent = _intencion(tl)
    s["pedido"] = {"formato": "ai"}  # orden nueva: no arrastrar datos de la anterior; las mesas salen en .ai por defecto
    s["aviso"], s["leo"], s["repro"] = "", None, None
    if "ambos" in tl or re.search(r"pdf\s*(y|\+)\s*png|png\s*(y|\+)\s*pdf", tl):
        s["pedido"]["formato"] = "ambos"
    elif "png" in tl:
        s["pedido"]["formato"] = "png"
    elif ("mesa" in tl or "export" in tl) and re.search(r"\bpdf\b", tl):
        s["pedido"]["formato"] = "pdf"
    if not intent:
        return _r(f"Orden {cod}. ¿Qué hago con ella?", "INICIO",
                  [f"Ver listado de {cod}", f"Exportar mesas de {cod}", f"Crear muestra de {cod}", f"Pedido completo {cod}", f"Reprocesar {cod}"])
    s["intencion"] = intent
    # Muestra opcional: un pedido completo o reproceso no espera ni exige
    # archivo MUESTRA. JACK solo se activa mediante «Crear muestra».
    s["sin_muestra"] = intent in ("completo", "reproceso") or bool(re.search(_SIN_MUESTRA, tl))
    _m_dis = re.search(_SOLO_DISENO, tl)
    s["solo_diseno"] = int(_m_dis.group(1)) if _m_dis else None   # pestaña D1/D2 elegida en el panel
    s["es_auto"] = "inicio autom" in tl or "(automático" in tl   # los pedidos que manda la página solos (MTS al programar, al terminar EDICIÓN) no preguntan la pestaña: van con todas
    # Regla: SIEMPRE se le pide a LEO que lea el listado antes de activar a cualquier otro agente.
    log(AGENTE, f"Orden {cod}: le pido a LEO que lea el listado")
    r = leo.leer_orden(cod)
    if not r["ok"]:
        return _err(f"LEO no pudo leer el listado de la orden {cod}. No activé ningún otro agente.", r["error"], "Revisa el Excel del listado en la carpeta de la orden y que el código esté bien escrito.")
    filas = r["proyectos"]
    if len(filas) > 1:
        s["filas"], s["cod"], s["estado"] = filas, cod, "ELEGIR_PROYECTO"
        lista = "\n".join(f"{i}. {f['cliente']} · {f['proyecto']} ({len(f['lineas'])} líneas)" for i, f in enumerate(filas, 1))
        return _r(f"LEO encontró {len(filas)} proyectos en la orden {cod}. ¿Cuál hago? (responde el número)\n{lista}",
                  "ELEGIR_PROYECTO")
    return _con_listado(s, cod, filas[0])


def _elegir_proyecto(s, t):
    if t.isdigit() and 1 <= int(t) <= len(s["filas"]):
        return _con_listado(s, s["cod"], s["filas"][int(t) - 1])
    return _r(f"Responde un número del 1 al {len(s['filas'])} (o «cancelar»).", "ELEGIR_PROYECTO")


def _solo_en_proceso(cod, fila):
    """Deja solo las líneas de las referencias que están en proceso de EDICIÓN en Producción (las demás referencias del listado no se ejecutan).
    Si el panel no responde o ninguna está en proceso, no se filtra nada."""
    try:
        import puente
        cfg = puente._leer_config()
        if not cfg:
            return fila
        refs = puente._post_firme(cfg, "/api/agentes/pc/referencias-proceso", {"orden": cod}, timeout=30, intentos=2).get("referencias") or []
    except Exception as e:  # noqa: BLE001
        log(AGENTE, f"No pude consultar qué referencias están en proceso: {e}", "WARN")
        return fila
    if not refs:
        return fila
    permitidas = seleccion.referencias_del_listado([{"hoja": r} for r in refs])
    lineas = [l for l in fila["lineas"] if seleccion.referencias_del_listado([l]) & permitidas]
    if not lineas or len(lineas) == len(fila["lineas"]):
        return fila
    omitidas = sorted({str(l.get("hoja", "")) for l in fila["lineas"]} - {str(l.get("hoja", "")) for l in lineas})
    log(AGENTE, f"Producción tiene en proceso {', '.join(refs)}: ignoro las demás referencias del listado ({', '.join(omitidas)})")
    return {**fila, "lineas": lineas}


ACCIONES_DIRECTAS = ("listado", "mts", "mesas", "muestra", "jugadores", "stickers")


def _hojas_de(fila):
    """Pestañas (hojas = referencias) del listado con su número de líneas, en el orden en que aparecen."""
    cuenta = {}
    for l in fila.get("lineas", []):
        h = str(l.get("hoja", "")).strip()
        if h:
            cuenta[h] = cuenta.get(h, 0) + 1
    return list(cuenta.items())


def _solo_hoja(fila, hoja):
    return {**fila, "lineas": [l for l in fila["lineas"] if str(l.get("hoja", "")).strip() == hoja]}


def _elegir_pestana(s, t):
    cod, fila, hojas = s["pestana_pend"]
    tl = t.strip().lower()
    todas, eleccion = False, None
    if tl in ("todas", "todo", "todos") or (tl.isdigit() and int(tl) == len(hojas) + 1):
        todas = True
    elif tl.isdigit() and 1 <= int(tl) <= len(hojas):
        eleccion = hojas[int(tl) - 1][0]
    else:
        eleccion = next((h for h, _ in hojas if tl == h.lower() or (tl and tl in h.lower())), None)
    if not todas and not eleccion:
        return _r(f"No entendí. Responde el número de la pestaña (1 a {len(hojas) + 1}) o su nombre.", "ELEGIR_PESTANA", [h for h, _ in hojas] + ["Todas"])
    s.pop("pestana_pend", None)
    s["estado"], s["pestana_ok"], s["pestana_sel"] = "INICIO", True, (cod, eleccion)
    log(AGENTE, f"Pestaña elegida para {cod}: {eleccion or 'todas'}")
    return _con_listado(s, cod, _solo_hoja(fila, eleccion) if eleccion else fila)


def _con_listado(s, cod, fila):
    p = s["pedido"]
    eligio = s.pop("pestana_ok", None)
    if not eligio and not s.get("es_auto"):
        # SIEMPRE, sea cual sea el proceso a ejecutar, se pregunta qué pestaña del Excel se trabaja cuando el listado trae varias
        # (sobre TODAS las pestañas del listado, no solo las que están en proceso). El inicio automático es el único que no pregunta.
        hojas = _hojas_de(fila)
        if len(hojas) > 1:
            s["estado"], s["pestana_pend"] = "ELEGIR_PESTANA", (cod, fila, hojas)
            lista = "\n".join(f"{i}. {h} ({n} líneas)" for i, (h, n) in enumerate(hojas, 1)) + f"\n{len(hojas) + 1}. Todas"
            log(AGENTE, f"La orden {cod} tiene {len(hojas)} pestañas: pregunto cuál ejecutar")
            return _r(f"La orden {cod} tiene {len(hojas)} pestañas (referencias) en el Excel del listado. ¿Cuál ejecutamos? (responde el número o el nombre)\n{lista}",
                      "ELEGIR_PESTANA", [h for h, _ in hojas] + ["Todas"])
    if not eligio:   # sin elección de la persona (inicio automático o una sola pestaña): solo las referencias que Producción tiene en proceso
        fila = _solo_en_proceso(cod, fila)
    p.update(orden=cod, cliente=fila["cliente"], referencia=fila["proyecto"])
    s["leo"] = fila
    ordenes.pista_referencias(cod, seleccion.referencias_del_listado(fila.get("lineas") or []))   # para ubicar el maestro por referencia
    s["aviso"] = leo.resumen(fila)
    log(AGENTE, f"LEO informó: {cod} = cliente {fila['cliente']} / proyecto {fila['proyecto']}")
    # Esta consulta es la fuente de verdad para TODOS los caminos: muestra,
    # mesas, jugadores o pedido completo. No se permite adivinar la estructura
    # por el nombre de un .ai cuando Promedios Maestros no responde.
    try:
        s["plantillas_promedios"] = sorted(_plantillas_promedios(fila["lineas"]))
    except RuntimeError as e:
        return _err(f"No inicié {cod}: no pude validar la estructura en Promedios maestros.", str(e),
                    "Completa o corrige la estructura en Promedios maestros y vuelve a iniciar la orden.",
                    "ERROR", [f"Ver listado {cod}"])
    if s["intencion"] == "jugadores":   # OLIVER: valida tallas, números y nombres de la pestaña elegida y crea el PDF de producción de cada jugador
        s["estado"] = "INICIO"
        rutas = ordenes.buscar_ai(cod)
        plantillas = set(s["plantillas_promedios"])
        sel, motivo = seleccion.mesas_para(rutas, fila["lineas"], plantillas) if rutas else ([], "no encontré archivos .ai en MAESTROS")
        if not sel:
            # sin saber de qué mesas salen los jugadores NO se crea nada ni se da el pedido por terminado
            log(AGENTE, f"Jugadores de {cod}: no pude elegir las mesas ({motivo})", "WARN")
            return _err(f"NO creé los PDF de los jugadores de {cod}: no pude elegir las mesas del maestro.", motivo, "Corrige el listado o el maestro y vuelve a intentarlo.", "ERROR", [f"Exportar mesas de {cod}"])
        p["mesas_ai"] = [str(x) for x in sel]
        p["archivo"] = str(sel[0])
        s["destinos_prod"] = {ai: d for ai, d in ((ai, ordenes.destino_impresion(cod, ai)) for ai in p["mesas_ai"]) if d}
        s["pdfs_pendientes"] = True
        log(AGENTE, f"Jugadores de {cod}: creo los PDF de producción de " + ", ".join(Path(x).name for x in sel))
        return _jugadores_desde_listado(s)
    if s["intencion"] == "listado":
        s["estado"] = "INICIO"
        log("LEO", f"Desglose de {cod}: {len(fila['lineas'])} piezas (nombre, talla, número, diseño, género, observaciones)")
        r = _r(s["aviso"] + "\n\n" + leo.desglose(fila), "INICIO", [f"Exportar mesas de {cod}", f"Pedido completo {cod}", "Jugadores"])
        r["tabla"] = leo.tabla(fila)  # el panel la dibuja como tabla; la página local sigue mostrando el texto
        return r
    if s["intencion"] == "mts":   # TERRY: promedio por talla × cantidad del listado -> botón «Ingresar MTS» de la tarjeta
        s["estado"] = "INICIO"
        r = terry.mts_requeridos(cod, fila["lineas"])
        return _r(s["aviso"] + "\n\n" + r["texto"], "INICIO", [f"Pedido completo {cod}", f"Exportar mesas de {cod}"])
    if s["intencion"] == "stickers":   # TERRY: sticker de producción de cada referencia (plantilla Acumulado_2026.ai + STICKER_BOT.jsx)
        s["estado"] = "INICIO"
        ais = ordenes.buscar_ai(cod)
        info = ordenes.destino_impresion(cod, str(ais[0])) if ais else None
        r = stickers.crear(cod, fila["cliente"], fila["proyecto"], fila["lineas"], (info or {}).get("maquina", ""))
        nota_maq = stickers.poner_maquina(cod, fila["lineas"], (info or {}).get("maquina", ""))
        if nota_maq:
            r["texto"] += "\n" + nota_maq
        resp = _r(s["aviso"] + "\n\n" + r["texto"], "INICIO", [f"Pedido completo {cod}", f"Exportar mesas de {cod}"])
        resp["archivos"] = r["archivos"]
        return resp
    if s["intencion"] == "reproceso" and not s.get("repro"):   # orden ya procesada antes: ¿se rehace todo o se conserva lo que existe?
        s["estado"], s["repro_pend"] = "REPRO", (cod, fila)
        return _r(s["aviso"] + f"\n\nVoy a reprocesar la orden {cod}. ¿Cómo lo hago?\n"
                  "• Reemplazar todo: rehago las mesas y los PDF de producción.\n"
                  "• Conservar lo que ya existe: no toco nada de lo que ya está creado y sigo con lo que falte "
                  "sin depender de muestras.", "REPRO", ["Reemplazar todo", "Conservar lo que ya existe"])
    muestra = s["intencion"] in ("muestra", "completo", "reproceso")
    # Si se pidió una muestra explícitamente, sale del archivo MUESTRA; las mesas siempre salen de los .ai del maestro.
    rutas = ordenes.buscar_muestra(cod) if muestra else ordenes.buscar_ai(cod)
    if not muestra and rutas:
        sel, motivo = seleccion.mesas_para(rutas, fila["lineas"])
        if sel:
            p["mesas_ai"] = [str(x) for x in sel]
            p["archivo"] = str(sel[0])
            s["estado"], s["solo_mesas"] = "INICIO", True
            log(AGENTE, f"Según el listado exporto {len(sel)} archivos: " + ", ".join(x.name for x in sel))
            r = _exportar_mesas(s, False)
            r["respuesta"] = s["aviso"] + "\n\nSegún el listado exporto:\n" + "\n".join("• " + x.name for x in sel) + "\n\n" + r["respuesta"]
            return r
        log(AGENTE, f"No pude elegir las mesas por el listado: {motivo}", "WARN")
        s["aviso"] += f"\n\n(No pude elegir las mesas solo con el listado: {motivo})"
    if len(rutas) > 1 and not muestra:  # si el nombre del proyecto aparece en la ruta, eso desempata
        clave = re.sub(r"[\W_]+", "", fila["proyecto"]).lower()
        filtradas = [r for r in rutas if clave and clave in re.sub(r"[\W_]+", "", str(r)).lower()]
        rutas = filtradas or rutas
    if (not rutas or s.get("sin_muestra")) and muestra and s["intencion"] in ("completo", "reproceso") and p.get("orden"):
        # Sin archivo MUESTRA (o si la persona pidió «sin muestra») el pedido no se detiene: no hay muestra que aprobar y se sigue con las mesas y los PDF
        nota = ("Pediste ejecutar SIN muestra: no la creo ni espero aprobación, paso directo a las mesas y los PDF de producción." if s.get("sin_muestra") and rutas
                else "No encontré el archivo MUESTRA en MAESTROS: sigo sin muestra y paso directo a las mesas y los PDF de producción.")
        log(AGENTE, f"Orden {p['orden']}: {nota}", "WARN")
        s["aviso"] += "\n\n" + nota
        p["muestra_ai"] = p["muestras_ai"] = None
        s["estado"], s["solo_mesas"] = "INICIO", False
        r = _mesas_tras_muestra(s, "Sigo sin muestra.", "INICIO", [f"Exportar mesas de {p['orden']}"])
        r["respuesta"] = s["aviso"] + "\n\n" + r["respuesta"]
        return r
    if not rutas:
        donde = "; ".join(str(r) for r in config.ORDENES_DIRS) or "(ninguna carpeta configurada)"
        r = _err("no encontré el " + ("archivo MUESTRA (.ai) del proyecto" if muestra else "archivo .ai de esa orden") + ".",
                 ("En la carpeta MAESTROS del proyecto no hay ningún .ai con la palabra MUESTRA en el nombre" if muestra else "No hay ningún .ai de esa orden en las carpetas de clientes") + f". Busqué en: {donde}",
                 "Guarda el archivo en la carpeta MAESTROS del proyecto, o dime la ruta así: archivo: C:\\ruta\\diseno.ai")
        r["respuesta"] = (s["aviso"] + "\n\n" if s.get("aviso") else "") + r["respuesta"]
        return r
    if muestra:  # la muestra se hace de los archivos MUESTRA de los diseños que pide el listado (sin preguntar cuál)
        rutas, omitidos = seleccion.filtrar_por_diseno(rutas, fila["lineas"])
        if omitidos:
            nota = f"El listado solo pide DISEÑO {', '.join(map(str, sorted(seleccion.disenos_de(fila['lineas']))))}: no hago la muestra de " + ", ".join(f"D{d}" for d in omitidos) + "."
            log(AGENTE, nota)
            s["aviso"] += "\n" + nota
        rutas, sin_ref = seleccion.filtrar_por_referencia(rutas, fila["lineas"])
        if sin_ref:
            nota = "El listado no trae las referencias " + ", ".join(sin_ref) + ": no hago su muestra."
            log(AGENTE, nota)
            s["aviso"] += "\n" + nota
        if not rutas:
            referencias = sorted(seleccion.referencias_del_listado(fila["lineas"]))
            pedido = ", ".join(referencias) or "seleccionada"
            nota = (f"No encontré archivo MUESTRA para {pedido}: no usaré una muestra de otra referencia. "
                    "Sigo automáticamente sin muestra con mesas y PDF de producción.")
            log(AGENTE, nota, "WARN")
            s["aviso"] += "\n" + nota
            p["muestra_ai"] = p["muestras_ai"] = None
            s["estado"], s["solo_mesas"] = "INICIO", False
            r = _mesas_tras_muestra(s, "Sigo sin muestra.", "INICIO", [f"Exportar mesas de {p['orden']}"])
            r["respuesta"] = s["aviso"] + "\n\n" + r["respuesta"]
            return r
        solo = s.get("solo_diseno")
        if solo:   # el usuario eligió una pestaña (D1, D2…): solo se hace la muestra de ese diseño
            propias = [r for r in rutas if seleccion.diseno_del_archivo(r.name) == solo]
            if not propias:
                hay = sorted({seleccion.diseno_del_archivo(r.name) for r in rutas if seleccion.diseno_del_archivo(r.name)})
                return _err(f"no hay archivo MUESTRA del diseño {solo} en el maestro de la orden {p['orden']}.",
                            "Los archivos MUESTRA que encontré son de: " + (", ".join(f"D{d}" for d in hay) or "ningún diseño"),
                            "Elige otra pestaña (o «Todas») o crea el archivo MUESTRA de ese diseño en MAESTROS.")
            nota = f"Solo hago la muestra del DISEÑO {solo} (la pestaña que elegiste)."
            log(AGENTE, nota)
            s["aviso"] += "\n" + nota
            rutas = propias
        p["muestras_ai"] = [str(r) for r in rutas]
        p["archivo"] = str(rutas[0])
        s["estado"], s["solo_mesas"] = "INICIO", False
        log(AGENTE, f"Orden {p['orden']}: activo a JACK con {len(rutas)} archivos MUESTRA")
        r = _generar_muestra(s, sobrescribir=False)
        r["respuesta"] = s["aviso"] + "\n\n" + r["respuesta"]
        return r
    if len(rutas) > 1:
        s["opciones"], s["estado"] = rutas, "ELEGIR_AI"
        lista = "\n".join(f"{i}. {r}" for i, r in enumerate(rutas, 1))
        return _r(f"{s['aviso']}\n\nEncontré {len(rutas)} archivos .ai. ¿Cuál uso? (responde el número)\n{lista}", "ELEGIR_AI")
    return _arrancar_orden(s, rutas[0])


def _elegir_ai(s, t):
    if t.isdigit() and 1 <= int(t) <= len(s["opciones"]):
        if s.pop("tras_muestra", False):
            s["pedido"]["archivo"] = str(s["opciones"][int(t) - 1])
            s["estado"] = "INICIO"
            return _exportar_mesas(s, False)
        return _arrancar_orden(s, s["opciones"][int(t) - 1])
    return _r(f"Responde un número del 1 al {len(s['opciones'])} (o «cancelar»).", "ELEGIR_AI")


def _arrancar_orden(s, ai):
    ai = Path(ai)
    p = s["pedido"]
    p["archivo"] = str(ai)
    s["estado"] = "INICIO"
    if s["intencion"] == "mesas":
        s["solo_mesas"] = True
        log(AGENTE, f"Orden {p['orden']}: activo a OLVER (solo exportar mesas) con {ai.name}")
        r = _exportar_mesas(s, False)
    else:
        s["solo_mesas"] = False
        p["muestra_ai"] = str(ai)
        log(AGENTE, f"Orden {p['orden']}: activo a JACK (muestra) con {ai.name}")
        r = _generar_muestra(s, sobrescribir=False)
    r["respuesta"] = s["aviso"] + "\n\n" + r["respuesta"]
    return r


def _campos_muestra(p, ai, leo_fila=None):
    """Datos que JACK escribe en la plantilla MUESTRA: cliente (LEO), máquina (JPG del maestro) y fecha de hoy.
    Quedan sin tocar: RESPONSABLE, CALANDRA, TELA (aún sin fuente de datos) y el NOMBRE / 00 de ejemplo."""
    campos = {"NOMBRE CLIENTE": p["cliente"], "FECHA DE EJECUCION": datetime.now().strftime("%d/%m/%Y")}
    # TELA: el código va en la referencia del pedido (hoja «A200FUT02» = tela 200); el nombre sale de datos/telas_codigos.json
    ref_ai = ordenes.destino_impresion(p["orden"], ai) if p.get("orden") and not ordenes.simulado() else None
    tela_hoja = telas.tela_de_hojas([l.get("hoja", "") for l in (leo_fila or {}).get("lineas", [])], (ref_ai or {}).get("ref", ""))
    if tela_hoja:
        campos["TELA"] = tela_hoja
    if p.get("orden") and not ordenes.simulado():
        info = ordenes.destino_impresion(p["orden"], ai)
        if info:
            campos["MAQUINA IMPRESION"] = info["maquina"]
            if not tela_hoja and telas.configurado():
                tela = telas.tela_de(info.get("ref") or "")
                if tela:
                    campos["TELA"] = tela
                else:
                    log(AGENTE, f"No encontré la tela de {info.get('ref')} en el Sheets: dejo el campo TELA sin llenar", "WARN")
        else:
            log(AGENTE, "No pude saber la máquina por los JPG del maestro: dejo el campo sin llenar", "WARN")
    return campos


def _repro(s, t):
    """Respuesta a «¿reemplazo todo o conservo lo que ya existe?» del reproceso."""
    tl = t.lower()
    if "reempl" in tl or tl in SI:
        s["repro"] = "reemplazar"
    elif "conserv" in tl or tl in NO:
        s["repro"] = "conservar"
    else:
        return _r("Elige una opción: «Reemplazar todo» o «Conservar lo que ya existe».", "REPRO", ["Reemplazar todo", "Conservar lo que ya existe"])
    cod, fila = s.pop("repro_pend")
    s["intencion"] = "completo"
    log(AGENTE, f"Reproceso de {cod}: " + ("reemplazo todo lo anterior" if s["repro"] == "reemplazar" else "conservo lo que ya existe y sigo con lo que falte"))
    return _con_listado(s, cod, fila)


def _generar_muestra(s, sobrescribir, conservar=False):
    sobrescribir = sobrescribir or s.get("repro") == "reemplazar"
    conservar = conservar or s.get("repro") == "conservar"
    p = s["pedido"]
    archivos = p.get("muestras_ai") or [p.get("muestra_ai") or p["archivo"]]
    multiple = len(archivos) > 1 or bool(p.get("muestras_ai"))
    pdfs, simulado, conservadas, fallidas = [], False, 0, []
    for ai in archivos:
        r = jack.crear_muestra(p["cliente"], p["referencia"], ai, sobrescribir, orden=p.get("orden"),
                               nombre="archivo" if multiple else None, campos=_campos_muestra(p, ai, s.get("leo")))
        if r.get("existe"):   # ya hay muestra: no se reemplaza ni se pregunta (solo «Reemplazar todo» del reproceso la rehace); sigue hasta tu aprobación
            log(AGENTE, f"JACK: conservo la muestra que ya existía: {r['pdf']}")
            pdfs.append(r["pdf"]); conservadas += 1
            continue
        if not r["ok"]:
            if s.get("intencion") in ("completo", "reproceso") and p.get("orden"):
                # Pedido completo: una muestra que no se puede crear (plantilla sin los textos, archivo dañado…) NO detiene la orden.
                # Se avisa con su causa y se sigue con las mesas y los PDF de producción (pedido del usuario, 2026-10-13).
                log(AGENTE, f"JACK no pudo crear la muestra de {Path(str(ai)).name}: {r['error']}. Sigo sin esa muestra", "WARN")
                fallidas.append(f"{Path(str(ai)).name}: {r['error']}")
                continue
            s["estado"] = "INICIO"
            return _err("JACK no pudo crear la muestra.", r["error"], "Corrige el dato (por ejemplo «archivo: ...») y vuelve a iniciar la orden.")
        pdfs.append(r["pdf"])
        simulado = simulado or r.get("simulado")
    if fallidas and not pdfs:   # no quedó ninguna muestra que aprobar: se pasa directo a las mesas y los PDF
        nota = ("⚠ JACK no pudo crear la muestra, así que sigo SIN muestra y paso directo a las mesas y los PDF de producción.\n"
                "Causa: " + "\n".join(fallidas) + "\n(Si quieres la muestra, corrige esa plantilla en el maestro y pide «Crea la muestra de la orden».)")
        p["muestra_ai"] = p["muestras_ai"] = None
        s["estado"], s["solo_mesas"] = "INICIO", False
        sig = _mesas_tras_muestra(s, "Sigo sin muestra.", "INICIO", [f"Exportar mesas de {p['orden']}"])
        sig["respuesta"] = nota + "\n\n" + sig["respuesta"]
        return sig
    db.guardar_pedido(_clave(p), p["cliente"], p["referencia"], p["archivo"])
    s["estado"] = "APROBACION"
    nota = " (simuladas: sin Illustrator)" if simulado else ""
    lista = "\n".join(pdfs)
    titulo = f"JACK creó {len(pdfs)} muestras{nota}:" if len(pdfs) > 1 else f"JACK creó la muestra{nota}:"
    if conservadas:
        titulo = (f"Conservé {'la muestra que ya existía' if len(pdfs) == 1 else f'{conservadas} muestra(s) que ya existían'} ({'no la reemplacé' if len(pdfs) == 1 else 'no las reemplacé'}){nota}:")
    resp = _r(f"{titulo}\n{lista}\n\nRevísalas con el cliente. ¿Están aprobadas?" if len(pdfs) > 1
              else f"{titulo}\n{lista}\n\nRevísala con el cliente. ¿Está aprobada?",
              "APROBACION", ["Aprobada", "Rechazada"])
    if fallidas:   # algunas muestras sí salieron: se aprueban esas y se avisa de las que no
        resp["respuesta"] += "\n\n⚠ No pude crear estas muestras (sigo sin ellas):\n" + "\n".join(fallidas)
    resp["archivos"] = [{"ruta": str(x), "tipo": "muestra"} for x in pdfs]  # el panel los muestra como tarjetas con vista previa
    try:   # el listado va con la aprobación: el panel lo pone al lado de la muestra para revisar nombres, tallas y números antes de aprobar
        if s.get("leo") and s["leo"].get("lineas"):
            resp["tabla"] = leo.tabla(s["leo"])
    except Exception:  # noqa: BLE001
        pass   # sin listado la aprobación sigue igual
    return resp


def _confirmar(s, t):
    tl = t.lower()
    accion = s["pend"]["accion"]
    if tl in SI:
        s["pend"] = None
        if accion == "pdfs":
            return _pdfs_y_sheets(s, True)
        return _generar_muestra(s, True) if accion == "muestra" else _exportar_mesas(s, True)
    if tl in NO:
        s["pend"] = None
        if accion == "pdfs":   # se conservan los PDF que ya estaban y se sigue con Google Sheets
            resp = s.pop("resp_sheets")
            extra = ""
            pr, fila = s["pedido"], s.get("leo")
            if fila and pr.get("orden") and not ordenes.simulado():   # aunque se conserven los PDF, TERRY calcula y escribe los MTS de la orden
                mts = terry.mts_requeridos(pr["orden"], fila["lineas"])
                if mts:
                    extra = "\n\n" + mts["texto"]
            fin = _subir_sheets(s)
            fin["respuesta"] = "Dejé los PDF de producción que ya existían, no toqué nada." + extra + "\n\n" + resp["respuesta"] + "\n\n" + fin["respuesta"]
            return fin
        if accion == "mesas" and s.get("leo"):   # se conservan las mesas y se sigue con los PDF de producción
            pr = s["pedido"]
            archivos = pr.get("mesas_ai") or [pr.get("archivo")]
            if pr.get("orden") and not ordenes.simulado():
                s["destinos_prod"] = {str(ai): ordenes.destino_impresion(pr["orden"], ai) for ai in archivos}
                if not all(s["destinos_prod"].values()):
                    s["destinos_prod"] = {str(ai): {"carpeta": str(olver.carpeta_mesas(pr["cliente"], pr["referencia"], pr.get("orden")).parent / "produccion")} for ai in archivos}
            s["pdfs_pendientes"] = True
            sig = _jugadores_desde_listado(s)
            sig["respuesta"] = "Dejé las mesas que ya existían, no toqué nada. Sigo con los PDF de producción.\n\n" + sig["respuesta"]
            return sig
        if accion == "mesas" and s["solo_mesas"]:
            s["estado"] = "INICIO"
            return _r("Dejé las mesas que ya existían, no toqué nada.", "INICIO")
        if accion == "mesas":
            s["estado"] = "JUGADORES"
            return _r("Dejé las mesas que ya existían. Envíame la lista de jugadores.\n" + _AYUDA_LISTA, "JUGADORES")
        if accion == "muestra":   # se conserva la muestra que ya existe y el proceso sigue hasta tu aprobación
            return _generar_muestra(s, False, conservar=True)
        s["estado"] = "INICIO"
        return _r("No sobrescribí nada. Cambia el cliente o la referencia, o escribe «cancelar».", "INICIO")
    return _r("Respóndeme sí o no.", "CONFIRMAR", ["Sí", "No"])


def _plantillas_promedios(lineas):
    """Estructura obligatoria de Promedios maestros para escoger .ai.

    La estructura (PE03M, PE03F, PE03N(M), PE03N(F)…) manda sobre el
    nombre que parezca tener un archivo. Si no se puede consultar, se detiene:
    usar «todas» puede abrir una moldería equivocada o dejar tallas sin PDF.
    """
    hojas = sorted({str(l.get("hoja", "")).strip() for l in lineas if l.get("hoja")})
    if not hojas:
        raise RuntimeError("El listado no trae la referencia para consultar Promedios maestros.")
    try:
        import puente
        cfg = puente._leer_config()
        if not cfg:
            raise RuntimeError("No encontré la configuración del puente hacia el panel.")
        r = puente._post_firme(cfg, "/api/agentes/pc/plantillas", {"hojas": hojas}, timeout=30, intentos=2)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"No pude consultar Promedios maestros: {e}") from e
    codigos = set()
    faltantes = []
    for h, d in (r.get("hojas") or {}).items():
        if d.get("encontrado") and d.get("codigos"):
            log(AGENTE, f"Promedios maestros: {h} -> maestro {', '.join(d['maestros'])}; plantillas {', '.join(d['codigos'])}")
            codigos |= {c.upper() for c in d["codigos"]}
        else:
            faltantes.append(h)
    if faltantes or not codigos:
        raise RuntimeError("Promedios maestros no tiene estructura definida para: " + ", ".join(faltantes or hojas))
    return codigos


def _mesas_tras_muestra(s, prefijo, estado_error, botones_error):
    """Pasa a OLVER con los .ai de los diseños del maestro (no el archivo MUESTRA). Se usa tras aprobar la muestra o cuando no hay muestra."""
    p = s["pedido"]
    lineas = (s.get("leo") or {}).get("lineas", [])
    # Sin esto, si el proyecto del listado no existe en MAESTROS se recorre toda la carpeta del cliente y los primeros 60 .ai (CA01…) tapan la referencia pedida
    refs_pista = seleccion.referencias_del_listado(lineas)
    if refs_pista:   # si las líneas ya no traen referencia, se conserva la pista que dejó LEO al leer el listado
        ordenes.pista_referencias(p["orden"], refs_pista)
    disenos = [x for x in ordenes.buscar_ai(p["orden"]) if "muestra" not in x.name.lower()]
    hojas = ", ".join(sorted({str(l.get("hoja", "")).strip() for l in lineas if l.get("hoja")})) or "la referencia de la orden"
    if not disenos:
        return _error_maestro(s, p, hojas, "En la carpeta MAESTROS del proyecto no hay ningún archivo .ai de diseño.",
                              "Crea el maestro en MAESTROS con el formato «D1 FUT01M XS A 4XL.ai» y vuelve a iniciar la orden.")
    try:
        plantillas = _plantillas_promedios(lineas)
    except RuntimeError as e:
        return _error_maestro(s, p, hojas, str(e), "Completa la estructura en Promedios maestros y vuelve a iniciar la orden.")
    s["plantillas_promedios"] = sorted(plantillas)
    sel, motivo = seleccion.mesas_para(disenos, lineas, plantillas)
    # Si el listado trae varias referencias y el maestro solo tiene algunas,
    # conserva las mesas disponibles y deja las referencias faltantes para un
    # reintento posterior; no se cancela toda la orden por una sola referencia.
    if not sel and len(lineas) > 1:
        parciales = []
        for linea in lineas:
            halladas, _ = seleccion.mesas_para(disenos, [linea], plantillas)
            parciales.extend(halladas or [])
        sel = list(dict.fromkeys(parciales))
    if plantillas and not sel and seleccion.mesas_para(disenos, lineas)[0]:
        motivo = ("Los .ai del maestro no corresponden a las plantillas que Promedios maestros asigna a esta referencia (" + ", ".join(sorted(plantillas)) + ").")
        log(AGENTE, "Ningún .ai del maestro coincide con las plantillas de Promedios maestros: " + ", ".join(sorted(plantillas)), "WARN")
    if sel:
        p["mesas_ai"], p["archivo"] = [str(x) for x in sel], str(sel[0])
        return _exportar_mesas(s, False)
    if len(disenos) > 1:
        # Antes se listaban todos los .ai para elegir uno a mano; ninguno correspondía a la orden. Ahora es un error con su causa (pedido del usuario).
        return _error_maestro(s, p, hojas, motivo or "Ningún archivo del maestro coincide con lo que pide el listado.",
                              "Revisa que en Producción esté «en proceso» la referencia correcta, o crea en MAESTROS el archivo de esa referencia, y vuelve a iniciar la orden.")
    p["archivo"] = str(disenos[0])
    return _exportar_mesas(s, False)


def _error_maestro(s, p, hojas, causa, que_hacer):
    """No se encontró el archivo del maestro: conserva el error para reintentar, nunca da la orden por completada."""
    s["estado"] = "ERROR"
    s.pop("opciones", None)
    s.pop("tras_muestra", None)
    log(AGENTE, f"Orden {p.get('orden', '')}: no encontré el archivo del maestro para {hojas}. Causa: {causa}", "ERROR")
    return _err(f"no encontré en MAESTROS el archivo para {hojas} de la orden {p.get('orden', '')}. No ejecuté nada.", causa, que_hacer,
                "ERROR", [f"Reintentar {p.get('orden', '')}"] if p.get("orden") else [])


def _aprobacion(s, t):
    tl = t.lower()
    if tl in APROBADA:
        log(AGENTE, "Muestra aprobada → paso a OLVER")
        p = s["pedido"]
        if (p.get("muestra_ai") or p.get("muestras_ai")) and p.get("orden"):  # los diseños a exportar son los .ai del maestro, no el archivo MUESTRA
            return _mesas_tras_muestra(s, "Muestra aprobada.", "APROBACION", ["Aprobada"])
        return _exportar_mesas(s, False)
    if tl == "rehacer":
        return _generar_muestra(s, False)
    if tl in RECHAZADA:
        log(AGENTE, "Muestra rechazada")
        return _r("Entendido, no avanzo. Corrige el diseño en Illustrator y escribe «rehacer» para generar otra muestra.",
                  "APROBACION", ["Rehacer"])
    return _r("¿La muestra está aprobada o rechazada?", "APROBACION", ["Aprobada", "Rechazada"])


_AYUDA_LISTA = ("Una línea por jugador: nombre, talla, número\nEjemplo:\nJuan Perez, M, 10\nPedro Gomez, L, 7\n"
                f"Tallas: {', '.join(config.TALLAS_PERMITIDAS)}")


def _exportar_mesas(s, sobrescribir):
    sobrescribir = sobrescribir or s.get("repro") == "reemplazar"
    p = s["pedido"]
    archivos = p.get("mesas_ai") or [p["archivo"]]
    carpeta = olver.carpeta_mesas(p["cliente"], p["referencia"], p.get("orden"))
    # PRODUCCIÓN: los PDF van a la carpeta IMPRESIÓN (MÁQUINA) de la orden en la NAS. No se borra nada: si un archivo ya existe se pregunta.
    # Si no se puede determinar esa carpeta (o es modo simulado), queda la copia local en salidas\ como antes.
    destinos = {}
    if p.get("orden") and not ordenes.simulado():
        destinos = {ai: ordenes.destino_impresion(p["orden"], ai) for ai in archivos}
        if any(not d for d in destinos.values()):   # los JPG del maestro no dicen la máquina: se usa la que Producción ya tiene en la tarjeta
            maq = stickers.maquina_de_tarjeta(p["orden"])
            if maq:
                log(AGENTE, f"Los JPG no dicen la máquina: uso {maq}, la de la tarjeta de Producción")
                destinos = {ai: (d or ordenes.destino_con_maquina(p["orden"], ai, maq)) for ai, d in destinos.items()}
        if any(not d for d in destinos.values()):
            # La máquina ordena la carpeta final de impresión, pero no puede
            # detener Edición. Se usa una carpeta explícita en la NAS de la
            # orden, nunca la salida local del PC, para clasificarla después.
            orden_dir = next(iter(ordenes.carpetas_de_orden(p["orden"])), None)
            if orden_dir:
                pendientes = ordenes._carpeta_existente(orden_dir, "IMPRESION (PENDIENTE MAQUINA)")
                destinos = {
                    ai: {
                        "carpeta": str(pendientes),
                        "montajes": str(ordenes._carpeta_existente(Path(ai).parent, "Montajes (PENDIENTE MAQUINA)")),
                        "maquina": "PENDIENTE MAQUINA", "generos": [],
                    }
                    for ai in archivos
                }
                log(AGENTE, f"No sé la máquina de impresión de {p['orden']}: continúo en {pendientes}", "WARN")
                s["aviso"] += "\n\n⚠ No encontré máquina de impresión: continúo en la NAS, en IMPRESION (PENDIENTE MAQUINA); asígnala después para clasificar la producción."
            else:
                log(AGENTE, f"No encontré carpeta de la orden {p['orden']}: uso la salida local", "WARN")
                destinos = {}
    # Un maestro «Fusionado» no puede mezclarse con las mesas normales. Tanto
    # sus mesas independientes como sus PDF por jugador quedan agrupados en
    # la subcarpeta Fusionado de la máquina correspondiente.
    def _destino_de(ai, destino):
        if not destino or "FUSIONADO" not in Path(ai).name.upper():
            return destino
        destino = dict(destino)
        for clave in ("carpeta", "montajes"):
            if destino.get(clave):
                destino[clave] = str(Path(destino[clave]) / "Fusionado")
        return destino

    destinos_prod = {ai: _destino_de(ai, d) for ai, d in destinos.items()}  # los PDF por jugador siguen en IMPRESIÓN; las mesas .ai quedan dentro del maestro (Montajes (MÁQUINA))
    destinos = destinos_prod
    destinos = {ai: ({**d, "carpeta": d["montajes"]} if d else d) for ai, d in destinos.items()}
    produccion = bool(archivos) and all(destinos.get(ai) for ai in archivos)
    if produccion and s.get("maquina_puesta") != p.get("orden"):   # la máquina de los JPG del maestro pasa a la tarjeta de producción (solo si está vacía)
        s["maquina_puesta"] = p.get("orden")
        try:
            s["nota_maquina"] = stickers.poner_maquina(p.get("orden"), (s.get("leo") or {}).get("lineas", []), next((d.get("maquina") for d in destinos_prod.values() if d and d.get("maquina")), ""))
        except Exception as e:  # noqa: BLE001
            log(AGENTE, f"No pude poner la máquina en la tarjeta: {e}", "WARN")
    antes = {}
    if produccion:
        for ai in archivos:
            d = Path(destinos[ai]["carpeta"])
            if d not in antes:
                antes[d] = {str(f): f.stat().st_mtime_ns for f in d.rglob("*") if f.is_file()} if d.exists() else {}
        r = None
    elif len(archivos) > 1:  # varios archivos a la misma carpeta: se revisa/limpia UNA sola vez
        previos = [f for f in carpeta.glob("*") if f.is_file()] if carpeta.exists() else []
        if previos and not sobrescribir:
            r = {"ok": False, "existe": True, "carpeta": str(carpeta), "n": len(previos)}
        else:
            for f in previos:
                f.unlink()
            r = None
    else:
        r = None
    info = None
    exportados, simulado, saltadas = [], False, []
    for ai in archivos:
        if r:
            break
        if produccion:
            info = destinos[ai]
            log(AGENTE, f"OLVER exporta {Path(ai).name} a producción: {info['carpeta']}")
            r = olver.exportar_mesas(p["cliente"], p["referencia"], str(ai), p.get("formato", "ai"), sobrescribir,
                                     orden=p.get("orden"), destino=info, generos=info.get("generos"), limpiar=True,
                                     lineas=(s.get("leo") or {}).get("lineas"))
        else:
            if p.get("orden") and not ordenes.simulado():
                info = destinos.get(ai) or ordenes.destino_impresion(p["orden"], ai)  # géneros por los JPG del maestro (M, F, N)
            log(AGENTE, f"OLVER exporta {Path(ai).name}")
            r = olver.exportar_mesas(p["cliente"], p["referencia"], str(ai), p.get("formato", "ai"), sobrescribir,
                                     orden=p.get("orden"), generos=(info or {}).get("generos"), limpiar=len(archivos) == 1,
                                     lineas=(s.get("leo") or {}).get("lineas"))
        if r.get("existe") and len(archivos) > 1 and ai != archivos[-1]:   # las mesas de ESTE maestro ya estaban: se conservan y se sigue con los demás maestros
            log(AGENTE, f"{Path(ai).name}: las mesas ya existían: las conservo y sigo con los demás maestros")
            r = None
            continue
        if r.get("sin_tallas"):   # esta mesa (otro diseño o género) no la pide el listado: se salta y se sigue con las demás
            log(AGENTE, f"{Path(ai).name}: {r['error']} La salto y sigo")
            saltadas.append(Path(ai).name)
            r = None
            continue
        if r.get("ok"):
            exportados += r["archivos"]
            simulado = simulado or r.get("simulado")
            if len(archivos) > 1:
                r = None
    if saltadas and len(saltadas) == len(archivos) and (s.get("leo") or {}).get("lineas"):
        # ningún archivo tuvo tallas que exportar: no se da el pedido por terminado en silencio
        s["estado"] = "APROBACION"
        return _err("OLVER no pudo exportar ninguna talla del listado.", "; ".join(saltadas),
                    "Revisa que el listado tenga talla, género y diseño de la referencia en proceso y vuelve a aprobar.", "APROBACION", ["Aprobada", "Rechazada"])
    if produccion and (r is None or r.get("ok")):   # r es el resultado de OLVER cuando se exporta un solo archivo
        # solo lo que se exportó ahora (la carpeta de producción puede tener más archivos de la misma orden)
        rutas = sorted(str(f) for d in antes for f in d.rglob("*") if f.is_file() and antes[d].get(str(f)) != f.stat().st_mtime_ns)
        r = {"ok": True, "produccion": True, "maquina": destinos[archivos[0]]["maquina"], "carpeta": str(next(iter(antes))), "simulado": simulado,
             "archivos": [Path(x).name for x in rutas], "rutas": rutas}
    elif r is None:
        r = {"ok": True, "carpeta": str(carpeta), "simulado": simulado,
             "archivos": sorted(f.name for f in carpeta.glob("*") if f.is_file())}
    if r.get("existe"):   # las mesas ya estaban: se dejan como están y se sigue, sin preguntar
        log(AGENTE, "Las mesas ya existían: las conservo y sigo")
        s["pend"] = {"accion": "mesas"}
        return _confirmar(s, "no")
    if not r["ok"]:
        if s["solo_mesas"]:
            s["estado"] = "INICIO"
            return _err("OLVER no pudo exportar las mesas de trabajo.", r["error"], "Corrige lo que indica la causa y vuelve a pedir las mesas.")
        s["estado"] = "APROBACION"
        return _err("OLVER no pudo exportar las mesas de trabajo.", r["error"], "Corrige lo que indica la causa y vuelve a aprobar.", "APROBACION", ["Aprobada", "Rechazada"])
    if s["solo_mesas"] and not s.get("leo"):
        s["estado"] = "INICIO"
        nota = " (simulado: sin Illustrator)" if r.get("simulado") else ""
        resp = _r(f"OLVER exportó {len(r['archivos'])} archivos de {s['pedido'].get('orden') or s['pedido']['cliente']}{_donde(r, False)}{nota}:\n{r['carpeta']}\n\n"
                  "Si quieres seguir con jugadores y Google Sheets, escribe «jugadores».", "INICIO", ["Jugadores"])
        resp["archivos"] = _archivos_mesas(r)
        return resp
    if s.get("leo"):  # la orden vino del listado: OLIVER revisa lo que LEO leyó
        log(AGENTE, "Mesas exportadas: sigo con los PDF de producción (nombre y número por jugador)")
        # PDF de producción (uno por jugador): se crean cuando OLIVER valida el listado, en la carpeta de producción de cada archivo
        s["destinos_prod"] = {str(ai): (destinos_prod.get(ai) if produccion else {"carpeta": str(carpeta.parent / "produccion")}) for ai in archivos}
        s["pdfs_pendientes"] = True
        sig = _jugadores_desde_listado(s)
        sig["respuesta"] = f"{_exportadas(r)}{_donde(r)}:\n{r['carpeta']}\n\n" + sig["respuesta"]
        sig["archivos"] = (sig.get("archivos") or []) + _archivos_mesas(r)
        return sig
    s["estado"] = "JUGADORES"
    resp = _r(f"{_exportadas(r)}{_donde(r)}:\n{r['carpeta']}\n\nAhora envíame la lista de jugadores.\n" + _AYUDA_LISTA,
              "JUGADORES")
    resp["archivos"] = _archivos_mesas(r)
    return resp


def _exportadas(r):
    """Texto de lo que hizo OLVER; si las mesas ya estaban exportadas no se vuelven a exportar y se dice así."""
    n = len(r["archivos"])
    if n:
        return f"OLVER exportó {n} archivos"
    try:
        hay = sum(1 for f in Path(r["carpeta"]).rglob("*.ai") if f.is_file())
    except OSError:
        hay = 0
    return (f"Las mesas de esta orden YA estaban exportadas ({hay} archivos en la carpeta): no exporté nada nuevo. "
            "Para exportarlas de nuevo, bórralas de esa carpeta o pide «reemplazar»")


def _firma_jugadores(lineas):
    """Huella de los datos que van a los PDF de producción (nombre, número, talla, diseño, género, referencia de cada línea)."""
    datos = sorted([str(l.get(k, "")).strip().upper() for k in ("nombre", "numero", "talla", "diseno", "genero", "hoja")] for l in lineas)
    return hashlib.sha1(json.dumps(datos, ensure_ascii=False).encode("utf-8")).hexdigest()


def _donde(r, con_en=True):
    """Texto de destino: a producción (máquina) o, si quedó en la copia local, «en»."""
    if r.get("produccion"):
        return f" a producción ({r.get('maquina', '')})"
    return " en" if con_en else ""


def _archivos_mesas(r):
    """Mesas exportadas por OLVER como lista de archivos (ruta completa) para mostrarlas en el panel."""
    if r.get("rutas"):
        return [{"ruta": x, "tipo": "mesa"} for x in r["rutas"]]
    return [{"ruta": str(Path(r["carpeta"]) / n), "tipo": "mesa"} for n in r.get("archivos", [])]


def _jugadores_desde_listado(s):
    """OLIVER valida las líneas (tallas, números, nombres) que LEO leyó del listado."""
    p, fila = s["pedido"], s["leo"]
    lineas = [l for l in fila["lineas"] if l["talla"] or l["numero"] or l["nombre"]]
    if not lineas:
        s["estado"] = "JUGADORES"
        return _r("El listado no trae tallas ni números para esta orden. Envíame la lista de jugadores.\n" + _AYUDA_LISTA, "JUGADORES")
    log(AGENTE, f"Paso a OLIVER las {len(lineas)} líneas que leyó LEO")
    r = oliver.validar_lineas(lineas, exigir_nombre=fila["tiene_nombre"], tallas_ok=s.get("tallas_ok") or ())
    if r.get("raras") and not r["problemas"]:   # solo hay tallas que no existen: no se cancela, se pregunta si continúa
        s["estado"] = "TALLA_RARA"
        s["tallas_raras"] = sorted({x.rsplit(": ", 1)[-1] for x in r["raras"]})
        return _r("OLIVER encontró tallas que no existen en el catálogo:\n• " + "\n• ".join(r["raras"]) +
                  "\n\n¿Continúo con esas tallas tal como están en el listado o cancelo? "
                  "(Si prefieres corregirlas, arréglalas en el listado y escribe «revisar».)",
                  "TALLA_RARA", ["Continuar", "Cancelar", "Revisar"])
    if not r["ok"]:
        r["problemas"] += r.get("raras") or []
        s["estado"] = "JUGADORES"
        return _r("OLIVER revisó lo que dice el listado y encontró problemas:\n• " + "\n• ".join(r["problemas"]) +
                  "\n\nCorrígelos en el listado y escribe «revisar», o envíame aquí la lista completa corregida."
                  + ("\nCuando quede corregido creo los PDF de producción por jugador." if s.get("pdfs_pendientes") else ""),
                  "JUGADORES", ["Revisar"])
    s["jugadores"], s["estado"] = r["jugadores"], "CONFIRMAR_SHEETS"
    repetidos = ("⚠ " + "\n⚠ ".join(r.get("avisos", [])) + "\n(Los respeto tal como están en el listado.)\n\n") if r.get("avisos") else ""
    if r.get("vacios"):
        repetidos += "ℹ Datos en blanco (no los invento, el PDF queda sin ese dato):\n• " + "\n• ".join(r["vacios"]) + "\n\n"
    resp = _r(f"OLIVER validó {len(r['jugadores'])} jugadores del listado sin problemas:\n{oliver.resumen(r['jugadores'])}\n\n{repetidos}".rstrip(),
              "CONFIRMAR_SHEETS")
    if s.pop("pdfs_pendientes", False):   # ya aprobada la muestra y validado el listado: PDF de producción, uno por jugador
        s["resp_sheets"] = resp
        return _pdfs_y_sheets(s, False)
    fin = _subir_sheets(s)
    fin["respuesta"] = resp["respuesta"] + "\n\n" + fin["respuesta"]
    return fin


def _copiar_jpgs_a_orden(archivos, destinos):
    """Al terminar los PDF de producción: copia a la carpeta de la orden los JPG (REFERENCIA_DISEÑO_MAQUINA) del maestro de cada diseño.
    No pisa nada: si el JPG ya está en la carpeta de la orden, lo deja. Devuelve (copiados, ya_estaban, errores)."""
    import shutil
    copiados, estaban, errores = [], [], []
    vistos = set()
    for ai in archivos:
        d = destinos.get(str(ai)) or {}
        if not d.get("maquina"):
            continue   # sin carpeta de producción conocida no se copia nada
        orden = Path(d["carpeta"]).parent
        padre = Path(ai).parent
        ref, ds = ordenes.ref_y_disenos(padre.name)
        propio = ordenes.diseno_en_archivo(Path(ai).name)
        if propio:
            ds = {propio}
        try:
            for f in sorted(padre.glob("*")):
                m = ordenes._JPG.match(f.name)
                if not m or (ref and m.group(1).upper() != ref.upper()) or (ds and m.group(2) not in ds):
                    continue
                destino = orden / f.name
                if str(destino) in vistos:
                    continue
                vistos.add(str(destino))
                if destino.exists():
                    estaban.append(f.name)
                else:
                    shutil.copy2(f, destino)
                    copiados.append(f.name)
        except OSError as e:
            errores.append(f"{Path(ai).name}: {e}")
    return copiados, estaban, errores


def _pdfs_y_sheets(s, sobrescribir, permitir_tallas_faltantes=False):
    sobrescribir = sobrescribir or s.get("repro") == "reemplazar"
    """Crea los PDF de producción por jugador y devuelve la pregunta de Google Sheets (o pide confirmar si ya existen)."""
    resp = s.get("resp_sheets")
    p, fila = s["pedido"], s["leo"]
    archivos = p.get("mesas_ai") or [p.get("archivo")]
    # La sesión puede conservar una selección de mesas de un intento anterior.
    # Antes de crear PDF se vuelve a cruzar con el listado recién leído para no
    # generar D2, otro género o una talla que la orden actual no solicita.
    plantillas = set(s.get("plantillas_promedios") or _plantillas_promedios(fila.get("lineas") or []))
    seleccionadas, motivo = seleccion.mesas_para([Path(str(a)) for a in archivos if a], fila.get("lineas") or [], plantillas)
    if not seleccionadas:
        return _err("no encontré la plantilla que pide el listado para crear los PDF de producción.", motivo,
                    "Revisa el listado y los archivos del maestro; luego escribe «revisar».", "JUGADORES", ["Revisar"])
    # Un maestro puede tener mesas M y F aunque su nombre termine en M/F. Si
    # falta el archivo gemelo, OLVER abre el maestro disponible y exporta la
    # mesa del género pendiente; así no se pierden los PDF de las jugadoras.
    # Solo detenemos si no existe NINGÚN maestro del diseño solicitado.
    trabajos = [(str(a), None) for a in seleccionadas]
    sin_maestro = []
    rutas = [Path(str(a)) for a in archivos if a]
    for linea in fila.get("lineas") or []:
        if not (linea.get("talla") or linea.get("numero") or linea.get("nombre")):
            continue
        if seleccion.mesas_para(rutas, [linea])[0]:
            continue
        dis = re.search(r"(\d+)", str(linea.get("diseno") or ""))
        genero = seleccion._genero_efectivo(linea)
        candidatas = []
        for ruta in rutas:
            maestro = olver._maestro_match(ruta)
            if maestro and dis and maestro.group(1) == dis.group(1):
                candidatas.append(str(ruta))
        if candidatas and genero:
            trabajo = (candidatas[0], genero)
            if trabajo not in trabajos:
                trabajos.append(trabajo)
            continue
        etiqueta = " · ".join(str(linea.get(k) or "—").strip() for k in ("hoja", "diseno", "genero", "talla"))
        if etiqueta not in sin_maestro:
            sin_maestro.append(etiqueta)
    if sin_maestro:
        return _err("no existe ningún maestro para crear todos los PDF de producción.",
                    "No encontré un .ai del diseño que cubra: " + "; ".join(sin_maestro),
                    "Crea el maestro de ese diseño y escribe «revisar». La orden no se finalizó ni se subió a Google Sheets.",
                    "JUGADORES", ["Revisar"])
    archivos = [str(a) for a in dict.fromkeys(seleccionadas)]
    p["mesas_ai"] = archivos
    destinos_previos = s.get("destinos_prod") or {}
    s["destinos_prod"] = {a: destinos_previos[a] for a in archivos if a in destinos_previos}
    tela = telas.tela_de_hojas([l.get("hoja", "") for l in fila["lineas"]], (fila.get("lineas") or [{}])[0].get("hoja", ""))
    tela_archivo = telas.tela_archivo_de_hojas([l.get("hoja", "") for l in fila["lineas"]], (fila.get("lineas") or [{}])[0].get("hoja", ""))   # MONTECATINI (sin color) para el nombre del PDF
    tarjetas, textos, avisos, total, conservados, fallos = [], [], [], 0, 0, []
    clave_firma, firma = _clave(p), _firma_jugadores(fila["lineas"])
    igual = db.firma_guardada(clave_firma) == firma   # ¿son los mismos jugadores con los que se hicieron los PDF que ya existen?
    for ai, genero_destino in trabajos:
        destino = (s.get("destinos_prod") or {}).get(str(ai)) or {"carpeta": str(olver.carpeta_mesas(p["cliente"], p["referencia"], p.get("orden")).parent / "produccion")}
        etiqueta_ai = Path(ai).name + (f" · Gen_{genero_destino}" if genero_destino else "")
        log(AGENTE, f"OLVER crea los PDF de producción por jugador de {etiqueta_ai}")
        r = olver.pdfs_por_jugador(ai, fila["lineas"], destino, p.get("orden"), tela=tela or "", sobrescribir=sobrescribir,
                                   tela_archivo=tela_archivo, referencia=p.get("referencia", ""), genero_destino=genero_destino,
                                   permitir_faltantes=permitir_tallas_faltantes)
        if r.get("requiere_confirmacion"):
            faltantes = ", ".join(r.get("faltantes") or [])
            maestro = r.get("maestro") or Path(ai).name
            s["pdfs_faltantes"] = {"sobrescribir": sobrescribir}
            s["estado"] = "CONFIRMAR_TALLAS_MESAS"
            log(AGENTE, f"{maestro}: faltan mesas de talla {faltantes}; espero decisión antes de crear PDF", "WARN")
            return _r(
                f"El maestro {maestro} no tiene mesa independiente para: {faltantes}.\n\n"
                "Ya exporté todas las mesas disponibles de la plantilla; no ejecuté JSX ni generé PDFs todavía. "
                "¿Continúo solo con las tallas que sí existen o cancelo?",
                "CONFIRMAR_TALLAS_MESAS", ["Continuar con disponibles", "Cancelar"],
            )
        if r.get("existe") and (r.get("incompleto") or (s.get("repro") != "conservar" and not igual)):
            # Un conjunto parcial nunca se puede conservar: debe reconstruirse,
            # incluso si el listado no cambió desde el intento anterior.
            razon = "faltan PDF de producción" if r.get("incompleto") else "el listado cambió desde que se hicieron los PDF"
            log(AGENTE, f"{razon.capitalize()} de {etiqueta_ai}: los rehago")
            r = olver.pdfs_por_jugador(ai, fila["lineas"], destino, p.get("orden"), tela=tela or "", sobrescribir=True,
                                       tela_archivo=tela_archivo, referencia=p.get("referencia", ""), genero_destino=genero_destino,
                                       permitir_faltantes=permitir_tallas_faltantes)
        if r.get("existe"):   # mismos jugadores: se conservan los PDF que ya estaban
            log(AGENTE, f"Los PDF de producción de {etiqueta_ai} ya existían y el listado no cambió: no los toco")
            conservados += r.get("n", 0)
            continue
        if not r["ok"]:
            avisos.append(f"{Path(ai).name}: {r['error']}")
            fallos.append(Path(ai).name)
            continue
        total += len(r["pdfs"])
        textos.append(f"{etiqueta_ai}: {len(r['pdfs'])} PDF" + (" (simulado)" if r.get("simulado") else "") + f"\n{r['carpeta']}")
        omitidas_autorizadas = set(r.get("omitidas_autorizadas") or [])
        omitidas_reales = [o for o in r.get("omitidas", []) if o not in omitidas_autorizadas]
        if omitidas_autorizadas:
            pendientes = r.get("pendientes_autorizados") or []
            avisos += [f"Pendiente el PDF {mesa.replace('_Tipo_', '_')}" for mesa in pendientes]
        avisos += [f"{etiqueta_ai} · {o}" for o in omitidas_reales]
        if omitidas_reales or len(r["pdfs"]) != r.get("esperados", len(r["pdfs"])):
            faltan = max(0, int(r.get("esperados", 0)) - len(r["pdfs"]))
            detalle = "; ".join(omitidas_reales) or f"faltan {faltan} PDF"
            avisos.append(f"{etiqueta_ai}: exportación incompleta ({detalle})")
            fallos.append(etiqueta_ai)
        for x in r["pdfs"]:
            tarjetas.append({"ruta": x["ruta"], "tipo": "produccion", "titulo": f"{x['nombre'] or 'Jugador'} · #{x['numero']} · talla {x['talla']}"})
    if total or conservados:
        db.guardar_firma(clave_firma, firma)
    cabeza = (f"OLVER creó {total} PDF de producción, uno por jugador (solo cambian el nombre y el número):\n" + "\n".join(textos)) if total else (
        "Los PDF de producción ya estaban hechos con estos mismos jugadores: no los toqué." if conservados else "OLVER no creó PDF de producción.")
    if total and conservados:
        cabeza += f"\n({conservados} PDF que ya existían se conservaron)"
    if avisos:
        cabeza += "\n⚠ " + "\n⚠ ".join(avisos)
    if s.get("nota_maquina"):
        cabeza += "\n\n" + s.pop("nota_maquina")
    if fallos or not (total or conservados):
        # sin los PDF de producción el pedido NO se da por finalizado: no se sube a Google Sheets ni se copian JPG
        log(AGENTE, "No se generaron todos los PDF de producción: el pedido queda SIN finalizar", "ERROR")
        s.pop("resp_sheets", None)
        s["pdfs_pendientes"] = True
        s["estado"] = "JUGADORES"
        causa = ("; ".join(a for a in avisos if a.split(":")[0] in fallos) or "; ".join(avisos)) if fallos else "OLVER no generó ningún PDF de producción para esta orden"
        r = _err("el pedido NO está finalizado: no se generaron todos los PDF de producción.", causa,
                 "Resuelve lo que indica la causa y escribe «revisar» para que OLVER los intente de nuevo. No subí nada a Google Sheets.", "JUGADORES", ["Revisar"])
        r["respuesta"] += "\n\nDetalle:\n" + cabeza
        return r
    if total and not ordenes.simulado():   # PDF listos: los JPG del maestro pasan a la carpeta de la orden
        copiados, estaban, errores = _copiar_jpgs_a_orden(archivos, s.get("destinos_prod") or {})
        if copiados:
            log(AGENTE, "JPG del maestro copiados a la carpeta de la orden: " + ", ".join(copiados))
            cabeza += "\n\nCopié a la carpeta de la orden los JPG del maestro: " + ", ".join(copiados)
        if estaban:
            cabeza += "\n(Ya estaban en la carpeta de la orden, no los toqué: " + ", ".join(estaban) + ")"
        if errores:
            log(AGENTE, "No pude copiar los JPG: " + "; ".join(errores), "WARN")
            cabeza += "\n⚠ No pude copiar los JPG del maestro: " + "; ".join(errores)
    if not ordenes.simulado():   # TERRY: MTS requeridos de la orden en su tarjeta de producción (promedio por talla × cantidad)
        mts = terry.mts_requeridos(p["orden"], fila["lineas"]) if p.get("orden") else None
        if mts:
            cabeza += "\n\n" + mts["texto"]
    if not ordenes.simulado() and p.get("orden"):   # TERRY: sticker de producción de cada referencia (no frena el pedido si falla)
        maquina = next((d.get("maquina") for d in (s.get("destinos_prod") or {}).values() if d and d.get("maquina")), "")
        try:
            st = stickers.crear(p["orden"], fila["cliente"], fila["proyecto"], fila["lineas"], maquina)
            cabeza += "\n\n" + st["texto"]
            tarjetas += st["archivos"]
        except Exception as e:  # noqa: BLE001
            log(AGENTE, f"No pude hacer los stickers: {e}", "WARN")
            cabeza += f"\n\n⚠ TERRY no pudo hacer los stickers de producción: {e}"
    s.pop("resp_sheets", None)
    fin = _subir_sheets(s)   # Google Sheets sin preguntar
    fin["respuesta"] = cabeza + "\n\n" + resp["respuesta"] + "\n\n" + fin["respuesta"]
    fin["archivos"] = tarjetas + (fin.get("archivos") or [])
    return fin


def _releer(s):
    """Vuelve a pedirle a LEO el listado (por si lo corrigieron) y revisa de nuevo."""
    p = s["pedido"]
    if not p.get("orden"):
        return _r("No tengo una orden del listado para revisar. Envíame la lista de jugadores aquí.", "JUGADORES")
    r = leo.leer_orden(p["orden"])
    if not r["ok"]:
        return _err("LEO no pudo volver a leer el listado de la orden.", r["error"], "Revisa el Excel del listado y escribe «revisar».", "JUGADORES", ["Revisar"])
    nuevo = next((f for f in r["proyectos"] if f["proyecto"] == p["referencia"]), None)
    if not nuevo:
        return _r(f"LEO ya no encuentra el proyecto «{p['referencia']}» en la orden {p['orden']}.", "JUGADORES")
    s["leo"] = _solo_en_proceso(p["orden"], nuevo)
    ordenes.pista_referencias(p["orden"], seleccion.referencias_del_listado(s["leo"].get("lineas") or []))
    return _jugadores_desde_listado(s)


def _talla_rara(s, t):
    """Respuesta a «¿continúo con las tallas que no existen?»: Continuar las acepta; Revisar vuelve a leer el listado."""
    tl = t.lower().strip()
    if tl == "revisar":
        return _releer(s)
    if re.fullmatch(r"(continuar|continúa|continua|sí|si|ok|dale|seguir)\W*", tl):
        s["tallas_ok"] = set(s.get("tallas_ok") or ()) | set(s.get("tallas_raras") or ())
        log(AGENTE, f"Continúo con tallas fuera del catálogo: {', '.join(sorted(s['tallas_ok']))}", "WARN")
        return _jugadores_desde_listado(s)
    return _r("¿Continúo con esas tallas o cancelo?", "TALLA_RARA", ["Continuar", "Cancelar", "Revisar"])


def _confirmar_tallas_mesas(s, t):
    """No se inventa una mesa: la persona decide si produce las tallas que sí existen."""
    tl = t.lower().strip()
    if re.fullmatch(r"(continuar(?: con disponibles)?|continúa|continua|sí|si|ok|dale|seguir)\W*", tl):
        datos = s.pop("pdfs_faltantes", {})
        log(AGENTE, "Autorizó continuar solo con las tallas que tienen mesa independiente", "WARN")
        return _pdfs_y_sheets(s, bool(datos.get("sobrescribir")), permitir_tallas_faltantes=True)
    if tl == "revisar":
        s.pop("pdfs_faltantes", None)
        return _releer(s)
    return _r("No generé PDFs. Puedes continuar con las tallas disponibles, revisar el listado o cancelar.",
              "CONFIRMAR_TALLAS_MESAS", ["Continuar con disponibles", "Cancelar", "Revisar"])


def _jugadores(s, t):
    if t.lower() == "revisar":
        return _releer(s)
    if t.startswith("+"):  # agregar líneas a la lista anterior
        s["texto_jugadores"] += "\n" + t[1:].strip()
    else:
        s["texto_jugadores"] = t
    r = oliver.validar(s["texto_jugadores"], s["pedido"]["cliente"])
    if not r["ok"]:
        return _r("OLIVER encontró problemas:\n• " + "\n• ".join(r["problemas"]) +
                  "\n\nReenvía la lista completa corregida, o escribe «+ nombre, talla, número» para agregar líneas.",
                  "JUGADORES")
    s["jugadores"] = r["jugadores"]
    fin = _subir_sheets(s)
    fin["respuesta"] = f"OLIVER validó {len(r['jugadores'])} jugadores sin problemas:\n{oliver.resumen(r['jugadores'])}\n\n" + fin["respuesta"]
    return fin


def _subir_sheets(s):
    """TERRY sube la lista a Google Sheets y OLIVER la memoriza. Se hace solo: no se pide autorización."""
    p = s["pedido"]
    oliver.guardar(_clave(p), p["cliente"], s["jugadores"])
    r = terry.subir(p["cliente"], p["referencia"], s["jugadores"], orden=p.get("orden"))
    if not r["ok"]:
        s["estado"] = "CONFIRMAR_SHEETS"   # solo si falla: se puede reintentar escribiendo «sí»
        return _err("TERRY no pudo subir la lista a Google Sheets.", r["error"], "Escribe «sí» para reintentar.", "CONFIRMAR_SHEETS", ["Sí"])
    s["estado"] = "FIN"
    nota = " (simulado: se guardó como CSV)" if r.get("simulado") else ""
    log(AGENTE, f"Pedido {_clave(p)} completo")
    return _r(f"TERRY guardó {r['filas']} filas en la pestaña «{r['pestana']}»{nota}.\n{r['destino']}\n\n"
              "Pedido terminado. Cuando quieras, envíame el siguiente.", "FIN")


def _sheets(s, t):
    """Reintento manual si falló la subida automática a Google Sheets."""
    if t.lower() in NO:
        s["estado"] = "JUGADORES"
        return _r("No subí nada. Envíame la lista corregida o escribe «cancelar».", "JUGADORES")
    if t.lower() not in SI:
        return _r("Escribe «sí» para reintentar subir la lista a Google Sheets.", "CONFIRMAR_SHEETS", ["Sí"])
    return _subir_sheets(s)
