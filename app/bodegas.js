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
.bg-actions{padding-top:8px;border-top:1px solid #26321f}
.bg-actions .bg-btn{width:100%!important}
.bg-inline{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;padding-top:10px;border-top:1px solid #26321f}
.bg-inline>span{display:flex;flex-wrap:wrap;gap:5px}
.bg-uso{display:inline-block;width:max-content;padding:3px 8px;border:1px solid #d0f44c;border-radius:999px;background:#2a3a12;color:#e7ff9a;font:850 .62rem Arial;letter-spacing:.05em;text-transform:uppercase}
.bg-chip{display:inline-block;padding:3px 7px;border:1px solid #46563f;border-radius:999px;background:#1d2a14;color:#c9e7a6;font:800 .62rem Arial;letter-spacing:.05em;text-transform:uppercase}
.bg-inline .bg-btn{padding:6px 10px!important;font-size:.7rem}
.bg-dialog{width:min(760px,94vw);max-height:90dvh;padding:0;border:1px solid rgba(208,244,76,.6);border-radius:20px;background:#0c110b;color:#f3f7ee;box-shadow:0 30px 90px #000b}
.bg-dialog::backdrop{background:#000b}
.bg-dlg{position:relative;display:grid;gap:14px;padding:24px}
.bg-dlg header{display:block!important;position:static!important;margin:0!important;padding:0 40px 0 0!important;border:0!important;background:none!important;min-height:0!important;box-shadow:none!important}
.bg-dlg header h2{margin:8px 0 4px;font-size:1.15rem}
.bg-dlg header p{margin:0;color:#9fae99;font-size:.8rem}
.bg-x{position:absolute;top:12px;right:14px;width:34px!important;height:34px;padding:0!important;border:1px solid #46563f!important;border-radius:50%!important;background:#151d15!important;color:#fff!important;font-size:20px;cursor:pointer}
.bg-dgroup{display:grid;gap:8px;padding:12px;border:1px solid #2b382b;border-radius:12px;background:#111811}
.bg-dgroup small{color:#aebba7;font:800 .66rem Arial;letter-spacing:.07em;text-transform:uppercase}
.bg-dgroup small b{color:#e7ff9a}
.bg-dgroup em{color:#6f7b6a;font-size:.75rem}
.bg-dialog .inventory-rolls{display:flex;flex-wrap:wrap;gap:7px}
.bg-dialog .inventory-roll{cursor:pointer;user-select:none;transition:transform .12s}
.bg-dialog .inventory-roll:hover{transform:scale(1.08)}
.bg-dialog .inventory-roll.sel{outline:3px solid #fff;outline-offset:2px}
.bg-move{display:grid;gap:10px;padding-top:6px;border-top:1px solid #26321f}
.bg-move>div:first-child{display:flex;align-items:center;gap:12px;color:#9fae99;font-size:.78rem}
.bg-move small{color:#d0f44c;font:850 .66rem Arial;letter-spacing:.1em}
.bg-targets{display:flex;flex-wrap:wrap;gap:8px}
.bg-targets .bg-btn{flex:1 1 150px}
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
    '<div class="bg-head"><div><h2>Bodegas</h2><p>La bodega sale del color de la celda en el Sheet (sin color = BODEGA INDOOR). Para moverla usa EDITAR BODEGA en cada tela (se guarda en el servidor, no se escribe al Sheet).</p></div><div><button type="button" class="bg-btn alt" data-bg-new>+ NUEVA BODEGA</button><button type="button" class="bg-btn" data-bg-refresh>Actualizar</button></div></div>' +
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
      return '<button type="button" class="inventory-item-card bg-sum' + (entry.nombre ? '' : ' none') + (chosen === name ? ' on' : '') + '" data-bg-pick="' + esc(name) + '"><span class="inv-badge">' + (entry.nombre ? 'Bodega' : 'Pendiente') + '</span><strong class="inv-name">' + chip(entry.nombre, name) + '</strong><span class="inv-total">' + num(entry.mts) + '<small>MTS</small></span><span class="inv-unit">' + rolls(entry.rollos) + ' · ' + num(entry.telas) + (entry.telas === 1 ? ' tela' : ' telas') + '</span></button>';
    }).join('');
  };

  const telaCard = tela => {
    const groups = new Map();
    tela.rollos.forEach(roll => { const key = roll.bodega || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(roll); });
    const order = [...data.bodegas, ''].filter(key => groups.has(key));
    const where = order.filter(Boolean);
    const codeMatch = tela.nombre.match(/^\s*\(([^)]+)\)/);
    return '<article class="inventory-item-card" data-nombre="' + esc(tela.nombre) + '" data-tela="' + esc(norm(tela.nombre)) + '" data-codigo="' + esc(codeMatch ? norm(codeMatch[1]) : '') + '" data-bodegas="' + esc([...groups.keys()].map(key => key || NONE).join('|')) + '">' +
      usage(tela) + '<span class="inv-badge">' + esc(where.length ? where.join(' · ') : NONE) + '</span><strong class="inv-name">' + esc(tela.nombre) + '</strong>' +
      (tela.rollos.length ? order.map(key => '<div class="bg-group' + (key ? '' : ' none') + '"><small>' + chip(key, key || NONE) + ' · ' + rolls(groups.get(key).length) + ' · ' + num(groups.get(key).reduce((sum, roll) => sum + roll.v, 0)) + ' MTS</small><div class="inventory-rolls">' +
        groups.get(key).map(roll => '<span class="inventory-roll ' + (roll.estado === 'started' ? 'roll-started' : 'roll-new') + placeClass(roll.bodega) + '" data-i="' + roll.i + '" title="Rollo de ' + esc(num(roll.v)) + ' MTS · ' + esc(key || NONE) + '">' + esc(num(roll.v)) + '</span>').join('') + '</div></div>').join('') : '<p class="bg-note">Sin rollos en inventario.</p>') +
      '<span class="inv-total">' + num(tela.mts) + '<small>MTS</small></span>' +
      (tela.rollos.length ? '<div class="bg-actions"><button type="button" class="bg-btn" data-bg-edit>EDITAR BODEGA</button></div>' : '') +
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
    if (!message.dataset.keep) message.textContent = shown + (shown === 1 ? ' tela' : ' telas') + (tela || codigo || bodega ? (shown === 1 ? ' coincide' : ' coinciden') + ' con el filtro.' : ' en Stock tela.');
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

  // Color de cada bodega (los mismos de la leyenda del Sheet). BODEGA INDOOR conserva el color normal del rollo.
  const PLACE_COLORS = {'BODEGA GLORIA': ['#dde9f5', '#12335c', '#8fb3d9'], 'BODEGA CASA': ['#fff2cc', '#5a4500', '#e0c060'], 'BODEGA SEGUNDO PISO': ['#d9d2e9', '#3b2a63', '#a593cf'], 'BODEGA INDOOR': null};
  const EXTRA_COLORS = [['#c8f1ec', '#0f3d3a', '#5cc9bd'], ['#ffd9ec', '#4a1634', '#e58ab8'], ['#ffe0c2', '#5c2e00', '#e8a35c']];
  const placeColor = name => {
    if (name in PLACE_COLORS) return PLACE_COLORS[name];
    const extra = (data?.bodegas || []).filter(item => !(item in PLACE_COLORS));
    const index = extra.indexOf(name);
    return index < 0 ? null : EXTRA_COLORS[index % EXTRA_COLORS.length];
  };
  const placeClass = name => (data?.bodegas || []).includes(name) && placeColor(name) ? ' bgp-' + data.bodegas.indexOf(name) : '';
  const placeStyle = document.createElement('style');
  document.head.appendChild(placeStyle);
  const paintPlaces = () => {
    placeStyle.textContent = (data?.bodegas || []).map((name, index) => {
      const color = placeColor(name);
      if (!color) return '';
      const [bg, fg, border] = color, roll = '.inventory-roll.bgp-' + index + ':not([class*="roll-pick"])';
      return roll + '{background:' + bg + '!important;color:' + fg + '!important;border-color:' + border + '!important}' +
        roll + '.roll-started{border-color:#ff9f1c!important;border-style:dashed!important}' +
        '.bg-chip.bgp-' + index + '{background:' + bg + ';color:' + fg + ';border-color:' + border + '}';
    }).join('');
  };
  const chip = (name, text) => '<span class="bg-chip' + placeClass(name) + '">' + esc(text) + '</span>';
  const usage = tela => tela.uso_pedidos ? '<span class="bg-uso" title="Pedidos de Producción que usan esta tela · ' + esc(num(tela.uso_mts)) + ' MTS requeridos">★ ' + num(tela.uso_pedidos) + (tela.uso_pedidos === 1 ? ' pedido' : ' pedidos') + '</span>' : '';
  const fetchData = async () => { data = await api('/api/inventarios/bodegas'); data.at = Date.now(); paintPlaces(); return data; };
  const load = async () => {
    telasBox.innerHTML = '<p class="bg-note">Cargando bodegas…</p>';
    try { await fetchData(); render(); decorateInventory(true); }
    catch (error) { telasBox.innerHTML = '<p class="bg-note">' + esc(error.message) + '</p>'; }
  };

  // Ventana EDITAR BODEGA (se abre desde BODEGAS y desde STOCK TELA).
  const dialog = document.createElement('dialog');
  dialog.className = 'bg-dialog';
  document.body.appendChild(dialog);
  let editing = '';
  const renderDialog = (note = '') => {
    const tela = data.telas.find(item => item.nombre === editing);
    if (!tela) { dialog.innerHTML = '<div class="bg-dlg"><button type="button" class="bg-x" aria-label="Cerrar">×</button><p class="bg-note">Esa tela ya no está en el inventario.</p></div>'; return; }
    const groups = new Map(data.bodegas.map(name => [name, []]));
    tela.rollos.forEach(roll => { if (!groups.has(roll.bodega || NONE)) groups.set(roll.bodega || NONE, []); groups.get(roll.bodega || NONE).push(roll); });
    dialog.innerHTML = '<div class="bg-dlg"><button type="button" class="bg-x" aria-label="Cerrar">×</button>' +
      '<header><span class="inv-badge">EDITAR BODEGA</span><h2>' + esc(tela.nombre) + '</h2><p>' + rolls(tela.rollos.length) + ' · ' + num(tela.mts) + ' MTS. Toca los rollos que quieres mover y luego la bodega de destino.</p></header>' +
      [...groups.entries()].map(([name, list]) => '<section class="bg-dgroup"><small>' + chip(name, name) + ' · ' + rolls(list.length) + (list.length ? ' · ' + num(list.reduce((sum, roll) => sum + roll.v, 0)) + ' MTS' : '') + '</small><div class="inventory-rolls">' +
        (list.length ? list.map(roll => '<span class="inventory-roll ' + (roll.estado === 'started' ? 'roll-started' : 'roll-new') + placeClass(roll.bodega) + '" data-i="' + roll.i + '" title="' + esc(num(roll.v)) + ' MTS · ' + (roll.origen === 'web' ? 'asignado en la web' : roll.origen === 'sheet' ? 'según el color del Sheet' : 'sin color en el Sheet') + '">' + esc(num(roll.v)) + '</span>').join('') : '<em>Sin rollos</em>') + '</div></section>').join('') +
      '<div class="bg-move"><div><button type="button" class="bg-btn alt" data-bg-all>Seleccionar todos</button><span data-bg-count>0 rollos seleccionados</span></div><small>MOVER SELECCIONADOS A:</small><div class="bg-targets">' +
        data.bodegas.map(name => '<button type="button" class="bg-btn" data-bg-to="' + esc(name) + '" disabled>' + esc(name) + '</button>').join('') +
        '<button type="button" class="bg-btn alt" data-bg-to="__none__" disabled title="Quita lo asignado en la web y deja la bodega que indica el color del Sheet">Según el Sheet</button></div></div>' +
      '<p class="bg-note bg-dmsg" role="status">' + esc(note) + '</p></div>';
  };
  const openEditor = async nombre => {
    editing = nombre;
    dialog.innerHTML = '<div class="bg-dlg"><p class="bg-note">Cargando…</p></div>';
    if (!dialog.open) dialog.showModal();
    try { if (!data || Date.now() - data.at > 20000) await fetchData(); renderDialog(); }
    catch (error) { dialog.innerHTML = '<div class="bg-dlg"><button type="button" class="bg-x" aria-label="Cerrar">×</button><p class="bg-note">' + esc(error.message) + '</p></div>'; }
  };
  const syncSelection = () => {
    const count = dialog.querySelectorAll('.inventory-roll.sel').length;
    const counter = dialog.querySelector('[data-bg-count]');
    if (counter) counter.textContent = count + (count === 1 ? ' rollo seleccionado' : ' rollos seleccionados');
    dialog.querySelectorAll('[data-bg-to]').forEach(button => { button.disabled = !count; });
  };
  dialog.addEventListener('click', async event => {
    if (event.target === dialog || event.target.closest('.bg-x')) { dialog.close(); return; }
    const roll = event.target.closest('.inventory-roll');
    if (roll) { roll.classList.toggle('sel'); syncSelection(); return; }
    if (event.target.closest('[data-bg-all]')) {
      const all = dialog.querySelectorAll('.inventory-roll'), allOn = [...all].every(node => node.classList.contains('sel'));
      all.forEach(node => node.classList.toggle('sel', !allOn));
      syncSelection();
      return;
    }
    const move = event.target.closest('[data-bg-to]');
    if (!move || move.disabled) return;
    const target = move.dataset.bgTo;
    const indexes = [...dialog.querySelectorAll('.inventory-roll.sel')].map(node => Number(node.dataset.i));
    if (!indexes.length) return;
    dialog.querySelectorAll('[data-bg-to]').forEach(button => { button.disabled = true; });
    dialog.querySelector('.bg-dmsg').textContent = 'Guardando…';
    try {
      await api('/api/inventarios/bodegas/asignar', {method: 'POST', body: JSON.stringify({nombre: editing, rollos: indexes, bodega: target === '__none__' ? '' : target})});
      await fetchData();
      const one = indexes.length === 1;
      renderDialog('Guardado: ' + rolls(indexes.length) + (target === '__none__' ? (one ? ' vuelve' : ' vuelven') + ' a la bodega que indica el Sheet.' : (one ? ' movido' : ' movidos') + ' a ' + target + '.'));
      if (panel.classList.contains('active')) render();
      decorateInventory(true);
    } catch (error) { dialog.querySelector('.bg-dmsg').textContent = error.message; syncSelection(); }
  });

  telasBox.addEventListener('click', event => {
    const edit = event.target.closest('[data-bg-edit]');
    if (edit) openEditor(edit.closest('.inventory-item-card').dataset.nombre);
  });

  // STOCK TELA: cada tarjeta muestra dónde están sus rollos y el botón EDITAR BODEGA.
  let decorating = false;
  const decorateInventory = async force => {
    const body = document.getElementById('inventory-body');
    if (!body || decorating) return;
    const cards = [...body.querySelectorAll('.inventory-item-card')].filter(card => /STOCK TELA|BODEGA TELA/i.test(card.querySelector('.inv-badge')?.textContent || ''));
    if (!cards.length || (!force && cards.every(card => card.querySelector('.bg-inline')))) return;
    decorating = true;
    try {
      if (!data || Date.now() - data.at > 60000) await fetchData();
      const byName = new Map(data.telas.map(tela => [tela.nombre, tela]));
      cards.forEach(card => {
        const name = card.querySelector('.inv-name')?.textContent.trim();
        const tela = byName.get(name);
        card.querySelector('.bg-inline')?.remove();
        const spans = card.querySelectorAll('.inventory-rolls .inventory-roll');
        spans.forEach(span => { span.className = span.className.replace(/\s*bgp-\d+/g, ''); });
        tela.rollos.forEach(roll => { const cls = placeClass(roll.bodega).trim(); if (cls && spans[roll.i]) spans[roll.i].classList.add(cls); });
        if (!tela || !tela.rollos.length) return;
        const counts = new Map();
        tela.rollos.forEach(roll => counts.set(roll.bodega || NONE, (counts.get(roll.bodega || NONE) || 0) + 1));
        const line = document.createElement('div');
        line.className = 'bg-inline';
        line.innerHTML = '<span>' + usage(tela) + [...counts.entries()].map(([place, count]) => chip(place, place.replace(/^BODEGA /, '') + ' (' + count + ')')).join('') + '</span><button type="button" class="bg-btn">EDITAR BODEGA</button>';
        line.querySelector('button').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openEditor(name); });
        card.appendChild(line);
      });
    } catch (_) {} finally { decorating = false; }
  };
  // Botón ACTUALIZAR en la barra de Stock tela: recarga los datos y redibuja sin recargar la página.
  const mountRefresh = () => {
    const bar = document.querySelector('.inventory-movement-actions');
    if (!bar || bar.querySelector('[data-inventory-refresh]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-refresh-btn';
    button.dataset.inventoryRefresh = 'true';
    button.title = 'Vuelve a cargar el inventario sin recargar la página';
    button.textContent = '↻ ACTUALIZAR';
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = '↻ Actualizando…';
      try {
        await fetch('/api/inventarios?refresh=true', {cache: 'no-store'});
        data = null;
        const search = document.getElementById('inventory-search');
        const typed = search ? search.value : '';
        const activeTab = document.querySelector('.nav-children .tab.active');
        activeTab?.click();                      // redibuja las tarjetas de la categoría abierta
        // Reaplica la búsqueda cuando las tarjetas terminan de redibujarse (unos segundos).
        const until = Date.now() + 4000;
        while (Date.now() < until) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (!search || !typed) continue;
          const cards = [...document.querySelectorAll('#inventory-body .inventory-item-card')];
          const shown = cards.filter(card => card.style.display !== 'none' && !card.hidden).length;
          if (cards.length && (search.value !== typed || shown === cards.length)) {
            search.value = typed;
            search.dispatchEvent(new Event('input', {bubbles: true}));
          }
        }
        await decorateInventory(true);           // vuelve a poner bodegas, pedidos y botón EDITAR BODEGA
        button.textContent = '✓ Actualizado ' + new Date().toLocaleTimeString('es-CO', {hour: '2-digit', minute: '2-digit'});
      } catch (_) { button.textContent = '⚠ No se pudo actualizar'; }
      setTimeout(() => { button.disabled = false; button.textContent = '↻ ACTUALIZAR'; }, 2500);
    };
    bar.prepend(button);
  };
  const refreshStyle = document.createElement('style');
  refreshStyle.textContent = '.inventory-refresh-btn{border:1px solid #6ca8c7!important;background:#10222c!important;color:#bfe6ff!important}.inventory-refresh-btn:disabled{opacity:.7;cursor:progress}';
  document.head.appendChild(refreshStyle);
  new MutationObserver(mountRefresh).observe(document.body, {childList: true, subtree: true});
  mountRefresh();
  let decorateTimer = 0;
  new MutationObserver(() => { clearTimeout(decorateTimer); decorateTimer = setTimeout(() => decorateInventory(false), 250); }).observe(document.body, {childList: true, subtree: true});
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
