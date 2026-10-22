#!/usr/bin/env bash
# Publica solo el panel: cada minuto (cron) mira el último commit de main en GitHub y, si cambió,
# lo descarga, revisa la sintaxis, copia app/ y reconstruye el contenedor. Si /salud no responde 200,
# vuelve a la versión anterior. No toca .env, secrets/ ni data/.
# Instalar (una vez, como root en el VPS):
#   curl -sL https://raw.githubusercontent.com/sebastiangallo370-cmd/indoor-panel-operativo/main/scripts/auto_desplegar.sh -o /usr/local/bin/auto_desplegar.sh
#   chmod +x /usr/local/bin/auto_desplegar.sh
#   echo '* * * * * root /usr/local/bin/auto_desplegar.sh >> /var/log/auto_desplegar.log 2>&1' > /etc/cron.d/auto_desplegar
set -euo pipefail
REPO=sebastiangallo370-cmd/indoor-panel-operativo
DESTINO=/opt/asistente-reprogramaciones
ESTADO=/var/lib/auto_desplegar
mkdir -p "$ESTADO"
exec 9>"$ESTADO/lock"; flock -n 9 || exit 0   # nunca dos publicaciones a la vez

sha=$(timeout 30 git ls-remote "https://github.com/$REPO.git" refs/heads/main | cut -f1) || exit 0
[ -n "$sha" ] || exit 0
[ "$sha" = "$(cat "$ESTADO/ultimo" 2>/dev/null)" ] && exit 0
echo "$(date -Is) nuevo commit $sha"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL -m 120 "https://github.com/$REPO/archive/$sha.tar.gz" | tar xz -C "$tmp" --strip-components=1
python3 -W ignore -c "import ast,glob;[ast.parse(open(f,encoding='utf-8-sig').read(),f) for f in glob.glob('$tmp/app/*.py')]" \
  || { echo "error de sintaxis: no se publica"; echo "$sha" > "$ESTADO/ultimo"; exit 1; }

# copia de seguridad del código actual para volver atrás si algo falla
rm -rf "$ESTADO/anterior"; mkdir -p "$ESTADO/anterior"
cp -a "$DESTINO/app" "$DESTINO/Dockerfile" "$DESTINO/requirements.txt" "$ESTADO/anterior/"

cp -r "$tmp/app/." "$DESTINO/app/"
cp "$tmp/Dockerfile" "$tmp/requirements.txt" "$tmp/monitor_archivos.py" "$tmp/pedidos_legacy.py" "$DESTINO/"
cd "$DESTINO" && docker compose up -d --build asistente

for i in $(seq 1 24); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 https://produccion.cloud/salud)" = 200 ]; then
    echo "$sha" > "$ESTADO/ultimo"; echo "$(date -Is) publicado $sha (salud 200)"; exit 0
  fi
  sleep 5
done

echo "$(date -Is) /salud no responde: se vuelve a la versión anterior"
rm -rf "$DESTINO/app"; cp -a "$ESTADO/anterior/app" "$DESTINO/app"
cp "$ESTADO/anterior/Dockerfile" "$ESTADO/anterior/requirements.txt" "$DESTINO/"
docker compose up -d --build asistente
echo "$sha" > "$ESTADO/ultimo"   # no se reintenta el mismo commit roto
exit 1
