/* AGENTES: canal de comunicación con TAVO y los agentes de edición (los que corren en el PC con Illustrator).
   El panel solo guarda la conversación; el PC la recoge, ejecuta a los agentes y devuelve la respuesta. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORES = { TAVO: '#7da4ff', LEO: '#b794ff', JACK: '#ffcf5c', OLVER: '#6fe39a', OLIVER: '#ff8fd0', TERRY: '#6ee0e0' };
  const ROLES = { TAVO: 'Coordina', LEO: 'Lee el listado', JACK: 'Muestra PDF', OLVER: 'Exporta mesas', OLIVER: 'Valida tallas', TERRY: 'Google Sheets' };
  const ATAJOS = [['Ver listado', 'Qué dice el listado de la orden '], ['Exportar mesas', 'Expórtame las mesas de trabajo de la orden '], ['Crear muestra', 'Crea la muestra de la orden '],
    ['Pedido completo', 'Pedido completo de la orden '], ['Jugadores', 'jugadores'], ['Reiniciar', 'cancelar']];
  const st = { orden: '', cambiandoOrden: false, abiertos: {}, msgs: [], ultimo: 0, evs: [], ultimoEv: 0, esperando: false, trabajo: null, estado: { conectado: false }, cargando: false, enviando: false };
  let panel, tab, timer = 0;

  async function api(url, options) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let data = null;
    try { data = await response.json(); } catch (e) { /* sin cuerpo JSON */ }
    if (!response.ok) throw new Error((data && data.detail) || 'No fue posible completar la acción');
    return data;
  }
  const hora = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };
  const tag = a => '<span class="ag-tag" style="--c:' + (COLORES[a] || '#c4cfbf') + '">' + esc(a) + '</span>';

  const css = document.createElement('style');
  css.textContent = `
  .tab[data-kind='agentes'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='agentes']){display:none!important}}
  body:has(.panel[data-panel='agentes'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important;padding-top:10px!important}
  .ag{display:grid;gap:12px;width:100%;max-width:none;margin:0}.ag button{width:auto}
  .ag-head{width:100%;max-width:none!important;box-sizing:border-box;margin:0;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;padding:22px;border:1px solid #2d3b4a;border-radius:18px;background:linear-gradient(135deg,#131c27,#11150f)}
  .ag-head span.k{color:#7da4ff;font:900 10px Arial;letter-spacing:.12em}.ag-head h2{margin:4px 0;font-size:1.6rem}.ag-head p{margin:0;color:#aebba7;font-size:.9rem}
  .ag-btn{min-height:40px;padding:0 16px;border:0;border-radius:10px;background:#d0f44c;color:#142017;font:800 13px Arial;cursor:pointer}.ag-btn.sec{background:transparent;border:1px solid #60754d;color:#e3eadc}.ag-btn:disabled{opacity:.6;cursor:progress}
  .ag-state{display:flex;gap:8px;flex-wrap:wrap}.ag-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border:1px solid #34432f;border-radius:999px;background:#0c110d;color:#c4cfbf;font:700 12px Arial}
  .ag-pill i{width:8px;height:8px;border-radius:50%;background:var(--c,#8f9b8a)}.ag-pill.ok{--c:#8bd450}.ag-pill.mal{--c:#ff6b5c}.ag-pill.sim{--c:#ffc95c}
  .ag-warn{padding:14px 16px;border:1px solid rgba(255,106,90,.5);border-radius:14px;background:rgba(255,106,90,.08);color:#ffc7bf;font-size:.9rem;line-height:1.45}
  .ag-chat{display:grid;grid-template-rows:auto minmax(0,1fr) auto auto auto;min-height:0;gap:12px;padding:18px;border:1px solid #2d3b2f;border-radius:18px;background:#0f1410}
  .ag-thread{display:grid;gap:12px;align-content:start;min-height:0;max-height:none;overflow:auto;padding-right:6px}
  .ag-empty{padding:34px 10px;text-align:center;color:#8f9b8a}.ag-empty h3{margin:0 0 8px;color:#e3eadc}
  .ag-msg{display:grid;gap:8px;max-width:86%;padding:13px 15px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(150deg,#1a221a,#10140f);font-size:.92rem;line-height:1.5}
  .ag-msg.yo{justify-self:end;border-color:rgba(208,244,76,.4);background:linear-gradient(150deg,#26331a,#141b10)}
  .ag-msg.bot{justify-self:start;border-left:4px solid #7da4ff}.ag-msg.bot.err{border-left-color:#ff6b5c}
  .ag-msg.bot.con-tabla{max-width:100%;width:100%;box-sizing:border-box}
  .ag-tbl{display:grid;gap:8px}.ag-tbl-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.ag-tbl-head b{font-size:.86rem;color:#e3eadc}
  .ag-tbl-head span{display:flex;gap:6px}.ag-tbl-head button{min-height:0;padding:6px 12px;border:1px solid #60754d;border-radius:8px;background:transparent;color:#d0f44c;font:800 11px Arial;cursor:pointer}
  .ag-tbl-wrap{overflow-x:auto;overflow-y:visible;border:1px solid #34432f;border-radius:12px;background:#0c110d}
  .ag-tbl table{border-collapse:collapse;width:100%;font-size:.84rem}
  .ag-tbl th{position:sticky;top:0;z-index:1;padding:9px 12px;background:#1d281b;color:#d0f44c;text-align:left;font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;border-bottom:2px solid #3d4f3d}
  .ag-tbl td{padding:8px 12px;border-top:1px solid #243024;color:#eef4e9;white-space:nowrap}.ag-tbl tbody tr:nth-child(even){background:rgba(255,255,255,.035)}.ag-tbl tbody tr:hover{background:rgba(208,244,76,.08)}
  .ag-tbl .n{width:1%;color:#8f9b8a;text-align:right}.ag-tbl .v{color:#5f6b5e}
  html.theme-light .ag-tbl th{background:#e9efe2;color:#3f6a10}html.theme-light .ag-tbl td{color:#18210f;border-color:#dfe6d7}html.theme-light .ag-tbl-wrap{background:#fff;border-color:#cdd8c6}
  .ag-main{display:grid;grid-template-columns:minmax(360px,32%) minmax(0,1fr);gap:14px;align-items:stretch;height:calc(100vh - 300px);min-height:560px}
  .ag-flowcol{display:grid;grid-template-rows:minmax(0,1.5fr) minmax(0,1fr);gap:14px;min-height:0}
  .ag-lienzo{position:relative;height:auto;min-height:0;overflow:hidden;border:1px solid #2d3b2f;border-radius:16px;background-color:#0c110d;background-image:radial-gradient(#26322a 1.2px,transparent 1.2px);background-size:20px 20px}
  .ag-barra{position:absolute;top:12px;left:14px;right:14px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:3;pointer-events:none}
  .ag-ftit{padding:5px 11px;border:1px solid #34432f;border-radius:9px;background:#111611;font:700 13px Arial;color:#eef4e9}.ag-ftit small{margin-left:6px;color:#8f9b8a;font-weight:500}
  .ag-pildora{display:flex;align-items:center;gap:7px;padding:4px 12px;border:1px solid #34432f;border-radius:999px;background:#111611;font:700 12px Arial;color:#aebba7}.ag-pildora i{width:8px;height:8px;border-radius:50%;background:#4a5a47}
  .ag-pildora.corriendo{color:#7da4ff;border-color:#7da4ff}.ag-pildora.corriendo i{background:#7da4ff;animation:agpul 1s infinite}
  .ag-pildora.espera{color:#ffc95c;border-color:#ffc95c}.ag-pildora.espera i{background:#ffc95c;animation:agpul 1.4s infinite}
  .ag-pildora.ok{color:#8bd450;border-color:#8bd450}.ag-pildora.ok i{background:#8bd450}.ag-pildora.error{color:#ff6b5c;border-color:#ff6b5c}.ag-pildora.error i{background:#ff6b5c}
  svg.ag-cables{position:absolute;inset:0;width:100%;height:100%;z-index:1;overflow:visible}
  .ag-cable{fill:none;stroke:#3a4a38;stroke-width:2}.ag-cable.hecho{stroke:#8bd450;stroke-width:2.6}.ag-cable.vivo{stroke:#7da4ff;stroke-width:2.8;stroke-dasharray:7 7;animation:agfluir .6s linear infinite}
  @keyframes agfluir{to{stroke-dashoffset:-14}}@keyframes agpul{50%{opacity:.35}}@keyframes aggirar{to{transform:rotate(360deg)}}@keyframes aglate{50%{box-shadow:0 0 0 6px color-mix(in srgb,#ffc95c 25%,transparent)}}
  .ag-nodo{position:absolute;z-index:2;width:var(--tam,68px);height:var(--tam,68px);cursor:pointer;outline:none;--c:#7da4ff}
  .ag-nodo .cj{position:absolute;inset:0;display:grid;place-items:center;background:#131a14;border:2px solid #34432f;border-radius:16px;font-size:calc(var(--tam,68px)*.42);transition:border-color .25s,box-shadow .25s,transform .25s;box-shadow:0 2px 8px -4px rgba(0,0,0,.6)}
  .ag-nodo .cj::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:4px;border-radius:0 3px 3px 0;background:var(--c)}
  .ag-nodo:hover .cj,.ag-nodo:focus-visible .cj{transform:translateY(-2px)}.ag-nodo.sel .cj{box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 40%,transparent)}
  .ag-nodo .et{position:absolute;top:calc(var(--tam,68px) + 6px);left:50%;transform:translateX(-50%);width:128px;text-align:center;line-height:1.25}
  .ag-nodo .et b{display:block;font-size:13px;color:#eef4e9}.ag-nodo .et small{display:block;color:#8f9b8a;font-size:11px}.ag-nodo .et em{display:block;min-height:14px;font-style:normal;font-size:11px;color:#aebba7}
  .ag-nodo .puerto{position:absolute;top:calc(var(--tam,68px)/2 - 4px);width:8px;height:8px;border-radius:50%;background:#4a5a47;border:2px solid #0c110d}.ag-nodo .puerto.in{left:-5px}.ag-nodo .puerto.out{right:-5px}
  .ag-nodo .ins{position:absolute;right:-8px;bottom:-8px;width:22px;height:22px;border-radius:50%;display:none;place-items:center;color:#10150e;font:800 12px Arial;border:2px solid #0c110d}
  .ag-nodo .anillo{position:absolute;inset:-5px;border-radius:20px;border:3px solid transparent;border-top-color:#7da4ff;display:none;animation:aggirar .9s linear infinite}
  .ag-nodo.corriendo .cj{border-color:#7da4ff;box-shadow:0 0 0 4px rgba(125,164,255,.22)}.ag-nodo.corriendo .anillo{display:block}
  .ag-nodo.ok .cj{border-color:#8bd450}.ag-nodo.ok .ins{display:grid;background:#8bd450}.ag-nodo.ok .ins::after{content:"✓"}
  .ag-nodo.error .cj{border-color:#ff6b5c}.ag-nodo.error .ins{display:grid;background:#ff6b5c}.ag-nodo.error .ins::after{content:"!"}
  .ag-nodo.espera .cj{border-color:#ffc95c;animation:aglate 1.4s ease-in-out infinite}.ag-nodo.espera .ins{display:grid;background:#ffc95c}.ag-nodo.espera .ins::after{content:"…"}
  .ag-nodo.inactivo{opacity:.78}
  .ag-detalle{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;border:1px solid #2d3b2f;border-radius:16px;background:#0f1410;overflow:hidden}
  .ag-detalle header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #243024}
  .ag-detalle h3{margin:0;font:800 11px Arial;text-transform:uppercase;letter-spacing:.09em;color:#8f9b8a}
  .ag-filtros{display:flex;gap:5px;flex-wrap:wrap}.ag-filtros button{min-height:0;padding:2px 10px;border:1px solid #34432f;border-radius:999px;background:transparent;color:#aebba7;font:700 11px Arial;cursor:pointer}.ag-filtros button.on{background:#e3eadc;color:#10150e;border-color:#e3eadc}
  .ag-log{height:auto;min-height:0;overflow:auto;margin:10px 12px 12px;padding:9px 11px;border-radius:9px;background:#080b08;color:#d6dae2;font:12px/1.6 Consolas,ui-monospace,monospace}
  .ag-log div{white-space:pre-wrap;word-break:break-word}.ag-log .h{opacity:.45;margin-right:7px}.ag-log b{margin-right:6px}.ag-log .vacio2{opacity:.45}.ag-log .WARN .m{color:#ffbd66}.ag-log .ERROR .m{color:#ff8a8a}
  @media(max-width:1000px){.ag-main{grid-template-columns:1fr;height:auto;min-height:0}.ag-flowcol{grid-template-rows:auto auto}.ag-lienzo{height:380px}.ag-log{height:200px}.ag-chat{grid-template-rows:auto auto auto auto auto}.ag-thread{height:62vh;min-height:300px;max-height:none}}
  .ag-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
  .ag-file{--fc:#ffcf5c;display:grid;gap:9px;padding:12px;border:1px solid #34432f;border-left:4px solid var(--fc);border-radius:12px;background:#0c110d}.ag-file.mesa{--fc:#6fe39a}.ag-file.abierto{grid-column:1/-1}
  .ag-file-head{display:flex;gap:10px;align-items:center}.ag-fico{font-size:1.7rem;line-height:1}.ag-file-head b{display:block;font-size:.92rem;color:#eef4e9}.ag-file-head small{display:block;color:#8f9b8a;font-size:.72rem;overflow-wrap:anywhere}
  .ag-prev{display:block;width:100%;height:min(52vh,460px);border:1px solid #34432f;border-radius:8px;background:#fff}img.ag-prev{height:auto;max-height:460px;object-fit:contain}
  .ag-file-acc{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.ag-file-acc button,.ag-file-acc a{min-height:0;padding:6px 12px;border:1px solid #60754d;border-radius:8px;background:transparent;color:#d0f44c;font:800 11px Arial;text-decoration:none;cursor:pointer}.ag-file-acc .nopre{color:#8f9b8a;font-size:.74rem}
  html.theme-light .ag-file{background:#f6f8f2;border-color:#cdd8c6}html.theme-light .ag-file-head b{color:#18210f}
  .ag-orden{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 12px;border:1px solid #34432f;border-radius:12px;background:#0c110d}
  .ag-orden form{display:flex;gap:8px;align-items:center;flex:1 1 260px;margin:0}.ag-orden label{font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase;color:#aebba7;white-space:nowrap}
  .ag-orden input{flex:1;min-width:110px;min-height:38px;box-sizing:border-box;padding:7px 12px;border:1px solid #60754d;border-radius:10px;background:#142017;color:#f5faef;font:800 14px Arial;letter-spacing:.04em;text-transform:uppercase}.ag-orden input:focus{outline:none;border-color:#d0f44c}
  .ag-orden small{flex-basis:100%;color:#8f9b8a;font-size:.74rem;line-height:1.4}
  .ag-ochip{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border:1px solid #d0f44c;border-radius:999px;background:rgba(208,244,76,.1);color:#e3eadc;font:700 12px Arial}.ag-ochip b{color:#d0f44c;font-size:1rem;letter-spacing:.04em}
  .ag-orden .ag-btn{min-height:36px;padding:0 14px}
  .ag-who{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.ag-tag{padding:2px 9px;border-radius:999px;font:900 10px Arial;letter-spacing:.06em;color:var(--c);background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
  .ag-txt{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:#eef4e9}.ag-time{color:#8f9b8a;font-size:.7rem}
  .ag-work{display:grid;gap:10px;justify-self:start;max-width:86%;padding:14px 16px;border:1px solid rgba(125,164,255,.45);border-radius:16px;background:rgba(125,164,255,.07)}
  .ag-work b{font-size:.9rem}.ag-work small{color:#aebba7;font-size:.8rem}.ag-flow{display:flex;gap:6px;flex-wrap:wrap}
  .ag-dots{display:inline-flex;gap:4px;margin-left:6px}.ag-dots i{width:6px;height:6px;border-radius:50%;background:#7da4ff;animation:agp 1s infinite}.ag-dots i:nth-child(2){animation-delay:.15s}.ag-dots i:nth-child(3){animation-delay:.3s}@keyframes agp{0%,80%,100%{opacity:.25}40%{opacity:1}}
  .ag-chips{display:flex;gap:8px;flex-wrap:wrap}.ag-chips button{min-height:0;padding:8px 14px;border:1px solid #60754d;border-radius:999px;background:transparent;color:#d0f44c;font:800 12px Arial;cursor:pointer}.ag-chips button.reply{background:#d0f44c;color:#142017;border-color:#d0f44c}.ag-chips button:disabled{opacity:.5}
  .ag-form{display:flex;gap:10px;align-items:flex-end}.ag-form textarea{flex:1;min-height:44px;max-height:140px;box-sizing:border-box;padding:11px 14px;border:1px solid #3d4f3d;border-radius:12px;background:#0c110d;color:#f1f7ed;font:600 14px Arial;resize:none}.ag-form textarea:focus{outline:none;border-color:#d0f44c}
  .ag-form .ag-btn{min-height:44px}
  .ag-team{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.ag-card{display:grid;gap:3px;padding:12px;border:1px solid #34432f;border-top:3px solid var(--c);border-radius:12px;background:#10150f}.ag-card b{color:var(--c);font-size:.9rem}.ag-card small{color:#aebba7;font-size:.74rem}
  dialog.ag-dlg{width:min(560px,94vw);padding:0;border:1px solid #3d4f3d;border-radius:18px;background:#111611;color:#eef4e9}dialog.ag-dlg::backdrop{background:rgba(0,0,0,.65)}
  .ag-dlg .b{display:grid;gap:12px;padding:22px}.ag-dlg h2{margin:0}.ag-dlg code{display:block;padding:10px 12px;border-radius:10px;background:#0c110d;border:1px solid #34432f;color:#d0f44c;font:600 12px Consolas,monospace;overflow-wrap:anywhere}
  .ag-dlg ol{margin:0;padding-left:20px;color:#c4cfbf;font-size:.88rem;line-height:1.6}.ag-dlg .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  html.theme-light .ag-msg,html.theme-light .ag-chat,html.theme-light dialog.ag-dlg{background:#fff;color:#18210f;border-color:#cdd8c6}html.theme-light .ag-txt{color:#18210f}
  @media(max-width:700px){.ag-work{max-width:100%}.ag-btn{min-height:46px}dialog.ag-dlg{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0}}
  @media(max-width:700px){
    .ag{gap:10px}
    .ag-head{padding:14px 16px;gap:10px;border-radius:14px}.ag-head h2{margin:2px 0;font-size:1.25rem}.ag-head p{display:none}.ag-head>div:last-child{width:100%}.ag-head>div:last-child .ag-btn{flex:1 1 0;min-height:42px;padding:0 8px;font-size:11.5px;white-space:nowrap}
    .ag-state{gap:6px}.ag-pill{padding:5px 10px;font-size:11px}
    .ag-chat{padding:12px;gap:10px;border-radius:14px}
    .ag-orden{padding:8px 10px;gap:8px}.ag-orden small{display:none}.ag-orden form{flex:1 1 100%}.ag-orden .ag-btn{min-height:42px;padding:0 10px;font-size:11.5px}.ag-ochip{padding:6px 10px;font-size:11px}.ag-ochip b{font-size:.95rem}
    .ag-orden input,.ag-form textarea{font-size:16px}
    .ag-thread{height:58vh;min-height:280px;padding-right:2px}
    .ag-msg{max-width:100%;padding:11px 12px}.ag-msg.yo{max-width:92%}
    .ag-chips[data-atajos]{flex-wrap:nowrap;overflow-x:auto;margin:0 -2px;padding:2px 2px 6px;-webkit-overflow-scrolling:touch}.ag-chips[data-atajos] button{flex:none;min-height:40px}
    .ag-chips[data-replies] button{min-height:44px;flex:1 1 40%}
    .ag-form{flex-direction:row;align-items:flex-end}.ag-form textarea{min-height:46px}.ag-form .ag-btn{min-height:46px;padding:0 16px}
    .ag-files{grid-template-columns:1fr}.ag-prev{height:46vh}.ag-file-acc button,.ag-file-acc a{min-height:38px;display:inline-flex;align-items:center}
    .ag-tbl-head{align-items:flex-start}.ag-tbl-head button{min-height:36px}
    .ag-msg,.ag-tbl,.ag-tbl-wrap{min-width:0;max-width:100%}.ag-msg.con-tabla{padding:9px}.ag-tbl-wrap{overflow:visible}.ag-tbl table{font-size:10.5px;table-layout:fixed;width:100%!important;min-width:0!important;max-width:100%}.ag-tbl col.n{display:none}.ag-tbl th{position:static;padding:7px 3px;font-size:8.5px;letter-spacing:0;white-space:normal}.ag-tbl td{padding:7px 3px;white-space:normal;overflow-wrap:anywhere;line-height:1.25}.ag-tbl th.n,.ag-tbl td.n{display:none}
    .ag-lienzo{height:340px}.ag-log{height:170px;font-size:11.5px}.ag-ftit{font-size:12px}
    dialog.ag-dlg .row .ag-btn{flex:1 1 40%;min-height:46px}
    .ag .ag-chips button,.ag .ag-tbl-head button,.ag .ag-file-acc button,.ag .ag-file-acc a{font:800 12px/1.2 Arial!important;letter-spacing:0!important;text-transform:none!important}
    .ag .ag-chips[data-replies] button{padding:9px 14px!important}
  }

  `;
  document.head.appendChild(css);

  const celda = v => (String(v || '').trim() ? esc(v) : '<span class="v">—</span>');
  // Ancho de cada columna proporcional a lo que trae (en celular la tabla es de ancho fijo y cabe completa, sin scroll)
  function anchos(t) {
    // el ancho de cada columna sale de su palabra más larga (para no partir nombres a la mitad); los textos largos se reparten en varias líneas
    const mayor = txt => Math.max(0, ...String(txt || '').split(/\s+/).map(w => w.length));
    const pesos = t.columnas.map((c, k) => Math.max(mayor(c) * .75, ...t.filas.map(f => mayor(f[k])), 3));
    const suma = pesos.reduce((x, y) => x + y, 0);
    return pesos.map(p => '<col style="width:' + (p / suma * 100).toFixed(1) + '%">').join('');
  }
  function tablaHtml(m) {
    const t = m.tabla;
    return '<div class="ag-tbl"><div class="ag-tbl-head"><b>' + esc(t.titulo) + '</b><span><button type="button" data-tabla-copiar="' + m.id + '">Copiar</button><button type="button" data-tabla-csv="' + m.id + '">Descargar CSV</button></span></div>' +
      '<div class="ag-tbl-wrap"><table><colgroup><col class="n">' + anchos(t) + '</colgroup><thead><tr><th class="n">#</th>' + t.columnas.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      t.filas.map((f, i) => '<tr><td class="n">' + (i + 1) + '</td>' + t.columnas.map((_, k) => '<td>' + celda(f[k]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
  }
  function tablaDe(id) { const m = st.msgs.find(x => String(x.id) === String(id)); return m && m.tabla; }
  async function copiarTabla(id) {
    const t = tablaDe(id); if (!t) return;
    const texto = [t.columnas.join('\t'), ...t.filas.map(f => t.columnas.map((_, k) => f[k] || '').join('\t'))].join('\n');
    try { await navigator.clipboard.writeText(texto); } catch (e) { /* sin portapapeles */ }
  }
  function csvTabla(id) {
    const t = tablaDe(id); if (!t) return;
    const c = v => { const x = String(v ?? ''); return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    const blob = new Blob(['﻿' + [t.columnas, ...t.filas.map(f => t.columnas.map((_, k) => f[k] || ''))].map(r => r.map(c).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (t.titulo.replace(/[^\wÁÉÍÓÚáéíóúñÑ-]+/g, '_').slice(0, 60) || 'desglose') + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ================================================================== mapa de agentes (estilo n8n)
  const NODOS = [
    { id: 'TRIGGER', ico: '💬', tit: 'Chat', sub: 'Tu mensaje', c: '#8f9b8a' },
    { id: 'TAVO', ico: '🧭', tit: 'TAVO', sub: 'Coordinador', c: '#7da4ff' },
    { id: 'LEO', ico: '📖', tit: 'LEO', sub: 'Lee el listado', c: '#b794ff' },
    { id: 'JACK', ico: '📄', tit: 'JACK', sub: 'PDF de muestra', c: '#ffcf5c' },
    { id: 'APROB', ico: '✋', tit: 'Aprobación', sub: 'Tú apruebas', c: '#ff9a4d' },
    { id: 'OLVER', ico: '🖼️', tit: 'OLVER', sub: 'Exporta mesas', c: '#6fe39a' },
    { id: 'OLIVER', ico: '👕', tit: 'OLIVER', sub: 'Tallas y números', c: '#ff8fd0' },
    { id: 'TERRY', ico: '📊', tit: 'TERRY', sub: 'Google Sheets', c: '#6ee0e0' }
  ];
  const CADENA = NODOS.map(n => n.id);
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const flow = { el: {}, POS: {}, estado: {}, ejec: null, filtro: null, cursor: null, estadoServidor: null, cola: [], reproduciendo: false,
    listo: false, preparado: 0, silencio: false, lienzo: null, svg: null, ro: null, ejecN: 0, tam: 68 };

  function crearNodos() {
    flow.lienzo = panel.querySelector('[data-lienzo]'); flow.svg = panel.querySelector('[data-cables]'); flow.el = {};
    NODOS.forEach(n => {
      const d = document.createElement('div');
      d.className = 'ag-nodo'; d.dataset.n = n.id; d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', n.tit + ': ' + n.sub); d.style.setProperty('--c', n.c);
      d.innerHTML = '<i class="anillo"></i><div class="cj">' + n.ico + '</div><i class="puerto in"></i><i class="puerto out"></i><i class="ins"></i><div class="et"><b>' + esc(n.tit) + '</b><small>' + esc(n.sub) + '</small><em></em></div>';
      d.onclick = () => filtrar(flow.filtro === n.id ? null : n.id);
      d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
      flow.lienzo.appendChild(d); flow.el[n.id] = d;
    });
    if (flow.ro) flow.ro.disconnect();
    flow.ro = new ResizeObserver(acomodar); flow.ro.observe(flow.lienzo);
    nuevaEjec(); flow.ejec.n = 0; flow.ejecN = 0; acomodar(); pintarLog();
  }
  function acomodar() {
    const lienzo = flow.lienzo; if (!lienzo) return;
    const W = lienzo.clientWidth, H = lienzo.clientHeight; if (!W) return;
    const tam = W > 1000 ? 88 : 68, margen = 56, ancho = tam; flow.tam = tam;
    const porFila = Math.max(3, Math.min(NODOS.length, Math.floor((W - margen * 2 + 40) / 112)));
    const filas = Math.ceil(NODOS.length / porFila);
    const sep = porFila > 1 ? (W - margen * 2 - ancho) / (porFila - 1) : 0;
    const altoFila = Math.min(190, (H - 150) / Math.max(filas - 1, 1) || 0);
    const y0 = filas === 1 ? H / 2 - 50 : Math.max(80, (H - 90 - altoFila * (filas - 1)) / 2);
    NODOS.forEach((n, i) => {
      const f = Math.floor(i / porFila), c = i % porFila, x = margen + c * sep, y = y0 + f * altoFila;
      flow.POS[n.id] = { x, y, fila: f, col: i };
      flow.el[n.id].style.left = x + 'px'; flow.el[n.id].style.top = y + 'px'; flow.el[n.id].style.setProperty('--tam', tam + 'px');
    });
    dibujar();
  }
  function ruta(a, b) {
    const A = flow.POS[a], B = flow.POS[b]; if (!A || !B) return '';
    const T = flow.tam || 68, ax = A.x + T, ay = A.y + T / 2, bx = B.x, by = B.y + T / 2, adj = Math.abs(A.col - B.col) === 1;
    if (A.fila === B.fila && adj) { const k = (bx - ax) / 2; return 'M' + ax + ',' + ay + ' C' + (ax + k) + ',' + ay + ' ' + (bx - k) + ',' + by + ' ' + bx + ',' + by; }
    if (A.fila === B.fila) return 'M' + ax + ',' + ay + ' C' + (ax + 36) + ',' + (ay - 95) + ' ' + (bx - 36) + ',' + (by - 95) + ' ' + bx + ',' + by;
    return 'M' + ax + ',' + ay + ' C' + (ax + 80) + ',' + ay + ' ' + (bx - 80) + ',' + by + ' ' + bx + ',' + by;
  }
  function dibujar() {
    if (!flow.svg || !flow.ejec) return;
    let h = '';
    for (let i = 0; i < CADENA.length - 1; i++) h += '<path class="ag-cable" d="' + ruta(CADENA[i], CADENA[i + 1]) + '"/>';
    flow.ejec.pares.forEach(p => { const [a, b] = p.split('>'); h += '<path class="ag-cable ' + (flow.estado[b] === 'corriendo' ? 'vivo' : 'hecho') + '" d="' + ruta(a, b) + '"/>'; });
    flow.svg.innerHTML = h;
  }
  function nuevaEjec() {
    flow.ejecN = (flow.ejec ? flow.ejec.n : 0) + 1;
    flow.ejec = { pares: [], eventos: [], t0: {}, t1: {}, errores: {}, petDe: {}, pet: 0, n: flow.ejecN };
    flow.estado = {}; flow.cursor = null;
    NODOS.forEach(n => poner(n.id, 'inactivo'));
    const num = panel.querySelector('[data-ejecnum]'); if (num) num.textContent = '· ejecución #' + flow.ejec.n;
  }
  function poner(id, e) {
    flow.estado[id] = e;
    const d = flow.el[id]; if (!d) return;
    d.classList.remove('corriendo', 'ok', 'error', 'espera', 'inactivo'); d.classList.add(e);
    const t = d.querySelector('em'), ej = flow.ejec;
    if (ej && ej.t0[id] && (e === 'ok' || e === 'error')) { const s = Math.max(0, (ej.t1[id] || ej.t0[id]) - ej.t0[id]); t.textContent = s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(1) + ' s'; }
    else if (e === 'espera') t.textContent = 'esperando…';
    else if (e === 'corriendo') t.textContent = 'ejecutando…';
    else t.textContent = '';
  }
  function mover(a) {
    if (flow.cursor === a) return;
    if (flow.cursor) {
      const par = flow.cursor + '>' + a;
      if (!flow.ejec.pares.includes(par)) flow.ejec.pares.push(par);
      flow.ejec.t1[flow.cursor] = flow.ejec.t1[flow.cursor] || flow.ejec.t0[flow.cursor];
      poner(flow.cursor, flow.ejec.errores[flow.cursor] ? 'error' : 'ok');
    }
    flow.cursor = a; poner(a, 'corriendo'); dibujar();
  }
  function pildora(clase, texto) { const p = panel.querySelector('[data-pildora]'); if (!p) return; p.className = 'ag-pildora ' + clase; p.querySelector('span').textContent = texto; }
  function aplicarEvento(ev) {
    const ej = flow.ejec; ej.eventos.push(ev); if (!flow.silencio) pintarLog();
    const a = ev.agente; if (!flow.el[a]) return;
    if (ej.petDe[a] !== ej.pet) { ej.petDe[a] = ej.pet; ej.t0[a] = ev.t; }   // el tiempo de un nodo se cuenta dentro de una misma petición
    ej.t1[a] = ev.t;
    if (ev.nivel === 'ERROR') ej.errores[a] = true;
    if (a === 'TAVO') { if (!flow.cursor) mover('TAVO'); else if (flow.cursor === 'TAVO') poner('TAVO', 'corriendo'); if (ev.nivel === 'ERROR') poner('TAVO', 'error'); return; }
    mover(a); if (ev.nivel === 'ERROR') poner(a, 'error');
  }
  function finalizar(estado) {
    flow.estadoServidor = estado; const ej = flow.ejec;
    if (flow.cursor) { ej.t1[flow.cursor] = ej.t1[flow.cursor] || ej.t0[flow.cursor]; poner(flow.cursor, ej.errores[flow.cursor] ? 'error' : 'ok'); }
    const mover2 = id => { if (flow.cursor !== id) { const par = flow.cursor + '>' + id; if (flow.cursor && !ej.pares.includes(par)) ej.pares.push(par); flow.cursor = id; } };
    const espera = id => { mover2(id); poner(id, 'espera'); };
    switch (estado) {
      case 'APROBACION': espera('APROB'); pildora('espera', 'Esperando tu aprobación'); break;
      case 'JUGADORES': espera('OLIVER'); pildora('espera', 'Esperando la lista de jugadores'); break;
      case 'CONFIRMAR_SHEETS': espera('TERRY'); pildora('espera', 'Esperando tu confirmación'); break;
      case 'CONFIRMAR': poner(flow.cursor, 'espera'); pildora('espera', 'Esperando tu confirmación'); break;
      case 'ELEGIR_PROYECTO': poner('LEO', 'espera'); flow.cursor = 'LEO'; pildora('espera', 'Elige un proyecto'); break;
      case 'ELEGIR_AI': poner('TAVO', 'espera'); flow.cursor = 'TAVO'; pildora('espera', 'Elige un archivo'); break;
      case 'ERROR': pildora('error', 'Terminó con errores'); break;
      default:
        if (Object.values(ej.errores).some(Boolean)) pildora('error', 'Terminó con errores');
        else if (!ej.eventos.some(e => e.agente !== 'TAVO')) pildora('ok', 'Listo');
        else pildora('ok', 'Completado');
    }
    dibujar();
  }
  // Una petición nueva: si la anterior terminó (o no hay), empieza una ejecución limpia; si esperaba una respuesta, continúa la misma.
  function prepararEjecucion(idMensaje) {
    const nueva = !flow.estadoServidor || ['INICIO', 'FIN', 'ERROR'].includes(flow.estadoServidor);
    flow.preparado = idMensaje || flow.preparado;
    if (nueva) nuevaEjec(); else NODOS.forEach(n => { if (flow.estado[n.id] === 'espera') poner(n.id, 'ok'); });
    flow.ejec.pet++;
    pildora('corriendo', 'Ejecutando…');
    if (nueva) { poner('TRIGGER', 'ok'); mover('TAVO'); }
    dibujar(); pintarLog();
  }
  // Rehace el mapa a partir de la conversación guardada (al abrir el módulo o recargar la página).
  function reconstruir() {
    flow.cola = []; flow.silencio = true; flow.filtro = null; flow.estadoServidor = null; flow.ejecN = 0; flow.ejec = null;
    nuevaEjec(); flow.ejec.n = 0; flow.ejecN = 0;
    const porMensaje = {}; st.evs.forEach(e => { (porMensaje[e.msg_id] = porMensaje[e.msg_id] || []).push(e); });
    let hubo = false;
    st.msgs.filter(m => m.rol === 'yo').forEach(m => {
      hubo = true; prepararEjecucion(m.id);
      (porMensaje[m.id] || []).forEach(aplicarEvento);
      const bot = st.msgs.find(b => b.rol === 'bot' && b.en_respuesta_a === m.id);
      if (bot) finalizar(bot.estado);
    });
    flow.silencio = false; flow.listo = true;
    if (!hubo) pildora('', 'Listo');
    dibujar(); pintarLog(); marcarSeleccion();
  }
  async function reproducir() {
    if (flow.reproduciendo) return;
    flow.reproduciendo = true;
    let previo = null;
    while (flow.cola.length) {
      const it = flow.cola.shift();
      if (it.tipo === 'nueva') prepararEjecucion(it.id);
      else if (it.tipo === 'ev') {
        const a = it.ev.agente, cambia = flow.el[a] && a !== 'TAVO' && a !== flow.cursor;
        aplicarEvento(it.ev); await dormir(cambia || previo !== a ? 520 : 90); previo = a;
      } else if (it.tipo === 'fin') finalizar(it.estado);
    }
    flow.reproduciendo = false;
  }
  function filtrar(id) { flow.filtro = id; marcarSeleccion(); pintarLog(); }
  function marcarSeleccion() { Object.values(flow.el).forEach(d => d.classList.toggle('sel', d.dataset.n === flow.filtro)); }
  function pintarLog() {
    const l = panel.querySelector('[data-log]'), f = panel.querySelector('[data-filtros]'); if (!l || !f || !flow.ejec) return;
    const abajo = l.scrollTop + l.clientHeight >= l.scrollHeight - 30;
    f.innerHTML = [['Todo', null], ...['TAVO', 'LEO', 'JACK', 'OLVER', 'OLIVER', 'TERRY'].map(x => [x, x])].map(([t, v]) => '<button type="button" data-filtro="' + (v || '') + '" class="' + (flow.filtro === v ? 'on' : '') + '">' + t + '</button>').join('');
    const lista = flow.ejec.eventos.filter(e => !flow.filtro || e.agente === flow.filtro);
    l.innerHTML = lista.length ? lista.map(e => '<div class="' + esc(e.nivel) + '"><span class="h">' + esc(e.hora) + '</span><b style="color:' + (COLORES[e.agente] || '#ccc') + '">' + esc(e.agente) + '</b><span class="m">' + esc(e.msg) + '</span></div>').join('')
      : '<div class="vacio2">' + (flow.filtro ? 'Este nodo aún no ha hecho nada en esta ejecución.' : 'Aquí verás lo que hace cada agente, paso a paso.') + '</div>';
    if (abajo) l.scrollTop = l.scrollHeight;
  }

  // ================================================================== pantalla
  function armar() {
    panel.innerHTML = '<div class="ag"><header class="ag-head"><div><span class="k">EDICIÓN · INTELIGENCIA</span><h2>AGENTES</h2><p>Escríbele a TAVO y él decide qué agente actúa. Todo se ejecuta en el PC con Illustrator.</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="ag-btn sec" data-nueva>Nueva conversación</button><button type="button" class="ag-btn sec" data-conectar hidden>Conectar PC</button></div></header>' +
      '<div class="ag-state" data-estado></div><div data-aviso></div>' +
      '<div class="ag-main"><section class="ag-chat"><div class="ag-orden" data-orden></div><div class="ag-thread" data-hilo></div><div class="ag-chips" data-replies></div>' +
      '<div class="ag-chips" data-atajos>' + ATAJOS.map(([l, p]) => '<button type="button" data-atajo="' + esc(p) + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<form class="ag-form" data-form><textarea rows="1" placeholder="Escribe a TAVO…" maxlength="2000"></textarea><button type="submit" class="ag-btn">Enviar</button></form></section>' +
      '<section class="ag-flowcol"><div class="ag-lienzo" data-lienzo><div class="ag-barra"><div class="ag-ftit">Flujo de agentes<small data-ejecnum></small></div><div class="ag-pildora" data-pildora><i></i><span>Listo</span></div></div><svg class="ag-cables" data-cables aria-hidden="true"></svg></div>' +
      '<div class="ag-detalle"><header><h3>Ejecución</h3><div class="ag-filtros" data-filtros></div></header><div class="ag-log" data-log></div></div></section></div></div>';
    panel.dataset.armado = '1';
    crearNodos();
  }

  const KB = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const esImagen = a => ['png', 'jpg', 'jpeg'].includes(a.ext);
  const abierto = (m, i) => { const k = m.id + ':' + i; return st.abiertos[k] !== undefined ? st.abiertos[k] : (m.archivos[i].tipo === 'muestra' && m.archivos.length <= 2); };
  function archivosHtml(m) {
    return '<div class="ag-files">' + m.archivos.map((a, i) => {
      const url = a.id ? '/api/agentes/archivo/' + a.id : '', ver = a.id && abierto(m, i);
      const previa = ver ? (esImagen(a) ? '<img class="ag-prev" src="' + url + '" alt="' + esc(a.titulo) + '">' : '<iframe class="ag-prev" src="' + url + '#toolbar=0&navpanes=0&view=FitH" loading="lazy" title="' + esc(a.titulo) + '"></iframe>') : '';
      return '<article class="ag-file ' + esc(a.tipo) + (ver ? ' abierto' : '') + '"><div class="ag-file-head"><span class="ag-fico">' + (esImagen(a) ? '🖼️' : /\.ai$/i.test(a.nombre) ? '🎨' : '📄') + '</span><div><b>' + esc(a.titulo || a.nombre) + '</b><small>' + esc(a.nombre) + (a.size ? ' · ' + KB(a.size) : '') + '</small></div></div>' + previa +
        '<div class="ag-file-acc">' + (a.id ? '<button type="button" data-f-ver="' + m.id + ':' + i + '">' + (ver ? 'Ocultar' : 'Ver') + '</button><a href="' + url + '" target="_blank" rel="noopener">Abrir</a><a href="' + url + '?descargar=1" download>Descargar</a>' : '<span class="nopre">Sin vista previa</span>') +
        (a.ruta ? '<button type="button" data-f-ruta="' + m.id + ':' + i + '">Copiar ruta</button>' : '') + '</div></article>';
    }).join('') + '</div>';
  }


  function pintar() {
    if (!panel || !panel.dataset.armado) return;
    const e = st.estado, ultimo = st.msgs[st.msgs.length - 1];
    const botones = ultimo && ultimo.rol === 'bot' && !st.esperando ? (ultimo.botones || []) : [];
    const pill = (clase, texto) => '<span class="ag-pill ' + clase + '"><i></i>' + esc(texto) + '</span>';
    const modo = v => !v ? '' : v === 'real' ? 'ok' : /^error/.test(v) ? 'mal' : 'sim';
    panel.querySelector('[data-estado]').innerHTML = pill(e.conectado ? 'ok' : 'mal', e.conectado ? 'PC conectado' : 'PC desconectado') + (e.conectado && e.illustrator ? pill(modo(e.illustrator), 'Illustrator: ' + e.illustrator) : '') + (e.conectado && e.sheets ? pill(modo(e.sheets), 'Sheets: ' + e.sheets) : '');
    panel.querySelector('[data-aviso]').innerHTML = !e.conectado ? '<div class="ag-warn">El PC de los agentes no está conectado. Tu mensaje queda en cola y se atiende cuando el PC con Illustrator esté encendido con los agentes iniciados.</div>' : '';
    const trabajo = st.trabajo;
    const hilo = st.msgs.length ? st.msgs.map(m => m.rol === 'yo'
      ? '<div class="ag-msg yo"><p class="ag-txt">' + esc(m.texto) + '</p><span class="ag-time">' + hora(m.creado) + '</span></div>'
      : '<div class="ag-msg bot' + (m.estado === 'ERROR' ? ' err' : '') + (m.tabla || (m.archivos && m.archivos.length) ? ' con-tabla' : '') + '"><div class="ag-who">' + (m.agentes && m.agentes.length ? m.agentes : ['TAVO']).map(tag).join('') + '</div><p class="ag-txt">' + esc(m.tabla ? m.texto.split(/\n\nDesglose del listado/)[0] : m.texto) + '</p>' + (m.tabla ? tablaHtml(m) : '') + (m.archivos && m.archivos.length ? archivosHtml(m) : '') + '<span class="ag-time">' + hora(m.creado) + '</span></div>').join('')
      : '<div class="ag-empty"><h3>¿Qué necesitas hoy?</h3><p>Fija la orden arriba y pídele lo que necesites, por ejemplo «exporta las mesas». TAVO decide qué agente actúa.</p></div>';
    const trabajando = st.esperando ? '<div class="ag-work"><div class="ag-who">' + ((trabajo && trabajo.agentes) || ['TAVO']).map(a => tag(a)).join('') + '<span class="ag-dots"><i></i><i></i><i></i></span></div><b>' +
      esc(trabajo && trabajo.msg ? trabajo.agente + ': ' + trabajo.msg : e.conectado ? 'TAVO está trabajando…' : 'Esperando al PC de los agentes…') + '</b></div>' : '';
    const barra = panel.querySelector('[data-orden]'), claveOrden = st.orden + '|' + st.cambiandoOrden;
    if (barra.dataset.clave !== claveOrden) {
      barra.dataset.clave = claveOrden;
      barra.innerHTML = st.orden && !st.cambiandoOrden
        ? '<span class="ag-ochip">Orden activa <b>' + esc(st.orden) + '</b></span><button type="button" class="ag-btn sec" data-orden-cambiar>Cambiar</button><button type="button" class="ag-btn sec" data-orden-quitar>Quitar</button><small>Todo lo que pidas se hace con esta orden: no tienes que escribirla en cada mensaje.</small>'
        : '<form data-orden-form><label for="ag-orden-in">Orden</label><input id="ag-orden-in" maxlength="12" autocomplete="off" placeholder="CO6133" value="' + esc(st.orden) + '"><button type="submit" class="ag-btn">Fijar orden</button>' + (st.orden ? '<button type="button" class="ag-btn sec" data-orden-cancelar>Cancelar</button>' : '') + '</form><small>Escríbela una sola vez y TAVO relaciona todo con ella (listado, mesas, muestra, PDF).</small>';
      if (st.cambiandoOrden) panel.querySelector('#ag-orden-in')?.focus();
    }
    panel.querySelector('textarea').placeholder = st.orden ? 'Pídele a TAVO (usa la orden ' + st.orden + ')…' : 'Escribe a TAVO…';
    const hiloEl = panel.querySelector('[data-hilo]'), firma = hilo + trabajando;
    if (hiloEl.dataset.firma !== firma) { hiloEl.innerHTML = firma; hiloEl.dataset.firma = firma; hiloEl.scrollTop = hiloEl.scrollHeight; }
    panel.querySelector('[data-replies]').innerHTML = botones.map(b => '<button type="button" class="reply" data-send="' + esc(b) + '">' + esc(b) + '</button>').join('');
    panel.querySelectorAll('[data-atajo]').forEach(b => { b.disabled = st.esperando; });
    panel.querySelector('textarea').disabled = st.esperando;
    panel.querySelector('[data-form] button').disabled = st.esperando || st.enviando;
    if (st.admin) panel.querySelector('[data-conectar]').hidden = false;
  }
  function render() { pintar(); }

  async function fijarOrden(codigo) {
    try {
      const r = await api('/api/agentes/orden', { method: 'POST', body: JSON.stringify({ orden: codigo }) });
      st.orden = r.orden; st.cambiandoOrden = false; flow.estadoServidor = null;   // la próxima petición abre una ejecución nueva
    } catch (e) { alert(e.message); }
    pintar();
  }

  async function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || st.esperando || st.enviando) return;
    st.enviando = true; pintar();
    try {
      if (!flow.listo) reconstruir();
      prepararEjecucion();
      const r = await api('/api/agentes/mensaje', { method: 'POST', body: JSON.stringify({ mensaje: texto }) });
      flow.preparado = r.id; st.esperando = true; await cargar(true);
    } catch (e) { alert(e.message); flow.listo = false; }
    st.enviando = false; pintar(); programar();
  }

  async function cargar(forzar) {
    if (st.cargando && !forzar) return;
    st.cargando = true;
    try {
      const [datos, estado] = await Promise.all([api('/api/agentes/mensajes?desde=' + st.ultimo + '&desde_ev=' + st.ultimoEv), api('/api/agentes/estado')]);
      const nuevos = datos.mensajes || [], evs = datos.eventos || [], primera = !flow.listo;
      st.esperando = datos.esperando; st.trabajo = datos.trabajo; st.estado = estado;
      if (!st.cambiandoOrden) st.orden = datos.orden || '';
      if (nuevos.length) { st.msgs = st.msgs.concat(nuevos); st.ultimo = Math.max(...nuevos.map(m => m.id), st.ultimo); }
      if (evs.length) st.evs = st.evs.concat(evs);
      st.ultimoEv = Math.max(st.ultimoEv, datos.ultimo_ev || 0);
      if (primera) reconstruir();
      else {
        // pedidos hechos desde otra pestaña o dispositivo también abren su ejecución; luego el avance y por último el resultado
        nuevos.filter(m => m.rol === 'yo' && m.id > flow.preparado).forEach(m => flow.cola.push({ tipo: 'nueva', id: m.id }));
        evs.forEach(ev => flow.cola.push({ tipo: 'ev', ev }));
        nuevos.filter(m => m.rol === 'bot').forEach(m => flow.cola.push({ tipo: 'fin', estado: m.estado }));
        reproducir();
      }
      pintar();
    } catch (e) { /* sin conexión: se reintenta */ }
    st.cargando = false;
  }
  function programar() {
    clearTimeout(timer);
    if (!panel || !panel.classList.contains('active')) return;
    timer = setTimeout(async () => { if (!document.hidden) await cargar(false); programar(); }, st.esperando ? 1500 : 4000);
  }

  async function conectar() {
    let info;
    try { info = await api('/api/agentes/conexion'); } catch (e) { alert(e.message); return; }
    const dlg = document.createElement('dialog');
    dlg.className = 'ag-dlg';
    const pintar = i => {
      dlg.innerHTML = '<div class="b"><h2>Conectar el PC de los agentes</h2><p style="margin:0;color:#aebba7;font-size:.88rem">Este código lo usa el PC con Illustrator para entrar al panel. Trátalo como una contraseña: no lo compartas ni lo pegues en chats.</p>' +
        '<b style="font-size:.8rem">Dirección del panel</b><code>' + esc(i.url) + '</code><b style="font-size:.8rem">Código de conexión</b><code data-token>' + esc(i.token) + '</code>' +
        '<ol><li>En el PC con Illustrator abre la carpeta <b>agentes_uniformes</b>.</li><li>Ejecuta <b>conectar_panel.bat</b> y pega la dirección y el código.</li><li>Abre <b>iniciar.bat</b>: aquí debe aparecer «PC conectado».</li></ol>' +
        '<div class="row"><button type="button" class="ag-btn sec" data-copiar>Copiar código</button><button type="button" class="ag-btn sec" data-regenerar>Generar uno nuevo</button><button type="button" class="ag-btn" data-cerrar>Cerrar</button></div></div>';
      dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
      dlg.querySelector('[data-copiar]').onclick = () => { try { navigator.clipboard.writeText(i.token); } catch (e) { /* sin portapapeles */ } };
      dlg.querySelector('[data-regenerar]').onclick = async () => { if (!confirm('El PC dejará de conectarse hasta que le pongas el código nuevo. ¿Generar uno nuevo?')) return; try { pintar(await api('/api/agentes/conexion/regenerar', { method: 'POST', body: '{}' })); } catch (e) { alert(e.message); } };
    };
    pintar(info);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="produccion"]')?.closest('.nav-group') || document.querySelector('nav.tabs .nav-group:last-child');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="agentes"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'agentes';
    panel.innerHTML = '<div class="ag"><div class="ag-empty">Cargando agentes…</div></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="agentes" type="button"><span class="nav-icon">AG</span><strong>AGENTES</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
      if (st.admin === undefined) { try { st.admin = !!(await api('/api/permisos/mi')).admin; } catch (e) { st.admin = false; } }
      if (!panel.dataset.armado) armar();
      await cargar(true); pintar(); programar();
    });
    panel.addEventListener('click', async e => {
      if (e.target.closest('[data-orden-cambiar]')) { st.cambiandoOrden = true; pintar(); return; }
      if (e.target.closest('[data-orden-cancelar]')) { st.cambiandoOrden = false; pintar(); return; }
      if (e.target.closest('[data-orden-quitar]')) { await fijarOrden(''); return; }
      const filtro = e.target.closest('[data-filtro]'), reply = e.target.closest('[data-send]'), atajo = e.target.closest('[data-atajo]');
      if (filtro) { filtrar(filtro.dataset.filtro || null); return; }
      const fv = e.target.closest('[data-f-ver]'), fr = e.target.closest('[data-f-ruta]');
      if (fv) { const [mid, i] = fv.dataset.fVer.split(':'), m = st.msgs.find(x => String(x.id) === mid); if (m) { st.abiertos[fv.dataset.fVer] = !abierto(m, Number(i)); pintar(); } return; }
      if (fr) { const [mid, i] = fr.dataset.fRuta.split(':'), m = st.msgs.find(x => String(x.id) === mid); const ruta = m && m.archivos[Number(i)] && m.archivos[Number(i)].ruta; if (ruta) { try { await navigator.clipboard.writeText(ruta); } catch (err) { /* sin portapapeles */ } fr.textContent = '¡Copiada!'; setTimeout(() => { fr.textContent = 'Copiar ruta'; }, 1500); } return; }
      if (e.target.closest('[data-tabla-copiar]')) { const b = e.target.closest('[data-tabla-copiar]'); copiarTabla(b.dataset.tablaCopiar); b.textContent = '¡Copiado!'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); }
      else if (e.target.closest('[data-tabla-csv]')) csvTabla(e.target.closest('[data-tabla-csv]').dataset.tablaCsv);
      else if (reply) enviar(reply.dataset.send);
      else if (atajo) {
        const texto = atajo.dataset.atajo;
        if (texto.endsWith(' ') && st.orden) enviar(texto.trim() + ' ' + st.orden);
        else if (texto.endsWith(' ')) { const caja = panel.querySelector('textarea'); caja.value = texto; caja.focus(); caja.setSelectionRange(texto.length, texto.length); } else enviar(texto);
      } else if (e.target.closest('[data-nueva]')) {
        if (st.msgs.length && !confirm('¿Borrar esta conversación? Los agentes empiezan de cero.')) return;
        try { await api('/api/agentes/limpiar', { method: 'POST', body: '{}' }); } catch (err) { alert(err.message); return; }
        st.msgs = []; st.ultimo = 0; st.evs = []; st.ultimoEv = 0; st.trabajo = null; flow.listo = false; flow.preparado = 0; await cargar(true); pintar();
      } else if (e.target.closest('[data-conectar]')) conectar();
    });
    panel.addEventListener('submit', e => { e.preventDefault(); if (e.target.matches('[data-orden-form]')) { fijarOrden(e.target.querySelector('input').value); return; } const caja = panel.querySelector('textarea'); const v = caja.value; caja.value = ''; enviar(v); });
    panel.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea')) { e.preventDefault(); panel.querySelector('form').requestSubmit(); } });
    panel.addEventListener('input', e => { if (e.target.matches('textarea')) { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; } });
    return true;
  }
  // Acceso desde el menú del usuario (en computador sale del menú superior; en celular sigue en la barra inferior).
  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return !!document.getElementById('open-agentes');
    if (document.getElementById('open-agentes')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-agentes'; button.textContent = 'Agentes';
    const anterior = document.getElementById('open-reportes') || document.getElementById('open-personal-notes');
    anterior ? anterior.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    return true;
  }

  // Solo Administración/Coordinador y Edición (según PERMISOS): a los demás la pestaña ni se crea.
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    if (!mi || !((mi.permisos || {}).agentes || {}).ver) return;
    st.admin = !!mi.admin;
    // al volver a la pestaña se actualiza al instante (en segundo plano el panel no consulta)
    document.addEventListener('visibilitychange', () => { if (!document.hidden && panel && panel.classList.contains('active')) { cargar(true).then(programar); } });
    let tries = 0;
    const wait = setInterval(() => { if ((build() && addMenuItem()) || ++tries > 60) clearInterval(wait); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();
