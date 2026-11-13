/* Producción · franja animada de fondo (usa /motion.js), solo decorativa y de solo lectura.
   Va DETRÁS de la barra de arriba y de los filtros: no mueve, tapa ni cambia ningún control ni dato.
   - Foto real de la planta según el proceso elegido en el selector «Proceso» (cambia con fundido).
   - Cinta con los pedidos que se están mostrando (código · cliente · entrega), leída de las tarjetas.
   - Destellos suaves y brillo lima. Se pausa cuando la pantalla no se ve. Respeta prefers-reduced-motion.
   Para apagarlo: localStorage.setItem('indoor-franja-off', '1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-franja-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  const M = window.Motion || null;
  const quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const anima = !!M && !quieto;
  const ease = [0.22, 1, 0.36, 1];
  const L = n => '/landing/' + n + '.jpg';
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const FOTO = { 'DISENO': 'fabrica-4', 'EDICION': 'fabrica-4', 'MTS REQUERIDOS': 'fabrica-4', 'IMPRESION': 'fabrica-1', 'SUBLIMACION': 'fabrica-6', 'MATERIALES': 'fabrica-6',
    'CORTE LASER': 'fabrica-2', 'TRAZO/CORTE/PLT': 'fabrica-2', 'CONFECCION': 'fabrica-3', 'APLIQUE': 'fabrica-3', 'INSUMOS': 'fabrica-3', 'EMPAQUE': 'fabrica-5', 'ENVIO': 'fabrica-5', 'FACTURACION': 'fabrica-5' };
  const TODAS = ['fabrica-4', 'fabrica-1', 'fabrica-6', 'fabrica-2', 'fabrica-3', 'fabrica-5'];

  function iniciar() {
    const shell = document.querySelector('.production-shell');
    if (!shell || shell.dataset.franja) return !!shell;
    shell.dataset.franja = '1';

    const style = document.createElement('style');
    style.textContent = `
    .production-shell{isolation:isolate}
    html body .production-shell > .pf{position:absolute!important;left:0!important;right:0!important;top:0!important;bottom:auto!important;height:var(--pf-h,340px)!important;width:auto!important;margin:0!important;z-index:-1!important;pointer-events:none!important;overflow:hidden;contain:layout paint}
    .pf-fondo{position:absolute;inset:0;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 55%,transparent 100%),linear-gradient(90deg,transparent 0,#000 12%,#000 88%,transparent 100%);-webkit-mask-composite:source-in;mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 55%,transparent 100%),linear-gradient(90deg,transparent 0,#000 12%,#000 88%,transparent 100%);mask-composite:intersect}
    .pf-am{position:absolute;inset:0}
    .pf-am .am{position:absolute;inset:0;opacity:0;transition:opacity 1.3s ease;overflow:hidden}.pf-am .am.on{opacity:.34}
    .pf-am img{position:absolute;inset:-4%;width:108%;height:108%;object-fit:cover;filter:saturate(.9);will-change:transform}
    .pf-sombra{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,8,5,.6) 0,rgba(4,8,5,.4) 45%,rgba(4,8,5,.25) 100%)}
    .pf-glow{position:absolute;left:62%;top:20%;width:70%;aspect-ratio:2.2/1;translate:-50% -50%;background:radial-gradient(closest-side,rgba(208,244,76,.14),rgba(208,244,76,.03) 60%,transparent 78%)}
    .pf canvas{position:absolute;inset:0;width:100%;height:100%}
    .pf-tick{position:absolute;left:38%;right:0;top:calc(var(--pf-h,340px) - 46px);height:20px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
    .pf-trk{display:inline-flex;gap:38px;white-space:nowrap;animation:pfMarq var(--dur,80s) linear infinite}
    .pf-trk span{font:700 .64rem Arial,Helvetica,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:rgba(228,236,223,.78);line-height:20px}
    .pf-trk span b{color:#d0f44c;font-weight:800;margin-right:8px}.pf-trk span.r b{color:#ff9a9a}.pf-trk span.n b{color:#ffc878}
    @keyframes pfMarq{to{transform:translateX(-50%)}}
    .pf-tick{display:none!important}
    @media(prefers-reduced-motion:reduce){.pf-trk{animation:none}.pf-am .am{transition:none}}
    `;
    document.head.appendChild(style);

    const pf = document.createElement('div');
    pf.className = 'pf';
    pf.setAttribute('aria-hidden', 'true');
    pf.innerHTML = '<div class="pf-fondo"><div class="pf-am">' + TODAS.map(f => '<div class="am" data-f="' + f + '"><img src="' + L(f) + '" alt="" decoding="async" loading="lazy"></div>').join('') + '</div><div class="pf-sombra"></div><div class="pf-glow"></div><canvas></canvas></div><div class="pf-tick"><div class="pf-trk"></div></div>';
    shell.insertBefore(pf, shell.firstChild);

    const ams = [].slice.call(pf.querySelectorAll('.am')), trk = pf.querySelector('.pf-trk'), cv = pf.querySelector('canvas'), cx = cv.getContext('2d');

    /* ---------- Alto de la franja: hasta el inicio de las tarjetas ---------- */
    function medir() {
      const tc = shell.querySelector('.trace-cards'); if (!tc) return;
      const h = Math.max(200, tc.getBoundingClientRect().top - shell.getBoundingClientRect().top - 6);
      pf.style.setProperty('--pf-h', h + 'px');
      DPR = .6; W = shell.clientWidth; H = h; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      estr = Array.from({ length: Math.round(Math.min(32, Math.max(14, W * H / 26000))) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: .5 + Math.random() * 1.3, ph: Math.random() * 6.28, sp: .5 + Math.random() * 1.3, g: Math.random() < .2, c: Math.random() < .35 ? '208,244,76' : '255,255,255' }));
    }
    let W = 0, H = 0, DPR = .6, estr = [], visible = true, raf = 0, ultimo = 0;
    if (typeof ResizeObserver === 'function') new ResizeObserver(medir).observe(shell);

    /* ---------- Foto según el proceso elegido ---------- */
    let rot = 0, actualFoto = '';
    function fotoDeProceso() {
      const sel = shell.querySelector('.production-process-filter select');
      const t = norm(sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '');
      if (FOTO[t]) return FOTO[t];
      return TODAS[rot % TODAS.length];   // «Todos los procesos»: va rotando
    }
    function ponerFoto(f) {
      if (f === actualFoto) return; actualFoto = f;
      ams.forEach(a => a.classList.toggle('on', a.dataset.f === f));
      const img = (ams.find(a => a.dataset.f === f) || ams[0]).firstChild;
      if (anima) M.animate(img, { scale: [1.12, 1.02], x: [(Math.random() > .5 ? 2 : -2) + '%', '0%'] }, { duration: 14, ease: 'linear' });
    }
    ponerFoto(fotoDeProceso());
    // se revisa el selector cada 1,5 s; con «Todos los procesos» la foto va rotando cada ~9 s
    let ticks = 0;
    setInterval(() => {
      const sel = shell.querySelector('.production-process-filter select');
      const todos = !sel || /^TODOS/.test(norm(sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text));
      ticks++; if (todos && ticks % 6 === 0) rot++;
      ponerFoto(fotoDeProceso());
    }, 1500);

    /* ---------- Cinta con los pedidos que se muestran (solo lectura) ---------- */
    const limpia = t => String(t == null ? '' : t).replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim();
    function cinta() {
      const cards = [].slice.call(shell.querySelectorAll('.trace-card')).slice(0, 30);
      const items = cards.map(c => {
        const h = limpia(c.querySelector('.trace-card-heading') && c.querySelector('.trace-card-heading').textContent), m = h.match(/^[A-Z]{1,3}\d{3,6}/), cod = m ? m[0] : '';
        const cli = limpia(c.querySelector('.trace-client') && c.querySelector('.trace-client').textContent).slice(0, 34);
        const due = c.querySelector('.trace-due'), dt = limpia(due && due.textContent).replace(/^Entrega\s*/i, '');
        if (!cod) return '';
        return '<span class="' + (due && due.classList.contains('late') ? 'r' : '') + '"><b>' + cod + '</b>' + cli + (dt ? ' · ' + dt : '') + '</span>';
      }).filter(Boolean);
      if (!items.length) { trk.innerHTML = ''; return; }
      trk.innerHTML = items.join('') + items.join('');
      trk.style.setProperty('--dur', Math.max(50, items.length * 5) + 's');
    }
    let tCinta = 0;
    const cuando = () => { clearTimeout(tCinta); tCinta = setTimeout(cinta, 700); };
    const tcs = shell.querySelector('.trace-cards');
    if (tcs && typeof MutationObserver === 'function') new MutationObserver(cuando).observe(tcs, { childList: true });
    cuando();

    /* ---------- Destellos (lienzo pequeño, 30 fps, se pausa si no se ve) ---------- */
    function pinta(ahora) {
      const t = ahora / 1000;
      cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); cx.globalCompositeOperation = 'lighter';
      estr.forEach(s => {
        const a = Math.pow(.5 + .5 * Math.sin(t * s.sp + s.ph), 3); if (a < .03) return;
        cx.fillStyle = 'rgba(' + s.c + ',' + (.12 + .7 * a).toFixed(3) + ')'; cx.beginPath(); cx.arc(s.x, s.y, s.r * (.7 + a * .6), 0, 6.283); cx.fill();
        if (s.g) { const Lg = s.r * 8 * a;[[s.x - Lg, s.y, s.x + Lg, s.y, s.x - Lg, s.y - .5, Lg * 2, 1], [s.x, s.y - Lg, s.x, s.y + Lg, s.x - .5, s.y - Lg, 1, Lg * 2]].forEach(q => { const g = cx.createLinearGradient(q[0], q[1], q[2], q[3]); g.addColorStop(0, 'rgba(' + s.c + ',0)'); g.addColorStop(.5, 'rgba(' + s.c + ',' + (.6 * a).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + s.c + ',0)'); cx.fillStyle = g; cx.fillRect(q[4], q[5], q[6], q[7]); }); }
      });
      cx.globalCompositeOperation = 'source-over';
    }
    const bucle = ahora => { raf = (visible && !document.hidden) ? requestAnimationFrame(bucle) : 0; if (ahora - ultimo < 32) return; ultimo = ahora; pinta(ahora); };
    const arranca = () => { if (!raf && anima) raf = requestAnimationFrame(bucle); };
    if (typeof IntersectionObserver === 'function') new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) arranca(); }).observe(shell);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) arranca(); });
    medir(); if (anima) arranca(); else pinta(1500);
    if (anima) M.animate(pf, { opacity: [0, 1] }, { duration: 1.4, ease });
    return true;
  }

  // el panel se dibuja después de cargar: se espera a que exista
  let intentos = 0;
  const espera = setInterval(() => { intentos++; if (iniciar() || intentos > 40) clearInterval(espera); }, 500);
})();
