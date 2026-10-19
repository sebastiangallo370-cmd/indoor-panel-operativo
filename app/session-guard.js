// La sesión solo se cierra por INACTIVIDAD: 2 horas sin tocar el panel (mouse, teclado, toque o desplazamiento) y se pide iniciar sesión otra vez.
// Recargar, cerrar y volver a abrir el panel antes de esas 2 horas NO pide iniciar sesión (y recordar-vista.js vuelve a la página en la que estabas).
// La actividad se comparte entre las pestañas del panel (localStorage): si una está en uso, ninguna se cierra.
(function(){
  if(window.__sessionGuard)return;window.__sessionGuard=true;
  var KEY='indoor_last_activity',IDLE=2*60*60*1000;
  function now(){return Date.now()}
  function last(){try{var v=parseInt(localStorage.getItem(KEY),10);return isNaN(v)?0:v}catch(e){return -1}}
  function out(){
    try{document.documentElement.style.visibility='hidden'}catch(e){}
    try{localStorage.removeItem(KEY)}catch(e){}
    location.replace('/logout');
  }
  function mark(){try{localStorage.setItem(KEY,String(now()))}catch(e){}}
  try{
    var fresh=/(?:^|;\s*)indoor_fresh=1/.test(document.cookie);
    if(fresh){
      // acaba de iniciar sesión: la cuenta regresiva de inactividad empieza ahora
      document.cookie='indoor_fresh=; Max-Age=0; path=/';
      mark();
    }else{
      var l=last();
      if(l>0&&now()-l>IDLE){out();return}   // pasaron más de 2 horas sin actividad
      mark();   // (sin registro previo: la cuenta regresiva empieza ahora)
    }
  }catch(e){return}
  var pend=0;
  function activity(){
    var t=now();
    if(t-pend<5000)return;   // basta con anotarlo cada 5 segundos
    pend=t;mark();
  }
  ['mousemove','mousedown','keydown','touchstart','scroll','click','wheel'].forEach(function(ev){window.addEventListener(ev,activity,{passive:true,capture:true})});
  setInterval(function(){
    var l=last();
    if(l>0&&now()-l>IDLE)out();
  },30000);
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    var l=last();
    if(l>0&&now()-l>IDLE)out();else activity();
  });
})();
