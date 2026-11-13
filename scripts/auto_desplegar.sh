#!/usr/bin/env bash
# Publica solo el panel: cada minuto (cron) mira el último commit de main en GitHub y, si cambió,
# lo descarga, revisa la sintaxis, copia app/ y reconstruye el contenedor. Si /salud no responde 200,
# vuelve a la versión anterior. No toca .env, secrets/ ni data/.
# PROTECCIÓN: si alguien cambió app/ a mano en el servidor (scp / docker cp) sin hacer push, NO publica (pisaría ese trabajo): avisa en el log y se detiene.
#   «auto_desplegar.sh --adoptar» da por bueno lo que corre hoy en el servidor (guarda su huella y marca como ya publicado el main actual).
#   «auto_desplegar.sh --huella» solo guarda la huella (úsalo cuando main ya contiene lo que corre y quieres que se publique el main pendiente).
# Instalar (una vez, como root en el VPS):
#   curl -sL https://raw.githubusercontent.com/sebastiangallo370-cmd/indoor-panel-operativo/main/scripts/auto_desplegar.sh -o /usr/local/bin/auto_desplegar.sh
#   chmod +x /usr/local/bin/auto_desplegar.sh
#   echo '* * * * * root /usr/local/bin/auto_desplegar.sh >> /var/log/auto_desplegar.log 2>&1' > /etc/cron.d/auto_desplegar
set -euo pipefail
REPO=sebastiangallo370-cmd/indoor-panel-operativo
DESTINO=${DESTINO:-/opt/asistente-reprogramaciones}
ESTADO=${ESTADO:-/var/lib/auto_desplegar}
mkdir -p "$ESTADO"
# huella (sha256 de cada archivo) del código de app/ que hay en el servidor; sin __pycache__
manifiesto() { (cd "$1" && find . -type f ! -path '*/__pycache__/*' ! -name '*.pyc' -print0 | sort -z | xargs -0 -r sha256sum); }
if [ "${1:-}" = "--huella" ]; then   # solo guarda la huella del código actual del servidor; el próximo commit de main (incluso el actual, si aún no se publicó) SÍ se publica
  manifiesto "$DESTINO/app" > "$ESTADO/manifiesto"; rm -f "$ESTADO/bloqueado"
  echo "Huella guardada: $(wc -l < "$ESTADO/manifiesto") archivos de app/. Se publicará el main que aún no se haya publicado."
  exit 0
fi
if [ "${1:-}" = "--adoptar" ]; then
  manifiesto "$DESTINO/app" > "$ESTADO/manifiesto"
  git ls-remote "https://github.com/$REPO.git" refs/heads/main | cut -f1 > "$ESTADO/ultimo"
  rm -f "$ESTADO/bloqueado"
  echo "Adoptado: $(wc -l < "$ESTADO/manifiesto") archivos de app/ · main $(cut -c1-7 "$ESTADO/ultimo") marcado como ya publicado. Solo se publicarán commits NUEVOS de main."
  exit 0
fi
exec 9>"$ESTADO/lock"; flock -n 9 || exit 0   # nunca dos publicaciones a la vez

sha=$(timeout 30 git ls-remote "https://github.com/$REPO.git" refs/heads/main | cut -f1) || exit 0
[ -n "$sha" ] || exit 0
[ "$sha" = "$(cat "$ESTADO/ultimo" 2>/dev/null)" ] && exit 0

# --- protección contra pisar cambios hechos a mano en el servidor ---
bloquear() { echo "$sha" > "$ESTADO/bloqueado"; exit 0; }
ya_avisado=$([ "$(cat "$ESTADO/bloqueado" 2>/dev/null)" = "$sha" ] && echo si || echo no)
if [ ! -s "$ESTADO/manifiesto" ]; then
  [ "$ya_avisado" = si ] || echo "$(date -Is) NO SE PUBLICA $sha: no hay huella del código del servidor. Si lo que corre ya está en GitHub, ejecuta una vez: auto_desplegar.sh --adoptar"
  bloquear
