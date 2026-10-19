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
    /* fondo: oscuro con dos luces lima que flotan (se ve a través del vidrio) */
    '.ia-overlay{visibility:visible!important;position:fixed;inset:0;z-index:100004;display:grid;place-items:center;padding:18px;background:rgba(4,8,4,.62);backdrop-filter:blur(10px) saturate(1.2);overflow:hidden;animation:ia-fade .3s ease-out}',
    '@keyframes ia-fade{from{opacity:0}to{opacity:1}}',
    '.ia-overlay:before,.ia-overlay:after{content:"";position:absolute;width:52vmax;height:52vmax;border-radius:50%;filter:blur(40px);pointer-events:none;opacity:.55}',
    '.ia-overlay:before{left:-14vmax;top:-18vmax;background:radial-gradient(circle,rgba(208,244,76,.55),transparent 62%);animation:ia-flota1 9s ease-in-out infinite alternate}',
    '.ia-overlay:after{right:-16vmax;bottom:-20vmax;background:radial-gradient(circle,rgba(120,200,60,.45),transparent 62%);animation:ia-flota2 11s ease-in-out infinite alternate}',
    '@keyframes ia-flota1{to{transform:translate(18vmax,12vmax) scale(1.15)}}@keyframes ia-flota2{to{transform:translate(-16vmax,-10vmax) scale(1.2)}}',
    /* tarjeta de vidrio */
    '.ia-card{position:relative;z-index:1;width:min(640px,100%);max-height:min(94vh,860px);display:flex;flex-direction:column;overflow:hidden;border-radius:30px;border:1px solid rgba(255,255,255,.3);background:linear-gradient(150deg,rgba(255,255,255,.2),rgba(255,255,255,.07) 38%,rgba(208,244,76,.07));backdrop-filter:blur(26px) saturate(1.5);-webkit-backdrop-filter:blur(26px) saturate(1.5);color:#f4f8ef;font-family:Arial,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.08),inset 0 0 40px rgba(255,255,255,.04),0 30px 90px -24px #000,0 0 70px -22px rgba(208,244,76,.55);animation:ia-pop .75s cubic-bezier(.2,1.4,.3,1) both,ia-aura 3s ease-in-out .8s infinite}',
    '.ia-card:before{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.16) 46%,transparent 62%);background-size:260% 100%;animation:ia-brillo 4.2s ease-in-out infinite;pointer-events:none}',
    '@keyframes ia-brillo{0%{background-position:130% 0}60%,100%{background-position:-60% 0}}',
    '@keyframes ia-pop{0%{opacity:0;transform:translateY(46px) scale(.84) rotate(-2deg)}60%{opacity:1;transform:translateY(-6px) scale(1.03) rotate(.5deg)}100%{transform:none}}',
    '@keyframes ia-aura{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 40px rgba(255,255,255,.04),0 30px 90px -24px #000,0 0 50px -22px rgba(208,244,76,.4)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.7),inset 0 0 40px rgba(255,255,255,.06),0 30px 90px -24px #000,0 0 100px -8px rgba(208,244,76,.75)}}',
    /* cinta de vidrio con texto lima que corre */
    '.ia-tape{position:relative;overflow:hidden;white-space:nowrap;padding:8px 0;background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.04));border-bottom:1px solid rgba(255,255,255,.2)}',
    '.ia-tape-in{display:inline-block;padding-left:100%;animation:ia-marq 16s linear infinite;font:900 10.5px Arial;letter-spacing:.32em;color:#d0f44c;text-shadow:0 0 10px rgba(208,244,76,.7)}',
    '.ia-tape-in span{display:inline-block;margin:0 16px;padding:2px 12px;border:1px solid rgba(208,244,76,.55);border-radius:999px;background:rgba(208,244,76,.12)}',
    '@keyframes ia-marq{to{transform:translateX(-100%)}}',
    '.ia-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px 0}',
    '.ia-logo{height:34px;width:auto;filter:drop-shadow(0 0 10px rgba(208,244,76,.6));animation:ia-logo 2.8s ease-in-out infinite}',
    '@keyframes ia-logo{0%,100%{transform:scale(1);filter:drop-shadow(0 0 6px rgba(208,244,76,.4))}50%{transform:scale(1.07);filter:drop-shadow(0 0 16px rgba(208,244,76,.95))}}',
    '.ia-bot{display:inline-flex;align-items:center;gap:8px;padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.35);font:800 10.5px Arial;letter-spacing:.14em;color:#f4f8ef;white-space:nowrap}',
    '.ia-bot i{width:8px;height:8px;border-radius:50%;background:#d0f44c;box-shadow:0 0 0 0 rgba(208,244,76,.85);animation:ia-live 1.2s infinite}',
    '@keyframes ia-live{0%{box-shadow:0 0 0 0 rgba(208,244,76,.85)}100%{box-shadow:0 0 0 12px rgba(208,244,76,0)}}',
    '.ia-body{position:relative;overflow:auto;padding:6px 22px 4px;-webkit-overflow-scrolling:touch}',
    '.ia-top{display:flex;align-items:center;gap:16px;margin:8px 0 2px}',
    '.ia-siren{position:relative;flex:0 0 76px;height:76px;display:grid;place-items:center}',
    '.ia-siren b{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(208,244,76,.7);animation:ia-ring 2.3s ease-out infinite}',
    '.ia-siren b:nth-child(2){animation-delay:.75s}.ia-siren b:nth-child(3){animation-delay:1.5s}',
    '@keyframes ia-ring{0%{transform:scale(.45);opacity:.95}100%{transform:scale(1.5);opacity:0}}',
    '.ia-siren span{position:relative;display:grid;place-items:center;width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 0 24px rgba(208,244,76,.45);animation:ia-shake 1.8s ease-in-out infinite}',
    '.ia-siren svg{width:30px;height:30px}',
    '@keyframes ia-shake{0%,55%,100%{transform:rotate(0)}6%{transform:rotate(-13deg)}12%{transform:rotate(11deg)}18%{transform:rotate(-8deg)}24%{transform:rotate(6deg)}30%{transform:rotate(-3deg)}36%{transform:rotate(0)}}',
    '.ia-titulo{margin:0;font:900 34px/1.05 Arial;letter-spacing:-.01em;background:linear-gradient(100deg,#fff 25%,#d0f44c 48%,#fff 70%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ia-shim 3.4s linear infinite}',
    '@keyframes ia-shim{to{background-position:-250% 0}}',
    '.ia-msg{margin:12px 0 14px;font:600 16.5px/1.5 Arial;color:rgba(244,248,239,.82)}',
    '.ia-msg .w{display:inline-block;opacity:0;transform:translateY(8px);animation:ia-word .35s ease-out forwards;margin-right:.26em}',
    '.ia-msg .w.b{font-weight:900;color:#fff;text-shadow:0 0 14px rgba(208,244,76,.6)}',
    '@keyframes ia-word{to{opacity:1;transform:none}}',
    '.ia-list{display:grid;gap:10px;padding:2px 0 8px}',
    '.ia-item{position:relative;padding:13px 15px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.22);background:linear-gradient(145deg,rgba(255,255,255,.14),rgba(255,255,255,.04));box-shadow:inset 0 1px 0 rgba(255,255,255,.4);overflow:hidden;opacity:0;transform:translateX(-26px);animation:ia-slide .5s cubic-bezier(.2,.9,.3,1.1) forwards}',
    '@keyframes ia-slide{to{opacity:1;transform:none}}',
    '.ia-item:after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.2),transparent);animation:ia-sweep 3.4s ease-in-out infinite}',
    '@keyframes ia-sweep{0%{left:-60%}55%,100%{left:130%}}',
    '.ia-fila{display:flex;align-items:center;justify-content:space-between;gap:10px}',
    '.ia-tela{font:900 17px/1.2 Arial;overflow:hidden;text-overflow:ellipsis}',
    '.ia-chip{flex:0 0 auto;padding:4px 11px;border-radius:999px;border:1px solid rgba(208,244,76,.7);background:rgba(208,244,76,.14);color:#e9ffa0;font:900 10px Arial;letter-spacing:.12em;text-transform:uppercase;animation:ia-blink 1.2s ease-in-out infinite}',
    '@keyframes ia-blink{50%{background:rgba(208,244,76,.4);color:#fff;box-shadow:0 0 14px rgba(208,244,76,.6)}}',
    '.ia-datos{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:0}',
    '.ia-datos div{min-width:0}.ia-datos .full{grid-column:1/-1}',
    '.ia-datos dt{margin:0;font:800 9.5px Arial;letter-spacing:.16em;text-transform:uppercase;color:rgba(208,244,76,.85)}',
    '.ia-datos dd{margin:3px 0 0;font:800 14.5px/1.25 Arial;color:#fff;overflow-wrap:anywhere}',
    '.ia-datos .cli dd{font-size:17px}',
    '.ia-chip-sola{position:absolute;top:13px;right:14px}.ia-item{padding-top:14px}.ia-datos .cli{padding-right:120px}',
    '.ia-datos .cli{padding-right:118px}.ia-datos .mts dd{font:900 24px/1.1 Arial;color:#d0f44c;text-shadow:0 0 16px rgba(208,244,76,.65)}.ia-datos .mts dd small{font:800 11px Arial;margin-left:4px}',
    '.ia-foot{position:relative;display:flex;gap:10px;padding:12px 22px 20px;flex-wrap:wrap}',
    '.ia-btn{flex:1 1 150px;min-height:48px;white-space:nowrap;padding:0 10px;border-radius:16px;border:1px solid rgba(255,255,255,.34);background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.06));box-shadow:inset 0 1px 0 rgba(255,255,255,.45);color:#fff;font:900 12px Arial;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:transform .15s,background .15s}',
    '.ia-btn:hover{transform:translateY(-2px);background:linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.1))}',
    '.ia-btn.main{border-color:#d0f44c;background:linear-gradient(180deg,#e2ff6a,#a9d21f);box-shadow:inset 0 1px 0 rgba(255,255,255,.6);color:#13210b;animation:ia-cta 1.9s ease-in-out infinite}',
    '@keyframes ia-cta{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 0 0 0 rgba(208,244,76,.55)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 0 0 10px rgba(208,244,76,0)}}',
    '@media(max-width:560px){.ia-btn{flex:1 1 100%;letter-spacing:.07em}.ia-vivo{display:none}.ia-tape-in span{padding:2px 8px;margin:0 8px}.ia-overlay{padding:10px}.ia-card{border-radius:24px}.ia-titulo{font-size:27px}.ia-msg{font-size:15px}.ia-siren{flex-basis:62px;height:62px}.ia-siren span{width:44px;height:44px}.ia-siren svg{width:25px;height:25px}.ia-logo{height:28px}.ia-bot{font-size:9.5px;padding:5px 9px}.ia-body{padding:4px 16px}.ia-head{padding:14px 16px 0}.ia-foot{padding:10px 16px 16px}}',
    '@media(prefers-reduced-motion:reduce){.ia-overlay:before,.ia-overlay:after,.ia-card,.ia-card:before,.ia-tape-in,.ia-logo,.ia-bot i,.ia-siren b,.ia-siren span,.ia-titulo,.ia-item:after,.ia-chip,.ia-btn.main{animation:none!important}.ia-msg .w,.ia-item{opacity:1!important;transform:none!important;animation:none!important}.ia-bar i{transition:none}}'
  ].join('');
  var st2=document.createElement('style');st2.textContent=css2;document.head.appendChild(st2);

  var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function contar(el,hasta,ms,delay){
    if(RM){el.textContent=dec2(hasta);return}
    setTimeout(function(){var t0=performance.now();(function paso(t){var p=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-p,3);el.textContent=dec2(hasta*e);if(p<1)requestAnimationFrame(paso)})(t0)},delay||0);
  }
  function mensaje(lista){
    var partes=[['El agente de inventarios',1],['acaba de detectar',1],[lista.length>1?'nuevas producciones':'una nueva producción',1],[lista.length>1?'que la tela necesaria':'que la tela necesaria',0],['no la tenemos en el inventario.',1]];
    var n=0;return partes.map(function(pt){return pt[0].split(' ').map(function(w){return '<span class="w'+(pt[1]?' b':'')+'" style="animation-delay:'+(450+(n++)*90)+'ms">'+esc(w)+'</span>'}).join('')}).join('');
  }
  function dec2(n){return (Number(n)||0).toLocaleString('es-CO',{maximumFractionDigits:2})}
  function itemFaltante(a,i){
    var chip=a.tipo==='sin_tela'?'No está en Bodega':'No alcanza';
    return '<div class="ia-item" style="animation-delay:'+(1200+i*220)+'ms"><span class="ia-chip ia-chip-sola">'+chip+'</span>'+
      '<dl class="ia-datos"><div class="cli full"><dt>Nombre cliente</dt><dd>'+esc(a.cliente||'—')+'</dd></div>'+
      '<div><dt>Proyecto</dt><dd>'+esc(a.proyecto||'—')+'</dd></div><div><dt>Referencia</dt><dd>'+esc(a.referencia||'—')+'</dd></div>'+
      '<div><dt>Tela</dt><dd>'+esc(a.tela||'—')+'</dd></div>'+
      '<div class="mts"><dt>MTS</dt><dd><span data-n="'+(Number(a.mts)||0)+'">0</span><small>MTS</small></dd></div></dl></div>';
  }
  var TAPE='<span>ALERTA DE TELA</span>ALERTA DE TELA · SIN INVENTARIO <span>ALERTA DE TELA</span>ALERTA DE TELA · SIN INVENTARIO ';
  var SIRENA='<span><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 45 41H3z" fill="rgba(208,244,76,.18)" stroke="#d0f44c" stroke-width="3" stroke-linejoin="round"/><rect x="21.8" y="17" width="4.4" height="13" rx="2.2" fill="#fff"/><circle cx="24" cy="35" r="2.7" fill="#fff"/></svg></span>';
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
        var lista=(d.faltantes&&d.faltantes.length)?d.faltantes:[{clave:'prueba|1',tipo:'no_alcanza',cliente:'SANTIAGO JARAMILLO CORREA',proyecto:'CAMISETAS',referencia:'A700CA00',tela:'TOUR',mts:189.99},{clave:'prueba|2',tipo:'sin_tela',cliente:'JOHNATAN STIVEN LOPEZ CUADROS',proyecto:'HALCONES 20026',referencia:'A100PT01',tela:'MONTECATINI',mts:42.5}];
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
