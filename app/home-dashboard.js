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
      o.rework = internal.some(p => states[p.label] === 'rework');
      // Area donde esta el pedido ahora: reproceso > en proceso > primer proceso sin cerrar.
      const focus = internal.find(p => states[p.label] === 'rework') || [...internal].reverse().find(p => states[p.label] === 'active') || internal.find(p => states[p.label] !== 'finished');
      o.focus = focus ? focus.label : '';
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
      const here = toMake.filter(o => o.focus === p.label);
      return { label: p.label, orders: here.length, units: here.reduce((s, o) => s + o.units, 0) };
    }).filter(item => item.orders).sort((a, b) => b.orders - a.orders);

    return {
      orders: list, timing, typical,
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

  const card = (tone, title, value, unit, lines, badge) =>
    '<article class="dash-card ' + tone + '"><h4>' + title + (badge ? '<em class="dash-badge">' + badge + '</em>' : '') + '</h4><div class="dash-big"><strong>' + value + '</strong><span>' + unit + '</span></div>' +
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

  function render(a) {
    const time = a.real !== null
      ? card('lime', 'Promedio de producción', fmtNum(a.real, 1), 'días', [
        ['Tiempo real, de la creación a la entrega', ''], ['Pedidos medidos', a.realCount], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null])
      : card('lime', 'Promedio de producción', fmtNum(a.estimated, 1), 'días', [
        ['Estimado sumando lo que tarda cada proceso', ''], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null, ['Se vuelve real al registrar entregas', '']]);
    const units = card('blue', 'Unidades por fabricar', fmtNum(a.unitsToMake), 'unidades', [
      ['Pedidos con procesos pendientes', a.ordersToMake], ['Unidades en pedidos activos', fmtNum(a.unitsAll)]]);
    const week = card(a.lateBefore ? 'red' : 'orange', 'Entregas de la semana', String(a.weekCount), a.weekCount === 1 ? 'pedido' : 'pedidos', [
      ['Del ' + fmtShort(a.weekStart) + ' al ' + fmtShort(a.weekEnd), ''], ['Unidades a entregar', fmtNum(a.weekUnits)],
      a.weekProgress !== null ? ['Avance de estos pedidos', Math.round(a.weekProgress) + '%'] : null, a.lateBefore ? ['Vencidos de semanas anteriores', a.lateBefore] : null],
      a.lateBefore ? a.lateBefore + ' vencidos' : '');
    const pct = card('green', 'Porcentaje de avance', a.progress === null ? '—' : String(Math.round(a.progress)), '%', [
      ['Procesos terminados por pedido', ''], ['Pedidos activos', a.activeCount], a.progressUnits !== null ? ['Avance por unidades', Math.round(a.progressUnits) + '%'] : null]);

    const soon = [...a.dueToday.map(o => ({ ...o, when: 'Hoy' })), ...a.dueTomorrow.map(o => ({ ...o, when: 'Mañana' }))];
    const today = todayPanel('orange', 'Entregas hoy y mañana', soon.length,
      orderList(soon, 'No hay entregas programadas para hoy ni mañana.', o => o.when + ' · ' + o.percent + '% avance'));
    const late = todayPanel('red', 'Pedidos atrasados', a.late.length,
      orderList(a.late, 'Ningún pedido atrasado. ¡Bien!', o => (o.focus ? o.focus + ' · ' : '') + 'Venció ' + fmtDue(o.due) + ' · ' + daysBetween(o.due, a.today) + ' d'));
    const rework = todayPanel('rose', 'En reproceso', a.reworkList.length,
      orderList(a.reworkList, 'No hay pedidos en reproceso.', o => (o.focus || 'Reproceso') + ' · entrega ' + fmtDue(o.due)));

    const maxLoad = Math.max(1, ...a.load.map(item => item.orders));
    const totalLoad = a.load.reduce((s, item) => s + item.orders, 0);
    const tier = item => {
      const share = item.orders / maxLoad;
      return share >= .75 ? 'hot' : share >= .4 ? 'warm' : 'cool';
    };
    const load = a.load.length
      ? '<section class="dash-load"><div class="dash-panel-head"><h4>Carga por área</h4><small>' + totalLoad + ' pedido' + (totalLoad === 1 ? '' : 's') + ' pendiente' + (totalLoad === 1 ? '' : 's') + ' según el proceso en el que están ahora</small></div>' +
        '<div class="dash-load-grid">' + a.load.map((item, i) => '<article class="dash-load-card ' + tier(item) + '">' + (i === 0 ? '<em class="dash-bottleneck">Mayor carga</em>' : '') + '<span class="dash-load-label">' + esc(item.label) + '</span><div class="dash-big"><strong>' + item.orders + '</strong><span>' + (item.orders === 1 ? 'pedido' : 'pedidos') + '</span></div><small>' + fmtNum(item.units) + ' und.</small></article>').join('') + '</div></section>'
      : '';

    const timing = a.timing.length
      ? '<section class="dash-load dash-timing"><div class="dash-panel-head"><h4>Tiempo por orden</h4><small>Días desde la creación frente al plazo de entrega' + (a.typical !== null ? ' · promedio ' + fmtNum(a.typical, 1) + ' d' : '') + ' · aproximado</small></div>' +
        '<ul class="dash-time-list">' + a.timing.map(t => {
          const tone = t.o.due && t.o.due < a.today ? 'late' : t.ratio >= .8 ? 'warn' : 'ok';
          const note = t.left === null ? '' : t.left < 0 ? 'Atrasada ' + (-t.left) + ' d' : t.left === 0 ? 'Entrega hoy' : 'Quedan ' + t.left + ' d';
          return '<li class="' + tone + '"><div class="dash-time-id"><strong>' + esc(t.o.id) + '</strong><span>' + esc(t.o.client || 'Sin cliente') + '</span></div>' +
            '<div class="dash-time-bar"><i><b style="width:' + Math.min(100, Math.round(t.ratio * 100)) + '%"></b></i><small>Lleva ' + t.elapsed + ' d' + (t.plazo ? ' de ~' + t.plazo + ' d' : '') + ' · ' + (t.o.focus ? esc(t.o.focus) + ' · ' : '') + t.o.percent + '%</small></div>' +
            '<em>' + note + '</em></li>';
        }).join('') + '</ul></section>'
      : '';

    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de la producción</h3></div><small><i class="dash-live"></i>En vivo · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      orderFinder(a.orders) +
      '<div class="dash-cards">' + time + units + week + pct + '</div>' +
      '<div class="dash-today">' + today + late + rework + '</div>' + timing + load;
    greet(a);
    bindOrderFinder(a.orders);
    countUp();
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
  .dash-load-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .dash-load-card{position:relative;display:grid;align-content:start;gap:6px;padding:16px;border:1px solid rgba(255,255,255,.13);border-top:5px solid var(--t,#7ecf8a);border-radius:16px;background:#121712;transition:transform .15s,border-color .15s}
  .dash-load-card:hover{transform:translateY(-3px)}
  .dash-load-card.cool{--t:#7ecf8a}.dash-load-card.warm{--t:#ffc95c}.dash-load-card.hot{--t:#ff6b5c;background:rgba(255,107,92,.06)}
  .dash-load-label{font-size:.78rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#d5dccf}
  .dash-load-card .dash-big{gap:6px}.dash-load-card .dash-big strong{font-size:2rem;color:var(--t)}.dash-load-card .dash-big span{font-size:.78rem;color:#a9b5a3}
  .dash-load-card>small{color:#8f9b8a;font-size:.76rem}
  .dash-bottleneck{position:absolute;top:-11px;right:12px;font-style:normal;font-size:.6rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:#ff6b5c;color:#2a0e0a;border:1px solid #ff8a7c}
  .dash-time-list{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:420px;overflow:auto}
  .dash-time-list li{--t:#7ecf8a;display:grid;grid-template-columns:minmax(120px,1fr) minmax(160px,2fr) auto;align-items:center;gap:14px;padding:9px 12px;border-radius:10px;background:rgba(255,255,255,.04)}
  .dash-time-list li.warn{--t:#ffc95c}.dash-time-list li.late{--t:#ff6b5c}
  .dash-time-id{display:grid;min-width:0}.dash-time-id strong{font-size:.9rem;color:#f2f7ea}.dash-time-id span{font-size:.76rem;color:#a9b5a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dash-time-bar{display:grid;gap:4px}.dash-time-bar i{display:block;height:7px;border-radius:999px;background:#314033;overflow:hidden}.dash-time-bar b{display:block;height:100%;background:var(--t);border-radius:inherit}.dash-time-bar small{font-size:.72rem;color:#b3c0ad}
  .dash-time-list em{font-style:normal;font-weight:800;font-size:.76rem;color:var(--t);white-space:nowrap}
  @media(max-width:700px){.dash-time-list li{grid-template-columns:1fr auto}.dash-time-bar{grid-column:1/-1;order:3}}
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
