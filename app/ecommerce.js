/* ECOMMERCE: panel de las órdenes de venta de Effi (ALMA descarga, BRISA exporta las tallas, CIRO genera los PDF y llena Google Sheets).
   Vista «FLUJO» en vivo (nodos que respiran, cuenta regresiva de la próxima revisión de Effi, paquetes que viajan por la cola y
   actividad que va apareciendo), «ÓRDENES» con su recorrido, «AGENTES» con sus botones y «REGISTRO».
   Solo Administración / Coordinación (el servidor responde 403 al resto y entonces no se crea nada).
   Se abre desde el menú de usuario, justo debajo de «Agentes». Reutiliza los estilos de AGENTES. */
(function () {
  if (window.__ecommercePanel) return;
  window.__ecommercePanel = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = {
    agentes: [], pc: null, cola: {}, ordenes: [], trabajos: [], historial: [], hoy: {}, latidos: {}, log: [], ultimo: 0, filtro: '', token: null, abierto: {}, ocupado: false,
    aviso: '', vista: 'flujo', filtroOrd: 'todas', busqueda: '', orden: null, drawer: null, proxima: null, intervalo: 60, revisando: 0, feedId: 0
  };
  let panel = null, tab = null, timer = 0, reloj = 0;

  const ETIQUETA = { INACTIVO: 'Detenido', CORRIENDO: 'Vigilando', EN_FILA: 'Esperando Illustrator', ERROR: 'Con error' };
  const COLOMBIA = { timeZone: 'America/Bogota' };
  const hora = t => new Date(t * 1000).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const horaIso = iso => iso ? new Date(iso).toLocaleTimeString('es-CO', { ...COLOMBIA, hour: '2-digit', minute: '2-digit' }) : '';
  const vivo = a => a && (a.estado === 'CORRIENDO' || a.estado === 'EN_FILA');
  const agente = id => st.agentes.find(a => a.id === id) || {};
  const dur = s => s == null ? '—' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  const hace = seg => seg < 5 ? 'ahora' : seg < 60 ? 'hace ' + Math.round(seg) + ' s' : seg < 3600 ? 'hace ' + Math.round(seg / 60) + ' min' : 'hace ' + Math.round(seg / 3600) + ' h';

  function clonarEstilosAgentes() {
    document.querySelectorAll('style').forEach(s => {
      const t = s.textContent || '';
      if (s.dataset.ecClon || t.indexOf("[data-panel='agentes']") < 0) return;
      const c = document.createElement('style'); c.dataset.ecClon = '1';
      c.textContent = t.split("[data-panel='agentes']").join("[data-panel='ecommerce']");
      document.head.appendChild(c);
    });
  }
  const css = document.createElement('style');
  css.textContent = `
  .ec-vtabs{display:flex!important}
  .ec-body{display:grid;gap:14px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:6px 16px 16px 16px;background:linear-gradient(160deg,#0d120e,#0a0e08)}
  .ec-conn{padding:14px 16px;border:1px solid #d0f44c;border-radius:12px;background:rgba(208,244,76,.06);font-size:.85rem;line-height:1.6}
  .ec-conn code{display:block;margin:8px 0;padding:9px 11px;border-radius:8px;background:#0b0f09;color:#d0f44c;font:12px Consolas,monospace;overflow-wrap:anywhere;user-select:all}
  .ec-aviso{padding:10px 14px;border-radius:11px;background:#5a2a12;color:#ffd9b0;font-size:.85rem}
  /* ---- flujo en vivo ---- */
  .ec-hero{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:0;padding:22px 18px 18px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:radial-gradient(120% 140% at 50% -20%,rgba(208,244,76,.09),transparent 55%),linear-gradient(160deg,#101810,#0b100a);overflow:hidden}
  .ec-hero::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px);background-size:22px 22px;mask-image:linear-gradient(180deg,#000,transparent 85%);pointer-events:none}
  .ec-nodo{position:relative;z-index:1;flex:0 0 150px;display:grid;justify-items:center;gap:6px;text-align:center;cursor:pointer;padding:6px;border-radius:14px;transition:transform .15s,background .2s;background:none;border:0;color:inherit;font:inherit}
  .ec-nodo:hover{transform:translateY(-3px);background:rgba(255,255,255,.04)}.ec-nodo:focus-visible{outline:2px solid var(--c);outline-offset:2px}
  .ec-disco{position:relative;width:96px;height:96px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c) calc(var(--p,0)*1%),rgba(255,255,255,.1) 0)}
  .ec-disco::before{content:"";position:absolute;inset:6px;border-radius:50%;background:radial-gradient(circle at 35% 28%,#1f2a1d,#0d120c)}
  .ec-disco .ec-barrido{position:absolute;inset:6px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 78%,color-mix(in srgb,var(--c) 55%,transparent) 100%);opacity:0;animation:ecGira 2.6s linear infinite}
  .ec-nodo.vigila .ec-barrido{opacity:1}.ec-nodo.trabaja .ec-barrido{opacity:1;animation-duration:.9s}
  .ec-disco b{position:relative;font:900 1.7rem Arial;color:var(--c)}.ec-disco small{position:relative;display:block;font:800 .62rem Arial;letter-spacing:.06em;color:#aeb9a6;margin-top:-4px}
  .ec-disco .ec-centro{position:relative;display:grid;justify-items:center;line-height:1.05}
  .ec-nodo.trabaja .ec-disco{animation:ecLate 1.4s ease-in-out infinite}.ec-nodo.error .ec-disco{--c:#ff6b6b}.ec-nodo.parado .ec-disco{filter:grayscale(1) brightness(.7)}
  @keyframes ecGira{to{transform:rotate(360deg)}}@keyframes ecLate{50%{box-shadow:0 0 0 10px color-mix(in srgb,var(--c) 18%,transparent)}}
  .ec-nodo h4{margin:2px 0 0;font-size:1rem;letter-spacing:.1em;color:var(--c)}.ec-nodo .ec-sub{font-size:.72rem;color:#c4cfbf;line-height:1.25;min-height:2.5em}
  .ec-nodo .ec-act{font:11px Consolas,monospace;color:#8f9d88;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ec-estado{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:.68rem;font-weight:800;border:1px solid color-mix(in srgb,var(--e) 55%,transparent);background:color-mix(in srgb,var(--e) 14%,transparent)}
  .ec-estado i{width:7px;height:7px;border-radius:50%;background:var(--e)}
  .ec-enlace{position:relative;z-index:1;flex:1 1 60px;align-self:flex-start;margin-top:46px;height:6px;border-radius:99px;background:rgba(255,255,255,.08);min-width:50px}
  .ec-enlace.activo{background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--c) 70%,transparent) 0 10px,transparent 10px 20px);background-size:20px 6px;animation:ecFluye .7s linear infinite}
  @keyframes ecFluye{to{background-position:20px 0}}
  .ec-cola{position:absolute;left:50%;top:-30px;transform:translateX(-50%);min-width:32px;padding:3px 9px;border-radius:99px;font:900 .8rem Arial;text-align:center;background:#161d13;border:1px solid var(--c);color:var(--c);cursor:pointer;white-space:nowrap}
  .ec-cola:hover{background:var(--c);color:#10170c}.ec-cola.cero{opacity:.45}
  .ec-paquete{position:absolute;top:-4px;width:14px;height:14px;border-radius:4px;background:var(--c);box-shadow:0 0 12px var(--c);animation:ecViaja 2.2s linear infinite}
  @keyframes ecViaja{from{left:-4%;opacity:0;transform:scale(.6)}15%{opacity:1;transform:scale(1)}85%{opacity:1}to{left:100%;opacity:0;transform:scale(.6)}}
  .ec-extremo{position:relative;z-index:1;flex:0 0 78px;display:grid;justify-items:center;gap:6px;color:#8f9d88;font:800 .66rem Arial;letter-spacing:.08em;margin-top:18px}
  .ec-extremo svg{width:52px;height:52px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;padding:12px;border-radius:16px;border:1px dashed rgba(255,255,255,.2);background:rgba(255,255,255,.03)}
  .ec-extremo.sale svg{color:#8bd450;border-color:rgba(139,212,80,.4)}
  /* ---- tarjetas de cifras ---- */
  .ec-cifras{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px}
  .ec-cifra{position:relative;overflow:hidden;padding:14px 16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.04);cursor:pointer;text-align:left;color:inherit;font:inherit;min-height:92px;transition:transform .15s}
  .ec-cifra:hover{transform:translateY(-2px)}.ec-cifra small{display:block;color:#aeb9a6;font-size:.68rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;position:relative;z-index:2}
  .ec-cifra b{display:block;font-size:1.9rem;margin-top:4px;position:relative;z-index:2}.ec-cifra em{display:block;font-style:normal;font-size:.7rem;color:#c4cfbf;margin-top:2px;position:relative;z-index:2}
  .ec-cifra .ec-go{margin-top:6px;padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.25);color:#fff;font:800 .68rem Arial;cursor:pointer;position:relative;z-index:2}
  /* ---- actividad ---- */
  .ec-act-caja{border:1px solid #34432f;border-radius:14px;background:#0a0e08;overflow:hidden}
  .ec-act-cab{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:.74rem;font-weight:800;letter-spacing:.08em;color:#aeb9a6}
  .ec-act-cab i{width:8px;height:8px;border-radius:50%;background:#8bd450;animation:ecLate2 1.6s infinite}@keyframes ecLate2{50%{box-shadow:0 0 0 6px rgba(139,212,80,0)}0%{box-shadow:0 0 0 0 rgba(139,212,80,.6)}}
  .ec-feed{display:grid;max-height:300px;overflow:auto}.ec-ev{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:start;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.05);font-size:.8rem;animation:ecEntra .35s both}
  @keyframes ecEntra{from{opacity:0;transform:translateY(-10px);background:rgba(208,244,76,.12)}to{opacity:1;transform:none}}
  .ec-ev .ic{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:.72rem;font-weight:900;background:color-mix(in srgb,var(--c) 22%,transparent);color:var(--c)}
  .ec-ev .tx{overflow-wrap:anywhere;color:#d9e2d3}.ec-ev .tx b{color:var(--c)}.ec-ev.error .tx{color:#ff9c99}.ec-ev time{color:#6f7d69;font-size:.7rem;white-space:nowrap}
  .ec-vacio{padding:30px;text-align:center;color:#8f9d88}
  /* ---- órdenes ---- */
  .ec-barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ec-chips{display:flex;flex-wrap:wrap;gap:6px}
  .ec-chips button{padding:5px 14px;border:1px solid #60754d;border-radius:999px;background:transparent;color:#d0f44c;font:800 12px Arial;cursor:pointer}.ec-chips button.on{background:#d0f44c;border-color:#d0f44c;color:#10170c}
  .ec-barra input{flex:1 1 180px;min-width:140px;padding:7px 12px;border-radius:10px;border:1px solid #34432f;background:#0b0f09;color:#eef3ea;font:13px Arial}
  .ec-ords{display:grid;gap:8px}.ec-ord{border:1px solid #34432f;border-left:4px solid var(--c,#8bd450);border-radius:12px;background:#0c110d;overflow:hidden}
  .ec-ord.aviso{--c:#ff6b6b}.ec-ord.hecha{--c:#8bd450}.ec-ord>button{width:100%;display:grid;grid-template-columns:minmax(120px,1fr) minmax(190px,1.4fr) auto;gap:12px;align-items:center;padding:11px 14px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
  .ec-ord strong{font-size:.95rem}.ec-ord small{display:block;color:#8f9d88;font-size:.72rem;margin-top:2px}
  .ec-pasos{display:flex;align-items:center;gap:0}.ec-p{position:relative;flex:1;display:grid;justify-items:center;gap:3px;font-size:.62rem;font-weight:800;letter-spacing:.05em;color:#6f7d69}
  .ec-p i{width:16px;height:16px;border-radius:50%;border:2px solid #3c4a38;background:#0c110d;display:grid;place-items:center;font-size:.55rem;font-style:normal;color:#0c110d;z-index:1}
  .ec-p::before{content:"";position:absolute;top:7px;left:-50%;width:100%;height:2px;background:#2c3829}.ec-p:first-child::before{display:none}
  .ec-p.ok i{background:#8bd450;border-color:#8bd450}.ec-p.ok::before{background:#8bd450}.ec-p.ok{color:#aeb9a6}
  .ec-p.ahora i{border-color:#d0f44c;box-shadow:0 0 0 4px rgba(208,244,76,.2);animation:ecLate2 1.6s infinite}.ec-p.ahora{color:#d0f44c}.ec-p.mal i{background:#ff6b6b;border-color:#ff6b6b}.ec-p.mal{color:#ff9c99}
  .ec-tiempo{font-size:.72rem;color:#8f9d88;text-align:right;white-space:nowrap}
  .ec-det{padding:2px 14px 14px;display:none;gap:12px}.ec-ord.abierta .ec-det{display:grid}
  .ec-tabla{width:100%;border-collapse:collapse;font-size:.76rem}.ec-tabla th{color:#8f9d88;font-weight:800;text-align:left;padding:4px 8px;border-bottom:1px solid #2c3829}.ec-tabla td{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.05)}
  .ec-linea{display:grid;gap:4px;font-size:.76rem;color:#c4cfbf}.ec-linea div{display:grid;grid-template-columns:auto 1fr;gap:8px}.ec-linea time{color:#6f7d69}
  .ec-avisos{padding:8px 12px;border-radius:9px;background:#3a1a16;color:#ffb4ae;font-size:.78rem}
  /* ---- agentes y registro ---- */
  .ec-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:14px}
  .ec-card{display:grid;gap:10px;padding:16px;border:1px solid #34432f;border-top:4px solid var(--c);border-radius:14px;background:linear-gradient(160deg,#111a12,#0c110d)}
  .ec-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.ec-top h3{margin:0;font-size:1.2rem;letter-spacing:.1em;color:var(--c)}.ec-top small{display:block;color:#c4cfbf;font-size:.8rem;margin-top:2px}
  .ec-ult{min-height:2.4em;color:#aeb9a6;font:12px Consolas,monospace;overflow-wrap:anywhere}.ec-desde{color:#8f9d88;font-size:.72rem;min-height:1em}
  .ec-btns{display:flex;gap:8px;flex-wrap:wrap}.ec-btns .ag-btn{flex:1 1 90px}
  .ec-card details summary,.ec-drawer details summary{cursor:pointer;color:#aeb9a6;font-size:.75rem;font-weight:800;letter-spacing:.08em}.ec-card ul,.ec-drawer ul{margin:8px 0 0;padding-left:18px;color:#c4cfbf;font-size:.8rem;line-height:1.5}
  .ec-sub2{color:#8f9d88;font-size:.72rem;font-weight:800;letter-spacing:.1em;margin:2px 0 6px}
  .ec-ordenes-pc{display:grid;gap:6px}.ec-opc{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border:1px solid #34432f;border-radius:10px;background:#0c110d;font-size:.8rem;color:#c4cfbf}
  .ec-opc b{color:#eef4e9}.ec-opc.error,.ec-opc.vencida{color:#ffb4ae;border-color:#6a2e2a}.ec-opc.hecha{color:#b8e68a}
  .ec-log{max-height:420px;overflow:auto;padding:10px 12px;border:1px solid #34432f;border-radius:12px;background:#080b07;font:12px/1.6 Consolas,monospace}.ec-l{display:flex;gap:10px}.ec-l time{color:#6f7d69;flex:none}.ec-l b{flex:none;min-width:52px}.ec-l span{overflow-wrap:anywhere}.ec-l.error span{color:#ff9c99}.ec-l.info span{color:#aeb9a6}
  /* ---- cajón del agente ---- */
  .ec-velo{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.5);display:none}.ec-velo.on{display:block}
  .ec-drawer{position:fixed;top:0;right:0;bottom:0;z-index:91;width:min(440px,100vw);background:linear-gradient(180deg,#131a10,#0b100a);border-left:1px solid rgba(255,255,255,.14);padding:18px;display:none;overflow:auto;gap:12px;align-content:start;box-shadow:-20px 0 40px -10px #000c}
  .ec-drawer.on{display:grid;animation:ecDesliza .22s cubic-bezier(.2,.8,.2,1)}@keyframes ecDesliza{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
  .ec-drawer h3{margin:0;font-size:1.4rem;letter-spacing:.12em;color:var(--c)}.ec-drawer .cerrar{position:absolute;top:12px;right:12px}
  .ec-mini{max-height:240px;overflow:auto;padding:8px 10px;border-radius:10px;background:#080b07;font:11.5px/1.55 Consolas,monospace;color:#aeb9a6}.ec-mini div{overflow-wrap:anywhere}.ec-mini .e{color:#ff9c99}
  @media(max-width:1000px){.ec .ag-vtabs{display:flex!important}.ec-body{padding:10px}}
  @media(max-width:820px){.ec-hero{flex-direction:column;align-items:center;padding:18px 10px}.ec-nodo{flex:none}.ec-enlace{width:6px;height:70px;margin:18px 0 12px;flex:none;min-width:0;align-self:center;background-size:6px 20px}
    .ec-enlace.activo{background:repeating-linear-gradient(180deg,color-mix(in srgb,var(--c) 70%,transparent) 0 10px,transparent 10px 20px);background-size:6px 20px;animation:ecFluyeV .7s linear infinite}
    @keyframes ecFluyeV{to{background-position:0 20px}}.ec-cola{left:22px;top:50%;transform:translateY(-50%)}
    .ec-paquete{left:-4px!important;animation:ecViajaV 2.2s linear infinite}@keyframes ecViajaV{from{top:-4%;opacity:0}15%{opacity:1}85%{opacity:1}to{top:100%;opacity:0}}
    .ec-extremo{margin-top:6px}.ec-ord>button{grid-template-columns:1fr}.ec-tiempo{text-align:left}}
  @media(max-width:620px){.ec-l{flex-wrap:wrap;gap:2px 8px}.ec-vtabs .ag-vt{padding:8px 12px!important;flex:1}}
  @media(prefers-reduced-motion:reduce){.ec-barrido,.ec-enlace.activo,.ec-paquete,.ec-nodo.trabaja .ec-disco,.ec-act-cab i,.ec-ev,.ec-p.ahora i{animation:none!important}}`;
  document.head.appendChild(css);

  async function api(url, opciones) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(opciones || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }
  const pill = (a) => 'ag-pill ' + (a.estado === 'ERROR' ? 'mal' : a.estado === 'EN_FILA' ? 'sim' : vivo(a) ? 'ok' : '');

  // ====================================================== encabezado
  function encabezado() {
    const pc = st.pc || {}, ok = !!pc.conectado;
    const pcTxt = ok ? 'PC conectado' + (pc.equipo ? ' · ' + pc.equipo : '') + (pc.simulado ? ' · prueba' : '') : (pc.hay_token ? 'PC desconectado' : 'Sin PC enlazado');
    const pills = '<span class="ag-pill ' + (ok ? 'ok' : 'mal') + '"><i></i>' + esc(pcTxt) + '</span>' +
      st.agentes.map(a => '<span class="' + pill(a) + '"><i></i>' + esc(a.nombre) + ' ' + esc(vivo(a) || a.estado === 'ERROR' ? ETIQUETA[a.estado] : 'libre') + '</span>').join('');
    const indiv = st.agentes.map(a => '<button type="button" class="ag-agbtn" style="--c:' + a.color + '" data-alterna="' + a.id + '" title="' + esc(a.nombre + ': ' + a.titulo) + '"' + (!ok || a.pendiente ? ' disabled' : '') + '><i></i>' + esc(a.nombre) + '<small>' + (vivo(a) ? '■ detener' : '▶ iniciar') + '</small></button>').join('');
    const hayVivos = st.agentes.some(vivo);
    return '<header class="ag-hd"><h2>ECOMMERCE</h2><div class="ag-state">' + pills + '</div><div class="ag-indiv">' + indiv + '</div>' +
      '<div class="ag-hacc"><button type="button" class="ag-btn danger ag-stop' + (hayVivos ? '' : ' inactivo') + '" data-detener-todo' + (!ok || !hayVivos ? ' disabled' : '') + '>⏹ Detener</button>' +
      '<button type="button" class="ag-btn ag-reiniciar" data-reiniciar-todo' + (!ok || !hayVivos ? ' disabled' : '') + '>↻ Reiniciar</button>' +
      '<details class="ag-menu"><summary class="ag-ico" title="Más opciones">⋯</summary><div class="ag-menu-l"><button type="button" class="solo-movil" data-reiniciar-todo>↻ Reiniciar los que están corriendo</button><button type="button" class="solo-movil" data-detener-todo>⏹ Detener los que están corriendo</button><button type="button" data-conectar>PC de los bots… (código de enlace)</button></div></details></div></header>';
  }
  function conexion() {
    if (!st.token) return '';
    return '<div class="ec-conn"><b>Código de enlace (se muestra una sola vez)</b><code>' + esc(st.token.url) + '</code><code>' + esc(st.token.token) + '</code>' +
      'En el PC de los agentes: si es nuevo, abre <b>INSTALAR_AGENTES_EDICION.vbs</b> (carpeta AGENTES_INDOOR de la NAS) y pega este código cuando lo pida. Si ya tiene los agentes, abre <b>ecommerce\\ENLAZAR_ECOMMERCE.bat</b> y pega la dirección y el código; luego <b>detener_agentes.bat</b> y <b>iniciar_oculto.vbs</b>. Ese mismo archivo inicia los agentes de edición y a ALMA, BRISA y CIRO. El panel atiende un solo PC.</div>';
  }

  // ====================================================== FLUJO (esqueleto fijo: solo se actualizan sus partes, para que las animaciones no se reinicien)
  const ICONO_EFFI = '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1 .5 7.97"/><path d="M12 12v8m0 0l-3-3m3 3l3-3"/></svg>';
  const ICONO_SALE = '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
  function esqueletoFlujo() {
    const nodo = (id) => '<button type="button" class="ec-nodo" data-nodo="' + id + '"><div class="ec-disco"><span class="ec-barrido"></span><div class="ec-centro"><b data-ini></b><small data-peq></small></div></div>' +
      '<h4 data-nom></h4><div class="ec-sub" data-sub></div><span class="ec-estado" data-est><i></i><span></span></span><div class="ec-act" data-act></div></button>';
    const enlace = (id, color) => '<div class="ec-enlace" data-enlace="' + id + '" style="--c:' + color + '"><button type="button" class="ec-cola" data-cola="' + id + '" title="Órdenes esperando en este paso">0</button><span data-paquetes></span></div>';
    return '<div class="ec-hero" data-hero><div class="ec-extremo"><div>' + ICONO_EFFI + '</div>EFFI</div>' + enlace('effi', '#8bd450').replace('<button type="button" class="ec-cola" data-cola="effi" title="Órdenes esperando en este paso">0</button>', '') +
      nodo('alma') + enlace('descargadas', '#6cb6ff') + nodo('brisa') + enlace('tallas', '#ffb04a') + nodo('ciro') + enlace('salida', '#8bd450').replace('<button type="button" class="ec-cola" data-cola="salida" title="Órdenes esperando en este paso">0</button>', '') +
      '<div class="ec-extremo sale"><div>' + ICONO_SALE + '</div>PDF · SHEETS</div></div>' +
      '<div class="ec-cifras" data-cifras></div>' +
      '<div class="ec-act-caja"><div class="ec-act-cab"><i></i>ACTIVIDAD EN VIVO<span style="margin-left:auto;font-weight:600;letter-spacing:0;color:#6f7d69" data-feed-n></span></div><div class="ec-feed" data-feed><div class="ec-vacio">Todavía no hay actividad registrada.</div></div></div>';
  }
  function actualizarFlujo(raiz) {
    const hero = raiz.querySelector('[data-hero]');
    if (!hero) return;
    const ok = !!(st.pc && st.pc.conectado);
    st.agentes.forEach(a => {
      const n = hero.querySelector('[data-nodo="' + a.id + '"]'); if (!n) return;
      const lat = st.latidos[a.id] || {}, trabajando = vivo(a) && lat.actividad && !/^(Vigilando|Esperando|Orden descargada)/.test(lat.actividad) && (lat.hace_seg == null || lat.hace_seg < 90);
      n.style.setProperty('--c', a.color);
      n.className = 'ec-nodo' + (a.estado === 'ERROR' ? ' error' : !vivo(a) ? ' parado' : trabajando ? ' trabaja' : ' vigila');
      n.querySelector('[data-nom]').textContent = a.nombre;
      n.querySelector('[data-sub]').textContent = 'Paso ' + a.paso + ' · ' + a.titulo;
      const e = n.querySelector('[data-est]'); e.style.setProperty('--e', a.estado === 'ERROR' ? '#ff6b6b' : a.estado === 'EN_FILA' ? '#ffb04a' : vivo(a) ? '#8bd450' : '#7d8a76');
      e.querySelector('span').textContent = a.pendiente ? ({ iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…', revisar: 'Revisando…' }[a.pendiente] || '…') : (trabajando ? lat.actividad.split(' ').slice(0, 2).join(' ') : ETIQUETA[a.estado]);
      n.querySelector('[data-act]').textContent = lat.actividad || a.ultima || (ok ? 'Sin actividad todavía' : 'PC sin conexión');
      n.querySelector('[data-act]').title = lat.actividad || a.ultima || '';
      const ini = n.querySelector('[data-ini]'), peq = n.querySelector('[data-peq]');
      if (a.id === 'alma') {   // ALMA: cuenta regresiva hasta su próxima vuelta por Effi
        if (st.proxima && vivo(a)) { /* lo mueve el reloj cada segundo */ } else { ini.textContent = a.nombre[0]; peq.textContent = vivo(a) ? 'revisando' : ''; n.querySelector('.ec-disco').style.setProperty('--p', 0); }
      } else {
        const espera = a.id === 'brisa' ? (st.cola.descargadas || 0) : (st.cola.tallas || 0);
        ini.textContent = espera ? espera : a.nombre[0]; peq.textContent = espera ? 'en espera' : (vivo(a) ? 'escuchando' : '');
        n.querySelector('.ec-disco').style.setProperty('--p', trabajando ? 100 : espera ? 100 : 0);
      }
    });
    // enlaces con su cola y los paquetes que viajan
    const enlaces = { effi: [vivo(agente('alma')), 0], descargadas: [(st.cola.descargadas || 0) > 0 || (vivo(agente('brisa')) && /Exportando|Leyendo/.test((st.latidos.brisa || {}).actividad || '')), st.cola.descargadas || 0],
      tallas: [(st.cola.tallas || 0) > 0 || (vivo(agente('ciro')) && /Generando|Llenando/.test((st.latidos.ciro || {}).actividad || '')), st.cola.tallas || 0], salida: [(st.cola.terminadas || 0) > 0 && false, 0] };
    Object.entries(enlaces).forEach(([id, [activo, cola]]) => {
      const el = hero.querySelector('[data-enlace="' + id + '"]'); if (!el) return;
      el.classList.toggle('activo', !!activo);
      const b = el.querySelector('[data-cola]'); if (b) { b.textContent = cola; b.classList.toggle('cero', !cola); b.title = cola + ' orden(es) esperando'; }
      const p = el.querySelector('[data-paquetes]'), n = Math.min(cola, 4);
      if (p.childElementCount !== n) p.innerHTML = Array.from({ length: n }, (_, i) => '<span class="ec-paquete" style="animation-delay:' + (i * 0.55) + 's"></span>').join('');
    });
    // cifras
    const h = st.hoy || {}, cola = (st.cola.descargadas || 0) + (st.cola.tallas || 0);
    const cif = raiz.querySelector('[data-cifras]');
    const firma = [h.terminadas, h.avisos, h.promedio_seg, cola, ok, vivo(agente('alma'))].join('|');
    if (cif.dataset.firma !== firma) {
      cif.dataset.firma = firma;
      cif.innerHTML =
        '<button type="button" class="ec-cifra" data-ir="terminadas" data-lq="' + Math.min(100, (h.terminadas || 0) * 12) + '" data-lq-tone="verde" data-lq-nopct><small>Terminadas hoy</small><b>' + (h.terminadas || 0) + '</b><em>órdenes completas</em></button>' +
        '<button type="button" class="ec-cifra" data-ir="cola" data-lq="' + Math.min(100, cola * 25) + '" data-lq-tone="azul" data-lq-nopct><small>En proceso</small><b>' + cola + '</b><em>' + (cola ? 'pasando por la cola' : 'nada esperando') + '</em></button>' +
        '<button type="button" class="ec-cifra" data-ir="errores" data-lq="' + Math.min(100, (h.avisos || 0) * 40) + '" data-lq-tone="' + (h.avisos ? 'rojo' : 'gris') + '" data-lq-nopct><small>Con avisos hoy</small><b>' + (h.avisos || 0) + '</b><em>' + (h.avisos ? 'toca revisarlas' : 'sin problemas') + '</em></button>' +
        '<div class="ec-cifra" data-lq="' + (h.promedio_seg ? Math.max(8, Math.min(100, 100 - h.promedio_seg / 12)) : 6) + '" data-lq-tone="ambar" data-lq-nopct style="cursor:default"><small>Tiempo por orden</small><b>' + dur(h.promedio_seg) + '</b><em>promedio de hoy</em></div>' +
        '<div class="ec-cifra" data-lq="50" data-lq-tone="teal" data-lq-nopct style="cursor:default"><small>Próxima revisión de Effi</small><b data-cuenta>—</b>' +
        '<button type="button" class="ec-go" data-revisar' + (ok && vivo(agente('alma')) ? '' : ' disabled') + '>⟳ Revisar ahora</button></div>';
    }
    tickReloj();
  }
  function textoEvento(l) {
    const a = agente(l.agente), t = String(l.texto || '');
    let icono = '•', clase = l.nivel === 'error' ? 'error' : '';
    if (/terminada|exportada y registrada|✔/.test(t)) icono = '✔';
    else if (/descargad|Descargando|Nueva orden/i.test(t)) icono = '↓';
    else if (/tallas|Maestro|Exportando|Mesa/i.test(t)) icono = '▦';
    else if (/PDF|listado|Sheets/i.test(t)) icono = '⎙';
    else if (/Error|error|avisos/.test(t) || l.nivel === 'error') { icono = '!'; clase = 'error'; }
    else if (/No hay órdenes|Vigilando/i.test(t)) icono = '◌';
    return { icono, clase };
  }
  function actualizarFeed(raiz) {
    const feed = raiz.querySelector('[data-feed]'); if (!feed) return;
    const nuevas = st.log.filter(l => l.id > st.feedId && !/Esperando a Illustrator/.test(l.texto || '') || (l.id > st.feedId && l.nivel === 'error'));
    if (!nuevas.length && feed.childElementCount) return;
    if (feed.querySelector('.ec-vacio')) feed.innerHTML = '';
    nuevas.forEach(l => {
      const a = agente(l.agente), { icono, clase } = textoEvento(l);
      const div = document.createElement('div');
      div.className = 'ec-ev ' + clase; div.dataset.at = l.at; div.style.setProperty('--c', a.color || '#aeb9a6');
      div.innerHTML = '<span class="ic">' + icono + '</span><span class="tx"><b>' + esc(a.nombre || l.agente) + '</b> · ' + esc(l.texto) + '</span><time>' + hace(Date.now() / 1000 - l.at) + '</time>';
      feed.prepend(div);
    });
    st.feedId = Math.max(st.feedId, ...st.log.map(l => l.id));
    while (feed.childElementCount > 40) feed.lastElementChild.remove();
    if (!feed.childElementCount) feed.innerHTML = '<div class="ec-vacio">Todavía no hay actividad registrada.</div>';
    const n = raiz.querySelector('[data-feed-n]'); if (n) n.textContent = feed.querySelector('.ec-ev') ? 'últimos ' + feed.childElementCount + ' eventos' : '';
  }
  // reloj de 1 s: cuenta regresiva de ALMA y «hace X» del feed (sin redibujar nada)
  function tickReloj() {
    const flujo = panel && panel.querySelector('[data-vista-flujo]');
    if (!flujo || st.vista !== 'flujo') return;
    const cuenta = flujo.querySelector('[data-cuenta]'), n = flujo.querySelector('[data-nodo="alma"]');
    const a = agente('alma');
    if (n && cuenta) {
      const escucha = /aviso de Effi/i.test(((st.latidos || {}).alma || {}).actividad || '');
      if (!vivo(a) || !st.proxima || escucha) { cuenta.textContent = vivo(a) ? (escucha ? 'esperando a Effi' : 'revisando…') : 'detenida'; }
      else {
        const restan = Math.max(0, Math.ceil((st.proxima - Date.now()) / 1000));
        cuenta.textContent = restan > 0 ? restan + ' s' : 'revisando…';
        const p = Math.max(0, Math.min(100, 100 - restan / Math.max(1, st.intervalo) * 100));
        const disco = n.querySelector('.ec-disco'); disco.style.setProperty('--p', p.toFixed(1));
        n.querySelector('[data-ini]').textContent = restan > 0 ? restan : '⟳';
        n.querySelector('[data-peq]').textContent = restan > 0 ? 'segundos' : 'revisando';
      }
    }
    flujo.querySelectorAll('.ec-ev time').forEach(t => { const d = t.closest('.ec-ev'); t.textContent = hace(Date.now() / 1000 - Number(d.dataset.at)); });
  }

  // ====================================================== ÓRDENES
  const ETAPAS = [['descargadas', 'ALMA'], ['tallas', 'BRISA'], ['pdfs', 'CIRO'], ['hecha', '✔']];
  function pasosHtml(o) {
    const idx = { descargadas: 2, tallas: 3, terminadas: 4, errores: 4 }[o.etapa] || 2;   // paso que le toca: descargada → BRISA; con tallas → CIRO
    return '<div class="ec-pasos">' + ETAPAS.map(([id, nombre], i) => {
      const n = i + 1, hecho = o.etapa === 'terminadas' || o.etapa === 'errores' ? true : n < idx, ahora = !hecho && n === idx;
      const mal = o.etapa === 'errores' && n === 4;
      return '<div class="ec-p ' + (mal ? 'mal' : hecho ? 'ok' : ahora ? 'ahora' : '') + '"><i>' + (hecho || mal ? (mal ? '!' : '✓') : '') + '</i>' + nombre + '</div>';
    }).join('') + '</div>';
  }
  function listaOrdenes() {
    const vistos = new Set(st.trabajos.map(t => t.numero));
    const antiguos = st.historial.filter(h => !vistos.has(h.numero)).map(h => ({ numero: h.numero, cliente: h.cliente, etapa: h.etapa, terminada: h.at, avisos: h.avisos || [], items: [], eventos: [], resumida: true, seg: h.seg }));
    let l = st.trabajos.concat(antiguos);
    const f = st.filtroOrd;
    l = l.filter(o => f === 'todas' || (f === 'cola' && (o.etapa === 'descargadas' || o.etapa === 'tallas')) || (f === 'terminadas' && o.etapa === 'terminadas') || (f === 'errores' && o.etapa === 'errores'));
    const q = st.busqueda.trim().toLowerCase();
    if (q) l = l.filter(o => ('ov' + o.numero + ' ' + (o.cliente || '')).toLowerCase().includes(q));
    return l;
  }
  function vistaOrdenes() {
    const todas = st.trabajos.concat(st.historial.filter(h => !st.trabajos.some(t => t.numero === h.numero)).map(h => ({ etapa: h.etapa })));
    const cuenta = f => f === 'todas' ? todas.length : todas.filter(o => f === 'cola' ? (o.etapa === 'descargadas' || o.etapa === 'tallas') : o.etapa === f).length;
    const chips = [['todas', 'Todas'], ['cola', 'En cola'], ['terminadas', 'Terminadas'], ['errores', 'Con avisos']];
    const l = listaOrdenes();
    return '<div class="ec-barra"><div class="ec-chips">' + chips.map(([id, n]) => '<button type="button" data-fo="' + id + '" class="' + (st.filtroOrd === id ? 'on' : '') + '">' + n + ' · ' + cuenta(id) + '</button>').join('') + '</div>' +
      '<input type="search" data-bo placeholder="Buscar OV o cliente…" value="' + esc(st.busqueda) + '" aria-label="Buscar órdenes"></div>' +
      '<div class="ec-ords">' + (l.length ? l.map(o => {
        const abierta = st.orden === o.numero, clase = o.etapa === 'errores' ? 'aviso' : o.etapa === 'terminadas' ? 'hecha' : '';
        const seg = o.seg != null ? o.seg : (o.descargada && o.terminada ? Math.round((new Date(o.terminada) - new Date(o.descargada)) / 1000) : null);
        const tiempo = o.etapa === 'terminadas' || o.etapa === 'errores' ? (seg != null ? 'tardó ' + dur(seg) : horaIso(o.terminada)) : (o.descargada ? 'descargada ' + hace((Date.now() - new Date(o.descargada)) / 1000) : '');
        return '<article class="ec-ord ' + clase + (abierta ? ' abierta' : '') + '"><button type="button" data-abrir="' + esc(o.numero) + '" aria-expanded="' + abierta + '"><div><strong>OV' + esc(o.numero) + '</strong><small>' + esc(o.cliente || 'Sin cliente leído todavía') + (o.unidades ? ' · ' + esc(o.unidades) + ' und.' : '') + '</small></div>' + pasosHtml(o) + '<div class="ec-tiempo">' + esc(tiempo) + '</div></button>' +
          '<div class="ec-det">' + (o.avisos && o.avisos.length ? '<div class="ec-avisos">⚠ ' + o.avisos.map(esc).join('<br>⚠ ') + '</div>' : '') +
          (o.items && o.items.length ? '<table class="ec-tabla"><thead><tr><th>Referencia</th><th>Diseño</th><th>Talla</th><th>Nombre</th><th>N.º</th><th>Maestro</th></tr></thead><tbody>' + o.items.map(i => '<tr><td>' + esc(i.ref) + '</td><td>D' + esc(i.diseno) + '</td><td>' + esc(i.talla) + '</td><td>' + esc(i.nombre || '—') + '</td><td>' + esc(i.numero || '—') + '</td><td>' + (i.maestro ? '✓' : '✗') + '</td></tr>').join('') + '</tbody></table>' : (o.resumida ? '<small style="color:#8f9d88">Orden de un día anterior: solo se guarda el resumen.</small>' : '<small style="color:#8f9d88">BRISA todavía no ha leído las prendas de esta orden.</small>')) +
          (o.eventos && o.eventos.length ? '<div class="ec-linea">' + o.eventos.map(e => '<div><time>' + horaIso(e.at) + '</time><span><b style="color:' + (({ ALMA: '#8bd450', BRISA: '#6cb6ff', CIRO: '#ffb04a' })[e.agente] || '#aeb9a6') + '">' + esc(e.agente) + '</b> · ' + esc(e.texto) + '</span></div>').join('') + '</div>' : '') + '</div></article>';
      }).join('') : '<div class="ec-vacio">' + (st.trabajos.length || st.historial.length ? 'Ninguna orden coincide con el filtro.' : 'Aún no ha pasado ninguna orden por los agentes. Cuando ALMA descargue una, aparece aquí con su recorrido.') + '</div>') + '</div>';
  }

  // ====================================================== AGENTES y REGISTRO
  function tarjeta(a) {
    const e = a.estado, v = vivo(a), ocup = !!a.pendiente || !st.pc || !st.pc.conectado;
    return '<article class="ec-card" style="--c:' + a.color + '"><div class="ec-top"><div><h3>' + esc(a.nombre) + '</h3><small>Paso ' + (a.paso || '') + ' de ' + st.agentes.length + ' · ' + esc(a.titulo) + '</small></div>' +
      '<span class="' + pill(a) + '"><i></i>' + esc(a.pendiente ? ({ iniciar: 'Iniciando…', detener: 'Deteniendo…', reiniciar: 'Reiniciando…', revisar: 'Revisando…' }[a.pendiente] || '…') : (ETIQUETA[e] || e)) + '</span></div>' +
      '<div class="ec-ult">' + (a.ultima ? esc(a.ultima) : '<span style="opacity:.5">Sin actividad todavía</span>') + '</div>' +
      '<div class="ec-desde">' + (a.desde && e !== 'INACTIVO' ? 'Desde las ' + horaIso(a.desde) : '') + '</div>' +
      '<div class="ec-btns"><button type="button" class="ag-btn" data-orden="' + a.id + ':iniciar"' + (ocup || v ? ' disabled' : '') + '>▶ Iniciar</button>' +
      '<button type="button" class="ag-btn danger" data-orden="' + a.id + ':detener"' + (ocup || (!v && e !== 'ERROR') ? ' disabled' : '') + '>⏹ Detener</button>' +
      '<button type="button" class="ag-btn sec" data-orden="' + a.id + ':reiniciar" title="Reiniciar"' + (ocup || (!v && e !== 'ERROR') ? ' disabled' : '') + '>↻</button></div>' +
      '<details data-det="' + a.id + '"' + (st.abierto[a.id] ? ' open' : '') + '><summary>QUÉ HACE</summary><ul>' + a.funciones.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></details></article>';
  }
  function vistaAgentes() {
    return '<div class="ec-grid">' + st.agentes.map(tarjeta).join('') + '</div>' +
      (st.ordenes.length ? '<div><div class="ec-sub2">ÚLTIMAS ÓRDENES AL PC</div><div class="ec-ordenes-pc">' + st.ordenes.map(o =>
        '<div class="ec-opc ' + esc(o.estado) + '"><b>' + esc(agente(o.agente).nombre || o.agente) + '</b><span>' + esc(o.accion) + '</span><span>por ' + esc(o.por) + ' · ' + horaIso(o.iso) + '</span><span>' +
        esc({ pendiente: 'esperando al PC', entregada: 'el PC la está haciendo', hecha: 'hecha', error: 'falló', vencida: 'vencida' }[o.estado] || o.estado) + (o.detalle ? ' — ' + esc(o.detalle) : '') + '</span></div>').join('') + '</div></div>' : '');
  }
  function vistaRegistro() {
    const chips = [['', 'Todos']].concat(st.agentes.map(a => [a.id, a.nombre]));
    const lineas = st.log.filter(l => !st.filtro || l.agente === st.filtro);
    return '<div class="ec-chips">' + chips.map(([id, n]) => '<button type="button" data-filtro="' + id + '" class="' + (st.filtro === id ? 'on' : '') + '">' + esc(n) + '</button>').join('') + '</div>' +
      '<div class="ec-log" data-log>' + (lineas.length ? lineas.slice(-250).map(l => {
        const a = agente(l.agente);
        return '<div class="ec-l ' + esc(l.nivel) + '"><time>' + hora(l.at) + '</time><b style="color:' + (a.color || '#aeb9a6') + '">' + esc(a.nombre || l.agente) + '</b><span>' + esc(l.texto) + '</span></div>';
      }).join('') : '<div class="ec-vacio">Todavía no hay actividad registrada.</div>') + '</div>';
  }

  // ====================================================== cajón con el detalle de un agente
  function pintarDrawer() {
    const d = panel.querySelector('[data-drawer]'), v = panel.querySelector('[data-velo]');
    const a = st.drawer ? agente(st.drawer) : null;
    d.classList.toggle('on', !!a); v.classList.toggle('on', !!a);
    if (!a) return;
    const lat = st.latidos[a.id] || {}, ocup = !!a.pendiente || !st.pc || !st.pc.conectado, lineas = st.log.filter(l => l.agente === a.id).slice(-14);
    d.style.setProperty('--c', a.color);
    d.innerHTML = '<button type="button" class="ag-btn sec cerrar" data-cerrar-drawer aria-label="Cerrar">✕</button><div><h3>' + esc(a.nombre) + '</h3><div style="color:#c4cfbf">Paso ' + a.paso + ' de ' + st.agentes.length + ' · ' + esc(a.titulo) + '</div></div>' +
      '<div><span class="' + pill(a) + '"><i></i>' + esc(ETIQUETA[a.estado]) + '</span></div>' +
      '<div style="color:#c4cfbf;font-size:.85rem">' + (lat.actividad ? 'Ahora: <b>' + esc(lat.actividad) + '</b>' : 'Sin actividad reportada todavía.') + (a.id === 'alma' && lat.ultima_hace != null ? '<br>Última vuelta por Effi: ' + hace(lat.ultima_hace) : '') + '</div>' +
      '<div class="ec-btns"><button type="button" class="ag-btn" data-orden="' + a.id + ':iniciar"' + (ocup || vivo(a) ? ' disabled' : '') + '>▶ Iniciar</button><button type="button" class="ag-btn danger" data-orden="' + a.id + ':detener"' + (ocup || (!vivo(a) && a.estado !== 'ERROR') ? ' disabled' : '') + '>⏹ Detener</button>' +
      (a.id === 'alma' ? '<button type="button" class="ag-btn sec" data-orden="alma:revisar"' + (ocup || !vivo(a) ? ' disabled' : '') + '>⟳ Revisar Effi ahora</button>' : '') + '</div>' +
      '<div><div class="ec-sub2">ÚLTIMAS LÍNEAS</div><div class="ec-mini">' + (lineas.length ? lineas.map(l => '<div class="' + (l.nivel === 'error' ? 'e' : '') + '">' + hora(l.at) + ' · ' + esc(l.texto) + '</div>').join('') : '<div>Sin líneas todavía.</div>') + '</div></div>' +
      '<details open><summary>QUÉ HACE</summary><ul>' + a.funciones.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></details>';
  }

  // ====================================================== pintar
  function pintar() {
    const raiz = panel.querySelector('.ec');
    const cab = raiz.querySelector('[data-cabecera]');
    if (!cab) {   // primera vez: se arma el esqueleto fijo
      raiz.innerHTML = '<div data-cabecera></div><div data-aviso></div><div data-conexion></div>' +
        '<nav class="ag-vtabs ec-vtabs" aria-label="Secciones de ECOMMERCE"></nav><div class="ec-body"><div data-vista-flujo>' + esqueletoFlujo() + '</div><div data-vista-ordenes hidden></div><div data-vista-agentes hidden></div><div data-vista-registro hidden></div></div>' +
        '<div class="ec-velo" data-velo></div><aside class="ec-drawer" data-drawer aria-label="Detalle del agente"></aside>';
    }
    { const __el = raiz.querySelector('[data-cabecera]'), __h = encabezado(); if (__el && __el.__h !== __h) { __el.__h = __h; __el.innerHTML = __h; } }
    { const __el = raiz.querySelector('[data-aviso]'), __h = st.aviso ? '<div class="ec-aviso">' + esc(st.aviso) + '</div>' : ''; if (__el && __el.__h !== __h) { __el.__h = __h; __el.innerHTML = __h; } }
    { const __el = raiz.querySelector('[data-conexion]'), __h = conexion(); if (__el && __el.__h !== __h) { __el.__h = __h; __el.innerHTML = __h; } }
    const sobre = st.trabajos.filter(t => t.etapa === 'errores').length;
    { const __el = raiz.querySelector('.ec-vtabs'), __h = [['flujo', 'FLUJO'], ['ordenes', 'ÓRDENES' + (sobre ? ' ⚠' : '')], ['agentes', 'AGENTES'], ['registro', 'REGISTRO']].map(([id, n]) => '<button type="button" class="ag-vt' + (st.vista === id ? ' on' : '') + '" data-vt="' + id + '">' + n + '</button>').join(''); if (__el && __el.__h !== __h) { __el.__h = __h; __el.innerHTML = __h; } }
    ['flujo', 'ordenes', 'agentes', 'registro'].forEach(id => { raiz.querySelector('[data-vista-' + id + ']').hidden = st.vista !== id; });
    const l0 = raiz.querySelector('[data-log]'), pegado = !l0 || l0.scrollHeight - l0.scrollTop - l0.clientHeight < 40, y = l0 ? l0.scrollTop : 0;
    if (st.vista === 'flujo') { actualizarFlujo(raiz.querySelector('[data-vista-flujo]')); actualizarFeed(raiz.querySelector('[data-vista-flujo]')); }
    else if (st.vista === 'ordenes') { const c = raiz.querySelector('[data-vista-ordenes]'); const bo = c.querySelector('[data-bo]'), enfocado = bo && document.activeElement === bo; c.innerHTML = vistaOrdenes(); if (enfocado) { const n = c.querySelector('[data-bo]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
    else if (st.vista === 'agentes') { const __el = raiz.querySelector('[data-vista-agentes]'), __h = vistaAgentes(); if (__el.__h !== __h) { __el.__h = __h; __el.innerHTML = __h; } }
    else raiz.querySelector('[data-vista-registro]').innerHTML = vistaRegistro();
    const l = raiz.querySelector('[data-log]'); if (l) l.scrollTop = pegado ? l.scrollHeight : y;
    pintarDrawer();
  }

  async function cargar() {
    try {
      const e = await api('/api/ecommerce/estado');
      st.agentes = e.agentes; st.pc = e.pc; st.ordenes = e.ordenes; st.cola = e.cola || {}; st.trabajos = e.trabajos || []; st.historial = e.historial || []; st.hoy = e.hoy || {}; st.latidos = e.latidos || {};
      const al = st.latidos.alma;
      if (al && al.proxima_en != null) { st.proxima = Date.now() + al.proxima_en * 1000; st.intervalo = al.intervalo || 60; } else st.proxima = null;
      const l = await api('/api/ecommerce/log?desde=' + st.ultimo + '&limite=300');
      if (l.lineas.length) st.log = st.log.concat(l.lineas).slice(-600);
      st.ultimo = l.ultimo;
      if (st.aviso && /^(Cargando|No se pudo leer)/.test(st.aviso)) st.aviso = '';
      pintar();
    } catch (err) { st.aviso = err.message; pintar(); }
  }
  async function ordenar(agenteId, accion) {
    if (st.ocupado) return;
    st.ocupado = true; st.aviso = '';
    try { await api('/api/ecommerce/agentes/' + agenteId + '/' + accion, { method: 'POST' }); }
    catch (err) { st.aviso = err.message; }
    st.ocupado = false;
    await cargar();
  }
  async function aTodos(accion, texto) {
    const vivos = st.agentes.filter(vivo);
    if (!vivos.length || !confirm(texto)) return;
    st.aviso = '';
    for (const a of vivos) { try { await api('/api/ecommerce/agentes/' + a.id + '/' + accion, { method: 'POST' }); } catch (err) { st.aviso = err.message; } }
    await cargar();
  }

  function construir() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav) return false;
    if (document.querySelector('.panel[data-panel="ecommerce"]')) return true;
    clonarEstilosAgentes();
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'ecommerce';
    panel.innerHTML = '<div class="ag ec"><div class="ag-empty">Cargando ECOMMERCE…</div></div>';
    main.appendChild(panel);
    const grupo = document.createElement('div'); grupo.className = 'nav-group'; grupo.hidden = true; grupo.style.display = 'none';
    grupo.innerHTML = '<button class="tab" data-kind="ecommerce" type="button"><span class="nav-icon">EC</span><strong>ECOMMERCE</strong></button>';
    nav.appendChild(grupo);
    tab = grupo.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      st.token = null; st.aviso = '';
      cargar();
      clearInterval(timer); clearInterval(reloj);
      timer = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) cargar(); }, 3000);
      reloj = setInterval(() => { if (panel.classList.contains('active') && !document.hidden) tickReloj(); }, 1000);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && st.drawer) { st.drawer = null; pintarDrawer(); } });
    panel.addEventListener('click', async e => {
      panel.querySelectorAll('details.ag-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.ag-menu-l button')) d.removeAttribute('open'); });
      if (e.target.closest('[data-cerrar-drawer]') || e.target.matches('[data-velo]')) { st.drawer = null; pintarDrawer(); return; }
      const nodo = e.target.closest('[data-nodo]');
      if (nodo) { st.drawer = nodo.dataset.nodo; pintarDrawer(); return; }
      const cola = e.target.closest('[data-cola]');
      if (cola) { st.vista = 'ordenes'; st.filtroOrd = 'cola'; pintar(); return; }
      const ir = e.target.closest('[data-ir]');
      if (ir) { st.vista = 'ordenes'; st.filtroOrd = ir.dataset.ir === 'cola' ? 'cola' : ir.dataset.ir; pintar(); return; }
      if (e.target.closest('[data-revisar]') && !e.target.closest('[disabled]')) { ordenar('alma', 'revisar'); return; }
      const alt = e.target.closest('[data-alterna]');
      if (alt && !alt.disabled) { const a = agente(alt.dataset.alterna); if (a.id) ordenar(a.id, vivo(a) ? 'detener' : 'iniciar'); return; }
      const b = e.target.closest('[data-orden]');
      if (b && !b.disabled) { const [id, accion] = b.dataset.orden.split(':'); ordenar(id, accion); return; }
      const vt = e.target.closest('[data-vt]');
      if (vt) { st.vista = vt.dataset.vt; pintar(); return; }
      const fo = e.target.closest('[data-fo]');
      if (fo) { st.filtroOrd = fo.dataset.fo; pintar(); return; }
      const ab = e.target.closest('[data-abrir]');
      if (ab) { st.orden = st.orden === ab.dataset.abrir ? null : ab.dataset.abrir; pintar(); return; }
      const f = e.target.closest('[data-filtro]');
      if (f) { st.filtro = f.dataset.filtro; pintar(); return; }
      if (e.target.closest('[data-detener-todo]') && !e.target.closest('[disabled]')) { aTodos('detener', '¿Detener a todos los agentes que están corriendo?'); return; }
      if (e.target.closest('[data-reiniciar-todo]') && !e.target.closest('[disabled]')) { aTodos('reiniciar', '¿Reiniciar a los agentes que están corriendo? Lo que estén haciendo se corta.'); return; }
      if (e.target.closest('[data-conectar]')) {
        if (st.pc && st.pc.hay_token && !confirm('Se creará un código nuevo y el PC actual dejará de conectarse hasta que lo vuelvas a enlazar. ¿Continuar?')) return;
        try { st.token = await api('/api/ecommerce/conexion/regenerar', { method: 'POST' }); st.aviso = ''; } catch (err) { st.aviso = err.message; }
        pintar(); await cargar();
      }
    });
    panel.addEventListener('input', e => { if (e.target.matches('[data-bo]')) { st.busqueda = e.target.value; pintar(); } });
    panel.addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('[data-det]'); if (d) st.abierto[d.dataset.det] = d.open; }, true);
    return true;
  }

  function ponerEnMenu() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return false;
    let boton = document.getElementById('open-ecommerce');
    const previo = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button'; boton.id = 'open-ecommerce'; boton.textContent = 'Ecommerce';
      boton.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    }
    if (boton.isConnected) return true;   // una sola vez: si cada módulo reacomodara su botón, se pelearían y el menú se vería moviéndose
    if (previo) previo.insertAdjacentElement('afterend', boton);
    else if (!boton.isConnected) menu.querySelector('p')?.insertAdjacentElement('afterend', boton);
    return true;
  }

  fetch('/api/ecommerce/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(ok => {
    if (!ok) return;
    let intentos = 0;
    const espera = setInterval(() => {
      if (construir()) ponerEnMenu();
      if (++intentos > 40) clearInterval(espera);
    }, 400);
  }).catch(() => { /* sin acceso confirmado: no se muestra */ });
})();
