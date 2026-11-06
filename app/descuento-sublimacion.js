/* Interruptor de Inventarios: enciende o apaga el descuento automático de rollos cuando Sublimación termina.
   Apagado = el panel muestra exactamente lo que dice el Google Sheets. */
(function () {
  'use strict';
  if (window.__descuentoSub) return;
  window.__descuentoSub = true;
  const css = `.dsub{display:inline-flex;align-items:center;gap:9px;margin:0;padding:5px 12px 5px 8px;min-height:34px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#cfe0c8;font:800 11px/1.1 Arial;letter-spacing:.04em;cursor:pointer;white-space:nowrap}
  .dsub:disabled{opacity:.6;cursor:wait}
  .dsub .dsub-pista{position:relative;flex:none;width:38px;height:22px;border-radius:999px;background:#3a4540;transition:background .2s ease}
  .dsub .dsub-bola{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#cfd8cb;box-shadow:0 1px 4px rgba(0,0,0,.5);transition:transform .2s ease,background .2s ease}
  .dsub.on{border-color:#d0f44c;color:#d0f44c}
  .dsub.on .dsub-pista{background:#d0f44c}
  .dsub.on .dsub-bola{transform:translateX(16px);background:#10200f}
  .dsub small{font:800 9.5px Arial;letter-spacing:.08em;opacity:.85}`;
  const estilo = document.createElement('style'); estilo.textContent = css; document.head.appendChild(estilo);
  let activo = false;
  const pintar = b => {
    b.classList.toggle('on', activo);
    b.setAttribute('aria-checked', activo ? 'true' : 'false');
    b.innerHTML = '<span class="dsub-pista"><i class="dsub-bola"></i></span><span>DESCUENTO AUTOMÁTICO · SUBLIMACIÓN <small>' + (activo ? 'ENCENDIDO' : 'APAGADO') + '</small></span>';
  };
  async function cargar(b) {
    try { const r = await fetch('/api/inventarios/descuento-sublimacion', { credentials: 'same-origin', cache: 'no-store' }); if (r.ok) { activo = !!(await r.json()).activo; pintar(b); } } catch (_) { /* sin red */ }
  }
  function poner() {
    const caja = document.querySelector('.inventory-movement-actions');
    if (!caja || caja.querySelector('.dsub')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dsub'; b.setAttribute('role', 'switch');
    b.title = 'Apagado: el panel y Effi quedan idénticos al Google Sheets. Encendido: el panel descuenta solo los rollos cuando Sublimación termina (el Sheet no cambia).';
    pintar(b);
    b.addEventListener('click', async () => {
      const nuevo = !activo;
      b.disabled = true;
      try {
        const r = await fetch('/api/inventarios/descuento-sublimacion', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: nuevo }) });
        if (r.ok) activo = !!(await r.json()).activo;
      } catch (_) { /* se queda como estaba */ }
      b.disabled = false; pintar(b);
    });
    caja.appendChild(b);
    cargar(b);
  }
  setInterval(poner, 1500);
  poner();
})();