fi
if ! manifiesto "$DESTINO/app" | cmp -s - "$ESTADO/manifiesto"; then
  if [ "$ya_avisado" = no ]; then
    echo "$(date -Is) NO SE PUBLICA $sha: app/ del servidor tiene cambios hechos a mano que NO están en GitHub (se pisarían). Archivos distintos:"
    { diff <(manifiesto "$DESTINO/app") "$ESTADO/manifiesto" | grep '^[<>]' | awk '{print "   " $3}' | sort -u | head -30; } || true
    cp -a "$DESTINO/app" "$ESTADO/deriva-$(date +%Y%m%d-%H%M%S)"
    echo "   (copia de ese código guardada en $ESTADO/deriva-*). Guárdalo en git (scripts/guardar_servidor_en_git.sh) y luego ejecuta: auto_desplegar.sh --adoptar"
  fi
  bloquear
fi

echo "$(date -Is) nuevo commit $sha"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL -m 120 "https://github.com/$REPO/archive/$sha.tar.gz" | tar xz -C "$tmp" --strip-components=1
python3 -W ignore -c "import ast,glob;[ast.parse(open(f,encoding='utf-8-sig').read(),f) for f in glob.glob('$tmp/app/*.py')]" \
  || { echo "error de sintaxis: no se publica"; echo "$sha" > "$ESTADO/ultimo"; exit 1; }

# copia de seguridad del código actual para volver atrás si algo falla
rm -rf "$ESTADO/anterior"; mkdir -p "$ESTADO/anterior"
cp -a "$DESTINO/app" "$DESTINO/Dockerfile" "$DESTINO/requirements.txt" "$ESTADO/anterior/"

# Qué cambió: decide cuánto hay que reiniciar (para no cortar la página si no hace falta)
#   - Dockerfile o requirements.txt  -> reconstruir la imagen (~1 min de corte)
#   - algún .py                      -> copiar al contenedor y reiniciarlo (~6 s)
#   - solo .js/.html/.css/...        -> copiar al contenedor, SIN reiniciar (0 s de corte)
cambiados=$(cd "$tmp/app" && find . -type f ! -path '*/__pycache__/*' | while read -r f; do cmp -s "$f" "$DESTINO/app/$f" || echo "$f"; done)
modo=estaticos
if ! cmp -s "$tmp/Dockerfile" "$DESTINO/Dockerfile" || ! cmp -s "$tmp/requirements.txt" "$DESTINO/requirements.txt"; then modo=reconstruir
elif echo "$cambiados" | grep -q '\.py$'; then modo=reiniciar; fi
echo "$(date -Is) cambiados: $(echo "$cambiados" | grep -c . ) archivo(s) · modo $modo"

cp -r "$tmp/app/." "$DESTINO/app/"
cp "$tmp/Dockerfile" "$tmp/requirements.txt" "$tmp/monitor_archivos.py" "$tmp/pedidos_legacy.py" "$DESTINO/"
cd "$DESTINO"
if [ "$modo" = reconstruir ]; then
  docker compose up -d --build asistente
else
  # el contenedor corre con la imagen vieja: se le copian los archivos (el host ya quedó al día para el próximo rebuild)
  echo "$cambiados" | while read -r f; do [ -n "$f" ] || continue; docker exec asistente-reprogramaciones mkdir -p "/app/app/$(dirname "$f")"; docker cp "$DESTINO/app/$f" "asistente-reprogramaciones:/app/app/$f"; done
  [ "$modo" = reiniciar ] && docker restart asistente-reprogramaciones
fi

for i in $(seq 1 24); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 https://produccion.cloud/salud)" = 200 ]; then
    echo "$sha" > "$ESTADO/ultimo"; manifiesto "$DESTINO/app" > "$ESTADO/manifiesto"; echo "$(date -Is) publicado $sha (salud 200)"; exit 0
  fi
  sleep 5
done

echo "$(date -Is) /salud no responde: se vuelve a la versión anterior"
rm -rf "$DESTINO/app"; cp -a "$ESTADO/anterior/app" "$DESTINO/app"
cp "$ESTADO/anterior/Dockerfile" "$ESTADO/anterior/requirements.txt" "$DESTINO/"
docker compose up -d --build --force-recreate asistente
manifiesto "$DESTINO/app" > "$ESTADO/manifiesto"
echo "$sha" > "$ESTADO/ultimo"   # no se reintenta el mismo commit roto
exit 1
