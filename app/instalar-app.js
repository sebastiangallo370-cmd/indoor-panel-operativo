/* Instalar el panel como aplicación (Windows y Mac, Chrome/Edge; Safari en Mac con «Agregar al Dock»).
   Todo sigue corriendo en el VPS: la app solo abre produccion.cloud en su propia ventana, con icono en el escritorio/Dock. */
(function () {
  'use strict';
  if (window.__instalarApp) return; window.__instalarApp = true;
  const yaInstalada = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); }); }
  const CLAVE = 'instalarAppOculto';
  const oculto = () => { try { return localStorage.getItem(CLAVE) === '1'; } catch (e) { return false; } };
  const css = document.createElement('style');
  css.textContent = `
  .ia-boton{all:unset;box-sizing:border-box;position:fixed!important;left:12px!important;bottom:12px!important;top:auto!important;right:auto!important;z-index:99990!important;width:34px!important;height:34px!important;min-width:0!important;max-width:34px!important;padding:0!important;margin:0!important;display:grid!important;place-items:center;border-radius:50%;border:1px solid #b9e03a;
    background:linear-gradient(180deg,#e6ff6b,#9fcd12);color:#16240a;box-shadow:0 2px 0 #6f9410,0 6px 14px rgba(0,0,0,.45);cursor:pointer;opacity:.85;transition:opacity .15s,transform .15s}
  .ia-boton:hover{opacity:1;transform:translateY(-1px)}.ia-boton svg{width:16px;height:16px;pointer-events:none}
  .ia-x{position:absolute;top:-6px;right:-6px;width:15px;height:15px;border-radius:50%;background:#0d140e;color:#d0f44c;border:1px solid #3d4c3b;font:900 9px/13px Arial;text-align:center;cursor:pointer}
  .ia-ayuda{position:fixed;left:14px;bottom:62px;z-index:99990;max-width:300px;padding:12px 14px;border-radius:12px;background:#0d140e;border:1px solid rgba(208,244,76,.5);color:#e8f0e0;font:600 12px/1.5 Arial;box-shadow:0 10px 26px rgba(0,0,0,.5)}
  @media(max-width:700px){.ia-boton{display:none}}`;
  document.head.appendChild(css);
  let aviso = null, boton = null;
  function quitar() { if (boton) boton.remove(); boton = null; const a = document.querySelector('.ia-ayuda'); if (a) a.remove(); }
  function mostrar(alPulsar) {
    if (boton || yaInstalada() || oculto()) return;
    boton = document.createElement('button'); boton.type = 'button'; boton.className = 'ia-boton'; boton.title = 'Instalar la app de Indoor en este computador';
    boton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg><span class="ia-x" title="No mostrar más">✕</span>';
    boton.onclick = e => { if (e.target.classList.contains('ia-x')) { try { localStorage.setItem(CLAVE, '1'); } catch (er) { /* nada */ } quitar(); return; } alPulsar(); };
    document.body.appendChild(boton);
  }
  window.addEventListener('beforeinstallprompt', e => {   // Chrome y Edge (Windows y Mac)
    e.preventDefault(); aviso = e;
    mostrar(async () => { if (!aviso) return; aviso.prompt(); try { await aviso.userChoice; } catch (er) { /* nada */ } aviso = null; quitar(); });
  });
  window.addEventListener('appinstalled', quitar);
  // Safari en Mac no tiene el aviso automático: se explica cómo agregarlo al Dock
  const esSafariMac = /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
  if (esSafariMac) setTimeout(() => mostrar(() => {
    const a = document.querySelector('.ia-ayuda'); if (a) { a.remove(); return; }
    const d = document.createElement('div'); d.className = 'ia-ayuda';
    d.innerHTML = '<b>Instalar en Mac (Safari)</b><br>Menú <b>Archivo → Agregar al Dock…</b> y pulsa <b>Agregar</b>. Quedará el icono de Indoor en el Dock y se abrirá en su propia ventana.';
    document.body.appendChild(d);
  }), 2500);
})();
