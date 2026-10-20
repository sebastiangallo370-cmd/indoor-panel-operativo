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
  // ---- Alerta «producción sin tela»: misma familia visual que el resto de la página (ventana de vidrio oscuro de «Telas por reponer»), con borde lima, logo de Indoor y el mensaje del equipo
  var css2=[
    '.at-card.pf{width:min(600px,100%);max-height:min(92vh,780px);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px rgba(208,244,76,.5),0 0 34px -6px rgba(208,244,76,.75),0 34px 90px rgba(0,0,0,.65);animation:pf-in .5s cubic-bezier(.2,1.3,.3,1) both,pf-aura 3.2s ease-in-out .6s infinite}',
    '@keyframes pf-in{0%{opacity:0;transform:translateY(34px) scale(.94)}100%{opacity:1;transform:none}}',
    '@keyframes pf-aura{0%,100%{box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px rgba(208,244,76,.45),0 0 26px -8px rgba(208,244,76,.5),0 34px 90px rgba(0,0,0,.65)}50%{box-shadow:inset 0 1.5px 0 rgba(255,255,255,.4),0 0 0 1px rgba(208,244,76,.8),0 0 46px -4px rgba(208,244,76,.9),0 34px 90px rgba(0,0,0,.65)}}',
    '.pf .at-head{position:relative;padding:20px 26px 14px}',
    '.pf .at-head:after{content:"";position:absolute;left:26px;right:26px;bottom:0;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#d0f44c,transparent);background-size:220% 100%;animation:pf-linea 2.6s linear infinite}',
    '@keyframes pf-linea{to{background-position:-220% 0}}',
    '.pf-logo{display:block;height:36px;width:auto;margin:0 0 12px;filter:drop-shadow(0 0 8px rgba(208,244,76,.5));animation:pf-logo 2.8s ease-in-out infinite}',
    '@keyframes pf-logo{0%,100%{filter:drop-shadow(0 0 5px rgba(208,244,76,.35))}50%{filter:drop-shadow(0 0 16px rgba(208,244,76,.95))}}',
    '.pf .at-head small{font:900 12.5px Arial;letter-spacing:.2em;color:#d0f44c}',
    '.pf .at-head h3{margin:7px 0 10px;font-size:26px;letter-spacing:-.01em}',
    '.pf .at-head h3 i{background:rgba(208,244,76,.16);border-color:rgba(208,244,76,.7);color:#e4ff6b;animation:pf-late 1.4s ease-in-out infinite}',
    '@keyframes pf-late{50%{transform:scale(1.15)}}',
    '.pf .at-head p{font:700 18.5px/1.5 Arial;color:#f4f8ef}',
    '.pf .at-head p b{color:#e4ff6b;font-weight:900}',
    '.pf .at-list{gap:12px;padding:16px 26px 6px}',
    '.pf .at-row.at-prod{display:block;padding:16px 18px 18px;border-radius:18px;border:1px solid rgba(255,255,255,.2);border-left:4px solid #d0f44c;background:linear-gradient(145deg,rgba(255,255,255,.1),rgba(255,255,255,.03));opacity:0;transform:translateX(-22px);animation:pf-fila .5s cubic-bezier(.2,.9,.3,1.1) forwards}',
    '@keyframes pf-fila{to{opacity:1;transform:none}}',
    '.pf .at-chip{display:inline-block;margin:0 0 12px;padding:5px 13px;font-size:12px;background:rgba(208,244,76,.16);color:#f1ffb8;border:1px solid rgba(208,244,76,.8);animation:pf-chip 1.3s ease-in-out infinite}',
    '@keyframes pf-chip{50%{background:rgba(208,244,76,.36);color:#fff}}',
    '.pf .at-datos{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;margin:0}',
    '.pf .at-datos div{min-width:0}.pf .at-datos .full{grid-column:1/-1}',
    '.pf .at-datos dt{margin:0;font:900 12px Arial;letter-spacing:.15em;text-transform:uppercase;color:#d0f44c}',
    '.pf .at-datos dd{margin:4px 0 0;font:800 18px/1.25 Arial;color:#fff;overflow-wrap:anywhere}',
    '.pf .at-datos .cli dd{font-size:22px}',
    '.pf .at-datos .mts dd{font:900 34px/1.05 Arial;color:#e4ff6b;text-shadow:0 0 16px rgba(208,244,76,.55)}.pf .at-datos .mts dd small{font:900 14px Arial;margin-left:6px;letter-spacing:.08em}',
    '.pf .at-foot{padding:16px 26px 24px}.pf .at-btn{min-height:50px;font-size:13.5px}',
    '@media(max-width:560px){.pf .at-head{padding:16px 18px 12px}.pf .at-head:after{left:18px;right:18px}.pf-logo{height:30px}.pf .at-head h3{font-size:22px}.pf .at-head p{font-size:14.5px;line-height:1.42}.pf-logo{height:26px;margin-bottom:8px}.pf .at-head h3{font-size:20px;margin:4px 0 7px}.pf .at-list{padding:10px 18px 4px}.pf .at-row.at-prod{padding:12px 14px 14px}.pf .at-chip{margin-bottom:8px;font-size:11px}.pf .at-datos{gap:9px 14px}.pf .at-datos dt{font-size:11px}.pf .at-datos dd{font-size:15.5px}.pf .at-datos .cli dd{font-size:17.5px}.pf .at-datos .mts dd{font-size:26px}.pf .at-foot{padding:10px 18px 16px}.pf .at-btn{min-height:44px}}',
    '@media(prefers-reduced-motion:reduce){.at-card.pf,.pf .at-head:after,.pf-logo,.pf .at-head h3 i,.pf .at-chip{animation:none!important}.pf .at-row.at-prod{opacity:1!important;transform:none!important;animation:none!important}}',
    /* tipografía corporativa: Inter (sobria, sin cursiva) y tamaños contenidos */
    '.at-card.pf,.at-card.pf .at-head small,.at-card.pf .at-head h3,.at-card.pf .at-head h3 i,.at-card.pf .at-head p,.at-card.pf .at-chip,.at-card.pf .at-datos dt,.at-card.pf .at-datos dd,.at-card.pf .at-datos .cli dd,.at-card.pf .at-datos .mts dd,.at-card.pf .at-btn{font-family:Inter,"Segoe UI",Arial,sans-serif;font-style:normal}',
    '.at-card.pf .at-head h3{font-weight:800;font-size:28px;line-height:1.1;letter-spacing:-.01em;text-transform:uppercase;margin:6px 0 4px}',
    '.at-card.pf .at-head p{font-weight:700;font-size:17px;line-height:1.3;letter-spacing:.01em;text-transform:uppercase;color:#e4ff6b;text-shadow:none;margin:0 0 4px}',
    '.at-card.pf .at-chip{font-weight:700;font-size:11px;letter-spacing:.08em}',
    '.at-card.pf .at-datos dt{font-weight:700;font-size:11px;letter-spacing:.12em}',
    '.at-card.pf .at-datos dd{font-weight:600;font-size:16px;line-height:1.3}',
    '.at-card.pf .at-datos .cli dd{font-weight:700;font-size:19px;line-height:1.2;text-transform:uppercase}',
    '.at-card.pf .at-datos .mts dd{font-weight:800;font-size:30px;line-height:1.05;letter-spacing:-.01em}.at-card.pf .at-datos .mts dd small{font-size:13px;font-style:normal}',
    '.at-card.pf .at-btn{font-weight:700;font-size:12.5px;letter-spacing:.06em}',
    '@media(max-width:560px){.at-card.pf .at-head h3{font-size:23px}.at-card.pf .at-head p{font-size:14.5px}.at-card.pf .at-datos dd{font-size:15px}.at-card.pf .at-datos .cli dd{font-size:17px}.at-card.pf .at-datos .mts dd{font-size:26px}.at-card.pf .at-datos dt{font-size:10.5px}.at-card.pf .at-chip{font-size:10.5px}.at-card.pf .at-btn{font-size:12px}}',
    '.pf .at-datos .falta{margin-top:2px;padding:11px 14px;border-radius:12px;background:rgba(208,244,76,.13);border:1px solid rgba(208,244,76,.55)}',
    '.at-card.pf .at-datos .falta dd{font-weight:800;font-size:30px;line-height:1.05;letter-spacing:-.01em;color:#fff}.at-card.pf .at-datos .falta dd small{font-size:13px;font-weight:700;margin-left:6px;color:#e4ff6b;letter-spacing:.08em}',
    '@media(max-width:560px){.at-card.pf .at-datos .falta dd{font-size:26px}}'
  ].join('');
  var st2=document.createElement('style');st2.textContent=css2;document.head.appendChild(st2);
  // la fuente se pide una sola vez (si no llega, se usa Arial y todo sigue igual)
  function cargarFuente(){if(document.getElementById('at-fuente'))return;var l=document.createElement('link');l.id='at-fuente';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap';document.head.appendChild(l)}

  var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function dec2(n){return (Number(n)||0).toLocaleString('es-CO',{maximumFractionDigits:2})}
  function contar(el,hasta,ms,delay){
    if(RM){el.textContent=dec2(hasta);return}
    setTimeout(function(){var t0=performance.now();(function paso(t){var p=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-p,3);el.textContent=dec2(hasta*e);if(p<1)requestAnimationFrame(paso)})(t0)},delay||0);
  }
  // Mensaje único: «ATENCIÓN PRODUCCIÓN, NO HAY TELA PARA ESTA PRODUCCIÓN» (la ficha de abajo dice cuál es)
  function mensajeEquipo(lista){return lista.length>1?'NO HAY TELA PARA ESTAS PRODUCCIONES':'NO HAY TELA PARA ESTA PRODUCCIÓN'}
  function filaProd(a,i){
    var chip=a.tipo==='sin_tela'?'No está en Bodega':'No alcanza';
    return '<div class="at-row at-prod" style="animation-delay:'+(250+i*200)+'ms"><span class="at-chip">'+chip+'</span>'+
      '<dl class="at-datos"><div class="cli full"><dt>Nombre cliente</dt><dd>'+esc(a.cliente||'—')+'</dd></div>'+
      '<div><dt>Proyecto</dt><dd>'+esc(a.proyecto||'—')+'</dd></div><div><dt>Referencia</dt><dd>'+esc(a.referencia||'—')+'</dd></div>'+
      '<div><dt>Tela</dt><dd>'+esc(a.tela||'—')+'</dd></div><div class="mts"><dt>MTS</dt><dd><span data-n="'+(Number(a.mts)||0)+'">0</span></dd></div>'+
      '<div class="falta full"><dt>Tela que falta</dt><dd><span data-n="'+Math.ceil(Number(a.falta)||0)+'">0</span><small>MTS</small></dd></div></dl></div>';
  }
  function showFaltantes(lista){
    if(fmodal||modal||!lista.length)return;
    cargarFuente();
    var ov=fmodal=document.createElement('div');ov.className='at-overlay';
    var plural=lista.length>1;
    ov.innerHTML='<div class="at-card pf" role="alertdialog" aria-modal="true" aria-label="Producción sin tela"><div class="at-head"><img class="pf-logo" src="/marca-indoor.svg" alt="Indoor"><h3>ATENCIÓN PRODUCCIÓN</h3>'+
      '<p>'+mensajeEquipo(lista)+'</p></div>'+
      '<div class="at-list">'+lista.map(filaProd).join('')+'</div>'+
      '<div class="at-foot"><button type="button" class="at-btn" data-close>Entendido</button><button type="button" class="at-btn main" data-go>Ver tela necesaria</button></div></div>';
    (document.body||document.documentElement).appendChild(ov);
    set('localStorage',KF,JSON.stringify(lista.map(function(a){return a.clave})));   // ya se avisó de todas las que faltan ahora
    requestAnimationFrame(function(){ov.querySelectorAll('[data-n]').forEach(function(n,i){contar(n,Number(n.getAttribute('data-n'))||0,1300,700+i*200)})});
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
      cargarFuente();
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
        cargarFuente();
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
