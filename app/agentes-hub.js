(() => {
  // AGENTES unificado: una sola entrada en el menú y una barra con las ÁREAS (Edición, Ecommerce, Inventario, Memoria).
  // Cada área sigue siendo su propio panel (agentes.js, ecommerce.js, zeus.js, memoria.js); esta barra solo cambia de uno a otro.
  // Solo salen las áreas a las que la cuenta tiene acceso (si el módulo no creó su pestaña, el área no aparece).
  if (window.__agentesHub) return;
  window.__agentesHub = true;
  const AREAS = [
    { kind: 'agentes', nombre: 'EDICIÓN', sub: 'TAVO, LEO, JACK…' },
    { kind: 'ecommerce', nombre: 'ECOMMERCE', sub: 'ALMA · BRISA · CIRO' },
    { kind: 'zeus', nombre: 'INVENTARIO', sub: 'Tela y compras' },
    { kind: 'memoria', nombre: 'MEMORIA', sub: 'Errores y lecciones' },
  ];
  const css = document.createElement('style');
  css.textContent = `
  #agentes-hub{display:none;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px;padding:5px 8px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 26px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.12)}
  body:has(.panel[data-panel='agentes'].active) #agentes-hub,body:has(.panel[data-panel='ecommerce'].active) #agentes-hub,body:has(.panel[data-panel='zeus'].active) #agentes-hub,body:has(.panel[data-panel='memoria'].active) #agentes-hub{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important}
  #agentes-hub .ah-t{display:grid;align-content:center;padding:0 10px 0 8px;font:900 10.5px Arial;letter-spacing:.16em;color:#d0f44c}
  #agentes-hub .ah-t small{display:none}
  #agentes-hub{flex-direction:row!important;align-items:stretch!important}
  #agentes-hub button{width:auto!important;max-width:none!important;flex:0 0 auto!important;margin:0!important;display:block;min-width:0!important;padding:6px 14px!important;border:1px solid rgba(255,255,255,.14);border-radius:999px!important;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.25));color:#e8f0e0;text-align:left;cursor:pointer;transition:transform .15s,border-color .15s,box-shadow .15s}
  #agentes-hub button b{font:900 11px Arial;letter-spacing:.1em}
  #agentes-hub button:hover{transform:translateY(-1px);border-color:rgba(208,244,76,.5)}
  #agentes-hub button.on{border-color:#d0f44c;background:linear-gradient(180deg,#e2ff6a,#a9d21f);color:#16200a;box-shadow:0 10px 22px -8px rgba(208,244,76,.6),inset 0 1px 0 rgba(255,255,255,.5)}
  #open-ecommerce,#open-zeus,#open-memoria{display:none!important}
  @media(max-width:700px){#agentes-hub{flex-wrap:nowrap;overflow-x:auto;margin:0 0 8px;padding:5px 6px;-webkit-overflow-scrolling:touch}#agentes-hub .ah-t{display:none}#agentes-hub button{flex:0 0 auto}}
  `;
  document.head.appendChild(css);

  let barra = null;
  const tabDe = kind => document.querySelector('.tab[data-kind="' + kind + '"]');
  const activa = kind => !!document.querySelector('.panel[data-panel="' + kind + '"].active');
  const disponibles = () => AREAS.filter(a => tabDe(a.kind));

  function pintar() {
    const lista = disponibles();
    if (!barra || !lista.length) return;
    const clave = lista.map(a => a.kind + (activa(a.kind) ? '*' : '')).join('|');
    if (barra.dataset.clave === clave) return;
    barra.dataset.clave = clave;
    barra.innerHTML = '<div class="ah-t">AGENTES</div>' + lista.map(a =>
      `<button type="button" data-area="${a.kind}" title="${a.sub}" class="${activa(a.kind) ? 'on' : ''}"><b>${a.nombre}</b></button>`).join('');
  }

  function montar() {
    const main = document.querySelector('main');
    if (!main) return false;
    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'agentes-hub';
      barra.addEventListener('click', e => {
        const b = e.target.closest('[data-area]');
        const t = b && tabDe(b.dataset.area);
        if (t) t.click();
      });
    }
    if (barra.parentElement !== main) main.prepend(barra);
    pintar();
    // una sola entrada «Agentes» en el menú de la cuenta (las demás se ocultan por CSS); si la cuenta no ve Edición, se crea aquí
    const menu = document.querySelector('.user-dropdown');
    const lista = disponibles();
    if (menu && lista.length && !document.getElementById('open-agentes') && !document.getElementById('open-agentes-hub')) {
      const boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-agentes-hub'; boton.textContent = 'Agentes';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); const t = tabDe(disponibles()[0].kind); if (t) t.click(); });
      const previo = document.getElementById('open-personal-notes');
      previo ? previo.insertAdjacentElement('afterend', boton) : menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    }
    return true;
  }
  setInterval(montar, 600);
  document.addEventListener('click', () => setTimeout(pintar, 50), true);
})();
