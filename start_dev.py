"""Development server launcher - loads .env properly and starts uvicorn."""
import os
from pathlib import Path
from dotenv import load_dotenv

os.chdir(Path(__file__).resolve().parent)
load_dotenv(override=True)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
