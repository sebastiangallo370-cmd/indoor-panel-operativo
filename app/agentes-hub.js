(() => {
  // AGENTES unificado: un robot junto al botón del sol (cambio de tema) que abre una lista desplegable con todos los agentes agrupados por área
  // (Edición, Ecommerce, Inventario, Comercial). Cada área sigue siendo su propio panel (agentes.js, ecommerce.js, zeus.js, club-admin.js); esto solo
  // lleva a uno u otro. Solo salen las áreas a las que la cuenta tiene acceso. «Memoria de agentes» queda aparte, en el menú de la cuenta.
  if (window.__agentesHub) return;
  window.__agentesHub = true;
  const AREAS = [
    { kind: 'agentes', nombre: 'EDICIÓN', agentes: [['TAVO', 'Coordina el pedido'], ['LEO', 'Lee el listado'], ['JACK', 'Crea la muestra'], ['OLVER', 'Mesas de trabajo'], ['OLIVER', 'Tallas, números y PDF'], ['TERRY', 'MTS y Google Sheets']] },
    { kind: 'ecommerce', nombre: 'ECOMMERCE', agentes: [['ALMA', 'Descarga las órdenes'], ['BRISA', 'Exporta las tallas'], ['CIRO', 'PDF y Google Sheets']] },
    { kind: 'zeus', nombre: 'INVENTARIOS', agentes: [['ZEUS', 'Tela y órdenes de compra']] },
    { kind: 'club', nombre: 'COMERCIAL', agentes: [['EFFITRON', 'Cotización de las reposiciones']] },
  ];
  const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4.6"/><circle cx="12" cy="3.6" r="1.1"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9.5 16.4h5M2.5 12.5v3M21.5 12.5v3"/></svg>';
  const css = document.createElement('style');
  css.textContent = `
  #agentes-hub{position:relative;display:none;align-items:center;margin:0 6px 0 0;vertical-align:middle;z-index:1200}
  #agentes-hub.listo{display:inline-flex}
  #agentes-hub summary{flex:0 0 42px;width:42px;height:42px;padding:0;display:grid;place-items:center;list-style:none;cursor:pointer;border:1px solid rgba(208,244,76,.3);border-radius:50%;background:#10150e;color:#d0f44c;transition:transform .15s,box-shadow .15s,background .15s}
  #agentes-hub summary::-webkit-details-marker{display:none}
  #agentes-hub summary:hover{box-shadow:0 0 0 3px rgba(208,244,76,.15)}#agentes-hub summary:active{transform:scale(.92)}
  #agentes-hub[open] summary{background:#d0f44c;color:#10150e}
  #agentes-hub summary svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  #agentes-hub .ah-lista{position:absolute;right:0;left:auto;top:calc(100% + 10px);width:min(290px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;padding:8px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:linear-gradient(160deg,rgba(32,42,28,.97),rgba(12,16,10,.98));box-shadow:0 18px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.14);animation:ahIn .16s ease-out}
  #agentes-hub .ah-area{border-radius:13px;transition:background .15s}
  #agentes-hub .ah-area+.ah-area{margin-top:2px}
  #agentes-hub .ah-area.on{background:rgba(208,244,76,.1)}
  #agentes-hub .ah-fila{display:flex;align-items:center}
  #agentes-hub .ah-lista button{display:flex!important;align-items:center;gap:10px;min-width:0!important;margin:0!important;border:0!important;background:transparent!important;color:#e8f0e0!important;text-align:left;box-shadow:none!important;cursor:pointer;transition:background .12s,transform .12s}
  #agentes-hub .ah-ir{flex:1;justify-content:space-between;padding:12px 12px!important;border-radius:13px!important}
  #agentes-hub .ah-ir b{font:900 13px Arial;letter-spacing:.12em}
  #agentes-hub .ah-ir:hover,#agentes-hub .ah-mas:hover{background:rgba(208,244,76,.14)!important}
  #agentes-hub .ah-mas{flex:0 0 40px;width:40px!important;height:40px;justify-content:center;border-radius:11px!important;padding:0!important}
  #agentes-hub .ah-mas i{width:8px;height:8px;border-right:2px solid #d0f44c;border-bottom:2px solid #d0f44c;transform:rotate(45deg) translateY(-2px);transition:transform .2s}
  #agentes-hub .ah-area.abierta .ah-mas i{transform:rotate(-135deg) translate(-2px,-2px)}
  #agentes-hub .ah-ag{display:grid;overflow:hidden;max-height:0;opacity:0;transition:max-height .25s ease,opacity .2s}
  #agentes-hub .ah-area.abierta .ah-ag{max-height:420px;opacity:1;padding:0 4px 6px}
  #agentes-hub .ah-ag button{width:100%!important;padding:7px 10px!important;border-radius:10px!important}
  #agentes-hub .ah-ag button:hover{background:rgba(208,244,76,.14)!important;transform:translateX(2px)}
  #agentes-hub .ah-ag em{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:50%;background:rgba(208,244,76,.12);border:1px solid rgba(208,244,76,.28);font:900 11px Arial;font-style:normal;color:#d0f44c}
  #agentes-hub .ah-ag span{display:grid;gap:1px;min-width:0}
  #agentes-hub .ah-ag b{font:900 12px Arial;letter-spacing:.1em}
  #agentes-hub .ah-lista small{font:600 11px Arial;color:#9aa893}
  @keyframes ahIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  #open-ecommerce,#open-zeus{display:none!important}
  `;
  document.head.appendChild(css);

  let caja = null;
  const abiertas = new Set();   // áreas con sus agentes desplegados
  const tabDe = kind => document.querySelector('.tab[data-kind="' + kind + '"]');
  const activa = kind => !!document.querySelector('.panel[data-panel="' + kind + '"].active');
  const disponibles = () => AREAS.filter(a => tabDe(a.kind));

  function pintar() {
    const lista = disponibles();
    if (!caja) return;
    caja.classList.toggle('listo', lista.length > 0);
    if (!lista.length) return;
    const clave = lista.map(a => a.kind).join('|') + '>' + (lista.find(a => activa(a.kind)) || {}).kind;
    if (caja.dataset.clave === clave) return;
    caja.dataset.clave = clave;
    const total = lista.reduce((n, a) => n + a.agentes.length, 0);
    // la lista muestra primero las ÁREAS (Edición, Ecommerce, Inventarios, Comercial); la flecha de cada una despliega sus agentes
    caja.innerHTML = `<summary title="Agentes (${total})" aria-label="Agentes">${ROBOT}</summary><div class="ah-lista">` +
      lista.map(a => `<div class="ah-area${abiertas.has(a.kind) ? ' abierta' : ''}${activa(a.kind) ? ' on' : ''}"><div class="ah-fila">` +
        `<button type="button" class="ah-ir" data-area="${a.kind}"><b>${a.nombre}</b><small>${a.agentes.length} ${a.agentes.length === 1 ? 'agente' : 'agentes'}</small></button>` +
        `<button type="button" class="ah-mas" data-mas="${a.kind}" title="Ver los agentes de ${a.nombre}" aria-label="Ver los agentes de ${a.nombre}"><i></i></button></div>` +
        `<div class="ah-ag">` + a.agentes.map(g => `<button type="button" data-area="${a.kind}"><em>${g[0][0]}</em><span><b>${g[0]}</b><small>${g[1]}</small></span></button>`).join('') + '</div></div>').join('') + '</div>';
  }

  function ubicar() {
    // arriba a la derecha, justo después del sol del tema: esa zona no se redibuja nunca (los paneles sí) y siempre está a la vista
    const barra = document.querySelector('.systems');
    if (barra) {
      caja.style.display = '';
      const sol = barra.querySelector('.theme-icon');
      if (sol) { if (caja.previousElementSibling !== sol) sol.after(caja); }
      else if (caja.parentElement !== barra || caja !== barra.firstElementChild) barra.insertBefore(caja, barra.firstChild);
      return;
    }
    // sin la barra de arriba (pantallas angostas): solo se muestra encima del panel cuando se está en una pantalla de agentes
    const enAgentes = AREAS.some(a => activa(a.kind)), main = document.querySelector('main');
    caja.style.display = enAgentes ? '' : 'none';
    if (main && enAgentes && caja.parentElement !== main) main.prepend(caja);
  }

  function montar() {
    if (!document.querySelector('main')) return;
    if (!caja) {
      caja = document.createElement('details');
      caja.id = 'agentes-hub';
      caja.addEventListener('click', e => {
        const mas = e.target.closest('[data-mas]');
        if (mas) {   // la flecha despliega o pliega los agentes del área (sin cambiar de pantalla)
          const k = mas.dataset.mas, fila = mas.closest('.ah-area');
          abiertas.has(k) ? abiertas.delete(k) : abiertas.add(k);
          fila.classList.toggle('abierta', abiertas.has(k));
          return;
        }
        const b = e.target.closest('[data-area]');
        if (!b) return;
        caja.removeAttribute('open');
        const t = tabDe(b.dataset.area);
        if (t) t.click();
      });
      document.addEventListener('click', e => { if (caja.open && !caja.contains(e.target)) caja.removeAttribute('open'); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') caja.removeAttribute('open'); });
    }
    pintar();
    ubicar();
    // una sola entrada «Agentes» en el menú de la cuenta (Ecommerce e Inventario se ocultan: se eligen con el robot);
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
