/* Production cards: derived presentation only. Operational writes remain in the existing API. */
(function () {
  'use strict';
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const personKey = value => key(value).replace(/[^A-Z0-9]/g, '');
  const flow = typeof indoorProcessFlow !== 'undefined' ? indoorProcessFlow : require('./process-flow.json');
  function dateValue(value) {
    const raw = key(value).toLowerCase().replaceAll('.', '');
    const parts = raw.split(/[-/ ]+/);
    if (parts.length !== 3) return null;
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    let day = Number(parts[0]), year = Number(parts[2]);
    let month = /^\d+$/.test(parts[1]) ? Number(parts[1]) - 1 : months.indexOf(parts[1].slice(0, 3));
    if (/^\d{4}$/.test(parts[0])) { year = Number(parts[0]); day = Number(parts[2]); }
    if (year < 100) year += 2000;
    const date = new Date(year, month, day);
    return Number.isInteger(day) && month >= 0 && month < 12 && date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }
  function groupsFor(data, row, statusHeaders) {
    const statuses = new Set([...statusHeaders, ...flow.flatMap(p => p.headers), 'CORTE TEXTIL', 'CORTE TEXTIL/PLT'].map(key));
    const groups = flow.map(process => {
      const statusColumns = process.headers.flatMap(h => data.headers.flatMap((header, i) => key(header) === h ? [i] : []));
      const columns = new Set();
      for (const start of statusColumns) {
        columns.add(start);
        for (let i = start + 1; i < data.headers.length && data.groups[i] === data.groups[start]; i++) {
          if (statuses.has(key(data.headers[i]))) break;
          columns.add(i);
        }
      }
      return { key: key(process.label), label: process.label, start: statusColumns[0], columns: [...columns].sort((a,b) => a-b), statusColumns };
    }).filter(group => group.statusColumns.length);
    return groups.map(group => {
      const values = group.statusColumns.map(i => key(row.values[i]));
      const closed = values.map(v => v === 'N/A' || !!dateValue(v));
      group.state = values.includes('R') ? 'rework' : values.includes('P') ? 'active' : values.length && closed.every(Boolean) ? 'finished' : closed.some(Boolean) ? 'partial' : 'pending';
      group.autoClosed = ['partial', 'pending'].includes(group.state) && (data.auto_closed || []).includes(row.source_row + ':' + (group.start + 1));
      if (group.autoClosed) group.state = 'finished';
      group.status = group.autoClosed ? 'Cierre automático' : group.state === 'finished' ? values.length && values.every(v => v === 'N/A') ? 'No aplica' : 'Terminado' : ({ active: 'En proceso', rework: 'Reproceso', partial: 'Avance parcial', pending: 'Pendiente' })[group.state];
      group.responsible = group.columns.filter(i => key(data.headers[i]).startsWith('RESP') || key(data.headers[i]) === 'CONFECCIONISTA').map(i => String(row.values[i] || '').trim()).filter(Boolean).join(', ');
      if (!group.responsible) group.responsible = group.statusColumns.map(i => data.process_responsibles?.[row.source_row + ':' + (i+1)]).filter(Boolean)[0] || '';
      return group;
    });
  }
  function summarize(data, row, statusHeaders, user, today) {
    const groups = groupsFor(data, row, statusHeaders);
    const finished = groups.filter(g => g.state === 'finished').length;
    const state = groups.some(g => g.state === 'rework') ? 'rework' : groups.some(g => g.state === 'active') ? 'active' : groups.length && finished === groups.length ? 'finished' : 'pending';
    const focus = groups.find(g => g.state === 'rework') || [...groups].reverse().find(g => g.state === 'active') || groups.find(g => g.state !== 'finished') || groups[groups.length - 1];
    const userTokens = [user.name, user.initials].map(personKey).filter(Boolean);
    const mine = groups.some(g => g.responsible.split(/[,;·\n]+/).some(name => userTokens.includes(personKey(name))));
    const dueIndex = data.headers.findIndex(h => key(h) === 'FECHA DE ENTREGA'), due = dateValue(row.values[dueIndex]);
    const overdue = !!due && due < today && state !== 'finished';
    return { groups, finished, total: groups.length, state, focus, mine, due, overdue, percent: groups.length ? Math.round(finished / groups.length * 100) : 0 };
  }
  function matches(summary, filter) {
    return filter === 'all' || filter === 'work' && summary.mine && summary.state !== 'finished' || filter === 'mine' && summary.mine || filter === 'late' && summary.overdue || filter === summary.state;
  }
  function orderByDelivery(rows, headers) {
    const column = headers.findIndex(h => key(h) === 'FECHA DE ENTREGA');
    return rows.map((row, index) => ({ row, index, due: dateValue(row.values[column])?.getTime() ?? Infinity }))
      .sort((a, b) => a.due === b.due ? a.index - b.index : a.due < b.due ? -1 : 1).map(item => item.row);
  }
  function addBusinessDays(date, count) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let remaining = count;
    while (remaining > 0) {
      result.setDate(result.getDate() + 1);
      const weekday = result.getDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return result;
  }
  function formatShortDate(date) {
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return String(date.getDate()).padStart(2, '0') + '-' + months[date.getMonth()] + '-' + String(date.getFullYear()).slice(-2);
  }
  function applyDefaultDeliveryDates(data, today = new Date()) {
    const column = data.headers.findIndex(h => key(h) === 'FECHA DE ENTREGA');
    if (column < 0) return data;
    const fallback = formatShortDate(addBusinessDays(today, 15));
    data.rows = data.rows.map(row => {
      if (dateValue(row.values[column])) return row;
      const values = [...row.values];
      values[column] = fallback;
      return { ...row, values };
    });
    return data;
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { key, dateValue, groupsFor, summarize, matches, orderByDelivery, addBusinessDays, applyDefaultDeliveryDates }; return; }
  if (typeof traceCards === 'undefined') return;

  const originalOpenProduction = openOperatorProduction;
  openOperatorProduction = function(id) {
    originalOpenProduction(id);
    const area = key(document.querySelector('.user-info small')?.textContent);
    const groups = groupsFor(productionData, productionData.rows.find(r => r.source_row === id), processStatusHeaders);
    operatorForm.elements.column.innerHTML = '<option value="">Selecciona un proceso</option>' + groups.map(g => '<option value="' + (g.start+1) + '">' + esc(g.label) + '</option>').join('');
    const process = flow.find(p => [key(p.label), ...p.headers, ...p.aliases].includes(area));
    const selected = groups.find(g => g.label === process?.label);
    if (selected) operatorForm.elements.column.value = String(selected.start+1);
    operatorSelection();
    operatorDialog.querySelector('.operator-message').textContent = selected ? 'Proceso seleccionado según tu perfil. La fecha y hora se guardan automáticamente.' : 'Selecciona uno de los procesos de Indoor.';
  };
  updateProcessFilter = function() {
    const labels = new Map(flow.map(p => [key(p.label), p.label]));
    if (!labels.has(selectedProcess)) selectedProcess = '';
    const signature = JSON.stringify([...labels]);
    if (productionProcess.dataset.signature !== signature) {
      productionProcess.replaceChildren(new Option('Todos los procesos', ''));
      labels.forEach((label, id) => productionProcess.add(new Option(label, id)));
      productionProcess.dataset.signature = signature;
    }
    productionProcess.value = selectedProcess;
  };
  processColumnVisible = function(column) {
    if (!selectedProcess || column.sourceIndex <= fixedDeliveryIndex()) return true;
    return groupsFor(productionData, {values: []}, processStatusHeaders).find(g => g.key === selectedProcess)?.columns.includes(column.sourceIndex) || false;
  };

  // Reapply after each fetch/edit, without writing dates or database row positions.
  const renderProductionOriginal = renderProduction;
  renderProduction = function () {
    if (productionData) {
      applyDefaultDeliveryDates(productionData);
      productionData.rows = orderByDelivery(productionData.rows, productionData.headers);
    }
    return renderProductionOriginal();
  };

  const labels = { pending: 'Pendiente', active: 'En proceso', rework: 'Reproceso', finished: 'Terminado', partial: 'Avance parcial' };
  const filters = [['all', 'Todos'], ['work', 'Mi trabajo del día'], ['mine', 'Mis pedidos'], ['late', 'Atrasados'], ['active', 'En proceso'], ['rework', 'Reproceso'], ['finished', 'Terminados']];
  let filter = 'all';
  const user = { name: document.querySelector('.user-info strong')?.textContent || '', initials: document.querySelector('.user-avatar')?.textContent || '' };
  const toolbar = document.createElement('section');
  toolbar.className = 'trace-workspace';
  toolbar.setAttribute('aria-label', 'Filtros de trazabilidad');
  toolbar.innerHTML = '<div class="trace-workspace-top"><div><h3>Pedidos en seguimiento</h3></div><span class="trace-live">Actualización automática</span></div><div class="trace-quick-filters" role="group" aria-label="Estado de los pedidos">' + filters.map(([id, label]) => '<button type="button" data-trace-filter="' + id + '" aria-pressed="' + (id === 'all') + '">' + label + '<span>0</span></button>').join('') + '</div><p class="trace-results" role="status" aria-live="polite"></p>';
  traceCards.before(toolbar);
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-trace-filter]'); if (!button) return;
    filter = button.dataset.traceFilter; traceCards.scrollTop = 0; renderTraceCards();
  });
  const nodeDialog = document.createElement('dialog');
  nodeDialog.className = 'trace-node-dialog';
  nodeDialog.setAttribute('aria-labelledby', 'trace-node-heading');
  nodeDialog.innerHTML = '<button type="button" class="trace-node-close" aria-label="Cerrar proceso">×</button><div class="trace-node-content"></div>';
  document.body.appendChild(nodeDialog);
  nodeDialog.querySelector('.trace-node-close').onclick = () => nodeDialog.close();
  const abbreviations = { 'MATERIALES': 'MAT', 'DISENO': 'DIS', 'EDICION': 'EDI', 'IMPRESION': 'IMP', 'SUBLIMACION': 'SUB', 'CORTE LASER': 'LAS', 'APLIQUE': 'APL', 'INSUMOS': 'INS', 'CONFECCION': 'CON', 'EMPAQUE': 'EMP', 'FACTURACION': 'FAC', 'ENVIO': 'ENV' };
  function routeMarkup(row, summary) {
    return '<section class="trace-route"><div class="trace-route-heading"><h4>Ruta de producción</h4><span>' + summary.finished + '/' + summary.total + ' procesos</span></div><div class="trace-progress" role="progressbar" aria-label="Procesos terminados" aria-valuemin="0" aria-valuemax="' + summary.total + '" aria-valuenow="' + summary.finished + '"><span style="width:' + summary.percent + '%"></span></div><div class="trace-nodes" style="--nodes:' + Math.max(1, summary.total) + '">' + summary.groups.map((group, i) => '<button type="button" class="trace-node ' + group.state + '" data-node-row="' + row.source_row + '" data-node-index="' + i + '" title="' + esc(group.label + ' · ' + group.status) + '" aria-label="' + esc(group.label + ': ' + group.status) + '"><span class="trace-node-dot" aria-hidden="true">' + (group.state === 'finished' ? '✓' : group.state === 'rework' ? '!' : group.state === 'active' ? '●' : i + 1) + '</span><span class="trace-node-label">' + esc(abbreviations[group.key] || group.label.slice(0, 3)) + '</span></button>').join('') + '</div><p class="trace-route-caption">' + (summary.state === 'finished' ? 'Ruta completada' : esc((summary.state === 'rework' ? 'Revisar: ' : summary.state === 'active' ? 'Ahora: ' : 'Siguiente: ') + (summary.focus?.label || 'Sin proceso asignado'))) + '<span>Pulsa un punto para ver detalles</span></p></section>';
  }
  renderTraceCards = function () {
    if (!productionData || traceView !== 'cards') return;
    const scrollTop = traceCards.scrollTop, focused = document.activeElement;
    const focusKey = focused?.closest('[data-card-row]')?.dataset.cardRow;
    const focusAttribute = ['data-card-edit', 'data-card-detail', 'data-card-nas', 'data-node-index', 'data-design-index'].find(a => focused?.hasAttribute(a));
    const focusValue = focusAttribute ? focused.getAttribute(focusAttribute) : null;
    traceImageObserver.disconnect();
    const visible = new Set([...productionBody.querySelectorAll('tr')].map(tr => Number(tr.querySelector('td[data-row]')?.dataset.row)));
    const base = productionData.rows.filter(row => visible.has(row.source_row) && ['ORDEN', 'NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO', 'REFERENCIA'].some(name => traceField(row, name).trim()));
    const summaries = new Map(base.map(row => [row.source_row, summarize(productionData, row, processStatusHeaders, user, scheduleToday())]));
    const rows = orderByDelivery(base.filter(row => matches(summaries.get(row.source_row), filter)), productionData.headers);
    toolbar.querySelectorAll('[data-trace-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.traceFilter === filter));
      button.querySelector('span').textContent = base.filter(row => matches(summaries.get(row.source_row), button.dataset.traceFilter)).length;
    });
    toolbar.querySelector('.trace-results').textContent = rows.length + ' tarjetas · Entrega: de más próxima a más lejana · Sin fecha al final' + (filter === 'mine' ? ' · Asignadas a tu usuario' : '');
    traceCards.innerHTML = rows.map(row => {
      const summary = summaries.get(row.source_row), id = row.source_row;
      const notes = Object.entries(productionData.notes || {}).filter(([k, v]) => k.startsWith(id + ':') && v).length;
      const responsible = summary.focus?.responsible || '';
      const due = traceField(row, 'FECHA DE ENTREGA');
      const dueLabel = !summary.due ? 'Sin fecha' : summary.overdue ? 'Atrasado' : summary.state !== 'finished' && summary.due.getTime() === scheduleToday().getTime() ? 'Entrega hoy' : 'Entrega';
      return '<article class="trace-card state-' + summary.state + '" data-card-row="' + id + '"><div class="trace-media">' + traceAssetsMarkup(id) + '</div><div class="trace-card-body"><div class="trace-card-heading"><h3>' + esc(traceField(row, 'ORDEN') || 'Sin número') + '</h3><span class="trace-stage ' + summary.state + '">' + labels[summary.state] + '</span></div><p class="trace-client">' + esc(traceField(row, 'NOMBRE DEL CLIENTE') || 'Sin cliente') + '</p><p class="trace-project">' + esc(traceField(row, 'NOMBRE PROYECTO')) + '</p><dl><div><dt>Referencia</dt><dd>' + esc(traceField(row, 'REFERENCIA') || '—') + '</dd></div><div><dt>Cantidad</dt><dd class="trace-quantity">' + esc(traceField(row, 'CANTIDAD') || '0') + ' <small>und.</small></dd></div><div class="trace-due ' + (summary.overdue ? 'late' : '') + '"><dt>' + dueLabel + '</dt><dd>' + esc(summary.due ? displayProductionDate(due) : 'Sin programar') + '</dd></div><div><dt>Responsable del proceso</dt><dd>' + (responsible ? responsible.split(/[,;·\n]+/).filter(x => x.trim()).map(name => '<span class="trace-person">' + esc(name.trim()) + '</span>').join(' ') : '<span class="trace-unassigned">Sin asignar</span>') + '</dd></div></dl><div class="trace-card-meta"><span>' + notes + ' nota' + (notes === 1 ? '' : 's') + '</span><span>Fila ' + id + '</span></div><div class="trace-card-actions"><button type="button" class="operator-open" data-card-edit="' + id + '">PRODUCCIÓN</button><button type="button" data-card-detail="' + id + '">Ver detalle</button><button type="button" data-card-nas="' + id + '" aria-label="Abrir carpeta del pedido">NAS ↗</button></div></div>' + routeMarkup(row, summary) + '</article>';
    }).join('') || '<div class="trace-empty"><h3>No hay pedidos en esta vista</h3><p>' + (filter === 'mine' ? 'No hay responsables que coincidan con tu usuario o iniciales. Prueba Todos o revisa la asignación.' : 'Prueba otro estado o cambia la búsqueda.') + '</p><button type="button" data-clear-trace>Ver todos</button></div>';
    traceCards.querySelectorAll('[data-card-row]').forEach(card => traceImageObserver.observe(card));
    traceCards.querySelectorAll('[data-card-row]').forEach(card => {
      const row = rows.find(r => r.source_row === Number(card.dataset.cardRow));
      const description = ['PRODUCTO', 'DESCRIPCIÓN', 'DESCRIPCION', 'PRENDA'].map(h => traceField(row, h)).find(v => v.trim());
      const fabric = traceField(row, 'TELA'), observation = traceField(row, 'OBSERVACIONES');
      const details = (fabric ? '<span><small>TELA</small><strong>' + esc(fabric) + '</strong></span>' : '');
      const notes = Object.entries(productionData.notes || {}).filter(([k,v]) => k.startsWith(row.source_row + ':') && v);
      card.querySelector('.trace-project').insertAdjacentHTML('afterend', '<section class="trace-manufacture"><span class="trace-eyebrow">A FABRICAR</span><h4>' + esc(description || traceField(row, 'REFERENCIA') || 'Producto por especificar') + '</h4>' + (details ? '<div class="trace-material-facts">' + details + '</div>' : '') + (observation ? '<p class="trace-production-note"><strong>INDICACIONES</strong>' + esc(observation) + '</p>' : '') + (notes.length ? '<details class="trace-inline-notes"><summary>Ver ' + notes.length + ' indicación' + (notes.length === 1 ? '' : 'es') + ' de procesos</summary>' + notes.map(([k,v]) => '<p><strong>' + esc(productionData.headers[Number(k.split(':')[1])-1]) + '</strong>' + esc(v) + '</p>').join('') + '</details>' : '') + '</section>');
      card.querySelector('[data-card-detail]').textContent = 'LISTADO Y DETALLES';
      card.querySelector('.trace-card-heading h3').setAttribute('aria-label', 'Orden ' + traceField(row, 'ORDEN'));
    });
    traceCards.scrollTop = scrollTop;
    if (focusKey && focusAttribute) traceCards.querySelector('[data-card-row="' + focusKey + '"] [' + focusAttribute + '="' + focusValue + '"]')?.focus({ preventScroll: true });
    fitTraceCards();
  };
  traceCards.addEventListener('click', event => {
    if (event.target.closest('[data-clear-trace]')) { filter = 'all'; exactScheduleOrder = ''; productionSearch.value = ''; renderProduction(); renderTraceCards(); return; }
    const button = event.target.closest('[data-node-row]'); if (!button) return;
    const id = Number(button.dataset.nodeRow), row = productionData.rows.find(r => r.source_row === id);
    if (!row) return;
    const group = groupsFor(productionData, row, processStatusHeaders)[Number(button.dataset.nodeIndex)];
    const fields = group.columns.filter(i => String(row.values[i] || '').trim()).map(i => '<div><dt>' + esc(productionData.headers[i]) + '</dt><dd>' + esc(displayProductionDate(String(row.values[i]))) + '</dd></div>').join('');
    const notes = group.columns.filter(i => productionData.notes?.[id + ':' + (i + 1)]).map(i => '<p class="trace-full-note">' + esc(productionData.notes[id + ':' + (i + 1)]) + '</p>').join('');
    nodeDialog.querySelector('.trace-node-content').innerHTML = '<span class="trace-eyebrow">' + esc(traceField(row, 'ORDEN')) + '</span><h2 id="trace-node-heading">' + esc(group.label) + '</h2><span class="trace-stage ' + group.state + '">' + group.status + '</span><p>Responsable: <strong>' + esc(group.responsible || 'Sin asignar') + '</strong></p><dl>' + fields + '</dl>' + notes + (!fields ? '<p>Este proceso aún no tiene registros.</p>' : '') + '<p class="trace-node-hint">Registra la actividad desde PRODUCCIÓN. El proceso se selecciona según el perfil del usuario conectado.</p><button type="button" class="trace-register">Ir a PRODUCCIÓN</button>';
    nodeDialog.querySelector('.trace-register').onclick = () => { nodeDialog.close(); openOperatorProduction(id); };
    nodeDialog.showModal();
  });
  const oldSelection = operatorSelection;
  operatorSelection = function () {
    oldSelection();
    const value = key(operatorExpected), state = value === 'R' ? 'rework' : value === 'P' ? 'active' : value === 'N/A' || dateValue(value) ? 'finished' : 'pending';
    const current = operatorDialog.querySelector('.operator-current');
    current.className = 'operator-current trace-stage ' + state;
    current.textContent = 'Estado actual: ' + (value === 'N/A' ? 'No aplica' : labels[state]) + (dateValue(value) ? ' · ' + displayProductionDate(operatorExpected) : '');
  };
  operatorForm.elements.column.onchange = operatorSelection;
  operatorForm.elements.reason.setAttribute('aria-describedby', 'trace-reason-help');
  const help = document.createElement('small'); help.id = 'trace-reason-help'; help.textContent = 'Para reproceso, explica el motivo. Al terminar se conserva el cierre automático de procesos anteriores.';
  operatorForm.elements.reason.after(help);
  const style = document.createElement('style');
  style.textContent = `
  .trace-workspace{padding:22px 24px 12px;background:#111917;border-bottom:1px solid #31403a}.trace-workspace-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.trace-eyebrow{font:700 11px/1.5 Arial;letter-spacing:.13em;color:#b4c792}.trace-workspace h3{font:600 21px/1.3 Arial;color:#f3f6ef;margin:4px 0 18px}.trace-live{font:12px Arial;color:#aac7b3}.trace-quick-filters{display:flex;gap:7px;flex-wrap:wrap}.trace-quick-filters button{width:auto;background:#1b2722;color:#c8d6ce;border:1px solid #3b4d42;padding:9px 12px;border-radius:9px;box-shadow:none;font:600 13px Arial;display:flex;gap:10px;align-items:center;min-height:40px}.trace-quick-filters button span{font-size:12px;border-radius:4px;padding:2px 5px;background:#ffffff0d}.trace-quick-filters button[aria-pressed=true]{background:#d0ec93;border-color:#d0ec93;color:#172215}.trace-results{font:12px/1.5 Arial;color:#a7b8ad;margin:12px 0 0}.trace-workspace[hidden],body:not(.trace-cards-mode) .trace-workspace,body.admin-summary-mode .trace-workspace{display:none}
  body.production-mode .trace-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,570px),1fr));padding:20px 24px;gap:20px;scrollbar-gutter:stable;align-items:start}
  body.production-mode .trace-card{grid-template-columns:36% minmax(0,1fr);border-radius:16px;border:1px solid #3a4a40;background:#19231e;min-width:0;overflow:hidden;box-shadow:0 6px 22px #0002}
  body.production-mode .trace-card.state-rework{border-color:#985452}body.production-mode .trace-card.state-active{border-color:#827044}
  body.production-mode .trace-media,body.production-mode .trace-media:has(img),body.production-mode .trace-media:not(:has(img)){min-height:325px;height:100%;padding:14px;background:#edf0eb}
  body.production-mode .trace-design-main img{height:295px;max-height:360px;object-fit:contain}.trace-design-view{gap:10px}.trace-design-tabs button{min-height:36px}
  body.production-mode .trace-card-body{padding:22px;min-width:0}.trace-card-heading{flex-wrap:wrap}body.production-mode .trace-card-heading h3{font:700 24px/1.2 Arial;letter-spacing:-.6px}body.production-mode .trace-client{font:600 16px/1.4 Arial;overflow-wrap:anywhere}body.production-mode .trace-project{font:13px/1.5 Arial;color:#a4b7aa;margin-bottom:20px}body.production-mode .trace-card dl{gap:17px 14px}body.production-mode .trace-card dt{font:12px/1.5 Arial;color:#a6b7ab;margin-bottom:5px}body.production-mode .trace-card dd{font:500 14px/1.5 Arial;color:#eef5ed}.trace-quantity small{font-size:12px;color:#adbdaf}.trace-person{display:inline-block;background:#b8ddf5;border:1px solid #cfebfc;color:#14374e;border-radius:5px;padding:2px 6px;font:600 12px/1.6 Arial;margin:0 2px 3px 0}.trace-unassigned{color:#afbbb3;font-size:13px}body.production-mode .trace-due.late dt,body.production-mode .trace-due.late dd{color:#ffac9c}.trace-card-meta{display:flex;justify-content:space-between;font:12px Arial;color:#92a899;margin:1px 0 14px}
  body.production-mode .trace-card-heading>.trace-stage,.trace-stage,.operator-current.trace-stage{display:inline-block;font:600 12px/1.4 Arial;border-radius:6px;padding:6px 9px;background:#36433b;color:#d3ded6;border:1px solid #536459;white-space:normal}body.production-mode .trace-stage.active,.trace-stage.active{background:#f3b852;color:#332306;border-color:#f3b852}body.production-mode .trace-stage.rework,.trace-stage.rework{background:#e36764;color:#240b0d;border-color:#f79089}body.production-mode .trace-stage.finished,.trace-stage.finished{background:#8bdbaf;color:#103423;border-color:#8bdbaf}
  body.production-mode .trace-card-actions{grid-template-columns:1fr auto auto;gap:6px;margin-top:auto}body.production-mode .trace-card-actions button{min-height:42px;padding:10px 9px;border:1px solid #4a5b4e!important;border-radius:8px;background:#1d2b23!important;color:#e0eddf!important;font:600 12px Arial}body.production-mode .trace-card-actions .operator-open{background:#d0ec93!important;color:#1c2b13!important;border-color:#d0ec93!important}.trace-card-actions button:focus-visible,.trace-node:focus-visible,.trace-quick-filters button:focus-visible{outline:2px solid #b8ddf5;outline-offset:2px}
  .trace-route{grid-column:1/-1;padding:16px 20px 12px;background:#121d17;border-top:1px solid #35473b;min-width:0}.trace-route-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.trace-route-heading h4{font:600 13px Arial;margin:0;color:#e9f1e7}.trace-route-heading>span{font:12px Arial;color:#b4c8b8}.trace-progress{height:3px;border-radius:4px;background:#334238;margin:12px 0}.trace-progress>span{display:block;height:100%;background:#83dca4;border-radius:inherit}.trace-nodes{display:grid;grid-template-columns:repeat(var(--nodes),minmax(0,1fr));gap:0;min-width:0}.trace-node{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;min-height:50px;width:100%;padding:6px 0 2px;background:transparent!important;border:0!important;box-shadow:none!important;border-radius:4px;cursor:pointer;color:#9aada0;font:10px Arial}.trace-node:before{content:'';position:absolute;height:1px;background:#4c6152;top:16px;left:0;right:0}.trace-node:first-child:before{left:50%}.trace-node:last-child:before{right:50%}.trace-node-dot{position:relative;z-index:1;display:grid;place-items:center;box-sizing:border-box;width:21px;height:21px;border:1px solid #718879;border-radius:50%;background:#26372c;box-shadow:0 0 0 3px #121d17;font:600 10px Arial;color:#cedad0}.trace-node.finished .trace-node-dot{background:#214c35;border-color:#85dba5;color:#b0f1c7}.trace-node.active .trace-node-dot{background:#443214;color:#ffc56e;border:2px solid #f3b852;box-shadow:0 0 0 3px #121d17,0 0 0 5px #f3b85240}.trace-node.rework .trace-node-dot{background:#542a2a;border-color:#f47d78;color:#ffc5c2}.trace-node.partial .trace-node-dot{border-color:#abd8f4;color:#abd8f4}.trace-node-label{font-size:9px;letter-spacing:.015em;color:#b7c9bc;white-space:nowrap}.trace-route-caption{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font:12px/1.5 Arial;color:#d6e4d5;margin:6px 0 0}.trace-route-caption>span{color:#839d8c;font-size:11px}
  .trace-node-dialog{width:min(560px,94vw);max-height:88dvh;overflow:auto;border-radius:16px;border:1px solid #526950;background:#19271e;color:#e9f2e7;padding:26px}.trace-node-dialog::backdrop{background:#000b}.trace-node-close{float:right;width:36px;padding:5px;min-height:36px;border:1px solid #58715c;background:#283a2d;color:#fff;box-shadow:none}.trace-node-dialog h2{font:600 22px/1.4 Arial}.trace-node-dialog dl{display:grid;grid-template-columns:1fr 1fr;gap:14px}.trace-node-dialog dt{font:12px Arial;color:#abc0b1}.trace-node-dialog dd{margin:5px 0 0;font:14px/1.5 Arial;overflow-wrap:anywhere}.trace-node-hint{font:13px/1.6 Arial;color:#b5c5b6}.trace-register{background:#cce992;color:#17260e;border:0;border-radius:8px;min-height:44px;font:600 14px Arial}.trace-empty{grid-column:1/-1;padding:45px 20px;text-align:center;color:#b7c9ba}.trace-empty h3{color:#e5f0df}.trace-empty button{width:auto;padding:12px 24px;background:#cce992;color:#192514}.operator-dialog{font-family:Arial,sans-serif}.operator-dialog input,.operator-dialog select,.operator-dialog textarea{min-height:44px;font-size:16px}.operator-dialog #trace-reason-help{display:block;color:#a9bcae;font:12px/1.6 Arial;margin-top:7px}.operator-actions button{min-height:48px;font-size:14px}.operator-order{font:600 15px/1.5 Arial;overflow-wrap:anywhere}.operator-dialog input[readonly]{background:#203b46;color:#c1e9ff;border-color:#507384}.operator-history article{font-size:13px}
  @media(max-width:860px){.trace-workspace{padding:14px 12px 10px}.trace-workspace h3{font-size:18px;margin-bottom:12px}.trace-live{display:none}.trace-quick-filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.trace-quick-filters button{font-size:12px;padding:9px 7px;justify-content:space-between;gap:3px;min-height:44px}body.production-mode .trace-cards{padding:12px;gap:14px}.trace-results{font-size:11px}.trace-workspace-top .trace-eyebrow{font-size:10px}}
  @media(max-width:600px){body.production-mode .trace-card{grid-template-columns:1fr}body.production-mode .trace-media,body.production-mode .trace-media:has(img){height:290px;min-height:0;padding:12px}body.production-mode .trace-design-main img{height:230px}body.production-mode .trace-media:not(:has(img)){height:115px;min-height:0}.trace-no-design>span{display:none}body.production-mode .trace-card-body{padding:18px}.trace-route{padding:14px 10px 10px}.trace-node-dot{width:18px;height:18px;font-size:9px}.trace-node:before{top:15px}.trace-node-label{font-size:8px;letter-spacing:-.04em}.trace-route-caption>span{display:block;width:100%}.trace-card-actions button{font-size:12px!important}.operator-dialog{padding:20px 16px}.trace-node-dialog{padding:20px}.trace-node-dialog dl{grid-template-columns:1fr}}
  `;
  style.textContent += `
  .trace-manufacture{border-top:1px solid #35463c;padding:13px 0 16px;margin-bottom:12px}.trace-manufacture h4{font:600 19px/1.35 Arial;color:#f4f8ed;margin:5px 0 8px;overflow-wrap:anywhere}.trace-material-facts{display:flex;gap:16px}.trace-material-facts small{display:block;font:10px/1.5 Arial;color:#9eb5a5}.trace-material-facts strong{font:500 13px/1.5 Arial;color:#d8e5da}.trace-production-note{font:13px/1.6 Arial;color:#f1e8c5;margin:12px 0 0;background:#afa15913;border-left:3px solid #bba658;padding:9px 11px;white-space:pre-wrap}.trace-production-note strong,.trace-inline-notes strong{display:block;font-size:10px;letter-spacing:.06em;margin-bottom:4px}.trace-inline-notes{font:12px/1.6 Arial;color:#c7d8c9;margin-top:12px}.trace-inline-notes summary{cursor:pointer;min-height:32px}.trace-inline-notes p{white-space:pre-wrap;border-top:1px solid #35463c;padding-top:8px}.trace-card-heading h3{font-size:19px!important}.trace-quantity{font-size:23px!important;font-weight:700!important}.trace-card-actions [data-card-nas]{opacity:.65}
  body.production-mode.trace-cards-mode .production-title p,body.production-mode.trace-cards-mode .production-kpis{display:none}
  .trace-workspace{padding-top:14px}.trace-workspace h3{font-size:17px;margin:0 0 12px}.trace-workspace-top{align-items:baseline}
  @media(max-width:860px){body.production-mode.trace-cards-mode{overflow-y:auto!important;height:auto!important}body.production-mode.trace-cards-mode .trace-cards{height:auto!important;max-height:none;overflow:visible;scrollbar-gutter:auto}body.production-mode.trace-cards-mode .production-shell{max-height:none;height:auto}.trace-workspace{padding-top:12px}.trace-workspace h3{font-size:16px}.trace-node-label{font-size:8px}}
  `;
  document.head.appendChild(style);
  const mobileStyle = document.createElement('style');
  mobileStyle.textContent = `
  @media(max-width:860px){
    body{overflow-wrap:anywhere} main,.panel,.card{min-width:0;max-width:100%;box-sizing:border-box}
    body main{padding-top:72px!important;padding-bottom:max(20px,env(safe-area-inset-bottom))!important}
    .sidebar{max-height:100dvh;overflow-y:auto;overscroll-behavior:contain}.sidebar .tab,.sidebar .nav-parent{min-height:48px}
    input:not([type=checkbox]):not([type=radio]),select,textarea{font-size:16px!important;max-width:100%;box-sizing:border-box}
    button,input,select,textarea,a{touch-action:manipulation}
    dialog{box-sizing:border-box!important;width:calc(100vw - 24px)!important;max-width:620px!important;max-height:calc(100dvh - 24px)!important;overflow-y:auto!important;overscroll-behavior:contain;padding:20px 16px!important;border-radius:16px!important}
    dialog input,dialog select,dialog textarea{width:100%;min-width:0}dialog h2{font-size:21px}dialog button{min-height:44px}
    .operator-actions{gap:10px!important}.operator-actions button{min-height:50px!important;padding:12px 8px!important}
    .trace-detail dl{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important}.trace-detail dd{margin-left:0;overflow-wrap:anywhere}
    .trace-detail-assets{max-width:100%;overflow:hidden}.trace-detail-assets img{max-width:100%;height:auto;object-fit:contain}
    body.production-mode .production-process-filter{display:flex;flex-wrap:wrap!important;overflow:visible!important}
    body.production-mode .production-process-filter select{flex:1 1 100%!important;width:100%;min-width:0!important;min-height:44px}
    body.production-mode .production-process-filter button{flex:1 1 auto!important;min-height:44px}
    body.production-mode .production-search,body.production-mode .production-refresh{min-height:44px}
    body.production-mode .trace-card-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    body.production-mode .trace-card-actions .operator-open{grid-column:1/-1;min-height:48px;font-size:15px}
    body.production-mode .trace-card-actions button{min-height:44px}
    .trace-design-tabs button{min-width:44px;min-height:44px}.trace-quick-filters button{min-height:46px}
    body.admin-summary-mode .production-table-wrap{max-width:100%;overflow:auto!important;touch-action:pan-x pan-y}
    body.admin-summary-mode .production-table th,body.admin-summary-mode .production-table td{position:static!important}
  }
  @media(max-width:620px){
    body.schedule-mode{height:auto!important;overflow-y:auto!important}
    body.schedule-mode .schedule-shell{height:auto!important;max-height:none!important}
    body.schedule-mode .schedule-toolbar{padding:14px 12px!important;gap:8px!important;flex-wrap:wrap}
    body.schedule-mode .schedule-actions button{min-width:44px;min-height:44px}
    body.schedule-mode .schedule-title h2{font-size:18px!important}
    body.schedule-mode .schedule-metrics{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px!important;padding:12px!important}
    body.schedule-mode .schedule-metrics>div{display:flex;flex-direction:column;align-items:flex-start;gap:4px!important;font-size:11px!important}
    body.schedule-mode .schedule-metrics strong{font-size:22px!important}
    body.schedule-mode .schedule-filters input{min-height:44px}
    body.schedule-mode .schedule-weekdays{display:none!important}
    body.schedule-mode .schedule-grid{display:flex!important;flex-direction:column!important;min-width:0!important;height:auto!important;gap:12px;padding:12px;box-sizing:border-box}
    body.schedule-mode .schedule-day:not(:has(.schedule-event)){display:none!important}
    body.schedule-mode .schedule-day{min-height:0!important;height:auto!important;overflow:visible!important;padding:12px!important;border:1px solid #3a4a40!important;border-radius:12px;background:#19231e}
    body.schedule-mode .schedule-day-number{width:auto!important;height:auto!important;margin:0 0 10px!important;display:block!important;font-size:15px!important;text-align:left;padding:6px 8px;border-radius:6px}
    body.schedule-mode .schedule-day-number:before{content:'Día '}
    body.schedule-mode .schedule-day-total{position:static!important;display:block;min-height:36px;font-size:12px;float:right;padding:6px 8px}
    body.schedule-mode .schedule-events{display:grid!important;grid-template-columns:1fr!important;max-height:none!important;height:auto!important;overflow:visible!important;gap:8px!important}
    body.schedule-mode .schedule-event{width:100%!important;height:auto!important;min-height:72px!important;padding:12px!important;text-align:left;display:block!important}
    body.schedule-mode .schedule-event strong{font-size:15px!important;white-space:normal!important;overflow-wrap:anywhere}
    body.schedule-mode .schedule-event .schedule-client{display:block!important;font-size:13px!important;white-space:normal!important;line-height:1.4;margin:5px 0}
    body.schedule-mode .schedule-event .schedule-units{display:block!important;font-size:12px!important}
    body.schedule-mode .schedule-badge{display:inline-block!important;font-size:11px!important;margin-top:6px}
    body.schedule-mode .schedule-grid:not(:has(.schedule-event)):after{content:'No hay entregas para este mes o búsqueda.';padding:24px 12px;color:#b8cbbf;font-size:15px}
    body.production-mode .trace-card-body{padding:16px!important}.trace-card-heading{gap:10px}
    body.production-mode .trace-card dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px}
    .trace-node-label{font-size:7px!important}.trace-route{padding-left:8px;padding-right:8px}
  }
  @media(max-width:360px){.trace-quick-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.operator-actions{grid-template-columns:1fr!important}.trace-detail dl{grid-template-columns:1fr!important}}
  `;
  document.head.appendChild(mobileStyle);
  renderTraceCards();
  new ResizeObserver(fitTraceCards).observe(toolbar);
})();
