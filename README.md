# Asistente de Reprogramaciones

## Trabajo desde otro computador

Este repositorio guarda el código del panel operativo. No incluye contraseñas,
bases de datos, archivos de clientes, cachés de mockups ni la plantilla Excel.
La aplicación publicada y sus datos permanecen en el servidor existente.

Antes de construir en otro equipo, proporcionar `FORMATO_EXCEL.xlsx` por un
canal privado autorizado en la raíz del proyecto y configurar `.env` y
`secrets/google-service-account.json`. Estos archivos no se deben versionar.
Los archivos del NAS requieren acceso privado a la red correspondiente.

Los cambios en GitHub no se publican automáticamente en la web: primero deben
revisarse, probarse y desplegarse en el servidor, preservando su carpeta `data`.

Aplicación web para recibir cotizaciones o remisiones PDF, generar el listado de
producción, guardar los archivos en el NAS y registrar la información en Google
Sheets y Supabase.

## Arquitectura

- FastAPI sirve la interfaz y procesa los PDF.
- Docker mantiene la aplicación aislada y reinicia el servicio ante fallos.
- El NAS se monta en `/mnt/nas-indoor` mediante una VPN privada. Nunca se publica
  SMB/puerto 445 en Internet.
- La cuenta de servicio de Google se monta como archivo de solo lectura.
- Los secretos se guardan en `.env`, que no debe subirse a repositorios.

## Preparación del servidor

1. Instalar Docker y el complemento Compose.
2. Conectar el VPS y el NAS por Tailscale o WireGuard.
3. Montar el recurso SMB `NAS INDOOR` en `/mnt/nas-indoor` con CIFS.
4. Copiar este directorio a `/opt/asistente-reprogramaciones`.
5. Copiar `.env.example` a `.env` y completar los valores.
6. Guardar la cuenta de servicio como `secrets/google-service-account.json`.
7. Ejecutar `docker compose up -d --build`.
8. Publicar el puerto 8000 detrás de un proxy HTTPS con dominio.

## Verificación

```bash
docker compose ps
curl http://127.0.0.1:8000/salud
docker compose logs --tail=100 asistente
```

El endpoint `/salud` debe mostrar `nas_disponible: true` y
`google_credenciales: true` antes de procesar documentos reales.

## Seguridad

- Cambiar `APP_PASSWORD` por una contraseña larga.
- Rotar las credenciales que estaban guardadas en el proyecto anterior.
- Limitar la cuenta SMB a la carpeta necesaria y con los permisos mínimos.
- No copiar `config.json`, `.env` ni el JSON de Google a repositorios públicos.
