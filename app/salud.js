(function(){
  if(window.__saludAviso)return;window.__saludAviso=true;
  var bar=document.createElement('div');
  bar.id='salud-aviso';
  bar.style.cssText='display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:'+(innerWidth<=700?'86px':'14px')+';max-width:min(900px,calc(100vw - 24px));z-index:94;background:#b3261e;color:#fff;font:700 12px Arial;padding:8px 14px;border-radius:10px;text-align:center;box-shadow:0 4px 16px #000a';
  document.body.appendChild(bar);
  function check(){
    fetch('/api/salud-panel',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d)return;
      if(d.problemas&&d.problemas.length){bar.textContent='⚠ '+d.problemas.join(' · ');bar.style.display='block'}
      else bar.style.display='none';
    }).catch(function(){});
  }
  check();setInterval(check,60000);
})();
