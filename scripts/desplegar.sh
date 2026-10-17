#!/usr/bin/env bash
# Despliega archivos de app/ al VPS en UNA sola conexión SSH: sube todo junto (tar), lo copia al contenedor y a la carpeta del host
# (de donde se reconstruye la imagen) y reinicia SOLO si hace falta. Si lo único que cambió son archivos .js no reinicia (se sirven desde disco
# en cada petición): el cambio se ve al instante. Al reiniciar, espera a que el panel responda mirando cada segundo (no cada 5).
# Uso: scripts/desplegar.sh app/main.py app/cartera.js app/fragmentos/x.html ...
#      scripts/desplegar.sh --cambiados   (archivos de app/ modificados o nuevos sin commitear)
#      scripts/desplegar.sh --reiniciar ... (fuerza el reinicio aunque solo sean .js)
# Guarda una copia del archivo anterior del host en /opt/asistente-reprogramaciones/app_prev/.
set -euo pipefail

LLAVE="${SSH_KEY:-$HOME/.ssh/hostinger_indoor}"
HOST="root@179.236.66.149"
CONT="asistente-reprogramaciones"
DEST="/opt/asistente-reprogramaciones/app"
PREV="/opt/asistente-reprogramaciones/app_prev"

[ -f "$LLAVE" ] || { echo "No existe la llave SSH: $LLAVE (defina SSH_KEY)"; exit 1; }

FORZAR=0
if [ "${1:-}" = "--reiniciar" ]; then FORZAR=1; shift; fi
if [ "${1:-}" = "--cambiados" ]; then
  mapfile -t ARCHIVOS < <({ git diff --name-only HEAD -- app/; git ls-files --others --exclude-standard -- app/; } | sort -u | grep -v '^$' || true)
else
  ARCHIVOS=("$@")
fi
[ "${#ARCHIVOS[@]}" -gt 0 ] || { echo "Nada que desplegar."; exit 1; }

# 1) Comprobar todo ANTES de tocar el servidor, y decidir si hace falta reiniciar
RELS=()
REINICIAR="$FORZAR"
for f in "${ARCHIVOS[@]}"; do
  case "$f" in app/*) ;; *) echo "Solo se despliegan archivos de app/: $f"; exit 1;; esac
  [ -f "$f" ] || { echo "No existe: $f"; exit 1; }
  case "$f" in
    *.py) python -W ignore -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$f"; REINICIAR=1 ;;
    *.js) node --check "$f" ;;
    *) REINICIAR=1 ;;   # fragmentos, json, html...: se leen al arrancar
  esac
  RELS+=("${f#app/}")
  echo "-> ${f#app/}"
done

# 2) Una sola conexión: subir (tar por stdin), copiar al host y al contenedor, y reiniciar solo si hace falta
INICIO=$(date +%s)
tar -cf - -C app "${RELS[@]}" | ssh -i "$LLAVE" -o BatchMode=yes "$HOST" "set -e
  STAGE=/tmp/despliegue_$$; rm -rf \$STAGE; mkdir -p \$STAGE; tar -xf - -C \$STAGE
  cd \$STAGE
  find . -type f | while read -r f; do
    rel=\"\${f#./}\"; d=\"\$(dirname \"\$rel\")\"
    mkdir -p \"$DEST/\$d\" \"$PREV/\$d\"
    [ -f \"$DEST/\$rel\" ] && cp \"$DEST/\$rel\" \"$PREV/\$rel\" || true
    cp \"\$f\" \"$DEST/\$rel\"
  done
  docker exec $CONT mkdir -p /app/app
  docker cp \$STAGE/. $CONT:/app/app/
  rm -rf \$STAGE
  if [ '$REINICIAR' = '1' ]; then
    docker restart $CONT >/dev/null
    for i in \$(seq 1 120); do docker exec $CONT curl -fsS -o /dev/null http://localhost:8000/salud 2>/dev/null && break; sleep 1; done
    echo reiniciado
  else
    echo sin-reinicio
  fi"
FIN=$(date +%s)

# 3) Comprobación pública
codigo=000
for _ in 1 2 3 4 5 6; do
  codigo="$(curl -s -o /dev/null -w '%{http_code}' https://produccion.cloud/salud || true)"
  [ "$codigo" = "200" ] && break
  sleep 1
done
echo "https://produccion.cloud/salud -> $codigo  ($((FIN - INICIO)) s)"
[ "$codigo" = "200" ] || { echo "El panel no respondió: revise 'docker logs $CONT'. Copias anteriores en $PREV"; exit 1; }
