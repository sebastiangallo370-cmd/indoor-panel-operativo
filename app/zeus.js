// AGENTE INVENTARIO: pantalla propia, se abre desde el menú de la cuenta (junto a Agentes y Ecommerce).
// Muestra al agente (estado, qué hace) y la lista de órdenes de compra de la tela que falta, por tela. Lee /api/zeus/estado.
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const cuando = () => new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ESTADO = { SIN_CONECTAR: ['Sin conectar', 'bad'], ESPERANDO_EFFI: ['Esperando acceso a Effi', 'warn'], LIBRE: ['Libre', 'ok'], TRABAJANDO: ['Creando orden de compra…', 'ok'], ERROR: ['Con error', 'bad'] };
  const COMPRA = { pendiente: ['Por comprar', 'warn'], entregada: ['Creándola en Effi…', 'warn'], creada: ['Orden creada', 'ok'], error: ['Con error', 'bad'], cancelada: ['Ya alcanza', ''] };
  let vista = 'ordenes', filtroOrd = 'todas', datosZ = null, firmaZ = '', animarVista = false, kpiPrev = {}, tickZ = 0, baseHace = null, baseAt = 0;
  let panel = null, tab = null, cuerpo = null, timer = null, correos = [], cuentaEnvia = '', notificar = [], usuariosPanel = [], notAbierto = false, notBuscar = '';

  const card = ({ badge, badgeClass = '', name, total, unit = '', extra = '', cls = '' }) =>
    '<article class="inventory-item-card ' + cls + '"><span class="inv-badge ' + badgeClass + '">' + esc(badge) + '</span><strong class="inv-name">' + esc(name) + '</strong>' + extra +
    '<span class="inv-total">' + total + '</span>' + (unit ? '<span class="inv-unit">' + esc(unit) + '</span>' : '') + '</article>';

  function correosHtml() {
    const chip = c => {
      const ok = c.estado === 'verificado';
      return '<span class="zeus-chip ' + (ok ? 'ok' : 'pend') + '"><span class="zeus-estado">' + (ok ? '✔' : '⏳') + '</span><span>' + esc(c.correo) + '<small>' +
        (ok ? 'Confirmado' : 'Pendiente de confirmar' + (c.detalle ? ' · ' + esc(c.detalle) : ' · el mensaje de verificación ya salió')) + '</small></span>' +
        (ok ? '' : '<button type="button" class="zeus-reenviar" data-zeus-reenviar="' + esc(c.correo) + '">Reenviar</button>') +
        '<button type="button" data-zeus-quitar="' + esc(c.correo) + '" aria-label="Quitar ' + esc(c.correo) + '">✕</button></span>';
    };
    return '<section class="bd-section"><h3 title="Solo los correos confirmados reciben las órdenes">Correos que reciben la orden</h3>' +
      '<div class="zeus-correos">' + (correos.length ? correos.map(chip).join('') : '<p class="bd-note">Sin correos todavía.</p>') + '</div>' +
      '<form class="zeus-form" data-zeus-form autocomplete="off"><input type="email" name="correo" placeholder="correo@ejemplo.com" aria-label="Correo nuevo" required><button type="submit" class="bd-clear">Agregar y verificar</button></form>' +
      '<p class="bd-note zeus-msg" data-zeus-msg title="' + esc('Al agregar un correo se le envía un mensaje' + (cuentaEnvia ? ' desde ' + cuentaEnvia : '') + '; hasta que su dueño lo confirme no recibe órdenes.') + '"></p></section>';
  }

  const nombreDe = u => (usuariosPanel.find(x => x.nombre.toLowerCase() === String(u).toLowerCase()) || { completo: u }).completo;
  function notificarHtml() {
    const marcados = new Set((notificar || []).map(u => u.toLowerCase()));
    const q = notBuscar.trim().toLowerCase();
    const lista = usuariosPanel.filter(u => !q || (u.completo + ' ' + u.nombre + ' ' + u.proceso).toLowerCase().includes(q));
    const elegidos = usuariosPanel.filter(u => marcados.has(u.nombre.toLowerCase()));
    return '<section class="bd-section"><h3 title="Les suena la campana cuando se envía una orden de compra (7 días)">Notificar en la página</h3>' +
      '<div class="zeus-sel' + (notAbierto ? ' abierto' : '') + '">' +
      '<button type="button" class="zeus-sel-btn" data-zeus-abrir aria-expanded="' + (notAbierto ? 'true' : 'false') + '"><span>' + (elegidos.length ? elegidos.length + ' usuario' + (elegidos.length === 1 ? '' : 's') + ' elegido' + (elegidos.length === 1 ? '' : 's') : 'Elegir usuarios…') + ' <em>de ' + usuariosPanel.length + '</em></span><i>▾</i></button>' +
      (notAbierto ? '<div class="zeus-sel-menu"><input type="text" name="zeus-filtro-usuarios" data-zeus-nbuscar autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="Buscar por nombre o proceso…" value="' + esc(notBuscar) + '" aria-label="Buscar usuario">' +
        '<div class="zeus-sel-lista">' + (lista.length ? lista.map(u => '<label class="zeus-opt' + (marcados.has(u.nombre.toLowerCase()) ? ' on' : '') + '"><input type="checkbox" data-zeus-notificar value="' + esc(u.nombre) + '"' + (marcados.has(u.nombre.toLowerCase()) ? ' checked' : '') + '><span>' + esc(u.completo) + (u.nombre !== u.completo ? ' <small>(' + esc(u.nombre) + ')</small>' : '') + (u.proceso ? '<small class="zeus-proc">' + esc(u.proceso) + '</small>' : '') + '</span></label>').join('') : '<p class="bd-note">Ningún usuario coincide.</p>') + '</div></div>' : '') + '</div>' +
      '<div class="zeus-usuarios">' + (elegidos.length ? elegidos.map(u => '<span class="zeus-uchip on"><span>' + esc(u.completo) + '</span><button type="button" data-zeus-quitar-user="' + esc(u.nombre) + '" aria-label="Quitar ' + esc(u.completo) + '">✕</button></span>').join('') : '<p class="bd-note">Nadie elegido.</p>') + '</div>' +
      '<p class="bd-note" data-zeus-notmsg></p></section>';
  }

  async function guardarNotificar(elegidos) {
    try {
      const d = await llamar('/api/zeus/notificar', 'PUT', { usuarios: elegidos });
      notificar = d.notificar;
      repintarNotificar('✓ Guardado: ' + (d.notificar.length ? d.notificar.map(nombreDe).join(', ') : 'nadie recibe la notificación'));
    } catch (err) { repintarNotificar(err.message); }
  }
  function repintarNotificar(mensaje) {
    const viejo = panel.querySelector('[data-zeus-notificar]')?.closest('.bd-section') || panel.querySelector('.zeus-sel')?.closest('.bd-section');
    if (!viejo) return;
    const lista = viejo.querySelector('.zeus-sel-lista'), scroll = lista ? lista.scrollTop : 0;
    const caja = document.createElement('div'); caja.innerHTML = notificarHtml();
    viejo.replaceWith(caja.firstElementChild);
    const nuevaLista = panel.querySelector('.zeus-sel-lista'); if (nuevaLista) nuevaLista.scrollTop = scroll;
    const m = panel.querySelector('[data-zeus-notmsg]'); if (m && mensaje) m.textContent = mensaje;
    const b = panel.querySelector('[data-zeus-nbuscar]'); if (b && document.activeElement === document.body && notBuscar) { b.focus(); b.setSelectionRange(notBuscar.length, notBuscar.length); }
  }

  function envioHtml(i) {
    if (i.estado !== 'creada' || !i.oc) return '';
    const e = i.envio_proveedor || {};
    const fecha = e.at ? String(e.at).replace('T', ' ').slice(0, 16) : '';
    if (e.estado === 'pendiente' || e.estado === 'entregada') return '<div class="zeus-envio"><span class="zeus-envio-est">⏳ Enviando…</span></div>';
    if (e.estado === 'enviada') return '<div class="zeus-envio"><span class="zeus-envio-est ok" title="' + esc('Enviada a ' + (e.correo || 'el proveedor') + (fecha ? ' · ' + fecha : '')) + '">✔ Enviada al proveedor</span>' +
      '<button type="button" class="zeus-envio-btn suave" data-zeus-prov="' + i.id + '" data-otra="1">Reenviar</button></div>';
    return '<div class="zeus-envio">' + (e.estado === 'error' ? '<span class="zeus-envio-est mal" title="' + esc(e.detalle || '') + '">⚠ No se pudo enviar</span>' : '') +
      '<button type="button" class="zeus-envio-btn" data-zeus-prov="' + i.id + '" data-oc="' + esc(i.oc) + '">✉ Enviar al proveedor</button></div>';
  }

  const PASOS = ['En cola', 'Creada', 'Enviada a encargado', 'Enviada a proveedor'];
  // {hecho: último punto cumplido (-1 ninguno), actual: punto en curso (-1 ninguno)}
  function paso(i) {
    const e = i.envio_proveedor || {};
    if (i.estado === 'pendiente' || i.estado === 'entregada') return { hecho: -1, actual: 0 };
    if (i.estado !== 'creada') return null;
    const encargado = i.encargado_enviado ?? /enviada a/i.test(i.detalle || '');
    if (e.estado === 'enviada') return { hecho: 3, actual: -1 };
    if (e.estado === 'pendiente' || e.estado === 'entregada') return { hecho: encargado ? 2 : 1, actual: 3 };
    return { hecho: encargado ? 2 : 1, actual: -1 };
  }
  const corto = t => { t = String(t || ''); return /Falta elegir el proveedor/i.test(t) ? 'Falta elegir el proveedor' : t.length > 60 ? t.slice(0, 57) + '…' : t; };
  const fechaCorta = v => { if (!v) return ''; const d = new Date(String(v).length <= 19 ? String(v) + 'Z' : v); return isNaN(d) ? String(v).slice(0, 16).replace('T', ' ') : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }); };
  const kv = (k, v, t) => v ? '<div class="zo-kv"><span>' + k + '</span><b' + (t ? ' title="' + esc(t) + '"' : '') + '>' + v + '</b></div>' : '';
  function ordenHtml(i, n) {
    const [label, c] = COMPRA[i.estado] || [i.estado, ''];
    const p = paso(i), ring = c === 'bad' ? 'bad' : c === 'warn' ? 'warn' : 'ok';
    const e = i.envio_proveedor || {};
    const pasos = !p ? '' : '<ol class="zo-pasos" style="--p:' + Math.max(p.hecho, p.actual, 0) + '">' + PASOS.map((t, k) => '<li title="' + esc(t) + '" class="' + (k === p.actual ? 'actual' : k <= p.hecho ? 'hecho' : '') + '"><i></i></li>').join('') + '</ol>' +
      '<div class="zo-paso-txt">' + esc(PASOS[p.actual >= 0 ? p.actual : p.hecho]) + '</div>';
    const verificados = (correos || []).filter(x => x.estado === 'verificado').map(x => x.correo);
    const peds = (i.ordenes || []).slice(0, 5).map(o => '<li><span>' + esc(o.orden) + ' · ' + esc(o.referencia) + (o.cliente ? ' <em>' + esc(String(o.cliente).slice(0, 26)) + '</em>' : '') + '</span><b>' + num(o.falta) + ' MTS</b></li>').join('');
    const datos = kv('Código de tela', esc(i.codigo)) + kv('Proveedor', esc(i.proveedor) || (i.estado === 'error' ? '<em class="zo-sin">sin elegir</em>' : '')) +
      kv('Creada', fechaCorta(i.creada || i.creado)) +
      (e.estado === 'enviada' ? kv('Al proveedor', esc(e.correo || 'enviada'), e.correo) + kv('Enviada', fechaCorta(e.at)) : '');
    return '<article class="zo ' + ring + '" style="--i:' + Math.min(n, 12) + '"><header><div><h4>' + esc(i.tela) + '</h4>' +
      '<span class="zo-badge">' + (i.estado === 'creada' && i.oc ? 'Orden ' + esc(i.oc) : esc(label)) + '</span></div>' +
      '<div class="zo-mts"><b data-n="' + Number(i.falta || 0) + '">' + num(i.falta) + '</b><small>MTS</small></div></header>' +
      (i.estado === 'error' || i.estado === 'cancelada' ? '<div class="zo-err">' + esc(corto(i.detalle)) + '</div>' : '') +
      pasos + (datos ? '<div class="zo-datos">' + datos + '</div>' : '') +
      (peds ? '<div class="zo-peds-t">Pedidos que la necesitan</div><ul class="zo-peds">' + peds + '</ul>' : '') + envioHtml(i) + '</article>';
  }
  function haceTxt(seg) {
    if (seg == null) return 'sin señal';
    if (seg < 5) return 'ahora mismo';
    if (seg < 60) return 'hace ' + seg + ' s';
    if (seg < 3600) return 'hace ' + Math.floor(seg / 60) + ' min';
    return 'hace ' + Math.floor(seg / 3600) + ' h';
  }
  function contar(el, hasta) {
    const desde = Number(kpiPrev[el.dataset.k] ?? 0); kpiPrev[el.dataset.k] = hasta;
    if (desde === hasta || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = hasta; return; }
    const t0 = performance.now(), dur = 600;
    (function paso(t) { const f = Math.min(1, (t - t0) / dur); el.textContent = Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - f, 3))); if (f < 1) requestAnimationFrame(paso); })(t0);
  }

  function pintar(d) {
    datosZ = d;
    const a = d.agente || {}, [etq, cls] = ESTADO[a.estado] || [a.estado || '—', ''];
    const r = d.resumen || {};
    correos = d.correos || [];
    notificar = d.notificar || [];
    usuariosPanel = d.usuarios || [];
    cuentaEnvia = (d.correo && d.correo.configurado && d.correo.cuenta) || '';
    baseHace = a.hace; baseAt = Date.now();
    const avisos = [];
    if (!a.conectado) avisos.push('El agente no está conectado: las compras esperan en la lista.');
    if (a.conectado && a.estado === 'ESPERANDO_EFFI') avisos.push('El agente no puede entrar a Effi por ahora.');
    if (d.correo && !d.correo.configurado) avisos.push('Falta configurar el correo del servidor.');
    const items = d.items || [];
    const visibles = items.filter(i => filtroOrd === 'todas' || (filtroOrd === 'pendiente' && (i.estado === 'pendiente' || i.estado === 'entregada')) || (filtroOrd === 'creada' && i.estado === 'creada') || (filtroOrd === 'error' && i.estado === 'error'));
    const estadoPill = a.estado === 'TRABAJANDO' ? 'trab' : cls === 'bad' ? 'bad' : cls === 'warn' ? 'warn' : 'ok';
    const etiqueta = a.estado === 'LIBRE' ? 'En línea' : etq;
    const kpi = (k, v, txt, f, tono) => '<button type="button" class="zk ' + tono + (filtroOrd === f && vista === 'ordenes' ? ' on' : '') + '" data-zeus-filtro="' + f + '"><b data-k="' + k + '" data-v="' + v + '">' + v + '</b><span>' + txt + '</span></button>';
    const hero = '<section class="zh ' + estadoPill + '"><div class="zh-estado"><span class="zh-punto"></span><div><strong' + ((a.funciones || []).length ? ' title="' + esc(a.funciones.join('\n')) + '"' : '') + '>' + esc(etiqueta) + '</strong><small><span data-zeus-hace>' + haceTxt(a.hace) + '</span></small></div></div>' +
      (a.ultima && (cls === 'bad' || a.estado === 'TRABAJANDO') ? '<p class="zh-ultima">' + esc(String(a.ultima).slice(0, 120)) + '</p>' : '') +
      '<div class="zh-acc"><button type="button" class="bd-clear" data-zeus-revisar>↻ Revisar</button></div>' +
      '</section>';
    const kpis = '<div class="zks">' + kpi('pend', (r.pendiente || 0) + (r.entregada || 0), 'Por comprar', 'pendiente', 'warn') + kpi('cre', r.creada || 0, 'Creadas', 'creada', 'ok') + kpi('err', r.error || 0, 'Con error', 'error', 'bad') + '</div>';
    const tabs = '<div class="zv-tabs" role="tablist">' + [['ordenes', 'Órdenes', items.length], ['correos', 'Correos', correos.length], ['notificar', 'Notificar', notificar.length]].map(([k, t, n]) =>
      '<button type="button" role="tab" class="zv-tab' + (vista === k ? ' on' : '') + '" data-zeus-vista="' + k + '">' + t + (n ? ' <em>' + n + '</em>' : '') + '</button>').join('') + '</div>';
    let contenido;
    if (vista === 'correos') contenido = correosHtml();
    else if (vista === 'notificar') contenido = notificarHtml();
    else contenido = '<section class="bd-section">' + (items.length ? '<div class="zo-lista">' + (visibles.length ? visibles.map(ordenHtml).join('') : '<p class="bd-note">Sin órdenes aquí.</p>') + '</div>' : '<p class="bd-note">Nada por comprar.</p>') + '</section>';
    cuerpo.innerHTML = (avisos.length ? '<p class="bd-note zeus-aviso">' + avisos.map(esc).join('<br>') + '</p>' : '') + '<div class="zrow">' + hero + kpis + '</div>' + tabs + '<div class="zv-vista' + (animarVista ? ' anima' : '') + '">' + contenido + '</div>';
    animarVista = false;
    cuerpo.querySelectorAll('.zk b[data-k]').forEach(el => contar(el, Number(el.dataset.v)));
    cuerpo.querySelectorAll('.zo-mts b[data-n]').forEach(el => { el.textContent = num(el.dataset.n); });
  }
  function repintarZ() { if (datosZ && panel) pintar(datosZ); }
  function tickHace() {
    if (!panel || !panel.classList.contains('active') || baseHace == null) return;
    const el = panel.querySelector('[data-zeus-hace]'); if (el) el.textContent = haceTxt(baseHace + Math.round((Date.now() - baseAt) / 1000));
  }

  async function cargar(silencioso) {
    if (silencioso === true && panel && panel.contains(document.activeElement) && document.activeElement.matches('input')) return;   // no se pisa lo que se está escribiendo
    try {
      const r = await fetch('/api/zeus/estado', { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || 'No fue posible consultar al agente de inventario');
      panel.querySelector('.bd-updated').textContent = '';
      const firma = JSON.stringify([d.items, d.resumen, d.correos, d.notificar, (d.agente || {}).estado, (d.agente || {}).conectado, (d.agente || {}).ultima]);
      if (silencioso === true && firma === firmaZ) { datosZ = d; baseHace = (d.agente || {}).hace; baseAt = Date.now(); return; }   // nada cambió: no se redibuja
      firmaZ = firma;
      pintar(d);
    } catch (e) { if (!silencioso) cuerpo.innerHTML = '<p class="bd-note">' + esc(e.message) + '</p>'; }
  }

  async function llamar(url, metodo, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.detail || 'No se pudo completar');
    return d;
  }
  async function accionCorreo(url, metodo, cuerpo, mensaje) {
    try {
      const d = await llamar(url, metodo, cuerpo);
      await cargar(false);
      const m = panel.querySelector('[data-zeus-msg]');
      if (m) m.textContent = d.enviado === false ? 'Quedó pendiente, pero ' + String(d.detalle || 'no se pudo enviar el mensaje de verificación').replace(/^./, ch => ch.toLowerCase()) : mensaje;
    } catch (e) { const m = panel.querySelector('[data-zeus-msg]'); if (m) m.textContent = e.message; }
  }

  const estilo = document.createElement('style');
  estilo.textContent = `
.zeus-correos{display:flex;flex-wrap:wrap;gap:8px}
.zeus-chip{display:inline-flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border:1px solid #46563f;border-radius:16px;background:#151d15;color:#dfe8d9;font:700 .8rem Arial;max-width:100%}
.zeus-chip>span{overflow-wrap:anywhere}
.zeus-chip small{display:block;font:600 .66rem Arial;color:#8a9485;letter-spacing:.03em}
.zeus-chip.ok{border-color:#3a9f55}.zeus-chip.ok .zeus-estado{color:#79d66f}
.zeus-chip.pend{border-color:#a8782b}.zeus-chip.pend .zeus-estado{color:#ffb04a}
.zeus-chip button{width:22px!important;height:22px!important;min-height:0!important;padding:0!important;border-radius:50%!important;border:0!important;background:rgba(255,255,255,.1)!important;color:#fff!important;cursor:pointer;line-height:1;flex:none}
.zeus-chip button.zeus-reenviar{width:auto!important;height:auto!important;padding:4px 10px!important;border-radius:999px!important;font:800 .68rem Arial!important;background:#1d2a14!important;color:#e7ff9a!important;border:1px solid #d0f44c!important}
.zeus-form{display:flex;gap:10px;flex-wrap:wrap}
.zeus-form input{flex:1 1 240px;min-width:0;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:10px 12px;font:500 16px Arial;outline:none;color-scheme:dark}
.zeus-form input:focus{border-color:#d0f44c}
.zeus-form .bd-clear{width:auto!important;padding:10px 18px!important}
/* vidrio sin color; el estado se ve en el aro de luz (rojo alerta, naranja intermedio, verde al día) */
.panel[data-panel="zeus"] .bd-head,.panel[data-panel="zeus"] .inventory-item-card,.zeus-chip{--r:#ffffff;background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.15),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.035))!important;border:1px solid rgba(255,255,255,.22)!important;-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px color-mix(in srgb,var(--r) 55%,transparent),0 0 16px -4px var(--r)!important;color:#fff}
.panel[data-panel="zeus"] .inventory-item-card.ok,.zeus-chip.ok{--r:#35d46a}
.panel[data-panel="zeus"] .inventory-item-card.warn,.zeus-chip.pend{--r:#ff9a1f}
.panel[data-panel="zeus"] .inventory-item-card.bad{--r:#ff4b3e}
.panel[data-panel="zeus"] .inventory-item-card .inv-badge{background:rgba(255,255,255,.14)!important;border:1px solid rgba(255,255,255,.3)!important;color:#fff!important}
.panel[data-panel="zeus"] .inventory-item-card .inv-total,.panel[data-panel="zeus"] .inventory-item-card .inv-unit{color:#fff!important}
.panel[data-panel="zeus"] .bd-refresh,.panel[data-panel="zeus"] .bd-clear{background:rgba(255,255,255,.1)!important;border:1px solid rgba(255,255,255,.3)!important;color:#fff!important}
.zeus-chip.ok,.zeus-chip.pend{border-color:rgba(255,255,255,.22)!important}
.zeus-form input{background:rgba(0,0,0,.28)!important;border:1px solid rgba(255,255,255,.2)!important}.zeus-form input:focus{border-color:rgba(255,255,255,.55)!important;box-shadow:0 0 0 3px rgba(255,255,255,.1)}
.zeus-envio{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14)}
.zeus-envio-est{flex:1 1 100%;font:700 .72rem Arial;color:#d3dccf}.zeus-envio-est.ok{color:#8bd450}.zeus-envio-est.mal{color:#ff9a9d}
.zeus-envio-btn{min-height:38px;padding:0 14px;border:1px solid rgba(255,255,255,.3);border-radius:12px;background:rgba(255,255,255,.92);color:#10140a;font:800 .74rem Arial;letter-spacing:.04em;cursor:pointer;width:100%!important;transition:transform .2s,background .2s}
.zeus-envio-btn:hover{transform:translateY(-1px);background:#fff}.zeus-envio-btn:disabled{opacity:.5;cursor:default}.zeus-envio-btn.suave{background:rgba(255,255,255,.1);color:#fff}
.panel[data-panel="zeus"] .inventory-item-card .inv-total:empty{display:none}
/* ---- panel dinámico ---- */
@keyframes zPulso{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--zc) 70%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes zEntra{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
@keyframes zFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.zh{--zc:#35d46a;position:relative;display:flex;flex-wrap:nowrap;align-items:center;gap:12px 14px;padding:8px 10px 8px 16px;border-radius:16px;border:1px solid rgba(255,255,255,.22);background:radial-gradient(120% 90% at 8% 0%,rgba(255,255,255,.15),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.035));-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px color-mix(in srgb,var(--zc) 45%,transparent),0 0 22px -6px var(--zc)}
.zh.warn{--zc:#ff9a1f}.zh.bad{--zc:#ff4b3e}.zh.trab{--zc:#6cb6ff}
.zh-estado{display:flex;align-items:center;gap:10px;flex:0 1 auto}.zh-estado strong{display:block;font-size:.95rem;letter-spacing:.01em}.zh-estado small{display:block;margin-top:1px;color:#b9c6b1;font:600 .68rem Arial}
.zh-punto{width:11px;height:11px;border-radius:50%;background:var(--zc);animation:zPulso 1.8s infinite;flex:none}
.zh.bad .zh-punto{animation-duration:1s}.zh.trab .zh-punto{animation-duration:.9s}
.zh-ultima{flex:1 1 100%;display:none;margin:0;color:#d3dccf;font:600 .78rem Arial}
.zh-acc{display:flex;gap:8px}.zh-acc .bd-clear{padding:7px 14px!important;border-radius:999px!important;min-height:0!important;font-size:.74rem!important}
.zh .zeus-que{flex:1 1 100%}
.panel[data-panel="zeus"] .bd-head{padding:10px 18px!important;min-height:0!important}.panel[data-panel="zeus"] .bd-head h2{font-size:1.05rem!important;margin:0!important}.panel[data-panel="zeus"] .bd-refresh{padding:6px 14px!important;min-height:0!important;font-size:.76rem!important}
.zrow{display:flex;flex-wrap:wrap;align-items:stretch;gap:10px}
.zks{display:flex;flex-wrap:wrap;gap:10px}
.zk{--zc:#fff;display:grid;gap:0;justify-items:start;padding:7px 52px 7px 14px;min-width:132px;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.13),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.1),rgba(255,255,255,.03));color:#fff;cursor:pointer;text-align:left;width:auto!important;transition:transform .2s,box-shadow .2s;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.35),0 0 0 1px color-mix(in srgb,var(--zc) 40%,transparent)}
.zk.warn{--zc:#ff9a1f}.zk.ok{--zc:#35d46a}.zk.bad{--zc:#ff4b3e}
.zk{position:relative;overflow:hidden}.zk::after{content:'';position:absolute;right:10px;top:50%;width:30px;height:30px;transform:translateY(-50%);border-radius:50%;background:color-mix(in srgb,var(--zc) 16%,transparent);border:1px solid color-mix(in srgb,var(--zc) 45%,transparent);display:grid;place-items:center;font:900 .85rem Arial;color:var(--zc);text-align:center;line-height:28px}
.zk.warn::after{content:'⏳'}.zk.ok::after{content:'✓'}.zk.bad::after{content:'!'}
.zk:hover{transform:translateY(-3px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),0 0 0 1px var(--zc),0 0 22px -4px var(--zc)}.zk.on{box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),0 0 0 2px var(--zc),0 0 24px -3px var(--zc)}
.zk b{font-size:1.25rem;line-height:1.1;font-variant-numeric:tabular-nums}.zk span{font:800 .56rem Arial;letter-spacing:.12em;text-transform:uppercase;color:#c9d3c4}
.zv-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.2);justify-self:start;max-width:100%;overflow-x:auto}
.zv-tab{min-height:38px;padding:0 18px;border:0;border-radius:999px;background:transparent;color:#c5d1bf;font:800 .74rem Arial;letter-spacing:.06em;cursor:pointer;width:auto!important;white-space:nowrap;transition:background .2s,color .2s}
.zv-tab:hover{background:rgba(255,255,255,.12)}.zv-tab.on{background:rgba(255,255,255,.92);color:#10140a}.zv-tab em{font-style:normal;margin-left:4px;opacity:.7}
.zv-vista.anima{animation:zFade .32s both}
.zo-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.zo{--r:#35d46a;display:grid;gap:10px;align-content:start;padding:16px 16px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.22);background:radial-gradient(120% 80% at 10% 0%,rgba(255,255,255,.14),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.035));-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.38),0 0 0 1px color-mix(in srgb,var(--r) 50%,transparent),0 0 16px -5px var(--r);animation:zEntra .45s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0)*55ms);transition:transform .2s,box-shadow .2s}
.zo.warn{--r:#ff9a1f}.zo.bad{--r:#ff4b3e}.zo:hover{transform:translateY(-3px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.5),0 0 0 1px var(--r),0 0 24px -3px var(--r)}
.zo header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.zo h4{margin:6px 0 0;font-size:1rem;letter-spacing:.01em}
.zo-badge{display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);font:800 .6rem Arial;letter-spacing:.1em;text-transform:uppercase}
.zo-mts{text-align:right}.zo-mts b{display:block;font-size:1.7rem;line-height:1;font-variant-numeric:tabular-nums}.zo-mts small{font:800 .6rem Arial;letter-spacing:.12em;color:#c9d3c4}
.zo-datos{display:grid;gap:5px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)}
.zo-kv{display:flex;justify-content:space-between;gap:12px;font:600 .72rem Arial;color:#b9c6b1}.zo-kv b{color:#fff;text-align:right;overflow-wrap:anywhere}.zo-sin{color:#ffb3ad;font-style:normal}
.zo-peds-t{font:800 .58rem Arial;letter-spacing:.14em;text-transform:uppercase;color:#a9b6a2;margin-top:2px}.zo-peds li em{font-style:normal;color:#9fb094;margin-left:4px}
.zo-paso-txt{margin-top:-2px;text-align:center;font:800 .66rem Arial;letter-spacing:.1em;text-transform:uppercase;color:#d3dccf}.panel[data-panel="zeus"] .bd-updated:empty{display:none}
.zo-oc{font:600 .78rem Arial;color:#d3dccf}.zo-oc b{font-size:.95rem;color:#fff}.zo-err{font:700 .74rem Arial;color:#ffb3ad;line-height:1.4}
.zo-pasos{list-style:none;margin:0;padding:10px 0 2px;display:grid;grid-template-columns:repeat(4,1fr);position:relative;overflow:hidden;
  background:linear-gradient(var(--r),var(--r)) 12.5% 16px/calc(75% * var(--p) / 3) 2px no-repeat,linear-gradient(rgba(255,255,255,.18),rgba(255,255,255,.18)) 12.5% 16px/75% 2px no-repeat}
.zo-pasos li{position:relative;z-index:1;display:grid;justify-items:center;gap:0;font:700 .56rem Arial;letter-spacing:.05em;text-transform:uppercase;color:#8f9d88;text-align:center;line-height:1.2}
.zo-pasos i{width:14px;height:14px;border-radius:50%;background:#1b241a;border:2px solid rgba(255,255,255,.3);z-index:1;transition:background .4s,border-color .4s}
.zo-pasos li.hecho{color:#d3dccf}.zo-pasos li.hecho i{background:var(--r);border-color:var(--r)}
.zo-pasos li.actual{color:#fff}.zo-pasos li.actual i{background:#fff;border-color:var(--r);animation:zPulso 1.6s infinite;--zc:var(--r)}
.zo-peds{list-style:none;margin:0;padding:8px 0 0;border-top:1px solid rgba(255,255,255,.12);display:grid;gap:4px}.zo-peds li{display:flex;justify-content:space-between;gap:10px;font:600 .72rem Arial;color:#c1ceb9}.zo-peds b{color:#fff;white-space:nowrap}
.zo .zeus-envio{margin-top:2px}
@media(max-width:700px){.zrow{flex-direction:column}.zh{flex-wrap:wrap}.zks{gap:8px}.zk{flex:1 1 0;min-width:0;padding:7px 40px 7px 12px}.zk::after{right:8px;width:26px;height:26px;line-height:24px}.zo-lista{grid-template-columns:1fr}.zh{padding:14px 14px}.zv-tab{padding:0 14px}}
@media(prefers-reduced-motion:reduce){.zo,.zv-vista.anima,.zh-punto,.zo-pasos li.actual i{animation:none}}
.zeus-que{margin-top:6px}.zeus-que summary{cursor:pointer;font:700 .7rem Arial;color:#b9c6b1;list-style:none}.zeus-que summary::-webkit-details-marker{display:none}.zeus-que summary::before{content:'ⓘ ';opacity:.8}.zeus-que[open] summary{margin-bottom:4px}
.zeus-msg:empty,[data-zeus-notmsg]:empty{display:none}
.zeus-sel{position:relative;max-width:460px}
.zeus-sel-btn{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%!important;min-height:44px;padding:0 16px;border:1px solid rgba(255,255,255,.25);border-radius:14px;background:rgba(255,255,255,.08);color:#fff;font:800 .82rem Arial;cursor:pointer;transition:background .2s}
.zeus-sel-btn:hover,.zeus-sel.abierto .zeus-sel-btn{background:rgba(255,255,255,.16)}.zeus-sel-btn i{font-style:normal;transition:transform .2s}.zeus-sel.abierto .zeus-sel-btn i{transform:rotate(180deg)}
.zeus-sel-menu{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 6px);padding:10px;border:1px solid rgba(255,255,255,.25);border-radius:16px;background:linear-gradient(160deg,rgba(40,48,38,.96),rgba(14,18,13,.97));-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);box-shadow:0 18px 40px -10px #000d,inset 0 1.5px 0 rgba(255,255,255,.3)}
.zeus-sel-menu input[type=search]{width:100%;box-sizing:border-box;min-height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(0,0,0,.3);color:#fff;font:500 16px Arial;outline:none;margin-bottom:8px}
.zeus-sel-lista{max-height:min(380px,52vh);overflow-y:auto;display:grid;gap:2px}
.zeus-opt{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;font:700 .8rem Arial;color:#dfe8d9}
.zeus-opt>span{display:flex;flex-direction:column;gap:1px;min-width:0}.zeus-opt small{font:600 .66rem Arial;color:#9fb094}.zeus-opt small.zeus-proc{text-transform:uppercase;letter-spacing:.06em}.zeus-sel-btn em{font-style:normal;font-weight:600;opacity:.7}
.zeus-opt:hover{background:rgba(255,255,255,.1)}.zeus-opt.on{background:rgba(53,212,106,.14);color:#fff}.zeus-opt input{accent-color:#35d46a;width:17px;height:17px;margin:0}
.zeus-uchip button{width:20px!important;height:20px!important;min-height:0!important;padding:0!important;border:0!important;border-radius:50%!important;background:rgba(255,255,255,.14)!important;color:#fff!important;cursor:pointer;line-height:1;margin-left:4px}
.zeus-usuarios{display:flex;flex-wrap:wrap;gap:8px}
.zeus-uchip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.06);cursor:pointer;font:700 .78rem Arial;transition:background .2s,box-shadow .2s;color:#dfe8d9}
.zeus-uchip input{accent-color:#35d46a;width:16px;height:16px;margin:0}
.zeus-uchip.on{background:rgba(255,255,255,.16);box-shadow:0 0 0 1px #35d46a,0 0 14px -4px #35d46a;color:#fff}
@media (max-width:700px){.zeus-chip{width:100%;box-sizing:border-box;flex-wrap:wrap}.zeus-chip>span:nth-child(2){flex:1 1 140px}}
`;
  document.head.appendChild(estilo);

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="zeus"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'zeus';
    panel.innerHTML = '<div class="bd"><div class="bd-head"><div><h2>AGENTE INVENTARIO</h2><p class="bd-updated">Cargando…</p></div><div class="bd-head-actions"><button type="button" class="bd-refresh">Actualizar</button></div></div><div class="bd-zeus-body"></div></div>';
    main.appendChild(panel);
    cuerpo = panel.querySelector('.bd-zeus-body'); cuerpo.style.display = 'grid'; cuerpo.style.gap = '22px';
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="zeus" type="button"><span class="nav-icon">AI</span><strong>AGENTE INVENTARIO</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar(false);
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(true); }, 10000);
      clearInterval(tickZ); tickZ = setInterval(tickHace, 1000);
    });
    panel.querySelector('.bd-refresh').addEventListener('click', () => cargar(false));
    panel.addEventListener('submit', e => {
      const f = e.target.closest('[data-zeus-form]');
      if (!f) return;
      e.preventDefault();
      const c = f.elements.correo.value.trim().toLowerCase();
      if (!c) return;
      if (!confirm('Vamos a enviar un mensaje de verificación a ' + c + '.\nSu dueño tiene que abrirlo y confirmar; hasta entonces no recibirá órdenes de compra.\n\n¿Enviar el mensaje?')) return;
      accionCorreo('/api/zeus/correos', 'POST', { correo: c }, 'Enviamos un mensaje a ' + c + '. Pídele que lo abra y confirme.');
    });
    panel.addEventListener('click', e => {
      const v = e.target.closest('[data-zeus-vista]');
      if (v && v.dataset.zeusVista !== vista) { vista = v.dataset.zeusVista; animarVista = true; repintarZ(); return; }
      const f = e.target.closest('[data-zeus-filtro]');
      if (f) { filtroOrd = filtroOrd === f.dataset.zeusFiltro ? 'todas' : f.dataset.zeusFiltro; if (vista !== 'ordenes') vista = 'ordenes'; animarVista = true; repintarZ(); }
    });
    panel.addEventListener('change', e => {
      if (!e.target.matches('[data-zeus-notificar]')) return;
      guardarNotificar([...panel.querySelectorAll('[data-zeus-notificar]:checked')].map(x => x.value).concat(
        notificar.filter(u => !panel.querySelector('[data-zeus-notificar][value="' + CSS.escape(u) + '"]'))));   // los que el buscador esconde se conservan
    });
    panel.addEventListener('input', e => {
      if (!e.target.matches('[data-zeus-nbuscar]')) return;
      notBuscar = e.target.value; repintarNotificar('');
      const b = panel.querySelector('[data-zeus-nbuscar]'); if (b) { b.focus(); b.setSelectionRange(notBuscar.length, notBuscar.length); }
    });
    document.addEventListener('click', e => {
      if (notAbierto && panel && !e.target.closest('.zeus-sel') && !e.target.closest('[data-zeus-quitar-user]')) { notAbierto = false; notBuscar = ''; repintarNotificar(''); }
    });
    panel.addEventListener('click', async e => {
      const ep = e.target.closest('[data-zeus-prov]');
      if (ep) {
        const otra = !!ep.dataset.otra;
        if (!confirm((otra ? 'Esta orden ya se envió. ¿Enviarla otra vez' : '¿Enviar la orden de compra' + (ep.dataset.oc ? ' ' + ep.dataset.oc : '')) + ' al correo del proveedor?\nEl proveedor recibirá la orden de Effi y un mensaje de Indoor Sport.')) return;
        ep.disabled = true;
        try { await llamar('/api/zeus/enviar-proveedor', 'POST', { id: Number(ep.dataset.zeusProv), otra_vez: otra }); } catch (err) { alert(err.message); }
        cargar(false); return;
      }
      const ab = e.target.closest('[data-zeus-abrir]');
      if (ab) { notAbierto = !notAbierto; if (!notAbierto) notBuscar = ''; repintarNotificar(''); const b = panel.querySelector('[data-zeus-nbuscar]'); if (b) b.focus(); return; }
      const qu = e.target.closest('[data-zeus-quitar-user]');
      if (qu) { guardarNotificar(notificar.filter(u => u.toLowerCase() !== qu.dataset.zeusQuitarUser.toLowerCase())); return; }
      const re = e.target.closest('[data-zeus-reenviar]');
      if (re) { accionCorreo('/api/zeus/correos/reenviar', 'POST', { correo: re.dataset.zeusReenviar }, 'Reenviamos el mensaje a ' + re.dataset.zeusReenviar + '.'); return; }
      const q = e.target.closest('[data-zeus-quitar]');
      if (q) {
        if (!confirm('¿Quitar ' + q.dataset.zeusQuitar + ' de las órdenes de compra?')) return;
        accionCorreo('/api/zeus/correos?correo=' + encodeURIComponent(q.dataset.zeusQuitar), 'DELETE', null, 'Quitado: ' + q.dataset.zeusQuitar);
        return;
      }
      const b = e.target.closest('[data-zeus-revisar]');
      if (!b) return;
      b.disabled = true;
      try { await fetch('/api/zeus/sincronizar', { method: 'POST', credentials: 'same-origin' }); } catch (_) { /* se vuelve a leer igual */ }
      cargar(false);
    });
    return true;
  }

  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-zeus');
    const previo = document.getElementById('open-bitacora') || document.getElementById('open-ecommerce') || document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-zeus'; boton.textContent = 'Agente inventario';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;   // una sola vez: si cada módulo reacomodara su botón, se pelearían y el menú se vería moviéndose
    if (previo) previo.insertAdjacentElement('afterend', boton);
    else if (!boton.isConnected) menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/ecommerce/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;   // mismo público que Agentes / Ecommerce: Administración y Coordinación
    let intentos = 0;
    const espera = setInterval(() => {
      if (construir()) ponerEnMenu();
      if (++intentos > 40) clearInterval(espera);
    }, 400);
  }).catch(() => { /* sin acceso confirmado: no se muestra */ });
})();
