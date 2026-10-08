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
  .fit{display:flex;flex-wrap:wrap;gap:18px 30px;justify-content:center;align-items:flex-end;padding:16px 14px 18px;border:1px solid #2c3a1c;border-radius:14px;background:#0d1409}
  .fit-t{flex:0 0 100%;text-align:center;font:800 11px Arial;letter-spacing:.18em;color:#d7ff3a}
  .fit-p{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px}.fit-d{display:flex;flex-direction:column;align-items:center;gap:4px}
  .fit-p svg *{fill:var(--c);stroke:rgba(0,0,0,.45);stroke-width:.6}
  .fit-p figcaption{font:800 11px Arial;letter-spacing:.05em;color:#e9efe3;text-align:center}.fit-p em{font-style:normal;color:var(--c)}
  .fit-m{display:inline-block;margin-right:6px;padding:1px 6px;border-radius:5px;background:var(--c);color:#0b1204;font:900 10px Arial}
  @media(max-width:700px){.fit{gap:14px 18px}.fit-p svg{max-width:96px;height:auto}}
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
  // Siluetas de las piezas del patrón (para reconocer cada pieza de un vistazo en el mapa)
  const SIL = {
    back: '<path d="M9 7 L19 5 Q24 10 29 5 L39 7 L41 17 Q37 21 38 26 V43 H10 V26 Q11 21 7 17 Z"/>',
    front: '<path d="M9 7 L17 5 L24 18 L31 5 L39 7 L41 17 Q37 21 38 26 V43 H10 V26 Q11 21 7 17 Z"/>',
    sleeve: '<path d="M5 38 Q6 14 24 10 Q38 8 43 22 L40 38 Z"/>',
    cuff: '<path d="M6 13 H42 V22 H6 Z M6 27 H42 V36 H6 Z"/>',
    collar: '<path d="M7 13 H41 L37 22 H11 Z M11 27 H37 L41 36 H7 Z"/>',
    socks: '<path d="M16 6 H30 V30 Q30 42 20 42 H12 Q8 42 10 36 Z"/>'
  };
  const silueta = (nom, k) => (kindDe(nom) === 'pocket' ? ICONOS.pocket : (SIL[k] || ICONOS[kindDe(nom)] || ICONOS.otro));
  const icono = n => '<svg class="ft-ico" viewBox="0 0 48 48">' + ICONOS[kindDe(n)] + '</svg>';
  // FIT DE PRENDA POR PIEZAS: cada pieza del patrón dibujada con su nombre y cantidad, del color de su material (sin animación)
  const ORDEN_PIEZA = ['back', 'front', 'sleeve', 'cuff', 'collar', 'placket', 'pocket', 'side', 'shorts', 'socks', 'otro'];
  function fitPiezas(mats) {
    const claveDe = nom => {
      if (/MEDIA|CALCET/i.test(nom)) return 'socks';
      const k = kindDe(nom);
      if (k === 'body') return /ESPALDA|TRASERO/i.test(nom) ? 'back' : 'front';
      return k;
    };
    const lista = [];
    mats.forEach(m => m.piezas.forEach(p => lista.push({ m, p, k: claveDe(p.n) })));
    lista.sort((x, y) => ORDEN_PIEZA.indexOf(x.k) - ORDEN_PIEZA.indexOf(y.k));
    const ancho = k => (k === 'back' || k === 'front' ? 150 : k === 'shorts' ? 120 : 110);
    const figuras = lista.map(({ m, p, k }) => {
      const w = ancho(k), copias = Math.min(p.c, 2);
      const dibujo = '<svg viewBox="0 0 48 48" width="' + w + '" height="' + w + '" aria-hidden="true">' + silueta(p.n, k) + '</svg>';
      return '<figure class="fit-p" style="--c:' + m.color + '"><div class="fit-d">' + dibujo.repeat(copias) + '</div><figcaption>' +
        (mats.length > 1 ? '<b class="fit-m">' + m.id + '</b>' : '') + esc(p.n.toUpperCase()) + (p.c > 1 ? ' <em>×' + p.c + '</em>' : '') + '</figcaption></figure>';
    }).join('');
    return '<div class="fit"><div class="fit-t">FIT DE PRENDA X PIEZAS</div>' + figuras + '</div>';
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
