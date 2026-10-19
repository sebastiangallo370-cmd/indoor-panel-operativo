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
  // ---- Alerta de producción sin tela: vidrio + verde lima de Indoor, muy dinámica (rollo de tela, título que rebota, ticket con medidor de MTS, chispas)
  var css2=[
    '.ia-overlay{visibility:visible!important;position:fixed;inset:0;z-index:100004;display:grid;place-items:center;padding:18px;background:rgba(3,7,3,.66);backdrop-filter:blur(11px) saturate(1.2);overflow:hidden;animation:ia-fade .3s ease-out}',
    '@keyframes ia-fade{from{opacity:0}to{opacity:1}}',
    '.ia-overlay:before,.ia-overlay:after{content:"";position:absolute;width:56vmax;height:56vmax;border-radius:50%;filter:blur(44px);pointer-events:none;opacity:.6}',
    '.ia-overlay:before{left:-16vmax;top:-20vmax;background:radial-gradient(circle,rgba(208,244,76,.6),transparent 62%);animation:ia-flota1 9s ease-in-out infinite alternate}',
    '.ia-overlay:after{right:-18vmax;bottom:-22vmax;background:radial-gradient(circle,rgba(110,200,60,.5),transparent 62%);animation:ia-flota2 11s ease-in-out infinite alternate}',
    '@keyframes ia-flota1{to{transform:translate(20vmax,14vmax) scale(1.15)}}@keyframes ia-flota2{to{transform:translate(-18vmax,-12vmax) scale(1.2)}}',
    '.ia-malla{position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(45deg,rgba(208,244,76,.07) 25%,transparent 25% 50%,rgba(208,244,76,.07) 50% 75%,transparent 75%);background-size:26px 26px;animation:ia-malla 5s linear infinite;-webkit-mask:radial-gradient(70% 70% at 50% 50%,#000,transparent);mask:radial-gradient(70% 70% at 50% 50%,#000,transparent)}',
    '@keyframes ia-malla{to{background-position:26px 26px}}',
    '.ia-chispa{position:absolute;bottom:-14px;width:6px;height:6px;border-radius:50%;background:#d0f44c;box-shadow:0 0 12px 2px rgba(208,244,76,.8);opacity:0;pointer-events:none;animation:ia-sube linear infinite}',
    '@keyframes ia-sube{0%{transform:translateY(0) scale(.6);opacity:0}12%{opacity:.95}100%{transform:translateY(-112vh) scale(1.3);opacity:0}}',
    /* tarjeta de vidrio */
    '.ia-card{position:relative;z-index:1;width:min(780px,100%);max-height:min(95vh,900px);display:flex;flex-direction:column;overflow:hidden;border-radius:34px;border:1px solid rgba(255,255,255,.32);background:linear-gradient(150deg,rgba(255,255,255,.17),rgba(255,255,255,.05) 38%,rgba(208,244,76,.07)),rgba(6,10,6,.58);backdrop-filter:blur(28px) saturate(1.5);-webkit-backdrop-filter:blur(28px) saturate(1.5);color:#fff;font-family:Arial,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(255,255,255,.08),0 34px 100px -24px #000,0 0 80px -22px rgba(208,244,76,.6);animation:ia-pop .8s cubic-bezier(.2,1.4,.3,1) both,ia-aura 3s ease-in-out .9s infinite}',
    '.ia-card:before{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.17) 46%,transparent 62%);background-size:260% 100%;animation:ia-brillo 4.4s ease-in-out infinite;pointer-events:none;z-index:2}',
    '@keyframes ia-brillo{0%{background-position:130% 0}60%,100%{background-position:-60% 0}}',
    '@keyframes ia-pop{0%{opacity:0;transform:translateY(54px) scale(.8) rotate(-2.5deg)}60%{opacity:1;transform:translateY(-8px) scale(1.03) rotate(.6deg)}100%{transform:none}}',
    '@keyframes ia-aura{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 34px 100px -24px #000,0 0 55px -22px rgba(208,244,76,.45)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.75),0 34px 100px -24px #000,0 0 110px -6px rgba(208,244,76,.8)}}',
    /* cinta que corre */
    '.ia-tape{position:relative;overflow:hidden;white-space:nowrap;padding:9px 0;background:linear-gradient(180deg,rgba(255,255,255,.15),rgba(255,255,255,.04));border-bottom:1px solid rgba(255,255,255,.2)}',
    '.ia-tape-in{display:inline-block;padding-left:100%;animation:ia-marq 16s linear infinite;font:900 13px Arial;letter-spacing:.3em;color:#e4ff6b;text-shadow:0 0 10px rgba(208,244,76,.8)}',
    '.ia-tape-in span{display:inline-block;margin:0 16px;padding:2px 13px;border:1px solid rgba(208,244,76,.6);border-radius:999px;background:rgba(208,244,76,.14)}',
    '@keyframes ia-marq{to{transform:translateX(-100%)}}',
    '.ia-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 26px 0}',
    '.ia-logo{height:42px;width:auto;filter:drop-shadow(0 0 10px rgba(208,244,76,.6));animation:ia-logo 2.8s ease-in-out infinite}',
    '@keyframes ia-logo{0%,100%{transform:scale(1);filter:drop-shadow(0 0 6px rgba(208,244,76,.4))}50%{transform:scale(1.07);filter:drop-shadow(0 0 18px rgba(208,244,76,.95))}}',
    '.ia-bot{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.32);background:rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.38);font:900 12.5px Arial;letter-spacing:.12em;color:#fff;white-space:nowrap}',
    '.ia-bot i{width:9px;height:9px;border-radius:50%;background:#d0f44c;box-shadow:0 0 0 0 rgba(208,244,76,.85);animation:ia-live 1.2s infinite}',
    '@keyframes ia-live{0%{box-shadow:0 0 0 0 rgba(208,244,76,.85)}100%{box-shadow:0 0 0 13px rgba(208,244,76,0)}}',
    '.ia-body{position:relative;overflow:auto;padding:6px 26px 4px;-webkit-overflow-scrolling:touch}',
    /* héroe: rollo de tela + título + mensaje */
    '.ia-hero{display:grid;grid-template-columns:118px 1fr;column-gap:22px;align-items:center;margin:10px 0 4px}.ia-hero .ia-rollo{grid-row:1/3}',
    '.ia-rollo{position:relative;flex:0 0 118px;height:118px;display:grid;place-items:center}',
    '.ia-rollo b{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(208,244,76,.7);animation:ia-ring 2.4s ease-out infinite}',
    '.ia-rollo b:nth-child(2){animation-delay:.8s}.ia-rollo b:nth-child(3){animation-delay:1.6s}',
    '@keyframes ia-ring{0%{transform:scale(.5);opacity:.95}100%{transform:scale(1.5);opacity:0}}',
    '.ia-rollo svg{position:relative;width:96px;height:96px;filter:drop-shadow(0 0 16px rgba(208,244,76,.7));animation:ia-flota 3s ease-in-out infinite}',
    '.ia-rollo .giro{transform-origin:50px 50px;animation:ia-gira 9s linear infinite}',
    '@keyframes ia-gira{to{transform:rotate(360deg)}}@keyframes ia-flota{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}',
    '.ia-rollo .alto{position:absolute;right:2px;top:4px;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#d0f44c;color:#12200a;font:900 22px Arial;text-shadow:none;box-shadow:0 0 18px rgba(208,244,76,.9);animation:ia-late 1.1s ease-in-out infinite}',
    '@keyframes ia-late{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}',
    '.ia-titulo{margin:0;white-space:nowrap;font:900 48px/1 Arial;letter-spacing:.01em;text-transform:uppercase;filter:drop-shadow(0 3px 10px rgba(0,0,0,.55));text-shadow:none}',
    '.ia-titulo .l{display:inline-block;opacity:0;background:linear-gradient(100deg,#fff 25%,#d0f44c 48%,#fff 70%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ia-letra .6s cubic-bezier(.2,1.6,.3,1) forwards,ia-shim 3.4s linear infinite}',
    '@keyframes ia-letra{0%{opacity:0;transform:translateY(34px) scale(.4) rotate(-14deg)}100%{opacity:1;transform:none}}',
    '@keyframes ia-shim{to{background-position:-250% 0}}',
    '.ia-msg{margin:12px 0 0;font:700 20px/1.42 Arial;color:#f4f8ef}',
    '.ia-msg .w{display:inline-block;opacity:0;transform:translateY(8px);animation:ia-word .35s ease-out forwards;margin-right:.26em}',
    '.ia-msg .w.b{font-weight:900;color:#e4ff6b;text-shadow:0 0 16px rgba(208,244,76,.7)}',
    '@keyframes ia-word{to{opacity:1;transform:none}}',
    '.ia-list{display:grid;gap:14px;padding:16px 0 8px}',
    /* ticket de la producción */
    '.ia-ticket{position:relative;display:grid;grid-template-columns:1fr auto 168px;align-items:stretch;border-radius:24px;border:1px solid rgba(255,255,255,.26);background:linear-gradient(145deg,rgba(255,255,255,.16),rgba(255,255,255,.04));box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 18px 40px -20px #000;overflow:hidden;opacity:0;transform:translateX(-30px) scale(.97);animation:ia-slide .6s cubic-bezier(.2,.9,.3,1.1) forwards;-webkit-mask:radial-gradient(circle 11px at calc(100% - 168px) 0,transparent 98%,#000) top/100% 51% no-repeat,radial-gradient(circle 11px at calc(100% - 168px) 100%,transparent 98%,#000) bottom/100% 51% no-repeat;mask:radial-gradient(circle 11px at calc(100% - 168px) 0,transparent 98%,#000) top/100% 51% no-repeat,radial-gradient(circle 11px at calc(100% - 168px) 100%,transparent 98%,#000) bottom/100% 51% no-repeat}',
    '@keyframes ia-slide{to{opacity:1;transform:none}}',
    '.ia-ticket:before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:linear-gradient(180deg,#e4ff6b,#8bb82a);box-shadow:0 0 18px rgba(208,244,76,.8)}',
    '.ia-ticket:after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.2),transparent);animation:ia-sweep 3.4s ease-in-out infinite;pointer-events:none}',
    '@keyframes ia-sweep{0%{left:-60%}55%,100%{left:130%}}',
    '.ia-t-main{position:relative;padding:18px 18px 18px 24px}',
    '.ia-chip{display:inline-block;padding:6px 14px;border-radius:999px;border:1px solid rgba(208,244,76,.85);background:rgba(208,244,76,.18);color:#f1ffb8;font:900 12.5px Arial;letter-spacing:.1em;text-transform:uppercase;animation:ia-blink 1.2s ease-in-out infinite}',
    '@keyframes ia-blink{50%{background:rgba(208,244,76,.42);color:#fff;box-shadow:0 0 16px rgba(208,244,76,.65)}}',
    '.ia-datos{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;margin:12px 0 0}',
    '.ia-datos div{min-width:0}.ia-datos .full{grid-column:1/-1}',
    '.ia-datos dt{margin:0;font:900 12px Arial;letter-spacing:.15em;text-transform:uppercase;color:#e4ff6b}',
    '.ia-datos dd{margin:4px 0 0;font:800 19px/1.25 Arial;color:#fff;overflow-wrap:anywhere}',
    '.ia-datos .cli dd{font-size:24px}',
    '.ia-t-corte{width:0;margin:14px 0;border-left:2px dashed rgba(255,255,255,.28)}',
    '.ia-t-mts{position:relative;display:grid;justify-items:center;align-content:center;gap:8px;padding:14px 12px}',
    '.ia-medidor{position:relative;width:128px;height:128px;border-radius:50%;display:grid;place-items:center}',
    '.ia-medidor:before{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,#e4ff6b,rgba(208,244,76,.08) 62%,#e4ff6b);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));animation:ia-gira 2.6s linear infinite;filter:drop-shadow(0 0 8px rgba(208,244,76,.8))}',
    '.ia-medidor span{display:grid;place-items:center;width:104px;height:104px;border-radius:50%;background:rgba(6,10,6,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 0 24px rgba(208,244,76,.3);font:900 31px Arial;color:#e4ff6b;text-shadow:0 0 18px rgba(208,244,76,.8);letter-spacing:-.01em}',
    '.ia-t-mts small{font:900 15px Arial;letter-spacing:.2em;color:#fff}',
    '.ia-foot{position:relative;display:flex;gap:12px;padding:14px 26px 22px;flex-wrap:wrap}',
    '.ia-btn{flex:1 1 170px;min-height:56px;white-space:nowrap;padding:0 12px;border-radius:18px;border:1px solid rgba(255,255,255,.36);background:linear-gradient(145deg,rgba(255,255,255,.2),rgba(255,255,255,.06));box-shadow:inset 0 1px 0 rgba(255,255,255,.45);color:#fff;font:900 14.5px Arial;letter-spacing:.09em;text-transform:uppercase;cursor:pointer;transition:transform .15s,background .15s}',
    '.ia-btn:hover{transform:translateY(-2px);background:linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.1))}',
    '.ia-btn.main{border-color:#d0f44c;background:linear-gradient(180deg,#e9ff7a,#a9d21f);box-shadow:inset 0 1px 0 rgba(255,255,255,.65);color:#13210b;text-shadow:none;animation:ia-cta 1.9s ease-in-out infinite}',
    '@keyframes ia-cta{0%,100%{box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 0 0 0 rgba(208,244,76,.6)}50%{box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 0 0 12px rgba(208,244,76,0)}}',
    '@media(max-width:640px){.ia-overlay{padding:10px}.ia-card{border-radius:26px}.ia-head{padding:14px 16px 0}.ia-logo{height:32px}.ia-vivo{display:none}.ia-bot{font-size:10px;letter-spacing:.04em;padding:6px 10px;gap:6px;min-width:0}.ia-tape-in span{padding:2px 8px;margin:0 8px}.ia-body{padding:4px 16px}.ia-hero{grid-template-columns:70px 1fr;column-gap:10px;margin-top:6px}.ia-hero .ia-rollo{grid-row:auto}.ia-hero .ia-msg{grid-column:1/-1}.ia-rollo{height:70px}.ia-rollo svg{width:62px;height:62px}.ia-rollo .alto{width:24px;height:24px;font-size:15px;right:-2px;top:0}.ia-titulo{font-size:29px}.ia-msg{font-size:17.5px;margin-top:8px}.ia-ticket{display:block;-webkit-mask:none;mask:none}.ia-t-corte{display:none}.ia-t-main{padding:14px 14px 16px 20px}.ia-t-mts{position:absolute;top:10px;right:10px;padding:0;gap:3px}.ia-medidor{width:84px;height:84px}.ia-medidor span{width:66px;height:66px;font-size:18px}.ia-t-mts small{font-size:11px}.ia-datos{gap:12px 14px}.ia-datos .cli{padding-right:92px}.ia-datos .cli dd{overflow-wrap:break-word}.ia-datos dd{font-size:17px}.ia-datos .cli dd{font-size:21px}.ia-datos dt{font-size:12px}.ia-chip{font-size:11.5px}.ia-btn{flex:1 1 100%;letter-spacing:.06em;font-size:14px}.ia-foot{padding:12px 16px 16px}}',
    '@media(prefers-reduced-motion:reduce){.ia-overlay:before,.ia-overlay:after,.ia-malla,.ia-chispa,.ia-card,.ia-card:before,.ia-tape-in,.ia-logo,.ia-bot i,.ia-rollo b,.ia-rollo svg,.ia-rollo .giro,.ia-rollo .alto,.ia-titulo .l,.ia-ticket:after,.ia-medidor:before,.ia-chip,.ia-btn.main{animation:none!important}.ia-msg .w,.ia-ticket,.ia-titulo .l{opacity:1!important;transform:none!important;animation:none!important}}'
  ].join('');
  var st2=document.createElement('style');st2.textContent=css2;document.head.appendChild(st2);

  var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function dec2(n){return (Number(n)||0).toLocaleString('es-CO',{maximumFractionDigits:2})}
  function contar(el,hasta,ms,delay){
    if(RM){el.textContent=dec2(hasta);return}
    setTimeout(function(){var t0=performance.now();(function paso(t){var p=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-p,3);el.textContent=dec2(hasta*e);if(p<1)requestAnimationFrame(paso)})(t0)},delay||0);
  }
  function titulo(txt){return txt.split('').map(function(ch,i){return ch===' '?' ':'<span class="l" style="animation-delay:'+(250+i*55)+'ms,0ms">'+esc(ch)+'</span>'}).join('')}
  function mensaje(lista){
    var partes=[['El agente de inventarios',1],['acaba de detectar',1],[lista.length>1?'nuevas producciones':'una nueva producción',1],['que la tela necesaria',0],['no la tenemos en el inventario.',1]];
    var n=0;return partes.map(function(pt){return pt[0].split(' ').map(function(w){return '<span class="w'+(pt[1]?' b':'')+'" style="animation-delay:'+(900+(n++)*90)+'ms">'+esc(w)+'</span>'}).join('')}).join('');
  }
  function itemFaltante(a,i){
    var chip=a.tipo==='sin_tela'?'No está en Bodega':'No alcanza';
    return '<div class="ia-ticket" style="animation-delay:'+(1700+i*260)+'ms"><div class="ia-t-main"><span class="ia-chip">'+chip+'</span>'+
      '<dl class="ia-datos"><div class="cli full"><dt>Nombre cliente</dt><dd>'+esc(a.cliente||'—')+'</dd></div>'+
      '<div><dt>Proyecto</dt><dd>'+esc(a.proyecto||'—')+'</dd></div><div><dt>Referencia</dt><dd>'+esc(a.referencia||'—')+'</dd></div>'+
      '<div class="full"><dt>Tela</dt><dd>'+esc(a.tela||'—')+'</dd></div></dl></div>'+
      '<div class="ia-t-corte"></div>'+
      '<div class="ia-t-mts"><div class="ia-medidor"><span data-n="'+(Number(a.mts)||0)+'">0</span></div><small>MTS</small></div></div>';
  }
  var TAPE='<span>ALERTA DE TELA</span>PRODUCCIÓN SIN TELA · REVISAR INVENTARIO <span>ALERTA DE TELA</span>PRODUCCIÓN SIN TELA · REVISAR INVENTARIO ';
  var ROLLO='<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="iar" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e4ff6b" stop-opacity=".95"/><stop offset="1" stop-color="#8bb82a" stop-opacity=".25"/></radialGradient></defs>'+
    '<circle cx="50" cy="50" r="44" fill="rgba(208,244,76,.1)" stroke="#d0f44c" stroke-width="3"/>'+
    '<g class="giro"><circle cx="50" cy="50" r="34" fill="none" stroke="#d0f44c" stroke-width="2.5" stroke-dasharray="28 10"/><circle cx="50" cy="50" r="24" fill="none" stroke="#e4ff6b" stroke-width="2.5" stroke-dasharray="16 8"/><circle cx="50" cy="50" r="14" fill="none" stroke="#d0f44c" stroke-width="2.5" stroke-dasharray="9 6"/></g>'+
    '<circle cx="50" cy="50" r="7" fill="url(#iar)"/></svg>';
  function showFaltantes(lista){
    if(fmodal||modal||!lista.length)return;
    var ov=fmodal=document.createElement('div');ov.className='ia-overlay';
    var chispas='';for(var k=0;k<18;k++)chispas+='<i class="ia-chispa" style="left:'+(Math.round(Math.random()*96)+2)+'%;animation-duration:'+(5+Math.random()*6).toFixed(1)+'s;animation-delay:'+(Math.random()*6).toFixed(1)+'s;transform-origin:center"></i>';
    ov.innerHTML='<div class="ia-malla"></div>'+chispas+
      '<div class="ia-card" role="alertdialog" aria-modal="true" aria-labelledby="ia-t"><div class="ia-tape"><div class="ia-tape-in">'+TAPE+TAPE+'</div></div>'+
      '<div class="ia-head"><img class="ia-logo" src="/marca-indoor.svg" alt="Indoor"><span class="ia-bot"><i></i>PRODUCCIÓN SIN TELA</span></div>'+
      '<div class="ia-body"><div class="ia-hero"><div class="ia-rollo"><b></b><b></b><b></b>'+ROLLO+'<span class="alto">!</span></div><h2 class="ia-titulo" id="ia-t">'+titulo('¡MUCHACHOS!')+'</h2>'+
      '<p class="ia-msg">'+mensaje(lista)+'</p></div><div class="ia-list">'+lista.map(itemFaltante).join('')+'</div></div>'+
      '<div class="ia-foot"><button type="button" class="ia-btn" data-close>Entendido</button><button type="button" class="ia-btn main" data-go>Ver tela necesaria</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    set('localStorage',KF,JSON.stringify(lista.map(function(a){return a.clave})));   // ya se avisó de todas las que faltan ahora
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      ov.querySelectorAll('[data-n]').forEach(function(n,i){contar(n,Number(n.getAttribute('data-n'))||0,1500,1900+i*260)});
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
