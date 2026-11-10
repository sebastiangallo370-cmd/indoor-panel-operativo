// Barra de navegación de arriba (computador): la opción activa va sobre una burbuja lima líquida
// que se desliza y se estira hacia la siguiente opción (igual que la barra inferior del celular).
// Solo dibuja una capa detrás de los botones; no cambia el menú ni los desplegables.
(function(){
  if(window.__navLiquid)return;window.__navLiquid=true;
  var NAV='html body.top-navigation .sidebar nav.tabs';
  var H=38;
  var css=[
    '@media(min-width:701px){',
      NAV+'{position:relative;isolation:isolate}',
      '.nl-goo{position:absolute;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none;filter:url(#nl-goo) drop-shadow(0 0 9px rgba(208,244,76,.4))}',
      '.nl-blob{position:absolute;left:0;top:0;width:var(--nw,0px);height:var(--nh,0px);border-radius:12px;background:#d0f44c;transform:translate(var(--nx,0px),var(--ny,0px));opacity:0}',
      '.nl-goo.on .nl-blob{opacity:1}',
      NAV+' .tab strong,'+NAV+' .nav-parent strong{transition:color .14s ease .09s,-webkit-text-fill-color .14s ease .09s}',
      '.nl-goo.ready .nl-blob.b1{transition:transform .24s cubic-bezier(.3,1.25,.5,1),width .24s cubic-bezier(.3,1.25,.5,1)}',
      '.nl-goo.ready .nl-blob.b2{transition:transform .42s cubic-bezier(.25,1.1,.4,1),width .42s cubic-bezier(.25,1.1,.4,1)}',
      NAV+' .nl-on,'+NAV+' .nl-on:hover{background:transparent!important;box-shadow:none!important;border-color:transparent!important;text-shadow:none!important;outline-color:transparent!important}',
      NAV+' .nl-on,'+NAV+' .nl-on *{color:#10150e!important;-webkit-text-fill-color:#10150e!important;text-shadow:none!important}',
    '}',
    '@media(prefers-reduced-motion:reduce){.nl-goo.ready .nl-blob{transition:none!important}}',
    /* Controles compactos, pero con superficie táctil real y sin recortar la
       insignia de alertas. */
    '.systems{display:flex!important;align-items:center!important;gap:8px!important}',
    '.systems .theme-icon,.systems #agentes-hub summary,.systems #al-btn.header-alert{flex:0 0 36px!important;width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}',
    '.systems .theme-icon:hover,.systems #agentes-hub summary:hover,.systems #al-btn.header-alert:hover{background:transparent!important;border-color:transparent!important;box-shadow:none!important;color:#efff81!important;transform:translateY(-1px)}',
    '.systems .theme-icon svg,.systems #agentes-hub summary svg{display:block!important;width:17px!important;height:17px!important}',
    /* La campana usa un trazo más ancho y con estados de color: necesita aire
       propio para que los extremos no se recorten en la barra compacta. */
    '.systems #al-btn.header-alert{display:grid!important;place-items:center!important;overflow:visible!important}',
    '.systems #al-btn.header-alert svg{display:block!important;width:20px!important;height:20px!important;min-width:20px!important;overflow:visible!important}',
    '.systems .user-menu{margin-left:2px}.systems .user-menu summary{gap:5px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}',
    '.systems .user-avatar{width:auto!important;height:auto!important;padding:0!important;background:transparent!important;color:#d0f44c!important;font-size:12px!important;box-shadow:none!important;border:0!important;border-radius:0!important}',
    '.systems .user-info{max-width:145px!important}',
    '.systems .user-info strong{font-size:.7rem!important}',
    '.systems .user-info small{font-size:.6rem!important}',
    '.systems #al-btn.header-alert b{transform:scale(.78);transform-origin:top right}',
    '.systems .theme-icon,.systems #agentes-hub summary,.systems #al-btn.header-alert{position:relative!important;transition:transform .18s ease,color .18s ease!important}',
    '.systems .theme-icon::after,.systems #agentes-hub summary::after,.systems #al-btn.header-alert::after{content:"";position:absolute;left:50%;bottom:-4px;width:0;height:2px;border-radius:2px;background:#d0f44c;box-shadow:0 0 8px #d0f44c;transform:translateX(-50%);transition:width .18s ease}',
    '.systems .theme-icon:hover::after,.systems #agentes-hub summary:hover::after,.systems #agentes-hub[open] summary::after,.systems #al-btn.header-alert:hover::after{width:13px}',
    '.systems .theme-icon:hover,.systems #agentes-hub summary:hover,.systems #al-btn.header-alert:hover{transform:translateY(-2px) scale(1.12)!important}',
    '.systems .theme-icon:hover svg{transform:rotate(20deg)}.systems .theme-icon svg{transition:transform .25s ease}',
    '.systems .user-info small::before{content:"";display:inline-block;width:5px;height:5px;margin:0 5px 1px 0;border-radius:50%;background:#d0f44c;box-shadow:0 0 0 0 rgba(208,244,76,.7);animation:headerStatus 2s infinite}',
    '.systems .user-menu summary:hover .user-info strong{color:#d0f44c}@keyframes headerStatus{0%,100%{box-shadow:0 0 0 0 rgba(208,244,76,.55)}50%{box-shadow:0 0 0 4px rgba(208,244,76,0)}}',
    /* Controles ligeros: sin cápsula grande, solo iconos y el monograma del usuario. */
    '.brand .systems{gap:8px!important;min-height:38px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;animation:none!important}',
    '.brand .systems .user-menu{margin-left:4px;padding-left:9px;border-left:1px solid rgba(222,255,207,.25)}',
    /* La cabecera conserva solo el monograma; los datos completos siguen en el menú desplegable. */
    '.brand .systems .user-menu summary .user-info,.brand .systems .user-menu summary>[aria-hidden="true"]{display:none!important}',
    '.brand .systems .user-menu summary{min-width:36px!important;min-height:36px!important;justify-content:center!important}',
    '.brand .systems .user-avatar{display:grid!important;place-items:center;width:32px!important;height:32px!important;border:1px solid rgba(208,244,76,.7)!important;border-radius:50%!important;background:linear-gradient(145deg,rgba(215,255,88,.22),rgba(75,108,64,.16))!important;font-size:11px!important;font-weight:900!important;letter-spacing:.05em!important;box-shadow:inset 0 1px 1px rgba(255,255,255,.35),0 0 12px rgba(208,244,76,.12)!important}',
    '.brand .systems .theme-icon::after,.brand .systems #agentes-hub summary::after,.brand .systems #al-btn.header-alert::after{bottom:-1px}'
  ].join('');
  var style=document.createElement('style');
  style.textContent=css;
  document.head.appendChild(style);

  var holder=document.createElement('div');
  holder.style.cssText='position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML='<svg width="0" height="0" aria-hidden="true"><defs><filter id="nl-goo" x="-10%" y="-80%" width="120%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"/></filter></defs></svg>';
  var nav=null,goo=null,timer=0;

  function visible(el){var r=el.getBoundingClientRect();return r.width>1&&r.height>1}
  function activeTarget(){
    var found=null;
    [].forEach.call(nav.children,function(k){
      if(k.matches('.tab')){if(k.classList.contains('active')&&visible(k))found=k}
      else if(k.matches('.nav-group')&&k.querySelector('.tab.active')){
        var t=k.querySelector(':scope > .nav-parent')||k.querySelector(':scope > .tab')||k;
        if(visible(t))found=t;
      }
    });
    return found;
  }
  function place(){
    timer=0;
    if(!nav||!goo)return;
    var target=nav.offsetParent&&activeTarget();
    nav.querySelectorAll('.nl-on').forEach(function(el){if(el!==target)el.classList.remove('nl-on')});
    if(!target){goo.classList.remove('on');return}
    target.classList.add('nl-on');
    var nr=nav.getBoundingClientRect(),r=target.getBoundingClientRect();
    goo.style.setProperty('--nx',Math.round(r.left-nr.left)+'px');
    goo.style.setProperty('--ny',Math.round(r.top-nr.top+(r.height-H)/2)+'px');
    goo.style.setProperty('--nw',Math.round(r.width)+'px');
    goo.style.setProperty('--nh',H+'px');
    goo.classList.add('on');
    if(!goo.classList.contains('ready'))setTimeout(function(){goo.classList.add('ready')},120);
  }
  function schedule(){if(!timer)timer=setTimeout(place,30)}
  function init(){
    nav=document.querySelector('.sidebar nav.tabs');
    if(!nav){setTimeout(init,500);return}
    document.body.appendChild(holder);
    goo=document.createElement('div');
    goo.className='nl-goo';
    goo.setAttribute('aria-hidden','true');
    goo.innerHTML='<span class="nl-blob b1"></span><span class="nl-blob b2"></span>';
    nav.insertBefore(goo,nav.firstChild);
    new MutationObserver(function(records){
      // ignorar los cambios que hace esta misma capa
      if(records.every(function(m){return m.target===goo||goo.contains(m.target)}))return;
      schedule();
    }).observe(nav,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
    window.addEventListener('resize',schedule);
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
    [200,800,2000].forEach(function(ms){setTimeout(place,ms)});
    place();
  }
  init();
})();

/* Submódulos flotantes: se mantienen legibles sobre cualquier panel sin
   contenedor, borde ni bloque rectangular. */
(function () {
  if (document.getElementById('interfaz-flotante')) return;
  var N = 'html body.top-navigation.top-navigation ';
  var css = [
    '@media(min-width:861px){',
    /* La barra debe tapar por completo el contenido: el degradado transparente
       dejaba textos de los paneles visibles detrás de los botones. */
    N+'.sidebar{z-index:101!important;isolation:isolate!important;background:linear-gradient(180deg,#061109 0%,#07120a 100%)!important;border:0!important;box-shadow:0 1px 0 rgba(208,244,76,.16)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    N+'.sidebar :is(.brand,.tabs,.topbar,.systems){background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    N+'.sidebar::before,'+N+'.sidebar::after{display:none!important}',
    N+'.sidebar .tab{background:transparent!important;border-color:transparent!important;box-shadow:none!important;border-radius:10px!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background .25s!important}',
    N+'.sidebar .nav-children{left:50%!important;right:auto!important;margin-left:0!important;translate:-50% 0;background:radial-gradient(closest-side ellipse at 38% 50%,rgba(3,7,4,.94) 0%,rgba(3,7,4,.86) 55%,rgba(3,7,4,0) 100%)!important;background-color:transparent!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;padding:26px 44px!important}',
    N+'.sidebar .nav-children:has(> .tab:nth-child(7)){grid-template-columns:repeat(2,max-content)!important;grid-template-rows:repeat(8,auto)!important;grid-auto-flow:column!important;column-gap:34px;width:max-content}',
    N+'.sidebar .nav-children:has(> .tab:nth-child(7)) > .tab{min-width:0}',
    N+'.sidebar .nav-children::before,'+N+'.sidebar .nav-children::after{display:none!important}',
    /* Los submenús cerrados no pueden dejar texto fantasma detrás de la navegación. */
    N+'.sidebar .nav-group.collapsed > .nav-children{display:none!important}',
    N+'.sidebar .nav-group:not(.collapsed) > .nav-children{z-index:100!important}',
    N+'.sidebar .nav-children .tab{background:transparent!important;color:#fff!important;font-weight:800!important;text-shadow:0 0 1px #000,0 0 3px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.95),0 2px 16px rgba(0,0,0,.95),0 0 30px rgba(0,0,0,.85)}',
    N+'.sidebar .nav-children .tab.active,'+N+'.sidebar .nav-children .tab:hover{color:#d0ec93!important}',
    N+'.sidebar .nav-children .tab:hover,'+N+'.sidebar .nav-children .tab.active{background:rgba(255,255,255,.1)!important;box-shadow:0 10px 22px -12px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.1)!important}',
    N+'.sidebar :is(.tabs > .tab,.tabs > .nav-group > .nav-parent,.nav-group > .nav-parent){font-size:clamp(12.5px,.8vw,16px)!important;letter-spacing:.05em!important;padding-left:.85em!important;padding-right:.85em!important}',
    N+'.sidebar :is(.tab,.nav-parent){text-shadow:none!important;background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    N+'.sidebar .tab:hover{background:rgba(255,255,255,.1)!important}',
    '}',
    '@media(max-width:860px){',
    N+'.sidebar{background:linear-gradient(180deg,rgba(4,8,5,.82),rgba(4,8,5,0))!important;border:0!important;border-bottom:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    N+'.sidebar .systems,'+N+'.sidebar .nav-children{background:transparent!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    N+'.sidebar .systems > *{border-color:transparent!important}',
    N+'.sidebar .nav-children .tab{background:transparent!important;border-color:transparent!important;box-shadow:none!important;color:#fff!important;font-weight:800!important;text-shadow:0 0 3px rgba(0,0,0,.95),0 1px 10px rgba(0,0,0,.95)}',
    N+'.sidebar .nav-children .tab.active{background:rgba(255,255,255,.1)!important;color:#d0ec93!important}',
    'html body nav.mbar{border:0!important;background:linear-gradient(180deg,rgba(10,18,12,.78),rgba(6,12,8,.9))!important;box-shadow:0 14px 34px -10px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.07)!important}',
    '}',
    '@media(prefers-reduced-motion:reduce){'+N+'.sidebar .tab{transition:none!important}}'
  ].join('');
  var style = document.createElement('style');
  style.id = 'interfaz-flotante';
  style.textContent = css;
  document.head.appendChild(style);
})();
