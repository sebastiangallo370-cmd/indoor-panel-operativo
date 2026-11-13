/* Panel de CONFECCIÓN: se abre desde el botón de la tarjeta. Mockups a la izquierda; a la derecha se elige la
   confeccionista (lista plegable), el WhatsApp y el precio. El resumen del mensaje se va llenando mientras escribes
   y un solo botón envía a la extensión de WhatsApp (sin enviar por sí solo). */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  // Pesos colombianos con separador de miles con comas: $ 18,000 COP
  const pesos = n => '$ ' + Number(n || 0).toLocaleString('en-US') + ' COP';
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const MENSAJE_BASE = 'Por favor confirmar recepción y disponibilidad. Gracias.';

  let panel, tab, production, selectedRow = null, selected = null, mockupBlob = null, anterior = null;
  let pedido = {maker: '', phone: '', price: 0};

  async function api(url, options = {}) {
    const r = await fetch(url, {cache: 'no-store', credentials: 'same-origin', ...options, headers: {'Content-Type': 'application/json', ...(options.headers || {})}});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.detail || 'No se pudo consultar Confección');
    return d;
  }

  function field(row, name) {
    const i = (production?.headers || []).findIndex(h => norm(h) === norm(name));
    return i < 0 ? '' : String((row.values || [])[i] || '').trim();
  }

  // Mensaje completo; con los datos que faltan muestra «____» o «—» para que se vea qué falta.
  function mensaje(maker, amount) {
    const curva = (selected.curva || []).length
      ? selected.curva.map(x => `talla ${x.talla}: ${x.cantidad} und`)
      : [selected.curva_error || '(no disponible)'];
    return ['Preparación de confección:',
      'Cliente: ' + (selected.cliente || '—'),
      'Orden: ' + (selected.orden || '—'),
      'Referencia: ' + (selected.referencia || '—'),
      'Cantidad: ' + (selected.cantidad || '—') + ' prendas',
      'Precio por prenda: ' + (amount > 0 ? pesos(amount) : '—'),
      '', 'Curva del listado:', ...curva, '',
      ...(pedido.observaciones && pedido.observaciones.trim() ? ['Observaciones:', pedido.observaciones.trim(), ''] : []),
      MENSAJE_BASE].join('\n');
  }

  // Une los mockups en una sola imagen, sin deformarlos (cada uno conserva sus proporciones).
  function mockupsBlob() {
    if (!selected?.mockups?.length) return Promise.reject(Error('sin mockups'));
    const imgs = Promise.all(selected.mockups.map(async item => {
      const blob = await fetch(item.url, {credentials: 'same-origin'}).then(r => r.blob());
      const src = URL.createObjectURL(blob);
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(src); resolve(image); };
        image.onerror = reject;
        image.src = src;
      });
    }));
    return imgs.then(list => {
      const width = 900, height = 700, canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      canvas.width = width; canvas.height = height;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
      const cols = Math.min(2, list.length), cellW = width / cols, cellH = height / Math.ceil(list.length / cols);
      list.forEach((img, i) => {
        const scale = Math.min((cellW - 24) / img.naturalWidth, (cellH - 24) / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        ctx.drawImage(img, (i % cols) * cellW + (cellW - w) / 2, Math.floor(i / cols) * cellH + (cellH - h) / 2, w, h);
      });
      return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('sin imagen')), 'image/png'));
    });
  }

  const CSS = `
  .confeccion-panel{padding:4px 10px 12px;max-width:1400px;margin:auto}
  .cf-shell{display:grid;gap:10px;position:relative}
  .cf-tabbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px;border-radius:14px;background:rgba(0,0,0,.35);border:1px solid rgba(208,244,76,.24)}
  .cf-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;background:var(--metal,linear-gradient(180deg,#eaf9bd,#b7e25b));color:#111318;border:1px solid #d0f44c;font:900 13px Arial;letter-spacing:.06em;box-shadow:inset 0 1px 0 rgba(255,255,255,.65)}
  .cf-chip i{font-style:normal;font:900 11px Arial;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.18)}
  .cf-cerrar{width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.4);color:#f4f8ef;font:800 16px Arial;cursor:pointer;flex:0 0 auto}
  .cf-cerrar:hover{background:rgba(208,244,76,.2);border-color:rgba(208,244,76,.7)}
  .cf-datos{padding-right:0}
  .cf-izq{max-height:calc(100vh - 150px);overflow-y:auto;padding:10px}
  .cf-der{padding:10px 12px}
  .cf-tallas-mini{grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin-bottom:10px}
  .cf-tallas-mini .cf-talla{padding:6px 4px}
  .cf-tallas-mini .cf-talla b{font-size:16px}
  .cf-tallas-mini .cf-talla span{font-size:10px}
  .cf-head h2{margin:0;font:900 22px Arial;letter-spacing:.04em;color:#eef6e8}
  .cf-card,.cf-box{position:relative;overflow:hidden;border-radius:18px;padding:14px 16px;border:1px solid rgba(255,255,255,.16);background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.14),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.1),rgba(255,255,255,.03));box-shadow:0 12px 28px rgba(0,0,0,.28);transition:transform .2s,box-shadow .3s}
  .cf-card::before,.cf-box::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#4f9f2a,#8bd450)}
  .cf-card:hover{transform:translateY(-2px);box-shadow:0 16px 32px -14px #000}
  .cf-datos{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
  .cf-datos .cf-dato{padding:8px 12px}
  .cf-dato small{display:block;font:800 10px Arial;letter-spacing:.14em;color:#c9d3c4}
  .cf-dato b{font:800 15px Arial;color:#f4f8ef}
  .cf-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:start}
  .cf-box h3{margin:0 0 10px;font:900 13px Arial;letter-spacing:.1em;color:#d8f86c}
  .cf-fotos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .cf-fotos figure{margin:0;border-radius:12px;overflow:hidden;background:#f6f7f1}
  .cf-fotos img{display:block;width:100%;height:170px;object-fit:contain}
  .cf-fotos figcaption{padding:5px 6px;background:#172218;color:#e6efe2;font:700 11px Arial;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cf-plegable{border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(0,0,0,.25);margin-bottom:10px}
  .cf-plegable summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;font:800 11px Arial;letter-spacing:.1em;color:#d4e1d0}
  .cf-plegable summary::-webkit-details-marker{display:none}
  .cf-plegable summary b{font:800 14px Arial;letter-spacing:0;color:#f4f8ef}
  .cf-plegable summary::after{content:"▾";color:#d8f86c;transition:transform .2s}
  .cf-plegable[open] summary::after{transform:rotate(180deg)}
  .cf-lista{display:grid;gap:6px;padding:0 10px 10px}
  .cf-opcion{min-height:38px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(255,255,255,.06);color:#f4f8ef;font:700 13px Arial;text-align:left;padding:0 12px;cursor:pointer}
  .cf-opcion:hover,.cf-opcion.on{background:rgba(208,244,76,.16);border-color:rgba(208,244,76,.7)}
  .cf-field{display:grid;gap:6px;font:800 11px Arial;letter-spacing:.08em;color:#d4e1d0;margin-bottom:10px}
  .cf-field input{height:42px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:#f4f8ef;font:700 14px Arial}
  .cf-resumen{background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px;margin:4px 0 10px}
  .cf-checks{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .cf-checks span{font:800 10px Arial;letter-spacing:.08em;padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:#c9d3c4}
  .cf-checks span.ok{background:rgba(139,212,80,.22);color:#d6f7b0}
  .cf-text{white-space:pre-wrap;margin:0;color:#f4f8ef;font:13px/1.45 Arial,sans-serif}
  .cf-acciones button{min-height:46px;width:100%;border:0;border-radius:12px;background:#d0f44c;color:#15200f;font:900 14px Arial;cursor:pointer}
  .cf-acciones{display:flex;flex-wrap:nowrap;gap:10px;align-items:stretch}
  .cf-acciones button{flex:1 1 0;min-width:0;padding:0 12px}
  .cf-acciones button:disabled{opacity:.4;cursor:not-allowed}
  .cf-status{min-height:20px;margin:10px 0 0;color:#d3f65a;font-weight:700;font-size:13px}
  .cf-tallas{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}
  .cf-talla{overflow:hidden;text-align:center;padding:12px 8px}
  .cf-talla::after{content:"";position:absolute;left:0;right:0;bottom:0;height:var(--n,0%);background:linear-gradient(180deg,rgba(139,212,80,.28),rgba(139,212,80,.08));transition:height .6s cubic-bezier(.2,.8,.2,1)}
  .cf-talla span,.cf-talla b{position:relative;display:block}
  .cf-talla span{font:800 11px Arial;letter-spacing:.12em;color:#c9d3c4}
  .cf-talla b{font:900 24px Arial;color:#fff}
  .cf-empty{margin:0;color:#becbbb;font-size:13px}
  .cf-obs-btn{margin:0 0 10px;padding:8px 14px;border-radius:999px;border:1px solid rgba(230,235,241,.4);background:rgba(230,235,241,.12);color:#f4f7fa;font:800 12px Arial;cursor:pointer}
  .cf-obs-btn:hover{background:rgba(230,235,241,.22)}
  .cf-obs-wrap{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .35s cubic-bezier(.2,.8,.2,1),opacity .3s ease,margin .35s ease;margin-bottom:0}
  .cf-obs-wrap.abierto{grid-template-rows:1fr;opacity:1;margin-bottom:10px}
  .cf-obs-inner{overflow:hidden;min-height:0}
  .cf-obs textarea{width:100%;min-height:70px;padding:10px 12px;border-radius:14px;border:1px solid rgba(230,235,241,.3);background:rgba(0,0,0,.28);color:#f4f7fa;font:14px Arial;resize:vertical;box-sizing:border-box}
  .cf-aviso-proyecto{margin:0 0 10px;padding:10px 12px;border-radius:12px;background:rgba(255,120,100,.14);border:1px solid rgba(255,140,120,.6);color:#ffd2c2;font:700 13px Arial}
  .cf-carga{min-height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;animation:cfCargaIn .35s ease both}
  .cf-carga-logo{display:block;width:min(260px,60vw);height:auto;margin:0 auto;filter:drop-shadow(0 0 18px rgba(230,235,241,.35));animation:cfCargaPulso 1.5s ease-in-out infinite}
  .cf-carga-barra{width:220px;height:4px;border-radius:99px;background:rgba(230,235,241,.12);overflow:hidden}
  .cf-carga-barra i{display:block;height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,transparent,#e6ebf1,transparent);animation:cfCargaCorre 1.1s ease-in-out infinite}
  .cf-carga p{margin:0;color:#b9c3cf;font:600 13px Arial}
  @keyframes cfCargaPulso{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.06);opacity:1}}
  @keyframes cfCargaCorre{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
  @keyframes cfCargaIn{from{opacity:0}to{opacity:1}}
  .cf-descargas{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
  .cf-descargas p{width:100%;margin:0 0 2px;color:#dfe6ee;font:600 12px Arial}
  .cf-descargas a{padding:8px 14px;border-radius:999px;border:1px solid rgba(230,235,241,.4);color:#f4f7fa;font:800 12px Arial;text-decoration:none;background:rgba(230,235,241,.12)}
  .cf-acciones button:not(:disabled){animation:cfPulse 2.6s ease-in-out infinite}
  @keyframes cfPulse{0%,100%{box-shadow:0 0 0 0 rgba(208,244,76,.45)}50%{box-shadow:0 0 0 9px rgba(208,244,76,0)}}
  .cf-confirm{position:fixed;inset:0;z-index:9999;background:rgba(5,10,6,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:14px;animation:cfFade .2s ease-out}
  .cf-modal{width:min(520px,100%);max-height:90vh;overflow:auto;border-radius:20px;padding:18px;background:linear-gradient(160deg,rgba(30,44,30,.97),rgba(14,22,15,.97));border:1px solid rgba(208,244,76,.35);box-shadow:0 24px 60px rgba(0,0,0,.5);animation:cfPop .28s cubic-bezier(.2,.8,.2,1)}
  .cf-modal h3{margin:0 0 12px;font:900 16px Arial;letter-spacing:.04em;color:#d8f86c}
  .cf-modal-datos{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .cf-modal-datos span{font:800 12px Arial;padding:6px 10px;border-radius:999px;background:rgba(139,212,80,.18);color:#d6f7b0}
  .cf-modal-fotos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-bottom:12px}
  .cf-modal-fotos img{width:100%;height:96px;object-fit:contain;border-radius:10px;background:#f6f7f1}
  .cf-modal .cf-text{background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px;max-height:240px;overflow:auto}
  .cf-modal-acc{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;margin-top:14px}
  .cf-modal-acc button{min-height:46px;border-radius:12px;font:900 14px Arial;cursor:pointer}
  .cf-modal-acc .cf-sec{background:transparent;border:1px solid rgba(255,255,255,.3);color:#e6efe2}
  .cf-modal-acc .cf-pri{border:0;background:#d0f44c;color:#15200f}
  @keyframes cfFade{from{opacity:0}to{opacity:1}}
  @keyframes cfPop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @media(max-width:700px){.confeccion-panel{padding:0}.cf-grid{grid-template-columns:1fr}.cf-fotos img{height:150px}}`;

  // Estilo de vidrio: sin bloques, botones transparentes y mockups más grandes
  const CSS_VIDRIO = `
  .confeccion-panel{padding:0 12px 14px}
  body:has(.confeccion-panel.active) .footer-note{display:none!important}
  .cf-shell{gap:16px}
  .cf-tabbar{background:none;border:0;padding:0}
  .cf-chip{background:rgba(255,255,255,.14);color:#f4f8ef;border:1px solid rgba(255,255,255,.35);border-radius:999px;backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 24px rgba(0,0,0,.25)}
  .cf-chip i{background:rgba(255,255,255,.18);color:#f4f8ef}
  .cf-cerrar{width:42px;height:42px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.35);backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 24px rgba(0,0,0,.25);transition:transform .2s,background .2s}
  .cf-cerrar{display:flex;align-items:center;justify-content:center;padding:0;line-height:1;color:#f4f8ef}
  .cf-cerrar svg{display:block;margin:0}
  .cf-cerrar:hover{transform:scale(1.06);background:rgba(255,255,255,.24)}
  .cf-card,.cf-box{background:none;border:0;box-shadow:none;padding:0;overflow:visible}
  .cf-card::before,.cf-box::before{display:none}
  .cf-card:hover{transform:none;box-shadow:none}
  .cf-datos{gap:12px;padding:0}
  .cf-datos .cf-dato{padding:0;background:none;border:0}
  .cf-dato small{font-size:10px;color:#c9d3c4}
  .cf-dato b{font-size:17px}
  .cf-grid{gap:20px}
  .cf-der,.cf-izq{padding:0}
  .cf-fotos{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .cf-fotos figure{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:22px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 12px 30px rgba(0,0,0,.25);padding:8px}
  .cf-fotos img{height:300px;background:transparent;border-radius:14px}
  .cf-fotos figcaption{background:none;color:#e6efe2;padding:6px 2px 0}
  .cf-plegable{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);border-radius:999px;backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 24px rgba(0,0,0,.2)}
  .cf-plegable[open]{border-radius:22px}
  .cf-plegable summary{padding:13px 20px}
  .cf-lista{padding:4px 12px 14px}
  .cf-opcion{border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.28);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
  .cf-opcion:hover,.cf-opcion.on{background:rgba(208,244,76,.24);border-color:rgba(208,244,76,.7)}
  .cf-field input{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:0 18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
  .cf-checks span{background:rgba(255,255,255,.12);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
  .cf-resumen{background:none;border:0;padding:0;margin:6px 0}
  .cf-text{background:none;border:0;padding:0;color:#f4f8ef}
  .cf-acciones button{min-height:52px;border-radius:999px;background:rgba(208,244,76,.86);color:#15200f;border:1px solid rgba(255,255,255,.55);backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 12px 30px rgba(208,244,76,.25)}
  .cf-tallas-mini .cf-talla{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);border-radius:999px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
  .cf-talla::after{display:none}
  .cf-modal{background:linear-gradient(160deg,rgba(40,58,40,.55),rgba(14,22,15,.55));backdrop-filter:blur(26px) saturate(1.6);-webkit-backdrop-filter:blur(26px) saturate(1.6);border:1px solid rgba(255,255,255,.3);border-radius:26px;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 24px 60px rgba(0,0,0,.45)}
  .cf-modal-acc button{border-radius:999px}
  .cf-modal-acc .cf-pri{background:rgba(208,244,76,.88);backdrop-filter:blur(14px)}
  .cf-modal-acc .cf-sec{background:rgba(255,255,255,.1);backdrop-filter:blur(14px)}
  .confeccion-panel{max-width:none;width:100%;box-sizing:border-box;padding:0 10px 12px}
  .cf-shell{max-width:none;width:100%}
  .cf-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px}
  .cf-izq{max-height:calc(100vh - 110px);overflow-y:auto;padding:0 6px 0 0}
  .cf-fotos{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .cf-fotos figure{position:relative;aspect-ratio:1/1;margin:0;padding:0;overflow:hidden;border-radius:22px}
  .cf-fotos img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:10px;box-sizing:border-box;border-radius:0}
  .cf-fotos figcaption{position:absolute;left:0;right:0;bottom:0;padding:18px 8px 8px;text-align:center;background:linear-gradient(transparent,rgba(0,0,0,.5));border-radius:0 0 22px 22px}
  .cf-cerrar{display:grid;place-items:center;line-height:1}
  .cf-chip,.cf-opcion,.cf-acciones button,.cf-modal-acc button{display:flex;align-items:center;justify-content:center;text-align:center}
  .cf-opcion{width:100%}
  .cf-plegable summary{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;min-height:46px;padding:0 44px}
  .cf-plegable summary::after{position:absolute;right:20px;top:50%;margin-top:-.55em}
  .cf-plegable summary span,.cf-plegable summary b{text-align:center}
  .cf-acciones button{min-height:52px;width:100%}
  .cf-datos .cf-dato{text-align:center}
  .cf-tallas-mini .cf-talla{display:flex;flex-direction:column;align-items:center;justify-content:center}
  .cf-fotos{grid-template-columns:repeat(var(--cols,3),var(--cell,220px));justify-content:start}
  .cf-fotos figure{width:var(--cell,220px);height:var(--cell,220px)}
  .cf-fotos img{padding:6px}
  @media(max-width:700px){.cf-grid{grid-template-columns:1fr}.cf-izq{max-height:none}.cf-fotos img{padding:6px}}`;

  function activate() {
    // Guarda la vista desde la que se abrió, para volver a ella con la X
    if (!panel.classList.contains('active')) {
      anterior = {
        panel: document.querySelector('.panel.active'),
        tab: document.querySelector('.tab.active'),
        body: [...document.body.classList].filter(c => /-mode$/.test(c))
      };
    }
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode');
  }

  function mount() {
    if (panel) return;
    window.addEventListener('resize', () => ajustarMockups());
    panel = document.createElement('section');
    panel.className = 'panel confeccion-panel';
    panel.dataset.panel = 'confeccion';
    document.querySelector('main')?.appendChild(panel);
    const css = document.createElement('style');
    css.textContent = CSS + CSS_VIDRIO;
    document.head.appendChild(css);
  }

  function cerrar() {
    if (!panel) return;
    const vuelta = anterior || {panel: document.querySelector('.panel[data-panel="produccion"]'), tab: document.querySelector('.tab[data-kind="produccion"]'), body: ['production-mode']};
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === vuelta.panel));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === vuelta.tab));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode');
    vuelta.body.forEach(c => document.body.classList.add(c));
    anterior = null;
  }

  async function cargar() {
    selected = await api(`/api/produccion/fila/${selectedRow}/confeccion`);
    mockupBlob = null;
    mockupsBlob().then(b => { mockupBlob = b; }).catch(() => { mockupBlob = null; });
    const prep = selected.preparacion || {};
    pedido = {
      maker: prep.confeccionista || '',
      phone: (selected.whatsapps || {})[prep.confeccionista] || '',
      price: Number(prep.precio_prenda) || 0,
      observaciones: ''
    };
  }

  function details() {
    if (!selected) return '<p class="cf-empty">Elige una orden o abre este panel desde el botón de Confección en la tarjeta.</p>';
    const fotos = (selected.mockups || []).map(m =>
      `<figure><img src="${esc(m.url)}" alt="${esc(m.name || 'Mockup')}" loading="lazy"><figcaption>${esc(m.name || 'Mockup')}</figcaption></figure>`).join('')
      || '<p class="cf-empty">Esta orden todavía no tiene mockups.</p>';
    const max = Math.max(1, ...(selected.curva || []).map(x => Number(x.cantidad) || 0));
    const tallas = (selected.curva || []).map(x =>
      `<div class="cf-card cf-talla" style="--n:${Math.round((Number(x.cantidad) || 0) / max * 100)}%"><span>${esc(x.talla)}</span><b>${esc(x.cantidad)}</b></div>`).join('')
      || `<p class="cf-empty">${esc(selected.curva_error || 'No hay curva disponible.')}</p>`;
    const opciones = (selected.confeccionistas || []).map(n =>
      `<button type="button" class="cf-opcion" data-pick="${esc(n)}">${esc(n)}</button>`).join('')
      || '<p class="cf-empty">No hay confeccionistas registradas.</p>';
    const datos = [['CLIENTE', selected.cliente], ['ORDEN', selected.orden], ['REFERENCIA', selected.referencia], ['CANTIDAD', selected.cantidad]];
    const avisoProyecto = selected.proyecto_error ? `<p class="cf-aviso-proyecto" role="alert">⚠ ${esc(selected.proyecto_error)}</p>` : '';
    return `${avisoProyecto}<div class="cf-datos">${datos.map(([k, v]) => `<div class="cf-card cf-dato"><small>${k}</small><b>${esc(v || '—')}</b></div>`).join('')}</div>
      <div class="cf-grid">
        <section class="cf-box cf-izq"><div class="cf-fotos">${fotos}</div></section>
        <section class="cf-box cf-der">
          <div class="cf-tallas cf-tallas-mini">${tallas}</div>
          <details class="cf-plegable" data-plegable>
            <summary><span>CONFECCIONISTA</span><b data-maker-txt>${esc(pedido.maker || 'Elegir')}</b></summary>
            <div class="cf-lista">${opciones}</div>
          </details>
          <label class="cf-field">WHATSAPP DE LA CONFECCIONISTA<input data-phone type="tel" value="${esc(pedido.phone)}"></label>
          <label class="cf-field">PRECIO POR PRENDA (COP)<input data-price inputmode="numeric" placeholder="Ej. 18,000" value="${pedido.price ? esc(pedido.price.toLocaleString('en-US')) : ''}"></label>
          <button type="button" class="cf-obs-btn" data-obs-btn>+ Agregar observaciones</button>
          <div class="cf-obs-wrap" data-obs-caja><div class="cf-obs-inner"><label class="cf-field cf-obs">OBSERVACIONES<textarea data-obs rows="3" placeholder="Ej. lleva dobladillo en sisas y cuellos">${esc(pedido.observaciones || '')}</textarea></label></div></div>
          <div class="cf-checks" data-checks></div>
          <div class="cf-resumen"><pre class="cf-text" data-resumen></pre></div>
          <div class="cf-acciones"><button type="button" data-send>Enviar a confección</button><button type="button" class="cf-sec" data-registro>Registra en contabilidad</button></div>
          <p class="cf-status" data-status aria-live="polite"></p>
        </section>
      </div>
      `;
  }

  // Mockups cuadrados: tamaño según el ancho y el alto disponibles. Con muchos se achican
  // (sin bajar de 110 px) y la columna se desplaza verticalmente.
  function ajustarMockups() {
    const caja = panel?.querySelector('.cf-fotos');
    const n = caja ? caja.children.length : 0;
    if (!n) return;
    // Pocos mockups: columnas = cantidad (se ven grandes). Muchos: 3 por fila y se achican.
    const gap = 12, cols = Math.min(n, 3), filas = Math.ceil(n / cols), visibles = Math.min(filas, 2);
    const ancho = caja.clientWidth;
    const alto = Math.max(160, window.innerHeight - caja.getBoundingClientRect().top - 24);
    const porAncho = (ancho - gap * (cols - 1)) / cols;
    const porAlto = (alto - gap * (visibles - 1)) / visibles;
    caja.style.setProperty('--cols', cols);
    caja.style.setProperty('--cell', Math.floor(Math.max(110, Math.min(porAncho, porAlto))) + 'px');
  }

  function render() {
    const rows = (production?.rows || []).filter(r => field(r, 'ORDEN'));
    const selector = selectedRow ? '' : `<label class="cf-field">ORDEN<select data-order><option value="">Selecciona una orden</option>${rows.map(r =>
      `<option value="${r.source_row}">${esc([field(r, 'ORDEN'), field(r, 'REFERENCIA'), field(r, 'NOMBRE DEL CLIENTE')].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>`;
    panel.innerHTML = `<div class="cf-shell"><div class="cf-tabbar"><span class="cf-chip"><i>CF</i>CONFECCIÓN</span><button type="button" class="cf-cerrar" data-close aria-label="Cerrar" title="Cerrar"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg></button></div>${selector}<div data-detail>${details()}</div></div>`;
    panel.querySelector('[data-close]').onclick = cerrar;
    bind();
    ajustarMockups();
  }

  function listo() {
    const digitos = pedido.phone.replace(/\D/g, '');
    return Boolean(pedido.maker) && digitos.length >= 7 && pedido.price > 0;
  }

  // Se actualiza en cada cambio: el resumen, las comprobaciones y el botón.
  function actualizar() {
    if (!panel || !selected) return;
    const resumen = panel.querySelector('[data-resumen]');
    if (resumen) resumen.textContent = mensaje(pedido.maker, pedido.price);
    const checks = panel.querySelector('[data-checks]');
    if (checks) {
      const digitos = pedido.phone.replace(/\D/g, '').length >= 7;
      checks.innerHTML = [['Confeccionista', Boolean(pedido.maker)], ['WhatsApp', digitos], ['Precio', pedido.price > 0]]
        .map(([nombre, ok]) => `<span class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${nombre}</span>`).join('');
    }
    const boton = panel.querySelector('[data-send]');
    if (boton) boton.disabled = !listo();
  }

  function bind() {
    panel.querySelector('[data-order]')?.addEventListener('change', async e => {
      selectedRow = Number(e.target.value) || null;
      selected = null;
      mockupBlob = null;
      if (!selectedRow) { render(); return; }
      try { await cargar(); render(); }
      catch (error) { panel.querySelector('[data-detail]').innerHTML = `<p class="cf-empty">${esc(error.message)}</p>`; }
    });
    if (!selected) return;
    const plegable = panel.querySelector('[data-plegable]');
    panel.querySelectorAll('[data-pick]').forEach(boton => {
      boton.onclick = () => {
        const nombre = boton.dataset.pick;
        pedido.maker = nombre;
        pedido.phone = (selected.whatsapps || {})[nombre] || '';
        panel.querySelector('[data-maker-txt]').textContent = nombre;
        panel.querySelector('[data-phone]').value = pedido.phone;
        panel.querySelectorAll('[data-pick]').forEach(b => b.classList.toggle('on', b === boton));
        plegable.open = false;
        actualizar();
      };
      boton.classList.toggle('on', boton.dataset.pick === pedido.maker);
    });
    panel.querySelector('[data-phone]').oninput = e => { pedido.phone = e.target.value; actualizar(); };
    panel.querySelector('[data-price]').oninput = e => {
      // Solo dígitos; se vuelven a escribir con comas mientras se escribe
      pedido.price = Number(String(e.target.value).replace(/\D/g, '')) || 0;
      e.target.value = pedido.price ? pedido.price.toLocaleString('en-US') : '';
      actualizar();
    };
    const obsBtn = panel.querySelector('[data-obs-btn]'), obsCaja = panel.querySelector('[data-obs-caja]'), obsCampo = panel.querySelector('[data-obs]');
    if (pedido.observaciones) obsCaja.classList.add('abierto');
    obsBtn.onclick = () => { obsCaja.classList.toggle('abierto'); if (obsCaja.classList.contains('abierto')) setTimeout(() => obsCampo.focus(), 250); };
    obsCampo.oninput = e => { pedido.observaciones = e.target.value; actualizar(); };
    panel.querySelector('[data-send]').onclick = () => confirmar();
    panel.querySelector('[data-registro]').onclick = () => registrarContabilidad();
    actualizar();
  }

  // Una sola confirmación: muestra el resumen de lo que se enviará y, al confirmar, envía.
  function confirmar() {
    if (!listo() || !selected) return;
    document.querySelector('.cf-confirm')?.remove();
    const fotos = (selected.mockups || []).map(m => `<img src="${esc(m.url)}" alt="${esc(m.name || 'Mockup')}">`).join('');
    const ov = document.createElement('div');
    ov.className = 'cf-confirm';
    ov.innerHTML = `<div class="cf-modal" role="dialog" aria-modal="true" aria-label="Confirmar envío a confección">
      <h3>Confirmar envío a confección</h3>
      <div class="cf-modal-datos">
        <span>${esc(pedido.maker)}</span><span>${esc(pedido.phone)}</span><span>${esc(pesos(pedido.price))} por prenda</span>
      </div>
      <div class="cf-modal-fotos">${fotos}</div>
      <pre class="cf-text">${esc(mensaje(pedido.maker, pedido.price))}</pre>
      <div class="cf-modal-acc">
        <button type="button" class="cf-sec" data-cancel>Cancelar</button>
        <button type="button" class="cf-pri" data-ok>Confirmar y enviar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const cerrar = () => {
      ov.remove();
      document.removeEventListener('keydown', alTecla);
    };
    const alTecla = e => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alTecla);
    ov.addEventListener('click', e => { if (e.target === ov) cerrar(); });
    ov.querySelector('[data-cancel]').onclick = cerrar;
    ov.querySelector('[data-ok]').onclick = () => { cerrar(); enviar(); };
    ov.querySelector('[data-ok]').focus();
  }

  // Si WhatsApp no adjunta el mockup, la persona lo descarga desde aquí y lo adjunta a mano
  function mostrarDescargas(urls) {
    panel.querySelector('.cf-descargas')?.remove();
    if (!urls.length) return;
    const caja = document.createElement('div');
    caja.className = 'cf-descargas';
    caja.innerHTML = '<p>Si WhatsApp no adjuntó el mockup, descárgalo y adjúntalo a mano:</p>' +
      urls.map((u, i) => '<a href="' + esc(u) + '" download="mockup-' + (i + 1) + '.jpg" target="_blank" rel="noopener">Descargar mockup ' + (i + 1) + '</a>').join('');
    panel.querySelector('.cf-acciones')?.insertAdjacentElement('afterend', caja);
  }

  // Registra la producción en Contabilidad Confección a esta confeccionista (sin enviar WhatsApp)
  async function registrarContabilidad() {
    const status = panel.querySelector('[data-status]');
    const boton = panel.querySelector('[data-registro]');
    if (!selected || !selectedRow) return;
    if (!listo()) { status.textContent = 'Falta la confeccionista, el WhatsApp o el precio por prenda para registrar.'; return; }
    const {maker, phone, price} = pedido;
    const orden = selected.orden || '';
    const unidades = Number(selected.cantidad) || 0;
    boton.disabled = true;
    status.textContent = 'Registrando en contabilidad…';
    try {
      const r = await api('/api/confeccion/envios', {method: 'POST', body: JSON.stringify({
        source_row: selectedRow, orden, referencia: selected.referencia || '', cliente: selected.cliente || '',
        confeccionista: maker, whatsapp: phone, unidades, precio: Number(price) || 0,
        mensaje_id: 'manual|' + orden + '|' + (selected.referencia || '') + '|' + maker
      })});
      status.textContent = r.duplicado
        ? 'Esta producción ya estaba registrada en la contabilidad de ' + maker + '.'
        : 'Registrada en la contabilidad de ' + maker + ': ' + orden + ' · ' + unidades + ' und.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      boton.disabled = false;
    }
  }

  async function enviar() {
    const status = panel.querySelector('[data-status]');
    const boton = panel.querySelector('[data-send]');
    const {maker, phone, price} = pedido;
    const texto = mensaje(maker, price);
    // Respaldo: el mockup va al portapapeles en el mismo clic, por si la extensión no está instalada
    if (mockupBlob && navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({'image/png': mockupBlob})]).catch(() => {});
    }
    boton.disabled = true;
    status.textContent = 'Guardando preparación…';
    try {
      await api(`/api/produccion/fila/${selectedRow}/confeccion`, {method: 'POST', body: JSON.stringify({confeccionista: maker, whatsapp: phone, precio_prenda: price})});
    } catch (error) {
      boton.disabled = !listo();
      status.textContent = error.message;
      return;
    }
    // Extensión de WhatsApp: abre el chat en la pestaña de WhatsApp Web y adjunta los mockups (sin enviar)
    const digitos = phone.replace(/\D/g, '');
    const intl = digitos.startsWith('57') ? digitos : '57' + digitos;
    const mockups = (selected.mockups || []).map(m => new URL(m.share_url || m.url, location.origin).href);
    let contestado = false;
    const alResultado = e => {
      contestado = true;
      boton.disabled = !listo();
      window.removeEventListener('indoor:whatsapp-confeccion:resultado', alResultado);
      const d = e.detail || {};
      status.textContent = d.ok
        ? `Chat listo con el texto y ${d.attached || 0} mockup(s) adjuntos. Revisa y pulsa Enviar en WhatsApp.`
        : (/Abre primero WhatsApp Web/i.test(d.error || '')
          ? 'WhatsApp Web no está abierto en este Chrome. Ábrelo con el WhatsApp de confección y vuelve a pulsar Enviar a confección.'
          : (d.error || 'No se pudo preparar el chat.') + ' Si lo necesitas, pega el mockup con Ctrl+V.');
      if (!d.ok || !(d.attached > 0)) mostrarDescargas(mockups);
    };
    window.addEventListener('indoor:whatsapp-confeccion:resultado', alResultado);
    const registro = {source_row: selectedRow, orden: selected.orden || '', referencia: selected.referencia || '', cliente: selected.cliente || '', confeccionista: maker, whatsapp: intl, unidades: Number(selected.cantidad) || 0, precio: Number(price) || 0};
    window.dispatchEvent(new CustomEvent('indoor:whatsapp-confeccion', {detail: {phone: intl, nombre: maker, text: texto, mockups, registro}}));
    status.textContent = 'Preparando el chat en WhatsApp…';
    // La extensión espera a que WhatsApp cargue: si tarda, el aviso se actualiza cuando responda
    setTimeout(() => {
      if (contestado) return;
      boton.disabled = !listo();
      status.textContent = 'WhatsApp todavía no confirma los mockups. Revisa el chat; si el mockup no aparece, usa los enlaces de abajo.';
      mostrarDescargas(mockups);
    }, 45000);
  }

  // Vincula la extensión de WhatsApp: le entrega un token para registrar envíos sin abrir el panel
  api('/api/confeccion/token').then(r => window.dispatchEvent(new CustomEvent('indoor:confeccion-token', {detail: {token: r.token}}))).catch(() => {});

  // Animación mientras se abre Confección desde la tarjeta (carga la orden, mockups y curva)
  const CARGA_HTML = '<div class="cf-carga" role="status" aria-label="Cargando Confección"><img class="cf-carga-logo" src="/marca-indoor.svg" alt="Indoor Sport"><div class="cf-carga-barra"><i></i></div><p>Cargando la orden…</p></div>';

  async function open(row) {
    mount();
    activate();
    panel.innerHTML = CARGA_HTML;
    selectedRow = Number(row) || null;
    selected = null;
    mockupBlob = null;
    try {
      production = await api('/api/produccion');
      if (selectedRow) await cargar();
    } catch (error) {
      panel.innerHTML = `<p class="cf-empty">${esc(error.message)}</p>`;
      return;
    }
    render();
  }

  window.addEventListener('indoor:preparar-confeccion', e => open(e.detail?.row));
  document.addEventListener('DOMContentLoaded', () => {
    mount();
  });
})();
