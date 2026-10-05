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
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='reportes']){display:none!important}}
  .user-menu summary{position:relative}.rpt-avdot{position:absolute;top:2px;left:34px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ef7370;color:#251111;font:900 9px/16px Arial;text-align:center}
  .user-dropdown #open-reportes{display:flex;justify-content:space-between;align-items:center;gap:8px}
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
  .rpt-flist{display:grid;gap:8px;max-height:52vh;overflow:auto}.rpt-frow{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:9px 12px;border:1px solid #34432f;border-radius:12px;background:#0c110d}.rpt-frow small{display:block;color:#8f9b8a;font-size:.72rem}
  .rpt-upl{padding:7px 12px;border:1px solid #60754d;border-radius:9px;color:#d0f44c;font:800 11px Arial;cursor:pointer;white-space:nowrap}
  .rpt-sig img[data-src-user]{min-height:40px}
  .rpt-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .rpt-kv{display:grid;grid-template-columns:140px 1fr;gap:6px 12px;font-size:.9rem}.rpt-kv b{color:#aebba7;font-weight:700}
  .rpt-txt{white-space:pre-wrap;margin:0;line-height:1.45;font-size:.92rem}
  .rpt-pad{display:grid;gap:6px}.rpt-pad canvas{width:100%;height:150px;border:2px dashed #60754d;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}
  .rpt-pad small{color:#8f9b8a}
  .rpt-sig{display:grid;gap:4px;padding:10px;border:1px solid #34432f;border-radius:12px;background:#0c110d}.rpt-sig img{max-height:80px;max-width:100%;background:#fff;border-radius:6px;justify-self:start}.rpt-sig small{color:#8f9b8a;word-break:break-all}
  .rpt-check{display:flex!important;grid-template-columns:none!important;align-items:flex-start;gap:10px!important;text-transform:none!important;letter-spacing:0!important;font-size:.88rem!important;color:#e3eadc!important}.rpt-check input{margin-top:3px;flex:none}
  .rpt-radios{display:grid;gap:8px}.rpt-radios label{display:flex!important;align-items:center;gap:10px!important;padding:10px 12px;border:1px solid #3d4f3d;border-radius:10px;text-transform:none!important;letter-spacing:0!important;font-size:.9rem!important;color:#eef4e9!important;cursor:pointer}
  .rpt-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.rpt-err{color:#ff9b9b;font-size:.85rem;min-height:1em}

  html.theme-light dialog.rpt-dlg{background:#fff;color:#18210f;border-color:#cdd8c6}html.theme-light .rpt-dlg input:not([type=checkbox]):not([type=radio]),html.theme-light .rpt-dlg select,html.theme-light .rpt-dlg textarea{background:#f6f8f2;color:#18210f;border-color:#cdd8c6}
  html.theme-light .rpt-dlg h4{background:#e9efe2;color:#3f6a10}html.theme-light .rpt-dlg label,html.theme-light .rpt-kv b{color:#5d6a55}html.theme-light .rpt-sig{background:#f6f8f2;border-color:#cdd8c6}
  @media(max-width:700px){.rpt-frow{grid-template-columns:1fr auto}.rpt-upl{grid-column:1/-1;text-align:center;padding:11px}dialog.rpt-dlg{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}.rpt-two{grid-template-columns:1fr}.rpt-kv{grid-template-columns:1fr}.rpt-actions button{flex:1}.rpt-bar input{flex:1 1 100%}.rpt-btn{min-height:46px}}
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
  const firmaBloque = (titulo, f) => f ? '<div class="rpt-sig"><b>' + titulo + '</b>' + (f.imagen ? '<img alt="Firma" src="' + esc(f.imagen) + '">' : '') + '<small>' + esc(f.firmante || '') + ' · ' + fechaHora(f.fecha) + (f.ip ? ' · IP ' + esc(f.ip) : '') + '</small>' + (f.registradoPor ? '<small>Firma registrada en presencia por ' + esc(f.registradoPor) + '</small>' : '') + '</div>' : '';

  async function openReport(id) {
    let r;
    try { r = await api('/api/reportes/' + encodeURIComponent(id)); } catch (e) { alert(e.message); return; }
    const mine = r.operario && r.operario.toLowerCase() === st.usuario.toLowerCase();
    const presencial = st.admin && !mine && r.estado === 'pendiente';
    const puedeFirmar = (mine || presencial) && r.estado === 'pendiente';
    const puedeDecidir = st.admin && r.estado === 'firmado';
    const tiene = u => (st.opciones.firmas || []).some(x => String(x).toLowerCase() === String(u).toLowerCase());
    const storedOp = puedeFirmar && (mine ? st.opciones.miFirma : tiene(r.operario));
    const storedGer = puedeDecidir && st.opciones.miFirma;
    const storedBox = (kind, usuario, label) => '<div class="rpt-sig" data-stored="' + kind + '"><b>' + label + '</b><img alt="Firma registrada" data-src-user="' + esc(usuario) + '"><small>Firma registrada · se aplicará al pulsar el botón</small></div>';
    const dlg = openDialog('<div class="rpt-body"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><small style="color:#aebba7">' + esc(r.numero) + '</small><h2>Reporte de daño / incidente de planta</h2></div><span class="rpt-badge" style="--c:' + ESTADOS[r.estado][1] + '">' + ESTADOS[r.estado][0] + '</span></div>' +
      '<h4>Datos del incidente y personal</h4><div class="rpt-kv"><b>Operario</b><span>' + esc(r.operarioNombre) + '</span><b>Cargo</b><span>' + esc(r.cargo || '—') + '</span><b>Fecha</b><span>' + fechaCorta(r.fechaHecho) + '</span><b>Hora</b><span>' + esc(r.horaHecho || '—') + '</span><b>OP / Lote</b><span>' + esc(r.orden || '—') + '</span></div>' +
      '<h4>1. Detalle del daño o material perdido</h4><p class="rpt-txt"><b>¿Qué pasó?</b>\n' + esc(r.quePaso) + '</p><p class="rpt-txt"><b>Cantidad / material perdido:</b> ' + esc(r.material || '—') + '</p>' +
      '<h4>2. Versión del operario</h4>' + (r.versionOperario ? '<p class="rpt-txt">' + esc(r.versionOperario) + '</p>' : puedeFirmar ? '<label>' + (presencial ? 'Versión del operario (la que él te cuenta)' : 'Escribe tu versión de lo ocurrido') + '<textarea data-f="version" maxlength="3000" placeholder="' + (presencial ? 'Escribe lo que el operario responde' : 'Cuenta con tus palabras qué pasó') + '"></textarea></label>' : '<p class="rpt-txt" style="color:#8f9b8a">Pendiente de la versión del operario.</p>') +
      '<h4>Firmas</h4><div class="rpt-sig"><b>Coordinador de Planta</b><small>' + esc(r.creadoPor) + ' · ' + fechaHora(r.creado) + '</small></div>' + firmaBloque('Firma operario', r.firma) +
      (puedeFirmar ? (presencial && !storedOp ? '<p class="rpt-txt" style="color:#ffc98a">Esta persona no tiene firma registrada: pásale la pantalla a <b>' + esc(r.operarioNombre) + '</b> para que firme aquí (o registra su foto en «Firmas»).</p>' : '') + (storedOp ? storedBox('op', r.operario, presencial ? 'Firma registrada de ' + esc(r.operarioNombre) : 'Tu firma') : '<div class="rpt-pad" data-pad="op"></div>') + '<label class="rpt-check"><input type="checkbox" data-f="acepta"> ' + (presencial ? esc(r.operarioNombre) + ' leyó este reporte y firmó en mi presencia. Queda registrado que la firma fue ingresada por mí.' : 'Leí este reporte y firmo digitalmente. Mi firma, fecha, hora e IP quedan registradas.') + '</label>' : '') +
      (r.gerencia ? '<h4>Uso exclusivo de gerencia / administración</h4><p class="rpt-txt"><b>Decisión:</b> ' + esc(r.gerencia.decision) + '</p>' + (r.gerencia.nota ? '<p class="rpt-txt">' + esc(r.gerencia.nota) + '</p>' : '') + firmaBloque('Firma gerencia', r.gerencia) : '') +
      (puedeDecidir ? '<h4>Uso exclusivo de gerencia / administración</h4><div class="rpt-radios">' + st.opciones.decisiones.map((d, i) => '<label><input type="radio" name="dec" value="' + esc(d) + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(d) + '</label>').join('') + '</div><label>Nota (opcional)<textarea data-f="nota" maxlength="1500"></textarea></label>' + (storedGer ? storedBox('ger', st.usuario, 'Tu firma de gerencia') : '<div class="rpt-pad" data-pad="ger"></div>') : '') +
      '<div class="rpt-err" data-err></div><div class="rpt-actions"><button type="button" class="rpt-btn sec" data-doc>Imprimir / PDF</button>' + (st.admin && r.estado === 'pendiente' ? '<button type="button" class="rpt-btn danger" data-anular>Anular</button>' : '') +
      (puedeFirmar ? '<button type="button" class="rpt-btn" data-send>' + (presencial ? 'Registrar firma del operario' : storedOp ? 'Firmar' : 'Firmar y enviar') + '</button>' : '') + (puedeDecidir ? '<button type="button" class="rpt-btn" data-decidir>Registrar decisión y firmar</button>' : '') + '<button type="button" class="rpt-btn sec" data-close>Cerrar</button></div></div>');
    const err = msg => { dlg.querySelector('[data-err]').textContent = msg || ''; };
    const pad = dlg.querySelector('[data-pad]') ? signaturePad(dlg.querySelector('[data-pad]')) : null;
    dlg.querySelectorAll('[data-src-user]').forEach(img => api('/api/reportes/firma-usuario/' + encodeURIComponent(img.dataset.srcUser)).then(d => { img.src = d.imagen; }).catch(() => { img.alt = 'No se pudo cargar la firma'; }));
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
      if (!storedOp && pad.isEmpty()) { err('Dibuja tu firma en el recuadro.'); return null; }
      if (!dlg.querySelector('[data-f="acepta"]').checked) { err('Marca la casilla de confirmación.'); return null; }
      return storedOp ? { version, usarGuardada: true, acepta: true } : { version, firma: pad.data(), acepta: true };
    }, '/api/reportes/' + r.id + (presencial ? '/firmar-presencial' : '/firmar'));
    act('[data-decidir]', () => {
      if (!storedGer && pad.isEmpty()) { err('Dibuja tu firma de gerencia.'); return null; }
      const base = { decision: dlg.querySelector('input[name="dec"]:checked').value, nota: dlg.querySelector('[data-f="nota"]').value };
      return storedGer ? { ...base, usarGuardada: true } : { ...base, firma: pad.data() };
    }, '/api/reportes/' + r.id + '/decision');
    const anular = dlg.querySelector('[data-anular]');
    if (anular) anular.onclick = async () => {
      if (!confirm('¿Anular este reporte? El operario ya no podrá firmarlo.')) return;
      try { await api('/api/reportes/' + r.id + '/anular', { method: 'POST', body: '{}' }); dlg.close(); await load(true); } catch (e) { err(e.message); }
    };
  }


  // ---- Firmas de usuarios (foto de la firma, registrada por la administración)
  function photoToSignature(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        let width = Math.min(640, img.naturalWidth), data = '';
        for (let i = 0; i < 4; i++) {
          const canvas = document.createElement('canvas'), height = Math.max(1, Math.round(img.naturalHeight * width / img.naturalWidth));
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
          const pixels = ctx.getImageData(0, 0, width, height), px = pixels.data;   // gris + contraste: la firma se ve nítida y pesa menos
          for (let k = 0; k < px.length; k += 4) { const g = Math.max(0, Math.min(255, ((px[k] * .299 + px[k + 1] * .587 + px[k + 2] * .114) - 128) * 1.5 + 140)); px[k] = px[k + 1] = px[k + 2] = g; }
          ctx.putImageData(pixels, 0, 0);
          data = canvas.toDataURL('image/png');
          if (data.length < 600000) return resolve(data);
          width = Math.round(width * .7);
        }
        reject(new Error('La foto es muy pesada; acércala a la firma o usa menos fondo'));
      };
      img.src = url;
    });
  }
  function signaturesDialog() {
    const users = st.opciones.usuarios, has = u => (st.opciones.firmas || []).some(x => String(x).toLowerCase() === u.toLowerCase());
    const dlg = openDialog('<div class="rpt-body"><h2>Firmas de usuarios</h2><p class="rpt-txt" style="color:#aebba7">Sube una foto de la firma de cada persona (en papel blanco, bien iluminada). Cuando llegue un reporte, esa persona solo pulsa «Firmar».</p>' +
      '<input type="search" data-q placeholder="Buscar persona" autocomplete="off" style="min-height:40px"><div class="rpt-flist" data-list></div><div class="rpt-err" data-err></div><div class="rpt-actions"><button type="button" class="rpt-btn sec" data-close>Cerrar</button></div></div>');
    const list = dlg.querySelector('[data-list]'), err = m => { dlg.querySelector('[data-err]').textContent = m || ''; };
    const paint = () => {
      const q = norm(dlg.querySelector('[data-q]').value);
      list.innerHTML = users.filter(u => !q || norm(u.nombre + ' ' + u.usuario).includes(q)).map(u => '<div class="rpt-frow"><div><b>' + esc(u.nombre) + '</b><small>' + esc(u.proceso || '') + '</small></div><span class="rpt-badge" style="--c:' + (has(u.usuario) ? '#8bd450' : '#ffb347') + '">' + (has(u.usuario) ? 'Con firma' : 'Sin firma') + '</span>' +
        '<label class="rpt-upl">' + (has(u.usuario) ? 'Cambiar foto' : 'Subir foto') + '<input type="file" accept="image/*" data-u="' + esc(u.usuario) + '" hidden></label></div>').join('') || '<p class="rpt-txt">Sin resultados.</p>';
    };
    paint();
    dlg.querySelector('[data-q]').addEventListener('input', paint);
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    list.addEventListener('change', async event => {
      const input = event.target.closest('input[type=file]');
      if (!input || !input.files[0]) return;
      err('');
      try {
        const firma = await photoToSignature(input.files[0]);
        const out = await api('/api/reportes/firma-usuario', { method: 'POST', body: JSON.stringify({ usuario: input.dataset.u, firma }) });
        st.opciones.firmas = out.firmas; paint();
      } catch (e) { err(e.message); }
    });
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
      (st.admin ? '<button type="button" class="rpt-btn" data-new>+ Nuevo reporte</button><button type="button" class="rpt-btn sec" data-firmas>Firmas</button>' + (('Notification' in window && Notification.permission === 'default') ? '<button type="button" class="rpt-btn sec" data-notif>🔔 Activar avisos</button>' : '') : '') + '<button type="button" class="rpt-btn sec" data-refresh>Actualizar</button></div></header>' +
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

  // ---- Aviso de pendientes: insignia en el menú y ventana de alerta al iniciar sesión (como la de inventario)
  let modal = null;
  function alertModal(data) {
    if (modal || !data.items.length) return;
    const admin = data.admin, n = data.pendientes;
    const ov = modal = document.createElement('div');
    ov.className = 'rpa-overlay';
    ov.innerHTML = '<div class="rpa-card" role="alertdialog" aria-modal="true"><div class="rpa-head"><small>' + (admin ? 'REPORTES DE PLANTA' : 'REPORTE DE PLANTA') + '</small>' +
      '<h3>' + (data.title || '⚠ ' + (admin ? n + (n === 1 ? ' REPORTE ESPERA TU ATENCIÓN' : ' REPORTES ESPERAN TU ATENCIÓN') : n + (n === 1 ? ' REPORTE POR FIRMAR' : ' REPORTES POR FIRMAR'))) + '</h3>' +
      '<p>' + (data.sub || (admin ? 'Hay reportes sin firma del operario o sin decisión de gerencia.' : 'Léelo, escribe tu versión de lo ocurrido y pulsa Firmar.')) + '</p></div>' +
      '<div class="rpa-list">' + data.items.map(i => '<div class="rpa-row"><div><b>' + esc(i.numero) + (admin ? ' · ' + esc(i.operarioNombre) : '') + '</b><small>' + fechaCorta(i.fechaHecho) + (i.orden ? ' · ' + esc(i.orden) : '') + '</small><p>' + esc(i.quePaso) + '</p></div><span class="rpa-chip ' + i.estado + '">' + (i.estado === 'pendiente' ? 'Por firmar' : 'Por decidir') + '</span></div>').join('') + '</div>' +
      '<div class="rpa-foot"><button type="button" class="rpa-btn" data-close>Entendido</button><button type="button" class="rpa-btn main" data-go>Ver reportes</button></div></div>';
    document.body.appendChild(ov);
    const close = () => { modal = null; ov.remove(); };
    ov.addEventListener('click', e => {
      if (e.target.closest('[data-close]') || e.target === ov) close();
      else if (e.target.closest('[data-go]')) { close(); tab.click(); if (data.items.length === 1) setTimeout(() => openReport(data.items[0].id), 700); }
    });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape' && modal === ov) { close(); document.removeEventListener('keydown', onKey); } });
  }
  const alertCss = document.createElement('style');
  alertCss.textContent = `
  .rpa-overlay{position:fixed;inset:0;z-index:100003;display:grid;place-items:center;padding:20px;background:rgba(4,6,4,.72);backdrop-filter:blur(4px)}
  .rpa-card{width:min(560px,100%);max-height:min(88vh,720px);display:flex;flex-direction:column;border:1px solid rgba(255,138,122,.55);border-radius:22px;background:linear-gradient(180deg,#1b1210,#0d130e 38%);color:#eef2e9;font-family:Arial,sans-serif;box-shadow:0 34px 90px rgba(0,0,0,.65)}
  .rpa-head{padding:22px 24px 8px}.rpa-head small{display:block;font:800 10.5px Arial;letter-spacing:.18em;color:#ff9a8c}.rpa-head h3{margin:6px 0;font-size:21px;line-height:1.2}.rpa-head p{margin:0;font-size:13.5px;line-height:1.5;color:#b9c6b4}
  .rpa-list{display:grid;gap:8px;overflow:auto;padding:12px 24px}
  .rpa-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 14px;border:1px solid #2d3b2f;border-radius:14px;background:#0f1710}
  .rpa-row b{display:block;font-size:14px}.rpa-row small{color:#93a28f;font-size:11.5px}.rpa-row p{margin:4px 0 0;color:#c4cfbf;font-size:12.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .rpa-chip{padding:3px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
  .rpa-chip.pendiente{background:rgba(255,106,90,.18);color:#ff9a8c;border:1px solid rgba(255,106,90,.5)}.rpa-chip.firmado{background:rgba(255,184,107,.16);color:#ffc98a;border:1px solid rgba(255,184,107,.45)}
  .rpa-foot{display:flex;gap:10px;padding:14px 24px 22px;flex-wrap:wrap}
  .rpa-btn{flex:1;min-height:44px;width:auto;border:1.5px solid #d0f44c;border-radius:12px;background:transparent;color:#d0f44c;font:800 12px Arial;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}.rpa-btn.main{background:#d0f44c;color:#10150e}
  @media(max-width:560px){.rpa-overlay{padding:12px}.rpa-head{padding:18px 18px 6px}.rpa-head h3{font-size:18px}.rpa-list{padding:10px 18px}.rpa-row{grid-template-columns:1fr}.rpa-foot{flex-direction:column;padding:12px 18px 18px}.rpa-btn{flex:none;width:100%;min-height:46px}}`;
  document.head.appendChild(alertCss);

  async function badge() {
    if (!tab) return;
    let data;
    try { data = await api('/api/reportes/resumen'); } catch (e) { return; }
    const pendientes = data.pendientes;
    document.querySelectorAll('.rpt-dot,.rpt-avdot').forEach(x => x.remove());
    if (pendientes) {
      const mk = cls => { const dot = document.createElement('span'); dot.className = cls; dot.textContent = pendientes; return dot; };
      tab.querySelector('strong')?.after(mk('rpt-dot'));
      document.getElementById('open-reportes')?.append(mk('rpt-dot'));
      document.querySelector('.user-menu summary')?.append(mk('rpt-avdot'));
    }
    // aviso al coordinador: operarios que firmaron desde la última vez que se le avisó
    let avisados = [];
    try { avisados = JSON.parse(localStorage.getItem('rpt_avisados') || '[]'); } catch (e) { /* sin almacenamiento */ }
    if (data.admin) {
      const nuevos = data.items.filter(i => i.estado === 'firmado' && !avisados.includes(i.id));
      if (nuevos.length) {
        try { localStorage.setItem('rpt_avisados', JSON.stringify(avisados.concat(nuevos.map(i => i.id)).slice(-200))); } catch (e) { /* sin almacenamiento */ }
        const title = '✍ ' + nuevos.length + (nuevos.length === 1 ? ' REPORTE FIRMADO' : ' REPORTES FIRMADOS');
        try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body: nuevos.map(i => i.numero + ' · ' + i.operarioNombre).join('\n') }); } catch (e) { /* sin permiso */ }
        alertModal({ ...data, items: nuevos, title, sub: 'El operario ya firmó. Revisa su versión y registra tu decisión.' });
        try { localStorage.setItem('rpt_sesion', data.sesion); } catch (e) { /* sin almacenamiento */ }
        if (panel && panel.classList.contains('active')) load(true);
        return;
      }
    }
    // un aviso por cada inicio de sesión
    let seen = null;
    try { seen = localStorage.getItem('rpt_sesion'); } catch (e) { /* sin almacenamiento */ }
    if (pendientes && seen !== data.sesion) {
      try { localStorage.setItem('rpt_sesion', data.sesion); } catch (e) { /* sin almacenamiento */ }
      alertModal(data);
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
      else if (e.target.closest('[data-firmas]')) signaturesDialog();
      else if (e.target.closest('[data-notif]')) Notification.requestPermission().then(() => render());
      else if (e.target.closest('[data-refresh]')) load(true);
    });
    return true;
  }
  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return !!document.getElementById('open-reportes');
    if (document.getElementById('open-reportes')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-reportes'; button.textContent = 'Reportes';
    const notes = document.getElementById('open-personal-notes');
    notes ? notes.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    return true;
  }
  let tries = 0;
  const wait = setInterval(() => { if ((build() && addMenuItem()) || ++tries > 60) { clearInterval(wait); if (tab) badge(); } }, 250);
  setInterval(() => { if (!document.hidden && tab) { if (panel.classList.contains('active') && !document.querySelector('dialog.rpt-dlg')) load(true); else badge(); } }, 30000);
})();
