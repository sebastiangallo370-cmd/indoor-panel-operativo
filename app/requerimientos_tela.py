"""Requerimiento de tela por correo: cuando el agente de inventarios detecta una producción SIN tela suficiente se envía UN correo con el
requerimiento (cliente, proyecto, referencia, tela, MTS requeridos, lo que hay y lo que falta) y la alerta en pantalla confirma si ya salió.

- Un correo por producción (la clave es fila + orden + referencia): no se repite aunque la alerta siga activa.
- El destinatario sale de REQUERIMIENTO_TELA_EMAIL del .env; si no está, se usa la cuenta con la que el panel envía sus correos.
- Si el envío falla se reintenta (3 veces, cada 10 minutos) y la alerta lo dice.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

COL = timezone(timedelta(hours=-5))   # Colombia no tiene horario de verano
MAX_INTENTOS = 3
ESPERA_REINTENTO = 600
_lock = threading.Lock()


def _ruta(state_dir) -> Path:
    return Path(state_dir) / 'requerimientos_tela.json'


def _leer(state_dir) -> dict:
    try:
        d = json.loads(_ruta(state_dir).read_text(encoding='utf-8'))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _guardar(state_dir, datos: dict) -> None:
    ruta = _ruta(state_dir)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix('.tmp')
    tmp.write_text(json.dumps(datos, ensure_ascii=False), encoding='utf-8')
    tmp.replace(ruta)


def destino(cuenta_envio: str = '') -> str:
    """Correo del encargado (REQUERIMIENTO_TELA_EMAIL); si no está definido, la cuenta de envío del panel."""
    return (os.getenv('REQUERIMIENTO_TELA_EMAIL') or '').strip() or (cuenta_envio or '').strip()


def enmascarar(correo: str) -> str:
    """«carlos@gmail.com» → «c***@gmail.com» (en pantalla no se muestra el correo completo)."""
    return re.sub(r'^(.).*?(@.*)$', r'\1***\2', (correo or '').strip())


def _hora(iso: str) -> str:
    try:
        t = datetime.fromisoformat(iso).astimezone(COL)
        return t.strftime('%I:%M ').lstrip('0') + ('a. m.' if t.hour < 12 else 'p. m.')
    except (TypeError, ValueError):
        return ''


def _n(valor) -> str:
    return f'{float(valor or 0):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.').rstrip('0').rstrip(',')


def asunto_y_cuerpo(ev: dict) -> tuple[str, str]:
    falta = int(-(-float(ev.get('falta') or 0) // 1))   # redondeo hacia arriba: no se pide de menos
    asunto = f"REQUERIMIENTO DE TELA · {ev.get('tela', '')} · faltan {falta} MTS · {ev.get('cliente', '')}"
    sin_tela = ev.get('tipo') == 'sin_tela'
    cuerpo = (
        'Hola,\n\n'
        'El agente de inventarios detectó una nueva producción para la que NO hay tela suficiente en el inventario. '
        'Se requiere conseguir la tela para que la producción no se retrase.\n\n'
        f"  Nombre cliente : {ev.get('cliente', '')}\n"
        f"  Proyecto       : {ev.get('proyecto', '')}\n"
        f"  Referencia     : {ev.get('referencia', '')}\n"
        f"  Orden          : {ev.get('orden', '')}\n"
        f"  Tela           : {ev.get('tela', '')}\n"
        f"  MTS requeridos : {_n(ev.get('mts'))}\n"
        + ('  En inventario  : esta tela no está en el inventario\n' if sin_tela else f"  En inventario  : {int(round(float(ev.get('disponible') or 0)))} MTS\n")
        + f'  TELA QUE FALTA : {falta} MTS\n\n'
        'Este mensaje lo envía automáticamente el panel de producción de Indoor Sport (una sola vez por producción).\n'
    )
    return asunto, cuerpo


def estado(state_dir, clave: str) -> dict:
    """Lo que la alerta muestra de una producción: {'estado': 'pendiente'|'enviado'|'error', 'para': 'c***@gmail.com', 'hora': '6:55 p. m.'}."""
    r = _leer(state_dir).get(clave)
    if not r:
        return {'estado': 'pendiente'}
    return {'estado': r.get('estado', 'pendiente'), 'para': enmascarar(r.get('para', '')), 'hora': _hora(r.get('hora', ''))}


def enviar_pendientes(state_dir, eventos: list[dict], enviar: Callable[..., None], para: str, max_por_vuelta: int = 5, ahora: float | None = None) -> list[str]:
    """Envía un correo por cada producción sin requerimiento enviado. Devuelve las claves enviadas en esta vuelta."""
    if not para:
        return []
    ahora = time.time() if ahora is None else ahora
    enviadas: list[str] = []
    with _lock:
        datos = _leer(state_dir)
        for ev in eventos:
            if len(enviadas) >= max_por_vuelta:
                break
            clave = ev.get('clave')
            r = datos.get(clave) or {}
            if r.get('estado') == 'enviado':
                continue
            if r.get('estado') == 'error' and (r.get('intentos', 0) >= MAX_INTENTOS or ahora - r.get('ultimo_intento', 0) < ESPERA_REINTENTO):
                continue
            asunto, cuerpo = asunto_y_cuerpo(ev)
            try:
                enviar(asunto, cuerpo, para=para)
            except Exception as error:   # el aviso en pantalla dice que no se pudo y se reintenta
                logging.warning('Requerimiento de tela: no se pudo enviar %s: %s', clave, error)
                datos[clave] = {'estado': 'error', 'para': para, 'intentos': r.get('intentos', 0) + 1, 'ultimo_intento': ahora, 'error': str(error)[:200]}
                continue
            datos[clave] = {'estado': 'enviado', 'para': para, 'hora': datetime.fromtimestamp(ahora, timezone.utc).isoformat(), 'intentos': r.get('intentos', 0) + 1,
                            'ultimo_intento': ahora, 'cliente': ev.get('cliente', ''), 'tela': ev.get('tela', '')}
            enviadas.append(clave)
            logging.info('Requerimiento de tela enviado (%s · %s) a %s', ev.get('cliente'), ev.get('tela'), enmascarar(para))
        # se olvidan los registros de más de 90 días
        limite = ahora - 90 * 86400
        for k in [k for k, v in datos.items() if v.get('ultimo_intento', 0) < limite]:
            datos.pop(k, None)
        _guardar(state_dir, datos)
    return enviadas
