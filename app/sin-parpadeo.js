// Evita el parpadeo de todo el panel: si un módulo vuelve a escribir en un contenedor EXACTAMENTE el mismo HTML
// que ya tenía (y nadie tocó su contenido desde entonces), no se reconstruye. Así no se reinician animaciones,
// no se pierde el scroll ni los oyentes de eventos de los hijos. Los contenedores con formularios
// (campos que el usuario pudo escribir) se reescriben siempre, para no cambiar el comportamiento de limpiar un formulario. Si el contenido cambió aunque sea un poco, se
// escribe normal. Se carga antes que los demás scripts.
(function () {
  if (window.__sinParpadeo) return;
  window.__sinParpadeo = true;

  // El menú nace como barra lateral y trace-ui lo transforma en navegación
  // superior. No revelar el documento entre ambos estados evita que se vea
  // por un instante la interfaz lateral durante la carga.
  function sincronizarAparicion() {
    var body = document.body;
    if (!body) return;
    document.documentElement.classList.toggle('ui-ready', body.classList.contains('top-navigation'));
  }
  function vigilarNavegacion() {
    if (!document.body) { setTimeout(vigilarNavegacion, 0); return; }
    new MutationObserver(sincronizarAparicion).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    new MutationObserver(sincronizarAparicion).observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    sincronizarAparicion();
  }
  vigilarNavegacion();

  var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!desc || !desc.set || !desc.get) return;
  var memoria = new WeakMap();   // elemento -> {src: texto asignado, ser: HTML tal como quedó en el DOM}
  var MIN = 400;                 // los textos cortos se escriben siempre (no vale la pena comparar)
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    enumerable: desc.enumerable,
    get: function () { return desc.get.call(this); },
    set: function (valor) {
      var texto = String(valor == null ? '' : valor);
      if (texto.length >= MIN && this.tagName !== 'TEXTAREA' && this.tagName !== 'SCRIPT' && this.tagName !== 'STYLE') {
        var previo = memoria.get(this);
        if (previo && previo.src === texto && desc.get.call(this) === previo.ser && !this.querySelector('input,textarea,select,dialog[open],details[open]')) return;   // idéntico y sin tocar: no se redibuja
        desc.set.call(this, texto);
        memoria.set(this, { src: texto, ser: desc.get.call(this) });
        return;
      }
      memoria.delete(this);
      desc.set.call(this, texto);
    }
  });
})();

// Pantalla de carga: mientras la página llega (antes de «ui-ready») se muestra el logo con una animación suave.
// Se quita sola cuando la página está lista, o a los 8 segundos como máximo.
(function () {
  if (window.__cargaIndoor) return; window.__cargaIndoor = true;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var estilo = document.createElement('style');
  estilo.textContent = '#carga-indoor{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(circle at 50% 40%,#1c2320,#070b08 70%);transition:opacity .45s ease,visibility .45s}' +
    '#carga-indoor.fuera{opacity:0;visibility:hidden}' +
    '#carga-indoor .ci-logo{font:900 44px Arial,sans-serif;letter-spacing:.02em;color:#e6ebf1;text-shadow:0 0 24px rgba(230,235,241,.35);animation:ciPulso 1.6s ease-in-out infinite}' +
    '#carga-indoor .ci-barra{width:220px;height:4px;border-radius:99px;background:rgba(230,235,241,.12);overflow:hidden}' +
    '#carga-indoor .ci-barra i{display:block;height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,transparent,#e6ebf1,transparent);animation:ciCorre 1.2s ease-in-out infinite}' +
    '@keyframes ciPulso{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.06);opacity:1}}' +
    '@keyframes ciCorre{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}';
  document.documentElement.appendChild(estilo);
  var capa = document.createElement('div');
  capa.id = 'carga-indoor';
  capa.setAttribute('role', 'status');
  capa.setAttribute('aria-label', 'Cargando Indoor');
  capa.innerHTML = '<div class="ci-logo">INDOOR</div><div class="ci-barra"><i></i></div>';
  document.documentElement.appendChild(capa);
  function quitar() {
    if (capa.classList.contains('fuera')) return;
    capa.classList.add('fuera');
    setTimeout(function () { capa.remove(); estilo.remove(); }, 500);
  }
  if (document.documentElement.classList.contains('ui-ready')) { quitar(); return; }
  new MutationObserver(function (cambios, observador) {
    if (document.documentElement.classList.contains('ui-ready')) { observador.disconnect(); quitar(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  setTimeout(quitar, 8000);
})();
