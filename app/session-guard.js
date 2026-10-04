// Si se cierra la página (todas las pestañas del panel) y se vuelve a abrir, pide iniciar sesión otra vez.
// Recargar o abrir otra pestaña mientras el panel sigue abierto NO cierra la sesión.
(function(){
  if(window.__sessionGuard)return;window.__sessionGuard=true;
  var FLAG='indoor_tab_ok',HB='indoor_hb_',id=Math.random().toString(36).slice(2),ALIVE=15000;
  function out(){
    try{document.documentElement.style.visibility='hidden'}catch(e){}
    location.replace('/logout');
  }
  try{
    var fresh=/(?:^|;\s*)indoor_fresh=1/.test(document.cookie);
    if(fresh){
      // acaba de iniciar sesión: esta pestaña queda autorizada
      document.cookie='indoor_fresh=; Max-Age=0; path=/';
      sessionStorage.setItem(FLAG,'1');
    }else if(!sessionStorage.getItem(FLAG)){
      var alive=false,now=Date.now();
      Object.keys(localStorage).forEach(function(k){if(k.indexOf(HB)===0&&now-parseInt(localStorage.getItem(k),10)<ALIVE)alive=true});
      if(alive)sessionStorage.setItem(FLAG,'1');   // otra pestaña del panel sigue abierta
      else{out();return}                           // se cerró todo: hay que iniciar sesión de nuevo
    }
    function beat(){try{localStorage.setItem(HB+id,String(Date.now()))}catch(e){}}
    beat();setInterval(beat,5000);
    window.addEventListener('pagehide',function(){try{localStorage.removeItem(HB+id)}catch(e){}});
  }catch(e){}
})();
