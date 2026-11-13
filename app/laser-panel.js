(() => {
  // CORTE LÁSER: misma estructura y clases que la pantalla de EDICIÓN (agentes.js): barra de estado, barra de la orden
  // con su desplegable, pasos, pestañas y dos columnas. La cortadora avisa con su token, igual que los agentes de Illustrator.
  if (window.__laserPanel) return;
  window.__laserPanel = true;

  let panel = null, tab = null, timer = null, pedido = '', vista = 'chats';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ETIQUETA = { marcada: 'Marcada', duplicada: 'Ya estaba', error: 'Error', pendiente_excel: 'Pendiente' };
  const VISTAS = [['chats', 'DETECCIONES'], ['listado', 'LISTADO'], ['agentes', 'MARCADAS'], ['pdfs', 'PENDIENTES']];

  const css = document.createElement('style');
  css.textContent = `
    .laser-panel{width:100%!important;max-width:none!important}
    body:has(.panel[data-panel='laser'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,2vw,24px)!important;padding-right:clamp(10px,2vw,24px)!important}
    .laser-panel .ag{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;width:100%;min-width:0}
    .laser-panel .ag-estado{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid #34432f;border-radius:12px;background:#0c110d}
    .laser-panel .ag-estado h2{margin:0 10px 0 0;font:900 16px Arial;letter-spacing:.04em;color:#d0f44c}
    .laser-panel .ag-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;border:1px solid #3d4f3d;background:#142017;font:800 11px Arial;color:#dfe7d6}
    .laser-panel .ag-chip i{width:8px;height:8px;border-radius:50%;background:#6b7a66}
    .laser-panel .ag-chip.on i{background:#d0f44c;box-shadow:0 0 8px rgba(208,244,76,.6)}
    .laser-panel .ag-orden{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid #34432f;border-radius:12px;background:#0c110d}
    .laser-panel .ag-orden form{display:flex;gap:8px;align-items:center;flex:1 1 260px;margin:0;flex-wrap:wrap}
    .laser-panel .ag-orden label{font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase;color:#aebba7;white-space:nowrap}
    .laser-panel .ag-orden input{flex:1;min-width:110px;min-height:38px;box-sizing:border-box;padding:7px 12px;border:1px solid #60754d;border-radius:10px;background:#142017;color:#f5faef;font:800 14px Arial;letter-spacing:.04em;text-transform:uppercase}
    .laser-panel .ag-btn{min-height:36px;padding:0 14px;border-radius:10px;border:1px solid #60754d;background:#d0f44c;color:#10150e;font:900 12px Arial;cursor:pointer}
    .laser-panel .ag-pasos{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
    .laser-panel .ag-paso{display:grid;gap:3px;padding:8px 10px;border-radius:12px;border:1px solid #34432f;background:#0c110d;text-align:left}
    .laser-panel .ag-paso small{font:800 9px Arial;letter-spacing:.08em;color:#8f9b8a;text-transform:uppercase}
    .laser-panel .ag-paso b{font:900 16px Arial;color:#f5faef}
    .laser-panel .ag-paso.hecho{border-color:#4f7a2a}
    .laser-panel .ag-paso.hecho b{color:#d0f44c}
    .laser-panel .ag-tabs{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto}
    .laser-panel .ag-tab{height:34px;padding:0 14px;border-radius:999px;border:1px solid #3d4f3d;background:#10150e;color:#b9c7b0;font:800 11px Arial;cursor:pointer;white-space:nowrap}
    .laser-panel .ag-tab.on{background:#d0f44c;color:#10150e;border-color:#d0f44c}
    .laser-panel .ag-buscar{height:34px;min-width:200px;padding:0 10px;border-radius:10px;border:1px solid #60754d;background:#142017;color:#f5faef;font:700 12px Arial}
    .laser-panel .ag-cols{display:grid;grid-template-columns:minmax(260px,.85fr) minmax(0,1.4fr);gap:12px;align-items:start}
    .laser-panel .ag-col{border:1px solid #34432f;border-radius:14px;background:#0c110d;overflow:hidden;min-width:0}
    .laser-panel .ag-col header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #34432f;font:900 10px Arial;letter-spacing:.1em;color:#d0f44c;text-transform:uppercase}
    .laser-panel .ag-hilo{display:grid;gap:8px;padding:10px;max-height:62vh;overflow:auto}
    .laser-panel .ag-msg{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:9px 11px;border-radius:12px;border:1px solid #34432f;background:#142017}
    .laser-panel .ag-msg .n{font:900 20px Arial;color:#f5faef;min-width:48px;text-align:center}
    .laser-panel .ag-msg small{display:block;font:700 10px Arial;color:#8f9b8a;margin-top:2px}
    .laser-panel .ag-tag{padding:3px 9px;border-radius:999px;font:800 10px Arial;background:#1c261c;color:#d0f44c;white-space:nowrap}
    .laser-panel .ag-tbl{width:100%;border-collapse:collapse;font:700 12px Arial;color:#f5faef}
    .laser-panel .ag-tbl th{padding:9px 10px;text-align:left;font:900 9px Arial;letter-spacing:.08em;color:#aebba7;background:#142017;text-transform:uppercase}
    .laser-panel .ag-tbl td{padding:9px 10px;border-top:1px solid #1f2a1e}
    .laser-panel .ag-vacio{padding:22px;text-align:center;color:#8f9b8a;font:700 13px Arial}
    @media (max-width:900px){.laser-panel .ag-cols{grid-template-columns:minmax(0,1fr)}.laser-panel .ag-pasos{grid-template-columns:repeat(3,minmax(0,1fr))}.laser-panel .ag-buscar{min-width:0;width:100%}.laser-panel .ag-tbl{display:block;overflow-x:auto}}
  `;
  document.head.appendChild(css);

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="laser"]')) return true;
    panel = document.createElement('section');
    panel.className = 'panel laser-panel';
    panel.dataset.panel = 'laser';
    panel.innerHTML = '<div class="ag"></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div');
    grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="laser" type="button"><span class="nav-icon">LS</span><strong>CORTE LÁSER</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', activar);
    panel.addEventListener('click', async e => {
      const b = e.target.closest('[data-laser-vista]');
      if (b) { vista = b.dataset.laserVista; cargar(); return; }
      if (e.target.closest('[data-laser-iniciar]')) {
        const pedidoOrden = panel.querySelector('[data-laser-pedido-orden]').value.trim();
        const hojaOrden = panel.querySelector('[data-laser-hoja]').value.trim();
        if (!pedidoOrden || !hojaOrden) { window.alert('Escriba el pedido y la hoja que va a cortar.'); return; }
        const r = await fetch('/api/marcaman/orden', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido: pedidoOrden, hoja: hojaOrden }) });
        if (!r.ok) { const t = await r.json().catch(() => ({})); window.alert(t.detail || 'No se pudo iniciar la orden.'); return; }
        cargar();
      }
    });
    panel.addEventListener('input', e => {
      if (e.target.matches('[data-laser-buscar]')) { pedido = e.target.value.trim(); cargar(); }
    });
    return true;
  }

  function activar() {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
    cargar();
    clearInterval(timer);
    timer = setInterval(cargar, 5000);
  }

  const hora = iso => iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';

  async function cargar() {
    if (!panel || !panel.classList.contains('active')) return;
    const cont = panel.querySelector('.ag');
    const ruta = '/api/marcaman/estado' + (pedido ? '?pedido=' + encodeURIComponent(pedido) : '');
    const r = await fetch(ruta, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) { cont.innerHTML = '<p class="ag-vacio">No se pudo leer el estado de MARCAMAN. Revisa la conexión con el VPS.</p>'; return; }
    const d = await r.json();
    const c = d.conteos || {};
    const todas = d.ultimas || [];
    const filtro = { chats: null, listado: null, agentes: 'marcada', pdfs: 'pendiente_excel' }[vista];
    const lista = filtro ? todas.filter(x => x.estado === filtro) : todas;
    const conectado = Boolean(d.conectado);
    const orden = d.orden || {};
    const pasos = [['Detectadas', d.total || 0], ['Marcadas', c.marcada || 0], ['Ya estaban', c.duplicada || 0], ['Pendientes', c.pendiente_excel || 0], ['Errores', c.error || 0]];
    const mensajes = lista.map(x => `<div class="ag-msg"><span class="n">${esc(x.numero)}</span><div><b>${esc(x.pedido)}</b><small>${esc(x.nombre || (x.foto || '').split(/[\\\\/]/).pop())}</small></div><div><span class="ag-tag">${esc(ETIQUETA[x.estado] || x.estado)}</span><small>${esc(hora(x.recibido))}</small></div></div>`).join('');
    const filas = lista.map(x => `<tr><td>${esc(hora(x.recibido))}</td><td><b>${esc(x.numero)}</b></td><td>${esc(x.pedido)}</td><td>${esc(x.nombre || '')}</td><td>${esc(ETIQUETA[x.estado] || x.estado)}</td><td>${esc(x.detalle || '')}</td></tr>`).join('');
    cont.innerHTML = `
      <div class="ag-estado">
        <h2>CORTE LÁSER</h2>
        <span class="ag-chip ${conectado ? 'on' : ''}"><i></i>MARCAMAN · ${conectado ? 'PC conectado' : 'PC sin conexión'}</span>
        ${d.visto ? `<span class="ag-chip">Último aviso ${esc(hora(d.visto))}</span>` : ''}
      </div>
      <div class="ag-orden">
        <form onsubmit="return false">
          <label>ORDEN · CORTE LÁSER</label>
          <input list="ls-pedidos" data-laser-pedido-orden placeholder="Pedido (ej. CO6324)" value="${esc(orden.pedido || '')}" aria-label="Pedido a cortar">
          <datalist id="ls-pedidos">${[...new Set(todas.map(x => x.pedido))].map(p => `<option value="${esc(p)}">`).join('')}</datalist>
          <input data-laser-hoja placeholder="Hoja (ej. A100FUT01)" value="${esc(orden.hoja || '')}" aria-label="Hoja a cortar">
          <button type="button" class="ag-btn" data-laser-iniciar>▶ Iniciar</button>
        </form>
        <small>${orden.pedido ? 'Cortando ' + esc(orden.pedido) + ' · hoja ' + esc(orden.hoja) : 'Elija el pedido y la hoja que va a cortar, y pulse Iniciar.'}</small>
      </div>
      <div class="ag-pasos">${pasos.map(([t, v]) => `<div class="ag-paso ${v ? 'hecho' : ''}"><small>${t}</small><b>${v}</b></div>`).join('')}</div>
      <div class="ag-tabs">${VISTAS.map(([k, t]) => `<button type="button" class="ag-tab ${vista === k ? 'on' : ''}" data-laser-vista="${k}">${t}</button>`).join('')}
        <input class="ag-buscar" type="search" data-laser-buscar placeholder="Buscar pedido" value="${esc(pedido)}" aria-label="Buscar pedido"></div>
      <div class="ag-cols">
        <section class="ag-col"><header><span>DETECCIONES</span><span>${lista.length}</span></header>
          <div class="ag-hilo">${mensajes || '<p class="ag-vacio">Todavía no hay dorsales detectados.</p>'}</div></section>
        <section class="ag-col"><header><span>LISTADO DE LA CORTADORA</span><span>${lista.length} registros</span></header>
          ${lista.length ? `<table class="ag-tbl"><thead><tr><th>Hora</th><th>Dorsal</th><th>Pedido</th><th>Nombre / foto</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table>` : '<p class="ag-vacio">Sin registros para esta vista.</p>'}</section>
      </div>`;
  }

  const espera = setInterval(() => { if (construir()) clearInterval(espera); }, 400);
  setTimeout(() => clearInterval(espera), 20000);
})();
