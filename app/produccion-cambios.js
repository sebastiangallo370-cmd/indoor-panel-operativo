/* Producción · resalta lo que cambió. Solo lectura: no toca datos ni controles.
   Cuando la actualización automática redibuja las tarjetas, compara cada una con su versión anterior (por código de orden)
   y hace destellar una vez el dato que cambió (estado, MTS, cantidad, entrega, notas) y la tarjeta entera.
   Para apagarlo: localStorage.setItem('indoor-cambios-off', '1'). Respeta prefers-reduced-motion. */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-cambios-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('produccion-cambios')) return;
  const quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const st = document.createElement('style');
  st.id = 'produccion-cambios';
  st.textContent = `
  @keyframes pcDato{0%{background-color:rgba(208,236,147,0);box-shadow:0 0 0 0 rgba(208,236,147,0)}25%{background-color:rgba(208,236,147,.38);box-shadow:0 0 0 4px rgba(208,236,147,.22)}100%{background-color:rgba(208,236,147,0);box-shadow:0 0 0 0 rgba(208,236,147,0)}}
  @keyframes pcCard{0%{box-shadow:0 0 0 0 rgba(208,236,147,0)}30%{box-shadow:0 0 0 2px rgba(208,236,147,.55),0 0 28px -4px rgba(208,236,147,.4)}100%{box-shadow:0 0 0 0 rgba(208,236,147,0)}}
  html body .trace-card .pc-dato{border-radius:6px;animation:pcDato 2.4s ease-out 1}
  html body .trace-card.pc-card{animation:pcCard 2.4s ease-out 1}
  @media(prefers-reduced-motion:reduce){html body .trace-card .pc-dato,html body .trace-card.pc-card{animation:none}}
  `;
  document.head.appendChild(st);

  const CAMPOS = ['.trace-stage', '.trace-mts-display', '.trace-machine-btn', '.trace-due', '.trace-dias', '.trace-primary-facts', '.trace-inline-notes', '.trace-line'];
  const antes = new Map();   // código de orden → { selector#n → texto }
  let primera = true, escribiendo = false, t = 0;

  const codigo = c => { const h = c.querySelector('h3'); return h ? h.textContent.trim() : ''; };
  function leer(c) {
    const m = {};
    CAMPOS.forEach(sel => [].forEach.call(c.querySelectorAll(sel), (e, i) => { m[sel + '#' + i] = e.textContent.replace(/\s+/g, ' ').trim(); }));
    return m;
  }
  function revisar() {
    const cards = [].slice.call(document.querySelectorAll('.trace-cards .trace-card'));
    if (!cards.length) return;
    const nuevos = new Map();
    cards.forEach(c => {
      const id = codigo(c); if (!id) return;
      const ahora = leer(c), previo = antes.get(id);
      nuevos.set(id, ahora);
      if (primera || !previo || quieto) return;
      let hubo = false;
      Object.keys(ahora).forEach(k => {
        if (previo[k] !== undefined && previo[k] !== ahora[k]) {
          const [sel, n] = k.split('#'), el = c.querySelectorAll(sel)[+n];
          if (el) { el.classList.add('pc-dato'); hubo = true; }
        }
      });
      if (hubo) { c.classList.add('pc-card'); setTimeout(() => c.classList.remove('pc-card'), 2600); }
    });
    nuevos.forEach((v, k) => antes.set(k, v));
    primera = false;
  }
  function programar() { clearTimeout(t); t = setTimeout(() => { if (escribiendo) return; escribiendo = true; try { revisar(); } finally { setTimeout(() => { escribiendo = false; }, 50); } }, 1000); }

  let intentos = 0;
  const espera = setInterval(() => {
    intentos++;
    const cont = document.querySelector('.trace-cards');
    if (cont) {
      clearInterval(espera);
      new MutationObserver(ms => { if (escribiendo) return; if (ms.every(m => [].concat([].slice.call(m.addedNodes), [].slice.call(m.removedNodes)).every(n => n.nodeType === 1 && /(^|\s)(pe-|pc-)/.test(n.className || '')) && (m.addedNodes.length + m.removedNodes.length) > 0)) return; programar(); }).observe(cont, { childList: true, subtree: true, characterData: true });   // solo las tarjetas (no la tabla oculta de miles de elementos)
      programar();
    } else if (intentos > 60) clearInterval(espera);
  }, 500);
})();
