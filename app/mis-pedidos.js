(() => {
  // MIS PEDIDOS: los comerciales ven si cada orden quedó subida (en Producción) o por qué no.
  if (window.__misPedidosListo) return;
  window.__misPedidosListo = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
  .mp{display:grid;gap:16px;width:100%;max-width:1100px;margin:0 auto}
  .mp-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:20px 22px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(135deg,#101a16,#0c110d)}
  .mp-head small{color:#d7ff3a;letter-spacing:.14em;font-weight:800;font-size:.68rem}.mp-head h2{margin:4px 0;font-size:1.6rem}.mp-head p{margin:0;color:#aebba7;font-size:.88rem}
  .mp-head input{min-height:44px;min-width:240px;padding:0 14px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:inherit;font-size:.95rem}
  .mp-head button{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #34432f;background:#172015;color:#d7ff3a;font-weight:800;cursor:pointer}
  .mp{max-width:1400px!important}.mp-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.mp-vacio{grid-column:1/-1}
  .mp-card{display:flex;flex-direction:column;gap:10px;padding:18px;border:1px solid #34432f;border-top-width:6px;border-radius:16px;background:linear-gradient(160deg,#121a14,#0c110d);box-shadow:0 8px 22px rgba(0,0,0,.28)}
  .mp-card.ok{border-top-color:#3ddc84}.mp-card.error{border-top-color:#ff5a5a}.mp-card.aviso{border-top-color:#ffb43d}.mp-card.proceso{border-top-color:#7da4ff}
  .mp-top{display:flex;flex-direction:column;gap:8px}.mp-estado{align-self:flex-start;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.07)}
  .mp-orden{font-size:1.5rem;font-weight:900}.mp-estado{font-weight:900;font-size:.82rem;letter-spacing:.04em}
  .ok .mp-estado{color:#3ddc84}.error .mp-estado{color:#ff7b7b}.aviso .mp-estado{color:#ffb43d}.proceso .mp-estado{color:#9db8ff}
  .mp-meta{color:#aebba7;font-size:.86rem}.mp-detalle{color:#d6dccf;font-size:.84rem;word-break:break-word}
  .mp-vacio{padding:30px;text-align:center;color:#aebba7}`;
  document.head.appendChild(css);
  let panel, tab, datos = [], buscar = '';

  function fecha(t) { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); }
  function pintar() {
    const q = buscar.trim().toLowerCase();
    const lista = datos.filter(p => !q || [p.orden, p.cliente, p.archivo].join(' ').toLowerCase().includes(q));
    panel.querySelector('[data-lista]').innerHTML = lista.length ? lista.map(p => {
      const refs = (p.referencias || []).length ? 'Referencias en producción: ' + esc(p.referencias.join(', ')) : '';
      return `<div class="mp-card ${esc(p.nivel)}"><div class="mp-top"><span class="mp-orden">${esc(p.orden || p.archivo)}</span><span class="mp-estado">${esc(p.estado)}</span></div>
      <div class="mp-meta">${esc(p.cliente)}${p.entrega ? ' · Entrega ' + esc(p.entrega) : ''} · ${esc(fecha(p.fecha))}</div>
      ${refs ? `<div class="mp-meta">${refs}</div>` : ''}
      ${p.nivel !== 'ok' && p.detalle ? `<div class="mp-detalle">${esc(p.detalle)}</div>` : ''}</div>`;
    }).join('') : '<div class="mp-vacio">No hay pedidos para mostrar.</div>';
  }
  async function cargar() {
    const caja = panel.querySelector('[data-lista]');
    try {
      const r = await fetch('/api/mis-pedidos', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      datos = (await r.json()).pedidos || [];
      pintar();
    } catch (e) { caja.innerHTML = '<div class="mp-vacio">No fue posible consultar los pedidos. Intenta de nuevo.</div>'; }
  }
  function build() {
    const base = document.querySelector('nav.tabs .tab[data-kind="pedido"]');
    const main = document.querySelector('main');
    if (!base || !main) return false;
    if (document.querySelector('.tab[data-kind="mispedidos"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'mispedidos';
    panel.innerHTML = '<div class="mp"><div class="mp-head"><div><small>ASISTENTES COMERCIALES</small><h2>MIS PEDIDOS</h2><p>Revisa si tu orden quedó subida en el sistema.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><input data-buscar type="search" placeholder="Buscar orden o cliente"><button type="button" data-act>↻ Actualizar</button></div></div><div data-lista class="mp-grid"><div class="mp-vacio">Cargando…</div></div></div>';
    main.appendChild(panel);
    tab = document.createElement('button'); tab.className = 'tab'; tab.dataset.kind = 'mispedidos'; tab.type = 'button';
    tab.innerHTML = '<span class="nav-icon">MP</span><strong>MIS PEDIDOS</strong>';
    base.insertAdjacentElement('afterend', tab);
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar();
    });
    panel.querySelector('[data-act]').addEventListener('click', cargar);
    panel.querySelector('[data-buscar]').addEventListener('input', e => { buscar = e.target.value; pintar(); });
    return true;
  }
  let intentos = 0;
  const t = setInterval(() => { if (build() || ++intentos > 40) clearInterval(t); }, 250);
})();
