// ZEUS · agente de inventario: pantalla propia, se abre desde el menú de la cuenta (junto a Agentes y Ecommerce).
// Muestra al agente (estado, qué hace) y la lista de órdenes de compra de la tela que falta, por tela. Lee /api/zeus/estado.
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const cuando = () => new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ESTADO = { SIN_CONECTAR: ['Sin conectar', 'bad'], ESPERANDO_EFFI: ['Esperando acceso a Effi', 'warn'], LIBRE: ['Libre', 'ok'], TRABAJANDO: ['Creando orden de compra…', 'ok'], ERROR: ['Con error', 'bad'] };
  const COMPRA = { pendiente: ['Por comprar', 'warn'], entregada: ['Creándola en Effi…', 'warn'], creada: ['Orden creada', 'ok'], error: ['Con error', 'bad'], cancelada: ['Ya alcanza', ''] };
  let panel = null, tab = null, cuerpo = null, timer = null;

  const card = ({ badge, badgeClass = '', name, total, unit = '', extra = '', cls = '' }) =>
    '<article class="inventory-item-card ' + cls + '"><span class="inv-badge ' + badgeClass + '">' + esc(badge) + '</span><strong class="inv-name">' + esc(name) + '</strong>' + extra +
    '<span class="inv-total">' + total + '</span>' + (unit ? '<span class="inv-unit">' + esc(unit) + '</span>' : '') + '</article>';

  function pintar(d) {
    const a = d.agente || {}, [etq, cls] = ESTADO[a.estado] || [a.estado || '—', ''];
    const avisos = [];
    if (!a.conectado) avisos.push('El agente ZEUS del PC todavía no está conectado: las compras quedan en la lista y se crean cuando se conecte.');
    if (a.conectado && a.estado === 'ESPERANDO_EFFI') avisos.push('ZEUS no puede iniciar sesión en Effi (el ingreso de Effi está fallando). Cuando funcione, crea las órdenes de la lista.');
    if (d.correo && !d.correo.configurado) avisos.push('Falta configurar el correo del servidor para avisar al encargado de pedir la tela.');
    const r = d.resumen || {};
    const agente = card({
      badge: 'Agente de inventario', badgeClass: cls, cls: cls === 'bad' ? 'bad' : '', name: 'ZEUS', total: esc(etq), unit: a.titulo || '',
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
    cuerpo.innerHTML = (avisos.length ? '<p class="bd-note">' + avisos.map(esc).join('<br>') + '</p>' : '') +
      '<div class="bd-cards fit">' + agente + '</div>' +
      '<section class="bd-section"><h3>Órdenes de compra <small>· la tela que falta, por tela</small> <button type="button" class="bd-clear" data-zeus-revisar style="margin-left:auto;padding:6px 12px!important">Revisar ahora</button></h3>' +
      (compras ? '<div class="bd-cards">' + compras + '</div>' : '<p class="bd-note">No hay tela por comprar: todos los pedidos programados alcanzan.</p>') + '</section>';
  }

  async function cargar(silencioso) {
    try {
      const r = await fetch('/api/zeus/estado', { cache: 'no-store', credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || 'No fue posible consultar a ZEUS');
      panel.querySelector('.bd-updated').textContent = 'Actualizado ' + cuando() + ' · se actualiza solo cada 30 s';
      pintar(d);
    } catch (e) { if (!silencioso) cuerpo.innerHTML = '<p class="bd-note">' + esc(e.message) + '</p>'; }
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="zeus"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'zeus';
    panel.innerHTML = '<div class="bd"><div class="bd-head"><div><h2>ZEUS · Agente de inventario</h2><p class="bd-updated">Cargando…</p></div><div class="bd-head-actions"><button type="button" class="bd-refresh">Actualizar</button></div></div><div class="bd-zeus-body"></div></div>';
    main.appendChild(panel);
    cuerpo = panel.querySelector('.bd-zeus-body'); cuerpo.style.display = 'grid'; cuerpo.style.gap = '22px';
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="zeus" type="button"><span class="nav-icon">ZE</span><strong>ZEUS</strong></button>';
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
    panel.addEventListener('click', async e => {
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
      boton.type = 'button'; boton.id = 'open-zeus'; boton.textContent = 'Inventario · ZEUS';
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
