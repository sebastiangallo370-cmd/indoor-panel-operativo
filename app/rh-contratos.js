(() => {
  // R.HUMANO: CONTRATOS (copia del contrato) y C.LABORAL (carta laboral generada al momento).
  // En los dos el empleado escribe nombre completo y cédula; la validación se hace en el servidor y aquí nunca llega la lista de empleados ni sus cédulas.
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

  const FORMULARIOS = [
    { panel: 'rh-contratos', api: '/api/rhumano/contrato', rotulo: 'R.HUMANO · CONTRATOS', titulo: 'Copia de mi contrato',
      texto: 'Escribe tus datos tal como aparecen en tu contrato de trabajo para descargar tu copia en PDF.', boton: 'DESCARGAR MI CONTRATO',
      buscando: 'Buscando tu contrato…', listo: 'Listo: tu contrato se descargó.', archivo: 'Contrato.pdf',
      nota: 'Solo puedes descargar tu propio contrato. Si tus datos no coinciden, acércate a Administración.' },
    { panel: 'rh-claboral', api: '/api/rhumano/carta-laboral', rotulo: 'R.HUMANO · C.LABORAL', titulo: 'Mi carta laboral',
      texto: 'Escribe tus datos tal como aparecen en tu contrato de trabajo y el panel genera tu carta laboral en PDF, con la fecha de hoy.', boton: 'GENERAR MI CARTA LABORAL',
      buscando: 'Generando tu carta laboral…', listo: 'Listo: tu carta laboral se descargó.', archivo: 'Carta laboral.pdf',
      nota: 'La carta certifica tu cargo actual y la fecha desde la que trabajas en la empresa. Si necesitas que incluya otro dato (por ejemplo el salario), pídela en Administración.' }
  ];

  function montar(f) {
    const panel = document.querySelector('.panel[data-panel="' + f.panel + '"]');
    if (!panel) return false;
    if (panel.dataset.listo) return true;
    panel.dataset.listo = '1';
    panel.innerHTML = '<div class="rhc"><span class="eyebrow">' + f.rotulo + '</span><h2>' + f.titulo + '</h2><p>' + f.texto + '</p>' +
      '<form novalidate autocomplete="off">' +
      '<label>NOMBRE COMPLETO<input name="nombre" type="text" maxlength="90" required placeholder="Nombres y apellidos"></label>' +
      '<label>CÉDULA<input name="cedula" type="text" inputmode="numeric" maxlength="14" required placeholder="Solo números"></label>' +
      '<button type="submit">' + f.boton + '</button><p class="msg" role="status" aria-live="polite"></p></form><small>' + f.nota + '</small></div>';
    const form = panel.querySelector('form'), msg = panel.querySelector('.msg'), boton = panel.querySelector('button');
    const decir = (texto, clase) => { msg.textContent = texto; msg.className = 'msg' + (clase ? ' ' + clase : ''); };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const datos = { nombre: form.nombre.value.trim(), cedula: form.cedula.value.replace(/\D/g, '') };
      if (!datos.nombre || !datos.cedula) { decir('Completa los dos datos: nombre completo y cédula.', 'err'); return; }
      boton.disabled = true; decir(f.buscando);
      try {
        const r = await fetch(f.api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.detail || 'No fue posible generar el documento.'); }
        const blob = await r.blob();
        const nombre = (/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '') || [])[1];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nombre ? decodeURIComponent(nombre) : f.archivo;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        decir(f.listo, 'ok');
        form.cedula.value = '';
      } catch (error) { decir(error.message, 'err'); }
      boton.disabled = false;
    });
    return true;
  }
  let n = 0;
  const espera = setInterval(() => { if (FORMULARIOS.map(montar).every(Boolean) || ++n > 80) clearInterval(espera); }, 250);
})();
