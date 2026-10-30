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
      flex: 0 1 auto !important;
      min-width: 0;
      max-width: min(1040px, calc(100vw - 310px));
      margin: 0 auto !important;
      padding: 5px 10px !important;
      gap: 2px !important;
      border: 1px solid rgba(232,255,229,.22) !important;
      border-radius: 999px !important;
      background: linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.035) 48%, rgba(9,22,14,.25)) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.18), 0 12px 28px rgba(0,0,0,.20) !important;
      -webkit-backdrop-filter: blur(18px) saturate(1.28) !important;
      backdrop-filter: blur(18px) saturate(1.28) !important;
    }

    html body.top-navigation .sidebar nav.tabs > .tab,
    html body.top-navigation .sidebar .nav-parent {
      min-height: 42px !important;
      padding: 9px clamp(9px, 1.05vw, 16px) !important;
      border: 0 !important;
      border-radius: 999px !important;
      color: rgba(244,250,242,.88) !important;
      background: transparent !important;
      font-size: clamp(10px, .82vw, 13px) !important;
      letter-spacing: .015em !important;
      transition: background .18s ease, color .18s ease, transform .18s ease !important;
    }

    html body.top-navigation .sidebar nav.tabs > .tab:hover,
    html body.top-navigation .sidebar .nav-parent:hover {
      outline: 0 !important;
      background: rgba(215,247,92,.13) !important;
      color: #efffc0 !important;
      transform: translateY(-1px);
    }

    html body.top-navigation .sidebar nav.tabs > .tab.active,
    html body.top-navigation .sidebar .nav-parent[aria-expanded="true"] {
      background: linear-gradient(135deg, #d9fb53, #b9eb37) !important;
      color: #14200d !important;
      box-shadow: 0 5px 18px rgba(190,241,65,.26), inset 0 1px 0 rgba(255,255,255,.55) !important;
    }

    html body.top-navigation .sidebar nav.tabs > .tab.active *,
    html body.top-navigation .sidebar .nav-parent[aria-expanded="true"] * {
      color: #14200d !important;
      -webkit-text-fill-color: #14200d !important;
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

    @media (max-width: 1080px) and (min-width: 701px) {
      html body.top-navigation .sidebar { padding: 8px 14px !important; gap: 8px !important; }
      html body.top-navigation .sidebar-brand { flex-basis: 90px !important; }
      html body.top-navigation .sidebar-brand img { width: 88px !important; }
      html body.top-navigation .sidebar nav.tabs { max-width: calc(100vw - 216px); padding: 4px 6px !important; }
      html body.top-navigation .sidebar nav.tabs > .tab,
      html body.top-navigation .sidebar .nav-parent { padding-inline: 8px !important; }
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
