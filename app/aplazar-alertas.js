// Durante la carga inicial, las consultas de alertas e inventario esperan a que la pantalla ya se haya dibujado.
// Así Producción se muestra antes y no se traba. Pasados unos segundos, todo funciona igual que siempre.
(function () {
  'use strict';
  var PAUSA_MS = 6000;
  var DIFERIR = ['/api/alertas-telas', '/api/alertas-panel', '/api/minimaximan/actividad', '/api/inventarios'];
  var hasta = Date.now() + PAUSA_MS;
  var original = window.fetch.bind(window);
  window.fetch = function (entrada, opciones) {
    var url = typeof entrada === 'string' ? entrada : ((entrada && entrada.url) || '');
    var diferir = DIFERIR.some(function (p) { return url.indexOf(p) !== -1; });
    if (!diferir || Date.now() >= hasta) return original(entrada, opciones);
    return new Promise(function (resolver) {
      setTimeout(function () { resolver(original(entrada, opciones)); }, Math.max(0, hasta - Date.now()));
    });
  };
})();
