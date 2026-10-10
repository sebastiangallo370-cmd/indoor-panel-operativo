// Aviso de cookies: se muestra una vez (en el inicio de sesión y en el panel) hasta que la persona pulsa «Entendido».
// El panel solo usa cookies necesarias para la sesión; no hay cookies de publicidad ni de seguimiento.
(() => {
  if (window.__cookiesAviso) return; window.__cookiesAviso = true;
  const CLAVE = 'indoor_cookies_ok', VERSION = '1';
  const visto = () => {
    try { if (localStorage.getItem(CLAVE) === VERSION) return true; } catch (e) { /* sin almacenamiento: se mira la cookie */ }
    return new RegExp('(?:^|;\\s*)' + CLAVE + '=' + VERSION + '(?:;|$)').test(document.cookie);
  };
  const recordar = () => {
    try { localStorage.setItem(CLAVE, VERSION); } catch (e) { /* se guarda solo en la cookie */ }
    document.cookie = CLAVE + '=' + VERSION + '; Max-Age=31536000; Path=/; SameSite=Lax; Secure';
  };
  if (visto()) return;

  function mostrar() {
    if (document.querySelector('.ck-aviso')) return;
    const css = document.createElement('style');
    css.textContent = `
    .ck-aviso{position:fixed;left:50%;bottom:18px;z-index:100040;transform:translateX(-50%);width:min(720px,calc(100vw - 24px));box-sizing:border-box;padding:14px 16px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(10,14,9,.96);backdrop-filter:blur(8px);color:#e6ede0;font:500 12.5px/1.5 Inter,Arial,sans-serif;box-shadow:0 22px 50px rgba(0,0,0,.55);animation:ck-sube .3s ease-out}
    .ck-fila{display:flex;gap:12px 16px;align-items:center;flex-wrap:wrap}
    .ck-fila p{flex:1 1 300px;margin:0;color:#dfe7d6}.ck-fila p b{color:#d0f44c}
    .ck-acc{display:flex;gap:8px;flex:0 0 auto}
    .ck-aviso button{width:auto!important;min-height:0!important;margin:0!important;padding:9px 16px!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:999px!important;background:transparent!important;box-shadow:none!important;color:#e6ede0!important;font:800 10.5px Arial!important;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;white-space:nowrap}
    .ck-aviso button.pri{background:#d0f44c!important;border-color:#d0f44c!important;color:#111!important}
    .ck-mas{margin:12px 0 0;padding:12px 0 0;border-top:1px solid rgba(255,255,255,.1);color:#b9c4b1;font-size:12px}
    .ck-mas ul{margin:6px 0 0;padding-left:18px}.ck-mas li{margin:3px 0}.ck-mas code{color:#d0f44c;font:700 11.5px Consolas,monospace}
    @keyframes ck-sube{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}
    @media(max-width:760px){.ck-aviso{bottom:calc(92px + env(safe-area-inset-bottom,0px));padding:12px 14px}.ck-acc{flex:1 1 100%}.ck-acc button{flex:1}}
    @media print{.ck-aviso{display:none!important}}
    `;
    document.head.appendChild(css);
    const caja = document.createElement('div');
    caja.className = 'ck-aviso'; caja.setAttribute('role', 'region'); caja.setAttribute('aria-label', 'Aviso de cookies');
    caja.innerHTML = '<div class="ck-fila"><p><b>Aviso de cookies.</b> Este sitio usa únicamente las cookies necesarias para iniciar sesión y mantenerla segura. No usamos cookies de publicidad ni de seguimiento.</p>' +
      '<div class="ck-acc"><button type="button" data-ck-mas aria-expanded="false">Más información</button><button type="button" class="pri" data-ck-ok>Entendido</button></div></div>' +
      '<div class="ck-mas" hidden>Cookies que usa el panel:<ul>' +
      '<li><code>indoor_session</code>: mantiene tu sesión iniciada (dura 12 horas).</li>' +
      '<li><code>indoor_login</code> e <code>indoor_fresh</code>: identifican cada inicio de sesión para mostrar los avisos una sola vez.</li>' +
      '<li><code>indoor_cookies_ok</code>: recuerda que ya viste este aviso.</li></ul>' +
      'Además, el navegador guarda en este equipo tus preferencias de pantalla (tema, pestañas y filtros). Todas viajan cifradas por HTTPS y ninguna se comparte con terceros.</div>';
    caja.addEventListener('click', e => {
      if (e.target.closest('[data-ck-ok]')) { recordar(); caja.remove(); }
      else if (e.target.closest('[data-ck-mas]')) { const m = caja.querySelector('.ck-mas'), b = e.target.closest('[data-ck-mas]'); m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); b.textContent = m.hidden ? 'Más información' : 'Ocultar'; }
    });
    document.body.appendChild(caja);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mostrar); else mostrar();
})();
