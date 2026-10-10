// Términos y condiciones del panel: todos los usuarios los aceptan al entrar (y de nuevo cuando cambian).
// También se pueden volver a leer desde el menú de la cuenta; Administración y la cuenta «Indoor Sport» editan el texto y ven quién aceptó.
(() => {
  if (window.__terminos) return; window.__terminos = true;
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (u, o) => { const r = await fetch(u, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, o)); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'No se pudo completar la acción'); return j; };
  const st = { d: null, modo: 'leer', lista: null, error: '' };
  let overlay = null;

  const css = document.createElement('style');
  css.textContent = `
  .tc-overlay{position:fixed;inset:0;z-index:100050;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,6,4,.82);backdrop-filter:blur(6px)}
  .tc-card{width:min(760px,100%);max-height:min(90vh,860px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:radial-gradient(120% 70% at 0% 0%,rgba(208,244,76,.08),transparent 55%),#0a0e09;color:#eef2e9;font-family:Inter,Arial,sans-serif;box-shadow:0 40px 90px rgba(0,0,0,.65)}
  .tc-head{flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid rgba(255,255,255,.08)}
  .tc-logo{flex:0 0 auto;width:92px;height:24px;background:#d0f44c;-webkit-mask:url(/marca-indoor.svg) left center/contain no-repeat;mask:url(/marca-indoor.svg) left center/contain no-repeat}
  .tc-head b{padding-left:14px;border-left:1px solid rgba(255,255,255,.18);font:800 11px Arial;letter-spacing:.2em;color:#cfd9c7}
  .tc-head small{margin-left:auto;color:#7f8b78;font:600 10.5px Arial;white-space:nowrap}
  .tc-x{width:34px!important;height:34px!important;min-height:0!important;padding:0!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:50%!important;background:transparent!important;color:#fff!important;font:300 22px/1 Arial!important;cursor:pointer}
  .tc-body{flex:1;min-height:0;overflow-y:auto;padding:18px 24px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
  .tc-texto{white-space:pre-wrap;overflow-wrap:anywhere;color:#dfe7d6;font:400 13.5px/1.65 Arial}
  .tc-body textarea{width:100%!important;box-sizing:border-box!important;min-height:46vh;margin:0!important;padding:12px 14px!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:12px!important;background:#10160f!important;color:#f2f6ee!important;font:400 13.5px/1.6 Arial!important;outline:none;resize:vertical;color-scheme:dark}
  .tc-body textarea:focus{border-color:#d0f44c!important}
  .tc-nota{margin:0 0 10px;color:#9aa693;font:500 11.5px/1.5 Arial}
  .tc-lista{display:grid;gap:6px;margin:0;padding:0;list-style:none}
  .tc-lista li{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.03);font:700 12.5px Arial}
  .tc-lista small{color:#8e9a87;font:600 11px Arial;text-align:right}.tc-lista .ok small{color:#b9e86a}.tc-lista .no small{color:#ffb3a8}
  .tc-foot{flex:0 0 auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 22px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.2)}
  .tc-acepto{flex:1 1 220px;display:flex;gap:9px;align-items:center;color:#e6ede0;font:700 12.5px Arial;cursor:pointer}
  .tc-acepto input{width:18px;height:18px;accent-color:#d0f44c;flex:0 0 auto}
  .tc-msg{flex:1 1 160px;color:#8e9a87;font:600 11.5px Arial}.tc-msg.err{color:#ff9d94}
  .tc-btn{display:inline-flex!important;align-items:center;justify-content:center;width:auto!important;min-height:0!important;margin:0!important;padding:10px 17px!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:999px!important;background:transparent!important;box-shadow:none!important;color:#e6ede0!important;font:800 11px Arial!important;letter-spacing:.12em;text-transform:uppercase;text-decoration:none!important;cursor:pointer;white-space:nowrap}
  .tc-btn.pri{background:#d0f44c!important;border-color:#d0f44c!important;color:#111!important}
  .tc-btn:disabled{opacity:.4;cursor:default}
  @media(max-width:700px){.tc-overlay{padding:0;align-items:flex-end}.tc-card{max-height:94vh;border-radius:22px 22px 0 0}.tc-head{padding:14px 16px}.tc-head small{display:none}.tc-body{padding:16px}.tc-foot{padding:12px 16px}.tc-foot .tc-btn{flex:1}.tc-acepto{flex:1 1 100%}}
  `;
  document.head.appendChild(css);

  function pintar() {
    const d = st.d, pendiente = d.publicado && !d.aceptado, card = overlay.querySelector('.tc-card');
    let cuerpo, pie;
    if (st.modo === 'editar') {
      cuerpo = '<p class="tc-nota">' + (d.publicado ? 'Al guardar un texto distinto, todos los usuarios tendrán que aceptarlo de nuevo la próxima vez que entren.' : 'Es un borrador: puedes corregirlo las veces que quieras. Nadie más lo ve hasta que lo publiques.') + '</p><textarea data-tc-texto maxlength="40000">' + esc(d.texto) + '</textarea>';
      pie = '<span class="tc-msg' + (st.error ? ' err' : '') + '">' + esc(st.error) + '</span><button type="button" class="tc-btn" data-tc-modo="leer">Cancelar</button><button type="button" class="tc-btn pri" data-tc-guardar>Guardar cambios</button>';
    } else if (st.modo === 'lista') {
      const l = st.lista;
      cuerpo = !l ? '<p class="tc-nota">Cargando…</p>' : '<p class="tc-nota">Versión ' + l.version + ' · han aceptado ' + l.aceptaron + ' de ' + l.total + ' usuarios.</p><ul class="tc-lista">' +
        l.usuarios.map(u => '<li class="' + (u.aceptado ? 'ok' : 'no') + '"><span>' + esc(u.usuario) + '</span><small>' + (u.aceptado ? '✓ Aceptó · ' + esc(u.fecha) : u.version ? 'Pendiente (aceptó la versión ' + u.version + ')' : 'Pendiente') + '</small></li>').join('') + '</ul>';
      pie = '<span class="tc-msg"></span><button type="button" class="tc-btn" data-tc-modo="leer">Volver</button>';
    } else {
      cuerpo = (d.publicado ? '' : '<p class="tc-nota" style="padding:9px 12px;border:1px dashed rgba(208,244,76,.5);border-radius:10px;color:#d6e2b0"><b>Borrador sin publicar.</b> Solo lo ven quienes administran. Revísalo, corrígelo con «Editar texto» y pulsa «Publicar para todos»: desde ese momento cada usuario deberá aceptarlo al entrar.</p>') + '<div class="tc-texto">' + esc(d.texto) + '</div>';
      pie = pendiente
        ? '<label class="tc-acepto"><input type="checkbox" data-tc-chk> He leído y acepto los términos y condiciones</label><a class="tc-btn" href="/logout">Salir</a><button type="button" class="tc-btn pri" data-tc-aceptar disabled>Aceptar y continuar</button>' + (st.error ? '<span class="tc-msg err">' + esc(st.error) + '</span>' : '')
        : '<span class="tc-msg">' + (d.aceptado_fecha ? '✓ Los aceptaste el ' + esc(d.aceptado_fecha) : '') + '</span>' + (d.puede_editar ? (d.publicado ? '<button type="button" class="tc-btn" data-tc-modo="lista">Quién aceptó</button>' : '') + '<button type="button" class="tc-btn" data-tc-modo="editar">Editar texto</button>' : '') + (d.puede_editar && !d.publicado ? '<button type="button" class="tc-btn" data-tc-cerrar>Cerrar</button><button type="button" class="tc-btn pri" data-tc-publicar>Publicar para todos</button>' : '<button type="button" class="tc-btn pri" data-tc-cerrar>Cerrar</button>');
    }
    card.innerHTML = '<div class="tc-head"><span class="tc-logo" role="img" aria-label="Indoor"></span><b>TÉRMINOS Y CONDICIONES</b><small>Versión ' + d.version + (d.actualizado ? ' · ' + esc(d.actualizado) : '') + '</small>' + (pendiente ? '' : '<button type="button" class="tc-x" data-tc-cerrar aria-label="Cerrar">×</button>') + '</div><div class="tc-body">' + cuerpo + '</div><div class="tc-foot">' + pie + '</div>';
  }

  function cerrar() { if (overlay) overlay.remove(); overlay = null; }

  function abrir() {
    if (!st.d) return;
    if (!overlay) {
      overlay = document.createElement('div'); overlay.className = 'tc-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = '<div class="tc-card"></div>';
      overlay.addEventListener('change', e => { if (e.target.matches('[data-tc-chk]')) overlay.querySelector('[data-tc-aceptar]').disabled = !e.target.checked; });
      overlay.addEventListener('click', async e => {
        const modo = e.target.closest('[data-tc-modo]');
        if (e.target.closest('[data-tc-cerrar]') || (e.target === overlay && (st.d.aceptado || !st.d.publicado) && st.modo === 'leer')) { cerrar(); return; }
        if (e.target.closest('[data-tc-publicar]')) {
          if (!confirm('Al publicar, TODOS los usuarios (tú también) deberán aceptar estos términos la próxima vez que entren al panel. ¿Publicar?')) return;
          try { st.d = await api('/api/terminos/publicar', { method: 'POST' }); st.error = ''; } catch (er) { st.error = er.message; }
          if (overlay) pintar();
          return;
        }
        if (modo) {
          st.modo = modo.dataset.tcModo; st.error = ''; pintar();
          if (st.modo === 'lista') { st.lista = null; pintar(); try { st.lista = await api('/api/terminos/aceptaciones'); } catch (er) { st.lista = { version: st.d.version, usuarios: [], aceptaron: 0, total: 0 }; } if (overlay) pintar(); }
          return;
        }
        if (e.target.closest('[data-tc-aceptar]')) {
          e.target.closest('[data-tc-aceptar]').disabled = true;
          try { st.d = await api('/api/terminos/aceptar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: st.d.version }) }); st.error = ''; cerrar(); }
          catch (er) { st.error = er.message; try { st.d = await api('/api/terminos'); } catch (e2) { /* se conserva lo que había */ } if (overlay) pintar(); }
          return;
        }
        if (e.target.closest('[data-tc-guardar]')) {
          const b = e.target.closest('[data-tc-guardar]'), texto = overlay.querySelector('[data-tc-texto]').value;
          if (st.d.publicado && texto.trim() !== st.d.texto.trim() && !confirm('Vas a cambiar los términos: todos los usuarios deberán aceptarlos de nuevo. ¿Guardar?')) return;
          b.disabled = true;
          try { st.d = await api('/api/terminos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) }); st.modo = 'leer'; st.error = ''; }
          catch (er) { st.error = er.message; }
          if (overlay) pintar();
        }
      });
      document.body.appendChild(overlay);
    }
    st.modo = 'leer'; st.error = ''; pintar();
  }
  window.abrirTerminos = abrir;

  // opción en el menú de la cuenta
  function menu() {
    const m = document.querySelector('.user-dropdown');
    if (!m || m.querySelector('.tc-menu-item')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'li-menu-item tc-menu-item'; b.textContent = 'Términos y condiciones';
    b.addEventListener('click', abrir);
    const salir = m.querySelector(':scope > a[href="/logout"]') || m.querySelector('a[href="/logout"]');
    (salir && salir.parentNode ? salir.parentNode : m).insertBefore(b, salir || null);
  }

  async function iniciar() {
    try { st.d = await api('/api/terminos'); } catch (e) { return; }   // sin sesión o sin servidor: no se molesta
    if (st.d.publicado || st.d.puede_editar) { menu(); setTimeout(menu, 1500); }
    if (st.d.publicado && !st.d.aceptado) abrir();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
