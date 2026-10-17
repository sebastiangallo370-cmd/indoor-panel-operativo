// AGENTE INVENTARIO: pantalla propia, se abre desde el menú de la cuenta (junto a Agentes y Ecommerce).
// Muestra al agente (estado, qué hace) y la lista de órdenes de compra de la tela que falta, por tela. Lee /api/zeus/estado.
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const cuando = () => new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ESTADO = { SIN_CONECTAR: ['Sin conectar', 'bad'], ESPERANDO_EFFI: ['Esperando acceso a Effi', 'warn'], LIBRE: ['Libre', 'ok'], TRABAJANDO: ['Creando orden de compra…', 'ok'], ERROR: ['Con error', 'bad'] };
  const COMPRA = { pendiente: ['Por comprar', 'warn'], entregada: ['Creándola en Effi…', 'warn'], creada: ['Orden creada', 'ok'], error: ['Con error', 'bad'], cancelada: ['Ya alcanza', ''] };
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
    if (e.estado === 'pendiente' || e.estado === 'entregada') return '<div class="zeus-envio"><span class="zeus-envio-est">⏳ Enviando al proveedor…</span></div>';
    if (e.estado === 'enviada') return '<div class="zeus-envio"><span class="zeus-envio-est ok">✔ Enviada a ' + esc(e.correo || 'el proveedor') + (fecha ? ' · ' + esc(fecha) : '') + '</span>' +
      '<button type="button" class="zeus-envio-btn suave" data-zeus-prov="' + i.id + '" data-otra="1">Enviar otra vez</button></div>';
    return '<div class="zeus-envio">' + (e.estado === 'error' ? '<span class="zeus-envio-est mal">⚠ ' + esc(e.detalle || 'No se pudo enviar') + '</span>' : '') +
      '<button type="button" class="zeus-envio-btn" data-zeus-prov="' + i.id + '" data-oc="' + esc(i.oc) + '">✉ Enviar orden al proveedor</button></div>';
  }

  function pintar(d) {
    const a = d.agente || {}, [etq, cls] = ESTADO[a.estado] || [a.estado || '—', ''];
    const avisos = [];
    if (!a.conectado) avisos.push('El agente no está conectado: las compras esperan en la lista.');
    if (a.conectado && a.estado === 'ESPERANDO_EFFI') avisos.push('El agente no puede entrar a Effi por ahora.');
    if (d.correo && !d.correo.configurado) avisos.push('Falta configurar el correo del servidor.');
    const r = d.resumen || {};
    const agente = card({
      badge: 'Agente de inventario', badgeClass: cls, cls: cls === 'bad' ? 'bad' : '', name: 'AGENTE INVENTARIO', total: a.estado === 'LIBRE' ? '' : esc(etq), unit: '',
      extra: '<div class="bd-line"><span>Compras</span><b>' + num(r.pendiente) + ' por comprar · ' + num(r.creada) + ' creadas</b></div>' +
        (a.ultima && (cls === 'bad' || a.estado === 'TRABAJANDO') ? '<div class="bd-line"><span>' + esc(String(a.ultima).slice(0, 110)) + '</span></div>' : '') +
        ((a.funciones || []).length ? '<details class="zeus-que"><summary>¿Qué hace?</summary>' + a.funciones.map(f => '<div class="bd-line"><span>· ' + esc(f) + '</span></div>').join('') + '</details>' : '')
    });
    const compras = (d.items || []).map(i => {
      const [label, c] = COMPRA[i.estado] || [i.estado, ''];
      return card({
        badge: label, badgeClass: c, cls: c === 'bad' ? 'bad' : '', name: i.tela, total: num(i.falta) + '<small>MTS</small>',
        unit: i.estado === 'creada' ? 'Orden de compra ' + (i.oc || '(sin número)') : (i.detalle || ''),
        extra: (i.ordenes || []).map(o => '<div class="bd-line"><span>' + esc(o.orden) + ' · ' + esc(o.referencia) + '</span><b>' + num(o.falta) + ' MTS</b></div>').join('') + envioHtml(i)
      });
    }).join('');
    correos = d.correos || [];
    notificar = d.notificar || [];
    usuariosPanel = d.usuarios || [];
    cuentaEnvia = (d.correo && d.correo.configurado && d.correo.cuenta) || '';
    cuerpo.innerHTML = (avisos.length ? '<p class="bd-note">' + avisos.map(esc).join('<br>') + '</p>' : '') +
      '<div class="bd-cards fit">' + agente + '</div>' + correosHtml() + notificarHtml() +
      '<section class="bd-section"><h3>Órdenes de compra <button type="button" class="bd-clear" data-zeus-revisar style="margin-left:auto;padding:6px 12px!important">Revisar ahora</button></h3>' +
      (compras ? '<div class="bd-cards">' + compras + '</div>' : '<p class="bd-note">Nada por comprar: la tela alcanza.</p>') + '</section>';
  }

  async function cargar(silencioso) {
    if (silencioso === true && panel && panel.contains(document.activeElement) && document.activeElement.matches('input')) return;   // no se pisa lo que se está escribiendo
    try {
      const r = await fetch('/api/zeus/estado', { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || 'No fue posible consultar al agente de inventario');
      panel.querySelector('.bd-updated').textContent = 'Actualizado ' + cuando();
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
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(true); }, 30000);
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
