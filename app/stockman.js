/* STOCKMAN · agente de inventario que deja el stock de Effi igual al del panel (por bodega) y muestra las telas con el nombre de Effi.
   Pantalla propia (robot de agentes → INVENTARIOS → STOCKMAN). Reutiliza el estilo de vidrio de MINIMAXIMAN (clases mm-*, que define minimaximan.js). */
(function () {
  'use strict';
  if (window.__stockmanListo) return;
  window.__stockmanListo = true;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const sg = v => (v > 0 ? '+' : '') + num(v);
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ESTADO = { ajustar: ['DIFERENCIA', 'ambar'], grande: ['DIFERENCIA GRANDE', 'rojo'], igual: ['IGUAL', 'verde'], sin_articulo: ['SIN ARTÍCULO EN EFFI', 'ambar'] };
  let urlWh = '', panel = null, tab = null, timer = null, datos = null, filtro = 'ajustar', buscar = '', ocupado = false, firma = '';

  const css = `
  .panel[data-panel="stockman"],.panel[data-panel="stockman"].active{width:100%;max-width:none;grid-template-columns:minmax(0,1fr)!important;justify-content:stretch!important;justify-items:stretch!important}
  body.sm-modo main,body:has(.panel[data-panel="stockman"].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box;padding-left:clamp(12px,1.6vw,36px)!important;padding-right:clamp(12px,1.6vw,36px)!important}
  .panel[data-panel="stockman"] .mm{max-width:none!important;width:100%!important;margin:0!important}
  .sm-tabla{display:grid;gap:0;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.1);padding:4px 10px}
  .sm-fila{display:grid;grid-template-columns:1.3fr 1fr 1fr .9fr;gap:6px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font:700 11px Arial;color:#e8f0e0}
  .sm-fila:last-child{border:0}.sm-fila.cab{font:800 8px Arial;letter-spacing:.12em;color:#9fb096}.sm-fila span:not(:first-child){text-align:right}
  .sm-fila .d{color:#fff}.sm-fila .d.mas{color:var(--lima,#d0f44c)}.sm-fila .d.menos{color:#ffb3ac}
  .sm-tot{display:flex;justify-content:space-between;gap:10px}.sm-tot div{display:grid;gap:2px}.sm-tot small{font:800 8px Arial;letter-spacing:.14em;color:#9fb096}.sm-tot b{font:900 22px Arial;color:#fff}
  .sm-nom{font:700 10px Arial;color:#9fb096}
  .sm-wh{display:flex;justify-content:space-between;align-items:center;gap:12px}.sm-url{display:flex;gap:8px;align-items:center}.sm-url code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 10px;border-radius:10px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.12);color:#e8f0e0;font:11px Consolas,monospace}.sm-url .mm-bt{width:90px;flex:none}
  .sm-hist{padding:12px 16px;display:grid;gap:6px;font:11px Arial;color:#c5d2bf}.sm-hist h3{margin:0;font:900 11px Arial;letter-spacing:.16em;color:#b9c8b3}
  `;

  const api = async (url, opciones) => {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...opciones });
    let d = null; try { d = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No se pudo completar la acción');
    return d;
  };
  const hora = iso => iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const coincide = t => filtro === 'todo' || (filtro === 'ajustar' && (t.estado === 'ajustar' || t.estado === 'grande')) || t.estado === filtro;

  function tarjeta(t, i) {
    const [txt, tono] = ESTADO[t.estado] || ['—', ''];
    const filas = (t.bodegas || []).map(b => '<div class="sm-fila"><span>' + esc(b.nombre) + '</span><span>' + num(b.panel) + '</span><span>' + num(b.effi) + '</span><span class="d ' + (b.delta > 0 ? 'mas' : b.delta < 0 ? 'menos' : '') + '">' + (Math.abs(b.delta) < 0.01 ? '=' : sg(b.delta)) + '</span></div>').join('');
    const boton = (t.estado === 'ajustar' || t.estado === 'grande') ? '<button type="button" class="mm-bt env" data-sm-ajustar="' + esc(t.codigo) + '" data-grande="' + (t.estado === 'grande' ? 1 : 0) + '" data-tela="' + esc(t.tela) + '">IGUALAR EN EFFI</button>' : '';
    const cuerpo = t.estado === 'sin_articulo'
      ? '<div class="mm-nota">Effi no tiene un artículo con esta referencia exacta. Escribe su «ID Effi» en INFORMACIÓN TELA.</div>'
      : '<div class="sm-tot"><div><small>PANEL</small><b>' + num(t.panel) + ' <em style="font:800 9px Arial;font-style:normal;color:#c5d2bf">MTS</em></b></div><div style="text-align:right"><small>EFFI</small><b>' + num(t.effi) + ' <em style="font:800 9px Arial;font-style:normal;color:#c5d2bf">MTS</em></b></div></div>' +
        '<div class="sm-tabla"><div class="sm-fila cab"><span>BODEGA</span><span>PANEL</span><span>EFFI</span><span>DIF.</span></div>' + filas + '</div>' + boton;
    return '<article class="mm-glass mm-t ' + tono + '" style="animation-delay:' + Math.min(i * 25, 300) + 'ms"><h4><span>' + esc(t.tela) + '<small>' + esc(t.codigo) + (t.id_effi ? ' · ID EFFI ' + esc(t.id_effi) : '') + '</small></span><em>' + txt + '</em></h4>' + cuerpo + '<img class="mm-marca" src="/marca-indoor.svg" alt="" aria-hidden="true"></article>';
  }

  function pintarLista() {
    const host = panel.querySelector('.sm-host'); if (!host || !datos) return;
    const q = plano(buscar);
    const lista = datos.telas.filter(t => coincide(t) && (!q || plano(t.tela + ' ' + t.codigo + ' ' + (t.nombre_panel || '')).includes(q)));
    host.innerHTML = lista.length ? '<div class="mm-lista">' + lista.map(tarjeta).join('') + '</div>' : '<div class="mm-vacio">' + (filtro === 'ajustar' ? 'Nada por ajustar: el stock del panel y el de Effi coinciden.' : 'No hay telas con ese filtro.') + '</div>';
  }

  function pintar() {
    if (!panel || !datos) return;
    const foco = document.activeElement;
    if (foco && foco.matches && foco.matches('[data-sm-buscar]') && panel.contains(foco)) { pintarLista(); return; }
    const a = datos.agente, r = datos.resumen, activo = !!a.activo;
    const kpi = (k, n, rotulo) => '<button type="button" class="mm-glass mm-kpi' + (filtro === k ? ' on' : '') + '" data-sm-filtro="' + k + '"><b>' + n + '</b><span>' + rotulo + '</span></button>';
    const dir = h => h.tipo === 'a_panel' ? 'Effi → panel' : 'Panel → Effi';
    const hist = (datos.ajustes || []).slice(0, 10).map(h => '<div>' + (h.estado === 'hecho' ? '✔' : '✕') + ' <b>' + dir(h) + '</b> · ' + esc(h.tela) + ' · ' + esc(h.bodega) + ' ' + sg(h.delta) + ' mts · ' + (h.tipo === 'a_panel' ? esc(h.at) : hora(h.at)) + ' · ' + esc(h.por) + (h.estado === 'hecho' ? ' · ajuste ' + esc(h.ajuste) : ' · ' + esc(h.detalle || '')) + '</div>').join('');
    const cam = (datos.cambios || []).map(h => '<div>⏱ ' + esc(h.tela) + ' · ' + esc(h.bodega_nombre) + ' ' + sg(h.delta) + ' mts (de ' + num(h.antes) + ' a ' + num(h.ahora) + ')</div>').join('');
    const pend = (datos.pendientes || []).map(h => '<div>⏳ ' + esc(h.tela) + ' · ' + esc(h.bodega) + ' ' + sg(h.delta) + ' mts · ajuste ' + esc(h.ajuste) + ' de ' + esc(h.por) + '</div>').join('');
    panel.querySelector('.mm').innerHTML =
      '<div class="mm-glass mm-top"><div class="mm-nom"><img class="mm-logo" src="/marca-indoor.svg" alt="Indoor"><small>Revisado</small><b>' + hora(a.ultima) + '</b></div>' +
      '<div class="mm-sw' + (activo ? ' on' : '') + '"><i></i><span>' + (activo ? 'ACTIVO' : 'APAGADO') + '</span><button type="button" data-sm-activar="' + (activo ? 0 : 1) + '" aria-label="Activar o apagar STOCKMAN"></button></div>' +
      '<button type="button" class="mm-b" data-sm-revisar' + (ocupado ? ' disabled' : '') + '>↻ ' + (ocupado ? 'REVISANDO…' : 'REVISAR') + '</button>' +
      '<span class="mm-sep"></span><div class="mm-kpis">' + kpi('ajustar', r.ajustar + r.grande, 'DIFERENCIAS') + kpi('igual', r.igual, 'IGUALES') + kpi('sin_articulo', r.sin_articulo, 'SIN ARTÍCULO') + kpi('todo', r.telas, 'TODO') + '</div>' +
      '<div class="mm-busca"><input type="search" data-sm-buscar placeholder="Buscar…" value="' + esc(buscar) + '" autocomplete="off"></div></div>' +
      (a.error ? '<div class="mm-vacio">' + esc(a.error) + '</div>' : '') +
      '<div class="mm-cuerpo">' + '<div class="mm-glass sm-hist sm-wh"><div>🔗 <b>Webhook de Effi</b> · ' + ((datos.webhook || {}).recibidos ? 'conectado · avisos recibidos: ' + (datos.webhook || {}).recibidos + ' · el último ' + hora((datos.webhook || {}).ultimo) + ((datos.webhook || {}).secreto ? ' · firma: ' + ({ valida: 'válida ✔', no_coincide: 'NO coincide', sin_firma: 'el aviso no trae firma' }[(datos.webhook || {}).firma] || '—') : '') : 'sin avisos todavía (mientras tanto STOCKMAN revisa solo cada 2 minutos)') + '</div><button type="button" class="mm-bt" data-sm-webhook style="width:170px;flex:none">GENERAR WEBHOOK</button></div>' +
      (urlWh ? '<div class="mm-glass sm-hist"><div>Pega esta dirección en Effi (Integraciones → Webhooks), método POST. No cambia la clave: un webhook ya creado en Effi sigue funcionando.</div><div class="sm-url"><code>' + esc(urlWh) + '</code><button type="button" class="mm-bt" data-sm-copiar>COPIAR</button><button type="button" class="mm-bt" data-sm-ocultar>OCULTAR</button></div></div>' : '') + '<div class="sm-host"></div>' + (cam ? '<div class="mm-glass sm-hist"><h3>CAMBIOS DEL PANEL QUE IRÁN A EFFI (SOLO LA BODEGA QUE CAMBIÓ)</h3>' + cam + '</div>' : '') + (pend ? '<div class="mm-glass sm-hist"><h3>AJUSTES HECHOS EN EFFI QUE LLEGARÁN AL PANEL AL ACTIVAR</h3>' + pend + '</div>' : '') + (hist ? '<div class="mm-glass sm-hist"><h3>ÚLTIMOS AJUSTES</h3>' + hist + '</div>' : '') + '</div>';
    pintarLista();
  }

  async function cargar() {
    try {
      const nuevo = await api('/api/stockman/estado');
      const f = JSON.stringify(nuevo);
      if (f === firma) return;
      firma = f; datos = nuevo; pintar();
    } catch (e) { if (panel) panel.querySelector('.mm').innerHTML = '<div class="mm-vacio">' + esc(e.message) + '</div>'; }
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="stockman"]')) return true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'stockman';
    panel.innerHTML = '<div class="mm"><div class="mm-vacio">Cargando…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="stockman" type="button"><span class="nav-icon">SM</span><strong>STOCKMAN</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      firma = ''; cargar(); clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 20000);
    });
    const marcar = () => document.body.classList.toggle('sm-modo', panel.classList.contains('active'));
    new MutationObserver(marcar).observe(panel, { attributes: true, attributeFilter: ['class'] }); marcar();
    panel.addEventListener('input', e => { if (e.target.matches('[data-sm-buscar]')) { buscar = e.target.value; pintarLista(); } });
    panel.addEventListener('click', async e => {
      const f = e.target.closest('[data-sm-filtro]'); if (f) { filtro = f.dataset.smFiltro; pintar(); return; }
      const r = e.target.closest('[data-sm-revisar]');
      if (r && !ocupado) { ocupado = true; pintar(); try { await api('/api/stockman/revisar', { method: 'POST' }); } catch (x) { alert(x.message); } ocupado = false; firma = ''; await cargar(); return; }
      const aj = e.target.closest('[data-sm-ajustar]');
      if (aj) {
        const grande = aj.dataset.grande === '1';
        if (!confirm('¿Dejar «' + aj.dataset.tela + '» en Effi igual que en el panel?\n\nSe crea un ajuste de inventario en Effi por cada bodega con diferencia (afecta el inventario contable). Esto iguala TODA la tela; lo normal es que STOCKMAN solo ajuste la bodega que cambia.' + (grande ? '\n\n⚠ La diferencia es GRANDE: revisa bien antes de aceptar.' : ''))) return;
        aj.disabled = true;
        try { await api('/api/stockman/ajustar', { method: 'POST', body: JSON.stringify({ codigo: aj.dataset.smAjustar }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar(); return;
      }
      const gw = e.target.closest('[data-sm-webhook]');
      if (gw) { try { urlWh = location.origin + (await api('/api/stockman/webhook-direccion', { method: 'POST' })).ruta; } catch (x) { alert(x.message); } firma = ''; pintar(); return; }
      const oc = e.target.closest('[data-sm-ocultar]'); if (oc) { urlWh = ''; pintar(); return; }
      const cp = e.target.closest('[data-sm-copiar]');
      if (cp) { try { await navigator.clipboard.writeText(urlWh); cp.textContent = 'COPIADO'; setTimeout(() => { cp.textContent = 'COPIAR'; }, 1500); } catch (_) { prompt('Copia esta dirección:', urlWh); } return; }
      const s = e.target.closest('[data-sm-activar]');
      if (s) {
        const quiere = s.dataset.smActivar === '1';
        if (quiere && !confirm('¿Activar STOCKMAN?\n\nEl panel es el inventario real. Cuando el panel cambie en una bodega, STOCKMAN hará en Effi un ajuste SOLO de esa bodega y por lo que cambió, tras 5 minutos estable (no toca las demás); y los ajustes que se hagan en Effi desde ahora los registrará en el panel (ingreso o salida). Las diferencias grandes no las toca: esperan a que pulses AJUSTAR.')) return;
        try { await api('/api/stockman/activar', { method: 'PUT', body: JSON.stringify({ activo: quiere }) }); } catch (x) { alert(x.message); }
        firma = ''; cargar();
      }
    });
    return true;
  }

  fetch('/api/stockman/nombres', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r : null)).then(ok => {
    if (!ok) return;   // solo las cuentas con acceso al agente de inventario
    let intentos = 0;
    const espera = setInterval(() => { if (construir() || ++intentos > 40) clearInterval(espera); }, 400);
  }).catch(() => { /* sin acceso: no se muestra */ });
})();
