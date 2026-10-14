// Evita el parpadeo de todo el panel: si un módulo vuelve a escribir en un contenedor EXACTAMENTE el mismo HTML
// que ya tenía (y nadie tocó su contenido desde entonces), no se reconstruye. Así no se reinician animaciones,
// no se pierde el scroll ni los oyentes de eventos de los hijos. Los contenedores con formularios
// (campos que el usuario pudo escribir) se reescriben siempre, para no cambiar el comportamiento de limpiar un formulario. Si el contenido cambió aunque sea un poco, se
// escribe normal. Se carga antes que los demás scripts.
(function () {
  if (window.__sinParpadeo) return;
  window.__sinParpadeo = true;
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
