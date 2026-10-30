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
