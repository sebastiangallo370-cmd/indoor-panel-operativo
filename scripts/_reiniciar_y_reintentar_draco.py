"""Utilidad puntual: reinicia AUTOMATIZACION y reintenta el trazo DRACO solicitado."""
from app import agentes_canal as canal

USUARIO = "Indoor Sport"
PC = "pc-aa29e9"
ORDEN = "RM7689"
REFERENCIA = "A7202SHT01"

with canal._lock:
    datos = canal._leer()
    sesion = canal._sesion(USUARIO, PC)
    for mensaje in datos["mensajes"]:
        if mensaje["sesion"] == sesion and mensaje["rol"] == "yo" and not mensaje.get("respondido"):
            mensaje["tomado"] = True
            mensaje["respondido"] = True
    datos["trabajo"].pop(sesion, None)
    canal._nuevo(
        datos, sesion, "bot",
        "Reiniciando los agentes de AUTOMATIZACION para retomar el trazo con la versión actualizada de DRACO…",
        estado="REINICIANDO", botones=[], agentes=["TAVO"], respondido=True,
    )
    canal._nuevo(datos, sesion, "yo", "__reiniciar__", t=canal._ahora(), tomado=False, respondido=False, oculto=True, pc=PC)
    canal._guardar(datos)

with canal._lock:
    datos = canal._leer()
    sesion = canal._sesion(USUARIO, PC)
    canal._nuevo(
        datos, sesion, "yo", f"draco trazo {ORDEN} {REFERENCIA}",
        t=canal._ahora(), tomado=False, respondido=False, pc=PC,
    )
    canal._guardar(datos)

print(f"{sesion}: draco trazo {ORDEN} {REFERENCIA}")
