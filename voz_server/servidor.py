"""Transcripción de notas de voz (español) con Whisper local. Corre en su propio contenedor, sin conexión a internet
en cada uso: el modelo se descarga una vez al construir la imagen.

POST /transcribir  (multipart: archivo de audio, cabecera X-Voz-Token)  ->  {"texto": "...", "segundos": 1.2}
GET  /salud                                                             ->  {"ok": true}
"""
import hmac
import os
import tempfile
import time

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

TOKEN = os.getenv('VOZ_TOKEN', '')
MODELO = os.getenv('VOZ_MODELO', 'small')
MAX_BYTES = 10 * 1024 * 1024   # una nota de voz de Telegram pesa mucho menos

app = FastAPI(title='Voz Indoor')
_modelo = None


def _cargar():
    global _modelo
    if _modelo is None:
        _modelo = WhisperModel(MODELO, device='cpu', compute_type='int8')
    return _modelo


@app.get('/salud')
def salud():
    return {'ok': True, 'modelo': MODELO}


@app.post('/transcribir')
async def transcribir(archivo: UploadFile = File(...), x_voz_token: str = Header(default='')):
    if not TOKEN or not hmac.compare_digest(x_voz_token, TOKEN):
        raise HTTPException(401, 'Token inválido')
    datos = await archivo.read()
    if not datos or len(datos) > MAX_BYTES:
        raise HTTPException(400, 'Audio vacío o demasiado grande')
    with tempfile.NamedTemporaryFile(suffix='.ogg', delete=False) as f:
        f.write(datos)
        ruta = f.name
    try:
        inicio = time.time()
        segmentos, _ = _cargar().transcribe(ruta, language='es', beam_size=1, vad_filter=True)
        texto = ' '.join(s.text.strip() for s in segmentos).strip()
        return {'texto': texto, 'segundos': round(time.time() - inicio, 2)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f'No se pudo transcribir: {exc.__class__.__name__}')
    finally:
        try:
            os.unlink(ruta)
        except OSError:
            pass
