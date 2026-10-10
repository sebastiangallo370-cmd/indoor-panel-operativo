(() => {
  // MOLDERIA: pestañas FICHAS TÉCNICAS (fichas por REF importadas de los Excel, con la plantilla de Indoor) y MOLDERIA (explorador de carpetas, solo lectura).
  if (window.__molderiaListo) return;
  window.__molderiaListo = true;
  function guardado(clave, defecto) { try { const v = JSON.parse(localStorage.getItem(clave)); return v == null ? defecto : v; } catch (e) { return defecto; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ } }
  const ORDEN_TALLAS = ['2', '4', '6', '8', '10', '12', '14', '16', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
  const st = {
    ctx: 'estandar', tab: 'fichas', ruta: '', datos: null, buscar: '', cargando: false, error: '',
    pestanas: [{ id: 'fichas', titulo: 'FICHAS TÉCNICAS' }, { id: 'molderia', titulo: 'MOLDERIA' }],
    // fichas
    modo: 'refs', fichas: null, mockups: {},
    talla: '', cerradas: {}, calc: {}, orden: 'ref', soloFav: false, ids: [],
    fav: new Set(guardado('mo_fav', [])), rec: guardado('mo_rec', []), chk: guardado('mo_chk', {}), familia: '', ficha: null, imp: null, importando: false, cargandoFicha: false,
  };
  let panel, tab, relojImp = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const peso = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B';
  const fecha = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
  const hora = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
  const url = (ruta, descargar) => '/api/molderia/archivo?tab=' + encodeURIComponent(st.tab) + '&ruta=' + encodeURIComponent(ruta) + (descargar ? '&descargar=1' : '');
  const mockUrl = ref => '/api/fichas/mockup?ref=' + encodeURIComponent(ref) + '&v=' + (st.mockups[ref] || 0);
  const imgUrl = (id, archivo) => '/api/molderia/ficha-img?id=' + encodeURIComponent(id) + '&archivo=' + encodeURIComponent(archivo);
  const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  const ICONO = { pdf: ['PDF', '#ff9a7a'], xlsx: ['XLS', '#7fe0b0'], xls: ['XLS', '#7fe0b0'], csv: ['CSV', '#7fe0b0'], ai: ['AI', '#ffb766'], psd: ['PSD', '#7da4ff'], jpg: ['IMG', '#d7ff3a'], jpeg: ['IMG', '#d7ff3a'], png: ['IMG', '#d7ff3a'], dxf: ['DXF', '#c9a3ff'], mrk: ['MRK', '#c9a3ff'], pds: ['PDS', '#c9a3ff'] };
  const NOMBRE_GRUPO = { masc: 'MASC', feme: 'FEME', fem: 'FEME', nino: 'NIÑO', nina: 'NIÑA' };

  async function api(u, opciones) {
    const r = await fetch(u, { cache: 'no-store', credentials: 'same-origin', ...opciones, headers: { 'Content-Type': 'application/json', ...((opciones || {}).headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'No pude completar la acción');
    return j;
  }

  const css = document.createElement('style');
  css.textContent = `
  .mo{display:grid;gap:16px;width:100%;max-width:1320px;margin:0 auto}.mo *{box-sizing:border-box}
  .mo-head{display:grid;gap:14px;padding:22px 24px;border:1px solid #34432f;border-radius:20px;background:radial-gradient(120% 140% at 0 0,#1a2a12 0,#0c110d 60%)}
  .mo-head small{color:#d7ff3a;letter-spacing:.16em;font-weight:800;font-size:.68rem}.mo-head h2{margin:4px 0 0;font-size:1.7rem}
  .mo-tabs{display:flex;gap:8px;flex-wrap:wrap}.mo-tab{min-height:44px;padding:0 22px;border:1px solid #34432f;border-radius:999px;background:#101710;color:#c5d1bf;font-weight:800;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .mo-tab.on{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  .mo-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border:1px solid #2a3827;border-radius:16px;background:#0c110d}
  .mo-mig{display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:1;min-width:240px;font-size:.84rem}.mo-mig button{border:0;background:transparent;color:#9db8ff;cursor:pointer;font-weight:700;padding:4px 6px;border-radius:8px;width:auto!important;min-height:0!important}
  .mo-mig button:hover{background:#17211a}.mo-mig span{color:#6d7e68}.mo-mig b{color:#e6efe0;padding:4px 6px}
  .mo-bar input[type=search]{min-height:40px;min-width:240px;padding:0 14px;border:1px solid #34432f;border-radius:12px;background:#101710;color:inherit;font-size:.9rem}
  .mo-btn{min-height:40px;padding:0 16px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:#d7ff3a;font-weight:800;letter-spacing:.05em;cursor:pointer;font-size:.8rem;width:auto!important;text-decoration:none;display:inline-flex;align-items:center}
  .mo-btn:hover{background:#223018}.mo-btn.pri{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}.mo-btn:disabled{opacity:.6;cursor:default}
  .mo-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
  .mo-card{display:grid;gap:8px;padding:14px;border:1px solid #2a3827;border-radius:16px;background:#0c110d;align-content:start;text-align:left;color:inherit;cursor:pointer;width:auto!important;min-height:0!important}
  .mo-card:hover{border-color:#5d7a3a;background:#101a12}
  .mo-top{display:flex;align-items:center;gap:12px}
  .mo-ico{display:grid;place-items:center;flex:none;width:46px;height:46px;border-radius:14px;background:#17211a;font-size:.72rem;font-weight:900;letter-spacing:.04em}
  .mo-ico.dir{font-size:1.35rem;background:#26361f}.mo-card b{font-size:.92rem;word-break:break-word;line-height:1.25}
  .mo-meta{font-size:.72rem;color:#8fa088}.mo-prev{height:130px;border-radius:12px;background:#e9ece6;overflow:hidden}.mo-prev img{width:100%;height:100%;object-fit:contain;display:block}
  .mo-acc{display:flex;gap:8px;flex-wrap:wrap}.mo-acc a{padding:6px 12px;border-radius:10px;border:1px solid #34432f;background:#17211a;color:#d7ff3a;font-weight:800;font-size:.72rem;text-decoration:none;letter-spacing:.05em}
  .mo-acc a:hover{background:#223018}
  .mo-vacio{padding:34px;text-align:center;color:#8fa088;border:1px dashed #34432f;border-radius:14px;font-size:.88rem}
  .mo-chips{display:flex;gap:8px;flex-wrap:wrap}.mo-chip{min-height:34px;padding:0 14px;border:1px solid #34432f;border-radius:999px;background:#101710;color:#c5d1bf;font-weight:700;font-size:.76rem;cursor:pointer;width:auto!important}
  .mo-chip.on{background:#26361f;border-color:#9fd24c;color:#d7ff3a}
  .mo-ref{display:grid;gap:10px;padding:0;overflow:hidden}.mo-ref .mo-prev{height:190px;border-radius:0;background:#f1f3ee}
  .mo-ref .mo-in{display:grid;gap:6px;padding:0 14px 14px}.mo-ref h4{margin:0;font-size:1.5rem;letter-spacing:.03em}.mo-ref p{margin:0;font-size:.78rem;color:#aebba7}
  .mo-prom{display:flex;gap:6px;flex-wrap:wrap}.mo-prom span{padding:3px 9px;border-radius:999px;background:#17211a;font-size:.68rem;font-weight:800;color:#d7ff3a}
  .mo-ref .sinimg{height:190px;display:grid;place-items:center;align-content:center;gap:12px;background:#17211a;color:#6d7e68;font-weight:800;font-size:.8rem;letter-spacing:.1em}
  /* ficha con la plantilla de Indoor */
  .ft{display:grid;gap:14px}
  .ft-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .ft-banda{display:grid;gap:16px;padding:22px 24px;border:1px solid #4b6a2b;border-radius:20px;background:linear-gradient(135deg,#17260c,#0c110d 70%)}
  .ft-banda small{color:#d7ff3a;letter-spacing:.16em;font-weight:800;font-size:.66rem}.ft-banda h3{margin:2px 0;font-size:2.2rem;letter-spacing:.03em}.ft-banda p{margin:0;color:#c5d1bf}
  .ft-datos{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
  .ft-dato{padding:12px 14px;border:1px solid #2c4020;border-radius:14px;background:#0f1a0b}.ft-dato small{display:block;color:#9fb09a;letter-spacing:.1em;font-size:.6rem;font-weight:800;margin-bottom:6px}.ft-dato b{font-size:1rem}
  .ft-prom{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}.ft-prom div{display:grid;text-align:center}.ft-prom em{font-style:normal;font-size:1.5rem;font-weight:800;color:#d7ff3a}.ft-prom span{font-size:.6rem;color:#9fb09a;font-weight:800;letter-spacing:.08em}
  .ft-sec{display:grid;gap:12px;padding:18px 20px;border:1px solid #2a3827;border-radius:18px;background:#0c110d}
  .ft-sec>h4{margin:0;font-size:.74rem;letter-spacing:.16em;color:#d7ff3a;font-weight:800;display:flex;align-items:center;gap:10px}.ft-sec>h4::after{content:'';flex:1;height:1px;background:#273326}
  .ft-nota{margin:0;font-size:.82rem;color:#c5d1bf;background:#141c15;padding:8px 12px;border-radius:10px}
  .ft-gal{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}.ft-gal a{display:block;border-radius:14px;background:#f1f3ee;overflow:hidden;border:1px solid #2a3827}.ft-gal img{width:100%;height:210px;object-fit:contain;display:block}
  .ft-gal.grande{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}.ft-gal.grande img{height:340px}
  .ft-piezas{display:flex;gap:6px;flex-wrap:wrap}.ft-piezas span{padding:4px 11px;border-radius:999px;background:#17211a;font-size:.7rem;font-weight:700;color:#c5d1bf}
  .ft-tabla{width:100%;border-collapse:collapse;font-size:.82rem}.ft-tabla th{background:#17211a;color:#9fb09a;font-size:.62rem;letter-spacing:.1em;text-align:left;padding:8px 10px;font-weight:800}
  .ft-tabla td{padding:8px 10px;border-top:1px solid #1d2a1e;vertical-align:top}.ft-tabla td.n{text-align:center}
  .ft-scroll{overflow-x:auto;border-radius:12px;border:1px solid #1d2a1e}
  .ft-tallas th.t{text-align:center;color:#d7ff3a}.ft-tallas td.l{font-weight:800;color:#9fb09a;font-size:.68rem;letter-spacing:.08em}
  .ft-desc{display:grid;gap:8px}.ft-desc div{display:grid;grid-template-columns:34px 1fr;gap:8px;font-size:.88rem;line-height:1.45}.ft-desc b{color:#d7ff3a}
  .ft-lista{display:grid;gap:6px}.ft-lista div{display:grid;grid-template-columns:200px 1fr;gap:10px;padding:8px 12px;border-radius:10px;background:#101710;font-size:.84rem}.ft-lista b{color:#9fb09a;font-size:.7rem;letter-spacing:.06em}
  .ft-lista.simple div{grid-template-columns:1fr}
  .mo-head.compacta{padding:10px 14px;border-radius:16px}
  .ft-top{justify-content:space-between}.ft-nav{display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:200px}.ft-der{display:flex;gap:8px;flex-wrap:wrap}
  .ft-top{position:sticky;top:0;z-index:5;padding:10px 12px;border:1px solid #2a3827;border-radius:16px;background:rgba(10,15,11,.94);backdrop-filter:blur(6px)}
  .ft-banda{position:relative;overflow:hidden}.ft-banda::before{content:'';position:absolute;inset:0 auto 0 0;width:6px;background:linear-gradient(#d7ff3a,#6fa13a)}
  .ft-id{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .ft-ref{padding:12px 22px;border-radius:18px;background:#d7ff3a;color:#10140a;font-size:2.6rem;font-weight:900;letter-spacing:.04em;line-height:1}
  .ft-prenda{margin:2px 0 0;font-size:1.25rem;font-weight:800}.ft-sub{margin:2px 0 0;font-size:.8rem;color:#9fb09a}
  .ft-tela{display:flex;gap:10px;align-items:center;margin-top:4px}.ft-tela em{font-style:normal;font-weight:900;font-size:.68rem;padding:2px 9px;border-radius:999px;background:#26361f;color:#d7ff3a}
  .ft-tela span{font-size:.92rem;font-weight:700}
  .ft-sec{scroll-margin-top:84px}
  .ft-tabla tbody tr:nth-child(even) td{background:#0f160f}.ft-tabla tbody tr:hover td{background:#16241a}
  .ft-tallas td.l{position:sticky;left:0;background:#101710}
  .ft-gal a{transition:transform .15s,box-shadow .15s;cursor:zoom-in}.ft-gal a:hover{transform:translateY(-3px);box-shadow:0 10px 24px #0008}
  .mo-ref{transition:transform .15s,border-color .15s,box-shadow .15s}.mo-ref:hover{transform:translateY(-4px);box-shadow:0 14px 30px #0009;border-color:#9fd24c}
  .mo-ref .mo-prev{background:linear-gradient(180deg,#f4f6f1,#e4e8df)}.mo-ref h4{color:#d7ff3a}
  .mo-luz{position:fixed;inset:0;z-index:99999;background:rgba(3,6,4,.92);display:grid;place-items:center;padding:24px;cursor:zoom-out}
  .mo-luz img{max-width:94vw;max-height:90vh;border-radius:14px;background:#f1f3ee;box-shadow:0 20px 60px #000}
  @media print{
    body{background:#fff!important;color:#000!important}
    nav,header,.user-menu,.mo-head,.ft-top,.mo-luz,.footer-note{display:none!important}
    main{padding:0!important;max-width:none!important}
    .panel:not(.active){display:none!important}
    .ft *{background:#fff!important;color:#000!important;border-color:#bbb!important;box-shadow:none!important;backdrop-filter:none!important}
    .ft-ref{border:2px solid #000!important}.ft-sec,.ft-banda{break-inside:avoid;page-break-inside:avoid}
    .ft-gal img{height:150px!important}.ft-gal.grande img{height:240px!important}
    .ft-tallasel,.ft-calc input{border-color:#bbb!important}.ft-sec.cerrada>*:not(h4){display:revert!important}
  }
  /* interactividad */
  .ft-tallas .hl{background:#2a4a12!important;color:#fff!important;box-shadow:inset 0 0 0 1px #d7ff3a;font-weight:900}
  .ft-tallasel{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px;border:1px solid #2a3827;border-radius:16px;background:#0c110d}
  .ft-tallasel small{font-size:.62rem;letter-spacing:.14em;color:#9fb09a;font-weight:800;margin-right:6px}
  .ft-tcard{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));padding:14px 16px;border:1px solid #d7ff3a66;border-radius:16px;background:linear-gradient(135deg,#17260c,#0c110d)}
  .ft-tcard div{display:grid;gap:2px}.ft-tcard small{font-size:.6rem;letter-spacing:.1em;color:#9fb09a;font-weight:800}.ft-tcard b{font-size:1.45rem;color:#d7ff3a}.ft-tcard span{font-size:.72rem;color:#c5d1bf}
  .ft-sec>h4{cursor:pointer;user-select:none}.ft-sec>h4 .fl{margin-left:auto;font-size:.8rem;color:#9fb09a;transition:transform .15s}
  .ft-sec.cerrada>*:not(h4){display:none!important}.ft-sec.cerrada>h4 .fl{transform:rotate(-90deg)}
  .ft-calc{display:grid;gap:12px}.ft-calc .fila{display:grid;gap:6px}.ft-calc .fila>b{font-size:.7rem;letter-spacing:.1em;color:#9fb09a}
  .ft-calc .campos{display:flex;gap:8px;flex-wrap:wrap}.ft-calc label{display:grid;gap:3px;text-align:center;font-size:.62rem;font-weight:800;color:#9fb09a}
  .ft-calc input{width:64px;min-height:42px;border:1px solid #34432f;border-radius:10px;background:#101710;color:#fff;text-align:center;font-size:1rem;font-weight:800}
  .ft-calc input:focus{outline:2px solid #d7ff3a}.ft-total{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:12px 16px;border-radius:14px;background:#122014;border:1px solid #2c4020}
  .ft-total b{font-size:2rem;color:#d7ff3a}.ft-total span{font-size:.8rem;color:#c5d1bf}
  .ft-chk{display:flex!important;align-items:flex-start;gap:12px;cursor:pointer}.ft-chk input{width:22px;height:22px;flex:none;accent-color:#d7ff3a;margin-top:2px}
  .ft-chk.hecho{opacity:.55}.ft-chk.hecho span{text-decoration:line-through}
  .ft-prog{display:flex;align-items:center;gap:10px;font-size:.74rem;color:#9fb09a;font-weight:800}.ft-prog i{flex:1;height:8px;border-radius:99px;background:#1b251d;overflow:hidden}.ft-prog i s{display:block;height:100%;background:linear-gradient(90deg,#6fa13a,#d7ff3a);text-decoration:none}
  .mo-star{position:absolute;top:8px;right:8px;z-index:2;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(10,15,11,.82);color:#9fb09a;font-size:1.1rem;cursor:pointer;border:1px solid #34432f}
  .mo-star.on{color:#ffd83a;border-color:#ffd83a}.mo-ref{position:relative}
  .mo-bar select{min-height:40px;padding:0 12px;border:1px solid #34432f;border-radius:12px;background:#101710;color:inherit;font-size:.85rem}
  .mo-rec{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mo-rec small{font-size:.62rem;letter-spacing:.14em;color:#9fb09a;font-weight:800}
  .mo-luz{grid-template-rows:1fr auto}.mo-luz .zona{overflow:auto;max-width:96vw;max-height:84vh;display:grid;place-items:center}.mo-luz img.zoom{max-width:none;max-height:none;width:210%;cursor:zoom-out}
  .mo-luz .ctl{display:flex;gap:10px;align-items:center;justify-content:center;padding-top:10px;color:#c5d1bf;font-weight:800}.mo-luz .ctl button{min-height:44px;min-width:56px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:#d7ff3a;font-size:1.2rem;cursor:pointer}
  .mo-nas{padding:7px 13px;border-radius:999px;background:#d7ff3a;color:#10140a;font-size:.62rem;font-weight:900;letter-spacing:.06em;cursor:pointer}
  .mo-prev.mockup{position:relative;background:#eef0ea}.mo-tag{position:absolute;top:8px;left:8px;padding:3px 9px;border-radius:999px;background:#d7ff3a;color:#10140a;font-size:.58rem;font-weight:900;letter-spacing:.1em}
  .ft-mock .ft-mockimg{display:grid;place-items:center;border-radius:16px;background:linear-gradient(180deg,#f4f6f1,#e2e6dc);padding:10px;cursor:zoom-in}.ft-mock .ft-mockimg img{max-width:100%;max-height:84vh;object-fit:contain;border-radius:10px;display:block}
  .ft-mockacc{display:flex;gap:8px;flex-wrap:wrap}.ft-drop{display:grid;gap:8px;justify-items:center;text-align:center;padding:28px 18px;border:2px dashed #4b6a2b;border-radius:16px;background:#0f1a0b}
  .ft-drop b{font-size:1rem}.ft-drop span{font-size:.82rem;color:#9fb09a}.ft-drop.sobre{background:#1a2d10;border-color:#d7ff3a}
  .tab[data-kind='molderia'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='molderia']){display:none!important}}
  body:has(.panel[data-panel='molderia'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important}
  @media(max-width:700px){.mo-head{padding:16px}.mo-head h2{font-size:1.3rem}.mo-grid{grid-template-columns:1fr}.mo-bar input[type=search]{min-width:0;width:100%}.ft-banda h3{font-size:1.7rem}.ft-lista div{grid-template-columns:1fr}.ft-gal.grande{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  // ------------------------------------------------------------------ FICHAS (por REF, con la plantilla de Indoor)
  const tabla = (cabeceras, filas) => '<div class="ft-scroll"><table class="ft-tabla"><thead><tr>' + cabeceras.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    filas.map(f => '<tr>' + f.map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  const galeria = (f, zona, grande) => {
    const l = (f.imagenes || []).filter(i => i.zona === zona);
    return l.length ? '<div class="ft-gal' + (grande ? ' grande' : '') + '">' + l.map(i => '<a href="' + imgUrl(f.id, i.archivo) + '" target="_blank" rel="noopener"><img loading="lazy" alt="" src="' + imgUrl(f.id, i.archivo) + '"></a>').join('') + '</div>' : '';
  };

  const tallasDe = f => {
    const set = new Set();
    (f.tallajes || []).forEach(t => (t.tallas || []).forEach(x => set.add(String(x).toUpperCase())));
    ((f.consumos || {}).grupos || []).forEach(g => (g.tallas || []).forEach(x => set.add(String(x).toUpperCase())));
    return [...set].sort((a, b) => ORDEN_TALLAS.indexOf(a) - ORDEN_TALLAS.indexOf(b));
  };
  const valorEn = (tallas, valores, t) => { const i = (tallas || []).findIndex(x => String(x).toUpperCase() === t); return i >= 0 ? valores[i] : ''; };
  function tarjetaTalla(f) {
    const t = st.talla; if (!t) return '';
    const cel = [];
    (f.tallajes || []).forEach(g => {
      const ancho = valorEn(g.tallas, g.ancho || [], t), alto = valorEn(g.tallas, g.alto || [], t);
      if (ancho || alto) cel.push('<div><small>' + esc(g.titulo.replace(/^MEDIDAS TALLAJE\s*/i, '')) + '</small><b>' + esc(ancho || '—') + ' × ' + esc(alto || '—') + '</b><span>ancho × alto (cm)</span></div>');
    });
    ((f.consumos || {}).grupos || []).forEach(g => { const v = valorEn(g.tallas, g.valores || [], t); if (v) cel.push('<div><small>CONSUMO ' + esc(g.grupo) + '</small><b>' + esc(v) + ' MTS</b><span>por prenda</span></div>'); });
    (f.medidas_insumos || []).forEach(m => { const v = valorEn(m.tallas, m.medidas || [], t); if (v) cel.push('<div><small>' + esc(m.titulo.replace(/^MEDIDA\s*/i, '')) + '</small><b>' + esc(v) + '</b><span>cm</span></div>'); });
    return '<div class="ft-tcard"><div><small>TALLA SELECCIONADA</small><b>' + esc(t) + '</b><span>' + (cel.length ? 'resumen de esta talla' : 'sin datos para esta talla') + '</span></div>' + cel.join('') + '</div>';
  }
  function calculadora(f) {
    const gs = ((f.consumos || {}).grupos || []);
    if (!gs.length) return '';
    const guardada = st.calc[f.ref] || {};
    return '<div class="ft-sec" data-sec="Calculadora"><h4>CALCULADORA DE MTS<span class="fl">▾</span></h4><div class="ft-calc">' +
      '<p class="ft-nota">Escribe cuántas prendas de cada talla: el total de tela sale con el consumo del maestro.</p>' +
      gs.map((g, gi) => '<div class="fila"><b>' + esc(g.grupo) + '</b><div class="campos">' + g.tallas.map((t, ti) => g.valores[ti] ? '<label>' + esc(t) + '<input type="number" min="0" inputmode="numeric" data-calc="' + gi + ':' + ti + '" value="' + esc(guardada[gi + ':' + ti] || '') + '"></label>' : '').join('') + '</div></div>').join('') +
      '<div class="ft-total"><b data-calc-total>0</b><span>MTS en total</span><span data-calc-prendas>0 prendas</span><button type="button" class="mo-btn" data-calc-limpiar>Limpiar</button></div></div></div>';
  }
  function recalcular() {
    const f = st.ficha; if (!f || !panel) return;
    const gs = ((f.consumos || {}).grupos || []); let total = 0, prendas = 0; const mem = {};
    panel.querySelectorAll('[data-calc]').forEach(inp => {
      const [gi, ti] = inp.dataset.calc.split(':').map(Number); const n = parseFloat(inp.value) || 0; if (inp.value) mem[inp.dataset.calc] = inp.value;
      total += n * (parseFloat(gs[gi].valores[ti]) || 0); prendas += n;
    });
    st.calc[f.ref] = mem;
    const a = panel.querySelector('[data-calc-total]'), b = panel.querySelector('[data-calc-prendas]');
    if (a) a.textContent = total.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (b) b.textContent = prendas + (prendas === 1 ? ' prenda' : ' prendas');
  }
  function resaltarTalla() {
    panel.querySelectorAll('.ft-tallas .hl').forEach(x => x.classList.remove('hl'));
    if (!st.talla) return;
    panel.querySelectorAll('.ft-tallas').forEach(tb => {
      const ths = [...tb.querySelectorAll('thead th')]; const i = ths.findIndex(th => th.textContent.trim().toUpperCase() === st.talla);
      if (i < 0) return;
      ths[i].classList.add('hl'); tb.querySelectorAll('tbody tr').forEach(tr => { const c = tr.children[i]; if (c) c.classList.add('hl'); });
    });
  }
  const filaChk = (f, sec, i, html, extra) => {
    const k = f.id + '|' + sec + '|' + i, hecho = !!st.chk[k];
    return '<div class="ft-chk' + (hecho ? ' hecho' : '') + '"><input type="checkbox" data-chk="' + esc(k) + '" data-sec-chk="' + sec + '"' + (hecho ? ' checked' : '') + '>' + html + '</div>';
  };
  const progreso = (f, sec, total) => {
    const hechos = Object.keys(st.chk).filter(k => k.startsWith(f.id + '|' + sec + '|') && st.chk[k]).length;
    return '<div class="ft-prog" data-prog="' + sec + '" data-total="' + total + '"><span>' + hechos + '/' + total + '</span><i><s style="width:' + (total ? Math.round(hechos / total * 100) : 0) + '%"></s></i><button type="button" class="mo-chip" data-chk-reset="' + sec + '">Reiniciar</button></div>';
  };

  function vistaFicha() {
    const f = st.ficha;
    if (!f) return '<div class="mo-vacio">Cargando la ficha…</div>';
    const prom = (f.promedios || []).filter(p => Object.values(p.valores || {}).some(v => v !== '')).map(p => '<div class="ft-dato"><small>' + esc(p.nombre) + ' · MTS POR PRENDA</small><div class="ft-prom">' +
      Object.entries(p.valores || {}).filter(([, v]) => v !== '').map(([k, v]) => '<div><em>' + esc(v) + '</em><span>' + esc(NOMBRE_GRUPO[k] || k.toUpperCase()) + '</span></div>').join('') + '</div></div>').join('');
    const telasOk = (f.telas || []).filter(t => String(t.tela || '').replace(/[-\s]/g, '') !== '');
    const telas = telasOk.length ? '<div class="ft-dato"><small>TELAS RECOMENDADAS</small>' + telasOk.map(t => '<div class="ft-tela"><em>' + esc(t.material) + '</em><span>' + esc(t.tela) + '</span></div>').join('') + '</div>' : '';
    const secciones = [];
    // fit y piezas
    const fotoPiezas = galeria(f, 'piezas');
    if (fotoPiezas || (f.piezas || []).length || (f.fit || []).length)
      secciones.push('<div class="ft-sec" data-sec="Fit y piezas"><h4>FIT DE LA PRENDA · PIEZA POR PIEZA<span class="fl">▾</span></h4>' + (f.fit || []).map(x => '<p class="ft-nota"><b>' + esc(x.titulo) + '</b>' + (x.nota ? ' — ' + esc(x.nota) : '') + '</p>').join('') + fotoPiezas +
        ((f.piezas || []).length ? '<div class="ft-piezas">' + f.piezas.map(p => '<span>' + esc(p) + '</span>').join('') + '</div>' : '') + '</div>');
    const mock = galeria(f, 'mockup', true), fis = galeria(f, 'fisica', true);
    if (mock || fis) secciones.push('<div class="ft-sec" data-sec="Mockup"><h4>IMAGEN DIGITAL (MOCKUP) E IMAGEN FÍSICA<span class="fl">▾</span></h4>' + mock + fis + '</div>');
    // consumo de tela por talla (Promedios maestros)
    if (f.consumos && (f.consumos.grupos || []).length) secciones.push('<div class="ft-sec" data-sec="Consumo"><h4>CONSUMO DE TELA POR PRENDA (MTS)<span class="fl">▾</span></h4>' + f.consumos.grupos.map(g => '<div class="ft-scroll"><table class="ft-tabla ft-tallas"><thead><tr><th>' + esc(g.grupo) + '</th>' +
      g.tallas.map(x => '<th class="t">' + esc(x) + '</th>').join('') + '</tr></thead><tbody><tr><td class="l">MTS</td>' + g.valores.map(v => '<td class="n">' + esc(v || '—') + '</td>').join('') + '</tr></tbody></table></div>').join('') +
      '<p class="ft-nota">Promedio del maestro: <b>' + esc(f.consumos.promedio) + ' MTS</b>' + ((f.consumos.plantillas || []).length ? ' · Plantillas: ' + esc(f.consumos.plantillas.join(', ')) : '') + '</p></div>');
    const calc = calculadora(f);
    if (calc) secciones.push(calc);
    // tallaje
    if ((f.tallajes || []).length) secciones.push('<div class="ft-sec" data-sec="Medidas"><h4>MEDIDAS DE LA PRENDA TERMINADA (CM)<span class="fl">▾</span></h4>' + f.tallajes.map(t => '<div><p class="ft-nota"><b>' + esc(t.titulo) + '</b></p><div class="ft-scroll"><table class="ft-tabla ft-tallas"><thead><tr><th></th>' +
      t.tallas.map(x => '<th class="t">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
      [['ancho', 'ANCHO (X)'], ['alto', 'ALTO (Y)'], ['largo', 'LARGO']].filter(([k]) => t[k]).map(([k, n]) => '<tr><td class="l">' + n + '</td>' + t[k].map(v => '<td class="n">' + esc(v) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' + (t.nota ? '<p class="ft-nota">' + esc(t.nota) + '</p>' : '') + '</div>').join('') + '</div>');
    // descripción
    if ((f.descripcion || []).length) secciones.push('<div class="ft-sec" data-sec="Descripción"><h4>DESCRIPCIÓN<span class="fl">▾</span></h4><div class="ft-desc">' + f.descripcion.map(d => '<div><b>' + esc(d.n) + '</b><span>' + esc(d.texto) + '</span></div>').join('') + '</div></div>');
    // insumos
    if ((f.insumos || []).length || (f.medidas_insumos || []).length) {
      const prevIns = galeria(f, 'insumos');
      secciones.push('<div class="ft-sec" data-sec="Insumos"><h4>INSUMOS REQUERIDOS<span class="fl">▾</span></h4>' +
        ((f.insumos || []).length ? tabla(['NOMBRE', 'TIPO', 'COLOR', 'MEDIDA', 'CANT', 'OBSERVACIÓN'], f.insumos.map(i => [i.nombre, i.tipo, i.color, i.medida, i.cant, i.observacion])) : '') +
        (f.medidas_insumos || []).map(m => '<div><p class="ft-nota"><b>' + esc(m.titulo) + '</b></p><div class="ft-scroll"><table class="ft-tabla ft-tallas"><thead><tr><th></th>' + m.tallas.map(x => '<th class="t">' + esc(x) + '</th>').join('') + '</tr></thead><tbody><tr><td class="l">MEDIDA</td>' + (m.medidas || []).map(v => '<td class="n">' + esc(v) + '</td>').join('') + '</tr></tbody></table></div></div>').join('') + prevIns + '</div>');
    }
    // confección
    if ((f.confeccion || []).length) {
      const v = f.valores_confeccion || {};
      secciones.push('<div class="ft-sec" data-sec="Confección"><h4>CONFECCIÓN<span class="fl">▾</span></h4>' + progreso(f, 'conf', f.confeccion.length) + '<div class="ft-lista">' + f.confeccion.map((c, i) => filaChk(f, 'conf', i, '<b>' + esc(c.etiqueta || '') + '</b><span>' + esc(c.valor) + (c.extra ? ' — ' + esc(c.extra) : '') + '</span>')).join('') +
        Object.entries(v).filter(([, x]) => x).map(([k, x]) => '<div><b>' + esc(k.toUpperCase()) + '</b><span>' + esc(x) + '</span></div>').join('') + '</div>' + galeria(f, 'lupa') + '</div>');
    }
    // terminación y empaque
    if ((f.terminacion || []).length || (f.empaque_insumos || []).length)
      secciones.push('<div class="ft-sec" data-sec="Empaque"><h4>TERMINACIÓN Y EMPAQUE<span class="fl">▾</span></h4>' + ((f.terminacion || []).length ? progreso(f, 'emp', f.terminacion.length) + '<div class="ft-lista simple">' + f.terminacion.map((t, i) => filaChk(f, 'emp', i, '<span>' + esc(t) + '</span>')).join('') + '</div>' : '') +
        ((f.empaque_insumos || []).length ? tabla(['NOMBRE', 'TIPO', 'COLOR', 'MEDIDA', 'CANT', 'OBSERVACIÓN'], f.empaque_insumos.map(i => [i.nombre, i.tipo, i.color, i.medida, i.cant, i.observacion])) : '') + '</div>');
    const otras = galeria(f, 'otras');
    if (otras) secciones.push('<div class="ft-sec"><h4>OTRAS IMÁGENES</h4>' + otras + '</div>');
    const mockHtml = st.mockups[f.ref]
      ? '<div class="ft-sec ft-mock" data-sec="Mockup de referencia"><h4>MOCKUP DE REFERENCIA · ' + esc(f.ref) + '<span class="fl">▾</span></h4><a href="' + mockUrl(f.ref) + '" class="ft-mockimg" data-ampliar><img alt="Mockup de referencia de ' + esc(f.ref) + '" src="' + mockUrl(f.ref) + '"></a>' +
        '<div class="ft-mockacc"><button type="button" class="mo-btn" data-mock-subir="' + esc(f.ref) + '">⟳ Cambiar mockup</button><button type="button" class="mo-btn" data-mock-quitar="' + esc(f.ref) + '">🗑 Quitar</button></div></div>'
      : '<div class="ft-sec ft-mock vacio" data-sec="Mockup de referencia"><h4>MOCKUP DE REFERENCIA · ' + esc(f.ref) + '</h4><div class="ft-drop" data-mock-zona="' + esc(f.ref) + '"><b>Esta REF todavía no tiene mockup</b><span>Arrastra aquí la imagen (JPG, PNG o WEBP) o elígela</span>' +
        '<button type="button" class="mo-btn pri" data-mock-subir="' + esc(f.ref) + '">⬆ Subir mockup de ' + esc(f.ref) + '</button></div></div>';
    secciones.unshift(mockHtml);
    const menu = secciones.map(x => (x.match(/data-sec="([^"]+)"/) || [])[1]).filter(Boolean);
    const sesenta = (f.imagenes || []).length;
    const tallas = tallasDe(f);
    const selTalla = tallas.length ? '<div class="ft-tallasel"><small>TALLA</small><button type="button" class="mo-chip' + (!st.talla ? ' on' : '') + '" data-talla="">Todas</button>' + tallas.map(t => '<button type="button" class="mo-chip' + (st.talla === t ? ' on' : '') + '" data-talla="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' : '';
    const cerrar = x => { const n = (x.match(/data-sec="([^"]+)"/) || [])[1]; return n && st.cerradas[n] ? x.replace('class="ft-sec', 'class="ft-sec cerrada') : x; };
    secciones.forEach((x, i) => { secciones[i] = cerrar(x); });
    const pos = st.ids.indexOf(f.id);
    return '<div class="ft"><div class="ft-top"><button type="button" class="mo-btn" data-volver>← Todas las REF</button>' +
      (pos >= 0 ? '<button type="button" class="mo-btn" data-nav="-1" title="Ficha anterior (←)">‹</button><button type="button" class="mo-btn" data-nav="1" title="Ficha siguiente (→)">›</button>' : '') +
      '<div class="ft-nav">' + menu.map(m => '<button type="button" class="mo-chip" data-ir-sec="' + esc(m) + '">' + esc(m) + '</button>').join('') + '</div>' +
      '<span class="ft-der"><button type="button" class="mo-btn pri" data-ficha-indoor="' + esc(f.ref) + '">✦ Ficha Indoor</button><button type="button" class="mo-btn" data-todo="cerrar">Contraer todo</button><button type="button" class="mo-btn" data-todo="abrir">Expandir todo</button><button type="button" class="mo-btn" data-imprimir>🖨 Imprimir</button>' +
      '<a class="mo-btn" href="/api/molderia/archivo?tab=fichas&ruta=' + encodeURIComponent('FICHAS TECNICAS/' + f.archivo) + '&descargar=1" download>⬇ Excel original</a></span></div>' +
      '<div class="ft-banda"><div class="ft-id"><div class="ft-ref">' + esc(f.ref) + '</div><div><small>FICHA TÉCNICA · ' + esc(f.familia) + '</small><p class="ft-prenda">' + esc(f.prenda) + '</p>' +
      '<p class="ft-sub">' + (f.referencia ? 'Referencia ' + esc(f.referencia) + ' · ' : '') + esc(f.hoja) + ' · ' + sesenta + ' imágenes</p></div></div>' +
      (f.nota_prenda ? '<p class="ft-nota">' + esc(f.nota_prenda) + '</p>' : '') +
      '<div class="ft-datos">' + prom + telas + '</div>' + (f.nota_promedio ? '<p class="ft-nota">' + esc(f.nota_promedio) + '</p>' : '') + '</div>' + selTalla + tarjetaTalla(f) + secciones.join('') + '</div>';
  }

  function vistaRefs() {
    const idx = st.fichas;
    const imp = st.imp || {};
    const estado = imp.importando ? 'Importando… ' + esc(imp.progreso || '') : (idx && idx.actualizado ? 'Importadas ' + (idx.fichas || []).length + ' fichas · ' + hora(idx.actualizado) : 'Aún no se han importado');
    const familias = idx ? [...new Set((idx.fichas || []).map(f => f.familia))] : [];
    const q = plano(st.buscar);
    let lista = idx ? (idx.fichas || []).filter(f => (!st.familia || f.familia === st.familia) && (!st.soloFav || st.fav.has(f.id)) && (!q || plano(f.ref + ' ' + f.prenda + ' ' + f.hoja + ' ' + f.familia).includes(q))) : [];
    if (st.orden === 'imagenes') lista = [...lista].sort((a, b) => b.imagenes - a.imagenes);
    else if (st.orden === 'prenda') lista = [...lista].sort((a, b) => a.prenda.localeCompare(b.prenda) || a.ref.localeCompare(b.ref));
    st.ids = lista.map(f => f.id);
    const recientes = (st.rec || []).map(id => idx && (idx.fichas || []).find(f => f.id === id)).filter(Boolean);
    const barra = '<div class="mo-bar"><input type="search" data-buscar placeholder="Buscar REF o prenda (CA02, FUT01, chaqueta…)" value="' + esc(st.buscar) + '">' +
      '<select data-orden title="Ordenar"><option value="ref"' + (st.orden === 'ref' ? ' selected' : '') + '>Orden: REF</option><option value="prenda"' + (st.orden === 'prenda' ? ' selected' : '') + '>Orden: prenda</option><option value="imagenes"' + (st.orden === 'imagenes' ? ' selected' : '') + '>Orden: más imágenes</option></select>' +
      '<span class="mo-meta">' + estado + '</span></div>';
    const chips = familias.length ? '<div class="mo-chips"><button type="button" class="mo-chip' + (!st.familia ? ' on' : '') + '" data-fam="">TODAS</button>' + familias.map(f => '<button type="button" class="mo-chip' + (st.familia === f ? ' on' : '') + '" data-fam="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div>' : '';
    let cuerpo;
    if (!idx) cuerpo = '<div class="mo-vacio">Cargando…</div>';
    else if (!(idx.fichas || []).length) cuerpo = '<div class="mo-vacio">Todavía no hay fichas.</div>';
    else cuerpo = lista.length ? '<div class="mo-grid">' + lista.map(f => {
      const prom = Object.entries(f.promedio || {}).filter(([, v]) => v !== '' && v !== 'X').map(([k, v]) => '<span>' + esc(NOMBRE_GRUPO[k] || k) + ' ' + esc(v) + '</span>').join('');
      return '<button type="button" class="mo-card mo-ref" data-ficha="' + esc(f.id) + '"><span class="mo-star' + (st.fav.has(f.id) ? ' on' : '') + '" role="button" data-fav="' + esc(f.id) + '" title="Marcar como favorita">' + (st.fav.has(f.id) ? '★' : '☆') + '</span>' + (st.mockups[f.ref] ? '<div class="mo-prev mockup"><img loading="lazy" alt="" src="' + mockUrl(f.ref) + '"><span class="mo-tag">MOCKUP</span></div>' : '<div class="sinimg"><span>SIN MOCKUP</span><span class="mo-nas" role="button" data-nas-ref="' + esc(f.ref) + '">🔎 Buscar en el NAS</span></div>') +
        '<div class="mo-in"><h4>' + esc(f.hoja.length <= 14 ? f.hoja : f.ref) + '</h4><p>' + esc(f.prenda) + '</p><span class="mo-meta">' + esc(f.familia) + ' · ' + f.imagenes + ' imágenes</span>' + (prom ? '<div class="mo-prom">' + prom + '</div>' : '') + '</div></button>';
    }).join('') + '</div>' : '<div class="mo-vacio">Nada coincide con la búsqueda.</div>';
    const recHtml = recientes.length ? '<div class="mo-rec"><small>RECIENTES</small>' + recientes.map(f => '<button type="button" class="mo-chip" data-ficha="' + esc(f.id) + '">' + esc(f.ref) + '</button>').join('') + '</div>' : '';
    return barra + recHtml + chips + cuerpo;
  }

  async function cargarFichas() {
    try {
      const j = await api('/api/molderia/fichas');
      st.fichas = j; st.imp = j.estado || {}; st.mockups = j.mockups || {};
      if (st.imp.importando) vigilarImportacion();
    } catch (e) { st.error = e.message; }
    pintar();
  }

  function vigilarImportacion() {
    if (relojImp) return;
    relojImp = setInterval(async () => {
      try {
        const j = await api('/api/molderia/fichas');
        st.imp = j.estado || {};
        if (!st.imp.importando) { clearInterval(relojImp); relojImp = null; st.fichas = j; st.mockups = j.mockups || {}; st.mensaje = st.imp.error ? 'Terminó con un aviso: ' + st.imp.error : ''; }
        pintar();
      } catch (e) { clearInterval(relojImp); relojImp = null; }
    }, 2500);
  }

  async function importar() {
    try {
      const j = await api('/api/molderia/fichas/importar', { method: 'POST', body: '{}' });
      st.imp = j.estado || { importando: true }; st.imp.importando = true;
      vigilarImportacion(); pintar();
    } catch (e) { alert(e.message); }
  }

  function navegarFicha(d) {
    if (!st.ids.length) return;
    const i = st.ids.indexOf(st.ficha && st.ficha.id); const n = st.ids[(i + d + st.ids.length) % st.ids.length];
    abrirFicha(n);
  }
  document.addEventListener('keydown', e => {
    if (!panel || !panel.classList.contains('active') || e.target.matches('input,textarea,select') || document.querySelector('.mo-luz')) return;
    if (st.tab === 'fichas' && st.modo === 'ficha') { if (e.key === 'ArrowRight') navegarFicha(1); else if (e.key === 'ArrowLeft') navegarFicha(-1); else if (e.key === 'Escape') { st.modo = 'refs'; pintar(); } }
    else if (st.tab === 'fichas' && st.modo === 'refs' && e.key === '/') { e.preventDefault(); const c = panel.querySelector('[data-buscar]'); if (c) c.focus(); }
  });

  // La galería abre la ficha con el diseño de «Líneas de producto» (modal Indoor); la página completa queda como «Vista completa»
  function abrirIndoor(id) {
    const e = st.fichas && (st.fichas.fichas || []).find(x => x.id === id);
    st.rec = [id, ...(st.rec || []).filter(x => x !== id)].slice(0, 8); guardar('mo_rec', st.rec);
    if (e && window.abrirFichaResumen) window.abrirFichaResumen(e.ref, '', id); else abrirFicha(id);
  }
  // Desde la ficha técnica: abre el explorador en la carpeta de moldes (Illustrator) de esa referencia, ya filtrada
  window.molderiaAbrirMolde = async ref => {
    if (!tab) return;
    let j = { ruta: 'ILLUSTRATOR (EDICION)', archivos: [] };
    st.ctx = 'molderia'; st.tab = 'molderia'; st.modo = 'refs'; st.ruta = j.ruta; st.buscar = ''; st.datos = null; st.error = ''; st.espera = true;
    tab.click();
    try { j = await api('/api/molderia/molde-ref?ref=' + encodeURIComponent(ref)); } catch (e) { /* se abre la carpeta general */ }
    st.espera = false; st.ruta = j.ruta; st.buscar = j.archivos.length ? ref : '';
    await cargar();
    if (!j.archivos.length) alert('No encontré el molde de ' + ref + ' en ILLUSTRATOR (EDICION). Te dejo en la carpeta para que lo busques.');
  };
  window.molderiaAbrirPagina = id => { if (!tab) return; if (st.ctx !== 'estandar') window.molderiaIr('estandar'); abrirFicha(id); };
  window.addEventListener('fichas-mockup', () => { if (panel && st.tab === 'fichas') cargarFichas(); });

  async function abrirFicha(id) {
    st.rec = [id, ...(st.rec || []).filter(x => x !== id)].slice(0, 8); guardar('mo_rec', st.rec);
    st.modo = 'ficha'; st.ficha = null; pintar();
    try { st.ficha = await api('/api/molderia/ficha?id=' + encodeURIComponent(id)); } catch (e) { st.modo = 'refs'; alert(e.message); }
    pintar(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ explorador de carpetas
  function vistaExplorador() {
    const d = st.datos;
    const partes = d ? d.partes || [] : [];
    const mig = '<div class="mo-mig"><button type="button" data-ir="">Inicio</button>' +
      partes.map((p, i) => '<span>›</span>' + (i === partes.length - 1 ? '<b>' + esc(p) + '</b>' : '<button type="button" data-ir="' + esc(partes.slice(0, i + 1).join('/')) + '">' + esc(p) + '</button>')).join('') + '</div>';
    const volver = st.tab === 'fichas' ? '<button type="button" class="mo-btn" data-refs>← Fichas por REF</button>' : '';
    const barra = '<div class="mo-bar">' + volver + mig + '<input type="search" data-buscar placeholder="Buscar en esta carpeta…" value="' + esc(st.buscar) + '"></div>';
    let cuerpo;
    if (st.cargando && !d) cuerpo = '<div class="mo-vacio">Cargando…</div>';
    else if (st.error) cuerpo = '<div class="mo-vacio">' + esc(st.error) + '</div>';
    else {
      const q = plano(st.buscar);
      const lista = (d ? d.entradas : []).filter(e => !q || plano(e.nombre).includes(q));
      cuerpo = lista.length ? '<div class="mo-grid">' + lista.map(e => {
        if (e.carpeta) return '<button type="button" class="mo-card" data-dir="' + esc(e.ruta) + '"><div class="mo-top"><span class="mo-ico dir">📁</span><b>' + esc(e.nombre) + '</b></div><span class="mo-meta">Carpeta' + (e.modificado ? ' · ' + fecha(e.modificado) : '') + '</span></button>';
        const ic = ICONO[e.ext] || [(e.ext || 'ARCH').toUpperCase().slice(0, 4), '#9fb09a'];
        return '<div class="mo-card" data-file="' + esc(e.ruta) + '"><div class="mo-top"><span class="mo-ico" style="color:' + ic[1] + '">' + esc(ic[0]) + '</span><b>' + esc(e.nombre) + '</b></div>' +
          (IMG.has(e.ext) && e.bytes < 4194304 ? '<div class="mo-prev"><img loading="lazy" alt="" src="' + url(e.ruta) + '"></div>' : '') +
          '<span class="mo-meta">' + peso(e.bytes) + ' · ' + fecha(e.modificado) + '</span><div class="mo-acc"><a href="' + url(e.ruta) + '" target="_blank" rel="noopener">ABRIR ↗</a><a href="' + url(e.ruta, true) + '" download>DESCARGAR ⬇</a></div></div>';
      }).join('') + '</div>' : '<div class="mo-vacio">' + (q ? 'Nada coincide con la búsqueda.' : 'Esta carpeta está vacía.') + '</div>';
    }
    return barra + cuerpo;
  }

  function pintar() {
    const host = panel.querySelector('.mo');
    const cab = st.ctx === 'estandar' ? '' : '<div class="mo-head"><div><small>PRODUCCIÓN</small><h2>MOLDERIA</h2></div></div>';
    const foco = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-buscar]');
    const cuerpo = st.tab === 'fichas' ? (st.modo === 'ficha' ? vistaFicha() : st.modo === 'archivos' ? vistaExplorador() : vistaRefs()) : vistaExplorador();
    host.innerHTML = cab + cuerpo;
    if (foco) { const c = host.querySelector('[data-buscar]'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } }
    if (st.tab === 'fichas' && st.modo === 'ficha' && st.ficha) { resaltarTalla(); recalcular(); }
  }

  async function cargar() {
    if (st.tab === 'fichas' && st.modo !== 'archivos') return cargarFichas();
    if (st.espera) { st.cargando = true; pintar(); return; }   // se está ubicando el molde de una referencia
    st.cargando = true; st.error = '';
    try {
      const r = await fetch('/api/molderia/lista?tab=' + encodeURIComponent(st.tab) + '&ruta=' + encodeURIComponent(st.ruta), { cache: 'no-store', credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No pude abrir la carpeta');
      st.datos = j; st.ruta = j.ruta;
    } catch (e) { st.error = e.message; st.datos = null; }
    st.cargando = false; pintar();
  }

  function elegirMockup(ref) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
    inp.addEventListener('change', () => { if (inp.files[0]) subirMockup(ref, inp.files[0]); });
    inp.click();
  }
  async function subirMockup(ref, archivo) {
    if (!/^image\//.test(archivo.type)) { alert('Elige una imagen (JPG, PNG o WEBP).'); return; }
    try {
      const r = await fetch('/api/molderia/mockup?ref=' + encodeURIComponent(ref), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No pude guardar el mockup');
      st.mockups = (await api('/api/molderia/fichas')).mockups || {}; pintar();
    } catch (e) { alert(e.message); }
  }
  async function quitarMockup(ref) {
    if (!confirm('¿Quitar el mockup de ' + ref + '?')) return;
    try { await api('/api/molderia/mockup?ref=' + encodeURIComponent(ref), { method: 'DELETE' }); st.mockups = (await api('/api/molderia/fichas')).mockups || {}; pintar(); } catch (e) { alert(e.message); }
  }

  function ampliar(src) {
    const lista = [...new Set([...panel.querySelectorAll('.ft-gal a, [data-ampliar]')].map(a => a.href))];
    let k = Math.max(0, lista.findIndex(x => x === new URL(src, location.href).href)); if (!lista.length) lista.push(src);
    const luz = document.createElement('div'); luz.className = 'mo-luz';
    luz.innerHTML = '<div class="zona"><img alt=""></div><div class="ctl"><button type="button" data-v="-1">‹</button><span></span><button type="button" data-v="1">›</button><button type="button" data-v="zoom" title="Acercar">🔍</button><button type="button" data-v="x">✕</button></div>';
    const im = luz.querySelector('img'), cont = luz.querySelector('.ctl span');
    const ver = () => { im.src = lista[k]; im.classList.remove('zoom'); cont.textContent = (k + 1) + ' / ' + lista.length; };
    const cerrar = () => { luz.remove(); document.removeEventListener('keydown', tecla, true); };
    const mover = d => { k = (k + d + lista.length) % lista.length; ver(); };
    const tecla = ev => { if (ev.key === 'Escape') cerrar(); else if (ev.key === 'ArrowRight') { ev.stopPropagation(); mover(1); } else if (ev.key === 'ArrowLeft') { ev.stopPropagation(); mover(-1); } };
    luz.addEventListener('click', ev => {
      const b = ev.target.closest('[data-v]');
      if (b) { const v = b.dataset.v; if (v === 'x') cerrar(); else if (v === 'zoom') im.classList.toggle('zoom'); else mover(+v); }
      else if (ev.target === im) im.classList.toggle('zoom');
      else if (ev.target === luz) cerrar();
    });
    document.addEventListener('keydown', tecla, true); document.body.appendChild(luz); ver();
  }

  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="produccion"]')?.closest('.nav-group') || document.querySelector('nav.tabs .nav-group:last-child');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="molderia"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'molderia';
    panel.innerHTML = '<div class="mo"></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="molderia" type="button"><span class="nav-icon">MO</span><strong>MOLDERIA</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    // ctx: 'estandar' (fichas técnicas, dentro de ESTÁNDAR 2026) o 'molderia' (explorador de carpetas)
    window.molderiaCtx = () => st.ctx;
    window.molderiaIr = ctx => {
      st.ctx = ctx; st.tab = ctx === 'estandar' ? 'fichas' : 'molderia'; st.modo = 'refs'; st.ruta = ''; st.buscar = ''; st.datos = null; st.error = '';
      tab.click();
    };
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      pintar(); cargar();
    });
    panel.addEventListener('click', e => {
      const nas = e.target.closest('[data-nas-ref]');
      if (nas) { e.preventDefault(); e.stopPropagation(); if (window.fichasBuscarMockup) window.fichasBuscarMockup(nas.dataset.nasRef, () => cargarFichas()); return; }
      const estrella = e.target.closest('[data-fav]');
      if (estrella) { e.preventDefault(); e.stopPropagation(); const id = estrella.dataset.fav; st.fav.has(id) ? st.fav.delete(id) : st.fav.add(id); guardar('mo_fav', [...st.fav]); pintar(); return; }
      const t = e.target.closest('[data-t]'), ir = e.target.closest('[data-ir]'), dir = e.target.closest('[data-dir]'), ficha = e.target.closest('[data-ficha]');
      if (ficha) abrirIndoor(ficha.dataset.ficha);
      else if (e.target.closest('[data-volver]')) { st.modo = 'refs'; st.ficha = null; pintar(); }
      else if (e.target.closest('[data-importar]')) importar();
      else if (e.target.closest('[data-solo-fav]')) { st.soloFav = !st.soloFav; pintar(); }
      else if (e.target.closest('[data-talla]')) { st.talla = e.target.closest('[data-talla]').dataset.talla; pintar(); }
      else if (e.target.closest('[data-todo]')) { const abrir = e.target.closest('[data-todo]').dataset.todo === 'abrir'; panel.querySelectorAll('.ft-sec[data-sec]').forEach(x => { st.cerradas[x.dataset.sec] = !abrir; }); pintar(); }
      else if (e.target.closest('.ft-sec > h4')) { const sec = e.target.closest('.ft-sec'); if (sec.dataset.sec) { st.cerradas[sec.dataset.sec] = !st.cerradas[sec.dataset.sec]; sec.classList.toggle('cerrada', !!st.cerradas[sec.dataset.sec]); } }
      else if (e.target.closest('[data-nav]')) navegarFicha(+e.target.closest('[data-nav]').dataset.nav);
      else if (e.target.closest('[data-calc-limpiar]')) { st.calc[st.ficha.ref] = {}; panel.querySelectorAll('[data-calc]').forEach(x => { x.value = ''; }); recalcular(); }
      else if (e.target.closest('[data-chk-reset]')) { const sec = e.target.closest('[data-chk-reset]').dataset.chkReset; Object.keys(st.chk).filter(k => k.startsWith(st.ficha.id + '|' + sec + '|')).forEach(k => delete st.chk[k]); guardar('mo_chk', st.chk); pintar(); }
      else if (e.target.closest('[data-ficha-indoor]')) { if (window.abrirFichaResumen) window.abrirFichaResumen(e.target.closest('[data-ficha-indoor]').dataset.fichaIndoor); }
      else if (e.target.closest('[data-imprimir]')) window.print();
      else if (e.target.closest('[data-mock-subir]')) elegirMockup(e.target.closest('[data-mock-subir]').dataset.mockSubir);
      else if (e.target.closest('[data-mock-quitar]')) quitarMockup(e.target.closest('[data-mock-quitar]').dataset.mockQuitar);
      else if (e.target.closest('[data-ampliar]')) { e.preventDefault(); ampliar(e.target.closest('[data-ampliar]').href); }
      else if (e.target.closest('[data-ir-sec]')) { const n = e.target.closest('[data-ir-sec]').dataset.irSec; const d = [...panel.querySelectorAll('[data-sec]')].find(x => x.dataset.sec === n); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (e.target.closest('.ft-gal a')) { e.preventDefault(); ampliar(e.target.closest('.ft-gal a').href); }
      else if (e.target.closest('[data-archivos]')) { st.modo = 'archivos'; st.ruta = ''; st.buscar = ''; st.datos = null; pintar(); cargar(); }
      else if (e.target.closest('[data-refs]')) { st.modo = 'refs'; st.buscar = ''; pintar(); cargar(); }
      else if (e.target.closest('[data-fam]')) { st.familia = e.target.closest('[data-fam]').dataset.fam; pintar(); }
      else if (ir) { st.ruta = ir.dataset.ir; st.buscar = ''; cargar(); }
      else if (dir) { st.ruta = dir.dataset.dir; st.buscar = ''; cargar(); }
    });
    panel.addEventListener('dragover', e => { const z = e.target.closest('[data-mock-zona]'); if (z) { e.preventDefault(); z.classList.add('sobre'); } });
    panel.addEventListener('dragleave', e => { const z = e.target.closest('[data-mock-zona]'); if (z) z.classList.remove('sobre'); });
    panel.addEventListener('drop', e => { const z = e.target.closest('[data-mock-zona]'); if (z && e.dataTransfer.files[0]) { e.preventDefault(); z.classList.remove('sobre'); subirMockup(z.dataset.mockZona, e.dataTransfer.files[0]); } });
    panel.addEventListener('change', e => {
      if (e.target.matches('[data-orden]')) { st.orden = e.target.value; pintar(); }
      else if (e.target.matches('[data-chk]')) {
        const k = e.target.dataset.chk; if (e.target.checked) st.chk[k] = 1; else delete st.chk[k]; guardar('mo_chk', st.chk);
        e.target.closest('.ft-chk').classList.toggle('hecho', e.target.checked);
        const sec = e.target.dataset.secChk, caja = e.target.closest('.ft-sec'), pr = caja && caja.querySelector('[data-prog]');
        if (pr) { const total = +pr.dataset.total, h = Object.keys(st.chk).filter(x => x.startsWith(st.ficha.id + '|' + sec + '|')).length; pr.querySelector('span').textContent = h + '/' + total; pr.querySelector('s').style.width = Math.round(h / total * 100) + '%'; }
      }
    });
    panel.addEventListener('input', e => { if (e.target.matches('[data-calc]')) recalcular(); });
    panel.addEventListener('input', e => { if (e.target.matches('[data-buscar]')) { st.buscar = e.target.value; pintar(); } });
    return true;
  }

  // El explorador de carpetas ya no tiene entrada propia en el menú del usuario: se llega por Estándar 2026.
  function addMenuItem() { return !!tab; }

  // Solo quien tiene permiso «Moldería» (Administración/Coordinador y Edición).
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    const p = (mi && mi.permisos && mi.permisos.molderia) || {};
    if (!p.ver) return;
    let intentos = 0;
    const espera = setInterval(() => { if ((build() && addMenuItem()) || ++intentos > 80) clearInterval(espera); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();
