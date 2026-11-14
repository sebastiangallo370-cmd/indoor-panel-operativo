(() => {
  // LISTADO DEL PEDIDO (EMPEZAR PEDIDO): al crear la cotización en Effi se muestra aquí su réplica; con «Continuar con el listado» el comercial adjunta los mockups, llena el
  // listado (nombre, talla, número, diseño, género y observación de cada prenda) y lo programa en Producción (POST /api/pedido-effi/programar → el programar pedido de siempre).
  if (window.PedidoListado) return;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const MAX_DISENOS = 6, MAX_BYTES = 10 * 1024 * 1024;
  const TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

  const css = document.createElement('style');
  css.textContent = `
  .pl{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;min-height:0;color:#f5faef;font-family:Arial,sans-serif}
  .pl *{box-sizing:border-box}
  .pl-barra{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(255,255,255,.05)}
  .pl-pasos{display:flex;gap:8px;flex-wrap:wrap}.pl-paso{padding:7px 14px;border-radius:99px;border:1px solid #3d4c3b;color:#a9b5a3;font:800 12px Arial;letter-spacing:.06em}
  .pl-paso.on{background:#d0f44c;color:#142017;border-color:#d0f44c}.pl-paso.hecho{color:#bff26a;border-color:rgba(191,242,106,.5)}
  .pl-cuerpo{flex:1;min-height:0;overflow:auto}
  .pl-btn{min-height:42px;padding:0 20px;border:0;border-radius:12px;background:#d0f44c;color:#142017;font:900 13px Arial;letter-spacing:.05em;cursor:pointer}
  .pl-btn.sec{background:rgba(255,255,255,.1);color:#f5faef}.pl-btn.mini{min-height:34px;padding:0 14px;font-size:12px}.pl-btn:disabled{opacity:.45;cursor:not-allowed}
  .pl-acciones{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#0b0f09}
  .pl-msg{flex:1 1 260px;font:700 13px/1.45 Arial;color:#a9b5a3;white-space:pre-line}.pl-msg.error{color:#ff9b9b}.pl-msg.ok{color:#bff26a}
  /* réplica de la cotización: papel blanco, como el documento de Effi */
  .pl-papel{max-width:1100px;margin:0 auto;background:#fff;color:#111;border-radius:10px;padding:26px 30px;font:13px/1.45 Arial,sans-serif}
  .pl-papel h1{margin:0;font:900 22px Arial;letter-spacing:.02em}.pl-papel small{color:#555}
  .pl-top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:12px}
  .pl-num{text-align:right}.pl-num span{display:block;font:800 12px Arial;letter-spacing:.12em;color:#444}.pl-num b{font:900 24px Arial}.pl-num em{display:inline-block;margin-top:4px;padding:2px 10px;border-radius:99px;background:#e4f7b0;color:#2c4a00;font:800 11px Arial;font-style:normal}
  .pl-meta{display:grid;gap:6px 18px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:12px}.pl-meta b{display:block;font:800 10px Arial;letter-spacing:.1em;color:#666}
  .pl-papel table{width:100%;border-collapse:collapse;margin:10px 0}.pl-papel th{background:#f0f0f0;font:800 10px Arial;letter-spacing:.06em;text-align:left;padding:7px 8px;border-bottom:1px solid #999}
  .pl-papel td{padding:7px 8px;border-bottom:1px solid #ddd;vertical-align:top}.pl-papel td.d,.pl-papel th.d{text-align:right;white-space:nowrap}
  .pl-pie{display:grid;gap:18px;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);margin-top:12px}
  .pl-tot div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}.pl-tot .neto{border-top:2px solid #111;margin-top:4px;padding-top:6px;font:900 17px Arial}
  .pl-pagos{margin-top:12px;padding-top:10px;border-top:1px dashed #aaa}
  /* paso 2 y 3 */
  .pl-tarjeta{padding:16px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28));margin-bottom:12px}
  .pl-tarjeta h3{margin:0 0 10px;font:900 15px Arial;display:flex;align-items:center;gap:8px}.pl-tarjeta h3::before{content:"";width:4px;height:16px;border-radius:2px;background:#d0f44c}
  .pl-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
  .pl label{display:grid;gap:5px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.08em}
  .pl input,.pl select,.pl textarea{width:100%;border:1px solid #3d4c3b;border-radius:10px;background:#142017;color:#f5faef;font:600 14px Arial;outline:none}
  .pl input,.pl select{min-height:38px;padding:0 10px}.pl textarea{padding:10px;min-height:70px;resize:vertical}
  .pl input:focus,.pl select:focus,.pl textarea:focus{border-color:#d0f44c}
  .pl-slots{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
  .pl-slot{border:2px dashed rgba(208,244,76,.4);border-radius:14px;padding:10px;display:grid;gap:8px;align-content:start;min-height:170px}
  .pl-slot.ok{border-style:solid;border-color:#bff26a;background:rgba(191,242,106,.06)}
  .pl-slot img{width:100%;height:110px;object-fit:contain;background:#0b0f09;border-radius:8px}
  .pl-slot .t{font:900 12px Arial;color:#d0f44c;letter-spacing:.08em}.pl-slot small{color:#8f9d88;word-break:break-all}
  .pl-slot input[type=file]{display:none}.pl-slot .pl-btn{min-height:32px;font-size:11px}
  .pl-refs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .pl-ref{padding:8px 14px;border-radius:12px;border:1px solid #3d4c3b;background:#142017;color:#f5faef;cursor:pointer;font:800 12px Arial}.pl-ref.on{border-color:#d0f44c;background:#1d3321}
  .pl-cont{padding:2px 8px;border-radius:99px;margin-left:8px;font:900 11px Arial;background:#5a2323;color:#ffb4a2}.pl-cont.ok{background:#1d4a1d;color:#bff26a}
  .pl-tabla{width:100%;border-collapse:separate;border-spacing:0 4px}.pl-tabla th{font:800 10px Arial;letter-spacing:.08em;color:#a9b5a3;text-align:left;padding:2px 4px;position:sticky;top:0;background:#101a12;z-index:2}
  .pl-tabla td{padding:0 3px}.pl-tabla td.n{width:34px;color:#8f9d88;font:700 12px Arial;text-align:right}.pl-tabla input,.pl-tabla select{min-height:34px}
  .pl-tabla .bad{border-color:#ff7b7b!important;background:#2a1414!important}
  .pl-x{all:unset;cursor:pointer;color:#ff9b9b;font:900 16px Arial;padding:6px}
  .pl-herr{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:10px}.pl-herr label{min-width:130px}
  .pl-listo{max-width:720px;margin:30px auto;text-align:center}.pl-listo strong{display:block;font:900 26px Arial;color:#d0f44c;margin:8px 0}
  .pl-listo .caja{margin-top:14px;padding:14px;border-radius:12px;text-align:left;font:700 13px/1.5 Arial;white-space:pre-line;border:1px solid rgba(255,255,255,.2)}
  .pl-listo .caja.error{border-color:#ff7b7b;color:#ff9b9b}.pl-listo .caja.ok{border-color:#bff26a;color:#bff26a}
  @media(max-width:700px){
    .pl-tabla{min-width:0!important;border-spacing:0}.pl-tabla thead{display:none}.pl-tabla,.pl-tabla tbody{display:block}
    .pl-tabla tr{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 10px;margin-bottom:10px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.03);position:relative}
    .pl-tabla td{padding:0!important;width:auto!important;display:block}.pl-tabla td.n{position:absolute;top:6px;right:48px;width:auto!important;font-size:11px;text-align:right}
    .pl-tabla td[data-l="NOMBRE"],.pl-tabla td[data-l="OBSERVACIÓN"]{grid-column:1/-1}
    .pl-tabla td[data-l]::before{content:attr(data-l);display:block;font:800 10px Arial;letter-spacing:.08em;color:#a9b5a3;margin-bottom:3px}
    .pl-tabla td:last-child{position:absolute;top:2px;right:4px}.pl-tabla input,.pl-tabla select{min-height:44px;font-size:16px}.pl-tabla-caja{overflow:visible!important}
    .pl-papel table,.pl-papel tbody{display:block}.pl-papel thead{display:none}.pl-papel tr{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding:8px 0;border-bottom:1px solid #ccc}
    .pl-papel td{display:block;padding:0!important;text-align:left!important}.pl-papel td[data-l]::before{content:attr(data-l) ': ';font:800 9px Arial;letter-spacing:.06em;color:#777}.pl-papel td[data-l="DESCRIPCIÓN"]{grid-column:1/-1}
    .pl-acciones{position:sticky;bottom:0;z-index:6;box-shadow:0 -8px 18px rgba(0,0,0,.45);padding:8px 10px;gap:6px}.pl-acciones .pl-btn{width:auto!important;flex:1 1 42%;min-height:44px;padding:8px 10px;font-size:12px}.pl-acciones p,.pl-acciones [data-msg]{flex:1 1 100%;font-size:12px;margin:0}
    .pl-slots{grid-template-columns:1fr!important}.pl-herr .pl-btn{flex:1 1 45%}
  }
  @media(max-width:900px){.pl{height:auto}.pl-pie{grid-template-columns:1fr}.pl-papel{padding:16px}.pl-acciones .pl-btn{width:100%}.pl-tabla{min-width:720px}.pl-cuerpo{overflow:visible}.pl-tabla-caja{overflow:auto}}
  `;
  document.head.appendChild(css);

  const PRINT_CSS = `body{margin:18px;font:12px/1.4 Arial,sans-serif;color:#111}h1{margin:0;font:900 20px Arial}small{color:#555}
  .pl-top{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:10px}.pl-num{text-align:right}.pl-num span{display:block;font:800 11px Arial;letter-spacing:.1em}.pl-num b{font:900 22px Arial}.pl-num em{display:none}
  .pl-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 16px;margin-bottom:10px}.pl-meta b{display:block;font:800 9px Arial;letter-spacing:.1em;color:#666}
  table{width:100%;border-collapse:collapse;margin:8px 0}th{background:#eee;font:800 9px Arial;text-align:left;padding:6px;border-bottom:1px solid #888}td{padding:6px;border-bottom:1px solid #ccc;vertical-align:top}td.d,th.d{text-align:right;white-space:nowrap}
  .pl-pie{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin-top:10px}.pl-tot div{display:flex;justify-content:space-between;padding:2px 0}.pl-tot .neto{border-top:2px solid #111;margin-top:4px;padding-top:5px;font:900 15px Arial}.pl-pagos{margin-top:10px;padding-top:8px;border-top:1px dashed #999}`;

  const L = {};   // estado del flujo (uno por ventana abierta)
  let raiz = null;
  const q = s => raiz.querySelector(s);

  // ---------------------------------------------------------------- datos
  const grupos = () => {
    const m = new Map();
    (L.doc.conceptos || []).forEach(c => {
      const ref = String(c.referencia || '').trim().toUpperCase(); if (!ref) return;
      const g = m.get(ref) || { referencia: ref, descripcion: c.descripcion || ref, cantidad: 0 };
      g.cantidad += num(c.cantidad); m.set(ref, g);
    });
    return [...m.values()];
  };
  const claveBorrador = () => 'pedidoListado:' + (L.doc.prefijo || '') + L.doc.numero;
  function guardarBorrador() { try { localStorage.setItem(claveBorrador(), JSON.stringify({ disenos: L.disenos, proyecto: L.proyecto, linea: L.linea, observaciones: L.observaciones, listado: L.listado })); } catch (e) { /* sin almacenamiento */ } }
  function cargarBorrador() { try { const b = JSON.parse(localStorage.getItem(claveBorrador()) || 'null'); if (b && b.listado) Object.assign(L, { disenos: b.disenos || 1, proyecto: b.proyecto || L.proyecto, linea: b.linea || '', observaciones: b.observaciones || '', listado: b.listado }); } catch (e) { /* borrador dañado */ } }
  const filaVacia = () => ({ nombre: '', talla: '', numero: '', diseno: L.defDiseno || 1, genero: L.defGenero || 'MASC', observacion: '' });
  const filasDe = ref => (L.listado[ref] = L.listado[ref] || []);
  const faltantes = () => {   // lo que impide programar: se muestra completo, no uno por uno
    const out = [];
    grupos().forEach(g => {
      const f = filasDe(g.referencia);
      if (f.length !== g.cantidad) out.push(g.referencia + ': la cotización dice ' + g.cantidad + ' prendas y el listado tiene ' + f.length + (f.length < g.cantidad ? ' (faltan ' + (g.cantidad - f.length) + ')' : ' (sobran ' + (f.length - g.cantidad) + ')'));
      const sinTalla = f.filter(x => !String(x.talla || '').trim()).length, sinGen = f.filter(x => !x.genero).length;
      if (sinTalla) out.push(g.referencia + ': ' + sinTalla + ' prenda(s) sin talla');
      if (sinGen) out.push(g.referencia + ': ' + sinGen + ' prenda(s) sin género');
    });
    return out;
  };
  const slotsNecesarios = () => { const s = []; const refs = L.compartir ? ['*'] : grupos().map(g => g.referencia); refs.forEach(r => { for (let n = 1; n <= L.disenos; n++) s.push([r, n]); }); return s; };
  const imagenDe = (ref, n) => (L.imgs[ref] || {})[n];
  const mockupsCompletos = () => slotsNecesarios().every(([r, n]) => imagenDe(r, n));

  // ---------------------------------------------------------------- estructura
  const PASOS = [['doc', '1 · COTIZACIÓN'], ['mockups', '2 · MOCKUPS'], ['listado', '3 · LISTADO']];
  function barra() {
    const orden = ['doc', 'mockups', 'listado', 'enviado'], i = orden.indexOf(L.pantalla);
    return '<div class="pl-barra"><div class="pl-pasos">' + PASOS.map(([k, t], j) => '<span class="pl-paso ' + (j === i ? 'on' : j < i ? 'hecho' : '') + '">' + t + '</span>').join('') + '</div><span style="color:#a9b5a3;font:700 12px Arial">' + esc((L.doc.tipo === 'remision' ? 'Remisión ' : 'Cotización ') + (L.doc.numero_completo || L.doc.numero)) + ' · ' + esc((L.doc.cliente || {}).nombre) + '</span></div>';
  }
  function dibujar() {
    const p = L.pantalla;
    raiz.innerHTML = '<div class="pl">' + barra() + '<div class="pl-cuerpo" data-cuerpo></div><div class="pl-acciones" data-acciones></div></div>';
    if (p === 'doc') pantallaDoc(); else if (p === 'mockups') pantallaMockups(); else if (p === 'listado') pantallaListado(); else pantallaEnviado();
  }
  const acciones = (html, msg, tipo) => { q('[data-acciones]').innerHTML = html + '<div class="pl-msg ' + (tipo || '') + '" data-msg>' + esc(msg || '') + '</div>'; };
  const setMsg = (t, tipo) => { const m = q('[data-msg]'); if (m) { m.textContent = t || ''; m.className = 'pl-msg ' + (tipo || ''); } };

  // ---------------------------------------------------------------- 1) réplica de la cotización
  function htmlDoc() {
    const d = L.doc, s = d.sucursal || {}, c = d.cliente || {}, t = d.totales || {};
    const filas = (d.conceptos || []).map((x, i) => '<tr><td>' + (i + 1) + '</td><td data-l="REF.">' + esc(x.referencia) + '</td><td data-l="DESCRIPCIÓN">' + esc(x.descripcion) + (x.observacion ? '<br><small>' + esc(x.observacion) + '</small>' : '') + '</td><td class="d" data-l="CANT.">' + esc(x.cantidad) + '</td><td class="d" data-l="PRECIO">' + money(x.precio) + '</td><td class="d" data-l="DESC.">' + money(x.descuento) + '</td><td class="d" data-l="IMPUESTO">' + esc(x.impuestos || '—') + ' ' + (x.impuesto ? '(' + money(x.impuesto) + ')' : '') + '</td><td class="d" data-l="TOTAL"><b>' + money((x.total != null ? x.total : num(x.cantidad) * num(x.precio) - num(x.descuento)) ) + '</b></td></tr>').join('');
    const formas = (d.formas || []).map(f => esc(f.nombre) + ': <b>' + money(f.valor) + '</b>').join(' &nbsp;·&nbsp; ');
    return '<div class="pl-papel" id="pl-doc"><div class="pl-top"><div><h1>INDOOR SPORT SAS</h1><small>' + esc([s.direccion, s.ciudad].filter(Boolean).join(' · ')) + (s.telefonos ? '<br>Tel. ' + esc(s.telefonos) : '') + '</small></div>' +
      '<div class="pl-num"><span>' + (d.tipo === 'remision' ? 'REMISIÓN DE VENTA' : 'COTIZACIÓN') + '</span><b>No. ' + esc(d.numero_completo || d.numero) + '</b><em>✓ CREADA EN EFFI</em></div></div>' +
      '<div class="pl-meta"><div><b>CREACIÓN</b>' + esc(d.fecha_creacion) + '</div><div><b>ENTREGA</b>' + esc(d.fecha_entrega) + '</div><div><b>VENDEDOR</b>' + esc(d.vendedor || '—') + '</div>' +
      '<div><b>CLIENTE</b>' + esc(c.nombre) + '</div><div><b>DOCUMENTO</b>' + esc(c.documento || '—') + '</div><div><b>DIRECCIÓN</b>' + esc(c.direccion || '—') + '</div></div>' +
      '<table><thead><tr><th>#</th><th>REFERENCIA</th><th>DESCRIPCIÓN</th><th class="d">CANT.</th><th class="d">PRECIO UD.</th><th class="d">DESCUENTO</th><th class="d">IMPUESTO</th><th class="d">TOTAL</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<div class="pl-pie"><div>' + (d.garantia ? '<div><b style="font:800 10px Arial;letter-spacing:.1em;color:#666">GARANTÍA / PROYECTO</b><br>' + esc(d.garantia) + '</div>' : '') + (d.observacion ? '<div style="margin-top:8px"><b style="font:800 10px Arial;letter-spacing:.1em;color:#666">OBSERVACIÓN</b><br>' + esc(d.observacion) + '</div>' : '') + '</div>' +
      '<div class="pl-tot"><div><span>Total bruto</span><b>' + money(t.bruto) + '</b></div><div><span>− Descuentos</span><b>' + money(t.descuento) + '</b></div><div><span>Subtotal</span><b>' + money(t.subtotal) + '</b></div>' + (t.propina ? '<div><span>+ Propina</span><b>' + money(t.propina) + '</b></div>' : '') +
      '<div><span>+ Impuestos</span><b>' + money(t.impuestos) + '</b></div>' + (t.retenciones ? '<div><span>− Retenciones</span><b>' + money(t.retenciones) + '</b></div>' : '') + '<div class="neto"><span>TOTAL NETO</span><b>' + money(t.total) + '</b></div></div></div>' +
      (formas ? '<div class="pl-pagos"><b style="font:800 10px Arial;letter-spacing:.1em;color:#666">FORMAS DE PAGO</b><br>' + formas + '</div>' : '') + '</div>';
  }
  function imprimir() {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc((L.doc.tipo === 'remision' ? 'Remision ' : 'Cotizacion ') + (L.doc.numero_completo || L.doc.numero)) + '</title><style>' + PRINT_CSS + '</style></head><body>' + q('#pl-doc').innerHTML + '</body></html>'); w.document.close();
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => f.remove(), 2000); }, 250);
  }
  function pantallaDoc() {
    q('[data-cuerpo]').innerHTML = htmlDoc();
    acciones('<button class="pl-btn sec" type="button" data-imprimir>IMPRIMIR</button><button class="pl-btn" type="button" data-continuar>CONTINUAR CON EL LISTADO ▶</button><button class="pl-btn sec" type="button" data-otro>CREAR OTRO DOCUMENTO</button><button class="pl-btn sec" type="button" data-cerrar>CERRAR</button>',
      'La ' + (L.doc.tipo === 'remision' ? 'remisión' : 'cotización') + ' ya está creada en Effi. Continúa con el listado para programar el pedido.', 'ok');
    q('[data-imprimir]').onclick = imprimir;
    q('[data-continuar]').onclick = () => { L.pantalla = 'mockups'; dibujar(); };
    q('[data-otro]').onclick = () => L.opts.onOtro && L.opts.onOtro();
    q('[data-cerrar]').onclick = () => L.opts.onCerrar && L.opts.onCerrar();
  }

  // ---------------------------------------------------------------- 2) mockups
  function slotHtml(ref, n) {
    const f = imagenDe(ref, n);
    return '<div class="pl-slot ' + (f ? 'ok' : '') + '" data-slot="' + esc(ref) + '|' + n + '"><span class="t">DISEÑO ' + n + (f ? ' ✓' : '') + '</span>' + (f ? '<img alt="" data-prev><small>' + esc(f.name) + '</small>' : '<small>Sin imagen. JPG, PNG o WEBP, máximo 10 MB.</small>') +
      '<input type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff" data-file><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="pl-btn sec mini" type="button" data-elegir>' + (f ? 'CAMBIAR' : 'ADJUNTAR IMAGEN') + '</button>' + (f ? '<button class="pl-btn sec mini" type="button" data-quitar>QUITAR</button>' : '') + '</div></div>';
  }
  function pantallaMockups() {
    const gs = grupos(), varias = gs.length > 1;
    const bloques = (L.compartir ? [['*', 'Todas las referencias']] : gs.map(g => [g.referencia, g.referencia + ' · ' + g.descripcion])).map(([ref, titulo]) =>
      '<div class="pl-tarjeta"><h3>' + esc(titulo) + '</h3><div class="pl-slots">' + Array.from({ length: L.disenos }, (_, i) => slotHtml(ref, i + 1)).join('') + '</div></div>').join('');
    q('[data-cuerpo]').innerHTML = '<div class="pl-tarjeta"><h3>Datos del pedido</h3><div class="pl-grid">' +
      '<label>Proyecto *<input data-proyecto value="' + esc(L.proyecto) + '" placeholder="Ej. TEMPORADA 2027"></label>' +
      '<label>Línea de producto<select data-linea><option value="">—</option>' + (L.cat.lineas || []).map(x => '<option' + (x === L.linea ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '<label>Número de diseños *<select data-disenos>' + Array.from({ length: MAX_DISENOS }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === L.disenos ? ' selected' : '') + '>' + (i + 1) + '</option>').join('') + '</select></label></div>' +
      '<label style="margin-top:12px">Observaciones del pedido<textarea data-obs placeholder="Opcional: llega a la tarjeta de Producción">' + esc(L.observaciones) + '</textarea></label>' +
      (varias ? '<label style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-top:12px;font:700 13px Arial;letter-spacing:0"><input type="checkbox" data-compartir ' + (L.compartir ? 'checked' : '') + ' style="width:auto;min-height:0"> Usar los mismos mockups en todas las referencias (' + gs.map(g => esc(g.referencia)).join(', ') + ')</label>' : '') + '</div>' + bloques +
      '<div style="margin:10px 0"><button class="pl-btn sec" type="button" data-mas-mockup' + (L.disenos >= MAX_DISENOS ? ' disabled' : '') + '>+ AGREGAR MÁS MOCKUPS</button> <small style="color:#888">Cada clic agrega un diseño más (hasta ' + MAX_DISENOS + ').</small></div>';
    acciones('<button class="pl-btn sec" type="button" data-atras>◀ VOLVER A LA COTIZACIÓN</button><button class="pl-btn" type="button" data-sigue>CONTINUAR AL LISTADO ▶</button>', '', '');
    actualizarMockups();
    q('[data-proyecto]').oninput = e => { L.proyecto = e.target.value; guardarBorrador(); actualizarMockups(); };
    q('[data-linea]').onchange = e => { L.linea = e.target.value; guardarBorrador(); };
    q('[data-obs]').oninput = e => { L.observaciones = e.target.value; guardarBorrador(); };
    q('[data-disenos]').onchange = e => { L.disenos = Number(e.target.value); guardarBorrador(); pantallaMockups(); };
    q('[data-mas-mockup]').onclick = () => { if (L.disenos < MAX_DISENOS) { L.disenos++; guardarBorrador(); pantallaMockups(); } };
    const comp = q('[data-compartir]'); if (comp) comp.onchange = () => { L.compartir = comp.checked; pantallaMockups(); };
    q('[data-atras]').onclick = () => { L.pantalla = 'doc'; dibujar(); };
    q('[data-sigue]').onclick = () => { L.pantalla = 'listado'; L.abierta = L.abierta || grupos()[0].referencia; dibujar(); };
    raiz.querySelectorAll('[data-slot]').forEach(el => {
      const [ref, n] = el.dataset.slot.split('|'), f = imagenDe(ref, Number(n)), inp = el.querySelector('[data-file]');
      if (f) { const im = el.querySelector('[data-prev]'); if (im) im.src = URL.createObjectURL(f); }
      el.querySelector('[data-elegir]').onclick = () => inp.click();
      const quitar = el.querySelector('[data-quitar]'); if (quitar) quitar.onclick = () => { delete (L.imgs[ref] || {})[Number(n)]; pantallaMockups(); };
      inp.onchange = () => {
        const a = inp.files[0]; if (!a) return;
        if (!/^image\//.test(a.type)) { setMsg('«' + a.name + '» no es una imagen.', 'error'); return; }
        if (a.size > MAX_BYTES) { setMsg('«' + a.name + '» pesa más de 10 MB.', 'error'); return; }
        (L.imgs[ref] = L.imgs[ref] || {})[Number(n)] = a; pantallaMockups();
      };
    });
  }
  function actualizarMockups() {
    const falta = slotsNecesarios().filter(([r, n]) => !imagenDe(r, n)).length, ok = falta === 0 && L.proyecto.trim();
    const b = q('[data-sigue]'); if (b) b.disabled = !ok;
    setMsg(!L.proyecto.trim() ? 'Escribe el nombre del proyecto.' : falta ? 'Faltan ' + falta + ' imagen(es): una por cada diseño' + (L.compartir ? '.' : ' de cada referencia.') : 'Mockups completos ✓', ok ? 'ok' : '');
  }

  // ---------------------------------------------------------------- 3) listado
  function contador(g) { const n = filasDe(g.referencia).length; return '<span class="pl-cont ' + (n === g.cantidad ? 'ok' : '') + '" data-cont="' + esc(g.referencia) + '">' + n + ' / ' + g.cantidad + '</span>'; }
  function filaHtml(f, i) {
    return '<tr data-i="' + i + '"><td class="n">' + (i + 1) + '</td><td><input data-c="nombre" value="' + esc(f.nombre) + '" placeholder="NOMBRE" autocomplete="off"></td>' +
      '<td data-l="TALLA" style="width:96px"><select data-c="talla" class="' + (f.talla ? '' : 'bad') + '"><option value="">—</option>' + (L.cat.tallas || TALLAS).map(t => '<option' + (t === f.talla ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select></td>' +
      '<td data-l="NÚMERO" style="width:90px"><input data-c="numero" value="' + esc(f.numero) + '" placeholder="Nº" inputmode="numeric" autocomplete="off"></td>' +
      '<td data-l="DISEÑO" style="width:96px"><select data-c="diseno">' + Array.from({ length: L.disenos }, (_, k) => '<option value="' + (k + 1) + '"' + (k + 1 === Number(f.diseno) ? ' selected' : '') + '>D' + (k + 1) + '</option>').join('') + '</select></td>' +
      '<td data-l="GÉNERO" style="width:100px"><select data-c="genero"><option value="MASC"' + (f.genero === 'MASC' ? ' selected' : '') + '>MASC</option><option value="FEM"' + (f.genero === 'FEM' ? ' selected' : '') + '>FEM</option></select></td>' +
      '<td data-l="OBSERVACIÓN"><input data-c="observacion" value="' + esc(f.observacion) + '" placeholder="Observación" autocomplete="off"></td><td style="width:34px"><button class="pl-x" type="button" data-quitar-fila aria-label="Quitar">✕</button></td></tr>';
  }
  function pantallaListado() {
    const gs = grupos(); if (!gs.find(g => g.referencia === L.abierta)) L.abierta = gs[0].referencia;
    const g = gs.find(x => x.referencia === L.abierta), filas = filasDe(g.referencia);
    if (!filas.length && !L.relleno[g.referencia]) {   // la primera vez que se abre una referencia ya trae sus filas en blanco (una por prenda cotizada)
      for (let k = 0; k < g.cantidad; k++) filas.push(filaVacia());
      L.relleno[g.referencia] = true; guardarBorrador();
    }
    q('[data-cuerpo]').innerHTML = '<div class="pl-refs">' + gs.map(x => '<button type="button" class="pl-ref ' + (x.referencia === L.abierta ? 'on' : '') + '" data-ref="' + esc(x.referencia) + '">' + esc(x.referencia) + contador(x) + '</button>').join('') + '</div>' +
      '<div class="pl-tarjeta"><h3>' + esc(g.referencia) + ' · ' + esc(g.descripcion) + ' · ' + g.cantidad + ' prendas</h3>' +
      '<div class="pl-herr"><label>Diseño nuevo<select data-def-diseno>' + Array.from({ length: L.disenos }, (_, k) => '<option value="' + (k + 1) + '"' + (k + 1 === L.defDiseno ? ' selected' : '') + '>D' + (k + 1) + '</option>').join('') + '</select></label>' +
      '<label>Género nuevo<select data-def-genero><option' + (L.defGenero === 'MASC' ? ' selected' : '') + '>MASC</option><option' + (L.defGenero === 'FEM' ? ' selected' : '') + '>FEM</option></select></label>' +
      '<button class="pl-btn sec mini" type="button" data-mas>+ AGREGAR FILA</button><button class="pl-btn sec mini" type="button" data-mas5>+ AGREGAR 5 FILAS</button><button class="pl-btn sec mini" type="button" data-completar>COMPLETAR HASTA ' + g.cantidad + '</button><button class="pl-btn sec mini" type="button" data-pegar>PEGAR DESDE EXCEL</button></div>' +
      '<div data-pegado hidden class="pl-tarjeta" style="margin:0 0 10px"><label>Pega aquí las filas copiadas de Excel (columnas: NOMBRE, TALLA, NÚMERO, DISEÑO, GÉNERO, OBSERVACIÓN; separadas por tabulador o punto y coma)<textarea data-pegado-texto spellcheck="false"></textarea></label><div style="display:flex;gap:8px;margin-top:8px"><button class="pl-btn mini" type="button" data-pegado-ok>PEGAR FILAS</button><button class="pl-btn sec mini" type="button" data-pegado-no>CANCELAR</button></div></div>' +
      '<div class="pl-tabla-caja"><table class="pl-tabla"><thead><tr><th></th><th>NOMBRE</th><th>TALLA *</th><th>NÚMERO</th><th>DISEÑO</th><th>GÉNERO</th><th>OBSERVACIÓN</th><th></th></tr></thead><tbody data-filas>' + filas.map(filaHtml).join('') + '</tbody></table></div></div>';
    acciones('<button class="pl-btn sec" type="button" data-atras>◀ MOCKUPS</button><button class="pl-btn" type="button" data-programar>PROGRAMAR PEDIDO EN PRODUCCIÓN</button>', '', '');
    estadoListado();
    raiz.querySelectorAll('[data-ref]').forEach(b => b.onclick = () => { L.abierta = b.dataset.ref; pantallaListado(); });
    q('[data-atras]').onclick = () => { L.pantalla = 'mockups'; dibujar(); };
    q('[data-def-diseno]').onchange = e => { L.defDiseno = Number(e.target.value); };
    q('[data-def-genero]').onchange = e => { L.defGenero = e.target.value; };
    q('[data-mas]').onclick = () => { filas.push(filaVacia()); guardarBorrador(); pantallaListado(); enfocarUltima(); };
    q('[data-mas5]').onclick = () => { for (let k = 0; k < 5; k++) filas.push(filaVacia()); guardarBorrador(); pantallaListado(); enfocarUltima(); };
    q('[data-completar]').onclick = () => { while (filas.length < g.cantidad) filas.push(filaVacia()); guardarBorrador(); pantallaListado(); };
    q('[data-pegar]').onclick = () => { q('[data-pegado]').hidden = !q('[data-pegado]').hidden; q('[data-pegado-texto]').focus(); };
    q('[data-pegado-no]').onclick = () => { q('[data-pegado]').hidden = true; };
    q('[data-pegado-ok]').onclick = () => { const n = pegar(g.referencia, q('[data-pegado-texto]').value); guardarBorrador(); pantallaListado(); setMsg(n + ' fila(s) agregadas.', 'ok'); };
    const tb = q('[data-filas]');
    tb.addEventListener('input', e => {   // sin redibujar la tabla: solo se actualiza la fila, el contador y el estado
      const tr = e.target.closest('tr'); if (!tr) return; const f = filas[Number(tr.dataset.i)], c = e.target.dataset.c; if (!f || !c) return;
      if (c === 'nombre' || c === 'observacion') { const pos = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); try { e.target.setSelectionRange(pos, pos); } catch (er) { /* sin cursor */ } }   // se ve y se guarda en mayúsculas, como en la plantilla
      f[c] = e.target.value; if (c === 'diseno') f.diseno = Number(e.target.value);
      if (c === 'talla') e.target.classList.toggle('bad', !f.talla);
      guardarBorrador(); estadoListado();
    });
    tb.addEventListener('keydown', e => {   // Enter en la última observación agrega una fila nueva y salta a su nombre: captura rápida
      if (e.key !== 'Enter' || e.target.dataset.c !== 'observacion') return; e.preventDefault();
      const i = Number(e.target.closest('tr').dataset.i); if (i === filas.length - 1) { filas.push(filaVacia()); guardarBorrador(); pantallaListado(); enfocarUltima(); } else { const sig = tb.querySelector('tr[data-i="' + (i + 1) + '"] [data-c="nombre"]'); sig && sig.focus(); }
    });
    tb.addEventListener('click', e => { const b = e.target.closest('[data-quitar-fila]'); if (!b) return; filas.splice(Number(b.closest('tr').dataset.i), 1); guardarBorrador(); pantallaListado(); });
    q('[data-programar]').onclick = enviar;
  }
  function enfocarUltima() { const t = q('[data-filas]'); const u = t && t.querySelector('tr:last-child [data-c="nombre"]'); if (u) u.focus(); }
  function pegar(ref, texto) {
    const filas = filasDe(ref); let n = 0;
    String(texto || '').split(/\r?\n/).forEach(linea => {
      if (!linea.trim()) return;
      const c = (linea.includes('\t') ? linea.split('\t') : linea.split(';')).map(x => x.trim());
      if (/^nombre$/i.test(c[0]) && /^talla$/i.test(c[1] || '')) return;   // encabezado copiado
      const talla = String(c[1] || '').toUpperCase(), d = String(c[3] || '').match(/\d+/), g = String(c[4] || '').toUpperCase();
      const nueva = { nombre: String(c[0] || '').toUpperCase(), talla: (L.cat.tallas || TALLAS).includes(talla) ? talla : '', numero: c[2] || '', diseno: d && Number(d[0]) >= 1 && Number(d[0]) <= L.disenos ? Number(d[0]) : (L.defDiseno || 1), genero: /^F/.test(g) ? 'FEM' : /^M/.test(g) ? 'MASC' : (L.defGenero || 'MASC'), observacion: String(c[5] || '').toUpperCase() };
      const hueco = filas.findIndex(x => !x.nombre && !x.talla && !x.numero && !x.observacion);   // primero llena las filas en blanco y solo agrega si no quedan
      if (hueco >= 0) filas[hueco] = nueva; else filas.push(nueva);
      n++;
    });
    return n;
  }
  function estadoListado() {
    grupos().forEach(g => { const el = raiz.querySelector('[data-cont="' + g.referencia.replace(/"/g, '') + '"]'); if (el) { const n = filasDe(g.referencia).length; el.textContent = n + ' / ' + g.cantidad; el.classList.toggle('ok', n === g.cantidad); } });
    const f = faltantes(), b = q('[data-programar]'); if (b) b.disabled = f.length > 0 || L.enviando;
    if (L.enviando) return;
    setMsg(f.length ? f.slice(0, 6).join('\n') + (f.length > 6 ? '\n…y ' + (f.length - 6) + ' más' : '') : 'Listado completo ✓ Ya puedes programar el pedido.', f.length ? '' : 'ok');
  }

  // ---------------------------------------------------------------- envío y seguimiento
  async function enviar() {
    if (L.enviando) return;
    const f = faltantes(); if (f.length) { setMsg(f.join('\n'), 'error'); return; }
    L.enviando = true; const b = q('[data-programar]'); b.disabled = true; setMsg('Enviando el pedido a Producción…', '');
    const listado = {}; grupos().forEach(g => { listado[g.referencia] = filasDe(g.referencia).map(x => ({ nombre: x.nombre, talla: x.talla, numero: x.numero, diseno: Number(x.diseno), genero: x.genero, observacion: x.observacion })); });
    const doc = Object.assign({}, L.doc, { proyecto: L.proyecto.trim(), disenos: L.disenos });
    const fd = new FormData(); fd.append('payload', JSON.stringify({ doc, listado, linea: L.linea, observaciones: L.observaciones }));
    grupos().forEach(g => { for (let n = 1; n <= L.disenos; n++) { const img = imagenDe(L.compartir ? '*' : g.referencia, n); if (img) fd.append('mockup:' + g.referencia + ':' + n, img, img.name); } });
    try {
      const r = await fetch('/api/pedido-effi/programar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo programar el pedido (error ' + r.status + ')');
      L.enviando = false; L.pantalla = 'enviado'; L.job = { id: j.id, estado: j.estado || 'RECIBIDO', detail: '' }; dibujar(); seguir();
    } catch (e) { L.enviando = false; if (b.isConnected) b.disabled = false; setMsg(String(e.message || e), 'error'); }
  }
  function pantallaEnviado() {
    const j = L.job || {}, fin = ['COMPLETADO', 'ERROR', 'REVISAR'].includes(j.estado), ok = j.estado === 'COMPLETADO';
    q('[data-cuerpo]').innerHTML = '<div class="pl-listo"><span style="font:800 12px Arial;letter-spacing:.14em;color:#d0f44c">PEDIDO ENVIADO A PRODUCCIÓN</span><strong>' + esc((L.doc.tipo === 'remision' ? 'RM' : 'CO') + L.doc.numero) + '</strong>' +
      '<div style="color:#a9b5a3;font:600 14px Arial">' + (ok ? 'Quedó programado: ya aparece en Producción con su listado y sus mockups.' : fin ? 'El programar pedido no pudo terminarlo. Lee el motivo y corrígelo.' : 'Procesando… (' + esc(j.estado || 'RECIBIDO') + '). Esto tarda unos segundos.') + '</div>' +
      (j.detail ? '<div class="caja ' + (ok ? 'ok' : fin ? 'error' : '') + '">' + esc(j.detail) + '</div>' : '') + '</div>';
    acciones((fin && !ok ? '<button class="pl-btn sec" type="button" data-volver>◀ VOLVER AL LISTADO</button>' : '') + '<button class="pl-btn sec" type="button" data-otro>CREAR OTRO DOCUMENTO</button><button class="pl-btn" type="button" data-cerrar>CERRAR</button>', '', '');
    const v = q('[data-volver]'); if (v) v.onclick = () => { L.pantalla = 'listado'; dibujar(); };
    q('[data-otro]').onclick = () => L.opts.onOtro && L.opts.onOtro();
    q('[data-cerrar]').onclick = () => L.opts.onCerrar && L.opts.onCerrar();
  }
  async function seguir() {
    for (let k = 0; k < 60 && raiz && raiz.isConnected && L.pantalla === 'enviado'; k++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await fetch('/api/procesos', { credentials: 'same-origin' }); const lista = await r.json();
        const m = (lista || []).find(x => x.id === L.job.id); if (!m) continue;
        const cambio = m.status !== L.job.estado || m.detail !== L.job.detail; L.job.estado = m.status; L.job.detail = m.detail || '';
        if (cambio && raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado();
        if (['COMPLETADO', 'ERROR', 'REVISAR'].includes(m.status)) { if (m.status === 'COMPLETADO') { try { localStorage.removeItem(claveBorrador()); } catch (e) { /* nada */ } } return; }
      } catch (e) { /* se reintenta */ }
    }
  }

  // ---------------------------------------------------------------- entrada
  function abrir(contenedor, doc, opts) {
    raiz = contenedor;
    Object.keys(L).forEach(k => delete L[k]);
    Object.assign(L, { doc, opts: opts || {}, cat: (opts && opts.cat) || {}, pantalla: 'doc', disenos: 1, proyecto: String(doc.proyecto || doc.garantia || ''), linea: '', observaciones: '', compartir: true, imgs: {}, listado: {}, relleno: {}, defDiseno: 1, defGenero: 'MASC', enviando: false });
    cargarBorrador();
    L.compartir = grupos().length > 1;
    dibujar();
  }
  window.PedidoListado = { abrir };
})();
