/* Panel D. DIAN: lote central por usuario, almacenado en la NAS. */
(function () {
  'use strict';
  const MAX = 1000;
  const CUFE = /\b[a-f0-9]{64,128}\b/gi;
  const state = { token: '', raw: '', dateFrom: '', dateTo: '', folder: 'pendientes', folderSelected: false, format: 'XML', batch: null, entries: [], batchFiles: [], localFolder: null, localFolderName: '', message: '' };
  let panel, timer;

  const esc = (v) => String(v || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const api = async (url, options) => {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'No fue posible completar la operación.');
    return body;
  };
  const cufes = () => [...new Set((state.raw.match(CUFE) || []).map(v => v.toUpperCase()))].slice(0, MAX);
  const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  async function loadFolder() {
    try {
      const data = await api(`/api/dian/carpetas?path=${encodeURIComponent(state.folder)}`);
      state.folder = data.path;
      state.entries = data.entries || [];
    } catch (error) { state.message = error.message; }
  }
  async function pollBatch() {
    if (!state.batch) return;
    try {
      const id = typeof state.batch === 'string' ? state.batch : state.batch.id;
      const [batch, files] = await Promise.all([api(`/api/dian/lotes/${id}`), api(`/api/dian/lotes/${id}/archivos`)]);
      state.batch = batch;
      state.entries = (files.files || []).map(file => Object.assign({ directory: false }, file));
      state.batchFiles = files.batch_files || [];
      state.folder = files.destination;
      await syncLocalFiles(id);
      if (batch.status === 'completed') state.message = `Lote terminado: ${batch.downloaded} descargados, ${batch.failed} con error y ${batch.uncertain} para revisar.`;
      render();
    } catch (error) { state.message = error.message; render(); }
  }
  function files() {
    if (!state.entries.length) return '<p class="dian-folder-empty">Aún no hay archivos en esta carpeta.</p>';
    return state.entries.slice(0, 50).map(item => `<div class="dian-folder-file"><span>${item.directory ? '□' : '▤'}</span><div><b title="${esc(item.name)}">${esc(item.name)}</b><small>${item.directory ? 'Carpeta' : size(item.size || 0)}</small></div></div>`).join('');
  }
  function connection(batch) {
    if (!batch) return { cls: 'offline', title: 'EN ESPERA', note: 'Pega token, CUFEs y crea el lote.' };
    if (batch.status === 'requires_token') return { cls: 'offline', title: 'TOKEN VENCIDO', note: 'Pega un token nuevo para reanudar.' };
    if (batch.status === 'paused') return { cls: 'offline', title: 'PAUSADO', note: 'El lote fue pausado.' };
    if (batch.status === 'completed') return { cls: 'online', title: 'FINALIZADO', note: 'Lote procesado por el servidor.' };
    return { cls: 'online', title: 'EN PROCESO', note: 'Servidor descargando uno por uno.' };
  }
  function render() {
    if (!panel) return;
    const count = cufes().length;
    const batch = state.batch && typeof state.batch === 'object' ? state.batch : null;
    const conn = connection(batch);
    const ready = Boolean(state.token.trim() && count && state.dateFrom && state.dateTo && (state.folderSelected || state.localFolder));
    const done = batch ? batch.downloaded + batch.failed + batch.uncertain : 0;
    const pct = batch ? Math.round((done / Math.max(1, batch.total)) * 100) : (ready ? 75 : 0);
    panel.innerHTML = `<div class="dian-desk dian-central">
      <header class="dian-bar"><div class="dian-brand"><span>TESORERÍA</span><b>D. DIAN · DESCARGAS</b></div><div class="dian-bar-spacer"></div><button class="dian-reset" data-clear title="Limpiar formulario">↺</button></header>
      <div class="dian-board">
        <section class="dian-board-main">
          <div class="dian-token-strip"><label><span>TOKEN DE ACCESO TEMPORAL</span><input id="dian-token" autocomplete="off" spellcheck="false" value="${esc(state.token)}" placeholder="Pega aquí el enlace temporal de DIAN"></label><button class="dian-btn dian-btn-line" data-verify>↗ Verificar token</button></div>
          <div class="dian-cufe-head"><b>CUFEs</b><span>Pega desde Excel: cada identificador queda en su propia fila.</span><strong>${count} / ${MAX}</strong></div>
          <div class="dian-date-range"><label>FECHA DESDE<input id="dian-date-from" type="date" value="${esc(state.dateFrom)}"></label><label>FECHA HASTA<input id="dian-date-to" type="date" value="${esc(state.dateTo)}"></label><small>DIAN consultará exclusivamente este rango para este lote.</small></div>
          <textarea id="dian-cufes" class="dian-board-cufes" spellcheck="false" placeholder="Pega aquí los CUFEs desde Excel&#10;Cada CUFE quedará en una fila">${esc(state.raw)}</textarea>
          <div class="dian-board-actions"><span class="dian-total"><b>${count}</b><small>TOTAL CUFEs</small></span><button class="dian-btn dian-btn-line" data-normalize>↳ Organizar CUFEs</button><button class="dian-btn dian-btn-primary" data-create>Iniciar descarga</button>${batch && ['requires_token','paused'].includes(batch.status) ? '<button class="dian-btn dian-btn-primary" data-resume>Reanudar con este token</button>' : ''}<div class="dian-format"><button data-format="PDF" class="${state.format === 'PDF' ? 'active' : ''}">PDF</button><button data-format="XML" class="${state.format === 'XML' ? 'active' : ''}">XML</button></div></div>
          <div class="dian-board-progress"><div><span>PROGRESO DEL LOTE</span><b>${pct}%</b></div><i><em style="width:${pct}%"></em></i></div>
          <div class="dian-board-summary"><div class="dian-summary-title">RESUMEN DEL LOTE</div><div><span>Token</span><b>${state.token ? 'Temporal cargado' : 'Pendiente'}</b></div><div><span>CUFEs</span><b>${batch ? `${batch.total} en lote` : `${count} listos`}</b></div><div><span>Descargados</span><b>${batch ? `${batch.downloaded} archivos` : '0 archivos'}</b></div>${batch ? `<div><span>Estado</span><b>${esc(batch.status)}</b></div>` : ''}${state.message ? `<p>${esc(state.message)}</p>` : ''}</div>
        </section>
        <aside class="dian-board-side"><div class="dian-session-status ${conn.cls}"><i></i><div><b>${conn.title}</b><small>${conn.note}</small></div></div><div class="dian-side-title">ARCHIVOS EN CARPETA <small>${state.entries.length} archivo${state.entries.length === 1 ? '' : 's'}</small></div><button class="dian-folder-board" data-folder><span>↥</span><b>${esc(state.folder)}</b><small>Carpeta central de la NAS · cambiar</small></button><div class="dian-folder-state"><span>Destino central</span><b>${esc(state.folder)}</b></div><button class="dian-local-folder" data-local-folder><span>▣</span><b>${state.localFolderName ? esc(state.localFolderName) : 'Elegir carpeta de este PC'}</b><small>${state.localFolderName ? 'Los archivos del lote se copiarán aquí' : 'Opcional: Escritorio o cualquier carpeta de Windows'}</small></button><div class="dian-folder-files">${files()}</div>${batch && ['queued','processing'].includes(batch.status) ? '<button class="dian-btn dian-btn-line dian-pause" data-pause>Pausar lote</button>' : ''}</aside>
      </div><footer class="dian-foot">Cada usuario usa su token temporal. Los archivos se descargan desde el servidor en la NAS, uno por uno; el token no se guarda.</footer>
      <dialog class="dian-folder-dialog"><form method="dialog"><b>Carpeta central de la NAS</b><p>Indica una subcarpeta dentro de <strong>DIAN DESCARGAS</strong>.</p><input name="folder" value="${esc(state.folder)}" placeholder="Ej. 2026/noviembre"><menu><button value="cancel">Cancelar</button><button value="ok" class="dian-dialog-ok">Usar carpeta</button></menu></form></dialog>
    </div>`;
    bind();
  }
  function snapshot() { state.token = panel.querySelector('#dian-token')?.value || state.token; state.raw = panel.querySelector('#dian-cufes')?.value || state.raw; state.dateFrom = panel.querySelector('#dian-date-from')?.value || state.dateFrom; state.dateTo = panel.querySelector('#dian-date-to')?.value || state.dateTo; }
  async function verify() {
    snapshot();
    if (!state.token.trim()) { state.message = 'Pega el token temporal antes de verificarlo.'; return render(); }
    try { const url = new URL(state.token.trim()); if (url.protocol !== 'https:' || !/(^|\.)dian\.gov\.co$/i.test(url.hostname)) throw new Error(); window.open(url.toString(), '_blank'); state.message = 'Se abrió DIAN. Si el portal muestra tu sesión, vuelve y crea el lote.'; } catch (_) { state.message = 'Pega un enlace HTTPS temporal entregado por DIAN.'; }
    render();
  }
  async function create() {
    snapshot();
    if (!state.token.trim()) { state.message = 'Falta el token de acceso temporal de DIAN.'; return render(); }
    if (!cufes().length) { state.message = 'Faltan los CUFEs. Pégalos desde Excel, uno por fila.'; return render(); }
    if (!state.dateFrom || !state.dateTo) { state.message = 'Indica fecha desde y fecha hasta para consultar los CUFEs.'; return render(); }
    if (state.dateFrom > state.dateTo) { state.message = 'La fecha desde no puede ser posterior a la fecha hasta.'; return render(); }
    if (!state.folderSelected && !state.localFolder) { state.message = 'Falta elegir la carpeta donde se guardarán las facturas: NAS o este PC.'; return render(); }
    try { const result = await api('/api/dian/lotes', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({token:state.token, cufes:state.raw, carpeta:state.folder, format:state.format, fecha_desde:state.dateFrom, fecha_hasta:state.dateTo}) }); state.batch = result.batch_id; state.message = result.message; await pollBatch(); } catch (error) { state.message = error.message; render(); }
  }
  async function syncLocalFiles(batchId) {
    if (!state.localFolder || !state.batchFiles.length) return;
    try {
      if (await state.localFolder.requestPermission({mode:'readwrite'}) !== 'granted') return;
      for (const item of state.batchFiles) {
        const handle = await localFileHandle(item.name);
        const current = await handle.getFile();
        if (current.size === item.size) continue;
        const response = await fetch(`/api/dian/lotes/${batchId}/archivos/${encodeURIComponent(item.name)}`, {credentials:'same-origin'});
        if (!response.ok) throw new Error('No fue posible copiar un archivo al PC.');
        const writable = await handle.createWritable();
        await writable.write(await response.blob());
        await writable.close();
      }
    } catch (error) { state.message = `La descarga central sigue activa. Copia local pendiente: ${error.message}`; }
  }
  async function localFileHandle(relativeName) {
    const parts = String(relativeName || '').split('/').filter(Boolean);
    const filename = parts.pop();
    if (!filename) throw new Error('Nombre de archivo inválido.');
    let directory = state.localFolder;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, {create:true});
    return directory.getFileHandle(filename, {create:true});
  }
  async function resume() {
    snapshot();
    if (!state.token.trim()) { state.message = 'Pega el token temporal nuevo antes de reanudar.'; return render(); }
    try {
      const id = typeof state.batch === 'string' ? state.batch : state.batch.id;
      const result = await api(`/api/dian/lotes/${id}/reanudar`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({token:state.token}) });
      state.message = result.message; await pollBatch();
    } catch (error) { state.message = error.message; render(); }
  }
  function chooseFolder() { const dialog = panel.querySelector('.dian-folder-dialog'); dialog.showModal(); dialog.addEventListener('close', async () => { if (dialog.returnValue === 'ok') { state.folder = dialog.querySelector('[name="folder"]').value.trim() || 'pendientes'; state.folderSelected = true; await loadFolder(); render(); } }, {once:true}); }
  async function chooseLocalFolder() {
    if (!window.showDirectoryPicker) { state.message = 'Para elegir una carpeta de Windows usa Chrome o Edge actualizado.'; return render(); }
    try {
      state.localFolder = await window.showDirectoryPicker({mode:'readwrite'});
      state.localFolderName = state.localFolder.name;
      state.folderSelected = true;
      state.message = `Carpeta local vinculada: ${state.localFolderName}.`;
      if (state.batch) await pollBatch(); else render();
    } catch (error) { if (error.name !== 'AbortError') { state.message = 'No fue posible vincular la carpeta local.'; render(); } }
  }
  function bind() {
    panel.querySelector('[data-verify]')?.addEventListener('click', verify);
    panel.querySelector('[data-create]')?.addEventListener('click', create);
    panel.querySelector('[data-resume]')?.addEventListener('click', resume);
    panel.querySelector('[data-folder]')?.addEventListener('click', chooseFolder);
    panel.querySelector('[data-local-folder]')?.addEventListener('click', chooseLocalFolder);
    panel.querySelector('[data-normalize]')?.addEventListener('click', () => { snapshot(); state.raw = cufes().join('\n'); state.message = `${cufes().length} CUFEs organizados.`; render(); });
    panel.querySelectorAll('[data-format]').forEach(btn => btn.addEventListener('click', () => { state.format = btn.dataset.format; render(); }));
    panel.querySelector('[data-pause]')?.addEventListener('click', async () => { try { const id = typeof state.batch === 'string' ? state.batch : state.batch.id; await api(`/api/dian/lotes/${id}/pausar`, {method:'POST'}); state.message='Lote pausado. El token temporal fue descartado.'; await pollBatch(); } catch (error) { state.message=error.message; render(); } });
    panel.querySelector('[data-clear]')?.addEventListener('click', () => { state.token=''; state.raw=''; state.dateFrom=''; state.dateTo=''; state.batch=null; state.message='Formulario limpiado.'; render(); });
    panel.querySelector('#dian-cufes')?.addEventListener('input', () => { snapshot(); const head=panel.querySelector('.dian-cufe-head strong'); if(head) head.textContent=`${cufes().length} / ${MAX}`; });
  }
  function addStyle() {
    if (document.getElementById('dian-central-style')) return;
    const style = document.createElement('style'); style.id = 'dian-central-style';
    style.textContent = `body.dian-mode main{width:100%;max-width:none;padding:14px clamp(16px,3vw,40px)!important}.dian-panel{display:none}.dian-panel.active{display:block}.dian-desk{color:#eef7e9}.dian-bar{display:flex;gap:12px;align-items:center;border-bottom:1px solid #315438;padding:0 0 12px}.dian-brand{display:flex;gap:8px;align-items:baseline}.dian-brand span,.dian-side-title,.dian-token-strip label span{font-size:10px;font-weight:900;letter-spacing:.1em;color:#caff3d}.dian-brand b{font-size:14px}.dian-bar-spacer{flex:1}.dian-reset{border:0;background:transparent;color:#caff3d;font-size:20px;cursor:pointer}.dian-board{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:22px;padding-top:18px}.dian-board-main{display:grid;gap:11px;min-width:0}.dian-token-strip{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.dian-token-strip label{display:grid;gap:6px}.dian-token-strip input,.dian-board-cufes,.dian-date-range input{width:100%;box-sizing:border-box;border:1px solid #478052;border-radius:10px;background:linear-gradient(145deg,#25442f,#0d2717);color:#eff8ec;padding:11px;font:12px ui-monospace,Consolas,monospace}.dian-token-strip input{height:42px}.dian-board-cufes{height:190px;resize:vertical;line-height:1.45}.dian-cufe-head{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center}.dian-cufe-head b,.dian-cufe-head strong{color:#caff3d;font-size:11px}.dian-cufe-head span{font-size:11px;color:#a8b9a5}.dian-date-range{display:flex;gap:9px;align-items:end;flex-wrap:wrap}.dian-date-range label{display:grid;gap:5px;color:#caff3d;font-weight:900;font-size:9px;letter-spacing:.08em}.dian-date-range input{height:36px;min-width:156px;padding:7px}.dian-date-range small{color:#a8b9a5;font-size:10px;margin-bottom:10px}.dian-board-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dian-btn,.dian-format{border:1px solid #588464;border-radius:999px;background:linear-gradient(145deg,#31583a,#183921);color:#edf6e8;padding:6px 11px;font:800 10px inherit;cursor:pointer}.dian-btn{display:inline-flex!important;width:auto!important;min-height:31px!important;align-items:center;justify-content:center;flex:0 0 auto!important;line-height:1}.dian-btn-primary,.dian-format .active{background:#caff3d;color:#17200e;border-color:#caff3d}.dian-btn-primary[data-create],.dian-btn-primary[data-resume]{min-width:132px}.dian-btn:disabled{opacity:.4;cursor:not-allowed}.dian-total{display:grid;text-align:center;min-width:58px;padding:3px 7px;border:1px solid #4b8054;border-radius:8px;background:#193c23}.dian-total b{font-size:14px}.dian-total small{font-size:7px;color:#caff3d}.dian-format{display:inline-flex!important;align-items:center;gap:2px;margin-left:auto;padding:2px;flex:0 0 auto!important;width:auto!important}.dian-format button{display:inline-flex!important;width:auto!important;min-height:28px!important;align-items:center;border:0;border-radius:99px;background:transparent;color:#dbe7d7;padding:5px 9px;font-size:10px;font-weight:800;cursor:pointer}.dian-board-progress,.dian-board-summary{border:1px solid #35633f;border-radius:10px;background:rgba(30,67,38,.52)}.dian-board-progress{padding:10px 13px}.dian-board-progress>div{display:flex;justify-content:space-between;font-size:10px;margin-bottom:7px}.dian-board-progress b{color:#caff3d}.dian-board-progress i{display:block;height:5px;background:#17301c;border-radius:6px;overflow:hidden}.dian-board-progress em{display:block;height:100%;background:#baff43}.dian-board-summary{display:grid;grid-template-columns:repeat(3,1fr);overflow:hidden}.dian-summary-title,.dian-board-summary>div{padding:10px 12px}.dian-summary-title,.dian-board-summary p{grid-column:1/-1;background:#254f2d;color:#caff3d;font-size:10px;font-weight:900;letter-spacing:.1em}.dian-board-summary span{display:block;color:#9eb39b;font-size:10px}.dian-board-summary b{font-size:12px}.dian-board-summary p{margin:0;letter-spacing:0;font-weight:500}.dian-board-side{min-height:450px;border:1px solid #46764f;border-radius:14px;padding:16px;display:flex;flex-direction:column;background:linear-gradient(145deg,#244d2d,#0a2514)}.dian-session-status{display:flex;gap:8px;align-items:center;padding:9px;border:1px solid #864c43;border-radius:10px;color:#ffc6bd}.dian-session-status i{width:9px;height:9px;border-radius:50%;background:#f06b5e}.dian-session-status div{display:grid;gap:2px}.dian-session-status b{font-size:10px;letter-spacing:.1em}.dian-session-status small{font-size:9px}.dian-session-status.online{border-color:#58a462;color:#dff9dc}.dian-session-status.online i{background:#8cf07e;box-shadow:0 0 10px #8cf07e}.dian-side-title{display:flex;justify-content:space-between;margin:17px 0 9px}.dian-side-title small{font-size:9px;color:#a9bca5}.dian-folder-board{min-height:100px;border:1px dashed #7fb56a;border-radius:10px;background:#16391e;color:#eef7e8;display:grid;place-content:center;text-align:center;gap:6px;cursor:pointer}.dian-folder-board span{font-size:28px;color:#caff3d}.dian-folder-board b{font-size:12px}.dian-folder-board small,.dian-folder-state span,.dian-folder-file small,.dian-folder-empty{font-size:9px;color:#a8b9a4}.dian-folder-state{display:grid;gap:4px;padding:12px 0;border-bottom:1px solid #385c3c}.dian-folder-state b{font-size:11px}.dian-folder-files{flex:1;max-height:250px;overflow:auto;padding:6px 0}.dian-folder-file{display:flex;gap:7px;padding:7px 1px;border-bottom:1px solid #29472e}.dian-folder-file>span{color:#caff3d}.dian-folder-file div{display:grid;min-width:0}.dian-folder-file b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dian-pause{margin-top:9px}.dian-foot{margin:14px 0 0;padding-top:10px;border-top:1px solid #315438;color:#91a78e;font-size:10px}.dian-folder-dialog{border:1px solid #56835a;border-radius:12px;background:#112b18;color:#eef7e8}.dian-folder-dialog form{padding:20px}.dian-folder-dialog input{width:100%;box-sizing:border-box;margin:12px 0;padding:10px;background:#203e27;border:1px solid #5c8660;border-radius:7px;color:white}.dian-folder-dialog menu{display:flex;justify-content:flex-end;gap:8px;padding:0}.dian-folder-dialog button{padding:8px 10px;border:1px solid #6b946d;border-radius:7px;background:transparent;color:white}@media(max-width:850px){body.dian-mode main{padding:14px!important}.dian-board{grid-template-columns:1fr}.dian-board-side{min-height:290px}.dian-token-strip{grid-template-columns:1fr}.dian-cufe-head{grid-template-columns:1fr auto}.dian-cufe-head span{grid-column:1/-1}.dian-date-range{align-items:stretch}.dian-date-range label{flex:1}.dian-date-range input{min-width:0}.dian-date-range small{width:100%;margin:0}.dian-format{margin-left:0}.dian-board-summary{grid-template-columns:1fr 1fr}}`;
    style.textContent += '.dian-local-folder{display:grid;grid-template-columns:20px 1fr;gap:1px 7px;align-items:center;margin:10px 0 3px;padding:9px 2px;border:0;border-bottom:1px solid #385c3c;background:transparent;color:#edf8e9;text-align:left;cursor:pointer}.dian-local-folder:hover b{color:#caff3d}.dian-local-folder span{grid-row:1/3;color:#caff3d;font-size:16px}.dian-local-folder b{font-size:10px}.dian-local-folder small{font-size:9px;color:#a8b9a4}';
    document.head.appendChild(style);
  }
  async function activate() { document.querySelectorAll('.tab,.panel').forEach(el => el.classList.remove('active')); document.querySelector('#dian-tab')?.classList.add('active'); panel?.classList.add('active'); document.body.classList.add('dian-mode'); await loadFolder(); render(); }
  function build() {
    const main = document.querySelector('main');
    const treasury = [...document.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-parent span:last-child')?.textContent.trim() === 'TESORERÍA');
    if (!main || document.querySelector('#dian-panel')) return;
    addStyle(); panel = document.createElement('section'); panel.id = 'dian-panel'; panel.className = 'panel dian-panel'; main.prepend(panel);
    const tab = document.createElement('button'); tab.id = 'dian-tab'; tab.type = 'button'; tab.className = 'tab'; tab.innerHTML = '<span class="nav-icon">DN</span><strong>D. DIAN</strong>'; tab.addEventListener('click', activate);
    (treasury?.querySelector('.nav-children') || document.querySelector('.tabs'))?.appendChild(tab);
    if (location.hash === '#dian') activate();
    if (timer) clearInterval(timer); timer = setInterval(() => { if (!document.hidden && panel?.classList.contains('active')) { if (state.batch) pollBatch(); else loadFolder().then(render); } }, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
}());
