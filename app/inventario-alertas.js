// Tarjeta «Telas por reponer» en Inventarios: las telas que están por debajo de su stock mínimo.
// Solo la ven las personas autorizadas (las mismas que reciben el aviso al iniciar sesión).
(function(){
  if(window.__stockAlertas)return;window.__stockAlertas=true;
  var data=null,busy=false;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(Number(n)||0)}
  var css=[
    '.sa-box{margin:0 0 14px}',
    '.sa-card{padding:16px 18px;border:1px solid rgba(255,138,122,.5);border-radius:18px;background:linear-gradient(180deg,#1b1210,#0f1710 60%)}',
    '.sa-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}',
    '.sa-head b{font-size:16px;color:#eef2e9}.sa-head span{font-size:12.5px;color:#aebba9}',
    '.sa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}',
    '.sa-item{display:grid;gap:6px;padding:12px 14px;border:1px solid #2d3b2f;border-radius:14px;background:#0f1710}',
    '.sa-item.agotado{border-color:rgba(255,106,90,.45)}',
    '.sa-name{font-weight:700;font-size:14px;color:#eef2e9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sa-line{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.sa-num{font-variant-numeric:tabular-nums;font-size:13px;color:#dfe8da}.sa-num em{font-style:normal;color:#93a28f;font-size:11px;margin-left:6px}',
    '.sa-chip{padding:3px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}',
    '.sa-chip.agotado{background:rgba(255,106,90,.18);color:#ff9a8c;border:1px solid rgba(255,106,90,.5)}',
    '.sa-chip.bajo{background:rgba(255,184,107,.16);color:#ffc98a;border:1px solid rgba(255,184,107,.45)}'
  ].join('');
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  function cardHtml(list){
    var out=list.filter(function(a){return a.nivel==='agotado'}).length;
    return '<div class="sa-card"><div class="sa-head"><b>⚠ '+list.length+(list.length===1?' TELA CON FALTA DE STOCK':' TELAS CON FALTA DE STOCK')+'</b><span>'+(out?out+' agotada'+(out===1?'':'s')+' · ':'')+'por debajo de su stock mínimo</span></div><div class="sa-grid">'+
      list.map(function(a){return '<div class="sa-item '+esc(a.nivel)+'"><div class="sa-name" title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</div><div class="sa-line"><span class="sa-num">'+fmt(a.total)+' MTS<em>mín '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></span><span class="sa-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotada':'Baja')+'</span></div></div>'}).join('')+'</div></div>';
  }
  function mount(host,id,list){
    var box=document.getElementById(id);
    if(!list.length){if(box)box.remove();return}
    var html=cardHtml(list);
    if(!box){box=document.createElement('div');box.id=id;box.className='sa-box';host.insertBefore(box,host.firstChild)}
    if(box.dataset.h!==html){box.innerHTML=html;box.dataset.h=html}
  }
  function render(){
    var list=(data&&data.aplica&&data.alertas)||[];
    var shell=document.querySelector('.inventory-shell');if(shell)mount(shell,'stock-alertas',list);
    var bd=document.querySelector('.bd-body');
    if(bd&&bd.children.length&&!bd.querySelector(':scope > .bd-note')){
      mount(bd,'stock-alertas-bd',list);
      // la tarjeta nueva reemplaza la sección antigua «Bajo stock» (umbral fijo de 100 MTS)
      if(list.length)[].forEach.call(bd.querySelectorAll('.bd-section'),function(sec){
        var h=sec.querySelector('h3');
        if(h&&/^\s*Bajo stock/i.test(h.textContent)){sec.style.display='none';var n=sec.nextElementSibling;if(n&&n.classList.contains('bd-note'))n.style.display='none'}
      });
    }
  }

  function refresh(){
    if(busy)return;busy=true;
    fetch('/api/alertas-telas',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d){data=d;render()}}).catch(function(){}).then(function(){busy=false});
  }

  new MutationObserver(function(){
    if(!data)return;
    if((document.querySelector('.inventory-shell')&&!document.getElementById('stock-alertas'))||(document.querySelector('.bd-body > .bd-section')&&!document.getElementById('stock-alertas-bd')))render();
  }).observe(document.body||document.documentElement,{childList:true,subtree:true});
  refresh();
  setInterval(refresh,60000);
})();
