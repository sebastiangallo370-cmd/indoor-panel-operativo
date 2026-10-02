// BODEGAS: en qué bodega está guardado cada rollo de tela.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
  const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const rolls = n => num(n) + (Number(n) === 1 ? ' rollo' : ' rollos');
  const NONE = 'SIN BODEGA';
  let data = null;

  const style = document.createElement('style');
  style.textContent = `
.bg{display:grid;gap:22px;width:100%;padding-bottom:40px}
.bg-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border:1px solid #46563f;border-radius:18px;background:linear-gradient(155deg,#1a2418,#0e140f)}
.bg-head h2{margin:0;font-size:1.05rem;color:#f0f4eb}
.bg-head p{margin:3px 0 0;color:#8a9485;font-size:.72rem}
.bg-head div:last-child{display:flex;gap:8px}
.bg-btn{width:auto!important;padding:9px 14px!important;border:1px solid #d0f44c!important;border-radius:9px!important;background:#1d2a14!important;color:#e7ff9a!important;font-weight:850;cursor:pointer}
.bg-btn.alt{border-color:#46563f!important;background:#151d15!important;color:#dfe8d9!important}
.bg-btn:disabled{opacity:.45;cursor:not-allowed}
.bg h3{margin:0;color:#d0f44c;font:850 .72rem Arial;letter-spacing:.1em;text-transform:uppercase}
.bg-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.bg-telas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.bg .inventory-item-card{min-height:0;align-content:start}
.bg .inventory-item-card .inv-name{min-height:0}
.bg .inv-badge{width:max-content;margin-bottom:0}
.bg .inv-total small{font-size:.9rem;margin-left:5px;color:#bdc8b8}
.bg-sum{cursor:pointer;text-align:left;font:inherit;color:inherit}
.bg-sum.on{border-color:#d0f44c!important;box-shadow:0 0 0 2px #d0f44c55}
.bg-sum.none .inv-total{color:#ffd9a0}
.bg-group{display:grid;gap:6px;padding:8px 0;border-top:1px solid #26321f}
.bg-group:first-of-type{border-top:0}
.bg-group small{color:#aebba7;font:800 .64rem Arial;letter-spacing:.07em;text-transform:uppercase}
.bg-group small b{color:#e7ff9a}
.bg-group.none small b{color:#ffd9a0}
.bg .inventory-rolls{display:flex;flex-wrap:wrap;gap:6px}
.bg .inventory-roll{cursor:pointer;user-select:none;transition:transform .12s}
.bg .inventory-roll:hover{transform:scale(1.08)}
.bg .inventory-roll.sel{outline:3px solid #fff;outline-offset:2px}
.bg-assign{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:8px;border-top:1px solid #26321f}
.bg-assign select{flex:1;min-width:140px;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:8px 10px;font:600 .8rem Arial}
.bg-assign button{padding:8px 12px!important;font-size:.78rem}
.bg-assign span{width:100%;color:#8a9485;font-size:.72rem}
.bg-filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end;padding:14px 18px;border:1px solid #46563f;border-radius:18px;background:#111811}
.bg-filters label{display:grid;gap:5px;color:#aebba7;font:800 .64rem Arial;letter-spacing:.07em;text-transform:uppercase}
.bg-filters input,.bg-filters select{width:100%;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:9px 11px;font:500 .85rem Arial;outline:none}
.bg-filters input:focus,.bg-filters select:focus{border-color:#d0f44c}
.bg-note{margin:0;color:#8a9485;font-size:.78rem}
.bg-msg{min-height:1em}
@media (max-width:1300px){.bg-telas{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){.bg-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.bg-telas{grid-template-columns:1fr}.bg-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bg-filters label:first-child{grid-column:1/-1}}
@media (max-width:520px){.bg-head{flex-direction:column;align-items:stretch}.bg-cards{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'bodegas';
  panel.innerHTML = '<div class="bg">' +
    '<div class="bg-head"><div><h2>Bodegas</h2><p>La bodega sale del color de la celda en el Sheet (sin color = BODEGA INDOOR). Para cambiarla aquí: toca los rollos, elige la bodega y guarda (no se escribe al Sheet).</p></div><div><button type="button" class="bg-btn alt" data-bg-new>+ NUEVA BODEGA</button><button type="button" class="bg-btn" data-bg-refresh>Actualizar</button></div></div>' +
    '<section class="bg-section"><h3>Resumen por bodega</h3></section><div class="bg-cards"></div>' +
    '<form class="bg-filters" autocomplete="off" onsubmit="return false"><label>Nombre tela<input name="tela" type="search" list="bg-telas-list" placeholder="Ej. MONTECATINI"><datalist id="bg-telas-list"></datalist></label><label>Código tela<input name="codigo" type="search" inputmode="numeric" placeholder="Ej. 100"></label><label>Bodega<select name="bodega"></select></label><button type="button" class="bg-btn alt" data-bg-clear>Limpiar</button></form>' +
    '<p class="bg-note bg-msg" role="status"></p><div class="bg-telas"></div></div>';
  const cardsBox = panel.querySelector('.bg-cards'), telasBox = panel.querySelector('.bg-telas'), filters = panel.querySelector('.bg-filters'), message = panel.querySelector('.bg-msg');

  const api = async (url, options = {}) => {
    const response = await fetch(url, {cache: 'no-store', headers: {'Content-Type': 'application/json'}, ...options});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.detail || 'No fue posible completar la acción');
    return body;
  };

  const renderSummary = () => {
    const chosen = filters.elements.bodega.value;
    cardsBox.innerHTML = data.resumen.filter(entry => entry.nombre || entry.rollos).map(entry => {
      const name = entry.nombre || NONE;
      return '<button type="button" class="inventory-item-card bg-sum' + (entry.nombre ? '' : ' none') + (chosen === name ? ' on' : '') + '" data-bg-pick="' + esc(name) + '"><span class="inv-badge">' + (entry.nombre ? 'Bodega' : 'Pendiente') + '</span><strong class="inv-name">' + esc(name) + '</strong><span class="inv-total">' + num(entry.mts) + '<small>MTS</small></span><span class="inv-unit">' + rolls(entry.rollos) + ' · ' + num(entry.telas) + (entry.telas === 1 ? ' tela' : ' telas') + '</span></button>';
    }).join('');
  };

  const telaCard = tela => {
    const groups = new Map();
    tela.rollos.forEach(roll => { const key = roll.bodega || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(roll); });
    const order = [...data.bodegas, ''].filter(key => groups.has(key));
    const where = order.filter(Boolean);
    const codeMatch = tela.nombre.match(/^\s*\(([^)]+)\)/);
    return '<article class="inventory-item-card" data-nombre="' + esc(tela.nombre) + '" data-tela="' + esc(norm(tela.nombre)) + '" data-codigo="' + esc(codeMatch ? norm(codeMatch[1]) : '') + '" data-bodegas="' + esc([...groups.keys()].map(key => key || NONE).join('|')) + '">' +
      '<span class="inv-badge">' + esc(where.length ? where.join(' · ') : NONE) + '</span><strong class="inv-name">' + esc(tela.nombre) + '</strong>' +
      (tela.rollos.length ? order.map(key => '<div class="bg-group' + (key ? '' : ' none') + '"><small><b>' + esc(key || NONE) + '</b> · ' + rolls(groups.get(key).length) + ' · ' + num(groups.get(key).reduce((sum, roll) => sum + roll.v, 0)) + ' MTS</small><div class="inventory-rolls">' +
        groups.get(key).map(roll => '<span class="inventory-roll ' + (roll.estado === 'started' ? 'roll-started' : 'roll-new') + '" data-i="' + roll.i + '" title="Rollo de ' + esc(num(roll.v)) + ' MTS · ' + esc(key || NONE) + '">' + esc(num(roll.v)) + '</span>').join('') + '</div></div>').join('') : '<p class="bg-note">Sin rollos en inventario.</p>') +
      '<span class="inv-total">' + num(tela.mts) + '<small>MTS</small></span>' +
      (tela.rollos.length ? '<div class="bg-assign"><select><option value="">Mover a…</option>' + data.bodegas.map(name => '<option value="' + esc(name) + '">' + esc(name) + '</option>').join('') + '<option value="__none__">Según el Sheet</option></select><button type="button" class="bg-btn alt" data-bg-all>Todos</button><button type="button" class="bg-btn" data-bg-save disabled>Guardar</button><span>0 rollos seleccionados</span></div>' : '') +
      '</article>';
  };

  const applyFilters = () => {
    const typed = filters.elements.tela.value;
    const tela = norm(typed);
    const codigo = norm(filters.elements.codigo.value).replace(/[()]/g, '');
    const bodega = filters.elements.bodega.value;
    let shown = 0;
    telasBox.querySelectorAll('.inventory-item-card').forEach(card => {
      const ok = (!tela || card.dataset.tela.includes(tela)) && (!codigo || card.dataset.codigo === codigo) && (!bodega || card.dataset.bodegas.split('|').includes(bodega));
      card.style.display = ok ? '' : 'none';
      if (ok) shown += 1;
    });
    cardsBox.querySelectorAll('.bg-sum').forEach(card => card.classList.toggle('on', card.dataset.bgPick === bodega));
    if (!message.dataset.keep) message.textContent = shown + (shown === 1 ? ' tela' : ' telas') + (tela || codigo || bodega ? (shown === 1 ? ' coincide' : ' coinciden') + ' con el filtro.' : ' en Bodega tela.');
  };

  const render = () => {
    const select = filters.elements.bodega, current = select.value;
    select.innerHTML = '<option value="">Todas</option>' + [...data.bodegas, NONE].map(name => '<option value="' + esc(name) + '">' + esc(name) + '</option>').join('');
    select.value = [...data.bodegas, NONE].includes(current) ? current : '';
    panel.querySelector('#bg-telas-list').innerHTML = data.telas.map(tela => '<option value="' + esc(tela.nombre) + '"></option>').join('');
    renderSummary();
    telasBox.innerHTML = data.telas.map(telaCard).join('');
    applyFilters();
  };

  const load = async () => {
    telasBox.innerHTML = '<p class="bg-note">Cargando bodegas…</p>';
    try { data = await api('/api/inventarios/bodegas'); render(); }
    catch (error) { telasBox.innerHTML = '<p class="bg-note">' + esc(error.message) + '</p>'; }
  };

  const updateSelection = card => {
    const count = card.querySelectorAll('.inventory-roll.sel').length;
    const assign = card.querySelector('.bg-assign');
    assign.querySelector('span').textContent = count + (count === 1 ? ' rollo seleccionado' : ' rollos seleccionados');
    assign.querySelector('[data-bg-save]').disabled = !count || !assign.querySelector('select').value;
  };

  telasBox.addEventListener('click', async event => {
    const card = event.target.closest('.inventory-item-card');
    if (!card) return;
    const roll = event.target.closest('.inventory-roll');
    if (roll) { roll.classList.toggle('sel'); updateSelection(card); return; }
    if (event.target.closest('[data-bg-all]')) {
      const all = card.querySelectorAll('.inventory-roll'), allOn = [...all].every(node => node.classList.contains('sel'));
      all.forEach(node => node.classList.toggle('sel', !allOn));
      updateSelection(card);
      return;
    }
    const save = event.target.closest('[data-bg-save]');
    if (!save) return;
    const target = card.querySelector('.bg-assign select').value;
    const indexes = [...card.querySelectorAll('.inventory-roll.sel')].map(node => Number(node.dataset.i));
    if (!indexes.length || !target) return;
    save.disabled = true;
    save.textContent = 'Guardando…';
    try {
      await api('/api/inventarios/bodegas/asignar', {method: 'POST', body: JSON.stringify({nombre: card.dataset.nombre, rollos: indexes, bodega: target === '__none__' ? '' : target})});
      message.dataset.keep = 'true';
      message.textContent = 'Guardado: ' + rolls(indexes.length) + ' de ' + card.dataset.nombre + (target === '__none__' ? ' vuelven a la bodega que indica el Sheet.' : ' en ' + target + '.');
      await load();
      setTimeout(() => { delete message.dataset.keep; }, 4000);
    } catch (error) { alert(error.message); save.disabled = false; save.textContent = 'Guardar'; }
  });
  telasBox.addEventListener('change', event => { const card = event.target.closest('.inventory-item-card'); if (card && event.target.matches('.bg-assign select')) updateSelection(card); });
  cardsBox.addEventListener('click', event => {
    const pick = event.target.closest('[data-bg-pick]');
    if (!pick) return;
    filters.elements.bodega.value = filters.elements.bodega.value === pick.dataset.bgPick ? '' : pick.dataset.bgPick;
    applyFilters();
  });
  filters.addEventListener('input', applyFilters);
  filters.addEventListener('change', applyFilters);
  panel.querySelector('[data-bg-clear]').onclick = () => { filters.reset(); applyFilters(); };
  panel.querySelector('[data-bg-refresh]').onclick = load;
  panel.querySelector('[data-bg-new]').onclick = async () => {
    const name = (prompt('Nombre de la nueva bodega:') || '').trim();
    if (!name) return;
    try { const result = await api('/api/inventarios/bodegas', {method: 'POST', body: JSON.stringify({nombre: name})}); message.textContent = 'Bodega creada: ' + result.nombre; await load(); }
    catch (error) { alert(error.message); }
  };

  const open = button => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === panel));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    load();
  };

  const mount = () => {
    if (document.querySelector('[data-bodegas-nav]')) return true;
    const group = [...document.querySelectorAll('.nav-group')].find(item => /INVENTARIOS/i.test(item.querySelector('.nav-parent')?.textContent || ''));
    const children = group?.querySelector('.nav-children');
    const main = document.querySelector('main');
    const dashboard = document.querySelector('[data-bodega-dashboard]');
    if (!children || !main || !dashboard) return false;
    main.appendChild(panel);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab inventory-control-nav';
    button.dataset.bodegasNav = 'true';
    button.innerHTML = '<span class="nav-icon">BG</span><strong>BODEGAS</strong>';
    button.onclick = () => open(button);
    dashboard.after(button);
    return true;
  };
  if (!mount()) { const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 300); setTimeout(() => clearInterval(timer), 15000); }
})();
