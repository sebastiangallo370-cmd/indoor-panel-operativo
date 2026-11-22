FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# El modelo se descarga al construir la imagen: en uso no necesita internet
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

COPY servidor.py .

EXPOSE 8000
CMD ["uvicorn", "servidor:app", "--host", "0.0.0.0", "--port", "8000"]
