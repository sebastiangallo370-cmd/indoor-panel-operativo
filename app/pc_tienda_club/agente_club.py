"""AGENTES TIENDA CLUB · un agente (NOVA, BRUJULA o SELLO) en el PC de la oficina.

Cada agente le pide al panel el siguiente paso de su rol (POST /api/tienda-club-agentes/pc/paso) y cuenta lo que pasó. El trabajo en sí (leer la cotización,
armar el paquete, programar en Producción) lo hace el panel contra la NAS y Producción; el agente es quien lo dispara, lo vigila y lo reintenta, y lo que se ve
en el panel (estado, actividad, registro) sale de aquí. Si el panel o la red fallan, reintenta solo.

    python agente_club.py --rol recibe | prepara | programa
Lee datos\\panel.json (dirección y código del enlace, el mismo que usa el puente).
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / 'datos'
COLA = AQUI / 'cola'
ESPERA_SEG = 5          # entre revisiones cuando no hay trabajo
ESPERA_ERROR_SEG = 15   # tras un fallo de red o del panel
NOMBRES = {'recibe': 'NOVA', 'prepara': 'BRUJULA', 'programa': 'SELLO'}


def log(texto: str):
    print(texto, flush=True)


def latido(rol: str, actividad: str, ultima=None, proxima=None, intervalo=None):
    """Estado en vivo para el panel (cola/estado_<rol>.json)."""
    try:
        COLA.mkdir(parents=True, exist_ok=True)
        ruta = COLA / f'estado_{rol}.json'
        try:
            datos = json.loads(ruta.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            datos = {}
        datos.update({'actividad': actividad, 'at': time.time()})
        for clave, valor in (('ultima', ultima), ('proxima', proxima), ('intervalo', intervalo)):
            if valor is not None:
                datos[clave] = valor
        tmp = ruta.with_suffix('.tmp')
        tmp.write_text(json.dumps(datos), encoding='utf-8')
        tmp.replace(ruta)
    except OSError:
        pass


def pedir_paso(rol: str) -> dict:
    panel = json.loads((DATOS / 'panel.json').read_text(encoding='utf-8-sig'))
    req = urllib.request.Request(panel['url'].rstrip('/') + '/api/tienda-club-agentes/pc/paso', data=json.dumps({'rol': rol}).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', 'X-TiendaClub-Token': panel['token']}, method='POST')
    with urllib.request.urlopen(req, timeout=300) as r:   # el panel copia archivos de la NAS: puede tardar
        return json.loads(r.read().decode('utf-8'))


def correr(rol: str):
    nombre = NOMBRES[rol]
    log(f'{nombre} · listo: pido al panel el siguiente paso de «{rol}».')
    while True:
        try:
            r = pedir_paso(rol)
            ahora = time.time()
            if not r.get('hubo'):
                latido(rol, str(r.get('detalle') or 'Esperando reposiciones'), ultima=ahora, proxima=ahora + ESPERA_SEG, intervalo=ESPERA_SEG)
                time.sleep(ESPERA_SEG)
                continue
            texto = f'Reposición #{r.get("pedido")}: {r.get("detalle")}'
            if r.get('ok'):
                log(texto)
                latido(rol, texto[:120], ultima=ahora)
                time.sleep(1)
            else:
                log(f'[Error] {texto}')   # «con avisos»: se corrige y se reintenta desde el panel
                latido(rol, 'Con avisos: ' + str(r.get('detalle'))[:100], ultima=ahora)
                time.sleep(ESPERA_ERROR_SEG)
        except KeyboardInterrupt:
            break
        except urllib.error.HTTPError as e:
            log(f'[Error] El panel respondió {e.code} (¿código de enlace vencido?). Reintentando…')
            latido(rol, f'El panel respondió {e.code}')
            time.sleep(ESPERA_ERROR_SEG)
        except Exception as e:  # noqa: BLE001
            log(f'[Error] {e}. Reintentando…')
            latido(rol, 'Sin conexión con el panel')
            time.sleep(ESPERA_ERROR_SEG)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rol', choices=tuple(NOMBRES), required=True)
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(line_buffering=True, encoding='utf-8', errors='replace')
    except Exception:
        pass
    correr(args.rol)


if __name__ == '__main__':
    main()
