(() => {
  // ESTÁNDAR 2026: módulo del menú del usuario que agrupa PROMEDIOS MAESTROS y FICHAS TÉCNICAS.
  // No duplica nada: pone una franja con las dos pestañas arriba de los dos módulos existentes y cambia entre ellos.
  if (window.__estandarListo) return;
  window.__estandarListo = true;
  const VISTA_KEY = 'indoor-estandar-vista';
  try {
    const guardada = localStorage.getItem(VISTA_KEY);
    if (guardada === 'promedios' || guardada === 'fichas' || guardada === 'proveedores' || guardada === 'confeccionistas') window.__esVista = guardada;
  } catch (e) { /* el panel sigue funcionando sin almacenamiento */ }

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
  .pc{width:100%;max-width:1320px;margin:0 auto}.pc-head{display:flex;justify-content:space-between;gap:18px;align-items:end;margin-bottom:18px;padding:22px;border:1px solid rgba(255,255,255,.2);border-radius:16px;background:rgba(255,255,255,.06)}.pc-head h2{margin:4px 0 0;font-size:1.45rem}.pc-head p{margin:7px 0 0;color:#bdc9b7}.pc-add{display:grid;grid-template-columns:minmax(180px,1fr) minmax(180px,1fr) auto;gap:8px;min-width:min(620px,100%)}.pc input{height:42px;box-sizing:border-box;border:1px solid #637a5d;border-radius:9px;background:#0d1710;color:#f6faf2;padding:0 12px;font-weight:700}.pc button{min-height:42px;border:1px solid #9dcc41;border-radius:9px;background:#cef34d;color:#15200d;padding:0 16px;font-weight:800;cursor:pointer}.pc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.pc-card{padding:16px;border:1px solid #466043;border-radius:13px;background:#142017}.pc-card h3{margin:0 0 12px;color:#eaf4e3;font-size:1rem}.pc-card label{display:block;margin-bottom:5px;color:#c4d5bf;font-size:.65rem;font-weight:800;letter-spacing:.09em}.pc-card form{display:grid;grid-template-columns:1fr auto;gap:8px}.pc-card .pc-empty{margin:0;color:#b6c4b2}.pc-state{min-height:19px;margin:12px 0 0;color:#d7f45a;font-size:.82rem;font-weight:700}.pc-state.error{color:#ff9d94}@media(max-width:700px){.pc-head{display:block;padding:16px}.pc-add{min-width:0;grid-template-columns:1fr}.pc-list{grid-template-columns:1fr}.pc-card form{grid-template-columns:1fr}.pc-card form button{width:100%}}
  .pv-card.pv-t .pc-save{display:none;grid-column:1/-1;padding:4px 0 12px}.pv-card.pv-t.editando .pc-save{display:flex}.pv-card.pv-t input[readonly]{border-color:transparent!important;background:transparent!important;box-shadow:none!important;padding:0!important;pointer-events:none}.pv-card.pv-t.editando input[readonly]{pointer-events:auto;background:rgba(0,0,0,.32)!important;border-color:rgba(255,255,255,.35)!important;padding:0 13px!important}
  `;
  document.head.appendChild(css);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let confeccionistas = [], pcBuscar = '';
  async function cargarConfeccionistas(root) {
    root.dataset.loaded = '1';
    root.innerHTML = '<p class="pc-empty">Cargando confeccionistas…</p>';
    try {
      const response = await fetch('/api/confeccionistas', {credentials:'same-origin', cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No se pudo cargar la información');
      confeccionistas = data.items || [];
      pintarConfeccionistas(root);
    } catch (error) { root.innerHTML = '<p class="pc-empty">' + esc(error.message || 'No se pudo cargar la información.') + '</p>'; }
  }
  function pintarConfeccionistas(root) {
    const visibles = confeccionistas.filter(item => (item.confeccionista + ' ' + item.whatsapp).toLowerCase().includes(pcBuscar.toLowerCase()));
    const completas = confeccionistas.filter(item => item.whatsapp).length;
    root.className = 'pc pv';
    root.innerHTML = '<section class="pv-head pv-glass"><div><small>ESTÁNDAR 2026</small><h2>INFORMACIÓN CONFECCIONISTA</h2><p>Agenda que completa automáticamente el WhatsApp cuando preparas una orden para confección.</p></div><div class="pv-kpis"><div class="pv-kpi pv-glass"><b>' + confeccionistas.length + '</b><span>CONFECCIONISTAS</span></div><div class="pv-kpi pv-glass"><b>' + completas + '</b><span>CON WHATSAPP</span></div><div class="pv-kpi pv-glass sin"><b>' + (confeccionistas.length - completas) + '</b><span>PENDIENTES</span></div></div></section>' +
      '<section class="pv-bar pv-glass"><input type="search" data-pc-search placeholder="Buscar confeccionista o WhatsApp" value="' + esc(pcBuscar) + '"></section><p class="pc-state" aria-live="polite"></p>' +
      '<section class="pv-grid">' + (visibles.length ? visibles.map(item => '<article class="pv-card pv-t' + (item.whatsapp ? '' : ' sin') + '"><div class="pt-head"><h3 class="pt-nom">' + esc(item.confeccionista) + '</h3><button type="button" class="pt-lapiz" data-pc-edit title="Editar WhatsApp">✎</button></div><form data-pc="' + esc(item.confeccionista) + '" class="pt-form"><label class="pt-row pt-w2"><span class="pt-lbl">WhatsApp de la confeccionista</span><input name="whatsapp" value="' + esc(item.whatsapp) + '" placeholder="Ej. 3001234567" inputmode="tel" maxlength="20" readonly></label><div class="pt-acc pc-save"><button class="pt-b pri">GUARDAR</button></div></form><div class="pt-stats"><div><b>' + esc(item.whatsapp || '—') + '</b><span>WhatsApp registrado</span></div></div></article>').join('') : '<div class="pv-vacio pv-glass">No hay confeccionistas que coincidan con la búsqueda.</div>') + '</section>';
    const status = root.querySelector('.pc-state');
    root.querySelector('[data-pc-search]').addEventListener('input', event => { pcBuscar = event.target.value; pintarConfeccionistas(root); });
    root.querySelectorAll('[data-pc-edit]').forEach(button => button.addEventListener('click', () => { const card = button.closest('.pv-card'); const input = card?.querySelector('input[name="whatsapp"]'); if (!card || !input) return; card.classList.add('editando'); input.readOnly = false; input.focus(); input.select(); }));
    root.querySelectorAll('form').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault(); const name = form.dataset.pc || form.elements.confeccionista.value.trim(); const phone = form.elements.whatsapp.value.trim();
      if (!name) return; status.className = 'pc-state'; status.textContent = 'Guardando…';
      try { const response = await fetch('/api/confeccionistas', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({confeccionista:name, whatsapp:phone})}); const data = await response.json(); if (!response.ok) throw Error(data.detail || 'No se pudo guardar'); status.textContent = data.confeccionista + ' actualizada.'; await cargarConfeccionistas(root); }
      catch (error) { status.className = 'pc-state error'; status.textContent = error.message || 'No se pudo guardar.'; }
    }));
  }
  window.confeccionistasPintar = root => { if (!root.dataset.loaded) cargarConfeccionistas(root); };

  const PANELES = { promedios: 'promedios', fichas: 'molderia' };
  const franja = activa => '<div class="es-franja" data-es><div><small>MÓDULO</small><h2>ESTÁNDAR 2026</h2></div><div class="es-tabs">' +
    '<button type="button" class="es-tab' + (activa === 'promedios' ? ' on' : '') + '" data-es-tab="promedios">PROMEDIOS MAESTROS</button>' +
    '<button type="button" class="es-tab' + (activa === 'fichas' ? ' on' : '') + '" data-es-tab="fichas">FICHAS TÉCNICAS</button>' +
    '<button type="button" class="es-tab' + (activa === 'proveedores' ? ' on' : '') + '" data-es-tab="proveedores">INFORMACIÓN TELA</button>' +
    '<button type="button" class="es-tab' + (activa === 'confeccionistas' ? ' on' : '') + '" data-es-tab="confeccionistas">INFORMACIÓN CONFECCIONISTA</button></div></div>';

  // Pone (o quita) la franja arriba de cada panel según corresponda
  function sincronizar() {
    const pp = document.querySelector('.panel[data-panel="promedios"]');
    const pm = document.querySelector('.panel[data-panel="molderia"]');
    if (pp) {
      const v = ['proveedores','confeccionistas'].includes(window.__esVista) ? window.__esVista : 'promedios';
      let f = pp.querySelector(':scope > [data-es]');
      if (!f) { pp.insertAdjacentHTML('afterbegin', franja(v)); f = pp.firstElementChild; }
      f.querySelectorAll('[data-es-tab]').forEach(b => b.classList.toggle('on', b.dataset.esTab === v));
      let pv = pp.querySelector(':scope > .pv');
      if (!pv) { pv = document.createElement('div'); pv.className = 'pv'; f.insertAdjacentElement('afterend', pv); }
      let pc = pp.querySelector(':scope > .pc');
      if (!pc) { pc = document.createElement('div'); pc.className = 'pc'; pv.insertAdjacentElement('afterend', pc); }
      const pm = pp.querySelector(':scope > .pm');
      if (pm) pm.hidden = v !== 'promedios';
      pv.hidden = v !== 'proveedores';
      pc.hidden = v !== 'confeccionistas';
      if (v === 'proveedores' && window.proveedoresTelaPintar) window.proveedoresTelaPintar(pv);
      if (v === 'confeccionistas') window.confeccionistasPintar(pc);
    }
    if (pm) {
      const enFichas = window.__estandarCtx !== 'molderia' && (typeof window.molderiaCtx !== 'function' || window.molderiaCtx() === 'estandar');
      let f = pm.querySelector(':scope > [data-es]');
      if (enFichas && !f) pm.insertAdjacentHTML('afterbegin', franja('fichas'));
      else if (!enFichas && f) f.remove();
    }
  }

  function ir(que) {
    if (que === 'promedios' || que === 'proveedores' || que === 'confeccionistas') {
      window.__esVista = que;
      if (!document.querySelector('.panel[data-panel="promedios"].active')) document.querySelector('.tab[data-kind="promedios"]')?.click();
    } else if (window.molderiaIr) {
      window.__esVista = 'fichas';
      window.molderiaIr('estandar');
    }
    try { localStorage.setItem(VISTA_KEY, window.__esVista || 'promedios'); } catch (e) { /* sin almacenamiento */ }
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
  // Al volver con F5, el menú abre Estándar y esta vista conserva su subpestaña.
  const vistaGuardada = window.__esVista;
  if (vistaGuardada && vistaGuardada !== 'promedios') {
    let intentos = 0;
    const restaurar = setInterval(() => {
      if (++intentos > 60) return clearInterval(restaurar);
      const panelPromedios = document.querySelector('.panel[data-panel="promedios"].active');
      const panelFichas = document.querySelector('.panel[data-panel="molderia"].active');
      if (!panelPromedios && !panelFichas) return;
      clearInterval(restaurar);
      ir(vistaGuardada);
    }, 250);
  }
  document.addEventListener('click', () => setTimeout(sincronizar, 80), true);
})();
