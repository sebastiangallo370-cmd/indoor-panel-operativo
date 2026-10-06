(() => {
  // PROMEDIOS MAESTROS: acceso desde el menú del usuario al sistema de promedios (consumo por referencia), que corre en la red de la empresa.
  if (window.__promediosListo) return;
  window.__promediosListo = true;
  const URL_PROMEDIOS = 'http://192.168.0.112:5000';

  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu) return false;
    if (document.getElementById('open-promedios')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-promedios'; button.textContent = 'Promedios maestros'; button.title = 'Abre el sistema de promedios (solo dentro de la red de Indoor)';
    const anterior = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    anterior ? anterior.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); window.open(URL_PROMEDIOS, '_blank', 'noopener'); });
    return true;
  }

  // Solo quien tiene permiso «Promedios maestros» (Administración/Coordinador y Edición, ver PERMISOS).
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    if (!mi || !((mi.permisos || {}).promedios || {}).ver) return;
    let tries = 0;
    const wait = setInterval(() => { if (addMenuItem() || ++tries > 60) clearInterval(wait); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();
