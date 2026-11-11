/* Efecto líquido de vidrio compartido por todos los módulos del panel.
   Se carga al final para conservar los estados y funciones de cada tarjeta. */
(() => {
  const STYLE_ID = 'indoor-efecto-vidrio-global';
  document.getElementById(STYLE_ID)?.remove();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --glass-fill: linear-gradient(145deg, rgba(255,255,255,.13), rgba(255,255,255,.035) 42%, rgba(5,18,11,.18));
      --glass-line: rgba(231,255,227,.24);
      --glass-shine: rgba(255,255,255,.42);
      --glass-shadow: 0 18px 42px rgba(0,0,0,.30), inset 0 1px 0 var(--glass-shine), inset 0 -1px 0 rgba(203,255,194,.08);
    }

    html body {
      background:
        radial-gradient(62rem 44rem at -8% -12%, rgba(190,241,65,.24), transparent 65%),
        radial-gradient(55rem 42rem at 106% -6%, rgba(38,146,104,.25), transparent 66%),
        radial-gradient(46rem 34rem at 45% 110%, rgba(75,119,27,.18), transparent 70%),
        linear-gradient(135deg, #07110a 0%, #0b1a10 47%, #062219 100%) !important;
      background-attachment: fixed !important;
    }

    body .sidebar,
    body .brand,
    body .topbar,
    body .session-card,
    body .user-menu summary,
    body .user-dropdown,
    body .account-dialog,
    body .card,
    body .schedule-shell,
    body .production-shell,
    body .production-toolbar,
    body .production-process-filter,
    body .production-kpis,
    body .home-hero,
    body .home-section,
    body .dashboard-card,
    body .trace-card,
    body .stock-card,
    body .inventory-card,
    body .agent-card,
    body .modal-content,
    body .dialog-content {
      background: var(--glass-fill) !important;
      border-color: var(--glass-line) !important;
      box-shadow: var(--glass-shadow) !important;
      -webkit-backdrop-filter: blur(20px) saturate(1.35);
      backdrop-filter: blur(20px) saturate(1.35);
    }

    body .sidebar,
    body .brand,
    body .topbar {
      background: linear-gradient(145deg, rgba(18,37,24,.78), rgba(8,20,13,.68)) !important;
    }

    body .card,
    body .trace-card,
    body .stock-card,
    body .inventory-card,
    body .agent-card {
      position: relative;
      overflow: hidden;
    }

    body .card::before,
    body .trace-card::before,
    body .stock-card::before,
    body .inventory-card::before,
    body .agent-card::before {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(112deg, rgba(255,255,255,.16), transparent 23%, transparent 74%, rgba(209,255,183,.08));
      opacity: .72;
      z-index: 0;
    }

    body .card > *,
    body .trace-card > *,
    body .stock-card > *,
    body .inventory-card > *,
    body .agent-card > * { position: relative; z-index: 1; }

    body .trace-card:hover,
    body .stock-card:hover,
    body .inventory-card:hover,
    body .agent-card:hover {
      border-color: rgba(203,255,118,.58) !important;
      box-shadow: 0 22px 48px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.52), 0 0 0 1px rgba(185,239,78,.10) !important;
    }

    body .user-dropdown,
    body .account-dialog {
      background: linear-gradient(145deg, rgba(32,52,39,.82), rgba(11,27,17,.78)) !important;
      border-color: rgba(235,255,229,.30) !important;
      box-shadow: 0 24px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.45) !important;
    }

    /* Navegación superior: capa visual únicamente. Mantiene los mismos botones,
       eventos y submenús del panel, pero los presenta como la barra de vidrio. */
    html body.top-navigation .sidebar {
      height: 78px !important;
      padding: 8px 22px !important;
      gap: 18px !important;
      background: linear-gradient(90deg, rgba(14,28,17,.94), rgba(16,37,25,.80), rgba(9,25,17,.93)) !important;
      border-bottom: 1px solid rgba(225,255,222,.14) !important;
      box-shadow: 0 14px 38px rgba(0,0,0,.30), inset 0 -1px 0 rgba(255,255,255,.08) !important;
      -webkit-backdrop-filter: blur(22px) saturate(1.22) !important;
      backdrop-filter: blur(22px) saturate(1.22) !important;
    }

    html body.top-navigation .sidebar-brand {
      flex: 0 0 112px !important;
      position: relative;
      z-index: 2;
    }

    html body.top-navigation .sidebar-brand img {
      width: 108px !important;
      height: 44px !important;
    }

    html body.top-navigation .sidebar nav.tabs {
      /* Una sola fila compacta: deja espacio fijo a la cuenta y al botón del sol. */
      flex: 0 1 auto !important;
      min-width: 0;
      max-width: min(820px, calc(100vw - 320px));
      margin: 0 auto !important;
      transform: none !important;
      padding: 0 !important;
      gap: 14px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
    }
    /* La marca activa es la línea inferior; se apaga la burbuja líquida anterior. */
    html body.top-navigation .sidebar nav.tabs .nl-goo { display:none !important; }
    html body.top-navigation .sidebar nav.tabs .nl-on,
    html body.top-navigation .sidebar nav.tabs .nl-on * { color:#efffc0!important; -webkit-text-fill-color:#efffc0!important; }

    html body.top-navigation .sidebar nav.tabs > .tab,
    html body.top-navigation .sidebar .nav-parent {
      min-height: 34px !important;
      padding: 4px 1px !important;
      border: 0 !important;
      border-radius: 0 !important;
      color: rgba(244,250,242,.88) !important;
      background: transparent !important;
      font-size: clamp(8px, .6vw, 10px) !important;
      letter-spacing: .01em !important;
      transition: background .18s ease, color .18s ease, transform .18s ease !important;
    }
    html body.top-navigation .sidebar nav.tabs > .tab strong,
    html body.top-navigation .sidebar .nav-parent > span:not(.nav-icon) {
      font-size: clamp(8px, .6vw, 10px) !important;
    }

    html body.top-navigation .sidebar nav.tabs > .tab:hover,
    html body.top-navigation .sidebar .nav-parent:hover {
      outline: 0 !important;
      background: transparent !important;
      color: #efffc0 !important;
      transform: none;
    }

    html body.top-navigation .sidebar nav.tabs > .tab.active,
    html body.top-navigation .sidebar .nav-parent[aria-expanded="true"] {
      border-bottom: 2px solid #d9fb53 !important;
      background: transparent !important;
      color: #efffc0 !important;
      box-shadow: none !important;
    }

    html body.top-navigation .sidebar nav.tabs > .tab.active *,
    html body.top-navigation .sidebar .nav-parent[aria-expanded="true"] * {
      color: #efffc0 !important;
      -webkit-text-fill-color: #efffc0 !important;
    }

    html body.top-navigation .sidebar .nav-children {
      top: calc(100% + 11px) !important;
      padding: 9px !important;
      border: 1px solid rgba(230,255,226,.23) !important;
      border-radius: 15px !important;
      background: linear-gradient(145deg, rgba(35,59,42,.93), rgba(12,30,20,.94)) !important;
      box-shadow: 0 18px 42px rgba(0,0,0,.37), inset 0 1px 0 rgba(255,255,255,.20) !important;
      -webkit-backdrop-filter: blur(20px) saturate(1.25) !important;
      backdrop-filter: blur(20px) saturate(1.25) !important;
    }

    html body.top-navigation .sidebar .nav-children .tab {
      border-radius: 10px !important;
    }

    html body.top-navigation .sidebar .systems {
      position: relative;
      z-index: 2;
    }

    html body.top-navigation main {
      padding-top: 96px !important;
    }

    @media (max-width: 700px) {
      html body.top-navigation .sidebar {
        height: 110px !important;
        padding: 8px 10px !important;
      }
      html body.top-navigation .sidebar nav.tabs {
        order: 2;
        flex: 1 1 100% !important;
        max-width: 100%;
        overflow-x: auto !important;
        justify-content: flex-start !important;
        scrollbar-width: none;
      }
      html body.top-navigation .sidebar nav.tabs::-webkit-scrollbar { display: none; }
      html body.top-navigation .sidebar nav.tabs > .tab,
      html body.top-navigation .sidebar .nav-parent { flex: 0 0 auto; }
      html body.top-navigation main { padding-top: 124px !important; }
    }

    body button:not(.danger),
    body .btn:not(.danger),
    body .chip,
    body .pill {
      -webkit-backdrop-filter: blur(10px) saturate(1.2);
      backdrop-filter: blur(10px) saturate(1.2);
    }

    @media (max-width: 760px) {
      body .card,
      body .trace-card,
      body .stock-card,
      body .inventory-card,
      body .agent-card {
        -webkit-backdrop-filter: blur(14px) saturate(1.22);
        backdrop-filter: blur(14px) saturate(1.22);
      }
    }
  `;
  document.head.appendChild(style);
})();

// La mejora se carga aparte para que el resumen se conserve en su misma pestaña.
(() => {
  if (document.querySelector('script[data-contabilidad-confeccion-ui]')) return;
  const script = document.createElement('script');
  script.src = '/contabilidad-confeccion-ui.js?v=20261111-3';
  script.async = false;
  script.dataset.contabilidadConfeccionUi = 'true';
  document.head.appendChild(script);
})();

/* Capa de profundidad: no cambia la estructura ni los eventos de los módulos. */
(() => {
  const STYLE_ID = 'indoor-vidrio-dinamico';
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root { --glass-deep:rgba(7,22,14,.46); --glass-edge:rgba(239,255,226,.30); --glass-glow:rgba(194,246,95,.16); }
    html body { background:radial-gradient(50rem 32rem at var(--glass-x,12%) var(--glass-y,8%),rgba(213,255,104,.16),transparent 68%),radial-gradient(44rem 38rem at 98% 15%,rgba(44,182,135,.18),transparent 68%),radial-gradient(38rem 34rem at 46% 104%,rgba(109,145,49,.15),transparent 70%),linear-gradient(135deg,#06100a 0%,#0b2116 48%,#061a13 100%) !important; }
    body .home-section,body .dashboard-card,body .dash-card,body .trace-card,body .stock-card,body .inventory-card,body .agent-card,body .ct-card,body .ct-group,body .production-shell,body .schedule-shell { background:radial-gradient(circle at var(--glass-card-x,50%) var(--glass-card-y,0%),rgba(238,255,210,.11),transparent 32%),linear-gradient(138deg,rgba(255,255,255,.15),rgba(255,255,255,.055) 34%,var(--glass-deep) 100%) !important; border-color:var(--glass-edge) !important; box-shadow:0 18px 45px rgba(0,0,0,.27),inset 0 1px 0 rgba(255,255,255,.48),inset 0 -1px 0 rgba(205,255,189,.10) !important; transition:transform .24s cubic-bezier(.2,.8,.2,1),box-shadow .24s ease,border-color .24s ease !important; }
    @media (hover:hover) { body .home-section:hover,body .dashboard-card:hover,body .dash-card:hover,body .trace-card:hover,body .stock-card:hover,body .inventory-card:hover,body .agent-card:hover,body .ct-card:hover,body .ct-group:hover { transform:translateY(-4px); border-color:rgba(222,255,160,.54) !important; box-shadow:0 26px 54px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.56),0 0 0 1px var(--glass-glow) !important; } }
    body button:not(.danger),body .btn:not(.danger) { position:relative; overflow:hidden; border-color:rgba(229,255,196,.38); }
    body button:not(.danger)::after,body .btn:not(.danger)::after { content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(110deg,transparent 28%,rgba(255,255,255,.34) 48%,transparent 68%); transform:translateX(-140%); transition:transform .46s ease; }
    @media (hover:hover) { body button:not(.danger):hover::after,body .btn:not(.danger):hover::after { transform:translateX(140%); } }
    @media (max-width:760px) { body .home-section,body .dashboard-card,body .dash-card,body .trace-card,body .stock-card,body .inventory-card,body .agent-card,body .ct-card,body .ct-group { background:linear-gradient(145deg,rgba(255,255,255,.13),rgba(10,28,18,.62)) !important; } }
    @media (prefers-reduced-motion:reduce) { body .home-section,body .dashboard-card,body .dash-card,body .trace-card,body .stock-card,body .inventory-card,body .agent-card,body .ct-card,body .ct-group,body button,body .btn { transition:none !important; } body button::after,body .btn::after { display:none; } }
  `;
  document.head.appendChild(style);
  const selector = '.home-section,.dashboard-card,.dash-card,.trace-card,.stock-card,.inventory-card,.agent-card,.ct-card,.ct-group';
  const motionOK = !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(hover: hover)').matches;
  if (!motionOK) return;
  document.addEventListener('pointermove', event => {
    document.documentElement.style.setProperty('--glass-x', `${Math.round(event.clientX / innerWidth * 100)}%`);
    document.documentElement.style.setProperty('--glass-y', `${Math.round(event.clientY / innerHeight * 100)}%`);
    const card = event.target.closest(selector);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--glass-card-x', `${Math.round((event.clientX - rect.left) / rect.width * 100)}%`);
    card.style.setProperty('--glass-card-y', `${Math.round((event.clientY - rect.top) / rect.height * 100)}%`);
  }, { passive:true });
})();
