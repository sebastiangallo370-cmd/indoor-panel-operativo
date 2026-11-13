/* Agentes de edición · interfaz flotante, a juego con Producción: sin bloques ni recuadros.
   Solo CSS (no toca datos ni lógica): las cajas (cabecera, resumen de la orden, chat, muestras, listado…) pierden fondo, borde, sombra y desenfoque;
   los botones, pestañas, chips y campos flotan con una sombra suave. Los menús desplegables y los mensajes del chat conservan su fondo para leerse.
   Para apagarlo: localStorage.setItem('indoor-agentes-flotante-off','1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-agentes-flotante-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('agentes-flotante')) return;
  const P = 'html body .panel[data-panel="agentes"] ';
  const FLOTA = 'box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important;border-color:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important';
  const css = `
  /* cajas: sin fondo, borde ni sombra */
  ${P}:is(header,section,nav,aside,details,div,form,figure,ul,ol,li,table,thead,tbody,tfoot,tr,td,th,fieldset):not(.ag-msg):not([class*="ag-menu"]):not([class*="ag-dlg"]):not([class*="ag-toast"]):not([class*="ag-pop"]):not(.ag-msg *){background:none!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  /* la tarjeta de imagen/muestra conserva su imagen pero sin marco */
  ${P}:is(.ag-lienzo,.ag-muestras,.ag-live-vista,.ag-live-tira) img,${P}:is(.ag-lienzo,.ag-muestras,.ag-live-vista,.ag-live-tira) canvas{border-color:transparent!important}
  /* botones, pestañas, selectores y campos: flotantes */
  ${P}:is(button,input,textarea,select,summary,a.ag-btn,.ag-btn,.ag-tab,.ag-vt,.ag-chat-tg){${FLOTA};transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,background-color .25s}
  ${P}:is(button,a.ag-btn,.ag-btn,.ag-tab,.ag-vt):not(:disabled):hover{filter:brightness(1.14)}
  /* chips y estados: píldoras flotantes */
  ${P}:is(.ag-pill,.ag-pildora,.ag-ochip,.ag-dissel,.tiempo,.ag-chip,.ag-state,.ag-sug){${FLOTA}}
  /* franja del resumen de la orden: sin degradado de fondo */
  ${P}.ag-res::before,${P}.ag-res::after{display:none!important}
  /* chat: las respuestas de los agentes van como texto, sin burbuja; tus mensajes quedan como una píldora flotante */
  ${P}.ag-msg.bot,${P}.ag-msg:not(.yo){background:none!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important}
  ${P}.ag-msg.yo{background-color:rgba(208,236,147,.1)!important;border-color:transparent!important;box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important}
  ${P}:is(.ag-kv,.ag-file,.ag-file.sticker,article){background:none!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important}
  ${P}iframe{border-color:transparent!important;box-shadow:none!important;border-radius:14px}
  /* menús desplegables: conservan fondo, sin borde duro */
  ${P}:is(.ag-menu-l,.ag-mas-menu){border-color:transparent!important}
  @media(prefers-reduced-motion:reduce){${P}:is(button,input,textarea,select,summary){transition:none!important}${P}:is(button,a.ag-btn,.ag-btn,.ag-tab,.ag-vt):hover{transform:none!important}}
  `;
  const st = document.createElement('style');
  st.id = 'agentes-flotante';
  st.textContent = css;
  document.head.appendChild(st);
})();
