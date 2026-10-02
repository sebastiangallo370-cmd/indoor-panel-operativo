"""Cartera externa: trae el proyecto de Cartera de la red de la oficina a través de este servidor.

- Solo funciona con sesión iniciada y si el servidor tiene CARTERA_EXTERNA_ENABLED=1 (hoy: desactivado).
- Solo habla con la dirección configurada (CARTERA_EXTERNA_URL); no es un proxy abierto.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response


externa_router = APIRouter()
BASE = os.getenv("CARTERA_EXTERNA_URL", "http://192.168.0.140:8080").rstrip("/")
PREFIX = "/cartera-externa"
_FORWARD_HEADERS = ("content-type", "x-usuario", "accept")
_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def linked() -> bool:
    """Desactivado por defecto: solo se activa con CARTERA_EXTERNA_ENABLED=1 en el servidor."""
    return os.getenv("CARTERA_EXTERNA_ENABLED", "0") == "1"


@externa_router.get(PREFIX)
def externa_root_redirect():
    return RedirectResponse(PREFIX + "/", status_code=307)


@externa_router.api_route(PREFIX + "/{path:path}", methods=_METHODS)
async def externa_proxy(path: str, request: Request):
    if not linked():
        return JSONResponse({"error": "La conexión con el proyecto de Cartera está desactivada."}, status_code=409)
    if ".." in path.split("/"):
        return JSONResponse({"error": "Ruta no permitida"}, status_code=400)
    url = f"{BASE}/{path}"
    headers = {name: value for name, value in request.headers.items() if name.lower() in _FORWARD_HEADERS}
    body = await request.body()
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            upstream = await client.request(request.method, url, params=request.query_params, content=body or None, headers=headers)
    except httpx.HTTPError as error:
        return JSONResponse({"error": f"No se pudo conectar con el proyecto de Cartera: {error.__class__.__name__}"}, status_code=502)
    content = upstream.content
    content_type = upstream.headers.get("content-type", "application/octet-stream")
    if request.method == "GET" and content_type.startswith("text/html") and path in ("", "index.html"):
        # La aplicación llama a "/api/..." desde la raíz; bajo este prefijo debe llamar a "/cartera-externa/api/...".
        content = content.replace(b"fetch('/api'", f"fetch('{PREFIX}/api'".encode())
    return Response(content=content, status_code=upstream.status_code, media_type=content_type.split(";")[0],
                    headers={"Cache-Control": "no-store", "Content-Type": content_type})
