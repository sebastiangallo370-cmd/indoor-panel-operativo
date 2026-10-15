"""Ayudante de INSTALAR_AGENTES_EDICION.vbs: guarda la ruta de CLIENTES y el código de conexión con el panel en datos/."""
import json
import sys
from pathlib import Path

base = Path(__file__).resolve().parent
datos = base / "datos"
datos.mkdir(exist_ok=True)


def _leer(archivo):
    try:
        return json.loads(archivo.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


if len(sys.argv) >= 3 and sys.argv[1] == "ordenes":
    cfg = datos / "config.json"
    d = _leer(cfg)
    d["ordenes_dir"] = [sys.argv[2]]
    cfg.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Carpeta de órdenes:", sys.argv[2])
elif len(sys.argv) >= 3 and sys.argv[1] == "panel":
    url = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else "https://produccion.cloud"
    (datos / "panel.json").write_text(json.dumps({"url": url, "token": sys.argv[2].strip()}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Conexión con el panel guardada.")
elif len(sys.argv) >= 3 and sys.argv[1] == "ecommerce":
    url = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else "https://produccion.cloud"
    destino = base / "ecommerce" / "datos"
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "panel.json").write_text(json.dumps({"url": url, "token": sys.argv[2].strip()}, ensure_ascii=False, indent=2), encoding="utf-8")
    (destino / "sin_enlace.txt").unlink(missing_ok=True)
    print("Conexión de ECOMMERCE con el panel guardada.")
else:
    print("Uso: configurar_instalacion.py ordenes <ruta> | panel <codigo> [url] | ecommerce <codigo> [url]")
    sys.exit(1)
