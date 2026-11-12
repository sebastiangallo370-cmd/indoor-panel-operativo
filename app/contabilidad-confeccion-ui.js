/* Panel privado de contabilidad de confección: usa la copia persistente del VPS. */
(() => {
  'use strict';
  const PANEL = '.contabilidad-confeccion-panel';
  const num = v => Number(String(v || '').replace(/[^0-9]/g, '')) || 0;
  const money = v => '$ ' + Math.round(v || 0).toLocaleString('es-CO');
  const pct = (a, b) => b ? Math.max(0, Math.min(100, a / b * 100)) : 0;
  const data = panel => {
    const cards = [...panel.querySelectorAll('.cc-kpis .cc-card')];
    if (cards.length < 4) return null;
    return { cards, orders:num(cards[0].querySelector('b')?.textContent), sent:num(cards[1].querySelector('b')?.textContent), received:num(cards[1].querySelector('span')?.textContent), total:num(cards[2].querySelector('b')?.textContent), due:num(cards[3].querySelector('b')?.textContent), paid:num(cards[3].querySelector('span')?.textContent) };
  };
  function liquid(el, value, tone) {
    el.setAttribute('data-lq', String(Math.round(value))); el.setAttribute('data-lq-tone', tone); el.setAttribute('data-lq-nopct', '');
    window.__liquidStats?.upgrade?.(el);
  }
  function enhance(panel) {
    const d = data(panel); if (!d) return;
    const pending = Math.max(0, d.sent - d.received), receivedRate = pct(d.received, d.sent), paidRate = pct(d.paid, d.total), balanceRate = pct(d.due, d.total);
    const [orders, units, produced, balance] = d.cards;
    orders.querySelector('small').textContent = 'PEDIDOS 2026'; orders.querySelector('span').textContent = `${d.orders.toLocaleString('es-CO')} envíos registrados`;
    units.querySelector('small').textContent = 'UNIDADES ENTREGADAS'; units.querySelector('span').textContent = `${d.received.toLocaleString('es-CO')} recibidas · ${pending.toLocaleString('es-CO')} pendientes`;
    produced.querySelector('small').textContent = 'VALOR PRODUCIDO'; produced.querySelector('span').textContent = 'Confección recibida en 2026';
    balance.querySelector('small').textContent = 'SALDO POR PAGAR'; balance.querySelector('span').textContent = `${money(d.paid)} pagado · ${Math.round(paidRate)}% cubierto`;
    liquid(orders, 100, 'azul'); liquid(units, receivedRate, pending ? 'ambar' : 'verde'); liquid(produced, 100, 'teal'); liquid(balance, balanceRate, balanceRate ? 'rojo' : 'verde');
    let alerts = panel.querySelector('.cc-alertas');
    if (!alerts) { alerts = document.createElement('section'); alerts.className = 'cc-alertas'; panel.querySelector('.cc-kpis')?.insertAdjacentElement('afterend', alerts); }
    alerts.innerHTML = `<article class="cc-alerta ${pending ? 'warn' : 'ok'}"><i>${pending ? '↳' : '✓'}</i><div><small>ENTREGAS</small><b>${pending ? `${pending.toLocaleString('es-CO')} unidades aún por recibir` : 'Todas las unidades recibidas'}</b><span>${Math.round(receivedRate)}% de las unidades enviadas ya regresaron al taller.</span></div></article><article class="cc-alerta ${balanceRate ? 'risk' : 'ok'}"><i>${balanceRate ? '$' : '✓'}</i><div><small>PAGOS</small><b>${balanceRate ? `${money(d.due)} pendiente de pago` : 'Sin saldo pendiente'}</b><span>${money(d.paid)} pagado de ${money(d.total)} producido en 2026.</span></div></article>`;
    const rows = [...panel.querySelectorAll('.cc-bloque:last-of-type .cc-fila')], values = rows.map(row => num(row.querySelector('b')?.textContent));
    rows.forEach((row, i) => { if (!row.querySelector('.cc-rank')) { const rank=document.createElement('em'), meta=document.createElement('small'); rank.className='cc-rank'; meta.className='cc-meta'; row.prepend(rank); row.append(meta); } row.querySelector('.cc-rank').textContent=i+1; row.querySelector('.cc-meta').textContent=`${Math.round(pct(values[i],d.total))}% del total`; });
    panel.classList.add('cc-mejorado');
  }
  function updateSummary(root, d, pending, receivedRate, balanceRate) {
    if (!root) return;
    const signature = [d.orders,d.sent,d.received,d.total,d.due,d.paid].join('|'); let box = root.querySelector('#cc-home-summary');
    if (!box) { box=document.createElement('section'); box.id='cc-home-summary'; root.appendChild(box); }
    if (box.dataset.signature === signature) return; box.dataset.signature=signature;
    box.innerHTML = `<header><div><span>CONFECCIÓN · 2026</span><h3>Resumen anual de todas las confeccionistas</h3></div><p>Fuente: copia persistente de contabilidad.</p></header><div class="cc-home-kpis"><article data-lq="100" data-lq-tone="azul" data-lq-nopct><small>PEDIDOS</small><b>${d.orders.toLocaleString('es-CO')}</b><span>envíos registrados</span></article><article data-lq="100" data-lq-tone="teal" data-lq-nopct><small>UNIDADES ENVIADAS</small><b>${d.sent.toLocaleString('es-CO')}</b><span>${d.received.toLocaleString('es-CO')} recibidas</span></article><article data-lq="${Math.round(receivedRate)}" data-lq-tone="${pending ? 'ambar' : 'verde'}" data-lq-nopct><small>POR RECIBIR</small><b>${pending.toLocaleString('es-CO')}</b><span>${Math.round(receivedRate)}% ya regresó</span></article><article data-lq="100" data-lq-tone="violeta" data-lq-nopct><small>VALOR PRODUCIDO</small><b>${money(d.total)}</b><span>acumulado en 2026</span></article><article data-lq="${Math.round(balanceRate)}" data-lq-tone="${balanceRate ? 'rojo' : 'verde'}" data-lq-nopct><small>SIN MARCA DE PAGO</small><b>${money(d.due)}</b><span>${money(d.paid)} con pago registrado</span></article></div><div class="cc-home-note"><b>TIEMPO POR PRENDA</b><span>Se mostrará cuando el origen tenga fecha de envío y de recepción; así evitamos calcular un promedio estimado.</span></div>`;
    box.querySelectorAll('[data-lq]').forEach(el => window.__liquidStats?.upgrade?.(el));
  }
  const clean = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const shortMoney = value => value >= 1000000 ? `$${(value / 1000000).toLocaleString('es-CO',{maximumFractionDigits:1})} M` : money(value);
  const day = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}) : 'Sin fecha';
  function monthlyChart(payload, mode='units') {
    const chart = document.querySelector('#cc-monthly-chart'); if (!chart) return;
    const data = payload.monthly || [];
    const unitMode = mode === 'units';
    const maximum = Math.max(1, ...data.flatMap(item => unitMode ? [item.sent, item.received] : [item.amount]));
    chart.dataset.mode = mode;
    chart.innerHTML = data.map(item => {
      const sent = Math.round(item.sent / maximum * 100), received = Math.round(item.received / maximum * 100), amount = Math.round(item.amount / maximum * 100);
      const title = unitMode ? `${months[item.month - 1]}: ${item.sent.toLocaleString('es-CO')} enviadas, ${item.received.toLocaleString('es-CO')} recibidas` : `${months[item.month - 1]}: ${money(item.amount)} producido`;
      return `<div class="cc-month" title="${clean(title)}"><div class="cc-month-bars">${unitMode ? `<i class="cc-bar-sent" style="height:${sent}%"></i><i class="cc-bar-received" style="height:${received}%"></i>` : `<i class="cc-bar-amount" style="height:${amount}%"></i>`}</div><span>${months[item.month - 1]}</span></div>`;
    }).join('');
  }
  function analytics(payload, root) {
    const s = payload.summary, makers = payload.makers || [], products = payload.products || [], pending = payload.pending || [];
    if (!root) return;
    let box = root.querySelector('#cc-home-analytics');
    if (!box) { box = document.createElement('section'); box.id = 'cc-home-analytics'; root.querySelector('#cc-home-summary')?.insertAdjacentElement('afterend', box); }
    const productMax = Math.max(1, ...products.map(item => item.units));
    const makerMax = Math.max(1, ...makers.map(item => item.amount));
    const fastest = makers.filter(item => item.average_days != null).slice().sort((a,b) => a.average_days - b.average_days)[0];
    const slowest = makers.filter(item => item.average_days != null).slice().sort((a,b) => b.average_days - a.average_days)[0];
    box.innerHTML = `<div class="cc-micro-kpis"><article><small>VALOR PROMEDIO / UND.</small><b>${money(s.average_value_per_unit)}</b><span>sobre unidades recibidas</span></article><article><small>TAMAÑO PROMEDIO</small><b>${s.average_order_units.toLocaleString('es-CO')} und.</b><span>por envío registrado</span></article><article><small>RECIBIDO</small><b>${s.completion_rate.toLocaleString('es-CO')}%</b><span>de las unidades enviadas</span></article><article><small>PAGOS REGISTRADOS</small><b>${s.payment_marked_rate.toLocaleString('es-CO')}%</b><span>del valor con fecha o marca de pago</span></article></div><div class="cc-visual-grid"><article class="cc-viz cc-monthly"><header><div><small>EVOLUCIÓN 2026</small><h4>Envíos, recibidos y valor</h4></div><div class="cc-viz-actions"><button type="button" data-cc-mode="units" class="is-active">Unidades</button><button type="button" data-cc-mode="value">Valor</button></div></header><div id="cc-monthly-chart" class="cc-monthly-chart"></div><footer><span><i class="cc-key sent"></i>Enviadas</span><span><i class="cc-key received"></i>Recibidas</span><span class="cc-value-key"><i class="cc-key amount"></i>Valor producido</span></footer></article><article class="cc-viz cc-payment"><header><div><small>ESTADO DE PAGO</small><h4>Registros de pago</h4></div></header><div class="cc-ring" style="--cc-ring:${Math.max(0,Math.min(100,s.payment_marked_rate))}%"><div><b>${s.payment_marked_rate.toLocaleString('es-CO')}%</b><span>registrado</span></div></div><dl><div><dt>Con marca de pago</dt><dd>${money(s.paid)}</dd></div><div><dt>Sin marca de pago</dt><dd>${money(s.pending_payment)}</dd></div></dl><p>La fecha o marca de pago se tomó de la copia persistente de contabilidad.</p></article></div><div class="cc-visual-grid cc-bottom-grid"><article class="cc-viz"><header><div><small>VOLUMEN POR TALLER</small><h4>Valor producido y tiempo</h4></div></header><div class="cc-maker-bars">${makers.map(maker => `<div class="cc-maker-bar"><div><b>${clean(maker.name)}</b><span>${maker.received.toLocaleString('es-CO')} und. · ${maker.average_days ?? '—'} días</span></div><i><em style="width:${Math.round(maker.amount / makerMax * 100)}%"></em></i><strong>${shortMoney(maker.amount)}</strong></div>`).join('')}</div><footer class="cc-speed-note"><span>Más ágil: <b>${fastest ? `${clean(fastest.name)} · ${fastest.average_days} días` : 'Sin datos'}</b></span><span>Mayor tiempo: <b>${slowest ? `${clean(slowest.name)} · ${slowest.average_days} días` : 'Sin datos'}</b></span></footer></article><article class="cc-viz"><header><div><small>PRODUCTOS CON MÁS VOLUMEN</small><h4>Unidades recibidas</h4></div></header><div class="cc-product-bars">${products.map(product => `<div><span title="${clean(product.name)}">${clean(product.name)}</span><i><em style="width:${Math.round(product.units / productMax * 100)}%"></em></i><b>${product.units.toLocaleString('es-CO')}</b></div>`).join('')}</div></article></div><article class="cc-viz cc-pending"><header><div><small>SEGUIMIENTO</small><h4>Unidades aún fuera del taller</h4></div><span>${pending.length ? `${s.pending_units.toLocaleString('es-CO')} und. pendientes` : 'Sin pendientes'}</span></header>${pending.length ? `<div class="cc-pending-list">${pending.map(row => `<div class="${row.age_days > 30 ? 'is-aged' : ''}"><b>${clean(row.maker)}</b><span>${row.units.toLocaleString('es-CO')} und. · ${clean(row.product)}${row.reference ? ` · ${clean(row.reference)}` : ''}</span><small>Enviadas ${day(row.sent_date)} · ${row.age_days ?? '—'} días</small></div>`).join('')}</div>` : '<p class="cc-empty">No hay unidades pendientes de devolución.</p>'}</article>`;
    monthlyChart(payload);
    box.querySelectorAll('[data-cc-mode]').forEach(button => button.addEventListener('click', () => { box.querySelectorAll('[data-cc-mode]').forEach(item => item.classList.toggle('is-active', item === button)); monthlyChart(payload, button.dataset.ccMode); }));
    liquidationOverview(box, makers.flatMap(maker => (maker.details || []).map(row => ({...row, maker:maker.name}))));
  }
  function openAccounting(panel) {
    document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === panel));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    const userMenu = document.querySelector('.user-menu'); if (userMenu) userMenu.open = false;
    const root = panel?.querySelector('#cc-accounting');
    if (root) { setAccountingLoading(root, true, 'Actualizando datos del VPS…'); loadExcel(); }
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  function setAccountingLoading(root, active, label='Cargando contabilidad…') {
    if (!root) return;
    let overlay = root.querySelector('.cc-loading-overlay');
    if (active && !overlay) {
      overlay = document.createElement('div'); overlay.className = 'cc-loading-overlay'; overlay.setAttribute('role', 'status');
      overlay.innerHTML = '<div class="cc-loading-card"><i aria-hidden="true"></i><div><b>Contabilidad confección</b><span></span></div></div>';
      root.appendChild(overlay);
    }
    root.classList.toggle('cc-is-loading', active); root.setAttribute('aria-busy', String(active));
    if (!overlay) return;
    overlay.querySelector('span').textContent = label; overlay.classList.toggle('is-visible', active); overlay.setAttribute('aria-hidden', String(!active));
  }
  function clearAccountingRoot(root) {
    const overlay = root.querySelector('.cc-loading-overlay'); root.innerHTML = ''; if (overlay) root.appendChild(overlay);
  }
  function renderAccountingTab(payload, selected) {
    const root = accountingPanel();
    setAccountingLoading(root, true, selected === 'inicio' ? 'Cargando resumen general…' : `Cargando ${selected.replace(/^maker:/, '')}…`);
    window.setTimeout(() => renderExcel(payload, selected), 240);
  }
  function accountingPanel() {
    let panel = document.querySelector('.panel[data-panel="contabilidad-confeccion"]');
    if (!panel) {
      panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'contabilidad-confeccion';
      panel.innerHTML = '<div id="cc-accounting" class="cc-accounting-shell"></div>';
      document.querySelector('main')?.appendChild(panel);
    }
    const menu = document.querySelector('.user-dropdown');
    if (menu && !menu.querySelector('#open-contabilidad-confeccion')) {
      const entry = document.createElement('button'); entry.type = 'button'; entry.id = 'open-contabilidad-confeccion'; entry.className = 'cc-accounting-entry'; entry.textContent = 'Contabilidad confección';
      entry.addEventListener('click', () => openAccounting(panel));
      menu.insertBefore(entry, menu.querySelector('a[href="/logout"]') || null);
    }
    return panel.querySelector('#cc-accounting');
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const dateValue = value => value ? new Date(`${value}T12:00:00`) : null;
  const dateAge = value => { const item = dateValue(value), now = dateValue(today()); return item && now ? Math.max(0, Math.round((now - item) / 86400000)) : null; };
  function rowsForDate(rows, kind, from, to) {
    if (!from && !to) return rows;
    return rows.filter(row => {
      const current = row[kind];
      return current && (!from || current >= from) && (!to || current <= to);
    });
  }
  function rowSummary(rows) {
    const sent = rows.reduce((total, row) => total + Number(row.sent || 0), 0), received = rows.reduce((total, row) => total + Number(row.received || 0), 0), amount = rows.reduce((total, row) => total + Number(row.amount || 0), 0), paid = rows.filter(row => row.paid).reduce((total, row) => total + Number(row.amount || 0), 0);
    const timed = rows.filter(row => row.sent_date && row.received_date && row.received > 0).map(row => ({days: Math.max(0, Math.round((dateValue(row.received_date) - dateValue(row.sent_date)) / 86400000)), units:Number(row.received)}));
    const timedUnits = timed.reduce((total, row) => total + row.units, 0);
    return {orders:rows.length, sent, received, amount, paid, pendingUnits:Math.max(0, sent - received), pendingPayment:Math.max(0, amount - paid), completion:pct(received, sent), paymentRate:pct(paid, amount), averageDays:timedUnits ? timed.reduce((total, row) => total + row.days * row.units, 0) / timedUnits : null, averageValue:received ? amount / received : 0};
  }
  function makerMonthly(rows) {
    const monthly = Array.from({length:12}, (_, index) => ({month:index + 1,sent:0,received:0,amount:0}));
    rows.forEach(row => { const sent=dateValue(row.sent_date), received=dateValue(row.received_date); if (sent) { monthly[sent.getMonth()].sent += Number(row.sent || 0); } if (received) { monthly[received.getMonth()].received += Number(row.received || 0); monthly[received.getMonth()].amount += Number(row.amount || 0); } });
    return monthly;
  }
  function makerMonthlyChart(root, rows, mode='units') {
    const chart = root.querySelector('.cc-maker-monthly-chart'); if (!chart) return;
    const monthly = makerMonthly(rows), units = mode === 'units', max = Math.max(1, ...monthly.flatMap(item => units ? [item.sent,item.received] : [item.amount]));
    chart.dataset.mode=mode; chart.innerHTML=monthly.map(item => { const sent=Math.round(item.sent/max*100), received=Math.round(item.received/max*100), amount=Math.round(item.amount/max*100); const title=units ? `${months[item.month-1]}: ${item.sent.toLocaleString('es-CO')} enviadas, ${item.received.toLocaleString('es-CO')} recibidas` : `${months[item.month-1]}: ${money(item.amount)} recibido`; return `<div class="cc-month" title="${clean(title)}"><div class="cc-month-bars">${units ? `<i class="cc-bar-sent" style="height:${sent}%"></i><i class="cc-bar-received" style="height:${received}%"></i>` : `<i class="cc-bar-amount" style="height:${amount}%"></i>`}</div><span>${months[item.month - 1]}</span></div>`; }).join('');
  }
  function productionDetail(root, rows) {
    const section = document.createElement('section'); section.className = 'cc-production-detail';
    const columns = ['Cliente / proyecto','Cotización','Referencia','Descripción','Envío','Entrega','Enviadas','Recibidas','Vr. unidad','Valor','Pago'];
    section.innerHTML = `<header><div><small>PRODUCCIÓN ENVIADA</small><h4>Detalle completo de prendas y órdenes</h4><p>${rows.length.toLocaleString('es-CO')} registros cargados desde la copia persistente.</p></div><strong>${rows.reduce((total,row)=>total + Number(row.sent || 0),0).toLocaleString('es-CO')} und. enviadas</strong></header><div class="cc-detail-table"><div class="cc-detail-row cc-detail-head">${columns.map(column=>`<span>${column}</span>`).join('')}</div>${rows.map((row,index)=>`<div class="cc-detail-row" style="--cc-i:${index}"><span title="${clean(row.client || '')}">${clean(row.client || 'Sin cliente')}</span><span>${clean(row.quote || '—')}</span><span>${clean(row.reference || '—')}</span><span title="${clean(row.product || '')}">${clean(row.product || 'Sin descripción')}</span><span>${day(row.sent_date)}</span><span>${day(row.received_date)}</span><span>${Number(row.sent || 0).toLocaleString('es-CO')}</span><span>${Number(row.received || 0).toLocaleString('es-CO')}</span><span>${money(row.unit_value)}</span><strong>${money(row.amount)}</strong><em class="${row.paid ? 'is-paid' : 'is-due'}">${clean(row.payment || (row.paid ? 'Registrado' : 'Pendiente'))}</em></div>`).join('') || '<p class="cc-empty">No hay producción para este filtro.</p>'}</div>`;
    root.appendChild(section);
  }
  function fortnightInfo(value) {
    const current = dateValue(value); if (!current) return null;
    const year = current.getFullYear(), month = current.getMonth(), startDay = current.getDate() <= 14 ? 1 : 15;
    const endDay = startDay === 1 ? 14 : new Date(year, month + 1, 0).getDate();
    const pad = item => String(item).padStart(2, '0');
    return {key:`${year}-${pad(month + 1)}-${pad(startDay)}`, start:`${year}-${pad(month + 1)}-${pad(startDay)}`, end:`${year}-${pad(month + 1)}-${pad(endDay)}`, label:`${startDay}–${endDay} ${months[month]} ${year}`};
  }
  function liquidationGroups(rows) {
    const groups = new Map();
    rows.filter(row => !row.paid && Number(row.received || 0) > 0 && Number(row.amount || 0) > 0).forEach(row => {
      const period = fortnightInfo(row.received_date); if (!period) return;
      const group = groups.get(period.key) || {...period, rows:[], amount:0, units:0};
      group.rows.push(row); group.amount += Number(row.amount || 0); group.units += Number(row.received || 0); groups.set(period.key, group);
    });
    return [...groups.values()].map(group => ({...group, orders:group.rows.length})).sort((a,b) => b.key.localeCompare(a.key));
  }
  function liquidationRows(rows) {
    return rows.map((row,index) => {
      const age = dateAge(row.received_date), amount = Number(row.amount || 0), units = Number(row.received || 0);
      const sent = Number(row.sent || 0), unitValue = Number(row.unit_value || 0);
      return `<div class="cc-payment-row cc-liquidation-payment-row" data-cc-payment-row data-date="${clean(row.received_date || '')}" data-units="${units}" data-amount="${amount}" data-age="${age == null ? 0 : age}" style="--cc-i:${index}"><span title="${clean(row.client || '')}">${clean(row.client || 'Sin cliente')}</span><span>${clean(row.quote || '—')}</span><span title="${clean(row.product || '')}"><b>${clean(row.product || 'Sin descripción')}</b><small>${row.reference ? `Ref. ${clean(row.reference)}` : ''}</small></span><span>${day(row.sent_date)}</span><span>${day(row.received_date)}</span><span>${sent.toLocaleString('es-CO')}</span><span>${units.toLocaleString('es-CO')}</span><span>${money(unitValue)}</span><strong>${money(amount)}</strong><em class="${age > 30 ? 'is-aged' : ''}">${age == null ? 'Sin fecha' : `${age} días`}</em></div>`;
    }).join('');
  }
  function bindLiquidationControls(section) {
    const groups = [...section.querySelectorAll('.cc-liquidation-group')], search = section.querySelector('[data-cc-liquidation-search]'), sort = section.querySelector('[data-cc-liquidation-sort]'), result = section.querySelector('[data-cc-liquidation-result]');
    const apply = () => {
      const query = (search?.value || '').trim().toLocaleLowerCase('es'), mode = sort?.value || 'date', quick = section.querySelector('[data-cc-liquidation-filter].is-active')?.dataset.ccLiquidationFilter || 'all';
      let visibleRows = 0, visibleAmount = 0;
      groups.forEach(group => {
        const rows = [...group.querySelectorAll('[data-cc-payment-row]')];
        const ordered = rows.slice().sort((a,b) => {
          const av = mode === 'date' ? (a.dataset.date || '') : Number(a.dataset[mode] || 0), bv = mode === 'date' ? (b.dataset.date || '') : Number(b.dataset[mode] || 0);
          return mode === 'date' ? bv.localeCompare(av) : bv - av;
        });
        ordered.forEach(row => row.parentElement.appendChild(row));
        let count = 0, amount = 0;
        rows.forEach(row => {
          const age = Number(row.dataset.age || 0), matchesText = !query || row.textContent.toLocaleLowerCase('es').includes(query), matchesQuick = quick === 'all' || (quick === 'aged' ? age > 30 : age > 90);
          row.hidden = !(matchesText && matchesQuick); if (!row.hidden) { count += 1; amount += Number(row.dataset.amount || 0); }
        });
        group.hidden = count === 0; visibleRows += count; visibleAmount += amount;
        const meta = group.querySelector('[data-cc-group-meta]'); if (meta) meta.textContent = `${count.toLocaleString('es-CO')} visibles · ${Number(group.dataset.units || 0).toLocaleString('es-CO')} und.`;
      });
      if (result) result.textContent = `${visibleRows.toLocaleString('es-CO')} registros · ${money(visibleAmount)}`;
    };
    [search, sort].filter(Boolean).forEach(control => control.addEventListener('input', apply));
    section.querySelectorAll('[data-cc-liquidation-filter]').forEach(button => button.addEventListener('click', () => { section.querySelectorAll('[data-cc-liquidation-filter]').forEach(item => item.classList.toggle('is-active', item === button)); apply(); }));
    section.querySelector('[data-cc-open-all]')?.addEventListener('click', () => groups.filter(group => !group.hidden).forEach(group => { group.open = true; }));
    section.querySelector('[data-cc-close-all]')?.addEventListener('click', () => groups.forEach(group => { group.open = false; }));
    section.querySelectorAll('[data-cc-payment-row]').forEach(row => row.addEventListener('click', () => row.classList.toggle('is-focused')));
    apply();
  }
  function liquidationPlan(rows) {
    const section = document.createElement('section'); section.className = 'cc-liquidation-plan';
    const groups = liquidationGroups(rows), total = groups.reduce((sum, group) => sum + group.amount, 0), first = groups[0];
    section.innerHTML = `<header><div><small>LIQUIDACIÓN QUINCENAL</small><h4>Cada 2 semanas · prendas recibidas sin pago</h4><p>Se agrupa por quincena calendario: del 1 al 14 y del 15 al último día de cada mes.</p></div><strong>${money(total)}</strong></header><div class="cc-liquidation-kpis"><article><small>CICLOS PENDIENTES</small><b>${groups.length.toLocaleString('es-CO')}</b><span>${first ? `Último ciclo: ${first.label}` : 'Sin saldos pendientes'}</span></article><article><small>UNIDADES POR LIQUIDAR</small><b>${groups.reduce((sum, group) => sum + group.units, 0).toLocaleString('es-CO')}</b><span>recibidas y sin marca de pago</span></article><article><small>PRÓXIMA LIQUIDACIÓN</small><b>${first ? first.label : '—'}</b><span>${first ? `${first.orders.toLocaleString('es-CO')} registros` : 'No hay registros'}</span></article></div>${groups.length ? `<div class="cc-liquidation-controls"><label><span>Buscar referencia o prenda</span><input type="search" data-cc-liquidation-search placeholder="Ej. A300, peto, uniforme" aria-label="Buscar en la liquidación"></label><label><span>Ordenar</span><select data-cc-liquidation-sort aria-label="Ordenar registros"><option value="date">Entrega más reciente</option><option value="amount">Mayor valor</option><option value="units">Más unidades</option><option value="age">Mayor antigüedad</option></select></label><div class="cc-liquidation-filter"><button type="button" class="is-active" data-cc-liquidation-filter="all">Todos</button><button type="button" data-cc-liquidation-filter="aged">Más de 30 días</button><button type="button" data-cc-liquidation-filter="very-aged">Más de 90 días</button></div><div class="cc-liquidation-view"><button type="button" data-cc-open-all>Expandir</button><button type="button" data-cc-close-all>Contraer</button></div><output data-cc-liquidation-result aria-live="polite"></output></div><div class="cc-liquidation-groups">${groups.map((group,index) => `<details class="cc-liquidation-group" data-units="${group.units}" ${index === 0 ? 'open' : ''}><summary><span><b>${group.label}</b><small data-cc-group-meta>${group.orders.toLocaleString('es-CO')} registros · ${group.units.toLocaleString('es-CO')} und.</small><i class="cc-liquidation-progress"><em style="width:${total ? Math.max(2, Math.round(group.amount / total * 100)) : 0}%"></em></i></span><strong>${money(group.amount)}</strong></summary><div class="cc-payment-table"><div class="cc-payment-row cc-payment-head"><span>Cliente / proyecto</span><span>Cotización</span><span>Descripción del producto</span><span>Fecha envío</span><span>Fecha entrega</span><span>Und. enviadas</span><span>Und. recibidas</span><span>Valor unidad</span><span>Valor</span><span>Antigüedad</span></div>${liquidationRows(group.rows)}</div></details>`).join('')}</div>` : '<p class="cc-empty">No hay prendas recibidas pendientes de liquidación.</p>'}`;
    bindLiquidationControls(section);
    return section;
  }
  function liquidationOverview(root, rows) {
    if (!root) return;
    let section = root.querySelector('.cc-liquidation-overview');
    if (!section) { section = document.createElement('section'); section.className = 'cc-liquidation-overview'; root.appendChild(section); }
    const groups = liquidationGroups(rows), currentKey = section.querySelector('[data-cc-liquidation-period]')?.value, selected = groups.find(group => group.key === currentKey) || groups[0];
    const makerNames = [...new Set(rows.map(row => row.maker).filter(Boolean))];
    const makerTotals = makerNames.map(name => { const detail = (selected?.rows || []).filter(row => row.maker === name); return {name, amount:detail.reduce((sum,row) => sum + Number(row.amount || 0), 0), units:detail.reduce((sum,row) => sum + Number(row.received || 0), 0), orders:detail.length}; }).sort((a,b) => b.amount - a.amount);
    section.innerHTML = `<header><div><small>LIQUIDACIÓN QUINCENAL</small><h4>Pago de todas las confeccionistas</h4><p>Una liquidación cada 2 semanas, agrupada por fecha de entrega.</p></div><label>Ciclo <select data-cc-liquidation-period aria-label="Seleccionar ciclo de liquidación">${groups.map(group => `<option value="${group.key}" ${selected?.key === group.key ? 'selected' : ''}>${group.label}</option>`).join('')}</select></label></header>${selected ? `<div class="cc-liquidation-overview-total"><strong>${money(selected.amount)}</strong><span>${selected.units.toLocaleString('es-CO')} unidades · ${selected.orders.toLocaleString('es-CO')} registros · ${selected.label}</span></div><div class="cc-liquidation-maker-list">${makerTotals.map(maker => `<article><div><b>${clean(maker.name)}</b><span>${maker.orders ? `${maker.orders} registros · ${maker.units.toLocaleString('es-CO')} und.` : 'Sin saldo en este ciclo'}</span></div><strong>${money(maker.amount)}</strong></article>`).join('')}</div>` : '<p class="cc-empty">No hay saldos pendientes para liquidar.</p>'}`;
    section.querySelector('[data-cc-liquidation-period]')?.addEventListener('change', () => liquidationOverview(root, rows));
  }
  function replayAccountingMotion(root) {
    if (!root) return;
    const nodes = [...root.querySelectorAll('.cc-home-kpis article,.cc-maker-metrics article,.cc-micro-kpis article,.cc-viz,.cc-payment-plan,.cc-liquidation-plan,.cc-liquidation-overview,.cc-production-detail')];
    nodes.forEach((node,index) => { node.style.setProperty('--cc-i', index); node.classList.remove('cc-motion-enter'); void node.offsetWidth; node.classList.add('cc-motion-enter'); });
  }
  function makerDashboard(root, maker, rows, filterLabel) {
    const summary = rowSummary(rows), pending = rows.filter(row => !row.paid && Number(row.amount || 0) > 0 && Number(row.received || 0) > 0).sort((a,b) => String(a.received_date || '').localeCompare(String(b.received_date || ''))), products = Object.values(rows.reduce((grouped,row) => { const key=row.product || 'Sin descripción'; grouped[key] ||= {name:key,units:0,amount:0}; grouped[key].units += Number(row.received || 0); grouped[key].amount += Number(row.amount || 0); return grouped; }, {})).filter(item => item.units || item.amount).sort((a,b) => b.units-a.units).slice(0,6), productMax=Math.max(1,...products.map(item=>item.units));
    const pendingRate=pct(summary.pendingUnits,summary.sent), balanceRate=pct(summary.pendingPayment,summary.amount);
    root.innerHTML = `<div class="cc-home-kpis"><article data-lq="100" data-lq-tone="azul" data-lq-nopct><small>PEDIDOS</small><b>${summary.orders.toLocaleString('es-CO')}</b><span>${filterLabel}</span></article><article data-lq="${Math.round(summary.completion)}" data-lq-tone="teal" data-lq-nopct><small>UNIDADES RECIBIDAS</small><b>${summary.received.toLocaleString('es-CO')}</b><span>de ${summary.sent.toLocaleString('es-CO')} enviadas</span></article><article data-lq="${Math.round(pendingRate)}" data-lq-tone="${summary.pendingUnits ? 'ambar' : 'verde'}" data-lq-nopct><small>POR RECIBIR</small><b>${summary.pendingUnits.toLocaleString('es-CO')}</b><span>${summary.completion.toLocaleString('es-CO',{maximumFractionDigits:1})}% ya regresó</span></article><article data-lq="100" data-lq-tone="violeta" data-lq-nopct><small>VALOR RECIBIDO</small><b>${money(summary.amount)}</b><span>en el periodo filtrado</span></article><article data-lq="${Math.round(balanceRate)}" data-lq-tone="${balanceRate ? 'rojo' : 'verde'}" data-lq-nopct><small>PENDIENTE DE PAGO</small><b>${money(summary.pendingPayment)}</b><span>${money(summary.paid)} con marca de pago</span></article></div><div class="cc-maker-metrics"><article><small>TIEMPO PROMEDIO</small><b>${summary.averageDays == null ? '—' : `${summary.averageDays.toLocaleString('es-CO',{maximumFractionDigits:1})} días`}</b><span>entre envío y entrega</span></article><article><small>VALOR PROMEDIO / UND.</small><b>${money(summary.averageValue)}</b><span>sobre unidades recibidas</span></article><article><small>RECIBIDO</small><b>${summary.completion.toLocaleString('es-CO',{maximumFractionDigits:1})}%</b><span>de lo enviado al taller</span></article><article><small>PAGO REGISTRADO</small><b>${summary.paymentRate.toLocaleString('es-CO',{maximumFractionDigits:1})}%</b><span>según la columna de pago</span></article></div><div class="cc-maker-visual-grid"><article class="cc-viz cc-maker-monthly"><header><div><small>EVOLUCIÓN INDIVIDUAL</small><h4>Envíos, recibidos y valor</h4></div><div class="cc-viz-actions"><button type="button" data-maker-mode="units" class="is-active">Unidades</button><button type="button" data-maker-mode="value">Valor</button></div></header><div class="cc-maker-monthly-chart cc-monthly-chart"></div><footer><span><i class="cc-key sent"></i>Enviadas</span><span><i class="cc-key received"></i>Recibidas</span><span class="cc-value-key"><i class="cc-key amount"></i>Valor recibido</span></footer></article><article class="cc-viz cc-payment"><header><div><small>ESTADO DE PAGO</small><h4>Registros del periodo</h4></div></header><div class="cc-ring" style="--cc-ring:${Math.max(0,Math.min(100,summary.paymentRate))}%"><div><b>${summary.paymentRate.toLocaleString('es-CO',{maximumFractionDigits:1})}%</b><span>registrado</span></div></div><dl><div><dt>Con marca de pago</dt><dd>${money(summary.paid)}</dd></div><div><dt>Por pagar</dt><dd>${money(summary.pendingPayment)}</dd></div></dl><p>Se toma de los registros de pago guardados.</p></article><article class="cc-viz"><header><div><small>PRODUCTOS DEL TALLER</small><h4>Unidades recibidas</h4></div></header><div class="cc-product-bars">${products.map(product=>`<div><span title="${clean(product.name)}">${clean(product.name)}</span><i><em style="width:${Math.round(product.units/productMax*100)}%"></em></i><b>${product.units.toLocaleString('es-CO')}</b></div>`).join('') || '<p class="cc-empty">No hay productos en este periodo.</p>'}</div></article></div><section class="cc-payment-plan"><header><div><small>PROGRAMACIÓN DE PAGO</small><h4>Prendas recibidas sin marca de pago</h4><p>Ordenadas por fecha de entrega. Los días indican el tiempo desde que se recibió, no una fecha de vencimiento inventada.</p></div><strong>${money(summary.pendingPayment)}</strong></header>${pending.length ? `<div class="cc-payment-table"><div class="cc-payment-row cc-payment-head"><span>Fecha entrega</span><span>Referencia / producto</span><span>Unidades</span><span>Valor</span><span>Desde entrega</span></div>${pending.map(row=>`<div class="cc-payment-row"><span>${day(row.received_date)}</span><span><b>${clean(row.reference || 'Sin referencia')}</b><small>${clean(row.product)}</small></span><span>${Number(row.received || 0).toLocaleString('es-CO')}</span><strong>${money(row.amount)}</strong><em class="${dateAge(row.received_date) > 30 ? 'is-aged' : ''}">${dateAge(row.received_date) == null ? 'Sin fecha' : `${dateAge(row.received_date)} días`}</em></div>`).join('')}</div>` : '<p class="cc-empty">No hay prendas recibidas pendientes de pago para este filtro.</p>'}</section>`;
    const oldPaymentPlan = root.querySelector('.cc-payment-plan'); if (oldPaymentPlan) oldPaymentPlan.replaceWith(liquidationPlan(rows));
    productionDetail(root, rows);
    root.querySelectorAll('[data-lq]').forEach(el => window.__liquidStats?.upgrade?.(el));
    replayAccountingMotion(root);
    makerMonthlyChart(root, rows);
    root.querySelectorAll('[data-maker-mode]').forEach(button => button.addEventListener('click', () => { root.querySelectorAll('[data-maker-mode]').forEach(item=>item.classList.toggle('is-active',item===button)); makerMonthlyChart(root,rows,button.dataset.makerMode); }));
  }
  function makerSummary(root, maker) {
    const rows = maker.details || [];
    root.innerHTML = `<section class="cc-maker-summary"><form class="cc-date-filter"><label>Filtrar por <select name="kind"><option value="received_date">fecha de entrega</option><option value="sent_date">fecha de envío</option></select></label><label>Desde <input name="from" type="date"></label><label>Hasta <input name="to" type="date"></label><button type="button" data-clear-filter>Limpiar filtro</button></form><div class="cc-maker-data"></div></section>`;
    const form=root.querySelector('.cc-date-filter'), dataBox=root.querySelector('.cc-maker-data');
    const refresh=() => { const kind=form.elements.kind.value, from=form.elements.from.value, to=form.elements.to.value, filtered=rowsForDate(rows,kind,from,to); const label = from || to ? `${kind === 'received_date' ? 'entregas' : 'envíos'} ${from ? `desde ${day(from)}` : ''}${from && to ? ' ' : ''}${to ? `hasta ${day(to)}` : ''}` : 'todo 2026'; makerDashboard(dataBox,maker,filtered,label); };
    form.addEventListener('input',refresh); form.querySelector('[data-clear-filter]').addEventListener('click',()=>{ form.reset(); refresh(); }); refresh();
  }
  const ccState = {period:'year', makers:new Set(), types:new Set(), products:new Set(), drawer:false, light:false};
  function rowsWithMaker(payload) {
    return (payload.makers || []).flatMap(maker => (maker.details || []).map(row => ({...row, maker:maker.name})));
  }
  function filteredPayload(payload) {
    const all = rowsWithMaker(payload), dates=all.map(row=>dateValue(row.received_date || row.sent_date)).filter(Boolean), latest=dates.length ? new Date(Math.max(...dates)) : null;
    const monthsBack = ccState.period === 'month' ? 1 : ccState.period === 'quarter' ? 3 : 12;
    const cutoff = ccState.period === 'year' ? new Date(2026, 0, 1) : (latest ? new Date(latest.getFullYear(), latest.getMonth() - monthsBack + 1, 1) : null);
    const rows = all.filter(row => {
      const eventDate=dateValue(row.received_date || row.sent_date);
      // La API ya entrega exclusivamente filas del año 2026; por eso el período
      // anual no debe descartar envíos pendientes que aún no tienen recepción.
      return (ccState.period === 'year' ? true : (!cutoff || (eventDate && eventDate >= cutoff))) && (!ccState.makers.size || ccState.makers.has(row.maker)) && (!ccState.types.size || ccState.types.has(row.client_type)) && (!ccState.products.size || ccState.products.has(row.product_category));
    });
    const summary=rowSummary(rows), makers=(payload.makers || []).map(maker => { const detail=rows.filter(row=>row.maker===maker.name), values=rowSummary(detail); return {...maker, details:detail, orders:values.orders, sent:Math.round(values.sent), received:Math.round(values.received), pending_units:Math.round(values.pendingUnits), amount:Math.round(values.amount), paid:Math.round(values.paid), pending_payment:Math.round(values.pendingPayment), average_days:values.averageDays == null ? null : Math.round(values.averageDays * 10) / 10, completion_rate:Math.round(values.completion * 10) / 10, average_value_per_unit:Math.round(values.averageValue)}; });
    const products=Object.values(rows.reduce((out,row)=>{ const name=row.product || 'Sin descripción'; out[name] ||= {name,units:0,amount:0}; out[name].units+=Number(row.received||0); out[name].amount+=Number(row.amount||0); return out; },{})).sort((a,b)=>b.units-a.units).slice(0,8).map(item=>({...item,units:Math.round(item.units),amount:Math.round(item.amount)}));
    const pending=rows.filter(row=>Number(row.sent||0)>Number(row.received||0)).map(row=>({maker:row.maker,units:Math.round(Number(row.sent||0)-Number(row.received||0)),sent_date:row.sent_date,age_days:dateAge(row.sent_date),product:row.product,reference:row.reference})).sort((a,b)=>(b.age_days||0)-(a.age_days||0));
    return {...payload, summary:{orders:summary.orders,sent:Math.round(summary.sent),received:Math.round(summary.received),pending_units:Math.round(summary.pendingUnits),amount:Math.round(summary.amount),paid:Math.round(summary.paid),pending_payment:Math.round(summary.pendingPayment),average_days:summary.averageDays == null ? null : Math.round(summary.averageDays*10)/10,average_order_units:summary.orders ? Math.round(summary.sent/summary.orders*10)/10 : 0,average_value_per_unit:Math.round(summary.averageValue),completion_rate:Math.round(summary.completion*10)/10,payment_marked_rate:Math.round(summary.paymentRate*10)/10},makers,monthly:makerMonthly(rows).map(item=>({month:item.month,sent:Math.round(item.sent),received:Math.round(item.received),amount:Math.round(item.amount)})),products,pending};
  }
  function managerToolbar(root, payload, selected) {
    const allRows=rowsWithMaker(payload), makers=(payload.makers || []).map(item=>item.name), types=['Clubes','Academias','Colegios','Universidades','Empresas','Torneos','Ecommerce','Distribuidores'].filter(type=>allRows.some(row=>row.client_type===type)), products=['Camisetas','Conjuntos','Pantalonetas','Chaquetas','Medias','Personalizados'].filter(type=>allRows.some(row=>row.product_category===type));
    const chips=(items, selectedItems, kind)=>items.map(item=>`<button type="button" class="${selectedItems.has(item) ? 'is-selected' : ''}" data-cc-filter="${kind}" data-value="${clean(item)}" aria-pressed="${selectedItems.has(item)}">${clean(item)}</button>`).join('');
    const bar=document.createElement('section'); bar.className='cc-manager-top'; bar.innerHTML=`<div class="cc-manager-brand"><span>INDOOR SPORT · PANEL GERENCIAL</span><strong>Contabilidad confección</strong></div><div class="cc-manager-actions"><label>Periodo <select data-cc-period aria-label="Seleccionar período"><option value="month" ${ccState.period==='month'?'selected':''}>Último mes</option><option value="quarter" ${ccState.period==='quarter'?'selected':''}>Último trimestre</option><option value="year" ${ccState.period==='year'?'selected':''}>Año 2026</option></select></label><button type="button" data-cc-open-filters aria-expanded="${ccState.drawer}">Filtros</button><button type="button" data-cc-theme aria-label="Cambiar tema">◐</button><button type="button" data-cc-export aria-label="Imprimir o exportar panel">Exportar</button></div><aside class="cc-filter-drawer ${ccState.drawer?'is-open':''}" aria-label="Filtros de contabilidad"><header><div><small>FILTROS</small><h3>Refinar panel</h3></div><button type="button" data-cc-close-filters aria-label="Cerrar filtros">×</button></header><section><label>Tipo de cliente <input type="search" data-cc-search="type" placeholder="Buscar tipo"></label><div class="cc-filter-chips" data-cc-filter-list="type">${chips(types,ccState.types,'type')}</div></section><section><label>Producto <input type="search" data-cc-search="product" placeholder="Buscar producto"></label><div class="cc-filter-chips" data-cc-filter-list="product">${chips(products,ccState.products,'product')}</div></section><section><label>Confeccionista <input type="search" data-cc-search="maker" placeholder="Buscar confeccionista"></label><div class="cc-filter-chips" data-cc-filter-list="maker">${chips(makers,ccState.makers,'maker')}</div></section><footer><button type="button" data-cc-clear>Limpiar</button><button type="button" data-cc-apply>Aplicar</button></footer></aside><div class="cc-filter-scrim ${ccState.drawer?'is-open':''}" data-cc-close-filters></div>`;
    root.appendChild(bar); root.classList.toggle('cc-light',ccState.light);
    const refresh=()=>renderExcel(payload,selected);
    bar.querySelector('[data-cc-period]').addEventListener('change',event=>{ccState.period=event.target.value; refresh();});
    bar.querySelector('[data-cc-open-filters]').addEventListener('click',()=>{ccState.drawer=true; refresh();});
    bar.querySelectorAll('[data-cc-close-filters]').forEach(button=>button.addEventListener('click',()=>{ccState.drawer=false; refresh();}));
    bar.querySelector('[data-cc-theme]').addEventListener('click',()=>{ccState.light=!ccState.light; root.classList.toggle('cc-light',ccState.light);});
    bar.querySelector('[data-cc-export]').addEventListener('click',()=>window.print());
    bar.querySelectorAll('[data-cc-filter]').forEach(button=>button.addEventListener('click',()=>{const kind=button.dataset.ccFilter, set=kind==='maker'?ccState.makers:kind==='type'?ccState.types:ccState.products, value=button.dataset.value; set.has(value)?set.delete(value):set.add(value); button.classList.toggle('is-selected',set.has(value)); button.setAttribute('aria-pressed',String(set.has(value)));}));
    bar.querySelectorAll('[data-cc-search]').forEach(input=>input.addEventListener('input',()=>{const query=input.value.toLocaleLowerCase('es'), list=bar.querySelector(`[data-cc-filter-list="${input.dataset.ccSearch}"]`); list.querySelectorAll('button').forEach(button=>button.hidden=!button.textContent.toLocaleLowerCase('es').includes(query));}));
    bar.querySelector('[data-cc-clear]').addEventListener('click',()=>{ccState.makers.clear(); ccState.types.clear(); ccState.products.clear(); refresh();});
    bar.querySelector('[data-cc-apply]').addEventListener('click',()=>{ccState.drawer=false; refresh();});
  }
  function panelTabs(root, payload, selected) {
    const tabs = document.createElement('nav'); tabs.className = 'cc-accounting-tabs'; tabs.setAttribute('aria-label', 'Secciones de contabilidad de confección');
    const entries = [{key:'inicio', label:'INICIO'}, ...(payload.makers || []).map(maker => ({key:`maker:${maker.name}`, label:maker.name}))];
    tabs.innerHTML = entries.map(entry => `<button type="button" class="${entry.key === selected ? 'is-active' : ''}" data-cc-tab="${clean(entry.key)}">${clean(entry.label)}</button>`).join('');
    tabs.querySelectorAll('[data-cc-tab]').forEach(button => button.addEventListener('click', () => renderAccountingTab(payload, button.dataset.ccTab)));
    root.appendChild(tabs);
    return tabs;
  }
  function renderExcel(payload, selected='inicio') {
    const root = accountingPanel(); clearAccountingRoot(root);
    managerToolbar(root, payload, selected);
    panelTabs(root, payload, selected);
    const content = document.createElement('div'); content.id = 'cc-accounting-content'; root.appendChild(content);
    const view = filteredPayload(payload);
    if (selected !== 'inicio') {
      const source = (payload.makers || []).find(item => `maker:${item.name}` === selected);
      if (source) {
        const makerDates = (source.details || []).map(row => dateValue(row.received_date || row.sent_date)).filter(Boolean);
        const latest = makerDates.length ? new Date(Math.max(...makerDates)) : null;
        const monthsBack = ccState.period === 'month' ? 1 : ccState.period === 'quarter' ? 3 : 12;
        const cutoff = ccState.period === 'year' ? null : (latest ? new Date(latest.getFullYear(), latest.getMonth() - monthsBack + 1, 1) : null);
        const details = (source.details || []).filter(row => {
          const eventDate = dateValue(row.received_date || row.sent_date);
          return (ccState.period === 'year' ? true : (!cutoff || (eventDate && eventDate >= cutoff))) && (!ccState.types.size || ccState.types.has(row.client_type)) && (!ccState.products.size || ccState.products.has(row.product_category));
        });
        makerSummary(content, {...source, details}); setAccountingLoading(root, false); return;
      }
    }
    const s = view.summary, d = {orders:s.orders, sent:s.sent, received:s.received, total:s.amount, due:s.pending_payment, paid:s.paid};
    updateSummary(content, d, s.pending_units, pct(s.received, s.sent), pct(s.pending_payment, s.amount));
    const timeNote = content.querySelector('#cc-home-summary .cc-home-note');
    if (timeNote) timeNote.innerHTML = `<b>TIEMPO DE CONFECCIÓN</b><span>${s.average_days == null ? 'Sin suficientes fechas de envío y entrega para calcularlo.' : `${s.average_days} días promedio, ponderado por unidades, entre envío y entrega.`}</span>`;
    analytics(view, content);
    let detail = content.querySelector('#cc-home-detail');
    if (!detail) { detail=document.createElement('section'); detail.id='cc-home-detail'; const anchor=content.querySelector('#cc-home-analytics') || content.querySelector('#cc-home-summary'); anchor?.insertAdjacentElement('afterend',detail); }
    detail.innerHTML = `<details><summary>Ver detalle de confección <span>${view.makers.length} confeccionistas · ${s.average_days ?? '—'} días envío–entrega</span></summary><div class="cc-home-makers">${view.makers.map((maker, index) => `<article><em>${index + 1}</em><div><b>${clean(maker.name)}</b><span>${maker.sent.toLocaleString('es-CO')} enviadas · ${maker.received.toLocaleString('es-CO')} recibidas · ${maker.pending_units.toLocaleString('es-CO')} pendientes</span></div><strong>${money(maker.amount)}</strong><small>${maker.average_days ?? '—'} días</small></article>`).join('')}</div></details>`;
    replayAccountingMotion(content);
    setAccountingLoading(root, false);
  }
  async function loadExcel() {
    const root = accountingPanel(); setAccountingLoading(root, true, 'Cargando datos del VPS…');
    try { const response = await fetch('/api/contabilidad-confeccion', {credentials:'same-origin', cache:'no-store'}); if (!response.ok) { setAccountingLoading(root, false); return; } renderExcel(await response.json()); } catch (_) { setAccountingLoading(root, false); /* La página continúa sin bloquearse si el archivo no está disponible. */ }
  }
  const style = document.createElement('style'); style.id = 'contabilidad-confeccion-ui-style'; style.textContent = `
    .contabilidad-confeccion-panel.cc-mejorado{max-width:1880px;margin:auto;padding:clamp(12px,1.5vw,26px)}.cc-mejorado .cc-wrap{display:grid;gap:16px;padding:clamp(18px,2vw,30px);border-radius:22px;background:linear-gradient(135deg,rgba(13,30,19,.96),rgba(5,14,9,.98));box-shadow:0 22px 58px #0005}.cc-mejorado .cc-head{display:flex;justify-content:space-between;align-items:end;gap:12px;padding-bottom:14px;border-bottom:1px solid #e1ffcc24}.cc-mejorado .cc-head span{color:#d8f86c;font:900 10px Arial;letter-spacing:.16em}.cc-mejorado .cc-head h3{margin:0;font-size:clamp(1.28rem,2vw,1.75rem)}.cc-mejorado .cc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.cc-mejorado .cc-card{min-height:116px;padding:18px!important;display:flex;flex-direction:column;justify-content:center;gap:7px}.cc-mejorado .cc-card small{font:900 10px Arial;letter-spacing:.11em}.cc-mejorado .cc-card b{font-size:clamp(1.42rem,2.25vw,2.1rem);letter-spacing:-.04em}.cc-mejorado .cc-card span{font-size:.78rem!important;line-height:1.35}.cc-mejorado .cc-alertas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cc-mejorado .cc-alerta{display:flex;align-items:center;gap:12px;padding:13px 15px;border:1px solid #fff2;border-radius:14px;background:#fff1}.cc-mejorado .cc-alerta>i{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:10px;background:#2f9e4f;color:#fff;font-style:normal;font-weight:900}.cc-mejorado .cc-alerta.warn>i{background:#d38800}.cc-mejorado .cc-alerta.risk>i{background:#d94430}.cc-mejorado .cc-alerta small{display:block;color:#bdcbb7;font:900 9px Arial;letter-spacing:.13em}.cc-mejorado .cc-alerta b{display:block;margin:2px 0;font-size:.9rem}.cc-mejorado .cc-alerta span{color:#b4c2ae;font-size:.75rem}.cc-mejorado .cc-bloque{margin:0!important;padding:16px 18px!important;border:1px solid #fff2!important;border-radius:16px!important;background:#fff1!important}.cc-mejorado .cc-bloque h4{margin:0 0 14px;font-size:.78rem;letter-spacing:.08em}.cc-mejorado .cc-doble{height:12px!important;border-radius:99px;overflow:hidden}.cc-mejorado .cc-leyenda{justify-content:flex-start!important;gap:16px!important;margin-top:10px!important}.cc-mejorado .cc-fila{grid-template-columns:25px minmax(148px,190px) minmax(90px,1fr) auto 68px!important;gap:10px!important;padding:7px 0!important}.cc-mejorado .cc-rank{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#d8f86c24;color:#d8f86c;font:900 10px Arial;font-style:normal}.cc-mejorado .cc-fila>span{font-weight:800!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc-mejorado .cc-fill{background:linear-gradient(90deg,#8bd450,#d8f86c)!important}.cc-mejorado .cc-fila>b{font-size:.82rem;white-space:nowrap}.cc-mejorado .cc-meta{color:#aebda8;font:700 .67rem Arial;text-align:right;white-space:nowrap}.cc-mejorado .cc-nota{margin:0!important;text-align:center;color:#93a48e;font-size:.7rem}
    .cc-accounting-tabs{display:flex;gap:7px;overflow-x:auto;padding:10px 0 12px;scrollbar-width:thin;scrollbar-color:#d8f86c55 transparent}.cc-accounting-tabs button{width:auto!important;flex:none;border:1px solid #d8f86c35;border-radius:999px;padding:9px 13px;background:#07150dd9;color:#b9c9b3;cursor:pointer;font:850 11px Arial;letter-spacing:.035em;white-space:nowrap;transition:.18s ease}.cc-accounting-tabs button:hover{border-color:#d8f86c80;color:#efffe8}.cc-accounting-tabs button.is-active{border-color:#d8f86c;background:#d8f86c;color:#122012;box-shadow:0 6px 18px #0004}.cc-maker-summary,#cc-home-summary{display:grid;gap:13px;margin:0 0 12px;padding:20px;border:1px solid #e1ffcc33;border-radius:19px;background:linear-gradient(130deg,rgba(26,65,35,.75),rgba(8,26,15,.92));box-shadow:0 16px 36px #0003}.cc-maker-summary header,#cc-home-summary header{display:flex;justify-content:space-between;align-items:end;gap:14px}.cc-maker-summary header span,#cc-home-summary header span{display:block;color:#d8f86c;font:900 10px Arial;letter-spacing:.14em}.cc-maker-summary h3,#cc-home-summary h3{margin:4px 0 0;font-size:1.12rem}.cc-maker-summary header p,#cc-home-summary header p{margin:0;color:#b7c7b2;font-size:.74rem}.cc-date-filter{display:flex;align-items:end;flex-wrap:wrap;gap:9px;padding:11px 12px;border:1px solid #d8f86c25;border-radius:13px;background:#06150dcc}.cc-date-filter label{display:grid;gap:4px;color:#bdd0b6;font:800 9px Arial;letter-spacing:.08em}.cc-date-filter input,.cc-date-filter select{min-height:34px;border:1px solid #d8f86c38;border-radius:8px;padding:0 9px;background:#102519;color:#edf7e9;font:700 12px Arial}.cc-date-filter button{width:auto!important;min-height:34px;border:1px solid #d8f86c44;border-radius:8px;padding:0 11px;background:#d8f86c18;color:#e6fbd9;cursor:pointer;font:800 11px Arial}.cc-home-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.cc-home-kpis article{min-height:96px;padding:13px;display:flex;flex-direction:column;justify-content:center;gap:5px}.cc-home-kpis small{font:900 9px Arial;letter-spacing:.08em}.cc-home-kpis b{font-size:clamp(1.15rem,1.75vw,1.55rem);letter-spacing:-.04em}.cc-home-kpis span{font-size:.68rem!important}.cc-home-note{display:flex;gap:10px;padding:9px 12px;border:1px solid #ffbe412e;border-radius:10px;background:#ffbe4114;color:#c4d1bf;font-size:.73rem}.cc-home-note b{color:#ffd07d;font-size:.67rem;letter-spacing:.07em;white-space:nowrap}.cc-maker-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.cc-maker-metrics article{min-height:78px;padding:13px;border:1px solid #e1ffcc24;border-radius:14px;background:#07150dcc;display:grid;align-content:center;gap:4px}.cc-maker-metrics small{color:#c9dcbd;font:900 9px Arial;letter-spacing:.09em}.cc-maker-metrics b{font-size:1.02rem}.cc-maker-metrics span,.cc-maker-source{color:#aebfa7;font-size:.68rem}.cc-maker-source{margin:0;padding:10px 12px;border-radius:10px;background:#d8f86c10}.cc-maker-source b{color:#d8f86c}.cc-maker-data{display:grid;gap:12px}.cc-maker-visual-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(260px,.85fr);gap:12px}.cc-maker-visual-grid>.cc-viz:last-child{grid-column:1/-1}.cc-maker-monthly-chart{height:174px}.cc-payment-plan{border:1px solid #e1ffcc24;border-radius:16px;background:#07150ddd;overflow:hidden}.cc-payment-plan>header{display:flex;justify-content:space-between;gap:14px;padding:15px 16px;border-bottom:1px solid #ffffff12}.cc-payment-plan small{color:#c9dcbd;font:900 9px Arial;letter-spacing:.1em}.cc-payment-plan h4{margin:4px 0;font-size:.92rem}.cc-payment-plan p{margin:0;color:#9fb099;font-size:.67rem}.cc-payment-plan>header>strong{align-self:center;color:#ffd87d;white-space:nowrap}.cc-payment-table{display:grid}.cc-payment-row{display:grid;grid-template-columns:105px minmax(180px,1fr) 75px 120px 100px;gap:10px;align-items:center;padding:10px 16px;border-top:1px solid #ffffff10;font-size:.72rem}.cc-payment-head{background:#d8f86c0d;color:#b9cbb3;font:900 9px Arial;letter-spacing:.08em}.cc-payment-row span:nth-child(2) b,.cc-payment-row span:nth-child(2) small{display:block}.cc-payment-row span:nth-child(2) small{margin-top:2px;color:#9fb099;font-size:.64rem}.cc-payment-row strong{white-space:nowrap}.cc-payment-row em{justify-self:start;padding:4px 7px;border-radius:999px;background:#d8f86c17;color:#d8f86c;font:800 .64rem Arial;font-style:normal;white-space:nowrap}.cc-payment-row em.is-aged{background:#d77b2226;color:#ffd07d}#cc-home-detail{margin:0 0 20px;padding:0 16px;border:1px solid #e1ffcc24;border-radius:14px;background:#07140ccc}#cc-home-detail summary{display:flex;justify-content:space-between;gap:10px;padding:13px 0;cursor:pointer;color:#eaf4e5;font:800 .78rem Arial}#cc-home-detail summary span{color:#b7c7b2;font-weight:600}.cc-home-makers{display:grid;gap:0;padding-bottom:10px}.cc-home-makers article{display:grid;grid-template-columns:26px minmax(0,1fr) auto 65px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #ffffff12}.cc-home-makers em{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#d8f86c24;color:#d8f86c;font:900 10px Arial;font-style:normal}.cc-home-makers b,.cc-home-makers span{display:block}.cc-home-makers b{font-size:.78rem}.cc-home-makers span,.cc-home-makers small{color:#afc0aa;font-size:.67rem}.cc-home-makers strong{font-size:.75rem;white-space:nowrap}.cc-home-makers small{text-align:right;white-space:nowrap}
    #cc-home-analytics{display:grid;gap:12px;margin:0 0 12px}.cc-micro-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.cc-micro-kpis article,.cc-viz{border:1px solid #e1ffcc24;border-radius:16px;background:linear-gradient(145deg,#102519e8,#07150ddd);box-shadow:0 12px 25px #0002}.cc-micro-kpis article{min-height:76px;padding:13px;display:grid;align-content:center;gap:3px}.cc-micro-kpis small,.cc-viz header small{color:#c9dcbd;font:900 9px Arial;letter-spacing:.1em}.cc-micro-kpis b{font-size:1.05rem}.cc-micro-kpis span{color:#aebfa7;font-size:.67rem}.cc-visual-grid{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,.9fr);gap:12px}.cc-bottom-grid{grid-template-columns:minmax(0,1.35fr) minmax(280px,.75fr)}.cc-viz{padding:16px}#cc-home-analytics .cc-viz>header{display:flex!important;align-items:start;justify-content:space-between;gap:10px}#cc-home-analytics .cc-viz h4{margin:4px 0 0;font-size:.92rem}.cc-viz-actions{display:flex;gap:4px;padding:3px;border:1px solid #e1ffcc1a;border-radius:10px;background:#020a05aa}.cc-viz-actions button{border:0;border-radius:7px;padding:5px 8px;background:transparent;color:#aabca4;cursor:pointer;font:700 10px Arial}.cc-viz-actions button.is-active{background:#d8f86c;color:#142012}.cc-monthly-chart{height:174px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:5px;align-items:end;padding-top:14px;border-bottom:1px solid #ffffff1c}.cc-month{height:100%;display:grid;grid-template-rows:1fr 18px;gap:4px;text-align:center;min-width:0}.cc-month-bars{display:flex;align-items:end;justify-content:center;gap:2px;height:100%;overflow:hidden}.cc-month-bars i{display:block;min-height:2px;max-height:100%;border-radius:4px 4px 1px 1px;transition:height .32s ease}.cc-bar-sent{width:38%;background:#4d9bef}.cc-bar-received{width:38%;background:linear-gradient(#d8f86c,#7cbd43)}.cc-bar-amount{width:64%;background:linear-gradient(#d2a7ff,#7850c9)}.cc-month span{overflow:hidden;color:#9db094;font-size:9px;white-space:nowrap}.cc-viz footer{display:flex;gap:12px;align-items:center;margin-top:10px;color:#afc0aa;font-size:.68rem}.cc-key{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:99px}.cc-key.sent{background:#4d9bef}.cc-key.received{background:#a7d95b}.cc-key.amount{background:#b88aff}.cc-value-key{display:none}.cc-monthly-chart[data-mode="value"]+.x{display:none}.cc-monthly:has(.cc-monthly-chart[data-mode="value"]) .cc-value-key{display:inline}.cc-monthly:has(.cc-monthly-chart[data-mode="value"]) footer span:not(.cc-value-key){display:none}.cc-ring{--cc-ring:0%;display:grid;place-items:center;width:142px;height:142px;margin:16px auto;border-radius:50%;background:conic-gradient(#d8f86c var(--cc-ring),#344238 0);position:relative}.cc-ring:before{content:"";position:absolute;inset:12px;border-radius:50%;background:#102218}.cc-ring div{position:relative;display:grid;text-align:center}.cc-ring b{font-size:1.45rem}.cc-ring span{color:#aabca4;font-size:.67rem}.cc-payment dl{margin:4px 0 0}.cc-payment dl div{display:flex;justify-content:space-between;gap:9px;padding:8px 0;border-top:1px solid #ffffff12}.cc-payment dt{color:#b8c9b2;font-size:.72rem}.cc-payment dd{margin:0;font-weight:800;font-size:.74rem}.cc-payment p{margin:10px 0 0;color:#8fa38a;font-size:.62rem;line-height:1.35}.cc-maker-bars,.cc-product-bars{display:grid;gap:10px;margin-top:15px}.cc-maker-bar{display:grid;grid-template-columns:minmax(110px,1fr) minmax(100px,1.7fr) auto;gap:9px;align-items:center}.cc-maker-bar b,.cc-maker-bar span{display:block}.cc-maker-bar b{font-size:.72rem}.cc-maker-bar span{color:#9eb096;font-size:.61rem}.cc-maker-bar>i,.cc-product-bars i{display:block;height:8px;overflow:hidden;border:1px solid #ffffff24;border-radius:99px;background:#ffffff0d}.cc-maker-bar>i em,.cc-product-bars i em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#83c84d,#d8f86c)}.cc-maker-bar strong{font-size:.7rem;white-space:nowrap}.cc-speed-note{justify-content:space-between;border-top:1px solid #ffffff12;padding-top:10px}.cc-product-bars>div{display:grid;grid-template-columns:minmax(100px,1.1fr) minmax(90px,1.4fr) 38px;gap:9px;align-items:center}.cc-product-bars span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem}.cc-product-bars i em{background:linear-gradient(90deg,#589bf0,#8bc6ff)}.cc-product-bars b{text-align:right;font-size:.68rem}.cc-pending{padding-bottom:0}.cc-pending header>span{color:#ffd77c;font-size:.7rem;font-weight:800;white-space:nowrap}.cc-pending-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:14px -16px 0}.cc-pending-list>div{display:grid;gap:3px;padding:12px 16px;border-top:1px solid #ffffff12;border-right:1px solid #ffffff12}.cc-pending-list>div:last-child{border-right:0}.cc-pending-list b{font-size:.76rem}.cc-pending-list span,.cc-pending-list small{color:#b2c3ac;font-size:.67rem}.cc-pending-list .is-aged{background:#a45b1117}.cc-pending-list .is-aged small{color:#ffd077}.cc-empty{margin:14px 0 16px;color:#b6c8b0;font-size:.75rem}
    @media(max-width:1050px){.cc-visual-grid,.cc-bottom-grid{grid-template-columns:1fr}.cc-pending-list{grid-template-columns:1fr}}@media(max-width:950px){.cc-home-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.cc-micro-kpis,.cc-maker-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:850px){.cc-mejorado .cc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-mejorado .cc-alertas{grid-template-columns:1fr}.cc-mejorado .cc-fila{grid-template-columns:22px minmax(115px,1fr) 58px!important}.cc-mejorado .cc-fila .cc-track,.cc-mejorado .cc-meta{display:none}}@media(max-width:620px){.cc-mejorado .cc-wrap,#cc-home-summary,.cc-maker-summary{padding:15px;border-radius:16px}.cc-mejorado .cc-head,#cc-home-summary header,.cc-maker-summary header{display:block}.cc-mejorado .cc-head span,#cc-home-summary header p,.cc-maker-summary header p{display:block;margin-top:7px}.cc-home-kpis,.cc-micro-kpis,.cc-maker-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-home-note{flex-direction:column;gap:4px}.cc-mejorado .cc-card{min-height:104px;padding:13px!important}.cc-viz{padding:13px}.cc-maker-bar{grid-template-columns:minmax(95px,1fr) minmax(70px,1.2fr) auto}.cc-speed-note{display:grid!important;gap:5px}.cc-product-bars>div{grid-template-columns:minmax(90px,1fr) minmax(70px,1fr) 35px}.cc-pending-list{margin-left:-13px;margin-right:-13px}.cc-pending-list>div{padding:11px 13px}}
    @media(max-width:950px){.cc-maker-visual-grid{grid-template-columns:1fr}.cc-maker-visual-grid>.cc-viz:last-child{grid-column:auto}}@media(max-width:620px){.cc-date-filter{align-items:stretch}.cc-date-filter label{flex:1 1 130px}.cc-date-filter input,.cc-date-filter select{width:100%;box-sizing:border-box}.cc-date-filter button{flex:1 1 100%}.cc-payment-plan>header{display:grid}.cc-payment-row{grid-template-columns:80px minmax(0,1fr) 70px;gap:7px;padding:10px 12px}.cc-payment-row strong,.cc-payment-row em{grid-column:2}.cc-payment-head{display:none}.cc-payment-row span:nth-child(2){min-width:0}.cc-payment-row span:nth-child(2) b,.cc-payment-row span:nth-child(2) small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
    body:has(.panel[data-panel='contabilidad-confeccion'].active) main{width:100%!important;max-width:none!important;margin:0!important;padding-left:0!important;padding-right:0!important}body:has(.panel[data-panel='contabilidad-confeccion'].active) .footer-note{display:none}.panel[data-panel='contabilidad-confeccion'].active{display:block}.cc-accounting-shell{width:100%;max-width:none;margin:0;padding:0 20px 28px;box-sizing:border-box}.user-dropdown #open-contabilidad-confeccion{color:#d8f86c;font-weight:850}
    #cc-accounting{--cc-bg:#0b0f1a;--cc-surface:#111827;--cc-border:#1e2a3d;--cc-text:#e7edf8;--cc-muted:#98a7bd;--cc-blue:#3b9eff;--cc-coral:#ff5a5f;--cc-orange:#ff9f43;color:var(--cc-text)}#cc-accounting.cc-light{--cc-bg:#edf3fb;--cc-surface:#fff;--cc-border:#d4dfed;--cc-text:#172033;--cc-muted:#56657b;background:var(--cc-bg)}.cc-manager-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 6px;padding:12px 0 10px;border-bottom:1px solid var(--cc-border)}.cc-manager-brand{display:grid;gap:3px}.cc-manager-brand span{color:var(--cc-blue);font:900 10px Arial;letter-spacing:.16em}.cc-manager-brand strong{font-size:clamp(1rem,1.8vw,1.25rem)}.cc-manager-actions{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:7px}.cc-manager-actions label{display:flex;align-items:center;gap:6px;color:var(--cc-muted);font:800 10px Arial;text-transform:uppercase;letter-spacing:.08em}.cc-manager-actions select,.cc-manager-actions button{width:auto!important;min-height:34px;border:1px solid var(--cc-border);border-radius:8px;padding:0 10px;background:var(--cc-surface);color:var(--cc-text);font:800 11px Arial;cursor:pointer}.cc-manager-actions button:first-of-type{border-color:#3b9eff77;color:#dcecff;background:#173056}.cc-filter-scrim{position:fixed;inset:0;background:#02071199;opacity:0;pointer-events:none;transition:opacity .3s;z-index:90}.cc-filter-scrim.is-open{opacity:1;pointer-events:auto}.cc-filter-drawer{position:fixed;z-index:91;top:0;left:0;width:min(390px,92vw);height:100dvh;box-sizing:border-box;display:grid;align-content:start;gap:16px;padding:20px;background:#0d1422;border-right:1px solid #263752;box-shadow:18px 0 44px #0008;transform:translateX(-105%);transition:transform .3s ease;overflow:auto}.cc-filter-drawer.is-open{transform:translateX(0)}.cc-filter-drawer header{display:flex;justify-content:space-between;align-items:start}.cc-filter-drawer header small{color:var(--cc-blue);font:900 10px Arial;letter-spacing:.15em}.cc-filter-drawer h3{margin:4px 0 0}.cc-filter-drawer header button{width:auto!important;border:0;background:transparent;color:#fff;font-size:26px;cursor:pointer}.cc-filter-drawer section{display:grid;gap:8px}.cc-filter-drawer label{display:grid;gap:6px;color:#afbed1;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase}.cc-filter-drawer input{min-height:38px;box-sizing:border-box;border:1px solid #2a3a53;border-radius:8px;padding:0 10px;background:#111c2e;color:#edf4ff}.cc-filter-chips{display:flex;flex-wrap:wrap;gap:7px}.cc-filter-chips button{width:auto!important;border:1px solid #2a3a53;border-radius:999px;padding:7px 10px;background:#111c2e;color:#c7d3e2;font:700 11px Arial;cursor:pointer}.cc-filter-chips button.is-selected{border-color:var(--cc-blue);background:#173b68;color:#fff}.cc-filter-drawer footer{display:flex;justify-content:flex-end;gap:8px;padding-top:5px}.cc-filter-drawer footer button{width:auto!important;min-height:38px;border:1px solid #36506e;border-radius:8px;padding:0 13px;background:#172339;color:#e6effc;font:800 11px Arial;cursor:pointer}.cc-filter-drawer footer button:last-child{border-color:var(--cc-blue);background:var(--cc-blue);color:#07111f}.cc-manager-top~.cc-accounting-tabs{padding-top:12px}#cc-accounting .cc-accounting-tabs button{border-color:var(--cc-border);background:var(--cc-surface);color:var(--cc-muted)}#cc-accounting .cc-accounting-tabs button.is-active{border-color:var(--cc-blue);background:var(--cc-blue);color:#06111d}#cc-accounting .cc-maker-summary,#cc-accounting #cc-home-summary,#cc-accounting .cc-viz,#cc-accounting .cc-micro-kpis article,#cc-accounting .cc-maker-metrics article,#cc-accounting .cc-payment-plan,#cc-accounting #cc-home-detail{border-color:var(--cc-border);background:var(--cc-surface);box-shadow:0 12px 28px #00000029;color:var(--cc-text)}#cc-accounting .cc-home-kpis article{border:1px solid var(--cc-border);border-radius:12px;background:var(--cc-surface);box-shadow:0 10px 24px #00000024}#cc-accounting .cc-home-kpis small,#cc-accounting .cc-micro-kpis small,#cc-accounting .cc-maker-metrics small{color:var(--cc-muted)}#cc-accounting .cc-home-kpis b{color:var(--cc-text)}#cc-accounting .cc-home-note,#cc-accounting .cc-date-filter{border-color:var(--cc-border);background:#0e1727;color:var(--cc-muted)}#cc-accounting .cc-date-filter input,#cc-accounting .cc-date-filter select{border-color:var(--cc-border);background:var(--cc-surface);color:var(--cc-text)}#cc-accounting .cc-date-filter button{border-color:#3b9eff66;background:#163354;color:#ddebff}#cc-accounting .cc-bar-sent{background:#3b9eff}#cc-accounting .cc-bar-received{background:linear-gradient(#ffb45f,#ff6d64)}#cc-accounting .cc-bar-amount{background:linear-gradient(#ff9f43,#ff5a5f)}#cc-accounting .cc-ring{background:conic-gradient(var(--cc-blue) var(--cc-ring),#27364d 0)}#cc-accounting .cc-ring:before{background:var(--cc-surface)}#cc-accounting .cc-maker-bar>i em,#cc-accounting .cc-product-bars i em{background:linear-gradient(90deg,#ff9f43,#ff5a5f)}#cc-accounting .cc-pending-list .is-aged,#cc-accounting .cc-payment-row em.is-aged{background:#ff5a5f21;color:#ffb0b4}#cc-accounting-content{min-width:0;animation:cc-enter .48s ease both}@keyframes cc-enter{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}@media(max-width:720px){.cc-manager-top{align-items:start;flex-direction:column}.cc-manager-actions{justify-content:flex-start}.cc-manager-actions label{width:100%}.cc-manager-actions select{flex:1}.cc-filter-drawer{width:100vw}}@media(prefers-reduced-motion:reduce){#cc-accounting *,#cc-accounting *:before,#cc-accounting *:after{animation:none!important;transition:none!important}}
  `; document.head.appendChild(style);
  const responsivePatch = document.createElement('style'); responsivePatch.textContent = '@media(max-width:720px){#cc-accounting .cc-filter-drawer,#cc-accounting .cc-filter-drawer.is-open{width:calc(100vw * 1.1364)!important;max-width:none!important}}@media(max-width:620px){#cc-accounting .cc-home-kpis{grid-template-columns:1fr}}'; document.head.appendChild(responsivePatch);
  const indoorThemePatch = document.createElement('style'); indoorThemePatch.textContent = `
    #cc-accounting{--cc-bg:#06150d;--cc-surface:#0d2116;--cc-border:#2d5035;--cc-text:#efffe8;--cc-muted:#a9c3ad;--cc-blue:#d8f86c;--cc-coral:#f46f57;--cc-orange:#f3b94f;background:linear-gradient(180deg,#06150d,#08140d)}
    #cc-accounting .cc-manager-brand span{color:#d8f86c}
    #cc-accounting .cc-manager-actions select,#cc-accounting .cc-manager-actions button{background:#0d2116;color:#efffe8;border-color:#2d5035}
    #cc-accounting .cc-manager-actions button:first-of-type{border-color:#d8f86c77;color:#efffe8;background:#183b24}
    #cc-accounting .cc-filter-scrim{background:#020a05b8}
    #cc-accounting .cc-filter-drawer{background:#081b10;border-right-color:#3f6b48}
    #cc-accounting .cc-filter-drawer input,#cc-accounting .cc-filter-chips button{background:#10291a;border-color:#3a6544;color:#eaffdf}
    #cc-accounting .cc-filter-chips button.is-selected,#cc-accounting .cc-filter-drawer footer button:last-child{background:#d8f86c;color:#122012;border-color:#d8f86c}
    #cc-accounting .cc-home-kpis article,#cc-accounting .cc-viz,#cc-accounting .cc-micro-kpis article,#cc-accounting .cc-maker-metrics article,#cc-accounting .cc-payment-plan,#cc-accounting #cc-home-detail{background:#0d2116;border-color:#2d5035}
    #cc-accounting .cc-bar-sent{background:#5fd27a}
    #cc-accounting .cc-bar-received{background:linear-gradient(#d8f86c,#82c64c)}
    #cc-accounting .cc-bar-amount{background:linear-gradient(#f3b94f,#f46f57)}
    #cc-accounting .cc-ring{background:conic-gradient(#d8f86c var(--cc-ring),#294432 0)}
    #cc-accounting .cc-ring:before{background:#0d2116}
    #cc-accounting .cc-maker-bar>i em,#cc-accounting .cc-product-bars i em{background:linear-gradient(90deg,#5bc879,#d8f86c)}
    #cc-accounting #cc-home-summary>header{display:none!important}
  `; document.head.appendChild(indoorThemePatch);
  const loadingPatch = document.createElement('style'); loadingPatch.textContent = `
    #cc-accounting{position:relative;min-height:220px}
    #cc-accounting>.cc-loading-overlay{position:absolute;inset:0;z-index:120;display:grid;place-items:center;padding:24px;background:rgba(4,18,10,.72);backdrop-filter:blur(4px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .24s ease,visibility .24s ease}
    #cc-accounting>.cc-loading-overlay.is-visible{opacity:1;visibility:visible;pointer-events:auto}
    #cc-accounting>.cc-loading-overlay .cc-loading-card{display:flex;align-items:center;gap:12px;min-width:238px;padding:15px 18px;border:1px solid #6d9d4a66;border-radius:16px;background:#0d2116f2;box-shadow:0 16px 38px #0008;color:#efffe8}
    #cc-accounting>.cc-loading-overlay i{width:28px;height:28px;flex:none;border:3px solid #d8f86c36;border-top-color:#d8f86c;border-right-color:#82c64c;border-radius:50%;animation:cc-loading-spin .82s linear infinite}
    #cc-accounting>.cc-loading-overlay b{display:block;font:850 11px Arial;letter-spacing:.08em;text-transform:uppercase}
    #cc-accounting>.cc-loading-overlay span{display:block;margin-top:5px;color:#a9c3ad;font-size:.72rem}
    #cc-accounting>.cc-loading-overlay span:after{content:'…';animation:cc-loading-dots 1.1s steps(4,end) infinite}
    #cc-accounting.cc-is-loading> :not(.cc-loading-overlay){opacity:.62;filter:blur(1px);transition:opacity .24s ease,filter .24s ease}
    @keyframes cc-loading-spin{to{transform:rotate(360deg)}}
    @keyframes cc-loading-dots{0%,20%{content:''}40%{content:'.'}60%{content:'..'}80%,100%{content:'...'}}
    @media(prefers-reduced-motion:reduce){#cc-accounting>.cc-loading-overlay,#cc-accounting.cc-is-loading> :not(.cc-loading-overlay){transition:none!important}#cc-accounting>.cc-loading-overlay i,#cc-accounting>.cc-loading-overlay span:after{animation:none!important}}
  `; document.head.appendChild(loadingPatch);
  const detailMotionPatch = document.createElement('style'); detailMotionPatch.textContent = `
    #cc-accounting .cc-motion-enter{opacity:0;transform:translateY(16px) scale(.985);animation:cc-card-rise .52s cubic-bezier(.22,.8,.24,1) both;animation-delay:calc(var(--cc-i,0) * 42ms)}
    @keyframes cc-card-rise{to{opacity:1;transform:translateY(0) scale(1)}}
    #cc-accounting .cc-month-bars i{transform-origin:bottom;animation:cc-bar-rise .78s cubic-bezier(.22,.8,.24,1) both;animation-delay:calc(var(--cc-i,0) * 28ms)}
    @keyframes cc-bar-rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}
    #cc-accounting .cc-maker-bar>i em,#cc-accounting .cc-product-bars i em{transform-origin:left;animation:cc-bar-grow .8s cubic-bezier(.22,.8,.24,1) both;animation-delay:calc(var(--cc-i,0) * 26ms)}
    @keyframes cc-bar-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    #cc-accounting .cc-production-detail{margin-top:12px;border:1px solid #2d5035;border-radius:16px;background:#0d2116;box-shadow:0 12px 28px #00000029;overflow:hidden}
    #cc-accounting .cc-production-detail>header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px;border-bottom:1px solid #ffffff14}
    #cc-accounting .cc-production-detail header small{color:#d8f86c;font:900 9px Arial;letter-spacing:.12em}
    #cc-accounting .cc-production-detail header h4{margin:5px 0 3px;font-size:.95rem}
    #cc-accounting .cc-production-detail header p{margin:0;color:#9fb79f;font-size:.68rem}
    #cc-accounting .cc-production-detail header strong{color:#d8f86c;white-space:nowrap;font-size:.78rem}
    #cc-accounting .cc-detail-table{overflow-x:auto}
    #cc-accounting .cc-detail-row{display:grid;grid-template-columns:minmax(150px,1.25fr) 92px 100px minmax(155px,1.3fr) 82px 82px 70px 70px 92px 108px 108px;gap:9px;align-items:center;min-width:1120px;padding:10px 16px;border-top:1px solid #ffffff10;font-size:.68rem}
    #cc-accounting .cc-detail-row>span,#cc-accounting .cc-detail-row>strong,#cc-accounting .cc-detail-row>em{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cc-accounting .cc-detail-head{border-top:0;background:#d8f86c0d;color:#b9cbb3;font:900 9px Arial;letter-spacing:.06em;text-transform:uppercase}
    #cc-accounting .cc-detail-row:not(.cc-detail-head){animation:cc-card-rise .42s ease both;animation-delay:calc(var(--cc-i,0) * 16ms)}
    #cc-accounting .cc-detail-row strong{color:#efffe8}
    #cc-accounting .cc-detail-row em{justify-self:start;padding:4px 7px;border-radius:999px;font:800 .61rem Arial;font-style:normal}
    #cc-accounting .cc-detail-row em.is-paid{background:#5bc87925;color:#b8f2c7}
    #cc-accounting .cc-detail-row em.is-due{background:#f46f5725;color:#ffb4a6}
    #cc-accounting .cc-liquidation-plan,#cc-accounting .cc-liquidation-overview{border:1px solid #2d5035;border-radius:16px;background:#0d2116;box-shadow:0 12px 28px #00000029;overflow:hidden}
    #cc-accounting .cc-liquidation-plan{margin-top:12px}
    #cc-accounting .cc-liquidation-plan>header,#cc-accounting .cc-liquidation-overview>header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px;border-bottom:1px solid #ffffff14}
    #cc-accounting .cc-liquidation-plan header small,#cc-accounting .cc-liquidation-overview header small{color:#d8f86c;font:900 9px Arial;letter-spacing:.12em}
    #cc-accounting .cc-liquidation-plan header h4,#cc-accounting .cc-liquidation-overview header h4{margin:5px 0 3px;font-size:.95rem}
    #cc-accounting .cc-liquidation-plan header p,#cc-accounting .cc-liquidation-overview header p{margin:0;color:#9fb79f;font-size:.68rem}
    #cc-accounting .cc-liquidation-plan header>strong{color:#d8f86c;white-space:nowrap;font-size:.9rem}
    #cc-accounting .cc-liquidation-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:12px 16px}
    #cc-accounting .cc-liquidation-kpis article{display:grid;gap:4px;padding:11px;border:1px solid #ffffff12;border-radius:11px;background:#10291a}
    #cc-accounting .cc-liquidation-kpis small{color:#a9c3ad;font:900 8px Arial;letter-spacing:.1em}
    #cc-accounting .cc-liquidation-kpis b{color:#efffe8;font-size:.95rem}
    #cc-accounting .cc-liquidation-kpis span{color:#9fb79f;font-size:.64rem}
    #cc-accounting .cc-liquidation-groups{display:grid;gap:8px;padding:0 12px 12px}
    #cc-accounting .cc-liquidation-group{border:1px solid #ffffff16;border-radius:12px;background:#0a1b11;overflow:hidden}
    #cc-accounting .cc-liquidation-group summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;list-style:none}
    #cc-accounting .cc-liquidation-group summary::-webkit-details-marker{display:none}
    #cc-accounting .cc-liquidation-group summary>span{display:grid;gap:4px}
    #cc-accounting .cc-liquidation-group summary b{font-size:.78rem;color:#efffe8}
    #cc-accounting .cc-liquidation-group summary small{color:#9fb79f;font-size:.65rem}
    #cc-accounting .cc-liquidation-group summary>strong{color:#d8f86c;white-space:nowrap;font-size:.78rem}
    #cc-accounting .cc-liquidation-group .cc-payment-table{border-top:1px solid #ffffff12}
    #cc-accounting .cc-liquidation-overview{margin-top:12px}
    #cc-accounting .cc-liquidation-overview header label{display:flex;align-items:center;gap:6px;color:#a9c3ad;font:800 9px Arial;text-transform:uppercase;letter-spacing:.08em}
    #cc-accounting .cc-liquidation-overview header select{min-height:32px;border:1px solid #3a6544;border-radius:8px;padding:0 9px;background:#10291a;color:#efffe8;font:700 11px Arial}
    #cc-accounting .cc-liquidation-overview-total{display:flex;align-items:baseline;gap:12px;padding:15px 16px;border-bottom:1px solid #ffffff12}
    #cc-accounting .cc-liquidation-overview-total strong{color:#d8f86c;font-size:1.15rem}
    #cc-accounting .cc-liquidation-overview-total span{color:#a9c3ad;font-size:.68rem}
    #cc-accounting .cc-liquidation-maker-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
    #cc-accounting .cc-liquidation-maker-list article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 16px;border-top:1px solid #ffffff10;border-right:1px solid #ffffff10}
    #cc-accounting .cc-liquidation-maker-list article:nth-child(even){border-right:0}
    #cc-accounting .cc-liquidation-maker-list article>div{min-width:0}
    #cc-accounting .cc-liquidation-maker-list b,#cc-accounting .cc-liquidation-maker-list span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cc-accounting .cc-liquidation-maker-list b{font-size:.73rem}
    #cc-accounting .cc-liquidation-maker-list span{margin-top:3px;color:#9fb79f;font-size:.62rem}
    #cc-accounting .cc-liquidation-maker-list strong{color:#efffe8;font-size:.72rem;white-space:nowrap}
    #cc-accounting .cc-liquidation-controls{display:grid;grid-template-columns:minmax(200px,1.45fr) minmax(170px,.85fr) auto auto;align-items:end;gap:9px;padding:12px 16px;border-bottom:1px solid #ffffff12;background:#0a1a10}
    #cc-accounting .cc-liquidation-controls label{display:grid;gap:5px;color:#a9c3ad;font:800 9px Arial;letter-spacing:.08em;text-transform:uppercase}
    #cc-accounting .cc-liquidation-controls input,#cc-accounting .cc-liquidation-controls select{height:34px;box-sizing:border-box;border:1px solid #3a6544;border-radius:8px;padding:0 10px;background:#10291a;color:#efffe8;font:700 11px Arial;outline:0;transition:border-color .18s,box-shadow .18s}
    #cc-accounting .cc-liquidation-controls input:focus,#cc-accounting .cc-liquidation-controls select:focus{border-color:#d8f86c;box-shadow:0 0 0 3px #d8f86c1c}
    #cc-accounting .cc-liquidation-filter,#cc-accounting .cc-liquidation-view{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
    #cc-accounting .cc-liquidation-controls button{height:32px;border:1px solid #3a6544;border-radius:8px;padding:0 9px;background:#10291a;color:#b7d0bc;cursor:pointer;font:800 10px Arial;white-space:nowrap;transition:background .18s,border-color .18s,color .18s,transform .18s}
    #cc-accounting .cc-liquidation-controls button:hover{border-color:#d8f86c;color:#efffe8;transform:translateY(-1px)}
    #cc-accounting .cc-liquidation-controls button.is-active{border-color:#d8f86c;background:#d8f86c;color:#122012}
    #cc-accounting .cc-liquidation-controls output{grid-column:1/-1;color:#9fb79f;font-size:.66rem;min-height:14px}
    #cc-accounting .cc-liquidation-group summary>span{min-width:0}
    #cc-accounting .cc-liquidation-progress{display:block;width:min(260px,42vw);height:4px;margin-top:3px;border-radius:99px;background:#ffffff13;overflow:hidden}
    #cc-accounting .cc-liquidation-progress em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#5bc879,#d8f86c);transform-origin:left;animation:cc-bar-grow .72s cubic-bezier(.22,.8,.24,1) both}
    #cc-accounting .cc-liquidation-group[hidden],#cc-accounting .cc-liquidation-payment-row[hidden]{display:none}
    #cc-accounting .cc-liquidation-payment-row{cursor:pointer;transition:background .18s,transform .18s,box-shadow .18s}
    #cc-accounting .cc-liquidation-payment-row:hover{background:#d8f86c0b;transform:translateX(3px)}
    #cc-accounting .cc-liquidation-payment-row.is-focused{background:#d8f86c13;box-shadow:inset 3px 0 #d8f86c}
    #cc-accounting .cc-liquidation-payment-row:not(.cc-payment-head){animation:cc-card-rise .4s ease both;animation-delay:calc(var(--cc-i,0) * 12ms)}
    #cc-accounting .cc-liquidation-plan .cc-payment-table{overflow-x:auto}
    #cc-accounting .cc-liquidation-plan .cc-payment-row{grid-template-columns:minmax(175px,1.3fr) 92px minmax(190px,1.35fr) 100px 100px 78px 78px 96px 108px 86px;min-width:1260px}
    #cc-accounting .cc-liquidation-plan .cc-payment-row>span:nth-child(1),#cc-accounting .cc-liquidation-plan .cc-payment-row>span:nth-child(3){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cc-accounting .cc-liquidation-plan .cc-payment-row>span:nth-child(3) b,#cc-accounting .cc-liquidation-plan .cc-payment-row>span:nth-child(3) small{display:block}
    #cc-accounting .cc-liquidation-plan .cc-payment-row>span:nth-child(3) small{margin-top:2px;color:#9fb099;font-size:.6rem}
    @media(max-width:620px){#cc-accounting .cc-production-detail>header{align-items:start;display:grid}.cc-production-detail header strong{justify-self:start}.cc-detail-table{padding-bottom:2px}}
    @media(max-width:980px){#cc-accounting .cc-liquidation-controls{grid-template-columns:minmax(180px,1fr) minmax(160px,1fr) auto}.cc-liquidation-view{grid-column:3;grid-row:1}}
    @media(max-width:620px){#cc-accounting .cc-liquidation-plan>header,#cc-accounting .cc-liquidation-overview>header{align-items:start;display:grid}.cc-liquidation-plan header>strong{justify-self:start}.cc-liquidation-kpis{grid-template-columns:1fr}.cc-liquidation-maker-list{grid-template-columns:1fr}.cc-liquidation-maker-list article{border-right:0!important}.cc-liquidation-overview-total{display:grid;gap:4px}.cc-liquidation-controls{grid-template-columns:1fr!important;align-items:stretch!important}.cc-liquidation-filter,.cc-liquidation-view{grid-column:auto!important;grid-row:auto!important}.cc-liquidation-controls output{grid-column:auto!important}.cc-liquidation-progress{width:min(220px,70vw)!important}#cc-accounting .cc-liquidation-plan .cc-payment-head{display:grid}#cc-accounting .cc-liquidation-plan .cc-payment-row strong,#cc-accounting .cc-liquidation-plan .cc-payment-row em{grid-column:auto}}
    @media(prefers-reduced-motion:reduce){#cc-accounting .cc-motion-enter,#cc-accounting .cc-month-bars i,#cc-accounting .cc-maker-bar>i em,#cc-accounting .cc-product-bars i em,#cc-accounting .cc-detail-row:not(.cc-detail-head){animation:none!important;transform:none!important;opacity:1!important}}
  `; document.head.appendChild(detailMotionPatch);
  function scan(root=document) { const panels=root.matches?.(PANEL)?[root]:[...root.querySelectorAll?.(PANEL)||[]]; panels.forEach(enhance); }
  scan(); loadExcel(); new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); }))).observe(document.documentElement,{childList:true,subtree:true});
})();
