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
  .pv{display:grid;gap:14px;width:100%;max-width:1280px;margin:0 auto}
  .pv *{box-sizing:border-box}
  .pv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:18px 22px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(135deg,#101a16,#0c110d)}
  .pv-head small{color:#7da4ff;letter-spacing:.14em;font-weight:800;font-size:.68rem}.pv-head h2{margin:4px 0;font-size:1.5rem}.pv-head p{margin:0;color:#aebba7;font-size:.86rem;max-width:620px}
  .pv-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .pv input{min-height:42px;padding:0 12px;border:1px solid #2c3a2a;border-radius:10px;background:#0c110d;color:inherit;font-size:.92rem;width:100%}
  .pv-tools input{min-width:240px;width:auto}
  .pv-fil{min-height:42px;padding:0 16px;border:1px solid #34432f;border-radius:999px;background:#101710;color:#c5d1bf;font-weight:800;font-size:.76rem;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .pv-fil.on{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  .pv-lista{display:grid;gap:10px}
  .pv-fila{display:grid;grid-template-columns:76px minmax(160px,1.2fr) minmax(200px,1.4fr) minmax(130px,.6fr) auto;gap:12px;align-items:center;padding:12px 16px;border:1px solid #34432f;border-radius:14px;background:#0c110d}
  .pv-fila.sin{border-color:#7a5a1e}
  .pv-cod{font-size:1.25rem;font-weight:800;color:#d7ff3a;letter-spacing:.02em}
  .pv-nom b{display:block;font-size:.95rem}.pv-nom span{font-size:.72rem;color:#9fb09a}
  .pv-btn{min-height:42px;padding:0 18px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:inherit;font-weight:800;cursor:pointer;letter-spacing:.06em;width:auto!important}
  .pv-btn.pri{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}.pv-btn:disabled{opacity:.5;cursor:default}
  .pv-msg{font-size:.78rem;min-height:1.1em;color:#aebba7;grid-column:2/-1}.pv-msg.ok{color:#8bd450}.pv-msg.err{color:#ff9a9d}
  .pv-vacio{padding:30px;text-align:center;color:#aebba7;border:1px dashed #34432f;border-radius:14px}
  @media(max-width:900px){.pv-fila{grid-template-columns:64px 1fr;gap:10px}.pv-fila>.pv-nom{grid-column:2}.pv-fila>input,.pv-fila>.pv-btn{grid-column:1/-1}.pv-msg{grid-column:1/-1}}
  @media(max-width:700px){.pv-head{padding:14px 16px}.pv-head h2{font-size:1.2rem}.pv-tools{width:100%}.pv-tools input{width:100%;min-width:0}.pv input{font-size:16px}}
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
    host.innerHTML = '<div class="pv-head"><div><small>COMPRAS</small><h2>PROVEEDORES DE TELA</h2><p>Elige el proveedor de cada código de tela. El agente de inventario lo usa para crear la orden de compra en Effi.' +
      (sin ? ' <b>' + sin + ' sin proveedor.</b>' : ' Todas tienen proveedor.') + '</p></div>' +
      '<div class="pv-tools"><input type="search" data-pv-buscar placeholder="Buscar código, tela o proveedor" value="' + esc(st.buscar) + '">' +
      filtro('todas', 'TODAS') + filtro('sin', 'SIN PROVEEDOR') + filtro('con', 'CON PROVEEDOR') + '</div></div>' +
      '<datalist id="pv-proveedores">' + d.proveedores.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
      '<div class="pv-lista">' + (lista.length ? lista.map(t => {
        const m = st.msg[t.codigo];
        return '<div class="pv-fila' + (t.proveedor ? '' : ' sin') + '" data-cod="' + esc(t.codigo) + '"><div class="pv-cod">' + esc(t.codigo) + '</div>' +
          '<div class="pv-nom"><b>' + esc(t.nombre) + '</b><span>' + t.rollos + ' rollo' + (t.rollos === 1 ? '' : 's') + ' en Bodega</span></div>' +
          '<input type="text" list="pv-proveedores" data-pv-prov placeholder="Proveedor (como está en Effi)" value="' + esc(t.proveedor) + '">' +
          '<input type="text" inputmode="numeric" data-pv-nit placeholder="NIT (opcional)" value="' + esc(t.nit) + '">' +
          '<button type="button" class="pv-btn pri" data-pv-guardar>GUARDAR</button>' +
          '<div class="pv-msg' + (m ? (m.ok ? ' ok' : ' err') : '') + '">' + esc(m ? m.texto : '') + '</div></div>';
      }).join('') : '<div class="pv-vacio">No hay telas con ese filtro.</div>') + '</div>';
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
