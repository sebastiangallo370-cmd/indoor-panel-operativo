(function(){
  if(window.__saludAviso)return;window.__saludAviso=true;
  var bar=document.createElement('div');
  bar.id='salud-aviso';
  bar.style.cssText='display:none;position:fixed;top:0;left:0;right:0;z-index:99999;background:#b3261e;color:#fff;font:700 13px Arial;padding:8px 14px;text-align:center;box-shadow:0 2px 10px #0008';
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
