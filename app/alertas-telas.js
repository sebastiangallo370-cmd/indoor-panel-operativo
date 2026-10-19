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
  function filaFaltante(a){
    var chip=a.tipo==='agotada'?'<span class="at-chip agotado">Agotada</span>':a.tipo==='sin_tela'?'<span class="at-chip agotado">No está en Bodega</span>':'<span class="at-chip agotado">No alcanza</span>';
    var detalle=a.tipo==='agotada'?'Stock en 0 MTS'+(a.pedidos?' · '+a.pedidos+(a.pedidos===1?' pedido':' pedidos'):''):(a.ordenes&&a.ordenes.length?'Órdenes: '+a.ordenes.map(esc).join(', '):'');
    var num=a.tipo==='agotada'?'<em>MTS</em>0':a.tipo==='sin_tela'?'':'Bodega '+ent(a.bodega,Math.round)+' MTS<em>faltan '+ent(a.faltan,Math.ceil)+' MTS</em>';
    return '<div class="at-row"><div><b title="'+esc(a.tela)+'">'+esc(a.tela)+'</b><small>'+detalle+'</small></div><div class="at-num">'+chip+(num?'<div style="margin-top:6px">'+num+'</div>':'')+'</div></div>';
  }
  function showFaltantes(lista){
    if(fmodal||modal||!lista.length)return;
    var ov=fmodal=document.createElement('div');ov.className='at-overlay';
    ov.innerHTML='<div class="at-card" role="alertdialog" aria-modal="true"><div class="at-head"><small>AVISO INMEDIATO · TELA</small>'+
      '<h3>Falta tela <i>'+lista.length+'</i></h3><p>Estas telas no hay o no alcanzan para los pedidos programados.</p></div>'+
      '<div class="at-list">'+lista.map(filaFaltante).join('')+'</div>'+
      '<div class="at-foot"><button type="button" class="at-btn" data-close>Entendido</button><button type="button" class="at-btn main" data-go>Ver tela necesaria</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    set('localStorage',KF,JSON.stringify(lista.map(function(a){return a.clave})));   // ya se avisó de todas las que faltan ahora
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
  setTimeout(checkFaltantes,6000);
  setInterval(checkFaltantes,30000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)setTimeout(checkFaltantes,800)});
})();
