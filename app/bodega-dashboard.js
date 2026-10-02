// Dashboard de Bodega tela: estadísticas en tarjetas con el mismo estilo de Inventarios.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
  const rolls = n => num(n) + (Number(n) === 1 ? ' rollo' : ' rollos');
  const when = value => { if (!value) return 'sin fecha'; const date = new Date(value); return isNaN(date) ? 'sin fecha' : date.toLocaleString('es-CO', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); };

  const style = document.createElement('style');
  style.textContent = `
.bd{display:grid;gap:22px;width:100%;padding-bottom:40px}
.bd-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border:1px solid #46563f;border-radius:18px;background:linear-gradient(155deg,#1a2418,#0e140f)}
.bd-head h2{margin:0;font-size:1.05rem;color:#f0f4eb}
.bd-head p{margin:3px 0 0;color:#8a9485;font-size:.72rem}
.bd-refresh{width:auto!important;padding:9px 14px!important;border:1px solid #d0f44c!important;border-radius:9px!important;background:#1d2a14!important;color:#e7ff9a!important;font-weight:850;cursor:pointer}
.bd-section{display:grid;gap:12px}
.bd-section>h3{display:flex;align-items:center;gap:8px;margin:0;color:#d0f44c;font:850 .72rem Arial;letter-spacing:.1em;text-transform:uppercase}
.bd-section>h3 small{color:#8a9485;font-weight:700;letter-spacing:.04em}
.bd-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
.bd-cards.fit{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
@media (max-width:1400px){.bd-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:1100px){.bd-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:800px){.bd-cards,.bd-cards.fit{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bd .inventory-item-card{min-height:0;align-content:start}
.bd .inventory-item-card .inv-name{min-height:0}
.bd .inv-badge{width:max-content;margin-bottom:0}
.bd .inv-badge.bad{background:rgba(255,90,80,.16);color:#ffb3ad}
.bd .inv-badge.warn{background:rgba(255,159,28,.16);color:#ffd9a0}
.bd .inv-badge.ok{background:rgba(121,214,111,.16);color:#c9f7c3}
.bd .inventory-item-card.bad{border-color:#a8433d;background:linear-gradient(155deg,#2a1513,#140c0b)}
.bd .inventory-item-card.bad .inv-total{color:#ff8a80}
.bd .inv-total small{font-size:.9rem;margin-left:5px;color:#bdc8b8}
.bd .inventory-rolls{display:flex;flex-wrap:wrap;gap:6px}
.bd-meter{height:8px;border-radius:0 4px 4px 0;background:#0b100b;overflow:hidden}
.bd-meter i{display:block;height:100%;background:#a9c93a;border-radius:0 4px 4px 0}
.bd-split{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;background:#0b100b}
.bd-split i{display:block;height:100%;min-width:2px}
.bd-split .n{background:#3a9f55}.bd-split .s{background:repeating-linear-gradient(45deg,#d9772b 0 6px,#b8611f 6px 9px)}
.bd-line{display:flex;justify-content:space-between;gap:10px;color:#bdc8b8;font-size:.74rem}
.bd-line b{color:#f0f4eb;white-space:nowrap}
.bd-note{margin:0;color:#8a9485;font-size:.78rem}
@media (max-width:520px){.bd-head{flex-direction:column;align-items:stretch}.bd-cards{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'bodega-dashboard';
  panel.innerHTML = '<div class="bd"><div class="bd-head"><div><h2>Dashboard Bodega tela</h2><p class="bd-updated">Cargando…</p></div><button type="button" class="bd-refresh">Actualizar</button></div><div class="bd-body"></div></div>';
  const body = panel.querySelector('.bd-body');
  body.style.display = 'grid';
  body.style.gap = '26px';

  const circles = (values, states) => values && values.length ? '<div class="inventory-rolls">' + values.map((value, index) => '<span class="inventory-roll ' + (states?.[index] === 'started' ? 'roll-started' : 'roll-new') + '">' + esc(num(value)) + '</span>').join('') + '</div>' : '';
  const card = ({badge, badgeClass = '', name, total, unit, extra = '', cls = '', title = ''}) =>
    '<article class="inventory-item-card ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><span class="inv-badge ' + badgeClass + '">' + esc(badge) + '</span><strong class="inv-name">' + esc(name) + '</strong>' + extra + '<span class="inv-total">' + total + '</span>' + (unit ? '<span class="inv-unit">' + esc(unit) + '</span>' : '') + '</article>';
  const section = (title, note, cards, fit) => '<section class="bd-section"><h3>' + esc(title) + (note ? ' <small>· ' + esc(note) + '</small>' : '') + '</h3>' + (cards ? '<div class="bd-cards' + (fit ? ' fit' : '') + '">' + cards + '</div>' : '') + '</section>';
  const meter = (value, max) => '<div class="bd-meter"><i style="width:' + Math.max(1, value / (max || 1) * 100) + '%"></i></div>';

  const render = data => {
    const k = data.kpis, sub = data.sublimacion, mov = data.movimientos, con = data.consumos;
    const split = (k.mts_nuevos + k.mts_empezados) || 1;
    panel.querySelector('.bd-updated').textContent = 'Inventario leído del Sheet: ' + when(data.updated_at);
    const resumen =
      card({badge: 'Bodega tela', name: 'Metros en bodega', total: num(k.mts) + '<small>MTS</small>', unit: 'Suma de todas las telas'}) +
      card({badge: 'Telas', name: 'Telas con stock', total: num(k.telas_con_stock) + '<small>de ' + num(k.telas) + '</small>', unit: num(k.telas_sin_stock) + ' telas en cero', extra: meter(k.telas_con_stock, k.telas)}) +
      card({badge: 'Rollos', name: 'Rollos en bodega', total: num(k.rollos), unit: num(k.rollos_nuevos) + ' nuevos · ' + num(k.rollos_empezados) + ' empezados',
        extra: '<div class="bd-split" role="img" aria-label="Nuevos ' + num(k.mts_nuevos) + ' MTS, empezados ' + num(k.mts_empezados) + ' MTS"><i class="n" style="width:' + (k.mts_nuevos / split * 100) + '%" title="Nuevos: ' + num(k.mts_nuevos) + ' MTS"></i><i class="s" style="width:' + (k.mts_empezados / split * 100) + '%" title="Empezados: ' + num(k.mts_empezados) + ' MTS"></i></div>' +
          '<div class="inventory-rolls"><span class="inventory-roll roll-new">' + num(k.rollos_nuevos) + '</span><span class="bd-line" style="align-self:center">Nuevos · ' + num(k.mts_nuevos) + ' MTS</span></div><div class="inventory-rolls"><span class="inventory-roll roll-started">' + num(k.rollos_empezados) + '</span><span class="bd-line" style="align-self:center">Empezados · ' + num(k.mts_empezados) + ' MTS</span></div>'}) +
      card({badge: 'Sublimación', name: 'Reservado para Sublimación', total: num(sub.mts) + '<small>MTS</small>', unit: num(sub.ordenes) + ' órdenes en curso'}) +
      card({badge: sub.no_alcanzan ? 'Atención' : 'Al día', badgeClass: sub.no_alcanzan ? 'bad' : 'ok', cls: sub.no_alcanzan ? 'bad' : '', name: 'Órdenes que no alcanzan', total: num(sub.no_alcanzan), unit: sub.no_alcanzan ? 'Faltan ' + num(sub.faltan) + ' MTS' : 'Todas las órdenes alcanzan'}) +
      card({badge: 'Consumo', name: 'Consumido en Sublimación', total: num(con.mts_30d) + '<small>MTS</small>', unit: 'Últimos 30 días · ' + num(con.ordenes_30d) + ' órdenes'});

    const maxTop = data.top[0]?.mts || 1;
    const top = data.top.map((row, index) => card({badge: 'Top ' + (index + 1), name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados) + meter(row.mts, maxTop)})).join('');

    const orders = sub.lista.map(row => card({badge: row.short ? 'No alcanza' : 'Alcanza', badgeClass: row.short ? 'bad' : 'ok', cls: row.short ? 'bad' : '', name: row.label,
      total: row.short ? num(row.missing) + '<small>MTS FALTAN</small>' : num(row.mts) + '<small>MTS</small>',
      unit: (row.short ? 'Necesita ' + num(row.mts) + ' MTS · ' : '') + (row.telas.length ? row.telas.join(', ') + ' · ' : '') + rolls(row.rollos), extra: circles(row.valores, row.estados)})).join('');

    const low = data.bajo_stock.map(row => card({badge: 'Bajo stock', badgeClass: 'warn', name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados)})).join('') +
      data.sin_stock.map(name => card({badge: 'Sin stock', badgeClass: 'bad', name, total: '0<small>MTS</small>', unit: '0 rollos'})).join('');

    const maxSupplier = data.proveedores[0]?.mts || 1;
    const suppliers = data.proveedores.filter(row => row.mts > 0).map(row => card({badge: 'Proveedor', name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: num(row.telas) + (row.telas === 1 ? ' tela · ' : ' telas · ') + Math.round(row.mts / (k.mts || 1) * 100) + '% de la bodega',
      extra: meter(row.mts, maxSupplier) + ((data.proveedores_telas || {})[row.nombre] || []).map(([name, mts]) => '<div class="bd-line"><span>' + esc(name) + '</span><b>' + num(mts) + ' MTS</b></div>').join('')})).join('');

    const activity =
      card({badge: 'Ingresos web', badgeClass: 'ok', name: num(mov.ingresos) + ' ingresos registrados', total: num(mov.ingresos_mts) + '<small>MTS</small>', unit: num(data.documentos) + ' documentos de entrega'}) +
      card({badge: 'Salidas web', badgeClass: 'warn', name: num(mov.salidas) + ' salidas registradas', total: num(mov.salidas_mts) + '<small>MTS</small>', unit: 'Desde el formulario SALIDA'}) +
      mov.ultimos.map(row => card({badge: row.tipo === 'INGRESO' ? 'Ingreso' : 'Salida', badgeClass: row.tipo === 'INGRESO' ? 'ok' : 'warn', name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + ' · ' + rolls(row.rollos) + (row.origen ? ' · ' + row.origen : '')})).join('') +
      con.ultimos.map(row => card({badge: 'Consumo Sublimación', name: 'Orden ' + row.orden, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + (row.telas.length ? ' · ' + row.telas.join(', ') : '')})).join('');

    body.innerHTML =
      section('Resumen', '', resumen, true) +
      section('Sublimación en curso', num(sub.ordenes) + ' órdenes', orders || '') + (orders ? '' : '<p class="bd-note">No hay órdenes en Sublimación (P).</p>') +
      section('Bajo stock', 'menos de ' + num(data.umbral_bajo) + ' MTS', low || '') + (low ? '' : '<p class="bd-note">Ninguna tela por debajo del umbral.</p>') +
      section('Top 10 telas con más metros', '', top) +
      section('Metros por proveedor', '', suppliers) +
      section('Movimientos', 'ingresos, salidas y consumos', activity);
  };

  const load = async () => {
    body.innerHTML = '<p class="bd-note">Cargando estadísticas…</p>';
    try {
      const response = await fetch('/api/inventarios/dashboard', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar el dashboard');
      render(data);
    } catch (error) { body.innerHTML = '<p class="bd-note">' + esc(error.message) + '</p>'; }
  };
  panel.querySelector('.bd-refresh').onclick = load;

  const open = button => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === panel));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    load();
  };

  const mount = () => {
    if (document.querySelector('[data-bodega-dashboard]')) return true;
    const control = document.querySelector('[data-inventory-control]');
    const main = document.querySelector('main');
    if (!control || !main) return false;
    main.appendChild(panel);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab inventory-control-nav';
    button.dataset.bodegaDashboard = 'true';
    button.innerHTML = '<span class="nav-icon">DB</span><strong>DASHBOARD BODEGA</strong>';
    button.onclick = () => open(button);
    control.after(button);
    return true;
  };
  if (!mount()) { const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 300); setTimeout(() => clearInterval(timer), 15000); }
})();
