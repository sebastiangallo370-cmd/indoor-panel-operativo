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
  const avatar = a => '<span class="ag-av" style="--c:' + (COLORES[a] || '#c4cfbf') + '" aria-hidden="true">' + esc(String(a || 'T')[0]) + '</span>';
  const sinTildes = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tag = a => '<span class="ag-tag" style="--c:' + (COLORES[a] || '#c4cfbf') + '">' + esc(a) + '</span>';

  const css = document.createElement('style');
  css.textContent = `
  .tab[data-kind='agentes'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='agentes']){display:none!important}}
  body:has(.panel[data-panel='agentes'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important;padding-top:10px!important}
  .ag{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;width:100%;max-width:none;margin:0;min-width:0}.ag>*{min-width:0}.ag button{width:auto}
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
  .ag-ai-btn{margin-left:auto!important;border-color:#d7ff3a!important;color:#d7ff3a!important}.ag-ai-btn:hover{background:#d7ff3a;color:#0b1204!important}.ag-ai-btn+.ag-live-cnt{margin-left:10px}.ag-live-list .ag-vlink.ag-ai{margin-left:6px;letter-spacing:.04em}
  @media(max-width:1000px){.ag-ai-btn,.ag-ai{display:none!important}}
  .ag-live-cnt{margin-left:auto;color:#aebba7;font:800 12px Arial}.ag-live-cnt+.seguir{margin-left:8px}
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
  .ag-live-list{grid-auto-rows:max-content}.ag-live-list div{flex:none;min-height:24px}.ag-live-list .mt-nom{font:700 12px Consolas,ui-monospace,monospace;color:#e9efe3;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis}
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
  .ag-nas{display:inline-flex;align-items:center;gap:6px;text-decoration:none;white-space:nowrap}.ag-nas span{font-weight:900}
  .ag-orden .ag-btn{min-height:36px;padding:0 14px}
  .ag-who{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.ag-tag{padding:2px 9px;border-radius:999px;font:900 10px Arial;letter-spacing:.06em;color:var(--c);background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 45%,transparent)}
  .ag-txt{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:#eef4e9}
  .ag-chat{position:relative}
  /* chat: avatar y color por agente, burbujas con cola, estado del mensaje y entrada suave */
  .ag-av{display:inline-grid;place-items:center;flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--c) 22%,#0c110d);border:1.5px solid var(--c);color:var(--c);font:900 11px Arial}
  .ag-msg.bot{border-left-color:var(--c,#7da4ff);border-top-left-radius:5px}.ag-msg.yo{border-bottom-right-radius:5px}
  .ag-msg .ag-time{color:#8f9b8a;font:600 10.5px Arial}.ag-msg.yo .ag-time{justify-self:end}
  .ag-est{font-style:normal;margin-left:4px;color:#8f9b8a;letter-spacing:-.12em}.ag-est.ok{color:#d0f44c}.ag-est.cola{letter-spacing:0;color:#ffcf5c}
  .ag-entra{animation:ag-entra .28s ease-out}@keyframes ag-entra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .ag-hallado{outline:2px solid #d0f44c;outline-offset:3px;transition:outline-color .4s}
  .ag-empty-av{display:flex;justify-content:center;margin-bottom:14px}.ag-empty-av .ag-av{width:34px;height:34px;margin-left:-7px;font-size:13px;box-shadow:0 0 0 3px #0f1410}.ag-empty-av .ag-av:first-child{margin-left:0}
  .ag-empty p b{color:#d0f44c}.ag-empty-acc{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:16px}
  .ag-empty-acc button,.ag-chips button.rap{width:auto!important;min-height:0!important;padding:8px 14px!important;border:1px solid #3d4f3d!important;border-radius:999px!important;background:rgba(255,255,255,.03)!important;color:#dfe7d6!important;font:700 12px Arial!important;cursor:pointer;white-space:nowrap}
  .ag-empty-acc button:hover:not(:disabled),.ag-chips button.rap:hover:not(:disabled){border-color:#d0f44c!important;color:#d0f44c!important}
  .ag-chips.rapidas{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}.ag-chips.rapidas::-webkit-scrollbar{display:none}.ag-chips.rapidas:empty{display:none}
  /* sugerencias al escribir */
  .ag-form{position:relative}
  .ag-sug{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:25;display:grid;gap:2px;padding:6px;border:1px solid #3d4f3d;border-radius:14px;background:#111611;box-shadow:0 -12px 30px rgba(0,0,0,.55)}.ag-sug[hidden]{display:none}
  .ag-sug button{display:flex!important;gap:10px;align-items:baseline;justify-content:space-between;width:100%!important;min-height:0!important;padding:9px 12px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:#eef4e9!important;font:700 13px Arial!important;text-align:left!important;cursor:pointer}
  .ag-sug button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ag-sug button small{flex:0 0 auto;color:#8f9b8a;font:600 10.5px Arial}
  .ag-sug button[aria-selected=true],.ag-sug button:hover{background:#1f2c1c!important}.ag-sug button[aria-selected=true] span{color:#d0f44c}
  .ag-sug p{margin:2px 0 0;padding:5px 12px 2px;border-top:1px solid rgba(255,255,255,.07);color:#77836f;font:600 10px Arial}
  .ag-campana.on{border-color:#d0f44c}
  /* historial */
  .ag-hist{position:fixed;inset:0;z-index:100030;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,6,4,.78);backdrop-filter:blur(5px)}
  .ag-hist-card{width:min(720px,100%);height:min(86vh,780px);display:flex;flex-direction:column;gap:12px;padding:18px;box-sizing:border-box;border:1px solid #2d3b2f;border-radius:20px;background:#0f1410;color:#eef4e9;box-shadow:0 40px 90px rgba(0,0,0,.65)}
  .ag-hist .ag-ico,.ag-hist .ag-btn{width:auto!important;flex:0 0 auto;margin:0!important}
  .ag-hist-card header{display:flex!important;align-items:center;justify-content:space-between!important;gap:12px;width:100%;margin:0;padding:0;border:0;background:none}.ag-hist-card header b{font:800 11px Arial;letter-spacing:.2em;color:#cfd9c7}
  .ag-hist-card input[type=search]{width:100%!important;box-sizing:border-box!important;min-height:44px;margin:0!important;padding:0 14px!important;border:1px solid #3d4f3d!important;border-radius:12px!important;background:#0c110d!important;color:#f1f7ed!important;font:600 14px Arial!important;outline:none;color-scheme:dark}.ag-hist-card input[type=search]:focus{border-color:#d0f44c!important}
  .ag-hist-cuerpo{flex:1;min-height:0;overflow-y:auto;display:grid;gap:6px;align-content:start;padding-right:4px}
  .ag-hist-sec{margin:8px 0 2px;color:#8f9b8a;font:800 10px Arial;letter-spacing:.16em;text-transform:uppercase}.ag-hist-vacio{margin:4px 0;color:#8f9b8a;font:500 13px/1.5 Arial}
  .ag-hist-item{display:grid!important;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;width:100%!important;min-height:0!important;padding:10px 12px!important;border:1px solid #2d3b2f!important;border-radius:12px!important;background:rgba(255,255,255,.025)!important;color:#eef4e9!important;text-align:left!important;cursor:pointer}
  .ag-hist-item:hover{border-color:#d0f44c!important}.ag-hist-item b{color:#d0f44c;font:800 12px Arial}.ag-hist-item span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12.5px Arial}.ag-hist-item small{grid-column:1/-1;color:#8f9b8a;font:600 10.5px Arial}
  .ag-hist-cab{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#aebba7;font:700 12px Arial}.ag-hist-hilo{overflow:visible}
  @media(max-width:700px){.ag-hist{padding:0;align-items:flex-end}.ag-hist-card{height:92vh;border-radius:20px 20px 0 0;padding:14px}.ag-msg{max-width:94%}.ag-sug button small{display:none}}
  @media(prefers-reduced-motion:reduce){.ag-entra{animation:none}}
  /* ===== vista AGENTES: flujo y registro con acabado más sobrio ===== */
  .ag .ag-lienzo{border-color:#263226;background-color:#0b100c;background-image:linear-gradient(180deg,rgba(208,244,76,.035),transparent 55%),radial-gradient(rgba(255,255,255,.055) 1px,transparent 1px);background-size:auto,22px 22px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
  .ag .ag-ftit{padding:0;border:0;background:none;font:800 11px Arial;letter-spacing:.18em;text-transform:uppercase;color:#cfd9c7}.ag .ag-ftit small{margin-left:10px;padding:3px 9px;border:1px solid #2d3b2f;border-radius:999px;color:#8f9b8a;font:700 10px Arial;letter-spacing:.06em;text-transform:none}
  .ag .ag-pildora{padding:5px 13px;border-color:#2d3b2f;background:rgba(255,255,255,.03);font:800 10.5px Arial;letter-spacing:.1em;text-transform:uppercase}
  .ag .ag-nodo .cj{border:1.5px solid #2f3d30;border-radius:18px;background:linear-gradient(160deg,#182019,#0e130f);color:var(--c);box-shadow:0 10px 22px -12px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.06)}
  .ag .ag-nodo .cj::before{left:22%;right:22%;top:auto;bottom:-1.5px;width:auto;height:3px;border-radius:3px 3px 0 0;background:var(--c);opacity:.85}
  .ag .ag-nodo .cj svg{width:46%;height:46%;display:block}
  .ag .ag-nodo:hover .cj,.ag .ag-nodo:focus-visible .cj{border-color:color-mix(in srgb,var(--c) 60%,#2f3d30);transform:translateY(-2px)}
  .ag .ag-nodo.sel .cj{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 28%,transparent),0 10px 22px -12px rgba(0,0,0,.9)}
  .ag .ag-nodo .paso{position:absolute;left:-7px;top:-7px;z-index:1;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1px solid #2f3d30;background:#0b100c;color:#8f9b8a;font:800 10px Arial;font-style:normal}
  .ag .ag-nodo.ok .paso,.ag .ag-nodo.corriendo .paso{border-color:var(--c);color:var(--c)}
  .ag .ag-nodo .puerto{width:9px;height:9px;top:calc(var(--tam,68px)/2 - 4.5px);background:#0b100c;border:2px solid #3a4a3a;transition:border-color .3s,background .3s,box-shadow .3s}.ag .ag-nodo .puerto.in{left:-5.5px}.ag .ag-nodo .puerto.out{right:-5.5px}
  .ag .ag-nodo.ok .puerto,.ag .ag-nodo.corriendo .puerto.in{border-color:var(--c);background:var(--c)}.ag .ag-nodo.corriendo .puerto.in{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 25%,transparent)}
  /* estados del nodo con el color de cada agente */
  .ag .ag-nodo .cj{transition:border-color .3s,box-shadow .3s,transform .25s,background .3s,color .3s}
  .ag .ag-nodo.inactivo .cj{background:linear-gradient(160deg,#141b15,#0d120e);border-style:dashed;border-color:#2a372b}.ag .ag-nodo.inactivo .cj::before{opacity:.35}
  .ag .ag-nodo.ok .cj{border-color:color-mix(in srgb,var(--c) 75%,#0b100c);background:linear-gradient(160deg,color-mix(in srgb,var(--c) 20%,#121812),color-mix(in srgb,var(--c) 7%,#0d120e));box-shadow:0 12px 26px -14px color-mix(in srgb,var(--c) 70%,transparent),inset 0 1px 0 rgba(255,255,255,.08)}
  .ag .ag-nodo.corriendo .cj{border-color:var(--c);background:linear-gradient(160deg,color-mix(in srgb,var(--c) 26%,#121812),color-mix(in srgb,var(--c) 9%,#0d120e));box-shadow:0 0 0 5px color-mix(in srgb,var(--c) 18%,transparent),0 0 34px -4px color-mix(in srgb,var(--c) 65%,transparent);animation:agNodoVivo 1.6s ease-in-out infinite}
  .ag .ag-nodo.corriendo .cj svg{animation:agIcoVivo 1.6s ease-in-out infinite}
  .ag .ag-nodo .anillo{inset:-7px;border-radius:24px;border-width:2px;border-top-color:var(--c);border-right-color:color-mix(in srgb,var(--c) 35%,transparent)}
  .ag .ag-nodo.espera .cj{border-color:#ffc95c;background:linear-gradient(160deg,rgba(255,201,92,.2),rgba(255,201,92,.05));color:#ffc95c}
  .ag .ag-nodo.error .cj{border-color:#ff6b5c;background:linear-gradient(160deg,rgba(255,107,92,.2),rgba(255,107,92,.05));color:#ff8a7d;box-shadow:0 12px 26px -14px rgba(255,107,92,.8)}
  .ag .ag-nodo .ins{right:-7px;top:-7px;bottom:auto;width:20px;height:20px;border:2px solid #0b100c;font:900 11px Arial;box-shadow:0 4px 10px -3px rgba(0,0,0,.8);animation:agInsEntra .3s cubic-bezier(.2,.9,.3,1.4)}
  .ag .ag-nodo.ok .ins{background:var(--c)}
  .ag .ag-nodo.ok .paso,.ag .ag-nodo.corriendo .paso{background:color-mix(in srgb,var(--c) 18%,#0b100c)}
  .ag .ag-nodo .et em:not(:empty){display:inline-block;min-height:0;margin-top:4px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:#cfd9c7;font:800 10px Arial;letter-spacing:.02em}
  .ag .ag-nodo.ok .et em:not(:empty){background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)}.ag .ag-nodo.corriendo .et em{background:color-mix(in srgb,var(--c) 20%,transparent)!important;color:var(--c)!important}
  .ag .ag-nodo.espera .et em{background:rgba(255,201,92,.16)!important;color:#ffc95c!important}.ag .ag-nodo.error .et em:not(:empty){background:rgba(255,107,92,.16);color:#ff8a7d}
  .ag .ag-nodo.inactivo .et b{color:#aab5a2}.ag .ag-nodo.corriendo .et b{color:var(--c)}
  @keyframes agNodoVivo{50%{box-shadow:0 0 0 9px color-mix(in srgb,var(--c) 8%,transparent),0 0 44px 0 color-mix(in srgb,var(--c) 75%,transparent)}}
  @keyframes agIcoVivo{50%{transform:scale(1.1)}}@keyframes agInsEntra{from{transform:scale(0)}}
  /* aprobación de la muestra: el listado del diseño a la izquierda y la muestra a la derecha (como la plantilla de Excel) */
  .ag .mu-doble{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px;min-height:0}
  .ag .mu-espera{display:grid!important;place-items:center;border:1px dashed #2d3b2f!important;background:#0c110d!important;text-align:center;color:#8f9b8a;font:600 12.5px/1.5 Arial}.ag .mu-espera b{display:block;margin-bottom:6px;color:#cfd9c7;font:900 11px Arial;letter-spacing:.16em}
  .ag .mu-listado:not(.mu-espera){padding:12px 14px}.ag .mu-ltabla table{font-size:13px!important}.ag .mu-ltabla td{padding:7px 9px!important}.ag .mu-ltabla th{padding:7px 9px!important}
  .ag .mu-ltabla th:first-child{width:30px!important}.ag .mu-ltabla th:nth-child(3){width:58px!important}.ag .mu-ltabla th:nth-child(4){width:72px!important}.ag .mu-ltabla th:nth-child(5){width:62px!important}.ag .mu-ltabla th:nth-child(6){width:96px!important}.ag .mu-ltabla th:nth-child(7){width:26%}
  .ag .mu-ltabla td.d{font-weight:800;color:#cfd9c7}.ag .mu-ltabla td.g{font-size:11.5px;color:#cfd9c7;overflow-wrap:anywhere}.ag .mu-doble .mu-cuerpo{min-width:0}
  .ag .mu-listado{display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:8px;min-height:0;min-width:0;padding:10px;border:1px solid #2d3b2f;border-radius:12px;background:#0f1410}
  .ag .mu-listado>header{display:flex!important;align-items:center;justify-content:flex-start!important;gap:8px;flex-wrap:wrap;width:auto!important;margin:0!important;padding:0!important;border:0!important;background:none!important;position:static!important;box-shadow:none!important}
  .ag .mu-listado header b{font:900 11px Arial;letter-spacing:.14em;color:#d7ff3a}.ag .mu-ldis{padding:2px 9px;border-radius:999px;background:#d0f44c;color:#111;font:900 10.5px Arial}
  .ag .mu-listado header i{color:#aebba7;font:700 11px Arial;font-style:normal}
  .ag .mu-listado header button{margin-left:auto!important;width:auto!important;min-height:0!important;padding:4px 10px!important;border:1px solid #3d4f3d!important;border-radius:999px!important;background:transparent!important;color:#dfe7d6!important;font:700 10.5px Arial!important;cursor:pointer}
  .ag .mu-ltallas{display:flex;gap:5px;flex-wrap:wrap}.ag .mu-ltallas span{padding:3px 8px;border:1px solid #2d3b2f;border-radius:8px;background:rgba(255,255,255,.03);color:#cfd9c7;font:700 11px Arial}.ag .mu-ltallas b{color:#d0f44c;margin-right:1px}
  .ag .mu-ltabla{min-height:0;overflow:auto;border-radius:8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
  .ag .mu-ltabla table{width:100%!important;min-width:0!important;max-width:100%;table-layout:fixed;border-collapse:collapse;font:600 12px Arial;color:#eef4e9}
  .ag .mu-ltabla th:first-child{width:24px}.ag .mu-ltabla th:nth-child(3){width:50px}.ag .mu-ltabla th:nth-child(4){width:38px}.ag .mu-ltabla th,.ag .mu-ltabla td{min-width:0!important;white-space:normal}
  .ag .mu-ltabla th{position:sticky;top:0;z-index:1;padding:6px 7px;background:#182019;color:#8f9b8a;font:800 9.5px Arial;letter-spacing:.1em;text-transform:uppercase;text-align:left}
  .ag .mu-ltabla td{padding:6px 7px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}.ag .mu-ltabla tr:nth-child(even) td{background:rgba(255,255,255,.022)}
  .ag .mu-ltabla td:first-child{color:#77836f;font-size:10.5px}.ag .mu-ltabla td.n{font-weight:800;overflow-wrap:anywhere}.ag .mu-ltabla td.t{color:#d0f44c;font-weight:800;white-space:nowrap}.ag .mu-ltabla td.u{font-weight:800;white-space:nowrap}.ag .mu-ltabla td.o{color:#aebba7;font-size:11px;overflow-wrap:anywhere}
  @media(max-width:1300px){.ag .mu-doble{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}}
  /* ventana PDFS: pantalla + tira de miniaturas a la izquierda; listas en tarjetas a la derecha */
  .ag .ag-live-col{display:grid;grid-template-rows:minmax(0,1fr) auto;gap:10px;min-width:0;min-height:0}
  .ag .ag-live-tira{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;scroll-behavior:smooth}.ag .ag-live-tira[hidden]{display:none}
  .ag .ag-live-tira button{position:relative;flex:0 0 auto;width:86px!important;height:62px!important;min-height:0!important;margin:0!important;padding:0!important;border:2px solid #2d3b2f!important;border-radius:10px!important;background:#fff!important;box-shadow:none!important;overflow:hidden;cursor:pointer;opacity:.72;transition:opacity .15s,border-color .15s,transform .15s}
  .ag .ag-live-tira button:hover{opacity:1;transform:translateY(-2px)}.ag .ag-live-tira button.sel{opacity:1;border-color:#d0f44c!important;box-shadow:0 0 0 3px rgba(208,244,76,.22)!important}
  .ag .ag-live-tira img{display:block;width:100%;height:100%;object-fit:cover}
  .ag .ag-live-tira span{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;background:rgba(8,12,8,.82);color:#eef4e9;font:800 9.5px Arial;letter-spacing:.04em;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ag .ag-live-tira button.sel span{background:#d0f44c;color:#111}
  .ag .ag-live-side{display:flex!important;flex-direction:column;gap:10px}
  .ag .ag-live-side .ag-live-sec:first-child{flex:0 1 auto;max-height:50%}.ag .ag-live-side .ag-live-sec:last-child{flex:1 1 0}
  .ag .ag-live-sec h4{align-items:center;font:800 10.5px Arial;letter-spacing:.16em;color:#cfd9c7}
  .ag .ag-live-sec h4>span[data-nm],.ag .ag-live-sec h4>span[data-np]{margin-left:auto;padding:2px 10px;border:1px solid #3d4f3d;border-radius:999px;color:#d7ff3a;font:800 11px Arial;letter-spacing:0}
  .ag .ag-live-list{gap:4px}
  .ag .ag-live-list>div{min-height:32px;padding:5px 9px;border:1px solid transparent;border-radius:9px;background:rgba(255,255,255,.03);transition:background .15s,border-color .15s}
  .ag .ag-live-list>div[data-vista]:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.12)}
  .ag .ag-live-list>div.sel{outline:none;background:rgba(208,244,76,.12);border-color:rgba(208,244,76,.6)}
  .ag .ag-live-cap{left:14px;bottom:16px;padding:8px 14px;gap:12px;backdrop-filter:blur(6px)}.ag .ag-live-cap .num{font-size:28px}.ag .ag-live-cap .nom{font-size:16px}
  @media(max-width:1000px){.ag .ag-live-side .ag-live-sec:first-child{max-height:none}.ag .ag-live-tira button{width:72px!important;height:54px!important}}
  /* pantalla en vivo: rótulo de lo que se ve (mesa exportada o PDF) y mesas que se pueden abrir */
  .ag .ag-live-tipo{position:absolute;left:12px;top:12px;z-index:2;max-width:calc(100% - 24px);box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 11px;border-radius:999px;background:rgba(11,17,11,.88);border:1px solid #3a4b36;color:#d7ff3a;font:800 10px Arial;letter-spacing:.14em}.ag .ag-live-tipo[hidden]{display:none}
  .ag .ag-live-tipo.mesa{color:#6fe39a;border-color:rgba(111,227,154,.55)}.ag .ag-live-tipo.pdf{color:#ff8fd0;border-color:rgba(255,143,208,.55)}
  .ag .ag-fico.txt{display:inline-grid;place-items:center;min-width:34px;height:26px;padding:0 6px;border:1px solid #3d4f3d;border-radius:7px;background:#121a13;color:#d0f44c;font:900 9.5px Arial;letter-spacing:.06em}
  /* conectadores */
  .ag .ag-cable.ramal{stroke:#33422f;stroke-dasharray:1 7}
  .ag .ag-ramal-rot rect{fill:#0b100c;stroke:#2c3a2d;stroke-width:1}.ag .ag-ramal-rot text{fill:#77836f;font:800 8.5px Arial;letter-spacing:.12em}
  .ag .ag-ramal-rot.on rect{stroke:var(--c);fill:color-mix(in srgb,var(--c) 14%,#0b100c)}.ag .ag-ramal-rot.on text{fill:var(--c)}
  .ag .ag-ramal-rot.paso rect{stroke-dasharray:3 4}.ag .ag-ramal-rot.paso.on rect{stroke-dasharray:none}.ag .ag-ramal-rot text.sub{font:600 8.5px Arial;letter-spacing:0;fill:#5d6a58}.ag .ag-ramal-rot.on text.sub{fill:color-mix(in srgb,var(--c) 75%,#fff)}
  .ag .ag-ramal-rot.bajo text{font-size:7.5px;fill:#5d6a58}.ag .ag-ramal-rot.bajo.on text{fill:var(--c)}
  .ag .ag-cable{stroke:#2c3a2d;stroke-width:2;stroke-dasharray:1 7;stroke-linecap:round;animation:none}
  .ag .ag-cable.halo{stroke-width:10;stroke-dasharray:none;opacity:.16;filter:blur(3px)}
  .ag .ag-cable.hecho{stroke-width:3;stroke-dasharray:none}
  .ag .ag-cable.vivo{stroke-width:3;stroke-dasharray:7 8;animation:agfluir .55s linear infinite}
  .ag .ag-flecha{fill:none;stroke:#3d4f3d;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.ag .ag-flecha.on{stroke-width:2.4;filter:drop-shadow(0 0 4px currentColor)}
  .ag .ag-paq{filter:drop-shadow(0 0 7px currentColor)}
  @media(prefers-reduced-motion:reduce){.ag .ag-nodo.corriendo .cj,.ag .ag-nodo.corriendo .cj svg,.ag .ag-cable.vivo{animation:none}}
  .ag .ag-nodo .et b{font:800 12.5px Arial;letter-spacing:.08em;color:#eef4e9}.ag .ag-nodo .et small{margin-top:2px;font:600 10.5px Arial;color:#8f9b8a}.ag .ag-nodo .et em{margin-top:2px;font:700 10.5px Arial}
  .ag .ag-nodo.inactivo{opacity:1}.ag .ag-nodo.inactivo .cj{color:color-mix(in srgb,var(--c) 55%,#56635a)}
  .ag .ag-detalle{border-color:#263226;background:#0b100c;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
  .ag .ag-detalle>header{display:flex!important;align-items:center;justify-content:flex-start!important;gap:12px;flex-wrap:wrap;width:auto!important;margin:0!important;padding:12px 16px!important;border:0!important;border-bottom:1px solid #1f2a20!important;border-radius:0!important;background:rgba(255,255,255,.02)!important;position:static!important;box-shadow:none!important}
  .ag .ag-detalle h3{font:800 11px Arial;letter-spacing:.18em;color:#cfd9c7}
  .ag .ag-logcnt{display:flex;gap:6px;flex-wrap:wrap}.ag .ag-logcnt i{padding:3px 9px;border:1px solid #2d3b2f;border-radius:999px;color:#aebba7;font:700 10.5px Arial;font-style:normal}.ag .ag-logcnt i.av{border-color:rgba(255,189,102,.5);color:#ffbd66}.ag .ag-logcnt i.er{border-color:rgba(255,138,138,.5);color:#ff8a8a}
  .ag .ag-detalle .ag-filtros{margin-left:auto}.ag .ag-detalle .ag-filtros .ag-pcsel{min-height:32px;font-size:12px}
  .ag .ag-log{margin:0;padding:6px 8px 10px;border-radius:0;background:transparent;font:500 12.5px/1.5 Inter,Arial,sans-serif;color:#dfe7d6}
  .ag .ag-log .fila{display:grid;grid-template-columns:18px 62px 74px minmax(0,1fr);gap:0 10px;align-items:baseline;padding:7px 10px;border-radius:9px;white-space:normal}
  .ag .ag-log .fila:nth-child(even){background:rgba(255,255,255,.022)}.ag .ag-log .fila:hover{background:rgba(255,255,255,.05)}
  .ag .ag-log .fila::before{content:'•';color:#4a5a47;font-weight:800;text-align:center}
  .ag .ag-log .fila.OK::before{content:'✓';color:#6dff9a}.ag .ag-log .fila.WARN::before{content:'⚠';color:#ffbd66}.ag .ag-log .fila.ERROR::before{content:'✖';color:#ff8a8a}
  .ag .ag-log .fila .h{margin:0;opacity:1;color:#77836f;font:600 11.5px Consolas,ui-monospace,monospace}
  .ag .ag-log .fila b{margin:0;justify-self:start;padding:1px 8px;border-radius:999px;border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c);font:900 9.5px Arial;letter-spacing:.06em}
  .ag .ag-log .fila .m{overflow-wrap:anywhere}.ag .ag-log .fila.ERROR{background:rgba(255,107,92,.07)}.ag .ag-log .fila.WARN{background:rgba(255,189,102,.05)}
  .ag .ag-log.sin{display:grid;place-items:center}
  .ag .ag-log .vacio2{display:grid;justify-items:center;gap:6px;padding:26px 16px;opacity:1;text-align:center;color:#8f9b8a;font:500 12.5px/1.5 Arial}.ag .ag-log .vacio2 svg{width:34px;height:34px;color:#3d4f3d}.ag .ag-log .vacio2 b{color:#dfe7d6;font:800 13px Arial}
  @media(max-width:700px){.ag .ag-log .fila{grid-template-columns:16px 52px minmax(0,1fr);row-gap:3px}.ag .ag-log .fila .m{grid-column:2/-1}.ag .ag-detalle .ag-filtros{margin-left:0}}
  .ag-dia{display:flex;align-items:center;gap:10px;margin:4px 0;color:#8f9b8a;font:800 10px Arial;letter-spacing:.14em;text-transform:uppercase}.ag-dia::before,.ag-dia::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}
  .ag-sis{justify-self:center;max-width:100%;padding:4px 12px;border:1px solid rgba(255,255,255,.1);border-radius:999px;color:#8f9b8a;font:600 11px Arial;text-align:center;overflow-wrap:anywhere}.ag-sis.auto{border-color:rgba(208,244,76,.3);color:#c9dc8a}
  .ag-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px 14px;margin:6px 0;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.03);white-space:normal}
  .ag-msg.bot:has(.ag-kv){width:min(100%,760px);box-sizing:border-box}
  .ag-kv>div{min-width:0}.ag-kv dt{color:#8f9b8a;font:800 9.5px Arial;letter-spacing:.12em;text-transform:uppercase}.ag-kv dd{margin:1px 0 0;color:#f2f6ee;font-weight:700;overflow-wrap:anywhere}
  .ag-parte{display:grid;gap:2px;margin:6px 0;padding:8px 11px;border-left:3px solid #8f9b8a;border-radius:0 10px 10px 0;background:rgba(255,255,255,.04);white-space:normal}
  .ag-parte b{font:800 10px Arial;letter-spacing:.12em;text-transform:uppercase;color:#aab5a2}.ag-parte.e{border-left-color:#ff6b5c;background:rgba(255,107,92,.08)}.ag-parte.e b{color:#ff9d94}.ag-parte.q{border-left-color:#d0f44c;background:rgba(208,244,76,.07)}.ag-parte.q b{color:#d0f44c}
  .ag-who .ag-copiar{margin-left:auto;width:auto!important;min-height:0!important;padding:2px 8px!important;border:1px solid transparent!important;border-radius:999px!important;background:transparent!important;box-shadow:none!important;color:#8f9b8a!important;font:700 10px Arial!important;cursor:pointer;opacity:.55}
  .ag-msg:hover .ag-copiar,.ag-copiar:focus-visible{opacity:1;border-color:rgba(255,255,255,.16)!important}
  .ag-bajar{position:absolute;left:50%;bottom:118px;z-index:3;transform:translateX(-50%);width:auto!important;min-height:0!important;padding:7px 14px!important;border:1px solid #d0f44c!important;border-radius:999px!important;background:#d0f44c!important;color:#111!important;font:800 11px Arial!important;box-shadow:0 10px 24px rgba(0,0,0,.5);cursor:pointer}
  .ag-bajar[hidden]{display:none!important}
  html.theme-light .ag-kv,html.theme-light .ag-parte{background:#f4f7f0;border-color:#d5dfcd}html.theme-light .ag-kv dd{color:#18210f}html.theme-light .ag-sis,html.theme-light .ag-dia{color:#5d6b55}
  @media(max-width:700px){.ag-kv{grid-template-columns:1fr 1fr;padding:8px 9px;gap:5px 10px}.ag-copiar{opacity:1}}.ag-time{color:#8f9b8a;font-size:.7rem}
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
    .ag-main[data-vista="agentes"]{grid-template-rows:auto minmax(0,1fr)!important;row-gap:12px!important}
    .ag-main[data-vista="agentes"] .ag-lienzo{display:block!important}
    .ag-main[data-vista="agentes"] .ag-detalle{display:grid!important;grid-row:2!important}
    .ag-main[data-vista="pdfs"] .ag-live{display:grid!important}
    .ag-main[data-vista="chats"] .ag-chat{width:100%}
    /* Cuadro fijo de MUESTRAS (D1, D2, D3…) a la derecha del chat, con flechas para pasar de una a otra */
    .ag-main[data-vista="chats"]{grid-template-columns:minmax(380px,34%) minmax(0,1fr)!important;column-gap:12px!important}
    .ag-main .ag-muestras{display:none!important;grid-row:1!important;grid-column:2!important}
    .ag-main[data-vista="chats"] .ag-muestras{display:grid!important}
    .ag-main[data-vista="chats"] .ag-file.muestra .ag-prev{display:none!important}
    .ag-muestras{grid-template-rows:auto minmax(0,1fr) auto;gap:10px;min-height:0;border:1px solid #34432f;border-radius:16px;background:#0c110d;padding:12px 14px}
    .mu-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mu-top h4{margin:0 8px 0 0;font:900 11px Arial;letter-spacing:.14em;color:#d7ff3a}
    .mu-chip{min-height:30px;padding:0 14px;border:1px solid #34432f;border-radius:999px;background:#121a14;color:#aebba7;font:900 12px Arial;letter-spacing:.06em;cursor:pointer}.mu-chip.on{background:#d7ff3a;border-color:#d7ff3a;color:#0b1204}
    .mu-nav{margin-left:auto;display:flex;align-items:center;gap:6px}.mu-nav button,.mu-nav a{min-width:38px;min-height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #60754d;border-radius:10px;background:#142017;color:#d7ff3a;font:900 16px Arial;cursor:pointer;text-decoration:none}.mu-nav button:disabled{opacity:.35;cursor:default}.mu-nav span{color:#aebba7;font:800 12px Arial;min-width:42px;text-align:center}
    .mu-cuerpo{position:relative;min-height:0;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:10px;overflow:hidden}.mu-cuerpo img{max-width:100%;max-height:100%;object-fit:contain;display:block}.mu-cuerpo iframe{width:100%;height:100%;border:0}
    .mu-flecha{position:absolute;top:calc(50% - 21px);z-index:3;margin:0;padding:0;box-sizing:border-box;width:42px!important;min-width:42px!important;height:42px!important;min-height:42px!important;flex:none;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.55);border-radius:50%;background:rgba(14,22,8,.62);color:#e9ffa0;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);backdrop-filter:blur(6px);transition:transform .15s,background .15s,color .15s,opacity .15s}
    .mu-flecha:hover:not(:disabled){background:#d7ff3a;color:#0b1204;transform:scale(1.1)}.mu-flecha:active:not(:disabled){transform:scale(.96)}
    .mu-flecha:disabled{opacity:0;pointer-events:none}.mu-flecha.izq{left:14px}.mu-flecha.der{right:14px}
    .mu-pie{color:#aebba7;font:700 12px Arial;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}.mu-vacio{display:grid;place-items:center;color:#8f9b8a;font:700 13px Arial;text-align:center;grid-row:1 / -1}
  }
  @media(max-width:1000px){.ag-vtabs,.ag-muestras{display:none!important}}

  /* ---- Celular: todo más pequeño (botones, píldoras, textos) para que no ocupen media pantalla ---- */
  @media(max-width:700px){
    .ag{gap:6px!important}
    .ag-hd{padding:5px 8px!important;gap:6px!important;border-radius:11px!important}.ag-hd h2{font-size:12px!important}
    .ag-pill{font-size:9.5px!important;padding:2px 7px!important;min-height:0!important}
    .ag-tab{min-height:28px!important;padding:0 9px!important;font-size:10.5px!important;gap:5px!important}.ag-tab b,.ag-tab em{font-size:10.5px!important}
    .ag-agbtn{min-height:26px!important;padding:0 8px!important;font-size:10px!important}.ag-agbtn small,.ag-agbtn em{font-size:9px!important}
    .ag-btn{min-height:30px!important;padding:0 10px!important;font-size:11px!important;border-radius:9px!important}
    .ag-hacc .ag-btn,.ag-stop,.ag-reiniciar{min-height:28px!important;font-size:10.5px!important;padding:0 9px!important}
    .ag-ico,.ag-menu>summary{min-width:28px!important;min-height:28px!important;font-size:12px!important}
    .ag-res{padding:8px 10px!important;gap:6px!important}.ag-res-top .qa b{font-size:.85rem!important}.ag-res-top h3{font-size:9px!important}.ag-res-top .tiempo{font-size:11px!important}
    .ag-paso{padding:4px 6px!important}.ag-paso b{font-size:.66rem!important}.ag-paso em{font-size:.6rem!important}
    .ag-ahora{padding:5px 8px!important;font-size:.72rem!important}
    details.ag-det>summary{font-size:10px!important;padding:4px 8px!important}
    .ag-ver-flujo{min-height:30px!important;font-size:11px!important;border-radius:9px!important}
    .ag-orden{padding:5px 8px!important;gap:5px!important}.ag-orden .ag-btn{min-height:30px!important;font-size:11px!important;padding:0 10px!important}
    .ag-ochip{padding:3px 3px 3px 9px!important;font-size:10.5px!important;gap:4px!important}.ag-ochip b{font-size:11px!important}.ag-ochip .ag-ico{min-width:22px!important;min-height:22px!important;font-size:11px!important}
    .ag-chat{padding:8px!important;gap:6px!important}
    .ag-msg{padding:9px 10px!important;font-size:.78rem!important;line-height:1.4!important}
    .ag-chips button,.ag-chips .reply,.reply{min-height:26px!important;padding:4px 14px!important;font-size:11px!important;flex:0 0 auto!important}.ag-chips{gap:6px!important}
    .ag-form{gap:5px!important}.ag-form .ag-btn{min-height:32px!important;padding:0 12px!important;font-size:11px!important}.ag-form .ag-ico{min-height:32px!important;min-width:32px!important}
    .ag-file{padding:8px!important;gap:6px!important}.ag-file-head b{font-size:.78rem!important}.ag-file-acc button,.ag-file-acc a{min-height:26px!important;min-width:26px!important;font-size:10.5px!important;padding:0 8px!important}
    .ag-filtros .ag-pcsel{min-height:28px!important;font-size:11px!important}
  }
  `;
  document.head.appendChild(css);
  const css2 = document.createElement('style');
  css2.textContent = `
  /* ===== Agentes: más profundidad y vida (cabecera, resumen de la orden, pestañas y pantalla en vivo) ===== */
  .panel[data-panel='agentes'] .ag{gap:14px}
  .panel[data-panel='agentes'] .ag-hd{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:12px 14px;padding:14px 18px;border:1px solid rgba(255,255,255,.13);border-radius:20px;background:radial-gradient(900px 220px at 0 0,rgba(139,212,80,.14),transparent 62%),radial-gradient(700px 200px at 100% 0,rgba(125,164,255,.10),transparent 60%),linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.28)),#0c120c;box-shadow:0 22px 44px -28px #000,inset 0 1px 0 rgba(255,255,255,.09)}
  .panel[data-panel='agentes'] .ag-hd h2{margin:0;font-size:1.25rem;letter-spacing:.12em;text-shadow:0 2px 8px rgba(0,0,0,.5)}
  .panel[data-panel='agentes'] .ag-pill{padding:6px 13px;border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(0,0,0,.25));box-shadow:0 6px 12px -8px #000,inset 0 1px 0 rgba(255,255,255,.1)}
  .panel[data-panel='agentes'] .ag-pill i{box-shadow:0 0 9px var(--c,#8f9b8a);animation:agBlink 2.4s ease-in-out infinite}.panel[data-panel='agentes'] .ag-pill.mal i{animation-duration:1s}
  @keyframes agBlink{50%{opacity:.45;transform:scale(.8)}}
  .panel[data-panel='agentes'] .ag-tab{padding:9px 18px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.28));color:#cfd9c9;font-weight:800;box-shadow:0 8px 14px -10px #000,inset 0 1px 0 rgba(255,255,255,.1);transition:transform .18s,box-shadow .18s,border-color .18s}
  .panel[data-panel='agentes'] .ag-tab:hover{transform:translateY(-2px);border-color:rgba(208,244,76,.5)}
  .panel[data-panel='agentes'] .ag-tab.on{border-color:#d0f44c;background:linear-gradient(180deg,#e2ff6a,#a9d21f);color:#16200a;box-shadow:0 10px 22px -8px rgba(208,244,76,.65),inset 0 1px 0 rgba(255,255,255,.6)}
  .panel[data-panel='agentes'] .ag-agbtn{border:1px solid rgba(255,255,255,.14);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.3));box-shadow:0 8px 14px -10px #000,inset 0 1px 0 rgba(255,255,255,.08);transition:transform .18s,box-shadow .18s,border-color .18s}
  .panel[data-panel='agentes'] .ag-agbtn:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.35);box-shadow:0 14px 20px -10px #000}
  .panel[data-panel='agentes'] .ag-hacc .ag-btn{border-radius:12px;box-shadow:0 10px 18px -10px #000,inset 0 1px 0 rgba(255,255,255,.18);transition:transform .15s,box-shadow .15s}
  .panel[data-panel='agentes'] .ag-hacc .ag-btn:hover{transform:translateY(-2px)}
  .panel[data-panel='agentes'] .ag-reiniciar{background:linear-gradient(180deg,#e2ff6a,#a9d21f)!important;box-shadow:0 10px 22px -8px rgba(208,244,76,.6),inset 0 1px 0 rgba(255,255,255,.55)}
  /* resumen de la orden: se llena como un tanque con el avance */
  .panel[data-panel='agentes'] .ag-res{position:relative;overflow:hidden;isolation:isolate;border:1px solid rgba(255,255,255,.13);border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.065),rgba(0,0,0,.3)),#0c120e;box-shadow:0 22px 44px -28px #000,inset 0 1px 0 rgba(255,255,255,.08)}
  .panel[data-panel='agentes'] .ag-res::before{content:"";position:absolute;z-index:-1;left:0;top:0;bottom:0;width:var(--respct,0%);background:linear-gradient(90deg,rgba(139,212,80,.22),rgba(139,212,80,.05));border-right:1px solid rgba(208,244,76,.35);transition:width .9s cubic-bezier(.2,.8,.2,1)}
  .panel[data-panel='agentes'] .ag-res-top .qa b{font-size:1.15rem;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.5)}
  .panel[data-panel='agentes'] .ag-res .tiempo{padding:5px 12px;border:1px solid rgba(208,244,76,.35);border-radius:999px;background:rgba(208,244,76,.08);color:#d0f44c;font-weight:800;font-variant-numeric:tabular-nums}
  .panel[data-panel='agentes'] .ag-barra2{height:10px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}
  .panel[data-panel='agentes'] .ag-barra2 i{position:relative;display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4f9f2a,#d0f44c);box-shadow:0 0 14px rgba(208,244,76,.65);transition:width .8s cubic-bezier(.2,.8,.2,1)}
  .panel[data-panel='agentes'] .ag-barra2 i::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);background-size:200% 100%;animation:agShine 2.2s linear infinite}
  @keyframes agShine{from{background-position:200% 0}to{background-position:-200% 0}}
  .panel[data-panel='agentes'] .ag-paso{border:1px solid rgba(255,255,255,.12);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.25));box-shadow:0 8px 14px -10px #000,inset 0 1px 0 rgba(255,255,255,.07)}
  .panel[data-panel='agentes'] .ag-paso.ok{border-color:rgba(139,212,80,.55);background:linear-gradient(180deg,rgba(139,212,80,.2),rgba(139,212,80,.05))}
  .panel[data-panel='agentes'] .ag-paso.corriendo{border-color:#d0f44c;box-shadow:0 0 0 0 rgba(208,244,76,.5),0 10px 20px -10px rgba(208,244,76,.7);animation:agPaso 1.8s infinite}
  @keyframes agPaso{70%{box-shadow:0 0 0 9px rgba(208,244,76,0),0 10px 20px -10px rgba(208,244,76,.7)}100%{box-shadow:0 0 0 0 rgba(208,244,76,0)}}
  /* pestañas CHATS / AGENTES / PDFS */
  .panel[data-panel='agentes'] .ag-vtabs{gap:8px}
  .panel[data-panel='agentes'] .ag-vt{padding:10px 24px;border:1px solid rgba(255,255,255,.13);border-radius:14px 14px 4px 4px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(0,0,0,.3));color:#cfd9c9;font-weight:900;letter-spacing:.1em;box-shadow:0 10px 16px -12px #000,inset 0 1px 0 rgba(255,255,255,.09);transition:transform .18s,box-shadow .18s}
  .panel[data-panel='agentes'] .ag-vt:hover{transform:translateY(-2px)}
  .panel[data-panel='agentes'] .ag-vt.on{border-color:#d0f44c;background:linear-gradient(180deg,#e6ff74,#a9d21f);color:#16200a;box-shadow:0 12px 24px -8px rgba(208,244,76,.6),inset 0 1px 0 rgba(255,255,255,.6)}
  /* barra de la orden */
  .panel[data-panel='agentes'] .ag-orden{padding:6px 8px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.25));box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
  .panel[data-panel='agentes'] .ag-ochip{border:1px solid rgba(208,244,76,.55);background:linear-gradient(180deg,rgba(208,244,76,.12),rgba(0,0,0,.25));box-shadow:0 8px 16px -10px rgba(208,244,76,.7),inset 0 1px 0 rgba(255,255,255,.12)}
  .panel[data-panel='agentes'] .ag-orden .ag-btn:not(.sec){background:linear-gradient(180deg,#b9e44a,#7fae22);color:#10200a;box-shadow:0 10px 18px -10px rgba(139,212,80,.8),inset 0 1px 0 rgba(255,255,255,.4);transition:transform .15s}
  .panel[data-panel='agentes'] .ag-orden .ag-btn:hover{transform:translateY(-2px)}
  /* pantalla en vivo */
  .panel[data-panel='agentes'] .ag-live{position:relative;border:1px solid rgba(255,255,255,.13);border-radius:20px;background:radial-gradient(900px 300px at 20% 0,rgba(125,164,255,.09),transparent 60%),linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.3)),#0b100c;box-shadow:0 24px 48px -30px #000,inset 0 1px 0 rgba(255,255,255,.08)}
  .panel[data-panel='agentes'] .ag-live-top b{display:inline-flex;align-items:center;font-size:12px;letter-spacing:.14em}
  .panel[data-panel='agentes'] .ag-live-top i.on{box-shadow:0 0 0 0 rgba(208,244,76,.7);animation:agPaso 1.6s infinite}
  .panel[data-panel='agentes'] .ag-live-vista{border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:inset 0 0 40px rgba(0,0,0,.45),0 18px 30px -22px #000}
  .panel[data-panel='agentes'] .ag-live-vista:not(:has(img.ok)){background:radial-gradient(circle at 50% 42%,rgba(208,244,76,.10),transparent 55%),repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 34px),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 34px),#070b08}
  .panel[data-panel='agentes'] .ag-live-vista:not(:has(img.ok)) .ag-live-vacio::before{content:"";display:block;width:92px;height:92px;margin:0 auto 18px;border-radius:50%;border:2px solid rgba(208,244,76,.65);background:radial-gradient(circle,rgba(208,244,76,.28),transparent 65%);box-shadow:0 0 0 0 rgba(208,244,76,.5);animation:agRing 2.4s ease-out infinite}
  @keyframes agRing{70%{box-shadow:0 0 0 34px rgba(208,244,76,0)}100%{box-shadow:0 0 0 0 rgba(208,244,76,0)}}
  .panel[data-panel='agentes'] .ag-live:has([data-pto].on) .ag-live-vista::after{content:"";position:absolute;left:0;right:0;top:0;height:70px;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(208,244,76,.22),transparent);animation:agScan 2.6s ease-in-out infinite}
  @keyframes agScan{from{transform:translateY(-70px)}to{transform:translateY(520px)}}
  .panel[data-panel='agentes'] .ag-live-prog{height:8px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}
  .panel[data-panel='agentes'] .ag-live-prog i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4f9f2a,#d0f44c);box-shadow:0 0 12px rgba(208,244,76,.6);transition:width .6s cubic-bezier(.2,.8,.2,1)}
  .panel[data-panel='agentes'] .ag-live-sec{padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(0,0,0,.25));box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .panel[data-panel='agentes'] .ag-live-sec h4{align-items:center;font-size:11px;letter-spacing:.12em}
  .panel[data-panel='agentes'] .ag-live-sec h4 span{padding:3px 11px;border-radius:999px;border:1px solid rgba(208,244,76,.4);background:linear-gradient(90deg,rgba(139,212,80,.55) var(--pdfpct,0%),rgba(208,244,76,.08) 0);color:#f1ffc0;font-weight:900;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  .panel[data-panel='agentes'] .ag-live-list div{border:1px solid rgba(255,255,255,.07);border-left:3px solid rgba(139,212,80,.7);border-radius:10px;background:linear-gradient(90deg,rgba(139,212,80,.10),rgba(255,255,255,.025));transition:transform .15s,background .15s}
  .panel[data-panel='agentes'] .ag-live-list div:hover{transform:translateX(3px);background:linear-gradient(90deg,rgba(139,212,80,.2),rgba(255,255,255,.05))}
  .panel[data-panel='agentes'] .ag-live-list div.nuevo{border-left-color:#d0f44c;background:linear-gradient(90deg,rgba(208,244,76,.26),rgba(255,255,255,.04));animation:agNuevo .5s cubic-bezier(.2,.8,.2,1)}
  @keyframes agNuevo{from{opacity:0;transform:translateX(-14px)}}
  .panel[data-panel='agentes'] .ag-live-list div.sel{box-shadow:0 0 0 1px #d0f44c,0 8px 16px -10px rgba(208,244,76,.7)}
  .panel[data-panel='agentes'] .ag-live-list .pdf-nom{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 12.5px Consolas,ui-monospace,monospace;color:#f1ffc0}
  .panel[data-panel='agentes'] .ag-live-list .pdf-tela{margin-right:8px;color:#d0f44c;font:900 12px Arial,Helvetica,sans-serif;letter-spacing:.03em;text-transform:uppercase}
  .panel[data-panel='agentes'] .ag-live-list .pdf-rest{font-weight:700}
  .panel[data-panel='agentes'] .ag-live-list,.panel[data-panel='agentes'] .ag-live-side,.panel[data-panel='agentes'] .ag-live-sec{overflow-x:hidden}
  .panel[data-panel='agentes'] .ag-live-list div{min-width:0;max-width:100%;box-sizing:border-box}
  .panel[data-panel='agentes'] .ag-live-list .ag-vlink.ag-ai{display:inline-grid;place-items:center;width:16px;height:16px;min-height:0;padding:0;margin-left:6px;border:0;background:none;box-shadow:none;transition:transform .15s,filter .15s}
  .panel[data-panel='agentes'] .ag-live-list .ag-vlink.ag-ai:hover{transform:scale(1.18);filter:drop-shadow(0 0 6px rgba(255,154,0,.8))}
  .panel[data-panel='agentes'] .ag-ailogo{display:block;width:15px;height:15px}.panel[data-panel='agentes'] .ag-ai-btn .ag-ailogo{display:inline-block;vertical-align:middle;width:13px;height:13px;margin-right:5px}
  .panel[data-panel='agentes'] .ag-live-sec h4 span.ag-gen{display:inline-flex;gap:6px;padding:0;border:0;background:none;box-shadow:none;letter-spacing:0;text-shadow:none}
  .panel[data-panel='agentes'] .ag-live-sec h4 span.ag-gen[hidden]{display:none}
  .panel[data-panel='agentes'] .ag-gen button{display:inline-flex;align-items:center;gap:6px;min-height:0;padding:3px 11px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(255,255,255,.05);color:#c4cfbf;font:800 10px Arial;letter-spacing:.07em;cursor:pointer;transition:transform .15s,background .15s}
  .panel[data-panel='agentes'] .ag-gen button:hover{transform:translateY(-1px);background:rgba(255,255,255,.12)}
  .panel[data-panel='agentes'] .ag-gen button b{padding:0 6px;border-radius:99px;background:rgba(255,255,255,.14);font-size:10px}
  .panel[data-panel='agentes'] .ag-gen button.m.on{border-color:#8fb8ff;background:linear-gradient(180deg,#a9c8ff,#4f80cf);color:#06142b;box-shadow:0 6px 14px -6px rgba(143,184,255,.8)}
  .panel[data-panel='agentes'] .ag-gen button.f.on{border-color:#ff9ad5;background:linear-gradient(180deg,#ffb6e2,#e0509f);color:#33001a;box-shadow:0 6px 14px -6px rgba(255,154,213,.8)}
  .panel[data-panel='agentes'] .ag-gen button.on b{background:rgba(0,0,0,.18)}
  .panel[data-panel='agentes'] .ag-live-sec:has(.ag-dis:not([hidden])){grid-template-rows:auto auto minmax(0,1fr)}
  .panel[data-panel='agentes'] .ag-gen.ag-dis{display:flex;flex-wrap:wrap;align-items:center;align-self:start;gap:6px;margin:2px 0}
  .panel[data-panel='agentes'] .ag-gen.ag-dis[hidden]{display:none}
  .panel[data-panel='agentes'] .ag-gen button.d.on{border-color:#d7ff3a;background:linear-gradient(180deg,#e4ff7a,#a8d42a);color:#141c05;box-shadow:0 6px 14px -6px rgba(215,255,58,.8)}
  .panel[data-panel='agentes'] .ag-prog{position:relative;overflow:hidden;flex:none;display:inline-flex;align-items:center;gap:9px;min-width:200px;height:38px;padding:0 14px;border:1px solid rgba(139,212,80,.55);border-radius:12px;background:#0f170d;color:#f3ffe0;font:800 12px Arial;letter-spacing:.03em;cursor:pointer;box-shadow:0 10px 22px -16px rgba(139,212,80,.9);transition:border-color .3s,box-shadow .3s}
  .panel[data-panel='agentes'] .ag-prog .fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2f7d1c,#8bd450);opacity:.6;transition:width .6s cubic-bezier(.2,.8,.2,1)}
  .panel[data-panel='agentes'] .ag-prog .fill::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.35) 50%,transparent 70%);background-size:200% 100%;animation:agBrillo 1.4s linear infinite}
  .panel[data-panel='agentes'] .ag-prog.listo .fill::after{animation:none;background:none}
  @keyframes agBrillo{from{background-position:200% 0}to{background-position:-200% 0}}
  .panel[data-panel='agentes'] .ag-prog>*:not(.fill){position:relative;z-index:1}
  .panel[data-panel='agentes'] .ag-prog .pct{margin-left:auto;font:900 13px Arial;font-variant-numeric:tabular-nums}
  .panel[data-panel='agentes'] .ag-prog .chulo{display:none;place-items:center;width:22px;height:22px;border-radius:50%;background:#8bd450;color:#10200a;font:900 14px Arial}
  .panel[data-panel='agentes'] .ag-prog.listo{border-color:#8bd450;box-shadow:0 0 0 3px rgba(139,212,80,.2),0 10px 22px -12px rgba(139,212,80,.9)}
  .panel[data-panel='agentes'] .ag-prog.listo .chulo{display:grid;animation:agFinEntra .45s cubic-bezier(.2,.9,.3,1.4) both}
  .panel[data-panel='agentes'] .ag-prog.listo .pct{display:none}
  .panel[data-panel='agentes'] .ag-prog.err{border-color:#ffb84c}.panel[data-panel='agentes'] .ag-prog.err .fill{background:linear-gradient(90deg,#8a5a0a,#ffb84c)}.panel[data-panel='agentes'] .ag-prog.err .chulo{background:#ffb84c;color:#2a1800}
  .panel[data-panel='agentes'] [data-live]{position:relative}
  /* Barra de la orden ordenada: progreso · orden · acción principal · NAS · menú ⋯ */
  .panel[data-panel='agentes'] .ag-orden{gap:8px;align-items:center;flex-wrap:nowrap;padding:0;border:0;background:none}
  .panel[data-panel='agentes'] .ag-orden>*{flex:none}
  .panel[data-panel='agentes'] .ag-orden .ag-btn,.panel[data-panel='agentes'] .ag-orden .ag-ochip,.panel[data-panel='agentes'] .ag-orden .ag-prog,.panel[data-panel='agentes'] .ag-orden .ag-mas>summary{height:38px;min-height:38px;box-sizing:border-box;display:inline-flex;align-items:center}
  .panel[data-panel='agentes'] .ag-orden .ag-ochip{gap:8px;padding:0 6px 0 14px;border-radius:12px}
  .panel[data-panel='agentes'] .ag-orden .ag-nas{padding:0 14px}
  .panel[data-panel='agentes'] .ag-mas{position:relative}
  .panel[data-panel='agentes'] .ag-mas>summary{list-style:none;justify-content:center;width:38px;padding:0;cursor:pointer;font:900 18px Arial;letter-spacing:.05em}
  .panel[data-panel='agentes'] .ag-mas>summary::-webkit-details-marker{display:none}
  .panel[data-panel='agentes'] .ag-mas-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;display:grid;gap:4px;min-width:200px;padding:6px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#0d140c;box-shadow:0 18px 40px -12px #000}
  .panel[data-panel='agentes'] .ag-mas-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:#e9f1e3;font:700 13px Arial;text-align:left;cursor:pointer}
  .panel[data-panel='agentes'] .ag-mas-menu button:hover{background:rgba(255,255,255,.08)}
  .panel[data-panel='agentes'] .ag-mas-menu button[data-orden-quitar]{color:#ffb3a9}
  .panel[data-panel='agentes'] .ag-ai-inst{margin-left:auto;margin-right:8px;color:#9fb08c;font:700 11px Arial;text-decoration:underline;text-underline-offset:3px;white-space:nowrap}.panel[data-panel='agentes'] .ag-ai-inst:hover{color:#d0f44c}
  .panel[data-panel='agentes'] [data-auto],.panel[data-panel='agentes'] .ag-indiv{display:none!important}
  .panel[data-panel='agentes'] .ag-fin{position:absolute;top:8px;left:10px;right:10px;z-index:6;display:flex;align-items:center;gap:14px;margin:0;padding:12px 16px;border:1px solid rgba(139,212,80,.55);border-radius:14px;background:linear-gradient(120deg,rgba(60,140,40,.38),rgba(12,30,12,.9));box-shadow:0 14px 30px -18px rgba(139,212,80,.7);animation:agFinEntra .5s cubic-bezier(.2,.9,.3,1.2) both}
  .panel[data-panel='agentes'] .ag-fin[hidden]{display:none}
  .panel[data-panel='agentes'] .ag-fin.err{border-color:rgba(255,184,76,.65);background:linear-gradient(120deg,rgba(150,95,10,.38),rgba(30,20,8,.9))}
  .panel[data-panel='agentes'] .ag-fin .ok{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#8bd450;color:#10200a;font:900 20px Arial}
  .panel[data-panel='agentes'] .ag-fin.err .ok{background:#ffb84c;color:#2a1800}
  .panel[data-panel='agentes'] .ag-fin div{flex:1;min-width:0}
  .panel[data-panel='agentes'] .ag-fin b{display:block;font:900 15px Arial;letter-spacing:.02em;color:#f3ffe0}
  .panel[data-panel='agentes'] .ag-fin small{display:block;margin-top:2px;color:#c9dcb6;font:600 12px Arial}
  .panel[data-panel='agentes'] .ag-fin button{flex:none;width:30px;height:30px;padding:0;border:1px solid rgba(255,255,255,.2);border-radius:50%;background:rgba(0,0,0,.25);color:#fff;font:700 16px Arial;cursor:pointer}
  @keyframes agFinEntra{from{opacity:0;transform:translateY(-10px) scale(.97)}to{opacity:1;transform:none}}
  .ag-toast-fin{position:fixed;z-index:2000;top:84px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:min(92vw,520px);padding:13px 18px;border:1px solid rgba(139,212,80,.7);border-radius:16px;background:#0f1a0c;color:#f3ffe0;font:800 14px Arial;box-shadow:0 24px 50px -16px #000,0 0 0 4px rgba(139,212,80,.18);animation:agFinEntra .45s cubic-bezier(.2,.9,.3,1.2) both}
  .ag-toast-fin.err{border-color:rgba(255,184,76,.8);box-shadow:0 24px 50px -16px #000,0 0 0 4px rgba(255,184,76,.18)}
  .ag-toast-fin i{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#8bd450;color:#10200a;font:900 17px Arial;font-style:normal}
  .ag-toast-fin.err i{background:#ffb84c;color:#2a1800}
  .ag-toast-fin small{display:block;margin-top:2px;color:#b9cbaa;font:600 12px Arial}
  .panel[data-panel='agentes'] .ag-live-vista:focus{outline:none}.panel[data-panel='agentes'] .ag-keys{margin-left:12px;padding:3px 10px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(255,255,255,.05);color:#aebba7;font:700 11px Arial;letter-spacing:.03em;white-space:nowrap}
  @media(prefers-reduced-motion:reduce){.panel[data-panel='agentes'] *{animation:none!important}}
  `;
  document.head.appendChild(css2);

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
  // En computador el listado va siempre en la zona del centro, nunca dentro del mensaje; en móvil (sin esa zona) solo cuando se pidió el listado
  const tablaChat = m => (!(window.matchMedia && matchMedia('(max-width:1000px)').matches) ? null : (/Desglose del listado/.test(m.texto || '') ? m.tabla : null));
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
    { id: 'TRIGGER', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>', tit: 'Chat', sub: 'Tu mensaje', c: '#8f9b8a' },
    { id: 'TAVO', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>', tit: 'TAVO', sub: 'Coordinador', c: '#7da4ff' },
    { id: 'LEO', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0 0 4h13"/><path d="M9 7h6M9 10h4"/></svg>', tit: 'LEO', sub: 'Lee el listado', c: '#b794ff' },
    { id: 'JACK', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>', tit: 'JACK', sub: 'PDF de muestra', c: '#ffcf5c' },
    { id: 'APROB', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5 1.6 0 3 .5 4.1 1.4"/><path d="M15.5 17l2 2 4-4.5"/></svg>', tit: 'Aprobación', sub: 'Tú apruebas', c: '#ff9a4d' },
    { id: 'OLVER', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.4"/><path d="M3 16l5-4 4 3 3-2 6 4"/></svg>', tit: 'OLVER', sub: 'Exporta mesas', c: '#6fe39a' },
    { id: 'OLIVER', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3l4 2 4-2 5 4-3 3-2-1v11H8V9l-2 1-3-3z"/></svg>', tit: 'OLIVER', sub: 'Tallas y números', c: '#ff8fd0' },
    { id: 'TERRY', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>', tit: 'TERRY', sub: 'Google Sheets', c: '#6ee0e0' }
  ];
  const CADENA = NODOS.map(n => n.id);
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const flow = { el: {}, POS: {}, estado: {}, ejec: null, filtro: null, cursor: null, estadoServidor: null, cola: [], reproduciendo: false,
    listo: false, preparado: 0, silencio: false, lienzo: null, svg: null, ro: null, ejecN: 0, tam: 68 };

  function crearNodos() {
    flow.lienzo = panel.querySelector('[data-lienzo]'); flow.svg = panel.querySelector('[data-cables]'); flow.el = {};
    NODOS.forEach((n, k) => {
      const d = document.createElement('div');
      d.className = 'ag-nodo'; d.dataset.n = n.id; d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', n.tit + ': ' + n.sub); d.style.setProperty('--c', n.c);
      d.innerHTML = '<i class="anillo"></i><div class="cj">' + n.ico + '</div><i class="paso">' + (k + 1) + '</i><i class="puerto in"></i><i class="puerto out"></i><i class="ins"></i><div class="et"><b>' + esc(n.tit) + '</b><small>' + esc(n.sub) + '</small><em></em></div>';
      d.onclick = () => filtrar(flow.filtro === n.id ? null : n.id);
      d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
      flow.lienzo.appendChild(d); flow.el[n.id] = d;
    });
    if (flow.ro) flow.ro.disconnect();
    flow.ro = new ResizeObserver(acomodar); flow.ro.observe(flow.lienzo);
    nuevaEjec(); flow.ejec.n = 0; flow.ejecN = 0; acomodar(); pintarLog();
  }
  // Botón NAS de la orden: hace EXACTAMENTE lo mismo que el botón NAS de las tarjetas de producción (aviso «Procesando…» y entrega al Explorador)
  function abrirNas(orden) {
    const limpia = String(orden || '').trim();
    if (!limpia) return;
    let fila = null, cliente = '', proyecto = '';
    try {
      const norm = v => String(v || '').replace(/[\s-]+/g, '').toUpperCase();
      const h = productionData.headers.map(x => String(x || '').trim().toUpperCase());
      const iO = h.indexOf('ORDEN'), iC = h.indexOf('NOMBRE DEL CLIENTE'), iP = h.indexOf('NOMBRE PROYECTO');
      fila = productionData.rows.find(r => norm(r.values[iO]) === norm(limpia)) || null;
      if (fila) { cliente = String(fila.values[iC] || '').trim(); proyecto = iP >= 0 ? String(fila.values[iP] || '').trim() : ''; }
    } catch (er) { /* Producción aún no cargó: se abre solo con el número de orden */ }
    const puente = document.createElement('tr'); puente.hidden = true;
    const celda = document.createElement('td');
    celda.innerHTML = productionRowButton(fila ? fila.source_row : 0, limpia, cliente, proyecto);
    puente.appendChild(celda); productionBody.appendChild(puente);
    try { celda.querySelector('.production-row-open').click(); } finally { puente.remove(); }
  }
  // Pestañas de escritorio: CHATS · AGENTES (mapa del flujo) · PDFS (pantalla en vivo) · LOG (ejecución)
  const VISTAS = ['chats', 'agentes', 'pdfs'];   // el LOG va dentro de AGENTES
  function ponerVista(v) {
    if (v === 'log') v = 'agentes';
    if (!VISTAS.includes(v)) v = 'chats';
    const m = panel && panel.querySelector('[data-main]'); if (!m) return;
    m.dataset.vista = v;
    panel.querySelectorAll('[data-vt]').forEach(b => b.classList.toggle('on', b.dataset.vt === v));
    try { localStorage.setItem('indoor-agentes-vista', v); } catch (er) { /* sin almacenamiento */ }
    ajustarAlto();
    setTimeout(() => { if (v === 'agentes') { acomodar(); pintarLog(); } if (v === 'chats') { const h = panel.querySelector('[data-hilo]'); if (h) h.scrollTop = h.scrollHeight; } }, 30);
    if (v === 'pdfs') setTimeout(enfocarVista, 60);
  }
  // Las flechas del teclado pasan de un PDF a otro: el visor toma el foco al entrar a PDFS y cada vez que vuelves a esta ventana (p. ej. desde Illustrator)
  function enfocarVista() {
    if (!panel || !panel.classList.contains('active')) return;
    const m = panel.querySelector('[data-main]'); if (!m || m.dataset.vista !== 'pdfs') return;
    const act = document.activeElement;
    if (act && /^(TEXTAREA|INPUT|SELECT)$/.test(act.tagName || '')) return;
    const v = panel.querySelector('.ag-live-vista'); if (v) { v.tabIndex = -1; v.focus({ preventScroll: true }); }
  }
  // El módulo ocupa exactamente lo que queda de pantalla (sin scroll de página), con cualquier zoom o barra del navegador
  function ajustarAlto() {
    const m = panel && panel.querySelector('[data-main]'); if (!m) return;
    if (window.innerWidth <= 1000 || !panel.classList.contains('active')) { m.style.removeProperty('height'); return; }
    const alto = window.innerHeight - m.getBoundingClientRect().top - 20;
    m.style.setProperty('height', Math.max(420, Math.round(alto)) + 'px', 'important');
  }
  function acomodar() {
    const lienzo = flow.lienzo; if (!lienzo) return;
    const W = lienzo.clientWidth, H = lienzo.clientHeight; if (!W) return;
    const tam = W > 1000 ? 62 : 48, margen = 44, ancho = tam; flow.tam = tam;
    const porFila = Math.max(3, Math.min(NODOS.length, Math.floor((W - margen * 2 + 40) / (W > 1000 ? 130 : 112))));
    const filas = Math.ceil(NODOS.length / porFila);
    const sep = porFila > 1 ? (W - margen * 2 - ancho) / (porFila - 1) : 0;
    flow.ramas = filas === 1;   // los dos carriles solo caben cuando todos los nodos van en una fila
    const sube = flow.ramas ? Math.round(tam * 0.66) : 0, baja = flow.ramas ? Math.round(tam * 0.5) + 44 : 0;
    const altoFila = tam + 58, y0 = (W > 1000 ? 62 : 56) + sube;   // el mapa es una tira: su alto se ajusta a las filas que ocupa
    flow.yDirecto = y0 + tam / 2 + baja;
    lienzo.style.setProperty('height', (y0 + (filas - 1) * altoFila + tam + 46 + (flow.ramas ? Math.max(0, baja + 26 - (tam / 2 + 46)) : 0)) + 'px', 'important');
    NODOS.forEach((n, i) => {
      const f = Math.floor(i / porFila), c = i % porFila, x = margen + c * sep, y = y0 + f * altoFila - (flow.ramas && n.id === 'OLVER' ? sube : 0);
      flow.POS[n.id] = { x, y, fila: f, col: i };
      flow.el[n.id].style.left = x + 'px'; flow.el[n.id].style.top = y + 'px'; flow.el[n.id].style.setProperty('--tam', tam + 'px');
    });
    dibujar();
  }
  function ruta(a, b) {
    const A = flow.POS[a], B = flow.POS[b]; if (!A || !B) return '';
    if (flow.ramas && a === 'APROB' && b === 'OLIVER') {
      const T0 = flow.tam || 68, x1 = A.x + T0, y1 = A.y + T0 / 2, x2 = B.x, y2 = B.y + T0 / 2, yL = flow.yDirecto, r = Math.min(70, (x2 - x1) / 4);
      return 'M' + x1 + ',' + y1 + ' C' + (x1 + r * 0.7) + ',' + y1 + ' ' + (x1 + r * 0.3) + ',' + yL + ' ' + (x1 + r) + ',' + yL + ' L' + (x2 - r) + ',' + yL + ' C' + (x2 - r * 0.3) + ',' + yL + ' ' + (x2 - r * 0.7) + ',' + y2 + ' ' + x2 + ',' + y2;
    }
    const T = flow.tam || 68, ax = A.x + T, ay = A.y + T / 2, bx = B.x, by = B.y + T / 2, adj = Math.abs(A.col - B.col) === 1;
    if (A.fila === B.fila && adj) { const k = (bx - ax) / 2; return 'M' + ax + ',' + ay + ' C' + (ax + k) + ',' + ay + ' ' + (bx - k) + ',' + by + ' ' + bx + ',' + by; }
    if (A.fila === B.fila) { const k = (T / 2 + 20) / 0.75; return 'M' + ax + ',' + ay + ' C' + (ax + 30) + ',' + (ay - k) + ' ' + (bx - 30) + ',' + (by - k) + ' ' + bx + ',' + by; }
    return 'M' + ax + ',' + ay + ' C' + (ax + 80) + ',' + ay + ' ' + (bx - 80) + ',' + by + ' ' + bx + ',' + by;
  }
  const colorNodo = id => (NODOS.find(n => n.id === id) || {}).c || '#8bd450';
  function dibujar() {
    if (!flow.svg || !flow.ejec) return;
    const T = flow.tam || 68, hechos = new Set(flow.ejec.pares);
    let defs = '', h = '';
    for (let i = 0; i < CADENA.length - 1; i++) {
      const a = CADENA[i], b = CADENA[i + 1], A = flow.POS[a], B = flow.POS[b]; if (!A || !B) continue;
      h += '<path class="ag-cable" d="' + ruta(a, b) + '"/>';
      if (A.fila === B.fila && A.y === B.y && !hechos.has(a + '>' + b)) { const mx = (A.x + T + B.x) / 2, my = A.y + T / 2; h += '<path class="ag-flecha" d="M' + (mx - 3) + ',' + (my - 5) + ' l5,5 l-5,5"/>'; }
    }
    const RA = flow.POS.APROB, RO = flow.POS.OLIVER, directo = [...hechos].some(x => x.endsWith('>OLIVER') && x !== 'OLVER>OLIVER'), porOlver = hechos.has('OLVER>OLIVER');
    if (RA && RO) {
      if (!directo) h += '<path class="ag-cable ramal" d="' + ruta('APROB', 'OLIVER') + '"/>';
      if (flow.ramas && flow.POS.OLVER) {   // dos carriles: arriba exporta, abajo va directo
        const PV = flow.POS.OLVER, cx = PV.x + T / 2, yL = flow.yDirecto;
        h += '<g class="ag-ramal-rot' + (porOlver ? ' on' : '') + '" style="--c:' + colorNodo('OLVER') + '"><rect x="' + (cx - 58) + '" y="' + (PV.y - 30) + '" width="116" height="18" rx="9"/><text x="' + cx + '" y="' + (PV.y - 17) + '" text-anchor="middle">CON EXPORTACIÓN</text></g>';
        h += '<g class="ag-ramal-rot paso' + (directo ? ' on' : '') + '" style="--c:' + colorNodo('OLIVER') + '"><rect x="' + (cx - 62) + '" y="' + (yL - 15) + '" width="124" height="30" rx="15"/><text x="' + cx + '" y="' + (yL - 2) + '" text-anchor="middle">SIN EXPORTAR</text><text class="sub" x="' + cx + '" y="' + (yL + 9) + '" text-anchor="middle">PDF directo</text></g>';
      } else if (RA.fila === RO.fila) {   // rótulos de los dos caminos
        const mx = (RA.x + T + RO.x) / 2, cy = RA.y + T / 2, arriba = cy - (T / 2 + 20);
        h += '<g class="ag-ramal-rot' + (directo ? ' on' : '') + '" style="--c:' + colorNodo('OLIVER') + '"><rect x="' + (mx - 46) + '" y="' + (arriba - 10) + '" width="92" height="18" rx="9"/><text x="' + mx + '" y="' + (arriba + 3) + '" text-anchor="middle">PDF DIRECTO</text></g>';
        const ox = flow.POS.OLVER ? (flow.POS.OLVER.x + T + RO.x) / 2 : 0;
        if (ox) h += '<g class="ag-ramal-rot bajo' + (porOlver ? ' on' : '') + '" style="--c:' + colorNodo('OLVER') + '"><text x="' + ox + '" y="' + (cy - 9) + '" text-anchor="middle">EXPORTA + PDF</text></g>';
      }
    }
    flow.ejec.pares.forEach((p, k) => {
      let [a, b] = p.split('>'); if (flow.ramas && b === 'OLIVER' && a !== 'OLVER') a = 'APROB';   // llegó sin exportar: va por el carril de abajo
      const A = flow.POS[a], B = flow.POS[b]; if (!A || !B) return;
      const d = ruta(a, b), vivo = flow.estado[b] === 'corriendo', ca = colorNodo(a), cb = colorNodo(b), id = 'agdeg' + k;
      defs += '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + (A.x + T) + '" y1="' + (A.y + T / 2) + '" x2="' + B.x + '" y2="' + (B.y + T / 2 + 0.01) + '"><stop offset="0" stop-color="' + ca + '"/><stop offset="1" stop-color="' + cb + '"/></linearGradient>';
      h += '<path class="ag-cable halo" style="stroke:url(#' + id + ')" d="' + d + '"/><path class="ag-cable ' + (vivo ? 'vivo' : 'hecho') + '" style="stroke:url(#' + id + ')" d="' + d + '"/>';
      if (vivo) h += '<circle class="ag-paq" r="4.5" style="color:' + cb + '" fill="' + cb + '"><animateMotion dur="1.15s" repeatCount="indefinite" path="' + d + '"/></circle>';
      else if (A.fila === B.fila && A.y === B.y && Math.abs(A.col - B.col) === 1) { const mx = (A.x + T + B.x) / 2, my = A.y + T / 2; h += '<path class="ag-flecha on" style="stroke:' + cb + '" d="M' + (mx - 3) + ',' + (my - 5) + ' l5,5 l-5,5"/>'; }
    });
    flow.svg.innerHTML = '<defs>' + defs + '</defs>' + h;
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
    if (nueva) { flow.genTab = null; flow.disTab = null; nuevaEjec(); } else NODOS.forEach(n => { if (flow.estado[n.id] === 'espera') poner(n.id, 'ok'); });
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
    box.innerHTML = '<div class="ag-live-top"><b><i data-pto></i>PANTALLA EN VIVO</b><small data-estado></small><small class="ag-keys" title="Usa las flechas del teclado">← → pasan los PDF</small><a class="ag-ai-inst" href="/descargar-conector-illustrator" title="Instala el botón en ESTE computador (una sola vez). Si al tocar «Abrir en Illustrator» no pasa nada, hazlo">¿No abre? Instalar en este PC</a><button type="button" class="seguir ag-ai-btn" data-ai hidden title="Abre este PDF en el Illustrator de ESTE computador">' + LOGO_AI + ' Abrir en Illustrator</button><span class="ag-live-cnt" data-cnt></span><button type="button" class="seguir" data-seguir hidden>Seguir en vivo</button></div>' +
      '<div class="ag-live-body"><div class="ag-live-col"><div class="ag-live-vista" data-vista><button type="button" class="mu-flecha izq" data-pdf-go="-1" title="PDF anterior (←)"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="mu-flecha der" data-pdf-go="1" title="PDF siguiente (→)"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><img alt="PDF de producción"><div class="ag-live-vacio"><div><b>ESPERANDO LOS PDF</b><br>Aquí verás cada PDF de producción, con el nombre y el número de cada jugador, a medida que se genera.</div></div>' +
      '<span class="ag-live-tipo" data-tipo hidden></span><div class="ag-live-cap" data-cap><span class="num"></span><div><span class="nom"></span><small class="det"></small></div></div><div class="ag-live-prog"><i></i></div></div><div class="ag-live-tira" data-tira hidden></div></div>' +
      '<aside class="ag-live-side"><div class="ag-live-sec"><h4>MESAS EXPORTADAS <span data-nm>0</span></h4><div class="ag-live-list" data-lm></div></div>' +
      '<div class="ag-live-sec"><h4>PDF DE PRODUCCIÓN <span class="ag-gen" data-gen hidden></span><span data-np>0</span></h4><div class="ag-gen ag-dis" data-dis hidden></div><div class="ag-live-list" data-lp></div><small class="dest" data-dp></small></div></aside></div>';
    box.addEventListener('click', e => {
      const aiFila = e.target.closest('[data-ai-ruta]');
      if (aiFila) { e.preventDefault(); e.stopPropagation(); abrirEnIllustrator(aiFila.dataset.aiRuta); return; }
      const aiBtn = e.target.closest('[data-ai]');
      if (aiBtn) { abrirTodosEnIllustrator(); return; }
      const gt = e.target.closest('[data-gen-tab]');
      if (gt) { flow.genTab = gt.dataset.genTab; flow.vistaFija = null; pintarLive(); return; }
      const dt = e.target.closest('[data-dis-tab]');
      if (dt) { flow.disTab = dt.dataset.disTab; flow.vistaFija = null; pintarLive(); return; }
      const go = e.target.closest('[data-pdf-go]');
      if (go) { irPdf(Number(go.dataset.pdfGo)); return; }
      const fila = e.target.closest('[data-vista]'); if (fila && fila.dataset.vista) { flow.vistaFija = fila.dataset.vista; pintarLive(); return; }
      if (e.target.closest('[data-seguir]')) { flow.vistaFija = null; pintarLive(); }
    });
  }
  // «Abrir en Illustrator»: el navegador entrega indoor-ai:// al programa de ESTE PC (se registra con INSTALAR_AGENTES_EDICION.vbs) y este abre el PDF
  const LOGO_AI = '<svg class="ag-ailogo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="4.5" fill="#330000" stroke="#FF9A00" stroke-width="1.4"/><text x="12" y="16.3" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="11.5" fill="#FF9A00">Ai</text></svg>';
  // Botón de arriba: abre en Illustrator TODOS los PDF de producción de la orden. Se envían las carpetas donde quedaron (pocas) y el código de la orden;
  // el lanzador de este PC abre cada PDF de esas carpetas que empiece por ese código.
  function abrirTodosEnIllustrator() {
    const rutas = flow.rutasPdf || [];
    if (!rutas.length) return;
    const dir = r => r.replace(/[\\/][^\\/]*$/, '');
    const archivo = r => r.slice(Math.max(r.lastIndexOf('\\'), r.lastIndexOf('/')) + 1);
    const carpetas = [...new Set(rutas.map(dir))];
    const prefijo = (archivo(rutas[0]).split('_')[0] || String(st.orden || '')).trim() + '_';
    let url = 'indoor-ai://abrir/?carpetas=' + encodeURIComponent(carpetas.join('|')) + '&prefijo=' + encodeURIComponent(prefijo);
    if (url.length > 1800) {   // demasiadas carpetas para un enlace: se manda la carpeta común y el lanzador busca adentro
      let comun = carpetas.reduce((a, b) => { let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++; return a.slice(0, i); });
      const corte = Math.max(comun.lastIndexOf('\\'), comun.lastIndexOf('/'));
      if (corte > 0) comun = comun.slice(0, corte);
      url = 'indoor-ai://abrir/?carpetas=' + encodeURIComponent(comun) + '&prefijo=' + encodeURIComponent(prefijo) + '&recursivo=1';
    }
    window.location.href = url;
  }
  function abrirEnIllustrator(ruta) {
    if (!ruta) return;
    window.location.href = 'indoor-ai://abrir/?ruta=' + encodeURIComponent(ruta);
  }
  // Flechas de la pantalla en vivo: pasan de un PDF a otro mientras se van creando (al llegar al último vuelve a «en vivo»)
  function irPdf(paso) {
    const l = flow.conVista || []; if (!l.length) return;
    let i = l.findIndex(a => a.vista === flow.actualVista); if (i < 0) i = l.length - 1;
    i = Math.max(0, Math.min(l.length - 1, i + paso));
    flow.vistaFija = i === l.length - 1 ? null : l[i].vista;
    pintarLive();
  }
  // Aviso de fin: cuando los agentes terminan la orden aparece un cuadro grande en PDFS y un aviso flotante (y una notificación del navegador si ya diste permiso)
  const ESPERAS = { APROBACION: 'Esperando tu aprobación', JUGADORES: 'Esperando la lista de jugadores', CONFIRMAR_SHEETS: 'Esperando tu confirmación', CONFIRMAR: 'Esperando tu confirmación',
    ELEGIR_PROYECTO: 'Elige un proyecto', ELEGIR_PESTANA: 'Elige una pestaña', ELEGIR_AI: 'Elige un archivo' };
  function avisarFin() {
    if (st.esperando) return;
    // Si los agentes se detuvieron para preguntarte algo (aprobar, elegir un diseño…) la orden NO terminó: se avisa que esperan tu respuesta
    const ultimoBot = [...(st.msgs || [])].reverse().find(m => m.rol === 'bot');
    const motivo = ultimoBot && ESPERAS[ultimoBot.estado];
    if (motivo) {
      flow.fin = { orden: st.orden || '', espera: motivo, errores: 0, pdfs: 0, montajes: 0, hora: '' };
      pintarProg();
      document.querySelectorAll('.ag-toast-fin').forEach(x => x.remove());
      const t = document.createElement('div');
      t.className = 'ag-toast-fin err';
      t.innerHTML = '<i>?</i><div>Los agentes esperan tu respuesta<small>' + esc(motivo) + ' · orden ' + esc(st.orden || '') + '</small></div>';
      t.addEventListener('click', () => t.remove());
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 14000);
      return;
    }
    const evs = flow.ejec ? flow.ejec.eventos : [];
    const arch = evs.filter(e => e.archivo).map(e => e.archivo);
    const pdfs = new Set(arch.filter(a => a.tipo === 'pdf').map(a => a.detalle || (a.nombre + a.numero + a.talla))).size;
    const montajes = new Set(arch.filter(a => a.tipo === 'montaje').map(a => a.nombre)).size;
    const errores = evs.filter(e => e.nivel === 'ERROR').length;
    const d = new Date();
    flow.fin = { orden: st.orden || '', pdfs, montajes, errores, hora: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
    pintarLive(); pintarProg();
    const titulo = errores ? 'Los agentes terminaron la orden ' + flow.fin.orden + ' con errores' : 'Orden ' + flow.fin.orden + ' terminada';
    const detalle = pdfs + ' PDF de producción · ' + montajes + ' montajes';
    document.querySelectorAll('.ag-toast-fin').forEach(x => x.remove());
    const t = document.createElement('div');
    t.className = 'ag-toast-fin' + (errores ? ' err' : '');
    t.innerHTML = '<i>' + (errores ? '!' : '✓') + '</i><div>' + esc(titulo) + '<small>' + esc(detalle) + '</small></div>';
    t.addEventListener('click', () => t.remove());
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 14000);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(titulo, { body: detalle }); } catch (e) { /* sin notificaciones */ }
  }
  // Botón de progreso junto a la orden: se va llenando con su porcentaje mientras los agentes trabajan y al terminar bien muestra un chulo
  function progreso() {
    // Se calcula con los avisos reales de la ejecución en curso (el último pedido), no con la animación del flujo: sube con cada PDF que se crea
    const todos = st.evs || [], ult = todos.length ? todos[todos.length - 1].msg_id : null;
    const evs = ult == null ? [] : todos.filter(ev => ev.msg_id === ult);
    let total = 0; const pdfs = new Set();
    evs.forEach(ev => { const a = ev.archivo; if (!a) return; if (a.tipo === 'plan') total += Number(a.pdfs) || 0; else if (a.tipo === 'pdf') pdfs.add(a.detalle || (a.nombre + a.numero + a.talla)); });
    const etapas = [['LEO', 12], ['JACK', 12], ['OLVER', 26], ['OLIVER', 40], ['TERRY', 10]];
    const visto = id => evs.some(ev => ev.agente === id);
    let actual = -1; etapas.forEach(([id], i) => { if (visto(id)) actual = i; });
    let p = 0;
    etapas.forEach(([id, w], i) => {
      if (i < actual) p += w;
      else if (i === actual) p += w * (id === 'OLIVER' && total ? Math.min(1, pdfs.size / total) : 0.5);
    });
    return Math.max(st.esperando ? 3 : 0, Math.min(99, Math.round(p)));
  }
  function pintarProg() {
    const barra = panel && panel.querySelector('[data-orden]'); if (!barra) return;
    let b = barra.querySelector('[data-prog]');
    const trabajando = !!st.esperando, fin = !trabajando ? flow.fin : null;
    if (!trabajando && !fin) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'ag-prog'; b.setAttribute('data-prog', '');
      b.title = 'Progreso de los agentes: toca para ver los PDF';
      b.addEventListener('click', () => ponerVista('pdfs'));
      barra.insertBefore(b, barra.firstChild);
    }
    const espera = !!(fin && fin.espera);
    const pct = trabajando ? progreso() : (espera ? progreso() : 100);
    const clase = 'ag-prog' + (espera ? ' err' : (fin ? (fin.errores ? ' listo err' : ' listo') : ''));
    const rotulo = trabajando ? 'Ejecutando agentes' : (espera ? fin.espera : (fin.errores ? 'Terminó con errores' : 'Orden terminada'));
    const html = '<i class="fill"></i><span>' + rotulo + '</span><span class="pct">' + pct + '%</span><i class="chulo">' + (fin && fin.errores ? '!' : '✓') + '</i>';
    if (b.className !== clase) b.className = clase;
    if (b.dataset.h !== html) { b.dataset.h = html; b.innerHTML = html; }
    const f = b.querySelector('.fill'); if (f) f.style.width = pct + '%';
  }
  function pintarLive() {
    const box = panel && panel.querySelector('[data-live]'); if (!box) return;
    if (!box.dataset.listo) armarLive(box);
    const evs = flow.ejec ? flow.ejec.eventos.filter(e => e.archivo) : [];
    const montajes = [], pdfs = [], vm = new Set(), vp = new Set(); let total = 0, dm = '', dp = '';
    evs.forEach((e, idx) => {
      const a = e.archivo; a._i = idx;
      if (a.tipo === 'plan') total += Number(a.pdfs) || 0;
      else if (a.tipo === 'montaje' && !vm.has(a.nombre)) { vm.add(a.nombre); montajes.push(a); dm = a.carpeta || dm; }
      else if (a.tipo === 'pdf') { const k = a.detalle || (a.nombre + a.numero + a.talla); if (!vp.has(k)) { vp.add(k); pdfs.push(a); dp = a.carpeta || dp; } }
    });
    const q = sel => box.querySelector(sel);
    pintarProg();
    q('[data-pto]').className = st.esperando ? 'on' : '';
    q('[data-estado]').textContent = st.esperando ? 'Illustrator está trabajando…' : (evs.length ? 'Última ejecución' : 'Sin ejecución en curso');
    const itemM = a => '<span class="mt-nom">' + esc(a.nombre || '') + '</span>';   // el MISMO nombre de la mesa exportada (Talla_XS_Tipo_D1_Gen_F)
    q('[data-nm]').textContent = String(montajes.length);
    // Masculinos y femeninos: si la orden genera ambos aparecen dos pestañas; por defecto sigue al último PDF creado y, si eliges una, se queda en ella
    const sexoDe = a => { const m = /_Gen_([MF])(?:_|\.|$)/i.exec(String(a.detalle || a.nombre || '')); return m ? m[1].toUpperCase() : String(a.genero || '').charAt(0).toUpperCase(); };
    // Diseños: si la orden trae varios (D1, D2, D3…) cada uno va en su pestaña; igual que con el género, sigue al último PDF creado hasta que elijas una
    const disDe = a => { const m = /_Tipo_(D\d+)(?:_|\.|$)/i.exec(String(a.detalle || a.nombre || '')) || /DISE[ÑN]O\s*(\d+)/i.exec(String(a.diseno || '')); return m ? 'D' + String(m[1]).replace(/\D/g, '') : ''; };
    const disenos = [...new Set(pdfs.map(disDe).filter(Boolean))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const hayDis = disenos.length > 1;
    const pesDis = hayDis ? (disenos.includes(flow.disTab) ? flow.disTab : (disDe(pdfs[pdfs.length - 1]) || disenos[0])) : '';
    const delDis = hayDis ? pdfs.filter(a => disDe(a) === pesDis) : pdfs;
    const dis = q('[data-dis]');
    if (dis) {
      const firmaD = hayDis ? pesDis + '|' + disenos.map(d => d + ':' + pdfs.filter(a => disDe(a) === d).length).join(',') : '';
      if (dis.dataset.firma !== firmaD) {
        dis.dataset.firma = firmaD; dis.hidden = !hayDis;
        dis.innerHTML = hayDis ? disenos.map(d => '<button type="button" class="d' + (d === pesDis ? ' on' : '') + '" data-dis-tab="' + d + '" title="PDF de producción del diseño ' + d.slice(1) + '">' + d + ' <b>' + pdfs.filter(a => disDe(a) === d).length + '</b></button>').join('') : '';
      }
    }
    const nM = delDis.filter(a => sexoDe(a) === 'M').length, nF = delDis.filter(a => sexoDe(a) === 'F').length, hayAmbos = nM > 0 && nF > 0;
    const pestana = hayAmbos ? (flow.genTab === 'M' || flow.genTab === 'F' ? flow.genTab : (sexoDe(delDis[delDis.length - 1]) || 'M')) : '';
    const visibles = hayAmbos ? delDis.filter(a => sexoDe(a) === pestana) : delDis;
    const gen = q('[data-gen]');
    if (gen) {
      const firma = hayAmbos ? pestana + '|' + nM + '|' + nF : '';
      if (gen.dataset.firma !== firma) {
        gen.dataset.firma = firma; gen.hidden = !hayAmbos;
        gen.innerHTML = hayAmbos ? '<button type="button" class="m' + (pestana === 'M' ? ' on' : '') + '" data-gen-tab="M" title="PDF de producción masculinos">MASCULINOS <b>' + nM + '</b></button><button type="button" class="f' + (pestana === 'F' ? ' on' : '') + '" data-gen-tab="F" title="PDF de producción femeninos">FEMENINOS <b>' + nF + '</b></button>' : '';
      }
    }
    const conVista = visibles.filter(a => a.vista);
    // La pantalla en vivo muestra lo último que se creó, sea una MESA exportada (OLVER) o un PDF de producción (OLIVER); si eliges una fila, se queda en ella
    const mesasV = montajes.filter(a => a.vista);
    const fija = flow.vistaFija && (mesasV.find(a => a.vista === flow.vistaFija) || conVista.find(a => a.vista === flow.vistaFija));
    if (flow.vistaFija && !fija) flow.vistaFija = null;
    const ultP = conVista[conVista.length - 1], ultM = mesasV[mesasV.length - 1];
    const actual = fija || (ultM && (!ultP || ultM._i > ultP._i) ? ultM : ultP) || null;
    const esMesa = !!(actual && actual.tipo === 'montaje'), lista = esMesa ? mesasV : conVista;
    flow.conVista = lista; flow.actualVista = actual && actual.vista; flow.rutaActual = (actual && !esMesa && actual.ruta) || '';
    q('[data-lm]').innerHTML = montajes.slice().reverse().slice(0, 80).map((a, i) => '<div' + (a.vista ? ' data-vista="' + esc(a.vista) + '" title="Ver esta mesa en la pantalla"' : '') + ' class="' + (i === 0 ? 'nuevo ' : '') + (actual && a.vista && a.vista === actual.vista ? 'sel' : '') + '">' + itemM(a) +
      (a.vista ? '<a class="ag-vlink" href="/api/agentes/archivo/' + encodeURIComponent(a.vista) + '" target="_blank" rel="noopener" title="Ver esta mesa en grande (otra pestaña)">↗</a>' : '') + '</div>').join('') || '<div style="opacity:.5">Esperando…</div>';
    const tipoEl = q('[data-tipo]'); if (tipoEl) { tipoEl.hidden = !actual; tipoEl.textContent = esMesa ? 'MESA EXPORTADA · ' + (actual.nombre || '') : 'PDF DE PRODUCCIÓN'; tipoEl.className = 'ag-live-tipo ' + (esMesa ? 'mesa' : 'pdf'); }
    const tira = q('[data-tira]');
    if (tira) {
      const rot = a => esMesa ? ((/Talla_([^_]+)/i.exec(a.nombre || '') || [])[1] || a.nombre || '') : (a.numero ? '#' + a.numero : a.cantidad ? a.cantidad + ' u' : (a.talla || ''));
      const firmaT = (esMesa ? 'm' : 'p') + '|' + lista.map(a => a.vista).join(',');
      tira.hidden = lista.length < 2;
      if (tira.dataset.firma !== firmaT) {
        tira.dataset.firma = firmaT;
        tira.innerHTML = lista.map(a => '<button type="button" data-vista="' + esc(a.vista) + '" title="' + esc(a.detalle || a.nombre || '') + '"><img loading="lazy" alt="" src="/api/agentes/archivo/' + encodeURIComponent(a.vista) + '"><span>' + esc(String(rot(a)).toUpperCase()) + '</span></button>').join('');
      }
      let elegido = null;
      tira.querySelectorAll('button').forEach(b => { const on = !!actual && b.dataset.vista === actual.vista; b.classList.toggle('sel', on); if (on) elegido = b; });
      if (elegido && tira.dataset.sel !== elegido.dataset.vista) { tira.dataset.sel = elegido.dataset.vista; tira.scrollLeft = Math.max(0, elegido.offsetLeft - (tira.clientWidth - elegido.offsetWidth) / 2); }
    }
    const teclas = q('.ag-keys'); if (teclas) teclas.textContent = esMesa ? '← → pasan las mesas' : '← → pasan los PDF';
    flow.rutasPdf = pdfs.map(a => a.ruta).filter(Boolean);
    const bAi = q('[data-ai]');
    if (bAi) {
      bAi.hidden = !flow.rutasPdf.length;
      const rotulo = flow.rutasPdf.length === 1 ? 'Abrir el PDF en Illustrator' : 'Abrir los ' + flow.rutasPdf.length + ' PDF en Illustrator';
      if (bAi.dataset.rotulo !== rotulo) { bAi.dataset.rotulo = rotulo; bAi.innerHTML = LOGO_AI + ' ' + rotulo; }
      bAi.title = 'Abre en Illustrator, a la vez, todos los PDF de producción de esta orden (los de las carpetas de salida en la NAS)';
    }
    const iAct = actual ? lista.findIndex(a => a.vista === actual.vista) : -1;
    q('[data-cnt]').textContent = lista.length ? (esMesa ? 'Mesa ' : 'PDF ') + (iAct + 1) + ' / ' + lista.length : '';
    const bIzq = q('[data-pdf-go="-1"]'), bDer = q('[data-pdf-go="1"]');
    if (bIzq) bIzq.disabled = iAct <= 0;
    if (bDer) bDer.disabled = iAct < 0 || iAct >= lista.length - 1;
    q('[data-np]').textContent = pdfs.length + (total ? ' de ' + total : '');
    q('[data-lp]').innerHTML = visibles.slice().reverse().slice(0, 80).map((a, i) => '<div' + (a.vista ? ' data-vista="' + esc(a.vista) + '"' : '') + ' class="' + (i === 0 ? 'nuevo ' : '') + (actual && a.vista === actual.vista ? 'sel' : '') + '">' + (a.detalle ? '<b class="pdf-nom" title="' + esc(a.detalle) + '">' + esc(a.detalle) + '</b>' : (a.cantidad ? '<b>' + esc(a.cantidad) + ' unds</b> · sin nombre ni número · ' + esc(a.talla) : '<b>' + esc(a.nombre || 'Sin nombre') + '</b> · #' + esc(a.numero || '—') + ' · ' + esc(a.talla))) + (a.vista ? '<a class="ag-vlink" href="/api/agentes/archivo/' + encodeURIComponent(a.vista) + '" target="_blank" rel="noopener" title="Ver este PDF en grande (otra pestaña)">↗</a>' : '') + (a.ruta ? '<a href="#" class="ag-vlink ag-ai" data-ai-ruta="' + esc(a.ruta) + '" title="Abrir este PDF en Illustrator" aria-label="Abrir este PDF en Illustrator">' + LOGO_AI + '</a>' : '') + '</div>').join('') || '<div style="opacity:.5">Esperando…</div>';
    q('[data-dp]').textContent = dp ? '→ ' + dp : '';
    q('[data-seguir]').hidden = !fija;
    q('.ag-live-prog i').style.width = (total ? Math.min(100, Math.round(pdfs.length / total * 100)) : 0) + '%';
    box.style.setProperty('--pdfpct', (total ? Math.min(100, Math.round(pdfs.length / total * 100)) : 0) + '%');
    const vista = q('[data-vista]'), img = vista.querySelector('img'), cap = q('[data-cap]');
    if (!actual) { img.classList.remove('ok'); img.removeAttribute('src'); delete img.dataset.id; vista.querySelector('.ag-live-vacio').style.display = ''; cap.classList.remove('ok'); return; }
    q('.ag-live-cap .num').textContent = '#' + (actual.numero || '—');
    q('.ag-live-cap .nom').textContent = actual.nombre || 'Sin nombre';
    q('.ag-live-cap .det').textContent = ['Talla ' + actual.talla, actual.diseno, actual.genero].filter(Boolean).join(' · ');
    cap.classList.toggle('ok', !esMesa && !!(actual.nombre || actual.numero));   // sin nombre ni número (y en las mesas) no se muestra el rótulo
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
    const todos = flow.ejec.eventos, nAv = todos.filter(e => e.nivel === 'WARN').length, nEr = todos.filter(e => e.nivel === 'ERROR').length, cnt = panel.querySelector('[data-logcnt]');
    if (cnt) cnt.innerHTML = todos.length ? '<i>' + todos.length + (todos.length === 1 ? ' paso' : ' pasos') + '</i>' + (nAv ? '<i class="av">' + nAv + (nAv === 1 ? ' aviso' : ' avisos') + '</i>' : '') + (nEr ? '<i class="er">' + nEr + (nEr === 1 ? ' error' : ' errores') + '</i>' : '') : '';
    l.classList.toggle('sin', !lista.length);
    l.innerHTML = lista.length ? lista.map(e => { const ok = logExito(e); return '<div class="fila ' + esc(e.nivel) + (ok ? ' OK' : '') + '"><span class="h">' + esc(e.hora) + '</span><b style="--c:' + (COLORES[e.agente] || '#c4cfbf') + '">' + esc(e.agente) + '</b><span class="m">' + esc(ok || e.msg) + '</span></div>'; }).join('')
      : '<div class="vacio2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="1.2"/></svg><b>' + (flow.filtro ? 'Sin actividad para este filtro' : 'Sin actividad todavía') + '</b><span>' + (flow.filtro ? 'Este agente aún no ha hecho nada en esta ejecución.' : 'Cuando inicies la orden, aquí verás cada paso de los agentes con su hora.') + '</span></div>';
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
    box.style.setProperty('--respct', Math.round(avance) + '%');
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
    const dato = l => /^([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ .\/]{1,24}):\s+(\S.*)$/.exec(l), parte = l => /^(ERROR|Causa|Qué hacer):\s*(.*)$/i.exec(l);
    for (let i = 0; i < lineas.length; i++) {
      const pe = parte(lineas[i]);
      if (/datos? en blanco/i.test(lineas[i]) && /^•/.test(lineas[i + 1] || '')) {
        let j = i + 1; const det = [];
        while (j < lineas.length && /^•/.test(lineas[j])) det.push(lineas[j++]);
        out.push('<details class="ag-det"><summary>' + esc(lineas[i].replace(/^[^A-Za-zÁ-ú0-9]+/, '').replace(/\(no los invento.*?\)/i, '').trim().replace(/:$/, '')) + ' · ' + det.length + ' avisos · ver detalle</summary><div>' + esc(det.join('\n')) + '</div></details>');
        i = j - 1;
      } else if (pe) {   // «ERROR: … / Causa: … / Qué hacer: …»: cada parte con su rótulo
        const k = pe[1].toLowerCase().startsWith('error') ? 'e' : pe[1].toLowerCase().startsWith('causa') ? 'c' : 'q';
        out.push('<div class="ag-parte ' + k + '"><b>' + (k === 'e' ? '✖ Error' : k === 'c' ? 'Causa' : '💡 Qué hacer') + '</b><span>' + esc(pe[2]) + '</span></div>');
      } else if (dato(lineas[i]) && dato(lineas[i + 1] || '') && dato(lineas[i + 2] || '')) {   // tres o más renglones «Etiqueta: valor» seguidos
        let j = i; const filas = [];
        while (j < lineas.length && dato(lineas[j]) && !parte(lineas[j])) { const d = dato(lineas[j++]); filas.push('<div><dt>' + esc(d[1]) + '</dt><dd>' + esc(d[2]) + '</dd></div>'); }
        out.push('<dl class="ag-kv">' + filas.join('') + '</dl>');
        i = j - 1;
      } else out.push(esc(lineas[i]));
    }
    return out.join('\n').replace(/\n(<details|<dl|<div class="ag-parte)/g, '$1').replace(/(<\/details>|<\/dl>|<\/span><\/div>)\n/g, '$1');
  }
  // Renglones de sistema del chat: órdenes internas (cancelar, detener, inicio automático) no se muestran como si alguien las hubiera escrito
  const diaDe = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  function rotuloDia(iso) {
    const d = new Date(iso), hoy = new Date(), ayer = new Date(Date.now() - 864e5);
    if (diaDe(iso) === diaDe(hoy)) return 'Hoy';
    if (diaDe(iso) === diaDe(ayer)) return 'Ayer';
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function hiloHtml() {
    const out = []; let dia = '', cancelados = 0, ultCancel = '';
    const soltar = () => { if (cancelados) out.push('<div class="ag-sis">✕ Se canceló lo anterior' + (cancelados > 1 ? ' (' + cancelados + ' veces)' : '') + ' · ' + hora(ultCancel) + '</div>'); cancelados = 0; };
    const estadoMio = k => st.msgs.slice(k + 1).some(x => x.rol === 'bot') ? '<i class="ag-est ok" title="Atendido">✓✓</i>' : st.estado.conectado ? '<i class="ag-est" title="Enviado: los agentes lo están atendiendo">✓</i>' : '<i class="ag-est cola" title="En cola: el PC de los agentes no está conectado">🕓 en cola</i>';
    st.msgs.forEach((m, k) => {
      if (m.rol === 'yo' && m.texto === '__detener__') return;
      const dm = diaDe(m.creado);
      if (dm && dm !== dia) { soltar(); dia = dm; out.push('<div class="ag-dia"><span>' + esc(rotuloDia(m.creado)) + '</span></div>'); }
      if (m.rol === 'yo' && /^cancelar$/i.test(String(m.texto).trim())) { cancelados++; ultCancel = m.creado; return; }
      soltar();
      const auto = m.rol === 'yo' && /^(.*?)\s*\(inicio automático[^)]*\)\s*$/i.exec(m.texto);
      if (auto) { out.push('<div class="ag-sis auto">⚡ Inicio automático · ' + esc(auto[1]) + ' · ' + hora(m.creado) + '</div>'); return; }
      out.push(m.rol === 'yo'
        ? '<div class="ag-msg yo" data-mid="' + esc(m.id) + '"><div class="ag-txt">' + esc(m.texto) + '</div><span class="ag-time">' + hora(m.creado) + ' ' + estadoMio(k) + '</span></div>'
        : '<div class="ag-msg bot' + (m.estado === 'ERROR' ? ' err' : '') + (tablaChat(m) || (m.archivos && m.archivos.length) ? ' con-tabla' : '') + '" data-mid="' + esc(m.id) + '" style="--c:' + (COLORES[(m.agentes && m.agentes[0]) || 'TAVO'] || '#7da4ff') + '"><div class="ag-who">' + avatar((m.agentes && m.agentes[0]) || 'TAVO') + (m.agentes && m.agentes.length ? m.agentes : ['TAVO']).map(tag).join('') + '<button type="button" class="ag-copiar" data-copiar="' + esc(m.id) + '" title="Copiar el mensaje">⧉ Copiar</button></div><div class="ag-txt">' + textoHtml(m.tabla ? m.texto.split(/\n\nDesglose del listado/)[0] : m.texto) + '</div>' + (m.estado === 'ERROR' || /^[A-Z]+: /.test(m.texto) ? ayudaDe(m.texto, m.estado === 'ERROR' || /no pude|no pudo|falt|no aparece|no está/i.test(m.texto)) : '') + (tablaChat(m) ? tablaHtml(m) : '') + (m.archivos && m.archivos.length ? archivosHtml(m) : '') + '<span class="ag-time">' + hora(m.creado) + '</span></div>');
    });
    soltar();
    return out.join('');
  }

  // ================================================================== pantalla
  function armar() {
    panel.innerHTML = '<div class="ag"><header class="ag-hd"><h2>AGENTES</h2><div class="ag-state" data-estado></div>' +
      '<nav class="ag-tabs" data-tabs hidden aria-label="PC de los agentes" title="La pestaña activa es el PC donde arranca solo el proceso cuando alguien pone la P en EDICIÓN"></nav>' +
      '<div class="ag-indiv" aria-label="Usar un agente por separado">' + AGENTES_BTN.map(([a, t, p]) => '<button type="button" class="ag-agbtn" style="--c:' + (COLORES[a] || '#c4cfbf') + '" data-atajo="' + esc(p) + '" title="' + esc(a + ': ' + ROLES[a] + ' (usa la orden activa)') + '"><i></i>' + esc(a) + '<small>' + esc(t) + '</small></button>').join('') + '</div>' +
      '<div class="ag-hacc"><button type="button" class="ag-ico ag-campana" data-avisos aria-label="Avisos del chat">🔔</button><button type="button" class="ag-ico" data-historial title="Historial: busca en el chat y vuelve a leer conversaciones anteriores" aria-label="Historial del chat">🕘</button><button type="button" class="ag-btn danger ag-stop inactivo" data-detener data-txt="⏹ Detener" title="Detiene los agentes de esta pestaña (el PC elegido)">⏹ Detener</button>' +
      '<button type="button" class="ag-btn ag-reiniciar" data-reiniciar title="Reinicia el programa de los agentes en el PC elegido (se cierra y se vuelve a abrir solo)">↻ Reiniciar</button>' +
      '<details class="ag-menu"><summary class="ag-ico" title="Más opciones">⋯</summary><div class="ag-menu-l"><button type="button" data-detener-todo>⏹ Detener todo (ambos PC)</button><button type="button" data-reiniciar-todo>↻ Reiniciar todos los PC</button><button type="button" data-nueva>Nueva conversación</button><button type="button" data-historial>🕘 Historial del chat</button><button type="button" data-conectar hidden>PC de los agentes…</button></div></details></div></header>' +
      '<div data-aviso></div><section class="ag-res" data-resumen hidden></section>' +
      '<button type="button" class="ag-ver-flujo" data-ver-flujo>▾ Ver flujo, pantalla en vivo y registro</button><nav class="ag-vtabs" data-vtabs aria-label="Secciones de los agentes"><button type="button" class="ag-vt on" data-vt="chats">CHATS</button><button type="button" class="ag-vt" data-vt="agentes">AGENTES</button><button type="button" class="ag-vt" data-vt="pdfs">PDFS</button></nav><div class="ag-main" data-main data-vista="chats"><div class="ag-orden" data-orden></div><section class="ag-chat"><div class="ag-thread" data-hilo></div><button type="button" class="ag-bajar" data-bajar hidden>↓ Mensajes nuevos</button><div class="ag-chips" data-replies></div>' +
      '<form class="ag-form" data-form><details class="ag-menu ag-atajos"><summary class="ag-ico" title="Acciones rápidas">⚡</summary><div class="ag-menu-l">' + ATAJOS.map(([l, p]) => '<button type="button" data-atajo="' + esc(p) + '">' + esc(l) + '</button>').join('') + '</div></details>' +
      '<div class="ag-sug" data-sug hidden role="listbox" aria-label="Sugerencias"></div><textarea rows="1" placeholder="Escribe a TAVO…" maxlength="2000" aria-autocomplete="list"></textarea><button type="submit" class="ag-btn">Enviar</button></form></section>' +
      '<aside class="ag-muestras" data-muestras></aside><section class="ag-flowcol"><div class="ag-lienzo" data-lienzo><div class="ag-barra"><div class="ag-ftit">Flujo de agentes<small data-ejecnum></small></div><div class="ag-pildora" data-pildora><i></i><span>Listo</span></div></div><svg class="ag-cables" data-cables aria-hidden="true"></svg></div>' +
      '<div class="ag-live" data-live></div>' +
      '<div class="ag-detalle"><header><h3>Registro de ejecución</h3><span class="ag-logcnt" data-logcnt></span><div class="ag-filtros" data-filtros></div></header><div class="ag-log" data-log></div></div></section></div></div>';
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
  const abierto = (m, i) => { const k = m.id + ':' + i; return st.abiertos[k] === true; };
  const sinImagenEnChat = () => !(window.matchMedia && matchMedia('(max-width:1000px)').matches);   // en computador el chat nunca muestra imágenes
  function archivosHtml(m) {
    return '<div class="ag-files">' + m.archivos.map((a, i) => {
      const url = a.id ? '/api/agentes/archivo/' + a.id : '', soloTexto = sinImagenEnChat(), ver = !soloTexto && a.id && abierto(m, i);
      const previa = ver ? (esImagen(a) ? '<img class="ag-prev" src="' + url + '" alt="' + esc(a.titulo) + '">' : '<iframe class="ag-prev" src="' + url + '#toolbar=0&navpanes=0&view=FitH" loading="lazy" title="' + esc(a.titulo) + '"></iframe>') : '';
      return '<article class="ag-file ' + esc(a.tipo) + (ver ? ' abierto' : '') + '"><div class="ag-file-head"><span class="ag-fico txt">' + esc(String(a.ext || (a.nombre || '').split('.').pop() || 'ARCH').toUpperCase().slice(0, 4)) + '</span><div><b>' + esc(a.titulo || a.nombre) + '</b><small>' + esc(a.nombre) + (a.size ? ' · ' + KB(a.size) : '') + '</small></div></div>' + previa +
        '<div class="ag-file-acc">' + (a.id ? (soloTexto ? (a.tipo === 'muestra' ? '<button type="button" data-f-derecha="' + esc(a.id) + '" title="Ver esta muestra en la zona de la derecha">Ver a la derecha →</button>' : '') : '<button type="button" data-f-ver="' + m.id + ':' + i + '">' + (ver ? 'Ocultar' : 'Ver') + '</button>') + '<a href="' + url + '" target="_blank" rel="noopener" title="Abrir en otra pestaña">↗</a><a href="' + url + '?descargar=1" download title="Descargar">⬇</a>' : '<span class="nopre">Sin vista previa</span>') +
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

  // Cuadro fijo de MUESTRAS: las muestras (D1, D2…) de la última respuesta que las trae, con flechas para pasar de una a otra
  function muestrasActuales() {
    for (let i = st.msgs.length - 1; i >= 0; i--) {
      const lista = (st.msgs[i].archivos || []).filter(a => a.tipo === 'muestra' && a.id);
      if (lista.length) return lista;
    }
    return [];
  }
  const etiquetaMuestra = (a, i) => { const t = String((a.titulo || '') + ' ' + (a.nombre || '')); const m = /Dise[ñn]o\s*(\d+)/i.exec(t) || /(?:^|[_\s-])D(\d+)(?!\d)/i.exec(t); return m ? 'D' + m[1] : 'M' + (i + 1); };
  // Listado más reciente que hayan enviado los agentes (LEO al leerlo, o TAVO al pedir la aprobación)
  function listadoActual() { for (let i = st.msgs.length - 1; i >= 0; i--) if (st.msgs[i].tabla && (st.msgs[i].tabla.filas || []).length) return st.msgs[i]; return null; }
  function listadoHtml(m, etiqueta) {
    const t = m.tabla, col = n => t.columnas.findIndex(c => sinTildes(c).startsWith(n));
    const cN = col('nombre'), cT = col('talla'), cNu = col('numero'), cD = col('diseno'), cG = col('genero'), cO = col('observ');
    const numD = v => (/\d+/.exec(String(v || '')) || [''])[0], dAct = numD(etiqueta);
    const delDis = cD >= 0 && dAct ? t.filas.filter(f => numD(f[cD]) === dAct) : [];
    const filtra = delDis.length > 0 && !st.muTodo, filas = filtra ? delDis : t.filas;
    const cuenta = {}; filas.forEach(f => { const x = String((cT >= 0 && f[cT]) || '—').toUpperCase(); cuenta[x] = (cuenta[x] || 0) + 1; });
    const ORD = ['2', '4', '6', '8', '10', '12', '14', '16', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'], pos = x => { const i = ORD.indexOf(x); return i < 0 ? 99 : i; };
    const tallas = Object.keys(cuenta).sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
    const hayObs = cO >= 0 && filas.some(f => String(f[cO] || '').trim()), hayGen = cG >= 0 && new Set(filas.map(f => String(f[cG] || '').toUpperCase())).size > 1, v = (f, c) => (c >= 0 && String(f[c] || '').trim()) || '—';
    return '<section class="mu-listado"><header><b>LISTADO</b>' + (delDis.length ? '<span class="mu-ldis">' + esc(filtra ? etiqueta : 'Todos') + '</span>' : '') + '<i>' + filas.length + (filas.length === 1 ? ' pieza' : ' piezas') + '</i>' +
      (delDis.length && delDis.length < t.filas.length ? '<button type="button" data-mu-todo title="' + (st.muTodo ? 'Ver solo las piezas de este diseño' : 'Ver todo el listado de la orden') + '">' + (st.muTodo ? 'Solo ' + esc(etiqueta) : 'Ver todo') + '</button>' : '') + '</header>' +
      '<div class="mu-ltallas">' + tallas.map(x => '<span><b>' + esc(x) + '</b>×' + cuenta[x] + '</span>').join('') + '</div>' +
      '<div class="mu-ltabla"><table><thead><tr><th>#</th><th>Nombre</th><th>Talla</th><th>Número</th><th>Diseño</th><th>Género</th><th>Observaciones</th></tr></thead><tbody>' +   // siempre las seis columnas del listado
      filas.map((f, i) => '<tr><td>' + (i + 1) + '</td><td class="n">' + esc(v(f, cN)) + '</td><td class="t">' + esc(String(v(f, cT)).toUpperCase()) + '</td><td class="u">' + esc(v(f, cNu)) + '</td><td class="d">' + esc(String(v(f, cD)).toUpperCase()) + '</td><td class="g">' + esc(String(v(f, cG)).toUpperCase()) + '</td><td class="o">' + esc(v(f, cO)) + '</td></tr>').join('') + '</tbody></table></div></section>';
  }
  function pintarMuestras() {
    const box = panel && panel.querySelector('[data-muestras]'); if (!box) return;
    const lista = muestrasActuales(), firma = lista.map(a => a.id).join(',');
    if (firma !== st.muFirma) { st.muFirma = firma; st.muIdx = 0; }
    st.muIdx = Math.max(0, Math.min(st.muIdx || 0, lista.length - 1));
    const mList = listadoActual();
    const clave = firma + '|' + st.muIdx + '|' + (mList ? mList.id + (st.muTodo ? 't' : 'd') : '');
    if (box.dataset.f === clave) return;
    box.dataset.f = clave;
    const sinListado = '<section class="mu-listado mu-espera"><span><b>LISTADO</b>Aquí aparece el listado de la orden<br>cuando el agente lo lea.</span></section>';
    const sinMuestra = '<div class="mu-cuerpo mu-espera"><span><b>MUESTRA</b>Aquí aparecen las muestras (D1, D2, D3…)<br>cuando JACK las cree.</span></div>';
    if (!lista.length) { box.innerHTML = '<div class="mu-top"><h4>LISTADO Y MUESTRA</h4></div><div class="mu-doble">' + (mList ? listadoHtml(mList, '') : sinListado) + sinMuestra + '</div><div class="mu-pie"></div>'; return; }
    const a = lista[st.muIdx], url = '/api/agentes/archivo/' + a.id;
    box.innerHTML = '<div class="mu-top"><h4>MUESTRAS</h4>' + lista.map((x, i) => '<button type="button" class="mu-chip' + (i === st.muIdx ? ' on' : '') + '" data-mu-i="' + i + '">' + esc(etiquetaMuestra(x, i)) + '</button>').join('') +
      '<div class="mu-nav"><span>' + (st.muIdx + 1) + ' / ' + lista.length + '</span>' +
      '<a href="' + url + '" target="_blank" rel="noopener" title="Abrir en otra pestaña">↗</a><a href="' + url + '?descargar=1" download title="Descargar">⬇</a></div></div>' +
      '<div class="mu-doble">' + (mList ? listadoHtml(mList, etiquetaMuestra(a, st.muIdx)) : sinListado) + '<div class="mu-cuerpo"><button type="button" class="mu-flecha izq" data-mu-go="-1" title="Muestra anterior (←)"' + (st.muIdx === 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="mu-flecha der" data-mu-go="1" title="Muestra siguiente (→)"' + (st.muIdx === lista.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' + (esImagen(a) ? '<img src="' + url + '" alt="' + esc(a.titulo || a.nombre) + '">' : '<iframe src="' + url + '#toolbar=0&navpanes=0&view=Fit" title="' + esc(a.titulo || a.nombre) + '"></iframe>') + '</div></div>' +
      '<div class="mu-pie"><span><b>' + esc(a.titulo || a.nombre) + '</b> · ' + esc(a.nombre || '') + '</span></div>';
  }
  function pintar() {
    if (!panel || !panel.dataset.armado) return;
    const e = st.estado, ultimo = st.msgs[st.msgs.length - 1];
    const botones = ultimo && ultimo.rol === 'bot' && !st.esperando ? (ultimo.botones || []) : [];
    const pill = (clase, texto) => '<span class="ag-pill ' + clase + '"><i></i>' + esc(texto) + '</span>';
    const modo = v => !v ? '' : v === 'real' ? 'ok' : /^error/.test(v) ? 'mal' : 'sim';
    panel.querySelector('[data-estado]').innerHTML = pill(e.conectado ? 'ok' : 'mal', (e.pc && e.pc.nombre ? e.pc.nombre + ' · ' : '') + (e.conectado ? 'PC conectado' : 'PC desconectado')) + 
      '<button type="button" class="ag-pill ' + (e.auto ? 'ok' : 'sim') + '" data-auto title="Cuando una tarjeta de EDICIÓN pasa a «en proceso», los agentes arrancan solos con esa orden. Toca para ' + (e.auto ? 'apagar' : 'encender') + '" style="cursor:pointer"><i></i>Auto ' + (e.auto ? 'ON' : 'OFF') + '</button>';
    panel.querySelector('[data-aviso]').innerHTML = !e.conectado ? '<div class="ag-warn">El PC «' + esc((e.pc && e.pc.nombre) || 'de los agentes') + '» no está conectado. Tu mensaje queda en cola y se atiende cuando ese PC esté encendido con los agentes iniciados' + ((e.pcs || []).some(p => p.conectado && p.id !== (e.pc && e.pc.id)) ? '; también puedes elegir otro PC conectado arriba.' : '.') + '</div>' : '';
    const trabajo = st.trabajo;
    const hilo = st.msgs.length ? hiloHtml()
      : '<div class="ag-empty"><div class="ag-empty-av">' + ['TAVO', 'LEO', 'JACK', 'OLVER', 'OLIVER', 'TERRY'].map(avatar).join('') + '</div><h3>¿Qué necesitas hoy?</h3><p>' + (st.orden ? 'Trabajando con la orden <b>' + esc(st.orden) + '</b>. Elige una acción o escríbele a TAVO.' : 'Fija la orden arriba y pídele lo que necesites. TAVO decide qué agente actúa.') + '</p>' +
        '<div class="ag-empty-acc">' + ATAJOS.filter(([l]) => l !== 'Reiniciar').map(([l, t]) => '<button type="button" data-atajo="' + esc(t) + '">' + esc(l) + '</button>').join('') + '</div></div>';
    const trabajando = st.esperando ? '<div class="ag-work"><div class="ag-who">' + ((trabajo && trabajo.agentes) || ['TAVO']).map(a => tag(a)).join('') + '<span class="ag-dots"><i></i><i></i><i></i></span></div><b>' +
      esc(trabajo && trabajo.msg ? trabajo.agente + ': ' + trabajo.msg : e.conectado ? 'TAVO está trabajando…' : 'Esperando al PC de los agentes…') + '</b><button type="button" class="ag-btn danger" data-detener>Detener</button></div>' : '';
    const barra = panel.querySelector('[data-orden]'), claveOrden = st.orden + '|' + st.cambiandoOrden;
    if (barra.dataset.clave !== claveOrden) {
      barra.dataset.clave = claveOrden;
      barra.innerHTML = st.orden && !st.cambiandoOrden
        ? '<span class="ag-ochip" title="Todo lo que pidas se hace con esta orden">Orden <b>' + esc(st.orden) + '</b><button type="button" class="ag-ico" data-orden-cambiar title="Cambiar la orden">✎</button></span>' +
          '<button type="button" class="ag-btn" data-iniciar title="Lee el listado, crea la muestra, te pide aprobarla y sigue con las mesas y los PDF de producción">▶ Iniciar</button>' +
          '<a class="ag-btn sec ag-nas" data-nas-orden href="/nas/abrir?order=' + encodeURIComponent(st.orden) + '" title="Abrir la carpeta de la orden ' + esc(st.orden) + ' en el NAS (Explorador de archivos)">📁 NAS <span>↗</span></a>' +
          '<details class="ag-mas"><summary class="ag-btn sec" title="Más acciones">⋯</summary><div class="ag-mas-menu">' +
          '<button type="button" data-reprocesar title="Vuelve a procesar una orden que ya se hizo: tú eliges si reemplazas todo o conservas lo que ya existe">↻ Reprocesar la orden</button>' +
          '<button type="button" data-orden-quitar title="Quitar la orden">✕ Quitar la orden</button></div></details>'
        : '<form data-orden-form><label for="ag-orden-in">Orden</label><input id="ag-orden-in" maxlength="12" autocomplete="off" placeholder="CO6133" value="' + esc(st.orden) + '" title="Escríbela una sola vez y TAVO relaciona todo con ella"><button type="submit" class="ag-btn">Fijar</button>' + (st.orden ? '<button type="button" class="ag-ico" data-orden-cancelar title="Cancelar">✕</button>' : '') + '</form>';
      if (st.cambiandoOrden) panel.querySelector('#ag-orden-in')?.focus();
    }
    pintarProg();
    panel.querySelector('textarea').placeholder = st.orden ? 'Pídele a TAVO (usa la orden ' + st.orden + ')…' : 'Escribe a TAVO…';
    const hiloEl = panel.querySelector('[data-hilo]'), firma = hilo + trabajando;
    if (hiloEl.dataset.firma !== firma) {
      const abajo = !hiloEl.dataset.firma || hiloEl.scrollHeight - hiloEl.scrollTop - hiloEl.clientHeight < 90, antes = hiloEl.scrollTop, mio = ultimo && ultimo.rol === 'yo' && String(ultimo.id) !== hiloEl.dataset.ult;
      const llegaNuevo = !!hiloEl.dataset.firma && ultimo && String(ultimo.id) !== hiloEl.dataset.ult;
      hiloEl.innerHTML = firma; hiloEl.dataset.firma = firma; hiloEl.dataset.ult = ultimo ? String(ultimo.id) : '';
      if (llegaNuevo) { const ms = hiloEl.querySelectorAll('.ag-msg'); if (ms.length) ms[ms.length - 1].classList.add('ag-entra'); }
      if (abajo || mio) hiloEl.scrollTop = hiloEl.scrollHeight; else hiloEl.scrollTop = antes;
      const bajar = panel.querySelector('[data-bajar]'); if (bajar) bajar.hidden = abajo || mio;
    }
    pintarMuestras();
    panel.querySelector('[data-replies]').innerHTML = botones.length ? botones.map(b => '<button type="button" class="reply" data-send="' + esc(b) + '">' + esc(b) + '</button>').join('')
      : st.msgs.length ? ATAJOS.filter(([l]) => l !== 'Reiniciar').map(([l, t]) => '<button type="button" class="rap" data-atajo="' + esc(t) + '"' + (st.esperando ? ' disabled' : '') + '>' + esc(l) + '</button>').join('') : '';
    panel.querySelector('[data-replies]').classList.toggle('rapidas', !botones.length);
    const btnAv = panel.querySelector('[data-avisos]'); if (btnAv) { btnAv.textContent = st.avisos ? '🔔' : '🔕'; btnAv.title = st.avisos ? 'Avisos encendidos: sonido y notificación cuando los agentes responden. Toca para apagarlos' : 'Avisos apagados. Toca para que suene y te notifique cuando los agentes respondan'; btnAv.classList.toggle('on', !!st.avisos); }
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

  // ---- sugerencias al escribir y recuperar mensajes anteriores
  const sug = { lista: [], i: -1, rec: -1 };
  const mios = () => [...new Set(st.msgs.filter(m => m.rol === 'yo' && !/^(cancelar|__detener__)$/i.test(String(m.texto).trim()) && !/\(inicio automático/i.test(m.texto)).map(m => String(m.texto).trim()).reverse())];
  const conOrden = t => (t.endsWith(' ') ? t.trim() + (st.orden ? ' ' + st.orden : ' ') : t);
  function opcionesSug(texto) {
    const q = sinTildes(texto).trim(); if (!q) return [];
    const base = ATAJOS.filter(([l]) => l !== 'Reiniciar').map(([l, t]) => ({ t: conOrden(t), n: l, k: 'Acción' })).concat(AGENTES_BTN.filter(([a]) => a === 'TERRY').map(([a, l, t]) => ({ t: conOrden(t), n: 'MTS requeridos', k: 'Acción' })))
      .concat([{ t: 'cancelar', n: 'Cancelar lo que estaba haciendo', k: 'Acción' }]).concat(mios().slice(0, 12).map(t => ({ t, n: '', k: 'Ya lo enviaste' })));
    const vistos = new Set();
    return base.filter(o => { const c = sinTildes(o.t).trim(); if (c === q || vistos.has(c)) return false; if (!(sinTildes(o.t).includes(q) || sinTildes(o.n).includes(q))) return false; vistos.add(c); return true; }).slice(0, 6);
  }
  function pintarSug() {
    const caja = panel.querySelector('[data-sug]'), ta = panel.querySelector('[data-form] textarea'); if (!caja) return;
    sug.lista = document.activeElement === ta && !st.esperando ? opcionesSug(ta.value) : [];
    if (sug.i >= sug.lista.length) sug.i = -1;
    caja.hidden = !sug.lista.length;
    caja.innerHTML = sug.lista.map((o, i) => '<button type="button" role="option" data-sug-i="' + i + '" aria-selected="' + (i === sug.i) + '"><span>' + esc(o.t.trim()) + '</span><small>' + esc(o.n ? o.n : o.k) + '</small></button>').join('') + (sug.lista.length ? '<p>↑ ↓ para elegir · Tab o Enter para usarla · Esc para cerrar</p>' : '');
  }
  function usarSug(i) {
    const o = sug.lista[i], ta = panel.querySelector('[data-form] textarea'); if (!o) return;
    ta.value = o.t; ta.focus(); ta.setSelectionRange(o.t.length, o.t.length); sug.i = -1; ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function teclaChat(e) {   // devuelve true si la tecla ya se atendió
    const ta = e.target;
    if (sug.lista.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const n = sug.lista.length; sug.i = e.key === 'ArrowDown' ? (sug.i + 1) % n : (sug.i <= 0 ? n - 1 : sug.i - 1); pintarSug(); return true; }
    if (sug.lista.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && sug.i >= 0))) { e.preventDefault(); usarSug(sug.i >= 0 ? sug.i : 0); return true; }
    if (e.key === 'Escape' && sug.lista.length) { e.preventDefault(); sug.lista = []; sug.i = -1; const c = panel.querySelector('[data-sug]'); if (c) c.hidden = true; return true; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (!ta.value || sug.rec >= 0)) {   // ↑ con la caja vacía: lo último que enviaste
      const l = mios(); if (!l.length) return false;
      e.preventDefault(); sug.rec = e.key === 'ArrowUp' ? Math.min(sug.rec + 1, l.length - 1) : sug.rec - 1;
      ta.value = sug.rec >= 0 ? l[sug.rec] : ''; ta.setSelectionRange(ta.value.length, ta.value.length); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
      return true;
    }
    return false;
  }

  // ---- avisos: sonido, notificación del navegador y contador en el título cuando los agentes responden y no estás mirando el chat
  try { st.avisos = localStorage.getItem('agentes_avisos') !== '0'; } catch (e) { st.avisos = true; }
  let audioCtx = null, sinLeer = 0; const tituloBase = document.title;
  function sonar(tipo) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notas = tipo === 'error' ? [330, 247] : tipo === 'pregunta' ? [660, 880, 660] : [660, 880], t0 = audioCtx.currentTime;
      notas.forEach((f, i) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + i * 0.16); g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.15); o.connect(g); g.connect(audioCtx.destination); o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.17); });
    } catch (e) { /* sin sonido */ }
  }
  const mirando = () => !document.hidden && panel && panel.classList.contains('active');
  function avisarMensajes(nuevos) {
    const bots = nuevos.filter(m => m.rol === 'bot'); if (!bots.length || !st.avisos) return;
    const m = bots[bots.length - 1], tipo = m.estado === 'ERROR' ? 'error' : ESPERAS[m.estado] ? 'pregunta' : 'ok';
    if (mirando() && tipo === 'ok') return;   // lo estás viendo y no hay nada que resolver: no se molesta
    sonar(tipo);
    if (mirando()) return;
    sinLeer += bots.length; document.title = '(' + sinLeer + ') ' + tituloBase;
    try {
      if (window.Notification && Notification.permission === 'granted') {
        const n = new Notification((tipo === 'error' ? '✖ Error' : tipo === 'pregunta' ? '⏸ ' + ESPERAS[m.estado] : '✓ Los agentes respondieron') + (st.orden ? ' · ' + st.orden : ''), { body: String(m.texto || '').split('\n').filter(Boolean)[0].slice(0, 140), tag: 'agentes-indoor', renotify: true });
        n.onclick = () => { window.focus(); if (tab) tab.click(); n.close(); };
      }
    } catch (e) { /* sin notificaciones */ }
  }
  function leido() { if (sinLeer && mirando()) { sinLeer = 0; document.title = tituloBase; } }
  document.addEventListener('visibilitychange', leido);
  async function cambiarAvisos() {
    st.avisos = !st.avisos; try { localStorage.setItem('agentes_avisos', st.avisos ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    if (st.avisos) { sonar('ok'); try { if (window.Notification && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) { /* el navegador no las permite */ }
      if (window.Notification && Notification.permission === 'denied') aviso('El navegador tiene bloqueadas las notificaciones de esta página: igual sonará, pero no saldrá el aviso emergente.', false); }
    pintar();
  }

  // ---- historial: buscar en esta conversación y volver a leer las anteriores (las que se cerraron con «Nueva conversación»)
  const hist = { q: '', lista: null, ver: null, error: '', t: 0 };
  let histEl = null;
  const fechaCorta = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ' · ' + hora(iso); };
  function pintarHist() {
    if (!histEl) return;
    const cuerpo = histEl.querySelector('[data-hist-cuerpo]'), q = sinTildes(hist.q).trim();
    if (hist.ver) {
      const c = hist.ver; let dia = '';
      cuerpo.innerHTML = '<div class="ag-hist-cab"><button type="button" class="ag-btn sec" data-hist-volver>← Volver</button><span>' + esc((c.ordenes || []).join(', ') || 'Sin orden') + ' · ' + esc(c.pc) + ' · ' + esc(fechaCorta(c.inicio)) + '</span></div><div class="ag-thread ag-hist-hilo">' +
        (c.mensajes || []).map(m => { const d = diaDe(m.creado), sep = d !== dia ? '<div class="ag-dia"><span>' + esc(rotuloDia(m.creado)) + '</span></div>' : ''; dia = d;
          return sep + (m.rol === 'yo' ? '<div class="ag-msg yo"><div class="ag-txt">' + esc(m.texto) + '</div><span class="ag-time">' + hora(m.creado) + '</span></div>'
            : '<div class="ag-msg bot' + (m.estado === 'ERROR' ? ' err' : '') + '" style="--c:' + (COLORES[(m.agentes || [])[0] || 'TAVO'] || '#7da4ff') + '"><div class="ag-who">' + avatar((m.agentes || [])[0] || 'TAVO') + ((m.agentes || []).length ? m.agentes : ['TAVO']).map(tag).join('') + '</div><div class="ag-txt">' + textoHtml(m.texto) + '</div><span class="ag-time">' + hora(m.creado) + '</span></div>'); }).join('') + '</div>';
      return;
    }
    const aqui = q ? st.msgs.filter(m => m.texto !== '__detener__' && sinTildes(m.texto).includes(q)).slice(-30).reverse() : [];
    const actual = q ? '<p class="ag-hist-sec">En esta conversación (' + aqui.length + ')</p>' + (aqui.length ? aqui.map(m => '<button type="button" class="ag-hist-item" data-hist-ir="' + esc(m.id) + '"><b>' + (m.rol === 'yo' ? 'Tú' : esc(((m.agentes || [])[0]) || 'TAVO')) + '</b><span>' + esc(String(m.texto).replace(/\s+/g, ' ').slice(0, 150)) + '</span><small>' + esc(fechaCorta(m.creado)) + '</small></button>').join('') : '<p class="ag-hist-vacio">Nada coincide en la conversación actual.</p>') : '';
    const l = hist.lista;
    const viejas = '<p class="ag-hist-sec">Conversaciones anteriores' + (l ? ' (' + l.length + ')' : '') + '</p>' + (hist.error ? '<p class="ag-hist-vacio">' + esc(hist.error) + '</p>' : !l ? '<p class="ag-hist-vacio">Cargando…</p>' : l.length ? l.map(c => '<button type="button" class="ag-hist-item" data-hist-ver="' + esc(c.id) + '"><b>' + esc((c.ordenes || []).join(', ') || 'Sin orden') + '</b><span>' + esc(String(c.resumen).replace(/\s+/g, ' ')) + '</span><small>' + esc(fechaCorta(c.inicio)) + ' · ' + esc(c.pc) + ' · ' + c.n + ' mensajes</small></button>').join('')
      : '<p class="ag-hist-vacio">' + (q ? 'Ninguna conversación anterior coincide.' : 'Todavía no hay conversaciones guardadas. Cada vez que pulses «Nueva conversación», la anterior queda aquí.') + '</p>');
    cuerpo.innerHTML = actual + viejas;
  }
  async function cargarHist() {
    const q = hist.q.trim();
    try { const r = await api('/api/agentes/historial' + (q ? '?q=' + encodeURIComponent(q) : '')); if (q === hist.q.trim()) { hist.lista = r.conversaciones || []; hist.error = ''; } }
    catch (e) { hist.lista = []; hist.error = e.message; }
    pintarHist();
  }
  function cerrarHist() { if (histEl) histEl.remove(); histEl = null; }
  function abrirHistorial() {
    if (histEl) return;
    hist.q = ''; hist.lista = null; hist.ver = null; hist.error = '';
    histEl = document.createElement('div'); histEl.className = 'ag-hist'; histEl.setAttribute('role', 'dialog'); histEl.setAttribute('aria-modal', 'true'); histEl.setAttribute('aria-label', 'Historial de conversaciones');
    histEl.innerHTML = '<div class="ag-hist-card"><header><b>HISTORIAL DEL CHAT</b><button type="button" class="ag-ico" data-hist-cerrar aria-label="Cerrar">✕</button></header><input type="search" data-hist-q placeholder="Busca por orden (CO6133) o por una palabra…" autocomplete="off"><div class="ag-hist-cuerpo" data-hist-cuerpo></div></div>';
    histEl.addEventListener('click', async e => {
      if (e.target === histEl || e.target.closest('[data-hist-cerrar]')) { cerrarHist(); return; }
      if (e.target.closest('[data-hist-volver]')) { hist.ver = null; histEl.querySelector('[data-hist-q]').hidden = false; pintarHist(); return; }
      const ir = e.target.closest('[data-hist-ir]'), ver = e.target.closest('[data-hist-ver]');
      if (ir) { cerrarHist(); ponerVista('chats'); const el = panel.querySelector('[data-mid="' + ir.dataset.histIr + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ag-hallado'); setTimeout(() => el.classList.remove('ag-hallado'), 2600); } return; }
      if (ver) { try { hist.ver = await api('/api/agentes/historial/' + encodeURIComponent(ver.dataset.histVer)); histEl.querySelector('[data-hist-q]').hidden = true; } catch (er) { hist.error = er.message; } pintarHist(); }
    });
    histEl.addEventListener('input', e => { if (!e.target.matches('[data-hist-q]')) return; hist.q = e.target.value; pintarHist(); clearTimeout(hist.t); hist.t = setTimeout(cargarHist, 300); });
    histEl.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHist(); });
    document.body.appendChild(histEl); pintarHist(); cargarHist(); histEl.querySelector('[data-hist-q]').focus();
  }

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
    flow.listo = false; flow.preparado = 0; flow.estadoServidor = null; flow.vistaFija = null; flow.genTab = null; flow.disTab = null;
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
      const estabaTrabajando = !!st.esperando;
      st.esperando = datos.esperando; st.trabajo = datos.trabajo; st.estado = estado;
      if (estabaTrabajando && !st.esperando && !primera) setTimeout(avisarFin, 600);   // dejar que lleguen los últimos eventos y archivos
      if (st.esperando) flow.fin = null;
      if (!st.cambiandoOrden) st.orden = datos.orden || '';
      if (nuevos.length) { st.msgs = st.msgs.concat(nuevos); st.ultimo = Math.max(...nuevos.map(m => m.id), st.ultimo); if (!primera) avisarMensajes(nuevos); }
      if (evs.length) st.evs = st.evs.concat(evs);
      st.ultimoEv = Math.max(st.ultimoEv, datos.ultimo_ev || 0);
      pintarProg();
      if (primera) {
        reconstruir();
        const ub = [...st.msgs].reverse().find(m => m.rol === 'bot');   // al abrir la página con los agentes esperando tu respuesta, el botón lo dice
        if (ub && ESPERAS[ub.estado] && !st.esperando) { flow.fin = { orden: st.orden || '', espera: ESPERAS[ub.estado], errores: 0, pdfs: 0, montajes: 0, hora: '' }; pintarProg(); }
      }
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
    if (!panel) return;
    const activo = panel.classList.contains('active'), pendiente = st.esperando && st.avisos;   // con un trabajo en marcha se sigue consultando aunque mires otra cosa, para poder avisarte
    if (!activo && !pendiente) return;
    timer = setTimeout(async () => { if (!document.hidden || pendiente) await cargar(false); leido(); programar(); }, document.hidden || !activo ? 5000 : st.esperando ? 1000 : 4000);
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
        if (st.msgs.length && !confirm('¿Empezar una conversación nueva? Los agentes empiezan de cero y esta queda guardada en el historial (🕘).')) return;
        try { await api('/api/agentes/limpiar', { method: 'POST', body: JSON.stringify({ pc: st.pc }) }); } catch (err) { alert(err.message); return; }
        st.msgs = []; st.ultimo = 0; st.evs = []; st.ultimoEv = 0; st.trabajo = null; flow.listo = false; flow.preparado = 0; await cargar(true); pintar();
      } else if (e.target.closest('[data-avisos]')) cambiarAvisos();
      else if (e.target.closest('[data-historial]')) abrirHistorial();
      else if (e.target.closest('[data-conectar]')) conectar();
    });
    try { ponerVista(localStorage.getItem('indoor-agentes-vista') || 'chats'); } catch (er) { /* sin almacenamiento */ }
    // delegado en el panel (en captura): cuando se registra esto el chat todavía no está armado; antes se buscaba el hilo aquí, fallaba y dejaba sin registrar todo lo de abajo (Enter, Enviar, copiar…)
    panel.addEventListener('scroll', e => { if (!e.target.matches || !e.target.matches('[data-hilo]')) return; const h = e.target, b = panel.querySelector('[data-bajar]'); if (b && !b.hidden && h.scrollHeight - h.scrollTop - h.clientHeight < 40) b.hidden = true; }, { passive: true, capture: true });
    window.addEventListener('resize', ajustarAlto);
    window.addEventListener('focus', () => setTimeout(enfocarVista, 50));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(enfocarVista, 50); });
    document.addEventListener('keydown', e => {   // ← → pasan de una muestra (CHATS) o de un PDF (PDFS) a otro, si no estás escribiendo; en PDFS también ↑ ↓
      if (!panel.classList.contains('active') || !/^Arrow(Left|Right|Up|Down)$/.test(e.key) || e.altKey || e.ctrlKey || e.metaKey || /^(TEXTAREA|INPUT|SELECT)$/.test((e.target.tagName || '')) || (e.target.isContentEditable)) return;
      const vista = panel.querySelector('[data-main]').dataset.vista;
      if (vista === 'pdfs') { e.preventDefault(); irPdf(/^Arrow(Right|Down)$/.test(e.key) ? 1 : -1); return; }
      if (!/^Arrow(Left|Right)$/.test(e.key)) return;
      if (vista !== 'chats') return;
      st.muIdx = (st.muIdx || 0) + (e.key === 'ArrowRight' ? 1 : -1); pintarMuestras();
    });
    if (window.ResizeObserver) { const ro2 = new ResizeObserver(ajustarAlto); ['.ag-hd', '.ag-res', '.ag-vtabs'].forEach(q => { const el = panel.querySelector(q); if (el) ro2.observe(el); }); }
    setInterval(ajustarAlto, 1500);
    panel.addEventListener('click', e => {
      const nas = e.target.closest('[data-nas-orden]');
      if (nas) { e.preventDefault(); abrirNas(st.orden); return; }
      const vt = e.target.closest('[data-vt]');
      if (vt) { ponerVista(vt.dataset.vt); return; }
      const mi = e.target.closest('[data-mu-i]');
      if (mi) { st.muIdx = Number(mi.dataset.muI); pintarMuestras(); return; }
      const mg = e.target.closest('[data-mu-go]');
      if (mg && !mg.disabled) { st.muIdx = (st.muIdx || 0) + Number(mg.dataset.muGo); pintarMuestras(); return; }
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
    panel.addEventListener('click', e => {
      const cop = e.target.closest('[data-copiar]');
      if (cop) { const m = st.msgs.find(x => String(x.id) === cop.dataset.copiar); if (m && navigator.clipboard) navigator.clipboard.writeText(m.texto).then(() => { cop.textContent = '✓ Copiado'; setTimeout(() => { cop.textContent = '⧉ Copiar'; }, 1400); }).catch(() => {}); return; }
      const fd = e.target.closest('[data-f-derecha]'); if (fd) { const k = muestrasActuales().findIndex(x => x.id === fd.dataset.fDerecha); if (k >= 0) { st.muIdx = k; pintarMuestras(); } return; }
      if (e.target.closest('[data-mu-todo]')) { st.muTodo = !st.muTodo; pintarMuestras(); return; }
      if (e.target.closest('[data-bajar]')) { const h = panel.querySelector('[data-hilo]'); h.scrollTop = h.scrollHeight; e.target.closest('[data-bajar]').hidden = true; return; }
      const mas = panel.querySelector('.ag-mas[open]');
      if (mas && (!e.target.closest('.ag-mas') || e.target.closest('.ag-mas-menu button'))) mas.removeAttribute('open');
    });
    panel.addEventListener('submit', e => { e.preventDefault(); if (e.target.matches('[data-orden-form]')) { fijarOrden(e.target.querySelector('input').value); return; } const caja = panel.querySelector('textarea'); const v = caja.value; caja.value = ''; caja.style.height = 'auto'; sug.rec = -1; sug.i = -1; pintarSug(); enviar(v); });
    panel.addEventListener('keydown', e => { if (!e.target.matches('[data-form] textarea')) return; if (teclaChat(e)) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); panel.querySelector('[data-form]').requestSubmit(); } });
    panel.addEventListener('focusout', e => { if (e.target.matches('[data-form] textarea')) setTimeout(pintarSug, 160); });
    panel.addEventListener('focusin', e => { if (e.target.matches('[data-form] textarea')) pintarSug(); });
    panel.addEventListener('mousedown', e => { const b = e.target.closest('[data-sug-i]'); if (b) { e.preventDefault(); usarSug(+b.dataset.sugI); } });
    panel.addEventListener('input', e => { if (e.target.matches('textarea')) { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; sug.rec = -1; sug.i = -1; pintarSug(); } });
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
