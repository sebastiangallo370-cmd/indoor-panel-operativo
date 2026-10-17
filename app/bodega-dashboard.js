// Panel de control de Stock tela: estadísticas en tarjetas con el mismo estilo de Inventarios.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
  const rolls = n => num(n) + (Number(n) === 1 ? ' rollo' : ' rollos');
  const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const day = value => { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; const date = new Date(value); return isNaN(date) ? '' : date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
  const shortDay = value => { const date = value ? new Date(value + 'T12:00:00') : null; return date && !isNaN(date) ? date.toLocaleDateString('es-CO', {day: 'numeric', month: 'short', year: 'numeric'}) : ''; };
  const when = value => { if (!value) return 'sin fecha'; const date = new Date(value); return isNaN(date) ? 'sin fecha' : date.toLocaleString('es-CO', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); };

  const style = document.createElement('style');
  style.textContent = `
.bd{display:grid;gap:22px;width:100%;padding-bottom:40px}
.bd [hidden]{display:none!important}
.bd .dash-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:6px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0e130e}
.bd .dash-tabs button{width:auto!important;min-height:0!important;display:inline-flex;align-items:center;gap:7px;padding:9px 16px!important;border:1px solid transparent!important;border-radius:10px!important;background:transparent!important;color:#b9c6b3!important;font:800 .8rem Arial!important;letter-spacing:.03em;cursor:pointer;transition:background .15s,color .15s}
.bd .dash-tabs button:hover{background:rgba(255,255,255,.06)!important;color:#fff!important}
.bd .dash-tabs button.on{background:#d0f44c!important;color:#16200a!important;border-color:#d0f44c!important}
@media(max-width:700px){.bd .dash-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.bd .dash-tabs button{width:100%!important;justify-content:center}}
.bd-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border:1px solid #46563f;border-radius:18px;background:linear-gradient(155deg,#1a2418,#0e140f)}
.bd-head h2{margin:0;font-size:1.05rem;color:#f0f4eb}
.bd-head p{margin:3px 0 0;color:#8a9485;font-size:.72rem}
.bd-refresh{width:auto!important;padding:9px 14px!important;border:1px solid #d0f44c!important;border-radius:9px!important;background:#1d2a14!important;color:#e7ff9a!important;font-weight:850;cursor:pointer}
.bd-section{display:grid;gap:12px}
.bd-section>h3{display:flex;align-items:center;gap:8px;margin:0;color:#d0f44c;font:850 .72rem Arial;letter-spacing:.1em;text-transform:uppercase}
.bd-section>h3 small{color:#8a9485;font-weight:700;letter-spacing:.04em}
.bd-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
.bd-cards.fit{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
@media (max-width:1400px){.bd-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:1100px){.bd-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:800px){.bd-cards,.bd-cards.fit{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bd .inventory-item-card{min-height:0;align-content:start}
.bd .inventory-item-card .inv-name{min-height:0}
.bd .inv-badge{width:max-content;margin-bottom:0}
.bd .inv-badge.bad{background:rgba(255,90,80,.16);color:#ffb3ad}
.bd .inv-badge.warn{background:rgba(255,159,28,.16);color:#ffd9a0}
.bd .inv-badge.ok{background:rgba(121,214,111,.16);color:#c9f7c3}
.bd .inventory-item-card.bad{border-color:#a8433d;background:linear-gradient(155deg,#2a1513,#140c0b)}
.bd .inventory-item-card.bad .inv-total{color:#ff8a80}
.bd .inventory-item-card.bad .inv-unit{color:#ff8a80;font-weight:850;letter-spacing:.03em}
.bd .inv-total small{font-size:.9rem;margin-left:5px;color:#bdc8b8}
.bd .inventory-rolls{display:flex;flex-wrap:wrap;gap:6px}
.bd-meter{height:8px;border-radius:0 4px 4px 0;background:#0b100b;overflow:hidden}
.bd-meter i{display:block;height:100%;background:#a9c93a;border-radius:0 4px 4px 0}
.bd-split{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;background:#0b100b}
.bd-split i{display:block;height:100%;min-width:2px}
.bd-split .n{background:#3a9f55}.bd-split .s{background:repeating-linear-gradient(45deg,#d9772b 0 6px,#b8611f 6px 9px)}
.bd-line{display:flex;justify-content:space-between;gap:10px;color:#bdc8b8;font-size:.74rem}
.bd-line b{color:#f0f4eb;white-space:nowrap}
.bd-tfilters{grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr)) repeat(2,minmax(0,1fr)) auto}
.bd-tfilters select{width:100%;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:9px 11px;font:500 .85rem Arial;outline:none;color-scheme:dark}
@media (max-width:1100px){.bd-tfilters{grid-template-columns:repeat(2,minmax(0,1fr))}.bd-tfilters label:first-child{grid-column:1/-1}}
.bd-note{margin:0;color:#8a9485;font-size:.78rem}
.bd-head-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.bd-switch{display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border:1px solid #46563f;border-radius:12px;background:#151d15;cursor:pointer;user-select:none}
.bd-switch input{position:absolute;opacity:0;width:0;height:0}
.bd-switch-text{display:grid;gap:1px;text-align:right}
.bd-switch-text b{color:#f0f4eb;font:800 .72rem Arial;letter-spacing:.05em;text-transform:uppercase}
.bd-switch-text small{font:700 .66rem Arial;letter-spacing:.04em;color:#ffb3ad}
.bd-switch-track{position:relative;display:block;width:46px;height:26px;border-radius:999px;background:#5a2723;border:1px solid #a8433d;transition:background .2s,border-color .2s}
.bd-switch-dot{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#f0f4eb;transition:transform .2s}
.bd-switch input:checked~.bd-switch-track{background:#2f7a3d;border-color:#79d66f}
.bd-switch input:checked~.bd-switch-track .bd-switch-dot{transform:translateX(20px)}
.bd-switch input:checked~.bd-switch-text small,.bd-switch:has(input:checked) small{color:#9fe0a8}
.bd-switch input:focus-visible~.bd-switch-track{outline:2px solid #d0f44c;outline-offset:2px}
.bd-switch.busy{opacity:.6;pointer-events:none}
.bd-home-sync{display:flex;justify-content:flex-end;margin:0 0 10px}
.bd-filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end;padding:14px 18px;border:1px solid #46563f;border-radius:18px;background:#111811}
.bd-filters label{display:grid;gap:5px;color:#aebba7;font:800 .64rem Arial;letter-spacing:.07em;text-transform:uppercase}
.bd-filters input{width:100%;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:9px 11px;font:500 .85rem Arial;outline:none;color-scheme:dark}
.bd-filters input:focus{border-color:#d0f44c}
.bd-clear{padding:9px 14px!important;border:1px solid #46563f!important;border-radius:9px!important;background:#151d15!important;color:#dfe8d9!important;font-weight:800;cursor:pointer;width:auto!important}
.bd-count{grid-column:1/-1;margin:0;color:#8a9485;font-size:.74rem}
.bd-count:empty{display:none}
@media (max-width:900px){.bd-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bd-filters label:first-child{grid-column:1/-1}}
@media (max-width:700px){.bd-cards{min-width:0!important;width:100%;max-width:100%}.bd-section,.bd-body{min-width:0;max-width:100%}.bd-cards>*{min-width:0;max-width:100%;overflow:hidden}.bd,.bd-filters{min-width:0;max-width:100%;box-sizing:border-box}.bd{overflow-x:clip}.bd-filters{padding:12px}.bd-filters label{min-width:0}.bd-filters input,.bd-filters input[type=date]{min-width:0;max-width:100%;width:100%;min-height:42px;font-size:16px;-webkit-appearance:none;appearance:none}.bd-filters input[type=date]{display:block;text-align:left}}
@media (max-width:520px){.bd-head{flex-direction:column;align-items:stretch}.bd-cards,.bd-cards.fit{grid-template-columns:minmax(0,1fr)}.bd-cards{min-width:0!important;width:100%;max-width:100%}.bd-section,.bd-body{min-width:0;max-width:100%}.bd-cards>*{min-width:0;max-width:100%;overflow:hidden}}
@media (max-width:700px){.bd .bd-tkpi.bd-cards.fit{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px}.bd .bd-tkpi .inventory-item-card{padding:12px!important}.bd .bd-tkpi .inv-total{font-size:1.25rem!important}.bd .bd-tkpi .inv-unit{font-size:.62rem!important;line-height:1.25}.bd .bd-tfilters{grid-template-columns:repeat(2,minmax(0,1fr))!important;padding:12px}.bd .bd-tfilters .bd-clear{grid-column:1/-1}.bd .bd-tfilters label:first-child{grid-column:1/-1}.bd .bd-tfilters input,.bd .bd-tfilters select{min-width:0;font-size:16px}.bd .bd-tcards.bd-cards{gap:10px}.bd .bd-tcards .inventory-item-card .bd-line b{white-space:normal;text-align:right;overflow-wrap:anywhere}.bd-head h2{font-size:.95rem}}
@media (max-width:340px){.bd .bd-tkpi.bd-cards.fit{grid-template-columns:minmax(0,1fr)!important}}
`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'bodega-dashboard';
  panel.innerHTML = '<div class="bd"><div class="bd-head"><div><h2>Panel de control · Stock tela</h2><p class="bd-updated">Cargando…</p></div><div class="bd-head-actions"><label class="bd-switch" title="Conecta o desvincula el inventario del Google Sheets"><span class="bd-switch-text"><b>Inventario</b><small data-bd-link-state>Cargando…</small></span><input type="checkbox" role="switch" data-bd-link><i class="bd-switch-track"><i class="bd-switch-dot"></i></i></label><button type="button" class="bd-refresh">Actualizar</button></div></div>' +
    '<nav class="dash-tabs bd-subtabs" role="tablist" aria-label="Secciones del panel de control"><button type="button" role="tab" class="on" data-bd-tab="resumen" aria-selected="true">Resumen</button><button type="button" role="tab" data-bd-tab="tela" aria-selected="false">Tela programada</button></nav>' +
    '<form class="bd-filters" autocomplete="off" onsubmit="return false"><label>Nombre tela<input name="tela" type="search" list="bd-telas" placeholder="Ej. MONTECATINI"><datalist id="bd-telas"></datalist></label><label>Código tela<input name="codigo" type="search" inputmode="numeric" placeholder="Ej. 100"></label><label>Fecha desde<input name="desde" type="date"></label><label>Fecha hasta<input name="hasta" type="date"></label><button type="button" class="bd-clear">Limpiar</button><p class="bd-count"></p></form>' +
    '<div class="bd-body"></div><div class="bd-body2" hidden></div></div>';
  const body = panel.querySelector('.bd-body');
  body.style.display = 'grid';
  body.style.gap = '26px';

  const circles = (values, states) => values && values.length ? '<div class="inventory-rolls">' + values.map((value, index) => '<span class="inventory-roll ' + (states?.[index] === 'started' ? 'roll-started' : 'roll-new') + '">' + esc(num(value)) + '</span>').join('') + '</div>' : '';
  const codes = names => names.map(name => (String(name).match(/^\s*\(([^)]+)\)/) || [])[1]).filter(Boolean);
  const card = ({badge, badgeClass = '', name, total, unit, extra = '', cls = '', title = '', telas = null, fecha = '', level = null, tone = 'verde'}) =>
    '<article class="inventory-item-card ' + cls + '"' + (level !== null ? ' data-lq="' + Math.max(0, Math.min(100, Math.round(level))) + '" data-lq-tone="' + tone + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') +
      (telas ? ' data-tela="' + esc(norm(telas.join(' | '))) + '" data-codigo="' + esc(codes(telas).join('|')) + '"' : ' data-sinfiltro="true"') + (fecha ? ' data-fecha="' + esc(day(fecha)) + '"' : '') + '><span class="inv-badge ' + badgeClass + '">' + esc(badge) + '</span><strong class="inv-name">' + esc(name) + '</strong>' + extra + '<span class="inv-total">' + total + '</span>' + (unit ? '<span class="inv-unit">' + esc(unit) + '</span>' : '') + '</article>';
  const section = (title, note, cards, fit) => '<section class="bd-section"' + (fit ? ' data-fijo="true"' : '') + '><h3>' + esc(title) + (note ? ' <small>· ' + esc(note) + '</small>' : '') + '</h3>' + (cards ? '<div class="bd-cards' + (fit ? ' fit' : '') + '">' + cards + '</div>' : '') + '</section>';
  const meter = (value, max) => '<div class="bd-meter"><i style="width:' + Math.max(1, value / (max || 1) * 100) + '%"></i></div>';

  const render = data => {
    const k = data.kpis, sub = data.sublimacion, mov = data.movimientos, con = data.consumos;
    const split = (k.mts_nuevos + k.mts_empezados) || 1;
    const alerts = sub.no_alcanzan + (data.listas_no_alcanzan || 0);
    panel.querySelector('.bd-updated').textContent = 'Inventario leído del Sheet: ' + when(data.updated_at);
    const resumen =
      card({badge: 'Stock tela', name: 'Metros en bodega', total: num(k.mts) + '<small>MTS</small>', unit: 'Suma de todas las telas · ' + num(k.mts_nuevos) + ' en rollos nuevos', level: k.mts_nuevos / split * 100, tone: 'azul'}) +
      card({badge: 'Telas', name: 'Telas con stock', total: num(k.telas_con_stock) + '<small>de ' + num(k.telas) + '</small>', unit: num(k.telas_sin_stock) + ' telas en cero', extra: meter(k.telas_con_stock, k.telas), level: k.telas ? k.telas_con_stock / k.telas * 100 : 0, tone: 'verde'}) +
      card({badge: 'Rollos', name: 'Rollos en bodega', total: num(k.rollos), level: k.rollos ? k.rollos_nuevos / k.rollos * 100 : 0, tone: 'teal', unit: num(k.rollos_nuevos) + ' nuevos · ' + num(k.rollos_empezados) + ' empezados',
        extra: '<div class="bd-split" role="img" aria-label="Nuevos ' + num(k.mts_nuevos) + ' MTS, empezados ' + num(k.mts_empezados) + ' MTS"><i class="n" style="width:' + (k.mts_nuevos / split * 100) + '%" title="Nuevos: ' + num(k.mts_nuevos) + ' MTS"></i><i class="s" style="width:' + (k.mts_empezados / split * 100) + '%" title="Empezados: ' + num(k.mts_empezados) + ' MTS"></i></div>' +
          '<div class="inventory-rolls"><span class="inventory-roll roll-new">' + num(k.rollos_nuevos) + '</span><span class="bd-line" style="align-self:center">Nuevos · ' + num(k.mts_nuevos) + ' MTS</span></div><div class="inventory-rolls"><span class="inventory-roll roll-started">' + num(k.rollos_empezados) + '</span><span class="bd-line" style="align-self:center">Empezados · ' + num(k.mts_empezados) + ' MTS</span></div>'}) +
      card({badge: 'Sublimación', name: 'Reservado para Sublimación', total: num(sub.mts) + '<small>MTS</small>', unit: num(sub.ordenes) + ' órdenes en curso', level: k.mts ? sub.mts / k.mts * 100 : 0, tone: 'violeta'}) +
      card({badge: alerts ? 'Atención' : 'Al día', badgeClass: alerts ? 'bad' : 'ok', cls: alerts ? 'bad' : '', level: alerts ? Math.min(100, alerts / Math.max(1, sub.ordenes + (data.listas || []).length) * 100) : 0, tone: alerts ? 'rojo' : 'verde', name: 'Órdenes que no alcanzan', total: num(alerts), unit: alerts ? num(sub.no_alcanzan) + ' en Sublimación · ' + num(data.listas_no_alcanzan || 0) + ' con Edición finalizada' : 'Todas las órdenes alcanzan'}) +
      card({badge: 'Consumo', name: 'Consumido en Sublimación', total: num(con.mts_30d) + '<small>MTS</small>', unit: 'Últimos 30 días · ' + num(con.ordenes_30d) + ' órdenes', level: (con.mts_30d + k.mts) ? con.mts_30d / (con.mts_30d + k.mts) * 100 : 0, tone: 'ambar'});

    const maxTop = data.top[0]?.mts || 1;
    const top = data.top.map((row, index) => card({badge: 'Top ' + (index + 1), telas: [row.nombre], name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados) + meter(row.mts, maxTop)})).join('');

    const orderCard = row => !row.encontrada
      ? card({badge: 'Tela no encontrada', badgeClass: 'bad', cls: 'bad', name: row.label, total: num(row.mts) + '<small>MTS</small>', telas: [row.tela], fecha: row.fecha,
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + 'Tela en producción: ' + (row.tela || 'sin tela') + ' · no hay una tela con ese nombre en Bodega'})
      : card({badge: row.short ? 'No alcanza' : 'Alcanza', badgeClass: row.short ? 'bad' : 'ok', cls: row.short ? 'bad' : '', name: row.label, telas: [row.tela, ...row.telas], fecha: row.fecha,
          total: row.short ? num(row.missing) + '<small>MTS FALTAN</small>' : num(row.mts) + '<small>MTS</small>',
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + (row.short ? 'Necesita ' + num(row.mts) + ' MTS · ' : '') + (row.telas.length ? row.telas.join(', ') + ' · ' : '') + rolls(row.rollos), extra: circles(row.valores, row.estados)});
    const readyCard = row => !row.encontrada ? orderCard(row)
      : card({badge: row.short ? 'No alcanza' : 'Alcanza', badgeClass: row.short ? 'bad' : 'ok', cls: row.short ? 'bad' : '', name: row.label,
          total: row.short ? num(row.missing) + '<small>MTS FALTAN</small>' : num(row.mts) + '<small>MTS</small>',
          telas: [row.tela, ...row.telas], fecha: row.fecha,
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + 'Disponible ' + num(row.disponible) + ' MTS · ' + row.telas.join(', ')});
    const orders = sub.lista.map(orderCard).join('');
    const ready = (data.listas || []).slice().sort((a, b) => (b.short - a.short)).map(readyCard).join('');

    const low = data.bajo_stock.map(row => card({badge: 'Bajo stock', badgeClass: 'warn', telas: [row.nombre], name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados)})).join('') +
      data.sin_stock.map(name => card({badge: 'Sin stock', badgeClass: 'bad', telas: [name], name, total: '0<small>MTS</small>', unit: '0 rollos'})).join('');

    const maxSupplier = data.proveedores[0]?.mts || 1;
    const suppliers = data.proveedores.filter(row => row.mts > 0).map(row => card({badge: 'Proveedor', telas: ((data.proveedores_telas || {})[row.nombre] || []).map(pair => pair[0]), name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: num(row.telas) + (row.telas === 1 ? ' tela · ' : ' telas · ') + Math.round(row.mts / (k.mts || 1) * 100) + '% de la bodega',
      extra: meter(row.mts, maxSupplier) + ((data.proveedores_telas || {})[row.nombre] || []).map(([name, mts]) => '<div class="bd-line"><span>' + esc(name) + '</span><b>' + num(mts) + ' MTS</b></div>').join('')})).join('');

    const activity =
      card({badge: 'Ingresos web', badgeClass: 'ok', name: num(mov.ingresos) + ' ingresos registrados', total: num(mov.ingresos_mts) + '<small>MTS</small>', unit: num(data.documentos) + ' documentos de entrega'}) +
      card({badge: 'Salidas web', badgeClass: 'warn', name: num(mov.salidas) + ' salidas registradas', total: num(mov.salidas_mts) + '<small>MTS</small>', unit: 'Desde el formulario SALIDA'}) +
      mov.ultimos.map(row => card({badge: row.tipo === 'INGRESO' ? 'Ingreso' : 'Salida', badgeClass: row.tipo === 'INGRESO' ? 'ok' : 'warn', telas: [row.nombre], fecha: row.fecha, name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + ' · ' + rolls(row.rollos) + (row.origen ? ' · ' + row.origen : '')})).join('') +
      con.ultimos.map(row => card({badge: 'Consumo Sublimación', telas: row.telas, fecha: row.fecha, name: 'Orden ' + row.orden, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + (row.telas.length ? ' · ' + row.telas.join(', ') : '')})).join('');

    body.innerHTML =
      section('Resumen', '', resumen, true) +
      section('Lista para imprimir', 'Edición finalizada · ' + num((data.listas || []).length) + ' referencias · se revisa si alcanza la tela', ready || '') + (ready ? '' : '<p class="bd-note">No hay referencias con Edición finalizada pendientes de Sublimación.</p>') +
      section('Sublimación en curso', num(sub.ordenes) + ' órdenes', orders || '') + (orders ? '' : '<p class="bd-note">No hay órdenes en Sublimación (P).</p>') +
      section('Bajo stock', 'menos de ' + num(data.umbral_bajo) + ' MTS', low || '') + (low ? '' : '<p class="bd-note">Ninguna tela por debajo del umbral.</p>') +
      section('Top 10 telas con más metros', '', top) +
      section('Metros por proveedor', '', suppliers) +
      section('Movimientos', 'ingresos, salidas y consumos', activity);
    panel.querySelector('#bd-telas').innerHTML = (data.telas || []).map(name => '<option value="' + esc(name) + '"></option>').join('');
    applyFilters();
  };

  const filters = panel.querySelector('.bd-filters');
  const applyFilters = () => {
    const typed = filters.elements.tela.value;
    const tela = norm(typed).replace(/^\([^)]*\)\s*/, '');
    const typedCode = (typed.match(/^\s*\(([^)]+)\)/) || [])[1] || '';
    const codigo = norm(filters.elements.codigo.value).replace(/[()]/g, '') || norm(typedCode);
    const desde = filters.elements.desde.value, hasta = filters.elements.hasta.value;
    const active = Boolean(tela || codigo || desde || hasta);
    let shown = 0;
    body.querySelectorAll('.bd-section').forEach(sectionNode => {
      if (sectionNode.dataset.fijo) return;
      let visible = 0;
      sectionNode.querySelectorAll('.inventory-item-card').forEach(cardNode => {
        let ok = !active;
        if (active && !cardNode.dataset.sinfiltro) {
          const fecha = cardNode.dataset.fecha || '';
          ok = (!tela || (cardNode.dataset.tela || '').includes(tela))
            && (!codigo || (cardNode.dataset.codigo || '').split('|').includes(codigo))
            && (!(desde || hasta) || (fecha && (!desde || fecha >= desde) && (!hasta || fecha <= hasta)));
        }
        cardNode.style.display = ok ? '' : 'none';
        if (ok) visible += 1;
      });
      sectionNode.style.display = active && !visible ? 'none' : '';
      shown += visible;
    });
    body.querySelectorAll(':scope > .bd-note').forEach(note => { note.style.display = active ? 'none' : ''; });
    panel.querySelector('.bd-count').textContent = active ? (shown ? shown + (shown === 1 ? ' tarjeta coincide' : ' tarjetas coinciden') + ' con el filtro.' : 'Nada coincide con el filtro.') : '';
  };
  filters.addEventListener('input', applyFilters);
  panel.querySelector('.bd-clear').onclick = () => { filters.reset(); applyFilters(); };

  const load = async () => {
    if (typeof showLink === 'function') showLink();
    body.innerHTML = '<p class="bd-note">Cargando estadísticas…</p>';
    try {
      const response = await fetch('/api/inventarios/dashboard', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar el dashboard');
      render(data);
    } catch (error) { body.innerHTML = '<p class="bd-note">' + esc(error.message) + '</p>'; }
  };
  panel.querySelector('.bd-refresh').onclick = load;
  const linkSwitch = panel.querySelector('[data-bd-link]'), linkState = panel.querySelector('[data-bd-link-state]'), linkBox = linkSwitch.closest('.bd-switch');
  const showLink = async () => {
    try {
      const status = await (await fetch('/api/inventarios/vinculo', {cache: 'no-store'})).json();
      linkSwitch.checked = !!status.vinculado;
      linkState.textContent = status.vinculado ? 'CONECTADO' : 'DESVINCULADO';
    } catch (_) { linkState.textContent = 'sin estado'; }
  };
  linkSwitch.addEventListener('change', async () => {
    const wantLinked = linkSwitch.checked;
    if (wantLinked && !confirm('Al CONECTAR el Inventario se iguala todo al Google Sheets: los ingresos, salidas y descuentos de prueba hechos en la web se descartan (se guarda copia). ¿Conectar y igualar?')) { linkSwitch.checked = false; return; }
    linkBox.classList.add('busy');
    linkState.textContent = wantLinked ? 'Conectando…' : 'Desvinculando…';
    try {
      const response = await fetch('/api/inventarios/vinculo', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vinculado: wantLinked})});
      if (!response.ok) throw Error('No se pudo cambiar el vínculo');
    } catch (error) { alert(error.message); }
    linkBox.classList.remove('busy');
    await showLink();
    if (wantLinked) fetch('/api/inventarios?refresh=true', {cache: 'no-store'}).catch(() => {});
    load();
  });
  showLink();

  // Producción · Sheets: interruptor en INICIO (pedidos, estados y MTS REQUERIDOS desde el Sheet de Producción).
  const homeRow = document.createElement('div');
  homeRow.className = 'bd-home-sync';
  homeRow.innerHTML = '<label class="bd-switch" title="Conecta o desvincula Producción (pedidos y MTS REQUERIDOS) del Google Sheets"><span class="bd-switch-text"><b>Producción</b><small data-bd-prod-state>Cargando…</small></span><input type="checkbox" role="switch" data-bd-prod><i class="bd-switch-track"><i class="bd-switch-dot"></i></i></label>';
  const prodSwitch = homeRow.querySelector('[data-bd-prod]'), prodState = homeRow.querySelector('[data-bd-prod-state]'), prodBox = homeRow.querySelector('.bd-switch');
  const showProd = async () => {
    try {
      const status = await (await fetch('/api/produccion/sheets-sync/estado', {cache: 'no-store'})).json();
      prodSwitch.checked = !!status.enabled;
      prodState.textContent = status.enabled ? (status.resync ? 'Igualando con el Sheet…' : 'CONECTADO') : 'DESVINCULADO';
      return status;
    } catch (_) { prodState.textContent = 'sin estado'; }
  };
  prodSwitch.addEventListener('change', async () => {
    const wantLinked = prodSwitch.checked;
    if (wantLinked && !confirm('Al CONECTAR Producción se iguala todo al Google Sheets: estados, fechas y MTS. Lo que se haya cambiado solo en la web y no esté en el Sheet SE PIERDE (se guarda una copia de seguridad antes). ¿Conectar y igualar?')) { prodSwitch.checked = false; return; }
    prodBox.classList.add('busy');
    prodState.textContent = wantLinked ? 'Conectando…' : 'Desvinculando…';
    try {
      const response = await fetch('/api/produccion/sheets-sync/' + (wantLinked ? 'activar' : 'desactivar'), {method: 'POST'});
      if (!response.ok) throw Error('No se pudo cambiar el vínculo de Producción');
    } catch (error) { alert(error.message); }
    // Al volver a conectar se iguala todo al Google Sheets: se espera a que termine (máx. ~90 s).
    for (let i = 0; i < 45; i++) {
      const status = await showProd();
      if (!status || !status.resync) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    prodBox.classList.remove('busy');
    await showProd();
  });
  const mountHome = () => {
    if (homeRow.isConnected) return;
    const dash = document.getElementById('home-dashboard');
    if (dash?.parentElement) { dash.parentElement.insertBefore(homeRow, dash); showProd(); }
  };
  mountHome();
  new MutationObserver(mountHome).observe(document.body, {childList: true, subtree: true});
  setInterval(() => { if (homeRow.offsetParent) showProd(); }, 30000);


  // ---- Sub-pestaña «Tela programada»: la tela que piden los pedidos programados (promedio general del maestro × cantidad) frente a Bodega ----
  const body2 = panel.querySelector('.bd-body2');
  const filtersBox = panel.querySelector('.bd-filters:not(.bd-tfilters)');
  let subTab = 'resumen';
  body2.style.display = 'grid';
  body2.style.gap = '22px';
  body2.innerHTML =
    '<div class="bd-cards fit bd-tkpi"></div>' +
    '<form class="bd-filters bd-tfilters" autocomplete="off" onsubmit="return false">' +
      '<label>Buscar<input name="q" type="search" placeholder="Orden, cliente, referencia o tela"></label>' +
      '<label>Tela<select name="tela"><option value="">Todas</option></select></label>' +
      '<label>Estado<select name="sit"><option value="">Todos</option><option value="alcanza">Alcanza</option><option value="no_alcanza">No alcanza</option><option value="sin_tela">Tela no encontrada</option><option value="sin_promedio">Sin promedio</option></select></label>' +
      '<label>Sublimación<select name="sub"><option value="">Todas</option><option value="P">En Sublimación</option><option value="pend">Por entrar</option></select></label>' +
      '<label>Entrega desde<input name="desde" type="date"></label><label>Entrega hasta<input name="hasta" type="date"></label>' +
      '<button type="button" class="bd-clear">Limpiar</button><p class="bd-count"></p></form>' +
    '<div class="bd-cards bd-tcards"><p class="bd-note">Calculando la tela de los pedidos…</p></div>';
  const tFilters = body2.querySelector('.bd-tfilters'), tCards = body2.querySelector('.bd-tcards'), tKpi = body2.querySelector('.bd-tkpi');
  const SITUACION = {alcanza: ['Alcanza', 'ok'], no_alcanza: ['No alcanza', 'bad'], sin_tela: ['Tela no encontrada', 'bad'], sin_promedio: ['Sin promedio', 'warn']};
  const filterTela = () => {
    const f = tFilters.elements, q = norm(f.q.value), desde = f.desde.value, hasta = f.hasta.value;
    let shown = 0;
    tCards.querySelectorAll('.inventory-item-card').forEach(node => {
      const d = node.dataset, fecha = d.fecha || '';
      const ok = (!q || (d.q || '').includes(q)) && (!f.tela.value || d.tela === f.tela.value) && (!f.sit.value || d.sit === f.sit.value)
        && (!f.sub.value || d.sub === f.sub.value) && (!desde || (fecha && fecha >= desde)) && (!hasta || (fecha && fecha <= hasta));
      node.hidden = !ok;
      if (ok) shown += 1;
    });
    const total = tCards.querySelectorAll('.inventory-item-card').length;
    body2.querySelector('.bd-count').textContent = total ? shown + ' de ' + total + (total === 1 ? ' orden' : ' órdenes') : '';
    let vacio = tCards.querySelector('.bd-vacio');
    if (total && !shown) { if (!vacio) tCards.insertAdjacentHTML('beforeend', '<p class="bd-note bd-vacio">Ninguna orden coincide con los filtros.</p>'); }
    else vacio?.remove();
  };
  const renderTela = data => {
    if (data.disponible === false) { tKpi.innerHTML = ''; tCards.innerHTML = '<p class="bd-note">No se pudo leer Producción para calcular la tela necesaria.</p>'; return; }
    const ordenes = data.ordenes || [];
    tKpi.innerHTML = card({badge: data.telas_no_alcanzan ? 'Atención' : 'Al día', badgeClass: data.telas_no_alcanzan ? 'bad' : 'ok', cls: data.telas_no_alcanzan ? 'bad' : '',
      level: data.mts ? Math.max(0, 100 - data.faltan / data.mts * 100) : 100, tone: data.telas_no_alcanzan ? 'rojo' : 'verde', name: 'Tela necesaria programada',
      total: num(data.mts) + '<small>MTS</small>', unit: num(data.pedidos) + ' pedidos en ' + num((data.telas || []).length) + ' telas · ' + (data.telas_no_alcanzan ? num(data.telas_no_alcanzan) + ' telas no alcanzan · faltan ' + num(data.faltan) + ' MTS' : 'toda la tela alcanza')}) +
      (data.telas || []).map(t => card({badge: !t.encontrada ? 'Tela no encontrada' : t.alcanza ? 'Alcanza' : 'No alcanza', badgeClass: t.alcanza ? 'ok' : 'bad', cls: t.alcanza ? '' : 'bad',
        level: t.encontrada ? Math.min(100, t.disponible / (t.mts || 1) * 100) : 0, tone: t.alcanza ? 'verde' : 'rojo', name: t.tela, total: num(t.mts) + '<small>MTS</small>',
        unit: t.pedidos.length + (t.pedidos.length === 1 ? ' pedido' : ' pedidos') + ' · ' + (t.encontrada ? 'Bodega ' + num(t.disponible) + ' MTS' + (t.alcanza ? '' : ' · FALTAN ' + num(t.faltan)) : 'no está en Bodega')})).join('');
    const telas = [...new Set(ordenes.map(o => o.tela))].sort();
    const selTela = tFilters.elements.tela, actual = selTela.value;
    selTela.innerHTML = '<option value="">Todas</option>' + telas.map(t => '<option value="' + esc(t) + '"' + (t === actual ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
    const orderCard = o => {
      const [label, cls] = SITUACION[o.situacion] || ['', ''];
      const sinPromedio = o.situacion === 'sin_promedio';
      const level = sinPromedio ? null : o.situacion === 'alcanza' ? 100 : o.mts ? Math.min(100, (o.disponible || 0) / o.mts * 100) : 0;
      const html = card({
        badge: o.orden, badgeClass: cls, cls: cls === 'bad' ? 'bad' : '', level, tone: o.situacion === 'alcanza' ? 'verde' : 'rojo',
        name: o.tela,
        total: sinPromedio ? 'Sin promedio' : num(o.mts) + '<small>MTS</small>',
        unit: o.situacion === 'no_alcanza' ? 'NO ALCANZA · FALTAN ' + num(o.falta) + ' MTS' : o.situacion === 'sin_tela' ? 'NO ALCANZA · LA TELA NO ESTÁ EN BODEGA' : '',
        extra: '<div class="bd-line"><span>Cliente</span><b>' + esc(o.cliente || 'Sin cliente') + '</b></div>' +
          '<div class="bd-line"><span>Proyecto</span><b>' + esc(o.proyecto || 'Sin proyecto') + '</b></div>' +
          '<div class="bd-line"><span>Referencia</span><b>' + esc(o.referencia) + '</b></div>' +
          '<div class="bd-line"><span>Entrega</span><b>' + (o.entrega ? esc(shortDay(o.entrega)) : 'Sin fecha') + '</b></div>'});
      const attrs = ' data-q="' + esc(norm([o.orden, o.cliente, o.proyecto, o.referencia, o.tela].join(' '))) + '" data-tela="' + esc(o.tela) + '" data-sit="' + o.situacion + '" data-sub="' + (o.estado === 'P' ? 'P' : 'pend') + '" data-fecha="' + esc(o.entrega || '') + '" data-sinfiltro="false"';
      return html.replace('<article ', '<article' + attrs + ' ');
    };
    tCards.innerHTML = ordenes.length ? ordenes.map(orderCard).join('') : '<p class="bd-note">No hay pedidos programados pendientes de Sublimación.</p>';
    filterTela();
  };
  tFilters.addEventListener('input', filterTela);
  tFilters.querySelector('.bd-clear').onclick = () => { tFilters.reset(); filterTela(); };
  const load2 = async (silencioso) => {
    try {
      const response = await fetch('/api/inventarios/tela-necesaria', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible calcular la tela necesaria');
      panel.querySelector('.bd-updated').textContent = 'Tela calculada: ' + when(new Date().toISOString()) + ' · se actualiza sola cada minuto';
      renderTela(data);
    } catch (error) { if (!silencioso) tCards.innerHTML = '<p class="bd-note">' + esc(error.message) + '</p>'; }
  };
  const showSubTab = name => {
    subTab = name;
    panel.querySelectorAll('[data-bd-tab]').forEach(b => { const on = b.dataset.bdTab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    body.hidden = name !== 'resumen';
    filtersBox.hidden = name !== 'resumen';
    body2.hidden = name !== 'tela';
    if (name === 'tela') load2(false); else load();
  };
  panel.addEventListener('click', event => { const tab = event.target.closest('[data-bd-tab]'); if (tab) showSubTab(tab.dataset.bdTab); });
  setInterval(() => { if (!document.hidden && panel.classList.contains('active') && subTab === 'tela') load2(true); }, 60000);

  const open = (button, destino = panel, cargar = () => (subTab === 'tela' ? load2(false) : load())) => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === destino));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    cargar();
  };

  const mount = () => {
    if (document.querySelector('[data-bodega-dashboard]')) return true;
    const group = [...document.querySelectorAll('.nav-group')].find(item => /INVENTARIOS/i.test(item.querySelector('.nav-parent')?.textContent || ''));
    const children = group?.querySelector('.nav-children');
    const main = document.querySelector('main');
    if (!children || !main) return false;
    main.appendChild(panel);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab inventory-control-nav';
    button.dataset.bodegaDashboard = 'true';
    button.innerHTML = '<span class="nav-icon">PC</span><strong>PANEL DE CONTROL</strong>';
    button.onclick = () => open(button);
    children.prepend(button);
    return true;
  };
  if (!mount()) { const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 300); setTimeout(() => clearInterval(timer), 15000); }
})();
