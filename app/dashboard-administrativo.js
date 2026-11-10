// Dashboard administrativo: lectura simultánea de Producción y Operarios.
(function () {
  'use strict';
  const DAY = 86400000;
  const PROCESS_HEADERS = new Set([
    'MATERIALES ESPECIALES', 'MTS REQUERIDO', 'DISENO', 'EDICION', 'IMPRESION',
    'SUBLIMACION', 'CORTE LASER', 'APLIQUE', 'INSUMOS', 'CONFECCION', 'EMPAQUE',
    'FACTURACION', 'ENVIO', 'ENTREGADO'
  ]);
  let panel, lastFocus;

  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const startToday = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date; };
  const dateOf = value => {
    if (value instanceof Date) return isNaN(value) ? null : value;
    const text = String(value || '').trim();
    if (!text) return null;
    const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (parts) {
      const year = Number(parts[3]) < 100 ? 2000 + Number(parts[3]) : Number(parts[3]);
      const date = new Date(year, Number(parts[2]) - 1, Number(parts[1]));
      return isNaN(date) ? null : date;
    }
    const date = new Date(text);
    return isNaN(date) ? null : date;
  };
  const dateText = value => {
    const date = dateOf(value);
    return date ? new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(date) : 'Sin fecha';
  };
  const daysUntil = value => {
    const due = dateOf(value); if (!due) return null;
    return Math.round((due.setHours(0, 0, 0, 0) - startToday().getTime()) / DAY);
  };
  const numeric = value => Number(String(value || '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
  const isClosed = value => {
    const text = norm(value);
    return text === 'N/A' || text === 'NA' || (text && text !== 'P' && text !== 'R');
  };
  const col = (headers, names) => headers.findIndex(header => names.includes(norm(header)));
  const cell = (row, index) => index >= 0 && index < row.length ? row[index] : '';

  function injectStyle() {
    if (document.getElementById('admin-dashboard-style')) return;
    const style = document.createElement('style'); style.id = 'admin-dashboard-style';
    style.textContent = `
      .admin-dashboard{position:fixed;inset:0;z-index:5000;overflow:auto;background:radial-gradient(ellipse at 18% -10%,rgba(190,239,62,.16),transparent 34%),radial-gradient(ellipse at 90% 0,rgba(41,156,95,.18),transparent 30%),#061109;color:#edf5e9;font-family:Arial,sans-serif}
      .admin-dashboard[hidden]{display:none}.adm-shell{max-width:1440px;margin:auto;padding:26px 30px 54px}.adm-top{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:4px 0 24px;border-bottom:1px solid rgba(202,241,87,.16)}
      .adm-kicker{margin:0 0 5px;color:#c5ef52;font-size:.72rem;font-weight:900;letter-spacing:.14em}.adm-top h1{margin:0;font-size:clamp(1.45rem,2.4vw,2.25rem);letter-spacing:-.04em}.adm-close{appearance:none;border:1px solid rgba(220,246,193,.35);border-radius:12px;background:#173221;color:#f4ffee;padding:10px 13px;font-weight:800;cursor:pointer}.adm-tabs{display:flex;gap:8px;overflow:auto;padding:20px 0 14px}.adm-tab{white-space:nowrap;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.055);color:#cfdbca;padding:10px 14px;font-weight:800;cursor:pointer}.adm-tab.active{background:#c9f43d;color:#172008;border-color:#dfff72;box-shadow:0 8px 25px rgba(195,238,63,.2)}
      .adm-status{display:flex;align-items:center;gap:8px;min-height:42px;color:#aebaa9;font-size:.86rem}.adm-status i{width:8px;height:8px;border-radius:50%;background:#c9f43d;box-shadow:0 0 12px #c9f43d}.adm-status.error i{background:#ff7474;box-shadow:none}.adm-views{display:grid;gap:18px}.adm-section{display:none}.adm-section.active{display:grid;gap:18px}.adm-section.summary{display:grid;gap:18px}.adm-intro{padding:24px;border:1px solid rgba(207,244,127,.14);border-radius:18px;background:linear-gradient(130deg,rgba(44,86,37,.48),rgba(9,22,14,.88));box-shadow:inset 0 1px rgba(255,255,255,.06)}.adm-intro h2{margin:0 0 8px;font-size:1.18rem}.adm-intro p{margin:0;color:#b7c6b0;line-height:1.5}.adm-kpis{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px}.adm-kpi{position:relative;overflow:hidden;min-height:122px;padding:18px;border-radius:16px;border:1px solid rgba(219,245,183,.17);background:linear-gradient(145deg,rgba(37,65,38,.82),rgba(12,25,17,.96));box-shadow:0 13px 28px rgba(0,0,0,.18)}.adm-kpi:after{content:'';position:absolute;inset:auto -10% -44px;height:78px;border-radius:50%;background:rgba(196,239,65,.12);filter:blur(12px)}.adm-kpi.risk:after{background:rgba(255,116,100,.18)}.adm-kpi.need:after{background:rgba(255,201,88,.18)}.adm-kpi span{display:block;position:relative;z-index:1;color:#a8b9a4;font-weight:800;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}.adm-kpi strong{position:relative;z-index:1;display:block;margin-top:13px;font-size:1.9rem}.adm-kpi small{position:relative;z-index:1;display:block;margin-top:4px;color:#cbd8c5}.adm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.adm-card{min-width:0;padding:20px;border:1px solid rgba(219,245,183,.14);border-radius:18px;background:rgba(14,31,20,.84);box-shadow:0 12px 30px rgba(0,0,0,.16)}.adm-card.wide{grid-column:1/-1}.adm-card-head{display:flex;align-items:start;justify-content:space-between;gap:14px;margin-bottom:14px}.adm-card h3{margin:0;font-size:1.02rem}.adm-card p{margin:5px 0 0;color:#96a991;font-size:.85rem}.adm-pill{border-radius:999px;padding:6px 9px;background:rgba(201,244,61,.15);color:#d9fb71;font-size:.76rem;font-weight:900;white-space:nowrap}.adm-list{display:grid;gap:7px}.adm-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(100px,.8fr) auto;align-items:center;gap:12px;padding:11px 0;border-top:1px solid rgba(255,255,255,.07)}.adm-row:first-child{border-top:0}.adm-main{min-width:0}.adm-main b,.adm-main span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.adm-main b{font-size:.89rem}.adm-main span{margin-top:3px;color:#91a78f;font-size:.78rem}.adm-meta{color:#d9e8d3;font-size:.8rem}.adm-tag{border-radius:999px;padding:5px 8px;background:rgba(196,239,65,.13);color:#dff58c;font-size:.72rem;font-weight:900;text-align:center}.adm-tag.late{background:rgba(255,113,100,.16);color:#ffb2a9}.adm-tag.risk{background:rgba(255,187,81,.17);color:#ffdb96}.adm-empty{padding:20px 0;color:#93a18f;text-align:center}.adm-operator{grid-template-columns:34px minmax(0,1fr) auto}.adm-rank{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:rgba(201,244,61,.16);color:#e4fb89;font-weight:900;font-size:.78rem}.adm-progress{height:5px;margin-top:7px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.08)}.adm-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#bff13b,#64e5a4)}.adm-message{padding:18px;border-radius:14px;background:rgba(255,198,82,.09);border:1px solid rgba(255,198,82,.24);color:#ffe5a9;line-height:1.45}.adm-message.ok{background:rgba(93,222,143,.09);border-color:rgba(93,222,143,.22);color:#c4f6d7}.adm-skeleton{height:110px;border-radius:16px;background:linear-gradient(100deg,rgba(255,255,255,.05),rgba(255,255,255,.11),rgba(255,255,255,.05));background-size:220% 100%;animation:adm-shimmer 1.4s infinite}@keyframes adm-shimmer{to{background-position:-220% 0}}@media(max-width:900px){.adm-shell{padding:18px 16px 40px}.adm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.adm-grid{grid-template-columns:1fr}.adm-card.wide{grid-column:auto}}@media(max-width:560px){.adm-top{align-items:flex-start}.adm-close{padding:9px 10px}.adm-kpis{grid-template-columns:1fr 1fr}.adm-kpi{min-height:106px;padding:14px}.adm-kpi strong{font-size:1.55rem}.adm-row{grid-template-columns:minmax(0,1fr) auto}.adm-meta{display:none}.adm-tab{padding:9px 11px;font-size:.82rem}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    injectStyle();
    if (panel) return panel;
    panel = document.createElement('section'); panel.className = 'admin-dashboard'; panel.id = 'admin-dashboard'; panel.hidden = true;
    panel.innerHTML = `<div class="adm-shell"><header class="adm-top"><div><p class="adm-kicker">INDOOR SPORT · VISIÓN DE EMPRESA</p><h1>Dashboard administrativo</h1></div><button class="adm-close" type="button" data-adm-close>Volver a configuración</button></header><nav class="adm-tabs" aria-label="Secciones del dashboard"><button class="adm-tab active" data-adm-tab="summary">Inicio</button><button class="adm-tab" data-adm-tab="scheduled">Programados</button><button class="adm-tab" data-adm-tab="late">Atrasados</button><button class="adm-tab" data-adm-tab="operators">Operarios</button><button class="adm-tab" data-adm-tab="risk">En riesgo</button><button class="adm-tab" data-adm-tab="need">Necesidad de pedidos</button></nav><div class="adm-status" data-adm-status><i></i><span>Cargando información de la empresa…</span></div><main class="adm-views" data-adm-views></main></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', event => {
      const tab = event.target.closest('[data-adm-tab]');
      if (tab) showTab(tab.dataset.admTab);
      if (event.target.closest('[data-adm-close]')) close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });
    return panel;
  }

  function showTab(tab) {
    if (!panel) return;
    panel.querySelectorAll('.adm-tab').forEach(button => button.classList.toggle('active', button.dataset.admTab === tab));
    panel.querySelectorAll('.adm-section').forEach(section => section.classList.toggle('active', section.dataset.admSection === tab));
  }
  function close() { if (!panel) return; panel.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  function empty(text) { return `<div class="adm-empty">${esc(text)}</div>`; }
  function card(title, subtitle, count, content, wide) { return `<article class="adm-card${wide ? ' wide' : ''}"><div class="adm-card-head"><div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div><span class="adm-pill">${esc(count)}</span></div>${content}</article>`; }
  function row(order, style) { const date = dateText(order.due); return `<div class="adm-row"><div class="adm-main"><b>${esc(order.order || 'Sin orden')} · ${esc(order.client || 'Sin cliente')}</b><span>${esc(order.reference || order.pending || 'Sin referencia')}</span></div><div class="adm-meta">Entrega ${esc(date)}</div><span class="adm-tag ${style || ''}">${esc(order.badge || '')}</span></div>`; }
  function list(items, style, absent) { return items.length ? `<div class="adm-list">${items.map(item => row(item, style)).join('')}</div>` : empty(absent); }

  function modelFrom(production, operatorData) {
    const headers = Array.isArray(production.headers) ? production.headers : [];
    const rows = Array.isArray(production.rows) ? production.rows : [];
    const orderIndex = col(headers, ['ORDEN', 'PEDIDO']);
    const clientIndex = col(headers, ['NOMBRE DEL CLIENTE', 'CLIENTE']);
    const referenceIndex = col(headers, ['REFERENCIA', 'PROYECTO']);
    const dueIndex = col(headers, ['FECHA DE ENTREGA', 'FECHA ENTREGA', 'ENTREGA']);
    const quantityIndex = col(headers, ['CANTIDAD', 'CANT.']);
    const deliveryIndex = col(headers, ['ENTREGADO', 'ENVIO']);
    const flow = Array.isArray(window.indoorProcessFlow) ? window.indoorProcessFlow : [];
    const processColumns = flow.map(process => ({
      label: process.label,
      external: norm(process.label) === 'DISENO',
      columns: (process.headers || []).flatMap(header => headers.flatMap((current, index) => norm(current) === norm(header) ? [index] : []))
    })).filter(process => process.columns.length);
    const internal = processColumns.filter(process => !process.external);
    const grouped = new Map();
    rows.forEach((raw, index) => {
      const values = Array.isArray(raw.values) ? raw.values : (Array.isArray(raw) ? raw : []);
      const order = cell(values, orderIndex), client = cell(values, clientIndex);
      if (!order && !client && !cell(values, referenceIndex)) return;
      const id = String(order || ('fila-' + (raw.source_row || index))).trim();
      const item = grouped.get(id) || { source: raw.source_row || raw.row || index, order, client, reference: cell(values, referenceIndex), rows: [], due: null, quantity: 0 };
      item.rows.push(values); item.quantity += numeric(cell(values, quantityIndex));
      const due = dateOf(cell(values, dueIndex)); if (due && (!item.due || due > item.due)) item.due = due;
      if (!item.reference) item.reference = cell(values, referenceIndex);
      grouped.set(id, item);
    });
    const orders = [...grouped.values()].map(item => {
      const delivered = item.rows.length && item.rows.every(values => { const value = cell(values, deliveryIndex); return !!dateOf(value) || norm(value) === 'SI'; });
      const states = internal.map(process => {
        const values = item.rows.flatMap(row => process.columns.map(index => norm(cell(row, index))));
        if (values.includes('R')) return { label: process.label, state: 'rework' };
        if (values.includes('P')) return { label: process.label, state: 'active' };
        return { label: process.label, state: values.length && values.every(value => value === 'N/A' || !!dateOf(value)) ? 'finished' : 'pending' };
      });
      const focus = states.find(state => state.state === 'rework') || [...states].reverse().find(state => state.state === 'active') || states.find(state => state.state !== 'finished');
      return { ...item, due: item.due, diff: item.due ? daysUntil(item.due) : null, pending: focus ? focus.label : '', closed: delivered || (states.length > 0 && states.every(state => state.state === 'finished')) };
    });
    const active = orders.filter(order => !order.closed);
    const scheduled = active.filter(order => order.diff !== null && order.diff >= 0).sort((a, b) => a.diff - b.diff).slice(0, 12).map(order => ({ ...order, badge: order.diff === 0 ? 'Hoy' : order.diff === 1 ? 'Mañana' : `${order.diff} días` }));
    const late = active.filter(order => order.diff !== null && order.diff < 0).sort((a, b) => a.diff - b.diff).map(order => ({ ...order, badge: `${Math.abs(order.diff)} d tarde` }));
    const risk = active.filter(order => order.diff !== null && order.diff >= 0 && order.diff <= 4).sort((a, b) => a.diff - b.diff).map(order => ({ ...order, badge: order.diff === 0 ? 'Vence hoy' : `${order.diff} días`, pending: `Pendiente: ${order.pending || 'proceso'}` }));
    const maximum = active.reduce((max, order) => order.diff !== null ? Math.max(max, order.diff) : max, 0);
    const daily = operatorData && operatorData.daily && typeof operatorData.daily === 'object' ? operatorData.daily : {};
    const people = Array.isArray(operatorData && operatorData.operators) ? operatorData.operators : [];
    const weekStart = new Date(startToday().getTime() - 6 * DAY);
    const operators = people.map(person => {
      const days = daily[person.responsible] || {};
      const weekly = Object.entries(days).reduce((total, [day, value]) => { const date = dateOf(day); return date && date >= weekStart ? total + numeric(value) : total; }, 0);
      return { name: person.responsible || 'Sin nombre', today: numeric(person.today_count), weekly, current: person.current };
    }).sort((a, b) => b.weekly - a.weekly || b.today - a.today).slice(0, 10);
    return { active, scheduled, late, risk, maximum, operators };
  }

  function operatorsMarkup(operators) {
    if (!operators.length) return empty('Aún no hay cierres de operarios para comparar.');
    const maximum = Math.max(1, ...operators.map(operator => operator.weekly));
    return `<div class="adm-list">${operators.map((operator, index) => `<div class="adm-row adm-operator"><span class="adm-rank">${index + 1}</span><div class="adm-main"><b>${esc(operator.name)}</b><span>${operator.current ? `En ${esc(operator.current.process || 'proceso')}` : 'Sin proceso activo'}</span><div class="adm-progress"><i style="width:${Math.round(operator.weekly / maximum * 100)}%"></i></div></div><span class="adm-tag">${operator.weekly} sem.</span></div>`).join('')}</div>`;
  }

  function render(data) {
    const view = panel.querySelector('[data-adm-views]');
    const moreOrders = data.maximum < 2;
    const coverage = data.active.length ? `${data.maximum} día${data.maximum === 1 ? '' : 's'}` : '0 días';
    const intro = `<div class="adm-intro"><h2>Todo el estado operativo, en un solo lugar.</h2><p>Información actual de producción y rendimiento de operarios. El riesgo se marca cuando faltan 4 días o menos para la entrega.</p></div>`;
    const kpis = `<div class="adm-kpis"><article class="adm-kpi"><span>En producción</span><strong>${data.active.length}</strong><small>pedidos activos</small></article><article class="adm-kpi risk"><span>Atrasados</span><strong>${data.late.length}</strong><small>requieren atención</small></article><article class="adm-kpi risk"><span>En riesgo</span><strong>${data.risk.length}</strong><small>entrega en ≤ 4 días</small></article><article class="adm-kpi"><span>Operarios</span><strong>${data.operators.length}</strong><small>con actividad medida</small></article><article class="adm-kpi need"><span>Cobertura</span><strong>${coverage}</strong><small>${moreOrders ? 'se necesitan pedidos' : 'carga disponible'}</small></article></div>`;
    const scheduledCard = card('Recientes programados', 'Próximas entregas que siguen en producción.', data.scheduled.length, list(data.scheduled.slice(0, 6), '', 'No hay pedidos programados con fecha futura.'));
    const lateCard = card('Pedidos atrasados', 'Pedidos vencidos que aún tienen procesos pendientes.', data.late.length, list(data.late.slice(0, 6), 'late', 'No hay pedidos atrasados.'));
    const riskCard = card('Probablemente no alcancen', 'Pendientes con entrega dentro de los próximos 4 días.', data.risk.length, list(data.risk.slice(0, 6), 'risk', 'No hay pedidos en riesgo para los próximos 4 días.'));
    const operatorCard = card('Operarios más eficientes', 'Más finalizaciones registradas durante los últimos 7 días.', data.operators.length, operatorsMarkup(data.operators));
    const needMessage = moreOrders ? `<div class="adm-message"><b>Se necesitan más pedidos.</b><br>La carga activa alcanza solo para ${esc(coverage)}. Conviene programar nuevos pedidos para mantener la planta operando.</div>` : `<div class="adm-message ok"><b>Carga suficiente.</b><br>La producción activa tiene cobertura aproximada de ${esc(coverage)} antes de requerir nuevos pedidos.</div>`;
    const needCard = card('Necesidad de pedidos', 'Indicador operativo, no genera alertas emergentes.', coverage, needMessage, true);
    view.innerHTML = `<section class="adm-section summary active" data-adm-section="summary">${intro}${kpis}<div class="adm-grid">${scheduledCard}${lateCard}${riskCard}${operatorCard}${needCard}</div></section><section class="adm-section" data-adm-section="scheduled"><div class="adm-grid">${card('Recientes programados', 'Todas las próximas entregas activas.', data.scheduled.length, list(data.scheduled, '', 'No hay pedidos programados con fecha futura.'), true)}</div></section><section class="adm-section" data-adm-section="late"><div class="adm-grid">${card('Pedidos atrasados', 'Todos los vencidos que siguen en proceso.', data.late.length, list(data.late, 'late', 'No hay pedidos atrasados.'), true)}</div></section><section class="adm-section" data-adm-section="operators"><div class="adm-grid">${card('Operarios más eficientes', 'Finalizaciones de la última semana.', data.operators.length, operatorsMarkup(data.operators), true)}</div></section><section class="adm-section" data-adm-section="risk"><div class="adm-grid">${card('Pedidos probablemente en riesgo', 'Entrega dentro de 4 días o menos y procesos pendientes.', data.risk.length, list(data.risk, 'risk', 'No hay pedidos en riesgo para los próximos 4 días.'), true)}</div></section><section class="adm-section" data-adm-section="need"><div class="adm-grid">${needCard}</div></section>`;
    if (window.Motion && typeof window.Motion.animate === 'function') window.Motion.animate('.admin-dashboard .adm-kpi,.admin-dashboard .adm-card', { opacity: [0, 1], y: [12, 0] }, { duration: .36, delay: window.Motion.stagger ? window.Motion.stagger(.035) : 0 });
  }

  async function open(trigger) {
    ensurePanel(); lastFocus = trigger || document.activeElement; panel.hidden = false; document.body.style.overflow = 'hidden'; showTab('summary');
    const status = panel.querySelector('[data-adm-status]'); const views = panel.querySelector('[data-adm-views]');
    status.classList.remove('error'); status.innerHTML = '<i></i><span>Cargando todas las áreas al mismo tiempo…</span>';
    views.innerHTML = '<div class="adm-skeleton"></div><div class="adm-skeleton"></div>';
    try {
      const [productionResponse, operatorsResponse] = await Promise.all([fetch('/api/produccion', { cache: 'no-store' }), fetch('/api/produccion/operarios', { cache: 'no-store' })]);
      if (!productionResponse.ok || !operatorsResponse.ok) throw new Error('No fue posible actualizar la información');
      render(modelFrom(await productionResponse.json(), await operatorsResponse.json()));
      status.innerHTML = `<i></i><span>Información actualizada ${new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</span>`;
    } catch (error) {
      views.innerHTML = '<div class="adm-message">No pudimos cargar el dashboard en este momento. Intenta de nuevo en unos segundos.</div>';
      status.classList.add('error'); status.innerHTML = '<i></i><span>Sin conexión con los datos de producción.</span>';
    }
  }

  document.addEventListener('click', event => { const trigger = event.target.closest('#open-dashboard-administrativo'); if (trigger) { event.preventDefault(); open(trigger); } });
})();
