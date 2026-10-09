(() => {
  // FICHA TÉCNICA por REFERENCIA con el mismo diseño que la ficha de «Líneas de producto»: mockup de referencia a la izquierda y, a la derecha, pestañas con listas numeradas.
  // Se abre desde el botón «FICHA TÉCNICA» de cada tarjeta de producción o desde el menú del usuario. Solo lectura; la puede ver cualquier usuario con sesión.
  // Usa los estilos .li-* que ya carga linea-info.js (mismo aspecto que la ficha de línea).
  if (window.__fichaResumenListo) return;
  window.__fichaResumenListo = true;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const img = (id, a) => '/api/fichas/img?id=' + encodeURIComponent(id) + '&archivo=' + encodeURIComponent(a);
  const mockUrl = (ref, v) => '/api/fichas/mockup?ref=' + encodeURIComponent(ref) + '&v=' + (v || 0);
  const NOMBRE = { masc: 'MASCULINO', feme: 'FEMENINO', fem: 'FEMENINO', nino: 'NIÑO', nina: 'NIÑA' };
  const ORDEN = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
  function guardado(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  const CHK = guardado('mo_chk', {});
  const E = { lineas: [], puede: false, lista: null, lema: 'Nos inspira vestir a los ganadores', edicion: '' };
  let overlay = null, S = null;   // S: estado de la ficha abierta

  const css = document.createElement('style');
  css.textContent = `
  .fi-k{display:inline-block;min-width:96px;margin-right:12px;color:#8e9a87;font:800 10px Arial;letter-spacing:.14em;text-transform:uppercase}
  .fi-sec{margin:20px 0 6px;color:#8e9a87;font:800 10px Arial;letter-spacing:.2em;text-transform:uppercase}
  /* MAPA DE TELAS: qué pieza va en qué material, por colores */
  .ft{margin:18px 0 6px;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:16px 18px;background:rgba(255,255,255,.025);animation:ftIn .5s ease both}
  @keyframes ftIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @keyframes ftPulso{0%,100%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 0 7px transparent}}
  .ft-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .ft-ban{display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;font:900 clamp(15px,1.6vw,21px) Arial;letter-spacing:.06em;color:#0b1204;background:var(--c);animation:ftPulso 2.2s ease-in-out infinite}
  .ft-ban.dos{background:linear-gradient(90deg,var(--c1) 0 50%,var(--c2) 50% 100%)}
  .ft-sub{color:#aab5a2;font:700 13px Arial;letter-spacing:.04em}
  .ft-barra{display:flex;height:34px;border-radius:10px;overflow:hidden;margin:14px 0 12px;gap:3px}
  .ft-barra i{flex:var(--n);display:flex;align-items:center;justify-content:center;background:var(--c);color:#0b1204;font:900 13px Arial;letter-spacing:.05em;transition:flex .4s}
  .ft-mats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}
  .ft-mat{border-radius:14px;border:2px solid var(--c);background:color-mix(in srgb,var(--c) 11%,transparent);padding:12px 14px}
  .ft-mat h4{margin:0;display:flex;align-items:center;gap:10px;font:900 16px Arial;letter-spacing:.05em;color:var(--c)}
  .ft-mat h4 b{display:inline-grid;place-items:center;min-width:34px;height:34px;border-radius:9px;background:var(--c);color:#0b1204;font-size:15px}
  .ft-tela{margin:6px 0 10px;color:#e9efe3;font:700 13px Arial;letter-spacing:.03em}
  .ft-piezas{display:flex;flex-wrap:wrap;gap:7px}
  .ft-piezas span{padding:6px 11px;border-radius:999px;background:var(--c);color:#0b1204;font:800 12.5px Arial;letter-spacing:.03em;cursor:default;transition:transform .15s}
  .ft-piezas span:hover{transform:translateY(-2px) scale(1.05)}
  .ft-piezas em{font-style:normal;opacity:.7;margin-left:5px}
  /* dibujo animado de la prenda */
  .ft-cuerpo{display:grid;grid-template-columns:minmax(300px,52%) 1fr;gap:18px;align-items:center;margin-top:12px}
  .ft-dib{width:100%;max-height:230px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.45));animation:ftFlota 5s ease-in-out infinite}
  @keyframes ftFlota{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes ftTrazo{to{stroke-dashoffset:0}}
  @keyframes ftRelleno{from{fill-opacity:0}to{fill-opacity:1}}
  @keyframes ftBrillo{0%{transform:translateX(-120%)}60%,100%{transform:translateX(260%)}}
  .ft-part{fill:var(--c);stroke:rgba(0,0,0,.35);stroke-width:1.2;stroke-linejoin:round;transform-box:fill-box;transform-origin:center;opacity:0;animation:ftEnsambla 8s cubic-bezier(.2,.9,.3,1.1) infinite var(--d),ftBrilla 2.6s ease-in-out infinite calc(var(--d) + 1.2s);transition:opacity .25s}
  @keyframes ftEnsambla{0%{opacity:0;transform:translate(var(--x),var(--y)) rotate(var(--r)) scale(.5)}14%{opacity:1;transform:none}86%{opacity:1;transform:none}96%,100%{opacity:0;transform:translate(calc(var(--x) * -.5),calc(var(--y) * -.5)) rotate(calc(var(--r) * -1)) scale(.7)}}
  @keyframes ftBrilla{0%,100%{filter:drop-shadow(0 0 0 var(--c)) brightness(1)}50%{filter:drop-shadow(0 0 9px var(--c)) brightness(1.22)}}
  @keyframes ftMarcha{to{stroke-dashoffset:-14}}
  @keyframes ftLatido{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 26px -2px var(--c)}}
  @keyframes ftSube{0%{transform:translateY(20px) scale(.4);opacity:0}20%{opacity:.9}100%{transform:translateY(-190px) scale(1.1);opacity:0}}
  .ft-cuerpo{position:relative;overflow:hidden;border-radius:14px}
  .ft-cuerpo:before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 22% 55%,color-mix(in srgb,var(--g1,#b6f23a) 22%,transparent),transparent 55%),radial-gradient(circle at 40% 40%,color-mix(in srgb,var(--g2,#38bdf8) 16%,transparent),transparent 60%);pointer-events:none}
  .ft-cuerpo>*{position:relative}
  .ft-fx{position:absolute!important;inset:0;pointer-events:none;overflow:hidden}
  .ft-fx i{position:absolute;bottom:-8px;left:var(--l);width:var(--s);height:var(--s);border-radius:50%;background:var(--c);opacity:0;animation:ftSube var(--t) ease-in infinite var(--w)}
  .ft-mat{animation:ftLatido 3.6s ease-in-out infinite}.ft-mat:nth-child(2){animation-delay:1.8s}
  .ft-dib{max-height:360px;min-height:260px}
  .ft-3d{position:relative;height:380px;cursor:grab;touch-action:pan-y}.ft-3d:active{cursor:grabbing}.ft-3d canvas{width:100%!important;height:100%!important;display:block}
  .ft-hint{position:absolute;left:0;right:0;bottom:6px;text-align:center;font:800 10px Arial;letter-spacing:.2em;color:#8e9a87;pointer-events:none}
  .ft-mq *,.ft-mq{fill:url(#ftMq);stroke:rgba(0,0,0,.28);stroke-width:.8}
  .ft-mq .zap{fill:#f3f5f6;stroke:#6d757b}
  .ft-part path{fill:var(--c)}
  .ft-part path.tx{fill:url(#ftTejido);stroke:none;opacity:.13;mix-blend-mode:multiply}
  .ft-part path.sh{fill:url(#ftSombra);stroke:none}
  .ft-part path.ft-fold{fill:none;stroke:rgba(0,0,0,.22);stroke-width:1.1;stroke-linecap:round}
  .ft-part path.ft-rib{fill:none;stroke:rgba(0,0,0,.28);stroke-width:1}
  .ft-lbl{fill:#aab5a2;font:800 8px Arial;text-anchor:middle;letter-spacing:.16em}
  .ft-part.sin{--c:#59625a}
  .ft-det{fill:none;stroke:rgba(0,0,0,.45);stroke-width:1.5;stroke-linecap:round;stroke-dasharray:4 3;animation:ftMarcha 1.2s linear infinite}
  .ft-ico{width:26px;height:26px;flex:0 0 26px}
  .ft-ico *{fill:#0b1204;fill-opacity:.85;stroke:none}
  .ft-piezas span{display:inline-flex;align-items:center;gap:7px;padding:5px 12px 5px 7px;opacity:0;transform:scale(.6);animation:ftPop .45s cubic-bezier(.2,1.5,.4,1) forwards var(--d)}
  @keyframes ftPop{to{opacity:1;transform:none}}
  .ft-leyenda{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  .ft-leyenda b{display:inline-flex;align-items:center;gap:6px;font:800 11.5px Arial;color:#cfd8c7;letter-spacing:.05em}
  .ft-leyenda b:before{content:'';width:13px;height:13px;border-radius:4px;background:var(--c)}
  .ft:has(.ft-mat[data-m="M1"]:hover) .ft-part:not([data-m="M1"]),.ft:has(.ft-mat[data-m="M2"]:hover) .ft-part:not([data-m="M2"]),.ft:has(.ft-mat[data-m="M3"]:hover) .ft-part:not([data-m="M3"]),.ft:has(.ft-mat[data-m="M4"]:hover) .ft-part:not([data-m="M4"]){opacity:.18}
  @media(max-width:900px){.ft-cuerpo{grid-template-columns:1fr}}
  /* plano técnico con rollos */
  .ft-flat{display:block;width:100%;max-height:330px;margin:10px 0 4px;background:radial-gradient(circle at 50% 45%,rgba(255,255,255,.05),transparent 70%);border-radius:12px}
  .fp{opacity:0;transform-box:fill-box;transform-origin:center;animation:fpIn .7s cubic-bezier(.2,1.4,.4,1) forwards var(--d),fpPulso 4.5s ease-in-out infinite calc(var(--d) + 1.2s);transition:opacity .25s}
  @keyframes fpIn{from{opacity:0;transform:scale(.6) translateY(14px)}to{opacity:1;transform:none}}
  @keyframes fpPulso{0%,100%{filter:drop-shadow(0 0 0 var(--c))}50%{filter:drop-shadow(0 0 7px var(--c))}}
  .fp path{fill:var(--c);stroke:rgba(0,0,0,.6);stroke-width:1.3;stroke-linejoin:round}
  .fp path.tx{fill:url(#fpTejido);stroke:none;opacity:.12}.fp path.sh{fill:url(#fpSombra);stroke:none}
  .fp path.st{fill:none;stroke:rgba(0,0,0,.45);stroke-width:1.1;stroke-dasharray:3 2.5;animation:ftMarcha 1.4s linear infinite}
  .fp-cab{fill:none;stroke:rgba(5,9,3,.75);stroke-width:7;stroke-linecap:round}
  .fp-flujo{fill:none;stroke:var(--c);stroke-width:2.2;stroke-dasharray:3 7;stroke-linecap:round;opacity:.9;animation:ftMarcha .9s linear infinite}
  .fp-halo{fill:none;stroke:var(--c);stroke-width:1.5;opacity:.5;animation:fpOnda 2.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
  @keyframes fpOnda{from{transform:scale(.9);opacity:.6}to{transform:scale(1.35);opacity:0}}
  .fp-id{font:900 15px Arial;text-anchor:middle;letter-spacing:.06em}.fp-tela{font:700 10.5px Arial;fill:#e9efe3;text-anchor:middle}.fp-n{font:600 9.5px Arial;fill:#8e9a87;text-anchor:middle}
  .fp-lbl{font:800 9px Arial;fill:#8e9a87;text-anchor:middle;letter-spacing:.18em}
  .ft-flat [data-m]{transition:opacity .25s}
  .fit.fit-movil{min-width:0}.fit-movil .fit-c{font-size:27px}.fit-movil .fit-h{font-size:22px}
  .fit-wrap{overflow-x:auto;border-radius:6px;background:#fff}.fit{display:block;width:100%;min-width:760px;height:auto;font-family:Arial,Helvetica,sans-serif}
  .fit path{stroke:none}.fit-h{font:700 13px Arial}.fit-c{font:700 15px Arial;fill:#000}
  .fp-nodo{opacity:0;animation:fpIn .6s cubic-bezier(.2,1.4,.4,1) forwards var(--d);transform-box:fill-box;transform-origin:left center}
  .fp-nodo rect{fill:#0d1409;stroke:var(--c);stroke-width:1.6}
  .fp-nodo .fp-sil *{fill:var(--c);fill-opacity:.9;stroke:rgba(0,0,0,.55);stroke-width:1}
  .fp-nt{font:800 10px Arial;fill:#e9efe3;letter-spacing:.04em}.fp-nc{font:900 10px Arial;text-anchor:end}
  .ft:has(.ft-mat[data-m="M1"]:hover) .ft-flat [data-m]:not([data-m="M1"]),.ft:has(.ft-mat[data-m="M2"]:hover) .ft-flat [data-m]:not([data-m="M2"]),.ft:has(.ft-mat[data-m="M3"]:hover) .ft-flat [data-m]:not([data-m="M3"]),.ft:has(.ft-mat[data-m="M4"]:hover) .ft-flat [data-m]:not([data-m="M4"]){opacity:.15}
  .ft-mats{margin-top:6px}.ft-mat{padding:9px 12px}.ft-tela{margin:4px 0 7px}
  /* buscador de mockups en el NAS */
  .fm-over{position:fixed;inset:0;z-index:2147483000;background:rgba(3,6,2,.82);display:grid;place-items:center;padding:clamp(8px,2vw,28px)}
  .fm-main{width:min(1280px,100%);height:min(92vh,100%);display:flex;flex-direction:column;border-radius:18px;background:#0b110a;border:1px solid rgba(195,238,63,.25);box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
  .fm-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
  .fm-top h3{margin:0;font:900 15px Arial;letter-spacing:.1em;color:#d7ff3a;flex:1 1 220px}
  .fm-top input{flex:1 1 260px;max-width:420px;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#141c11;color:#e9efe3;font:600 13px Arial}
  .fm-top button{width:auto!important;flex:0 0 auto;min-width:0;padding:8px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:#141c11;color:#e9efe3;font:800 12px Arial;cursor:pointer}
  .fm-top .fm-x{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  .fm-cont{color:#8e9a87;font:700 12px Arial}
  .fm-cuerpo{flex:1;overflow:auto;padding:16px 18px 22px}
  .fm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
  .fm-card{width:auto!important;min-width:0;display:grid;gap:5px;padding:0 0 10px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#121a0f;color:#e9efe3;text-align:left;cursor:pointer;overflow:hidden;transition:transform .15s,border-color .15s,box-shadow .15s}
  .fm-card:hover{transform:translateY(-3px);border-color:#d7ff3a;box-shadow:0 10px 26px rgba(195,238,63,.18)}
  .fm-card img{width:100%;height:230px;object-fit:contain;background:#262b24;display:block}
  .fm-card b{padding:0 10px;font:800 11.5px Arial;word-break:break-word}.fm-card small{padding:0 10px;color:#8e9a87;font:600 10.5px Arial}
  .fm-msg{color:#aab5a2;font:700 14px Arial;text-align:center;padding:50px 10px}
  .fi-obs{display:block;margin-top:3px;color:#8e9a87;font:italic 400 12.5px Arial}
  .fi-hojas{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0}.fi-hojas button,.fi-tallas button{width:auto!important;min-height:0!important;padding:6px 14px!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:999px!important;background:transparent!important;color:#c9d3c1!important;font:700 11px Arial!important;letter-spacing:.1em;cursor:pointer}
  .fi-hojas button[aria-pressed=true],.fi-tallas button[aria-pressed=true]{background:var(--ac)!important;color:#10140a!important;border-color:var(--ac)!important}
  .fi-tallas{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 4px}.fi-tallas small{font:800 10px Arial;letter-spacing:.16em;color:#8e9a87;margin-right:4px}
  .fi-tabla{width:100%;border-collapse:collapse;margin:8px 0 4px;font:600 13px Arial;color:#e8eee2}.fi-tabla th{padding:9px 8px;text-align:center;color:var(--ac);font:800 10.5px Arial;letter-spacing:.1em;border-bottom:1px solid rgba(255,255,255,.14)}
  .fi-tabla td{padding:10px 8px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07)}.fi-tabla td.l{text-align:left;color:#8e9a87;font:800 10px Arial;letter-spacing:.1em}
  .fi-tabla .hl{background:rgba(208,244,76,.16);color:#fff;box-shadow:inset 0 0 0 1px var(--ac)}
  .fi-scroll{overflow-x:auto}.fi-titulo{margin:18px 0 2px;color:#dfe7d8;font:800 11px Arial;letter-spacing:.14em;text-transform:uppercase}
  .fi-acc{display:flex;gap:8px;align-items:center;margin-left:auto;padding-right:48px}.fi-acc button{width:auto!important;min-height:0!important;padding:6px 12px!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:999px!important;background:transparent!important;color:#c9d3c1!important;font:700 11px Arial!important;cursor:pointer}
  .li-top span.fi-acc{padding-left:0;border-left:0}
  .fi-buscar input{width:100%;min-height:48px;padding:0 16px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.05);color:#fff;font:500 15px Arial;margin-top:18px}
  .fi-res{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));margin-top:14px}
  .fi-res button{display:grid;gap:4px;padding:0 0 10px!important;min-height:0!important;width:auto!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:14px!important;background:rgba(255,255,255,.03)!important;color:#fff!important;cursor:pointer;text-align:left;overflow:hidden}
  .fi-res button:hover{border-color:var(--ac)!important}.fi-res .p{height:96px;background:#eceee9}.fi-res .p img{width:100%;height:100%;object-fit:contain}.fi-res b{padding:0 10px;color:var(--ac);font:900 16px Arial}.fi-res small{padding:0 10px;color:#8e9a87;font:500 11px Arial}
  /* pantalla completa: la ficha usa todo el espacio y reparte el contenido en columnas para no desplazarse tanto */
  .li-overlay:has(.li-card.fi){padding:clamp(6px,1.2vw,18px)}
  .li-card.fi,.li-card.fi.has-mock{width:min(1760px,99vw);height:min(97vh,calc(100vh - 12px));max-height:none}
  .li-card.fi .li-mock{flex:0 0 33%;max-width:560px;min-width:300px;padding:20px 22px 16px}
  .li-card.fi .li-main{padding:20px 32px 0}
  .li-card.fi .li-tabs{margin-top:14px}
  .li-card.fi .li-pane{padding:16px 6px 10px 0}
  .li-card.fi .li-title h2{font-size:clamp(30px,3.6vw,46px)}.li-card.fi .li-bar{height:40px}
  .li-card.fi .li-sub{margin:8px 0 4px 22px}
  .li-card.fi .li-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));column-gap:44px;margin-top:8px}
  .li-card.fi .li-list li{padding:11px 4px;font-size:14px}
  .li-card.fi .li-list li:last-child{border-bottom:1px solid rgba(255,255,255,.07)}
  .fi-dos{display:grid;grid-template-columns:1fr 1fr;gap:6px 34px;align-items:start}.fi-col{min-width:0;border-top:2px solid var(--ac);padding-top:6px}.fi-col>.fi-sec{margin:10px 0 0}
  @media(max-width:1000px){.fi-dos{grid-template-columns:1fr}}
  .fi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));gap:2px 30px}
  .fi-bloque{min-width:0}.fi-bloque .fi-titulo{margin:12px 0 0}
  .fi-tabla{table-layout:fixed;min-width:0!important;width:100%!important}.fi-tabla th,.fi-tabla td{padding:8px 2px;overflow:hidden;text-overflow:ellipsis}.fi-tabla td.l,.fi-tabla th:first-child{width:62px;text-align:left;padding-left:4px}
  .li-card.fi .li-foot{padding-top:10px;padding-bottom:12px}
  .li-card.fi .li-tabs{overflow-x:visible;flex-wrap:wrap;gap:6px 22px}
  @media(max-width:900px){.li-card.fi,.li-card.fi.has-mock{height:100vh;width:100vw}.li-card.fi .li-mock{flex:0 0 auto;max-width:none}.li-card.fi .li-main{padding:16px 18px 0}}
  .fi-chk{display:flex;align-items:flex-start;gap:14px;cursor:pointer;width:100%}.fi-chk input{width:22px;height:22px;flex:none;accent-color:var(--ac);margin-top:1px}.fi-chk.hecho{opacity:.5}.fi-chk.hecho span{text-decoration:line-through}
  .fi-prog{display:flex;align-items:center;gap:12px;margin:16px 0 0;color:#8e9a87;font:800 11px Arial;letter-spacing:.08em}.fi-prog i{flex:1;height:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}.fi-prog s{display:block;height:100%;background:var(--ac);text-decoration:none}
  .fi-prog button{width:auto!important;min-height:0!important;padding:4px 12px!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:999px!important;background:transparent!important;color:#c9d3c1!important;font:700 10px Arial!important;cursor:pointer}
  .fi-calc .fila{margin:14px 0 4px}.fi-calc .fila>b{display:block;margin-bottom:8px;color:#dfe7d8;font:800 11px Arial;letter-spacing:.14em}.fi-calc .campos{display:flex;gap:8px;flex-wrap:wrap}
  .fi-calc label{display:grid;gap:3px;text-align:center;color:#8e9a87;font:800 10px Arial}.fi-calc input{width:62px;min-height:44px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.05);color:#fff;text-align:center;font:800 16px Arial}
  .fi-calc input:focus{outline:2px solid var(--ac)}
  .fi-total{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:18px;padding:14px 18px;border:1px solid var(--ac);border-radius:16px;background:rgba(208,244,76,.07)}.fi-total b{font:900 34px Arial;color:var(--ac)}.fi-total span{color:#c9d3c1;font:600 13px Arial}
  .fi-total button{margin-left:auto;width:auto!important;min-height:0!important;padding:6px 14px!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:999px!important;background:transparent!important;color:#c9d3c1!important;font:700 11px Arial!important;cursor:pointer}
  .fi-mockacc{position:relative;z-index:1;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px}.fi-mockacc button{width:auto!important;min-height:0!important;padding:7px 14px!important;border:1px solid rgba(16,21,14,.35)!important;border-radius:999px!important;background:rgba(255,255,255,.7)!important;color:#2c3626!important;font:800 10.5px Arial!important;letter-spacing:.06em;cursor:pointer}
  .fi-mockacc button.pri{background:#c3ee3f!important;border-color:#c3ee3f!important;color:#10140a!important}
  .li-mock.sobre{outline:3px dashed #5a7a1a;outline-offset:-10px}
  .fi-sinmock{position:relative;z-index:1;flex:1;display:grid;place-items:center;text-align:center;gap:10px;margin:12px 0;padding:18px;border:2px dashed #9aa58f;border-radius:16px;color:#4a5640;font:700 13px/1.5 Arial}
  .fi-vacio{margin:20px 0;color:#9aa693;font:italic 400 14.5px/1.6 Arial}
  @media print{body>*:not(.li-overlay){display:none!important}.li-overlay{position:static!important;background:#fff!important;padding:0!important;backdrop-filter:none!important}.li-card{max-height:none!important;width:100%!important;background:#fff!important;color:#000!important;border:0!important}
    .li-card *{color:#000!important;background:transparent!important;border-color:#bbb!important}.li-close,.li-tabs,.fi-acc,.fi-hojas,.fi-tallas{display:none!important}.li-pane{overflow:visible!important}}
  `;
  document.head.appendChild(css);

  async function api(u) {
    const r = await fetch(u, { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'No pude cargar la ficha');
    return j;
  }
  async function permisos() {
    if (E.permCargado) return;
    E.permCargado = true;
    try { const m = await api('/api/permisos/mi'); E.puede = !!(m.permisos && m.permisos.molderia && m.permisos.molderia.ver); } catch (e) { E.puede = false; }
  }
  async function lema() {
    if (E.lemaCargado) return E.promesaLema;
    E.lemaCargado = true;
    E.promesaLema = lemaCargar();
    return E.promesaLema;
  }
  async function lemaCargar() {
    try { const d = await api('/api/lineas-producto'); if (d.lema) E.lema = d.lema; if (d.edicion) E.edicion = d.edicion; if (Array.isArray(d.lineas)) E.lineas = d.lineas; } catch (e) { /* queda el lema por defecto */ }
  }

  // ---------------------------------------------------------------- contenido de cada pestaña
  const tallasDe = f => {
    const set = new Set();
    (f.tallajes || []).forEach(t => (t.tallas || []).forEach(x => set.add(String(x).toUpperCase())));
    ((S.consumos.find(c => c.ref === f.ref) || {}).grupos || []).forEach(g => (g.tallas || []).forEach(x => set.add(String(x).toUpperCase())));
    return [...set].sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b));
  };
  const lista = items => items.length ? '<ol class="li-list">' + items.map((h, i) => '<li><b>' + pad(i + 1) + '</b><span>' + h + '</span></li>').join('') + '</ol>' : '';
  const hechos = (f, sec) => Object.keys(CHK).filter(k => k.startsWith(f.id + '|' + sec + '|') && CHK[k]).length;
  const listaChk = (items, f, sec) => {
    if (!items.length) return '';
    const h = hechos(f, sec);
    return '<div class="fi-prog" data-fi-prog="' + sec + '" data-total="' + items.length + '"><span>' + h + '/' + items.length + '</span><i><s style="width:' + Math.round(h / items.length * 100) + '%"></s></i><button type="button" data-fi-reset="' + sec + '">Reiniciar</button></div>' +
      '<ol class="li-list">' + items.map((html, i) => { const k = f.id + '|' + sec + '|' + i, on = !!CHK[k]; return '<li><b>' + pad(i + 1) + '</b><label class="fi-chk' + (on ? ' hecho' : '') + '"><input type="checkbox" data-fi-chk="' + esc(k) + '" data-fi-sec="' + sec + '"' + (on ? ' checked' : '') + '><span>' + html + '</span></label></li>'; }).join('') + '</ol>';
  };
  const calculadora = (f, cons) => {
    const g = (S.calc[f.ref] = S.calc[f.ref] || {});
    return '<div class="fi-calc"><p class="fi-obs" style="margin:10px 0 0">Escribe cuántas prendas de cada talla: el total de tela sale con el consumo del maestro.</p>' +
      cons.grupos.map((gr, gi) => '<div class="fila"><b>' + esc(gr.grupo) + '</b><div class="campos">' + gr.tallas.map((t, ti) => gr.valores[ti] ? '<label>' + esc(t) + '<input type="number" min="0" inputmode="numeric" data-fi-calc="' + gi + ':' + ti + '" value="' + esc(g[gi + ':' + ti] || '') + '"></label>' : '').join('') + '</div></div>').join('') +
      '<div class="fi-total"><b data-fi-total>0,00</b><span>MTS en total</span><span data-fi-prendas>0 prendas</span><button type="button" data-fi-limpiar>Limpiar</button></div></div>';
  };
  function recalcular() {
    const f = S.fichas[S.i]; if (!f || !overlay) return;
    const cons = S.consumos.find(c => c.ref === f.ref); if (!cons) return;
    let total = 0, prendas = 0; const mem = {};
    overlay.querySelectorAll('[data-fi-calc]').forEach(inp => {
      const [gi, ti] = inp.dataset.fiCalc.split(':').map(Number), n = parseFloat(inp.value) || 0;
      if (inp.value) mem[inp.dataset.fiCalc] = inp.value;
      total += n * (parseFloat(cons.grupos[gi].valores[ti]) || 0); prendas += n;
    });
    S.calc[f.ref] = mem;
    const a = overlay.querySelector('[data-fi-total]'), b = overlay.querySelector('[data-fi-prendas]');
    if (a) a.textContent = total.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (b) b.textContent = prendas + (prendas === 1 ? ' prenda' : ' prendas');
  }
  const kv = (k, v) => '<em class="fi-k">' + esc(k) + '</em>' + esc(v);
  const tablaMedidas = (cab, filas, talla) => {
    const idx = talla ? cab.findIndex(x => String(x).toUpperCase() === talla) : -1;
    return '<div><table class="fi-tabla"><thead><tr><th></th>' + cab.map((x, i) => '<th' + (i === idx ? ' class="hl"' : '') + '>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
      filas.map(([n, vals]) => '<tr><td class="l">' + esc(n) + '</td>' + cab.map((_, i) => '<td' + (i === idx ? ' class="hl"' : '') + '>' + esc(vals[i] ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  };

  // Mapa de telas: qué piezas lleva cada material (M1, M2…), leído de la descripción de la ficha
  const COLORES_MAT = ['#b6f23a', '#38bdf8', '#fb923c', '#f472b6'];
  // Dibujo de la prenda: cada parte se pinta con el color de su material
  const KINDS = [
    ['cuff', /PU[ÑN]O/i], ['sleeve', /MANGA/i], ['collar', /CUELLO|TORTUGA|CAPOTA|TAPACUELLO/i], ['placket', /PERILLA|CIERRE|BOTON/i],
    ['pocket', /BOLSILLO/i], ['side', /COSTADO/i], ['shorts', /PANTALON|SHORT|FALDA|PANT\b/i], ['body', /FRENTE|ESPALDA|CUERPO|PETO|DELANTERO|TRASERO/i]
  ];
  const kindDe = n => { const k = KINDS.find(([, re]) => re.test(n)); return k ? k[0] : 'otro'; };
  const ICONOS = {
    body: '<path d="M10 6 L19 4 Q24 10 29 4 L38 6 L40 42 H8 Z"/>', sleeve: '<path d="M5 38 Q6 14 24 10 Q38 8 43 22 L40 38 Z"/>',
    collar: '<path d="M7 13 H41 L37 22 H11 Z M11 27 H37 L41 36 H7 Z"/>', cuff: '<path d="M6 13 H42 V22 H6 Z M6 27 H42 V36 H6 Z"/>',
    placket: '<rect x="19" y="4" width="10" height="40" rx="2"/>', pocket: '<path d="M10 12 H38 V40 H10 Z M10 12 L24 22 L38 12" />',
    side: '<path d="M8 6 H20 V42 H8 Z M28 6 H40 V42 H28 Z"/>', shorts: '<path d="M8 8 H40 L42 42 H28 L24 24 L20 42 H6 Z"/>',
    otro: '<rect x="8" y="8" width="32" height="32" rx="6"/>'
  };
  const icono = n => '<svg class="ft-ico" viewBox="0 0 48 48">' + ICONOS[kindDe(n)] + '</svg>';
  // FIT DE PRENDA X PIEZAS: mismo dibujo de la hoja de moldería (masculino a la izquierda; femenina y niño(a) a la derecha).
  // Las formas (REF_FIT) están calculadas sobre esa hoja: m = masculino, f = femenina, n = niño(a); cada pieza lleva su recorte (d) y su caja (b).
  const REF_FIT = {"f":{"collar":[{"d":"M865 45 L984 45 L984 46 L982 48 L980 52 L869 52 Z","b":[865,45,984,52]},{"d":"M869 57 L980 57 L984 65 L865 65 Z","b":[865,57,984,65]}],"sleeve":[{"d":"M1039 62 L1050 63 L1057 66 L1059 68 L1060 68 L1079 88 L1080 88 L1083 91 L1088 94 L1079 105 L1003 105 L1001 103 L1001 102 L994 94 L999 91 L1002 88 L1003 88 L1022 68 L1029 64 L1031 64 L1032 63 L1038 63 Z","b":[994,62,1088,105]},{"d":"M1039 115 L1050 116 L1057 119 L1059 121 L1060 121 L1079 141 L1080 141 L1083 144 L1088 147 L1079 158 L1003 158 L1001 156 L1001 155 L994 147 L999 144 L1002 141 L1003 141 L1022 121 L1029 117 L1031 117 L1032 116 L1038 116 Z","b":[994,115,1088,158]}],"back":[{"d":"M782 81 L785 81 L789 86 L793 88 L796 88 L797 89 L815 89 L816 88 L819 88 L823 86 L827 81 L830 81 L831 82 L834 82 L838 84 L841 84 L842 85 L845 85 L847 86 L847 88 L846 89 L846 96 L845 97 L845 104 L844 105 L844 116 L845 117 L846 123 L851 128 L855 130 L854 132 L854 137 L853 138 L853 146 L852 147 L851 169 L852 170 L853 192 L854 193 L854 200 L855 201 L855 208 L856 209 L854 210 L851 210 L847 212 L839 213 L838 214 L832 214 L831 215 L819 215 L818 216 L794 216 L793 215 L781 215 L780 214 L774 214 L773 213 L770 213 L769 212 L765 212 L764 211 L761 211 L760 210 L756 209 L757 208 L757 201 L758 200 L758 193 L759 192 L759 183 L760 182 L760 170 L761 169 L760 147 L759 146 L759 139 L758 138 L758 132 L757 130 L761 128 L766 123 L767 117 L768 116 L768 105 L767 104 L767 97 L766 96 L766 90 L765 89 L765 86 L767 85 L770 85 L771 84 L774 84 L778 82 L781 82 Z","b":[756,81,856,216]}],"front":[{"d":"M901 81 L904 81 L905 86 L911 97 L924 109 L929 106 L937 98 L937 97 L940 94 L944 86 L945 81 L948 81 L949 82 L952 82 L953 83 L956 83 L960 85 L966 86 L966 89 L965 90 L965 95 L964 96 L964 103 L963 104 L963 111 L964 112 L964 116 L966 120 L969 123 L976 126 L975 128 L975 133 L974 134 L973 150 L972 151 L972 172 L973 173 L974 193 L975 194 L976 208 L977 209 L971 210 L970 211 L967 211 L966 212 L963 212 L962 213 L958 213 L957 214 L952 214 L951 215 L939 215 L938 216 L911 216 L910 215 L898 215 L897 214 L892 214 L891 213 L887 213 L886 212 L883 212 L882 211 L879 211 L878 210 L872 209 L873 208 L873 201 L874 200 L874 193 L875 192 L875 184 L876 183 L876 172 L877 171 L877 152 L876 151 L876 142 L875 141 L875 134 L874 133 L874 128 L873 126 L880 123 L883 120 L885 116 L886 105 L885 104 L885 96 L884 95 L884 90 L883 89 L883 86 L889 85 L890 84 L896 83 L897 82 L900 82 Z","b":[872,81,977,216]}],"cuff":[{"d":"M1005 181 L1077 181 L1077 192 L1005 192 Z","b":[1005,181,1077,192]},{"d":"M1005 198 L1077 198 L1077 210 L1005 210 Z","b":[1005,198,1077,210]}]},"m":{"collar":[{"d":"M255 85 L429 85 L429 87 L425 96 L259 96 L258 95 L257 90 L255 87 Z","b":[255,85,429,96]},{"d":"M259 102 L425 102 L426 103 L427 108 L429 111 L429 113 L255 113 L256 108 Z","b":[255,102,429,113]}],"back":[{"d":"M89 163 L92 163 L97 173 L103 179 L111 183 L119 184 L120 185 L133 185 L134 184 L141 183 L149 179 L156 172 L160 163 L167 164 L174 167 L177 167 L184 170 L187 170 L191 172 L194 172 L195 173 L197 173 L201 175 L204 175 L205 176 L212 178 L210 185 L209 186 L209 188 L208 189 L208 191 L207 192 L207 194 L206 195 L206 197 L205 198 L205 200 L203 203 L201 211 L199 214 L199 216 L196 223 L196 226 L195 227 L195 232 L194 233 L194 237 L195 238 L195 243 L196 244 L196 246 L199 251 L204 256 L213 259 L213 407 L211 407 L210 408 L202 408 L201 409 L193 411 L180 418 L178 418 L171 421 L164 422 L163 423 L158 423 L157 424 L149 424 L148 425 L131 425 L130 426 L123 426 L122 425 L104 425 L103 424 L95 424 L94 423 L89 423 L88 422 L85 422 L84 421 L81 421 L80 420 L75 419 L59 411 L57 411 L50 408 L43 408 L42 407 L39 407 L39 259 L46 257 L54 250 L56 246 L56 244 L57 243 L57 239 L58 238 L57 226 L56 225 L53 214 L51 211 L49 203 L47 200 L47 198 L46 197 L46 195 L45 194 L45 192 L44 191 L44 189 L43 188 L43 186 L42 185 L40 178 L47 176 L48 175 L51 175 L55 173 L58 173 L65 170 L68 170 L75 167 L78 167 L85 164 L88 164 Z","b":[39,163,213,426]}],"front":[{"d":"M308 179 L310 179 L312 183 L313 188 L316 193 L316 195 L323 207 L327 211 L327 212 L339 223 L340 223 L344 219 L345 219 L356 207 L364 193 L364 191 L366 188 L366 186 L368 183 L369 179 L372 179 L375 181 L378 181 L379 182 L381 182 L382 183 L384 183 L385 184 L387 184 L388 185 L390 185 L391 186 L393 186 L394 187 L396 187 L397 188 L399 188 L400 189 L402 189 L403 190 L405 190 L406 191 L408 191 L409 192 L411 192 L412 193 L414 193 L421 196 L420 201 L418 204 L418 206 L415 213 L414 220 L413 221 L413 236 L414 237 L414 240 L417 246 L423 252 L429 254 L429 407 L421 407 L420 408 L416 408 L415 409 L410 410 L392 419 L390 419 L386 421 L383 421 L382 422 L372 423 L371 424 L363 424 L362 425 L344 425 L343 426 L336 426 L335 425 L317 425 L316 424 L308 424 L307 423 L297 422 L296 421 L290 420 L287 418 L285 418 L280 415 L278 415 L269 410 L267 410 L263 408 L259 408 L258 407 L250 407 L250 254 L256 252 L262 246 L262 245 L264 243 L264 241 L266 237 L266 230 L267 229 L266 227 L266 221 L265 220 L264 213 L263 212 L260 201 L258 198 L258 196 L259 195 L262 195 L263 194 L268 193 L271 191 L274 191 L277 189 L280 189 L281 188 L283 188 L284 187 L286 187 L287 186 L289 186 L290 185 L292 185 L293 184 L295 184 L296 183 L298 183 L299 182 L301 182 Z","b":[250,179,429,426]}],"sleeve":[{"d":"M567 188 L569 188 L570 189 L579 189 L580 190 L584 190 L585 191 L588 191 L591 193 L593 193 L597 195 L604 201 L605 201 L610 206 L611 206 L616 211 L633 222 L630 228 L630 230 L627 235 L627 237 L624 244 L624 247 L623 248 L623 251 L622 252 L622 256 L514 256 L514 252 L513 251 L512 244 L511 243 L509 235 L507 232 L507 230 L503 222 L516 214 L525 206 L526 206 L532 200 L533 200 L539 195 L543 193 L545 193 L548 191 L556 190 L557 189 L566 189 Z","b":[503,188,633,256]},{"d":"M567 265 L569 265 L570 266 L579 266 L580 267 L584 267 L585 268 L591 269 L600 274 L619 290 L620 290 L625 294 L628 295 L630 297 L633 298 L633 300 L628 309 L628 311 L626 314 L626 316 L624 320 L624 323 L623 324 L623 327 L622 328 L622 332 L514 332 L514 328 L513 327 L512 320 L511 319 L509 311 L503 300 L503 298 L506 297 L508 295 L511 294 L513 292 L517 290 L527 281 L528 281 L532 277 L533 277 L539 272 L548 268 L556 267 L557 266 L566 266 Z","b":[503,265,633,332]}],"cuff":[{"d":"M517 388 L616 388 L616 404 L517 404 Z","b":[517,388,616,404]},{"d":"M517 411 L616 411 L616 426 L517 426 Z","b":[517,411,616,426]}]},"n":{"collar":[{"d":"M864 287 L986 287 L986 289 L985 290 L984 295 L866 295 Z","b":[864,287,986,295]},{"d":"M866 301 L984 301 L986 309 L864 309 Z","b":[864,301,986,309]}],"sleeve":[{"d":"M1042 290 L1050 291 L1057 295 L1066 304 L1069 309 L1076 316 L1080 318 L1078 322 L1077 327 L1076 328 L1076 338 L1012 338 L1012 329 L1011 328 L1011 325 L1008 320 L1008 318 L1012 316 L1019 309 L1022 304 L1031 295 L1038 291 L1041 291 Z","b":[1008,290,1080,338]},{"d":"M1042 349 L1050 350 L1057 354 L1066 363 L1069 368 L1076 375 L1080 377 L1078 381 L1077 386 L1076 387 L1076 397 L1012 397 L1012 388 L1011 387 L1011 384 L1008 379 L1008 377 L1012 375 L1019 368 L1022 363 L1031 354 L1038 350 L1041 350 Z","b":[1008,349,1080,397]}],"back":[{"d":"M790 321 L793 321 L794 324 L799 328 L822 328 L827 324 L827 322 L828 321 L831 321 L835 323 L838 323 L839 324 L842 324 L846 326 L849 326 L849 330 L848 331 L848 334 L847 335 L847 340 L846 341 L846 351 L847 352 L847 355 L848 356 L849 360 L851 362 L853 366 L857 370 L857 457 L856 458 L839 459 L838 460 L823 460 L822 461 L799 461 L798 460 L783 460 L782 459 L773 459 L772 458 L765 458 L764 457 L764 370 L768 366 L768 365 L772 360 L773 356 L774 355 L774 351 L775 350 L775 342 L774 341 L774 336 L773 335 L772 326 L775 326 L779 324 L786 323 Z","b":[764,321,857,461]}],"front":[{"d":"M904 321 L907 321 L907 323 L908 324 L908 328 L913 340 L915 342 L915 343 L924 351 L926 351 L929 348 L930 348 L937 340 L941 331 L941 328 L942 327 L943 321 L946 321 L950 323 L957 324 L958 325 L964 326 L965 327 L964 333 L963 334 L963 339 L962 340 L962 349 L963 350 L963 353 L966 359 L973 367 L973 457 L971 458 L954 459 L953 460 L937 460 L936 461 L913 461 L912 460 L897 460 L896 459 L887 459 L886 458 L878 458 L877 457 L877 367 L884 359 L887 353 L887 350 L888 349 L888 340 L887 339 L887 335 L886 334 L886 330 L885 329 L885 327 L886 326 L889 326 L893 324 L900 323 Z","b":[877,321,973,461]}],"cuff":[{"d":"M1007 425 L1081 425 L1081 438 L1007 438 Z","b":[1007,425,1081,438]},{"d":"M1007 444 L1081 444 L1081 456 L1007 456 Z","b":[1007,444,1081,456]}]}};
  const FIT_COL = ['#009fe3', '#fb923c', '#a78bfa', '#34d399'];
  const FIT_EXTRA = {   // piezas que no están en la hoja base: formas sencillas (tamaño del dibujo y trazo)
    strip: { vb: [150, 26], d: 'M2 2 H148 V24 H2 Z' }, side: { vb: [34, 150], d: 'M2 2 H32 V148 H2 Z' }, placket: { vb: [30, 152], d: 'M3 2 H27 V150 H3 Z' },
    pocket: { vb: [72, 80], d: 'M4 4 H68 V58 L36 74 L4 58 Z' }, shorts: { vb: [104, 170], d: 'M4 4 H92 L98 36 Q82 62 76 94 L72 166 H4 Z' },
    socks: { vb: [60, 120], d: 'M10 4 H44 V70 Q44 112 24 116 H10 Q-2 116 4 98 Z' }, otro: { vb: [80, 80], d: 'M6 6 H74 V74 H6 Z' }
  };
  function fitPiezas(mats) {
    const movil = window.innerWidth <= 700, W = movil ? 742 : 1104;   // en celular solo se ve el recuadro masculino (el grande), a su tamaño
    const claveDe = nom => {
      if (/MEDIA|CALCET/i.test(nom)) return 'socks';
      if (/BISEL|VIVO|CANES/i.test(nom)) return 'strip';
      const k = kindDe(nom);
      if (k === 'body') return /ESPALDA|TRASERO/i.test(nom) ? 'back' : 'front';
      return (REF_FIT.m[k] || FIT_EXTRA[k]) ? k : 'otro';
    };
    const grupos = {};   // clave -> { mat, nombres[], total }
    mats.forEach((m, mi) => m.piezas.forEach(p => {
      const k = claveDe(p.n), g = grupos[k] || (grupos[k] = { mat: mi, nombres: [], total: 0 });
      if (!g.nombres.includes(p.n.toUpperCase())) g.nombres.push(p.n.toUpperCase());
      g.total += p.c;
    }));
    const col = g => FIT_COL[g.mat % FIT_COL.length];
    const lineas = (g, x, y, ancho) => {   // pie de la pieza: nombre(s) y cantidad, centrado en x
      const txt = g.nombres.join(' / ') + (g.total > 1 ? ' ×' + g.total : '');
      const partes = []; let linea = '';
      txt.split(' ').forEach(w => { if ((linea + ' ' + w).trim().length > ancho && linea) { partes.push(linea); linea = w; } else linea = (linea + ' ' + w).trim(); });
      if (linea) partes.push(linea);
      return '<text class="fit-c" x="' + x + '" y="' + y + '" text-anchor="middle">' + partes.map((t, i) => '<tspan x="' + x + '" dy="' + (i ? 17 : 0) + '">' + esc(t) + '</tspan>').join('') + '</text>';
    };
    const forma = (panel, k, g, copias) => (REF_FIT[panel][k] || []).slice(0, copias).map(e => '<path d="' + e.d + '" fill="' + col(g) + '"/>').join('');
    const copias = (k, g) => (k === 'sleeve' || k === 'cuff' || k === 'collar') ? Math.min(g.total, 2) : 1;
    const orden = ['collar', 'back', 'front', 'sleeve', 'cuff'];
    let m = '', f = '', n = '';
    orden.forEach(k => {
      const g = grupos[k]; if (!g) return;
      const c = copias(k, g);
      m += forma('m', k, g, c); f += forma('f', k, g, c); n += forma('n', k, g, c);
    });
    const pie = { collar: [342, 134], back: [126, 446], front: [339, 446], sleeve: [568, 352], cuff: [567, 446] };
    let rotulos = '';
    orden.forEach(k => { if (grupos[k]) rotulos += lineas(grupos[k], pie[k][0], pie[k][1], 18); });
    // piezas fuera de la hoja base (pantaloneta, costados, bisel…): una franja debajo con LAS TRES moldería (masculino, femenina y niño(a)), cada una con sus propias piezas
    const extras = Object.keys(grupos).filter(k => !orden.includes(k)).sort((a, b) => Object.keys(FIT_EXTRA).indexOf(a) - Object.keys(FIT_EXTRA).indexOf(b));
    const paneles = movil ? ['m'] : ['m', 'f', 'n'], PAN = { m: ['#fff', 'MASCULINO', '#548235'], f: ['#ffe7ff', 'FEMENINA', '#e00000'], n: ['#ddebf7', 'NIÑO(A)', '#e00000'] };
    const ESC = { m: [1, 1], f: [0.92, 0.97], n: [0.8, 0.8] };   // ancho y alto relativos del molde (la femenina es más angosta; la de niño(a), más pequeña)
    let franja = '', alto = 483;
    if (extras.length) {
      const cw = W / paneles.length, ancho = cw / extras.length, base = 483 + 30;
      let hmax = 0, rot = '';
      extras.forEach(k => {
        const fe = FIT_EXTRA[k], c = (k === 'strip' || k === 'side') ? Math.min(grupos[k].total, 2) : 1, par = k === 'shorts' && grupos[k].total >= 2;
        hmax = Math.max(hmax, Math.min(1.1, 120 / fe.vb[1]) * fe.vb[1] * c + 8 * (c - 1));
      });
      paneles.forEach((pn, pi) => {
        const x0 = cw * pi;
        franja += (pn === 'm' ? '' : '<rect x="' + x0 + '" y="483" width="' + cw + '" height="' + (hmax + 140) + '" fill="' + PAN[pn][0] + '"/>') +
          '<text class="fit-h" x="' + (x0 + cw / 2) + '" y="500" text-anchor="middle" fill="' + PAN[pn][2] + '">' + (movil ? 'PIEZAS ' : 'MOLDERIA ') + PAN[pn][1] + '</text>';
        if (pi) franja += '<line x1="' + x0 + '" y1="483" x2="' + x0 + '" y2="' + (483 + hmax + 140) + '" stroke="#000"/>';
        extras.forEach((k, i) => {
          const fe = FIT_EXTRA[k], g = grupos[k], c = (k === 'strip' || k === 'side') ? Math.min(g.total, 2) : 1;
          const par = k === 'shorts' && g.total >= 2;   // pantaloneta derecha + izquierda: dos piezas, la segunda reflejada
          const e0 = Math.min(1.1, 120 / fe.vb[1], (ancho - 24) / (fe.vb[0] * (par ? 2.1 : 1)));
          const sx = e0 * ESC[pn][0], sy = e0 * ESC[pn][1], w = fe.vb[0] * sx, h = fe.vb[1] * sy, cx = x0 + ancho * (i + 0.5), ty = base + 14;
          if (par) franja += ['', ' translate(' + fe.vb[0] + ' 0) scale(-1 1)'].map((fl, q) => '<g transform="translate(' + (cx - w - 4 + q * (w + 8)).toFixed(1) + ' ' + ty.toFixed(1) + ') scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')"><path transform="' + fl.trim() + '" d="' + fe.d + '" fill="' + col(g) + '"/></g>').join('');
          else for (let j = 0; j < c; j++) franja += '<g transform="translate(' + (cx - w / 2).toFixed(1) + ' ' + (ty + j * (h + 8)).toFixed(1) + ') scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')"><path d="' + fe.d + '" fill="' + col(g) + '"/></g>';
          g._x = x0 + ancho * (i + 0.5);
          rot += lineas(g, cx, base + 14 + hmax + 22, movil ? 13 : Math.max(8, Math.floor(ancho / 10.5)));
        });
      });
      franja += rot;
      alto = Math.ceil(base + 14 + hmax + 22 + (movil ? 78 : 56));
      franja = '<line x1="0" y1="483" x2="' + W + '" y2="483" stroke="#000"/>' + franja;
    }
    return '<div class="fit-wrap"><svg class="fit' + (movil ? ' fit-movil' : '') + '" viewBox="0 0 ' + W + ' ' + alto + '" role="img" aria-label="Fit de prenda por piezas">' +
      '<rect width="' + W + '" height="' + alto + '" fill="#fff"/><rect x="742" y="0" width="362" height="242" fill="#ffe7ff"/><rect x="742" y="0" width="362" height="21" fill="#ffccff"/>' +
      '<rect x="742" y="242" width="362" height="241" fill="#ddebf7"/><rect x="742" y="242" width="362" height="21" fill="#bdd7ee"/>' +
      '<text class="fit-h" x="371" y="15" text-anchor="middle" fill="#548235">FIT DE PRENDA X PIEZAS <tspan fill="#e00000">(MASCULINO)</tspan></text>' +
      '<text class="fit-h" x="923" y="15" text-anchor="middle" fill="#e00000">MOLDERIA FEMENINA</text><text class="fit-h" x="923" y="257" text-anchor="middle" fill="#e00000">MOLDERIA NIÑO(A)</text>' +
      '<g>' + m + '</g><g>' + f + '</g><g>' + n + '</g>' + rotulos + franja +
      '<path d="M742 0 V483 M742 242 H1104 M0 21 H742" stroke="#000" stroke-width="1" fill="none"/><rect x=".5" y=".5" width="' + (W - 1) + '" height="' + (alto - 1) + '" fill="none" stroke="#000"/></svg></div>';
  }
  function iconoFila(p, i, color) { return '<span style="--d:' + (0.4 + i * 0.12).toFixed(2) + 's">' + icono(p.n) + esc(p.n) + (p.c > 1 ? '<em>×' + p.c + '</em>' : '') + '</span>'; }
  function mapaTelas(f) {
    const texto = (f.descripcion || []).map(d => (d && d.texto) || d).filter(d => /\bM\d\s*[:\-]/i.test(d)).join(' || ');
    const mats = [];
    const limpia = x => x.replace(/\s+/g, ' ').trim();
    const piezasDe = trozo => limpia(trozo).replace(/\([^)]*\)/g, '').split(/[,;]/).map(limpia).filter(Boolean).map(x => {
      const m = x.match(/^(.*?)\s*[xX]\s*(\d+)\s*\.?$/);
      return m ? { n: limpia(m[1]).replace(/^(Y|Y\/O|E)\s+/i, ''), c: +m[2] } : { n: x.replace(/\.$/, ''), c: 1 };
    }).filter(x => x.n);
    const re = /\bM(\d)\s*[:\-]\s*([^]*?)(?=\bM\d\s*[:\-]|$)/gi;
    let m;
    while ((m = re.exec(texto))) {
      const ps = piezasDe(m[2].replace(/\s*[\/7]\s*$/, '').replace(/\s*\|\|[^]*$/, ''));
      if (ps.length) mats.push({ id: 'M' + m[1], piezas: ps });
    }
    if (!mats.length) {
      const cuenta = {};
      (f.piezas || []).forEach(x => { cuenta[x] = (cuenta[x] || 0) + 1; });
      const ps = Object.entries(cuenta).map(([n, c]) => ({ n, c }));
      if (!ps.length) return '';
      mats.push({ id: 'M1', piezas: ps });
    }
    mats.forEach((x, i) => {
      x.color = COLORES_MAT[i % COLORES_MAT.length];
      x.tela = (f.telas || []).filter(t => t.material === x.id && t.tela).map(t => t.tela).join(' / ');
      x.total = x.piezas.reduce((a, b) => a + b.c, 0);
    });
    const uno = mats.length === 1;
    const ban = uno
      ? '<span class="ft-ban" style="--c:' + mats[0].color + '">● UN SOLO MATERIAL · TODO EN ' + mats[0].id + '</span>'
      : '<span class="ft-ban dos" style="--c1:' + mats[0].color + ';--c2:' + mats[1].color + '">● ' + (mats.length === 2 ? 'DOS' : mats.length) + ' MATERIALES · NO TODO VA EN LA MISMA TELA</span>';
    return '<div class="ft"><div class="ft-top">' + ban + '<span class="ft-sub">' + (uno ? 'Todas las piezas se cortan de la misma tela' : 'Separa las piezas por color de material') + '</span></div>' +
      fitPiezas(mats) + '<div class="ft-mats">' + mats.map(x => '<div class="ft-mat" data-m="' + x.id + '" style="--c:' + x.color + '"><h4><b>' + x.id + '</b>MATERIAL ' + x.id.slice(1) + '</h4><p class="ft-tela">' + esc(x.tela || 'Tela por definir en la ficha') + '</p><div class="ft-piezas">' +
        x.piezas.map((p, i) => iconoFila(p, i)).join('') + '</div></div>').join('') + '</div></div>';
  }
  function pestanas(f) {
    const cons = S.consumos.find(c => c.ref === f.ref);
    const t = [];
    // RESUMEN
    const res = [];
    if (f.prenda) res.push(kv('Prenda', f.prenda));
    res.push(kv('Referencia', (f.referencia || f.ref) + (f.hoja && f.hoja !== f.ref ? ' · ' + f.hoja : '')));
    (f.telas || []).forEach(x => res.push(kv('Tela ' + x.material, x.tela)));
    (f.promedios || []).forEach(p => res.push(kv(p.nombre.replace('PROMEDIO', 'Consumo'), Object.entries(p.valores).map(([k, v]) => (NOMBRE[k] || k) + ' ' + v).join(' · ') + ' MTS')));
    if (f.nota_promedio) res.push(esc(f.nota_promedio));
    (f.descripcion || []).forEach(d => res.push(esc(d)));
    if (f.nota) res.push(esc(f.nota));
    t.push({ id: 'RESUMEN', n: res.length, html: mapaTelas(f) + lista(res) });
    // MEDIDAS
    const todasTallas = tallasDe(f), esNum = x => /^\d+$/.test(String(x));
    const hayAdulto = todasTallas.some(x => !esNum(x)), hayNino = todasTallas.some(esNum);
    if (!S.grupo || (S.grupo === 'adulto' && !hayAdulto) || (S.grupo === 'nino' && !hayNino)) S.grupo = hayAdulto ? 'adulto' : 'nino';
    const enGrupo = tallas => S.grupo === 'todas' || ((tallas || []).length > 0 && (S.grupo === 'nino') === tallas.every(esNum));   // los números (2, 4, 6…) son tallas de niño: salen en su propio grupo
    const ts = todasTallas.filter(x => S.grupo === 'todas' || (S.grupo === 'nino') === esNum(x));
    if (S.talla && !ts.includes(S.talla)) S.talla = '';
    let med = '';
    if (hayAdulto && hayNino) med += '<div class="fi-tallas"><small>TALLAS</small>' + [['adulto', 'ADULTO · XS A 4XL'], ['nino', 'NIÑO / NIÑA · 2 A 16'], ['todas', 'TODAS']].map(([k, n]) => '<button type="button" aria-pressed="' + (S.grupo === k) + '" data-fi-grupo="' + k + '">' + n + '</button>').join('') + '</div>';
    if (ts.length) med += '<div class="fi-tallas"><small>TALLA</small><button type="button" aria-pressed="' + !S.talla + '" data-fi-talla="">Todas</button>' + ts.map(x => '<button type="button" aria-pressed="' + (S.talla === x) + '" data-fi-talla="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</div>';
    const bloques = [], bloquesCons = [];
    (f.tallajes || []).filter(g => enGrupo(g.tallas)).forEach(g => {
      const filas = [['Ancho (X)', g.ancho], ['Alto (Y)', g.alto], ['Largo', g.largo]].filter(([, v]) => v && v.some(x => x !== ''));
      if (filas.length) bloques.push('<div class="fi-bloque"><p class="fi-titulo">' + esc(g.titulo.replace(/^MEDIDAS TALLAJE\s*/i, 'Medidas · ')) + ' (cm)</p>' + tablaMedidas(g.tallas, filas, S.talla) + '</div>');
    });
    if (cons && cons.grupos.length) cons.grupos.filter(g => enGrupo(g.tallas)).forEach(g => bloquesCons.push('<div class="fi-bloque"><p class="fi-titulo">Consumo de tela · ' + esc(g.grupo) + ' (MTS por prenda)</p>' + tablaMedidas(g.tallas, [['MTS', g.valores.map(v => v || '—')]], S.talla) + '</div>'));
    (f.medidas_insumos || []).filter(m => enGrupo(m.tallas)).forEach(m => bloques.push('<div class="fi-bloque"><p class="fi-titulo">' + esc(m.titulo) + '</p>' + tablaMedidas(m.tallas, [['Medida', m.medidas || []]], S.talla) + '</div>'));
    if (bloques.length || bloquesCons.length) med += '<div class="fi-dos"><div class="fi-col"><p class="fi-sec">Consumo de tela</p>' + (bloquesCons.join('') || '<p class="fi-vacio">Sin consumo registrado.</p>') +
      (cons && cons.grupos.length ? '<p class="fi-obs">Promedio del maestro: ' + esc(cons.promedio) + ' MTS' + ((cons.plantillas || []).length ? ' · Plantillas: ' + esc(cons.plantillas.join(', ')) : '') + '</p>' : '') +
      '</div><div class="fi-col"><p class="fi-sec">Medidas</p>' + (bloques.join('') || '<p class="fi-vacio">Sin medidas registradas.</p>') + '</div></div>';
    t.push({ id: 'MEDIDAS', n: (f.tallajes || []).length + ((cons && cons.grupos.length) || 0) + (f.medidas_insumos || []).length, html: (med || '<p class="fi-vacio">Esta referencia no tiene medidas registradas.</p>') + mapaTelas(f) });
    // INSUMOS
    const ins = (f.insumos || []).map(i => '<strong>' + esc(i.nombre) + '</strong> · ' + esc([i.tipo, i.color, i.medida].filter(Boolean).join(' · ')) + (i.cant ? ' · ×' + esc(i.cant) : '') + (i.observacion ? '<span class="fi-obs">' + esc(i.observacion) + '</span>' : ''));
    t.push({ id: 'INSUMOS', n: ins.length, html: lista(ins) || '<p class="fi-vacio">Sin insumos registrados.</p>' });
    // CONFECCIÓN
    const conf = (f.confeccion || []).map(c => kv(c.etiqueta, c.valor));
    t.push({ id: 'CONFECCIÓN', n: conf.length, html: listaChk(conf, f, 'conf') || '<p class="fi-vacio">Sin datos de confección.</p>' });
    // EMPAQUE
    const emp = (f.terminacion || []).map(x => esc(x)).concat((f.empaque_insumos || []).map(i => '<strong>' + esc(i.nombre) + '</strong> · ' + esc([i.tipo, i.color, i.medida].filter(Boolean).join(' · ')) + (i.cant ? ' · ×' + esc(i.cant) : '')));
    t.push({ id: 'EMPAQUE', n: emp.length, html: listaChk(emp, f, 'emp') || '<p class="fi-vacio">Sin datos de empaque.</p>' });
    return t.filter(x => x.n > 0 || x.id === 'RESUMEN');
  }

  // ---------------------------------------------------------------- buscador de mockups en el NAS (carpeta CLIENTES)
  const NP = { ref: '', items: [], q: '', cargando: false, error: '' };
  let nasEl = null, nasCb = null;
  function nasPintar() {
    if (!nasEl) return;
    const q = NP.q.trim().toLowerCase();
    const lista = NP.items.filter(x => !q || (x.nombre + ' ' + x.cliente + ' ' + x.carpeta).toLowerCase().includes(q));
    nasEl.querySelector('.fm-cuerpo').innerHTML = NP.cargando ? '<p class="fm-msg">Buscando ' + esc(NP.ref) + ' en el NAS… puede tardar hasta un minuto.</p>'
      : NP.error ? '<p class="fm-msg">' + esc(NP.error) + '</p>'
      : lista.length ? '<div class="fm-grid">' + lista.map(x => '<button type="button" class="fm-card" data-fm-ruta="' + esc(x.ruta) + '" data-fm-nombre="' + esc(x.nombre) + '"><img loading="lazy" alt="" src="/api/molderia/nas-img?w=320&ruta=' + encodeURIComponent(x.ruta) + '"><b>' + esc(x.nombre) + '</b><small>' + esc(x.cliente) + ' · ' + esc(x.fecha) + ' · ' + x.kb + ' KB</small></button>').join('') + '</div>'
      : '<p class="fm-msg">No encontré mockups' + (q ? ' con ese filtro' : ' de ' + esc(NP.ref) + ' en el NAS') + '.</p>';
    nasEl.querySelector('.fm-cont').textContent = NP.cargando || NP.error ? '' : lista.length + (lista.length === NP.items.length ? '' : ' de ' + NP.items.length) + ' imágenes';
  }
  function nasCerrar() { if (nasEl) { nasEl.remove(); nasEl = null; } document.removeEventListener('keydown', nasTecla, true); }
  function nasTecla(e) { if (e.key === 'Escape' && nasEl) { e.stopPropagation(); nasCerrar(); } }
  async function nasBuscar(refrescar) {
    NP.cargando = true; NP.error = ''; nasPintar();
    try {
      const r = await fetch('/api/molderia/mockups-nas?ref=' + encodeURIComponent(NP.ref) + (refrescar ? '&refrescar=1' : ''), { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No pude buscar en el NAS');
      NP.items = j.items || [];
      if (j.sin_indice) { NP.error = 'Indexando el NAS por primera vez (' + (j.archivos || 0) + ' archivos revisados). Tarda varios minutos; esta ventana se actualiza sola.'; if (nasEl) setTimeout(() => { if (nasEl && NP.error.startsWith('Indexando')) nasBuscar(false); }, 8000); }
    } catch (e) { NP.items = []; NP.error = e.message; }
    NP.cargando = false; nasPintar();
  }
  function buscarMockupNas(ref, alTerminar) {
    nasCerrar();
    Object.assign(NP, { ref: String(ref || '').toUpperCase(), items: [], q: '', cargando: true, error: '' });
    nasCb = alTerminar || null;
    nasEl = document.createElement('div'); nasEl.className = 'fm-over';
    nasEl.innerHTML = '<div class="fm-main"><div class="fm-top"><h3>MOCKUPS DE ' + esc(NP.ref) + ' EN EL NAS</h3><input class="fm-q" type="search" placeholder="Filtrar por cliente o diseño (D1, D2…)"><span class="fm-cont"></span><button type="button" class="fm-ref">⟳ Buscar de nuevo</button><button type="button" class="fm-x">Cerrar</button></div><div class="fm-cuerpo"></div></div>';
    document.body.appendChild(nasEl);
    document.addEventListener('keydown', nasTecla, true);
    nasEl.addEventListener('click', async e => {
      if (e.target === nasEl || e.target.closest('.fm-x')) { nasCerrar(); return; }
      if (e.target.closest('.fm-ref')) { nasBuscar(true); return; }
      const c = e.target.closest('[data-fm-ruta]');
      if (!c) return;
      if (!confirm('¿Usar «' + c.dataset.fmNombre + '» como mockup de ' + NP.ref + '?')) return;
      try {
        const r = await fetch('/api/molderia/mockup-nas?ref=' + encodeURIComponent(NP.ref) + '&ruta=' + encodeURIComponent(c.dataset.fmRuta), { method: 'POST', credentials: 'same-origin' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || 'No pude guardar el mockup');
        const cb = nasCb; nasCerrar();
        window.dispatchEvent(new Event('fichas-mockup'));
        if (cb) cb();
      } catch (er) { alert(er.message); }
    });
    nasEl.querySelector('.fm-q').addEventListener('input', e => { NP.q = e.target.value; nasPintar(); });
    nasBuscar(false);
  }
  window.fichasBuscarMockup = buscarMockupNas;

  // ---------------------------------------------------------------- dibujo
  function mockPane(f) {
    let src = '', cap = f ? f.ref + (f.prenda ? ' · ' + f.prenda : '') : '';
    const propio = f && f.mockup;
    if (propio) src = mockUrl(f.ref, f.mockup);
    else if (S.fila) src = '/api/produccion/fila/' + encodeURIComponent(S.fila) + '/mockup-excel/1';
    else if (f && (f.imagenes || []).length) src = img(f.id, f.imagenes[0]);
    const acc = E.puede && f ? '<div class="fi-mockacc"><button type="button" class="pri" data-fi-nas="' + esc(f.ref) + '">🔎 Buscar en el NAS</button><button type="button" data-fi-mock="' + esc(f.ref) + '">' + (propio ? '⟳ Cambiar mockup' : '⬆ Subir mockup de ' + esc(f.ref)) + '</button>' + (propio ? '<button type="button" data-fi-mock-quitar="' + esc(f.ref) + '">🗑 Quitar</button>' : '') + '</div>' : '';
    if (!src) return E.puede && f ? '<div class="li-mock" data-fi-drop="' + esc(f.ref) + '"><div class="li-mock-tag"><i></i>MOCKUP DE REFERENCIA</div><div class="fi-sinmock"><span>Esta referencia todavía no tiene mockup.<br>Arrastra aquí la imagen o súbela.</span></div>' + acc + '<div class="li-mock-cap">' + esc(cap) + '</div></div>' : '';
    return '<div class="li-mock"' + (E.puede && f ? ' data-fi-drop="' + esc(f.ref) + '"' : '') + '><div class="li-mock-tag"><i></i>MOCKUP DE REFERENCIA</div><a class="li-stage" href="' + esc(src) + '" target="_blank" rel="noopener" title="Ver en grande"><img src="' + esc(src) + '" alt="Mockup de ' + esc(cap) + '"><span class="li-zoom" aria-hidden="true">⤢</span></a>' + acc + '<div class="li-mock-cap">' + esc(cap) + '</div></div>';
  }

  async function subirMockup(ref, archivo) {
    if (!/^image\//.test(archivo.type)) { alert('Elige una imagen (JPG, PNG o WEBP).'); return; }
    try {
      const r = await fetch('/api/molderia/mockup?ref=' + encodeURIComponent(ref), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No pude guardar el mockup');
      await recargar();
    } catch (e) { alert(e.message); }
  }
  async function quitarMockup(ref) {
    if (!confirm('¿Quitar el mockup de ' + ref + '?')) return;
    try { const r = await fetch('/api/molderia/mockup?ref=' + encodeURIComponent(ref), { method: 'DELETE', credentials: 'same-origin' }); if (!r.ok) throw new Error('No pude quitarlo'); await recargar(); } catch (e) { alert(e.message); }
  }
  async function recargar() {
    const f = S.fichas[S.i]; if (!f) return;
    const j = await api('/api/fichas/resumen?ref=' + encodeURIComponent(f.ref));
    S.fichas = j.fichas; S.consumos = j.consumos || []; S.i = Math.min(S.i, S.fichas.length - 1); dibujar();
    window.dispatchEvent(new Event('fichas-mockup'));
  }
  function elegirMockup(ref) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
    inp.addEventListener('change', () => { if (inp.files[0]) subirMockup(ref, inp.files[0]); });
    inp.click();
  }

  function dibujar() {
    const card = overlay.querySelector('.li-card');
    card.style.setProperty('--ac', '#c3ee3f');
    const top = '<div class="li-top"><span class="li-logo" role="img" aria-label="Indoor"></span><span>FICHA TÉCNICA</span><span class="fi-acc">' + (E.puede && window.molderiaAbrirPagina && S.modo === 'ficha' ? '<button type="button" data-fi-pagina>Vista completa</button>' : '') + '<button type="button" data-fi-imp>🖨 Imprimir</button></span></div>';
    const foot = '<div class="li-foot"><span class="li-foot-l"><img class="li-iso" src="/favicon.svg" alt=""><i>' + esc(E.lema) + '</i></span><span>Documento interno · Indoor Sport</span></div>';
    let mock = '', main = '';
    if (S.modo === 'buscar') {
      main = top + '<div class="li-pane"><div class="li-title"><i class="li-bar"></i><h2 id="li-title">Fichas técnicas</h2></div><p class="li-sub"><span class="li-count">' + ((E.lista || []).length) + ' referencias</span><span>Busca por referencia o prenda</span></p>' +
        (S.aviso ? '<p class="li-empty">' + S.aviso + '</p>' : '') + '<div class="fi-buscar"><input type="search" data-fi-q placeholder="Escribe la referencia (FUT01, CA02, CH01…) o la prenda" autofocus value="' + esc(S.q || '') + '"></div><div class="fi-res"></div></div>' + foot;
    } else {
      const f = S.fichas[S.i], tabs = pestanas(f);
      if (!tabs.some(x => x.id === S.tab)) S.tab = 'RESUMEN';
      const act = tabs.find(x => x.id === S.tab);
      mock = mockPane(f);
      const hojas = S.fichas.length > 1 ? '<div class="fi-hojas">' + S.fichas.map((x, k) => '<button type="button" aria-pressed="' + (k === S.i) + '" data-fi-hoja="' + k + '">' + esc(x.hoja) + '</button>').join('') + '</div>' : '';
      main = top + hojas + '<div class="li-tabs" role="tablist">' + tabs.map(x => '<button type="button" role="tab" data-fi-tab="' + esc(x.id) + '" aria-pressed="' + (x.id === S.tab) + '">' + esc(x.id) + '</button>').join('') + '</div>' +
        '<div class="li-pane"><div class="li-title"><i class="li-bar"></i><h2 id="li-title">' + esc(f.ref) + '</h2></div><p class="li-sub"><span class="li-count">' + act.n + (act.id === 'MEDIDAS' ? ' tablas' : act.id === 'CALCULADORA' ? ' grupos' : act.id === 'LÍNEAS' ? ' características' : ' característica' + (act.n === 1 ? '' : 's')) + '</span><span>' + esc(f.prenda || f.familia) + ' · ' + esc(f.familia) + '</span></p>' + act.html + '</div>' + foot;
    }
    card.classList.toggle('has-mock', !!mock);
    card.innerHTML = '<button type="button" class="li-close" aria-label="Cerrar">×</button><div class="li-split">' + mock + '<div class="li-main">' + main + '</div></div>';
    if (S.modo === 'ficha') recalcular();
    const imgMock = card.querySelector('.li-stage img');
    if (imgMock) imgMock.addEventListener('error', () => { if (E.puede) return; const m = card.querySelector('.li-mock'); if (m) m.style.display = 'none'; card.classList.remove('has-mock'); });
    if (S.modo === 'buscar') { pintarBusqueda(); const q = card.querySelector('[data-fi-q]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    const act = card.querySelector('[aria-pressed=true][data-fi-tab]'); if (act && act.scrollIntoView) { try { act.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* sin scroll */ } }
  }

  async function pintarBusqueda() {
    const host = overlay && overlay.querySelector('.fi-res');
    if (!host) return;
    if (!E.lista) { try { E.lista = (await api('/api/fichas/lista')).fichas; } catch (e) { host.innerHTML = '<p class="fi-vacio">' + esc(e.message) + '</p>'; return; } }
    const t = plano(S.q || '');
    const l = E.lista.filter(f => !t || plano(f.ref + ' ' + f.prenda + ' ' + f.familia + ' ' + f.hoja).includes(t)).slice(0, 60);
    host.innerHTML = l.length ? l.map(f => '<button type="button" data-fi-abrir="' + esc(f.ref) + '"><div class="p">' + (f.mockup ? '<img loading="lazy" alt="" src="' + mockUrl(f.ref, f.mockup) + '">' : f.portada ? '<img loading="lazy" alt="" src="' + img(f.id, f.portada) + '">' : '') + '</div><b>' + esc(f.ref) + '</b><small>' + esc(f.prenda) + '</small></button>').join('') : '<p class="fi-vacio">No encontré esa referencia.</p>';
  }

  function cerrar() {
    if (overlay) overlay.remove();
    overlay = null; document.removeEventListener('keydown', teclas);
  }
  function teclas(e) {
    if (e.key === 'Escape') { cerrar(); return; }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && S && S.modo === 'ficha' && !e.target.matches('input')) {
      const ids = [...overlay.querySelectorAll('[data-fi-tab]')].map(b => b.dataset.fiTab), k = ids.indexOf(S.tab);
      S.tab = ids[(k + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]; e.preventDefault(); dibujar();
    }
  }
  function abrirOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'li-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'li-title');
    overlay.innerHTML = '<div class="li-card fi theme-reinvert"></div>';
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('.li-close')) { cerrar(); return; }
      const tab = e.target.closest('[data-fi-tab]'), hoja = e.target.closest('[data-fi-hoja]'), talla = e.target.closest('[data-fi-talla]'), abrir_ = e.target.closest('[data-fi-abrir]');
      if (tab) { S.tab = tab.dataset.fiTab; dibujar(); }
      else if (hoja) { S.i = +hoja.dataset.fiHoja; dibujar(); }
      else if (talla) { S.talla = talla.dataset.fiTalla; dibujar(); }
      else if (abrir_) abrir(abrir_.dataset.fiAbrir);
      else if (e.target.closest('[data-fi-grupo]')) { S.grupo = e.target.closest('[data-fi-grupo]').dataset.fiGrupo; S.talla = ''; dibujar(); }
      else if (e.target.closest('[data-fi-linea]')) { S.linea = e.target.closest('[data-fi-linea]').dataset.fiLinea; dibujar(); }
      else if (e.target.closest('[data-fi-imp]')) window.print();
      else if (e.target.closest('[data-fi-nas]')) buscarMockupNas(e.target.closest('[data-fi-nas]').dataset.fiNas, recargar);
      else if (e.target.closest('[data-fi-mock]')) elegirMockup(e.target.closest('[data-fi-mock]').dataset.fiMock);
      else if (e.target.closest('[data-fi-mock-quitar]')) quitarMockup(e.target.closest('[data-fi-mock-quitar]').dataset.fiMockQuitar);
      else if (e.target.closest('[data-fi-limpiar]')) { const f = S.fichas[S.i]; S.calc[f.ref] = {}; overlay.querySelectorAll('[data-fi-calc]').forEach(x => { x.value = ''; }); recalcular(); }
      else if (e.target.closest('[data-fi-reset]')) { const sec = e.target.closest('[data-fi-reset]').dataset.fiReset, f = S.fichas[S.i]; Object.keys(CHK).filter(k => k.startsWith(f.id + '|' + sec + '|')).forEach(k => delete CHK[k]); guardar('mo_chk', CHK); dibujar(); }
      else if (e.target.closest('[data-fi-pagina]')) { const f = S.fichas[S.i]; cerrar(); window.molderiaAbrirPagina(f.id); }
    });
    overlay.addEventListener('input', e => { if (e.target.matches('[data-fi-q]')) { S.q = e.target.value; pintarBusqueda(); } else if (e.target.matches('[data-fi-calc]')) recalcular(); });
    overlay.addEventListener('change', e => {
      if (!e.target.matches('[data-fi-chk]')) return;
      const k = e.target.dataset.fiChk; if (e.target.checked) CHK[k] = 1; else delete CHK[k]; guardar('mo_chk', CHK);
      e.target.closest('.fi-chk').classList.toggle('hecho', e.target.checked);
      const sec = e.target.dataset.fiSec, pr = overlay.querySelector('[data-fi-prog="' + sec + '"]'), f = S.fichas[S.i];
      if (pr) { const total = +pr.dataset.total, h = hechos(f, sec); pr.querySelector('span').textContent = h + '/' + total; pr.querySelector('s').style.width = Math.round(h / total * 100) + '%'; }
    });
    overlay.addEventListener('dragover', e => { const z = e.target.closest('[data-fi-drop]'); if (z) { e.preventDefault(); z.classList.add('sobre'); } });
    overlay.addEventListener('dragleave', e => { const z = e.target.closest('[data-fi-drop]'); if (z) z.classList.remove('sobre'); });
    overlay.addEventListener('drop', e => { const z = e.target.closest('[data-fi-drop]'); if (z && e.dataTransfer.files[0]) { e.preventDefault(); z.classList.remove('sobre'); subirMockup(z.dataset.fiDrop, e.dataTransfer.files[0]); } });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', teclas);
  }

  // abrir(ref, fila): ref puede ser «A100FUT01» (como viene en la tarjeta) o «FUT01»; sin ref abre el buscador
  async function abrir(ref, fila, hojaId, linea) {
    await Promise.all([lema(), permisos()]);
    abrirOverlay();
    S = { modo: ref ? 'cargando' : 'buscar', fichas: [], i: 0, tab: 'RESUMEN', talla: '', consumos: [], fila: fila || '', q: '', calc: {}, linea: linea || '' };
    const card = overlay.querySelector('.li-card');
    card.style.setProperty('--ac', '#c3ee3f');
    if (!ref) { dibujar(); return; }
    card.innerHTML = '<button type="button" class="li-close" aria-label="Cerrar">×</button><div class="li-split"><div class="li-main"><div class="li-pane"><p class="fi-vacio">Cargando la ficha de ' + esc(ref) + '…</p></div></div></div>';
    try {
      const j = await api('/api/fichas/resumen?ref=' + encodeURIComponent(ref));
      S.consumos = j.consumos || [];
      if (!j.fichas.length) {
        S.modo = 'buscar';
        S.aviso = (j.importadas ? 'No hay ficha técnica de <b>' + esc((j.buscadas || [ref]).join(', ')) + '</b> en el Excel de fichas.' : 'Las fichas técnicas aún no se han importado. Avisa a Edición o Coordinación.') +
          (S.consumos.length ? ' Consumo registrado: ' + S.consumos.map(c => esc(c.ref) + ' ' + esc(c.promedio) + ' MTS (promedio)').join(' · ') : '') +
          ((j.parecidas || []).length ? '<br>Parecidas: ' + j.parecidas.map(x => '<a href="#" data-fi-abrir="' + esc(x.ref) + '" style="color:var(--ac)">' + esc(x.ref) + '</a>').join(' · ') : '');
        dibujar(); return;
      }
      S.modo = 'ficha'; S.fichas = j.fichas; S.i = Math.max(0, j.fichas.findIndex(x => x.id === hojaId)); dibujar();
    } catch (e) { card.querySelector('.li-pane').innerHTML = '<p class="fi-vacio">' + esc(e.message) + '</p>'; }
  }
  window.abrirFichaResumen = abrir;

  // Botón «FICHA TÉCNICA» en cada tarjeta de producción (usa la referencia de la propia tarjeta)
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-card-ficha]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    abrir(b.dataset.cardFicha, b.dataset.cardFila, '', b.dataset.cardLinea);
  }, true);
  // los enlaces «parecidas» del aviso
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[data-fi-abrir]'); if (a) { e.preventDefault(); abrir(a.dataset.fiAbrir); } });

  // Acceso desde el menú del usuario (lo ven todos)
  function menu() {
    const m = document.querySelector('.user-dropdown');
    if (!m) return false;
    if (document.getElementById('open-fichas-resumen')) return true;
    const boton = document.createElement('button');
    boton.type = 'button'; boton.id = 'open-fichas-resumen'; boton.textContent = 'Fichas técnicas';
    const ant = document.getElementById('open-molderia') || document.getElementById('open-promedios') || document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    ant ? ant.insertAdjacentElement('afterend', boton) : m.querySelector('p')?.insertAdjacentElement('afterend', boton);
    boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); abrir(''); });
    return true;
  }
  let n = 0;
  const espera = setInterval(() => { if (menu() || ++n > 80) clearInterval(espera); }, 300);
})();
