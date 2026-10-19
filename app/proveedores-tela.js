(() => {
  // PROVEEDORES DE TELA (pestaña de Estándar 2026): por cada código de tela de Bodega se elige el proveedor.
  // El agente de inventario lo usa al crear la orden de compra en Effi (Effi no rellena el proveedor al elegir la tela).
  // Una tarjeta por tela: con proveedor muestra su ficha (cambiar / quitar); sin proveedor ofrece los habituales con un toque o escribir otro.
  // Todo se guarda solo y se actualiza en el sitio (sin redibujar la pantalla ni perder el cursor).
  if (window.__proveedoresTelaListo) return;
  window.__proveedoresTelaListo = true;
  const st = { datos: null, buscar: '', filtro: '', cargando: false, sel: new Set(), edit: new Set(), estado: {}, reciente: '' };
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
  .pv input{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font-size:.92rem;width:100%;outline:none;transition:border-color .2s,box-shadow .2s}
  .pv input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(255,255,255,.1)}
  .pv-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px}
  .pv-bar input[type=search]{flex:1;min-width:220px;width:auto}
  .pv-fil{min-height:36px;padding:0 15px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.06);color:#d3dccf;font-weight:800;font-size:.68rem;letter-spacing:.08em;cursor:pointer;width:auto!important;white-space:nowrap;transition:background .2s,transform .15s}
  .pv-fil:hover{background:rgba(255,255,255,.14);transform:translateY(-1px)}.pv-fil.on{background:rgba(255,255,255,.92);color:#10140a;border-color:#fff}
  .pv-fil.ambar.on{background:#ffc86b;border-color:#ffc86b}
  .pv-fil em{margin-left:6px;padding:1px 7px;border-radius:99px;background:rgba(255,255,255,.14);font-style:normal;font-size:.62rem}.pv-fil.on em{background:rgba(0,0,0,.14)}
  .pv-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 4px}
  .pv-masa{display:none;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-color:rgba(208,244,76,.6)!important;animation:pvIn .2s ease-out}
  .pv-masa.on{display:flex}.pv-masa b{font-size:.8rem;letter-spacing:.04em;color:#d0f44c}.pv-masa input{flex:1;min-width:200px;width:auto}
  @keyframes pvIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  .pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .pv-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:16px 16px 14px;border-radius:20px;overflow:hidden;transition:transform .2s,box-shadow .3s,border-color .3s}
  .pv-card::before{content:"";position:absolute;left:0;right:0;top:0;height:5px;background:linear-gradient(90deg,#4f9f2a,#8bd450);transition:background .3s}
  .pv-card.sin::before{background:linear-gradient(90deg,#c9821a,#ffc86b)}
  .pv-card:hover{transform:translateY(-3px);box-shadow:0 18px 36px -14px #000}
  .pv-card.sel{border-color:rgba(208,244,76,.8)}
  .pv-card.nueva{animation:pvFlash 1.1s ease-out}
  @keyframes pvFlash{0%{box-shadow:0 0 0 0 rgba(155,224,90,.75)}100%{box-shadow:0 0 0 16px rgba(155,224,90,0)}}
  .pv-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .pv-cod{font-size:1.9rem;font-weight:900;letter-spacing:.01em;line-height:1}
  .pv-top input[type=checkbox]{width:20px;min-height:20px;height:20px;padding:0;accent-color:#d0f44c;cursor:pointer}
  .pv-nom{font-size:.96rem;font-weight:800;line-height:1.25;min-height:2.4em}
  .pv-sub{font-size:.7rem;color:#aab6a5;letter-spacing:.03em}
  .pv-prov{display:grid;gap:8px;margin-top:6px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14)}
  .pv-ficha{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 8px 14px;border-radius:12px;background:rgba(139,212,80,.14);border:1px solid rgba(139,212,80,.45)}
  .pv-ficha b{font-size:.8rem;letter-spacing:.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d6f7b0}
  .pv-ficha div{display:flex;gap:4px;flex:0 0 auto}
  .pv-mini{min-height:28px;padding:0 10px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.08);color:#e8f0e0;font:800 .62rem Arial;letter-spacing:.08em;cursor:pointer;width:auto!important;transition:background .15s}
  .pv-mini:hover{background:rgba(255,255,255,.2)}.pv-mini.rojo:hover{background:rgba(255,106,90,.3)}
  .pv-sug{display:flex;flex-wrap:wrap;gap:6px}
  .pv-sug .pv-mini{min-height:30px;padding:0 12px;font-size:.66rem}
  .pv-sin-txt{font-size:.66rem;font-weight:800;letter-spacing:.1em;color:#ffc86b}
  .pv-prov input{min-height:38px;font-size:.84rem}
  .pv-est{min-height:14px;font-size:.62rem;font-weight:800;letter-spacing:.06em;color:#b6c2b0}.pv-est.ok{color:#9be05a}.pv-est.err{color:#ff9a9d}.pv-est.guardando{color:#9db8ff}
  .pv-vacio{grid-column:1/-1;padding:30px;text-align:center;color:#b6c2b0;border-radius:16px}
  @media(max-width:700px){.pv-head{padding:16px}.pv-head h2{font-size:1.2rem}.pv-kpis{width:100%}.pv-kpi{flex:1;min-width:0;padding:8px}.pv-bar input[type=search]{min-width:0;width:100%;flex-basis:100%}.pv input{font-size:16px}.pv-grid{grid-template-columns:1fr}.pv-cod{font-size:1.6rem}}
  `;
  document.head.appendChild(css);

  const telas = () => (st.datos && st.datos.telas) || [];
  const cuentaProv = () => { const c = {}; telas().forEach(t => { if (t.proveedor) c[t.proveedor] = (c[t.proveedor] || 0) + 1; }); return c; };
  const habituales = () => { const c = cuentaProv(); return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)); };
  const visibles = () => {
    const q = plano(st.buscar);
    return telas().filter(t => (!st.filtro || (st.filtro === '__sin' ? !t.proveedor : t.proveedor === st.filtro)) && (!q || plano(t.codigo + ' ' + t.nombre + ' ' + t.proveedor).includes(q)));
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
  }
  function pintarChips() {
    const c = cuentaProv(), total = telas().length, sin = telas().filter(t => !t.proveedor).length;
    const chip = (k, txt, n, extra) => `<button type="button" class="pv-fil${extra || ''}${st.filtro === k ? ' on' : ''}" data-pv-filtro="${esc(k)}">${esc(txt)}<em>${n}</em></button>`;
    q1('.pv-chips').innerHTML = chip('', 'TODAS', total) + chip('__sin', 'SIN PROVEEDOR', sin, ' ambar') + habituales().map(n => chip(n, n, c[n])).join('');
    q1('#pv-proveedores').innerHTML = habituales().map(n => `<option value="${esc(n)}">`).join('');
  }
  function tarjetaHtml(t) {
    const e = st.estado[t.codigo] || {};
    const editando = st.edit.has(t.codigo) || !t.proveedor;
    const sug = habituales().filter(n => n !== t.proveedor).slice(0, 4);
    const cuerpo = (t.proveedor && !editando)
      ? `<div class="pv-ficha"><b title="${esc(t.proveedor)}">${esc(t.proveedor)}</b><div><button type="button" class="pv-mini" data-pv-cambiar>CAMBIAR</button><button type="button" class="pv-mini rojo" data-pv-quitar title="Quitar proveedor">✕</button></div></div>`
      : (t.proveedor ? '' : '<span class="pv-sin-txt">⚠ SIN PROVEEDOR</span>') +
        (sug.length ? '<div class="pv-sug">' + sug.map(n => `<button type="button" class="pv-mini" data-pv-poner="${esc(n)}">${esc(n)}</button>`).join('') + '</div>' : '') +
        `<input type="text" list="pv-proveedores" data-pv-input placeholder="${t.proveedor ? 'Otro proveedor…' : 'Escribe el proveedor…'}" autocomplete="off">` +
        (t.proveedor ? '<div class="pv-sug"><button type="button" class="pv-mini" data-pv-listo>LISTO</button></div>' : '');
    return `<div class="pv-card pv-glass${t.proveedor ? '' : ' sin'}${st.sel.has(t.codigo) ? ' sel' : ''}${st.reciente === t.codigo ? ' nueva' : ''}" data-cod="${esc(t.codigo)}">` +
      `<div class="pv-top"><span class="pv-cod">${esc(t.codigo)}</span><input type="checkbox" data-pv-sel aria-label="Seleccionar"${st.sel.has(t.codigo) ? ' checked' : ''}></div>` +
      `<div class="pv-nom">${esc(t.nombre)}</div><div class="pv-sub">${t.rollos} ROLLO${t.rollos === 1 ? '' : 'S'} EN BODEGA</div>` +
      `<div class="pv-prov">${cuerpo}</div><div class="pv-est ${esc(e.c || '')}" data-pv-est>${esc(e.t || '')}</div></div>`;
  }
  function pintarGrid() {
    const l = visibles();
    q1('.pv-grid').innerHTML = l.length ? l.map(tarjetaHtml).join('') : '<div class="pv-vacio pv-glass">No hay telas con ese filtro.</div>';
    st.reciente = '';
    pintarMasa();
  }
  function pintarMasa() {
    const n = st.sel.size;
    q1('.pv-masa').classList.toggle('on', n > 0);
    q1('[data-pv-nsel]').textContent = n + (n === 1 ? ' tela seleccionada' : ' telas seleccionadas');
  }
  function cambiarTarjeta(cod) {
    const t = telas().find(x => x.codigo === cod), viejo = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"]');
    if (!t || !viejo) return;
    const enFiltro = visibles().some(x => x.codigo === cod);
    if (!enFiltro) { viejo.style.transition = 'opacity .3s,transform .3s'; viejo.style.opacity = '0'; viejo.style.transform = 'scale(.94)'; setTimeout(() => { if (!visibles().some(x => x.codigo === cod)) viejo.remove(); }, 320); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = tarjetaHtml(t); viejo.replaceWith(tmp.firstElementChild);
    st.reciente = '';
  }
  function pintar() {
    if (!host) return;
    if (!st.datos) { host.innerHTML = '<div class="pv-vacio">Cargando telas…</div>'; return; }
    if (!q1('.pv-grid')) {
      host.innerHTML = '<div class="pv-head pv-glass"><div><small>ESTÁNDAR 2026</small><h2>PROVEEDORES DE TELA</h2><p>Una tarjeta por tela: elige su proveedor con un toque o escribe otro. Se guarda solo y el agente de inventario lo usa al crear la orden de compra.</p></div>' +
        '<div class="pv-kpis"><div class="pv-kpi pv-glass" data-kpi="total"><b>0</b><span>TELAS</span></div><div class="pv-kpi pv-glass" data-kpi="con"><b>0</b><span>CON PROVEEDOR</span></div><div class="pv-kpi pv-glass sin" data-kpi="sin"><b>0</b><span>SIN PROVEEDOR</span></div></div></div>' +
        '<div class="pv-bar pv-glass"><input type="search" data-pv-buscar placeholder="Buscar código, tela o proveedor" value="' + esc(st.buscar) + '"></div>' +
        '<div class="pv-chips"></div>' +
        '<div class="pv-masa pv-glass"><b data-pv-nsel></b><input type="text" list="pv-proveedores" data-pv-masa placeholder="Proveedor para todas las seleccionadas" autocomplete="off"><button type="button" class="pv-fil on" data-pv-masa-ok>ASIGNAR</button><button type="button" class="pv-fil" data-pv-masa-no>QUITAR SELECCIÓN</button></div>' +
        '<datalist id="pv-proveedores"></datalist><div class="pv-grid"></div>';
    }
    pintarKpis(); pintarChips(); pintarGrid();
  }

  async function cargar() {
    if (st.cargando) return;
    st.cargando = true;
    try { st.datos = await api('/api/proveedores-tela'); }
    catch (e) { host.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; st.cargando = false; return; }
    st.cargando = false;
    pintar();
  }

  function estado(cod, c, t) {
    st.estado[cod] = { c, t };
    const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]');
    if (e) { e.className = 'pv-est ' + c; e.textContent = t; }
  }
  async function guardar(cod, prov) {
    prov = String(prov || '').trim();
    const t = telas().find(x => x.codigo === cod);
    if (!t) return false;
    if (t.proveedor === prov) { st.edit.delete(cod); cambiarTarjeta(cod); return true; }
    estado(cod, 'guardando', 'Guardando…');
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify({ codigo: cod, proveedor: prov }) });
      t.proveedor = prov; st.edit.delete(cod); st.reciente = cod;
      st.estado[cod] = { c: 'ok', t: prov ? '✓ Guardado' : '✓ Proveedor quitado' };
      cambiarTarjeta(cod); pintarKpis(); pintarChips();
      setTimeout(() => { if ((st.estado[cod] || {}).c === 'ok') { delete st.estado[cod]; const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]'); if (e) { e.className = 'pv-est'; e.textContent = ''; } } }, 2200);
      return true;
    } catch (e) { estado(cod, 'err', e.message); return false; }
  }
  async function aplicarMasa() {
    const prov = q1('[data-pv-masa]').value.trim(); if (!prov) { q1('[data-pv-masa]').focus(); return; }
    const boton = q1('[data-pv-masa-ok]'); boton.disabled = true;
    for (const c of [...st.sel]) { if (await guardar(c, prov)) st.sel.delete(c); }
    boton.disabled = false; q1('[data-pv-masa]').value = '';
    pintarGrid();
  }

  window.proveedoresTelaPintar = el => {
    if (host !== el) {
      host = el;
      const cod = e => { const c = e.target.closest('.pv-card'); return c && c.dataset.cod; };
      host.addEventListener('click', e => {
        const f = e.target.closest('[data-pv-filtro]'); if (f) { st.filtro = f.dataset.pvFiltro; pintarChips(); pintarGrid(); return; }
        const p = e.target.closest('[data-pv-poner]'); if (p) { guardar(cod(e), p.dataset.pvPoner); return; }
        if (e.target.closest('[data-pv-quitar]')) { guardar(cod(e), ''); return; }
        if (e.target.closest('[data-pv-cambiar]')) { const c = cod(e); st.edit.add(c); cambiarTarjeta(c); host.querySelector('.pv-card[data-cod="' + CSS.escape(c) + '"] [data-pv-input]')?.focus(); return; }
        if (e.target.closest('[data-pv-listo]')) { const c = cod(e); st.edit.delete(c); cambiarTarjeta(c); return; }
        if (e.target.closest('[data-pv-masa-ok]')) { aplicarMasa(); return; }
        if (e.target.closest('[data-pv-masa-no]')) { st.sel.clear(); pintarGrid(); return; }
      });
      host.addEventListener('change', e => {
        const c = cod(e);
        if (e.target.matches('[data-pv-sel]') && c) { e.target.checked ? st.sel.add(c) : st.sel.delete(c); e.target.closest('.pv-card').classList.toggle('sel', e.target.checked); pintarMasa(); return; }
        if (e.target.matches('[data-pv-input]') && c && e.target.value.trim()) guardar(c, e.target.value);   // al elegir de la lista o salir de la casilla
      });
      host.addEventListener('input', e => { if (e.target.matches('[data-pv-buscar]')) { st.buscar = e.target.value; pintarGrid(); } });
      host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-pv-input]')) { e.preventDefault(); const c = cod(e); if (c && e.target.value.trim()) guardar(c, e.target.value); } });
    }
    if (!st.datos) { pintar(); cargar(); }
    else if (!host.firstElementChild) pintar();
  };
})();
