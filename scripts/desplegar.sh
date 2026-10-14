#!/usr/bin/env bash
# Despliega archivos de app/ al VPS: uno por uno, al contenedor y a la carpeta del host,
# reinicia una sola vez y espera a que /salud responda 200.
# Uso: scripts/desplegar.sh app/main.py app/cartera.js app/fragmentos/x.html ...
#      scripts/desplegar.sh --cambiados   (archivos de app/ modificados o nuevos sin commitear)
# Los archivos de app/fragmentos/ se suben SIEMPRE antes que el resto (main.py los lee al arrancar).
# Guarda una copia del archivo anterior del host en /opt/asistente-reprogramaciones/app_prev/.
set -euo pipefail

LLAVE="${SSH_KEY:-$HOME/.ssh/hostinger_indoor}"
HOST="root@179.236.66.149"
CONT="asistente-reprogramaciones"
DEST="/opt/asistente-reprogramaciones/app"
PREV="/opt/asistente-reprogramaciones/app_prev"
SSH=(ssh -i "$LLAVE" -o BatchMode=yes "$HOST")

[ -f "$LLAVE" ] || { echo "No existe la llave SSH: $LLAVE (defina SSH_KEY)"; exit 1; }

if [ "${1:-}" = "--cambiados" ]; then
  mapfile -t ARCHIVOS < <({ git diff --name-only HEAD -- app/; git ls-files --others --exclude-standard -- app/; } | sort -u | grep -v '^$' || true)
else
  ARCHIVOS=("$@")
fi
[ "${#ARCHIVOS[@]}" -gt 0 ] || { echo "Nada que desplegar."; exit 1; }

# Fragmentos primero, el resto después
ORDENADOS=()
for f in "${ARCHIVOS[@]}"; do case "$f" in app/fragmentos/*) ORDENADOS+=("$f");; esac; done
for f in "${ARCHIVOS[@]}"; do case "$f" in app/fragmentos/*) ;; *) ORDENADOS+=("$f");; esac; done

# 1) Comprobar todo ANTES de tocar el servidor
for f in "${ORDENADOS[@]}"; do
  case "$f" in app/*) ;; *) echo "Solo se despliegan archivos de app/: $f"; exit 1;; esac
  [ -f "$f" ] || { echo "No existe: $f"; exit 1; }
  case "$f" in
    *.py) python -W ignore -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$f" ;;
    *.js) node --check "$f" ;;
  esac
done

# 2) Subir uno por uno (ruta relativa a app/, creando subcarpetas)
for f in "${ORDENADOS[@]}"; do
  rel="${f#app/}"
  dir="$(dirname "$rel")"
  tmp="/tmp/despliegue_$$_$(basename "$rel")"
  echo "-> $rel"
  scp -i "$LLAVE" -q "$f" "$HOST:$tmp"
  "${SSH[@]}" "set -e
    mkdir -p '$DEST/$dir' '$PREV/$dir'
    docker exec $CONT mkdir -p '/app/app/$dir'
    [ -f '$DEST/$rel' ] && cp '$DEST/$rel' '$PREV/$rel' || true
    cp '$tmp' '$DEST/$rel'
    docker cp '$tmp' '$CONT:/app/app/$rel'
    rm -f '$tmp'"
done

# 3) Reiniciar y esperar /salud (hasta ~90 s)
"${SSH[@]}" "docker restart $CONT" >/dev/null
echo "Reiniciado; esperando /salud..."
codigo=000
for _ in $(seq 1 18); do
  sleep 5
  codigo="$(curl -s -o /dev/null -w '%{http_code}' https://produccion.cloud/salud || true)"
  [ "$codigo" = "200" ] && break
done
echo "https://produccion.cloud/salud -> $codigo"
[ "$codigo" = "200" ] || { echo "El panel no respondió: revise 'docker logs $CONT'. Copias anteriores en $PREV"; exit 1; }
