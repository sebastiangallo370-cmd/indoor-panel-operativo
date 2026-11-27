(() => {
  // ESTADÍSTICAS de COMERCIALES (PROGRAMAR CLUB). Datos: /api/estadisticas-comerciales/datos
  //   pedidos  = pedidos programados del panel (unidades = prendas; estado real según Producción)
  //   dinero   = SOLO Effi: cotizaciones, remisiones y facturas (valores SIN IVA = subtotal de Effi; IVA aparte)
  // club-admin.js dibuja <div id="ec-root"> y llama window.EstadisticasComerciales.montar(el).
  if (window.EstadisticasComerciales) return;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('es-CO');
  const und = n => nf.format(Math.round(n || 0)) + ' und.';
  const dec1 = n => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cop = v => { v = Number(v) || 0; const a = Math.abs(v); return (v < 0 ? '-' : '') + (a >= 1e9 ? '$' + dec1(a / 1e9) + ' mil millones' : a >= 1e6 ? '$' + dec1(a / 1e6) + ' millones' : '$' + nf.format(Math.round(a))); };
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dmy = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  let raiz = null, datos = null, error = '', cargando = false;
  const st = { periodo: 'semanal', off: 0, comercial: '', cliente: '', linea: '', met: {}, metCom: 'dinero', abiertos: {} };
  try { Object.assign(st, JSON.parse(localStorage.getItem('ecEstado') || '{}'), { off: 0 }); } catch (e) { /* sin almacenamiento */ }
  const guardar = () => { try { localStorage.setItem('ecEstado', JSON.stringify({ periodo: st.periodo, met: st.met, metCom: st.metCom, abiertos: st.abiertos, desde: st.desde, hasta: st.hasta })); } catch (e) { /* nada */ } };
  (() => { const h = new Date(); const d = h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
    // 2026-11-27: la pestaña arranca (una vez) en RANGO desde el 1 de septiembre, con lo que programó cada comercial
    try { if (!localStorage.getItem('ecInicioSep')) { st.periodo = 'rango'; st.desde = '2026-09-01'; st.hasta = ''; localStorage.setItem('ecInicioSep', '1'); } } catch (e) { /* nada */ }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.desde || '')) st.desde = d + '-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.hasta || '')) st.hasta = d + '-' + String(h.getDate()).padStart(2, '0'); })();

  // ------------------------------------------------------------------ periodos
  const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function rango(tipo, off) {
    const h = new Date(); h.setHours(0, 0, 0, 0);
    if (tipo === 'diario') {
      const d = new Date(h); d.setDate(d.getDate() + off);
      const fin = new Date(d); fin.setDate(fin.getDate() + 1);
      return { ini: iso(d), fin: iso(fin), etq: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), largo: DIA[d.getDay()].replace(/^./, c => c.toUpperCase()) + ' ' + d.getDate() + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear() };
    }
    if (tipo === 'rango') {
      let a = new Date((st.desde || iso(h)) + 'T00:00:00'), b = new Date((st.hasta || iso(h)) + 'T00:00:00');
      if (b < a) { const t = a; a = b; b = t; }
      const largoD = Math.round((b - a) / 864e5) + 1;
      a.setDate(a.getDate() + off * largoD); b.setDate(b.getDate() + off * largoD);
      const fin = new Date(b); fin.setDate(fin.getDate() + 1);
      const f = d => d.getDate() + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear();
      return { ini: iso(a), fin: iso(fin), etq: String(a.getDate()).padStart(2, '0') + '/' + String(a.getMonth() + 1).padStart(2, '0') + '–' + String(b.getDate()).padStart(2, '0') + '/' + String(b.getMonth() + 1).padStart(2, '0'),
        largo: largoD === 1 ? 'Día ' + f(a) : 'Del ' + f(a) + ' al ' + f(b), dias: largoD };
    }
    if (tipo === 'anual') {
      const a = h.getFullYear() + off;
      return { ini: a + '-01-01', fin: (a + 1) + '-01-01', etq: String(a), largo: 'Año ' + a };
    }
    if (tipo === 'semanal') {
      const ini = new Date(h); ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7) + 7 * off);
      const fin = new Date(ini); fin.setDate(fin.getDate() + 7);
      const ult = new Date(fin); ult.setDate(ult.getDate() - 1);
      return { ini: iso(ini), fin: iso(fin), etq: String(ini.getDate()).padStart(2, '0') + '/' + String(ini.getMonth() + 1).padStart(2, '0'), largo: 'Semana del ' + ini.getDate() + ' ' + MES[ini.getMonth()] + ' al ' + ult.getDate() + ' ' + MES[ult.getMonth()] + ' ' + ult.getFullYear() };
    }
    if (tipo === 'quincenal') {
      let k = h.getFullYear() * 24 + h.getMonth() * 2 + (h.getDate() > 15 ? 1 : 0) + off;
      const a = Math.floor(k / 24), m = Math.floor((k % 24) / 2), seg = k % 2;
      const ini = new Date(a, m, seg ? 16 : 1), fin = seg ? new Date(a, m + 1, 1) : new Date(a, m, 16);
      const ult = new Date(fin); ult.setDate(ult.getDate() - 1);
      return { ini: iso(ini), fin: iso(fin), etq: (seg ? '2.ª ' : '1.ª ') + MES[m], largo: (seg ? 'Segunda' : 'Primera') + ' quincena de ' + MES[m] + ' ' + a + ' (' + ini.getDate() + ' al ' + ult.getDate() + ')' };
    }
    const ini = new Date(h.getFullYear(), h.getMonth() + off, 1), fin = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
    return { ini: iso(ini), fin: iso(fin), etq: MES[ini.getMonth()] + (ini.getMonth() === 0 ? ' ' + ini.getFullYear() : ''), largo: 'Mes de ' + MES[ini.getMonth()] + ' ' + ini.getFullYear() };
  }
  const dentro = (f, r) => f && f >= r.ini && f < r.fin;
  const hoy0 = () => { const h = new Date(); h.setHours(0, 0, 0, 0); return h; };
  function detalle(r) {
    const out = [], h = hoy0();
    if (st.periodo === 'rango' && (r.dias || 0) > 62) {
      const fin = new Date(r.fin + 'T00:00:00');
      for (let d = new Date(r.ini.slice(0, 7) + '-01T00:00:00'); d < fin; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const ini = new Date(Math.max(d, new Date(r.ini + 'T00:00:00'))), sig = new Date(Math.min(new Date(d.getFullYear(), d.getMonth() + 1, 1), fin));
        out.push({ ini: iso(ini), fin: iso(sig), etq: MES[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : ''), largo: MES[d.getMonth()] + ' ' + d.getFullYear(), on: false,
          ir: 'mensual|' + ((d.getFullYear() - h.getFullYear()) * 12 + (d.getMonth() - h.getMonth())), futuro: d > h });
      }
      return out;
    }
    if (st.periodo === 'anual') {
      const a = Number(r.ini.slice(0, 4));
      for (let m = 0; m < 12; m++) {
        const ini = new Date(a, m, 1), fin = new Date(a, m + 1, 1);
        out.push({ ini: iso(ini), fin: iso(fin), etq: MES[m], largo: MES[m] + ' ' + a, on: a === h.getFullYear() && m === h.getMonth(),
          ir: 'mensual|' + ((a - h.getFullYear()) * 12 + (m - h.getMonth())), futuro: ini > h });
      }
      return out;
    }
    let ini = new Date(r.ini + 'T00:00:00'), fin = new Date(r.fin + 'T00:00:00'), sel = null;
    if (st.periodo === 'diario') { sel = r.ini; fin = new Date(ini); fin.setDate(fin.getDate() + 1); ini = new Date(ini); ini.setDate(ini.getDate() - 13); }
    for (const d = new Date(ini); d < fin; d.setDate(d.getDate() + 1)) {
      const sig = new Date(d); sig.setDate(sig.getDate() + 1);
      out.push({ ini: iso(d), fin: iso(sig), etq: st.periodo === 'diario' ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : String(d.getDate()),
        largo: DIA[d.getDay()] + ' ' + d.getDate() + ' ' + MES[d.getMonth()], on: sel ? iso(d) === sel : iso(d) === iso(h),
        ir: 'diario|' + Math.round((d - h) / 864e5), futuro: d > h });
    }
    return out;
  }

  // ------------------------------------------------------------------ selección con filtros globales
  const comercialOk = x => !st.comercial || x.comercial === st.comercial;
  const clienteOk = x => !st.cliente || norm(x.cliente) === st.cliente;
  const pedidosEn = (r, sinCom) => datos.pedidos.filter(p => dentro(p.fecha, r) && (sinCom || comercialOk(p)) && clienteOk(p) && (!st.linea || (p.lineas || []).includes(st.linea)));
  const docsEn = (lista, r, sinCom) => lista.filter(d => !d.anulada && dentro(d.fecha, r) && (sinCom || comercialOk(d)) && clienteOk(d));
  // Vendido = facturas + remisiones aún SIN facturar. Effi anula la remisión cuando la factura, así nada se cuenta dos veces.
  const ventasEn = (r, sinCom) => docsEn(datos.remisiones, r, sinCom).filter(d => !d.facturada).concat(docsEn(datos.facturas, r, sinCom));
  const suma = (l, k) => l.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const codigosCO = () => new Set(datos.pedidos.filter(p => p.codigo.startsWith('CO')).map(p => p.codigo.slice(2)));
  const estadoCot = d => d.convertida || codigosCO().has(d.id) ? 'Aceptada' : (Date.now() - new Date(d.fecha + 'T00:00:00')) / 864e5 > datos.reglas.dias_vencida ? 'Vencida' : 'Abierta';
  const histIni = () => ({ ped: datos.pedidos_desde || datos.pedidos.reduce((m, p) => p.fecha && p.fecha < m ? p.fecha : m, '9999'), effi: datos.desde });

  function kpisDe(r, sinCom) {
    const P = pedidosEn(r, sinCom), V = ventasEn(r, sinCom);
    return { unidades: suma(P, 'unidades'), pedidos: P.length, clientes: new Set(P.map(p => norm(p.cliente))).size,
      atrasados: P.filter(p => p.estado.atrasado).length, dinero: suma(V, 'sin_iva'), iva: suma(V, 'iva'), P, V };
  }

  // ------------------------------------------------------------------ gráficas (SVG, paleta verde/negro)
  function barras(serie, fmt, titulo) {
    const W = 640, H = 220, pl = 8, pr = 8, pt = 24, pb = 30, n = serie.length || 1;
    const max = Math.max(1, ...serie.map(s => s.v)), ancho = (W - pl - pr) / n, bw = Math.min(46, ancho * 0.62);
    const y = v => H - pb - (H - pt - pb) * v / max;
    return '<svg class="ec-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo) + '">' +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="#3a4a3a"/>' +
      serie.map((s, i) => {
        const x = pl + ancho * i + (ancho - bw) / 2, yy = y(s.v), cx = x + bw / 2;
        return '<rect x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, H - pb - yy).toFixed(1) + '" rx="5" fill="' + (s.on ? '#d0f44c' : '#6f8f3a') + '"><title>' + esc(s.etq + ': ' + fmt(s.v)) + '</title></rect>' +
          (s.v ? '<text x="' + cx.toFixed(1) + '" y="' + (yy - 6).toFixed(1) + '" text-anchor="middle" class="ec-svg-v">' + esc(fmt(s.v).replace(' und.', '').replace(' millones', ' M').replace(' mil millones', ' MM')) + '</text>' : '') +
          '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" class="ec-svg-e">' + esc(s.etq) + '</text>';
      }).join('') + '</svg>';
  }
  function hbarras(items, fmt, clicable) {
    const max = Math.max(1, ...items.map(i => i.v));
    return '<div class="ec-hb">' + items.map(i => '<div class="ec-hb-f' + (clicable ? ' ec-click' : '') + (i.on ? ' on' : '') + (i.mal ? ' mal' : '') + '"' + (clicable ? ' data-ec-com="' + esc(i.id) + '"' : '') + '><span title="' + esc(i.etq) + '">' + esc(i.etq) + '</span><div class="ec-hb-b"><i style="width:' + pct(i.v, max) + '%"></i></div><b>' + esc(fmt(i.v)) + '</b></div>').join('') + '</div>';
  }
  function selMet(clave, def) {
    const m = st.met[clave] || def || 'und';
    return '<div class="ec-seg" role="group" aria-label="Métrica"><button type="button" data-ec-met="' + clave + ':und" class="' + (m === 'und' ? 'on' : '') + '">UNIDADES</button><button type="button" data-ec-met="' + clave + ':cop" class="' + (m === 'cop' ? 'on' : '') + '">DINERO (COP)</button></div>';
  }
  // Serie de los últimos N periodos (incluido el seleccionado) para una función valor(r)
  function serieDe(fnValor, n) {
    const out = [];
    for (let k = n - 1; k >= 0; k--) { const r = rango(st.periodo, st.off - k); out.push({ etq: r.etq, largo: r.largo, v: fnValor(r), on: k === 0 }); }
    return out;
  }

  // ------------------------------------------------------------------ bloques
  function variacion(act, ant, rAnt, base) {
    if (rAnt.ini < base) return '<em class="ec-var na">histórico insuficiente</em>';
    if (!ant) return act ? '<em class="ec-var up">nuevo vs. periodo anterior</em>' : '<em class="ec-var">sin cambio</em>';
    const v = Math.round(100 * (act - ant) / ant);
    return '<em class="ec-var ' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + (v > 0 ? '▲ +' : v < 0 ? '▼ ' : '') + v + '% vs. anterior</em>';
  }
  function kpi(titulo, valor, pie, nivel, tono) {
    return '<div class="ec-kpi" data-lq="' + Math.max(0, Math.min(100, Math.round(nivel))) + '" data-lq-tone="' + tono + '"><small>' + titulo + '</small><b>' + valor + '</b>' + pie + '</div>';
  }

  // ------------------------------------------------------------------ marcas profesionales (guía dataviz: barras ≤24px con punta redondeada de 4px,
  // cuadrícula de 1px discreta, ejes con cifras redondas, solo el valor importante rotulado, globo al pasar el mouse)
  const C_ACENTO = '#c8ec4a', C_SUAVE = '#4b5b47', C_EJE = '#26322a', C_TXT2 = '#9aa894';
  const ST = { critico: '#ff5d4d', aviso: '#f5a524', bien: '#5cc98a', neutro: '#66745f' };
  function redondo(max) {   // tope del eje en una cifra «limpia» (1, 2, 2,5, 5 × 10^n)
    if (max <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max / 4))), pasos = [1, 2, 2.5, 5, 10];
    const paso = pasos.map(x => x * p).find(x => x * 4 >= max) || 10 * p;
    return paso * 4;
  }
  const corto = (v, dinero) => {
    const a = Math.abs(v);
    if (!dinero) return a >= 1e4 ? dec1(a / 1e3).replace(',0', '') + ' mil' : nf.format(Math.round(a));   // unidades: 1.724 tal cual
    const t = a >= 1e9 ? dec1(a / 1e9).replace(',0', '') + ' mil M' : a >= 1e6 ? (a >= 1e8 ? Math.round(a / 1e6) : dec1(a / 1e6).replace(',0', '')) + ' M' : a >= 1e3 ? Math.round(a / 1e3) + ' mil' : nf.format(Math.round(a));
    return '$' + t;
  };
  // Columnas por periodo: el periodo elegido en el color de acento, los demás en gris; se rotula SOLO el elegido y el máximo
  function columnas(serie, fmt, dinero, titulo) {
    const W = 640, H = 240, pl = 52, pr = 10, pt = 26, pb = 30, n = serie.length || 1;
    const top = redondo(Math.max(0, ...serie.map(s => s.v))), slot = (W - pl - pr) / n, bw = Math.min(24, slot * 0.45);
    const y = v => pt + (H - pt - pb) * (1 - v / top);
    const imax = serie.reduce((m, s, i) => s.v > serie[m].v ? i : m, 0);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = top * k / 4, yy = y(v).toFixed(1);
      g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + (k ? C_EJE : '#3a483c') + '" stroke-width="1"/>' +
        '<text x="' + (pl - 8) + '" y="' + (Number(yy) + 4) + '" text-anchor="end" class="ec-ax">' + esc(k ? corto(v, dinero) : '0') + '</text>';
    }
    serie.forEach((s, i) => {
      const cx = pl + slot * i + slot / 2, x = cx - bw / 2, yv = y(s.v), base = y(0), h = Math.max(0, base - yv), r = Math.min(4, h, bw / 2);
      const d = h > 0 ? 'M' + x.toFixed(1) + ',' + base.toFixed(1) + 'V' + (yv + r).toFixed(1) + 'Q' + x.toFixed(1) + ',' + yv.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + yv.toFixed(1) +
        'H' + (x + bw - r).toFixed(1) + 'Q' + (x + bw).toFixed(1) + ',' + yv.toFixed(1) + ' ' + (x + bw).toFixed(1) + ',' + (yv + r).toFixed(1) + 'V' + base.toFixed(1) + 'Z' : '';
      const ir = s.futuro ? '' : s.ir;
      g += '<g class="ec-mk' + (ir ? ' ir' : '') + '"' + (ir ? ' data-ec-ir="' + ir + '"' : '') + ' data-tip="' + esc(s.largo || s.etq) + '|' + esc(s.futuro ? 'aún no llega' : fmt(s.v) + (ir ? ' · clic para ver el detalle' : '')) + '" tabindex="0"><rect x="' + (cx - slot / 2).toFixed(1) + '" y="' + pt + '" width="' + slot.toFixed(1) + '" height="' + (H - pt - pb) + '" fill="transparent"/>' +
        (d ? '<path d="' + d + '" fill="' + (s.on ? C_ACENTO : i === imax ? '#7f9c34' : C_SUAVE) + '" style="animation-delay:' + Math.min(600, i * 22) + 'ms"/>' : '') + '</g>' +
        ((n <= 10 || s.on || i === imax) && s.v ? '<text x="' + cx.toFixed(1) + '" y="' + (yv - 8).toFixed(1) + '" text-anchor="middle" class="' + (s.on ? 'ec-vl on' : 'ec-vl') + '">' + esc(corto(s.v, dinero)) + '</text>' : '') +
        (s.futuro && n <= 16 ? '<text x="' + cx.toFixed(1) + '" y="' + (y(0) - 8).toFixed(1) + '" text-anchor="middle" class="ec-fut">aún no</text>' : '') +
        (n <= 16 || s.on || i % Math.ceil(n / 16) === 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" class="ec-ax' + (s.on ? ' on' : '') + (s.futuro ? ' fut' : '') + '">' + esc(s.etq) + '</text>' : '');
    });
    return '<svg class="ec-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo) + '">' + g + '</svg>';
  }
  // Ranking horizontal: una sola tinta, el elegido resaltado; valor y participación al final de cada barra
  function ranking(items, fmt, clicable) {
    const max = Math.max(1, ...items.map(i => i.v)), tot = items.reduce((s, i) => s + i.v, 0) || 1;
    return '<div class="ec-rk">' + items.map((i, k) => '<div class="ec-rk-f' + (clicable ? ' ec-click' : '') + (i.on ? ' on' : '') + (st.comercial && !i.on ? ' tenue' : '') + '"' + (clicable ? ' data-ec-com="' + esc(i.id) + '"' : '') +
      ' data-tip="' + esc(i.etq) + '|' + esc(fmt(i.v)) + ' · ' + pct(i.v, tot) + '% del total" tabindex="0"><span class="ec-rk-n"><em class="ec-rk-p' + (k === 0 && i.v ? ' uno' : '') + '">' + (k + 1) + '</em>' + (i.sigla ? '<i class="ec-av">' + esc(i.sigla) + '</i>' : '') + esc(i.etq) + '</span><span class="ec-rk-b"><i style="width:' + Math.max(i.v ? 1.5 : 0, 100 * i.v / max).toFixed(1) + '%;background:' + (k === 0 || i.on ? C_ACENTO : '#8fae3a') + '"></i></span><span class="ec-rk-v">' + esc(fmt(i.v)) + '<em>' + pct(i.v, tot) + '%</em></span></div>').join('') + '</div>';
  }
  // Barra segmentada alta (partes de un total): bloques con 2px de separación, % dentro solo si cabe, leyenda debajo con nombre y valor
  function segmentada(partes, fmt, etiqueta) {
    const tot = partes.reduce((s, p) => s + p.v, 0);
    if (!tot) return '<p class="ec-nota">Sin datos en el periodo.</p>';
    return '<div class="ec-sg" role="img" aria-label="' + esc(etiqueta) + '">' + partes.filter(p => p.v > 0).map(p => { const w = 100 * p.v / tot;
      return '<span style="flex:' + w.toFixed(3) + ' 1 0;background:' + p.c + ';color:' + (p.oscuro ? '#fff' : '#0d140e') + '" data-tip="' + esc(p.n) + '|' + esc(fmt(p.v)) + ' · ' + Math.round(w) + '%" tabindex="0">' + (w >= 12 ? Math.round(w) + '%' : '') + '</span>'; }).join('') + '</div>' +
      '<div class="ec-sg-ley">' + partes.map(p => '<span><i style="background:' + p.c + '"></i>' + esc(p.n) + '<b>' + esc(fmt(p.v)) + '</b></span>').join('') + '</div>';
  }
  // Globo (tooltip) único para todas las gráficas: mouse y teclado
  function globo() {
    let t = document.getElementById('ec-tip');
    if (!t) { t = document.createElement('div'); t.id = 'ec-tip'; t.className = 'ec-tip'; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
    return t;
  }
  function mostrarGlobo(el, x, y) {
    const [a, b] = String(el.dataset.tip || '').split('|');
    const t = globo(); t.innerHTML = '<small>' + esc(a) + '</small><b>' + esc(b || '') + '</b>'; t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    t.style.top = Math.max(8, y - h - 12) + 'px';
  }
  const ocultarGlobo = () => { const t = document.getElementById('ec-tip'); if (t) t.style.display = 'none'; };
  document.addEventListener('mousemove', e => { const el = raiz && e.target.closest && e.target.closest('[data-tip]'); if (el && raiz.contains(el)) mostrarGlobo(el, e.clientX, e.clientY); else ocultarGlobo(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && raiz && raiz.contains(el)) { const r = el.getBoundingClientRect(); mostrarGlobo(el, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', ocultarGlobo);
  window.addEventListener('scroll', ocultarGlobo, true);

  // ------------------------------------------------------------------ LAS 4 GRÁFICAS (lo que el jefe comercial ve de un vistazo)
  function dona(partes, centro, etiqueta) {
    const R = 62, C = 2 * Math.PI * R, tot = partes.reduce((s, p) => s + p.v, 0);
    let acum = 0;
    const arcos = partes.filter(p => p.v > 0).map(p => {
      const l = tot ? C * p.v / tot : 0;
      const a = '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="' + p.c + '" stroke-width="22" stroke-dasharray="' + l.toFixed(2) + ' ' + (C - l).toFixed(2) + '" stroke-dashoffset="' + (-acum).toFixed(2) + '" transform="rotate(-90 80 80)"><title>' + esc(p.n + ': ' + p.v) + '</title></circle>';
      acum += l; return a;
    }).join('');
    return '<svg class="ec-dona" viewBox="0 0 160 160" role="img" aria-label="' + esc(etiqueta) + '"><circle cx="80" cy="80" r="' + R + '" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="22"/>' + arcos +
      '<text x="80" y="80" text-anchor="middle" class="ec-dona-n">' + esc(centro) + '</text><text x="80" y="100" text-anchor="middle" class="ec-dona-e">' + esc(etiqueta) + '</text></svg>';
  }
  function grafica(pregunta, conclusion, cuerpo, extra, nivel) {
    return '<article class="ec-g ' + (nivel || 'pri') + '"><header class="ec-g-h"><small class="ec-g-q">' + pregunta + '</small>' + (extra || '') + '</header><h4 class="ec-g-t">' + conclusion + '</h4><div class="ec-g-b">' + cuerpo + '</div></article>';
  }
  function bloquePrincipal(r, rAnt) {
    const A = kpisDe(r), B = kpisDe(rAnt), h = histIni();
    const variacionTxt = (act, ant, base) => rAnt.ini < base ? '<span class="ec-dl na">histórico insuficiente para comparar</span>'
      : !ant ? '' : '<span class="ec-dl ' + (act >= ant ? 'up' : 'down') + '">' + (act >= ant ? '▲ +' : '▼ ') + Math.round(100 * (act - ant) / ant) + '% vs. ' + esc(rAnt.etq) + '</span>';
    // 1) ¿Cuánto se programa? — POR MES, todos los meses con datos (pedido del usuario 2026-11-27). Los meses del periodo elegido van
    //    resaltados y un clic entra a ese mes. «DETALLE» muestra el periodo día por día (lo de antes).
    const m1 = st.met.ventas || 'und', din1 = m1 === 'cop';
    const vista1 = st.met.vista1 || 'mes';
    const fmt1 = din1 ? cop : und;
    const queMide = din1 ? 'dinero vendido (facturas + remisiones de Effi, sin IVA)' : 'prendas programadas (pedidos del panel y del Google Sheets)';
    let serie, tit1, uni;
    if (vista1 === 'mes') {
      uni = 'mes';
      const h0 = hoy0(), desdeM = (din1 ? datos.desde : (datos.pedidos_desde || datos.desde)).slice(0, 7);
      serie = [];
      for (let d = new Date(desdeM + '-01T00:00:00'); d <= h0; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const ini = iso(d), fin = iso(new Date(d.getFullYear(), d.getMonth() + 1, 1));
        const b = { ini, fin, etq: MES[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : ''), largo: MES[d.getMonth()] + ' ' + d.getFullYear(),
          on: ini < r.fin && fin > r.ini, ir: 'mensual|' + ((d.getFullYear() - h0.getFullYear()) * 12 + (d.getMonth() - h0.getMonth())) };
        b.v = din1 ? kpisDe(b).dinero : kpisDe(b).unidades;
        serie.push(b);
      }
      const total = serie.reduce((t, b) => t + b.v, 0);
      const mejor = serie.reduce((m, b) => (!m || b.v > m.v ? b : m), null);
      const actual = serie[serie.length - 1];
      tit1 = mejor && mejor.v ? 'Mes con más ' + (din1 ? 'ventas' : 'prendas programadas') + ': <b>' + esc(mejor.largo) + '</b> con <b>' + fmt1(mejor.v) + '</b>' +
        '<span>Cada barra = ' + queMide + ' en el mes. Total de ' + serie.length + ' meses: ' + fmt1(total) + ' · promedio por mes: ' + fmt1(total / Math.max(1, serie.length)) +
        (actual ? ' · ' + esc(actual.largo) + ' va en ' + fmt1(actual.v) + ' (mes en curso)' : '') + '. Clic en un mes para verlo.</span>'
        : 'Sin ' + (din1 ? 'ventas' : 'prendas programadas') + ' todavía<span>Cada barra = ' + queMide + ' en el mes.</span>';
    } else {
      serie = detalle(r).map(b => ({ ...b, v: din1 ? kpisDe(b).dinero : kpisDe(b).unidades }));
      uni = st.periodo === 'anual' || (st.periodo === 'rango' && (r.dias || 0) > 62) ? 'mes' : 'día';
      const base1 = din1 ? datos.desde : (datos.pedidos_desde || datos.desde);
      const conVentas = serie.filter(b => !b.futuro && b.fin > base1);
      const mejor = conVentas.reduce((m, b) => (!m || b.v > m.v ? b : m), null);
      const promedio = conVentas.length ? conVentas.reduce((t, b) => t + b.v, 0) / conVentas.length : 0;
      tit1 = mejor && mejor.v ? 'El ' + uni + ' con más ' + (din1 ? 'ventas' : 'prendas programadas') + ' fue <b>' + esc(mejor.largo) + '</b>: <b>' + fmt1(mejor.v) + '</b><span>Cada barra = ' + queMide + ' ese ' + uni + '. Promedio por ' + uni + ': ' + fmt1(promedio) + '. Clic en una barra para verlo.</span>'
        : 'Sin ' + (din1 ? 'ventas' : 'prendas programadas') + ' en el periodo<span>Cada barra = ' + queMide + ' ese ' + uni + '.</span>';
    }
    const vistaSel = '<div class="ec-seg" role="group" aria-label="Vista"><button type="button" data-ec-met="vista1:mes" class="' + (vista1 === 'mes' ? 'on' : '') + '">POR MES</button><button type="button" data-ec-met="vista1:det" class="' + (vista1 === 'det' ? 'on' : '') + '">DETALLE</button></div>';
    const g1 = grafica(din1 ? '¿CUÁNTO SE VENDE?' : '¿CUÁNTO SE PROGRAMA?', tit1, columnas(serie, fmt1, din1, 'Programado por ' + uni), '<span class="ec-g-ctl">' + vistaSel + selMet('ventas', 'und') + '</span>');
    // 2) ¿Quién lo vende? — ranking por comercial (clic = filtrar todo)
    const m2 = st.met.quien || 'cop', din2 = m2 === 'cop';
    const S = datos.comerciales.map(c => statsComercial(c, r));
    const items = S.map(s => ({ id: s.c.id, etq: s.c.nombre, sigla: s.c.sigla, v: din2 ? s.dinero : s.unidades, on: st.comercial === s.c.id }))
      .filter(i => i.v > 0 || datos.comerciales.find(c => c.id === i.id).panel).sort((a, b) => b.v - a.v);
    const tot2 = items.reduce((s, i) => s + i.v, 0), lider = items[0], segundo = items[1];
    const fmt2 = din2 ? cop : und;
    // Lo primero que se ve: QUIÉN vende más (nombre grande con sus iniciales), cuánto y con cuánta ventaja sobre el segundo
    const cabeza2 = lider && lider.v
      ? '<span class="ec-lider"><i class="ec-av xl">' + esc(lider.sigla || '★') + '</i><span><small>EL QUE MÁS VENDE</small><b class="ec-lider-n">' + esc(lider.etq) + '</b>' +
        '<span class="ec-lider-d"><b>' + esc(fmt2(lider.v)) + '</b> · ' + pct(lider.v, tot2) + '% ' + (din2 ? 'del dinero' : 'de las unidades') +
        (segundo && segundo.v ? ' · ' + esc(fmt2(lider.v - segundo.v)) + ' más que ' + esc(segundo.etq) : '') + '</span></span></span>'
      : '<b class="ec-hero">—</b><span>nadie vende en el periodo</span>';
    const g2 = grafica('¿QUIÉN VENDE MÁS?', cabeza2,
      ranking(items, fmt2, true) + '<p class="ec-nota">Clic en un comercial para ver solo lo suyo.</p>', selMet('quien', 'cop'));
    // 3) ¿A quién se le vende? — clientes principales en dinero (Effi) o unidades (pedidos programados)
    const m3 = st.met.clientes || 'cop', din3 = m3 === 'cop';
    const porCli = {};
    (din3 ? A.V : A.P).forEach(x => { const k = norm(x.cliente) || 'SIN CLIENTE'; porCli[k] = (porCli[k] || 0) + (din3 ? x.sin_iva : x.unidades); });
    const cliOrden = Object.entries(porCli).sort((a, b) => b[1] - a[1]);
    const tot3 = cliOrden.reduce((t, x) => t + x[1], 0);
    const topCli = cliOrden.slice(0, 6).map(([n, v]) => ({ etq: n, v }));
    if (cliOrden.length > 6) topCli.push({ etq: 'Otros ' + (cliOrden.length - 6) + ' clientes', v: cliOrden.slice(6).reduce((t, x) => t + x[1], 0) });
    const g3 = grafica('¿A QUIÉN SE LE VENDE?', cliOrden.length ? '<b class="ec-hero">' + pct(cliOrden[0][1], tot3) + '%</b><span>' + (din3 ? 'del dinero' : 'de las unidades') + ' es de ' + esc(cliOrden[0][0]) + ' · ' + cliOrden.length + ' cliente(s) en el periodo</span>' : '<b class="ec-hero">—</b><span>sin ventas en el periodo</span>',
      ranking(topCli, din3 ? cop : und, false), selMet('clientes', 'cop'), 'sec');
    // 4) ¿Cuánto dinero representa? — tres bloques (pedido del usuario 2026-11-27): FACTURAS · REMISIÓN SIN FACTURAR · COTIZACIONES (todo de Effi, sin IVA)
    const facts = docsEn(datos.facturas, r), rems = docsEn(datos.remisiones, r).filter(d => !d.facturada), cots = docsEn(datos.cotizaciones, r);
    const facturado = suma(facts, 'sin_iva'), remisionado = suma(rems, 'sin_iva'), cotizado = suma(cots, 'sin_iva');
    const abiertas = cots.filter(d => estadoCot(d) === 'Abierta');
    const maxM = Math.max(1, facturado, remisionado, cotizado);
    const bloqueM = (t, v, n, nombreDoc, pie, color, cls) => '<div class="ec-m3' + (cls ? ' ' + cls : '') + '" data-tip="' + esc(t) + '|' + esc(cop(v)) + ' · ' + n + ' ' + nombreDoc + '" tabindex="0">' +
      '<small><i style="background:' + color + '"></i>' + t + '</small><b data-ec-cuenta="' + v + '|cop">' + cop(v) + '</b>' +
      '<span class="ec-m3-b"><i style="width:' + (100 * v / maxM).toFixed(1) + '%;background:' + color + '"></i></span><em>' + n + ' ' + nombreDoc + (pie ? ' · ' + pie : '') + '</em></div>';
    const g4 = grafica('¿CUÁNTO DINERO REPRESENTA?', '<b class="ec-hero">' + cop(facturado + remisionado) + '</b><span>vendido (facturas + remisiones sin facturar) · <strong>' + cop(cotizado) + '</strong> cotizado en el periodo</span>',
      '<div class="ec-m3s">' +
      bloqueM('FACTURAS', facturado, facts.length, facts.length === 1 ? 'factura' : 'facturas', pct(facturado, facturado + remisionado) + '% de lo vendido', C_ACENTO) +
      bloqueM('REMISIÓN SIN FACTURAR', remisionado, rems.length, rems.length === 1 ? 'remisión' : 'remisiones', pct(remisionado, facturado + remisionado) + '% de lo vendido', '#7f9c34') +
      bloqueM('COTIZACIONES', cotizado, cots.length, cots.length === 1 ? 'cotización' : 'cotizaciones', abiertas.length + ' abiertas (' + cop(suma(abiertas, 'sin_iva')) + ')', '#5aa9d6', 'cot') +
      '</div>', '', 'sec');
    const corta = t => t.replace('histórico insuficiente para comparar', 'sin periodo anterior');
    const mini = (t, v, pie, cls) => '<div class="ec-mini' + (cls ? ' ' + cls : '') + '"><small>' + t + '</small><b data-ec-cuenta="' + String(v).replace(/\./g, '') + '|n">' + v + '</b>' + (pie || '') + '</div>';
    const encabezado = '<header class="ec-top"><div class="ec-top-a"><small class="ec-top-q">VENTAS · ' + esc(r.largo.toUpperCase()) + '</small>' +
      '<div class="ec-top-n"><b data-ec-cuenta="' + A.dinero + '|cop">' + cop(A.dinero) + '</b>' + variacionTxt(A.dinero, B.dinero, h.effi) + '</div>' +
      '<small class="ec-top-s">Vendido sin IVA (facturas + remisiones sin facturar) · fuente Effi</small></div>' +
      '<div class="ec-top-b">' + mini('UNIDADES', nf.format(A.unidades), corta(variacionTxt(A.unidades, B.unidades, h.ped))) + mini('PEDIDOS', nf.format(A.pedidos), corta(variacionTxt(A.pedidos, B.pedidos, h.ped))) +
      mini('CLIENTES', nf.format(A.clientes), corta(variacionTxt(A.clientes, B.clientes, h.ped))) + '</div>' +
      '<div class="ec-top-x"><button type="button" class="ec-inf" data-ec-informe title="Descarga un informe HTML de este periodo para abrir, compartir o imprimir">⬇ Informe ' + esc({ diario: 'del día', semanal: 'de la semana', quincenal: 'de la quincena', mensual: 'del mes', anual: 'del año', rango: 'del rango' }[st.periodo]) + '</button><button type="button" class="ec-xls" data-ec-xls="resumen">⬇ Excel</button></div></header>';
    return '<section class="ec-blq ec-principal">' + encabezado +
      '<div class="ec-g4 pri">' + g1 + g2 + '</div><div class="ec-g4 sec">' + g3 + g4 + '</div></section>';
  }

  function bloqueResumen(r, rAnt) {
    const A = kpisDe(r), B = kpisDe(rAnt), h = histIni();
    // concentración
    const porCli = {}, porCliCop = {};
    A.P.forEach(p => { const c = norm(p.cliente) || 'SIN CLIENTE'; porCli[c] = (porCli[c] || 0) + p.unidades; });
    A.V.forEach(d => { const c = norm(d.cliente) || 'SIN CLIENTE'; porCliCop[c] = (porCliCop[c] || 0) + d.sin_iva; });
    const topU = Object.entries(porCli).sort((a, b) => b[1] - a[1])[0], topC = Object.entries(porCliCop).sort((a, b) => b[1] - a[1])[0];
    const kp = '<div class="ec-kpis">' +
      // Los 4 datos que importan (pedido del usuario 2026-11-26: «solo cuatro datos»). El resto queda en «Ver detalle» y en el Excel.
      kpi('VENDIDO · SIN IVA', cop(A.dinero), variacion(A.dinero, B.dinero, rAnt, h.effi), 100 * A.dinero / Math.max(1, A.dinero, B.dinero), 'ambar') +
      kpi('UNIDADES', und(A.unidades), variacion(A.unidades, B.unidades, rAnt, h.ped), 100 * A.unidades / Math.max(1, A.unidades, B.unidades), 'verde') +
      kpi('PEDIDOS', nf.format(A.pedidos), variacion(A.pedidos, B.pedidos, rAnt, h.ped), 100 * A.pedidos / Math.max(1, A.pedidos, B.pedidos), 'oliva') +
      kpi('CLIENTES', nf.format(A.clientes), variacion(A.clientes, B.clientes, rAnt, h.ped), 100 * A.clientes / Math.max(1, A.clientes, B.clientes), 'teal') +
      '</div>';
    const conc = '<div class="ec-conc">' +
      (topU ? '<div><b>' + pct(topU[1], A.unidades) + '%</b> de las unidades es de <strong>' + esc(topU[0]) + '</strong></div>' : '<div>Sin unidades en el periodo.</div>') +
      (topC ? '<div><b>' + pct(topC[1], A.dinero) + '%</b> del dinero vendido es de <strong>' + esc(topC[0]) + '</strong></div>' : '<div>Sin ventas en Effi en el periodo.</div>') + '</div>';
    const serieU = serieDe(rr => kpisDe(rr).unidades, 8), serieC = serieDe(rr => kpisDe(rr).dinero, 8);
    const m = st.met.resumen || 'und', serie = m === 'cop' ? serieC : serieU;
    const totVentas = serieDe(rr => kpisDe(rr).V, 8).reduce((s, x) => s.concat(x.v), []);
    const precio = suma(totVentas, 'unidades') ? suma(totVentas, 'sin_iva') / suma(totVentas, 'unidades') : 0;
    const titulo = m === 'cop' ? 'Dinero vendido (Effi, sin IVA): ' + cop(A.dinero) + ' en el periodo' : 'Unidades programadas: ' + und(A.unidades) + ' en el periodo';
    return '<section class="ec-blq" id="ec-resumen"><header class="ec-cab"><h3>1 · RESUMEN <small>' + esc(r.largo) + ' · valores en COP sin IVA</small></h3><button type="button" class="ec-xls" data-ec-xls="resumen">⬇ Excel</button></header>' + kp +
      plegable('resumen', 'Ver detalle del resumen', conc +
      '<div class="ec-grid2"><div class="ec-card"><div class="ec-card-cab"><h4>' + esc(titulo) + '</h4>' + selMet('resumen') + '</div>' + barras(serie, m === 'cop' ? cop : und, titulo) +
      (m === 'cop' ? '<p class="ec-nota">Precio promedio usado: ' + (precio ? cop(precio) + ' por und.' : 'sin unidades en Effi') + ' (Effi: subtotal ÷ cantidad de facturas y remisiones sin facturar).</p>' : '<p class="ec-nota">Un pedido cuenta una vez, en el periodo de su fecha de programación.</p>') + '</div>' +
      '<div class="ec-card"><h4>PEDIDOS PROGRAMADOS DEL PERIODO · ' + A.P.length + '</h4><div class="ec-tabla-w"><table class="ec-tabla"><thead><tr><th>PEDIDO</th><th>FECHA</th><th>CLIENTE</th><th>COMERCIAL</th><th class="n">UND.</th><th class="n">VALOR SIN IVA</th></tr></thead><tbody>' +
      (A.P.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).map(p => '<tr><td><b>' + esc(p.codigo) + '</b></td><td>' + dmy(p.fecha) + '</td><td>' + esc(p.cliente) + '</td><td>' + esc(nombreCom(p.comercial)) + '</td><td class="n">' + nf.format(p.unidades) + '</td><td class="n">' + (p.effi ? cop(p.effi.sin_iva) : 'sin precio') + '</td></tr>').join('') || '<tr><td colspan="6" class="ec-vacio">Sin pedidos en el periodo.</td></tr>') +
      '</tbody></table></div></div></div>' +
      clientesYReferencias(A)) + '</section>';
  }
  // Sección plegable (cerrada por defecto): guarda si el usuario la abrió, para que siga abierta al cambiar de periodo o filtro
  function plegable(id, texto, html) {
    return '<details class="ec-det" data-ec-det="' + id + '"' + (st.abiertos[id] ? ' open' : '') + '><summary>' + esc(texto) + '</summary><div class="ec-det-c">' + html + '</div></details>';
  }
  // Lo que ya tenía la pestaña: clientes y referencias más programadas (ahora del periodo y con los filtros)
  function clientesYReferencias(A) {
    const cli = {};
    A.P.forEach(p => { const k = norm(p.cliente) || 'SIN CLIENTE'; const c = cli[k] || (cli[k] = { n: k, ped: 0, und: 0, cop: 0 }); c.ped++; c.und += p.unidades; });
    A.V.forEach(d => { const k = norm(d.cliente) || 'SIN CLIENTE'; const c = cli[k] || (cli[k] = { n: k, ped: 0, und: 0, cop: 0 }); c.cop += d.sin_iva; });
    const filasCli = Object.values(cli).sort((a, b) => b.und - a.und || b.cop - a.cop).slice(0, 15);
    const refs = {};
    A.P.forEach(p => (p.referencias || []).forEach(r => { refs[r] = (refs[r] || 0) + 1; }));
    const top = Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => ({ etq: r, v: n }));
    return '<div class="ec-grid2"><div class="ec-card"><h4>CLIENTES DEL PERIODO</h4><div class="ec-tabla-w"><table class="ec-tabla"><thead><tr><th>CLIENTE</th><th class="n">PEDIDOS</th><th class="n">UND.</th><th class="n">VENDIDO SIN IVA</th></tr></thead><tbody>' +
      (filasCli.map(c => '<tr><td>' + esc(c.n) + '</td><td class="n">' + c.ped + '</td><td class="n">' + nf.format(c.und) + '</td><td class="n">' + cop(c.cop) + '</td></tr>').join('') || '<tr><td colspan="4" class="ec-vacio">Sin clientes en el periodo.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="ec-card"><h4>' + (top.length ? 'REFERENCIAS MÁS PROGRAMADAS · ' + esc(top[0].etq) + ' VA PRIMERO' : 'REFERENCIAS MÁS PROGRAMADAS') + '</h4>' + (top.length ? hbarras(top, v => v + ' pedido' + (v === 1 ? '' : 's')) : '<p class="ec-nota">Sin referencias en el periodo.</p>') + '</div></div>';
  }

  // LO QUE PROGRAMÓ CADA COMERCIAL (2026-11-27): pedidos del Sheet de producción + panel (desde el 1 de septiembre), por comercial y por mes
  function mesesDe(r) {
    const out = [], fin = new Date(r.fin + 'T00:00:00');
    for (let d = new Date(r.ini.slice(0, 7) + '-01T00:00:00'); d < fin; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const ini = new Date(Math.max(d, new Date(r.ini + 'T00:00:00'))), sig = new Date(Math.min(new Date(d.getFullYear(), d.getMonth() + 1, 1), fin));
      out.push({ ini: iso(ini), fin: iso(sig), etq: MES[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : '') });
    }
    return out;
  }
  function programadoPorComercial(r) {
    const P = pedidosEn(r, true), meses = mesesDe(r);
    const filas = datos.comerciales.map(c => {
      const l = P.filter(p => p.comercial === c.id);
      return { c, ped: l.length, und: suma(l, 'unidades'), cli: new Set(l.map(p => norm(p.cliente))).size,
        mes: meses.map(m => { const x = l.filter(p => dentro(p.fecha, m)); return { ped: x.length, und: suma(x, 'unidades') }; }) };
    }).filter(f => f.ped || (f.c.panel && f.c.id !== 'sin-comercial')).sort((a, b) => b.und - a.und || b.ped - a.ped);
    return { meses, filas, totU: suma(filas, 'und'), totP: suma(filas, 'ped') };
  }
  function bloqueProgramado(r) {
    const { meses, filas, totU, totP } = programadoPorComercial(r);
    const inicio = datos.pedidos_desde || '';
    const lider = filas[0] && filas[0].und ? filas[0] : null;
    const concl = lider ? esc(lider.c.nombre) + ' programó <b>' + pct(lider.und, totU) + '%</b> de las ' + nf.format(totU) + ' unidades (' + nf.format(totP) + ' pedidos) del periodo.' : 'Ningún comercial programó en el periodo.';
    const tarjetas = filas.map(f => '<button type="button" class="ec-com ec-prog' + (st.comercial === f.c.id ? ' on' : '') + (f.c.panel ? '' : ' effi') + '" data-ec-com="' + esc(f.c.id) + '" data-lq="' + pct(f.und, totU || 1) + '" data-lq-tone="' + (f.c.panel && f.c.id !== 'sin-comercial' ? 'verde' : 'gris') + '">' +
      '<span class="ec-com-cab"><i>' + esc(f.c.sigla) + '</i><strong>' + esc(f.c.nombre) + '</strong></span>' +
      '<span class="ec-com-g ec-prog-g"><span><small>UNIDADES</small><b>' + nf.format(f.und) + '</b></span><span><small>PEDIDOS</small><b>' + nf.format(f.ped) + '</b></span><span><small>CLIENTES</small><b>' + nf.format(f.cli) + '</b></span></span>' +
      (meses.length > 1 ? '<span class="ec-prog-m">' + meses.map((m, i) => '<em>' + esc(m.etq) + ' <b>' + nf.format(f.mes[i].und) + '</b> und · ' + f.mes[i].ped + ' ped.</em>').join('') + '</span>' : '') + '</button>').join('');
    return '<section class="ec-blq" id="ec-programado"><header class="ec-cab"><h3>LO QUE PROGRAMÓ CADA COMERCIAL <small>' + esc(r.largo) + ' · pedidos del Sheet de producción y del panel' + (inicio ? ' · datos desde el ' + dmy(inicio) : '') + ' · clic para filtrar todo</small></h3>' +
      '<div class="ec-cab-b">' + (st.periodo === 'rango' && st.desde === inicio ? '' : '<button type="button" class="ec-xls" data-ec-rapido="sep">Desde el 1 sep</button>') + '<button type="button" class="ec-xls" data-ec-xls="programado">⬇ Excel</button></div></header>' +
      '<p class="ec-concl">' + concl + '</p><div class="ec-coms">' + (tarjetas || '<p class="ec-nota">Sin pedidos en el periodo.</p>') + '</div></section>';
  }

  const nombreCom = id => ((datos.comerciales.find(c => c.id === id) || {}).nombre) || id;
  function statsComercial(c, r) {
    const P = datos.pedidos.filter(p => p.comercial === c.id && dentro(p.fecha, r) && clienteOk(p) && (!st.linea || (p.lineas || []).includes(st.linea)));
    const V = ventasEn(r, true).filter(d => d.comercial === c.id);
    const Q = docsEn(datos.cotizaciones, r, true).filter(d => d.comercial === c.id);
    const conv = Q.filter(d => estadoCot(d) === 'Aceptada').length;
    const conPrecio = P.filter(p => p.effi);
    return { c, pedidos: P.length, unidades: suma(P, 'unidades'), dinero: suma(V, 'sin_iva'), clientes: new Set(P.map(p => norm(p.cliente)).concat(V.map(d => norm(d.cliente)))).size,
      cot: Q.length, conv, tasa: pct(conv, Q.length), atrasados: P.filter(p => p.estado.atrasado).length,
      ticket: conPrecio.length ? conPrecio.reduce((s, p) => s + p.effi.sin_iva, 0) / conPrecio.length : null, sinPrecio: P.length - conPrecio.length };
  }
  function bloqueComerciales(r) {
    const S = datos.comerciales.map(c => statsComercial(c, r));
    const totD = suma(S, 'dinero'), totU = suma(S, 'unidades');
    const tarjetas = S.map(s => '<button type="button" class="ec-com' + (st.comercial === s.c.id ? ' on' : '') + (s.c.panel ? '' : ' effi') + '" data-ec-com="' + esc(s.c.id) + '" data-lq="' + pct(s.dinero, totD || 1) + '" data-lq-tone="' + (s.c.panel ? 'verde' : 'gris') + '" data-lq-nopct title="' + esc(s.c.effi.length ? 'En Effi: ' + s.c.effi.join(', ') : 'Sin documentos en Effi en los últimos meses') + '">' +
      '<span class="ec-com-cab"><i>' + esc(s.c.sigla) + '</i><strong>' + esc(s.c.nombre) + '</strong>' + (s.c.panel ? '' : s.c.id === 'sin-comercial' ? '<em>RESP vacío u otro</em>' : '<em>solo Effi</em>') + '</span>' +
      // 4 datos por comercial: vendido, pedidos, unidades y conversión (clientes, atrasados, participación y ticket van en el Excel)
      '<span class="ec-com-g"><span><small>VENDIDO</small><b>' + cop(s.dinero) + '</b><em>' + pct(s.dinero, totD) + '% del total</em></span><span><small>PEDIDOS</small><b>' + s.pedidos + '</b></span><span><small>UNIDADES</small><b>' + nf.format(s.unidades) + '</b></span>' +
      '<span><small>CONVERSIÓN</small><b>' + (s.cot ? s.tasa + '%' : '—') + '</b><em>' + (s.cot ? s.conv + ' de ' + s.cot + ' cotizaciones' : 'sin cotizaciones') + '</em></span></span></button>').join('');
    const MET = { dinero: ['DINERO', s => s.dinero, cop], unidades: ['UNIDADES', s => s.unidades, und], pedidos: ['PEDIDOS', s => s.pedidos, v => nf.format(v)], conversion: ['CONVERSIÓN', s => s.tasa, v => v + '%'] };
    const mt = MET[st.metCom] || MET.dinero;
    const items = S.map(s => ({ id: s.c.id, etq: s.c.nombre, v: mt[1](s), on: st.comercial === s.c.id })).sort((a, b) => b.v - a.v);
    const lider = items[0];
    const tituloG = lider && lider.v ? lider.etq + ' lidera en ' + mt[0].toLowerCase() + ' con ' + mt[2](lider.v) : 'Ningún comercial tiene ' + mt[0].toLowerCase() + ' en el periodo';
    const seg = '<div class="ec-seg">' + Object.keys(MET).map(k => '<button type="button" data-ec-metcom="' + k + '" class="' + (st.metCom === k ? 'on' : '') + '">' + MET[k][0] + '</button>').join('') + '</div>';
    return '<section class="ec-blq" id="ec-comerciales"><header class="ec-cab"><h3>2 · VENTAS POR COMERCIAL <small>clic en un comercial para filtrar todo · COP sin IVA</small></h3><button type="button" class="ec-xls" data-ec-xls="comerciales">⬇ Excel</button></header>' +
      '<div class="ec-coms">' + tarjetas + '</div>' +
      plegable('comerciales', 'Ver comparación entre comerciales', '<div class="ec-card"><div class="ec-card-cab"><h4>' + esc(tituloG) + '</h4>' + seg + '</div>' + hbarras(items, mt[2], true) +
      (st.metCom === 'dinero' ? '<p class="ec-nota">Dinero = facturas + remisiones aún sin facturar (Effi), por vendedor de Effi.' + (totU ? ' Precio promedio: ' + cop(totD / Math.max(1, suma(ventasEn(r, true), 'unidades'))) + ' por und. vendida.' : '') + '</p>' : '') + '</div>') + '</section>';
  }

  function bloqueCotizacion(r) {
    const Q = docsEn(datos.cotizaciones, r).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const acept = Q.filter(d => estadoCot(d) === 'Aceptada').length;
    const m = st.met.cot || 'und';
    const serie = serieDe(rr => { const l = docsEn(datos.cotizaciones, rr); return m === 'cop' ? suma(l, 'sin_iva') : suma(l, 'unidades'); }, 8);
    const tasas = serieDe(rr => { const l = docsEn(datos.cotizaciones, rr); return pct(l.filter(d => estadoCot(d) === 'Aceptada').length, l.length); }, 8);
    const ult = serieDe(rr => docsEn(datos.cotizaciones, rr), 8).reduce((s, x) => s.concat(x.v), []);
    const precio = suma(ult, 'unidades') ? suma(ult, 'sin_iva') / suma(ult, 'unidades') : 0;
    const titulo = Q.length ? pct(acept, Q.length) + '% de las ' + Q.length + ' cotizaciones del periodo ya se convirtió en pedido' : 'Sin cotizaciones en el periodo';
    const porCom = datos.comerciales.map(c => { const l = Q.filter(d => d.comercial === c.id); const a = l.filter(d => estadoCot(d) === 'Aceptada').length; return { c, n: l.length, a, v: suma(l, 'sin_iva') }; }).filter(x => x.n || x.c.panel);
    const EST = { Abierta: '#9fb39a', Aceptada: '#d0f44c', Vencida: '#f5b041' };
    return '<section class="ec-blq" id="ec-cotizacion"><header class="ec-cab"><h3>3 · COTIZACIÓN <small>Effi · COP sin IVA · IVA aparte</small></h3><button type="button" class="ec-xls" data-ec-xls="cotizacion">⬇ Excel</button></header>' + '<p class="ec-concl">' + esc(titulo) + '</p>' + plegable('cotizacion', 'Ver cotizaciones y conversión', '' +
      '<div class="ec-grid2"><div class="ec-card"><div class="ec-card-cab"><h4>' + esc(titulo) + '</h4>' + selMet('cot') + '</div>' + barras(serie, m === 'cop' ? cop : und, titulo) +
      '<p class="ec-nota">Conversión por periodo: ' + tasas.map(t => esc(t.etq) + ' ' + t.v + '%').join(' · ') + '</p>' + (m === 'cop' ? '<p class="ec-nota">Precio promedio usado: ' + (precio ? cop(precio) + ' por und.' : '—') + ' (subtotal ÷ cantidad de las cotizaciones).</p>' : '') + '</div>' +
      '<div class="ec-card"><h4>CONVERSIÓN COTIZACIÓN → PEDIDO POR COMERCIAL</h4><div class="ec-tabla-w"><table class="ec-tabla"><thead><tr><th>COMERCIAL</th><th class="n">EMITIDAS</th><th class="n">CONVERTIDAS</th><th class="n">TASA</th><th class="n">COTIZADO</th></tr></thead><tbody>' +
      porCom.map(x => '<tr><td>' + esc(x.c.nombre) + '</td><td class="n">' + x.n + '</td><td class="n">' + x.a + '</td><td class="n">' + (x.n ? pct(x.a, x.n) + '%' : '—') + '</td><td class="n">' + cop(x.v) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="ec-nota">Aceptada = Effi la convirtió en orden, remisión o factura, o ya hay un pedido CO con ese número. Vencida = pendiente con más de ' + datos.reglas.dias_vencida + ' días. Effi no marca cotizaciones «perdidas»; las anuladas no se cuentan.</p></div></div>' +
      '<div class="ec-card"><h4>COTIZACIONES DEL PERIODO · ' + Q.length + '</h4><div class="ec-tabla-w ec-alta"><table class="ec-tabla"><thead><tr><th>N.º</th><th>FECHA</th><th>CLIENTE</th><th>COMERCIAL</th><th class="n">UND.</th><th class="n">VALOR SIN IVA</th><th class="n">IVA</th><th>ESTADO</th></tr></thead><tbody>' +
      (Q.map(d => { const e = estadoCot(d); return '<tr><td><b>' + esc(d.numero) + '</b></td><td>' + dmy(d.fecha) + '</td><td>' + esc(d.cliente) + '</td><td>' + esc(nombreCom(d.comercial)) + '</td><td class="n">' + nf.format(d.unidades) + '</td><td class="n">' + cop(d.sin_iva) + '</td><td class="n">' + cop(d.iva) + '</td><td><span class="ec-est" style="--c:' + EST[e] + '">' + e + '</span></td></tr>'; }).join('') || '<tr><td colspan="8" class="ec-vacio">Sin cotizaciones.</td></tr>') +
      '</tbody></table></div></div>') + '</section>';
  }

  function bloqueRemision(r) {
    const R = docsEn(datos.remisiones, r).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const conPedido = new Set(datos.pedidos.filter(p => p.codigo.startsWith('RM')).map(p => p.codigo.slice(2)).concat(datos.pedidos.map(p => p.effi && p.effi.id_remision_v).filter(Boolean)));
    const m = st.met.rem || 'cop';
    const serie = serieDe(rr => { const l = docsEn(datos.remisiones, rr); return m === 'cop' ? suma(l, 'sin_iva') : suma(l, 'unidades'); }, 8);
    const ult = serieDe(rr => docsEn(datos.remisiones, rr), 8).reduce((s, x) => s.concat(x.v), []);
    const precio = suma(ult, 'unidades') ? suma(ult, 'sin_iva') / suma(ult, 'unidades') : 0;
    const pend = R.filter(d => !d.facturada);
    const titulo = R.length ? pend.length + ' de ' + R.length + ' remisiones del periodo siguen sin facturar (' + cop(suma(pend, 'sin_iva')) + ')' : 'Sin remisiones en el periodo';
    return '<section class="ec-blq" id="ec-remision"><header class="ec-cab"><h3>4 · REMISIÓN <small>Effi · COP sin IVA · IVA aparte</small></h3><button type="button" class="ec-xls" data-ec-xls="remision">⬇ Excel</button></header>' + '<p class="ec-concl">' + esc(titulo) + '</p>' + plegable('remision', 'Ver remisiones', '' +
      '<div class="ec-grid2"><div class="ec-card"><div class="ec-card-cab"><h4>' + esc(titulo) + '</h4>' + selMet('rem') + '</div>' + barras(serie, m === 'cop' ? cop : und, titulo) +
      (m === 'cop' ? '<p class="ec-nota">Precio promedio usado: ' + (precio ? cop(precio) + ' por und.' : '—') + ' (subtotal ÷ cantidad de las remisiones).</p>' : '') + '</div>' +
      '</div>' +
      '<div class="ec-card"><h4>REMISIONES DEL PERIODO · ' + R.length + '</h4><div class="ec-tabla-w ec-alta"><table class="ec-tabla"><thead><tr><th>N.º</th><th>FECHA</th><th>CLIENTE</th><th>COMERCIAL</th><th class="n">UND.</th><th class="n">VALOR SIN IVA</th><th class="n">IVA</th><th>ESTADO</th><th>ENTREGA</th><th>PEDIDO</th></tr></thead><tbody>' +
      (R.map(d => '<tr><td><b>' + esc(d.numero) + '</b></td><td>' + dmy(d.fecha) + '</td><td>' + esc(d.cliente) + '</td><td>' + esc(nombreCom(d.comercial)) + '</td><td class="n">' + nf.format(d.unidades) + '</td><td class="n">' + cop(d.sin_iva) + '</td><td class="n">' + cop(d.iva) + '</td><td><span class="ec-est" style="--c:' + (d.facturada ? '#4fd1a5' : '#f5b041') + '">' + (d.facturada ? 'Facturada' : 'Pendiente de facturar') + '</span></td><td>' + dmy(d.entrega) + '</td><td>' + (conPedido.has(d.id) ? '✓' : '—') + '</td></tr>').join('') || '<tr><td colspan="10" class="ec-vacio">Sin remisiones.</td></tr>') +
      '</tbody></table></div></div>') + '</section>';
  }

  function bloqueValidaciones(r) {
    const A = kpisDe(r);
    const S = datos.comerciales.map(c => statsComercial(c, r));
    const porCliente = {}; A.V.forEach(d => { porCliente[norm(d.cliente)] = (porCliente[norm(d.cliente)] || 0) + d.sin_iva; });
    const sumCom = suma(S, 'dinero'), sumCli = Object.values(porCliente).reduce((a, b) => a + b, 0);
    const sumComU = suma(S, 'unidades');
    const ok = (a, b) => Math.abs(a - b) < 1 ? '<b class="ok">✓ cuadra</b>' : '<b class="mal">✗ diferencia ' + cop(a - b) + '</b>';
    const totEffi = st.comercial || st.cliente ? null : suma(ventasEn(r, true), 'sin_iva');
    // referencias programadas sin precio en Effi
    const conPrecio = new Set([].concat(datos.cotizaciones, datos.remisiones, datos.facturas).reduce((s, d) => s.concat(d.refs.filter(x => x.precio > 0).map(x => norm(x.ref))), []));
    const sinPrecio = [...new Set(A.P.reduce((s, p) => s.concat(p.referencias || []), []).filter(ref => !conPrecio.has(norm(ref))))];
    const pedSinEffi = A.P.filter(p => !p.effi);
    const cuadra = Math.abs(sumCom - (st.comercial ? sumCom : A.dinero)) < 1 && Math.abs(sumCli - A.dinero) < 1;
    const conclVal = (cuadra ? '✓ Los totales cuadran con Effi' : '✗ Hay diferencias con Effi') + ' · ' + (pedSinEffi.length ? pedSinEffi.length + ' pedido(s) sin precio en Effi' : 'todos los pedidos tienen precio en Effi');
    return '<section class="ec-blq" id="ec-validar"><header class="ec-cab"><h3>5 · CONTROL Y CONCILIACIÓN <small>' + esc(r.largo) + '</small></h3><button type="button" class="ec-xls" data-ec-xls="validar">⬇ Excel</button></header>' + '<p class="ec-concl">' + esc(conclVal) + '</p>' + plegable('validar', 'Ver control y conciliación', '<div class="ec-grid2">' +
      '<div class="ec-card"><h4>TOTALES DE CONTROL (DINERO SIN IVA)</h4><ul class="ec-lista">' +
      '<li>Suma por comercial: ' + cop(sumCom) + ' · total general: ' + cop(A.dinero) + ' ' + ok(sumCom, st.comercial ? sumCom : A.dinero) + '</li>' +
      '<li>Suma por cliente: ' + cop(sumCli) + ' · total general: ' + cop(A.dinero) + ' ' + ok(sumCli, A.dinero) + '</li>' +
      '<li>Unidades por comercial: ' + und(sumComU) + ' · total: ' + und(A.unidades) + ' ' + (Math.abs(sumComU - A.unidades) < 1 || st.comercial ? '<b class="ok">✓ cuadra</b>' : '<b class="mal">✗ no cuadra</b>') + '</li>' +
      (totEffi == null ? '' : '<li>Total Effi del periodo (facturas + remisiones sin facturar): ' + cop(totEffi) + ' ' + ok(totEffi, sumCom) + '</li>') + '</ul>' +
      '<p class="ec-nota">Todo el dinero viene de Effi. El total por comercial usa el vendedor de cada documento en Effi; por eso aparecen también los vendedores de Effi que no programan en el panel.</p></div>' +
      '<div class="ec-card"><h4>DATOS QUE FALTAN PARA EL VALOR EN PESOS</h4><ul class="ec-lista">' +
      '<li>' + pedSinEffi.length + ' pedido(s) del periodo sin su cotización/remisión en Effi' + (pedSinEffi.length ? ': ' + pedSinEffi.map(p => esc(p.codigo)).join(', ') : '') + '</li>' +
      '<li>' + sinPrecio.length + ' referencia(s) programada(s) «sin precio» en Effi' + (sinPrecio.length ? ': ' + sinPrecio.map(esc).join(', ') : '') + '</li></ul>' +
      '<p class="ec-nota">Unidades = prendas de los pedidos programados (panel y Google Sheets desde el 1 de octubre). Dinero = Effi.</p></div></div>') + '</section>';
  }

  // ------------------------------------------------------------------ Excel
  function hojasDe(bloque, r) {
    const A = kpisDe(r);
    const fil = d => [d.numero, d.fecha, d.cliente, nombreCom(d.comercial), d.vendedor_effi, d.unidades, Math.round(d.sin_iva), Math.round(d.iva)];
    const cab = ['N.º', 'FECHA', 'CLIENTE', 'COMERCIAL', 'VENDEDOR EN EFFI', 'UNIDADES', 'VALOR SIN IVA (COP)', 'IVA (COP)'];
    if (bloque === 'resumen') return [{ nombre: 'Resumen', columnas: ['PERIODO', 'UNIDADES', 'PEDIDOS', 'CLIENTES', 'VENDIDO SIN IVA (COP)', 'IVA (COP)'], filas: [[r.largo, A.unidades, A.pedidos, A.clientes, Math.round(A.dinero), Math.round(A.iva)]] },
      { nombre: 'Pedidos', columnas: ['PEDIDO', 'FECHA', 'CLIENTE', 'COMERCIAL', 'UNIDADES', 'VALOR EFFI SIN IVA (COP)'], filas: A.P.map(p => [p.codigo, p.fecha, p.cliente, nombreCom(p.comercial), p.unidades, p.effi ? Math.round(p.effi.sin_iva) : 'sin precio']) }];
    if (bloque === 'comerciales') return [{ nombre: 'Comerciales', columnas: ['COMERCIAL', 'PEDIDOS', 'UNIDADES', 'VENDIDO SIN IVA (COP)', 'CLIENTES', 'COTIZACIONES', 'CONVERTIDAS', 'TASA %', 'TICKET/PEDIDO (COP)', 'VENDEDOR EN EFFI'],
      filas: datos.comerciales.map(c => { const s = statsComercial(c, r); return [c.nombre, s.pedidos, s.unidades, Math.round(s.dinero), s.clientes, s.cot, s.conv, s.tasa, s.ticket == null ? '' : Math.round(s.ticket), c.effi.join(', ')]; }) }];
    if (bloque === 'programado') {
      const { meses, filas } = programadoPorComercial(r);
      return [{ nombre: 'Programado por comercial', columnas: ['COMERCIAL', 'PEDIDOS', 'UNIDADES', 'CLIENTES'].concat(meses.reduce((s, m) => s.concat([m.etq.toUpperCase() + ' UND.', m.etq.toUpperCase() + ' PED.']), [])),
        filas: filas.map(f => [f.c.nombre, f.ped, f.und, f.cli].concat(f.mes.reduce((s, m) => s.concat([m.und, m.ped]), []))) },
        { nombre: 'Pedidos', columnas: ['PEDIDO', 'FECHA', 'CLIENTE', 'COMERCIAL', 'RESP', 'UNIDADES', 'ESTADO'],
          filas: pedidosEn(r, true).sort((a, b) => a.fecha.localeCompare(b.fecha)).map(p => [p.codigo, p.fecha, p.cliente, nombreCom(p.comercial), p.resp, p.unidades, p.estado.texto]) }];
    }
    if (bloque === 'cotizacion') return [{ nombre: 'Cotizaciones', columnas: cab.concat(['ESTADO']), filas: docsEn(datos.cotizaciones, r).map(d => fil(d).concat([estadoCot(d)])) }];
    if (bloque === 'remision') return [{ nombre: 'Remisiones', columnas: cab.concat(['ESTADO', 'ENTREGA']), filas: docsEn(datos.remisiones, r).map(d => fil(d).concat([d.facturada ? 'Facturada' : 'Pendiente de facturar', d.entrega])) }];
    return [{ nombre: 'Ventas Effi', columnas: cab.concat(['TIPO']), filas: A.V.map(d => fil(d).concat([d.tipo])) }];
  }
  async function exportar(bloque) {
    const r = rango(st.periodo, st.off);
    try {
      const res = await fetch('/api/estadisticas-comerciales/excel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'estadisticas_' + bloque, hojas: hojasDe(bloque, r) }) });
      if (!res.ok) throw new Error('No se pudo exportar');
      const b = await res.blob(), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'estadisticas_' + bloque + '_' + r.ini + '.xlsx'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------------------------ INFORME HTML (para abrir, compartir o imprimir)
  function descargarInforme() {
    const r = rango(st.periodo, st.off), rAnt = rango(st.periodo, st.off - 1), A = kpisDe(r), B = kpisDe(rAnt);
    const filtrosTxt = [st.comercial ? 'Comercial: ' + nombreCom(st.comercial) : 'Todos los comerciales', st.cliente ? 'Cliente: ' + st.cliente : 'Todos los clientes', st.linea ? 'Línea: ' + st.linea : ''].filter(Boolean).join(' · ');
    const vari = (a, b) => b ? (a >= b ? '▲ +' : '▼ ') + Math.round(100 * (a - b) / b) + '% vs. ' + rAnt.largo.toLowerCase() : '';
    const tabla = (cab, filas, num) => '<table><thead><tr>' + cab.map((c, i) => '<th' + (num.includes(i) ? ' class="n"' : '') + '>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      (filas.length ? filas.map(f => '<tr>' + f.map((c, i) => '<td' + (num.includes(i) ? ' class="n"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cab.length + '" class="vacio">Sin datos</td></tr>') + '</tbody></table>';
    // ventas por día (o por mes en el año) — lo que el jefe necesita para saber cuánto se vendió en un día
    const dias = [];
    if (st.periodo === 'anual' || st.periodo === 'rango') {
      for (const d = new Date(r.ini + 'T00:00:00'); iso(d) < r.fin; d.setDate(d.getDate() + 1)) { const sig = new Date(d); sig.setDate(sig.getDate() + 1); dias.push({ ini: iso(d), fin: iso(sig), largo: DIA[d.getDay()] + ' ' + d.getDate() + ' ' + MES[d.getMonth()] }); }
    } else {
      for (const d = new Date(r.ini + 'T00:00:00'); iso(d) < r.fin; d.setDate(d.getDate() + 1)) { const sig = new Date(d); sig.setDate(sig.getDate() + 1); dias.push({ ini: iso(d), fin: iso(sig), largo: DIA[d.getDay()] + ' ' + d.getDate() + ' ' + MES[d.getMonth()] + ' ' + d.getFullYear() }); }
    }
    const filasDia = dias.map(b => ({ b, k: kpisDe(b) })).filter(x => x.k.dinero || x.k.unidades || x.k.V.length)
      .map(({ b, k }) => [esc(b.largo), cop(k.dinero), cop(k.iva), k.V.length, nf.format(k.unidades), k.pedidos]);
    const serieDet = detalle(r).map(b => ({ ...b, ir: '', v: kpisDe(b).dinero }));
    const svg = columnas(serieDet, cop, true, 'Ventas').replace(new RegExp(C_ACENTO, 'g'), '#4f7f00').replace(new RegExp(C_SUAVE, 'g'), '#c5d1b8').replace(/#7f9c34/g, '#8fb34a').replace(new RegExp(C_EJE, 'g'), '#e6ebe1').replace(/#3a483c/g, '#b9c2b2');
    const S = datos.comerciales.map(c => statsComercial(c, r)).filter(x => x.dinero || x.pedidos || x.cot).sort((a, b) => b.dinero - a.dinero);
    const totD = S.reduce((t, x) => t + x.dinero, 0) || 1;
    const barrasCom = S.map(x => '<div class="rk"><span>' + esc(x.c.nombre) + '</span><i><b style="width:' + (100 * x.dinero / (S[0].dinero || 1)).toFixed(1) + '%"></b></i><em>' + cop(x.dinero) + ' · ' + pct(x.dinero, totD) + '%</em></div>').join('');
    const cli = {};
    A.V.forEach(d => { const k = norm(d.cliente) || 'SIN CLIENTE'; (cli[k] = cli[k] || { cop: 0, und: 0, ped: 0 }).cop += d.sin_iva; });
    A.P.forEach(p => { const k = norm(p.cliente) || 'SIN CLIENTE'; const c = cli[k] = cli[k] || { cop: 0, und: 0, ped: 0 }; c.und += p.unidades; c.ped++; });
    const filasCli = Object.entries(cli).sort((a, b) => b[1].cop - a[1].cop || b[1].und - a[1].und).slice(0, 40).map(([n, c]) => [esc(n), cop(c.cop), pct(c.cop, A.dinero || 1) + '%', nf.format(c.und), c.ped]);
    const docs = A.V.slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero))
      .map(d => [dmy(d.fecha), d.tipo === 'factura' ? 'Factura ' + esc(d.numero_factura || d.numero) : 'Remisión ' + esc(d.numero), esc(d.cliente), esc(nombreCom(d.comercial)), nf.format(d.unidades), cop(d.sin_iva), cop(d.iva)]);
    const peds = A.P.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(p => [dmy(p.fecha), esc(p.codigo), esc(p.cliente), esc(nombreCom(p.comercial)), nf.format(p.unidades), p.effi ? cop(p.effi.sin_iva) : 'sin precio']);
    const ahora = new Date();
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe de ventas · ' + esc(r.largo) + '</title><style>' +
      'body{margin:0;background:#f4f6f1;color:#18201a;font-family:Arial,Helvetica,sans-serif}main{max-width:1080px;margin:0 auto;padding:32px 28px 48px}' +
      'header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;padding-bottom:18px;border-bottom:3px solid #4f7f00}h1{margin:0;font-size:30px;letter-spacing:-.02em}header small{color:#5c6658;font-weight:700}' +
      '.marca{font-weight:900;letter-spacing:.18em;color:#4f7f00;font-size:12px}.hero{margin:26px 0 10px;display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:14px}' +
      '.k{background:#fff;border:1px solid #dfe5d8;border-radius:14px;padding:16px 18px}.k small{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;color:#5c6658}.k b{display:block;font-size:26px;margin:6px 0 2px}.k.top b{font-size:34px;color:#2f5200}.k em{font-style:normal;font-size:12px;font-weight:700;color:#5c6658}' +
      'section{margin-top:26px;background:#fff;border:1px solid #dfe5d8;border-radius:16px;padding:18px 20px}h2{margin:0 0 12px;font-size:15px;letter-spacing:.08em;color:#2f5200}' +
      'table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;font-size:10.5px;letter-spacing:.1em;color:#5c6658;border-bottom:2px solid #dfe5d8;padding:7px 8px}td{padding:7px 8px;border-bottom:1px solid #eef1ea}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tbody tr:hover{background:#f6f9f2}.vacio{text-align:center;color:#8a9486}' +
      'svg{width:100%;height:auto}.ec-ax{fill:#6b7566;font:600 10.5px Arial}.ec-ax.on{fill:#18201a;font-weight:800}.ec-vl{fill:#18201a;font:800 11px Arial}' +
      '.rk{display:grid;grid-template-columns:240px 1fr 200px;gap:12px;align-items:center;margin:8px 0;font-size:13px;font-weight:700}.rk i{height:12px;background:#eef1ea;border-radius:0 4px 4px 0}.rk i b{display:block;height:100%;background:#4f7f00;border-radius:0 4px 4px 0}.rk em{font-style:normal;text-align:right}' +
      '.nota{font-size:11.5px;color:#5c6658;line-height:1.5}footer{margin-top:24px;font-size:11px;color:#8a9486;text-align:center}' +
      '@media print{body{background:#fff}section,.k{break-inside:avoid}main{padding:0}}@media (max-width:700px){.hero{grid-template-columns:1fr 1fr}.rk{grid-template-columns:1fr;gap:4px}.rk em{text-align:left}}' +
      '</style></head><body><main><header><div><div class="marca">INDOOR SPORT · INFORME DE VENTAS</div><h1>' + esc(r.largo) + '</h1><small>' + esc(filtrosTxt) + '</small></div><small>Generado el ' + ahora.toLocaleString('es-CO') + '</small></header>' +
      '<div class="hero"><div class="k top"><small>VENDIDO SIN IVA</small><b>' + cop(A.dinero) + '</b><em>' + esc(vari(A.dinero, B.dinero)) + ' · IVA ' + cop(A.iva) + '</em></div>' +
      '<div class="k"><small>UNIDADES PROGRAMADAS</small><b>' + nf.format(A.unidades) + '</b><em>' + esc(vari(A.unidades, B.unidades)) + '</em></div>' +
      '<div class="k"><small>PEDIDOS</small><b>' + nf.format(A.pedidos) + '</b><em>' + esc(vari(A.pedidos, B.pedidos)) + '</em></div>' +
      '<div class="k"><small>CLIENTES</small><b>' + nf.format(A.clientes) + '</b><em>' + esc(vari(A.clientes, B.clientes)) + '</em></div></div>' +
      '<section><h2>VENTAS POR ' + (st.periodo === 'anual' || (st.periodo === 'rango' && (r.dias || 0) > 62) ? 'MES' : 'DÍA') + '</h2>' + svg + '</section>' +
      '<section><h2>' + (st.periodo === 'anual' ? 'DETALLE POR DÍA (DÍAS CON MOVIMIENTO)' : 'CUÁNTO SE VENDIÓ CADA DÍA') + '</h2>' + tabla(['Día', 'Vendido sin IVA', 'IVA', 'Documentos', 'Unidades programadas', 'Pedidos'], filasDia, [1, 2, 3, 4, 5]) + '</section>' +
      '<section><h2>VENTAS POR COMERCIAL</h2>' + barrasCom + tabla(['Comercial', 'Vendido sin IVA', 'Participación', 'Pedidos', 'Unidades', 'Cotizaciones', 'Conversión'], S.map(x => [esc(x.c.nombre), cop(x.dinero), pct(x.dinero, totD) + '%', x.pedidos, nf.format(x.unidades), x.cot, x.cot ? x.tasa + '%' : '—']), [1, 2, 3, 4, 5, 6]) + '</section>' +
      '<section><h2>VENTAS POR CLIENTE</h2>' + tabla(['Cliente', 'Vendido sin IVA', '% del total', 'Unidades', 'Pedidos'], filasCli, [1, 2, 3, 4]) + '</section>' +
      '<section><h2>DOCUMENTOS DE VENTA EN EFFI · ' + docs.length + '</h2>' + tabla(['Fecha', 'Documento', 'Cliente', 'Comercial', 'Und.', 'Sin IVA', 'IVA'], docs, [4, 5, 6]) + '</section>' +
      '<section><h2>PEDIDOS PROGRAMADOS · ' + peds.length + '</h2>' + tabla(['Fecha', 'Pedido', 'Cliente', 'Comercial', 'Unidades', 'Valor sin IVA'], peds, [4, 5]) + '</section>' +
      '<p class="nota">Vendido = facturas + remisiones aún sin facturar de Effi, sin IVA (el IVA va aparte). Unidades = prendas de los pedidos programados en el panel y en el Google Sheets (desde el 1 de octubre de 2026); el comercial es la columna RESP. Valores en pesos colombianos.</p>' +
      '<footer>produccion.cloud · Estadísticas de comerciales</footer></main></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = 'informe_ventas_' + (st.periodo === 'rango' ? r.ini + '_a_' + iso(new Date(new Date(r.fin + 'T00:00:00') - 864e5)) : st.periodo + '_' + r.ini) + '.html';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ------------------------------------------------------------------ pintar
  function filtros(r) {
    // solo los clientes con movimiento en el periodo (pedidos, cotizaciones o ventas) y el que ya esté elegido
    const enPer = l => l.filter(x => !x.anulada && dentro(x.fecha, r)).map(x => norm(x.cliente));
    const clientes = [...new Set(enPer(datos.pedidos).concat(enPer(datos.cotizaciones), enPer(datos.remisiones), enPer(datos.facturas), st.cliente ? [st.cliente] : []).filter(Boolean))].sort();
    const lineas = [...new Set(datos.pedidos.reduce((s, p) => s.concat(p.lineas || []), []))].sort();
    const per = ['diario', 'semanal', 'quincenal', 'mensual', 'anual', 'rango'];
    const hoyIso = iso(hoy0());
    const fechas = st.periodo === 'rango' ? '<div class="ec-rango"><label>DESDE<input type="date" data-ec-fecha="desde" value="' + esc(st.desde) + '" min="' + esc(datos.desde) + '" max="' + hoyIso + '"></label>' +
      '<label>HASTA<input type="date" data-ec-fecha="hasta" value="' + esc(st.hasta) + '" min="' + esc(datos.desde) + '" max="' + hoyIso + '"></label>' +
      '<div class="ec-rapidos">' + [['Desde 1 sep', 'sep', 0], ['Hoy', 0, 0], ['Últimos 7 días', 6, 0], ['Últimos 30 días', 29, 0], ['Este año', 'a', 0]].map(([t, d]) => '<button type="button" data-ec-rapido="' + d + '">' + t + '</button>').join('') + '</div></div>' : '';
    return '<div class="ec-filtros"><div class="ec-seg ec-per">' + per.map(p => '<button type="button" data-ec-per="' + p + '" class="' + (st.periodo === p ? 'on' : '') + '">' + p.toUpperCase() + '</button>').join('') + '</div>' +
      '<div class="ec-nav"><button type="button" data-ec-off="-1" aria-label="Periodo anterior">‹</button><span>' + esc(r.largo) + '</span><button type="button" data-ec-off="1" aria-label="Periodo siguiente"' + (st.off >= 0 ? ' disabled' : '') + '>›</button></div>' +
      '<select data-ec-f="comercial" aria-label="Comercial"><option value="">Todos los comerciales</option>' + datos.comerciales.map(c => '<option value="' + esc(c.id) + '"' + (st.comercial === c.id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>').join('') + '</select>' +
      '<select data-ec-f="cliente" aria-label="Cliente"><option value="">Todos los clientes</option>' + clientes.map(c => '<option' + (st.cliente === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<select data-ec-f="linea" aria-label="Línea"><option value="">Todas las líneas</option>' + lineas.map(l => '<option' + (st.linea === l ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
      '<button type="button" class="ec-xls" data-ec-recargar title="Volver a leer Effi">↻ Effi</button></div>' + fechas +
      (st.linea ? '<p class="ec-nota">El filtro de línea aplica a los pedidos del panel; Effi no guarda la línea en sus documentos.</p>' : '');
  }
  function pintar() {
    if (!raiz || !raiz.isConnected) return;
    estilos();
    if (!datos) { raiz.innerHTML = '<div class="ec"><div class="ec-vacio">' + (error ? esc(error) : 'Leyendo pedidos y Effi (cotizaciones, remisiones y facturas)…') + '</div></div>'; return; }
    const r = rango(st.periodo, st.off), rAnt = rango(st.periodo, st.off - 1);
    const y = window.scrollY;
    raiz.innerHTML = '<div class="ec">' + filtros(r) + (datos.errores.length ? '<div class="ec-aviso">' + datos.errores.map(esc).join('<br>') + '</div>' : '') +
      bloqueProgramado(r) + bloquePrincipal(r, rAnt) +
      '<section class="ec-blq ec-detalle">' + plegable('detalle', 'Ver cifras: resumen y tarjetas por comercial', bloqueResumen(r, rAnt) + bloqueComerciales(r)) + '</section>' +
      bloqueCotizacion(r) + bloqueRemision(r) + bloqueValidaciones(r) +
      '<p class="ec-nota ec-pie">Effi leído desde el ' + dmy(datos.desde) + ' · actualizado ' + esc(String(datos.generado).replace('T', ' ').slice(0, 16)) + ' · valores en COP sin IVA.</p></div>';
    window.scrollTo(0, y);
    contar();
  }
  function contar() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    raiz.querySelectorAll('[data-ec-cuenta]').forEach(el => {
      const [v, tipo] = el.dataset.ecCuenta.split('|'), fin = Number(v) || 0, t0 = performance.now(), dur = 650;
      if (!fin) return;
      const paso = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), x = fin * e;
        el.textContent = tipo === 'cop' ? cop(x) : nf.format(Math.round(x)); if (k < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
    });
  }
  async function cargar(forzar) {
    if (cargando) return;
    cargando = true;
    try {
      const r = await fetch('/api/estadisticas-comerciales/datos' + (forzar ? '?refrescar=1' : ''), { credentials: 'same-origin', cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || 'No se pudieron leer las estadísticas');
      datos = d; error = '';
    } catch (e) { error = e.message; }
    cargando = false;
    pintar();
  }
  document.addEventListener('click', e => {
    if (!raiz || !raiz.contains(e.target)) return;
    const b = e.target.closest('[data-ec-per],[data-ec-off],[data-ec-met],[data-ec-metcom],[data-ec-com],[data-ec-xls],[data-ec-recargar],[data-ec-ir],[data-ec-informe],[data-ec-rapido]');
    if (!b) return;
    if (b.dataset.ecRapido != null) {   // atajos del rango
      const h = hoy0(); st.hasta = iso(h);
      if (b.dataset.ecRapido === 'sep') { st.periodo = 'rango'; st.desde = (datos && datos.pedidos_desde) || '2026-09-01'; }
      else if (b.dataset.ecRapido === 'a') st.desde = h.getFullYear() + '-01-01';
      else { const d = new Date(h); d.setDate(d.getDate() - Number(b.dataset.ecRapido)); st.desde = iso(d); }
      st.off = 0; guardar(); pintar(); return;
    }
    // al pasar a RANGO desde otro periodo, el rango arranca con lo que se estaba viendo
    if (b.dataset.ecPer === 'rango' && st.periodo !== 'rango') { const rv = rango(st.periodo, st.off); st.desde = rv.ini; const f = new Date(rv.fin + 'T00:00:00'); f.setDate(f.getDate() - 1); st.hasta = iso(f > hoy0() ? hoy0() : f); }
    if (b.hasAttribute('data-ec-informe')) return descargarInforme();
    if (b.dataset.ecIr) { const [pp, oo] = b.dataset.ecIr.split('|'); if (Number(oo) > 0) return; st.periodo = pp; st.off = Number(oo); ocultarGlobo(); }
    else if (b.dataset.ecPer) { st.periodo = b.dataset.ecPer; st.off = 0; }
    else if (b.dataset.ecOff) st.off = Math.min(0, st.off + Number(b.dataset.ecOff));
    else if (b.dataset.ecMet) { const [k, v] = b.dataset.ecMet.split(':'); st.met[k] = v; }
    else if (b.dataset.ecMetcom) st.metCom = b.dataset.ecMetcom;
    else if (b.dataset.ecCom != null) st.comercial = st.comercial === b.dataset.ecCom ? '' : b.dataset.ecCom;
    else if (b.dataset.ecXls) return exportar(b.dataset.ecXls);
    else if (b.hasAttribute('data-ec-recargar')) { datos = null; pintar(); return cargar(true); }
    guardar(); pintar();
  });
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (!d || !d.dataset || !d.dataset.ecDet || !raiz || !raiz.contains(d)) return;
    st.abiertos[d.dataset.ecDet] = d.open; guardar();
  }, true);
  document.addEventListener('change', e => {
    const fch = e.target.closest && e.target.closest('[data-ec-fecha]');
    if (fch && raiz && raiz.contains(fch) && /^\d{4}-\d{2}-\d{2}$/.test(fch.value)) {
      st[fch.dataset.ecFecha] = fch.value;
      if (st.desde > st.hasta) { if (fch.dataset.ecFecha === 'desde') st.hasta = st.desde; else st.desde = st.hasta; }
      st.off = 0; guardar(); pintar(); return;
    }
    const s = e.target.closest && e.target.closest('[data-ec-f]');
    if (!s || !raiz || !raiz.contains(s)) return;
    st[s.dataset.ecF] = s.value; pintar();
  });

  function estilos() {
    if (document.getElementById('ec-css')) return;
    const c = document.createElement('style'); c.id = 'ec-css';
    c.textContent = `
    .ec{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;color:#eef4ea;font-family:Arial,sans-serif;min-width:0;max-width:100%}
    .ec>*,.ec-blq>*,.ec-grid2>*{min-width:0}
    .ec-filtros{display:flex;flex-wrap:wrap;gap:10px;align-items:center;position:sticky;top:58px;z-index:30;padding:10px 12px;border-radius:16px;background:rgba(12,18,13,.92);border:1px solid #2f3d30;backdrop-filter:blur(8px)}
    .ec-filtros select{min-height:36px!important;width:auto!important;max-width:220px;padding:0 10px!important;border:1px solid #3d4c3b!important;border-radius:99px!important;background:#142017!important;color:#f5faef!important;font:700 12px Arial!important}
    .ec-seg{display:inline-flex;border:1px solid #3d4c3b;border-radius:99px;overflow:hidden;background:rgba(0,0,0,.3);flex-wrap:nowrap}
    .ec-seg button{all:unset;cursor:pointer;padding:7px 12px;font:800 11px Arial;letter-spacing:.06em;color:#c9d3c1;white-space:nowrap}.ec-seg button.on{background:#d0f44c;color:#0d140e}
    .ec-nav{display:inline-flex;align-items:center;gap:6px;font:800 12px Arial;color:#fff}.ec-nav button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;text-align:center;line-height:30px;border:1px solid #3d4c3b;font:900 16px Arial}.ec-nav button:disabled{opacity:.3;cursor:default}
    .ec-xls{all:unset;cursor:pointer;padding:7px 12px;border-radius:99px;border:1px solid #4d6a2c;color:#d1eb89;font:800 11px Arial;white-space:nowrap}.ec-xls:hover{background:rgba(208,244,76,.12)}
    .ec-blq{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding:16px;border-radius:20px;background:rgba(10,16,11,.6);border:1px solid #263226}
    .ec-cab{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.ec-cab h3{margin:0;font:900 14px Arial;letter-spacing:.12em;color:#d0f44c}.ec-cab h3 small{display:block;margin-top:4px;font:600 11px Arial;letter-spacing:0;color:#9fb09a}
    .ec-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .ec-det{border-radius:14px;border:1px solid #263226;background:rgba(0,0,0,.18)}.ec-det>summary{cursor:pointer;list-style:none;padding:10px 14px;font:800 12px Arial;letter-spacing:.06em;color:#d1eb89}.ec-det>summary::-webkit-details-marker{display:none}.ec-det>summary::before{content:'▸ '}.ec-det[open]>summary::before{content:'▾ '}.ec-det-c{display:grid;gap:14px;padding:0 12px 12px}.ec-det-c>*{min-width:0}
    .ec-concl{margin:0;font:800 15px/1.4 Arial;color:#f4f7f2}
    .ec-g4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .ec-g{display:grid;grid-template-rows:auto auto auto 1fr;gap:8px;padding:16px 18px;border-radius:18px;background:#0f1611;border:1px solid #2a382b;min-width:0}
    .ec-g-q{font:900 11px Arial;letter-spacing:.16em;color:#d0f44c}
    .ec-g-t{margin:0;font:700 15px/1.35 Arial;color:#dfe8da}.ec-g-t b{font:900 26px/1.1 Arial;color:#fff}.ec-g-t span{display:block;margin-top:2px;font:700 12px Arial;color:#a9b5a3}
    .ec-g .ec-seg{justify-self:start}
    .ec-g-b{min-width:0;align-self:end}
    .ec-g .mal,.ec-g-t b.mal{color:#ff6b5c}
    .ec-dona-w{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.ec-dona{width:170px;height:170px;flex:0 0 auto}.ec-dona-n{fill:#fff;font:900 34px Arial}.ec-dona-e{fill:#a9b5a3;font:800 10px Arial;letter-spacing:.12em}
    .ec-ley{display:grid;gap:8px;font:700 13px Arial;flex:1 1 150px}.ec-ley span{display:flex;align-items:center;gap:8px}.ec-ley i{width:12px;height:12px;border-radius:4px}.ec-ley b{margin-left:auto;color:#fff}
    .ec-hb-f.mal .ec-hb-b i{background:linear-gradient(90deg,#9a2a20,#ff6b5c)}
    @media (max-width:900px){.ec-g4{grid-template-columns:1fr}}
    .ec-mk path{transform-box:fill-box;transform-origin:50% 100%;animation:ecCrece .6s cubic-bezier(.2,.8,.2,1) both}
    .ec-mk.ir{cursor:pointer}.ec-mk.ir:hover path{filter:brightness(1.3)}
    .ec-rk-b i,.ec-hb-b i{transform-origin:0 50%;animation:ecAncho .7s cubic-bezier(.2,.8,.2,1) both}
    .ec-sg span{animation:ecAparece .5s ease both}
    .ec-g{animation:ecSube .45s cubic-bezier(.2,.8,.2,1) both;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
    .ec-g4.pri .ec-g:nth-child(2){animation-delay:.06s}.ec-g4.sec .ec-g:nth-child(1){animation-delay:.12s}.ec-g4.sec .ec-g:nth-child(2){animation-delay:.18s}
    .ec-g:hover{transform:translateY(-2px);border-color:#3f5238;box-shadow:0 14px 34px rgba(0,0,0,.35)}
    .ec-top{animation:ecSube .4s ease both}
    .ec-top-x{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .ec-inf{all:unset;cursor:pointer;padding:8px 14px;border-radius:99px;background:#c8ec4a;color:#0d140e;font:900 11px Arial;letter-spacing:.04em;white-space:nowrap;box-shadow:0 6px 16px rgba(200,236,74,.25);transition:transform .15s,box-shadow .15s}.ec-inf:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(200,236,74,.35)}
    .ec-per button{transition:background .2s,color .2s}
    @keyframes ecCrece{from{transform:scaleY(0)}to{transform:scaleY(1)}}
    @keyframes ecAncho{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    @keyframes ecAparece{from{filter:brightness(.4)}to{filter:none}}
    @keyframes ecSube{from{transform:translateY(10px)}to{transform:none}}

    .ec-m3s{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:6px}
    .ec-m3{display:grid;gap:6px;padding:14px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid #26322a;outline:none;min-width:0;transition:border-color .2s,transform .2s}
    .ec-m3:hover,.ec-m3:focus{border-color:#4b5f42;transform:translateY(-1px)}
    .ec-m3 small{display:flex;align-items:center;gap:7px;font:900 10px Arial;letter-spacing:.12em;color:#c9d3c3}.ec-m3 small i{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
    .ec-m3 b{font:800 22px/1.1 Arial;color:#fff;overflow-wrap:anywhere}
    .ec-m3-b{height:8px;border-radius:0 4px 4px 0;background:rgba(255,255,255,.06)}.ec-m3-b i{display:block;height:100%;border-radius:0 4px 4px 0;transform-origin:0 50%;animation:ecAncho .7s cubic-bezier(.2,.8,.2,1) both}
    .ec-m3 em{font:600 11px/1.4 Arial;font-style:normal;color:#9aa894}
    .ec-m3.cot{background:rgba(90,169,214,.06);border-color:rgba(90,169,214,.22)}
    @media (max-width:1100px){.ec-m3s{grid-template-columns:1fr}}

    /* Barra de filtros a todo el ancho (pedido 2026-11-27): periodos · fecha · 3 filtros iguales · Effi, con aire entre botones */
    .ec .ec-filtros{display:grid;grid-template-columns:auto minmax(300px,1.6fr) repeat(3,minmax(150px,1fr)) auto;gap:12px 16px;align-items:center;padding:12px 16px}
    .ec .ec-filtros select{width:100%!important;max-width:100%;min-width:0;text-overflow:ellipsis;min-height:40px!important;padding:0 14px!important;font-size:12.5px!important}
    .ec .ec-per{padding:3px;gap:2px}.ec .ec-per button{padding:9px 15px;border-radius:99px;letter-spacing:.08em}
    .ec .ec-nav{display:flex;justify-content:space-between;gap:10px;padding:3px;border:1px solid #2f3d30;border-radius:99px;background:rgba(0,0,0,.25);min-width:0}
    .ec .ec-nav span{flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:800 13px Arial}
    .ec .ec-nav button{width:34px;height:34px;line-height:34px;flex:0 0 34px;background:rgba(255,255,255,.04)}.ec .ec-nav button:not(:disabled):hover{border-color:#c8ec4a;color:#c8ec4a}
    .ec .ec-filtros>.ec-xls{justify-self:end;padding:10px 16px}
    @media (max-width:1280px){.ec .ec-filtros{display:flex;flex-wrap:wrap}.ec .ec-filtros .ec-nav{flex:1 1 280px}.ec .ec-filtros select{flex:1 1 180px;width:auto!important}}
    @media (max-width:600px){.ec .ec-filtros{padding:10px}.ec .ec-filtros .ec-per,.ec .ec-filtros .ec-nav,.ec .ec-filtros select{flex:1 1 100%;width:100%!important;min-width:0}.ec .ec-per button{padding:8px 2px}}

    .ec-g-ctl{display:inline-flex;gap:8px;flex-wrap:wrap}
    @media (prefers-reduced-motion:reduce){.ec *,.ec{animation:none!important;transition:none!important}}
    .ec-rango{display:flex;flex-wrap:wrap;align-items:end;gap:10px 14px;padding:12px 14px;border-radius:14px;background:rgba(200,236,74,.06);border:1px solid rgba(200,236,74,.25);animation:ecSube .3s ease both}
    .ec-rango label{display:grid;gap:5px;font:900 12px Arial;letter-spacing:.14em;color:#c8ec4a}
    .ec-rango input{min-height:36px;padding:0 10px;border:1px solid #3d4c3b;border-radius:10px;background:#142017;color:#f5faef;font:700 13px Arial;color-scheme:dark}
    .ec-rango input:focus{outline:none;border-color:#c8ec4a;box-shadow:0 0 0 3px rgba(200,236,74,.15)}
    .ec-rapidos{display:flex;flex-wrap:wrap;gap:6px}.ec-rapidos button{all:unset;cursor:pointer;padding:7px 11px;border-radius:99px;border:1px solid #3d4c3b;color:#c9d3c1;font:800 11px Arial}.ec-rapidos button:hover{border-color:#c8ec4a;color:#fff}
    @media (max-width:600px){.ec-per{grid-template-columns:repeat(3,minmax(0,1fr))!important}.ec-rango label{flex:1 1 130px}.ec-rango input{width:100%;box-sizing:border-box}}
    @media (max-width:600px){.ec-per{width:100%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}.ec-per button{padding:8px 2px;text-align:center;font-size:9.5px;letter-spacing:.02em}.ec-top-x{justify-content:flex-start}}
    /* JERARQUÍA: 1) encabezado con UNA cifra protagonista · 2) dos gráficas principales · 3) dos de control compactas · 4) detalle liviano */
    .ec-principal{gap:18px;padding:22px;background:radial-gradient(1200px 260px at 0 0,rgba(200,236,74,.07),transparent 60%),rgba(10,16,11,.7);border-color:#2b3a2c}
    .ec-top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) auto;gap:22px;align-items:end;padding:4px 2px 18px;border-bottom:1px solid #26322a}
    .ec-top-q{font:900 12px Arial;letter-spacing:.18em;color:#c8ec4a}
    .ec-top-n{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 14px;margin:6px 0 4px}.ec-top-n b{font:800 56px/1 Arial;letter-spacing:-.03em;color:#fff}.ec-top-n .ec-dl{font-size:14px}
    .ec-top-s{font:600 12px Arial;color:#8f9c89}
    .ec-top-b{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}
    .ec-mini{padding:2px 16px;border-left:1px solid #2b382d;min-width:0}.ec-mini small{display:block;font:800 10px Arial;letter-spacing:.14em;color:#8f9c89}.ec-mini b{display:block;margin:4px 0 2px;font:800 28px/1.05 Arial;color:#f2f6ee}.ec-mini.mal b{color:#ff6b5c}.ec-mini .ec-dl{font-size:11px}
    .ec-top-x{align-self:start}
    .ec-g4.pri{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}
    .ec-g-h{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    .ec-g.pri{padding:22px 24px 20px;border-color:#33432f;background:linear-gradient(180deg,#141d16,#0f1611)}
    .ec-g.pri .ec-g-t{font:700 15px/1.35 Arial}.ec-g.pri .ec-g-t>b{font:800 22px Arial;color:#fff}
    .ec-g.sec{padding:16px 18px;background:#0d130f;border-color:#222c24}
    .ec-g.sec .ec-g-q{color:#9fb06d}.ec-g.sec .ec-hero{font-size:28px!important}
    @media (min-width:901px){.ec-g.pri .ec-svg{min-height:230px}}
    .ec-blq:not(.ec-principal){background:transparent;border:0;border-top:1px solid #222c24;border-radius:0;padding:14px 4px}
    .ec-blq:not(.ec-principal) .ec-cab h3{font-size:12px;color:#9fb06d}.ec-blq:not(.ec-principal) .ec-concl{font:700 14px Arial;color:#cfd8ca}
    .ec-detalle{padding-top:6px!important}
    @media (max-width:1100px){.ec-top{grid-template-columns:1fr auto}.ec-top-b{grid-column:1/-1}.ec-mini:first-child{border-left:0;padding-left:0}}
    @media (max-width:900px){.ec-g4.pri{grid-template-columns:1fr}}
    @media (max-width:600px){.ec-principal{padding:14px}.ec-top-n b{font-size:40px}.ec-top{grid-template-columns:1fr}.ec-top-x{grid-row:1;justify-self:end}.ec-mini{padding:2px 8px}.ec-mini b{font-size:22px}}
    .ec-g{gap:10px;padding:18px 20px 16px;background:linear-gradient(180deg,#121a14,#0e1410)}
    .ec-g-t{display:block}.ec-g-t span{margin:0}
    .ec-hero{font:800 34px/1.05 Arial!important;letter-spacing:-.02em;color:#fff}.ec-hero.mal{color:#ff6b5c!important}
    .ec-dl{font:800 12px Arial}.ec-dl.up{color:#8fe07a}.ec-dl.down{color:#ff8f84}.ec-dl.na{color:#c9a85a}
    .ec-ax{fill:#7f8c79;font:600 10.5px Arial;font-variant-numeric:tabular-nums}.ec-ax.on{fill:#e8f0e2;font-weight:800}
    .ec-vl{fill:#c9d3c3;font:800 11px Arial}.ec-vl.on{fill:#fff}
    .ec-fut{fill:#5d6a59;font:700 9.5px Arial;font-style:italic}.ec-ax.fut{fill:#4f5b4b}
    .ec-mk{cursor:default;outline:none}.ec-mk:hover path,.ec-mk:focus path{filter:brightness(1.18)}
    .ec-rk{display:grid;gap:10px}.ec-rk-f{display:grid;grid-template-columns:minmax(96px,30%) minmax(0,1fr) minmax(96px,auto);gap:12px;align-items:center;padding:3px 6px;border-radius:10px;outline:none}
    .ec-rk-f.ec-click{cursor:pointer}.ec-rk-f:hover,.ec-rk-f:focus{background:rgba(255,255,255,.04)}.ec-rk-f.on{background:rgba(200,236,74,.08)}.ec-rk-f.tenue{opacity:.45}
    .ec-rk-n{font:700 13px Arial;color:#e8efe4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:8px}
    .ec-rk-p{flex:0 0 20px;font:800 11px Arial;font-style:normal;color:#7f8c79;text-align:center}.ec-rk-p.uno{color:#0d140e;background:#c8ec4a;border-radius:50%;width:20px;height:20px;line-height:20px}
    .ec-av{flex:0 0 26px;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:9px;background:#2a3a2c;color:#e8f0e2;font:900 10px Arial;font-style:normal}
    .ec-rk-f:first-child .ec-av{background:#c8ec4a;color:#0d140e}
    .ec-av.xl{flex:0 0 56px;width:56px;height:56px;border-radius:16px;font-size:20px;background:linear-gradient(135deg,#d6f25e,#8fbf2a);color:#0d140e;box-shadow:0 6px 18px rgba(200,236,74,.25)}
    .ec-g-t .ec-lider{display:flex;align-items:center;gap:14px;margin:4px 0 2px}.ec-g-t .ec-lider>span{display:grid;gap:2px;min-width:0}.ec-g-t .ec-lider .ec-lider-d{display:block}
    .ec-rk-f{grid-template-columns:minmax(150px,38%) minmax(0,1fr) 168px!important}.ec-lider small{font:800 10px Arial;letter-spacing:.14em;color:#c8ec4a}
    .ec-lider-n{font:800 26px/1.1 Arial;color:#fff;letter-spacing:-.01em;overflow-wrap:anywhere}.ec-lider-d{font:600 12px/1.4 Arial;color:#a9b5a3}.ec-lider-d b{font:800 13px Arial;color:#fff}
    .ec-rk-b{height:12px;border-radius:0 4px 4px 0;background:rgba(255,255,255,.05)}.ec-rk-b i{display:block;height:100%;border-radius:0 4px 4px 0}
    .ec-rk-v{font:800 13px Arial;color:#fff;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.ec-rk-v em{display:inline-block;min-width:38px;margin-left:8px;font:700 11px Arial;font-style:normal;color:#9aa894}
    .ec-sg{display:flex;gap:2px;height:28px;margin-top:4px}.ec-sg span{display:flex;align-items:center;padding:0 8px;border-radius:4px;font:800 12px Arial;min-width:4px;outline:none;white-space:nowrap;overflow:visible}
    .ec-sg span:hover,.ec-sg span:focus{filter:brightness(1.15)}
    .ec-sg-ley{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px}.ec-sg-ley span{display:inline-flex;align-items:center;gap:7px;font:700 12px Arial;color:#c9d3c3}.ec-sg-ley i{width:10px;height:10px;border-radius:3px}.ec-sg-ley b{color:#fff;margin-left:2px}
    .ec-por{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-top:12px}.ec-por small{font:900 10px Arial;letter-spacing:.14em;color:#ff9b8f;margin-right:4px}.ec-por span{padding:4px 10px;border-radius:99px;background:rgba(255,93,77,.1);border:1px solid rgba(255,93,77,.25);font:700 12px Arial;color:#f1d6d2}.ec-por b{color:#fff}
    .ec-at-m{padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.06);color:#e8efe4;font:700 11px Arial;white-space:nowrap}
    .ec-at{display:grid;gap:6px;margin-top:12px}.ec-at>div{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:7px 10px;border-radius:10px;background:rgba(255,93,77,.07);border:1px solid rgba(255,93,77,.18);font:700 12px Arial}
    .ec-at-i{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#ff5d4d;color:#160705;font:900 12px Arial}
    .ec-at b{color:#fff}.ec-at-c{color:#c9d3c3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ec-at em{font-style:normal;color:#ff9b8f;font-weight:800;white-space:nowrap}
    .ec-mon{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.ec-mon>div{position:relative;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid #26322a;outline:none}
    .ec-mon small{display:block;font:800 10px Arial;letter-spacing:.12em;color:#9aa894}.ec-mon b{display:block;margin:4px 0 2px;font:800 22px Arial;color:#fff}.ec-mon em{font:600 11px Arial;font-style:normal;color:#9aa894}
    .ec-mon .riesgo{background:rgba(255,93,77,.07);border-color:rgba(255,93,77,.25)}.ec-mon .riesgo b{color:#ff8f84}.ec-mon .riesgo .ec-at-i{width:14px;height:14px;font-size:10px;margin-right:6px;vertical-align:-2px}
    .ec-tip{position:fixed;z-index:100000;display:none;pointer-events:none;padding:8px 11px;border-radius:10px;background:#f4f7f0;color:#101510;box-shadow:0 10px 28px rgba(0,0,0,.45);max-width:260px}
    .ec-tip small{display:block;font:700 11px Arial;color:#55604f}.ec-tip b{display:block;font:800 14px Arial}
    @media (max-width:600px){.ec-rk-f{grid-template-columns:minmax(0,1fr) 158px!important;row-gap:4px}.ec-rk-n{grid-column:1/-1}.ec-lider-n{font-size:21px!important}.ec-av.xl{flex-basis:46px;width:46px;height:46px;font-size:16px}.ec-hero{font-size:28px!important}.ec-rk-f{grid-template-columns:minmax(80px,34%) minmax(0,1fr) auto}.ec-mon{grid-template-columns:1fr}}
    .ec-kpi{padding:14px;border-radius:16px;border:1px solid rgba(255,255,255,.12);min-width:0}.ec-kpi small{display:block;font:800 10px Arial;letter-spacing:.12em;color:#c9d6c2}.ec-kpi b{display:block;margin:6px 0 4px;font:900 24px Arial;color:#fff;overflow-wrap:anywhere}.ec-kpi span{display:block;font:600 11px Arial;color:#c9d6c2}
    .ec-var{display:block;font:800 11px Arial;font-style:normal;color:#c9d6c2}.ec-var.up{color:#9be37a}.ec-var.down{color:#ff9b8f}.ec-var.na{color:#f5b041}
    .ec-conc{display:flex;flex-wrap:wrap;gap:10px}.ec-conc div{flex:1 1 260px;padding:10px 14px;border-radius:12px;background:#121a13;border:1px solid #2a382a;font:600 13px Arial}.ec-conc b{font:900 20px Arial;color:#d0f44c;margin-right:4px}
    .ec-grid2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px}
    .ec-card{padding:14px 16px;border-radius:16px;background:#111813;border:1px solid #263226;min-width:0}.ec-card h4{margin:0 0 10px;font:800 13px/1.35 Arial;color:#f4f7f2}
    .ec-card-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:6px}.ec-card-cab h4{flex:1 1 220px}
    .ec-svg{width:100%;height:auto;display:block}.ec-svg-v{fill:#fff;font:800 11px Arial}.ec-svg-e{fill:#a9b5a3;font:700 10px Arial}
    .ec-nota{margin:6px 0 0;color:#a9b5a3;font:600 11px/1.5 Arial}
    .ec-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.ec-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;background:#18221a;font:700 11px Arial}.ec-chip i{width:9px;height:9px;border-radius:50%;background:var(--c)}
    .ec-est{display:inline-block;padding:3px 9px;border-radius:99px;border:1px solid var(--c);color:var(--c);font:800 11px Arial;white-space:nowrap}
    .ec-tabla-w{overflow:auto;max-height:340px}.ec-alta{max-height:460px}
    .ec-tabla{width:100%;border-collapse:collapse;font:600 12px Arial;color:#e6eee2}.ec-tabla th{position:sticky;top:0;background:#111813;text-align:left;font:800 10px Arial;letter-spacing:.1em;color:#a9b5a3;padding:7px 8px;border-bottom:1px solid #2f3d30;white-space:nowrap}.ec-tabla td{padding:7px 8px;border-bottom:1px solid #1f2a20}.ec-tabla .n{text-align:right;white-space:nowrap}.ec-vacio{padding:20px;text-align:center;color:#a9b5a3}
    .ec-coms{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:12px}
    .ec-com{all:unset;box-sizing:border-box;cursor:pointer;display:grid;gap:10px;padding:14px;border-radius:18px;border:1px solid #2f3d30;min-width:0}.ec-com:hover{border-color:#6f9410}.ec-com.on{border-color:#d0f44c;box-shadow:0 0 0 2px rgba(208,244,76,.35)}.ec-com.effi{opacity:.85}
    .ec-com-cab{display:flex;align-items:center;gap:10px}.ec-com-cab i{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#d0f44c;color:#0d140e;font:900 14px Arial;font-style:normal}.ec-com.effi .ec-com-cab i{background:#5b6b58;color:#fff}.ec-com-cab strong{font:900 16px Arial;color:#fff}.ec-com-cab em{margin-left:auto;font:700 10px Arial;font-style:normal;color:#a9b5a3;border:1px solid #3d4c3b;border-radius:99px;padding:2px 8px}
    .ec-com-g{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ec-com-g>span{display:grid;gap:2px;min-width:0}.ec-com-g small{font:800 9px Arial;letter-spacing:.1em;color:#a9b5a3}.ec-com-g b{font:900 15px Arial;color:#fff;overflow-wrap:anywhere}.ec-com-g b.mal{color:#ff8f84}
    .ec .ec-com-g.ec-prog-g{grid-template-columns:repeat(3,minmax(0,1fr))}
    .ec-prog-m{display:flex;flex-wrap:wrap;gap:6px;position:relative;z-index:1}
    .ec-prog-m em{font:700 11px Arial;font-style:normal;color:#cfd8ca;border:1px solid #3d4c3b;border-radius:99px;padding:3px 9px;background:rgba(0,0,0,.25)}
    .ec-prog-m em b{color:#fff}
    .ec-cab-b{display:flex;gap:8px;flex-wrap:wrap}.ec-com-g em{font:600 10px Arial;font-style:normal;color:#a9b5a3}
    .ec-hb{display:grid;gap:8px}.ec-hb-f{display:grid;grid-template-columns:minmax(90px,170px) minmax(0,1fr) auto;gap:10px;align-items:center;font:700 12px Arial;padding:2px 4px;border-radius:8px}.ec-hb-f span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ec-hb-f.ec-click{cursor:pointer}.ec-hb-f.ec-click:hover,.ec-hb-f.on{background:rgba(208,244,76,.08)}.ec-hb-b{height:14px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}.ec-hb-b i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#6f9410,#d0f44c)}.ec-hb-f b{white-space:nowrap}
    .ec-cruce{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ec-cruce div{padding:12px;border-radius:12px;background:#18221a}.ec-cruce b{display:block;font:900 26px Arial;color:#d0f44c}.ec-cruce span{font:600 12px Arial;color:#c9d6c2}
    .ec-lista{margin:0;padding-left:18px;display:grid;gap:6px;font:600 12px/1.5 Arial}.ec-lista .ok{color:#9be37a}.ec-lista .mal{color:#ff8f84}
    .ec-aviso{padding:10px 12px;border-radius:12px;background:#3a1d1a;color:#ffd2cc;font:700 12px Arial}
    .ec-pie{text-align:center}
    @media (max-width:1100px){.ec-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:900px){.ec-grid2{grid-template-columns:1fr}.ec-com-g{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:600px){.ec-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ec-kpi b{font-size:19px}.ec-filtros{position:static}.ec-filtros select{max-width:100%;flex:1 1 140px}.ec-nav{flex:1 1 100%;justify-content:space-between}.ec-hb-f{grid-template-columns:90px minmax(0,1fr) auto}.ec-blq{padding:12px}}
    @media print{.ec-det-c{display:grid!important}.ec,.ec *{color:#000!important;background:#fff!important;border-color:#999!important;box-shadow:none!important}.ec-filtros,.ec-xls,.ec-seg{display:none!important}.ec-hb-b i,.ec-svg rect{fill:#3c6e14!important;background:#3c6e14!important}.ec-svg-v,.ec-svg-e{fill:#000!important}.ec-tabla-w{max-height:none;overflow:visible}}`;
    document.head.appendChild(c);
  }

  window.EstadisticasComerciales = {
    montar(el) {
      if (!el) return;
      const nuevo = el !== raiz;
      raiz = el;
      if (datos || error) pintar(); else if (nuevo) { pintar(); cargar(false); }
      if (nuevo && datos) cargar(false);   // refresca en silencio (el servidor guarda 10 min)
    },
  };
})();
