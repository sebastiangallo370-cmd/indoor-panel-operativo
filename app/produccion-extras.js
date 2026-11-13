/* Producción · extras de las tarjetas (solo interfaz, no cambia datos):
   - Copiar con un clic: tocar el código de orden o la referencia lo copia y muestra «Copiado».
   - Foto ampliada: clic en la miniatura abre el diseño grande; se cierra con Esc, clic fuera o la X.
   Para apagarlo: localStorage.setItem('indoor-extras-off','1'). Respeta prefers-reduced-motion. */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-extras-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('produccion-extras')) return;
  const M = window.Motion || null;
  const quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const P = 'html body.production-mode ';
  const st = document.createElement('style');
  st.id = 'produccion-extras';
  st.textContent = `
  ${P}.trace-card :is(h3,p,dd,dt,small,b,strong,span,li):not(button *):not(a *):hover{cursor:copy}
  /* dato que se va a copiar: solo una línea punteada que se mueve debajo del texto (hormigueo), sin recuadro */
  ${P}.trace-card .pe-hover{--pe-c:#d0ec93;-webkit-mask-image:linear-gradient(90deg,#000 var(--pe-w,100%),transparent var(--pe-w,100%));mask-image:linear-gradient(90deg,#000 var(--pe-w,100%),transparent var(--pe-w,100%));background-image:linear-gradient(90deg,var(--pe-c) 55%,transparent 0);background-size:8px 2px;background-repeat:repeat-x;background-position:0 100%;padding-bottom:3px;animation:peLinea .7s linear infinite;box-decoration-break:clone;-webkit-box-decoration-break:clone}
  @keyframes peLinea{to{background-position:8px 100%}}
  /* toda la tarjeta (Shift o pulsación larga): borde punteado alrededor */
  .pe-ants{--pe-c:#d0ec93;background-color:rgba(208,236,147,.05);background-image:linear-gradient(90deg,var(--pe-c) 55%,transparent 0),linear-gradient(90deg,var(--pe-c) 55%,transparent 0),linear-gradient(0deg,var(--pe-c) 55%,transparent 0),linear-gradient(0deg,var(--pe-c) 55%,transparent 0);background-size:8px 1.5px,8px 1.5px,1.5px 8px,1.5px 8px;background-repeat:repeat-x,repeat-x,repeat-y,repeat-y;background-position:0 0,0 100%,0 0,100% 0;animation:peHormiga .7s linear infinite}
  @keyframes peHormiga{to{background-position:8px 0,-8px 100%,0 -8px,100% 8px}}
  .pe-ants{position:absolute;inset:5px;z-index:6;pointer-events:none;margin:0;padding:0;border-radius:14px;background-color:rgba(208,236,147,.05)}
  @keyframes peCopiado{0%{background-color:rgba(208,236,147,.45)}100%{background-color:rgba(208,236,147,0)}}
  ${P}.trace-card .pe-copiado{border-radius:5px;animation:peCopiado .7s ease-out 1}
  ${P}.trace-card .trace-media img{cursor:zoom-in}
  @media(hover:hover) and (pointer:fine){
    ${P}.trace-cards .trace-card{transition:opacity .35s ease,transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
  }
  .pe-toast{position:fixed;z-index:100000;pointer-events:none;padding:5px 11px;border-radius:999px;background:rgba(16,24,12,.94);color:#d0ec93;font:700 11px/1 Arial,sans-serif;letter-spacing:.08em;box-shadow:0 10px 24px -10px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.1);transform:translate(-50%,-140%)}
  .pe-lb{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(3,6,3,.82);cursor:zoom-out;opacity:0}
  .pe-lb img{max-width:min(92vw,1100px);max-height:88vh;border-radius:16px;background:#edf0eb;box-shadow:0 40px 90px -30px rgba(0,0,0,.95);cursor:default}
  .pe-lb button{position:absolute;top:18px;right:18px;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font:700 18px Arial;cursor:pointer;box-shadow:0 10px 22px -12px rgba(0,0,0,.85)}
  @media(prefers-reduced-motion:reduce){${P}.trace-cards .trace-card{transition:none}${P}.trace-card .pe-hover,.pe-ants{animation:none}}
  `;
  document.head.appendChild(st);

  function aviso(x, y, texto) {
    const d = document.createElement('div'); d.className = 'pe-toast'; d.textContent = texto; d.style.left = x + 'px'; d.style.top = y + 'px';
    document.body.appendChild(d);
    if (M && !quieto) M.animate(d, { opacity: [0, 1, 1, 0], y: [6, 0, 0, -6] }, { duration: 1.3, times: [0, .15, .75, 1] });
    setTimeout(() => d.remove(), 1400);
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) {
      try { const a = document.createElement('textarea'); a.value = texto; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch (e2) { return false; }
    }
  }

  function ampliar(src) {
    if (document.querySelector('.pe-lb')) return;
    const lb = document.createElement('div'); lb.className = 'pe-lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-label', 'Diseño ampliado');
    lb.innerHTML = '<img alt=""><button type="button" aria-label="Cerrar">×</button>';
    lb.querySelector('img').src = src;
    document.body.appendChild(lb);
    const cerrar = () => {
      document.removeEventListener('keydown', tecla, true);
      if (M && !quieto) { M.animate(lb, { opacity: 0 }, { duration: .18 }); setTimeout(() => lb.remove(), 200); } else lb.remove();
    };
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } };
    document.addEventListener('keydown', tecla, true);
    lb.addEventListener('click', e => { if (e.target !== lb.querySelector('img')) cerrar(); });
    if (M && !quieto) { M.animate(lb, { opacity: [0, 1] }, { duration: .22 }); M.animate(lb.querySelector('img'), { opacity: [0, 1], scale: [.94, 1] }, { duration: .35, ease: [0.22, 1, 0.36, 1] }); } else lb.style.opacity = '1';
    setTimeout(() => { if (lb.isConnected) lb.style.opacity = '1'; }, 400);
  }

  // qué dato se copiaría al hacer clic en t (null si ninguno)
  function objetivo(t) {
    if (!(t instanceof Element)) return null;
    const card = t.closest('.production-shell .trace-card'); if (!card) return null;
    if (t.closest('button,a,input,select,textarea,label,summary,[role=button],[data-order-note],.trace-rail,.trace-card-actions,.trace-copy-tools,.trace-media')) return null;
    let el = t;
    if (el.tagName === 'DT' && el.nextElementSibling) el = el.nextElementSibling;           // la etiqueta copia su valor
    else if (el.tagName === 'SMALL' && el.parentElement && el.parentElement.tagName === 'DD') el = el.parentElement;
    while (el && el !== card && !el.textContent.trim()) el = el.parentElement;
    if (!el || el === card || !card.contains(el)) return null;
    if (el.children.length > 14 || el.textContent.length > 900) return null;                 // contenedores grandes: no
    return el;
  }
  // texto de toda la tarjeta (sin botones, iconos ni la imagen), una línea por dato
  function textoTarjeta(card) {
    const c = card.cloneNode(true);
    [].forEach.call(c.querySelectorAll('button,svg,script,style,.trace-rail,.trace-card-actions,.trace-copy-tools,.trace-media,.pe-ants,[hidden]'), n => n.remove());
    [].forEach.call(c.querySelectorAll('div,p,dd,dt,li,h3,h4,section,header,footer'), n => n.insertAdjacentText('afterend', '\n'));
    return c.textContent.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  // hormigueo alrededor del dato que se va a copiar (con Shift, alrededor de toda la tarjeta)
  let marcado = null, ultimo = null, shift = false, hormigas = null;
  function limpiarTarjeta() { if (hormigas) { hormigas.remove(); hormigas = null; } }
  function marcar(el) {
    if (marcado !== el) {
      if (marcado) { marcado.classList.remove('pe-hover'); marcado.style.removeProperty('--pe-w'); }
      marcado = el;
      if (el) {   // la línea solo mide lo que mide el texto (sin cambiar el tamaño del elemento)
        try { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(), e0 = el.getBoundingClientRect(); el.style.setProperty('--pe-w', Math.ceil(Math.min(e0.width, b.right - e0.left + 2)) + 'px'); } catch (er) { /* sin medida: línea completa */ }
        el.classList.add('pe-hover');
      }
    }
  }
  function actualizar() {
    const card = ultimo && ultimo.closest ? ultimo.closest('.production-shell .trace-card') : null;
    if (shift && card) {
      marcar(null);
      if (!hormigas || hormigas.parentElement !== card) { limpiarTarjeta(); hormigas = document.createElement('div'); hormigas.className = 'pe-ants'; card.appendChild(hormigas); }
    } else { limpiarTarjeta(); marcar(ultimo ? objetivo(ultimo) : null); }
  }
  document.addEventListener('mouseover', e => { ultimo = e.target; shift = e.shiftKey; actualizar(); }, true);
  document.addEventListener('mouseout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.trace-card')) { ultimo = null; actualizar(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Shift' && !shift) { shift = true; actualizar(); } }, true);
  document.addEventListener('keyup', e => { if (e.key === 'Shift') { shift = false; actualizar(); } }, true);

  document.addEventListener('click', e => {
    const t = e.target; if (!(t instanceof Element)) return;
    const card = t.closest('.production-shell .trace-card'); if (!card) return;
    const img = t.closest('.trace-media img');
    if (!e.shiftKey && img && img.src) { e.preventDefault(); e.stopPropagation(); ampliar(img.currentSrc || img.src); return; }
    if (e.shiftKey) {   // Shift + clic: toda la tarjeta
      e.preventDefault(); e.stopPropagation();
      copiar(textoTarjeta(card)).then(ok => aviso(e.clientX, e.clientY, ok ? 'Tarjeta copiada' : 'No se pudo copiar'));
      return;
    }
    const sel = window.getSelection && String(window.getSelection()); if (sel && sel.trim()) return;
    const el = objetivo(t); if (!el) return;
    const txt = el.textContent.replace(/\s+/g, ' ').trim(); if (!txt) return;
    el.classList.add('pe-copiado'); setTimeout(() => el.classList.remove('pe-copiado'), 700);
    copiar(txt).then(ok => aviso(e.clientX, e.clientY, ok ? 'Copiado' : 'No se pudo copiar'));
  });

  // móvil / pantalla táctil: mantener presionada la tarjeta (0,6 s) copia toda la tarjeta, como Shift + clic en escritorio
  (function () {
    let tp = 0, x0 = 0, y0 = 0, hecho = false;
    const cancelar = () => { clearTimeout(tp); };
    document.addEventListener('touchstart', e => {
      const t = e.target; if (!(t instanceof Element) || e.touches.length !== 1) return;
      const card = t.closest('.production-shell .trace-card'); if (!card) return;
      if (t.closest('button,a,input,select,textarea,label,summary,[role=button],.trace-rail,.trace-card-actions,.trace-copy-tools,.trace-media')) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; hecho = false;
      tp = setTimeout(() => {
        hecho = true;
        const h = document.createElement('div'); h.className = 'pe-ants'; card.appendChild(h); setTimeout(() => h.remove(), 900);
        copiar(textoTarjeta(card)).then(ok => { aviso(x0, y0, ok ? 'Tarjeta copiada' : 'No se pudo copiar'); if (navigator.vibrate) try { navigator.vibrate(30); } catch (er) { /* nada */ } });
      }, 600);
    }, { passive: true });
    document.addEventListener('touchmove', e => { if (!e.touches[0]) return; if (Math.abs(e.touches[0].clientX - x0) > 10 || Math.abs(e.touches[0].clientY - y0) > 10) cancelar(); }, { passive: true });
    document.addEventListener('touchend', cancelar, { passive: true });
    document.addEventListener('touchcancel', cancelar, { passive: true });
    // si fue una pulsación larga, el clic que sigue no debe copiar el dato suelto
    document.addEventListener('click', e => { if (hecho) { hecho = false; e.preventDefault(); e.stopPropagation(); } }, true);
  })();
})();
