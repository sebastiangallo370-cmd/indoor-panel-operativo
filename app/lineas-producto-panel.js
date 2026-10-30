(function(){
  'use strict';
  var panel, tab, data;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function api(){return fetch('/api/lineas-producto',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.detail||'No fue posible cargar las líneas');return d})})}
  function adminGroup(){return Array.prototype.find.call(document.querySelectorAll('.nav-group'),function(group){var parent=group.querySelector('.nav-parent');return parent&&parent.textContent.toUpperCase().indexOf('ADMINISTRACIÓN')>=0})}
  function exitModes(){['inventory-mode','production-mode','inicio-mode','schedule-mode','operarios-mode','cartera-mode'].forEach(function(name){document.body.classList.remove(name)});document.body.classList.add('lineas-producto-mode')}
  function activate(){
    document.querySelectorAll('.tab').forEach(function(item){item.classList.toggle('active',item===tab)});
    document.querySelectorAll('.panel').forEach(function(item){item.classList.toggle('active',item===panel)});
    exitModes();
    if(window.innerWidth<=860)document.body.classList.remove('menu-open');
    window.scrollTo({top:0,behavior:'auto'});
  }
  function render(){
    if(!panel||!data)return;
    var lines=(data.lineas||[]);
    var count=panel.querySelector('[data-lp-count]'), grid=panel.querySelector('[data-lp-grid]');
    count.textContent=lines.length+' línea'+(lines.length===1?'':'s')+' registradas';
    grid.innerHTML=lines.length?lines.map(function(line){
      var mock=(data.mockups||{})[line.id]||'';
      var features=(line.caracteristicas||[]).filter(Boolean);
      return '<article class="lp-card">'+(mock?'<img class="lp-img" src="'+esc(mock)+'" alt="Mockup de '+esc(line.nombre)+'">':'<div class="lp-placeholder">SIN MOCKUP</div>')+
        '<div class="lp-card-body"><span class="lp-style">'+esc(line.estilo||'LÍNEA')+'</span><h3>'+esc(line.nombre)+'</h3>'+
        (line.aliases?'<p class="lp-aliases">'+esc(line.aliases)+'</p>':'')+
        (features.length?'<ul>'+features.slice(0,4).map(function(feature){return '<li>'+esc(feature)+'</li>'}).join('')+'</ul>':'<p class="lp-empty">Sin características registradas.</p>')+
        '</div></article>';
    }).join(''):'<div class="lp-empty-grid">Aún no hay líneas de producto registradas.</div>';
  }
  function refresh(){api().then(function(result){data=result;render()}).catch(function(error){if(panel){var grid=panel.querySelector('[data-lp-grid]');grid.innerHTML='<div class="lp-empty-grid">'+esc(error.message)+'</div>'}})}
  function build(){
    var group=adminGroup();
    if(!group||group.querySelector('[data-kind="lineas-producto"]'))return;
    var children=group.querySelector('.nav-children');
    if(!children)return;
    tab=document.createElement('button');
    tab.type='button';tab.className='tab';tab.dataset.kind='lineas-producto';
    tab.innerHTML='<span class="nav-icon">LP</span><strong>LÍNEAS DE PRODUCTO</strong>';
    tab.addEventListener('click',activate);
    children.appendChild(tab);
    panel=document.createElement('section');
    panel.className='panel lp-panel';panel.dataset.panel='lineas-producto';
    panel.innerHTML='<div class="lp-shell"><header class="lp-head"><div><span class="eyebrow">Administración · Catálogo de producción</span><h2>LÍNEAS DE PRODUCTO</h2><p>Consulta y organiza las líneas, características y mockups que usan las tarjetas de producción.</p></div><div class="lp-actions"><strong data-lp-count>Cargando…</strong><button type="button" data-lp-edit>✎ Editar líneas</button></div></header><div class="lp-grid" data-lp-grid><div class="lp-empty-grid">Cargando líneas de producto…</div></div></div>';
    document.querySelector('main').appendChild(panel);
    panel.querySelector('[data-lp-edit]').addEventListener('click',function(){if(typeof window.abrirLineasProducto==='function')window.abrirLineasProducto()});
    var style=document.createElement('style');
    style.textContent='body.lineas-producto-mode main{max-width:1480px}.lp-shell{display:grid;gap:18px;padding:clamp(18px,3vw,38px)}.lp-head{display:flex;justify-content:space-between;gap:22px;align-items:flex-end;padding:24px 26px;border:1px solid rgba(208,244,76,.3);border-radius:20px;background:linear-gradient(135deg,rgba(208,244,76,.12),rgba(17,25,16,.92) 42%,rgba(7,11,8,.95));box-shadow:0 18px 44px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.09)}.lp-head h2{margin:5px 0 7px;font-size:clamp(1.35rem,2.4vw,2rem);letter-spacing:-.04em}.lp-head p{max-width:700px;margin:0;color:var(--muted);line-height:1.5}.lp-actions{display:grid;gap:10px;justify-items:end;white-space:nowrap}.lp-actions strong{color:var(--lime);font-size:.76rem;letter-spacing:.04em;text-transform:uppercase}.lp-actions button{width:auto;padding:11px 16px;border:1px solid rgba(208,244,76,.7);border-radius:10px;background:var(--lime);color:#14200a;font:800 .78rem Arial;cursor:pointer;box-shadow:0 9px 23px rgba(208,244,76,.18)}.lp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.lp-card{overflow:hidden;border:1px solid rgba(208,244,76,.22);border-radius:17px;background:linear-gradient(150deg,rgba(28,39,25,.94),rgba(8,13,9,.97));box-shadow:0 14px 32px rgba(0,0,0,.21),inset 0 1px 0 rgba(255,255,255,.06);transition:transform .18s ease,border-color .18s ease}.lp-card:hover{transform:translateY(-3px);border-color:rgba(208,244,76,.62)}.lp-img,.lp-placeholder{display:block;width:100%;height:205px;object-fit:contain;background:#edf0e8}.lp-placeholder{display:grid;place-items:center;color:#73816e;background:linear-gradient(135deg,#f1f3ed,#dce3d8);font:800 .68rem Arial;letter-spacing:.13em}.lp-card-body{display:grid;gap:8px;padding:16px}.lp-style{width:max-content;padding:4px 8px;border-radius:999px;background:rgba(208,244,76,.14);color:var(--lime);font:800 .62rem Arial;letter-spacing:.08em}.lp-card h3{margin:0;font-size:1.05rem}.lp-aliases,.lp-empty{margin:0;color:var(--muted);font-size:.76rem;line-height:1.4}.lp-card ul{display:grid;gap:5px;margin:2px 0 0;padding:0;list-style:none}.lp-card li{padding-top:6px;border-top:1px solid rgba(255,255,255,.08);color:#d8e3d2;font-size:.75rem}.lp-empty-grid{display:grid;min-height:210px;place-items:center;border:1px dashed rgba(208,244,76,.28);border-radius:16px;color:var(--muted);text-align:center}@media(max-width:700px){.lp-shell{padding:14px}.lp-head{align-items:start;flex-direction:column;padding:19px}.lp-actions{justify-items:start;width:100%;white-space:normal}.lp-actions button{width:100%}.lp-grid{grid-template-columns:1fr 1fr;gap:9px}.lp-img,.lp-placeholder{height:135px}.lp-card-body{padding:12px}.lp-card h3{font-size:.9rem}.lp-card li{font-size:.68rem}}@media(max-width:440px){.lp-grid{grid-template-columns:1fr}}';
    document.head.appendChild(style);
    refresh();
  }
  api().then(function(result){if(!result.puede_editar)return;data=result;build();render()}).catch(function(){});
  window.addEventListener('lineas-actualizadas',refresh);
})();
