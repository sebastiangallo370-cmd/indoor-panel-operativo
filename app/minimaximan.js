/* MINIMAXIMAN · agente de inventario que mantiene cada tela entre su stock mínimo y su stock máximo.
   Pantalla propia (menú de la cuenta → MINIMAXIMAN), como «Agente inventario»: interruptor, resumen y lista de telas bajo el mínimo. */
(function () {
  'use strict';
  if (window.__minimaximanListo) return;
  window.__minimaximanListo = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const ESTADO = { pedir: ['POR PEDIR', 'rojo'], sin_proveedor: ['SIN PROVEEDOR', 'ambar'], sin_effi: ['NO LO VEO EN EFFI', 'ambar'], error: ['CON ERROR', 'rojo'], revisar: ['REVISAR RANGO', 'ambar'], en_camino: ['EN CAMINO', 'azul'], ok: ['EN RANGO', 'verde'] };
  let panel = null, tab = null, timer = null, datos = null, filtro = 'pedir', ocupado = false;

  const css = document.createElement('style');
  css.textContent = `
  .mm{display:grid;gap:18px;padding:4px 0 30px;font-family:Arial,sans-serif;color:#e8f0e0;position:relative;isolation:isolate}
  .mm::before{content:"";position:absolute;z-index:-1;left:-60px;top:-30px;width:420px;height:420px;border-radius:50%;filter:blur(70px);background:radial-gradient(circle,rgba(111,227,154,.28),transparent 70%);pointer-events:none}
  .mm-glass{border:1px solid rgba(255,255,255,.2);border-radius:20px;background:linear-gradient(150deg,rgba(255,255,255,.14),rgba(255,255,255,.04) 45%,rgba(255,255,255,.08));-webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 14px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.3)}
  .mm-hd{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:20px 22px}
  .mm-hd small{font:800 10px Arial;letter-spacing:.18em;color:#6fe39a}.mm-hd h2{margin:4px 0;font:900 26px Arial;letter-spacing:.06em}.mm-hd p{margin:0;font:13px/1.45 Arial;color:#a9b8a3;max-width:640px}
  .mm-sw{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);font:800 12px Arial;letter-spacing:.05em}
  .mm-sw button{width:54px;height:28px;border-radius:99px;border:1px solid rgba(255,255,255,.25);background:#3a3f38;position:relative;cursor:pointer;transition:background .2s;padding:0}
  .mm-sw button::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}
  .mm-sw.on button{background:#2fae62}.mm-sw.on button::after{transform:translateX(26px)}.mm-sw.on span{color:#6fe39a}.mm-sw:not(.on) span{color:#ffb39f}
  .mm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .mm-kpi{padding:14px 16px;cursor:pointer;text-align:left;color:inherit;font:inherit;position:relative;overflow:hidden;transition:transform .2s,border-color .2s}
  .mm-kpi:hover{transform:translateY(-3px)}.mm-kpi.on{border-color:rgba(111,227,154,.7)}
  .mm-kpi b{display:block;font:900 30px Arial}.mm-kpi span{font:800 10px Arial;letter-spacing:.12em;color:#b9c8b3}
  .mm-acc{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .mm-b{padding:10px 16px;border-radius:13px;border:1px solid rgba(255,255,255,.25);background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.06));color:#fff;font:800 12px Arial;letter-spacing:.05em;cursor:pointer}
  .mm-b:disabled{opacity:.5;cursor:default}.mm-meta{font:12px Arial;color:#9fb096}
  .mm-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
  .mm-t{padding:16px 18px;display:grid;gap:10px}
  .mm-t h4{margin:0;font:900 16px Arial;letter-spacing:.03em;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .mm-t h4 em{font:800 9.5px Arial;font-style:normal;letter-spacing:.08em;padding:5px 9px;border-radius:99px;border:1px solid rgba(255,255,255,.3);white-space:nowrap}
  .mm-t.rojo h4 em{background:rgba(255,107,97,.25);border-color:#ff6b61;color:#ffb3ac}.mm-t.ambar h4 em{background:rgba(255,200,80,.2);border-color:#ffc850;color:#ffe0a0}
  .mm-t.azul h4 em{background:rgba(100,170,255,.2);border-color:#64aaff;color:#bcd8ff}.mm-t.verde h4 em{background:rgba(111,227,154,.18);border-color:#6fe39a;color:#bff5d3}
  .mm-barra{height:12px;border-radius:99px;background:rgba(255,255,255,.1);position:relative;overflow:visible}
  .mm-barra i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#4fae86,#a6f0c6)}
  .mm-t.rojo .mm-barra i{background:linear-gradient(90deg,#e8573a,#ff9d83)}.mm-t.azul .mm-barra i{background:linear-gradient(90deg,#4a86d8,#9cc6ff)}
  .mm-barra u{position:absolute;top:-4px;bottom:-4px;width:2px;background:#fff;opacity:.85;text-decoration:none}
  .mm-nums{display:flex;justify-content:space-between;font:700 11px Arial;color:#c5d2bf}.mm-nums b{color:#fff}
  .mm-nota{font:12px/1.4 Arial;color:#a9b8a3}.mm-vacio{padding:26px;text-align:center;color:#9fb096;font:13px/1.5 Arial;border:1px dashed rgba(255,255,255,.2);border-radius:16px}
  @media(max-width:700px){.mm-hd h2{font-size:21px}.mm-lista{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  const api = async (url, opciones) => {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opciones, headers: { 'Content-Type': 'application/json' } });
    let d = null; try { d = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No se pudo completar la acción');
    return d;
  };
  const hora = iso => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  function envioHtml(c) {
    const e = c.envio_proveedor || {};
    if (e.estado === 'enviada') return '<div class="mm-nota">✔ Enviada al proveedor (' + esc(e.correo) + ') · aprobó ' + esc(e.por) + ' · ' + hora(e.at) + ' <button type="button" class="mm-b" data-mm-prov="' + c.id + '" data-otra="1" data-oc="' + esc(c.oc) + '">Reenviar</button></div>';
    return '<div class="mm-nota">⏳ Esperando tu aprobación para enviarla al proveedor · <button type="button" class="mm-b" data-mm-prov="' + c.id + '" data-oc="' + esc(c.oc) + '">✉ Enviar al proveedor</button></div>';
  }

  function tarjeta(t) {
    const [txt, tono] = ESTADO[t.estado] || ['—', ''];
    const tope = Math.max(t.maximo, t.stock + (t.en_cola || 0) + (t.por_recibir || 0), 1) * 1.05;
    const pct = v => Math.max(0, Math.min(100, v / tope * 100)).toFixed(1);
    return '<article class="mm-glass mm-t ' + tono + '"><h4><span>' + esc(t.tela) + '</span><em>' + txt + '</em></h4>' +
      '<div class="mm-barra" title="Hay ' + num(t.stock) + ' · mínimo ' + num(t.minimo) + ' · máximo ' + num(t.maximo) + '"><i style="width:' + pct(t.stock) + '%"></i><u style="left:' + pct(t.minimo) + '%" title="Mínimo"></u><u style="left:' + pct(t.maximo) + '%;opacity:.45" title="Máximo"></u></div>' +
      '<div class="mm-nums"><span>Hay <b>' + num(t.stock) + '</b> mts</span><span>Mín <b>' + num(t.minimo) + '</b></span><span>Máx <b>' + num(t.maximo) + '</b></span></div>' +
      ((t.en_cola || t.por_recibir) ? '<div class="mm-nums"><span>En cola <b>' + num(t.en_cola) + '</b></span><span>Por recibir en Effi <b>' + (t.por_recibir == null ? '—' : num(t.por_recibir)) + '</b></span></div>' : '') +
      (t.pedir ? '<div class="mm-nums"><span>A pedir <b>' + num(t.pedir) + ' mts</b></span><span>' + esc(t.proveedor || 'sin proveedor') + '</span></div>' : '') +
      (t.nota ? '<div class="mm-nota">' + esc(t.nota) + '</div>' : '') + '</article>';
  }

  function pintar() {
    if (!panel || !datos) return;
    const a = datos.agente, r = datos.resumen, activo = !!a.activo;
    const kpi = (k, n, rotulo) => '<button type="button" class="mm-glass mm-kpi' + (filtro === k ? ' on' : '') + '" data-mm-filtro="' + k + '" data-lq="' + (r.telas ? Math.round(n / r.telas * 100) : 0) + '" data-lq-tone="' + ({ pedir: 'rojo', en_camino: 'azul', sin_proveedor: 'ambar', ok: 'verde', todas: 'gris' }[k] || 'gris') + '" data-lq-nopct><b>' + n + '</b><span>' + rotulo + '</span></button>';
    const lista = datos.telas.filter(t => filtro === 'todas' || t.estado === filtro || (filtro === 'pedir' && (t.estado === 'sin_effi' || t.estado === 'revisar' || t.estado === 'error')));
    panel.querySelector('.mm').innerHTML =
      '<header class="mm-glass mm-hd"><div><small>AGENTE DE INVENTARIO</small><h2>MINIMAXIMAN</h2><p>' + esc(a.titulo) + '. Cuando una tela baja de su stock mínimo, pide lo necesario para llegar a su máximo, igual que ZEUS: la orden de compra la crea él mismo en Effi (por la API, sin usar a ZEUS ni a otros agentes) y avisa por correo y en la campana.</p></div>' +
      '<div class="mm-sw' + (activo ? ' on' : '') + '"><span>' + (activo ? 'ACTIVO · crea compras' : 'APAGADO · solo muestra') + '</span><button type="button" data-mm-activar="' + (activo ? 0 : 1) + '" aria-label="Activar o apagar MINIMAXIMAN"></button></div></header>' +
      (a.error ? '<div class="mm-vacio">' + esc(a.error) + '</div>' : '') +
      '<div class="mm-kpis">' + kpi('pedir', r.pedir, 'POR PEDIR') + kpi('en_camino', r.en_camino, 'EN CAMINO') + kpi('sin_proveedor', r.sin_proveedor, 'SIN PROVEEDOR') + kpi('ok', r.ok, 'EN RANGO') + kpi('todas', r.telas, 'TELAS CON MÍN. Y MÁX.') + '</div>' +
      '<div class="mm-acc"><button type="button" class="mm-b" data-mm-revisar' + (ocupado ? ' disabled' : '') + '>↻ ' + (ocupado ? 'REVISANDO…' : 'REVISAR AHORA') + '</button><span class="mm-meta">Última revisión: ' + hora(a.ultima) + ' · se repite sola cada 10 minutos' + (activo ? '' : ' · APAGADO: no crea ninguna compra') + '</span></div>' +
      (datos.compras && datos.compras.length ? '<section class="mm-glass mm-t"><h4><span>ÓRDENES QUE HA CREADO</span></h4>' + datos.compras.map(c => '<div class="mm-nums"><span><b>' + esc(c.tela) + '</b> · ' + num(c.metros) + ' mts</span><span>' + (c.estado === 'creada' ? 'OC ' + esc(c.oc) : (c.estado === 'error' ? 'ERROR (' + (c.intentos || 0) + '/3)' : 'creando…')) + ' · ' + hora(c.creada || c.creado) + '</span></div>' + (c.estado === 'creada' ? envioHtml(c) : '') + (c.estado === 'error' ? '<div class="mm-nota">' + esc(c.detalle) + '</div>' : '')).join('') + '</section>' : '') +
      (lista.length ? '<section class="mm-lista">' + lista.map(tarjeta).join('') + '</section>' : '<div class="mm-vacio">' + (r.telas ? 'No hay telas en este grupo.' : 'Ninguna tela tiene stock mínimo y máximo todavía: se anotan en INFORMACIÓN TELA.') + '</div>') +
      '<ul class="mm-meta" style="margin:0;padding-left:18px">' + (a.funciones || []).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>';
    if (window.liquidStats && window.liquidStats.refresh) window.liquidStats.refresh(panel);
  }

  async function cargar() {
    try { datos = await api('/api/minimaximan/estado'); pintar(); }
    catch (e) { if (panel) panel.querySelector('.mm').innerHTML = '<div class="mm-vacio">' + esc(e.message) + '</div>'; }
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="minimaximan"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'minimaximan';
    panel.innerHTML = '<div class="mm"><div class="mm-vacio">Cargando…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="minimaximan" type="button"><span class="nav-icon">MM</span><strong>MINIMAXIMAN</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar(); clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 15000);
    });
    panel.addEventListener('click', async e => {
      const f = e.target.closest('[data-mm-filtro]'); if (f) { filtro = f.dataset.mmFiltro; pintar(); return; }
      const r = e.target.closest('[data-mm-revisar]');
      if (r && !ocupado) { ocupado = true; pintar(); try { await api('/api/minimaximan/revisar', { method: 'POST' }); } catch (x) { alert(x.message); } ocupado = false; await cargar(); return; }
      const p = e.target.closest('[data-mm-prov]');
      if (p) {
        const otra = !!p.dataset.otra;
        if (!confirm((otra ? 'Esta orden ya se envió. ¿Enviarla otra vez' : '¿Aprobar y enviar la orden de compra ' + (p.dataset.oc || '')) + ' al correo del proveedor?\nEl proveedor recibirá el mensaje de Indoor Sport con el número de la orden, la tela y los metros.')) return;
        p.disabled = true;
        try { await api('/api/minimaximan/enviar-proveedor', { method: 'POST', body: JSON.stringify({ id: Number(p.dataset.mmProv), otra_vez: otra }) }); } catch (x) { alert(x.message); }
        cargar(); return;
      }
      const s = e.target.closest('[data-mm-activar]');
      if (s) {
        const quiere = s.dataset.mmActivar === '1';
        if (quiere && !confirm('¿Activar MINIMAXIMAN?\n\nCuando una tela baje de su stock mínimo, MINIMAXIMAN creará él mismo la orden de compra en Effi (con el proveedor de INFORMACIÓN TELA y la llave de la API), sin pedirte permiso.')) return;
        try { await api('/api/minimaximan/activar', { method: 'PUT', body: JSON.stringify({ activo: quiere }) }); } catch (x) { alert(x.message); }
        cargar();
      }
    });
    return true;
  }

  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-minimaximan');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-minimaximan'; boton.textContent = 'MINIMAXIMAN';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;
    const previo = document.getElementById('open-zeus');
    if (previo) previo.insertAdjacentElement('afterend', boton);
    else menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/minimaximan/estado', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;   // solo las cuentas con acceso al agente de inventario
    let intentos = 0;
    const espera = setInterval(() => { if (construir()) ponerEnMenu(); if (++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso: no se muestra */ });
})();
