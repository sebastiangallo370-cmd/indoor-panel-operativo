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
  .mp-head select{min-height:44px;padding:0 12px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:inherit;font-size:.95rem}.mp-head button{min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #34432f;background:#172015;color:#d7ff3a;font-weight:800;cursor:pointer}
  .mp{max-width:1400px!important}.mp-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))}.mp-vacio{grid-column:1/-1}
  .mp-card{display:flex;flex-direction:column;gap:10px;padding:18px;border:1px solid #34432f;border-top-width:6px;border-radius:16px;background:linear-gradient(160deg,#121a14,#0c110d);box-shadow:0 8px 22px rgba(0,0,0,.28)}
  .mp-card.ok{border-top-color:#3ddc84}.mp-card.error{border-top-color:#ff5a5a}.mp-card.aviso{border-top-color:#ffb43d}.mp-card.proceso{border-top-color:#7da4ff}
  .mp-top{display:flex;flex-direction:column;gap:8px}.mp-estado{align-self:flex-start;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.07)}
  .mp-orden{font-size:1.5rem;font-weight:900}.mp-estado{font-weight:900;font-size:.82rem;letter-spacing:.04em}
  .ok .mp-estado{color:#3ddc84}.error .mp-estado{color:#ff7b7b}.aviso .mp-estado{color:#ffb43d}.proceso .mp-estado{color:#9db8ff}
  .mp-meta{color:#aebba7;font-size:.86rem}.mp-detalle{color:#d6dccf;font-size:.84rem;word-break:break-word}
  .mp-vacio{padding:30px;text-align:center;color:#aebba7}
  .trace-cards:has(+ .comerciales-panel:not([hidden])){display:none!important}.trace-workspace:has(+ .trace-cards:has(+ .comerciales-panel:not([hidden]))){display:none!important}.comerciales-panel{padding:14px}body.comerciales-mode .production-process-filter{display:none!important}
  @media(max-width:700px){.comerciales-panel{padding:10px 0 110px}.mp-head{padding:14px 16px}.mp-head h2{font-size:1.3rem}.mp-head>div:last-child{width:100%}.mp-head input{flex:1 1 100%;min-width:0;font-size:16px}.mp-head button{flex:1 1 100%}.mp-orden{font-size:1.3rem}}`;
  document.head.appendChild(css);
  let panel, datos = [], comerciales = [], verTodos = false, buscar = '', quien = '';

  function fecha(t) { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); }
  function pintar() {
    const q = buscar.trim().toLowerCase();
    const lista = datos.filter(p => (!quien || String(p.usuario || '').toLowerCase() === quien.toLowerCase()) && (!q || [p.orden, p.cliente, p.archivo].join(' ').toLowerCase().includes(q)));
    panel.querySelector('[data-lista]').innerHTML = lista.length ? lista.map(p => {
      const refs = (p.referencias || []).length ? 'Referencias en producción: ' + esc(p.referencias.join(', ')) : '';
      return `<div class="mp-card ${esc(p.nivel)}"><div class="mp-top"><span class="mp-orden">${esc(p.orden || p.archivo)}</span><span class="mp-estado">${esc(p.estado)}</span></div>
      ${verTodos && p.usuario ? `<div class="mp-meta"><b>Programó:</b> ${esc(p.usuario)}</div>` : ''}<div class="mp-meta">${esc(p.cliente)}${p.entrega ? ' · Entrega ' + esc(p.entrega) : ''} · ${esc(fecha(p.fecha))}</div>
      ${refs ? `<div class="mp-meta">${refs}</div>` : ''}
      ${p.nivel !== 'ok' && p.detalle ? `<div class="mp-detalle">${esc(p.detalle)}</div>` : ''}</div>`;
    }).join('') : '<div class="mp-vacio">No hay pedidos para mostrar. Cuando se programe uno, aparecerá aquí.</div>';
  }
  async function cargar() {
    const caja = panel.querySelector('[data-lista]');
    try {
      const r = await fetch('/api/mis-pedidos', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      const j = await r.json();
      datos = j.pedidos || []; comerciales = j.comerciales || []; verTodos = !!j.ver_todos;
      const sel = panel.querySelector('[data-quien]');
      sel.style.display = verTodos ? '' : 'none';
      sel.innerHTML = '<option value="">Todos los comerciales</option>' + comerciales.map(n => `<option value="${esc(n)}"${n === quien ? ' selected' : ''}>${esc(n)}</option>`).join('');
      pintar();
    } catch (e) { caja.innerHTML = '<div class="mp-vacio">No fue posible consultar los pedidos. Intenta de nuevo.</div>'; }
  }
  function build() {
    const cards = document.querySelector('.trace-cards');
    if (!cards) return false;
    if (panel) return true;
    panel = document.createElement('section'); panel.className = 'comerciales-panel'; panel.hidden = true;
    panel.innerHTML = '<div class="mp"><div class="mp-head"><div><small>PRODUCCIÓN</small><h2>COMERCIALES</h2><p>Lo que van programando los comerciales y si quedó subido.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><select data-quien style="display:none"></select><input data-buscar type="search" placeholder="Buscar orden o cliente"><button type="button" data-act>↻ Actualizar</button></div></div><div data-lista class="mp-grid"><div class="mp-vacio">Cargando…</div></div></div>';
    cards.after(panel);
    panel.querySelector('[data-act]').addEventListener('click', cargar);
    panel.querySelector('[data-quien]').addEventListener('change', e => { quien = e.target.value; pintar(); });
    panel.querySelector('[data-buscar]').addEventListener('input', e => { buscar = e.target.value; pintar(); });
    return true;
  }
  window.indoorComerciales = {
    show() { if (!build()) return; panel.hidden = false; document.body.classList.add('comerciales-mode'); cargar(); },
    hide() { document.body.classList.remove('comerciales-mode'); if (panel) panel.hidden = true; }
  };
  let intentos = 0;
  const t = setInterval(() => { if (build() || ++intentos > 40) clearInterval(t); }, 250);
})();
