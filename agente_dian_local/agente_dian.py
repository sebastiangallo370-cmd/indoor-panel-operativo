"""Agente local DIAN para cada computador de Indoor Sport.

El agente abre un navegador visible con un perfil local y dirige las descargas
iniciadas en ese navegador a la carpeta elegida por la persona. No almacena el
token ni intenta evadir CAPTCHA, MFA ni otros controles de la DIAN.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

APP = FastAPI(title="Agente DIAN Indoor", docs_url=None, redoc_url=None)
# Solo el panel publicado puede controlar este servicio de loopback.  El agente
# sigue escuchando exclusivamente en 127.0.0.1, nunca en la red local.
APP.add_middleware(
    CORSMiddleware,
    allow_origins=["https://produccion.cloud"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    allow_private_network=True,
)


@APP.middleware("http")
async def permitir_panel_en_red_privada(request, call_next):
    """Autoriza únicamente la conexión HTTPS del panel al agente loopback.

    Chrome solicita este encabezado adicional al pasar de produccion.cloud a
    localhost (Private Network Access). No se abre el servicio a la red.
    """
    response = await call_next(request)
    if request.headers.get("origin") == "https://produccion.cloud":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response
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


@APP.post("/reiniciar")
def reiniciar():
    """Cierra únicamente la sesión administrada y deja el agente listo para otro lote."""
    global _playwright, _context, _page
    with LOCK:
        try:
            if _context is not None:
                _context.close()
        finally:
            _context = None
            _page = None
            _download_hooked_pages.clear()
            if _playwright is not None:
                try:
                    _playwright.stop()
                except Exception:
                    pass
            _playwright = None
            STATE.update(connected=False, browser=False, folder="", message="Agente reiniciado. Elige carpeta y abre una nueva sesión DIAN.")
    return {"ok": True, **STATE}


@APP.get("/", response_class=HTMLResponse)
def index():
    return """<!doctype html><meta charset=utf-8><title>Agente DIAN · Indoor Sport</title>
<style>body{margin:0;font-family:system-ui;background:#06140b;color:#eff9e7}.wrap{max-width:760px;margin:8vh auto;padding:28px}.brand{color:#caff3d;letter-spacing:.12em;font-size:12px;font-weight:900}h1{margin:8px 0 6px}h2{font-size:17px;margin:0}p{color:#b7c9b4}.row{display:flex;gap:10px;flex-wrap:wrap}input,textarea{flex:1;min-width:280px;padding:13px;border:1px solid #4f8358;border-radius:10px;background:#112c19;color:#fff;font:13px ui-monospace,Consolas,monospace}textarea{box-sizing:border-box;width:100%;min-height:92px;resize:vertical}button{padding:12px 16px;border:1px solid #79a96a;border-radius:10px;background:#244f2c;color:#fff;font-weight:800;cursor:pointer}.main{background:#caff3d;color:#14210e;border-color:#caff3d}.queue{margin-top:24px;padding:18px;border:1px solid #315c3a;border-radius:14px;background:#0d2113}.queue small{color:#a9c6a6}.current{margin:12px 0;padding:12px;border-radius:9px;background:#06140b;word-break:break-all;font:12px ui-monospace,Consolas,monospace}.progress{color:#caff3d;font-weight:800}#state{margin-top:20px;padding:14px;border-left:3px solid #caff3d;background:#0d2113;white-space:pre-wrap}.note{font-size:13px;border-top:1px solid #294932;margin-top:26px;padding-top:16px}</style>
<main class=wrap><div class=brand>INDOOR SPORT · AGENTE LOCAL</div><h1>DIAN en este computador</h1><p>Elige primero la carpeta de destino. Después pega el token y abre DIAN en un navegador visible. Si DIAN exige CAPTCHA, NIT o una confirmación, la completa la persona usuaria.</p><div class=row><button id=folder>Elegir carpeta</button><span id=folderName></span><button id=restart>Reiniciar agente</button></div><p>Token temporal (no se guarda):</p><div class=row><input id=token placeholder="https://catalogo-vpfe.dian.gov.co/User/AuthToken?..." autocomplete=off><button class=main id=open>Abrir DIAN</button></div><pre id=state>Cargando estado…</pre><section class=queue><h2>Cola de CUFEs</h2><p>Pega todos los CUFEs una vez. El agente te entrega el siguiente, lo copia y lleva el avance; tú confirmas la descarga oficial en DIAN.</p><textarea id=cufes placeholder="Pega aquí los CUFEs, uno por línea"></textarea><div class=row><button id=load>Preparar cola</button><button id=copy class=main disabled>Copiar siguiente CUFE</button><button id=done disabled>Marcar descargado</button></div><div class=current id=current>Sin CUFEs cargados.</div><small class=progress id=progress></small></section><p class=note>Las descargas que se inicien desde el navegador administrado se guardan en la carpeta elegida. Este agente no salta CAPTCHA ni controles de seguridad de DIAN.</p></main><script>
const CUFE=/\\b[a-f0-9]{64,128}\\b/gi,KEY='indoor-dian-cufe-queue-v1';let queue=[];try{queue=JSON.parse(sessionStorage.getItem(KEY)||'[]')}catch(_){queue=[]}const save=()=>sessionStorage.setItem(KEY,JSON.stringify(queue));
const renderQueue=()=>{let i=queue.findIndex(x=>!x.done),item=queue[i],total=queue.length,doneN=queue.filter(x=>x.done).length;current.textContent=item?item.value:(total?'Cola terminada.':'Sin CUFEs cargados.');progress.textContent=total?`${doneN} de ${total} confirmados · ${Math.max(total-doneN,0)} pendientes`:'';copy.disabled=!item;done.disabled=!item};
const status=async()=>{const d=await fetch('/health').then(r=>r.json());state.textContent=d.message+'\\nCarpeta: '+(d.folder||'sin seleccionar');folderName.textContent=d.folder?'✓ '+d.folder:''};
folder.onclick=async()=>{await fetch('/carpeta',{method:'POST'});status()};restart.onclick=async()=>{if(!confirm('Se cerrará únicamente la ventana de DIAN administrada por el agente. ¿Continuar?'))return;await fetch('/reiniciar',{method:'POST'});token.value='';queue=[];sessionStorage.removeItem(KEY);renderQueue();status()};open.onclick=async()=>{let r=await fetch('/sesion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token_url:token.value})});let d=await r.json();state.textContent=d.message||d.detail||'No se pudo abrir DIAN';setTimeout(status,1200)};load.onclick=()=>{let values=[...new Set((cufes.value.match(CUFE)||[]).map(x=>x.toUpperCase()))];queue=values.map(value=>({value,done:false}));save();renderQueue()};copy.onclick=async()=>{let item=queue.find(x=>!x.done);if(item){await navigator.clipboard.writeText(item.value);copy.textContent='CUFE copiado';setTimeout(()=>copy.textContent='Copiar siguiente CUFE',900)}};done.onclick=()=>{let item=queue.find(x=>!x.done);if(item){item.done=true;save();renderQueue()}};renderQueue();status();setInterval(status,5000);
</script>"""


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(APP, host="127.0.0.1", port=17877, log_level="warning")
