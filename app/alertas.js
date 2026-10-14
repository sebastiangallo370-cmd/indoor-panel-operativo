(function(){
  if(window.__alertasPanel)return;window.__alertasPanel=true;
  var tipos={atrasado:['Atrasados','#ff6b6b'],reproceso:['Reprocesos','#ffb04a'],tela:['Tela no alcanza','#6cb6ff']};
  var movil=innerWidth<=700;
  var css=document.createElement('style');
  css.textContent='#al-btn{position:fixed;right:14px;bottom:'+(movil?'86px':'14px')+';z-index:93;width:46px;height:46px;border-radius:50%;border:1px solid #ffffff30;background:#1d2419;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 4px 14px #0008}'
   +'#al-btn b{position:absolute;top:-5px;right:-5px;min-width:20px;height:20px;border-radius:10px;background:#d93636;font:700 11px Arial;line-height:20px;padding:0 4px}'
   +'#al-box{display:none;position:fixed;right:14px;bottom:'+(movil?'142px':'68px')+';z-index:93;width:min(380px,calc(100vw - 28px));max-height:min(70vh,520px);overflow:auto;background:#151a12;color:#e9efe5;border:1px solid #ffffff25;border-radius:14px;padding:12px;font:13px Arial;box-shadow:0 8px 28px #000b}'
   +'#al-box h4{margin:10px 0 6px;font-size:12px;letter-spacing:.06em}#al-box h4:first-child{margin-top:0}#al-box div{padding:7px 9px;margin-bottom:5px;border-radius:8px;background:#ffffff0d;border-left:3px solid var(--c)}';
  document.head.appendChild(css);
  var btn=document.createElement('button');btn.id='al-btn';btn.type='button';btn.title='Alertas';btn.innerHTML='🔔<b style="display:none"></b>';
  var box=document.createElement('section');box.id='al-box';
  document.body.appendChild(btn);document.body.appendChild(box);
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var last='';
  function draw(d){
    var key=JSON.stringify(d.alertas);if(key===last)return;last=key;
    var n=d.total,b=btn.querySelector('b');b.textContent=n>99?'99+':n;b.style.display=n?'block':'none';
    var html='';
    Object.keys(tipos).forEach(function(t){
      var l=d.alertas.filter(function(a){return a.tipo===t});if(!l.length)return;
      html+='<h4 style="color:'+tipos[t][1]+'">'+tipos[t][0].toUpperCase()+' · '+l.length+'</h4>'+l.map(function(a){return '<div style="--c:'+tipos[t][1]+'">'+esc(a.texto)+'</div>'}).join('');
    });
    box.innerHTML=html||'<p style="margin:0;text-align:center;color:#9fb094">Sin alertas. Todo en orden.</p>';
  }
  function check(){fetch('/api/alertas-panel',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d)draw(d)}).catch(function(){})}
  btn.onclick=function(){box.style.display=box.style.display==='block'?'none':'block'};
  check();setInterval(check,60000);
})();
