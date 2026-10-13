// Entrada animada con estilo de transmisión deportiva: barridos diagonales, el logo de Indoor que "golpea" la pantalla,
// sello EN VIVO con reloj y un rótulo inferior. Sale cada vez que se abre o se recarga la página; clic, toque o tecla la saltan.
// Al iniciar sesión cambia a una presentación tipo "jugador": «Te damos la bienvenida» + el nombre (window.__indoorNombre).
// En /login añade además el sello EN VIVO y la cinta de titulares, para que toda la página se sienta como una transmisión.
(function () {
  if (window.__indoorSplash) return; window.__indoorSplash = true;
  var FUENTE = 'Inter,"Segoe UI",system-ui,Arial,sans-serif';
  var quieto = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hora = function (seg) { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return p(d.getHours()) + ':' + p(d.getMinutes()) + (seg ? ':' + p(d.getSeconds()) : ''); };
  var sello = function (clase) { return '<div class="' + clase + '"><span class="tx-vivo"><i></i>EN VIVO</span><span class="tx-hora" data-tx-hora>' + hora(true) + '</span></div>'; };
  var cssComun = '.tx-vivo{display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 10px;background:#e5342b;color:#fff;font:900 11px/1 ' + FUENTE + ';letter-spacing:.14em;transform:skewX(-12deg)}' +
    '.tx-vivo i{width:8px;height:8px;border-radius:50%;background:#fff;animation:txPulso 1.1s ease-in-out infinite}' +
    '.tx-hora{display:inline-block;padding:7px 12px;background:rgba(8,11,8,.92);color:#f4f7ee;font:800 11px/1 ' + FUENTE + ';letter-spacing:.1em;font-variant-numeric:tabular-nums;transform:skewX(-12deg);border:1px solid rgba(208,244,76,.35);border-left:0}' +
    '@keyframes txPulso{50%{opacity:.25;transform:scale(.7)}}';

  // ---------- Página de login: sello EN VIVO y cinta de titulares ----------
  function vestirLogin() {
    if (location.pathname !== '/login' || document.getElementById('tx-cinta')) return;
    var estilo = document.createElement('style');
    estilo.textContent = cssComun +
      '.tx-sello-login{display:flex;flex:0 0 auto;margin-left:auto;margin-right:18px;pointer-events:none}.tx-sello-login.suelto{position:fixed;z-index:60;top:14px;right:18px}' +
      '#tx-cinta{position:fixed;z-index:60;left:0;right:0;bottom:0;height:36px;display:flex;align-items:stretch;background:#080b08;border-top:2px solid #d0f44c;overflow:hidden;pointer-events:none}' +
      '#tx-cinta b{flex:0 0 auto;display:flex;align-items:center;padding:0 22px 0 16px;background:#d0f44c;color:#0b0f0a;font:900 12px/1 ' + FUENTE + ';font-style:italic;letter-spacing:.08em;clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%);z-index:1}' +
      '#tx-cinta div{flex:1 1 auto;overflow:hidden;display:flex;align-items:center}' +
      '#tx-cinta p{margin:0;white-space:nowrap;color:#f4f7ee;font:700 12px/1 ' + FUENTE + ';letter-spacing:.08em;text-transform:uppercase;animation:txCinta 38s linear infinite;padding-left:100%}' +
      '#tx-cinta p u{text-decoration:none;color:#d0f44c;margin:0 16px}' +
      'body{padding-bottom:36px!important}' +
      '@keyframes txCinta{to{transform:translateX(-100%)}}' +
      '@media(max-width:700px){.tx-sello-login{margin-right:10px;transform:scale(.8);transform-origin:right center}#tx-cinta{height:32px}#tx-cinta b{font-size:10.5px;padding:0 18px 0 10px}#tx-cinta p{font-size:10.5px}}' +
      '@media(prefers-reduced-motion:reduce){#tx-cinta p{animation:none;padding-left:14px}.tx-vivo i{animation:none}}';
    document.head.appendChild(estilo);
    var titulares = ['Hecho en equipo', 'La disciplina también se lleva puesta', 'Producción en tiempo real', 'Cada pedido empieza con un equipo', 'Consulta tu pedido con el número de orden', 'Uniformes deportivos a la medida'];
    var cinta = document.createElement('div'); cinta.id = 'tx-cinta'; cinta.setAttribute('aria-hidden', 'true');
    cinta.innerHTML = '<b>INDOOR SPORT</b><div><p>' + titulares.concat(titulares).map(function (t) { return t + '<u>◆</u>'; }).join('') + '</p></div>';
    document.body.appendChild(cinta);
    var caja = document.createElement('div'); caja.innerHTML = sello('tx-sello-login'); caja = caja.firstChild; caja.setAttribute('aria-hidden', 'true');
    var cabecera = document.querySelector('.login-header'), rotulo = cabecera && cabecera.querySelector(':scope > span');
    if (rotulo) cabecera.insertBefore(caja, rotulo); else { caja.classList.add('suelto'); document.body.appendChild(caja); }   // dentro del encabezado, sin tapar nada
    setInterval(function () { var h = caja.querySelector('[data-tx-hora]'); if (h) h.textContent = hora(true); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vestirLogin); else vestirLogin();

  // ---------- Entrada / bienvenida ----------
  if (quieto) return;
  // Recién iniciada la sesión (cookie que deja el servidor al entrar): presentación de bienvenida en vez de la de entrada.
  var recien = location.pathname === '/' && /(?:^|;\s*)indoor_fresh=1/.test(document.cookie);
  var CAJA = '0 0 265.09 68.59', TRAZOS = ["M157.38,65.59c-.1-.09-.19-.17-.29-.26-.09-.08-.18-.17-.27-.25-.7-.69-1.33-1.49-1.9-2.4-.02-.03-.03-.05-.05-.08-.17-.28-.33-.57-.49-.87-.04-.07-.07-.14-.1-.2-.16-.31-.32-.63-.46-.97-.17-.39-.33-.78-.47-1.18l-.18-.41-.25-.59c-.3.02.1,0-.47,0-8.16,0-10.99-6.04-8.39-17.95,2.67-11.69,8.07-17.63,16.05-17.63,1.66,0,3.52.47,4.88,1.16,1.34.68,2.48,1.82,3.12,3.15,1.99,4.13,1.11,7.86.44,12.83l-.47,2.71c-.99,4.1.52,6.15,4.62,6.15h6.34l1.35-6.18c.17-.71.34-1.44.5-2.21.12-.53.22-1.05.32-1.56,0,0,.19-.98.18-.98,3.04-17.15-3.16-25.5-18.9-25.5s-26.43,9.17-30.55,28.04c-4.14,18.94,1.84,28.15,18.28,28.15,3.42,0,5.83-.22,8.71-1.05l.94-.23-1.71-1.14c-.27-.18-.52-.38-.77-.58Z", "M185.75,12.39c-3.44,0-5.64.15-8.54.99l-1.06.36,1.3.86c1.72,1.26,3.03,2.79,4.07,4.81.08.15.15.31.23.46.05.11.11.23.16.34.13.29.26.58.38.88.02.04.03.08.05.11.13.33.26.67.38,1.01l.23.54s.06.03.41.04c7.8,0,10.62,6.24,8.15,18.04-2.54,11.63-7.86,17.53-15.81,17.53-2.64,0-5.31-.67-6.99-2.39-3.29-3.38-2.63-8.1-1.86-13.09l.89-4.31c.98-4.05-.51-6.08-4.57-6.08h-6.26c-1.66,7.77-4.18,16.31-2.55,23.6,1.12,4.97,4.3,9.1,9.08,10.9,2.99,1.13,6.6,1.56,10.02,1.56,16.51,0,26.54-9.21,30.68-28.15,4.12-18.87-1.9-28.04-18.41-28.04Z", "M21.78,0c-4.69,0-7.52,2.49-8.57,7.28L0,67.79h13.86L28.66,0h-6.88Z", "M55.06,14.26c-15.05,0-24.27,7.48-27.55,22.53l-6.77,31h13.46l7.36-33.69c1.3-5.48,4.87-8.17,10.76-8.17s8.28,2.69,7.39,8.17l-5.92,27.12c-.91,4.19.82,6.28,5.14,6.58h6.78l6.77-31c3.39-15.05-2.36-22.53-17.41-22.53Z", "M128.55,0h-6.58l-4.9,22.43c-2.19-5.48-6.69-8.17-13.27-8.17-14.17.5-23.15,9.67-27.07,27.61-3.83,17.55,2.41,26.42,18.69,26.72,16.43.1,26.42-7.78,29.88-23.63l8.36-38.28c.78-3.59-1.53-6.68-5.12-6.68ZM112.96,41.27c-2.33,10.67-7.29,16.05-14.87,16.05s-9.99-5.38-7.56-16.05c2.62-10.17,7.4-15.15,14.57-15.15s9.78,4.98,7.86,15.15Z", "M209.9,40.57l-5.94,27.21h13.46l5.99-27.41c1.68-7.67,6.21-11.56,13.59-11.56h4.49l3-13.76h-1.89c-17.65,0-28.57,8.47-32.69,25.52Z", "M260.82,7.97c0-1.82-1.07-2.77-3.1-2.77h-3.63v9.5h1.48v-4.16h1.51l.32.75,2.13,3.41h1.5l-2.68-4.16c1.61-.23,2.47-1.06,2.47-2.57ZM257.4,9.36h-1.84v-2.9h1.84c.64.14,1.07.14,1.28.22.45.22.65.64.65,1.29,0,.32-.2.75-.44.96-.21.21-.53.42-.95.42h-.53Z", "M264.02,5.84c-.64-1.17-1.6-2.25-2.89-3-1.17-.75-2.56-1.05-4.05-1.05-1.08,0-2.03.21-3.1.62-.96.33-1.82.97-2.58,1.72-.62.76-1.26,1.61-1.58,2.55-.54,1.18-.76,2.25-.76,3.33,0,.95.22,2.02.65,2.98.74,2.03,2.13,3.53,4.16,4.49,1.07.41,2.13.61,3.2.61,2.25,0,4.16-.82,5.76-2.45,1.51-1.58,2.26-3.41,2.26-5.63,0-1.49-.32-2.89-1.08-4.16ZM262.95,12.44c-.53,1.19-1.3,2.25-2.36,2.99-1.06.88-2.24,1.19-3.52,1.19-.65,0-1.17-.11-1.72-.31-.61-.12-1.16-.44-1.59-.67-.96-.62-1.73-1.47-2.24-2.54-.42-.95-.75-2.03-.75-3.09s.32-2.14.86-3.33c1.17-2.25,2.97-3.41,5.44-3.41.96,0,1.81.23,2.46.52.86.33,1.5.87,2.12,1.51,1.18,1.38,1.72,2.88,1.72,4.71,0,.84-.11,1.71-.42,2.44Z"];
  var css = cssComun +
    '#indoor-splash{position:fixed;inset:0;z-index:2147483000;background:#050605;visibility:visible!important;cursor:pointer;overflow:hidden;font-family:' + FUENTE + '}' +
    '#indoor-splash .tx-fondo{position:absolute;inset:-20%;background:repeating-linear-gradient(115deg,rgba(208,244,76,.055) 0 2px,transparent 2px 30px),radial-gradient(circle at 50% 45%,#141c10 0%,#050605 60%);animation:txFondo 6s linear infinite}' +
    '#indoor-splash .tx-foco{position:absolute;left:50%;top:46%;width:min(90vw,820px);aspect-ratio:1.6;transform:translate(-50%,-50%);background:radial-gradient(ellipse,rgba(208,244,76,.22),transparent 62%);filter:blur(34px);opacity:0;animation:txAparece .6s ease .45s forwards}' +
    '#indoor-splash .tx-barra{position:absolute;top:-25%;left:0;width:140vw;height:150%;transform:translateX(-170%) skewX(-18deg);will-change:transform}' +
    '#indoor-splash .tx-barra.a{background:#d0f44c;animation:txBarrido .75s cubic-bezier(.7,0,.2,1) forwards}' +
    '#indoor-splash .tx-barra.b{background:#f4f7ee;animation:txBarrido .75s cubic-bezier(.7,0,.2,1) .08s forwards}' +
    '#indoor-splash .tx-barra.c{background:#1b2613;animation:txBarrido .75s cubic-bezier(.7,0,.2,1) .16s forwards}' +
    '#indoor-splash .tx-centro{position:absolute;inset:0;display:grid;place-items:center;transition:opacity .22s ease}' +
    '#indoor-splash .tx-caja{display:flex;flex-direction:column;align-items:center;gap:20px;padding:0 20px;text-align:center}' +
    '#indoor-splash svg{display:block;width:min(66vw,470px);height:auto;overflow:visible;opacity:0;animation:txGolpe .55s cubic-bezier(.2,1.5,.35,1) .42s forwards}' +
    '#indoor-splash path{fill:#fefdfb}' +
    '#indoor-splash .tx-raya{width:min(52vw,360px);height:6px;background:#d0f44c;transform:skewX(-24deg) scaleX(0);transform-origin:left;animation:txRaya .45s cubic-bezier(.7,0,.2,1) .8s forwards}' +
    '#indoor-splash .tx-sello{position:absolute;top:22px;left:26px;display:flex;opacity:0;transform:translateX(-30px);animation:txEntraIzq .45s cubic-bezier(.2,1,.3,1) .7s forwards}' +
    '#indoor-splash .tx-rotulo{position:absolute;left:0;bottom:9%;display:flex;align-items:stretch;transform:translateX(-105%);animation:txRotulo .6s cubic-bezier(.2,1,.25,1) 1s forwards;filter:drop-shadow(0 14px 30px rgba(0,0,0,.55));max-width:96vw}' +
    '#indoor-splash .tx-rotulo b{display:flex;align-items:center;padding:14px 30px 14px 26px;background:#d0f44c;color:#0b0f0a;font-weight:900;font-style:italic;font-size:clamp(13px,2.4vw,19px);letter-spacing:.06em;clip-path:polygon(0 0,100% 0,calc(100% - 18px) 100%,0 100%);margin-right:-14px;z-index:1;white-space:nowrap}' +
    '#indoor-splash .tx-rotulo span{display:flex;align-items:center;padding:14px 34px 14px 30px;background:rgba(10,14,10,.96);color:#f4f7ee;font-weight:800;font-size:clamp(11px,2vw,15px);letter-spacing:.16em;text-transform:uppercase;border-top:2px solid #d0f44c;clip-path:polygon(14px 0,100% 0,calc(100% - 18px) 100%,0 100%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    // Bienvenida (después de iniciar sesión): presentación tipo jugador
    '#indoor-splash.tx-sesion svg{width:min(34vw,190px)}' +
    '#indoor-splash.tx-sesion .tx-caja{gap:16px}' +
    '#indoor-splash .tx-saludo{display:inline-block;padding:9px 20px;background:#d0f44c;color:#0b0f0a;font-weight:900;font-style:italic;font-size:clamp(12px,2.6vw,17px);letter-spacing:.2em;text-transform:uppercase;transform:skewX(-12deg) translateX(-60px);opacity:0;animation:txEntraSesgo .45s cubic-bezier(.2,1,.3,1) .78s forwards}' +
    '#indoor-splash .tx-nombre{max-width:94vw;color:#fefdfb;font-weight:900;font-style:italic;font-size:clamp(38px,10vw,104px);line-height:.98;letter-spacing:-.02em;text-transform:uppercase;overflow-wrap:anywhere;text-shadow:0 10px 40px rgba(0,0,0,.6);opacity:0;transform:translateX(90px) skewX(-10deg);filter:blur(10px);animation:txNombre .6s cubic-bezier(.15,1,.3,1) .98s forwards}' +
    '#indoor-splash.tx-sesion .tx-raya{animation-delay:1.35s;width:min(60vw,420px)}' +
    // Salida: un barrido cruza la pantalla y deja la página a la vista
    '#indoor-splash.tx-fuera{pointer-events:none;background:transparent;transition:background 0s linear .34s}' +
    '#indoor-splash.tx-fuera .tx-fondo,#indoor-splash.tx-fuera .tx-foco{opacity:0!important;animation:none;transition:opacity 0s linear .34s}' +
    '#indoor-splash.tx-fuera .tx-centro,#indoor-splash.tx-fuera .tx-sello,#indoor-splash.tx-fuera .tx-rotulo{opacity:0!important;animation:none;transition:opacity .2s ease .14s}' +
    '#indoor-splash.tx-fuera .tx-rotulo{transform:none}#indoor-splash.tx-fuera .tx-sello{transform:none}' +
    '#indoor-splash.tx-fuera .tx-barra.a{animation:txCierre .8s cubic-bezier(.7,0,.2,1) forwards}' +
    '#indoor-splash.tx-fuera .tx-barra.b{animation:txCierre .8s cubic-bezier(.7,0,.2,1) .07s forwards}' +
    '#indoor-splash.tx-fuera .tx-barra.c{animation:txCierre .8s cubic-bezier(.7,0,.2,1) .14s forwards}' +
    '@keyframes txBarrido{from{transform:translateX(-170%) skewX(-18deg)}to{transform:translateX(120%) skewX(-18deg)}}' +
    '@keyframes txCierre{from{transform:translateX(-170%) skewX(-18deg)}to{transform:translateX(120%) skewX(-18deg)}}' +
    '@keyframes txFondo{to{background-position:60px 0,0 0}}@keyframes txAparece{to{opacity:1}}' +
    '@keyframes txGolpe{0%{opacity:0;transform:scale(1.9);filter:blur(14px) brightness(3)}60%{opacity:1;filter:blur(0) brightness(1.6)}100%{opacity:1;transform:none;filter:none}}' +
    '@keyframes txRaya{to{transform:skewX(-24deg) scaleX(1)}}@keyframes txEntraIzq{to{opacity:1;transform:none}}' +
    '@keyframes txRotulo{to{transform:none}}@keyframes txEntraSesgo{to{opacity:1;transform:skewX(-12deg)}}' +
    '@keyframes txNombre{to{opacity:1;transform:none;filter:none}}' +
    '@media(max-width:700px){#indoor-splash .tx-sello{top:14px;left:14px}#indoor-splash .tx-rotulo{bottom:11%}#indoor-splash .tx-rotulo b{padding:11px 22px 11px 14px}#indoor-splash .tx-rotulo span{padding:11px 24px 11px 24px;letter-spacing:.1em}}';
  var estilo = document.createElement('style'); estilo.textContent = css;
  var capa = document.createElement('div'); capa.id = 'indoor-splash'; capa.setAttribute('aria-hidden', 'true');
  if (recien) capa.className = 'tx-sesion';
  capa.innerHTML = '<div class="tx-fondo"></div><div class="tx-foco"></div>' +
    '<div class="tx-centro"><div class="tx-caja"><svg viewBox="' + CAJA + '" role="img" aria-label="Indoor">' + TRAZOS.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</svg>' +
    (recien ? '<span class="tx-saludo">Te damos la bienvenida</span><strong class="tx-nombre"></strong>' : '') + '<span class="tx-raya"></span></div></div>' +
    sello('tx-sello') +
    '<div class="tx-rotulo"><b>INDOOR SPORT</b><span>' + (recien ? 'Sesión iniciada · ' + hora(false) : 'Producción en tiempo real') + '</span></div>' +
    '<div class="tx-barra a"></div><div class="tx-barra b"></div><div class="tx-barra c"></div>';
  if (recien) {
    var nombre = String(window.__indoorNombre || '').trim().slice(0, 40), destino = capa.querySelector('.tx-nombre');
    if (nombre) destino.textContent = nombre; else destino.remove();
  }
  // Va colgada de <html> para verse desde el primer instante, aunque el <body> aún no exista o esté oculto mientras carga.
  document.documentElement.appendChild(estilo);
  document.documentElement.appendChild(capa);
  var fuera = false;
  function salir() {
    if (fuera) return; fuera = true;
    capa.classList.add('tx-fuera');
    setTimeout(function () { capa.remove(); estilo.remove(); }, 1000);
    removeEventListener('keydown', salir, true);
  }
  capa.addEventListener('click', salir);
  addEventListener('keydown', salir, true);
  setTimeout(salir, recien ? 3400 : 2900);
})();
