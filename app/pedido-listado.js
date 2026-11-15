(() => {
  // LISTADO DEL PEDIDO (EMPEZAR PEDIDO): al crear la cotización en Effi se muestra aquí su réplica; con «Continuar con el listado» el comercial adjunta los mockups, llena el
  // listado (nombre, talla, número, diseño, género y observación de cada prenda) y lo programa en Producción (POST /api/pedido-effi/programar → el programar pedido de siempre).
  if (window.PedidoListado) return;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const MAX_DISENOS = 6, MAX_BYTES = 10 * 1024 * 1024;
  const TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

  const HOJA_CSS = `
  .pl-papel{width:794px;min-height:1000px;box-sizing:border-box;margin:0 auto;background:#fff;color:#111;padding:26px 30px 22px;font:11px/1.35 Arial,Helvetica,sans-serif;display:flex;flex-direction:column;border-radius:6px}
  .pl-papel b{font-weight:700}.pl-papel *{text-align:left!important}
  .pl-papel .cab{display:grid;grid-template-columns:150px 1fr 170px;gap:12px;align-items:start}
  .pl-papel .cab img{width:140px;height:auto;display:block;filter:invert(1) grayscale(1) contrast(1.4)}
  .pl-papel .emp{text-align:center!important}.pl-papel .emp *{text-align:center!important}.pl-papel .emp h1{margin:0;font:italic 900 17px Arial}.pl-papel .emp .sub{font:800 11px Arial;margin:2px 0 6px}
  .pl-papel .doc{text-align:center!important}.pl-papel .doc *{text-align:center!important}.pl-papel .doc .ti{font:900 12px Arial;letter-spacing:.04em;margin-top:6px}.pl-papel .doc .ok{display:inline-block;margin:4px 0 6px;padding:1px 8px;border-radius:99px;background:#e4f7b0;color:#2c4a00;font:800 9px Arial}
  .pl-papel .fechas{margin-top:4px;line-height:1.6}.pl-papel .fechas *{text-align:center!important}
  .pl-papel table.cli{width:calc(100% - 180px);border-collapse:collapse;margin-top:14px;border:1px solid #111}.pl-papel table.cli td{border:1px solid #111;padding:2px 4px;font-size:11px}
  .pl-papel table.items{width:100%;border-collapse:collapse;margin-top:18px}.pl-papel table.items th{font:800 10px Arial;text-align:center!important;padding:4px 6px;border-top:1px solid #111;border-bottom:1px solid #111}
  .pl-papel table.items td{padding:4px 6px;font-size:10.5px;vertical-align:top;white-space:nowrap}.pl-papel table.items td.l{white-space:normal}.pl-papel table.items td.r{text-align:right!important}.pl-papel table.items td.c{text-align:center!important}
  .pl-papel .tot-i{text-align:center!important;font-weight:700;margin:6px 0}.pl-papel .tot-i *{text-align:center!important}
  .pl-papel .hueco{flex:1 1 auto;min-height:40px}
  .pl-papel table.pie{width:100%;border-collapse:collapse;border:1px solid #111}.pl-papel table.pie td{border:1px solid #111;vertical-align:top;padding:2px 4px;font-size:10.5px}
  .pl-papel table.pie td.sum{width:190px;padding:0}.pl-papel table.pie td.sum div{display:flex;justify-content:space-between;gap:8px;padding:1px 6px;font-weight:700}.pl-papel table.pie td.sum div:first-child{border-bottom:1px solid #111}
  .pl-papel .legal{font:italic 9.5px/1.35 Arial;margin:5px 0;text-align:justify!important}.pl-papel .legal *{text-align:justify!important}
  .pl-papel table.firmas{width:100%;border-collapse:collapse;border:1px solid #111}.pl-papel table.firmas td{border:1px solid #111;height:70px;vertical-align:bottom;text-align:center!important;font-size:10px;padding:2px 4px}
  .pl-papel table.firmas td.obs{vertical-align:top;text-align:left!important}.pl-papel table.firmas td .ln{border-top:1px solid #111;margin:0 10px;padding-top:1px}
  `;
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
  /* réplica de la cotización: la misma hoja que imprime Effi (se ve igual en computador y en celular; en celular se reduce para que quepa) */
  .pl-hoja-caja{width:100%;max-width:820px;margin:0 auto;overflow:hidden}
  ${HOJA_CSS}
  .pl-pdf-caja{max-width:1000px}
  .pl-pdf-estado{display:flex;flex-direction:column;align-items:center;gap:10px;padding:46px 20px;border:1px dashed rgba(208,244,76,.45);border-radius:16px;background:rgba(208,244,76,.05);text-align:center}
  .pl-pdf-estado b{font:900 15px Arial}.pl-pdf-estado small{color:#a9b5a3;font:600 12px/1.5 Arial;max-width:460px}.pl-pdf-acc{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px}
  .pl-spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(208,244,76,.25);border-top-color:#d0f44c;animation:plgira 1s linear infinite}@keyframes plgira{to{transform:rotate(360deg)}}
  .pl-pdf-barra{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 4px;font:800 12px Arial;color:#c9d3c1}.pl-pdf-barra a{text-decoration:none;display:inline-flex;align-items:center}
  .pl-pdf{display:grid;gap:12px;justify-items:center;max-height:calc(100vh - 300px);overflow:auto;padding:4px}.pl-pdf-hoja{display:block;width:100%;max-width:900px;height:auto;background:#fff;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.4)}
  .pl-progreso{height:12px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin:14px auto 4px;max-width:520px}.pl-progreso i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#9fcd12,#d0f44c);box-shadow:0 0 12px rgba(208,244,76,.6);transition:width .5s}
  .pl-pasos2{list-style:none;margin:14px auto 0;padding:0;max-width:520px;text-align:left;display:grid;gap:6px}.pl-pasos2 li{display:flex;gap:10px;align-items:center;font:700 13px Arial;color:#7d8a77}.pl-pasos2 li span{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:1px solid #3d4c3b;font:900 12px Arial}
  .pl-pasos2 li.hecho{color:#e8f0e0}.pl-pasos2 li.hecho span{background:#d0f44c;color:#142017;border-color:#d0f44c}.pl-pasos2 li.activo{color:#d0f44c}.pl-pasos2 li.activo span{border-color:#d0f44c;animation:plpulso 1s infinite}@keyframes plpulso{50%{opacity:.35}}
  .pl-fotos{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px}.pl-fotos figure{margin:0;text-align:center}.pl-fotos img{display:block;height:120px;width:auto;border-radius:8px;background:#fff}.pl-fotos figcaption{font:800 11px Arial;margin-top:3px;color:#c9d3c1}
  .pl-xl-t{width:100%;border-collapse:collapse;font:600 12px Arial}.pl-xl-t th{background:#1d2a1d;font:800 10px Arial;letter-spacing:.06em;text-align:left;padding:5px 7px}.pl-xl-t td{padding:5px 7px;border-bottom:1px solid rgba(255,255,255,.08)}
  .pl-env{display:grid;gap:14px;grid-template-columns:minmax(260px,360px) minmax(0,1fr);align-items:start}
  .pl-env-estado{margin:0!important;max-width:none!important;position:sticky;top:0}
  .pl-xl{min-width:0;border:1px solid #2f3b2f;border-radius:12px;overflow:hidden;background:#fff;color:#111}
  .xl-titulo{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#1d6b3c;color:#fff;font:700 12px Arial}.xl-titulo small{margin-left:auto;font:700 11px Arial;color:#d9f5e3}
  .xl-ico{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:3px;background:#fff;color:#1d6b3c;font:900 12px Arial}
  .xl-scroll{overflow:auto;max-height:calc(100vh - 300px);min-height:300px;background:#fff}
  .xl-hoja{position:relative;font-family:Calibri,Arial,sans-serif}
  .xl-col,.xl-fil{position:absolute;background:#f3f3f3;color:#555;font:600 11px Arial;display:flex;align-items:center;justify-content:center;border-right:1px solid #d4d4d4;border-bottom:1px solid #d4d4d4;box-sizing:border-box;z-index:2}
  .xl-col{top:0;height:22px}.xl-fil{left:0;width:24px}.xl-fil.on{background:#e3f2e8;color:#1d6b3c}
  .xl-red{position:absolute;background-image:linear-gradient(#e2e2e2 1px,transparent 1px),linear-gradient(90deg,#e2e2e2 1px,transparent 1px);background-size:64px 20px}
  .xl-c{position:absolute;box-sizing:border-box;display:flex;align-items:center;padding:0 3px;overflow:hidden;white-space:nowrap;border-right:1px solid #e2e2e2;border-bottom:1px solid #e2e2e2;color:#111;opacity:0;transition:opacity .25s}
  .xl-c.on{opacity:1}
  .xl-img{position:absolute;object-fit:contain;opacity:0;transform:scale(.6);transition:opacity .4s,transform .4s;z-index:3;box-shadow:0 4px 14px rgba(0,0,0,.25)}.xl-img.on{opacity:1;transform:none}
  .xl-sel{position:absolute;border:2px solid #1d6b3c;box-shadow:0 0 0 1px #fff inset;z-index:4;pointer-events:none;transition:top .12s}
  .xl-tabs{display:flex;gap:2px;padding:4px 6px 0;background:#e9e9e9;border-top:1px solid #ccc;overflow-x:auto}.xl-tabs button{all:unset;cursor:pointer;padding:5px 14px;font:700 11px Arial;color:#444;background:#ddd;border-radius:4px 4px 0 0}.xl-tabs button.on{background:#fff;color:#1d6b3c;border-bottom:2px solid #1d6b3c}
  @media(max-width:900px){.pl-env{grid-template-columns:1fr}.pl-env-estado{position:static}.xl-scroll{max-height:60vh}}
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
    .pl-acciones{position:sticky;bottom:0;z-index:6;box-shadow:0 -8px 18px rgba(0,0,0,.45);padding:8px 10px;gap:6px}.pl-acciones .pl-btn{width:auto!important;flex:1 1 42%;min-height:28px;padding:3px 8px;font-size:9px}.pl-acciones p,.pl-acciones [data-msg]{flex:1 1 100%;font-size:12px;margin:0}
    .pl-slots{grid-template-columns:1fr!important}.pl-herr .pl-btn{flex:1 1 45%}
  }
  @media(max-width:900px){.pl{height:auto}.pl-acciones .pl-btn{width:100%}.pl-tabla{min-width:720px}.pl-cuerpo{overflow:visible}.pl-tabla-caja{overflow:auto}}
  @media(max-width:700px){
    .pl,.pl *{text-align:center}.pl h1{font-size:14px}.pl h3{font-size:11px}.pl label{font-size:8.5px;letter-spacing:.05em;justify-items:center}
    .pl input,.pl select,.pl textarea{font-size:12px!important;text-align:center;text-align-last:center}.pl input,.pl select{min-height:28px;height:30px}
    .pl-btn{font-size:9px!important;min-height:26px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;text-align:center}
    .pl-pdf{max-height:none}.pl-pdf-barra{justify-content:center}
    .pl-pasos{justify-content:center}.pl-paso{font-size:10px;padding:4px 8px}.pl-refs{justify-content:center}.pl-herr{justify-content:center}.pl-herr label{min-width:110px}
    .pl-tabla input,.pl-tabla select{min-height:28px!important;height:30px;font-size:12px!important}.pl-tabla td[data-l]::before{text-align:center}
    .pl-slot{justify-items:center;align-items:center}.pl-slot>div{justify-content:center}.pl-msg{font-size:12px;text-align:center}
    .pl-acciones{justify-content:center}
  }
  `;
  document.head.appendChild(css);

  window.addEventListener('resize', () => ajustarHoja());
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
  const EMPRESA = { nombre: 'INDOOR SPORT SAS', marca: 'INDOOR', nit: '901282105', regimen: 'Régimen ordinario Responsable de IVA', provincia: 'Antioquia', ciudad: 'Itagüí', direccion: 'Calle 45 No 48- 43 Edf Libertador Brr La Gloria', telefonos: '3178861060', email: 'facturacion1indoor@gmail.com' };
  const LEGAL = 'POR FAVOR CONSIGNAR AL NUMERO DE CUENTA 277000476-58 BANCOLOMBIA AHORROS A NOMBRE DE INDOOR SPORT S.A.S. La garantía del producto corresponde especificaciones técnicas de confección y diseño del uniforme. Esta debe hacerse en los siguientes 5 días hábiles después de la entrega del pedido. En caso tal de que el tallaje no se ajuste a la persona, no se tomará como garantía si el pedido se entrega en las tallas que el cliente solicitó.';
  const m2 = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // como Effi: $1,034,999.94
  function htmlDoc() {
    const d = L.doc, s = d.sucursal || {}, c = d.cliente || {}, t = d.totales || {}, e = EMPRESA;
    const lineas = d.conceptos || [], unidades = lineas.reduce((a, x) => a + num(x.cantidad), 0);
    const pct = x => { const m = String(x.impuestos || '').match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? m[1].replace(',', '.') + '%' : (num(x.impuesto) ? '' : '0%'); };
    const filas = lineas.map((x, i) => {
      const base = num(x.cantidad) * num(x.precio) - num(x.descuento), tot = x.total != null ? x.total : base + num(x.impuesto);
      return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(x.referencia) + '</td><td class="l">' + esc(x.descripcion) + (x.observacion ? '<br><i>' + esc(x.observacion) + '</i>' : '') + '</td><td class="c">' + esc(x.cantidad) + '</td><td class="r">' + m2(x.precio) + '</td><td class="r">' + m2(x.descuento).replace('.00', '') + '</td><td class="r">' + pct(x) + ' ' + m2(x.impuesto) + '</td><td class="r">' + m2(tot) + '</td></tr>';
    }).join('');
    const porImp = {};   // detalle de impuestos: base y valor por cada impuesto
    lineas.forEach(x => { const k = String(x.impuestos || '').trim(); if (!k || !num(x.impuesto)) return; const g = porImp[k] = porImp[k] || { base: 0, valor: 0 }; g.base += num(x.cantidad) * num(x.precio) - num(x.descuento); g.valor += num(x.impuesto); });
    const detImp = Object.keys(porImp).map(k => 'Base I: ' + m2(porImp[k].base) + ' | ' + esc(k) + ' | Valor: ' + m2(porImp[k].valor)).join('<br>') || '&nbsp;';
    const formas = (d.formas || []).map(f => esc(f.nombre) + ' - Valor: ' + m2(f.valor)).join('<br>');
    const docNum = esc(d.numero_completo || d.numero), tipo = d.tipo === 'remision' ? 'REMISIÓN DE VENTA' : 'COTIZACIÓN';
    const m = String(c.documento || '').match(/^([A-Za-z.]+)\s+(.+)$/), tdoc = m ? m[1] : 'CC', ndoc = m ? m[2] : (c.documento || '');
    return '<div class="pl-papel" id="pl-doc">' +
      '<div class="cab"><img src="/marca-indoor.png" alt="Indoor"><div class="emp"><h1>' + e.nombre + '</h1><div class="sub">' + e.marca + '</div><div><b>NIT:</b> ' + e.nit + ' | <b>' + e.regimen + '</b></div>' +
      '<div>' + esc(s.ciudadProv || e.provincia) + ' / ' + esc(e.ciudad) + ' / ' + esc(s.direccion || e.direccion) + '</div><div><b>Teléfonos:</b> ' + esc(s.telefonos || e.telefonos) + '</div><div><b>Email:</b> ' + e.email + '</div></div>' +
      '<div class="doc"><div class="ti">' + tipo + '<br>No. ' + docNum + '</div><div class="ok">✓ CREADA EN EFFI</div><div class="fechas"><b>Creación:</b> ' + esc(d.fecha_hora || d.fecha_creacion) + '<br><b>Entrega:</b> ' + esc(d.fecha_entrega) + '<br><b>Página:</b> 1 de 1</div></div></div>' +
      '<table class="cli"><tr><td colspan="2" style="width:70%"><b>Cliente:</b> ' + esc(c.nombre) + '.</td><td><b>' + esc(tdoc) + ':</b> ' + esc(ndoc) + '</td></tr>' +
      '<tr><td style="width:35%"><b>Teléfono:</b> ' + esc(c.telefono || '') + '</td><td colspan="2"><b>Email:</b> ' + esc(c.email || '') + '</td></tr>' +
      '<tr><td colspan="3"><b>Dirección:</b> ' + esc(c.direccion || '') + '</td></tr>' +
      '<tr><td colspan="3"><b>Elaboró:</b> ' + esc(d.elaboro || d.vendedor || '') + '</td></tr><tr><td colspan="3"><b>Vendedor:</b> ' + esc(d.vendedor || '') + '</td></tr></table>' +
      '<table class="items"><thead><tr><th>ÍTEM</th><th>REF.</th><th>DESCRIPCIÓN</th><th>CANT.</th><th>PRECIO UD.</th><th>DESCUENTO</th><th>IMPUESTOS</th><th>TOTAL NETO</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<div class="tot-i">Total ítems: ' + lineas.length + ' - Total unidades: ' + unidades + '</div><div class="hueco"></div>' +
      '<table class="pie"><tr><td style="width:30%"><b>FORMA DE PAGO:</b><br>' + (formas || '&nbsp;') + '</td><td><b>DETALLE DE IMPUESTOS:</b><br>' + detImp + '</td>' +
      '<td class="sum"><div><span>SUBTOTAL</span><span>' + m2(t.subtotal) + '</span></div><div><span>+ Impuestos</span><span>' + m2(t.impuestos) + '</span></div>' + (num(t.propina) ? '<div><span>+ Propina</span><span>' + m2(t.propina) + '</span></div>' : '') + (num(t.retenciones) ? '<div><span>− Retenciones</span><span>' + m2(t.retenciones) + '</span></div>' : '') + '<div><span>TOTAL NETO</span><span>' + m2(t.total) + '</span></div></td></tr></table>' +
      '<div class="legal">' + esc(LEGAL) + '</div>' +
      '<table class="firmas"><tr><td style="width:30%"><div class="ln">Firma y sello emisor</div></td><td class="obs"><b>Observación:</b> ' + esc(d.observacion || 'Creada desde el panel') + '<br><b>Garantía:</b> ' + esc(d.garantia || '') + '</td><td style="width:32%"><b>Recibí a satisfacción:</b><br><br><div class="ln">Nombre, identificación, sello y fecha</div></td></tr></table></div>';
  }
  function ajustarHoja() {   // en celular la hoja (794 px) se reduce para que quepa completa; en pantallas anchas se ve a tamaño real
    const caja = raiz && raiz.querySelector('.pl-hoja-caja'), hoja = caja && caja.querySelector('.pl-papel'); if (!hoja) return;
    const z = Math.min(1, (caja.clientWidth || 794) / 794); hoja.style.zoom = z < 1 ? String(z) : '';
  }
  function imprimir() {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc((L.doc.tipo === 'remision' ? 'Remision ' : 'Cotizacion ') + (L.doc.numero_completo || L.doc.numero)) + '</title><style>@page{size:letter;margin:8mm}body{margin:0}' + HOJA_CSS + '.pl-papel{zoom:1!important;width:auto;min-height:0;border-radius:0;padding:0}.pl-papel .cab img{filter:none}</style></head><body>' + htmlDoc() + '</body></html>'); w.document.close();
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => f.remove(), 2000); }, 250);
  }
  // El documento que se muestra es el MISMO PDF que genera Effi (lo baja EFFITRON con su sesión web). La réplica propia solo queda para remisiones o si el PDF no llega.
  function pantallaDoc() {
    const numero = String(L.doc.numero || '').replace(/\D/g, ''), conPdf = L.doc.tipo !== 'remision' && !!numero;
    const botones = '<button class="pl-btn sec" type="button" data-imprimir>IMPRIMIR</button><button class="pl-btn" type="button" data-continuar>CONTINUAR CON EL LISTADO ▶</button><button class="pl-btn sec" type="button" data-otro>CREAR OTRO DOCUMENTO</button><button class="pl-btn sec" type="button" data-cerrar>CERRAR</button>';
    const msgOk = 'La ' + (L.doc.tipo === 'remision' ? 'remisión' : 'cotización') + ' ya está creada en Effi. Continúa con el listado para programar el pedido.';
    if (L.numeroPdf !== numero) { L.pdfListo = false; L.numeroPdf = numero; }
    if (conPdf) q('[data-cuerpo]').innerHTML = '<div class="pl-hoja-caja pl-pdf-caja"><div class="pl-pdf-estado" data-pdf-estado><div class="pl-spin"></div><b>Trayendo el PDF de Effi… <span data-pdf-seg>0 s</span></b><small>EFFITRON lo descarga de Effi con su sesión (suele tardar 30 a 90 segundos). Mientras tanto puedes seguir con «CONTINUAR CON EL LISTADO»: el PDF quedará listo en el paso 1.</small></div></div>';
    else { q('[data-cuerpo]').innerHTML = '<div class="pl-hoja-caja">' + htmlDoc() + '</div>'; ajustarHoja(); }
    acciones(botones, msgOk, 'ok');
    q('[data-imprimir]').onclick = () => {
      if (L.pdfListo) { window.open('/api/pedido-effi/pdf/' + numero, '_blank'); return; }   // se abre el PDF de Effi: ahí se imprime tal cual
      if (conPdf && !raiz.querySelector('#pl-doc')) { setMsg('Espera un momento: el PDF de Effi todavía se está trayendo.', 'error'); return; }
      imprimir();
    };
    q('[data-continuar]').onclick = () => { L.pantalla = 'mockups'; dibujar(); };
    q('[data-otro]').onclick = () => L.opts.onOtro && L.opts.onOtro();
    q('[data-cerrar]').onclick = () => L.opts.onCerrar && L.opts.onCerrar();
    if (conPdf) esperarPdf(numero, L.pdfListo ? 39 : 0);
  }
  async function esperarPdf(numero, intento) {
    const caja = () => (L.pantalla === 'doc' && raiz && raiz.isConnected) ? raiz.querySelector('.pl-pdf-caja') : null;
    if (!raiz || !raiz.isConnected || L.numeroPdf !== numero) return;
    if (!caja() && L.pdfListo) return;
    const t = caja() && caja().querySelector('[data-pdf-seg]'); if (t) t.textContent = (intento * 3) + ' s';
    const falla = (texto) => {
      const c = caja(); if (!c) return;
      c.innerHTML = '<div class="pl-pdf-estado"><b>' + esc(texto) + '</b><small>La cotización sí quedó creada en Effi (No. ' + esc(numero) + '). Puedes continuar con el listado.</small><div class="pl-pdf-acc"><button class="pl-btn" type="button" data-pdf-reintentar>REINTENTAR</button><button class="pl-btn sec" type="button" data-pdf-replica>VER RÉPLICA DEL PANEL</button></div></div>';
      c.querySelector('[data-pdf-reintentar]').onclick = () => { c.innerHTML = '<div class="pl-pdf-estado"><div class="pl-spin"></div><b>Trayendo el PDF de Effi…</b></div>'; esperarPdf(numero, 0); };
      c.querySelector('[data-pdf-replica]').onclick = () => { c.classList.remove('pl-pdf-caja'); c.innerHTML = htmlDoc(); ajustarHoja(); };
    };
    try {
      const r = await fetch('/api/pedido-effi/pdf-estado/' + numero, { credentials: 'same-origin', cache: 'no-store' }).then(x => x.ok ? x.json() : Promise.reject(new Error('Error ' + x.status)));
      if (r.estado === 'listo') {
        L.pdfListo = true; L.pdfUrl = '/api/pedido-effi/pdf/' + numero;
        if (!caja()) return;   // llegó mientras se trabajaba en otro paso: se mostrará al volver a «1 · COTIZACIÓN»
        const url = '/api/pedido-effi/pdf/' + numero;
        const hojas = Array.from({ length: Math.max(1, Number(r.paginas) || 1) }, (_, k) => '<img class="pl-pdf-hoja" alt="Página ' + (k + 1) + '" src="/api/pedido-effi/pdf-img/' + numero + '/' + (k + 1) + '">').join('');
        caja().innerHTML = '<div class="pl-pdf-barra"><span>PDF de Effi · Cotización ' + esc(numero) + '</span><span><a class="pl-btn sec mini" href="' + url + '" target="_blank" rel="noopener">ABRIR</a> <a class="pl-btn sec mini" href="' + url + '?descargar=1">DESCARGAR</a></span></div><div class="pl-pdf">' + hojas + '</div>';
        return;
      }
      if (r.estado === 'error') return falla('No pude traer el PDF de Effi: ' + (r.detalle || 'el agente no respondió'));
      if (intento >= 40) return falla(r.agente ? 'El PDF de Effi está tardando más de lo normal.' : 'El agente que baja los PDF de Effi (EFFITRON) no está conectado.');
    } catch (e) { if (intento >= 40) return falla('No pude consultar el PDF de Effi.'); }
    setTimeout(() => esperarPdf(numero, intento + 1), 3000);
  }

  // ---------------------------------------------------------------- 2) mockups
  function slotHtml(ref, n) {
    const f = imagenDe(ref, n);
    return '<div class="pl-slot ' + (f ? 'ok' : '') + '" data-slot="' + esc(ref) + '|' + n + '"><span class="t">DISEÑO ' + n + (f ? ' ✓' : '') + '</span>' + (f ? '<img alt="" data-prev><small>' + esc(f.name) + '</small>' : '<small>Opcional. JPG, PNG o WEBP, máximo 10 MB.</small>') +
      '<input type="file" accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff" data-file><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="pl-btn sec mini" type="button" data-elegir>' + (f ? 'CAMBIAR' : 'ADJUNTAR IMAGEN') + '</button>' + (f ? '<button class="pl-btn sec mini" type="button" data-quitar>QUITAR</button>' : '') + '</div></div>';
  }
  function pantallaMockups() {
    const gs = grupos(), varias = gs.length > 1;
    const bloques = (L.compartir ? [['*', 'Todas las referencias']] : gs.map(g => [g.referencia, g.referencia + ' · ' + g.descripcion])).map(([ref, titulo]) =>
      '<div class="pl-tarjeta"><h3>' + esc(titulo) + '</h3><div class="pl-slots">' + Array.from({ length: L.disenos }, (_, i) => slotHtml(ref, i + 1)).join('') + '</div></div>').join('');
    q('[data-cuerpo]').innerHTML = '<div class="pl-tarjeta"><h3>Datos del pedido · mockups opcionales</h3><div class="pl-grid">' +
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
    const falta = slotsNecesarios().filter(([r, n]) => !imagenDe(r, n)).length, ok = !!L.proyecto.trim();   // los mockups son opcionales: solo hace falta el proyecto
    const b = q('[data-sigue]'); if (b) b.disabled = !ok;
    setMsg(!L.proyecto.trim() ? 'Escribe el nombre del proyecto.' : falta ? 'Mockups opcionales: faltan ' + falta + ' imagen(es). Puedes continuar sin ellas o adjuntarlas ahora.' : 'Mockups completos ✓', ok ? 'ok' : '');
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
    tb.addEventListener('paste', e => {   // pegar desde Excel DIRECTO en la tabla: entra desde la celda donde estás, columna por columna y fila por fila (como en Excel)
      const texto = (e.clipboardData || window.clipboardData).getData('text'); if (!texto || !/[\t\n]/.test(texto.replace(/\r?\n$/, ''))) return;
      e.preventDefault();
      const tr = e.target.closest('tr'), col = COLS.indexOf(e.target.dataset.c); if (!tr || col < 0) return;
      const n = pegarEn(g.referencia, Number(tr.dataset.i), col, texto); guardarBorrador(); pantallaListado(); setMsg(n + ' fila(s) pegadas.', 'ok');
    });
    tb.addEventListener('click', e => { const b = e.target.closest('[data-quitar-fila]'); if (!b) return; filas.splice(Number(b.closest('tr').dataset.i), 1); guardarBorrador(); pantallaListado(); });
    q('[data-programar]').onclick = enviar;
  }
  function enfocarUltima() { const t = q('[data-filas]'); const u = t && t.querySelector('tr:last-child [data-c="nombre"]'); if (u) u.focus(); }
  const COLS = ['nombre', 'talla', 'numero', 'diseno', 'genero', 'observacion'];   // mismo orden que la plantilla: NOMBRE · TALLA · NÚMERO · DISEÑO · GÉNERO · OBSERVACIÓN
  function valorCol(c, v) {
    v = String(v == null ? '' : v).trim();
    if (c === 'talla') { const t = v.toUpperCase(); return (L.cat.tallas || TALLAS).includes(t) ? t : ''; }
    if (c === 'diseno') { const d = v.match(/\d+/); return d && Number(d[0]) >= 1 && Number(d[0]) <= L.disenos ? Number(d[0]) : (L.defDiseno || 1); }
    if (c === 'genero') { const g = v.toUpperCase(); return /^F/.test(g) ? 'FEM' : /^M/.test(g) ? 'MASC' : (L.defGenero || 'MASC'); }
    return c === 'numero' ? v : v.toUpperCase();
  }
  function pegarEn(ref, fila, col, texto) {
    const filas = filasDe(ref); let n = 0;
    String(texto).replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((linea, k) => {
      const celdas = linea.split('\t');
      if (k === 0 && /^nombre$/i.test((celdas[0] || '').trim())) return;   // encabezado copiado
      while (filas.length <= fila + n) filas.push(filaVacia());
      const f = filas[fila + n];
      celdas.forEach((v, j) => { const c = COLS[col + j]; if (c) f[c] = valorCol(c, v); });   // solo lo que pegaste, cada valor en su columna
      n++;
    });
    return n;
  }
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
    L.enviando = true;
    const listado = {}; grupos().forEach(g => { listado[g.referencia] = filasDe(g.referencia).map(x => ({ nombre: x.nombre, talla: x.talla, numero: x.numero, diseno: Number(x.diseno), genero: x.genero, observacion: x.observacion })); });
    const doc = Object.assign({}, L.doc, { proyecto: L.proyecto.trim(), disenos: L.disenos });
    const fd = new FormData(); fd.append('payload', JSON.stringify({ doc, listado, linea: L.linea, observaciones: L.observaciones }));
    grupos().forEach(g => { for (let n = 1; n <= L.disenos; n++) { const img = imagenDe(L.compartir ? '*' : g.referencia, n); if (img) fd.append('mockup:' + g.referencia + ':' + n, img, img.name); } });
    // al pulsar PROGRAMAR PEDIDO el trabajo empieza YA y se ve en pantalla: el listado de Excel que se está creando y cómo avanza cada paso
    L.xlCargado = false; L.xlVista = null;
    L.pantalla = 'enviado'; L.job = { id: 0, estado: 'ENVIANDO', progreso: 3, detail: 'Creando el listado de Excel con la plantilla de Indoor…', excel: '', insertados: null }; dibujar();
    try {
      const r = await fetch('/api/pedido-effi/programar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo programar el pedido (error ' + r.status + ')');
      L.enviando = false; Object.assign(L.job, { id: j.id, estado: j.estado || 'RECIBIDO', progreso: 8, detail: j.mensaje || '', excel: j.excel || '', excel_nombre: j.excel_nombre || '', agente: j.agente_trabajo || '', agenteEstado: j.agente_trabajo ? 'pendiente' : '', agenteDetalle: '', insertados: j.mockups_insertados == null ? null : j.mockups_insertados });
      if (raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado(); seguir();
    } catch (e) {
      L.enviando = false; L.pantalla = 'listado'; if (raiz.isConnected) { dibujar(); setMsg(String(e.message || e), 'error'); }
    }
  }
  const PASOS_ENVIO = [[3, 'Creando el listado de Excel con la plantilla de Indoor'], [8, 'Validando el pedido (PDF y Excel)'], [36, 'Creando la carpeta del pedido en la NAS'], [58, 'Insertando los mockups en el Excel'], [80, 'Registrando las referencias en Producción'], [100, 'Pedido programado']];
  function urlImagen(ref, n) { const f = imagenDe(ref, n); if (!f) return ''; L.urls = L.urls || new Map(); if (!L.urls.has(f)) L.urls.set(f, URL.createObjectURL(f)); return L.urls.get(f); }
  function vistaListado() {   // lo que se está escribiendo en el Excel: una hoja por referencia, con sus mockups
    return grupos().map(g => {
      const filas = filasDe(g.referencia), fotos = [];
      for (let n = 1; n <= L.disenos; n++) { const u = urlImagen(L.compartir ? '*' : g.referencia, n); if (u) fotos.push('<figure><img alt="" src="' + u + '"><figcaption>D' + n + '</figcaption></figure>'); }
      return '<div class="pl-tarjeta pl-xl"><h3>Hoja ' + esc(g.referencia) + ' · ' + filas.length + ' prendas</h3>' + (fotos.length ? '<div class="pl-fotos">' + fotos.join('') + '</div>' : '<small style="color:#a9b5a3">Sin mockups adjuntos.</small>') +
        '<div class="pl-tabla-caja"><table class="pl-xl-t"><thead><tr><th>#</th><th>NOMBRE</th><th>TALLA</th><th>Nº</th><th>DISEÑO</th><th>GÉNERO</th><th>OBSERVACIÓN</th></tr></thead><tbody>' +
        filas.map((x, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(x.nombre) + '</td><td>' + esc(x.talla) + '</td><td>' + esc(x.numero) + '</td><td>D' + esc(x.diseno) + '</td><td>' + esc(x.genero) + '</td><td>' + esc(x.observacion) + '</td></tr>').join('') + '</tbody></table></div></div>';
    }).join('');
  }
  // ---- La hoja de Excel en pantalla: se dibuja la MISMA plantilla que se guardó y se ve cómo se escribe, fila por fila, y cómo entran los mockups
  const letra = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  function htmlHoja(h) {
    const X = [0], Y = [0], CH = 22, RH = 24;   // CH: alto de la fila de letras · RH: ancho de la columna de números
    h.anchos.forEach(w => X.push(X[X.length - 1] + Math.round(w * 7 + 5)));
    h.altos.forEach(a => Y.push(Y[Y.length - 1] + Math.round(a * 4 / 3)));
    const W = X[X.length - 1], H = Y[Y.length - 1], tapada = new Set(), span = {};
    h.combinadas.forEach(([r1, c1, r2, c2]) => { span[r1 + ':' + c1] = [r2, c2]; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) tapada.add(r + ':' + c); });
    let out = '<div class="xl-hoja" style="width:' + (W + RH) + 'px;height:' + (H + CH) + 'px">';
    for (let c = 1; c <= h.cols; c++) out += '<div class="xl-col" style="left:' + (RH + X[c - 1]) + 'px;width:' + (X[c] - X[c - 1]) + 'px">' + letra(c) + '</div>';
    for (let r = 1; r <= h.filas; r++) out += '<div class="xl-fil" data-fila="' + r + '" style="top:' + (CH + Y[r - 1]) + 'px;height:' + (Y[r] - Y[r - 1]) + 'px">' + r + '</div>';
    out += '<div class="xl-red" style="left:' + RH + 'px;top:' + CH + 'px;width:' + W + 'px;height:' + H + 'px;background-size:auto"></div>';
    h.celdas.forEach(c => {
      if (tapada.has(c.r + ':' + c.c) || c.c > h.cols || c.r > h.filas) return;
      const sp = span[c.r + ':' + c.c] || [c.r, c.c], x = X[c.c - 1], y = Y[c.r - 1], w = X[sp[1]] - x, hh = Y[sp[0]] - y;
      out += '<div class="xl-c" data-r="' + c.r + '" style="left:' + (RH + x) + 'px;top:' + (CH + y) + 'px;width:' + w + 'px;height:' + hh + 'px;' + (c.f ? 'background:' + c.f + ';' : '') + (c.k ? 'color:' + c.k + ';' : '') + (c.b ? 'font-weight:700;' : '') + 'font-size:' + Math.max(8, Math.min(16, c.z)) + 'px;justify-content:' + (c.h === 'center' ? 'center' : c.h === 'right' ? 'flex-end' : 'flex-start') + '">' + esc(c.t) + '</div>';
    });
    h.imagenes.forEach((im, k) => {
      const x = X[im.c1 - 1] + im.dx, y = Y[im.r1 - 1] + im.dy;
      const w = im.c2 ? X[Math.min(im.c2, h.cols)] - x : (im.w || 200), hh = im.r2 ? Y[Math.min(im.r2, h.filas)] - y : (im.h || 200);
      out += '<img class="xl-img" data-img="' + k + '" alt="" src="' + im.src + '" style="left:' + (RH + x) + 'px;top:' + (CH + y) + 'px;width:' + w + 'px;height:' + hh + 'px">';
    });
    return out + '<div class="xl-sel" hidden></div></div>';
  }
  async function animarHoja(caja, h, aviso) {   // primero el encabezado, luego cada fila del listado, al final los mockups
    const pausa = ms => new Promise(r => setTimeout(r, ms)), sel = caja.querySelector('.xl-sel');
    const fila = r => caja.querySelectorAll('.xl-c[data-r="' + r + '"]');
    for (let r = 1; r < h.primera_dato; r++) fila(r).forEach(e => e.classList.add('on'));
    aviso('Copiando la plantilla de Indoor y llenando el encabezado (cliente, proyecto, comercial, fecha y línea)…'); await pausa(500);
    for (let r = h.primera_dato; r <= h.ultima_dato; r++) {
      if (!caja.isConnected) return;
      const celdas = fila(r), num = caja.querySelector('.xl-fil[data-fila="' + r + '"]');
      if (celdas.length && sel) { const a = celdas[0]; sel.hidden = false; sel.style.cssText = 'left:' + a.style.left + ';top:' + a.style.top + ';height:' + a.style.height + ';width:' + Math.max(...[...celdas].map(e => parseFloat(e.style.left) + parseFloat(e.style.width))) + 'px'; sel.style.width = (Math.max(...[...celdas].map(e => parseFloat(e.style.left) + parseFloat(e.style.width))) - parseFloat(a.style.left)) + 'px'; }
      celdas.forEach(e => e.classList.add('on')); if (num) num.classList.add('on');
      aviso('Escribiendo la fila ' + (r - h.primera_dato + 1) + ' de ' + (h.ultima_dato - h.primera_dato + 1) + '…');
      await pausa(Math.max(60, Math.min(260, 3000 / Math.max(1, h.ultima_dato - h.primera_dato + 1))));
    }
    if (sel) sel.hidden = true;
    caja.querySelectorAll('.xl-c').forEach(e => e.classList.add('on'));
    const imgs = [...caja.querySelectorAll('.xl-img')];
    for (let k = 0; k < imgs.length; k++) { aviso('Insertando el mockup ' + (k + 1) + ' de ' + imgs.length + ' en su diseño…'); try { imgs[k].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch (e) { /* sin desplazar */ } await pausa(350); imgs[k].classList.add('on'); await pausa(900); }
    aviso('Listado listo en la plantilla de Indoor ✓');
  }
  async function cargarHoja() {
    const caja = raiz.querySelector('[data-xl]'); if (!caja || !L.job.excel || L.xlCargado) return;
    L.xlCargado = true;
    try { const d = document.createElement('iframe'); d.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px'; d.src = L.job.excel; document.body.appendChild(d); setTimeout(() => d.remove(), 60000); } catch (e) { /* queda el botón DESCARGAR */ }   // se baja solo: con «Abrir siempre archivos de este tipo» se abre en Excel de una vez
    const codigo = L.job.excel.split('/').pop();
    try {
      const r = await fetch('/api/pedido-effi/excel-vista/' + encodeURIComponent(codigo), { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('Error ' + r.status);
      const v = await r.json(); L.xlVista = v;
      mostrarHoja(0, true);
    } catch (e) { caja.innerHTML = '<div class="pl-pdf-estado"><b>No pude mostrar la hoja</b><small>' + esc(String(e.message || e)) + '. El Excel igual quedó creado: usa DESCARGAR.</small></div>'; }
  }
  function mostrarHoja(n, animar) {
    const caja = raiz.querySelector('[data-xl]'), v = L.xlVista; if (!caja || !v) return;
    const h = v.hojas[n];
    caja.innerHTML = '<div class="xl-titulo"><span class="xl-ico">X</span><b>' + esc(v.nombre) + '</b><small data-xl-aviso></small></div><div class="xl-scroll">' + htmlHoja(h) + '</div>' +
      '<div class="xl-tabs">' + v.hojas.map((x, k) => '<button type="button" class="' + (k === n ? 'on' : '') + '" data-xl-hoja="' + k + '">' + esc(x.nombre) + '</button>').join('') + '</div>';
    caja.querySelectorAll('[data-xl-hoja]').forEach(b => b.onclick = () => mostrarHoja(Number(b.dataset.xlHoja), false));
    const aviso = t => { const e = caja.querySelector('[data-xl-aviso]'); if (e) e.textContent = t; };
    if (animar) animarHoja(caja, h, aviso); else { caja.querySelectorAll('.xl-c,.xl-img,.xl-fil').forEach(e => e.classList.add('on')); aviso(''); }
  }
  function pantallaEnviado() {
    const j = L.job || {}, fin = ['COMPLETADO', 'ERROR', 'REVISAR'].includes(j.estado), ok = j.estado === 'COMPLETADO', pr = ok ? 100 : Math.max(3, Number(j.progreso) || 3);
    const pasos = PASOS_ENVIO.map(([umbral, texto], k) => { const hecho = ok || pr > umbral || (k === 0 && pr >= 8), activo = !fin && !hecho && (k === 0 || pr >= PASOS_ENVIO[k - 1][0]); return '<li class="' + (hecho ? 'hecho' : activo ? 'activo' : '') + '"><span>' + (hecho ? '✓' : activo ? '…' : '·') + '</span>' + esc(texto) + '</li>'; }).join('');
    const titulo = ok ? 'PEDIDO PROGRAMADO' : fin ? 'NO SE PUDO TERMINAR' : 'PROGRAMANDO EL PEDIDO…';
    const estado = '<span style="font:800 12px Arial;letter-spacing:.14em;color:' + (fin && !ok ? '#ff9b9b' : '#d0f44c') + '">' + titulo + '</span><strong>' + esc((L.doc.tipo === 'remision' ? 'RM' : 'CO') + L.doc.numero) + '</strong>' +
      '<div class="pl-progreso"><i style="width:' + pr + '%"></i></div><div style="font:800 12px Arial;color:#c9d3c1">' + pr + ' %</div><ul class="pl-pasos2">' + pasos + '</ul>' +
      (j.detail ? '<div class="caja ' + (ok ? 'ok' : fin ? 'error' : '') + '">' + esc(j.detail) + '</div>' : '') +
            (j.excel ? '<div style="margin-top:12px"><a class="pl-btn" href="' + esc(j.excel) + '">⬇ DESCARGAR EL EXCEL' + (j.insertados != null ? ' (' + j.insertados + ' mockup(s) insertado(s))' : '') + '</a></div>' : '');
    // el Excel NO se dibuja en el panel: lo abre y lo llena el AGENTE EXCEL en el computador, con el programa Excel
    const st = j.agenteEstado, pc = !j.excel && !j.agente && !fin ? ['⏳', 'Preparando el listado…', 'Al terminar, Excel se abrirá en tu computador y se llenará solo.']
      : j.agente ? (st === 'listo' ? ['✅', 'Excel listo en tu computador', j.agenteDetalle || ''] : st === 'error' ? ['⚠️', 'Tu agente no pudo llenar Excel', j.agenteDetalle || ''] : ['💻', st === 'llenando' ? 'Excel se está llenando en tu computador' : 'Abriendo Excel en tu computador…', j.agenteDetalle || 'Mira la ventana de Excel: se llena sola, celda por celda.'])
      : fin ? ['💡', 'Tu agente Excel no está conectado', 'Abre el AGENTE EXCEL en este computador (botón en PROGRAMAR CLUB) para que Excel se abra y se llene solo. Mientras, puedes descargar el archivo.'] : ['⏳', 'Programando…', ''];
    const pcHtml = '<div class="pl-pdf-estado">' + (st === 'listo' || st === 'error' || (fin && !j.agente) ? '' : '<div class="pl-spin"></div>') + '<div style="font-size:42px">' + pc[0] + '</div><b>' + esc(pc[1]) + '</b><small>' + esc(pc[2]) + '</small></div>';
    const yaEsta = raiz.querySelector('[data-env-estado]');
    if (yaEsta) { yaEsta.innerHTML = estado; const x = raiz.querySelector('[data-xl]'); if (x) x.innerHTML = pcHtml; }   // solo se actualiza el avance: la hoja de Excel que se está dibujando no se toca
    else {
      q('[data-cuerpo]').innerHTML = '<div class="pl-env"><div class="pl-listo pl-env-estado" data-env-estado>' + estado + '</div><div class="pl-xl" data-xl>' + pcHtml + '</div></div>';
      acciones('<button class="pl-btn sec" type="button" data-volver hidden>◀ VOLVER AL LISTADO</button><button class="pl-btn sec" type="button" data-otro>CREAR OTRO DOCUMENTO</button><button class="pl-btn" type="button" data-cerrar>CERRAR</button>', '', '');
      q('[data-volver]').onclick = () => { L.pantalla = 'listado'; dibujar(); };
      q('[data-otro]').onclick = () => L.opts.onOtro && L.opts.onOtro();
      q('[data-cerrar]').onclick = () => L.opts.onCerrar && L.opts.onCerrar();
    }
    const v = q('[data-volver]'); if (v) v.hidden = !(fin && !ok);
  }
  async function seguir() {
    let fin = false;
    for (let k = 0; k < 150 && raiz && raiz.isConnected && L.pantalla === 'enviado'; k++) {
      await new Promise(r => setTimeout(r, 1200));
      try {
        const r = await fetch('/api/procesos', { credentials: 'same-origin' }); const lista = await r.json();
        if (L.job.agente && !['listo', 'error'].includes(L.job.agenteEstado)) {
          try { const a = await fetch('/api/agente-excel/trabajo/' + L.job.agente, { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()); if (a.estado && (a.estado !== L.job.agenteEstado || a.detalle !== L.job.agenteDetalle)) { L.job.agenteEstado = a.estado; L.job.agenteDetalle = a.detalle; if (raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado(); } } catch (e) { /* se reintenta */ }
        }
        if (fin) { if (!L.job.agente || ['listo', 'error'].includes(L.job.agenteEstado)) return; continue; }
        const m = (lista || []).find(x => x.id === L.job.id); if (!m) continue;
        const cambio = m.status !== L.job.estado || m.detail !== L.job.detail || Number(m.progress) !== L.job.progreso;
        L.job.estado = m.status; L.job.detail = m.detail || ''; L.job.progreso = Number(m.progress) || L.job.progreso;
        if (cambio && raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado();
        if (['COMPLETADO', 'ERROR', 'REVISAR'].includes(m.status)) { if (m.status === 'COMPLETADO') { try { localStorage.removeItem(claveBorrador()); } catch (e) { /* nada */ } } fin = true; }
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
    const pr = (opts && opts.preset) || null;
    if (pr) {   // viene de EMPEZAR PEDIDO con la línea, el proyecto y los mockups ya elegidos: directo al LISTADO (sin pasos de más)
      if (pr.linea) L.linea = pr.linea;
      if (pr.proyecto) L.proyecto = pr.proyecto;
      const m = pr.mockups || {}, refs = Object.keys(m);
      if (refs.length) { L.compartir = false; L.disenos = Math.min(MAX_DISENOS, Math.max(L.disenos || 1, ...refs.map(r => m[r].length))); }
      L.pantalla = 'listado'; L.abierta = grupos()[0].referencia;
      refs.forEach(ref => m[ref].forEach(async (url, i) => {
        try {
          const b = await fetch(url, { credentials: 'same-origin' }).then(x => { if (!x.ok) throw new Error(); return x.blob(); });
          const ext = (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          (L.imgs[ref] = L.imgs[ref] || {})[i + 1] = new File([b], ref + '_D' + (i + 1) + '.' + ext, { type: b.type || 'image/png' });
          if (raiz && raiz.isConnected && L.pantalla === 'mockups') dibujar();
        } catch (e) { /* ese mockup se puede subir a mano en MOCKUPS */ }
      }));
    }
    dibujar();
  }
  // para las pestañas CO/RM y LISTADO de la ventana: en qué pantalla está el listado (null = aún no hay documento creado) y saltar a otra
  const activo = () => (L.doc && raiz && raiz.isConnected && raiz.querySelector('.pl, [data-cuerpo]')) ? L.pantalla : null;
  function ir(p) { if (!activo() || L.pantalla === 'enviado' || L.enviando) return false; L.pantalla = p; if (p === 'listado') L.abierta = L.abierta || grupos()[0].referencia; dibujar(); return true; }
  window.PedidoListado = { abrir, activo, ir };
})();
