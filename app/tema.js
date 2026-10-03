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
    '.theme-toggle{display:flex!important;align-items:center;gap:8px}'+
    '.theme-icon{flex:0 0 42px;width:42px;height:42px;padding:0;display:grid;place-items:center;border:1px solid rgba(208,244,76,.3);border-radius:50%;background:#10150e;color:#d0f44c;cursor:pointer;transition:transform .15s,box-shadow .15s}'+
    '.theme-icon:hover{box-shadow:0 0 0 3px rgba(208,244,76,.15)}.theme-icon:active{transform:scale(.92)}.theme-icon svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}';
  document.head.appendChild(style);

  var SUN='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>';
  var MOON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>';
  function toggle(){apply(root.classList.contains('theme-light')?'dark':'light',true)}
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
    document.querySelectorAll('.theme-icon').forEach(function(button){
      button.innerHTML=light?MOON:SUN;
      button.title=button.ariaLabel=light?'Cambiar a modo oscuro':'Cambiar a modo claro';
    });
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
    button.onclick=toggle;
    menu.insertBefore(button,menu.querySelector('a[href="/logout"]'));
    label();
  }
  function addIcon(){
    var area=document.querySelector('.systems');
    if(!area||area.querySelector('.theme-icon'))return;
    var button=document.createElement('button');
    button.type='button';button.className='theme-icon';
    button.onclick=toggle;
    area.insertBefore(button,area.firstChild);
    label();
  }
  apply(saved(),false);
  addButton();addIcon();
  new MutationObserver(function(){addButton();addIcon();schedule()}).observe(document.body,{childList:true,subtree:true});
  setTimeout(scan,1200);
})();
