"""Avisos en tiempo real entre módulos del servidor: cuando cambia algo que los agentes usan (INFORMACIÓN TELA o el inventario del panel) quien lo cambia llama a
`avisar(motivo)` y cada agente suscrito se despierta ya mismo, sin esperar su revisión periódica. Los avisos solo despiertan: cada agente vuelve a leer lo que necesita."""
from __future__ import annotations

import logging
from typing import Callable

log = logging.getLogger('tiempo_real')
_suscritos: list[Callable[[str], None]] = []


def suscribir(fn: Callable[[str], None]) -> None:
    if fn not in _suscritos:
        _suscritos.append(fn)


def avisar(motivo: str = '') -> None:
    for fn in list(_suscritos):
        try:
            fn(motivo)
        except Exception:   # noqa: BLE001
            log.exception('aviso en tiempo real fallido (%s)', motivo)
