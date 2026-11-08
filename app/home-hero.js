/* Inicio · ciclo infinito (usa /motion.js), sin dibujos ni textos de proceso:
   Indoor (el logo se dibuja y se ilumina en verde lima, y desaparece) → Diseño → Impresión → Sublimación → Corte láser → Empaque (fotos reales de la planta,
   del mismo tamaño que el logo) → otra vez Indoor… La portada se degrada hacia los datos de abajo.
   Cifras reales en vivo ('indoor:stats' de home-dashboard.js). Respeta prefers-reduced-motion. */
(function () {
  'use strict';
  const hero = document.querySelector('.home-hero');
  if (!hero || hero.dataset.heroListo) return;
  hero.dataset.heroListo = '1';

  const M = window.Motion || null;
  const quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Las dos capas de fotografías se cruzan bien en escritorio, pero en móvil
  // terminan compitiendo por muy poco espacio y dejan la portada cortada. Allí
  // mostramos una escena fija, ligera y legible; el ciclo completo queda igual
  // en computador.
  const movil = !!(window.matchMedia && matchMedia('(max-width: 860px)').matches);
  const anima = !!M && !quieto && !movil;
  const ease = [0.22, 1, 0.36, 1];
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const VB = '0 0 265.09 68.59', VW = 265.09, VH = 68.59;
  const RUTAS = ["M157.38,65.59c-.1-.09-.19-.17-.29-.26-.09-.08-.18-.17-.27-.25-.7-.69-1.33-1.49-1.9-2.4-.02-.03-.03-.05-.05-.08-.17-.28-.33-.57-.49-.87-.04-.07-.07-.14-.1-.2-.16-.31-.32-.63-.46-.97-.17-.39-.33-.78-.47-1.18l-.18-.41-.25-.59c-.3.02.1,0-.47,0-8.16,0-10.99-6.04-8.39-17.95,2.67-11.69,8.07-17.63,16.05-17.63,1.66,0,3.52.47,4.88,1.16,1.34.68,2.48,1.82,3.12,3.15,1.99,4.13,1.11,7.86.44,12.83l-.47,2.71c-.99,4.1.52,6.15,4.62,6.15h6.34l1.35-6.18c.17-.71.34-1.44.5-2.21.12-.53.22-1.05.32-1.56,0,0,.19-.98.18-.98,3.04-17.15-3.16-25.5-18.9-25.5s-26.43,9.17-30.55,28.04c-4.14,18.94,1.84,28.15,18.28,28.15,3.42,0,5.83-.22,8.71-1.05l.94-.23-1.71-1.14c-.27-.18-.52-.38-.77-.58Z", "M185.75,12.39c-3.44,0-5.64.15-8.54.99l-1.06.36,1.3.86c1.72,1.26,3.03,2.79,4.07,4.81.08.15.15.31.23.46.05.11.11.23.16.34.13.29.26.58.38.88.02.04.03.08.05.11.13.33.26.67.38,1.01l.23.54s.06.03.41.04c7.8,0,10.62,6.24,8.15,18.04-2.54,11.63-7.86,17.53-15.81,17.53-2.64,0-5.31-.67-6.99-2.39-3.29-3.38-2.63-8.1-1.86-13.09l.89-4.31c.98-4.05-.51-6.08-4.57-6.08h-6.26c-1.66,7.77-4.18,16.31-2.55,23.6,1.12,4.97,4.3,9.1,9.08,10.9,2.99,1.13,6.6,1.56,10.02,1.56,16.51,0,26.54-9.21,30.68-28.15,4.12-18.87-1.9-28.04-18.41-28.04Z", "M21.78,0c-4.69,0-7.52,2.49-8.57,7.28L0,67.79h13.86L28.66,0h-6.88Z", "M55.06,14.26c-15.05,0-24.27,7.48-27.55,22.53l-6.77,31h13.46l7.36-33.69c1.3-5.48,4.87-8.17,10.76-8.17s8.28,2.69,7.39,8.17l-5.92,27.12c-.91,4.19.82,6.28,5.14,6.58h6.78l6.77-31c3.39-15.05-2.36-22.53-17.41-22.53Z", "M128.55,0h-6.58l-4.9,22.43c-2.19-5.48-6.69-8.17-13.27-8.17-14.17.5-23.15,9.67-27.07,27.61-3.83,17.55,2.41,26.42,18.69,26.72,16.43.1,26.42-7.78,29.88-23.63l8.36-38.28c.78-3.59-1.53-6.68-5.12-6.68ZM112.96,41.27c-2.33,10.67-7.29,16.05-14.87,16.05s-9.99-5.38-7.56-16.05c2.62-10.17,7.4-15.15,14.57-15.15s9.78,4.98,7.86,15.15Z", "M209.9,40.57l-5.94,27.21h13.46l5.99-27.41c1.68-7.67,6.21-11.56,13.59-11.56h4.49l3-13.76h-1.89c-17.65,0-28.57,8.47-32.69,25.52Z", "M260.82,7.97c0-1.82-1.07-2.77-3.1-2.77h-3.63v9.5h1.48v-4.16h1.51l.32.75,2.13,3.41h1.5l-2.68-4.16c1.61-.23,2.47-1.06,2.47-2.57ZM257.4,9.36h-1.84v-2.9h1.84c.64.14,1.07.14,1.28.22.45.22.65.64.65,1.29,0,.32-.2.75-.44.96-.21.21-.53.42-.95.42h-.53Z", "M264.02,5.84c-.64-1.17-1.6-2.25-2.89-3-1.17-.75-2.56-1.05-4.05-1.05-1.08,0-2.03.21-3.1.62-.96.33-1.82.97-2.58,1.72-.62.76-1.26,1.61-1.58,2.55-.54,1.18-.76,2.25-.76,3.33,0,.95.22,2.02.65,2.98.74,2.03,2.13,3.53,4.16,4.49,1.07.41,2.13.61,3.2.61,2.25,0,4.16-.82,5.76-2.45,1.51-1.58,2.26-3.41,2.26-5.63,0-1.49-.32-2.89-1.08-4.16ZM262.95,12.44c-.53,1.19-1.3,2.25-2.36,2.99-1.06.88-2.24,1.19-3.52,1.19-.65,0-1.17-.11-1.72-.31-.61-.12-1.16-.44-1.59-.67-.96-.62-1.73-1.47-2.24-2.54-.42-.95-.75-2.03-.75-3.09s.32-2.14.86-3.33c1.17-2.25,2.97-3.41,5.44-3.41.96,0,1.81.23,2.46.52.86.33,1.5.87,2.12,1.51,1.18,1.38,1.72,2.88,1.72,4.71,0,.84-.11,1.71-.42,2.44Z"];
  // fotos reales de la planta, una por proceso (la escena de Indoor no lleva foto)
  const FOTOS = [null, '/landing/fabrica-4.jpg', '/landing/fabrica-1.jpg', '/landing/fabrica-6.jpg', '/landing/fabrica-2.jpg', '/landing/fabrica-5.jpg'];
  const NOMBRES = ['Indoor', 'Diseño', 'Impresión', 'Sublimación', 'Corte láser', 'Empaque'];   // solo para lectores de pantalla

  const style = document.createElement('style');
  style.textContent = `
  body .home-hero{min-height:calc(clamp(390px,52vh,540px) + var(--navh,0px))!important;border:0!important;border-radius:0!important;background:linear-gradient(180deg,rgba(3,4,3,.88) 0,rgba(3,4,3,.92) 20%,rgba(3,4,3,.94) 54%,rgba(3,4,3,.5) 80%,rgba(3,4,3,0) 100%)!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;overflow:hidden!important;margin-top:-6px!important;margin-bottom:clamp(-190px,-15vh,-100px)!important;justify-self:start;max-width:none!important;
    -webkit-mask-image:linear-gradient(180deg,#000 0,#000 7%,#000 50%,rgba(0,0,0,.55) 72%,rgba(0,0,0,.2) 88%,transparent 100%);mask-image:linear-gradient(180deg,#000 0,#000 7%,#000 50%,rgba(0,0,0,.55) 72%,rgba(0,0,0,.2) 88%,transparent 100%)}
  html body.inicio-mode.top-navigation .sidebar{background:linear-gradient(180deg,rgba(3,4,3,.7),rgba(3,4,3,0))!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  html body.inicio-mode.top-navigation .sidebar .brand,html body.inicio-mode.top-navigation .sidebar .tabs,html body.inicio-mode.top-navigation .sidebar .topbar,html body.inicio-mode.top-navigation .sidebar .systems{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  html body.inicio-mode.top-navigation .sidebar::before,html body.inicio-mode.top-navigation .sidebar::after{display:none!important}
  .home-hero:after{display:none!important}
  .home-hero>*:not(.hp){display:none!important}
  .home-page>#home-dashboard{position:relative;z-index:3}
  .hp{position:absolute;inset:0;color:#f7faf4;font-family:Arial,Helvetica,sans-serif}
  .hp-glow{position:absolute;z-index:0;left:50%;top:50%;width:min(110vw,1300px);aspect-ratio:2.4/1;translate:-50% -50%;background:radial-gradient(closest-side,rgba(208,244,76,.15),rgba(208,244,76,.04) 55%,transparent 75%);pointer-events:none}
  .hp canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}
  .hp-top{text-shadow:0 1px 10px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.8);position:absolute;z-index:5;left:clamp(20px,5vw,80px);right:clamp(20px,5vw,80px);top:calc(var(--navh,0px) + 12px);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .hp-hi{display:flex;align-items:center;gap:10px;font:700 .72rem Arial;letter-spacing:.22em;text-transform:uppercase;color:#aab8a4}.hp-hi i{width:8px;height:8px;border-radius:50%;background:#8bd450;animation:hpP 2s infinite}.hp-hi b{color:#f7faf4;font-weight:800}
  @keyframes hpP{0%{box-shadow:0 0 0 0 rgba(139,212,80,.6)}70%{box-shadow:0 0 0 8px rgba(139,212,80,0)}100%{box-shadow:0 0 0 0 rgba(139,212,80,0)}}
  .hp-kpis{display:flex;gap:clamp(14px,2.4vw,34px);flex-wrap:wrap}.hp-kpis div{display:flex;align-items:baseline;gap:8px}
  .hp-kpis b{font:800 clamp(1.05rem,1.5vw,1.4rem) Arial;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:#f7faf4}.hp-kpis span{font:700 .6rem Arial;letter-spacing:.14em;text-transform:uppercase;color:#b4c3ae}.hp-kpis div.r b{color:#ff8c8c}
  .esc{position:absolute;z-index:3;left:50%;top:calc(var(--navh,0px) * .5 + 48%);translate:-50% -50%;width:94%;opacity:0;pointer-events:none;will-change:transform,opacity}
  .esc-lg{position:absolute;width:44%}.esc-lg svg{display:block;width:100%;height:auto;overflow:visible}
  .lg-fill{position:absolute;inset:0;-webkit-mask:url('/marca-indoor.svg') center/contain no-repeat;mask:url('/marca-indoor.svg') center/contain no-repeat;overflow:hidden;will-change:opacity}
  .lg-fill .bar{position:absolute;inset:0;background:linear-gradient(115deg,#eaff86 0%,#d0f44c 45%,#a6d12c 100%);transform:translateX(-101%);will-change:transform}
  .lg-fill .sh{position:absolute;top:0;bottom:0;left:0;width:18%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.65) 50%,transparent);transform:translateX(-120%) skewX(-16deg);will-change:transform}
  .lg-cab{position:absolute;top:-4%;bottom:-4%;left:0;width:3px;background:#f1ffb0;box-shadow:0 0 18px 4px rgba(208,244,76,.65);opacity:0;will-change:transform,opacity}
  .lg-halo{position:absolute;inset:-18% -6%;background:radial-gradient(closest-side,rgba(208,244,76,.34),rgba(208,244,76,.08) 55%,transparent 75%);opacity:.55;will-change:opacity}
  .esc .L{transform-box:fill-box;transform-origin:center}
  .esc-ph{width:100%;height:90%;top:45%;overflow:hidden}
  .esc-ph img{position:absolute;inset:-4%;width:108%;height:108%;object-fit:cover;filter:saturate(1.05) contrast(1.05);will-change:transform}
  .esc-ph .vl{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,4,3,.5) 0,rgba(3,4,3,.18) 22%,transparent 40%),linear-gradient(90deg,rgba(3,4,3,.6),transparent 22%,transparent 78%,rgba(3,4,3,.6))}
  .hp-amb{position:absolute;inset:0;z-index:0;pointer-events:none}.hp-amb .am{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease}.hp-amb .am.on{opacity:.34}
  .hp-amb img{width:100%;height:100%;object-fit:cover;display:block;filter:blur(6px) saturate(.9);transform:scale(1.06)}
  .esc-ph .lz{position:absolute;top:-10%;bottom:-10%;left:0;width:22%;background:linear-gradient(100deg,transparent,rgba(208,244,76,.0) 20%,rgba(235,255,150,.55) 50%,rgba(208,244,76,0) 80%,transparent);transform:skewX(-16deg);opacity:0;will-change:transform,opacity}
  .hp-line{position:absolute;z-index:5;left:50%;translate:-50% 0;bottom:30%;width:min(520px,70%);display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:clamp(8px,1.4vw,16px)}
  .hp-line button{all:unset;cursor:pointer;display:grid;align-items:center;height:22px}
  .hp-line button i{display:block;height:2px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden}.hp-line button i b{display:block;height:100%;background:#d0f44c;transform:scaleX(0);transform-origin:left}
  .hp-line button:focus-visible{outline:2px solid #d0f44c;outline-offset:5px}
  @media(max-width:860px){
    body .home-hero{min-height:330px!important;margin-bottom:-28px!important}
    .hp-top{flex-direction:column;align-items:flex-start;gap:8px;top:28px}.hp-kpis{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;width:100%}.hp-kpis b{font-size:1rem}.hp-kpis span{font-size:.52rem}
    .esc{top:54%}.esc-lg{width:min(78vw,420px)}.esc-ph{display:none!important}.hp canvas{display:none}.hp-glow{opacity:.62}.hp-amb .am.on{opacity:.28}.hp-line{bottom:18%;gap:5px;width:80%}
  }
  @media(prefers-reduced-motion:reduce){.hp-hi i{animation:none}}
  body #home-dashboard .dash-tabs{border-color:transparent!important;background:linear-gradient(90deg,rgba(8,11,8,.5) 0,rgba(8,11,8,.42) 34%,rgba(8,11,8,0) 70%)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none!important}
  html body #home-dashboard .dash-tabs button{background:rgba(255,255,255,.07)!important;border:0!important;border-radius:12px!important;box-shadow:0 10px 24px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background .25s,box-shadow .3s,color .25s!important}
  html body #home-dashboard .dash-tabs button:hover{background:rgba(255,255,255,.13)!important;transform:translateY(-3px)!important;box-shadow:0 16px 28px -12px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.12)!important}
  html body #home-dashboard .dash-tabs button.on{background:#d0f44c!important;color:#16200a!important;box-shadow:0 14px 30px -10px rgba(208,244,76,.5)!important}
  .hp-line{display:none!important}
  .hp-hi{display:none!important}.hp-top{justify-content:flex-end!important}
  /* botones flotantes, a juego con la interfaz de vidrio */
  html body #home-dashboard .dash-time-chips button,html body #home-dashboard .st-metric button,html body #home-dashboard .dash-time-csv,html body #home-dashboard .dash-time-more,html body #home-dashboard .ut-more,html body.inicio-mode .od-chip,html body.inicio-mode .od-close{border-color:transparent!important;box-shadow:0 10px 24px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background .25s,box-shadow .3s!important}
  html body #home-dashboard .dash-time-chips button:not(.on),html body #home-dashboard .st-metric button:not(.on),html body #home-dashboard .dash-time-csv,html body #home-dashboard .dash-time-more,html body #home-dashboard .ut-more,html body.inicio-mode .od-chip:not(.on),html body.inicio-mode .od-close{background-color:rgba(255,255,255,.07)!important}
  html body #home-dashboard .dash-time-chips button:hover,html body #home-dashboard .st-metric button:hover,html body #home-dashboard .dash-time-csv:hover,html body #home-dashboard .dash-time-more:hover,html body #home-dashboard .ut-more:hover,html body.inicio-mode .od-chip:hover,html body.inicio-mode .od-close:hover{transform:translateY(-3px)!important;box-shadow:0 16px 28px -12px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.12)!important}
  html body.inicio-mode.top-navigation .sidebar .tab{background:transparent!important;border-color:transparent!important;box-shadow:none!important;border-radius:10px!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background .25s!important}
  html body.inicio-mode.top-navigation .sidebar .tab:hover{background:rgba(255,255,255,.1)!important;transform:translateY(-2px)!important}
  body #home-dashboard .dash-order-finder{border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:radial-gradient(closest-side at 50% 50%,rgba(208,244,76,.07),rgba(8,11,8,.42) 60%,rgba(8,11,8,0) 100%)!important}
  .hp-suelto{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  body #home-dashboard .dash-head{position:relative;z-index:1}
  `;
  document.head.appendChild(style);

  const capasLogo = i => '<g class="L"><path class="b" d="' + RUTAS[i] + '" fill="rgba(255,255,255,.05)" stroke="rgba(208,244,76,.18)" stroke-width=".4"/>' +
    '<path class="l" d="' + RUTAS[i] + '" pathLength="1" fill="none" stroke="#d0f44c" stroke-width=".7" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1"/></g>';
  const svgLogo = '<div class="lg-halo"></div><svg viewBox="' + VB + '" role="img" aria-label="Indoor">' + RUTAS.map((_, i) => capasLogo(i)).join('') + '</svg><div class="lg-fill"><i class="bar"></i><i class="sh"></i></div><i class="lg-cab"></i>';

  const p = document.createElement('div');
  p.className = 'hp';
  p.setAttribute('aria-label', 'Indoor Sport');
  p.innerHTML =
    '<div class="hp-glow"></div><div class="hp-amb" aria-hidden="true">' + FOTOS.filter(Boolean).map(f => '<div class="am" data-s="' + f + '"><img src="' + f + '" alt="" decoding="async"></div>').join('') + '</div><canvas aria-hidden="true"></canvas>' +
    '<div class="hp-top"><span class="hp-hi"><i></i><span class="hp-nm">Indoor Sport · Planta</span></span><div class="hp-kpis"><div><b>—</b><span>unidades por fabricar</span></div><div><b>—</b><span>entregas de la semana</span></div><div><b>—</b><span>% de avance</span></div><div class="r"><b>—</b><span>pedidos atrasados</span></div></div></div>' +
    '<div class="esc esc-lg" id="escLg" style="position:absolute">' + svgLogo + '</div>' +
    '<div class="esc esc-ph"><img alt="" decoding="async"><div class="vl"></div><div class="lz"></div></div><div class="esc esc-ph"><img alt="" decoding="async"><div class="vl"></div><div class="lz"></div></div>' +
    '<nav class="hp-line" aria-label="Escenas">' + NOMBRES.map(n => '<button type="button" aria-label="' + n + '"><i><b></b></i></button>').join('') + '</nav>';
  hero.appendChild(p);

  const $ = s => p.querySelector(s), $$ = s => [].slice.call(p.querySelectorAll(s));
  const escLg = $('#escLg'), escPhs = $$('.esc-ph'), glow = $('.hp-glow'), amb = $$('.hp-amb .am');
  const ambiente = src => amb.forEach(a => a.classList.toggle('on', a.dataset.s === src));
  ambiente(FOTOS[1]);   // desde el primer instante hay imagen detrás, no negro
  const lgFill = $('.lg-fill'), lgSh = $('.lg-fill .sh'), lgBar = $('.lg-fill .bar'), lgCab = $('.lg-cab'), lgHalo = $('.lg-halo'), LL = $$('.L'), lgL = $$('.L .l'), lgB = $$('.L .b');
  const botones = $$('.hp-line button'), barras = botones.map(b => b.querySelector('b')), svgLogoEl = escLg.querySelector('svg');
  let anchoLogo = 1000;
  const medirLogo = () => { anchoLogo = escLg.getBoundingClientRect().width || 1000; };
  // precarga de las fotos para que las escenas no se vean a saltos
  FOTOS.forEach((s, k) => { if (s) setTimeout(() => { const im = new Image(); im.src = s; if (im.decode) im.decode().catch(() => {}); }, 300 + k * 450); });

  /* ---------- Personalización y datos en vivo ---------- */
  function persona() {
    const nombre = (document.querySelector('.user-menu .user-info strong')?.textContent || window.__indoorNombre || '').trim();
    const rol = (document.querySelector('.user-menu .user-info small')?.textContent || '').trim();
    const h = new Date().getHours(), hola = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const pr = nombre.split(/\s+/)[0] || '', bon = pr ? pr.charAt(0).toUpperCase() + pr.slice(1).toLowerCase() : '';
    const t = hola + (bon ? ', <b>' + bon.replace(/[<>&]/g, '') + '</b>' : '') + (rol ? ' · ' + rol.replace(/[<>&]/g, '') : '');
    const el = $('.hp-nm'); if (el.dataset.t !== t) { el.dataset.t = t; el.innerHTML = t; }
  }
  persona(); setTimeout(persona, 900); setTimeout(persona, 2500);
  const celdas = $$('.hp-kpis b'), vals = [a => a.unitsToMake, a => a.weekCount, a => Math.round(a.progress || 0), a => a.late.length], previos = [0, 0, 0, 0];
  function pintarVivo(a) {
    if (!a) return;
    vals.forEach((f, i) => { const d = Number(f(a)) || 0, el = celdas[i]; if (anima && d !== previos[i]) M.animate(previos[i], d, { duration: 1.2, ease, onUpdate: v => { el.textContent = Math.round(v).toLocaleString('es-CO'); } }); else el.textContent = d.toLocaleString('es-CO'); previos[i] = d; });
    persona();
  }
  document.addEventListener('indoor:stats', e => pintarVivo(e.detail));
  if (window.indoorHomeStats) pintarVivo(window.indoorHomeStats);

  /* ---------- Destellos (solo blanco y verde lima) ---------- */
  const cv = $('canvas'), cx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, estr = [], chispas = [], visible = true, raf = 0;
  function medir() {
    DPR = .6; W = hero.clientWidth; H = hero.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    estr = Array.from({ length: Math.round(Math.min(34, Math.max(16, W * H / 24000))) }, () => ({ x: Math.random() * W, y: Math.random() * H * .85, r: .5 + Math.random() * 1.5, ph: Math.random() * 6.28, sp: .5 + Math.random() * 1.5, g: Math.random() < .18, c: Math.random() < .35 ? '208,244,76' : '255,255,255' }));
  }
  function pinta(ahora) {
    const t = ahora / 1000;
    cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); cx.globalCompositeOperation = 'lighter';
    estr.forEach(s => {
      const a = Math.pow(.5 + .5 * Math.sin(t * s.sp + s.ph), 3); if (a < .03) return;
      cx.fillStyle = 'rgba(' + s.c + ',' + (.15 + .8 * a).toFixed(3) + ')'; cx.beginPath(); cx.arc(s.x, s.y, s.r * (.7 + a * .6), 0, 6.283); cx.fill();
      if (s.g) { const Lg = s.r * 9 * a;[[s.x - Lg, s.y, s.x + Lg, s.y, s.x - Lg, s.y - .5, Lg * 2, 1], [s.x, s.y - Lg, s.x, s.y + Lg, s.x - .5, s.y - Lg, 1, Lg * 2]].forEach(q => { const g = cx.createLinearGradient(q[0], q[1], q[2], q[3]); g.addColorStop(0, 'rgba(' + s.c + ',0)'); g.addColorStop(.5, 'rgba(' + s.c + ',' + (.7 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + s.c + ',0)'); cx.fillStyle = g; cx.fillRect(q[4], q[5], q[6], q[7]); }); }
    });
    chispas = chispas.filter(c => c.v > 0);
    chispas.forEach(c => { c.x += c.vx; c.y += c.vy; c.vx *= .985; c.vy *= .985; c.v -= .014; cx.fillStyle = 'rgba(' + c.c + ',' + Math.max(0, c.v).toFixed(3) + ')'; cx.beginPath(); cx.arc(c.x, c.y, c.r * c.v + .3, 0, 6.283); cx.fill(); });
    cx.globalCompositeOperation = 'source-over';
  }
  let ultimo = 0;
  const bucle = ahora => { raf = (visible && !document.hidden) ? requestAnimationFrame(bucle) : 0; if (ahora - ultimo < 32) return; ultimo = ahora; pinta(ahora); };
  const arranca = () => { if (!raf && anima) raf = requestAnimationFrame(bucle); };
  const chispasEn = (px, py, n) => { for (let i = 0; i < n; i++) chispas.push({ x: px, y: py, vx: (Math.random() - .5) * 3, vy: (Math.random() - .7) * 2.6, r: 1 + Math.random() * 2, v: .7 + Math.random() * .5, c: Math.random() < .5 ? '255,255,255' : '208,244,76' }); };
  function puntoLogo(sx, sy) { const r = svgLogoEl.getBoundingClientRect(), h = hero.getBoundingClientRect(); return [r.left - h.left + sx / VW * r.width, r.top - h.top + sy / VH * r.height]; }
  // la portada ocupa todo el ancho de la pantalla (hasta los bordes)
  function ajustarAncho() { const padre = hero.parentElement; if (!padre) return;
    const flota = document.body.classList.contains('top-navigation') && window.innerWidth > 860, main = document.querySelector('main');
    const navH = flota && main ? Math.max(0, (parseFloat(getComputedStyle(main).paddingTop) || 0) - 10) : 0;
    hero.style.setProperty('--navh', navH + 'px'); hero.style.setProperty('margin-top', (-(navH + 6)) + 'px', 'important'); hero.style.width = ''; hero.style.marginLeft = ''; const r = padre.getBoundingClientRect(); hero.style.width = document.documentElement.clientWidth + 'px'; hero.style.marginLeft = (-r.left) + 'px'; }
  ajustarAncho(); [150, 600, 1500, 3500].forEach(ms => setTimeout(ajustarAncho, ms)); window.addEventListener('load', ajustarAncho);
  window.addEventListener('resize', () => { ajustarAncho(); medir(); medirLogo(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { ajustarAncho(); }).observe(document.documentElement);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.tab')) setTimeout(ajustarAncho, 120); });
  medir(); medirLogo();
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { medir(); if (!anima) pinta(1500); }).observe(hero);
  if (typeof IntersectionObserver === 'function') new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) arranca(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arranca(); });

  /* ---------- Helpers ---------- */
  const apagar = el => { try { el.getAnimations().forEach(a => a.cancel()); } catch (e) { /* nada */ } el.style.opacity = 0; };
  function reinicioLogo() {
    lgBar.style.transform = 'translateX(-101%)'; lgFill.style.opacity = 1; lgSh.style.transform = 'translateX(-120%) skewX(-16deg)'; lgCab.style.opacity = 0; lgCab.style.transform = 'translateX(0px)';
    lgL.forEach(l => { l.setAttribute('stroke-dashoffset', 1); l.setAttribute('opacity', 1); }); lgB.forEach(b => b.setAttribute('opacity', 1));
    LL.forEach(l => { l.style.transform = ''; l.style.opacity = 1; }); lgHalo.style.opacity = .55;
  }

  // el recuadro de «Producción · conectado» (de la página) deja de verse como un bloque
  function soltarCajas() {
    [].forEach.call(document.querySelectorAll('.home-page div, .home-page section, .home-page label, .home-page aside'), e => {
      if (e.closest('.home-hero') || e.closest('#home-dashboard') || e.classList.contains('hp-suelto')) return;
      const t = (e.textContent || '').toUpperCase();
      if (t.length < 60 && t.includes('CONECTADO') && e.offsetHeight < 90) e.classList.add('hp-suelto');
    });
  }
  [300, 1200, 3000].forEach(ms => setTimeout(soltarCajas, ms));

  /* ---------- Escenas ---------- */
  let ficha = 0, animBarra = null;
  const vivo = mi => mi === ficha;

  // el elemento saliente se desvanece mientras entra la escena siguiente (cruce, sin pantalla negra)
  function saliente(el) {
    const op = parseFloat(getComputedStyle(el).opacity) || 0; if (op < .02) return;
    M.animate(el, { opacity: [op, 0] }, { duration: .9, ease: 'easeInOut' }).finished.then(() => apagar(el));
  }
  async function escenaIndoor(mi) {   // el logo se dibuja, un barrido lo llena de verde lima, brilla y desaparece mientras entra la siguiente escena
    reinicioLogo(); escPhs.forEach(saliente); ambiente(FOTOS[1]); medirLogo(); M.animate(glow, { opacity: [.5, 1] }, { duration: 1.5 });
    await M.animate(escLg, { opacity: [0, 1], scale: [.97, 1] }, { duration: .5, ease }).finished; if (!vivo(mi)) return;
    M.animate(lgL, { strokeDashoffset: [1, 0] }, { duration: 1.7, delay: M.stagger(.1), ease: [0.45, 0, 0.2, 1] });
    await dormir(1500); if (!vivo(mi)) return;
    lgCab.style.opacity = 1; const D = 1.5, e = [0.4, 0, 0.6, 1];
    M.animate(lgBar, { x: ['-101%', '0%'] }, { duration: D, ease: e });
    M.animate(lgCab, { x: [0, anchoLogo] }, { duration: D, ease: e });
    for (let k = 0; k < 6; k++) setTimeout(() => { if (!vivo(mi)) return; const [px, py] = puntoLogo(Math.random() * VW, VH * .5); chispasEn(px, py, 4); }, k * 250);
    await dormir(D * 1000 + 100); if (!vivo(mi)) return;
    M.animate(lgCab, { opacity: [1, 0] }, { duration: .3 });
    M.animate(lgSh, { x: ['0%', '780%'] }, { duration: 1.3, ease: 'easeInOut' });
    M.animate(lgHalo, { opacity: [.55, 1, .55] }, { duration: 1.4 });
    await dormir(1700); if (!vivo(mi)) return;
    // el logo se disuelve y, sin esperar, empieza la escena siguiente
    M.animate(lgFill, { opacity: [1, 0] }, { duration: .7, ease: 'easeIn' });
    M.animate(lgHalo, { opacity: [.55, 0] }, { duration: .7 });
    Promise.all(LL.map((l, i) => M.animate(l, { opacity: [1, 0], y: [0, (i % 2 ? -14 : 14)], scale: [1, 1.08] }, { duration: .7, delay: i * .04, ease: 'easeIn' }).finished)).then(() => { if (vivo(mi) || true) apagar(escLg); });
  }
  let kf = 0;
  async function escenaFoto(mi, i) {   // foto real del proceso: se abre desde el centro sobre la anterior, con un barrido de luz verde
    const el = escPhs[kf], prev = escPhs[kf ^ 1], img = el.querySelector('img'), lz = el.querySelector('.lz'); kf ^= 1;
    apagar(el); img.src = FOTOS[i]; ambiente(FOTOS[i]); M.animate(glow, { opacity: [.6, 1] }, { duration: 1.2 });
    saliente(prev); saliente(escLg);
    el.style.zIndex = 4; prev.style.zIndex = 3; el.style.opacity = 1;
    M.animate(el, { opacity: [0, 1] }, { duration: 1.2, ease: [0.4, 0, 0.2, 1] });
    M.animate(img, { scale: [1.14, 1.03], x: [(i % 2 ? 3 : -3) + '%', '0%'] }, { duration: 6.4, ease: 'linear' });
    await dormir(900); if (!vivo(mi)) return;
    lz.style.opacity = 1; M.animate(lz, { x: ['-120%', '520%'], opacity: [0, 1, 0] }, { duration: 1.3, ease: 'easeInOut' });
    const r = el.getBoundingClientRect(), h = hero.getBoundingClientRect();
    for (let k = 0; k < 5; k++) setTimeout(() => { if (vivo(mi)) chispasEn(r.left - h.left + (k / 4) * r.width, r.top - h.top + r.height * .5, 3); }, k * 240);
    await dormir(3700);   // se queda visible: la escena siguiente la cubre con un cruce
  }
  const ESCENAS = [escenaIndoor, mi => escenaFoto(mi, 1), mi => escenaFoto(mi, 2), mi => escenaFoto(mi, 3), mi => escenaFoto(mi, 4), mi => escenaFoto(mi, 5)], DURS = [7.1, 5.6, 5.6, 5.6, 5.6, 5.6];

  async function reproducir(i) {
    const mi = ++ficha;
    barras.forEach((b, k) => { b.style.transform = k < i ? 'scaleX(1)' : 'scaleX(0)'; });
    if (animBarra) animBarra.stop(); animBarra = M.animate(barras[i], { scaleX: [0, 1] }, { duration: DURS[i], ease: 'linear' });
    await ESCENAS[i](mi);
    if (!vivo(mi)) return;
    reproducir((i + 1) % ESCENAS.length);   // infinito: después de Empaque vuelve el logo de Indoor
  }
  botones.forEach((b, i) => b.addEventListener('click', () => { ficha++; apagar(escLg); escPhs.forEach(apagar); reproducir(i); }));

  if (!anima) {   // sin animaciones: el logo ya dibujado
    lgBar.style.transform = 'none'; lgL.forEach(l => l.setAttribute('stroke-dashoffset', 0)); escLg.style.opacity = 1; barras.forEach(b => { b.style.transform = 'scaleX(1)'; }); pinta(1500);
  } else {
    arranca();
    M.animate([$('.hp-top'), $('.hp-line')], { opacity: [0, 1] }, { duration: 1, delay: .3 });
    reproducir(0);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { ficha++; } else { apagar(escLg); escPhs.forEach(apagar); reproducir(0); } });
  }
})();
