// Aviso de telas por reponer: aparece al iniciar sesión mientras alguna tela esté por debajo de su stock mínimo.
(function(){
  if(window.__alertasTelas)return;window.__alertasTelas=true;
  var HORA=16,open=false;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(Number(n)||0)}
  function today(){var d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
  function get(store,key){try{return window[store].getItem(key)}catch(e){return null}}
  function set(store,key,value){try{window[store].setItem(key,value)}catch(e){}}
  var css=[
    '.at-overlay{visibility:visible!important;position:fixed;inset:0;z-index:100003;display:grid;place-items:center;padding:20px;background:rgba(4,6,4,.72);backdrop-filter:blur(4px);animation:at-in .12s ease-out}',
    '@keyframes at-in{from{opacity:0}to{opacity:1}}',
    '.at-card{width:min(560px,100%);max-height:min(88vh,720px);display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.24);border-radius:24px;background:radial-gradient(120% 70% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(40,48,38,.92),rgba(12,16,11,.95));-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);color:#eef2e9;font-family:Arial,sans-serif;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px rgba(255,154,31,.55),0 0 28px -6px #ff9a1f,0 34px 90px rgba(0,0,0,.65)}',
    '.at-head{padding:22px 24px 8px}.at-head small{display:block;font:800 10.5px Arial;letter-spacing:.18em;color:#ffc98a}',
    '.at-head h3{margin:6px 0 6px;font-size:20px;line-height:1.2;display:flex;align-items:center;gap:10px}.at-head h3 i{display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 9px;border-radius:999px;background:rgba(255,154,31,.16);border:1px solid rgba(255,154,31,.6);font:900 .85rem Arial;font-style:normal;color:#ffc98a}.at-head p{margin:0;font-size:13.5px;line-height:1.5;color:#b9c6b4}',
    '.at-list{display:grid;gap:8px;overflow:auto;padding:12px 24px}',
    '.at-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 14px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(255,255,255,.06)}',
    '.at-row b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.at-row small{color:#93a28f;font-size:11.5px}',
    '.at-chip{padding:3px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase}',
    '.at-chip.agotado{background:rgba(255,106,90,.18);color:#ff9a8c;border:1px solid rgba(255,106,90,.5)}.at-chip.bajo{background:rgba(255,184,107,.16);color:#ffc98a;border:1px solid rgba(255,184,107,.45)}',
    '.at-num{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}.at-num em{display:block;font-style:normal;color:#93a28f;font-size:11px}',
    '.at-foot{display:flex;gap:10px;padding:14px 24px 22px;flex-wrap:wrap}',
    '@media(max-width:560px){.at-overlay{padding:12px}.at-card{max-height:92vh}.at-head{padding:18px 18px 6px}.at-head h3{font-size:18px}.at-list{padding:10px 18px}.at-row{grid-template-columns:1fr!important;gap:8px}.at-row b{white-space:normal!important}.at-row>div:last-child{justify-content:space-between}.at-foot{flex-direction:column;padding:12px 18px 18px}.at-btn{flex:none!important;width:100%!important;min-height:46px!important}}',
    '.at-btn{flex:1;min-height:44px;border:1.5px solid #d0f44c;border-radius:12px;background:transparent;color:#d0f44c;font:800 12px Arial;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}',
    '.at-btn.main{background:rgba(255,255,255,.94);border-color:#fff;color:#10150e}.at-btn{border-color:rgba(255,255,255,.5);color:#fff}.at-mas{padding:4px 2px;text-align:center;font:700 12px Arial;color:#b9c6b4}.at-btn:hover{filter:brightness(1.1)}'
  ].join('');
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  var modal=null;
  function showModal(alerts,reason){
    if(modal||!alerts.length)return;
    var ov=modal=document.createElement('div');ov.className='at-overlay';
    ov.innerHTML='<div class="at-card" role="alertdialog" aria-modal="true"><div class="at-head"><small>'+(reason==='tarde'?'RECORDATORIO · 4:00 P. M.':'AVISO DE INVENTARIO')+'</small>'+
      '<h3>Telas por reponer <i>'+alerts.length+'</i></h3><p>Están por debajo de su stock mínimo.</p></div>'+
      '<div class="at-list">'+alerts.map(function(a){return '<div class="at-row"><div><b title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</b><small>'+(a.pedidos?a.pedidos+' pedidos de clientes':'Stock mínimo definido')+'</small></div><div style="display:flex;align-items:center;gap:10px"><span class="at-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotada':'Baja')+'</span><div class="at-num">'+fmt(a.total)+' MTS<em>mín '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></div></div></div>'}).join('')+'</div>'+
      '<div class="at-foot"><button type="button" class="at-btn" data-close>Entendido</button><button type="button" class="at-btn main" data-go>Ver inventario</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    function close(){modal=null;ov.remove()}
    ov.addEventListener('click',function(e){
      if(e.target.closest('[data-close]')||e.target===ov)close();
      else if(e.target.closest('[data-go]')){close();var t=document.querySelector('[data-bodega-dashboard]');if(t){var g=t.closest('.nav-group');if(g)g.classList.remove('collapsed');t.click()}}
    });
    document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'&&modal===ov){close();document.removeEventListener('keydown',onKey)}});
  }
  function show(alerts,reason){
    if(alerts.length&&(reason==='sesion'||reason==='tarde'))showModal(alerts,reason);
  }

  function check(reason){
    // la primera consulta ya la lanzó la cabecera de la página, apenas empezó a cargar
    var first=reason==='sesion'&&window.__telasP,request=first?window.__telasP:fetch('/api/alertas-telas',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null});
    if(first)window.__telasP=null;
    return request.then(function(d){
      if(!d||!d.aplica)return;
      if(reason==='sesion'){
        // un aviso por cada inicio de sesión (la marca cambia cuando la persona vuelve a entrar con su usuario)
        if(get('localStorage','at_sesion')===d.sesion)return;
        set('localStorage','at_sesion',d.sesion);
      }
      if(!d.alertas||!d.alertas.length)return;
      show(d.alertas,reason);
      if(reason==='tarde'||new Date().getHours()>=HORA)set('localStorage','at_dia',today());
    }).catch(function(){});
  }

  // 1) cada vez que la persona inicia sesión
  check('sesion');

  // 2) AVISO INMEDIATO cuando una tela no hay (agotada) o no alcanza para los pedidos programados.
  // Se consulta cada 30 s mientras la página está abierta; cada faltante avisa una vez y, si se resuelve y vuelve a faltar, avisa de nuevo.
  var KF='at_faltantes',fmodal=null;
  function ent(n,f){return f(Number(n)||0).toLocaleString('es-CO',{maximumFractionDigits:0})}
  function vistas(){try{return JSON.parse(get('localStorage',KF)||'[]')}catch(e){return []}}
  // ---- Alerta «el agente de inventarios detectó una producción sin tela»: logo de Indoor, cinta que corre, sirena, mensaje que se escribe y barras que se llenan
  var css2=[
    '.ia-overlay{visibility:visible!important;position:fixed;inset:0;z-index:100004;display:grid;place-items:center;padding:18px;background:radial-gradient(90% 70% at 50% 40%,rgba(120,20,10,.55),rgba(3,5,3,.9));backdrop-filter:blur(7px);animation:ia-fade .25s ease-out}',
    '@keyframes ia-fade{from{opacity:0}to{opacity:1}}',
    '.ia-overlay:before{content:"";position:absolute;inset:-30%;background:conic-gradient(from 0deg,transparent 0 70%,rgba(255,106,90,.22) 80%,transparent 90%);animation:ia-spin 5s linear infinite;pointer-events:none}',
    '@keyframes ia-spin{to{transform:rotate(360deg)}}',
    '.ia-card{position:relative;width:min(640px,100%);max-height:min(94vh,860px);display:flex;flex-direction:column;overflow:hidden;border-radius:28px;border:1px solid rgba(255,255,255,.22);background:radial-gradient(110% 60% at 15% 0%,rgba(255,255,255,.12),transparent 55%),linear-gradient(165deg,#1b221a,#0b0f0b 70%);color:#f2f6ee;font-family:Arial,sans-serif;box-shadow:0 0 0 1px rgba(255,106,90,.35),0 30px 90px -20px #000,0 0 80px -10px rgba(255,106,90,.55);animation:ia-pop .7s cubic-bezier(.2,1.4,.3,1) both,ia-aura 2.2s ease-in-out .7s infinite}',
    '@keyframes ia-pop{0%{opacity:0;transform:translateY(40px) scale(.82) rotate(-2deg)}60%{opacity:1;transform:translateY(-6px) scale(1.03) rotate(.6deg)}100%{transform:none}}',
    '@keyframes ia-aura{0%,100%{box-shadow:0 0 0 1px rgba(255,106,90,.35),0 30px 90px -20px #000,0 0 60px -12px rgba(255,106,90,.45)}50%{box-shadow:0 0 0 1px rgba(255,160,90,.7),0 30px 90px -20px #000,0 0 110px 0 rgba(255,120,70,.7)}}',
    '.ia-tape{overflow:hidden;white-space:nowrap;background:repeating-linear-gradient(-45deg,#ffd23f 0 14px,#16110a 14px 28px);padding:6px 0;border-bottom:1px solid rgba(0,0,0,.6)}',
    '.ia-tape-in{display:inline-block;padding-left:100%;animation:ia-marq 14s linear infinite;font:900 11px Arial;letter-spacing:.28em;color:#16110a;text-shadow:0 0 6px #ffd23f,0 0 2px #ffd23f}',
    '.ia-tape-in span{display:inline-block;margin:0 14px;padding:2px 12px;background:#ffd23f;border-radius:999px}',
    '@keyframes ia-marq{to{transform:translateX(-100%)}}',
    '.ia-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px 0}',
    '.ia-logo{height:34px;width:auto;filter:drop-shadow(0 0 10px rgba(208,244,76,.65));animation:ia-logo 2.6s ease-in-out infinite}',
    '@keyframes ia-logo{0%,100%{transform:scale(1);filter:drop-shadow(0 0 6px rgba(208,244,76,.45))}50%{transform:scale(1.07);filter:drop-shadow(0 0 16px rgba(208,244,76,.95))}}',
    '.ia-bot{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;border:1px solid rgba(208,244,76,.45);background:rgba(208,244,76,.1);font:800 10.5px Arial;letter-spacing:.14em;color:#d0f44c;white-space:nowrap}',
    '.ia-bot i{width:8px;height:8px;border-radius:50%;background:#ff6a5a;box-shadow:0 0 0 0 rgba(255,106,90,.8);animation:ia-live 1.1s infinite}',
    '@keyframes ia-live{0%{box-shadow:0 0 0 0 rgba(255,106,90,.85)}100%{box-shadow:0 0 0 12px rgba(255,106,90,0)}}',
    '.ia-body{overflow:auto;padding:6px 22px 4px;-webkit-overflow-scrolling:touch}',
    '.ia-top{display:flex;align-items:center;gap:16px;margin:8px 0 2px}',
    '.ia-siren{position:relative;flex:0 0 74px;height:74px;display:grid;place-items:center}',
    '.ia-siren b{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,106,90,.75);animation:ia-ring 2.1s ease-out infinite}',
    '.ia-siren b:nth-child(2){animation-delay:.7s}.ia-siren b:nth-child(3){animation-delay:1.4s}',
    '@keyframes ia-ring{0%{transform:scale(.45);opacity:.95}100%{transform:scale(1.5);opacity:0}}',
    '.ia-siren svg{position:relative;width:46px;height:46px;animation:ia-shake 1.6s ease-in-out infinite;filter:drop-shadow(0 0 12px rgba(255,120,70,.9))}',
    '@keyframes ia-shake{0%,55%,100%{transform:rotate(0)}6%{transform:rotate(-14deg)}12%{transform:rotate(12deg)}18%{transform:rotate(-9deg)}24%{transform:rotate(7deg)}30%{transform:rotate(-4deg)}36%{transform:rotate(0)}}',
    '.ia-titulo{margin:0;font:900 32px/1.05 Arial;letter-spacing:-.01em;background:linear-gradient(100deg,#fff 20%,#ffd23f 45%,#ff7a5a 60%,#fff 80%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ia-shim 3.2s linear infinite}',
    '@keyframes ia-shim{to{background-position:-250% 0}}',
    '.ia-msg{margin:12px 0 14px;font:600 16.5px/1.5 Arial;color:#dfe7da}',
    '.ia-msg .w{display:inline-block;opacity:0;transform:translateY(8px);animation:ia-word .35s ease-out forwards;margin-right:.26em}',
    '.ia-msg .w.b{font-weight:900;color:#fff;text-shadow:0 0 14px rgba(255,150,90,.65)}',
    '@keyframes ia-word{to{opacity:1;transform:none}}',
    '.ia-list{display:grid;gap:10px;padding:2px 0 8px}',
    '.ia-item{position:relative;padding:13px 15px 14px;border-radius:18px;border:1px solid rgba(255,106,90,.4);background:linear-gradient(135deg,rgba(255,106,90,.14),rgba(255,255,255,.04));overflow:hidden;opacity:0;transform:translateX(-26px);animation:ia-slide .5s cubic-bezier(.2,.9,.3,1.1) forwards}',
    '@keyframes ia-slide{to{opacity:1;transform:none}}',
    '.ia-item:after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.16),transparent);animation:ia-sweep 3.2s ease-in-out infinite}',
    '@keyframes ia-sweep{0%{left:-60%}55%,100%{left:130%}}',
    '.ia-fila{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.ia-tela{font:900 17px/1.2 Arial;overflow:hidden;text-overflow:ellipsis}',
    '.ia-chip{flex:0 0 auto;padding:4px 11px;border-radius:999px;border:1px solid rgba(255,106,90,.7);background:rgba(255,106,90,.2);color:#ffb3a6;font:900 10px Arial;letter-spacing:.12em;text-transform:uppercase;animation:ia-blink 1.1s ease-in-out infinite}',
    '@keyframes ia-blink{50%{background:rgba(255,106,90,.5);color:#fff}}',
    '.ia-ord{margin-top:5px;font:700 11.5px Arial;color:#a9b8a4}',
    '.ia-ord u{text-decoration:none;display:inline-block;margin:2px 4px 0 0;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.1);color:#e3ebde}',
    '.ia-bar{position:relative;height:12px;margin-top:11px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}',
    '.ia-bar i{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:999px;background:linear-gradient(90deg,#7cc9ff,#d0f44c);box-shadow:0 0 12px rgba(124,201,255,.7);transition:width 1.4s cubic-bezier(.2,.8,.2,1) .5s}',
    '.ia-nums{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 10px;margin-top:8px;font:700 12px Arial;color:#b6c4b1}',
    '.ia-nums b{font:900 15px Arial;color:#7cc9ff}.ia-nums .f{font:900 21px Arial;color:#ff9a8f;text-shadow:0 0 14px rgba(255,106,90,.7)}.ia-nums .f small{font:800 11px Arial;margin-left:3px}',
    '.ia-foot{display:flex;gap:10px;padding:12px 22px 20px;flex-wrap:wrap}',
    '.ia-btn{flex:1 1 150px;min-height:48px;white-space:nowrap;padding:0 10px;border-radius:14px;border:1.5px solid rgba(255,255,255,.4);background:rgba(255,255,255,.06);color:#fff;font:900 12px Arial;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:transform .15s,background .15s}',
    '.ia-btn:hover{transform:translateY(-2px);background:rgba(255,255,255,.14)}',
    '.ia-btn.main{border-color:#d0f44c;background:linear-gradient(180deg,#e2ff6a,#a9d21f);color:#13210b;animation:ia-cta 1.8s ease-in-out infinite}',
    '@keyframes ia-cta{0%,100%{box-shadow:0 0 0 0 rgba(208,244,76,.55)}50%{box-shadow:0 0 0 10px rgba(208,244,76,0)}}',
    '@media(max-width:560px){.ia-btn{flex:1 1 100%;letter-spacing:.07em}.ia-vivo{display:none}.ia-tape-in span{padding:2px 8px;margin:0 8px}.ia-overlay{padding:10px}.ia-card{border-radius:22px}.ia-titulo{font-size:26px}.ia-msg{font-size:15px}.ia-siren{flex-basis:60px;height:60px}.ia-siren svg{width:38px;height:38px}.ia-logo{height:28px}.ia-bot{font-size:9.5px;padding:5px 9px}.ia-body{padding:4px 16px}.ia-head{padding:14px 16px 0}.ia-foot{padding:10px 16px 16px}}',
    '@media(prefers-reduced-motion:reduce){.ia-overlay:before,.ia-card,.ia-tape-in,.ia-logo,.ia-bot i,.ia-siren b,.ia-siren svg,.ia-titulo,.ia-item:after,.ia-chip,.ia-btn.main{animation:none!important}.ia-msg .w,.ia-item{opacity:1!important;transform:none!important;animation:none!important}.ia-bar i{transition:none}}'
  ].join('');
  var st2=document.createElement('style');st2.textContent=css2;document.head.appendChild(st2);

  var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function contar(el,hasta,ms,delay){
    if(RM){el.textContent=ent(hasta,Math.ceil);return}
    setTimeout(function(){var t0=performance.now();(function paso(t){var p=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-p,3);el.textContent=ent(hasta*e,Math.ceil);if(p<1)requestAnimationFrame(paso)})(t0)},delay||0);
  }
  function mensaje(lista){
    var soloAgotadas=lista.every(function(a){return a.tipo==='agotada'});
    var partes=soloAgotadas?[['El agente de inventarios',1],['acaba de detectar que',0],['se agotó una tela',1],['en el inventario.',0]]
      :[['El agente de inventarios',1],['acaba de detectar',1],['una nueva producción',1],['que la tela necesaria',0],['no la tenemos en el inventario.',1]];
    var n=0;return partes.map(function(pt){return pt[0].split(' ').map(function(w){return '<span class="w'+(pt[1]?' b':'')+'" style="animation-delay:'+(450+(n++)*90)+'ms">'+esc(w)+'</span>'}).join('')}).join('');
  }
  function itemFaltante(a,i){
    var chip=a.tipo==='agotada'?'Agotada':a.tipo==='sin_tela'?'No está en Bodega':'No alcanza';
    var ord=a.ordenes&&a.ordenes.length?'<div class="ia-ord">'+a.ordenes.map(function(o){return '<u>'+esc(o)+'</u>'}).join('')+'</div>':(a.pedidos?'<div class="ia-ord">'+a.pedidos+(a.pedidos===1?' pedido':' pedidos')+' de clientes usan esta tela</div>':'');
    var necesaria=Number(a.necesaria)||0,bodega=Number(a.bodega)||0,pct=a.tipo==='agotada'||!necesaria?0:Math.max(2,Math.min(98,bodega/necesaria*100));
    var nums=a.tipo==='agotada'?'<span>Stock en bodega</span><span class="f"><span data-n="0">0</span><small>MTS</small></span>'
      :'<span>Bodega <b>'+ent(bodega,Math.round)+' MTS</b>'+(necesaria?' de '+ent(necesaria,Math.ceil)+' que se necesitan':'')+'</span><span class="f">faltan <span data-n="'+Math.ceil(Number(a.faltan)||0)+'">0</span><small>MTS</small></span>';
    return '<div class="ia-item" style="animation-delay:'+(1200+i*220)+'ms"><div class="ia-fila"><div class="ia-tela" title="'+esc(a.tela)+'">'+esc(a.tela)+'</div><span class="ia-chip">'+chip+'</span></div>'+ord+
      '<div class="ia-bar"><i data-w="'+pct+'"></i></div><div class="ia-nums">'+nums+'</div></div>';
  }
  var TAPE='<span>ALERTA DE TELA</span>ALERTA DE TELA · SIN INVENTARIO <span>ALERTA DE TELA</span>ALERTA DE TELA · SIN INVENTARIO ';
  var SIRENA='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 46 42H2z" fill="#ffd23f" stroke="#16110a" stroke-width="2.5" stroke-linejoin="round"/><rect x="21.5" y="16" width="5" height="14" rx="2.5" fill="#16110a"/><circle cx="24" cy="35.5" r="3" fill="#16110a"/></svg>';
  function showFaltantes(lista){
    if(fmodal||modal||!lista.length)return;
    var ov=fmodal=document.createElement('div');ov.className='ia-overlay';
    ov.innerHTML='<div class="ia-card" role="alertdialog" aria-modal="true" aria-labelledby="ia-t"><div class="ia-tape"><div class="ia-tape-in">'+TAPE+TAPE+'</div></div>'+
      '<div class="ia-head"><img class="ia-logo" src="/marca-indoor.svg" alt="Indoor"><span class="ia-bot"><i></i>AGENTE DE INVENTARIOS<em class="ia-vivo"> · EN VIVO</em></span></div>'+
      '<div class="ia-body"><div class="ia-top"><div class="ia-siren"><b></b><b></b><b></b>'+SIRENA+'</div><h2 class="ia-titulo" id="ia-t">¡Muchachos!</h2></div>'+
      '<p class="ia-msg">'+mensaje(lista)+'</p><div class="ia-list">'+lista.map(itemFaltante).join('')+'</div></div>'+
      '<div class="ia-foot"><button type="button" class="ia-btn" data-close>Entendido</button><button type="button" class="ia-btn main" data-go>Ver tela necesaria</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    set('localStorage',KF,JSON.stringify(lista.map(function(a){return a.clave})));   // ya se avisó de todas las que faltan ahora
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      ov.querySelectorAll('.ia-bar i').forEach(function(b){b.style.width=(b.getAttribute('data-w')||0)+'%'});
      ov.querySelectorAll('[data-n]').forEach(function(n,i){contar(n,Number(n.getAttribute('data-n'))||0,1300,1500+i*220)});
    })});
    function close(){fmodal=null;ov.remove()}
    ov.addEventListener('click',function(e){
      if(e.target.closest('[data-close]')||e.target===ov)close();
      else if(e.target.closest('[data-go]')){close();var t=document.querySelector('[data-bodega-dashboard]');if(t){var g=t.closest('.nav-group');if(g)g.classList.remove('collapsed');t.click();setTimeout(function(){var s2=document.querySelector('[data-bd-tab="tela"]');if(s2)s2.click()},700)}}
    });
    document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'&&fmodal===ov){close();document.removeEventListener('keydown',onKey)}});
  }
  function checkFaltantes(){
    if(document.hidden||fmodal||modal)return;
    fetch('/api/alertas-telas',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d||!d.aplica)return;
      var activas=d.faltantes||[],claves=activas.map(function(a){return a.clave}),prev=vistas();
      var vigentes=prev.filter(function(k){return claves.indexOf(k)>=0});   // las que ya se resolvieron se olvidan: si vuelven a faltar, avisan otra vez
      if(vigentes.length!==prev.length)set('localStorage',KF,JSON.stringify(vigentes));
      if(activas.some(function(a){return vigentes.indexOf(a.clave)<0}))showFaltantes(activas);
    }).catch(function(){});
  }
  // Prueba: abrir la página con ?probar_alerta=1 muestra la alerta de inmediato (con las faltas reales, o con un ejemplo si no hay). Solo a quien ya recibe estos avisos.
  if(/[?&]probar_alerta=1/.test(location.search)){
    setTimeout(function(){
      fetch('/api/alertas-telas',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(d){
        if(!d||!d.aplica)return;
        var lista=(d.faltantes&&d.faltantes.length)?d.faltantes:[{clave:'prueba|1',tipo:'no_alcanza',tela:'DIAMANTE',bodega:1200,necesaria:3500,faltan:2300,ordenes:['RM7700','CO6300'],pedidos:2},{clave:'prueba|2',tipo:'agotada',tela:'(201) SUDAFRICA BLANCO',bodega:0,faltan:1200,ordenes:[],pedidos:8}];
        if(modal){modal.remove();modal=null}
        if(fmodal){fmodal.remove();fmodal=null}
        showFaltantes(lista);
      }).catch(function(){});
    },2500);
  }
  setTimeout(checkFaltantes,6000);
  setInterval(checkFaltantes,30000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)setTimeout(checkFaltantes,800)});
})();
