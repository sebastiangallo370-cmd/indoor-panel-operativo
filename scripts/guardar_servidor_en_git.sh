#!/usr/bin/env bash
# Guarda en GitHub (en una RAMA NUEVA, nunca en main) el código que está corriendo hoy en el servidor.
# Sirve cuando alguien cambió el panel directo en el VPS (scp / docker cp) sin hacer push: así ese trabajo queda en git y no se pierde.
# Correr en el VPS como root, en la Consola web de Hostinger.
#
#   1) Crea en GitHub un token SOLO para este repo y por 1 día:  GitHub > Settings > Developer settings > Personal access tokens >
#      Fine-grained tokens > Generate new token  ·  Repository access: Only select repositories > indoor-panel-operativo  ·
#      Permissions > Contents: Read and write  ·  Expiration: 1 day.   (El token se escribe SOLO en la consola del servidor, no en ningún chat.)
#   2) En la consola:   export GH_TOKEN='pega_aqui_el_token'
#   3) Vista previa (NO sube nada):   bash guardar_servidor_en_git.sh
#   4) Si la vista previa se ve bien:  bash guardar_servidor_en_git.sh --subir
#   5) Borra el token en GitHub (Settings > Developer settings) y en la consola:  unset GH_TOKEN
set -euo pipefail
REPO=sebastiangallo370-cmd/indoor-panel-operativo
DESTINO=${DESTINO:-/opt/asistente-reprogramaciones}
[ -n "${GH_TOKEN:-}" ] || { echo "Falta GH_TOKEN (ver las instrucciones al inicio del script)"; exit 1; }
[ -d "$DESTINO/app" ] || { echo "No existe $DESTINO/app"; exit 1; }

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
printf '#!/bin/sh\necho "%s"\n' "$GH_TOKEN" > "$work/askpass"; chmod 700 "$work/askpass"   # el token no queda en la URL ni en el historial de git
export GIT_ASKPASS="$work/askpass" GIT_TERMINAL_PROMPT=0
git clone -q --branch main --depth 50 "${REPO_URL:-https://x-access-token@github.com/$REPO.git}" "$work/repo"
cd "$work/repo"
git config user.name "Servidor Indoor"; git config user.email "servidor@indoor.invalid"

# Lo que el servidor ejecuta de verdad: app/ y los archivos que el despliegue copia junto a ella
rm -rf app && cp -a "$DESTINO/app" app
find app -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find app -name '*.pyc' -delete
for f in Dockerfile requirements.txt monitor_archivos.py pedidos_legacy.py; do [ -f "$DESTINO/$f" ] && cp "$DESTINO/$f" "$f"; done

# Nada que no deba ir a GitHub: bases de datos, .env, secretos, contraseñas, archivos grandes
prohibidos=$(find app Dockerfile requirements.txt monitor_archivos.py pedidos_legacy.py -type f \( -name '.env*' -o -name '*.sqlite3' -o -name '*.db' -o -name 'usuarios_panel.html' -o -name 'FORMATO_EXCEL.xlsx' -o -path '*/secrets/*' -o -size +3M \) 2>/dev/null || true)
claves=$(grep -rIlE 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' app 2>/dev/null || true)
if [ -n "$prohibidos$claves" ]; then
  echo "ABORTO: hay archivos que no deben subirse a GitHub:"; echo "$prohibidos"; echo "$claves"; exit 2
fi

git add -A
echo "=== Qué cambia el servidor respecto a main (archivos) ==="
git status --short | head -80
echo "=== Resumen ==="
git diff --cached --stat | tail -3
if [ "${1:-}" != "--subir" ]; then
  echo; echo "Vista previa solamente: NO se subió nada. Si se ve bien, corre de nuevo con --subir"; exit 0
fi
[ -n "$(git status --porcelain)" ] || { echo "El servidor es idéntico a main: no hay nada que guardar"; exit 0; }
rama="respaldo-servidor-$(date +%Y%m%d-%H%M)"
git checkout -q -b "$rama"
git commit -q -m "Código que corría en el servidor $(date +%F) (guardado desde el VPS, sin pasar por git)"
git push -q origin "$rama"
echo "LISTO: subido a la rama $rama (main no se tocó)"
