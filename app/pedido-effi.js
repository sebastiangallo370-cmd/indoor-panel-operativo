(() => {
  // Toda llamada al servidor tiene límite de tiempo: si la NAS o el servidor no responden, la pantalla no se queda cargando
  const fetchT = (url, opts) => {
    const lento = /programar|leer-archivo|crear|vista-previa|excel|sincron/.test(String(url));
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), lento ? 180000 : 45000);
    return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })).finally(() => clearTimeout(t));
  };
  // PEDIDO EN EFFI: formulario con la estructura de «Crear cotización» de Effi. Al confirmar crea la COTIZACIÓN o la REMISIÓN DE VENTA en Effi. Lo abre EMPEZAR PEDIDO (PROGRAMAR CLUB).
  if (window.__pedidoEffiListo) return;
  window.__pedidoEffiListo = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  // Fecha de entrega predeterminada: 15 DÍAS HÁBILES después de hoy (sin sábados, domingos ni festivos de Colombia)
  const festivosCO = anio => {
    const f = new Set(), pad = n => String(n).padStart(2, '0'), key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const fijo = (m, d) => f.add(anio + '-' + pad(m) + '-' + pad(d));
    const lunes = (m, d) => { const x = new Date(anio, m - 1, d); const dow = x.getDay(); if (dow !== 1) x.setDate(x.getDate() + ((8 - dow) % 7)); f.add(key(x)); };   // se traslada al lunes siguiente (Ley Emiliani)
    [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].forEach(([m, d]) => fijo(m, d));
    [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].forEach(([m, d]) => lunes(m, d));
    const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4, g = Math.floor((b + 8) / 25), h = Math.floor((b - g + 1) / 3), i = (19 * a + b - d - h + 15) % 30, k = Math.floor(c / 4), l = c % 4, m = (32 + 2 * e + 2 * k - i - l) % 7, n = Math.floor((a + 11 * i + 22 * m) / 451), mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1;
    const pascua = new Date(anio, mes - 1, dia), mas = n => { const x = new Date(pascua); x.setDate(x.getDate() + n); return x; };
    f.add(key(mas(-3))); f.add(key(mas(-2))); f.add(key(mas(43))); f.add(key(mas(64))); f.add(key(mas(71)));   // jueves y viernes santo; Ascensión, Corpus Christi y Sagrado Corazón (lunes)
    return f;
  };
  // fecha de entrega mínima: 5 días calendario desde hoy (AAAA-MM-DD)
  const entregaMinima = () => { const d = new Date(); d.setDate(d.getDate() + 5); const pad = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const entregaPorDefecto = () => {
    const d = new Date(), cache = {}, pad = n => String(n).padStart(2, '0'); let falta = 15;
    while (falta > 0) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay(), y = d.getFullYear(); if (dow === 0 || dow === 6) continue;
      if ((cache[y] = cache[y] || festivosCO(y)).has(y + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()))) continue;
      falta--;
    }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const nuevaClave = () => 'pedido-' + [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');
  const css = document.createElement('style');
  css.textContent = `
  .pe{width:100%;max-width:none;margin:8px 0;display:grid;gap:14px}
  .pe-card{padding:20px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28));backdrop-filter:none}
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
  .pe-fila2{grid-template-columns:minmax(200px,1.1fr) minmax(180px,1fr) minmax(200px,1fr) minmax(130px,.5fr) auto!important;margin-top:0!important;align-items:end}.pe-fila2 .pe-mk-btn{white-space:nowrap}
  @media(max-width:999px){.pe-fila2{grid-template-columns:1fr!important}}
  .pe-mas{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:0}.pe-link{all:unset;cursor:pointer;color:#a9b5a3;font:800 12px Arial;letter-spacing:.06em}.pe-link:hover{color:#d0f44c}
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
    .pe{height:100%;margin:0;gap:8px;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(120px,1fr) auto;grid-template-areas:"av" "enc" "con" "abajo"}
    .pe-card{padding:10px 16px;box-sizing:border-box}
    .pe h2{font-size:20px}.pe h3{margin-bottom:8px}
    .pe-aviso{padding:6px 12px}
    .pe-enc .pe-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:8px!important;gap:8px}
    .pe-con{display:block;overflow:auto;min-height:0}   /* si no caben todos los conceptos (o el cuadro de capturar), se desplaza SOLO esta tarjeta; la página no */
    .pe-cap textarea{min-height:56px}
    .pe-linea{padding:6px 0}
    .pe-abajo{gap:10px;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr) minmax(0,1fr);align-items:stretch}
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
  /* Pantalla ancha: la tarjeta «Formas de pago» queda más pequeña (no se estira a la altura del resumen) para dejar más espacio a los mockups de la referencia. */
  @media(min-width:1000px){
    .pe-abajo{grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr) minmax(0,1fr)!important}
    .pe-abajo>.pe-card:nth-child(2){align-self:start;padding:8px 12px!important}
    .pe-abajo>.pe-card:nth-child(2) h3{margin-bottom:4px;font-size:12px}
    .pe-abajo>.pe-card:nth-child(2) .pe-forma{grid-template-columns:minmax(0,1fr) minmax(0,.8fr) auto;gap:6px;margin-bottom:4px}
    .pe-abajo>.pe-card:nth-child(2) label{font-size:10px;gap:2px}
    .pe-abajo>.pe-card:nth-child(2) input,.pe-abajo>.pe-card:nth-child(2) select{min-height:30px;font-size:13px}
    .pe-abajo>.pe-card:nth-child(2) .pe-btn{min-height:28px;font-size:11px}
  }
  /* Espacio de los mockups FIJO: la franja tiene siempre la misma altura (con mockups, con aviso o vacía) y, si hay varios, se desplaza dentro de ella. */
  @media(min-width:1000px){
    .pe-vitrina{height:462px;min-height:462px;max-height:462px;overflow-y:auto;overflow-x:hidden;align-content:flex-start;margin-top:12px}
    .pe-vit{height:430px;min-height:430px;max-height:430px;overflow:hidden;box-sizing:border-box}
    .pe-vit .foto{height:340px;min-height:340px}
    .pe-vit .t{overflow:hidden;max-height:48px}
    .pe-vit-vacia{width:100%;box-sizing:border-box;height:462px;display:grid;place-content:center}
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
  /* parte de abajo con jerarquía: Detalles | Formas de pago | Resumen (totales y botones) */
  .pe-abajo{display:grid;gap:12px}
  .pe-det .pe-izq{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}
  .pe-det .pe-izq>label,.pe-det .pe-izq>div{padding:9px 11px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.035)}
  .pe-det .pe-izq .pe-sub{padding:9px 11px}
  .pe-det .pe-izq>div:not(.pe-sub)>div[style*="display:flex"]{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;flex-direction:row!important}.pe-det .pe-izq>div>div>label{width:100%;min-width:0;justify-items:stretch!important}.pe-det .pe-izq select{width:100%}
  .pe-det [data-ret-sel]{min-width:0}.pe-det [data-ret-add]{width:auto!important;flex:none;white-space:nowrap}
  .pe-resumen{border-color:rgba(208,244,76,.42)!important;background:linear-gradient(165deg,rgba(208,244,76,.10),rgba(0,0,0,.34))!important;display:flex;flex-direction:column;gap:8px}
  .pe-resumen h3{margin-bottom:2px}
  .pe-resumen .pe-tot{gap:6px}.pe-resumen .pe-tot div{font:700 14px Arial}
  .pe-resumen .pe-tot .neto{margin-top:2px;padding:10px 12px;border:1px solid rgba(208,244,76,.5);border-radius:12px;background:rgba(0,0,0,.38);font:900 15px Arial;letter-spacing:.06em;align-items:center}
  .pe-resumen .pe-tot .neto b{font:900 26px Arial;color:#d0f44c}
  .pe-resumen .pe-prev{margin:0;padding:7px 10px;font-size:12px}
  .pe-resumen .pe-acciones{position:static;display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.4fr);gap:8px;padding:0;border:0;background:none}
  .pe-resumen .pe-acciones .pe-msg{grid-column:1/-1}
  .pe-resumen .pe-acciones [data-crear]{min-height:48px;font-size:14px;box-shadow:0 6px 18px rgba(208,244,76,.25)}
  .pe-resumen .pe-acciones [data-crear]:disabled{box-shadow:none}
  .pe-sm{display:none}
  .pe-link.pe-link-mk{display:inline-flex;align-items:center;gap:8px;margin-left:12px;padding:7px 16px 7px 12px;border-radius:99px;border:1px solid #b9e03a;background:linear-gradient(180deg,#e6ff6b 0%,#c4ee2c 55%,#9fcd12 100%);color:#16240a;font:900 11px Arial;letter-spacing:.07em;text-shadow:0 1px 0 rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -2px 0 rgba(0,0,0,.18),0 3px 0 #6f9410,0 7px 14px rgba(0,0,0,.45);transition:transform .12s,box-shadow .12s,filter .12s}
  .pe-link.pe-link-mk svg{flex:none;width:16px;height:16px;filter:drop-shadow(0 1px 0 rgba(255,255,255,.4))}
  .pe-link.pe-link-mk:hover{filter:brightness(1.07);transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),inset 0 -2px 0 rgba(0,0,0,.18),0 4px 0 #6f9410,0 10px 18px rgba(0,0,0,.5)}
  .pe-link.pe-link-mk:active{transform:translateY(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -1px 0 rgba(0,0,0,.2),0 1px 0 #6f9410,0 3px 8px rgba(0,0,0,.4)}
  .pe-btn.pe-mk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:99px;border:1px solid #b9e03a;background:linear-gradient(180deg,#e6ff6b 0%,#c4ee2c 55%,#9fcd12 100%);color:#16240a;font-weight:900;letter-spacing:.07em;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -2px 0 rgba(0,0,0,.18),0 3px 0 #6f9410,0 7px 14px rgba(0,0,0,.4);transition:transform .12s,filter .12s}
  .pe-btn.pe-mk-btn svg{flex:none;width:15px;height:15px}.pe-btn.pe-mk-btn:hover{filter:brightness(1.07);transform:translateY(-1px)}.pe-btn.pe-mk-btn:active{transform:translateY(2px)}
  .pe-mk{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.9);display:flex;flex-direction:column;font-family:Arial,sans-serif;color:#f5faef}
  .pe-mk-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.16)}
  .pe-mk-top b{font:900 14px Arial}.pe-mk-top small{display:block;color:#a9b5a3;font:600 12px Arial;margin-top:2px}
  .pe-mk-x{all:unset;cursor:pointer;padding:8px 16px;border:1px solid rgba(255,255,255,.3);border-radius:99px;font:800 12px Arial}
  .pe-mk-cuerpo{flex:1;overflow:auto;padding:14px;display:flex;flex-wrap:wrap;gap:16px;justify-content:center;align-content:flex-start}
  .pe-mk-fig{margin:0;max-width:min(560px,100%)}.pe-mk-fig img{display:block;max-width:100%;max-height:calc(100vh - 150px);border-radius:8px;background:#fff;cursor:zoom-in}.pe-mk-fig figcaption{margin-top:6px;text-align:center;font:800 12px Arial;letter-spacing:.06em}
  .pe-mk-fig.grande{max-width:100%}.pe-mk-fig.grande img{max-height:none;cursor:zoom-out}
  .pe-mk-aviso{width:100%;max-width:520px;text-align:center;font:700 14px/1.5 Arial;color:#ffd78a;padding:30px 10px}
  @media(max-width:700px){
    /* Vista móvil con la disposición de Effi (una columna, campos a todo el ancho, etiquetas a la izquierda) y los colores de INDOOR */
    .tc-pedido-fondo{overflow-x:hidden!important}.tc-pedido-card{max-width:100%;box-sizing:border-box;overflow-x:hidden}.tc-pedido-fondo:has(.pe-enc){padding:0!important}.tc-pedido-card:has(.pe-enc){border:0!important;border-radius:0!important;padding:10px!important}
    .pe{gap:8px}.pe-card{border-radius:10px;padding:9px 10px}.pe-grid,.pe-enc,.pe-izq{gap:6px!important}.pe label{gap:3px}
    .pe,.pe-card,.pe label,.pe-grid,.pe-linea,.pe-sub,.pe-forma{min-width:0;max-width:100%;box-sizing:border-box}.pe{overflow-x:hidden}
    .pe input[type=date]{-webkit-appearance:none;appearance:none;display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box;text-align:left;line-height:28px;height:30px;padding-right:6px}
    .pe input[type=date]::-webkit-date-and-time-value{text-align:left;min-width:0}.pe input[type=date]::-webkit-calendar-picker-indicator{margin:0}
    .pe h2{font-size:14px}.pe h3{font-size:11px;margin-bottom:5px}.pe .eyebrow{display:none}
    .pe label{font-size:9px;letter-spacing:.02em;text-align:left}
    .pe input,.pe select,.pe textarea{font-size:12px;text-align:left;min-height:28px;border-radius:7px}.pe input,.pe select{padding:0 8px;height:30px}.pe select{-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,#c9d3c1 50%),linear-gradient(135deg,#c9d3c1 50%,transparent 50%);background-position:calc(100% - 13px) 12px,calc(100% - 8px) 12px;background-size:5px 5px;background-repeat:no-repeat;padding-right:20px}.pe textarea{min-height:48px;padding:6px 9px}
    .pe-top{flex-direction:row;align-items:center}
    .pe-enc>.pe-grid,.pe-enc .pe-fila2{display:contents}.pe-enc{display:flex!important;flex-direction:column;gap:10px}.pe-enc .pe-top{order:-1}
    .pe-enc label{order:5}.pe-enc label:has([name="sucursal"]){order:1}.pe-enc label:has([name="bodega"]){order:2}.pe-enc label:has([name="centro_costos"]){order:3}.pe-enc label:has([name="fecha_entrega"]){order:4}
    .pe-enc label:has([name="moneda"]){order:5}.pe-enc label:has([name="trm"]){order:6}.pe-enc label:has([name="cliente-q"]){order:7}.pe-enc label:has([name="direccion"]){order:8}.pe-enc label:has([name="garantia"]){order:9}.pe-enc label:has([name="linea_prod"]){order:9}.pe-enc .pe-mk-btn{order:9}.pe-enc label:has([name="vendedor"]){order:10}.pe-enc label:has([name="global"]){order:11}
    .pe-lg{display:none}.pe-sm{display:inline}.pe-acciones .pe-btn{white-space:nowrap}
    .pe-linea{grid-template-columns:1fr!important;gap:5px;padding:8px 0}.pe-linea>*{grid-column:1/-1!important}.pe-total-linea{font-size:12px;min-height:22px}.pe-x{justify-self:end;color:#ff8a7a}
    .pe-tela{font-size:9px}
    .pe-btn{min-height:28px;font-size:10px;letter-spacing:.02em;width:100%;border-radius:8px;padding:0 10px}.pe-tipo button{padding:4px 9px;font-size:9px}.pe-pct{height:32px;min-width:30px;font-size:12px}
    .pe-btn.mini{min-height:26px;font-size:9px;padding:0 8px}
    .pe-link.pe-link-mk{display:inline-flex;width:auto;margin:6px 0 0;padding:6px 14px 6px 11px;font-size:10px}
    .pe-link{display:block;width:100%;box-sizing:border-box;text-align:center;background:rgba(255,255,255,.1);color:#f5faef;border-radius:8px;padding:6px;font-size:10px}
    .pe-tot{gap:6px}.pe-tot div{display:flex;justify-content:space-between;font:600 11px Arial}.pe-tot .neto{font-weight:900;font-size:13px}
    .pe-acciones{display:grid;grid-template-columns:1fr 1fr;gap:8px;position:static!important;padding:0;border:0;background:none}.pe-acciones .pe-msg{grid-column:1/-1}
    .pe-dos{display:flex!important;flex-direction:column;gap:10px}.pe-dos>.pe-izq{display:contents}.pe-izq>.pe-garm{order:1}.pe-izq>label:not(.pe-garm){order:2}.pe-izq>div:not(.pe-sub){order:3}.pe-dos>*:not(.pe-izq){order:4}.pe-izq>.pe-sub{order:5;grid-template-columns:1fr!important}
    .pe-izq>div:not(.pe-sub)>div[style*="display:flex"]{flex-direction:column;align-items:stretch}.pe-izq select{width:100%}
  }`;
  document.head.appendChild(css);
  const estadoInicial = () => ({ tipo: 'cotizacion', cat: null, estado: null, cliente: null, direccion: -1, conceptos: [], telas: {}, proy: { cliente: '', cargando: false, lista: [], carpeta: null, error: '' }, sinIvaTodos: false, formas: [], clave: nuevaClave(), previa: false, prev: null, ocupado: false, hecho: null, capturando: false, capTexto: '', capMsg: '', moneda: 'COP', trm: '1', global: '', propina: '', propinaPct: false, retenciones: [], pronto: '', fechaPronto: '', linea: '', mkSel: {}, listadoPrevio: null, mkFiles: {} });
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
  const lineaVacia = () => ({ articulo: 0, ref: '', descripcion: '', cantidad: 1, precio: '', descuento: 0, dtipo: 'valor', obsequio: false, sinIva: false, obs: '', impuesto: '', abierta: false, id_serie: null });
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const brutoDe = l => num(l.cantidad) * num(l.precio);
  // descuento de un concepto en $: obsequio = 100 %; en % se calcula sobre su bruto; en valor se usa tal cual
  const descDe = l => l.obsequio ? brutoDe(l) : (l.dtipo === 'pct' ? Math.round(brutoDe(l) * num(l.descuento)) / 100 : num(l.descuento));
  const totales = () => { const b = st.conceptos.reduce((s, l) => s + brutoDe(l), 0), d = st.conceptos.reduce((s, l) => s + descDe(l), 0); return { b, d, s: b - d }; };
  const pctDe = t => { const m = String(t || '').match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? Number(m[1].replace(',', '.')) : 0; };
  // Estimado local hasta la VISTA PREVIA (que trae el cálculo exacto de Effi): IVA de cada concepto, propina y retenciones sobre el subtotal
  function estimado() {
    const t = totales(); let imp = 0;
    st.conceptos.forEach(l => { const base = l.obsequio ? brutoDe(l) : brutoDe(l) - descDe(l); if (!l.sinIva) imp += base * pctDe(l.impuesto) / 100; });
    const prop = propinaValor() || 0, ret = (st.retenciones || []).reduce((a, id) => { const r = ((st.cat || {}).retenciones || []).find(x => x.id === id); return a + (r ? t.s * pctDe(r.nombre) / 100 : 0); }, 0);
    return { imp: Math.round(imp), ret: Math.round(ret), neto: Math.round(t.s + imp + prop - ret) };
  }
  const est = v => '≈ ' + money(v);
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
          <div class="pe-tipo" role="group" aria-label="Tipo de documento"><button type="button" data-tipo="cotizacion" class="${st.tipo === 'cotizacion' ? 'on' : ''}">COTIZACIÓN</button><button type="button" data-tipo="remision" class="${st.tipo === 'remision' ? 'on' : ''}">REMISIÓN</button></div><div class="pe-slot" data-pe-slot></div></div>
        <div class="pe-grid" style="margin-top:14px">
          <label>Sucursal*<select name="sucursal">${opciones(c.sucursales, suc)}</select></label>
          <label>Bodega*<select name="bodega">${opciones(bodegas, guard.bodega)}</select></label>
          <label>Centro de costos*<select name="centro_costos">${opciones(c.centros, guard.centro_costos)}</select></label>
          <label>Fecha de entrega*<input type="date" name="fecha_entrega" min="${entregaMinima()}" value="${esc(guard.fecha_entrega || entregaPorDefecto())}"></label>
          <label>Moneda*<select name="moneda">${(c.monedas || [{ id: 'COP', nombre: 'Peso Colombiano $ COP' }]).map(m => '<option value="' + m.id + '"' + (m.id === st.moneda ? ' selected' : '') + '>' + esc(m.nombre) + '</option>').join('')}</select></label>
          <label>TRM*<input name="trm" inputmode="decimal" value="${esc(st.moneda === 'COP' ? '1' : st.trm)}" ${st.moneda === 'COP' ? 'disabled' : ''}></label>
          <label>Vendedor<select name="vendedor">${opciones(c.vendedores, guard.vendedor)}</select></label>
          <label>Descuento global (%)<input name="global" inputmode="decimal" placeholder="0" value="${esc(st.global)}"></label>
        </div>
        <div class="pe-grid pe-fila2">
          <label>Cliente*<input name="cliente-q" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Buscar por nombre (3 letras)…" value="${esc(st.cliente ? st.cliente.nombre : guard['cliente-q'])}"></label>
          <label>Dirección del cliente<select name="direccion">${st.cliente && st.cliente.direcciones.length ? st.cliente.direcciones.map((d, i) => '<option value="' + i + '"' + (i === st.direccion ? ' selected' : '') + '>' + esc((d.ciudad ? d.ciudad + ' · ' : '') + d.direccion) + '</option>').join('') : '<option value="-1">No registra</option>'}</select></label>
        </div>
      </div>
      <div class="pe-card pe-con"><div class="pe-h3row"><h3>Conceptos</h3><label class="pe-chk pe-siniva-todos" style="margin-left:auto"><input type="checkbox" data-siniva-todos ${st.sinIvaTodos ? 'checked' : ''}> Sin IVA (todos)</label></div>
        <div data-lineas>${st.conceptos.map((l, i) => `
        <div class="pe-linea" data-i="${i}">
          <label class="pe-art">Artículo*${l.id_serie ? ' · SERIE' : ''}<input data-f="ref" name="articulo-q" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="search" placeholder="Referencia o nombre del artículo (ej. A200FUT01)" value="${esc(l.ref)}"></label>
          <label class="pe-desc">Descripción*<input data-f="descripcion" maxlength="120" value="${esc(l.descripcion)}" placeholder="Se llena al elegir el artículo"></label>
          <label>Cant.*<input data-f="cantidad" inputmode="decimal" value="${esc(l.cantidad)}" ${l.id_serie ? 'disabled' : ''}></label>
          <label>Precio ud.*<input data-f="precio" inputmode="decimal" value="${esc(l.precio)}"></label>
          <label>Bruto<input value="${money(brutoDe(l))}" disabled></label>
          <label>Descuento<div class="pe-dto"><input data-f="descuento" inputmode="decimal" value="${esc(l.obsequio ? '100' : l.descuento)}" ${l.obsequio ? 'disabled' : ''}><button class="pe-pct" type="button" data-dtipo title="Cambiar entre valor ($) y porcentaje (%)">${l.obsequio || l.dtipo === 'pct' ? '%' : '$'}</button></div></label>
          <label>Impuesto<select data-siniva-sel><option value="0"${l.sinIva ? '' : ' selected'}>${esc(l.impuesto || 'Sin impuesto')}</option>${l.impuesto ? `<option value="1"${l.sinIva ? ' selected' : ''}>Quitar IVA (sin impuesto)</option>` : ''}</select></label>
          <div><span style="color:#c9d3c1;font:800 11px Arial;letter-spacing:.08em">Total sin IVA</span><div class="pe-total-linea">${money(brutoDe(l) - descDe(l))}</div></div>
          <button class="pe-x" type="button" data-quitar aria-label="Quitar concepto">✕</button>
          <div class="pe-tela" data-tela>${telaHtml(l)}</div><div class="pe-mas"><button type="button" class="pe-link" data-detalles>${l.abierta ? '▾' : '▸'} Más detalles${l.obsequio || l.obs || l.sinIva ? ' ●' : ''}</button>${l.abierta ? `<div class="pe-detalles"><label class="pe-chk"><input type="checkbox" data-obsequio ${l.obsequio ? 'checked' : ''}> Sumar solo impuestos para Obsequio, degustación o donación (descuento del 100 %)</label><label class="pe-chk"><input type="checkbox" data-siniva ${l.sinIva ? 'checked' : ''}> Sin IVA en este concepto</label><label>Observación del concepto<input data-f="obs" maxlength="250" value="${esc(l.obs)}" placeholder="Opcional"></label></div>` : ''}</div>
        </div>`).join('')}</div>
        <div style="margin-top:10px"><button class="pe-btn sec mini" type="button" data-mas>+ Agregar concepto</button></div>
      </div>
      <div class="pe-abajo">
      <div class="pe-bloque-izq"><div class="pe-card pe-det"><h3>Detalles de la ${nombreDoc()}</h3>
        <div class="pe-grid pe-izq"><label>Observación<textarea name="observacion" maxlength="800" placeholder="Observación">${esc(guard.observacion)}</textarea></label>
          <div><div style="display:flex;gap:8px;align-items:end"><label style="flex:1;min-width:0">Retenciones<select data-ret-sel>${opciones((c.retenciones || []).filter(r => !st.retenciones.includes(r.id)), '', 'Seleccionar…')}</select></label><button class="pe-btn sec mini" type="button" data-ret-add>+ Agregar</button></div>
            <div class="pe-chips">${st.retenciones.map(id => { const r = (c.retenciones || []).find(x => x.id === id); return '<span class="pe-chip">' + esc(r ? r.nombre : id) + '<button type="button" data-ret-quitar="' + id + '" aria-label="Quitar">✕</button></span>'; }).join('')}</div></div>
          </div>
      </div>
      <div class="pe-card"><h3>Formas de pago</h3><div data-formas>${st.formas.map((f, i) => `
        <div class="pe-forma" data-j="${i}"><label>Forma de pago*<select data-g="id">${opciones(c.formas_pago.filter(x => st.tipo === 'cotizacion' || x.credito), f.id, 'Seleccionar…')}</select></label><label>Valor${st.formas.length > 1 ? '' : ' (vacío = total)'}<input data-g="valor" inputmode="decimal" value="${esc(f.valor)}"></label>${st.formas.length > 1 ? '<button class="pe-x" type="button" data-quitar-forma aria-label="Quitar">✕</button>' : '<span></span>'}</div>`).join('')}</div>
        <button class="pe-btn sec mini" type="button" data-mas-forma>+ Agregar forma de pago</button>
        <div class="pe-sub"><label>Descuento pronto pago ($)<input name="pronto" inputmode="decimal" placeholder="0" value="${esc(st.pronto)}"></label><label>Fecha pronto pago<input type="date" name="fecha_pronto" value="${esc(st.fechaPronto)}"></label></div>
        ${st.tipo === 'remision' ? '<p style="margin:10px 0 0;color:#a9b5a3;font:500 12px/1.5 Arial">En remisión solo van formas a crédito o «Contado a 1 día»; el cobro en caja se registra en Effi.</p>' : ''}
      </div></div>
      <div class="pe-card pe-resumen"><h3>Resumen</h3>
        <div class="pe-tot"><div><span>TOTAL BRUTO</span><b>${money(t.b)}</b></div><div><span>− Descuentos</span><b>${money(t.d)}</b></div><div><span>SUBTOTAL</span><b>${money(t.s)}</b></div>
          <div class="pe-propina"><span>+ Propina</span><span class="pe-dto"><input name="propina" inputmode="decimal" placeholder="0" value="${esc(st.propina)}"><button class="pe-pct" type="button" data-propina-tipo title="Cambiar entre valor ($) y porcentaje (%)">${st.propinaPct ? '%' : '$'}</button></span></div>
          <div><span>+ Impuestos</span><b data-imp>${st.prev ? money(st.prev.impuestos) : est(estimado().imp)}</b></div><div><span>− Retenciones</span><b data-ret>${st.prev ? money(st.prev.retenciones) : (st.retenciones.length ? est(estimado().ret) : '—')}</b></div>
          <div class="neto"><span>TOTAL NETO</span><b data-neto>${st.prev ? money(st.prev.total) : est(estimado().neto)}</b></div></div>
        <div data-previa class="pe-prev" ${st.prev ? '' : 'hidden'}>${st.prev ? 'Vista previa lista. Las formas de pago deben sumar el total neto: ' + money(st.prev.total) + '. Revisa y pulsa CREAR.' : ''}</div>
        <div class="pe-acciones"><button class="pe-btn sec" type="button" data-previa-btn>VISTA PREVIA</button><button class="pe-btn" type="button" data-crear ${st.prev && !apagado ? '' : 'disabled'}><span class="pe-lg">CREAR ${nombreDoc().toUpperCase()} EN EFFI</span><span class="pe-sm">CREAR</span></button><div class="pe-msg" data-msg>${apagado ? 'Creación frenada desde el servidor.' : (st.prev ? '' : 'Primero revisa la vista previa.')}</div></div>
      </div>
      </div>
      <div class="pe-sug" data-sug-global hidden></div>
    </div>`;
    enlazar();
  }
  function leerFormulario() {
    const d = st.cliente && st.direccion >= 0 ? st.cliente.direcciones[st.direccion] : null;
    return {
      tipo: st.tipo, clave: st.clave, sucursal: valor('sucursal'), bodega: valor('bodega'), centro_costos: valor('centro_costos'), fecha_entrega: valor('fecha_entrega'),
      cliente: st.cliente ? st.cliente.tercero : '', direccion: d || undefined, vendedor: valor('vendedor') || undefined, garantia: garantiaListado().proyecto, observacion: valor('observacion'),
      divisa: st.moneda, trm: st.trm, descuento_global: st.global || 0, propina: propinaValor() || 0, retenciones: st.retenciones, prontopago: st.pronto || 0, fecha_prontopago: st.fechaPronto,
      conceptos: st.conceptos.map(l => ({ articulo: l.articulo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, descuento: descDe(l), obsequio: l.obsequio, sin_iva: !!l.sinIva, observacion: l.obs, id_serie: l.id_serie || undefined })),
      formas_pago: st.formas.map(f => ({ id: f.id, valor: f.valor })),
    };
  }
  function invalidar() { if (st.prev) { st.prev = null; const b = q('[data-crear]'); if (b) b.disabled = true; const p = q('[data-previa]'); if (p) p.hidden = true; const i = q('[data-imp]'), n = q('[data-neto]'), r = q('[data-ret]'); refrescarTotales(); msg('Cambiaste algo: vuelve a pulsar VISTA PREVIA.', ''); } }
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
      fecha_creacion: hoy(), fecha_hora: new Date().toLocaleString('sv-SE').slice(0, 19), elaboro: ven ? ven.nombre : '', fecha_entrega: body.fecha_entrega, garantia: body.garantia || '', proyecto: String(body.garantia || '').trim(), observacion: body.observacion || '',
      cliente: { nombre: st.cliente ? st.cliente.nombre : '', documento: st.cliente ? st.cliente.documento : '', telefono: st.cliente ? (st.cliente.telefono || '') : '', email: st.cliente ? (st.cliente.email || '') : '', direccion: dir ? [dir.direccion, dir.ciudad, dir.provincia, dir.pais].filter(Boolean).join(' / ') : '' },
      vendedor: ven ? ven.nombre : '', sucursal: suc,
      conceptos: st.conceptos.map((l, i) => ({ referencia: l.ref, descripcion: l.descripcion, cantidad: num(l.cantidad), precio: num(l.precio), descuento: ls[i] ? ls[i].descuento : descDe(l), impuestos: ls[i] ? ls[i].impuestos : '', impuesto: ls[i] ? ls[i].impuesto : 0, total: ls[i] ? ls[i].total : null, observacion: l.obs || '' })),
      totales: { bruto: prev.bruto, descuento: prev.descuento, subtotal: prev.subtotal, propina: prev.propina, impuestos: prev.impuestos, retenciones: prev.retenciones, total },
      formas, subtotal: prev.subtotal, total,
    };
  }
  // proyecto y línea: los de la PRIMERA referencia del listado previo (ya no se escriben en el documento)
  function garantiaListado() {
    const rd = ((st.listadoPrevio || {}).refDatos) || {};
    const ref = String((st.conceptos.find(c => String(c.ref || '').trim()) || {}).ref || '').trim().toUpperCase();
    const d = rd[ref] || {};
    return { proyecto: String(d.proyecto || valor('garantia') || '').trim(), linea: String(d.linea || '').trim() };   // si el listado aún no tiene proyecto, sirve el que se eligió con el cliente
  }
  async function previa(crear) {
    if (st.ocupado) return;
    if (crear && !garantiaListado().proyecto) { msg('Falta el NOMBRE DEL PROYECTO: complétalo en el listado (LISTADO PREVIO) antes de crear la cotización.', 'error'); return; }
    if (valor('fecha_entrega') && valor('fecha_entrega') < entregaMinima()) { msg('La fecha de entrega debe ser al menos 5 días después de hoy (desde ' + entregaMinima() + ').', 'error'); return; }
    st.ocupado = true; msg(crear ? 'Creando en Effi…' : 'Calculando con Effi…', '');
    try {
      const body = leerFormulario();
      if (!crear) {
        const r = await post('/api/pedido-effi/vista-previa', body);
        st.prev = r.resumen; st.ocupado = false; st.vitCompacta = Object.values(st.mkSel || {}).some(v => v && v.length); dibujarConservando(); msg('Vista previa lista: revisa los totales y pulsa CREAR.', 'ok');
      } else {
        if (!confirm('Se va a crear en Effi una ' + nombreDoc() + ' por ' + money(st.prev.total) + '. ¿Confirmas?')) { st.ocupado = false; msg('', ''); return; }
        const r = await post('/api/pedido-effi/crear', body);
        const doc = construirDoc(r, body);   // se arma ANTES de redibujar: usa lo que hay en pantalla
        st.hecho = r; st.ocupado = false; guardarLS(CLAVE_BORRADOR, null);   // ya está en Effi: el borrador se descarta
        const lp = st.listadoPrevio || {};
        const preset = { linea: garantiaListado().linea || st.linea || lp.linea, proyecto: doc.proyecto, mockups: Object.fromEntries(Object.entries(st.mkSel).filter(([, v]) => v && v.length)), listado: lp.listado, disenos: lp.disenos, observaciones: lp.observaciones };
        if (window.PedidoListado) window.PedidoListado.abrir(panel, doc, { cat: (st.cat && st.cat.listado) || {}, onOtro: nuevoDocumento, onCerrar: cerrarVentana, preset });   // réplica de la cotización + «Continuar con el listado»
        else dibujar();
      }
    } catch (e) { st.ocupado = false; msg(String(e.message || e), 'error'); }
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
    if (!panel) return;
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
    const f = n => { const [e, d] = (Math.round(n * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').split('.'); return e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : ''); };
    return t.materiales.map(m => { const nombre = String(m.tela || m.material || '').replace(/^\s*\(\d+\)\s*/, '').trim(), cod = m.codigo || (String(m.tela || '').match(/^\s*\((\d+)\)/) || [])[1] || '';
      return '<b>' + (cod ? esc(cod) + ' ' : '') + '(' + esc(nombre) + ')</b>' + (num(l.cantidad) ? ' <b>' + f(m.promedio * num(l.cantidad)) + ' mts</b>' : '') + (m.bodega != null ? ' - STOCK <b>' + f(m.bodega) + ' mts</b>' : '') + (num(l.cantidad) && m.bodega != null && m.bodega < m.promedio * num(l.cantidad) ? ' <span style="color:#ff8a7a">· NO ALCANZA</span>' : ''); }).join('<br>');
  }
  function pintarTelas() { panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => { const l = st.conceptos[Number(row.dataset.i)], e = row.querySelector('[data-tela]'); if (l && e) { e.innerHTML = telaHtml(l); const t = st.telas[String(l.ref || '').toUpperCase()]; e.classList.toggle('no', !!t && t !== 'cargando' && !t.encontrado); } }); if (typeof pintarVitrina === 'function') try { pintarVitrina(); } catch (e) { /* nada */ } }
  async function cargarTela(ref) {
    const k = String(ref || '').toUpperCase(); if (!k || st.telas[k]) return;
    st.telas[k] = 'cargando'; pintarTelas();
    try { st.telas[k] = await api('/api/pedido-effi/tela?ref=' + encodeURIComponent(k)); } catch (e) { delete st.telas[k]; }
    pintarTelas();
  }
  function proyectoHtml(actual) {
    const y = st.proy, txt = String(actual || '');
    if (!st.cliente) return '<select name="proyecto_sel" disabled><option value="">Elige primero el cliente</option></select><input name="garantia" type="hidden" value="">';
    if (y.cargando) return '<select name="proyecto_sel" disabled><option value="">Cargando proyectos de la NAS…</option></select><input name="garantia" type="hidden" value="' + esc(txt) + '">';
    const enLista = y.lista.includes(txt), mostrarTxt = !enLista && (!!txt || !!st.proyNuevo || !y.lista.length);
    return '<select name="proyecto_sel"><option value="">' + (y.lista.length ? 'Seleccionar…' : 'Sin proyectos en MAESTROS: escribe uno nuevo') + '</option>' +
      y.lista.map(n => '<option value="' + esc(n) + '"' + (n === txt ? ' selected' : '') + '>' + esc(n) + '</option>').join('') +
      '<option value="__nuevo"' + (mostrarTxt ? ' selected' : '') + '>+ Proyecto nuevo (escribir)…</option></select>' +
      '<input name="garantia" maxlength="255" autocomplete="off" placeholder="Nombre del proyecto nuevo, ej. TEMPORADA 2027" value="' + esc(txt) + '"' + (mostrarTxt ? '' : ' hidden') + '>' +
      (y.error ? '<small style="color:#ffb547">' + esc(y.error) + '</small>' : '');
  }
  async function cargarProyectos() {
    const c = st.cliente; if (!c) return;
    const y = st.proy;
    if (y.cliente !== c.nombre) { const g = q('[name="garantia"]'); if (g) g.value = ''; st.proyNuevo = false; }
    Object.assign(y, { cliente: c.nombre, cargando: true, lista: [], carpeta: null, error: '' }); dibujar();
    try {
      let r = null;
      for (let intento = 0; intento < 8; intento++) {   // la NAS puede tardar en listar: el servidor responde «pendiente» y se vuelve a preguntar
        r = await api('/api/pedido-effi/proyectos?cliente=' + encodeURIComponent(c.nombre));
        if (!st.cliente || st.cliente.nombre !== c.nombre) return;
        if (!r.pendiente) break;
        await new Promise(ok => setTimeout(ok, 1500));
      }
      if (r.pendiente) r = { proyectos: [], carpeta: null, error: 'La NAS tarda en responder: escribe el proyecto o vuelve a elegir el cliente.' };
      Object.assign(y, { cargando: false, lista: r.proyectos || [], carpeta: r.carpeta, error: r.error || '' });
    } catch (e) { if (st.cliente && st.cliente.nombre === c.nombre) Object.assign(y, { cargando: false, lista: [], error: 'No pude traer los proyectos de la NAS: escribe uno nuevo.' }); }
    dibujar();
  }
  // Vista previa de los mockups: del proyecto elegido (carpeta MAESTROS del cliente en la NAS) y de la referencia del concepto (o de todas las elegidas)
  async function verMockups(l) {
    const ov = document.createElement('div'); ov.className = 'pe-mk';
    const tecla = e => { if (e.key === 'Escape') cierra(); };
    const cierra = () => { ov.remove(); document.removeEventListener('keydown', tecla); };
    const proyecto = garantiaListado().proyecto, conceptos = l ? [l] : st.conceptos.filter(c => c.articulo && String(c.ref || '').trim());
    const refs = [...new Set(conceptos.map(c => String(c.ref || '').trim()).filter(Boolean))];
    ov.innerHTML = '<div class="pe-mk-top"><div><b>Mockups' + (proyecto ? ' · ' + esc(proyecto) : '') + '</b><small>' + (refs.length ? 'Referencia' + (refs.length > 1 ? 's' : '') + ' ' + esc(refs.join(', ')) : '') + '</small></div><button class="pe-mk-x" type="button">CERRAR ✕</button></div><div class="pe-mk-cuerpo"><div class="pe-mk-aviso">Buscando en la NAS…</div></div>';
    document.body.appendChild(ov); document.addEventListener('keydown', tecla);
    ov.querySelector('.pe-mk-x').onclick = cierra; ov.addEventListener('click', e => { if (e.target === ov) cierra(); });
    const cuerpo = ov.querySelector('.pe-mk-cuerpo'), aviso = t => { cuerpo.innerHTML = '<div class="pe-mk-aviso">' + esc(t) + '</div>'; };
    if (!st.cliente) return aviso('Primero elige el cliente (debe ser un cliente existente).');
    if (!refs.length || (l && !l.articulo)) return aviso('Primero elige la referencia en el concepto.');
    if (!proyecto) return aviso('Primero elige el nombre del proyecto de la lista.');
    if (!st.proy.lista.includes(proyecto)) return aviso('«' + proyecto + '» es un proyecto nuevo: no tiene mockups guardados en la NAS. Elige uno de la lista para verlos.');
    try {
      const qs = 'cliente=' + encodeURIComponent(st.cliente.nombre) + '&proyecto=' + encodeURIComponent(proyecto);
      const respuestas = await Promise.all(refs.map(rf => api('/api/pedido-effi/mockups?' + qs + '&ref=' + encodeURIComponent(rf))));
      const items = respuestas.flatMap(x => x.items);
      if (!items.length) return aviso((respuestas.find(x => x.motivo) || {}).motivo || 'No encontré mockups para esa referencia.');
      const otro = (respuestas.find(x => x.otro_proyecto) || {}).otro_proyecto;
      cuerpo.innerHTML = (otro ? '<div class="pe-mk-aviso" style="padding:6px 10px">No están en «' + esc(proyecto) + '». Estos mockups son del proyecto «' + esc(otro) + '».</div>' : '') + items.map(i => '<figure class="pe-mk-fig"><img loading="lazy" alt="' + esc(i.ref + ' D' + i.diseno) + '" src="/api/pedido-effi/mockup-img?cliente=' + encodeURIComponent(st.cliente.nombre) + '&proyecto=' + encodeURIComponent(i.proyecto || proyecto) + '&carpeta=' + encodeURIComponent(i.carpeta) + '&archivo=' + encodeURIComponent(i.archivo) + '"><figcaption>' + esc(i.ref) + ' · DISEÑO ' + i.diseno + ' · ' + esc(i.proyecto || proyecto) + '</figcaption></figure>').join('');
      cuerpo.querySelectorAll('.pe-mk-fig img').forEach(im => im.onclick = () => im.closest('.pe-mk-fig').classList.toggle('grande'));
    } catch (e) { aviso('No pude traer los mockups: ' + String(e.message || e)); }
  }
  function elegirSug(idx) {
    const box = q('[data-sug-global]'); if (!box || !box._lista || !box._lista[idx]) return;
    if (box._tipo === 'c') {
      st.cliente = box._lista[idx]; st.direccion = st.cliente.direcciones.length ? 0 : -1; invalidar();
      const v = st.cat.vendedores.find(x => String(x.id) === String(st.cliente.vendedor)); const guardado = valor('vendedor');
      dibujar(); if (v && !guardado) { q('[name="vendedor"]').value = v.id; }
      preciosAnterioresTodos();
      cargarProyectos();
    } else {
      const l = st.conceptos[box._i], a = box._lista[idx];
      Object.assign(l, { articulo: a.id, ref: a.referencia, descripcion: a.descripcion.slice(0, 120), precio: a.precio || l.precio, impuesto: a.impuesto || '' }); aplicarPrecioAnterior(l); invalidar(); dibujar();
    }
  }
  // REPROGRAMACIÓN: si el cliente ya compró esa referencia, el precio es el de su última venta (no el de lista)
  const precioCache = {};
  function aplicarPrecioAnterior(l) {
    const cli = st.cliente && st.cliente.nombre, ref = String(l.ref || '').trim();
    if (!cli || !ref || l.precioManual) return;
    const k = cli + '|' + ref.toUpperCase();
    const pedir = precioCache[k] ? Promise.resolve(precioCache[k]) : api('/api/pedido-effi/precio-anterior?cliente=' + encodeURIComponent(cli) + '&ref=' + encodeURIComponent(ref)).then(r => (precioCache[k] = r));
    pedir.then(r => {
      if (!r || !r.encontrado || !st.conceptos.includes(l) || String(l.ref || '').trim() !== ref) return;   // ya cambió el artículo o el cliente
      l.precio = String(r.precio);
      invalidar();
      // si estás en el listado no se repinta CO/RM (eso te mandaba a CO/RM); el precio ya queda guardado
      if (!(window.PedidoListado && window.PedidoListado.activo && window.PedidoListado.activo())) dibujar();
      msg('Precio de la última venta a este cliente: $' + Number(r.precio).toLocaleString('es-CO') + ' (' + (r.numero ? 'CO/RM ' + r.numero : '') + (r.fecha ? ' · ' + r.fecha : '') + '). Puedes cambiarlo.', 'ok');
    }).catch(() => { /* sin historial: queda el precio de lista */ });
  }
  // al elegir el cliente, cada artículo del documento toma el último precio de ese cliente (salvo los escritos a mano)
  function preciosAnterioresTodos() {
    st.conceptos.forEach(l => { if (String(l.ref || '').trim()) aplicarPrecioAnterior(l); });
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
      mostrarSug(input, r.clientes.length ? r.clientes.map((c, i) => '<button type="button" data-i="' + i + '"><span class="n">' + resaltar(c.nombre, texto) + '</span><span class="d">' + esc(c.documento) + '</span></button>').join('') : '<div class="pe-sug-nota">Sin resultados para «' + esc(texto.trim()) + '»<br><small>Ese cliente no existe en Effi. ¿Es un cliente nuevo?</small><br><button type="button" class="pe-btn mini" data-cliente-nuevo style="margin-top:6px">+ CREAR CLIENTE NUEVO</button></div>', r.clientes, 'c');
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
    } catch (e) { mostrarSug(input, '<div class="pe-sug-nota">No se pudo buscar: ' + esc(String(e.message || e)) + '</div>', [], 'a', i); }
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
    const agregarRet = () => { const v = Number(q('[data-ret-sel]').value); if (v && !st.retenciones.includes(v)) { st.retenciones.push(v); invalidar(); dibujar(); } };
    q('[data-ret-add]').onclick = agregarRet;
    q('[data-ret-sel]').onchange = agregarRet;   // al elegir una retención de la lista ya se agrega (el botón queda por si acaso)
    panel.querySelectorAll('[data-ret-quitar]').forEach(b => b.onclick = () => { st.retenciones = st.retenciones.filter(x => x !== Number(b.dataset.retQuitar)); invalidar(); dibujar(); });
    ['sucursal', 'bodega', 'centro_costos', 'vendedor', 'fecha_entrega', 'garantia', 'observacion'].forEach(n => { const e = q('[name="' + n + '"]'); if (e) e.addEventListener('input', () => { invalidar(); if (n === 'sucursal') dibujar(); }); });
    const dir = q('[name="direccion"]'); if (dir) dir.onchange = () => { st.direccion = Number(dir.value); invalidar(); };
    const lp = q('[name="linea_prod"]'); if (lp) lp.onchange = () => { st.linea = lp.value; };
    const mkb = q('[data-mockups-todos]'); if (mkb) mkb.onclick = () => verMockups(null);
    const ps = q('[name="proyecto_sel"]'); if (ps) ps.addEventListener('change', () => {
      const t = q('[name="garantia"]'); if (!t) return;
      if (ps.value === '__nuevo') { st.proyNuevo = true; t.type = 'text'; t.hidden = false; t.value = ''; t.focus(); }
      else { st.proyNuevo = false; t.hidden = true; t.value = ps.value; }
      // al cambiar de proyecto, lo elegido del proyecto anterior NO se queda: solo se conserva lo que subiste tú desde tu equipo
      Object.keys(st.mkSel || {}).forEach(r => { st.mkSel[r] = (st.mkSel[r] || []).filter(x => typeof x !== 'string'); });
      st.vitCompacta = false;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const cq = q('[name="cliente-q"]');
    cq.addEventListener('input', () => { if (st.cliente) { st.cliente = null; st.direccion = -1; refrescarDirecciones(); } invalidar(); buscarCliente(cq.value, cq); });
    cq.addEventListener('keydown', teclaSug);
    const caja = q('[data-sug-global]');
    caja.addEventListener('mousedown', e => e.preventDefault());   // no le quita el foco al campo
    caja.addEventListener('click', e => {
      if (e.target.closest('[data-cliente-nuevo]')) {   // cliente nuevo: se guarda lo llenado, se abre CREAR CLIENTE y al volver se recupera el borrador
        guardarBorrador(); const f = document.querySelector('.tc-pedido-fondo'); if (f) f.remove();
        const tab = document.querySelector('.tab[data-kind="cliente-effi"]'); if (tab) tab.click();
        return;
      }
      const b = e.target.closest('[data-i]'); if (b) elegirSug(Number(b.dataset.i));
    });
    panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => {
      const i = Number(row.dataset.i), l = st.conceptos[i];
      row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
        const f = inp.dataset.f; l[f] = inp.value; invalidar();
        if (f === 'precio') l.precioManual = true;   // lo escribió el comercial: el precio anterior ya no lo cambia
        if (f === 'cantidad') l.cantManual = true;   // lo escribió el comercial en CO/RM: manda sobre las filas del listado
        if (f === 'ref') { l.articulo = 0; buscarArticulo(inp.value, inp, i); }
        else if (['cantidad', 'precio', 'descuento'].includes(f)) { row.querySelector('.pe-total-linea').textContent = money(brutoDe(l) - descDe(l)); row.querySelectorAll('input[disabled]')[0].value = money(brutoDe(l)); refrescarTotales(); if (f === 'cantidad') pintarTelas(); }
      }));
      row.querySelector('[data-f="ref"]').addEventListener('keydown', teclaSug);
      if (/^A\d+[A-Z]{1,8}\d{2}/i.test(String(l.ref || ''))) cargarTela(l.ref);
      row.querySelector('[data-dtipo]').onclick = () => { if (l.obsequio) return; l.dtipo = l.dtipo === 'pct' ? 'valor' : 'pct'; invalidar(); dibujar(); };
      row.querySelector('[data-detalles]').onclick = () => { l.abierta = !l.abierta; dibujar(); };
            const mas = row.querySelector('[data-vit-mas]'); if (mas) mas.onclick = () => { st.vitCompacta = false; document.querySelectorAll('[data-vit-mas]').forEach(b => { b.hidden = true; }); pintarVitrina(); const v = q('[data-vitrina]'); if (v) v.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
            const ss = row.querySelector('[data-siniva-sel]'); if (ss) ss.onchange = () => { l.sinIva = ss.value === '1'; st.sinIvaTodos = st.conceptos.every(x => x.sinIva); invalidar(); dibujar(); };
      const si = row.querySelector('[data-siniva]'); if (si) si.onchange = () => { l.sinIva = si.checked; st.sinIvaTodos = st.conceptos.every(x => x.sinIva); invalidar(); dibujar(); };
      const ob = row.querySelector('[data-obsequio]'); if (ob) ob.onchange = () => { l.obsequio = ob.checked; invalidar(); dibujar(); };
      row.querySelector('[data-quitar]').onclick = () => { st.conceptos.splice(i, 1); if (!st.conceptos.length) st.conceptos.push(lineaVacia()); invalidar(); dibujar(); };
    });
    q('[data-mas]').onclick = () => { const n = lineaVacia(); n.sinIva = st.sinIvaTodos; st.conceptos.push(n); invalidar(); dibujar(); };
    const sit = q('[data-siniva-todos]'); if (sit) sit.onchange = () => { st.sinIvaTodos = sit.checked; st.conceptos.forEach(l => { l.sinIva = sit.checked; }); invalidar(); dibujar(); };
    panel.querySelectorAll('[data-formas] .pe-forma').forEach(row => {
      const j = Number(row.dataset.j);
      row.querySelectorAll('[data-g]').forEach(inp => inp.addEventListener('input', () => { st.formas[j][inp.dataset.g] = inp.value; invalidar(); }));
      const x = row.querySelector('[data-quitar-forma]'); if (x) x.onclick = () => { st.formas.splice(j, 1); invalidar(); dibujar(); };
    });
    q('[data-mas-forma]').onclick = () => { st.formas.push({ id: '', valor: '' }); invalidar(); dibujar(); };
    q('[data-previa-btn]').onclick = () => previa(false);
    q('[data-crear]').onclick = () => previa(true);
    try { mejorar(); } catch (e) { console.warn('mejoras del formulario', e); }   // las mejoras nunca deben tumbar el formulario
  }
  function cierraSug(e) { if (!panel || !e.target.closest) return; const box = q('[data-sug-global]'); if (box && !box.hidden && !box.contains(e.target) && e.target !== box._ancla) box.hidden = true; }
  function refrescarTotales() { const t = totales(), tot = q('.pe-tot'); if (!tot) return; const v = tot.querySelectorAll('b'); v[0].textContent = money(t.b); v[1].textContent = money(t.d); v[2].textContent = money(t.s); if (!st.prev) { const e = estimado(), i = q('[data-imp]'), n = q('[data-neto]'), r = q('[data-ret]'); if (i) i.textContent = est(e.imp); if (n) n.textContent = est(e.neto); if (r) r.textContent = st.retenciones.length ? est(e.ret) : '—'; } }
  async function iniciar() {
    panel.innerHTML = '<div class="pe"><div class="pe-cargando" role="status" aria-live="polite"><img class="pe-logo-anim" src="/marca-indoor.svg" alt="Indoor"><div class="pe-barra-carga"><i></i></div><span>Cargando datos de Effi…</span></div></div>';
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
  document.addEventListener('click', cierraSug);
  // Teclado del celular: al enfocar un campo de la ventana del pedido (formulario, mockups o listado) se le deja espacio al final y se desplaza hasta verlo completo, por encima del teclado
  (function () {
    const vv = window.visualViewport; if (!vv) return;
    const fondo = () => document.querySelector('.tc-pedido-fondo');
    const tecladoAlto = () => Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    function ajustar() { const f = fondo(); if (!f) return; const k = tecladoAlto(); f.style.paddingBottom = k > 80 ? (k + 16) + 'px' : ''; }
    function mostrar(el) {
      if (!el || !el.scrollIntoView) return;
      const r = el.getBoundingClientRect(), libre = vv.height - 12;
      if (r.bottom > libre || r.top < 60) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    vv.addEventListener('resize', () => { ajustar(); const a = document.activeElement; if (a && a.closest && a.closest('.tc-pedido-fondo')) setTimeout(() => mostrar(a), 80); });
    vv.addEventListener('scroll', ajustar);
    document.addEventListener('focusin', e => {
      const t = e.target; if (!t || !t.closest || !t.closest('.tc-pedido-fondo') || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      [250, 600].forEach(ms => setTimeout(() => { ajustar(); if (document.activeElement === t) mostrar(t); }, ms));   // el teclado tarda en abrir: se reintenta
    });
    document.addEventListener('focusout', () => setTimeout(ajustar, 200));
  })();
  window.addEventListener('resize', () => posicionarSug());
  document.addEventListener('scroll', e => { const box = panel && q('[data-sug-global]'); if (box && !box.hidden && !box.contains(e.target)) box.hidden = true; }, true);
  // ================================================================ MEJORAS DINÁMICAS (solo se AGREGAN encima del formulario: no cambian campos, botones ni cálculos)
  // 1) pasos con avance  2) vitrina de conceptos (mockup + tela)  3) conceptos como tarjetas  4) resumen vivo  5) encabezado compacto  6) atajos y borrador
  const CLAVE_PREF = 'pedidoEffiPreferencias', CLAVE_BORRADOR = 'pedidoEffiBorrador';
  const leerLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const mockCache = {};
  let ultimoNeto = null;
  const cssPlus = document.createElement('style');
  cssPlus.textContent = `
  .pe-cargando{display:grid;justify-items:center;align-content:center;gap:18px;min-height:min(60vh,520px);color:#a9b5a3;font:700 13px Arial;letter-spacing:.08em}
  .pe-logo-anim{width:min(300px,62vw);height:auto;filter:drop-shadow(0 0 0 rgba(208,244,76,0));animation:peLogo 2s ease-in-out 2}
  @keyframes peLogo{0%{opacity:.35;transform:scale(.96);filter:drop-shadow(0 0 0 rgba(208,244,76,0))}50%{opacity:1;transform:scale(1);filter:drop-shadow(0 0 18px rgba(208,244,76,.55))}100%{opacity:.35;transform:scale(.96);filter:drop-shadow(0 0 0 rgba(208,244,76,0))}}
  .pe-barra-carga{width:min(280px,60vw);height:5px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
  .pe-barra-carga i{display:block;width:40%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,#d0f44c,transparent);animation:peBarra 1.3s ease-in-out 2}
  @keyframes peBarra{from{transform:translateX(-120%)}to{transform:translateX(280%)}}
  @media(prefers-reduced-motion:reduce){.pe-logo-anim,.pe-barra-carga i{animation:none}}
  .pe-pasos{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 auto 0 18px}
  .pe-paso{display:flex;align-items:center;gap:6px;padding:5px 11px 5px 6px;border-radius:99px;border:1px solid #3d4c3b;color:#a9b5a3;font:900 10.5px Arial;letter-spacing:.08em;cursor:pointer;transition:all .25s;background:rgba(0,0,0,.25)}
  .pe-paso i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#2a332c;color:#c9d3c1;font:900 11px Arial;font-style:normal;transition:all .25s}
  .pe-paso.ok{border-color:#6f9410;color:#d0f44c}.pe-paso.ok i{background:#9be37a;color:#0d140e}
  .pe-paso.aqui{border-color:#d0f44c;color:#f5faef;box-shadow:0 0 0 3px rgba(208,244,76,.15)}.pe-paso.aqui i{background:#d0f44c;color:#0d140e;animation:pePulso 1.6s ease-in-out 2}
  .pe-paso-sep{width:14px;height:2px;background:#3d4c3b;border-radius:2px}.pe-paso-sep.ok{background:#9be37a}
  @keyframes pePulso{50%{box-shadow:0 0 0 5px rgba(208,244,76,.25)}}
  .pe .pe-falta{outline:2px solid rgba(255,181,71,.75)!important;outline-offset:1px;border-radius:8px}
  .pe-linea{position:relative;border:1px solid rgba(255,255,255,.08)!important;border-radius:14px;padding:8px 10px!important;margin-bottom:8px;background:rgba(0,0,0,.18);transition:border-color .2s,background .2s,transform .2s}
  .pe-linea:hover{border-color:rgba(208,244,76,.35)!important;background:rgba(208,244,76,.04)}
  .pe-linea.lista{border-left:4px solid #9be37a!important}
  .pe-linea.nueva{animation:peEntra .45s cubic-bezier(.2,.8,.2,1)}
  @keyframes peEntra{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
  .pe-vitrina{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px}
  .pe-vit{display:block;width:280px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.25))}
  .pe-vit .foto{height:400px;border-radius:10px;background:#e9eeea;display:grid;place-items:center;overflow:hidden;color:#52604f;font:800 10px Arial;text-align:center;padding:4px}
  .pe-vit .foto{position:relative}.pe-vit .foto img{width:100%;height:100%;object-fit:contain}
  .pe-vit{cursor:pointer;transition:border-color .2s,box-shadow .2s}.pe-vit:hover{border-color:rgba(208,244,76,.5)}
  .pe-vit.elegido{border:2px solid #d0f44c;box-shadow:0 0 0 3px rgba(208,244,76,.2)}
  .pe-link.pe-vit-mas{padding:4px!important;margin-left:8px;min-width:0;background:transparent!important;border:0!important;box-shadow:none!important}.pe-link.pe-vit-mas[hidden]{display:none!important}.pe-link.pe-vit-mas{color:#d0f44c!important;align-self:center;height:24px;display:inline-flex;align-items:center;justify-content:center}.pe-link.pe-vit-mas svg{width:18px;height:18px;filter:drop-shadow(0 0 6px rgba(208,244,76,.6)) drop-shadow(0 2px 0 rgba(111,148,16,.9));transition:transform .35s cubic-bezier(.3,1.4,.4,1),filter .2s}.pe-link.pe-vit-mas:hover svg{transform:rotate(180deg);filter:drop-shadow(0 0 10px rgba(230,255,107,.9)) drop-shadow(0 2px 0 rgba(111,148,16,.9))}.pe-link.pe-vit-mas:active svg{transform:rotate(180deg) scale(.88)}.pe-link.pe-vit-mas:hover{background:transparent!important;transform:scale(1.15)}
  .pe-link.pe-sube{cursor:pointer;background:rgba(208,244,76,.08)!important;color:#d0f44c!important;box-shadow:none!important}.pe-link.pe-sube:hover{background:rgba(208,244,76,.2)!important}
  .pe-vit-up{cursor:pointer;border-style:dashed!important}.pe-vit-up .foto{background:rgba(208,244,76,.07);color:#d0f44c;font:900 13px/1.6 Arial;text-align:center;align-content:center}.pe-vit-up .foto small{color:#a9b5a3;font-weight:700}.pe-vit-up:hover .foto{background:rgba(208,244,76,.15)}
  .pe-vit-d{position:absolute;top:8px;left:8px;padding:4px 10px;border-radius:99px;background:#0d140e;color:#a9b5a3;font:900 11px Arial;letter-spacing:.08em}
  .pe-vit.elegido .pe-vit-d{background:#d0f44c;color:#0d140e}
  .pe-vit-lupa{all:unset;position:absolute;top:8px;right:8px;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(13,20,14,.8);cursor:zoom-in;font-size:14px}
  .pe-vit b.r{display:block;color:#d0f44c;font:900 20px Arial}.pe-vit .d{color:#f5faef;font:700 15px Arial;margin:4px 0 12px}
  .pe-vit .n{display:flex;gap:22px;font:800 12px Arial;color:#c9d3c1}.pe-vit .n strong{color:#f5faef;font-size:22px}
  .pe-vit .t{margin-top:10px;font:700 13px/1.5 Arial;color:#d0f44c;text-align:center}
  .pe-vit-vacia{border:1px dashed #3d4c3b;border-radius:14px;padding:22px;text-align:center;color:#7f8c79;font:700 13px Arial}
  .pe-resumen [data-neto]{transition:transform .25s,color .25s;display:inline-block}
  .pe-resumen [data-neto].sube{transform:scale(1.12);color:#fff}
  .pe-btn[data-crear]:not(:disabled){animation:peBrillo 1.8s ease-in-out 2}
  @keyframes peBrillo{50%{box-shadow:0 0 0 4px rgba(208,244,76,.35),0 0 22px rgba(208,244,76,.45)}}
  .pe-resumen .pe-listo-txt{font:800 11px Arial;color:#9be37a;margin-top:4px}
  .pe-enc.pe-compacto label:has(> [name="sucursal"]),.pe-enc.pe-compacto label:has(> [name="moneda"]),.pe-enc.pe-compacto label:has(> [name="trm"]),.pe-enc.pe-compacto label:has(> [name="centro_costos"]){display:none}
  .pe-ajustes{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:4px 10px;border:1px solid #3d4c3b;border-radius:99px;color:#c9d3c1;font:800 11px Arial}
  .pe-ajustes:hover{border-color:#d0f44c;color:#d0f44c}
  .pe-borrador{display:inline-flex;align-items:center;gap:6px;color:#7f8c79;font:700 10.5px Arial;margin-left:10px}
  .pe-borrador.si{color:#9be37a}
  .pe-atajos{color:#7f8c79;font:600 10.5px Arial;margin-top:6px}
  .pe-recuperar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;border:1px solid rgba(208,244,76,.4);border-radius:14px;background:rgba(208,244,76,.07);color:#e8f0e0;font:700 13px Arial}
  @media(max-width:999px){.pe-pasos{margin:8px 0 0;width:100%}.pe-paso{padding:4px 8px 4px 5px;font-size:9.5px}.pe-paso-sep{display:none}.pe-vit{width:calc(50% - 8px);box-sizing:border-box}.pe-vit .foto{height:260px}}
  /* Pantalla ancha: sin barra de título ni scroll en Conceptos. Los mockups ocupan el espacio que sobra (ancho fijo, alto variable) y las pestañas + CERRAR van dentro del formulario. */
  @media(min-width:1000px){
    /* Mockups DEBAJO de los conceptos, en una fila de altura FIJA; los conceptos usan el resto (con scroll solo si hay muchos) de la tarjeta */
    .pe-con{display:flex!important;flex-direction:column;overflow:hidden!important;min-height:0!important}
    .pe-con>.pe-h3row{flex:0 0 auto}
    .pe-con>[data-lineas]{flex:1 1 auto;min-height:150px;overflow:auto;scrollbar-width:thin}
    .pe-con>.pe-vitrina{flex:0 0 230px!important;height:230px!important;min-height:230px!important;max-height:230px!important;margin:8px 0 0!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;gap:12px!important;overflow-x:auto!important;overflow-y:hidden!important;scrollbar-width:none}
    .pe-vit{flex:0 0 240px!important;width:240px!important;height:270px!important;min-height:270px!important;max-height:270px!important;display:flex!important;flex-direction:column;overflow:hidden!important;box-sizing:border-box;margin:0!important}
    .pe-vit .foto{flex:1 1 0!important;min-height:0!important}
    /* Detalles de la cotización y Formas de pago UNIFICADOS en un solo bloque (a la izquierda del resumen) */
    .pe-abajo{grid-template-columns:minmax(0,2.1fr) minmax(0,1fr)!important}
    .pe-bloque-izq{display:grid!important;grid-template-columns:minmax(0,1.3fr) minmax(0,.8fr);gap:8px;align-items:stretch;min-height:0;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:6px;background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.22))}
    .pe-bloque-izq>.pe-card{border:0!important;background:none!important;backdrop-filter:none!important;padding:4px 8px!important}
    /* Resumen compacto: los totales en dos columnas (menos filas) para ganar altura a conceptos y mockups */
    .pe-abajo .pe-resumen h3{margin-bottom:2px!important}
    .pe-abajo .pe-msg:empty{display:none}
    /* Detalles del documento + forma de pago UNIFICADOS: un solo recuadro, dos columnas, sin huecos (la observación crece) */
    .pe-bloque-izq{align-items:stretch!important;padding:8px 10px!important}
    .pe-bloque-izq>.pe-card{display:flex!important;flex-direction:column;min-height:0}
    .pe-bloque-izq>.pe-card+.pe-card{border-left:1px solid rgba(255,255,255,.12)!important;padding-left:12px!important}
    .pe-bloque-izq .pe-izq{flex:1 1 auto;display:flex!important;flex-direction:column;min-height:0}
    .pe-bloque-izq .pe-izq>label{flex:1 1 auto;display:flex!important;flex-direction:column}
    .pe-bloque-izq textarea[name="observacion"]{flex:1 1 auto;min-height:60px!important;height:auto!important;resize:none}
    .pe-bloque-izq .pe-sub{margin-top:auto}
    .pe-bloque-izq [data-formas]{flex:0 0 auto}
    .pe-vit .foto{flex:1 1 0!important;height:auto!important;min-height:0!important;position:relative}
    .pe-vit .foto img{position:absolute;inset:0;width:100%;height:100%}
    .pe-vit .foto img{object-fit:contain!important;box-sizing:border-box!important;padding:6px!important}
    .pe-vit .foto{background:#fff!important}
    .pe-vit .t{flex:0 0 auto;max-height:40px;overflow:hidden;margin-top:6px}
    .pe-vit-vacia{flex:1 1 100%;height:auto!important;display:grid;place-content:center}
    .pe-slot{margin-left:auto;display:flex;align-items:center}
    .pe-slot .tc-pedido-herr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .pe-slot .tc-ptabs{margin:0!important}
    .pe-slot .tc-pedido-cerrar{min-height:34px}
    /* franja de abajo (detalles, formas de pago, resumen) más baja: el espacio se le da a los mockups */
    .pe{gap:6px!important;grid-template-rows:auto auto minmax(0,1fr) auto!important}
    .pe-abajo{gap:8px!important}
    .pe-abajo>.pe-card{padding:7px 11px!important}
    .pe-abajo h3{margin-bottom:3px!important;font-size:12px!important}
    .pe-abajo label{gap:1px!important;font-size:10px!important}
    .pe-abajo textarea{min-height:26px!important;height:30px!important}
    .pe-abajo input,.pe-abajo select{min-height:28px!important;font-size:12px!important}
    .pe-abajo .pe-izq{gap:5px!important}
    .pe-abajo .pe-sub{gap:5px!important}
    .pe-abajo .pe-chips{margin-top:2px}
    .pe-abajo .pe-tot{gap:0!important}
    .pe-abajo .pe-tot>div{font-size:12px;line-height:1.3;padding:1px 0}
    .pe-abajo .pe-tot .neto{font-size:15px!important;padding:4px 10px}
    .pe-abajo .pe-acciones{padding:4px 0 0!important;gap:6px}
    .pe-abajo .pe-acciones .pe-btn{min-height:32px!important}
    .pe-abajo .pe-msg{font-size:11px}
    .pe-abajo>.pe-card:nth-child(2) .pe-btn{min-height:26px!important}
  }
  /* Pantalla ancha: si hay muchos conceptos o mockups, se desplaza TODA la pestaña (no solo la lista de conceptos). */
    /* Cada espacio conserva SU tamaño: nada se aplasta cuando hay muchos conceptos (la pestaña entera se desplaza) */
    .tc-pedido-card [data-pedido-effi]{flex:0 0 auto!important;min-height:auto!important}
    .pe>*{flex-shrink:0!important;min-height:auto!important}
    .pe-enc,.pe-con,.pe-abajo,.pe-abajo>*{min-height:auto!important;flex-shrink:0!important}
    .pe-con>[data-lineas]{min-height:auto!important;flex:0 0 auto!important}
    .pe-con>.pe-vitrina{flex:0 0 270px!important;min-height:270px!important;max-height:270px!important;height:270px!important}
    .pe-vit{flex:0 0 240px!important;width:240px!important;height:270px!important;min-height:270px!important;max-height:270px!important}
  @media(min-width:1000px){
    .tc-pedido-card{height:auto!important;min-height:calc(100vh - 12px)!important}
    .tc-pedido-fondo{overflow:auto!important}
    .pe{height:auto!important;grid-template-rows:auto auto auto auto!important}
    .pe-con{overflow:visible!important;min-height:0!important}
    .pe-con>[data-lineas]{flex:0 0 auto!important;overflow:visible!important;min-height:0!important}
    .pe-abajo{min-height:0}
  }
  /* Celular: las pestañas CO/RM · LISTADO y CERRAR ocupan el ancho de la fila de arriba; el mockup se ve completo sin pasar de la pantalla */
  @media(max-width:999px){
    .pe-slot{width:100%;margin:0}
    .pe-slot .tc-pedido-herr{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
    .pe-slot .tc-ptabs{flex:1 1 auto;display:flex}
    .pe-slot .tc-ptabs button{flex:1 1 0}
    .pe-slot .tc-pedido-cerrar{flex:0 0 auto}
    .pe-vit{max-width:100%}
    .pe-vitrina{max-width:100%}
    /* móvil: la franja de mockups crece con su contenido (foto + nombre); no se encima con la tarjeta de abajo */
    .pe-con>.pe-vitrina{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;margin:10px 0 0!important;flex:0 0 auto!important}
    .pe-vit{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;margin-bottom:6px}
    .pe-vit .t{margin-top:8px;position:static}
    /* móvil: el resumen de sucursal/moneda/centro es UNA línea compacta, no un botón gigante */
    [data-ajustes]{font:800 11px Arial!important;padding:6px 10px!important;min-height:0!important;height:auto!important;line-height:1.2!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:flex!important;align-items:center;gap:6px;justify-content:space-between}
    .pe-recuperar{flex-direction:column;align-items:stretch}.pe-recuperar button{white-space:nowrap!important;flex:1 1 0;min-width:0;padding:8px 10px!important;font-size:12px!important}
    [data-ajustes] span{font-size:10px!important;white-space:nowrap}
  }
  `;
  document.head.appendChild(cssPlus);
  const lineaLista = l => !!(l.articulo && num(l.cantidad) > 0 && String(l.precio) !== '' && String(l.descripcion || '').trim());
  function estadoPasos() {
    const cliente = !!st.cliente && !!valor('bodega') && !!valor('centro_costos') && !!valor('fecha_entrega');
    const conceptos = st.conceptos.length > 0 && st.conceptos.every(lineaLista);
    const pago = st.formas.length > 0 && st.formas.every(f => !!f.id);
    return [['Cliente', cliente], ['Conceptos', conceptos], ['Pago', pago], ['Crear', !!st.prev]];
  }
  function pintarPasos() {
    const caja = q('[data-pasos]'); if (!caja) return;
    const p = estadoPasos(), aqui = p.findIndex(x => !x[1]);
    caja.innerHTML = p.map(([t, ok], i) => (i ? '<span class="pe-paso-sep' + (p[i - 1][1] ? ' ok' : '') + '"></span>' : '') + '<span class="pe-paso' + (ok ? ' ok' : '') + (i === aqui ? ' aqui' : '') + '" data-ir="' + i + '"><i>' + (ok ? '✓' : i + 1) + '</i>' + t.toUpperCase() + '</span>').join('');
    // campos obligatorios que faltan: en ámbar (solo los del paso donde estás o anteriores)
    panel.querySelectorAll('.pe-falta').forEach(e => e.classList.remove('pe-falta'));
    const marca = (sel, falta) => { const e = q(sel); if (e && falta) e.classList.add('pe-falta'); };
    if (aqui >= 0) {
      marca('[name="cliente-q"]', !st.cliente); marca('[name="bodega"]', !valor('bodega')); marca('[name="centro_costos"]', !valor('centro_costos'));
      marca('[name="fecha_entrega"]', !valor('fecha_entrega'));
      if (aqui >= 1) panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => { const l = st.conceptos[Number(row.dataset.i)]; if (!l) return; if (!l.articulo) row.querySelector('[data-f="ref"]').classList.add('pe-falta'); else if (String(l.precio) === '') row.querySelector('[data-f="precio"]').classList.add('pe-falta'); });
      if (aqui >= 2) panel.querySelectorAll('[data-formas] [data-g="id"]').forEach(s => { if (!s.value) s.classList.add('pe-falta'); });
    }
    panel.querySelectorAll('[data-lineas] .pe-linea').forEach(row => row.classList.toggle('lista', lineaLista(st.conceptos[Number(row.dataset.i)] || {})));
    caja.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => {
      const destino = ['[name="cliente-q"]', '[data-lineas] [data-f="ref"]', '[data-formas] [data-g="id"]', '[data-previa-btn]'][Number(b.dataset.ir)];
      const e = q(destino); if (e) { e.scrollIntoView({ block: 'center', behavior: 'smooth' }); e.focus && e.focus(); }
    });
    // CREAR solo «se ilumina» cuando todo está listo (sigue funcionando igual)
    const listo = p.slice(0, 3).every(x => x[1]), r = q('.pe-resumen');
    if (r) { let t = r.querySelector('.pe-listo-txt'); if (listo && !st.prev) { if (!t) { t = document.createElement('div'); t.className = 'pe-listo-txt'; r.querySelector('.pe-acciones').before(t); } t.textContent = '✓ Todo listo: pulsa VISTA PREVIA (Ctrl+Enter).'; } else if (t) t.remove(); }
  }
  function fotoMockup(l) {
    const proyecto = garantiaListado().proyecto, ref = String(l.ref || '').trim().toUpperCase();
    if (!st.cliente || !proyecto || !ref || !st.proy.lista.includes(proyecto)) return null;
    const k = st.cliente.nombre + '|' + proyecto + '|' + ref;
    if (!(k in mockCache)) {
      mockCache[k] = 'cargando';
      api('/api/pedido-effi/mockups?cliente=' + encodeURIComponent(st.cliente.nombre) + '&proyecto=' + encodeURIComponent(proyecto) + '&ref=' + encodeURIComponent(ref))
        .then(r => { mockCache[k] = (r.items || []).map(i => ({ url: '/api/pedido-effi/mockup-img?cliente=' + encodeURIComponent(st.cliente.nombre) + '&proyecto=' + encodeURIComponent(i.proyecto || proyecto) + '&carpeta=' + encodeURIComponent(i.carpeta) + '&archivo=' + encodeURIComponent(i.archivo), nombre: i.archivo, diseno: i.diseno }));
          const sel = st.mkSel[ref]; if (!sel || !sel.length) st.mkSel[ref] = mockCache[k].length === 1 ? [mockCache[k][0].url] : (sel || []);   // si hay uno solo, ya queda elegido
          pintarVitrina(); })
        .catch(() => { mockCache[k] = []; pintarVitrina(); });
    }
    return mockCache[k];
  }
  const urlsArchivo = new Map(); const urlArchivo = fl => { if (!urlsArchivo.has(fl)) urlsArchivo.set(fl, URL.createObjectURL(fl)); return urlsArchivo.get(fl); };
  function agregarMockups(ref, files) {   // lo que subes queda elegido, en orden (D1, D2…)
    ref = String(ref || '').trim().toUpperCase(); if (!ref) return;
    const lista = st.mkFiles[ref] = st.mkFiles[ref] || [], sel = st.mkSel[ref] = st.mkSel[ref] || [];
    [...files].forEach(fl => { if (!/^image\//.test(fl.type) || fl.size > 10 * 1024 * 1024) return; lista.push(fl); if (sel.length < 20) sel.push(fl); });
    st.vitCompacta = false; document.querySelectorAll('[data-vit-mas]').forEach(b => { b.hidden = true; });
    pintarVitrina(); guardarBorradorPronto();
  }
  function pintarVitrina() {
    const caja = q('[data-vitrina]'); if (!caja) return;
    const ls = st.conceptos.filter(l => l.articulo || String(l.ref || '').trim());
    if (!ls.length) { caja._html = ''; caja.innerHTML = '<div class="pe-vit-vacia">Elige un artículo: aquí verás sus mockups (clic para elegir los que vas a programar), la tela y el stock.</div>'; return; }
    const vistas = new Set();
    const html = ls.map(l => {
      const ref = String(l.ref || '').trim().toUpperCase(); if (vistas.has(ref)) return ''; vistas.add(ref);
      const f = fotoMockup(l), tela = telaHtml(l), sel = st.mkSel[ref] || [], solo = !!st.vitCompacta && sel.length > 0;   // resumida: solo lo elegido (para elegir más hay un botón en el concepto)
      const aviso = t => '<div class="pe-vit"><div class="foto">' + t + '</div>' + (tela ? '<div class="t">' + tela + '</div>' : '') + '</div>';
      const subidos = (st.mkFiles[ref] || []).map((fl, j) => { const k = sel.indexOf(fl); if (solo && k < 0) return '';
        return '<div class="pe-vit' + (k >= 0 ? ' elegido' : '') + '" data-vit-ref="' + esc(ref) + '" data-vit-file="' + j + '" title="Mockup subido: clic para elegirlo o quitarlo"><div class="foto"><img alt="Mockup subido" src="' + esc(urlArchivo(fl)) + '"><span class="pe-vit-d">' + (k >= 0 ? '✓ D' + (k + 1) : 'SUBIDO · ELEGIR') + '</span><button type="button" class="pe-vit-lupa" data-vit-borrar title="Quitar este mockup">✕</button></div></div>'; }).join('');
      const subir = '';   // el botón de subir mockups está en cada concepto (junto a VER MOCKUPS): no ocupa lugar en la vitrina
      if (!Array.isArray(f) || !f.length) return aviso(f === 'cargando' ? 'Buscando mockups…' : !st.cliente ? 'Elige el cliente para ver los mockups' : !garantiaListado().proyecto ? 'Elige el proyecto para ver los mockups' : 'Sin mockups en la NAS (pedido nuevo): usa ⬆ SUBIR MOCKUP en el concepto') + subidos + subir;
      return subidos + subir + f.filter(m => !solo || sel.indexOf(m.url) >= 0).map(m => { const k = sel.indexOf(m.url);
        return '<div class="pe-vit' + (k >= 0 ? ' elegido' : '') + '" data-vit-ref="' + esc(ref) + '" data-vit-url="' + esc(m.url) + '" title="Clic para ' + (k >= 0 ? 'quitarlo de' : 'usarlo en') + ' el listado"><div class="foto"><img alt="Mockup ' + esc(ref) + '" src="' + esc(m.url) + '"><span class="pe-vit-d">' + (k >= 0 ? '✓ D' + (k + 1) : 'ELEGIR') + '</span><button type="button" class="pe-vit-lupa" data-vit-lupa title="Ver en grande">🔍</button></div>' + (tela ? '<div class="t">' + tela + '</div>' : '') + '</div>'; }).join('');
    }).join('');
    if (caja._html === html) return; caja._html = html; caja.innerHTML = html;
    caja.querySelectorAll('[data-vit-file]').forEach(c => c.onclick = e => {
      const ref = c.dataset.vitRef, lista = st.mkFiles[ref] || [], fl = lista[Number(c.dataset.vitFile)]; if (!fl) return;
      const sel = st.mkSel[ref] = st.mkSel[ref] || [];
      if (e.target.closest('[data-vit-borrar]')) { lista.splice(lista.indexOf(fl), 1); const k = sel.indexOf(fl); if (k >= 0) sel.splice(k, 1); pintarVitrina(); return; }
      const k = sel.indexOf(fl); if (k >= 0) sel.splice(k, 1); else if (sel.length < 20) sel.push(fl);
      pintarVitrina();
    });
    caja.querySelectorAll('[data-vit-url]').forEach(c => c.onclick = e => {
      const ref = c.dataset.vitRef;
      if (e.target.closest('[data-vit-lupa]')) { const l = st.conceptos.find(x => String(x.ref || '').toUpperCase() === ref); if (l) verMockups(l); return; }
      const sel = st.mkSel[ref] = st.mkSel[ref] || [], k = sel.indexOf(c.dataset.vitUrl);
      if (k >= 0) sel.splice(k, 1); else if (sel.length < 20) sel.push(c.dataset.vitUrl);
      pintarVitrina(); guardarBorradorPronto();
    });
  }
  function animarNeto() {
    const n = q('[data-neto]'); if (!n) return;
    const t = n.textContent; if (ultimoNeto !== null && t !== ultimoNeto) { n.classList.add('sube'); setTimeout(() => n.classList.remove('sube'), 260); }
    ultimoNeto = t;
  }
  // borrador: lo que se ha llenado queda guardado en este navegador hasta crear el documento
  function guardarBorrador() {
    if (st.hecho || !st.cat) return;
    const campos = ['sucursal', 'bodega', 'centro_costos', 'vendedor', 'fecha_entrega', 'garantia', 'observacion'].reduce((o, n) => (o[n] = valor(n), o), {});
    const vacio = !st.cliente && st.conceptos.every(l => !l.articulo && !String(l.ref || '').trim());
    if (vacio) return;
    guardarLS(CLAVE_BORRADOR, { cuando: Date.now(), tipo: st.tipo, cliente: st.cliente, direccion: st.direccion, conceptos: st.conceptos, formas: st.formas, moneda: st.moneda, trm: st.trm, global: st.global, propina: st.propina, propinaPct: st.propinaPct, retenciones: st.retenciones, pronto: st.pronto, fechaPronto: st.fechaPronto, sinIvaTodos: st.sinIvaTodos, linea: st.linea, mkSel: Object.fromEntries(Object.entries(st.mkSel).map(([k, v]) => [k, (v || []).filter(x => typeof x === 'string')])), campos });
    panel._borradorTxt = '● Borrador guardado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const b = q('[data-borrador]'); if (b) { b.classList.add('si'); b.textContent = panel._borradorTxt; }
  }
  const guardarBorradorPronto = debounce(guardarBorrador, 700);
  function ponerCampos(campos) { Object.entries(campos || {}).forEach(([n, v]) => { const e = q('[name="' + n + '"]'); if (e && v && (n === 'fecha_entrega' || !e.value)) e.value = v; }); }
  function ofrecerBorrador() {
    const b = leerLS(CLAVE_BORRADOR, null); if (!b || !b.cuando || Date.now() - b.cuando > 7 * 864e5 || q('[data-recuperar]')) return;
    const d = document.createElement('div'); d.className = 'pe-recuperar'; d.dataset.recuperar = '';
    d.innerHTML = '<span>Tienes un borrador sin terminar' + (b.cliente ? ' de <b>' + esc(b.cliente.nombre) + '</b>' : '') + ' (' + new Date(b.cuando).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ').</span><span style="display:flex;gap:8px"><button class="pe-btn mini" type="button" data-rec-si>RECUPERAR</button><button class="pe-btn sec mini" type="button" data-rec-no>DESCARTAR</button></span>';
    const pe = q('.pe'); if (!pe) return; pe.prepend(d);
    d.querySelector('[data-rec-no]').onclick = () => { guardarLS(CLAVE_BORRADOR, null); d.remove(); };
    d.querySelector('[data-rec-si]').onclick = () => {
      ['tipo', 'cliente', 'direccion', 'conceptos', 'formas', 'moneda', 'trm', 'global', 'propina', 'propinaPct', 'retenciones', 'pronto', 'fechaPronto', 'sinIvaTodos', 'linea', 'mkSel'].forEach(k => { if (b[k] !== undefined) st[k] = b[k]; });
      st.prev = null; st.clave = nuevaClave();
      dibujar(); ponerCampos(b.campos);
      if (st.cliente) cargarProyectos().then(() => { ponerCampos({ garantia: (b.campos || {}).garantia }); const ps = q('[name="proyecto_sel"]'), g = (b.campos || {}).garantia; if (ps && g && st.proy.lista.includes(g)) ps.value = g; pintarPasos(); });
      pintarPasos(); pintarVitrina();
    };
  }
  function textoAjustes() {
    const b = q('[data-ajustes]'), enc = q('.pe-enc'); if (!b || !enc || !st.cat) return;
    const nom = (lista, v) => ((lista || []).find(x => String(x.id) === String(v)) || {}).nombre || 'sin elegir';
    b.innerHTML = '⚙ ' + esc(nom(st.cat.sucursales, valor('sucursal'))) + ' · ' + esc(st.moneda) + ' · ' + esc(nom(st.cat.centros, valor('centro_costos'))) + ' <span>' + (enc.classList.contains('pe-compacto') ? '▸ cambiar' : '▾ ocultar') + '</span>';
  }
  function mejorar() {
    if (st.hecho || !q('.pe-enc')) return;
    // 1) pasos (dentro del encabezado: no altera la cuadrícula de la ventana)
    const top = q('.pe-top'); if (top && !q('[data-pasos]')) { const p = document.createElement('div'); p.className = 'pe-pasos'; p.dataset.pasos = ''; top.firstElementChild.after(p); }
    // 5) encabezado compacto: Sucursal, Moneda, TRM y Centro de costos se guardan como preferencia y se esconden en «Ajustes»
    const pref = leerLS(CLAVE_PREF, {});
    const es = q('[name="sucursal"]');
    if (es && !es.value && pref.sucursal && [...es.options].some(o => o.value === pref.sucursal)) { es.value = pref.sucursal; es.dispatchEvent(new Event('input', { bubbles: true })); return; }   // redibuja (bodegas de esa sucursal) y vuelve a entrar aquí
    ['centro_costos', 'vendedor', 'bodega'].forEach(n => { const e = q('[name="' + n + '"]'); if (e && !e.value && pref[n] && [...e.options].some(o => o.value === pref[n])) e.value = pref[n]; });
    const enc = q('.pe-enc');
    const faltaOculto = ['sucursal', 'centro_costos'].some(n => !valor(n)) || (st.moneda !== 'COP' && !valor('trm'));
    if (!panel._encAbierto && !faltaOculto) enc.classList.add('pe-compacto'); else enc.classList.remove('pe-compacto');
    if (!q('[data-ajustes]')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pe-ajustes'; b.dataset.ajustes = '';
      b.onclick = () => { panel._encAbierto = enc.classList.contains('pe-compacto'); enc.classList.toggle('pe-compacto'); textoAjustes(); };
      const g2 = q('.pe-fila2'); if (g2) g2.before(b);
    }
    textoAjustes();
    // 2) vitrina dentro de Conceptos (llena el espacio vacío)
    // 3) la línea recién agregada entra animada
    const filas = panel.querySelectorAll('[data-lineas] .pe-linea');
    if (panel._nLineas !== undefined && filas.length > panel._nLineas) filas[filas.length - 1].classList.add('nueva');
    panel._nLineas = filas.length;
    // 6) atajos y borrador
    const res = q('.pe-resumen h3'); if (res && !q('[data-borrador]')) { const s = document.createElement('span'); s.className = 'pe-borrador'; s.dataset.borrador = ''; s.textContent = panel._borradorTxt || '○ Sin borrador'; if (panel._borradorTxt) s.classList.add('si'); res.appendChild(s); }
    const acc = q('.pe-acciones'); if (acc && !q('.pe-atajos')) { const a = document.createElement('div'); a.className = 'pe-atajos'; a.textContent = 'Atajos: Enter en Cant. = otro concepto · Ctrl+Enter = vista previa'; acc.after(a); }
    panel.querySelectorAll('[data-lineas] [data-f="cantidad"]').forEach(inp => inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return; e.preventDefault();
      const b = q('[data-mas]'); if (b) { b.click(); setTimeout(() => { const ult = panel.querySelectorAll('[data-lineas] [data-f="ref"]'); const u = ult[ult.length - 1]; if (u) u.focus(); }, 30); }
    }));
    if (!panel._plus) {   // escuchas delegadas, una sola vez por ventana
      panel._plus = true;
      const vivo = () => { if (!q('.pe-enc')) return; pintarPasos(); pintarVitrina(); animarNeto(); textoAjustes(); guardarBorradorPronto(); };
      const vivoPronto = debounce(vivo, 120);
      panel.addEventListener('input', vivoPronto); panel.addEventListener('change', e => {
        vivoPronto();
        const n = e.target && e.target.name; if (['sucursal', 'centro_costos', 'vendedor', 'bodega'].includes(n)) { const p = leerLS(CLAVE_PREF, {}); p[n] = e.target.value; guardarLS(CLAVE_PREF, p); }
      });
      panel.addEventListener('click', () => setTimeout(vivoPronto, 50));
    }
    pintarPasos(); pintarVitrina(); animarNeto();
    if (!panel._ofrecido) { panel._ofrecido = true; ofrecerBorrador(); }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && panel && panel.isConnected && q('.pe-enc')) { e.preventDefault(); const b = q('[data-previa-btn]'); if (b) b.click(); } });   // Ctrl+Enter = VISTA PREVIA
  // pestaña LISTADO antes de crear el documento: listado PREVIO con las referencias y cantidades del formulario (se guarda y pasa solo al crear)
  // mockup elegido en el listado (p. ej. FUT01): se agrega el artículo que este cliente ya tuvo con ese código (A200FUT01, etc.). Sin historial no se adivina.
  async function agregarReferencia(base, proyecto) {
    const codigo = String(base || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!codigo) return { no: true };
    if (!st.cliente) return { sinCliente: true };
    const pr = String(proyecto || '').trim();
    if (!pr) return { sinProyecto: true };
    // orden CO de ESTE proyecto cuyo Excel tiene la referencia del mockup (cada orden tiene una sola); la más reciente primero
    const o = await api('/api/pedido-effi/ordenes-referencia?cliente=' + encodeURIComponent(st.cliente.nombre) + '&proyecto=' + encodeURIComponent(pr) + '&codigo=' + encodeURIComponent(codigo));
    const ref = String(((o.ordenes || [])[0] || {}).referencia || '').toUpperCase();
    if (!ref) return { sinHistorial: true, codigo, proyecto: pr };
    if (st.conceptos.some(l => String(l.ref || '').trim().toUpperCase() === ref)) return { ya: true, ref };
    const r = await api('/api/pedido-effi/articulos?q=' + encodeURIComponent(ref));
    const a = (r.articulos || []).find(x => String(x.referencia || '').toUpperCase() === ref);
    if (!a) return { no: true, ref };
    let l = st.conceptos.find(x => !String(x.ref || '').trim()); if (!l) { l = lineaVacia(); st.conceptos.push(l); }
    Object.assign(l, { articulo: a.id, ref: a.referencia, descripcion: String(a.descripcion || '').slice(0, 120), precio: a.precio || l.precio, impuesto: a.impuesto || '' });
    aplicarPrecioAnterior(l);
    invalidar();
    return { ok: true, ref: a.referencia };
  }
  // LISTADO → CO/RM: la cantidad de la referencia pasa a ser el número de filas del listado (devuelve true si cambió)
  function setCantidadRef(ref, n) {
    const k = String(ref || '').trim().toUpperCase();
    const l = st.conceptos.find(x => String(x.ref || '').trim().toUpperCase() === k);
    if (!l) return false;
    l.cantManual = false;
    if (num(l.cantidad) === Number(n)) return false;
    l.cantidad = Number(n); invalidar(); return true;
  }
  // CO/RM → listado: ¿la cantidad la escribió el comercial en CO/RM y el listado aún no se igualó? (sin valor = leer; con valor = fijar)
  function cantidadManual(ref, valor) {
    const k = String(ref || '').trim().toUpperCase();
    const l = st.conceptos.find(x => String(x.ref || '').trim().toUpperCase() === k);
    if (!l) return false;
    if (valor === undefined) return !!l.cantManual;
    l.cantManual = !!valor; return l.cantManual;
  }
  // las referencias del documento tal como las necesita el listado (sin volver a abrirlo)
  function conceptosListado() {
    return st.conceptos.filter(l => String(l.ref || '').trim()).map(l => ({ referencia: l.ref, descripcion: l.descripcion, cantidad: num(l.cantidad) }));
  }
  // quita del documento la referencia de un mockup que estaba elegido (la línea queda libre para otra)
  function quitarReferencia(base) {
    const k = String(base || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const l = k ? st.conceptos.find(x => String(x.ref || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().endsWith(k)) : null;
    if (!l) return { no: true };
    st.conceptos = st.conceptos.filter(x => x !== l);
    if (!st.conceptos.length) st.conceptos.push(lineaVacia());
    invalidar();
    return { ok: true, ref: l.ref };
  }
  function listadoPrevio() {
    if (!window.PedidoListado || st.hecho) return false;   // el listado se abre cuando quieras, en el orden que decidas
    const conceptos = st.conceptos.filter(l => String(l.ref || '').trim()).map(l => ({ referencia: l.ref, descripcion: l.descripcion, cantidad: num(l.cantidad) }));
    st.guardCampos = ['sucursal', 'bodega', 'centro_costos', 'vendedor', 'fecha_entrega', 'garantia', 'observacion', 'cliente-q'].reduce((o, n) => (o[n] = valor(n), o), {});
    const doc = { tipo: st.tipo, numero: 'PREVIO', prefijo: '', cliente: { nombre: st.cliente ? st.cliente.nombre : '' }, proyecto: garantiaListado().proyecto, conceptos };
    const lp = st.listadoPrevio || {};
    const porMockups = Math.max(1, ...Object.values(st.mkSel).map(v => (v || []).length));   // tantos diseños como mockups elegidos en el documento
    window.PedidoListado.abrir(panel, doc, { cat: (st.cat && st.cat.listado) || {}, previo: true, onVolver: volverAlFormulario, preset: { linea: st.linea, proyecto: doc.proyecto, listado: lp.listado, refDatos: lp.refDatos, galPick: lp.galPick, disenos: Math.max(Number(lp.disenos) || 1, porMockups), observaciones: lp.observaciones } });
    return true;
  }
  function volverAlFormulario() {
    if (window.PedidoListado && window.PedidoListado.previo && window.PedidoListado.previo()) st.listadoPrevio = window.PedidoListado.datos();
    dibujar();
    const g = st.guardCampos || {}; Object.entries(g).forEach(([n, v]) => { const e = q('[name="' + n + '"]'); if (e && v && (n === 'fecha_entrega' || !e.value)) e.value = v; });
    const ps = q('[name="proyecto_sel"]'); if (ps && g.garantia && st.proy.lista.includes(g.garantia)) ps.value = g.garantia;
    try { pintarPasos(); } catch (e) { /* nada */ }
    return true;
  }
  // guarda lo llenado en el listado previo sin cambiar de pantalla (para agregar mockups uno a uno)
  function guardarListado() {
    if (window.PedidoListado && window.PedidoListado.previo && window.PedidoListado.previo()) st.listadoPrevio = window.PedidoListado.datos();
    return true;
  }
  window.PedidoEffi = { montar, listadoPrevio, volverAlFormulario, guardarListado, agregarReferencia, quitarReferencia, conceptosListado, setCantidadRef, cantidadManual, fechaEntrega: () => { try { return valor('fecha_entrega') || ''; } catch (e) { return ''; } } };
})();

// Avisos en el PC: cuando un comercial programa un pedido, la cuenta «Indoor Sport» recibe una notificación de escritorio.
// Usa la bitácora (solo lectura, misma sesión). Si la cuenta no es la de Indoor Sport, no hace nada.
(() => {
  if (window.__avisosProgramarListo) return;
  window.__avisosProgramarListo = true;
  const CLAVE = 'avisosProgramarUltimoId';
  const leer = () => { try { return Number(localStorage.getItem(CLAVE)) || 0; } catch (e) { return 0; } };
  const guardar = v => { try { localStorage.setItem(CLAVE, String(v)); } catch (e) { /* sin almacenamiento */ } };
  const soportado = () => 'Notification' in window;
  let ultimo = leer(), primera = true;

  async function esAdmin() {
    try { const r = await fetchT('/api/bitacora/mi', { credentials: 'same-origin', cache: 'no-store' }); return r.ok; } catch (e) { return false; }
  }
  function avisar(x) {
    if (!soportado() || Notification.permission !== 'granted') return;
    const cuerpo = (x.detalle || x.accion || 'Pedido programado') + (x.username ? ' · ' + x.username : '');
    try {
      const n = new Notification('Pedido programado · ' + (x.modulo || 'Producción'), { body: cuerpo, tag: 'prog-' + x.id });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* el navegador no permite la notificación */ }
  }
  async function revisar() {
    try {
      const r = await fetchT('/api/bitacora?q=Program&limite=100', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const items = (await r.json()).items || [];
      const maximo = items.reduce((m, x) => Math.max(m, x.id), ultimo);
      if (primera) { primera = false; ultimo = maximo; guardar(ultimo); return; }   // al abrir la página no avisa de lo ya programado
      items.filter(x => x.id > ultimo && /Program/.test(x.accion || '')).sort((a, b) => a.id - b.id).forEach(avisar);
      if (maximo > ultimo) { ultimo = maximo; guardar(ultimo); }
    } catch (e) { /* se reintenta en el siguiente ciclo */ }
  }
  function botonPermiso() {
    if (!soportado() || Notification.permission !== 'default') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '🔔 Activar avisos en el PC';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99998;padding:8px 12px;border-radius:99px;border:1px solid #d0f44c;background:#1d2a14;color:#e7ff9a;font:800 12px Arial;cursor:pointer';
    b.onclick = async () => {
      const p = await Notification.requestPermission();
      b.remove();
      if (p === 'granted') new Notification('Avisos activados', { body: 'Te avisaremos cuando un comercial programe un pedido.' });
    };
    document.body.appendChild(b);
  }
  (async () => {
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    if (!(await esAdmin())) return;
    botonPermiso();
    revisar();
    setInterval(revisar, 20000);
  })();
})();
