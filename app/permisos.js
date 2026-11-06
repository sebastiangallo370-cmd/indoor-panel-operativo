/* Permisos por rol + botones de descarga en Excel. Se carga en el panel principal. */
(() => {
  let mine = null;
  const tryFetch = async (url) => { try { const r = await fetch(url, {cache: 'no-store', credentials: 'same-origin'}); return r.ok ? r.json() : null; } catch (e) { return null; } };
  const can = (mod, act) => !mine || !!(((mine.permisos || {})[mod] || {})[act]);

  const style = document.createElement('style');
  style.textContent = '.xl-btn{width:auto!important;padding:9px 13px!important;border:1px solid #60754d!important;border-radius:9px!important;background:#233020!important;color:#eff9df!important;font:800 12px Arial!important;cursor:pointer;white-space:nowrap}.xl-btn:hover{background:#2f4029!important}.xl-btn:disabled{opacity:.6;cursor:progress}.xl-wrap{display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center}@media(max-width:620px){.xl-btn{min-height:42px}}';
  document.head.appendChild(style);

  function download(kind, btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparando…';
    fetch('/api/exportar/' + kind + '?formato=xlsx', {credentials: 'same-origin'})
      .then(async r => {
        if (!r.ok) { let m = 'No se pudo descargar'; try { m = (await r.json()).detail || m; } catch (e) {} throw new Error(m); }
        const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || (kind + '.xlsx');
        return r.blob().then(blob => ({blob, name}));
      })
      .then(({blob, name}) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); })
      .catch(e => alert(e.message))
      .finally(() => { btn.disabled = false; btn.textContent = label; });
  }

  function addButton(host, id, kind, text, title) {
    if (!host || host.querySelector('[data-xl="' + id + '"]')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'xl-btn production-refresh'; b.dataset.xl = id; b.textContent = text; b.title = title || '';
    b.onclick = () => download(kind, b);
    host.appendChild(b);
  }

  function apply() {
    if (!mine) return;
    // Menú: oculta lo que el perfil no puede ver.
    [['inventario', 'inventario'], ['cartera', 'cartera'], ['agentes', 'agentes'], ['promedios', 'promedios']].forEach(([kind, mod]) => {
      document.querySelectorAll('.tab[data-kind="' + kind + '"]').forEach(tab => { tab.style.display = can(mod, 'ver') ? '' : 'none'; });
    });
    // Botones de Excel.
    if (can('inventario', 'exportar') && can('inventario', 'ver')) {
      const hero = document.querySelector('.inventory-hero');
      if (hero) {
        let wrap = hero.querySelector('.xl-wrap');
        if (!wrap) { wrap = document.createElement('div'); wrap.className = 'xl-wrap'; const refresh = hero.querySelector('#inventory-refresh'); refresh ? refresh.insertAdjacentElement('beforebegin', wrap) : hero.appendChild(wrap); }
        addButton(wrap, 'inv', 'inventario', '⬇ Excel inventario', 'Descarga el inventario completo, una hoja por categoría');
        addButton(wrap, 'mov', 'movimientos', '⬇ Excel movimientos', 'Descarga los ingresos y salidas registrados en la página');
      }
    }
    if (can('produccion', 'exportar')) addButton(document.querySelector('.production-controls'), 'prod', 'produccion', '⬇ Excel', 'Descarga la tabla de producción');
    const head = document.querySelector('.ct-head-actions');
    if (head && can('cartera', 'exportar')) addButton(head, 'cart', 'cartera', '⬇ Excel', 'Descarga cartera y pagos');
    // Quien edita solo lo suyo no ve botones de escritura.
    document.body.classList.toggle('sin-editar-inventario', !can('inventario', 'editar'));
    document.body.classList.toggle('sin-editar-cartera', !can('cartera', 'editar'));
    // (El módulo PERMISOS se eliminó: ya no hay enlace ni pantalla para cambiar permisos; rigen los valores por defecto.)
    document.querySelectorAll('[data-permisos-link]').forEach(a => a.remove());
  }

  const eds = document.createElement('style');
  eds.textContent = 'body.sin-editar-inventario .inventory-movement-actions,body.sin-editar-cartera .ct-head-actions [data-a="newdoc"],body.sin-editar-cartera .ct-head-actions [data-a="sync"]{display:none!important}';
  document.head.appendChild(eds);

  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 250); };
  tryFetch('/api/permisos/mi').then(data => {
    mine = data; apply();
    new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
  });
})();

