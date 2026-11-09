"""Agente local DIAN para cada computador de Indoor Sport.

El agente abre un navegador visible con un perfil local y dirige las descargas
iniciadas en ese navegador a la carpeta elegida por la persona. No almacena el
token ni intenta evadir CAPTCHA, MFA ni otros controles de la DIAN.
"""
from __future__ import annotations

import os
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

APP = FastAPI(title="Agente DIAN Indoor", docs_url=None, redoc_url=None)
BASE = Path(os.getenv("LOCALAPPDATA", Path.home())) / "IndoorSport" / "AgenteDIAN"
PROFILE = BASE / "perfil_chrome"
STATE = {"connected": False, "folder": "", "message": "Agente local listo", "browser": False}
LOCK = threading.Lock()
_playwright = None
_context = None
_page = None
_download_hooked_pages: set[int] = set()


class SessionRequest(BaseModel):
    token_url: str


def _valid_token(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
    except ValueError as exc:
        raise HTTPException(400, "El enlace del token no es válido.") from exc
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or not (host == "dian.gov.co" or host.endswith(".dian.gov.co")):
        raise HTTPException(400, "El token debe ser un enlace HTTPS oficial de dian.gov.co.")
    return url.strip()


def _choose_directory() -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.attributes("-topmost", True)
        chosen = filedialog.askdirectory(title="Selecciona la carpeta para comprobantes DIAN")
        root.destroy()
        return chosen
    except Exception as exc:
        raise HTTPException(500, f"No se pudo abrir el selector de carpetas: {exc}") from exc


def _open_browser(token_url: str) -> None:
    global _playwright, _context, _page
    from playwright.sync_api import sync_playwright
    BASE.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    downloads = Path(STATE["folder"]) if STATE["folder"] else BASE / "descargas_pendientes"
    downloads.mkdir(parents=True, exist_ok=True)
    def save_download(download) -> None:
        """Conserva cada descarga en el destino elegido, no en la caché temporal."""
        try:
            folder = Path(STATE["folder"])
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / Path(download.suggested_filename).name
            download.save_as(str(target))
            STATE["message"] = f"Archivo guardado en: {target.name}"
        except Exception as exc:
            STATE["message"] = f"No se pudo conservar una descarga: {exc}"

    try:
        with LOCK:
            if _context is None:
                _playwright = sync_playwright().start()
                # Chrome instalado ofrece la sesión visible que el usuario reconoce.
                _context = _playwright.chromium.launch_persistent_context(
                    str(PROFILE), channel="chrome", headless=False, accept_downloads=True,
                    downloads_path=str(downloads), viewport={"width": 1440, "height": 900},
                )
                _page = _context.pages[0] if _context.pages else _context.new_page()
                _context.on("page", lambda page: page.on("download", save_download))
            else:
                # Las descargas nuevas se gestionan por la carpeta elegida antes de abrir la sesión.
                _page = _context.pages[0] if _context.pages else _context.new_page()
            # Una página puede reutilizarse al renovar el token. Registramos el
            # manejador una sola vez para no intentar guardar dos veces el mismo
            # archivo si se abre DIAN nuevamente durante la misma sesión.
            page_key = id(_page)
            if page_key not in _download_hooked_pages:
                _page.on("download", save_download)
                _download_hooked_pages.add(page_key)
            _page.goto(token_url, wait_until="domcontentloaded", timeout=60000)
            _page.bring_to_front()
        STATE.update(connected=True, browser=True, message="DIAN está abierto en este PC. Completa manualmente cualquier validación oficial.")
    except Exception as exc:
        STATE.update(connected=False, browser=False, message=f"No se pudo abrir Chrome para DIAN: {type(exc).__name__}: {exc}")


@APP.get("/health")
def health():
    return {"ok": True, **{k: v for k, v in STATE.items() if k != "token"}}


@APP.post("/carpeta")
def carpeta():
    if _context is not None:
        raise HTTPException(409, "La sesión DIAN ya está abierta. Cierra el agente y ábrelo de nuevo para cambiar de carpeta.")
    folder = _choose_directory()
    if not folder:
        return {"selected": False, **STATE}
    STATE.update(folder=folder, message=f"Carpeta elegida: {folder}")
    return {"selected": True, **STATE}


@APP.post("/sesion")
def sesion(payload: SessionRequest):
    token_url = _valid_token(payload.token_url)
    thread = threading.Thread(target=_open_browser, args=(token_url,), daemon=True)
    thread.start()
    # El token queda solo en el navegador/hilo actual; nunca en archivos o logs.
    return {"started": True, "message": "Abriendo DIAN en Chrome local. Revisa la ventana que aparece."}


@APP.get("/", response_class=HTMLResponse)
def index():
    return """<!doctype html><meta charset=utf-8><title>Agente DIAN · Indoor Sport</title>
<style>body{margin:0;font-family:system-ui;background:#06140b;color:#eff9e7}.wrap{max-width:760px;margin:8vh auto;padding:28px}.brand{color:#caff3d;letter-spacing:.12em;font-size:12px;font-weight:900}h1{margin:8px 0 6px}p{color:#b7c9b4}.row{display:flex;gap:10px;flex-wrap:wrap}input{flex:1;min-width:280px;padding:13px;border:1px solid #4f8358;border-radius:10px;background:#112c19;color:#fff}button{padding:12px 16px;border:1px solid #79a96a;border-radius:10px;background:#244f2c;color:#fff;font-weight:800;cursor:pointer}.main{background:#caff3d;color:#14210e;border-color:#caff3d}#state{margin-top:20px;padding:14px;border-left:3px solid #caff3d;background:#0d2113;white-space:pre-wrap}.note{font-size:13px;border-top:1px solid #294932;margin-top:26px;padding-top:16px}</style>
<main class=wrap><div class=brand>INDOOR SPORT · AGENTE LOCAL</div><h1>DIAN en este computador</h1><p>Elige primero la carpeta de destino. Después pega el token y abre DIAN en un navegador visible. Si DIAN exige CAPTCHA, NIT o una confirmación, la completa la persona usuaria.</p><div class=row><button id=folder>Elegir carpeta</button><span id=folderName></span></div><p>Token temporal (no se guarda):</p><div class=row><input id=token placeholder="https://catalogo-vpfe.dian.gov.co/User/AuthToken?..." autocomplete=off><button class=main id=open>Abrir DIAN</button></div><pre id=state>Cargando estado…</pre><p class=note>Las descargas que se inicien desde el navegador administrado se guardan en la carpeta elegida. Este agente no salta CAPTCHA ni controles de seguridad de DIAN.</p></main><script>
const status=async()=>{const d=await fetch('/health').then(r=>r.json());state.textContent=d.message+'\\nCarpeta: '+(d.folder||'sin seleccionar');folderName.textContent=d.folder?'✓ '+d.folder:''};
folder.onclick=async()=>{await fetch('/carpeta',{method:'POST'});status()};open.onclick=async()=>{let r=await fetch('/sesion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token_url:token.value})});let d=await r.json();state.textContent=d.message||d.detail||'No se pudo abrir DIAN';setTimeout(status,1200)};status();setInterval(status,5000);
</script>"""


if __name__ == "__main__":
    import uvicorn
    webbrowser.open("http://127.0.0.1:17877")
    uvicorn.run(APP, host="127.0.0.1", port=17877, log_level="warning")
