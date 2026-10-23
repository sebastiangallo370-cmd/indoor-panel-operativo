/* Aviso en la esquina de arriba a la derecha cuando un agente de inventario empieza a trabajar de verdad (crear o enviar una orden de compra, ajustar Effi):
   «MINIMAXIMAN HA EMPEZADO A TRABAJAR». Solo lo ven las cuentas con acceso a esos agentes (si el servidor no las deja consultar, el módulo se apaga solo). */
(function () {
  'use strict';
  if (window.__avisoAgentes) return;
  window.__avisoAgentes = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROBOT = '<svg viewBox="0 0 64 64" aria-hidden="true"><line x1="32" y1="6" x2="32" y2="14" stroke="#d0f44c" stroke-width="3" stroke-linecap="round"/><circle class="ant" cx="32" cy="5" r="3.5" fill="#d0f44c"/><rect x="12" y="14" width="40" height="30" rx="10" fill="#1a2a20" stroke="#d0f44c" stroke-width="2.5"/><circle class="ojo" cx="24" cy="29" r="4.5" fill="#d0f44c"/><circle class="ojo" cx="40" cy="29" r="4.5" fill="#d0f44c"/><rect x="25" y="37" width="14" height="3" rx="1.5" fill="#d0f44c" opacity=".7"/><rect x="18" y="47" width="28" height="11" rx="5" fill="#1a2a20" stroke="#d0f44c" stroke-width="2"/><rect class="br" x="4" y="22" width="6" height="14" rx="3" fill="#d0f44c"/><rect class="br2" x="54" y="22" width="6" height="14" rx="3" fill="#d0f44c"/></svg>';
  const css = `
  #aviso-agentes{position:fixed;top:100px;right:20px;z-index:9999;display:grid;gap:8px;width:min(340px,calc(100vw - 32px));pointer-events:none}
  .aa-t{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:8px 10px 9px 9px;border-radius:14px;cursor:pointer;color:#f1f7ed;font-family:Arial,sans-serif;
    background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(24,38,28,.92),rgba(12,20,15,.92));
    -webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);border:1px solid rgba(208,244,76,.55);
    box-shadow:inset 0 1.5px 0 rgba(255,255,255,.3),0 0 0 1px rgba(208,244,76,.3),0 0 26px -6px rgba(208,244,76,.55),0 18px 36px -14px #000;animation:aaEntra .4s cubic-bezier(.2,.9,.3,1.2)}
  .aa-t.listo{border-color:rgba(53,212,106,.65);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.3),0 0 0 1px rgba(53,212,106,.35),0 0 24px -6px rgba(53,212,106,.5),0 18px 36px -14px #000}
  .aa-t.error{border-color:rgba(255,107,97,.75);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.3),0 0 0 1px rgba(255,107,97,.4),0 0 24px -6px rgba(255,107,97,.5),0 18px 36px -14px #000}
  .aa-t.sale{animation:aaSale .35s ease-in forwards}
  @keyframes aaEntra{from{opacity:0;transform:translateX(40px) scale(.96)}}@keyframes aaSale{to{opacity:0;transform:translateX(40px)}}
  .aa-rob{flex:none;width:34px;height:34px;animation:aaSalta 1.1s ease-in-out infinite}.aa-t.listo .aa-rob,.aa-t.error .aa-rob{animation:none}
  .aa-rob svg{width:34px;height:34px;filter:drop-shadow(0 0 7px rgba(208,244,76,.55))}
  .aa-rob .ant{animation:aaLate 1s ease-in-out infinite}.aa-rob .ojo{transform-origin:center;transform-box:fill-box;animation:aaParpadea 2.6s infinite}
  .aa-rob .br{transform-origin:right center;transform-box:fill-box;animation:aaBrazo .55s ease-in-out infinite alternate}.aa-rob .br2{transform-origin:left center;transform-box:fill-box;animation:aaBrazo .55s ease-in-out infinite alternate-reverse}
  @keyframes aaSalta{50%{transform:translateY(-4px)}}@keyframes aaLate{50%{opacity:.3}}@keyframes aaParpadea{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}@keyframes aaBrazo{to{transform:rotate(-18deg)}}
  .aa-txt{display:grid;gap:2px;min-width:0;flex:1}.aa-txt b{font:900 10.5px/1.25 Arial;letter-spacing:.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d0f44c}.aa-t.listo .aa-txt b{color:#6fe39a}.aa-t.error .aa-txt b{color:#ffb3ac}
  .aa-txt span{font:600 10.5px/1.35 Arial;color:#dfe8da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.aa-txt u{text-decoration:none;font-weight:800;color:#fff}
  .aa-x{flex:none;align-self:flex-start;border:0;background:transparent;color:#9fb096;font:700 13px/1 Arial;cursor:pointer;padding:2px 4px}.aa-x:hover{color:#fff}
  .aa-barra{position:absolute;left:12px;right:12px;bottom:0;height:2px;overflow:hidden;border-radius:2px}.aa-barra i{display:block;height:100%;width:35%;background:linear-gradient(90deg,transparent,#d0f44c,transparent);animation:aaBarra 1.4s linear infinite}
  .aa-t{position:relative}@keyframes aaBarra{from{transform:translateX(-100%)}to{transform:translateX(300%)}}
  @media(prefers-reduced-motion:reduce){.aa-t,.aa-rob,.aa-rob *,.aa-barra i{animation:none!important}}
  @media(max-width:700px){#aviso-agentes{top:70px;right:12px}}
  `;
  const estilo = document.createElement('style'); estilo.textContent = css; document.head.appendChild(estilo);
  const caja = document.createElement('div'); caja.id = 'aviso-agentes'; document.body.appendChild(caja);
  const pantalla = { MINIMAXIMAN: 'minimaximan', STOCKMAN: 'stockman' };
  const toasts = new Map();   // agente|id -> {el, fase}
  let parado = false;

  // Si la pestaña del panel no es la que estás mirando, también sale la notificación del navegador (se pide permiso una sola vez, con tu primer clic).
  const permisoNotif = () => 'Notification' in window ? Notification.permission : 'denied';
  document.addEventListener('click', () => { if (permisoNotif() === 'default') { try { Notification.requestPermission(); } catch (_) { /* el navegador no lo permite */ } } }, { once: true });
  function notificarNavegador(clave, a) {
    if (!document.hidden || permisoNotif() !== 'granted') return;
    try {
      const n = new Notification(titulo(a), { body: (a.tela ? a.tela + ' · ' : '') + (a.detalle || ''), tag: clave + '|' + a.fase, icon: '/favicon.svg', requireInteraction: false });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 9000);
    } catch (_) { /* sin notificaciones */ }
  }
  function titulo(a) {
    if (a.activo) return a.agente + ' EMPEZÓ A TRABAJAR';
    return a.fase === 'error' ? a.agente + ' NO PUDO COMPLETARLO' : a.agente + ' TERMINÓ';
  }
  function dibujar(t, a) {
    t.el.className = 'aa-t ' + (a.activo ? 'activo' : a.fase === 'error' ? 'error' : 'listo');
    t.el.innerHTML = '<div class="aa-rob">' + ROBOT + '</div><div class="aa-txt"><b>' + esc(titulo(a)) + '</b><span title="' + esc((a.tela ? a.tela + ' · ' : '') + (a.detalle || '')) + '">' + esc(a.corto || ((a.tela ? a.tela + ' · ' : '') + (a.detalle || ''))) + '</span></div><button type="button" class="aa-x" aria-label="Cerrar">✕</button>' + (a.activo ? '<div class="aa-barra"><i></i></div>' : '');
    t.fase = a.fase;
  }
  function quitar(clave, ms) {
    const t = toasts.get(clave); if (!t || t.saliendo) return;
    t.saliendo = true;
    setTimeout(() => { t.el.classList.add('sale'); setTimeout(() => { t.el.remove(); }, 380); }, ms);
  }
  function aplicar(lista) {
    const vivos = new Set();
    lista.forEach(a => {
      const clave = a.agente + '|' + a.id; vivos.add(clave);
      let t = toasts.get(clave);
      if (!t) {
        t = { el: document.createElement('div'), fase: '' };
        t.el.addEventListener('click', e => {
          if (e.target.closest('.aa-x')) { quitar(clave, 0); return; }
          const tab = document.querySelector('.tab[data-kind="' + (pantalla[a.agente] || '') + '"]'); if (tab) tab.click();
        });
        toasts.set(clave, t); caja.appendChild(t.el);
      }
      if (t.fase !== a.fase) { dibujar(t, a); t.saliendo = false; if (!a.activo) quitar(clave, 6500); notificarNavegador(clave, a); }
    });
    toasts.forEach((t, clave) => { if (!vivos.has(clave) && !t.saliendo) quitar(clave, t.fase === 'listo' || t.fase === 'error' ? 0 : 2500); });
  }
  async function sondear() {
    if (parado) return;
    {
      try {
        const r = await fetch('/api/minimaximan/actividad', { cache: 'no-store', credentials: 'same-origin' });
        if (r.status === 401 || r.status === 403 || r.status === 404) { parado = true; return; }   // esta cuenta no ve a los agentes: no se vuelve a consultar
        if (r.ok) aplicar((await r.json()).agentes || []);
      } catch (_) { /* sin red: se reintenta */ }
    }
    setTimeout(sondear, 2500);
  }
  sondear();
})();
