// Foto de perfil: el avatar de cada usuario es su foto. Se sube desde «Mi perfil»; si no hay foto, quedan las iniciales de siempre.
(function () {
  const estado = { yo: '', fotos: {} };
  const css = document.createElement('style');
  css.textContent = `
  .user-avatar.con-foto{background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;color:transparent!important;font-size:0!important;border:2px solid rgba(195,238,63,.7)}
  .fp-box{display:flex;align-items:center;gap:16px;margin:2px 0 14px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap}
  .fp-ava{width:96px;height:96px;flex:0 0 96px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#c3ee3f,#7fd21c);color:#10140a;font:900 30px Arial;background-size:cover;background-position:center;border:3px solid rgba(195,238,63,.65);box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .2s}
  .fp-ava:hover{transform:scale(1.04)}.fp-ava.arrastra{outline:3px dashed #d7ff3a;outline-offset:4px}
  .fp-box{max-width:100%;box-sizing:border-box}.account-dialog{overflow-x:hidden}
  .fp-acc{display:grid;gap:8px;justify-items:start;min-width:0;flex:1 1 150px}
  .fp-acc button{width:auto!important;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:#141c11;color:#e9efe3;font:800 12px Arial;cursor:pointer}
  .fp-acc button.pri{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}
  .fp-acc small{color:#8e9a87;font:600 11px Arial;max-width:100%}`;
  document.head.appendChild(css);

  const url = v => '/api/perfil/foto?v=' + v;
  // Avatar por defecto (dibujo de persona) con un color propio de cada usuario, para cuando aún no hay foto
  const PALETA = [['#c3ee3f', '#4cae1c'], ['#38bdf8', '#2563eb'], ['#fb923c', '#e11d48'], ['#f472b6', '#9333ea'], ['#2dd4bf', '#0f766e'], ['#facc15', '#ea580c']];
  function avatarDefecto(nombre) {
    let h = 0; String(nombre || 'x').toLowerCase().split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    const [a, b] = PALETA[h % PALETA.length];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="37" r="17" fill="#10140a" opacity=".82"/><path d="M15 100C15 70 31 60 50 60S85 70 85 100Z" fill="#10140a" opacity=".82"/></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  const nombreYo = () => estado.yo || ((document.querySelector('.user-info strong') || {}).textContent || '');
  const propia = () => estado.fotos[(estado.yo || '').toLowerCase()];

  function pintarAvatares() {
    const v = propia();
    document.querySelectorAll('.user-avatar').forEach(a => {
      a.classList.add('con-foto');
      a.style.setProperty('background-image', 'url("' + (v ? url(v) : avatarDefecto(nombreYo())) + '")', 'important');
    });
    const g = document.querySelector('.fp-ava');
    if (g) { g.style.setProperty('background-image', 'url("' + (v ? url(v) : avatarDefecto(nombreYo())) + '")', 'important'); g.textContent = ''; }
    const q = document.querySelector('.fp-quitar');
    if (q) q.style.display = v ? '' : 'none';
  }

  async function cargar() {
    try {
      const r = await fetch('/api/perfil/fotos', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      estado.yo = j.yo || ''; estado.fotos = j.fotos || {};
      pintarAvatares();
    } catch (e) { /* sin foto: quedan las iniciales */ }
  }

  async function subir(archivo) {
    const msg = document.getElementById('account-message');
    if (!archivo || !/^image\//.test(archivo.type)) { if (msg) msg.textContent = 'Elige una imagen (JPG, PNG o WEBP).'; return; }
    if (msg) msg.textContent = 'Subiendo foto…';
    try {
      const r = await fetch('/api/perfil/foto', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No pude guardar la foto');
      estado.fotos[(estado.yo || '').toLowerCase()] = j.version || Date.now();
      pintarAvatares();
      if (msg) msg.textContent = 'Foto actualizada.';
    } catch (e) { if (msg) msg.textContent = e.message; }
  }

  async function quitar() {
    if (!confirm('¿Quitar tu foto de perfil?')) return;
    try {
      await fetch('/api/perfil/foto', { method: 'DELETE', credentials: 'same-origin' });
      delete estado.fotos[(estado.yo || '').toLowerCase()];
      pintarAvatares();
      const msg = document.getElementById('account-message'); if (msg) msg.textContent = 'Foto quitada.';
    } catch (e) { /* sin cambios */ }
  }

  function montarPerfil() {
    const perfil = document.getElementById('account-profile');
    if (!perfil || perfil.querySelector('.fp-box')) return !!perfil;
    const caja = document.createElement('div');
    caja.className = 'fp-box';
    caja.innerHTML = '<div class="fp-ava" title="Arrastra una foto aquí"></div><div class="fp-acc"><button type="button" class="pri fp-subir">📷 Subir foto</button><button type="button" class="fp-quitar">Quitar foto</button><small>JPG, PNG o WEBP. Se recorta en cuadrado y la verán todos en tu avatar.</small></div>';
    perfil.insertBefore(caja, perfil.firstChild);
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp'; inp.hidden = true;
    caja.appendChild(inp);
    caja.querySelector('.fp-subir').addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { if (inp.files[0]) subir(inp.files[0]); inp.value = ''; });
    caja.querySelector('.fp-quitar').addEventListener('click', quitar);
    const ava = caja.querySelector('.fp-ava');
    ava.addEventListener('click', () => inp.click());
    ['dragenter', 'dragover'].forEach(ev => ava.addEventListener(ev, e => { e.preventDefault(); ava.classList.add('arrastra'); }));
    ['dragleave', 'drop'].forEach(ev => ava.addEventListener(ev, e => { e.preventDefault(); ava.classList.remove('arrastra'); }));
    ava.addEventListener('drop', e => { if (e.dataTransfer.files[0]) subir(e.dataTransfer.files[0]); });
    pintarAvatares();
    return true;
  }

  // Disponible para otros módulos: URL de la foto de un usuario (o '' si no tiene).
  window.fotoDeUsuario = nombre => { const v = estado.fotos[String(nombre || '').toLowerCase()]; return v ? '/api/perfil/foto?usuario=' + encodeURIComponent(nombre) + '&v=' + v : avatarDefecto(nombre); };

  let n = 0;
  const espera = setInterval(() => { if ((document.querySelector('.user-avatar') && montarPerfil()) || ++n > 100) { clearInterval(espera); cargar(); } }, 250);
  new MutationObserver(() => { if (document.querySelector('.user-avatar:not(.con-foto)')) pintarAvatares(); }).observe(document.body, { childList: true, subtree: true });
})();
