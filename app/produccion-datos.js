/* Producción · datos con vida (usa /motion.js), solo lectura: no cambia ningún dato ni control.
   - Los números de los chips (Todos 307, Por fabricar 27…) y de los indicadores (UNIDADES, MTS REQUERIDOS) cuentan hasta su valor
     y, cuando cambian por la actualización automática, suben o bajan hasta el nuevo valor con un pequeño destello.
   - Cada chip lleva un aro fino que rodea su número y se dibuja según su parte del total (Por fabricar 27 de 307, etc.), con un brillo
     suave en el color del chip. Es una capa encima que no recibe clics: los chips funcionan igual.
   Para apagarlo: localStorage.setItem('indoor-datos-off', '1'). Respeta prefers-reduced-motion. */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-datos-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  const M = window.Motion || null;
  const quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const anima = !!M && !quieto;
  const ease = [0.22, 1, 0.36, 1];
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const COLOR = { 'POR FABRICAR': '#d0ec93', 'ATRASADOS': '#ff6b6b', 'EN PROCESO': '#ffb347', 'REPROCESO': '#ff8fb1', 'TERMINADOS': '#5ed08a' };
  const ORDEN = ['TERMINADOS', 'EN PROCESO', 'POR FABRICAR', 'REPROCESO', 'ATRASADOS'];

  // «12.494» / «798,26» / «307» → número; se conserva el formato original al terminar
  function aNumero(txt) {
    const s = String(txt).trim(); if (!/^[\d.,]+$/.test(s)) return null;
    const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null;
  }
  function formato(n, original) {
    const dec = (String(original).split(',')[1] || '').length;
    return n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function iniciar() {
    const shell = document.querySelector('.production-shell'), ws = shell && shell.querySelector('.trace-workspace');
    if (!shell || !ws) return false;
    if (shell.dataset.datos) return true;
    shell.dataset.datos = '1';

    const style = document.createElement('style');
    style.textContent = `
    html body .production-shell > .pd{display:none!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;z-index:3!important;pointer-events:none!important;overflow:visible}
    .pd-pill{position:absolute;overflow:visible}
    .pd-pill rect{fill:none;stroke-width:1.6}
    .pd-pill .t{stroke:rgba(255,255,255,.14)}
    .pd-pill .f{stroke-linecap:round;filter:drop-shadow(0 0 3px currentColor);animation:pdBrillo 3.6s ease-in-out infinite}
    @keyframes pdBrillo{0%,100%{stroke-opacity:.72}50%{stroke-opacity:1}}
    @media(prefers-reduced-motion:reduce){.pd-pill .f{animation:none}}
    @media(max-width:860px){.pd{display:none!important}}
    @keyframes pdPop{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}
    .pd-pop{display:inline-block;animation:pdPop .6s cubic-bezier(.22,1,.36,1)}
    `;
    document.head.appendChild(style);

    const pd = document.createElement('div');
    pd.className = 'pd'; pd.setAttribute('aria-hidden', 'true');
    pd.innerHTML = '';
    shell.appendChild(pd);

    /* ---------- Números que cuentan ---------- */
    const previos = new Map();   // clave → último valor mostrado
    let escribiendo = false;
    function clave(el) {
      if (el.matches('.trace-quick-filters button span')) return 'chip:' + norm(el.parentElement.firstChild && el.parentElement.firstChild.textContent);
      const lab = el.parentElement && el.parentElement.querySelector('small');
      return 'tot:' + norm(lab && lab.textContent);
    }
    function contar(el) {
      const original = el.textContent, destino = aNumero(original); if (destino === null) return;
      const k = clave(el), antes = previos.has(k) ? previos.get(k) : 0; previos.set(k, destino);
      if (!anima || antes === destino || document.hidden) return;   // con la pestaña oculta el navegador pausa las animaciones: se deja el número final
      escribiendo = true; el.textContent = formato(antes, original); escribiendo = false;
      const fijar = () => { if (el.textContent !== original) { escribiendo = true; el.textContent = original; escribiendo = false; } };
      const ctl = M.animate(antes, destino, { duration: antes === 0 ? 1.4 : .9, ease, onUpdate: v => { escribiendo = true; el.textContent = formato(v, original); escribiendo = false; } });
      ctl.finished.then(() => { fijar(); if (antes !== 0) { el.classList.remove('pd-pop'); void el.offsetWidth; el.classList.add('pd-pop'); } });
      // seguro: aunque el navegador frene la animación (pestaña en segundo plano), el número nunca se queda a medias
      setTimeout(() => { try { ctl.stop(); } catch (e) { /* nada */ } fijar(); }, 2600);
    }
    const objetivos = () => [].slice.call(ws.querySelectorAll('.trace-quick-filters button span, .trace-tot b'));

    /* ---------- Aro alrededor del número de cada chip (mismos números de los chips) ---------- */
    function leerChips() {
      let total = 0; const lista = [];
      [].forEach.call(ws.querySelectorAll('.trace-quick-filters button'), b => {
        const sp = b.querySelector('span'), n = sp ? aNumero(sp.textContent) : null; if (n === null) return;
        const nombre = norm(b.firstChild && b.firstChild.textContent);
        if (nombre === 'TODOS') total = n;
        lista.push({ nombre, n, sp });
      });
      return { lista, total };
    }
    const prevPct = {};
    const NEUTRO = '#d9e4d2';
    function aros() {
      return;   // los aros se quitaron: no se calcula nada
      const { lista, total } = leerChips();
      pd.innerHTML = '';
      if (!total) return;
      const s0 = shell.getBoundingClientRect();
      lista.forEach((it, i) => {
        const r = it.sp.getBoundingClientRect(); if (r.width < 4) return;
        const w = r.width + 8, h = r.height + 8, col = COLOR[it.nombre] || NEUTRO, pct = Math.min(1, it.n / total);
        const antes = prevPct[it.nombre] === undefined ? 0 : prevPct[it.nombre]; prevPct[it.nombre] = pct;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'pd-pill'); svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.style.left = (r.left - s0.left - 4) + 'px'; svg.style.top = (r.top - s0.top - 4) + 'px'; svg.style.color = col;
        const rx = (h - 3) / 2;
        svg.innerHTML = '<rect class="t" x="1.5" y="1.5" width="' + (w - 3) + '" height="' + (h - 3) + '" rx="' + rx + '"/><rect class="f" x="1.5" y="1.5" width="' + (w - 3) + '" height="' + (h - 3) + '" rx="' + rx + '" pathLength="1" stroke="' + col + '" stroke-dasharray="1" stroke-dashoffset="' + (1 - pct) + '"/>';
        pd.appendChild(svg); svg._sp = it.sp;
        const f = svg.querySelector('.f'), fin = 1 - pct;
        if (anima && antes !== pct) {
          M.animate(f, { strokeDashoffset: [1 - antes, fin] }, { duration: 1.4, delay: i * .08, ease });
          setTimeout(() => { f.style.strokeDashoffset = fin; }, 2400 + i * 80);   // seguro: nunca se queda a medias
        }
      });
    }

    // los aros siguen a sus chips aunque el diseño se mueva (cambio de proceso, título, ventana); si el chip ya no se ve, el aro se oculta
    function reposicionar() {
      const s0 = shell.getBoundingClientRect();
      [].forEach.call(pd.querySelectorAll('svg.pd-pill'), svg => {
        const sp = svg._sp; if (!sp || !sp.isConnected) { svg.style.display = 'none'; return; }
        const r = sp.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) { svg.style.display = 'none'; return; }
        svg.style.display = ''; svg.style.left = (r.left - s0.left - 4) + 'px'; svg.style.top = (r.top - s0.top - 4) + 'px';
      });
    }

    /* ---------- Reacciona a los cambios de la pantalla (sin entrar en bucle con lo que escribo) ---------- */
    let tCambio = 0;
    function alCambiar() { clearTimeout(tCambio); tCambio = setTimeout(() => { objetivos().forEach(el => { const k = clave(el), n = aNumero(el.textContent); if (n !== null && (!previos.has(k) || previos.get(k) !== n)) contar(el); }); aros(); }, 250); }
    new MutationObserver(m => { if (escribiendo) return; alCambiar(); }).observe(ws, { childList: true, subtree: true, characterData: true });
        alCambiar();
    return true;
  }

  // el panel y la franja se dibujan después de cargar: se espera a que existan
  let intentos = 0;
  const espera = setInterval(() => { intentos++; if (iniciar() || intentos > 60) clearInterval(espera); }, 500);
})();
