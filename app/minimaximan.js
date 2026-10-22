/* MINIMAXIMAN · agente de inventario que mantiene cada tela entre su stock mínimo y su stock máximo.
   Pantalla propia (robot de agentes → INVENTARIOS → MINIMAXIMAN): usa todo el ancho; a la izquierda las telas (buscador, filtros y orden) y a la derecha
   las órdenes de compra que ha creado, con las que esperan tu aprobación primero. */
(function () {
  'use strict';
  if (window.__minimaximanListo) return;
  window.__minimaximanListo = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ESTADO = { pedir: ['POR PEDIR', 'rojo'], error: ['CON ERROR', 'rojo'], sin_proveedor: ['SIN PROVEEDOR', 'ambar'], sin_effi: ['NO LO VEO EN EFFI', 'ambar'], revisar: ['REVISAR RANGO', 'ambar'], en_camino: ['EN CAMINO', 'azul'], ok: ['EN RANGO', 'verde'] };
  const GRUPOS = [['atencion', 'ATENCIÓN'], ['en_camino', 'EN CAMINO'], ['ok', 'EN RANGO'], ['todas', 'TODAS']];
  let guardado = {}; try { guardado = JSON.parse(localStorage.getItem('mm-vista') || '{}'); } catch (_) { /* sin almacenamiento */ }
  let panel = null, tab = null, timer = null, datos = null, filtro = guardado.filtro || 'atencion', buscar = '', orden = guardado.orden || 'estado', ocupado = false, firma = '';
  const recordar = () => { try { localStorage.setItem('mm-vista', JSON.stringify({ filtro, orden })); } catch (_) { /* sin almacenamiento */ } };

  const css = document.createElement('style');
  css.textContent = `
  .panel[data-panel="minimaximan"],.panel[data-panel="minimaximan"].active{width:100%;max-width:none;grid-template-columns:minmax(0,1fr)!important;justify-content:stretch!important;justify-items:stretch!important;place-content:stretch!important}
  body.mm-modo main,body:has(.panel[data-panel="minimaximan"].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box;padding-left:clamp(12px,1.6vw,36px)!important;padding-right:clamp(12px,1.6vw,36px)!important}
  .panel[data-panel="minimaximan"] .mm{max-width:none!important;width:100%!important;margin:0!important;gap:18px}
  .mm>*{width:100%;max-width:none;box-sizing:border-box;justify-self:stretch;margin-left:0;margin-right:0}
  .mm{overflow-x:clip;display:grid;gap:18px;padding:4px 0 34px;font-family:Arial,sans-serif;color:#e8f0e0;position:relative;isolation:isolate;width:100%;min-height:calc(100vh - 150px);align-content:start}
  .mm::before,.mm::after{content:"";position:absolute;z-index:-1;border-radius:50%;filter:blur(80px);pointer-events:none;animation:mmFlota 18s ease-in-out infinite alternate}
  .mm::before{left:-80px;top:-40px;width:520px;height:520px;background:radial-gradient(circle,rgba(111,227,154,.26),transparent 70%)}
  .mm::after{right:-100px;top:280px;width:560px;height:560px;background:radial-gradient(circle,rgba(255,122,89,.18),transparent 70%);animation-delay:-9s}
  @keyframes mmFlota{to{transform:translate(70px,50px) scale(1.15)}}
  .mm-glass{border:1px solid rgba(255,255,255,.2);border-radius:20px;background:linear-gradient(150deg,rgba(255,255,255,.14),rgba(255,255,255,.04) 45%,rgba(255,255,255,.08));-webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 14px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.3)}
  .mm-hd{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:14px 22px}
  .mm-sub{font:12px Arial;color:#9fb096}.mm-hd small{display:none}.mm-hd h2{margin:4px 0 6px;font:900 30px Arial;letter-spacing:.06em;background:linear-gradient(90deg,#fff,#9ff0c0);-webkit-background-clip:text;background-clip:text;color:transparent}
  .mm-hd p{margin:0;font:13px/1.5 Arial;color:#a9b8a3;max-width:760px}
  .mm-ctl{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
  .mm-sw{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.28);font:800 12px Arial;letter-spacing:.05em}
  .mm-sw i{width:10px;height:10px;border-radius:50%;background:#ff6b61;box-shadow:0 0 0 0 rgba(255,107,97,.6);animation:mmPulso 1.8s ease-out infinite}
  .mm-sw.on i{background:#6fe39a;animation-name:mmPulsoOk}
  @keyframes mmPulso{to{box-shadow:0 0 0 10px rgba(255,107,97,0)}}@keyframes mmPulsoOk{0%{box-shadow:0 0 0 0 rgba(111,227,154,.6)}100%{box-shadow:0 0 0 10px rgba(111,227,154,0)}}
  .mm-sw button{width:54px;height:28px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:#3a3f38;position:relative;cursor:pointer;transition:background .2s;padding:0}
  .mm-sw button::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}
  .mm-sw.on button{background:#2fae62}.mm-sw.on button::after{transform:translateX(26px)}.mm-sw.on span{color:#6fe39a}.mm-sw:not(.on) span{color:#ffb39f}
  .mm-b{padding:10px 16px;border-radius:13px;border:1px solid rgba(255,255,255,.25);background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.06));color:#fff;font:800 12px Arial;letter-spacing:.05em;cursor:pointer;transition:transform .15s,background .15s;box-shadow:inset 0 1px 0 rgba(255,255,255,.3)}
  .mm-b:hover:not(:disabled){transform:translateY(-1px);background:rgba(255,255,255,.22)}.mm-b:disabled{opacity:.5;cursor:default}
  .mm-b.ok{background:linear-gradient(180deg,#5fe39a,#2fae62);color:#04210f;border-color:rgba(255,255,255,.4)}
  .mm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
  .mm-kpi{padding:12px 16px;cursor:pointer;text-align:left;color:inherit;font:inherit;position:relative;overflow:hidden;transition:transform .2s,border-color .2s}
  .mm-kpi:hover{transform:translateY(-3px)}.mm-kpi.on{border-color:rgba(111,227,154,.8);box-shadow:0 0 0 1px rgba(111,227,154,.35),0 14px 40px rgba(0,0,0,.35)}
  .mm-kpi b{display:block;font:900 30px Arial;position:relative}.mm-kpi span{font:800 10px Arial;letter-spacing:.12em;color:#c5d2bf;position:relative}
  .mm-cuerpo{display:grid;gap:14px}.mm-barra.mm-glass{padding:10px 12px}.mm-tit{margin:4px 0 0;font:900 12px Arial;letter-spacing:.16em;color:#ffe0a0}.mm-tit em{font-style:normal;padding:3px 9px;border-radius:99px;background:rgba(255,200,80,.2);border:1px solid #ffc850;margin-left:6px}.mm-ant summary{cursor:pointer;font:900 12px Arial;letter-spacing:.16em;color:#b9c8b3;padding:6px 2px}.mm-ant .mm-lista{margin-top:10px}
  .mm-izq{display:grid;gap:14px;min-width:0}
  .mm-barra{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 14px}
  .mm-barra input,.mm-barra select{height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.3);color:#fff;font:14px Arial;padding:0 12px;outline:0}
  .mm-barra input{flex:1;min-width:200px}.mm-barra input:focus,.mm-barra select:focus{border-color:#6fe39a}
  .mm-chips{display:flex;flex-wrap:wrap;gap:8px}.mm-chip{padding:8px 13px;border-radius:99px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#d7e3d1;font:800 11px Arial;letter-spacing:.05em;cursor:pointer}
  .mm-chip em{font-style:normal;color:#8fa596;margin-left:5px}.mm-chip.on{background:#6fe39a;border-color:#6fe39a;color:#06240f}.mm-chip.on em{color:#0b3a1d}
  .mm-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
  .mm-t{padding:18px 20px;display:grid;gap:14px;transition:transform .2s,border-color .2s;animation:mmEntra .35s ease-out backwards}.mm-t:hover{transform:translateY(-3px)}
  @keyframes mmEntra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .mm-t h4{margin:0;font:900 15px/1.25 Arial;letter-spacing:.03em;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .mm-t h4 small{display:block;font:700 10px Arial;color:#9fb096;letter-spacing:.08em;margin-top:3px}
  .mm-t h4 em{font:800 9.5px Arial;font-style:normal;letter-spacing:.08em;padding:5px 9px;border-radius:99px;border:1px solid rgba(255,255,255,.3);white-space:nowrap}
  .mm-t.rojo{border-color:rgba(255,107,97,.55)}.mm-t.rojo h4 em{background:rgba(255,107,97,.25);border-color:#ff6b61;color:#ffb3ac}.mm-t.ambar h4 em{background:rgba(255,200,80,.2);border-color:#ffc850;color:#ffe0a0}
  .mm-t.azul h4 em{background:rgba(100,170,255,.2);border-color:#64aaff;color:#bcd8ff}.mm-t.verde h4 em{background:rgba(111,227,154,.18);border-color:#6fe39a;color:#bff5d3}
  .mm-medidor{position:relative;height:14px;border-radius:99px;background:rgba(255,255,255,.1);margin:6px 0 16px}
  .mm-medidor i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#4fae86,#a6f0c6);transition:width .6s ease}
  .mm-t.rojo .mm-medidor i{background:linear-gradient(90deg,#e8573a,#ff9d83)}.mm-t.azul .mm-medidor i{background:linear-gradient(90deg,#4a86d8,#9cc6ff)}.mm-t.ambar .mm-medidor i{background:linear-gradient(90deg,#d49a2a,#ffd98a)}
  .mm-medidor u{position:absolute;top:-5px;bottom:-5px;width:2px;background:#fff;text-decoration:none}.mm-medidor u b{position:absolute;top:100%;left:50%;transform:translateX(-50%);font:700 9px Arial;color:#c5d2bf;margin-top:2px;white-space:nowrap}
  .mm-nums{display:flex;justify-content:space-between;gap:8px;font:700 11px Arial;color:#c5d2bf}.mm-nums b{color:#fff}
  .mm-medidor{height:20px;border-radius:99px;background:rgba(255,255,255,.07);margin:8px 0 22px;overflow:visible;box-shadow:inset 0 2px 6px rgba(0,0,0,.5)}
  .mm-zona{position:absolute;top:0;bottom:0;left:0;border-radius:99px 0 0 99px;background:repeating-linear-gradient(135deg,rgba(255,107,97,.28) 0 6px,rgba(255,107,97,.12) 6px 12px)}
  .mm-zona.ok{border-radius:0 99px 99px 0;background:rgba(111,227,154,.16)}
  .mm-medidor i{z-index:2;border-radius:99px;width:var(--w);animation:mmLlena .9s cubic-bezier(.2,.8,.2,1) backwards;box-shadow:0 0 14px currentColor;background-size:200% 100%}
  .mm-medidor s{position:absolute;top:3px;bottom:3px;z-index:1;border-radius:99px;border:1.5px dashed rgba(255,255,255,.7);background:rgba(255,255,255,.12);animation:mmPulso 1.8s ease-in-out infinite}
  .mm-medidor q{position:absolute;z-index:3;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(255,255,255,.25),0 0 16px currentColor;animation:mmPulso 1.8s ease-in-out infinite}
  .mm-t.rojo .mm-medidor{color:#ff6b61}.mm-t.azul .mm-medidor{color:#64aaff}.mm-t.ambar .mm-medidor{color:#ffc850}.mm-t.verde .mm-medidor{color:#6fe39a}
  .mm-medidor u{z-index:4;top:-4px;bottom:-4px;background:rgba(255,255,255,.85)}
  @keyframes mmLlena{from{width:0}}@keyframes mmPulso{50%{opacity:.55;transform:scale(1.08)}}
  .mm-t.rojo{animation:mmEntra .35s ease-out backwards,mmAlerta 3.2s ease-in-out infinite .6s}@keyframes mmAlerta{50%{box-shadow:0 14px 34px -16px rgba(0,0,0,.8),0 0 26px -4px rgba(255,107,97,.45),inset 0 1px 0 rgba(255,255,255,.28)}}
  .mm-pedir{transition:transform .2s}.mm-t:hover .mm-pedir{transform:scale(1.08)}.mm-stats div{transition:transform .2s}.mm-t:hover .mm-stats div{transform:translateY(-2px)}
  .mm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:9px 6px;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.1);text-align:center}.mm-stats small{display:block;font:800 8.5px Arial;letter-spacing:.12em;color:#9fb096}.mm-stats b{font:900 17px Arial;color:#fff}
  .mm-fila{display:flex;justify-content:space-between;align-items:center;gap:8px;font:700 12px Arial;color:#c5d2bf}.mm-fila b{color:#fff;font-size:14px}
  .mm-pedir{padding:5px 11px;border-radius:99px;background:rgba(255,107,97,.18);border:1px solid rgba(255,107,97,.5);color:#ffb3ac}.mm-pedir b{font:900 15px Arial;color:#ffd3cf}
  .mm-nota{font:12px/1.4 Arial;color:#a9b8a3}.mm-vacio{padding:30px;text-align:center;color:#9fb096;font:13px/1.5 Arial;border:1px dashed rgba(255,255,255,.2);border-radius:16px}
  .mm-der{display:grid;gap:14px;position:sticky;top:12px;max-height:calc(100vh - 40px);overflow:auto;align-content:start;padding:2px}
  .mm-caja{padding:16px 18px;display:grid;gap:10px}.mm-caja h3{margin:0;font:900 12px Arial;letter-spacing:.16em;color:#b9c8b3;display:flex;justify-content:space-between;align-items:center}
  .mm-caja h3 em{font:900 10px Arial;font-style:normal;padding:4px 9px;border-radius:99px;background:rgba(255,200,80,.2);border:1px solid #ffc850;color:#ffe0a0}
  .mm-oc{padding:16px 18px;display:grid;gap:9px}
  .mm-oc.espera{border-color:rgba(255,200,80,.6);background:rgba(255,200,80,.08)}.mm-oc.error{border-color:rgba(255,107,97,.6)}
  .mm-oc b{font:800 13px Arial}.mm-oc .mm-nums{font-size:11px}.mm-oc .mm-b{width:100%}
  .mm-pasos{margin:0;padding-left:18px;font:12px/1.55 Arial;color:#a9b8a3}
  @media(max-width:1180px){}
  @media(max-width:700px){.mm-hd h2{font-size:23px}.mm-hd{padding:16px}.mm-lista{grid-template-columns:1fr}.mm-kpis{grid-template-columns:repeat(2,1fr)}}
  /* TARJETA VIDRIOSA IGUAL A LAS DE PRODUCCIÓN: vidrio con desenfoque, borde superior de color según el estado, destello que sigue al mouse, inclinación suave y brillo de color
     arriba a la derecha. Se aplica a las tarjetas de telas, a las cajas de la derecha, a los resúmenes y al encabezado. */
  .mm-glass{position:relative;overflow:hidden;background:linear-gradient(150deg,rgba(255,255,255,.14),rgba(255,255,255,.04) 55%,rgba(255,255,255,.08));-webkit-backdrop-filter:blur(22px) saturate(160%);backdrop-filter:blur(22px) saturate(160%);border:1px solid rgba(255,255,255,.18);border-top:1px solid rgba(139,219,175,.65);border-radius:20px;box-shadow:0 14px 34px -16px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.28),inset 0 0 44px rgba(255,255,255,.03);transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .18s ease-out,box-shadow .3s,border-color .3s}
  .mm-glass::before{content:"";position:absolute;right:-70px;top:-90px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(139,219,175,.42),transparent 66%);filter:blur(8px);animation:mmOrbe 9s ease-in-out infinite alternate;pointer-events:none;z-index:0}
  .mm-glass::after{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(260px circle at var(--mx,50%) var(--my,0%),rgba(255,255,255,.2),transparent 62%);opacity:0;transition:opacity .25s;pointer-events:none;z-index:2}
  .mm-glass:hover::after{opacity:1}.mm-glass>*{position:relative;z-index:1}
  .mm-t:hover,.mm-kpi:hover{transform:perspective(900px) translateY(-6px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));box-shadow:0 26px 48px -18px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.4);border-color:rgba(255,255,255,.32)}
  .mm-hd:hover,.mm-caja:hover{transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
  .mm-t.rojo{border-top-color:rgba(255,107,97,.8)}.mm-t.rojo::before{background:radial-gradient(circle,rgba(255,107,97,.45),transparent 66%)}
  .mm-t.ambar{border-top-color:rgba(243,184,82,.75)}.mm-t.ambar::before{background:radial-gradient(circle,rgba(243,184,82,.42),transparent 66%)}
  .mm-t.azul{border-top-color:rgba(100,170,255,.75)}.mm-t.azul::before{background:radial-gradient(circle,rgba(100,170,255,.4),transparent 66%)}
  .mm-caja{border-top-color:rgba(255,255,255,.4)}.mm-caja::before{display:none}
  @keyframes mmOrbe{to{transform:translate(-26px,22px) scale(1.2)}}
  /* usa el 100% de la pantalla disponible: sin tope de ancho, la columna de la derecha crece con la pantalla y la lista llena el alto */
  .mm{min-height:calc(100vh - 40px)}.mm-cuerpo{min-height:calc(100vh - 380px)}
  .mm-lista{grid-template-columns:repeat(auto-fill,minmax(clamp(280px,17vw,380px),1fr))}
  @media(max-width:1180px){.mm-cuerpo{min-height:0}}
  @media(prefers-reduced-motion:reduce){.mm::before,.mm::after,.mm-glass::before,.mm-t,.mm-sw i{animation:none!important}.mm-glass{transform:none!important}}`;
  document.head.appendChild(css);

  const api = async (url, opciones) => {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opciones, headers: { 'Content-Type': 'application/json' } });
    let d = null; try { d = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No se pudo completar la acción');
    return d;
  };
  const hora = iso => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const coincide = t => filtro === 'todas' || (filtro === 'atencion' && ['pedir', 'error', 'sin_proveedor', 'sin_effi', 'revisar'].includes(t.estado)) || t.estado === filtro;
  const PESO = { pedir: 0, error: 1, sin_proveedor: 2, sin_effi: 3, revisar: 4, en_camino: 5, ok: 6 };
  const ordenar = lista => lista.slice().sort((a, b) => orden === 'nombre' ? a.tela.localeCompare(b.tela) : orden === 'pedir' ? b.pedir - a.pedir : orden === 'faltante' ? (a.stock / a.minimo) - (b.stock / b.minimo) : (PESO[a.estado] - PESO[b.estado]) || a.tela.localeCompare(b.tela));

  function tarjeta(t, i) {
    const [txt, tono] = ESTADO[t.estado] || ['—', ''];
    const tope = Math.max(t.maximo, t.stock + (t.por_recibir || 0), 1) * 1.08;
    const pct = v => Math.max(0, Math.min(100, v / tope * 100)).toFixed(1);
    const aviso = ['error', 'sin_effi', 'revisar'].includes(t.estado) && t.nota ? '<div class="mm-nota">' + esc(t.nota) + '</div>' : '';   // el resto de estados ya se entiende con la etiqueta
    return '<article class="mm-glass mm-t ' + tono + '" style="animation-delay:' + Math.min(i * 25, 300) + 'ms"><h4><span>' + esc(t.tela) + '<small>' + esc(t.codigo) + ' · ' + esc(t.proveedor || 'SIN PROVEEDOR') + '</small></span><em>' + txt + '</em></h4>' +
      '<div class="mm-medidor" title="Hay ' + num(t.stock) + ' · mínimo ' + num(t.minimo) + ' · máximo ' + num(t.maximo) + '"><span class="mm-zona" style="width:' + pct(t.minimo) + '%"></span><span class="mm-zona ok" style="left:' + pct(t.minimo) + '%;width:' + (pct(t.maximo) - pct(t.minimo)).toFixed(1) + '%"></span>' +
      (t.pedir || t.por_recibir ? '<s style="left:' + pct(t.stock) + '%;width:' + (pct(t.stock + (t.por_recibir || 0) + (t.pedir || 0)) - pct(t.stock)).toFixed(1) + '%"></s>' : '') +
      '<i style="--w:' + pct(t.stock) + '%"></i><q style="left:' + pct(t.stock) + '%"></q>' +
      '<u style="left:' + pct(t.minimo) + '%"><b>mín ' + num(t.minimo) + '</b></u><u style="left:' + pct(t.maximo) + '%"><b>máx ' + num(t.maximo) + '</b></u></div>' +
      '<div class="mm-stats"><div><small>HAY</small><b data-n="' + t.stock + '">' + num(t.stock) + '</b></div><div><small>MÍNIMO</small><b data-n="' + t.minimo + '">' + num(t.minimo) + '</b></div><div><small>MÁXIMO</small><b data-n="' + t.maximo + '">' + num(t.maximo) + '</b></div><div><small>EN CAMINO</small><b>' + num(t.por_recibir || 0) + '</b></div></div>' +
      '<div class="mm-fila"><span>' + (t.pedir ? 'Quedaría en <b>' + num(t.stock + (t.por_recibir || 0) + t.pedir) + '</b> mts (' + Math.round((t.stock + (t.por_recibir || 0) + t.pedir) / Math.max(t.maximo, 1) * 100) + '% del máx.)' : '<b>' + Math.round(t.stock / Math.max(t.maximo, 1) * 100) + '%</b> del máximo') + '</span>' + (t.pedir ? '<span class="mm-pedir">pedir <b>' + num(t.pedir) + '</b> mts</span>' : '') + '</div>' + aviso + '</article>';
  }

  function ocHtml(c) {
    const e = c.envio_proveedor || {};
    if (c.estado === 'error') return '<div class="mm-glass mm-oc error"><b>' + esc(c.tela) + '</b><div class="mm-nums"><span>' + num(c.metros) + ' mts</span><span>ERROR ' + (c.intentos || 0) + '/3</span></div><div class="mm-nota">' + esc(c.detalle) + '</div></div>';
    if (c.estado !== 'creada') return '<div class="mm-glass mm-oc"><b>' + esc(c.tela) + '</b><div class="mm-nums"><span>' + num(c.metros) + ' mts</span><span>creando…</span></div></div>';
    const cab = '<b>' + esc(c.tela) + '</b><div class="mm-nums"><span>' + num(c.metros) + ' mts · OC <b>' + esc(c.oc) + '</b></span><span>' + hora(c.creada || c.creado) + '</span></div>';
    if (e.estado === 'enviada') return '<div class="mm-glass mm-oc">' + cab + '<div class="mm-nota">✔ Enviada · ' + esc(e.por) + ' · ' + hora(e.at) + '</div><button type="button" class="mm-b" data-mm-prov="' + c.id + '" data-otra="1" data-oc="' + esc(c.oc) + '">Reenviar</button></div>';
    return '<div class="mm-glass mm-oc espera">' + cab + '<div class="mm-nota">Para ' + esc(c.proveedor || 'el proveedor') + '</div><button type="button" class="mm-b ok" data-mm-prov="' + c.id + '" data-oc="' + esc(c.oc) + '">✉ APROBAR Y ENVIAR</button></div>';
  }

  function pintar() {
    if (!panel || !datos) return;
    const foco = document.activeElement;
    if (foco && foco.matches && foco.matches('[data-mm-buscar]') && panel.contains(foco)) { pintarLista(); return; }   // no se redibuja todo mientras se escribe en el buscador
    const a = datos.agente, r = datos.resumen, activo = !!a.activo, compras = datos.compras || [];
    const esperan = compras.filter(c => c.estado === 'creada' && (c.envio_proveedor || {}).estado !== 'enviada');
    const nAtencion = r.pedir + (r.error || 0) + r.sin_proveedor + r.sin_effi;
    const cuenta = { atencion: nAtencion, en_camino: r.en_camino, ok: r.ok, todas: r.telas };
    const kpi = (k, n, rotulo, tono) => '<button type="button" class="mm-glass mm-kpi' + (filtro === k ? ' on' : '') + '" data-mm-filtro="' + k + '" data-lq="' + (r.telas ? Math.round(n / r.telas * 100) : 0) + '" data-lq-tone="' + tono + '" data-lq-nopct><b>' + n + '</b><span>' + rotulo + '</span></button>';
    const resto = compras.filter(c => !esperan.includes(c));
    panel.querySelector('.mm').innerHTML =
      '<header class="mm-glass mm-hd"><div><h2>MINIMAXIMAN</h2><div class="mm-sub">Telas entre su mínimo y su máximo · revisado ' + hora(a.ultima) + '</div></div>' +
      '<div class="mm-ctl"><div class="mm-sw' + (activo ? ' on' : '') + '"><i></i><span>' + (activo ? 'ACTIVO' : 'APAGADO') + '</span><button type="button" data-mm-activar="' + (activo ? 0 : 1) + '" aria-label="Activar o apagar MINIMAXIMAN"></button></div>' +
      '<button type="button" class="mm-b" data-mm-revisar' + (ocupado ? ' disabled' : '') + '>↻ ' + (ocupado ? 'REVISANDO…' : 'REVISAR') + '</button></div></header>' +
      (a.error ? '<div class="mm-vacio">' + esc(a.error) + '</div>' : '') +
      '<div class="mm-kpis">' + kpi('atencion', nAtencion, 'ATENCIÓN', 'rojo') + kpi('en_camino', r.en_camino, 'EN CAMINO', 'azul') + kpi('ok', r.ok, 'EN RANGO', 'verde') + kpi('todas', r.telas, 'TELAS', 'gris') + '</div>' +
      '<div class="mm-cuerpo"><div class="mm-glass mm-barra"><input type="search" data-mm-buscar placeholder="Buscar…" value="' + esc(buscar) + '" autocomplete="off">' +
      '<select data-mm-orden aria-label="Ordenar">' + [['estado', 'Urgentes primero'], ['pedir', 'Más por pedir'], ['faltante', 'Más cerca de cero'], ['nombre', 'A-Z']].map(o => '<option value="' + o[0] + '"' + (orden === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      (esperan.length ? '<h3 class="mm-tit">ESPERAN TU APROBACIÓN <em>' + esperan.length + '</em></h3><div class="mm-lista">' + esperan.map(ocHtml).join('') + '</div>' : '') +
      '<div class="mm-lista-host"></div>' +
      (resto.length ? '<details class="mm-ant"><summary>ÓRDENES ANTERIORES (' + resto.length + ')</summary><div class="mm-lista">' + resto.map(ocHtml).join('') + '</div></details>' : '') + '</div>';
    pintarLista();
    panel.querySelectorAll('.mm-stats b[data-n]').forEach(e => { const n = +e.dataset.n; if (!n || e.dataset.v === e.dataset.n) return; e.dataset.v = e.dataset.n; const t0 = performance.now(); (function paso(t) { const k = Math.min(1, (t - t0) / 700); e.textContent = num(Math.round(n * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(paso); })(t0); });
    if (window.liquidStats && window.liquidStats.refresh) window.liquidStats.refresh(panel);
  }

  function pintarLista() {
    const host = panel.querySelector('.mm-lista-host'); if (!host || !datos) return;
    const q = plano(buscar);
    const lista = ordenar(datos.telas.filter(t => coincide(t) && (!q || plano(t.tela + ' ' + t.codigo + ' ' + t.proveedor).includes(q))));
    host.innerHTML = lista.length ? '<div class="mm-lista">' + lista.map(tarjeta).join('') + '</div>' : '<div class="mm-vacio">' + (datos.resumen.telas ? 'No hay telas con ese filtro.' : 'Ninguna tela tiene stock mínimo y máximo todavía: se anotan en INFORMACIÓN TELA.') + '</div>';
  }

  async function cargar() {
    try {
      const nuevo = await api('/api/minimaximan/estado');
      const f = JSON.stringify(nuevo);
      if (f === firma && datos) return;   // sin cambios: no se redibuja
      firma = f; datos = nuevo; pintar();
    } catch (e) { if (panel) panel.querySelector('.mm').innerHTML = '<div class="mm-vacio">' + esc(e.message) + '</div>'; }
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="minimaximan"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'minimaximan';
    panel.innerHTML = '<div class="mm"><div class="mm-vacio">Cargando…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="minimaximan" type="button"><span class="nav-icon">MM</span><strong>MINIMAXIMAN</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      firma = ''; cargar(); clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 15000);
    });
    const marcar = () => document.body.classList.toggle('mm-modo', panel.classList.contains('active'));
    new MutationObserver(marcar).observe(panel, { attributes: true, attributeFilter: ['class'] }); marcar();
    let inclinar = 0;
    panel.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const c = e.target.closest('.mm-glass'); if (!c || inclinar) return;
      inclinar = requestAnimationFrame(() => {
        inclinar = 0; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height, grande = r.width > 600;   // el encabezado y las cajas anchas casi no se inclinan
        c.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        c.style.setProperty('--ry', ((x - .5) * (grande ? 1.5 : 7)).toFixed(2) + 'deg'); c.style.setProperty('--rx', ((.5 - y) * (grande ? 1 : 5)).toFixed(2) + 'deg');
      });
    });
    panel.addEventListener('pointerout', e => { const c = e.target.closest && e.target.closest('.mm-glass'); if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); } });
    panel.addEventListener('input', e => { if (e.target.matches('[data-mm-buscar]')) { buscar = e.target.value; pintarLista(); } });
    panel.addEventListener('change', e => { if (e.target.matches('[data-mm-orden]')) { orden = e.target.value; recordar(); pintar(); } });
    panel.addEventListener('click', async e => {
      const f = e.target.closest('[data-mm-filtro]'); if (f) { filtro = f.dataset.mmFiltro; recordar(); pintar(); return; }
      const r = e.target.closest('[data-mm-revisar]');
      if (r && !ocupado) { ocupado = true; pintar(); try { await api('/api/minimaximan/revisar', { method: 'POST' }); } catch (x) { alert(x.message); } ocupado = false; firma = ''; await cargar(); return; }
      const p = e.target.closest('[data-mm-prov]');
      if (p) {
        const otra = !!p.dataset.otra;
        if (!confirm((otra ? 'Esta orden ya se envió. ¿Enviarla otra vez' : '¿Aprobar y enviar la orden de compra ' + (p.dataset.oc || '')) + ' al correo del proveedor?\nEl proveedor recibirá el mensaje de Indoor Sport con el número de la orden, la tela y los metros.')) return;
        p.disabled = true;
        try { await api('/api/minimaximan/enviar-proveedor', { method: 'POST', body: JSON.stringify({ id: Number(p.dataset.mmProv), otra_vez: otra }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar(); return;
      }
      const s = e.target.closest('[data-mm-activar]');
      if (s) {
        const quiere = s.dataset.mmActivar === '1';
        if (quiere && !confirm('¿Activar MINIMAXIMAN?\n\nCuando una tela baje de su stock mínimo, MINIMAXIMAN creará él mismo la orden de compra en Effi (con el proveedor de INFORMACIÓN TELA y la llave de la API), sin pedirte permiso. La orden solo se enviará al proveedor cuando tú la apruebes.')) return;
        try { await api('/api/minimaximan/activar', { method: 'PUT', body: JSON.stringify({ activo: quiere }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar();
      }
    });
    return true;
  }

  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-minimaximan');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-minimaximan'; boton.textContent = 'MINIMAXIMAN';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;
    const previo = document.getElementById('open-zeus');
    if (previo) previo.insertAdjacentElement('afterend', boton);
    else menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/minimaximan/estado', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;   // solo las cuentas con acceso al agente de inventario
    let intentos = 0;
    const espera = setInterval(() => { if (construir()) ponerEnMenu(); if (++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso: no se muestra */ });
})();
