/* DRACO: panel del agente de trazos (Optitex Mark 24), dentro de AGENTES.
   · Cola de TRAZOS: las órdenes con tela que no es blanca, con los DXF que ya están en la carpeta CORTE PLT de cada una.
   · Botones «Ver plan» y «Crear DXF» por orden, y una conversación propia con DRACO (el canal del PC AUTOMATIZACION).
   DRACO solo corre en el PC AUTOMATIZACION: aquí se le pide y se ve lo que responde. Se abre desde el robot de arriba (TRAZOS). */
(function () {
  if (window.__dracoPanel) return;
  window.__dracoPanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { pc: { id: '', nombre: 'AUTOMATIZACION', conectado: false, visto: '' }, ordenes: [], cargada: false, msgs: [], ultimo: 0, esperando: false, trabajo: null, aviso: '', abiertas: {}, enviando: false, firma: '', firmaChat: '' };
  let panel = null, tab = null, timer = 0;

  async function api(url, opciones) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opciones, headers: { 'Content-Type': 'application/json', ...((opciones || {}).headers || {}) } });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No se pudo completar la acción');
    return d;
  }
  const hace = iso => { if (!iso) return 'sin conexión reciente'; const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 90 ? 'ahora' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : s < 86400 ? 'hace ' + Math.round(s / 3600) + ' h' : 'hace ' + Math.round(s / 86400) + ' d'; };
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' }) : '';

  const css = document.createElement('style');
  css.textContent = `
  .dr{display:grid;gap:16px;padding:4px 0 30px;font-family:Arial,sans-serif;color:#e8f0e0}
  .dr-hd{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding:20px 22px;border:1px solid rgba(255,255,255,.14);border-radius:18px;background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02));-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
  .dr-hd small{font:800 10px Arial;letter-spacing:.18em;color:#ff7a59}.dr-hd h2{margin:4px 0 4px;font:900 26px Arial;letter-spacing:.06em}.dr-hd p{margin:0;font:13px/1.45 Arial;color:#a9b8a3;max-width:560px}
  .dr-pills{display:flex;flex-wrap:wrap;gap:8px}
  .dr-pill{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);font:700 12px Arial}
  .dr-pill i{width:9px;height:9px;border-radius:50%;background:#7c8a76}.dr-pill.ok i{background:#6fe39a;box-shadow:0 0 0 3px rgba(111,227,154,.18)}.dr-pill.mal i{background:#ff6b61}
  .dr-aviso{padding:11px 15px;border-radius:12px;background:#4a2412;color:#ffd9b0;font:13px Arial}
  .dr-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;align-items:start}
  .dr-col{display:grid;gap:12px}.dr-col>h3{margin:0;font:900 11px Arial;letter-spacing:.16em;color:#9fb096;display:flex;justify-content:space-between;align-items:center}
  .dr-col>h3 em{font:700 11px Arial;font-style:normal;letter-spacing:0;color:#7f8e79}
  .dr-vacio{padding:26px;border:1px dashed rgba(255,255,255,.2);border-radius:16px;text-align:center;color:#9fb096;font:13px/1.5 Arial}
  .dr-card{position:relative;padding:16px 18px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.015));display:grid;gap:11px;transition:border-color .2s,transform .2s}
  .dr-card:hover{border-color:rgba(255,255,255,.3);transform:translateY(-2px)}
  .dr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.dr-top h4{margin:0;font:900 18px Arial;letter-spacing:.04em}
  .dr-cli{font:12px/1.4 Arial;color:#a9b8a3;margin-top:3px}
  .dr-est{padding:5px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;border:1px solid rgba(255,255,255,.25);white-space:nowrap}
  .dr-est.hecho{background:#e6f3e4;color:#14301a;border-color:#e6f3e4}.dr-est.proc{background:rgba(255,122,89,.18);border-color:#ff7a59;color:#ffb39f}
  .dr-refs{display:flex;flex-wrap:wrap;gap:6px}.dr-ref{padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);font:700 11px Arial}
  .dr-ref b{color:#ff9d83}
  .dr-dxf{border-top:1px solid rgba(255,255,255,.1);padding-top:10px;display:grid;gap:8px}.dr-dxf>strong{font:800 11px Arial;letter-spacing:.08em;color:#c5d2bf}
  .dr-dxf .dr-lista{display:flex;flex-wrap:wrap;gap:6px}.dr-arch{padding:5px 9px;border-radius:8px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);font:600 11px Consolas,monospace;color:#d7e3d1}
  .dr-nada{font:12px Arial;color:#8e9d88}.dr-err{font:12px Arial;color:#ffb39f}
  .dr-mas{background:none;border:0;color:#ff9d83;font:700 11px Arial;cursor:pointer;padding:2px 0;text-align:left}
  .dr-acc{display:flex;flex-wrap:wrap;gap:8px}
  .dr-b{padding:10px 14px;border-radius:11px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#eef5ea;font:800 12px Arial;letter-spacing:.05em;cursor:pointer;transition:background .15s,transform .15s}
  .dr-b:hover:not(:disabled){background:rgba(255,255,255,.16);transform:translateY(-1px)}.dr-b:disabled{opacity:.45;cursor:default}
  .dr-b.pri{background:#ff7a59;border-color:#ff7a59;color:#2a0e06}.dr-b.pri:hover:not(:disabled){background:#ff9078}
  .dr-chat{display:grid;gap:10px;max-height:520px;overflow:auto;padding:14px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(0,0,0,.25);min-height:180px;align-content:start}
  .dr-m{max-width:94%;padding:10px 13px;border-radius:13px;font:13px/1.5 Arial;white-space:pre-wrap;overflow-wrap:anywhere;animation:drIn .25s ease-out}
  .dr-m.yo{justify-self:end;background:rgba(255,122,89,.18);border:1px solid rgba(255,122,89,.45)}.dr-m.bot{justify-self:start;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16)}
  .dr-m small{display:block;margin-top:5px;font:600 10px Arial;color:#8e9d88}
  .dr-m.auto small::after{content:" · automático";color:#ff9d83}
  .dr-pensando{font:12px Arial;color:#ffb39f;display:flex;align-items:center;gap:8px}.dr-pensando i{width:8px;height:8px;border-radius:50%;background:#ff7a59;animation:drLate 1s ease-in-out infinite}
  .dr-form{display:flex;gap:8px}.dr-form input{flex:1;min-width:0;height:44px;padding:0 13px;border-radius:11px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:#fff;font:14px Arial;outline:0}
  .dr-form input:focus{border-color:#ff7a59}
  .dr-rapidos{display:flex;flex-wrap:wrap;gap:6px}.dr-rapidos button{padding:7px 11px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:#d7e3d1;font:700 11px Arial;cursor:pointer}
  .dr-rapidos button:hover{background:rgba(255,255,255,.14)}
  @keyframes drIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes drLate{50%{transform:scale(1.5);opacity:.5}}
  @media(max-width:980px){.dr-grid{grid-template-columns:1fr}.dr-hd{padding:16px}.dr-hd h2{font-size:22px}}
  `;
  document.head.appendChild(css);

  async function cargarCola() {
    try {
      const d = await api('/api/agentes/draco/cola');
      st.pc = d.pc || st.pc; st.ordenes = d.ordenes || []; st.cargada = true; st.aviso = '';
    } catch (e) { st.aviso = e.message; }
  }
  async function cargarChat() {
    if (!st.pc.id) return;
    try {
      const d = await api('/api/agentes/mensajes?pc=' + encodeURIComponent(st.pc.id) + '&desde=' + (st.ultimo || 0));
      if (d.mensajes && d.mensajes.length) { st.msgs = st.msgs.concat(d.mensajes).slice(-60); st.ultimo = Math.max(st.ultimo, ...d.mensajes.map(m => m.id)); }
      st.esperando = !!d.esperando; st.trabajo = d.trabajo || null;
    } catch (e) { /* se reintenta en la siguiente vuelta */ }
  }
  async function enviar(texto) {
    texto = String(texto || '').trim(); if (!texto || st.enviando) return;
    if (!st.pc.id) { st.aviso = 'El PC AUTOMATIZACION todavía no está registrado en el panel.'; pintar(); return; }
    st.enviando = true; st.aviso = '';
    try { await api('/api/agentes/mensaje', { method: 'POST', body: JSON.stringify({ mensaje: texto, pc: st.pc.id }) }); await cargarChat(); }
    catch (e) { st.aviso = e.message; }
    st.enviando = false; pintar();
  }

  const estadoOrden = o => { const e = o.referencias.map(r => r.estado); return e.includes('en proceso') || e.includes('reproceso') ? { t: 'EN PROCESO', c: 'proc' } : (o.dxf && o.dxf.length ? { t: o.dxf.length + ' DXF', c: 'hecho' } : { t: 'PENDIENTE', c: '' }); };
  function tarjeta(o) {
    const e = estadoOrden(o), abierta = !!st.abiertas[o.orden], dxf = o.dxf || [], mostrar = abierta ? dxf : dxf.slice(0, 6);
    const lista = dxf.length
      ? `<div class="dr-lista">${mostrar.map(a => `<span class="dr-arch" title="${esc(a.sub ? a.sub + '\\' + a.nombre : a.nombre)}">${esc((a.sub ? a.sub + '/' : '') + a.nombre)}</span>`).join('')}</div>` + (dxf.length > 6 ? `<button type="button" class="dr-mas" data-mas="${esc(o.orden)}">${abierta ? 'Ver menos' : 'Ver los ' + dxf.length}</button>` : '')
      : (o.error ? `<span class="dr-err">${esc(o.error)}</span>` : `<span class="dr-nada">Todavía no hay DXF en la carpeta CORTE PLT${o.corte ? '' : ' (la carpeta se crea al generarlos)'}.</span>`);
    const bloqueado = !st.pc.conectado || st.esperando || st.enviando;
    return `<article class="dr-card" data-orden="${esc(o.orden)}"><div class="dr-top"><div><h4>${esc(o.orden)}</h4><div class="dr-cli">${esc(o.cliente)}${o.proyecto ? ' · ' + esc(o.proyecto) : ''}${o.entrega ? ' · entrega ' + esc(o.entrega) : ''}</div></div><span class="dr-est ${e.c}">${esc(e.t)}</span></div>` +
      `<div class="dr-refs">${o.referencias.map(r => `<span class="dr-ref">${esc(r.ref)} <b>×${esc(r.cantidad || '?')}</b></span>`).join('')}</div>` +
      `<div class="dr-dxf"><strong>DXF EN CORTE PLT</strong>${lista}</div>` +
      `<div class="dr-acc"><button type="button" class="dr-b" data-plan="${esc(o.orden)}"${bloqueado ? ' disabled' : ''}>VER PLAN</button><button type="button" class="dr-b pri" data-crear="${esc(o.orden)}"${bloqueado ? ' disabled' : ''}>CREAR DXF</button>` +
      `<button type="button" class="dr-b" data-copiar="${esc(o.corte || (o.carpeta ? o.carpeta + '\\CORTE PLT' : ''))}"${o.carpeta || o.corte ? '' : ' disabled'}>COPIAR CARPETA</button></div></article>`;
  }
  const burbuja = m => `<div class="dr-m ${m.rol === 'yo' ? 'yo' : 'bot'}${m.auto ? ' auto' : ''}">${esc(m.texto)}<small>${m.rol === 'yo' ? 'Tú' : (m.agentes && m.agentes.length ? m.agentes.join(' · ') : 'TAVO')} · ${esc(hora(m.creado))}</small></div>`;

  function pintar() {
    if (!panel) return;
    const caja = panel.querySelector('.dr'); if (!caja) return;
    const activo = document.activeElement;
    if (activo && activo.matches && activo.matches('.dr-form input') && activo.value) return;   // no se redibuja mientras la persona está escribiendo
    const firma = JSON.stringify([st.pc, st.ordenes, st.msgs.length, st.ultimo, st.esperando, st.aviso, st.cargada, st.abiertas, st.enviando]);
    if (firma === st.firma) return;
    st.firma = firma;
    const chat = caja.querySelector('.dr-chat'), alFinal = chat ? chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 30 : true, valor = (caja.querySelector('.dr-form input') || {}).value || '';
    caja.innerHTML =
      `<header class="dr-hd"><div><small>AGENTE DE TRAZOS</small><h2>DRACO</h2><p>Crea un trazo (un DXF) por cada talla en Optitex Mark y lo guarda en la carpeta CORTE PLT de la orden. Solo corre en el PC AUTOMATIZACIÓN; aquí le pides y ves lo que hace.</p></div>` +
      `<div class="dr-pills"><span class="dr-pill ${st.pc.conectado ? 'ok' : 'mal'}"><i></i>PC AUTOMATIZACIÓN · ${st.pc.conectado ? 'conectado' : (st.pc.id ? 'sin conexión (' + esc(hace(st.pc.visto)) + ')' : 'no registrado')}</span>` +
      `<span class="dr-pill ok"><i></i>Se activa con «P» en TRAZO/CORTE/PLT</span></div></header>` +
      (st.aviso ? `<div class="dr-aviso">${esc(st.aviso)}</div>` : '') +
      `<div class="dr-grid"><section class="dr-col"><h3>COLA DE TRAZOS <em>${st.ordenes.length} ${st.ordenes.length === 1 ? 'orden' : 'órdenes'}</em></h3>` +
      (st.cargada ? (st.ordenes.length ? st.ordenes.map(tarjeta).join('') : '<div class="dr-vacio">No hay órdenes con tela de color pendientes de trazo.</div>') : '<div class="dr-vacio">Cargando…</div>') + `</section>` +
      `<section class="dr-col"><h3>CONVERSACIÓN CON DRACO <em>canal del PC AUTOMATIZACIÓN</em></h3>` +
      `<div class="dr-chat">${st.msgs.length ? st.msgs.map(burbuja).join('') : '<div class="dr-nada">Escribe «draco ayuda» para ver lo que puede hacer.</div>'}${st.esperando ? '<div class="dr-pensando"><i></i>' + esc(st.trabajo && st.trabajo.msg ? st.trabajo.msg : 'DRACO está trabajando…') + '</div>' : ''}</div>` +
      `<div class="dr-rapidos"><button type="button" data-q="draco ayuda">Ayuda</button><button type="button" data-q="draco codigo ">Ver un código</button><button type="button" data-q="draco tallas ">Plan por tallas</button><button type="button" data-q="draco plan ">Plan de una orden</button><button type="button" data-q="draco trazo ">Crear DXF de una orden</button></div>` +
      `<form class="dr-form"><input type="text" autocomplete="off" placeholder="draco … (ej. draco plan RM7664)" value="${esc(valor)}"><button type="submit" class="dr-b pri"${st.enviando || st.esperando ? ' disabled' : ''}>ENVIAR</button></form></section></div>`;
    const c2 = caja.querySelector('.dr-chat'); if (c2 && alFinal) c2.scrollTop = c2.scrollHeight;
  }

  async function vuelta() {
    if (!panel || !panel.classList.contains('active') || document.hidden) return;
    await cargarCola(); await cargarChat(); pintar();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="draco"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'draco';
    panel.innerHTML = '<div class="dr"></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="draco" type="button"><span class="nav-icon">DR</span><strong>DRACO</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      st.firma = ''; pintar(); vuelta();
      clearInterval(timer); timer = setInterval(vuelta, 3500);
    });
    panel.addEventListener('click', e => {
      const q = e.target.closest('[data-q]'); if (q) { const i = panel.querySelector('.dr-form input'); if (i) { i.value = q.dataset.q; i.focus(); } return; }
      const plan = e.target.closest('[data-plan]'); if (plan && !plan.disabled) { enviar('draco plan ' + plan.dataset.plan); return; }
      const crear = e.target.closest('[data-crear]');
      if (crear && !crear.disabled) { if (confirm('¿Crear los DXF de ' + crear.dataset.crear + '? DRACO los guarda en la carpeta CORTE PLT de la orden (lo que ya existe no se reemplaza).')) enviar('draco trazo ' + crear.dataset.crear); return; }
      const mas = e.target.closest('[data-mas]'); if (mas) { st.abiertas[mas.dataset.mas] = !st.abiertas[mas.dataset.mas]; pintar(); return; }
      const cp = e.target.closest('[data-copiar]'); if (cp && cp.dataset.copiar) { try { navigator.clipboard.writeText(cp.dataset.copiar); cp.textContent = 'COPIADA ✓'; setTimeout(() => { cp.textContent = 'COPIAR CARPETA'; }, 1400); } catch (x) { /* sin portapapeles */ } }
    });
    panel.addEventListener('submit', e => { e.preventDefault(); const i = panel.querySelector('.dr-form input'); if (!i) return; const t = i.value; i.value = ''; enviar(/^\s*(draco|trazo)/i.test(t) ? t : 'draco ' + t); });
    return true;
  }

  fetch('/api/agentes/estado', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;
    let intentos = 0;
    const espera = setInterval(() => { if (construir() || ++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso a Agentes: no se muestra */ });
})();
