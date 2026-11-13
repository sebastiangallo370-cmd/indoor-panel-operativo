/* ESTILO VIDRIO (prueba): capa visual opcional sobre el panel, inspirada en los tableros «glassy» (tarjetas de vidrio esmerilado sobre un fondo desenfocado)
   pero con los colores de Indoor (verde oscuro y lima). Solo cambia estilos (nada de datos ni de lógica): se enciende y apaga desde el menú de la cuenta
   («Estilo vidrio») y la preferencia se guarda en este navegador. Por ahora aplica a INICIO y a la barra de pestañas; las demás pantallas siguen igual.
   Apagado de fábrica: nadie lo ve hasta que lo active. No se aplica en modo claro (ese modo invierte los colores). */
(function () {
  if (window.__glassIndoor) return;
  window.__glassIndoor = true;
  var KEY = 'indoor-glass', root = document.documentElement;
  var saved = function () { try { return localStorage.getItem(KEY) === 'on'; } catch (e) { return false; } };
  var save = function (v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) { /* sin almacenamiento: vale solo esta visita */ } };

  var G = 'html.glass-on:not(.theme-light) ';
  var css = document.createElement('style');
  css.textContent = [
    /* fondo: manchas desenfocadas verde, lima y verde-azulado sobre el verde oscuro de siempre */
    G + 'body{background:transparent!important}',
    '#glass-bg{display:none}' + G + '#glass-bg{display:block;position:fixed;inset:-12%;z-index:-1;pointer-events:none;' +
      'background:radial-gradient(34% 30% at 52% 50%,rgba(150,215,110,.34),transparent 72%),radial-gradient(44% 40% at 12% 20%,rgba(208,244,76,.46),transparent 72%),radial-gradient(40% 36% at 90% 10%,rgba(96,190,140,.55),transparent 72%),' +
      'radial-gradient(46% 40% at 72% 90%,rgba(160,225,90,.42),transparent 72%),radial-gradient(40% 36% at 6% 92%,rgba(52,150,134,.52),transparent 72%);' +
      'filter:blur(38px);animation:glassDrift 38s ease-in-out infinite alternate}',
    '@keyframes glassDrift{from{transform:translate3d(-1.5%,-1%,0) scale(1)}to{transform:translate3d(1.5%,1.2%,0) scale(1.06)}}',
    /* vidrio: tarjetas y paneles de INICIO */
    G + '[data-panel="inicio"] .dash-panel,' + G + '[data-panel="inicio"] .dash-tela-box,' + G + '[data-panel="inicio"] .dash-time-tools{' +
      'background:linear-gradient(150deg,rgba(255,255,255,.16),rgba(255,255,255,.05) 46%,rgba(208,244,76,.06)),rgba(26,44,30,.34)!important;' +
      'backdrop-filter:blur(24px) saturate(165%);-webkit-backdrop-filter:blur(24px) saturate(165%);border:1px solid rgba(255,255,255,.24)!important;' +
      'border-radius:26px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 16px 40px rgba(0,0,0,.36)!important}',
    G + '[data-panel="inicio"] .dash-card,' + G + '[data-panel="inicio"] .dash-order-finder{backdrop-filter:blur(16px) saturate(145%);-webkit-backdrop-filter:blur(16px) saturate(145%);' +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.24),0 16px 38px rgba(0,0,0,.34)!important;transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s}',
    G + '[data-panel="inicio"] .dash-card:hover,' + G + '[data-panel="inicio"] .dash-panel:hover{transform:translateY(-4px);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 22px 46px rgba(0,0,0,.42)!important}',
    /* pestañas del resumen y barra principal: píldora de vidrio, la activa en lima */
    G + '[data-panel="inicio"] .dash-tabs{background:rgba(255,255,255,.07)!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'border:1px solid rgba(255,255,255,.16)!important;border-radius:999px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}',
    /* barra superior flotante: sin banda oscura, solo las píldoras sobre el fondo (como en el video) */
    G + '.sidebar{gap:16px;background:linear-gradient(180deg,rgba(6,10,7,.5),rgba(6,10,7,0))!important;border-bottom:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
    G + 'nav.tabs{flex:0 1 auto!important;margin-left:auto!important;margin-right:0!important;min-width:0!important;width:max-content!important;max-width:100%!important;justify-content:flex-end!important;gap:4px;overflow-x:auto;scrollbar-width:none}',
    G + '.sidebar{gap:10px!important}',
    G + '.systems{margin-left:0!important}',
    G + 'nav.tabs::-webkit-scrollbar{display:none}',
    G + 'nav.tabs .tab{flex:0 1 auto;min-width:0}',
    '@media(min-width:1001px){' + G + 'nav.tabs .tab{padding-left:7px!important;padding-right:7px!important}' + G + 'nav.tabs .tab strong{font-size:9px!important;letter-spacing:.02em!important}' + G + 'nav.tabs{gap:1px!important;padding:3px 4px!important}}',
    /* todos los módulos del menú con el mismo tamaño (ancho y letra) */
    '@media(min-width:1001px){' + G + 'nav.tabs>.tab,' + G + 'nav.tabs>.nav-group{flex:0 0 112px!important;width:112px!important;min-width:112px!important;box-sizing:border-box}' +
      G + 'nav.tabs>.tab,' + G + 'nav.tabs>.nav-group>.nav-parent{display:flex!important;align-items:center;justify-content:center;text-align:center;width:100%!important;padding-left:4px!important;padding-right:4px!important}' +
      G + 'nav.tabs>.tab>strong,' + G + 'nav.tabs>.tab>span,' + G + 'nav.tabs>.nav-group>.nav-parent>span:last-child{font-size:10px!important;letter-spacing:0!important;white-space:nowrap}' +
      G + 'nav.tabs>.tab>.nav-icon,' + G + 'nav.tabs>.nav-group>.nav-parent>.nav-icon{display:none!important}}',
    G + 'nav.tabs{background:rgba(255,255,255,.08);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);' +
      'border-radius:999px;padding:4px 6px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}',
    /* el resto del panel: lo que el escáner marca como tarjeta (fondo oscuro sólido y esquinas redondeadas) pasa a vidrio */
    G + '.glass-card{background:linear-gradient(150deg,rgba(255,255,255,.15),rgba(255,255,255,.04) 46%,rgba(208,244,76,.05)),rgba(26,44,30,.36)!important;' +
      'border-color:rgba(255,255,255,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 12px 32px rgba(0,0,0,.32)!important;' +
      'transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}',
    G + '.glass-card.glass-blur{backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%)}',
    G + '.glass-card.glass-lift:hover{transform:translateY(-3px);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 18px 40px rgba(0,0,0,.4)!important}',
    /* el interruptor del menú */
    '.glass-toggle{display:flex!important;align-items:center;gap:8px}',
    /* celular: menos desenfoque (cuesta batería y se traba) y vidrio más firme para que se lea bien */
    '@media(max-width:700px){' + G + '#glass-bg{filter:blur(28px);animation:none}' +
      G + '[data-panel="inicio"] .dash-panel,' + G + '[data-panel="inicio"] .dash-tela-box,' + G + '[data-panel="inicio"] .dash-card,' + G + '[data-panel="inicio"] .dash-order-finder{' +
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
      G + '[data-panel="inicio"] .dash-panel,' + G + '[data-panel="inicio"] .dash-tela-box{background:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.02)),rgba(14,24,16,.7)!important}' +
      G + '[data-panel="inicio"] .dash-tabs{border-radius:22px!important}' +
      G + '.glass-card.glass-blur{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' + G + '.glass-card.glass-lift:hover{transform:none}' +
      G + '[data-panel="inicio"] .dash-card:hover,' + G + '[data-panel="inicio"] .dash-panel:hover{transform:none}}',
    '@media(prefers-reduced-motion:reduce){' + G + '#glass-bg{animation:none}' + G + '[data-panel="inicio"] .dash-card:hover,' + G + '[data-panel="inicio"] .dash-panel:hover{transform:none}}'
  ].join('\n');
  document.head.appendChild(css);


  /* escáner: marca como «glass-card» los contenedores oscuros y redondeados del panel. Sin desenfoque en los anidados ni en listas largas (cuesta rendimiento). */
  var vistos = new WeakSet(), pendiente = false;
  function lum(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return -1;
    var v = m[1].split(',').map(parseFloat); if (v.length > 3 && v[3] < 0.85) return -1;
    return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
  }
  function escanear() {
    pendiente = false;
    if (!root.classList.contains('glass-on') || root.classList.contains('theme-light') || !document.body) return;
    var panel = document.querySelector('.panel.active'); if (!panel) return;
    var todos = panel.querySelectorAll('div,section,article,aside,details,li,form'), n = 0;
    for (var i = 0; i < todos.length && n < 700; i++) {
      var el = todos[i];
      if (vistos.has(el)) continue;
      vistos.add(el); n++;
      if (el.closest('.user-dropdown,nav,header,table,select,.glass-card,[data-panel="inicio"]')) continue;
      var r = el.getBoundingClientRect(); if (r.width < 150 || r.height < 56) continue;
      var st = getComputedStyle(el);
      if (st.position === 'fixed' || st.position === 'sticky') continue;
      var rad = parseFloat(st.borderTopLeftRadius) || 0, l = lum(st.backgroundColor);
      if (rad < 10 || l < 0 || l > 0.3) continue;
      el.classList.add('glass-card', 'glass-lift');
      var hermanos = el.parentElement ? el.parentElement.children.length : 0;
      if (hermanos <= 24 && !el.parentElement.closest('.glass-blur')) el.classList.add('glass-blur');
    }
  }
  function programar() { if (!pendiente) { pendiente = true; setTimeout(escanear, 350); } }

  function label() {
    var on = root.classList.contains('glass-on');
    document.querySelectorAll('.glass-toggle').forEach(function (b) { b.textContent = on ? 'Estilo vidrio: sí' : 'Estilo vidrio: no'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function apply(on, persist) {
    root.classList.toggle('glass-on', !!on);
    if (on && !document.getElementById('glass-bg') && document.body) { var f = document.createElement('div'); f.id = 'glass-bg'; f.setAttribute('aria-hidden', 'true'); document.body.insertBefore(f, document.body.firstChild); }
    if (persist) save(!!on);
    label();
    if (on) programar();
  }
  function addButton() {
    var menu = document.querySelector('.user-dropdown');
    if (!menu || menu.querySelector('.glass-toggle')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'glass-toggle';
    b.onclick = function () { apply(!root.classList.contains('glass-on'), true); };
    var antes = menu.querySelector('.theme-toggle') || menu.querySelector('a[href="/logout"]');
    menu.insertBefore(b, antes ? antes.nextSibling : null);
    label();
  }
  apply(saved(), false);
  addButton();
  if (!document.body) document.addEventListener('DOMContentLoaded', function () { apply(saved(), false); addButton(); });
  new MutationObserver(function () { addButton(); programar(); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', function () { setTimeout(programar, 400); }, true);
})();
