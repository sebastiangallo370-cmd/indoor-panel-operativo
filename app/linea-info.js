// Al tocar la etiqueta de LÍNEA de una tarjeta se abre una ventana con lo que incluye esa línea de producto
// (según el documento «Líneas de producto»). Los textos viven en /api/lineas-producto.
(function(){
  if(window.__lineaInfo)return;window.__lineaInfo=true;
  var data=null,loading=null,opener=null;
  function plain(text){return String(text||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim()}
  function esc(text){return String(text==null?'':text).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function load(){
    if(data)return Promise.resolve(data);
    if(!loading)loading=fetch('/api/lineas-producto',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){data=d;return d}).catch(function(){loading=null;return null});
    return loading;
  }

  var style=document.createElement('style');
  style.textContent=
    '.trace-line[data-line]{cursor:pointer;transition:transform .15s,box-shadow .15s}'+
    '.trace-line[data-line]:hover{transform:translateY(-1px);box-shadow:0 3px 12px rgba(0,0,0,.35)}'+
    '.trace-line[data-line]:focus-visible{outline:2px solid #d0f44c;outline-offset:2px}'+
    '.li-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,8,5,.66);backdrop-filter:blur(3px);animation:li-fade .18s ease-out}'+
    '.li-card{position:relative;width:min(520px,100%);max-height:min(90vh,760px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(208,244,76,.28);border-radius:20px;background:#0f140e;color:#eaf0e4;font-family:Inter,Arial,sans-serif;box-shadow:0 28px 70px rgba(0,0,0,.6);animation:li-pop .22s cubic-bezier(.2,.9,.3,1.2)}'+
    '.li-close{position:absolute;top:13px;right:14px;z-index:3;width:34px;height:34px;display:grid;place-items:center;padding:0!important;border:0!important;border-radius:50%!important;background:rgba(255,255,255,.12)!important;color:#fff!important;font:400 22px/1 Arial!important;cursor:pointer;transition:background .15s}'+
    '.li-close:hover{background:rgba(255,255,255,.26)!important}'+
    '.li-brand{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 62px 16px 26px;background:#1f1f1f}'+
    '.li-logo{display:block;flex:0 0 auto;width:118px;height:30px;background:#d0f44c;-webkit-mask:url(/marca-indoor.svg) left center/contain no-repeat;mask:url(/marca-indoor.svg) left center/contain no-repeat}'+
    '.li-brand-t{text-align:right;line-height:1.3}.li-brand-t b{display:block;color:#fff;font:800 12px Arial;letter-spacing:.16em}.li-brand-t span{color:#9b9b9b;font:500 10.5px Arial}'+
    '.li-rule{flex:0 0 auto;height:4px;background:#d0f44c}'+
    '.li-head,.li-tabs,.li-foot{flex:0 0 auto}'+
    '.li-head{padding:28px 30px 24px}'+
    '.li-head small{display:block;font:700 10px Arial;letter-spacing:.3em;opacity:.75}'+
    '.li-head h2{margin:6px 0 2px;font:900 34px/1.05 Inter,Arial,sans-serif;letter-spacing:.02em}'+
    '.li-head span{font:500 12.5px Arial;opacity:.8}'+
    '.li-premium{background:#1c1c1c;color:#d0f44c}.li-estandar{background:#d0f44c;color:#111}.li-plus{background:#8b8b8b;color:#fff}.li-maquila{background:#fafaf7;color:#111;border-bottom:3px solid #111}.li-otro{background:linear-gradient(135deg,#1b2417,#0f140e);color:#d0f44c;border-bottom:1px solid rgba(208,244,76,.25)}'+
    '.li-body{flex:1;min-height:0;overflow-y:auto;padding:8px 28px 14px;scrollbar-width:thin}'+
    '.li-list{margin:0;padding:0;list-style:none}'+
    '.li-list li{display:flex;gap:14px;align-items:flex-start;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.08);font:500 14px/1.45 Inter,Arial,sans-serif;letter-spacing:.01em}'+
    '.li-list li:last-child{border-bottom:0}'+
    '.li-list li i{flex:0 0 9px;height:9px;margin-top:5px;border-radius:2px;background:#d0f44c}'+
    '.li-empty{margin:18px 0;color:#aab6a3;font:italic 400 14px/1.55 Inter,Arial,sans-serif}'+
    '.li-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:12px 24px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025)}'+
    '.li-tabs button{display:inline-flex!important;width:auto!important;min-height:0!important;margin:0!important;padding:7px 14px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:999px!important;background:transparent!important;color:#b8c4b0!important;font:800 10.5px Arial!important;letter-spacing:.1em;cursor:pointer;box-shadow:none!important;transition:all .15s}'+
    '.li-tabs button:hover{border-color:#d0f44c!important;color:#d0f44c!important}.li-tabs button[aria-pressed=true]{background:#d0f44c!important;border-color:#d0f44c!important;color:#111!important}'+
    '.li-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 26px 16px;color:#7d8978;font:500 10.5px Arial;letter-spacing:.04em;border-top:1px solid rgba(255,255,255,.06)}'+
    '.li-foot-l{display:flex;align-items:center;gap:10px}.li-iso{display:block;height:20px;width:auto}.li-foot i{color:#b9c4b1;font:italic 500 12px Arial;letter-spacing:.02em}'+
    '.li-split{display:flex;flex:1;min-height:0}.li-col{flex:1;min-width:0;display:flex;flex-direction:column}'+
    '.li-card.has-mock{width:min(900px,100%)}'+
    '.li-mock{flex:0 0 300px;display:flex;flex-direction:column;gap:12px;padding:20px;background:linear-gradient(180deg,#f4f6f2,#e1e7dc);color:#10150e}'+
    '.li-mock small{display:block;font:800 9.5px Arial;letter-spacing:.22em;color:#4b5a3a}'+
    '.li-mock a{flex:1;min-height:200px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 1px rgba(16,21,14,.08),0 8px 22px rgba(16,21,14,.12);overflow:hidden;cursor:zoom-in}'+
    '.li-mock img{display:block;max-width:100%;max-height:100%;object-fit:contain;padding:10px}'+
    '.li-mock-cap{font:800 12px Arial;letter-spacing:.1em;text-align:center;text-transform:uppercase}'+
    '@keyframes li-fade{from{opacity:0}to{opacity:1}}@keyframes li-pop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}'+
    '@media(max-width:600px){.li-split{flex-direction:column;overflow-y:auto}.li-mock{flex:0 0 auto;padding:16px}.li-mock a{min-height:230px}.li-split .li-body{overflow:visible}.li-overlay{align-items:flex-end;padding:0}.li-card{width:100%;max-height:86vh;border-radius:22px 22px 0 0;animation:li-up .25s ease-out}.li-brand{padding:15px 56px 13px 20px}.li-logo{width:96px;height:25px}.li-brand-t span{display:none}.li-head{padding:22px 22px 18px}.li-body{padding:6px 22px 12px}.li-tabs{padding:12px 18px}.li-foot{padding:12px 20px 24px;flex-direction:column;align-items:flex-start;gap:6px}@keyframes li-up{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}}';
  document.head.appendChild(style);

  function find(name){
    var key=plain(name);
    for(var i=0;i<data.lineas.length;i++)if(plain(data.lineas[i].nombre)===key)return data.lineas[i];
    return null;
  }
  function render(overlay,name,chipName){
    var line=find(name),head,body;
    if(line){
      var n=line.caracteristicas.length;
      head='<div class="li-head li-'+esc(line.estilo)+'"><small>LÍNEA DE PRODUCTO</small><h2 id="li-title">'+esc(line.nombre)+'</h2><span>'+(n?n+' característica'+(n===1?'':'s'):'Por definir')+'</span></div>';
      body=n?'<ul class="li-list">'+line.caracteristicas.map(function(c){return '<li><i></i><span>'+esc(c)+'</span></li>'}).join('')+'</ul>':'<p class="li-empty">'+esc(line.nota||'Las especificaciones de esta línea están pendientes de definir.')+'</p>';
    }else{
      head='<div class="li-head li-otro"><small>LÍNEA DE PRODUCTO</small><h2 id="li-title">'+esc(chipName)+'</h2><span>Sin especificaciones registradas</span></div>';
      body='<p class="li-empty">Esta línea no aparece en el documento «Líneas de producto» ('+esc(data.fuente.split('·').pop().trim())+'). El documento define '+data.lineas.map(function(l){return l.nombre.charAt(0)+l.nombre.slice(1).toLowerCase()}).join(', ').replace(/, ([^,]*)$/,' y $1')+'. Toca una de ellas abajo para ver lo que incluye.</p>';
    }
    var tabs='<nav class="li-tabs" aria-label="Líneas de producto">'+data.lineas.map(function(l){return '<button type="button" data-li-tab="'+esc(l.nombre)+'" aria-pressed="'+(line&&l.nombre===line.nombre)+'">'+esc(l.nombre)+'</button>'}).join('')+'</nav>';
    var brand='<div class="li-brand"><span class="li-logo" role="img" aria-label="Indoor"></span><div class="li-brand-t"><b>LÍNEAS DE PRODUCTO</b><span>'+esc(data.fuente.split('·').slice(1).join('·').trim())+'</span></div></div><div class="li-rule"></div>';
    var foot='<div class="li-foot"><span class="li-foot-l"><img class="li-iso" src="/favicon.svg" alt=""><i>'+esc(data.lema||'')+'</i></span><span>Documento interno · Indoor Sport</span></div>';
    var slug=plain(line?line.nombre:chipName).replace(/[^A-Z0-9]/g,''),mockUrl=data.mockups&&data.mockups[slug];
    var mock=mockUrl?'<aside class="li-mock"><small>MOCKUP DE REFERENCIA</small><a href="'+esc(mockUrl)+'" target="_blank" rel="noopener" title="Ver en grande"><img src="'+esc(mockUrl)+'" alt="Mockup de la línea '+esc(line?line.nombre:chipName)+'"></a><div class="li-mock-cap">Línea '+esc(line?line.nombre:chipName)+'</div></aside>':'';
    overlay.querySelector('.li-card').classList.toggle('has-mock',!!mockUrl);
    overlay.querySelector('.li-card').innerHTML='<button type="button" class="li-close" aria-label="Cerrar">×</button>'+brand+'<div class="li-split">'+mock+'<div class="li-col">'+head+'<div class="li-body">'+body+'</div>'+tabs+'</div></div>'+foot;
    overlay.querySelector('.li-close').focus();
  }
  function close(){
    var overlay=document.querySelector('.li-overlay');
    if(overlay)overlay.remove();
    document.removeEventListener('keydown',onKey);
    if(opener&&opener.focus)opener.focus();
  }
  function onKey(event){if(event.key==='Escape')close()}
  function open(name,chip){
    load().then(function(d){
      if(!d||!d.lineas)return;
      close();
      opener=chip||null;
      var overlay=document.createElement('div');
      overlay.className='li-overlay';
      overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','li-title');
      overlay.innerHTML='<div class="li-card theme-reinvert"></div>';
      overlay.addEventListener('click',function(event){
        if(event.target===overlay||event.target.closest('.li-close')){close();return}
        var tab=event.target.closest('[data-li-tab]');
        if(tab)render(overlay,tab.dataset.liTab,name);
      });
      document.body.appendChild(overlay);
      document.addEventListener('keydown',onKey);
      render(overlay,name,name);
    });
  }
  document.addEventListener('click',function(event){
    var chip=event.target.closest&&event.target.closest('.trace-line[data-line]');
    if(chip){event.preventDefault();event.stopPropagation();open(chip.dataset.line,chip)}
  },true);
  document.addEventListener('keydown',function(event){
    if(event.key!=='Enter'&&event.key!==' ')return;
    var chip=event.target.closest&&event.target.closest('.trace-line[data-line]');
    if(chip){event.preventDefault();open(chip.dataset.line,chip)}
  });
  load();
})();
