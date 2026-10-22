/* STOCKMAN · agente de inventario que deja el stock de Effi igual al del panel (por bodega) y muestra las telas con el nombre de Effi.
   Pantalla propia (robot de agentes → INVENTARIOS → STOCKMAN). Reutiliza el estilo de vidrio de MINIMAXIMAN (clases mm-*, que define minimaximan.js). */
(function () {
  'use strict';
  if (window.__stockmanListo) return;
  window.__stockmanListo = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const sg = v => (v > 0 ? '+' : '') + num(v);
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ESTADO = { ajustar: ['DIFERENCIA', 'ambar'], grande: ['DIFERENCIA GRANDE', 'rojo'], ambiguo: ['VARIAS TELAS, MISMO CÓDIGO', 'ambar'], igual: ['IGUAL', 'verde'], sin_articulo: ['SIN ARTÍCULO EN EFFI', 'ambar'] };
  let urlWh = '', actAbierta = false, panel = null, tab = null, timer = null, datos = null, filtro = 'ajustar', buscar = '', ocupado = false, firma = '', vista = 'tarjetas';

  const css = `
  .panel[data-panel="stockman"],.panel[data-panel="stockman"].active{width:100%;max-width:none;grid-template-columns:minmax(0,1fr)!important;justify-content:stretch!important;justify-items:stretch!important}
  body.sm-modo main,body:has(.panel[data-panel="stockman"].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box;padding-left:clamp(12px,1.6vw,36px)!important;padding-right:clamp(12px,1.6vw,36px)!important}
  .panel[data-panel="stockman"] .mm{max-width:none!important;width:100%!important;margin:0!important}
  .sm-tabla{display:grid;gap:0;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.1);padding:4px 10px}
  .sm-fila{display:grid;grid-template-columns:1.3fr 1fr 1fr .9fr;gap:6px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font:700 11px Arial;color:#e8f0e0}
  .sm-fila:last-child{border:0}.sm-fila.cab{font:800 8px Arial;letter-spacing:.12em;color:#9fb096}.sm-fila span:not(:first-child){text-align:right}
  .sm-fila .d{color:#fff}.sm-fila .d.mas{color:var(--lima,#d0f44c)}.sm-fila .d.menos{color:#ffb3ac}
  .sm-tot{display:flex;justify-content:space-between;gap:10px}.sm-tot div{display:grid;gap:2px}.sm-tot small{font:800 8px Arial;letter-spacing:.14em;color:#9fb096}.sm-tot b{font:900 22px Arial;color:#fff}
  .sm-nom{font:700 10px Arial;color:#9fb096}
  .sm-t h4 small{font:800 12px Arial!important;letter-spacing:.04em!important;color:#c5d2bf!important;margin-top:5px!important;display:flex!important;align-items:center;gap:8px;flex-wrap:wrap}
  .sm-id{padding:2px 9px;border-radius:99px;border:1px solid rgba(208,244,76,.55);background:rgba(208,244,76,.12);color:var(--lima,#d0f44c);font:900 12px Arial;letter-spacing:.05em}
  .sm-hero b em{font:800 9px Arial;font-style:normal;letter-spacing:.1em;color:#9fb096;margin-left:5px}
  .sm-pregunta{margin:0;font:700 12.5px/1.4 Arial;color:#e8f0e0}.sm-pregunta b{color:var(--lima,#d0f44c)}
  .sm-opciones{display:grid;gap:7px}.sm-op{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border-radius:12px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12)}
  .sm-op div{display:grid;gap:2px;min-width:0}.sm-op b{font:800 12px Arial;color:#fff;overflow:hidden;text-overflow:ellipsis}.sm-op small{font:700 10px Arial;color:#9fb096}
  .sm-op .mm-bt{width:96px;flex:none;height:30px}.sm-suma{height:34px!important;font-size:10px!important}
  .sm-nota-pie{font:700 10.5px/1.4 Arial;color:#9fb096}.sm-nota-pie b{color:#e8f0e0}.sm-nota-pie a{color:var(--lima,#d0f44c);text-decoration:underline}
  .sm-hero{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center}
  .sm-hero small{display:block;font:800 8px Arial;letter-spacing:.14em;color:#9fb096}.sm-hero b{font:900 24px/1.1 Arial;color:#fff}.sm-hero .der{text-align:right}
  .sm-hero i{font:900 12px Arial;font-style:normal;padding:6px 11px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;white-space:nowrap}
  .sm-hero i.mas{color:var(--lima,#d0f44c);border-color:rgba(208,244,76,.5)}.sm-hero i.menos{color:#ffb3ac;border-color:rgba(255,107,97,.5)}.sm-hero i.ok{color:var(--lima,#d0f44c);border-color:rgba(208,244,76,.5);background:rgba(208,244,76,.12)}
  .sm-t{gap:11px!important}.sm-igualar{height:32px!important;font-size:10px!important}
  .sm-act{padding:0!important}.sm-act summary{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:12px 18px;cursor:pointer;list-style:none;font:700 11px Arial;color:#c5d2bf}.sm-act summary::-webkit-details-marker{display:none}
  .sm-act summary b{font:900 11px Arial;letter-spacing:.16em;color:#fff}.sm-act summary::after{content:"▾";margin-left:auto;color:#9fb096}.sm-act[open] summary::after{content:"▴"}
  .sm-act-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;padding:4px 18px 16px}
  .sm-act-g section{display:grid;gap:7px;align-content:start;font:11px/1.4 Arial;color:#c5d2bf}.sm-act-g h3{margin:0;font:900 10px Arial;letter-spacing:.16em;color:#b9c8b3}
  .sm-act-g .ok{color:#e8f0e0}.sm-act-g .mal{color:#ffb3ac}.sm-act-g .vacio{color:#9fb096}.sm-act-g .sm-nota{color:#9fb096}.sm-act-g .mm-bt{width:auto;padding:0 14px;justify-self:start}

  .sm-wh{display:flex;justify-content:space-between;align-items:center;gap:12px}.sm-url{display:flex;gap:8px;align-items:center}.sm-url code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 10px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.12);color:#e8f0e0;font:11px Consolas,monospace}.sm-url .mm-bt{width:90px;flex:none}
  .sm-hist{padding:12px 16px;display:grid;gap:6px;font:11px Arial;color:#c5d2bf}.sm-hist h3{margin:0;font:900 11px Arial;letter-spacing:.16em;color:#b9c8b3}
  /* Centro de control STOCKMAN: información priorizada, sin alterar datos ni acciones. */
  .sm-control{display:grid;grid-template-columns:minmax(240px,1.25fr) minmax(360px,2fr) auto;gap:12px;align-items:stretch;margin-bottom:12px}
  .sm-intro{padding:16px 18px;display:grid;gap:5px}.sm-intro-top{display:flex;align-items:center;gap:9px}.sm-intro h2{margin:0;font:900 18px Arial;letter-spacing:.04em;color:#fff}.sm-intro p{margin:0;color:#aebca7;font:600 11px/1.4 Arial}.sm-live{display:inline-flex;align-items:center;gap:6px;color:var(--lima,#d0f44c);font:800 9px Arial;letter-spacing:.12em}.sm-live i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgba(208,244,76,.12);animation:smPulso 1.8s infinite}
  .sm-metricas{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.sm-metrica{position:relative;overflow:hidden;text-align:left;padding:12px 14px;border-radius:15px;border:1px solid rgba(255,255,255,.13);background:linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.025));color:#fff;cursor:pointer;transition:.2s transform,.2s border-color}.sm-metrica:hover,.sm-metrica.on{transform:translateY(-2px);border-color:rgba(208,244,76,.65)}.sm-metrica.on{background:linear-gradient(145deg,rgba(208,244,76,.24),rgba(208,244,76,.06))}.sm-metrica b{display:block;font:900 25px/1 Arial}.sm-metrica span{display:block;margin-top:5px;font:800 8px Arial;letter-spacing:.12em;color:#b8c5b2}.sm-metrica[data-sm-filtro="ajustar"] b{color:#ffe09c}.sm-metrica[data-sm-filtro="sin_articulo"] b{color:#ffc2a9}
  .sm-acciones{display:grid;align-content:center;gap:8px;padding:10px 12px;min-width:132px}.sm-vistas{display:flex;gap:5px;padding:4px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.2);border-radius:11px}.sm-vistas button{border:0;border-radius:8px;background:transparent;color:#aebca7;font:800 10px Arial;padding:7px 8px;cursor:pointer}.sm-vistas button.on{background:rgba(208,244,76,.18);color:var(--lima,#d0f44c)}
  .sm-subbarra{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;margin-bottom:12px}.sm-subbarra b{font:800 10px Arial;letter-spacing:.12em;color:#dce8d6}.sm-subbarra span{font:700 10px Arial;color:#91a28c}.sm-subbarra strong{color:var(--lima,#d0f44c)}
  .sm-host .mm-lista{grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:13px}.sm-host.vista-lista .mm-lista{grid-template-columns:1fr}.sm-host.vista-lista .sm-t{grid-template-columns:minmax(210px,.9fr) minmax(290px,1.3fr) minmax(150px,.5fr);align-items:center}.sm-host.vista-lista .sm-t h4{align-self:start}.sm-host.vista-lista .sm-nota-pie{grid-column:2/-1}.sm-host.vista-lista .mm-marca{width:105px}
  .sm-t{position:relative;isolation:isolate}.sm-t::after{content:"";position:absolute;left:0;top:18px;bottom:18px;width:3px;border-radius:0 5px 5px 0;background:rgba(208,244,76,.55);opacity:.65}.sm-t.ambar::after{background:#ffc850}.sm-t.rojo::after{background:#ff796d}
  @keyframes smPulso{50%{opacity:.5;transform:scale(1.25)}}
  @media(max-width:900px){.sm-control{grid-template-columns:1fr}.sm-acciones{grid-template-columns:1fr auto;align-items:center}.sm-metricas{grid-template-columns:repeat(4,1fr)}}
  @media(max-width:600px){.sm-metricas{grid-template-columns:repeat(2,1fr)}.sm-host.vista-lista .sm-t{grid-template-columns:1fr}.sm-host.vista-lista .sm-nota-pie{grid-column:auto}.sm-subbarra{align-items:flex-start}.sm-t::after{top:14px;bottom:14px}.sm-hero b{font-size:21px}}
  `;

  const api = async (url, opciones) => {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opciones });
    let d = null; try { d = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No se pudo completar la acción');
    return d;
  };
  const hora = iso => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const coincide = t => filtro === 'todo' || (filtro === 'ajustar' && (t.estado === 'ajustar' || t.estado === 'grande' || t.estado === 'ambiguo')) || t.estado === filtro;

  function tarjeta(t, i) {
    const [txt, tono] = ESTADO[t.estado] || ['—', ''];
    const vivas = (t.bodegas || []).filter(b => b.panel || b.effi);   // las bodegas en cero en los dos lados no se muestran
    const filas = vivas.map(b => '<div class="sm-fila"><span>' + esc(b.nombre) + '</span><span>' + num(b.panel) + '</span><span>' + num(b.effi) + '</span><span class="d ' + (b.delta > 0 ? 'mas' : b.delta < 0 ? 'menos' : '') + '">' + (Math.abs(b.delta) < 0.01 ? '=' : sg(b.delta)) + '</span></div>').join('');
    const boton = (t.estado === 'ajustar' || t.estado === 'grande') ? '<button type="button" class="mm-bt env sm-igualar" data-sm-ajustar="' + esc(t.codigo) + '" data-grande="' + (t.estado === 'grande' ? 1 : 0) + '" data-tela="' + esc(t.tela) + '">IGUALAR EN EFFI</button>' : '';
    const dif = Math.round((t.diferencia || 0) * 100) / 100;
    const cuerpo = t.estado === 'ambiguo'
      ? '<p class="sm-pregunta">El código <b>' + esc(t.codigo) + '</b> lo usan ' + (t.opciones || []).length + ' telas del panel. ¿Cuál es la de este artículo de Effi?</p><div class="sm-opciones">' + (t.opciones || []).map(o => '<div class="sm-op"><div><b>' + esc(o.nombre) + '</b><small>' + num(o.mts) + ' mts en el panel</small></div><button type="button" class="mm-bt" data-sm-asignar="una" data-codigo="' + esc(t.codigo) + '" data-nombre="' + esc(o.nombre) + '">ES ESTA</button></div>').join('') + '</div><button type="button" class="mm-bt env sm-suma" data-sm-asignar="suma" data-codigo="' + esc(t.codigo) + '">SON LA MISMA TELA · SUMAR LAS ' + (t.opciones || []).length + ' (' + num(t.panel) + ' mts)</button><div class="sm-nota-pie">Mientras no elijas, STOCKMAN no toca esta tela.</div>'
      : t.estado === 'sin_articulo'
      ? '<div class="mm-nota">Effi no tiene un artículo con esta referencia exacta. Escribe su «ID Effi» en INFORMACIÓN TELA.</div>'
      : '<div class="sm-hero"><div><small>PANEL · METROS</small><b>' + num(t.panel) + '<em>MTS</em></b></div><i class="' + (Math.abs(dif) < 0.01 ? 'ok' : dif > 0 ? 'mas' : 'menos') + '">' + (Math.abs(dif) < 0.01 ? '✔ IGUAL' : sg(dif) + ' mts') + '</i><div class="der"><small>EFFI · METROS</small><b>' + num(t.effi) + '<em>MTS</em></b></div></div>' +
        (vivas.length ? '<div class="sm-tabla"><div class="sm-fila cab"><span>BODEGA</span><span>PANEL (MTS)</span><span>EFFI (MTS)</span><span>DIF. (MTS)</span></div>' + filas + '</div>' : '') + boton;
    const elegida = t.varias && t.estado !== 'ambiguo' ? '<div class="sm-nota-pie">Tela del panel: <b>' + esc(t.item_panel) + '</b>' + (t.asignada ? ' · elegida por ti' : ' · escogida por nombre') + ' · <a href="#" data-sm-asignar="auto" data-codigo="' + esc(t.codigo) + '">cambiar</a></div>' : '';
    return '<article class="mm-glass mm-t sm-t ' + tono + '" style="animation-delay:' + Math.min(i * 25, 300) + 'ms"><h4><span>' + esc(t.tela) + '<small>CÓD. ' + esc(t.codigo) + (t.id_effi ? ' <span class="sm-id">ID EFFI ' + esc(t.id_effi) + '</span>' : '') + '</small></span><em>' + txt + '</em></h4>' + cuerpo + elegida + '<img class="mm-marca" src="/marca-indoor.svg" alt="" aria-hidden="true"></article>';
  }

  function pintarLista() {
    const host = panel.querySelector('.sm-host'); if (!host || !datos) return;
    const q = plano(buscar);
    const lista = datos.telas.filter(t => coincide(t) && (!q || plano(t.tela + ' ' + t.codigo + ' ' + (t.nombre_panel || '')).includes(q)));
    lista.sort((x, y) => (y.panel || 0) - (x.panel || 0) || String(x.tela).localeCompare(String(y.tela)));   // primero la tela con MAYOR stock en el panel
    const aviso = filtro === 'sin_articulo' && datos.agente.error ? '<div class="mm-nota" style="margin-bottom:10px">' + esc(datos.agente.error) + '</div>' : '';
    host.classList.toggle('vista-lista', vista === 'lista');
    const rotulo = { ajustar: 'diferencias por resolver', igual: 'artículos conciliados', sin_articulo: 'artículos sin referencia en Effi', todo: 'artículos en seguimiento' }[filtro] || 'artículos';
    host.innerHTML = '<div class="sm-subbarra"><b><strong>' + lista.length + '</strong> ' + rotulo + '</b><span>Ordenados por mayor stock · ' + (vista === 'lista' ? 'vista compacta' : 'vista por tarjetas') + '</span></div>' + aviso + (lista.length ? '<div class="mm-lista">' + lista.map(tarjeta).join('') + '</div>' : '<div class="mm-vacio">' + (filtro === 'ajustar' ? 'Nada por igualar: el stock del panel y el de Effi coinciden.' : 'No hay telas con ese filtro.') + '</div>');
  }

  function actividad() {
    const wh = datos.webhook || {};
    const dir = h => h.tipo === 'a_panel' ? 'Effi → panel' : 'Panel → Effi';
    const op = h => ({ traslado: 'traslado', ajuste: 'ingreso', egreso: 'egreso' }[h.operacion] || 'ajuste');
    const hist = (datos.ajustes || []).slice(0, 8).map(h => '<div class="' + (h.estado === 'hecho' ? 'ok' : 'mal') + '">' + (h.estado === 'hecho' ? '✔' : '✕') + ' <b>' + dir(h) + '</b> · ' + op(h) + ' · ' + esc(h.tela) + ' · ' + esc(h.bodega) + ' ' + sg(h.delta) + ' mts · ' + (h.tipo === 'a_panel' ? esc(h.at) : hora(h.at)) + (h.estado === 'hecho' ? ' · n.° ' + esc(h.ajuste) : ' · ' + esc(h.detalle || '')) + '</div>').join('') || '<div class="vacio">Todavía no hay ajustes.</div>';
    const cam = (datos.cambios || []).map(h => '<div>⏱ ' + esc(h.tela) + ' · ' + esc(h.bodega_nombre) + ' ' + sg(h.delta) + ' mts (de ' + num(h.antes) + ' a ' + num(h.ahora) + ')</div>').join('');
    const pend = (datos.pendientes || []).map(h => '<div>⏳ ' + esc(h.tela) + ' · ' + esc(h.bodega) + ' ' + sg(h.delta) + ' mts · ajuste ' + esc(h.ajuste) + ' de ' + esc(h.por) + '</div>').join('');
    const firmaTxt = wh.secreto ? ' · firma: ' + ({ valida: 'válida ✔', no_coincide: 'NO coincide', sin_firma: 'el aviso no trae firma' }[wh.firma] || '—') : '';
    const whTxt = wh.recibidos ? 'conectado · ' + wh.recibidos + ' avisos · el último ' + hora(wh.ultimo) + firmaTxt : 'sin avisos todavía (mientras tanto revisa cada 2 minutos)';
    const nCam = (datos.cambios || []).length + (datos.pendientes || []).length;
    return '<details class="mm-glass sm-act"' + (actAbierta ? ' open' : '') + '><summary><b>ACTIVIDAD</b><span>Webhook ' + (wh.recibidos ? 'conectado' : 'sin avisos') + '</span><span>' + nCam + ' cambios en espera</span><span>' + (datos.ajustes || []).length + ' ajustes recientes</span></summary>' +
      '<div class="sm-act-g"><section><h3>WEBHOOK DE EFFI</h3><div>' + esc(whTxt) + '</div><button type="button" class="mm-bt" data-sm-webhook>GENERAR WEBHOOK</button>' +
      (urlWh ? '<div class="sm-nota">Pega esta dirección en Effi (Integraciones → Webhooks), método POST. No cambia la clave.</div><div class="sm-url"><code>' + esc(urlWh) + '</code><button type="button" class="mm-bt" data-sm-copiar>COPIAR</button><button type="button" class="mm-bt" data-sm-ocultar>OCULTAR</button></div>' : '') + '</section>' +
      '<section><h3>CAMBIOS EN ESPERA</h3>' + (cam || pend || '<div class="vacio">Ninguno: el panel y Effi están al día.</div>') + '</section>' +
      '<section><h3>ÚLTIMOS AJUSTES</h3>' + hist + '</section></div></details>';
  }

  function pintar() {
    if (!panel || !datos) return;
    const foco = document.activeElement;
    if (foco && foco.matches && foco.matches('[data-sm-buscar]') && panel.contains(foco)) { pintarLista(); return; }
    const a = datos.agente, r = datos.resumen, activo = !!a.activo;
    const total = Math.max(r.telas || 0, 1);
    const kpi = (k, n, rotulo) => '<button type="button" class="sm-metrica' + (filtro === k ? ' on' : '') + '" data-sm-filtro="' + k + '" data-lq="' + Math.round(n * 100 / total) + '" data-lq-nopct><b>' + n + '</b><span>' + rotulo + '</span></button>';
    panel.querySelector('.mm').innerHTML =
      '<div class="sm-control"><section class="mm-glass sm-intro"><div class="sm-intro-top"><img class="mm-logo" src="/marca-indoor.svg" alt="Indoor"><span class="sm-live"><i></i>' + (activo ? 'SINCRONIZACIÓN ACTIVA' : 'SINCRONIZACIÓN PAUSADA') + '</span></div><h2>Control de artículos</h2><p>Compara por bodega el inventario del panel con Effi.</p><small>Actualizado ' + hora(a.ultima) + '</small></section>' +
      '<section class="sm-metricas">' + kpi('ajustar', r.ajustar + r.grande + (r.ambiguo || 0), 'POR REVISAR') + kpi('igual', r.igual, 'CONCILIADOS') + kpi('sin_articulo', r.sin_articulo, 'SIN ARTÍCULO') + kpi('todo', r.telas, 'TOTAL') + '</section>' +
      '<section class="mm-glass sm-acciones"><div class="mm-sw' + (activo ? ' on' : '') + '"><i></i><span>' + (activo ? 'ACTIVO' : 'APAGADO') + '</span><button type="button" data-sm-activar="' + (activo ? 0 : 1) + '" aria-label="Activar o apagar STOCKMAN"></button></div><button type="button" class="mm-b" data-sm-revisar' + (ocupado ? ' disabled' : '') + '>↻ ' + (ocupado ? 'REVISANDO…' : 'REVISAR') + '</button><div class="sm-vistas"><button type="button" data-sm-vista="tarjetas" class="' + (vista === 'tarjetas' ? 'on' : '') + '">▦ TARJETAS</button><button type="button" data-sm-vista="lista" class="' + (vista === 'lista' ? 'on' : '') + '">☰ LISTA</button></div></section></div>' +
      '<div class="mm-glass mm-top"><div class="mm-busca"><input type="search" data-sm-buscar placeholder="Buscar por tela, código o artículo…" value="' + esc(buscar) + '" autocomplete="off"></div></div>' +
      actividad() + '<div class="mm-cuerpo"><div class="sm-host"></div></div>';
    pintarLista();
  }

  async function cargar() {
    try {
      const nuevo = await api('/api/stockman/estado');
      const f = JSON.stringify(nuevo);
      if (f === firma) return;
      firma = f; datos = nuevo; pintar();
    } catch (e) { if (panel) panel.querySelector('.mm').innerHTML = '<div class="mm-vacio">' + esc(e.message) + '</div>'; }
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="stockman"]')) return true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'stockman';
    panel.innerHTML = '<div class="mm"><div class="mm-vacio">Cargando…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="stockman" type="button"><span class="nav-icon">SM</span><strong>STOCKMAN</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      firma = ''; cargar(); clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 20000);
    });
    const marcar = () => document.body.classList.toggle('sm-modo', panel.classList.contains('active'));
    new MutationObserver(marcar).observe(panel, { attributes: true, attributeFilter: ['class'] }); marcar();
    panel.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('sm-act')) actAbierta = e.target.open; }, true);
    panel.addEventListener('input', e => { if (e.target.matches('[data-sm-buscar]')) { buscar = e.target.value; pintarLista(); } });
    panel.addEventListener('click', async e => {
      const f = e.target.closest('[data-sm-filtro]'); if (f) { filtro = f.dataset.smFiltro; pintar(); return; }
      const v = e.target.closest('[data-sm-vista]'); if (v) { vista = v.dataset.smVista; pintar(); return; }
      const r = e.target.closest('[data-sm-revisar]');
      if (r && !ocupado) { ocupado = true; pintar(); try { await api('/api/stockman/revisar', { method: 'POST' }); } catch (x) { alert(x.message); } ocupado = false; firma = ''; await cargar(); return; }
      const aj = e.target.closest('[data-sm-ajustar]');
      if (aj) {
        const grande = aj.dataset.grande === '1';
        if (!confirm('¿Dejar «' + aj.dataset.tela + '» en Effi igual que en el panel?\n\nSe crea un ajuste de inventario en Effi por cada bodega con diferencia (afecta el inventario contable). Esto iguala TODA la tela; lo normal es que STOCKMAN solo ajuste la bodega que cambia.' + (grande ? '\n\n⚠ La diferencia es GRANDE: revisa bien antes de aceptar.' : ''))) return;
        aj.disabled = true;
        try { await api('/api/stockman/ajustar', { method: 'POST', body: JSON.stringify({ codigo: aj.dataset.smAjustar }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar(); return;
      }
      const gw = e.target.closest('[data-sm-webhook]');
      if (gw) { try { urlWh = location.origin + (await api('/api/stockman/webhook-direccion', { method: 'POST' })).ruta; } catch (x) { alert(x.message); } firma = ''; pintar(); return; }
      const oc = e.target.closest('[data-sm-ocultar]'); if (oc) { urlWh = ''; pintar(); return; }
      const cp = e.target.closest('[data-sm-copiar]');
      if (cp) { try { await navigator.clipboard.writeText(urlWh); cp.textContent = 'COPIADO'; setTimeout(() => { cp.textContent = 'COPIAR'; }, 1500); } catch (_) { prompt('Copia esta dirección:', urlWh); } return; }
      const asg = e.target.closest('[data-sm-asignar]');
      if (asg) {
        e.preventDefault();
        const modo = asg.dataset.smAsignar;
        if (modo !== 'auto' && !confirm(modo === 'suma' ? 'Se sumarán todas las telas con el código ' + asg.dataset.codigo + ' para compararlas con el artículo de Effi. ¿Continuar?' : 'Para el código ' + asg.dataset.codigo + ' se usará «' + asg.dataset.nombre + '» como la tela de este artículo de Effi. ¿Continuar?')) return;
        try { await api('/api/stockman/asignar', { method: 'POST', body: JSON.stringify({ codigo: asg.dataset.codigo, modo, nombre: asg.dataset.nombre || '' }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar(); return;
      }
      const s = e.target.closest('[data-sm-activar]');
      if (s) {
        const quiere = s.dataset.smActivar === '1';
        if (quiere && !confirm('¿Activar STOCKMAN?\n\nEl panel es el inventario real. Cuando el panel cambie en una bodega, STOCKMAN hará en Effi un ajuste SOLO de esa bodega y por lo que cambió, tras 5 minutos estable (no toca las demás); y los ajustes que se hagan en Effi desde ahora los registrará en el panel (ingreso o salida). Las diferencias grandes no las toca: esperan a que pulses AJUSTAR.')) return;
        try { await api('/api/stockman/activar', { method: 'PUT', body: JSON.stringify({ activo: quiere }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar();
      }
    });
    return true;
  }

  fetch('/api/stockman/nombres', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r : null)).then(ok => {
    if (!ok) return;   // solo las cuentas con acceso al agente de inventario
    let intentos = 0;
    const espera = setInterval(() => { if (construir() || ++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso: no se muestra */ });
})();
