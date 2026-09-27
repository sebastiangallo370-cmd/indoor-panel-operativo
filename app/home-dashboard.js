/* Dashboard de INICIO: solo lectura sobre /api/produccion. No modifica datos.
   Resumen + tarjetas dinámicas de pedidos (filtros, actualización automática). */
(function () {
  'use strict';
  const root = document.getElementById('home-dashboard');
  if (!root) return;

  const key = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DAY = 86400000;
  const PAGE = 12;
  const COLORS = { red: '#ff6b6b', orange: '#ffb347', yellow: '#e6e35a', green: '#8bd450', gray: '#4b5648', blue: '#6cb6ff' };
  const STATE_LABEL = { finished: 'Terminado', active: 'En proceso', rework: 'Reproceso', pending: 'Pendiente', ready: 'Listos para iniciar', work: 'En el área' };
  const STATE_COLOR = { finished: COLORS.green, active: COLORS.blue, rework: COLORS.red, pending: COLORS.gray };

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
  const daysBetween = (a, b) => Math.round((b - a) / DAY);
  const fmtDate = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const avg = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
  const fmtDays = n => n === null ? '—' : (Math.round(n * 10) / 10).toLocaleString('es-CO');
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
      project: findColumn(headers, ['NOMBRE PROYECTO']),
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
      if (!o) { o = { id, client, project: '', rows: [], due: null, created: null, units: 0, refs: 0 }; orders.set(id, o); }
      o.rows.push(v);
      if (!o.project && col.project >= 0) o.project = String(v[col.project] || '').trim();
      o.units += col.quantity >= 0 ? num(v[col.quantity]) : 0;
      o.refs++;
      const due = col.due >= 0 ? parseDate(v[col.due]) : null;
      if (due && (!o.due || due > o.due)) o.due = due;
      const created = col.created >= 0 ? parseDate(v[col.created]) : null;
      if (created && (!o.created || created < o.created)) o.created = created;
    });

    const today = startOfToday();
    const list = [...orders.values()];
    list.forEach(o => {
      // Entregado = todas las filas con fecha de entrega real o "SI".
      const marks = o.rows.map(v => {
        const cell = col.delivered >= 0 ? v[col.delivered] : '';
        return { date: parseDate(cell), yes: key(cell) === 'SI' };
      });
      o.delivered = !!marks.length && marks.every(m => m.date || m.yes);
      const dates = marks.map(m => m.date).filter(Boolean);
      o.deliveredOn = o.delivered && dates.length ? new Date(Math.max(...dates)) : null;
      o.states = {};
      processes.forEach(p => {
        const cells = o.rows.flatMap(v => p.columns.map(i => key(v[i])));
        const closed = cells.map(c => c === 'N/A' || !!parseDate(c));
        o.states[p.label] = cells.includes('R') ? 'rework' : cells.includes('P') ? 'active'
          : cells.length && closed.every(Boolean) ? 'finished' : 'pending';
      });
      // Listo para iniciar = pendiente y con la etapa interna anterior ya terminada.
      o.ready = {};
      processes.forEach((p, i) => {
        const prev = processes.slice(0, i).filter(q => !q.external).at(-1);
        o.ready[p.label] = o.states[p.label] === 'pending' && (!prev || o.states[prev.label] === 'finished');
      });
      o.finishedOn = {};
      processes.forEach(p => {
        const dates = o.rows.flatMap(v => p.columns.map(i => parseDate(v[i]))).filter(Boolean);
        if (dates.length) o.finishedOn[p.label] = new Date(Math.max(...dates));
      });
      const inner = internal.map(p => o.states[p.label]);
      const done = inner.filter(s => s === 'finished').length;
      o.percent = inner.length ? Math.round(done / inner.length * 100) : 0;
      o.state = inner.includes('rework') ? 'rework' : inner.includes('active') ? 'active'
        : inner.length && done === inner.length ? 'finished' : 'pending';
      const focus = internal.find(p => o.states[p.label] === 'rework') || [...internal].reverse().find(p => o.states[p.label] === 'active')
        || internal.find(p => o.states[p.label] !== 'finished') || internal[internal.length - 1];
      o.focus = focus ? { label: focus.label, state: o.states[focus.label] } : null;
      o.left = o.due ? daysBetween(today, o.due) : null;
      o.bucket = o.left === null ? 'none' : o.left < 0 ? 'late' : o.left <= 7 ? 'soon' : o.left <= 14 ? 'mid' : 'ok';
    });

    const active = list.filter(o => !o.delivered);
    const withDue = active.filter(o => o.due);
    const bucket = name => active.filter(o => o.bucket === name);
    const upcoming = withDue.filter(o => o.left >= 0).sort((a, b) => a.due - b.due).slice(0, 5);

    const done = list.filter(o => o.delivered && o.deliveredOn && o.created && o.deliveredOn >= o.created);
    const since = new Date(today.getTime() - 90 * DAY);
    const recent = done.filter(o => o.deliveredOn >= since);
    const sample = recent.length >= 3 ? recent : done;
    const lead = sample.map(o => daysBetween(o.created, o.deliveredOn));
    const promised = sample.filter(o => o.due && o.due >= o.created).map(o => daysBetween(o.created, o.due));
    const onTime = sample.filter(o => o.due);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const inMonth = done.filter(o => o.deliveredOn.getFullYear() === d.getFullYear() && o.deliveredOn.getMonth() === d.getMonth());
      months.push({ label: MONTHS[d.getMonth()], value: avg(inMonth.map(o => daysBetween(o.created, o.deliveredOn))), count: inMonth.length });
    }

    const stages = processes.map(p => {
      const s = { label: p.label, external: p.external, finished: 0, active: 0, rework: 0, ready: 0, wait: 0 };
      active.forEach(o => {
        const st = o.states[p.label];
        if (st === 'pending') { if (o.ready[p.label]) s.ready++; else s.wait++; } else s[st]++;
      });
      return s;
    });

    // Días que tarda cada proceso: desde el cierre del anterior (o la creación) hasta su propio cierre.
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
    const procTimes = processes.map(p => ({ label: p.label, value: avg(spans.get(p.label)), count: spans.get(p.label).length }))
      .filter(t => t.value !== null && !processes.find(p => p.label === t.label).external);
    const both = active.filter(o => o.created && o.due && o.due >= o.created);
    const aged = active.filter(o => o.created && o.created <= today);
    const plan = {
      lead: avg(both.map(o => daysBetween(o.created, o.due))), leadCount: both.length,
      age: avg(aged.map(o => daysBetween(o.created, today))), ageCount: aged.length,
      progress: active.length ? avg(active.map(o => o.percent)) : null
    };

    return {
      plan, procTimes, today, total: list.length, active, processes, stages, upcoming, months,
      late: bucket('late'), soon: bucket('soon'), mid: bucket('mid'), ok: bucket('ok'), noDue: active.length - withDue.length,
      lead: avg(lead), promised: avg(promised), sampleSize: sample.length, recentWindow: sample === recent,
      onTimePct: onTime.length ? Math.round(onTime.filter(o => o.deliveredOn <= o.due).length / onTime.length * 100) : null,
      hasCreated: col.created >= 0
    };
  }

  /* ---------- filtros de las tarjetas ---------- */
  const FILTERS = [
    ['all', 'Todos'], ['late', 'Atrasados'], ['soon', '0–7 días'], ['mid', '8–14 días'], ['ok', '+14 días'],
    ['active', 'En proceso'], ['rework', 'Reproceso'], ['finished', 'Terminados']
  ];
  const ui = { filter: 'all', shown: PAGE };
  let model = null, lastText = '';

  function matcher(filter) {
    if (filter === 'all') return () => true;
    if (['late', 'soon', 'mid', 'ok'].includes(filter)) return o => o.bucket === filter;
    if (['active', 'rework', 'finished'].includes(filter)) return o => o.state === filter;
    if (filter.startsWith('a|')) { const label = filter.slice(2); return o => o.ready[label] || ['active', 'rework'].includes(o.states[label]); }
    if (filter.startsWith('p|')) {
      const [, label, state] = filter.split('|');
      return state === 'ready' ? o => !!o.ready[label] : o => o.states[label] === state;
    }
    return () => true;
  }
  function filterLabel(filter) {
    const known = FILTERS.find(f => f[0] === filter);
    if (known) return known[1];
    if (filter.startsWith('a|')) return filter.slice(2) + ' · ' + STATE_LABEL.work;
    if (filter.startsWith('p|')) { const [, label, state] = filter.split('|'); return label + ' · ' + STATE_LABEL[state]; }
    return filter;
  }

  /* ---------- piezas de la vista ---------- */
  function segments(items) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total) return '<div class="dash-empty">Sin datos</div>';
    return '<div class="dash-bar" role="img" aria-label="' + esc(items.map(i => i.label + ': ' + i.value).join(', ')) + '">' +
      items.filter(i => i.value).map(i => i.filter
        ? '<button type="button" class="dash-seg" data-filter="' + esc(i.filter) + '" style="flex:' + i.value + ';background:' + i.color + '" title="' + esc(i.label + ': ' + i.value + ' · ver tarjetas') + '">' + i.value + '</button>'
        : '<span style="flex:' + i.value + ';background:' + i.color + '" title="' + esc(i.label + ': ' + i.value) + '">' + i.value + '</span>').join('') + '</div>';
  }

  function orderCard(o, a) {
    const badge = o.bucket === 'none' ? '<span class="dash-badge">Sin fecha</span>'
      : o.bucket === 'late' ? '<span class="dash-badge bad">Vencido ' + Math.abs(o.left) + ' d</span>'
      : o.left === 0 ? '<span class="dash-badge warn">Entrega hoy</span>'
      : '<span class="dash-badge ' + (o.bucket === 'soon' ? 'warn' : o.bucket === 'mid' ? 'mid' : 'good') + '">Faltan ' + o.left + ' d</span>';
    const dots = a.processes.map(p => '<i style="background:' + STATE_COLOR[o.states[p.label]] + '" title="' + esc(p.label + ': ' + STATE_LABEL[o.states[p.label]]) + '"></i>').join('');
    return '<article class="dash-order s-' + o.state + (o.bucket === 'late' ? ' is-late' : '') + '">' +
      '<div class="dash-order-head"><b>' + esc(o.id) + '</b>' + badge + '</div>' +
      '<p class="dash-client">' + esc(o.client || 'Sin cliente') + (o.project ? '<span>' + esc(o.project) + '</span>' : '') + '</p>' +
      '<div class="dash-dots">' + dots + '</div>' +
      '<div class="dash-progress"><div><span style="width:' + o.percent + '%"></span></div><b>' + o.percent + '%</b></div>' +
      '<div class="dash-focus"><i style="background:' + (o.focus ? STATE_COLOR[o.focus.state] : COLORS.gray) + '"></i>' +
      (o.focus ? esc(o.focus.label) + ' · ' + STATE_LABEL[o.focus.state] : 'Sin proceso') + '</div>' +
      '<div class="dash-order-foot"><span>' + (o.due ? 'Entrega ' + fmtDate(o.due) : 'Sin fecha de entrega') + '</span><span>' + (o.units ? o.units.toLocaleString('es-CO') + ' und · ' : '') + o.refs + ' ref.</span></div>' +
      '</article>';
  }

  function render() {
    const a = model;
    if (!a) return;
    const kpi = (label, value, note, tone, filter) => {
      const inner = '<small>' + label + '</small><strong>' + value + '</strong><span>' + note + (filter ? ' · <u>ver tarjetas</u>' : '') + '</span>';
      return filter ? '<button type="button" class="dash-kpi dash-link ' + (tone || '') + '" data-filter="' + filter + '">' + inner + '</button>' : '<div class="dash-kpi ' + (tone || '') + '">' + inner + '</div>';
    };
    const kpis =
      kpi('Pedidos activos', a.active.length, 'de ' + a.total + ' registrados', '', 'all') +
      kpi('Entregas vencidas', a.late.length, a.late.length ? 'requieren atención' : 'todo al día', a.late.length ? 'bad' : 'good', 'late') +
      kpi('Vencen en 7 días', a.soon.length, 'próximas entregas', a.soon.length ? 'warn' : '', 'soon') +
      kpi('Salida promedio', a.lead === null ? '—' : fmtDays(a.lead) + ' <em>días</em>',
        a.lead === null ? 'aún sin pedidos entregados con fecha' : 'de creación a entrega · ' + a.sampleSize + ' pedidos' + (a.recentWindow ? ' (90 días)' : ''));

    const dueBlock =
      '<h4>Fechas de entrega</h4>' +
      segments([
        { label: 'Vencidos', value: a.late.length, color: COLORS.red, filter: 'late' },
        { label: '0 a 7 días', value: a.soon.length, color: COLORS.orange, filter: 'soon' },
        { label: '8 a 14 días', value: a.mid.length, color: COLORS.yellow, filter: 'mid' },
        { label: 'Más de 14 días', value: a.ok.length, color: COLORS.green, filter: 'ok' }
      ]) +
      '<div class="dash-legend"><i style="background:' + COLORS.red + '"></i>Vencidos <i style="background:' + COLORS.orange + '"></i>0–7 días <i style="background:' + COLORS.yellow + '"></i>8–14 días <i style="background:' + COLORS.green + '"></i>+14 días' +
      (a.noDue ? ' · ' + a.noDue + ' sin fecha' : '') + '</div>' +
      '<ul class="dash-list">' + (a.upcoming.length ? a.upcoming.map(o =>
        '<li><b>' + esc(o.id) + '</b><span>' + esc(o.client || 'Sin cliente') + '</span><em class="' + (o.left <= 7 ? 'hot' : '') + '">' + fmtDate(o.due) + ' · ' + (o.left === 0 ? 'hoy' : o.left + ' d') + '</em></li>').join('')
        : '<li class="dash-empty">No hay entregas próximas.</li>') + '</ul>';

    const maxMonth = Math.max(1, ...a.months.map(m => m.value || 0));
    const tile = (label, value) => '<div><small>' + label + '</small><strong>' + value + '</strong></div>';
    const maxProc = Math.max(1, ...a.procTimes.map(t => t.value));
    const procBlock = a.procTimes.length
      ? '<h5>Días promedio por proceso <small>desde el cierre del anterior</small></h5><div class="dash-proc">' + a.procTimes.map(t =>
        '<div title="' + esc(t.label + ': ' + fmtDays(t.value) + ' días en promedio · ' + t.count + ' pedidos') + '"><label>' + esc(t.label) + '</label><span><i style="width:' + Math.max(4, t.value / maxProc * 100) + '%"></i></span><b>' + fmtDays(t.value) + ' d</b></div>').join('') + '</div>'
      : '';
    const timeBlock =
      '<h4>Tiempo de salida <small>días de creación a entrega</small></h4>' +
      (a.lead === null
        ? '<div class="dash-time">' + tile('Plazo promedio de entrega', a.plan.lead === null ? '—' : fmtDays(a.plan.lead) + ' d') +
          tile('Antigüedad promedio', a.plan.age === null ? '—' : fmtDays(a.plan.age) + ' d') +
          tile('Avance promedio', a.plan.progress === null ? '—' : Math.round(a.plan.progress) + '%') + '</div>' +
          '<p class="dash-note">' + (a.hasCreated ? 'Aún no hay pedidos entregados con fecha, así que se muestra el plazo prometido y la edad de los pedidos activos. El tiempo real aparecerá cuando se registren entregas.' : 'No se encontró la columna de fecha de creación.') + '</p>'
        : '<div class="dash-time">' + tile('Promedio real', fmtDays(a.lead) + ' d') + tile('Promedio prometido', fmtDays(a.promised) + ' d') +
          tile('Entregados a tiempo', a.onTimePct === null ? '—' : a.onTimePct + '%') + '</div>' +
          '<div class="dash-months">' + a.months.map(m => '<div title="' + esc(m.label + ': ' + (m.value === null ? 'sin entregas' : fmtDays(m.value) + ' días · ' + m.count + ' pedidos')) + '"><span style="height:' + (m.value ? Math.max(6, m.value / maxMonth * 100) : 0) + '%"></span><b>' + (m.value === null ? '' : Math.round(m.value)) + '</b><small>' + m.label + '</small></div>').join('') + '</div>') +
      procBlock;

    const selectedArea = ui.filter.startsWith('a|') ? ui.filter.slice(2) : ui.filter.startsWith('p|') ? ui.filter.split('|')[1] : '';
    const areaButtons = [...document.querySelectorAll('.tab.process-nav')];
    const areaCard = (st, index) => {
      const load = st.ready + st.active + st.rework;
      const total = st.finished + st.active + st.rework + st.ready + st.wait;
      const bar = [['finished', COLORS.green], ['active', COLORS.blue], ['rework', COLORS.red], ['ready', COLORS.yellow], ['wait', COLORS.gray]]
        .filter(([k]) => st[k]).map(([k, c]) => '<span style="flex:' + st[k] + ';background:' + c + '"></span>').join('');
      const chip = (state, label, n) => '<button type="button" class="dash-achip ' + state + '" data-filter="p|' + esc(st.label) + '|' + state + '"' + (n ? '' : ' disabled') + '><b>' + n + '</b>' + label + '</button>';
      const openIndex = areaButtons.findIndex(b => key(b.textContent.replace(/^\d+/, '')) === key(st.label));
      return '<article class="dash-area' + (selectedArea === st.label ? ' is-selected' : '') + (st.rework ? ' has-rework' : '') + '" data-filter="a|' + esc(st.label) + '" tabindex="0" role="button" aria-pressed="' + (selectedArea === st.label) + '" aria-label="' + esc(st.label + ': ' + load + ' pedidos en el área. Ver sus pedidos') + '">' +
        '<div class="dash-area-top"><span class="dash-area-n">' + (index + 1) + '</span><h5>' + esc(st.label) + (st.external ? ' <small>externo</small>' : '') + '</h5></div>' +
        '<div class="dash-area-main"><strong>' + load + '</strong><span>pedido' + (load === 1 ? '' : 's') + ' en el área</span></div>' +
        '<div class="dash-area-bar" title="' + esc(st.finished + ' terminados de ' + total) + '">' + bar + '</div>' +
        '<div class="dash-area-chips">' + chip('ready', 'Listos', st.ready) + chip('active', 'En proceso', st.active) + chip('rework', 'Reproceso', st.rework) + chip('finished', 'Terminados', st.finished) + '</div>' +
        (openIndex >= 0 ? '<button type="button" class="dash-area-open" data-open-area="' + openIndex + '">Abrir área ↗</button>' : '') +
        '</article>';
    };
    const stageBlock =
      '<h4>Áreas de producción <small>pedidos activos · toca una tarjeta para ver sus pedidos</small></h4>' +
      '<div class="dash-areas">' + a.stages.map(areaCard).join('') + '</div>' +
      '<div class="dash-legend"><i style="background:' + COLORS.green + '"></i>Terminado <i style="background:' + COLORS.blue + '"></i>En proceso <i style="background:' + COLORS.red + '"></i>Reproceso <i style="background:' + COLORS.yellow + '"></i>Listo para iniciar <i style="background:' + COLORS.gray + '"></i>Esperando etapa anterior</div>';

    // Tarjetas dinámicas
    const sorted = [...a.active].sort((x, y) => (x.due ? x.due.getTime() : Infinity) - (y.due ? y.due.getTime() : Infinity));
    const visible = sorted.filter(matcher(ui.filter));
    const chips = FILTERS.map(([id, label]) => '<button type="button" class="dash-chip" data-filter="' + id + '" aria-pressed="' + (ui.filter === id) + '">' + label + '<span>' + sorted.filter(matcher(id)).length + '</span></button>').join('') +
      (FILTERS.some(f => f[0] === ui.filter) ? '' : '<button type="button" class="dash-chip" data-filter="' + esc(ui.filter) + '" aria-pressed="true">' + esc(filterLabel(ui.filter)) + '<span>' + visible.length + '</span></button>');
    const cards = visible.slice(0, ui.shown).map(o => orderCard(o, a)).join('');

    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de los pedidos</h3></div><small><i class="dash-live"></i>En vivo · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      '<div class="dash-kpis">' + kpis + '</div>' +
      '<div class="dash-grid"><section class="dash-card">' + dueBlock + '</section><section class="dash-card">' + timeBlock + '</section><section class="dash-card dash-wide">' + stageBlock + '</section></div>' +
      '<section id="dash-cards" class="dash-cards"><div class="dash-cards-top"><h4>Pedidos en seguimiento <small>' + visible.length + ' tarjeta' + (visible.length === 1 ? '' : 's') + '</small></h4>' +
      (document.querySelector('.tab.production-nav') ? '<button type="button" class="dash-open" data-open-trace>Abrir Trazabilidad</button>' : '') + '</div>' +
      '<div class="dash-chips" role="group" aria-label="Filtrar pedidos">' + chips + '</div>' +
      (cards ? '<div class="dash-order-grid">' + cards + '</div>' : '<div class="dash-empty">No hay pedidos con este filtro.</div>') +
      (visible.length > ui.shown ? '<button type="button" class="dash-more" data-more>Ver más (' + (visible.length - ui.shown) + ')</button>' : '') + '</section>';
  }

  const style = document.createElement('style');
  style.textContent = `
  #home-dashboard{display:grid;gap:14px}
  .dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.dash-head h3{margin:4px 0 0;font-size:1.25rem}.dash-head small{color:var(--muted);display:flex;align-items:center;gap:6px}
  .dash-live{width:8px;height:8px;border-radius:50%;background:#8bd450;box-shadow:0 0 0 0 rgba(139,212,80,.6);animation:dashPulse 2s infinite}@keyframes dashPulse{70%{box-shadow:0 0 0 7px rgba(139,212,80,0)}100%{box-shadow:0 0 0 0 rgba(139,212,80,0)}}
  .dash-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .dash-kpi{display:grid;gap:4px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035)}
  .dash-kpi small{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}.dash-kpi strong{font-size:2rem;line-height:1.1}.dash-kpi strong em{font-size:.9rem;font-style:normal;color:var(--muted)}.dash-kpi span{color:#b7c2ae;font-size:.8rem}
  .dash-kpi.bad strong{color:#ff8a8a}.dash-kpi.warn strong{color:#ffc36b}.dash-kpi.good strong{color:#a6e26d}
  .dash-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .dash-card{padding:18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035);min-width:0}.dash-wide{grid-column:1/-1}
  .dash-card h4{margin:0 0 12px;font-size:1rem}.dash-card h4 small,.dash-cards h4 small{color:var(--muted);font-weight:400;font-size:.75rem;margin-left:6px}
  .dash-bar{display:flex;height:26px;border-radius:8px;overflow:hidden;background:#1a211a}.dash-bar span{display:grid;place-items:center;min-width:22px;color:#10140f;font-size:.72rem;font-weight:800}
  .dash-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:10px 0;color:var(--muted);font-size:.74rem}.dash-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:-6px}
  .dash-list{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.dash-list li{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.04);font-size:.82rem}.dash-list span{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dash-list em{font-style:normal;color:#b7c2ae}.dash-list em.hot{color:#ffc36b;font-weight:700}
  .dash-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 18px}.dash-stage label{display:block;margin-bottom:4px;font-size:.74rem;color:#d5dccf;font-weight:700}.dash-stage .dash-bar{height:20px}
  .dash-time{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.dash-time div{padding:10px;border-radius:10px;background:rgba(255,255,255,.04)}.dash-time small{display:block;color:var(--muted);font-size:.7rem}.dash-time strong{font-size:1.25rem}
  .dash-months{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:130px}.dash-months div{display:grid;grid-template-rows:1fr auto auto;justify-items:center;height:100%}.dash-months span{align-self:end;width:70%;max-width:38px;border-radius:6px 6px 0 0;background:var(--lime)}.dash-months b{font-size:.75rem}.dash-months small{color:var(--muted);font-size:.7rem}
  .dash-note{margin:0 0 14px;color:var(--muted);font-size:.78rem;line-height:1.45}
  .dash-card h5{margin:16px 0 10px;font-size:.88rem}.dash-card h5 small{color:var(--muted);font-weight:400;font-size:.72rem;margin-left:6px}
  .dash-proc{display:grid;gap:7px}.dash-proc div{display:grid;grid-template-columns:104px 1fr 44px;align-items:center;gap:10px;font-size:.76rem}.dash-proc label{color:#d5dccf;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dash-proc span{height:8px;border-radius:4px;background:#1f271f;overflow:hidden}.dash-proc i{display:block;height:100%;border-radius:4px;background:var(--lime)}.dash-proc b{text-align:right}
  .dash-areas{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .dash-area{display:grid;gap:9px;padding:14px;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:#121712;cursor:pointer;transition:border-color .15s,transform .15s,background .15s}
  .dash-area:hover,.dash-area:focus-visible{border-color:var(--lime);transform:translateY(-2px);background:#161d15;outline:none}
  .dash-area.is-selected{border-color:var(--lime);background:rgba(208,244,76,.09);box-shadow:0 0 0 1px var(--lime)}.dash-area.has-rework{border-top:3px solid #ff6b6b}
  .dash-area-top{display:flex;align-items:center;gap:8px}.dash-area-top h5{margin:0;font-size:.86rem;letter-spacing:.04em}.dash-area-top small{color:var(--muted);font-weight:400;letter-spacing:0}
  .dash-area-n{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:rgba(208,244,76,.14);color:var(--lime);font-size:.72rem;font-weight:800}
  .dash-area-main{display:flex;align-items:baseline;gap:8px}.dash-area-main strong{font-size:2rem;line-height:1}.dash-area-main span{color:var(--muted);font-size:.76rem}
  .dash-area-bar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:#1f271f}
  .dash-area-chips{display:flex;flex-wrap:wrap;gap:5px}
  button.dash-achip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04);font:inherit;font-size:.7rem;color:#cfd8c9;cursor:pointer;box-shadow:none;width:auto;min-height:0}
  button.dash-achip b{font-size:.74rem}button.dash-achip.ready b{color:#e6e35a}button.dash-achip.active b{color:#6cb6ff}button.dash-achip.rework b{color:#ff8a8a}button.dash-achip.finished b{color:#8bd450}
  button.dash-achip:hover:not(:disabled){border-color:var(--lime);color:#fff}button.dash-achip:disabled{opacity:.4;cursor:default}
  button.dash-area-open{justify-self:start;padding:5px 10px;border:1px solid var(--line);border-radius:8px;background:rgba(208,244,76,.08);font:inherit;font-size:.72rem;font-weight:700;color:var(--lime);cursor:pointer;box-shadow:none;width:auto;min-height:0}button.dash-area-open:hover{border-color:var(--lime)}
  .dash-empty{color:var(--muted);font-size:.85rem;padding:10px 0}
  button.dash-link,button.dash-seg,button.dash-chip,button.dash-open,button.dash-more{font:inherit;cursor:pointer;color:inherit;box-shadow:none;width:auto;min-height:0}
  button.dash-link{text-align:left;transition:border-color .15s,background .15s}button.dash-link:hover,button.dash-link:focus-visible{border-color:var(--lime);background:rgba(208,244,76,.07)}.dash-kpi u{color:var(--lime);text-decoration:none}
  button.dash-seg{display:grid;place-items:center;min-width:22px;padding:0;border:0;border-radius:0;color:#10140f;font-size:.72rem;font-weight:800;text-align:center}button.dash-seg:hover,button.dash-seg:focus-visible{filter:brightness(1.15);outline:2px solid #fff;outline-offset:-2px}
  .dash-cards{display:grid;gap:12px;padding:18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025)}
  .dash-cards-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.dash-cards h4{margin:0;font-size:1.05rem}
  button.dash-open,button.dash-more{padding:9px 14px;border:1px solid var(--line);border-radius:10px;background:rgba(208,244,76,.08);font-size:.8rem;font-weight:700}button.dash-open:hover,button.dash-more:hover{border-color:var(--lime)}button.dash-more{justify-self:center}
  .dash-chips{display:flex;flex-wrap:wrap;gap:8px}
  button.dash-chip{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04);font-size:.78rem;font-weight:600;color:#cfd8c9}
  button.dash-chip span{padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.1);font-size:.72rem}
  button.dash-chip:hover{border-color:var(--lime)}button.dash-chip[aria-pressed=true]{background:var(--lime);border-color:var(--lime);color:#141a0c}button.dash-chip[aria-pressed=true] span{background:rgba(0,0,0,.16)}
  .dash-order-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .dash-order{display:grid;gap:10px;padding:14px;border:1px solid rgba(255,255,255,.12);border-left:4px solid #4b5648;border-radius:12px;background:#121712;animation:dashIn .25s ease-out}
  .dash-order.s-active{border-left-color:#6cb6ff}.dash-order.s-rework{border-left-color:#ff6b6b}.dash-order.s-finished{border-left-color:#8bd450}.dash-order.is-late{box-shadow:0 0 0 1px rgba(255,107,107,.35)}
  @keyframes dashIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .dash-order-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.dash-order-head b{font-size:1rem}
  .dash-badge{padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.1);font-size:.7rem;font-weight:700}.dash-badge.bad{background:rgba(255,107,107,.2);color:#ff9d9d}.dash-badge.warn{background:rgba(255,179,71,.2);color:#ffc36b}.dash-badge.mid{background:rgba(230,227,90,.18);color:#e6e35a}.dash-badge.good{background:rgba(139,212,80,.18);color:#a6e26d}
  .dash-client{margin:0;font-size:.85rem;color:#d5dccf;display:grid;gap:2px}.dash-client span{color:var(--muted);font-size:.75rem}
  .dash-dots{display:flex;gap:3px}.dash-dots i{flex:1;height:7px;border-radius:3px}
  .dash-progress{display:flex;align-items:center;gap:10px}.dash-progress div{flex:1;height:7px;border-radius:4px;background:#1f271f;overflow:hidden}.dash-progress span{display:block;height:100%;background:var(--lime);border-radius:4px}.dash-progress b{font-size:.78rem}
  .dash-focus{display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:600}.dash-focus i{width:9px;height:9px;border-radius:50%}
  .dash-order-foot{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.74rem;border-top:1px solid rgba(255,255,255,.08);padding-top:8px}
  @media(max-width:800px){.dash-grid{grid-template-columns:1fr}.dash-wide{grid-column:auto}.dash-time{grid-template-columns:1fr}.dash-kpi strong{font-size:1.6rem}.dash-order-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  /* ---------- carga y actualización en vivo ---------- */
  let busy = false;
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
      render();
    } catch (error) {
      if (!model) root.innerHTML = '<div class="dash-empty">No fue posible cargar el resumen de pedidos: ' + esc(error.message) + '</div>';
    } finally { busy = false; }
  }

  root.addEventListener('click', event => {
    const openArea = event.target.closest('[data-open-area]');
    if (openArea) {
      document.querySelectorAll('.tab.process-nav')[Number(openArea.dataset.openArea)]?.click();
      return;
    }
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      ui.filter = filterButton.dataset.filter; ui.shown = PAGE; render();
      document.getElementById('dash-cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (event.target.closest('[data-more]')) { ui.shown += PAGE; render(); return; }
    if (event.target.closest('[data-open-trace]')) document.querySelector('.tab.production-nav')?.click();
  });

  root.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.dash-area')) { event.preventDefault(); event.target.click(); }
  });
  root.innerHTML = '<div class="dash-empty">Cargando resumen de pedidos…</div>';
  refresh(true);
  document.querySelectorAll('.tab[data-kind="inicio"]').forEach(tab => tab.addEventListener('click', () => refresh(false)));
  setInterval(() => { if (!document.hidden && document.querySelector('.panel.active')?.dataset.panel === 'inicio') refresh(false); }, 30000);
})();
