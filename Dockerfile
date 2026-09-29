FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl antiword tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY monitor_archivos.py ./monitor_archivos.py
COPY pedidos_legacy.py ./pedidos_legacy.py
# La plantilla Excel se instala solo en servidores que usan el creador de XLSX.
# Cartera no depende de ella; no se incluye para que el panel pueda desplegarse
# sin distribuir un archivo operativo privado.

RUN mkdir -p /data/uploads /data/state /mnt/nas
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:8000/salud || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
