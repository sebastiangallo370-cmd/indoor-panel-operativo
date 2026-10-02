// Avisa cuando el servidor tiene una versión nueva de la página y la recarga sola si no estás usándola.
(() => {
  let known = null, banner = null, timer = 0;
  const check = async () => {
    try {
      const response = await fetch('/api/build', {cache: 'no-store'});
      if (!response.ok) return;
      const build = (await response.json()).build;
      if (known === null) { known = build; return; }
      if (build === known) return;
      // Hay versión nueva. Si la pestaña está oculta, se recarga sola; si no, se avisa con un botón.
      if (document.hidden) { location.reload(); return; }
      if (banner) return;
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;z-index:99999;left:50%;transform:translateX(-50%);bottom:calc(92px + env(safe-area-inset-bottom));display:flex;gap:10px;align-items:center;padding:10px 14px;border:1px solid #d0f44c;border-radius:14px;background:#10160f;color:#f0f4eb;font:700 13px Arial;box-shadow:0 14px 40px #000a;max-width:calc(100vw - 24px)';
      banner.innerHTML = '<span>Hay una versión nueva de la página.</span><button type="button" style="padding:7px 12px;border:0;border-radius:9px;background:#d0f44c;color:#15200b;font:800 12px Arial;cursor:pointer">Actualizar ahora</button>';
      banner.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(banner);
    } catch (_) {}
  };
  check();
  timer = setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
