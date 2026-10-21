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
  /* ===== Efecto vidrio líquido ===== */
  .dr{position:relative;isolation:isolate;--gx:50%;--gy:0%}
  .dr::before,.dr::after{content:"";position:absolute;z-index:-1;border-radius:50%;filter:blur(70px);pointer-events:none;animation:drFlota 16s ease-in-out infinite alternate}
  .dr::before{width:460px;height:460px;left:-80px;top:-40px;background:radial-gradient(circle,rgba(255,122,89,.42),transparent 70%)}
  .dr::after{width:520px;height:520px;right:-100px;top:240px;background:radial-gradient(circle,rgba(70,190,170,.32),transparent 70%);animation-delay:-8s}
  .dr-hd,.dr-card,.dr-chat,.dr-vacio{--mx:50%;--my:0%;position:relative;overflow:hidden;
    background:linear-gradient(150deg,rgba(255,255,255,.16),rgba(255,255,255,.04) 45%,rgba(255,255,255,.08));
    border:1px solid rgba(255,255,255,.2);
    -webkit-backdrop-filter:blur(22px) saturate(1.7);backdrop-filter:blur(22px) saturate(1.7);
    box-shadow:0 14px 40px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 0 rgba(255,255,255,.06)}
  .dr-hd::before,.dr-card::before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity .25s;
    background:radial-gradient(320px circle at var(--mx) var(--my),rgba(255,255,255,.22),transparent 60%)}
  .dr-hd:hover::before,.dr-card:hover::before{opacity:1}
  .dr-hd::after,.dr-card::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;pointer-events:none;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.14),transparent);transform:skewX(-18deg);transition:left .8s ease}
  .dr-hd:hover::after,.dr-card:hover::after{left:130%}
  .dr-card>*,.dr-hd>*{position:relative;z-index:1}
  .dr-card{border-radius:20px;padding:18px 20px;animation:drIn .4s ease-out both;transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s,border-color .25s}
  .dr-card:hover{transform:translateY(-4px) scale(1.006);border-color:rgba(255,160,130,.55);box-shadow:0 22px 50px rgba(0,0,0,.45),0 0 0 1px rgba(255,122,89,.25),inset 0 1px 0 rgba(255,255,255,.45)}
  .dr-hd{border-radius:24px}.dr-hd h2{background:linear-gradient(90deg,#fff,#ffb39f);-webkit-background-clip:text;background-clip:text;color:transparent}
  .dr-top h4{font-size:22px}
  .dr-ref,.dr-arch,.dr-pill{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);background:rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.22);transition:transform .2s,background .2s}
  .dr-ref:hover,.dr-arch:hover{transform:translateY(-2px);background:rgba(255,255,255,.2)}
  .dr-pill.ok i{animation:drPulso 2s ease-out infinite}.dr-pill.mal i{animation:drPulsoMal 1.6s ease-out infinite}
  .dr-est{background:rgba(255,255,255,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
  .dr-b{border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.06));box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 4px 12px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
  .dr-b:active:not(:disabled){transform:scale(.97)}
  .dr-b.pri{background:linear-gradient(180deg,#ff9a7d,#e8573a);color:#fff;border-color:rgba(255,255,255,.35);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 6px 18px rgba(255,100,70,.4)}
  .dr-b.pri:hover:not(:disabled){background:linear-gradient(180deg,#ffae95,#f0674b);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 24px rgba(255,100,70,.55)}
  .dr-chat{border-radius:20px;padding:16px;scrollbar-width:thin}
  .dr-m{-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 4px 14px rgba(0,0,0,.2)}
  .dr-m.yo{background:linear-gradient(150deg,rgba(255,122,89,.4),rgba(255,122,89,.15));border-radius:16px 16px 4px 16px}
  .dr-m.bot{background:linear-gradient(150deg,rgba(255,255,255,.16),rgba(255,255,255,.05));border-radius:16px 16px 16px 4px}
  .dr-form input{border-radius:14px;background:rgba(255,255,255,.08);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:inset 0 1px 3px rgba(0,0,0,.35);transition:box-shadow .2s,border-color .2s}
  .dr-form input:focus{box-shadow:0 0 0 3px rgba(255,122,89,.28),inset 0 1px 3px rgba(0,0,0,.35)}
  .dr-rapidos button{background:rgba(255,255,255,.1);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:inset 0 1px 0 rgba(255,255,255,.22);transition:transform .2s,background .2s}
  .dr-rapidos button:hover{transform:translateY(-2px)}
  .dr-vacio{border-style:solid;border-radius:20px}
  .dr-grid{grid-template-columns:1fr}
  .dr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
  .dr-card{align-content:start}
  .dr-ref.p{border-color:#ff7a59;background:rgba(255,122,89,.22)}
  .dr-actv{display:grid;gap:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}.dr-actv.mal .dr-mas{color:#ffb39f}
  .dr-actv .dr-m{max-width:100%;font-size:12px;max-height:240px;overflow:auto}
  .dr-paus{background:rgba(255,200,80,.16);border-color:rgba(255,200,80,.5);color:#ffd98a}.dr-cancel{border-color:rgba(255,107,97,.6)!important;color:#ffb3ac!important}.dr-ctl .dr-b{flex:0 0 auto}.dr-ctl .dr-b.pri{flex:1}.dr-q{color:#ff9d83;font-weight:900}.dr-off{padding:6px 10px;border-radius:10px;background:rgba(255,107,97,.18);border:1px solid rgba(255,107,97,.45);color:#ffb39f;font:700 11px Arial}
  @keyframes drFlota{to{transform:translate(70px,50px) scale(1.18)}}
  @keyframes drPulso{0%{box-shadow:0 0 0 0 rgba(111,227,154,.6)}100%{box-shadow:0 0 0 10px rgba(111,227,154,0)}}
  @keyframes drPulsoMal{0%{box-shadow:0 0 0 0 rgba(255,107,97,.6)}100%{box-shadow:0 0 0 10px rgba(255,107,97,0)}}
  @media(prefers-reduced-motion:reduce){.dr::before,.dr::after,.dr-card,.dr-pill i{animation:none!important}}
  @media(max-width:980px){.dr::before,.dr::after{width:300px;height:300px;filter:blur(55px)}.dr-card{padding:15px}}
  `;
  document.head.appendChild(css);
  document.addEventListener('pointermove', e => {
    const t = e.target.closest && e.target.closest('.dr-card,.dr-hd'); if (!t) return;
    const r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  async function cargarCola() {
    try {
      const d = await api('/api/agentes/draco/cola');
      st.pausa = !!d.pausa; st.pc = d.pc || st.pc; st.ordenes = d.ordenes || []; st.cargada = true; st.aviso = '';
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
  function actividad(o) {
    const ms = st.msgs.filter(m => m.rol !== 'yo' && String(m.texto || '').includes(o.orden)).slice(-3);
    if (!ms.length) return '';
    const ab = !!st.abiertas['a:' + o.orden], prob = ms.some(m => /Con problemas|Error/.test(m.texto));
    return `<div class="dr-actv${prob ? ' mal' : ''}"><button type="button" class="dr-mas" data-act="${esc(o.orden)}">${ab ? '▾' : '▸'} Actividad de DRACO${prob ? ' · con problemas' : ''} (${ms.length})</button>` +
      (ab ? ms.map(m => `<div class="dr-m bot">${esc(m.texto.length > 900 ? m.texto.slice(0, 900) + '…' : m.texto)}<small>${esc(hora(m.creado))}</small></div>`).join('') : '') + `</div>`;
  }
  function tarjeta(o, r) {
    const e = estadoOrden({ referencias: [r], dxf: [] }), clave = o.orden + '|' + r.ref, abierta = !!st.abiertas[clave];
    const todos = o.dxf || [], conSub = todos.some(a => a.sub);
    const dxf = conSub ? todos.filter(a => String(a.sub || '').toUpperCase().includes(String(r.ref).toUpperCase())) : (o.referencias.length === 1 ? todos : []);
    const mostrar = abierta ? dxf : dxf.slice(0, 6);
    const lista = dxf.length
      ? `<div class="dr-lista">${mostrar.map(a => `<span class="dr-arch" title="${esc(a.nombre)}">${esc(a.nombre)}</span>`).join('')}</div>` + (dxf.length > 6 ? `<button type="button" class="dr-mas" data-mas="${esc(clave)}">${abierta ? 'Ver menos' : 'Ver los ' + dxf.length}</button>` : '')
      : (o.error ? `<span class="dr-err">${esc(o.error)}</span>` : `<span class="dr-nada">Todavía no hay DXF en CORTE PLT.</span>`);
    const bloqueado = !st.pc.conectado || st.esperando || st.enviando;
    const fin = dxf.length ? { t: dxf.length + ' DXF', c: 'hecho' } : e;
    const prob = st.msgs.some(m => m.rol !== 'yo' && /Con problemas|Error/.test(m.texto || '') && String(m.texto).includes(o.orden));
    return `<article class="dr-card" data-orden="${esc(o.orden)}"><div class="dr-top"><div><h4>${esc(r.ref)} <b class="dr-q">×${esc(r.cantidad || '?')}</b></h4><div class="dr-cli">${esc(o.orden)}${o.entrega ? ' · entrega ' + esc(o.entrega) : ''}</div></div><span class="dr-est ${fin.c}">${esc(fin.t)}</span></div>` +
      (st.pausa ? '<div class="dr-off dr-paus">EN PAUSA</div>' : (st.pc.conectado ? '' : '<div class="dr-off">PC sin conexión</div>')) +
      (prob ? `<div class="dr-actv mal"><button type="button" class="dr-mas" data-act="${esc(o.orden)}">⚠ Con problemas ${st.abiertas['a:' + o.orden] ? '▾' : '▸'}</button>${st.abiertas['a:' + o.orden] ? st.msgs.filter(m => m.rol !== 'yo' && String(m.texto || '').includes(o.orden)).slice(-1).map(m => `<div class="dr-m bot">${esc(m.texto.length > 700 ? m.texto.slice(0, 700) + '…' : m.texto)}</div>`).join('') : ''}</div>` : '') +
      `<div class="dr-acc dr-ctl"><button type="button" class="dr-b pri" data-crear="${esc(o.orden)}"${bloqueado ? ' disabled' : ''}>CREAR DXF</button><button type="button" class="dr-b" data-pausa="${st.pausa ? 0 : 1}">${st.pausa ? '▶' : '⏸'}</button><button type="button" class="dr-b dr-cancel" data-cancelar${st.pc.id ? '' : ' disabled'} title="Cancelar">⏹</button></div></article>`;
  }
  const burbuja = m => `<div class="dr-m ${m.rol === 'yo' ? 'yo' : 'bot'}${m.auto ? ' auto' : ''}">${esc(m.texto)}<small>${m.rol === 'yo' ? 'Tú' : (m.agentes && m.agentes.length ? m.agentes.join(' · ') : 'TAVO')} · ${esc(hora(m.creado))}</small></div>`;

  function pintar() {
    if (!panel) return;
    const caja = panel.querySelector('.dr'); if (!caja) return;
    const activo = document.activeElement;
    if (activo && activo.matches && activo.matches('.dr-form input') && activo.value) return;   // no se redibuja mientras la persona está escribiendo
    const firma = JSON.stringify([st.pausa, st.pc, st.ordenes, st.msgs.length, st.ultimo, st.esperando, st.aviso, st.cargada, st.abiertas, st.enviando]);
    if (firma === st.firma) return;
    st.firma = firma;
    const tarjetas = [].concat(...st.ordenes.map(o => o.referencias.map(r => tarjeta(o, r))));
    caja.innerHTML = (st.aviso ? `<div class="dr-aviso">${esc(st.aviso)}</div>` : '') +
      (st.cargada ? (tarjetas.length ? '<div class="dr-cards">' + tarjetas.join('') + '</div>' : '<div class="dr-vacio">No hay órdenes con tela de color pendientes de trazo.</div>') : '<div class="dr-vacio">Cargando…</div>');
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
      const pau = e.target.closest('[data-pausa]');
      if (pau) { const v = pau.dataset.pausa === '1'; api('/api/agentes/draco/pausa', { method: 'POST', body: JSON.stringify({ pausa: v }) }).then(() => { st.pausa = v; pintar(); }).catch(x => { st.aviso = x.message; pintar(); }); return; }
      const can = e.target.closest('[data-cancelar]');
      if (can && !can.disabled) { if (confirm('¿Cancelar lo que DRACO está haciendo? Si Illustrator/Mark estaba guardando un archivo, termina ese y no sigue con el resto.')) api('/api/agentes/detener', { method: 'POST', body: JSON.stringify({ pc: st.pc.id }) }).then(() => cargarChat()).then(pintar).catch(x => { st.aviso = x.message; pintar(); }); return; }
      const act = e.target.closest('[data-act]'); if (act) { const k = 'a:' + act.dataset.act; st.abiertas[k] = !st.abiertas[k]; pintar(); return; }
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
