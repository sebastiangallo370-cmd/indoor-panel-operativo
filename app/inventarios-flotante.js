/* Inventarios · todo el módulo con el estilo flotante de Inicio (Panel de control, Bodegas, Stock tela y demás pestañas, Códigos de barras).
   Solo CSS (no toca datos ni lógica): las cabeceras, barras de pestañas, cuadros de filtros y recuadros de grupo pierden fondo, borde, sombra
   y desenfoque; los botones, pestañas, campos y chips flotan con sombra suave. Las tarjetas de estadística (estilo líquido, clase lq) se conservan.
   Para apagarlo: localStorage.setItem('indoor-inv-flotante-off','1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-inv-flotante-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('inventarios-flotante')) return;
  const PANELES = ['bodega-dashboard', 'inventario', 'bodegas', 'codigos-barras'];
  // prefijo por panel: R('x, y') → "html body .panel[data-panel=a] x, … y, …"
  const R = lista => PANELES.map(p => lista.split(',').map(s => `html body .panel[data-panel="${p}"] ${s.trim()}`).join(',')).join(',');
  const FLOTA = 'border:0!important;box-shadow:0 10px 24px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.08)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important';
  const SIN_CAJA = 'background:none!important;background-color:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important';
  const css = `
  /* cajas contenedoras: sin fondo, borde ni sombra */
  ${R('.bd-head,.bd-subtabs,.dash-tabs,.bd-filters,.mf-form,.sa-card,.bd-tfilters,.bd-note,.bg-head,.bg-filters,.bg-group,.bg-actions,.bg-inline,.cb-hero,.cb-scan,.cb-kpi>div,section.inventory-table-card,.inventory-table-card')}{${SIN_CAJA}}
  /* tarjetas (bodegas, tela, códigos): un bloque muy suave, apenas visible. Las tarjetas de estadística (lq) no se tocan */
  ${R('article.inventory-item-card:not(.lq),article.cb-card')}{background:rgba(255,255,255,.03)!important;border:1px solid rgba(255,255,255,.045)!important;box-shadow:none!important;border-radius:18px!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  /* tarjetas de cada tela en Stock tela (estilo líquido): marco casi invisible y relleno tenue; las de stock bajo conservan un tinte discreto */
  html body .panel[data-panel="inventario"] article.inventory-item-card.lq{border:1px solid rgba(255,255,255,.06)!important;box-shadow:none!important;border-radius:18px!important}
  html body .panel[data-panel="inventario"] article.inventory-item-card.lq .lq-fill,html body .panel[data-panel="inventario"] article.inventory-item-card.lq .lq-wave{opacity:.4!important}
  html body .panel[data-panel="inventario"] article.inventory-item-card.lq[data-lq-tone="rojo"]{border-color:rgba(255,107,107,.3)!important}
  html body .panel[data-panel="inventario"] article.inventory-item-card.lq[data-lq-tone="ambar"]{border-color:rgba(255,179,71,.28)!important}
  /* tarjetas-botón de resumen por bodega: píldoras flotantes */
  ${R('button.inventory-item-card.bg-sum:not(.lq)')}{background:rgba(255,255,255,.05)!important;${FLOTA};border-radius:16px!important}
  /* botones, pestañas, interruptor, campos y selectores: flotantes */
  ${R('button:not(.on):not(.bg-sum),.bd-switch,.bd-refresh,.bd-clear')}{background:rgba(255,255,255,.07)!important;${FLOTA};border-radius:12px!important;transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s,background-color .25s}
  ${R('button.on')}{${FLOTA}}
  ${R('input,select,textarea')}{background:rgba(255,255,255,.06)!important;${FLOTA};border-radius:12px!important}
  ${R('button:not(:disabled):not(.on):hover,.bd-refresh:hover,.bd-clear:hover')}{filter:brightness(1.12);background:rgba(255,255,255,.13)!important}
  /* chips de «Telas por reponer» */
  ${R('.sa-item')}{background:rgba(255,255,255,.05)!important;${FLOTA};border-radius:14px!important}
  ${R('.sa-chip')}{border:0!important}
  @media(prefers-reduced-motion:reduce){${R('button,.bd-switch')}{transition:none!important}${R('button:hover')}{transform:none!important}}
  `;
  const st = document.createElement('style');
  st.id = 'inventarios-flotante';
  st.textContent = css;
  document.head.appendChild(st);
})();
