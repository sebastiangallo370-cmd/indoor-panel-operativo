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
  .pm[hidden],.pv[hidden]{display:none!important}
  /* franja centrada: título y pestañas pequeñas en un control segmentado de vidrio */
  .es-franja{flex-direction:column!important;justify-content:center;align-items:center!important;gap:10px!important;padding:14px 18px 16px!important;text-align:center}
  .es-franja>div:first-child{text-align:center}.es-franja h2{font-size:1.2rem!important;margin:2px 0 0!important}
  .es-tabs{margin:0!important;justify-content:center;flex-wrap:nowrap!important;gap:2px!important;padding:3px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(0,0,0,.25);width:auto!important;max-width:100%}
  .es-tab{min-height:34px!important;padding:0 16px!important;font-size:.68rem!important;letter-spacing:.08em!important;border:0!important;background:transparent!important;color:#c5d1bf;flex:none!important;white-space:nowrap}
  .es-tab:hover{background:rgba(255,255,255,.12)!important}
  .es-tab.on{background:rgba(255,255,255,.92)!important;color:#10140a!important;box-shadow:0 2px 10px rgba(255,255,255,.25)}
  @media(max-width:700px){.es-franja{box-sizing:border-box;max-width:100%!important;padding:12px 10px 14px!important}.es-tabs{width:100%!important;max-width:100%;box-sizing:border-box;overflow:visible}.es-tab{flex:1 1 0!important;min-width:0!important;padding:4px 6px!important;min-height:40px!important;font-size:.58rem!important;letter-spacing:.04em!important;white-space:normal!important;line-height:1.15;text-align:center}}
  /* mismo formato de vidrio (liquid glass) que el resto del panel */
  .es-franja,.pm-head,.pm-form,.pm-card,.pm-prom,.pm-vacio{background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.15),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.035))!important;border:1px solid rgba(255,255,255,.22)!important;-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),inset 0 -1px 0 rgba(255,255,255,.1),0 12px 30px rgba(0,0,0,.35)!important}
  .pm-prom{box-shadow:inset 0 1px 0 rgba(255,255,255,.25)!important;backdrop-filter:none}
  .pm input,.pm select{background:rgba(0,0,0,.28)!important;border:1px solid rgba(255,255,255,.2)!important;outline:none}
  .pm input:focus,.pm select:focus{border-color:rgba(255,255,255,.55)!important;box-shadow:0 0 0 3px rgba(255,255,255,.1)}
  .pm-head input{background:rgba(0,0,0,.28)!important}
  .es-franja small,.pm-head small,.pm-form h3{color:#c9d3c4!important}
  .es-tab{background:rgba(255,255,255,.06)!important;border-color:rgba(255,255,255,.2)!important;color:#d3dccf}
  .es-tab:hover{background:rgba(255,255,255,.14)!important;border-color:rgba(255,255,255,.4)!important}
  .es-tab.on{background:rgba(255,255,255,.92)!important;color:#10140a!important;border-color:#fff!important}
  .pm-btn{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.3)!important}
  .pm-btn.pri{background:rgba(255,255,255,.92)!important;color:#10140a!important;border-color:#fff!important}
  .pm-chip span{background:rgba(255,255,255,.08)!important}
  body:has(.panel[data-panel="promedios"].active) main,body:has(.panel[data-panel="molderia"].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important}
  .panel[data-panel="promedios"],.panel[data-panel="promedios"]>.pm,.panel[data-panel="promedios"]>.pv,.panel[data-panel="promedios"]>.es-franja,.panel[data-panel="molderia"]>.es-franja{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}
  .es-tab:hover{border-color:#9fd24c}.es-tab.on{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  @media(max-width:700px){.es-franja{padding:12px 14px}.es-tabs{margin-left:0;width:100%}.es-tab{flex:1;padding:0 12px}}
  @media print{.es-franja{display:none!important}}
  `;
  document.head.appendChild(css);

  const PANELES = { promedios: 'promedios', fichas: 'molderia' };
  const franja = activa => '<div class="es-franja" data-es><div><small>MÓDULO</small><h2>ESTÁNDAR 2026</h2></div><div class="es-tabs">' +
    '<button type="button" class="es-tab' + (activa === 'promedios' ? ' on' : '') + '" data-es-tab="promedios">PROMEDIOS MAESTROS</button>' +
    '<button type="button" class="es-tab' + (activa === 'fichas' ? ' on' : '') + '" data-es-tab="fichas">FICHAS TÉCNICAS</button>' +
    '<button type="button" class="es-tab' + (activa === 'proveedores' ? ' on' : '') + '" data-es-tab="proveedores">PROVEEDORES DE TELA</button></div></div>';

  // Pone (o quita) la franja arriba de cada panel según corresponda
  function sincronizar() {
    const pp = document.querySelector('.panel[data-panel="promedios"]');
    const pm = document.querySelector('.panel[data-panel="molderia"]');
    if (pp) {
      const v = window.__esVista === 'proveedores' ? 'proveedores' : 'promedios';
      let f = pp.querySelector(':scope > [data-es]');
      if (!f) { pp.insertAdjacentHTML('afterbegin', franja(v)); f = pp.firstElementChild; }
      f.querySelectorAll('[data-es-tab]').forEach(b => b.classList.toggle('on', b.dataset.esTab === v));
      let pv = pp.querySelector(':scope > .pv');
      if (!pv) { pv = document.createElement('div'); pv.className = 'pv'; f.insertAdjacentElement('afterend', pv); }
      const pm = pp.querySelector(':scope > .pm');
      if (pm) pm.hidden = v === 'proveedores';
      pv.hidden = v !== 'proveedores';
      if (v === 'proveedores' && window.proveedoresTelaPintar) window.proveedoresTelaPintar(pv);
    }
    if (pm) {
      const enFichas = window.__estandarCtx !== 'molderia' && (typeof window.molderiaCtx !== 'function' || window.molderiaCtx() === 'estandar');
      let f = pm.querySelector(':scope > [data-es]');
      if (enFichas && !f) pm.insertAdjacentHTML('afterbegin', franja('fichas'));
      else if (!enFichas && f) f.remove();
    }
  }

  function ir(que) {
    if (que === 'promedios' || que === 'proveedores') {
      window.__esVista = que;
      if (!document.querySelector('.panel[data-panel="promedios"].active')) document.querySelector('.tab[data-kind="promedios"]')?.click();
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
