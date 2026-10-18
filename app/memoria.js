/* Memoria de agentes: los errores que reportan los agentes, lo que ya se corrigió y lo que volvió (regresión).
   Solo Administración / Coordinación (el servidor responde 403 al resto y entonces no se crea nada). Se abre desde el menú de usuario. */
(function () {
  if (window.__memoriaPanel) return;
  window.__memoriaPanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { datos: null, filtro: 'regresion', q: '', cargando: false };
  let panel = null, tab = null, vista = null, timer = 0;
  const ESTADOS = { regresion: ['Volvió', 'bad'], abierto: ['Sin revisar', 'warn'], corregido: ['Corregido', 'ok'], ignorado: ['Ignorado', ''] };
  const cuando = iso => { if (!iso) return '—'; const d = new Date(iso.length <= 19 ? iso : iso); return isNaN(d) ? iso.slice(0, 16).replace('T', ' ') : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  const css = document.createElement('style');
  css.textContent = `
  .mm{display:grid;gap:14px;max-width:1100px;margin:auto}
  .mm-cab{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border:1px solid rgba(255,255,255,.22);border-radius:18px;background:radial-gradient(120% 90% at 8% 0%,rgba(255,255,255,.15),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.11),rgba(255,255,255,.035));-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4)}
  .mm-cab span{display:block;color:#c9d3c4;font:800 .62rem Arial;letter-spacing:.2em}.mm-cab h2{margin:3px 0 0;font-size:1.3rem}
  .mm-cab input{min-height:40px;min-width:220px;padding:0 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font:500 .9rem Arial;outline:none}
  .mm-kpis{display:flex;gap:10px;flex-wrap:wrap}
  .mm-k{--r:#fff;min-width:140px;padding:8px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;text-align:left;cursor:pointer;box-shadow:0 0 0 1px color-mix(in srgb,var(--r) 40%,transparent);transition:transform .2s,box-shadow .2s;width:auto!important}
  .mm-k.bad{--r:#ff4b3e}.mm-k.warn{--r:#ff9a1f}.mm-k.ok{--r:#35d46a}.mm-k:hover{transform:translateY(-2px)}.mm-k.on{box-shadow:0 0 0 2px var(--r),0 0 20px -4px var(--r)}
  .mm-k b{display:block;font-size:1.4rem;line-height:1.1}.mm-k small{font:800 .58rem Arial;letter-spacing:.12em;text-transform:uppercase;color:#c9d3c4}
  .mm-lista{display:grid;gap:10px}
  .mm-it{--r:#fff;display:grid;gap:8px;padding:14px 16px;border-radius:18px;border:1px solid rgba(255,255,255,.2);background:radial-gradient(120% 80% at 10% 0%,rgba(255,255,255,.12),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.1),rgba(255,255,255,.03));box-shadow:inset 0 1.5px 0 rgba(255,255,255,.3),0 0 0 1px color-mix(in srgb,var(--r) 45%,transparent),0 0 14px -5px var(--r)}
  .mm-it.bad{--r:#ff4b3e}.mm-it.warn{--r:#ff9a1f}.mm-it.ok{--r:#35d46a}
  .mm-fila{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .mm-ag{padding:3px 11px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);font:800 .66rem Arial;letter-spacing:.08em}
  .mm-es{padding:3px 11px;border-radius:999px;border:1px solid var(--r);color:var(--r);font:800 .62rem Arial;letter-spacing:.1em;text-transform:uppercase}
  .mm-meta{margin-left:auto;font:600 .7rem Arial;color:#aab6a5}
  .mm-ej{font:600 .84rem Arial;line-height:1.45;overflow-wrap:anywhere;color:#e7eee2}
  .mm-nota{padding:9px 12px;border-radius:12px;background:rgba(53,212,106,.1);border:1px solid rgba(53,212,106,.35);font:600 .78rem Arial;line-height:1.45;color:#d6f3dd}.mm-nota small{display:block;margin-top:3px;color:#9fc7aa;font-size:.66rem}
  .mm-acc{display:flex;gap:8px;flex-wrap:wrap}.mm-acc button{padding:7px 14px;border:1px solid rgba(255,255,255,.3);border-radius:999px;background:rgba(255,255,255,.1);color:#fff;font:800 .7rem Arial;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .mm-acc button.pri{background:rgba(255,255,255,.92);color:#10140a}.mm-acc button:hover{filter:brightness(1.15)}
  .mm-vacio{padding:34px;text-align:center;border:1px dashed rgba(255,255,255,.22);border-radius:16px;color:#b6c2b0}
  body:has(.panel[data-panel='memoria'].active) main{width:100%!important;max-width:none!important}
  `;
  document.head.appendChild(css);

  function pintar() {
    const d = st.datos;
    if (!d) { vista.innerHTML = '<div class="mm-vacio">Cargando…</div>'; return; }
    const q = st.q.trim().toLowerCase();
    const lista = d.items.filter(i => (st.filtro === 'todos' || i.estado === st.filtro) && (!q || (i.agente + ' ' + i.ejemplo + ' ' + i.nota).toLowerCase().includes(q)));
    const k = (e, txt, cls) => '<button type="button" class="mm-k ' + cls + (st.filtro === e ? ' on' : '') + '" data-mm-f="' + e + '"><b>' + (d.resumen[e] || 0) + '</b><small>' + txt + '</small></button>';
    vista.innerHTML = '<div class="mm"><div class="mm-cab"><div><span>AGENTES</span><h2>MEMORIA DE AGENTES</h2></div><input type="search" data-mm-q placeholder="Buscar agente o texto…" value="' + esc(st.q) + '"></div>' +
      '<div class="mm-kpis">' + k('regresion', 'Volvieron', 'bad') + k('abierto', 'Sin revisar', 'warn') + k('corregido', 'Corregidos', 'ok') + k('ignorado', 'Ignorados', '') + k('todos', 'Todos', '') + '</div>' +
      '<div class="mm-lista">' + (lista.length ? lista.map(i => {
        const [txt, cls] = ESTADOS[i.estado] || [i.estado, ''];
        return '<article class="mm-it ' + cls + '"><div class="mm-fila"><span class="mm-ag">' + esc(i.agente) + '</span><span class="mm-es">' + txt + '</span>' +
          '<span class="mm-meta">' + (i.veces ? i.veces + ' vez' + (i.veces === 1 ? '' : 'es') + ' · última ' + cuando(i.ultima) : 'lección registrada') + '</span></div>' +
          '<div class="mm-ej">' + esc(i.ejemplo) + '</div>' +
          (i.nota ? '<div class="mm-nota">' + esc(i.nota) + '<small>Corregido por ' + esc(i.corregido_por || '—') + ' · ' + cuando(i.corregido_at) + (i.veces_despues ? ' · volvió ' + i.veces_despues + ' vez/veces' : '') + '</small></div>' : '') +
          '<div class="mm-acc">' + (i.estado === 'corregido' ? '' : '<button type="button" class="pri" data-mm-corregir="' + esc(i.id) + '">Marcar como corregido</button>') +
          (i.estado === 'abierto' ? '<button type="button" data-mm-ignorar="' + esc(i.id) + '">Ignorar</button>' : '') +
          (i.estado === 'corregido' || i.estado === 'ignorado' || i.estado === 'regresion' ? '<button type="button" data-mm-reabrir="' + esc(i.id) + '">Reabrir</button>' : '') + '</div></article>';
      }).join('') : '<div class="mm-vacio">' + (st.filtro === 'regresion' ? 'Ningún error corregido ha vuelto. ✓' : 'Nada en este filtro.') + '</div>') + '</div></div>';
  }

  async function llamar(url, cuerpo) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'No se pudo completar');
    return j;
  }
  async function cargar() {
    if (st.cargando) return;
    st.cargando = true;
    try {
      const r = await fetch('/api/memoria', { cache: 'no-store', credentials: 'same-origin' });
      if (r.ok) { st.datos = await r.json(); if (st.filtro === 'regresion' && !st.datos.resumen.regresion && !st.vioFiltro) { st.filtro = st.datos.resumen.abierto ? 'abierto' : 'corregido'; } st.vioFiltro = true; pintar(); }
    } catch (e) { /* sin red: se conserva lo último */ }
    st.cargando = false;
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="memoria"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'memoria';
    vista = document.createElement('div'); panel.appendChild(vista); main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="memoria" type="button"><span class="nav-icon">MA</span><strong>MEMORIA DE AGENTES</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar();
      clearInterval(timer);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 30000);
    });
    panel.addEventListener('click', async e => {
      const f = e.target.closest('[data-mm-f]'); if (f) { st.filtro = f.dataset.mmF; pintar(); return; }
      const c = e.target.closest('[data-mm-corregir]');
      if (c) {
        const nota = prompt('¿Qué se corrigió? (queda como lección: si el error vuelve, avisa)');
        if (!nota || nota.trim().length < 4) return;
        try { await llamar('/api/memoria/corregir', { id: c.dataset.mmCorregir, nota }); } catch (err) { alert(err.message); }
        cargar(); return;
      }
      const i = e.target.closest('[data-mm-ignorar]'); if (i) { try { await llamar('/api/memoria/ignorar', { id: i.dataset.mmIgnorar }); } catch (err) { alert(err.message); } cargar(); return; }
      const r = e.target.closest('[data-mm-reabrir]'); if (r) { try { await llamar('/api/memoria/reabrir', { id: r.dataset.mmReabrir }); } catch (err) { alert(err.message); } cargar(); }
    });
    panel.addEventListener('input', e => { if (e.target.matches('[data-mm-q]')) { st.q = e.target.value; const pos = st.q.length; pintar(); const b = panel.querySelector('[data-mm-q]'); b.focus(); b.setSelectionRange(pos, pos); } });
    return true;
  }

  function enMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-memoria');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-memoria'; boton.textContent = 'Memoria de agentes';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;
    const previo = document.getElementById('open-zeus') || document.getElementById('open-bitacora') || document.getElementById('open-ecommerce') || document.getElementById('open-agentes');
    if (previo) previo.insertAdjacentElement('afterend', boton); else menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  // Solo Administración / Coordinación: si el servidor no deja leer la memoria, no se crea nada.
  fetch('/api/memoria', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(d => {
    if (!d) return;
    st.datos = d;
    let n = 0;
    const espera = setInterval(() => { if ((construir() && enMenu()) || ++n > 60) clearInterval(espera); }, 250);
  }).catch(() => { /* sin acceso */ });
})();
