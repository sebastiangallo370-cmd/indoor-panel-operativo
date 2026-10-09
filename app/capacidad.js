(() => {
  // CAPACIDAD IMPRESORAS (Producción): unidades que tiene cada máquina de impresión por imprimir, para decidir a cuál enviar el siguiente trabajo.
  // Cuenta los pedidos de Producción cuyo proceso IMPRESIÓN está vacío, en proceso (P) o en reproceso (R) y que aún no se entregaron.
  if (window.__capacidadListo) return;
  window.__capacidadListo = true;
  const MAQUINAS = ['SHUREZ', 'EPSON', 'GRAPHTEC', 'GT', 'JET', 'M2', 'SNAKE', 'ROLAND', 'SNAKE CE', 'EPSON YEINSON', 'EPSON JESAM', 'M2 DIC 2025', 'M2 IMAGEN',
    'SNAKE CE OLD NEGRO', 'SNAKE STS INKS', 'SNAKE CE OLD', 'IMPRES. UV', 'DTF'];
  const NO_IMPRESORA = new Set(['N/A', 'BORDADO', 'PLT']);   // no reciben trabajo de impresión
  const st = { datos: null, abiertas: {}, todas: false, cargando: false, error: '', sel: (() => { try { return localStorage.getItem('capacidad_maquina') || ''; } catch (e) { return ''; } })() };
  let panel, tab;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const num = n => Number(n || 0).toLocaleString('es-CO');
  const fecha = t => { const m = String(t || '').match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
  // «A100CA01 : 6,62 MTS» (la nota de MTS REQUERIDOS de la tarjeta, columna 17): suma todos los «N MTS» que traiga
  const mtsDeNota = t => { let total = 0, hay = false; for (const m of String(t || '').matchAll(/(\d+(?:[.,]\d+)?)\s*MTS/gi)) { total += parseFloat(m[1].replace(',', '.')) || 0; hay = true; } return hay ? total : 0; };
  const minutos = t => { const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const un = (n, d = 1) => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const corta = d => d ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—';

  function calcular(datos) {
    const H = (datos.headers || []).map(norm), G = (datos.groups || []).map(norm);
    const col = (nombre, grupo) => H.findIndex((h, i) => h === nombre && (!grupo || G[i] === grupo));
    const i = {
      orden: col('ORDEN'), cliente: col('NOMBRE DEL CLIENTE'), ref: col('REFERENCIA'), cant: col('CANTIDAD'), entrega: col('FECHA DE ENTREGA'),
      maq: col('MAQUINA DE IMPRESION'), imp: col('IMPRESION', 'IMPRESION'), entregado: col('ENTREGADO'),
    };
    if (i.maq < 0 || i.imp < 0 || i.cant < 0) return null;
    const notas = datos.notes || {};
    const por = {}, uso = new Map(), trabajos = new Map();   // trabajos: una tanda de impresión = máquina + fecha + hora inicio + hora final (varios pedidos pueden ir juntos)
    let pendientes = 0;
    for (const r of datos.rows || []) {
      const v = r.values || [];
      const maqRaw = String(v[i.maq] || '').trim();
      if (maqRaw) uso.set(norm(maqRaw), (uso.get(norm(maqRaw)) || 0) + 1);   // cuántos pedidos ha tenido: desempata a la que más se usa
      const imp = norm(v[i.imp]);
      const mts = mtsDeNota(notas[r.source_row + ':17']);
      if (/^\d/.test(imp) && maqRaw && mts > 0) {   // ya impreso, con máquina, horas y MTS registrados: sirve para medir cuántos MTS por hora saca la máquina
        const a = minutos(v[i.imp + 1]), b = minutos(v[i.imp + 2]);
        if (a !== null && b !== null) {
          const horas = (((b - a) + 1440) % 1440) / 60;   // si la hora final es menor, la impresión pasó la medianoche
          if (horas > 0 && horas <= 20) {
            const clave = norm(maqRaw) + '|' + imp + '|' + a + '|' + b;
            const t = trabajos.get(clave) || { maq: norm(maqRaw), horas, mts: 0 };
            t.mts += mts; trabajos.set(clave, t);
          }
        }
      }
      if (/^\d/.test(imp) || imp === 'N/A') continue;           // ya impreso (fecha) o no lleva impresión
      if (i.entregado >= 0 && norm(v[i.entregado])) continue;     // ya entregado
      const unidades = parseInt(String(v[i.cant] || '').replace(/\D/g, ''), 10) || 0;
      const nombre = norm(maqRaw) || 'SIN MAQUINA';
      const m = por[nombre] || (por[nombre] = { nombre, unidades: 0, proceso: 0, pedidos: [], proxima: null });
      const estado = imp === 'P' ? 'En proceso' : imp === 'R' ? 'Reproceso' : 'Por iniciar';
      const f = fecha(v[i.entrega]);
      m.unidades += unidades; if (imp === 'P') m.proceso += unidades;
      if (mts > 0) { m.mtsPend = (m.mtsPend || 0) + mts; m.conMts = (m.conMts || 0) + 1; }
      if (f && (!m.proxima || f < m.proxima)) m.proxima = f;
      m.pedidos.push({ fila: r.source_row, orden: String(v[i.orden] || ''), cliente: String(v[i.cliente] || ''), ref: String(v[i.ref] || ''), unidades, estado, entrega: f });
      pendientes += unidades;
    }
    for (const m of Object.values(por)) m.pedidos.sort((a, b) => (a.entrega ? a.entrega.getTime() : 9e15) - (b.entrega ? b.entrega.getTime() : 9e15));
    const ritmo = {};   // MTS por hora = MTS impresos / horas de impresión, de los trabajos ya terminados
    for (const t of trabajos.values()) { const r = ritmo[t.maq] || (ritmo[t.maq] = { mts: 0, horas: 0, trabajos: 0 }); r.mts += t.mts; r.horas += t.horas; r.trabajos++; }
    for (const r of Object.values(ritmo)) r.mtsHora = r.horas > 0 ? r.mts / r.horas : 0;
    return { por, uso, pendientes, ritmo };
  }

  const css = document.createElement('style');
  css.textContent = `
  .ci{display:grid;gap:18px;width:100%;max-width:1320px;margin:0 auto}.ci *{box-sizing:border-box}
  .ci-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:22px 24px;border:1px solid #34432f;border-radius:20px;background:radial-gradient(120% 140% at 0 0,#1a2a12 0,#0c110d 60%)}
  .ci-head small{color:#d7ff3a;letter-spacing:.16em;font-weight:800;font-size:.68rem}.ci-head h2{margin:4px 0;font-size:1.7rem;letter-spacing:.01em}.ci-head p{margin:0;color:#aebba7;font-size:.88rem;max-width:760px}
  .ci-ctl{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ci-ctl label{display:flex;align-items:center;gap:8px;font-size:.8rem;color:#aebba7;cursor:pointer}
  .ci-btn{min-height:42px;padding:0 18px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:inherit;font-weight:800;cursor:pointer;letter-spacing:.06em;width:auto!important}
  .ci-btn:hover{background:#223018}
  .ci-kpis{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .ci-kpi{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:center;padding:18px 20px;border:1px solid #34432f;border-radius:18px;background:#0c110d}
  .ci-kpi i{grid-row:1/4;display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#17211a;font-style:normal;font-size:1.5rem}
  .ci-kpi small{font-size:.62rem;letter-spacing:.14em;color:#9fb09a;font-weight:800}.ci-kpi b{font-size:2rem;line-height:1.1}.ci-kpi span{font-size:.8rem;color:#aebba7}
  .ci-kpi.mal{border-color:#8a5a2a;background:linear-gradient(135deg,#221709,#0c110d)}.ci-kpi.mal i{background:#3a2a14}.ci-kpi.mal b{color:#ffb766}
  .ci-kpi.bien{border-color:#7fb43a;background:linear-gradient(135deg,#17260c,#0c110d)}.ci-kpi.bien i{background:#26401a}.ci-kpi.bien b{color:#d7ff3a}
  .ci-sec{display:flex;align-items:center;gap:10px;margin:6px 2px 0;font-size:.72rem;letter-spacing:.16em;color:#9fb09a;font-weight:800}.ci-sec::after{content:'';flex:1;height:1px;background:#273326}
  .ci-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));align-items:start}
  .ci-card{display:grid;gap:12px;padding:18px;border:1px solid #34432f;border-radius:20px;background:#0c110d;align-content:start;transition:border-color .15s,transform .15s}
  .ci-card:hover{border-color:#5d7a3a}
  .ci-card.rec{border-color:#9fd24c;box-shadow:0 0 0 1px #9fd24c55,0 10px 30px #9fd24c14}
  .ci-card.sin{grid-column:1/-1;border-color:#8a5a2a;background:linear-gradient(160deg,#1c140a,#0c110d 55%)}
  .ci-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.ci-top h4{margin:0;font-size:1.2rem;letter-spacing:.03em}
  .ci-chip{display:inline-block;padding:4px 11px;border-radius:999px;font-size:.62rem;font-weight:800;letter-spacing:.1em;white-space:nowrap}
  .ci-chip.libre{background:#1f3314;color:#b8ff6a}.ci-chip.baja{background:#223018;color:#d7ff3a}.ci-chip.media{background:#3a3414;color:#ffe066}.ci-chip.alta{background:#3a1a14;color:#ff9a7a}.ci-chip.asig{background:#3a2a14;color:#ffb766}
  .ci-nums{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
  .ci-un{font-size:2.6rem;font-weight:800;line-height:1}.ci-un small{display:block;margin-top:4px;font-size:.7rem;color:#9fb09a;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .ci-mini{display:flex;gap:14px;text-align:center}.ci-mini div{display:grid;gap:1px}.ci-mini b{font-size:1.15rem}.ci-mini small{font-size:.6rem;letter-spacing:.08em;color:#9fb09a;text-transform:uppercase}
  .ci-bar{height:9px;border-radius:99px;background:#1b251d;overflow:hidden}.ci-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#6fa13a,#d7ff3a)}
  .ci-card.sin .ci-bar i{background:linear-gradient(90deg,#b8742a,#ffb766)}.ci-bar i.media{background:linear-gradient(90deg,#c9a82a,#ffe066)}.ci-bar i.alta{background:linear-gradient(90deg,#c9502a,#ff9a7a)}
  .ci-peds{display:grid;gap:10px;grid-template-columns:1fr}.ci-card.sin .ci-peds{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  .ci-ped{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:10px;border:1px solid #2a3827;border-radius:14px;background:#111a14}
  .ci-img{position:relative;width:64px;height:78px;border-radius:10px;overflow:hidden;background:#e9ece6}.ci-img img{width:100%;height:100%;object-fit:contain;display:block}
  .ci-img.sin{background:#1b251d}.ci-img.sin::after{content:'SIN IMAGEN';position:absolute;inset:0;display:grid;place-items:center;text-align:center;font-size:.5rem;font-weight:800;color:#6d7e68;letter-spacing:.06em;padding:4px}
  .ci-img.sin img{display:none}
  .ci-pb{display:grid;gap:2px;min-width:0;align-content:center}.ci-pb b{font-size:.95rem;letter-spacing:.02em}.ci-pb .cli{font-size:.74rem;color:#c5d1bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ci-pb .ref{font-size:.68rem;color:#8fa088}
  .ci-pf{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:3px}.ci-pf strong{font-size:.95rem;color:#fff}.ci-pf small{font-size:.66rem;color:#9fb09a}
  .ci-st{font-style:normal;padding:2px 8px;border-radius:999px;font-size:.58rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:#26321f;color:#cfe3b8}.ci-st.proceso{background:#143a2a;color:#7fe0b0}.ci-st.reproceso{background:#3a1a14;color:#ff9a7a}
  .ci-mas{justify-self:start;min-height:36px;padding:0 14px;border:1px dashed #3a4c36;border-radius:10px;background:transparent;color:#9db8ff;font-weight:700;font-size:.78rem;cursor:pointer;width:auto!important}
  .ci-mas:hover{background:#17211a}
  .ci-libre{padding:9px 12px;border-radius:10px;background:#122014;color:#9fd24c;font-size:.76rem;font-weight:700}
  .ci-sel{display:grid;padding:16px 20px;border:1px solid #34432f;border-radius:18px;background:#0c110d}
  .ci-sel label{display:grid;gap:8px;font-size:.66rem;letter-spacing:.14em;color:#9fb09a;font-weight:800}
  .ci-sel select{min-height:50px;padding:0 14px;border:1px solid #4b6a2b;border-radius:12px;background:#101710;color:#f1f7ec;font-size:1.05rem;font-weight:700;width:100%;cursor:pointer}
  .ci-rank{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  .ci-rk em{font-style:normal;font-size:.7rem;color:#9fd24c;white-space:nowrap}.ci-rk{display:grid;grid-template-columns:130px 1fr auto auto;align-items:center;gap:10px;padding:10px 14px;border:1px solid #2a3827;border-radius:12px;background:#0c110d;color:inherit;cursor:pointer;text-align:left;width:auto!important;min-height:0!important}
  .ci-rk:hover{border-color:#5d7a3a}.ci-rk.on{border-color:#9fd24c;background:#14210f}.ci-rk span{font-size:.78rem;font-weight:800;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ci-rk b{font-size:.95rem}
  .ci-bar i.asig{background:linear-gradient(90deg,#b8742a,#ffb766)}
  .ci-card.sel{grid-column:1/-1}.ci-card.sel .ci-peds{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
  .ci-det{display:grid}
  .ci-ritmo{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));padding:14px;border-radius:14px;background:#122014;border:1px solid #2c4020}
  .ci-ritmo div{display:grid;gap:2px}.ci-ritmo b{font-size:1.7rem;color:#d7ff3a;line-height:1.1}.ci-ritmo small{font-size:.6rem;letter-spacing:.08em;color:#9fb09a;font-weight:800}
  .ci-base{margin:0;font-size:.74rem;color:#8fa088}
  .ci-vacio{padding:28px;text-align:center;color:#8fa088;border:1px dashed #34432f;border-radius:14px;font-size:.85rem}
  .tab[data-kind='capacidad'] .nav-icon{font-size:.62rem}
  body:has(.panel[data-panel='capacidad'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important}
  @media(max-width:700px){.ci-head{padding:16px}.ci-head h2{font-size:1.3rem}.ci-grid{grid-template-columns:1fr}.ci-card.sin .ci-peds{grid-template-columns:1fr}.ci-un{font-size:2.2rem}}
  `;
  document.head.appendChild(css);

  const MOSTRAR = 4, MOSTRAR_SIN = 8, MOSTRAR_SEL = 24;   // pedidos que se ven en cada tarjeta antes de «Ver todos»

  function nivel(unidades, max) {
    if (!unidades) return 'libre';
    const f = unidades / Math.max(max, 1);
    return f > .66 ? 'alta' : f > .33 ? 'media' : 'baja';
  }
  const ETIQUETA = { libre: 'LIBRE', baja: 'CARGA BAJA', media: 'CARGA MEDIA', alta: 'CARGA ALTA' };

  function pedido(p) {
    const cls = p.estado === 'En proceso' ? 'proceso' : p.estado === 'Reproceso' ? 'reproceso' : '';
    return '<article class="ci-ped"><div class="ci-img"><img loading="lazy" alt="" src="/api/produccion/fila/' + encodeURIComponent(p.fila) + '/mockup-excel/1"></div>' +
      '<div class="ci-pb"><b>' + esc(p.orden || 'Fila ' + p.fila) + '</b><span class="cli">' + esc(p.cliente || 'Sin cliente') + '</span><span class="ref">' + esc(p.ref) + '</span>' +
      '<div class="ci-pf"><strong>' + num(p.unidades) + ' und</strong><em class="ci-st ' + cls + '">' + esc(p.estado) + '</em></div><small>Entrega ' + corta(p.entrega) + '</small></div></article>';
  }

  function tarjeta(m, clase, chip, max, ritmo) {
    const lvl = nivel(m.unidades, max), porIniciar = m.unidades - m.proceso, limite = clase.includes('sel') ? MOSTRAR_SEL : clase === 'sin' ? MOSTRAR_SIN : MOSTRAR;
    const abierta = !!st.abiertas[m.nombre], visibles = abierta ? m.pedidos : m.pedidos.slice(0, limite);
    return '<div class="ci-card ' + clase + '"><div class="ci-top"><h4>' + esc(m.nombre === 'SIN MAQUINA' ? 'SIN MÁQUINA ASIGNADA' : m.nombre) + '</h4>' + chip + '</div>' +
      '<div class="ci-nums"><div class="ci-un">' + num(m.unidades) + '<small>unidades por imprimir</small></div>' +
      '<div class="ci-mini"><div><b>' + num(m.proceso) + '</b><small>en proceso</small></div><div><b>' + num(porIniciar) + '</b><small>por iniciar</small></div><div><b>' + m.pedidos.length + '</b><small>pedidos</small></div><div><b>' + corta(m.proxima) + '</b><small>1ª entrega</small></div></div></div>' +
      (ritmo ? '<div class="ci-ritmo"><div><b>' + un(ritmo.mtsHora) + '</b><small>MTS POR HORA</small></div><div><b>' + (m.mtsPend ? un(m.mtsPend) : '—') + '</b><small>MTS POR IMPRIMIR' + (m.conMts && m.conMts < m.pedidos.length ? ' (' + m.conMts + ' de ' + m.pedidos.length + ' pedidos con MTS)' : '') + '</small></div><div><b>' + (m.mtsPend && ritmo.mtsHora ? un(m.mtsPend / ritmo.mtsHora) + ' h' : '—') + '</b><small>TIEMPO ESTIMADO</small></div></div><p class="ci-base">Ritmo real: ' + un(ritmo.mts) + ' MTS impresos en ' + un(ritmo.horas) + ' h (' + ritmo.trabajos + ' tandas terminadas)</p>' : (m.nombre !== 'SIN MAQUINA' ? '<p class="ci-base">Sin tandas terminadas con horas y MTS registrados: aún no se puede medir los MTS por hora.</p>' : '')) +
      '<div class="ci-bar"><i class="' + (clase === 'sin' ? '' : lvl === 'alta' ? 'alta' : lvl === 'media' ? 'media' : '') + '" style="width:' + Math.max(m.unidades ? 3 : 0, Math.round(m.unidades / Math.max(max, 1) * 100)) + '%"></i></div>' +
      (m.pedidos.length ? '<div class="ci-peds">' + visibles.map(pedido).join('') + '</div>' : '<div class="ci-libre">✓ Sin pedidos por imprimir · lista para recibir trabajo</div>') +
      (m.pedidos.length > limite ? '<button type="button" class="ci-mas" data-mas="' + esc(m.nombre) + '">' + (abierta ? '▴ Ver menos' : '▾ Ver los ' + m.pedidos.length + ' pedidos') + '</button>' : '') + '</div>';
  }

  function pintar() {
    const host = panel.querySelector('.ci');
    const c = st.datos ? calcular(st.datos) : null;
    const cab = '<div class="ci-head"><div><small>PRODUCCIÓN</small><h2>CAPACIDAD IMPRESORAS</h2><p>Unidades que cada máquina tiene por imprimir (impresión pendiente o en proceso, pedidos sin entregar). Envía el siguiente trabajo a la que tenga menos carga.</p></div>' +
      '<div class="ci-ctl"><label><input type="checkbox" data-todas' + (st.todas ? ' checked' : '') + '> Mostrar todas las máquinas</label><button type="button" class="ci-btn" data-act>↻ Actualizar</button></div></div>';
    if (st.cargando && !c) { host.innerHTML = cab + '<div class="ci-vacio">Cargando…</div>'; return; }
    if (!c) { host.innerHTML = cab + '<div class="ci-vacio">' + esc(st.error || 'No pude leer las columnas de Producción (MÁQUINA DE IMPRESIÓN, IMPRESIÓN, CANTIDAD).') + '</div>'; return; }
    const nombres = new Set([...c.uso.keys(), ...Object.keys(c.por).filter(n => n !== 'SIN MAQUINA')]);
    if (st.todas) MAQUINAS.forEach(m => nombres.add(m));
    const lista = [];
    for (const n of nombres) { if (NO_IMPRESORA.has(n) && !c.por[n]) continue; lista.push(c.por[n] || { nombre: n, unidades: 0, proceso: 0, pedidos: [], proxima: null }); }
    lista.sort((a, b) => a.unidades - b.unidades || (c.uso.get(b.nombre) || 0) - (c.uso.get(a.nombre) || 0) || a.nombre.localeCompare(b.nombre));
    const sin = c.por['SIN MAQUINA'];
    const rec = lista.find(m => !NO_IMPRESORA.has(m.nombre));
    const max = Math.max(1, ...lista.map(m => m.unidades));
    const kpis = '<div class="ci-kpis">' +
      '<div class="ci-kpi"><i>🖨️</i><small>UNIDADES POR IMPRIMIR</small><b>' + num(c.pendientes) + '</b><span>en las máquinas y sin asignar</span></div>' +
      '<div class="ci-kpi' + (sin ? ' mal' : '') + '"><i>⚠️</i><small>SIN MÁQUINA ASIGNADA</small><b>' + num(sin ? sin.unidades : 0) + '</b><span>' + num(sin ? sin.pedidos.length : 0) + ' pedidos esperando máquina</span></div>' +
      '<div class="ci-kpi bien"><i>✅</i><small>ENVIAR EL SIGUIENTE TRABAJO A</small><b>' + esc(rec ? rec.nombre : '—') + '</b><span>' + (rec ? (rec.unidades ? num(rec.unidades) + ' und por imprimir (la de menor carga)' : 'Libre ahora mismo') : '') + '</span></div></div>';
    const todas = (sin ? [sin] : []).concat(lista);
    if (st.sel && !todas.some(m => m.nombre === st.sel)) st.sel = '';
    const opciones = '<option value="">Elige una máquina…</option>' + todas.map(m =>
      '<option value="' + esc(m.nombre) + '"' + (m.nombre === st.sel ? ' selected' : '') + '>' + esc(m.nombre === 'SIN MAQUINA' ? 'SIN MÁQUINA' : m.nombre) + '</option>').join('');
    const ranking = '<div class="ci-rank">' + todas.map(m => {
      const l = m.nombre === 'SIN MAQUINA' ? 'asig' : nivel(m.unidades, max);
      return '<button type="button" class="ci-rk' + (m.nombre === st.sel ? ' on' : '') + '" data-pick="' + esc(m.nombre) + '"><span>' + esc(m.nombre === 'SIN MAQUINA' ? 'SIN MÁQUINA' : m.nombre) + '</span><div class="ci-bar"><i class="' + (l === 'alta' ? 'alta' : l === 'media' ? 'media' : l === 'asig' ? 'asig' : '') + '" style="width:' + Math.max(m.unidades ? 3 : 0, Math.round(m.unidades / Math.max(max, sin ? sin.unidades : 0, 1) * 100)) + '%"></i></div><b>' + num(m.unidades) + '</b><em>' + (c.ritmo[m.nombre] ? un(c.ritmo[m.nombre].mtsHora) + ' MTS/h' : '— MTS/h') + '</em></button>';
    }).join('') + '</div>';
    const elegida = todas.find(m => m.nombre === st.sel);
    const detalle = elegida
      ? tarjeta(elegida, 'sel' + (elegida.nombre === 'SIN MAQUINA' ? ' sin' : elegida === rec ? ' rec' : ''),
        elegida.nombre === 'SIN MAQUINA' ? '<span class="ci-chip asig">ESPERANDO MÁQUINA</span>' : '<span class="ci-chip ' + nivel(elegida.unidades, max) + '">' + ETIQUETA[nivel(elegida.unidades, max)] + '</span>', Math.max(max, elegida.nombre === 'SIN MAQUINA' ? elegida.unidades : max), c.ritmo[elegida.nombre])
      : '<div class="ci-vacio">Elige una máquina de la lista para ver los pedidos que tiene por imprimir.</div>';
    host.innerHTML = cab + kpis +
      '<div class="ci-sel"><label>MÁQUINA DE IMPRESIÓN<select data-maq>' + opciones + '</select></label></div>' +
      '<div class="ci-sec">CARGA POR MÁQUINA · TOCA UNA PARA VER SUS PEDIDOS</div>' + ranking +
      '<div class="ci-det">' + detalle + '</div>';
  }

  function elegir(nombre) {
    st.sel = nombre;
    try { localStorage.setItem('capacidad_maquina', nombre); } catch (e) { /* sin almacenamiento */ }
    pintar();
  }

  async function cargar() {
    st.cargando = true; st.error = ''; pintar();
    try {
      const r = await fetch('/api/produccion?force=true', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error('No pude leer Producción (' + r.status + ')');
      st.datos = await r.json();
    } catch (e) { st.error = e.message; }
    st.cargando = false; pintar();
  }

  function build() {
    const hijos = [...document.querySelectorAll('nav.tabs .nav-children .tab[data-kind="produccion"]')].map(t => t.parentElement);
    const contenedor = hijos[0];
    const main = document.querySelector('main');
    if (!contenedor || !main) return false;
    if (document.querySelector('.tab[data-kind="capacidad"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'capacidad';
    panel.innerHTML = '<div class="ci"></div>';
    main.appendChild(panel);
    tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'tab process-nav'; tab.dataset.kind = 'capacidad';
    tab.innerHTML = '<span class="nav-icon">CI</span><strong>CAPACIDAD IMPRESORAS</strong>';
    const impresion = [...contenedor.querySelectorAll('.tab')].find(t => /IMPRESI/i.test(norm(t.textContent)) && !/MAQUINA/i.test(norm(t.textContent)));
    (impresion || [...contenedor.querySelectorAll('.tab')].pop()).insertAdjacentElement('afterend', tab);
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar();
    });
    panel.addEventListener('click', e => { if (e.target.closest('[data-act]')) cargar(); const pick = e.target.closest('[data-pick]'); if (pick) { elegir(st.sel === pick.dataset.pick ? '' : pick.dataset.pick); return; } const mas = e.target.closest('[data-mas]'); if (mas) { st.abiertas[mas.dataset.mas] = !st.abiertas[mas.dataset.mas]; pintar(); } });
    panel.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') e.target.parentNode.classList.add('sin'); }, true);   // pedido sin imagen del Excel
    panel.addEventListener('change', e => {
      if (e.target.matches('[data-todas]')) { st.todas = e.target.checked; pintar(); }
      else if (e.target.matches('[data-maq]')) { elegir(e.target.value); }
    });
    return true;
  }

  let intentos = 0;
  const espera = setInterval(() => { if (build() || ++intentos > 80) clearInterval(espera); }, 250);
})();
