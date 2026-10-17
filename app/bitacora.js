/* Bitácora de cambios: quién cambió qué y cuándo. Solo la ve la cuenta «Indoor Sport»
   (el servidor responde 403 al resto y entonces no se crea nada). Se abre desde el menú de usuario. */
(function () {
  if (window.__bitacoraPanel) return;
  window.__bitacoraPanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { items: [], hayMas: false, usuario: '', modulo: '', desde: '', hasta: '', q: '', cargando: false, meta: null };
  let panel = null, tab = null, vista = null, timer = 0;

  const COLOMBIA = { timeZone: 'America/Bogota' };
  const fechaClave = iso => new Date(iso).toLocaleDateString('en-CA', COLOMBIA);
  const hora = iso => new Date(iso).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit' });
  function titulo(clave) {
    const hoy = fechaClave(new Date().toISOString()), ayer = fechaClave(new Date(Date.now() - 864e5).toISOString());
    if (clave === hoy) return 'Hoy';
    if (clave === ayer) return 'Ayer';
    const f = new Date(clave + 'T12:00:00');
    const t = f.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  const css = document.createElement('style');
  css.textContent = `
  .bt{display:grid;gap:16px;max-width:1100px;margin:auto}
  .bt-head span{color:#d0f44c;font-size:.68rem;font-weight:900;letter-spacing:.12em}.bt-head h2{margin:4px 0;font-size:1.6rem}.bt-head p{margin:0;color:var(--muted,#98a393)}
  .bt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
  .bt-stat{position:relative;overflow:hidden;padding:14px 16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04)}
  .bt-stat small{display:block;color:#aeb9a6;font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.bt-stat b{display:block;font-size:1.9rem;margin-top:4px}
  .bt-filtros{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.03)}
  .bt-filtros label{display:grid;gap:4px;font-size:.68rem;font-weight:800;color:#aeb9a6;letter-spacing:.05em;text-transform:uppercase}
  .bt-filtros input,.bt-filtros select{width:100%;padding:9px 10px;border:1px solid rgba(255,255,255,.16);border-radius:9px;background:#10150e;color:#eef3ea;font:inherit;font-size:.85rem}
  .bt-filtros button{align-self:end;padding:10px 12px;border:1px solid rgba(208,244,76,.4);border-radius:9px;background:transparent;color:#d0f44c;font-weight:800;cursor:pointer}
  .bt-dia{margin:8px 0 2px;padding:6px 2px;color:#d0f44c;font-size:.78rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid rgba(208,244,76,.2)}
  .bt-fila{display:grid;grid-template-columns:62px 1fr;gap:12px;padding:11px 12px;margin-top:8px;border:1px solid rgba(255,255,255,.09);border-left:4px solid var(--c,#8bd450);border-radius:12px;background:rgba(255,255,255,.035)}
  .bt-hora{color:#aeb9a6;font-size:.82rem;font-weight:800;padding-top:2px}
  .bt-quien{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bt-quien b{font-size:.92rem}
  .bt-mod{padding:2px 9px;border-radius:99px;background:rgba(255,255,255,.1);font-size:.68rem;font-weight:800;letter-spacing:.04em}
  .bt-acc{margin-top:3px;font-size:.9rem}.bt-det{margin-top:3px;color:#aeb9a6;font-size:.8rem;overflow-wrap:anywhere}
  .bt-vacio{padding:40px;text-align:center;border:1px dashed rgba(255,255,255,.2);border-radius:14px;color:#aeb9a6}
  .bt-mas{justify-self:center;padding:10px 22px;border:1px solid rgba(208,244,76,.4);border-radius:10px;background:transparent;color:#d0f44c;font-weight:800;cursor:pointer}
  @media(max-width:620px){.bt-fila{grid-template-columns:1fr;gap:4px}.bt-hora{padding:0}.bt-head h2{font-size:1.3rem}}`;
  document.head.appendChild(css);

  async function api(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'No se pudo cargar');
    return r.json();
  }
  function consulta(antes) {
    const p = new URLSearchParams();
    ['usuario', 'modulo', 'desde', 'hasta', 'q'].forEach(k => { if (st[k]) p.set(k, st[k]); });
    if (antes) p.set('antes', antes);
    p.set('limite', '100');
    return '/api/bitacora?' + p;
  }
  async function cargar(mas) {
    if (st.cargando) return;
    st.cargando = true;
    try {
      const d = await api(consulta(mas && st.items.length ? st.items[st.items.length - 1].id : 0));
      st.items = mas ? st.items.concat(d.items) : d.items;
      st.hayMas = d.hay_mas;
      st.meta = d;
      pintar();
    } catch (e) { vista.querySelector('.bt-lista').innerHTML = '<div class="bt-vacio">' + esc(e.message) + '</div>'; }
    finally { st.cargando = false; }
  }

  function opciones(lista, actual, todos) {
    return '<option value="">' + todos + '</option>' + lista.map(x => '<option' + (x === actual ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
  }
  function pintarEstructura() {
    const m = st.meta || { usuarios: [], modulos: [], cambios_hoy: 0, usuarios_hoy: 0 };
    vista.innerHTML =
      '<div class="bt-head"><span>ADMINISTRACIÓN</span><h2>BITÁCORA DE CAMBIOS</h2><p>Todo lo que cambian los usuarios en el panel, con quién, cuándo y en qué módulo.</p></div>' +
      '<div class="bt-stats"><div class="bt-stat" data-lq="' + Math.min(100, m.cambios_hoy) + '" data-lq-tone="verde" data-lq-nopct><small>Cambios hoy</small><b>' + m.cambios_hoy + '</b></div>' +
      '<div class="bt-stat" data-lq="' + Math.min(100, m.usuarios_hoy * 10) + '" data-lq-tone="azul" data-lq-nopct><small>Usuarios activos hoy</small><b>' + m.usuarios_hoy + '</b></div>' +
      '<div class="bt-stat" data-lq="' + Math.min(100, st.items.length) + '" data-lq-tone="ambar" data-lq-nopct><small>Mostrando</small><b>' + st.items.length + '</b></div></div>' +
      '<div class="bt-filtros">' +
      '<label>Usuario<select data-f="usuario">' + opciones(m.usuarios, st.usuario, 'Todos') + '</select></label>' +
      '<label>Módulo<select data-f="modulo">' + opciones(m.modulos, st.modulo, 'Todos') + '</select></label>' +
      '<label>Desde<input type="date" data-f="desde" value="' + esc(st.desde) + '"></label>' +
      '<label>Hasta<input type="date" data-f="hasta" value="' + esc(st.hasta) + '"></label>' +
      '<label>Buscar<input type="search" data-f="q" placeholder="orden, cliente, acción…" value="' + esc(st.q) + '"></label>' +
      '<button type="button" data-limpiar>Limpiar</button></div>' +
      '<div class="bt-lista"></div><div class="bt-pie"></div>';
  }
  function pintarLista() {
    let dia = '', html = '';
    st.items.forEach(it => {
      const clave = fechaClave(it.at);
      if (clave !== dia) { dia = clave; html += '<div class="bt-dia">' + esc(titulo(clave)) + '</div>'; }
      html += '<div class="bt-fila" style="--c:' + colorDe(it.username) + '"><div class="bt-hora">' + hora(it.at) + '</div><div>' +
        '<div class="bt-quien"><b>' + esc(it.username) + '</b><span class="bt-mod">' + esc(it.modulo) + '</span></div>' +
        '<div class="bt-acc">' + esc(it.accion) + '</div>' + (it.detalle ? '<div class="bt-det">' + esc(it.detalle) + '</div>' : '') + '</div></div>';
    });
    vista.querySelector('.bt-lista').innerHTML = html || '<div class="bt-vacio">No hay cambios registrados con estos filtros.</div>';
    vista.querySelector('.bt-pie').innerHTML = st.hayMas ? '<button type="button" class="bt-mas" data-mas>Cargar más</button>' : '';
  }
  const PALETA = ['#8bd450', '#6cb6ff', '#ffb04a', '#4fd1c5', '#b794f4', '#f687b3', '#a3b84a', '#ff8a75'];
  function colorDe(nombre) { let h = 0; for (const c of String(nombre)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETA[h % PALETA.length]; }
  function pintar() {
    // Los filtros se dibujan una vez (para no perder lo que el usuario escribe); solo cambian las cifras y la lista.
    if (!vista.querySelector('.bt-filtros')) pintarEstructura();
    else {
      const m = st.meta, b = vista.querySelectorAll('.bt-stat b');
      if (m && b.length === 3) {
        b[0].textContent = m.cambios_hoy; b[1].textContent = m.usuarios_hoy; b[2].textContent = st.items.length;
        const tiles = vista.querySelectorAll('.bt-stat');
        [m.cambios_hoy, m.usuarios_hoy * 10, st.items.length].forEach((v, i) => tiles[i].setAttribute('data-lq', String(Math.min(100, v))));
        ['usuario', 'modulo'].forEach(k => { const s = vista.querySelector('[data-f="' + k + '"]'); const lista = k === 'usuario' ? m.usuarios : m.modulos; if (s && s.options.length - 1 !== lista.length) s.innerHTML = opciones(lista, st[k], 'Todos'); });
      }
    }
    pintarLista();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="bitacora"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'bitacora';
    vista = document.createElement('div'); vista.className = 'bt';
    panel.appendChild(vista); main.appendChild(panel);
    // Pestaña oculta: solo existe para que el panel se active como los demás; se abre desde el menú de usuario.
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="bitacora" type="button"><span class="nav-icon">BT</span><strong>BITÁCORA</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      if (!vista.firstElementChild) pintarEstructura();
      cargar(false);
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden && !st.cargando) cargar(false); }, 30000);
    });
    vista.addEventListener('change', e => { const k = e.target.dataset.f; if (!k) return; st[k] = e.target.value; cargar(false); });
    let espera = 0;
    vista.addEventListener('input', e => { if (e.target.dataset.f !== 'q') return; st.q = e.target.value; clearTimeout(espera); espera = setTimeout(() => cargar(false), 350); });
    vista.addEventListener('click', e => {
      if (e.target.closest('[data-mas]')) { cargar(true); return; }
      if (e.target.closest('[data-limpiar]')) { Object.assign(st, { usuario: '', modulo: '', desde: '', hasta: '', q: '' }); vista.innerHTML = ''; pintarEstructura(); cargar(false); }
    });
    return true;
  }

  // En el menú de usuario, justo debajo de «Estándar 2026» (o del último acceso que haya).
  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-bitacora');
    const previo = document.getElementById('open-promedios') || document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-bitacora'; boton.textContent = 'Bitácora';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;   // una sola vez: si cada módulo reacomodara su botón, se pelearían y el menú se vería moviéndose
    if (previo) previo.insertAdjacentElement('afterend', boton);
    else if (!boton.isConnected) menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/bitacora/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;   // cualquier otra cuenta: no se crea nada
    let intentos = 0;
    const espera = setInterval(() => {
      if (construir()) ponerEnMenu();
      if (++intentos > 40) clearInterval(espera);   // ~16 s: da tiempo a que aparezca «Estándar 2026» y quedar debajo
    }, 400);
  }).catch(() => { /* sin acceso confirmado: no se muestra */ });
})();
