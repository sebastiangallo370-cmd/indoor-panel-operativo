/* Dashboard de INICIO: solo lectura sobre /api/produccion. No modifica datos. */
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
  const daysBetween = (a, b) => Math.round((b - a) / DAY);
  const fmtDate = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const avg = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;
  const fmtDays = n => n === null ? '—' : (Math.round(n * 10) / 10).toLocaleString('es-CO');

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
      due: findColumn(headers, ['FECHA DE ENTREGA']),
      created: findColumn(headers, ['FECHA DE CREACION', 'FECHA CREACION'], ['CREAC', 'FECHA DE PEDIDO', 'FECHA DE ORDEN', 'FECHA DE INGRESO']),
      delivered: findColumn(headers, ['ENTREGADO'])
    };
    if (col.created < 0 && headers.length > 10 && key(headers[10]).includes('FECHA')) col.created = 10;
    const flow = typeof indoorProcessFlow !== 'undefined' ? indoorProcessFlow : [];
    const processes = flow.map(p => ({
      label: p.label,
      columns: p.headers.flatMap(h => headers.flatMap((header, i) => key(header) === h ? [i] : []))
    })).filter(p => p.columns.length);

    const orders = new Map();
    (data.rows || []).forEach(row => {
      const v = row.values || [];
      const name = String(v[col.order] || '').trim();
      const client = String(v[col.client] || '').trim();
      if (!name && !client) return;
      const id = name || 'fila-' + row.source_row;
      let o = orders.get(id);
      if (!o) { o = { id, client, rows: [], due: null, created: null }; orders.set(id, o); }
      o.rows.push(v);
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
    });

    const active = list.filter(o => !o.delivered);
    const withDue = active.filter(o => o.due);
    const late = withDue.filter(o => o.due < today);
    const soon = withDue.filter(o => o.due >= today && daysBetween(today, o.due) <= 7);
    const mid = withDue.filter(o => daysBetween(today, o.due) > 7 && daysBetween(today, o.due) <= 14);
    const ok = withDue.filter(o => daysBetween(today, o.due) > 14);
    const upcoming = withDue.filter(o => o.due >= today).sort((a, b) => a.due - b.due).slice(0, 6);

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
      const s = { label: p.label, finished: 0, active: 0, rework: 0, pending: 0 };
      active.forEach(o => { s[o.states[p.label]]++; });
      return s;
    });

    return {
      today, total: list.length, active: active.length, late, soon, mid, ok, noDue: active.length - withDue.length, upcoming,
      lead: avg(lead), promised: avg(promised), sampleSize: sample.length, recentWindow: sample === recent,
      onTimePct: onTime.length ? Math.round(onTime.filter(o => o.deliveredOn <= o.due).length / onTime.length * 100) : null,
      months, stages, hasCreated: col.created >= 0, hasDue: col.due >= 0
    };
  }

  function segments(items) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total) return '<div class="dash-empty">Sin datos</div>';
    return '<div class="dash-bar" role="img" aria-label="' + esc(items.map(i => i.label + ': ' + i.value).join(', ')) + '">' +
      items.filter(i => i.value).map(i => '<span style="flex:' + i.value + ';background:' + i.color + '" title="' + esc(i.label + ': ' + i.value) + '">' + i.value + '</span>').join('') + '</div>';
  }

  function render(a) {
    const C = { red: '#ff6b6b', orange: '#ffb347', yellow: '#e6e35a', green: '#8bd450', gray: '#4b5648', blue: '#6cb6ff' };
    const kpi = (label, value, note, tone) => '<div class="dash-kpi ' + (tone || '') + '"><small>' + label + '</small><strong>' + value + '</strong><span>' + note + '</span></div>';

    const kpis =
      kpi('Pedidos activos', a.active, 'de ' + a.total + ' pedidos registrados') +
      kpi('Entregas vencidas', a.late.length, a.late.length ? 'requieren atención' : 'todo al día', a.late.length ? 'bad' : 'good') +
      kpi('Vencen en 7 días', a.soon.length, 'próximas entregas', a.soon.length ? 'warn' : '') +
      kpi('Salida promedio', a.lead === null ? '—' : fmtDays(a.lead) + ' <em>días</em>',
        a.lead === null ? 'aún sin pedidos entregados con fecha' : 'de creación a entrega · ' + a.sampleSize + ' pedidos' + (a.recentWindow ? ' (90 días)' : ''));

    const dueBlock =
      '<h4>Fechas de entrega</h4>' +
      segments([
        { label: 'Vencidos', value: a.late.length, color: C.red },
        { label: '0 a 7 días', value: a.soon.length, color: C.orange },
        { label: '8 a 14 días', value: a.mid.length, color: C.yellow },
        { label: 'Más de 14 días', value: a.ok.length, color: C.green }
      ]) +
      '<div class="dash-legend"><i style="background:' + C.red + '"></i>Vencidos <i style="background:' + C.orange + '"></i>0–7 días <i style="background:' + C.yellow + '"></i>8–14 días <i style="background:' + C.green + '"></i>+14 días' +
      (a.noDue ? ' · ' + a.noDue + ' sin fecha' : '') + '</div>' +
      '<ul class="dash-list">' + (a.upcoming.length ? a.upcoming.map(o => {
        const left = daysBetween(a.today, o.due);
        return '<li><b>' + esc(o.id) + '</b><span>' + esc(o.client || 'Sin cliente') + '</span><em class="' + (left <= 7 ? 'hot' : '') + '">' + fmtDate(o.due) + ' · ' + (left === 0 ? 'hoy' : left + ' d') + '</em></li>';
      }).join('') : '<li class="dash-empty">No hay entregas próximas.</li>') + '</ul>';

    const stageBlock =
      '<h4>Avance por proceso <small>pedidos activos</small></h4>' +
      '<div class="dash-stages">' + a.stages.map(s => '<div class="dash-stage"><label>' + esc(s.label) + '</label>' +
        segments([
          { label: 'Terminado', value: s.finished, color: C.green },
          { label: 'En proceso', value: s.active, color: C.blue },
          { label: 'Reproceso', value: s.rework, color: C.red },
          { label: 'Pendiente', value: s.pending, color: C.gray }
        ]) + '</div>').join('') + '</div>' +
      '<div class="dash-legend"><i style="background:' + C.green + '"></i>Terminado <i style="background:' + C.blue + '"></i>En proceso <i style="background:' + C.red + '"></i>Reproceso <i style="background:' + C.gray + '"></i>Pendiente</div>';

    const maxMonth = Math.max(1, ...a.months.map(m => m.value || 0));
    const timeBlock =
      '<h4>Tiempo de salida <small>días de creación a entrega</small></h4>' +
      (a.lead === null
        ? '<div class="dash-empty">' + (a.hasCreated ? 'Todavía no hay pedidos entregados con fecha para calcular el promedio.' : 'No se encontró la columna de fecha de creación.') + '</div>'
        : '<div class="dash-time"><div><small>Promedio real</small><strong>' + fmtDays(a.lead) + ' d</strong></div>' +
          '<div><small>Promedio prometido</small><strong>' + fmtDays(a.promised) + ' d</strong></div>' +
          '<div><small>Entregados a tiempo</small><strong>' + (a.onTimePct === null ? '—' : a.onTimePct + '%') + '</strong></div></div>' +
          '<div class="dash-months">' + a.months.map(m => '<div title="' + esc(m.label + ': ' + (m.value === null ? 'sin entregas' : fmtDays(m.value) + ' días · ' + m.count + ' pedidos')) + '"><span style="height:' + (m.value ? Math.max(6, m.value / maxMonth * 100) : 0) + '%"></span><b>' + (m.value === null ? '' : Math.round(m.value)) + '</b><small>' + m.label + '</small></div>').join('') + '</div>');

    root.innerHTML =
      '<div class="dash-head"><div><span class="eyebrow">Resumen operativo</span><h3>Estado de los pedidos</h3></div><small>Actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + '</small></div>' +
      '<div class="dash-kpis">' + kpis + '</div>' +
      '<div class="dash-grid"><section class="dash-card">' + dueBlock + '</section><section class="dash-card">' + timeBlock + '</section><section class="dash-card dash-wide">' + stageBlock + '</section></div>';
  }

  const style = document.createElement('style');
  style.textContent = `
  #home-dashboard{display:grid;gap:14px}
  .dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}.dash-head h3{margin:4px 0 0;font-size:1.25rem}.dash-head small{color:var(--muted)}
  .dash-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .dash-kpi{display:grid;gap:4px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035)}
  .dash-kpi small{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}.dash-kpi strong{font-size:2rem;line-height:1.1}.dash-kpi strong em{font-size:.9rem;font-style:normal;color:var(--muted)}.dash-kpi span{color:#b7c2ae;font-size:.8rem}
  .dash-kpi.bad strong{color:#ff8a8a}.dash-kpi.warn strong{color:#ffc36b}.dash-kpi.good strong{color:#a6e26d}
  .dash-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .dash-card{padding:18px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.035);min-width:0}.dash-wide{grid-column:1/-1}
  .dash-card h4{margin:0 0 12px;font-size:1rem}.dash-card h4 small{color:var(--muted);font-weight:400;font-size:.75rem;margin-left:6px}
  .dash-bar{display:flex;height:26px;border-radius:8px;overflow:hidden;background:#1a211a}.dash-bar span{display:grid;place-items:center;min-width:22px;color:#10140f;font-size:.72rem;font-weight:800}
  .dash-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:10px 0;color:var(--muted);font-size:.74rem}.dash-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:-6px}
  .dash-list{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.dash-list li{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.04);font-size:.82rem}.dash-list span{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dash-list em{font-style:normal;color:#b7c2ae}.dash-list em.hot{color:#ffc36b;font-weight:700}
  .dash-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 18px}.dash-stage label{display:block;margin-bottom:4px;font-size:.74rem;color:#d5dccf;font-weight:700}.dash-stage .dash-bar{height:20px}
  .dash-time{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.dash-time div{padding:10px;border-radius:10px;background:rgba(255,255,255,.04)}.dash-time small{display:block;color:var(--muted);font-size:.7rem}.dash-time strong{font-size:1.25rem}
  .dash-months{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:130px}.dash-months div{position:relative;display:grid;grid-template-rows:1fr auto auto;justify-items:center;height:100%}.dash-months span{align-self:end;width:70%;max-width:38px;border-radius:6px 6px 0 0;background:var(--lime)}.dash-months b{font-size:.75rem}.dash-months small{color:var(--muted);font-size:.7rem}
  .dash-empty{color:var(--muted);font-size:.85rem;padding:10px 0}
  @media(max-width:800px){.dash-grid{grid-template-columns:1fr}.dash-wide{grid-column:auto}.dash-time{grid-template-columns:1fr}.dash-kpi strong{font-size:1.6rem}}
  `;
  document.head.appendChild(style);

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/produccion', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'No se pudo cargar');
      render(analyse(data));
    } catch (error) {
      root.innerHTML = '<div class="dash-empty">No fue posible cargar el resumen de pedidos: ' + esc(error.message) + '</div>';
    } finally { busy = false; }
  }
  root.innerHTML = '<div class="dash-empty">Cargando resumen de pedidos…</div>';
  refresh();
  document.querySelectorAll('.tab[data-kind="inicio"]').forEach(tab => tab.addEventListener('click', refresh));
  setInterval(() => { if (!document.hidden && document.querySelector('.panel.active')?.dataset.panel === 'inicio') refresh(); }, 120000);
})();
