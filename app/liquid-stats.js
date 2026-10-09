/* Estilo "líquido" compartido para las tarjetas de estadísticas con números (el mismo de Vencimiento de la cartera).
   Cualquier elemento con data-lq="NIVEL" (0 a 100) se convierte en tarjeta líquida: el relleno sube hasta ese nivel,
   con olas animadas y el porcentaje abajo a la derecha. Color opcional: data-lq-color="#rrggbb" o data-lq-tone="verde|azul|ambar|rojo|rosa|teal|violeta".
   Los demás módulos solo agregan el atributo; este archivo pone el estilo y mantiene el relleno al día cuando cambian los datos. */
(() => {
  'use strict';
  if (window.__liquidStats) return;
  const TONES = { verde: '#2f9e4f', oliva: '#7aa312', azul: '#3153e2', ambar: '#d38800', rojo: '#d94430', coral: '#eb5a3d', rosa: '#e31189', teal: '#12a58f', violeta: '#7b4bd6', gris: '#5d6c5a' };
  const css = document.createElement('style');
  css.textContent = `
  .lq{--liquid:#2f9e4f;--level:0%;position:relative!important;isolation:isolate;overflow:hidden!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:17px!important;background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(0,0,0,.18))!important;color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.4);transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}
  .lq:hover{transform:translateY(-4px);border-color:var(--liquid)!important;box-shadow:0 16px 30px color-mix(in srgb,var(--liquid) 28%,transparent)!important}
  .lq>.lq-fill{position:absolute;z-index:-2;left:0;right:0;bottom:0;height:var(--level);background:linear-gradient(180deg,color-mix(in srgb,var(--liquid) 80%,white),var(--liquid));opacity:.93;transition:height .9s cubic-bezier(.2,.8,.2,1)}
  .lq>.lq-wave{position:absolute;z-index:-1;left:-15%;bottom:calc(var(--level) - 10px);width:130%;height:25px;border-radius:50%;background:color-mix(in srgb,var(--liquid) 82%,white);opacity:.92;animation:lq-wave 4s ease-in-out infinite;transition:bottom .9s cubic-bezier(.2,.8,.2,1)}
  .lq[data-lq="0"]>.lq-wave{display:none}
  .lq>.lq-pct{position:absolute;right:13px;bottom:10px;z-index:1;margin:0;padding:0;font:900 .68rem Arial;font-style:normal;opacity:.92;pointer-events:none;background:none;border:0;width:auto;height:auto}
  .lq[data-lq-nopct]>.lq-pct{display:none}
  .lq::after{content:none!important}
  .lq .dash-load-legend b{color:#13200c!important;text-shadow:none}
  .lq :is(h4,h3,span,strong,b,small,em,p,li,label,div){color:#fff!important}
  .lq :is(small,li>span){opacity:.92}
  .lq .dash-big strong,.lq .dash-big b{color:#fff!important}
  .lq .dash-time-bar{display:none}.lq .dash-time-id span{opacity:.9}
  .lq .dash-bottleneck{color:#2a0e0a!important;text-shadow:none}
  @keyframes lq-wave{0%,100%{transform:translateX(-2%) scaleY(.9)}50%{transform:translateX(3%) scaleY(1.12)}}
  @media(prefers-reduced-motion:reduce){.lq>.lq-wave{animation:none}.lq>.lq-fill,.lq>.lq-wave{transition:none}}
  /* Rollos de tela: disco de vidrio con anillo que muestra qué tan lleno está el rollo */
  @property --p{syntax:'<number>';initial-value:100;inherits:false}
  body .inventory-item-card .inventory-rolls{gap:10px;margin:10px 0 6px}
  body .inventory-item-card .inventory-roll{--p:100;position:relative;display:inline-grid;place-items:center;width:48px;min-width:48px;height:48px;padding:0;border-width:0!important;border-radius:50%;box-sizing:border-box;font:900 13.5px Arial;letter-spacing:-.02em;text-shadow:0 1px 3px rgba(0,0,0,.75);cursor:default;
    background-image:radial-gradient(circle at 32% 22%,rgba(255,255,255,.34),rgba(255,255,255,.05) 46%,rgba(0,0,0,.34) 100%)!important;
    box-shadow:0 10px 16px -9px rgba(0,0,0,.95),inset 0 -7px 10px rgba(0,0,0,.4),inset 0 2px 3px rgba(255,255,255,.3)!important;
    transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s;animation:rollFill .9s cubic-bezier(.2,.8,.2,1) both}
  body .inventory-item-card .inventory-roll::before{content:"";position:absolute;inset:0;border-radius:50%;padding:4px;pointer-events:none;
    background:conic-gradient(var(--rc,currentColor) calc(var(--p) * 1%),rgba(255,255,255,.12) 0);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;
    filter:drop-shadow(0 0 3px var(--rc,currentColor))}
  @keyframes rollFill{from{--p:0;opacity:.2}to{opacity:1}}
  body .inventory-item-card .inventory-roll:hover{transform:translateY(-4px) scale(1.1);box-shadow:0 16px 18px -8px rgba(0,0,0,.95),0 0 16px -2px var(--rc,currentColor),inset 0 -7px 10px rgba(0,0,0,.4),inset 0 2px 3px rgba(255,255,255,.35)!important}
  body .inventory-item-card .inventory-roll.roll-left{animation:rollFill .9s cubic-bezier(.2,.8,.2,1) both,rollPulse 2.4s ease-in-out .9s infinite}
  @keyframes rollPulse{50%{filter:brightness(1.3)}}
  .inventory-item-card .stock-min{position:absolute;left:0;right:0;z-index:1;height:0;border-top:1px dashed rgba(255,255,255,.65);pointer-events:none}.inventory-item-card .stock-min em{position:absolute;right:10px;top:-13px;font:800 .54rem Arial;font-style:normal;letter-spacing:.04em;text-transform:uppercase;color:#fff;opacity:.85;text-shadow:0 1px 2px rgba(0,0,0,.7)}
  body .inventory-item-card.lq{--liquid:#12a58f}body .inventory-item-card.lq>.lq-fill{opacity:.5}body .inventory-item-card.lq>.lq-wave{opacity:.62}
  body .inventory-item-card.lq .inv-total{color:#fff!important;font-size:1.7rem;text-shadow:0 2px 6px rgba(0,0,0,.55)}
  body .inventory-item-card.lq .inv-badge{background:rgba(0,0,0,.35)!important;color:#fff!important;border:1px solid rgba(255,255,255,.2)}
  @media(prefers-reduced-motion:reduce){body .inventory-item-card .inventory-roll,body .inventory-item-card .inventory-roll.roll-left{transition:none;animation:none}}
  `;
  document.head.appendChild(css);

  const clamp = n => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  function upgrade(el) {
    const raw = el.getAttribute('data-lq');
    if (raw === null) return;
    const level = clamp(parseFloat(String(raw).replace(',', '.')));
    if (!el.classList.contains('lq')) {
      el.classList.add('lq');
      const fill = document.createElement('i'); fill.className = 'lq-fill'; fill.setAttribute('aria-hidden', 'true');
      const wave = document.createElement('i'); wave.className = 'lq-wave'; wave.setAttribute('aria-hidden', 'true');
      const pct = document.createElement('em'); pct.className = 'lq-pct'; pct.setAttribute('aria-hidden', 'true');
      el.prepend(wave); el.prepend(fill); el.appendChild(pct);
    }
    const color = el.getAttribute('data-lq-color') || TONES[el.getAttribute('data-lq-tone')] || '';
    if (color) el.style.setProperty('--liquid', color);
    el.style.setProperty('--level', level + '%');
    const label = el.querySelector(':scope>.lq-pct'); if (label) label.textContent = Math.round(level) + '%';
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.hasAttribute && root.hasAttribute('data-lq')) upgrade(root);
    root.querySelectorAll && root.querySelectorAll('[data-lq]').forEach(upgrade);
  }
  // Anillo de los rollos de tela: cuánto de un rollo completo (~120 m) tiene este rollo.
  const FULL_ROLL = 120;
  function rollify(el) {
    if (!el.classList || !el.classList.contains('inventory-roll') || el.dataset.ring === el.textContent) return;
    const meters = parseFloat(String(el.textContent).replace(/[^0-9.,]/g, '').replace(',', '.'));
    el.dataset.ring = el.textContent;
    const ring = getComputedStyle(el).borderTopColor;   // el color de su borde original (verde nuevo, naranja empezado, azul de Sublimación) pasa al anillo
    if (ring && ring !== 'rgba(0, 0, 0, 0)') el.style.setProperty('--rc', ring);
    el.style.setProperty('--p', String(Number.isFinite(meters) ? Math.max(6, Math.min(100, Math.round(meters / FULL_ROLL * 100))) : 100));
  }
  function scanRolls(root) {
    if (root.nodeType !== 1) return;
    rollify(root);
    root.querySelectorAll && root.querySelectorAll('.inventory-roll').forEach(rollify);
  }
  scanRolls(document.body);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scanRolls))).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'attributes') upgrade(record.target);
      else record.addedNodes.forEach(scan);
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-lq', 'data-lq-color', 'data-lq-tone'] });
  window.__liquidStats = { upgrade, scan, TONES };
})();
