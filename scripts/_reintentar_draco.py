"""Encola nuevamente el trazo DRACO tras el reinicio del PC de automatización."""
from app import agentes_canal as canal

USUARIO = "Indoor Sport"
PC = "pc-aa29e9"
ORDEN = "RM7689"
REFERENCIA = "A7202SHT01"

with canal._lock:
    datos = canal._leer()
    sesion = canal._sesion(USUARIO, PC)
    canal._nuevo(
        datos, sesion, "yo", f"draco trazo {ORDEN} {REFERENCIA}",
        t=canal._ahora(), tomado=False, respondido=False, pc=PC,
    )
    canal._guardar(datos)

print(f"{sesion}: draco trazo {ORDEN} {REFERENCIA}")
