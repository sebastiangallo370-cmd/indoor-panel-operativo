(() => {
  // CREAR CLIENTE (COMERCIALES): se suben fotos / PDFs / texto con los datos del cliente, el panel los lee, el comercial revisa y se crea en Effi.
  if (window.__crearClienteListo) return;
  window.__crearClienteListo = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style');
  css.textContent = `
  .cc{width:100%;max-width:980px;margin:18px auto;display:grid;gap:16px}
  .cc-card{padding:22px;border:1px solid rgba(255,255,255,.14);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28));backdrop-filter:blur(14px)}
  .cc-card .eyebrow{color:#d0f44c;font:800 11px Arial;letter-spacing:.16em}
  .cc-card h2{margin:6px 0 4px;font:900 clamp(22px,3vw,28px) Arial;color:#f5faef}
  .cc-card p{margin:0 0 14px;color:#a9b5a3;font:500 14px/1.5 Arial}
  .cc-drop{display:grid;place-items:center;gap:6px;min-height:130px;padding:18px;border:2px dashed rgba(208,244,76,.4);border-radius:16px;text-align:center;color:#c9d3c1;font:700 14px/1.4 Arial;cursor:pointer;transition:background .2s,border-color .2s}
  .cc-drop.sobre,.cc-drop:hover{background:rgba(208,244,76,.07);border-color:#d0f44c}
  .cc-drop small{color:#8f9d88;font-weight:500}
  .cc-archivos{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .cc-archivos span{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:99px;background:rgba(255,255,255,.08);font:700 12px Arial;color:#e8f0e0;max-width:100%}
  .cc-archivos button{all:unset;cursor:pointer;color:#ff9b9b;font-weight:900}
  .cc textarea,.cc input,.cc select{width:100%;box-sizing:border-box;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 16px Arial;outline:none}
  .cc textarea{min-height:90px;padding:12px 14px;margin-top:12px;resize:vertical}
  .cc input,.cc select{min-height:46px;padding:0 12px}
  .cc textarea:focus,.cc input:focus,.cc select:focus{border-color:#d0f44c}
  .cc label{display:grid;gap:5px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.1em}
  .cc-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))}
  .cc-ancho{grid-column:1/-1}
  .cc-btn{min-height:50px;padding:0 22px;border:0;border-radius:12px;background:#d0f44c;color:#142017;font:900 14px Arial;letter-spacing:.06em;cursor:pointer}
  .cc-btn.sec{background:rgba(255,255,255,.1);color:#f5faef}
  .cc-btn:disabled{opacity:.55;cursor:progress}
  .cc-fila{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .cc-msg{min-height:20px;margin-top:10px;font:700 13.5px/1.45 Arial}.cc-msg.err{color:#ff8f8f}.cc-msg.ok{color:#bff26a}
  .cc-leido{margin-top:12px;color:#8f9d88;font:12px/1.5 Consolas,monospace;white-space:pre-wrap;max-height:150px;overflow:auto}
  .cc-listo{padding:18px;border:1px solid #d0f44c;border-radius:16px;background:rgba(208,244,76,.08);font:700 15px/1.5 Arial;color:#f5faef}
  .cc-faltan input.falta,.cc-faltan select.falta{border-color:#ffb43d}
  @media(max-width:700px){.cc{margin:10px auto 110px}.cc-card{padding:16px}.cc-btn{width:100%}}
  `;
  document.head.appendChild(css);

  let panel = null, archivos = [], ciudadSel = null, ocupado = false, timerCiudad = 0;
  const q = s => panel.querySelector(s);

  function pintarArchivos() {
    q('[data-archivos]').innerHTML = archivos.map((f, i) => `<span>${esc(f.name || 'imagen')}<button type="button" data-quitar="${i}" aria-label="Quitar">✕</button></span>`).join('');
  }
  function agregar(lista) {
    [...lista].forEach(f => { if (f && archivos.length < 8) archivos.push(f); });
    pintarArchivos();
  }
  function mensaje(sel, texto, tipo) { const m = q(sel); m.textContent = texto || ''; m.className = 'cc-msg ' + (tipo || ''); }

  function campo(nombre) { return q('[name="' + nombre + '"]'); }
  function llenar(c) {
    ['t_dni', 'numero', 'nombre', 'email', 'celular', 'telefono1', 'direccion'].forEach(k => { if (c[k] != null && c[k] !== '') campo(k).value = c[k]; });
    campo('t_persona').value = String(c.t_persona || (c.t_dni === 1 ? 2 : 1));
    if (c.id_ciudad) {
      ciudadSel = { id: c.id_ciudad, id_provincia: c.id_provincia, nombre: c.ciudad, provincia: c.provincia };
      campo('ciudad').value = `${c.ciudad} (${c.provincia})`;
    } else if (c.ciudad_texto) { campo('ciudad').value = c.ciudad_texto; ciudadSel = null; }
    marcarFaltantes();
  }
  function marcarFaltantes() {
    ['numero', 'nombre'].forEach(k => campo(k).classList.toggle('falta', !campo(k).value.trim()));
  }

  async function leer() {
    if (ocupado) return;
    const texto = q('[data-texto]').value.trim();
    if (!archivos.length && !texto) { mensaje('[data-msg-leer]', 'Sube una foto o PDF, o pega el texto con los datos del cliente.', 'err'); return; }
    ocupado = true; q('[data-leer]').disabled = true; mensaje('[data-msg-leer]', 'Leyendo los datos…');
    try {
      const f = new FormData();
      f.append('texto', texto);
      archivos.forEach(a => f.append('archivos', a, a.name || 'imagen.png'));
      const r = await fetch('/api/cliente-effi/leer', { method: 'POST', body: f, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No se pudo leer');
      llenar(j.campos || {});
      q('[data-leido]').textContent = j.texto || '';
      q('[data-form]').hidden = false;
      mensaje('[data-msg-leer]', (j.avisos || []).join(' ') || 'Listo: revisa los datos de abajo y corrige lo que haga falta.', (j.avisos || []).length ? 'err' : 'ok');
      q('[data-form]').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { mensaje('[data-msg-leer]', e.message, 'err'); }
    ocupado = false; q('[data-leer]').disabled = false;
  }

  async function buscarCiudad() {
    const v = campo('ciudad').value.trim();
    if (ciudadSel && v === `${ciudadSel.nombre} (${ciudadSel.provincia})`) return;
    ciudadSel = null;
    const lista = q('#cc-ciudades');
    if (v.length < 3) { lista.innerHTML = ''; return; }
    try {
      const r = await fetch('/api/cliente-effi/ciudades?q=' + encodeURIComponent(v), { credentials: 'same-origin' });
      const j = await r.json();
      lista.innerHTML = (j.ciudades || []).map(c => `<option value="${esc(c.nombre)} (${esc(c.provincia)})" data-id="${c.id}" data-prov="${c.id_provincia}"></option>`).join('');
      const exacta = (j.ciudades || []).find(c => `${c.nombre} (${c.provincia})` === v);
      if (exacta) ciudadSel = { id: exacta.id, id_provincia: exacta.id_provincia, nombre: exacta.nombre, provincia: exacta.provincia };
    } catch (e) { /* sin lista: se puede seguir sin ciudad */ }
  }

  async function crear() {
    if (ocupado) return;
    marcarFaltantes();
    const body = {};
    ['t_dni', 'numero', 'nombre', 't_persona', 'email', 'celular', 'telefono1', 'direccion', 'referencia'].forEach(k => { body[k] = campo(k).value.trim(); });
    if (ciudadSel) { body.id_ciudad = ciudadSel.id; body.id_provincia = ciudadSel.id_provincia; }
    else if (campo('ciudad').value.trim()) { mensaje('[data-msg-crear]', 'Elige la ciudad de la lista que se despliega al escribir.', 'err'); return; }
    if (!body.numero || !body.nombre) { mensaje('[data-msg-crear]', 'Faltan el número de identificación y el nombre.', 'err'); return; }
    ocupado = true; q('[data-crear]').disabled = true; mensaje('[data-msg-crear]', 'Creando el cliente en Effi…');
    try {
      const r = await fetch('/api/cliente-effi/crear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Effi no creó el cliente');
      q('[data-form]').hidden = true;
      q('[data-ok]').hidden = false;
      q('[data-ok]').innerHTML = `✔ Cliente creado en Effi<br><b>${esc(j.nombre)}</b> · ${esc(j.documento)}<br><small style="color:#a9b5a3">Código interno ${esc(j.tercero)}. Ya puedes usarlo en la orden de venta.</small>`;
      mensaje('[data-msg-crear]', '');
    } catch (e) { mensaje('[data-msg-crear]', e.message, 'err'); }
    ocupado = false; q('[data-crear]').disabled = false;
  }

  function nuevo() {
    archivos = []; ciudadSel = null; pintarArchivos();
    panel.querySelectorAll('input,textarea').forEach(i => { i.value = ''; });
    campo('t_dni').value = '2'; campo('t_persona').value = '1';
    q('[data-form]').hidden = true; q('[data-ok]').hidden = true; mensaje('[data-msg-leer]', ''); mensaje('[data-msg-crear]', '');
  }

  function build() {
    panel = document.querySelector('.panel[data-panel="cliente-effi"]');
    if (!panel) return false;
    if (panel.dataset.listo) return true;
    panel.dataset.listo = '1';
    panel.innerHTML = `<div class="cc cc-faltan">
      <div class="cc-card"><span class="eyebrow">COMERCIALES</span><h2>CREAR CLIENTE</h2>
        <p>Sube una foto, un PDF (RUT, cédula, cámara de comercio, chat…) o pega el texto con los datos. El panel los lee, tú revisas y se crea en Effi.</p>
        <div class="cc-drop" data-drop tabindex="0"><b>Toca para subir fotos o PDFs</b><span>o arrástralos aquí · también puedes pegar una imagen con Ctrl+V</span><small>JPG, PNG, PDF · hasta 8 archivos</small></div>
        <input type="file" data-file accept="image/*,application/pdf,.txt" multiple hidden>
        <div class="cc-archivos" data-archivos></div>
        <textarea data-texto placeholder="O pega aquí el texto: nombre, cédula o NIT, teléfono, correo, dirección y ciudad…"></textarea>
        <div class="cc-fila"><button class="cc-btn" type="button" data-leer>LEER DATOS</button></div>
        <div class="cc-msg" data-msg-leer></div>
      </div>
      <div class="cc-card" data-form hidden><span class="eyebrow">REVISA Y CONFIRMA</span><h2>Datos del cliente</h2><p>Corrige lo que el panel no leyó bien. Los marcados en naranja son obligatorios.</p>
        <div class="cc-grid">
          <label>TIPO DE IDENTIFICACIÓN<select name="t_dni"><option value="2">Cédula de ciudadanía</option><option value="1">NIT</option><option value="4">Cédula de extranjería</option><option value="3">Pasaporte</option></select></label>
          <label>NÚMERO (SIN DÍGITO DE VERIFICACIÓN)<input name="numero" inputmode="numeric" autocomplete="off"></label>
          <label class="cc-ancho">NOMBRE O RAZÓN SOCIAL<input name="nombre" autocomplete="off" maxlength="120"></label>
          <label>TIPO DE PERSONA<select name="t_persona"><option value="1">Natural</option><option value="2">Jurídica</option></select></label>
          <label>CORREO<input name="email" type="email" autocomplete="off"></label>
          <label>CELULAR / WHATSAPP<input name="celular" inputmode="tel" autocomplete="off"></label>
          <label>TELÉFONO FIJO<input name="telefono1" inputmode="tel" autocomplete="off"></label>
          <label class="cc-ancho">DIRECCIÓN<input name="direccion" autocomplete="off" maxlength="200"></label>
          <label>CIUDAD<input name="ciudad" list="cc-ciudades" autocomplete="off" placeholder="Escribe y elige de la lista"></label>
          <datalist id="cc-ciudades"></datalist>
          <label>REFERENCIA DE LA DIRECCIÓN<input name="referencia" autocomplete="off" maxlength="200" placeholder="Barrio, local, torre…"></label>
        </div>
        <div class="cc-leido" data-leido></div>
        <div class="cc-fila"><button class="cc-btn" type="button" data-crear>CREAR CLIENTE EN EFFI</button><button class="cc-btn sec" type="button" data-nuevo>EMPEZAR DE NUEVO</button></div>
        <div class="cc-msg" data-msg-crear></div>
      </div>
      <div class="cc-listo" data-ok hidden></div>
      <div class="cc-fila" data-otro hidden><button class="cc-btn sec" type="button" data-nuevo>CREAR OTRO CLIENTE</button></div>
    </div>`;
    const drop = q('[data-drop]'), file = q('[data-file]');
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', () => { agregar(file.files); file.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('sobre'); }));
    drop.addEventListener('drop', e => agregar(e.dataTransfer.files));
    panel.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { agregar(fs); e.preventDefault(); } });
    q('[data-archivos]').addEventListener('click', e => { const b = e.target.closest('[data-quitar]'); if (b) { archivos.splice(+b.dataset.quitar, 1); pintarArchivos(); } });
    q('[data-leer]').addEventListener('click', leer);
    q('[data-crear]').addEventListener('click', crear);
    panel.querySelectorAll('[data-nuevo]').forEach(b => b.addEventListener('click', nuevo));
    campo('ciudad').addEventListener('input', () => { clearTimeout(timerCiudad); timerCiudad = setTimeout(buscarCiudad, 350); });
    ['numero', 'nombre'].forEach(k => campo(k).addEventListener('input', marcarFaltantes));
    const verOk = new MutationObserver(() => { q('[data-otro]').hidden = q('[data-ok]').hidden; });
    verOk.observe(q('[data-ok]'), { attributes: true, attributeFilter: ['hidden'] });
    return true;
  }
  let intentos = 0;
  const t = setInterval(() => { if (build() || ++intentos > 40) clearInterval(t); }, 250);
})();
