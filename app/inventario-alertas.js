// Alertas de stock mínimo en Inventarios: franja de resumen, lista de lo que hay que reponer,
// mínimo editable por ítem y la regla de las telas más pedidas por los clientes.
(function(){
  if(window.__stockAlertas)return;window.__stockAlertas=true;
  var data=null,open=false,rules=false,timer=0,busy=false;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function fmt(n){return new Intl.NumberFormat('es-CO',{maximumFractionDigits:1}).format(Number(n)||0)}
  var css=[
    '#stock-alertas{display:grid;gap:10px;margin:0 0 4px}',
    '.sa-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border:1px solid rgba(208,244,76,.28);border-radius:16px;background:#111a12}',
    '.sa-bar.warn{border-color:rgba(255,138,122,.55);background:linear-gradient(90deg,rgba(120,40,34,.35),#141a12)}',
    '.sa-bar b{font-size:15px}.sa-bar .sa-sub{color:#aebba9;font-size:12.5px}',
    '.sa-bar .sa-grow{flex:1 1 auto}',
    '.sa-btn{min-height:34px;padding:0 14px;border:1px solid rgba(208,244,76,.5);border-radius:10px;background:transparent;color:#d0f44c;font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}',
    '.sa-btn.sa-wa{border-color:#3ddc84;color:#3ddc84}.sa-btn.sa-wa:hover{background:#3ddc84;color:#07130b}.sa-btn:hover{background:#d0f44c;color:#10150e}.sa-btn.on{background:#d0f44c;color:#10150e}',
    '.sa-list{display:grid;gap:6px;max-height:340px;overflow:auto;padding:4px 2px}',
    '.sa-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:12px;align-items:center;padding:9px 14px;border:1px solid #2a3a2c;border-radius:12px;background:#0f1710}',
    '.sa-row .sa-name{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sa-row small{display:block;color:#93a28f;font-size:11px;margin-top:2px}',
    '.sa-chip{padding:3px 10px;border-radius:999px;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}',
    '.sa-chip.agotado{background:rgba(255,106,90,.18);color:#ff9a8c;border:1px solid rgba(255,106,90,.5)}',
    '.sa-chip.bajo{background:rgba(255,184,107,.16);color:#ffc98a;border:1px solid rgba(255,184,107,.45)}',
    '.sa-num{font-variant-numeric:tabular-nums;text-align:right;font-size:13px;color:#dfe8da;white-space:nowrap}',
    '.sa-num em{font-style:normal;color:#93a28f;font-size:11px;display:block}',
    '.sa-edit{border:0;background:transparent;color:#aebba9;cursor:pointer;font-size:15px;padding:4px 6px}.sa-edit:hover{color:#d0f44c}',
    '.sa-rules{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:14px 16px;border:1px dashed rgba(208,244,76,.4);border-radius:14px;background:#0f1710}',
    '.sa-rules label{display:grid;gap:5px;font-size:12px;color:#aebba9}.sa-rules input{width:120px;height:38px;padding:0 10px;border:1px solid #38503b;border-radius:10px;background:#0b110c;color:#fff;font-size:14px}',
    '.sa-rules p{flex:1 1 280px;margin:0;font-size:12.5px;line-height:1.5;color:#aebba9}',
    '.sa-min{display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:2px 9px;border:1px solid #38503b;border-radius:999px;background:transparent;color:#aebba9;font:700 10px Arial;letter-spacing:.06em;cursor:pointer;text-transform:uppercase}',
    '.sa-min:hover{border-color:#d0f44c;color:#d0f44c}',
    '.sa-min.agotado{border-color:rgba(255,106,90,.6);background:rgba(255,106,90,.14);color:#ff9a8c}',
    '.sa-min.bajo{border-color:rgba(255,184,107,.55);background:rgba(255,184,107,.12);color:#ffc98a}',
    '.sa-overlay{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:20px;background:rgba(4,6,4,.7);backdrop-filter:blur(4px)}',
    '.sa-dialog{width:min(400px,100%);padding:22px;border:1px solid rgba(208,244,76,.35);border-radius:20px;background:#0c130d;color:#eef2e9;font-family:Arial,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6)}',
    '.sa-dialog h3{margin:0 0 4px;font-size:17px}.sa-dialog p{margin:0 0 14px;font-size:12.5px;color:#93a28f;word-break:break-word}',
    '.sa-dialog input{width:100%;height:46px;padding:0 12px;border:1px solid #38503b;border-radius:12px;background:#0b110c;color:#fff;font-size:17px;box-sizing:border-box}',
    '.sa-dialog .sa-act{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.sa-dialog .sa-act .sa-btn{flex:1}',
    '.sa-dialog .sa-err{margin-top:10px;color:#ff9a8c;font-size:12.5px;min-height:16px}',
    '@media(max-width:700px){.sa-row{grid-template-columns:minmax(0,1fr) auto}.sa-row .sa-num{grid-column:1}.sa-row .sa-edit{grid-row:1;grid-column:2}}'
  ].join('');
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  function waNumber(){try{return (localStorage.getItem('sa_wa')||'').replace(/\D/g,'')}catch(e){return ''}}
  function waMessage(){
    var list=(data&&data.alertas)||[],lines=['*Alertas de stock · Indoor Sport*',new Date().toLocaleDateString('es-CO',{day:'numeric',month:'long',year:'numeric'}),''];
    var out=list.filter(function(a){return a.nivel==='agotado'}),low=list.filter(function(a){return a.nivel!=='agotado'}),shown=0,MAX=30;
    function block(title,arr,fn){if(!arr.length)return;lines.push(title);arr.forEach(function(a){if(shown>=MAX)return;shown++;lines.push(fn(a))});lines.push('')}
    block('🔴 *AGOTADO*',out,function(a){return '• '+a.nombre+' — mínimo '+fmt(a.minimo)});
    block('🟠 *BAJO EL MÍNIMO*',low,function(a){return '• '+a.nombre+': '+fmt(a.total)+' de '+fmt(a.minimo)+' (faltan '+fmt(a.faltan)+')'});
    if(list.length>shown)lines.push('… y '+(list.length-shown)+' más en el panel.');
    return lines.join(String.fromCharCode(10)).trim();
  }
  function waSend(){
    var url='https://wa.me/'+waNumber()+'?text='+encodeURIComponent(waMessage());
    window.open(url,'_blank','noopener');
  }
  function minimumOf(name){return data&&data.minimos?data.minimos[name]:null}
  function alertOf(name){return data&&data.alertas?data.alertas.find(function(a){return a.nombre===name}):null}

  function dialog(name){
    var info=minimumOf(name),alert=alertOf(name);
    var ov=document.createElement('div');ov.className='sa-overlay';
    ov.innerHTML='<div class="sa-dialog" role="dialog" aria-modal="true"><h3>Stock mínimo</h3><p>'+esc(name)+'</p>'+
      '<input type="number" min="0" step="any" inputmode="decimal" placeholder="Mínimo (mismas unidades del inventario)" value="'+(info?esc(info.minimo):'')+'">'+
      (info&&info.origen==='top'?'<p style="margin:10px 0 0">Hoy usa el mínimo de las telas más pedidas. Si lo cambias aquí, este valor manda sobre la regla.</p>':'')+
      '<div class="sa-err"></div><div class="sa-act"><button type="button" class="sa-btn" data-save>Guardar</button>'+
      (info&&info.origen==='manual'?'<button type="button" class="sa-btn" data-clear>Quitar mínimo</button>':'')+'<button type="button" class="sa-btn" data-cancel>Cancelar</button></div></div>';
    document.body.appendChild(ov);
    var input=ov.querySelector('input'),err=ov.querySelector('.sa-err');input.focus();input.select();
    function close(){ov.remove()}
    function send(value){
      fetch('/api/inventarios/minimos',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombre:name,minimo:value})}).then(function(r){return r.json().then(function(b){return {ok:r.ok,b:b}})}).then(function(res){
        if(!res.ok){err.textContent=typeof res.b.detail==='string'?res.b.detail:'No se pudo guardar.';return}
        close();refresh(true);
      }).catch(function(){err.textContent='No se pudo guardar. Revisa tu conexión.'});
    }
    ov.addEventListener('click',function(e){
      if(e.target===ov||e.target.closest('[data-cancel]'))close();
      else if(e.target.closest('[data-clear]'))send(null);
      else if(e.target.closest('[data-save]')){var v=parseFloat(String(input.value).replace(',','.'));if(!(v>=0)){err.textContent='Escribe un número válido.';return}send(v)}
    });
    input.addEventListener('keydown',function(e){if(e.key==='Enter')ov.querySelector('[data-save]').click();if(e.key==='Escape')close()});
  }

  function banner(){
    var shell=document.querySelector('.inventory-shell');
    if(!shell)return null;
    var box=document.getElementById('stock-alertas');
    if(!box){box=document.createElement('div');box.id='stock-alertas';shell.insertBefore(box,shell.firstChild)}
    return box;
  }

  function render(){
    var box=banner();if(!box||!data)return;
    var res=data.resumen||{},total=(res.agotado||0)+(res.bajo||0);
    var html='<div class="sa-bar'+(total?' warn':'')+'">'+
      (total?'<b>⚠ '+total+(total===1?' ítem':' ítems')+' por debajo del mínimo</b><span class="sa-sub">'+(res.agotado||0)+' agotado(s) · '+(res.bajo||0)+' bajo el mínimo</span>':'<b>✓ Sin alertas de stock</b><span class="sa-sub">'+(res.con_minimo||0)+' ítems con mínimo definido</span>')+
      '<span class="sa-grow"></span>'+(total?'<button type="button" class="sa-btn sa-wa" data-wa title="Abre WhatsApp con el resumen listo para enviar">Enviar por WhatsApp</button><button type="button" class="sa-btn'+(open?' on':'')+'" data-toggle>'+(open?'Ocultar':'Ver alertas')+'</button>':'')+
      '<button type="button" class="sa-btn'+(rules?' on':'')+'" data-rules>Reglas</button></div>';
    if(rules){
      var t=data.top_telas||{};
      html+='<div class="sa-rules"><label>Telas más pedidas<input type="number" min="0" max="60" id="sa-top-n" value="'+esc(t.cantidad)+'"></label><label>Mínimo (MTS)<input type="number" min="0" step="any" id="sa-top-min" value="'+esc(t.minimo)+'"></label><button type="button" class="sa-btn" data-save-rule>Guardar regla</button><label>WhatsApp de destino (opcional)<input type="tel" id="sa-wa-num" placeholder="573001234567" value="'+esc(waNumber())+'" style="width:170px"></label><button type="button" class="sa-btn" data-save-wa>Guardar número</button><p>Las telas con más pedidos de clientes en Producción deben mantener al menos este mínimo. También puedes definir un mínimo propio en cualquier ítem con el botón «MÍN» de su tarjeta.</p></div>';
    }
    if(open&&total){
      html+='<div class="sa-list">'+data.alertas.map(function(a){
        return '<div class="sa-row"><div><div class="sa-name" title="'+esc(a.nombre)+'">'+esc(a.nombre)+'</div><small>'+esc(a.categoria_label||'')+(a.pedidos?' · '+a.pedidos+' pedidos':'')+(a.origen==='top'?' · tela más pedida':'')+'</small></div>'+
          '<span class="sa-chip '+esc(a.nivel)+'">'+(a.nivel==='agotado'?'Agotado':'Bajo')+'</span>'+
          '<div class="sa-num">'+fmt(a.total)+'<em>de '+fmt(a.minimo)+' · faltan '+fmt(a.faltan)+'</em></div>'+
          '<button type="button" class="sa-edit" data-edit="'+esc(a.nombre)+'" title="Cambiar mínimo" aria-label="Cambiar mínimo">✎</button></div>';
      }).join('')+'</div>';
    }
    box.innerHTML=html;
  }

  function decorate(){
    if(!data)return;
    [].forEach.call(document.querySelectorAll('.inventory-item-card'),function(card){
      var nameEl=card.querySelector('.inv-name');if(!nameEl)return;
      var name=nameEl.textContent.trim(),info=minimumOf(name),al=alertOf(name);
      var key=name+'|'+(info?info.minimo:'')+'|'+(al?al.nivel:'');
      var chip=card.querySelector('.sa-min');
      if(chip&&chip.dataset.k===key)return;
      if(!chip){chip=document.createElement('button');chip.type='button';chip.dataset.edit=name;card.appendChild(chip)}
      chip.dataset.k=key;
      chip.className='sa-min'+(al?' '+al.nivel:'');
      chip.title='Cambiar el stock mínimo';
      chip.textContent=info?(al?(al.nivel==='agotado'?'Agotado · ':'Bajo · '):'')+'mín '+fmt(info.minimo):'＋ mínimo';
    });
  }

  function refresh(force){
    if(busy&&!force)return;busy=true;
    fetch('/api/inventarios/alertas',{cache:'no-store'}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(function(d){data=d;render();decorate()}).catch(function(){}).then(function(){busy=false});
  }

  document.addEventListener('click',function(e){
    var ed=e.target.closest('[data-edit]');if(ed){e.preventDefault();e.stopPropagation();dialog(ed.dataset.edit);return}
    if(e.target.closest('[data-wa]')){e.preventDefault();waSend();return}
    if(e.target.closest('[data-save-wa]')){var num=document.getElementById('sa-wa-num').value.replace(/\D/g,'');try{localStorage.setItem('sa_wa',num)}catch(x){}rules=false;render();return}
    if(e.target.closest('[data-toggle]')){open=!open;render();return}
    if(e.target.closest('[data-rules]')){rules=!rules;render();return}
    if(e.target.closest('[data-save-rule]')){
      var n=parseInt(document.getElementById('sa-top-n').value,10),m=parseFloat(String(document.getElementById('sa-top-min').value).replace(',','.'));
      if(!(n>=0)||!(m>=0))return;
      fetch('/api/inventarios/minimos/telas-mas-pedidas',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({cantidad:n,minimo:m})}).then(function(r){if(r.ok){rules=false;refresh(true)}});
    }
  },true);

  var mo=new MutationObserver(function(){
    if(!document.querySelector('.inventory-shell'))return;
    if(!document.getElementById('stock-alertas')&&data)render();
    decorate();
  });
  mo.observe(document.body,{childList:true,subtree:true});
  refresh(true);
  timer=setInterval(function(){if(document.querySelector('.inventory-shell'))refresh(false)},60000);
})();
