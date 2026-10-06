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
    [['inventario', 'inventario'], ['cartera', 'cartera'], ['agentes', 'agentes']].forEach(([kind, mod]) => {
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
    // Enlace para la administración.
    if (mine.admin && !document.querySelector('[data-permisos-link]')) {
      const nav = document.querySelector('.sidebar nav.tabs');
      if (nav) { const a = document.createElement('a'); a.dataset.permisosLink = '1'; a.href = '/permisos'; a.className = 'tab'; a.style.cssText = 'text-decoration:none;display:flex;align-items:center;gap:10px'; a.innerHTML = '<span class="nav-icon">PM</span><strong>PERMISOS</strong>'; nav.appendChild(a); }
    }
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
