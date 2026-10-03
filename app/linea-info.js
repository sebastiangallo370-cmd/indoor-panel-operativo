// Ficha de LÍNEA DE PRODUCTO: al tocar la etiqueta de una tarjeta se abre una ficha con lo que incluye la línea
// (documento «Líneas de producto») y su mockup de referencia. Los textos viven en /api/lineas-producto.
(function(){
  if(window.__lineaInfo)return;window.__lineaInfo=true;
  var data=null,loading=null,opener=null;
  var ACCENT={premium:'#d0f44c',estandar:'#c3ee3f',plus:'#d3d8cf',maquila:'#ffffff'};
  function plain(text){return String(text||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim()}
  function esc(text){return String(text==null?'':text).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function load(){
    if(data)return Promise.resolve(data);
    if(!loading)loading=fetch('/api/lineas-producto',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){data=d;return d}).catch(function(){loading=null;return null});
    return loading;
  }

  var css=[
    '.trace-line[data-line]{cursor:pointer;transition:transform .15s,box-shadow .15s}',
    '.trace-line[data-line]:hover{transform:translateY(-1px);box-shadow:0 3px 12px rgba(0,0,0,.35)}',
    '.trace-line[data-line]:focus-visible{outline:2px solid #d0f44c;outline-offset:2px}',
    '.li-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(4,6,4,.72);backdrop-filter:blur(5px);animation:li-fade .2s ease-out}',
    '.li-card{--ac:#d0f44c;position:relative;width:min(620px,100%);max-height:min(92vh,780px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:radial-gradient(120% 80% at 0% 0%,rgba(208,244,76,.09),transparent 55%),#0a0e09;color:#eef2e9;font-family:Inter,Arial,sans-serif;box-shadow:0 40px 90px rgba(0,0,0,.65),0 0 0 1px rgba(0,0,0,.4);animation:li-pop .3s cubic-bezier(.2,.9,.3,1.1)}',
    '.li-card.has-mock{width:min(1020px,100%)}',
    '.li-close{position:absolute;top:16px;right:16px;z-index:5;width:36px;height:36px;display:grid;place-items:center;padding:0!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:50%!important;background:rgba(10,14,9,.55)!important;backdrop-filter:blur(6px);color:#fff!important;font:300 22px/1 Arial!important;cursor:pointer;transition:background .15s,transform .15s}',
    '.li-close:hover{background:rgba(255,255,255,.16)!important;transform:rotate(90deg)}',
    '.li-split{display:flex;flex:1;min-height:0}',
    /* mockup */
    '.li-mock{position:relative;flex:0 0 40%;min-width:330px;max-width:430px;display:flex;flex-direction:column;padding:26px 26px 22px;background:radial-gradient(circle at 50% 38%,#ffffff 0%,#eceee9 55%,#d9ddd4 100%);color:#10150e;overflow:hidden}',
    '.li-mock::before{content:"";position:absolute;right:-46px;bottom:-34px;width:250px;height:190px;background:url(/favicon.svg) no-repeat center/contain;opacity:.1;pointer-events:none}',
    '.li-mock-tag{position:relative;z-index:1;display:flex;align-items:center;gap:8px;font:800 9.5px Arial;letter-spacing:.24em;color:#4a5640}',
    '.li-mock-tag i{display:block;width:18px;height:2px;background:var(--ac);filter:brightness(.55)}',
    '.li-stage{position:relative;z-index:1;flex:1;min-height:220px;display:flex;align-items:center;justify-content:center;margin:12px 0;cursor:zoom-in}',
    '.li-stage img{display:block;max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 22px 26px rgba(16,21,14,.28));animation:li-img .45s ease-out}',
    '.li-zoom{position:absolute;right:2px;bottom:2px;width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:rgba(16,21,14,.78);color:#fff;font-size:14px;opacity:0;transition:opacity .2s}',
    '.li-stage:hover .li-zoom{opacity:1}',
    '.li-mock-cap{position:relative;z-index:1;text-align:center;font:800 11px Arial;letter-spacing:.2em;text-transform:uppercase;color:#2c3626}',
    /* contenido */
    '.li-main{flex:1;min-width:0;display:flex;flex-direction:column;padding:28px 40px 0}',
    '.li-top{display:flex;align-items:center;gap:14px;padding-right:48px}',
    '.li-logo{display:block;flex:0 0 auto;width:92px;height:24px;background:#d0f44c;-webkit-mask:url(/marca-indoor.svg) left center/contain no-repeat;mask:url(/marca-indoor.svg) left center/contain no-repeat}',
    '.li-top span{padding-left:14px;border-left:1px solid rgba(255,255,255,.18);color:#8e9a87;font:700 10px Arial;letter-spacing:.24em}',
    '.li-top span.li-logo{padding-left:0;border-left:0}',
    '.li-tabs{display:flex;gap:26px;margin:24px 0 0;border-bottom:1px solid rgba(255,255,255,.1);overflow-x:auto;scrollbar-width:none}',
    '.li-tabs::-webkit-scrollbar{display:none}',
    '.li-tabs button{flex:0 0 auto;display:block!important;width:auto!important;min-height:0!important;margin:0 0 -1px!important;padding:10px 0!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:0!important;background:none!important;box-shadow:none!important;color:#74806d!important;font:800 11px Arial!important;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:color .15s,border-color .15s}',
    '.li-tabs button:hover{color:#dfe7d8!important}',
    '.li-tabs button[aria-pressed=true]{color:#fff!important;border-bottom-color:var(--ac)!important}',
    '.li-pane{flex:1;min-height:0;overflow-y:auto;padding:26px 6px 14px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;animation:li-slide .32s ease-out}',
    '.li-title{display:flex;align-items:center;gap:16px}',
    '.li-bar{display:block;flex:0 0 6px;height:50px;border-radius:3px;background:var(--ac)}',
    '.li-title h2{margin:0;padding:0;border:0;font:900 clamp(34px,5vw,54px)/1 Inter,Arial,sans-serif;letter-spacing:.01em;color:#fff;text-transform:uppercase}',
    '.li-sub{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin:14px 0 8px 22px;color:#8e9a87;font:500 12px Arial;letter-spacing:.04em}',
    '.li-count{padding:4px 12px;border:1px solid var(--ac);border-radius:999px;color:var(--ac);font:800 10px Arial;letter-spacing:.14em;text-transform:uppercase}',
    '.li-list{margin:14px 0 0;padding:0;list-style:none}',
    '.li-list li{display:flex;align-items:baseline;gap:18px;padding:15px 4px;border-bottom:1px solid rgba(255,255,255,.07);font:500 14.5px/1.45 Inter,Arial,sans-serif;letter-spacing:.015em;color:#e8eee2;transition:background .15s,padding-left .15s}',
    '.li-list li:last-child{border-bottom:0}',
    '.li-list li:hover{background:linear-gradient(90deg,rgba(255,255,255,.04),transparent);padding-left:10px}',
    '.li-list li b{flex:0 0 26px;color:var(--ac);font:800 12px Arial;letter-spacing:.1em}',
    '.li-empty{margin:20px 0 6px;color:#9aa693;font:italic 400 14.5px/1.6 Inter,Arial,sans-serif;max-width:46ch}',
    '.li-foot{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:0 -40px;padding:15px 40px 18px;border-top:1px solid rgba(255,255,255,.07);color:#6d7966;font:500 10.5px Arial;letter-spacing:.06em}',
    '.li-foot-l{display:flex;align-items:center;gap:11px}.li-iso{display:block;height:20px;width:auto}.li-foot i{color:#b3bfab;font:italic 500 12.5px Arial;letter-spacing:.03em}',
    '@keyframes li-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes li-pop{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}',
    '@keyframes li-slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}',
    '@keyframes li-img{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}',
    '@media(max-width:700px){',
      '.li-overlay{align-items:flex-end;padding:0}',
      '.li-card,.li-card.has-mock{width:100%;max-height:92vh;border-radius:24px 24px 0 0;animation:li-up .3s ease-out}',
      '.li-split{flex-direction:column;overflow-y:auto}',
      '.li-mock{flex:0 0 auto;min-width:0;max-width:none;padding:18px 20px 14px}',
      '.li-stage{height:230px;flex:0 0 230px;min-height:0}',
      '.li-main{padding:22px 22px 0;overflow:visible}',
      '.li-top span:not(.li-logo){display:none}',
      '.li-tabs{gap:20px;margin-top:18px}',
      '.li-pane{overflow:visible;padding:20px 0 8px}',
      '.li-bar{height:38px}',
      '.li-sub{margin-left:20px}',
      '.li-foot{margin:0 -22px;padding:14px 22px 26px;flex-direction:column;align-items:flex-start;gap:6px}',
      '@keyframes li-up{from{transform:translateY(46px);opacity:.6}to{transform:none;opacity:1}}',
    '}'
  ].join('');
  var style=document.createElement('style');
  style.textContent=css;
  document.head.appendChild(style);

  function find(name){
    var key=plain(name);
    for(var i=0;i<data.lineas.length;i++)if(plain(data.lineas[i].nombre)===key)return data.lineas[i];
    return null;
  }
  function pad(n){return n<10?'0'+n:''+n}
  function render(overlay,name,chipName){
    var line=find(name),card=overlay.querySelector('.li-card');
    var title=line?line.nombre:chipName;
    var accent=line?(ACCENT[line.estilo]||'#d0f44c'):'#d0f44c';
    var n=line?line.caracteristicas.length:0;
    var count=line?(n?n+' característica'+(n===1?'':'s'):'Por definir'):'Sin especificaciones registradas';
    var body;
    if(line&&n)body='<ol class="li-list">'+line.caracteristicas.map(function(c,i){return '<li><b>'+pad(i+1)+'</b><span>'+esc(c)+'</span></li>'}).join('')+'</ol>';
    else if(line)body='<p class="li-empty">'+esc(line.nota||'Las especificaciones de esta línea están pendientes de definir.')+'</p>';
    else body='<p class="li-empty">Esta línea no aparece en el documento «Líneas de producto» ('+esc(data.fuente.split('·').pop().trim())+'). El documento define '+data.lineas.map(function(l){return l.nombre.charAt(0)+l.nombre.slice(1).toLowerCase()}).join(', ').replace(/, ([^,]*)$/,' y $1')+'. Elige una arriba para ver lo que incluye.</p>';
    var tabs='<div class="li-tabs" role="tablist" aria-label="Líneas de producto">'+data.lineas.map(function(l){return '<button type="button" role="tab" data-li-tab="'+esc(l.nombre)+'" aria-pressed="'+(!!line&&l.nombre===line.nombre)+'">'+esc(l.nombre)+'</button>'}).join('')+'</div>';
    var slug=plain(title).replace(/[^A-Z0-9]/g,''),mockUrl=data.mockups&&data.mockups[slug];
    var mock=mockUrl?'<div class="li-mock"><div class="li-mock-tag"><i></i>MOCKUP DE REFERENCIA</div><a class="li-stage" href="'+esc(mockUrl)+'" target="_blank" rel="noopener" title="Ver en grande"><img src="'+esc(mockUrl)+'" alt="Mockup de la línea '+esc(title)+'"><span class="li-zoom" aria-hidden="true">⤢</span></a><div class="li-mock-cap">Línea '+esc(title)+'</div></div>':'';
    var top='<div class="li-top"><span class="li-logo" role="img" aria-label="Indoor"></span><span>LÍNEAS DE PRODUCTO</span></div>';
    var pane='<div class="li-pane"><div class="li-title"><i class="li-bar"></i><h2 id="li-title">'+esc(title)+'</h2></div><p class="li-sub"><span class="li-count">'+esc(count)+'</span><span>'+esc(data.fuente.split('·').slice(1).join('·').trim())+'</span></p>'+body+'</div>';
    var foot='<div class="li-foot"><span class="li-foot-l"><img class="li-iso" src="/favicon.svg" alt=""><i>'+esc(data.lema||'')+'</i></span><span>Documento interno · Indoor Sport</span></div>';
    card.style.setProperty('--ac',accent);
    card.classList.toggle('has-mock',!!mockUrl);
    card.innerHTML='<button type="button" class="li-close" aria-label="Cerrar">×</button><div class="li-split">'+mock+'<div class="li-main">'+top+tabs+pane+foot+'</div></div>';
    var active=card.querySelector('[aria-pressed=true]');
    if(active&&active.scrollIntoView)try{active.scrollIntoView({block:'nearest',inline:'center'})}catch(e){}
    card.querySelector('.li-close').focus();
  }
  function close(){
    var overlay=document.querySelector('.li-overlay');
    if(overlay)overlay.remove();
    document.removeEventListener('keydown',onKey);
    if(opener&&opener.focus)opener.focus();
  }
  function onKey(event){
    if(event.key==='Escape'){close();return}
    if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
    var overlay=document.querySelector('.li-overlay');
    if(!overlay)return;
    var tabs=[].slice.call(overlay.querySelectorAll('[data-li-tab]'));
    var index=tabs.findIndex(function(t){return t.getAttribute('aria-pressed')==='true'});
    var next=tabs[(Math.max(index,0)+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length];
    if(next){event.preventDefault();render(overlay,next.dataset.liTab,overlay.dataset.chip||'')}
  }
  function open(name,chip){
    load().then(function(d){
      if(!d||!d.lineas)return;
      close();
      opener=chip||null;
      var overlay=document.createElement('div');
      overlay.className='li-overlay';
      overlay.dataset.chip=name;
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
