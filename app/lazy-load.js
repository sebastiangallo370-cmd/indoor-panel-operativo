/* CARGA PEREZOSA: que la página no pida de una vez la información de todas las pestañas al abrir o refrescar, sino a medida que se entra a cada una.
   Se carga PRIMERO (antes de los demás módulos) y envuelve fetch con dos reglas, sin tocar los datos ni las pantallas:
   1) Peticiones GET idénticas casi al mismo tiempo se juntan en una sola (al abrir, /api/produccion se pedía 3 veces, /api/permisos/mi 4, etc.).
   2) La lista de trabajos de Reprogramaciones / Programar pedido / Excel (/api/procesos) espera a que se abra una de esas pestañas. La petición no se pierde:
      queda en espera y se hace en el momento en que se entra, así que quien la pidió recibe su respuesta igual.
   Nunca se retienen los permisos, los «/mi», ni NADA de inventarios ni de alertas (alertas de tela, de inventario, de producción): esas siguen cargando al abrir. Para apagarlo en este navegador: localStorage.setItem('indoor-lazy','off') y recargar. */
(function () {
  if (window.__lazyIndoor) return;
  window.__lazyIndoor = true;
  try { if (localStorage.getItem('indoor-lazy') === 'off') return; } catch (e) { /* sin almacenamiento: sigue activo */ }
  var real = window.fetch.bind(window);
  var TTL = 1500;                     // ms durante los que una petición idéntica reutiliza la respuesta en vuelo
  var recientes = new Map();          // url -> {t, promesa}
  var enEspera = [];                  // {grupo, args, resolve, reject}

  var panelActivo = function (nombres) {
    var p = document.querySelector('.panel.active');
    return !!p && nombres.indexOf(p.dataset.panel) >= 0;
  };
  // grupo -> cuándo está abierta su pestaña
  var GRUPOS = [
    { re: /^\/api\/procesos(\/|\?|$)/, abierta: function () { return panelActivo(['reprogramacion', 'pedido', 'creador']); } }
  ];

  function ruta(entrada) {
    try { return new URL(typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '', location.href); } catch (e) { return null; }
  }
  function esGet(entrada, opciones) {
    var m = (opciones && opciones.method) || (entrada && entrada.method) || 'GET';
    return String(m).toUpperCase() === 'GET';
  }
  function grupoDe(u) {
    if (!u || u.origin !== location.origin) return null;
    var p = u.pathname + u.search;
    for (var i = 0; i < GRUPOS.length; i++) if (GRUPOS[i].re.test(p)) return GRUPOS[i];
    return null;
  }

  function soltar() {
    if (!enEspera.length) return;
    var quedan = [];
    enEspera.forEach(function (w) {
      if (w.grupo.abierta()) real.apply(null, w.args).then(w.resolve, w.reject);
      else quedan.push(w);
    });
    enEspera = quedan;
  }

  window.fetch = function (entrada, opciones) {
    var u = ruta(entrada);
    if (!u || u.origin !== location.origin || !esGet(entrada, opciones) || (opciones && opciones.signal)) return real(entrada, opciones);
    var g = grupoDe(u);
    if (g && !g.abierta()) {   // pestaña todavía sin abrir: la petición espera
      return new Promise(function (resolve, reject) { enEspera.push({ grupo: g, args: [entrada, opciones], resolve: resolve, reject: reject }); });
    }
    var clave = u.pathname + u.search, ahora = Date.now(), previa = recientes.get(clave);
    if (previa && ahora - previa.t < TTL) return previa.promesa.then(function (r) { return r.clone(); });
    var promesa = real(entrada, opciones);
    recientes.set(clave, { t: ahora, promesa: promesa });
    if (recientes.size > 60) recientes.forEach(function (v, k) { if (ahora - v.t > TTL) recientes.delete(k); });
    return promesa.then(function (r) { return r.clone(); });
  };

  // al cambiar de pestaña (clases de body o de los paneles) se sueltan las peticiones que esperaban
  function observar() {
    if (!document.body) return false;
    new MutationObserver(function () { setTimeout(soltar, 0); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
    return true;
  }
  if (!observar()) document.addEventListener('DOMContentLoaded', observar);
  document.addEventListener('click', function () { setTimeout(soltar, 300); }, true);
})();