/* Mejoras de uso para la matriz individual: búsqueda y selección rápida por módulo. */
(() => {
  const add = () => {
    const dialog = document.querySelector('.perm-dialog');
    if (!dialog || dialog.dataset.betterPermissions) return;
    dialog.dataset.betterPermissions = '1';
    const style = document.createElement('style');
    style.textContent = `.perm-dialog{background:radial-gradient(45rem 28rem at 0 0,rgba(201,255,100,.12),transparent 65%),linear-gradient(145deg,rgba(19,45,30,.98),rgba(4,15,9,.99))!important}.perm-search{width:100%;min-height:43px;margin-top:15px;padding:0 14px;border:1px solid rgba(220,255,182,.25);border-radius:12px;background:rgba(0,0,0,.22);color:#fff;font:700 .78rem Arial}.perm-search:focus{outline:0;border-color:#d8ff70;box-shadow:0 0 0 3px rgba(216,255,112,.12)}.perm-users{padding-top:46px!important;position:relative}.perm-users::before{content:'USUARIOS · '+attr(data-count);position:absolute;top:14px;left:12px;color:#a9bc9e;font:900 9px Arial;letter-spacing:.14em}.perm-module{position:relative;padding-top:38px!important}.perm-module>b{position:absolute;top:12px;left:12px;right:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.09)}.perm-quick{position:absolute;top:8px;right:9px;display:flex;gap:4px}.perm-quick button{width:auto!important;min-height:25px!important;padding:0 7px!important;border:1px solid rgba(216,255,112,.28)!important;border-radius:999px!important;background:rgba(216,255,112,.08)!important;color:#dcff88!important;font:800 9px Arial!important;cursor:pointer}.perm-quick button:hover{background:#d8ff70!important;color:#15200d!important}.perm-top::after{content:'Los cambios se aplican solo al usuario seleccionado';flex-basis:100%;color:#8fa58a;font-size:.7rem}.perm-user.on{box-shadow:inset 3px 0 0 #d8ff70}.perm-actions button[data-save]{background:linear-gradient(135deg,#e1ff75,#bcf43f)!important;color:#13200c!important;box-shadow:0 10px 24px rgba(201,255,70,.18)}@media(max-width:700px){.perm-users{padding-top:43px!important}.perm-grid{gap:7px}.perm-module{padding:36px 9px 9px!important}.perm-check{font-size:.68rem}}`;
    document.head.appendChild(style);
    const cards = document.createElement('style');
    cards.textContent = `.perm-user{position:relative;display:grid!important;grid-template-columns:34px minmax(0,1fr);column-gap:9px;align-items:center;min-height:68px!important;margin:3px 0;border:1px solid transparent!important;overflow:hidden;transition:transform .18s ease,border-color .18s ease,background .18s ease}.perm-user:hover{transform:translateX(3px);border-color:rgba(218,255,112,.34)!important}.perm-user.on{border-color:rgba(218,255,112,.55)!important;background:linear-gradient(120deg,rgba(218,255,112,.20),rgba(104,205,158,.07))!important}.perm-avatar{display:grid;place-items:center;width:34px;height:34px;border:1px solid rgba(230,255,206,.28);border-radius:11px;background:linear-gradient(145deg,rgba(218,255,112,.26),rgba(77,162,125,.18));color:#edffb6;font:900 11px Arial;letter-spacing:.04em}.perm-user-copy{display:grid;gap:3px;min-width:0}.perm-user-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.perm-user-copy small{margin:0!important}.perm-user-copy i{display:block;height:3px;border-radius:9px;background:linear-gradient(90deg,#d8ff70 var(--perm-level),rgba(255,255,255,.12) var(--perm-level));box-shadow:0 0 8px rgba(216,255,112,.20);font-size:0}.perm-module{overflow:hidden;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.perm-module:hover{transform:translateY(-3px);border-color:rgba(218,255,112,.4)!important;box-shadow:0 12px 22px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.09)}.perm-module:has(input:checked){background:linear-gradient(145deg,rgba(218,255,112,.09),rgba(5,23,13,.24))!important}.perm-check{padding:5px 6px;border-radius:7px;transition:background .16s}.perm-check:hover{background:rgba(255,255,255,.07)}.perm-check:has(input:checked){color:#efffc0!important;background:rgba(218,255,112,.08)}.perm-top{padding:14px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.035)}`;
    document.head.appendChild(cards);
    const layout = dialog.querySelector('.perm-layout');
    const search = document.createElement('input');
    search.className = 'perm-search'; search.type = 'search'; search.placeholder = 'Buscar usuario o área…'; search.setAttribute('aria-label', 'Buscar usuario o área');
    layout.before(search);
    const filter = () => { const q = search.value.trim().toLowerCase(); const users = [...dialog.querySelectorAll('.perm-user')]; users.forEach(user => { user.hidden = !!q && !user.textContent.toLowerCase().includes(q); }); dialog.querySelector('.perm-users').dataset.count = String(users.filter(user => !user.hidden).length); };
    search.addEventListener('input', filter);
    const decorate = () => {
      const users = dialog.querySelector('.perm-users'); if (users) { if (!users.dataset.count) users.dataset.count = String(users.querySelectorAll('.perm-user').length); filter(); }
      dialog.querySelectorAll('.perm-module').forEach(module => {
        if (module.querySelector('.perm-quick')) return;
        const actions = [...module.querySelectorAll('input[type="checkbox"]')]; if (!actions.length) return;
        const quick = document.createElement('div'); quick.className = 'perm-quick';
        quick.innerHTML = '<button type="button" data-all>Todo</button><button type="button" data-none>Nada</button>';
        quick.addEventListener('click', event => { const value = !!event.target.closest('[data-all]'); if (!event.target.closest('button')) return; actions.forEach(input => { if (!input.disabled) input.checked = value; }); });
        module.appendChild(quick);
      });
    };
    new MutationObserver(decorate).observe(dialog, {childList:true, subtree:true});
    decorate();
  };
  const timer = setInterval(() => { if (document.querySelector('.perm-dialog')) { clearInterval(timer); add(); } }, 250);
})();

