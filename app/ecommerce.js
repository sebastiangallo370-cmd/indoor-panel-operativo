/* ECOMMERCE: control de los bots de Effi (ALMA, BRISA, CIRO y DARIO) desde el panel.
   Solo Administración / Coordinación (el servidor responde 403 al resto y entonces no se crea nada).
   Se abre desde el menú de usuario, justo debajo de «Agentes». */
(function () {
  if (window.__ecommercePanel) return;
  window.__ecommercePanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { agentes: [], pc: null, ordenes: [], log: [], ultimo: 0, filtro: '', token: null, abierto: {}, ocupado: false, aviso: '' };
  let panel = null, tab = null, vista = null, timer = 0;

  const ETIQUETA = { INACTIVO: 'Detenido', CORRIENDO: 'Vigilando', EN_FILA: 'Esperando Illustrator', ERROR: 'Con error' };
  const COLOR_ESTADO = { INACTIVO: '#7d8a76', CORRIENDO: '#8bd450', EN_FILA: '#ffb04a', ERROR: '#ff6b6b' };
  const COLOMBIA = { timeZone: 'America/Bogota' };
  const hora = t => new Date(t * 1000).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const horaIso = iso => iso ? new Date(iso).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit' }) : '';

  const css = document.createElement('style');
  css.textContent = `
  .ec{display:grid;gap:16px;max-width:1240px;margin:auto}
  .ec-head span{color:#d0f44c;font-size:.68rem;font-weight:900;letter-spacing:.12em}.ec-head h2{margin:4px 0;font-size:1.6rem}.ec-head p{margin:0;color:var(--muted,#98a393)}
  .ec-pc{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04)}
  .ec-pc i{width:10px;height:10px;border-radius:50%;background:var(--c,#7d8a76);box-shadow:0 0 0 4px color-mix(in srgb,var(--c,#7d8a76) 25%,transparent)}
  .ec-pc b{font-size:.92rem}.ec-pc small{color:#aeb9a6}.ec-pc button{margin-left:auto;padding:7px 14px;border:1px solid rgba(208,244,76,.4);border-radius:9px;background:transparent;color:#d0f44c;font-weight:800;cursor:pointer}
  .ec-conn{padding:14px 16px;border:1px dashed rgba(208,244,76,.4);border-radius:14px;background:rgba(208,244,76,.05);font-size:.85rem;line-height:1.6}
  .ec-conn code{display:block;margin:8px 0;padding:9px 11px;border-radius:8px;background:#0b0f09;color:#d0f44c;font:12px Consolas,monospace;overflow-wrap:anywhere;user-select:all}
  .ec-aviso{padding:10px 14px;border-radius:11px;background:#5a2a12;color:#ffd9b0;font-size:.85rem}
  .ec-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(285px,1fr));gap:14px}
  .ec-card{display:grid;gap:10px;padding:16px;border:1px solid rgba(255,255,255,.1);border-top:4px solid var(--c);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.015))}
  .ec-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.ec-top h3{margin:0;font-size:1.25rem;letter-spacing:.04em;color:var(--c)}.ec-top small{display:block;color:#c4cfbf;font-size:.8rem;margin-top:2px}
  .ec-est{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border-radius:99px;border:1px solid color-mix(in srgb,var(--e) 55%,transparent);background:color-mix(in srgb,var(--e) 14%,transparent);font-size:.72rem;font-weight:800;white-space:nowrap}
  .ec-est i{width:8px;height:8px;border-radius:50%;background:var(--e)}.ec-est.vivo i{animation:ecPulso 1.8s infinite}@keyframes ecPulso{70%{box-shadow:0 0 0 7px transparent}0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--e) 60%,transparent)}}
  .ec-ult{min-height:2.4em;color:#aeb9a6;font:12px Consolas,monospace;overflow-wrap:anywhere}.ec-desde{color:#8f9d88;font-size:.72rem}
  .ec-btns{display:flex;gap:8px;flex-wrap:wrap}.ec-btns button{flex:1 1 90px;padding:9px 10px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.06);color:#eef3ea;font-weight:800;font-size:.8rem;cursor:pointer}
  .ec-btns button.go{background:var(--c);border-color:var(--c);color:#10170c}.ec-btns button.stop{border-color:#ff6b6b;color:#ff9c99}.ec-btns button:disabled{opacity:.4;cursor:not-allowed}
  .ec-card details summary{cursor:pointer;color:#aeb9a6;font-size:.75rem;font-weight:800;letter-spacing:.05em}.ec-card ul{margin:8px 0 0;padding-left:18px;color:#c4cfbf;font-size:.8rem;line-height:1.5}
  .ec-ords{display:grid;gap:6px}.ec-ord{display:flex;flex-wrap:wrap;gap:6px 12px;padding:7px 11px;border-radius:9px;background:rgba(255,255,255,.04);font-size:.78rem;color:#c4cfbf}
  .ec-ord b{color:#eef3ea}.ec-ord.error,.ec-ord.vencida{color:#ffb4ae}.ec-ord.hecha{color:#b8e68a}
  .ec-logbox{border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0a0e08;overflow:hidden}
  .ec-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
  .ec-chips button{padding:4px 12px;border:1px solid rgba(255,255,255,.18);border-radius:99px;background:transparent;color:#c4cfbf;font-size:.72rem;font-weight:800;cursor:pointer}.ec-chips button.on{background:#d0f44c;border-color:#d0f44c;color:#10170c}
  .ec-log{max-height:340px;overflow:auto;padding:10px 12px;font:12px/1.55 Consolas,monospace}.ec-l{display:flex;gap:10px}.ec-l time{color:#6f7d69;flex:none}.ec-l b{flex:none;min-width:52px}.ec-l span{overflow-wrap:anywhere}.ec-l.error span{color:#ff9c99}.ec-l.info span{color:#aeb9a6}
  .ec-vacio{padding:30px;text-align:center;color:#8f9d88}
  @media(max-width:620px){.ec-head h2{font-size:1.3rem}.ec-pc button{margin-left:0;width:100%}.ec-l{flex-wrap:wrap;gap:2px 8px}}`;
  document.head.appendChild(css);

  async function api(url, opciones) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(opciones || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }

  function pintarPc() {
    const pc = st.pc || {}, ok = !!pc.conectado;
    const estado = ok ? 'PC conectado' + (pc.equipo ? ' · ' + esc(pc.equipo) : '') + (pc.simulado ? ' · MODO PRUEBA' : '') : (pc.hay_token ? 'PC desconectado' : 'Sin PC enlazado');
    const detalle = ok ? 'respondió hace ' + (pc.hace ?? 0) + ' s' : (pc.hay_token ? 'enciende el PC de los bots y ejecuta ECOMMERCE_PUENTE' : 'enlaza el PC de los bots para poder iniciarlos desde aquí');
    let html = '<div class="ec-pc" style="--c:' + (ok ? '#8bd450' : '#ff6b6b') + '"><i></i><b>' + estado + '</b><small>' + detalle + '</small><button type="button" data-conectar>' + (pc.hay_token ? 'Código nuevo' : 'Conectar PC') + '</button></div>';
    if (st.token) {
      html += '<div class="ec-conn"><b>Código de enlace (se muestra una sola vez)</b>' +
        '<code data-copiar>' + esc(st.token.url) + '</code><code data-copiar>' + esc(st.token.token) + '</code>' +
        'En el PC de los bots abre <b>ECOMMERCE_PUENTE → conectar_ecommerce.bat</b> y pega primero la dirección y luego el código. ' +
        'Si generas otro código, el anterior deja de servir.</div>';
    }
    return html;
  }
  function tarjeta(a) {
    const e = a.estado, vivo = e === 'CORRIENDO' || e === 'EN_FILA', ocup = !!a.pendiente || !st.pc || !st.pc.conectado;
    return '<article class="ec-card" style="--c:' + a.color + '"><div class="ec-top"><div><h3>' + esc(a.nombre) + '</h3><small>' + esc(a.titulo) + '</small></div>' +
      '<span class="ec-est' + (vivo ? ' vivo' : '') + '" style="--e:' + (COLOR_ESTADO[e] || '#7d8a76') + '"><i></i>' + esc(a.pendiente ? ({ iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…' }[a.pendiente] || '…') : (ETIQUETA[e] || e)) + '</span></div>' +
      '<div class="ec-ult">' + (a.ultima ? esc(a.ultima) : '<span style="opacity:.5">Sin actividad todavía</span>') + '</div>' +
      '<div class="ec-desde">' + (a.desde && e !== 'INACTIVO' ? 'Desde las ' + horaIso(a.desde) : '') + '</div>' +
      '<div class="ec-btns"><button type="button" class="go" data-orden="' + a.id + ':iniciar"' + (ocup || vivo ? ' disabled' : '') + '>▶ Iniciar</button>' +
      '<button type="button" class="stop" data-orden="' + a.id + ':detener"' + (ocup || (!vivo && e !== 'ERROR') ? ' disabled' : '') + '>■ Detener</button>' +
      '<button type="button" data-orden="' + a.id + ':reiniciar"' + (ocup || (!vivo && e !== 'ERROR') ? ' disabled' : '') + '>↻</button></div>' +
      '<details data-det="' + a.id + '"' + (st.abierto[a.id] ? ' open' : '') + '><summary>QUÉ HACE</summary><ul>' + a.funciones.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></details></article>';
  }
  function pintarOrdenes() {
    if (!st.ordenes.length) return '';
    const nombre = id => (st.agentes.find(a => a.id === id) || {}).nombre || id;
    return '<div><div class="ec-desde" style="margin:2px 0 6px;font-weight:800;letter-spacing:.06em">ÚLTIMAS ÓRDENES</div><div class="ec-ords">' + st.ordenes.map(o =>
      '<div class="ec-ord ' + esc(o.estado) + '"><b>' + esc(nombre(o.agente)) + '</b><span>' + esc(o.accion) + '</span><span>por ' + esc(o.por) + ' · ' + horaIso(o.iso) + '</span><span>' + esc({ pendiente: 'esperando al PC', entregada: 'el PC la está haciendo', hecha: 'hecha', error: 'falló', vencida: 'vencida' }[o.estado] || o.estado) + (o.detalle ? ' — ' + esc(o.detalle) : '') + '</span></div>').join('') + '</div></div>';
  }
  function pintarLog() {
    const chips = [['', 'Todos']].concat(st.agentes.map(a => [a.id, a.nombre]));
    const lineas = st.log.filter(l => !st.filtro || l.agente === st.filtro);
    return '<div class="ec-logbox"><div class="ec-chips">' + chips.map(([id, n]) => '<button type="button" data-filtro="' + id + '" class="' + (st.filtro === id ? 'on' : '') + '">' + esc(n) + '</button>').join('') + '</div>' +
      '<div class="ec-log" data-log>' + (lineas.length ? lineas.slice(-250).map(l => {
        const a = st.agentes.find(x => x.id === l.agente) || {};
        return '<div class="ec-l ' + esc(l.nivel) + '"><time>' + hora(l.at) + '</time><b style="color:' + (a.color || '#aeb9a6') + '">' + esc(a.nombre || l.agente) + '</b><span>' + esc(l.texto) + '</span></div>';
      }).join('') : '<div class="ec-vacio">Todavía no hay actividad registrada.</div>') + '</div></div>';
  }
  function pintar() {
    const abajo = vista.querySelector('[data-log]'), pegado = !abajo || abajo.scrollHeight - abajo.scrollTop - abajo.clientHeight < 40, y = abajo ? abajo.scrollTop : 0;
    vista.innerHTML =
      '<div class="ec-head"><span>AGENTES · ECOMMERCE</span><h2>ECOMMERCE</h2><p>Los bots que descargan remisiones, cotizaciones y órdenes de venta de Effi, y las llevan a Google Sheets, listados, stickers y Illustrator.</p></div>' +
      pintarPc() + (st.aviso ? '<div class="ec-aviso">' + esc(st.aviso) + '</div>' : '') +
      '<div class="ec-grid">' + st.agentes.map(tarjeta).join('') + '</div>' + pintarOrdenes() + pintarLog();
    const l = vista.querySelector('[data-log]');
    if (l) l.scrollTop = pegado ? l.scrollHeight : y;
  }

  async function cargar() {
    try {
      const e = await api('/api/ecommerce/estado');
      st.agentes = e.agentes; st.pc = e.pc; st.ordenes = e.ordenes;
      const l = await api('/api/ecommerce/log?desde=' + st.ultimo + '&limite=300');
      if (l.lineas.length) { st.log = st.log.concat(l.lineas).slice(-600); }
      st.ultimo = l.ultimo;
      pintar();
    } catch (err) { st.aviso = err.message; pintar(); }
  }

  async function ordenar(agente, accion) {
    if (st.ocupado) return;
    st.ocupado = true; st.aviso = '';
    try { await api('/api/ecommerce/agentes/' + agente + '/' + accion, { method: 'POST' }); }
    catch (err) { st.aviso = err.message; }
    st.ocupado = false;
    await cargar();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="ecommerce"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'ecommerce';
    vista = document.createElement('div'); vista.className = 'ec';
    panel.appendChild(vista); main.appendChild(panel);
    // Pestaña oculta: solo existe para que el panel se active como los demás; se abre desde el menú de usuario.
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="ecommerce" type="button"><span class="nav-icon">EC</span><strong>ECOMMERCE</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      st.token = null; st.aviso = '';
      pintar(); cargar();
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 4000);
    });
    vista.addEventListener('click', async e => {
      const b = e.target.closest('[data-orden]');
      if (b && !b.disabled) { const [id, accion] = b.dataset.orden.split(':'); ordenar(id, accion); return; }
      const f = e.target.closest('[data-filtro]');
      if (f) { st.filtro = f.dataset.filtro; pintar(); return; }
      if (e.target.closest('[data-conectar]')) {
        if (st.pc && st.pc.hay_token && !confirm('Se creará un código nuevo y el PC actual dejará de conectarse hasta que lo vuelvas a enlazar. ¿Continuar?')) return;
        try { st.token = await api('/api/ecommerce/conexion/regenerar', { method: 'POST' }); st.aviso = ''; } catch (err) { st.aviso = err.message; }
        pintar(); await cargar(); return;
      }
    });
    vista.addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('[data-det]'); if (d) st.abierto[d.dataset.det] = d.open; }, true);
    return true;
  }

  // En el menú de usuario, justo debajo de «Agentes».
  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-ecommerce');
    const previo = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-ecommerce'; boton.textContent = 'Ecommerce';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (previo) { if (boton.previousElementSibling !== previo) previo.insertAdjacentElement('afterend', boton); }
    else if (!boton.isConnected) menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/ecommerce/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;   // cualquier otra cuenta: no se crea nada
    let intentos = 0;
    const espera = setInterval(() => {
      if (construir()) ponerEnMenu();
      if (++intentos > 40) clearInterval(espera);   // da tiempo a que aparezca «Agentes» y quedar debajo
    }, 400);
  }).catch(() => { /* sin acceso confirmado: no se muestra */ });
})();
