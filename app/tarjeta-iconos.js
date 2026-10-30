// Tarjetas de producción: todos los botones de acción van en una columna lateral y se ven como iconos.
// Son los mismos botones (mismas clases y atributos data-*), solo se mueven y cambian de aspecto;
// el nombre original queda como texto oculto y como ayuda al pasar el mouse.
(function(){
  if(window.__tarjetaIconos)return;window.__tarjetaIconos=true;
  var ICONS={
    play:'<path d="M7 4.5v15l12-7.5z"/>',
    pause:'<path d="M8.5 5v14M15.5 5v14"/>',
    check:'<path d="M4.5 12.5l5 5 10-11"/>',
    na:'<circle cx="12" cy="12" r="8"/><path d="M6.4 17.6l11.2-11.2"/>',
    undo:'<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4.2h4.2"/>',
    loop:'<path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M4 12a8 8 0 0 1 14-5.3"/><path d="M18.5 3v4h-4M5.5 21v-4h4"/>',
    edit:'<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash:'<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
    note:'<path d="M5 4h14v12H9.5L5 20z"/><path d="M12 7.5v5M9.5 10h5"/>',
    ruler:'<path d="M3 15L15 3l6 6L9 21z"/><path d="M7 11l2.2 2.2M10 8l2.2 2.2M13 5l2.2 2.2"/>',
    folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    copy:'<rect x="9" y="4" width="10" height="12" rx="1.5"/><path d="M15 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3"/>',
    image:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.35"/><path d="M5.5 17l4.3-4 3.1 2.7 2.4-2 2.2 3.3"/>',
    images:'<rect x="6" y="7" width="14" height="12" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/><circle cx="12" cy="11" r="1.2"/><path d="M8 17l3.2-3 2.1 1.7 1.8-1.6 2 3"/>'
  };
  // selector, icono, ayuda, grupo (los grupos se separan con una línea fina)
  var MAP=[
    ['.trace-order-start','play','Iniciar proceso',1],
    ['.trace-order-resume','play','Reanudar proceso',1],
    ['.trace-order-pause','pause','Pausar proceso',1],
    ['.trace-order-finish','check','Finalizar proceso',1],
    ['.trace-order-na','na','No aplica (N/A)',1],
    ['.trace-order-clear','undo','Quitar estado',1],
    ['[data-card-rework]','loop','Registrar reproceso',2],
    ['.trace-order-note','note','Agregar nota general',3]
  ];
  var B='html body.production-mode .trace-card ';
  var style=document.createElement('style');
  style.textContent=
    B+'.trace-card-body{position:relative;padding-right:62px!important}'+
    B+'.trace-rail{position:absolute;top:14px;right:10px;z-index:4;display:flex;flex-direction:column;align-items:center;gap:6px}'+
    B+'.trace-rail .ti-sep{width:22px;height:1px;margin:3px 0;background:rgba(128,140,120,.4)}'+
    B+'.trace-rail button{position:relative;width:38px!important;min-width:38px!important;height:38px!important;min-height:38px!important;margin:0!important;padding:0!important;display:grid!important;place-items:center;border:1px solid rgba(128,140,120,.38)!important;border-radius:11px!important;background:rgba(128,140,120,.14)!important;color:#d3dccd!important;font-size:0!important;cursor:pointer;box-shadow:none!important;transition:background .15s,color .15s,border-color .15s,transform .15s}'+
    B+'.trace-rail button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}'+
    B+'.trace-rail button .ti-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}'+
    B+'.trace-rail button:hover:not(:disabled){background:#d0f44c!important;border-color:#d0f44c!important;color:#10150e!important;transform:scale(1.07)}'+
    B+'.trace-rail button:disabled{opacity:.3;cursor:not-allowed}'+
    B+'.trace-rail .trace-order-finish{color:#7fe08f!important}'+
    B+'.trace-rail .trace-order-clear{color:#f2c14e!important}'+
    B+'.trace-rail [data-card-rework].has-rework{background:rgba(239,115,112,.28)!important;border-color:#ef7370!important;color:#ffb3ae!important}'+
    B+'.trace-rail button::after{content:attr(data-tip);position:absolute;right:46px;top:50%;transform:translateY(-50%);padding:5px 9px;border-radius:7px;background:#10150e;color:#fff;font:700 11px Arial;letter-spacing:.03em;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .12s}'+
    B+'.trace-rail button:hover::after,'+B+'.trace-rail button:focus-visible::after{opacity:1}'+
    B+'.trace-order-actions:empty,'+B+'.trace-card-actions:empty{display:none!important}'+
    B+'.trace-media{position:relative}'+
    B+'.trace-copy-tools{position:absolute;left:12px;top:12px;z-index:8;display:flex;flex-direction:column;align-items:center;gap:8px}'+
    B+'.trace-copy-tools button{width:25px!important;min-width:25px!important;height:25px!important;min-height:25px!important;padding:0!important;margin:0!important;display:grid!important;place-items:center!important;border:1px solid rgba(19,32,24,.58)!important;border-radius:5px!important;background:rgba(255,255,255,.92)!important;color:#18241c!important;box-shadow:0 1px 3px rgba(0,0,0,.13)!important;font-size:0!important;cursor:pointer;transition:transform .14s,background .14s,color .14s,border-color .14s}'+
    B+'.trace-copy-tools button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}'+
    B+'.trace-copy-tools button:hover,'+B+'.trace-copy-tools button:focus-visible{background:#d0f44c!important;border-color:#263526!important;color:#10170e!important;transform:scale(1.09)}'+
    B+'.trace-copy-tools button.is-done{background:#e8f8d1!important;border-color:#56713f!important;color:#203817!important}'+
    B+'.trace-copy-tools button:disabled{opacity:.55;cursor:wait;transform:none}'+
    '@media(max-width:700px){'+B+'.trace-copy-tools{left:11px;top:11px;gap:9px}'+B+'.trace-copy-tools button{width:28px!important;min-width:28px!important;height:28px!important;min-height:28px!important}'+B+'.trace-copy-tools button svg{width:17px;height:17px}}'+
    '@media(max-width:700px){'+B+'.trace-rail button{width:42px!important;min-width:42px!important;height:42px!important;min-height:42px!important}'+B+'.trace-card-body{padding-right:66px!important}'+B+'.trace-rail{right:8px}}';
  document.head.appendChild(style);

  function iconize(button,icon,tip){
    if(button.dataset.ti)return;
    button.dataset.ti='1';
    var label=(button.getAttribute('aria-label')||button.textContent||'').trim();
    button.dataset.tip=tip;
    button.title=tip;
    button.setAttribute('aria-label',label||tip);
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[icon]+'</svg><span class="ti-label">'+tip+'</span>';
  }
  function railize(card){
    var rail=card.querySelector('.trace-rail');
    var found=[];
    MAP.forEach(function(entry,index){
      card.querySelectorAll(entry[0]).forEach(function(button){
        if(button.closest('.trace-design-view')||button.dataset.tiDone==='1'&&rail&&rail.contains(button))return;
        if(found.some(function(f){return f.button===button}))return;
        found.push({button:button,entry:entry,index:index});
      });
    });
    var pending=found.filter(function(f){return !(rail&&rail.contains(f.button))});
    if(!pending.length&&rail)return;
    if(!rail){
      var body=card.querySelector('.trace-card-body');
      if(!body)return;
      rail=document.createElement('div');
      rail.className='trace-rail';
      rail.setAttribute('role','toolbar');
      rail.setAttribute('aria-label','Acciones de la orden');
      body.appendChild(rail);
    }
    found.sort(function(a,b){return a.index-b.index});
    var previous=0;
    rail.querySelectorAll('.ti-sep').forEach(function(sep){sep.remove()});
    found.forEach(function(item){
      iconize(item.button,item.entry[1],item.entry[2]);
      item.button.dataset.tiDone='1';
      var group=item.entry[3];
      if(previous&&group!==previous){var sep=document.createElement('span');sep.className='ti-sep';rail.appendChild(sep)}
      rail.appendChild(item.button);
      previous=group;
    });
    // la tarjeta nunca debe ser más baja que su columna de iconos
    var host=rail.parentElement;
    if(host)host.style.minHeight=(rail.offsetHeight+30)+'px';
  }
  var queued=false;
  function textOf(node){return node?String(node.textContent||'').replace(/\s+/g,' ').trim():''}
  function flash(button,message){var original=button.dataset.tip||button.title;button.dataset.tip=message;button.title=message;button.classList.add('is-done');setTimeout(function(){button.dataset.tip=original;button.title=original;button.classList.remove('is-done')},1800)}
  async function copyText(value){if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(value);return}var field=document.createElement('textarea');field.value=value;field.setAttribute('readonly','');field.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(field);field.select();try{document.execCommand('copy')}finally{field.remove()}}
  async function pngBlob(blob){if(blob.type==='image/png')return blob;var image=await loadImage(blob),canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;canvas.getContext('2d').drawImage(image,0,0);return new Promise(function(resolve,reject){canvas.toBlob(function(out){out?resolve(out):reject(Error('No fue posible preparar la imagen'))},'image/png')})}
  async function copyImageBlob(blob){var png=await pngBlob(blob);if(!navigator.clipboard||!window.ClipboardItem)throw Error('Tu navegador no permite copiar imágenes');await navigator.clipboard.write([new ClipboardItem({'image/png':png})])}
  async function fetchImage(url){var response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw Error('No se pudo leer el mockup');return response.blob()}
  function loadImage(blob){return new Promise(function(resolve,reject){var image=new Image(),url=URL.createObjectURL(blob);image.onload=function(){URL.revokeObjectURL(url);resolve(image)};image.onerror=function(){URL.revokeObjectURL(url);reject(Error('No se pudo abrir el mockup'))};image.src=url})}
  async function groupedMockup(urls){var images=await Promise.all(urls.map(async function(url){return loadImage(await fetchImage(url))})),tileW=760,tileH=980,columns=Math.min(2,images.length),rows=Math.ceil(images.length/columns),canvas=document.createElement('canvas');canvas.width=tileW*columns;canvas.height=tileH*rows;var ctx=canvas.getContext('2d');ctx.fillStyle='#f7f8f4';ctx.fillRect(0,0,canvas.width,canvas.height);images.forEach(function(image,index){var x=(index%columns)*tileW,y=Math.floor(index/columns)*tileH,scale=Math.min((tileW-36)/image.naturalWidth,(tileH-36)/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,x+(tileW-w)/2,y+(tileH-h)/2,w,h)});return new Promise(function(resolve,reject){canvas.toBlob(function(blob){blob?resolve(blob):reject(Error('No se pudo preparar el grupo'))},'image/png')})}
  function detailsText(card){var get=function(selector){return textOf(card.querySelector(selector))||'—'};return ['CLIENTE: '+get('.trace-client'),'PROYECTO: '+get('.trace-project'),'REFERENCIA: '+get('.trace-ref'),'TELA: '+get('.trace-tela span'),'FECHA DE ENTREGA: '+get('.trace-due dd'),'MÁQUINA DE IMPRESIÓN: '+get('.trace-machine-btn'),'CANTIDAD: '+get('.trace-quantity')].join('\n')}
  function copyButton(icon,tip,action){var button=document.createElement('button');button.type='button';button.dataset.tip=tip;button.title=tip;button.setAttribute('aria-label',tip);button.dataset.copyAction=action;button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[icon]+'</svg>';return button}
  function addCopyTools(card){
    var media=card.querySelector('.trace-media');if(!media||media.querySelector('.trace-copy-tools'))return;
    var tools=document.createElement('div');tools.className='trace-copy-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Copiar información y mockups');
    tools.appendChild(copyButton('copy','Copiar información de la tarjeta','info'));
    tools.appendChild(copyButton('image','Copiar mockup visible','visible'));
    tools.appendChild(copyButton('images','Copiar todos los mockups agrupados','group'));
    tools.addEventListener('click',async function(event){
      var button=event.target.closest('button[data-copy-action]');if(!button)return;var action=button.dataset.copyAction;
      try{
        button.disabled=true;
        if(action==='info'){await copyText(detailsText(card));flash(button,'Información copiada');return}
        var row=card.dataset.cardRow,urls=[];
        if(action==='visible'){var image=media.querySelector('.trace-design-main img');if(!image)throw Error('El mockup todavía no está disponible');urls=[image.currentSrc||image.src]}
        else {var response=await fetch('/api/produccion/fila/'+encodeURIComponent(row)+'/archivos',{cache:'no-store',credentials:'same-origin'}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudieron consultar los mockups');urls=(data.images||[]).map(function(image){return image.url}).filter(Boolean);if(!urls.length)throw Error('No hay mockups disponibles')}
        var blob=action==='visible'?await fetchImage(urls[0]):await groupedMockup(urls);
        try{await copyImageBlob(blob);flash(button,action==='visible'?'Mockup copiado':'Mockups agrupados copiados')}catch(error){await copyText(urls.join('\n'));flash(button,'Se copiaron los enlaces de los mockups')}
      }catch(error){flash(button,error&&error.message||'No se pudo copiar')}
      finally{button.disabled=false}
    });
    media.appendChild(tools);
  }
  function run(){
    queued=false;
    document.querySelectorAll('.trace-card[data-card-row]').forEach(function(card){railize(card);addCopyTools(card)});
  }
  function schedule(){if(!queued){queued=true;setTimeout(run,40)}}
  function start(){
    var container=document.querySelector('.trace-cards')||document.getElementById('trace-cards');
    if(!container){setTimeout(start,800);return}
    new MutationObserver(schedule).observe(container,{childList:true,subtree:true});
    run();
  }
  start();
})();
