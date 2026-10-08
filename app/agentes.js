/* AGENTES: canal de comunicación con TAVO y los agentes de edición (los que corren en el PC con Illustrator).
   El panel solo guarda la conversación; el PC la recoge, ejecuta a los agentes y devuelve la respuesta. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORES = { TAVO: '#7da4ff', LEO: '#b794ff', JACK: '#ffcf5c', OLVER: '#6fe39a', OLIVER: '#ff8fd0', TERRY: '#6ee0e0' };
  const ROLES = { TAVO: 'Coordina', LEO: 'Lee el listado', JACK: 'Muestra PDF', OLVER: 'Exporta mesas', OLIVER: 'Valida tallas', TERRY: 'Google Sheets' };
  const ATAJOS = [['Ver listado', 'Qué dice el listado de la orden '], ['Exportar mesas', 'Expórtame las mesas de trabajo de la orden '], ['Crear muestra', 'Crea la muestra de la orden '],
    ['Pedido completo', 'Pedido completo de la orden '], ['Jugadores', 'jugadores'], ['Reiniciar', 'cancelar']];
  // Botones para usar cada agente por separado (se aplican a la orden activa)
  const AGENTES_BTN = [['LEO', 'Listado', 'Qué dice el listado de la orden '], ['JACK', 'Muestra', 'Crea la muestra de la orden '], ['OLVER', 'Mesas', 'Expórtame las mesas de trabajo de la orden '],
    ['OLIVER', 'Jugadores', 'jugadores'], ['TERRY', 'MTS', 'Calcula los MTS requeridos de la orden ']];
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
  .ag-main{display:grid;grid-template-columns:minmax(360px,32%) minmax(0,1fr);gap:14px;align-items:stretch;height:max(760px,calc(100vh - 250px));min-height:700px}
  .ag-flowcol{display:grid;grid-template-rows:auto minmax(0,1fr) 176px;gap:14px;min-height:0}.ag-lienzo{grid-row:1}.ag-live{grid-row:2}.ag-detalle{grid-row:3}
  .ag-live{display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px;min-height:0;border:1px solid #34432f;border-radius:16px;background:#0c110d;padding:12px 14px}
  .ag-live-top{display:flex;align-items:center;gap:10px}.ag-live-top b{font:800 11px Arial;letter-spacing:.12em;color:#d7ff3a}.ag-live-top i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6f7d6a;margin-right:6px}.ag-live-top i.on{background:#8bd450;animation:agpulso 1.1s infinite}.ag-live-top small{color:#8fa088;font-size:11px}
  .ag-live-top .seguir{margin-left:auto;min-height:0;padding:4px 12px;border:1px solid #8bd450;border-radius:999px;background:transparent;color:#8bd450;font:800 11px Arial;cursor:pointer}
  @keyframes agpulso{50%{opacity:.25}}
  .ag-live-body{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:14px;min-height:0}
  .ag-live-vista{position:relative;min-height:0;border-radius:12px;background:#fff;overflow:hidden}
  .ag-live-vista img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none}.ag-live-vista img.ok{display:block}
  .ag-live-vista.cambio img{animation:agfoto .35s}@keyframes agfoto{from{opacity:.25}}
  .ag-live-vacio{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:6px;text-align:center;padding:24px;background:#0a0f0b;color:#8f9b8a;font-size:13px;line-height:1.5}.ag-live-vacio b{color:#d7ff3a;font:800 13px Arial;letter-spacing:.1em}
  .ag-live-cap{position:absolute;left:12px;bottom:14px;display:none;align-items:center;gap:14px;max-width:calc(100% - 24px);padding:9px 16px;border-radius:12px;background:#0b110bde;border:1px solid #3a4b36;color:#fff}.ag-live-cap.ok{display:flex}
  .ag-live-cap .num{font:800 36px Arial;color:#d7ff3a;line-height:1}.ag-live-cap .nom{display:block;font:800 19px Arial;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ag-live-cap small{display:block;margin-top:2px;color:#aebba7;font-size:11px}
  .ag-live-prog{position:absolute;left:0;right:0;bottom:0;height:5px;background:#1c261c}.ag-live-prog i{display:block;height:100%;background:#8bd450;transition:width .3s}
  .ag-live-side{display:grid;grid-template-rows:minmax(0,.7fr) minmax(0,1.3fr);gap:10px;min-height:0}
  .ag-live-sec{display:grid;grid-template-rows:auto minmax(0,1fr);gap:6px;min-height:0}
  .ag-live-sec h4{margin:0;font:800 11px Arial;letter-spacing:.1em;color:#aebba7;display:flex;justify-content:space-between;gap:8px}.ag-live-sec h4 span{color:#d7ff3a}
  .ag-live-list{min-height:0;overflow:auto;display:grid;align-content:start;gap:3px;font-size:12px}.ag-live-list div{display:flex;gap:6px;align-items:center;padding:4px 8px;border-radius:7px;background:#121a13;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ag-live-list div::before{content:'✓';color:#8bd450;font-weight:800}.ag-live-list div.nuevo{animation:agnuevo 1s}@keyframes agnuevo{from{background:#2d4a1f}}
  .ag-live-list div{flex-wrap:wrap}.ag-live-list div .gd{flex:0 0 100%;order:9;margin:1px 0 0;font:600 10.5px Arial;color:#9fb394;white-space:normal;word-break:break-all}.ag-live-list div .gd b{font-weight:800;color:#d7ff3a}
  .ag-live-list div{display:flex;align-items:center;gap:4px}.ag-live-list div .ag-vlink{margin-left:auto;padding:0 8px;border-radius:6px;background:#26361f;color:#b8ff6a;text-decoration:none;font-weight:900}.ag-live-list div .ag-vlink:hover{background:#3a5a28}.ag-live-list div[data-vista]{cursor:pointer}.ag-live-list div[data-vista]:hover{background:#1a2a1a}.ag-live-list div.sel{outline:1px solid #8bd450;background:#1a2a1a}
  .ag-live small.dest{display:block;color:#8fa088;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
  @media(max-width:1000px){.ag-main{grid-template-columns:1fr;height:auto;min-height:0}.ag-flowcol{grid-template-rows:auto auto auto}.ag-live{grid-template-rows:auto auto}.ag-live-body{grid-template-columns:1fr}.ag-live-vista{height:62vw;min-height:280px}.ag-live-side{grid-template-rows:auto auto}.ag-live-list{max-height:150px}.ag-log{height:200px}.ag-chat{grid-template-rows:auto auto auto auto auto}.ag-thread{height:62vh;min-height:300px;max-height:none}}
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
  .ag-btn.danger{border:1px solid #e5484d;background:rgba(229,72,77,.14);color:#ff9a9d}.ag-btn.danger:hover{background:rgba(229,72,77,.28)}.ag-work .ag-btn.danger{justify-self:start;min-height:34px;padding:0 14px}
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


  .ag-res{display:grid;gap:12px;padding:16px 18px;border:1px solid #2d3b4a;border-radius:16px;background:linear-gradient(135deg,#111a22,#0f140f)}
  .ag-res[hidden]{display:none}
  /* ---- interfaz compacta: encabezado en una fila, menús ⋯ y ⚡, botones pequeños ---- */
  .ag{gap:8px}
  .ag-hd{width:100%;max-width:none;box-sizing:border-box;margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 12px;border:1px solid #2d3b4a;border-radius:14px;background:linear-gradient(135deg,#131c27,#11150f)}
  .ag-hd h2{margin:0;font-size:1rem;letter-spacing:.08em}
  .ag-hd .ag-state{flex:0 1 auto;gap:6px;min-width:0}.ag-hd .ag-pill{padding:3px 9px;font-size:11px}
  .ag-indiv{display:flex;gap:6px;flex:1 1 auto;justify-content:center;flex-wrap:wrap;align-items:center}
  .ag-agbtn{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border:1px solid color-mix(in srgb,var(--c) 55%,transparent);border-radius:999px;background:color-mix(in srgb,var(--c) 10%,transparent);color:#eef4e9;font:800 12px Arial;letter-spacing:.04em;cursor:pointer;white-space:nowrap;width:auto!important}
  .ag-agbtn i{width:8px;height:8px;border-radius:50%;background:var(--c)}.ag-agbtn small{font:700 11px Arial;color:#c4cfbf;letter-spacing:0}
  .ag-agbtn:hover:not(:disabled){background:color-mix(in srgb,var(--c) 22%,transparent)}.ag-agbtn:disabled{opacity:.45;cursor:progress}
  @media(max-width:1000px){.ag-indiv{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;scrollbar-width:none}.ag-indiv::-webkit-scrollbar{display:none}}
  .ag-hacc{display:flex;gap:6px;align-items:center;margin-left:auto}
  .ag-menu{position:relative}.ag-menu>summary{list-style:none;cursor:pointer}.ag-menu>summary::-webkit-details-marker{display:none}
  .ag-ico{display:inline-grid;place-items:center;min-width:32px;min-height:32px;padding:0 8px;border:1px solid #60754d;border-radius:10px;background:transparent;color:#e3eadc;font:800 14px Arial;cursor:pointer}.ag-ico:hover{border-color:#d0f44c}
  .ag-menu-l{position:absolute;right:0;top:calc(100% + 6px);z-index:30;display:grid;gap:2px;min-width:210px;padding:6px;border:1px solid #3d4f3d;border-radius:12px;background:#111611;box-shadow:0 12px 30px #000a}
  .ag-menu-l button{width:100%!important;justify-content:flex-start;text-align:left;min-height:38px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:#eef4e9;font:700 13px Arial;cursor:pointer}.ag-menu-l button:hover{background:#1b261c}.ag-menu-l button:disabled{opacity:.45}
  .ag-atajos .ag-menu-l{right:auto;left:0;top:auto;bottom:calc(100% + 6px)}
  .ag .ag-btn{min-height:34px;padding:0 12px;font-size:12px}.ag-chips button{padding:6px 12px!important;font-size:12px!important}
  .ag-orden{padding:6px 10px;gap:8px}.ag-ochip{padding:3px 4px 3px 12px;gap:6px;font-size:12px}.ag-ochip .ag-ico{min-width:26px;min-height:26px;padding:0 6px;border-color:transparent}
  .ag-orden form{gap:6px}.ag-orden input{min-height:32px;padding:4px 10px}
  .ag-chat{padding:12px;gap:8px}.ag-form{align-items:center;gap:8px}.ag-form textarea{min-height:38px;padding:8px 12px}
  .ag-file-acc button,.ag-file-acc a{padding:4px 10px!important}
  .ag-detalle header{padding:6px 12px}.ag-filtros .ag-pcsel{min-height:28px;font-size:11px}
  /* chat más angosto y el trabajo de los agentes (flujo, pantalla en vivo, montajes y PDF) más grande */
  .ag-chat{grid-template-rows:minmax(0,1fr) auto auto}
  @media(max-width:1000px){.ag-chat{grid-template-rows:none!important}}
  @media(min-width:1001px){
    /* franja superior: orden + flujo; debajo: chat angosto | pantalla en vivo grande | montajes y PDF */
    .ag-main{grid-template-columns:minmax(300px,24%) minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr) auto!important;gap:12px!important;height:max(700px,calc(100vh - 165px))!important;min-height:0!important}
    .ag-flowcol{display:contents!important}
    .ag-orden{grid-column:1;grid-row:1;align-self:start}
    .ag-lienzo{grid-column:2;grid-row:1}
    .ag-chat{grid-column:1;grid-row:2 / span 2;min-height:0}
    .ag-live{grid-column:2;grid-row:2;min-height:0}
    .ag-detalle{grid-column:2;grid-row:3;height:250px;border-color:#4a6338!important;background:#101710!important;box-shadow:0 0 0 1px rgba(208,244,76,.12)}
    .ag-detalle header{padding:9px 16px!important;background:#16201a}.ag-detalle header h3{font-size:13px!important;color:#d0f44c!important;letter-spacing:.12em}
    .ag-filtros .ag-pcsel{min-height:32px!important;font-size:13px!important}
    .ag-log{font-size:14.5px!important;line-height:1.75!important;background:#0a0f0a!important;color:#eef4e9!important;padding:10px 16px!important}
    .ag-log .h{opacity:.65;font-size:13px}.ag-log b{font-size:13.5px}.ag-log .WARN .m{color:#ffd283!important}.ag-log .ERROR .m{color:#ff9d9d!important}
    .ag-log div{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)}
    .ag-live-body{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)!important}
    .ag-nodo .et b{font-size:15px}.ag-nodo .et small{font-size:12px}.ag-nodo .et em{font-size:12px}.ag-nodo .et{width:150px}
    .ag-ftit{font-size:15px}.ag-pildora{font-size:13px}.ag-live-top b{font-size:13px}.ag-live-top small{font-size:12.5px}
    .ag-live-cap .num{font-size:46px}.ag-live-cap .nom{font-size:24px}.ag-live-cap small{font-size:13px}
    .ag-live-sec h4{font-size:12.5px}.ag-live-list{font-size:13.5px}.ag-live-list div{padding:6px 10px}
    .ag-log{font-size:13px}}
  .ag-tabs{display:flex;gap:8px;flex-wrap:wrap}.ag-tabs[hidden]{display:none}
  .ag-tab{display:inline-flex;align-items:center;gap:9px;min-height:42px;padding:6px 18px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:#c4cfbf;font:800 13px Arial;cursor:pointer;width:auto!important}
  .ag-tab i{width:9px;height:9px;border-radius:50%;background:#6f7d6a;flex:none}.ag-tab i.ok{background:#8bd450}.ag-tab i.mal{background:#ff6b5c}
  .ag-tab b{letter-spacing:.05em}.ag-tab em{font:600 11.5px Arial;font-style:normal;color:#8f9b8a;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ag-hd .ag-tabs{flex:0 0 auto;gap:6px;flex-wrap:nowrap;padding:0 12px 0 10px;border-left:1px solid #34432f;border-right:1px solid #34432f}
  .ag-hd .ag-tab{min-height:34px;padding:3px 12px;font-size:12px;gap:7px}.ag-hd .ag-tab em{max-width:150px;font-size:11px}
  @media(max-width:1000px){.ag-hd .ag-tabs{flex:1 1 100%;border:0;padding:0;overflow-x:auto}}
  .ag-tab.on{background:#d0f44c;border-color:#d0f44c;color:#142017}.ag-tab.on em{color:#33401a}
  .ag-tab.ocupado:not(.on){border-color:#7da4ff;background:rgba(125,164,255,.08)}.ag-tab.ocupado:not(.on) em{color:#9db8ff}.ag-tab.ocupado i{animation:agpul 1s infinite}
  @media(max-width:700px){.ag-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.ag-tabs::-webkit-scrollbar{display:none}.ag-tab{flex:none}}
  .ag-reiniciar{font-weight:800!important;white-space:nowrap}.ag-stop{font-weight:900!important;letter-spacing:.04em;white-space:nowrap}.ag-stop.inactivo{opacity:.7}
  .ag-pcsel{min-height:40px;padding:0 12px;border:1px solid #60754d;border-radius:10px;background:#142017;color:#e3eadc;font:800 13px Arial;cursor:pointer}.ag-pcsel[hidden]{display:none}
  .ag-pcrow{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid #34432f;border-radius:12px;background:#0c110d}
  .ag-pcrow b{display:block;color:#eef4e9}.ag-pcrow small{display:block;color:#8f9b8a;font-size:.78rem}.ag-pcrow span{display:flex;gap:6px}.ag-pcrow .ag-btn{min-height:34px;padding:0 12px;font-size:12px}
  .ag-pcnuevo{display:grid;gap:8px;padding:12px;border:1px solid #d0f44c;border-radius:12px;background:rgba(208,244,76,.06);font-size:.85rem}
  .ag-pcadd{display:flex;gap:8px;flex-wrap:wrap}.ag-pcadd input{flex:1 1 220px;min-height:40px;padding:0 12px;border:1px solid #60754d;border-radius:10px;background:#142017;color:#f5faef;font:700 14px Arial}
  .ag-ver-flujo{display:none;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:#d0f44c;font:800 13px Arial;cursor:pointer}
  .ag-res-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .ag-res-top h3{margin:0;font:800 11px Arial;letter-spacing:.12em;color:#7da4ff;text-transform:uppercase}
  .ag-res-top .qa{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.ag-res-top .qa b{font-size:1.05rem;color:#eef4e9}.ag-res-top .qa small{color:#aebba7;font-size:.8rem}
  .ag-res-top .tiempo{font:800 13px Consolas,monospace;color:#d7ff3a}
  .ag-barra2{height:8px;border-radius:99px;background:#1c261c;overflow:hidden}.ag-barra2 i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#6fe39a,#d7ff3a);transition:width .5s}
  .ag-barra2.err i{background:#ff6b5c}
  .ag-pasos{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
  .ag-paso{display:grid;gap:2px;padding:8px 10px;border:1px solid #34432f;border-radius:10px;background:#0c110d;font-size:.78rem;color:#8f9b8a}
  .ag-paso b{font-size:.8rem;color:#c4cfbf}.ag-paso em{font-style:normal;font-size:.72rem}
  .ag-paso.ok{border-color:#8bd450}.ag-paso.ok b{color:#8bd450}.ag-paso.corriendo{border-color:#7da4ff;background:rgba(125,164,255,.08)}.ag-paso.corriendo b{color:#7da4ff}
  .ag-paso.espera{border-color:#ffc95c}.ag-paso.espera b{color:#ffc95c}.ag-paso.error{border-color:#ff6b5c}.ag-paso.error b{color:#ff6b5c}
  .ag-ahora{padding:9px 12px;border-radius:10px;background:#0c110d;border:1px solid #34432f;color:#d6dae2;font-size:.86rem;line-height:1.45}.ag-ahora b{color:#7da4ff}
  .ag-ahora.nota{border-color:#ffc95c;background:rgba(255,201,92,.07);color:#ffe3a3}
  .ag-datos{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
  .ag-dato{display:grid;gap:2px;padding:9px 12px;border:1px solid #2d3b2f;border-radius:10px;background:#0c110d}
  .ag-dato small{color:#8f9b8a;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase}.ag-dato span{color:#eef4e9;font-size:.88rem;overflow-wrap:anywhere}
  .ag-dato.aviso{border-color:rgba(255,201,92,.55)}.ag-dato.aviso small{color:#ffc95c}
  .ag-ayuda{display:grid;gap:8px;padding:11px 13px;border-radius:12px;border:1px solid rgba(255,201,92,.55);background:rgba(255,201,92,.07);color:#ffe3a3;font-size:.86rem;line-height:1.45}
  .ag-ayuda b{color:#ffc95c}.ag-ayuda .acc{display:flex;gap:8px;flex-wrap:wrap}
  .ag-ayuda button{min-height:0;padding:7px 14px;border:1px solid #ffc95c;border-radius:999px;background:transparent;color:#ffc95c;font:800 12px Arial;cursor:pointer}.ag-ayuda button:disabled{opacity:.5}
  .ag-ayuda.err{border-color:rgba(255,106,90,.6);background:rgba(255,106,90,.07);color:#ffc7bf}.ag-ayuda.err b{color:#ff8a7c}.ag-ayuda.err button{border-color:#ff8a7c;color:#ff8a7c}
  details.ag-det{border:1px solid #34432f;border-radius:10px;background:#0c110d;padding:8px 12px}details.ag-det summary{cursor:pointer;color:#ffc95c;font-weight:800;font-size:.84rem}
  details.ag-det div{margin-top:6px;max-height:220px;overflow:auto;color:#c4cfbf;font-size:.8rem;line-height:1.5;white-space:pre-wrap}
  .ag-log .OK .m{color:#6dff9a!important;font-weight:700}.ag-log .OK::before{content:'✓ ';color:#6dff9a}.ag-log .WARN::before{content:'⚠ ';color:#ffbd66}.ag-log .ERROR::before{content:'✖ ';color:#ff8a8a}
  @media(max-width:1000px){.ag-pasos{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:700px){.ag-pasos{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.ag-paso{padding:6px 8px}.ag-paso b{font-size:.74rem}.ag-paso em{font-size:.66rem}.ag-datos{grid-template-columns:1fr}.ag-res{padding:12px;gap:10px}.ag-res-top .qa{gap:6px}.ag-res-top h3{flex:1 1 100%}.ag-ahora{font-size:.82rem}details.ag-det div.ag-datos{max-height:none;white-space:normal}}
  @media(max-width:700px){.ag-state{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}.ag-pill{flex:none;white-space:nowrap}.ag-chat{order:1}.ag-res{order:0}.ag-head{padding:10px 12px!important;flex-direction:row!important;align-items:center!important}.ag-head>div:first-child{flex:1 1 auto}.ag-head span.k{display:none}.ag-head h2{font-size:1.1rem!important;margin:0!important}
    .ag-head>div:last-child{width:auto!important;flex:0 0 auto}.ag-head>div:last-child .ag-btn{min-height:36px!important;padding:0 10px!important;flex:0 0 auto!important}
    .ag-paso em{display:none}.ag-paso.corriendo em,.ag-paso.espera em,.ag-paso.error em{display:block}.ag-paso{padding:5px 7px}
    .ag-ver-flujo{display:flex!important}.ag-main:not(.flujo-abierto) .ag-flowcol{display:none}
    .ag-thread{height:52vh!important;min-height:240px!important}
    .ag-state,.ag-chips[data-atajos]{scrollbar-width:none}.ag-state::-webkit-scrollbar,.ag-chips[data-atajos]::-webkit-scrollbar{display:none}}

  /* ---- Escritorio compacto: todo el módulo cabe en la pantalla, sin scroll de página; una sección a la vez (pestañas) ---- */
  @media(min-width:1001px){
    .ag{gap:8px!important}
    .ag-res{padding:8px 14px!important;gap:6px!important;border-radius:12px!important}
    .ag-res-top .qa{gap:8px!important}.ag-res-top .qa b{font-size:.95rem!important}.ag-res-top .qa h3{font-size:10px!important}
    .ag-barra2{height:4px!important}
    .ag-pasos{gap:6px!important}
    .ag-paso{display:flex!important;align-items:baseline;justify-content:space-between;gap:8px;padding:4px 10px!important;border-radius:8px!important}
    .ag-paso b,.ag-paso em{font-size:.74rem!important}
    .ag-ahora{padding:5px 10px!important;font-size:.8rem!important;line-height:1.3!important}
    details.ag-det>summary{cursor:pointer;color:#7da4ff;font:800 11px Arial;letter-spacing:.08em;text-transform:uppercase;list-style:none}
    details.ag-det>summary::-webkit-details-marker{display:none}
    details.ag-det[open]>summary::after{content:' ▴'}details.ag-det:not([open])>summary::after{content:' ▾'}
    .ag-ver-flujo{display:none!important}
    .ag-res .ag-barra2,.ag-res .ag-pasos,.ag-res .ag-ahora{display:none!important}
    .ag-vtabs{display:flex;gap:6px;padding:0 2px}
    .ag-vt{min-height:34px;padding:0 22px;border:1px solid #34432f;border-radius:10px 10px 0 0;background:#0c110d;color:#aebba7;font:900 12px Arial;letter-spacing:.14em;cursor:pointer}
    .ag-vt:hover{color:#eef4e9}.ag-vt.on{background:#d7ff3a;border-color:#d7ff3a;color:#0b1204}
    .ag-res{display:flex!important;align-items:center;gap:16px;padding:4px 14px!important;position:relative}
    .ag-res .ag-res-top{flex:1 1 auto}
    .ag-res details.ag-det{margin:0}
    .ag-res details.ag-det[open] .ag-datos{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;margin:0!important;padding:12px;border:1px solid #34432f;border-radius:12px;background:#0c110d;box-shadow:0 12px 28px rgba(0,0,0,.55)}
    .ag-main{position:relative;display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important;height:max(480px,calc(100vh - 250px))!important;margin-top:-4px}
    .ag-main .ag-orden{position:absolute!important;top:-42px;right:0;height:36px;padding:0 6px!important;border:0!important;background:transparent!important;z-index:5;grid-row:auto!important}
    .ag-main>*,.ag-main .ag-lienzo,.ag-main .ag-live,.ag-main .ag-detalle,.ag-main .ag-chat{grid-column:1!important}
    .ag-main .ag-chat,.ag-main .ag-lienzo,.ag-main .ag-live,.ag-main .ag-detalle{grid-row:1!important;display:none!important;height:auto!important;min-height:0!important;max-height:none!important}
    .ag-main[data-vista="chats"] .ag-chat{display:grid!important}
    .ag-main[data-vista="agentes"] .ag-lienzo{display:block!important;height:100%!important}
    .ag-main[data-vista="pdfs"] .ag-live{display:grid!important}
    .ag-main[data-vista="log"] .ag-detalle{display:grid!important}
    .ag-main[data-vista="chats"] .ag-chat{width:100%}
    .ag-main[data-vista="log"] .ag-detalle header{padding:9px 16px}
  }
  @media(max-width:1000px){.ag-vtabs{display:none!important}}
  `;
  document.head.appendChild(css);

  const celda = v => (String(v || '').trim() ? esc(v) : '<span class="v">—</span>');
  // Ancho de cada columna proporcional a lo que trae (en celular la tabla es de ancho fijo y cabe completa, sin scroll)
  const pantallaChica = () => window.matchMedia && matchMedia('(max-width:700px)').matches;
  // En celular las columnas Diseño y Género se muestran cortas (D1, M/F/N) para que la tabla quepa sin partir palabras; copiar y CSV llevan el dato completo
  function vista(columna, valor) {
    const v = String(valor || '');
    if (!pantallaChica()) return v;
    if (/dise[nñ]o/i.test(columna)) return v.replace(/^DISE[NÑ]O\s*(\d+)$/i, 'D$1').replace(/\s*\+\s*DISE[NÑ]O\s*/gi, '+D');
    if (/g[eé]nero/i.test(columna)) return v.replace(/^MASC(ULINO)?$/i, 'M').replace(/^FEM(ENINO)?$/i, 'F').replace(/^NI[NÑ][OA]S?$/i, 'N').replace(/\s*\/\s*/g, '/');
    return v;
  }
  const cabecera = c => (pantallaChica() ? ({ 'NÚMERO': 'Nº', 'DISEÑO': 'DIS.', 'GÉNERO': 'GÉN.', 'OBSERVACIONES': 'OBSERV.' }[String(c).toUpperCase()] || c) : c);
  function anchos(t) {
    // ancho de cada columna en píxeles según su palabra más larga (así no se parten nombres ni encabezados); los textos largos se reparten en varias líneas
    const mayor = txt => Math.max(0, ...String(txt || '').split(/\s+/).map(w => w.length));
    const px = t.columnas.map((c, k) => Math.max(mayor(cabecera(c)) * 5.8, ...t.filas.map(f => mayor(vista(c, f[k])) * 8.5), 18) + 8);
    const suma = px.reduce((x, y) => x + y, 0);
    return px.map(v => '<col style="width:' + (v / suma * 100).toFixed(1) + '%">').join('');
  }
  function tablaHtml(m) {
    const t = m.tabla;
    return '<div class="ag-tbl"><div class="ag-tbl-head"><b>' + esc(t.titulo) + '</b><span><button type="button" data-tabla-copiar="' + m.id + '">Copiar</button><button type="button" data-tabla-csv="' + m.id + '">Descargar CSV</button></span></div>' +
      '<div class="ag-tbl-wrap"><table><colgroup><col class="n">' + anchos(t) + '</colgroup><thead><tr><th class="n">#</th>' + t.columnas.map(c => '<th>' + esc(cabecera(c)) + '</th>').join('') + '</tr></thead><tbody>' +
      t.filas.map((f, i) => '<tr><td class="n">' + (i + 1) + '</td>' + t.columnas.map((c, k) => '<td>' + celda(vista(c, f[k])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>';
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
  // Pestañas de escritorio: CHATS · AGENTES (mapa del flujo) · PDFS (pantalla en vivo) · LOG (ejecución)
  const VISTAS = ['chats', 'agentes', 'pdfs', 'log'];
  function ponerVista(v) {
    if (!VISTAS.includes(v)) v = 'chats';
    const m = panel && panel.querySelector('[data-main]'); if (!m) return;
    m.dataset.vista = v;
    panel.querySelectorAll('[data-vt]').forEach(b => b.classList.toggle('on', b.dataset.vt === v));
    try { localStorage.setItem('indoor-agentes-vista', v); } catch (er) { /* sin almacenamiento */ }
    ajustarAlto();
    setTimeout(() => { if (v === 'agentes') acomodar(); if (v === 'log') pintarLog(); if (v === 'chats') { const h = panel.querySelector('[data-hilo]'); if (h) h.scrollTop = h.scrollHeight; } }, 30);
  }
  // El módulo ocupa exactamente lo que queda de pantalla (sin scroll de página), con cualquier zoom o barra del navegador
  function ajustarAlto() {
    const m = panel && panel.querySelector('[data-main]'); if (!m) return;
    if (window.innerWidth <= 1000 || !panel.classList.contains('active')) { m.style.removeProperty('height'); return; }
    const alto = window.innerHeight - m.getBoundingClientRect().top - 12;
    m.style.setProperty('height', Math.max(420, Math.round(alto)) + 'px', 'important');
  }
  function acomodar() {
    const lienzo = flow.lienzo; if (!lienzo) return;
    const W = lienzo.clientWidth, H = lienzo.clientHeight; if (!W) return;
    const tam = W > 1000 ? 88 : 60, margen = 44, ancho = tam; flow.tam = tam;
    const porFila = Math.max(3, Math.min(NODOS.length, Math.floor((W - margen * 2 + 40) / (W > 1000 ? 130 : 112))));
    const filas = Math.ceil(NODOS.length / porFila);
    const sep = porFila > 1 ? (W - margen * 2 - ancho) / (porFila - 1) : 0;
    const altoFila = tam + 58, y0 = 54;   // el mapa es una tira: su alto se ajusta a las filas que ocupa
    lienzo.style.height = (y0 + (filas - 1) * altoFila + tam + 46) + 'px';
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
      case 'ELEGIR_PESTANA': poner('LEO', 'espera'); flow.cursor = 'LEO'; pildora('espera', 'Elige una pestaña'); break;
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
  // PANTALLA EN VIVO: imagen del PDF de cada jugador (cambia con su nombre y número) + montajes y PDF que van quedando
  function armarLive(box) {
    box.dataset.listo = '1';
    box.innerHTML = '<div class="ag-live-top"><b><i data-pto></i>PANTALLA EN VIVO</b><small data-estado></small><button type="button" class="seguir" data-seguir hidden>Seguir en vivo</button></div>' +
      '<div class="ag-live-body"><div class="ag-live-vista" data-vista><img alt="PDF de producción"><div class="ag-live-vacio"><div><b>ESPERANDO LOS PDF</b><br>Aquí verás cada PDF de producción, con el nombre y el número de cada jugador, a medida que se genera.</div></div>' +
      '<div class="ag-live-cap" data-cap><span class="num"></span><div><span class="nom"></span><small class="det"></small></div></div><div class="ag-live-prog"><i></i></div></div>' +
      '<aside class="ag-live-side"><div class="ag-live-sec"><h4>MONTAJES <span data-nm>0</span></h4><div class="ag-live-list" data-lm></div></div>' +
      '<div class="ag-live-sec"><h4>PDF DE PRODUCCIÓN <span data-np>0</span></h4><div class="ag-live-list" data-lp></div><small class="dest" data-dp></small></div></aside></div>';
    box.addEventListener('click', e => {
      const fila = e.target.closest('[data-vista]'); if (fila && fila.dataset.vista) { flow.vistaFija = fila.dataset.vista; pintarLive(); return; }
      if (e.target.closest('[data-seguir]')) { flow.vistaFija = null; pintarLive(); }
    });
  }
  function pintarLive() {
    const box = panel && panel.querySelector('[data-live]'); if (!box) return;
    if (!box.dataset.listo) armarLive(box);
    const evs = flow.ejec ? flow.ejec.eventos.filter(e => e.archivo) : [];
    const montajes = [], pdfs = [], vm = new Set(), vp = new Set(); let total = 0, dm = '', dp = '';
    evs.forEach(e => {
      const a = e.archivo;
      if (a.tipo === 'plan') total += Number(a.pdfs) || 0;
      else if (a.tipo === 'montaje' && !vm.has(a.nombre)) { vm.add(a.nombre); montajes.push(a); dm = a.carpeta || dm; }
      else if (a.tipo === 'pdf') { const k = a.detalle || (a.nombre + a.numero + a.talla); if (!vp.has(k)) { vp.add(k); pdfs.push(a); dp = a.carpeta || dp; } }
    });
    const q = sel => box.querySelector(sel);
    q('[data-pto]').className = st.esperando ? 'on' : '';
    q('[data-estado]').textContent = st.esperando ? 'Illustrator está trabajando…' : (evs.length ? 'Última ejecución' : 'Sin ejecución en curso');
    const itemM = a => { const m = /^Talla_([^_]+)_Tipo_(D\d+)_Gen_(\w+)$/.exec(a.nombre || ''); return m ? '<b>' + esc(m[1]) + '</b> · ' + esc(m[2]) + ' · ' + esc(m[3]) : esc(a.nombre); };
    q('[data-nm]').textContent = montajes.length + ' exportados';
    q('[data-lm]').innerHTML = montajes.slice().reverse().slice(0, 60).map((a, i) => '<div' + (i === 0 ? ' class="nuevo"' : '') + '>' + itemM(a) + '</div>').join('') || '<div style="opacity:.5">Esperando…</div>';
    const conVista = pdfs.filter(a => a.vista);
    const fija = flow.vistaFija && conVista.find(a => a.vista === flow.vistaFija);
    if (flow.vistaFija && !fija) flow.vistaFija = null;
    const actual = fija || conVista[conVista.length - 1] || null;
    q('[data-np]').textContent = pdfs.length + (total ? ' de ' + total : '');
    q('[data-lp]').innerHTML = pdfs.slice().reverse().slice(0, 80).map((a, i) => '<div' + (a.vista ? ' data-vista="' + esc(a.vista) + '"' : '') + ' class="' + (i === 0 ? 'nuevo ' : '') + (actual && a.vista === actual.vista ? 'sel' : '') + '">' + (a.cantidad ? '<b>' + esc(a.cantidad) + ' unds</b> · sin nombre ni número · ' + esc(a.talla) : '<b>' + esc(a.nombre || 'Sin nombre') + '</b> · #' + esc(a.numero || '—') + ' · ' + esc(a.talla)) + (a.vista ? '<a class="ag-vlink" href="/api/agentes/archivo/' + encodeURIComponent(a.vista) + '" target="_blank" rel="noopener" title="Ver este PDF en grande (otra pestaña)">↗</a>' : '') + (a.detalle ? '<small class="gd">💾 Guardado como <b>' + esc(a.detalle) + '</b>' + (a.carpeta ? ' · en ' + esc(a.carpeta) : '') + '</small>' : '') + '</div>').join('') || '<div style="opacity:.5">Esperando…</div>';
    q('[data-dp]').textContent = dp ? '→ ' + dp : '';
    q('[data-seguir]').hidden = !fija;
    q('.ag-live-prog i').style.width = (total ? Math.min(100, Math.round(pdfs.length / total * 100)) : 0) + '%';
    const vista = q('[data-vista]'), img = vista.querySelector('img'), cap = q('[data-cap]');
    if (!actual) { img.classList.remove('ok'); img.removeAttribute('src'); delete img.dataset.id; vista.querySelector('.ag-live-vacio').style.display = ''; cap.classList.remove('ok'); return; }
    q('.ag-live-cap .num').textContent = '#' + (actual.numero || '—');
    q('.ag-live-cap .nom').textContent = actual.nombre || 'Sin nombre';
    q('.ag-live-cap .det').textContent = ['Talla ' + actual.talla, actual.diseno, actual.genero].filter(Boolean).join(' · ');
    cap.classList.add('ok');
    if (img.dataset.id !== actual.vista) {   // se precarga para cambiar de imagen sin parpadeo
      const url = '/api/agentes/archivo/' + encodeURIComponent(actual.vista), pre = new Image();
      pre.onload = () => { img.src = url; img.dataset.id = actual.vista; img.classList.add('ok'); vista.querySelector('.ag-live-vacio').style.display = 'none'; vista.classList.remove('cambio'); void vista.offsetWidth; vista.classList.add('cambio'); };
      pre.src = url;
    }
  }
  function pintarLog() {
    const l = panel.querySelector('[data-log]'), f = panel.querySelector('[data-filtros]'); if (!l || !f || !flow.ejec) return;
    const abajo = l.scrollTop + l.clientHeight >= l.scrollHeight - 30;
    const claveFiltro = String(flow.filtro || '');
    if (f.dataset.f !== claveFiltro) {   // un solo selector (en vez de ocho botones)
      f.dataset.f = claveFiltro;
      f.innerHTML = '<select class="ag-pcsel" data-filtro-sel aria-label="Qué mostrar">' + [['Todo', ''], ['⚠ Avisos y errores', '!'], ...['TAVO', 'LEO', 'JACK', 'OLVER', 'OLIVER', 'TERRY'].map(x => [x, x])].map(([t, v]) => '<option value="' + v + '"' + (claveFiltro === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
    }
    const lista = flow.ejec.eventos.filter(e => !flow.filtro || (flow.filtro === '!' ? (e.nivel === 'WARN' || e.nivel === 'ERROR') : e.agente === flow.filtro));
    l.innerHTML = lista.length ? lista.map(e => { const ok = logExito(e); return '<div class="' + esc(e.nivel) + (ok ? ' OK' : '') + '"><span class="h">' + esc(e.hora) + '</span><b style="color:' + (COLORES[e.agente] || '#ccc') + '">' + esc(e.agente) + '</b><span class="m">' + esc(ok || e.msg) + '</span></div>'; }).join('')
      : '<div class="vacio2">' + (flow.filtro ? 'Este nodo aún no ha hecho nada en esta ejecución.' : 'Aquí verás lo que hace cada agente, paso a paso.') + '</div>';
    if (abajo) l.scrollTop = l.scrollHeight;
    pintarLive(); pintarResumen();
  }

  // ================================================================== resumen de la orden, progreso y ayuda
  const PASOS = [['LEO', 'Listado'], ['JACK', 'Muestra'], ['APROB', 'Aprobación'], ['OLVER', 'Mesas'], ['OLIVER', 'PDF por jugador'], ['TERRY', 'MTS y Sheets']];
  const mmss = seg => { seg = Math.max(0, Math.round(seg)); return Math.floor(seg / 60) + ':' + String(seg % 60).padStart(2, '0'); };
  function datosOrden() {
    const evs = flow.ejec ? flow.ejec.eventos : [], d = { mts: [], plantillas: [], ignoradas: [], enProceso: [], blancos: 0, lineas: 0, muestra: '', montajes: 0, pdfs: 0, pdfsPlan: 0, avisos: 0, errores: 0 };
    const vm = new Set(), vp = new Set();
    evs.forEach(e => {
      const m = e.msg || '';
      if (e.nivel === 'WARN') d.avisos++; if (e.nivel === 'ERROR') d.errores++;
      let r;
      if ((r = /LEO informó: (\S+) = cliente (.+) \/ proyecto (.+)$/.exec(m))) { d.orden = r[1]; d.cliente = r[2]; d.proyecto = r[3]; }
      if ((r = /Producción tiene en proceso (.+?): ignoro las demás referencias del listado \((.+)\)/.exec(m))) { d.enProceso = r[1].split(/,\s*/); d.ignoradas = d.ignoradas.concat(r[2].split(/,\s*/)); }
      if ((r = /El listado no trae las referencias (.+?): no hago/.exec(m))) d.ignoradas = d.ignoradas.concat(r[1].split(/,\s*/).map(x => x + ' (maestro)'));
      if ((r = /Promedios maestros: (\S+) -> maestro (.+?); plantillas (.+)$/.exec(m))) d.plantillas.push(r[1] + ': ' + r[3]);
      if ((r = /(\S+): ([\d.,]+) MTS escritos/.exec(m))) d.mts.push(r[1] + ' ' + r[2] + ' MTS');
      if ((r = /Validé (\d+) líneas del listado/.exec(m))) { d.lineas = Number(r[1]); d.blancos = Number((/(\d+) dato\(s\) en blanco/.exec(m) || [])[1] || 0); }
      if (/Muestra lista:|conservo la muestra/.test(m)) d.muestra = /conservo/.test(m) ? 'Conservada (ya existía)' : 'Creada';
      const a = e.archivo;
      if (a) {
        if (a.tipo === 'plan') d.pdfsPlan += Number(a.pdfs) || 0;
        else if (a.tipo === 'montaje' && !vm.has(a.nombre)) { vm.add(a.nombre); d.montajes++; }
        else if (a.tipo === 'pdf') { const k = a.detalle || (a.nombre + a.numero + a.talla); if (!vp.has(k)) { vp.add(k); d.pdfs++; } }
      }
    });
    return d;
  }
  function pintarResumen() {
    const box = panel && panel.querySelector('[data-resumen]'); if (!box || !flow.ejec) return;
    const evs = flow.ejec.eventos;
    if (!evs.length && !st.esperando) { box.hidden = true; return; }
    box.hidden = false;
    const d = datosOrden(), ahora = Date.now() / 1000, primero = evs.length ? evs[0].t : ahora, ultimo = evs.length ? evs[evs.length - 1] : null;
    const corriendo = st.esperando, fin = !corriendo && ['INICIO', 'FIN', 'ERROR'].includes(flow.estadoServidor || 'INICIO');
    const total = (corriendo ? ahora : (ultimo ? ultimo.t : ahora)) - primero;
    const estados = PASOS.map(([id]) => flow.estado[id] || 'inactivo');
    let avance = estados.reduce((a, x) => a + (x === 'ok' ? 1 : (x === 'corriendo' || x === 'espera') ? 0.5 : 0), 0) / PASOS.length * 100;
    if (fin && !d.errores) avance = 100;
    const esperaAprob = flow.estado.APROB === 'espera', esperaOtro = Object.values(flow.estado).includes('espera');
    let ahoraHtml = '', nota = false;
    if (corriendo && ultimo) {
      const desde = ultimo.t, seg = ahora - desde;
      if (/^Exportando mesas de/.test(ultimo.msg) && seg > 8) {
        nota = true;
        ahoraHtml = '<b>OLVER</b> está preparando la plantilla (' + esc(ultimo.msg.replace(/^Exportando mesas de /, '').split(' a ')[0]) + '). La primera vez que se usa una plantilla tarda unos 2 minutos; las siguientes veces, segundos. ' + (seg < 120 ? 'Faltan aprox. ' + mmss(120 - seg) + '.' : 'Casi listo…');
      } else ahoraHtml = '<b>' + esc(ultimo.agente) + '</b> · ' + esc(ultimo.msg) + ' <span style="color:#8f9b8a">(hace ' + mmss(seg) + ')</span>';
    } else if (esperaAprob) { ahoraHtml = '<b>Te toca a ti:</b> revisa la muestra y pulsa Aprobada o Rechazada.'; nota = true; }
    else if (esperaOtro && !corriendo) { ahoraHtml = '<b>Te toca a ti:</b> responde en el chat para que sigan los agentes.'; nota = true; }
    else if (fin && ultimo) ahoraHtml = d.errores ? 'Terminó con <b>' + d.errores + ' error(es)</b>. Revisa el aviso en el chat.' : 'Terminó' + (d.avisos ? ' con ' + d.avisos + ' aviso(s)' : ' sin problemas') + ' en <b>' + mmss(total) + '</b>.';
    const pasosHtml = PASOS.map(([id, nom], i) => {
      const e = estados[i], txt = { ok: 'Listo', corriendo: 'Trabajando…', espera: 'Esperando', error: 'Con error', inactivo: '—' }[e];
      let extra = '';
      if (id === 'OLVER' && d.montajes) extra = ' · ' + d.montajes + ' tallas';
      if (id === 'OLIVER' && d.pdfs) extra = ' · ' + d.pdfs + (d.pdfsPlan ? '/' + d.pdfsPlan : '') + ' PDF';
      return '<div class="ag-paso ' + e + '"><b>' + esc(nom) + '</b><em>' + txt + extra + '</em></div>';
    }).join('');
    const dato = (k, v, aviso) => v ? '<div class="ag-dato' + (aviso ? ' aviso' : '') + '"><small>' + esc(k) + '</small><span>' + esc(v) + '</span></div>' : '';
    const datos = dato('Cliente · proyecto', d.cliente ? d.cliente + ' · ' + d.proyecto : '') + dato('Referencias en proceso', d.enProceso.join(', ')) +
      dato('Ignoradas (no están en proceso o en el listado)', d.ignoradas.join(', '), true) + dato('Plantillas (Promedios maestros)', d.plantillas.join(' | ')) +
      dato('Muestra', d.muestra) + dato('Mesas exportadas', d.montajes ? d.montajes + ' tallas' : '') + dato('PDF de producción', d.pdfs ? d.pdfs + (d.pdfsPlan ? ' de ' + d.pdfsPlan : '') : '') +
      dato('Líneas del listado', d.lineas ? d.lineas + (d.blancos ? ' · ' + d.blancos + ' datos en blanco (nombre/número)' : '') : '', d.blancos > 0) + dato('MTS requeridos', d.mts.join(' · '));
    box.innerHTML = '<div class="ag-res-top"><div class="qa"><h3>Resumen de la orden</h3><b>' + esc(d.orden || st.orden || '') + '</b><small>' + (d.errores ? '✖ ' + d.errores + ' error(es)' : '') + (d.avisos ? ' ⚠ ' + d.avisos + ' aviso(s)' : '') + '</small></div><span class="tiempo">⏱ ' + mmss(total) + (corriendo ? ' en curso' : '') + '</span></div>' +
      '<div class="ag-barra2' + (d.errores ? ' err' : '') + '"><i style="width:' + Math.round(avance) + '%"></i></div><div class="ag-pasos">' + pasosHtml + '</div>' +
      (ahoraHtml ? '<div class="ag-ahora' + (nota ? ' nota' : '') + '">' + ahoraHtml + '</div>' : '') + (datos ? ('<details class="ag-det" data-resdet' + (st.resAbierto ? ' open' : '') + '><summary>Detalles de la orden</summary><div class="ag-datos" style="margin-top:8px">' + datos + '</div></details>') : '');
  }
  setInterval(() => { if (panel && panel.classList.contains('active') && st.esperando) pintarResumen(); }, 1000);

  // Qué significa cada mensaje de error o aviso y qué hacer (con botones que mandan el mensaje al chat)
  const AYUDAS = [
    [/no pude exportar ninguna talla/i, 'Ninguna plantilla del maestro coincide con las tallas del listado.', 'Revisa que el listado tenga talla, género y diseño de la referencia en proceso.', [['Ver listado', 'Qué dice el listado de la orden '], ['Reprocesar', 'Reprocesar la orden ']]],
    [/no pide tallas de dise/i, 'Esa plantilla no se usa en esta orden (el listado no pide ese diseño o género).', 'Normalmente no hay que hacer nada: se salta sola y sigue con las demás.', []],
    [/no aparece en el listado|no está en el listado/i, 'LEO no encontró la orden en el listado.', 'Revisa que la carpeta de la orden esté en la NAS con su Excel y que el código esté bien escrito.', [['Reintentar', 'Reprocesar la orden ']]],
    [/Faltan consumos en Promedios|sin consumo para|no existe el maestro/i, 'Falta el consumo de alguna talla en Promedios maestros.', 'Cárgalo en PROMEDIOS MAESTROS y vuelve a calcular los MTS.', [['Calcular MTS otra vez', 'Calcula los MTS requeridos de la orden ']]],
    [/Illustrator no respondió|Illustrator no pudo abrir|no encuentro el archivo|No encuentro Illustrator/i, 'Illustrator no respondió o no encuentra el archivo.', 'Revisa que Illustrator esté abierto en el PC de los agentes y que la NAS esté conectada; luego reintenta.', [['Reintentar', 'Reprocesar la orden ']]],
    [/sin género claro/i, 'Hay líneas del listado sin género claro (MASC, FEM o NIÑO).', 'Corrige el género en el Excel del listado y reprocesa.', [['Reprocesar', 'Reprocesar la orden ']]],
    [/no hay un Excel|no encontré la fila de encabezados/i, 'No se pudo leer el Excel del listado.', 'Debe estar dentro de la carpeta de la orden y tener una columna TALLA.', [['Ver listado', 'Qué dice el listado de la orden ']]],
    [/no tiene la mesa de trabajo|no tiene mesas de las tallas/i, 'El maestro no trae la mesa de alguna talla pedida.', 'Revisa la plantilla del maestro en la NAS (nombre de las mesas: Talla_M_…).', []],
    [/El Sheet ya tiene MTS/i, 'La tarjeta ya tenía MTS: no se cambiaron.', 'Si necesitas otros, bórralos en la tarjeta y vuelve a calcular.', []],
  ];
  function ayudaDe(texto, esError) {
    const hit = AYUDAS.find(([re]) => re.test(texto)); if (!hit) return '';
    const [, que, hacer, botones] = hit;
    return '<div class="ag-ayuda' + (esError ? ' err' : '') + '"><div><b>' + (esError ? '✖ ' : '⚠ ') + esc(que) + '</b></div><div>💡 ' + esc(hacer) + '</div>' +
      (botones.length ? '<div class="acc">' + botones.map(([t, msg]) => '<button type="button" data-send="' + esc(msg.endsWith(' ') ? msg.trim() + (st.orden ? ' ' + st.orden : '') : msg) + '"' + (st.esperando ? ' disabled' : '') + '>' + esc(t) + '</button>').join('') + '</div>' : '') + '</div>';
  }
  // Los bloques largos de «datos en blanco» se pliegan en un solo renglón
  function textoHtml(texto) {
    const lineas = String(texto || '').split('\n'), out = [];
    for (let i = 0; i < lineas.length; i++) {
      if (/datos? en blanco/i.test(lineas[i]) && /^•/.test(lineas[i + 1] || '')) {
        let j = i + 1; const det = [];
        while (j < lineas.length && /^•/.test(lineas[j])) det.push(lineas[j++]);
        out.push('<details class="ag-det"><summary>' + esc(lineas[i].replace(/^[^A-Za-zÁ-ú0-9]+/, '').replace(/\(no los invento.*?\)/i, '').trim().replace(/:$/, '')) + ' · ' + det.length + ' avisos · ver detalle</summary><div>' + esc(det.join('\n')) + '</div></details>');
        i = j - 1;
      } else out.push(esc(lineas[i]));
    }
    return out.join('\n').replace(/\n(<details)/g, '$1').replace(/(<\/details>)\n/g, '$1');
  }

  // ================================================================== pantalla
  function armar() {
    panel.innerHTML = '<div class="ag"><header class="ag-hd"><h2>AGENTES</h2><div class="ag-state" data-estado></div>' +
      '<nav class="ag-tabs" data-tabs hidden aria-label="PC de los agentes" title="La pestaña activa es el PC donde arranca solo el proceso cuando alguien pone la P en EDICIÓN"></nav>' +
      '<div class="ag-indiv" aria-label="Usar un agente por separado">' + AGENTES_BTN.map(([a, t, p]) => '<button type="button" class="ag-agbtn" style="--c:' + (COLORES[a] || '#c4cfbf') + '" data-atajo="' + esc(p) + '" title="' + esc(a + ': ' + ROLES[a] + ' (usa la orden activa)') + '"><i></i>' + esc(a) + '<small>' + esc(t) + '</small></button>').join('') + '</div>' +
      '<div class="ag-hacc"><button type="button" class="ag-btn danger ag-stop inactivo" data-detener data-txt="⏹ Detener" title="Detiene los agentes de esta pestaña (el PC elegido)">⏹ Detener</button>' +
      '<button type="button" class="ag-btn ag-reiniciar" data-reiniciar title="Reinicia el programa de los agentes en el PC elegido (se cierra y se vuelve a abrir solo)">↻ Reiniciar</button>' +
      '<details class="ag-menu"><summary class="ag-ico" title="Más opciones">⋯</summary><div class="ag-menu-l"><button type="button" data-detener-todo>⏹ Detener todo (ambos PC)</button><button type="button" data-reiniciar-todo>↻ Reiniciar todos los PC</button><button type="button" data-nueva>Nueva conversación</button><button type="button" data-conectar hidden>PC de los agentes…</button></div></details></div></header>' +
      '<div data-aviso></div><section class="ag-res" data-resumen hidden></section>' +
      '<button type="button" class="ag-ver-flujo" data-ver-flujo>▾ Ver flujo, pantalla en vivo y registro</button><nav class="ag-vtabs" data-vtabs aria-label="Secciones de los agentes"><button type="button" class="ag-vt on" data-vt="chats">CHATS</button><button type="button" class="ag-vt" data-vt="agentes">AGENTES</button><button type="button" class="ag-vt" data-vt="pdfs">PDFS</button><button type="button" class="ag-vt" data-vt="log">LOG</button></nav><div class="ag-main" data-main data-vista="chats"><div class="ag-orden" data-orden></div><section class="ag-chat"><div class="ag-thread" data-hilo></div><div class="ag-chips" data-replies></div>' +
      '<form class="ag-form" data-form><details class="ag-menu ag-atajos"><summary class="ag-ico" title="Acciones rápidas">⚡</summary><div class="ag-menu-l">' + ATAJOS.map(([l, p]) => '<button type="button" data-atajo="' + esc(p) + '">' + esc(l) + '</button>').join('') + '</div></details>' +
      '<textarea rows="1" placeholder="Escribe a TAVO…" maxlength="2000"></textarea><button type="submit" class="ag-btn">Enviar</button></form></section>' +
      '<section class="ag-flowcol"><div class="ag-lienzo" data-lienzo><div class="ag-barra"><div class="ag-ftit">Flujo de agentes<small data-ejecnum></small></div><div class="ag-pildora" data-pildora><i></i><span>Listo</span></div></div><svg class="ag-cables" data-cables aria-hidden="true"></svg></div>' +
      '<div class="ag-live" data-live></div>' +
      '<div class="ag-detalle"><header><h3>Ejecución</h3><div class="ag-filtros" data-filtros></div></header><div class="ag-log" data-log></div></div></section></div></div>';
    panel.dataset.armado = '1';
    crearNodos(); pintarLive();
  }

  const KB = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const esImagen = a => ['png', 'jpg', 'jpeg'].includes(a.ext);
  // Los pasos que terminan bien se muestran en verde con un texto claro (muestra creada, mesas exportadas, PDF de producción).
  function logExito(e) {
    if (e.nivel === 'WARN' || e.nivel === 'ERROR') return '';
    const m = String(e.msg || ''), nom = t => String(t).split(/[\\/]/).pop().trim();
    let r;
    if ((r = /^Muestra lista: (.+)$/.exec(m))) return 'MUESTRA CREADA CORRECTAMENTE: ' + nom(r[1]);
    if ((r = /^EXPORTADA: (.+)$/.exec(m))) return 'MESA EXPORTADA CORRECTAMENTE: ' + r[1];
    if ((r = /^(\d+) archivos exportados$/.exec(m))) return 'MESAS EXPORTADAS CORRECTAMENTE: ' + r[1] + ' archivos';
    if ((r = /^PDF listo: (.+)$/.exec(m))) return 'PDF DE PRODUCCIÓN CREADO CORRECTAMENTE: ' + r[1];
    if ((r = /^(\d+) PDF\(s\) de producción en /.exec(m)) && !/con problemas/.test(m)) return 'PDF DE PRODUCCIÓN CREADOS CORRECTAMENTE: ' + r[1];
    return '';
  }
  const abierto = (m, i) => { const k = m.id + ':' + i; return st.abiertos[k] !== undefined ? st.abiertos[k] : (m.archivos[i].tipo === 'muestra' && m.archivos.length <= 2); };
  function archivosHtml(m) {
    return '<div class="ag-files">' + m.archivos.map((a, i) => {
      const url = a.id ? '/api/agentes/archivo/' + a.id : '', ver = a.id && abierto(m, i);
      const previa = ver ? (esImagen(a) ? '<img class="ag-prev" src="' + url + '" alt="' + esc(a.titulo) + '">' : '<iframe class="ag-prev" src="' + url + '#toolbar=0&navpanes=0&view=FitH" loading="lazy" title="' + esc(a.titulo) + '"></iframe>') : '';
      return '<article class="ag-file ' + esc(a.tipo) + (ver ? ' abierto' : '') + '"><div class="ag-file-head"><span class="ag-fico">' + (esImagen(a) ? '🖼️' : /\.ai$/i.test(a.nombre) ? '🎨' : '📄') + '</span><div><b>' + esc(a.titulo || a.nombre) + '</b><small>' + esc(a.nombre) + (a.size ? ' · ' + KB(a.size) : '') + '</small></div></div>' + previa +
        '<div class="ag-file-acc">' + (a.id ? '<button type="button" data-f-ver="' + m.id + ':' + i + '">' + (ver ? 'Ocultar' : 'Ver') + '</button><a href="' + url + '" target="_blank" rel="noopener" title="Abrir en otra pestaña">↗</a><a href="' + url + '?descargar=1" download title="Descargar">⬇</a>' : '<span class="nopre">Sin vista previa</span>') +
        (a.ruta ? '<button type="button" data-f-ruta="' + m.id + ':' + i + '" title="Copiar la ruta del archivo">⧉</button>' : '') + '</div></article>';
    }).join('') + '</div>';
  }


  // Tras ↻ Reiniciar: vigila cada PC hasta que vuelve a conectarse (latido nuevo, 8 s o más después del último que dio el programa viejo) y avisa «listo para usarlo».
  function aviso(texto, ok) {
    let t = document.getElementById('ag-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ag-toast'; t.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;max-width:360px;padding:12px 16px;border-radius:12px;font:700 13px/1.35 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);border:1px solid;cursor:pointer'; t.onclick = () => t.remove(); document.body.appendChild(t); }
    t.style.background = ok ? '#123d1f' : '#3d2a12'; t.style.color = ok ? '#b8ff6a' : '#ffd28a'; t.style.borderColor = ok ? '#7bd13a' : '#c98a2a'; t.textContent = texto;
    return t;
  }
  function esperarReinicio(objetivo) {
    if (!objetivo.length) return;
    const t0 = Date.now(), pendientes = new Map(objetivo.map(o => [o.id, o]));
    aviso('↻ Reiniciando ' + objetivo.map(o => o.nombre).join(' y ') + '… te aviso cuando esté listo.', false);
    const reloj = setInterval(async () => {
      try { await cargar(true); } catch (err) { /* se reintenta */ }
      const lista = st.estado.pcs || [];
      for (const [id, o] of [...pendientes]) {
        const p = lista.find(x => x.id === id);
        if (p && p.conectado && p.visto && p.visto !== o.antes && (!o.antes || Date.parse(p.visto) - Date.parse(o.antes) > 8000)) {
          pendientes.delete(id);
          const msg = '✓ ' + o.nombre + ' está listo para usarlo';
          aviso(msg, true); setTimeout(() => { const t = document.getElementById('ag-toast'); if (t && !pendientes.size) t.remove(); }, 15000);
          try { if (window.Notification && Notification.permission === 'granted') new Notification('Agentes Indoor', { body: msg }); } catch (err) { /* solo aviso en pantalla */ }
          pintar();
        }
      }
      if (!pendientes.size) clearInterval(reloj);
      else if (Date.now() - t0 > 240000) { clearInterval(reloj); aviso('No veo que ' + [...pendientes.values()].map(o => o.nombre).join(' ni ') + ' haya vuelto en 4 minutos. Revisa ese PC.', false); }
    }, 3000);
  }

  function pintar() {
    if (!panel || !panel.dataset.armado) return;
    const e = st.estado, ultimo = st.msgs[st.msgs.length - 1];
    const botones = ultimo && ultimo.rol === 'bot' && !st.esperando ? (ultimo.botones || []) : [];
    const pill = (clase, texto) => '<span class="ag-pill ' + clase + '"><i></i>' + esc(texto) + '</span>';
    const modo = v => !v ? '' : v === 'real' ? 'ok' : /^error/.test(v) ? 'mal' : 'sim';
    panel.querySelector('[data-estado]').innerHTML = pill(e.conectado ? 'ok' : 'mal', (e.pc && e.pc.nombre ? e.pc.nombre + ' · ' : '') + (e.conectado ? 'PC conectado' : 'PC desconectado')) + (e.conectado && e.illustrator ? pill(modo(e.illustrator), 'Illustrator: ' + e.illustrator) : '') + (e.conectado && e.sheets ? pill(modo(e.sheets), 'Sheets: ' + e.sheets) : '') +
      '<button type="button" class="ag-pill ' + (e.auto ? 'ok' : 'sim') + '" data-auto title="Cuando una tarjeta de EDICIÓN pasa a «en proceso», los agentes arrancan solos con esa orden. Toca para ' + (e.auto ? 'apagar' : 'encender') + '" style="cursor:pointer"><i></i>Auto ' + (e.auto ? 'ON' : 'OFF') + '</button>';
    panel.querySelector('[data-aviso]').innerHTML = !e.conectado ? '<div class="ag-warn">El PC «' + esc((e.pc && e.pc.nombre) || 'de los agentes') + '» no está conectado. Tu mensaje queda en cola y se atiende cuando ese PC esté encendido con los agentes iniciados' + ((e.pcs || []).some(p => p.conectado && p.id !== (e.pc && e.pc.id)) ? '; también puedes elegir otro PC conectado arriba.' : '.') + '</div>' : '';
    const trabajo = st.trabajo;
    const hilo = st.msgs.length ? st.msgs.map(m => m.rol === 'yo'
      ? '<div class="ag-msg yo"><p class="ag-txt">' + esc(m.texto) + '</p><span class="ag-time">' + hora(m.creado) + '</span></div>'
      : '<div class="ag-msg bot' + (m.estado === 'ERROR' ? ' err' : '') + (m.tabla || (m.archivos && m.archivos.length) ? ' con-tabla' : '') + '"><div class="ag-who">' + (m.agentes && m.agentes.length ? m.agentes : ['TAVO']).map(tag).join('') + '</div><p class="ag-txt">' + textoHtml(m.tabla ? m.texto.split(/\n\nDesglose del listado/)[0] : m.texto) + '</p>' + (m.estado === 'ERROR' || /^[A-Z]+: /.test(m.texto) ? ayudaDe(m.texto, m.estado === 'ERROR' || /no pude|no pudo|falt|no aparece|no está/i.test(m.texto)) : '') + (m.tabla ? tablaHtml(m) : '') + (m.archivos && m.archivos.length ? archivosHtml(m) : '') + '<span class="ag-time">' + hora(m.creado) + '</span></div>').join('')
      : '<div class="ag-empty"><h3>¿Qué necesitas hoy?</h3><p>Fija la orden arriba y pídele lo que necesites, por ejemplo «exporta las mesas». TAVO decide qué agente actúa.</p></div>';
    const trabajando = st.esperando ? '<div class="ag-work"><div class="ag-who">' + ((trabajo && trabajo.agentes) || ['TAVO']).map(a => tag(a)).join('') + '<span class="ag-dots"><i></i><i></i><i></i></span></div><b>' +
      esc(trabajo && trabajo.msg ? trabajo.agente + ': ' + trabajo.msg : e.conectado ? 'TAVO está trabajando…' : 'Esperando al PC de los agentes…') + '</b><button type="button" class="ag-btn danger" data-detener>Detener</button></div>' : '';
    const barra = panel.querySelector('[data-orden]'), claveOrden = st.orden + '|' + st.cambiandoOrden;
    if (barra.dataset.clave !== claveOrden) {
      barra.dataset.clave = claveOrden;
      barra.innerHTML = st.orden && !st.cambiandoOrden
        ? '<span class="ag-ochip" title="Todo lo que pidas se hace con esta orden">Orden <b>' + esc(st.orden) + '</b><button type="button" class="ag-ico" data-orden-cambiar title="Cambiar la orden">✎</button><button type="button" class="ag-ico" data-orden-quitar title="Quitar la orden">✕</button></span><button type="button" class="ag-btn" data-iniciar title="Lee el listado, crea la muestra, te pide aprobarla y sigue con las mesas y los PDF de producción">▶ Iniciar</button><button type="button" class="ag-btn sec" data-reprocesar title="Vuelve a procesar una orden que ya se hizo: tú eliges si reemplazas todo o conservas lo que ya existe">↻ Reprocesar</button>'
        : '<form data-orden-form><label for="ag-orden-in">Orden</label><input id="ag-orden-in" maxlength="12" autocomplete="off" placeholder="CO6133" value="' + esc(st.orden) + '" title="Escríbela una sola vez y TAVO relaciona todo con ella"><button type="submit" class="ag-btn">Fijar</button>' + (st.orden ? '<button type="button" class="ag-ico" data-orden-cancelar title="Cancelar">✕</button>' : '') + '</form>';
      if (st.cambiandoOrden) panel.querySelector('#ag-orden-in')?.focus();
    }
    panel.querySelector('textarea').placeholder = st.orden ? 'Pídele a TAVO (usa la orden ' + st.orden + ')…' : 'Escribe a TAVO…';
    const hiloEl = panel.querySelector('[data-hilo]'), firma = hilo + trabajando;
    if (hiloEl.dataset.firma !== firma) { hiloEl.innerHTML = firma; hiloEl.dataset.firma = firma; hiloEl.scrollTop = hiloEl.scrollHeight; }
    panel.querySelector('[data-replies]').innerHTML = botones.map(b => '<button type="button" class="reply" data-send="' + esc(b) + '">' + esc(b) + '</button>').join('');
    panel.querySelectorAll('[data-atajo]').forEach(b => { b.disabled = st.esperando; });
    panel.querySelector('header [data-detener]').classList.toggle('inactivo', !st.esperando);   // el botón siempre está: se ve apagado cuando no hay nada en marcha
    const ini = panel.querySelector('[data-iniciar]'); if (ini) ini.disabled = st.esperando || st.enviando;
    const repro = panel.querySelector('[data-reprocesar]'); if (repro) repro.disabled = st.esperando || st.enviando;
    panel.querySelector('textarea').disabled = st.esperando;
    panel.querySelector('[data-form] button[type="submit"]').disabled = st.esperando || st.enviando;
    if (st.admin) panel.querySelector('[data-conectar]').hidden = false;
    const tabsEl = panel.querySelector('[data-tabs]');
    if (tabsEl) {
      const listaT = e.pcs || [], firmaT = JSON.stringify(listaT) + '|' + st.pc;
      tabsEl.hidden = listaT.length < 2;
      if (listaT.length > 1 && tabsEl.dataset.f !== firmaT) {
        tabsEl.dataset.f = firmaT;
        tabsEl.innerHTML = listaT.map(p => '<button type="button" class="ag-tab' + (p.id === st.pc ? ' on' : '') + (p.ocupado ? ' ocupado' : '') + '" data-pc-tab="' + esc(p.id) + '"><i class="' + (p.conectado ? 'ok' : 'mal') + '"></i><b>' + esc(p.nombre) + '</b><em>' +
          (p.ocupado ? esc(p.trabajo || 'trabajando…') : (p.conectado ? 'libre' : 'desconectado')) + '</em></button>').join('');
      }
    }
    const selPc = panel.querySelector('[data-pc-activo]');
    if (selPc) {
      selPc.hidden = !st.admin;
      const lista = e.pcs || [], firma = lista.map(p => p.id + p.nombre + (p.conectado ? '1' : '0')).join(',') + '|' + (e.pc_activo || '');
      if (selPc.dataset.firma !== firma) {
        selPc.title = 'PC donde arranca solo el proceso cuando alguien pone la P en EDICIÓN';
        selPc.innerHTML = '<option value="">Inicio automático en: cualquiera</option>' + lista.map(p => '<option value="' + esc(p.id) + '">' + (p.conectado ? '● ' : '○ ') + esc(p.nombre) + '</option>').join('');
        selPc.value = e.pc_activo || ''; selPc.dataset.firma = firma;
      }
    }
  }
  function render() { pintar(); }

  async function fijarOrden(codigo) {
    try {
      const r = await api('/api/agentes/orden', { method: 'POST', body: JSON.stringify({ orden: codigo, pc: st.pc }) });
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
      const r = await api('/api/agentes/mensaje', { method: 'POST', body: JSON.stringify({ mensaje: texto, pc: st.pc }) });
      flow.preparado = r.id; st.esperando = true; await cargar(true);
    } catch (e) { alert(e.message); flow.listo = false; }
    st.enviando = false; pintar(); programar();
  }

  // Cada PC con Illustrator tiene su propia pestaña (su chat, su flujo y su registro): se puede trabajar en uno mientras el otro está ocupado
  function elegirPcInicial(e) {
    const lista = (e && e.pcs) || [];
    let guardado = ''; try { guardado = localStorage.getItem('agentes_pc') || ''; } catch (x) { /* sin almacenamiento */ }
    const ok = id => lista.some(p => p.id === id), ocupado = lista.find(p => p.ocupado);
    return (ok(e && e.pc_activo) && e.pc_activo) || (ok(guardado) && guardado) || (ocupado && ocupado.id) || (e && e.pc && e.pc.id) || 'principal';
  }
  // La pestaña activa es también el PC donde arranca solo el proceso (la P de EDICIÓN): se guarda en el servidor al cambiar de pestaña
  async function sincronizarPcAuto(id) {
    if (!st.admin || !id) return;
    try { await api('/api/agentes/pc-activo', { method: 'POST', body: JSON.stringify({ pc: id }) }); } catch (x) { /* sin permiso o sin conexión */ }
  }
  async function cambiarPc(id) {
    if (!id || id === st.pc) return;
    st.pc = id; try { localStorage.setItem('agentes_pc', id); } catch (x) { /* sin almacenamiento */ }
    sincronizarPcAuto(id);
    Object.assign(st, { msgs: [], ultimo: 0, evs: [], ultimoEv: 0, trabajo: null, esperando: false, orden: '', cambiandoOrden: false, enviando: false, resAbierto: false });
    flow.listo = false; flow.preparado = 0; flow.estadoServidor = null; flow.vistaFija = null;
    const h = panel.querySelector('[data-hilo]'); if (h) { h.dataset.firma = ''; h.innerHTML = ''; }
    const b = panel.querySelector('[data-orden]'); if (b) b.dataset.clave = '';
    await cargar(true); pintar(); programar();
  }
  async function cargar(forzar) {
    if (st.cargando && !forzar) return;
    st.cargando = true;
    try {
      const canal = st.pc || '', q = canal ? '&pc=' + encodeURIComponent(canal) : '';
      const [datos, estado] = await Promise.all([api('/api/agentes/mensajes?desde=' + st.ultimo + '&desde_ev=' + st.ultimoEv + q), api('/api/agentes/estado' + (canal ? '?pc=' + encodeURIComponent(canal) : ''))]);
      if (!st.pc) { st.pc = elegirPcInicial(estado); try { localStorage.setItem('agentes_pc', st.pc); } catch (e) { /* sin almacenamiento */ } if (st.pc !== (estado.pc_activo || '')) sincronizarPcAuto(st.pc); st.cargando = false; return cargar(true); }
      if (canal !== st.pc) { st.cargando = false; return; }   // cambiaste de pestaña mientras se consultaba: se descarta
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

  // Administración de los PC con Illustrator (EDICION y AUTOMATIZACION): estado, agregar, código nuevo, quitar
  async function conectar() {
    const dlg = document.createElement('dialog');
    dlg.className = 'ag-dlg';
    let datos, nuevo = null;
    const cargarPcs = async () => { datos = await api('/api/agentes/pcs'); };
    const pintar = () => {
      const filas = datos.pcs.map(p => '<div class="ag-pcrow"><div><b>' + esc(p.nombre) + '</b><small>' + (p.conectado ? '● conectado' : '○ desconectado') + (p.equipo ? ' · ' + esc(p.equipo) : '') + (p.illustrator ? ' · Illustrator: ' + esc(p.illustrator) : '') + '</small></div>' +
        '<span><button type="button" class="ag-btn sec" data-pc-token="' + esc(p.id) + '">Código nuevo</button>' + (p.principal ? '' : '<button type="button" class="ag-btn danger" data-pc-quitar="' + esc(p.id) + '">Quitar</button>') + '</span></div>').join('');
      const caja = nuevo ? '<div class="ag-pcnuevo"><b>Código de ' + esc(nuevo.nombre || 'este PC') + '</b> (se muestra una sola vez; trátalo como una contraseña)<code data-token>' + esc(nuevo.token) + '</code><b style="font-size:.8rem">Dirección del panel</b><code>' + esc(nuevo.url) + '</code>' +
        '<ol><li>En ese PC abre la carpeta <b>agentes_uniformes</b>.</li><li>Ejecuta <b>conectar_panel.bat</b> (o <b>INSTALAR_TODO.bat</b> si es la primera vez) y pega la dirección y el código.</li><li>Abre <b>iniciar.bat</b>: aquí debe aparecer «conectado».</li></ol><button type="button" class="ag-btn sec" data-copiar>Copiar código</button></div>' : '';
      dlg.innerHTML = '<div class="b"><h2>PC de los agentes</h2><p style="margin:0;color:#aebba7;font-size:.88rem">Cada PC con Illustrator se conecta con su propio código. En el encabezado de AGENTES eliges en cuál se hace el proceso.</p>' +
        filas + caja + '<form class="ag-pcadd" data-pc-add><input maxlength="40" placeholder="Nombre del PC nuevo, por ejemplo AUTOMATIZACION" required><button type="submit" class="ag-btn">Agregar PC</button></form>' +
        '<div class="row"><button type="button" class="ag-btn" data-cerrar>Cerrar</button></div></div>';
      dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
      const cp = dlg.querySelector('[data-copiar]'); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(nuevo.token); } catch (e) { /* sin portapapeles */ } };
      dlg.querySelectorAll('[data-pc-token]').forEach(b => { b.onclick = async () => {
        const p = datos.pcs.find(x => x.id === b.dataset.pcToken);
        if (!confirm('El PC «' + p.nombre + '» dejará de conectarse hasta que le pongas el código nuevo. ¿Generar uno nuevo?')) return;
        try { const r = await api('/api/agentes/pcs/' + encodeURIComponent(p.id) + '/token', { method: 'POST', body: '{}' }); nuevo = { ...r, nombre: p.nombre }; await cargarPcs(); pintar(); } catch (e) { alert(e.message); } }; });
      dlg.querySelectorAll('[data-pc-quitar]').forEach(b => { b.onclick = async () => {
        const p = datos.pcs.find(x => x.id === b.dataset.pcQuitar);
        if (!confirm('¿Quitar el PC «' + p.nombre + '»? Dejará de poder conectarse.')) return;
        try { await api('/api/agentes/pcs/' + encodeURIComponent(p.id), { method: 'DELETE' }); nuevo = null; await cargarPcs(); pintar(); cargar(true); } catch (e) { alert(e.message); } }; });
      dlg.querySelector('[data-pc-add]').onsubmit = async ev => {
        ev.preventDefault();
        try { const r = await api('/api/agentes/pcs', { method: 'POST', body: JSON.stringify({ nombre: ev.target.querySelector('input').value }) }); nuevo = r; await cargarPcs(); pintar(); cargar(true); } catch (e) { alert(e.message); }
      };
    };
    try { await cargarPcs(); } catch (e) { alert(e.message); return; }
    pintar();
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
      // los menús (⋯ y ⚡) se cierran al elegir una opción o al tocar fuera
      panel.querySelectorAll('details.ag-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.ag-menu-l button')) d.removeAttribute('open'); });
      const pestana = e.target.closest('[data-pc-tab]'); if (pestana) { await cambiarPc(pestana.dataset.pcTab); return; }
      if (e.target.closest('[data-orden-cambiar]')) { st.cambiandoOrden = true; pintar(); return; }
      if (e.target.closest('[data-orden-cancelar]')) { st.cambiandoOrden = false; pintar(); return; }
      if (e.target.closest('[data-orden-quitar]')) { await fijarOrden(''); return; }
      const filtro = e.target.closest('[data-filtro]'), reply = e.target.closest('[data-send]'), atajo = e.target.closest('[data-atajo]');
      if (filtro) { filtrar(filtro.dataset.filtro || null); return; }
      const fv = e.target.closest('[data-f-ver]'), fr = e.target.closest('[data-f-ruta]');
      if (fv) { const [mid, i] = fv.dataset.fVer.split(':'), m = st.msgs.find(x => String(x.id) === mid); if (m) { st.abiertos[fv.dataset.fVer] = !abierto(m, Number(i)); pintar(); } return; }
      if (fr) { const [mid, i] = fr.dataset.fRuta.split(':'), m = st.msgs.find(x => String(x.id) === mid); const ruta = m && m.archivos[Number(i)] && m.archivos[Number(i)].ruta; if (ruta) { try { await navigator.clipboard.writeText(ruta); } catch (err) { /* sin portapapeles */ } fr.textContent = '✓'; setTimeout(() => { fr.textContent = '⧉'; }, 1500); } return; }
      if (e.target.closest('[data-tabla-copiar]')) { const b = e.target.closest('[data-tabla-copiar]'); copiarTabla(b.dataset.tablaCopiar); b.textContent = '¡Copiado!'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); }
      else if (e.target.closest('[data-tabla-csv]')) csvTabla(e.target.closest('[data-tabla-csv]').dataset.tablaCsv);
      else if (reply) enviar(reply.dataset.send);
      else if (atajo) {
        const texto = atajo.dataset.atajo;
        if (texto.endsWith(' ') && st.orden) enviar(texto.trim() + ' ' + st.orden);
        else if (texto.endsWith(' ')) { const caja = panel.querySelector('textarea'); caja.value = texto; caja.focus(); caja.setSelectionRange(texto.length, texto.length); } else enviar(texto);
      } else if (e.target.closest('[data-auto]')) {
        try { const r = await api('/api/agentes/auto', { method: 'POST', body: JSON.stringify({ activo: !st.estado.auto }) }); st.estado = { ...st.estado, auto: r.activo }; } catch (err) { alert(err.message); }
        pintar();
      } else if (e.target.closest('[data-reprocesar]')) {
        if (!st.esperando && st.orden) enviar('Reprocesar la orden ' + st.orden);
      } else if (e.target.closest('[data-iniciar]')) {
        if (!st.esperando && st.orden) enviar('Pedido completo de la orden ' + st.orden);
      } else if (e.target.closest('[data-detener-todo]')) {
        const ids = (st.estado.pcs || []).map(p => p.id); if (!ids.length) ids.push(st.pc || 'principal');
        for (const id of ids) { try { await api('/api/agentes/detener', { method: 'POST', body: JSON.stringify({ pc: id }) }); } catch (err) { alert(err.message); } }
        st.esperando = false; st.trabajo = null; await cargar(true); pintar();
      } else if (e.target.closest('[data-reiniciar]') || e.target.closest('[data-reiniciar-todo]')) {
        const todos = !!e.target.closest('[data-reiniciar-todo]');
        if (!confirm(todos ? '¿Reiniciar los agentes de TODOS los PC? Lo que estén haciendo se corta.' : '¿Reiniciar los agentes de este PC? Lo que estén haciendo se corta.')) return;
        const lista = st.estado.pcs || [], objetivo = todos ? lista : lista.filter(p => p.id === st.pc);
        try { await api('/api/agentes/reiniciar', { method: 'POST', body: JSON.stringify({ pc: todos ? '*' : st.pc }) }); } catch (err) { alert(err.message); return; }
        try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (err) { /* sin avisos del navegador: queda el aviso en pantalla */ }
        esperarReinicio(objetivo.map(p => ({ id: p.id, nombre: p.nombre, antes: p.visto || '' })));
        st.esperando = false; st.trabajo = null; await cargar(true); pintar();
      } else if (e.target.closest('[data-detener]')) {
        const b = e.target.closest('[data-detener]'), orig = b.dataset.txt || 'Detener'; b.disabled = true; b.textContent = 'Deteniendo…';
        try { await api('/api/agentes/detener', { method: 'POST', body: JSON.stringify({ pc: st.pc }) }); } catch (err) { b.disabled = false; b.textContent = orig; alert(err.message); return; }
        st.esperando = false; st.trabajo = null; await cargar(true); pintar();
        b.disabled = false; b.textContent = orig;
      } else if (e.target.closest('[data-nueva]')) {
        if (st.msgs.length && !confirm('¿Borrar esta conversación? Los agentes empiezan de cero.')) return;
        try { await api('/api/agentes/limpiar', { method: 'POST', body: JSON.stringify({ pc: st.pc }) }); } catch (err) { alert(err.message); return; }
        st.msgs = []; st.ultimo = 0; st.evs = []; st.ultimoEv = 0; st.trabajo = null; flow.listo = false; flow.preparado = 0; await cargar(true); pintar();
      } else if (e.target.closest('[data-conectar]')) conectar();
    });
    try { ponerVista(localStorage.getItem('indoor-agentes-vista') || 'chats'); } catch (er) { /* sin almacenamiento */ }
    window.addEventListener('resize', ajustarAlto);
    if (window.ResizeObserver) { const ro2 = new ResizeObserver(ajustarAlto); ['.ag-hd', '.ag-res', '.ag-vtabs'].forEach(q => { const el = panel.querySelector(q); if (el) ro2.observe(el); }); }
    setInterval(ajustarAlto, 1500);
    panel.addEventListener('click', e => {
      const vt = e.target.closest('[data-vt]');
      if (vt) { ponerVista(vt.dataset.vt); return; }
      const b = e.target.closest('[data-ver-flujo]'); if (!b) return;
      const main = panel.querySelector('[data-main]'), abierto = main.classList.toggle('flujo-abierto');
      b.textContent = abierto ? '▴ Ocultar flujo, pantalla en vivo y registro' : '▾ Ver flujo, pantalla en vivo y registro';
      if (abierto) { acomodar(); pintarLog(); }
    });
    panel.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('[data-resdet]')) st.resAbierto = e.target.open; }, true);
    panel.addEventListener('change', async e => {
      if (e.target.matches('[data-filtro-sel]')) { filtrar(e.target.value || null); return; }
      if (!e.target.matches('[data-pc-activo]')) return;
      try { await api('/api/agentes/pc-activo', { method: 'POST', body: JSON.stringify({ pc: e.target.value }) }); } catch (err) { alert(err.message); }
      await cargar(true); pintar();
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
    const anterior = document.getElementById('open-personal-notes');
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
