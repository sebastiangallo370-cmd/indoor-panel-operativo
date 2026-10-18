(() => {
  // AGENTES unificado: una sola entrada «Agentes» en el menú de la cuenta y, junto al título de cada pantalla de agentes, una flecha desplegable para elegir qué área ver
  // (Edición, Ecommerce, Inventario). Cada área sigue siendo su propio panel (agentes.js, ecommerce.js, zeus.js); esto solo cambia de uno a otro.
  // Solo salen las áreas a las que la cuenta tiene acceso. «Memoria de agentes» queda aparte, en el menú de la cuenta.
  if (window.__agentesHub) return;
  window.__agentesHub = true;
  const AREAS = [
    { kind: 'agentes', nombre: 'EDICIÓN', sub: 'TAVO, LEO, JACK…' },
    { kind: 'ecommerce', nombre: 'ECOMMERCE', sub: 'ALMA · BRISA · CIRO' },
    { kind: 'zeus', nombre: 'INVENTARIO', sub: 'Tela y compras' },
  ];
  const css = document.createElement('style');
  css.textContent = `
  #agentes-hub{position:relative;display:none;align-items:center;margin:0 8px;vertical-align:middle;z-index:60}
  body:has(.panel[data-panel='agentes'].active) #agentes-hub,body:has(.panel[data-panel='ecommerce'].active) #agentes-hub,body:has(.panel[data-panel='zeus'].active) #agentes-hub{display:inline-flex!important}
  #agentes-hub.suelto{display:flex!important;margin:0 0 10px}
  #agentes-hub summary{display:inline-flex;align-items:center;gap:8px;list-style:none;cursor:pointer;padding:6px 12px 6px 14px;border:1px solid rgba(208,244,76,.55);border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(0,0,0,.28));color:#e8ff8a;font:900 11px Arial;letter-spacing:.1em;box-shadow:0 6px 16px -8px #000,inset 0 1px 0 rgba(255,255,255,.2);transition:border-color .15s,transform .15s}
  #agentes-hub summary::-webkit-details-marker{display:none}
  #agentes-hub summary:hover{transform:translateY(-1px);border-color:#d0f44c}
  #agentes-hub summary i{display:inline-block;width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .18s}
  #agentes-hub[open] summary i{transform:rotate(-135deg) translate(-2px,-2px)}
  #agentes-hub .ah-lista{position:absolute;left:0;top:calc(100% + 8px);min-width:220px;padding:6px;border:1px solid rgba(255,255,255,.18);border-radius:16px;background:linear-gradient(160deg,rgba(32,42,28,.97),rgba(12,16,10,.98));box-shadow:0 18px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.14);animation:ahIn .14s ease-out}
  #agentes-hub .ah-lista button{display:grid!important;gap:1px;width:100%!important;min-width:0!important;margin:0!important;padding:9px 12px!important;border:0!important;border-radius:11px!important;background:transparent!important;color:#e8f0e0!important;text-align:left;box-shadow:none!important;cursor:pointer;transition:background .12s}
  #agentes-hub .ah-lista button:hover{background:rgba(208,244,76,.14)!important}
  #agentes-hub .ah-lista button.on{background:rgba(208,244,76,.2)!important}
  #agentes-hub .ah-lista b{font:900 12px Arial;letter-spacing:.1em}
  #agentes-hub .ah-lista small{font:600 10.5px Arial;color:#9aa893}
  @keyframes ahIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
  #open-ecommerce,#open-zeus{display:none!important}
  `;
  document.head.appendChild(css);

  let caja = null;
  const tabDe = kind => document.querySelector('.tab[data-kind="' + kind + '"]');
  const activa = kind => !!document.querySelector('.panel[data-panel="' + kind + '"].active');
  const disponibles = () => AREAS.filter(a => tabDe(a.kind));

  function pintar() {
    const lista = disponibles();
    if (!caja || !lista.length) return;
    const actual = lista.find(a => activa(a.kind)) || lista[0];
    const clave = lista.map(a => a.kind).join('|') + '>' + actual.kind;
    if (caja.dataset.clave === clave) return;
    caja.dataset.clave = clave;
    caja.innerHTML = `<summary title="Elegir qué agentes ver">${actual.nombre}<i></i></summary><div class="ah-lista">` +
      lista.map(a => `<button type="button" data-area="${a.kind}" class="${a.kind === actual.kind ? 'on' : ''}"><b>${a.nombre}</b><small>${a.sub}</small></button>`).join('') + '</div>';
  }

  function ubicar() {
    // junto al título de la pantalla activa (el panel se redibuja y se lleva la caja: se vuelve a poner); si no hay título, arriba de todo
    const panel = document.querySelector('.panel.active[data-panel="agentes"],.panel.active[data-panel="ecommerce"],.panel.active[data-panel="zeus"]');
    const titulo = panel && panel.querySelector('.ag-hd h2,.bd-head h2');
    if (titulo) {
      if (caja.previousElementSibling !== titulo) titulo.insertAdjacentElement('afterend', caja);
      caja.classList.remove('suelto');
    } else if (panel) {
      const main = document.querySelector('main');
      if (main && caja.parentElement !== main) main.prepend(caja);
      caja.classList.add('suelto');
    }
  }

  function montar() {
    if (!document.querySelector('main')) return;
    if (!caja) {
      caja = document.createElement('details');
      caja.id = 'agentes-hub';
      caja.addEventListener('click', e => {
        const b = e.target.closest('[data-area]');
        if (!b) return;
        caja.removeAttribute('open');
        const t = tabDe(b.dataset.area);
        if (t) t.click();
      });
      document.addEventListener('click', e => { if (caja.open && !caja.contains(e.target)) caja.removeAttribute('open'); });
    }
    pintar();
    ubicar();
    // una sola entrada «Agentes» en el menú de la cuenta (Ecommerce e Inventario se ocultan: se eligen con la flecha junto al título);
    // si la cuenta no ve Edición, la entrada se crea aquí y abre la primera área disponible
    const menu = document.querySelector('.user-dropdown');
    const lista = disponibles();
    const viejo = document.getElementById('open-agentes');
    if (viejo && viejo.textContent !== 'Agentes') viejo.textContent = 'Agentes';
    if (menu && lista.length && !viejo && !document.getElementById('open-agentes-hub')) {
      const boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-agentes-hub'; boton.textContent = 'Agentes';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); const t = tabDe(disponibles()[0].kind); if (t) t.click(); });
      const previo = document.getElementById('open-personal-notes');
      previo ? previo.insertAdjacentElement('afterend', boton) : menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    }
  }
  setInterval(montar, 400);
  document.addEventListener('click', () => setTimeout(() => { pintar(); ubicar(); }, 60), true);
})();
