(() => {
  // PEDIDO EN EFFI: formulario con la estructura de «Crear cotización» de Effi. Al confirmar crea la COTIZACIÓN o la REMISIÓN DE VENTA en Effi. Lo abre EMPEZAR PEDIDO (PROGRAMAR CLUB).
  if (window.__pedidoEffiListo) return;
  window.__pedidoEffiListo = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const nuevaClave = () => 'pedido-' + [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');

  const css = document.createElement('style');
  css.textContent = `
  .pe{width:100%;max-width:none;margin:8px 0;display:grid;gap:14px}
  .pe-card{padding:20px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28));backdrop-filter:blur(14px)}
  .pe-top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
  .pe h2{margin:0;font:900 clamp(20px,3vw,26px) Arial;color:#f5faef}
  .pe h3{margin:0 0 12px;font:900 15px Arial;color:#f5faef;letter-spacing:.04em;display:flex;align-items:center;gap:8px}
  .pe h3::before{content:"";width:4px;height:16px;border-radius:2px;background:#d0f44c}
  .pe .eyebrow{color:#d0f44c;font:800 11px Arial;letter-spacing:.16em}
  .pe-tipo{display:inline-flex;border:1px solid #3d4c3b;border-radius:99px;overflow:hidden}
  .pe-tipo button{all:unset;cursor:pointer;padding:9px 18px;color:#c9d3c1;font:900 12px Arial;letter-spacing:.08em}
  .pe-tipo button.on{background:#d0f44c;color:#142017}
  .pe-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr))}
  .pe label{display:grid;gap:5px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.08em;position:relative}
  .pe input,.pe select,.pe textarea{width:100%;box-sizing:border-box;border:1px solid #3d4c3b;border-radius:10px;background:#142017;color:#f5faef;font:600 15px Arial;outline:none}
  .pe input,.pe select{min-height:42px;padding:0 11px}
  .pe textarea{min-height:76px;padding:10px 12px;resize:vertical}
  .pe input:focus,.pe select:focus,.pe textarea:focus{border-color:#d0f44c}
  .pe input[disabled]{opacity:.6}
  .pe{position:relative}
  .pe-sug{position:absolute;left:0;top:0;z-index:60;width:max-content;min-width:min(480px,calc(100% - 12px));max-width:calc(100% - 12px);overflow:auto;box-sizing:border-box;border:1px solid #5a6e55;border-radius:12px;background:#0b140d!important;box-shadow:0 18px 44px rgba(0,0,0,.75);-webkit-backdrop-filter:none!important;backdrop-filter:none!important;scrollbar-width:thin;scrollbar-color:#3d4c3b transparent}
  .pe-sug button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:28px;width:100%;padding:9px 14px;cursor:pointer;color:#f5faef;font:700 14px Arial;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,.06)}
  .pe-sug button:last-child{border-bottom:0}
  .pe-sug button.on,.pe-sug button:hover{background:#1d3321}
  .pe-sug .d{flex:none;color:#8f9d88;font:600 12px Arial}
  .pe-sug mark{background:rgba(208,244,76,.3);color:#fff;border-radius:3px;padding:0 1px}
  .pe-sug-nota{padding:10px 14px;color:#a9b5a3;font:600 13px Arial;white-space:nowrap}
  .pe-linea{display:grid;gap:8px;grid-template-columns:1.3fr 1.8fr .6fr 1fr 1fr 1.1fr .8fr .9fr auto;align-items:end;padding:10px 0;border-top:1px solid rgba(255,255,255,.1)}
  .pe-dto{display:flex;gap:6px;align-items:center}.pe-dto input{min-width:0}
  .pe-pct{all:unset;cursor:pointer;box-sizing:border-box;min-width:38px;height:42px;display:grid;place-items:center;border:1px solid #3d4c3b;border-radius:10px;background:#142017;color:#d0f44c;font:900 14px Arial}
  .pe-pct:hover{border-color:#d0f44c}
  .pe-tela{grid-column:1/-1;font:700 12px Arial;color:#d0f44c;letter-spacing:.02em}.pe-tela:empty{display:none}.pe-tela small{color:#a9b5a3;font-weight:700}.pe-tela.no{color:#e8b86a}
  .pe-fila2{grid-template-columns:minmax(260px,2fr) minmax(220px,1.4fr) minmax(220px,1.6fr)!important;margin-top:0!important}
  @media(max-width:999px){.pe-fila2{grid-template-columns:1fr!important}}
  .pe-mas{grid-column:1/-1}.pe-link{all:unset;cursor:pointer;color:#a9b5a3;font:800 12px Arial;letter-spacing:.06em}.pe-link:hover{color:#d0f44c}
  .pe-detalles{display:grid;gap:10px;grid-template-columns:minmax(180px,1fr) 2fr;margin-top:8px;padding:10px;border:1px dashed rgba(255,255,255,.18);border-radius:10px}
  .pe-chk{display:flex;align-items:center;gap:8px;grid-auto-flow:column;justify-content:start;font:700 13px Arial;letter-spacing:0}.pe-chk input{width:auto;min-height:0}
  .pe-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.pe-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;background:rgba(255,255,255,.09);color:#e8f0e0;font:700 12px Arial}
  .pe-chip button{all:unset;cursor:pointer;color:#ff9b9b;font-weight:900}
  .pe-propina{align-items:center}.pe-propina .pe-dto{width:60%}
  .pe-sub{display:grid;gap:10px;grid-template-columns:1fr 1fr}
  .pe-h3row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.pe-h3row h3{margin:0}
  .pe-cap{display:grid;gap:8px;margin-bottom:12px;padding:12px;border:1px solid rgba(208,244,76,.45);border-radius:12px;background:rgba(208,244,76,.06)}
  .pe-cap textarea{min-height:90px;font:600 14px Consolas,monospace}.pe-cap p{margin:0;color:#a9b5a3;font:500 12px/1.5 Arial}.pe-cap .fila{display:flex;gap:8px;flex-wrap:wrap}
  .pe-linea:first-of-type{border-top:0}
  .pe-total-linea{font:900 15px Arial;color:#d0f44c;min-height:42px;display:flex;align-items:center}
  .pe-x{all:unset;cursor:pointer;color:#ff9b9b;font:900 18px Arial;padding:8px}
  .pe-btn{min-height:46px;padding:0 20px;border:0;border-radius:12px;background:#d0f44c;color:#142017;font:900 13px Arial;letter-spacing:.06em;cursor:pointer}
  .pe-btn.sec{background:rgba(255,255,255,.1);color:#f5faef}
  .pe-btn.mini{min-height:36px;padding:0 14px;font-size:12px}
  .pe-btn:disabled{opacity:.5;cursor:not-allowed}
  .pe-dos{display:grid;gap:16px;grid-template-columns:1.2fr 1fr}
  .pe-tot{display:grid;gap:7px;align-content:start}
  .pe-tot div{display:flex;justify-content:space-between;gap:12px;color:#c9d3c1;font:700 15px Arial}
  .pe-tot .neto{padding-top:8px;border-top:1px solid rgba(255,255,255,.2);color:#f5faef;font:900 22px Arial}
  .pe-forma{display:grid;gap:8px;grid-template-columns:2fr 1.2fr auto;align-items:end;margin-bottom:8px}
  .pe-acciones{position:sticky;bottom:10px;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px;border-radius:16px;background:#0b0f09;border:1px solid rgba(255,255,255,.14)}
  .pe-msg{flex:1 1 240px;font:700 13px/1.4 Arial;color:#a9b5a3}
  .pe-msg.error{color:#ff9b9b}.pe-msg.ok{color:#bff26a}
  .pe-aviso{padding:12px 14px;border-radius:12px;border:1px solid rgba(255,180,61,.6);background:rgba(255,180,61,.1);color:#ffc46b;font:700 13px/1.45 Arial;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .pe-aviso.on{border-color:rgba(191,242,106,.5);background:rgba(191,242,106,.08);color:#bff26a}
  .pe-listo{padding:26px;text-align:center}
  .pe-listo strong{display:block;margin:6px 0 4px;font:900 28px Arial;color:#d0f44c}
  .pe-prev{margin-top:12px;padding:12px;border:1px dashed rgba(208,244,76,.5);border-radius:12px;color:#e8f0e0;font:600 13px/1.5 Arial}
  /* Pantalla ancha: TODO en una sola vista (sin bajar). Arriba el encabezado, en el centro los conceptos (solo esa lista se desplaza si son muchos) y abajo, lado a lado, detalles + totales y formas de pago. */
  .pe-izq{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .pe-abajo{display:grid;gap:14px}
  @media(min-width:1000px){
    .pe-av{grid-area:av}.pe-enc{grid-area:enc}.pe-con{grid-area:con}.pe-abajo{grid-area:abajo}.pe-acciones{grid-area:acc}
    .tc-pedido-fondo{padding:6px!important}
    .tc-pedido-card{height:calc(100vh - 12px);display:flex!important;flex-direction:column;padding:10px 14px!important}
    .tc-pedido-card [data-pedido-effi]{flex:1;min-height:0}
    .pe{height:100%;margin:0;gap:8px;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(120px,1fr) auto auto;grid-template-areas:"av" "enc" "con" "abajo" "acc"}
    .pe-card{padding:10px 16px;box-sizing:border-box}
    .pe h2{font-size:20px}.pe h3{margin-bottom:8px}
    .pe-aviso{padding:6px 12px}
    .pe-enc .pe-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:8px!important;gap:8px}
    .pe-con{display:block;overflow:auto;min-height:0}   /* si no caben todos los conceptos (o el cuadro de capturar), se desplaza SOLO esta tarjeta; la página no */
    .pe-cap textarea{min-height:56px}
    .pe-linea{padding:6px 0}
    .pe-abajo{gap:8px;grid-template-columns:minmax(0,2.5fr) minmax(0,1fr)}
    .pe-abajo .pe-dos{grid-template-columns:minmax(0,1.8fr) minmax(0,1fr);gap:14px}
    .pe-izq textarea{min-height:46px}
    .pe-izq{gap:8px}
    .pe-enc .eyebrow{display:none}.pe-enc .pe-top{gap:8px}.pe-enc h2{font-size:18px}
    .pe-con{min-height:0}
    .tc-pedido-fondo{overflow:auto!important}   /* último recurso en pantallas muy bajas: la ventana se desplaza, pero los botones siguen existiendo */
    .pe-tot{gap:5px}.pe-tot .neto{font-size:20px}
    .pe-forma{margin-bottom:6px}
    .pe-acciones{position:static;padding:8px 12px}
    .pe-btn{min-height:40px}.pe input,.pe select{min-height:38px}
  }
  @media(min-width:1000px) and (max-height:850px){
    .tc-pedido-card{padding:6px 10px!important}
    .pe{gap:5px}.pe-card{padding:6px 12px}.pe h3{margin-bottom:4px;font-size:13px}.pe h2{font-size:16px}
    .pe-aviso{padding:3px 10px;font-size:12px}.pe-aviso .pe-btn{min-height:26px}
    .pe-enc .pe-grid{margin-top:4px!important;gap:5px}.pe label{gap:2px;font-size:10px}
    .pe input,.pe select{min-height:32px;font-size:14px}.pe-btn{min-height:34px}.pe-pct{height:32px}
    .pe-izq textarea{min-height:30px}.pe-izq{gap:5px}
    .pe-linea{padding:3px 0;gap:6px}.pe-link{font-size:11px}
    .pe-tot{gap:2px}.pe-tot div{font:700 13px Arial}.pe-tot .neto{font-size:17px}
    .pe-acciones{padding:5px 10px}.pe-forma{margin-bottom:4px}
    .pe-con .pe-h3row{margin-bottom:4px}.pe-btn.mini{min-height:28px}
  }
  @media(max-width:900px){
    .pe-sug{width:calc(100% - 12px)}.pe-sug button{white-space:normal;gap:10px}
    .pe-linea{grid-template-columns:1fr 1fr;padding:14px 0}
    .pe-linea .pe-art,.pe-linea .pe-desc{grid-column:1/-1}
    .pe-detalles,.pe-sub{grid-template-columns:1fr}.pe-propina .pe-dto{width:55%}
    .pe-dos{grid-template-columns:1fr}
    .pe-forma{grid-template-columns:1fr 1fr}.pe-forma .pe-x{justify-self:end}
    .pe-card{padding:15px}.pe{margin:10px auto 120px}
    .pe-acciones{position:static;padding:0;border:0;background:none}.pe-btn{width:100%}.pe-msg{padding:0 4px}
  }
  @media(max-width:700px){
    .pe,.pe *{text-align:center}.pe h2{font-size:17px}.pe h3{font-size:14px}.pe label{font-size:10px;letter-spacing:.06em;justify-items:center}
    .pe input,.pe select,.pe textarea{font-size:14px;text-align:center;text-align-last:center}.pe input,.pe select{min-height:38px}
    .pe-btn,.pe-link{font-size:12px;min-height:38px;justify-content:center;text-align:center}.pe-link{display:block;width:100%}
    .pe-top{flex-direction:column;align-items:center;gap:8px}.pe-tipo{justify-self:center}.pe-tela{font-size:11px}
    .pe-tot div{justify-content:space-between}.pe-tot .neto{font-size:15px}.pe-card{padding:12px}.pe-msg{font-size:12px}
    .pe-linea{grid-template-columns:1fr 1fr;gap:8px}.pe-total-linea{font-size:14px}.pe-x{justify-self:center}
  }`;
  document.head.appendChild(css);

  const estadoInicial = () => ({ tipo: 'cotizacion', cat: null, estado: null, cliente: null, direccion: -1, conceptos: [], telas: {}, formas: [], clave: nuevaClave(), previa: false, prev: null, ocupado: false, hecho: null, capturando: false, capTexto: '', capMsg: '', moneda: 'COP', trm: '1', global: '', propina: '', propinaPct: false, retenciones: [], pronto: '', fechaPronto: '' });
  const st = estadoInicial();
  let panel = null;
  const q = s => panel.querySelector(s);
  const nombreDoc = () => (st.tipo === 'cotizacion' ? 'cotización' : 'remisión de venta');

  const api = async (url, opts) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.mensaje || ('Error ' + r.status));
    return j;
  };
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const msg = (t, tipo) => { const m = q('[data-msg]'); if (m) { m.textContent = t || ''; m.className = 'pe-msg ' + (tipo || ''); } };

  const lineaVacia = () => ({ articulo: 0, ref: '', descripcion: '', cantidad: 1, precio: '', descuento: 0, dtipo: 'valor', obsequio: false, obs: '', impuesto: '', abierta: false, id_serie: null });
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const brutoDe = l => num(l.cantidad) * num(l.precio);
  // descuento de un concepto en $: obsequio = 100 %; en % se calcula sobre su bruto; en valor se usa tal cual
  const descDe = l => l.obsequio ? brutoDe(l) : (l.dtipo === 'pct' ? Math.round(brutoDe(l) * num(l.descuento)) / 100 : num(l.descuento));
  const totales = () => { const b = st.conceptos.reduce((s, l) => s + brutoDe(l), 0), d = st.conceptos.reduce((s, l) => s + descDe(l), 0); return { b, d, s: b - d }; };
  const propinaValor = () => (st.propinaPct ? Math.round(totales().s * num(st.propina)) / 100 : num(st.propina));

  function opciones(lista, sel, vacio) {
    return '<option value="">' + esc(vacio || 'Seleccionar…') + '</option>' + lista.map(o => '<option value="' + o.id + '"' + (String(o.id) === String(sel) ? ' selected' : '') + '>' + esc(o.nombre) + '</option>').join('');
  }
  const valor = n => { const e = q('[name="' + n + '"]'); return e ? e.value : ''; };

  function refrescarDirecciones() {   // al volver a escribir el cliente, la dirección del anterior ya no vale
    const dir = q('[name="direccion"]'); if (dir) dir.innerHTML = st.cliente && st.cliente.direcciones.length ? st.cliente.direcciones.map((d, i) => '<option value="' + i + '"' + (i === st.direccion ? ' selected' : '') + '>' + esc((d.ciudad ? d.ciudad + ' · ' : '') + d.direccion) + '</option>').join('') : '<option value="-1">No registra</option>';
  }
  function dibujar() {
    const c = st.cat, hecho = st.hecho;
    if (hecho) {
      panel.innerHTML = '<div class="pe"><div class="pe-card pe-listo"><span class="eyebrow">LISTO EN EFFI</span><strong>' + esc(hecho.tipo.toUpperCase()) + ' ' + esc(hecho.numero) + '</strong><p style="color:#a9b5a3;font:500 14px Arial">Total ' + money(hecho.total) + '. Ya está creada en Effi.</p><button class="pe-btn" type="button" data-otro>CREAR OTRO DOCUMENTO</button></div></div>';
      q('[data-otro]').onclick = nuevoDocumento;
      return;
    }
    const sucDef = c.sucursales.length === 1 ? c.sucursales[0].id : '';
    const guard = ['sucursal', 'bodega', 'centro_costos', 'vendedor', 'fecha_entrega', 'garantia', 'observacion', 'cliente-q'].reduce((o, n) => (o[n] = valor(n), o), {});
    const suc = guard.sucursal || sucDef;
    const bodegas = c.bodegas.filter(b => !suc || String(b.sucursal) === String(suc));
    const t = totales();
    const apagado = st.estado && !st.estado.activo;
    panel.innerHTML = `<div class="pe">
      ${apagado ? '<div class="pe-aviso pe-av"><span>La creación en Effi está frenada desde el servidor: puedes armar el documento y ver la vista previa, pero no se envía. Avisa a administración.</span></div>' : ''}
      <div class="pe-card pe-enc">
        <div class="pe-top"><div><span class="eyebrow">COMERCIALES · EFFI</span><h2>+ Crear ${nombreDoc()}</h2></div>
          <div class="pe-tipo" role="group" aria-label="Tipo de documento"><button type="button" data-tipo="cotizacion" class="${st.tipo === 'cotizacion' ? 'on' : ''}">COTIZACIÓN</button><button type="button" data-tipo="remision" class="${st.tipo === 'remision' ? 'on' : ''}">REMISIÓN</button></div></div>
        <div class="pe-grid" style="margin-top:14px">
          <label>Sucursal*<select name="sucursal">${opciones(c.sucursales, suc)}</select></label>
          <label>Bodega*<select name="bodega">${opciones(bodegas, guard.bodega)}</select></label>
          <label>Centro de costos*<select name="centro_costos">${opciones(c.centros, guard.centro_costos)}</select></label>
          <label>Fecha de entrega*<input type="date" name="fecha_entrega" value="${esc(guard.fecha_entrega || hoy())}"></label>
          <label>Moneda*<select name="moneda">${(c.monedas || [{ id: 'COP', nombre: 'Peso Colombiano $ COP' }]).map(m => '<option value="' + m.id + '"' + (m.id === st.moneda ? ' selected' : '') + '>' + esc(m.nombre) + '</option>').join('')}</select></label>
          <label>TRM*<input name="trm" inputmode="decimal" value="${esc(st.moneda === 'COP' ? '1' : st.trm)}" ${st.moneda === 'COP' ? 'disabled' : ''}></label>
          <label>Vendedor<select name="vendedor">${opciones(c.vendedores, guard.vendedor)}</select></label>
          <label>Descuento global (%)<input name="global" inputmode="decimal" placeholder="0" value="${esc(st.global)}"></label>
        </div>
        <div class="pe-grid pe-fila2">
          <label>Cliente*<input name="cliente-q" autocomplete="off" placeholder="Buscar por nombre (3 letras)…" value="${esc(st.cliente ? st.cliente.nombre : guard['cliente-q'])}"></label>
          <label>Dirección del cliente<select name="direccion">${st.cliente && st.cliente.direcciones.length ? st.cliente.direcciones.map((d, i) => '<option value="' + i + '"' + (i === st.direccion ? ' selected' : '') + '>' + esc((d.ciudad ? d.ciudad + ' · ' : '') + d.direccion) + '</option>').join('') : '<option value="-1">No registra</option>'}</select></label>
          <label class="pe-proy">Proyecto (Garantía)<input name="garantia" maxlength="255" autocomplete="off" placeholder="Ej. TEMPORADA 2027" value="${esc(guard.garantia)}"></label>
        </div>
      </div>
      <div class="pe-card pe-con"><div class="pe-h3row"><h3>Conceptos</h3><button class="pe-btn sec mini" type="button" data-capturar title="Pegar o escanear series, IDs de artículo o códigos GTIN/EPC (tecla F8)">Capturar series (F8)</button></div>
        ${st.capturando ? `<div class="pe-cap"><label>Códigos: series, ID de artículo o GTIN/EPC<textarea data-cap-texto spellcheck="false" placeholder="Escanea o pega los códigos…">${esc(st.capTexto)}</textarea></label><p>Sepáralos con espacio, tab, salto de línea, coma, punto o punto y coma. Cada código agrega un concepto de cantidad 1; el mismo artículo repetido suma cantidad.</p><div class="fila"><button class="pe-btn mini" type="button" data-cap-ok>Agregar conceptos</button><button class="pe-btn sec mini" type="button" data-cap-cancel>Cancelar</button></div><p data-cap-msg class="pe-msg ${/No encontré|repetida/.test(st.capMsg) ? 'error' : ''}">${esc(st.capMsg)}</p></div>` : ''}
        <div data-lineas>${st.conceptos.map((l, i) => `
        <div class="pe-linea" data-i="${i}">
          <label class="pe-art">Artículo*${l.id_serie ? ' · SERIE' : ''}<input data-f="ref" autocomplete="off" placeholder="Buscar referencia o nombre…" value="${esc(l.ref)}"></label>
          <label class="pe-desc">Descripción*<input data-f="descripcion" maxlength="120" value="${esc(l.descripcion)}" placeholder="Se llena al elegir el artículo"></label>
          <label>Cant.*<input data-f="cantidad" inputmode="decimal" value="${esc(l.cantidad)}" ${l.id_serie ? 'disabled' : ''}></label>
          <label>Precio ud.*<input data-f="precio" inputmode="decimal" value="${esc(l.precio)}"></label>
          <label>Bruto<input value="${money(brutoDe(l))}" disabled></label>
          <label>Descuento<div class="pe-dto"><input data-f="descuento" inputmode="decimal" value="${esc(l.obsequio ? '100' : l.descuento)}" ${l.obsequio ? 'disabled' : ''}><button class="pe-pct" type="button" data-dtipo title="Cambiar entre valor ($) y porcentaje (%)">${l.obsequio || l.dtipo === 'pct' ? '%' : '$'}</button></div></label>
          <label>Impuesto<input value="${esc(l.impuesto || '—')}" disabled></label>
          <div><span style="color:#c9d3c1;font:800 11px Arial;letter-spacing:.08em">Total sin IVA</span><div class="pe-total-linea">${money(brutoDe(l) - descDe(l))}</div></div>
          <button class="pe-x" type="button" data-quitar aria-label="Quitar concepto">✕</button>
          <div class="pe-tela" data-tela>${telaHtml(l)}</div><div class="pe-mas"><button type="button" class="pe-link" data-detalles>${l.abierta ? '▾' : '▸'} Más detalles${l.obsequio || l.obs ? ' ●' : ''}</button>${l.abierta ? `<div class="pe-detalles"><label class="pe-chk"><input type="checkbox" data-obsequio ${l.obsequio ? 'checked' : ''}> Sumar solo impuestos para Obsequio, degustación o donación (descuento del 100 %)</label><label>Observación del concepto<input data-f="obs" maxlength="250" value="${esc(l.obs)}" placeholder="Opcional"></label></div>` : ''}</div>
        </div>`).join('')}</div>
        <div style="margin-top:10px"><button class="pe-btn sec mini" type="button" data-mas>+ Agregar concepto</button></div>
      </div>
      <div class="pe-abajo">
      <div class="pe-card"><h3>Detalles de la ${nombreDoc()}</h3><div class="pe-dos">
        <div class="pe-grid pe-izq"><label>Observación<textarea name="observacion" maxlength="800" placeholder="Observación">${esc(guard.observacion)}</textarea></label>
          <div><div style="display:flex;gap:8px;align-items:end"><label style="flex:1;min-width:0">Retenciones<select data-ret-sel>${opciones((c.retenciones || []).filter(r => !st.retenciones.includes(r.id)), '', 'Seleccionar…')}</select></label><button class="pe-btn sec mini" type="button" data-ret-add>+ Agregar</button></div>
            <div class="pe-chips">${st.retenciones.map(id => { const r = (c.retenciones || []).find(x => x.id === id); return '<span class="pe-chip">' + esc(r ? r.nombre : id) + '<button type="button" data-ret-quitar="' + id + '" aria-label="Quitar">✕</button></span>'; }).join('')}</div></div>
          <div class="pe-sub"><label>Descuento pronto pago ($)<input name="pronto" inputmode="decimal" placeholder="0" value="${esc(st.pronto)}"></label><label>Fecha pronto pago<input type="date" name="fecha_pronto" value="${esc(st.fechaPronto)}"></label></div></div>
        <div class="pe-tot"><div><span>TOTAL BRUTO</span><b>${money(t.b)}</b></div><div><span>− Descuentos</span><b>${money(t.d)}</b></div><div><span>SUBTOTAL</span><b>${money(t.s)}</b></div>
          <div class="pe-propina"><span>+ Propina</span><span class="pe-dto"><input name="propina" inputmode="decimal" placeholder="0" value="${esc(st.propina)}"><button class="pe-pct" type="button" data-propina-tipo title="Cambiar entre valor ($) y porcentaje (%)">${st.propinaPct ? '%' : '$'}</button></span></div>
          <div><span>+ Impuestos</span><b data-imp>${st.prev ? money(st.prev.impuestos) : '—'}</b></div><div><span>− Retenciones</span><b data-ret>${st.prev ? money(st.prev.retenciones) : '—'}</b></div>
          <div class="neto"><span>TOTAL NETO</span><b data-neto>${st.prev ? money(st.prev.total) : '—'}</b></div></div></div>
        <div data-previa class="pe-prev" ${st.prev ? '' : 'hidden'}>${st.prev ? 'Vista previa lista. Las formas de pago deben sumar el total neto: ' + money(st.prev.total) + '. Revisa y pulsa CREAR.' : ''}</div>
      </div>
      <div class="pe-card"><h3>Formas de pago</h3><div data-formas>${st.formas.map((f, i) => `
        <div class="pe-forma" data-j="${i}"><label>Forma de pago*<select data-g="id">${opciones(c.formas_pago.filter(x => st.tipo === 'cotizacion' || x.credito), f.id, 'Seleccionar…')}</select></label><label>Valor${st.formas.length > 1 ? '' : ' (vacío = total)'}<input data-g="valor" inputmode="decimal" value="${esc(f.valor)}"></label>${st.formas.length > 1 ? '<button class="pe-x" type="button" data-quitar-forma aria-label="Quitar">✕</button>' : '<span></span>'}</div>`).join('')}</div>
        <button class="pe-btn sec mini" type="button" data-mas-forma>+ Agregar forma de pago</button>
        ${st.tipo === 'remision' ? '<p style="margin:10px 0 0;color:#a9b5a3;font:500 12px/1.5 Arial">En remisión solo van formas a crédito o «Contado a 1 día»; el cobro en caja se registra en Effi.</p>' : ''}
      </div>
      </div>
      <div class="pe-acciones"><button class="pe-btn sec" type="button" data-previa-btn>VISTA PREVIA</button><button class="pe-btn" type="button" data-crear ${st.prev && !apagado ? '' : 'disabled'}>CREAR ${nombreDoc().toUpperCase()} EN EFFI</button><div class="pe-msg" data-msg>${apagado ? 'Creación frenada desde el servidor.' : (st.prev ? '' : 'Primero revisa la vista previa.')}</div></div>
      <div class="pe-sug" data-sug-global hidden></div>
    </div>`;
    enlazar();
  }

  function leerFormulario() {
    const d = st.cliente && st.direccion >= 0 ? st.cliente.direcciones[st.direccion] : null;
    return {
      tipo: st.tipo, clave: st.clave, sucursal: valor('sucursal'), bodega: valor('bodega'), centro_costos: valor('centro_costos'), fecha_entrega: valor('fecha_entrega'),
      cliente: st.cliente ? st.cliente.tercero : '', direccion: d || undefined, vendedor: valor('vendedor') || undefined, garantia: valor('garantia'), observacion: valor('observacion'),
      divisa: st.moneda, trm: st.trm, descuento_global: st.global || 0, propina: propinaValor() || 0, retenciones: st.retenciones, prontopago: st.pronto || 0, fecha_prontopago: st.fechaPronto,
      conceptos: st.conceptos.map(l => ({ articulo: l.articulo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, descuento: descDe(l), obsequio: l.obsequio, observacion: l.obs, id_serie: l.id_serie || undefined })),
      formas_pago: st.formas.map(f => ({ id: f.id, valor: f.valor })),
    };
  }
  function invalidar() { if (st.prev) { st.prev = null; const b = q('[data-crear]'); if (b) b.disabled = true; const p = q('[data-previa]'); if (p) p.hidden = true; const i = q('[data-imp]'), n = q('[data-neto]'), r = q('[data-ret]'); if (i) i.textContent = '—'; if (n) n.textContent = '—'; if (r) r.textContent = '—'; msg('Cambiaste algo: vuelve a pulsar VISTA PREVIA.', ''); } }
  function defectoForma() { const f = st.cat.formas_pago.find(x => x.defecto) || st.cat.formas_pago[0]; return { id: f ? f.id : '', valor: '' }; }

  const cerrarVentana = () => { const f = document.querySelector('.tc-pedido-fondo'); if (f) f.remove(); };
  function nuevoDocumento() { st.hecho = null; st.cliente = null; st.conceptos = [lineaVacia()]; st.formas = [defectoForma()]; st.clave = nuevaClave(); st.previa = false; st.prev = null; dibujar(); }
  // Lo que el listado necesita de la cotización recién creada (la réplica en pantalla y el PDF para el programar pedido)
  function construirDoc(r, body) {
    const prev = st.prev || {}, ls = prev.lineas || [];
    const suc = (st.cat.sucursales || []).find(x => String(x.id) === String(body.sucursal)) || {};
    const ven = (st.cat.vendedores || []).find(x => String(x.id) === String(body.vendedor));
    const dir = body.direccion;
    const formas = (body.formas_pago || []).map((f, i) => { const x = (st.cat.formas_pago || []).find(y => y.id === Number(f.id)); const v = (prev.formas || [])[i]; return { nombre: x ? x.nombre : '', valor: v ? v.valor : num(f.valor) }; });
    const total = r.total != null && isFinite(Number(r.total)) ? Number(r.total) : prev.total;
    return {
      tipo: st.tipo, prefijo: (String(r.numero || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase(), numero: String(r.id), numero_completo: r.numero || String(r.id),
      fecha_creacion: hoy(), fecha_entrega: body.fecha_entrega, garantia: body.garantia || '', proyecto: String(body.garantia || '').trim(), observacion: body.observacion || '',
      cliente: { nombre: st.cliente ? st.cliente.nombre : '', documento: st.cliente ? st.cliente.documento : '', direccion: dir ? [dir.ciudad, dir.direccion].filter(Boolean).join(' · ') : '' },
      vendedor: ven ? ven.nombre : '', sucursal: suc,
      conceptos: st.conceptos.map((l, i) => ({ referencia: l.ref, descripcion: l.descripcion, cantidad: num(l.cantidad), precio: num(l.precio), descuento: ls[i] ? ls[i].descuento : descDe(l), impuestos: ls[i] ? ls[i].impuestos : '', impuesto: ls[i] ? ls[i].impuesto : 0, total: ls[i] ? ls[i].total : null, observacion: l.obs || '' })),
      totales: { bruto: prev.bruto, descuento: prev.descuento, subtotal: prev.subtotal, propina: prev.propina, impuestos: prev.impuestos, retenciones: prev.retenciones, total },
      formas, subtotal: prev.subtotal, total,
    };
  }

  async function previa(crear) {
    if (st.ocupado) return;
    st.ocupado = true; msg(crear ? 'Creando en Effi…' : 'Calculando con Effi…', '');
    try {
      const body = leerFormulario();
      if (!crear) {
        const r = await post('/api/pedido-effi/vista-previa', body);
        st.prev = r.resumen; st.ocupado = false; dibujarConservando(); msg('Vista previa lista: revisa los totales y pulsa CREAR.', 'ok');
      } else {
        if (!confirm('Se va a crear en Effi una ' + nombreDoc() + ' por ' + money(st.prev.total) + '. ¿Confirmas?')) { st.ocupado = false; msg('', ''); return; }
        const r = await post('/api/pedido-effi/crear', body);
        const doc = construirDoc(r, body);   // se arma ANTES de redibujar: usa lo que hay en pantalla
        st.hecho = r; st.ocupado = false;
        if (window.PedidoListado) window.PedidoListado.abrir(panel, doc, { cat: (st.cat && st.cat.listado) || {}, onOtro: nuevoDocumento, onCerrar: cerrarVentana });   // réplica de la cotización + «Continuar con el listado»
        else dibujar();
      }
    } catch (e) { st.ocupado = false; msg(String(e.message || e), 'error'); }
  }
  // Capturar series (F8): cada código (serie, ID de artículo, GTIN/EPC) agrega un concepto de cantidad 1
  async function capturar() {
    const m = t => { const e = q('[data-cap-msg]'); if (e) e.textContent = t; };
    if (st.ocupado) return;
    if (!st.capTexto.trim()) { m('Pega o escanea al menos un código.'); return; }
    st.ocupado = true; m('Buscando en Effi…');
    try {
      const r = await post('/api/pedido-effi/capturar', { codigos: st.capTexto });
      st.ocupado = false;
      if (st.conceptos.length === 1 && !st.conceptos[0].articulo && !st.conceptos[0].ref) st.conceptos = [];
      r.conceptos.forEach(c => st.conceptos.push(Object.assign(lineaVacia(), { articulo: c.id, ref: c.referencia, descripcion: String(c.descripcion || '').slice(0, 120), cantidad: c.cantidad, precio: c.precio || '', impuesto: c.impuesto || '', id_serie: c.id_serie || null })));
      if (!st.conceptos.length) st.conceptos.push(lineaVacia());
      const faltan = r.no_encontrados || [], rep = r.repetidos || [];
      st.capMsg = (r.conceptos.length ? r.conceptos.length + ' concepto(s) agregado(s). ' : '') + (faltan.length ? 'No encontré: ' + faltan.join(', ') + '. ' : '') + (rep.length ? 'Serie repetida: ' + rep.join(', ') + '.' : '');
      if (faltan.length || rep.length) { st.capTexto = faltan.concat(rep).join('\n'); st.capturando = true; } else { st.capTexto = ''; st.capturando = false; }
      invalidar(); dibujarConservando();
      if (!st.capturando) msg(st.capMsg, 'ok');
    } catch (e) { st.ocupado = false; m(String(e.message || e)); }
  }
  function dibujarConservando() { const y = window.scrollY; dibujar(); window.scrollTo(0, y); }

  // Lista flotante ÚNICA (hija de .pe, no de una tarjeta): así no la tapa el vidrio de otra tarjeta ni la recorta un scroll. Una fila por resultado con el nombre completo.
  const resaltar = (t, texto) => {
    const ws = String(texto || '').trim().split(/\s+/).filter(w => w.length > 1 && !/[&<>"']/.test(w)).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const h = esc(t);
    return ws.length ? h.replace(new RegExp('(' + ws.join('|') + ')', 'gi'), '<mark>$1</mark>') : h;
  };
  function mostrarSug(input, html, lista, tipo, i) {
    const box = q('[data-sug-global]'); if (!box) return null;
    box.innerHTML = html; box._lista = lista; box._tipo = tipo; box._i = i; box._ancla = input; box._idx = -1; box.hidden = false;
    posicionarSug(); return box;
  }
  function posicionarSug() {
    const box = q('[data-sug-global]'); if (!box || box.hidden || !box._ancla || !box._ancla.isConnected) return;
    const raiz = panel.querySelector('.pe'), b = raiz.getBoundingClientRect(), r = box._ancla.getBoundingClientRect();
    const abajo = innerHeight - r.bottom, arriba = r.top, sube = abajo < 160 && arriba > abajo;   // se abre hacia abajo; solo sube si abajo no hay casi espacio
    box.style.maxHeight = Math.max(120, Math.min(380, (sube ? arriba : abajo) - 14)) + 'px';
    box.style.left = Math.max(0, r.left - b.left) + 'px';
    if (sube) { box.style.top = 'auto'; box.style.bottom = (b.bottom - r.top + 4) + 'px'; } else { box.style.bottom = 'auto'; box.style.top = (r.bottom - b.top + 4) + 'px'; }
    const maxIzq = b.width - box.getBoundingClientRect().width - 4; if (parseFloat(box.style.left) > maxIzq) box.style.left = Math.max(0, maxIzq) + 'px';
  }
  function telaHtml(l) {
    const t = st.telas[String(l.ref || '').toUpperCase()]; if (!l.ref || !t) return '';
    if (t === 'cargando') return '<small>Buscando la tela…</small>';
    if (!t.encontrado) return '<span class="no">Sin promedio en Promedios maestros para esta referencia.</span>';
    const f = n => (Math.round(n * 100) / 100).toLocaleString('es-CO');
    return t.materiales.map(m => 'TELA ' + (m.codigo && !/^\s*\(/.test(m.tela || '') ? '(' + esc(m.codigo) + ') ' : '') + '<b>' + esc(m.tela || m.material) + '</b>' +
      (num(l.cantidad) ? ' · Gasto estimado <b>' + f(m.promedio * num(l.cantidad)) + ' mts</b>' : '') + (m.bodega != null ? ' · En stock <b>' + f(m.bodega) + ' mts</b>' + (num(l.cantidad) && m.bodega < m.promedio * num(l.cantidad) ? ' <span style="color:#ff8a7a">· NO ALCANZA</span>' : '') : '')).join('<br>');
  }
  function pintarTelas() { panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => { const l = st.conceptos[Number(row.dataset.i)], e = row.querySelector('[data-tela]'); if (l && e) { e.innerHTML = telaHtml(l); const t = st.telas[String(l.ref || '').toUpperCase()]; e.classList.toggle('no', !!t && t !== 'cargando' && !t.encontrado); } }); }
  async function cargarTela(ref) {
    const k = String(ref || '').toUpperCase(); if (!k || st.telas[k]) return;
    st.telas[k] = 'cargando'; pintarTelas();
    try { st.telas[k] = await api('/api/pedido-effi/tela?ref=' + encodeURIComponent(k)); } catch (e) { delete st.telas[k]; }
    pintarTelas();
  }
  function elegirSug(idx) {
    const box = q('[data-sug-global]'); if (!box || !box._lista || !box._lista[idx]) return;
    if (box._tipo === 'c') {
      st.cliente = box._lista[idx]; st.direccion = st.cliente.direcciones.length ? 0 : -1; invalidar();
      const v = st.cat.vendedores.find(x => String(x.id) === String(st.cliente.vendedor)); const guardado = valor('vendedor');
      dibujar(); if (v && !guardado) { q('[name="vendedor"]').value = v.id; }
    } else {
      const l = st.conceptos[box._i], a = box._lista[idx];
      Object.assign(l, { articulo: a.id, ref: a.referencia, descripcion: a.descripcion.slice(0, 120), precio: a.precio || l.precio, impuesto: a.impuesto || '' }); invalidar(); dibujar();
    }
  }
  function teclaSug(e) {
    const box = q('[data-sug-global]'); if (!box || box.hidden || box._ancla !== e.target) return;
    const items = [...box.querySelectorAll('[data-i]')]; if (!items.length) { if (e.key === 'Escape') box.hidden = true; return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); box._idx = (box._idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((b, k) => b.classList.toggle('on', k === box._idx)); items[box._idx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); elegirSug(Number((items[box._idx] || items[0]).dataset.i)); }
    else if (e.key === 'Escape') { box.hidden = true; }
  }
  const buscarCliente = debounce(async (texto, input) => {
    const box = q('[data-sug-global]'); if (!box) return;
    if (texto.trim().length < 3) { box.hidden = true; return; }
    mostrarSug(input, '<div class="pe-sug-nota">Buscando…</div>', [], 'c');
    try {
      const r = await api('/api/pedido-effi/clientes?q=' + encodeURIComponent(texto));
      if (box._ancla !== input || box.hidden) return;
      mostrarSug(input, r.clientes.length ? r.clientes.map((c, i) => '<button type="button" data-i="' + i + '"><span class="n">' + resaltar(c.nombre, texto) + '</span><span class="d">' + esc(c.documento) + '</span></button>').join('') : '<div class="pe-sug-nota">Sin resultados para «' + esc(texto.trim()) + '»</div>', r.clientes, 'c');
    } catch (e) { box.hidden = true; msg(String(e.message || e), 'error'); }
  }, 300);
  const buscarArticulo = debounce(async (texto, input, i) => {
    const box = q('[data-sug-global]'); if (!box) return;
    if (texto.trim().length < 2) { box.hidden = true; return; }
    mostrarSug(input, '<div class="pe-sug-nota">Buscando…</div>', [], 'a', i);
    try {
      const r = await api('/api/pedido-effi/articulos?q=' + encodeURIComponent(texto));
      if (box._ancla !== input || box.hidden) return;
      mostrarSug(input, r.articulos.length ? r.articulos.map((a, k) => '<button type="button" data-i="' + k + '"><span class="n">' + resaltar(a.referencia + ' · ' + a.descripcion, texto) + '</span><span class="d">' + (a.precio ? money(a.precio) : 'sin precio de lista') + (a.impuesto ? ' · ' + esc(a.impuesto) : '') + '</span></button>').join('') : '<div class="pe-sug-nota">Sin resultados para «' + esc(texto.trim()) + '»</div>', r.articulos, 'a', i);
    } catch (e) { box.hidden = true; msg(String(e.message || e), 'error'); }
  }, 300);

  function enlazar() {
    if (st.hecho) return;
    panel.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => { if (st.tipo === b.dataset.tipo) return; st.tipo = b.dataset.tipo; st.prev = null; if (st.tipo === 'remision') st.formas = st.formas.map(f => { const x = st.cat.formas_pago.find(y => y.id === Number(f.id)); return x && !x.credito ? defectoForma() : f; }); dibujar(); });
    const mon = q('[name="moneda"]'); mon.onchange = () => { st.moneda = mon.value; if (mon.value === 'COP') st.trm = '1'; invalidar(); dibujar(); };
    const trm = q('[name="trm"]'); trm.addEventListener('input', () => { st.trm = trm.value; invalidar(); });
    const glob = q('[name="global"]'); glob.addEventListener('input', () => {   // como en Effi: el % global se aplica a todos los conceptos (cada uno se puede cambiar después)
      st.global = glob.value; invalidar();
      st.conceptos.forEach(l => { if (!l.obsequio) { l.dtipo = 'pct'; l.descuento = st.global === '' ? 0 : st.global; } });
      panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => { const l = st.conceptos[Number(row.dataset.i)]; if (l.obsequio) return; row.querySelector('[data-f="descuento"]').value = l.descuento; row.querySelector('[data-dtipo]').textContent = '%'; row.querySelector('.pe-total-linea').textContent = money(brutoDe(l) - descDe(l)); });
      refrescarTotales();
    });
    const pr = q('[name="propina"]'); pr.addEventListener('input', () => { st.propina = pr.value; invalidar(); });
    q('[data-propina-tipo]').onclick = () => { st.propinaPct = !st.propinaPct; invalidar(); dibujar(); };
    const pp = q('[name="pronto"]'), fp = q('[name="fecha_pronto"]'); pp.addEventListener('input', () => { st.pronto = pp.value; invalidar(); }); fp.addEventListener('input', () => { st.fechaPronto = fp.value; invalidar(); });
    q('[data-ret-add]').onclick = () => { const v = Number(q('[data-ret-sel]').value); if (v && !st.retenciones.includes(v)) { st.retenciones.push(v); invalidar(); dibujar(); } };
    panel.querySelectorAll('[data-ret-quitar]').forEach(b => b.onclick = () => { st.retenciones = st.retenciones.filter(x => x !== Number(b.dataset.retQuitar)); invalidar(); dibujar(); });
    ['sucursal', 'bodega', 'centro_costos', 'vendedor', 'fecha_entrega', 'garantia', 'observacion'].forEach(n => { const e = q('[name="' + n + '"]'); if (e) e.addEventListener('input', () => { invalidar(); if (n === 'sucursal') dibujar(); }); });
    const dir = q('[name="direccion"]'); if (dir) dir.onchange = () => { st.direccion = Number(dir.value); invalidar(); };
    const cq = q('[name="cliente-q"]');
    cq.addEventListener('input', () => { if (st.cliente) { st.cliente = null; st.direccion = -1; refrescarDirecciones(); } invalidar(); buscarCliente(cq.value, cq); });
    cq.addEventListener('keydown', teclaSug);
    const caja = q('[data-sug-global]');
    caja.addEventListener('mousedown', e => e.preventDefault());   // no le quita el foco al campo
    caja.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) elegirSug(Number(b.dataset.i)); });
    panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => {
      const i = Number(row.dataset.i), l = st.conceptos[i];
      row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
        const f = inp.dataset.f; l[f] = inp.value; invalidar();
        if (f === 'ref') { l.articulo = 0; buscarArticulo(inp.value, inp, i); }
        else if (['cantidad', 'precio', 'descuento'].includes(f)) { row.querySelector('.pe-total-linea').textContent = money(brutoDe(l) - descDe(l)); row.querySelectorAll('input[disabled]')[0].value = money(brutoDe(l)); refrescarTotales(); if (f === 'cantidad') pintarTelas(); }
      }));
      row.querySelector('[data-f="ref"]').addEventListener('keydown', teclaSug);
      if (/^A\d+[A-Z]{1,8}\d{2}/i.test(String(l.ref || ''))) cargarTela(l.ref);
      row.querySelector('[data-dtipo]').onclick = () => { if (l.obsequio) return; l.dtipo = l.dtipo === 'pct' ? 'valor' : 'pct'; invalidar(); dibujar(); };
      row.querySelector('[data-detalles]').onclick = () => { l.abierta = !l.abierta; dibujar(); };
      const ob = row.querySelector('[data-obsequio]'); if (ob) ob.onchange = () => { l.obsequio = ob.checked; invalidar(); dibujar(); };
      row.querySelector('[data-quitar]').onclick = () => { st.conceptos.splice(i, 1); if (!st.conceptos.length) st.conceptos.push(lineaVacia()); invalidar(); dibujar(); };
    });
    q('[data-capturar]').onclick = () => { st.capturando = !st.capturando; dibujar(); if (st.capturando) q('[data-cap-texto]').focus(); };
    const ct = q('[data-cap-texto]');
    if (ct) { ct.addEventListener('input', () => { st.capTexto = ct.value; }); ct.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); capturar(); } }); }
    const cok = q('[data-cap-ok]'); if (cok) cok.onclick = capturar;
    const ccan = q('[data-cap-cancel]'); if (ccan) ccan.onclick = () => { st.capturando = false; st.capTexto = ''; st.capMsg = ''; dibujar(); };
    q('[data-mas]').onclick = () => { st.conceptos.push(lineaVacia()); invalidar(); dibujar(); };
    panel.querySelectorAll('[data-formas] .pe-forma').forEach(row => {
      const j = Number(row.dataset.j);
      row.querySelectorAll('[data-g]').forEach(inp => inp.addEventListener('input', () => { st.formas[j][inp.dataset.g] = inp.value; invalidar(); }));
      const x = row.querySelector('[data-quitar-forma]'); if (x) x.onclick = () => { st.formas.splice(j, 1); invalidar(); dibujar(); };
    });
    q('[data-mas-forma]').onclick = () => { st.formas.push({ id: '', valor: '' }); invalidar(); dibujar(); };
    q('[data-previa-btn]').onclick = () => previa(false);
    q('[data-crear]').onclick = () => previa(true);
  }
  function cierraSug(e) { if (!panel || !e.target.closest) return; const box = q('[data-sug-global]'); if (box && !box.hidden && !box.contains(e.target) && e.target !== box._ancla) box.hidden = true; }
  function refrescarTotales() { const t = totales(), tot = q('.pe-tot'); if (!tot) return; const v = tot.querySelectorAll('b'); v[0].textContent = money(t.b); v[1].textContent = money(t.d); v[2].textContent = money(t.s); }

  async function iniciar() {
    panel.innerHTML = '<div class="pe"><div class="pe-card" style="color:#a9b5a3;font:600 14px Arial">Cargando datos de Effi…</div></div>';
    try {
      const [estado, cat] = await Promise.all([api('/api/pedido-effi/estado'), api('/api/pedido-effi/catalogos')]);
      st.estado = estado; st.cat = cat; st.conceptos = [lineaVacia()]; st.formas = [defectoForma()];
      dibujar();
    } catch (e) {
      panel.innerHTML = '<div class="pe"><div class="pe-card"><p class="pe-msg error" style="font-size:15px">' + esc(String(e.message || e)) + '</p><button class="pe-btn sec" type="button" data-reintentar>REINTENTAR</button></div></div>';
      q('[data-reintentar]').onclick = iniciar;
    }
  }

  // Se monta dentro de cualquier contenedor (hoy: el botón EMPEZAR PEDIDO de PROGRAMAR CLUB, en club-admin.js). Cada montaje empieza limpio y con su propia clave de envío.
  function montar(el) {
    panel = el; Object.assign(st, estadoInicial());
    iniciar();
  }
  // F8 abre o cierra «Capturar series» (como en Effi) mientras el formulario esté abierto, sin importar dónde esté el cursor
  document.addEventListener('keydown', e => { if (e.key === 'F8' && panel && panel.isConnected && st.cat && !st.hecho) { e.preventDefault(); st.capturando = !st.capturando; dibujar(); if (st.capturando) q('[data-cap-texto]').focus(); } });
  document.addEventListener('click', cierraSug);
  window.addEventListener('resize', () => posicionarSug());
  document.addEventListener('scroll', e => { const box = panel && q('[data-sug-global]'); if (box && !box.hidden && !box.contains(e.target)) box.hidden = true; }, true);
  window.PedidoEffi = { montar };
})();
