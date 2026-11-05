(() => {
  // Al recargar (F5) el panel vuelve a la página en la que estabas, en vez de irse a Inicio.
  // Guarda la última pestaña del menú que se abrió; al cargar espera a que exista (los módulos crean sus pestañas poco a poco) y la abre,
  // salvo que ya hayas tocado otra cosa. La sesión se cierra solo tras 2 horas de inactividad (session-guard.js).
  if (window.__recordarVista) return;
  window.__recordarVista = true;
  const CLAVE = 'indoor-ultima-vista';
  const desdeRuta = () => {
    const ruta = decodeURIComponent(location.hash.replace(/^#/, '')).toLowerCase();
    if (!ruta) return null;
    if (ruta === 'bodega' || ruta.startsWith('bodega/')) return {attr: 'data-bodega-dashboard', val: 'true', rotulo: 'PANEL DE CONTROL'};
    return {attr: 'data-kind', val: ruta, rotulo: ruta.toUpperCase()};
  };
  const leer = () => desdeRuta() || (() => { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; } })();
  const rutaDe = v => !v ? '' : (v.attr === 'data-bodega-dashboard' ? 'bodega/' + (() => { try { return localStorage.getItem('indoor-bodega-subtab') || 'resumen'; } catch (_) { return 'resumen'; } })() : String(v.val || ''));
  const guardar = v => {
    try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
    try { history.replaceState(history.state, '', location.pathname + location.search + (rutaDe(v) ? '#' + encodeURIComponent(rutaDe(v)) : '')); } catch (e) { /* History API no disponible */ }
  };
  let usuarioToco = false, restaurando = false;
  // Mientras se recupera una ruta al cargar, no se debe reemplazar por la
  // pantalla inicial que aparece por unos milisegundos.
  let esperandoRestauracion = Boolean(desdeRuta());

  // identifica una pestaña por su data-kind (o por el atributo propio de las pantallas de Inventarios)
  function clave(el) {
    const t = el.closest('.tab[data-kind],[data-bodega-dashboard]');
    if (!t) return null;
    const rotulo = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);   // hay varias pestañas con el mismo data-kind (los procesos de Producción)
    if (t.dataset.kind) return { attr: 'data-kind', val: t.dataset.kind, rotulo };
    if (t.hasAttribute('data-bodega-dashboard')) return { attr: 'data-bodega-dashboard', val: t.getAttribute('data-bodega-dashboard'), rotulo };
    return null;
  }
  const buscar = c => {
    if (!c) return null;
    const lista = [...document.querySelectorAll('[' + c.attr + (c.val ? '="' + String(c.val).replace(/"/g, '') + '"' : '') + ']')];
    // data-kind es el identificador único de cada pantalla. El rótulo puede
    // cambiar («C.LABORAL») y no debe decidir a qué pantalla se regresa.
    return lista[0] || null;
  };

  document.addEventListener('click', e => {
    if (restaurando || !e.isTrusted) return;   // al restaurar (y los clics por programa de otros módulos) no se cambia lo guardado: ya es esta misma vista
    const destino = e.target.closest?.('.tab,[data-bodega-dashboard]');
    if (!destino) return;
    const c = clave(e.target);
    usuarioToco = true;
    esperandoRestauracion = false;
    // El cambio de panel lo hacen otros manejadores de click. Guardamos al
    // final del evento para leer la pestaña que realmente quedó abierta y no
    // la anterior (algunos accesos son botones que llaman otra pestaña).
    setTimeout(() => {
      const activa = document.querySelector('.panel.active')?.dataset?.panel;
      if (c?.attr === 'data-bodega-dashboard') guardar({ ...c, t: Date.now() });
      else if (activa === 'inicio') guardar(null);
      else if (activa) guardar({ attr: 'data-kind', val: activa, rotulo: activa.toUpperCase(), t: Date.now() });
      else if (c) guardar({ ...c, t: Date.now() });
    }, 0);
  }, true);
  ['mousedown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { usuarioToco = true; }, { passive: true, once: true, capture: true }));

  // Red de seguridad: varios módulos abren pestañas mediante código, sin un
  // clic directo sobre el menú. Al cambiar el panel visible, la URL se
  // sincroniza también en esos casos.
  let ultimaVistaSincronizada = '';
  let sincronizacionPendiente = false;
  const sincronizarVistaActiva = () => {
    sincronizacionPendiente = false;
    if (restaurando || esperandoRestauracion) return;
    const activa = document.querySelector('.panel.active')?.dataset?.panel;
    if (!activa) return;
    // Bodega tiene submódulos propios: su ruta detallada la controla el
    // tablero de bodega y no se reemplaza por la ruta genérica Inventarios.
    if (activa === 'inventario' && /^#bodega(?:\/|$)/i.test(location.hash)) return;
    const rutaActual = location.hash.replace(/^#/, '').toLowerCase();
    if (ultimaVistaSincronizada === activa && rutaActual === activa) return;
    ultimaVistaSincronizada = activa;
    guardar(activa === 'inicio' ? null : { attr: 'data-kind', val: activa, rotulo: activa.toUpperCase(), t: Date.now() });
  };
  const vigilarPestana = new MutationObserver(() => {
    if (sincronizacionPendiente) return;
    sincronizacionPendiente = true;
    setTimeout(sincronizarVistaActiva, 0);
  });
  vigilarPestana.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  // Refuerzo final: no importa cómo cambie la vista (clic, atajo o módulo),
  // la barra de dirección se corrige de inmediato contra el panel visible.
  setInterval(sincronizarVistaActiva, 250);

  const guardada = leer();
  if (guardada?.attr) {
    let intentos = 0;
    const espera = setInterval(() => {
      if (usuarioToco || ++intentos > 70) { clearInterval(espera); return; }   // ~20 s como máximo
      const el = buscar(guardada);
      if (!el || !document.querySelector('.tab[data-kind="inicio"]')) return;   // el menú aún se está armando
      clearInterval(espera);
      const grupo = el.closest('.nav-group');
      if (grupo) grupo.classList.remove('collapsed');
      restaurando = true;
      const abrir = () => { if (!usuarioToco) buscar(guardada)?.click(); };
      // Algunas pantallas se crean después del menú. Se reaplica al finalizar
      // esa carga para que ninguna inicialización posterior cambie la vista.
      setTimeout(abrir, 250);
      setTimeout(abrir, 1500);
      setTimeout(abrir, 3500);
      setTimeout(abrir, 6000);
      setTimeout(() => { abrir(); restaurando = false; esperandoRestauracion = false; sincronizarVistaActiva(); }, 8500);
    }, 300);
  }
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
