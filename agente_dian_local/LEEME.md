# Agente DIAN local

Este paquete se guarda en la NAS para distribuirlo a los PCs. En cada PC se instala una copia local: así cada persona puede usar su token temporal y seleccionar Escritorio, una carpeta de red/NAS o cualquier carpeta de Windows.

## Instalación por PC

1. Desde `AGENTES_INDOOR\\codigo\\agente_dian_local` en la NAS ejecute `INSTALAR_DESDE_NAS.bat`.
2. Espere a que instale Playwright/Chromium una sola vez.
3. Abra `INICIAR_AGENTE_DIAN.bat` en la copia local indicada por el instalador.
4. En `http://127.0.0.1:17877`, elija la carpeta y pegue el token DIAN.

El navegador se abre visible y conserva su sesión local en el perfil de ese PC. El token no se guarda en disco. Si DIAN muestra CAPTCHA, NIT, MFA u otra verificación, debe resolverla el usuario autorizado. El agente no evita ni automatiza esas validaciones.

Las descargas que la persona inicie desde ese navegador se guardan en la carpeta elegida antes de abrir la sesión.
