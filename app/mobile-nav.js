// Solo celular (hasta 700 px): el menú superior se reemplaza por una barra inferior flotante con 4 accesos y «Menú».
// «Menú» abre una hoja con todas las secciones y subpáginas y un buscador; una sección con una sola página va directo. En computador no cambia nada.
// También: el avatar muestra iniciales en lugar del nombre completo.
(() => {
  const MOBILE = '(max-width:700px)';
  const style = document.createElement('style');
  style.textContent = `
.mbar,.msheet,.msheet-backdrop{display:none}
.mf-toggle{display:none}
.user-menu summary{display:flex;align-items:center;gap:10px;padding:6px 14px 6px 6px!important;border-radius:999px!important;border:1px solid rgba(208,244,76,.22)!important;background:linear-gradient(145deg,#1b2417,#10150e)!important;cursor:pointer;transition:border-color .18s,box-shadow .18s,transform .12s}
.user-menu summary:hover,.user-menu[open] summary{border-color:rgba(208,244,76,.6)!important;box-shadow:0 0 0 3px rgba(208,244,76,.12)}
.user-menu summary:active{transform:scale(.98)}
.user-menu .user-avatar{width:38px!important;height:38px!important;flex:0 0 38px;display:grid!important;place-items:center;border-radius:50%!important;background:linear-gradient(145deg,#d9ff5a,#b5e834)!important;color:#11150e!important;font:900 14px/1 Arial,sans-serif!important;letter-spacing:.02em!important;overflow:hidden!important;white-space:nowrap!important;box-shadow:inset 0 -3px 6px rgba(0,0,0,.18)}
.user-menu .user-info{display:grid;gap:1px;text-align:left}
.user-menu .user-info strong{font:800 13px/1.2 Arial,sans-serif!important;color:#f0f9d2!important;letter-spacing:.01em}
.user-menu .user-info small{font:700 10.5px/1.2 Arial,sans-serif!important;color:#9fb08c!important;letter-spacing:.06em;text-transform:uppercase}
.user-menu summary>span[aria-hidden]{color:#d0f44c;font-size:15px;line-height:1;margin-left:2px;transition:transform .18s}
.user-menu[open] summary>span[aria-hidden]{transform:rotate(180deg)}
/* Computador: botones de Stock tela más pequeños */
@media (min-width:701px){
  .inventory-toolbar .inventory-movement-actions{gap:6px!important}
  .inventory-toolbar .inventory-movement-actions button{min-height:0!important;height:32px!important;padding:0 12px!important;font-size:12px!important;letter-spacing:.02em!important;border-radius:8px!important}
}
@media ${MOBILE}{
  html body.top-navigation .sidebar nav.tabs{display:none!important}
  /* Todo un poco más pequeño y nunca más ancho que la pantalla: sin scroll horizontal de la página */
  html,body{overflow-x:hidden!important;max-width:100vw!important}
  html body main{zoom:.88;max-width:100%!important;box-sizing:border-box;overflow-x:clip}
  html body main *,html body main *::before,html body main *::after{min-width:0}
  html body main img,html body main svg,html body main video,html body main canvas,html body main iframe{max-width:100%}
  html body main :is(input,select,textarea){max-width:100%;box-sizing:border-box}
  html body dialog{max-width:100vw!important;box-sizing:border-box}
  html body main :is(h1,h2){font-size:clamp(1.2rem,6vw,1.6rem)!important;overflow-wrap:anywhere}
  html body main :is(p,span,li,td,th,label,strong,small,b,a,button){overflow-wrap:anywhere}
  /* Tarjeta de producción: Referencia en su propia fila y Máquina / Cantidad lado a lado (antes quedaban en 3 columnas de 47 px y se partían) */
  html body.production-mode .trace-card .trace-primary-facts.trace-primary-facts{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:8px!important;align-items:start!important}
  html body .trace-primary-facts>div:first-child{grid-column:1/-1}
  html body.production-mode .trace-card .trace-primary-facts .trace-ref{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
  html body.production-mode .trace-card .trace-primary-facts .trace-machine-btn{height:auto!important;min-height:34px!important;font-size:13px!important}
  html body .trace-primary-facts .trace-machine-fact{min-width:0!important;max-width:100%}
  html body .trace-primary-facts .trace-machine-fact :is(button,select,input){max-width:100%!important;width:100%!important;box-sizing:border-box}
  html body .trace-primary-facts dd,html body .trace-primary-facts dt{overflow-wrap:anywhere;word-break:normal}
  /* Filtros plegables: un botón «Filtros» y, al abrirlo, los campos de dos en dos */
  html body .rework-filters,html body .bd-filters,html body .bg-filters{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
  html body .mf-form:not(.mf-open){display:none!important}
  html body .mf-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:44px;margin:0 0 8px;padding:0 16px;border:1px solid rgba(208,244,76,.35);border-radius:14px;background:#151d15;color:#e7ff9a;font:800 13px Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
  html body .mf-toggle span{color:#d0f44c;font-size:12px;transition:transform .2s}
  html body .mf-toggle.on span{transform:rotate(180deg)}
  html body .mf-toggle b{margin-left:8px;padding:1px 8px;border-radius:99px;background:#d0f44c;color:#10150e;font-size:11px}
  html body.top-navigation .sidebar{height:auto!important;min-height:0!important;max-height:none!important}
  html body main{padding-bottom:calc(110px + env(safe-area-inset-bottom))!important}
  /* Barra inferior: 4 accesos + «Menú». «Menú» abre la hoja con TODAS las secciones y subpáginas (con buscador); los grupos con una sola página van directo */
  .mbar,.msheet{--mb-bg:rgba(17,23,16,.96);--mb-line:rgba(208,244,76,.2);--mb-fg:#aebba7;--mb-on:#d0f44c;--mb-on-bg:rgba(208,244,76,.14);--ms-bg:#10160f;--ms-row:#151d15;--ms-line:#26321f;--ms-fg:#f0f4eb;--ms-mute:#7f8b79;--ms-on-bg:#1d2a14;--ms-code-bg:rgba(208,244,76,.12)}
  html.theme-light .mbar,html.theme-light .msheet{--mb-bg:rgba(255,255,255,.97);--mb-line:#d3dcc8;--mb-fg:#5d6a55;--mb-on:#3f6a10;--mb-on-bg:rgba(63,106,16,.12);--ms-bg:#fff;--ms-row:#f3f7ec;--ms-line:#d3dcc8;--ms-fg:#1f2a17;--ms-mute:#7b8872;--ms-on-bg:#e6f0d4;--ms-code-bg:rgba(63,106,16,.1)}
  .mbar{display:flex;position:fixed;z-index:98;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));height:66px;padding:0 6px;align-items:stretch;border:1px solid var(--mb-line);border-radius:24px;background:var(--mb-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 36px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent}
  html.theme-light .mbar{box-shadow:0 12px 30px rgba(40,60,20,.22)}
  .mbar[hidden]{display:none!important}
  .mbar>.mitem{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0;margin:0;border:0;border-radius:18px;background:transparent;color:var(--mb-fg);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color .18s}
  .mbar>.mitem .mi{width:52px;height:30px;display:grid;place-items:center;border-radius:15px;transition:background .2s,transform .2s cubic-bezier(.3,1.4,.5,1)}
  .mbar>.mitem svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .mbar>.mitem small{font:700 10px/1 Arial,sans-serif;letter-spacing:.01em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .mbar>.mitem.on{color:var(--mb-on)}
  .mbar>.mitem.on .mi{background:var(--mb-on-bg)}
  .mbar>.mitem.on small{font-weight:800}
  .mbar>.mitem:active .mi{transform:scale(.9)}
  .mbar .g-x{display:none}
  .mbar>.mitem.open .g-menu{display:none}
  .mbar>.mitem.open .g-x{display:inline}
  /* Hoja inferior: el Menú completo (con buscador) o las subpáginas de una sección */
  .msheet-backdrop{display:block;position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.5);opacity:0;visibility:hidden;transition:opacity .22s ease,visibility 0s linear .22s}
  body.msheet-open .msheet-backdrop{opacity:1;visibility:visible;transition:opacity .22s ease}
  html.msheet-lock{overflow:hidden!important}
  .msheet{display:flex;flex-direction:column;position:fixed;z-index:97;left:10px;right:10px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 76px);max-height:min(72dvh,600px);padding:0;border:1px solid var(--mb-line);border-radius:24px;background:var(--ms-bg);color:var(--ms-fg);box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;outline:none;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(18px) scale(.98);transform-origin:50% 100%;transition:transform .26s cubic-bezier(.3,1.2,.5,1),opacity .18s ease,visibility 0s linear .26s}
  body.msheet-open .msheet{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:transform .26s cubic-bezier(.3,1.2,.5,1),opacity .18s ease}
  .msheet [hidden]{display:none!important}
  .msheet .ms-grab{flex:0 0 auto;display:grid;place-items:center;height:22px;touch-action:none}
  .msheet .ms-grab::before{content:'';width:38px;height:4px;border-radius:4px;background:var(--ms-line)}
  .msheet .ms-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:0 10px 8px 18px;touch-action:none}
  .msheet .ms-head h3{margin:0;flex:1;color:var(--mb-on);font:850 .74rem Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase}
  .msheet .ms-x{flex:0 0 auto;width:36px;height:36px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:var(--ms-row);color:var(--ms-fg);cursor:pointer;-webkit-tap-highlight-color:transparent}
  .msheet .ms-x svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round}
  .msheet .ms-search{flex:0 0 auto;position:relative;margin:0 12px 8px}
  .msheet .ms-search svg{position:absolute;left:13px;top:50%;width:18px;height:18px;margin-top:-9px;stroke:var(--ms-mute);fill:none;stroke-width:2;stroke-linecap:round;pointer-events:none}
  .msheet .ms-search input{width:100%;box-sizing:border-box;height:44px;margin:0;padding:0 14px 0 40px;border:1px solid var(--ms-line);border-radius:14px;background:var(--ms-row);color:var(--ms-fg);font:600 16px Arial,sans-serif;outline:none;-webkit-appearance:none;appearance:none}
  .msheet .ms-search input:focus{border-color:var(--mb-on)}
  .msheet .ms-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 12px 12px}
  .msheet .ms-sec{margin:0 0 10px}
  .msheet .ms-sec>h4{display:flex;align-items:center;gap:8px;margin:6px 6px 6px;color:var(--ms-mute);font:800 10.5px Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase}
  .msheet .ms-sec>h4 svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .msheet .ms-row{display:flex;width:100%;box-sizing:border-box;align-items:center;gap:12px;min-height:48px;margin:0 0 6px;padding:8px 12px;border:1px solid var(--ms-line);border-radius:14px;background:var(--ms-row);color:var(--ms-fg);font:700 .88rem Arial,sans-serif;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s}
  .msheet .ms-row:active{transform:scale(.98)}
  .msheet .ms-code{flex:0 0 32px;height:32px;display:grid;place-items:center;border-radius:10px;background:var(--ms-code-bg);color:var(--mb-on);font:900 10.5px Arial,sans-serif;letter-spacing:.02em}
  .msheet .ms-code svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .msheet .ms-name{flex:1;min-width:0;overflow-wrap:anywhere}
  .msheet .ms-row::after{content:'›';margin-left:auto;color:var(--ms-mute);font-size:1.2rem}
  .msheet .ms-row.on{border-color:var(--mb-on);background:var(--ms-on-bg)}
  .msheet .ms-row.on::after{content:'●';color:var(--mb-on);font-size:.55rem}
  .msheet .ms-empty{margin:18px 8px;color:var(--ms-mute);font:700 13px Arial,sans-serif;text-align:center}
  @media(prefers-reduced-motion:reduce){.mbar>.mitem .mi,.msheet,.msheet-backdrop,.msheet .ms-row{transition:none!important}}
  /* Control operarios y Reproceso: campos y botones cómodos para el dedo (44 px, letra 16 px para que no haga zoom) */
  .operarios-day-filter-row{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;width:100%!important}
  .operarios-day-filter-row>.op-filter-field:first-child{grid-column:1/-1!important}
  .operarios-day-filter-row .op-filter-field{min-width:0!important}
  .operarios-day-filter[type=date]{min-width:0!important;max-width:100%!important;padding:8px 6px!important;font-size:15px!important}
  .operarios-day-filter{width:100%!important;box-sizing:border-box!important;min-height:44px!important;font-size:16px!important;padding:8px 12px!important}
  .operarios-day-filter-row #operarios-day-filter-apply,.operarios-day-filter-row #operarios-day-filter-clear{grid-column:1/-1!important;width:100%!important;min-height:44px!important;font-size:14px!important}
  .panel[data-panel="operarios"] input:not([type=checkbox]):not([type=radio]),.panel[data-panel="reproceso"] input:not([type=checkbox]):not([type=radio]),.panel[data-panel="reproceso"] select{min-height:44px!important;font-size:16px!important;box-sizing:border-box!important}
  .panel[data-panel="reproceso"] button,.panel[data-panel="operarios"] button.operarios-refresh,.rework-module button{min-height:44px!important}
  /* Bodega Tela: botones + TELA NUEVA / SUBIR DOCUMENTO / INGRESO / SALIDA compactos en una sola fila */
  .inventory-toolbar .inventory-movement-actions{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important;width:100%!important;margin-top:10px!important}
  .inventory-toolbar .inventory-movement-actions button{width:100%!important;min-width:0!important;height:44px!important;min-height:44px!important;max-height:44px!important;padding:0 4px!important;margin:0!important;writing-mode:horizontal-tb!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;font-size:10px!important;line-height:1.15!important;letter-spacing:0!important;white-space:normal!important;overflow:hidden!important;word-break:normal!important;overflow-wrap:normal!important;border-radius:10px!important}
  .inventory-toolbar .inventory-movement-actions button[data-inventory-doc]{font-size:8.5px!important;letter-spacing:-.02em!important}
  .inventory-toolbar .inventory-movement-actions button.inventory-refresh-btn{grid-column:1/-1!important;height:38px!important;min-height:38px!important;max-height:38px!important;font-size:11px!important;letter-spacing:.03em!important;padding:0 8px!important;white-space:nowrap!important}
  /* Aviso de salud (NAS, etc.): por encima de la barra inferior y del botón «+», sin taparlos */
  #salud-aviso{bottom:calc(max(12px,env(safe-area-inset-bottom)) + 112px)!important;width:max-content!important;max-width:calc(100vw - 24px)!important;font-size:11.5px!important;line-height:1.3!important}
  /* Producción: los puntos del flujo y los botones de MTS se tocan con el dedo sin cambiar su tamaño visible */
  .trace-card:not(.details-expanded) .trace-node::after{content:'';position:absolute;inset:-10px 0}
  .trace-mts-actions button{position:relative!important}
  .trace-mts-actions button::after{content:'';position:absolute;inset:-3px -12px}
  .trace-order-rework-edit,.trace-order-rework-remove{min-height:34px!important;font-size:10.5px!important}
  /* Cronograma: cliente completo, letra legible y palabras sin partir */
  .schedule-daycard-fields>div:first-child{grid-column:1/-1!important}
  .schedule-daycard-fields>div:first-child b{white-space:normal!important;overflow:hidden!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2!important}
  .schedule-daycard-fields span{font-size:10.5px!important}
  .schedule-stat{padding-left:6px!important;padding-right:6px!important}
  .schedule-stat span{font-size:10px!important;letter-spacing:0!important;overflow-wrap:normal!important;word-break:normal!important;hyphens:none!important}
  .schedule-card-client{font-size:11.5px!important;line-height:1.25!important}
  .schedule-card-item .schedule-card-focus,#schedule-count,.sch-chart-title,.sch-cal-legend,.sch-progress-label{font-size:11px!important}
  .sch-day-picks button{position:relative!important}
  .sch-day-picks button::after{content:'';position:absolute;inset:-9px -4px}
  #schedule-days-prev,#schedule-days-next{min-width:40px!important;min-height:40px!important}
  .schedule-daycard-pager button{min-width:34px!important;min-height:34px!important}
  /* Control operarios: etiquetas legibles y flechas cómodas */
  .op-filter-field,#operarios-goal-label,#operarios-goal-pct,.operarios-legend-source,.operarios-badge{font-size:11px!important}
  #operarios-hover-prev,#operarios-hover-next{min-width:40px!important;min-height:40px!important}
}`;
  document.head.appendChild(style);

  const ICONS = {
    INICIO: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    CONTROL: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 12.5l2.3 2.3 4.7-4.8"/>',
    NOVEDADES: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    REPROCESOS: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    REPROCESO: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    PRODUCCION: '<path d="M3 21V10l6 4V10l6 4V6l6 3v12z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    INVENTARIOS: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    ADMINISTRACION: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    AGENTES: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="3.5" r="1"/>',
    PERMISOS: '<path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    MOLDERIA: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    'PROMEDIOS MAESTROS': '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    COMERCIALES: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.3c1.8.8 3 2.6 3 4.7"/>',
    'R.HUMANO': '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M12 14v3.5M10.2 17.5h3.6"/>',
    TESORERIA: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.7 0-2.8.9-2.8 2.1 0 3 5.8 1.6 5.8 4.6 0 1.2-1.2 2.1-3 2.1-1.4 0-2.5-.6-3-1.7M12 6v1.7M12 16.3V18"/>',
    OTRO: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };
  const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const labelOf = node => (node?.querySelector('strong')?.textContent || node?.querySelector('span:not(.nav-icon)')?.textContent || node?.textContent || '').trim();
  const EN_MENU_USUARIO = "[data-kind='agentes'],[data-kind='promedios'],[data-kind='molderia']";
  const isMobile = () => window.matchMedia(MOBILE).matches;

  // Secciones del menú superior: botón directo (INICIO, REPROCESO) o grupo con subpáginas.
  const sections = () => {
    const nav = document.querySelector('.sidebar nav.tabs');
    if (!nav) return [];
    return [...nav.children].map(node => {
      if (getComputedStyle(node).display === 'none') return null;
      // Igual que en computador: Agentes, Promedios maestros y Moldería viven en el menú del usuario (la cajita de arriba), no en la barra
      if (node.matches(EN_MENU_USUARIO) || node.querySelector(EN_MENU_USUARIO)) return null;
      if (node.matches('.tab')) return {label: labelOf(node), direct: node, node};
      if (!node.matches('.nav-group')) return null;
      const parent = node.querySelector(':scope > .nav-parent');
      const direct = node.querySelector(':scope > .tab');
      const label = labelOf(parent || direct);
      if (!label) return null;
      const children = () => [...node.querySelectorAll('.nav-children .tab')].filter(tab => getComputedStyle(tab).display !== 'none');
      return {label, direct: parent ? null : direct, children, node};
    }).filter(Boolean);
  };

  ICONS['ASISTENTES COMERCIALES'] = ICONS.COMERCIALES;
  const bar = document.createElement('nav');
  bar.className = 'mbar';
  bar.setAttribute('aria-label', 'Menú principal');
  const sheet = document.createElement('div');
  sheet.className = 'msheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  const backdrop = document.createElement('div');
  backdrop.className = 'msheet-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  let list = [], moreList = [], items = [], menuButton = null, opener = null, mode = null;

  const PRIORITY = [['INICIO'], ['PRODUCCION'], ['REPROCESOS', 'REPROCESO'], ['INVENTARIOS']];
  const pretty = label => { const t = String(label || '').trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1).replace('produccion', 'producción').replace('administracion', 'administración'); };
  const svg = path => '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  const MENU_ICON = svg('<g class="g-menu"><path d="M4 7h16M4 12h16M4 17h16"/></g><g class="g-x"><path d="M6 6l12 12M18 6 6 18"/></g>');
  const iconOf = section => svg(ICONS[plain(section.label)] || ICONS.OTRO);
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
  const pagesOf = section => section.direct ? [section.direct] : section.children();
  const isOn = section => !!section && (section.direct ? section.direct.classList.contains('active') : !!section.node.querySelector('.nav-children .tab.active'));
  const sheetOpen = () => document.body.classList.contains('msheet-open');

  const markActive = () => {
    const open = sheetOpen();
    items.forEach(({section, button}) => {
      const on = isOn(section);
      button.classList.toggle('on', on);
      if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', String(open && mode === section.label));
    });
    if (menuButton) {
      const menuOpen = open && mode === 'menu';
      // «Menú» se enciende si estás en una sección que no tiene botón en la barra (Administración, Tesorería…)
      menuButton.classList.toggle('on', menuOpen || moreList.some(isOn));
      menuButton.classList.toggle('open', menuOpen);
      menuButton.setAttribute('aria-expanded', String(menuOpen));
    }
  };
  const closeSheet = restoreFocus => {
    if (!sheetOpen()) return;
    document.body.classList.remove('msheet-open');
    document.documentElement.classList.remove('msheet-lock');
    sheet.style.removeProperty('transform');
    sheet.style.removeProperty('transition');
    mode = null;
    markActive();
    if (restoreFocus && opener && opener.isConnected) opener.focus({preventScroll: true});
    opener = null;
  };
  const goTo = tab => { closeSheet(); tab.click(); window.scrollTo({top: 0}); };

  const makeRow = (section, tab, withIcon) => {
    const name = labelOf(tab);
    const row = el('button', 'ms-row');
    row.type = 'button';
    row.dataset.q = plain(section.label + ' ' + name);
    const code = el('span', 'ms-code');
    if (withIcon) code.innerHTML = iconOf(section);
    else code.textContent = (tab.querySelector('.nav-icon')?.textContent || name).trim().slice(0, 3).toUpperCase();
    row.append(code, el('span', 'ms-name', pretty(name)));
    if (tab.classList.contains('active')) { row.classList.add('on'); row.setAttribute('aria-current', 'page'); }
    row.onclick = () => goTo(tab);
    return row;
  };

  // Menú completo: todas las secciones con sus subpáginas; con buscador. Hoja de sección: solo las subpáginas de esa sección.
  const renderSheet = (title, sections, full) => {
    sheet.textContent = '';
    sheet.setAttribute('aria-label', title);
    const head = el('div', 'ms-head');
    const close = el('button', 'ms-x');
    close.type = 'button'; close.setAttribute('aria-label', 'Cerrar'); close.innerHTML = svg('<path d="M6 6l12 12M18 6 6 18"/>');
    close.onclick = () => closeSheet(true);
    head.append(el('h3', '', title), close);
    sheet.append(el('div', 'ms-grab'), head);
    const body = el('div', 'ms-body');
    sections.forEach(section => {
      const pages = pagesOf(section);
      if (!pages.length) return;
      const box = el('div', 'ms-sec');
      if (section.direct) box.append(makeRow(section, section.direct, true));
      else {
        if (full) { const h = el('h4'); h.innerHTML = iconOf(section); h.append(pretty(section.label)); box.append(h); }
        pages.forEach(tab => box.append(makeRow(section, tab, false)));
      }
      body.append(box);
    });
    if (full) {
      const wrap = el('div', 'ms-search');
      const input = el('input');
      input.type = 'search'; input.placeholder = 'Buscar sección…'; input.setAttribute('aria-label', 'Buscar sección');
      input.autocomplete = 'off'; input.autocapitalize = 'off'; input.spellcheck = false; input.enterKeyHint = 'go';
      wrap.innerHTML = svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');
      wrap.append(input);
      const empty = el('p', 'ms-empty', 'No hay secciones con ese nombre.');
      empty.hidden = true;
      input.addEventListener('input', () => {
        const q = plain(input.value);
        let shown = 0;
        body.querySelectorAll('.ms-sec').forEach(box => {
          let any = false;
          box.querySelectorAll('.ms-row').forEach(row => { const ok = !q || row.dataset.q.includes(q); row.hidden = !ok; if (ok) any = true; });
          box.hidden = !any;
          if (any) shown++;
        });
        empty.hidden = shown > 0;
      });
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const rows = [...body.querySelectorAll('.ms-row:not([hidden])')];
        if (rows.length === 1) rows[0].click();   // una sola coincidencia: Enter te lleva directo
      });
      sheet.append(wrap);
      body.append(empty);
    }
    sheet.append(body);
  };
  const openSheet = (kind, section, trigger) => {
    opener = trigger || null;
    if (kind === 'menu') renderSheet('Menú', list, true);
    else renderSheet(pretty(section.label), [section], false);
    mode = kind === 'menu' ? 'menu' : section.label;
    document.body.classList.add('msheet-open');
    document.documentElement.classList.add('msheet-lock');
    markActive();
    sheet.focus({preventScroll: true});
  };
  backdrop.onclick = () => closeSheet();
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSheet(true); });

  // Deslizar hacia abajo desde la manija o el título cierra la hoja
  let drag = null;
  sheet.addEventListener('touchstart', event => {
    if (!event.target.closest('.ms-grab,.ms-head')) return;
    drag = {y: event.touches[0].clientY, dy: 0};
    sheet.style.transition = 'none';
  }, {passive: true});
  sheet.addEventListener('touchmove', event => {
    if (!drag) return;
    drag.dy = Math.max(0, event.touches[0].clientY - drag.y);
    sheet.style.transform = 'translateY(' + drag.dy + 'px)';
  }, {passive: true});
  const endDrag = () => {
    if (!drag) return;
    const far = drag.dy > 70;
    drag = null;
    sheet.style.removeProperty('transition');
    if (far) closeSheet(); else sheet.style.removeProperty('transform');
  };
  sheet.addEventListener('touchend', endDrag);
  sheet.addEventListener('touchcancel', endDrag);

  const activate = (section, button) => {
    if (navigator.vibrate) navigator.vibrate(8);
    const pages = pagesOf(section);
    // Una sola página (Inicio, Tesorería…): directo, sin hoja intermedia
    if (pages.length === 1) { goTo(pages[0]); return; }
    if (!pages.length) { closeSheet(); section.node.querySelector('.nav-parent')?.click(); return; }
    if (sheetOpen() && mode === section.label) closeSheet();
    else openSheet('section', section, button);
  };

  const build = () => {
    list = sections();
    bar.hidden = !list.length;
    const signature = list.map(item => item.label).join('|');
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    closeSheet();
    bar.textContent = '';
    items = []; menuButton = null;
    const wanted = PRIORITY.map(keys => list.find(section => keys.includes(plain(section.label)))).filter(Boolean);
    const main = wanted.length >= 2 ? wanted : list.slice(0, 4);
    moreList = list.filter(section => !main.includes(section));
    main.forEach(section => {
      const button = el('button', 'mitem');
      button.type = 'button';
      button.setAttribute('aria-label', section.label);
      button.innerHTML = '<span class="mi">' + iconOf(section) + '</span><small></small>';
      button.querySelector('small').textContent = pretty(section.label);
      if (!section.direct && pagesOf(section).length > 1) { button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); }
      button.onclick = () => activate(section, button);
      items.push({section, button});
      bar.appendChild(button);
    });
    if (!list.length) return;
    menuButton = el('button', 'mitem menu');
    menuButton.type = 'button';
    menuButton.setAttribute('aria-label', 'Menú completo'); menuButton.setAttribute('aria-haspopup', 'dialog'); menuButton.setAttribute('aria-expanded', 'false');
    menuButton.innerHTML = '<span class="mi">' + MENU_ICON + '</span><small>Menú</small>';
    menuButton.onclick = () => {
      if (navigator.vibrate) navigator.vibrate(8);
      if (sheetOpen() && mode === 'menu') closeSheet(); else openSheet('menu', null, menuButton);
    };
    bar.appendChild(menuButton);
  };

  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const fixAvatar = () => {
    // Avatar con las iniciales del usuario (el nombre completo queda en el texto de al lado y en el tooltip).
    document.querySelectorAll('.user-menu .user-avatar').forEach(avatar => {
      const full = avatar.dataset.fullName || avatar.textContent.trim();
      if (!full) return;
      avatar.dataset.fullName = full;
      avatar.title = full;
      const wanted = initials(full) || full.slice(0, 2);
      if (avatar.textContent !== wanted) avatar.textContent = wanted;
    });
  };

  // Filtros plegables en celular (Reprocesos y Stock tela): el botón «Filtros» muestra cuántos campos tienen algo escrito
  const FORMS = '.rework-filters,.bd-filters,.bg-filters';
  const filtrosActivos = form => [...form.querySelectorAll('input,select')].filter(c => c.type !== 'button' && String(c.value || '').trim() !== '').length;
  const toggles = () => {
    document.querySelectorAll(FORMS).forEach(form => {
      if (!form.classList.contains('mf-form')) {
        form.classList.add('mf-form');
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mf-toggle';
        b.addEventListener('click', () => { const abierto = form.classList.toggle('mf-open'); b.classList.toggle('on', abierto); });
        form.before(b);
        form.addEventListener('input', () => toggles());
      }
      const b = form.previousElementSibling;
      if (b && b.classList.contains('mf-toggle')) {
        const n = filtrosActivos(form);
        const html = 'Filtros' + (n ? '<b>' + n + '</b>' : '') + '<span>▼</span>';
        if (b.dataset.h !== html) { b.dataset.h = html; b.innerHTML = html; }
      }
    });
  };
  let lastTop = '';
  const fitHeader = () => {
    const sidebar = document.querySelector('body.top-navigation .sidebar');
    const main = document.querySelector('main');
    if (!sidebar || !main) return;
    const rect = sidebar.getBoundingClientRect();
    if (!isMobile() || rect.right <= 0 || rect.bottom <= 0) {
      if (lastTop) { main.style.removeProperty('padding-top'); lastTop = ''; }
      if (isMobile()) main.style.setProperty('padding-bottom', 'calc(110px + env(safe-area-inset-bottom))', 'important');
      else main.style.removeProperty('padding-bottom');
      return;
    }
    const top = String(Math.round(rect.bottom) + 12);
    if (top === lastTop) return;
    lastTop = top;
    main.style.setProperty('padding-top', top + 'px', 'important');
    main.style.setProperty('padding-bottom', 'calc(110px + env(safe-area-inset-bottom))', 'important');
  };

  let queued = false;
  const run = () => {
    queued = false;
    if (!bar.isConnected && document.body) document.body.append(backdrop, sheet, bar);
    fixAvatar();
    toggles();
    build();
    markActive();
    fitHeader();
  };
  const schedule = () => { if (!queued) { queued = true; setTimeout(run, 60); } };
  run();
  window.addEventListener('resize', () => { lastTop = ''; if (!isMobile()) { closeSheet(); } schedule(); });
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  setTimeout(run, 600);
  setTimeout(run, 2000);
})();
