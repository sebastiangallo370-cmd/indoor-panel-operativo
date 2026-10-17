/* Campana de alertas del panel: pedidos atrasados, reprocesos, telas que no alcanzan y (para Administración) ECOMMERCE.
   Tarjetas por urgencia, filtros, búsqueda, «ver la orden» en Producción, copiar, silenciar por hoy y marca de «nuevas». */
(function () {
  if (window.__alertasPanel) return;
  window.__alertasPanel = true;
  const movil = () => innerWidth <= 700;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TIPOS = {
    atrasado: { nombre: 'Atrasados', color: '#ff6b6b', icono: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>' },
    reproceso: { nombre: 'Reprocesos', color: '#ffb04a', icono: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>' },
    tela: { nombre: 'Tela', color: '#6cb6ff', icono: '<path d="M4 6h16v4H4zM6 10v8h12v-8M9 14h6"/>' },
    compra: { nombre: 'Compras', color: '#7ee0c3', icono: '<path d="M4 7h16l-1.5 11H5.5zM8 7a4 4 0 0 1 8 0"/>' },
    ecommerce: { nombre: 'ECOMMERCE', color: '#d0f44c', icono: '<circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/><path d="M3 4h2l2.4 10h10.2L20 7H6.2"/>' }
  };
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } } };
  const hoyClave = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const st = { datos: { alertas: [], total: 0 }, filtro: 'todas', q: '', abierto: false, ultimo: 0, firma: '', vistas: new Set(store.get('indoor-alertas-vistas', [])), silenciadas: store.get('indoor-alertas-silenciadas', {}) };
  const clave = a => [a.tipo, a.orden || '', a.titulo || a.texto || ''].join('|');
  const activas = () => (st.datos.alertas || []).filter(a => st.silenciadas[clave(a)] !== hoyClave());
  const nuevas = () => activas().filter(a => !st.vistas.has(clave(a)));

  const css = document.createElement('style');
  css.textContent = `
  #al-btn{position:fixed;right:16px;bottom:16px;z-index:93;width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:radial-gradient(circle at 30% 25%,#2a3524,#141a11);color:#eef3ea;cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 22px -6px #000c,inset 0 1px 0 rgba(255,255,255,.12);transition:transform .15s,box-shadow .2s}
  #al-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 12px 26px -6px #000d,0 0 0 3px rgba(208,244,76,.18)}
  #al-btn svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;transform-origin:50% 8%}
  #al-btn.suena svg{animation:alSuena 1.1s ease-in-out 2}
  @keyframes alSuena{0%,100%{transform:rotate(0)}15%{transform:rotate(16deg)}30%{transform:rotate(-14deg)}45%{transform:rotate(10deg)}60%{transform:rotate(-8deg)}75%{transform:rotate(4deg)}}
  #al-btn b{position:absolute;top:-5px;right:-5px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#d93636;color:#fff;font:800 11px/22px Arial;text-align:center;border:2px solid #0b0f09}
  #al-btn b.nuevas{background:#ff8a1f;animation:alLate 1.6s infinite}
  @keyframes alLate{0%{box-shadow:0 0 0 0 rgba(255,138,31,.7)}70%{box-shadow:0 0 0 9px rgba(255,138,31,0)}100%{box-shadow:0 0 0 0 rgba(255,138,31,0)}}
  #al-btn b[hidden]{display:none}
  #al-box{position:fixed;right:16px;bottom:78px;z-index:93;width:min(430px,calc(100vw - 24px));max-height:min(78vh,640px);display:none;flex-direction:column;background:linear-gradient(180deg,#151b12,#0e130c);color:#e9efe5;border:1px solid rgba(255,255,255,.16);border-radius:18px;box-shadow:0 22px 50px -12px #000f;font:13px Arial;overflow:hidden}
  #al-box.on{display:flex;animation:alSube .22s cubic-bezier(.2,.8,.2,1)}
  @keyframes alSube{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  .al-cab{display:flex;align-items:center;gap:10px;padding:14px 16px 10px}.al-cab h3{margin:0;font-size:1.05rem;letter-spacing:.04em}.al-cab small{display:block;color:#8f9d88;font-size:.72rem;margin-top:2px}
  .al-cab div:first-child{flex:1}.al-ic{width:32px;height:32px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#c4cfbf;cursor:pointer;display:grid;place-items:center;padding:0}
  .al-ic:hover{background:rgba(255,255,255,.12);color:#fff}.al-ic svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .al-filtros{display:flex;flex-wrap:wrap;gap:6px;padding:2px 16px 10px}
  .al-chip{flex:none;display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;border:1px solid rgba(255,255,255,.16);background:transparent;color:#c4cfbf;font:700 11.5px Arial;cursor:pointer}
  .al-chip i{width:8px;height:8px;border-radius:50%;background:var(--c,#8f9d88)}.al-chip em{font-style:normal;opacity:.75}
  .al-chip.on{background:var(--c,#d0f44c);border-color:var(--c,#d0f44c);color:#10170c}.al-chip.on i{background:#10170c}
  .al-buscar{padding:0 16px 10px}.al-buscar input{width:100%;box-sizing:border-box;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:#0b0f09;color:#eef3ea;font:13px Arial}
  .al-lista{overflow-y:auto;padding:2px 12px 12px;display:grid;gap:8px;align-content:start}
  .al-grupo{margin:6px 4px 0;color:#8f9d88;font-size:.68rem;font-weight:800;letter-spacing:.1em}
  .al-card{position:relative;display:grid;grid-template-columns:34px 1fr;gap:10px;padding:11px 12px 10px;border-radius:13px;border:1px solid rgba(255,255,255,.1);border-left:4px solid var(--c);background:rgba(255,255,255,.04)}
  .al-lista.anima .al-card{animation:alEntra .25s both}
  @keyframes alEntra{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
  .al-card.nueva::after{content:"NUEVA";position:absolute;top:9px;right:10px;font:800 9px Arial;letter-spacing:.08em;color:#10170c;background:#ff8a1f;padding:2px 7px;border-radius:99px}
  .al-tipo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 18%,transparent);color:var(--c)}.al-tipo svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .al-tit{font-weight:800;font-size:.9rem;padding-right:52px;overflow-wrap:anywhere}.al-det{margin-top:3px;color:#aeb9a6;font-size:.78rem;line-height:1.4;overflow-wrap:anywhere}
  .al-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.al-tag{padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.09);font-size:.68rem;font-weight:800}.al-tag.sev{background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--c)}
  .al-acc{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.al-acc button{padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#d9e2d3;font:700 11px Arial;cursor:pointer}
  .al-acc button:hover{background:rgba(255,255,255,.14)}.al-acc button.pri{background:var(--c);border-color:var(--c);color:#10170c}
  .al-vacio{padding:34px 20px;text-align:center;color:#9fb094}.al-vacio b{display:block;font-size:1.6rem;color:#8bd450;margin-bottom:6px}
  .al-error{margin:0 16px 10px;padding:8px 12px;border-radius:9px;background:#5a2a12;color:#ffd9b0;font-size:.78rem}
  /* vidrio sin color; el estado se ve en el aro de luz: rojo alta, naranja media, verde informativa */
  #al-box,#al-btn,.al-card{--r:#ffffff;background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.04))!important;-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);border:1px solid rgba(255,255,255,.22)!important;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px color-mix(in srgb,var(--r) 45%,transparent),0 0 16px -4px var(--r),0 22px 50px -12px #000c}
  #al-box{background:radial-gradient(120% 60% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(180deg,rgba(28,34,26,.82),rgba(12,16,11,.88))!important}
  .al-card{border-left-width:1px!important;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.35),0 0 0 1px color-mix(in srgb,var(--r) 55%,transparent),0 0 14px -4px var(--r)}
  .al-card.sev-alta{--r:#ff4b3e}.al-card.sev-media{--r:#ff9a1f}.al-card.sev-info{--r:#35d46a}
  /* la campana va sola, sin el círculo de vidrio alrededor */
  #al-btn,#al-btn:hover,#al-btn:focus-visible{background:transparent!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;width:46px;height:46px}
  #al-btn svg{width:28px;height:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.65))}
  #al-btn:hover{transform:translateY(-2px) scale(1.08)}
  #al-btn:focus-visible{outline:2px solid rgba(255,255,255,.6);outline-offset:2px;border-radius:50%}
  .al-buscar input,.al-chip{background:rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.2)!important}
  .al-chip.on{background:rgba(255,255,255,.92)!important;color:#10170c!important;border-color:#fff!important}
  .al-acc button{background:rgba(255,255,255,.1)!important;border-color:rgba(255,255,255,.3)!important}
  .al-acc button.pri{background:rgba(255,255,255,.92)!important;color:#10170c!important;border-color:#fff!important}
  @media(max-width:700px){#al-btn{bottom:86px;right:12px}#al-box{right:8px;left:8px;width:auto;bottom:148px;max-height:68vh}}
  @media(prefers-reduced-motion:reduce){#al-btn.suena svg,#al-btn b.nuevas,.al-card,#al-box.on{animation:none}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'al-btn'; btn.type = 'button'; btn.title = 'Alertas'; btn.setAttribute('aria-label', 'Alertas'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><b hidden></b>';
  const box = document.createElement('section');
  box.id = 'al-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Alertas');
  box.innerHTML = '<div class="al-cab"><div><h3>Alertas</h3><small data-sub></small></div>' +
    '<button type="button" class="al-ic" data-refrescar title="Actualizar ahora" aria-label="Actualizar"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg></button>' +
    '<button type="button" class="al-ic" data-vistas title="Marcar todas como vistas" aria-label="Marcar todas como vistas"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></button>' +
    '<button type="button" class="al-ic" data-cerrar title="Cerrar" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    '<div class="al-filtros" data-filtros></div><div class="al-buscar"><input type="search" data-q placeholder="Buscar orden o cliente…" aria-label="Buscar en las alertas"></div><div data-error></div><div class="al-lista" data-lista></div>';
  document.body.appendChild(btn); document.body.appendChild(box);
  const q = s => box.querySelector(s);

  function irAProduccion(orden) {
    document.querySelector('.tab[data-kind="produccion"]')?.click();
    const poner = (n) => {
      const campo = document.getElementById('production-search');
      if (campo) { campo.value = orden; campo.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => document.getElementById('production-table-wrap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 260); }
      else if (n < 8) setTimeout(() => poner(n + 1), 150);
    };
    poner(0);
    cerrar();
  }
  function relativo(seg) { return seg < 5 ? 'ahora' : seg < 60 ? 'hace ' + seg + ' s' : 'hace ' + Math.round(seg / 60) + ' min'; }

  function tarjeta(a, i) {
    const t = TIPOS[a.tipo] || TIPOS.atrasado, esNueva = !st.vistas.has(clave(a));
    const etiquetas = [];
    if (a.dias != null) etiquetas.push('<span class="al-tag sev">' + a.dias + (a.dias === 1 ? ' día' : ' días') + ' de atraso</span>');
    if (a.proceso) etiquetas.push('<span class="al-tag">En ' + esc(a.proceso) + '</span>');
    if (a.etapa) etiquetas.push('<span class="al-tag">' + esc(a.etapa) + '</span>');
    if (a.faltan) etiquetas.push('<span class="al-tag sev">faltan ' + esc(a.faltan) + ' mts</span>');
    const verOrden = a.tipo === 'atrasado' || a.tipo === 'reproceso';
    const ir = verOrden ? '<button type="button" class="pri" data-ver="' + esc(a.orden) + '">Ver en Producción</button>' : (a.tipo === 'ecommerce' ? '<button type="button" class="pri" data-ecom>Abrir ECOMMERCE</button>' : '');
    const copiar = a.orden ? '<button type="button" data-copiar="' + esc(a.orden) + '">Copiar ' + esc(String(a.orden).slice(0, 14)) + '</button>' : '';
    return '<article class="al-card sev-' + esc(a.severidad || 'media') + (esNueva ? ' nueva' : '') + '" style="--c:' + t.color + ';animation-delay:' + Math.min(i * 25, 250) + 'ms"><div class="al-tipo" title="' + esc(t.nombre) + '"><svg viewBox="0 0 24 24">' + t.icono + '</svg></div>' +
      '<div><div class="al-tit">' + esc(a.titulo || a.texto) + '</div>' + (a.detalle ? '<div class="al-det">' + esc(a.detalle) + '</div>' : '') +
      (etiquetas.length ? '<div class="al-tags">' + etiquetas.join('') + '</div>' : '') +
      '<div class="al-acc">' + ir + copiar + '<button type="button" data-silenciar="' + esc(clave(a)) + '" title="No la muestres más hoy">Silenciar hoy</button></div></div></article>';
  }

  function pintar(forzar) {
    const todas = activas(), nuevasN = nuevas().length;
    const b = btn.querySelector('b');
    b.hidden = !todas.length; b.textContent = todas.length > 99 ? '99+' : todas.length;
    b.classList.toggle('nuevas', nuevasN > 0);
    btn.title = todas.length ? todas.length + ' alerta' + (todas.length === 1 ? '' : 's') + (nuevasN ? ' · ' + nuevasN + ' nueva' + (nuevasN === 1 ? '' : 's') : '') : 'Sin alertas';
    const firma = JSON.stringify([todas.map(clave), st.filtro, st.q, st.datos.error || '', st.abierto]);
    if (!forzar && firma === st.firma) return;
    st.firma = firma;
    if (!st.abierto) return;
    const conteo = {}; todas.forEach(a => { conteo[a.tipo] = (conteo[a.tipo] || 0) + 1; });
    q('[data-filtros]').innerHTML = '<button type="button" class="al-chip' + (st.filtro === 'todas' ? ' on' : '') + '" data-filtro="todas">Todas <em>' + todas.length + '</em></button>' +
      Object.keys(TIPOS).filter(k => conteo[k]).map(k => '<button type="button" class="al-chip' + (st.filtro === k ? ' on' : '') + '" style="--c:' + TIPOS[k].color + '" data-filtro="' + k + '"><i></i>' + TIPOS[k].nombre + ' <em>' + conteo[k] + '</em></button>').join('');
    const texto = st.q.trim().toLowerCase();
    const lista = todas.filter(a => (st.filtro === 'todas' || a.tipo === st.filtro) && (!texto || [a.orden, a.cliente, a.titulo, a.detalle].join(' ').toLowerCase().includes(texto)));
    const compras = lista.filter(a => a.tipo === 'compra'), urgentes = lista.filter(a => a.tipo !== 'compra' && a.severidad === 'alta'), resto = lista.filter(a => a.tipo !== 'compra' && a.severidad !== 'alta');
    let i = 0;
    const caja = q('[data-lista]');
    caja.classList.toggle('anima', !!st.animar);   // las tarjetas «entran» solo al abrir la campana, no en cada actualización
    caja.innerHTML = lista.length
      ? (compras.length ? '<div class="al-grupo">COMPRAS ENVIADAS · ' + compras.length + '</div>' + compras.map(a => tarjeta(a, i++)).join('') : '') +
        (urgentes.length ? '<div class="al-grupo">URGENTES · ' + urgentes.length + '</div>' + urgentes.map(a => tarjeta(a, i++)).join('') : '') +
        (resto.length ? '<div class="al-grupo">PARA REVISAR · ' + resto.length + '</div>' + resto.map(a => tarjeta(a, i++)).join('') : '')
      : '<div class="al-vacio"><b>✓</b>' + (todas.length ? 'Ninguna alerta coincide con el filtro.' : 'Todo en orden. No hay alertas pendientes.') + '</div>';
    if (st.animar) { clearTimeout(pintar.t); pintar.t = setTimeout(() => { st.animar = false; caja.classList.remove('anima'); }, 700); }
    q('[data-error]').innerHTML = st.datos.error ? '<div class="al-error">⚠ ' + esc(st.datos.error) + '</div>' : '';
  }
  function subtitulo() {
    const s = q('[data-sub]');
    if (s) s.textContent = (st.ultimo ? 'Actualizado ' + relativo(Math.round((Date.now() - st.ultimo) / 1000)) : 'Cargando…') + ' · se revisa cada minuto';
  }

  let previo = null, cargando = false;
  async function cargar() {
    if (cargando || (document.hidden && !st.abierto)) return;
    cargando = true;
    try {
      const r = await fetch('/api/alertas-panel', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) {
        st.datos = await r.json(); st.ultimo = Date.now();
        const claves = new Set(activas().map(clave));
        if (previo && [...claves].some(k => !previo.has(k) && !st.vistas.has(k))) { btn.classList.remove('suena'); void btn.offsetWidth; btn.classList.add('suena'); }
        previo = claves;
        pintar(false); subtitulo();
      }
    } catch (e) { /* sin red: se conserva lo último */ }
    cargando = false;
  }

  function abrir() {
    st.abierto = true; st.animar = true; box.classList.add('on'); btn.setAttribute('aria-expanded', 'true');
    pintar(true); subtitulo(); cargar();
    clearTimeout(abrir.t);
    abrir.t = setTimeout(() => { if (st.abierto) marcarVistas(false); }, 3500);   // lo que se ve un rato deja de ser «nuevo»
    setTimeout(() => q('[data-q]')?.focus({ preventScroll: true }), 60);
  }
  function cerrar() { st.abierto = false; box.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
  function marcarVistas(repintar = true) {
    activas().forEach(a => st.vistas.add(clave(a)));
    store.set('indoor-alertas-vistas', [...st.vistas].slice(-400));
    box.querySelectorAll('.al-card.nueva').forEach(c => c.classList.remove('nueva'));   // se quita la etiqueta en el sitio
    pintar(false);
  }

  btn.addEventListener('click', () => (st.abierto ? cerrar() : abrir()));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.abierto) cerrar(); });
  document.addEventListener('click', e => { if (st.abierto && !box.contains(e.target) && !btn.contains(e.target)) cerrar(); });
  box.addEventListener('input', e => { if (e.target.matches('[data-q]')) { st.q = e.target.value; pintar(false); } });
  box.addEventListener('click', async e => {
    const f = e.target.closest('[data-filtro]');
    if (f) { st.filtro = f.dataset.filtro; pintar(true); return; }
    if (e.target.closest('[data-cerrar]')) { cerrar(); return; }
    if (e.target.closest('[data-vistas]')) { marcarVistas(); return; }
    if (e.target.closest('[data-refrescar]')) { await cargar(); pintar(true); return; }
    const ver = e.target.closest('[data-ver]');
    if (ver) { irAProduccion(ver.dataset.ver); return; }
    if (e.target.closest('[data-ecom]')) { cerrar(); document.getElementById('open-ecommerce')?.click(); return; }
    const c = e.target.closest('[data-copiar]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copiar); const t = c.textContent; c.textContent = '¡Copiado!'; setTimeout(() => { c.textContent = t; }, 1200); } catch (err) { /* sin portapapeles */ } return; }
    const s = e.target.closest('[data-silenciar]');
    if (s) { st.silenciadas[s.dataset.silenciar] = hoyClave(); store.set('indoor-alertas-silenciadas', st.silenciadas); pintar(true); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
  setInterval(() => { cargar(); subtitulo(); }, 60000);
  setInterval(subtitulo, 15000);
  cargar();
})();
