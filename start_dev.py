"""Development server launcher - loads .env properly and starts uvicorn."""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

project_dir = Path(__file__).resolve().parent
os.chdir(project_dir)

env_file = project_dir / ".env"
if env_file.exists():
    loaded = load_dotenv(env_file, override=True)
    print(f"[start_dev] .env cargado desde: {env_file} (ok={loaded})")
else:
    print(f"[start_dev] AVISO: No se encontro .env en {env_file}")

sync_flag = os.getenv("DISABLE_EXTERNAL_SYNC", "")
print(f"[start_dev] DISABLE_EXTERNAL_SYNC = '{sync_flag}'")
if sync_flag.strip().lower() in ("1", "true", "yes"):
    print("[start_dev] Google Sheets y Supabase sync DESACTIVADOS")
else:
    print("[start_dev] Google Sheets y Supabase sync ACTIVOS")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
