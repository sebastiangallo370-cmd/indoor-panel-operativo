(() => {
  // TIENDA CLUB (COMERCIALES): enlaces privados por cliente y bandeja de reposiciones que mandan los clubes.
  if (window.__clubAdminListo) return;
  window.__clubAdminListo = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let panel = null, effi = null, enlaces = [], pedidos = [], filtro = 'pendiente', aviso = '', ultimo = '', cargando = false, abiertos = new Set();

  const css = document.createElement('style');
  css.textContent = `
  .tc{width:100%;max-width:1040px;margin:18px auto;display:grid;gap:16px}
  .tc-card{padding:20px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28))}
  .tc-card .eyebrow{color:#d0f44c;font:800 11px Arial;letter-spacing:.16em}
  .tc-card h2{margin:6px 0 4px;font:900 clamp(20px,3vw,26px) Arial;color:#f5faef}
  .tc-card p{margin:0 0 12px;color:#a9b5a3;font:500 14px/1.5 Arial}
  .tc-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
  .tc-form label{display:grid;gap:5px;flex:1 1 220px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.1em}
  .tc input,.tc select{min-height:44px;padding:0 12px;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 15px Arial;outline:none;width:100%;box-sizing:border-box}
  .tc input:focus,.tc select:focus{border-color:#d0f44c}
  .tc-btn{min-height:44px;padding:0 18px;border:0;border-radius:12px;background:#d0f44c;color:#142017;font:900 13px Arial;letter-spacing:.05em;cursor:pointer}
  .tc-btn.sec{background:rgba(255,255,255,.1);color:#f5faef}.tc-btn.mini{min-height:34px;padding:0 12px;font-size:12px}.tc-btn.bad{background:#5a2a26;color:#ffb6af}
  .tc-aviso{padding:10px 12px;border-radius:10px;background:#1b2a1b;color:#d0f44c;font:700 13px Arial;overflow-wrap:anywhere}
  .tc-lista{display:grid;gap:8px}
  .tc-fila{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#121712}
  .tc-fila strong{color:#f2f7ea}.tc-fila small{display:block;color:#a9b5a3;font-size:.74rem}
  .tc-acc{display:flex;gap:8px;flex-wrap:wrap}
  .tc-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.tc-chips button{padding:7px 14px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:transparent;color:#c4cfbf;font:700 .78rem Arial;cursor:pointer}.tc-chips button.on{border-color:#d0f44c;background:rgba(208,244,76,.14);color:#fff}
  .tc-ped{border-left:4px solid #ffc95c}.tc-ped.aprobada{border-color:#8bd450}.tc-ped.rechazada{border-color:#ff6b5c}
  .tc-det{display:grid;gap:8px;margin-top:10px;padding:10px;border-radius:10px;background:#0e1510;font-size:.85rem;color:#dfe8d9}.tc-det table{width:100%;border-collapse:collapse}.tc-det th,.tc-det td{padding:4px 6px;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)}.tc-det th{color:#a9b5a3;font-size:.7rem;text-transform:uppercase}
  .tc-vacio{padding:24px;text-align:center;border:1px dashed #4a5a40;border-radius:12px;color:#b7c0b3}`;
  document.head.appendChild(css);

  async function api(url, metodo, cuerpo) {
    const r = await fetch(url, { method: metodo || 'GET', headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }
  const fecha = iso => { try { return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };
  const url = t => location.origin + '/club/' + t;

  function detalle(p) {
    return '<div class="tc-det"><div><b>' + esc(p.contacto) + '</b> · ' + esc(p.telefono) + (p.notas ? ' · ' + esc(p.notas) : '') + '</div>' + p.lineas.map(l =>
      '<div><b>' + esc(l.proyecto || l.referencia) + '</b> · Ref. ' + esc(l.referencia) + ' · base ' + esc(l.orden_base) + ' · tela ' + esc(l.tela || '—') + (l.codigo_tela ? ' (código ' + esc(l.codigo_tela) + ')' : '') + '<table><tr><th>Nombre</th><th>N°</th><th>Talla</th><th>Diseño</th><th>Género</th><th>Cant.</th></tr>' +
      l.jugadores.map(j => '<tr><td>' + esc(j.nombre || '—') + '</td><td>' + esc(j.numero || '—') + '</td><td>' + esc(j.talla) + '</td><td>D' + esc(j.diseno || 1) + '</td><td>' + esc(j.genero || '—') + '</td><td>' + esc(j.cantidad) + '</td></tr>').join('') + '</table></div>').join('') +
      (p.nota_comercial ? '<div>Nota: ' + esc(p.nota_comercial) + '</div>' : '') + '</div>';
  }

  const COT = { preparando: 'Preparando la cotización…', pendiente: 'Esperando a EFFITRON…', entregada: 'EFFITRON está creando la cotización en Effi…', sin_pdf: 'Creada en Effi, bajando el PDF…', lista: 'Cotización lista', error: 'EFFITRON no pudo crear la cotización' };
  function cotInfo(p) {
    if (!p.cot_estado) return '';
    const ok = p.cot_estado === 'lista', mal = p.cot_estado === 'error';
    return '<small style="color:' + (ok ? '#d0f44c' : mal ? '#ff9b8f' : '#ffd08a') + '">' + esc(COT[p.cot_estado] || p.cot_estado) + (p.cot_numero ? ' · N° ' + esc(p.cot_numero) : '') + (p.cot_detalle ? ' · ' + esc(p.cot_detalle) : '') + '</small>' +
      (p.cot_pdf ? '<a class="tc-btn mini" style="display:inline-flex;margin-top:6px;margin-right:6px;text-decoration:none" target="_blank" href="/api/club/pedidos/' + p.id + '/cotizacion.pdf">Ver cotización PDF</a>' : '') +
      (mal || p.cot_estado === 'sin_pdf' ? '<button class="tc-btn mini sec" style="margin-top:6px" data-cotreint="' + p.id + '">Reintentar</button>' : '');
  }

  function pintar() {
    if (!panel) return;
    const lista = pedidos.filter(p => !filtro || p.estado === filtro);
    const html = '<div class="tc">' +
      '<section class="tc-card"><span class="eyebrow">TIENDA CLUB</span><h2>Enlace para un cliente</h2><p>Genera un enlace privado: el cliente ve los diseños que ya produjo con nosotros y arma su reposición con nombres, números y tallas.</p>' +
      '<div class="tc-form"><label>CLIENTE<input id="tc-cliente" list="tc-clientes" placeholder="Escribe el nombre del cliente" autocomplete="off"><datalist id="tc-clientes"></datalist></label>' +
      '<label style="flex:0 1 150px">VIGENCIA<select id="tc-dias"><option value="15">15 días</option><option value="30" selected>30 días</option><option value="90">90 días</option><option value="365">1 año</option></select></label>' +
      '<button class="tc-btn" id="tc-crear" type="button">Generar enlace</button></div>' + (aviso ? '<p class="tc-aviso" style="margin-top:12px">' + aviso + '</p>' : '') + '</section>' +
      '<section class="tc-card"><h2>Enlaces activos</h2>' + (enlaces.length ? '<div class="tc-lista">' + enlaces.map(e => '<div class="tc-fila"><span><strong>' + esc(e.cliente) + '</strong><small>Vence ' + fecha(e.vence) + ' · ' + e.pedidos + (e.pedidos === 1 ? ' reposición' : ' reposiciones') + (e.vencido ? ' · VENCIDO' : '') + '</small></span><span class="tc-acc"><button class="tc-btn mini" data-copiar="' + esc(e.token) + '">Copiar enlace</button><button class="tc-btn mini bad" data-revocar="' + e.id + '">Revocar</button></span></div>').join('') + '</div>' : '<div class="tc-vacio">Todavía no hay enlaces.</div>') + '</section>' +
      '<section class="tc-card"><h2>Reposiciones de los clubes</h2>' + (effi ? '<p class="tc-aviso" style="margin-bottom:12px">EFFITRON · ' + (effi.activo ? (effi.conectado ? 'en línea' : 'SIN CONEXIÓN') : 'apagado') + (effi.ultima ? ' · ' + esc(effi.ultima) : '') + '</p>' : '') + '<div class="tc-chips">' + [['pendiente', 'Pendientes'], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas'], ['', 'Todas']].map(([k, t]) => '<button type="button" data-filtro="' + k + '" class="' + (filtro === k ? 'on' : '') + '">' + t + '</button>').join('') + '</div>' +
      (lista.length ? '<div class="tc-lista">' + lista.map(p => '<div class="tc-fila tc-ped ' + p.estado + '" style="display:block"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center"><span><strong>#' + p.id + ' · ' + esc(p.cliente) + '</strong><small>' + esc(p.contacto) + ' · ' + p.prendas + ' prendas · ' + fecha(p.creado) + ' · ' + p.estado + '</small>' + cotInfo(p) + '</span><span class="tc-acc"><button class="tc-btn mini sec" data-ver="' + p.id + '">' + (abiertos.has(p.id) ? 'Ocultar' : 'Ver detalle') + '</button><a class="tc-btn mini" style="display:inline-flex;align-items:center;text-decoration:none" href="/api/club/pedidos/' + p.id + '/excel">Descargar listado</a>' +
        (p.estado === 'pendiente' ? '<button class="tc-btn mini" data-res="aprobada" data-id="' + p.id + '">Aprobar</button><button class="tc-btn mini bad" data-res="rechazada" data-id="' + p.id + '">Rechazar</button>' : '<button class="tc-btn mini sec" data-res="pendiente" data-id="' + p.id + '">Volver a pendiente</button>') + '</span></div>' + (abiertos.has(p.id) ? detalle(p) : '') + '</div>').join('') + '</div>' : '<div class="tc-vacio">No hay reposiciones en esta vista.</div>') +
      '<p style="margin-top:12px">El Excel usa la plantilla de listado de Indoor (una hoja con el nombre de la referencia; si son varias referencias, vienen en un .zip) y trae la tela del pedido anterior con su código. Si una tela aparece con varios códigos (colores), elige el correcto antes de programar.</p></section></div>';
    if (html === ultimo) return;   // sin cambios: no se redibuja (evita parpadeo)
    const campo = panel.querySelector('#tc-cliente'), valor = campo ? campo.value : '', enfoque = campo && document.activeElement === campo;
    panel.innerHTML = ultimo = html;
    const nuevo = panel.querySelector('#tc-cliente');
    if (nuevo && valor) nuevo.value = valor;
    if (nuevo && enfoque) nuevo.focus();
  }

  async function cargar() {
    if (cargando || !panel) return;
    cargando = true;
    try {
      const [a, p, e] = await Promise.all([api('/api/club/enlaces'), api('/api/club/pedidos'), api('/api/club/effitron').catch(() => null)]);
      enlaces = a.enlaces; pedidos = p.pedidos; effi = e; pintar();
    } catch (e) { panel.innerHTML = '<div class="tc"><div class="tc-card"><p>' + esc(e.message) + '</p></div></div>'; ultimo = ''; }
    finally { cargando = false; }
  }

  async function sugerir(q) {
    try { const d = await api('/api/club/clientes?q=' + encodeURIComponent(q)); const dl = panel.querySelector('#tc-clientes'); if (dl) dl.innerHTML = d.clientes.map(c => '<option value="' + esc(c.nombre) + '">' + c.pedidos + ' pedidos</option>').join(''); } catch (e) { /* sin sugerencias */ }
  }

  function iniciar() {
    panel = document.querySelector('.panel[data-panel="club"]');
    if (!panel) return;
    let t = 0;
    panel.addEventListener('input', e => { if (e.target.id === 'tc-cliente') { clearTimeout(t); t = setTimeout(() => sugerir(e.target.value), 250); } });
    panel.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.id === 'tc-crear') {
          const cliente = panel.querySelector('#tc-cliente').value.trim();
          const d = await api('/api/club/enlaces', 'POST', { cliente, dias: Number(panel.querySelector('#tc-dias').value) });
          aviso = 'Enlace listo: <b>' + esc(url(d.token)) + '</b>'; try { await navigator.clipboard.writeText(url(d.token)); aviso += ' (copiado)'; } catch (er) { /* sin portapapeles */ }
          await cargar(); return;
        }
        if (b.dataset.copiar) { try { await navigator.clipboard.writeText(url(b.dataset.copiar)); aviso = 'Enlace copiado: ' + esc(url(b.dataset.copiar)); } catch (er) { aviso = 'Copia este enlace: ' + esc(url(b.dataset.copiar)); } pintar(); return; }
        if (b.dataset.revocar) { if (!confirm('¿Revocar este enlace? El cliente ya no podrá abrirlo.')) return; await api('/api/club/enlaces/' + b.dataset.revocar, 'DELETE'); aviso = 'Enlace revocado.'; await cargar(); return; }
        if (b.dataset.cotreint) { await api('/api/club/pedidos/' + b.dataset.cotreint + '/cotizacion/reintentar', 'POST'); aviso = 'Reintentando la cotización…'; await cargar(); return; }
        if (b.dataset.filtro !== undefined) { filtro = b.dataset.filtro; pintar(); return; }
        if (b.dataset.ver) { const id = Number(b.dataset.ver); abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); pintar(); return; }
        if (b.dataset.res) { await api('/api/club/pedidos/' + b.dataset.id + '/resolver', 'POST', { estado: b.dataset.res }); await cargar(); }
      } catch (er) { aviso = esc(er.message); pintar(); }
    });
    document.querySelectorAll('.tab[data-kind="club"]').forEach(tab => tab.addEventListener('click', () => cargar()));
    setInterval(() => { if (!document.hidden && panel.classList.contains('active')) cargar(); }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
