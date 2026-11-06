"""Preparación segura de solicitudes de factura electrónica DIAN.

Los tokens llegan solo en la petición de validación y no se persisten. La
descarga real queda desacoplada hasta que se configure el proveedor autorizado
o el certificado/servicio DIAN aplicable a la compañía.
"""
from __future__ import annotations

import re
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(prefix='/api/dian', tags=['dian'])
_CUFE = re.compile(r'(?i)\b[a-f0-9]{64,128}\b')
MAX_CUFES = 1000


def _leer_cufes(raw: str) -> tuple[list[str], int]:
    texto = str(raw or '')[:500_000]
    # Cada fila pegada de Excel puede traer columnas adicionales: se toma el
    # CUFE/UUID hexadecimal dentro de cada una, sin conservar las otras celdas.
    encontrados = _CUFE.findall(texto)
    normales = [c.upper() for c in encontrados]
    unicos = list(dict.fromkeys(normales))[:MAX_CUFES]
    return unicos, max(0, len(normales) - len(unicos))


def _destino(raw: str) -> str:
    """Ruta relativa bajo el almacenamiento privado; nunca permite salir de él."""
    value = str(raw or '').strip().replace('\\', '/') or 'pendientes'
    if value.startswith('/') or '..' in value.split('/'):
        raise ValueError('La carpeta debe ser relativa; ejemplo: 2026/noviembre.')
    parts = [re.sub(r'[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ _.-]', '_', part).strip() for part in value.split('/')]
    parts = [part for part in parts if part and part not in ('.', '..')]
    if not parts:
        raise ValueError('Indica una carpeta destino válida.')
    return '/'.join(parts)[:180]


@router.post('/preparar')
async def preparar(request: Request):
    payload = await request.json()
    token = str(payload.get('token') or '').strip()
    cufes, duplicados = _leer_cufes(payload.get('cufes') or '')
    if not token:
        raise HTTPException(400, 'Pega el token temporal para continuar. No se guarda en el servidor.')
    if len(token) > 12_000:
        raise HTTPException(400, 'El token supera el tamaño permitido.')
    if not cufes:
        raise HTTPException(400, 'No encontramos CUFEs válidos. Pega una columna de Excel con códigos de 64 a 128 caracteres hexadecimales.')
    try:
        destino = _destino(payload.get('carpeta') or '')
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        'ok': True,
        'token_recibido': True,
        'total': len(cufes),
        'duplicados': duplicados,
        'muestra': [c[:10] + '…' + c[-8:] for c in cufes[:5]],
        'carpeta': destino,
        'limite': MAX_CUFES,
        'siguiente': 'Conecta el proveedor autorizado o el servicio DIAN para descargar XML/PDF.',
    }


@router.get('/estado')
def estado():
    return {
        'token_persistido': False,
        'proveedor_configurado': False,
        'formatos': ['XML UBL', 'PDF si el proveedor autorizado lo entrega'],
        'maximo_cufes': MAX_CUFES,
    }


@router.get('/dian.js')
def script():
    return FileResponse(Path(__file__).with_name('dian.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})
