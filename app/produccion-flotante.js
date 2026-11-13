/* Producción · estilo flotante y de vidrio, a juego con Inicio.
   Solo CSS (sin tocar datos ni lógica): quita bordes y líneas duras, deja botones, chips y tarjetas flotando con sombra suave y
   elimina el backdrop-filter de cientos de elementos (botones, chips, tarjetas), que era lo más pesado de esta pantalla.
   Solo aplica con body.production-mode. Para apagarlo: localStorage.setItem('indoor-flotante-off', '1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-flotante-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('produccion-flotante')) return;
  const P = 'html body.production-mode ';
  const css = `
  /* menos peso: sin desenfoque de fondo en la pantalla de Producción */
  ${P}.production-shell,${P}.production-toolbar,${P}.trace-workspace,${P}.trace-card,${P}.production-kpi,${P}.production-shell :is(button,select,input,summary,details){-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  /* contenedor y barras: sin cajas ni líneas */
  ${P}.production-shell{border-color:transparent!important;box-shadow:none!important;background:transparent!important}
  ${P}.production-toolbar{border-color:transparent!important;border-radius:18px!important;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.015))!important;box-shadow:none!important}
  ${P}.production-process-filter{border-color:transparent!important;background:transparent!important;box-shadow:none!important}
  ${P}.production-kpis,${P}.production-x-scroll,${P}.trace-workspace,${P}.trace-workspace-top,${P}.trace-workspace-top *:not(button):not(select):not(.trace-quick-filters){border-color:transparent!important}
  /* botones, chips, paginación, selectores y buscador flotantes */
  ${P}.production-shell :is(button,select,input.production-search,input.production-zoom):not(.has-value){border-color:transparent!important;box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important;transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,background-color .25s}
  ${P}.production-shell :is(button,select):not(:disabled):hover{filter:brightness(1.14)}
  /* tarjetas */
  ${P}.trace-card{border-color:transparent!important;box-shadow:0 22px 48px -26px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08)!important;transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
  ${P}.trace-card:hover{box-shadow:0 28px 56px -24px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.1)!important}
  /* parte superior y área de trabajo: sin fondos ni cajas, todo flota sobre el fondo */
  ${P}.production-toolbar{background:none!important}
  ${P}.trace-workspace,${P}.trace-cards{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
  ${P}.production-shell summary,${P}.production-shell .trace-density-toggle,${P}.production-shell .trace-scroll-controls{border-color:transparent!important;box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important}
  ${P}.production-kpi{border-color:transparent!important;box-shadow:0 14px 30px -16px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.1)!important}
  /* dentro de la tarjeta: cuadros y botones sin bordes duros */
  ${P}.trace-card :is(.trace-media,.trace-design-count,.trace-stage,.trace-line,.trace-dias){border-color:transparent!important;box-shadow:0 8px 20px -14px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.07)}
  ${P}.trace-card .trace-media{background-color:rgba(255,255,255,.045)}
  /* dentro de la tarjeta: sin bloques contenedores; solo flotan los botones y el texto */
  ${P}.trace-card :is(.trace-mts-display,.trace-machine-top,.trace-primary-facts,.trace-inline-notes,.trace-note-alert,.trace-card-actions,.trace-mts-inventory,.trace-material-facts,.trace-manufacture,.trace-mts-lines){background:none!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  ${P}.trace-card :is(.trace-mts-display,.trace-machine-top,.trace-primary-facts,.trace-inline-notes,.trace-note-alert,.trace-card-actions)::before,${P}.trace-card :is(.trace-mts-display,.trace-machine-top,.trace-primary-facts,.trace-inline-notes,.trace-note-alert,.trace-card-actions)::after{display:none!important}
  ${P}.trace-card :is(button,select):not(.has-value){border-color:transparent!important;box-shadow:0 8px 18px -12px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08)!important}
  ${P}.trace-card :is(button,select).has-value{border-color:rgba(95,150,80,.35)!important}
  /* botones de copiar el mockup: en columna, en el lateral debajo de «DISEÑO 1»; así el mockup usa todo el alto */
  ${P}.trace-card .trace-media{position:relative}
  ${P}.trace-card .trace-media .trace-copy-tools{position:absolute!important;left:10px!important;top:46px!important;right:auto!important;bottom:auto!important;flex-direction:column!important;align-items:center!important;gap:7px!important;margin:0!important;padding:0!important;width:auto!important;z-index:6}
  /* mockup: ocupa todo el alto del recuadro (la etiqueta, el menú y los botones flotan encima en las esquinas) */

  ${P}.trace-card .trace-media .trace-design-main{padding:4px 56px!important}
  /* globitos de ayuda de los iconos de la derecha (Iniciar, Finalizar…): el efecto de vidrio de la página les pone inset:0 y overflow:hidden y quedaban recortados dentro del botón */
  ${P}.trace-rail button{overflow:visible!important}
  ${P}.trace-rail button::after{left:auto!important;bottom:auto!important;top:50%!important;right:46px!important;inset-inline-start:auto!important;z-index:30}
  /* menú «Herramientas»: la barra de arriba queda por encima de los totales y las tarjetas para que su menú desplegable no se tape */
  ${P}.production-shell > .production-toolbar{z-index:40!important}
  ${P}.production-tools-popover{z-index:200!important;background:#1c2517!important;opacity:1!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;border:1px solid rgba(255,255,255,.1)!important;box-shadow:0 22px 48px -18px rgba(0,0,0,.95)!important;border-radius:16px!important}
  /* los chips de filtro no suben al pasar el mouse: si suben, un clic en su borde inferior se pierde y hay que repetirlo */
  ${P}.trace-quick-filters button:hover,${P}.trace-quick-filters button:focus-visible{transform:none!important}
  /* chips de arriba: el número va sin recuadro ni óvalo */
  ${P}.trace-quick-filters button span{background:transparent!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important;outline:0!important}
  /* tarjeta limpia: sin el brillo blanco animado que dejaba una mancha bajo MTS REQUERIDOS, y secciones con aire parejo */
  ${P}.trace-card :is(.trace-machine-btn,.trace-mts-btn,.trace-mts-row button)::before,${P}.trace-card :is(.trace-machine-btn,.trace-mts-btn,.trace-mts-row button)::after{display:none!important;animation:none!important}
  ${P}.trace-card .trace-mts-row{align-items:start;gap:10px 14px;padding:0 4px}
  ${P}.trace-card .trace-card-body{display:flex;flex-direction:column;gap:12px}
  ${P}.trace-card .trace-card-body>*{margin-top:0!important;margin-bottom:0!important}
  ${P}.trace-card .trace-inline-notes{display:flex;flex-direction:column;gap:6px}
  @media(prefers-reduced-motion:reduce){${P}.trace-card,${P}.production-shell :is(button,select){transition:none!important}${P}.trace-card:hover,${P}.production-shell :is(button,select):hover{transform:none}}
  `;
  const st = document.createElement('style');
  st.id = 'produccion-flotante';
  st.textContent = css;
  document.head.appendChild(st);
})();
