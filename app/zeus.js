// AGENTE INVENTARIO: pantalla propia, se abre desde el menú de la cuenta (junto a Agentes y Ecommerce).
// Muestra al agente (estado, qué hace) y la lista de órdenes de compra de la tela que falta, por tela. Lee /api/zeus/estado.
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const cuando = () => new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ESTADO = { SIN_CONECTAR: ['Sin conectar', 'bad'], ESPERANDO_EFFI: ['Esperando acceso a Effi', 'warn'], LIBRE: ['Libre', 'ok'], TRABAJANDO: ['Creando orden de compra…', 'ok'], ERROR: ['Con error', 'bad'] };
  const COMPRA = { pendiente: ['Por comprar', 'warn'], entregada: ['Creándola en Effi…', 'warn'], creada: ['Orden creada', 'ok'], error: ['Con error', 'bad'], cancelada: ['Ya alcanza', ''] };
  let panel = null, tab = null, cuerpo = null, timer = null, correos = [], cuentaEnvia = '';

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
    return '<section class="bd-section"><h3>Correos que reciben la orden de compra <small>· solo los confirmados reciben órdenes</small></h3>' +
      '<div class="zeus-correos">' + (correos.length ? correos.map(chip).join('') : '<p class="bd-note">Todavía no hay correos. Agrega al encargado de pedir la tela.</p>') + '</div>' +
      '<form class="zeus-form" data-zeus-form autocomplete="off"><input type="email" name="correo" placeholder="correo@ejemplo.com" aria-label="Correo nuevo" required><button type="submit" class="bd-clear">Agregar y verificar</button></form>' +
      '<p class="bd-note zeus-msg" data-zeus-msg>Al agregar un correo le enviamos un mensaje' + (cuentaEnvia ? ' desde ' + esc(cuentaEnvia) : '') + '; su dueño tiene que abrirlo y confirmar. Hasta entonces no recibe órdenes.</p></section>';
  }

  function pintar(d) {
    const a = d.agente || {}, [etq, cls] = ESTADO[a.estado] || [a.estado || '—', ''];
    const avisos = [];
    if (!a.conectado) avisos.push('El AGENTE INVENTARIO del PC todavía no está conectado: las compras quedan en la lista y se crean cuando se conecte.');
    if (a.conectado && a.estado === 'ESPERANDO_EFFI') avisos.push('El AGENTE INVENTARIO no puede iniciar sesión en Effi (el ingreso de Effi está fallando). Cuando funcione, crea las órdenes de la lista.');
    if (d.correo && !d.correo.configurado) avisos.push('Falta configurar la cuenta de correo del servidor: sin ella no salen los mensajes de verificación ni las órdenes de compra.');
    const r = d.resumen || {};
    const agente = card({
      badge: 'Agente de inventario', badgeClass: cls, cls: cls === 'bad' ? 'bad' : '', name: 'AGENTE INVENTARIO', total: esc(etq), unit: a.titulo || '',
      extra: (a.ultima ? '<div class="bd-line"><span>' + esc(a.ultima) + '</span></div>' : '') + (a.funciones || []).map(f => '<div class="bd-line"><span>· ' + esc(f) + '</span></div>').join('') +
        '<div class="bd-line"><span>Compras</span><b>' + num(r.pendiente) + ' por comprar · ' + num(r.creada) + ' creadas</b></div>'
    });
    const compras = (d.items || []).map(i => {
      const [label, c] = COMPRA[i.estado] || [i.estado, ''];
      return card({
        badge: label, badgeClass: c, cls: c === 'bad' ? 'bad' : '', name: i.tela, total: num(i.falta) + '<small>MTS</small>',
        unit: i.estado === 'creada' ? 'Orden de compra ' + (i.oc || '(sin número)') : (i.detalle || ''),
        extra: (i.ordenes || []).map(o => '<div class="bd-line"><span>' + esc(o.orden) + ' · ' + esc(o.referencia) + '</span><b>' + num(o.falta) + ' MTS</b></div>').join('')
      });
    }).join('');
    correos = d.correos || [];
    cuentaEnvia = (d.correo && d.correo.configurado && d.correo.cuenta) || '';
    cuerpo.innerHTML = (avisos.length ? '<p class="bd-note">' + avisos.map(esc).join('<br>') + '</p>' : '') +
      '<div class="bd-cards fit">' + agente + '</div>' + correosHtml() +
      '<section class="bd-section"><h3>Órdenes de compra <small>· la tela que falta, por tela</small> <button type="button" class="bd-clear" data-zeus-revisar style="margin-left:auto;padding:6px 12px!important">Revisar ahora</button></h3>' +
      (compras ? '<div class="bd-cards">' + compras + '</div>' : '<p class="bd-note">No hay tela por comprar: todos los pedidos programados alcanzan.</p>') + '</section>';
  }

  async function cargar(silencioso) {
    if (silencioso === true && panel && panel.contains(document.activeElement) && document.activeElement.matches('input')) return;   // no se pisa lo que se está escribiendo
    try {
      const r = await fetch('/api/zeus/estado', { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || 'No fue posible consultar al agente de inventario');
      panel.querySelector('.bd-updated').textContent = 'Actualizado ' + cuando() + ' · se actualiza solo cada 30 s';
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
    panel.addEventListener('click', async e => {
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
