/* Dashboard interactivo de BODEGA TELA dentro de PANEL DE CONTROL.
   Solo lectura: usa /api/inventarios y filtra la categoría BODEGA TELA.
   No escribe nada en el servidor ni en el Google Sheet. */
(() => {
  if (window.__panelTelasLoaded) return;
  window.__panelTelasLoaded = true;

  const CATEGORY = 'BODEGA TELA';
  const LOW_KEY = 'panelTelasUmbral';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = value => new Intl.NumberFormat('es-CO', {maximumFractionDigits: 1}).format(Number(value) || 0);
  const pct = (part, total) => total > 0 ? (part / total) * 100 : 0;
  const readLow = () => { try { const v = Number(localStorage.getItem(LOW_KEY)); return v > 0 ? v : 100; } catch (_) { return 100; } };
  const saveLow = v => { try { localStorage.setItem(LOW_KEY, String(v)); } catch (_) {} };

  const state = {telas: [], updatedAt: '', query: '', filter: 'todas', sort: 'mts-desc', low: readLow(), open: new Set(), loading: false, error: ''};

  const isStarted = status => status === 'started' || status === 'empezado' || status === 'calandra';

  const normalize = item => {
    const raw = String(item.nombre || '').trim();
    const match = raw.match(/^\s*\(([^)]+)\)\s*(.*)$/);
    const values = (item.roll_values || []).map(Number).filter(v => v > 0);
    const statuses = item.roll_statuses || [];
    const rolls = values.map((mts, i) => ({mts, started: isStarted(statuses[i])}));
    const rollSum = values.reduce((a, b) => a + b, 0);
    const total = Number(item.total ?? item.mts ?? rollSum) || 0;
    const startedMts = rolls.filter(r => r.started).reduce((a, r) => a + r.mts, 0);
    const newMts = rolls.filter(r => !r.started).reduce((a, r) => a + r.mts, 0);
    return {
      id: String(item.id || raw),
      code: match ? match[1].trim() : '',
      name: (match ? match[2] : raw).trim() || raw,
      full: raw,
      total,
      rolls,
      rollCount: rolls.length || Number(item.rolls) || 0,
      startedCount: rolls.filter(r => r.started).length,
      newCount: rolls.filter(r => !r.started).length,
      startedMts,
      newMts,
    };
  };

  const statusOf = (tela, low) => tela.total <= 0 ? 'sin' : tela.total < low ? 'bajo' : 'ok';
  const STATUS_LABEL = {ok: 'Con stock', bajo: 'Stock bajo', sin: 'Sin stock'};

  const visible = () => {
    const q = state.query.trim().toLocaleLowerCase('es');
    let list = state.telas.filter(t => !q || t.full.toLocaleLowerCase('es').includes(q) || t.code.toLocaleLowerCase('es') === q);
    if (state.filter === 'empezados') list = list.filter(t => t.startedCount > 0);
    else if (state.filter !== 'todas') list = list.filter(t => statusOf(t, state.low) === state.filter);
    const sorters = {
      'mts-desc': (a, b) => b.total - a.total,
      'mts-asc': (a, b) => a.total - b.total,
      'rollos-desc': (a, b) => b.rollCount - a.rollCount,
      'nombre': (a, b) => a.name.localeCompare(b.name, 'es'),
      'codigo': (a, b) => (Number(a.code) || 1e9) - (Number(b.code) || 1e9) || a.code.localeCompare(b.code, 'es'),
    };
    return list.sort(sorters[state.sort] || sorters['mts-desc']);
  };

  const root = document.createElement('section');
  root.className = 'td';
  root.innerHTML = `
    <header class="td-head">
      <div><span class="td-eyebrow">PANEL DE CONTROL · BODEGA TELA</span><h2>Inventario de telas</h2><p class="td-updated">Cargando…</p></div>
      <button type="button" class="td-refresh">Actualizar</button>
    </header>
    <div class="td-kpis"></div>
    <div class="td-charts">
      <article class="td-card td-top"><header><h3>Telas con más metros</h3><small><i class="td-dot td-new"></i>Nuevos <i class="td-dot td-started"></i>Empezados</small></header><div class="td-bars"></div></article>
      <article class="td-card td-mix"><header><h3>Estado del inventario</h3></header><div class="td-mix-body"></div></article>
    </div>
    <article class="td-card td-list">
      <div class="td-tools">
        <input type="search" class="td-search" placeholder="Buscar tela o código…" aria-label="Buscar tela">
        <div class="td-chips" role="group" aria-label="Filtrar"></div>
        <label class="td-select">Ordenar
          <select class="td-sort">
            <option value="mts-desc">Más metros</option><option value="mts-asc">Menos metros</option>
            <option value="rollos-desc">Más rollos</option><option value="nombre">Nombre</option><option value="codigo">Código</option>
          </select>
        </label>
        <label class="td-select">Stock bajo &lt;
          <span class="td-low"><input type="number" class="td-low-input" min="1" step="10" aria-label="Umbral de stock bajo"> MTS</span>
        </label>
      </div>
      <p class="td-count"></p>
      <div class="td-table" role="table"></div>
    </article>`;

  const $ = sel => root.querySelector(sel);
  $('.td-low-input').value = state.low;

  const renderKpis = () => {
    const t = state.telas;
    const total = t.reduce((a, x) => a + x.total, 0);
    const rolls = t.reduce((a, x) => a + x.rollCount, 0);
    const started = t.reduce((a, x) => a + x.startedCount, 0);
    const startedMts = t.reduce((a, x) => a + x.startedMts, 0);
    const conStock = t.filter(x => x.total > 0).length;
    const bajo = t.filter(x => statusOf(x, state.low) === 'bajo').length;
    const sin = t.filter(x => statusOf(x, state.low) === 'sin').length;
    const kpi = (label, value, note, filter, tone = '') => `<button type="button" class="td-kpi ${tone} ${filter && state.filter === filter ? 'is-on' : ''}" ${filter ? `data-filter="${filter}"` : 'disabled'}><small>${label}</small><strong>${value}</strong><span>${note}</span></button>`;
    $('.td-kpis').innerHTML =
      kpi('METROS EN BODEGA', fmt(total), 'MTS totales', '') +
      kpi('ROLLOS', fmt(rolls), `${fmt(rolls - started)} nuevos · ${fmt(started)} empezados`, 'empezados') +
      kpi('TELAS CON STOCK', fmt(conStock), `de ${fmt(t.length)} referencias`, 'ok') +
      kpi('STOCK BAJO', fmt(bajo), `menos de ${fmt(state.low)} MTS`, 'bajo', 'td-warn') +
      kpi('SIN STOCK', fmt(sin), 'referencias en 0', 'sin', 'td-bad') +
      kpi('MTS EMPEZADOS', fmt(startedMts), `${fmt(pct(startedMts, total))}% del total`, '', 'td-orange');
  };

  const renderTop = () => {
    const top = [...state.telas].filter(t => t.total > 0).sort((a, b) => b.total - a.total).slice(0, 12);
    const max = top[0]?.total || 1;
    $('.td-bars').innerHTML = top.length ? top.map(t => {
      const n = t.rolls.length ? t.newMts : t.total, s = t.rolls.length ? t.startedMts : 0;
      const scale = t.total / (n + s || 1);
      return `<button type="button" class="td-bar" data-jump="${esc(t.id)}" title="${esc(t.full)} · ${fmt(t.total)} MTS">
        <span class="td-bar-name">${t.code ? `<em>${esc(t.code)}</em>` : ''}${esc(t.name)}</span>
        <span class="td-bar-track"><i class="td-new" style="width:${pct(n * scale, max)}%"></i><i class="td-started" style="width:${pct(s * scale, max)}%"></i></span>
        <span class="td-bar-val">${fmt(t.total)}</span></button>`;
    }).join('') : '<p class="td-empty">Sin telas con metros.</p>';
  };

  const renderMix = () => {
    const t = state.telas;
    const newMts = t.reduce((a, x) => a + (x.rolls.length ? x.newMts : x.total), 0);
    const startedMts = t.reduce((a, x) => a + x.startedMts, 0);
    const total = newMts + startedMts;
    const p = pct(newMts, total);
    const ok = t.filter(x => statusOf(x, state.low) === 'ok').length;
    const bajo = t.filter(x => statusOf(x, state.low) === 'bajo').length;
    const sin = t.filter(x => statusOf(x, state.low) === 'sin').length;
    const n = t.length || 1;
    $('.td-mix-body').innerHTML = `
      <div class="td-donut" style="--p:${p}"><div><strong>${fmt(p)}%</strong><span>metros en rollos nuevos</span></div></div>
      <ul class="td-legend">
        <li><i class="td-dot td-new"></i>Nuevos<b>${fmt(newMts)} MTS</b></li>
        <li><i class="td-dot td-started"></i>Empezados<b>${fmt(startedMts)} MTS</b></li>
      </ul>
      <div class="td-health" aria-label="Referencias por nivel de stock">
        <span class="td-h-ok" style="flex:${ok / n}"></span><span class="td-h-bajo" style="flex:${bajo / n}"></span><span class="td-h-sin" style="flex:${sin / n}"></span>
      </div>
      <ul class="td-legend td-legend-sm">
        <li><i class="td-dot td-h-ok"></i>Con stock<b>${ok}</b></li>
        <li><i class="td-dot td-h-bajo"></i>Bajo<b>${bajo}</b></li>
        <li><i class="td-dot td-h-sin"></i>Sin stock<b>${sin}</b></li>
      </ul>`;
  };

  const renderChips = () => {
    const opts = [['todas', 'Todas'], ['ok', 'Con stock'], ['bajo', 'Stock bajo'], ['sin', 'Sin stock'], ['empezados', 'Con empezados']];
    $('.td-chips').innerHTML = opts.map(([k, l]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'is-on' : ''}">${l}</button>`).join('');
  };

  const renderTable = () => {
    const list = visible();
    const totalAll = state.telas.reduce((a, x) => a + x.total, 0);
    const sumList = list.reduce((a, x) => a + x.total, 0);
    $('.td-count').textContent = `${list.length} de ${state.telas.length} telas · ${fmt(sumList)} MTS`;
    if (!list.length) { $('.td-table').innerHTML = '<p class="td-empty">Ninguna tela coincide con el filtro.</p>'; return; }
    $('.td-table').innerHTML = `<div class="td-row td-th" role="row"><span>Código</span><span>Tela</span><span>Rollos</span><span>MTS</span><span>% bodega</span><span>Estado</span></div>` +
      list.map(t => {
        const st = statusOf(t, state.low), open = state.open.has(t.id);
        const rollsHtml = t.rolls.length ? t.rolls.map(r => `<span class="td-roll ${r.started ? 'td-started' : 'td-new'}" title="${r.started ? 'Empezado' : 'Nuevo'}">${fmt(r.mts)}</span>`).join('') : '<em class="td-muted">Sin detalle de rollos</em>';
        return `<div class="td-item ${open ? 'is-open' : ''}" data-id="${esc(t.id)}">
          <button type="button" class="td-row" role="row" aria-expanded="${open}">
            <span class="td-code">${esc(t.code || '—')}</span>
            <span class="td-name">${esc(t.name)}</span>
            <span class="td-rolls"><b>${fmt(t.rollCount)}</b>${t.startedCount ? `<small>${t.startedCount} emp.</small>` : ''}</span>
            <span class="td-mts">${fmt(t.total)}</span>
            <span class="td-share"><i style="width:${Math.min(100, pct(t.total, totalAll) * 4)}%"></i><small>${fmt(pct(t.total, totalAll))}%</small></span>
            <span class="td-badge td-b-${st}">${STATUS_LABEL[st]}</span>
          </button>
          <div class="td-detail">${open ? `<div class="td-roll-list">${rollsHtml}</div><p class="td-muted">${fmt(t.newCount)} nuevos (${fmt(t.newMts)} MTS) · ${fmt(t.startedCount)} empezados (${fmt(t.startedMts)} MTS)</p>` : ''}</div>
        </div>`;
      }).join('');
  };

  const render = () => {
    if (state.error && !state.telas.length) {
      $('.td-kpis').innerHTML = `<p class="td-empty td-error">${esc(state.error)}</p>`;
      return;
    }
    renderKpis(); renderTop(); renderMix(); renderChips(); renderTable();
    const when = state.updatedAt ? new Date(state.updatedAt) : null;
    $('.td-updated').textContent = (when && !isNaN(when) ? `Inventario actualizado ${when.toLocaleString('es-CO', {dateStyle: 'medium', timeStyle: 'short'})}` : 'Inventario local') + (state.error ? ` · ${state.error}` : '');
  };

  const load = async () => {
    if (state.loading) return;
    state.loading = true;
    root.classList.add('is-loading');
    $('.td-refresh').disabled = true;
    try {
      const response = await fetch('/api/inventarios', {cache: 'no-store'});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar el inventario');
      state.telas = (data.items || []).filter(item => String(item.categoria || '').trim().toUpperCase() === CATEGORY).map(normalize);
      state.updatedAt = data.updated_at || '';
      state.error = '';
    } catch (error) {
      state.error = error.message || 'Error cargando inventario';
    } finally {
      state.loading = false;
      root.classList.remove('is-loading');
      $('.td-refresh').disabled = false;
      render();
    }
  };

  root.addEventListener('click', event => {
    const f = event.target.closest('[data-filter]');
    if (f && !f.disabled) { state.filter = state.filter === f.dataset.filter && f.classList.contains('td-kpi') ? 'todas' : f.dataset.filter; render(); return; }
    const jump = event.target.closest('[data-jump]');
    if (jump) {
      state.filter = 'todas'; state.query = ''; $('.td-search').value = ''; state.open.add(jump.dataset.jump); render();
      root.querySelector(`.td-item[data-id="${CSS.escape(jump.dataset.jump)}"]`)?.scrollIntoView({behavior: 'smooth', block: 'center'});
      return;
    }
    const row = event.target.closest('.td-item > .td-row');
    if (row) { const id = row.parentElement.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id); renderTable(); return; }
    if (event.target.closest('.td-refresh')) load();
  });
  $('.td-search').addEventListener('input', e => { state.query = e.target.value; renderTable(); });
  $('.td-sort').addEventListener('change', e => { state.sort = e.target.value; renderTable(); });
  $('.td-low-input').addEventListener('change', e => { const v = Number(e.target.value); if (v > 0) { state.low = v; saveLow(v); render(); } else e.target.value = state.low; });

  const style = document.createElement('style');
  style.textContent = `
  .panel[data-panel="panel-control"] .control-panel{max-width:1280px!important}
  .panel[data-panel="panel-control"] .td{margin-top:22px;padding-top:22px;border-top:1px solid #2f3f2f}
  .td{--td-bg:#101510;--td-card:#151d15;--td-line:#2f3f2f;--td-text:#eef6e8;--td-muted:#a9b8a3;--td-lime:#d0f44c;--td-new:#5fcf6a;--td-started:#f29b38;--td-warn:#f2c94c;--td-bad:#ff6b6b;display:grid;gap:16px;color:var(--td-text);font-family:Arial,Helvetica,sans-serif}
  .td button{font:inherit;color:inherit;cursor:pointer}
  .td-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px}
  .td-eyebrow{color:var(--td-lime);font:800 10px Arial;letter-spacing:.12em}
  .td-head h2{margin:4px 0 2px;font-size:1.5rem}
  .td-updated{margin:0;color:var(--td-muted);font-size:12px}
  .td-refresh{width:auto!important;padding:9px 14px!important;border:1px solid #60754d!important;border-radius:9px!important;background:#233020!important;color:#eff9df!important;font-weight:800!important}
  .td-refresh:disabled{opacity:.6}
  .td.is-loading .td-kpis,.td.is-loading .td-charts,.td.is-loading .td-list{opacity:.55;transition:opacity .2s}
  .td-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
  .td-kpi{display:grid;gap:6px;align-content:start;min-height:108px;padding:15px!important;border:1px solid var(--td-line)!important;border-radius:14px!important;background:linear-gradient(145deg,#182118,#0f140f)!important;text-align:left;width:auto!important;transition:border-color .15s,transform .15s}
  .td-kpi:not(:disabled):hover{border-color:#6c8a4a!important;transform:translateY(-1px)}
  .td-kpi:disabled{cursor:default;opacity:1}
  .td-kpi.is-on{border-color:var(--td-lime)!important;box-shadow:0 0 0 1px var(--td-lime) inset}
  .td-kpi small{color:var(--td-muted);font:800 10px Arial;letter-spacing:.07em}
  .td-kpi strong{color:var(--td-lime);font:800 26px Arial;font-variant-numeric:tabular-nums}
  .td-kpi span{color:#bdc8b8;font-size:12px}
  .td-kpi.td-warn strong{color:var(--td-warn)}.td-kpi.td-bad strong{color:var(--td-bad)}.td-kpi.td-orange strong{color:var(--td-started)}
  .td-charts{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:14px}
  .td-card{padding:16px;border:1px solid var(--td-line);border-radius:14px;background:var(--td-card)}
  .td-card>header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
  .td-card h3{margin:0;font-size:.95rem}
  .td-card header small{display:flex;align-items:center;gap:6px;color:var(--td-muted);font-size:11px}
  .td-dot{display:inline-block;width:9px;height:9px;border-radius:50%}
  i.td-new,.td-dot.td-new{background:var(--td-new)} i.td-started,.td-dot.td-started{background:var(--td-started)}
  .td-bars{display:grid;gap:7px}
  .td-bar{display:grid!important;grid-template-columns:minmax(120px,190px) 1fr 64px;align-items:center;gap:10px;width:100%!important;padding:3px 4px!important;border:0!important;border-radius:6px!important;background:transparent!important;text-align:left}
  .td-bar:hover{background:#1d281d!important}
  .td-bar-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:700}
  .td-bar-name em,.td-code{color:var(--td-muted);font-style:normal;font-weight:700;margin-right:6px;font-variant-numeric:tabular-nums}
  .td-bar-track{display:flex;height:14px;border-radius:4px;background:#0e130e;overflow:hidden}
  .td-bar-track i{display:block;height:100%}
  .td-bar-val{text-align:right;font-weight:800;font-size:12px;font-variant-numeric:tabular-nums}
  .td-mix-body{display:grid;gap:14px;justify-items:center}
  .td-donut{--p:0;display:grid;place-items:center;width:150px;height:150px;border-radius:50%;background:conic-gradient(var(--td-new) calc(var(--p)*1%),var(--td-started) 0)}
  .td-donut>div{display:grid;place-items:center;text-align:center;width:106px;height:106px;border-radius:50%;background:var(--td-card);padding:6px;box-sizing:border-box}
  .td-donut strong{font-size:1.35rem;color:var(--td-text)}
  .td-donut span{font-size:10px;color:var(--td-muted);line-height:1.2}
  .td-legend{list-style:none;margin:0;padding:0;display:grid;gap:6px;width:100%}
  .td-legend li{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--td-muted)}
  .td-legend b{margin-left:auto;color:var(--td-text);font-variant-numeric:tabular-nums}
  .td-health{display:flex;width:100%;height:10px;border-radius:5px;overflow:hidden;background:#0e130e;gap:2px}
  .td-h-ok{background:var(--td-new)}.td-h-bajo{background:var(--td-warn)}.td-h-sin{background:var(--td-bad)}
  .td-tools{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin-bottom:10px}
  .td-search{flex:1 1 220px;min-width:0;padding:11px 12px;border:1px solid #465644;border-radius:9px;background:#202b21;color:var(--td-text);font-size:14px}
  .td-chips{display:flex;flex-wrap:wrap;gap:6px}
  .td-chips button{width:auto!important;padding:8px 11px!important;border:1px solid #465644!important;border-radius:999px!important;background:#1b241b!important;color:#d9e6d2!important;font-size:12px!important;font-weight:700!important}
  .td-chips button.is-on{border-color:var(--td-lime)!important;background:#2c3a1a!important;color:var(--td-lime)!important}
  .td-select{display:grid;gap:4px;color:var(--td-muted);font:800 10px Arial;letter-spacing:.06em;text-transform:uppercase}
  .td-select select,.td-low input{padding:8px 9px;border:1px solid #465644;border-radius:8px;background:#202b21;color:var(--td-text);font:600 13px Arial}
  .td-low{display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0}
  .td-low input{width:80px}
  .td-count{margin:0 0 8px;color:var(--td-muted);font-size:12px}
  .td-table{display:grid;gap:4px}
  .td-row{display:grid!important;grid-template-columns:70px minmax(160px,2fr) 90px 100px minmax(110px,1fr) 110px;align-items:center;gap:10px;width:100%!important;padding:10px 12px!important;border:0!important;border-radius:9px!important;background:#111811!important;text-align:left;font-size:13px}
  .td-th{background:transparent!important;color:var(--td-muted);font:800 10px Arial;letter-spacing:.07em;text-transform:uppercase;padding-top:2px!important;padding-bottom:2px!important}
  .td-item>.td-row:hover{background:#1a241a!important}
  .td-item.is-open>.td-row{background:#1d281c!important;border-radius:9px 9px 0 0!important}
  .td-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .td-rolls{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums}
  .td-rolls small{color:var(--td-started);font-size:11px}
  .td-mts{font-weight:800;color:var(--td-lime);font-variant-numeric:tabular-nums}
  .td-share{display:flex;align-items:center;gap:8px}
  .td-share i{display:block;height:6px;min-width:2px;border-radius:3px;background:#7f9d58}
  .td-share small{color:var(--td-muted);font-variant-numeric:tabular-nums}
  .td-badge{justify-self:start;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800}
  .td-b-ok{background:#1e3d21;color:#a8f0a8}.td-b-bajo{background:#3d3416;color:#ffe08a}.td-b-sin{background:#40201f;color:#ffb4ae}
  .td-detail{display:none}
  .td-item.is-open .td-detail{display:grid;gap:8px;padding:12px 14px 14px;border-radius:0 0 9px 9px;background:#162016}
  .td-roll-list{display:flex;flex-wrap:wrap;gap:7px}
  .td-roll{display:inline-grid;place-items:center;min-width:36px;height:36px;padding:0 7px;border:2px solid;border-radius:50%;font:800 12px Arial;box-sizing:border-box;font-variant-numeric:tabular-nums}
  .td-roll.td-new{border-color:var(--td-new);background:#1d4922;color:#d9ffd4}
  .td-roll.td-started{border-color:var(--td-started);background:#4a2d12;color:#ffe2c2}
  .td-muted{margin:0;color:var(--td-muted);font-size:12px;font-style:normal}
  .td-empty{margin:0;padding:18px;color:var(--td-muted);font-size:13px;text-align:center}
  .td-error{color:#ffb4ae;grid-column:1/-1}
  @media(max-width:1100px){.td-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.td-charts{grid-template-columns:1fr}}
  @media(max-width:700px){
    .td-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .td-kpi{min-height:92px}.td-kpi strong{font-size:22px}
    .td-head{align-items:flex-start}
    .td-bar{grid-template-columns:minmax(90px,120px) 1fr 52px}
    .td-th{display:none!important}
    .td-row{grid-template-columns:1fr auto;grid-template-areas:"name mts" "code rolls" "share badge";row-gap:6px}
    .td-name{grid-area:name;white-space:normal}.td-mts{grid-area:mts;text-align:right}.td-code{grid-area:code}.td-rolls{grid-area:rolls;justify-content:flex-end}.td-share{grid-area:share}.td-badge{grid-area:badge;justify-self:end}
    .td-tools>*{flex:1 1 100%}
  }`;
  document.head.appendChild(style);

  // Montaje: se inserta dentro del panel existente PANEL DE CONTROL y carga al abrirlo.
  let mounted = false;
  const mount = () => {
    const panel = document.querySelector('.panel[data-panel="panel-control"]');
    if (!panel) return false;
    if (!mounted) {
      (panel.querySelector('.control-panel') || panel).appendChild(root);
      mounted = true;
      new MutationObserver(() => { if (panel.classList.contains('active')) load(); }).observe(panel, {attributes: true, attributeFilter: ['class']});
      if (panel.classList.contains('active')) load();
    }
    return true;
  };
  if (!mount()) {
    const obs = new MutationObserver(() => { if (mount()) obs.disconnect(); });
    obs.observe(document.body, {childList: true, subtree: true});
  }
})();
