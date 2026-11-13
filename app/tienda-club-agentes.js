/* AGENTES TIENDA CLUB: panel de los agentes que atienden las reprogramaciones del club cuando el comercial las APRUEBA (NOVA valida, BRUJULA prepara el paquete,
   SELLO programa en Producción). Mismo esquema que ECOMMERCE pero independiente: otra cola, otro token, otro puente en el PC.
   Solo Administración / Coordinación (el servidor responde 403 al resto y entonces no se crea nada). Se abre con el robot de agentes. Reutiliza los estilos de AGENTES. */
(function () {
  if (window.__tiendaClubPanel) return;
  window.__tiendaClubPanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = '/api/tienda-club-agentes';
  const st = { agentes: [], pc: null, cola: {}, trabajos: [], log: [], ultimo: 0, token: null, ocupado: false, aviso: '', vista: 'pedidos', configuracion: {}, hoy: {}, ins: null, avisoOk: false };
  let panel = null, tab = null, timer = 0;
  const ETIQUETA = { INACTIVO: 'Detenido', CORRIENDO: 'Atendiendo', EN_FILA: 'En fila', ERROR: 'Con error' };
  const COLA = [['aprobadas', 'Aprobadas', 'ambar'], ['validadas', 'Validadas', 'azul'], ['preparadas', 'Preparadas', 'violeta'], ['programadas', 'Programadas', 'verde'], ['errores', 'Con avisos', 'rojo']];
  const vivo = a => a && (a.estado === 'CORRIENDO' || a.estado === 'EN_FILA');
  const reiniciable = a => vivo(a) || (a && a.estado === 'ERROR');   // un agente en ERROR también se puede reiniciar o detener
  const horaIso = iso => iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '';

  function clonarEstilosAgentes() {
    document.querySelectorAll('style').forEach(s => {
      const t = s.textContent || '';
      if (s.dataset.tcClon || t.indexOf("[data-panel='agentes']") < 0) return;
      const c = document.createElement('style'); c.dataset.tcClon = '1';
      c.textContent = t.split("[data-panel='agentes']").join("[data-panel='tiendaclub']");
      document.head.appendChild(c);
    });
  }
  const css = document.createElement('style');
  css.textContent = `
  .tca-body{display:grid;gap:14px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:6px 16px 16px 16px;background:linear-gradient(160deg,#0d120e,#0a0e08)}
  .tca-conn{padding:14px 16px;border:1px solid #d0f44c;border-radius:12px;background:rgba(208,244,76,.06);font-size:.85rem;line-height:1.6}
  .tca-conn code{display:block;margin:8px 0;padding:9px 11px;border-radius:8px;background:#0b0f09;color:#d0f44c;font:12px Consolas,monospace;overflow-wrap:anywhere;user-select:all}
  .tca-copia{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.tca-copia code{flex:1 1 220px;margin:0}
  .tca-ins{padding:14px 16px;border:1px solid rgba(208,244,76,.45);border-radius:12px;background:rgba(208,244,76,.05);display:grid;gap:12px}
  .tca-ins h3{margin:0;font-size:.95rem}.tca-ins p{margin:0;font-size:.82rem;color:#aab5a3}
  .tca-ins label{display:grid;gap:5px;font:800 11px Arial;letter-spacing:.1em;color:#c9d3c1}
  .tca-ins input,.tca-ins select{min-height:42px;padding:0 12px;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 14px Arial;width:100%;box-sizing:border-box}
  .tca-ins input[readonly]{opacity:.85}.tca-ins-bt{display:flex;gap:8px;flex-wrap:wrap}.tca-ins-fila{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tca-ins-fila input{flex:1 1 220px;width:auto}
  .tca-aviso{padding:10px 14px;border-radius:11px;background:#5a2a12;color:#ffd9b0;font-size:.85rem}.tca-aviso.ok{background:#1b2a1b;color:#d0f44c;border:1px solid rgba(208,244,76,.25)}
  .tca-sw{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.03)}
  .tca-sw h3{margin:0 0 3px;font-size:.95rem}.tca-sw p{margin:0;font-size:.82rem;color:#aab5a3}
  .tca-switch{border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:8px 16px;background:#1a2016;color:#cfd8c7;font:800 11px Arial;letter-spacing:.08em;cursor:pointer}
  .tca-switch.on{background:#d0f44c;color:#10150e;border-color:#d0f44c}.tca-switch:disabled{opacity:.5;cursor:default}
  .tca-cola{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
  .tca-cola>div{padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.1);text-align:center}.tca-cola b{display:block;font-size:1.6rem}.tca-cola span{font-size:.75rem;color:#aab5a3}
  .tca-ped{display:grid;gap:4px;padding:11px 13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.03)}
  .tca-ped.err{border-color:#ff7a59;background:rgba(255,122,89,.07)}.tca-hd{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline}
  .tca-ped small{color:#aab5a3}.tca-ped em{font-style:normal;color:#ffd9b0}
  .tca-ag{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .tca-ag article{padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);border-top:3px solid var(--c)}.tca-ag h4{margin:0 0 2px}.tca-ag ul{margin:8px 0 0;padding-left:18px;font-size:.8rem;color:#aab5a3}
  .tca-log{max-height:380px;overflow:auto;font:12px Consolas,monospace;line-height:1.5}.tca-log div.error{color:#ff9d85}`;
  document.head.appendChild(css);

  async function api(url, opciones) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(opciones || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }
  const post = (url, cuerpo) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
  const pill = a => 'ag-pill ' + (a.estado === 'ERROR' ? 'mal' : vivo(a) ? 'ok' : '');

  function encabezado() {
    const pc = st.pc || {}, ok = !!pc.conectado;
    const pcTxt = ok ? 'PC conectado' + (pc.equipo ? ' · ' + pc.equipo : '') + (pc.simulado ? ' · prueba' : '') : (pc.hay_token ? 'PC desconectado' : 'Sin PC enlazado');
    const pills = '<span class="ag-pill ' + (ok ? 'ok' : 'mal') + '"><i></i>' + esc(pcTxt) + '</span>' +
      st.agentes.map(a => '<span class="' + pill(a) + '"><i></i>' + esc(a.nombre) + ' ' + esc(vivo(a) || a.estado === 'ERROR' ? ETIQUETA[a.estado] : 'libre') + '</span>').join('');
    const indiv = st.agentes.map(a => '<button type="button" class="ag-agbtn" style="--c:' + a.color + '" data-alterna="' + a.id + '" title="' + esc(a.nombre + ': ' + a.titulo) + '"' + (!ok || a.pendiente ? ' disabled' : '') + '><i></i>' + esc(a.nombre) + '<small>' + (vivo(a) ? '■ detener' : '▶ iniciar') + '</small></button>').join('');
    const hayVivos = st.agentes.some(reiniciable);
    return '<header class="ag-hd"><h2>AGENTES TIENDA CLUB</h2><div class="ag-state">' + pills + '</div><div class="ag-indiv">' + indiv + '</div>' +
      '<div class="ag-hacc"><button type="button" class="ag-btn danger ag-stop' + (hayVivos ? '' : ' inactivo') + '" data-detener-todo' + (!ok || !hayVivos ? ' disabled' : '') + '>⏹ Detener</button>' +
      '<button type="button" class="ag-btn ag-reiniciar" data-reiniciar-todo' + (!ok || !hayVivos ? ' disabled' : '') + '>↻ Reiniciar</button>' +
      '<button type="button" class="ag-btn sec" data-instalar title="Instala TIENDA CLUB junto con los agentes de edición (la primera vez, en el PC que elijas) o baja de la NAS todo el paquete y lo reinicia (cuando ya está instalada)"' + (ok && st.agentes.some(a => a.pendiente) ? ' disabled' : '') + '>⬇ Instalar todo</button>' +
      '<details class="ag-menu"><summary class="ag-ico" title="Más opciones">⋯</summary><div class="ag-menu-l"><button type="button" class="solo-movil" data-reiniciar-todo>↻ Reiniciar los que están corriendo</button><button type="button" class="solo-movil" data-detener-todo>⏹ Detener los que están corriendo</button><button type="button" class="solo-movil" data-instalar>⬇ Instalar todo</button><button type="button" data-conectar>PC de los agentes… (código de enlace)</button></div></details></div></header>';
  }
  function conexion() {
    if (!st.token) return '';
    return '<div class="tca-conn"><b>Código de enlace (se muestra una sola vez)</b>' +
      '<div class="tca-copia"><code>' + esc(st.token.url) + '</code><button type="button" class="ag-btn sec" data-copiar="url">📋 Copiar dirección</button></div>' +
      '<div class="tca-copia"><code>' + esc(st.token.token) + '</code><button type="button" class="ag-btn" data-copiar="token">📋 Copiar código</button></div>' +
      '<div><button type="button" class="ag-btn sec" data-copiar="ambos">📋 Copiar los dos</button></div>' +
      'En el PC de los agentes pega la dirección y el código en <b>tienda_club\\ENLAZAR_TIENDA_CLUB.bat</b> (o cuando lo pida <b>INSTALAR_AGENTES_EDICION.vbs</b>); luego inicia los agentes con <b>iniciar_oculto.vbs</b>. El panel atiende un solo PC.</div>';
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* sin permiso del portapapeles: se prueba el método antiguo */ }
    try {
      const t = document.createElement('textarea');
      t.value = texto; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e) { return false; }
  }
  function formularioInstalar() {
    const i = st.ins;
    if (!i || i.modo !== 'primera') return '';
    const opciones = i.pcs.length ? i.pcs.map(p => '<option value="' + esc(p.id) + '"' + (p.id === i.pc ? ' selected' : '') + (p.conectado ? '' : ' disabled') + '>' + esc(p.nombre) + ' · ' + esc(p.equipo) + (p.conectado ? '' : ' (desconectado)') + '</option>').join('') : '<option value="">No hay PC de agentes conectados</option>';
    return '<section class="tca-ins"><h3>Instalar TIENDA CLUB junto con los agentes de edición</h3>' +
      '<p>Se instala sola en el PC que elijas: el panel deja el código en la NAS, reinicia sus agentes y ellos se instalan y se enlazan al arrancar. No tienes que ejecutar nada.</p>' +
      '<label>PC DE LOS AGENTES<select data-ins-pc>' + opciones + '</select></label>' +
      '<label>DIRECCIÓN DEL PANEL<span class="tca-ins-fila"><input type="text" data-ins-url spellcheck="false" autocomplete="off" value="' + esc(i.url) + '"><button type="button" class="ag-btn sec" data-ins-copiar="url">📋 Copiar</button></span></label>' +
      '<label>CÓDIGO DE ENLACE<span class="tca-ins-fila"><input type="text" data-ins-token spellcheck="false" autocomplete="off" placeholder="Generando…" value="' + esc(i.token || '') + '"><button type="button" class="ag-btn sec" data-ins-copiar="token">📋 Copiar</button></span></label>' +
      '<p>Los dos campos se pueden copiar, borrar y pegar. Lo que veas aquí es lo que viaja al PC elegido (el código: 20 a 64 letras, números, guion o guion bajo; la dirección debe empezar por https://). Si dejas el código vacío se genera uno nuevo.</p>' +
      '<div class="tca-ins-bt"><button type="button" class="ag-btn" data-ins-ok' + (i.pc ? '' : ' disabled') + '>⬇ Instalar todo</button><button type="button" class="ag-btn sec" data-ins-descargar title="Descarga INSTALAR_TIENDA_CLUB.bat con la dirección y el código ya puestos">⬇ Descargar instalador (1 clic)</button><button type="button" class="ag-btn sec" data-ins-cancel>Cancelar</button></div>' +
      '<p><b>¿No se instaló solo?</b> Abre este panel en el PC de los agentes, pulsa «Descargar instalador» y ábrelo con doble clic. Ya trae el código: copia TIENDA CLUB desde la NAS, enlaza el PC y reinicia los agentes. No hay que escribir nada.</p></section>';
  }
  function interruptores() {
    const c = st.configuracion, pc = st.pc || {};
    const fila = (titulo, texto, on, attr, si, no) => '<section class="tca-sw"><div><h3>' + titulo + '</h3><p>' + texto + '</p></div><button type="button" class="tca-switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" ' + attr + (st.ocupado ? ' disabled' : '') + '>' + (on ? si : no) + '</button></section>';
    return fila('Estado de los agentes', c.tienda_club_activo ? 'Activos: toman las reprogramaciones aprobadas y las llevan paso a paso.' : 'Apagados: las reprogramaciones aprobadas se anotan en la cola, pero nadie las procesa.' + (pc.conectado ? '' : ' El PC aún no está conectado.'), !!c.tienda_club_activo, 'data-activar', 'ACTIVADO', 'DESACTIVADO') +
      fila('Programar de verdad', c.programar_de_verdad ? 'SELLO registra cada reprogramación en Producción (sin poner EDICIÓN en proceso).' : 'Modo prueba: SELLO solo verifica y deja la reprogramación «lista»; no escribe en Producción.', !!c.programar_de_verdad, 'data-programar', 'ACTIVADO', 'MODO PRUEBA');
  }
  function vistaPedidos() {
    const cola = '<div class="tca-cola">' + COLA.map(([k, n, tono]) => '<div data-lq="' + (st.trabajos.length ? Math.round(100 * (st.cola[k] || 0) / st.trabajos.length) : 0) + '" data-lq-tone="' + tono + '"><b>' + (st.cola[k] || 0) + '</b><span>' + n + '</span></div>').join('') + '</div>';
    const filas = st.trabajos.map(t => '<article class="tca-ped' + (t.etapa === 'errores' ? ' err' : '') + '"><div class="tca-hd"><b>Reprogramación #' + esc(t.numero) + (t.cotizacion ? ' · CO' + esc(t.cotizacion) : '') + ' · ' + esc(t.cliente) + '</b><small>' + esc(COLA.find(c => c[0] === t.etapa)?.[1] || t.etapa) + (t.prueba ? ' · prueba' : '') + ' · ' + esc(horaIso(t.modificada)) + '</small></div>' +
      '<em>' + esc(t.resultado) + '</em>' + (t.etapa === 'errores' ? '<div><button type="button" class="ag-btn sec" data-reintentar="' + esc(t.numero) + '">↻ Reintentar</button></div>' : '') + '</article>').join('');
    return cola + (filas || '<div class="ag-empty">Todavía no hay reprogramaciones aprobadas.</div>');
  }
  function vistaAgentes() {
    return '<div class="tca-ag">' + st.agentes.map(a => '<article style="--c:' + a.color + '"><h4>' + esc(a.nombre) + ' · ' + esc(a.titulo) + '</h4><small>' + esc(ETIQUETA[a.estado] || a.estado) + (a.ultima ? ' · ' + esc(a.ultima) : '') + '</small><ul>' + a.funciones.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></article>').join('') + '</div>';
  }
  function vistaRegistro() {
    return '<div class="tca-log" data-log>' + (st.log.length ? st.log.map(l => '<div class="' + esc(l.nivel) + '">' + esc(new Date(l.at * 1000).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' })) + ' · ' + esc(l.agente.toUpperCase()) + ' · ' + esc(l.texto) + '</div>').join('') : '<div class="ag-empty">Sin actividad todavía.</div>') + '</div>';
  }
  function pintar() {
    if (!panel) return;
    const raiz = panel.querySelector('.ag');
    if (!raiz.querySelector('[data-cab]')) raiz.innerHTML = '<div data-cab></div><div data-av></div><div data-con></div><div data-ins></div><div data-sw></div><nav class="ag-vtabs" style="display:flex" data-tabs></nav><div class="tca-body" data-cuerpo></div>';
    const poner = (sel, h) => { const el = raiz.querySelector(sel); if (el && el.__h !== h) { el.__h = h; el.innerHTML = h; } };
    poner('[data-cab]', encabezado()); poner('[data-av]', st.aviso ? '<div class="tca-aviso' + (st.avisoOk ? ' ok' : '') + '">' + esc(st.aviso) + '</div>' : ''); poner('[data-con]', conexion()); const claveIns = st.ins ? JSON.stringify([st.ins.modo, st.ins.pcs, st.ins.pc, !!st.ins.token]) : '';   // el formulario solo se redibuja si cambia su estructura, no mientras se escribe en los campos
    if (raiz.__claveIns !== claveIns) { raiz.__claveIns = claveIns; poner('[data-ins]', formularioInstalar()); } poner('[data-sw]', interruptores());
    poner('[data-tabs]', [['pedidos', 'REPROGRAMACIONES'], ['agentes', 'AGENTES'], ['registro', 'REGISTRO']].map(([id, n]) => '<button type="button" class="ag-vt' + (st.vista === id ? ' on' : '') + '" data-vt="' + id + '">' + n + (id === 'pedidos' && st.cola.errores ? ' ⚠' : '') + '</button>').join(''));
    const l0 = raiz.querySelector('[data-log]'), pegado = !l0 || l0.scrollHeight - l0.scrollTop - l0.clientHeight < 40, y = l0 ? l0.scrollTop : 0;
    poner('[data-cuerpo]', st.vista === 'pedidos' ? vistaPedidos() : st.vista === 'agentes' ? vistaAgentes() : vistaRegistro());
    const l = raiz.querySelector('[data-log]'); if (l) l.scrollTop = pegado ? l.scrollHeight : y;
  }
  async function cargar() {
    try {
      const e = await api(API + '/estado');
      st.agentes = e.agentes; st.pc = e.pc; st.cola = e.cola || {}; st.trabajos = e.trabajos || []; st.hoy = e.hoy || {}; st.configuracion = e.configuracion || {};
      const l = await api(API + '/log?desde=' + st.ultimo + '&limite=300');
      if (l.lineas.length) st.log = st.log.concat(l.lineas).slice(-600);
      st.ultimo = l.ultimo;
      if (st.aviso && /^(Cargando|No se pudo leer)/.test(st.aviso)) st.aviso = '';
      pintar();
    } catch (err) { st.aviso = err.message; pintar(); }
  }
  async function accion(fn) {
    if (st.ocupado) return;
    st.ocupado = true; st.aviso = ''; st.avisoOk = false;
    try { await fn(); } catch (err) { st.aviso = err.message; }
    st.ocupado = false;
    await cargar();
  }
  const ordenar = (id, a) => accion(() => post(API + '/agentes/' + id + '/' + a));
  async function aTodos(a, texto) {
    const vivos = st.agentes.filter(reiniciable);
    if (!vivos.length || !confirm(texto)) return;
    st.aviso = '';
    for (const x of vivos) { try { await post(API + '/agentes/' + x.id + '/' + a); } catch (err) { st.aviso = err.message; } }
    await cargar();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="tiendaclub"]')) return true;
    clonarEstilosAgentes();
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'tiendaclub';
    panel.innerHTML = '<div class="ag ec"><div class="ag-empty">Cargando AGENTES TIENDA CLUB…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="tiendaclub" type="button"><span class="nav-icon">TC</span><strong>TIENDA CLUB</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      st.token = null; st.aviso = '';
      cargar();
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 3000);
    });
    panel.addEventListener('input', e => {
      if (!st.ins) return;
      if (e.target.matches('[data-ins-token]')) st.ins.token = e.target.value.trim();
      else if (e.target.matches('[data-ins-url]')) st.ins.url = e.target.value.trim();
    });
    panel.addEventListener('focusin', e => { if (e.target.matches('[data-ins-token],[data-ins-url]')) setTimeout(() => { try { e.target.select(); } catch (x) { /* sin selección */ } }, 0); });
    panel.addEventListener('change', e => { if (e.target.matches('[data-ins-pc]') && st.ins) st.ins.pc = e.target.value; });
    panel.addEventListener('click', async e => {
      panel.querySelectorAll('details.ag-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.ag-menu-l button')) d.removeAttribute('open'); });
      const alt = e.target.closest('[data-alterna]');
      if (alt && !alt.disabled) { const a = st.agentes.find(x => x.id === alt.dataset.alterna); if (a) ordenar(a.id, vivo(a) ? 'detener' : 'iniciar'); return; }
      const vt = e.target.closest('[data-vt]');
      if (vt) { st.vista = vt.dataset.vt; pintar(); return; }
      const re = e.target.closest('[data-reintentar]');
      if (re) { accion(() => post(API + '/pedidos/' + re.dataset.reintentar + '/reintentar')); return; }
      const cp = e.target.closest('[data-copiar]');
      if (cp && st.token) {
        const que = cp.dataset.copiar, texto = que === 'url' ? st.token.url : que === 'token' ? st.token.token : st.token.url + '\n' + st.token.token;
        const ok = await copiar(texto);
        st.aviso = ok ? (que === 'ambos' ? 'Copiados la dirección y el código (uno por línea).' : que === 'url' ? 'Dirección copiada.' : 'Código copiado.') + ' Pégalo en el PC de los agentes.' : 'No pude copiar solo: selecciona el texto de arriba y cópialo con Ctrl+C.';
        st.avisoOk = ok; pintar(); return;
      }
      if (e.target.closest('[data-instalar]') && !e.target.closest('[disabled]')) {
        accion(async () => {
          const o = await api(API + '/instalar-todo/opciones');
          if (o.modo === 'actualizar') {
            if (!confirm('Se publica el código nuevo en la NAS y el PC de los agentes baja TODO el paquete (agentes de edición, ECOMMERCE y TIENDA CLUB) y lo reinicia. Lo que estén haciendo se corta y vuelven solos en ~30 segundos. ¿Continuar?')) return;
            const r = await post(API + '/instalar-todo', {});
            st.aviso = 'Pedido enviado al PC. Publicado en la NAS: ' + ((r.publicados || []).join(', ') || 'sin cambios') + (r.avisos && r.avisos.length ? ' · ' + r.avisos.join(' · ') : '') + '. Los agentes se reinician solos.'; st.avisoOk = true;
          } else {
            const conectado = (o.pcs || []).filter(p => p.conectado);
            st.ins = { modo: 'primera', url: o.url, pcs: o.pcs || [], pc: conectado.length === 1 ? conectado[0].id : '', token: '' };
            try { const c = await post(API + '/instalar-todo/codigo'); st.ins.token = c.token; st.ins.url = c.url || st.ins.url; } catch (err) { st.aviso = err.message; st.avisoOk = false; }
          }
        });
        return;
      }
      if (e.target.closest('[data-ins-descargar]')) {
        const t = ((panel.querySelector('[data-ins-token]') || {}).value || '').trim(), u = ((panel.querySelector('[data-ins-url]') || {}).value || '').trim();
        const a = document.createElement('a');
        a.href = API + '/instalador?token=' + encodeURIComponent(t) + '&url=' + encodeURIComponent(u);
        a.download = 'INSTALAR_TIENDA_CLUB.bat'; document.body.appendChild(a); a.click(); a.remove();
        st.aviso = 'Descargando INSTALAR_TIENDA_CLUB.bat. Ábrelo con doble clic en el PC de los agentes (si Windows pregunta, elige «Conservar» y «Ejecutar de todas formas»).'; st.avisoOk = true; pintar(); return;
      }
      const ic = e.target.closest('[data-ins-copiar]');
      if (ic && st.ins) {
        const campo = panel.querySelector(ic.dataset.insCopiar === 'url' ? '[data-ins-url]' : '[data-ins-token]'), ok = await copiar(campo ? campo.value : '');
        st.aviso = ok ? (ic.dataset.insCopiar === 'url' ? 'Dirección copiada.' : 'Código copiado.') : 'No pude copiar solo: selecciona el texto del campo y cópialo con Ctrl+C.';
        st.avisoOk = ok; pintar(); return;
      }
      if (e.target.closest('[data-ins-cancel]')) { st.ins = null; pintar(); return; }
      if (e.target.closest('[data-ins-ok]') && !e.target.closest('[disabled]')) {
        const pc = (panel.querySelector('[data-ins-pc]') || {}).value || '';
        if (!pc) { st.aviso = 'Elige el PC de los agentes.'; st.avisoOk = false; pintar(); return; }
        if (!confirm('Se reiniciarán los agentes de edición de ese PC (lo que estén haciendo se corta) para instalar TIENDA CLUB. Vuelven solos en ~30 segundos. ¿Continuar?')) return;
        accion(async () => {
          const r = await post(API + '/instalar-todo', { pc, token: ((panel.querySelector('[data-ins-token]') || {}).value || '').trim(), url: ((panel.querySelector('[data-ins-url]') || {}).value || '').trim() });
          st.ins = null;
          st.aviso = 'Listo: se está instalando en ' + (r.equipo || 'ese PC') + '. Sus agentes se reinician solos y TIENDA CLUB aparece conectada en 1 o 2 minutos. Publicado en la NAS: ' + ((r.publicados || []).join(', ') || 'sin cambios') + (r.avisos && r.avisos.length ? ' · ' + r.avisos.join(' · ') : '');
          st.avisoOk = true;
        });
        return;
      }
      if (e.target.matches('[data-ins-pc]')) { return; }
      if (e.target.closest('[data-detener-todo]') && !e.target.closest('[disabled]')) { aTodos('detener', '¿Detener a todos los agentes que están corriendo?'); return; }
      if (e.target.closest('[data-reiniciar-todo]') && !e.target.closest('[disabled]')) { aTodos('reiniciar', '¿Reiniciar a los agentes que están corriendo? Lo que estén haciendo se corta.'); return; }
      if (e.target.closest('[data-conectar]')) {
        if (st.pc && st.pc.hay_token && !confirm('Se creará un código nuevo y el PC actual dejará de conectarse hasta que lo vuelvas a enlazar. ¿Continuar?')) return;
        try { st.token = await api(API + '/conexion/regenerar', { method: 'POST' }); st.aviso = ''; } catch (err) { st.aviso = err.message; }
        pintar(); await cargar(); return;
      }
      const act = e.target.closest('[data-activar]');
      if (act && !act.disabled) { accion(() => post(API + '/configuracion/activar', { activo: !st.configuracion.tienda_club_activo })); return; }
      const prog = e.target.closest('[data-programar]');
      if (prog && !prog.disabled) {
        const quiere = !st.configuracion.programar_de_verdad;
        if (quiere && !confirm('SELLO empezará a registrar de verdad las reprogramaciones aprobadas en Producción. ¿Continuar?')) return;
        accion(() => post(API + '/configuracion/programar', { activo: quiere }));
      }
    });
    return true;
  }
  fetch(API + '/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;
    let intentos = 0;
    const espera = setInterval(() => { construir(); if (++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso confirmado: no se muestra */ });
})();
