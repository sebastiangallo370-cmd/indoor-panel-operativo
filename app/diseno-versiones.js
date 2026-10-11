/* Versiones de los diseños (mockups) de cada orden.
   - En cada tarjeta de Producción pone una etiqueta con el estado del diseño: aprobado, sin aprobar o cambiado después de aprobar,
     y avisa en rojo si la orden va para Impresión con el diseño sin aprobar.
   - Al tocarla abre el historial: todas las versiones de cada diseño (V1, V2…), cuál está en uso, cuál aprobó el cliente,
     comparación lado a lado y descarga. Comercial y Administración marcan la versión aprobada.
   Las versiones las guarda el servidor solo, cada vez que la imagen del listado cambia (app/diseno_versiones.py). */
(function () {
  if (window.__disenoVersiones) return; window.__disenoVersiones = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TEXTO = { aprobado: '✓ Diseño aprobado', pendiente: 'Diseño sin aprobar', cambio: '⚠ Diseño cambió tras aprobar' };
  const NOMBRE = { aprobado: 'Aprobado', pendiente: 'Sin aprobar', cambio: 'Cambió después de aprobar', retirado: 'Ya no está en el listado' };
  let estados = {}, abierta = null, comparar = [];

  const style = document.createElement('style');
  style.textContent = `
.dv-chip{position:absolute;top:12px;left:12px;z-index:2;width:auto!important;min-height:0!important;max-width:calc(100% - 70px);padding:5px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(15,21,17,.82);color:#e8efe2;font:800 10.5px/1.2 Arial;letter-spacing:.03em;text-align:left;cursor:pointer;box-shadow:0 4px 12px #0005;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dv-chip.aprobado{color:#d0f44c;border-color:rgba(208,244,76,.55)}
.dv-chip.pendiente{color:#ffd27a;border-color:rgba(255,210,122,.55)}
.dv-chip.cambio{color:#ffb4a8;border-color:rgba(255,107,92,.7)}
.dv-chip.alerta{background:#b3261e;color:#fff;border-color:#ff8f80;animation:dvPulso 1.8s ease-in-out infinite}
@keyframes dvPulso{50%{box-shadow:0 0 0 5px rgba(255,107,92,.28)}}
@media(prefers-reduced-motion:reduce){.dv-chip.alerta{animation:none}}
.dv-dlg{width:min(1080px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid rgba(208,244,76,.3);border-radius:18px;background:#10160f;color:#eef3e8;font-family:Arial,sans-serif;overflow:hidden}
.dv-dlg[open]{display:flex;flex-direction:column}
.dv-dlg::backdrop{background:rgba(0,0,0,.72)}
.dv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.1)}
.dv-head h3{margin:2px 0 0;font-size:1.05rem}.dv-head small{color:#d0f44c;font:800 .66rem Arial;letter-spacing:.1em;text-transform:uppercase}.dv-head p{margin:4px 0 0;color:#a9b5a3;font-size:.78rem}
.dv-dlg button{width:auto;min-height:36px;padding:7px 13px;border:1px solid rgba(208,244,76,.4);border-radius:10px;background:rgba(208,244,76,.1);color:#e7ff9a;font:800 .74rem Arial;box-shadow:none;cursor:pointer}
.dv-dlg button:hover{filter:none;transform:none;background:rgba(208,244,76,.18)}
.dv-dlg button.pri{background:#d0f44c;color:#16200a;border-color:#d0f44c}
.dv-dlg button.rojo{border-color:rgba(255,107,92,.55);background:rgba(255,107,92,.1);color:#ffb4a8}
.dv-dlg button:disabled{opacity:.5;cursor:wait}
.dv-body{padding:14px 18px 18px;overflow-y:auto;display:grid;gap:16px}
.dv-dis{display:grid;gap:10px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#141b13}
.dv-dis>header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dv-dis>header b{font-size:.95rem}
.dv-est{padding:3px 9px;border-radius:999px;font:800 .66rem Arial;letter-spacing:.04em;text-transform:uppercase;background:rgba(255,255,255,.08)}
.dv-est.aprobado{background:rgba(208,244,76,.16);color:#e3ff8a}.dv-est.pendiente{background:rgba(255,210,122,.16);color:#ffd27a}.dv-est.cambio{background:rgba(255,107,92,.18);color:#ffb4a8}
.dv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.dv-ver{display:grid;gap:7px;align-content:start;padding:9px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#0e130e}
.dv-ver.vigente{border-color:rgba(208,244,76,.6)}.dv-ver.sel{box-shadow:0 0 0 2px #7fb0ff}
.dv-ver img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#e9ece6;border-radius:8px;cursor:zoom-in}
.dv-ver strong{font-size:.86rem}.dv-ver small{color:#a9b5a3;font-size:.7rem;line-height:1.35}
.dv-marcas{display:flex;gap:5px;flex-wrap:wrap}.dv-marcas i{font-style:normal;padding:2px 7px;border-radius:999px;font:800 .6rem Arial;letter-spacing:.04em;text-transform:uppercase}
.dv-marcas .uso{background:rgba(208,244,76,.16);color:#e3ff8a}.dv-marcas .ok{background:#d0f44c;color:#16200a}.dv-marcas .ant{background:rgba(255,255,255,.08);color:#b9c6b3}
.dv-acc{display:flex;gap:6px;flex-wrap:wrap}.dv-acc button,.dv-acc a{min-height:32px;padding:5px 10px;font-size:.68rem}
.dv-acc a{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.18);border-radius:10px;color:#dfe7d8;font:800 .68rem Arial;text-decoration:none}
.dv-cmp{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;border:1px solid #7fb0ff;border-radius:14px;background:#0e130e}
.dv-cmp figure{margin:0;display:grid;gap:6px}.dv-cmp img{width:100%;max-height:62dvh;object-fit:contain;background:#e9ece6;border-radius:8px}.dv-cmp figcaption{font:800 .76rem Arial;color:#cfe0ff}
.dv-cmp>div{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:10px;color:#a9b5a3;font-size:.76rem}
.dv-nota{margin:0;color:#8f9b8a;font-size:.74rem;line-height:1.45}
.dv-zoom{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(0,0,0,.9);cursor:zoom-out}.dv-zoom img{max-width:96vw;max-height:94dvh;object-fit:contain;background:#e9ece6;border-radius:8px}
@media(max-width:700px){.dv-chip{font-size:10px;padding:5px 9px}.dv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dv-cmp{grid-template-columns:1fr}.dv-head{padding:14px}.dv-body{padding:12px 12px 16px}.dv-dis{padding:10px}.dv-acc{display:grid;grid-template-columns:1fr 1fr;gap:5px}.dv-dlg .dv-acc button,.dv-dlg .dv-acc a{min-height:36px!important;padding:5px 4px!important;font-size:11px!important;white-space:nowrap;justify-content:center;text-align:center}.dv-dlg .dv-acc .pri{grid-column:1/-1}}
`;
  document.head.appendChild(style);

  const dlg = document.createElement('dialog');
  dlg.className = 'dv-dlg';
  dlg.setAttribute('aria-label', 'Versiones del diseño');
  document.body.appendChild(dlg);

  const fecha = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };

  // ---- etiqueta en cada tarjeta de Producción ----
  function decorar() {
    document.querySelectorAll('.trace-card[data-card-row]').forEach(card => {
      const e = estados[card.dataset.cardRow], viejo = card.querySelector(':scope > .dv-chip');
      if (!e) { if (viejo) viejo.remove(); return; }
      const clase = 'dv-chip ' + e.estado + (e.alerta ? ' alerta' : ''), texto = e.alerta ? '⚠ Va para impresión: ' + (e.estado === 'cambio' ? 'el diseño cambió tras aprobar' : 'diseño sin aprobar') : TEXTO[e.estado];
      if (viejo) { if (viejo.className !== clase) viejo.className = clase; if (viejo.textContent !== texto) viejo.textContent = texto; return; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = clase; b.dataset.dvRow = card.dataset.cardRow; b.textContent = texto; b.title = 'Ver las versiones del diseño';
      card.appendChild(b);
    });
  }
  let pendiente = 0;
  const decorarLuego = () => { if (pendiente) return; pendiente = setTimeout(() => { pendiente = 0; decorar(); }, 60); };
  async function cargarEstados() {
    try {
      const r = await fetch('/api/disenos/estado', { cache: 'no-store' });
      if (r.ok) { estados = await r.json(); decorar(); }
    } catch (e) { /* sin red: se reintenta en el siguiente ciclo */ }
  }
  function vigilar() {
    const cajas = document.querySelector('.trace-cards');
    if (!cajas) { setTimeout(vigilar, 800); return; }
    new MutationObserver(decorarLuego).observe(cajas, { childList: true });
    cargarEstados();
    setInterval(() => { if (!document.hidden) cargarEstados(); }, 30000);
  }

  // ---- ventana del historial ----
  function pintar() {
    const d = abierta; if (!d) return;
    const cmp = comparar.length === 2 ? comparar.map(k => { const [n, digest] = k.split(':'), dis = d.disenos.find(x => String(x.diseno) === n), v = dis && dis.versiones.find(x => x.digest === digest); return v ? { n, v } : null; }).filter(Boolean) : [];
    dlg.innerHTML = '<div class="dv-head"><div><small>Versiones del diseño</small><h3>' + esc(d.orden) + (d.referencia ? ' · ' + esc(d.referencia) : '') + '</h3>' +
      '<p>Cada vez que la imagen del listado cambia, la anterior queda guardada aquí. ' + (d.puede_aprobar ? 'Marca la versión que aprobó el cliente.' : 'Solo Comercial y Administración marcan la versión aprobada.') + '</p></div>' +
      '<button type="button" data-dv-cerrar aria-label="Cerrar">✕</button></div><div class="dv-body">' +
      (cmp.length === 2 ? '<section class="dv-cmp"><div><span>Comparando dos versiones</span><button type="button" data-dv-nocmp>Quitar comparación</button></div>' +
        cmp.map(c => '<figure><figcaption>D' + esc(c.n) + ' · V' + c.v.v + (c.v.aprobada ? ' · aprobada' : '') + (c.v.vigente ? ' · en uso' : '') + '</figcaption><img alt="" src="' + esc(c.v.url) + '" data-dv-zoom></figure>').join('') + '</section>' : '') +
      (d.disenos.length ? d.disenos.map(dis =>
        '<section class="dv-dis"><header><b>Diseño D' + dis.diseno + '</b><span class="dv-est ' + dis.estado + '">' + NOMBRE[dis.estado] + '</span><small style="color:#a9b5a3">' + dis.versiones.length + (dis.versiones.length === 1 ? ' versión' : ' versiones') + '</small>' +
        (d.puede_aprobar && dis.versiones.some(v => v.aprobada) ? '<button type="button" class="rojo" data-dv-quitar="' + dis.diseno + '" style="margin-left:auto">Quitar aprobación</button>' : '') + '</header>' +
        '<div class="dv-grid">' + dis.versiones.slice().reverse().map(v => { const k = dis.diseno + ':' + v.digest;
          return '<article class="dv-ver' + (v.vigente ? ' vigente' : '') + (comparar.includes(k) ? ' sel' : '') + '"><img loading="lazy" alt="Versión ' + v.v + '" src="' + esc(v.url) + '" data-dv-zoom>' +
            '<strong>V' + v.v + '</strong><div class="dv-marcas">' + (v.vigente ? '<i class="uso">En uso</i>' : '<i class="ant">Anterior</i>') + (v.aprobada ? '<i class="ok">Aprobada</i>' : '') + '</div>' +
            '<small>Guardada el ' + esc(fecha(v.creado)) + (v.aprobada ? '<br>Aprobó ' + esc(v.aprobada_por) + ' · ' + esc(fecha(v.aprobada_en)) : '') + '</small>' +
            '<div class="dv-acc">' + (d.puede_aprobar && !v.aprobada && dis.estado !== 'retirado' ? '<button type="button" class="pri" data-dv-aprobar="' + k + '">Aprobar</button>' : '') +
            '<button type="button" data-dv-cmp="' + k + '">' + (comparar.includes(k) ? 'Quitar' : 'Comparar') + '</button><a href="' + esc(v.url) + '" download="' + esc(d.orden + '_D' + dis.diseno + '_V' + v.v) + '">Descargar</a></div></article>'; }).join('') + '</div></section>').join('')
        : '<p class="dv-nota">Esta orden todavía no tiene diseños registrados. Aparecen solos cuando el listado en Excel de la orden tiene sus imágenes.</p>') +
      '<p class="dv-nota">«En uso» es la imagen que hoy está en el listado de la orden. Para volver a una versión anterior, descárgala y ponla de nuevo en el Excel del listado: el panel la reconoce y vuelve a marcarla en uso (si era la aprobada, queda aprobada).</p></div>';
  }
  async function abrir(fila) {
    comparar = []; abierta = null;
    dlg.innerHTML = '<div class="dv-head"><div><small>Versiones del diseño</small><h3>Cargando…</h3></div><button type="button" data-dv-cerrar aria-label="Cerrar">✕</button></div>';
    if (!dlg.open) dlg.showModal();
    try {
      const r = await fetch('/api/disenos/versiones?fila=' + encodeURIComponent(fila), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'No pude leer las versiones');
      abierta = j; pintar();
    } catch (e) { dlg.querySelector('h3').textContent = e.message; }
  }
  async function enviar(ruta, cuerpo, boton) {
    if (boton) boton.disabled = true;
    try {
      const r = await fetch(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No se pudo guardar');
      const fila = abierta.fila, sel = comparar.slice();
      const nuevo = await (await fetch('/api/disenos/versiones?fila=' + fila, { cache: 'no-store' })).json();
      abierta = nuevo; comparar = sel; pintar(); cargarEstados();
    } catch (e) { alert(e.message); if (boton) boton.disabled = false; }
  }
  dlg.addEventListener('click', event => {
    const t = event.target;
    if (t === dlg || t.closest('[data-dv-cerrar]')) return dlg.close();
    if (!abierta) return;
    const ap = t.closest('[data-dv-aprobar]'), q = t.closest('[data-dv-quitar]'), c = t.closest('[data-dv-cmp]'), z = t.closest('[data-dv-zoom]');
    if (ap) { const [n, digest] = ap.dataset.dvAprobar.split(':'); if (confirm('¿Marcar la versión como la aprobada por el cliente para el diseño D' + n + '?')) enviar('/api/disenos/aprobar', { fila: abierta.fila, diseno: Number(n), digest }, ap); }
    else if (q) { if (confirm('¿Quitar la aprobación del diseño D' + q.dataset.dvQuitar + '?')) enviar('/api/disenos/desaprobar', { fila: abierta.fila, diseno: Number(q.dataset.dvQuitar) }, q); }
    else if (c) { const k = c.dataset.dvCmp; comparar = comparar.includes(k) ? comparar.filter(x => x !== k) : comparar.concat(k).slice(-2); pintar(); if (comparar.length === 2) dlg.querySelector('.dv-body').scrollTop = 0; }
    else if (t.closest('[data-dv-nocmp]')) { comparar = []; pintar(); }
    else if (z) { const capa = document.createElement('div'); capa.className = 'dv-zoom'; capa.innerHTML = '<img alt="" src="' + esc(z.getAttribute('src')) + '">'; capa.addEventListener('click', () => capa.remove()); dlg.appendChild(capa); }
  });
  // la etiqueta vive dentro de la tarjeta: se atiende antes que los clics propios de la tarjeta
  document.addEventListener('click', event => {
    const b = event.target.closest && event.target.closest('[data-dv-row]');
    if (!b) return;
    event.preventDefault(); event.stopPropagation();
    abrir(b.dataset.dvRow);
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
})();
