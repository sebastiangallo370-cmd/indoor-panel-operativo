/* ECOMMERCE: control de los agentes de las ÓRDENES DE VENTA (ALMA descarga, BRISA exporta las tallas, CIRO genera los PDF y llena Google Sheets) desde el panel, con la misma pantalla que AGENTES
   (encabezado con estados, botones Detener / Reiniciar, resumen con pasos, pestañas y registro de ejecución).
   Solo Administración / Coordinación (el servidor responde 403 al resto y entonces no se crea nada).
   Se abre desde el menú de usuario, justo debajo de «Agentes». Los estilos de AGENTES se reutilizan tal cual. */
(function () {
  if (window.__ecommercePanel) return;
  window.__ecommercePanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { agentes: [], pc: null, cola: {}, ordenes: [], log: [], ultimo: 0, filtro: '', token: null, abierto: {}, ocupado: false, aviso: '', vista: 'agentes' };
  let panel = null, tab = null, timer = 0;

  const ETIQUETA = { INACTIVO: 'Detenido', CORRIENDO: 'Vigilando', EN_FILA: 'Esperando Illustrator', ERROR: 'Con error' };
  const PASO = { INACTIVO: ['inactivo', '—'], CORRIENDO: ['ok', 'Vigilando'], EN_FILA: ['espera', 'Esperando Illustrator'], ERROR: ['error', 'Con error'] };
  const COLOMBIA = { timeZone: 'America/Bogota' };
  const hora = t => new Date(t * 1000).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const horaIso = iso => iso ? new Date(iso).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit' }) : '';
  const vivo = a => a.estado === 'CORRIENDO' || a.estado === 'EN_FILA';

  // Mismo aspecto que AGENTES: se copian sus estilos (los que van atados al panel «agentes») para este panel.
  function clonarEstilosAgentes() {
    document.querySelectorAll('style').forEach(s => {
      const t = s.textContent || '';
      if (s.dataset.ecClon || t.indexOf("[data-panel='agentes']") < 0) return;
      const c = document.createElement('style');
      c.dataset.ecClon = '1';
      c.textContent = t.split("[data-panel='agentes']").join("[data-panel='ecommerce']");
      document.head.appendChild(c);
    });
  }
  const css = document.createElement('style');
  css.textContent = `
  .ec-vtabs{display:flex!important}
  .ec-cola{display:flex;flex-wrap:wrap;gap:8px}.ec-cola .ag-pill b{color:#eef4e9}
  .ec-body{display:grid;gap:14px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:6px 16px 16px 16px;background:linear-gradient(160deg,#0d120e,#0a0e08)}
  .ec-conn{padding:14px 16px;border:1px solid #d0f44c;border-radius:12px;background:rgba(208,244,76,.06);font-size:.85rem;line-height:1.6}
  .ec-conn code{display:block;margin:8px 0;padding:9px 11px;border-radius:8px;background:#0b0f09;color:#d0f44c;font:12px Consolas,monospace;overflow-wrap:anywhere;user-select:all}
  .ec-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px}
  .ec-card{display:grid;gap:10px;padding:16px;border:1px solid #34432f;border-top:4px solid var(--c);border-radius:14px;background:linear-gradient(160deg,#111a12,#0c110d)}
  .ec-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.ec-top h3{margin:0;font-size:1.2rem;letter-spacing:.1em;color:var(--c)}.ec-top small{display:block;color:#c4cfbf;font-size:.8rem;margin-top:2px}
  .ec-ult{min-height:2.4em;color:#aeb9a6;font:12px Consolas,monospace;overflow-wrap:anywhere}.ec-desde{color:#8f9d88;font-size:.72rem;min-height:1em}
  .ec-btns{display:flex;gap:8px;flex-wrap:wrap}.ec-btns .ag-btn{flex:1 1 90px}
  .ec-card details summary{cursor:pointer;color:#aeb9a6;font-size:.75rem;font-weight:800;letter-spacing:.08em}.ec-card ul{margin:8px 0 0;padding-left:18px;color:#c4cfbf;font-size:.8rem;line-height:1.5}
  .ec-sub{color:#8f9d88;font-size:.72rem;font-weight:800;letter-spacing:.1em;margin:2px 0 6px}
  .ec-ords{display:grid;gap:6px}.ec-ord{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border:1px solid #34432f;border-radius:10px;background:#0c110d;font-size:.8rem;color:#c4cfbf}
  .ec-ord b{color:#eef4e9}.ec-ord.error,.ec-ord.vencida{color:#ffb4ae;border-color:#6a2e2a}.ec-ord.hecha{color:#b8e68a}
  .ec-chips{display:flex;flex-wrap:wrap;gap:6px}.ec-chips button{padding:5px 14px;border:1px solid #60754d;border-radius:999px;background:transparent;color:#d0f44c;font:800 12px Arial;cursor:pointer}.ec-chips button.on{background:#d0f44c;border-color:#d0f44c;color:#10170c}
  .ec-log{max-height:420px;overflow:auto;padding:10px 12px;border:1px solid #34432f;border-radius:12px;background:#080b07;font:12px/1.6 Consolas,monospace}.ec-l{display:flex;gap:10px}.ec-l time{color:#6f7d69;flex:none}.ec-l b{flex:none;min-width:52px}.ec-l span{overflow-wrap:anywhere}.ec-l.error span{color:#ff9c99}.ec-l.info span{color:#aeb9a6}
  .ec-vacio{padding:30px;text-align:center;color:#8f9d88}
  @media(max-width:1000px){.ec .ag-vtabs{display:flex!important}.ec-body{padding:10px}}
  @media(max-width:620px){.ec-l{flex-wrap:wrap;gap:2px 8px}.ec-vtabs .ag-vt{padding:8px 14px!important;flex:1}}`;
  document.head.appendChild(css);

  async function api(url, opciones) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(opciones || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }

  // ---------- piezas
  function encabezado() {
    const pc = st.pc || {}, ok = !!pc.conectado;
    const pcTxt = ok ? 'PC conectado' + (pc.equipo ? ' · ' + pc.equipo : '') + (pc.simulado ? ' · prueba' : '') : (pc.hay_token ? 'PC desconectado' : 'Sin PC enlazado');
    const pills = '<span class="ag-pill ' + (ok ? 'ok' : 'mal') + '"><i></i>' + esc(pcTxt) + '</span>' +
      st.agentes.map(a => '<span class="ag-pill ' + (a.estado === 'ERROR' ? 'mal' : a.estado === 'EN_FILA' ? 'sim' : vivo(a) ? 'ok' : '') + '"><i></i>' + esc(a.nombre) + ' ' + esc(vivo(a) || a.estado === 'ERROR' ? ETIQUETA[a.estado] : 'libre') + '</span>').join('');
    const indiv = st.agentes.map(a => '<button type="button" class="ag-agbtn" style="--c:' + a.color + '" data-alterna="' + a.id + '" title="' + esc(a.nombre + ': ' + a.titulo + (vivo(a) ? ' (toca para detenerlo)' : ' (toca para iniciarlo)')) + '"' + (!ok || a.pendiente ? ' disabled' : '') + '><i></i>' + esc(a.nombre) + '<small>' + (vivo(a) ? '■ detener' : '▶ iniciar') + '</small></button>').join('');
    const hayVivos = st.agentes.some(vivo);
    return '<header class="ag-hd"><h2>ECOMMERCE</h2><div class="ag-state">' + pills + '</div>' +
      '<div class="ag-indiv" aria-label="Iniciar o detener un agente">' + indiv + '</div>' +
      '<div class="ag-hacc"><button type="button" class="ag-btn danger ag-stop' + (hayVivos ? '' : ' inactivo') + '" data-detener-todo title="Detiene a todos los agentes que estén corriendo"' + (!ok || !hayVivos ? ' disabled' : '') + '>⏹ Detener</button>' +
      '<button type="button" class="ag-btn ag-reiniciar" data-reiniciar-todo title="Reinicia a los agentes que estén corriendo"' + (!ok || !hayVivos ? ' disabled' : '') + '>↻ Reiniciar</button>' +
      '<details class="ag-menu"><summary class="ag-ico" title="Más opciones">⋯</summary><div class="ag-menu-l"><button type="button" class="solo-movil" data-reiniciar-todo>↻ Reiniciar los que están corriendo</button><button type="button" class="solo-movil" data-detener-todo>⏹ Detener los que están corriendo</button><button type="button" data-conectar>PC de los bots… (código de enlace)</button></div></details></div></header>';
  }
  function colaChips() {
    const c = st.cola || {}, chip = (clase, n, texto, tip) => '<span class="ag-pill ' + clase + '" title="' + esc(tip) + '"><i></i><b>' + (n || 0) + '</b>&nbsp;' + esc(texto) + '</span>';
    return chip(c.descargadas ? 'sim' : '', c.descargadas, 'esperan tallas (BRISA)', 'Órdenes descargadas por ALMA que BRISA todavía no exportó') +
      chip(c.tallas ? 'sim' : '', c.tallas, 'esperan PDF y Sheets (CIRO)', 'Órdenes con tallas exportadas que CIRO todavía no termina') +
      chip(c.terminadas ? 'ok' : '', c.terminadas, 'terminadas', 'Órdenes completas: PDF por jugador, listado y Google Sheets') +
      chip(c.errores ? 'mal' : '', c.errores, 'con avisos', 'Órdenes que terminaron con algún problema: revisa el REGISTRO');
  }
  function resumen() {
    const n = st.agentes.length, corriendo = st.agentes.filter(vivo).length, errores = st.agentes.filter(a => a.estado === 'ERROR').length;
    const pasos = st.agentes.map(a => { const [clase, txt] = PASO[a.estado] || PASO.INACTIVO; return '<div class="ag-paso ' + clase + '" title="' + esc('Paso ' + (a.paso || '') + ': ' + a.titulo) + '"><i class="pt"></i><b>' + esc((a.paso ? a.paso + '. ' : '') + a.nombre) + '</b><em>' + esc(a.pendiente ? ({ iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…' }[a.pendiente] || txt) : txt) + '</em></div>'; }).join('');
    const ult = st.log.filter(l => l.nivel !== 'info').slice(-1)[0], pc = st.pc || {};
    const ahora = ult ? '<b>' + esc(((st.agentes.find(a => a.id === ult.agente) || {}).nombre) || ult.agente) + '</b> · ' + esc(ult.texto) + ' <span style="color:#8f9b8a">(' + hora(ult.at) + ')</span>' : (pc.conectado ? 'Todo en orden: elige un agente arriba y pulsa iniciar.' : 'El PC de los bots no está conectado: no se puede iniciar nada todavía.');
    return '<section class="ag-res" style="--respct:' + Math.round(corriendo / Math.max(1, n) * 100) + '%"><div class="ag-res-top"><div class="qa"><h3>Resumen de ECOMMERCE</h3><b>' + corriendo + ' de ' + n + ' agentes trabajando</b><small>' + (errores ? '✖ ' + errores + ' con error' : '') + '</small></div><span class="tiempo">' + (pc.conectado ? '● PC conectado · hace ' + (pc.hace ?? 0) + ' s' : '○ PC sin conexión') + '</span></div>' +
      '<div class="ag-barra2' + (errores ? ' err' : '') + '"><i style="width:' + Math.round(corriendo / Math.max(1, n) * 100) + '%"></i></div><div class="ag-pasos" style="grid-template-columns:repeat(' + Math.max(1, n) + ',minmax(0,1fr))">' + pasos + '</div>' +
      '<div class="ec-cola" aria-label="Órdenes en cada etapa">' + colaChips() + '</div><div class="ag-ahora">' + ahora + '</div></section>';
  }
  function tarjeta(a) {
    const e = a.estado, v = vivo(a), ocup = !!a.pendiente || !st.pc || !st.pc.conectado;
    const [clase] = PASO[e] || PASO.INACTIVO;
    return '<article class="ec-card" style="--c:' + a.color + '"><div class="ec-top"><div><h3>' + esc(a.nombre) + '</h3><small>Paso ' + (a.paso || '') + ' de ' + st.agentes.length + ' · ' + esc(a.titulo) + '</small></div>' +
      '<span class="ag-pill ' + (e === 'ERROR' ? 'mal' : e === 'EN_FILA' ? 'sim' : v ? 'ok' : '') + '"><i></i>' + esc(a.pendiente ? ({ iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…' }[a.pendiente] || '…') : (ETIQUETA[e] || e)) + '</span></div>' +
      '<div class="ec-ult">' + (a.ultima ? esc(a.ultima) : '<span style="opacity:.5">Sin actividad todavía</span>') + '</div>' +
      '<div class="ec-desde">' + (a.desde && e !== 'INACTIVO' ? 'Desde las ' + horaIso(a.desde) : '') + '</div>' +
      '<div class="ec-btns"><button type="button" class="ag-btn" data-orden="' + a.id + ':iniciar"' + (ocup || v ? ' disabled' : '') + '>▶ Iniciar</button>' +
      '<button type="button" class="ag-btn danger" data-orden="' + a.id + ':detener"' + (ocup || (!v && e !== 'ERROR') ? ' disabled' : '') + '>⏹ Detener</button>' +
      '<button type="button" class="ag-btn sec" data-orden="' + a.id + ':reiniciar" title="Reiniciar"' + (ocup || (!v && e !== 'ERROR') ? ' disabled' : '') + '>↻</button></div>' +
      '<details data-det="' + a.id + '"' + (st.abierto[a.id] ? ' open' : '') + '><summary>QUÉ HACE</summary><ul>' + a.funciones.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></details></article>';
  }
  function vistaAgentes() {
    const nombre = id => (st.agentes.find(a => a.id === id) || {}).nombre || id;
    return '<div class="ec-grid">' + st.agentes.map(tarjeta).join('') + '</div>' +
      (st.ordenes.length ? '<div><div class="ec-sub">ÚLTIMAS ÓRDENES</div><div class="ec-ords">' + st.ordenes.map(o =>
        '<div class="ec-ord ' + esc(o.estado) + '"><b>' + esc(nombre(o.agente)) + '</b><span>' + esc(o.accion) + '</span><span>por ' + esc(o.por) + ' · ' + horaIso(o.iso) + '</span><span>' +
        esc({ pendiente: 'esperando al PC', entregada: 'el PC la está haciendo', hecha: 'hecha', error: 'falló', vencida: 'vencida' }[o.estado] || o.estado) + (o.detalle ? ' — ' + esc(o.detalle) : '') + '</span></div>').join('') + '</div></div>' : '');
  }
  function vistaRegistro() {
    const chips = [['', 'Todos']].concat(st.agentes.map(a => [a.id, a.nombre]));
    const lineas = st.log.filter(l => !st.filtro || l.agente === st.filtro);
    return '<div class="ec-chips">' + chips.map(([id, n]) => '<button type="button" data-filtro="' + id + '" class="' + (st.filtro === id ? 'on' : '') + '">' + esc(n) + '</button>').join('') + '</div>' +
      '<div class="ec-log" data-log>' + (lineas.length ? lineas.slice(-250).map(l => {
        const a = st.agentes.find(x => x.id === l.agente) || {};
        return '<div class="ec-l ' + esc(l.nivel) + '"><time>' + hora(l.at) + '</time><b style="color:' + (a.color || '#aeb9a6') + '">' + esc(a.nombre || l.agente) + '</b><span>' + esc(l.texto) + '</span></div>';
      }).join('') : '<div class="ec-vacio">Todavía no hay actividad registrada.</div>') + '</div>';
  }
  function conexion() {
    if (!st.token) return '';
    return '<div class="ec-conn"><b>Código de enlace (se muestra una sola vez)</b><code>' + esc(st.token.url) + '</code><code>' + esc(st.token.token) + '</code>' +
      'En el PC de los agentes: si es nuevo, abre <b>INSTALAR_AGENTES_EDICION.vbs</b> (carpeta AGENTES_INDOOR de la NAS) y pega este código cuando lo pida. Si ya tiene los agentes, abre <b>ecommerce\\ENLAZAR_ECOMMERCE.bat</b> y pega la dirección y el código; luego <b>detener_agentes.bat</b> y <b>iniciar_oculto.vbs</b>. Ese mismo archivo (iniciar_oculto.vbs) inicia los agentes de edición y a ALMA, BRISA y CIRO; detener_agentes.bat detiene los dos. El panel atiende un solo PC: enlaza solo el que correrá ALMA, BRISA y CIRO.</div>';
  }
  function pintar() {
    const l0 = panel.querySelector('[data-log]'), pegado = !l0 || l0.scrollHeight - l0.scrollTop - l0.clientHeight < 40, y = l0 ? l0.scrollTop : 0;
    const cuerpo = st.vista === 'registro' ? vistaRegistro() : vistaAgentes();
    panel.querySelector('.ec').innerHTML = encabezado() + (st.aviso ? '<div class="ag-aviso" style="padding:10px 14px;border-radius:11px;background:#5a2a12;color:#ffd9b0;font-size:.85rem">' + esc(st.aviso) + '</div>' : '') + conexion() + resumen() +
      '<nav class="ag-vtabs ec-vtabs" aria-label="Secciones de ECOMMERCE"><button type="button" class="ag-vt' + (st.vista === 'agentes' ? ' on' : '') + '" data-vt="agentes">AGENTES</button><button type="button" class="ag-vt' + (st.vista === 'registro' ? ' on' : '') + '" data-vt="registro">REGISTRO</button></nav>' +
      '<div class="ec-body">' + cuerpo + '</div>';
    const l = panel.querySelector('[data-log]');
    if (l) l.scrollTop = pegado ? l.scrollHeight : y;
  }

  async function cargar() {
    try {
      const e = await api('/api/ecommerce/estado');
      st.agentes = e.agentes; st.pc = e.pc; st.ordenes = e.ordenes; st.cola = e.cola || {};
      const l = await api('/api/ecommerce/log?desde=' + st.ultimo + '&limite=300');
      if (l.lineas.length) st.log = st.log.concat(l.lineas).slice(-600);
      st.ultimo = l.ultimo;
      if (st.aviso && /^(Cargando|No se pudo leer)/.test(st.aviso)) st.aviso = '';
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
  async function aTodos(accion, texto) {
    const vivos = st.agentes.filter(vivo);
    if (!vivos.length) return;
    if (!confirm(texto)) return;
    st.aviso = '';
    for (const a of vivos) { try { await api('/api/ecommerce/agentes/' + a.id + '/' + accion, { method: 'POST' }); } catch (err) { st.aviso = err.message; } }
    await cargar();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="ecommerce"]')) return true;
    clonarEstilosAgentes();
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'ecommerce';
    panel.innerHTML = '<div class="ag ec"><div class="ag-empty">Cargando ECOMMERCE…</div></div>';
    main.appendChild(panel);
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
      cargar();
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 4000);
    });
    panel.addEventListener('click', async e => {
      panel.querySelectorAll('details.ag-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.ag-menu-l button')) d.removeAttribute('open'); });
      const alt = e.target.closest('[data-alterna]');
      if (alt && !alt.disabled) { const a = st.agentes.find(x => x.id === alt.dataset.alterna); if (a) ordenar(a.id, vivo(a) ? 'detener' : 'iniciar'); return; }
      const b = e.target.closest('[data-orden]');
      if (b && !b.disabled) { const [id, accion] = b.dataset.orden.split(':'); ordenar(id, accion); return; }
      const vt = e.target.closest('[data-vt]');
      if (vt) { st.vista = vt.dataset.vt; pintar(); return; }
      const f = e.target.closest('[data-filtro]');
      if (f) { st.filtro = f.dataset.filtro; pintar(); return; }
      if (e.target.closest('[data-detener-todo]') && !e.target.closest('[disabled]')) { aTodos('detener', '¿Detener a todos los agentes que están corriendo?'); return; }
      if (e.target.closest('[data-reiniciar-todo]') && !e.target.closest('[disabled]')) { aTodos('reiniciar', '¿Reiniciar a los agentes que están corriendo? Lo que estén haciendo se corta.'); return; }
      if (e.target.closest('[data-conectar]')) {
        if (st.pc && st.pc.hay_token && !confirm('Se creará un código nuevo y el PC actual dejará de conectarse hasta que lo vuelvas a enlazar. ¿Continuar?')) return;
        try { st.token = await api('/api/ecommerce/conexion/regenerar', { method: 'POST' }); st.aviso = ''; } catch (err) { st.aviso = err.message; }
        pintar(); await cargar();
      }
    });
    panel.addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('[data-det]'); if (d) st.abierto[d.dataset.det] = d.open; }, true);
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
