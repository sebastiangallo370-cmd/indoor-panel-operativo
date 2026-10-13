// Confirmación animada al cambiar el estado de un proceso (iniciar, finalizar, pausar, reproceso…).
// Escucha las respuestas correctas de /api/produccion/operacion, así cubre las tarjetas y el formulario de operarios sin tocar su código.
(function () {
  if (window.__confirmacionProceso) return; window.__confirmacionProceso = true;
  var TIPOS = {
    start:  { titulo: 'EN PROCESO',  color: '#d0f44c', icono: '<path d="M39 30 L39 66 L68 48 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' },
    resume: { titulo: 'REANUDADO',   color: '#d0f44c', icono: '<path d="M39 30 L39 66 L68 48 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' },
    finish: { titulo: 'FINALIZADO',  color: '#6fe07a', icono: '<path class="cp-trazo" pathLength="1" d="M29 49 L43 63 L68 35" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>', chispas: true },
    pause:  { titulo: 'PAUSADO',     color: '#ffbd4a', icono: '<path d="M38 31 V65 M58 31 V65" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>' },
    rework: { titulo: 'REPROCESO',   color: '#ff6b61', icono: '<path class="cp-trazo" pathLength="1" d="M66 40 A20 20 0 1 0 68 54 M66 27 V41 H52" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' },
    na:     { titulo: 'NO APLICA',   color: '#a7b0a0', icono: '<path class="cp-trazo" pathLength="1" d="M32 64 L64 32" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>' },
    clear:  { titulo: 'PENDIENTE',   color: '#a7b0a0', icono: '<path class="cp-trazo" pathLength="1" d="M34 48 H62" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>' }
  };
  var quieto = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var estilo = document.createElement('style');
  estilo.textContent =
    '#cp-capa{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(5,6,5,.55),rgba(5,6,5,0) 55%);animation:cpCapa 1.7s ease forwards}' +
    '#cp-capa .cp-caja{display:grid;justify-items:center;gap:12px;padding:26px 38px 22px;border-radius:24px;background:rgba(10,14,10,.93);border:1px solid var(--cp);box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 60px color-mix(in srgb,var(--cp) 30%,transparent);color:var(--cp);animation:cpCaja 1.7s cubic-bezier(.2,1.3,.4,1) forwards}' +
    '#cp-capa svg{width:104px;height:104px;overflow:visible}' +
    '#cp-capa .cp-aro{fill:color-mix(in srgb,var(--cp) 12%,transparent);stroke:currentColor;stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transform:rotate(-90deg);transform-origin:48px 48px;animation:cpDibuja .5s ease-out .05s forwards}' +
    '#cp-capa .cp-trazo{stroke-dasharray:1;stroke-dashoffset:1;animation:cpDibuja .35s ease-out .4s forwards}' +
    '#cp-capa .cp-icono{transform-origin:48px 48px;animation:cpIcono .45s cubic-bezier(.2,1.6,.4,1) .3s both}' +
    '#cp-capa .cp-chispa{stroke:currentColor;stroke-width:4;stroke-linecap:round;opacity:0;transform-origin:48px 48px;animation:cpChispa .6s ease-out .55s forwards}' +
    '#cp-capa strong{font:900 20px/1 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-indent:.14em}' +
    '#cp-capa span{color:#f4f7ee;font:700 13px/1.2 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.04em;text-align:center;max-width:70vw}' +
    '.cp-destello{animation:cpDestello 1.5s ease-out 1!important;position:relative;z-index:2}' +
    '@keyframes cpCapa{0%{opacity:0}10%,78%{opacity:1}100%{opacity:0}}' +
    '@keyframes cpCaja{0%{transform:scale(.7);opacity:0}14%{transform:scale(1);opacity:1}80%{transform:scale(1);opacity:1}100%{transform:scale(.94) translateY(-10px);opacity:0}}' +
    '@keyframes cpDibuja{to{stroke-dashoffset:0}}@keyframes cpIcono{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}' +
    '@keyframes cpChispa{0%{opacity:1;stroke-dasharray:0 30;stroke-dashoffset:0}100%{opacity:0;stroke-dasharray:10 30;stroke-dashoffset:-16}}' +
    '@keyframes cpDestello{0%{box-shadow:0 0 0 0 var(--cp,#d0f44c),0 0 0 0 transparent}25%{box-shadow:0 0 0 4px var(--cp,#d0f44c),0 0 46px 6px var(--cp,#d0f44c)}100%{box-shadow:0 0 0 0 transparent,0 0 0 0 transparent}}' +
    '@media(prefers-reduced-motion:reduce){#cp-capa,#cp-capa *{animation-duration:.01s!important;animation-delay:0s!important}#cp-capa{animation:cpCapa 1.4s steps(1,end) forwards!important}}';
  document.head.appendChild(estilo);

  function tarjeta(fila) { return document.querySelector('.trace-card[data-card-row="' + fila + '"]'); }
  function ordenDe(fila) {
    var t = tarjeta(fila); if (!t) return '';
    var nodos = t.querySelectorAll('*');
    for (var i = 0; i < nodos.length; i++) {   // el número de orden es un elemento con solo ese texto (p. ej. IS2408)
      var texto = nodos[i].children.length ? '' : nodos[i].textContent.trim();
      if (/^[A-Z]{2}\s?-?\d{3,5}$/.test(texto)) return texto;
    }
    return '';
  }
  function mostrar(accion, fila, orden) {
    var tipo = TIPOS[accion]; if (!tipo) return;
    var vieja = document.getElementById('cp-capa'); if (vieja) vieja.remove();
    var chispas = '';
    if (tipo.chispas && !quieto) for (var i = 0; i < 10; i++) chispas += '<path class="cp-chispa" d="M48 -4 V-20" transform="rotate(' + i * 36 + ' 48 48)"/>';
    var capa = document.createElement('div');
    capa.id = 'cp-capa'; capa.setAttribute('role', 'status'); capa.style.setProperty('--cp', tipo.color);
    capa.innerHTML = '<div class="cp-caja"><svg viewBox="0 0 96 96" aria-hidden="true"><circle class="cp-aro" pathLength="1" cx="48" cy="48" r="42"/>' +
      '<g class="cp-icono">' + tipo.icono + '</g>' + chispas + '</svg><strong>' + tipo.titulo + '</strong>' + (orden ? '<span>Orden ' + orden + '</span>' : '') + '</div>';
    document.body.appendChild(capa);
    setTimeout(function () { capa.remove(); }, 1750);
    // La tarjeta se vuelve a dibujar tras la respuesta (a veces más de una vez): se resalta la que quede en pantalla.
    var resaltada = null, intentos = 0, reloj = setInterval(function () {
      var t = tarjeta(fila);
      if (t && t !== resaltada) { resaltada = t; t.style.setProperty('--cp', tipo.color); t.classList.add('cp-destello'); }
      if (++intentos >= 8) { clearInterval(reloj); setTimeout(function () { if (resaltada) resaltada.classList.remove('cp-destello'); }, 1200); }
    }, 200);
  }
  window.indoorConfirmarProceso = mostrar;

  var original = window.fetch;
  window.fetch = function (entrada, opciones) {
    var promesa = original.apply(this, arguments);
    try {
      var url = String(typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '').split('?')[0];
      if (opciones && String(opciones.method || '').toUpperCase() === 'POST' && /\/api\/produccion\/operacion$/.test(url) && typeof opciones.body === 'string') {
        var cuerpo = JSON.parse(opciones.body), orden = ordenDe(cuerpo.row);
        promesa.then(function (respuesta) { if (respuesta.ok) mostrar(cuerpo.action, cuerpo.row, orden); }).catch(function () {});
      }
    } catch (e) { /* la confirmación nunca debe estorbar la operación */ }
    return promesa;
  };
})();
