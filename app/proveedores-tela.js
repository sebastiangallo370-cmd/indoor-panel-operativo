(() => {
  // PROVEEDORES DE TELA (pestaña de Estándar 2026): por cada código de tela de Bodega se elige el proveedor.
  // El agente de inventario lo usa al crear la orden de compra en Effi (Effi no rellena el proveedor al elegir la tela).
  if (window.__proveedoresTelaListo) return;
  window.__proveedoresTelaListo = true;
  const st = { datos: null, buscar: '', solo: 'todas', cargando: false, msg: {} };
  let host = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function api(url, options) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No fue posible completar la acción');
    return d;
  }

  const css = document.createElement('style');
  css.textContent = `
  .pv{display:grid;gap:16px;width:100%;max-width:none;margin:0}
  .pv *{box-sizing:border-box}
  .pv-glass{border:1px solid rgba(255,255,255,.22);border-radius:18px;background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.04));-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),inset 0 -1px 0 rgba(255,255,255,.1),0 12px 30px rgba(0,0,0,.35)}
  .pv-head{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;padding:20px 24px}
  .pv-head small{display:block;color:#c9d3c4;letter-spacing:.2em;font-weight:800;font-size:.62rem}.pv-head h2{margin:4px 0 2px;font-size:1.45rem;letter-spacing:.02em}.pv-head p{margin:0;color:#b6c2b0;font-size:.84rem;max-width:560px}
  .pv-kpis{display:flex;gap:10px;flex-wrap:wrap}
  .pv-kpi{min-width:104px;padding:10px 16px;border-radius:14px;text-align:center}
  .pv-kpi b{display:block;font-size:1.5rem;line-height:1.1}.pv-kpi span{font-size:.58rem;letter-spacing:.14em;font-weight:800;color:#c9d3c4}
  .pv-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px}
  .pv input{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font-size:.92rem;width:100%;outline:none;transition:border-color .2s,box-shadow .2s}
  .pv input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(255,255,255,.1)}
  .pv-bar input[type=search]{flex:1;min-width:220px;width:auto}
  .pv-fil{min-height:40px;padding:0 16px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.06);color:#d3dccf;font-weight:800;font-size:.7rem;letter-spacing:.08em;cursor:pointer;width:auto!important;transition:background .2s}
  .pv-fil:hover{background:rgba(255,255,255,.14)}.pv-fil.on{background:rgba(255,255,255,.92);color:#10140a;border-color:#fff}
  .pv-cols,.pv-fila{display:grid;grid-template-columns:70px minmax(170px,1.3fr) minmax(210px,1.5fr) minmax(130px,.6fr) 118px;gap:14px;align-items:center}
  .pv-cols{padding:0 20px;font-size:.58rem;letter-spacing:.16em;font-weight:800;color:#aab6a5}
  .pv-lista{display:grid;gap:10px}
  .pv-fila{padding:12px 20px;border-radius:16px;position:relative}
  .pv-fila::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:#8bd450}
  .pv-fila.sin::before{background:#e0a437}
  .pv-cod{font-size:1.2rem;font-weight:800;letter-spacing:.02em}
  .pv-nom b{display:block;font-size:.92rem;line-height:1.25}.pv-nom span{font-size:.7rem;color:#aab6a5}
  .pv-btn{min-height:42px;padding:0 16px;border:1px solid rgba(255,255,255,.3);border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font-weight:800;font-size:.72rem;cursor:pointer;letter-spacing:.1em;width:100%!important;transition:background .2s,transform .2s}
  .pv-btn:hover{background:rgba(255,255,255,.22);transform:translateY(-1px)}.pv-btn:disabled{opacity:.5;cursor:default}
  .pv-msg{position:absolute;right:22px;bottom:2px;font-size:.62rem;font-weight:700;color:#b6c2b0}.pv-msg.ok{color:#9be05a}.pv-msg.err{color:#ff9a9d}
  .pv-vacio{padding:30px;text-align:center;color:#b6c2b0;border-radius:16px}
  @media(max-width:900px){.pv-cols{display:none}.pv-fila{grid-template-columns:58px 1fr;gap:10px;padding:14px 16px 18px}.pv-fila>.pv-nom{grid-column:2}.pv-fila>input,.pv-fila>.pv-btn{grid-column:1/-1}.pv-msg{left:16px;right:auto}}
  @media(max-width:700px){.pv-head{padding:16px}.pv-head h2{font-size:1.2rem}.pv-kpis{width:100%}.pv-kpi{flex:1;min-width:0;padding:8px}.pv-bar input[type=search]{min-width:0;width:100%;flex-basis:100%}.pv input{font-size:16px}}
  `;
  document.head.appendChild(css);

  function pintar() {
    if (!host) return;
    const d = st.datos;
    if (!d) { host.innerHTML = '<div class="pv-vacio">Cargando telas…</div>'; return; }
    const q = plano(st.buscar);
    const lista = d.telas.filter(t => (st.solo === 'todas' || (st.solo === 'sin' ? !t.proveedor : !!t.proveedor)) && (!q || plano(t.codigo + ' ' + t.nombre + ' ' + t.proveedor).includes(q)));
    const sin = d.telas.filter(t => !t.proveedor).length;
    const filtro = (k, txt) => '<button type="button" class="pv-fil' + (st.solo === k ? ' on' : '') + '" data-pv-fil="' + k + '">' + txt + '</button>';
    host.innerHTML = '<div class="pv-head pv-glass"><div><small>COMPRAS</small><h2>PROVEEDORES DE TELA</h2><p>Elige el proveedor de cada código de tela. El agente de inventario lo usa para crear la orden de compra en Effi.</p></div>' +
      '<div class="pv-kpis"><div class="pv-kpi pv-glass"><b>' + d.telas.length + '</b><span>TELAS</span></div><div class="pv-kpi pv-glass"><b>' + (d.telas.length - sin) + '</b><span>CON PROVEEDOR</span></div><div class="pv-kpi pv-glass"><b>' + sin + '</b><span>SIN PROVEEDOR</span></div></div></div>' +
      '<div class="pv-bar pv-glass"><input type="search" data-pv-buscar placeholder="Buscar código, tela o proveedor" value="' + esc(st.buscar) + '">' +
      filtro('todas', 'TODAS') + filtro('sin', 'SIN PROVEEDOR') + filtro('con', 'CON PROVEEDOR') + '</div>' +
      '<datalist id="pv-proveedores">' + d.proveedores.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
      '<div class="pv-cols"><span>CÓDIGO</span><span>TELA</span><span>PROVEEDOR</span><span>NIT</span><span></span></div>' +
      '<div class="pv-lista">' + (lista.length ? lista.map(t => {
        const m = st.msg[t.codigo];
        return '<div class="pv-fila pv-glass' + (t.proveedor ? '' : ' sin') + '" data-cod="' + esc(t.codigo) + '"><div class="pv-cod">' + esc(t.codigo) + '</div>' +
          '<div class="pv-nom"><b>' + esc(t.nombre) + '</b><span>' + t.rollos + ' rollo' + (t.rollos === 1 ? '' : 's') + ' en Bodega</span></div>' +
          '<input type="text" list="pv-proveedores" data-pv-prov placeholder="Proveedor (como está en Effi)" value="' + esc(t.proveedor) + '">' +
          '<input type="text" inputmode="numeric" data-pv-nit placeholder="NIT (opcional)" value="' + esc(t.nit) + '">' +
          '<button type="button" class="pv-btn" data-pv-guardar>GUARDAR</button>' +
          '<div class="pv-msg' + (m ? (m.ok ? ' ok' : ' err') : '') + '">' + esc(m ? m.texto : '') + '</div></div>';
      }).join('') : '<div class="pv-vacio pv-glass">No hay telas con ese filtro.</div>') + '</div>';
  }

  async function cargar() {
    if (st.cargando) return;
    st.cargando = true;
    try { st.datos = await api('/api/proveedores-tela'); }
    catch (e) { host.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; st.cargando = false; return; }
    st.cargando = false;
    pintar();
  }

  async function guardar(fila) {
    const cod = fila.dataset.cod;
    const prov = fila.querySelector('[data-pv-prov]').value.trim(), nit = fila.querySelector('[data-pv-nit]').value.trim();
    const boton = fila.querySelector('[data-pv-guardar]'); boton.disabled = true;
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify({ codigo: cod, proveedor: prov, nit }) });
      const t = st.datos.telas.find(x => x.codigo === cod); if (t) { t.proveedor = prov; t.nit = nit; }
      st.datos.proveedores = [...new Set(st.datos.telas.map(x => x.proveedor).filter(Boolean))].sort();
      st.msg[cod] = { ok: true, texto: prov ? '✓ Guardado' : '✓ Proveedor quitado' };
    } catch (e) { st.msg[cod] = { ok: false, texto: e.message }; }
    const abierto = document.activeElement && document.activeElement.matches('[data-pv-buscar]');
    pintar();
    if (abierto) host.querySelector('[data-pv-buscar]')?.focus();
  }

  window.proveedoresTelaPintar = el => {
    if (host !== el) {
      host = el;
      host.addEventListener('click', e => {
        const f = e.target.closest('[data-pv-fil]'); if (f) { st.solo = f.dataset.pvFil; pintar(); return; }
        const g = e.target.closest('[data-pv-guardar]'); if (g) guardar(g.closest('[data-cod]'));
      });
      host.addEventListener('input', e => {
        if (e.target.matches('[data-pv-buscar]')) { st.buscar = e.target.value; const pos = st.buscar.length; pintar(); const c = host.querySelector('[data-pv-buscar]'); c.focus(); c.setSelectionRange(pos, pos); }
      });
      host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('[data-cod]')) guardar(e.target.closest('[data-cod]')); });
    }
    if (!st.datos) { pintar(); cargar(); }
    else if (!host.firstElementChild) pintar();
  };
})();
