(() => {
  // PROVEEDORES DE TELA (pestaña de Estándar 2026): por cada código de tela de Bodega se elige el proveedor.
  // El agente de inventario lo usa al crear la orden de compra en Effi (Effi no rellena el proveedor al elegir la tela).
  // Interfaz dinámica: se guarda sola al escribir o elegir, fichas por proveedor con su conteo, selección múltiple para asignar varias telas a la vez
  // y todo se actualiza en el sitio (sin redibujar ni perder el cursor).
  if (window.__proveedoresTelaListo) return;
  window.__proveedoresTelaListo = true;
  const st = { datos: null, buscar: '', solo: 'todas', prov: '', cargando: false, sel: new Set(), kpi: { total: 0, con: 0, sin: 0 } };
  let host = null;
  const timers = new Map();

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
  .pv{display:grid;gap:14px;width:100%;max-width:none;margin:0}
  .pv *{box-sizing:border-box}
  .pv-glass{border:1px solid rgba(255,255,255,.22);border-radius:18px;background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.04));-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);box-shadow:0 14px 34px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.2)}
  .pv-head{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;padding:18px 22px}
  .pv-head small{display:block;color:#c9d3c4;letter-spacing:.2em;font-weight:800;font-size:.62rem}.pv-head h2{margin:4px 0 2px;font-size:1.4rem;letter-spacing:.02em}.pv-head p{margin:0;color:#b6c2b0;font-size:.82rem;max-width:560px}
  .pv-kpis{display:flex;gap:10px;flex-wrap:wrap}
  .pv-kpi{position:relative;overflow:hidden;min-width:108px;padding:10px 16px;border-radius:14px;text-align:center}
  .pv-kpi b{position:relative;display:block;font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums}.pv-kpi span{position:relative;font-size:.58rem;letter-spacing:.14em;font-weight:800;color:#c9d3c4}
  .pv-kpi::before{content:"";position:absolute;left:0;bottom:0;height:var(--n,0%);width:100%;background:linear-gradient(180deg,rgba(139,212,80,.28),rgba(139,212,80,.08));transition:height .6s cubic-bezier(.2,.8,.2,1)}
  .pv-kpi.sin::before{background:linear-gradient(180deg,rgba(224,164,55,.34),rgba(224,164,55,.08))}
  .pv-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px}
  .pv input{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font-size:.92rem;width:100%;outline:none;transition:border-color .2s,box-shadow .2s}
  .pv input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(255,255,255,.1)}
  .pv-bar input[type=search]{flex:1;min-width:220px;width:auto}
  .pv-fil{min-height:38px;padding:0 15px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.06);color:#d3dccf;font-weight:800;font-size:.68rem;letter-spacing:.08em;cursor:pointer;width:auto!important;transition:background .2s,transform .15s}
  .pv-fil:hover{background:rgba(255,255,255,.14);transform:translateY(-1px)}.pv-fil.on{background:rgba(255,255,255,.92);color:#10140a;border-color:#fff}
  .pv-fil em{margin-left:6px;padding:1px 7px;border-radius:99px;background:rgba(255,255,255,.14);font-style:normal;font-size:.62rem}.pv-fil.on em{background:rgba(0,0,0,.14)}
  .pv-chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 2px;overflow-x:auto}
  .pv-masa{display:none;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-color:rgba(208,244,76,.6)!important;animation:pvIn .2s ease-out}
  .pv-masa.on{display:flex}.pv-masa b{font-size:.8rem;letter-spacing:.04em;color:#d0f44c}.pv-masa input{flex:1;min-width:200px;width:auto}
  @keyframes pvIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  .pv-cols,.pv-fila{display:grid;grid-template-columns:28px 70px minmax(170px,1.3fr) minmax(240px,1.8fr) 96px;gap:14px;align-items:center}
  .pv-cols{padding:0 20px;font-size:.58rem;letter-spacing:.16em;font-weight:800;color:#aab6a5}
  .pv-lista{display:grid;gap:9px}
  .pv-fila{padding:11px 20px;border-radius:16px;position:relative;transition:box-shadow .3s,transform .2s,border-color .3s}
  .pv-fila:hover{transform:translateX(2px)}
  .pv-fila::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:#8bd450;transition:background .3s}
  .pv-fila.sin::before{background:#e0a437}
  .pv-fila.sel{border-color:rgba(208,244,76,.7)}
  .pv-fila.flash{animation:pvFlash 1.1s ease-out}
  @keyframes pvFlash{0%{box-shadow:0 0 0 0 rgba(155,224,90,.7)}100%{box-shadow:0 0 0 14px rgba(155,224,90,0)}}
  .pv-fila input[type=checkbox]{width:18px;min-height:18px;height:18px;padding:0;accent-color:#d0f44c;cursor:pointer}
  .pv-cod{font-size:1.2rem;font-weight:800;letter-spacing:.02em}
  .pv-nom b{display:block;font-size:.92rem;line-height:1.25}.pv-nom span{font-size:.7rem;color:#aab6a5}
  .pv-est{display:inline-flex;align-items:center;gap:6px;justify-self:end;font-size:.66rem;font-weight:800;letter-spacing:.06em;color:#b6c2b0;white-space:nowrap}
  .pv-est i{width:8px;height:8px;border-radius:50%;background:#8bd450}.pv-fila.sin .pv-est i{background:#e0a437}
  .pv-est.guardando i{background:#7da4ff;animation:pvPulso .8s ease-in-out infinite}.pv-est.ok{color:#9be05a}.pv-est.err{color:#ff9a9d}.pv-est.err i{background:#ff6b6b}
  @keyframes pvPulso{50%{transform:scale(1.6);opacity:.5}}
  .pv-vacio{padding:30px;text-align:center;color:#b6c2b0;border-radius:16px}
  @media(max-width:900px){.pv-cols{display:none}.pv-fila{grid-template-columns:24px 58px 1fr;gap:10px;padding:14px 16px}.pv-fila>.pv-nom{grid-column:3}.pv-fila>input[data-pv-prov]{grid-column:1/-1}.pv-fila>.pv-est{grid-column:1/-1;justify-self:start}}
  @media(max-width:700px){.pv-head{padding:16px}.pv-head h2{font-size:1.2rem}.pv-kpis{width:100%}.pv-kpi{flex:1;min-width:0;padding:8px}.pv-bar input[type=search]{min-width:0;width:100%;flex-basis:100%}.pv input{font-size:16px}.pv-chips{flex-wrap:nowrap}}
  `;
  document.head.appendChild(css);

  const telas = () => (st.datos && st.datos.telas) || [];
  const visibles = () => {
    const q = plano(st.buscar);
    return telas().filter(t => (st.solo === 'todas' || (st.solo === 'sin' ? !t.proveedor : !!t.proveedor)) && (!st.prov || t.proveedor === st.prov) && (!q || plano(t.codigo + ' ' + t.nombre + ' ' + t.proveedor).includes(q)));
  };
  const q1 = s => host.querySelector(s);

  function contar(el, hasta) {
    const desde = Number(el.dataset.v || 0); el.dataset.v = hasta;
    if (desde === hasta) { el.textContent = hasta; return; }
    const t0 = performance.now();
    (function paso(t) { const p = Math.min(1, (t - t0) / 450); el.textContent = Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(paso); })(t0);
  }
  function pintarKpis() {
    const total = telas().length, sin = telas().filter(t => !t.proveedor).length, con = total - sin;
    const f = (k, n) => { const c = q1('[data-kpi="' + k + '"]'); if (!c) return; contar(c.querySelector('b'), n); c.style.setProperty('--n', total ? Math.round(n / total * 100) + '%' : '0%'); };
    f('total', total); f('con', con); f('sin', sin);
    host.querySelectorAll('[data-pv-fil] em').forEach(e => { const k = e.parentElement.dataset.pvFil; e.textContent = k === 'todas' ? total : k === 'sin' ? sin : con; });
  }
  function pintarChips() {
    const cuenta = {};
    telas().forEach(t => { if (t.proveedor) cuenta[t.proveedor] = (cuenta[t.proveedor] || 0) + 1; });
    const nombres = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a] || a.localeCompare(b));
    q1('.pv-chips').innerHTML = nombres.map(n => `<button type="button" class="pv-fil${st.prov === n ? ' on' : ''}" data-pv-prov-fil="${esc(n)}">${esc(n)}<em>${cuenta[n]}</em></button>`).join('');
    q1('#pv-proveedores').innerHTML = nombres.map(n => `<option value="${esc(n)}">`).join('');
  }
  function filaHtml(t) {
    return `<div class="pv-fila pv-glass${t.proveedor ? '' : ' sin'}${st.sel.has(t.codigo) ? ' sel' : ''}" data-cod="${esc(t.codigo)}"><input type="checkbox" data-pv-sel aria-label="Seleccionar"${st.sel.has(t.codigo) ? ' checked' : ''}><div class="pv-cod">${esc(t.codigo)}</div>` +
      `<div class="pv-nom"><b>${esc(t.nombre)}</b><span>${t.rollos} rollo${t.rollos === 1 ? '' : 's'} en Bodega</span></div>` +
      `<input type="text" list="pv-proveedores" data-pv-prov placeholder="Proveedor (como está en Effi)" value="${esc(t.proveedor)}" autocomplete="off">` +
      `<div class="pv-est" data-pv-est><i></i><span>${t.proveedor ? 'Con proveedor' : 'Sin proveedor'}</span></div></div>`;
  }
  function pintarLista() {
    const l = visibles();
    q1('.pv-lista').innerHTML = l.length ? l.map(filaHtml).join('') : '<div class="pv-vacio pv-glass">No hay telas con ese filtro.</div>';
    pintarMasa();
  }
  function pintarMasa() {
    const m = q1('.pv-masa'); const n = st.sel.size;
    m.classList.toggle('on', n > 0);
    q1('[data-pv-nsel]').textContent = n + (n === 1 ? ' tela seleccionada' : ' telas seleccionadas');
  }
  function pintar() {
    if (!host) return;
    if (!st.datos) { host.innerHTML = '<div class="pv-vacio">Cargando telas…</div>'; return; }
    if (!q1('.pv-lista')) {
      host.innerHTML = '<div class="pv-head pv-glass"><div><small>ESTÁNDAR 2026</small><h2>PROVEEDORES DE TELA</h2><p>Elige el proveedor de cada tela: se guarda solo. El agente de inventario lo usa al crear la orden de compra.</p></div>' +
        '<div class="pv-kpis"><div class="pv-kpi pv-glass" data-kpi="total"><b>0</b><span>TELAS</span></div><div class="pv-kpi pv-glass" data-kpi="con"><b>0</b><span>CON PROVEEDOR</span></div><div class="pv-kpi pv-glass sin" data-kpi="sin"><b>0</b><span>SIN PROVEEDOR</span></div></div></div>' +
        '<div class="pv-bar pv-glass"><input type="search" data-pv-buscar placeholder="Buscar código, tela o proveedor" value="' + esc(st.buscar) + '">' +
        '<button type="button" class="pv-fil" data-pv-fil="todas">TODAS<em></em></button><button type="button" class="pv-fil" data-pv-fil="sin">SIN PROVEEDOR<em></em></button><button type="button" class="pv-fil" data-pv-fil="con">CON PROVEEDOR<em></em></button></div>' +
        '<div class="pv-chips"></div>' +
        '<div class="pv-masa pv-glass"><b data-pv-nsel></b><input type="text" list="pv-proveedores" data-pv-masa placeholder="Proveedor para todas las seleccionadas" autocomplete="off"><button type="button" class="pv-fil on" data-pv-masa-ok>ASIGNAR</button><button type="button" class="pv-fil" data-pv-masa-no>QUITAR SELECCIÓN</button></div>' +
        '<datalist id="pv-proveedores"></datalist><div class="pv-cols"><span></span><span>CÓDIGO</span><span>TELA</span><span>PROVEEDOR</span><span></span></div><div class="pv-lista"></div>';
    }
    host.querySelectorAll('[data-pv-fil]').forEach(b => b.classList.toggle('on', b.dataset.pvFil === st.solo));
    pintarKpis(); pintarChips(); pintarLista();
  }

  async function cargar() {
    if (st.cargando) return;
    st.cargando = true;
    try { st.datos = await api('/api/proveedores-tela'); }
    catch (e) { host.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; st.cargando = false; return; }
    st.cargando = false;
    pintar();
  }

  function estado(fila, clase, texto) {
    const e = fila && fila.querySelector('[data-pv-est]'); if (!e) return;
    e.className = 'pv-est ' + clase; e.querySelector('span').textContent = texto;
  }
  async function guardar(cod, prov, fila) {
    prov = String(prov || '').trim();
    const t = telas().find(x => x.codigo === cod);
    if (!t || t.proveedor === prov) { if (fila) estado(fila, '', t && t.proveedor ? 'Con proveedor' : 'Sin proveedor'); return true; }
    estado(fila, 'guardando', 'Guardando…');
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify({ codigo: cod, proveedor: prov }) });
      t.proveedor = prov;
      const f = host.querySelector('[data-cod="' + CSS.escape(cod) + '"]');
      if (f) {
        f.classList.toggle('sin', !prov);
        estado(f, 'ok', prov ? '✓ Guardado' : '✓ Quitado');
        f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
        const inp = f.querySelector('[data-pv-prov]'); if (inp && inp.value.trim() !== prov) inp.value = prov;
        setTimeout(() => estado(f, '', prov ? 'Con proveedor' : 'Sin proveedor'), 2200);
      }
      pintarKpis(); pintarChips();
      if (st.solo !== 'todas' || st.prov) setTimeout(() => { if (!host.querySelector('[data-pv-prov]:focus')) pintarLista(); }, 900);   // si el filtro la deja fuera, se retira con calma
      return true;
    } catch (e) { estado(fila, 'err', e.message); return false; }
  }
  function programar(fila, ya) {
    const cod = fila.dataset.cod, inp = fila.querySelector('[data-pv-prov]');
    clearTimeout(timers.get(cod));
    if (ya) { guardar(cod, inp.value, fila); return; }
    estado(fila, '', 'Escribiendo…');
    timers.set(cod, setTimeout(() => guardar(cod, inp.value, fila), 900));
  }
  async function aplicarMasa() {
    const prov = q1('[data-pv-masa]').value.trim(); if (!prov) { q1('[data-pv-masa]').focus(); return; }
    const codigos = [...st.sel]; const boton = q1('[data-pv-masa-ok]'); boton.disabled = true;
    let ok = 0;
    for (const c of codigos) { const f = host.querySelector('[data-cod="' + CSS.escape(c) + '"]'); if (f) f.querySelector('[data-pv-prov]').value = prov; if (await guardar(c, prov, f)) { ok++; st.sel.delete(c); } }
    boton.disabled = false; q1('[data-pv-masa]').value = '';
    pintarLista();
  }

  window.proveedoresTelaPintar = el => {
    if (host !== el) {
      host = el;
      host.addEventListener('click', e => {
        const f = e.target.closest('[data-pv-fil]'); if (f) { st.solo = f.dataset.pvFil; st.prov = ''; pintar(); return; }
        const c = e.target.closest('[data-pv-prov-fil]'); if (c) { st.prov = st.prov === c.dataset.pvProvFil ? '' : c.dataset.pvProvFil; st.solo = 'todas'; pintar(); return; }
        if (e.target.closest('[data-pv-masa-ok]')) { aplicarMasa(); return; }
        if (e.target.closest('[data-pv-masa-no]')) { st.sel.clear(); pintarLista(); return; }
      });
      host.addEventListener('change', e => {
        const fila = e.target.closest('[data-cod]');
        if (e.target.matches('[data-pv-sel]') && fila) { const cod = fila.dataset.cod; e.target.checked ? st.sel.add(cod) : st.sel.delete(cod); fila.classList.toggle('sel', e.target.checked); pintarMasa(); return; }
        if (e.target.matches('[data-pv-prov]') && fila) programar(fila, true);
      });
      host.addEventListener('input', e => {
        if (e.target.matches('[data-pv-buscar]')) { st.buscar = e.target.value; pintarLista(); return; }
        const fila = e.target.closest('[data-cod]');
        if (e.target.matches('[data-pv-prov]') && fila) programar(fila, false);
      });
      host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-pv-prov]')) { e.preventDefault(); programar(e.target.closest('[data-cod]'), true); e.target.blur(); } });
    }
    if (!st.datos) { pintar(); cargar(); }
    else if (!host.firstElementChild) pintar();
  };
})();
