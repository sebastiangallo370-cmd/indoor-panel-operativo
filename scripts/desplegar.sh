#!/usr/bin/env bash
# Despliega archivos de app/ al VPS: uno por uno, al contenedor y a la carpeta del host,
# reinicia una sola vez y comprueba /salud.
# Uso: scripts/desplegar.sh app/main.py app/cartera.js ...
#      scripts/desplegar.sh --cambiados      (archivos de app/ con cambios sin commitear)
set -euo pipefail

LLAVE="${SSH_KEY:-$HOME/.ssh/hostinger_indoor}"
HOST="root@179.236.66.149"
CONT="asistente-reprogramaciones"
DEST="/opt/asistente-reprogramaciones/app"
SSH=(ssh -i "$LLAVE" -o BatchMode=yes "$HOST")

[ -f "$LLAVE" ] || { echo "No existe la llave SSH: $LLAVE (defina SSH_KEY)"; exit 1; }

if [ "${1:-}" = "--cambiados" ]; then
  mapfile -t ARCHIVOS < <(git diff --name-only HEAD -- app/ | grep -v '^$' || true)
else
  ARCHIVOS=("$@")
fi
[ "${#ARCHIVOS[@]}" -gt 0 ] || { echo "Nada que desplegar."; exit 1; }

for f in "${ARCHIVOS[@]}"; do
  [ -f "$f" ] || { echo "No existe: $f"; exit 1; }
  case "$f" in
    *.py) python -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$f" ;;
    *.js) node --check "$f" ;;
  esac
done

for f in "${ARCHIVOS[@]}"; do
  nombre="$(basename "$f")"
  echo "-> $nombre"
  scp -i "$LLAVE" -q "$f" "$HOST:/tmp/${nombre}.nuevo"
  "${SSH[@]}" "docker cp /tmp/${nombre}.nuevo $CONT:/app/app/$nombre && cp /tmp/${nombre}.nuevo $DEST/$nombre && rm /tmp/${nombre}.nuevo"
done

"${SSH[@]}" "docker restart $CONT" >/dev/null
echo "Reiniciado; esperando 15 s..."
sleep 15
codigo="$(curl -s -o /dev/null -w '%{http_code}' https://produccion.cloud/salud || true)"
echo "https://produccion.cloud/salud -> $codigo"
[ "$codigo" = "200" ]
