FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=America/Bogota CHROME_BIN=/usr/bin/chromium CHROMEDRIVER=/usr/bin/chromedriver
WORKDIR /zeus

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium chromium-driver fonts-liberation tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agente_zeus.py agente_effitron.py effi_api.py ./

CMD ["python", "agente_zeus.py"]
