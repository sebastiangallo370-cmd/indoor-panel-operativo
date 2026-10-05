/* REPROCESOS › GARANTÍAS: tarjetas dinámicas desde la pestaña REPOSICIONES-GARANTIAS del Sheet. */
(() => {
  const PAGE = 36;
  const TIPOS = {garantia: ['Garantía', '#f5a623'], cliente: ['Reposición cliente', '#6fb7ff'], interna: ['Falla interna', '#ef7370']};
  const TIPO_CORTO = {garantia: 'GARANTÍA', cliente: 'REPOSICIÓN', interna: 'FALLA'};
  const ESTADOS = {en_proceso: 'Sin terminar', sin_iniciar: 'Sin iniciar', terminada: 'Terminada'};
  const st = {data: null, estado: 'todas', tipo: '', q: '', shown: PAGE, open: new Set(), loading: false};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  let panel, view;

  const css = document.createElement('style');
  css.textContent = `
  body:has(.panel[data-panel='garantias'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(18px,4vw,76px)!important;padding-right:clamp(18px,4vw,76px)!important}.panel[data-panel='garantias'],.panel[data-panel='garantias'].active{width:100%!important;max-width:none!important}
  html body .rp-grid .trace-card.rp-nodesign{grid-template-rows:78px auto auto!important}html body .rp-grid .trace-card.rp-nodesign .trace-media{min-height:0!important;height:78px!important;aspect-ratio:auto!important;padding:0!important}html body .rp-grid .trace-card.rp-nodesign .trace-no-design{gap:2px}html body .rp-grid .trace-card.rp-nodesign .trace-no-design span{display:none}
  html body.production-mode .rp-grid.trace-cards{align-items:start!important}
  html body .rp-grid .trace-card{align-self:start!important}.rp-grid .trace-card .rp-piece{flex-direction:column;gap:2px}.rp-grid .trace-card .rp-piece span:last-child{text-align:left}.rp-grid .trace-card .rp-pieces{margin:8px 0}
  .rp-head span{color:#d0f44c;font:800 10px Arial;letter-spacing:.1em}.rp-head h2{margin:4px 0 2px;font-size:1.5rem}.rp-head p{margin:0;color:#aebba7;font-size:.9rem}
  .rp-view{display:grid;gap:16px}.rp-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.rp-bar input,.rp-bar select{min-height:42px;padding:9px 12px;border:1px solid #3d4f3d;border-radius:10px;background:#0f140e;color:#eef5e8;font:14px Arial}.rp-bar input{flex:1 1 240px}.rp-bar .rp-btn{width:auto;padding:9px 14px;border:1px solid #60754d;border-radius:10px;background:#233020;color:#eff9df;font:800 12px Arial;cursor:pointer;min-height:42px}.rp-stamp{color:#9fae98;font-size:12px;margin-left:auto}
  .rp-chips{display:flex;gap:8px;flex-wrap:wrap}.rp-chips button{width:auto;padding:8px 13px;border:1px solid #3d4f3d;border-radius:999px;background:transparent;color:#cdd8c6;font:800 12px Arial;cursor:pointer;min-height:38px}.rp-chips button.on{background:#233020;border-color:#d0f44c;color:#d0f44c}.rp-chips b{margin-left:6px;opacity:.8}
  .rp-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.rp-kpi{padding:14px 16px;border:1px solid #3d4f3d;border-radius:14px;background:linear-gradient(145deg,#182118,#101510)}.rp-kpi small{display:block;color:#aebba7;font:800 10px Arial;letter-spacing:.07em}.rp-kpi strong{display:block;margin-top:4px;color:#d0f44c;font:800 26px Arial}

  .rp-card{display:grid;gap:11px;padding:16px;border:1px solid #34432f;border-top:3px solid var(--rp,#d0f44c);border-radius:15px;background:linear-gradient(150deg,#1a221a,#10140f);cursor:pointer;transition:transform .15s,border-color .15s;min-width:0}.rp-card:hover{transform:translateY(-2px);border-color:var(--rp,#d0f44c)}
  .rp-card header{display:flex;justify-content:space-between;gap:10px}.rp-card h3{margin:0;font-size:1rem;line-height:1.25;overflow-wrap:anywhere}.rp-card small{color:#aebba7}.rp-card .rp-proj{display:block;margin-top:3px;font-size:.78rem}
  .rp-date{white-space:nowrap;font:700 12px Arial;color:#cdd8c6}.rp-badges{display:flex;gap:6px;flex-wrap:wrap}.rp-badge{padding:3px 9px;border-radius:999px;font:800 10px Arial;letter-spacing:.05em;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
  .rp-reason{margin:0;color:#e3ebe0;font-size:.9rem;line-height:1.4;overflow-wrap:anywhere}.rp-meta{display:flex;gap:12px;flex-wrap:wrap;color:#aebba7;font-size:.76rem}
  .rp-steps{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}.rp-step{display:grid;gap:4px;justify-items:center;text-align:center;font:700 9px Arial;color:#8b9a85}.rp-step i{width:100%;height:6px;border-radius:3px;background:#2a3427}.rp-step.done i{background:#66c58a}.rp-step.part i{background:linear-gradient(90deg,#66c58a var(--p),#2a3427 var(--p))}.rp-step.done{color:#c5e8d1}.rp-step em{font-style:normal;font-weight:400;color:#8b9a85;min-height:11px}
  .rp-pieces{display:grid;gap:6px;padding-top:10px;border-top:1px dashed #34432f}.rp-piece{display:flex;justify-content:space-between;gap:10px;font-size:.78rem;color:#dce5d7;line-height:1.35}.rp-piece span:last-child{color:#9fae98;text-align:right;overflow-wrap:anywhere}.rp-piece.ok{opacity:.65}.rp-notes{color:#d0f44c;font-size:.76rem}
  .rp-empty{padding:44px;text-align:center;border:1px dashed #4a5a40;border-radius:14px;color:#b7c0b3}.rp-more{width:auto;justify-self:center;padding:11px 22px;border:1px solid #60754d;border-radius:10px;background:#233020;color:#eff9df;font:800 13px Arial;cursor:pointer}
  .theme-light .rp-card,.theme-light .rp-kpi{background:#fff;border-color:#cfd8c6}.theme-light .rp-card h3,.theme-light .rp-reason,.theme-light .rp-piece{color:#1b2517}.theme-light .rp-bar input,.theme-light .rp-bar select{background:#fff;color:#1b2517;border-color:#cfd8c6}.theme-light .rp-kpi strong{color:#3f6a10}
  @media(max-width:700px){.rp-kpis{grid-template-columns:1fr 1fr}.rp-grid{grid-template-columns:1fr}.rp-stamp{margin-left:0;width:100%}.rp-step{font-size:8px}.rp-bar select,.rp-bar .rp-btn{flex:1 1 140px}}`;
  document.head.appendChild(css);

  const matches = c => {
    if (st.estado === 'activas' ? !(c.estado === 'en_proceso' || c.estado === 'sin_iniciar') : st.estado !== 'todas' && c.estado !== st.estado) return false;
    if (st.tipo && c.tipo !== st.tipo) return false;
    if (!st.q) return true;
    const hay = plain([c.cliente, c.proyecto, c.cot, c.motivo, c.comercial, ...c.piezas.map(p => p.ref + ' ' + p.pieza + ' ' + p.motivo)].join(' '));
    return plain(st.q).split(/\s+/).every(w => hay.includes(w));
  };

  // ---- Tarjeta con el mismo marcado y las mismas clases que las de Producción (trace-ui.js) ----
  const ABBR = {edicion: 'EDI', impresion: 'IMP', sublimacion: 'SUB', laser: 'LAS', confeccion: 'CON', terminacion: 'TER'};
  const STATE = {terminada: ['finished', 'Terminado'], en_proceso: ['active', 'Sin terminar'], sin_iniciar: ['pending', 'Pendiente']};
  const prodRow = c => {
    try {
      if (typeof productionData === 'undefined' || !productionData || !c.cot) return null;
      const want = String(c.cot).trim().toUpperCase();
      return productionData.rows.find(r => String(traceField(r, 'ORDEN') || '').trim().toUpperCase() === want) || null;
    } catch (e) { return null; }
  };
  const mediaFor = c => {
    const row = prodRow(c);
    if (row && typeof traceAssetsMarkup === 'function') return traceAssetsMarkup(row.source_row);
    return '<div class="trace-no-design"><span aria-hidden="true">◇</span><strong>Sin diseño adjunto</strong><small>' + (row ? 'Buscando diseño…' : 'La orden no está en Producción') + '</small></div>';
  };

  function routeFor(c) {
    const list = Object.entries(c.steps), finished = list.filter(([, s]) => s.done >= s.total).length;
    const next = list.find(([, s]) => s.done < s.total);
    const nodes = list.map(([key, s], i) => {
      const state = s.done >= s.total ? 'finished' : s.done ? 'active' : 'pending';
      const label = s.label + ': ' + (state === 'finished' ? 'terminado' : state === 'active' ? s.done + ' de ' + s.total + ' piezas' : 'pendiente') + (s.fecha ? ' · ' + s.fecha : '') + (s.resp ? ' · ' + s.resp : '');
      return '<button type="button" class="trace-node ' + state + '" data-g-node="' + esc(label) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"><span class="trace-node-dot" aria-hidden="true">' + (state === 'finished' ? '✓' : state === 'active' ? '●' : i + 1) + '</span><span class="trace-node-label">' + ABBR[key] + '</span></button>';
    }).join('');
    return '<section class="trace-route"><div class="trace-route-heading"><h4>Ruta de producción</h4><span>' + finished + '/' + list.length + ' procesos</span></div><div class="trace-nodes" style="--nodes:' + list.length + '">' + nodes + '</div><p class="trace-route-caption">' + (next ? 'Siguiente: ' + esc(next[1].label) : 'Ruta completada') + '<span>Pulsa un punto para ver detalles</span></p></section>';
  }

  const ICON_REWORK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3"></path><path d="M4 12a8 8 0 0 1 14-5.3"></path><path d="M18.5 3v4h-4M5.5 21v-4h4"></path></svg>';
  const ICON_PROD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V10l6 4V10l6 4V6l6 3v12z"></path><path d="M7 17h2M12 17h2M17 17h1"></path></svg>';
  const railButton = (cls, attr, tip, icon) => '<button type="button" class="' + cls + '" ' + attr + ' aria-label="' + tip + '" data-ti="1" data-tip="' + tip + '" title="' + tip + '" data-ti-done="1">' + icon + '<span class="ti-label">' + tip + '</span></button>';
  const initials = name => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();

  function card(c) {
    const [stateClass, stateLabel] = STATE[c.estado] || STATE.sin_iniciar;
    const open = st.open.has(c.id);
    const refs = [...new Set(c.piezas.map(p => p.ref).filter(Boolean))];
    const people = c.comercial ? c.comercial.split(/[,;·\n]+/).filter(x => x.trim()).map(n => '<span class="trace-person">' + esc(n.trim()) + '</span>').join(' ') : '<span class="trace-unassigned">Sin asignar</span>';
    const tipo = TIPO_CORTO[c.tipo] || TIPO_CORTO.interna, tipoLargo = (TIPOS[c.tipo] || TIPOS.interna)[0];
    const badge = c.comercial ? initials(c.comercial.split(/[,;]+/)[0]) : 'GA';
    const note = (b, text, title) => '<p title="' + esc(title) + '"><span class="trace-note-authors"><strong class="trace-note-author-badge">' + esc(b) + '</strong></span><span class="trace-note-text">' + esc(text) + '</span></p>';
    const notes = [c.motivo ? note(badge, c.motivo, 'Motivo registrado en la hoja' + (c.comercial ? ' · Comercial: ' + c.comercial : '')) : '']
      .concat(c.notas.map(n => note('NOTA', n, 'Nota de la hoja'))).join('');
    const pieces = c.piezas.map(p => '<div class="rp-piece' + (p.hecha ? ' ok' : '') + '"><span>' + esc(p.cant + '× ' + p.ref + (p.talla ? ' · T' + p.talla : '') + (p.numero ? ' · #' + p.numero : '') + (p.dorsal ? ' ' + p.dorsal : '')) + '<br><small>' + esc([p.pieza, p.tela, p.maquina].filter(Boolean).join(' · ')) + '</small></span><span>' + esc(p.motivo) + (p.hecha ? ' ✓' : '') + '</span></div>').join('');
    return '<article class="trace-card state-' + stateClass + (notes ? ' has-notes' : '') + (prodRow(c) ? '' : ' rp-nodesign') + '" data-card-row="' + c.id + '" data-g="' + c.id + '">' +
      '<button type="button" class="trace-disclosure-toggle" data-g-detail aria-expanded="' + open + '" aria-label="Detalles del caso ' + esc(c.cot) + '">☰</button>' +
      '<div class="trace-media">' + mediaFor(c) + '</div><div class="trace-card-body">' +
      '<div class="trace-card-heading"><h3>' + esc(c.cot || 'Sin número') + '</h3><span class="trace-order-actions"></span><span class="trace-stage ' + stateClass + '">' + stateLabel.toUpperCase() + '</span><span class="trace-line" title="Tipo de caso: ' + esc(tipoLargo) + '">' + esc(tipo) + '</span></div>' +
      '<p class="trace-client">' + esc(c.cliente || 'Sin cliente') + '</p><p class="trace-project">' + esc(c.proyecto) + '</p>' +
      '<dl class="trace-primary-facts"><div><dt>Referencia</dt><dd>' + esc(refs.join(', ') || '—') + '</dd></div><div><dt>Cantidad</dt><dd class="trace-quantity">' + c.unidades + ' <small>und.</small></dd></div></dl>' +
      (notes ? '<section class="trace-inline-notes trace-note-alert" aria-label="Observaciones del caso">' + notes + '</section>' : '') +
      '<div class="trace-card-actions"><button type="button" data-g-nas aria-label="Abrir carpeta del pedido">NAS ↗</button><button type="button" class="operator-open" data-g-prod>PRODUCCIÓN</button></div>' +
      '<div class="trace-disclosure"' + (open ? '' : ' hidden') + '><dl><div class="trace-due"><dt>Fecha</dt><dd>' + esc(c.fecha || '—') + '</dd></div><div><dt>Comercial</dt><dd>' + people + '</dd></div></dl><div class="rp-pieces">' + pieces + '</div><div class="trace-card-meta"><span class="trace-note-count">' + c.piezas.length + ' pieza' + (c.piezas.length === 1 ? '' : 's') + '</span><span>Fila ' + c.id + '</span></div></div>' +
      '<div class="trace-rail" role="toolbar" aria-label="Acciones del caso">' + railButton('trace-order-rework', 'data-g-rework', 'Registrar reproceso', ICON_REWORK) + '<span class="ti-sep"></span>' + railButton('trace-order-note', 'data-g-prod', 'Ver en Producción', ICON_PROD) + '</div>' +
      '</div>' + routeFor(c) + '</article>';
  }

  const byId = id => st.data && st.data.casos.find(c => c.id === Number(id));
  function loadDesigns() {
    if (typeof loadTraceAssets !== 'function' || !view) return;
    view.querySelectorAll('.trace-card[data-g]').forEach(el => {
      const c = byId(el.dataset.g), row = c && prodRow(c);
      if (!row || el.dataset.assets) return;
      el.dataset.assets = '1';
      loadTraceAssets(row.source_row).then(() => { const m = el.querySelector('.trace-media'); if (m && typeof traceAssetsMarkup === 'function') m.innerHTML = traceAssetsMarkup(row.source_row); });
    });
  }

  function onCardClick(e) {
    const el = e.target.closest('.trace-card[data-g]');
    if (!el) return false;
    const c = byId(el.dataset.g);
    if (!c) return true;
    const row = prodRow(c);
    if (e.target.closest('[data-g-node]')) { alert(e.target.closest('[data-g-node]').dataset.gNode); return true; }
    if (e.target.closest('[data-g-detail]')) { st.open.has(c.id) ? st.open.delete(c.id) : st.open.add(c.id); render(); return true; }
    if (e.target.closest('[data-g-rework]')) { document.querySelector('.tab[data-kind="reproceso"]')?.click(); return true; }
    if (e.target.closest('[data-g-prod]')) {
      if (!row) { alert('La orden ' + (c.cot || '') + ' no está en el módulo de Producción.'); return true; }
      document.querySelector('.tab[data-kind="produccion"]')?.click();
      if (typeof productionSearch !== 'undefined') { productionSearch.value = c.cot; productionSearch.dispatchEvent(new Event('input', {bubbles: true})); }
      return true;
    }
    if (e.target.closest('[data-g-nas]')) {
      if (!row) { alert('La orden ' + (c.cot || '') + ' no está en el módulo de Producción, por eso no se puede ubicar su carpeta.'); return true; }
      try {
        const bridge = document.createElement('tr'); bridge.hidden = true;
        const cell = document.createElement('td');
        cell.innerHTML = productionRowButton(row.source_row, c.cot, traceField(row, 'NOMBRE DEL CLIENTE'), traceField(row, 'NOMBRE PROYECTO'));
        bridge.appendChild(cell); productionBody.appendChild(bridge);
        try { cell.querySelector('.production-row-open').click(); } finally { bridge.remove(); }
      } catch (err) { alert('No se pudo abrir la carpeta del pedido.'); }
      return true;
    }
    const retry = e.target.closest('[data-card-retry]');
    if (retry && typeof loadTraceAssets === 'function') {
      loadTraceAssets(Number(retry.dataset.cardRetry), true).then(() => { const m = el.querySelector('.trace-media'); if (m) m.innerHTML = traceAssetsMarkup(Number(retry.dataset.cardRetry)); });
      return true;
    }
    const dn = e.target.closest('[data-design-index]');
    if (dn && typeof traceDesignSelection !== 'undefined') {
      e.preventDefault();
      traceDesignSelection.set(Number(dn.dataset.designRow), Number(dn.dataset.designIndex));
      const m = el.querySelector('.trace-media'); if (m) m.innerHTML = traceAssetsMarkup(Number(dn.dataset.designRow));
      return true;
    }
    return false;
  }

  function render() {
    if (!view) return;
    const d = st.data, all = d ? d.casos : [];
    const count = f => all.filter(c => f(c)).length;
    const list = all.filter(matches);
    const chip = (key, label, n) => '<button type="button" data-estado="' + key + '" class="' + (st.estado === key ? 'on' : '') + '">' + label + '<b>' + n + '</b></button>';
    view.querySelector('.rp-kpis').innerHTML = [['Sin terminar', count(c => c.estado === 'en_proceso' || c.estado === 'sin_iniciar')], ['Terminadas', count(c => c.estado === 'terminada')], ['Garantías', count(c => c.tipo === 'garantia')], ['Unidades', all.reduce((s, c) => s + c.unidades, 0)]]
      .map(([l, n]) => '<div class="rp-kpi"><small>' + l.toUpperCase() + '</small><strong>' + n.toLocaleString('es-CO') + '</strong></div>').join('');
    view.querySelector('.rp-chips').innerHTML = chip('todas', 'Todas', all.length) + chip('activas', 'Sin terminar', count(c => c.estado === 'en_proceso' || c.estado === 'sin_iniciar')) + chip('terminada', 'Terminadas', count(c => c.estado === 'terminada'));
    view.querySelector('.rp-stamp').textContent = !d ? 'Cargando…' : (d.error ? '⚠ ' + d.error + ' · ' : '') + 'Hoja actualizada ' + (d.updated_at ? new Date(d.updated_at).toLocaleTimeString('es-CO', {timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit'}) : '—');
    const grid = view.querySelector('.rp-grid');
    grid.innerHTML = list.length ? list.slice(0, st.shown).map(card).join('') : '<div class="rp-empty">' + (d ? 'No hay casos con estos filtros.' : 'Cargando reposiciones…') + '</div>';
    const more = view.querySelector('.rp-more');
    more.hidden = list.length <= st.shown;
    more.textContent = 'Ver más (' + (list.length - st.shown) + ')';
    loadDesigns();
  }

  async function load(force) {
    if (st.loading) return;
    st.loading = true;
    try {
      const r = await fetch('/api/reposiciones' + (force ? '?refresh=true' : ''), {cache: 'no-store', credentials: 'same-origin'});
      if (!r.ok) throw new Error('No se pudo cargar');
      st.data = await r.json();
    } catch (e) { st.data = st.data ? {...st.data, error: e.message} : {casos: [], error: e.message, updated_at: ''}; }
    st.loading = false; render();
  }

  function buildPanel() {
    const main = document.querySelector('main');
    if (!main) return false;
    if (document.querySelector('.panel[data-panel="garantias"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'garantias';
    view = document.createElement('div'); view.className = 'rp-view';
    view.innerHTML = '<div class="rp-head"><span>REPROCESOS · GARANTÍAS</span><h2>REPOSICIONES Y GARANTÍAS</h2><p>Piezas repuestas por garantía, reposición de cliente o falla interna, con su avance por proceso.</p></div><div class="rp-kpis"></div><div class="rp-bar"><input type="search" class="rp-q" placeholder="Buscar cliente, cotización, referencia o motivo" aria-label="Buscar"><select class="rp-tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option value="garantia">Garantía</option><option value="cliente">Reposición cliente</option><option value="interna">Falla interna</option></select><button type="button" class="rp-btn rp-refresh">↻ Actualizar</button><span class="rp-stamp">Cargando…</span></div><div class="rp-chips"></div><div class="rp-grid trace-cards"></div><button type="button" class="rp-more" hidden></button>';
    panel.appendChild(view); main.appendChild(panel);
    view.addEventListener('click', e => {
      const chipBtn = e.target.closest('[data-estado]'); if (chipBtn) { st.estado = chipBtn.dataset.estado; st.shown = PAGE; render(); return; }
      if (e.target.closest('.rp-refresh')) { load(true); return; }
      if (e.target.closest('.rp-more')) { st.shown += PAGE; render(); return; }
      onCardClick(e);
    });
    view.querySelector('.rp-q').oninput = e => { st.q = e.target.value; st.shown = PAGE; render(); };
    view.querySelector('.rp-tipo').onchange = e => { st.tipo = e.target.value; st.shown = PAGE; render(); };
    return true;
  }

  // Menú: el botón REPROCESO pasa a ser un grupo desplegable REPROCESOS › PRODUCCIÓN / GARANTÍAS.
  function buildNav() {
    const tab = document.querySelector('nav.tabs .tab[data-kind="reproceso"]');
    if (!tab) return false;
    if (document.getElementById('rework-toggle')) return true;
    const group = tab.closest('.nav-group');
    const parent = document.createElement('button');
    parent.id = 'rework-toggle'; parent.type = 'button'; parent.className = 'nav-parent';
    parent.innerHTML = '<span class="nav-icon">RE</span><span>Reprocesos</span>';
    const children = document.createElement('div'); children.className = 'nav-children';
    const label = tab.querySelector('strong'); if (label) label.textContent = 'PRODUCCIÓN';
    const icon = tab.querySelector('.nav-icon'); if (icon) icon.textContent = 'PR';
    const gar = document.createElement('button');
    gar.type = 'button'; gar.className = 'tab'; gar.dataset.kind = 'garantias';
    gar.innerHTML = '<span class="nav-icon">GA</span><strong>GARANTÍAS</strong>';
    group.insertBefore(parent, tab); group.insertBefore(children, tab.nextSibling);
    children.appendChild(tab); children.appendChild(gar);
    group.classList.add('collapsed');
    // El manejador original marca como activo "el primer botón del grupo", que ahora es el padre: lo marcamos nosotros.
    tab.addEventListener('click', () => { document.querySelectorAll('.tab.active').forEach(x => x.classList.remove('active')); tab.classList.add('active'); });
    parent.addEventListener('click', () => { group.classList.toggle('collapsed'); if (!group.classList.contains('collapsed') && window.innerWidth > 860) children.querySelector('.tab')?.click(); });
    gar.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === gar));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
      document.body.classList.add('production-mode');
      group.classList.remove('collapsed');
      render(); load(false);
    };
    return true;
  }

  // Actualización automática mientras la pantalla está a la vista.
  setInterval(() => { if (panel && panel.classList.contains('active') && !document.hidden) load(false); }, 60000);
  let tries = 0;
  const wait = setInterval(() => { if ((buildPanel() && buildNav()) || ++tries > 40) clearInterval(wait); }, 250);
})();
