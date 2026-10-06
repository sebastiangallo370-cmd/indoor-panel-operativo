(() => {
  // PROMEDIOS MAESTROS: consumo promedio de tela por maestro y talla (mismos formularios del sistema de promedios de la red).
  if (window.__promediosListo) return;
  window.__promediosListo = true;
  const GRUPOS = [
    ['nino', 'NIÑO · TALLA 2 A 16', 'nino'], ['nina', 'NIÑA · TALLA 2 A 16', 'nino'],
    ['masc', 'MASCULINO · XS A 4XL', 'adulto'], ['fem', 'FEMENINO · XS A 4XL', 'adulto']];
  const NOMBRE_NOTA = { NOTA: 'NOTA (aviso)', OMITIR_MANUAL: 'OMITIR MANUAL', SIN_FUSIONADO: 'SIN FUSIONADO', SIN_SUBCARPETAS: 'SIN SUBCARPETAS' };
  const st = { datos: null, buscar: '', editando: null, puedeEditar: false, abierto: {}, mensaje: '' };
  let panel, tab;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => Number(v || 0).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function api(url, options) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No fue posible completar la acción');
    return d;
  }

  const css = document.createElement('style');
  css.textContent = `
  .pm{display:grid;gap:16px;width:100%;max-width:1280px;margin:0 auto}
  .pm *{box-sizing:border-box}
  .pm-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:20px 22px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(135deg,#101a16,#0c110d)}
  .pm-head small{color:#7da4ff;letter-spacing:.14em;font-weight:800;font-size:.68rem}.pm-head h2{margin:4px 0 4px;font-size:1.6rem}.pm-head p{margin:0;color:#aebba7;font-size:.88rem}
  .pm-head input{min-height:44px;min-width:260px;padding:0 14px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:inherit;font-size:.95rem}
  .pm-form{display:grid;gap:18px;padding:20px 22px;border:1px solid #34432f;border-radius:16px;background:#0c110d}
  .pm-form h3{margin:0;font-size:.8rem;letter-spacing:.14em;color:#d7ff3a}
  .pm-fila{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
  .pm label{display:grid;gap:6px;font-size:.66rem;letter-spacing:.1em;color:#9fb09a;font-weight:800;text-transform:uppercase}
  .pm input,.pm select{min-height:42px;padding:0 12px;border:1px solid #2c3a2a;border-radius:10px;background:#101710;color:inherit;font-size:.92rem;width:100%}
  .pm-grupo{display:grid;gap:8px}.pm-grupo>b{font-size:.66rem;letter-spacing:.12em;color:#aebba7}
  .pm-tallas{display:grid;gap:8px;grid-template-columns:repeat(8,minmax(0,1fr))}
  .pm-tallas label{text-align:center;font-size:.62rem}.pm-tallas input{text-align:center;padding:0 4px;border-radius:999px}
  .pm-acciones{display:flex;gap:10px;flex-wrap:wrap}
  .pm-btn{min-height:44px;padding:0 20px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:inherit;font-weight:800;cursor:pointer;letter-spacing:.06em;width:auto!important}
  .pm-btn.pri{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}.pm-btn.pel{border-color:#7b3434;color:#ff9a9d}.pm-btn:disabled{opacity:.5;cursor:default}
  .pm-msg{min-height:1.2em;font-size:.85rem;color:#aebba7}.pm-msg.err{color:#ff9a9d}.pm-msg.ok{color:#8bd450}
  .pm-lista{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))}
  .pm-card{display:grid;gap:12px;padding:18px;border:1px solid #34432f;border-radius:16px;background:#0c110d;align-content:start}
  .pm-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .pm-card small{font-size:.62rem;letter-spacing:.14em;color:#9fb09a;font-weight:800}.pm-card h4{margin:2px 0 0;font-size:1.7rem;letter-spacing:.02em}
  .pm-badge{display:inline-grid;place-items:center;min-width:34px;height:34px;padding:0 10px;border-radius:999px;background:#1a2640;color:#9db8ff;font-weight:800;font-size:.72rem}
  .pm-ico{width:36px!important;height:36px;min-height:36px!important;padding:0!important;border-radius:50%;border:1px solid #34432f;background:#17211a;color:inherit;cursor:pointer;display:grid;place-items:center;font-size:.95rem}
  .pm-prom{display:grid;gap:4px;padding:14px;border-radius:12px;background:#111a14}
  .pm-prom b{font-size:1.5rem;color:#fff}.pm-prom em{font-style:normal;color:#d7ff3a}
  .pm-prom summary{cursor:pointer;color:#9db8ff;font-size:.78rem;margin-top:4px}
  .pm-chips{display:flex;flex-wrap:wrap;gap:6px}.pm-chip{display:grid;gap:2px;text-align:center;font-size:.58rem;color:#9fb09a}.pm-chip span{display:block;min-width:44px;padding:6px 8px;border-radius:999px;background:#17211a;color:#fff;font-size:.82rem}
  .pm-plant{display:grid;gap:3px;font-size:.78rem;color:#aebba7}.pm-plant b{color:#d7e3d1}
  .pm-notas{display:grid;gap:6px}.pm-nota{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;padding:8px 10px;border-radius:10px;background:#141c15;font-size:.8rem}.pm-nota i{font-style:normal;font-size:.62rem;letter-spacing:.08em;color:#ffcf5c;font-weight:800;display:block}
  .pm-nota button{width:auto!important;min-height:0!important;padding:2px 8px!important;border:0;background:transparent;color:#ff9a9d;cursor:pointer}
  .pm-vacio{padding:34px;text-align:center;color:#aebba7;border:1px dashed #34432f;border-radius:14px}
  body:has(.panel[data-panel='promedios'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important;padding-top:10px!important}
  .tab[data-kind='promedios'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='promedios']){display:none!important}}
  @media(max-width:1000px){.pm-lista{grid-template-columns:1fr}.pm-tallas{grid-template-columns:repeat(4,minmax(0,1fr))}}
  @media(max-width:700px){.pm-head{padding:14px 16px}.pm-head h2{font-size:1.25rem}.pm-head input{width:100%;min-width:0;font-size:16px}.pm-form{padding:14px}.pm input,.pm select{font-size:16px}.pm-card h4{font-size:1.4rem}.pm-btn{flex:1 1 40%}}
  `;
  document.head.appendChild(css);

  function tallasInputs(grupo, titulo, tipo, valores) {
    const tallas = st.datos.tallas[tipo];
    return '<div class="pm-grupo"><b>' + titulo + '</b><div class="pm-tallas">' + tallas.map((t, i) =>
      '<label>' + esc(t) + '<input type="text" inputmode="decimal" data-g="' + grupo + '" data-i="' + i + '" placeholder="0,00" value="' + (valores && valores[i] ? esc(String(valores[i]).replace('.', ',')) : '') + '"></label>').join('') + '</div></div>';
  }

  function formulario() {
    const m = st.editando ? st.datos.maestros.find(x => x.ref === st.editando) : null;
    const t = k => esc(m ? m[k] : '');
    if (!st.puedeEditar) return '';
    return '<form class="pm-form" data-form autocomplete="off">' +
      '<h3>' + (m ? 'EDITANDO MAESTRO ' + esc(m.ref) : 'NUEVA REFERENCIA') + '</h3>' +
      '<div class="pm-fila"><label>Referencia base / maestro<input type="text" name="ref" maxlength="14" placeholder="Ej: BZ03" value="' + t('ref') + '"' + (m ? ' readonly' : '') + ' required></label>' +
      '<label>Diseño<select name="diseno">' + st.datos.disenos.map(d => '<option' + ((m ? m.diseno : 'D6') === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></label></div>' +
      '<div class="pm-grupo"><b>CONSUMO PROMEDIO POR TALLA (MTS)</b></div>' +
      GRUPOS.map(([g, titulo, tipo]) => tallasInputs(g, titulo, tipo, m ? m[g] : null)).join('') +
      '<div class="pm-fila"><label>Plantilla masculino<input name="p_masculino" placeholder="Ej: PLANTILLA_MASCULINO.ai" value="' + t('p_masculino') + '"></label>' +
      '<label>Plantilla femenino<input name="p_femenino" placeholder="Peto (Ej: PE03F.ai)" value="' + t('p_femenino') + '"><input name="p_femenino_short" placeholder="Short (Ej: SHT01F.ai)" value="' + t('p_femenino_short') + '"></label>' +
      '<label>Plantilla niño<input name="p_nino" placeholder="Ej: PLANTILLA_NINO.ai" value="' + t('p_nino') + '"></label>' +
      '<label>Plantilla niña<input name="p_nina" placeholder="Peto (Ej: PLANTILLA_NINA.ai)" value="' + t('p_nina') + '"><input name="p_nina_short" placeholder="Short (Ej: SHT01N.ai)" value="' + t('p_nina_short') + '"></label></div>' +
      '<div class="pm-fila"><label>Complemento adulto<input name="c_adulto" placeholder="Ej: PERILLAS ADULTO.ai" value="' + t('c_adulto') + '"></label>' +
      '<label>Complemento niño<input name="c_nino" placeholder="Ej: PERILLAS DE NIÑO.ai" value="' + t('c_nino') + '"></label></div>' +
      '<div class="pm-fila" style="grid-template-columns:minmax(180px,240px) 1fr"><label>Nota / regla para esta referencia (opcional)<select name="nota_tipo">' + st.datos.tipos_nota.map(x => '<option value="' + x + '">' + esc(NOMBRE_NOTA[x] || x) + '</option>').join('') + '</select></label>' +
      '<label>&nbsp;<input name="nota_texto" maxlength="500" placeholder="Ej: esta referencia se corta a mano, no lleva plotter"></label></div>' +
      '<div class="pm-acciones"><button class="pm-btn pri" type="submit">' + (m ? 'GUARDAR CAMBIOS' : '+ AGREGAR REFERENCIA') + '</button>' + (m ? '<button class="pm-btn" type="button" data-cancelar>CANCELAR</button>' : '') + '</div>' +
      '<div class="pm-msg' + (st.mensaje.startsWith('✓') ? ' ok' : st.mensaje ? ' err' : '') + '" data-msg>' + esc(st.mensaje) + '</div></form>';
  }

  function tarjeta(m) {
    const notas = st.datos.notas.filter(n => n.ref === m.ref);
    const grupos = GRUPOS.map(([g, titulo, tipo]) => {
      const tallas = st.datos.tallas[tipo];
      if (!(m[g] || []).some(v => v)) return '';
      return '<div class="pm-grupo"><b>' + titulo + '</b><div class="pm-chips">' + tallas.map((t, i) => '<div class="pm-chip">' + esc(t) + '<span>' + (m[g][i] ? num(m[g][i]) : '—') + '</span></div>').join('') + '</div></div>';
    }).join('');
    const plantillas = [['Masculino', m.p_masculino], ['Femenino', [m.p_femenino, m.p_femenino_short].filter(Boolean).join(' + ')], ['Niño', m.p_nino], ['Niña', [m.p_nina, m.p_nina_short].filter(Boolean).join(' + ')],
      ['Complemento adulto', m.c_adulto], ['Complemento niño', m.c_nino]].filter(x => x[1]).map(x => '<div><b>' + x[0] + ':</b> ' + esc(x[1]) + '</div>').join('');
    return '<article class="pm-card" data-ref="' + esc(m.ref) + '"><div class="pm-card-top"><div><small>ID MAESTRO</small><h4>' + esc(m.ref) + '</h4></div><div style="display:flex;gap:8px;align-items:center"><span class="pm-badge">' + esc(m.diseno) + '</span>' +
      (st.puedeEditar ? '<button class="pm-ico" type="button" data-editar="' + esc(m.ref) + '" title="Editar" aria-label="Editar ' + esc(m.ref) + '">✎</button><button class="pm-ico" type="button" data-borrar="' + esc(m.ref) + '" title="Eliminar" aria-label="Eliminar ' + esc(m.ref) + '">🗑</button>' : '') + '</div></div>' +
      '<details class="pm-prom"' + (st.abierto[m.ref] ? ' open' : '') + ' data-det="' + esc(m.ref) + '"><summary>CONSUMO PROMEDIO · <em>' + num(m.promedio) + ' MTS</em> · ver consumo por talla</summary>' + grupos + '</details>' +
      (plantillas ? '<div class="pm-plant">' + plantillas + '</div>' : '') +
      (notas.length ? '<div class="pm-notas">' + notas.map(n => '<div class="pm-nota"><div><i>' + esc(NOMBRE_NOTA[n.tipo] || n.tipo) + '</i>' + esc(n.texto) + '</div>' + (st.puedeEditar ? '<button type="button" data-nota-borrar="' + esc(n.id) + '" title="Quitar nota">✕</button>' : '') + '</div>').join('') + '</div>' : '') + '</article>';
  }

  function pintar(conservarForm) {
    if (!st.datos) return;
    const q = plano(st.buscar).trim();
    const lista = st.datos.maestros.filter(m => !q || plano(m.ref + ' ' + m.diseno + ' ' + m.p_masculino + ' ' + m.p_femenino + ' ' + m.p_nino + ' ' + m.p_nina).includes(q));
    const host = panel.querySelector('.pm');
    const formViejo = conservarForm ? host.querySelector('[data-form]') : null;
    host.innerHTML = '<div class="pm-head"><div><small>EDICIÓN · INTELIGENCIA</small><h2>PROMEDIOS MAESTROS</h2><p>Consumo promedio de tela por maestro y talla. ' + st.datos.maestros.length + ' maestros registrados.</p></div><input type="search" data-buscar placeholder="Buscar referencia..." value="' + esc(st.buscar) + '"></div>' +
      '<div data-form-lugar></div><section class="pm-lista">' + (lista.map(tarjeta).join('') || '<div class="pm-vacio" style="grid-column:1/-1">Ninguna referencia coincide con la búsqueda.</div>') + '</section>';
    const destino = host.querySelector('[data-form-lugar]');
    if (formViejo) destino.appendChild(formViejo); else destino.innerHTML = formulario();
    const caja = host.querySelector('[data-buscar]');
    if (document.activeElement === document.body && st.buscar) { caja.focus(); caja.setSelectionRange(st.buscar.length, st.buscar.length); }
  }

  async function cargar() {
    const host = panel.querySelector('.pm');
    if (!st.datos) host.innerHTML = '<div class="pm-vacio">Cargando promedios…</div>';
    try { st.datos = await api('/api/promedios'); pintar(false); } catch (e) { host.innerHTML = '<div class="pm-vacio">' + esc(e.message) + '</div>'; }
  }

  function leerForm(form) {
    const cuerpo = { ref: form.ref.value, diseno: form.diseno.value };
    ['p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short', 'c_adulto', 'c_nino'].forEach(k => { cuerpo[k] = form[k].value; });
    GRUPOS.forEach(([g, , tipo]) => { cuerpo[g] = st.datos.tallas[tipo].map((_, i) => form.querySelector('[data-g="' + g + '"][data-i="' + i + '"]').value.trim().replace(',', '.') || '0'); });
    return cuerpo;
  }

  async function guardar(form) {
    const boton = form.querySelector('[type=submit]');
    boton.disabled = true; st.mensaje = '';
    try {
      const cuerpo = leerForm(form);
      const r = await api('/api/promedios/maestro', { method: 'POST', body: JSON.stringify(cuerpo) });
      if (form.nota_texto.value.trim()) await api('/api/promedios/nota', { method: 'POST', body: JSON.stringify({ ref: cuerpo.ref, tipo: form.nota_tipo.value, texto: form.nota_texto.value }) });
      st.mensaje = '✓ ' + (r.creado ? 'Referencia agregada' : 'Cambios guardados') + ' · promedio ' + num(r.maestro.promedio) + ' MTS';
      st.editando = null; st.datos = await api('/api/promedios'); pintar(false);
    } catch (e) { st.mensaje = e.message; const m = form.querySelector('[data-msg]'); m.textContent = e.message; m.className = 'pm-msg err'; boton.disabled = false; }
  }

  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="produccion"]')?.closest('.nav-group') || document.querySelector('nav.tabs .nav-group:last-child');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="promedios"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'promedios';
    panel.innerHTML = '<div class="pm"></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="promedios" type="button"><span class="nav-icon">PM</span><strong>PROMEDIOS MAESTROS</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar();
    });
    panel.addEventListener('click', async e => {
      const editar = e.target.closest('[data-editar]'), borrar = e.target.closest('[data-borrar]'), nota = e.target.closest('[data-nota-borrar]');
      if (editar) { st.editando = editar.dataset.editar; st.mensaje = ''; pintar(false); panel.querySelector('[data-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (e.target.closest('[data-cancelar]')) { st.editando = null; st.mensaje = ''; pintar(false); }
      else if (borrar) {
        const ref = borrar.dataset.borrar;
        if (!confirm('¿Eliminar el maestro ' + ref + ' y sus consumos? Esta acción no se puede deshacer.')) return;
        try { await api('/api/promedios/maestro/' + encodeURIComponent(ref), { method: 'DELETE' }); st.mensaje = '✓ Maestro ' + ref + ' eliminado'; st.datos = await api('/api/promedios'); pintar(false); } catch (err) { alert(err.message); }
      } else if (nota) {
        try { await api('/api/promedios/nota/' + encodeURIComponent(nota.dataset.notaBorrar), { method: 'DELETE' }); st.datos = await api('/api/promedios'); pintar(true); } catch (err) { alert(err.message); }
      }
    });
    panel.addEventListener('toggle', e => { const d = e.target.closest?.('[data-det]'); if (d) st.abierto[d.dataset.det] = d.open; }, true);
    panel.addEventListener('submit', e => { if (e.target.matches('[data-form]')) { e.preventDefault(); guardar(e.target); } });
    panel.addEventListener('input', e => { if (e.target.matches('[data-buscar]')) { st.buscar = e.target.value; pintar(true); const c = panel.querySelector('[data-buscar]'); c.focus(); c.setSelectionRange(st.buscar.length, st.buscar.length); } });
    return true;
  }

  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return !!document.getElementById('open-promedios');
    if (document.getElementById('open-promedios')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-promedios'; button.textContent = 'Promedios maestros';
    const anterior = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    anterior ? anterior.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    return true;
  }

  // Solo quien tiene permiso «Promedios maestros» (Administración/Coordinador y Edición, ver PERMISOS).
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    const p = (mi && mi.permisos && mi.permisos.promedios) || {};
    if (!p.ver) return;
    st.puedeEditar = !!p.editar;
    let tries = 0;
    const wait = setInterval(() => { if ((build() && addMenuItem()) || ++tries > 60) clearInterval(wait); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();
