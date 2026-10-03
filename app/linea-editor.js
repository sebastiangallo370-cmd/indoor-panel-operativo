// Editor de LÍNEAS DE PRODUCTO (menú del usuario → «Líneas de producto»).
// Permite cambiar nombres, características, alias del Sheet (columna B), nota y mockup de cada línea sin pedirlo a nadie.
// Solo aparece para quien tiene permiso (administrador, Administración o Coordinador); el servidor lo vuelve a validar.
(function(){
  if(window.__lineaEditor)return;window.__lineaEditor=true;
  var ACCENT={premium:'#d0f44c',estandar:'#c3ee3f',plus:'#d3d8cf',maquila:'#ffffff',otro:'#d0f44c'};
  var ESTILOS=[['premium','Negro con lima · Premium'],['estandar','Lima · Estándar'],['plus','Plata · Plus'],['maquila','Blanco · Maquila'],['otro','Lima suave · Otra línea']];
  var st=null,sel=0,dirty=false,allowed=null,overlay=null;

  function esc(text){return String(text==null?'':text).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function clone(x){return JSON.parse(JSON.stringify(x))}
  function api(url,options){
    return fetch(url,options).then(function(r){
      return r.json().catch(function(){return {}}).then(function(body){
        if(!r.ok)throw Error(typeof body.detail==='string'?body.detail:'No se pudo completar la acción');
        return body;
      });
    });
  }

  var css=[
    '.le-overlay{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,6,4,.74);backdrop-filter:blur(5px);animation:le-fade .2s ease-out}',
    '.le-card{position:relative;width:min(1080px,100%);height:min(90vh,820px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:radial-gradient(120% 70% at 0% 0%,rgba(208,244,76,.08),transparent 55%),#0a0e09;color:#eef2e9;font-family:Inter,Arial,sans-serif;box-shadow:0 40px 90px rgba(0,0,0,.65);animation:le-pop .28s cubic-bezier(.2,.9,.3,1.1)}',
    '.le-head{flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,.08)}',
    '.le-logo{display:block;flex:0 0 auto;width:92px;height:24px;background:#d0f44c;-webkit-mask:url(/marca-indoor.svg) left center/contain no-repeat;mask:url(/marca-indoor.svg) left center/contain no-repeat}',
    '.le-head b{padding-left:14px;border-left:1px solid rgba(255,255,255,.18);font:800 11px Arial;letter-spacing:.22em;color:#cfd9c7}',
    '.le-x{margin-left:auto;width:34px!important;height:34px!important;display:grid;place-items:center;padding:0!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:50%!important;background:transparent!important;color:#fff!important;font:300 22px/1 Arial!important;cursor:pointer}',
    '.le-x:hover{background:rgba(255,255,255,.14)!important}',
    '.le-body{flex:1;min-height:0;display:flex}',
    '.le-side{flex:0 0 280px;display:flex;flex-direction:column;gap:10px;padding:18px 16px;border-right:1px solid rgba(255,255,255,.08);overflow-y:auto}',
    '.le-side-top{display:flex;align-items:center;justify-content:space-between;padding:0 4px}',
    '.le-side-top span{font:800 10px Arial;letter-spacing:.22em;color:#7f8b78}',
    '.le-item{display:flex!important;align-items:center;gap:10px;width:100%!important;min-height:0!important;margin:0!important;padding:11px 12px!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:12px!important;background:rgba(255,255,255,.03)!important;box-shadow:none!important;color:#dfe7d8!important;font:700 12.5px Arial!important;letter-spacing:.06em;text-align:left!important;cursor:pointer;transition:background .15s,border-color .15s}',
    '.le-item:hover{background:rgba(255,255,255,.07)!important}',
    '.le-item.on{border-color:var(--ac,#d0f44c)!important;background:rgba(208,244,76,.08)!important}',
    '.le-item i{flex:0 0 10px;height:10px;border-radius:50%;background:var(--ac)}',
    '.le-item span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.le-item small{font:600 10px Arial;color:#7f8b78;letter-spacing:.04em}',
    '.le-mini{display:inline-flex!important;align-items:center;justify-content:center;width:26px!important;height:26px!important;min-height:0!important;margin:0!important;padding:0!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:8px!important;background:transparent!important;box-shadow:none!important;color:#b9c4b1!important;font:700 13px Arial!important;cursor:pointer}',
    '.le-mini:hover:not(:disabled){background:rgba(255,255,255,.12)!important;color:#fff!important}.le-mini:disabled{opacity:.25;cursor:default}',
    '.le-btn{display:inline-flex!important;align-items:center;justify-content:center;gap:6px;width:auto!important;min-height:0!important;margin:0!important;padding:9px 16px!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:999px!important;background:transparent!important;box-shadow:none!important;color:#e6ede0!important;font:800 11px Arial!important;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:all .15s}',
    '.le-btn:hover:not(:disabled){border-color:#d0f44c!important;color:#d0f44c!important}',
    '.le-btn.primary{background:#d0f44c!important;border-color:#d0f44c!important;color:#111!important}.le-btn.primary:hover:not(:disabled){filter:brightness(1.08);color:#111!important}',
    '.le-btn.danger{border-color:rgba(255,120,110,.45)!important;color:#ff9d94!important}.le-btn.danger:hover:not(:disabled){background:#e0574c!important;border-color:#e0574c!important;color:#fff!important}',
    '.le-btn:disabled{opacity:.4;cursor:default}',
    '.le-form{flex:1;min-width:0;overflow-y:auto;padding:22px 28px 26px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}',
    '.le-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
    '.le-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
    '.le-field>span,.le-sec{font:800 10px Arial;letter-spacing:.2em;color:#8e9a87;text-transform:uppercase}',
    '.le-field small{color:#6f7b68;font:500 11px Arial}',
    '.le-in{width:100%!important;box-sizing:border-box!important;margin:0!important;padding:11px 13px!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:10px!important;background:#10160f!important;box-shadow:none!important;color:#f2f6ee!important;font:500 14px Inter,Arial,sans-serif!important;outline:none}',
    '.le-in:focus{border-color:#d0f44c!important;box-shadow:0 0 0 3px rgba(208,244,76,.16)!important}',
    'textarea.le-in{min-height:64px;resize:vertical}',
    '.le-sec{display:flex;align-items:center;justify-content:space-between;margin:24px 0 10px}',
    '.le-feat{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '.le-feat b{flex:0 0 26px;color:#d0f44c;font:800 12px Arial;letter-spacing:.08em}',
    '.le-mock{display:flex;gap:18px;align-items:center;padding:14px;border:1px dashed rgba(255,255,255,.18);border-radius:14px;background:rgba(255,255,255,.025)}',
    '.le-mock-img{flex:0 0 96px;height:150px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:linear-gradient(180deg,#f4f6f2,#dfe4d9);color:#738069;font:700 10px Arial;letter-spacing:.1em;text-align:center;overflow:hidden}',
    '.le-mock-img img{display:block;max-width:100%;max-height:100%;object-fit:contain}',
    '.le-mock-actions{display:flex;flex-direction:column;align-items:flex-start;gap:10px}',
    '.le-foot{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:14px 24px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.2)}',
    '.le-msg{flex:1;min-width:0;font:600 12px Arial;color:#8e9a87}.le-msg.ok{color:#8fe08f}.le-msg.err{color:#ff9d94}',
    '@keyframes le-fade{from{opacity:0}to{opacity:1}}@keyframes le-pop{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}',
    '.li-menu-item{display:flex!important;align-items:center;gap:8px}',
    '@media(max-width:760px){',
      '.le-overlay{padding:0;align-items:flex-end}',
      '.le-card{width:100%;height:94vh;border-radius:22px 22px 0 0}',
      '.le-body{flex-direction:column;overflow-y:auto}',
      '.le-side{flex:0 0 auto;flex-direction:row;align-items:center;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid rgba(255,255,255,.08);padding:12px}',
      '.le-side-top{flex:0 0 auto}.le-item{flex:0 0 auto;width:auto!important}.le-side .le-field{display:none}',
      '.le-form{overflow:visible;padding:18px 18px 24px}.le-grid{grid-template-columns:1fr}',
      '.le-head{padding:14px 16px}.le-foot{padding:12px 16px}.le-mock{flex-direction:column;align-items:flex-start}',
    '}'
  ].join('');
  var style=document.createElement('style');
  style.textContent=css;
  document.head.appendChild(style);

  function line(){return st.lineas[sel]}
  function accent(l){return ACCENT[l.estilo]||'#d0f44c'}

  function sideHtml(){
    return '<div class="le-side-top"><span>LÍNEAS</span><button type="button" class="le-btn" data-le="nueva">+ Nueva</button></div>'+
      st.lineas.map(function(l,i){
        return '<button type="button" class="le-item'+(i===sel?' on':'')+'" data-le="sel" data-i="'+i+'" style="--ac:'+accent(l)+'"><i></i><span>'+esc(l.nombre||'Sin nombre')+'</span><small>'+l.caracteristicas.length+'</small></button>';
      }).join('')+
      '<label class="le-field" style="margin-top:12px"><span>Edición del documento</span><input class="le-in" data-le="edicion" maxlength="40" placeholder="Ej. Octubre 2026" value="'+esc(st.edicion)+'"></label>';
  }
  function featsHtml(l){
    return l.caracteristicas.map(function(c,i){
      return '<div class="le-feat"><b>'+(i<9?'0':'')+(i+1)+'</b><input class="le-in" data-le="feat" data-f="'+i+'" maxlength="160" value="'+esc(c)+'" placeholder="Característica">'+
        '<button type="button" class="le-mini" data-le="fup" data-f="'+i+'" title="Subir"'+(i===0?' disabled':'')+'>↑</button>'+
        '<button type="button" class="le-mini" data-le="fdown" data-f="'+i+'" title="Bajar"'+(i===l.caracteristicas.length-1?' disabled':'')+'>↓</button>'+
        '<button type="button" class="le-mini" data-le="fdel" data-f="'+i+'" title="Quitar">✕</button></div>';
    }).join('')||'<p style="margin:0 0 8px;color:#6f7b68;font:italic 13px Arial">Sin características todavía.</p>';
  }
  function mockHtml(l){
    var url=l.id&&st.mockups&&st.mockups[l.id];
    return '<div class="le-mock"><div class="le-mock-img">'+(url?'<img src="'+esc(url)+'" alt="Mockup">':'SIN<br>MOCKUP')+'</div>'+
      '<div class="le-mock-actions"><button type="button" class="le-btn" data-le="subir">'+(url?'Cambiar imagen':'Subir imagen')+'</button>'+
      (url?'<button type="button" class="le-btn danger" data-le="quitar">Quitar</button>':'')+
      '<small style="color:#6f7b68;font:500 11px Arial;max-width:30ch">'+(l.id?'JPG, PNG o WEBP. Se ajusta solo para que cargue rápido. Se guarda al instante.':'Guarda primero la línea para poder subir su imagen.')+'</small></div>'+
      '<input type="file" data-le="archivo" accept="image/jpeg,image/png,image/webp" hidden></div>';
  }
  function formHtml(){
    var l=line();
    return '<div class="le-grid"><label class="le-field"><span>Nombre de la línea</span><input class="le-in" data-le="nombre" maxlength="40" value="'+esc(l.nombre)+'"></label>'+
      '<label class="le-field"><span>Estilo de la ficha</span><select class="le-in" data-le="estilo">'+ESTILOS.map(function(e){return '<option value="'+e[0]+'"'+(l.estilo===e[0]?' selected':'')+'>'+e[1]+'</option>'}).join('')+'</select></label></div>'+
      '<label class="le-field" style="margin-top:16px"><span>Cómo aparece en el Sheet (columna B)</span><input class="le-in" data-le="alias" maxlength="120" value="'+esc((l.alias||[]).join(', '))+'" placeholder="Ej. BOT, OLIMPICA (separadas por coma)"><small>Si en el Sheet escriben otro nombre para esta línea, ponlo aquí y la tarjeta abrirá esta ficha.</small></label>'+
      '<div class="le-sec"><span>Características ('+l.caracteristicas.length+')</span><button type="button" class="le-btn" data-le="fadd">+ Agregar</button></div>'+
      '<div data-le="feats">'+featsHtml(l)+'</div>'+
      '<label class="le-field" style="margin-top:18px"><span>Nota (se muestra si la línea no tiene características)</span><textarea class="le-in" data-le="nota" maxlength="300">'+esc(l.nota||'')+'</textarea></label>'+
      '<div class="le-sec"><span>Mockup de referencia</span></div><div data-le="mock">'+mockHtml(l)+'</div>'+
      '<div style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="le-btn" data-le="lup"'+(sel===0?' disabled':'')+'>↑ Subir en la lista</button><button type="button" class="le-btn" data-le="ldown"'+(sel===st.lineas.length-1?' disabled':'')+'>↓ Bajar en la lista</button><button type="button" class="le-btn danger" data-le="borrar"'+(st.lineas.length<2?' disabled':'')+'>Eliminar línea</button></div>';
  }
  function paint(){
    overlay.querySelector('.le-side').innerHTML=sideHtml();
    var form=overlay.querySelector('.le-form'),top=form.scrollTop;
    form.innerHTML=formHtml();
    form.scrollTop=top;
    overlay.querySelector('.le-card').style.setProperty('--ac',accent(line()));
  }
  function say(text,kind){var m=overlay&&overlay.querySelector('.le-msg');if(m){m.textContent=text||'';m.className='le-msg'+(kind?' '+kind:'')}}
  function mark(){dirty=true;var b=overlay.querySelector('[data-le="guardar"]');if(b)b.disabled=false;say('Cambios sin guardar')}

  function close(force){
    if(!overlay)return;
    if(dirty&&!force&&!confirm('Tienes cambios sin guardar. ¿Cerrar de todos modos?'))return;
    overlay.remove();overlay=null;dirty=false;
    document.removeEventListener('keydown',onKey);
  }
  function onKey(event){if(event.key==='Escape'&&!document.querySelector('.li-overlay'))close()}

  function save(){
    var lineas=st.lineas.map(function(l){return {id:l.id||'',nombre:l.nombre,estilo:l.estilo,alias:l.alias||[],caracteristicas:l.caracteristicas,nota:l.nota||''}});
    if(lineas.some(function(l){return !String(l.nombre||'').trim()})){say('Cada línea necesita un nombre','err');return}
    var button=overlay.querySelector('[data-le="guardar"]');
    button.disabled=true;say('Guardando…');
    var keep=line().nombre;
    api('/api/lineas-producto',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({edicion:st.edicion,lineas:lineas})}).then(function(data){
      st=data;dirty=false;
      var i=st.lineas.findIndex(function(l){return l.nombre===String(keep).toUpperCase().replace(/\s+/g,' ').trim()});
      sel=i>=0?i:Math.min(sel,st.lineas.length-1);
      paint();say('Guardado ✓ · ya se ve en las tarjetas','ok');
      window.dispatchEvent(new Event('lineas-actualizadas'));
    }).catch(function(error){button.disabled=false;say(error.message,'err')});
  }

  function onInput(event){
    var key=event.target.dataset&&event.target.dataset.le;
    if(!key||!st)return;
    var l=line();
    if(key==='nombre'){l.nombre=event.target.value;var item=overlay.querySelector('.le-item.on span');if(item)item.textContent=l.nombre||'Sin nombre'}
    else if(key==='alias')l.alias=event.target.value.split(',').map(function(a){return a.trim()}).filter(Boolean);
    else if(key==='nota')l.nota=event.target.value;
    else if(key==='edicion')st.edicion=event.target.value;
    else if(key==='feat')l.caracteristicas[Number(event.target.dataset.f)]=event.target.value;
    else return;
    mark();
  }
  function focusFeat(i){var f=overlay.querySelector('[data-le="feat"][data-f="'+i+'"]');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length)}}
  function onChange(event){
    var key=event.target.dataset&&event.target.dataset.le;
    if(key==='estilo'){line().estilo=event.target.value;mark();paint()}
    else if(key==='archivo'&&event.target.files[0])upload(event.target.files[0]);
  }
  function upload(file){
    var l=line();
    if(!l.id){say('Guarda primero la línea y luego sube su imagen','err');return}
    var body=new FormData();body.append('file',file);
    say('Subiendo imagen…');
    api('/api/lineas-producto/mockup/'+encodeURIComponent(l.id),{method:'POST',body:body}).then(function(res){
      st.mockups=res.mockups;overlay.querySelector('[data-le="mock"]').innerHTML=mockHtml(l);say('Imagen guardada ✓','ok');
      window.dispatchEvent(new Event('lineas-actualizadas'));
    }).catch(function(error){say(error.message,'err')});
  }
  function onClick(event){
    var target=event.target.closest('[data-le]');
    if(event.target.closest('.le-x')){close();return}
    if(event.target===overlay){close();return}
    if(!target||!st)return;
    var key=target.dataset.le,l=line(),f=Number(target.dataset.f);
    if(key==='sel'){sel=Number(target.dataset.i);paint()}
    else if(key==='nueva'){st.lineas.push({id:'',nombre:'NUEVA LÍNEA',estilo:'otro',alias:[],caracteristicas:[],nota:''});sel=st.lineas.length-1;mark();paint();var n=overlay.querySelector('[data-le="nombre"]');n.focus();n.select()}
    else if(key==='fadd'){l.caracteristicas.push('');mark();paint();focusFeat(l.caracteristicas.length-1)}
    else if(key==='fdel'){l.caracteristicas.splice(f,1);mark();paint()}
    else if(key==='fup'&&f>0){var a=l.caracteristicas;a.splice(f-1,0,a.splice(f,1)[0]);mark();paint()}
    else if(key==='fdown'&&f<l.caracteristicas.length-1){var b=l.caracteristicas;b.splice(f+1,0,b.splice(f,1)[0]);mark();paint()}
    else if(key==='lup'&&sel>0){st.lineas.splice(sel-1,0,st.lineas.splice(sel,1)[0]);sel--;mark();paint()}
    else if(key==='ldown'&&sel<st.lineas.length-1){st.lineas.splice(sel+1,0,st.lineas.splice(sel,1)[0]);sel++;mark();paint()}
    else if(key==='borrar'){
      if(st.lineas.length>1&&confirm('¿Eliminar la línea «'+l.nombre+'»? Se aplicará al guardar.')){st.lineas.splice(sel,1);sel=Math.max(0,sel-1);mark();paint()}
    }
    else if(key==='subir')overlay.querySelector('[data-le="archivo"]').click();
    else if(key==='quitar'){
      if(!confirm('¿Quitar el mockup de «'+l.nombre+'»?'))return;
      api('/api/lineas-producto/mockup/'+encodeURIComponent(l.id),{method:'DELETE'}).then(function(res){st.mockups=res.mockups;overlay.querySelector('[data-le="mock"]').innerHTML=mockHtml(l);say('Mockup quitado','ok');window.dispatchEvent(new Event('lineas-actualizadas'))}).catch(function(error){say(error.message,'err')});
    }
    else if(key==='guardar')save();
    else if(key==='cancelar')close();
  }
  function onKeydown(event){
    var t=event.target;
    if(!t.dataset||t.dataset.le!=='feat')return;
    var l=line(),i=Number(t.dataset.f);
    if(event.key==='Enter'){event.preventDefault();l.caracteristicas.splice(i+1,0,'');mark();paint();focusFeat(i+1)}
    else if(event.key==='Backspace'&&t.value===''&&l.caracteristicas.length>0){event.preventDefault();l.caracteristicas.splice(i,1);mark();paint();focusFeat(Math.max(0,i-1))}
  }

  function open(){
    api('/api/lineas-producto',{cache:'no-store'}).then(function(data){
      if(!data.puede_editar)return;
      st=clone(data);sel=0;dirty=false;
      if(overlay)overlay.remove();
      overlay=document.createElement('div');
      overlay.className='le-overlay';
      overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Editor de líneas de producto');
      overlay.innerHTML='<div class="le-card theme-reinvert"><div class="le-head"><span class="le-logo" role="img" aria-label="Indoor"></span><b>EDITOR · LÍNEAS DE PRODUCTO</b><button type="button" class="le-x" aria-label="Cerrar">×</button></div>'+
        '<div class="le-body"><div class="le-side"></div><div class="le-form"></div></div>'+
        '<div class="le-foot"><span class="le-msg"></span><button type="button" class="le-btn" data-le="cancelar">Cerrar</button><button type="button" class="le-btn primary" data-le="guardar" disabled>Guardar cambios</button></div></div>';
      overlay.addEventListener('click',onClick);
      overlay.addEventListener('input',onInput);
      overlay.addEventListener('change',onChange);
      overlay.addEventListener('keydown',onKeydown);
      document.body.appendChild(overlay);
      document.addEventListener('keydown',onKey);
      paint();
    }).catch(function(error){alert(error.message)});
  }

  function addMenu(){
    if(allowed!==true)return;
    var menu=document.querySelector('.user-dropdown');
    if(!menu||menu.querySelector('.li-menu-item'))return;
    var button=document.createElement('button');
    button.type='button';button.className='li-menu-item';button.textContent='Líneas de producto';
    button.onclick=function(){var details=button.closest('details');if(details)details.open=false;open()};
    var anchor=menu.querySelector('#open-personal-notes')||menu.querySelector('a[href="/logout"]');
    menu.insertBefore(button,anchor?(anchor.id==='open-personal-notes'?anchor.nextSibling:anchor):null);
  }
  api('/api/lineas-producto',{cache:'no-store'}).then(function(d){allowed=!!d.puede_editar;addMenu()}).catch(function(){});
  new MutationObserver(addMenu).observe(document.body,{childList:true,subtree:true});
})();
