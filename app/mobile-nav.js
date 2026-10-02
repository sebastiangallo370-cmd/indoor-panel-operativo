// Solo celular (hasta 700 px): el menú superior se reemplaza por una barra inferior flotante con íconos.
// Las secciones con subpáginas abren un panel desde abajo. En computador no cambia nada.
// También: el avatar muestra iniciales en lugar del nombre completo.
(() => {
  const MOBILE = '(max-width:700px)';
  const style = document.createElement('style');
  style.textContent = `
.mbar,.msheet,.msheet-backdrop{display:none}
@media ${MOBILE}{
  .user-menu .user-avatar{overflow:hidden!important;white-space:nowrap!important;text-overflow:clip!important;letter-spacing:0!important}
  html body.top-navigation .sidebar nav.tabs{display:none!important}
  html body.top-navigation .sidebar{height:auto!important;min-height:0!important;max-height:none!important}
  html body main{padding-bottom:calc(104px + env(safe-area-inset-bottom))!important}
  .mbar{display:flex;position:fixed;z-index:95;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));height:64px;padding:6px;gap:2px;align-items:center;justify-content:space-between;border:1px solid rgba(208,244,76,.22);border-radius:999px;background:rgba(14,19,13,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 40px rgba(0,0,0,.55)}
  .mbar button{flex:1 1 0;min-width:0;height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:0;margin:0;border:0;border-radius:999px;background:transparent;color:#cfd9c8;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .18s,color .18s,transform .12s}
  .mbar button:active{transform:scale(.94)}
  .mbar button svg{width:23px;height:23px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .mbar button small{display:none;font:800 8.5px Arial;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .mbar button.on{flex:1.9 1 0;background:rgba(208,244,76,.16);color:#e7ff9a}
  .mbar button.on small{display:block}
  .msheet-backdrop{position:fixed;inset:0;z-index:96;background:rgba(0,0,0,.55)}
  .msheet{position:fixed;z-index:97;left:10px;right:10px;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 74px);max-height:min(70dvh,560px);overflow-y:auto;padding:14px 12px 10px;border:1px solid rgba(208,244,76,.3);border-radius:22px;background:#10160f;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  body.msheet-open .msheet,body.msheet-open .msheet-backdrop{display:block}
  .msheet h3{margin:0 6px 10px;color:#d0f44c;font:850 .7rem Arial;letter-spacing:.1em;text-transform:uppercase}
  .msheet button{display:flex;width:100%;align-items:center;gap:10px;min-height:46px;margin:0 0 6px;padding:10px 14px;border:1px solid #26321f;border-radius:14px;background:#151d15;color:#f0f4eb;font:700 .86rem Arial;text-align:left;cursor:pointer}
  .msheet button.on{border-color:#d0f44c;background:#1d2a14;color:#e7ff9a}
  .msheet button::after{content:'›';margin-left:auto;color:#6f7b6a;font-size:1.2rem}
  /* Bodega Tela: botones + TELA NUEVA / SUBIR DOCUMENTO / INGRESO / SALIDA compactos en una sola fila */
  .inventory-toolbar .inventory-movement-actions{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:6px!important;width:100%!important;margin-top:10px!important}
  .inventory-toolbar .inventory-movement-actions button{width:100%!important;min-width:0!important;height:44px!important;min-height:44px!important;max-height:44px!important;padding:0 4px!important;margin:0!important;writing-mode:horizontal-tb!important;display:flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;font-size:10px!important;line-height:1.15!important;letter-spacing:0!important;white-space:normal!important;overflow:hidden!important;word-break:normal!important;overflow-wrap:normal!important;border-radius:10px!important}
  .inventory-toolbar .inventory-movement-actions button[data-inventory-doc]{font-size:8.5px!important;letter-spacing:-.02em!important}
}`;
  document.head.appendChild(style);

  const ICONS = {
    INICIO: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    NOVEDADES: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    REPROCESO: '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    PRODUCCION: '<path d="M3 21V10l6 4V10l6 4V6l6 3v12z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
    INVENTARIOS: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    ADMINISTRACION: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
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
  backdrop.onclick = closeSheet;

  const markActive = () => {
    [...bar.children].forEach((button, index) => {
      const section = list[index];
      const on = section && (section.direct ? section.direct.classList.contains('active') : !!section.node.querySelector('.nav-children .tab.active'));
      button.classList.toggle('on', !!on);
    });
  };

  const build = () => {
    list = sections();
    const signature = list.map(item => item.label).join('|');
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    bar.innerHTML = '';
    list.forEach(section => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', section.label);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[plain(section.label)] || ICONS.OTRO) + '</svg><small></small>';
      button.querySelector('small').textContent = section.label;
      button.onclick = () => {
        if (section.direct) { closeSheet(); section.direct.click(); window.scrollTo({top: 0}); return; }
        if (document.body.classList.contains('msheet-open') && sheet.querySelector('h3')?.textContent === section.label) closeSheet();
        else openSheet(section);
      };
      bar.appendChild(button);
    });
  };

  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const fixAvatar = () => {
    // Celular: iniciales. Computador: el texto original de siempre.
    document.querySelectorAll('.user-menu .user-avatar').forEach(avatar => {
      const full = avatar.dataset.fullName || avatar.textContent.trim();
      if (!full) return;
      avatar.dataset.fullName = full;
      const wanted = isMobile() ? (initials(full) || full.slice(0, 2)) : full;
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
      if (isMobile()) main.style.setProperty('padding-bottom', 'calc(104px + env(safe-area-inset-bottom))', 'important');
      else main.style.removeProperty('padding-bottom');
      return;
    }
    const top = String(Math.round(rect.bottom) + 12);
    if (top === lastTop) return;
    lastTop = top;
    main.style.setProperty('padding-top', top + 'px', 'important');
    main.style.setProperty('padding-bottom', 'calc(104px + env(safe-area-inset-bottom))', 'important');
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
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  run();
  window.addEventListener('resize', () => { lastTop = ''; if (!isMobile()) closeSheet(); schedule(); });
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  setTimeout(run, 600);
  setTimeout(run, 2000);
})();
