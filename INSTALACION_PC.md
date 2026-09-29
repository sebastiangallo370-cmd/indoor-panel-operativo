# Instalación del Panel Operativo en PC Windows

## Opción A: Con Docker (Recomendada)

### 1. Instalar Docker Desktop

- Descargar de: https://www.docker.com/products/docker-desktop/
- Ejecutar el instalador, reiniciar el PC cuando lo pida
- Abrir Docker Desktop y esperar a que diga "Docker is running"

### 2. Instalar Git

- Descargar de: https://git-scm.com/download/win
- Instalar con las opciones por defecto

### 3. Clonar el proyecto

Abrir **PowerShell** o **CMD** y ejecutar:

```cmd
cd "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\Automatizacion\Edicion"
git clone https://github.com/sebastiangallo370-cmd/indoor-panel-operativo.git
cd indoor-panel-operativo
```

### 4. Configurar archivos necesarios

```cmd
:: Copiar el .env de ejemplo
copy .env.example .env

:: Crear carpeta de secretos
mkdir secrets
```

Editar `.env` con Notepad y poner los valores reales:

```cmd
notepad .env
```

Copiar estos archivos manualmente al proyecto:
- **FORMATO_EXCEL.xlsx** → raíz del proyecto
- **google-service-account.json** → carpeta `secrets/`

### 5. Arrancar

```cmd
docker compose up -d --build
```

Abrir en el navegador: **http://localhost:8000**

---

## Opción B: Sin Docker (Solo Python)

### 1. Instalar Python 3.12

- Descargar de: https://www.python.org/downloads/
- **IMPORTANTE**: Marcar ☑ "Add Python to PATH" durante la instalación

### 2. Instalar Git

- Descargar de: https://git-scm.com/download/win
- Instalar con opciones por defecto

### 3. Instalar Tesseract OCR

- Descargar de: https://github.com/UB-Mannheim/tesseract/wiki
- Instalar el .exe (incluir idiomas Spanish y English)
- Agregar al PATH: `C:\Program Files\Tesseract-OCR`

### 4. Clonar el proyecto

Abrir **PowerShell** y ejecutar:

```powershell
cd "\\192.168.0.120\nas indoor\DIRECCION PRODUCCION\CARPETAS PERSONALES\GALLO\Automatizacion\Edicion"
git clone https://github.com/sebastiangallo370-cmd/indoor-panel-operativo.git
cd indoor-panel-operativo
```

### 5. Instalar dependencias de Python

```powershell
pip install -r requirements.txt
pip install python-dotenv
```

### 6. Configurar archivos

```powershell
copy .env.example .env
mkdir secrets
```

Editar `.env`:

```powershell
notepad .env
```

Valores mínimos para desarrollo local (sin Google Sheets ni Supabase):

```env
# Agregar esta línea al inicio del .env para modo desarrollo:
DISABLE_EXTERNAL_SYNC=1

APP_USER=indoor
APP_PASSWORD=TU_CLAVE_AQUI

NAS_CLIENTES_PATH=\\192.168.0.120\nas indoor\CLIENTES
GOOGLE_SHEETS_URL=https://docs.google.com/spreadsheets/d/TU_ID/edit
GOOGLE_SHEETS_GID=0
PEDIDOS_GOOGLE_SHEETS_GID=1514880696
GOOGLE_CREDENTIALS=secrets/google-service-account.json
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_KEY=TU_KEY
PAGOS_COTIZACIONES_FILE_ID=TU_ID
PAGOS_COTIZACIONES_HOJA=CONTROL DE PAGOS
SMTP_EMAIL=TU_CORREO@gmail.com
SMTP_PASSWORD=TU_CLAVE_APP
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
```

Copiar archivos:
- **FORMATO_EXCEL.xlsx** → raíz del proyecto
- **google-service-account.json** → carpeta `secrets/`

### 7. Crear carpetas de datos

```powershell
mkdir data\uploads\pedidos
mkdir data\state
```

### 8. Arrancar el servidor

```powershell
python start_dev.py
```

Abrir en el navegador: **http://localhost:8000**

---

## Verificar que funciona

1. Abrir **http://localhost:8000** en el navegador
2. Debe aparecer la página de login de Indoor Sport
3. Entrar con usuario/clave del .env
4. Probar subir un PDF de prueba

## Verificar salud del servidor

Abrir: **http://localhost:8000/salud**

Debe mostrar:
```json
{"estado": "ok", "nas_disponible": true, ...}
```

## Comandos útiles

| Acción | Docker | Solo Python |
|---|---|---|
| Arrancar | `docker compose up -d` | `python start_dev.py` |
| Parar | `docker compose down` | Ctrl+C en la terminal |
| Ver logs | `docker compose logs -f asistente` | Se ven en la terminal |
| Reconstruir | `docker compose up -d --build` | Reiniciar `start_dev.py` |
| Actualizar código | `git pull` y reconstruir | `git pull` y reiniciar |

## Notas

- **DISABLE_EXTERNAL_SYNC=1** en el .env evita que intente conectar a Google Sheets y Supabase al arrancar. Quitar esa línea cuando tengas las credenciales reales configuradas.
- El servidor con `start_dev.py` tiene **auto-reload**: si cambias el código, se reinicia solo.
- El NAS debe estar accesible desde el PC (la ruta `\\192.168.0.120\nas indoor\CLIENTES` debe abrir en el explorador).
