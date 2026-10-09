/* Dashboard de INICIO: solo lectura sobre /api/produccion. No modifica datos.
   Cuatro tarjetas: tiempo promedio de producción, unidades por fabricar,
   entregas de la semana y porcentaje de avance. Se actualiza solo. */
(function () {
  'use strict';
  const root = document.getElementById('home-dashboard');
  if (!root) return;

  const key = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAY = 86400000;

  function parseDate(value) {
    const raw = key(value).toLowerCase().replaceAll('.', '');
    const parts = raw.split(/[-/ ]+/);
    if (parts.length < 3) return null;
    let day = Number(parts[0]), year = Number(parts[2]);
    let month = /^\d+$/.test(parts[1]) ? Number(parts[1]) - 1 : MONTHS.indexOf(parts[1].slice(0, 3));
    if (/^\d{4}$/.test(parts[0])) { year = Number(parts[0]); day = Number(parts[2]); }
    if (year < 100) year += 2000;
    if (!Number.isInteger(day) || month < 0 || month > 11 || !Number.isInteger(year)) return null;
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }
  const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysBetween = (a, b) => Math.round((b - a) / DAY);
  const fmtShort = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const avg = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
  const fmtNum = (n, digits) => n === null ? '—' : (Math.round(n * Math.pow(10, digits || 0)) / Math.pow(10, digits || 0)).toLocaleString('es-CO');
  const num = value => Number(String(value || '0').replace(/[^0-9.-]/g, '')) || 0;

  function findColumn(headers, names, contains) {
    const keys = headers.map(key);
    for (const name of names) { const i = keys.indexOf(name); if (i >= 0) return i; }
    for (const part of contains || []) { const i = keys.findIndex(k => k.includes(part)); if (i >= 0) return i; }
    return -1;
  }

  function analyse(data) {
    const headers = data.headers || [];
    const col = {
      order: findColumn(headers, ['ORDEN']),
      client: findColumn(headers, ['NOMBRE DEL CLIENTE']),
      reference: findColumn(headers, ['REFERENCIA'], ['REFERENCIA', 'REF.']),
      quantity: findColumn(headers, ['CANTIDAD']),
      due: findColumn(headers, ['FECHA DE ENTREGA']),
      created: findColumn(headers, ['FECHA DE CREACION', 'FECHA CREACION'], ['CREAC', 'FECHA DE PEDIDO', 'FECHA DE ORDEN', 'FECHA DE INGRESO']),
      delivered: findColumn(headers, ['ENTREGADO'])
    };
    if (col.created < 0 && headers.length > 10 && key(headers[10]).includes('FECHA')) col.created = 10;
    const flow = typeof indoorProcessFlow !== 'undefined' ? indoorProcessFlow : [];
    const processes = flow.map(p => ({
      label: p.label,
      external: key(p.label) === 'DISENO',
      columns: p.headers.flatMap(h => headers.flatMap((header, i) => key(header) === h ? [i] : []))
    })).filter(p => p.columns.length);
    const internal = processes.filter(p => !p.external);

    const orders = new Map();
    (data.rows || []).forEach(row => {
      const v = row.values || [];
      const name = String(v[col.order] || '').trim();
      const client = String(v[col.client] || '').trim();
      if (!name && !client) return;
      const id = name || 'fila-' + row.source_row;
      let o = orders.get(id);
      if (!o) { o = { id, client, reference: '', rows: [], due: null, created: null, units: 0 }; orders.set(id, o); }
      o.rows.push(v);
      if (!o.reference && col.reference >= 0) o.reference = String(v[col.reference] || '').trim();
      o.units += col.quantity >= 0 ? num(v[col.quantity]) : 0;
      const due = col.due >= 0 ? parseDate(v[col.due]) : null;
      if (due && (!o.due || due > o.due)) o.due = due;
      const created = col.created >= 0 ? parseDate(v[col.created]) : null;
      if (created && (!o.created || created < o.created)) o.created = created;
    });

    const today = startOfToday();
    const list = [...orders.values()];
    // Áreas que le tocan a un pedido (para saber su carga programada): las que usan casi todos los pedidos ya entregados; las demás
    // (p. ej. Aplique, Facturación) solo si ese pedido ya las tocó, porque una celda vacía ahí puede ser «no aplica».
    const wasDelivered = o => { const marks = o.rows.map(v => { const cell = col.delivered >= 0 ? v[col.delivered] : ''; return !!parseDate(cell) || key(cell) === 'SI'; }); return !!marks.length && marks.every(Boolean); };
    const touched = (o, p) => o.rows.some(v => p.columns.some(i => { const c = key(v[i]); return c !== '' && c !== 'N/A'; }));
    const deliveredOrders = list.filter(wasDelivered);
    const standard = new Map(internal.map(p => [p.label, deliveredOrders.length >= 5 ? deliveredOrders.filter(o => touched(o, p)).length / deliveredOrders.length >= .6 : true]));
    list.forEach(o => {
      const marks = o.rows.map(v => {
        const cell = col.delivered >= 0 ? v[col.delivered] : '';
        return { date: parseDate(cell), yes: key(cell) === 'SI' };
      });
      o.delivered = !!marks.length && marks.every(m => m.date || m.yes);
      const dates = marks.map(m => m.date).filter(Boolean);
      o.deliveredOn = o.delivered && dates.length ? new Date(Math.max(...dates)) : null;
      o.finishedOn = {};
      const states = {};
      processes.forEach(p => {
        const cells = o.rows.flatMap(v => p.columns.map(i => key(v[i])));
        const closed = cells.map(c => c === 'N/A' || !!parseDate(c));
        states[p.label] = cells.includes('R') ? 'rework' : cells.includes('P') ? 'active'
          : cells.length && closed.every(Boolean) ? 'finished' : 'pending';
        const ds = o.rows.flatMap(v => p.columns.map(i => parseDate(v[i]))).filter(Boolean);
        if (ds.length) o.finishedOn[p.label] = new Date(Math.max(...ds));
      });
      const done = internal.filter(p => states[p.label] === 'finished').length;
      o.percent = internal.length ? Math.round(done / internal.length * 100) : 0;
      o.complete = internal.length > 0 && done === internal.length;
      o.states = states;
      o.rework = internal.some(p => states[p.label] === 'rework');
      // Area donde esta el pedido ahora: reproceso > en proceso > primer proceso sin cerrar.
      const focus = internal.find(p => states[p.label] === 'rework') || [...internal].reverse().find(p => states[p.label] === 'active') || internal.find(p => states[p.label] !== 'finished');
      o.focus = focus ? focus.label : '';
      // Carga REAL y PROGRAMADA por área, fila por fila (cada fila es una referencia con sus propias unidades):
      //   en proceso = celda «P»; reproceso = «R»; en cola = la primera área que le toca y aún no empieza; programado = las siguientes que le tocan.
      // Las áreas que quedaron atrás del avance de la fila (vacías pero ya superadas) no cuentan.
      o.areas = {};
      o.rows.forEach(v => {
        const units = col.quantity >= 0 ? num(v[col.quantity]) : 0;
        const rowStates = internal.map(p => {
          const cells = p.columns.map(i => key(v[i]));
          return cells.includes('R') ? 'rework' : cells.includes('P') ? 'active' : cells.length && cells.every(c => c === 'N/A' || !!parseDate(c)) ? 'finished' : 'pending';
        });
        let frontier = -1;
        rowStates.forEach((st, i) => { if (st !== 'pending') frontier = i; });
        let first = true;
        internal.forEach((p, i) => {
          const st = rowStates[i];
          let kind = null;
          if (st === 'active') kind = 'proc';
          else if (st === 'rework') kind = 'rep';
          else if (st === 'pending' && i > frontier && (standard.get(p.label) || touched(o, p))) { kind = first ? 'cola' : 'prog'; first = false; }
          if (!kind) return;
          const slot = o.areas[p.label] || (o.areas[p.label] = { proc: { rows: 0, units: 0 }, cola: { rows: 0, units: 0 }, prog: { rows: 0, units: 0 }, rep: { rows: 0, units: 0 } });
          slot[kind].rows++; slot[kind].units += units;
        });
      });
    });

    const active = list.filter(o => !o.delivered);
    const toMake = active.filter(o => !o.complete);

    // Semana en curso, de lunes a domingo.
    const weekStart = addDays(today, -((today.getDay() + 6) % 7));
    const weekEnd = addDays(weekStart, 6);
    const week = active.filter(o => o.due && o.due >= weekStart && o.due <= weekEnd);
    const before = active.filter(o => o.due && o.due < weekStart);

    // Tiempo de produccion: real si hay entregas con fecha; si no, suma de lo que tarda cada proceso.
    const done = list.filter(o => o.delivered && o.deliveredOn && o.created && o.deliveredOn >= o.created);
    const since = addDays(today, -90);
    const recent = done.filter(o => o.deliveredOn >= since);
    const sample = recent.length >= 3 ? recent : done;
    const real = avg(sample.map(o => daysBetween(o.created, o.deliveredOn)));
    const spans = new Map(processes.map(p => [p.label, []]));
    list.forEach(o => {
      let prev = o.created;
      processes.forEach(p => {
        const d = o.finishedOn[p.label];
        if (!d) return;
        if (prev) { const n = daysBetween(prev, d); if (n >= 0) spans.get(p.label).push(n); }
        if (!prev || d > prev) prev = d;
      });
    });
    const perProcess = [...spans.values()].map(avg).filter(v => v !== null);
    const estimated = perProcess.length ? perProcess.reduce((s, n) => s + n, 0) : null;
    const promised = avg(active.filter(o => o.created && o.due && o.due >= o.created).map(o => daysBetween(o.created, o.due)));

    // Tiempo por orden: dias desde la creacion; plazo propio (creacion→entrega) o, si falta, el promedio.
    const typical = real !== null ? real : estimated !== null ? estimated : promised;
    const timing = active.filter(o => o.created && o.created <= today).map(o => {
      const elapsed = daysBetween(o.created, today);
      const plazo = o.due && o.due >= o.created ? daysBetween(o.created, o.due) : (typical !== null ? Math.round(typical) : null);
      const left = o.due ? daysBetween(today, o.due) : (plazo !== null ? plazo - elapsed : null);
      return { o, elapsed, plazo, left, ratio: plazo ? elapsed / plazo : 0 };
    }).sort((a, b) => b.ratio - a.ratio || b.elapsed - a.elapsed);

    const tomorrow = addDays(today, 1);
    const sameDay = (a, b) => a && a.getTime() === b.getTime();
    const byDue = (a, b) => a.due - b.due;
    const dueToday = active.filter(o => sameDay(o.due, today));
    const dueTomorrow = active.filter(o => sameDay(o.due, tomorrow));
    const late = active.filter(o => o.due && o.due < today).sort(byDue);
    const reworkList = active.filter(o => o.rework).sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
    const load = internal.map(p => {
      const items = [];
      const total = { proc: { orders: 0, units: 0 }, cola: { orders: 0, units: 0 }, prog: { orders: 0, units: 0 }, rep: { orders: 0, units: 0 } };
      toMake.forEach(o => {
        const slot = o.areas[p.label];
        if (!slot) return;
        const kinds = ['proc', 'rep', 'cola', 'prog'].filter(k => slot[k].rows);
        if (!kinds.length) return;
        kinds.forEach(k => { total[k].orders++; total[k].units += slot[k].units; });
        items.push({ o, kinds, units: kinds.reduce((sum, k) => sum + slot[k].units, 0) });
      });
      const orders = items.length;
      return { label: p.label, orders, units: ['proc', 'cola', 'prog', 'rep'].reduce((sum, k) => sum + total[k].units, 0), total, items, late: items.filter(i => i.o.due && i.o.due < today).length };
    }).filter(item => item.orders);

    return {
      orders: list, timing, typical, flow: internal.map(p => p.label),
      dueToday, dueTomorrow, late, reworkList, load,
      today, weekStart, weekEnd, activeCount: active.length,
      real, realCount: sample.length, estimated, promised,
      unitsToMake: toMake.reduce((s, o) => s + o.units, 0), ordersToMake: toMake.length,
      unitsAll: active.reduce((s, o) => s + o.units, 0),
      weekCount: week.length, weekUnits: week.reduce((s, o) => s + o.units, 0), weekProgress: week.length ? avg(week.map(o => o.percent)) : null,
      lateBefore: before.length,
      progress: active.length ? avg(active.map(o => o.percent)) : null,
      progressUnits: active.reduce((s, o) => s + o.units, 0) ? active.reduce((s, o) => s + o.units * o.percent, 0) / active.reduce((s, o) => s + o.units, 0) : null
    };
  }

  const LQ_TONE = { lime: 'oliva', blue: 'azul', orange: 'ambar', green: 'verde', red: 'rojo' };
  const card = (tone, title, value, unit, lines, badge, level) =>
    '<article class="dash-card ' + tone + '" data-lq="' + Math.max(0, Math.min(100, Math.round(level === undefined || level === null ? 100 : level))) + '" data-lq-tone="' + (LQ_TONE[tone] || 'verde') + '"' + (level === undefined || level === null ? ' data-lq-nopct' : '') + '><h4>' + title + (badge ? '<em class="dash-badge">' + badge + '</em>' : '') + '</h4><div class="dash-big"><strong>' + value + '</strong><span>' + unit + '</span></div>' +
    '<ul>' + lines.filter(Boolean).map(([label, val]) => val === '' ? '<li class="note">' + label + '</li>' : '<li><span>' + label + '</span><b>' + val + '</b></li>').join('') + '</ul></article>';

  const fmtDue = d => d ? fmtShort(d) : 'Sin fecha';
  function orderList(items, empty, detail) {
    if (!items.length) return '<p class="dash-none">' + empty + '</p>';
    const shown = items;
    return '<ul class="dash-orders">' + shown.map(o => '<li><div><strong>' + esc(o.id) + '</strong><span>' + esc(o.client || 'Sin cliente') + '</span></div><div class="dash-order-meta"><b>' + fmtNum(o.units) + ' und.</b><small>' + detail(o) + '</small></div></li>').join('') + '</ul>' +
      (items.length > shown.length ? '<p class="dash-more">y ' + (items.length - shown.length) + ' más</p>' : '');
  }
  function todayPanel(tone, title, count, body) {
    return '<section class="dash-panel ' + tone + '"><div class="dash-panel-head"><h4>' + title + '</h4><span class="dash-count">' + count + '</span></div>' + body + '</section>';
  }
  function orderFinder(orders) {
    return '<section class="dash-order-finder"><label><span class="dash-sr">Buscar orden o cliente</span><input id="dash-order-search" type="search" autocomplete="off" placeholder="Busca por número de orden o cliente"><span class="dash-search-icon" aria-hidden="true">⌕</span></label><div id="dash-order-results" class="dash-order-results" aria-live="polite"></div></section>';
  }
  function bindOrderFinder(orders) {
    const input = root.querySelector('#dash-order-search');
    const results = root.querySelector('#dash-order-results');
    if (!input || !results) return;
    const show = query => {
      const q = key(query);
      if (!q) { results.innerHTML = '<p>Escribe una orden o un cliente para consultar el proceso actual.</p>'; return; }
      const matches = orders.filter(order => key(order.id).includes(q) || key(order.client).includes(q)).slice(0, 8);
      results.innerHTML = matches.length ? matches.map(order => {
        const status = order.rework ? 'En reproceso' : order.complete ? 'Finalizada' : order.focus ? 'En ' + order.focus : 'Sin proceso activo';
        const state = order.rework ? 'rework' : order.complete ? 'finished' : 'active';
        const reference = order.reference ? '<span class="dash-order-reference"><small>' + esc(order.reference) + '</small></span>' : '';
        return '<button type="button" class="dash-order-result" data-order="' + esc(order.id) + '"><span class="dash-order-result-head"><strong>' + esc(order.id) + '</strong><em class="' + state + '">' + esc(status) + '</em></span><span class="dash-order-client">' + esc(order.client || 'Sin cliente') + '</span>' + reference + '<span class="dash-order-process ' + state + '"><b>Proceso actual</b><small>' + esc(order.focus || (order.complete ? 'Orden finalizada' : 'Sin proceso activo')) + '</small></span><span class="dash-order-progress"><i><b style="width:' + order.percent + '%"></b></i><small>' + order.percent + '% de avance · ' + fmtNum(order.units) + ' und.</small></span><span class="dash-order-open">Ver en producción →</span></button>';
      }).join('') : '<p>No encontramos una orden o cliente con esa búsqueda.</p>';
    };
    input.addEventListener('input', () => show(input.value));
    results.addEventListener('click', event => {
      const result = event.target.closest('[data-order]');
      if (!result) return;
      const order = result.dataset.order;
      const productionTab = document.querySelector('.tab[data-kind="produccion"]');
      productionTab?.click();
      const productionInput = document.getElementById('production-search');
      if (productionInput) {
        productionInput.value = order;
        productionInput.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => document.getElementById('production-table-wrap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 260);
      }
    });
    show('');
  }

  function greet(a) {
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
    const fullName = (document.querySelector('.user-menu .user-info strong')?.textContent || '').trim();
    const first = fullName.split(/\s+/)[0] || '';
    const pretty = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
    const heading = document.getElementById('home-greeting');
    const line = document.getElementById('home-date');
    if (heading) heading.textContent = hello + (pretty ? ', ' + pretty : '');
    if (line) {
      const date = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      const bits = [a.dueToday.length + (a.dueToday.length === 1 ? ' entrega hoy' : ' entregas hoy')];
      if (a.late.length) bits.push(a.late.length + (a.late.length === 1 ? ' pedido atrasado' : ' pedidos atrasados'));
      if (a.reworkList.length) bits.push(a.reworkList.length + ' en reproceso');
      line.textContent = date + ' · ' + bits.join(' · ');
    }
  }

  // ---- PESTAÑAS DEL INICIO (para no tener que bajar tanto) ----
  const TABS = [['resumen', 'Resumen'], ['tiempo', 'Tiempo por orden'], ['carga', 'Carga por área']];
  let activeTab = 'resumen';
  try { const saved = localStorage.getItem('indoor-home-tab'); if (TABS.some(([id]) => id === saved)) activeTab = saved; } catch (e) { /* sin almacenamiento */ }
  function tabsBar(a) {
    const badge = { tiempo: a.timing.length || '', carga: a.load.length || '' };
    return '<nav class="dash-tabs" role="tablist" aria-label="Secciones del resumen">' + TABS.map(([id, label]) =>
      '<button type="button" role="tab" class="' + (id === activeTab ? 'on' : '') + '" data-dash-tab="' + id + '" aria-selected="' + (id === activeTab) + '">' + label + (badge[id] ? ' <b>' + badge[id] + '</b>' : '') + '</button>').join('') + '</nav>';
  }
  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-dash-tab]');
    if (!tab) return;
    activeTab = tab.dataset.dashTab;
    try { localStorage.setItem('indoor-home-tab', activeTab); } catch (e) { /* sin almacenamiento */ }
    root.querySelectorAll('[data-dash-tab]').forEach(b => { const on = b.dataset.dashTab === activeTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    root.querySelectorAll('.dash-pane').forEach(pane => pane.classList.toggle('on', pane.dataset.pane === activeTab));
    countUp();
    playStairs(root.querySelector('.dash-pane.on'));
  });

  // ---- CARGA POR ÁREA (real: filas en proceso, en cola y en reproceso de cada área, en el orden del flujo; cada tarjeta lista todos sus pedidos) ----
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  // ---- VENTANA DE UN ÁREA (pantalla completa): cada pedido como barra de proceso según sus fechas ----
  const KIND = { proc: 'En proceso', cola: 'En cola', prog: 'Programado', rep: 'Reproceso' };
  const STATE_TEXT = { finished: 'terminado', active: 'en proceso', rework: 'reproceso', pending: 'pendiente' };
  const dlg = document.createElement('dialog');
  dlg.className = 'dash-areadlg';
  dlg.setAttribute('aria-label', 'Pedidos del área');
  document.body.appendChild(dlg);
  const view = { label: '', kind: 'all', q: '', sort: 'due' };
  const dayText = n => n === 0 ? 'hoy' : n === 1 ? 'mañana' : n > 0 ? 'en ' + n + ' d' : 'hace ' + (-n) + ' d';

  // Barra de tiempo del pedido: de la fecha de creación a la de entrega (o al plazo típico si no tiene). La marca «hoy» cae donde va el calendario.
  function barOf(o, today, typical) {
    if (!o.created) return null;
    let end = o.due;
    if (!end && typical) end = addDays(o.created, Math.max(1, Math.round(typical)));
    if (!end || end <= o.created) end = addDays(o.created, 1);
    const total = Math.max(1, daysBetween(o.created, end)), elapsed = daysBetween(o.created, today), ratio = elapsed / total;
    const late = !!o.due && o.due < today;
    return { total, elapsed, ratio, late, end, estimated: !o.due, tone: late ? 'late' : ratio >= .8 ? 'warn' : 'ok', left: daysBetween(today, end) };
  }

  function orderRow(item, a, index) {
    const o = item.o, b = barOf(o, a.today, a.typical), kind = item.kinds[0], prog = Math.round(o.percent || 0);
    const fill = b ? Math.max(2, Math.min(100, Math.round(b.ratio * 100))) : 0;
    const steps = a.flow.map(label => {
      const st = (o.states || {})[label] || 'pending', when = o.finishedOn && o.finishedOn[label] ? ' · ' + fmtShort(o.finishedOn[label]) : '';
      return '<i class="st ' + st + (label === view.label ? ' here' : '') + '" title="' + esc(label) + ' · ' + STATE_TEXT[st] + when + '"><b>' + esc(label.slice(0, 3)) + '</b></i>';
    }).join('');
    const bar = b
      ? '<div class="od-bar" title="Barra de tiempo: de la creación a la entrega"><i class="od-fill"></i><i class="od-adv" title="Avance real de procesos: ' + prog + '%"></i><i class="od-today" style="left:' + fill + '%"><u>hoy</u></i></div>' +
        '<div class="od-dates"><span>Creada ' + fmtShort(o.created) + '</span><span class="od-mid">día ' + Math.max(0, b.elapsed) + ' de ' + b.total + (b.estimated ? ' (estimado)' : '') + ' · avance ' + prog + '%</span>' +
        '<span class="od-end">' + (b.late ? 'Venció ' + fmtShort(o.due) + ' · ' + dayText(daysBetween(o.due, a.today) * -1) : (o.due ? 'Entrega ' + fmtShort(o.due) : 'Entrega estimada ' + fmtShort(b.end)) + ' · ' + dayText(b.left)) + '</span></div>'
      : '<div class="od-bar none"></div><div class="od-dates"><span>Sin fecha de creación: no se puede medir el tiempo</span><span class="od-end">' + (o.due ? 'Entrega ' + fmtShort(o.due) : 'Sin fecha de entrega') + '</span></div>';
    return '<li class="od k-' + kind + ' tone-' + (b ? b.tone : 'none') + '" style="--i:' + Math.min(index, 24) + ';--w:' + fill + '%;--a:' + prog + '%">' +
      '<div class="od-top"><div class="od-id"><strong>' + esc(o.id) + '</strong><span>' + esc(o.client || 'Sin cliente') + '</span></div>' +
      '<div class="od-tags">' + item.kinds.map(k => '<em class="od-kind k-' + k + '">' + KIND[k] + '</em>').join('') + '</div><b class="od-units">' + fmtNum(item.units) + ' und.</b></div>' + bar +
      '<div class="od-steps" aria-label="Procesos del pedido">' + steps + '</div></li>';
  }

  const currentItem = () => model && model.load.find(i => i.label === view.label);
  function dlgShell() {
    dlg.innerHTML =
      '<div class="od-head"><div class="od-title"><span class="eyebrow">Carga por área</span><h3>' + esc(view.label) + '</h3><small data-od-sub></small></div>' +
      '<div class="od-kpis" data-od-kpis></div><button type="button" class="od-close" data-od-close aria-label="Cerrar la ventana">✕</button></div>' +
      '<div class="od-tools"><div class="od-chips" data-od-chips></div><label class="od-search"><input type="search" data-od-q autocomplete="off" placeholder="Buscar orden o cliente" value="' + esc(view.q) + '"></label>' +
      '<label class="od-sort"><span>Ordenar</span><select data-od-sort><option value="due">Entrega más próxima</option><option value="adv">Menor avance</option><option value="und">Más unidades</option><option value="old">Más antiguos</option></select></label></div>' +
      '<div class="od-legend"><span><i class="g-ok"></i>A tiempo</span><span><i class="g-warn"></i>Cerca de la entrega</span><span><i class="g-late"></i>Atrasado</span><span><i class="g-adv"></i>Avance real</span><span><i class="g-now"></i>Hoy</span></div>' +
      '<ul class="od-list" data-od-list></ul>';
    dlg.querySelector('[data-od-sort]').value = view.sort;
  }
  function dlgList() {
    const item = currentItem(), list = dlg.querySelector('[data-od-list]');
    if (!list) return;
    if (!item) { list.innerHTML = '<li class="od-empty">Esta área ya no tiene pedidos pendientes.</li>'; return; }
    const a = model, t = item.total, today = a.today;
    const isLate = i => i.o.due && i.o.due < today;
    const chips = [['all', 'Todos', item.orders], ['proc', 'En proceso', t.proc.orders], ['cola', 'En cola', t.cola.orders], ['prog', 'Programado', t.prog.orders], ['rep', 'Reproceso', t.rep.orders], ['late', 'Atrasados', item.late]];
    if (view.kind !== 'all' && !chips.some(([k, , n]) => k === view.kind && n)) view.kind = 'all';
    dlg.querySelector('[data-od-chips]').innerHTML = chips.filter(([k, , n]) => k === 'all' || n).map(([k, label, n]) =>
      '<button type="button" class="od-chip c-' + k + (view.kind === k ? ' on' : '') + '" data-od-kind="' + k + '">' + label + ' <b>' + n + '</b></button>').join('');
    const avg = item.items.length ? Math.round(item.items.reduce((s, i) => s + (i.o.percent || 0), 0) / item.items.length) : 0;
    dlg.querySelector('[data-od-kpis]').innerHTML =
      '<div class="od-kpi"><b>' + item.orders + '</b><span>pedidos</span></div><div class="od-kpi"><b>' + fmtNum(item.units) + '</b><span>unidades</span></div>' +
      '<div class="od-kpi' + (item.late ? ' bad' : '') + '"><b>' + item.late + '</b><span>atrasados</span></div><div class="od-kpi"><b>' + avg + '%</b><span>avance prom.</span></div>';
    dlg.querySelector('[data-od-sub]').textContent = plural(t.proc.orders, 'pedido', 'pedidos') + ' en proceso · ' + plural(t.cola.orders, 'pedido', 'pedidos') + ' en cola · ' + plural(t.prog.orders, 'pedido', 'pedidos') + ' programados · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const q = key(view.q);
    let rows = item.items.filter(i => (view.kind === 'all' || (view.kind === 'late' ? isLate(i) : i.kinds.includes(view.kind))) && (!q || key(i.o.id).includes(q) || key(i.o.client).includes(q)));
    const bySort = {
      due: (x, y) => (x.o.due || Infinity) - (y.o.due || Infinity),
      adv: (x, y) => (x.o.percent || 0) - (y.o.percent || 0),
      und: (x, y) => y.units - x.units,
      old: (x, y) => (x.o.created || Infinity) - (y.o.created || Infinity)
    };
    rows = [...rows].sort(bySort[view.sort] || bySort.due);
    list.classList.remove('go');
    list.innerHTML = rows.length ? rows.map((i, n) => orderRow(i, a, n)).join('') : '<li class="od-empty">No hay pedidos con ese filtro.</li>';
    requestAnimationFrame(() => requestAnimationFrame(() => list.classList.add('go')));
  }
  function openArea(label) {
    view.label = label; view.kind = 'all'; view.q = ''; view.sort = 'due';
    dlgShell(); dlgList();
    document.documentElement.style.overflow = 'hidden';
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[data-od-list]').scrollTop = 0;
  }
  function closeArea() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { view.label = ''; document.documentElement.style.overflow = ''; });
  dlg.addEventListener('click', event => {
    if (event.target === dlg || event.target.closest('[data-od-close]')) return closeArea();
    const chip = event.target.closest('[data-od-kind]');
    if (chip) { view.kind = chip.dataset.odKind; dlgList(); }
  });
  dlg.addEventListener('input', event => { if (event.target.matches('[data-od-q]')) { view.q = event.target.value; dlgList(); } });
  dlg.addEventListener('change', event => { if (event.target.matches('[data-od-sort]')) { view.sort = event.target.value; dlgList(); } });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-area-open]');
    if (button) openArea(button.dataset.areaOpen);
  });
  // ---- ESCALERA DE LA PLANTA: las áreas en el orden del flujo, cada escalón con su carga (a simple vista se ve dónde se acumula todo) ----
  let stairMetric = 'orders';
  try { if (localStorage.getItem('indoor-stairs-metric') === 'units') stairMetric = 'units'; } catch (e) { /* sin almacenamiento */ }
  let stairsPlayed = false;
  const SHORT = { 'MATERIALES': 'MATERIAL.', 'MTS REQUERIDOS': 'MTS REQ.', 'SUBLIMACIÓN': 'SUBLIM.', 'CONFECCIÓN': 'CONFEC.', 'FACTURACIÓN': 'FACTURA', 'IMPRESIÓN': 'IMPRES.' };
  const WAVE = { proc: '#b9f07e', rep: '#ff9a8d', cola: '#ffe0a0', prog: '#c6dbff' };   // color de la ola según lo que queda arriba de cada escalón
  const STAIR_KINDS = [['proc', 'En proceso'], ['rep', 'Reproceso'], ['cola', 'En cola'], ['prog', 'Programado']];   // de abajo hacia arriba
  function stairs(a, compact) {
    const byLabel = new Map(a.load.map(i => [i.label, i]));
    const none = () => ({ proc: { orders: 0, units: 0 }, cola: { orders: 0, units: 0 }, prog: { orders: 0, units: 0 }, rep: { orders: 0, units: 0 } });
    const steps = a.flow.map(label => byLabel.get(label) || { label, orders: 0, units: 0, late: 0, total: none() });
    const metric = stairMetric, active = Math.max(1, a.ordersToMake);
    const sumOf = s => STAIR_KINDS.reduce((n, [k]) => n + s.total[k][metric], 0);
    const max = Math.max(1, ...steps.map(sumOf));
    const heaviest = [...steps].sort((x, y) => y.orders - x.orders || y.units - x.units)[0];
    const span = compact ? 96 : 190;
    const totals = STAIR_KINDS.map(([k, label]) => [k, label, a.load.reduce((n, i) => n + i.total[k].orders, 0)]);
    const lateTotal = a.load.reduce((n, i) => n + i.late, 0);
    const word = metric === 'orders' ? 'pedidos' : 'und.';
    const cols = steps.map((s, i) => {
      const total = sumOf(s), rise = total ? Math.round(total / max * span) : 0;
      const share = Math.min(100, Math.round(s.orders / active * 100));
      const segs = STAIR_KINDS.filter(([k]) => s.total[k][metric]).map(([k, label]) => '<i class="sg ' + k + '" style="flex:' + s.total[k][metric] + '" title="' + label + ': ' + fmtNum(s.total[k][metric]) + ' ' + word + '"></i>').join('');
      const detail = STAIR_KINDS.filter(([k]) => s.total[k].orders).map(([k, label]) => label + ' ' + s.total[k].orders).join(' · ') || 'Sin pedidos';
      const value = metric === 'orders' ? s.orders : fmtNum(s.units);
      const other = metric === 'orders' ? fmtNum(s.units) + ' und.' : plural(s.orders, 'pedido', 'pedidos');
      const isTop = s === heaviest && s.orders;
      return '<button type="button" class="st-col' + (isTop ? ' top' : '') + (s.orders ? '' : ' empty') + '" data-area-open="' + esc(s.label) + '" style="--i:' + i + ';--rise:' + rise + 'px;--lv:' + Math.min(94, share) + '%" title="' + esc(s.label) + ' · ' + esc(detail) + '" aria-label="' + esc(s.label) + ': ' + s.orders + ' pedidos. Abrir detalle">' +
        (isTop ? '<em class="ar-ribbon">Mayor carga</em>' : '') +
        '<span class="st-slot"><span class="st-bar">' + segs + '</span></span>' +
        '<b class="st-name">' + esc(SHORT[s.label] || s.label) + '</b><span class="st-val">' + value + '</span>' +
        '<small class="st-sub">' + other + (s.late ? ' · <i class="st-late">' + s.late + ' atras.</i>' : '') + '</small>' +
        '<em class="st-pct">' + share + '%</em></button>';
    }).join('');
    return '<section class="dash-stairs' + (compact ? ' compact' : '') + (stairsPlayed ? ' go' : '') + '" data-compact="' + (compact ? 1 : 0) + '">' +
      '<header class="st-head"><div><span class="ar-kicker">CÓMO VA LA PLANTA</span><h3>Escalera de carga por área</h3><p>Cada escalón es un área en el orden del proceso: mientras más alto, más carga. El líquido muestra en qué estado está esa carga y el porcentaje es la parte de los pedidos en producción que pasa por el área.</p></div>' +
      '<div class="st-metric" role="group" aria-label="Medir por"><button type="button" data-st-metric="orders" class="' + (metric === 'orders' ? 'on' : '') + '">Pedidos</button><button type="button" data-st-metric="units" class="' + (metric === 'units' ? 'on' : '') + '">Unidades</button></div></header>' +
      '<div class="st-sum">' + totals.map(([k, label, n]) => '<span class="st-pill ' + k + '"><i></i>' + label + ' <b>' + n + '</b></span>').join('') +
      '<span class="st-pill late' + (lateTotal ? ' hot' : '') + '"><i></i>Atrasados <b>' + lateTotal + '</b></span>' +
      (heaviest && heaviest.orders ? '<span class="st-neck">Cuello de botella: <b>' + esc(heaviest.label) + '</b> · ' + plural(heaviest.orders, 'pedido', 'pedidos') + '</span>' : '') + '</div>' +
      '<div class="st-scroll"><div class="st-chart" role="list">' + cols + '</div></div>' +
      '<div class="st-flow" aria-hidden="true"><span>Entrada</span><i></i><span>Salida</span></div></section>';
  }
  function playStairs(scope) {
    (scope || root).querySelectorAll('.dash-stairs').forEach(el => {
      el.classList.remove('go');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('go')));
    });
    stairsPlayed = true;
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-st-metric]');
    if (!button || !model) return;
    stairMetric = button.dataset.stMetric;
    try { localStorage.setItem('indoor-stairs-metric', stairMetric); } catch (e) { /* sin almacenamiento */ }
    root.querySelectorAll('.dash-stairs').forEach(el => {
      const holder = document.createElement('div');
      holder.innerHTML = stairs(model, el.dataset.compact === '1');
      const fresh = holder.firstElementChild;
      el.replaceWith(fresh);
      requestAnimationFrame(() => requestAnimationFrame(() => fresh.classList.add('go')));
    });
  });

  function loadSection(a) {
    if (!a.load.length) return '';
    const active = Math.max(1, a.ordersToMake);   // pedidos que todavía están en producción: el 100 % de cada tarjeta
    const heaviest = [...a.load].sort((x, y) => y.orders - x.orders || y.units - x.units)[0];
    const colorOf = share => share >= 75 ? '#eb5a3d' : share >= 50 ? '#d38800' : share >= 25 ? '#3153e2' : '#12a58f';
    const cards = a.load.map((item, i) => {
      const share = Math.min(100, Math.round(item.orders / active * 100)), t = item.total;
      const parts = [t.proc.orders ? t.proc.orders + ' en proceso' : '', t.cola.orders ? t.cola.orders + ' en cola' : '', t.prog.orders ? t.prog.orders + (t.prog.orders === 1 ? ' programado' : ' programados') : '', t.rep.orders ? t.rep.orders + ' reproceso' : ''].filter(Boolean).join(' · ');
      return '<button type="button" class="ar-card' + (item === heaviest ? ' top' : '') + '" data-area-open="' + esc(item.label) + '" data-lq="' + share + '" data-lq-color="' + colorOf(share) + '" style="--i:' + i + '" aria-label="' + esc(item.label) + ': ' + plural(item.orders, 'pedido', 'pedidos') + '. Ver detalle">' +
        (item === heaviest ? '<em class="ar-ribbon">Mayor carga</em>' : '') +
        '<b>' + esc(item.label) + '</b><span>' + item.orders + '</span>' +
        '<small>' + (item.orders === 1 ? 'pedido' : 'pedidos') + ' · ' + fmtNum(item.units) + ' und.' + (item.late ? ' · <i class="ar-late">' + plural(item.late, 'atrasado', 'atrasados') + '</i>' : '') + '</small>' +
        '<small class="ar-brk">' + parts + '</small></button>';
    }).join('');
    return '<section class="ar-panel" id="dash-load"><header><div><span class="ar-kicker">ESTADO DE LA PLANTA</span><h3>Carga por área</h3><p>Seleccione un área para ver todos sus pedidos. El porcentaje es la parte de los pedidos en producción que pasa por esa área, según lo programado.</p></div>' +
      '<b class="ar-total">' + a.ordersToMake + '<small>pedidos en producción</small></b></header><div class="ar-grid">' + cards + '</div></section>';
  }

  function countUp() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.dash-big strong').forEach(el => {
      const target = Number(String(el.textContent).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(target) || target <= 0) return;
      const decimals = String(el.textContent).includes(',') ? 1 : 0, start = performance.now(), final = el.textContent;
      const step = now => {
        const t = Math.min(1, (now - start) / 700), eased = 1 - Math.pow(1 - t, 3);
        el.textContent = t < 1 ? fmtNum(target * eased, decimals) : final;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  const TONES = [['late', 'Atrasadas'], ['warn', 'Por vencer'], ['ok', 'A tiempo']];
  let timeFilter = '', timeLimit = 8, timeQuery = '', dateFrom = '', dateTo = '', dateBasis = 'created';
  const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
  const lastFinish = o => { const ds = Object.values(o.finishedOn || {}); return ds.length ? new Date(Math.max(...ds)) : null; };
  // Duracion en produccion: creacion → entrega real; si no hay entrega, → ultimo proceso cerrado (si ya termino) o → hoy.
  function duration(o, today) {
    if (!o.created) return { days: null, state: 'Sin fecha de creación', end: null };
    const end = o.delivered && o.deliveredOn ? o.deliveredOn : o.complete ? lastFinish(o) : null;
    const state = o.delivered ? 'Entregada' : o.complete ? 'Terminada, sin entrega' : o.rework ? 'En reproceso' : 'En producción';
    const stop = end && end >= o.created ? end : today;
    return { days: Math.max(0, daysBetween(o.created, stop)), state, end: end || null };
  }
  function downloadCsv(a, rows) {
    const head = ['Orden', 'Cliente', 'Referencia', 'Unidades', 'Fecha de creación', 'Fecha de entrega prometida', 'Fecha de entrega real', 'Fin de producción', 'Días en producción', 'Estado', 'Proceso actual', '% de avance'];
    const cell = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const lines = rows.map(o => { const d = duration(o, a.today); return [o.id, o.client, o.reference, o.units, iso(o.created), iso(o.due), iso(o.deliveredOn), iso(lastFinish(o)), d.days === null ? '' : d.days, d.state, o.focus, o.percent].map(cell).join(';'); });
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'tiempos_produccion_' + iso(a.today) + '.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }
  function renderTiming(a) {
    const box = root.querySelector('.dash-timing');
    if (!box) return;
    box.innerHTML = '<div class="dash-panel-head"><h4>Tiempo por orden</h4><small>Días desde la creación · promedio ' + fmtNum(a.typical, 1) + ' d · aproximado</small></div>' +
      '<div class="dash-time-tools"><label class="dash-time-search"><span class="dash-sr">Buscar orden o cliente</span><input type="search" autocomplete="off" placeholder="Buscar orden o cliente" value="' + esc(timeQuery) + '"></label>' +
      '<div class="dash-time-export"><label>Filtrar por<select data-f="basis"><option value="created">Fecha de creación</option><option value="delivered">Fecha de entrega</option></select></label><label>Desde<input type="date" data-f="from" value="' + dateFrom + '"></label><label>Hasta<input type="date" data-f="to" value="' + dateTo + '"></label><button type="button" class="dash-time-csv">Descargar CSV</button></div></div>' +
      '<div class="dash-time-body"></div>';
    box.querySelector('[data-f="basis"]').value = dateBasis;
    const body = box.querySelector('.dash-time-body');
    const inRange = o => {
      if (!dateFrom && !dateTo) return true;
      const d = dateBasis === 'delivered' ? (o.deliveredOn || o.due) : o.created;
      if (!d) return false;
      return (!dateFrom || iso(d) >= dateFrom) && (!dateTo || iso(d) <= dateTo);
    };
    const matches = () => { const q = key(timeQuery); return a.orders.filter(o => (!q || key(o.id).includes(q) || key(o.client).includes(q)) && inRange(o)); };
    const paint = () => {
      const q = key(timeQuery);
      if (q) {
        const found = matches().sort((x, y) => (y.created || 0) - (x.created || 0));
        const visible = found.slice(0, timeLimit);
        body.innerHTML = found.length ? '<div class="dash-time-list">' + visible.map(o => {
          const d = duration(o, a.today);
          const tone = o.delivered || o.complete ? 'ok' : o.due && o.due < a.today ? 'late' : 'warn';
          const sub = d.end ? 'Terminó el ' + fmtShort(d.end) : 'Creada el ' + (o.created ? fmtShort(o.created) : '—');
          return '<article class="dash-time-card ' + tone + '" data-lq="' + Math.round(o.percent || 0) + '" data-lq-tone="' + ({ ok: 'verde', warn: 'ambar', late: 'rojo' }[tone] || 'verde') + '"><div class="dash-time-id"><strong>' + esc(o.id) + '</strong><span>' + esc(o.client || 'Sin cliente') + '</span></div>' +
            '<div class="dash-big"><strong>' + (d.days === null ? '—' : d.days) + '</strong><span>días</span></div><em>' + esc(d.state) + '</em><small class="dash-time-sub">' + sub + '</small></article>';
        }).join('') + '</div>' + (found.length > visible.length ? '<button type="button" class="dash-time-more">Ver más (' + (found.length - visible.length) + ')</button>' : '')
          : '<p class="dash-none">No encontramos órdenes con esa búsqueda.</p>';
        return;
      }
      const rows = a.timing.map(t => ({ ...t, tone: t.o.due && t.o.due < a.today ? 'late' : t.ratio >= .8 ? 'warn' : 'ok' }));
      const count = tone => rows.filter(r => r.tone === tone).length;
      if (!timeFilter || !count(timeFilter)) timeFilter = (TONES.find(([tone]) => tone === 'warn' && count(tone)) || TONES.find(([tone]) => count(tone)))[0];
      const shown = rows.filter(r => r.tone === timeFilter);
      const visible = shown.slice(0, timeLimit);
      body.innerHTML = '<div class="dash-time-chips">' + TONES.map(([tone, label]) => '<button type="button" class="' + tone + (tone === timeFilter ? ' on' : '') + '" data-tone="' + tone + '">' + label + ' <b>' + count(tone) + '</b></button>').join('') + '</div>' +
        '<div class="dash-time-list">' + visible.map(t => {
          const note = t.left === null ? '' : t.left < 0 ? 'Atrasada ' + (-t.left) + ' d' : t.left === 0 ? 'Entrega hoy' : 'Quedan ' + t.left + ' d';
          return '<article class="dash-time-card ' + t.tone + '" data-lq="' + Math.min(100, Math.round(t.ratio * 100)) + '" data-lq-tone="' + ({ ok: 'verde', warn: 'ambar', late: 'rojo' }[t.tone] || 'verde') + '"><div class="dash-time-id"><strong>' + esc(t.o.id) + '</strong><span>' + esc(t.o.client || 'Sin cliente') + '</span></div>' +
            '<div class="dash-big"><strong>' + t.elapsed + '</strong><span>' + (t.plazo ? 'de ~' + t.plazo + ' días' : 'días') + '</span></div>' +
            '<div class="dash-time-bar"><i><b style="width:' + Math.min(100, Math.round(t.ratio * 100)) + '%"></b></i></div><em>' + note + '</em></article>';
        }).join('') + '</div>' + (shown.length > visible.length ? '<button type="button" class="dash-time-more">Ver más (' + (shown.length - visible.length) + ')</button>' : '');
    };
    paint();
    box.oninput = event => {
      const f = event.target;
      if (f.matches('.dash-time-search input')) { timeQuery = f.value; timeLimit = 8; paint(); }
      else if (f.dataset.f === 'from') dateFrom = f.value;
      else if (f.dataset.f === 'to') dateTo = f.value;
      else if (f.dataset.f === 'basis') dateBasis = f.value;
      if (f.dataset.f) paint();
    };
    box.onclick = event => {
      const chip = event.target.closest('[data-tone]');
      if (chip) { timeFilter = chip.dataset.tone; timeLimit = 8; paint(); }
      else if (event.target.closest('.dash-time-more')) { timeLimit += 8; paint(); }
      else if (event.target.closest('.dash-time-csv')) {
        const rows = matches().sort((x, y) => (x.created || 0) - (y.created || 0));
        if (!rows.length) { const note = box.querySelector('.dash-time-csv-note') || box.querySelector('.dash-time-export').appendChild(Object.assign(document.createElement('small'), { className: 'dash-time-csv-note' })); note.textContent = 'No hay órdenes en ese filtro para descargar.'; return; }
        box.querySelector('.dash-time-csv-note')?.remove();
        downloadCsv(a, rows);
      }
    };
  }

  function render(a) {
    const time = a.real !== null
      ? card('lime', 'Promedio de producción', fmtNum(a.real, 1), 'días', [
        ['Tiempo real, de la creación a la entrega', ''], ['Pedidos medidos', a.realCount], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null], '', a.promised ? a.real / a.promised * 100 : null)
      : card('lime', 'Promedio de producción', fmtNum(a.estimated, 1), 'días', [
        ['Estimado sumando lo que tarda cada proceso', ''], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null, ['Se vuelve real al registrar entregas', '']], '', a.promised && a.estimated !== null ? a.estimated / a.promised * 100 : null);
    const units = card('blue', 'Unidades por fabricar', fmtNum(a.unitsToMake), 'unidades', [
      ['Pedidos con procesos pendientes', a.ordersToMake], ['Unidades en pedidos activos', fmtNum(a.unitsAll)]], '', a.unitsAll ? a.unitsToMake / a.unitsAll * 100 : 0);
    const week = card(a.lateBefore ? 'red' : 'orange', 'Entregas de la semana', String(a.weekCount), a.weekCount === 1 ? 'pedido' : 'pedidos', [
      ['Del ' + fmtShort(a.weekStart) + ' al ' + fmtShort(a.weekEnd), ''], ['Unidades a entregar', fmtNum(a.weekUnits)],
      a.weekProgress !== null ? ['Avance de estos pedidos', Math.round(a.weekProgress) + '%'] : null, a.lateBefore ? ['Vencidos de semanas anteriores', a.lateBefore] : null],
      a.lateBefore ? a.lateBefore + ' vencidos' : '', a.weekProgress !== null ? a.weekProgress : 0);
    const pct = card('green', 'Porcentaje de avance', a.progress === null ? '—' : String(Math.round(a.progress)), '%', [
      ['Procesos terminados por pedido', ''], ['Pedidos activos', a.activeCount], a.progressUnits !== null ? ['Avance por unidades', Math.round(a.progressUnits) + '%'] : null], '', a.progress === null ? 0 : a.progress);

    const soon = [...a.dueToday.map(o => ({ ...o, when: 'Hoy' })), ...a.dueTomorrow.map(o => ({ ...o, when: 'Mañana' }))];
    const today = todayPanel('orange', 'Entregas hoy y mañana', soon.length,
      orderList(soon, 'No hay entregas programadas para hoy ni mañana.', o => o.when + ' · ' + o.percent + '% avance'));
    const late = todayPanel('red', 'Pedidos atrasados', a.late.length,
      orderList(a.late, 'Ningún pedido atrasado. ¡Bien!', o => (o.focus ? o.focus + ' · ' : '') + 'Venció ' + fmtDue(o.due) + ' · ' + daysBetween(o.due, a.today) + ' d'));
    const rework = todayPanel('rose', 'En reproceso', a.reworkList.length,
      orderList(a.reworkList, 'No hay pedidos en reproceso.', o => (o.focus || 'Reproceso') + ' · entrega ' + fmtDue(o.due)));

    const loadHtml = loadSection(a);

    const timing = a.timing.length ? '<section class="dash-load dash-timing"></section>' : '';

    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de la producción</h3></div><small><i class="dash-live"></i>En vivo · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      tabsBar(a) +
      '<div class="dash-pane' + (activeTab === 'resumen' ? ' on' : '') + '" data-pane="resumen">' + orderFinder(a.orders) + '<div class="dash-cards">' + time + units + week + pct + '</div><div class="dash-today">' + today + late + rework + '</div></div>' +
      '<div class="dash-pane' + (activeTab === 'tiempo' ? ' on' : '') + '" data-pane="tiempo">' + (timing || '<p class="dash-none">No hay órdenes con fecha de creación para medir.</p>') + '</div>' +
      '<div class="dash-pane' + (activeTab === 'carga' ? ' on' : '') + '" data-pane="carga">' + stairs(a, false) + (loadHtml || '<p class="dash-none">No hay pedidos pendientes por área.</p>') + '</div>';
    greet(a);
    bindOrderFinder(a.orders);
    renderTiming(a);
    countUp();
    if (dlg.open && view.label) dlgList();
    if (!stairsPlayed) playStairs(root.querySelector('.dash-pane.on'));
  }

  const style = document.createElement('style');
  style.textContent = `
  #home-dashboard{display:grid;gap:16px}
  .dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.dash-head h3{margin:4px 0 0;font-size:1.4rem}.dash-head small{color:var(--muted);display:flex;align-items:center;gap:6px}
  .dash-order-finder{display:grid;grid-template-columns:1fr;gap:14px;padding:22px 20px;border:1px solid rgba(208,244,76,.3);border-radius:16px;background:linear-gradient(120deg,rgba(208,244,76,.08),rgba(18,23,18,.98) 48%)}.dash-order-finder p{margin:0;color:#aebaa9;font-size:.85rem;line-height:1.45}.dash-order-finder label{position:relative;align-self:center;justify-self:center;width:min(760px,100%)}.dash-order-finder input{width:100%;box-sizing:border-box;min-height:52px;padding:13px 46px 13px 17px;border:1px solid #60754d;border-radius:14px;background:linear-gradient(105deg,#1b291f,#142017);color:#f5faef;font:600 15px Arial;outline:none;box-shadow:0 9px 20px #0003}.dash-order-finder input:focus{border-color:#d0f44c;box-shadow:0 0 0 3px rgba(208,244,76,.13),0 10px 24px #0004}.dash-search-icon{position:absolute;right:16px;top:14px;color:#d0f44c;font:24px/1 Arial}.dash-order-results{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.dash-order-results>p{grid-column:1/-1;max-width:760px;margin:auto;padding:4px 0}.dash-order-result{display:grid;align-content:start;gap:11px;width:100%;min-height:300px;box-sizing:border-box;padding:16px;border:1px solid #2c372f;border-top:3px solid #6a7d63;border-radius:16px;background:linear-gradient(145deg,#192219,#101610);color:#eef4e9;text-align:left;box-shadow:0 6px 18px #0002;cursor:pointer;transition:transform .15s,border-color .15s,background .15s}.dash-order-result:hover{transform:translateY(-2px);border-color:#d0f44c;background:#202b1b}.dash-order-result>span{display:grid;gap:5px;min-width:0}.dash-order-result-head{display:flex!important;align-items:center;justify-content:space-between;gap:8px}.dash-order-result strong{font-size:1rem}.dash-order-result-head em{font-style:normal;font:800 10px/1 Arial;padding:5px 7px;border-radius:999px;background:#4a3821;color:#ffd08a;white-space:nowrap}.dash-order-result-head em.rework{background:#4b2523;color:#ffb6af}.dash-order-result-head em.finished{background:#1f4b31;color:#a9efbd}.dash-order-client{font-size:.77rem;color:#c7d4c3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dash-order-reference{padding:8px 10px;border-left:3px solid #8fc84b;border-radius:7px;background:#172018}.dash-order-reference b{font-size:.62rem;color:#aebba8;text-transform:uppercase;letter-spacing:.06em}.dash-order-reference small{font-size:.78rem;color:#d9f990;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dash-order-process{padding:10px;border-radius:10px;background:#0e1510}.dash-order-process b{font-size:.65rem;color:#aebba8;text-transform:uppercase;letter-spacing:.06em}.dash-order-process small{font-size:.8rem;color:#f1f7ed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dash-order-progress{margin-top:auto}.dash-order-progress i{display:block;overflow:hidden;height:6px;border-radius:999px;background:#314033}.dash-order-progress i b{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#80cf93,#d0f44c)}.dash-order-progress small{font-size:.7rem;color:#b3c0ad}.dash-order-open{font:800 11px Arial;color:#d0f44c;text-transform:uppercase;letter-spacing:.04em}.dash-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .dash-live{width:8px;height:8px;border-radius:50%;background:#8bd450;box-shadow:0 0 0 0 rgba(139,212,80,.6);animation:dashPulse 2s infinite}@keyframes dashPulse{70%{box-shadow:0 0 0 7px rgba(139,212,80,0)}100%{box-shadow:0 0 0 0 rgba(139,212,80,0)}}
  .dash-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
  .dash-card{display:grid;align-content:start;gap:14px;padding:22px;border:1px solid rgba(255,255,255,.13);border-top:5px solid var(--c,#8bd450);border-radius:18px;background:#121712;transition:transform .15s,border-color .15s}
  .dash-card:hover{transform:translateY(-3px);border-color:var(--c,#8bd450)}
  .dash-card.lime{--c:#d0f44c}.dash-card.blue{--c:#6cb6ff}.dash-card.orange{--c:#ffb347}.dash-card.green{--c:#8bd450}
  .dash-card h4{margin:0;font-size:1rem;color:#d5dccf;text-transform:uppercase;letter-spacing:.06em}
  .dash-big{display:flex;align-items:baseline;gap:10px}.dash-big strong{font-size:3.6rem;line-height:1;color:var(--c)}.dash-big span{color:#c4cfbf;font-size:1rem}
  .dash-card ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}.dash-card li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.05);font-size:.88rem;color:#c4cfbf}.dash-card li b{color:#fff;font-size:1rem}
  .dash-card li.note{background:none;padding:0 2px;font-size:.84rem;color:#aab5a5}
  .dash-empty{color:var(--muted);font-size:.9rem;padding:10px 0}
  .dash-card.red{--c:#ff6b6b}
  .dash-card h4{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .dash-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:6px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0e130e}
  .dash-tabs button{width:auto!important;min-height:0!important;display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border:1px solid transparent;border-radius:10px;background:transparent;color:#b9c6b3;font:800 .8rem Arial;letter-spacing:.03em;cursor:pointer;transition:background .15s,color .15s}
  .dash-tabs button:hover{background:rgba(255,255,255,.06);color:#fff}
  .dash-tabs button.on{background:#d0f44c;color:#16200a;border-color:#d0f44c}
  .dash-tabs button b{min-width:20px;padding:1px 7px;border-radius:99px;background:rgba(255,255,255,.12);font-size:.7rem;text-align:center}.dash-tabs button.on b{background:rgba(22,32,10,.18)}
  .dash-pane{display:none;gap:16px}.dash-pane.on{display:grid;animation:dashRise .3s both}
  @media(max-width:700px){.dash-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.dash-tabs button{flex:none;padding:8px 12px;font-size:.74rem}}
  /* ventana de pantalla completa de un área */
  .dash-areadlg{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:radial-gradient(1200px 500px at 10% -10%,rgba(139,212,80,.10),transparent 60%),#080b08;color:#eef3e8;font-family:Arial,Helvetica,sans-serif}
  .dash-areadlg[open]{display:flex;flex-direction:column;animation:odIn .28s cubic-bezier(.2,.8,.2,1) both}
  .dash-areadlg::backdrop{background:rgba(0,0,0,.75)}
  @keyframes odIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
  .od-head{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:18px clamp(14px,3vw,36px) 12px}
  .od-title{display:grid;gap:2px;min-width:0;flex:1 1 260px}.od-title h3{margin:0;font-size:clamp(1.5rem,3vw,2.2rem);letter-spacing:.03em;text-transform:uppercase}.od-title small{color:#9fab99;font-size:.8rem}
  .od-kpis{display:flex;gap:10px;flex-wrap:wrap}.od-kpi{display:grid;justify-items:center;gap:1px;min-width:92px;padding:9px 14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.04)}
  .od-kpi b{font-size:1.45rem;line-height:1.1;color:#fff}.od-kpi span{font-size:.66rem;color:#9fab99;text-transform:uppercase;letter-spacing:.07em}.od-kpi.bad b{color:#ff8a7c}
  .od-close{width:44px!important;height:44px;min-height:0!important;flex:none;display:grid;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:rgba(255,255,255,.06);color:#fff;font:700 1.1rem Arial;cursor:pointer;transition:background .15s,transform .15s}.od-close:hover{background:#ff6b5c;color:#2a0e0a;transform:rotate(90deg)}
  .od-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px clamp(14px,3vw,36px) 10px}
  .od-chips{display:flex;gap:7px;flex-wrap:wrap;flex:1 1 420px}
  .od-chip{width:auto!important;min-height:0!important;display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:transparent;color:#c4cfbf;font:800 .76rem Arial;cursor:pointer;transition:background .15s,color .15s,transform .15s}
  .od-chip:hover{transform:translateY(-1px);background:rgba(255,255,255,.07)}.od-chip b{padding:1px 7px;border-radius:99px;background:rgba(255,255,255,.12);font-size:.68rem}
  .od-chip.on{background:#d0f44c;border-color:#d0f44c;color:#16200a}.od-chip.on b{background:rgba(22,32,10,.2)}
  .od-chip.c-rep:not(.on){border-color:rgba(255,107,92,.5);color:#ffb3a9}.od-chip.c-late:not(.on){border-color:rgba(255,107,92,.5);color:#ffb3a9}.od-chip.c-proc:not(.on){border-color:rgba(139,212,80,.5)}.od-chip.c-cola:not(.on){border-color:rgba(255,201,92,.5)}.od-chip.c-prog:not(.on){border-color:rgba(143,184,255,.5)}
  .od-search input,.od-sort select{min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#101610;color:#eef3e8;font:700 .82rem Arial}.od-search input{width:min(280px,60vw)}
  .od-sort{display:flex;align-items:center;gap:8px;color:#9fab99;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
  .od-legend{display:flex;gap:16px;flex-wrap:wrap;padding:0 clamp(14px,3vw,36px) 10px;color:#9fab99;font-size:.7rem}.od-legend span{display:inline-flex;align-items:center;gap:6px}.od-legend i{width:18px;height:7px;border-radius:99px;display:inline-block}
  .g-ok{background:#8bd450}.g-warn{background:#ffc95c}.g-late{background:#ff6b5c}.g-adv{background:#fff;height:3px!important}.g-now{background:#d0f44c;width:3px!important;height:12px!important}
  .od-list{list-style:none;margin:0;padding:6px clamp(14px,3vw,36px) 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,520px),1fr));gap:12px;overflow:auto;flex:1;align-content:start;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
  .od{--c:#8bd450;display:grid;gap:8px;padding:13px 15px 12px;border:1px solid rgba(255,255,255,.1);border-left:4px solid var(--k,#8bd450);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));opacity:0;transform:translateY(12px);transition:opacity .4s ease,transform .4s ease,border-color .2s,box-shadow .2s;transition-delay:calc(var(--i,0)*28ms,0ms)}
  .od-list.go .od{opacity:1;transform:none}.od:hover{border-color:var(--c);box-shadow:0 10px 26px -14px var(--c);transition-delay:0ms}
  .od.k-proc{--k:#8bd450}.od.k-cola{--k:#ffc95c}.od.k-prog{--k:#8fb8ff}.od.k-rep{--k:#ff6b5c}
  .od.tone-ok{--c:#8bd450}.od.tone-warn{--c:#ffc95c}.od.tone-late{--c:#ff6b5c}.od.tone-none{--c:#6c7a68}
  .od-top{display:flex;align-items:center;gap:10px;justify-content:space-between}.od-id{display:grid;min-width:0;flex:1}.od-id strong{font-size:1.02rem;color:#fff}.od-id span{font-size:.74rem;color:#9fab99;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .od-tags{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.od-kind{font-style:normal;font-size:.62rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:99px;color:#10200a;background:#8bd450}
  .od-kind.k-cola{background:#ffc95c;color:#2a1d02}.od-kind.k-prog{background:#8fb8ff;color:#0c1a33}.od-kind.k-rep{background:#ff6b5c;color:#2a0e0a}.od-units{font-size:.9rem;color:#fff;white-space:nowrap}
  .od-bar{position:relative;margin-top:12px;height:16px;border-radius:99px;background:rgba(255,255,255,.08);overflow:visible}.od-bar.none{height:8px;opacity:.5}
  .od-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 70%,#000),var(--c));box-shadow:0 0 14px -2px var(--c);transition:width 1s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--i,0)*28ms + 120ms)}
  .od-list.go .od-fill{width:var(--w)}
  .tone-late .od-fill{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.22) 0 8px,transparent 8px 16px),linear-gradient(90deg,#b8372a,#ff6b5c);background-size:32px 32px,100% 100%;animation:odStripes 1.1s linear infinite}
  @keyframes odStripes{to{background-position:32px 0,0 0}}
  .od-adv{position:absolute;left:0;bottom:-6px;height:3px;width:0;border-radius:99px;background:#fff;opacity:.9;transition:width 1.1s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--i,0)*28ms + 260ms)}.od-list.go .od-adv{width:var(--a)}
  .od-today{position:absolute;top:-5px;bottom:-5px;width:3px;margin-left:-1px;border-radius:2px;background:#d0f44c;box-shadow:0 0 0 0 rgba(208,244,76,.7);animation:odNow 1.8s infinite;opacity:0;transition:opacity .4s .9s}.od-list.go .od-today{opacity:1}
  .od-today u{position:absolute;top:-14px;right:-2px;font-size:.56rem;font-weight:800;letter-spacing:.06em;text-decoration:none;text-transform:uppercase;color:#d0f44c}
  @keyframes odNow{70%{box-shadow:0 0 0 7px rgba(208,244,76,0)}100%{box-shadow:0 0 0 0 rgba(208,244,76,0)}}
  .od-dates{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:.7rem;color:#9fab99}.od-dates .od-mid{color:#c4cfbf}.od-dates .od-end{font-weight:800;color:var(--c)}
  .od-steps{display:flex;gap:3px}.od-steps .st{flex:1;display:grid;place-items:center;height:20px;border-radius:5px;background:rgba(255,255,255,.07);cursor:help;transition:transform .15s}.od-steps .st:hover{transform:translateY(-2px)}
  .od-steps .st b{font-size:.54rem;letter-spacing:.03em;color:rgba(255,255,255,.45)}.od-steps .st.finished{background:rgba(139,212,80,.35)}.od-steps .st.finished b{color:#d9f6bd}
  .od-steps .st.active{background:#8bd450;animation:odStep 1.6s infinite}.od-steps .st.active b{color:#10200a}.od-steps .st.rework{background:#ff6b5c}.od-steps .st.rework b{color:#2a0e0a}
  .od-steps .st.here{outline:2px solid #fff;outline-offset:1px}
  @keyframes odStep{50%{filter:brightness(1.35)}}
  .od-empty{grid-column:1/-1;padding:40px 10px;text-align:center;color:#9fab99;font-size:.95rem}
  @media(max-width:700px){.od-legend{display:none}.od-title small{display:none}.od-head{gap:8px;padding-bottom:6px}.od-title h3{font-size:1.35rem}.od-close{width:38px!important;height:38px}.od-kpi span{font-size:.56rem;letter-spacing:.03em}.od-tools{gap:8px;padding-bottom:6px}.od-chips{flex-wrap:nowrap;overflow-x:auto;flex:1 1 100%;scrollbar-width:none}.od-chip{flex:none;padding:6px 11px;font-size:.7rem}.od-search input,.od-sort select{min-height:34px}.od-head{padding-top:14px}.od-kpis{order:3;width:100%;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.od-kpi{min-width:0;padding:7px 4px}.od-kpi b{font-size:1.1rem}.od-search input{width:100%}.od-search{flex:1 1 100%}.od-sort{flex:1 1 100%}.od-sort select{flex:1}.od-list{grid-template-columns:1fr;padding-bottom:30px}.od-steps .st b{display:none}.od-legend{gap:10px}}
  @media(prefers-reduced-motion:reduce){.od,.od-fill,.od-adv,.od-today,.od-steps .st,.dash-areadlg[open]{transition:none!important;animation:none!important}.od{opacity:1;transform:none}.od-list .od-fill{width:var(--w)}.od-list .od-adv{width:var(--a)}.od-today{opacity:1}}
  /* Escalera de la planta con el diseño de «Vencimiento de la cartera»: panel + tarjetas de líquido en escalones */
  .dash-stairs{--base:132px;--span:190px;display:grid;gap:16px;padding:22px 24px 18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(130deg,rgba(35,48,25,.72),rgba(9,12,9,.95) 52%,rgba(16,28,16,.84))}
  .dash-stairs.compact{--base:112px;--span:96px}
  .dash-stairs>.st-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}
  .dash-stairs h3{margin:0 0 6px;font-size:1.15rem;color:#fff}.dash-stairs p{margin:0;max-width:640px;color:#98a692;font-size:.76rem;line-height:1.4}
  .st-metric{display:inline-flex;padding:3px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:#0a0e0a;flex:none}
  .st-metric button{width:auto!important;min-height:0!important;padding:6px 14px;border:0;border-radius:999px;background:transparent;color:#aebba7;font:800 .74rem Arial;cursor:pointer;transition:background .15s,color .15s}.st-metric button.on{background:#d0f44c;color:#16200a}
  .st-sum{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .st-pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.04);color:#c4cfbf;font:700 .72rem Arial}.st-pill i{width:9px;height:9px;border-radius:3px;background:var(--p)}.st-pill b{color:#fff;font-size:.8rem}
  .st-pill.proc{--p:#8bd450}.st-pill.rep{--p:#ff6b5c}.st-pill.cola{--p:#ffc95c}.st-pill.prog{--p:#8fb8ff}.st-pill.late{--p:#ff6b5c}.st-pill.late.hot{border-color:rgba(255,107,92,.6);background:rgba(255,107,92,.1)}
  .st-neck{margin-left:auto;color:#ffb3a9;font-size:.78rem}.st-neck b{color:#fff}
  .st-scroll{overflow-x:auto;padding:2px 2px 8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
  .st-chart{display:flex;align-items:flex-end;gap:12px;height:calc(var(--base) + var(--span) + 6px);min-width:max(100%,1200px)}
  .st-col{--rise:0px;--lv:0%;position:relative;flex:1 1 0;min-width:94px;height:var(--base);display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:0;padding:14px 12px;text-align:left;font:inherit;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.16);border-radius:17px;background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(0,0,0,.18));overflow:hidden;cursor:pointer;transition:height 1s cubic-bezier(.2,.8,.2,1),transform .22s ease,border-color .22s ease,box-shadow .22s ease;transition-delay:calc(var(--i,0)*55ms),0s,0s,0s}
  .dash-stairs.go .st-col{height:calc(var(--base) + var(--rise))}
  .st-col:hover,.st-col:focus-visible{transform:translateY(-4px);border-color:#d0f44c;box-shadow:0 16px 30px rgba(208,244,76,.16);outline:none;transition-delay:0s}
  .st-col.top{border-color:#ff6b5c}
  .st-col .ar-ribbon{right:8px;font-size:.5rem;white-space:nowrap;padding:2px 7px}.st-col.top .st-name{margin-top:14px}
  .st-name{position:relative;z-index:3;display:block;font-size:.62rem;font-weight:900;letter-spacing:.07em;text-transform:uppercase;line-height:1.2;word-break:keep-all}
  .st-val{position:relative;z-index:3;display:block;margin-top:14px;font-size:1.6rem;line-height:1;font-weight:900;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .st-sub{position:relative;z-index:3;display:block;max-width:calc(100% - 34px);margin-top:5px;font-size:.6rem;opacity:.92;line-height:1.3}.st-late{font-style:normal;font-weight:800;color:#ffd7cf}
  .st-pct{position:absolute;z-index:3;right:-16px;bottom:-16px;width:70px;height:70px;box-sizing:border-box;padding:14px 0 0 16px;border:1px solid rgba(255,255,255,.24);border-radius:50%;font:900 .66rem Arial;font-style:normal;text-shadow:none}
  .st-col.empty .st-val{opacity:.55}.st-col.empty .st-bar{display:none}
  .st-slot{position:absolute;z-index:1;inset:0;display:flex;align-items:flex-end;pointer-events:none}
  .st-bar{width:100%;height:0;display:flex;flex-direction:column-reverse;gap:0;position:relative;transition:height 1.1s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--i,0)*55ms + 150ms)}
  .dash-stairs.go .st-bar{height:var(--lv)}
  .st-bar::before{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 22% 92%,rgba(255,255,255,.35) 2px,transparent 3px),radial-gradient(circle at 68% 96%,rgba(255,255,255,.28) 3px,transparent 4px),radial-gradient(circle at 44% 99%,rgba(255,255,255,.3) 2px,transparent 3px),linear-gradient(90deg,rgba(255,255,255,.14),transparent 40%,rgba(0,0,0,.12));background-size:100% 160px,100% 190px,100% 140px,100% 100%;background-repeat:repeat-y,repeat-y,repeat-y,no-repeat;animation:stBubbles 6s linear infinite}
  @keyframes stBubbles{from{background-position:0 0,0 0,0 0,0 0}to{background-position:0 -160px,0 -190px,0 -140px,0 0}}
  .st-bar .sg{position:relative;display:block;min-height:6px;background:linear-gradient(180deg,var(--c1),var(--c2));opacity:.96}
  .st-bar .sg.proc{--c1:#9be058;--c2:#3f8f22}.st-bar .sg.rep{--c1:#ff8f80;--c2:#c93a2b}.st-bar .sg.cola{--c1:#ffd27a;--c2:#d28f14}.st-bar .sg.prog{--c1:#a9c8ff;--c2:#4f80cf}
  .st-bar .sg:last-child::before,.st-bar .sg:not(:first-child)::after{content:"";position:absolute;left:0;right:0;height:12px;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 12' preserveAspectRatio='none'%3E%3Cpath d='M0 6 C8 0 16 0 24 6 S40 12 48 6 V12 H0Z' fill='%23000'/%3E%3C/svg%3E") repeat-x 0 0/48px 12px;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 12' preserveAspectRatio='none'%3E%3Cpath d='M0 6 C8 0 16 0 24 6 S40 12 48 6 V12 H0Z' fill='%23000'/%3E%3C/svg%3E") repeat-x 0 0/48px 12px;animation:stFlow 3.4s linear infinite;pointer-events:none}
  .st-bar .sg:last-child::before{top:-6px;background:var(--c1);z-index:3;filter:drop-shadow(0 -1px 0 rgba(255,255,255,.55))}
  .st-bar .sg:not(:first-child)::after{bottom:-6px;background:var(--c2);transform:scaleY(-1);animation-direction:reverse;animation-duration:4.4s;z-index:1}
  @keyframes stFlow{from{-webkit-mask-position:0 0;mask-position:0 0}to{-webkit-mask-position:48px 0;mask-position:48px 0}}
  .st-flow{display:flex;align-items:center;gap:10px;color:#6c7a68;font-size:.62rem;text-transform:uppercase;letter-spacing:.1em}.st-flow i{flex:1;height:2px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25));position:relative}.st-flow i::after{content:"";position:absolute;right:0;top:-4px;border:5px solid transparent;border-left:8px solid rgba(255,255,255,.35)}
  @media(max-width:700px){.dash-stairs{padding:16px 14px 14px}.dash-stairs.compact{--base:100px;--span:80px}.dash-stairs{--base:116px;--span:150px}.st-chart{gap:8px;min-width:900px}.st-val{font-size:1.6rem}.st-neck{margin-left:0;flex:1 1 100%}}
  @media(prefers-reduced-motion:reduce){.st-col,.st-bar,.st-bar::before,.st-bar .sg::before,.st-bar .sg::after{transition:none!important;animation:none!important}.st-col{height:calc(var(--base) + var(--rise))}.st-bar{height:var(--lv)}}
  /* Carga por área con el mismo diseño de «Vencimiento de la cartera» */
  .ar-panel{display:grid;gap:22px;padding:22px 24px 26px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(130deg,rgba(35,48,25,.72),rgba(9,12,9,.95) 52%,rgba(16,28,16,.84))}
  .ar-panel>header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
  .ar-kicker{display:block;margin-bottom:5px;color:#d0f44c;font-size:.61rem;letter-spacing:.13em;font-weight:900}
  .ar-panel h3{margin:0 0 6px;font-size:1.15rem;color:#fff}.ar-panel p{margin:0;max-width:560px;color:#98a692;font-size:.76rem;line-height:1.4}
  .ar-total{display:grid;gap:2px;min-width:120px;padding:10px 13px;border:1px solid rgba(208,244,76,.28);border-radius:12px;background:rgba(208,244,76,.07);color:#d0f44c;font-size:1.35rem;text-align:right;flex:none}
  .ar-total small{font-size:.58rem;letter-spacing:.07em;text-transform:uppercase;color:#aebba7}
  .ar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:12px}
  .ar-card{--liquid:#3153e2;display:flex!important;flex-direction:column;justify-content:flex-start;align-items:stretch;width:auto!important;min-height:152px;padding:16px;text-align:left;font:inherit;cursor:pointer;animation:dashRise .5s both;animation-delay:calc(var(--i,0)*45ms)}
  .ar-card b{display:block;font-size:.7rem;letter-spacing:.07em;text-transform:uppercase}
  .ar-card span{display:block;margin-top:26px;font-size:2.1rem;line-height:1;font-weight:900;font-variant-numeric:tabular-nums}
  .ar-card small{display:block;margin-top:6px;font-size:.66rem;opacity:.95}.ar-card small.ar-brk{margin-top:3px;opacity:.78;max-width:calc(100% - 52px);line-height:1.35}
  .ar-card .ar-late{font-style:normal;font-weight:800;color:#ffe1da!important}
  .ar-ribbon{position:absolute;top:-1px;right:12px;font-style:normal;font-size:.56rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:0 0 8px 8px;background:#ff6b5c;color:#2a0e0a!important;text-shadow:none;z-index:3}
  .ar-card.top{border-color:#ff6b5c!important}
  .ar-card>.lq-pct{right:-16px;bottom:-16px;width:76px;height:76px;padding:16px 0 0 18px;box-sizing:border-box;border:1px solid rgba(255,255,255,.24);border-radius:50%;font:900 .7rem Arial}
  @media(max-width:700px){.ar-panel{padding:16px 14px 20px}.ar-panel>header{flex-direction:column}.ar-total{text-align:left}.ar-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ar-card{min-height:138px;padding:13px}.ar-card span{font-size:1.8rem;margin-top:20px}.ar-card small.ar-brk{max-width:100%}}
  @media(prefers-reduced-motion:reduce){.ar-card{animation:none!important}}
  /* tarjetas compactas */
  .dash-cards{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
  .dash-card{gap:7px;padding:13px 15px 15px;border-radius:14px}
  .dash-card h4{font-size:.72rem;letter-spacing:.07em}
  .dash-card .dash-big{gap:6px}.dash-card .dash-big strong{font-size:2.2rem}.dash-card .dash-big span{font-size:.8rem}
  .dash-card ul{gap:4px}.dash-card li{padding:4px 9px;border-radius:7px;font-size:.74rem}.dash-card li b{font-size:.82rem}.dash-card li.note{font-size:.72rem;padding:0 1px}
  .dash-badge{font-size:.6rem;padding:2px 7px}
  .dash-badge{font-style:normal;font-size:.68rem;letter-spacing:.02em;text-transform:none;padding:3px 9px;border-radius:999px;background:rgba(255,107,107,.16);color:#ff9b9b;border:1px solid rgba(255,107,107,.4)}
  .dash-today{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .dash-panel{display:grid;align-content:start;gap:12px;padding:18px;border:1px solid rgba(255,255,255,.12);border-left:4px solid var(--c);border-radius:16px;background:#111611}
  .dash-panel.orange{--c:#ffb347}.dash-panel.red{--c:#ff6b6b}.dash-panel.rose{--c:#ff8d86}
  .dash-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .dash-panel h4{margin:0;font-size:.9rem;color:#e3eadc;text-transform:uppercase;letter-spacing:.05em}
  .dash-count{min-width:30px;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c);font-weight:900;text-align:center}
  .dash-orders{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .dash-orders li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.04)}
  .dash-orders li>div:first-child{display:grid;min-width:0}.dash-orders strong{font-size:.9rem;color:#f2f7ea}
  .dash-orders span{font-size:.76rem;color:#a9b5a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dash-order-meta{display:grid;justify-items:end;flex-shrink:0}.dash-order-meta b{font-size:.86rem;color:#fff}.dash-order-meta small{font-size:.7rem;color:var(--c)}
  .dash-none{margin:0;padding:10px 2px;font-size:.84rem;color:#8f9b8a}.dash-more{margin:0;font-size:.76rem;color:#a9b5a3;text-align:right}
  .dash-load{display:grid;gap:10px;padding:18px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#111611}
  .dash-load .dash-panel-head{align-items:baseline;flex-wrap:wrap}.dash-load h4{margin:0;font-size:.9rem;color:#e3eadc;text-transform:uppercase;letter-spacing:.05em}.dash-load .dash-panel-head small{color:#8f9b8a;font-size:.76rem}
  .dash-load-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;align-items:start}
  .dash-load-card{--t:#7ecf8a;position:relative;display:grid;align-content:start;gap:10px;padding:16px 16px 12px;border:1px solid rgba(255,255,255,.13);border-top:5px solid var(--t);border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.035),#121712 60%);overflow:hidden;transition:transform .18s,border-color .18s,box-shadow .18s;animation:dashRise .5s both;animation-delay:calc(var(--i,0)*55ms)}
  .dash-load-card::after{content:"";position:absolute;left:0;bottom:0;height:3px;width:var(--m,0%);background:var(--t);opacity:.85;border-radius:0 3px 0 0;transform-origin:left;animation:dashGrow .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0)*55ms + 150ms)}
  .dash-load-card:hover{transform:translateY(-3px);border-color:var(--t);box-shadow:0 10px 26px -12px var(--t)}
  .dash-load-card.cool{--t:#7ecf8a}.dash-load-card.warm{--t:#ffc95c}.dash-load-card.hot{--t:#ff6b5c;background:linear-gradient(180deg,rgba(255,107,92,.1),#161110 70%)}
  .dash-load-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .dash-load-label{font-size:.82rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#e3eadc}
  .dash-work{flex:none;width:9px;height:9px;border-radius:50%;background:var(--t);animation:dashWork 1.8s infinite}
  @keyframes dashWork{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}70%{box-shadow:0 0 0 8px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
  @keyframes dashRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes dashGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .dash-load-card .dash-big{gap:8px;align-items:baseline;flex-wrap:wrap}.dash-load-card .dash-big strong{font-size:2.2rem;line-height:1;color:var(--t)}.dash-load-card .dash-big span{font-size:.8rem;color:#a9b5a3}.dash-load-card .dash-big small{margin-left:auto;color:#8f9b8a;font-size:.76rem}
  .dash-seg{display:flex;gap:3px;height:8px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.07)}
  .dash-seg i{flex:0 0 var(--w);min-width:6px;border-radius:99px;transform-origin:left;animation:dashGrow .8s cubic-bezier(.2,.8,.2,1) both;animation-delay:.2s}
  .dash-seg .p,.dash-load-legend .p b{background:#8bd450;color:#10200a}.dash-seg .c,.dash-load-legend .c b{background:#ffc95c;color:#2a1d02}.dash-seg .r,.dash-load-legend .r b{background:#ff6b5c;color:#2a0e0a}.dash-seg .g,.dash-load-legend .g b{background:#8fb8ff;color:#0c1a33}
  .dash-load-legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.74rem;color:#b6c2b0}.dash-load-legend li{display:flex;align-items:center;gap:6px}.dash-load-legend b{min-width:20px;padding:1px 6px;border-radius:99px;text-align:center;font-size:.72rem}
  .dash-load-card .late,.dash-area-orders .late{color:#ff8a7c;font-weight:700}
  .dash-bottleneck{position:absolute;top:-1px;right:12px;font-style:normal;font-size:.6rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:3px 8px;border-radius:0 0 8px 8px;background:#ff6b5c;color:#2a0e0a}
  .dash-area-fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s cubic-bezier(.2,.8,.2,1)}.dash-area-fold>div{min-height:0;overflow:hidden}.dash-load-card.open .dash-area-fold{grid-template-rows:1fr}
  .dash-area-toggle{width:auto!important;min-height:0!important;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px -16px -12px;padding:9px 16px;border:0;border-top:1px solid rgba(255,255,255,.09);border-radius:0;background:rgba(255,255,255,.03);color:#b9c6b3;font:700 .74rem Arial;letter-spacing:.03em;cursor:pointer;transition:background .15s,color .15s}
  .dash-area-toggle:hover{background:rgba(255,255,255,.07);color:#fff}.dash-area-toggle svg{flex:none;color:var(--t);transition:transform .3s}
  .dash-area-orders{list-style:none;margin:8px 0 6px;padding:0 4px 0 0;display:grid;gap:6px;max-height:330px;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}
  .dash-area-orders li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-left:3px solid #8bd450;border-radius:10px;background:rgba(255,255,255,.03)}
  .dash-area-orders li.cola{border-left-color:#ffc95c}.dash-area-orders li.prog{border-left-color:#8fb8ff}.dash-area-orders li.rep{border-left-color:#ff6b5c;background:rgba(255,107,92,.07)}
  .dash-ao-main{display:grid;min-width:0}.dash-ao-main strong{font-size:.84rem;color:#fff}.dash-ao-main span{font-size:.72rem;color:#9fab99;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dash-ao-meta{display:grid;justify-items:end;flex:none}.dash-ao-meta b{font-size:.8rem;color:#fff}.dash-ao-meta small{font-size:.68rem;color:#a9b5a3}
  @media(max-width:560px){.dash-load-grid{grid-template-columns:minmax(0,1fr);gap:12px}.dash-area-orders{max-height:300px}}
  @media(prefers-reduced-motion:reduce){.dash-load-card,.dash-load-card::after,.dash-seg i,.dash-work{animation:none!important}.dash-area-fold,.dash-area-toggle svg{transition:none!important}}
  .dash-time-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start}.dash-time-chips button{width:auto!important;flex:0 0 auto;min-height:0!important}
  .dash-time-chips button{--t:#7ecf8a;padding:7px 14px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:transparent;color:#c4cfbf;font:700 .78rem Arial;cursor:pointer}
  .dash-time-chips .late{--t:#ff6b5c}.dash-time-chips .warn{--t:#ffc95c}
  .dash-time-chips button b{margin-left:4px;color:var(--t)}.dash-time-chips button.on{border-color:var(--t);background:color-mix(in srgb,var(--t) 16%,transparent);color:#fff}
  .dash-time-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .dash-time-card{--t:#7ecf8a;display:grid;gap:8px;padding:14px;border:1px solid rgba(255,255,255,.13);border-top:4px solid var(--t);border-radius:14px;background:#121712}
  .dash-time-card.warn{--t:#ffc95c}.dash-time-card.late{--t:#ff6b5c}
  .dash-time-id{display:grid;min-width:0}.dash-time-id strong{font-size:.95rem;color:#f2f7ea}.dash-time-id span{font-size:.74rem;color:#a9b5a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dash-time-card .dash-big{gap:6px}.dash-time-card .dash-big strong{font-size:2.3rem;color:var(--t)}.dash-time-card .dash-big span{font-size:.78rem;color:#a9b5a3}
  .dash-time-bar i{display:block;height:6px;border-radius:999px;background:#314033;overflow:hidden}.dash-time-bar b{display:block;height:100%;background:var(--t);border-radius:inherit}
  .dash-time-card em{font-style:normal;font-weight:800;font-size:.74rem;color:var(--t)}
  .dash-time-tools{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
  .dash-time-search{flex:0 1 300px}.dash-time-search input{width:100%;box-sizing:border-box;min-height:38px;padding:7px 12px;border:1px solid #60754d;border-radius:12px;background:#142017;color:#f5faef;font:600 13px Arial;outline:none}.dash-time-search input:focus{border-color:#d0f44c}
  .dash-time-export{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}.dash-time-export label{display:grid;gap:3px;font-size:.68rem;color:#a9b5a3;text-transform:uppercase;letter-spacing:.04em}
  .dash-time-export input,.dash-time-export select{min-height:38px;padding:6px 9px;border:1px solid #3d4c3b;border-radius:9px;background:#142017;color:#f5faef;font:600 13px Arial;color-scheme:dark}
  .dash-time-csv{width:auto!important;min-height:38px;padding:0 16px;border:0;border-radius:9px;background:#d0f44c;color:#142017;font:800 .78rem Arial;cursor:pointer}
  .dash-time-csv-note{flex-basis:100%;color:#ffb347;font-size:.76rem}
  @media(max-width:700px){.dash-time-search{flex-basis:100%}.dash-time-export{display:grid;grid-template-columns:1fr 1fr;width:100%}.dash-time-export label:first-child,.dash-time-csv{grid-column:1/-1}.dash-time-export input,.dash-time-export select{width:100%;box-sizing:border-box}}
  .dash-time-body{display:grid;gap:12px}.dash-time-sub{font-size:.72rem;color:#b3c0ad}
  .dash-time-more{justify-self:center;width:auto!important;padding:9px 22px;border:1px solid rgba(208,244,76,.45);border-radius:999px;background:transparent;color:#d0f44c;font:800 .78rem Arial;cursor:pointer}
  @media(max-width:1050px) and (min-width:701px){.dash-order-results{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.dash-order-finder{grid-template-columns:1fr;padding:15px}.dash-order-results{grid-column:auto;grid-template-columns:1fr}.dash-order-result{min-height:260px}}
  `;
  document.head.appendChild(style);

  let busy = false, lastText = '', model = null;
  async function refresh(force) {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/produccion', { cache: 'no-store' });
      const text = await response.text();
      if (!response.ok) { let detail = ''; try { detail = JSON.parse(text).detail; } catch (e) { /* respuesta no JSON */ } throw new Error(detail || 'No se pudo cargar'); }
      if (!force && text === lastText && model) return;   // sin cambios: no se redibuja
      lastText = text;
      model = analyse(JSON.parse(text));
      render(model);
    } catch (error) {
      if (!model) root.innerHTML = '<div class="dash-empty">No fue posible cargar el resumen: ' + esc(error.message) + '</div>';
    } finally { busy = false; }
  }

  root.innerHTML = '<div class="dash-empty">Cargando resumen…</div>';
  refresh(true);
  document.querySelectorAll('.tab[data-kind="inicio"]').forEach(tab => tab.addEventListener('click', () => refresh(false)));
  setInterval(() => { if (!document.hidden && document.querySelector('.panel.active')?.dataset.panel === 'inicio') refresh(false); }, 30000);
})();
