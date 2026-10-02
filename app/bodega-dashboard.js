// Dashboard de Bodega tela: estadísticas del inventario de telas, Sublimación y movimientos.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
  const rolls = n => num(n) + (Number(n) === 1 ? ' rollo' : ' rollos');
  const when = value => { if (!value) return 'sin fecha'; const date = new Date(value); return isNaN(date) ? 'sin fecha' : date.toLocaleString('es-CO', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); };

  const style = document.createElement('style');
  style.textContent = `
.bd{display:grid;gap:16px;max-width:1200px;margin:auto;padding-bottom:40px}
.bd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
.bd-head span{color:#d0f44c;font:800 10px Arial;letter-spacing:.1em}
.bd-head h2{margin:4px 0 0;font-size:1.4rem}
.bd-head p{margin:4px 0 0;color:#9fae99;font-size:12px}
.bd-refresh{width:auto!important;min-height:40px;padding:9px 13px!important;border:1px solid #60754d!important;border-radius:9px!important;background:#233020!important;color:#eff9df!important;font-weight:800;cursor:pointer}
.bd-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
.bd-card{display:grid;align-content:start;gap:8px;padding:17px;border:1px solid #3d4f3d;border-radius:14px;background:linear-gradient(145deg,#182118,#101510);min-width:0}
.bd-card small,.bd-box h3{color:#aebba7;font:800 10px Arial;letter-spacing:.07em;margin:0}
.bd-card strong{color:#d0f44c;font:800 28px Arial;line-height:1.1}
.bd-card strong em{font-style:normal;font-size:14px;color:#bdc8b8;margin-left:4px}
.bd-card span{color:#bdc8b8;font-size:12px}
.bd-card.alert{border-color:#a8433d}.bd-card.alert strong{color:#ff8a80}
.bd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.bd-box{display:grid;align-content:start;gap:12px;padding:17px;border:1px solid #3d4f3d;border-radius:14px;background:#111811;min-width:0}
.bd-box h3 b{color:#d0f44c;font-weight:800}
.bd-stack{display:flex;gap:2px;height:22px;border-radius:6px;overflow:hidden;background:#0b100b}
.bd-stack i{display:block;height:100%;min-width:2px}
.bd-new{background:#3a9f55}
.bd-started{background:repeating-linear-gradient(45deg,#d9772b 0 6px,#b8611f 6px 9px)}
.bd-legend{display:flex;flex-wrap:wrap;gap:16px;color:#dfe8d9;font-size:13px}
.bd-legend span{display:inline-flex;align-items:center;gap:7px}
.bd-legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
.bd-bars{display:grid;gap:7px;margin:0;padding:0;list-style:none}
.bd-bars li{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;align-items:center;gap:10px;font-size:12px;color:#dfe8d9;padding:2px 0;border-radius:6px}
.bd-bars li:hover{background:#1a241a}
.bd-bars .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-bars .track{height:10px;border-radius:0 4px 4px 0;background:#0b100b;overflow:hidden}
.bd-bars .track i{display:block;height:100%;background:#a9c93a;border-radius:0 4px 4px 0}
.bd-bars .val{color:#f1f6ec;font-weight:700;text-align:right;white-space:nowrap}
.bd-list{display:grid;gap:6px;margin:0;padding:0;list-style:none;max-height:340px;overflow:auto}
.bd-list li{display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #2b382b;border-radius:9px;background:#151d15;font-size:12px;color:#dfe8d9}
.bd-list li b{white-space:nowrap;color:#f1f6ec}
.bd-list li small{display:block;color:#93a28d;margin-top:2px}
.bd-list li.short{border-color:#a8433d;background:#2a1513}
.bd-list li.short b{color:#ff8a80}
.bd-tag{display:inline-block;padding:2px 7px;border-radius:5px;font:800 10px Arial;letter-spacing:.04em;margin-right:6px}
.bd-tag.in{background:#1f3a24;color:#9fe0a8}.bd-tag.out{background:#3a241f;color:#ffb59a}
.bd-chips{display:flex;flex-wrap:wrap;gap:6px}
.bd-chips span{padding:4px 8px;border:1px solid #3a2a2a;border-radius:7px;background:#1c1414;color:#e7c9c5;font-size:11px}
.bd-empty{color:#8f9d89;font-size:12px;margin:0}
.bd-mini{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.bd-mini div{padding:10px;border-radius:10px;background:#151d15;border:1px solid #2b382b}
.bd-mini small{display:block;color:#93a28d;font-size:11px}
.bd-mini strong{color:#f1f6ec;font-size:18px}
@media (max-width:900px){.bd-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.bd-grid{grid-template-columns:1fr}}
@media (max-width:520px){.bd-kpis{grid-template-columns:1fr}.bd-bars li{grid-template-columns:minmax(0,1fr) auto}.bd-bars .track{grid-column:1/-1;grid-row:2}}
`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'bodega-dashboard';
  panel.innerHTML = '<div class="bd"><div class="bd-head"><div><span>BODEGA TELA</span><h2>DASHBOARD</h2><p class="bd-updated">Cargando…</p></div><button type="button" class="bd-refresh">Actualizar</button></div><div class="bd-body"></div></div>';
  const body = panel.querySelector('.bd-body');

  const bars = (rows, label) => {
    if (!rows.length) return '<p class="bd-empty">Sin datos.</p>';
    const max = Math.max(...rows.map(row => row.mts)) || 1;
    return '<ul class="bd-bars">' + rows.map(row => '<li title="' + esc(row.nombre + ' · ' + num(row.mts) + ' MTS · ' + label(row)) + '"><span class="name">' + esc(row.nombre) + '</span><span class="track"><i style="width:' + Math.max(1, row.mts / max * 100) + '%"></i></span><span class="val">' + num(row.mts) + ' MTS</span></li>').join('') + '</ul>';
  };

  const render = data => {
    const k = data.kpis, sub = data.sublimacion, mov = data.movimientos, con = data.consumos;
    const total = (k.mts_nuevos + k.mts_empezados) || 1;
    panel.querySelector('.bd-updated').textContent = 'Inventario leído del Sheet: ' + when(data.updated_at);
    body.innerHTML =
      '<div class="bd-kpis">' +
        '<article class="bd-card"><small>METROS EN BODEGA</small><strong>' + num(k.mts) + '<em>MTS</em></strong><span>Suma de todas las telas</span></article>' +
        '<article class="bd-card"><small>TELAS CON STOCK</small><strong>' + num(k.telas_con_stock) + '<em>de ' + num(k.telas) + '</em></strong><span>' + num(k.telas_sin_stock) + ' telas en cero</span></article>' +
        '<article class="bd-card"><small>ROLLOS</small><strong>' + num(k.rollos) + '</strong><span>' + num(k.rollos_nuevos) + ' nuevos · ' + num(k.rollos_empezados) + ' empezados</span></article>' +
        '<article class="bd-card' + (sub.no_alcanzan ? ' alert' : '') + '"><small>RESERVADO SUBLIMACIÓN</small><strong>' + num(sub.mts) + '<em>MTS</em></strong><span>' + num(sub.ordenes) + ' órdenes en curso' + (sub.no_alcanzan ? ' · ' + sub.no_alcanzan + (sub.no_alcanzan === 1 ? ' NO ALCANZA' : ' NO ALCANZAN') + ' (faltan ' + num(sub.faltan) + ' MTS)' : ' · todas alcanzan') + '</span></article>' +
      '</div>' +
      '<section class="bd-box"><h3>ROLLOS NUEVOS VS EMPEZADOS (MTS)</h3>' +
        '<div class="bd-stack" role="img" aria-label="Nuevos ' + num(k.mts_nuevos) + ' MTS, empezados ' + num(k.mts_empezados) + ' MTS"><i class="bd-new" style="width:' + (k.mts_nuevos / total * 100) + '%" title="Nuevos: ' + num(k.mts_nuevos) + ' MTS en ' + num(k.rollos_nuevos) + ' rollos"></i><i class="bd-started" style="width:' + (k.mts_empezados / total * 100) + '%" title="Empezados: ' + num(k.mts_empezados) + ' MTS en ' + num(k.rollos_empezados) + ' rollos"></i></div>' +
        '<div class="bd-legend"><span><i class="bd-new"></i>Nuevos · ' + num(k.mts_nuevos) + ' MTS (' + Math.round(k.mts_nuevos / total * 100) + '%) · ' + num(k.rollos_nuevos) + ' rollos</span><span><i class="bd-started"></i>Empezados · ' + num(k.mts_empezados) + ' MTS (' + Math.round(k.mts_empezados / total * 100) + '%) · ' + num(k.rollos_empezados) + ' rollos</span></div>' +
      '</section>' +
      '<div class="bd-grid">' +
        '<section class="bd-box"><h3>TOP 10 TELAS CON MÁS METROS</h3>' + bars(data.top, row => rolls(row.rollos)) + '</section>' +
        '<section class="bd-box"><h3>METROS POR PROVEEDOR</h3>' + bars(data.proveedores.filter(row => row.mts > 0), row => row.telas + ' telas') + '</section>' +
      '</div>' +
      '<div class="bd-grid">' +
        '<section class="bd-box"><h3>BAJO STOCK <b>· MENOS DE ' + num(data.umbral_bajo) + ' MTS</b></h3>' +
          (data.bajo_stock.length ? '<ul class="bd-list">' + data.bajo_stock.map(row => '<li><span>' + esc(row.nombre) + '<small>' + rolls(row.rollos) + '</small></span><b>' + num(row.mts) + ' MTS</b></li>').join('') + '</ul>' : '<p class="bd-empty">Ninguna tela por debajo del umbral.</p>') +
          '<h3>SIN STOCK <b>· ' + data.sin_stock.length + '</b></h3>' +
          (data.sin_stock.length ? '<div class="bd-chips">' + data.sin_stock.map(name => '<span>' + esc(name) + '</span>').join('') + '</div>' : '<p class="bd-empty">Todas las telas tienen metros.</p>') +
        '</section>' +
        '<section class="bd-box"><h3>SUBLIMACIÓN EN CURSO <b>· ' + num(sub.ordenes) + ' ÓRDENES</b></h3>' +
          (sub.lista.length ? '<ul class="bd-list">' + sub.lista.map(row => '<li class="' + (row.short ? 'short' : '') + '"><span>' + esc(row.label) + '<small>' + (row.telas.length ? esc(row.telas.join(', ')) + ' · ' : '') + rolls(row.rollos) + '</small></span><b>' + (row.short ? 'NO ALCANZA · FALTAN ' + num(row.missing) + ' MTS' : 'ALCANZA') + '</b></li>').join('') + '</ul>' : '<p class="bd-empty">No hay órdenes en Sublimación (P).</p>') +
        '</section>' +
      '</div>' +
      '<div class="bd-grid">' +
        '<section class="bd-box"><h3>CONSUMO EN SUBLIMACIÓN</h3><div class="bd-mini"><div><small>Últimos 30 días</small><strong>' + num(con.mts_30d) + ' MTS</strong></div><div><small>Órdenes finalizadas (30 días)</small><strong>' + num(con.ordenes_30d) + '</strong></div></div>' +
          (con.ultimos.length ? '<ul class="bd-list">' + con.ultimos.map(row => '<li><span>Orden ' + esc(row.orden) + '<small>' + esc(when(row.fecha)) + (row.telas.length ? ' · ' + esc(row.telas.join(', ')) : '') + '</small></span><b>' + num(row.mts) + ' MTS</b></li>').join('') + '</ul>' : '<p class="bd-empty">Aún no hay consumos registrados.</p>') +
        '</section>' +
        '<section class="bd-box"><h3>INGRESOS Y SALIDAS DESDE LA WEB</h3><div class="bd-mini"><div><small>Ingresos (' + num(mov.ingresos) + ')</small><strong>' + num(mov.ingresos_mts) + ' MTS</strong></div><div><small>Salidas (' + num(mov.salidas) + ')</small><strong>' + num(mov.salidas_mts) + ' MTS</strong></div></div>' +
          (mov.ultimos.length ? '<ul class="bd-list">' + mov.ultimos.map(row => '<li><span><span class="bd-tag ' + (row.tipo === 'INGRESO' ? 'in' : 'out') + '">' + esc(row.tipo) + '</span>' + esc(row.nombre) + '<small>' + esc(when(row.fecha)) + (row.origen ? ' · ' + esc(row.origen) : '') + ' · ' + rolls(row.rollos) + '</small></span><b>' + num(row.mts) + ' MTS</b></li>').join('') + '</ul>' : '<p class="bd-empty">Aún no hay ingresos ni salidas registrados en la web.</p>') +
          '<p class="bd-empty">' + num(data.documentos) + ' documentos de entrega registrados.</p>' +
        '</section>' +
      '</div>';
  };

  const load = async () => {
    body.innerHTML = '<p class="bd-empty">Cargando estadísticas…</p>';
    try {
      const response = await fetch('/api/inventarios/dashboard', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar el dashboard');
      render(data);
    } catch (error) { body.innerHTML = '<p class="bd-empty">' + esc(error.message) + '</p>'; }
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
