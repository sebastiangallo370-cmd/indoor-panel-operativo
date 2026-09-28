/* Production cards: derived presentation only. Operational writes remain in the existing API. */
(function () {
  'use strict';
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const personKey = value => key(value).replace(/[^A-Z0-9]/g, '');
  const operatorInitials = new Map([
    ['Ediht Johana Londoño', 'EJ'], ['Edith Johana Londoño', 'EJ'],
    ['Alejandro Mora', 'AM'], ['Alejandro Padilla', 'AP'],
    ['Andrés López', 'AL'], ['Augusto López', 'AU'],
    ['Carlos Cáceres', 'CC'], ['Keyner', 'K'],
    ['Dagoberto Botero', 'DB'], ['Edwin Espinosa', 'EE'],
    ['Esteban Estrada', 'ES'], ['Hesleidy Londoño', 'HL'],
    ['Jeison Padilla', 'JP'], ['Julian Ocampo', 'JO'],
    ['Juliana Diaz', 'JD'], ['Santiago Vásquez', 'SV'],
    ['Sebastian Gallo', 'SG'], ['Stiven Sánchez', 'SS'],
    ['Dairo Diaz', 'DD'], ['Yenifer Sánchez Arcila', 'YS'],
    ['Gloria', 'G'], ['David Hincapie', 'DH'],
    ['Geovanny Piedrahita', 'GP'], ['AUTOMATIZACION', 'BOT'],
    ['Daniel Gonzales', 'DG']
  ].flatMap(([name, initials]) => [[personKey(name), initials], [initials, initials]]));
  function noteInitials(author) {
    const assigned = operatorInitials.get(personKey(author));
    if (assigned) return assigned;
    const words = key(author).match(/[A-Z0-9]+/g) || [];
    return words.length ? words.map(word => word[0]).join('') : 'N/A';
  }
  function noteAttribution(data, row, column, author, source = '') {
    const index = Number(column) - 1;
    const area = key(data.groups?.[index]);
    const header = key(data.headers[index]);
    const generalArea = area === 'GENERAL' || area.includes('LINEA PRODUCCION') || area.includes('COMERCIAL');
    const fromListing = ['LISTADO', 'LISTING'].includes(key(source)) || header.includes('LISTADO') || (generalArea && ['ORDEN', 'OBSERVACIONES'].includes(header));
    if (fromListing) {
      const commercialColumns = data.headers.map((h, i) => i).filter(i => /^(COMERCIAL|VENDEDOR)(\s|$)/.test(key(data.headers[i])));
      if (!commercialColumns.length) data.headers.forEach((h, i) => {
        const group = key(data.groups?.[i]);
        if (/^RESP/.test(key(h)) && (group === 'GENERAL' || group.includes('LINEA PRODUCCION') || group.includes('COMERCIAL'))) commercialColumns.push(i);
      });
      const names = commercialColumns.map(i => String(row.values[i] || '').trim()).filter(Boolean);
      return {name: [...new Set(names)].join(', '), inferred: !!names.length};
    }
    if (String(author || '').trim()) return {name: String(author).trim(), inferred: false};
    if (index < 0 || index >= data.headers.length || !area) return {name: '', inferred: false};
    const columns = data.headers.map((header, i) => i).filter(i => key(data.groups?.[i]) === area);
    // Use the responsibility recorded in this order's area, not the note's wording.
    const names = columns.filter(i => /^RESP/.test(key(data.headers[i])) || ['COMERCIAL', 'VENDEDOR', 'CONFECCIONISTA'].includes(key(data.headers[i])))
      .map(i => String(row.values[i] || '').trim()).filter(Boolean);
    if (!names.length) columns.forEach(i => {
      const name = data.process_responsibles?.[row.source_row + ':' + (i + 1)];
      if (name) names.push(String(name).trim());
    });
    return {name: [...new Set(names)].join(', '), inferred: !!names.length};
  }
  function noteSignature(attribution) {
    return attribution.name ? attribution.name.split(/[,;·\n]+/).filter(name => name.trim()).map(noteInitials).join('/') : 'N/A';
  }
  function noteBadges(attribution) {
    const initials = attribution.name ? attribution.name.split(/[,;·\n]+/).filter(name => name.trim()).map(noteInitials) : ['N/A'];
    return '<span class="trace-note-authors">' + initials.map(value => '<strong class="trace-note-author-badge">' + esc(value) + '</strong>').join('') + '</span>';
  }
  const flow = typeof indoorProcessFlow !== 'undefined' ? indoorProcessFlow : require('./process-flow.json');
  const isExternal = process => key(process.label) === 'DISENO';
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
      group.autoClosed = values.some(v => v) && ['partial', 'pending'].includes(group.state) && (data.auto_closed || []).includes(row.source_row + ':' + (group.start + 1));
      if (group.autoClosed) group.state = 'finished';
      group.status = group.autoClosed ? 'Cierre automático' : group.state === 'finished' ? values.length && values.every(v => v === 'N/A') ? 'No aplica' : 'Terminado' : ({ active: 'En proceso', rework: 'Reproceso', partial: 'Avance parcial', pending: 'Pendiente' })[group.state];
      group.responsible = group.columns.filter(i => key(data.headers[i]).startsWith('RESP') || key(data.headers[i]) === 'CONFECCIONISTA').map(i => String(row.values[i] || '').trim()).filter(Boolean).join(', ');
      if (isExternal(group)) group.status = 'Externo · ' + group.status;
      if (!group.responsible && values.some(v => v)) group.responsible = group.statusColumns.map(i => data.process_responsibles?.[row.source_row + ':' + (i+1)]).filter(Boolean)[0] || '';
      return group;
    });
  }
  function summarize(data, row, statusHeaders, user, today) {
    const groups = groupsFor(data, row, statusHeaders);
    const internal = groups.filter(g => !isExternal(g));
    const finished = internal.filter(g => g.state === 'finished').length;
    const state = internal.some(g => g.state === 'rework') ? 'rework' : internal.some(g => g.state === 'active') ? 'active' : internal.length && finished === internal.length ? 'finished' : 'pending';
    const focus = internal.find(g => g.state === 'rework') || [...internal].reverse().find(g => g.state === 'active') || internal.find(g => g.state !== 'finished') || internal[internal.length - 1];
    const userTokens = [user.name, user.initials].map(personKey).filter(Boolean);
    const assignedToMe = g => g.responsible.split(/[,;·\n]+/).some(name => userTokens.includes(personKey(name)));
    const mine = internal.some(assignedToMe);
    const myPending = internal.some(g => assignedToMe(g) && g.state !== 'finished');
    const dueIndex = data.headers.findIndex(h => key(h) === 'FECHA DE ENTREGA'), due = dateValue(row.values[dueIndex]);
    const overdue = !!due && due < today && state !== 'finished';
    return { groups, finished, total: internal.length, state, focus, mine, myPending, due, overdue, percent: internal.length ? Math.round(finished / internal.length * 100) : 0 };
  }
  function matches(summary, filter) {
    return filter === 'all' || filter === 'pending' && summary.state !== 'finished' || filter === 'work' && summary.myPending || filter === 'mine' && summary.mine || filter === 'late' && summary.overdue || filter === summary.state;
  }
  function processForProfile(profile) {
    return flow.find(p => [p.label, ...p.headers, ...p.aliases].some(label => key(label) === key(profile)));
  }
  function processQueueSummary(summary, profile, user, today) {
    const process = processForProfile(profile);
    const group = summary.groups.find(g => g.label === process?.label);
    if (!group) return null;
    const tokens = [user.name, user.initials].map(personKey).filter(Boolean);
    const index = summary.groups.indexOf(group);
    // Each area's queue is released only by its immediately preceding stage.
    // The first stage receives newly scheduled orders; No aplica is also closed.
    // MATERIALES nunca bloquea lo que sigue: hay pedidos que pasan directo a EDICIÓN
    // sin esperar a que se cierre esa columna (a pedido del negocio).
    const previous = summary.groups.slice(0, index).filter(g => !isExternal(g) && g.label !== 'MATERIALES').at(-1);
    const ready = !previous || previous.state === 'finished';
    return { ...summary, route: summary, focus: group, state: group.state,
      ready,
      mine: group.responsible.split(/[,;·\n]+/).some(name => tokens.includes(personKey(name))),
      overdue: !!summary.due && summary.due < today && group.state !== 'finished' };
  }
  function queueMatches(summary, filter) {
    if (!summary) return false;
    if (summary.route && !summary.ready) return false;
    if (filter === 'pending') return summary.state !== 'finished';
    if (filter === 'mine') return summary.route ? summary.mine && summary.state !== 'finished' : summary.myPending;
    return matches(summary, filter);
  }
  function summaryForView(summary, filter, profile, user, today, admin, areaOnly) {
    return areaOnly || (!admin && filter !== 'all') ? processQueueSummary(summary, profile, user, today) : summary;
  }
  function paginate(rows, requestedPage) {
    const pages = Math.max(1, Math.ceil(rows.length / 15));
    const page = Math.max(1, Math.min(pages, Math.trunc(Number(requestedPage)) || 1));
    return { page, pages, total: rows.length, start: rows.length ? (page - 1) * 15 + 1 : 0, end: Math.min(page * 15, rows.length), rows: rows.slice((page - 1) * 15, page * 15) };
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
  if (typeof module !== 'undefined' && module.exports) { module.exports = { key, noteInitials, noteAttribution, noteSignature, dateValue, groupsFor, summarize, matches, processForProfile, processQueueSummary, queueMatches, summaryForView, paginate, orderByDelivery, addBusinessDays, applyDefaultDeliveryDates }; return; }
  // Inventory is postponed: remove only its interface, preserving the catalog.
  document.querySelectorAll('[data-kind="inventario"], [data-panel="inventario"]').forEach(element => element.remove());
  document.body.classList.remove('inventory-mode');
  if (typeof traceCards === 'undefined') return;

  // Commercial assistants are workspaces, not landing pages. Keep controls in view
  // without clipping real content, zoomed text, additional sheets or attachments.
  const assistantLayout = document.createElement('style');
  assistantLayout.textContent = `
    body:has(.workspace.panel.active) main{min-height:100dvh;padding-bottom:16px;min-width:0}
    body:has(.workspace.panel.active) main>header{text-align:left;padding:12px 2px;margin:0;max-width:none}
    body:has(.workspace.panel.active) main>header h1{font-size:clamp(24px,2.1vw,32px);line-height:1.14;letter-spacing:-.035em;max-width:none;margin:0}
    body:has(.workspace.panel.active) main>header h1 br{display:none}
    body:has(.workspace.panel.active) main>header .eyebrow{font-size:11px;margin-bottom:6px}
    body:has(.workspace.panel.active) main>header .subtitle{font-size:13px;line-height:1.45;margin:7px 0 0;max-width:none}
    body:has(.workspace.panel.active) .footer-note{margin:12px 0 0;font-size:11px}
    .workspace.panel.active{grid-template-columns:minmax(340px,1fr) minmax(0,1.3fr);gap:16px;min-width:0;align-items:stretch}
    .workspace.panel.active>.card{min-width:0;border-radius:16px}
    .workspace.panel.active .card-head{padding:18px 20px 0}
    .workspace.panel.active .card-head p{font-size:13px;line-height:1.45}
    .workspace.panel.active .upload-wrap{padding:14px 20px 18px}
    .workspace.panel.active .dropzone{min-height:132px;padding:16px;border-radius:12px}
    .workspace.panel.active .upload-icon{width:38px;height:38px;margin:0 auto 8px;border-radius:10px}
    .workspace.panel.active .upload-icon svg{width:22px;height:22px}
    .workspace.panel.active .file-row{padding:11px 12px;border-radius:10px}
    .workspace.panel.active .file-row>div{min-width:0;overflow-wrap:anywhere}
    .workspace.panel.active .file-row span{overflow-wrap:anywhere}
    .workspace.panel.active .history{min-height:0}
    .workspace.panel.active .history-head{padding:18px 20px 14px;flex-wrap:wrap}
    .workspace.panel.active .table-wrap{min-width:0}
    .workspace.panel.active .history table{min-width:0;table-layout:fixed}
    .workspace.panel.active .history th,.workspace.panel.active .history td{padding:12px 10px;overflow-wrap:anywhere;letter-spacing:normal}
    .workspace.panel.active .history th:first-child{width:52px}
    .workspace.panel.active .history th:nth-child(2){width:23%}
    .workspace.panel.active .history th:nth-child(3){width:17%}
    .workspace.panel.active .history th:nth-child(4){width:23%}
    .workspace.panel.active .history .state{white-space:normal;padding:6px 8px;max-width:100%;flex-wrap:wrap}
    .workspace.panel.active .empty-row td{height:200px}
    .workspace.panel.active .attachment-list{max-height:160px;overflow-y:auto;overscroll-behavior:contain}
    .workspace.panel.active .creator-workbook-name{max-width:none;margin:0 0 14px;padding:12px 16px}
    .workspace.panel.active .creator-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding-bottom:12px}
    .workspace.panel.active .creator-cards:not(:has(.excel-sheet)){grid-template-columns:minmax(0,1fr)}
    .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap{display:grid;grid-template-columns:minmax(180px,.75fr) minmax(0,1.5fr);gap:16px;align-items:start}
    .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .file-pair{grid-template-columns:repeat(2,minmax(0,1fr))}
    .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap>.field{grid-column:1;grid-row:1}
    .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap>.file-pair{grid-column:2;grid-row:1}
    .workspace.panel.active .add-sheet{min-height:44px;padding:12px;grid-column:1/-1}
    .workspace.panel.active .add-mockup{min-height:40px;padding:10px;grid-column:1/-1}
    .workspace.panel.active .creator-actions{max-width:none;margin:0;padding:10px 0;position:sticky;bottom:0;z-index:3;background:#0c100d;border-top:1px solid #39452f}
    .workspace.panel.active .creator-actions .actions{margin:0}
    .workspace.panel.active .creator-actions button{max-width:480px;margin-left:auto}
    @media(min-width:1400px){.workspace.panel.active .creator-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(min-width:1101px) and (min-height:700px){.workspace.panel.active:not([data-panel=creador]){min-height:calc(100dvh - 252px)}}
    @media(max-width:1100px){.workspace.panel.active{grid-template-columns:minmax(0,1fr)}.workspace.panel.active .empty-row td{height:140px}}
    @media(max-width:700px){
      body:has(.workspace.panel.active) main{padding:70px 12px 16px}
      body:has(.workspace.panel.active) main>.brand{position:fixed;top:4px;left:64px;right:12px;width:auto;padding:7px 0}
      body:has(.workspace.panel.active) main>header{padding:12px 0 14px}
      body:has(.workspace.panel.active) main>header h1{font-size:24px}
      .workspace.panel.active .creator-cards{grid-template-columns:minmax(0,1fr)}
      .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap,.workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .file-pair{grid-template-columns:minmax(0,1fr)}
      .workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap>.field,.workspace.panel.active .creator-cards:not(:has(.excel-sheet)) .creator-main-card .upload-wrap>.file-pair{grid-column:auto;grid-row:auto}
      .workspace.panel.active .card-head{padding:16px 16px 0}
      .workspace.panel.active .upload-wrap{padding:12px 16px 16px}
      .workspace.panel.active .creator-actions button{max-width:none}
      .workspace.panel.active .history thead{display:none}
      .workspace.panel.active .history tr:not(.empty-row){display:grid;grid-template-columns:auto minmax(0,1fr);padding:12px}
      .workspace.panel.active .history td{border:0;padding:7px}
      .workspace.panel.active .history tr:not(.empty-row) td:nth-child(n+3){grid-column:1/-1}
      .workspace.panel.active .history .file-name{max-width:100%;white-space:normal}
    }
  `;
  document.head.appendChild(assistantLayout);
  document.querySelectorAll('#upload-form,#order-form').forEach(form => {
    const field = document.createElement('div');
    field.className = 'field';field.style.margin = '16px 0';
    const fieldId = form.id + '-observaciones';
    field.innerHTML = '<label for="'+fieldId+'">OBSERVACIONES</label><textarea id="'+fieldId+'" name="observaciones" maxlength="5000" rows="3" placeholder="Ejemplo: NO LLEVA TEXTURIZADO" aria-describedby="'+fieldId+'-hint"></textarea><small id="'+fieldId+'-hint">Se mostrarán completas en todas las tarjetas de este pedido para que producción las vea sin abrir paneles.</small>';
    const submit = form.querySelector('button[type="submit"]');
    if (submit) (submit.closest('.actions') || submit).before(field); else form.appendChild(field);
  });
  document.querySelectorAll('main > header h1 br').forEach(br => br.replaceWith(document.createTextNode(' ')));

  const isAdmin = typeof canViewAdministration !== 'undefined' && canViewAdministration;
  const canDelete = typeof deleteProductionAllowed !== 'undefined' && deleteProductionAllowed;
  const deletingRows = new Set();
  const deleteProgress = document.createElement('dialog');
  deleteProgress.className = 'operator-dialog';
  deleteProgress.setAttribute('aria-label', 'Progreso de eliminación');
  deleteProgress.innerHTML = '<h2 class="delete-progress-title">ELIMINANDO ORDEN</h2><p class="delete-progress-folder" style="overflow-wrap:anywhere"></p><progress max="1" aria-label="Eliminación en curso" style="display:block;width:100%;height:18px;accent-color:#d4ec98"></progress><p class="delete-progress-message" role="status" aria-live="polite"></p><button type="button" class="delete-progress-close" hidden>CERRAR</button>';
  document.body.appendChild(deleteProgress);
  let deleteProgressTimer;
  function showDeleteProgress(title, message, folder = '') {
    clearTimeout(deleteProgressTimer);
    deleteProgress.querySelector('.delete-progress-title').textContent = title;
    deleteProgress.querySelector('.delete-progress-folder').textContent = folder;
    deleteProgress.querySelector('.delete-progress-message').textContent = message;
    deleteProgress.querySelector('progress').removeAttribute('value');
    deleteProgress.querySelector('progress').setAttribute('aria-label', 'Eliminación en curso');
    deleteProgress.querySelector('.delete-progress-close').hidden = true;
    deleteProgress.setAttribute('aria-busy', 'true');
    deleteProgress.oncancel = event => event.preventDefault();
    if (!deleteProgress.open) deleteProgress.showModal();
  }
  function closeDeleteProgress() {
    clearTimeout(deleteProgressTimer);
    deleteProgress.close();
  }
  deleteProgress.querySelector('.delete-progress-close').onclick = closeDeleteProgress;
  const deleteDialog = document.createElement('dialog');
  deleteDialog.className = 'operator-dialog';
  deleteDialog.innerHTML = '<h2>ELIMINAR ORDEN Y CARPETA NAS</h2><p>Se eliminarán la tarjeta y todos los archivos de esta carpeta de la orden. No se tocarán otras carpetas.</p><p class="delete-folder" style="overflow-wrap:anywhere"></p><label>Escribe el número de orden para confirmar<input class="delete-order" autocomplete="off"></label><p class="delete-error" role="alert"></p><div style="display:flex;gap:12px;margin-top:16px"><button type="button" class="delete-cancel">CANCELAR</button><button type="button" class="delete-confirm" disabled style="background:#963b35;color:white">ELIMINAR TARJETA Y CARPETA</button></div>';
  document.body.appendChild(deleteDialog);
  deleteDialog.querySelector('.delete-order').closest('label').remove();
  const passwordEye = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="password-eye-slash" d="m3 3 18 18" style="display:none"/></svg>';
  deleteDialog.querySelector('.delete-error').insertAdjacentHTML('beforebegin','<style>.operator-dialog .delete-password-field{position:relative;display:block;width:100%;margin-top:8px}.operator-dialog .delete-password-field input{display:block;box-sizing:border-box;width:100%!important;max-width:none;min-width:0;height:52px;margin:0;padding:12px 56px 12px 14px;border:1px solid #718174;border-radius:10px;background:#25312a;color:#fff;font-size:16px}.operator-dialog .delete-password-field input:focus{outline:2px solid #d4ec98;outline-offset:2px}.operator-dialog .delete-password-field .delete-password-toggle{position:absolute;right:5px;top:4px;display:flex;align-items:center;justify-content:center;width:44px!important;min-width:44px;max-width:44px;height:44px;min-height:44px;margin:0;padding:0;flex:none;background:transparent!important;border:0;border-radius:8px;box-shadow:none!important;color:#d4ec98;cursor:pointer;transform:none}.operator-dialog .delete-password-field .delete-password-toggle:hover{background:#ffffff12!important}.operator-dialog .delete-password-field .delete-password-toggle:focus-visible{outline:2px solid #d4ec98;outline-offset:-2px}</style><label for="delete-account-password">Contraseña de tu cuenta</label><div class="delete-password-field"><input id="delete-account-password" class="delete-password" type="password" autocomplete="current-password" placeholder="Escribe tu contraseña" maxlength="256" required><button type="button" class="delete-password-toggle" title="Ver contraseña" aria-label="Ver contraseña" aria-controls="delete-account-password" aria-pressed="false">'+passwordEye+'</button></div>');
  const passwordToggle = deleteDialog.querySelector('.delete-password-toggle');
  function resetDeletePassword() {
    const input = deleteDialog.querySelector('.delete-password');
    input.value = '';input.type = 'password';
    passwordToggle.querySelector('.password-eye-slash').style.display = 'none';
    passwordToggle.title = 'Ver contraseña';
    passwordToggle.setAttribute('aria-label', 'Ver contraseña');
    passwordToggle.setAttribute('aria-pressed', 'false');
  }
  passwordToggle.onclick = () => {
    const input = deleteDialog.querySelector('.delete-password');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    passwordToggle.querySelector('.password-eye-slash').style.display = visible ? '' : 'none';
    passwordToggle.title = visible ? 'Ocultar contraseña' : 'Ver contraseña';
    passwordToggle.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Ver contraseña');
    passwordToggle.setAttribute('aria-pressed', String(visible));
  };
  function confirmFolderDeletion(info) {
    return new Promise(resolve => {
      const passwordInput = deleteDialog.querySelector('.delete-password'), confirmButton = deleteDialog.querySelector('.delete-confirm');
      deleteDialog.querySelector('.delete-folder').textContent = info.folder;
      deleteDialog.querySelector('.delete-error').textContent = 'Orden: '+info.order+'. Se conservará una copia de recuperación en el servidor.';
      resetDeletePassword();confirmButton.disabled=true;
      passwordInput.oninput=()=>{confirmButton.disabled=!passwordInput.value;};
      const finish=value=>{resetDeletePassword();deleteDialog.close();resolve(value);};
      confirmButton.onclick=()=>{if(passwordInput.value)finish(passwordInput.value);};
      deleteDialog.querySelector('.delete-cancel').onclick=()=>finish(false);
      deleteDialog.oncancel=event=>{event.preventDefault();finish(false);};
      deleteDialog.showModal();passwordInput.focus();
    });
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-card-delete],.production-delete-row');
    if (!button || !canDelete) return;
    event.preventDefault();event.stopImmediatePropagation();
    const id = Number(button.dataset.cardDelete || button.closest('[data-source-row]')?.dataset.sourceRow);
    if (deletingRows.size) return;
    const row = productionData?.rows.find(r => Number(r.source_row) === id);
    if (!row) return;
    deletingRows.add(id);button.disabled = true;
    showDeleteProgress('VERIFICANDO ORDEN', 'Consultando la ruta exacta de la carpeta en el NAS…');
    try {
      const previewResponse = await fetch('/api/produccion/fila/' + id + '/eliminacion');
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.detail || 'No se pudo verificar la carpeta NAS');
      closeDeleteProgress();
      let password = await confirmFolderDeletion(preview);
      if (!password) return;
      showDeleteProgress('ELIMINANDO ' + preview.order, 'El servidor está procesando la solicitud: validación, copia de recuperación y eliminación de la carpeta y la tarjeta. No cierres ni recargues esta página.', preview.folder);
      deleteProgressTimer = setTimeout(() => {
        deleteProgress.querySelector('.delete-progress-message').textContent = 'La operación sigue en curso. Puede tardar según el tamaño de la carpeta y la conexión al NAS. Espera la confirmación; no vuelvas a enviarla.';
      }, 20000);
      let response;
      try {
        response = await fetch('/api/produccion/fila/' + id, {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({order:preview.order,confirmation:preview.confirmation,password})});
      } finally { password = ''; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'No se pudo eliminar la orden');
      productionData.rows = productionData.rows.filter(r => Number(r.source_row) !== id);
      traceAssets.delete(id);renderTraceCards();
      clearTimeout(deleteProgressTimer);
      deleteProgress.querySelector('.delete-progress-title').textContent = 'ELIMINACIÓN COMPLETADA';
      deleteProgress.querySelector('progress').value = 1;
      deleteProgress.querySelector('progress').setAttribute('aria-label', 'Eliminación completada');
      deleteProgress.querySelector('.delete-progress-message').textContent = 'La tarjeta y la carpeta se eliminaron. Se conservó una copia de recuperación. Si la carpeta sigue visible en el Explorador, cierra su pestaña y pulsa F5.';
      deleteProgress.querySelector('.delete-progress-close').hidden = false;
      deleteProgress.setAttribute('aria-busy', 'false');
      deleteProgress.oncancel = () => clearTimeout(deleteProgressTimer);
      productionStatus.textContent = '✓ Tarjeta y carpeta de la orden eliminadas. Copia de recuperación conservada en el servidor.';
      try { await loadProduction(); } catch (_) { productionStatus.textContent += ' No se pudo refrescar el listado; actualiza la página.'; }
    } catch (error) {
      closeDeleteProgress();
      if (error instanceof TypeError) error = new Error('Se perdió la conexión. No se pudo confirmar el resultado. Actualiza el listado y comprueba la carpeta antes de volver a eliminar.');
      productionStatus.textContent = error.message;
      deleteDialog.querySelector('.delete-folder').textContent = '';
      deleteDialog.querySelector('.delete-error').textContent = error.message;
      deleteDialog.querySelector('.delete-confirm').disabled=true;
      deleteDialog.querySelector('.delete-cancel').onclick=()=>deleteDialog.close();
      deleteDialog.showModal();
    } finally { deletingRows.delete(id);button.disabled=false;renderTraceCards(); }
  }, true);
  const profile = document.querySelector('.user-info small')?.textContent || '';
  const ownProcess = processForProfile(profile);
  const defaultFilter = 'all';
  let ownAreaFilter = false;
  let navigationProcess = null;

  const originalOpenProduction = openOperatorProduction;
  openOperatorProduction = function(id) {
    originalOpenProduction(id);
    const area = key(document.querySelector('.user-info small')?.textContent);
    const groups = groupsFor(productionData, productionData.rows.find(r => r.source_row === id), processStatusHeaders);
    operatorForm.elements.column.innerHTML = '<option value="">Selecciona un proceso</option>' + groups.filter(g => isAdmin || g.label === ownProcess?.label).map(g => '<option value="' + (g.start+1) + '">' + esc(g.label) + '</option>').join('');
    const process = flow.find(p => [key(p.label), ...p.headers, ...p.aliases].includes(area));
    const selected = groups.find(g => g.label === process?.label);
    if (selected) operatorForm.elements.column.value = String(selected.start+1);
    operatorSelection();
    operatorDialog.querySelector('.operator-message').textContent = selected ? 'Proceso seleccionado según tu perfil. La fecha y hora se guardan automáticamente.' : 'Selecciona uno de los procesos de Indoor.';
  };
  updateProcessFilter = function() {
    const labels = new Map(flow.map(p => [key(p.label), p.label]));
    if (navigationProcess) selectedProcess = key(navigationProcess.label);
    else if (!isAdmin) selectedProcess = ownAreaFilter && ownProcess ? key(ownProcess.label) : '';
    if (!labels.has(selectedProcess)) selectedProcess = '';
    const signature = JSON.stringify([...labels]);
    if (productionProcess.dataset.signature !== signature) {
      productionProcess.replaceChildren(new Option('Todos los procesos', ''));
      labels.forEach((label, id) => productionProcess.add(new Option(label, id)));
      productionProcess.dataset.signature = signature;
    }
    productionProcess.value = selectedProcess;
    productionProcess.disabled = !isAdmin;
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
  const filters = isAdmin ? [['all', 'Todos'], ['work', 'Mi trabajo del día'], ['mine', 'Mis pedidos'], ['late', 'Atrasados'], ['active', 'En proceso'], ['rework', 'Reproceso'], ['finished', 'Terminados']] : [['all', 'Todos'], ['pending', 'Por fabricar'], ['mine', 'A mi cargo'], ['active', 'En proceso'], ['rework', 'Reproceso'], ['late', 'Atrasados'], ['finished', 'Terminados']];
  let filter = defaultFilter;
  if (isAdmin) filters.splice(1, 0, ['pending', 'Por fabricar']);
  let currentPage = 1, pageQuery = '';
  const user = { name: document.querySelector('.user-info strong')?.textContent || '', initials: document.querySelector('.user-avatar')?.textContent || '' };
  const toolbar = document.createElement('section');
  toolbar.className = 'trace-workspace';
  toolbar.setAttribute('aria-label', 'Filtros de trazabilidad');
  toolbar.innerHTML = '<div class="trace-workspace-top"><div><h3>Pedidos en seguimiento</h3></div><span class="trace-live">Actualización automática</span></div><div class="trace-quick-filters" role="group" aria-label="Estado de los pedidos">' + filters.map(([id, label]) => '<button type="button" data-trace-filter="' + id + '" aria-pressed="' + (id === 'all') + '">' + label + '<span>0</span></button>').join('') + '</div><p class="trace-results" role="status" aria-live="polite"></p>';
  traceCards.before(toolbar);
  const pager = document.createElement('nav');
  pager.className = 'trace-pagination';
  pager.setAttribute('aria-label', 'Páginas de pedidos');
  toolbar.appendChild(pager);
  function pageMarkup(result) {
    const numbers = [...new Set([1, result.pages, result.page-2, result.page-1, result.page, result.page+1, result.page+2])].filter(n => n >= 1 && n <= result.pages).sort((a,b) => a-b);
    return '<span class="trace-page-count">Página ' + result.page + ' de ' + result.pages + '</span><button type="button" data-trace-page="' + (result.page-1) + '"' + (result.page===1?' disabled':'') + '>Anterior</button>' + numbers.map((n,i) => (i && n>numbers[i-1]+1 ? '<span aria-hidden="true">…</span>' : '') + '<button type="button" data-trace-page="' + n + '" aria-label="Página ' + n + '"' + (n===result.page?' aria-current="page"':'') + '>' + n + '</button>').join('') + '<button type="button" data-trace-page="' + (result.page+1) + '"' + (result.page===result.pages?' disabled':'') + '>Siguiente</button>';
  }
  function changePage(event) {
    const button = event.target.closest('[data-trace-page]');
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.tracePage);
    traceCards.scrollTop = 0;
    renderTraceCards();
    if (getComputedStyle(traceCards).overflowY === 'visible') pager.scrollIntoView({ block: 'start' });
    pager.querySelector('[aria-current="page"]')?.focus({ preventScroll:true });
  }
  pager.addEventListener('click', changePage);
  traceCards.addEventListener('click', changePage);
  const areaButton = document.createElement('button');
  areaButton.type = 'button';
  areaButton.className = 'trace-area-toggle';
  areaButton.textContent = 'PROCESO AL QUE PERTENECES';
  areaButton.setAttribute('aria-pressed', 'false');
  areaButton.title = ownProcess ? ownProcess.label : 'Tu usuario no tiene un proceso de fabricación asignado';
  areaButton.disabled = !ownProcess;
  toolbar.querySelector('.trace-workspace-top').appendChild(areaButton);
  areaButton.onclick = () => {
    navigationProcess = null;
    ownAreaFilter = !ownAreaFilter;
    filter = ownAreaFilter ? 'pending' : 'all';
    updateProcessFilter();
    traceCards.scrollTop = 0;
    renderTraceCards();
  };
  const productionNav = document.querySelector('.production-nav');
  // Retain the internal navigation handler for calendar/admin links, not a menu entry.
  productionNav.hidden = true;
  productionNav.style.setProperty('display', 'none', 'important');
  const processNavigation = [];
  productionNav.addEventListener('click', () => {
    navigationProcess = null;
    ownAreaFilter = false;
    filter = 'all';
    selectedProcess = '';
    processNavigation.forEach(button => button.classList.remove('active'));
  }, true);
  flow.forEach((process, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab process-nav';
    button.dataset.kind = 'produccion';
    button.innerHTML = '<span class="nav-icon">' + (index + 1) + '</span><strong>' + esc(process.label.toUpperCase()) + '</strong>';
    button.onclick = () => {
      productionNav.click();
      navigationProcess = process;
      filter = 'pending';
      exactScheduleOrder = '';
      productionSearch.value = '';
      traceCards.scrollTop = 0;
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
      renderProduction();
    };
    processNavigation.push(button);
    productionNav.parentElement.appendChild(button);
  });
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
    summary = summary.route || summary; // Keep all twelve connected stages, independent of the operator queue.
    return '<section class="trace-route"><div class="trace-route-heading"><h4>Ruta de producción</h4><span>' + summary.finished + '/' + summary.total + ' procesos</span></div><div class="trace-progress" role="progressbar" aria-label="Procesos terminados" aria-valuemin="0" aria-valuemax="' + summary.total + '" aria-valuenow="' + summary.finished + '"><span style="width:' + summary.percent + '%"></span></div><div class="trace-nodes" style="--nodes:' + Math.max(1, summary.total) + '">' + summary.groups.map((group, i) => '<button type="button" class="trace-node ' + group.state + '" data-node-row="' + row.source_row + '" data-node-index="' + i + '" title="' + esc(group.label + ' · ' + group.status) + '" aria-label="' + esc(group.label + ': ' + group.status) + '"><span class="trace-node-dot" aria-hidden="true">' + (group.state === 'finished' ? '✓' : group.state === 'rework' ? '!' : group.state === 'active' ? '●' : i + 1) + '</span><span class="trace-node-label">' + esc(abbreviations[group.key] || group.label.slice(0, 3)) + '</span></button>').join('') + '</div><p class="trace-route-caption">' + (summary.state === 'finished' ? 'Ruta completada' : esc((summary.state === 'rework' ? 'Revisar: ' : summary.state === 'active' ? 'Ahora: ' : 'Siguiente: ') + (summary.focus?.label || 'Sin proceso asignado'))) + '<span>Pulsa un punto para ver detalles</span></p></section>';
  }
  renderTraceCards = function () {
    if (!productionData || traceView !== 'cards') return;
    let scrollTop = traceCards.scrollTop;
    const focused = document.activeElement;
    const focusKey = focused?.closest('[data-card-row]')?.dataset.cardRow;
    const focusAttribute = ['data-card-edit', 'data-card-detail', 'data-card-nas', 'data-node-index', 'data-design-index'].find(a => focused?.hasAttribute(a));
    const focusValue = focusAttribute ? focused.getAttribute(focusAttribute) : null;
    traceImageObserver.disconnect();
    const visible = new Set([...productionBody.querySelectorAll('tr')].map(tr => Number(tr.querySelector('td[data-row]')?.dataset.row)));
    const base = productionData.rows.filter(row => visible.has(row.source_row) && ['ORDEN', 'NOMBRE DEL CLIENTE', 'NOMBRE PROYECTO', 'REFERENCIA'].some(name => traceField(row, name).trim()));
    const fullSummaries = new Map(base.map(row => [row.source_row, summarize(productionData, row, processStatusHeaders, user, scheduleToday())]));
    const forView = (row, stateFilter) => navigationProcess
      ? processQueueSummary(fullSummaries.get(row.source_row), navigationProcess.label, user, scheduleToday())
      : summaryForView(fullSummaries.get(row.source_row), stateFilter, profile, user, scheduleToday(), isAdmin, ownAreaFilter);
    const summaries = new Map(base.map(row => [row.source_row, forView(row, filter)]));
    const match = isAdmin && !ownAreaFilter && !navigationProcess ? matches : queueMatches;
    areaButton.setAttribute('aria-pressed', String(ownAreaFilter));
    toolbar.querySelector('h3').textContent = navigationProcess ? navigationProcess.label + ' · Producción' : ownAreaFilter || (!isAdmin && filter !== 'all') ? (ownProcess?.label || 'Proceso sin asignar') + ' · Trabajo entre turnos' : 'Todos los pedidos programados';
    toolbar.querySelectorAll('[data-trace-filter]').forEach(button => { button.hidden = ownAreaFilter; });
    const query = JSON.stringify([filter, ownAreaFilter, selectedProcess, productionSearch.value, exactScheduleOrder]);
    if (pageQuery !== query) { currentPage = 1; pageQuery = query; scrollTop = 0; }
    const pageResult = paginate(orderByDelivery(base.filter(row => match(summaries.get(row.source_row), filter)), productionData.headers), currentPage);
    currentPage = pageResult.page;
    const rows = pageResult.rows;
    pager.hidden = pageResult.pages <= 1;
    pager.innerHTML = pageResult.pages > 1 ? pageMarkup(pageResult) : '';
    toolbar.querySelectorAll('[data-trace-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.traceFilter === filter));
      button.querySelector('span').textContent = base.filter(row => match(forView(row, button.dataset.traceFilter), button.dataset.traceFilter)).length;
    });
    toolbar.querySelector('.trace-results').textContent = 'Mostrando ' + pageResult.start + '–' + pageResult.end + ' de ' + pageResult.total + ' tarjetas · Entrega: de más próxima a más lejana' + (filter === 'mine' ? ' · Asignadas a tu usuario' : '');
    traceCards.innerHTML = rows.map(row => {
      const summary = summaries.get(row.source_row), id = row.source_row;
      const notes = Object.entries(productionData.notes || {}).filter(([k, v]) => k.startsWith(id + ':') && v).length;
      const responsible = summary.focus?.responsible || '';
      const due = traceField(row, 'FECHA DE ENTREGA');
      const dueLabel = !summary.due ? 'Sin fecha' : summary.overdue ? 'Atrasado' : summary.state !== 'finished' && summary.due.getTime() === scheduleToday().getTime() ? 'Entrega hoy' : 'Entrega';
      return '<article class="trace-card state-' + summary.state + '" data-card-row="' + id + '"><div class="trace-media">' + traceAssetsMarkup(id) + '</div><div class="trace-card-body"><div class="trace-card-heading"><h3>' + esc(traceField(row, 'ORDEN') || 'Sin número') + '</h3><span class="trace-stage ' + summary.state + '">' + labels[summary.state] + '</span></div><p class="trace-client">' + esc(traceField(row, 'NOMBRE DEL CLIENTE') || 'Sin cliente') + '</p><p class="trace-project">' + esc(traceField(row, 'NOMBRE PROYECTO')) + '</p><dl><div><dt>Referencia</dt><dd>' + esc(traceField(row, 'REFERENCIA') || '—') + '</dd></div><div><dt>Cantidad</dt><dd class="trace-quantity">' + esc(traceField(row, 'CANTIDAD') || '0') + ' <small>und.</small></dd></div><div class="trace-due ' + (summary.overdue ? 'late' : '') + '"><dt>' + dueLabel + '</dt><dd>' + esc(summary.due ? displayProductionDate(due) : 'Sin programar') + '</dd></div><div><dt>Responsable del proceso</dt><dd>' + (responsible ? responsible.split(/[,;·\n]+/).filter(x => x.trim()).map(name => '<span class="trace-person">' + esc(name.trim()) + '</span>').join(' ') : '<span class="trace-unassigned">Sin asignar</span>') + '</dd></div></dl><div class="trace-card-meta"><span>' + notes + ' nota' + (notes === 1 ? '' : 's') + '</span><span>Fila ' + id + '</span></div><div class="trace-card-actions"><button type="button" class="operator-open" data-card-edit="' + id + '">PRODUCCIÓN</button><button type="button" data-card-detail="' + id + '">Ver detalle</button><button type="button" data-card-nas="' + id + '" aria-label="Abrir carpeta del pedido">NAS ↗</button></div></div>' + routeMarkup(row, summary) + '</article>';
    }).join('') || '<div class="trace-empty"><h3>No hay pedidos en esta vista</h3><p>' + (filter === 'mine' ? 'No hay responsables que coincidan con tu usuario o iniciales. Prueba Todos o revisa la asignación.' : 'Prueba otro estado o cambia la búsqueda.') + '</p><button type="button" data-clear-trace>Ver todos</button></div>';
    traceCards.querySelectorAll('[data-card-row]').forEach(card => traceImageObserver.observe(card));
    if (pageResult.pages > 1) traceCards.insertAdjacentHTML('beforeend', '<nav class="trace-pagination trace-pagination-bottom" aria-label="Páginas de pedidos al final">' + pageMarkup(pageResult) + '</nav>');
    if (ownAreaFilter && !rows.length) {
      traceCards.querySelector('.trace-empty p').textContent = ownProcess ? 'No hay pendientes para tu área. Desactiva PROCESO AL QUE PERTENECES para consultar todos los pedidos.' : 'Administración debe asignar un proceso de Indoor a tu cuenta.';
      traceCards.querySelector('[data-clear-trace]').textContent = 'Limpiar búsqueda';
    }
    traceCards.querySelectorAll('[data-card-row]').forEach(card => {
      const row = rows.find(r => r.source_row === Number(card.dataset.cardRow));
      if (canDelete) {
        const button = document.createElement('button');
        button.type = 'button';button.textContent = 'ELIMINAR';button.dataset.cardDelete = row.source_row;
        button.disabled = deletingRows.has(Number(row.source_row));
        button.setAttribute('aria-label', 'Eliminar orden ' + traceField(row, 'ORDEN') + ', fila ' + row.source_row);
        button.style.cssText = 'grid-column:1/-1;color:#ffb5ae!important;border-color:#8c524c!important;background:#392323!important';
        card.querySelector('.trace-card-actions').appendChild(button);
      }
      const viewSummary = summaries.get(row.source_row);
      const progressSummary = viewSummary.route || viewSummary;
      const progress = card.querySelector('.trace-progress');
      const caption = card.querySelector('.trace-route-caption');
      caption.querySelector('span').textContent = progressSummary.percent + '% COMPLETADO';
      caption.querySelector('span').classList.add('trace-progress-percent');
      progress.setAttribute('aria-valuemax', '100');
      progress.setAttribute('aria-valuenow', String(progressSummary.percent));
      progress.setAttribute('aria-valuetext', progressSummary.percent + '% · ' + progressSummary.finished + ' de ' + progressSummary.total + ' procesos cerrados');
      progress.title = 'Avance por procesos cerrados. Incluye No aplica y cierres automáticos; un reproceso vuelve a quedar pendiente.';
      caption.after(progress);
      const description = ['PRODUCTO', 'DESCRIPCIÓN', 'DESCRIPCION', 'PRENDA'].map(h => traceField(row, h)).find(v => v.trim());
      const fabric = traceField(row, 'TELA'), observation = traceField(row, 'OBSERVACIONES');
      const details = (fabric ? '<span><small>TELA</small><strong>' + esc(fabric) + '</strong></span>' : '');
      const notes = Object.entries(productionData.notes || {}).filter(([k,v]) => k.startsWith(row.source_row + ':') && v);
      card.querySelector('.trace-project').insertAdjacentHTML('afterend', '<section class="trace-manufacture"><span class="trace-eyebrow">A FABRICAR</span><h4>' + esc(description || traceField(row, 'REFERENCIA') || 'Producto por especificar') + '</h4>' + (details ? '<div class="trace-material-facts">' + details + '</div>' : '') + (observation ? '<p class="trace-production-note"><strong>INDICACIONES</strong>' + esc(observation) + '</p>' : '') + (notes.length ? '<details class="trace-inline-notes"><summary>Ver ' + notes.length + ' indicación' + (notes.length === 1 ? '' : 'es') + ' de procesos</summary>' + notes.map(([k,v]) => '<p><strong>' + esc(productionData.headers[Number(k.split(':')[1])-1]) + '</strong>' + esc(v) + '</p>').join('') + '</details>' : '') + '</section>');
      card.querySelector('[data-card-detail]').textContent = 'LISTADO Y DETALLES';
      if (notes.length) {
        card.classList.add('has-notes');
        const notePanel = document.createElement('section');
        notePanel.className = 'trace-inline-notes trace-note-alert';
        notePanel.setAttribute('aria-label', 'Observaciones de la orden');
        notePanel.innerHTML = notes.flatMap(([k,v]) => (productionData.note_entries?.[k] || [{text: String(v), author: ''}]).map(note => ({...note, column: Number(k.split(':')[1])}))).map(note => {
          const attribution = noteAttribution(productionData, row, note.column, note.author, note.source);
          const title = attribution.name ? (attribution.inferred ? 'Responsable del área: ' : 'Autor: ') + attribution.name : 'Sin autor ni responsable registrado en esta área';
          return '<p title="'+esc(title)+'">'+noteBadges(attribution)+'<span class="trace-note-text">'+esc(String(note.text).replace(/\s+/g, ' ').trim())+'</span><button type="button" class="trace-note-delete" data-note-row="'+row.source_row+'" data-note-column="'+note.column+'" aria-label="Eliminar nota" title="Eliminar nota">×</button></p>';
        }).join('');
        card.querySelector('.trace-inline-notes').remove();
        card.querySelector('.trace-project').after(notePanel);
        const counter = card.querySelector('.trace-card-meta span');
        counter.classList.add('trace-note-count');
        counter.textContent = '✎ '+notes.length+' nota'+(notes.length === 1 ? '' : 's');
      }
      card.querySelector('.trace-card-heading h3').setAttribute('aria-label', 'Orden ' + traceField(row, 'ORDEN'));
      const body = card.querySelector('.trace-card-body');
      const important = card.querySelector('.trace-production-note');
      if (important) {
        let notePanel = body.querySelector('.trace-note-alert');
        if (!notePanel) {
          notePanel = document.createElement('section');
          notePanel.className = 'trace-inline-notes trace-note-alert';
          notePanel.setAttribute('aria-label', 'Observaciones de la orden');
          body.querySelector('.trace-project').after(notePanel);
        }
        const attribution = noteAttribution(productionData, row, productionData.headers.findIndex(header => key(header) === 'OBSERVACIONES') + 1, '', 'listado');
        important.title = attribution.name ? 'Responsable del área: ' + attribution.name : 'Sin responsable registrado en esta área';
        important.innerHTML = noteBadges(attribution) + '<span class="trace-note-text">' + esc(observation.replace(/\s+/g, ' ').trim()) + '</span>';
        if (!notes.some(([k,v]) => String(v).trim() === observation.trim())) notePanel.prepend(important);
        else important.remove();
      }
      const disclosure = document.createElement('div');
      const facts = document.createElement('dl');
      facts.className = 'trace-primary-facts';
      body.querySelectorAll(':scope > dl > div').forEach(item => {
        if (['REFERENCIA', 'CANTIDAD'].includes(key(item.querySelector('dt')?.textContent))) facts.appendChild(item);
      });
      body.querySelector('.trace-project').after(facts);
      disclosure.className = 'trace-disclosure';
      disclosure.id = 'trace-disclosure-' + row.source_row;
      body.querySelectorAll(':scope > .trace-manufacture,:scope > dl:not(.trace-primary-facts),:scope > .trace-card-meta').forEach(item => disclosure.appendChild(item));
      body.appendChild(disclosure);
      disclosure.hidden = true;
      const toggle = card.querySelector('[data-card-detail]');
      toggle.type = 'button'; toggle.className = 'trace-disclosure-toggle';
      toggle.setAttribute('aria-haspopup', 'dialog');
      toggle.setAttribute('aria-label', 'Detalles de la orden ' + traceField(row, 'ORDEN'));
      toggle.textContent = '☰';
      card.prepend(toggle);
    });
    traceCards.scrollTop = scrollTop;
    if (focusKey && focusAttribute) traceCards.querySelector('[data-card-row="' + focusKey + '"] [' + focusAttribute + '="' + focusValue + '"]')?.focus({ preventScroll: true });
    fitTraceCards();
    refreshOperatorActions();
  };
  // Boton "X" en cada nota: la borra por completo (misma API que el editor de notas de la tabla).
  traceCards.addEventListener('click', async event => {
    const delBtn = event.target.closest('.trace-note-delete');
    if (!delBtn) return;
    event.preventDefault();
    event.stopPropagation();
    const row = Number(delBtn.dataset.noteRow), column = Number(delBtn.dataset.noteColumn);
    if (!confirm('¿Eliminar esta nota?')) return;
    delBtn.disabled = true;
    try {
      const response = await fetch('/api/produccion/nota', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ row, column, note: '' }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || 'No se pudo eliminar la nota'); }
      if (productionData.notes) delete productionData.notes[row + ':' + column];
      if (productionData.note_entries) delete productionData.note_entries[row + ':' + column];
      renderTraceCards();
    } catch (error) {
      alert(error.message);
      delBtn.disabled = false;
    }
  });
  // Resolve NAS from the card's source data, never from filtered table rows.
  // Reuse the existing NAS progress/resolver handler and its platform support.
  traceCards.addEventListener('click', event => {
    const button = event.target.closest('[data-card-nas]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const row = productionData.rows.find(item => Number(item.source_row) === Number(button.dataset.cardNas));
    const order = row && traceField(row, 'ORDEN').trim();
    if (!order) {
      nasNotice.hidden = false;
      nasNotice.querySelector('.nas-title').textContent = 'Acceso al NAS';
      nasNotice.querySelector('.nas-retry').hidden = true;
      nasProgress(0, 'Esta tarjeta no tiene número de orden. Completa ese dato para localizar su carpeta.');
      return;
    }
    const bridge = document.createElement('tr');
    bridge.hidden = true;
    const cell = document.createElement('td');
    cell.innerHTML = productionRowButton(row.source_row, order, traceField(row, 'NOMBRE DEL CLIENTE'), traceField(row, 'NOMBRE PROYECTO'));
    bridge.appendChild(cell);
    productionBody.appendChild(bridge);
    try { cell.querySelector('.production-row-open').click(); }
    finally { bridge.remove(); }
  }, true);
  traceCards.addEventListener('click', event => {
    if (event.target.closest('[data-clear-trace]')) { filter = ownAreaFilter ? 'pending' : defaultFilter; exactScheduleOrder = ''; productionSearch.value = ''; renderProduction(); renderTraceCards(); return; }
    const button = event.target.closest('[data-node-row]'); if (!button) return;
    const id = Number(button.dataset.nodeRow), row = productionData.rows.find(r => r.source_row === id);
    if (!row) return;
    const group = groupsFor(productionData, row, processStatusHeaders)[Number(button.dataset.nodeIndex)];
    nodeDialog.dataset.row = String(id);
    nodeDialog.dataset.index = button.dataset.nodeIndex;
    const fields = group.columns.filter(i => String(row.values[i] || '').trim()).map(i => '<div><dt>' + esc(productionData.headers[i]) + '</dt><dd>' + esc(displayProductionDate(String(row.values[i]))) + '</dd></div>').join('');
    // Show instructions from every process, not only the node being inspected.
    const order = key(traceField(row, 'ORDEN'));
    const client = key(traceField(row, 'NOMBRE DEL CLIENTE'));
    const orderRows = productionData.rows.filter(item => item.source_row === id ||
      (order && key(traceField(item, 'ORDEN')) === order && key(traceField(item, 'NOMBRE DEL CLIENTE')) === client));
    const noteItems = orderRows.flatMap(item => Object.entries(productionData.notes || {})
      .filter(([noteKey, text]) => noteKey.startsWith(item.source_row + ':') && String(text || '').trim())
      .map(([noteKey, text]) => '<article><strong>' + esc(productionData.headers[Number(noteKey.split(':')[1]) - 1] || 'OBSERVACIÓN') +
        (item.source_row !== id ? ' · ' + esc(traceField(item, 'REFERENCIA')) : '') +
        '</strong><p class="trace-full-note">' + esc(String(text)) + '</p></article>')).join('');
    const notes = noteItems ? '<section class="trace-process-notes" aria-label="Notas de todos los procesos de la orden"><h3>OBSERVACIONES DE LA ORDEN</h3>' + noteItems + '</section>' : '';
    nodeDialog.querySelector('.trace-node-content').innerHTML = '<span class="trace-eyebrow">' + esc(traceField(row, 'ORDEN')) + '</span><h2 id="trace-node-heading">' + esc(group.label) + '</h2><span class="trace-stage ' + group.state + '">' + group.status + '</span><p>Responsable: <strong>' + esc(group.responsible || 'Sin asignar') + '</strong></p><dl>' + fields + '</dl>' + notes + (!fields ? '<p>Este proceso aún no tiene registros.</p>' : '') + '<p class="trace-node-hint">Registra la actividad desde PRODUCCIÓN. El proceso se selecciona según el perfil del usuario conectado.</p><button type="button" class="trace-register">Ir a PRODUCCIÓN</button>';
    nodeDialog.querySelector('.trace-register').onclick = () => { nodeDialog.close(); openOperatorProduction(id); };
    const historyNotes = document.createElement('section');
    historyNotes.className = 'trace-process-notes';
    historyNotes.setAttribute('aria-label', 'Observaciones registradas por los operarios');
    historyNotes.setAttribute('aria-live', 'polite');
    historyNotes.textContent = 'Consultando observaciones de los procesos…';
    nodeDialog.querySelector('.trace-node-hint').before(historyNotes);
    // Reasons belong to the activity history, not to the spreadsheet notes.
    // Keep this element captured so a late response cannot update another dialog.
    Promise.allSettled(orderRows.map(async item => {
      const response = await fetch('/api/produccion/operaciones/' + item.source_row, { cache: 'no-store' });
      if (!response.ok) throw Error('No se pudo consultar el historial');
      const events = await response.json();
      if (!Array.isArray(events)) throw Error('Historial inválido');
      return events.filter(entry => String(entry.reason || '').trim() && key(entry.action) !== 'CIERRE AUTOMATICO')
        .map(entry => ({ ...entry, reference: traceField(item, 'REFERENCIA') }));
    })).then(results => {
      if (!historyNotes.isConnected || !nodeDialog.open) return;
      const events = results.filter(result => result.status === 'fulfilled').flatMap(result => result.value)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const actionLabels = { rework: 'REPROCESO', start: 'INICIO / RETOMA', finish: 'TERMINADO', na: 'NO APLICA' };
      historyNotes.innerHTML = events.length ? '<h3>NOTAS Y MOTIVOS DE LOS PROCESOS</h3>' + events.map(entry =>
        '<article><strong>' + esc(productionData.headers[Number(entry.column_number) - 1] || 'PROCESO') +
        ' · ' + esc(actionLabels[entry.action] || entry.action) +
        (orderRows.length > 1 ? ' · ' + esc(entry.reference) : '') + '</strong>' +
        '<p class="trace-full-note">' + esc(String(entry.reason)) + '</p>' +
        '<small>' + esc(entry.responsible || entry.username || '') + '</small></article>').join('') : '';
      if (results.some(result => result.status === 'rejected')) {
        historyNotes.insertAdjacentHTML('beforeend', '<p>No se pudieron cargar todas las observaciones. Cierra y vuelve a abrir el panel para reintentar.</p>');
      }
      historyNotes.hidden = !historyNotes.innerHTML;
    });
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
  function refreshOperatorActions() {
    if (nodeDialog.open) {
      const nodeRow = productionData?.rows.find(item => item.source_row === Number(nodeDialog.dataset.row));
      const nodeGroup = nodeRow && groupsFor(productionData, nodeRow, processStatusHeaders)[Number(nodeDialog.dataset.index)];
      if (nodeGroup) {
        const badge = nodeDialog.querySelector('.trace-stage');
        badge.className = 'trace-stage ' + nodeGroup.state;
        badge.textContent = nodeGroup.status;
        nodeDialog.querySelector('.trace-node-content > p > strong').textContent = nodeGroup.responsible || 'Sin asignar';
        nodeDialog.querySelector('dl').innerHTML = nodeGroup.columns.filter(i => String(nodeRow.values[i] || '').trim()).map(i => '<div><dt>' + esc(productionData.headers[i]) + '</dt><dd>' + esc(displayProductionDate(String(nodeRow.values[i]))) + '</dd></div>').join('');
      }
    }
    if (operatorSaving) return;
    const row = productionData?.rows.find(r => r.source_row === operatorRow);
    const i = Number(operatorForm.elements.column.value) - 1;
    const value = row && i >= 0 ? key(row.values[i]) : '';
    const closed = value === 'N/A' || !!dateValue(value);
    operatorForm.querySelectorAll('.operator-actions button').forEach(button => {
      button.disabled = !row || i < 0 || (button.value === 'clear' ? !value : (closed && button.value !== 'rework') || (value === 'P' && button.value === 'start'));
    });
    if (row && i >= 0 && operatorDialog.open) {
      operatorDialog.querySelector('.operator-current').className = 'operator-current trace-stage ' + (closed ? 'finished' : value === 'P' ? 'active' : value === 'R' ? 'rework' : 'pending');
      operatorDialog.querySelector('.operator-current').textContent = closed ? 'Este proceso ya está terminado. Solo se puede reabrir con un motivo de reproceso.' : 'Estado actual: ' + (value === 'P' ? 'En proceso' : value === 'R' ? 'Reproceso' : 'Pendiente');
    }
    if (row && operatorDialog.open && operatorDialog.querySelector('.studio-stages')) {
      const summary = summarize(productionData, row, processStatusHeaders, user, scheduleToday());
      operatorDialog.querySelector('.studio-progress-label strong').textContent = summary.percent + '%';
      operatorDialog.querySelector('progress').value = summary.percent;
      operatorDialog.querySelector('.studio-context > .studio-caption').textContent = summary.finished + ' de ' + summary.total + ' procesos cerrados · Incluye cierres automáticos y No aplica.';
      operatorDialog.querySelectorAll('.studio-stages > span').forEach((node, index) => {
        const group = summary.groups[index];
        if (!group) return;
        node.className = group.state;
        node.title = group.label + ': ' + group.status;
        node.querySelector('b').textContent = group.state === 'finished' ? '✓' : group.state === 'rework' ? '!' : index + 1;
        node.querySelector('.studio-sr').textContent = node.title;
      });
    }
  }
  const submitOperatorOriginal = operatorForm.onsubmit;
  operatorForm.onsubmit = async event => { await submitOperatorOriginal(event); refreshOperatorActions(); };
  operatorForm.elements.column.addEventListener('change', refreshOperatorActions);
  const openProductionWithQueue = openOperatorProduction;
  openOperatorProduction = id => { openProductionWithQueue(id); refreshOperatorActions(); };
  operatorForm.elements.reason.setAttribute('aria-describedby', 'trace-reason-help');
  const help = document.createElement('small'); help.id = 'trace-reason-help'; help.textContent = 'Para reproceso, explica el motivo. Al terminar se conserva el cierre automático de procesos anteriores.';
  operatorForm.elements.reason.after(help);
  const style = document.createElement('style');
  style.textContent = `
  .trace-process-notes{margin:18px 0;padding:14px;border:1px solid #dd6666;border-left:4px solid #ff7777;border-radius:10px;background:#392222;color:#fff0f0}
  .trace-process-notes h3{font:700 14px/1.5 Arial;margin:0 0 12px;color:#ffaaaa}
  .trace-process-notes article+article{border-top:1px solid #784242;margin-top:12px;padding-top:12px}
  .trace-process-notes strong{font:700 12px/1.5 Arial;color:#ffc5c5}
  .trace-process-notes .trace-full-note{font:600 15px/1.7 Arial;margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;text-decoration-line:underline;text-decoration-color:#ff6868;text-decoration-thickness:2px;text-underline-offset:4px;color:#fff0f0}
  .trace-card .trace-note-alert{margin:8px 0 16px;padding:12px 14px;border:1px solid #a78944;border-left:4px solid #f0c46a;border-radius:10px;background:#3a3220;color:#fff0ce;min-width:0}
  .trace-note-alert summary{list-style:none;display:block;cursor:pointer;min-height:44px}
  .trace-note-alert summary::-webkit-details-marker{display:none}
  .trace-note-alert summary:focus-visible{outline:2px solid #f0c46a;outline-offset:4px;border-radius:4px}
  .trace-note-label{display:block;color:#ffe0a0;font:700 12px/1.5 Arial;letter-spacing:.04em}
  .trace-note-preview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font:14px/1.5 Arial;color:#fff6e2;margin-top:5px;white-space:pre-wrap}
  .trace-note-alert[open] .trace-note-preview{display:none}
  .trace-note-alert p{border-color:#806b3b;overflow-wrap:anywhere}
  .trace-card-meta .trace-note-count{color:#ffe0a0;font-weight:700}
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
  .trace-pagination{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 0 0}.trace-pagination[hidden]{display:none!important}.trace-pagination button{width:auto;min-width:36px;min-height:36px;padding:7px 10px;border:1px solid #4a6350;border-radius:7px;background:#23352a;color:#e1ebdc;font:600 12px Arial;box-shadow:none}.trace-pagination button[aria-current=page]{background:#d0ec93;color:#1c2b13;border-color:#d0ec93}.trace-pagination button:disabled{opacity:.4;cursor:default}.trace-pagination button:focus-visible{outline:2px solid #b8ddf5;outline-offset:2px}.trace-page-count{font:12px Arial;color:#c2d3c4;margin-right:6px}.trace-pagination-bottom{grid-column:1/-1;justify-content:center;padding:16px 0}.trace-pagination{scroll-margin-top:80px}@media(max-width:600px){.trace-pagination button{min-width:40px;min-height:44px}.trace-page-count{width:100%}.trace-pagination{gap:5px}}
  .trace-progress{height:10px;margin:10px 0 2px;border-radius:8px;overflow:hidden;background:#324638;border:1px solid #425c48}.trace-progress>span{background:linear-gradient(90deg,#76c995,#d0ec93)}.trace-route-caption>.trace-progress-percent{font:700 14px/1.5 Arial;color:#d0ec93;white-space:nowrap;width:auto}.trace-route-heading{margin-bottom:10px}
  .trace-area-toggle{width:auto;min-height:42px;padding:10px 14px;background:#23352a;color:#e2eddd;border:1px solid #617858;border-radius:8px;font:600 12px Arial;box-shadow:none}.trace-area-toggle[aria-pressed=true]{background:#d0ec93;color:#1c2b13}.trace-area-toggle:disabled{opacity:.5}.trace-quick-filters button[hidden]{display:none!important}.trace-workspace-top{flex-wrap:wrap;gap:10px}
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

  // Compact navigation while browsing; never intercept the wheel or touch gesture.
  const scrollControls = document.createElement('button');
  scrollControls.type = 'button'; scrollControls.className = 'trace-scroll-controls';
  scrollControls.textContent = 'Filtros y opciones';
  scrollControls.setAttribute('aria-expanded', 'false');
  scrollControls.setAttribute('aria-controls', 'production-process');
  toolbar.querySelector('.trace-workspace-top').appendChild(scrollControls);
  scrollControls.onclick = () => {
    const open = document.body.classList.toggle('trace-controls-open');
    scrollControls.setAttribute('aria-expanded', String(open));
    requestAnimationFrame(fitTraceCards);
  };
  const backToTop = document.createElement('button');
  backToTop.type = 'button'; backToTop.className = 'trace-back-top';
  backToTop.textContent = '↑ Volver arriba'; backToTop.hidden = true;
  document.body.appendChild(backToTop);
  const pageScroll = () => getComputedStyle(traceCards).overflowY === 'visible';
  backToTop.onclick = () => {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    (pageScroll() ? window : traceCards).scrollTo({ top: 0, behavior });
  };
  let scrollFrame = 0;
  function updateTraceScroll() {
    scrollFrame = 0;
    const active = document.body.classList.contains('production-mode') && traceView === 'cards' && !document.body.classList.contains('admin-summary-mode');
    const position = pageScroll() ? window.scrollY : traceCards.scrollTop;
    const compact = active && position > (document.body.classList.contains('trace-scrolled') ? 16 : 90);
    if (compact !== document.body.classList.contains('trace-scrolled')) {
      document.body.classList.toggle('trace-scrolled', compact);
      if (!compact) {
        document.body.classList.remove('trace-controls-open');
        scrollControls.setAttribute('aria-expanded', 'false');
      }
      requestAnimationFrame(fitTraceCards);
    }
    backToTop.hidden = !active || position < 220;
  }
  const queueScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateTraceScroll); };
  traceCards.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueScroll, { passive: true });
  new MutationObserver(queueScroll).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.querySelector('.production-shell')?.addEventListener('transitionend', event => {
    if (event.propertyName === 'max-height' || event.propertyName === 'padding-top') fitTraceCards();
  });
  const scrollStyle = document.createElement('style');
  scrollStyle.textContent = `
  .trace-scroll-controls{display:none;width:auto;min-height:36px;padding:7px 12px;border:1px solid #496150;border-radius:8px;background:#24372a;color:#e0efce;box-shadow:none;font:600 12px Arial}
  .trace-back-top{position:fixed;right:28px;bottom:max(22px,env(safe-area-inset-bottom));z-index:30;width:auto;min-height:44px;padding:11px 17px;background:#d0ec93;color:#1c2b13;border:1px solid #e4f8bb;border-radius:24px;box-shadow:0 5px 22px #0006;font:600 13px Arial}
  .trace-back-top[hidden]{display:none!important}
  body.production-mode.trace-cards-mode .production-toolbar{transition:padding .2s ease}
  body.production-mode.trace-cards-mode .production-process-filter{max-height:260px;transition:max-height .2s ease,padding .2s ease;overflow:hidden}
  body.production-mode.trace-cards-mode .trace-workspace-top{min-height:26px}
  body.production-mode.trace-cards-mode .trace-cards{overscroll-behavior-y:contain;scroll-padding-top:18px;padding-bottom:76px;scrollbar-width:thin;scrollbar-color:#769666 #17221b}
  body.trace-scrolled.production-mode.trace-cards-mode .production-toolbar{padding-top:8px;padding-bottom:8px}
  body.trace-scrolled.production-mode.trace-cards-mode .production-title{display:none}
  body.trace-scrolled.production-mode.trace-cards-mode .production-controls{flex:1;max-width:none}
  body.trace-scrolled.production-mode.trace-cards-mode:not(.trace-controls-open) .production-process-filter:not(:focus-within){max-height:0;padding-top:0;padding-bottom:0;border-bottom:0;visibility:hidden}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-workspace{padding-top:8px;padding-bottom:8px;box-shadow:0 7px 16px #0003}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-workspace h3{margin-bottom:4px;font-size:14px}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-live,body.trace-scrolled.production-mode.trace-cards-mode .trace-results{display:none}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-scroll-controls{display:block}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-quick-filters{margin-top:6px}
  body.trace-scrolled.production-mode.trace-cards-mode .trace-quick-filters button{min-height:34px;padding-top:6px;padding-bottom:6px}
  @media(min-width:861px){body.trace-scrolled.production-mode.trace-cards-mode main>.header,body.trace-scrolled.production-mode.trace-cards-mode main>.brand-header{display:none}}
  @media(max-width:860px){.trace-back-top{right:16px;bottom:18px}.trace-scroll-controls{min-height:44px}body.trace-scrolled.production-mode.trace-cards-mode .trace-quick-filters button{min-height:44px}body.production-mode.trace-cards-mode .trace-cards{overscroll-behavior-y:auto}}
  @media(prefers-reduced-motion:reduce){body.production-mode.trace-cards-mode .production-toolbar,body.production-mode.trace-cards-mode .production-process-filter{transition:none}}
  `;
  document.head.appendChild(scrollStyle);
  // A denser optional workspace without changing the queue or permissions.
  const densityToggle = document.createElement('button');
  densityToggle.type = 'button';
  densityToggle.className = 'trace-density-toggle';
  densityToggle.textContent = 'Vista compacta';
  densityToggle.setAttribute('aria-pressed', 'false');
  toolbar.querySelector('.trace-workspace-top').appendChild(densityToggle);
  densityToggle.onclick = () => {
    const compact = document.body.classList.toggle('trace-density-compact');
    densityToggle.setAttribute('aria-pressed', String(compact));
    densityToggle.textContent = compact ? 'Vista amplia' : 'Vista compacta';
    requestAnimationFrame(fitTraceCards);
  };
  toolbar.querySelectorAll('[data-trace-filter]').forEach(button => {
    button.dataset.tone = ({ pending:'pending', active:'active', rework:'rework', late:'rework', finished:'finished' })[button.dataset.traceFilter] || 'neutral';
  });

  // Move existing controls, preserving submit handlers and server validation.
  operatorDialog.classList.add('production-studio');
  operatorDialog.setAttribute('aria-labelledby', 'production-studio-title');
  const studioHeader = document.createElement('div');
  studioHeader.className = 'studio-header';
  const studioTitle = operatorForm.querySelector('h2');
  studioTitle.id = 'production-studio-title';
  studioTitle.textContent = 'Registrar producción';
  studioHeader.append(operatorForm.querySelector('.operator-close'), studioTitle, operatorForm.querySelector('.operator-order'));
  const studioGrid = document.createElement('div');
  studioGrid.className = 'studio-grid';
  const studioContext = document.createElement('aside');
  studioContext.className = 'studio-context';
  studioContext.setAttribute('aria-label', 'Resumen de la orden');
  operatorDialog.prepend(studioHeader, studioGrid);
  studioGrid.append(studioContext, operatorForm);
  const jumpToActions = document.createElement('button');
  jumpToActions.type = 'button';
  jumpToActions.className = 'studio-jump';
  jumpToActions.textContent = 'Registrar actividad ↓';
  jumpToActions.onclick = () => { operatorForm.elements.column.focus(); operatorForm.scrollIntoView({ block: 'start', behavior: 'instant' }); };
  studioHeader.appendChild(jumpToActions);
  const historyHeading = operatorDialog.querySelector('h3');
  const studioHistory = document.createElement('details');
  studioHistory.className = 'studio-history';
  studioHistory.innerHTML = '<summary>Historial de actividad <span>Ver registros y responsables</span></summary>';
  studioHistory.append(operatorDialog.querySelector('.operator-history'));
  historyHeading.replaceWith(studioHistory);
  operatorForm.elements.reason.placeholder = 'Escribe una indicación para el siguiente proceso…';
  const actionCopy = {
    start: ['▶', 'Iniciar / retomar', 'Registrar el comienzo de este trabajo'],
    finish: ['✓', 'Terminar proceso', 'Cerrar y actualizar el avance'],
    rework: ['↺', 'Reproceso', 'Reabrir con un motivo obligatorio'],
    na: ['—', 'No aplica', 'Este pedido no requiere este proceso'],
    clear: ['⟲', 'Cambiar estado', 'Vaciar el proceso para elegir otro estado']
  };
  operatorForm.querySelectorAll('.operator-actions button').forEach(button => {
    const copy = actionCopy[button.value];
    button.innerHTML = '<span class="studio-action-icon" aria-hidden="true">' + copy[0] + '</span><span><strong>' + copy[1] + '</strong><small>' + copy[2] + '</small></span>';
  });
  const studioCounter = document.createElement('small');
  studioCounter.className = 'studio-counter';
  operatorForm.elements.reason.after(studioCounter);
  const updateStudioCounter = () => { studioCounter.textContent = operatorForm.elements.reason.value.length + ' / 2000'; };
  operatorForm.elements.reason.addEventListener('input', updateStudioCounter);
  operatorForm.elements.column.addEventListener('change', updateStudioCounter);
  operatorForm.elements.column.addEventListener('change', () => {
    operatorDialog.querySelector('.operator-message').textContent = operatorForm.elements.column.value ? 'Elige una acción. La fecha y hora se guardan automáticamente.' : 'Selecciona el proceso para habilitar las acciones.';
  });
  const studioOpenOriginal = openOperatorProduction;
  let studioLoad = 0, studioCurrentRow = null;
  openOperatorProduction = id => {
    studioOpenOriginal(id);
    const row = productionData.rows.find(item => item.source_row === id);
    if (!row) return;
    studioCurrentRow = id;
    // Administrators enter the area they are browsing; operators retain their profile.
    if (isAdmin && navigationProcess) {
      const group = groupsFor(productionData, row, processStatusHeaders).find(item => item.label === navigationProcess.label);
      if (group) { operatorForm.elements.column.value = String(group.start + 1); operatorSelection(); refreshOperatorActions(); operatorDialog.querySelector('.operator-message').textContent = 'Proceso seleccionado según el área que estás consultando.'; }
    }
    studioHistory.open = false;
    if (!operatorForm.elements.column.value) operatorDialog.querySelector('.operator-current').textContent = 'Selecciona el proceso para habilitar las acciones.';
    updateStudioCounter();
    const summary = summarize(productionData, row, processStatusHeaders, user, scheduleToday());
    studioContext.innerHTML = '<span class="trace-eyebrow">LA ORDEN DE UN VISTAZO</span><h3>' + esc(traceField(row, 'REFERENCIA')) + '</h3>' +
      '<div class="studio-facts"><div><small>A FABRICAR</small><strong>' + esc(traceField(row, 'CANTIDAD') || '0') + ' und.</strong></div><div><small>ENTREGA</small><strong>' + esc(displayProductionDate(traceField(row, 'FECHA DE ENTREGA')) || 'Sin fecha') + '</strong></div></div>' +
      '<div class="studio-progress-label"><span>Avance de la orden</span><strong>' + summary.percent + '%</strong></div>' +
      '<progress max="100" value="' + summary.percent + '" aria-label="Avance de la orden">' + summary.percent + '%</progress>' +
      '<div class="studio-stages" aria-label="Estado de los doce procesos">' + summary.groups.map((group, index) => '<span class="' + group.state + '" title="' + esc(group.label + ': ' + group.status) + '"><b aria-hidden="true">' + (group.state === 'finished' ? '✓' : group.state === 'rework' ? '!' : index + 1) + '</b><small>' + esc(abbreviations[group.key] || group.label.slice(0, 3)) + '</small><span class="studio-sr">' + esc(group.label + ': ' + group.status) + '</span></span>').join('') + '</div>' +
      '<p class="studio-caption">' + summary.finished + ' de ' + summary.total + ' procesos cerrados · Incluye cierres automáticos y No aplica.</p>' +
      '<div class="studio-observaciones"></div>' +
      '<section class="studio-event-notes" aria-live="polite">Consultando notas de los operarios…</section>';
    renderStudioObservations(id);
    loadStudioEventNotes(id);
    operatorDialog.scrollTop = 0;
  };
  function renderStudioObservations(id) {
    const holder = studioContext.querySelector('.studio-observaciones');
    if (!holder) return;
    const notes = Object.entries(productionData.notes || {}).filter(([noteKey, text]) => noteKey.startsWith(id + ':') && String(text || '').trim());
    holder.innerHTML = notes.length ? '<section class="studio-notes"><h4>OBSERVACIONES</h4>' + notes.map(([noteKey, text]) => '<article><strong>' + esc(productionData.headers[Number(noteKey.split(':')[1]) - 1] || 'NOTA') + '</strong><p>' + esc(String(text)) + '</p></article>').join('') + '</section>' : '';
  }
  function loadStudioEventNotes(id) {
    const target = studioContext.querySelector('.studio-event-notes');
    if (!target) return;
    const request = ++studioLoad;
    const addButton = '<button type="button" class="studio-note-add" data-row-id="' + id + '">+ Agregar nota</button>';
    fetch('/api/produccion/operaciones/' + id, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw Error();
      return response.json();
    }).then(events => {
      if (!target.isConnected || request !== studioLoad) return;
      if (!Array.isArray(events)) throw Error();
      const observations = events.filter(entry => String(entry.reason || '').trim() && key(entry.action) !== 'CIERRE AUTOMATICO');
      target.innerHTML = addButton + (observations.length ? '<h4>NOTAS DE LOS PROCESOS</h4>' + observations.map(entry => '<article><button type="button" class="studio-note-delete" data-event-id="' + entry.id + '" data-row-id="' + id + '" aria-label="Eliminar nota" title="Eliminar nota">×</button><strong>' + esc(productionData.headers[Number(entry.column_number) - 1] || 'PROCESO') + '</strong><p>' + esc(entry.reason) + '</p><small>' + esc(entry.responsible || entry.username || '') + '</small></article>').join('') : '<p class="studio-caption">No hay observaciones adicionales de los operarios.</p>');
      target.classList.toggle('studio-notes', !!observations.length);
    }).catch(() => {
      if (target.isConnected && request === studioLoad) target.innerHTML = addButton + 'No se pudieron consultar las notas. Vuelve a abrir el panel para reintentar.';
    });
  }
  // Boton "+ Agregar nota": reutiliza el mismo editor de notas de la tabla (celda del proceso elegido).
  operatorDialog.addEventListener('click', event => {
    const addBtn = event.target.closest('.studio-note-add');
    if (!addBtn) return;
    const column = Number(operatorForm.elements.column.value);
    if (!column) { alert('Selecciona primero un proceso.'); return; }
    openNote({ dataset: { row: addBtn.dataset.rowId, column: String(column) } });
  });
  // MutationObserver en vez de 'close': mas confiable para detectar que el dialogo de nota se cerro
  // (al guardar o cancelar), y asi refrescar las notas del panel sin tener que reabrirlo.
  new MutationObserver(() => {
    if (noteDialog.open || !operatorDialog.open || studioCurrentRow == null) return;
    renderStudioObservations(studioCurrentRow);
    loadStudioEventNotes(studioCurrentRow);
  }).observe(noteDialog, { attributes: true, attributeFilter: ['open'] });
  // Boton "X" en cada nota de proceso: borra el evento de reproceso por completo.
  operatorDialog.addEventListener('click', async event => {
    const delBtn = event.target.closest('.studio-note-delete');
    if (!delBtn) return;
    event.preventDefault();
    event.stopPropagation();
    if (!confirm('¿Eliminar esta nota?')) return;
    delBtn.disabled = true;
    try {
      const response = await fetch('/api/produccion/operaciones/evento/' + delBtn.dataset.eventId, { method: 'DELETE' });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || 'No se pudo eliminar la nota'); }
      loadStudioEventNotes(Number(delBtn.dataset.rowId));
    } catch (error) {
      alert(error.message);
      delBtn.disabled = false;
    }
  });
  const studioSubmitOriginal = operatorForm.onsubmit;
  operatorForm.onsubmit = async event => {
    operatorDialog.setAttribute('aria-busy', 'true');
    try { await studioSubmitOriginal(event); }
    finally { operatorDialog.setAttribute('aria-busy', 'false'); updateStudioCounter(); }
  };
  const studioStyle = document.createElement('style');
  studioStyle.textContent = `
  .trace-density-toggle{width:auto!important;min-height:36px;padding:8px 12px!important;border:1px solid #596c54;border-radius:8px;background:#263328;color:#e9f4db;box-shadow:none;font:600 12px Arial}
  .trace-density-toggle[aria-pressed=true]{background:#d4ec98;color:#192617}
  .trace-quick-filters button{transition:background .15s,border-color .15s;gap:8px!important}
  .trace-quick-filters button:before{content:'';width:7px;height:7px;border-radius:50%;background:#8a9d8f;flex-shrink:0}
  .trace-quick-filters button[data-tone=active]:before{background:#f3b852}.trace-quick-filters button[data-tone=rework]:before{background:#ff8982}.trace-quick-filters button[data-tone=finished]:before{background:#7bd9a4}
  .trace-quick-filters button[aria-pressed=true]{box-shadow:inset 0 -3px 0 #94b547}
  body.production-mode .trace-card{border-top:3px solid #40584a;transition:border-color .18s,box-shadow .18s}
  body.production-mode .trace-card.state-active{border-top-color:#f3b852}body.production-mode .trace-card.state-rework{border-top-color:#f08079}body.production-mode .trace-card.state-finished{border-top-color:#8bdbaf}
  body.production-mode .trace-card:focus-within{outline:2px solid #d4ec98;outline-offset:2px}
  @media(hover:hover){body.production-mode .trace-card:hover{box-shadow:0 8px 22px #0004;border-left-color:#92a886;border-right-color:#92a886}}
  @media(min-width:861px){body.production-mode.trace-density-compact .trace-card{grid-template-columns:minmax(115px,28%) minmax(0,1fr)!important}body.production-mode.trace-density-compact .trace-media,body.production-mode.trace-density-compact .trace-media:has(img){min-height:220px!important;height:auto!important;padding:10px!important}body.production-mode.trace-density-compact .trace-design-main img{height:210px!important;object-fit:contain}body.production-mode.trace-density-compact .trace-card-body{padding:16px!important}body.production-mode.trace-density-compact .trace-manufacture{margin:10px 0!important;padding:10px 0!important}body.production-mode.trace-density-compact .trace-card dl{gap:12px!important;margin:12px 0!important}body.production-mode.trace-density-compact .trace-client{font-size:15px!important}body.production-mode.trace-density-compact .trace-route{padding-top:10px!important;padding-bottom:10px!important}}
  .production-studio{width:min(960px,95vw)!important;max-height:92dvh!important;padding:0!important;box-sizing:border-box;background:#14221b;border:1px solid #536a55;box-shadow:0 24px 90px #0008}
  .production-studio .studio-header{position:sticky;top:0;z-index:3;padding:18px 24px;border-bottom:1px solid #354b3a;background:linear-gradient(110deg,#243526,#16241c)}
  .production-studio .studio-header h2{font:700 24px/1.3 Arial;margin:0 44px 8px 0;color:#f5faee}.production-studio .operator-order{margin:0;color:#c6d6bd;font-size:13px}
  .production-studio .operator-close{min-height:36px;min-width:36px;border:1px solid #6b8066!important;border-radius:10px;cursor:pointer}
  .studio-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}
  .studio-context{padding:24px;background:#19291f;border-right:1px solid #354b3a;min-width:0}.studio-context>h3{font:700 21px Arial;margin:10px 0 20px;overflow-wrap:anywhere}
  .production-studio #operator-form{padding:20px 24px;min-width:0}.production-studio #operator-form>label{margin:0 0 14px;color:#cad8c4;font-weight:600;font-size:12px}
  .production-studio select,.production-studio input,.production-studio textarea{border-radius:10px!important;background:#24362b!important;color:#f4f9f1!important}.production-studio textarea{min-height:90px;resize:vertical}
  .production-studio :is(input,select,textarea,button,summary):focus-visible{outline:2px solid #d5ed9a;outline-offset:3px}
  .production-studio .operator-current{display:block!important;padding:10px 12px!important;margin:0 0 16px;font-size:12px;line-height:1.5}
  .studio-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px}.studio-facts>div{padding:12px;background:#233629;border-radius:10px;border:1px solid #3d5540}.studio-facts small{display:block;color:#a9bea7;font:10px Arial;letter-spacing:.06em;margin-bottom:7px}.studio-facts strong{font:700 16px Arial;color:#eef8e6}
  .studio-progress-label{display:flex;justify-content:space-between;gap:10px;font:12px Arial;color:#c0d1b7}.studio-progress-label strong{font-size:18px;color:#d4ec98}
  .studio-context progress{appearance:none;width:100%;height:7px;margin:10px 0 16px;border:0;border-radius:10px;overflow:hidden;background:#344c3a;accent-color:#c9eb83}.studio-context progress::-webkit-progress-bar{background:#344c3a}.studio-context progress::-webkit-progress-value{background:linear-gradient(90deg,#7bd4a0,#d4ec98);border-radius:10px}
  .studio-stages{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:3px}.studio-stages>span{position:relative;text-align:center;color:#9eb8a4}.studio-stages b{position:relative;z-index:1;display:grid;place-items:center;width:19px;height:19px;margin:auto;border:1px solid #6a8270;border-radius:50%;font:10px Arial;background:#23372a}.studio-stages>span:not(:last-child):after{content:'';position:absolute;left:50%;width:calc(100% + 3px);top:10px;height:1px;background:#58715f}.studio-stages small{display:block;font:8px Arial;margin-top:5px}.studio-stages .finished b{background:#375d42;color:#a5edbb;border-color:#8bdbaf}.studio-stages .active b{background:#f3b852;color:#2a2008}.studio-stages .rework b{background:#ed827a;color:#2a100d}.studio-caption{color:#a8bda9;font:11px/1.6 Arial;margin:12px 0}
  .studio-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .studio-notes{margin-top:20px;padding:14px;border:1px solid #9e5d58;border-left:3px solid #ff8d86;border-radius:10px;background:#352622}.studio-notes h4{color:#ffb6ae;font:700 11px Arial;letter-spacing:.05em;margin:0 0 12px}.studio-notes article{position:relative;padding-right:28px}.studio-notes article+article{border-top:1px solid #6b4841;padding-top:10px;margin-top:10px}.studio-notes strong,.studio-notes small{color:#d6b8af;font:11px/1.4 Arial}.studio-notes p{color:#fff1ed;font:600 13px/1.6 Arial;text-decoration:underline #ff8178 2px;text-underline-offset:4px;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}.studio-event-notes{font:12px/1.6 Arial;color:#b9cbb4}
  .studio-note-delete{position:absolute;top:0;right:0;width:20px!important;height:20px;padding:0!important;display:grid;place-items:center;border-radius:50%;border:1px solid #f5a623;background:#4a3316;color:#ffd9a0!important;font-size:13px!important;font-weight:900!important;line-height:1!important;box-shadow:none;cursor:pointer}
  .studio-note-delete:hover{background:#f5a623;color:#2a1c08!important}
  .studio-note-delete:disabled{opacity:.5;cursor:progress}
  .studio-event-notes .studio-note-add{display:block;width:auto;min-height:0;margin:0 0 12px;padding:9px 14px!important;border:1px solid #f5a623;border-radius:9px;background:#4a3316;color:#ffd9a0;font:700 12px Arial;box-shadow:none;cursor:pointer}
  .studio-event-notes .studio-note-add:hover{background:#f5a623;color:#2a1c08}
  .studio-counter{display:block;text-align:right;font:11px Arial;color:#a7bca4;margin-top:6px}
  .production-studio .operator-actions{gap:9px!important}.production-studio .operator-actions button{display:flex;align-items:center;gap:10px;text-align:left;padding:13px!important;min-height:76px!important;border-radius:11px;box-shadow:none;transform:none!important}.production-studio .operator-actions strong{display:block;font:700 13px/1.4 Arial}.production-studio .operator-actions small{display:block;font:11px/1.4 Arial;margin-top:4px;opacity:.85}.studio-action-icon{font:20px Arial;flex-shrink:0}
  .production-studio .operator-actions button[value=start]{background:#edbb68}.production-studio .operator-actions button[value=finish]{background:#d4ec98}.production-studio .operator-actions button[value=rework]{background:#482c29;color:#ffc3b8;border-color:#a76c62}.production-studio .operator-actions button[value=na]{background:#23382c;color:#d2e3cb}.production-studio .operator-actions button[value=clear]{background:#2a3550;color:#c9d6f5;border-color:#4d5f8f}
  .production-studio button:disabled{cursor:not-allowed;opacity:.4}.production-studio[aria-busy=true] .operator-message{padding:12px;background:#32442b;border-radius:8px}.production-studio[aria-busy=true] .operator-message:before{content:'◌ ';display:inline-block;margin-right:6px}
  .studio-history{border-top:1px solid #354b3a;padding:16px 24px}.studio-history summary{cursor:pointer;color:#d9eacb;font:600 13px Arial;min-height:24px}.studio-history summary span{font:12px Arial;color:#95af9b;margin-left:12px}.studio-history .operator-history{padding:12px 0 0}.studio-history article{padding-left:16px;border-left:2px solid #617e52;margin-left:6px}
  .studio-jump{display:none}.production-studio #operator-form{scroll-margin-top:175px}
  @media(min-width:701px){.production-studio .studio-header{padding:14px 22px}.production-studio .studio-header h2{font-size:22px}.production-studio #operator-form{padding:16px 22px}.production-studio #operator-form>label{margin-bottom:10px}.production-studio textarea{min-height:70px;height:70px}.production-studio .operator-actions button{min-height:64px!important;padding:10px!important}.production-studio #trace-reason-help{font-size:11px;line-height:1.4}.studio-context{padding:20px}.studio-facts{margin-bottom:18px}.studio-notes{margin-top:14px;padding:11px}.studio-context>h3{margin-bottom:14px}}
  @media(max-width:700px){.studio-grid{grid-template-columns:1fr}.studio-context{border-right:0;border-bottom:1px solid #354b3a;padding:18px}.production-studio .studio-header{padding:18px}.production-studio .studio-header h2{font-size:21px}.production-studio #operator-form{padding:18px}.studio-facts{margin-bottom:16px}.studio-history{padding:16px 18px}.studio-history summary span{display:block;margin:8px 0}.trace-density-toggle{min-height:44px}.production-studio .operator-actions{grid-template-columns:1fr 1fr!important}.production-studio .operator-actions button{padding:10px!important}.studio-action-icon{display:none}body.production-mode.trace-density-compact .trace-media,body.production-mode.trace-density-compact .trace-media:has(img){height:170px!important;min-height:0!important}body.production-mode.trace-density-compact .trace-design-main img{height:125px!important}}
  @media(prefers-reduced-motion:reduce){.trace-quick-filters button,body.production-mode .trace-card{transition:none}}
  @media(max-width:700px){.studio-jump{display:inline-block!important;width:auto!important;min-height:36px!important;margin-top:10px;padding:6px 12px!important;background:#d4ec98!important;color:#213217!important;font:600 12px Arial;box-shadow:none!important;border:0;border-radius:8px}}
  `;
  document.head.appendChild(studioStyle);
  const statusColors = document.createElement('style');
  statusColors.textContent = `
  :root{--production-finished:#63d58a;--production-active:#ffad4f;--production-rework:#f56b6b}
  body.production-mode .trace-stage.finished,.trace-stage.finished{background:var(--production-finished);border-color:var(--production-finished);color:#092d17}
  body.production-mode .trace-stage.active,.trace-stage.active{background:var(--production-active);border-color:var(--production-active);color:#382005}
  body.production-mode .trace-stage.rework,.trace-stage.rework{background:var(--production-rework);border-color:var(--production-rework);color:#350b0b}
  body.production-mode .trace-card.state-finished{--card-state-color:var(--production-finished)}body.production-mode .trace-card.state-active{--card-state-color:var(--production-active)}body.production-mode .trace-card.state-rework{--card-state-color:var(--production-rework)}
  body.production-mode .trace-card:is(.state-finished,.state-active,.state-rework){border:3px solid var(--card-state-color);box-shadow:0 0 0 1px color-mix(in srgb,var(--card-state-color) 20%,transparent),0 6px 22px #0002}
  @media(hover:hover){body.production-mode .trace-card:is(.state-finished,.state-active,.state-rework):hover{border-color:var(--card-state-color);box-shadow:0 0 0 2px color-mix(in srgb,var(--card-state-color) 25%,transparent),0 8px 22px #0004}}
  .trace-node.finished .trace-node-dot,.studio-stages .finished b{background:var(--production-finished);border-color:var(--production-finished);color:#092d17}
  .trace-node.active .trace-node-dot,.studio-stages .active b{background:var(--production-active);border-color:var(--production-active);color:#382005}
  .trace-node.rework .trace-node-dot,.studio-stages .rework b{background:var(--production-rework);border-color:var(--production-rework);color:#350b0b}
  .trace-node.finished .trace-node-label{color:var(--production-finished)}.trace-node.active .trace-node-label{color:var(--production-active)}.trace-node.rework .trace-node-label{color:var(--production-rework)}
  .trace-quick-filters button[data-tone=finished]:before{background:var(--production-finished)}.trace-quick-filters button[data-tone=active]:before{background:var(--production-active)}.trace-quick-filters button[data-tone=rework]:before{background:var(--production-rework)}
  `;
  document.head.appendChild(statusColors);
  renderTraceCards();
  updateTraceScroll();
  new ResizeObserver(fitTraceCards).observe(toolbar);
})();

// Presentation only: keep workflow, permissions and production state colours intact.
(() => {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'indoor-clean-interface';
  style.textContent = `
  :root{--metal:#d0f44c;--line:rgba(230,240,233,.13);--muted:#a9b7ae;--ink:#f5f7f5}
  html body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#090f0c;color:#f5f7f5;-webkit-font-smoothing:antialiased}
  body:before,body:after{pointer-events:none}body:before{background:none}
  body button,body input,body select,body textarea{font-family:inherit}
  body h1,body h2,body h3,body h4{letter-spacing:-.035em;font-weight:600}
  body .topbar{height:2px;background:#d0f44c;box-shadow:none}
  body .sidebar{background:#101913;border-color:var(--line);box-shadow:none}
  body .sidebar-brand,body .session-card,body .sidebar-foot{border-color:var(--line)}
  body .session-card{background:transparent}
  body .session-avatar{background:#d0f44c;box-shadow:none;color:#14200b}
  body .sidebar-label{letter-spacing:.12em;font-size:10px;font-weight:600;color:#83988a}
  body .sidebar .tab,body .nav-parent{background:transparent;border:1px solid transparent;border-radius:12px;box-shadow:none;color:#bdc9c0}
  body .sidebar .tab strong,body .nav-parent{font-weight:600;font-size:12px}
  body .sidebar .tab.active{background:#26351f;border-color:#526736;color:#e0f6a0;box-shadow:none}
  body .sidebar .tab:hover,body .nav-parent:hover{background:#1d2b22;border-color:transparent;filter:none}
  body .nav-children{border-color:#344434}
  body .nav-icon{background:#223021;color:#d0f44c;border-radius:8px;font-weight:600}
  body .brand{background:rgba(9,15,12,.94);border-color:var(--line);box-shadow:none;backdrop-filter:blur(18px)}
  body .brand-line{font-weight:600;letter-spacing:.16em;font-size:11px}
  body .system,body .menu-toggle{background:#17231b;border-color:var(--line);box-shadow:none}
  body header{padding:28px 20px 26px;text-align:left}
  body header h1{font-size:clamp(28px,3.4vw,48px);line-height:1.08;max-width:900px;margin:10px 0 12px}
  body header p{font-size:15px;font-weight:400;color:#a9b7ae}
  body header .eyebrow{letter-spacing:.12em;font-size:10px}
  body .card,body .schedule-shell,body .production-shell{background:#111c15;border:1px solid var(--line);border-radius:20px;box-shadow:none}
  body .card-head{background:transparent;border-color:var(--line);padding:20px 22px}
  body .card-head h2{font-size:20px;font-weight:600}
  body .card-head p{font-size:13px;font-weight:400;line-height:1.5}
  body .dropzone{min-height:150px;background:#152119;border-color:#536546;border-radius:16px;box-shadow:none;padding:20px}
  body .dropzone:hover{transform:none;background:#1a291d;box-shadow:none}
  body .upload-icon{background:#d0f44c;box-shadow:none;border-radius:14px}
  body .file-row,body .creator-workbook-name{background:#16221a;border-color:var(--line);box-shadow:none;border-radius:12px}
  body .file-row.has-file{background:#21321d;border-color:#718b43;box-shadow:none}
  body .creator-workbook-name label{font-weight:600}
  body button{box-shadow:none;font-weight:600}
  body button:focus-visible,body a:focus-visible{outline:2px solid #d0f44c;outline-offset:3px}
  body #submit,body .creator-actions button{background:#d0f44c;color:#14200b;border-radius:999px;box-shadow:none}
  body .production-toolbar,body .production-process-filter,body .production-kpis,
  body .schedule-toolbar,body .schedule-summary,body .schedule-weekdays{background:#111c15;border-color:var(--line)}
  body .production-refresh,body .production-connector,body .schedule-actions button{border-radius:999px;background:#203022;color:#e2eccf;border-color:#3b4b39;font-weight:500;box-shadow:none}
  body .production-search{border-radius:12px}
  body .schedule-title h2{font-weight:600;letter-spacing:-.03em}
  body .schedule-day{background:#121c16;border-color:var(--line)}
  body .schedule-day.outside{background:#0d1510}
  body .schedule-event{background:#203222;border-color:#344b30;box-shadow:none;border-radius:8px}
  body .schedule-event strong{font-weight:600;color:#dbefb1}
  body .trace-quick-filters button{border-radius:999px;box-shadow:none;font-weight:500}
  body .trace-quick-filters button.active{background:#d0f44c;color:#13210b;border-color:#d0f44c}
  body.production-mode .trace-card{background:#18251d;border-radius:22px;box-shadow:none}
  body.production-mode .trace-card-body{padding:22px}
  body.production-mode .trace-card-body h3{font-family:inherit;font-weight:600;letter-spacing:-.03em}
  body.production-mode .trace-client{font-family:inherit;font-weight:600}
  body.production-mode .trace-card :is(p,dt,dd,small){font-family:inherit}
  body.production-mode .trace-card dt{color:#a9b7ae;font-weight:400}
  body.production-mode .trace-route{background:#132017;border-top-color:#344238}
  body.production-mode .trace-card button{box-shadow:none}
  body dialog{font-family:inherit;background:#18251d;color:#f5f7f5;border:1px solid #465746;border-radius:24px;box-shadow:0 24px 80px #0006}
  body dialog::backdrop{background:#020906aa;backdrop-filter:blur(6px)}
  body dialog h2{font-family:inherit;font-weight:600;letter-spacing:-.035em}
  body .studio-context{background:#132017;border-color:var(--line);border-radius:16px}
  body .production-studio .operator-actions button{border-radius:16px;box-shadow:none}
  body .operator-history article{border-color:var(--line)}
  @media(min-width:1121px){body .workspace{gap:20px;grid-template-columns:minmax(340px,.85fr) minmax(0,1.5fr)}}
  @media(max-width:860px){body header{padding:18px 10px}body header h1{font-size:30px}body.production-mode .trace-card-body{padding:16px}body .card-head{padding:16px}body dialog{border-radius:20px}}
  @media(prefers-reduced-motion:reduce){body *,body *:before,body *:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
  `;
  document.head.appendChild(style);
})();

// Reuse the permission-filtered navigation and its existing actions at the top.
(() => {
  if (typeof document === 'undefined') return;
  const navigation = document.querySelector('.sidebar');
  if (!navigation) return;
  document.body.classList.add('top-navigation');
  document.body.classList.remove('menu-open');
  const account = document.querySelector('.brand .systems');
  if (account) navigation.appendChild(account);
  const groups = [...navigation.querySelectorAll('.nav-group')];
  const sync = () => groups.forEach(group => {
    const trigger = group.querySelector('.nav-parent');
    if (trigger) trigger.setAttribute('aria-expanded', String(!group.classList.contains('collapsed')));
  });
  let hoverCloseTimer;
  const cancelHoverClose = () => clearTimeout(hoverCloseTimer);
  const close = () => { cancelHoverClose(); groups.forEach(group => group.classList.add('collapsed')); sync(); };
  // Mouse/trackpad only: touch keeps the existing tap and keyboard controls.
  groups.forEach(group => {
    group.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      cancelHoverClose();
      groups.forEach(other => other.classList.toggle('collapsed', other !== group));
      sync();
    });
    group.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse') return;
      cancelHoverClose();
      hoverCloseTimer = setTimeout(() => {
        group.classList.add('collapsed');
        sync();
      }, 220);
    });
  });
  // The Indoor logo always takes the user back to INICIO.
  const brand = navigation.querySelector('.sidebar-brand');
  if (brand) {
    brand.setAttribute('role', 'link');
    brand.setAttribute('tabindex', '0');
    brand.setAttribute('aria-label', 'Ir al inicio');
    brand.style.cursor = 'pointer';
    const goHome = () => {
      navigation.querySelector('nav.tabs > .tab[data-kind="inicio"]')?.click();
      window.scrollTo({ top: 0 });
    };
    brand.addEventListener('click', goHome);
    brand.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); goHome(); } });
  }
  // Direct top buttons (INICIO, NOVEDADES) open their section just by hovering, like the menus.
  let hoverOpenTimer;
  navigation.querySelectorAll('nav.tabs > .tab').forEach(tab => {
    tab.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = setTimeout(() => {
        groups.forEach(group => group.classList.add('collapsed'));
        sync();
        if (!tab.classList.contains('active')) tab.click();
      }, 120);
    });
    tab.addEventListener('pointerleave', () => clearTimeout(hoverOpenTimer));
  });
  close();
  navigation.addEventListener('click', event => {
    cancelHoverClose();
    const trigger = event.target.closest('.nav-parent');
    if (trigger) groups.forEach(group => { if (group !== trigger.closest('.nav-group')) group.classList.add('collapsed'); });
    if (event.target.closest('.tab')) close();
    sync();
    window.dispatchEvent(new Event('resize'));
  });
  document.addEventListener('click', event => { if (!navigation.contains(event.target)) close(); });
  navigation.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const trigger = event.target.closest('.nav-group')?.querySelector('.nav-parent');
      close(); trigger?.focus();
    }
  });
  const style = document.createElement('style');
  style.textContent = `
  html body.top-navigation{--navigation-height:68px}
  html body.top-navigation .sidebar,html body.top-navigation .sidebar nav.tabs{flex-direction:row}
  html body.top-navigation .sidebar{position:fixed;inset:0 0 auto;width:100%;height:var(--navigation-height);padding:0 24px;display:flex;align-items:center;gap:28px;overflow:visible;transform:none!important;z-index:100;background:rgba(14,23,17,.97);backdrop-filter:blur(20px);border:0;border-bottom:1px solid #ffffff20;box-sizing:border-box}
  html body.top-navigation .sidebar-brand{padding:0;border:0;flex:0 0 100px;height:auto;background:none}
  html body.top-navigation .sidebar-brand img{width:100px;height:40px;object-fit:contain}
  html body.top-navigation .sidebar :is(.session-card,.sidebar-label,.sidebar-foot){display:none}
  html body.top-navigation #menu-toggle,html body.top-navigation main>.brand{display:none!important}
  html body.top-navigation .sidebar nav.tabs{display:flex;align-items:center;gap:8px;padding:0;margin:0;flex:1;overflow:visible}
  @media(min-width:701px){html body.top-navigation .sidebar nav.tabs{justify-content:center;margin-right:128px}}
  html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{width:auto;min-height:42px;padding:10px 16px;gap:8px;font-size:12px;white-space:nowrap;border-radius:999px}
  html body.top-navigation .sidebar nav.tabs>.tab .nav-icon,html body.top-navigation .nav-parent .nav-icon{display:none}
  html body.top-navigation .sidebar nav.tabs>.tab:after{display:none}
  html body.top-navigation .sidebar .nav-parent:after{display:none}
  html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar nav.tabs>.nav-group{flex:0 0 auto}
  html body.top-navigation .sidebar .tab strong{margin:0}
  html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{display:flex;align-items:center;justify-content:center}
  html body.top-navigation .sidebar .nav-group{position:relative;margin:0;padding:0}
  @media(hover:hover) and (pointer:fine){html body.top-navigation .sidebar .nav-group:not(.collapsed):before{content:'';position:absolute;top:100%;left:0;width:100%;height:14px}}
  html body.top-navigation .sidebar .nav-children{position:absolute;top:calc(100% + 12px);left:0;width:300px;max-height:calc(100dvh - 100px);overflow:auto;padding:10px;margin:0;border:1px solid #425440;border-radius:18px;background:#17251c;box-shadow:0 18px 50px #0006;box-sizing:border-box}
  html body.top-navigation .sidebar .nav-group:not(.collapsed)>.nav-children{display:grid;grid-template-columns:1fr}
  html body.top-navigation .sidebar .nav-children .tab{width:100%;min-height:40px;padding:8px 12px;margin:0;text-align:left}
  html body.top-navigation .sidebar .systems{margin-left:auto;flex:0 0 auto}
  html body.top-navigation main{margin-left:0!important;width:100%!important;padding:calc(var(--navigation-height) + 18px) 20px 16px!important;box-sizing:border-box}
  html body.top-navigation.menu-open:after{display:none}
  @media(max-width:700px){
    html body.top-navigation{--navigation-height:108px}
    html body.top-navigation .sidebar{padding:8px 12px;gap:4px 12px;flex-wrap:wrap;align-content:center}
    html body.top-navigation .sidebar-brand{flex-basis:80px;order:0}
    html body.top-navigation .sidebar-brand img{width:80px;height:32px}
    html body.top-navigation .sidebar .systems{order:1;max-width:calc(100% - 100px)}
    html body.top-navigation .sidebar nav.tabs{order:2;flex:0 0 100%;justify-content:center;gap:2px}
    html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{font-size:10px;padding:8px 9px;min-height:38px}
    html body.top-navigation .sidebar nav.tabs>.tab strong{font-size:10px}
    html body.top-navigation .sidebar .nav-children{position:fixed;top:108px;left:10px;width:calc(100% - 20px);max-height:calc(100dvh - 120px)}
    html body.top-navigation main{padding:calc(var(--navigation-height) + 10px) 8px 12px!important}
  }
  `;
  document.head.appendChild(style);
  window.dispatchEvent(new Event('resize'));
})();

// Indoor athletic visual language; interaction and workflow remain unchanged.
(() => {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'indoor-sport-interface';
  style.textContent = `
  :root{--sport-font:Arial,"Segoe UI",sans-serif;--sport-title:Arial,"Segoe UI",sans-serif;--sport-weight:700;--sport-bg:#080e0b;--sport-surface:#14221b;--sport-lime:#d0f44c;--sport-text:#f5f7f3;--sport-muted:#c5d1c9;--sport-line:#ffffff20;--sport-radius:18px;--sport-pill:30px;--sport-gap:24px}
  html body{font-family:var(--sport-font);background:var(--sport-bg)}
  body :is(button,input,textarea,select){font-family:var(--sport-font)}
  body :is(h1,h2,h3,h4){font-family:var(--sport-title);font-weight:var(--sport-weight);letter-spacing:-.04em}
  body header h1{font-weight:var(--sport-weight);text-transform:uppercase;font-size:clamp(28px,3.3vw,48px);line-height:.98;max-width:1000px}
  body header h1 br{display:none}
  body header .subtitle{font-weight:400;line-height:1.5}
  body .eyebrow{font-weight:700;letter-spacing:.12em}
  html body.top-navigation .sidebar{background:var(--sport-bg);backdrop-filter:none;border-bottom-color:var(--sport-line)}
  html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{border-radius:0;border:0;border-bottom:2px solid transparent;min-height:48px;background:transparent;color:var(--sport-text);font-weight:700}
  html body.top-navigation .sidebar nav.tabs>.tab.active,html body.top-navigation .sidebar .nav-parent[aria-expanded=true]{border-bottom-color:transparent;background:rgba(208,244,76,.16);border-radius:8px;color:var(--sport-lime)}
  html body.top-navigation .sidebar nav.tabs>.tab:hover,html body.top-navigation .sidebar .nav-parent:hover{background:transparent;outline:2px solid var(--sport-lime);outline-offset:-2px;border-radius:8px}
  html body.top-navigation .sidebar .nav-children{background:var(--sport-surface);border-radius:0 0 var(--sport-radius) var(--sport-radius);box-shadow:0 20px 40px #0005}
  html body.top-navigation .sidebar .nav-children .tab{font-weight:600;border-radius:var(--sport-radius)}
  body .card,body .production-shell,body .schedule-shell{border-radius:var(--sport-radius);background:var(--sport-surface);box-shadow:none}
  body .card-head h2,body .schedule-title h2,body .production-title h2{font-weight:var(--sport-weight);text-transform:uppercase;letter-spacing:-.035em}
  body .card-head{padding:var(--sport-gap);border-color:var(--sport-line)}
  body .workspace{gap:var(--sport-gap)}
  body .dropzone{background:var(--sport-bg);border-radius:var(--sport-radius);min-height:140px}
  body .dropzone strong{font-size:16px;font-weight:700}
  body .upload-icon{border-radius:50%;background:var(--sport-lime);color:var(--sport-bg)}
  body #submit,body .creator-actions button{border-radius:var(--sport-pill);font-weight:700;min-height:48px}
  body button:disabled{cursor:not-allowed}
  body .production-refresh,body .production-connector,body .schedule-actions button{border-radius:var(--sport-pill);font-weight:600;box-shadow:none}
  body .trace-quick-filters button{font-family:var(--sport-font);border-radius:var(--sport-pill);font-weight:600;box-shadow:none}
  body .trace-quick-filters button.active{background:var(--sport-lime);color:var(--sport-bg)}
  body.production-mode .trace-card{border-radius:var(--sport-radius);background:var(--sport-surface)}
  body.production-mode .trace-card-body{padding:var(--sport-gap)}
  body.production-mode .trace-card-body h3{font-family:var(--sport-title);font-size:24px;font-weight:var(--sport-weight);letter-spacing:-.045em}
  body.production-mode .trace-card-body h4{font-family:var(--sport-title);font-size:24px;font-weight:var(--sport-weight)}
  body.production-mode .trace-client{font-family:var(--sport-font);font-weight:700}
  body.production-mode .trace-card :is(dt,dd,p,small){font-family:var(--sport-font)}
  body.production-mode .trace-media{background:var(--sport-text)}
  body.production-mode .trace-card .trace-design-main img{object-fit:contain}
  body.production-mode .trace-card button:not(.trace-node){font-family:var(--sport-font);font-weight:600;box-shadow:none}
  body.production-mode .trace-route{background:var(--sport-bg)}
  body .studio-header h2,body dialog h2{font-family:var(--sport-title);font-weight:var(--sport-weight);text-transform:uppercase;letter-spacing:-.035em}
  body .studio-context{border-radius:var(--sport-radius);background:var(--sport-bg)}
  body .production-studio .operator-actions button{border-radius:var(--sport-radius);box-shadow:none}
  body .schedule-event{border-radius:var(--sport-radius);box-shadow:none}
  body .schedule-event strong{font-family:var(--sport-font);font-weight:700}
  body .production-table th{font-family:var(--sport-font);font-weight:600}
  body :is(input,select,textarea):focus-visible{outline:2px solid var(--sport-lime);outline-offset:2px}
  @media(hover:hover){body .dropzone:hover{border-color:var(--sport-lime);background:var(--sport-surface)}body #submit:not(:disabled):hover{filter:brightness(1.08)}}
  @media(max-width:700px){html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{min-height:38px}body .card-head,body.production-mode .trace-card-body{padding:16px}body header h1{font-size:30px}body.production-mode .trace-card-body h3,body.production-mode .trace-card-body h4{font-size:22px}}
  body :is(h1,h2,h3,h4){letter-spacing:normal!important;line-height:1.25}
  html body.top-navigation .sidebar nav.tabs>.tab strong,html body.top-navigation .sidebar .nav-parent{font-size:14px;letter-spacing:normal}
  html body.top-navigation .sidebar .nav-children .tab strong{font-size:14px;line-height:1.4}
  body .card-head p,body .trace-results,body .trace-route-caption,body .trace-route-caption>span{font-size:14px;color:var(--sport-muted)}
  body.production-mode .trace-card dt,body.production-mode .trace-material-facts small{font-size:13px;color:var(--sport-muted)}
  body.production-mode .trace-card dd,body.production-mode .trace-material-facts strong{font-size:15px;line-height:1.5}
  body .trace-quick-filters button{font-size:14px;line-height:1.4}
  body .trace-node-label{font-size:11px;letter-spacing:0}
  body .trace-node.pending .trace-node-label{color:var(--sport-muted)}
  body .production-title h2,body .schedule-title h2{font-size:22px}
  /* Equal-sized cards without clipping observations or manufacturing details. */
  html body.production-mode .trace-cards{align-items:stretch;grid-auto-rows:max-content}
  html body.production-mode .trace-card{height:auto;min-height:var(--uniform-card-height,0px);box-sizing:border-box;grid-template-rows:minmax(min-content,1fr) auto;align-self:stretch}
  html body.production-mode .trace-card-body{display:flex;flex-direction:column;min-height:0}
  html body.production-mode .trace-card-actions{margin-top:auto}
  html body.production-mode .trace-media{height:100%;min-height:0;box-sizing:border-box;align-self:stretch}
  html body.production-mode .trace-route{align-self:end;min-height:154px;box-sizing:border-box}
  @media(max-width:600px){
    html body.production-mode .trace-card{grid-template-rows:290px minmax(min-content,1fr) auto}
    html body.production-mode .trace-media,html body.production-mode .trace-media:has(img),html body.production-mode .trace-media:not(:has(img)){height:290px;min-height:290px}
  }
  @media(max-width:700px){html body.top-navigation .sidebar nav.tabs>.tab strong,html body.top-navigation .sidebar .nav-parent{font-size:12px}html body.top-navigation .sidebar nav.tabs>.tab,html body.top-navigation .sidebar .nav-parent{padding:8px 6px}body .trace-node-label{font-size:10px}}
  `;
  document.head.appendChild(style);
})();

// Four portrait summaries; details expand in place without changing order actions.
(() => {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = `
  html body.production-mode .trace-cards{grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:max-content;align-items:start;gap:16px;padding:16px}
  html body.production-mode .trace-card,html body.production-mode.trace-density-compact .trace-card{position:relative;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(120px,1fr) auto auto;aspect-ratio:auto;width:100%;min-width:0;min-height:520px;height:auto;align-self:start;container-type:inline-size}
  html body.production-mode .trace-card .trace-media,html body.production-mode.trace-density-compact .trace-card .trace-media{height:100%!important;min-height:0!important;padding:8px!important;overflow:hidden;display:flex;flex-direction:column;justify-content:center}
  html body.production-mode .trace-card .trace-design-view{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;gap:4px}
  html body.production-mode .trace-card .trace-design-main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;width:100%}
  html body.production-mode .trace-card .trace-design-main img,html body.production-mode.trace-density-compact .trace-card .trace-design-main img{width:100%;height:100%!important;max-height:100%;min-height:0;object-fit:contain}
  html body.production-mode .trace-card .trace-card-body{padding:12px!important;display:flex;flex-direction:column;min-height:0}
  html body.production-mode .trace-card .trace-card-body> :not(.trace-disclosure){flex-shrink:0}
  html body.production-mode .trace-card .trace-card-actions{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,.7fr) minmax(0,1fr)!important;gap:5px;margin-top:auto;padding-top:10px}
  html body.production-mode .trace-card .trace-card-actions button{grid-column:auto!important;min-height:38px;min-width:0;padding:8px 3px;font-size:11px!important;white-space:nowrap}
  html body.production-mode .trace-card .trace-card-actions [data-card-nas]{opacity:1;color:#e7f5ca!important;border-color:#7d9655!important}
  html body.production-mode .trace-card .trace-card-actions:not(:has([data-card-delete])){grid-template-columns:minmax(0,1.35fr) minmax(0,.7fr)!important}
  html body.production-mode .trace-card-heading{gap:6px;align-items:center;flex-wrap:wrap}
  html body.production-mode .trace-card-heading h3{font-size:17px!important;margin:0}
  html body.production-mode .trace-stage{font-size:11px;padding:3px 6px}
  html body.production-mode .trace-client{font-size:13px!important;line-height:1.35;margin:7px 0 0}
  html body.production-mode .trace-card .trace-project{font-size:12px;line-height:1.35;margin:4px 0;color:#c4cec7;overflow-wrap:anywhere}
  html body.production-mode .trace-card .trace-primary-facts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:8px 0 0}
  html body.production-mode .trace-card .trace-primary-facts dt{font-size:11px}
  html body.production-mode .trace-card .trace-primary-facts dd{font-size:13px;line-height:1.35;margin:0;overflow-wrap:anywhere}
  html body.production-mode .trace-card .trace-note-alert,html body.production-mode .trace-card .trace-production-note{margin:8px 0 0;padding:7px 9px;font-size:12px;max-height:74px;overflow:auto;overscroll-behavior:contain}
  html body.production-mode .trace-card .trace-note-alert p{font-size:12px;margin:4px 0}
  html body.production-mode .trace-card .trace-route{min-height:0;padding:8px 12px 12px}
  html body.production-mode .trace-card .trace-route-heading{display:none}
  html body.production-mode .trace-card .trace-route-caption{font-size:11px;line-height:1.3;margin:4px 0;gap:3px}
  html body.production-mode .trace-card .trace-route-caption .trace-progress-percent{font-size:12px}
  html body.production-mode .trace-card .trace-progress{margin:6px 0 0;height:7px}
  html body.production-mode .trace-card:not(.details-expanded) .trace-node{min-height:23px;padding:0;gap:0}
  html body.production-mode .trace-card:not(.details-expanded) .trace-node-label{display:none}
  html body.production-mode .trace-card:not(.details-expanded) .trace-node-dot{width:14px;height:14px;font-size:8px;box-shadow:none}
  html body.production-mode .trace-card:not(.details-expanded) .trace-node:before{top:7px}
  html body.production-mode .trace-disclosure-toggle{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;min-height:38px;padding:0;background:#14221b;color:#d0f44c;border:1px solid #75876a;border-radius:10px;font:24px/1 Arial;box-shadow:0 2px 8px #0003}
  html body.production-mode .trace-disclosure-toggle:hover,html body.production-mode .trace-disclosure-toggle[aria-expanded=true]{background:#d0f44c;color:#14221b}
  html body.production-mode .trace-disclosure[hidden]{display:none!important}
  html body.production-mode .trace-disclosure:not([hidden]){display:block;margin-top:14px}
  html body.production-mode .trace-card:not(.details-expanded){height:860px!important;grid-template-rows:380px minmax(0,1fr) auto}
  html body.production-mode .trace-card .trace-design-tabs{height:36px;min-height:36px;flex:0 0 36px;overflow-x:auto;white-space:nowrap}
  html body.production-mode .trace-card.details-expanded{aspect-ratio:auto;grid-template-rows:380px auto auto}
  html body.production-mode .trace-card.details-expanded .trace-note-alert,html body.production-mode .trace-card.details-expanded .trace-production-note{max-height:none;overflow:visible}
  html body.production-mode .trace-disclosure .trace-card-actions{grid-template-columns:1fr!important;gap:8px}
  html body.production-mode .trace-disclosure .trace-card-actions button{width:100%;min-width:0;white-space:normal}
  html body.production-mode .trace-disclosure dl{grid-template-columns:1fr 1fr;gap:12px}
  html body.production-mode .trace-density-toggle{display:none}
  html body.production-mode .trace-card .trace-note-alert{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;max-height:none;overflow:visible}
  html body.production-mode .trace-card .trace-note-alert>.trace-note-label{grid-column:1/-1}
  html body.production-mode .trace-card .trace-note-alert>p{min-width:0;margin:0;padding:5px 0 0;max-height:none;overflow:visible;overflow-wrap:anywhere;white-space:pre-wrap}
  html body.production-mode .trace-card .trace-note-alert>.trace-production-note{background:transparent!important;border-left:0;border-top:1px solid #f5a623}
  html body.production-mode .trace-card .trace-note-alert strong{display:inline;margin:0;letter-spacing:0}
  html body.production-mode .trace-card .trace-note-alert>p{white-space:normal;border:0;padding:0}
  html body.production-mode .trace-card:not(.details-expanded){height:auto!important;min-height:860px;align-self:stretch}
  /* Shared observation treatment: amber/orange, readable on Indoor's dark surfaces. */
  html body :is(.trace-note-alert,.trace-production-note,.trace-process-notes,.studio-notes){background:#3a2a12!important;border-color:#f5a623!important}
  html body :is(.trace-note-alert,.trace-production-note,.trace-process-notes,.studio-notes,.trace-inline-notes,.trace-full-note,.trace-note-count,.trace-note-label,.trace-note-preview),
  html body :is(.trace-note-alert,.trace-production-note,.trace-process-notes,.studio-notes,.trace-inline-notes,.trace-full-note) :is(p,strong,small,h3,h4,span,summary){color:#ffb84d!important;font-weight:700!important;font-size:12px!important;line-height:1.45!important;text-decoration-color:#ffb84d!important}
  html body.production-mode .trace-card .trace-note-alert>p{display:flex;align-items:flex-start;gap:6px}
  html body.production-mode .trace-card .trace-note-authors{display:flex;flex-wrap:wrap;gap:3px;flex:0 0 auto;max-width:62px}
  html body.production-mode .trace-card .trace-note-alert .trace-note-author-badge{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;box-sizing:border-box;flex:0 0 28px;border:1px solid #f5a623;border-radius:50%;background:#4a3316;font-size:10px!important;line-height:1!important;letter-spacing:0;margin:0}
  html body.production-mode .trace-card .trace-note-alert .trace-note-delete{flex:0 0 auto;margin-left:auto;width:20px!important;height:20px;padding:0!important;display:grid;place-items:center;border-radius:50%;border:1px solid #f5a623;background:#4a3316;color:#ffd9a0!important;font-size:13px!important;font-weight:900!important;line-height:1!important;box-shadow:none;cursor:pointer}
  html body.production-mode .trace-card .trace-note-alert .trace-note-delete:hover{background:#f5a623;color:#2a1c08!important}
  html body.production-mode .trace-card .trace-note-alert .trace-note-delete:disabled{opacity:.5;cursor:progress}
  html body.production-mode .trace-card .trace-note-text{min-width:0;padding-top:5px;overflow-wrap:anywhere}
  @media(max-width:1050px) and (min-width:601px){html body.production-mode .trace-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:600px){html body.production-mode .trace-cards{grid-template-columns:1fr}html body.production-mode .trace-card .trace-client{font-size:14px!important}}

  /* ===== Capa de acabado profesional (Producción) =====
     Borde neutro con una franja superior de color según el estado (en vez de marcos gruesos),
     tarjetas de altura natural e igualadas por fila, ruta en una sola línea y controles más limpios. */
  html body.production-mode .trace-cards{gap:18px;padding:18px}
  html body.production-mode .trace-card,html body.production-mode .trace-card:is(.state-finished,.state-active,.state-rework){--accent:#4b5a4e;border:1px solid #2c372f!important;border-top:3px solid var(--accent)!important;border-radius:16px;background:#141b16;box-shadow:0 1px 2px #0005,0 10px 26px -14px #000b;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
  html body.production-mode .trace-card.state-active{--accent:#ffad4f}html body.production-mode .trace-card.state-rework{--accent:#ff6b6b}html body.production-mode .trace-card.state-finished{--accent:#63d58a}
  @media(hover:hover){html body.production-mode .trace-card:hover,html body.production-mode .trace-card:is(.state-finished,.state-active,.state-rework):hover{transform:translateY(-3px);border-color:#46564a!important;border-top-color:var(--accent)!important;box-shadow:0 18px 36px -16px #000d}}
  html body.production-mode .trace-card:not(.details-expanded){min-height:0;height:auto!important;grid-template-rows:230px 1fr auto;align-self:stretch}
  html body.production-mode .trace-card.details-expanded{grid-template-rows:230px auto auto}
  html body.production-mode .trace-card .trace-media,html body.production-mode.trace-density-compact .trace-card .trace-media{padding:10px!important;background:linear-gradient(180deg,#f4f6f2,#e7ebe4)}
  html body.production-mode .trace-card .trace-design-tabs{height:26px;min-height:26px;flex:0 0 26px}
  html body.production-mode .trace-card .trace-design-tabs button{min-height:22px;padding:0 9px;font-size:10px;border-radius:999px}
  html body.production-mode .trace-card .trace-card-body{padding:14px 14px 12px!important;gap:2px}
  html body.production-mode .trace-card-heading h3{font-size:18px!important;letter-spacing:.01em}
  html body.production-mode .trace-card .trace-stage{border-radius:999px;padding:3px 10px;font-weight:700;letter-spacing:.02em}
  html body.production-mode .trace-card .trace-client{font-size:12px!important;font-weight:700;letter-spacing:.03em;color:#dfe8da;text-transform:uppercase}
  html body.production-mode .trace-card .trace-primary-facts{padding:8px 10px;margin-top:10px;border-radius:10px;background:#0f1511}
  html body.production-mode .trace-card .trace-primary-facts dt{font-size:10px;color:#8e9c8f;text-transform:uppercase;letter-spacing:.05em}
  html body.production-mode .trace-card .trace-note-alert{grid-template-columns:1fr;margin-top:10px;border-radius:10px}
  html body.production-mode .trace-card .trace-card-actions{gap:6px;padding-top:12px}
  html body.production-mode .trace-card .trace-card-actions button{min-height:36px;border-radius:10px;font-weight:700!important;letter-spacing:.03em}
  html body.production-mode .trace-card .trace-route{padding:10px 14px 14px;background:#101612;border-top:1px solid #243028}
  html body.production-mode .trace-card .trace-nodes{grid-template-columns:none!important;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
  html body.production-mode .trace-card .trace-progress{height:6px;border-radius:999px}
  html body.production-mode .trace-disclosure-toggle{top:12px;right:12px;width:34px;height:34px;min-height:34px;font-size:18px;border-radius:50%;background:rgba(15,21,17,.78);border-color:rgba(255,255,255,.18);backdrop-filter:blur(6px);box-shadow:0 4px 12px #0005}
  html body.production-mode .trace-quick-filters button{transition:background .15s,border-color .15s,transform .15s}
  html body.production-mode .trace-quick-filters button:hover{transform:translateY(-1px)}
  html body.production-mode #trace-schedule-order{background:var(--lime,#d0f44c);color:#10140d;border-color:var(--lime,#d0f44c);font-weight:800}
  html body.production-mode #trace-schedule-order:hover{filter:brightness(1.06)}
  @media(max-width:600px){html body.production-mode .trace-card:not(.details-expanded),html body.production-mode .trace-card.details-expanded{grid-template-rows:220px auto auto}}
  @media(max-width:860px){html body.production-mode .trace-quick-filters{display:flex!important;flex-wrap:nowrap;overflow-x:auto;gap:8px;padding-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch}html body.production-mode .trace-quick-filters::-webkit-scrollbar{display:none}html body.production-mode .trace-quick-filters button{flex:0 0 auto;white-space:nowrap;min-height:40px;padding:8px 14px}}
  @media(prefers-reduced-motion:reduce){html body.production-mode .trace-card{transition:none}}
  `;
  document.head.appendChild(style);
})();
