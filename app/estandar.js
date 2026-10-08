(() => {
  // ESTÁNDAR 2026: módulo del menú del usuario que agrupa PROMEDIOS MAESTROS y FICHAS TÉCNICAS.
  // No duplica nada: pone una franja con las dos pestañas arriba de los dos módulos existentes y cambia entre ellos.
  if (window.__estandarListo) return;
  window.__estandarListo = true;

  const css = document.createElement('style');
  css.textContent = `
  .es-franja{display:flex;gap:16px;align-items:center;flex-wrap:wrap;width:100%;max-width:1320px;margin:0 auto 16px;padding:14px 18px;border:1px solid #4b6a2b;border-radius:18px;background:radial-gradient(120% 160% at 0 0,#1d2f12 0,#0c110d 62%)}
  .es-franja small{display:block;color:#d7ff3a;letter-spacing:.18em;font-weight:800;font-size:.64rem}.es-franja h2{margin:2px 0 0;font-size:1.5rem;letter-spacing:.02em}
  .es-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
  .es-tab{min-height:44px;padding:0 22px;border:1px solid #34432f;border-radius:999px;background:#101710;color:#c5d1bf;font-weight:800;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .es-tab:hover{border-color:#9fd24c}.es-tab.on{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  @media(max-width:700px){.es-franja{padding:12px 14px}.es-tabs{margin-left:0;width:100%}.es-tab{flex:1;padding:0 12px}}
  @media print{.es-franja{display:none!important}}
  `;
  document.head.appendChild(css);

  const PANELES = { promedios: 'promedios', fichas: 'molderia' };
  const franja = activa => '<div class="es-franja" data-es><div><small>MÓDULO</small><h2>ESTÁNDAR 2026</h2></div><div class="es-tabs">' +
    '<button type="button" class="es-tab' + (activa === 'promedios' ? ' on' : '') + '" data-es-tab="promedios">PROMEDIOS MAESTROS</button>' +
    '<button type="button" class="es-tab' + (activa === 'fichas' ? ' on' : '') + '" data-es-tab="fichas">FICHAS TÉCNICAS</button></div></div>';

  // Pone (o quita) la franja arriba de cada panel según corresponda
  function sincronizar() {
    const pp = document.querySelector('.panel[data-panel="promedios"]');
    const pm = document.querySelector('.panel[data-panel="molderia"]');
    if (pp) {
      let f = pp.querySelector(':scope > [data-es]');
      if (!f) { pp.insertAdjacentHTML('afterbegin', franja('promedios')); f = pp.firstElementChild; }
    }
    if (pm) {
      const enFichas = window.__estandarCtx !== 'molderia' && (typeof window.molderiaCtx !== 'function' || window.molderiaCtx() === 'estandar');
      let f = pm.querySelector(':scope > [data-es]');
      if (enFichas && !f) pm.insertAdjacentHTML('afterbegin', franja('fichas'));
      else if (!enFichas && f) f.remove();
    }
  }

  function ir(que) {
    if (que === 'promedios') {
      document.querySelector('.tab[data-kind="promedios"]')?.click();
    } else if (window.molderiaIr) {
      window.molderiaIr('estandar');
    }
    setTimeout(sincronizar, 60);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-es-tab]');
    if (b) { e.preventDefault(); ir(b.dataset.esTab); }
  });

  // El menú «Promedios maestros» pasa a llamarse «Estándar 2026» (abre el módulo en PROMEDIOS MAESTROS)
  function renombrarMenu() {
    const b = document.getElementById('open-promedios');
    if (b && b.textContent !== 'Estándar 2026') b.textContent = 'Estándar 2026';
    return !!b;
  }

  let n = 0;
  const espera = setInterval(() => { renombrarMenu(); sincronizar(); if (++n > 120) clearInterval(espera); }, 500);
  // los paneles pueden redibujarse: se vuelve a comprobar cuando cambia su estado
  const obs = new MutationObserver(() => { renombrarMenu(); sincronizar(); });
  const iniciar = () => { const main = document.querySelector('main'); if (main) obs.observe(main, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] }); };
  iniciar();
  document.addEventListener('click', () => setTimeout(sincronizar, 80), true);
})();
