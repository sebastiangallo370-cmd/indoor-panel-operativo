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
    '@media(prefers-reduced-motion:reduce){.nl-goo.ready .nl-blob{transition:none!important}}'
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
