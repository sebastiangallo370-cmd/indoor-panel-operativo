// Aviso de telas por reponer para Patronaje y Coordinador: aparece al iniciar sesión y todos los días a las 4 p. m.
// mientras la tela siga por debajo de su stock mínimo (cuando ingresa y supera el mínimo, deja de avisar).
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
    '.at-card{width:min(560px,100%);max-height:min(88vh,720px);display:flex;flex-direction:column;border:1px solid rgba(255,138,122,.55);border-radius:22px;background:linear-gradient(180deg,#1b1210,#0d130e 38%);color:#eef2e9;font-family:Arial,sans-serif;box-shadow:0 34px 90px rgba(0,0,0,.65)}',
    '.at-head{padding:22px 24px 8px}.at-head small{display:block;font:800 10.5px Arial;letter-spacing:.18em;color:#ff9a8c}',
    '.at-head h3{margin:6px 0 6px;font-size:21px;line-height:1.2}.at-head p{margin:0;font-size:13.5px;line-height:1.5;color:#b9c6b4}',
    '.at-list{display:grid;gap:8px;overflow:auto;padding:12px 24px}',
    '.at-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 14px;border:1px solid #2d3b2f;border-radius:14px;background:#0f1710}',
    '.at-row b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.at-row small{color:#93a28f;font-size:11.5px}',
    '.at-chip{padding:3px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase}',
    '.at-chip.agotado{background:rgba(255,106,90,.18);color:#ff9a8c;border:1px solid rgba(255,106,90,.5)}.at-chip.bajo{background:rgba(255,184,107,.16);color:#ffc98a;border:1px solid rgba(255,184,107,.45)}',
    '.at-num{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}.at-num em{display:block;font-style:normal;color:#93a28f;font-size:11px}',
    '.at-foot{display:flex;gap:10px;padding:14px 24px 22px;flex-wrap:wrap}',
    '.at-tab{visibility:visible!important;position:fixed;left:0;top:46%;z-index:100003;display:flex;flex-direction:column;align-items:center;gap:1px;padding:9px 8px 9px 7px;border:1px solid rgba(255,184,107,.65);border-left:0;border-radius:0 14px 14px 0;background:#1a1410;color:#ffc98a;font-family:Arial,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);transition:transform .15s,padding .15s}',
    '.at-tab:hover{transform:translateX(2px);padding-left:11px}.at-tab span{font-size:15px;line-height:1}.at-tab b{font-size:16px;line-height:1.1}.at-tab em{font:700 8.5px Arial;letter-spacing:.1em;text-transform:uppercase;font-style:normal}',
    '.at-tab.hot{border-color:rgba(255,106,90,.75);background:#20110f;color:#ff9a8c}',
    '.at-tab.ping{animation:at-ping 1.1s ease-out 4}',
    '@keyframes at-ping{0%{box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 0 rgba(255,138,122,.65)}100%{box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 16px rgba(255,138,122,0)}}',
    '.at-pop{visibility:visible!important;position:fixed;left:58px;top:46%;transform:translateY(-50%);z-index:100003;width:min(400px,calc(100vw - 76px));max-height:min(70vh,520px);display:flex;flex-direction:column;border:1px solid rgba(255,138,122,.5);border-radius:16px;background:#0e1410;color:#eef2e9;font-family:Arial,sans-serif;box-shadow:0 24px 70px rgba(0,0,0,.65);animation:at-in .14s ease-out}',
    '.at-pop-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 6px;font-size:15px}.at-pop .at-list{padding:8px 14px}.at-pop .at-foot{padding:6px 14px 14px}',
    '.at-pop .at-row{grid-template-columns:1fr;gap:8px}.at-pop .at-row b{white-space:normal}.at-pop .at-row>div:last-child{justify-content:space-between}',
    '.at-x{width:30px;height:30px;border:0;border-radius:50%;background:#1a2a22;color:#fff;font-size:20px;line-height:1;cursor:pointer}.at-x:hover{background:#d0f44c;color:#10150e}',
    '.at-btn{flex:1;min-height:44px;border:1.5px solid #d0f44c;border-radius:12px;background:transparent;color:#d0f44c;font:800 12px Arial;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}',
    '.at-btn.main{background:#d0f44c;color:#10150e}.at-btn:hover{filter:brightness(1.1)}'
  ].join('');
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  var tab=null,pop=null,current=[];
  function closePop(){if(pop){pop.remove();pop=null}open=false}
  function openPop(){
    if(pop||!current.length)return;open=true;
    pop=document.createElement('div');pop.className='at-pop';pop.setAttribute('role','dialog');
    pop.innerHTML='<div class="at-pop-head"><b>⚠ '+current.length+(current.length===1?' tela por reponer':' telas por reponer')+'</b><button type="button" class="at-x" data-close aria-label="Cerrar">×</button></div>'+
      '<div class="at-list">'+current.map(function(a){return '<div class="at-row"><div><b title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</b><small>'+(a.pedidos?a.pedidos+' pedidos de clientes':'Stock mínimo definido')+'</small></div><div style="display:flex;align-items:center;gap:10px"><span class="at-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotada':'Baja')+'</span><div class="at-num">'+fmt(a.total)+' MTS<em>mín '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></div></div></div>'}).join('')+'</div>'+
      '<div class="at-foot"><button type="button" class="at-btn main" data-go>Ver inventario</button></div>';
    (document.body||document.documentElement).appendChild(pop);
    pop.addEventListener('click',function(e){
      if(e.target.closest('[data-close]'))closePop();
      else if(e.target.closest('[data-go]')){closePop();var t=document.querySelector('.tab[data-kind="inventario"],.tab[data-panel="inventario"],[data-open-panel="inventario"]');if(t)t.click()}
    });
  }
  var modal=null;
  function showModal(alerts,reason){
    if(modal||!alerts.length)return;
    var ov=modal=document.createElement('div');ov.className='at-overlay';
    ov.innerHTML='<div class="at-card" role="alertdialog" aria-modal="true"><div class="at-head"><small>'+(reason==='tarde'?'RECORDATORIO · 4:00 P. M.':'ALERTA DE INVENTARIO')+'</small>'+
      '<h3>⚠ '+alerts.length+(alerts.length===1?' tela necesita reposición':' telas necesitan reposición')+'</h3></div>'+
      '<div class="at-list">'+alerts.map(function(a){return '<div class="at-row"><div><b title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</b><small>'+(a.pedidos?a.pedidos+' pedidos de clientes':'Stock mínimo definido')+'</small></div><div style="display:flex;align-items:center;gap:10px"><span class="at-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotada':'Baja')+'</span><div class="at-num">'+fmt(a.total)+' MTS<em>mín '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></div></div></div>'}).join('')+'</div>'+
      '<div class="at-foot"><button type="button" class="at-btn" data-close>Entendido</button><button type="button" class="at-btn main" data-go>Ver inventario</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    function close(){modal=null;ov.remove()}
    ov.addEventListener('click',function(e){
      if(e.target.closest('[data-close]')||e.target===ov)close();
      else if(e.target.closest('[data-go]')){close();var t=document.querySelector('.tab[data-kind="inventario"],.tab[data-panel="inventario"],[data-open-panel="inventario"]');if(t)t.click()}
    });
    document.addEventListener('keydown',function onKey(e){if(e.key==='Escape'&&modal===ov){close();document.removeEventListener('keydown',onKey)}});
  }
  function show(alerts,reason){
    current=alerts;
    if(!alerts.length){if(tab){tab.remove();tab=null}closePop();return}
    if(!tab){
      tab=document.createElement('button');tab.type='button';tab.className='at-tab';
      tab.addEventListener('click',function(){if(pop)closePop();else openPop()});
      (document.body||document.documentElement).appendChild(tab);
    }
    var out=alerts.filter(function(a){return a.nivel==='agotado'}).length;
    tab.className='at-tab'+(out?' hot':'');
    tab.title='Telas por reponer: '+alerts.length+(out?' ('+out+' agotada'+(out===1?'':'s')+')':'');
    tab.innerHTML='<span>⚠</span><b>'+alerts.length+'</b><em>'+(alerts.length===1?'tela':'telas')+'</em>';
    // llama la atención un momento (al iniciar sesión y a las 4 p. m.)
    tab.classList.remove('ping');void tab.offsetWidth;tab.classList.add('ping');
    if(pop){closePop();openPop()}
    if(reason==='sesion'||reason==='tarde')showModal(alerts,reason);
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
  // 2) todos los días a las 4 p. m. (también si se abre pasada la hora y aún no se mostró hoy)
  setInterval(function(){
    var now=new Date();
    if(now.getHours()>=HORA&&get('localStorage','at_dia')!==today())check('tarde');
  },30000);
})();
