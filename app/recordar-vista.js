(() => {
  // Al recargar (F5) el panel vuelve a la página en la que estabas, en vez de irse a Inicio.
  // Guarda la última pestaña del menú que se abrió; al cargar espera a que exista (los módulos crean sus pestañas poco a poco) y la abre,
  // salvo que ya hayas tocado otra cosa. La sesión se cierra solo tras 2 horas de inactividad (session-guard.js).
  if (window.__recordarVista) return;
  window.__recordarVista = true;
  const CLAVE = 'indoor-ultima-vista';
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; } };
  const guardar = v => { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  let usuarioToco = false, restaurando = false;

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
    return lista.find(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) === c.rotulo) || (lista.length === 1 ? lista[0] : null);
  };

  document.addEventListener('click', e => {
    if (restaurando || !e.isTrusted) return;   // al restaurar (y los clics por programa de otros módulos) no se cambia lo guardado: ya es esta misma vista
    const c = clave(e.target);
    if (!c) return;
    if (e.isTrusted) usuarioToco = true;
    if (c.val === 'inicio') guardar(null); else guardar({ ...c, t: Date.now() });
  }, true);
  ['mousedown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => { usuarioToco = true; }, { passive: true, once: true, capture: true }));

  const guardada = leer();
  if (!guardada || !guardada.attr) return;
  let intentos = 0;
  const espera = setInterval(() => {
    if (usuarioToco || ++intentos > 70) { clearInterval(espera); return; }   // ~20 s como máximo
    const el = buscar(guardada);
    if (!el || !document.querySelector('.tab[data-kind="inicio"]')) return;   // el menú aún se está armando
    clearInterval(espera);
    const grupo = el.closest('.nav-group');
    if (grupo) grupo.classList.remove('collapsed');
    restaurando = true;
    setTimeout(() => { if (!usuarioToco) el.click(); restaurando = false; }, 250);
  }, 300);
})();
