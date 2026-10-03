// Modo claro / oscuro de todo el panel. El oscuro es el de siempre; el claro invierte los colores de la página
// y deja intactas las fotos, los videos y el logo. La preferencia se guarda en este navegador.
(function(){
  if(window.__temaIndoor)return;window.__temaIndoor=true;
  var KEY='indoor-theme',root=document.documentElement;
  function saved(){try{return localStorage.getItem(KEY)==='light'?'light':'dark'}catch(e){return 'dark'}}
  function save(value){try{localStorage.setItem(KEY,value)}catch(e){}}
  var INV='invert(1) hue-rotate(180deg)';
  var style=document.createElement('style');
  style.textContent=
    'html.theme-light{filter:'+INV+'}'+
    'html.theme-light img,html.theme-light video,html.theme-light canvas,html.theme-light .theme-reinvert{filter:'+INV+'}'+
    'html.theme-light .theme-reinvert img,html.theme-light .theme-reinvert video,html.theme-light .theme-reinvert canvas,html.theme-light img[src*="marca-indoor"],html.theme-light .sidebar-brand img{filter:none}'+
    '.theme-toggle{display:flex!important;align-items:center;gap:8px}';
  document.head.appendChild(style);

  var queued=false;
  function scan(){
    queued=false;
    if(!root.classList.contains('theme-light')||!document.body)return;
    var all=document.body.getElementsByTagName('*');
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(el.classList.contains('theme-reinvert')||el.tagName==='IMG'||el.tagName==='SCRIPT'||el.tagName==='STYLE')continue;
      var bg=getComputedStyle(el).backgroundImage;
      if(bg&&bg.indexOf('url(')>=0&&!el.parentElement.closest('.theme-reinvert'))el.classList.add('theme-reinvert');
    }
  }
  function schedule(){if(!queued&&root.classList.contains('theme-light')){queued=true;setTimeout(scan,700)}}

  function label(){
    var light=root.classList.contains('theme-light');
    document.querySelectorAll('.theme-toggle').forEach(function(button){button.textContent=light?'Modo oscuro':'Modo claro'});
  }
  function apply(value,persist){
    root.classList.toggle('theme-light',value==='light');
    if(persist)save(value);
    if(value==='light')scan();
    label();
  }
  function addButton(){
    var menu=document.querySelector('.user-dropdown');
    if(!menu||menu.querySelector('.theme-toggle'))return;
    var button=document.createElement('button');
    button.type='button';button.className='theme-toggle';
    button.onclick=function(){apply(root.classList.contains('theme-light')?'dark':'light',true)};
    menu.insertBefore(button,menu.querySelector('a[href="/logout"]'));
    label();
  }
  apply(saved(),false);
  addButton();
  new MutationObserver(function(){addButton();schedule()}).observe(document.body,{childList:true,subtree:true});
  setTimeout(scan,1200);
})();
