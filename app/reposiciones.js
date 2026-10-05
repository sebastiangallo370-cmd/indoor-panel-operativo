/* REPROCESO › Reposiciones y garantías: tarjetas dinámicas desde la pestaña REPOSICIONES-GARANTIAS del Sheet. */
(() => {
  const PAGE = 36;
  const TIPOS = {garantia: ['Garantía', '#f5a623'], cliente: ['Reposición cliente', '#6fb7ff'], interna: ['Falla interna', '#ef7370']};
  const ESTADOS = {en_proceso: 'En proceso', sin_iniciar: 'Sin iniciar', terminada: 'Terminada', historico: 'Histórico'};
  const st = {data: null, view: 'reproceso', estado: 'activas', tipo: '', q: '', dias: 120, shown: PAGE, open: new Set(), loading: false};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const fmtDate = iso => { if (!iso) return 'Sin fecha'; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y.slice(2); };
  let mod, view, tabs;

  const css = document.createElement('style');
  css.textContent = `
  .rp-tabs{display:flex;gap:8px;flex-wrap:wrap}.rp-tabs button{width:auto!important;padding:10px 16px!important;border:1px solid #3d4f3d!important;border-radius:999px!important;background:#141a13!important;color:#cdd8c6!important;font:800 12px Arial!important;letter-spacing:.04em;cursor:pointer;min-height:40px}.rp-tabs button.on{background:#d0f44c!important;color:#17210c!important;border-color:#d0f44c!important}
  .rework-module.rp-on>:not(.rp-tabs):not(.rp-view){display:none!important}.rework-module:not(.rp-on)>.rp-view{display:none!important}
  .rp-view{display:grid;gap:16px}.rp-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.rp-bar input,.rp-bar select{min-height:42px;padding:9px 12px;border:1px solid #3d4f3d;border-radius:10px;background:#0f140e;color:#eef5e8;font:14px Arial}.rp-bar input{flex:1 1 240px}.rp-bar .rp-btn{width:auto;padding:9px 14px;border:1px solid #60754d;border-radius:10px;background:#233020;color:#eff9df;font:800 12px Arial;cursor:pointer;min-height:42px}.rp-stamp{color:#9fae98;font-size:12px;margin-left:auto}
  .rp-chips{display:flex;gap:8px;flex-wrap:wrap}.rp-chips button{width:auto;padding:8px 13px;border:1px solid #3d4f3d;border-radius:999px;background:transparent;color:#cdd8c6;font:800 12px Arial;cursor:pointer;min-height:38px}.rp-chips button.on{background:#233020;border-color:#d0f44c;color:#d0f44c}.rp-chips b{margin-left:6px;opacity:.8}
  .rp-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.rp-kpi{padding:14px 16px;border:1px solid #3d4f3d;border-radius:14px;background:linear-gradient(145deg,#182118,#101510)}.rp-kpi small{display:block;color:#aebba7;font:800 10px Arial;letter-spacing:.07em}.rp-kpi strong{display:block;margin-top:4px;color:#d0f44c;font:800 26px Arial}
  .rp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}
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

  function card(c) {
    const [tipoLabel, color] = TIPOS[c.tipo] || TIPOS.interna;
    const open = st.open.has(c.id);
    const steps = Object.values(c.steps).map(s => {
      const cls = s.done >= s.total ? 'done' : s.done ? 'part' : '';
      const info = s.fecha ? fmtDate(s.fecha).slice(0, 5) : s.done >= s.total ? '✓' : s.done ? s.done + '/' + s.total : '';
      return '<div class="rp-step ' + cls + '" style="--p:' + Math.round(100 * s.done / s.total) + '%" title="' + esc(s.label + (s.resp ? ' · ' + s.resp : '')) + '"><i></i><span>' + esc(s.label) + '</span><em>' + esc(info) + '</em></div>';
    }).join('');
    const pieces = open ? '<div class="rp-pieces">' + c.piezas.map(p => '<div class="rp-piece' + (p.hecha ? ' ok' : '') + '"><span>' + esc(p.cant + '× ' + p.ref + (p.talla ? ' · T' + p.talla : '') + (p.numero ? ' · #' + p.numero : '') + (p.dorsal ? ' ' + p.dorsal : '')) + '<br><small>' + esc([p.pieza, p.tela, p.maquina].filter(Boolean).join(' · ')) + '</small></span><span>' + esc(p.motivo) + (p.hecha ? ' ✓' : '') + '</span></div>').join('') + '</div>' : '';
    const stateColor = c.estado === 'terminada' ? '#66c58a' : c.estado === 'historico' ? '#8b9a85' : '#d0f44c';
    return '<article class="rp-card" data-id="' + c.id + '" style="--rp:' + color + '"><header><div><h3>' + esc(c.cliente || 'Sin cliente') + '</h3><small class="rp-proj">' + esc([c.proyecto, c.cot].filter(Boolean).join(' · ')) + '</small></div><span class="rp-date">' + fmtDate(c.fecha) + '</span></header>' +
      '<div class="rp-badges"><span class="rp-badge" style="--c:' + color + '">' + tipoLabel.toUpperCase() + '</span><span class="rp-badge" style="--c:' + stateColor + '">' + ESTADOS[c.estado].toUpperCase() + '</span>' + (c.prioridad ? '<span class="rp-badge" style="--c:#ff6b6b">PRIORIDAD</span>' : '') + '</div>' +
      '<p class="rp-reason">' + esc(c.motivo || 'Sin motivo registrado') + '</p><div class="rp-steps">' + steps + '</div>' +
      '<div class="rp-meta"><span>' + c.unidades + ' unidad' + (c.unidades === 1 ? '' : 'es') + '</span><span>' + c.piezas.length + ' pieza' + (c.piezas.length === 1 ? '' : 's') + (open ? ' ▲' : ' ▼') + '</span>' + (c.comercial ? '<span>Comercial: ' + esc(c.comercial) + '</span>' : '') + '</div>' +
      (c.notas.length ? '<div class="rp-notes">' + esc(c.notas.join(' · ')) + '</div>' : '') + pieces + '</article>';
  }

  function render() {
    if (!view) return;
    const d = st.data, all = d ? d.casos : [];
    const count = f => all.filter(c => f(c)).length;
    const list = all.filter(matches);
    const chip = (key, label, n) => '<button type="button" data-estado="' + key + '" class="' + (st.estado === key ? 'on' : '') + '">' + label + '<b>' + n + '</b></button>';
    view.querySelector('.rp-kpis').innerHTML = [['En proceso', count(c => c.estado === 'en_proceso' || c.estado === 'sin_iniciar')], ['Terminadas', count(c => c.estado === 'terminada')], ['Garantías', count(c => c.tipo === 'garantia')], ['Unidades', all.reduce((s, c) => s + c.unidades, 0)]]
      .map(([l, n]) => '<div class="rp-kpi"><small>' + l.toUpperCase() + '</small><strong>' + n.toLocaleString('es-CO') + '</strong></div>').join('');
    view.querySelector('.rp-chips').innerHTML = chip('activas', 'En proceso', count(c => c.estado === 'en_proceso' || c.estado === 'sin_iniciar')) + chip('terminada', 'Terminadas', count(c => c.estado === 'terminada')) + chip('historico', 'Histórico', count(c => c.estado === 'historico')) + chip('todas', 'Todas', all.length);
    view.querySelector('.rp-stamp').textContent = !d ? 'Cargando…' : (d.error ? '⚠ ' + d.error + ' · ' : '') + 'Hoja actualizada ' + (d.updated_at ? new Date(d.updated_at).toLocaleTimeString('es-CO', {timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit'}) : '—') + (st.dias ? ' · últimos ' + st.dias + ' días' : ' · todo el historial');
    const grid = view.querySelector('.rp-grid');
    grid.innerHTML = list.length ? list.slice(0, st.shown).map(card).join('') : '<div class="rp-empty">' + (d ? 'No hay casos con estos filtros.' : 'Cargando reposiciones…') + '</div>';
    const more = view.querySelector('.rp-more');
    more.hidden = list.length <= st.shown;
    more.textContent = 'Ver más (' + (list.length - st.shown) + ')';
  }

  async function load(force) {
    if (st.loading) return;
    st.loading = true;
    try {
      const r = await fetch('/api/reposiciones?dias=' + st.dias + (force ? '&refresh=true' : ''), {cache: 'no-store', credentials: 'same-origin'});
      if (!r.ok) throw new Error('No se pudo cargar');
      st.data = await r.json();
    } catch (e) { st.data = st.data ? {...st.data, error: e.message} : {casos: [], error: e.message, updated_at: ''}; }
    st.loading = false; render();
  }

  function build() {
    mod = document.querySelector('.rework-module');
    if (!mod || mod.querySelector('.rp-tabs')) return !!mod;
    tabs = document.createElement('div'); tabs.className = 'rp-tabs';
    tabs.innerHTML = '<button type="button" data-v="reproceso" class="on">REPROCESOS</button><button type="button" data-v="reposiciones">REPOSICIONES Y GARANTÍAS</button>';
    view = document.createElement('section'); view.className = 'rp-view';
    view.innerHTML = '<div class="rp-kpis"></div><div class="rp-bar"><input type="search" class="rp-q" placeholder="Buscar cliente, cotización, referencia o motivo" aria-label="Buscar"><select class="rp-tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option value="garantia">Garantía</option><option value="cliente">Reposición cliente</option><option value="interna">Falla interna</option></select><select class="rp-dias" aria-label="Periodo"><option value="30">Últimos 30 días</option><option value="120" selected>Últimos 120 días</option><option value="365">Último año</option><option value="0">Todo el historial</option></select><button type="button" class="rp-btn rp-refresh">↻ Actualizar</button><span class="rp-stamp">Cargando…</span></div><div class="rp-chips"></div><div class="rp-grid"></div><button type="button" class="rp-more" hidden></button>';
    mod.insertBefore(tabs, mod.firstChild); mod.appendChild(view);
    tabs.onclick = e => { const b = e.target.closest('button[data-v]'); if (!b) return; st.view = b.dataset.v; mod.classList.toggle('rp-on', st.view === 'reposiciones'); tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (st.view === 'reposiciones') { render(); load(false); } };
    view.addEventListener('click', e => {
      const chipBtn = e.target.closest('[data-estado]'); if (chipBtn) { st.estado = chipBtn.dataset.estado; st.shown = PAGE; render(); return; }
      if (e.target.closest('.rp-refresh')) { load(true); return; }
      if (e.target.closest('.rp-more')) { st.shown += PAGE; render(); return; }
      const c = e.target.closest('.rp-card'); if (c) { const id = Number(c.dataset.id); st.open.has(id) ? st.open.delete(id) : st.open.add(id); render(); }
    });
    view.querySelector('.rp-q').oninput = e => { st.q = e.target.value; st.shown = PAGE; render(); };
    view.querySelector('.rp-tipo').onchange = e => { st.tipo = e.target.value; st.shown = PAGE; render(); };
    view.querySelector('.rp-dias').onchange = e => { st.dias = Number(e.target.value); st.shown = PAGE; load(false); };
    return true;
  }

  // Actualización automática mientras la pestaña está a la vista.
  setInterval(() => { if (st.view === 'reposiciones' && !document.hidden && mod && mod.offsetParent) load(false); }, 60000);
  let tries = 0;
  const wait = setInterval(() => { if (build() || ++tries > 40) clearInterval(wait); }, 250);
})();
