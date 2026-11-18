(() => {
  // Un ingreso nuevo inicia en Inicio. En una recarga de la misma sesión se
  // recuperan automáticamente la pantalla, su subpestaña y el desplazamiento.
  if (window.__recordarVista) return;
  window.__recordarVista = true;
  const CLAVE = 'indoor-ultima-vista';
  const CLAVE_SESION = 'indoor-sesion-vista';
  const CLAVE_PANEL = 'indoor-ubicacion-panel';
  // Un parámetro temporal de actualización nunca debe quedarse en la URL.
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('actualizar')) {
      url.searchParams.delete('actualizar');
      history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
    }
  } catch (e) { /* URL API no disponible */ }
  const claveUbicacion = () => {
    const panel = document.querySelector('.panel.active')?.dataset?.panel || 'inicio';
    const activo = document.querySelector('.panel.active [data-dash-tab].on')?.dataset?.dashTab
      || document.querySelector('.panel.active [data-es-tab].active')?.dataset?.esTab
      || 'principal';
    return 'indoor-ubicacion:' + panel + ':' + activo;
  };
  const guardarUbicacion = () => {
    const panel = document.querySelector('.panel.active')?.dataset?.panel;
    if (!panel) return;
    try {
      sessionStorage.setItem(CLAVE_SESION, '1');
      sessionStorage.setItem(CLAVE_PANEL, panel);
      sessionStorage.setItem(claveUbicacion(), String(Math.max(0, Math.round(scrollY))));
    } catch (e) { /* sin almacenamiento */ }
  };
  let restaurada = false, temporizador = 0, usuarioToco = false;
  const restaurarUbicacion = () => {
    if (restaurada) return;
    if (usuarioToco) { restaurada = true; return; }
    const panel = document.querySelector('.panel.active')?.dataset?.panel;
    if (!panel || (panel === 'inicio' && !document.querySelector('#home-dashboard .dash-tabs'))) {
      clearTimeout(temporizador);
      temporizador = setTimeout(restaurarUbicacion, 80);
      return;
    }
    let punto = 0;
    try { punto = Number(sessionStorage.getItem(claveUbicacion()) || 0); } catch (e) { /* sin almacenamiento */ }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scrollTo({ top: Number.isFinite(punto) ? punto : 0, left: 0, behavior: 'auto' });
      restaurada = true;
    }));
  };
  const abrirInicio = () => {
    const inicio = document.querySelector('.tab[data-kind="inicio"]');
    if (!inicio) return false;
    if (!inicio.classList.contains('active')) inicio.click();
    return true;
  };
  const abrirPanelGuardado = () => {
    let panel = '';
    try { panel = sessionStorage.getItem(CLAVE_PANEL) || ''; } catch (e) { /* sin almacenamiento */ }
    // Producción no se reabre sola al recargar: es pesada y se traba; se abre Inicio y el usuario entra cuando quiera
    if (!panel || panel === 'inicio' || panel === 'produccion') return abrirInicio();
    const destino = document.querySelector('.tab[data-kind="' + CSS.escape(panel) + '"]');
    if (!destino) return false;
    if (!destino.classList.contains('active')) destino.click();
    return true;
  };
  try { localStorage.removeItem(CLAVE); } catch (e) { /* dato heredado */ }
  let esRecarga = false;
  try { esRecarga = sessionStorage.getItem(CLAVE_SESION) === '1'; } catch (e) { /* sin almacenamiento */ }
  let pendienteGuardar = 0;
  addEventListener('scroll', () => {
    clearTimeout(pendienteGuardar);
    pendienteGuardar = setTimeout(guardarUbicacion, 120);
  }, { passive: true });
  addEventListener('pagehide', guardarUbicacion, { capture: true });
  addEventListener('beforeunload', guardarUbicacion, { capture: true });
  addEventListener('indoor:inicio-antes-de-cambiar', guardarUbicacion);
  addEventListener('indoor:inicio-listo', restaurarUbicacion);
  document.addEventListener('click', event => {
    if (event.isTrusted) usuarioToco = true;
  }, { capture: true });
  const iniciar = () => {
    const abierto = esRecarga ? abrirPanelGuardado() : abrirInicio();
    if (abierto) restaurarUbicacion();
    else setTimeout(iniciar, 80);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();

/* Rendimiento adaptativo: conserva el diseño completo, pero evita efectos
   costosos en equipos con pocos núcleos o poca memoria. */
(() => {
  const nucleos = Number(navigator.hardwareConcurrency || 0);
  const memoria = Number(navigator.deviceMemory || 0);
  const equipoLimitado = (nucleos > 0 && nucleos <= 4) || (memoria > 0 && memoria <= 4);
  if (!equipoLimitado) return;
  document.documentElement.classList.add('indoor-low-power');
  const style = document.createElement('style');
  style.textContent = `
    html.indoor-low-power .card,html.indoor-low-power .panel,html.indoor-low-power dialog{
      backdrop-filter:none!important;-webkit-backdrop-filter:none!important
    }
  `;
  document.head.appendChild(style);
})();

/* Historial interno: Atrás cambia entre pestañas del panel sin abandonar la sesión. */
(() => {
  if (window.__historialVistasIndoor) return;
  window.__historialVistasIndoor = true;
  let restaurando = false;
  const texto = el => (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const guardar = view => {
    try { history.pushState({ indoorPanel: true, guard: true, indoorView: view }, '', location.href); } catch (e) { /* History API no disponible */ }
  };
  const vistaDe = target => {
    const tab = target.closest?.('.tab[data-kind]');
    if (tab) return { kind: tab.dataset.kind, label: texto(tab) };
    const estandar = target.closest?.('[data-es-tab]');
    if (estandar) return { estandar: estandar.dataset.esTab };
    return null;
  };
  const abrir = view => {
    if (!view) return;
    restaurando = true;
    if (view.estandar) {
      try { localStorage.setItem('indoor-estandar-vista', view.estandar); } catch (e) {}
      document.getElementById('open-promedios')?.click();
      setTimeout(() => document.querySelector('.panel[data-panel="promedios"].active [data-es-tab="' + view.estandar + '"]')?.click(), 180);
    } else if (view.kind) {
      const tabs = [...document.querySelectorAll('.tab[data-kind="' + CSS.escape(view.kind) + '"]')];
      (tabs.find(tab => texto(tab) === view.label) || tabs[0])?.click();
    }
    setTimeout(() => { restaurando = false; }, 350);
  };
  document.addEventListener('click', event => {
    if (restaurando || !event.isTrusted) return;
    const view = vistaDe(event.target);
    if (!view || view.kind === 'inicio') return;
    setTimeout(() => { if (!restaurando) guardar(view); }, 0);
  }, true);
  addEventListener('popstate', event => {
    if (event.state?.indoorView) abrir(event.state.indoorView);
  });
})();
