// Solo celular (hasta 700 px): el menú superior se reemplaza por una barra inferior flotante con íconos.
// Las secciones con subpáginas abren un panel desde abajo. En computador no cambia nada.
// También: el avatar muestra iniciales en lugar del nombre completo.
(() => {
  const MOBILE = '(max-width:700px)';
  const style = document.createElement('style');
  style.textContent = `
.mbar,.msheet,.msheet-backdrop{display:none}
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
  html body.top-navigation .sidebar{height:auto!important;min-height:0!important;max-height:none!important}
  html body main{padding-bottom:calc(110px + env(safe-area-inset-bottom))!important}
  /* Barra inferior: píldora con íconos y etiquetas, y un botón central «+» que abre las demás secciones en abanico */
  .mbar{--mb-bg:rgba(17,23,16,.96);--mb-line:rgba(208,244,76,.2);--mb-fg:#aebba7;--mb-on:#d0f44c;--mb-fab:#d0f44c;--mb-fab-fg:#10150e;--mb-chip:#1b2417;display:flex;position:fixed;z-index:98;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));height:68px;padding:0 6px;align-items:stretch;border:1px solid var(--mb-line);border-radius:26px;background:var(--mb-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 36px rgba(0,0,0,.5);-webkit-tap-highlight-color:transparent}
  html.theme-light .mbar{--mb-bg:rgba(255,255,255,.97);--mb-line:#d3dcc8;--mb-fg:#5d6a55;--mb-on:#3f6a10;--mb-fab:#3f6a10;--mb-fab-fg:#fff;--mb-chip:#f3f7ec;box-shadow:0 12px 30px rgba(40,60,20,.22)}
  .mbar>.mitem{position:relative;flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0;margin:0;border:0;border-radius:18px;background:transparent;color:var(--mb-fg);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:color .18s}
  .mbar>.mitem svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}
  .mbar>.mitem small{font:700 10px/1 Arial,sans-serif;letter-spacing:.01em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .mbar>.mitem.on{color:var(--mb-on)}
  .mbar>.mitem.on svg{transform:translateY(-1px) scale(1.08)}
  .mbar>.mitem.on::after{content:'';position:absolute;bottom:6px;left:50%;width:18px;height:3px;margin-left:-9px;border-radius:3px;background:var(--mb-on);animation:mbar-dot .25s ease-out both}
  @keyframes mbar-dot{from{transform:scaleX(.2);opacity:0}to{transform:scaleX(1);opacity:1}}
  .mbar>.mitem:active svg{transform:scale(.88)}
  .mspacer{flex:0 0 76px}
  .mfab{position:absolute;left:50%;top:-26px;z-index:3;width:58px;height:58px;margin-left:-29px;display:grid;place-items:center;padding:0;border:5px solid var(--mb-bg);border-radius:50%;background:var(--mb-fab);color:var(--mb-fab-fg);cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent;transition:transform .2s}
  .mfab svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2.6;stroke-linecap:round;transition:transform .32s cubic-bezier(.3,1.4,.5,1)}
  .mfab:active{transform:scale(.93)}
  .mfab.has-active::after{content:'';position:absolute;right:2px;top:2px;width:11px;height:11px;border-radius:50%;background:#fff;border:2.5px solid var(--mb-fab)}
  .mbar.fan-open .mfab svg{transform:rotate(45deg)}
  /* Las demás secciones salen en una cuadrícula de íconos con su nombre (antes eran círculos en abanico que se montaban entre sí) */
  .mfan{position:absolute;left:0;right:0;bottom:calc(100% + 16px);top:auto;width:auto;height:auto;z-index:2;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px;border:1px solid var(--mb-line);border-radius:22px;background:var(--mb-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 36px rgba(0,0,0,.5);opacity:0;pointer-events:none;transform:translateY(14px) scale(.96);transform-origin:50% 100%;transition:transform .28s cubic-bezier(.3,1.3,.5,1),opacity .18s ease}
  .mbar.fan-open .mfan{opacity:1;pointer-events:auto;transform:none}
  .mfan button{position:static;width:auto;height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:6px 4px;border:1px solid var(--mb-line);border-radius:16px;background:var(--mb-chip);color:var(--mb-on);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s,transform .15s}
  .mfan button:active{transform:scale(.95)}
  .mfan button svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .mfan button span{position:static;margin:0;transform:none;padding:0;background:none;color:var(--mb-fg);font:700 11px/1.15 Arial,sans-serif;text-align:center;white-space:normal;max-width:100%;overflow-wrap:anywhere}
  html.theme-light .mfan button span{background:none;color:var(--mb-fg)}
  .mfan button.on{background:var(--mb-on);color:var(--mb-fab-fg);border-color:var(--mb-on)}
  .mfan button.on span{color:var(--mb-fab-fg)}
  body.mfan-open .msheet-backdrop{display:block;background:rgba(0,0,0,.45)}
  @media(prefers-reduced-motion:reduce){.mbar>.mitem svg,.mfab svg,.mfan button{transition:none!important}.mbar>.mitem.on::after{animation:none}}
  .msheet-backdrop{position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.55)}
  .msheet{position:fixed;z-index:97;left:10px;right:10px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 82px);max-height:min(70dvh,560px);overflow-y:auto;padding:14px 12px 10px;border:1px solid rgba(208,244,76,.3);border-radius:22px;background:#10160f;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  body.msheet-open .msheet,body.msheet-open .msheet-backdrop{display:block}
  .msheet h3{margin:0 6px 10px;color:#d0f44c;font:850 .7rem Arial;letter-spacing:.1em;text-transform:uppercase}
  .msheet button{display:flex;width:100%;align-items:center;gap:10px;min-height:46px;margin:0 0 6px;padding:10px 14px;border:1px solid #26321f;border-radius:14px;background:#151d15;color:#f0f4eb;font:700 .86rem Arial;text-align:left;cursor:pointer}
  .msheet button.on{border-color:#d0f44c;background:#1d2a14;color:#e7ff9a}
  .msheet button::after{content:'›';margin-left:auto;color:#6f7b6a;font-size:1.2rem}
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
}`;
  document.head.appendChild(style);

  const ICONS = {
    INICIO: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
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
    TESORERIA: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.7 0-2.8.9-2.8 2.1 0 3 5.8 1.6 5.8 4.6 0 1.2-1.2 2.1-3 2.1-1.4 0-2.5-.6-3-1.7M12 6v1.7M12 16.3V18"/>',
    OTRO: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'
  };
  const plain = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const labelOf = node => (node?.querySelector('strong')?.textContent || node?.querySelector('span:not(.nav-icon)')?.textContent || node?.textContent || '').trim();
  const isMobile = () => window.matchMedia(MOBILE).matches;

  // Secciones del menú superior: botón directo (INICIO, REPROCESO) o grupo con subpáginas.
  const sections = () => {
    const nav = document.querySelector('.sidebar nav.tabs');
    if (!nav) return [];
    return [...nav.children].map(node => {
      if (getComputedStyle(node).display === 'none') return null;
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

  const bar = document.createElement('nav');
  bar.className = 'mbar';
  bar.setAttribute('aria-label', 'Menú principal');
  const sheet = document.createElement('div');
  sheet.className = 'msheet';
  sheet.setAttribute('role', 'dialog');
  const backdrop = document.createElement('div');
  backdrop.className = 'msheet-backdrop';
  let list = [];

  const closeSheet = () => document.body.classList.remove('msheet-open');
  const openSheet = section => {
    const items = section.children();
    if (!items.length) { section.node.querySelector('.nav-parent')?.click(); return; }
    sheet.innerHTML = '<h3></h3>';
    sheet.querySelector('h3').textContent = section.label;
    items.forEach(tab => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = labelOf(tab);
      if (tab.classList.contains('active')) button.classList.add('on');
      button.onclick = () => { closeSheet(); tab.click(); window.scrollTo({top: 0}); };
      sheet.appendChild(button);
    });
    document.body.classList.add('msheet-open');
  };
  const closeFan = () => { bar.classList.remove('fan-open'); document.body.classList.remove('mfan-open'); fab && fab.setAttribute('aria-expanded', 'false'); };
  backdrop.onclick = () => { closeSheet(); closeFan(); };

  const PRIORITY = ['INICIO', 'PRODUCCION', 'REPROCESOS', 'INVENTARIOS'];
  const pretty = label => { const t = String(label || '').trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1).replace('produccion', 'producción').replace('administracion', 'administración'); };
  const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  let fab = null, items = [], fanItems = [];

  const activate = section => {
    if (navigator.vibrate) navigator.vibrate(8);
    closeFan();
    if (section.direct) { closeSheet(); section.direct.click(); window.scrollTo({top: 0}); return; }
    if (document.body.classList.contains('msheet-open') && sheet.querySelector('h3')?.textContent === section.label) closeSheet();
    else openSheet(section);
  };
  const isOn = section => !!section && (section.direct ? section.direct.classList.contains('active') : !!section.node.querySelector('.nav-children .tab.active'));
  const markActive = () => {
    items.forEach(({section, button}) => button.classList.toggle('on', isOn(section)));
    fanItems.forEach(({section, button}) => button.classList.toggle('on', isOn(section)));
    if (fab) fab.classList.toggle('has-active', fanItems.some(({section}) => isOn(section)));
  };

  const build = () => {
    list = sections();
    const signature = list.map(item => item.label).join('|');
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    closeFan();
    bar.innerHTML = '';
    items = []; fanItems = []; fab = null;
    const wanted = PRIORITY.map(key => list.find(section => plain(section.label) === key)).filter(Boolean);
    const main = wanted.length >= 2 ? wanted : list.slice(0, 4);
    const more = list.filter(section => !main.includes(section));
    const makeItem = section => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'mitem';
      button.setAttribute('aria-label', section.label);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[plain(section.label)] || ICONS.OTRO) + '</svg><small></small>';
      button.querySelector('small').textContent = pretty(section.label);
      button.onclick = () => activate(section);
      items.push({section, button});
      return button;
    };
    const half = more.length ? Math.ceil(main.length / 2) : main.length;
    main.slice(0, half).forEach(section => bar.appendChild(makeItem(section)));
    if (more.length) {
      const spacer = document.createElement('span');
      spacer.className = 'mspacer'; spacer.setAttribute('aria-hidden', 'true');
      bar.appendChild(spacer);
    }
    main.slice(half).forEach(section => bar.appendChild(makeItem(section)));
    if (!more.length) return;
    fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'mfab';
    fab.setAttribute('aria-label', 'Más secciones'); fab.setAttribute('aria-expanded', 'false');
    fab.innerHTML = PLUS;
    fab.onclick = () => {
      if (navigator.vibrate) navigator.vibrate(8);
      closeSheet();
      const open = !bar.classList.contains('fan-open');
      bar.classList.toggle('fan-open', open);
      document.body.classList.toggle('mfan-open', open);
      fab.setAttribute('aria-expanded', String(open));
    };
    const fan = document.createElement('div');
    fan.className = 'mfan';
    const spread = more.length > 1 ? Math.min(55 * (more.length - 1), 150) : 0;
    more.forEach((section, index) => {
      const angle = more.length > 1 ? (-spread / 2 + spread * index / (more.length - 1)) * Math.PI / 180 : 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', section.label);
      button.style.setProperty('--x', Math.round(Math.sin(angle) * 88) + 'px');
      button.style.setProperty('--y', Math.round(-Math.cos(angle) * 88 - 4) + 'px');
      button.style.setProperty('--d', (index * 0.04) + 's');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[plain(section.label)] || ICONS.OTRO) + '</svg><span></span>';
      button.querySelector('span').textContent = pretty(section.label);
      button.onclick = () => activate(section);
      fan.appendChild(button);
      fanItems.push({section, button});
    });
    bar.append(fan, fab);
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
    build();
    markActive();
    fitHeader();
  };
  const schedule = () => { if (!queued) { queued = true; setTimeout(run, 60); } };
  run();
  window.addEventListener('resize', () => { lastTop = ''; if (!isMobile()) { closeSheet(); closeFan(); } schedule(); });
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  setTimeout(run, 600);
  setTimeout(run, 2000);
})();
