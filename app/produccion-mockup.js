/* Producción · mockup con entrada suave al pasar el mouse (solo CSS, no cambia datos):
   - La imagen se acerca despacio dentro de su marco y el marco se eleva con sombra.
   - Los botones de copiar suben y aparecen en cascada.
   - Los globos de ayuda (data-tip) de los botones salen deslizándose en vez de aparecer de golpe.
   Solo en escritorio con mouse. Para apagarlo: localStorage.setItem('indoor-mockup-off','1'). */
(function () {
  'use strict';
  try { if (localStorage.getItem('indoor-mockup-off') === '1') return; } catch (e) { /* sin almacenamiento */ }
  if (document.getElementById('produccion-mockup')) return;
  const P = 'html body.production-mode ';
  const E = 'cubic-bezier(.22,1,.36,1)';
  const st = document.createElement('style');
  st.id = 'produccion-mockup';
  st.textContent = `
  @media(hover:hover) and (pointer:fine){
    ${P}.trace-card .trace-media{position:relative;overflow:hidden;transition:box-shadow .5s ${E},transform .5s ${E}}
    ${P}.trace-card .trace-media img{transition:transform .9s ${E},filter .6s ease;transform-origin:50% 55%}
    ${P}.trace-card .trace-media:hover img{transform:scale(1.06)}
    ${P}.trace-card .trace-media:hover{box-shadow:0 18px 38px -20px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.12)}
    /* botones de copiar: suben en cascada */
    ${P}.trace-card .trace-copy-tools button{opacity:.78;transition:opacity .35s ease,transform .45s ${E},background .14s,color .14s,border-color .14s!important}
    ${P}.trace-card .trace-media:hover .trace-copy-tools button{opacity:1}
    ${P}.trace-card .trace-media:hover .trace-copy-tools button:nth-child(2){transition-delay:.05s}
    ${P}.trace-card .trace-media:hover .trace-copy-tools button:nth-child(3){transition-delay:.1s}
    ${P}.trace-card .trace-media:hover .trace-copy-tools button:nth-child(4){transition-delay:.15s}
    ${P}.trace-card .trace-copy-tools button:hover{transform:scale(1.09)!important}
    /* globos de ayuda: deslizan y se aclaran */
    ${P}.trace-rail button::after{transform:translate(10px,-50%)!important;transition:opacity .28s ease,transform .38s ${E}!important}
    ${P}.trace-rail button:hover::after,${P}.trace-rail button:focus-visible::after{transform:translate(0,-50%)!important}
  }
  @media(prefers-reduced-motion:reduce){
    ${P}.trace-card .trace-media img,${P}.trace-card .trace-copy-tools button,${P}.trace-rail button::after{transition:none!important}
    ${P}.trace-card .trace-media:hover img{transform:none}
  }
  `;
  document.head.appendChild(st);
})();
