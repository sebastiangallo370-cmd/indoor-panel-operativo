// Menú del usuario ordenado: las herramientas arriba y todo lo de la cuenta dentro de «Configuración de cuenta».
// Otros scripts agregan sus botones al menú cuando les toca; este los reubica cada vez y oculta lo duplicado.
(function () {
  const CLAVE = 'menu_cuenta_abierto';
  const css = document.createElement('style');
  css.textContent = `
  .user-dropdown .mc-grupo{margin:6px 0;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);padding:4px 0}
  .user-dropdown .mc-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;font-weight:800;letter-spacing:.02em}
  .user-dropdown .mc-cab i{font-style:normal;transition:transform .2s;opacity:.7}
  .user-dropdown .mc-grupo.abierto .mc-cab i{transform:rotate(180deg)}
  .user-dropdown .mc-cuerpo{display:none;margin:2px 0 4px 10px;padding-left:8px;border-left:2px solid rgba(195,238,63,.35)}
  .user-dropdown .mc-grupo.abierto .mc-cuerpo{display:block}
  .user-dropdown .mc-cuerpo>*{display:block;width:100%}
  .user-dropdown .mc-sec{margin:8px 12px 2px;font:800 .62rem Arial;letter-spacing:.14em;color:#8e9a87;text-transform:uppercase}`;
  document.head.appendChild(css);

  let abierto = false;
  try { abierto = localStorage.getItem(CLAVE) === '1'; } catch (e) { /* sin almacenamiento */ }

  let obs = null, pendiente = 0;
  function organizar() {
    const m = document.querySelector('.user-dropdown');
    if (!m) return;
    if (obs) obs.disconnect();
    try {
      const rol = m.querySelector(':scope > p');
      const logout = m.querySelector(':scope > a[href="/logout"]') || m.querySelector('a[href="/logout"]');
      const porId = id => document.getElementById(id);
      // lo duplicado: «Fichas técnicas» ya está dentro de Estándar 2026
      const fichas = porId('open-fichas-resumen');
      if (fichas) fichas.style.display = porId('open-promedios') ? 'none' : '';
      let grupo = m.querySelector(':scope > .mc-grupo');
      if (!grupo) {
        grupo = document.createElement('div');
        grupo.className = 'mc-grupo' + (abierto ? ' abierto' : '');
        grupo.innerHTML = '<button type="button" class="mc-cab" aria-expanded="' + abierto + '"><span>⚙ Configuración de cuenta</span><i>▾</i></button><div class="mc-cuerpo"></div>';
        grupo.querySelector('.mc-cab').addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          abierto = !grupo.classList.contains('abierto');
          grupo.classList.toggle('abierto', abierto);
          e.currentTarget.setAttribute('aria-expanded', String(abierto));
          try { localStorage.setItem(CLAVE, abierto ? '1' : '0'); } catch (er) { /* sin almacenamiento */ }
        });
      }
      const cuerpo = grupo.querySelector('.mc-cuerpo');
      // herramientas: arriba, en este orden
      const herramientas = [
        m.querySelector('.li-menu-item:not(.li-create-user)'), porId('open-agentes'), porId('open-promedios'), porId('open-molderia'), fichas
      ].filter(Boolean);
      // cuenta: dentro de la sección
      const cuenta = [porId('open-profile'), porId('open-name'), porId('open-password'), porId('open-personal-notes'), m.querySelector('.li-create-user'), m.querySelector('.theme-toggle')].filter(Boolean);
      let ref = rol ? rol.nextSibling : m.firstChild;
      herramientas.forEach(el => { if (el.parentNode !== m || el !== ref) m.insertBefore(el, ref); ref = el.nextSibling; });
      if (grupo.parentNode !== m || grupo !== ref) m.insertBefore(grupo, ref);
      let r2 = cuerpo.firstChild;
      cuenta.forEach(el => { if (el.parentNode !== cuerpo || el !== r2) cuerpo.insertBefore(el, r2); r2 = el.nextSibling; });
      if (logout && logout.parentNode === m && grupo.nextElementSibling !== logout) m.insertBefore(logout, grupo.nextSibling);
    } finally {
      obs = obs || new MutationObserver(() => { clearTimeout(pendiente); pendiente = setTimeout(organizar, 150); });
      const d = document.querySelector('.user-dropdown');
      if (d) obs.observe(d, { childList: true, subtree: true });
    }
  }
  let n = 0;
  const espera = setInterval(() => { if (document.querySelector('.user-dropdown #open-profile') || ++n > 100) { clearInterval(espera); organizar(); } }, 250);
})();
