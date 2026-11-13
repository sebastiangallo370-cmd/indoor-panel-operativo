// Menú del usuario ordenado: las herramientas arriba y todo lo de la cuenta dentro de «Configuración de cuenta».
// Otros scripts agregan sus botones al menú cuando les toca; este los reubica cada vez y oculta lo duplicado.
(function () {
  const CLAVE = 'menu_cuenta_abierto';
  const css = document.createElement('style');
  css.textContent = `
  .user-dropdown .mc-grupo{margin:6px 0;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);padding:4px 0}
  .user-dropdown .mc-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;font-weight:800;letter-spacing:.02em}
  .user-dropdown .mc-cab i{font-style:normal;transition:transform .2s;opacity:.7}
  .user-dropdown .mc-grupo.abierto .mc-cab i{transform:rotate(180deg)}
  .user-dropdown .mc-cuerpo{display:none;margin:2px 0 4px 10px;padding-left:8px;border-left:2px solid rgba(195,238,63,.35)}
  .user-dropdown .mc-grupo.abierto .mc-cuerpo{display:block}
  .user-dropdown .mc-cuerpo>*{display:block;width:100%}
  .user-dropdown .mc-sec{margin:8px 12px 2px;font:800 .62rem Arial;letter-spacing:.14em;color:#8e9a87;text-transform:uppercase}`;
  document.head.appendChild(css);

  let abierto = false;
  try { abierto = localStorage.getItem(CLAVE) === '1'; } catch (e) { /* sin almacenamiento */ }

  let obs = null, pendiente = 0, dashboardComprobado = false;

  async function prepararDashboardAdministrativo() {
    if (dashboardComprobado) return;
    dashboardComprobado = true;
    try {
      const respuesta = await fetch('/api/dashboard-administrativo/permiso', { cache: 'no-store' });
      const permiso = respuesta.ok ? await respuesta.json() : null;
      if (!permiso || !permiso.allowed) return;
      const menu = document.querySelector('.user-dropdown');
      if (!menu) return;
      if (!document.getElementById('open-dashboard-administrativo')) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.id = 'open-dashboard-administrativo';
        boton.textContent = 'Dashboard administrativo';
        menu.appendChild(boton);
      }
      if (!document.querySelector('script[data-dashboard-administrativo]')) {
        const script = document.createElement('script');
        script.src = '/dashboard-administrativo.js?v=20261109-1';
        script.dataset.dashboardAdministrativo = '1';
        document.head.appendChild(script);
      }
      organizar();
    } catch (e) { /* El menú principal sigue funcionando aunque falle esta vista opcional. */ }
  }

  function organizar() {
    const m = document.querySelector('.user-dropdown');
    if (!m) return;
    if (obs) obs.disconnect();
    try {
      const rol = m.querySelector(':scope > p');
      const logout = m.querySelector(':scope > a[href="/logout"]') || m.querySelector('a[href="/logout"]');
      const porId = id => document.getElementById(id);
      // lo duplicado: «Fichas técnicas» ya está dentro de Estándar 2026
      const fichas = porId('open-fichas-resumen');
      if (fichas) fichas.style.display = porId('open-promedios') ? 'none' : '';
      let grupo = m.querySelector(':scope > .mc-grupo');
      if (!grupo) {
        grupo = document.createElement('div');
        grupo.className = 'mc-grupo' + (abierto ? ' abierto' : '');
        grupo.innerHTML = '<button type="button" class="mc-cab" aria-expanded="' + abierto + '"><span>⚙ Configuración de cuenta</span><i>▾</i></button><div class="mc-cuerpo"></div>';
        grupo.querySelector('.mc-cab').addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          abierto = !grupo.classList.contains('abierto');
          grupo.classList.toggle('abierto', abierto);
          e.currentTarget.setAttribute('aria-expanded', String(abierto));
          try { localStorage.setItem(CLAVE, abierto ? '1' : '0'); } catch (er) { /* sin almacenamiento */ }
        });
      }
      const cuerpo = grupo.querySelector('.mc-cuerpo');
      // herramientas: arriba, en este orden
      const herramientas = [
        m.querySelector('.li-menu-item:not(.li-create-user)'), porId('open-agentes'), porId('open-agentes-hub'), porId('open-ecommerce'), porId('open-zeus'), porId('open-promedios'), porId('open-contabilidad-confeccion'), porId('open-molderia'), fichas
      ].filter(Boolean);
      // cuenta: dentro de la sección
      const cuenta = [porId('open-dashboard-administrativo'), porId('open-profile'), porId('open-name'), porId('open-password'), porId('open-manage-permissions'), porId('open-lineas-producto'), porId('open-personal-notes'), m.querySelector('.li-create-user'), m.querySelector('.theme-toggle')].filter(Boolean);
      let ref = rol ? rol.nextSibling : m.firstChild;
      herramientas.forEach(el => { if (el.parentNode !== m || el !== ref) m.insertBefore(el, ref); ref = el.nextSibling; });
      if (grupo.parentNode !== m || grupo !== ref) m.insertBefore(grupo, ref);
      let r2 = cuerpo.firstChild;
      cuenta.forEach(el => { if (el.parentNode !== cuerpo || el !== r2) cuerpo.insertBefore(el, r2); r2 = el.nextSibling; });
      if (logout && logout.parentNode === m && grupo.nextElementSibling !== logout) m.insertBefore(logout, grupo.nextSibling);
    } finally {
      obs = obs || new MutationObserver(() => { clearTimeout(pendiente); pendiente = setTimeout(organizar, 150); });
      const d = document.querySelector('.user-dropdown');
      if (d) obs.observe(d, { childList: true, subtree: true });
    }
  }
  let n = 0;
  const espera = setInterval(() => { if (document.querySelector('.user-dropdown #open-profile') || ++n > 100) { clearInterval(espera); organizar(); prepararDashboardAdministrativo(); } }, 250);
})();


