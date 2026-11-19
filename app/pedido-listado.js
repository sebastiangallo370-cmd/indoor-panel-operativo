(() => {
  // LISTADO DEL PEDIDO (EMPEZAR PEDIDO): al crear la cotización en Effi se muestra aquí su réplica; con «Continuar con el listado» el comercial adjunta los mockups, llena el
  // listado (nombre, talla, número, diseño, género y observación de cada prenda) y lo programa en Producción (POST /api/pedido-effi/programar → el programar pedido de siempre).
  if (window.PedidoListado) return;
  // Toda llamada al servidor tiene límite de tiempo: si la NAS o el servidor no responden, la pantalla no se queda cargando
  const fetchT = (url, opts) => {
    const lento = /programar|leer-archivo|crear|vista-previa|excel|sincron/.test(String(url));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), lento ? 180000 : 45000);
    return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })).finally(() => clearTimeout(t));
  };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const MAX_DISENOS = 20, MAX_BYTES = 10 * 1024 * 1024;
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
  .pl-acciones{position:sticky;top:8px;z-index:30;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#0b0f09;box-shadow:0 10px 24px rgba(0,0,0,.55)}
  .pl-acciones .pl-btn{width:auto!important;flex:0 0 auto!important;min-width:200px;min-height:42px;padding:10px 22px;white-space:nowrap}.pl-acciones .pl-msg,.pl-acciones [data-msg]{flex:1 1 220px;min-width:0;margin:0}
  .pl-msg{flex:1 1 260px;font:700 13px/1.45 Arial;color:#a9b5a3;white-space:pre-line}.pl-msg.error{color:#ff9b9b}.pl-msg.ok{color:#bff26a}
  /* réplica de la cotización: la misma hoja que imprime Effi (se ve igual en computador y en celular; en celular se reduce para que quepa) */
  .pl-hoja-caja{width:100%;max-width:820px;margin:0 auto;overflow:hidden}
  ${HOJA_CSS}
  .pl-pdf-caja{max-width:1100px}
  .pl-pdf-estado{display:flex;flex-direction:column;align-items:center;gap:10px;padding:46px 20px;border:1px dashed rgba(208,244,76,.45);border-radius:16px;background:rgba(208,244,76,.05);text-align:center}
  .pl-pdf-estado b{font:900 15px Arial}.pl-pdf-estado small{color:#a9b5a3;font:600 12px/1.5 Arial;max-width:460px}.pl-pdf-acc{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px}
  .pl-spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(208,244,76,.25);border-top-color:#d0f44c;animation:plgira 1s linear infinite}@keyframes plgira{to{transform:rotate(360deg)}}
  .pl-pdf-barra{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 4px;font:800 12px Arial;color:#c9d3c1}.pl-pdf-barra a{text-decoration:none;display:inline-flex;align-items:center}
  .pl-pdf{display:grid;gap:12px;justify-items:center;max-height:calc(100vh - 300px);overflow:auto;padding:4px}.pl-pdf-hoja{display:block;width:100%;max-width:1000px;image-rendering:auto;height:auto;background:#fff;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.4)}
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
  .pl-ref{width:auto!important;flex:0 0 auto!important;min-width:150px;min-height:38px;display:inline-flex!important;align-items:center;justify-content:center;gap:8px;padding:8px 16px;border-radius:12px;border:1px solid #3d4c3b;background:#142017;color:#f5faef;cursor:pointer;font:800 12px Arial;white-space:nowrap}.pl-ref.on{border-color:#d0f44c;background:#1d3321}
  .pl-cont{padding:2px 8px;border-radius:99px;margin-left:8px;font:900 11px Arial;background:#5a2323;color:#ffb4a2}.pl-cont.ok{background:#1d4a1d;color:#bff26a}
  .pl-tabla{width:100%;border-collapse:separate;border-spacing:0 4px}.pl-tabla th{font:800 10px Arial;letter-spacing:.08em;color:#a9b5a3;text-align:left;padding:2px 4px;position:sticky;top:0;background:#101a12;z-index:2}
  .pl-tabla td{padding:0 3px}.pl-tabla td.n{width:34px;color:#8f9d88;font:700 12px Arial;text-align:right}.pl-tabla input,.pl-tabla select{min-height:34px}
  .pl-tabla .bad{border-color:#ff7b7b!important;background:#2a1414!important}
  .pl-x{all:unset;cursor:pointer;color:#ff9b9b;font:900 16px Arial;padding:6px}
  .pl-ag{margin-left:auto;padding:6px 12px;border-radius:99px;border:1px solid #3d4c3b;color:#a9b5a3;font:800 11px Arial;white-space:nowrap}.pl-ag-abrir{margin-left:8px;padding:4px 10px;border-radius:99px;border:1px solid #b9e03a;background:#d0f44c;color:#0d140e;font:900 10px Arial;cursor:pointer;width:auto!important;min-height:0!important}.pl-ag.ok{border-color:#6f9410;color:#9be37a}.pl-ag.mal{border-color:#ffb547;color:#ffb547;background:rgba(255,181,71,.08)}
  .pl-herr{display:flex;flex-wrap:nowrap;gap:8px;align-items:flex-end;margin-bottom:10px;overflow-x:auto}.pl-herr label{min-width:130px;flex:0 0 auto}.pl-herr .pl-btn{width:auto!important;flex:0 0 auto!important;white-space:nowrap;min-height:38px;padding:8px 14px}
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
    .pl-acciones{position:sticky;top:6px;z-index:30;box-shadow:0 8px 18px rgba(0,0,0,.45);padding:8px 10px;gap:6px}.pl-acciones .pl-btn{width:auto!important;flex:1 1 42%!important;min-width:0!important;min-height:28px!important;padding:3px 8px!important;font-size:9px}.pl-acciones p,.pl-acciones [data-msg]{flex:1 1 100%;font-size:12px;margin:0}
    .pl-slots{grid-template-columns:1fr!important}.pl-herr{flex-wrap:wrap}.pl-herr .pl-btn{flex:1 1 45%!important}
  }
  @media(max-width:900px){.pl{height:auto}.pl-tabla{min-width:720px}.pl-cuerpo{overflow:visible}.pl-tabla-caja{overflow:auto}}
  @media(max-width:700px){
    .pl,.pl *{text-align:center}.pl h1{font-size:14px}.pl h3{font-size:11px}.pl label{font-size:8.5px;letter-spacing:.05em;justify-items:center}
    .pl input,.pl select,.pl textarea{font-size:12px!important;text-align:center;text-align-last:center}.pl input,.pl select{min-height:28px;height:30px}
    .pl-btn{font-size:9px!important;min-height:26px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;text-align:center}
    .pl-pdf{max-height:none}.pl-pdf-barra{justify-content:center}
    .pl-pasos{justify-content:center}.pl-paso{font-size:10px;padding:4px 8px}.pl-refs{justify-content:center}.pl-herr{justify-content:center;flex-wrap:wrap}.pl-herr label{min-width:110px}
    .pl-tabla input,.pl-tabla select{min-height:28px!important;height:30px;font-size:12px!important}.pl-tabla td[data-l]::before{text-align:center}
    .pl-slot{justify-items:center;align-items:center}.pl-slot>div{justify-content:center}.pl-msg{font-size:12px;text-align:center}
    .pl-acciones{justify-content:center}
  }
  @media(max-width:700px){
    /* listado en móvil: cada prenda es una tarjeta clara, con campos grandes y el número y la X en las esquinas */
    .pl-tabla tr{padding:34px 12px 12px!important;gap:10px!important}
    .pl-tabla td.n{position:absolute!important;top:9px!important;left:14px!important;right:auto!important;width:auto!important;font:900 11px Arial!important;letter-spacing:.1em;color:#d0f44c!important;text-align:left!important}
    .pl-tabla td.n::before{content:'PRENDA '}
    .pl-tabla td:last-child{top:3px!important;right:6px!important}.pl-tabla .pl-x{width:34px!important;height:34px!important;min-height:0!important;padding:0!important;border-radius:10px}
    .pl-tabla td[data-l]::before{font-size:10px!important;margin-bottom:4px!important;text-align:left!important}
    .pl-tabla input,.pl-tabla select{min-height:46px!important;height:46px!important;font-size:16px!important;border-radius:12px!important;text-align:left!important;text-align-last:left!important;padding:0 12px!important}
    .pl-tabla input::placeholder{font-size:15px;opacity:.55}
    .pl-herr{display:grid!important;grid-template-columns:1fr 1fr;gap:8px!important}.pl-herr .pl-btn{width:100%!important;min-height:44px!important;font-size:11px!important;padding:8px 6px!important;white-space:normal!important}.pl-herr label{min-width:0!important}
    .pl-herr [data-mas],.pl-herr [data-pegar]{grid-column:1/-1}
    .pl-acciones{flex-direction:column;align-items:stretch!important;gap:8px!important;padding:10px 12px calc(10px + env(safe-area-inset-bottom))!important}
    .pl-acciones .pl-btn{flex:0 0 auto!important;width:100%!important;min-height:48px!important;font-size:13px!important;letter-spacing:.04em;padding:10px 12px!important;white-space:normal!important;line-height:1.25}
    .pl-acciones .pl-btn:not(.sec){order:-1}
    .pl-acciones p,.pl-acciones [data-msg]{font-size:13px!important;text-align:center}
  }
  /* ===== PROGRAMANDO EL PEDIDO: anillo de avance, línea de tiempo y animaciones ===== */
  .pg{position:relative;max-width:1000px;margin:6px auto 0;padding:26px 22px 22px;border-radius:26px;border:1px solid rgba(208,244,76,.28);background:linear-gradient(160deg,rgba(20,32,23,.92),rgba(8,12,9,.96));overflow:hidden;isolation:isolate;box-shadow:0 22px 60px rgba(0,0,0,.5)}
  .pg-aura{position:absolute;inset:-40%;z-index:-1;background:conic-gradient(from 0deg,rgba(208,244,76,.0),rgba(208,244,76,.22),rgba(110,231,183,.14),rgba(208,244,76,.0) 60%);filter:blur(60px);animation:pgAura 14s linear infinite;opacity:.9}
  @keyframes pgAura{to{transform:rotate(360deg)}}
  .pg-cab{text-align:center;display:grid;gap:4px;animation:pgEntra .6s cubic-bezier(.2,.8,.2,1) both}
  @keyframes pgEntra{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .pg-eye{font:900 12px Arial;letter-spacing:.32em;color:#d0f44c;transition:color .4s}
  .pg-cod{margin:0;font:900 clamp(38px,7vw,62px)/1 Arial;letter-spacing:.02em;color:#f5faef;text-shadow:0 0 34px rgba(208,244,76,.28)}
  .pg-sub{margin:2px 0 0;font:700 13px Arial;color:#9db094;letter-spacing:.04em}
  .pg-cuerpo{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:30px;align-items:center;margin-top:20px}
  .pg-anillo{position:relative;width:min(260px,64vw);aspect-ratio:1;margin:0 auto;animation:pgEntra .7s .1s cubic-bezier(.2,.8,.2,1) both}
  .pg-anillo svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
  .pg-pista{fill:none;stroke:rgba(255,255,255,.09);stroke-width:7}
  .pg-arco{fill:none;stroke:url(#pgGrad);stroke-width:7;stroke-linecap:round;transition:stroke-dashoffset .9s cubic-bezier(.3,.7,.2,1),stroke .4s;filter:drop-shadow(0 0 7px rgba(208,244,76,.65))}
  .pg-brillo{fill:none;stroke:rgba(255,255,255,.85);stroke-width:7;stroke-linecap:round;stroke-dasharray:3 97;animation:pgBarrido 2.2s linear infinite;filter:blur(1.2px)}
  @keyframes pgBarrido{to{stroke-dashoffset:-100}}
  .pg-centro{position:absolute;inset:0;display:grid;place-content:center;text-align:center;font-family:Arial;transition:opacity .3s,transform .4s}
  .pg-centro b{font:900 clamp(46px,9vw,68px)/1 Arial;color:#f5faef;font-variant-numeric:tabular-nums}.pg-centro span{font:900 18px Arial;color:#d0f44c;margin-top:-2px}
  .pg-orbita{position:absolute;inset:0;animation:pgGira 2.6s linear infinite;pointer-events:none}.pg-orbita i{position:absolute;left:50%;top:-5px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#e6ff7a;box-shadow:0 0 14px 4px rgba(208,244,76,.8)}
  @keyframes pgGira{to{transform:rotate(360deg)}}
  .pg-ico{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transform:scale(.4);pointer-events:none}
  .pg-ico svg{width:46%;fill:none;stroke:#d0f44c;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:60;stroke-dashoffset:60}
  .pg-ico b{font:900 90px Arial;color:#ff8f8f}
  .pg-onda{position:absolute;inset:0;border-radius:50%;border:2px solid #d0f44c;opacity:0;pointer-events:none}
  .pg-confeti{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}.pg-confeti i{position:absolute;left:-4px;top:-4px;width:8px;height:14px;border-radius:2px;background:var(--c);opacity:0;transform:rotate(var(--a)) translateY(0)}
  .pg.ok .pg-orbita,.pg.mal .pg-orbita,.pg.ok .pg-brillo,.pg.mal .pg-brillo{display:none}
  .pg.ok .pg-centro{opacity:0;transform:scale(.7)}.pg.mal .pg-centro{opacity:.0}
  .pg.ok .pg-ico{opacity:1;transform:scale(1);transition:opacity .35s,transform .55s cubic-bezier(.3,1.6,.4,1)}.pg.ok .pg-ico svg{animation:pgTrazo .6s .25s ease-out forwards}
  @keyframes pgTrazo{to{stroke-dashoffset:0}}
  .pg.ok .pg-arco{stroke:#d0f44c}.pg.ok .pg-eye{color:#d0f44c}
  .pg.festejo .pg-onda{animation:pgOnda 1.4s ease-out}.pg.festejo .pg-onda.b{animation-delay:.25s}
  @keyframes pgOnda{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}
  .pg.festejo .pg-confeti i{animation:pgConfeti 1.6s cubic-bezier(.15,.7,.3,1) forwards}
  @keyframes pgConfeti{0%{opacity:1;transform:rotate(var(--a)) translateY(0) rotate(0)}70%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateY(calc(var(--d) * -1.5)) rotate(var(--r))}}
  .pg.mal .pg-arco{stroke:#ff7b7b;filter:drop-shadow(0 0 7px rgba(255,123,123,.6))}.pg.mal .pg-eye{color:#ff9b9b}
  .pg.mal .pg-ico{opacity:1;transform:scale(1);transition:opacity .3s,transform .4s cubic-bezier(.3,1.6,.4,1)}
  .pg.sacude .pg-anillo{animation:pgSacude .6s}
  @keyframes pgSacude{20%,60%{transform:translateX(-9px)}40%,80%{transform:translateX(9px)}}
  .pg-info{display:grid;gap:16px;min-width:0}
  .pg-actual{display:grid;gap:4px;padding:16px 18px;border-radius:18px;border:1px solid rgba(208,244,76,.3);background:linear-gradient(120deg,rgba(208,244,76,.12),rgba(208,244,76,.03));position:relative;overflow:hidden}
  .pg-actual::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.1) 50%,transparent 70%);transform:translateX(-100%);animation:pgBrillo 2.8s ease-in-out infinite}
  @keyframes pgBrillo{60%,100%{transform:translateX(100%)}}
  .pg.ok .pg-actual::after,.pg.mal .pg-actual::after{display:none}
  .pg-actual small{font:900 10px Arial;letter-spacing:.3em;color:#d0f44c}
  .pg-actual b{font:900 clamp(18px,3.2vw,24px)/1.2 Arial;color:#f5faef}.pg-actual b.cambia{animation:pgCambia .45s cubic-bezier(.2,.8,.2,1)}
  @keyframes pgCambia{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .pg-actual span{font:600 13px/1.45 Arial;color:#b6c4ad}
  .pg.mal .pg-actual{border-color:rgba(255,123,123,.45);background:linear-gradient(120deg,rgba(255,123,123,.14),rgba(255,123,123,.03))}.pg.mal .pg-actual small{color:#ff9b9b}
  .pg-pasos{list-style:none;margin:0;padding:0;display:grid;gap:3px;position:relative}
  .pg-pasos li{display:flex;align-items:center;gap:12px;padding:7px 8px;border-radius:12px;font:700 13px Arial;color:#6d7a68;animation:pgEntra .5s cubic-bezier(.2,.8,.2,1) both;transition:color .3s,background .3s}
  .pg-pasos li em{font-style:normal}
  .pg-p{position:relative;flex:none;width:26px;height:26px;border-radius:50%;border:2px solid #36432f;display:grid;place-items:center;transition:background .35s,border-color .35s,transform .35s}
  .pg-p svg{width:15px;fill:none;stroke:#10200a;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:pgTrazo .45s .05s ease-out forwards}
  .pg-pasos li.hecho{color:#dfe9d6}.pg-pasos li.hecho .pg-p{background:#d0f44c;border-color:#d0f44c;animation:pgPop .45s cubic-bezier(.3,1.6,.4,1)}
  @keyframes pgPop{0%{transform:scale(.6)}100%{transform:scale(1)}}
  .pg-pasos li.activo{color:#f5faef;background:rgba(208,244,76,.08)}.pg-pasos li.activo .pg-p{border-color:#d0f44c}
  .pg-p i{width:10px;height:10px;border-radius:50%;background:#d0f44c;animation:pgLate 1s ease-in-out infinite}
  .pg-pasos li.activo .pg-p::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(208,244,76,.5);animation:pgOndaP 1.4s ease-out infinite}
  @keyframes pgLate{50%{transform:scale(.55);opacity:.6}}
  @keyframes pgOndaP{from{opacity:.9;transform:scale(.7)}to{opacity:0;transform:scale(1.35)}}
  .pg-avisos{display:grid;gap:8px;margin-top:18px;max-width:760px;margin-left:auto;margin-right:auto}
  .pg-aviso{padding:11px 14px;border-radius:12px;font:700 12.5px/1.45 Arial;border:1px solid rgba(255,255,255,.14);color:#c9d3c1;background:rgba(255,255,255,.04);animation:pgEntra .4s both}
  .pg-aviso.ok{border-color:rgba(191,242,106,.45);color:#bff26a}.pg-aviso.mal{border-color:rgba(255,123,123,.5);color:#ff9b9b}.pg-aviso.esp{border-color:rgba(208,244,76,.3)}
  .pg-descarga{justify-self:center;display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:99px;background:#d0f44c;color:#142017;font:900 12px Arial;letter-spacing:.06em;text-decoration:none;box-shadow:0 8px 22px rgba(208,244,76,.25);transition:transform .2s}.pg-descarga:hover{transform:translateY(-2px)}.pg-descarga small{font-weight:700;opacity:.75}
  @media(max-width:760px){.pg{padding:20px 14px 16px;border-radius:20px}.pg-cuerpo{grid-template-columns:1fr;gap:20px}.pg-anillo{width:min(210px,58vw)}.pg-pasos li{font-size:12.5px}}
  /* ocupa TODA la pantalla disponible, sin scroll: las medidas salen del alto de la ventana */
  .pl-cuerpo:has(>.pg){overflow:hidden;display:flex}
  .pg{flex:1;min-height:0;width:100%;max-width:none;margin:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;padding:clamp(10px,2.2vh,26px) clamp(12px,2vw,30px)}
  .pg-cuerpo{min-height:0;margin-top:0;align-content:center;justify-content:center;grid-template-columns:minmax(0,auto) minmax(0,560px);gap:clamp(18px,5vw,70px)}
  .pg-anillo{width:min(46vh,34vw,380px)}
  .pg-cod{font-size:clamp(32px,7.5vh,66px)}.pg-actual{padding:clamp(10px,2vh,18px) 18px}.pg-info{gap:clamp(8px,1.8vh,16px)}
  .pg-pasos li{padding:clamp(3px,.8vh,7px) 8px}.pg-avisos{margin-top:clamp(6px,1.4vh,14px);gap:6px}.pg-aviso{padding:8px 12px}
  @media(max-height:700px){.pg-eye{font-size:10px}.pg-sub{font-size:11px}.pg-pasos li{font-size:12px}.pg-p{width:22px;height:22px}}
  @media(max-width:900px){.pl-cuerpo:has(>.pg){overflow:visible;display:block}.pg{display:block;padding:12px 12px 10px}.pg-cuerpo{grid-template-columns:1fr;gap:10px;margin-top:8px}.pg-anillo{width:min(36vw,150px)}.pg-cod{font-size:34px}.pg-centro b{font-size:34px}.pg-centro span{font-size:13px}
    .pg-actual{padding:9px 12px}.pg-actual b{font-size:16px}.pg-actual span{font-size:12px}.pg-pasos{grid-template-columns:1fr 1fr;gap:2px 8px}.pg-pasos li{padding:3px 4px;font-size:11px;gap:7px}.pg-p{width:20px;height:20px}.pg-p svg{width:11px}.pg-avisos{margin-top:8px}.pg-descarga{padding:9px 14px}}
  .pg-cuerpo{margin-top:clamp(8px,1.8vh,16px)}.pg-brillo{opacity:.55}
  @media(max-width:900px){.pg-cuerpo{margin-top:8px}.pg-anillo{width:min(32vw,128px)}.pg-cod{font-size:30px}.pg-eye{font-size:10px;letter-spacing:.24em}.pg-sub{font-size:11px}
    .pg-pasos{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin-top:2px}.pg-pasos li{padding:0;background:none!important;gap:0}.pg-pasos li em{display:none}.pg-p{width:22px;height:22px}
    .pl:has(.pg) .pl-acciones{flex-direction:row!important;flex-wrap:wrap;justify-content:center;position:static!important;padding:8px!important;gap:8px!important;box-shadow:none!important}
    .pl:has(.pg) .pl-acciones .pl-btn{flex:1 1 40%!important;min-height:42px!important;font-size:12px!important;padding:6px 8px!important;width:auto!important}}
  .pl-btn[hidden],.pl-acciones [hidden]{display:none!important}.pg-anillo .pg-ico svg{transform:none;width:46%;height:auto}
  /* botones más pequeños en la pantalla de programar */
  .pl:has(.pg) .pl-acciones{padding:6px 10px;gap:8px}
  .pl:has(.pg) .pl-acciones .pl-btn{min-width:0!important;min-height:32px!important;padding:6px 16px!important;font-size:11px!important;letter-spacing:.06em}
  .pg-descarga{padding:7px 14px;font-size:10.5px;box-shadow:0 5px 14px rgba(208,244,76,.2)}.pg-descarga small{font-size:9.5px}
  @media(max-width:900px){.pl:has(.pg) .pl-acciones .pl-btn{flex:0 1 auto!important;min-height:34px!important;padding:6px 14px!important;font-size:11px!important}.pg-descarga{padding:7px 12px;font-size:10px}}
  @media(prefers-reduced-motion:reduce){.pg *,.pg{animation-duration:.01s!important;animation-iteration-count:1!important}.pg-aura{display:none}}
  `;
  document.head.appendChild(css);

  window.addEventListener('resize', () => ajustarHoja());
  const L = {};   // estado del flujo (uno por ventana abierta)
  let raiz = null;
  let ULTIMO = null;   // lo último que se llenó en el listado (se recupera al volver al documento y regresar)
  const q = s => raiz.querySelector(s);

  // ---------------------------------------------------------------- datos
  const PH = 'SIN REFERENCIA';
  const hayReferencias = () => (L.doc.conceptos || []).some(c => String(c.referencia || '').trim());
  const grupos = () => {
    const m = new Map();
    (L.doc.conceptos || []).forEach(c => {
      const ref = String(c.referencia || '').trim().toUpperCase(); if (!ref) return;
      const g = m.get(ref) || { referencia: ref, descripcion: c.descripcion || ref, cantidad: 0 };
      g.cantidad += num(c.cantidad); m.set(ref, g);
    });
    // sin conceptos todavía: el listado sale completo igual (tabla, filas, proyecto y mockups del proyecto)
    if (!m.size) return [{ referencia: PH, descripcion: 'Sin referencia', cantidad: 1 }];
    return [...m.values()];
  };
  const claveBorrador = () => 'pedidoListado:' + (L.doc.prefijo || '') + L.doc.numero + (L.doc.numero === 'PREVIO' ? '|' + claveDocumento() : '');
  const datosRef = ref => { const d = (L.refDatos || {})[ref] || {}; return { proyecto: d.proyecto != null ? d.proyecto : (L.proyecto || ''), linea: d.linea != null ? d.linea : (L.linea || ''), textura: d.textura || '', tipos: Array.isArray(d.tipos) ? d.tipos : [] }; };
  function guardarBorrador() {
    try {
      const galeria = {};
      Object.entries(L.galPick || {}).forEach(([ref, lista]) => { galeria[ref] = lista.filter(pk => pk.url).map(pk => ({ idx: pk.idx, url: pk.url, nombre: pk.nombre })); });
      localStorage.setItem(claveBorrador(), JSON.stringify({ disenos: L.disenos, proyecto: L.proyecto, linea: L.linea, observaciones: L.observaciones, listado: L.listado, refDatos: L.refDatos || {}, textura: L.textura, tipos: L.tipos || [], defGenero: L.defGenero, defDiseno: L.defDiseno, galeria }));
    } catch (e) { /* sin almacenamiento */ } }
  function cargarBorrador() {
    try {
      const b = JSON.parse(localStorage.getItem(claveBorrador()) || 'null');
      if (b && b.listado) Object.assign(L, { disenos: b.disenos || 1, proyecto: b.proyecto || L.proyecto, linea: b.linea || '', observaciones: b.observaciones || '', listado: b.listado, refDatos: b.refDatos || {}, textura: b.textura || L.textura, tipos: b.tipos || [], defGenero: b.defGenero || L.defGenero, defDiseno: b.defDiseno || L.defDiseno });
      L.galGuardada = (b && b.galeria) || {};
    } catch (e) { /* borrador dañado */ }
  }
  // vuelve a bajar los mockups elegidos (guardados por su dirección) para que el listado quede como lo dejaste
  async function restaurarMockups() {
    const guardada = L.galGuardada || {};
    L.galGuardada = {};
    for (const ref of Object.keys(guardada)) {
      for (const it of guardada[ref]) {
        try {
          const r = await fetchT(it.url, { credentials: 'same-origin' }); if (!r.ok) continue;
          const b = await r.blob();
          const ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const lista = galPick()[ref] = galPick()[ref] || [];
          if (lista.some(pk => pk.nombre === it.nombre)) continue;   // ya está: restaurar dos veces NO debe duplicar el mockup
          lista.push({ idx: it.idx, url: it.url, nombre: it.nombre, file: new File([b], ref + '_D' + (lista.length + 1) + '.' + ext, { type: b.type || 'image/jpeg' }) });
        } catch (e) { /* ese mockup se vuelve a elegir */ }
      }
      sincronizar(ref);
    }
    dibujar();
  }
  const filaVacia = () => ({ nombre: '', talla: '', numero: '', diseno: L.defDiseno || 1, genero: L.defGenero || 'MASC', observacion: '' });
  const filasDe = ref => (L.listado[ref] = L.listado[ref] || []);
  const faltantes = () => {   // lo que impide programar: se muestra completo, no uno por uno
    const out = [];
    const mkFalta = slotsNecesarios().filter(([r, n]) => !imagenDe(r, n));
    if (mkFalta.length) out.push('Faltan mockups de: ' + [...new Set(mkFalta.map(x => x[0]))].join(', '));
    grupos().forEach(g => {
      const f = filasDe(g.referencia);
      if (!String(datosRef(g.referencia).proyecto || '').trim()) out.push(g.referencia + ': escribe el NOMBRE DEL PROYECTO');
      if (!datosRef(g.referencia).textura) out.push(g.referencia + ': elige si lleva APLIQUE (SÍ o NO)');
      else if (datosRef(g.referencia).textura === 'SI' && !datosRef(g.referencia).tipos.length) out.push(g.referencia + ': elige el tipo de aplique');
      if (f.length !== g.cantidad) out.push(g.referencia + ': la cotización dice ' + g.cantidad + ' prendas y el listado tiene ' + f.length + (f.length < g.cantidad ? ' (faltan ' + (g.cantidad - f.length) + ')' : ' (sobran ' + (f.length - g.cantidad) + ')'));
      const sinTalla = f.filter(x => !String(x.talla || '').trim()).length, sinGen = f.filter(x => !x.genero).length;
      if (sinTalla) out.push(g.referencia + ': ' + sinTalla + ' prenda(s) sin talla');
      if (sinGen) out.push(g.referencia + ': ' + sinGen + ' prenda(s) sin género');
    });
    return out;
  };
  // cada referencia pide SUS diseños: los que eligió (mínimo 1). Así una referencia con 1 mockup no exige los de otra con 4.
  const slotsNecesarios = () => {
    const s = [];
    if (L.compartir) { for (let n = 1; n <= L.disenos; n++) s.push(['*', n]); return s; }
    grupos().forEach(g => { const k = Math.max(1, (galPick()[g.referencia] || []).length); for (let n = 1; n <= k; n++) s.push([g.referencia, n]); });
    return s;
  };
  const imagenDe = (ref, n) => (L.imgs[ref] || {})[n];
  const mockupsCompletos = () => slotsNecesarios().every(([r, n]) => imagenDe(r, n));

  // ---------------------------------------------------------------- estructura
  const PASOS = [['doc', '1 · COTIZACIÓN'], ['mockups', '2 · MOCKUPS'], ['listado', '3 · LISTADO']];
  function barra() {
    if (L.previo) return '<div class="pl-barra"><div class="pl-pasos"><span class="pl-paso on">LISTADO PREVIO</span></div><span style="color:#a9b5a3;font:700 12px Arial">Llénalo ahora: queda guardado y pasa solo al listado cuando crees la cotización · ' + esc((L.doc.cliente || {}).nombre || 'sin cliente') + '</span></div>';
    const orden = ['doc', 'mockups', 'listado', 'enviado'], i = orden.indexOf(L.pantalla);
    return '<div class="pl-barra"><div class="pl-pasos">' + PASOS.map(([k, t], j) => '<span class="pl-paso ' + (j === i ? 'on' : j < i ? 'hecho' : '') + '">' + t + '</span>').join('') + '</div><span style="color:#a9b5a3;font:700 12px Arial">' + esc((L.doc.tipo === 'remision' ? 'Remisión ' : 'Cotización ') + (L.doc.numero_completo || L.doc.numero)) + ' · ' + esc((L.doc.cliente || {}).nombre) + '</span></div>';
  }
  // redibujar NO debe saltar la pantalla arriba: se conserva el desplazamiento de la ventana, de la galería y de las listas
  function dibujar() { conservarVista(dibujarBase); }
  function dibujarBase() {
    // la lista de proyectos es del CLIENTE del documento: se pide al abrir y de nuevo si cambia el cliente
    const clienteDoc = (L.doc.cliente && L.doc.cliente.nombre) || '';
    if (clienteDoc && L.proyCliente !== clienteDoc) { L.proyCliente = clienteDoc; L.proyLista = undefined; L.proyCargando = true; cargarProyLista(); }
    if (!raiz.dataset.datosPedido) {   // proyecto y línea: un solo manejador para toda la ventana
      raiz.dataset.datosPedido = '1';
      raiz.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-ref-proyecto]')) { const ref = e.target.dataset.ref; L.refDatos = L.refDatos || {}; L.refDatos[ref] = Object.assign({}, datosRef(ref), { proyecto: e.target.value }); guardarBorrador(); estadoListado(); } });
      raiz.addEventListener('change', e => { if (e.target.matches && e.target.matches('[data-ref-proy-sel]')) { const ref = e.target.dataset.ref, v = e.target.value; L.refDatos = L.refDatos || {}; L.refDatos[ref] = v === '__nuevo' ? Object.assign({}, datosRef(ref), { proyecto: '', nuevo: true }) : Object.assign({}, datosRef(ref), { proyecto: v, nuevo: false }); guardarBorrador(); dibujar(); estadoListado(); if (v && v !== '__nuevo' && ref && ref !== PH) abrirGaleria(ref); else dibujar(); } });   // al elegir el proyecto se traen sus mockups de esta referencia
      raiz.addEventListener('change', e => { if (e.target.matches && e.target.matches('[data-ref-linea]')) { const ref = e.target.dataset.ref; L.refDatos = L.refDatos || {}; L.refDatos[ref] = Object.assign({}, datosRef(ref), { linea: e.target.value }); guardarBorrador(); estadoListado(); } });
    }
    if (!raiz.dataset.galeriaPedido) {
      raiz.dataset.galeriaPedido = '1';
      raiz.addEventListener('click', e => {
        const modoBtn = e.target.closest && e.target.closest('[data-gal-modo]');
        if (modoBtn) { L.galVista = modoBtn.dataset.galModo; conservarVista(dibujar); return; }
        const g = e.target.closest && e.target.closest('[data-galeria]');
        const pg = e.target.closest && e.target.closest('[data-prog-ref]'); if (pg) { toggleElegido(pg.dataset.progRef, pg.dataset.progCarpeta, pg.dataset.progArchivo); return; }
        if (g) { abrirGaleria(g.dataset.galeria); return; }
        const it = e.target.closest && e.target.closest('[data-gal-item]');
        if (it) elegirMaestro(it.dataset.galRef, it.dataset.galItem);
      });
    }
    const p = L.pantalla;
    raiz.innerHTML = '<div class="pl">' + barra() + '<div class="pl-acciones" data-acciones></div><div class="pl-cuerpo" data-cuerpo></div></div>';   // botones ARRIBA y fijos: se ven aunque se baje
    // Botón con X para cerrar el listado (usa la misma acción de cierre que el resto de la ventana)
    const barraPl = raiz.querySelector('.pl-barra');
    if (barraPl && L.opts && L.opts.onCerrar) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'pl-btn sec mini'; x.setAttribute('data-x-cerrar', ''); x.title = 'Cerrar'; x.setAttribute('aria-label', 'Cerrar');
      x.style.cssText = 'display:inline-flex!important;align-items:center;justify-content:center;flex:0 0 34px!important;width:34px!important;min-width:34px!important;height:34px!important;min-height:34px!important;padding:0!important;margin:0 0 0 auto!important;border-radius:50%!important;background:rgba(255,255,255,.08)!important;border:1px solid rgba(255,255,255,.22)!important;color:#f4f7fa!important;cursor:pointer';
      x.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
      x.onclick = () => L.opts.onCerrar();
      barraPl.appendChild(x);
    }
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
      const r = await fetchT('/api/pedido-effi/pdf-estado/' + numero, { credentials: 'same-origin', cache: 'no-store' }).then(x => x.ok ? x.json() : Promise.reject(new Error('Error ' + x.status)));
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
      '<div class="pl-tarjeta"><h3>' + esc(titulo) + '</h3>' + (L.compartir ? gs.map(g => cabeceraRef(g.referencia, false)).join('') : cabeceraRef(ref, true)) + '<div class="pl-slots">' + Array.from({ length: L.disenos }, (_, i) => slotHtml(ref, i + 1)).join('') + '</div></div>').join('');
    q('[data-cuerpo]').innerHTML = '<div class="pl-tarjeta"><h3>Datos del pedido · mockups obligatorios</h3><div class="pl-grid">' +
      '<label>Número de diseños *<select data-disenos>' + Array.from({ length: MAX_DISENOS }, (_, i) => '<option value="' + (i + 1) + '"' + (i + 1 === L.disenos ? ' selected' : '') + '>' + (i + 1) + '</option>').join('') + '</select></label></div>' +
      '<label style="margin-top:12px">Observaciones del pedido<textarea data-obs placeholder="Opcional: llega a la tarjeta de Producción">' + esc(L.observaciones) + '</textarea></label>' +
      (varias ? '<label style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-top:12px;font:700 13px Arial;letter-spacing:0"><input type="checkbox" data-compartir ' + (L.compartir ? 'checked' : '') + ' style="width:auto;min-height:0"> Usar los mismos mockups en todas las referencias (' + gs.map(g => esc(g.referencia)).join(', ') + ')</label>' : '') + '</div>' + bloques +
      '<div style="margin:10px 0"><button class="pl-btn sec" type="button" data-mas-mockup' + (L.disenos >= MAX_DISENOS ? ' disabled' : '') + '>+ AGREGAR MÁS MOCKUPS</button> <small style="color:#888">Cada clic agrega un diseño más (hasta ' + MAX_DISENOS + ').</small></div>';
    acciones('<button class="pl-btn sec" type="button" data-atras>◀ VOLVER A LA COTIZACIÓN</button><button class="pl-btn" type="button" data-sigue>CONTINUAR AL LISTADO ▶</button>', '', '');
    actualizarMockups();
    q('[data-obs]').oninput = e => { L.observaciones = e.target.value; guardarBorrador(); };
    q('[data-disenos]').onchange = e => { L.disenos = Number(e.target.value); guardarBorrador(); dibujar(); };
    q('[data-mas-mockup]').onclick = () => { if (L.disenos < MAX_DISENOS) { L.disenos++; guardarBorrador(); dibujar(); } };
    const comp = q('[data-compartir]'); if (comp) comp.onchange = () => { L.compartir = comp.checked; dibujar(); };
    q('[data-atras]').onclick = () => { L.pantalla = 'doc'; dibujar(); };
    q('[data-sigue]').onclick = () => { L.pantalla = 'listado'; L.abierta = L.abierta || (grupos()[0] || { referencia: '' }).referencia; dibujar(); };
    enlazarSlots(raiz);
  }
  function opcionesProyecto(ref) {
    const d = datosRef(ref), lista = L.proyLista || [];
    const nuevo = !!((L.refDatos || {})[ref] || {}).nuevo || (!!d.proyecto && lista.length > 0 && !lista.includes(d.proyecto));
    return '<option value="">' + (L.proyCargando ? 'Cargando proyectos…' : 'Seleccionar…') + '</option>' +
      lista.map(x => '<option' + (x === d.proyecto && !nuevo ? ' selected' : '') + '>' + esc(x) + '</option>').join('') +
      '<option value="__nuevo"' + (nuevo ? ' selected' : '') + '>+ Proyecto nuevo (escribir)…</option>';
  }
  function proyectoCampo(ref) {
    const d = datosRef(ref), lista = L.proyLista || [];
    const nuevo = !!((L.refDatos || {})[ref] || {}).nuevo || (!!d.proyecto && lista.length > 0 && !lista.includes(d.proyecto));
    return '<label>NOMBRE DEL PROYECTO *<select data-ref-proy-sel data-ref="' + esc(ref) + '">' + opcionesProyecto(ref) + '</select>' +
      '<input data-ref-proyecto data-ref="' + esc(ref) + '" value="' + esc(d.proyecto) + '" placeholder="Nombre del proyecto nuevo" style="margin-top:6px' + (nuevo ? '' : ';display:none') + '"></label>';
  }
  // un mockup está seleccionado si su referencia (p. ej. FUT02) ya está en el documento (A200FUT02)
  // referencia completa del documento que corresponde al mockup (FUT02 -> A200FUT02), o '' si no está
  const refDocDe = base => {
    const k = String(base || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!k) return '';
    const c = (L.doc.conceptos || []).find(x => String(x.referencia || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().endsWith(k));
    return c ? String(c.referencia).trim().toUpperCase() : '';
  };
  const seleccionadoEn = base => !!refDocDe(base);
  // referencia completa de la orden del proyecto para ese mockup (FUT02 -> A100FUT02), o ''
  const refOrdenDe = base => {
    const k = String(base || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const lista = (L.galProy && L.galProy.ordenes) || [];
    const coincide = r => r.replace(/[^A-Z0-9]/g, '').endsWith(k) || (r.includes('-') && r.split('-').map(x => x.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^A\d+/, '')).join('') === k);
    return k ? (lista.find(coincide) || '') : '';
  };
  // mockups de TODO el proyecto elegido (sin referencias): se cargan una vez por proyecto
  function galeriaProyectoHtml(pr) {
    if (!pr) return '<p style="color:#a9b5a3">Elige el proyecto para ver sus mockups.</p>';
    const g = L.galProy;
    if (!g || g.proyecto !== pr || g.items === null) { cargarGaleriaProyecto(pr); return '<p style="color:#a9b5a3">Cargando mockups de ' + esc(pr) + '…</p>'; }
    if (!g.items.length) return '<p style="color:#ffb4a2;font:800 13px Arial">' + esc(g.motivo || ('El proyecto ' + pr + ' no tiene mockups todavía.')) + '</p>';
    const cliente = (L.doc.cliente && L.doc.cliente.nombre) || '';
    // VISTA PREVIA: solo los mockups seleccionados; VOLVER A SELECCIONAR: todos otra vez para elegir
    const modo = L.galVista === 'seleccion' ? 'seleccion' : 'todos';
    const mostrar = modo === 'seleccion' ? g.items.filter(i => mockupDoc(i.ref, i.archivo)) : g.items;
    // botones de solo icono (el texto queda en el título)
    const bt = (attr, activo, icono, texto) => '<button type="button" ' + attr + ' title="' + texto + '" aria-label="' + texto + '" style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border-radius:999px;border:1px solid ' + (activo ? '#d0f44c' : '#2e4a35') + ';background:' + (activo ? '#d0f44c' : '#14231a') + ';color:' + (activo ? '#0b120d' : '#d7e6cf') + ';font:900 16px Arial;line-height:1;cursor:pointer"><span aria-hidden="true">' + icono + '</span></button>';
    const av = avisoGaleria ? '<div style="margin:0 0 8px;font:800 12px Arial;line-height:1.35;color:' + (avisoGaleria.tipo === 'error' ? '#ffb4a2' : '#d0f44c') + '">' + esc(avisoGaleria.t) + '</div>' : '';
    const barra = av + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px">' + bt('data-gal-modo="seleccion"', modo === 'seleccion', '◉', 'VISTA PREVIA') + bt('data-gal-modo="todos"', modo === 'todos', '↺', 'VOLVER A SELECCIONAR') + '</div>';
    if (!mostrar.length) return barra + '<p style="color:#a9b5a3">Todavía no hay mockups seleccionados: toca «VOLVER A SELECCIONAR» y elige.</p>';
    return barra + '<div data-gal-grid style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-height:620px;overflow-y:auto;padding:4px 2px">' + mostrar.map(i => '<figure data-prog-ref="' + esc(i.ref) + '" data-prog-carpeta="' + esc(i.carpeta) + '" data-prog-archivo="' + esc(i.archivo) + '" title="' + (mockupDoc(i.ref, i.archivo) ? 'Tocar para quitar este diseño' : 'Tocar para agregar al documento') + '" style="margin:0;min-width:0;cursor:pointer;position:relative;outline:' + (mockupDoc(i.ref, i.archivo) ? '3px solid #d0f44c' : 'none') + '"> ' + (mockupDoc(i.ref, i.archivo) ? '<span style="position:absolute;top:8px;left:8px;z-index:2;text-align:center;background:#d0f44c;color:#0b120d;border-radius:999px;width:26px;height:26px;line-height:26px;font:800 14px Arial">✓</span>' : '') + '<img loading="lazy" alt="' + esc(i.ref + ' D' + i.diseno) + '" style="width:100%;height:auto;object-fit:contain;border-radius:8px;display:block" src="/api/pedido-effi/mockup-img?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(i.proyecto || pr) + '&carpeta=' + encodeURIComponent(i.carpeta) + '&archivo=' + encodeURIComponent(i.archivo) + '&w=560"><figcaption style="font:800 12px Arial;color:#d0f44c;margin-top:4px">' + esc(refDocDe(i.ref) || refOrdenDe(i.ref) || i.ref) + ' · D' + i.diseno + '</figcaption></figure>').join('') + '</div>';
  }
  async function cargarGaleriaProyecto(pr) {
    const cliente = (L.doc.cliente && L.doc.cliente.nombre) || '';
    L.galProy = { proyecto: pr, items: null };
    try {
      const [r, ro] = await Promise.all([
        fetchT('/api/pedido-effi/mockups-proyecto?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(pr), { credentials: 'same-origin' }),
        fetchT('/api/pedido-effi/ordenes-referencia?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(pr), { credentials: 'same-origin' }).catch(() => null)
      ]);
      const j = await r.json().catch(() => ({}));
      const jo = ro ? await ro.json().catch(() => ({})) : {};
      if (!L.galProy || L.galProy.proyecto !== pr) return;   // ya se eligió otro proyecto
      L.galProy.items = Array.isArray(j.items) ? j.items : [];
      L.galProy.motivo = j.motivo || '';
      L.galProy.ordenes = (jo.ordenes || []).map(o => o.referencia);
    } catch (e) { if (L.galProy && L.galProy.proyecto === pr) L.galProy.items = []; }
    dibujar();
  }
  // al redibujar la ventana no se pierde el desplazamiento (ni el de la galería de mockups)
  function conservarVista(fn) {
    const movs = []; let n = raiz;
    while (n && n.nodeType === 1) { if (n.scrollTop) movs.push([n, n.scrollTop]); n = n.parentElement; }
    const gAntes = raiz.querySelector('[data-gal-grid]'), gt = gAntes ? gAntes.scrollTop : 0;
    const y = window.scrollY;
    fn();
    movs.forEach(([el, t]) => { el.scrollTop = t; });
    window.scrollTo(0, y);
    const gDespues = raiz.querySelector('[data-gal-grid]'); if (gDespues) gDespues.scrollTop = gt;
  }
  // tocar un mockup lo agrega al documento de inmediato; si tocas varios seguidos, se agregan en fila (una cola)
  let colaAgregar = Promise.resolve();
  let avisoGaleria = null;   // lo que pasó con el último mockup tocado (se ve encima de la galería)
  // cada MOCKUP (referencia + archivo) se elige por separado: el de la misma referencia con otro D# es OTRO diseño de esa pestaña
  const mockupDoc = (base, archivo) => { const rd = refDocDe(base); return rd && (galPick()[rd] || []).find(pk => pk.nombre === archivo) ? rd : ''; };
  function toggleElegido(base, carpeta, archivo) {
    const rd = mockupDoc(base, archivo);
    if (rd) { colaAgregar = colaAgregar.then(() => quitarDiseno(rd, archivo)); return; }   // tocar otra vez ese mockup lo quita
    colaAgregar = colaAgregar.then(() => agregarMockup(base, carpeta, archivo));
  }
  // quita de la pestaña el diseño de ese mockup; si era el último de la referencia, también quita la referencia del documento
  async function quitarDiseno(rd, archivo) {
    const lista = galPick()[rd] || [];
    const pos = lista.findIndex(pk => pk.nombre === archivo);
    if (pos >= 0) lista.splice(pos, 1);
    sincronizar(rd);
    if (!lista.length && window.PedidoEffi && window.PedidoEffi.quitarReferencia) {
      window.PedidoEffi.guardarListado();
      window.PedidoEffi.quitarReferencia(rd);
      L.doc.conceptos = window.PedidoEffi.conceptosListado();
    }
    avisoGaleria = { t: rd + ': mockup quitado.', tipo: '' };
    guardarBorrador(); dibujar();
  }
  // agrega el mockup como diseño de su referencia (la siguiente pestaña D# de esa referencia), sin volver a abrir el listado
  async function agregarDisenoMockup(rd, carpeta, archivo) {
    const pr = String(datosRef(PH).proyecto || '').trim() || String(L.proyecto || '');
    const cliente = (L.doc.cliente && L.doc.cliente.nombre) || '';
    const url = '/api/pedido-effi/mockup-img?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(pr) + '&carpeta=' + encodeURIComponent(carpeta) + '&archivo=' + encodeURIComponent(archivo);
    const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error('la NAS no entregó la imagen (' + r.status + ')');
    const b = await r.blob();
    const lista = galPick()[rd] = galPick()[rd] || [];
    // GUARDIA: comprobado DESPUÉS de bajar la imagen (dos clics seguidos en el mismo mockup no pueden quedar como dos diseños)
    if (lista.some(pk => pk.nombre === archivo)) return;
    lista.push({ idx: null, url, nombre: archivo, file: new File([b], rd + '_D' + (lista.length + 1) + '.jpg', { type: b.type || 'image/jpeg' }) });
    sincronizar(rd);
  }
  async function quitarMockup(base) {
    if (!window.PedidoEffi || !window.PedidoEffi.quitarReferencia) { avisoGaleria = { t: 'No pude conectar con CO/RM.', tipo: 'error' }; return dibujar(); }
    avisoGaleria = { t: 'Quitando ' + base + ' del documento…', tipo: '' }; dibujar();
    try {
      window.PedidoEffi.guardarListado();   // guarda lo llenado antes de cambiar las referencias
      const r = window.PedidoEffi.quitarReferencia(base);
      if (r.no) { avisoGaleria = { t: base + ' ya no está en el documento.', tipo: '' }; return dibujar(); }
      L.doc.conceptos = window.PedidoEffi.conceptosListado();
      guardarBorrador();
      avisoGaleria = { t: r.ref + ' quitado del documento.', tipo: 'ok' };
      dibujar();
    } catch (e) { avisoGaleria = { t: 'No pude quitar ' + base + ': ' + (e.message || e), tipo: 'error' }; dibujar(); }
  }
  async function agregarMockup(base, carpeta, archivo) {
    if (!window.PedidoEffi || !window.PedidoEffi.agregarReferencia) { avisoGaleria = { t: 'No pude conectar con CO/RM.', tipo: 'error' }; return dibujar(); }
    const pr = String(datosRef(PH).proyecto || '').trim();
    avisoGaleria = { t: 'Agregando ' + base + ' al documento…', tipo: '' }; dibujar();
    try {
      window.PedidoEffi.guardarListado();   // guarda lo llenado en el listado antes de cambiar las referencias
      const r = await window.PedidoEffi.agregarReferencia(base, pr);
      let msg = r.ref + ' agregado al documento.', tipo = 'ok';
      if (r.sinCliente) { msg = 'Elige primero el cliente en CO/RM.'; tipo = 'error'; }
      else if (r.sinProyecto) { msg = 'Elige primero el NOMBRE DEL PROYECTO.'; tipo = 'error'; }
      else if (r.sinHistorial) { msg = base + ': no hay una orden de este proyecto con esa referencia.'; tipo = 'error'; }
      else if (r.no) { msg = (r.ref || base) + ' no está en Effi: hay que crear ese artículo primero.'; tipo = 'error'; }
      else if (r.ya) { msg = r.ref + ' ya estaba en el documento.'; }
      L.doc.conceptos = window.PedidoEffi.conceptosListado();   // se actualiza en sitio: NO se vuelve a abrir el listado (eso reiniciaba la galería)
      if (r.ref && pr && !String(datosRef(r.ref).proyecto || '').trim()) { L.refDatos = L.refDatos || {}; L.refDatos[r.ref] = Object.assign({}, datosRef(r.ref), { proyecto: pr, nuevo: false }); }
      const rd = (r.ok || r.ya) ? refDocDe(base) : '';   // el mockup va como DISEÑO de su referencia (misma pestaña)
      if (rd) {
        await agregarDisenoMockup(rd, carpeta, archivo);
        msg = archivo + ' → diseño ' + (galPick()[rd] || []).length + ' de ' + rd + (r.ya ? '' : ' (referencia agregada al documento)');
        tipo = 'ok';
      }
      guardarBorrador();
      avisoGaleria = { t: msg, tipo };
      dibujar();
    } catch (e) { avisoGaleria = { t: 'No pude agregar ' + base + ': ' + (e.message || e), tipo: 'error' }; dibujar(); }
  }
  async function cargarProyLista() {
    const cliente = (L.doc.cliente && L.doc.cliente.nombre) || '';
    let lista = [], motivo = '';
    try {
      for (let intento = 0; intento < 8; intento++) {   // la NAS puede tardar en listar: el servidor responde «pendiente»
        const r = await fetchT('/api/pedido-effi/proyectos?cliente=' + encodeURIComponent(cliente), { credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (L.proyCliente !== cliente) return;   // ya se eligió otro cliente
        if (!j.pendiente) { lista = Array.isArray(j.proyectos) ? j.proyectos.slice() : []; motivo = j.motivo || ''; break; }
        await new Promise(ok => setTimeout(ok, 1500));
      }
    } catch (e) { lista = []; }
    if (L.proyCliente !== cliente) return;
    L.proyLista = lista; L.proyCargando = false;
    if (!lista.length && motivo) setMsg(motivo, 'error');   // el comercial ve en el panel por qué no hay proyectos (cliente no encontrado en la NAS)
    // solo se actualizan las opciones: no se vuelve a dibujar la pantalla (así un desplegable abierto no se cierra)
    document.querySelectorAll('[data-ref-proy-sel]').forEach(sel => { if (sel.isConnected && raiz && raiz.contains(sel)) sel.innerHTML = opcionesProyecto(sel.dataset.ref); });
  }
  function enlazarSlots(scope) {
  scope.querySelectorAll('[data-slot]').forEach(el => {
    const [ref, n] = el.dataset.slot.split('|'), f = imagenDe(ref, Number(n)), inp = el.querySelector('[data-file]');
    if (f) { const im = el.querySelector('[data-prev]'); if (im) im.src = URL.createObjectURL(f); }
    el.querySelector('[data-elegir]').onclick = () => inp.click();
    const quitar = el.querySelector('[data-quitar]'); if (quitar) quitar.onclick = () => { (galPick()[ref] || []).splice(Number(n) - 1, 1); sincronizar(ref); dibujar(); };
    inp.onchange = () => {
      const a = inp.files[0]; if (!a) return;
      if (!/^image\//.test(a.type)) { setMsg('«' + a.name + '» no es una imagen.', 'error'); return; }
      if (a.size > MAX_BYTES) { setMsg('«' + a.name + '» pesa más de 10 MB.', 'error'); return; }
      (galPick()[ref] = galPick()[ref] || []).push({ idx: null, file: a }); sincronizar(ref); dibujar();
    };
  });
  }
  const galPick = () => (L.galPick = L.galPick || {});
  // los diseños son los mockups elegidos, en orden: 1, 2, 3… (sin huecos)
  function sincronizar(ref) {
    // quita duplicados (mismo archivo dos veces) que ya estuvieran guardados en el borrador: cada mockup cuenta UNA vez
    const lista = galPick()[ref] = (galPick()[ref] || []).filter((pk, i, arr) => !pk.nombre || arr.findIndex(x => x.nombre === pk.nombre) === i);
    L.imgs[ref] = {};
    lista.forEach((pk, k) => { L.imgs[ref][k + 1] = pk.file; });
    ajustarDisenos();
    guardarBorrador();
  }
  // número de diseños = cuántos mockups hay elegidos (en la referencia que más tenga)
  function ajustarDisenos() {
    let max = 1;
    grupos().forEach(g => { max = Math.max(max, (galPick()[g.referencia] || []).length); });
    L.disenos = max;
  }
  function panelMockupsListado(ref) {
    if (!ref) return '';
    if (ref === PH) return '<div class="pl-tarjeta"><h3>MOCKUPS DEL PROYECTO</h3>' + galeriaProyectoHtml(datosRef(PH).proyecto) + '</div>';
    const slots = Array.from({ length: L.disenos }, (_, i) => i + 1).filter(n => !imagenDe(ref, n)).map(n => slotHtml(ref, n)).join('');
    const elegidos = (galPick()[ref] || []).map((pk, k) => '<div style="display:inline-block;width:96px;margin:0 8px 8px 0;vertical-align:top"><img src="' + esc(URL.createObjectURL(pk.file)) + '" alt="D' + (k + 1) + '" style="width:96px;height:128px;object-fit:contain;border-radius:8px;background:#0b120d;border:2px solid #d0f44c;display:block"><small style="color:#d0f44c;font:800 11px Arial">DISEÑO ' + (k + 1) + '</small></div>').join('');
    return '<div class="pl-tarjeta"><h3>MOCKUPS DEL PROYECTO · TOCA UNO PARA AGREGARLO</h3>' + galeriaProyectoHtml(datosRef(ref).proyecto) + '<h3>MOCKUPS · ' + esc(ref) + '</h3>' +
      '<div style="margin:0 0 8px"><button class="pl-btn sec mini" type="button" data-galeria="' + esc(ref) + '">VER MOCKUPS DE MAESTROS</button></div>' +
      (elegidos ? '<div style="margin:0 0 8px">' + elegidos + '</div>' : '') + galeriaHtml(ref) + '<div class="pl-slots">' + slots + '</div></div>';
  }
  function layoutListado() {
    const cuerpo = q('[data-cuerpo]'); if (!cuerpo) return;
    if (!document.getElementById('pl-dos-css')) {
      const st = document.createElement('style'); st.id = 'pl-dos-css';
      st.textContent = '.pl-dos{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr);gap:14px;align-items:start}.pl-der{position:sticky;top:8px;min-width:0}.pl-izq{min-width:0}@media (max-width:900px){.pl-dos{grid-template-columns:1fr}.pl-der{position:static}}.pl-izq .pl-herr{flex-wrap:wrap!important;overflow:visible!important}.pl-izq .pl-herr label{min-width:0}.pl-dos button:focus{outline:none!important}.pl-izq .pl-aplique{flex-wrap:nowrap!important;min-width:0}.pl-izq .pl-aplique [data-tipos]{min-width:170px!important}@media (max-width:700px){.pl-izq .pl-aplique{flex-wrap:wrap!important}}@media (min-width:901px){.pl-der [data-gal-grid]{max-height:calc(100vh - 190px)!important;min-height:420px}}';
      document.head.appendChild(st);
    }
    cuerpo.classList.add('pl-dos');
    const izq = document.createElement('div'); izq.className = 'pl-izq';
    while (cuerpo.firstChild) izq.appendChild(cuerpo.firstChild);
    const der = document.createElement('aside'); der.className = 'pl-der';
    der.innerHTML = panelMockupsListado(L.abierta);
    cuerpo.appendChild(izq); cuerpo.appendChild(der);
    enlazarSlots(der);
  }
  function cabeceraRef(ref, conGaleria) {
    const d = datosRef(ref);
    return '<div class="pl-grid" style="margin:0 0 10px">' + proyectoCampo(ref) +
      '<label>LÍNEA DEL PRODUCTO<select data-ref-linea data-ref="' + esc(ref) + '"><option value="">—</option>' + (L.cat.lineas || []).map(x => '<option' + (x === d.linea ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label></div>' +
      (conGaleria ? '<div style="margin:0 0 8px"><button class="pl-btn sec mini" type="button" data-galeria="' + esc(ref) + '">VER MOCKUPS DE MAESTROS</button></div>' + galeriaHtml(ref) : '');
  }
  function galeriaHtml(ref) {
    const items = ((L.galItems || {})[ref]) || [];
    if (!(L.galOpen || {})[ref]) return '';
    if (!items.length) return '<p style="color:#c9d6c2;font:700 12px Arial;margin:6px 0">No hay mockups de ' + esc(ref) + ' en este proyecto.</p>';
    return '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:8px 0">' + items.map((it, i) =>
      '<button type="button" data-gal-ref="' + esc(ref) + '" data-gal-item="' + i + '" style="position:relative;width:100%;min-width:0;border:1px solid #3d4c3b;border-radius:10px;background:#17201a;padding:6px;cursor:pointer;text-align:left;outline:none">' +
      '<span style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;border:2px solid #d0f44c;background:' + ((galPick()[ref] || []).some(pk => pk.idx === i) ? '#d0f44c' : 'rgba(0,0,0,.45)') + ';box-shadow:0 0 0 2px rgba(0,0,0,.35);pointer-events:none"></span>' +
      '<img src="' + esc(it.url) + '" alt="' + esc(it.nombre) + '" loading="lazy" style="width:100%;height:auto;aspect-ratio:3/4;object-fit:contain;border-radius:6px;display:block;background:#0b120d">' +
      '<small style="color:#c9d6c2;font:700 10px Arial;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">D' + it.diseno + ' · ' + esc(it.nombre) + '</small></button>').join('') + '</div>';
  }
  async function abrirGaleria(ref) {
    const pr = String(datosRef(ref).proyecto || '').trim(), cliente = (L.doc.cliente && L.doc.cliente.nombre) || '';
    if (!pr) { setMsg('Escribe el NOMBRE DEL PROYECTO de ' + ref + ' para ver sus mockups.', 'error'); return; }
    setMsg('Buscando mockups de ' + ref + ' en MAESTROS…', '');
    try {
      const r = await fetchT('/api/pedido-effi/mockups?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(pr) + '&ref=' + encodeURIComponent(ref), { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'MAESTROS no respondió');
      L.galItems = L.galItems || {}; L.galOpen = L.galOpen || {};
      L.galItems[ref] = (j.items || []).map(i => ({ url: '/api/pedido-effi/mockup-img?cliente=' + encodeURIComponent(cliente) + '&proyecto=' + encodeURIComponent(i.proyecto || pr) + '&carpeta=' + encodeURIComponent(i.carpeta) + '&archivo=' + encodeURIComponent(i.archivo), nombre: i.archivo, diseno: Number(i.diseno) || 1 }));
      L.galOpen[ref] = true;
      setMsg(L.galItems[ref].length ? 'Elige el mockup de ' + ref + '.' : 'No hay mockups de ' + ref + ' en el proyecto ' + pr + '.', L.galItems[ref].length ? 'ok' : 'error');
      dibujar();
    } catch (e) { setMsg('No pude traer los mockups: ' + (e.message || e), 'error'); }
  }
  async function elegirMaestro(ref, idx) {
    const i = Number(idx), it = ((L.galItems || {})[ref] || [])[i]; if (!it) return;
    const lista = galPick()[ref] = galPick()[ref] || [];
    const pos = lista.findIndex(pk => pk.idx === i);
    if (pos >= 0) { lista.splice(pos, 1); sincronizar(ref); setMsg('Mockup quitado de ' + ref + '.', ''); dibujar(); return; }
    if (lista.length >= MAX_DISENOS) { setMsg('Ya hay ' + MAX_DISENOS + ' diseños en ' + ref + '.', 'error'); return; }
    setMsg('Cargando ' + it.nombre + '…', '');
    try {
      const r = await fetch(it.url, { credentials: 'same-origin' }); if (!r.ok) throw new Error('la NAS no entregó la imagen (' + r.status + ')');
      const b = await r.blob();
      const ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      lista.push({ idx: i, url: it.url, nombre: it.nombre, file: new File([b], ref + '_D' + (lista.length + 1) + '.' + ext, { type: b.type || 'image/jpeg' }) });
      sincronizar(ref);
      setMsg(it.nombre + ' → diseño ' + lista.length + ' de ' + ref + '.', 'ok');
      dibujar();
    } catch (e) { setMsg('No pude cargar el mockup: ' + (e.message || e), 'error'); }
  }
  function actualizarMockups() {
    const falta = slotsNecesarios().filter(([r, n]) => !imagenDe(r, n)).length, ok = falta === 0 && grupos().every(g => String(datosRef(g.referencia).proyecto || '').trim());   // los mockups son OBLIGATORIOS: se eligen aquí, antes del listado y de programar
    const b = q('[data-sigue]'); if (b) b.disabled = !ok;
    const sinProy = grupos().filter(g => !String(datosRef(g.referencia).proyecto || '').trim()).map(g => g.referencia);
    setMsg(sinProy.length ? 'Falta el NOMBRE DEL PROYECTO de: ' + sinProy.join(', ') + '.' : falta ? 'Faltan ' + falta + ' mockup(s): selecciónalos para continuar.' : 'Mockups completos ✓', ok ? 'ok' : 'error');
  }

  // ---------------------------------------------------------------- 3) listado
  function contador(g) { const n = filasDe(g.referencia).length; return '<span class="pl-cont ' + (n === g.cantidad ? 'ok' : '') + '" data-cont="' + esc(g.referencia) + '">' + n + ' / ' + g.cantidad + '</span>'; }
  // la talla puede ser una que no está en la lista (5XL, 18, 3-4…): se escribe con «＋ OTRA TALLA…» y queda disponible para las demás filas
  const limpiaTalla = v => String(v || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9/-]/g, '').slice(0, 10);
  const tallasBase = () => [...(L.cat.tallas || TALLAS), ...(L.tallasExtra || [])];
  const tallasConActual = actual => { const l = tallasBase(); if (actual && !l.includes(actual)) l.push(actual); return l; };
  const aceptaTalla = v => { const t = limpiaTalla(v); if (!t) return ''; if (!tallasBase().includes(t)) (L.tallasExtra = L.tallasExtra || []).push(t); return t; };
  function filaHtml(f, i) {
    return '<tr data-i="' + i + '"><td class="n">' + (i + 1) + '</td><td data-l="NOMBRE"><input data-c="nombre" value="' + esc(f.nombre) + '" placeholder="NOMBRE" autocomplete="off"></td>' +
      '<td data-l="TALLA" style="width:96px"><select data-c="talla" class="' + (f.talla ? '' : 'bad') + '"><option value="">—</option>' + tallasConActual(f.talla).map(t => '<option' + (t === f.talla ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '<option value="__otra" title="Agregar otra talla">+</option></select></td>' +
      '<td data-l="NÚMERO" style="width:90px"><input data-c="numero" value="' + esc(f.numero) + '" placeholder="Nº" inputmode="numeric" autocomplete="off"></td>' +
      '<td data-l="DISEÑO" style="width:96px"><select data-c="diseno">' + Array.from({ length: L.disenos }, (_, k) => '<option value="' + (k + 1) + '"' + (k + 1 === Number(f.diseno) ? ' selected' : '') + '>D' + (k + 1) + '</option>').join('') + '</select></td>' +
      '<td data-l="GÉNERO" style="width:100px"><select data-c="genero"><option value="MASC"' + (f.genero === 'MASC' ? ' selected' : '') + '>MASC</option><option value="FEM"' + (f.genero === 'FEM' ? ' selected' : '') + '>FEM</option></select></td>' +
      '<td data-l="OBSERVACIÓN"><input data-c="observacion" value="' + esc(f.observacion) + '" placeholder="Observación" autocomplete="off"></td><td style="width:34px"><button class="pl-x" type="button" data-quitar-fila aria-label="Quitar">✕</button></td></tr>';
  }
  const esMovil = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer:coarse)').matches && window.innerWidth < 900);   // fuera de la oficina: sin agentes, todo lo hace el servidor (VPS)
  function pantallaListado() {
    const gs = grupos();
    if (!gs.length) {   // sin referencias todavía: el proyecto y sus mockups (todos), para ver lo disponible
      q('[data-cuerpo]').innerHTML = '<div class="pl-tarjeta"><h3>Proyecto del pedido</h3><div class="pl-grid" style="margin:0 0 10px">' + proyectoCampo('') + '</div>' + galeriaProyectoHtml(datosRef('').proyecto) + '<p>Todavía no hay referencias: agrégalas en CO/RM (Conceptos) para llenar el listado.</p></div>';
      acciones('<button class="pl-btn sec" type="button" data-atras>◀ VOLVER A CO/RM</button>', 'Puedes seguir llenando el proyecto; las referencias aparecen cuando las agregas en CO/RM.');
      q('[data-atras]').onclick = () => { if (L.previo) { if (L.opts.onVolver) L.opts.onVolver(); return; } L.pantalla = 'doc'; dibujar(); };
      return;
    }
    if (!gs.find(g => g.referencia === L.abierta)) L.abierta = gs[0].referencia;
    const g = gs.find(x => x.referencia === L.abierta), filas = filasDe(g.referencia);
    if (!filas.length && !L.relleno[g.referencia]) {   // la primera vez que se abre una referencia ya trae sus filas en blanco (una por prenda cotizada)
      for (let k = 0; k < g.cantidad; k++) filas.push(filaVacia());
      L.relleno[g.referencia] = true; guardarBorrador();
    }
    q('[data-cuerpo]').innerHTML = '<div class="pl-refs">' + gs.map(x => '<button type="button" class="pl-ref ' + (x.referencia === L.abierta ? 'on' : '') + '" data-ref="' + esc(x.referencia) + '">' + esc(x.referencia) + contador(x) + '</button>').join('') + '</div>' +
      '<div class="pl-tarjeta"><h3>' + esc(g.referencia) + ' · ' + esc(g.descripcion) + ' · ' + g.cantidad + ' prendas</h3>' +
      '<div class="pl-herr">' + proyectoCampo(g.referencia) +
      '<label>LÍNEA DEL PRODUCTO<select data-ref-linea data-ref="' + esc(g.referencia) + '"><option value="">—</option>' + (L.cat.lineas || []).map(x => '<option' + (x === datosRef(g.referencia).linea ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
      '' +
      '' +
      '<button class="pl-btn sec mini" type="button" data-mas style="display:inline-flex;align-items:center;gap:6px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>AGREGAR FILA</button><button class="pl-btn sec mini" type="button" data-mas5 style="display:inline-flex;align-items:center;gap:6px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10"/><path d="M4 12h10"/><path d="M4 18h6"/><path d="M19 15v6"/><path d="M16 18h6"/></svg>AGREGAR 5 FILAS</button><button class="pl-btn sec mini" type="button" data-pegar style="display:inline-flex;align-items:center;gap:6px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M6.5 9.5 12 4l5.5 5.5"/><path d="M4 16v3.5A.5.5 0 0 0 4.5 20h15a.5.5 0 0 0 .5-.5V16"/></svg>SUBIR ARCHIVO</button><button class="pl-btn sec mini" type="button" data-pegar-texto>PEGAR DESDE EXCEL</button>' + '<div class="pl-aplique" style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;flex:0 0 auto;max-width:100%;order:-1;grid-column:1/-1">' + '<div data-tipos data-ref="' + esc(g.referencia) + '" style="position:relative;min-width:min(220px,100%);order:2;display:' + (datosRef(g.referencia).textura === 'SI' ? 'block' : 'none') + '">' + '<button type="button" data-tipos-btn style="width:100%;min-height:38px;padding:0 10px;border:1px solid #3d4c3b;border-radius:8px;background:#17201a;color:#f4f7fa;font:700 13px Arial;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + ((datosRef(g.referencia).tipos || []).length ? datosRef(g.referencia).tipos.join(', ') : 'TIPO DE APLIQUE') + ' ▾</button>' + '<div data-tipos-panel hidden style="position:absolute;z-index:20;left:0;right:0;top:100%;margin-top:4px;background:#101a12;border:1px solid #3d4c3b;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;font:700 11px Arial">' + ['TEXTURIZADO TPU', 'BORDADO', 'SELLO PRESTIGIO', 'DTF/VINILO'].map(t => '<label style="display:flex;gap:6px;align-items:center;white-space:nowrap;cursor:pointer;padding:6px 12px;min-height:26px"><input type="checkbox" data-tipo style="display:none" value="' + t + '"' + (datosRef(g.referencia).tipos.includes(t) ? ' checked' : '') + '><span data-chk style="width:14px;color:#d0f44c;font-size:13px">' + (datosRef(g.referencia).tipos.includes(t) ? '✓' : '') + '</span>' + t + '</label>').join('') + '</div></div>' + '<label class="pl-tex" style="margin-left:8px;min-width:120px;max-width:160px;order:1">Aplique *<select data-textura data-ref="' + esc(g.referencia) + '"><option value="">Seleccionar…</option><option value="SI"' + (datosRef(g.referencia).textura === 'SI' ? ' selected' : '') + '>SÍ</option><option value="NO"' + (datosRef(g.referencia).textura === 'NO' ? ' selected' : '') + '>NO</option></select></label></div></div>' +
      '<div class="pl-tabla-caja"><table class="pl-tabla"><thead><tr><th></th><th>NOMBRE</th><th>TALLA *</th><th>NÚMERO</th><th>DISEÑO</th><th>GÉNERO</th><th>OBSERVACIÓN</th><th></th></tr></thead><tbody data-filas>' + filas.map(filaHtml).join('') + '</tbody></table></div></div>';
    if (L.previo) acciones('<button class="pl-btn sec" type="button" data-atras>◀ VOLVER A CO/RM</button><button class="pl-btn" type="button" data-programar disabled>CREA LA COTIZACIÓN PARA PROGRAMAR</button>', '', '');
    else acciones('<button class="pl-btn sec" type="button" data-atras>◀ MOCKUPS</button><button class="pl-btn" type="button" data-programar>PROGRAMAR PEDIDO EN PRODUCCIÓN</button>', '', '');
    estadoListado();
    // el botón de tipos copia el formato exacto del desplegable de Aplique (alto, borde, fondo, letra y esquinas)
    const ref = raiz.querySelector('[data-textura]');
    if (ref) {
      const cs = getComputedStyle(ref);
      raiz.querySelectorAll('[data-tipos-btn]').forEach(b => {
        Object.assign(b.style, { height: cs.height, minHeight: cs.height, boxSizing: 'border-box', background: cs.backgroundColor, color: cs.color, border: cs.borderTop, borderRadius: cs.borderRadius, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, padding: cs.padding, textAlign: 'left' });
      });
      raiz.querySelectorAll('[data-tipos-panel]').forEach(p => {
        Object.assign(p.style, { background: cs.backgroundColor, border: cs.borderTop, borderRadius: '4px', padding: '4px 0', gap: '0', fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color });
      });
    }
    raiz.querySelectorAll('.pl-herr').forEach(hr => { hr.style.flexWrap = window.innerWidth < 1400 ? 'wrap' : 'nowrap'; hr.style.alignItems = 'flex-end'; hr.style.overflow = 'visible'; });
    raiz.querySelectorAll('[data-textura]').forEach(sel => sel.onchange = e => {   // el APLIQUE es de CADA referencia: solo cambia la de este desplegable
      const ref = sel.dataset.ref, v = sel.value, cur = datosRef(ref);
      L.refDatos = L.refDatos || {};
      L.refDatos[ref] = Object.assign({}, cur, { textura: v, tipos: v === 'SI' ? cur.tipos : [] });
      guardarBorrador();
      const bloque = sel.closest('.pl-aplique');
      if (bloque) {
        bloque.querySelectorAll('[data-tipos]').forEach(x => { x.style.display = v === 'SI' ? 'block' : 'none'; });   // TIPO DE APLIQUE solo aparece con SÍ, a la derecha de Aplique
        bloque.querySelectorAll('[data-tipos-panel]').forEach(p => { p.hidden = true; });   // al elegir SÍ/NO la lista se queda cerrada
      }
      L.ultimoCambioTextura = Date.now();   // el clic que cierra el desplegable de Aplique no debe abrir la lista
      estadoListado();
    });
    raiz.querySelectorAll('[data-tipo]').forEach(cb => cb.onchange = () => {
      const cont = cb.closest('[data-tipos]'), ref = cont.dataset.ref;
      const tipos = [...cont.querySelectorAll('[data-tipo]:checked')].map(x => x.value);
      L.refDatos = L.refDatos || {};
      L.refDatos[ref] = Object.assign({}, datosRef(ref), { tipos });
      guardarBorrador();
      cont.querySelectorAll('[data-tipo]').forEach(o => { o.checked = tipos.includes(o.value); const sp = o.parentElement.querySelector('[data-chk]'); if (sp) sp.textContent = o.checked ? '✓' : ''; });
      cont.querySelectorAll('[data-tipos-btn]').forEach(b => { b.textContent = (tipos.length ? tipos.join(', ') : 'TIPO DE APLIQUE') + ' ▾'; });
      estadoListado();
    });
    // la lista de tipos se cierra al hacer clic fuera de ella (dentro sigue abierta para marcar varias)
    if (!document.getElementById('pl-tipos-css')) {   // el atributo hidden debe ocultar la lista aunque tenga display:flex en línea
      const st = document.createElement('style');
      st.id = 'pl-tipos-css';
      st.textContent = '[data-tipos-panel][hidden]{display:none!important}[data-tipos-panel] label{padding:7px 12px;min-height:30px;font:inherit;color:inherit}[data-tipos-panel] label:hover{background:rgba(156,201,255,.25)}[data-tipos-panel] label:has(input:checked){background:#9cc9ff;color:#0b120c}';
      document.head.appendChild(st);
    }
    if (!window.__cerrarTiposListo) {
      window.__cerrarTiposListo = true;
      document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('[data-tipos-panel]').forEach(p => { p.hidden = true; }); });
      document.addEventListener('click', e => {
        if (!(e.target && e.target.closest && e.target.closest('[data-tipos]'))) document.querySelectorAll('[data-tipos-panel]').forEach(p => { p.hidden = true; });
      });
    }
    raiz.querySelectorAll('[data-tipos-btn]').forEach(b => b.onclick = () => {
      if (Date.now() - (L.ultimoCambioTextura || 0) < 600) return;   // clic que llega junto con la elección de SÍ/NO: se ignora
      const pn = b.parentElement.querySelector('[data-tipos-panel]');
      pn.hidden = !pn.hidden;
      if (pn.hidden) return;
      // la lista va FIJA en la pantalla: alineada con el borde derecho de Aplique, sin salirse del ancho visible
      const rb = b.getBoundingClientRect();   // la lista queda CENTRADA bajo el botón TIPO DE APLIQUE, con su mismo ancho
      const ancho = Math.min(Math.max(220, Math.round(rb.width)), innerWidth - 16);
      pn.style.position = 'fixed';
      pn.style.top = Math.round(rb.bottom + 4) + 'px';
      pn.style.left = Math.max(8, Math.min(Math.round(rb.left), innerWidth - ancho - 8)) + 'px';
      pn.style.right = 'auto';
      pn.style.width = ancho + 'px';
    });
    raiz.querySelectorAll('button.pl-ref[data-ref]').forEach(b => b.onclick = () => { L.abierta = b.dataset.ref; pantallaListado(); });   // solo los botones de referencia (los campos de proyecto también llevan data-ref)
    q('[data-atras]').onclick = () => { if (L.previo) { if (L.opts.onVolver) L.opts.onVolver(); return; } L.pantalla = 'mockups'; dibujar(); };
    q('[data-mas]').onclick = () => { filas.push(filaVacia()); guardarBorrador(); pantallaListado(); enfocarUltima(); };
    q('[data-mas5]').onclick = () => { for (let k = 0; k < 5; k++) filas.push(filaVacia()); guardarBorrador(); pantallaListado(); enfocarUltima(); };
    q('[data-pegar]').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.xlsx,.xlsm,.docx,.pdf,.jpg,.jpeg,.png';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) { setMsg('El archivo pesa más de 10 MB.', 'error'); return; }
        setMsg('Leyendo ' + f.name + '…', '');
        const fd = new FormData();
        fd.append('archivo', f);
        try {
          const r = await fetchT('/api/listado/leer-archivo', { method: 'POST', body: fd, credentials: 'same-origin' });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { setMsg(j.detail || 'No pude leer el archivo.', 'error'); return; }
          // Cada pestaña del Excel que se llame igual que una referencia va a esa referencia; el resto se avisa
          const refs = grupos().map(x => x.referencia), pest = j.pestanas || {};
          const coinciden = Object.keys(pest).filter(t => refs.includes(String(t).trim().toUpperCase()));
          let n = 0;
          if (coinciden.length) { coinciden.forEach(t => { n += pegar(String(t).trim().toUpperCase(), pest[t]); }); }
          else { n = pegar(g.referencia, j.texto); }
          const ignoradas = coinciden.length ? Object.keys(pest).filter(t => !coinciden.includes(t)) : [];
          guardarBorrador();
          pantallaListado();
          setMsg(n + ' fila(s) cargadas desde ' + f.name + (coinciden.length ? ' (pestañas: ' + coinciden.join(', ') + ')' : '') + (ignoradas.length ? '. No se cargaron las pestañas sin referencia: ' + ignoradas.join(', ') : '') + '. Revísalas antes de programar.', 'ok');
        } catch (e) { setMsg('No pude subir el archivo: ' + e.message, 'error'); }
      };
      inp.click();
    };
    q('[data-pegar-texto]').onclick = () => {
      let p = q('[data-pegado]');
      if (!p) {
        q('.pl-herr').insertAdjacentHTML('afterend', '<div data-pegado hidden class="pl-tarjeta" style="margin:0 0 10px"><label>Copia las filas de Excel (columnas NOMBRE, TALLA, NÚMERO; separadas por tabulador o punto y coma)<textarea data-pegado-texto spellcheck="false" style="width:100%;min-height:120px"></textarea></label><div style="display:flex;gap:8px;margin-top:8px"><button class="pl-btn mini" type="button" data-pegado-ok>PEGAR FILAS</button><button class="pl-btn sec mini" type="button" data-pegado-no>CANCELAR</button></div></div>');
        p = q('[data-pegado]');
        p.querySelector('[data-pegado-no]').onclick = () => { p.hidden = true; };
        p.querySelector('[data-pegado-ok]').onclick = () => { const n = pegar(g.referencia, p.querySelector('[data-pegado-texto]').value); guardarBorrador(); pantallaListado(); setMsg(n + ' fila(s) agregadas.', 'ok'); };
      }
      p.hidden = !p.hidden;
      if (!p.hidden) p.querySelector('[data-pegado-texto]').focus();
    };
    const tb = q('[data-filas]');
    tb.addEventListener('input', e => {   // sin redibujar la tabla: solo se actualiza la fila, el contador y el estado
      const tr = e.target.closest('tr'); if (!tr) return; const f = filas[Number(tr.dataset.i)], c = e.target.dataset.c; if (!f || !c) return;
      if (c === 'nombre' || c === 'observacion') { const pos = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); try { e.target.setSelectionRange(pos, pos); } catch (er) { /* sin cursor */ } }   // se ve y se guarda en mayúsculas, como en la plantilla
      if (c === 'talla' && e.target.value === '__otra') {
        const t = aceptaTalla(window.prompt('Escribe la talla que necesita el cliente (letras y números, ej. 5XL, 18, 3-4):') || '');
        if (!t) { e.target.value = f.talla || ''; return; }
        f.talla = t; guardarBorrador(); pantallaListado(); return;
      }
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
    tb.addEventListener('keydown', e => {   // flechas ↑ / ↓: saltan a la misma columna de la fila de arriba o de abajo (también en TALLA, DISEÑO y GÉNERO; para cambiar su opción: clic, Alt+↓ o escribir la letra)
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const t = e.target, c = t.dataset && t.dataset.c; if (!c) return;
      const tr = t.closest('tr'), dest = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
      e.preventDefault(); if (!dest) return;
      const n = dest.querySelector('[data-c="' + c + '"]'); if (n) { n.focus(); if (n.select) try { n.select(); } catch (er) { /* select sin texto */ } }
    });
    tb.addEventListener('click', e => { const b = e.target.closest('[data-quitar-fila]'); if (!b) return; filas.splice(Number(b.closest('tr').dataset.i), 1); guardarBorrador(); pantallaListado(); });
    q('[data-programar]').onclick = enviar;
    layoutListado();
  }
  function enfocarUltima() { const t = q('[data-filas]'); const u = t && t.querySelector('tr:last-child [data-c="nombre"]'); if (u) u.focus(); }
  const COLS = ['nombre', 'talla', 'numero', 'diseno', 'genero', 'observacion'];   // mismo orden que la plantilla: NOMBRE · TALLA · NÚMERO · DISEÑO · GÉNERO · OBSERVACIÓN
  function valorCol(c, v) {
    v = String(v == null ? '' : v).trim();
    if (c === 'talla') return aceptaTalla(v);
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
      const nueva = { nombre: String(c[0] || '').toUpperCase(), talla: aceptaTalla(talla), numero: c[2] || '', diseno: d && Number(d[0]) >= 1 && Number(d[0]) <= L.disenos ? Number(d[0]) : (L.defDiseno || 1), genero: /^F/.test(g) ? 'FEM' : /^M/.test(g) ? 'MASC' : (L.defGenero || 'MASC'), observacion: String(c[5] || '').toUpperCase() };
      const hueco = filas.findIndex(x => !x.nombre && !x.talla && !x.numero && !x.observacion);   // primero llena las filas en blanco y solo agrega si no quedan
      if (hueco >= 0) filas[hueco] = nueva; else filas.push(nueva);
      n++;
    });
    return n;
  }
  function estadoListado() {
    grupos().forEach(g => { const el = raiz.querySelector('[data-cont="' + g.referencia.replace(/"/g, '') + '"]'); if (el) { const n = filasDe(g.referencia).length; el.textContent = n + ' / ' + g.cantidad; el.classList.toggle('ok', n === g.cantidad); } });
    const f = faltantes(), b = q('[data-programar]'); if (b) b.disabled = f.length > 0 || L.enviando || !!L.previo;
    if (L.enviando) return;
    setMsg(f.length ? f.slice(0, 6).join('\n') + (f.length > 6 ? '\n…y ' + (f.length - 6) + ' más' : '') : (hayReferencias() ? 'Listado completo ✓ Ya puedes programar el pedido.' : 'Llena el listado; las referencias salen de CO/RM cuando las agregues.'), f.length ? '' : (hayReferencias() ? 'ok' : ''));
  }

  // ---------------------------------------------------------------- envío y seguimiento
  async function enviar() {
    if (L.enviando) return;
    const f = faltantes(); if (f.length) { setMsg(f.join('\n'), 'error'); return; }
    L.enviando = true;
    if (L.mkCarga && L.mkCarga.length) {   // los mockups elegidos en el documento SON los que se insertan: se espera a que terminen de bajar y se exige que estén todos
      setMsg('Preparando los mockups elegidos…', '');
      // espera como máximo 30 s: si la NAS tarda o falla, no se queda cargando para siempre
      const tiempo = new Promise(r => setTimeout(() => r('tiempo'), 30000));
      const resultado = await Promise.race([Promise.allSettled(L.mkCarga), tiempo]);
      const faltan = (L.mkEsperados || []).filter(([r, n]) => !imagenDe(r, n));
      if (resultado === 'tiempo' || faltan.length) {
        L.enviando = false; estadoListado();
        setMsg((faltan.length ? 'No pude traer el mockup ' + faltan.map(([r, n]) => r + ' D' + n).join(', ') + ' desde la NAS' : 'La NAS tardó demasiado en traer los mockups') + '. Súbelo a mano en ◀ MOCKUPS o vuelve a intentar.', 'error');
        return;
      }
    }
    const listado = {}; grupos().forEach(g => { listado[g.referencia] = filasDe(g.referencia).map(x => ({ nombre: x.nombre, talla: x.talla, numero: x.numero, diseno: Number(x.diseno), genero: x.genero, observacion: x.observacion })); });
    const proyectos = Object.fromEntries(grupos().map(g => [g.referencia, datosRef(g.referencia)]));
    // la fecha de entrega es la del documento (la que se escribe en el Google Sheet)
    const fechaDoc = (window.PedidoEffi && window.PedidoEffi.fechaEntrega) ? window.PedidoEffi.fechaEntrega() : '';
    const doc = Object.assign({}, L.doc, { fecha_entrega: fechaDoc || L.doc.fecha_entrega || '', proyecto: String((proyectos[(grupos()[0] || { referencia: '' }).referencia] || {}).proyecto || '').trim(), disenos: L.disenos });
    const fd = new FormData(); fd.append('payload', JSON.stringify({ doc, listado, proyectos, linea: L.linea, observaciones: L.observaciones, textura: ((proyectos[(grupos()[0] || { referencia: '' }).referencia]) || {}).textura || '', tipos: ((proyectos[(grupos()[0] || { referencia: '' }).referencia]) || {}).tipos || [] }));
    grupos().forEach(g => { for (let n = 1; n <= L.disenos; n++) { const img = imagenDe(L.compartir ? '*' : g.referencia, n); if (img) { fd.append('mockup:' + g.referencia + ':' + n, img, img.name); const mm = (L.mkMaestro || {})[g.referencia + '|' + n]; if (mm) fd.append('maestro:' + g.referencia + ':' + n, JSON.stringify(mm)); } } });   // los de MAESTROS también van con su origen: en la NAS se copian idénticos
    // al pulsar PROGRAMAR PEDIDO el trabajo empieza YA y se ve en pantalla: el listado de Excel que se está creando y cómo avanza cada paso
    L.xlCargado = false; L.xlVista = null;
    L.pantalla = 'enviado'; L.job = { id: 0, estado: 'ENVIANDO', progreso: 3, detail: 'Creando el listado de Excel con la plantilla de Indoor…', excel: '', insertados: null }; dibujar();
    try {
      if (L.doc.tipo !== 'remision') {   // el PDF de Effi es OBLIGATORIO: se espera aquí, a la vista, antes de programar (con el motivo si no llega)
        const t0 = Date.now(); let est = null;
        for (;;) {
          est = await fetchT('/api/pedido-effi/pdf-estado/' + L.doc.numero, { credentials: 'same-origin', cache: 'no-store' }).then(x => x.ok ? x.json() : null).catch(() => null);
          if (est && (est.estado === 'listo' || est.estado === 'error')) break;
          const seg = Math.round((Date.now() - t0) / 1000);
          if (seg > 60) break;   // a los 60 s se avisa qué revisar (EFFITRON) en vez de esperar más
          L.job.detail = 'Esperando el PDF de Effi (obligatorio)… ' + seg + ' s' + (est && est.agente === false ? ' · EFFITRON no está conectado' : '');
          if (raiz && raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado();
          await new Promise(r => setTimeout(r, 2500));
        }
        if (!est || est.estado !== 'listo') throw new Error('No llegó el PDF de Effi de la cotización ' + L.doc.numero + (est && est.detalle ? ' (' + est.detalle + ')' : '') + '. Es obligatorio para programar: revisa que EFFITRON esté conectado y vuelve a pulsar PROGRAMAR PEDIDO.');
        L.job.detail = 'PDF de Effi listo. Creando el listado de Excel con la plantilla de Indoor…';
        if (raiz && raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado();
      }
      // aviso al PC de la oficina: un comercial empezó a programar (no bloquea nada si falla)
      fetch('/api/club/alertas/senal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ cliente: (L.doc.cliente || {}).nombre || '', proyecto: datosRef((grupos()[0] || {}).referencia || PH).proyecto || '',
          prendas: Object.values(L.listado || {}).reduce((a, f) => a + (Array.isArray(f) ? f.length : 0), 0) }) }).catch(() => {});
      const r = await fetchT('/api/pedido-effi/programar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo programar el pedido (error ' + r.status + ')');
      L.enviando = false; Object.assign(L.job, { id: j.id, estado: j.estado || 'RECIBIDO', progreso: 8, detail: j.mensaje || '', excel: j.excel || '', excel_nombre: j.excel_nombre || '', insertados: j.mockups_insertados == null ? null : j.mockups_insertados });
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
      const r = await fetchT('/api/pedido-effi/excel-vista/' + encodeURIComponent(codigo), { credentials: 'same-origin', cache: 'no-store' });
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
  // ---------------------------------------------------------------- pantalla «PROGRAMANDO EL PEDIDO»: anillo de avance, línea de tiempo y animaciones de éxito / error
  function pgPasos() {
    const cot = L.doc.tipo !== 'remision';
    return (cot ? [{ pdf: true, t: 'PDF de Effi (obligatorio)' }] : []).concat(PASOS_ENVIO.map(([u, t]) => ({ u, t })));
  }
  function pgEstadoPasos() {
    const j = L.job || {}, fin = ['COMPLETADO', 'ERROR', 'REVISAR'].includes(j.estado), ok = j.estado === 'COMPLETADO', pr = ok ? 100 : Math.max(3, Number(j.progreso) || 3);
    const pdfListo = !!j.id || /PDF de Effi listo/.test(j.detail || '') || ok;
    const lista = pgPasos().map(p => ({ t: p.t, hecho: p.pdf ? pdfListo : (ok || pr > p.u || (p.u === 3 && pr >= 8)), activo: false }));
    const primero = lista.findIndex(p => !p.hecho); if (!fin && primero >= 0) lista[primero].activo = true;
    return lista;
  }
  function pgAnimarNumero(el, hasta) {
    const desde = Number(el.dataset.v || 0); el.dataset.v = hasta;
    if (desde === hasta || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { el.textContent = hasta; return; }
    const t0 = performance.now(), dur = 700;
    const paso = t => { const x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 3); el.textContent = Math.round(desde + (hasta - desde) * e); if (x < 1 && el.isConnected) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  }
  function pgConfeti() {
    const colores = ['#d0f44c', '#9fcd12', '#ffffff', '#6ee7b7', '#bff26a'];
    return Array.from({ length: 22 }, (_, i) => { const a = Math.round((360 / 22) * i + (i % 3) * 9), d = 90 + (i % 5) * 22, c = colores[i % colores.length], r = (i % 2 ? 1 : -1) * (180 + i * 17); return '<i style="--a:' + a + 'deg;--d:' + d + 'px;--r:' + r + 'deg;--c:' + c + ';animation-delay:' + ((i % 6) * 0.04).toFixed(2) + 's"></i>'; }).join('');
  }
  function pantallaEnviado() {
    const j = L.job || {}, fin = ['COMPLETADO', 'ERROR', 'REVISAR'].includes(j.estado), ok = j.estado === 'COMPLETADO', mal = fin && !ok;
    const pr = ok ? 100 : Math.max(3, Number(j.progreso) || 3), codigo = (L.doc.tipo === 'remision' ? 'RM' : 'CO') + L.doc.numero;
    const pasos = pgEstadoPasos(), activo = pasos.find(p => p.activo);
    const ahora = ok ? 'Todo listo' : mal ? 'Hubo un problema' : (activo ? activo.t : 'Terminando…');
    const nota = ok ? 'El pedido quedó programado en Producción y guardado en la carpeta de la NAS.' : mal ? (j.detail || '') : (/Esperando el PDF/.test(j.detail || '') ? (j.detail || '') : (j.detail || 'No tienes que hacer nada: el servidor lo hace en segundo plano.'));
    const eye = ok ? 'PEDIDO PROGRAMADO' : mal ? 'NO SE PUDO TERMINAR' : 'PROGRAMANDO EL PEDIDO';
    const clase = ok ? 'ok' : mal ? 'mal' : 'run';
    const avisos = (j.detail && (ok || mal) ? '<div class="pg-aviso ' + (ok ? 'ok' : 'mal') + '">' + esc(j.detail) + '</div>' : '') +
      (j.pdf ? '<div class="pg-aviso ' + (j.pdf.hecho ? 'ok' : (j.pdf.estado === 'esperando' || j.pdf.estado === 'copiando') ? 'esp' : 'mal') + '">' + (j.pdf.hecho ? '✅ ' : (j.pdf.estado === 'esperando' || j.pdf.estado === 'copiando') ? '⏳ ' : '⚠️ ') + 'PDF de Effi: ' + esc(j.pdf.detalle) + '</div>' : '') +
      (j.excel ? '<a class="pg-descarga" href="' + esc(j.excel) + '">⬇ DESCARGAR EL EXCEL' + (j.insertados != null ? ' <small>(' + j.insertados + ' mockup(s) insertado(s))</small>' : '') + '</a>' : '');
    let pg = raiz.querySelector('[data-pg]');
    if (!pg) {
      q('[data-cuerpo]').innerHTML = '<div class="pg run" data-pg><div class="pg-aura"></div>' +
        '<header class="pg-cab"><span class="pg-eye" data-pg-eye></span><h2 class="pg-cod">' + esc(codigo) + '</h2><p class="pg-sub">' + esc(String((L.doc.cliente && L.doc.cliente.nombre) || '')) + (L.proyecto ? ' · ' + esc(L.proyecto) : '') + '</p></header>' +
        '<div class="pg-cuerpo"><div class="pg-anillo"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="pgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fcd12"/><stop offset="1" stop-color="#e6ff7a"/></linearGradient></defs>' +
        '<circle class="pg-pista" cx="60" cy="60" r="52"/><circle class="pg-arco" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="100" stroke-dashoffset="97"/><circle class="pg-brillo" cx="60" cy="60" r="52" pathLength="100"/></svg>' +
        '<div class="pg-centro"><b data-pg-pct data-v="0">0</b><span>%</span></div><div class="pg-ico" data-pg-ico></div><span class="pg-orbita"><i></i></span><span class="pg-onda"></span><span class="pg-onda b"></span><div class="pg-confeti" data-pg-confeti></div></div>' +
        '<div class="pg-info"><div class="pg-actual"><small>' + 'AHORA' + '</small><b data-pg-ahora></b><span data-pg-nota></span></div><ol class="pg-pasos" data-pg-pasos></ol></div></div>' +
        '<div class="pg-avisos" data-pg-avisos></div></div>';
      acciones('<button class="pl-btn sec" type="button" data-volver hidden>◀ VOLVER AL LISTADO</button><button class="pl-btn sec" type="button" data-otro>CREAR OTRO DOCUMENTO</button><button class="pl-btn" type="button" data-cerrar>CERRAR</button>', '', '');
      q('[data-volver]').onclick = () => { L.pantalla = 'listado'; dibujar(); };
      q('[data-otro]').onclick = () => L.opts.onOtro && L.opts.onOtro();
      q('[data-cerrar]').onclick = () => L.opts.onCerrar && L.opts.onCerrar();
      pg = raiz.querySelector('[data-pg]'); pg.dataset.pasos = '';
    }
    // se actualiza EN SU LUGAR (no se vuelve a dibujar): así el anillo, los números y los pasos se mueven con animación
    const previa = pg.classList.contains('ok') ? 'ok' : pg.classList.contains('mal') ? 'mal' : 'run';
    pg.classList.remove('run', 'ok', 'mal'); pg.classList.add(clase);
    pg.querySelector('[data-pg-eye]').textContent = eye;
    pg.querySelector('.pg-arco').style.strokeDashoffset = String(100 - pr);
    pgAnimarNumero(pg.querySelector('[data-pg-pct]'), pr);
    const ahoraEl = pg.querySelector('[data-pg-ahora]'); if (ahoraEl.textContent !== ahora) { ahoraEl.textContent = ahora; ahoraEl.classList.remove('cambia'); void ahoraEl.offsetWidth; ahoraEl.classList.add('cambia'); }
    pg.querySelector('[data-pg-nota]').textContent = nota;
    pg.querySelector('[data-pg-ico]').innerHTML = ok ? '<svg viewBox="0 0 52 52"><path d="M14 27 l8 8 l16 -18"/></svg>' : mal ? '<b>!</b>' : '';
    const ol = pg.querySelector('[data-pg-pasos]'), claveP = pasos.map(p => p.t).join('|');
    if (pg.dataset.pasos !== claveP) { pg.dataset.pasos = claveP; ol.innerHTML = pasos.map((p, k) => '<li style="animation-delay:' + (k * 0.07).toFixed(2) + 's"><span class="pg-p"></span><em>' + esc(p.t) + '</em></li>').join(''); }
    ol.querySelectorAll('li').forEach((li, k) => { const p = pasos[k]; li.classList.toggle('hecho', !!p.hecho); li.classList.toggle('activo', !!p.activo && !fin); li.querySelector('.pg-p').innerHTML = p.hecho ? '<svg viewBox="0 0 24 24"><path d="M5 12.5 l4.5 4.5 l9 -10"/></svg>' : (p.activo && !fin ? '<i></i>' : ''); });
    if (clase === 'ok' && previa !== 'ok') { pg.querySelector('[data-pg-confeti]').innerHTML = pgConfeti(); pg.classList.add('festejo'); }
    if (clase === 'mal' && previa !== 'mal') { pg.classList.remove('sacude'); void pg.offsetWidth; pg.classList.add('sacude'); }
    pg.querySelector('[data-pg-avisos]').innerHTML = avisos;
    const v = q('[data-volver]'); if (v) v.hidden = !mal;
  }
  function avisoProgramado(cod) {
    const e = document.createElement('div'); e.setAttribute('role', 'status');
    e.style.cssText = 'position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:2147483000;background:#d0f44c;color:#10200a;font:900 14px Arial;padding:14px 22px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:opacity .5s,transform .5s;max-width:92vw;text-align:center';
    e.textContent = '✅ El pedido ' + cod + ' se programó correctamente';
    document.body.appendChild(e);
    setTimeout(() => { e.style.opacity = '0'; e.style.transform = 'translateX(-50%) translateY(-10px)'; }, 4500); setTimeout(() => e.remove(), 5200);
  }
  async function seguir() {
    let fin = false;
    for (let k = 0; k < 700 && raiz && raiz.isConnected && L.pantalla === 'enviado'; k++) {   // hasta ~14 min
      await new Promise(r => setTimeout(r, 1200));
      try {
        const r = await fetchT('/api/procesos', { credentials: 'same-origin' }); const lista = await r.json();
        if (L.job.estado === 'COMPLETADO' && !(L.job.pdf && L.job.pdf.hecho) && k % 2 === 0) {   // el PDF de Effi debe quedar en la carpeta antes de cerrar
          try { let q = await fetchT('/api/pedido-effi/pdf-orden/' + encodeURIComponent((L.doc.tipo === 'remision' ? 'RM' : 'CO') + L.doc.numero), { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()); if (!q || q.detalle === undefined) q = { hecho: false, estado: 'error', detalle: 'No pude consultar el estado del PDF (' + JSON.stringify(q).slice(0, 80) + ')' }; if (!L.job.pdf || q.detalle !== L.job.pdf.detalle || q.hecho !== L.job.pdf.hecho) { L.job.pdf = q; if (raiz.isConnected && L.pantalla === 'enviado') pantallaEnviado(); } } catch (e) { /* se reintenta */ }
        }
        // todo salió bien: se cierra y se avisa. Si el PDF de Effi no llega en 60 s, no se espera más (queda pendiente en la carpeta)
        if (L.job.estado === 'COMPLETADO' && (esMovil() || (L.job.pdf && L.job.pdf.hecho) || (L.job.completadoEn && Date.now() - L.job.completadoEn > 60000))) {
          const cod = (L.doc.tipo === 'remision' ? 'RM' : 'CO') + L.doc.numero;
          await new Promise(r => setTimeout(r, 2600));   // se alcanza a ver el festejo antes de cerrar
          avisoProgramado(cod); if (L.opts.onCerrar) L.opts.onCerrar(); return;
        }
        if (fin) { if (L.job.estado !== 'COMPLETADO') return; continue; }   // si salió bien, se sigue vigilando el PDF de Effi hasta que quede en la carpeta
        const m = (lista || []).find(x => x.id === L.job.id); if (!m) continue;
        const cambio = m.status !== L.job.estado || m.detail !== L.job.detail || Number(m.progress) !== L.job.progreso;
        L.job.estado = m.status; L.job.detail = m.detail || ''; L.job.progreso = Number(m.progress) || L.job.progreso;
        if (m.status === 'COMPLETADO' && !L.job.completadoEn) L.job.completadoEn = Date.now();
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
    if (Object.keys(L.galGuardada || {}).length) { restaurarMockups(); }
    // al volver al documento y regresar, se recupera lo que ya estaba seleccionado (proyectos, aplique, mockups, género)
    if (ULTIMO && ULTIMO.clave === claveDocumento()) {
      L.refDatos = Object.keys(L.refDatos || {}).length ? L.refDatos : ULTIMO.refDatos;
      L.textura = L.textura || ULTIMO.textura; L.tipos = L.tipos || ULTIMO.tipos;
      if (ULTIMO.galPick && !Object.keys(L.galPick || {}).length) { L.galPick = ULTIMO.galPick; Object.keys(L.galPick).forEach(ref => sincronizar(ref)); }
      L.imgs = Object.keys(L.imgs || {}).length ? L.imgs : ULTIMO.imgs;
      L.defGenero = ULTIMO.defGenero || L.defGenero; L.defDiseno = ULTIMO.defDiseno || L.defDiseno;
      if (ULTIMO.proyLista) { L.proyLista = ULTIMO.proyLista; L.proyCliente = (L.doc.cliente && L.doc.cliente.nombre) || ''; }
    }
    L.compartir = false;   // cada referencia con sus propios mockups
    const pr = (opts && opts.preset) || null;
    L.previo = !!(opts && opts.previo);
    if (pr && pr.listado) {   // lo que se llenó en el LISTADO PREVIO (antes de crear la cotización)
      Object.entries(pr.listado).forEach(([ref, filas]) => { if (Array.isArray(filas) && filas.some(f => f.nombre || f.talla || f.numero || f.observacion)) { L.listado[String(ref).toUpperCase()] = filas.map(f => Object.assign({}, f)); L.relleno[String(ref).toUpperCase()] = true; } });
      if (pr.observaciones) L.observaciones = pr.observaciones;
    }
    // LÍNEA, PROYECTO y APLIQUE de cada referencia: se recuperan del listado anterior (si no, la línea volvía a la general)
    if (pr && pr.refDatos && typeof pr.refDatos === 'object') L.refDatos = Object.assign({}, pr.refDatos, L.refDatos || {});
    if (pr && pr.disenos) L.disenos = Math.min(MAX_DISENOS, Math.max(L.disenos || 1, Number(pr.disenos) || 1));
    if (pr) {   // viene de EMPEZAR PEDIDO con la línea, el proyecto y los mockups ya elegidos: directo al LISTADO (sin pasos de más)
      if (pr.linea) L.linea = pr.linea;
      if (pr.proyecto) L.proyecto = pr.proyecto;
      const m = pr.mockups || {}, refs = Object.keys(m);
      if (refs.length) { L.compartir = false; L.disenos = Math.min(MAX_DISENOS, Math.max(L.disenos || 1, ...refs.map(r => m[r].length))); }
      L.pantalla = 'listado'; L.abierta = (grupos()[0] || { referencia: '' }).referencia;   // los mockups se eligen en el panel de la derecha del listado
      L.mkEsperados = refs.flatMap(ref => m[ref].map((u, i) => [ref, i + 1])); L.mkCarga = []; L.mkMaestro = {};
      refs.forEach(ref => m[ref].forEach((u, i) => { if (typeof u === 'string') { try { const q = Object.fromEntries(new URL(u, location.origin).searchParams); if (q.cliente && q.proyecto && q.carpeta && q.archivo) L.mkMaestro[ref + '|' + (i + 1)] = q; } catch (e) { /* sin datos de MAESTROS */ } } }));
      refs.forEach(ref => m[ref].forEach((url, i) => L.mkCarga.push((async () => {
        try {
          const b = typeof url === 'string' ? await fetchT(url, { credentials: 'same-origin' }).then(x => { if (!x.ok) throw new Error(); return x.blob(); }) : url;   // una URL de la NAS o un archivo que subió el comercial
          const ext = (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          (L.imgs[ref] = L.imgs[ref] || {})[i + 1] = new File([b], ref + '_D' + (i + 1) + '.' + ext, { type: b.type || 'image/png' });
          if (raiz && raiz.isConnected && L.pantalla === 'mockups') dibujar();
        } catch (e) { /* ese mockup se puede subir a mano en MOCKUPS */ }
      })())));
    }
    dibujar();
  }
  // para las pestañas CO/RM y LISTADO de la ventana: en qué pantalla está el listado (null = aún no hay documento creado) y saltar a otra
  const activo = () => (L.doc && raiz && raiz.isConnected && raiz.querySelector('.pl, [data-cuerpo]')) ? L.pantalla : null;
  function ir(p) { if (!activo() || L.pantalla === 'enviado' || L.enviando) return false; L.pantalla = p; if (p === 'listado') L.abierta = L.abierta || (grupos()[0] || { referencia: '' }).referencia; dibujar(); return true; }
  const previo = () => !!(L.previo && activo());
  const claveDocumento = () => String((L.doc.cliente && L.doc.cliente.nombre) || '') + '|' + grupos().map(g => g.referencia).join(',');
  const datos = () => {
    const d = { listado: L.listado, disenos: L.disenos, linea: L.linea, observaciones: L.observaciones, proyecto: L.proyecto, refDatos: L.refDatos || {} };
    ULTIMO = Object.assign({ clave: claveDocumento(), textura: L.textura, tipos: L.tipos, imgs: L.imgs, galPick: L.galPick, defGenero: L.defGenero, defDiseno: L.defDiseno, proyLista: L.proyLista }, d);
    return d;
  };
  window.PedidoListado = { abrir, activo, ir, previo, datos };
})();
