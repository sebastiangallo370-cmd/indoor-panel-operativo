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
  .cc-sub{display:none;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .cc-sub b{font:800 15px Arial;color:#f5faef}.cc-sub small{color:#a9b5a3;font:600 12.5px Arial}
  .cc-up.plegada .cc-cuerpo{display:none}.cc-up.plegada .cc-sub{display:flex}
  .cc-resumen{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px}
  .cc-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;font:800 11.5px Arial;border:1px solid rgba(255,255,255,.16)}
  .cc-chip.ok{color:#bff26a;border-color:rgba(191,242,106,.5);background:rgba(191,242,106,.08)}
  .cc-chip.falta{color:#ffc46b;border-color:rgba(255,180,61,.6);background:rgba(255,180,61,.1)}
  .cc-grid label.leido input,.cc-grid label.leido select{border-color:rgba(191,242,106,.55);background:#16251a}
  .cc-grid label.leido::after{content:"✓ leído";color:#bff26a;font:800 10px Arial;letter-spacing:.08em}
  .cc-grid label.pendiente input,.cc-grid label.pendiente select{border-color:#ffb43d}
  .cc-grid label.pendiente::after{content:"⚠ completar";color:#ffc46b;font:800 10px Arial;letter-spacing:.08em}
  .cc-det{margin-top:14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 14px}
  .cc-det summary{cursor:pointer;color:#a9b5a3;font:800 12px Arial;letter-spacing:.08em}
  .cc-det .cc-leido{max-height:260px}
  .cc-acciones{position:sticky;bottom:10px;z-index:3;padding:10px;border-radius:16px;background:rgba(11,15,9,.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12)}
  .cc-acciones .cc-fila{margin-top:0}
  @media(max-width:700px){.cc-acciones{position:static;background:none;border:0;padding:0}.cc{margin:10px auto 110px}.cc-card{padding:16px}.cc-btn{width:100%}}
  `;
  document.head.appendChild(css);

  let panel = null, confirmado = false, archivos = [], ciudadSel = null, ocupado = false, timerCiudad = 0;
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
    campo('t_regimen_iva').value = c.t_regimen_iva ? String(c.t_regimen_iva) : '';
    marcarFaltantes();
  }
  const OBLIG = ['numero', 'nombre', 'email', 'direccion', 'ciudad'];
  const ROTULO = { numero: 'Identificación', nombre: 'Nombre', email: 'Correo', celular: 'Celular', telefono1: 'Teléfono', direccion: 'Dirección', ciudad: 'Ciudad' };
  function estados(leidos) {
    Object.keys(ROTULO).forEach(k => {
      const lab = campo(k).closest('label'), lleno = !!campo(k).value.trim();
      lab.classList.toggle('leido', lleno && (!leidos || leidos.has(k)));
      lab.classList.toggle('pendiente', !lleno && OBLIG.includes(k));
    });
    q('[data-chips]').innerHTML = Object.keys(ROTULO).filter(k => OBLIG.includes(k) || campo(k).value.trim()).map(k => {
      const lleno = !!campo(k).value.trim();
      return `<span class="cc-chip ${lleno ? 'ok' : 'falta'}">${lleno ? '✓' : '⚠'} ${ROTULO[k]}${lleno ? '' : ' · falta'}</span>`;
    }).join('');
  }
  function marcarFaltantes() {
    estados(null);
    ['numero', 'nombre', 'email', 'direccion', 'ciudad'].forEach(k => campo(k).classList.toggle('falta', !campo(k).value.trim()));
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
      const ya = j.existentes || [];
      q('[data-ya]').hidden = !ya.length;
      q('[data-ya]').innerHTML = ya.length ? '<b>⚠ Ya hay clientes parecidos en Effi:</b><br>' + ya.map(x => `${esc(x.nombre)} · ${esc(x.documento)} · código ${esc(x.tercero)}${x.mismo_numero ? ' <b>(MISMO NÚMERO)</b>' : ''}`).join('<br>') + '<br><small>Si es el mismo cliente, no lo crees otra vez; úsalo en la orden de venta.</small>' : '';
      q('[data-leido]').textContent = j.texto || '';
      q('[data-form]').hidden = false;
      q('[data-up]').classList.add('plegada');
      q('[data-sub-t]').textContent = 'Datos leídos de ' + (archivos.length ? archivos.length + ' archivo' + (archivos.length > 1 ? 's' : '') : 'tu texto');
      q('[data-sub-s]').textContent = OBLIG.filter(k => !campo(k).value.trim()).length ? 'Faltan datos obligatorios: completa los que salen en naranja.' : 'Revisa los datos y crea el cliente.';
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
    ['t_dni', 'numero', 'nombre', 't_persona', 't_regimen_iva', 'email', 'celular', 'telefono1', 'direccion', 'referencia'].forEach(k => { body[k] = campo(k).value.trim(); });
    if (ciudadSel) { body.id_ciudad = ciudadSel.id; body.id_provincia = ciudadSel.id_provincia; }
    else if (campo('ciudad').value.trim()) { mensaje('[data-msg-crear]', 'Elige la ciudad de la lista que se despliega al escribir.', 'err'); return; }
    const faltan = [['numero', 'el número de identificación'], ['nombre', 'el nombre'], ['email', 'el correo'], ['direccion', 'la dirección'], ['ciudad', 'la ciudad']].filter(([k]) => !campo(k).value.trim()).map(([, t]) => t);
    if (faltan.length) { mensaje('[data-msg-crear]', 'Faltan ' + faltan.join(', ') + '. Effi los exige: pídeselos al cliente.', 'err'); return; }
    if (!confirmado) {
      const tipo = campo('t_dni').selectedOptions[0].textContent;
      q('[data-resumen]').hidden = false;
      q('[data-resumen]').innerHTML = `<b>¿Confirmas crear este cliente en Effi?</b><br>${esc(body.nombre)}<br>${esc(tipo)} ${esc(body.numero)}<br>${esc(body.email)}${body.celular ? ' · ' + esc(body.celular) : ''}<br>${esc(body.direccion)}, ${esc(campo('ciudad').value)}`;
      q('[data-crear]').textContent = 'SÍ, CONFIRMAR Y CREAR';
      confirmado = true; mensaje('[data-msg-crear]', ''); return;
    }
    confirmado = false; q('[data-resumen]').hidden = true; q('[data-crear]').textContent = 'CREAR CLIENTE EN EFFI';
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
    archivos = []; ciudadSel = null; confirmado = false; pintarArchivos();
    q('[data-resumen]').hidden = true; q('[data-ya]').hidden = true; q('[data-crear]').textContent = 'CREAR CLIENTE EN EFFI';
    panel.querySelectorAll('input,textarea').forEach(i => { i.value = ''; });
    campo('t_dni').value = '2'; campo('t_persona').value = '1';
    q('[data-up]').classList.remove('plegada'); q('[data-form]').hidden = true; q('[data-ok]').hidden = true; mensaje('[data-msg-leer]', ''); mensaje('[data-msg-crear]', '');
  }

  function build() {
    panel = document.querySelector('.panel[data-panel="cliente-effi"]');
    if (!panel) return false;
    if (panel.dataset.listo) return true;
    panel.dataset.listo = '1';
    panel.innerHTML = `<div class="cc cc-faltan">
      <div class="cc-card cc-up" data-up><div class="cc-sub"><div><b data-sub-t>Datos leídos</b><br><small data-sub-s></small></div><button class="cc-btn sec" type="button" data-cambiar>CAMBIAR ARCHIVOS</button></div><div class="cc-cuerpo"><span class="eyebrow">COMERCIALES</span><h2>CREAR CLIENTE</h2>
        <p>Sube una foto, un PDF (RUT, cédula, cámara de comercio, chat…) o pega el texto con los datos. El panel los lee, tú revisas y se crea en Effi.</p>
        <div class="cc-drop" data-drop tabindex="0"><b>Toca para subir fotos o PDFs</b><span>o arrástralos aquí · también puedes pegar una imagen con Ctrl+V</span><small>JPG, PNG, PDF · hasta 8 archivos</small></div>
        <input type="file" data-file accept="image/*,application/pdf,.txt" multiple hidden>
        <div class="cc-archivos" data-archivos></div>
        <textarea data-texto placeholder="O pega aquí el texto: nombre, cédula o NIT, teléfono, correo, dirección y ciudad…"></textarea>
        <div class="cc-fila"><button class="cc-btn" type="button" data-leer>LEER DATOS</button></div>
        <div class="cc-msg" data-msg-leer></div>
      </div></div>
      <div class="cc-card" data-form hidden><span class="eyebrow">REVISA Y CONFIRMA</span><h2>Datos del cliente</h2><p>Corrige lo que el panel no leyó bien. Los marcados en naranja (*) son obligatorios en Effi: si falta alguno, pídeselo al cliente; no se inventa.</p>
        <div class="cc-resumen" data-chips></div>
        <div class="cc-grid">
          <label>TIPO DE IDENTIFICACIÓN<select name="t_dni"><option value="2">Cédula de ciudadanía</option><option value="1">NIT</option><option value="4">Cédula de extranjería</option><option value="3">Pasaporte</option></select></label>
          <label>NÚMERO (SIN DÍGITO DE VERIFICACIÓN)<input name="numero" inputmode="numeric" autocomplete="off"></label>
          <label class="cc-ancho">NOMBRE O RAZÓN SOCIAL<input name="nombre" autocomplete="off" maxlength="120"></label>
          <label>TIPO DE PERSONA<select name="t_persona"><option value="1">Natural</option><option value="2">Jurídica</option></select></label>
          <label>RÉGIMEN TRIBUTARIO (OPCIONAL)<select name="t_regimen_iva"><option value="">Sin definir</option><option value="5">Ordinario · No responsable de IVA</option><option value="4">Ordinario · Responsable de IVA</option><option value="3">Régimen simple</option></select></label>
          <label>CORREO *<input name="email" type="email" autocomplete="off"></label>
          <label>CELULAR / WHATSAPP<input name="celular" inputmode="tel" autocomplete="off"></label>
          <label>TELÉFONO FIJO<input name="telefono1" inputmode="tel" autocomplete="off"></label>
          <label class="cc-ancho">DIRECCIÓN *<input name="direccion" autocomplete="off" maxlength="200"></label>
          <label>CIUDAD *<input name="ciudad" list="cc-ciudades" autocomplete="off" placeholder="Escribe y elige de la lista"></label>
          <datalist id="cc-ciudades"></datalist>
          <label>REFERENCIA DE LA DIRECCIÓN<input name="referencia" autocomplete="off" maxlength="200" placeholder="Barrio, local, torre…"></label>
        </div>
        <div class="cc-listo" data-ya hidden style="border-color:#ffb43d;background:rgba(255,180,61,.1);margin-top:12px"></div>
        <details class="cc-det"><summary>VER EL TEXTO QUE SE LEYÓ</summary><div class="cc-leido" data-leido></div></details>
        <div class="cc-acciones"><div class="cc-listo" data-resumen hidden style="margin-bottom:10px"></div>
        <div class="cc-fila"><button class="cc-btn" type="button" data-crear>CREAR CLIENTE EN EFFI</button><button class="cc-btn sec" type="button" data-nuevo>EMPEZAR DE NUEVO</button></div>
        <div class="cc-msg" data-msg-crear></div></div>
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
    q('[data-cambiar]').addEventListener('click', () => { q('[data-up]').classList.remove('plegada'); q('[data-up]').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    q('[data-crear]').addEventListener('click', crear);
    q('[data-form]').addEventListener('input', () => { if (confirmado) { confirmado = false; q('[data-resumen]').hidden = true; q('[data-crear]').textContent = 'CREAR CLIENTE EN EFFI'; } });
    panel.querySelectorAll('[data-nuevo]').forEach(b => b.addEventListener('click', nuevo));
    campo('ciudad').addEventListener('input', () => { clearTimeout(timerCiudad); timerCiudad = setTimeout(buscarCiudad, 350); });
    ['numero', 'nombre', 'email', 'direccion', 'ciudad'].forEach(k => campo(k).addEventListener('input', marcarFaltantes));
    const verOk = new MutationObserver(() => { q('[data-otro]').hidden = q('[data-ok]').hidden; });
    verOk.observe(q('[data-ok]'), { attributes: true, attributeFilter: ['hidden'] });
    return true;
  }
  let intentos = 0;
  const t = setInterval(() => { if (build() || ++intentos > 40) clearInterval(t); }, 250);
})();
