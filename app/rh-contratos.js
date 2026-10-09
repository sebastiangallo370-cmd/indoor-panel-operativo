(() => {
  // R.HUMANO > CONTRATOS: el empleado escribe nombre completo, cédula y cargo y descarga la copia de SU contrato.
  // La validación se hace en el servidor (/api/rhumano/contrato); aquí nunca llega la lista de empleados ni sus cédulas.
  if (window.__rhContratosListo) return;
  window.__rhContratosListo = true;

  const css = document.createElement('style');
  css.textContent = `
  .rhc{max-width:560px;margin:18px auto;padding:26px 24px;border:1px solid rgba(208,244,76,.28);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.25))}
  .rhc .eyebrow{color:#d0f44c;font:800 11px Arial;letter-spacing:.16em}
  .rhc h2{margin:6px 0 6px;font:900 clamp(22px,3vw,28px) Arial;color:#f5faef}
  .rhc p{margin:0 0 16px;color:#a9b5a3;font:500 14px/1.5 Arial}
  .rhc form{display:grid;gap:12px}
  .rhc label{display:grid;gap:5px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.1em}
  .rhc input{width:100%;box-sizing:border-box;min-height:48px;padding:0 14px;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 16px Arial;outline:none}
  .rhc input:focus{border-color:#d0f44c}
  .rhc button{width:100%;min-height:50px;margin-top:4px;border:0;border-radius:12px;background:#d0f44c;color:#142017;font:900 14px Arial;letter-spacing:.06em;cursor:pointer}
  .rhc button:disabled{opacity:.55;cursor:progress}
  .rhc .msg{min-height:20px;margin:2px 0 0;font:700 13.5px/1.45 Arial}
  .rhc .msg.err{color:#ff8f8f}.rhc .msg.ok{color:#bff26a}
  .rhc small{display:block;margin-top:12px;color:#7f8b79;font:500 12px/1.5 Arial}
  `;
  document.head.appendChild(css);

  function montar() {
    const panel = document.querySelector('.panel[data-panel="rh-contratos"]');
    if (!panel) return false;
    if (panel.dataset.listo) return true;
    panel.dataset.listo = '1';
    panel.innerHTML = '<div class="rhc"><span class="eyebrow">R.HUMANO · CONTRATOS</span><h2>Copia de mi contrato</h2>' +
      '<p>Escribe tus datos tal como aparecen en tu contrato de trabajo para descargar tu copia en PDF.</p>' +
      '<form novalidate autocomplete="off">' +
      '<label>NOMBRE COMPLETO<input name="nombre" type="text" maxlength="90" required placeholder="Nombres y apellidos"></label>' +
      '<label>CÉDULA<input name="cedula" type="text" inputmode="numeric" maxlength="14" required placeholder="Solo números"></label>' +
      '<label>CARGO<input name="cargo" type="text" maxlength="80" required placeholder="Tu cargo en la empresa"></label>' +
      '<button type="submit">DESCARGAR MI CONTRATO</button><p class="msg" role="status" aria-live="polite"></p></form>' +
      '<small>Solo puedes descargar tu propio contrato. Si tus datos no coinciden o cambiaste de cargo, acércate a Administración.</small></div>';
    const form = panel.querySelector('form'), msg = panel.querySelector('.msg'), boton = panel.querySelector('button');
    const decir = (texto, clase) => { msg.textContent = texto; msg.className = 'msg' + (clase ? ' ' + clase : ''); };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const datos = { nombre: form.nombre.value.trim(), cedula: form.cedula.value.replace(/\D/g, ''), cargo: form.cargo.value.trim() };
      if (!datos.nombre || !datos.cedula || !datos.cargo) { decir('Completa los tres datos: nombre completo, cédula y cargo.', 'err'); return; }
      boton.disabled = true; decir('Buscando tu contrato…');
      try {
        const r = await fetch('/api/rhumano/contrato', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || 'No fue posible descargar el contrato.'); }
        const blob = await r.blob();
        const nombre = (/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '') || [])[1];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nombre ? decodeURIComponent(nombre) : 'Contrato.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        decir('Listo: tu contrato se descargó.', 'ok');
        form.cedula.value = '';
      } catch (error) { decir(error.message, 'err'); }
      boton.disabled = false;
    });
    return true;
  }
  let n = 0;
  const espera = setInterval(() => { if (montar() || ++n > 80) clearInterval(espera); }, 250);
})();
