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
      if (!o) { o = { id, rows: [], due: null, created: null, units: 0 }; orders.set(id, o); }
      o.rows.push(v);
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

    return {
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

  const card = (tone, title, value, unit, lines) =>
    '<article class="dash-card ' + tone + '"><h4>' + title + '</h4><div class="dash-big"><strong>' + value + '</strong><span>' + unit + '</span></div>' +
    '<ul>' + lines.filter(Boolean).map(([label, val]) => val === '' ? '<li class="note">' + label + '</li>' : '<li><span>' + label + '</span><b>' + val + '</b></li>').join('') + '</ul></article>';

  function render(a) {
    const time = a.real !== null
      ? card('lime', 'Promedio de producción', fmtNum(a.real, 1), 'días', [
        ['Tiempo real, de la creación a la entrega', ''], ['Pedidos medidos', a.realCount], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null])
      : card('lime', 'Promedio de producción', fmtNum(a.estimated, 1), 'días', [
        ['Estimado sumando lo que tarda cada proceso', ''], a.promised !== null ? ['Plazo prometido', fmtNum(a.promised, 1) + ' d'] : null, ['Se vuelve real al registrar entregas', '']]);
    const units = card('blue', 'Unidades por fabricar', fmtNum(a.unitsToMake), 'unidades', [
      ['Pedidos con procesos pendientes', a.ordersToMake], ['Unidades en pedidos activos', fmtNum(a.unitsAll)]]);
    const week = card('orange', 'Entregas de la semana', String(a.weekCount), a.weekCount === 1 ? 'pedido' : 'pedidos', [
      ['Del ' + fmtShort(a.weekStart) + ' al ' + fmtShort(a.weekEnd), ''], ['Unidades a entregar', fmtNum(a.weekUnits)],
      a.weekProgress !== null ? ['Avance de estos pedidos', Math.round(a.weekProgress) + '%'] : null, a.lateBefore ? ['Vencidos de semanas anteriores', a.lateBefore] : null]);
    const pct = card('green', 'Porcentaje de avance', a.progress === null ? '—' : String(Math.round(a.progress)), '%', [
      ['Procesos terminados por pedido', ''], ['Pedidos activos', a.activeCount], a.progressUnits !== null ? ['Avance por unidades', Math.round(a.progressUnits) + '%'] : null]);
    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de la producción</h3></div><small><i class="dash-live"></i>En vivo · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      '<div class="dash-cards">' + time + units + week + pct + '</div>';
  }

  const style = document.createElement('style');
  style.textContent = `
  #home-dashboard{display:grid;gap:16px}
  .dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.dash-head h3{margin:4px 0 0;font-size:1.4rem}.dash-head small{color:var(--muted);display:flex;align-items:center;gap:6px}
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
  @media(max-width:800px){.dash-big strong{font-size:2.8rem}}
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
