(() => {
  // PROGRAMAR CLUB (COMERCIALES): bandeja de reprogramaciones de los clubes y EMPEZAR PEDIDO (formulario tipo Effi). Los enlaces para clientes se quitaron de la pantalla (2026-11-13); el backend de enlaces sigue en club.py.
  if (window.__clubAdminListo) return;
  window.__clubAdminListo = true;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ESTADOS_VISIBLES = ['aprobada'];
  let panel = null, dlg = null, modoDlg = 'correos', correos = { comerciales: '', sin_vendedor: '', efectivos: '' }, effi = null, pedidos = [], filtro = 'aprobada', busqueda = '', aviso = '', ultimo = '', ultimoDlg = '', cargando = false, clienteElegido = null;
  let abiertos = new Set(), ocupados = new Set(), vistos = new Set(), primeraCarga = true;

  const css = document.createElement('style');
  css.textContent = `
  .tc{width:100%;max-width:none;margin:14px 0 0;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;box-sizing:border-box}
  .tc-cards{display:grid;gap:20px;padding:24px;align-items:start;background:#111715;border-radius:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,500px),1fr))}
  .ax-fondo{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:grid;place-items:center;padding:12px;overflow:auto}
  .ax-card{width:min(640px,100%);box-sizing:border-box;padding:18px;border:1px solid rgba(208,244,76,.4);border-radius:18px;background:#101a12;color:#f5faef;font-family:Arial,sans-serif}
  .ax-cab{display:flex;justify-content:space-between;align-items:center;gap:10px}.ax-cab h3{margin:2px 0 0;font:900 20px Arial}.ax-eye{color:#d0f44c;font:800 11px Arial;letter-spacing:.14em}
  .ax-x{all:unset;cursor:pointer;padding:7px 14px;border:1px solid rgba(255,255,255,.3);border-radius:99px;font:800 12px Arial}
  .ax-p{color:#c9d3c1;font:600 13px/1.5 Arial}.ax-estado{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font:700 13px/1.6 Arial;color:#c9d3c1}.ax-estado.ok{border:1px solid rgba(208,244,76,.5);color:#e8f0e0}
  .ax-pasos{display:grid;gap:10px;margin-top:12px}.ax-paso{display:grid;gap:8px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:12px}.ax-paso b{font:900 13px Arial;color:#d0f44c}.ax-paso small{color:#a9b5a3;font:600 12px/1.55 Arial}
  .ax-btns{display:flex;gap:8px;flex-wrap:wrap}.ax-btn{all:unset;cursor:pointer;padding:9px 16px;border-radius:99px;background:rgba(255,255,255,.1);color:#f5faef;font:900 12px Arial;letter-spacing:.05em}.ax-btn.lime{background:#d0f44c;color:#142017}
  .ax-codigo{display:flex;align-items:baseline;gap:12px}.ax-codigo span{font:900 30px Consolas,monospace;letter-spacing:.24em;color:#d0f44c}.ax-codigo small{color:#a9b5a3}
  .tc-card{padding:22px;border:1px solid #35403a;border-radius:18px;background:#1a201d;box-shadow:0 5px 20px #0002;box-sizing:border-box;min-width:0}
  .tc-cabeza{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
  .tc-card h2{margin:0;font:600 clamp(20px,2.4vw,25px) Arial;letter-spacing:-.02em;color:#f4f7f2}
  .tc-card .eyebrow{color:#d0f44c;font:800 11px Arial;letter-spacing:.16em}
  .tc input,.tc select,.tc-dlg input,.tc-dlg select{min-height:40px;padding:0 12px;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 14px Arial;outline:none;width:100%;box-sizing:border-box;transition:border-color .2s ease,box-shadow .2s ease}
  .tc input:focus,.tc select:focus,.tc-dlg input:focus,.tc-dlg select:focus{border-color:#d0f44c;box-shadow:0 0 0 3px rgba(208,244,76,.14)}
  .tc button,.tc-dlg button{width:auto!important;box-shadow:none!important;transform:none!important;text-transform:none;letter-spacing:0;font-family:Arial,sans-serif}
  .tc button:hover,.tc-dlg button:hover{filter:brightness(1.1)}
  .tc button:disabled,.tc-dlg button:disabled{opacity:.45;cursor:progress}
  .tc-btn{min-height:30px;padding:0 13px;border:1px solid #455449;border-radius:999px;background:transparent;color:#c4d2c6;font:700 12px Arial;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;box-sizing:border-box;white-space:nowrap;transition:filter .15s ease,opacity .15s ease}
  .tc-b-lime{background:#d1eb89!important;color:#202a14!important;border-color:#d1eb89!important}
  .tc-b-red{background:#ef7370!important;color:#2a1010!important;border-color:#ef7370!important}
  .tc-b-line{background:transparent!important;color:#c4d2c6!important;border:1px solid #455449!important}
  .tc-b-soft{background:rgba(255,255,255,.08)!important;color:#f5faef!important;border-color:transparent!important}
  .tc-aviso{padding:10px 12px;border-radius:10px;background:#1b2a1b;color:#d0f44c;font:700 13px Arial;overflow-wrap:anywhere;display:flex;align-items:center;gap:8px}
  .tc-dot{flex:0 0 auto;display:inline-block;width:9px;height:9px;border-radius:50%;background:#ffb74d}
  .tc-dot.on{background:#d0f44c;animation:tcPulso 1.8s ease-out infinite}
  .tc-dot.off{background:#ff6b5c}
  .tc-lista{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr))}
  .tc-fila{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#121712}
  .tc-fila strong{color:#f2f7ea}.tc-fila small{display:block;color:#a9b5a3;font-size:.74rem}
  .tc-acc{display:flex;gap:8px;flex-wrap:wrap}
  .panel[data-panel="club"]{position:relative}.tc-ag-top{display:inline-flex;align-items:center;padding:8px 14px;border-radius:99px;border:1px solid #3d4c3b;font:800 11px Arial;letter-spacing:.04em;white-space:nowrap;margin-right:8px;background:rgba(0,0,0,.25)}.tc-ag-top.ok{border-color:#6f9410;color:#9be37a}.tc-ag-top.mal{border-color:#ffb547;color:#ffb547}
  .tc-progcards [data-card-delete]{display:none!important}.tc-prog-orden{display:flex;flex-direction:column;gap:8px;min-width:0}.tc-prog-barra{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 4px}.tc-prog-barra small{font:600 11px Arial;color:#7f8c79}.tc-prog-btns{display:flex;gap:6px;flex-wrap:wrap}
  .tc-ptabs{display:inline-flex;margin:0 auto;border:1px solid #3d4c3b;border-radius:99px;overflow:hidden;background:rgba(0,0,0,.3)}.tc-ptabs button{all:unset;cursor:pointer;padding:9px 26px!important;color:#c9d3c1!important;background:transparent!important;border:0!important;box-shadow:none!important;min-height:0!important;width:auto!important;font:900 12px Arial!important;letter-spacing:.12em!important;transition:background .2s,color .2s}.tc-ptabs button:hover{color:#d0f44c!important}.tc-ptabs button.on{background:#d0f44c!important;color:#0d140e!important}@media(max-width:600px){.tc-ptabs button{padding:8px 14px;font-size:11px}}
  .tc-ptabs button{white-space:nowrap!important}@media (max-width:700px){.tc-pedido-cab{display:grid!important;grid-template-columns:1fr auto;align-items:center;row-gap:10px}.tc-pedido-cab .tc-ptabs{grid-column:1/-1;order:3;display:grid;grid-template-columns:1fr 1fr;margin:0;width:100%}.tc-pedido-cab .tc-ptabs button{text-align:center;padding:12px 8px!important;font-size:13px!important;letter-spacing:.08em!important}.tc-pedido-cab .tc-b-line{padding:8px 14px!important;min-height:0!important}.tc-pedido-cab h2{font-size:20px!important}}
  .tc .tc-aviso.tc-info{display:inline-flex!important;align-items:center;gap:8px;width:auto!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;font-size:13px}
  @media (min-width:900px){.tc>*{width:calc(100vw - 64px)!important;max-width:none!important;box-sizing:border-box}}
  @media (min-width:900px){.tc-plano .tc-cabeza{width:calc(100vw - 64px);justify-content:space-between;flex-wrap:nowrap}.tc-plano .tc-cabeza .tc-acc{margin-left:auto;flex-wrap:nowrap}}
  .panel[data-panel="club"]{background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.panel[data-panel="club"]::before,.panel[data-panel="club"]::after{display:none!important}   /* sin recuadro: los botones quedan flotando sobre el fondo */
  html body main section.panel.panel.panel.panel.panel[data-panel="club"][data-panel]:not(.lq):not(.lq *):not(.x1):not(.x2),html body main section.panel.panel.panel.panel.panel[data-panel="club"][data-panel]:not(.lq):not(.lq *):not(.x1):not(.x2):hover{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;transform:none!important}main:has(.panel[data-panel="club"].active) .footer-note{display:none}.tc-plano .tc-cabeza h2{text-shadow:0 2px 10px #000a}.tc-plano .tc-btn{box-shadow:0 6px 18px rgba(0,0,0,.45)}.tc-plano{overflow:visible!important;padding:4px 0!important;border:0!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important}
  .tc-barra{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:14px}
  .tc-chips{display:flex;gap:8px;flex-wrap:wrap}
  .tc-chips button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 12px;border:1px solid #455449!important;border-radius:999px;background:transparent!important;color:#c4d2c6!important;font:700 12px Arial;cursor:pointer;transition:background .2s ease,border-color .2s ease,color .2s ease}
  .tc-chips button:hover{border-color:rgba(208,244,76,.55)!important;color:#fff!important}
  .tc-chips button.on{border-color:#d1eb89!important;background:rgba(208,244,76,.14)!important;color:#fff!important}
  .tc-n{min-width:20px;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.12);color:inherit;font:800 11px Arial;font-style:normal;text-align:center}
  .tc-chips button.on .tc-n{background:#d1eb89;color:#202a14}
  .tc-buscar{flex:0 1 300px;min-height:36px;padding:0 14px;border:1px solid #3d4c3b;border-radius:999px;background:#142017;color:#f5faef;font:600 13px Arial;outline:none;box-sizing:border-box;width:auto}
  .tc-buscar:focus{border-color:#d0f44c;box-shadow:0 0 0 3px rgba(208,244,76,.14)}
  .tc-vacio{padding:24px;text-align:center;border:1px dashed #4a5a40;border-radius:12px;color:#b7c0b3}
  .tc-pcard{display:flex;flex-direction:column;min-height:390px;padding:24px;border:1px solid #35403a;border-left:4px solid #ffc95c;border-radius:18px;background:#1b211f;box-shadow:0 5px 20px #0002;box-sizing:border-box;min-width:0;transition:box-shadow .2s ease}
  /* tarjetas compactas, como iconos: título, estado y cotización; el detalle completo se abre con «Ver detalle» */
  .tc-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr))!important;gap:14px!important;padding:16px!important}
  .tc-pcard:not(.tc-abierta){min-height:0!important;padding:16px!important;gap:8px;aspect-ratio:auto}
  .tc-pcard:not(.tc-abierta) .tc-pdl,.tc-pcard:not(.tc-abierta) .tc-sub,.tc-pcard:not(.tc-abierta) .tc-prog,.tc-pcard:not(.tc-abierta) .tc-nota{display:none!important}
  .tc-pcard:not(.tc-abierta) .tc-ph{flex-direction:column;align-items:flex-start;gap:8px}
  .tc-pcard:not(.tc-abierta) h3{font-size:15px!important}
  .tc-pcard:not(.tc-abierta) .tc-pact{gap:6px}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn{padding:6px 10px!important;font-size:11px!important}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]{font-size:0!important;width:38px;height:38px;padding:0!important;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
  .tc-svg{display:none}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]{justify-content:center!important;align-items:center!important;gap:0!important;letter-spacing:0!important;text-indent:0!important}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn .tc-svg{margin:0!important;flex:0 0 20px}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]::before{content:none}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn .tc-svg{display:block}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]{transition:transform .15s,box-shadow .15s,background .15s,border-color .15s;color:#cfe0cb}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]:hover{transform:translateY(-2px);box-shadow:0 6px 14px #0006;background:#ffffff14;border-color:#8bd450}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn.tc-b-lime[data-ic]{background:#d0f44c;color:#17210d;border-color:#d0f44c}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn.tc-b-lime[data-ic]:hover{background:#e2ff72}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn.tc-b-red[data-ic]{background:#ff6b5c1f;color:#ff8f84;border-color:#ff6b5c66}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn.tc-b-red[data-ic]:hover{background:#ff6b5c;color:#fff;border-color:#ff6b5c}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn:active{transform:scale(.94)}
  .tc-ava{display:none}.tc-num{display:none}.tc-mini{display:none}
  .tc-pcard:not(.tc-abierta){gap:12px!important;border-radius:20px;transition:transform .18s,box-shadow .18s}
  .tc-pcard:not(.tc-abierta):hover{transform:translateY(-3px)}
  .tc-pcard:not(.tc-abierta) .tc-ph{flex-direction:row!important;align-items:center!important;flex-wrap:wrap;gap:10px 12px}
  .tc-pcard:not(.tc-abierta) .tc-ph>div{flex:1 1 90px;min-width:0}
  .tc-pcard:not(.tc-abierta) .tc-ava{display:flex;flex:0 0 42px;width:42px;height:42px;border-radius:14px;align-items:center;justify-content:center;font:800 18px Arial;color:#12180f;background:linear-gradient(135deg,#d0f44c,#8bd450)}
  .tc-pcard.pendiente:not(.tc-abierta) .tc-ava{background:linear-gradient(135deg,#ffd978,#ffb347)}.tc-pcard.rechazada:not(.tc-abierta) .tc-ava{background:linear-gradient(135deg,#ff9a8f,#ff6b5c)}
  .tc-pcard:not(.tc-abierta) .tc-num{display:block;color:#92a296;font:600 11px Arial;margin-top:2px}
  .tc-pcard:not(.tc-abierta) .tc-ph .tc-badge{order:3;margin-left:54px}
  .tc-pcard:not(.tc-abierta) .tc-mini{display:flex;flex-wrap:wrap;gap:6px}
  .tc-pcard:not(.tc-abierta) .tc-mini span{padding:4px 10px;border-radius:999px;background:#ffffff0d;border:1px solid #ffffff14;font:700 12px Arial;color:#dfe8da}
  .tc-pcard:not(.tc-abierta) .tc-mini .tc-fila-i{flex:1 1 100%;overflow-wrap:anywhere;font-size:12px!important;background:none;border:0;padding:0 2px;font-weight:600;color:#b8c5b3}
  .tc-pcard:not(.tc-abierta) .tc-cot{margin:0!important;font-size:12px}
  .tc-pcard:not(.tc-abierta) .tc-pact{margin-top:auto;padding-top:12px;border-top:1px solid #ffffff12;gap:8px;flex-wrap:nowrap}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]{flex:0 0 38px;min-width:38px;box-sizing:border-box}
  .tc-pcard:not(.tc-abierta) .tc-pact [data-res="aprobada"]{margin-left:auto}
  /* tarjeta compacta al estilo de las tarjetas de Producción: código, línea, estado, referencia, cantidad y columna de iconos a la derecha */
  .tc-cod,.tc-linea,.tc-estado,.tc-refb{display:none}
  .tc-pcard:not(.tc-abierta){display:grid!important;grid-template-columns:minmax(0,1fr);row-gap:12px;align-content:start}
  .tc-pcard:not(.tc-abierta)>*{grid-column:1;min-width:0}
  .tc-pcard:not(.tc-abierta)>.tc-pact{grid-column:1 / -1!important;grid-row:auto;flex-direction:row!important;flex-wrap:nowrap!important;justify-content:flex-end;border:0!important;border-top:1px solid #ffffff12!important;padding:14px 0 0!important;margin:0!important;gap:8px;align-self:end}
  .tc-pcard:not(.tc-abierta)>.tc-pact [data-res="aprobada"]{margin-left:0!important}
  .tc-pcard:not(.tc-abierta) .tc-pact .tc-btn[data-ic]{flex:0 0 44px;width:44px;height:44px;min-width:44px;border-radius:14px!important}
  .tc-pcard:not(.tc-abierta) .tc-ph{display:flex!important;flex-wrap:wrap;gap:6px 10px}
  .tc-pcard:not(.tc-abierta) .tc-ava,.tc-pcard:not(.tc-abierta) .tc-ph .tc-badge,.tc-pcard:not(.tc-abierta) .tc-num{display:none!important}
  .tc-pcard:not(.tc-abierta) .tc-cod{display:block;font:800 26px Arial;color:#f4f7f2;letter-spacing:.01em;flex:1 1 auto}
  .tc-pcard:not(.tc-abierta) .tc-linea{display:inline-flex;gap:6px;align-items:center;padding:5px 12px;border-radius:999px;background:#c9b7f0;color:#2d2147;font:700 9px Arial;letter-spacing:.12em}
  .tc-pcard:not(.tc-abierta) .tc-linea b{font-size:11px;letter-spacing:.1em}
  .tc-pcard:not(.tc-abierta) .tc-ph>div{flex:1 1 100%}
  .tc-pcard:not(.tc-abierta) h3{font:800 14px Arial!important;text-transform:uppercase;letter-spacing:.02em;color:#f4f7f2}
  .tc-pcard:not(.tc-abierta) .tc-estado{display:block}
  .tc-pill{display:inline-block;padding:6px 14px;border-radius:999px;background:#2f4636;border:1px solid #4f6b57;color:#e8f2e6;font:700 12px Arial}
  .tc-pill.aprobada{background:#2f5a2f}.tc-pill.rechazada{background:#5a2f2f;border-color:#7a4545}
  .tc-pcard:not(.tc-abierta) .tc-refb{display:flex;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:16px;background:#ffffff08;border:1px solid #ffffff12}
  .tc-refb small{display:block;color:#92a296;font:600 10px Arial;letter-spacing:.1em;margin-top:6px}.tc-refb small:first-child{margin-top:0}
  .tc-refb b{display:block;font:800 14px Arial;color:#f4f7f2;overflow-wrap:anywhere}
  .tc-refb em{font:800 10px Arial;font-style:normal;color:#d0f44c;overflow-wrap:anywhere}
  .tc-refb .tc-cant{text-align:right;flex:0 0 auto}.tc-refb .tc-cant b{display:inline;font-size:30px}.tc-refb .tc-cant span{color:#92a296;font:700 12px Arial}
  .tc-pcard:not(.tc-abierta) .tc-mini span:first-child{display:none}
  .tc-pcard.tc-abierta .tc-mini{display:none}
  .tc-pcard.tc-abierta{grid-column:1/-1}
  .tc-pcard:hover{box-shadow:0 8px 24px #0004}
  .tc-pcard.aprobada{border-left-color:#8bd450}.tc-pcard.rechazada{border-left-color:#ff6b5c}
  .tc-pcard.tc-entra{animation:tcEntra .4s ease both}
  .tc-ph{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
  .tc-ph h3{margin:0;font:600 clamp(18px,2vw,22px) Arial;letter-spacing:-.02em;line-height:1.2;color:#f4f7f2;overflow-wrap:anywhere}
  .tc-sub{display:block;margin-top:4px;color:#92a296;font:500 13px Arial}
  .tc-badge{flex:0 0 auto;border:1px solid #3c4940;border-radius:20px;padding:3px 9px;font:700 11px Arial;text-transform:uppercase;letter-spacing:.06em;color:#ffd08a;white-space:nowrap}
  .tc-badge.aprobada{color:#d1eb89;border-color:#4d6a2c}.tc-badge.rechazada{color:#ff9b8f;border-color:#6a3a35}
  .tc-pdl{display:grid;grid-template-columns:1fr 1fr;gap:15px 14px;padding:16px 0;margin:0 0 14px;border-top:1px solid #323c35;border-bottom:1px solid #323c35}
  .tc-pdl dt{font:400 12px Arial;color:#92a296;margin-bottom:4px}
  .tc-pdl dd{margin:0;font:600 15px Arial;line-height:1.35;color:#e8efe8;overflow-wrap:anywhere}
  .tc-prog{height:6px;margin:0 0 8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
  .tc-prog i{display:block;height:100%;width:0;border-radius:inherit;background:#d1eb89;transition:width .7s cubic-bezier(.2,.8,.2,1),background .4s ease}
  .tc-prog.activo i{background:linear-gradient(90deg,#8bd450,#d1eb89,#8bd450);background-size:200% 100%;animation:tcBrillo 1.4s linear infinite}
  .tc-prog.lista i{background:#8bd450}
  .tc-prog.error i{background:#ff6b5c;width:100%!important}
  .tc-cot{margin:0 0 6px;font:700 13px Arial;color:#ffd08a}
  .tc-cot.lista{color:#d1eb89}.tc-cot.error{color:#ff9b8f}
  .tc-nota{margin:0 0 6px;color:#c4cfbf;font:500 13px/1.45 Arial;overflow-wrap:anywhere}
  .tc-pact{display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:14px}
  .tc-det{display:grid;gap:8px;margin-top:12px;padding:12px;border-radius:12px;background:#0e1510;font-size:.85rem;color:#dfe8d9;animation:tcAbre .25s ease both}
  .tc-det table{width:100%;border-collapse:collapse}.tc-det th,.tc-det td{padding:4px 6px;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)}.tc-det th{color:#a9b5a3;font-size:.7rem;text-transform:uppercase}
  .tc-dlg{width:min(94vw,720px);max-height:86vh;padding:0;border:1px solid #35403a;border-radius:18px;background:#1a201d;color:#f4f7f2;box-shadow:0 20px 60px #000a}
  .tc-dlg::backdrop{background:rgba(0,0,0,.6)}
  .tc-dlg-cuerpo{display:grid;gap:14px;padding:22px}
  .tc-dlg-cabeza{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .tc-dlg h2{margin:0;font:600 22px Arial;color:#f4f7f2}
  .tc-dlg p{margin:0;color:#a9b5a3;font:500 13px/1.5 Arial}
  .tc-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
  .tc-form label{display:grid;gap:5px;flex:1 1 220px;color:#c9d3c1;font:800 11px Arial;letter-spacing:.1em;min-width:0}
  .tc-cliente-wrap{position:relative}.tc-sugerencias{position:relative;z-index:4;margin-top:6px;display:grid;max-height:230px;overflow:auto;padding:5px;border:1px solid #52624a;border-radius:12px;background:#172018;box-shadow:0 14px 32px rgba(0,0,0,.55)}
  .tc-sugerencias[hidden]{display:none}.tc-sugerencias button{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:10px;width:100%!important;min-height:36px;padding:8px 10px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#eff6e8!important;text-align:left!important;font:700 13px Arial!important;cursor:pointer}.tc-sugerencias button:hover{background:rgba(208,244,76,.13)!important}.tc-sugerencias small{color:#aab7a5;font:600 11px Arial;white-space:nowrap}
  .tc-seleccion{display:flex;align-items:center;gap:8px;min-height:38px;padding:0 12px;border:1px dashed #4a5a48;border-radius:11px;background:#121912;color:#aab7a5;font:700 12px Arial}.tc-seleccion.on{border-style:solid;border-color:#a7d943;background:#1b2a18;color:#eef8dc}.tc-seleccion b{color:#d1eb89}
  .tc-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:grid;gap:8px;z-index:9999;pointer-events:none;width:min(92vw,420px)}
  .tc-toast{white-space:pre-line;max-width:min(620px,92vw);padding:12px 16px;border-radius:14px;background:#1d2a1d;border:1px solid rgba(208,244,76,.35);color:#f5faef;font:700 14px Arial;box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(12px);transition:opacity .25s ease,transform .25s ease;text-align:center}
  .tc-toast.on{opacity:1;transform:none}
  .tc-toast.error{border-color:rgba(255,107,92,.6);color:#ffd2cc}
  @keyframes tcEntra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes tcAbre{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  @keyframes tcBrillo{from{background-position:0 0}to{background-position:-200% 0}}
  @keyframes tcPulso{0%{box-shadow:0 0 0 0 rgba(208,244,76,.6)}70%{box-shadow:0 0 0 8px rgba(208,244,76,0)}100%{box-shadow:0 0 0 0 rgba(208,244,76,0)}}
  @media (max-width:640px){
    .tc-chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;width:100%;padding-bottom:2px}
    .tc-chips::-webkit-scrollbar{display:none}
    .tc-chips button{flex:0 0 auto}
    .tc-buscar{flex:1 1 100%;width:100%}
    .tc-card{padding:16px}
    .tc-cards{padding:12px;gap:14px}
    .tc-pcard{padding:18px}
  }
  @media (prefers-reduced-motion:reduce){.tc *,.tc-dlg *,.tc-toast{animation:none!important;transition:none!important}}`;
  document.head.appendChild(css);

  async function api(url, metodo, cuerpo) {
    const r = await fetch(url, { method: metodo || 'GET', headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  }
  const fecha = iso => { try { if (isNaN(new Date(iso))) return ''; return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };
  const url = t => location.origin + '/club/' + t;

  function toast(msg, tipo) {
    let zona = document.querySelector('.tc-toasts');
    if (!zona) { zona = document.createElement('div'); zona.className = 'tc-toasts'; zona.setAttribute('aria-live', 'polite'); document.body.appendChild(zona); }
    const t = document.createElement('div');
    t.className = 'tc-toast' + (tipo ? ' ' + tipo : '');
    t.textContent = msg;
    zona.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, Math.min(16000, 3200 + String(msg).length * 45));   // los avisos largos (diagnóstico) duran más
  }

  function detalle(p) {
    return '<div class="tc-det"><div><b>' + esc(p.contacto) + '</b> · ' + esc(p.telefono) + (p.notas ? ' · ' + esc(p.notas) : '') + '</div>' + p.lineas.map(l =>
      '<div><b>' + esc(l.proyecto || l.referencia) + '</b> · Ref. ' + esc(l.referencia) + ' · base ' + esc(l.orden_base) + ' · tela ' + esc(l.tela || '—') + (l.codigo_tela ? ' (código ' + esc(l.codigo_tela) + ')' : '') + '<table><tr><th>Nombre dorsal</th><th>Talla</th><th>Número</th><th>Género</th><th>Observación</th><th>Diseño</th><th>Cant.</th></tr>' +
      l.jugadores.map(j => '<tr><td>' + esc(j.nombre || '—') + '</td><td>' + esc(j.talla) + '</td><td>' + esc(j.numero || '—') + '</td><td>' + esc(j.genero || '—') + '</td><td>' + esc(j.observacion || '') + '</td><td>D' + esc(j.diseno || 1) + '</td><td>' + esc(j.cantidad) + '</td></tr>').join('') + '</table></div>').join('') +
      (p.nota_comercial ? '<div>Nota: ' + esc(p.nota_comercial) + '</div>' : '') + '</div>';
  }

  const COT = { preparando: 'Preparando la cotización…', pendiente: 'Esperando a EFFITRON…', entregada: 'EFFITRON está creando la cotización en Effi…', sin_pdf: 'Creada en Effi, bajando el PDF…', lista: 'Cotización lista', error: 'EFFITRON no pudo crear la cotización' };
  const AVANCE = { preparando: 10, pendiente: 25, entregada: 50, sin_pdf: 75, lista: 100, error: 100 };

  // Tarjeta de reprogramación con el mismo lenguaje visual que las tarjetas de Producción.
  function tarjeta(p, nueva) {
    const abierto = abiertos.has(p.id), busy = ocupados.has(p.id), pendiente = p.estado === 'pendiente';
    const activo = p.cot_estado && p.cot_estado !== 'lista' && p.cot_estado !== 'error';
    const barra = p.cot_estado ? '<div class="tc-prog ' + (activo ? 'activo' : p.cot_estado) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (AVANCE[p.cot_estado] || 0) + '"><i style="width:' + (AVANCE[p.cot_estado] || 0) + '%"></i></div>' : '';
    const cot = p.cot_estado ? '<p class="tc-cot ' + p.cot_estado + '">' + esc(COT[p.cot_estado] || p.cot_estado) + (p.cot_numero ? ' · N° ' + esc(p.cot_numero) : '') + '</p>' : '';
    const nota = p.cot_detalle ? '<p class="tc-nota">' + esc(p.cot_detalle) + '</p>' : '';
    const pdf = p.cot_pdf ? '<a class="tc-btn tc-b-line" data-ic="📄" title="Ver cotización PDF" target="_blank" href="/api/club/pedidos/' + p.id + '/cotizacion.pdf"><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>Ver cotización PDF</a>' : '';
    const reintento = (p.cot_estado === 'error' || p.cot_estado === 'sin_pdf') ? '<button class="tc-btn tc-b-line" data-ic="↻" title="Reintentar" data-cotreint="' + p.id + '"><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/></svg>Reintentar</button>' : '';
    const acciones = pendiente
      ? '<button class="tc-btn tc-b-lime" data-ic="✓" title="Aprobar" data-res="aprobada" data-id="' + p.id + '"' + (busy ? ' disabled' : '') + '><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' + (busy ? 'Guardando…' : 'Aprobar') + '</button><button class="tc-btn tc-b-red" data-ic="✕" title="Rechazar" data-res="rechazada" data-id="' + p.id + '"' + (busy ? ' disabled' : '') + '><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>Rechazar</button>'
      : '<button class="tc-btn tc-b-soft" data-ic="↺" title="Volver a pendiente" data-res="pendiente" data-id="' + p.id + '"' + (busy ? ' disabled' : '') + '><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/></svg>Volver a pendiente</button>';
    return '<div class="tc-pcard ' + p.estado + (abierto ? ' tc-abierta' : '') + (nueva ? ' tc-entra' : '') + '">' +
      '<div class="tc-ph"><span class="tc-cod">' + (p.cot_numero ? 'CO' + esc(p.cot_numero) : '#' + p.id) + '</span><span class="tc-ava">' + esc(String(p.cliente || '?').trim().charAt(0).toUpperCase()) + '</span><div><h3>' + esc(p.cliente) + '</h3><small class="tc-num">#' + p.id + '</small><span class="tc-sub">' + esc(p.contacto) + ' · ' + fecha(p.creado) + '</span></div><span class="tc-badge ' + p.estado + '">' + esc(p.estado) + '</span></div>' +
      '<dl class="tc-pdl"><div><dt>Prendas</dt><dd>' + p.prendas + '</dd></div><div><dt>Teléfono</dt><dd>' + esc(p.telefono) + '</dd></div><div><dt>Cotización</dt><dd>' + (p.cot_numero ? 'N° ' + esc(p.cot_numero) : '—') + '</dd></div><div><dt>Club</dt><dd>' + esc(p.cliente) + '</dd></div></dl>' +
      '<div class="tc-estado"><span class="tc-pill ' + p.estado + '">' + esc(p.estado.charAt(0).toUpperCase() + p.estado.slice(1)) + (p.cot_estado ? ' · ' + esc(COT[p.cot_estado] || p.cot_estado).replace('…', '') : '') + '</span></div>' + (((p.lineas || [])[0]) ? '<div class="tc-refb"><div><small>REFERENCIA</small><b>' + esc(p.lineas[0].referencia) + (p.lineas.length > 1 ? ' +' + (p.lineas.length - 1) : '') + '</b><small>TELA</small><em>' + esc(p.lineas[0].tela || '—') + '</em></div><div class="tc-cant"><small>CANTIDAD</small><b>' + p.prendas + '</b> <span>und.</span></div></div>' : '') + '<div class="tc-mini"><span>👕 ' + p.prendas + ' prendas</span>' + (p.cot_numero ? '<span>🧾 Cot. ' + esc(p.cot_numero) + '</span>' : '') + '<span>🗓 ' + fecha(p.creado) + '</span>' + (p.contacto ? '<span class="tc-fila-i">👤 ' + esc(p.contacto) + '</span>' : '') + (p.telefono ? '<span class="tc-fila-i">📞 ' + esc(p.telefono) + '</span>' : '') + (p.cot_vendedor ? '<span class="tc-fila-i">💼 Vendedor: ' + esc(p.cot_vendedor) + '</span>' : '') + ((p.lineas || []).length ? '<span class="tc-fila-i">📋 ' + (p.lineas || []).map(l => esc(l.proyecto || l.referencia)).join(', ') + '</span>' : '') + ((p.lineas || []).length ? '<span class="tc-fila-i">🧍 ' + (p.lineas || []).reduce((n, l) => n + (l.jugadores || []).length, 0) + ' jugadores</span>' : '') + (p.notas ? '<span class="tc-fila-i">💬 ' + esc(p.notas) + '</span>' : '') + (p.nota_comercial ? '<span class="tc-fila-i">📝 ' + esc(p.nota_comercial) + '</span>' : '') + '</div>' + barra + cot + nota +
      '<div class="tc-pact">' + pdf + reintento + '<a class="tc-btn tc-b-line" data-ic="⬇" title="Descargar listado" href="/api/club/pedidos/' + p.id + '/excel"><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Descargar listado</a><button class="tc-btn tc-b-line" data-ic="👁" title="Ver detalle" data-ver="' + p.id + '" aria-expanded="' + abierto + '"><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' + (abierto ? 'Ocultar detalle' : 'Ver detalle') + '</button>' + acciones + '<button class="tc-btn tc-b-line" data-ic="🗑" title="Eliminar esta reprogramación" data-eliminar="' + p.id + '"><svg class="tc-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Eliminar</button></div>' +
      (abierto ? detalle(p) : '') + '</div>';
  }

  const coincide = p => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (String(p.cliente) + ' ' + String(p.contacto) + ' ' + String(p.cot_numero || '') + ' #' + p.id).toLowerCase().includes(q);
  };
  const cuenta = k => pedidos.filter(p => !k || p.estado === k).length;

  // Pestaña: solo la tarjeta de reprogramaciones.
  function pintar() {
    if (!panel) return;
    const lista = pedidos.filter(p => ESTADOS_VISIBLES.includes(p.estado) && (!filtro || p.estado === filtro) && coincide(p));   // Pendientes y Rechazadas ocultas por pedido del usuario (2026-11-14): no se borra nada, basta quitarlas de ESTADOS_VISIBLES
    const nuevos = new Set(pedidos.map(p => p.id).filter(id => !vistos.has(id)));
    const html = '<div class="tc">' +
      '<section class="tc-plano"><div class="tc-cabeza"><h2>Reprogramaciones de los clubes</h2><span class="tc-acc">' + '<button class="tc-btn tc-b-lime" data-pedido="nuevo" type="button">EMPEZAR PEDIDO</button></span></div>' +
      (effi ? '<p class="tc-aviso tc-info" style="margin-bottom:12px"><span class="tc-dot ' + (effi.activo && effi.conectado ? 'on' : effi.activo ? 'off' : '') + '"></span><span>EFFITRON · ' + (effi.activo ? (effi.conectado ? 'en línea' : 'SIN CONEXIÓN') : 'apagado') + (effi.ultima ? ' · ' + esc(effi.ultima) : '') + '</span></p>' : '') +
      '<div class="tc-barra"><span></span>' +
      '<input id="tc-buscar" class="tc-buscar" type="search" placeholder="Buscar club, contacto o cotización" autocomplete="off" value="' + esc(busqueda) + '"></div>' +
      (lista.length ? '<div class="tc-cards">' + lista.map(p => tarjeta(p, nuevos.has(p.id) && !primeraCarga)).join('') + '</div>' : (busqueda ? '<div class="tc-vacio">Ninguna reprogramación coincide con la búsqueda.</div>' : '')) +
      htmlProgramados() +
      '</section></div>';
    pedidos.forEach(p => vistos.add(p.id));
    primeraCarga = false;
    if (html === ultimo) return;   // sin cambios: no se redibuja (evita parpadeo)
    // Antes de redibujar guardamos el foco y la posición del cursor para no perder lo que se escribe.
    const act = document.activeElement, idAct = act && act.id, pos = act && act.selectionStart;
    panel.innerHTML = ultimo = html;
    observarTarjetas();
    const destino = idAct && panel.querySelector('#' + idAct);
    if (destino) { destino.focus(); if (pos != null && destino.setSelectionRange) destino.setSelectionRange(pos, pos); }
  }

  // Ventana «Aviso por correo»: a quién le llega el correo con el botón APROBAR REPROGRAMACIÓN. Se dibuja una sola vez al abrirla (no se redibuja mientras se escribe).
  function pintarCorreos() {
    if (!dlg) return;
    dlg.innerHTML = ultimoDlg = '<div class="tc-dlg-cuerpo">' +
      '<div class="tc-dlg-cabeza"><div><span class="eyebrow">TIENDA CLUB</span><h2>Aviso por correo</h2></div><button class="tc-btn tc-b-line" data-cerrar type="button">Cerrar</button></div>' +
      '<p>Cuando un cliente confirma una reprogramación y EFFITRON deja lista su cotización, se envía un correo con el botón <b>APROBAR REPROGRAMACIÓN</b> y la cotización en PDF. Va al comercial dueño de la cotización; si no se sabe cuál es, solo al correo de abajo. Sin ese correo ni comerciales no se envía a nadie.</p>' +
      '<label style="display:grid;gap:5px;font:800 11px Arial;letter-spacing:.1em;color:#c9d3c1">COMERCIALES (uno por línea: NOMBRE : correo)<textarea id="tc-correos" rows="4" spellcheck="false" autocomplete="off" placeholder="NOMBRE APELLIDO : correo@indoor.com" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #3d4c3b;border-radius:12px;background:#142017;color:#f5faef;font:600 14px Arial;outline:none">' + esc(correos.comerciales) + '</textarea></label>' +
      '<label style="display:grid;gap:5px;font:800 11px Arial;letter-spacing:.1em;color:#c9d3c1">SI NO SE SABE QUIÉN ES EL COMERCIAL, ENVIAR A<input id="tc-sin-vendedor" type="text" spellcheck="false" autocomplete="off" placeholder="correo@indoor.com" value="' + esc(correos.sin_vendedor) + '"></label>' +
      '<div class="tc-form"><button class="tc-btn tc-b-lime" id="tc-correos-guardar" type="button">Guardar</button></div></div>';
  }

  let programados = [];
  let produccion = {};   // CO#### -> datos de la orden en Producción (las mismas columnas que usa su tarjeta)
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const esFecha = v => /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(String(v || '').trim());
  // las tarjetas usan EXACTAMENTE el estilo de Producción: se copian sus reglas «body.production-mode …» a «.tc-prog …»
  function copiarEstiloProduccion() {
    if (document.getElementById('tc-progcards-css')) return;
    const out = [];
    const MODO = /(?:production-mode|trace-cards-mode)/; const aqui = sel => sel.replace(/body((?:\.[\w-]+)*\.(?:production-mode|trace-cards-mode)(?:\.[\w-]+)*)/g, '.tc-progcards');   // body.production-mode[.trace-cards-mode…] -> nuestro contenedor
    const recorrer = (reglas, envolver) => { for (const r of Array.from(reglas || [])) {
      if (r.cssRules && r.media) { recorrer(r.cssRules, x => envolver('@media ' + r.media.mediaText + '{' + x + '}')); continue; }
      if (!r.selectorText || !r.style || !MODO.test(r.selectorText)) continue;
      const partes = r.selectorText.split(',').map(x => x.trim()).filter(x => MODO.test(x) && /\.trace-/.test(x));   // solo los selectores de Producción (no se tocan los demás de la misma regla)
      if (partes.length) out.push(envolver(partes.map(aqui).join(',') + '{' + r.style.cssText + '}'));
    } };
    for (const h of Array.from(document.styleSheets)) { try { recorrer(h.cssRules, x => x); } catch (e) { /* hoja de otro dominio */ } }
    const st = document.createElement('style'); st.id = 'tc-progcards-css';
    st.textContent = out.join('\n') + '.tc-progcards .trace-cards{background:transparent!important;padding:0!important;overflow:visible!important}.tc-progcards .trace-media{position:relative}.tc-progcards .tc-disenio{position:absolute;top:10px;left:10px;background:#0d140e;color:#d0f44c;font:900 10px Arial;letter-spacing:.1em;padding:4px 9px;border-radius:12px}' +
      '.tc-progcards .tc-caja{border:1px solid #35403a;border-radius:12px;padding:10px 12px;margin:10px 0;background:#141a16}.tc-progcards .tc-caja small{display:block;font:800 10px Arial;letter-spacing:.1em;color:#9caa95}.tc-progcards .tc-caja b{color:#ecf0e7;font-size:14px}.tc-progcards .tc-tela{color:#d0f44c!important;font-size:12px!important}' +
      '.tc-progcards .tc-dias{display:inline-block;margin-top:4px;padding:3px 10px;border:1px solid #d0f44c;border-radius:12px;color:#d0f44c;font:800 12px Arial}.tc-progcards .tc-dias.tarde{border-color:#ff8f8f;color:#ff8f8f}' +
      '.tc-progcards .tc-ruta{display:flex;gap:4px;margin:10px 0 4px}.tc-progcards .tc-ruta i{flex:1;height:6px;border-radius:3px;background:#2a332c}.tc-progcards .tc-ruta i.finished{background:#9be37a}.tc-progcards .tc-ruta i.active{background:#f3d196}.tc-progcards .tc-ruta i.rework{background:#ff8f8f}' +
      '.tc-progcards .tc-sig{display:flex;justify-content:space-between;font:700 11px Arial;color:#c9d3c1}.tc-progcards .tc-sig b{color:#d0f44c}';
    document.head.appendChild(st);
  }
  function estiloTarjetas() {
    if (document.getElementById('tp-css')) return;
    const st = document.createElement('style'); st.id = 'tp-css';
    st.textContent = `.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));grid-auto-rows:1fr;gap:18px;align-items:stretch}
    .tp-card{display:flex;flex-direction:column;height:100%;min-height:760px;overflow:hidden;border:1px solid #35403a;border-radius:18px;background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(0,0,0,.35));box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:0}
    .tp-card .tp-media{height:380px;flex:none;background:#e9eeea;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;color:#52604f;font:700 12px Arial;text-align:center}
    .tp-card .tp-media img{width:100%;height:100%;object-fit:contain;object-position:center}.tp-card .tp-media .trace-design-view{display:flex;flex-direction:column;width:100%;height:100%}.tp-card .tp-media .trace-design-stage{position:relative;flex:1;min-height:0;display:block}.tp-card .tp-media .trace-design-main{display:block;position:absolute;inset:0}.tp-card .tp-media .trace-design-main img{width:100%;height:100%;object-fit:contain}
    .tp-card .tp-media .trace-design-count{position:absolute;top:8px;left:8px;z-index:3;padding:4px 10px;border-radius:99px;background:#0d140e;color:#d0f44c;font:900 10px Arial;letter-spacing:.08em}.tp-card .tp-media .trace-design-zoom{position:absolute;top:8px;right:8px;z-index:3;color:#52604f}
    .tp-card .tp-media .trace-design-nav{all:unset;cursor:pointer;position:absolute;top:50%;transform:translateY(-50%);z-index:4;box-sizing:border-box;width:34px!important;min-width:34px!important;max-width:34px!important;height:34px!important;border-radius:50%;line-height:1;display:grid;place-items:center;background:rgba(13,20,14,.8);color:#d0f44c;font:900 22px Arial}.tp-card .tp-media .trace-design-nav.is-prev{left:8px}.tp-card .tp-media .trace-design-nav.is-next{right:8px}.tp-card .tp-media .trace-design-nav:hover{background:#d0f44c;color:#0d140e}
    .tp-card .tp-media .trace-design-tabs{display:flex;gap:6px;justify-content:center;padding:6px;background:rgba(13,20,14,.06);flex:none}.tp-card .tp-media .trace-design-tabs button{all:unset;cursor:pointer;min-width:34px;text-align:center;padding:4px 8px;border-radius:99px;border:1px solid #9aa89a;color:#33402f;font:900 11px Arial}.tp-card .tp-media .trace-design-tabs button[aria-pressed=true]{background:#d0f44c;border-color:#8fb30f;color:#0d140e}
    .tp-cuerpo{padding:14px 16px 10px;display:grid;gap:8px;align-content:start;flex:1}
    .tp-cab{display:flex;justify-content:space-between;align-items:center;gap:8px}.tp-cab h3{margin:0;font:900 22px Arial;color:#f5faef;letter-spacing:.02em}
    .tp-linea{padding:4px 12px;border-radius:99px;background:#b9d3f5;color:#16304f;font:700 9px Arial;letter-spacing:.08em}.tp-linea b{font-size:11px;margin-left:4px}
    .tp-cliente{margin:0;font:900 13px Arial;color:#f0f3eb;text-transform:uppercase}.tp-proy{margin:0;font:700 12px Arial;color:#aab6a5}
    .tp-estado{justify-self:start;padding:4px 12px;border-radius:99px;border:1px solid #4d5d4a;background:#243024;color:#c9d3c1;font:700 11px Arial}.tp-estado.active{border-color:#b98e3a;color:#f3d196;background:#3a2f18}.tp-estado.finished{border-color:#3d8a5f;color:#bce4c9;background:#1c3a2c}.tp-estado.late{border-color:#a04040;color:#ffb4b4;background:#3a1c1c}
    .tp-dos{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .tp-caja{all:unset;box-sizing:border-box;cursor:pointer;display:grid;gap:3px;padding:9px 11px;border-radius:12px;border:1px dashed #4d5d4a;background:rgba(0,0,0,.25)}.tp-caja.con{border:1px solid #3d8a5f;background:rgba(61,138,95,.12)}
    .tp-caja small{font:800 9px Arial;letter-spacing:.08em;color:#9caa95}.tp-caja b{font:800 12px Arial;color:#d0f44c}.tp-caja:hover{border-color:#d0f44c}
    .tp-datos{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #35403a;border-radius:12px;background:rgba(0,0,0,.2)}.tp-datos small{display:block;font:800 9px Arial;letter-spacing:.1em;color:#9caa95;margin-top:4px}.tp-datos b{display:block;font:900 13px Arial;color:#ecf0e7}.tp-datos .tp-tela{color:#d0f44c;font-size:12px}.tp-cant{text-align:right}.tp-cant b{display:inline;font-size:22px}
    .tp-entrega{display:flex;align-items:center;gap:8px}.tp-entrega small{font:800 10px Arial;letter-spacing:.1em;color:#9caa95}.tp-dias{padding:4px 14px;border-radius:99px;border:1px solid #d0f44c;background:rgba(208,244,76,.12);color:#d0f44c;font:900 12px Arial}.tp-dias.tarde{border-color:#ff8f8f;color:#ff8f8f;background:rgba(255,143,143,.1)}
    .tp-acc{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px;padding-top:10px;border-top:1px solid rgba(255,255,255,.1)}
    .tp-acc button{all:unset;box-sizing:border-box;cursor:pointer;text-align:center;padding:9px 0;border-radius:10px;border:1px solid #4d5d4a;font:700 15px Arial;color:#e6efdf;background:rgba(0,0,0,.25)}.tp-acc button:disabled{opacity:.4;cursor:default}
    .tp-b-nas{border-color:#3d8a5f!important;background:rgba(61,138,95,.15)!important}.tp-b-edit{border-color:#3d6a9a!important;background:rgba(61,106,154,.15)!important}.tp-b-del{border-color:#a04040!important;background:rgba(160,64,64,.15)!important;color:#ffb4b4!important}
    .tp-extra{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.tp-extra small{font:600 10px Arial;color:#7f8c79}.tp-link{all:unset;cursor:pointer;font:800 10px Arial;letter-spacing:.08em;color:#d0f44c;padding:3px 8px;border:1px solid #4d5d4a;border-radius:99px}
    .tp-ruta{padding:0 16px 14px;display:grid;gap:6px;margin-top:auto}.tp-puntos{display:flex;justify-content:space-between;gap:3px}.tp-puntos i{all:unset;display:grid;place-items:center;flex:1;max-width:22px;height:18px;border-radius:50%;background:#2a332c;color:#c9d3c1;font:900 9px Arial;border:1px solid #3d4c3b}.tp-puntos i.finished{background:#3d8a5f;color:#fff;border-color:#3d8a5f}.tp-puntos i.active{background:#b98e3a;color:#1a1a1a;border-color:#b98e3a}.tp-puntos i.rework{background:#a04040;color:#fff}
    .tp-sig{display:flex;justify-content:space-between;font:700 11px Arial;color:#c9d3c1}.tp-sig b{color:#d0f44c}.tp-barra{height:5px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}.tp-barra span{display:block;height:100%;background:#9be37a;border-radius:inherit}`;
    document.head.appendChild(st);
  }
  // La tarjeta de un pedido programado: el MISMO diseño de la tarjeta de Producción (mockup, orden y línea, cliente, proyecto, estado, MTS, máquina,
  // referencia, tela, cantidad, entrega, ruta de procesos) y sus mismos botones (los atributos data-card-* los atiende el código de Producción)
  // IR A LA NAS: abre la carpeta de la orden en el Explorador/Finder (el mismo enlace que usa Producción)
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-ir-nas]'); if (!n) return;
    toast('Abriendo la carpeta de ' + n.dataset.irNas + ' en tu Explorador…', 'ok');
    window.location.assign('/nas/abrir?order=' + encodeURIComponent(n.dataset.irNas) + '&client=' + encodeURIComponent(n.dataset.cliente || ''));
  });
  // EDITAR / MTS / MÁQUINA: se le pasa el clic a la misma tarjeta de Producción (así abre exactamente la misma ventana)
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-puente]'); if (!b) return;
    if (b.dataset.puente === 'full-edit' && window.traceAbrirEditor) {   // EDITAR abre el mismo editor de Producción directo, aunque la tarjeta no esté visible allá
      b.disabled = true; window.traceAbrirEditor(Number(b.dataset.id)).then(ok => { if (!ok) toast('No encontré esta orden en Producción para editarla. Ábrela desde PRODUCCIÓN.', 'error'); }).finally(() => { b.disabled = false; }); return;
    }
    const real = document.querySelector('.trace-cards [data-card-' + b.dataset.puente + '="' + b.dataset.id + '"]');
    if (real) { real.click(); return; }
    toast('Esta orden no está visible en Producción ahora (revisa los filtros de PRODUCCIÓN). Ábrela desde allí.', 'error');
  });
  function tarjetaPrograma(x) {
    const o = produccion[x.codigo] || null, ids = o && o.filas && o.filas.length ? o.filas : [0];
    return ids.map((id, k) => {
      const f = (o && o.info && o.info[id]) || {};
      const estado = x.estado === 'ERROR' || x.estado === 'REVISAR' ? ['late', 'Error al programar'] : !o ? ['late', x.estado === 'COMPLETADO' ? 'No está en Producción' : 'Programando…'] : o.percent >= 100 ? ['finished', 'Terminado'] : o.focus ? [o.focus.state === 'active' ? 'active' : 'pending', (o.focus.state === 'active' ? 'En ' : 'Pendiente - ') + o.focus.label] : ['pending', 'Programado'];
      const dias = o && o.entrega ? Math.round((o.entrega - new Date().setHours(0, 0, 0, 0)) / 864e5) : null;
      const mts = /MTS/i.test(f.mts || '') ? f.mts.split(/\n|<br>/)[0].trim() : '';
      const ruta = o ? '<div class="tp-ruta"><div class="tp-sig"><span>' + esc(o.focus ? 'Siguiente: ' + o.focus.label : 'Ruta completada') + '</span><b>' + o.percent + '% COMPLETADO</b></div><div class="tp-barra"><span style="width:' + o.percent + '%"></span></div></div>' : '';
      const nasId = ' data-ir-nas="' + esc(x.codigo) + '" data-cliente="' + esc((o && o.cliente) || x.cliente || '') + '"', editId = id ? ' data-puente="full-edit" data-id="' + id + '"' : ' disabled';
      return '<article class="tp-card state-' + estado[0] + '"' + (id ? ' data-card-row="' + id + '"' : '') + '>' +
        '<div class="trace-media tp-media">' + (id ? galeriaHtml(id) : '<span>Sin diseño</span>') + '</div>' +
        '<div class="tp-cuerpo"><div class="tp-cab"><h3>' + esc(x.codigo) + '</h3>' + (f.linea ? '<span class="tp-linea">LÍNEA <b>' + esc(f.linea) + '</b></span>' : '') + '</div>' +
        '<p class="tp-cliente">' + esc((o && o.cliente) || x.cliente || 'Sin cliente') + '</p><p class="tp-proy">' + esc((o && o.proyecto) || x.proyecto || '') + '</p>' +
        '<span class="tp-estado ' + estado[0] + '">' + esc(estado[1]) + '</span>' +

        '<div class="tp-datos"><div><small>REFERENCIA</small><b>' + esc(f.ref || (x.referencias || []).join(', ') || '—') + '</b>' + (f.tela ? '<small>TELA</small><b class="tp-tela">' + esc(f.tela) + '</b>' : '') + '</div>' +
        '<div class="tp-cant"><small>CANTIDAD</small><b>' + (f.units != null ? f.units : (x.prendas || 0)) + '</b> <small>und.</small></div></div>' +
        '<div class="tp-entrega"><small>ENTREGA :</small>' + (dias == null ? '<b>—</b>' : '<span class="tp-dias' + (dias < 0 ? ' tarde' : '') + '">' + (dias < 0 ? 'Atrasado ' + (-dias) + ' días' : dias === 0 ? 'Hoy' : dias + ' Días') + '</span>') + '</div>' +
        '<div class="tp-acc"><button type="button" class="tp-b-nas" title="Ir a la carpeta de la orden en la NAS"' + nasId + '>📁</button><button type="button" class="tp-b-edit" title="Editar / ver en Producción"' + editId + '>✎</button><button type="button" class="tp-b-del" title="Eliminar la orden de todo el panel y la NAS" data-quitar-prog="' + esc(x.codigo) + '">🗑</button></div>' +
        (true ? '<div class="tp-extra"><small>Programó ' + esc(x.usuario || '—') + ' · ' + esc(String(x.fecha || '').replace('T', ' ').slice(0, 16)) + '</small>' + (x.excel ? '<a class="tp-link" href="' + esc(x.excel) + '" title="Descargar el listado">⬇ EXCEL</a>' : '') + (/^CO/.test(x.codigo) ? '<button type="button" class="tp-link" data-pdf-effi="' + esc(x.codigo) + '" title="Pide a EFFITRON el PDF de Effi y lo deja en la carpeta de la orden">📄 PDF EFFI</button>' : '') + '</div>' : '') +
        '</div>' + ruta + '</article>';
    }).join('');
  }
  function htmlProgramados() {
    const q = busqueda.trim().toLowerCase();
    const lista = programados.filter(x => !q || (x.codigo + ' ' + x.cliente + ' ' + x.proyecto).toLowerCase().includes(q));
    if (!lista.length) return '';
    estiloTarjetas();
    return '<h3 style="margin:18px 0 10px;font:900 12px Arial;letter-spacing:.14em;color:#d0f44c">PEDIDOS PROGRAMADOS <em class="tc-n">' + lista.length + '</em></h3><div class="tc-progcards"><div class="tp-grid">' +
      lista.slice(0, 60).map(x => tarjetaPrograma(x)).join('') + '</div></div>';
  }
  function fechaDe(v) { const m = String(v || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); if (!m) return null; return m[1] ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(+(m[6].length === 2 ? '20' + m[6] : m[6]), m[5] - 1, +m[4]); }
  function cargarProduccion() {   // el cálculo lo hace el servidor (x.prod); aquí solo se adapta a lo que dibuja la tarjeta
    const out = {};
    programados.forEach(x => {
      const p = x.prod; if (!p) return;
      const info = {}; p.filas.forEach(f => { info[f.id] = f; });
      out[x.codigo] = { orden: x.codigo, filas: p.filas.map(f => f.id), info, cliente: p.cliente, proyecto: p.proyecto, entrega: fechaDe(p.entrega), percent: p.percent, focus: p.focus };
    });
    produccion = out;
  }
  const galerias = new Map();   // id de fila -> {imgs, i} ; las imágenes se piden solo cuando la tarjeta se ve
  function galeriaHtml(id) {
    const g = galerias.get(id);
    if (!g) return '<span>Buscando diseño…</span>';
    if (!g.imgs.length) return '<div class="trace-no-design"><span aria-hidden="true">◇</span><strong>Sin diseño adjunto</strong></div>';
    const n = g.imgs.length, i = Math.min(g.i || 0, n - 1), c = g.imgs[i];
    return '<div class="trace-design-view"><div class="trace-design-stage"><a class="trace-design-main" href="' + esc(c.url) + '" target="_blank" rel="noopener"><img loading="lazy" decoding="async" src="' + esc(c.url) + '" alt=""></a><span class="trace-design-count">DISEÑO ' + (c.design || i + 1) + (n > 1 ? ' <small>· ' + (i + 1) + '/' + n + '</small>' : '') + '</span>' +
      (n > 1 ? '<button type="button" class="trace-design-nav is-prev" data-gal="' + id + '" data-gi="' + ((i - 1 + n) % n) + '">‹</button><button type="button" class="trace-design-nav is-next" data-gal="' + id + '" data-gi="' + ((i + 1) % n) + '">›</button>' : '') +
      '</div><div class="trace-design-tabs">' + g.imgs.map((m, k) => '<button type="button" data-gal="' + id + '" data-gi="' + k + '" aria-pressed="' + (k === i) + '">D' + (m.design || k + 1) + '</button>').join('') + '</div></div>';
  }
  function pintarGaleria(id) { document.querySelectorAll('.tp-card[data-card-row="' + id + '"] .tp-media').forEach(m => { m.innerHTML = galeriaHtml(id); }); }
  const observador = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; observador.unobserve(e.target);
    const id = Number(e.target.dataset.cardRow); if (!id || galerias.has(id)) return;
    fetch('/api/produccion/fila/' + id + '/archivos', { credentials: 'same-origin' }).then(r => r.json()).then(d => { galerias.set(id, { imgs: d.images || [], i: 0 }); pintarGaleria(id); }).catch(() => { galerias.set(id, { imgs: [], i: 0 }); pintarGaleria(id); });
  }), { rootMargin: '200px' }) : null;
  function observarTarjetas() { document.querySelectorAll('.tp-card[data-card-row]').forEach(c => { const id = Number(c.dataset.cardRow); if (galerias.has(id)) pintarGaleria(id); else if (observador) observador.observe(c); }); }
  document.addEventListener('click', e => {
    const b = e.target.closest('.tp-card [data-gal]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const id = Number(b.dataset.gal), g = galerias.get(id); if (!g) return; g.i = Number(b.dataset.gi); pintarGaleria(id);
  }, true);
  function pedirClave(titulo, texto, accion) {   // contraseña en un cuadro propio (nunca en un prompt()): al ponerla empieza a eliminar AQUÍ MISMO, con avance y errores dentro de la ventana
    return new Promise(res => {
      const f = document.createElement('div'); f.className = 'ax-fondo';
      f.innerHTML = '<div class="ax-card" style="max-width:460px"><div class="ax-cab"><div><span class="ax-eye">ELIMINAR DE PRODUCCIÓN</span><h3>' + esc(titulo) + '</h3></div></div><p class="ax-p">' + texto + '</p>' +
        '<input type="text" data-clave name="c' + Math.random().toString(36).slice(2) + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="Tu contraseña del panel" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #3d4c3b;background:#0d140e;color:#f5faef;font:700 14px Arial;-webkit-text-security:disc;text-security:disc">' +
        '<p data-estado style="margin:10px 0 0;font:800 12px/1.4 Arial;min-height:16px"></p>' +
        '<div class="ax-btns" style="margin-top:8px;justify-content:flex-end"><button class="ax-btn" type="button" data-no>CANCELAR</button><button class="ax-btn" type="button" data-si style="background:#7a2a2a;color:#fff;border-color:#a33">ELIMINAR</button></div></div>';
      document.body.appendChild(f);
      const inp = f.querySelector('[data-clave]'), est = f.querySelector('[data-estado]'), si = f.querySelector('[data-si]'), no = f.querySelector('[data-no]'); let ocupado = false;
      const buscador = document.getElementById('tc-buscar'), antes = buscador ? buscador.value : '';   // el navegador no debe pegar nada en el buscador de la lista
      const cerrar = v => { f.remove(); const b2 = document.getElementById('tc-buscar'); if (b2 && b2.value !== antes) { b2.value = antes; busqueda = antes; pintar(); } res(v); };
      const marca = (t, c) => { est.textContent = t; est.style.color = c; };
      inp.focus();
      const eliminar = async () => {
        if (ocupado) return;
        if (!inp.value) { marca('Escribe tu contraseña para continuar.', '#ffb547'); inp.focus(); return; }
        ocupado = true; const clave = inp.value; inp.value = ''; inp.disabled = si.disabled = no.disabled = true; si.textContent = 'ELIMINANDO…';
        marca('⏳ Eliminando: tarjetas de Producción, Cartera y carpeta de la NAS… no cierres la página.', '#d0f44c');
        try { await accion(clave); cerrar(true); }
        catch (er) { ocupado = false; inp.disabled = si.disabled = no.disabled = false; si.textContent = 'ELIMINAR'; marca('⚠ ' + (er && er.message ? er.message : 'No se pudo eliminar.'), '#ff9b9b'); inp.focus(); }
      };
      no.onclick = () => { if (!ocupado) cerrar(false); };
      si.onclick = eliminar;
      inp.onkeydown = e => { if (e.key === 'Enter') eliminar(); if (e.key === 'Escape' && !ocupado) cerrar(false); };
    });
  }
  document.addEventListener('click', async e => {
    const sn = e.target.closest('[data-sync-nas]'); if (!sn) return;
    try { sn.disabled = true; const r = await api('/api/pedido-effi/programados/' + encodeURIComponent(sn.dataset.syncNas) + '/sincronizar', 'POST', {}); const det = (r.detalle || []).join('\n'); toast((r.completo ? '✓ ' + sn.dataset.syncNas + ' sincronizada con la NAS.' : '⚠ ' + sn.dataset.syncNas + ' quedó pendiente (se sigue intentando 15 min).') + '\n' + det, r.completo ? 'ok' : 'error'); console.log('Sincronizar ' + sn.dataset.syncNas, det); } catch (er) { toast(er.message, 'error'); } finally { setTimeout(() => { sn.disabled = false; }, 4000); }
  });
  document.addEventListener('click', async e => {   // 📄 PDF EFFI: el servidor (con su acceso a la NAS) pide el PDF a EFFITRON y lo deja en la carpeta de la orden
    const b = e.target.closest('[data-pdf-effi]'); if (!b) return;
    const c = b.dataset.pdfEffi, txt = b.textContent; b.disabled = true; b.textContent = 'Pidiendo…';
    try {
      const r = await api('/api/pedido-effi/programados/' + encodeURIComponent(c) + '/sincronizar', 'POST', {});
      const det = (r.detalle || []).filter(x => /PDF|EFFITRON/i.test(x)).join(' · ') || 'Listo.';
      toast((r.completo ? '✅ ' : '⏳ ') + c + ': ' + det + (r.completo ? '' : ' El servidor sigue intentándolo.'), r.completo ? 'ok' : 'info');
    } catch (er) { toast(er.message, 'error'); }
    b.disabled = false; b.textContent = txt;
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-quitar-prog]'); if (!b) return;
    const c = b.dataset.quitarProg, o = produccion[c], filas = (o && o.filas) || [];
    try {
      if (filas.length) {   // borrado seguro de Producción SOLO de esta orden: sus tarjetas + su carpeta NAS (pide contraseña, deja copia de recuperación)
        if (norm(o.orden) !== c) { toast(c + ' está agrupada con otras órdenes en una misma tarjeta de Producción (' + o.orden + '). Para no borrar las otras, elimínala desde PRODUCCIÓN.', 'error'); return; }
        const pv = await api('/api/produccion/fila/' + filas[0] + '/eliminacion?orden=1');   // la carpeta EXACTA que se va a borrar
        let rb = null;
        const hecho = await pedirClave('Eliminar ' + c, 'Se eliminará <b>solo la orden ' + esc(c) + '</b>: ' + (filas.length > 1 ? 'sus <b>' + filas.length + ' tarjetas</b>' : 'su <b>tarjeta</b>') + ' de Producción, su cotización en <b>Cartera</b> (si no tiene pagos), esta lista y <b>esta carpeta de la NAS</b>:<br><small style="word-break:break-all;color:#d0f44c">' + esc(pv.folder) + '</small><br>Queda una copia de recuperación en el servidor. Ninguna otra orden se toca.', async clave => { rb = await api('/api/produccion/orden/' + encodeURIComponent(c), 'DELETE', { password: clave }); });
        if (!hecho) return;
        b.disabled = true; b.textContent = 'ELIMINANDO…';
        const cp = (rb && rb.cartera && rb.cartera.con_pagos) || []; if (cp.length) toast('La cotización ' + cp.join(', ') + ' sigue en Cartera porque tiene pagos registrados.', 'error');
      } else if (!confirm('¿Eliminar ' + c + '?\n\nNo está en Producción: solo se quita de esta lista.')) return;
      await api('/api/pedido-effi/programados/' + encodeURIComponent(c), 'DELETE');
      programados = programados.filter(x => x.codigo !== c); delete produccion[c]; pintar();
      toast(c + (filas.length ? ' eliminado de Producción, la NAS y Cartera' : ' quitado de la lista'), 'ok');
    } catch (er) { b.disabled = false; b.textContent = '🗑 ELIMINAR'; toast(er.message, 'error'); }
  });
  async function cargar() {
    if (cargando || !panel) return;
    cargando = true;
    try {
      const [p, e, c, pr] = await Promise.all([api('/api/club/pedidos'), api('/api/club/effitron').catch(() => null), api('/api/club/correos').catch(() => null), api('/api/pedido-effi/programados').catch(() => null)]);
      if (pr) programados = pr.programados || [];
      cargarProduccion();
      pedidos = p.pedidos; effi = e; if (c) correos = c; pintar();
    } catch (e) { panel.innerHTML = '<div class="tc"><div class="tc-card"><p>' + esc(e.message) + '</p></div></div>'; ultimo = ''; }
    finally { cargando = false; }
  }


  function iniciar() {
    panel = document.querySelector('.panel[data-panel="club"]');
    if (!panel) return;
    dlg = document.createElement('dialog');
    dlg.className = 'tc-dlg';
    document.body.appendChild(dlg);
    let t = 0;
    dlg.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.cerrar !== undefined) { dlg.close(); return; }
        if (b.id === 'tc-correos-guardar') {
          const d = await api('/api/club/correos', 'PUT', { comerciales: dlg.querySelector('#tc-correos').value, sin_vendedor: dlg.querySelector('#tc-sin-vendedor').value.trim() });
          correos = { ...correos, comerciales: d.comerciales, sin_vendedor: d.sin_vendedor };
          toast('Correos guardados', 'ok'); return;
        }
      } catch (er) { toast(er.message, 'error'); }
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // clic fuera de la tarjeta cierra
    panel.addEventListener('input', e => {
      if (e.target.id === 'tc-buscar') { busqueda = e.target.value; pintar(); }
    });
    panel.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.correos !== undefined) { modoDlg = 'correos'; pintarCorreos(); dlg.showModal(); return; }
        if (b.dataset.cotreint) { await api('/api/club/pedidos/' + b.dataset.cotreint + '/cotizacion/reintentar', 'POST'); aviso = 'Reintentando la cotización…'; toast('Reintentando la cotización…', 'ok'); await cargar(); return; }
        if (b.dataset.eliminar) { const id = b.dataset.eliminar; if (!confirm('¿Eliminar la reprogramación #' + id + '? Desaparece de esta pantalla (no borra la cotización de Effi ni lo ya programado en Producción).')) return; await api('/api/club/pedidos/' + id, 'DELETE'); toast('Reprogramación #' + id + ' eliminada', 'ok'); await cargar(); return; }
        if (b.dataset.filtro !== undefined) { filtro = b.dataset.filtro; pintar(); return; }
        if (b.dataset.ver) { const id = Number(b.dataset.ver); abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); pintar(); return; }
        if (b.dataset.res) {
          const id = Number(b.dataset.id);
          ocupados.add(id); pintar();   // el botón queda bloqueado mientras se guarda
          try {
            await api('/api/club/pedidos/' + id + '/resolver', 'POST', { estado: b.dataset.res });
            const msg = { aprobada: 'Reprogramación #' + id + ' aprobada', rechazada: 'Reprogramación #' + id + ' rechazada', pendiente: 'Reprogramación #' + id + ' vuelta a pendiente' };
            toast(msg[b.dataset.res], b.dataset.res === 'rechazada' ? 'error' : 'ok');
          } finally { ocupados.delete(id); }
          await cargar();
        }
      } catch (er) { toast(er.message, 'error'); pintar(); }
    });
    document.querySelectorAll('.tab[data-kind="club"]').forEach(tab => tab.addEventListener('click', () => cargar()));
    document.addEventListener('click', e => { if (e.target.closest('[data-pedido="nuevo"]')) abrirPedido(); });
    setInterval(() => { if (!document.hidden && panel.classList.contains('active')) cargar(); }, 60000);
  }
  // EMPEZAR PEDIDO: formulario igual al de «Crear cotización» de Effi (pedido-effi.js). Crea la cotización o la remisión de venta en Effi (solo si la cuenta Indoor Sport lo tiene ENCENDIDO).
  function abrirPedido() {
    document.querySelector('.tc-pedido-fondo')?.remove();
    const f = document.createElement('div');
    f.className = 'tc-pedido-fondo';
    f.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);padding:8px;overflow:auto';
    f.innerHTML = '<div class="tc-pedido-card" style="width:100%;margin:0;box-sizing:border-box;background:#101a12;border:1px solid rgba(230,235,241,.3);border-radius:18px;padding:14px">' +
      '<div class="tc-pedido-cab" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:2px 4px 8px"><div><span class="eyebrow">PROGRAMAR CLUB</span><h2 style="margin:4px 0 0;font:900 18px Arial;color:#f4f7fa">Empezar pedido</h2></div><div class="tc-ptabs" role="tablist"><button type="button" role="tab" data-ptab="doc" class="on">CO/RM</button><button type="button" role="tab" data-ptab="listado">LISTADO</button></div><button type="button" class="tc-btn tc-b-line" data-cerrar-pedido>Cerrar</button></div>' +
      '<div data-pedido-effi></div></div>';
    document.body.appendChild(f);
    f.addEventListener('click', e => { if (e.target.closest('[data-cerrar-pedido]')) f.remove(); });   // solo con el botón Cerrar: un clic fuera no debe perder un pedido a medio llenar
    const caja = f.querySelector('[data-pedido-effi]');
    // pestañas CO/RM (la cotización o remisión) y LISTADO
    const marcarTab = () => { const p = window.PedidoListado && window.PedidoListado.activo && window.PedidoListado.activo(); const lst = p === 'listado' || p === 'mockups' || p === 'enviado'; f.querySelectorAll('[data-ptab]').forEach(b => b.classList.toggle('on', (b.dataset.ptab === 'listado') === lst)); };
    new MutationObserver(marcarTab).observe(caja, { childList: true, subtree: true });
    f.addEventListener('click', e => {
      const b = e.target.closest('[data-ptab]'); if (!b) return;
      const PL = window.PedidoListado, PE = window.PedidoEffi, hay = PL && PL.activo && PL.activo(), previo = hay && PL.previo && PL.previo();
      if (previo) { if (b.dataset.ptab === 'doc' && PE.volverAlFormulario) PE.volverAlFormulario(); marcarTab(); return; }   // listado previo -> vuelve al formulario guardando lo llenado
      if (!hay) { if (b.dataset.ptab === 'listado' && PE && PE.listadoPrevio && !PE.listadoPrevio()) { toast('Para llenar el LISTADO primero agrega al menos un artículo en Conceptos (el listado se arma por referencia y cantidad).', 'error'); const r = caja.querySelector('[data-f="ref"]'); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.focus(); r.classList.add('pe-falta'); } } marcarTab(); return; }   // aún sin documento: listado PREVIO
      PL.ir(b.dataset.ptab); marcarTab();
    });
    if (window.PedidoEffi) window.PedidoEffi.montar(caja);
    else caja.innerHTML = '<p style="color:#ffb4a2;font:700 13px Arial">No cargó el formulario. Recarga la página con Ctrl+F5.</p>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