/* Gestión individual de permisos, disponible dentro de Configuración de cuenta. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let catalog = null, selected = null;
  const style = document.createElement('style');
  style.textContent = `.perm-dialog{width:min(980px,calc(100vw - 24px));max-height:min(88dvh,820px);padding:0;border:1px solid rgba(226,255,192,.36);border-radius:24px;background:linear-gradient(145deg,rgba(24,48,33,.96),rgba(5,16,10,.98));color:#f4f8ef;box-shadow:0 30px 80px #000b}.perm-dialog::backdrop{background:#020805aa;backdrop-filter:blur(5px)}.perm-inner{padding:24px}.perm-head{display:flex;justify-content:space-between;gap:16px;align-items:start}.perm-kicker{margin:0;color:#d8ff6f;font:900 10px Arial;letter-spacing:.16em}.perm-head h2{margin:4px 0;font-size:1.55rem}.perm-head p{margin:0;color:#aebba8;font-size:.82rem}.perm-close{width:38px!important;min-height:38px!important;padding:0!important;border-radius:50%!important}.perm-layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;margin-top:20px}.perm-users{max-height:52dvh;overflow:auto;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:15px;background:#07120b}.perm-user{display:block;width:100%;min-height:55px;padding:10px;border:0;border-radius:10px;background:transparent;color:#dce7d8;text-align:left;cursor:pointer}.perm-user:hover,.perm-user.on{background:rgba(207,255,107,.13)}.perm-user b,.perm-user small{display:block}.perm-user b{font-size:.78rem}.perm-user small{margin-top:3px;color:#91a08d;font-size:.66rem}.perm-editor{min-width:0;padding:17px;border:1px solid rgba(255,255,255,.13);border-radius:16px;background:rgba(255,255,255,.035)}.perm-editor[hidden]{display:none}.perm-top{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.perm-top label{display:grid;gap:5px;color:#aebba8;font:800 10px Arial;letter-spacing:.1em}.perm-top input{min-height:40px;padding:0 11px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:#0b1710;color:#fff}.perm-lock{margin-left:auto;color:#dfff8d;font:800 11px Arial}.perm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:17px}.perm-module{padding:12px;border:1px solid rgba(255,255,255,.13);border-radius:13px;background:rgba(2,13,7,.36)}.perm-module>b{display:block;margin-bottom:8px;font-size:.78rem}.perm-check{display:flex;align-items:center;gap:7px;margin:7px 0;color:#c7d4c1;font-size:.75rem}.perm-check input{accent-color:#d0f44c}.perm-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}.perm-actions button{width:auto!important;min-height:42px!important}.perm-msg{min-height:18px;margin:12px 0 0;color:#dfff8d;font-size:.78rem}@media(max-width:700px){.perm-inner{padding:17px}.perm-layout{grid-template-columns:1fr}.perm-users{max-height:190px}.perm-grid{grid-template-columns:1fr 1fr}.perm-actions button{flex:1}.perm-dialog{max-height:calc(100dvh - 12px)}}`;
  document.head.appendChild(style);
  const dialog = document.createElement('dialog'); dialog.className = 'perm-dialog';
  dialog.innerHTML = '<div class="perm-inner"><header class="perm-head"><div><p class="perm-kicker">ADMINISTRACIÓN</p><h2>Permisos de usuarios</h2><p>Define acceso por persona. Las reglas fijas de seguridad siguen vigentes.</p></div><button class="perm-close" type="button" aria-label="Cerrar">×</button></header><div class="perm-layout"><aside class="perm-users"></aside><section class="perm-editor" hidden></section></div><p class="perm-msg" role="status"></p></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('.perm-close').onclick = () => dialog.close();

  function editor() {
    const host = dialog.querySelector('.perm-editor');
    if (!selected || !catalog) { host.hidden = true; return; }
    host.hidden = false;
    const locked = selected.admin;
    host.innerHTML = '<div class="perm-top"><label>Proceso<input data-process maxlength="80" value="' + esc(selected.process) + '" ' + (locked ? 'disabled' : '') + '></label>' + (locked ? '<span class="perm-lock">ADMINISTRACIÓN · acceso total</span>' : '') + '</div><div class="perm-grid">' + Object.entries(catalog.modules).map(([key, row]) => '<article class="perm-module"><b>' + esc(row[0]) + '</b>' + row[1].map(action => '<label class="perm-check"><input type="checkbox" data-module="' + key + '" data-action="' + action + '" ' + (selected.permisos[key]?.[action] ? 'checked' : '') + (locked ? ' disabled' : '') + '> ' + esc(catalog.actions[action]) + '</label>').join('') + '</article>').join('') + '</div>' + (locked ? '' : '<div class="perm-actions"><button type="button" data-save>Guardar permisos</button></div>');
    host.querySelector('[data-save]')?.addEventListener('click', save);
  }
  function users() { const host = dialog.querySelector('.perm-users'); host.innerHTML = catalog.users.map((user, index) => { const actions = Object.values(user.permisos || {}).flatMap(module => Object.values(module)); const level = actions.length ? Math.round(actions.filter(Boolean).length / actions.length * 100) : 0; const initials = String(user.display_name || user.name).split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join('').toUpperCase(); return '<button class="perm-user' + (selected?.name === user.name ? ' on' : '') + '" type="button" data-user="' + index + '"><span class="perm-avatar">' + esc(initials) + '</span><span class="perm-user-copy"><b>' + esc(user.display_name) + '</b><small>' + esc(user.process || 'Sin proceso') + ' · ' + level + '%</small><i style="--perm-level:' + level + '%"></i></span></button>'; }).join(''); host.querySelectorAll('[data-user]').forEach(button => button.onclick = () => { selected = catalog.users[Number(button.dataset.user)]; users(); editor(); }); }
  async function save() {
    const host = dialog.querySelector('.perm-editor'), permissions = {};
    Object.entries(catalog.modules).forEach(([module, row]) => { permissions[module] = {}; row[1].forEach(action => { permissions[module][action] = !!host.querySelector('[data-module="' + module + '"][data-action="' + action + '"]')?.checked; }); });
    const result = await fetch('/api/permisos/usuarios/' + encodeURIComponent(selected.name), {method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({process:host.querySelector('[data-process]').value, permisos:permissions})});
    const message = dialog.querySelector('.perm-msg'); if (!result.ok) { message.textContent = (await result.json().catch(() => ({}))).detail || 'No se pudo guardar'; return; }
    const updated = await result.json(); selected.process = updated.process; selected.permisos = updated.permisos; message.textContent = 'Permisos guardados para ' + selected.display_name + '.'; users(); editor();
  }
  async function open() { const result = await fetch('/api/permisos/usuarios', {credentials:'same-origin', cache:'no-store'}); if (!result.ok) return alert('No tienes permiso para gestionar usuarios.'); catalog = await result.json(); selected = catalog.users[0] || null; users(); editor(); dialog.showModal(); }
  function add() { if (document.getElementById('open-manage-permissions')) return true; const menu = document.querySelector('.user-dropdown'); if (!menu) return false; const button = document.createElement('button'); button.type = 'button'; button.id = 'open-manage-permissions'; button.textContent = 'Gestionar permisos'; button.onclick = open; menu.appendChild(button); return true; }
  fetch('/api/permisos/mi', {credentials:'same-origin', cache:'no-store'}).then(r => r.ok ? r.json() : null).then(me => { if (!me?.admin) return; const timer = setInterval(() => { if (add()) clearInterval(timer); }, 250); });
})();
