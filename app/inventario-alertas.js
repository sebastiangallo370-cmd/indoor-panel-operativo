// Tarjeta «Telas por reponer» en Inventarios: las telas que están por debajo de su stock mínimo.
// Solo la ven las personas autorizadas (las mismas que reciben el aviso al iniciar sesión).
(function(){
  if(window.__stockAlertas)return;window.__stockAlertas=true;
  var data=null,busy=false;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(Number(n)||0)}
  var css=[
    '#stock-alertas{margin:0 0 4px}',
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

  function render(){
    var shell=document.querySelector('.inventory-shell');
    if(!shell)return;
    var box=document.getElementById('stock-alertas');
    var list=(data&&data.aplica&&data.alertas)||[];
    if(!list.length){if(box)box.remove();return}
    if(!box){box=document.createElement('div');box.id='stock-alertas';shell.insertBefore(box,shell.firstChild)}
    var out=list.filter(function(a){return a.nivel==='agotado'}).length;
    box.innerHTML='<div class="sa-card"><div class="sa-head"><b>⚠ Telas por reponer · '+list.length+'</b><span>'+(out?out+' agotada'+(out===1?'':'s')+' · ':'')+'por debajo de su stock mínimo</span></div><div class="sa-grid">'+
      list.map(function(a){return '<div class="sa-item '+esc(a.nivel)+'"><div class="sa-name" title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</div><div class="sa-line"><span class="sa-num">'+fmt(a.total)+' MTS<em>mín '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></span><span class="sa-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotada':'Baja')+'</span></div></div>'}).join('')+'</div></div>';
  }

  function refresh(){
    if(busy)return;busy=true;
    fetch('/api/alertas-telas',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d){data=d;render()}}).catch(function(){}).then(function(){busy=false});
  }

  new MutationObserver(function(){
    if(!document.querySelector('.inventory-shell'))return;
    if(data&&!document.getElementById('stock-alertas'))render();
  }).observe(document.body||document.documentElement,{childList:true,subtree:true});
  refresh();
  setInterval(function(){if(document.querySelector('.inventory-shell'))refresh()},60000);
})();
