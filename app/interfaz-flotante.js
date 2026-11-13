/* Interfaz flotante global: el menú de arriba (logo, secciones e iconos de la cuenta) flota sin caja ni borde en TODAS las secciones,
   como en Inicio. Solo CSS; no toca datos ni lógica. Solo en escritorio (con menú superior); en móvil el menú lateral queda como estaba.
   Para apagarlo: localStorage.setItem('indoor-menu-flotante-off', '1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-menu-flotante-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('interfaz-flotante')) return;
  const N = 'html body.top-navigation.top-navigation ';
  const css = `
  @media(min-width:861px){
    ${N}.sidebar{background:linear-gradient(180deg,rgba(4,8,5,.8),rgba(4,8,5,0))!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar :is(.brand,.tabs,.topbar,.systems){background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar::before,${N}.sidebar::after{display:none!important}
    ${N}.sidebar .tab{background:transparent!important;border-color:transparent!important;box-shadow:none!important;border-radius:10px!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background .25s!important}
    /* submódulos (áreas) que se abren al pasar por un menú: sin caja, los botones flotan */
    /* submenús largos (7 o más opciones): dos columnas, para que no ocupen toda la altura de la pantalla */
    /* el submenú se abre centrado bajo su botón del menú */
    ${N}.sidebar .nav-children{left:50%!important;right:auto!important;margin-left:0!important;translate:-50% 0}
    ${N}.sidebar .nav-children:has(> .tab:nth-child(7)){grid-template-columns:repeat(2,max-content)!important;grid-template-rows:repeat(8,auto)!important;grid-auto-flow:column!important;column-gap:34px;width:max-content}
    ${N}.sidebar .nav-children:has(> .tab:nth-child(7)) > .tab{min-width:0}
    /* resplandor oscuro difuminado detrás (sin borde ni caja): los nombres se leen aunque abajo haya mockups claros */
    ${N}.sidebar .nav-children{background:radial-gradient(closest-side ellipse at 38% 50%,rgba(3,7,4,.94) 0%,rgba(3,7,4,.86) 55%,rgba(3,7,4,0) 100%)!important;background-color:transparent!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;padding:26px 44px!important}
    ${N}.sidebar .nav-children::before,${N}.sidebar .nav-children::after{display:none!important}
    ${N}.sidebar .nav-children .tab{background:transparent!important;color:#fff!important;font-weight:800!important;text-shadow:0 0 1px #000,0 0 3px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.95),0 2px 16px rgba(0,0,0,.95),0 0 30px rgba(0,0,0,.85)}
    ${N}.sidebar .nav-children .tab.active,${N}.sidebar .nav-children .tab:hover{color:#d0ec93!important}
    ${N}.sidebar .nav-children .tab:hover,${N}.sidebar .nav-children .tab.active{background:rgba(255,255,255,.1)!important;box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.1)!important}
    /* letra del menú superior más grande y cómoda de leer (se adapta al ancho de la pantalla) */
    ${N}.sidebar :is(.tabs > .tab,.tabs > .nav-group > .nav-parent,.nav-group > .nav-parent){font-size:clamp(12.5px,.8vw,16px)!important;letter-spacing:.05em!important;padding-left:.85em!important;padding-right:.85em!important}
    ${N}.sidebar :is(.tab,.nav-parent){text-shadow:none!important;background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar .nav-parent{outline:0!important}
    ${N}.sidebar .tab:hover{background:rgba(255,255,255,.1)!important}
  }
  /* móvil: la barra de arriba flota como en escritorio (sin caja, sin línea inferior, sin recuadro alrededor de los iconos) y la barra de abajo sin borde duro */
  @media(max-width:860px){
    ${N}.sidebar{background:linear-gradient(180deg,rgba(4,8,5,.82),rgba(4,8,5,0))!important;border:0!important;border-bottom:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar .systems{background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar .systems > *{border-color:transparent!important}
    html body nav.mbar{border:0!important;background:linear-gradient(180deg,rgba(10,18,12,.78),rgba(6,12,8,.9))!important;box-shadow:0 14px 34px -10px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.07)!important}
  }
  /* móvil: el menú lateral conserva su fondo, pero los submódulos dentro quedan sin cajas */
  @media(max-width:860px){
    ${N}.sidebar .nav-children{background:none!important;background-color:transparent!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    ${N}.sidebar .nav-children::before,${N}.sidebar .nav-children::after{display:none!important}
    ${N}.sidebar .nav-children .tab{background:transparent!important;border-color:transparent!important;box-shadow:none!important;color:#fff!important;font-weight:800!important;text-shadow:0 0 3px rgba(0,0,0,.95),0 1px 10px rgba(0,0,0,.95)}
    ${N}.sidebar .nav-children .tab.active{background:rgba(255,255,255,.1)!important;color:#d0ec93!important}
  }
  @media(prefers-reduced-motion:reduce){${N}.sidebar .tab{transition:none!important}${N}.sidebar .tab:hover{transform:none!important}}
  `;
  const st = document.createElement('style');
  st.id = 'interfaz-flotante';
  st.textContent = css;
  document.head.appendChild(st);
})();
