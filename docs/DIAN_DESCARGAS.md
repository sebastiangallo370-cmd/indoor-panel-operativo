# Descargas DIAN centralizadas

## Flujo por usuario

1. El usuario pega su enlace/token temporal de DIAN.
2. Pega los CUFEs desde Excel; el panel conserva uno por fila.
3. Elige una subcarpeta dentro de `DIAN DESCARGAS` de la NAS. Es una carpeta
   central, no una ruta de Windows del computador: así cualquier usuario ve el
   mismo resultado sin dejar un PC encendido.
4. Inicia el lote. El servidor reserva y procesa **un CUFE a la vez**.
5. El panel actualiza el estado y los archivos del destino cada cinco segundos.

El token no se guarda en la base de datos ni en registros técnicos. Se mantiene
solamente en memoria durante el lote. Si el servidor se reinicia, el lote queda
en `requires_token` y el usuario debe pegar un token nuevo y usar **Reanudar
con este token**. Un trabajo que quede reservado más de diez minutos se marca
`uncertain` para revisión; nunca se descarga o reenvía de nuevo automáticamente.

## Datos persistentes

- Base de lotes: `/data/state/dian_descargas.sqlite3`.
- Archivos: `/mnt/nas/DIAN DESCARGAS/<subcarpeta elegida>`.
- No se permite salir de esa raíz con rutas relativas o `..`.

## Worker independiente

La aplicación web no debe automatizar el portal. Un proceso Playwright separado
reclama el siguiente trabajo en `POST /api/dian/worker/claim` con el encabezado
`X-DIAN-Worker-Token`, descarga el comprobante y confirma el resultado en
`POST /api/dian/worker/result`.

Resultados admitidos:

- `downloaded`: hay evidencia visible del archivo aceptado y guardado.
- `failed`: error conocido, por ejemplo CUFE no disponible.
- `uncertain`: cambio de interfaz, desconexión o evidencia insuficiente. No se
  reintenta automáticamente.

Antes de activar el worker se debe comprobar el flujo real en DIAN con un CUFE
de prueba y un token temporal nuevo. Los selectores del portal pueden cambiar;
por eso no se publica un worker que haga clics a ciegas ni se marca una descarga
como realizada sin evidencia.

Para instalarlo en el VPS, cuando estén validados los selectores, se construye
con `docker compose -f docker-compose.dian-worker.yml up -d --build`. El worker
no arranca una descarga hasta que reciba `DIAN_WORKER_TOKEN` y los selectores
`DIAN_SEARCH_URL`, `DIAN_CUFE_SELECTOR`, `DIAN_SEARCH_SELECTOR` y el selector
del formato requerido. Esto evita descargar o marcar comprobantes erróneos.

## Configuración de producción

En el servidor, fuera de Git:

```env
DIAN_DOWNLOAD_ROOT=/mnt/nas/DIAN DESCARGAS
DIAN_WORKER_TOKEN_FILE=/data/state/dian_worker_token
```

El archivo `dian_worker_token` debe contener un secreto aleatorio de al menos
32 caracteres, con permisos solo para el servicio web y el worker. El token de
DIAN del usuario no va en `.env`.
