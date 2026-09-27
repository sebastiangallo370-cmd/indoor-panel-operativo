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
  const GROUPS = [
    { id: 'prep', title: 'Preparación', hint: 'Materiales, diseño y edición', labels: ['MATERIALES', 'DISENO', 'EDICION'] },
    { id: 'prod', title: 'Producción', hint: 'Impresión, sublimación, corte y aplique', labels: ['IMPRESION', 'SUBLIMACION', 'CORTE LASER', 'APLIQUE'] },
    { id: 'conf', title: 'Confección', hint: 'Insumos y confección', labels: ['INSUMOS', 'CONFECCION'] },
    { id: 'ent', title: 'Entrega', hint: 'Empaque, facturación y envío', labels: ['EMPAQUE', 'FACTURACION', 'ENVIO'] }
  ];
  const inWork = (o, label) => !!o.ready[label] || ['active', 'rework'].includes(o.states[label]);
  const groupLabels = (g, processes) => processes.filter(p => g.labels.includes(key(p.label))).map(p => p.label);
  const ui = { filter: 'all', shown: PAGE };
  let model = null, lastText = '';

  function matcher(filter) {
    if (filter === 'all') return () => true;
    if (['late', 'soon', 'mid', 'ok'].includes(filter)) return o => o.bucket === filter;
    if (['active', 'rework', 'finished'].includes(filter)) return o => o.state === filter;
    if (filter.startsWith('g|')) {
      const g = GROUPS.find(x => x.id === filter.slice(2));
      return g ? o => Object.keys(o.states).some(l => g.labels.includes(key(l)) && inWork(o, l)) : () => true;
    }
    if (filter.startsWith('a|')) { const label = filter.slice(2); return o => inWork(o, label); }
    if (filter.startsWith('p|')) {
      const [, label, state] = filter.split('|');
      return state === 'ready' ? o => !!o.ready[label] : o => o.states[label] === state;
    }
    return () => true;
  }
  function filterLabel(filter) {
    const known = FILTERS.find(f => f[0] === filter);
    if (known) return known[1];
    if (filter.startsWith('g|')) return (GROUPS.find(x => x.id === filter.slice(2)) || { title: filter }).title + ' · ' + STATE_LABEL.work;
    if (filter.startsWith('a|')) return filter.slice(2) + ' · ' + STATE_LABEL.work;
    if (filter.startsWith('p|')) { const [, label, state] = filter.split('|'); return label + ' · ' + STATE_LABEL[state]; }
    return filter;
  }

  /* ---------- piezas de la vista ---------- */
  function orderCard(o, a) {
    const badge = o.bucket === 'none' ? '<span class="dash-badge">Sin fecha</span>'
      : o.bucket === 'late' ? '<span class="dash-badge bad">Vencido ' + Math.abs(o.left) + ' d</span>'
      : o.left === 0 ? '<span class="dash-badge warn">Entrega hoy</span>'
      : '<span class="dash-badge ' + (o.bucket === 'soon' ? 'warn' : o.bucket === 'mid' ? 'mid' : 'good') + '">Faltan ' + o.left + ' d</span>';
    const done = a.processes.filter(p => !p.external && o.states[p.label] === 'finished').length, totalSteps = a.processes.filter(p => !p.external).length;
    return '<article class="dash-order s-' + o.state + (o.bucket === 'late' ? ' is-late' : '') + '">' +
      '<div class="dash-order-head"><b>' + esc(o.id) + '</b>' + badge + '</div>' +
      '<p class="dash-client">' + esc(o.client || 'Sin cliente') + (o.project ? '<span>' + esc(o.project) + '</span>' : '') + '</p>' +
      '<div class="dash-steps"><strong>' + done + '/' + totalSteps + '</strong><span>procesos terminados</span><b>' + o.percent + '%</b></div>' +
      '<div class="dash-focus"><i style="background:' + (o.focus ? STATE_COLOR[o.focus.state] : COLORS.gray) + '"></i>' +
      (o.focus ? esc(o.focus.label) + ' · ' + STATE_LABEL[o.focus.state] : 'Sin proceso') + '</div>' +
      '<div class="dash-order-foot"><span>' + (o.due ? 'Entrega ' + fmtDate(o.due) : 'Sin fecha de entrega') + '</span><span>' + (o.units ? o.units.toLocaleString('es-CO') + ' und · ' : '') + o.refs + ' ref.</span></div>' +
      '</article>';
  }

  function render() {
    const a = model;
    if (!a) return;
    const lateCount = a.late.length;
    const timeText = a.lead !== null ? fmtDays(a.lead) + ' días de salida promedio' : (a.plan.lead !== null ? fmtDays(a.plan.lead) + ' días de plazo promedio' : 'sin tiempo promedio todavía');
    const summary = '<p class="dash-summary"><b>' + a.active.length + '</b> pedidos activos <i>·</i> <b class="' + (lateCount ? 'bad' : 'good') + '">' + lateCount + '</b> vencidos <i>·</i> <b>' + a.soon.length + '</b> vencen en 7 días <i>·</i> <b>' + timeText.split(' ')[0] + '</b> ' + timeText.split(' ').slice(1).join(' ') + '</p>';

    const selectedGroup = ui.filter.startsWith('g|') ? ui.filter.slice(2)
      : ui.filter.startsWith('a|') || ui.filter.startsWith('p|') ? (GROUPS.find(g => g.labels.includes(key(ui.filter.startsWith('a|') ? ui.filter.slice(2) : ui.filter.split('|')[1])))?.id || '') : '';
    const groupCard = g => {
      const labels = groupLabels(g, a.processes);
      const work = a.active.filter(o => labels.some(l => inWork(o, l)));
      const count = fn => a.active.filter(o => labels.some(l => fn(o, l))).length;
      const times = a.procTimes.filter(t => labels.includes(t.label)).map(t => t.value);
      const selected = selectedGroup === g.id;
      const rows = [
        ['Listos para iniciar', count((o, l) => o.ready[l]), 'ready'],
        ['En proceso', count((o, l) => o.states[l] === 'active'), 'active'],
        ['En reproceso', count((o, l) => o.states[l] === 'rework'), 'rework'],
        ['Atrasados', work.filter(o => o.bucket === 'late').length, 'late']
      ].map(([label, n, tone]) => '<div class="' + tone + (n ? '' : ' zero') + '"><span>' + label + '</span><b>' + n + '</b></div>').join('');
      const procs = selected ? '<div class="dash-group-procs">' + labels.map(l => {
        const n = a.active.filter(o => inWork(o, l)).length;
        const on = ui.filter === 'a|' + l;
        return '<button type="button" class="dash-proc-chip" data-filter="a|' + esc(l) + '" aria-pressed="' + on + '">' + esc(l) + '<b>' + n + '</b></button>';
      }).join('') + '</div>' : '';
      return '<article class="dash-group' + (selected ? ' is-selected' : '') + (work.some(o => o.bucket === 'late') ? ' has-late' : '') + '" data-filter="g|' + g.id + '" tabindex="0" role="button" aria-pressed="' + selected + '" aria-label="' + esc(g.title + ': ' + work.length + ' pedidos. Ver sus pedidos') + '">' +
        '<div class="dash-group-top"><h4>' + g.title + '</h4><small>' + g.hint + '</small></div>' +
        '<div class="dash-group-main"><strong>' + work.length + '</strong><span>pedido' + (work.length === 1 ? '' : 's') + ' en esta área</span></div>' +
        '<div class="dash-group-rows">' + rows + '</div>' +
        '<div class="dash-group-time"><span>Tiempo promedio</span><b>' + (times.length ? fmtDays(avg(times)) + ' d' : '—') + '</b></div>' +
        procs + '</article>';
    };
    const groups = '<div class="dash-groups">' + GROUPS.map(groupCard).join('') + '</div>';

    // Tarjetas dinámicas
    const sorted = [...a.active].sort((x, y) => (x.due ? x.due.getTime() : Infinity) - (y.due ? y.due.getTime() : Infinity));
    const visible = sorted.filter(matcher(ui.filter));
    const chips = FILTERS.map(([id, label]) => '<button type="button" class="dash-chip" data-filter="' + id + '" aria-pressed="' + (ui.filter === id) + '">' + label + '<span>' + sorted.filter(matcher(id)).length + '</span></button>').join('') +
      (FILTERS.some(f => f[0] === ui.filter) ? '' : '<button type="button" class="dash-chip" data-filter="' + esc(ui.filter) + '" aria-pressed="true">' + esc(filterLabel(ui.filter)) + '<span>' + visible.length + '</span></button>');
    const cards = visible.slice(0, ui.shown).map(o => orderCard(o, a)).join('');

    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de los pedidos</h3></div><small><i class="dash-live"></i>En vivo · actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      summary + groups +
      '<section id="dash-cards" class="dash-cards"><div class="dash-cards-top"><h4>Pedidos en seguimiento <small>' + visible.length + ' tarjeta' + (visible.length === 1 ? '' : 's') + '</small></h4>' +
      (document.querySelector('.tab.production-nav') ? '<button type="button" class="dash-open" data-open-trace>Abrir Trazabilidad</button>' : '') + '</div>' +
      '<div class="dash-chips" role="group" aria-label="Filtrar pedidos">' + chips + '</div>' +
      (cards ? '<div class="dash-order-grid">' + cards + '</div>' : '<div class="dash-empty">No hay pedidos con este filtro.</div>') +
      (visible.length > ui.shown ? '<button type="button" class="dash-more" data-more>Ver más (' + (visible.length - ui.shown) + ')</button>' : '') + '</section>';
  }

  const style = document.createElement('style');
  style.textContent = `
  #home-dashboard{display:grid;gap:16px}
  .dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.dash-head h3{margin:4px 0 0;font-size:1.35rem}.dash-head small{color:var(--muted);display:flex;align-items:center;gap:6px}
  .dash-live{width:8px;height:8px;border-radius:50%;background:#8bd450;box-shadow:0 0 0 0 rgba(139,212,80,.6);animation:dashPulse 2s infinite}@keyframes dashPulse{70%{box-shadow:0 0 0 7px rgba(139,212,80,0)}100%{box-shadow:0 0 0 0 rgba(139,212,80,0)}}
  .dash-summary{margin:0;color:#c4cfbf;font-size:.95rem}.dash-summary b{color:#fff;font-size:1.1rem}.dash-summary b.bad{color:#ff8a8a}.dash-summary b.good{color:#a6e26d}.dash-summary i{font-style:normal;color:#5d6a5a;margin:0 4px}
  .dash-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
  .dash-group{display:grid;align-content:start;gap:14px;padding:20px;border:1px solid rgba(255,255,255,.13);border-top:4px solid var(--lime);border-radius:16px;background:#121712;cursor:pointer;transition:border-color .15s,transform .15s,background .15s}
  .dash-group:hover,.dash-group:focus-visible{border-color:var(--lime);transform:translateY(-3px);background:#161d15;outline:none}
  .dash-group.is-selected{background:rgba(208,244,76,.09);box-shadow:0 0 0 1px var(--lime)}.dash-group.has-late{border-top-color:#ff6b6b}
  .dash-group-top h4{margin:0;font-size:1.2rem}.dash-group-top small{display:block;margin-top:3px;color:var(--muted);font-size:.8rem}
  .dash-group-main{display:flex;align-items:baseline;gap:10px}.dash-group-main strong{font-size:3rem;line-height:1}.dash-group-main span{color:#c4cfbf;font-size:.9rem}
  .dash-group-rows{display:grid;gap:7px}.dash-group-rows div{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:9px;background:rgba(255,255,255,.05);font-size:.88rem}.dash-group-rows b{font-size:1.05rem}
  .dash-group-rows .ready b{color:#e6e35a}.dash-group-rows .active b{color:#6cb6ff}.dash-group-rows .rework b{color:#ff8a8a}.dash-group-rows .late b{color:#ffb347}.dash-group-rows .zero{opacity:.45}
  .dash-group-time{display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid rgba(255,255,255,.1);color:var(--muted);font-size:.85rem}.dash-group-time b{color:#fff;font-size:1.05rem}
  .dash-group-procs{display:flex;flex-wrap:wrap;gap:6px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}
  button.dash-proc-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.05);font:inherit;font-size:.76rem;font-weight:600;color:#e2e9dc;cursor:pointer;box-shadow:none;width:auto;min-height:0}
  button.dash-proc-chip b{padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.12)}button.dash-proc-chip:hover{border-color:var(--lime)}button.dash-proc-chip[aria-pressed=true]{background:var(--lime);border-color:var(--lime);color:#141a0c}button.dash-proc-chip[aria-pressed=true] b{background:rgba(0,0,0,.16)}
  .dash-empty{color:var(--muted);font-size:.9rem;padding:10px 0}
  button.dash-chip,button.dash-open,button.dash-more{font:inherit;cursor:pointer;color:inherit;box-shadow:none;width:auto;min-height:0}
  .dash-cards{display:grid;gap:14px;padding:20px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.025)}
  .dash-cards-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.dash-cards h4{margin:0;font-size:1.2rem}.dash-cards h4 small{color:var(--muted);font-weight:400;font-size:.8rem;margin-left:6px}
  button.dash-open,button.dash-more{padding:9px 14px;border:1px solid var(--line);border-radius:10px;background:rgba(208,244,76,.08);font-size:.85rem;font-weight:700}button.dash-open:hover,button.dash-more:hover{border-color:var(--lime)}button.dash-more{justify-self:center}
  .dash-chips{display:flex;flex-wrap:wrap;gap:8px}
  button.dash-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.04);font-size:.82rem;font-weight:600;color:#cfd8c9}
  button.dash-chip span{padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.1);font-size:.75rem}
  button.dash-chip:hover{border-color:var(--lime)}button.dash-chip[aria-pressed=true]{background:var(--lime);border-color:var(--lime);color:#141a0c}button.dash-chip[aria-pressed=true] span{background:rgba(0,0,0,.16)}
  .dash-order-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
  .dash-order{display:grid;gap:11px;padding:16px;border:1px solid rgba(255,255,255,.12);border-left:4px solid #4b5648;border-radius:12px;background:#121712;animation:dashIn .25s ease-out}
  .dash-order.s-active{border-left-color:#6cb6ff}.dash-order.s-rework{border-left-color:#ff6b6b}.dash-order.s-finished{border-left-color:#8bd450}.dash-order.is-late{box-shadow:0 0 0 1px rgba(255,107,107,.35)}
  @keyframes dashIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .dash-order-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.dash-order-head b{font-size:1.05rem}
  .dash-badge{padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.1);font-size:.75rem;font-weight:700}.dash-badge.bad{background:rgba(255,107,107,.2);color:#ff9d9d}.dash-badge.warn{background:rgba(255,179,71,.2);color:#ffc36b}.dash-badge.mid{background:rgba(230,227,90,.18);color:#e6e35a}.dash-badge.good{background:rgba(139,212,80,.18);color:#a6e26d}
  .dash-client{margin:0;font-size:.92rem;color:#e2e9dc;display:grid;gap:2px}.dash-client span{color:var(--muted);font-size:.8rem}
  .dash-steps{display:flex;align-items:baseline;gap:8px}.dash-steps strong{font-size:1.5rem}.dash-steps span{color:var(--muted);font-size:.82rem;flex:1}.dash-steps b{padding:2px 9px;border-radius:999px;background:rgba(208,244,76,.16);color:var(--lime);font-size:.82rem}
  .dash-focus{display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:600}.dash-focus i{width:9px;height:9px;border-radius:50%}
  .dash-order-foot{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.8rem;border-top:1px solid rgba(255,255,255,.08);padding-top:9px}
  @media(max-width:800px){.dash-order-grid{grid-template-columns:1fr}.dash-group-main strong{font-size:2.4rem}}
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
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.dash-group')) { event.preventDefault(); event.target.click(); }
  });
  root.innerHTML = '<div class="dash-empty">Cargando resumen de pedidos…</div>';
  refresh(true);
  document.querySelectorAll('.tab[data-kind="inicio"]').forEach(tab => tab.addEventListener('click', () => refresh(false)));
  setInterval(() => { if (!document.hidden && document.querySelector('.panel.active')?.dataset.panel === 'inicio') refresh(false); }, 30000);
})();
