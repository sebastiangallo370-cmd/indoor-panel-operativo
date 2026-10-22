/* Muestra cada tela con el MISMO nombre que tiene en Effi (STOCKMAN). Solo cambia lo que se ve: el nombre interno del inventario no se toca.
   Recorre el texto de la página y, si un texto es exactamente el nombre de una tela del panel (con o sin su código entre paréntesis), pone el de Effi. */
(function () {
  'use strict';
  if (window.__nombresEffi) return;
  window.__nombresEffi = true;
  let mapa = {}, pendiente = 0;
  const norm = t => t.replace(/\s+/g, ' ').trim();
  const SALTAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);

  function aplicar(raiz) {
    if (!Object.keys(mapa).length || !raiz) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement && !SALTAR.has(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodos = [];
    while (w.nextNode()) nodos.push(w.currentNode);
    nodos.forEach(n => {
      const original = n.nodeValue;
      if (n.__efi === original) return;   // ya lo cambié yo: no lo vuelvo a tocar
      const clave = norm(original);
      const nuevo = clave && mapa[clave];
      if (!nuevo) return;
      const m = original.match(/^(\s*)[\s\S]*?(\s*)$/);
      n.nodeValue = (m ? m[1] : '') + nuevo + (m ? m[2] : '');
      n.__efi = n.nodeValue;
    });
  }

  function programar() {
    if (pendiente) return;
    pendiente = requestAnimationFrame(() => { pendiente = 0; aplicar(document.body); });
  }

  async function cargar() {
    try {
      const r = await fetch('/api/stockman/nombres', { credentials: 'same-origin' });
      if (!r.ok) return;
      mapa = (await r.json()).mapa || {};
      programar();
    } catch (_) { /* sin red: la página queda con los nombres del panel */ }
  }

  new MutationObserver(programar).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  cargar();
  setInterval(cargar, 10 * 60 * 1000);
})();
