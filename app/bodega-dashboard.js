// Panel de control de Stock tela: estadísticas en tarjetas con el mismo estilo de Inventarios.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const num = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
  // Pinta solo si el contenido cambió: redibujar lo mismo cada minuto reinicia animaciones y hace parpadear las tarjetas.
  const poner = (el, html) => { if (!el || el.__h === html) return false; el.__h = html; el.innerHTML = html; return true; };
  const rolls = n => num(n) + (Number(n) === 1 ? ' rollo' : ' rollos');
  const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const day = value => { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; const date = new Date(value); return isNaN(date) ? '' : date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); };
  const shortDay = value => { const date = value ? new Date(value + 'T12:00:00') : null; return date && !isNaN(date) ? date.toLocaleDateString('es-CO', {day: 'numeric', month: 'short', year: 'numeric'}) : ''; };
  const when = value => { if (!value) return 'sin fecha'; const date = new Date(value); return isNaN(date) ? 'sin fecha' : date.toLocaleString('es-CO', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}); };

  const style = document.createElement('style');
  style.textContent = `
.bd{display:grid;gap:22px;width:100%;padding-bottom:40px}
.bd [hidden]{display:none!important}
.bd .dash-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:6px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0e130e}
.bd .dash-tabs button{width:auto!important;min-height:0!important;display:inline-flex;align-items:center;gap:7px;padding:9px 16px!important;border:1px solid transparent!important;border-radius:10px!important;background:transparent!important;color:#b9c6b3!important;font:800 .8rem Arial!important;letter-spacing:.03em;cursor:pointer;transition:background .15s,color .15s}
.bd .dash-tabs button:hover{background:rgba(255,255,255,.06)!important;color:#fff!important}
.bd .dash-tabs button.on{background:#d0f44c!important;color:#16200a!important;border-color:#d0f44c!important}
@media(max-width:700px){.bd .dash-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.bd .dash-tabs button{width:100%!important;justify-content:center}}
.bd-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border:1px solid #46563f;border-radius:18px;background:linear-gradient(155deg,#1a2418,#0e140f)}
.bd-head h2{margin:0;font-size:1.05rem;color:#f0f4eb}
.bd-head p{margin:3px 0 0;color:#8a9485;font-size:.72rem}
.bd-refresh{width:auto!important;padding:9px 14px!important;border:1px solid #d0f44c!important;border-radius:9px!important;background:#1d2a14!important;color:#e7ff9a!important;font-weight:850;cursor:pointer}
.bd-section{display:grid;gap:12px}
.bd-section>h3{display:flex;align-items:center;gap:8px;margin:0;color:#d0f44c;font:850 .72rem Arial;letter-spacing:.1em;text-transform:uppercase}
.bd-section>h3 small{color:#8a9485;font-weight:700;letter-spacing:.04em}
.bd-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
.bd-cards.fit{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
@media (max-width:1400px){.bd-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:1100px){.bd-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:800px){.bd-cards,.bd-cards.fit{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bd .inventory-item-card{min-height:0;align-content:start}
.bd .inventory-item-card .inv-name{min-height:0}
.bd .inv-badge{width:max-content;margin-bottom:0}
.bd .inv-badge.bad{background:rgba(255,90,80,.16);color:#ffb3ad}
.bd .inv-badge.warn{background:rgba(255,159,28,.16);color:#ffd9a0}
.bd .inv-badge.ok{background:rgba(121,214,111,.16);color:#c9f7c3}
.bd .ot-cliente-linea{text-overflow:ellipsis}
.bd .inventory-item-card.bad{border-color:#a8433d;background:linear-gradient(155deg,#2a1513,#140c0b)}
.bd .inventory-item-card.bad .inv-total{color:#ff8a80}
.bd .inventory-item-card.bad .inv-unit{color:#ff8a80;font-weight:850;letter-spacing:.03em}
.bd .inv-total small{font-size:.9rem;margin-left:5px;color:#bdc8b8}
.bd .inventory-rolls{display:flex;flex-wrap:wrap;gap:6px}
.bd-meter{height:8px;border-radius:0 4px 4px 0;background:#0b100b;overflow:hidden}
.bd-meter i{display:block;height:100%;background:#a9c93a;border-radius:0 4px 4px 0}
.bd-split{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;background:#0b100b}
.bd-split i{display:block;height:100%;min-width:2px}
.bd-split .n{background:#3a9f55}.bd-split .s{background:repeating-linear-gradient(45deg,#d9772b 0 6px,#b8611f 6px 9px)}
.bd-line{display:flex;justify-content:space-between;gap:10px;color:#bdc8b8;font-size:.74rem}
.bd-line b{color:#f0f4eb;white-space:nowrap}
.bd-tfilters{grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr)) repeat(2,minmax(0,1fr)) auto}
.bd-tfilters select{width:100%;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:9px 11px;font:500 .85rem Arial;outline:none;color-scheme:dark}
@media (max-width:1100px){.bd-tfilters{grid-template-columns:repeat(2,minmax(0,1fr))}.bd-tfilters label:first-child{grid-column:1/-1}}
/* Filtros de tela programada: una sola fila en computador, vidrio, botón alineado */
@media (min-width:1101px){.bd .bd-tfilters{grid-template-columns:minmax(0,2.2fr) repeat(3,minmax(0,1.1fr)) repeat(2,minmax(0,1.15fr)) auto!important}}
.bd .bd-tfilters{padding:14px 16px!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:20px!important;background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02))!important;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 28px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.14)}
.bd .bd-tfilters input,.bd .bd-tfilters select{min-height:42px;border-radius:12px!important;border-color:rgba(255,255,255,.18)!important;background:rgba(8,12,7,.7)!important}
.bd .bd-tfilters input:focus,.bd .bd-tfilters select:focus{border-color:#d0f44c!important;box-shadow:0 0 0 3px rgba(208,244,76,.15)}
.bd .bd-tfilters .bd-clear{min-height:42px;border-radius:12px!important;padding:0 18px!important;background:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.2)!important}
.bd .bd-tfilters .bd-clear:hover{background:rgba(208,244,76,.14)!important;border-color:rgba(208,244,76,.6)!important}
.bd .bd-tcards .inventory-item-card{transition:transform .18s,box-shadow .18s}
.bd .bd-tcards .inventory-item-card:hover{transform:translateY(-3px)}
.bd-note{margin:0;color:#8a9485;font-size:.78rem}
.bd-head-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.bd-switch{display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border:1px solid #46563f;border-radius:12px;background:#151d15;cursor:pointer;user-select:none}
.bd-switch input{position:absolute;opacity:0;width:0;height:0}
.bd-switch-text{display:grid;gap:1px;text-align:right}
.bd-switch-text b{color:#f0f4eb;font:800 .72rem Arial;letter-spacing:.05em;text-transform:uppercase}
.bd-switch-text small{font:700 .66rem Arial;letter-spacing:.04em;color:#ffb3ad}
.bd-switch-track{position:relative;display:block;width:46px;height:26px;border-radius:999px;background:#5a2723;border:1px solid #a8433d;transition:background .2s,border-color .2s}
.bd-switch-dot{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#f0f4eb;transition:transform .2s}
.bd-switch input:checked~.bd-switch-track{background:#2f7a3d;border-color:#79d66f}
.bd-switch input:checked~.bd-switch-track .bd-switch-dot{transform:translateX(20px)}
.bd-switch input:checked~.bd-switch-text small,.bd-switch:has(input:checked) small{color:#9fe0a8}
.bd-switch input:focus-visible~.bd-switch-track{outline:2px solid #d0f44c;outline-offset:2px}
.bd-switch.busy{opacity:.6;pointer-events:none}
.bd-home-sync{display:flex;justify-content:flex-end;margin:0 0 10px}
.bd-filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end;padding:14px 18px;border:1px solid #46563f;border-radius:18px;background:#111811}
.bd-filters label{display:grid;gap:5px;color:#aebba7;font:800 .64rem Arial;letter-spacing:.07em;text-transform:uppercase}
.bd-filters input{width:100%;box-sizing:border-box;border:1px solid #46563f;border-radius:9px;background:#0b100b;color:#fff;padding:9px 11px;font:500 .85rem Arial;outline:none;color-scheme:dark}
.bd-filters input:focus{border-color:#d0f44c}
.bd-clear{padding:9px 14px!important;border:1px solid #46563f!important;border-radius:9px!important;background:#151d15!important;color:#dfe8d9!important;font-weight:800;cursor:pointer;width:auto!important}
.bd-count{grid-column:1/-1;margin:0;color:#8a9485;font-size:.74rem}
.bd-count:empty{display:none}
@media (max-width:900px){.bd-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bd-filters label:first-child{grid-column:1/-1}}
@media (max-width:700px){.bd-cards{min-width:0!important;width:100%;max-width:100%}.bd-section,.bd-body{min-width:0;max-width:100%}.bd-cards>*{min-width:0;max-width:100%;overflow:hidden}.bd,.bd-filters{min-width:0;max-width:100%;box-sizing:border-box}.bd{overflow-x:clip}.bd-filters{padding:12px}.bd-filters label{min-width:0}.bd-filters input,.bd-filters input[type=date]{min-width:0;max-width:100%;width:100%;min-height:42px;font-size:16px;-webkit-appearance:none;appearance:none}.bd-filters input[type=date]{display:block;text-align:left}}
@media (max-width:520px){.bd-head{flex-direction:column;align-items:stretch}.bd-cards,.bd-cards.fit{grid-template-columns:minmax(0,1fr)}.bd-cards{min-width:0!important;width:100%;max-width:100%}.bd-section,.bd-body{min-width:0;max-width:100%}.bd-cards>*{min-width:0;max-width:100%;overflow:hidden}}
.bd .ot{display:flex!important;flex-direction:column;gap:11px;padding:14px 15px 13px!important}
.bd .ot-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bd .ot-head .inv-badge{margin:0;font-size:.62rem!important;padding:3px 10px!important;letter-spacing:.06em}
.bd .ot-fecha{font:800 .62rem Arial;letter-spacing:.05em;text-transform:uppercase;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);white-space:nowrap}
.bd .ot-titulo{display:grid;gap:3px}
.bd .ot-tela{font:900 1.12rem Arial;letter-spacing:.01em;line-height:1.12;overflow-wrap:anywhere}
.bd .ot-ref{font:700 .68rem Arial;letter-spacing:.09em;opacity:.78;overflow-wrap:anywhere}
.bd .ot-identidad{display:grid;gap:3px;padding:2px 0 1px}.bd .ot-identidad b{font:900 .95rem Arial;line-height:1.18;color:#f5f8ef;overflow-wrap:anywhere}.bd .ot-identidad span{font:750 .66rem Arial;letter-spacing:.04em;color:#bdcbb5;overflow-wrap:anywhere;text-transform:uppercase}
.bd .ot-datos{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12)}
.bd .ot-dato{display:grid;gap:2px;min-width:0}.bd .ot-dato small{font:850 .54rem Arial;letter-spacing:.1em;color:#98aa90;text-transform:uppercase}.bd .ot-dato b{font:850 .72rem Arial;color:#edf5e5;overflow-wrap:anywhere}.bd .ot-dato.cantidad{text-align:right}.bd .ot-dato.cantidad b{font-size:.92rem;color:#d5f64d;white-space:nowrap}.bd .ot-dato.cantidad em{font:800 .58rem Arial;font-style:normal;color:#c9d6bf;margin-left:3px}
.bd .ot-tela-label{font:850 .58rem Arial;letter-spacing:.12em;color:#9caf91;text-transform:uppercase;margin:0 0 -5px}
.bd .ot-materiales{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:7px;padding:9px;border-radius:13px;background:rgba(3,8,4,.38);border:1px solid rgba(208,244,76,.16)}
.bd .ot-material{display:grid;gap:3px;min-width:0;padding:7px 8px;border-radius:10px;background:linear-gradient(145deg,rgba(208,244,76,.12),rgba(255,255,255,.035));border-left:3px solid #c9f24a}
.bd .ot-material small{font:850 .57rem Arial;letter-spacing:.1em;text-transform:uppercase;color:#c9f24a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd .ot-material b{font:900 .82rem Arial;color:#fff;letter-spacing:.02em}.bd .ot-material b em{font:800 .56rem Arial;font-style:normal;color:#c7d4bd;margin-left:3px}
.bd .ot-material span{font:700 .58rem Arial;color:#b5c1ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd .ot-sep{height:1px;background:linear-gradient(90deg,rgba(255,255,255,.34),rgba(255,255,255,0))}
.bd .ot-cliente-bloque{display:grid;gap:2px}
.bd .ot-cliente{font:800 .8rem Arial;line-height:1.25;overflow-wrap:anywhere}
.bd .ot-proyecto{font:600 .72rem Arial;opacity:.78;overflow-wrap:anywhere}
.bd .ot-tallas{display:flex;flex-wrap:wrap;gap:5px}
.bd .ot-t{display:inline-flex;align-items:baseline;gap:4px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);font:800 .6rem Arial;letter-spacing:.04em}
.bd .ot-t b{font:900 .72rem Arial}
.bd .ot-tiempo{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:12px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.bd .ot-tiempo>span:last-child{display:grid;gap:1px;min-width:0}
.bd .ot-tiempo b{font:850 .72rem Arial;line-height:1.2}
.bd .ot-tiempo small{font:600 .62rem Arial;opacity:.82;letter-spacing:.02em;line-height:1.3;overflow-wrap:anywhere}
.bd .ot-cambio{font:800 .62rem Arial!important;opacity:1!important}
.bd .ot-cambio.atraso{color:#ffd9a0!important}
.bd .ot-cambio.adelanto{color:#c9f7c3!important}
.bd .ot-reloj{font-size:1rem;line-height:1}
.bd .ot-tiempo.urgente{background:rgba(255,70,50,.28);border-color:rgba(255,160,150,.6)}
.bd .ot-tiempo.pronto{background:rgba(255,176,40,.24);border-color:rgba(255,200,110,.55)}
.bd .ot-tiempo.ya{background:rgba(120,214,111,.20);border-color:rgba(160,230,150,.5)}
.bd .ot-pie{margin-top:auto;display:grid;gap:4px;padding-right:50px;padding-top:2px}
.bd .ot-bodega{font:800 .68rem Arial;letter-spacing:.03em;line-height:1.3;opacity:.95}
.bd .ot-bodega b{font-weight:900}
.bd .ot-bodega.comparte{display:block}.bd .ot-flujo{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:4px 0 2px}.bd .ot-flujo>div{display:grid;gap:1px;padding:6px 8px;border-radius:10px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12);min-width:0}.bd .ot-flujo small{font:800 .52rem Arial;letter-spacing:.08em;text-transform:uppercase;opacity:.7;white-space:nowrap}.bd .ot-flujo b{font:900 .95rem Arial;white-space:nowrap}.bd .ot-flujo b.desc{color:#f3b852!important;-webkit-text-fill-color:#f3b852!important}.bd .ot-flujo b.falta{color:#ff9d8f!important;-webkit-text-fill-color:#ff9d8f!important}.bd .ot-bodega .ot-comparte{display:block;margin-top:3px;font:700 .6rem Arial;letter-spacing:.04em;opacity:.75;text-transform:uppercase}
html body .bd .inventory-item-card .ot-bodega b.hay{color:#7cc9ff!important;-webkit-text-fill-color:#7cc9ff!important}
html body .bd .inventory-item-card .ot-bodega b.queda{color:#d6f55a!important;-webkit-text-fill-color:#d6f55a!important}
html body .bd .inventory-item-card .ot-bodega b.falta{color:#ff9a8f!important;-webkit-text-fill-color:#ff9a8f!important}
.bd .ot-flujo{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:8px 0 4px;padding:0;border-radius:14px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.1);overflow:hidden}
.bd .ot-flujo>div{position:relative;display:grid;gap:3px;padding:9px 12px;border:0!important;border-radius:0!important;background:transparent!important;text-align:left}
.bd .ot-flujo>div+div{border-left:1px solid rgba(255,255,255,.09)!important}
.bd .ot-flujo>div+div::before{position:absolute;left:-7px;top:50%;transform:translateY(-50%);width:14px;height:14px;border-radius:50%;background:#1b2a22;border:1px solid rgba(255,255,255,.14);color:#aebca7;font:800 .6rem/12px Arial;text-align:center}
.bd .ot-flujo>div:nth-child(2)::before{content:"−"}.bd .ot-flujo>div:nth-child(3)::before{content:"="}
.bd .ot-flujo small{font:700 .5rem Arial;letter-spacing:.14em;color:#8fa08a!important;opacity:1}
.bd .ot-flujo b{font:700 .98rem Arial;letter-spacing:.01em}
html body .bd .ot-flujo b.hay{color:#a9cdee!important;-webkit-text-fill-color:#a9cdee!important}
html body .bd .ot-flujo b.desc{color:#e3c084!important;-webkit-text-fill-color:#e3c084!important}
html body .bd .ot-flujo b.queda{color:#cfe58a!important;-webkit-text-fill-color:#cfe58a!important}
html body .bd .ot-flujo b.falta{color:#f0a89d!important;-webkit-text-fill-color:#f0a89d!important}
.bd .ot-flujo{transition:border-color .25s,box-shadow .25s}
.bd .ot-flujo>div{transition:background .25s,transform .25s}
.bd .ot-flujo>div:hover{background:rgba(255,255,255,.05)!important;transform:translateY(-1px)}
.bd .ot-flujo::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.1) 50%,transparent 65%);transform:translateX(-120%);pointer-events:none}
.bd .ot-bodega.comparte{position:relative}.bd .ot-bodega.comparte:hover .ot-flujo::after{animation:otBarrido 1.1s ease}
@keyframes otBarrido{to{transform:translateX(120%)}}
.bd .ot-flujo{position:relative}
.bd .ot-medidor{position:relative;display:flex;height:6px;margin:7px 2px 2px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.bd .ot-medidor i{display:block;height:100%;width:var(--w);transform-origin:left;animation:otLlena .9s cubic-bezier(.2,.8,.2,1) backwards}
.bd .ot-medidor i.q{background:linear-gradient(90deg,#7fa83a,#cfe58a);border-radius:99px 0 0 99px;box-shadow:0 0 10px rgba(207,229,138,.45)}
.bd .ot-medidor i.d{background:linear-gradient(90deg,#d9a848,#f1cf8a);animation-delay:.25s;box-shadow:0 0 10px rgba(241,207,138,.55)}
.bd .ot-medidor i.c{background:linear-gradient(90deg,#d9685a,#f0a89d);border-radius:99px;box-shadow:0 0 10px rgba(240,168,157,.5)}
.bd .ot-medidor::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.35) 50%,transparent 70%);transform:translateX(-120%);animation:otBrilla 3.4s ease-in-out infinite 1.2s}
@keyframes otLlena{from{width:0}}@keyframes otBrilla{55%,100%{transform:translateX(120%)}}
@media(prefers-reduced-motion:reduce){.bd .ot-medidor i,.bd .ot-medidor::after{animation:none}}
.bd .ot-bodega.nuevo{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:4px 14px;align-items:center;margin:10px 0 2px;padding:12px 14px 10px;border-radius:16px;background:linear-gradient(150deg,rgba(255,255,255,.07),rgba(0,0,0,.18));border:1px solid rgba(255,255,255,.1);transition:border-color .25s,transform .25s,box-shadow .25s}
.bd .ot-bodega.nuevo:hover{border-color:rgba(207,229,138,.45);box-shadow:0 8px 22px -10px rgba(207,229,138,.35);transform:translateY(-1px)}
.bd .ot-bodega.nuevo.mal:hover{border-color:rgba(240,168,157,.5);box-shadow:0 8px 22px -10px rgba(240,168,157,.35)}
.bd .ot-hero small,.bd .ot-lado small{display:block;font:700 .5rem Arial;letter-spacing:.16em;color:#8fa08a!important;opacity:1}
.bd .ot-hero>div{display:flex;align-items:baseline;gap:6px;margin-top:2px}
.bd .ot-hero b{font:900 2rem/1 Arial;letter-spacing:-.02em}.bd .ot-hero em{font:800 .65rem Arial;font-style:normal;letter-spacing:.14em;color:#9fb096}
html body .bd .ot-hero b.desc{color:#f1cf8a!important;-webkit-text-fill-color:#f1cf8a!important}
.bd .ot-lado{display:grid;gap:8px;padding-left:14px;border-left:1px solid rgba(255,255,255,.1)}
.bd .ot-lado b{font:800 1rem Arial}
html body .bd .ot-lado b.hay{color:#a9cdee!important;-webkit-text-fill-color:#a9cdee!important}
html body .bd .ot-lado b.queda{color:#cfe58a!important;-webkit-text-fill-color:#cfe58a!important}
html body .bd .ot-lado b.falta{color:#f0a89d!important;-webkit-text-fill-color:#f0a89d!important}
.bd .ot-bodega.nuevo .ot-medidor{grid-column:1/-1;margin:8px 0 0}
.bd .ot:has(.ot-bodega.nuevo) .ot-consumo{display:none}
.bd .ot-dias{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:99px;font:800 .6rem Arial;letter-spacing:.04em;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08)}
.bd .ot-dias.ok{color:#cfe58a;border-color:rgba(207,229,138,.5)}.bd .ot-dias.cerca{color:#ffd98a;border-color:rgba(255,217,138,.6);background:rgba(243,184,82,.14)}.bd .ot-dias.tarde{color:#ffb3ac;border-color:rgba(255,107,97,.7);background:rgba(255,107,97,.16)}
.bd .ot-titulo .ot-tela{font-size:1.15rem}
.bd .ot-consumo{font:900 1.6rem Arial;line-height:1;letter-spacing:-.01em}
.bd .ot-consumo small{font:800 .7rem Arial;margin-left:5px;opacity:.85;letter-spacing:.05em}
.bd .ot-sinprom{font:900 1.15rem Arial;color:#d0f44c!important}
.bd .ot-alerta{font:850 .6rem Arial;letter-spacing:.06em;text-transform:uppercase;line-height:1.3}
.bd .ot.bad .ot-alerta{color:#ffd9d4!important}
/* tarjeta de orden más tranquila: menos color, menos cajas y una sola línea por dato */
.bd .ot.lq{background:radial-gradient(120% 80% at 12% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,color-mix(in srgb,var(--liquid) 36%,transparent),color-mix(in srgb,var(--liquid) 14%,rgba(8,12,8,.72)))!important}
.bd .ot{gap:8px!important;padding:13px 14px 12px!important}
.bd .ot-fecha{background:none!important;border:0!important;padding:0!important;font:700 .62rem Arial!important;letter-spacing:.04em;text-transform:none!important;opacity:.78}
.bd .ot-head .inv-badge{background:rgba(255,255,255,.14)!important;border:0!important}
.bd .ot-tela{font:900 1rem Arial!important}
.bd .ot-ref{font:600 .64rem Arial!important;opacity:.65!important}
.bd .ot-cliente-linea{font:700 .74rem Arial;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd .ot-cliente-linea b{font-weight:800}
.bd .ot-cliente-linea span{opacity:.7;font-weight:600}
.bd .ot-tallas-txt{font:600 .64rem Arial;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em}
.bd .ot-tiempo{background:none!important;border:0!important;box-shadow:none!important;border-left:3px solid #cdeccb!important;border-radius:0!important;padding:1px 0 1px 9px!important;gap:7px!important}
.bd .ot-tiempo.urgente{border-left-color:#ff9d92!important}
.bd .ot-tiempo.pronto{border-left-color:#ffd08a!important}
.bd .ot-tiempo.ya{border-left-color:#9fe3a0!important}
.bd .ot-reloj{display:none}
.bd .ot-tiempo b{font:800 .7rem Arial!important}
.bd .ot-tiempo small{font:600 .6rem Arial!important;opacity:.7!important}
.bd .ot-consumo{font:900 1.4rem Arial!important}
.bd .ot-alerta{font:800 .58rem Arial!important}
.bd .bd-tkpi .lq{background:radial-gradient(120% 80% at 12% 0%,rgba(255,255,255,.14),rgba(255,255,255,0) 55%),linear-gradient(160deg,color-mix(in srgb,var(--liquid) 34%,transparent),color-mix(in srgb,var(--liquid) 13%,rgba(8,12,8,.74)))!important}
.bd .ot.lq,.bd .bd-tkpi .lq{box-shadow:inset 0 1px 0 rgba(255,255,255,.35),inset 0 0 18px rgba(255,255,255,.04),0 8px 22px rgba(0,0,0,.34)!important}
.bd .ot.lq>.lq-wave,.bd .bd-tkpi .lq>.lq-wave{display:none}
/* tarjetas limpias: vidrio sin color (el estado va en el aro de luz) y menos texto */
html body .bd .inventory-item-card.lq,html body .bd .bd-tkpi .lq{background:radial-gradient(120% 80% at 12% 0%,rgba(255,255,255,.15),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.04))!important}
.bd .ot-tiempo,.bd .ot-tiempo.urgente,.bd .ot-tiempo.pronto,.bd .ot-tiempo.ya{border-left:0!important;padding:0!important}
.bd .ot-tiempo b{font:700 .72rem Arial!important;color:#e7eee2}
.bd .ot-tiempo::before{content:"⏱";margin-right:6px;font-size:.8rem;opacity:.85}
.bd .ot{gap:8px!important}
.bd .ot-ref{opacity:.6}
@media (max-width:700px){.bd .ot{padding:12px!important}.bd .ot-pie{padding-right:46px}}
.bd .bd-tcards .inventory-item-card .bd-line{flex-wrap:wrap;align-items:baseline}
.bd .bd-tcards .inventory-item-card .bd-line b{white-space:normal;text-align:right;overflow-wrap:anywhere;min-width:0;margin-left:auto}
/* Tela programada: diseño de ficha operativa. La tarjeta deja de ser una tarjeta de inventario
   y muestra primero quién es el pedido, después sus datos y al final cada tela a programar. */
.bd .bd-tcards{grid-template-columns:repeat(auto-fill,minmax(390px,1fr))!important;grid-auto-rows:560px;gap:18px!important;align-items:stretch}
.bd .bd-tcards .ot{position:relative;display:grid!important;gap:0!important;padding:0!important;overflow:hidden;min-height:0;border:1px solid rgba(129,218,142,.48)!important;border-radius:18px!important;background:linear-gradient(155deg,#18241d,#0c120e)!important;box-shadow:0 12px 28px rgba(0,0,0,.28)!important}
.bd .bd-tcards .ot.bad{border-color:rgba(245,121,108,.72)!important;background:linear-gradient(155deg,#261817,#100b0b)!important}
.bd .bd-tcards .ot>.lq-wave{display:none!important}
.bd .bd-tcards .ot-head{order:0;padding:10px 13px;background:rgba(0,0,0,.28);border-bottom:1px solid rgba(255,255,255,.09)}
.bd .bd-tcards .ot-head .inv-badge{padding:4px 9px!important;border-radius:7px!important;background:#d3f64b!important;color:#17220d!important;font:900 .64rem Arial!important;letter-spacing:.08em!important}
.bd .bd-tcards .ot.bad .ot-head .inv-badge{background:#ffb4a9!important;color:#36100c!important}
.bd .bd-tcards .ot-fecha{padding:4px 0!important;color:#c3d0bf!important;font:750 .61rem Arial!important;opacity:1!important}
.bd .bd-tcards .ot-identidad{order:1;gap:3px;padding:16px 15px 11px!important;background:linear-gradient(100deg,rgba(208,244,76,.13),transparent 68%)}
.bd .bd-tcards .ot-identidad::before{content:"CLIENTE";font:800 .52rem Arial;letter-spacing:.15em;color:#b7c99d}
.bd .bd-tcards .ot-identidad b{font:900 1rem/1.2 Arial!important;color:#fff!important;text-transform:uppercase}
.bd .bd-tcards .ot-identidad span{font:750 .67rem Arial!important;color:#d7e4d2!important;letter-spacing:.03em!important}
.bd .bd-tcards .ot-datos{order:2;grid-template-columns:1fr 1.2fr .62fr;gap:0;margin:0 15px;padding:0!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:11px!important;background:rgba(2,7,3,.3)!important;overflow:hidden}
.bd .bd-tcards .ot-dato{min-height:54px;padding:9px 8px;align-content:center}.bd .bd-tcards .ot-dato+.ot-dato{border-left:1px solid rgba(255,255,255,.1)}
.bd .bd-tcards .ot-dato small{font:800 .5rem Arial!important;letter-spacing:.12em!important;color:#9faf96!important}.bd .bd-tcards .ot-dato b{font:850 .68rem Arial!important;color:#f3f7ed!important;line-height:1.22}.bd .bd-tcards .ot-dato.cantidad b{font-size:1rem!important;color:#d6f64b!important}.bd .bd-tcards .ot-dato.cantidad em{display:block;margin:1px 0 0!important;font-size:.5rem!important}
.bd .bd-tcards .ot-programa{order:3;display:grid;gap:8px;margin:14px 15px 0;padding:11px;border-radius:12px;background:#101a10;border:1px solid rgba(208,244,76,.25)}
.bd .bd-tcards .ot-programa-titulo{display:flex;justify-content:space-between;gap:8px;color:#d7f64c;font:900 .58rem Arial;letter-spacing:.12em}.bd .bd-tcards .ot-programa-titulo span{color:#98aa90;font-weight:800}
.bd .bd-tcards .ot-materiales{display:grid;gap:6px;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
.bd .bd-tcards .ot-material{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:8px 7px!important;border:0!important;border-left:3px solid #c9f24a!important;border-radius:6px!important;background:rgba(255,255,255,.055)!important}
.bd .bd-tcards .ot-material small{grid-row:1 / span 2;color:#e5f99c!important;font:900 .57rem Arial!important;letter-spacing:.08em!important;white-space:nowrap}.bd .bd-tcards .ot-material span{grid-column:2;grid-row:1;font:700 .59rem Arial!important;color:#c9d5c2!important}.bd .bd-tcards .ot-material b{grid-column:3;grid-row:1 / span 2;font:900 .9rem Arial!important;color:#fff!important}.bd .bd-tcards .ot-material b em{font-size:.5rem!important}
.bd .bd-tcards .ot-tiempo{order:4;margin:11px 15px 0!important;padding:0!important;background:transparent!important}.bd .bd-tcards .ot-tiempo b{font-size:.66rem!important;color:#cbd7c5!important}.bd .bd-tcards .ot-tiempo::before{color:#d7f64c}
.bd .bd-tcards .ot-bodega.nuevo{order:5;margin:13px 15px 14px!important;border-radius:11px!important}.bd .bd-tcards .ot-pie{display:none!important}
@media(max-width:700px){.bd .bd-tcards{grid-template-columns:1fr!important;gap:12px!important}.bd .bd-tcards .ot-datos{margin:0 12px}.bd .bd-tcards .ot-identidad{padding-left:12px;padding-right:12px}.bd .bd-tcards .ot-programa,.bd .bd-tcards .ot-tiempo,.bd .bd-tcards .ot-bodega.nuevo{margin-left:12px!important;margin-right:12px!important}}
/* Misma lectura de una tarjeta de Producción: cabecera, cliente/proyecto, MTS y ficha de datos. */
.bd .bd-tcards .ot-production-card{display:block!important;height:100%;min-height:0;padding:0!important;border:1px solid #3a4a40!important;border-radius:16px!important;background:#19231e!important;box-shadow:0 6px 22px #0002!important;overflow:hidden}
.bd .bd-tcards .ot-production-card.bad{border-color:#985452!important;background:#211817!important}
.bd .ot-production-card>.lq-wave{display:none!important}
.bd .ot-production-body{display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto auto auto;gap:0;height:100%;min-height:0;padding:18px 21px!important;box-sizing:border-box;min-width:0}
.bd .ot-production-heading{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:5px}.bd .ot-production-heading h3{margin:0 auto 0 0;color:#f3f6ef;font:700 24px/1.2 Arial;letter-spacing:-.6px}.bd .ot-production-project-chip{display:inline-block;max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 9px;border:1px solid #536459;border-radius:6px;background:#36433b;color:#d3ded6;font:700 10px/1.4 Arial;text-transform:uppercase}.bd .ot-production-card.bad .ot-production-project-chip{background:#5a2927;border-color:#985452;color:#ffd5d0}
.bd .ot-production-client{margin:0 0 13px;color:#eef5ed;font:600 16px/1.35 Arial;overflow-wrap:anywhere}.bd .ot-production-project{display:none}
.bd .ot-production-mts{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #5f9650;border-radius:10px;background:linear-gradient(135deg,#1d351e,#122015)}.bd .ot-production-mts small{display:grid;gap:2px;color:#9eae9b;font:800 9px Arial;letter-spacing:.07em}.bd .ot-production-mts small::after{content:"PLAN DE CONSUMO";color:#d0f44c;font-size:8px}.bd .ot-production-mts strong{color:#d0f44c;font:800 19px Arial;overflow-wrap:anywhere}
.bd .ot-production-fabrics{display:grid;align-content:start;gap:7px;min-height:0;overflow-y:auto;margin:10px 0 14px;padding-right:3px;scrollbar-width:thin;scrollbar-color:#77bd63 transparent}.bd .ot-production-fabrics::-webkit-scrollbar{width:5px}.bd .ot-production-fabrics::-webkit-scrollbar-thumb{border-radius:99px;background:#77bd63}.bd .ot-production-fabric{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:9px 10px;border:1px solid rgba(126,184,205,.14);border-left:3px solid #66c8e4;border-radius:9px;background:linear-gradient(110deg,#13251f,#101914);box-shadow:inset 0 1px rgba(255,255,255,.03)}.bd .ot-production-fabric.no-stock,.bd .ot-production-fabric.insufficient{border-left-color:#f28d82;background:linear-gradient(110deg,#241918,#15100f)}.bd .ot-production-fabric small{color:#c8f24b;font:800 9px Arial;letter-spacing:.08em}.bd .ot-production-fabric span{color:#d8e5da;font:600 12px/1.3 Arial;overflow-wrap:anywhere}.bd .ot-production-fabric>b{grid-column:2;grid-row:1 / span 2;align-self:center;color:#fff;font:800 18px Arial;white-space:nowrap}.bd .ot-production-fabric>b em{font:700 9px Arial;font-style:normal;color:#aebba7;margin-left:3px}.bd .ot-production-fabric .ot-fabric-stock{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px;margin-top:5px}.bd .ot-production-fabric .ot-fabric-stock span{padding:5px 7px;border-radius:5px;background:rgba(255,255,255,.055);font:800 8px Arial;color:#aebca9;text-transform:uppercase}.bd .ot-production-fabric .ot-fabric-stock span:last-child{text-align:right}.bd .ot-production-fabric .ot-fabric-stock b{display:block;color:#d0f44c;font:800 11px Arial;line-height:1.25}.bd .ot-production-fabric .ot-fabric-stock.mal b{color:#ff9c93}.bd .ot-production-fabric .ot-fabric-stock.sin{color:#ffb2aa}.bd .ot-fabric-meter{grid-column:1/-1;height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.1);margin-top:2px}.bd .ot-fabric-meter i{display:block;width:var(--coverage,0%);height:100%;border-radius:inherit;background:linear-gradient(90deg,#a9d943,#d7f64c);transition:width .5s ease}.bd .ot-production-fabric.insufficient .ot-fabric-meter i,.bd .ot-production-fabric.no-stock .ot-fabric-meter i{background:linear-gradient(90deg,#f28d82,#ffb1a8)}
.bd .ot-production-facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:17px 14px;margin:0}.bd .ot-production-facts div{min-width:0}.bd .ot-production-facts .referencia{grid-column:1/-1}.bd .ot-production-facts dt{margin-bottom:5px;color:#a6b7ab;font:12px/1.5 Arial}.bd .ot-production-facts dd{margin:0;color:#eef5ed;font:500 14px/1.5 Arial;overflow-wrap:anywhere}.bd .ot-production-facts .cantidad dd{color:#d0f44c;font:700 22px/1 Arial}.bd .ot-production-facts .cantidad small{font:500 12px Arial;color:#adbdaf}.bd .ot-production-facts .entrega dd{font-weight:700}
.bd .ot-production-card .ot-tiempo{margin:15px 0 0!important;padding:10px 11px!important;border-top:1px solid #35463c!important;background:transparent!important}.bd .ot-production-card .ot-tiempo b{font:600 12px/1.4 Arial!important}.bd .ot-production-card .ot-bodega.nuevo{margin:14px 0 0!important}.bd .ot-production-card .ot-pie{display:none!important}
@media(max-width:700px){.bd .bd-tcards{grid-auto-rows:540px!important}}@media(max-width:560px){.bd .ot-production-body{min-height:0;padding:16px 17px!important}.bd .ot-production-heading h3{font-size:21px}.bd .ot-production-facts{grid-template-columns:1fr 1fr}.bd .ot-production-facts .referencia{grid-column:1/-1}.bd .ot-production-card .ot-bodega.nuevo{margin-top:12px!important}}
/* Tarjeta dinámica de programación: identidad arriba, telas en el centro y datos operativos abajo. */
.bd .bd-tcards{grid-auto-rows:480px!important}.bd .ot-dyn-plan{grid-template-rows:minmax(0,1fr)!important}.bd .ot-dyn-plan-head{display:none!important}@media(max-width:560px){.bd .bd-tcards{grid-auto-rows:465px!important}}
/* Distribución plana: los datos se leen como una ficha, no como una colección de recuadros. */
.bd .ot-dyn-head{column-gap:14px;row-gap:8px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.12)}.bd .ot-dyn-head>div{padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}.bd .ot-dyn-head .cliente{padding-top:2px!important}.bd .ot-dyn-head .cantidad b{color:#d5f64d}.bd .ot-dyn-plan{padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}.bd .ot-dyn-plan-head{margin:0 0 8px;padding:0 0 7px;border-bottom:1px solid rgba(255,255,255,.11)}.bd .ot-dyn-materials{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);align-content:stretch;overflow:hidden!important;padding:0!important;gap:10px}.bd .ot-dyn-materials.one{grid-template-columns:1fr}.bd .ot-dyn-material{height:100%;box-sizing:border-box;padding:9px 0!important;border:0!important;border-top:2px solid #66c8e4!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}.bd .ot-dyn-material.bad{border-top-color:#f09086!important;background:transparent!important}.bd .ot-dyn-material-top{padding:0 2px}.bd .ot-dyn-material-tag{border-radius:999px}.bd .ot-dyn-material-name{min-height:0;padding:0 2px;font-size:11px}.bd .ot-dyn-material-stats{align-self:end;gap:12px;padding:6px 2px 0}.bd .ot-dyn-material-stats span{padding:0!important;border-radius:0!important;background:transparent!important}.bd .ot-dyn-material-stats b{font-size:12px}.bd .ot-dyn-meter{margin:5px 2px 0}.bd .ot-dyn-materials.one .ot-dyn-material{padding-top:14px!important}.bd .ot-dyn-materials.one .ot-dyn-material-top b{font-size:26px}.bd .ot-dyn-materials.one .ot-dyn-material-name{font-size:14px}.bd .ot-dyn-materials.one .ot-dyn-material-stats b{font-size:17px}.bd .ot-dyn-materials.one .ot-dyn-meter{height:7px}
/* Cada tela usa un acento propio para diferenciar rápidamente el descuento. */
.bd .ot-dyn-material:nth-child(1){border-top-color:#62cbe9!important}.bd .ot-dyn-material:nth-child(1) .ot-dyn-material-tag{background:#62cbe9}.bd .ot-dyn-material:nth-child(1) .ot-dyn-meter i{background:linear-gradient(90deg,#3d9fca,#62cbe9)}.bd .ot-dyn-material:nth-child(2){border-top-color:#d5f64d!important}.bd .ot-dyn-material:nth-child(2) .ot-dyn-material-tag{background:#d5f64d}.bd .ot-dyn-material:nth-child(2) .ot-dyn-meter i{background:linear-gradient(90deg,#8ebd46,#d5f64d)}.bd .ot-dyn-material:nth-child(3){border-top-color:#ffc45d!important}.bd .ot-dyn-material:nth-child(3) .ot-dyn-material-tag{background:#ffc45d}.bd .ot-dyn-material:nth-child(3) .ot-dyn-meter i{background:linear-gradient(90deg,#dc9632,#ffc45d)}.bd .ot-dyn-material:nth-child(4){border-top-color:#cf9df5!important}.bd .ot-dyn-material:nth-child(4) .ot-dyn-material-tag{background:#cf9df5}.bd .ot-dyn-material:nth-child(4) .ot-dyn-meter i{background:linear-gradient(90deg,#9d67d0,#cf9df5)}.bd .ot-dyn-material.bad{border-top-color:#f09086!important}.bd .ot-dyn-material.bad .ot-dyn-material-tag{background:#f09086}.bd .ot-dyn-material.bad .ot-dyn-meter i{background:linear-gradient(90deg,#d95c55,#f09086)}
/* Restauración de la composición anterior: solo se elimina el total duplicado. */
.bd .bd-tcards{grid-auto-rows:540px!important}.bd .ot-dyn-head{column-gap:7px;row-gap:7px;padding:0;border:0}.bd .ot-dyn-head>div{min-width:0;padding:8px 9px!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:9px!important;background:rgba(5,13,8,.42)!important}.bd .ot-dyn-head .cliente{grid-column:1/-1;padding:8px 9px!important}.bd .ot-dyn-head small{display:block;margin-bottom:3px}.bd .ot-dyn-head .orden b{font-size:20px}.bd .ot-dyn-head .cliente span{font-size:14px}.bd .ot-dyn-plan{display:grid!important;grid-template-rows:minmax(0,1fr)!important;min-height:0;padding:10px!important;border:1px solid rgba(181,239,103,.23)!important;border-radius:12px!important;background:rgba(7,18,10,.5)!important}.bd .ot-dyn-materials{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:auto;align-content:start;overflow-y:auto!important;padding-right:2px!important;gap:7px}.bd .ot-dyn-materials.one{grid-template-columns:1fr}.bd .ot-dyn-material{height:auto;padding:8px!important;border:1px solid rgba(102,200,228,.18)!important;border-top:3px solid #66c8e4!important;border-radius:8px!important;background:linear-gradient(150deg,rgba(24,48,39,.95),rgba(13,25,18,.95))!important}.bd .ot-dyn-material.bad{border-top-color:#f09086!important;background:linear-gradient(150deg,rgba(58,31,28,.96),rgba(25,15,13,.95))!important}.bd .ot-dyn-material-name{min-height:28px;padding:0;font-size:10px}.bd .ot-dyn-material-stats{align-self:auto;gap:4px;padding:0}.bd .ot-dyn-material-stats span{padding:4px!important;border-radius:4px!important;background:rgba(255,255,255,.055)!important}.bd .ot-dyn-material-stats b{font-size:10px}.bd .ot-dyn-meter{height:4px;margin-top:2px}.bd .ot-dyn-materials.one .ot-dyn-material{padding:8px!important}.bd .ot-dyn-materials.one .ot-dyn-material-top b{font-size:16px}.bd .ot-dyn-materials.one .ot-dyn-material-name{font-size:10px}.bd .ot-dyn-materials.one .ot-dyn-material-stats b{font-size:10px}.bd .ot-dyn-materials.one .ot-dyn-meter{height:4px}
.bd .ot-dyn-material:nth-child(2){border-top-color:#d5f64d!important}.bd .ot-dyn-material:nth-child(3){border-top-color:#ffc45d!important}.bd .ot-dyn-material:nth-child(4){border-top-color:#cf9df5!important}
.bd .ot-dyn-plan{grid-template-rows:minmax(0,1fr)!important}.bd .ot-dyn-plan-head{display:none!important}
/* Cuadrícula fija de identidad y lectura amplia del descuento. */
.bd .ot-dyn-head{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.bd .ot-dyn-head .orden{grid-column:1!important;grid-row:1!important}.bd .ot-dyn-head .proyecto{grid-column:2!important;grid-row:1!important}.bd .ot-dyn-head .cliente{grid-column:1 / -1!important;grid-row:2!important}.bd .ot-dyn-head .referencia{grid-column:1!important;grid-row:3!important}.bd .ot-dyn-head .cantidad{grid-column:2!important;grid-row:3!important}.bd .ot-dyn-material-top{display:flex!important;width:100%;justify-content:space-between!important}.bd .ot-dyn-material-top b{margin-left:auto!important}.bd .ot-dyn-material-stats{display:grid!important;width:100%;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.bd .ot-dyn-material-stats span{display:block!important;min-width:0}.bd .ot-dyn-material-stats b{display:block!important;white-space:nowrap}.bd .ot-dyn-materials.one{grid-template-columns:minmax(0,1fr)!important}
/* Diseño de referencia para todas las tarjetas de Tela Programada. */
.bd .bd-tcards{grid-auto-rows:540px!important}.bd .bd-tcards .ot-production-card{border:2px solid #28b86c!important;border-radius:16px!important;background:radial-gradient(circle at 18% 0,rgba(224,239,229,.32),transparent 43%),linear-gradient(145deg,#203126,#0c170f)!important}.bd .ot-production-body{padding:12px!important;gap:0!important}.bd .ot-dyn-head{gap:7px!important;padding:0 0 10px!important;border-bottom:1px solid rgba(255,255,255,.16)!important}.bd .ot-dyn-head>div{padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}.bd .ot-dyn-head small{margin-bottom:4px!important;color:#d6ddd5!important;font:800 8px Arial!important;letter-spacing:.1em!important}.bd .ot-dyn-head b,.bd .ot-dyn-head span{font:800 13px/1.2 Arial!important}.bd .ot-dyn-head .orden b{font-size:21px!important}.bd .ot-dyn-head .cliente span{font-size:15px!important}.bd .ot-dyn-head .cantidad b{font-size:14px!important;color:#fff!important}.bd .ot-dyn-plan{display:grid!important;grid-template-rows:auto minmax(0,1fr)!important;padding:13px 0 0!important;border:0!important;border-radius:0!important;background:transparent!important}.bd .ot-dyn-plan-head{display:flex!important;justify-content:space-between;align-items:center;gap:8px;margin:0 0 25px!important;padding:0 0 5px!important;border-bottom:2px solid #60cdea!important}.bd .ot-dyn-plan-head small{color:#edf2ee!important;font:800 9px Arial!important;letter-spacing:.08em!important}.bd .ot-dyn-plan-head b{padding:8px 10px;border:3px solid #12bfe2;background:#102219;color:#fff!important;font:900 17px Arial!important}.bd .ot-dyn-plan-head b em{font:800 9px Arial!important}.bd .ot-dyn-materials{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);align-content:stretch;gap:10px;overflow:hidden!important;padding:0!important}.bd .ot-dyn-materials.one{grid-template-columns:1fr!important}.bd .ot-dyn-material{display:grid!important;grid-template-rows:auto auto 1fr auto auto;gap:4px;height:100%;padding:0 0 8px!important;border:0!important;border-top:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}.bd .ot-dyn-material.bad{background:transparent!important}.bd .ot-dyn-material-top{align-items:center!important;padding:0!important}.bd .ot-dyn-material-tag{padding:3px 6px!important;border-radius:999px!important;background:#62cbe9!important;color:#fff!important;font:900 10px Arial!important}.bd .ot-dyn-material-top b{padding:7px 9px;border:3px solid #12bfe2;color:#fff!important;font:900 27px Arial!important}.bd .ot-dyn-material-top b em{font:800 10px Arial!important}.bd .ot-dyn-material-name{min-height:0!important;color:#fff!important;font:800 12px Arial!important}.bd .ot-dyn-material-stats{align-self:end!important;gap:18px!important;padding:0!important}.bd .ot-dyn-material-stats span{padding:0!important;background:transparent!important;color:#fff!important;font:800 8px Arial!important}.bd .ot-dyn-material-stats b{margin-top:4px;color:#fff!important;font:900 17px Arial!important}.bd .ot-dyn-meter{height:7px!important;margin:4px 0 0!important;background:#214135!important}.bd .ot-dyn-meter i{background:#62cbe9!important}.bd .ot-dyn-materials:not(.one) .ot-dyn-material-top b{padding:5px 6px;border-width:2px;font-size:17px!important}.bd .ot-dyn-materials:not(.one) .ot-dyn-material-stats b{font-size:11px!important}.bd .ot-dyn-materials:not(.one) .ot-dyn-material-name{font-size:10px!important}
/* Únicos cambios solicitados: sin resumen duplicado ni marcos azules; todas las telas visibles. */
.bd .ot-dyn-plan{grid-template-rows:minmax(0,1fr)!important}.bd .ot-dyn-plan-head{display:none!important}.bd .ot-dyn-material-top b{padding:0!important;border:0!important;background:transparent!important}.bd .ot-dyn-materials:not(.one){grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-auto-rows:minmax(0,1fr)!important}.bd .ot-dyn-materials:not(.one) .ot-dyn-material{height:auto!important;min-height:0}.bd .ot-dyn-materials:not(.one) .ot-dyn-material-top b{padding:0!important;border:0!important}.bd .ot-dyn-materials:not(.one) .ot-dyn-material-stats{gap:8px!important}
/* El área de telas llena siempre la tarjeta, sin importar cuántos materiales tenga. */
.bd .ot-production-body.ot-dynamic-body{grid-template-rows:auto minmax(0,1fr)!important}.bd .ot-dyn-material-amount{display:grid!important;justify-items:end;gap:1px;margin-left:auto}.bd .ot-dyn-material-amount small{color:#bbcec0!important;font:800 7px Arial!important;letter-spacing:.09em!important}.bd .ot-dyn-material-top .ot-dyn-material-amount b{margin-left:0!important}.bd .ot-dyn-materials.telas-2 .ot-dyn-material-amount b,.bd .ot-dyn-materials.telas-3 .ot-dyn-material-amount b{font-size:18px!important}
.bd .ot-dyn-plan,.bd .ot-dyn-materials{height:100%!important;min-height:0!important}.bd .ot-dyn-materials.telas-1{grid-template-columns:1fr!important;grid-template-rows:minmax(0,1fr)!important}.bd .ot-dyn-materials.telas-2{grid-template-columns:1fr!important;grid-template-rows:repeat(2,minmax(0,1fr))!important}.bd .ot-dyn-materials.telas-3{grid-template-columns:1fr!important;grid-template-rows:repeat(3,minmax(0,1fr))!important}.bd .ot-dyn-materials.telas-4{grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-template-rows:repeat(2,minmax(0,1fr))!important}.bd .ot-dyn-materials.telas-1 .ot-dyn-material,.bd .ot-dyn-materials.telas-2 .ot-dyn-material,.bd .ot-dyn-materials.telas-3 .ot-dyn-material,.bd .ot-dyn-materials.telas-4 .ot-dyn-material{height:auto!important;min-height:0!important;align-self:stretch!important}.bd .ot-dyn-materials.telas-1 .ot-dyn-material-top b{font-size:30px!important}.bd .ot-dyn-materials.telas-1 .ot-dyn-material-name{font-size:14px!important}.bd .ot-dyn-materials.telas-1 .ot-dyn-material-stats b{font-size:18px!important}.bd .ot-dyn-materials.telas-1 .ot-dyn-meter{height:8px!important}
.bd .ot-dyn-materials.telas-3 .ot-dyn-material{grid-template-rows:auto auto auto auto!important;align-content:space-between!important;gap:2px!important;padding-bottom:3px!important}.bd .ot-dyn-materials.telas-3 .ot-dyn-material-stats{align-self:auto!important}.bd .ot-dyn-materials.telas-3 .ot-dyn-material-stats b{margin-top:2px!important;font-size:10px!important}.bd .ot-dyn-materials.telas-3 .ot-dyn-meter{height:5px!important;margin-top:1px!important}
@media (max-width:700px){.bd .bd-tkpi.bd-cards.fit{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px}.bd .bd-tkpi .inventory-item-card{padding:12px!important}.bd .bd-tkpi .inv-total{font-size:1.25rem!important}.bd .bd-tkpi .inv-unit{font-size:.62rem!important;line-height:1.25}.bd .bd-tfilters{grid-template-columns:repeat(2,minmax(0,1fr))!important;padding:12px}.bd .bd-tfilters .bd-clear{grid-column:1/-1}.bd .bd-tfilters label:first-child{grid-column:1/-1}.bd .bd-tfilters input,.bd .bd-tfilters select{min-width:0;font-size:16px}.bd .bd-tcards.bd-cards{gap:10px}.bd .bd-tcards .ot-production-card{content-visibility:auto;contain:layout style paint;contain-intrinsic-size:540px}.bd .bd-tcards .inventory-item-card .bd-line b{white-space:normal;text-align:right;overflow-wrap:anywhere}.bd-head h2{font-size:.95rem}}
@media (max-width:340px){.bd .bd-tkpi.bd-cards.fit{grid-template-columns:minmax(0,1fr)!important}}
`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'bodega-dashboard';
  panel.innerHTML = '<div class="bd"><div class="bd-head"><div><h2>Panel de control · Stock tela</h2><p class="bd-updated">Cargando…</p></div><div class="bd-head-actions"><label class="bd-switch" title="Conecta o desvincula el inventario del Google Sheets"><span class="bd-switch-text"><b>Inventario</b><small data-bd-link-state>Cargando…</small></span><input type="checkbox" role="switch" data-bd-link><i class="bd-switch-track"><i class="bd-switch-dot"></i></i></label><button type="button" class="bd-refresh">Actualizar</button></div></div>' +
    '<nav class="dash-tabs bd-subtabs" role="tablist" aria-label="Secciones del panel de control"><button type="button" role="tab" class="on" data-bd-tab="resumen" aria-selected="true">Resumen</button><button type="button" role="tab" data-bd-tab="tela" aria-selected="false">Tela programada</button></nav>' +
    '<form class="bd-filters" autocomplete="off" onsubmit="return false"><label>Nombre tela<input name="tela" type="search" list="bd-telas" placeholder="Ej. MONTECATINI"><datalist id="bd-telas"></datalist></label><label>Código tela<input name="codigo" type="search" inputmode="numeric" placeholder="Ej. 100"></label><label>Fecha desde<input name="desde" type="date"></label><label>Fecha hasta<input name="hasta" type="date"></label><button type="button" class="bd-clear">Limpiar</button><p class="bd-count"></p></form>' +
    '<div class="bd-body"></div><div class="bd-body2" hidden></div></div>';
  const body = panel.querySelector('.bd-body');
  body.style.display = 'grid';
  body.style.gap = '26px';

  const circles = (values, states) => values && values.length ? '<div class="inventory-rolls">' + values.map((value, index) => '<span class="inventory-roll ' + (states?.[index] === 'started' ? 'roll-started' : 'roll-new') + '">' + esc(num(value)) + '</span>').join('') + '</div>' : '';
  const codes = names => names.map(name => (String(name).match(/^\s*\(([^)]+)\)/) || [])[1]).filter(Boolean);
  const card = ({badge, badgeClass = '', name, total, unit, extra = '', cls = '', title = '', telas = null, fecha = '', level = null, tone = 'verde'}) =>
    '<article class="inventory-item-card ' + cls + '"' + (level !== null ? ' data-lq="' + Math.max(0, Math.min(100, Math.round(level))) + '" data-lq-tone="' + tone + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') +
      (telas ? ' data-tela="' + esc(norm(telas.join(' | '))) + '" data-codigo="' + esc(codes(telas).join('|')) + '"' : ' data-sinfiltro="true"') + (fecha ? ' data-fecha="' + esc(day(fecha)) + '"' : '') + '><span class="inv-badge ' + badgeClass + '">' + esc(badge) + '</span><strong class="inv-name">' + esc(name) + '</strong>' + extra + '<span class="inv-total">' + total + '</span>' + (unit ? '<span class="inv-unit">' + esc(unit) + '</span>' : '') + '</article>';
  const section = (title, note, cards, fit) => '<section class="bd-section"' + (fit ? ' data-fijo="true"' : '') + '><h3>' + esc(title) + (note ? ' <small>· ' + esc(note) + '</small>' : '') + '</h3>' + (cards ? '<div class="bd-cards' + (fit ? ' fit' : '') + '">' + cards + '</div>' : '') + '</section>';
  const meter = (value, max) => '<div class="bd-meter"><i style="width:' + Math.max(1, value / (max || 1) * 100) + '%"></i></div>';

  const render = data => {
    const k = data.kpis, sub = data.sublimacion, mov = data.movimientos, con = data.consumos;
    const split = (k.mts_nuevos + k.mts_empezados) || 1;
    const alerts = sub.no_alcanzan + (data.listas_no_alcanzan || 0);
    panel.querySelector('.bd-updated').textContent = 'Inventario leído del Sheet: ' + when(data.updated_at);
    const resumen =
      card({badge: 'Stock tela', name: 'Metros en bodega', total: num(k.mts) + '<small>MTS</small>', unit: 'Suma de todas las telas · ' + num(k.mts_nuevos) + ' en rollos nuevos', level: k.mts_nuevos / split * 100, tone: 'azul'}) +
      card({badge: 'Telas', name: 'Telas con stock', total: num(k.telas_con_stock) + '<small>de ' + num(k.telas) + '</small>', unit: num(k.telas_sin_stock) + ' telas en cero', extra: meter(k.telas_con_stock, k.telas), level: k.telas ? k.telas_con_stock / k.telas * 100 : 0, tone: 'verde'}) +
      card({badge: 'Rollos', name: 'Rollos en bodega', total: num(k.rollos), level: k.rollos ? k.rollos_nuevos / k.rollos * 100 : 0, tone: 'teal', unit: num(k.rollos_nuevos) + ' nuevos · ' + num(k.rollos_empezados) + ' empezados',
        extra: '<div class="bd-split" role="img" aria-label="Nuevos ' + num(k.mts_nuevos) + ' MTS, empezados ' + num(k.mts_empezados) + ' MTS"><i class="n" style="width:' + (k.mts_nuevos / split * 100) + '%" title="Nuevos: ' + num(k.mts_nuevos) + ' MTS"></i><i class="s" style="width:' + (k.mts_empezados / split * 100) + '%" title="Empezados: ' + num(k.mts_empezados) + ' MTS"></i></div>' +
          '<div class="inventory-rolls"><span class="inventory-roll roll-new">' + num(k.rollos_nuevos) + '</span><span class="bd-line" style="align-self:center">Nuevos · ' + num(k.mts_nuevos) + ' MTS</span></div><div class="inventory-rolls"><span class="inventory-roll roll-started">' + num(k.rollos_empezados) + '</span><span class="bd-line" style="align-self:center">Empezados · ' + num(k.mts_empezados) + ' MTS</span></div>'}) +
      card({badge: 'Sublimación', name: 'Reservado para Sublimación', total: num(sub.mts) + '<small>MTS</small>', unit: num(sub.ordenes) + ' órdenes en curso', level: k.mts ? sub.mts / k.mts * 100 : 0, tone: 'violeta'}) +
      card({badge: alerts ? 'Atención' : 'Al día', badgeClass: alerts ? 'bad' : 'ok', cls: alerts ? 'bad' : '', level: alerts ? Math.min(100, alerts / Math.max(1, sub.ordenes + (data.listas || []).length) * 100) : 0, tone: alerts ? 'rojo' : 'verde', name: 'Órdenes que no alcanzan', total: num(alerts), unit: alerts ? num(sub.no_alcanzan) + ' en Sublimación · ' + num(data.listas_no_alcanzan || 0) + ' con Edición finalizada' : 'Todas las órdenes alcanzan'}) +
      card({badge: 'Consumo', name: 'Consumido en Sublimación', total: num(con.mts_30d) + '<small>MTS</small>', unit: 'Últimos 30 días · ' + num(con.ordenes_30d) + ' órdenes', level: (con.mts_30d + k.mts) ? con.mts_30d / (con.mts_30d + k.mts) * 100 : 0, tone: 'ambar'});

    const maxTop = data.top[0]?.mts || 1;
    const top = data.top.map((row, index) => card({badge: 'Top ' + (index + 1), telas: [row.nombre], name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados) + meter(row.mts, maxTop)})).join('');

    const orderCard = row => !row.encontrada
      ? card({badge: 'Tela no encontrada', badgeClass: 'bad', cls: 'bad', name: row.label, total: num(row.mts) + '<small>MTS</small>', telas: [row.tela], fecha: row.fecha,
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + 'Tela en producción: ' + (row.tela || 'sin tela') + ' · no hay una tela con ese nombre en Bodega'})
      : card({badge: row.short ? 'No alcanza' : 'Alcanza', badgeClass: row.short ? 'bad' : 'ok', cls: row.short ? 'bad' : '', name: row.label, telas: [row.tela, ...row.telas], fecha: row.fecha,
          total: row.short ? num(row.missing) + '<small>MTS FALTAN</small>' : num(row.mts) + '<small>MTS</small>',
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + (row.short ? 'Necesita ' + num(row.mts) + ' MTS · ' : '') + (row.telas.length ? row.telas.join(', ') + ' · ' : '') + rolls(row.rollos), extra: circles(row.valores, row.estados)});
    const readyCard = row => !row.encontrada ? orderCard(row)
      : card({badge: row.short ? 'No alcanza' : 'Alcanza', badgeClass: row.short ? 'bad' : 'ok', cls: row.short ? 'bad' : '', name: row.label,
          total: row.short ? num(row.missing) + '<small>MTS FALTAN</small>' : num(row.mts) + '<small>MTS</small>',
          telas: [row.tela, ...row.telas], fecha: row.fecha,
          unit: (row.fecha ? 'Edición ' + shortDay(row.fecha) + ' · ' : '') + 'Disponible ' + num(row.disponible) + ' MTS · ' + row.telas.join(', ')});
    const orders = sub.lista.map(orderCard).join('');
    const ready = (data.listas || []).slice().sort((a, b) => (b.short - a.short)).map(readyCard).join('');

    const low = data.bajo_stock.map(row => card({badge: 'Bajo stock', badgeClass: 'warn', telas: [row.nombre], name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: rolls(row.rollos), extra: circles(row.valores, row.estados)})).join('') +
      data.sin_stock.map(name => card({badge: 'Sin stock', badgeClass: 'bad', telas: [name], name, total: '0<small>MTS</small>', unit: '0 rollos'})).join('');

    const maxSupplier = data.proveedores[0]?.mts || 1;
    const suppliers = data.proveedores.filter(row => row.mts > 0).map(row => card({badge: 'Proveedor', telas: ((data.proveedores_telas || {})[row.nombre] || []).map(pair => pair[0]), name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: num(row.telas) + (row.telas === 1 ? ' tela · ' : ' telas · ') + Math.round(row.mts / (k.mts || 1) * 100) + '% de la bodega',
      extra: meter(row.mts, maxSupplier) + ((data.proveedores_telas || {})[row.nombre] || []).map(([name, mts]) => '<div class="bd-line"><span>' + esc(name) + '</span><b>' + num(mts) + ' MTS</b></div>').join('')})).join('');

    const activity =
      card({badge: 'Ingresos web', badgeClass: 'ok', name: num(mov.ingresos) + ' ingresos registrados', total: num(mov.ingresos_mts) + '<small>MTS</small>', unit: num(data.documentos) + ' documentos de entrega'}) +
      card({badge: 'Salidas web', badgeClass: 'warn', name: num(mov.salidas) + ' salidas registradas', total: num(mov.salidas_mts) + '<small>MTS</small>', unit: 'Desde el formulario SALIDA'}) +
      mov.ultimos.map(row => card({badge: row.tipo === 'INGRESO' ? 'Ingreso' : 'Salida', badgeClass: row.tipo === 'INGRESO' ? 'ok' : 'warn', telas: [row.nombre], fecha: row.fecha, name: row.nombre, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + ' · ' + rolls(row.rollos) + (row.origen ? ' · ' + row.origen : '')})).join('') +
      con.ultimos.map(row => card({badge: 'Consumo Sublimación', telas: row.telas, fecha: row.fecha, name: 'Orden ' + row.orden, total: num(row.mts) + '<small>MTS</small>', unit: when(row.fecha) + (row.telas.length ? ' · ' + row.telas.join(', ') : '')})).join('');

    body.innerHTML =
      section('Resumen', '', resumen, true) +
      section('Lista para imprimir', 'Edición finalizada · ' + num((data.listas || []).length) + ' referencias · se revisa si alcanza la tela', ready || '') + (ready ? '' : '<p class="bd-note">No hay referencias con Edición finalizada pendientes de Sublimación.</p>') +
      section('Sublimación en curso', num(sub.ordenes) + ' órdenes', orders || '') + (orders ? '' : '<p class="bd-note">No hay órdenes en Sublimación (P).</p>') +
      section('Bajo stock', 'menos de ' + num(data.umbral_bajo) + ' MTS', low || '') + (low ? '' : '<p class="bd-note">Ninguna tela por debajo del umbral.</p>') +
      section('Top 10 telas con más metros', '', top) +
      section('Metros por proveedor', '', suppliers) +
      section('Movimientos', 'ingresos, salidas y consumos', activity);
    panel.querySelector('#bd-telas').innerHTML = (data.telas || []).map(name => '<option value="' + esc(name) + '"></option>').join('');
    applyFilters();
  };

  const filters = panel.querySelector('.bd-filters');
  const applyFilters = () => {
    const typed = filters.elements.tela.value;
    const tela = norm(typed).replace(/^\([^)]*\)\s*/, '');
    const typedCode = (typed.match(/^\s*\(([^)]+)\)/) || [])[1] || '';
    const codigo = norm(filters.elements.codigo.value).replace(/[()]/g, '') || norm(typedCode);
    const desde = filters.elements.desde.value, hasta = filters.elements.hasta.value;
    const active = Boolean(tela || codigo || desde || hasta);
    let shown = 0;
    body.querySelectorAll('.bd-section').forEach(sectionNode => {
      if (sectionNode.dataset.fijo) return;
      let visible = 0;
      sectionNode.querySelectorAll('.inventory-item-card').forEach(cardNode => {
        let ok = !active;
        if (active && !cardNode.dataset.sinfiltro) {
          const fecha = cardNode.dataset.fecha || '';
          ok = (!tela || (cardNode.dataset.tela || '').includes(tela))
            && (!codigo || (cardNode.dataset.codigo || '').split('|').includes(codigo))
            && (!(desde || hasta) || (fecha && (!desde || fecha >= desde) && (!hasta || fecha <= hasta)));
        }
        cardNode.style.display = ok ? '' : 'none';
        if (ok) visible += 1;
      });
      sectionNode.style.display = active && !visible ? 'none' : '';
      shown += visible;
    });
    body.querySelectorAll(':scope > .bd-note').forEach(note => { note.style.display = active ? 'none' : ''; });
    panel.querySelector('.bd-count').textContent = active ? (shown ? shown + (shown === 1 ? ' tarjeta coincide' : ' tarjetas coinciden') + ' con el filtro.' : 'Nada coincide con el filtro.') : '';
  };
  filters.addEventListener('input', applyFilters);
  panel.querySelector('.bd-clear').onclick = () => { filters.reset(); applyFilters(); };

  const load = async () => {
    if (typeof showLink === 'function') showLink();
    body.innerHTML = '<p class="bd-note">Cargando estadísticas…</p>';
    try {
      const response = await fetch('/api/inventarios/dashboard', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar el dashboard');
      render(data);
    } catch (error) { body.innerHTML = '<p class="bd-note">' + esc(error.message) + '</p>'; }
  };
  panel.querySelector('.bd-refresh').onclick = load;
  const linkSwitch = panel.querySelector('[data-bd-link]'), linkState = panel.querySelector('[data-bd-link-state]'), linkBox = linkSwitch.closest('.bd-switch');
  const showLink = async () => {
    try {
      const status = await (await fetch('/api/inventarios/vinculo', {cache: 'no-store'})).json();
      linkSwitch.checked = !!status.vinculado;
      linkState.textContent = status.vinculado ? 'CONECTADO' : 'DESVINCULADO';
    } catch (_) { linkState.textContent = 'sin estado'; }
  };
  linkSwitch.addEventListener('change', async () => {
    const wantLinked = linkSwitch.checked;
    if (wantLinked && !confirm('Al CONECTAR el Inventario se iguala todo al Google Sheets: los ingresos, salidas y descuentos de prueba hechos en la web se descartan (se guarda copia). ¿Conectar y igualar?')) { linkSwitch.checked = false; return; }
    linkBox.classList.add('busy');
    linkState.textContent = wantLinked ? 'Conectando…' : 'Desvinculando…';
    try {
      const response = await fetch('/api/inventarios/vinculo', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vinculado: wantLinked})});
      if (!response.ok) throw Error('No se pudo cambiar el vínculo');
    } catch (error) { alert(error.message); }
    linkBox.classList.remove('busy');
    await showLink();
    if (wantLinked) fetch('/api/inventarios?refresh=true', {cache: 'no-store'}).catch(() => {});
    load();
  });
  showLink();

  // Producción · Sheets: interruptor en INICIO (pedidos, estados y MTS REQUERIDOS desde el Sheet de Producción).
  const homeRow = document.createElement('div');
  homeRow.className = 'bd-home-sync';
  homeRow.innerHTML = '<label class="bd-switch" title="Conecta o desvincula Producción (pedidos y MTS REQUERIDOS) del Google Sheets"><span class="bd-switch-text"><b>Producción</b><small data-bd-prod-state>Cargando…</small></span><input type="checkbox" role="switch" data-bd-prod><i class="bd-switch-track"><i class="bd-switch-dot"></i></i></label>';
  const prodSwitch = homeRow.querySelector('[data-bd-prod]'), prodState = homeRow.querySelector('[data-bd-prod-state]'), prodBox = homeRow.querySelector('.bd-switch');
  const showProd = async () => {
    try {
      const status = await (await fetch('/api/produccion/sheets-sync/estado', {cache: 'no-store'})).json();
      prodSwitch.checked = !!status.enabled;
      prodState.textContent = status.enabled ? (status.resync ? 'Igualando con el Sheet…' : 'CONECTADO') : 'DESVINCULADO';
      return status;
    } catch (_) { prodState.textContent = 'sin estado'; }
  };
  prodSwitch.addEventListener('change', async () => {
    const wantLinked = prodSwitch.checked;
    if (wantLinked && !confirm('Al CONECTAR Producción se iguala todo al Google Sheets: estados, fechas y MTS. Lo que se haya cambiado solo en la web y no esté en el Sheet SE PIERDE (se guarda una copia de seguridad antes). ¿Conectar y igualar?')) { prodSwitch.checked = false; return; }
    prodBox.classList.add('busy');
    prodState.textContent = wantLinked ? 'Conectando…' : 'Desvinculando…';
    try {
      const response = await fetch('/api/produccion/sheets-sync/' + (wantLinked ? 'activar' : 'desactivar'), {method: 'POST'});
      if (!response.ok) throw Error('No se pudo cambiar el vínculo de Producción');
    } catch (error) { alert(error.message); }
    // Al volver a conectar se iguala todo al Google Sheets: se espera a que termine (máx. ~90 s).
    for (let i = 0; i < 45; i++) {
      const status = await showProd();
      if (!status || !status.resync) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    prodBox.classList.remove('busy');
    await showProd();
  });
  const mountHome = () => {
    if (homeRow.isConnected) return;
    const dash = document.getElementById('home-dashboard');
    if (dash?.parentElement) { dash.parentElement.insertBefore(homeRow, dash); showProd(); }
  };
  mountHome();
  new MutationObserver(mountHome).observe(document.body, {childList: true, subtree: true});
  setInterval(() => { if (homeRow.offsetParent) showProd(); }, 30000);


  // ---- Sub-pestaña «Tela programada»: la tela que piden los pedidos programados (promedio general del maestro × cantidad) frente a Bodega ----
  const body2 = panel.querySelector('.bd-body2');
  const filtersBox = panel.querySelector('.bd-filters:not(.bd-tfilters)');
  let subTab = 'resumen';
  body2.style.display = 'grid';
  body2.style.gap = '22px';
  body2.innerHTML =
    '<div class="bd-cards fit bd-tkpi"></div>' +
    '<form class="bd-filters bd-tfilters" autocomplete="off" onsubmit="return false">' +
      '<label>Buscar<input name="q" type="search" placeholder="Orden, cliente, referencia o tela"></label>' +
      '<label>Tela<select name="tela"><option value="">Todas</option></select></label>' +
      '<label>Estado<select name="sit"><option value="">Todos</option><option value="alcanza">Alcanza</option><option value="no_alcanza">No alcanza</option><option value="sin_tela">Tela no encontrada</option><option value="sin_promedio">Sin promedio</option></select></label>' +
      '<label>Sublimación<select name="sub"><option value="">Todas</option><option value="P">En Sublimación</option><option value="pend">Por entrar</option></select></label>' +
      '<label>Entrega desde<input name="desde" type="date"></label><label>Entrega hasta<input name="hasta" type="date"></label>' +
      '<button type="button" class="bd-clear">Limpiar</button><p class="bd-count"></p></form>' +
    '<div class="bd-cards bd-tcards"><p class="bd-note">Calculando la tela de los pedidos…</p></div>';
  const tFilters = body2.querySelector('.bd-tfilters'), tCards = body2.querySelector('.bd-tcards'), tKpi = body2.querySelector('.bd-tkpi');
  let brechaDias = 14, prodData = null, unitData = null;
  const SITUACION = {alcanza: ['Alcanza', 'ok'], no_alcanza: ['No alcanza', 'bad'], sin_tela: ['Tela no encontrada', 'bad'], sin_promedio: ['Sin promedio', 'warn']};
  const filterTela = () => {
    const f = tFilters.elements, q = norm(f.q.value), desde = f.desde.value, hasta = f.hasta.value;
    let shown = 0;
    tCards.querySelectorAll('.inventory-item-card').forEach(node => {
      const d = node.dataset, fecha = d.fecha || '';
      const ok = (!q || (d.q || '').includes(q)) && (!f.tela.value || d.tela === f.tela.value) && (!f.sit.value || d.sit === f.sit.value)
        && (!f.sub.value || d.sub === f.sub.value) && (!desde || (fecha && fecha >= desde)) && (!hasta || (fecha && fecha <= hasta));
      node.hidden = !ok;
      if (ok) shown += 1;
    });
    const total = tCards.querySelectorAll('.inventory-item-card').length;
    body2.querySelector('.bd-count').textContent = total ? shown + ' de ' + total + (total === 1 ? ' orden' : ' órdenes') : '';
    let vacio = tCards.querySelector('.bd-vacio');
    if (total && !shown) { if (!vacio) tCards.insertAdjacentHTML('beforeend', '<p class="bd-note bd-vacio">Ninguna orden coincide con los filtros.</p>'); }
    else vacio?.remove();
  };
  const renderTela = data => {
    if (data.disponible === false) { tKpi.__h = tCards.__h = null; tKpi.innerHTML = ''; tCards.innerHTML = '<p class="bd-note">No se pudo leer Producción para calcular la tela necesaria.</p>'; return; }
    const ordenes = data.ordenes || [];
    brechaDias = data.brecha_sublimacion || 14;
    poner(tKpi, card({badge: data.telas_no_alcanzan ? 'Atención' : 'Al día', badgeClass: data.telas_no_alcanzan ? 'bad' : 'ok', cls: data.telas_no_alcanzan ? 'bad' : '',
      level: data.mts ? Math.max(0, 100 - data.faltan / data.mts * 100) : 100, tone: data.telas_no_alcanzan ? 'rojo' : 'verde', name: 'Tela necesaria programada',
      total: num(data.mts) + '<small>MTS</small>', unit: num(data.pedidos) + ' pedidos en ' + num((data.telas || []).length) + ' telas · ' + (data.telas_no_alcanzan ? num(data.telas_no_alcanzan) + ' telas no alcanzan · faltan ' + num(data.faltan) + ' MTS' : 'toda la tela alcanza')}) +
      (data.telas || []).map(t => card({badge: !t.encontrada ? 'Tela no encontrada' : t.alcanza ? 'Alcanza' : 'No alcanza', badgeClass: t.alcanza ? 'ok' : 'bad', cls: t.alcanza ? '' : 'bad',
        level: t.encontrada ? Math.min(100, t.disponible / (t.mts || 1) * 100) : 0, tone: t.alcanza ? 'verde' : 'rojo', name: t.tela, total: num(t.mts) + '<small>MTS</small>',
        unit: t.pedidos.length + (t.pedidos.length === 1 ? ' pedido' : ' pedidos') + ' · ' + (t.encontrada ? 'Bodega ' + num(t.disponible) + ' MTS' + (t.alcanza ? '' : ' · FALTAN ' + num(t.faltan)) : 'no está en Bodega')})).join(''));
    const telas = [...new Set(ordenes.map(o => o.tela))].sort();
    const selTela = tFilters.elements.tela, actual = selTela.value;
    poner(selTela, '<option value="">Todas</option>' + telas.map(t => '<option value="' + esc(t) + '"' + (t === actual ? ' selected' : '') + '>' + esc(t) + '</option>').join(''));
    const ORD_TALLAS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
    const tallasTxt = o => {
      const m = {};
      (o.tallas || []).forEach(t => { m[t.talla] = (m[t.talla] || 0) + t.cantidad; });
      const rank = t => { const i = ORD_TALLAS.indexOf(t); return i >= 0 ? i : 100 + (Number(t) || 0); };
      return Object.keys(m).sort((a, b) => rank(a) - rank(b)).map(t => t + ' ' + m[t]).join(' · ');
    };
    const tallasPares = o => {
      const m = {};
      (o.tallas || []).forEach(t => { m[t.talla] = (m[t.talla] || 0) + t.cantidad; });
      const rank = t => { const i = ORD_TALLAS.indexOf(t); return i >= 0 ? i : 100 + (Number(t) || 0); };
      return Object.keys(m).sort((x, y) => rank(x) - rank(y)).map(t => [t, m[t]]);
    };
    const diasChip = v => {   // días que faltan para la entrega (o de atraso)
      const d = v ? new Date(v + 'T12:00:00') : null; if (!d || isNaN(d)) return '';
      const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
      const n = Math.round((d - hoy) / 86400000);
      return ' <b class="ot-dias ' + (n < 0 ? 'tarde' : n <= 2 ? 'cerca' : 'ok') + '">' + (n < 0 ? (-n) + (n === -1 ? ' dia de atraso' : ' dias de atraso') : n === 0 ? 'HOY' : n + (n === 1 ? ' dia' : ' dias')) + '</b>';
    };
    const fechaCorta = v => { const d = v ? new Date(v + 'T12:00:00') : null; return d && !isNaN(d) ? d.toLocaleDateString('es-CO', {day: 'numeric', month: 'short', year: 'numeric'}).replace(/\./g, '') : 'Sin fecha'; };
    // ---- cuánto falta para que la orden llegue a Sublimación: por cada área que aún le falta antes de Sublimación, unidades × minutos por unidad (el de la escalera de Inicio) ----
    const MIN_DIA = 570;   // jornada de 7:00 a. m. a 4:30 p. m. (la misma que usa Inicio para medir)
    const hoyCo = () => new Date(Date.now() - 5 * 3600 * 1000);   // hoy en Colombia (UTC-5)
    // Lunes a viernes, de 7:00 a. m. a 4:30 p. m. (fin de semana no se trabaja). Devuelve el momento (hora de Colombia) en que se cumplen `min`
    // minutos de trabajo contados desde ahora: si es de noche o fin de semana, se empieza a contar el siguiente día hábil a las 7:00 a. m.
    const INI_JORNADA = 7 * 60, FIN_JORNADA = 16 * 60 + 30;
    const esHabil = d => { const w = d.getUTCDay(); return w >= 1 && w <= 5; };
    const siguienteHabil = d => { do { d.setUTCDate(d.getUTCDate() + 1); } while (!esHabil(d)); };
    const llegadaEn = min => {
      const f = hoyCo(); let t = f.getUTCHours() * 60 + f.getUTCMinutes();
      if (!esHabil(f) || t >= FIN_JORNADA) { siguienteHabil(f); t = INI_JORNADA; } else if (t < INI_JORNADA) t = INI_JORNADA;
      let falta = Math.max(0, min);
      for (;;) {
        const resto = FIN_JORNADA - t;
        if (falta <= resto) { t += falta; break; }
        falta -= resto; siguienteHabil(f); t = INI_JORNADA;
      }
      f.setUTCHours(0, 0, 0, 0); f.setUTCMinutes(Math.round(t));
      return f;
    };
    const minLaborales = (a, b) => {
      let tot = 0;
      for (const dia = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())); dia <= b; dia.setUTCDate(dia.getUTCDate() + 1)) {
        if (!esHabil(dia)) continue;
        const ini = Math.max(a.getTime(), dia.getTime() + INI_JORNADA * 60000), fin = Math.min(b.getTime(), dia.getTime() + FIN_JORNADA * 60000);
        if (fin > ini) tot += (fin - ini) / 60000;
      }
      return tot;
    };
    // si el área está en proceso y el Sheet trae su HORA INICIO (sin HORA FINAL), ya se avanzó: se descuenta lo trabajado desde esa hora
    const llevaEnArea = (area, col, valores, headers) => {
      let hi = -1, hf = -1;
      for (let k = col + 1; k < Math.min(headers.length, col + 7); k++) { if (headers[k] === 'HORA INICIO' && hi < 0) hi = k; if (headers[k] === 'HORA FINAL' && hf < 0) hf = k; }
      if (hi < 0) return 0;
      const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(valores[hi] == null ? '' : valores[hi]));
      if (!m || (hf >= 0 && /\d/.test(String(valores[hf] == null ? '' : valores[hf])))) return 0;
      const ahora = hoyCo(), inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), Number(m[1]), Number(m[2])));
      if (inicio > ahora) inicio.setUTCDate(inicio.getUTCDate() - 1);   // la hora es de ayer
      return Math.max(0, minLaborales(inicio, ahora));
    };
    const diaTxt = d => d.toLocaleDateString('es-CO', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'}).replace(/\./g, '');
    const cuandoTxt = d => d.toLocaleString('es-CO', {weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'}).replace(/\./g, '');
    // áreas que le faltan a una orden antes de Sublimación, con sus minutos (unidades × minutos por unidad de la escalera de Inicio)
    const partesDe = o => {
      if (!prodData || !unitData) return null;
      const fila = (prodData.rows || []).find(r => r.source_row === o.fila);
      if (!fila) return null;
      const flow = typeof indoorProcessFlow !== 'undefined' ? indoorProcessFlow : [];
      const hasta = flow.findIndex(a => norm(a.label) === 'SUBLIMACION');
      if (hasta < 0) return null;
      const headers = (prodData.headers || []).map(norm), partes = [];
      flow.slice(0, hasta).forEach(area => {
        const col = area.headers.map(x => headers.indexOf(norm(x))).find(i => i >= 0);
        if (col === undefined) return;
        const v = norm(fila.values[col]);
        if (v === 'N/A' || (v && v !== 'P' && v !== 'R' && /\d/.test(v))) return;   // no aplica o ya terminada
        const u = unitData.find(x => norm(x.label) === norm(area.label));
        if (!u || !u.porUnidad || u.unidades < 50) return;   // sin suficientes unidades medidas (p. ej. Diseño) el promedio no es confiable
        const base = o.cantidad * u.porUnidad, lleva = v === 'P' ? llevaEnArea(area, col, fila.values, headers) : 0;
        partes.push({label: area.label, base, lleva, min: lleva > 0 ? Math.max(base * 0.1, base - lleva) : base, porUnidad: u.porUnidad, enProceso: v === 'P'});
      });
      return partes;
    };
    // La planta no hace todas las órdenes a la vez: cada área atiende una orden tras otra. Se ordenan por fecha de entrega y cada orden espera a que
    // el área termine las de adelante (y a que ella misma salga del área anterior). Así dos órdenes no llegan juntas a Sublimación.
    let colaLlegada = new Map();
    const calcularCola = ordenes => {
      colaLlegada = new Map();
      const libre = {};   // minuto en que cada área queda libre
      const pend = ordenes.filter(o => !o.en_sublim).sort((x, y) => String(x.entrega || '9999').localeCompare(String(y.entrega || '9999')) || String(x.orden).localeCompare(String(y.orden)));
      pend.forEach((o, i) => {
        const partes = partesDe(o);
        if (!partes) return;
        let t = 0, propio = 0;
        partes.forEach(p => {
          const ini = Math.max(t, libre[p.label] || 0);
          const fin = ini + p.min;
          libre[p.label] = fin; propio += p.min; t = fin;
        });
        const dias = t / MIN_DIA;
        colaLlegada.set(o.fila, {total: t, propio, espera: Math.max(0, t - propio), dias, partes, delante: i, llega: llegadaEn(t)});
      });
    };
    const estimarLlegada = o => (o.en_sublim ? null : colaLlegada.get(o.fila) || null);
    const CLAVE_LLEGADA = 'indoor-llegada-sublimacion';
    let memoriaLlegada = null;
    const leerMemoria = () => { if (memoriaLlegada) return memoriaLlegada; try { memoriaLlegada = JSON.parse(localStorage.getItem(CLAVE_LLEGADA) || '{}') || {}; } catch (_) { memoriaLlegada = {}; } return memoriaLlegada; };
    const guardarMemoria = () => { try { localStorage.setItem(CLAVE_LLEGADA, JSON.stringify(memoriaLlegada)); } catch (_) { /* sin almacenamiento: solo no se recuerda */ } };
    // compara la fecha estimada de hoy con la del día anterior y devuelve la diferencia en días (+ = se atrasó, − = se adelantó) o null si no hay con qué comparar
    const cambioLlegada = (o, llega) => {
      const memo = leerMemoria(), id = o.orden + '|' + o.referencia, hoy = hoyCo().toISOString().slice(0, 10), iso = llega.toISOString().slice(0, 10);
      let m = memo[id];
      if (!m) m = memo[id] = {dia: hoy, llega: iso, prev: null};
      else if (m.dia !== hoy) { m.prev = {dia: m.dia, llega: m.llega}; m.dia = hoy; m.llega = iso; }
      else m.llega = iso;
      guardarMemoria();
      if (!m.prev) return null;
      const dias = Math.round((new Date(iso + 'T12:00:00') - new Date(m.prev.llega + 'T12:00:00')) / 86400000);
      return dias === 0 ? null : {dias, antes: m.prev.llega, desde: m.prev.dia};
    };
    const horasTxt = m => m >= 60 ? Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min' : Math.round(m) + ' min';
    // tiempo que queda para que la orden llegue a Sublimación (estimado: fecha de entrega menos lo que suele pasar entre Sublimación y entrega)
    const tiempoSublim = o => {
      if (o.en_sublim) return ['ya', 'En Sublimación ahora', '', 'La orden ya está en Sublimación.'];
      const e = estimarLlegada(o);
      if (e) {
        const detalle = e.partes.map(x => x.label + ': ' + num(o.cantidad) + ' und × ' + num(x.porUnidad) + ' min = ' + horasTxt(x.base) + (x.lleva > 0 ? ' · ya lleva ' + horasTxt(x.lleva) + ' → quedan ' + horasTxt(x.min) : '')).join('\n');
        const ayuda = (detalle || 'No le falta ningún área antes de Sublimación') + '\nTrabajo propio: ' + horasTxt(e.propio) + (e.espera ? '\nEspera por las órdenes de adelante: ' + horasTxt(e.espera) : '') + '\nTotal hasta Sublimación: ' + horasTxt(e.total) + ' ≈ ' + num(e.dias) + ' días de trabajo (jornada de ' + horasTxt(MIN_DIA) + ', lunes a sábado)\nSe atienden por fecha de entrega: delante de esta hay ' + e.delante + (e.delante === 1 ? ' orden.' : ' órdenes.');
        const cuando = fechaCorta(e.llega.toISOString().slice(0, 10)).replace(/( de)? \d{4}$/, '');
        const momento = cuandoTxt(e.llega);
        if (!e.partes.length) return ['urgente', 'Lista para entrar a Sublimación', 'no le falta ningún área antes', ayuda];
        const d = Math.max(1, Math.round(e.dias));
        const titulo = 'Llega a Sublimación el ' + diaTxt(e.llega);
        const detalleCorto = momento + ' · faltan ' + e.partes.map(x => x.label.toLowerCase()).join(' + ') + ' · ' + horasTxt(e.propio) + (e.espera >= 1 ? ' + ' + horasTxt(e.espera) + ' de espera' : '');
        const cambio = cambioLlegada(o, e.llega);
        const nota = cambio ? (cambio.dias > 0 ? '▲ Se atrasó ' + cambio.dias + (cambio.dias === 1 ? ' día' : ' días') : '▼ Se adelantó ' + Math.abs(cambio.dias) + (Math.abs(cambio.dias) === 1 ? ' día' : ' días')) + ' desde ' + fechaCorta(cambio.desde).replace(/( de)? \d{4}$/, '') : '';
        return [d <= 1 ? 'urgente' : d <= 3 ? 'pronto' : 'ok', titulo, detalleCorto, ayuda + '\nEstimado: ' + momento + ' (lunes a viernes, 7:00 a. m. a 4:30 p. m.)' + (cambio ? '\n' + nota + ' (antes: ' + fechaCorta(cambio.antes) + ')' : ''), nota, cambio ? (cambio.dias > 0 ? 'atraso' : 'adelanto') : ''];
      }
      if (typeof o.dias_sublim !== 'number') return null;
      const d = o.dias_sublim, cuando = fechaCorta(o.sublim_est).replace(/( de)? \d{4}$/, '');
      if (d < 0) return ['urgente', 'Ya debería estar en Sublimación · hace ' + Math.abs(d) + (Math.abs(d) === 1 ? ' día' : ' días'), 'estimado ' + cuando, ''];
      if (d === 0) return ['urgente', 'Llega a Sublimación hoy', 'estimado ' + cuando, ''];
      return [d <= 3 ? 'pronto' : 'ok', 'Llega a Sublimación en ' + d + (d === 1 ? ' día' : ' días'), 'estimado ' + cuando, ''];
    };
    calcularCola(ordenes);
    // cuánta tela hay en Bodega para esta orden y cuánto queda después de servirla (las órdenes se sirven por fecha de entrega)
    // Metros ENTEROS: «Bodega» redondeado, «quedan» hacia abajo y «faltan» hacia arriba
    const entero = (v, f) => f(Number(v) || 0).toLocaleString('es-CO', {maximumFractionDigits: 0});
    const bodegaLinea = o => {
      if (o.situacion === 'sin_tela' || (o.bodega === null && !o.disponible)) return '<div class="ot-bodega mal" title="No se encontró esta tela en el inventario de Bodega">Tela no encontrada en Bodega</div>';
      if (typeof o.bodega !== 'number') return '';
      const tit = 'Bodega tiene ' + entero(o.bodega, Math.round) + ' MTS de esta tela en total. Las órdenes se sirven por fecha de entrega: para esta orden quedan disponibles ' + entero(o.disponible || 0, Math.floor) + ' MTS.';
      if (o.situacion === 'sin_promedio') return '<div class="ot-bodega" title="' + esc(tit) + '">Bodega <b class="hay">' + entero(o.bodega, Math.round) + '</b> MTS</div>';
      const comparte = o.compartida_con || [];
      const dec = v => (Number(v) || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});
      const faltan = o.situacion === 'no_alcanza', base = comparte.length ? (o.disponible || 0) : (o.bodega || 0);   // si otras órdenes usan la misma tela, lo que le toca a ESTA; si no, el total de Bodega
      const hay = Math.floor(base), desc = Number(o.mts) || 0;
      const lado = (titulo, valor, cls, n) => '<div><small>' + titulo + '</small><b class="' + cls + '" data-n="' + n + '" data-dec="0">' + valor + '</b></div>';
      // medidor: lo que queda (lima) y, al final, la parte que descuenta esta orden (ámbar); si no alcanza, lo que cubre la bodega (coral)
      const pQueda = hay ? Math.max(0, Math.min(100, (Number(o.quedan) || 0) / hay * 100)) : 0, pDesc = hay ? Math.max(2.5, Math.min(100, desc / hay * 100)) : 0;
      const medidor = faltan
        ? '<div class="ot-medidor mal"><i class="c" style="--w:' + Math.max(3, Math.min(100, o.mts ? hay / o.mts * 100 : 0)).toFixed(1) + '%"></i></div>'
        : '<div class="ot-medidor"><i class="q" style="--w:' + Math.min(pQueda, 100 - pDesc).toFixed(1) + '%"></i><i class="d" style="--w:' + pDesc.toFixed(1) + '%"></i></div>';
      const tt = comparte.length ? 'Esta tela también la usan ' + comparte.join(', ') + '. Se sirven por fecha de entrega: cada una descuenta de lo que queda.' : tit;
      return '<div class="ot-bodega nuevo' + (faltan ? ' mal' : '') + '" title="' + esc(tt) + '">' +
        '<div class="ot-hero"><small>' + (faltan ? 'NECESITA' : 'DESCUENTA') + '</small><div><b class="desc" data-n="' + desc + '" data-dec="2">' + dec(o.mts) + '</b><em>MTS</em></div></div>' +
        '<div class="ot-lado">' + lado('En bodega', entero(base, Math.floor), 'hay', hay) + (faltan ? lado('Faltan', entero(o.falta, Math.ceil), 'falta', Math.ceil(o.falta || 0)) : lado('Queda', entero(o.quedan, Math.floor), 'queda', Math.floor(o.quedan || 0))) + '</div>' +
        medidor + '</div>';
      if (o.situacion === 'no_alcanza') return '<div class="ot-bodega mal" title="' + esc(tit) + '">Bodega <b class="hay">' + entero(o.bodega, Math.round) + '</b> MTS · faltan <b class="falta">' + entero(o.falta, Math.ceil) + '</b> MTS</div>';
      return '<div class="ot-bodega" title="' + esc(tit) + '">Bodega <b class="hay">' + entero(o.bodega, Math.round) + '</b> MTS · quedan <b class="queda">' + entero(o.quedan, Math.floor) + '</b> MTS</div>';
    };
    const orderCard = o => {
      const [, cls] = SITUACION[o.situacion] || ['', ''];
      const sinPromedio = o.situacion === 'sin_promedio';
      const level = sinPromedio ? null : o.situacion === 'alcanza' ? 100 : o.mts ? Math.min(100, (o.disponible || 0) / o.mts * 100) : 0;
      const tono = o.situacion === 'alcanza' ? 'verde' : 'rojo';
      const alerta = o.situacion === 'no_alcanza' ? 'No alcanza · faltan ' + entero(o.falta, Math.ceil) + ' MTS' : o.situacion === 'sin_tela' ? 'No alcanza · la tela no está en Bodega' : '';
      const pares = !sinPromedio && o.exacto ? tallasPares(o) : [];
      const tiempo = tiempoSublim(o);
      const attrs = ' data-q="' + esc(norm([o.orden, o.cliente, o.proyecto, o.referencia, o.tela].join(' '))) + '" data-tela="' + esc(o.tela) + '" data-sit="' + o.situacion + '" data-sub="' + (o.estado === 'P' ? 'P' : 'pend') + '" data-fecha="' + esc(o.entrega || '') + '" data-sinfiltro="false" title="' + esc([o.cliente || 'Sin cliente', o.proyecto || 'Sin proyecto', pares.length ? 'Tallas: ' + pares.map(([t, n]) => t + ' ' + num(n)).join(' · ') : '', tiempo && tiempo[2] ? tiempo[2] : '', tiempo && tiempo[4] ? tiempo[4] : ''].filter(Boolean).join('\n')) + '"';
      const titTiempo = tiempo ? (tiempo[3] || 'Estimado: fecha de entrega menos los ' + (brechaDias || 14) + ' días que suelen pasar entre Sublimación y la entrega') : '';
      const materiales = (o.materiales || []).filter(m => Number(m.mts) > 0);
      const bloqueMateriales = materiales.length ? materiales.map(m => { const material = String(m.material || '').toUpperCase(); const esFusionado = Boolean(m.fusionado) || String(m.etiqueta || '').trim().toUpperCase() === 'FUSIONADO' || material === 'M4' || String(m.tela || '').trim().toUpperCase() === 'FUSIONADO'; const etiqueta = esFusionado ? 'FUSIONADO' : (material || (m.codigo ? 'COD ' + m.codigo : 'MATERIAL')); const baseFusionado = esFusionado ? materiales.find(x => String(x.material || '').toUpperCase() === 'M1') : null; const sinTela = m.situacion === 'sin_tela'; const mal = m.situacion === 'no_alcanza'; const bodegaNumero = Number(m.bodega ?? (baseFusionado && baseFusionado.bodega)) || 0; const tieneQueda = m.queda !== null && m.queda !== undefined && m.queda !== ''; const quedaPropia = tieneQueda ? Number(m.queda) : NaN; const quedaBase = Number(baseFusionado && baseFusionado.queda); const quedaFusionado = Number.isFinite(quedaPropia) ? quedaPropia : (Number.isFinite(quedaBase) ? Math.max(0, quedaBase - Number(m.mts || 0)) : null); const cobertura = sinTela ? 0 : Math.max(0, Math.min(100, bodegaNumero && m.mts ? bodegaNumero / Number(m.mts) * 100 : 0)); const saldo = sinTela ? 'Sin existencia' : (mal ? 'Faltan ' + num(m.falta) + ' MTS' : (Number.isFinite(quedaFusionado) ? num(quedaFusionado) + ' MTS' : 'Pendiente')); const estado = sinTela || mal ? ' bad' : ''; return '<div class="ot-dyn-material' + estado + '"><div class="ot-dyn-material-top"><span class="ot-dyn-material-tag">' + esc(etiqueta) + '</span><span class="ot-dyn-material-amount"><small>DESCUENTA</small><b>' + num(m.mts) + '<em>MTS</em></b></span></div><div class="ot-dyn-material-name">' + esc(m.tela || o.tela) + '</div><div class="ot-dyn-material-stats"><span>Descontar<b>' + num(m.mts) + ' MTS</b></span><span>Stock después<b>' + esc(saldo) + '</b></span></div><div class="ot-dyn-meter" aria-label="Cobertura de tela"><i style="--coverage:' + cobertura.toFixed(1) + '%"></i></div></div>'; }).join('') : '<div class="ot-dyn-material bad"><div class="ot-dyn-material-name">Sin promedio documentado para calcular el descuento.</div></div>';
      return '<article class="inventory-item-card ot ot-production-card ' + (cls === 'bad' ? 'bad' : '') + '"' + attrs + (level !== null ? ' data-lq="' + Math.round(level) + '" data-lq-tone="' + tono + '"' : '') + '><div class="ot-production-body ot-dynamic-body">' +
        '<div class="ot-dyn-head"><div class="orden"><small>ORDEN</small><b>' + esc(o.orden || 'Sin orden') + '</b></div><div class="proyecto"><small>PROYECTO</small><span title="' + esc(o.proyecto || 'Sin proyecto') + '">' + esc(o.proyecto || 'Sin proyecto') + '</span></div><div class="cliente"><small>CLIENTE</small><span>' + esc(o.cliente || 'Cliente sin nombre') + '</span></div><div class="referencia"><small>REFERENCIA</small><span>' + esc(o.referencia || '—') + '</span></div><div class="cantidad"><small>CANTIDAD</small><b>' + num(o.cantidad) + ' UND.</b></div></div>' +
        '<section class="ot-dyn-plan"><div class="ot-dyn-materials telas-' + Math.min(Math.max(materiales.length, 1), 4) + (materiales.length === 1 ? ' one' : '') + '">' + bloqueMateriales + '</div></section></div></article>';
    };
    if (poner(tCards, ordenes.length ? ordenes.map(orderCard).join('') : '<p class="bd-note">No hay pedidos programados pendientes de Sublimación.</p>')) {
      // los números de EN BODEGA / DESCUENTA / QUEDA cuentan hasta su valor cuando las tarjetas se dibujan o cambian
      if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) tCards.querySelectorAll('.ot-bodega.nuevo b[data-n]').forEach(el => {
        const n = Number(el.dataset.n) || 0, d = Number(el.dataset.dec) || 0, t0 = performance.now();
        const paso = t => { const k = Math.min(1, (t - t0) / 800), v = n * (1 - Math.pow(1 - k, 3)); el.textContent = v.toLocaleString('es-CO', {minimumFractionDigits: d, maximumFractionDigits: d}); if (k < 1) requestAnimationFrame(paso); };
        requestAnimationFrame(paso);
      });
    }
    filterTela();
  };
  tFilters.addEventListener('input', filterTela);
  tFilters.querySelector('.bd-clear').onclick = () => { tFilters.reset(); filterTela(); };
  const load2 = async (silencioso) => {
    try {
      const [response, prodResp] = await Promise.all([fetch('/api/inventarios/tela-necesaria', {cache: 'no-store'}), fetch('/api/produccion', {cache: 'no-store'}).catch(() => null)]);
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible calcular la tela necesaria');
      try {   // el tiempo por unidad de cada área sale de Producción, igual que la escalera de Inicio
        prodData = prodResp && prodResp.ok ? await prodResp.json() : null;
        unitData = prodData && window.indoorUnitTimes ? window.indoorUnitTimes(prodData) : null;
      } catch (_) { prodData = unitData = null; }
      panel.querySelector('.bd-updated').textContent = 'Tela calculada: ' + when(new Date().toISOString()) + ' · se actualiza sola cada minuto';
      renderTela(data);
    } catch (error) { if (!silencioso) { tCards.__h = null; tCards.innerHTML = '<p class="bd-note">' + esc(error.message) + '</p>'; } }
  };
  const showSubTab = name => {
    subTab = name;
    panel.querySelectorAll('[data-bd-tab]').forEach(b => { const on = b.dataset.bdTab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    body.hidden = name !== 'resumen';
    filtersBox.hidden = name !== 'resumen';
    body2.hidden = name !== 'tela';
    if (name === 'tela') load2(false); else load();
  };
  panel.addEventListener('click', event => { const tab = event.target.closest('[data-bd-tab]'); if (tab) showSubTab(tab.dataset.bdTab); });
  setInterval(() => { if (!document.hidden && panel.classList.contains('active') && subTab === 'tela') load2(true); }, 60000);

  const open = (button, destino = panel, cargar = () => (subTab === 'tela' ? load2(false) : load())) => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === destino));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    cargar();
  };

  const mount = () => {
    if (document.querySelector('[data-bodega-dashboard]')) return true;
    const group = [...document.querySelectorAll('.nav-group')].find(item => /INVENTARIOS/i.test(item.querySelector('.nav-parent')?.textContent || ''));
    const children = group?.querySelector('.nav-children');
    const main = document.querySelector('main');
    if (!children || !main) return false;
    main.appendChild(panel);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab inventory-control-nav';
    button.dataset.bodegaDashboard = 'true';
    button.innerHTML = '<span class="nav-icon">PC</span><strong>PANEL DE CONTROL</strong>';
    button.onclick = () => open(button);
    children.prepend(button);
    return true;
  };
  if (!mount()) { const timer = setInterval(() => { if (mount()) clearInterval(timer); }, 300); setTimeout(() => clearInterval(timer), 15000); }
})();
