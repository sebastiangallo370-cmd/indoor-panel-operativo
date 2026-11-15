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
  .panel[data-panel="club"]{position:relative}
  .tc .tc-aviso.tc-info{display:inline-flex!important;align-items:center;gap:8px;width:auto!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;font-size:13px}
  @media (min-width:900px){.tc>*{width:calc(100vw - 64px)!important;max-width:none!important;box-sizing:border-box}}
  @media (min-width:900px){.tc-plano .tc-cabeza{width:calc(100vw - 64px);justify-content:space-between;flex-wrap:nowrap}.tc-plano .tc-cabeza .tc-acc{margin-left:auto;flex-wrap:nowrap}}
  .panel[data-panel="club"]{background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.panel[data-panel="club"]::before,.panel[data-panel="club"]::after{display:none!important}   /* sin recuadro: los botones quedan flotando sobre el fondo */
  .tc-plano{overflow:visible!important;padding:4px 0!important;border:0!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important}
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
  .tc-toast{padding:12px 16px;border-radius:14px;background:#1d2a1d;border:1px solid rgba(208,244,76,.35);color:#f5faef;font:700 14px Arial;box-shadow:0 12px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(12px);transition:opacity .25s ease,transform .25s ease;text-align:center}
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
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 3200);
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
      '<section class="tc-card tc-plano"><div class="tc-cabeza"><h2>Reprogramaciones de los clubes</h2><span class="tc-acc"><button class="tc-btn tc-b-lime" data-pedido="nuevo" type="button">EMPEZAR PEDIDO</button><button class="tc-btn tc-b-line" data-agente-excel type="button" title="Descarga e instala el agente que llena el listado en tu Excel">💻 AGENTE EXCEL</button><button class="tc-btn tc-b-line" data-correos type="button" title="A quién le llega el correo con el botón APROBAR REPROGRAMACIÓN">✉ Aviso por correo</button></span></div>' +
      (effi ? '<p class="tc-aviso tc-info" style="margin-bottom:12px"><span class="tc-dot ' + (effi.activo && effi.conectado ? 'on' : effi.activo ? 'off' : '') + '"></span><span>EFFITRON · ' + (effi.activo ? (effi.conectado ? 'en línea' : 'SIN CONEXIÓN') : 'apagado') + (effi.ultima ? ' · ' + esc(effi.ultima) : '') + '</span></p>' : '') +
      '<div class="tc-barra"><div class="tc-chips" role="group" aria-label="Filtrar reprogramaciones">' + [['pendiente', 'Pendientes'], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas']].filter(([k]) => ESTADOS_VISIBLES.includes(k)).map(([k, t]) => '<button type="button" data-filtro="' + k + '" aria-pressed="' + (filtro === k) + '" class="' + (filtro === k ? 'on' : '') + '">' + t + ' <em class="tc-n">' + cuenta(k) + '</em></button>').join('') + '</div>' +
      '<input id="tc-buscar" class="tc-buscar" type="search" placeholder="Buscar club, contacto o cotización" autocomplete="off" value="' + esc(busqueda) + '"></div>' +
      (lista.length ? '<div class="tc-cards">' + lista.map(p => tarjeta(p, nuevos.has(p.id) && !primeraCarga)).join('') + '</div>' : (busqueda ? '<div class="tc-vacio">Ninguna reprogramación coincide con la búsqueda.</div>' : '')) +
      '<p style="margin-top:14px;color:#a9b5a3;font:500 13px/1.5 Arial">El Excel usa la plantilla de listado de Indoor (una hoja con el nombre de la referencia; si son varias referencias, vienen en un .zip) y trae la tela del pedido anterior con su código. Si una tela aparece con varios códigos (colores), elige el correcto antes de programar.</p></section></div>';
    pedidos.forEach(p => vistos.add(p.id));
    primeraCarga = false;
    if (html === ultimo) return;   // sin cambios: no se redibuja (evita parpadeo)
    // Antes de redibujar guardamos el foco y la posición del cursor para no perder lo que se escribe.
    const act = document.activeElement, idAct = act && act.id, pos = act && act.selectionStart;
    panel.innerHTML = ultimo = html;
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

  async function cargar() {
    if (cargando || !panel) return;
    cargando = true;
    try {
      const [p, e, c] = await Promise.all([api('/api/club/pedidos'), api('/api/club/effitron').catch(() => null), api('/api/club/correos').catch(() => null)]);
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
    document.addEventListener('click', e => { if (e.target.closest('[data-pedido="nuevo"]')) abrirPedido(); if (e.target.closest('[data-agente-excel]')) abrirAgenteExcel(); });
    setInterval(() => { if (!document.hidden && panel.classList.contains('active')) cargar(); }, 30000);
  }
  // EMPEZAR PEDIDO: formulario igual al de «Crear cotización» de Effi (pedido-effi.js). Crea la cotización o la remisión de venta en Effi (solo si la cuenta Indoor Sport lo tiene ENCENDIDO).
  // ---- AGENTE EXCEL: descargar, instalar y vincular (una vez por computador). El agente llena el listado en el Excel del PC a la vista.
  function abrirAgenteExcel() {
    document.querySelector('.ax-fondo')?.remove();
    const f = document.createElement('div'); f.className = 'ax-fondo';
    f.innerHTML = '<div class="ax-card"><div class="ax-cab"><div><span class="ax-eye">PROGRAMAR CLUB</span><h3>💻 Agente Excel</h3></div><button class="ax-x" type="button" data-ax-cerrar>CERRAR ✕</button></div>' +
      '<p class="ax-p">Con el agente instalado, al pulsar <b>PROGRAMAR PEDIDO</b> se abre Microsoft Excel en tu computador y el listado se llena solo, a la vista (encabezado, filas y mockups). Se instala una sola vez. Necesitas Excel de escritorio con licencia.</p>' +
      '<div class="ax-estado" data-ax-estado>Consultando tu agente…</div>' +
      '<div class="ax-pasos"><div class="ax-paso"><b>1 · Descarga e instala</b><div class="ax-btns"><a class="ax-btn" data-ax-win href="#" rel="noopener">⬇ WINDOWS</a><a class="ax-btn" data-ax-mac href="#" rel="noopener">⬇ MAC</a></div>' +
      '<small><b>Windows:</b> descomprime y abre <i>AgenteExcelIndoor.exe</i>. Si aparece «Windows protegió su PC»: <i>Más información → Ejecutar de todas formas</i>.<br><b>Mac:</b> descomprime, arrastra <i>AgenteExcelIndoor</i> a Aplicaciones y la primera vez ábrelo con <i>clic derecho → Abrir</i>. Cuando pregunte, permite que controle Microsoft Excel (Ajustes → Privacidad y seguridad → Automatización).</small></div>' +
      '<div class="ax-paso"><b>2 · Vincula este computador con tu usuario</b><div class="ax-btns"><button class="ax-btn lime" type="button" data-ax-codigo>GENERAR CÓDIGO</button></div><div class="ax-codigo" data-ax-ver hidden></div><small>El agente te pedirá este código la primera vez. Sirve 10 minutos.</small></div>' +
      '<div class="ax-paso"><b>▶ Ver cómo se llena Excel</b><div class="ax-btns"><input data-ax-pedido placeholder="CO6379" style="width:110px;padding:8px;border-radius:8px;border:1px solid #3d4c3b;background:#0d140e;color:#e8f0e0;font:700 13px Arial;text-transform:uppercase"><button class="ax-btn lime" type="button" data-ax-abrir>ABRIR EN EXCEL</button></div><small data-ax-abrir-estado>Escribe un pedido ya programado: Excel se abre en este computador y se llena solo, a la vista.</small></div>' +
      '<div class="ax-paso"><b>3 · Listo</b><small>El agente arranca solo al prender el computador. Cuando diga «Conectado», programa un pedido y mira tu Excel.</small></div></div></div>';
    document.body.appendChild(f);
    const cierra = () => { clearInterval(f._t); f.remove(); };
    f.querySelector('[data-ax-cerrar]').onclick = cierra; f.addEventListener('click', e => { if (e.target === f) cierra(); });
    const pintar = async () => {
      if (!f.isConnected) return;
      try {
        const r = await api('/api/agente-excel/estado');
        f.querySelector('[data-ax-win]').href = r.descargas.windows; f.querySelector('[data-ax-mac]').href = r.descargas.mac;
        const e = f.querySelector('[data-ax-estado]');
        e.className = 'ax-estado ' + (r.conectado ? 'ok' : '');
        e.innerHTML = r.equipos.length ? r.equipos.map(x => '<div>' + (x.conectado ? '🟢 Conectado' : '⚪ Desconectado') + ' · <b>' + esc(x.equipo || 'equipo') + '</b> (' + esc(x.so || '') + (x.version ? ' · v' + esc(x.version) : '') + ')' + (x.conectado ? '' : x.visto_hace != null ? ' · visto hace ' + Math.round(x.visto_hace / 60) + ' min' : '') + '</div>').join('') : 'Aún no tienes ningún computador vinculado.';
      } catch (er) { f.querySelector('[data-ax-estado]').textContent = er.message; }
    };
    f.querySelector('[data-ax-codigo]').onclick = async () => {
      try {
        const r = await api('/api/agente-excel/codigo', 'POST', {}); const v = f.querySelector('[data-ax-ver]'); v.hidden = false;
        let resta = r.vence_seg; v.innerHTML = '<span>' + esc(r.codigo) + '</span><small data-ax-resta></small>';
        clearInterval(v._t); v._t = setInterval(() => { resta--; const z = v.querySelector('[data-ax-resta]'); if (z) z.textContent = resta > 0 ? 'vence en ' + Math.floor(resta / 60) + ':' + String(resta % 60).padStart(2, '0') : 'venció: genera otro'; if (resta <= 0) clearInterval(v._t); }, 1000);
      } catch (er) { toast(er.message, 'error'); }
    };
    f.querySelector('[data-ax-abrir]').onclick = async () => {
      const c = f.querySelector('[data-ax-pedido]').value.trim().toUpperCase(), z = f.querySelector('[data-ax-abrir-estado]');
      if (!c) { z.textContent = 'Escribe el pedido, por ejemplo CO6379.'; return; }
      try {
        const r = await api('/api/agente-excel/abrir/' + encodeURIComponent(c), 'POST', {}); z.textContent = 'Enviado a tu agente: mira tu Excel…';
        clearInterval(f._a); f._a = setInterval(async () => { try { const a = await api('/api/agente-excel/trabajo/' + r.trabajo); z.textContent = (a.estado === 'listo' ? '✅ ' : a.estado === 'error' ? '⚠️ ' : '💻 ') + (a.detalle || a.estado); if (['listo', 'error'].includes(a.estado) || !f.isConnected) clearInterval(f._a); } catch (e) { clearInterval(f._a); } }, 2000);
      } catch (er) { z.textContent = '⚠️ ' + er.message; }
    };
    pintar(); f._t = setInterval(pintar, 4000);
  }
  function abrirPedido() {
    document.querySelector('.tc-pedido-fondo')?.remove();
    const f = document.createElement('div');
    f.className = 'tc-pedido-fondo';
    f.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);padding:8px;overflow:auto';
    f.innerHTML = '<div class="tc-pedido-card" style="width:100%;margin:0;box-sizing:border-box;background:#101a12;border:1px solid rgba(230,235,241,.3);border-radius:18px;padding:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:2px 4px 8px"><div><span class="eyebrow">PROGRAMAR CLUB</span><h2 style="margin:4px 0 0;font:900 18px Arial;color:#f4f7fa">Empezar pedido</h2></div><button type="button" class="tc-btn tc-b-line" data-cerrar-pedido>Cerrar</button></div>' +
      '<div data-pedido-effi></div></div>';
    document.body.appendChild(f);
    f.addEventListener('click', e => { if (e.target.closest('[data-cerrar-pedido]')) f.remove(); });   // solo con el botón Cerrar: un clic fuera no debe perder un pedido a medio llenar
    const caja = f.querySelector('[data-pedido-effi]');
    if (window.PedidoEffi) window.PedidoEffi.montar(caja);
    else caja.innerHTML = '<p style="color:#ffb4a2;font:700 13px Arial">No cargó el formulario. Recarga la página con Ctrl+F5.</p>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