// Contabilidad confección · 2026: una pestañita por confeccionista (resumen de totales, sin datos de clientes).
(function () {
  if (window.__contConfeccion) return; window.__contConfeccion = true;
  let FILAS = [];
  let DATOS = [];
  function calcularDatos() {
    const m = {};
    FILAS.forEach(f => {
      const d = m[f.c] || (m[f.c] = {nombre: f.c, pedidos: 0, enviadas: 0, recibidas: 0, valor: 0, pagado: 0, pendiente: 0});
      d.pedidos++; d.enviadas += f.env; d.recibidas += f.rec; d.valor += f.val;
      if (f.fp) d.pagado += f.val; else d.pendiente += f.val;
    });
    DATOS = Object.values(m).sort((a, b) => b.valor - a.valor);
  }
  // Datos en vivo de contabilidad (todas las confeccionistas de la base)
  async function cargarDatos() {
    const r = await fetch('/api/contabilidad-confeccion', {credentials: 'same-origin', cache: 'no-store'});
    if (!r.ok) throw new Error('sin datos');
    const data = await r.json();
    const fecha = v => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CO', {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'}) : null;
    FILAS = (data.makers || []).flatMap(m => (m.details || []).map(d => ({
      id: d.id, origen: d.origen, ec: d.entrega_cliente || '', reg: d.registrado_at || '', c: m.name, cli: d.client || '', cot: d.quote || '', ref: d.reference || '', desc: d.product || '',
      fe: d.sent_date || '', fen: d.received_date || '', env: Number(d.sent) || 0, rec: Number(d.received) || 0,
      vu: Number(d.unit_value) || 0, val: Number(d.amount) || 0, fp: d.paid ? (fecha(d.payment) || 'pagado') : null
    })));
    calcularDatos();
  }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = n => Math.round(n || 0).toLocaleString('es-CO');
  const pesos = n => '$ ' + fmt(n);
  const css = document.createElement('style');
  css.textContent = `
  .cc-pestanas{display:flex;flex-direction:row;flex-wrap:nowrap;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:4px;border-radius:999px;border:1px solid rgba(230,235,241,.22);background:rgba(0,0,0,.25);margin:10px 0 16px}
  .cc-pestanas::-webkit-scrollbar{display:none}
  .cc-pestanas > button{flex:0 0 auto!important;width:auto!important;min-width:max-content!important;max-width:none!important;margin:0!important}
  .cc-pestanas button{padding:5px 12px;border-radius:999px;border:1px solid transparent;background:transparent;color:#c9d3c4;font:800 11px Arial;cursor:pointer;white-space:nowrap}
  .cc-pestanas button:hover{background:rgba(230,235,241,.1)}
  .cc-pestanas button.on{background:#e6ebf1;color:#101418}
  .cc-pestanas button b{margin-left:6px;padding:0 6px;border-radius:99px;background:rgba(0,0,0,.18);font-size:10px}
  .contabilidad-confeccion-panel{grid-template-columns:minmax(0,1fr)!important}
  .contabilidad-confeccion-panel>*{min-width:0!important}
  .cc-wrap{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;padding:18px;border-radius:28px;background:linear-gradient(160deg,#101a12,#070b08);color:#f4f7fa;font-family:Arial,sans-serif}
  .cc-head span{font:800 11px Arial;letter-spacing:.16em;color:#c9d3c4}
  .cc-head h3{margin:4px 0 0;font:900 22px Arial}
  .cc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px;width:100%;min-width:0}
  .cc-kpis>*{min-width:0;box-sizing:border-box}
  .cc-card{padding:16px 18px;border-radius:22px;background:linear-gradient(160deg,rgba(226,233,240,.24),rgba(226,233,240,.06));border:1px solid rgba(226,233,240,.36);backdrop-filter:blur(24px) saturate(1.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 18px 40px rgba(0,0,0,.35);text-align:center;animation:ccIn .5s ease both}
  .cc-card small{display:block;font:800 10px Arial;letter-spacing:.14em;color:#c9d3c4}
  .cc-card b{display:block;margin:6px 0 2px;font:900 clamp(17px,2.2vw,24px) Arial;color:#f7f9fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cc-card span{font:700 12px Arial;color:#b9c3cf}
  .cc-bloque{box-sizing:border-box;width:100%;min-width:0;margin-top:14px;padding:16px 18px;border-radius:22px;background:rgba(226,233,240,.1);border:1px solid rgba(226,233,240,.3);backdrop-filter:blur(20px)}
  .cc-bloque h4{margin:0 0 12px;font:900 12px Arial;letter-spacing:.1em;color:#e6ebf1;text-align:center}
  .cc-fila{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) auto;gap:12px;align-items:center;margin:10px 0}
  .cc-fila span{font:800 12px Arial;color:#e6efe2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cc-fila b{font:900 13px Arial;white-space:nowrap}
  .cc-track{height:16px;border-radius:999px;background:rgba(226,233,240,.12);border:1px solid rgba(226,233,240,.2);overflow:hidden}
  .cc-fill{display:block;height:100%;width:var(--w,0%);border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,.25),#e6ebf1);transform-origin:left;animation:ccWide .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 80ms)}
  .cc-doble{display:flex;height:22px;border-radius:999px;overflow:hidden;border:1px solid rgba(226,233,240,.25);margin-top:10px}
  .cc-doble i{display:block;height:100%;width:var(--w);transform-origin:left;animation:ccWide .9s cubic-bezier(.2,.8,.2,1) both}
  .cc-leyenda{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:8px;font:700 12px Arial;color:#dfe6ee}
  .cc-leyenda i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .cc-nota{margin:12px 0 0;font:600 11px Arial;color:#9aa6b4;text-align:center}
  .cc-tabla-wrap{overflow-x:hidden!important}
  .cc-tabla{min-width:0!important;width:100%!important;table-layout:fixed;font-size:10px!important}
  .cc-tabla th,.cc-tabla td{white-space:normal!important;overflow-wrap:anywhere;padding:6px 4px!important;font-size:10px;line-height:1.25}
  .cc-tabla th{font-size:8.5px!important;letter-spacing:.02em!important}
  .cc-tabla .cc-chip{white-space:normal;font-size:8.5px;padding:1px 5px;margin:1px 0}
  .cc-tabla th,.cc-tabla td{text-align:center!important;vertical-align:middle!important}
  .cc-tabla th:first-child,.cc-tabla td:first-child{text-align:left!important}
  .cc-tabla td:last-child{text-align:center!important}
  .cc-tabla td:last-child .cc-chip{display:inline-block;margin:2px 2px;padding:2px 6px}
  .cc-tabla tbody tr:hover td{background:rgba(230,235,241,.08)}
  .cc-tabla-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:14px;border:1px solid rgba(226,233,240,.2);background:rgba(0,0,0,.18)}
  .cc-tabla{width:100%;border-collapse:collapse;min-width:1100px;font:700 11px Arial;color:#dfe6ee}
  .cc-tabla th,.cc-tabla td{padding:7px 9px;border-bottom:1px solid rgba(226,233,240,.1);text-align:left;white-space:nowrap}
  .cc-tabla th{position:sticky;top:0;background:#1a2a1e;color:#e6ebf1;font:900 10px Arial;letter-spacing:.06em}
  .cc-tabla td.n,.cc-tabla th.n{text-align:right}
  .cc-tabla tr:hover td{background:rgba(226,233,240,.06)}
  .cc-pend{color:#e6ebf1;opacity:.7}
  .cc-resaltada{padding:6px 8px;margin:10px -8px;border-radius:14px;background:rgba(226,233,240,.14);border:1px solid rgba(226,233,240,.35)}
  .cc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:12px;margin-top:10px;width:100%;min-width:0}
  .cc-conf{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-height:150px;padding:14px 14px 30px;border-radius:20px;border:1px solid rgba(226,233,240,.32);background:rgba(226,233,240,.08);color:#f4f7fa;text-align:left;cursor:pointer;font:700 12px Arial;transition:transform .24s ease,border-color .24s ease,box-shadow .24s ease;animation:ccIn .5s ease both;animation-delay:calc(var(--i,0) * 45ms)}
  .cc-conf:hover{transform:translateY(-3px);border-color:rgba(222,255,160,.6);box-shadow:0 20px 40px rgba(0,0,0,.35)}
  .cc-conf.on{border-color:#e6ebf1;box-shadow:0 0 0 2px rgba(230,235,241,.6)}
  .cc-conf small{font:800 9px Arial;letter-spacing:.14em;color:#c9d3c4}
  .cc-conf b{font:900 15px Arial;color:#f7f9fb;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.2;min-height:2.4em}
  .cc-conf span,.cc-conf em{font:700 11px Arial;color:#b9c3cf;font-style:normal}
  .cc-conf-bar{display:block;width:100%;height:6px;margin-top:auto;border-radius:99px;background:rgba(226,233,240,.14);overflow:hidden}
  .cc-conf-bar i{display:block;height:100%;border-radius:99px;background:#e6ebf1;transition:width .6s ease}
  .cc-control{margin-top:12px}
  .cc-ctrl{cursor:pointer;color:#f4f7fa;font:inherit;text-align:center}
  .cc-ctrl.on{border-color:#e6ebf1;box-shadow:0 0 0 2px rgba(230,235,241,.55)}
  .cc-filtros{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-start;margin:8px 0 12px}
  .cc-buscar{flex:1 1 220px;min-width:0;padding:8px 12px;border-radius:12px;border:1px solid rgba(226,233,240,.3);background:rgba(0,0,0,.3);color:#f4f7fa;font:700 12px Arial}
  .cc-filtros button{flex:0 0 auto;width:auto;padding:4px 9px;border-radius:999px;border:1px solid rgba(226,233,240,.3);background:transparent;color:#dfe6ee;font:800 9.5px Arial;white-space:nowrap;cursor:pointer}
  .cc-filtros button.on{background:#e6ebf1;color:#101418}
  .cc-chip{display:inline-block;margin:1px 4px 1px 0;padding:2px 8px;border-radius:99px;font:800 10px Arial;white-space:nowrap}
  .cc-chip.ok{background:rgba(120,220,140,.18);color:#bff5cc}
  .cc-chip.warn{background:rgba(255,155,120,.2);color:#ffd2c2}
  .cc-tabla th{border-right:1px solid rgba(255,255,255,.12);background:#23402b}
  .cc-tabla td{border-right:1px solid rgba(226,233,240,.08)}
  .cc-tabla tbody tr:nth-child(even) td{background:rgba(226,233,240,.04)}
  .cc-fila-unica{grid-template-columns:repeat(7,minmax(0,1fr))}
  .cc-fila-unica .cc-card b{font-size:clamp(14px,1.45vw,21px)}
  .cc-fila-unica .cc-card{padding:10px 8px;border-radius:16px}
  .cc-fila-unica .cc-card small{font-size:8.5px;letter-spacing:.1em}
  .cc-fila-unica .cc-card span{font-size:10px;line-height:1.25}
  .cc-fila-unica .cc-card b{margin:4px 0 1px}
  @media (max-width:1200px){.cc-fila-unica{grid-template-columns:repeat(4,minmax(0,1fr))}}
  @media (max-width:900px){.cc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (max-width:700px){.cc-wrap{padding:12px;border-radius:20px}.cc-bloque{padding:12px}.cc-card{padding:12px}.cc-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cc-conf{min-height:132px;padding:12px 12px 26px}.cc-filtros button{flex:0 0 auto;width:auto;padding:4px 9px;font-size:9.5px;white-space:nowrap}}
  body:has(.contabilidad-confeccion-panel.active) .footer-note{display:none!important}
  body .panel.contabilidad-confeccion-panel.active:has(.cc-carga),body .contabilidad-confeccion-panel:has(.cc-carga){background-color:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;padding:0!important;margin:0!important;min-height:0!important}
  body:has(.contabilidad-confeccion-panel:has(.cc-carga)) main{background:transparent!important}
  .cc-grafica-ancha{grid-column:1 / -1}
  .cc-cols{width:100%;max-width:640px;height:auto;overflow:visible;display:block;margin:0 auto}
  .cc-col-barra{fill:#d4ff3a;transition:opacity .2s}
  .cc-col:hover .cc-col-barra{opacity:.85}
  .cc-col-valor{font:800 11px Arial;fill:#f4f7fa}
  .cc-col-nombre{font:700 9.5px Arial;fill:#c9d3c4}
  .cc-graficas{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
  .cc-grafica{box-sizing:border-box;min-width:0;padding:16px 18px;border-radius:22px;background:rgba(226,233,240,.1);border:1px solid rgba(226,233,240,.3);backdrop-filter:blur(20px)}
  .cc-grafica header small{display:block;font:800 10px Arial;letter-spacing:.14em;color:#c9d3c4}
  .cc-grafica header h4{margin:4px 0 2px;font:900 15px Arial;color:#f7f9fb}
  .cc-grafica header p{margin:0 0 8px;font:600 11px Arial;color:#9aa6b4}
  .cc-svg{width:100%;height:auto;display:block}
  .cc-svg .cc-eje{font:700 10px Arial;fill:#9aa6b4}
  .cc-svg .cc-rejilla{stroke:rgba(226,233,240,.12)}
  .cc-svg .cc-area{fill:rgba(230,235,241,.14)}
  .cc-svg .cc-linea{fill:none;stroke:#e6ebf1;stroke-width:2.5;stroke-linejoin:round}
  .cc-svg .cc-punto{fill:#e6ebf1}
  .cc-barras-dias{display:flex;flex-direction:column;gap:7px}
  .cc-barra-dias{display:grid;grid-template-columns:minmax(90px,150px) 1fr 74px;gap:8px;align-items:center;font:700 11px Arial;color:#dfe6ee}
  .cc-barra-dias span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cc-barra-dias i{display:block;height:9px;border-radius:99px;background:rgba(226,233,240,.14);overflow:hidden}
  .cc-barra-dias em{display:block;height:100%;border-radius:99px;background:#e6ebf1}
  .cc-barra-dias b{text-align:right;font-weight:800}
  @media (max-width:700px){.cc-graficas{grid-template-columns:1fr}}
  .cc-selector{display:flex;align-items:center;gap:10px;margin:10px 0 14px;font:800 11px Arial;letter-spacing:.08em;color:#c9d3c4}
  .cc-select{flex:1 1 auto;max-width:420px;min-width:0;padding:8px 12px;border-radius:12px;border:1px solid rgba(230,235,241,.3);background:rgba(0,0,0,.35);color:#f4f7fa;font:700 12px Arial;cursor:pointer}
  .cc-select option{background:#101a12;color:#f4f7fa}
  .cc-ciclos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
  .cc-ciclo{box-sizing:border-box;display:flex;flex-direction:column;gap:3px;padding:12px 14px;border-radius:18px;background:rgba(226,233,240,.1);border:1px solid rgba(226,233,240,.3)}
  .cc-ciclo small{font:800 9px Arial;letter-spacing:.14em;color:#c9d3c4}
  .cc-ciclo b{font:900 14px Arial;color:#f7f9fb}
  .cc-ciclo span{font:700 11px Arial;color:#dfe6ee}
  .cc-ciclo em{font:800 10px Arial;font-style:normal;color:#e6ebf1;margin-top:4px}
  .cc-ciclo-proceso{border-style:dashed}
  .cc-barra-selectores{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:10px 0 14px}
  .cc-barra-selectores .cc-selector{margin:0}
  .cc-selector-ciclo{margin-left:auto}
  .cc-acc{white-space:nowrap}
  .cc-acc-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;vertical-align:middle;width:34px!important;height:30px!important;min-height:0!important;padding:0!important;margin:0 4px!important;line-height:1;border-radius:10px!important;border:1px solid rgba(230,235,241,.35)!important;background:rgba(226,233,240,.1)!important;color:#e6ebf1!important;cursor:pointer;box-sizing:border-box}
  .cc-acc-btn svg{display:block;margin:0;flex:none}
  .cc-acc-btn:hover{background:rgba(230,235,241,.22)}
  .cc-acc-borrar:hover{color:#ffb4a2;border-color:rgba(255,180,162,.6)}
  .cc-modal-fondo{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6)}
  .cc-modal{width:min(360px,100%);box-sizing:border-box;padding:18px;border-radius:20px;background:#101a12;border:1px solid rgba(230,235,241,.3);color:#f4f7fa;font:700 12px Arial;display:grid;gap:10px}
  .cc-modal h4{margin:0;font:900 16px Arial}
  .cc-modal p{margin:0;color:#9aa6b4;font:600 11px Arial}
  .cc-modal label{display:grid;gap:4px;font:800 10px Arial;letter-spacing:.06em;color:#c9d3c4}
  .cc-modal input{padding:8px 10px;border-radius:10px;border:1px solid rgba(230,235,241,.3);background:rgba(0,0,0,.35);color:#f4f7fa;font:700 13px Arial}
  .cc-modal-error{color:#ffb4a2!important}
  .cc-modal-botones{display:flex;justify-content:flex-end;gap:8px}
  .cc-modal-botones button{padding:8px 14px;border-radius:999px;border:1px solid rgba(230,235,241,.35);background:transparent;color:#f4f7fa;font:800 11px Arial;cursor:pointer}
  .cc-modal-botones button[type=submit]{background:#e6ebf1;color:#101418}
  .cc-cargando{opacity:.5;pointer-events:none}
  .cc-liq-btn{padding:5px 13px;border-radius:999px;border:1px solid #b8e62e;background:#d4ff3a;color:#0d1a02;box-shadow:0 0 16px rgba(212,255,58,.35);font:900 11px Arial;letter-spacing:.04em;line-height:1.4;cursor:pointer;white-space:nowrap;align-self:center;width:auto!important;max-width:max-content!important;flex:0 0 auto!important;min-width:0!important}
  .cc-liq-modal{width:min(420px,100%)}
  .cc-liq-total{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .cc-liq-total div{padding:10px 12px;border-radius:14px;background:rgba(226,233,240,.1);border:1px solid rgba(226,233,240,.3)}
  .cc-liq-total small{display:block;font:800 9px Arial;letter-spacing:.12em;color:#c9d3c4}
  .cc-liq-total b{font:900 18px Arial;color:#f7f9fb}
  .cc-liq-tabla{width:100%;border-collapse:collapse;font:700 11px Arial;color:#dfe6ee}
  .cc-liq-tabla th,.cc-liq-tabla td{padding:6px;text-align:center;border-bottom:1px solid rgba(226,233,240,.12)}
  .cc-liq-tabla th:first-child,.cc-liq-tabla td:first-child{text-align:left}
  .cc-cuenta-fondo{position:fixed;inset:0;z-index:99999;overflow:auto;padding:20px 12px;background:rgba(0,0,0,.72)}
  .cc-cuenta-hoja{box-sizing:border-box;width:min(816px,100%);min-height:1056px;margin:0 auto;padding:48px 44px;background:#fff;color:#111;font:13px Arial,sans-serif;border-radius:6px}
  .cc-cuenta-cab{display:flex;align-items:center;gap:14px;margin-bottom:18px;font-size:12px}
  .cc-cuenta-logo{height:40px;width:auto;background:#0b140c;border-radius:8px;padding:8px 14px;box-sizing:content-box}
  .cc-cuenta-hoja h2{font-size:18px;margin:10px 0 14px}
  .cc-cuenta-hoja p{margin:8px 0;line-height:1.5}
  .cc-cuenta-hoja .c{text-align:center}
  .cc-cuenta-hoja .cc-cuenta-campo{display:inline-block;border:0!important;border-radius:0!important;border-bottom:1px dotted #555!important;background:transparent!important;box-shadow:none!important;outline:none;font:inherit;color:#111!important;text-align:center;width:170px;height:auto!important;min-height:0!important;padding:0 4px!important;margin:0 2px;line-height:1.4}
  .cc-cuenta-hoja .cc-cuenta-campo::placeholder{color:#999;opacity:1}
  .cc-cuenta-fondo .cc-cuenta-hoja input.cc-cuenta-campo.cc-cuenta-campo.cc-cuenta-campo{background-color:transparent!important;background-image:none!important;border:0!important;border-bottom:1px dotted #555!important;color:#111!important;-webkit-text-fill-color:#111!important;box-shadow:none!important;padding:0 4px!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla{width:100%!important;min-width:0!important;max-width:100%!important;table-layout:fixed!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th,.cc-cuenta-hoja table.cc-cuenta-tabla td{background:transparent!important;color:#111!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla thead th{background:#eef5e2!important}
  .cc-cuenta-fondo .cc-cuenta-hoja table.cc-cuenta-tabla th,.cc-cuenta-fondo .cc-cuenta-hoja table.cc-cuenta-tabla td{font-size:8px!important;line-height:1.2!important;padding:4px 1px!important}
  .cc-cuenta-hoja{overflow:hidden}
  .cc-cuenta-tabla{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8px;margin:12px 0}
  .cc-cuenta-tabla th,.cc-cuenta-tabla td{border-bottom:1px solid #ccc;padding:4px 1px;text-align:center;color:#111;background:transparent}
  .cc-cuenta-tabla th{background:#eef5e2;font-size:10px}
  .cc-cuenta-tabla tfoot td{font-weight:800;border-top:2px solid #111;border-bottom:0}
  .cc-cuenta-tabla td,.cc-cuenta-tabla th{white-space:nowrap!important;overflow:hidden;text-overflow:clip}
  .cc-cuenta-tabla th:nth-child(1),.cc-cuenta-tabla td:nth-child(1){width:11%}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(2),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(2){width:22%!important;overflow:hidden;text-overflow:ellipsis;text-align:left!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(3),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(3){width:11%!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(4),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(4){width:16%!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(5),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(5){width:7%!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(6),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(6){width:16%!important}
  .cc-cuenta-hoja table.cc-cuenta-tabla th:nth-child(7),.cc-cuenta-hoja table.cc-cuenta-tabla td:nth-child(7){width:17%!important}
  .cc-cuenta-tabla th:nth-child(2),.cc-cuenta-tabla td:nth-child(2){width:10%}
  .cc-cuenta-tabla th:nth-child(3),.cc-cuenta-tabla td:nth-child(3){width:21%}
  .cc-cuenta-tabla th:nth-child(4),.cc-cuenta-tabla td:nth-child(4){width:30%}
  .cc-cuenta-tabla th:nth-child(5),.cc-cuenta-tabla td:nth-child(5){width:5%}
  .cc-cuenta-tabla th:nth-child(6),.cc-cuenta-tabla td:nth-child(6){width:11%}
  .cc-cuenta-tabla th:nth-child(7),.cc-cuenta-tabla td:nth-child(7){width:13%}
  .cc-cuenta-legal{font-size:11px;text-align:justify}
  .cc-cuenta-firma{margin-top:46px;width:300px;max-width:100%}
  .cc-cuenta-firma .cc-cuenta-campo{width:180px}
  .cc-cuenta-linea{border-top:1px solid #111;margin-bottom:4px;height:1px}
  .cc-cuenta-firma p{font-size:12px}
  .cc-cuenta-acciones{display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap}
  .cc-liq-btn-sec{background:transparent!important;color:#f4f7fa!important;border-color:rgba(230,235,241,.5)!important;box-shadow:none!important}
  @media print{
    body *{visibility:hidden!important}
    .cc-cuenta-fondo,.cc-cuenta-fondo *{visibility:visible!important}
    .cc-cuenta-fondo{position:absolute!important;inset:0 auto auto 0!important;background:#fff!important;padding:0!important;overflow:visible!important}
    @page{size:letter;margin:12mm}
    .cc-cuenta-hoja{box-shadow:none!important;width:100%!important;min-height:0!important;padding:0!important;border-radius:0!important}
    .cc-no-print{display:none!important}
  }
  .cc-resumen-total{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 22px;margin:0 0 12px;font:700 11px Arial;color:#c9d3c4}
  .cc-resumen-total b{display:block;margin-top:2px;font:900 15px Arial;color:#f7f9fb}
  .cc-prox-liq{align-self:center;font:800 11px Arial;color:#c9d3c4;white-space:nowrap}
  .cc-prox-liq b{color:#f7f9fb;font-weight:900}
  .cc-head-fila{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .cc-liq-todas-grande{padding:14px 28px!important;font:900 14px Arial!important;min-width:280px;min-height:52px;text-align:center;letter-spacing:.05em}
  @media (max-width:700px){.cc-liq-todas-grande{min-width:0;width:100%;padding:12px 16px!important}}
  .cc-carga{display:flex;flex-direction:column;align-items:center;gap:12px;padding:70px 16px;color:#e6ebf1;text-align:center}
  .cc-carga img{width:58px;height:auto;animation:ccPulso 1.5s ease-in-out infinite}
  .cc-carga b{font:900 13px Arial;letter-spacing:.14em}
  .cc-carga span{font:700 11px Arial;color:#9aa6b4}
  @keyframes ccPulso{0%,100%{opacity:.55;transform:scale(.97)}50%{opacity:1;transform:scale(1)}}
  @keyframes ccIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes ccWide{from{transform:scaleX(0)}to{transform:scaleX(1)}}`;
  document.head.appendChild(css);

  // Estado de los filtros y de la tabla visible (se conservan al cambiar de pestaña o al filtrar).
  let filtros = { q: '', pend: false, dif: false, ciclo: 'proceso' };
  let listaActual = [];
  let conCActual = false;

  function totales(lista) {
    return lista.reduce((t, d) => ({pedidos: t.pedidos + d.pedidos, enviadas: t.enviadas + d.enviadas, recibidas: t.recibidas + d.recibidas, valor: t.valor + d.valor, pagado: t.pagado + d.pagado, pendiente: t.pendiente + d.pendiente}), {pedidos: 0, enviadas: 0, recibidas: 0, valor: 0, pagado: 0, pendiente: 0});
  }
  function kpis(t) {
    return '<div class="cc-kpis">' + kpisTarjetas(t) + '</div>';
  }
  function kpisTarjetas(t) {
    return '' +
      '<article class="cc-card" style="--i:0"><small>PEDIDOS 2026</small><b>' + fmt(t.pedidos) + '</b><span>envíos a confección</span></article>' +
      '<article class="cc-card" style="--i:1"><small>UNIDADES ENVIADAS</small><b>' + fmt(t.enviadas) + '</b><span>' + fmt(t.recibidas) + ' recibidas</span></article>' +
      '<article class="cc-card" style="--i:2"><small>VALOR TOTAL</small><b>' + pesos(t.valor) + '</b><span>en 2026</span></article>' +
      '<article class="cc-card" style="--i:3"><small>PENDIENTE DE PAGO</small><b>' + pesos(t.pendiente) + '</b><span>' + pesos(t.pagado) + ' pagado</span></article>' +
      '';
  }
  function dona(t) {
    const p = t.valor ? Math.round(t.pagado / t.valor * 100) : 0;
    return '<div class="cc-bloque"><h4>PAGADO FRENTE A PENDIENTE</h4>' +
      '<div class="cc-doble"><i style="--w:' + p + '%;background:#e6ebf1"></i><i style="--w:' + (100 - p) + '%;background:rgba(226,233,240,.25)"></i></div>' +
      '<div class="cc-leyenda"><span><i style="background:#e6ebf1"></i>Pagado ' + p + '%</span><span><i style="background:rgba(226,233,240,.35)"></i>Pendiente ' + (100 - p) + '%</span></div></div>';
  }
  // Tarjetas de confeccionistas: cada una es un botón que abre su pestaña. El relleno líquido es el % pagado.
  function tarjetasConfeccionistas(lista, resaltar) {
    const max = Math.max(1, ...lista.map(d => d.valor));
    return '<div class="cc-grid">' + lista.map((d, i) => {
      const pagado = d.valor ? Math.round(d.pagado / d.valor * 100) : 0;
      const tono = pagado >= 75 ? 'verde' : pagado >= 40 ? 'ambar' : 'rojo';
      return '<button type="button" class="cc-conf' + (d.nombre === resaltar ? ' on' : '') + '" data-ir="' + esc(d.nombre) + '" data-lq="' + pagado + '" data-lq-tone="' + tono + '" style="--i:' + i + '">' +
        '<small>CONFECCIONISTA</small><b>' + esc(d.nombre) + '</b>' +
        '<span>' + fmt(d.pedidos) + ' pedidos · ' + fmt(d.enviadas) + ' und.</span>' +
        '<span>' + pesos(d.valor) + '</span>' +
        '<em>' + pesos(d.pendiente) + ' pendiente</em>' +
        '<span class="cc-conf-bar"><i style="width:' + Math.round(d.valor / max * 100) + '%"></i></span></button>';
    }).join('') + '</div>';
  }
  // Controles automáticos por pedido: unidades, valor y pago.
  function controles(f) {
    const dif = f.env - f.rec;
    return [
      dif === 0 ? { tipo: 'ok', texto: 'Recibido completo' } : { tipo: 'warn', texto: dif > 0 ? 'Faltan ' + fmt(dif) : 'Sobran ' + fmt(-dif) },
      Math.round(f.vu * f.env) === Math.round(f.val) ? { tipo: 'ok', texto: 'Valor cuadra' } : { tipo: 'warn', texto: 'Valor no cuadra' },
      f.fp ? { tipo: 'ok', texto: 'Pagado' } : { tipo: 'warn', texto: 'Pendiente de pago' }
    ];
  }
  const tieneDiferencia = f => controles(f).slice(0, 2).some(c => c.tipo === 'warn');
  // Pedidos «en proceso»: sin pagar a la confección y enviados desde el 9 de noviembre en adelante
  function esEnProceso(f) { return !f.fp && f.fe >= '2026-11-09'; }
  function filasVisibles(lista) {
    const q = filtros.q.trim().toLowerCase();
    return lista.filter(f => {
      if (q && !(f.c + ' ' + f.cli + ' ' + f.cot + ' ' + f.ref + ' ' + f.desc).toLowerCase().includes(q)) return false;
      if (filtros.pend && f.fp) return false;
      if (filtros.dif && !tieneDiferencia(f)) return false;
      if (filtros.ciclo === 'proceso') { if (!esEnProceso(f)) return false; }
      else if (filtros.ciclo !== 'todos' && !(f.rec > 0 && f.fen && cicloDe(f.fen).clave === filtros.ciclo)) return false;
      return true;
    });
  }
    const boton = (clave, etiqueta, valor, nota, activo, i) => '<button type="button" class="cc-card cc-ctrl' + (activo ? ' on' : '') + '" data-filtro="' + clave + '" style="--i:' + i + '"><small>' + etiqueta + '</small><b>' + fmt(valor) + '</b><span>' + nota + '</span></button>';
  function controlCards(lista) {
    const pend = lista.filter(f => !f.fp).length;
    const dif = lista.filter(tieneDiferencia).length;
    return '<div class="cc-kpis cc-control">' + controlTarjetas(lista) + '</div>';
  }
  function controlTarjetas(lista) {
    const pend = lista.filter(f => !f.fp).length;
    const dif = lista.filter(tieneDiferencia).length;
    return '' +
      boton('dif', 'CON DIFERENCIA', dif, 'unidades o valor que no cuadran', filtros.dif, 4) +
      boton('pend', 'PENDIENTES DE PAGO', pend, 'pedidos sin fecha de pago', filtros.pend, 5) +
      boton('todos', 'PEDIDOS REVISADOS', lista.length, 'toca una tarjeta para filtrar', !filtros.dif && !filtros.pend, 6) +
      '';
  }
  function bloquePedidos(lista, conC, titulo) {
    listaActual = lista;
    conCActual = conC;
    const visibles = filasVisibles(lista).length;
    const filasTotal = filasVisibles(lista);
    const totalUnd = filasTotal.reduce((t, f) => t + (Number(f.env) || 0), 0);
    const totalValor = filasTotal.reduce((t, f) => t + (Number(f.env) || 0) * (Number(f.vu) || 0), 0);
    return '<div class="cc-bloque"><h4>' + titulo + ' · <span data-cc-count>' + fmt(visibles) + (filtros.ciclo === 'proceso' ? '' : ' de ' + fmt(lista.length)) + '</span></h4>' +
      '<div class="cc-filtros"><input type="search" class="cc-buscar" placeholder="Buscar cliente, cotización, referencia…" value="' + esc(filtros.q) + '">' +
      '<button type="button" data-filtro="pend" class="' + (filtros.pend ? 'on' : '') + '">Solo pendientes de pago</button>' +
      '<button type="button" data-filtro="dif" class="' + (filtros.dif ? 'on' : '') + '">Solo con diferencias</button></div>' +
      '<div class="cc-resumen-total"><span>Pedidos <b>' + fmt(visibles) + '</b></span><span>Unidades enviadas <b>' + fmt(totalUnd) + '</b></span><span>Valor final <b>' + pesos(totalValor) + '</b></span></div>' + '<div data-cc-tabla>' + tablaFilas(lista, conC) + '</div></div>';
  }
  // Tabla con las mismas columnas del Excel (en el mismo orden) y una columna de control.
  // Editar y eliminar filas de la base de contabilidad (con iconos)
  const ICONO_LAPIZ = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const ICONO_BASURA = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  const idFila = v => String(v ?? '').replace(/^c/, '');
  function recargar(panel, clave) {
    panel.classList.add('cc-cargando');
    cargarDatos().then(() => { panel.classList.remove('cc-cargando'); pintar(panel, clave); }).catch(() => { panel.classList.remove('cc-cargando'); window.alert('No se pudo actualizar la contabilidad.'); });
  }
  function abrirEditarFila(fila, panel, clave) {
    document.querySelector('.cc-modal-fondo')?.remove();
    const pago = /^\d{4}-\d{2}-\d{2}$/.test(fila.payment || '') ? fila.payment : '';
    const fondo = document.createElement('div');
    fondo.className = 'cc-modal-fondo';
    fondo.innerHTML = '<form class="cc-modal"><h4>Editar fila</h4><p>' + esc(fila.ref) + ' · ' + esc(fila.cli) + '</p>' +
      '<label>Unidades enviadas<input name="sent" type="number" min="0" step="1" value="' + (Number(fila.env) || 0) + '"></label>' +
      '<label>Unidades recibidas<input name="received" type="number" min="0" step="1" value="' + (Number(fila.rec) || 0) + '"></label>' +
      '<label>Valor unidad<input name="unit_value" type="number" min="0" step="1" value="' + (Number(fila.vu) || 0) + '"></label>' +
      '<label>Fecha de pago (vacía = sin pagar)<input name="payment" type="date" value="' + pago + '"></label>' +
      '<p class="cc-modal-error" hidden></p><div class="cc-modal-botones"><button type="button" data-cancelar>Cancelar</button><button type="submit">Guardar</button></div></form>';
    document.body.appendChild(fondo);
    const form = fondo.querySelector('form'), error = fondo.querySelector('.cc-modal-error');
    fondo.addEventListener('click', e => { if (e.target === fondo || e.target.matches('[data-cancelar]')) fondo.remove(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const fecha = String(fd.get('payment') || '');
      try {
        if (String(fila.id).startsWith('a')) throw new Error('Esta fila viene de la tarjeta de producción: cámbiala en la preparación de confección.');
        const esEnvio = String(fila.id).startsWith('p');
        const r = esEnvio
          ? await fetch('/api/confeccion/envios/' + String(fila.id).slice(1), {method: 'PUT', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({unidades: Number(fd.get('sent')), precio: Number(fd.get('unit_value')), confeccionista: fila.c})})
          : await fetch('/api/contabilidad-confeccion/filas/' + idFila(fila.id), {method: 'PUT', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sent: Number(fd.get('sent')), received: Number(fd.get('received')), unit_value: Number(fd.get('unit_value')), paid: Boolean(fecha), payment: fecha || null})});
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || 'No se pudo guardar.');
        fondo.remove();
        recargar(panel, clave);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  }
  async function eliminarFila(fila, panel, clave) {
    if (!window.confirm('¿Eliminar la fila ' + fila.ref + ' de ' + fila.cli + '? No se puede deshacer.')) return;
    try {
      if (String(fila.id).startsWith('a')) throw new Error('Esta fila viene de la tarjeta de producción: quítala desde la preparación de confección.');
      const r = String(fila.id).startsWith('p')
        ? await fetch('/api/confeccion/envios/' + String(fila.id).slice(1), {method: 'DELETE', credentials: 'same-origin'})
        : await fetch('/api/contabilidad-confeccion/filas/' + idFila(fila.id), {method: 'DELETE', credentials: 'same-origin'});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || 'No se pudo eliminar.');
      recargar(panel, clave);
    } catch (err) {
      window.alert(err.message);
    }
  }
  function tablaFilas(lista, conConfeccionista) {
    if (!lista.length) return '<p class="cc-nota">Sin pedidos enviados en 2026.</p>';
    const visibles = filasVisibles(lista);
    if (!visibles.length) return '<p class="cc-nota">Ningún pedido coincide con el filtro.</p>';
    const cabecera = (conConfeccionista ? '<th>Confeccionista</th>' : '') + '<th>Nombre del cliente (proyecto)</th><th>Cotización</th><th>Referencia</th><th>Descripción del producto</th><th>Fecha envío</th><th>Fecha entrega</th><th>Entrega al cliente</th><th class="n">Unidades enviadas</th><th class="n">Unidades recibidas</th><th class="n">Valor unidad</th><th class="n">Valor</th><th>Fecha de pago</th><th>Acciones</th>';
    const ordenados = visibles.slice().sort((a, b) => String(b.reg || '').localeCompare(String(a.reg || '')) || String(b.fen || '').localeCompare(String(a.fen || '')));
    const cuerpo = ordenados.map(f => '<tr>' + (conConfeccionista ? '<td>' + esc(f.c) + '</td>' : '') +
      '<td>' + esc(f.cli) + '</td><td>' + esc(f.cot) + '</td><td>' + esc(f.ref) + '</td><td>' + esc(f.desc) + '</td>' +
      '<td>' + esc(f.fe) + '</td><td>' + esc(f.fen) + '</td><td>' + (f.ec ? esc(fechaCorta(f.ec)) : '—') + '</td><td class="n">' + fmt(f.env) + '</td><td class="n">' + fmt(f.rec) + '</td>' +
      '<td class="n">' + pesos(f.vu) + '</td><td class="n">' + pesos(f.val) + '</td><td>' + (f.fp ? esc(f.fp) : '<span class="cc-pend">Pendiente</span>') + '</td>' +
      '<td class="cc-acc"><button type="button" class="cc-acc-btn" data-editar-fila="' + esc(f.id) + '" title="Editar" aria-label="Editar fila">' + ICONO_LAPIZ + '</button><button type="button" class="cc-acc-btn cc-acc-borrar" data-eliminar-fila="' + esc(f.id) + '" title="Eliminar" aria-label="Eliminar fila">' + ICONO_BASURA + '</button></td></tr>').join('');
    return '<div class="cc-tabla-wrap"><table class="cc-tabla"><thead><tr>' + cabecera + '</tr></thead><tbody>' + cuerpo + '</tbody></table></div>';
  }
  // Dos gráficas para «Todas»: curva de recibidos de los últimos 15 días y promedio de días de confección por confeccionista
  function diasEntre(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
  function graficasHTML() {
    const anio = 2026;
    const nombresMes = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const porMes = Array(12).fill(0);
    FILAS.forEach(f => { if (f.fen && f.rec > 0 && String(f.fen).startsWith(String(anio))) porMes[Number(String(f.fen).slice(5, 7)) - 1] += f.rec; });
    const vals = porMes;
    const max = Math.max(1, ...vals);
    const W = 600, H = 200, pl = 40, pr = 12, pt = 14, pb = 30;
    const x = i => pl + i * (W - pl - pr) / 11;
    const y = v => pt + (H - pt - pb) * (1 - v / max);
    const pts = vals.map((v, i) => [x(i), y(v)]);
    const linea = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = linea + ' L' + x(11).toFixed(1) + ' ' + (H - pb) + ' L' + x(0).toFixed(1) + ' ' + (H - pb) + ' Z';
    const ejeY = [0, 0.5, 1].map(f => { const v = Math.round(max * f); return '<text x="' + (pl - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" class="cc-eje">' + fmt(v) + '</text><line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="cc-rejilla"/>'; }).join('');
    const etiquetasX = nombresMes.map((m, i) => '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="cc-eje">' + m + '</text>').join('');
    const puntos = pts.map((p, i) => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" class="cc-punto"><title>' + nombresMes[i] + ' ' + anio + ': ' + fmt(vals[i]) + ' und. recibidas</title></circle>').join('');
    const curva = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cc-svg" role="img" aria-label="Unidades recibidas por mes en 2026">' + ejeY + '<path d="' + area + '" class="cc-area"/><path d="' + linea + '" class="cc-linea"/>' + puntos + etiquetasX + '</svg>';

    const acum = {};
    FILAS.forEach(f => { if (!f.fe || !f.fen || !(f.rec > 0)) return; const d = diasEntre(f.fe, f.fen); if (d < 0) return; const g = acum[f.c] || (acum[f.c] = {d: 0, u: 0}); g.d += d * f.rec; g.u += f.rec; });
    const filas = Object.entries(acum).map(([n, g]) => ({n, dias: g.u ? g.d / g.u : 0})).sort((a, b) => a.dias - b.dias);
    const totD = Object.values(acum).reduce((t, g) => t + g.d, 0), totU = Object.values(acum).reduce((t, g) => t + g.u, 0);
    const promedio = totU ? (totD / totU).toFixed(1) : '—';
    const maxD = Math.max(1, ...filas.map(f => f.dias));
    const barras = filas.map(f => '<div class="cc-barra-dias"><span title="' + esc(f.n) + '">' + esc(f.n) + '</span><i><em style="width:' + Math.round(f.dias / maxD * 100) + '%"></em></i><b>' + f.dias.toFixed(1) + ' días</b></div>').join('') || '<p class="cc-nota">Sin fechas de envío y entrega.</p>';

    const nombresMesDesc = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const porDescMes = {};
    FILAS.forEach(f => {
      const k = String(f.desc || '').trim();
      if (!k || !(f.rec > 0)) return;
      const mes = f.fen ? String(f.fen).slice(5, 7) : '';
      ['todo', mes].forEach(clave => {
        if (!clave) return;
        porDescMes[clave] = porDescMes[clave] || {};
        porDescMes[clave][k] = (porDescMes[clave][k] || 0) + f.rec;
      });
    });
    const mesesDesc = Object.keys(porDescMes).filter(k => k !== 'todo').sort();
    const mesDefecto = mesesDesc[mesesDesc.length - 1] || 'todo';
    const barrasDe = mapa => {
      const top = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 12);
      if (!top.length) return '<p class="cc-nota">Sin unidades en este periodo.</p>';
      const max = Math.max(1, ...top.map(e => e[1]));
      const W = 640, H = 300, pl = 64, pr = 8, pt = 28, pb = 104;
      const base = H - pb;
      const slot = (W - pl - pr) / top.length;
      const bw = Math.min(46, slot * 0.6);
      const columnas = top.map(([nm, u], i) => {
        const x = pl + i * slot + (slot - bw) / 2;
        const h = (u / max) * (base - pt);
        const y = base - h;
        const cx = (x + bw / 2).toFixed(1);
        return '<g class="cc-col"><title>' + esc(nm) + ': ' + fmt(u) + ' und.</title>'
          + '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="7" class="cc-col-barra"/>'
          + '<text x="' + cx + '" y="' + (y - 7).toFixed(1) + '" text-anchor="middle" class="cc-col-valor">' + fmt(u) + '</text>'
          + '<text transform="translate(' + cx + ',' + (base + 12) + ') rotate(-35)" text-anchor="end" class="cc-col-nombre">' + esc(nm) + '</text></g>';
      }).join('');
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cc-svg cc-cols" role="img" aria-label="Unidades fabricadas por producto">'
        + '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="cc-rejilla"/>' + columnas + '</svg>';
    };
    const opcionesDesc = [['todo', 'Todo 2026']].concat(mesesDesc.map(k => [k, nombresMesDesc[Number(k) - 1]]))
      .map(([v, t]) => '<option value="' + v + '"' + (v === mesDefecto ? ' selected' : '') + '>' + t + '</option>').join('');
    const selectDesc = '<label class="cc-selector cc-selector-desc"><span>Mes</span><select class="cc-select cc-desc-mes" aria-label="Elegir mes">' + opcionesDesc + '</select></label>';
    const panelesDesc = ['todo'].concat(mesesDesc).map(k => '<div class="cc-desc-mes-panel" data-mes="' + k + '"' + (k !== mesDefecto ? ' hidden' : '') + '><div class="cc-barras-dias">' + barrasDe(porDescMes[k] || {}) + '</div></div>').join('');
    return '<div class="cc-graficas">' +
      '<section class="cc-grafica"><header><small>POR MES · 2026</small><h4>Curva del rendimiento de confección</h4><p>Unidades recibidas por mes en 2026.</p></header>' + curva + '</section>' +
      '<section class="cc-grafica"><header><small>PROMEDIO EN DÍAS DE CONFECCIÓN</small><h4>' + promedio + ' días en promedio</h4><p>Días entre envío y entrega, ponderado por unidades.</p></header><div class="cc-barras-dias">' + barras + '</div></section>' +
      '<section class="cc-grafica cc-grafica-ancha"><header><small>POR DESCRIPCIÓN</small><h4>Cuánto hemos fabricado por producto</h4><p>Unidades recibidas de cada descripción (ficha técnica), de mayor a menor.</p></header>' + selectDesc + panelesDesc + '</section>' +
      '</div>';
  }
  function vistaTodas() {
    const t = totales(DATOS);
    return '<div class="cc-wrap"><div class="cc-head cc-head-fila"><div><span>CONTABILIDAD CONFECCIÓN</span><h3>Todas las confeccionistas · 2026</h3></div><button type="button" class="cc-liq-btn cc-liq-todas-grande" id="cc-liq-todas">Liquidar toda la confección</button></div>' +
      '<div class="cc-kpis cc-fila-unica">' + kpisTarjetas(t) + controlTarjetas(FILAS) + '</div>' +
      graficasHTML() +
      '<p class="cc-nota">Cifras tomadas del Excel de confecciones (pedidos con fecha de envío en 2026).</p></div>';
  }
  // Ciclos de liquidación cada 15 días (1 al 15 y 16 al fin de mes), según la fecha de entrega
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function cicloDe(fecha) {
    const [y, m, d] = fecha.split('-');
    const primera = Number(d) <= 15;
    return {clave: y + '-' + m + '-' + (primera ? '1' : '2'), texto: (primera ? '1 al 15' : '16 al fin de mes') + ' de ' + MESES_CORTOS[Number(m) - 1] + ' ' + y};
  }
  function ciclosHTML(lista) {
    const enProceso = lista.filter(f => f.env > f.rec);
    const unidadesProceso = enProceso.reduce((t, f) => t + (f.env - f.rec), 0);
    const ciclos = {};
    lista.filter(f => f.rec > 0 && f.fen).forEach(f => {
      const c = cicloDe(f.fen);
      const g = ciclos[c.clave] || (ciclos[c.clave] = {texto: c.texto, u: 0, v: 0, pendiente: 0});
      g.u += f.rec; g.v += f.val; if (!f.fp) g.pendiente += f.val;
    });
    const orden = Object.keys(ciclos).sort().reverse();
    const tarjetas = orden.map(k => {
      const g = ciclos[k];
      return '<article class="cc-ciclo"><small>ENTREGADO</small><b>' + esc(g.texto) + '</b><span>' + fmt(g.u) + ' und. recibidas</span><span>' + pesos(g.v) + '</span><em>' + (g.pendiente ? pesos(g.pendiente) + ' por liquidar' : 'Liquidado') + '</em></article>';
    }).join('');
    return '<div class="cc-bloque cc-ciclos"><h4>CICLOS DE LIQUIDACIÓN · CADA 15 DÍAS</h4><div class="cc-ciclos-grid">' +
      '<article class="cc-ciclo cc-ciclo-proceso"><small>EN PROCESO</small><b>' + fmt(enProceso.length) + ' pedidos</b><span>' + fmt(unidadesProceso) + ' und. por entregar</span><em>Aún no entregado</em></article>' +
      (tarjetas || '<p class="cc-nota">Todavía no hay entregas registradas.</p>') +
      '</div></div>';
  }
  function textoClave(k) {
    if (k === 'proceso') return 'En proceso';
    const [y, m, h] = k.split('-');
    return (h === '1' ? '1 al 15' : '16 al fin de mes') + ' de ' + MESES_CORTOS[Number(m) - 1] + ' ' + y;
  }
  function opcionesCiclo(lista) {
    const proceso = lista.filter(esEnProceso).length;
    const m = {};
    lista.forEach(f => { if (f.rec > 0 && f.fen) { const k = cicloDe(f.fen).clave; m[k] = (m[k] || 0) + 1; } });
    const claves = Object.keys(m).sort().reverse();
    return (proceso ? [{k: 'proceso', texto: 'En proceso', n: proceso}] : []).concat(claves.map(k => ({k, texto: textoClave(k), n: m[k]})));
  }
  // Botón Liquidar: muestra cuánto y cuántas prendas se le deben a la confeccionista (recibidas y sin pagar)
  function abrirLiquidar(nombre) {
    document.querySelector('.cc-modal-fondo')?.remove();
    const debe = FILAS.filter(f => f.c === nombre && f.rec > 0 && !f.fp && (f.fen || '') >= '2026-11-01');
    const unidades = debe.reduce((t, f) => t + f.rec, 0);
    const valor = debe.reduce((t, f) => t + f.val, 0);
    const porCiclo = {};
    debe.forEach(f => {
      const k = f.fen ? cicloDe(f.fen).clave : 'sin-fecha';
      const g = porCiclo[k] || (porCiclo[k] = {texto: f.fen ? textoClave(k) : 'Sin fecha de entrega', u: 0, v: 0});
      g.u += f.rec; g.v += f.val;
    });
    const filas = Object.keys(porCiclo).sort().reverse().map(k => '<tr><td>' + esc(porCiclo[k].texto) + '</td><td>' + fmt(porCiclo[k].u) + '</td><td>' + pesos(porCiclo[k].v) + '</td></tr>').join('');
    const fondo = document.createElement('div');
    fondo.className = 'cc-modal-fondo';
    fondo.innerHTML = '<div class="cc-modal cc-liq-modal" role="dialog" aria-label="Liquidar confección">' +
      '<h4>Liquidar · ' + esc(nombre) + '</h4><p>Prendas recibidas y todavía sin pagar</p>' +
      '<div class="cc-liq-total"><div><small>UNIDADES POR PAGAR</small><b>' + fmt(unidades) + '</b></div><div><small>LE DEBEMOS</small><b>' + pesos(valor) + '</b></div></div>' +
      (debe.length ? '<table class="cc-liq-tabla"><thead><tr><th>Ciclo</th><th>Und.</th><th>Valor</th></tr></thead><tbody>' + filas + '</tbody></table>' : '<p>No hay prendas recibidas sin pagar.</p>') +
      '<div class="cc-modal-botones"><button type="button" data-cancelar>Cerrar</button></div></div>';
    document.body.appendChild(fondo);
    fondo.addEventListener('click', e => { if (e.target === fondo || e.target.matches('[data-cancelar]')) fondo.remove(); });
  }
  // Cuenta de cobro: se abre con el botón Liquidar y se imprime con el logo de Indoor y espacio para firmar
  function letrasNumero(n) {
    const bajos = ['CERO','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE'];
    const decenas = ['','','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
    const centenas = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
    const tramo = v => {
      if (v <= 20) return bajos[v];
      if (v < 30) return 'VEINTI' + tramo(v - 20);
      if (v < 100) return decenas[Math.floor(v / 10)] + (v % 10 ? ' Y ' + tramo(v % 10) : '');
      if (v === 100) return 'CIEN';
      if (v < 1000) return centenas[Math.floor(v / 100)] + (v % 100 ? ' ' + tramo(v % 100) : '');
      if (v < 1000000) return (Math.floor(v / 1000) === 1 ? 'MIL' : tramo(Math.floor(v / 1000)) + ' MIL') + (v % 1000 ? ' ' + tramo(v % 1000) : '');
      return (Math.floor(v / 1000000) === 1 ? 'UN MILLÓN' : tramo(Math.floor(v / 1000000)) + ' MILLONES') + (v % 1000000 ? ' ' + tramo(v % 1000000) : '');
    };
    const redondo = Math.round(n || 0);
    return redondo === 0 ? 'CERO' : tramo(redondo);
  }
  function fechaCorta(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function abrirCuenta(nombre) {
    document.querySelector('.cc-cuenta-fondo')?.remove();
    const debe = FILAS.filter(f => f.c === nombre && f.rec > 0 && !f.fp && (f.fen || '') >= '2026-11-01').sort((a, b) => String(a.fen).localeCompare(String(b.fen)));
    const unidades = debe.reduce((t, f) => t + f.rec, 0);
    const valor = debe.reduce((t, f) => t + f.val, 0);
    const fechas = debe.map(f => f.fen).filter(Boolean).sort();
    const periodo = fechas.length ? fechaCorta(fechas[0]) + ' al ' + fechaCorta(fechas[fechas.length - 1]) : '—';
    const hoy = new Date();
    const hoyTxt = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
    const filas = debe.map(f => '<tr><td>' + fechaCorta(f.fen) + '</td><td class="cc-cuenta-cli" style="font-size:' + (String(f.cli || '').length > 40 ? 6 : String(f.cli || '').length > 32 ? 6.8 : 8) + 'px">' + esc(f.cli) + '</td><td>' + esc(f.cot) + '</td><td>' + esc(f.ref) + '</td><td>' + fmt(f.rec) + '</td><td>' + pesos(f.vu) + '</td><td>' + pesos(f.val) + '</td></tr>').join('');
    const fondo = document.createElement('div');
    fondo.className = 'cc-cuenta-fondo';
    fondo.innerHTML = '<div class="cc-cuenta-hoja">' +
      '<div class="cc-cuenta-cab"><img src="/marca-indoor.svg" alt="Indoor" class="cc-cuenta-logo"><div><b>INDOOR SPORT SAS</b><br>NIT 901282105</div></div>' +
      '<h2 class="c">Cuenta de cobro 2026</h2>' +
      '<p class="c">Fecha: ' + hoyTxt + '</p>' +
      '<p class="c"><b>DEBE A:</b></p>' +
      '<p class="c"><b>' + esc(nombre) + '</b><br>C.C. <input class="cc-cuenta-campo" placeholder="____________________"> de <input class="cc-cuenta-campo" placeholder="ciudad"></p>' +
      '<p class="c"><b>LA SUMA DE:</b></p>' +
      '<p class="c"><b>' + letrasNumero(valor) + ' PESOS (' + pesos(valor) + ')</b></p>' +
      '<p>Por el concepto de confección de prendas recibidas desde el <b>' + periodo + '</b>, según el detalle que sigue.</p>' +
      (debe.length
        ? '<table class="cc-cuenta-tabla"><thead><tr><th>Entrega</th><th>Cliente</th><th>Cotización</th><th>Referencia</th><th>Und.</th><th>Valor unidad</th><th>Valor</th></tr></thead><tbody>' + filas + '</tbody><tfoot><tr><td colspan="4">TOTAL</td><td>' + fmt(unidades) + '</td><td></td><td>' + pesos(valor) + '</td></tr></tfoot></table>'
        : '<p class="c">No hay prendas recibidas sin pagar.</p>') +
      '<p class="cc-cuenta-legal">Con el fin de dar cumplimiento a las disposiciones establecidas en la Ley 1819 de 2016 y del parágrafo 2 del artículo 383 del Estatuto Tributario, manifiesto bajo gravedad de juramento que:</p>' +
      '<p class="cc-cuenta-legal">Para efectos de la aplicación de la tabla de retención en la fuente establecida en el artículo 383 del Estatuto Tributario, la cual se aplica a los pagos o abonos en cuenta por concepto de ingresos por honorarios y por compensación por servicios personales, «No he contratado o vinculado más de un trabajador asociado a mi actividad económica por al menos noventa (90) días continuos o discontinuos». (Parágrafo 2 art. 383 E.T.)</p>' +
      '<p>Cordialmente,</p>' +
      '<div class="cc-cuenta-firma"><div class="cc-cuenta-linea"></div><p>' + esc(nombre) + '<br>C.C. <input class="cc-cuenta-campo" placeholder="____________________"><br>Celular: <input class="cc-cuenta-campo" placeholder="____________"></p></div>' +
      '</div>' +
      '<div class="cc-cuenta-acciones cc-no-print"><button type="button" class="cc-liq-btn" data-descargar>Descargar</button><button type="button" class="cc-liq-btn" data-imprimir>Imprimir / guardar PDF</button><button type="button" class="cc-liq-btn cc-liq-btn-sec" data-cancelar>Cerrar</button></div>';
    document.body.appendChild(fondo);
    fondo.querySelectorAll('.cc-cuenta-campo').forEach(inp => {
      inp.style.setProperty('background', 'transparent', 'important');
      inp.style.setProperty('color', '#111', 'important');
      inp.style.setProperty('border', '0', 'important');
      inp.style.setProperty('border-bottom', '1px dotted #555', 'important');
      inp.style.setProperty('box-shadow', 'none', 'important');
      inp.style.setProperty('padding', '0 4px', 'important');
    });
    fondo.querySelector('[data-imprimir]').addEventListener('click', () => window.print());
    fondo.querySelector('[data-descargar]').addEventListener('click', () => descargarCuenta(nombre));
    fondo.addEventListener('click', e => { if (e.target === fondo || e.target.matches('[data-cancelar]')) fondo.remove(); });
  }
  // Descarga directa de la cuenta de cobro (documento de Word, editable y listo para firmar)
  async function descargarCuenta(nombre) {
    const hoja = document.querySelector('.cc-cuenta-hoja');
    if (!hoja) return;
    const copia = hoja.cloneNode(true);
    copia.querySelectorAll('input.cc-cuenta-campo').forEach(inp => {
      const span = document.createElement('span');
      span.textContent = inp.value || inp.placeholder || '____________________';
      span.style.borderBottom = '1px dotted #555';
      span.style.padding = '0 6px';
      inp.replaceWith(span);
    });
    copia.querySelectorAll('.cc-cuenta-cab img').forEach(img => { img.removeAttribute('class'); img.style.height = '40px'; });
    try {
      const svg = await (await fetch('/marca-indoor.svg', {cache: 'no-store'})).text();
      const logo = copia.querySelector('.cc-cuenta-cab img');
      if (logo) logo.setAttribute('src', 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))));
    } catch (_) { copia.querySelector('.cc-cuenta-cab img')?.remove(); }
    const estilo = 'body{font-family:Arial,sans-serif;color:#111;font-size:12pt} table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8pt} th,td{border-bottom:1px solid #ccc;padding:4px 1px;text-align:center;white-space:nowrap;overflow:hidden} th{background:#eef5e2} tfoot td{font-weight:bold;border-top:2px solid #111;border-bottom:0} .c{text-align:center} h2{font-size:16pt} p{margin:6px 0;line-height:1.4} .cc-cuenta-legal{font-size:10pt;text-align:justify} .cc-cuenta-firma{margin-top:40px;width:300pt} .cc-cuenta-linea{border-top:1px solid #111;margin-bottom:4px} .cc-cuenta-cab{margin-bottom:14px} .cc-cuenta-cab img{background:#0b140c;padding:8px 14px;border-radius:8px}';
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cuenta de cobro - ' + esc(nombre) + '</title><style>' + estilo + '</style></head><body>' + copia.outerHTML + '</body></html>';
    const blob = new Blob(['﻿', html], {type: 'application/msword'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Cuenta de cobro - ' + nombre.replace(/[\\/:*?"<>|]/g, '') + '.doc';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  // Liquidar toda la confección: una cuenta de cobro en PDF por confeccionista (quincena actual, sin pagar)
  const MESES_PDF = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  function periodoPdf() {
    const h = new Date();
    return h.getDate() + ' ' + MESES_PDF[h.getMonth()];
  }
  function debeDeConfeccion(nombre) {
    return FILAS.filter(f => f.c === nombre && f.rec > 0 && !f.fp).sort((a, b) => String(a.fen).localeCompare(String(b.fen)));
  }
  function cargarScriptExterno(src) {
    return new Promise((resolve, reject) => {
      if (src.includes('jszip') ? window.JSZip : window.html2pdf) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar el generador de PDF.'));
      document.head.appendChild(s);
    });
  }
  function cuentaHTML(nombre, debe, logoSrc) {
    const unidades = debe.reduce((t, f) => t + f.rec, 0);
    const valor = debe.reduce((t, f) => t + f.val, 0);
    const fechas = debe.map(f => f.fen).filter(Boolean).sort();
    const periodo = fechas.length ? fechaCorta(fechas[0]) + ' al ' + fechaCorta(fechas[fechas.length - 1]) : '—';
    const hoy = new Date();
    const hoyTxt = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
    const filas = debe.map(f => '<tr><td>' + fechaCorta(f.fen) + '</td><td class="cc-cuenta-cli" style="font-size:' + (String(f.cli || '').length > 40 ? 6 : String(f.cli || '').length > 32 ? 6.8 : 8) + 'px">' + esc(f.cli) + '</td><td>' + esc(f.cot) + '</td><td>' + esc(f.ref) + '</td><td>' + fmt(f.rec) + '</td><td>' + pesos(f.vu) + '</td><td>' + pesos(f.val) + '</td></tr>').join('');
    const linea = '<span style="display:inline-block;width:170px;border-bottom:1px dotted #555">&nbsp;</span>';
    return '<div class="cc-cuenta-hoja">' +
      '<div class="cc-cuenta-cab"><img src="' + logoSrc + '" alt="Indoor" class="cc-cuenta-logo"><div><b>INDOOR SPORT SAS</b><br>NIT 901282105</div></div>' +
      '<h2 class="c">Cuenta de cobro 2026</h2>' +
      '<p class="c">Fecha: ' + hoyTxt + '</p>' +
      '<p class="c"><b>DEBE A:</b></p>' +
      '<p class="c"><b>' + esc(nombre) + '</b><br>C.C. ' + linea + ' de ' + linea + '</p>' +
      '<p class="c"><b>LA SUMA DE:</b></p>' +
      '<p class="c"><b>' + letrasNumero(valor) + ' PESOS (' + pesos(valor) + ')</b></p>' +
      '<p>Por el concepto de confección de prendas recibidas desde el <b>' + periodo + '</b>, según el detalle que sigue.</p>' +
      '<table class="cc-cuenta-tabla"><thead><tr><th>Entrega</th><th>Cliente</th><th>Cotización</th><th>Referencia</th><th>Und.</th><th>Valor unidad</th><th>Valor</th></tr></thead><tbody>' + filas + '</tbody><tfoot><tr><td colspan="4">TOTAL</td><td>' + fmt(unidades) + '</td><td></td><td>' + pesos(valor) + '</td></tr></tfoot></table>' +
      '<p class="cc-cuenta-legal">Con el fin de dar cumplimiento a las disposiciones establecidas en la Ley 1819 de 2016 y del parágrafo 2 del artículo 383 del Estatuto Tributario, manifiesto bajo gravedad de juramento que:</p>' +
      '<p class="cc-cuenta-legal">Para efectos de la aplicación de la tabla de retención en la fuente establecida en el artículo 383 del Estatuto Tributario, la cual se aplica a los pagos o abonos en cuenta por concepto de ingresos por honorarios y por compensación por servicios personales, «No he contratado o vinculado más de un trabajador asociado a mi actividad económica por al menos noventa (90) días continuos o discontinuos». (Parágrafo 2 art. 383 E.T.)</p>' +
      '<p>Cordialmente,</p>' +
      '<div class="cc-cuenta-firma"><div class="cc-cuenta-linea"></div><p>' + esc(nombre) + '<br>C.C. ' + linea + '<br>Celular: ' + linea + '</p></div>' +
      '</div>';
  }
  // Liquidar toda la confección: descarga en ráfaga un PDF por confeccionista con todo lo entregado y no pagado
  async function cargarJsPDF() {
    if (window.jspdf) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar el generador de PDF.'));
      document.head.appendChild(s);
    });
  }
  function logoPng() {
    return new Promise(resolve => {
      fetch('/marca-indoor.svg', {cache: 'no-store'}).then(r => r.text()).then(svg => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = 900; c.height = 300;
          const x = c.getContext('2d');
          x.fillStyle = '#0b140c'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(img, 60, 40, c.width - 120, c.height - 80);
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      }).catch(() => resolve(null));
    });
  }
  function pdfCuenta(doc, nombre, debe, logo, periodo) {
    const W = 612, M = 54, ancho = W - M * 2;
    let y = 50;
    const centrado = (t, size, bold, yy) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.text(String(t), W / 2, yy, {align: 'center'}); };
    const recortar = (t, max, size) => { doc.setFontSize(size); let r = String(t ?? ''); while (r.length > 1 && doc.getTextWidth(r) > max - 4) r = r.slice(0, -1); return r; };
    if (logo) doc.addImage(logo, 'PNG', M, y, 120, 40);
    const x0 = logo ? M + 130 : M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('INDOOR SPORT SAS', x0, y + 12);
    doc.setFont('helvetica', 'normal'); doc.text('NIT 901282105', x0, y + 24);
    y += 70;
    const hoy = new Date();
    const hoyTxt = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
    const total = debe.reduce((t, f) => t + f.val, 0);
    const unidades = debe.reduce((t, f) => t + f.rec, 0);
    centrado('Cuenta de cobro 2026', 15, true, y); y += 22;
    centrado('Fecha: ' + hoyTxt, 10, false, y); y += 24;
    centrado('DEBE A:', 10, true, y); y += 14;
    centrado(nombre, 11, true, y); y += 14;
    centrado('C.C. ____________________  de  ____________________', 10, false, y); y += 22;
    centrado('LA SUMA DE:', 10, true, y); y += 14;
    centrado(letrasNumero(total) + ' PESOS (' + pesos(total) + ')', 10, true, y); y += 22;
    const fechas = debe.map(f => f.fen).filter(Boolean).sort();
    const rango = fechas.length ? fechaCorta(fechas[0]) + ' al ' + fechaCorta(fechas[fechas.length - 1]) : periodo;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const concepto = doc.splitTextToSize('Por el concepto de confección de prendas recibidas desde el ' + rango + ', según el detalle que sigue.', ancho);
    doc.text(concepto, M, y); y += concepto.length * 12 + 8;
    const cols = [{h: 'Entrega', w: 50}, {h: 'Cliente', w: 150}, {h: 'Cotización', w: 60}, {h: 'Referencia', w: 110}, {h: 'Und.', w: 30}, {h: 'Valor unidad', w: 62}, {h: 'Valor', w: 42}];
    const cabecera = () => {
      doc.setFillColor(238, 245, 226); doc.rect(M, y, ancho, 16, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(17, 17, 17);
      let x = M; cols.forEach(c => { doc.text(c.h, x + c.w / 2, y + 11, {align: 'center'}); x += c.w; });
      y += 16;
    };
    cabecera();
    doc.setFont('helvetica', 'normal');
    debe.forEach(f => {
      if (y > 700) { doc.addPage(); y = 50; cabecera(); doc.setFont('helvetica', 'normal'); }
      const vals = [fechaCorta(f.fen), f.cli, f.cot, f.ref, fmt(f.rec), pesos(f.vu), pesos(f.val)];
      doc.setFontSize(7.5);
      let x = M;
      cols.forEach((c, i) => { const tam = i === 1 ? Math.max(5, Math.min(7.5, 7.5 * (c.w - 6) / Math.max(doc.getTextWidth(String(vals[i] || '')), 1))) : 7.5; doc.setFontSize(tam); doc.text(recortar(vals[i], c.w, tam), x + c.w / 2, y + 11, {align: 'center'}); doc.setFontSize(7.5); x += c.w; });
      doc.setDrawColor(200, 200, 200); doc.line(M, y + 15, M + ancho, y + 15);
      y += 15;
    });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setDrawColor(17, 17, 17); doc.setLineWidth(1); doc.line(M, y + 2, M + ancho, y + 2); doc.setLineWidth(0.2);
    doc.text('TOTAL', M + 4, y + 13);
    doc.text(fmt(unidades), M + 50 + 150 + 60 + 110 + 15, y + 13, {align: 'center'});
    doc.text(pesos(total), M + ancho - 27, y + 13, {align: 'center'});
    y += 30;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const legal1 = doc.splitTextToSize('Con el fin de dar cumplimiento a las disposiciones establecidas en la Ley 1819 de 2016 y del parágrafo 2 del artículo 383 del Estatuto Tributario, manifiesto bajo gravedad de juramento que:', ancho);
    doc.text(legal1, M, y); y += legal1.length * 11 + 6;
    const legal2 = doc.splitTextToSize('Para efectos de la aplicación de la tabla de retención en la fuente establecida en el artículo 383 del Estatuto Tributario, la cual se aplica a los pagos o abonos en cuenta por concepto de ingresos por honorarios y por compensación por servicios personales, «No he contratado o vinculado más de un trabajador asociado a mi actividad económica por al menos noventa (90) días continuos o discontinuos». (Parágrafo 2 art. 383 E.T.)', ancho);
    doc.text(legal2, M, y); y += legal2.length * 11 + 16;
    doc.text('Cordialmente,', M, y); y += 46;
    doc.setDrawColor(17, 17, 17); doc.line(M, y, M + 240, y); y += 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(nombre, M, y); y += 12;
    doc.text('C.C. ____________________________', M, y); y += 12;
    doc.text('Celular: ________________________', M, y);
  }
  async function liquidarTodaConfeccion() {
    const nombres = [...new Set(FILAS.filter(f => f.rec > 0 && !f.fp).map(f => f.c))].sort();
    if (!nombres.length) { window.alert('No hay entregas sin pagar.'); return; }
    if (!window.confirm('Se descargarán ' + nombres.length + ' cuentas de cobro en PDF, una por confeccionista, con todo lo entregado y no pagado. ¿Continuar?')) return;
    try {
      await cargarJsPDF();
      const logo = await logoPng();
      const periodo = periodoPdf();
      for (const nombre of nombres) {
        const jsPDF = window.jspdf.jsPDF;
        const doc = new jsPDF({unit: 'pt', format: 'letter', orientation: 'portrait'});
        pdfCuenta(doc, nombre, debeDeConfeccion(nombre), logo, periodo);
        doc.save(nombre.toUpperCase() + ' AL ' + periodo + '.pdf');
        await new Promise(r => setTimeout(r, 350));
      }
    } catch (err) {
      window.alert(err.message || 'No se pudieron generar las cuentas de cobro.');
    }
  }
  function vistaUna(d) {
    const propias = FILAS.filter(f => f.c === d.nombre);
    return '<div class="cc-wrap"><div class="cc-head"><span>CONTABILIDAD CONFECCIÓN · ' + esc(d.nombre) + '</span><h3>Resumen de confección · 2026</h3></div>' +
      bloquePedidos(propias, false, (filtros.ciclo === 'proceso' ? 'EN PROCESO · ' : 'PEDIDOS DE ') + esc(d.nombre.toUpperCase())) +
      '<p class="cc-nota">Cifras tomadas del Excel de confecciones (pedidos con fecha de envío en 2026).</p></div>';
  }
  function pintar(panel, clave) {
    const opciones = [['todas', 'Todas las confeccionistas · ' + fmt(DATOS.reduce((t, d) => t + d.pedidos, 0)) + ' pedidos']].concat(DATOS.map((d, i) => ['c' + i, d.nombre + ' · ' + fmt(d.pedidos) + ' pedidos'])).map(([id, label]) =>
      '<option value="' + id + '"' + (id === clave ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
    const selector = '<label class="cc-selector"><span>Confeccionista</span><select class="cc-select cc-select-confec" aria-label="Elegir confeccionista">' + opciones + '</select></label>';
    let cicloSel = '';
    if (clave !== 'todas') {
      const propias = FILAS.filter(f => f.c === DATOS[Number(clave.slice(1))].nombre);
      const ops = opcionesCiclo(propias);
      const total = propias.length;
      cicloSel = '<label class="cc-selector cc-selector-ciclo"><span>Ciclo</span><select class="cc-select cc-select-ciclo" aria-label="Elegir ciclo de liquidación"><option value="todos"' + (filtros.ciclo === 'todos' ? ' selected' : '') + '>Todos los ciclos · ' + fmt(total) + ' pedidos</option>' +
        ops.map(o => '<option value="' + o.k + '"' + (filtros.ciclo === o.k ? ' selected' : '') + '>' + esc(o.texto) + ' · ' + fmt(o.n) + ' pedidos</option>').join('') + '</select></label>';
    }
    const contenido = clave === 'todas' ? vistaTodas() : vistaUna(DATOS[Number(clave.slice(1))]);
    let liqBtn = '';
    if (clave !== 'todas') {
      const nombreConf = DATOS[Number(clave.slice(1))].nombre;
      const debeConf = FILAS.filter(f => f.c === nombreConf && f.rec > 0 && !f.fp && (f.fen || '') >= '2026-11-01');
      const undsConf = debeConf.reduce((t, f) => t + f.rec, 0), valorConf = debeConf.reduce((t, f) => t + f.val, 0);
      const hoyLiq = new Date();
      const proxLiq = hoyLiq.getDate() <= 15 ? new Date(hoyLiq.getFullYear(), hoyLiq.getMonth(), 16) : new Date(hoyLiq.getFullYear(), hoyLiq.getMonth() + 1, 1);
      const proxTxt = String(proxLiq.getDate()).padStart(2, '0') + '/' + String(proxLiq.getMonth() + 1).padStart(2, '0') + '/' + proxLiq.getFullYear();
      liqBtn = '<button type="button" class="cc-liq-btn">Liquidar · ' + pesos(valorConf) + ' · ' + fmt(undsConf) + ' und.</button><span class="cc-prox-liq">Próxima liquidación: <b>' + proxTxt + '</b></span>';
    }
    panel.innerHTML = '<div class="cc-barra-selectores">' + selector + cicloSel + liqBtn + '</div>' + contenido;
    panel.querySelector('.cc-select-confec')?.addEventListener('change', e => { filtros.ciclo = 'proceso'; pintar(panel, e.target.value); });
    panel.querySelector('.cc-select-ciclo')?.addEventListener('change', e => { filtros.ciclo = e.target.value; pintar(panel, clave); });
    panel.querySelector('.cc-liq-btn')?.addEventListener('click', () => abrirCuenta(DATOS[Number(clave.slice(1))].nombre));
    panel.querySelector('#cc-liq-todas')?.addEventListener('click', liquidarTodaConfeccion);
    panel.querySelector('.cc-desc-mes')?.addEventListener('change', e => { panel.querySelectorAll('.cc-desc-mes-panel').forEach(d => { d.hidden = d.dataset.mes !== e.target.value; }); });
    panel.querySelectorAll('[data-editar-fila]').forEach(b => b.addEventListener('click', () => { const f = FILAS.find(x => String(x.id) === b.dataset.editarFila); if (f) abrirEditarFila(f, panel, clave); }));
    panel.querySelectorAll('[data-eliminar-fila]').forEach(b => b.addEventListener('click', () => { const f = FILAS.find(x => String(x.id) === b.dataset.eliminarFila); if (f) eliminarFila(f, panel, clave); }));
    panel.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => {
      const i = DATOS.findIndex(d => d.nombre === b.dataset.ir);
      if (i >= 0) pintar(panel, 'c' + i);
    }));
    panel.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.filtro;
      if (f === 'todos') { filtros.pend = false; filtros.dif = false; }
      else filtros[f] = !filtros[f];
      pintar(panel, clave);
    }));
    const buscar = panel.querySelector('.cc-buscar');
    if (buscar) buscar.addEventListener('input', () => {
      filtros.q = buscar.value;
      const cont = panel.querySelector('[data-cc-tabla]');
      if (cont) cont.innerHTML = tablaFilas(listaActual, conCActual);
      const n = panel.querySelector('[data-cc-count]');
      if (n) n.textContent = fmt(filasVisibles(listaActual).length) + ' de ' + fmt(listaActual.length);
    });
  }
  function activarPanel(panel) {
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode');
  }
  function crearPanel() {
    let panel = document.querySelector('.panel[data-panel="contabilidad-confeccion"]');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.className = 'panel contabilidad-confeccion-panel';
    panel.dataset.panel = 'contabilidad-confeccion';
    document.querySelector('main')?.appendChild(panel);
    panel.style.setProperty('background', 'transparent', 'important'); panel.style.setProperty('box-shadow', 'none', 'important'); panel.style.setProperty('border', '0', 'important'); panel.style.setProperty('padding', '0', 'important');
    panel.innerHTML = '<div class="cc-carga" role="status"><img src="/marca-indoor.svg" alt="" aria-hidden="true"><b>Contabilidad confección</b><span>Cargando…</span></div>';
    cargarDatos().then(() => { panel.removeAttribute('style'); pintar(panel, 'todas'); }).catch(() => { panel.innerHTML = '<p class="cc-nota">No se pudieron cargar los datos de contabilidad.</p>'; });
    return panel;
  }
  function agregarBoton() {
    if (document.getElementById('open-contabilidad-confeccion')) return true;
    const ancla = document.getElementById('open-promedios');
    if (!ancla || !document.querySelector('.user-dropdown')) return false;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'open-contabilidad-confeccion';
    b.textContent = 'Contabilidad confección';
    ancla.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); activarPanel(crearPanel()); });
    return true;
  }
  let intentos = 0;
  const espera = setInterval(() => { if (agregarBoton() || ++intentos > 120) clearInterval(espera); }, 500);
})();
