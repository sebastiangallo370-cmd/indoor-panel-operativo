/* REPORTES: reportes de daño / incidente de planta con firma digital.
   Administración crea el reporte → el operario escribe su versión y lo firma → administración registra la decisión y firma. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ESTADOS = {
    pendiente: ['Por firmar', '#ffb347'], firmado: ['Firmado · falta decisión', '#6cb6ff'],
    resuelto: ['Cerrado', '#8bd450'], anulado: ['Anulado', '#8f9b8a']
  };
  const st = { admin: false, usuario: '', reportes: [], opciones: null, filtro: 'activos', q: '', loading: false };
  let panel, tab;

  async function api(url, options) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let data = null;
    try { data = await response.json(); } catch (e) { /* sin cuerpo JSON */ }
    if (!response.ok) throw new Error((data && data.detail) || 'No fue posible completar la acción');
    return data;
  }
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fechaCorta = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s || '—'); };
  const fechaHora = s => { const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  const css = document.createElement('style');
  css.textContent = `
  body:has(.panel[data-panel='reportes'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(18px,4vw,76px)!important;padding-right:clamp(18px,4vw,76px)!important}
  .tab[data-kind='reportes'] .nav-icon{display:none!important}
  .rpt{display:grid;gap:16px;max-width:1440px;margin:auto}
  .rpt-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:22px;border:1px solid #3a2b2b;border-radius:18px;background:linear-gradient(135deg,#241818,#11150f)}
  .rpt-head span{color:#ff9c99;font:900 10px Arial;letter-spacing:.12em}.rpt-head h2{margin:4px 0;font-size:1.6rem}.rpt-head p{margin:0;color:#aebba7;font-size:.9rem}
  .rpt button{width:auto}
  .rpt-btn{min-height:40px;padding:0 16px;border:0;border-radius:10px;background:#d0f44c;color:#142017;font:800 13px Arial;cursor:pointer}
  .rpt-btn.sec{background:transparent;border:1px solid #60754d;color:#e3eadc}.rpt-btn.danger{background:#ef7370;color:#251111}.rpt-btn:disabled{opacity:.6;cursor:progress}
  .rpt-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .rpt-bar input{flex:0 1 300px;min-height:38px;padding:7px 12px;border:1px solid #3d4f3d;border-radius:10px;background:#0f1410;color:#f1f7ed;font:600 13px Arial}
  .rpt-chips{display:flex;gap:8px;flex-wrap:wrap}.rpt-chips button{padding:8px 14px;border:1px solid #3d4f3d;border-radius:999px;background:transparent;color:#cdd8c6;font:800 12px Arial;cursor:pointer;min-height:0}.rpt-chips button.on{background:#d0f44c;color:#142017;border-color:#d0f44c}
  .rpt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
  .rpt-card{--c:#8f9b8a;display:grid;gap:9px;padding:16px;border:1px solid #34432f;border-top:4px solid var(--c);border-radius:15px;background:linear-gradient(150deg,#1a221a,#10140f);color:#eef4e9;text-align:left;cursor:pointer;font:inherit;transition:transform .15s}
  .rpt-card:hover{transform:translateY(-2px)}
  .rpt-card header{display:flex;justify-content:space-between;gap:8px;align-items:center}.rpt-card strong{font-size:.95rem}
  .rpt-badge{padding:3px 9px;border-radius:999px;font:800 10px Arial;color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);white-space:nowrap}
  .rpt-card h3{margin:0;font-size:1rem}.rpt-card small{color:#aebba7}.rpt-card p{margin:0;color:#c4cfbf;font-size:.84rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .rpt-empty{padding:30px;text-align:center;color:#8f9b8a;border:1px dashed #34432f;border-radius:14px}
  .tab .rpt-dot{display:inline-grid;place-items:center;min-width:18px;height:18px;margin-left:6px;padding:0 5px;border-radius:999px;background:#ef7370;color:#251111;font:900 10px Arial}
  dialog.rpt-dlg{width:min(720px,94vw);max-height:92vh;padding:0;border:1px solid #3d4f3d;border-radius:18px;background:#111611;color:#eef4e9;overflow:auto}
  dialog.rpt-dlg::backdrop{background:rgba(0,0,0,.65)}
  .rpt-dlg form,.rpt-dlg .rpt-body{display:grid;gap:14px;padding:22px}
  .rpt-dlg h2{margin:0;font-size:1.25rem}.rpt-dlg h4{margin:6px 0 0;padding:6px 10px;border-radius:8px;background:#1d281b;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:#d0f44c}
  .rpt-dlg label{display:grid;gap:5px;font-size:.78rem;color:#aebba7;text-transform:uppercase;letter-spacing:.04em}
  .rpt-dlg input:not([type=checkbox]):not([type=radio]),.rpt-dlg select,.rpt-dlg textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #3d4f3d;border-radius:10px;background:#0c110d;color:#f1f7ed;font:600 14px Arial;text-transform:none;letter-spacing:0}
  .rpt-dlg textarea{min-height:96px;resize:vertical}
  .rpt-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .rpt-kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:.9rem}.rpt-kv b{color:#aebba7;font-weight:700}
  .rpt-txt{white-space:pre-wrap;margin:0;line-height:1.45;font-size:.92rem}
  .rpt-pad{display:grid;gap:6px}.rpt-pad canvas{width:100%;height:150px;border:2px dashed #60754d;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}
  .rpt-pad small{color:#8f9b8a}
  .rpt-sig{display:grid;gap:4px;padding:10px;border:1px solid #34432f;border-radius:12px;background:#0c110d}.rpt-sig img{max-height:80px;max-width:100%;background:#fff;border-radius:6px;justify-self:start}.rpt-sig small{color:#8f9b8a;word-break:break-all}
  .rpt-check{display:flex!important;grid-template-columns:none!important;align-items:flex-start;gap:10px!important;text-transform:none!important;letter-spacing:0!important;font-size:.88rem!important;color:#e3eadc!important}.rpt-check input{margin-top:3px;flex:none}
  .rpt-radios{display:grid;gap:8px}.rpt-radios label{display:flex!important;align-items:center;gap:10px!important;padding:10px 12px;border:1px solid #3d4f3d;border-radius:10px;text-transform:none!important;letter-spacing:0!important;font-size:.9rem!important;color:#eef4e9!important;cursor:pointer}
  .rpt-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.rpt-err{color:#ff9b9b;font-size:.85rem;min-height:1em}
  .rpt-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9999;max-width:90vw;padding:12px 18px;border-radius:12px;background:#ef7370;color:#251111;font:800 13px Arial;box-shadow:0 10px 30px #0008;cursor:pointer}
  html.theme-light dialog.rpt-dlg{background:#fff;color:#18210f;border-color:#cdd8c6}html.theme-light .rpt-dlg input:not([type=checkbox]):not([type=radio]),html.theme-light .rpt-dlg select,html.theme-light .rpt-dlg textarea{background:#f6f8f2;color:#18210f;border-color:#cdd8c6}
  html.theme-light .rpt-dlg h4{background:#e9efe2;color:#3f6a10}html.theme-light .rpt-dlg label,html.theme-light .rpt-kv b{color:#5d6a55}html.theme-light .rpt-sig{background:#f6f8f2;border-color:#cdd8c6}
  @media(max-width:700px){dialog.rpt-dlg{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.rpt-two{grid-template-columns:1fr}.rpt-kv{grid-template-columns:1fr}.rpt-actions button{flex:1}.rpt-bar input{flex:1 1 100%}.rpt-btn{min-height:46px}}
  `;
  document.head.appendChild(css);

  // ---- Firma dibujada (mouse o dedo)
  function signaturePad(host) {
    host.innerHTML = '<canvas></canvas><small>Firma con el dedo o el mouse dentro del recuadro. <a href="#" data-clear style="color:#d0f44c">Borrar</a></small>';
    const canvas = host.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false, dirty = false, last = null;
    function size() {
      const ratio = Math.max(1, window.devicePixelRatio || 1), box = canvas.getBoundingClientRect();
      if (!box.width) return;
      canvas.width = Math.round(box.width * ratio); canvas.height = Math.round(box.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, box.width, box.height);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; dirty = false;
    }
    const point = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = point(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); dirty = true; });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const p = point(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    host.querySelector('[data-clear]').addEventListener('click', e => { e.preventDefault(); size(); });
    requestAnimationFrame(size);
    return { isEmpty: () => !dirty, data: () => canvas.toDataURL('image/png') };
  }

  // ---- Diálogos
  function openDialog(html) {
    const dialog = document.createElement('dialog');
    dialog.className = 'rpt-dlg';
    dialog.innerHTML = html;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.showModal();
    return dialog;
  }
  const firmaBloque = (titulo, f) => f ? '<div class="rpt-sig"><b>' + titulo + '</b>' + (f.imagen ? '<img alt="Firma" src="' + esc(f.imagen) + '">' : '') + '<small>' + esc(f.firmante || '') + ' · ' + fechaHora(f.fecha) + (f.ip ? ' · IP ' + esc(f.ip) : '') + '</small></div>' : '';

  async function openReport(id) {
    let r;
    try { r = await api('/api/reportes/' + encodeURIComponent(id)); } catch (e) { alert(e.message); return; }
    const mine = r.operario && r.operario.toLowerCase() === st.usuario.toLowerCase();
    const puedeFirmar = mine && r.estado === 'pendiente';
    const puedeDecidir = st.admin && r.estado === 'firmado';
    const dlg = openDialog('<div class="rpt-body"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><small style="color:#aebba7">' + esc(r.numero) + '</small><h2>Reporte de daño / incidente de planta</h2></div><span class="rpt-badge" style="--c:' + ESTADOS[r.estado][1] + '">' + ESTADOS[r.estado][0] + '</span></div>' +
      '<h4>Datos del incidente y personal</h4><div class="rpt-kv"><b>Operario</b><span>' + esc(r.operarioNombre) + '</span><b>Cargo</b><span>' + esc(r.cargo || '—') + '</span><b>Fecha</b><span>' + fechaCorta(r.fechaHecho) + '</span><b>Hora</b><span>' + esc(r.horaHecho || '—') + '</span><b>OP / Lote</b><span>' + esc(r.orden || '—') + '</span></div>' +
      '<h4>1. Detalle del daño o material perdido</h4><p class="rpt-txt"><b>¿Qué pasó?</b>\n' + esc(r.quePaso) + '</p><p class="rpt-txt"><b>Cantidad / material perdido:</b> ' + esc(r.material || '—') + '</p>' +
      '<h4>2. Versión del operario</h4>' + (r.versionOperario ? '<p class="rpt-txt">' + esc(r.versionOperario) + '</p>' : puedeFirmar ? '<label>Escribe tu versión de lo ocurrido<textarea data-f="version" maxlength="3000" placeholder="Cuenta con tus palabras qué pasó"></textarea></label>' : '<p class="rpt-txt" style="color:#8f9b8a">Pendiente de la versión del operario.</p>') +
      '<h4>Firmas</h4><div class="rpt-sig"><b>Coordinador de Planta</b><small>' + esc(r.creadoPor) + ' · ' + fechaHora(r.creado) + '</small></div>' + firmaBloque('Firma operario', r.firma) +
      (puedeFirmar ? '<div class="rpt-pad" data-pad="op"></div><label class="rpt-check"><input type="checkbox" data-f="acepta"> Leí este reporte y firmo digitalmente. Mi firma, fecha, hora e IP quedan registradas.</label>' : '') +
      (r.gerencia ? '<h4>Uso exclusivo de gerencia / administración</h4><p class="rpt-txt"><b>Decisión:</b> ' + esc(r.gerencia.decision) + '</p>' + (r.gerencia.nota ? '<p class="rpt-txt">' + esc(r.gerencia.nota) + '</p>' : '') + firmaBloque('Firma gerencia', r.gerencia) : '') +
      (puedeDecidir ? '<h4>Uso exclusivo de gerencia / administración</h4><div class="rpt-radios">' + st.opciones.decisiones.map((d, i) => '<label><input type="radio" name="dec" value="' + esc(d) + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(d) + '</label>').join('') + '</div><label>Nota (opcional)<textarea data-f="nota" maxlength="1500"></textarea></label><div class="rpt-pad" data-pad="ger"></div>' : '') +
      '<div class="rpt-err" data-err></div><div class="rpt-actions"><button type="button" class="rpt-btn sec" data-doc>Imprimir / PDF</button>' + (st.admin && r.estado === 'pendiente' ? '<button type="button" class="rpt-btn danger" data-anular>Anular</button>' : '') +
      (puedeFirmar ? '<button type="button" class="rpt-btn" data-send>Firmar y enviar</button>' : '') + (puedeDecidir ? '<button type="button" class="rpt-btn" data-decidir>Registrar decisión y firmar</button>' : '') + '<button type="button" class="rpt-btn sec" data-close>Cerrar</button></div></div>');
    const err = msg => { dlg.querySelector('[data-err]').textContent = msg || ''; };
    const pad = dlg.querySelector('[data-pad]') ? signaturePad(dlg.querySelector('[data-pad]')) : null;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelector('[data-doc]').onclick = () => window.open('/api/reportes/' + encodeURIComponent(r.id) + '/documento', '_blank');
    const act = (selector, build, url) => {
      const btn = dlg.querySelector(selector);
      if (!btn) return;
      btn.onclick = async () => {
        err('');
        const body = build();
        if (!body) return;
        btn.disabled = true;
        try { await api(url, { method: 'POST', body: JSON.stringify(body) }); dlg.close(); await load(true); } catch (e) { err(e.message); btn.disabled = false; }
      };
    };
    act('[data-send]', () => {
      const version = dlg.querySelector('[data-f="version"]')?.value.trim();
      if (!version) { err('Escribe tu versión de lo ocurrido.'); return null; }
      if (pad.isEmpty()) { err('Dibuja tu firma en el recuadro.'); return null; }
      if (!dlg.querySelector('[data-f="acepta"]').checked) { err('Marca la casilla de confirmación.'); return null; }
      return { version, firma: pad.data(), acepta: true };
    }, '/api/reportes/' + r.id + '/firmar');
    act('[data-decidir]', () => {
      if (pad.isEmpty()) { err('Dibuja tu firma de gerencia.'); return null; }
      return { decision: dlg.querySelector('input[name="dec"]:checked').value, nota: dlg.querySelector('[data-f="nota"]').value, firma: pad.data() };
    }, '/api/reportes/' + r.id + '/decision');
    const anular = dlg.querySelector('[data-anular]');
    if (anular) anular.onclick = async () => {
      if (!confirm('¿Anular este reporte? El operario ya no podrá firmarlo.')) return;
      try { await api('/api/reportes/' + r.id + '/anular', { method: 'POST', body: '{}' }); dlg.close(); await load(true); } catch (e) { err(e.message); }
    };
  }

  function newReport() {
    const users = st.opciones.usuarios;
    const now = new Date();
    const dlg = openDialog('<form><h2>Nuevo reporte de daño / incidente</h2>' +
      '<label>Operario<select name="operario" required><option value="">Elige una persona…</option>' + users.map(u => '<option value="' + esc(u.usuario) + '" data-cargo="' + esc(u.proceso) + '">' + esc(u.nombre) + (u.proceso ? ' · ' + esc(u.proceso) : '') + '</option>').join('') + '</select></label>' +
      '<div class="rpt-two"><label>Cargo<input name="cargo" maxlength="80"></label><label>OP / Lote<input name="orden" maxlength="60" placeholder="Ej. RM7352"></label></div>' +
      '<div class="rpt-two"><label>Fecha<input type="date" name="fechaHecho" required value="' + iso(now) + '"></label><label>Hora<input type="time" name="horaHecho" value="' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '"></label></div>' +
      '<label>¿Qué pasó?<textarea name="quePaso" required maxlength="3000" placeholder="Describe el daño o el error"></textarea></label>' +
      '<label>Cantidad / material perdido<input name="material" maxlength="400" placeholder="Ej. 3 camisetas, 2 m de tela"></label>' +
      '<div class="rpt-err" data-err></div><div class="rpt-actions"><button type="button" class="rpt-btn sec" data-close>Cancelar</button><button type="submit" class="rpt-btn">Enviar al operario</button></div></form>');
    const form = dlg.querySelector('form');
    form.operario.addEventListener('change', () => { const opt = form.operario.selectedOptions[0]; if (opt && opt.dataset.cargo !== undefined) form.cargo.value = opt.dataset.cargo; });
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api('/api/reportes', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        dlg.close(); st.filtro = 'activos'; await load(true);
      } catch (e) { dlg.querySelector('[data-err]').textContent = e.message; btn.disabled = false; }
    });
  }

  // ---- Lista
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function visibleList() {
    const q = norm(st.q);
    return st.reportes.filter(r => {
      const porEstado = st.filtro === 'todos' ? true : st.filtro === 'activos' ? (r.estado === 'pendiente' || r.estado === 'firmado') : r.estado === st.filtro;
      return porEstado && (!q || norm([r.numero, r.operarioNombre, r.orden, r.quePaso].join(' ')).includes(q));
    });
  }
  function render() {
    if (!panel) return;
    const count = f => st.reportes.filter(r => f === 'activos' ? (r.estado === 'pendiente' || r.estado === 'firmado') : f === 'todos' ? true : r.estado === f).length;
    const chips = (st.admin ? [['activos', 'Abiertos'], ['pendiente', 'Por firmar'], ['firmado', 'Por decidir'], ['resuelto', 'Cerrados'], ['anulado', 'Anulados'], ['todos', 'Todos']] : [['activos', 'Por firmar'], ['resuelto', 'Cerrados'], ['firmado', 'Firmados'], ['todos', 'Todos']]);
    const list = visibleList();
    panel.innerHTML = '<div class="rpt"><header class="rpt-head"><div><span>CONTROL DE PLANTA</span><h2>REPORTES</h2><p>' + (st.admin ? 'Reportes de daño o incidente enviados al personal, con firma digital.' : 'Reportes dirigidos a ti. Léelos, escribe tu versión y fírmalos.') + '</p></div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (st.admin ? '<button type="button" class="rpt-btn" data-new>+ Nuevo reporte</button>' : '') + '<button type="button" class="rpt-btn sec" data-refresh>Actualizar</button></div></header>' +
      '<div class="rpt-bar"><div class="rpt-chips">' + chips.map(([k, l]) => '<button type="button" data-f="' + k + '" class="' + (st.filtro === k ? 'on' : '') + '">' + l + ' (' + count(k) + ')</button>').join('') + '</div><input type="search" data-q placeholder="Buscar número, persona u orden" autocomplete="off" value="' + esc(st.q) + '"></div>' +
      (list.length ? '<div class="rpt-grid">' + list.map(r => { const [label, color] = ESTADOS[r.estado]; return '<button type="button" class="rpt-card" style="--c:' + color + '" data-id="' + r.id + '"><header><strong>' + esc(r.numero) + '</strong><span class="rpt-badge">' + label + '</span></header><h3>' + esc(r.operarioNombre) + '</h3><small>' + fechaCorta(r.fechaHecho) + (r.orden ? ' · ' + esc(r.orden) : '') + '</small><p>' + esc(r.quePaso) + '</p></button>'; }).join('') + '</div>'
        : '<div class="rpt-empty">' + (st.loading ? 'Cargando…' : 'No hay reportes en esta vista.') + '</div>') + '</div>';
    const search = panel.querySelector('[data-q]');
    search.addEventListener('input', () => { st.q = search.value; const pos = search.selectionStart; render(); const again = panel.querySelector('[data-q]'); again.focus(); again.setSelectionRange(pos, pos); });
  }
  async function load(force) {
    if (st.loading && !force) return;
    st.loading = true;
    try {
      if (!st.opciones || force) st.opciones = await api('/api/reportes/opciones');
      st.admin = st.opciones.admin; st.usuario = st.opciones.usuario;
      st.reportes = (await api('/api/reportes')).reportes;
    } catch (e) { if (panel && !st.reportes.length) panel.innerHTML = '<div class="rpt"><div class="rpt-empty">' + esc(e.message) + '</div></div>'; st.loading = false; return; }
    st.loading = false; render(); badge();
  }

  // ---- Aviso de pendientes (insignia en el menú y un aviso al entrar)
  let toastShown = false;
  async function badge() {
    if (!tab) return;
    let pendientes = 0;
    try { pendientes = (await api('/api/reportes/resumen')).pendientes; } catch (e) { return; }
    tab.querySelectorAll('.rpt-dot').forEach(x => x.remove());
    if (pendientes) { const dot = document.createElement('span'); dot.className = 'rpt-dot'; dot.textContent = pendientes; tab.querySelector('strong')?.after(dot); }
    if (pendientes && !toastShown) {
      toastShown = true;
      try { if (sessionStorage.getItem('rptToast')) return; sessionStorage.setItem('rptToast', '1'); } catch (e) { /* sin sessionStorage */ }
      const toast = document.createElement('div'); toast.className = 'rpt-toast';
      toast.textContent = st.admin ? pendientes + ' reporte(s) esperan firma o decisión' : 'Tienes ' + pendientes + ' reporte(s) por firmar · toca para verlos';
      toast.onclick = () => { toast.remove(); tab.click(); };
      document.body.appendChild(toast); setTimeout(() => toast.remove(), 12000);
    }
  }

  // ---- Menú y panel
  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="reproceso"]')?.closest('.nav-group') || document.querySelector('#news-toggle')?.closest('.nav-group');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="reportes"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'reportes';
    panel.innerHTML = '<div class="rpt"><div class="rpt-empty">Cargando reportes…</div></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="reportes" type="button"><span class="nav-icon">RT</span><strong>REPORTES</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
      load(true);
    });
    panel.addEventListener('click', e => {
      const card = e.target.closest('[data-id]'); const chip = e.target.closest('[data-f]');
      if (card) openReport(card.dataset.id);
      else if (chip) { st.filtro = chip.dataset.f; render(); }
      else if (e.target.closest('[data-new]')) newReport();
      else if (e.target.closest('[data-refresh]')) load(true);
    });
    return true;
  }
  let tries = 0;
  const wait = setInterval(() => { if (build() || ++tries > 60) { clearInterval(wait); if (tab) badge(); } }, 250);
  setInterval(() => { if (!document.hidden && tab) { if (panel.classList.contains('active') && !document.querySelector('dialog.rpt-dlg')) load(true); else badge(); } }, 60000);
})();
