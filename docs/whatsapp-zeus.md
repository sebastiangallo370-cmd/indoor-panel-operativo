# WhatsApp Web para ZEUS

Este componente notifica al encargado autorizado de la tela cuando ZEUS crea una orden de compra en Effi. El correo existente se conserva; WhatsApp usa la misma información esencial, sin adjuntar ni guardar una copia del PDF.

## Seguridad y operación

- La cola está en el servidor y el worker de Playwright debe ejecutarse en el PC supervisado que tiene la cuenta de WhatsApp.
- El perfil de Playwright (`WHATSAPP_PROFILE_DIR`) y el token (`WHATSAPP_WORKER_TOKEN`) son secretos: no se suben a Git ni se copian desde Chrome. En el servidor el token se guarda en `/data/state/whatsapp_worker_token` con permisos privados.
- Solo los administradores que ya pueden gestionar ZEUS pueden consultar la cola, cambiar su configuración o autorizar destinatarios.
- Un número se guarda en formato internacional; Colombia `3113351601` se normaliza a `+573113351601`. Debe quedar autorizado explícitamente antes de crear mensajes.
- El worker procesa uno por uno. Si WhatsApp cambia, el número no existe, se desconecta o no aparece evidencia visual, se guarda `uncertain`; nunca se reintenta en automático.
- `sent` significa que WhatsApp Web mostró y aceptó el botón Enviar. No significa entregado ni leído.

## Instalación en el PC de WhatsApp

1. Instalar Python 3.11 o superior.
2. En una carpeta privada, instalar `pip install -r requirements-whatsapp-worker.txt`. El worker usa el Google Chrome ya instalado en el PC; no toca el perfil habitual ni requiere descargar otro navegador.
3. Definir variables de entorno locales: `WHATSAPP_PANEL_URL=https://produccion.cloud`, `WHATSAPP_WORKER_TOKEN=<token privado del servidor>` y `WHATSAPP_PROFILE_DIR=<carpeta privada fuera del repositorio>`.
4. Ejecutar `python scripts/whatsapp_worker.py`. Se abrirá un Chromium visible: escanear el QR una sola vez si lo solicita.

## Prueba y activación

La configuración inicial queda con `enabled=false` y `test_mode=true`. En este estado un mensaje de prueba se prepara y queda registrado, pero no se envía.

Para una prueba real supervisada: autorizar el número, revisar el texto en la cola, desactivar temporalmente `test_mode`, activar `enabled`, y observar el navegador del worker. Pausar la cola al terminar la prueba. No se deben enviar mensajes reales durante desarrollo sin una autorización explícita de la persona responsable.

## Limitaciones

WhatsApp Web puede cambiar su interfaz, cerrar sesión o imponer restricciones a cuentas que automatizan acciones. Por eso el worker es visible, no intenta evadir controles y deja el resultado como incierto cuando no puede comprobar el envío.
