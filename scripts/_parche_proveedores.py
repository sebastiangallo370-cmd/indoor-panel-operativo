def rw(p, f):
    s = open(p, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    s = f(s.replace('\r\n', '\n'))
    open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', nl))


def one(s, a, b):
    assert s.count(a) == 1, (s.count(a), a[:80])
    return s.replace(a, b)


def js(s):
    # estado: vista guardada, agrupar y compacto
    s = one(s, "const st = { datos: null, buscar: '', filtro: '', cargando: false, sel: new Set(), edit: new Set(), estado: {}, reciente: '' };",
            "let pref = {}; try { pref = JSON.parse(localStorage.getItem('pv-vista') || '{}'); } catch (e) { /* sin almacenamiento */ }\n  const st = { datos: null, buscar: '', filtro: '', cargando: false, sel: new Set(), edit: new Set(), estado: {}, reciente: '', agrupar: pref.agrupar !== false, compacto: !!pref.compacto, plegadas: new Set() };\n  const guardarVista = () => { try { localStorage.setItem('pv-vista', JSON.stringify({ agrupar: st.agrupar, compacto: st.compacto })); } catch (e) { /* sin almacenamiento */ } };")
    # estilos nuevos
    s = one(s, "  @media(max-width:700px){.pv-head{padding:16px}",
            """  .pv-masa{position:sticky;bottom:14px;z-index:6;box-shadow:0 18px 40px rgba(0,0,0,.55)}
  .pv-masa-chips{display:flex;gap:6px;flex-wrap:wrap}
  .pv-herr{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .pv-herr .pv-fil{min-height:34px}.pv-herr .pv-fil.on{background:rgba(208,244,76,.92);border-color:#d0f44c}
  .pv-grupos{display:grid;gap:18px}
  .pv-fam{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 10px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16)}
  .pv-fam-t{display:flex;align-items:center;gap:10px;padding:0;border:0;background:transparent;color:#f3f8ee;font:900 1rem Arial;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .pv-fam-t i{display:inline-block;transition:transform .2s;font-style:normal;color:#d0f44c}.pv-fam.cerrada .pv-fam-t i{transform:rotate(-90deg)}
  .pv-fam-t em{font:700 .7rem Arial;font-style:normal;color:#aab6a5;letter-spacing:.04em}
  .pv-fam-est{flex:1;display:flex;gap:6px;align-items:center;min-width:120px}
  .pv-fam-est span{padding:2px 9px;border-radius:99px;font:800 .62rem Arial;letter-spacing:.06em;background:rgba(139,212,80,.18);color:#b9f08a}.pv-fam-est span.sin{background:rgba(224,164,55,.2);color:#ffc86b}
  .pv-fam-barra{flex:1 1 90px;max-width:220px;height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}.pv-fam-barra b{display:block;height:100%;background:linear-gradient(90deg,#4f9f2a,#8bd450);border-radius:inherit;transition:width .4s}
  .pv-grid.compacto{grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .pv-grid.compacto .pv-card{padding:10px 12px;border-radius:14px}.pv-grid.compacto .pv-card::before{height:3px}
  .pv-grid.compacto .pv-cod{font-size:1.15rem}.pv-grid.compacto .pv-nom{font-size:.78rem;min-height:0}.pv-grid.compacto .pv-sub{display:none}
  .pv-grid.compacto .pv-prov{margin-top:2px;padding-top:6px;gap:5px}.pv-grid.compacto .pv-prov input{min-height:32px;font-size:.78rem}.pv-grid.compacto .pv-est{min-height:0}.pv-grid.compacto .pv-sin-txt{display:none}
  @media(max-width:700px){.pv-head{padding:16px}""")
    # herramientas en la barra
    s = one(s, "'<div class=\"pv-bar pv-glass\"><input type=\"search\" data-pv-buscar placeholder=\"Buscar código, tela o proveedor\" value=\"' + esc(st.buscar) + '\"></div>' +",
            "'<div class=\"pv-bar pv-glass\"><input type=\"search\" data-pv-buscar placeholder=\"Buscar código, tela o proveedor\" value=\"' + esc(st.buscar) + '\"><div class=\"pv-herr\"><button type=\"button\" class=\"pv-fil\" data-pv-agrupar>AGRUPAR POR TELA</button><button type=\"button\" class=\"pv-fil\" data-pv-compacto>VISTA COMPACTA</button><button type=\"button\" class=\"pv-fil ambar\" data-pv-selsin>SELECCIONAR LAS SIN PROVEEDOR</button></div></div>' +")
    # barra de asignación masiva con chips de un toque
    s = one(s, "'<div class=\"pv-masa pv-glass\"><b data-pv-nsel></b><input type=\"text\" list=\"pv-proveedores\" data-pv-masa placeholder=\"Proveedor para todas las seleccionadas\" autocomplete=\"off\">",
            "'<div class=\"pv-masa pv-glass\"><b data-pv-nsel></b><div class=\"pv-masa-chips\"></div><input type=\"text\" list=\"pv-proveedores\" data-pv-masa placeholder=\"…o escribe otro proveedor\" autocomplete=\"off\">")
    s = one(s, "'<datalist id=\"pv-proveedores\"></datalist><div class=\"pv-grid\"></div>';", "'<datalist id=\"pv-proveedores\"></datalist><div id=\"pv-cont\"></div>';")
    s = one(s, "    if (!q1('.pv-grid')) {", "    if (!q1('#pv-cont')) {")
    # chips de asignación rápida
    s = one(s, "    q1('#pv-proveedores').innerHTML = habituales().map(n => `<option value=\"${esc(n)}\">`).join('');",
            "    q1('#pv-proveedores').innerHTML = habituales().map(n => `<option value=\"${esc(n)}\">`).join('');\n    q1('.pv-masa-chips').innerHTML = habituales().slice(0, 6).map(n => `<button type=\"button\" class=\"pv-fil on\" data-pv-masa-poner=\"${esc(n)}\">ASIGNAR ${esc(n)}</button>`).join('');\n    const ag = q1('[data-pv-agrupar]'), co = q1('[data-pv-compacto]'); if (ag) ag.classList.toggle('on', st.agrupar); if (co) co.classList.toggle('on', st.compacto);\n    const ns = q1('[data-pv-selsin]'); if (ns) ns.textContent = 'SELECCIONAR LAS SIN PROVEEDOR (' + visibles().filter(t => !t.proveedor).length + ')';")
    # pintarGrid con grupos
    a = s.index("  function pintarGrid() {")
    b = s.index("  function pintarMasa() {")
    nuevo = """  const familia = n => (String(n || '').toUpperCase().replace(/\\(.*?\\)/g, ' ').trim().split(/\\s+/)[0]) || 'OTRAS';
  function cabeceraFam(f, lista) {
    const con = lista.filter(t => t.proveedor).length, sin = lista.length - con, cerrada = st.plegadas.has(f);
    const todas = lista.every(t => st.sel.has(t.codigo));
    return `<div class="pv-fam pv-glass${cerrada ? ' cerrada' : ''}" data-fam="${esc(f)}"><button type="button" class="pv-fam-t" data-pv-plegar="${esc(f)}"><i>▾</i>${esc(f)}<em>${lista.length} ${lista.length === 1 ? 'tela' : 'telas'}</em></button>` +
      `<div class="pv-fam-est"><div class="pv-fam-barra"><b style="width:${Math.round(con / lista.length * 100)}%"></b></div>${con ? `<span>${con} CON</span>` : ''}${sin ? `<span class="sin">${sin} SIN</span>` : ''}</div>` +
      `<button type="button" class="pv-mini" data-pv-selfam="${esc(f)}">${todas ? 'QUITAR SELECCIÓN' : 'SELECCIONAR TODAS'}</button></div>`;
  }
  function pintarGrid() {
    const l = visibles(), cont = q1('#pv-cont');
    if (!l.length) cont.innerHTML = '<div class="pv-vacio pv-glass">No hay telas con ese filtro.</div>';
    else if (!st.agrupar) cont.innerHTML = `<div class="pv-grid${st.compacto ? ' compacto' : ''}">` + l.map(tarjetaHtml).join('') + '</div>';
    else {
      const g = {}; l.forEach(t => { (g[familia(t.nombre)] = g[familia(t.nombre)] || []).push(t); });
      cont.innerHTML = '<div class="pv-grupos">' + Object.keys(g).sort().map(f => '<section>' + cabeceraFam(f, g[f]) + (st.plegadas.has(f) ? '' : `<div class="pv-grid${st.compacto ? ' compacto' : ''}">` + g[f].map(tarjetaHtml).join('') + '</div>') + '</section>').join('') + '</div>';
    }
    st.reciente = '';
    pintarMasa();
  }
"""
    s = s[:a] + nuevo + s[b:]
    # al guardar una tela se refrescan las cabeceras de grupo
    s = one(s, "      cambiarTarjeta(cod); pintarKpis(); pintarChips();", "      cambiarTarjeta(cod); pintarKpis(); pintarChips(); if (st.agrupar) refrescarCabeceras();")
    s = one(s, "  function cambiarTarjeta(cod) {", """  function refrescarCabeceras() {
    const l = visibles(), g = {}; l.forEach(t => { (g[familia(t.nombre)] = g[familia(t.nombre)] || []).push(t); });
    host.querySelectorAll('.pv-fam').forEach(h => { const f = h.dataset.fam; if (g[f]) h.outerHTML = cabeceraFam(f, g[f]); });
  }
  function cambiarTarjeta(cod) {""")
    # aplicarMasa acepta el proveedor
    s = one(s, "  async function aplicarMasa() {\n    const prov = q1('[data-pv-masa]').value.trim(); if (!prov) { q1('[data-pv-masa]').focus(); return; }",
            "  async function aplicarMasa(dado) {\n    const prov = String(dado || q1('[data-pv-masa]').value).trim(); if (!prov) { q1('[data-pv-masa]').focus(); return; }")
    # clics
    s = one(s, "        if (e.target.closest('[data-pv-masa-ok]')) { aplicarMasa(); return; }",
            """        const mp = e.target.closest('[data-pv-masa-poner]'); if (mp) { aplicarMasa(mp.dataset.pvMasaPoner); return; }
        if (e.target.closest('[data-pv-agrupar]')) { st.agrupar = !st.agrupar; guardarVista(); pintarChips(); pintarGrid(); return; }
        if (e.target.closest('[data-pv-compacto]')) { st.compacto = !st.compacto; guardarVista(); pintarChips(); pintarGrid(); return; }
        if (e.target.closest('[data-pv-selsin]')) { visibles().filter(t => !t.proveedor).forEach(t => st.sel.add(t.codigo)); pintarGrid(); return; }
        const pl = e.target.closest('[data-pv-plegar]'); if (pl) { const f = pl.dataset.pvPlegar; st.plegadas.has(f) ? st.plegadas.delete(f) : st.plegadas.add(f); pintarGrid(); return; }
        const sf = e.target.closest('[data-pv-selfam]'); if (sf) { const lista = visibles().filter(t => familia(t.nombre) === sf.dataset.pvSelfam), todas = lista.every(t => st.sel.has(t.codigo)); lista.forEach(t => todas ? st.sel.delete(t.codigo) : st.sel.add(t.codigo)); pintarGrid(); return; }
        if (e.target.closest('[data-pv-masa-ok]')) { aplicarMasa(); return; }""")
    return s


rw('app/proveedores-tela.js', js)
rw('app/main.py', lambda s: one(s, "proveedores-tela.js?v=20261018-7", "proveedores-tela.js?v=20261020-1"))
print('ok')
