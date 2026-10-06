(() => {
  // PROMEDIOS MAESTROS: consumo de tela por referencia (MTS REQUERIDOS ÷ cantidad de prendas), con lo ya registrado en Producción.
  if (window.__promediosListo) return;
  window.__promediosListo = true;
  let panel, tab, datos = null, buscar = '', abiertos = {}, orden = { col: 'referencia', asc: true };

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function api(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No fue posible cargar los promedios');
    return d;
  }

  const css = document.createElement('style');
  css.textContent = `
  .pm{display:grid;gap:14px;width:100%;max-width:1200px;margin:0 auto}
  .pm-head{padding:20px 22px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(135deg,#101a16,#0c110d)}
  .pm-head small{color:#7da4ff;letter-spacing:.14em;font-weight:800;font-size:.68rem}.pm-head h2{margin:4px 0 6px;font-size:1.6rem}.pm-head p{margin:0;color:#aebba7;font-size:.9rem;line-height:1.45}
  .pm-kpis{display:flex;gap:10px;flex-wrap:wrap}.pm-kpi{flex:1 1 150px;padding:12px 14px;border:1px solid #34432f;border-radius:12px;background:#0c110d}.pm-kpi b{display:block;font-size:1.35rem;color:#d7ff3a}.pm-kpi span{font-size:.72rem;color:#aebba7;letter-spacing:.06em;text-transform:uppercase}
  .pm-bar{display:flex;gap:10px;flex-wrap:wrap}.pm-bar input{flex:1 1 220px;min-height:42px;padding:0 14px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:inherit;font-size:.95rem}
  .pm-bar button{width:auto!important;flex:0 0 auto;min-height:42px;padding:0 16px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:inherit;font-weight:800;cursor:pointer}
  .pm-tabla{border:1px solid #34432f;border-radius:14px;overflow:hidden;background:#0c110d}
  .pm-tabla table{width:100%;border-collapse:collapse;font-size:.88rem}
  .pm-tabla th{padding:10px 12px;text-align:right;font-size:.7rem;letter-spacing:.07em;color:#aebba7;background:#111a14;cursor:pointer;user-select:none;white-space:nowrap}
  .pm-tabla th:first-child,.pm-tabla td:first-child{text-align:left}.pm-tabla th.tx,.pm-tabla td.tx{text-align:left}
  .pm-tabla td{padding:10px 12px;text-align:right;border-top:1px solid #1f2b20;white-space:nowrap}
  .pm-tabla td.tx{white-space:normal}.pm-tabla tr.fila{cursor:pointer}.pm-tabla tr.fila:hover td{background:#121b14}
  .pm-prom{color:#d7ff3a;font-weight:800;font-size:1rem}.pm-ref{font-weight:800}.pm-flecha{display:inline-block;width:14px;color:#7da4ff}
  .pm-det td{padding:0;background:#0a0f0b}.pm-det table{font-size:.82rem}.pm-det th{cursor:default;background:#0e1510}.pm-det td{border-top:1px solid #182218;padding:8px 12px}
  .pm-vacio{padding:34px;text-align:center;color:#aebba7}
  @media(max-width:700px){.pm-head{padding:14px 16px}.pm-head h2{font-size:1.25rem}.pm-head p{display:none}.pm-kpi{flex:1 1 40%}.pm-tabla{border-radius:12px;overflow-x:auto}.pm-tabla table{min-width:560px}.pm-bar input{font-size:16px}}
  .tab[data-kind='promedios'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='promedios']){display:none!important}}
  `;
  document.head.appendChild(css);

  function filas() {
    const q = plano(buscar).trim();
    let lista = (datos?.maestros || []).filter(m => !q || plano(m.referencia + ' ' + m.telas.join(' ') + ' ' + m.ordenes.map(o => o.orden + ' ' + o.cliente).join(' ')).includes(q));
    const k = orden.col, dir = orden.asc ? 1 : -1;
    return lista.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : a[k] - b[k]) * dir);
  }

  function pintar() {
    if (!datos) return;
    const lista = filas();
    const todos = datos.maestros;
    const prendas = todos.reduce((s, m) => s + m.prendas, 0), mts = todos.reduce((s, m) => s + m.mts, 0);
    const col = (k, texto, tx) => '<th data-orden="' + k + '"' + (tx ? ' class="tx"' : '') + '>' + texto + (orden.col === k ? (orden.asc ? ' ▲' : ' ▼') : '') + '</th>';
    const cuerpo = lista.map(m => {
      const abierto = !!abiertos[m.referencia];
      const detalle = abierto ? '<tr class="pm-det"><td colspan="7"><table><thead><tr><th class="tx">ORDEN</th><th class="tx">CLIENTE</th><th class="tx">TELA</th><th>PRENDAS</th><th>MTS</th><th>MTS / PRENDA</th></tr></thead><tbody>' +
        m.ordenes.map(o => '<tr><td class="tx">' + esc(o.orden) + '</td><td class="tx">' + esc(o.cliente) + '</td><td class="tx">' + esc(o.tela) + '</td><td>' + o.prendas + '</td><td>' + num(o.mts) + '</td><td>' + num(o.promedio, 3) + '</td></tr>').join('') + '</tbody></table></td></tr>' : '';
      return '<tr class="fila" data-ref="' + esc(m.referencia) + '"><td class="pm-ref"><span class="pm-flecha">' + (abierto ? '▾' : '▸') + '</span>' + esc(m.referencia) + '</td><td class="tx">' + esc(m.telas.join(', ') || '—') + '</td><td>' + m.pedidos + '</td><td>' + m.prendas + '</td><td>' + num(m.mts) + '</td><td class="pm-prom">' + num(m.promedio, 3) + '</td><td>' + (m.pedidos > 1 ? num(m.minimo, 3) + ' – ' + num(m.maximo, 3) : '—') + '</td></tr>' + detalle;
    }).join('');
    panel.querySelector('.pm').innerHTML =
      '<header class="pm-head"><small>EDICIÓN · INTELIGENCIA</small><h2>PROMEDIOS MAESTROS</h2><p>Consumo de tela por referencia: los MTS REQUERIDOS que registras en cada orden, divididos entre su cantidad de prendas. Toca una referencia para ver sus órdenes.</p></header>' +
      '<div class="pm-kpis"><div class="pm-kpi"><b>' + todos.length + '</b><span>Referencias</span></div><div class="pm-kpi"><b>' + num(prendas, 0) + '</b><span>Prendas</span></div><div class="pm-kpi"><b>' + num(mts, 0) + '</b><span>MTS registrados</span></div><div class="pm-kpi"><b>' + (datos.sin_registrar || 0) + '</b><span>Órdenes sin MTS</span></div></div>' +
      '<div class="pm-bar"><input type="search" data-buscar placeholder="Buscar referencia, tela, orden o cliente…" value="' + esc(buscar) + '"><button type="button" data-csv>Descargar CSV</button><button type="button" data-recargar>Actualizar</button></div>' +
      '<div class="pm-tabla">' + (lista.length ? '<table><thead><tr>' + col('referencia', 'REFERENCIA') + col('telas', 'TELA', true).replace(' data-orden="telas"', '') + col('pedidos', 'ÓRDENES') + col('prendas', 'PRENDAS') + col('mts', 'MTS') + col('promedio', 'MTS / PRENDA') + col('minimo', 'MÍN – MÁX') + '</tr></thead><tbody>' + cuerpo + '</tbody></table>' : '<div class="pm-vacio">' + (todos.length ? 'Ninguna referencia coincide con la búsqueda.' : 'Todavía no hay órdenes con MTS REQUERIDOS registrados.') + '</div>') + '</div>';
    const caja = panel.querySelector('[data-buscar]');
    if (document.activeElement === document.body && buscar) { caja.focus(); caja.setSelectionRange(buscar.length, buscar.length); }
  }

  async function cargar() {
    const host = panel.querySelector('.pm');
    if (!datos) host.innerHTML = '<div class="pm-vacio">Calculando promedios…</div>';
    try { datos = await api('/api/promedios'); pintar(); } catch (e) { host.innerHTML = '<div class="pm-vacio">' + esc(e.message) + '</div>'; }
  }

  function csv() {
    const celdas = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lineas = [['REFERENCIA', 'TELA', 'ORDENES', 'PRENDAS', 'MTS', 'MTS_POR_PRENDA', 'MINIMO', 'MAXIMO'].join(';')];
    filas().forEach(m => lineas.push([m.referencia, m.telas.join(' / '), m.pedidos, m.prendas, m.mts, m.promedio, m.minimo, m.maximo].map(celdas).join(';')));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'promedios_maestros.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="produccion"]')?.closest('.nav-group') || document.querySelector('nav.tabs .nav-group:last-child');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="promedios"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'promedios';
    panel.innerHTML = '<div class="pm"></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="promedios" type="button"><span class="nav-icon">PM</span><strong>PROMEDIOS MAESTROS</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
      cargar();
    });
    panel.addEventListener('click', e => {
      const th = e.target.closest('th[data-orden]'), fila = e.target.closest('tr.fila');
      if (th) { const k = th.dataset.orden; orden = { col: k, asc: orden.col === k ? !orden.asc : k === 'referencia' }; pintar(); }
      else if (fila) { const r = fila.dataset.ref; abiertos[r] = !abiertos[r]; pintar(); }
      else if (e.target.closest('[data-csv]')) csv();
      else if (e.target.closest('[data-recargar]')) cargar();
    });
    panel.addEventListener('input', e => { if (e.target.matches('[data-buscar]')) { buscar = e.target.value; pintar(); const c = panel.querySelector('[data-buscar]'); c.focus(); c.setSelectionRange(buscar.length, buscar.length); } });
    return true;
  }

  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return !!document.getElementById('open-promedios');
    if (document.getElementById('open-promedios')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-promedios'; button.textContent = 'Promedios maestros';
    const anterior = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    anterior ? anterior.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    return true;
  }

  // Solo quien tiene permiso «Promedios maestros» (Administración/Coordinador y Edición): a los demás la pestaña ni se crea.
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    if (!mi || !((mi.permisos || {}).promedios || {}).ver) return;
    let tries = 0;
    const wait = setInterval(() => { if ((build() && addMenuItem()) || ++tries > 60) clearInterval(wait); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();
