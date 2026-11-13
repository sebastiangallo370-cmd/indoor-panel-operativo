/* Panel D. DIAN: lote central por usuario, almacenado en la NAS. */
(function () {
  'use strict';
  const MAX = 1000;
  const DRAFT_KEY = 'indoor-dian-draft-v1';
  const QUEUE_KEY = 'indoor-dian-cufe-queue-v1';
  const LOCAL_AGENT = 'http://127.0.0.1:17877';
  const CUFE = /\b[a-f0-9]{64,128}\b/gi;
  const state = { token: '', raw: '', dateFrom: '', dateTo: '', folder: 'pendientes', folderSelected: false, format: 'XML', batch: null, entries: [], batchFiles: [], localFolder: null, localFolderName: '', portalOpen: false, message: '', localAgent: null, queue: [] };
  let panel, timer;

  const esc = (v) => String(v || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  const api = async (url, options) => {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'No fue posible completar la operación.');
    return body;
  };
  const localApi = async (path, options) => {
    const response = await fetch(`${LOCAL_AGENT}${path}`, Object.assign({ mode: 'cors' }, options || {}));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'El agente local no pudo completar la acción.');
    return body;
  };
  const cufes = () => [...new Set((state.raw.match(CUFE) || []).map(v => v.toUpperCase()))].slice(0, MAX);
  const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ token: state.token, raw: state.raw, dateFrom: state.dateFrom, dateTo: state.dateTo, folder: state.folder, folderSelected: state.folderSelected, format: state.format, portalOpen: state.portalOpen })); } catch (_) { /* navegador sin sessionStorage */ }
  }
  function restoreDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      ['token', 'raw', 'dateFrom', 'dateTo', 'folder', 'format'].forEach(key => { if (typeof saved[key] === 'string') state[key] = saved[key]; });
      state.folderSelected = Boolean(saved.folderSelected); state.portalOpen = Boolean(saved.portalOpen);
    } catch (_) { /* borrador corrupto: se ignora */ }
    try {
      const queue = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]');
      if (Array.isArray(queue)) state.queue = queue.filter(item => item && typeof item.value === 'string');
    } catch (_) { state.queue = []; }
  }
  const saveQueue = () => { try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue)); } catch (_) { /* sin storage */ } };
  const pendingQueue = () => state.queue.find(item => !item.done);
  const completedQueue = () => state.queue.filter(item => item.done).length;
  async function refreshLocalAgent() {
    try {
      const result = await localApi('/health');
      state.localAgent = result;
      if (result.folder) state.localFolderName = result.folder;
      return result;
    } catch (_) { state.localAgent = null; return null; }
  }

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
    if (!batch && state.portalOpen && state.token.trim()) return { cls: 'online', title: 'CONEXIÓN LISTA', note: 'Portal DIAN abierto; el lote validará el token antes de descargar.' };
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
    const ready = Boolean(state.token.trim() && count && state.localAgent && state.localAgent.folder);
    const done = batch ? batch.downloaded + batch.failed + batch.uncertain : 0;
    const pct = batch ? Math.round((done / Math.max(1, batch.total)) * 100) : (ready ? 75 : 0);
    const agent = state.localAgent;
    const queueCurrent = pendingQueue();
    const queueDone = completedQueue();
    panel.innerHTML = `<div class="dian-desk dian-central">
      <header class="dian-bar"><div class="dian-brand"><span>AGENTES</span><b>DIAN · DESCARGAS</b></div><div class="dian-bar-spacer"></div><span class="dian-agent-pill ${agent ? 'online' : ''}">${agent ? '● Agente de este PC conectado' : '● Agente de este PC sin conectar'}</span><button class="dian-btn dian-btn-line" data-local-agent>${agent ? 'Actualizar agente' : 'Conectar agente'}</button><button class="dian-btn dian-btn-line" data-restart-agent ${agent ? '' : 'disabled'}>Reiniciar agente</button><button class="dian-reset" data-clear title="Limpiar formulario">↺</button></header>
      <div class="dian-board">
        <section class="dian-board-main">
          <div class="dian-token-strip"><label><span>TOKEN DE ACCESO TEMPORAL</span><input id="dian-token" autocomplete="off" spellcheck="false" value="${esc(state.token)}" placeholder="Pega aquí el enlace temporal de DIAN"></label><button class="dian-btn dian-btn-line" data-verify ${agent ? '' : 'disabled'}>↗ Abrir sesión DIAN</button></div>
          <div class="dian-cufe-head"><b>CUFEs</b><span>Pega desde Excel: cada identificador queda en su propia fila.</span><strong>${count} / ${MAX}</strong></div>
          <div class="dian-date-range"><small>La sesión se abre en Chrome visible de este PC. Tú confirmas manualmente la búsqueda y descarga oficial de cada CUFE.</small></div>
          <textarea id="dian-cufes" class="dian-board-cufes" spellcheck="false" placeholder="Pega aquí los CUFEs desde Excel&#10;Cada CUFE quedará en una fila">${esc(state.raw)}</textarea>
          <div class="dian-board-actions"><span class="dian-total"><b>${count}</b><small>TOTAL CUFEs</small></span><button class="dian-btn dian-btn-line" data-normalize>↳ Organizar CUFEs</button><button class="dian-btn dian-btn-primary" data-create>Preparar cola</button><div class="dian-format"><button data-format="PDF" class="${state.format === 'PDF' ? 'active' : ''}">PDF</button><button data-format="XML" class="${state.format === 'XML' ? 'active' : ''}">XML</button></div></div>
          <section class="dian-queue"><b>CUFE ACTUAL</b><code>${queueCurrent ? esc(queueCurrent.value) : (state.queue.length ? 'Cola terminada.' : 'Prepara la cola para comenzar.')}</code><div><button class="dian-btn dian-btn-primary" data-copy-cufe ${queueCurrent ? '' : 'disabled'}>Copiar siguiente CUFE</button><button class="dian-btn dian-btn-line" data-mark-downloaded ${queueCurrent ? '' : 'disabled'}>Marcar descargado</button><small>${state.queue.length ? `${queueDone} de ${state.queue.length} confirmados · ${state.queue.length - queueDone} pendientes` : 'Los CUFEs se guardan solo en esta pestaña.'}</small></div></section>
          <div class="dian-board-progress"><div><span>AVANCE MANUAL</span><b>${state.queue.length ? Math.round((queueDone / state.queue.length) * 100) : pct}%</b></div><i><em style="width:${state.queue.length ? Math.round((queueDone / state.queue.length) * 100) : pct}%"></em></i></div>
          <div class="dian-board-summary"><div class="dian-summary-title">RESUMEN DE LA SESIÓN</div><div><span>Agente local</span><b>${agent ? 'Conectado' : 'Pendiente'}</b></div><div><span>CUFEs</span><b>${state.queue.length ? `${state.queue.length} en cola` : `${count} listos`}</b></div><div><span>Confirmados</span><b>${queueDone} archivos</b></div>${state.message ? `<p>${esc(state.message)}</p>` : ''}</div>
        </section>
        <aside class="dian-board-side"><div class="dian-session-status ${agent && agent.browser ? 'online' : 'offline'}"><i></i><div><b>${agent && agent.browser ? 'SESIÓN DIAN ABIERTA' : 'AGENTE LOCAL'}</b><small>${agent ? esc(agent.message || 'Listo para abrir DIAN.') : 'Conecta el agente que está instalado en este PC.'}</small></div></div><div class="dian-side-title">CARPETA DE DESCARGA</div><button class="dian-folder-board" data-local-folder ${agent && !agent.browser ? '' : 'disabled'}><span>↥</span><b>${agent && agent.folder ? esc(agent.folder) : 'Elegir carpeta de este PC'}</b><small>${agent && agent.browser ? 'La carpeta no cambia durante una sesión activa' : 'Se abrirá el selector de carpetas de Windows'}</small></button><div class="dian-folder-state"><span>Destino local</span><b>${agent && agent.folder ? esc(agent.folder) : 'Pendiente'}</b></div><div class="dian-folder-files">${agent && agent.browser ? '<p class="dian-folder-empty">Cada descarga que confirmes en DIAN se guardará aquí.</p>' : '<p class="dian-folder-empty">1. Conecta el agente<br>2. Elige carpeta<br>3. Abre la sesión DIAN</p>'}</div></aside>
      </div><footer class="dian-foot">Todo se controla desde este panel. El agente local solo abre el navegador visible y guarda las descargas; no consulta ni descarga automáticamente en DIAN.</footer>
      <dialog class="dian-folder-dialog"><form method="dialog"><b>Carpeta central de la NAS</b><p>Indica una subcarpeta dentro de <strong>DIAN DESCARGAS</strong>.</p><input name="folder" value="${esc(state.folder)}" placeholder="Ej. 2026/noviembre"><menu><button value="cancel">Cancelar</button><button value="ok" class="dian-dialog-ok">Usar carpeta</button></menu></form></dialog>
    </div>`;
    bind();
  }
  function snapshot() {
    const token = panel.querySelector('#dian-token'); const raw = panel.querySelector('#dian-cufes');
    const dateFrom = panel.querySelector('#dian-date-from'); const dateTo = panel.querySelector('#dian-date-to');
    if (token) state.token = token.value; if (raw) state.raw = raw.value;
    if (dateFrom) state.dateFrom = dateFrom.value; if (dateTo) state.dateTo = dateTo.value;
    saveDraft();
  }
  async function verify() {
    snapshot();
    if (!state.token.trim()) { state.message = 'Pega el token temporal antes de verificarlo.'; return render(); }
    try {
      const url = new URL(state.token.trim());
      if (url.protocol !== 'https:' || !/(^|\.)dian\.gov\.co$/i.test(url.hostname)) throw new Error();
      await localApi('/sesion', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({token_url: url.toString()}) });
      state.portalOpen = true; saveDraft(); state.message = 'Abriendo DIAN en Chrome visible de este PC. Completa cualquier validación oficial.';
      setTimeout(async () => { await refreshLocalAgent(); render(); }, 1200);
    } catch (_) { state.portalOpen = false; saveDraft(); state.message = 'No se pudo abrir la sesión. Confirma que el agente esté conectado y que el enlace sea oficial de DIAN.'; render(); }
  }
  async function create() {
    snapshot();
    if (!cufes().length) { state.message = 'Faltan los CUFEs. Pégalos desde Excel, uno por fila.'; return render(); }
    state.queue = cufes().map(value => ({value, done:false}));
    saveQueue();
    state.message = `${state.queue.length} CUFEs preparados. Copia uno, búscalo y descarga el comprobante desde DIAN; luego márcalo como descargado.`;
    render();
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
  function chooseFolder() { const dialog = panel.querySelector('.dian-folder-dialog'); dialog.showModal(); dialog.addEventListener('close', async () => { if (dialog.returnValue === 'ok') { state.folder = dialog.querySelector('[name="folder"]').value.trim() || 'pendientes'; state.folderSelected = true; saveDraft(); await loadFolder(); render(); } }, {once:true}); }
  async function chooseLocalFolder() {
    if (!window.showDirectoryPicker) { state.message = 'Para elegir una carpeta de Windows usa Chrome o Edge actualizado.'; return render(); }
    try {
      state.localFolder = await window.showDirectoryPicker({mode:'readwrite'});
      state.localFolderName = state.localFolder.name;
      state.folderSelected = false;
      state.message = `Carpeta local vinculada: ${state.localFolderName}.`;
      if (state.batch) await pollBatch(); else render();
    } catch (error) { if (error.name !== 'AbortError') { state.message = 'No fue posible vincular la carpeta local.'; render(); } }
  }
  function bind() {
    panel.querySelector('[data-verify]')?.addEventListener('click', verify);
    panel.querySelector('[data-create]')?.addEventListener('click', create);
    panel.querySelector('[data-folder]')?.addEventListener('click', chooseFolder);
    panel.querySelector('[data-local-folder]')?.addEventListener('click', async () => {
      try { const result = await localApi('/carpeta', {method:'POST'}); state.localAgent = result; state.message = result.message; render(); }
      catch (error) { state.message = error.message; render(); }
    });
    panel.querySelector('[data-local-agent]')?.addEventListener('click', async () => {
      const agent = await refreshLocalAgent();
      state.message = agent ? 'Agente local conectado. Elige la carpeta y abre la sesión DIAN desde aquí.' : 'No se pudo conectar al agente local. Ábrelo en este PC y vuelve a intentar.';
      render();
    });
    panel.querySelector('[data-restart-agent]')?.addEventListener('click', async () => {
      if (!confirm('Se cerrará únicamente la sesión DIAN administrada por el agente. ¿Continuar?')) return;
      try { const result = await localApi('/reiniciar', {method:'POST'}); state.localAgent = result; state.portalOpen = false; state.message = result.message; render(); }
      catch (error) { state.message = error.message; render(); }
    });
    panel.querySelector('[data-copy-cufe]')?.addEventListener('click', async () => {
      const item = pendingQueue(); if (!item) return;
      try { await navigator.clipboard.writeText(item.value); state.message = 'CUFE copiado. Búscalo en DIAN y confirma la descarga oficial.'; }
      catch (_) { state.message = 'No se pudo copiar el CUFE. Selecciónalo desde la tarjeta y cópialo manualmente.'; }
      render();
    });
    panel.querySelector('[data-mark-downloaded]')?.addEventListener('click', () => {
      const item = pendingQueue(); if (!item) return;
      item.done = true; saveQueue(); state.message = 'Marcado como descargado. Continúa con el siguiente CUFE.'; render();
    });
    panel.querySelector('[data-normalize]')?.addEventListener('click', () => { snapshot(); state.raw = cufes().join('\n'); state.message = `${cufes().length} CUFEs organizados.`; render(); });
    panel.querySelectorAll('[data-format]').forEach(btn => btn.addEventListener('click', () => { state.format = btn.dataset.format; saveDraft(); render(); }));
    panel.querySelector('[data-pause]')?.addEventListener('click', async () => { try { const id = typeof state.batch === 'string' ? state.batch : state.batch.id; await api(`/api/dian/lotes/${id}/pausar`, {method:'POST'}); state.message='Lote pausado. El token temporal fue descartado.'; await pollBatch(); } catch (error) { state.message=error.message; render(); } });
    panel.querySelector('[data-clear]')?.addEventListener('click', () => { state.token=''; state.raw=''; state.dateFrom=''; state.dateTo=''; state.portalOpen=false; state.batch=null; state.queue=[]; sessionStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(QUEUE_KEY); state.message='Formulario y cola limpiados.'; render(); });
    panel.querySelector('#dian-token')?.addEventListener('input', () => { snapshot(); state.portalOpen = false; saveDraft(); });
    ['input', 'change'].forEach(event => {
      panel.querySelector('#dian-date-from')?.addEventListener(event, snapshot);
      panel.querySelector('#dian-date-to')?.addEventListener(event, snapshot);
    });
    panel.querySelector('#dian-cufes')?.addEventListener('input', () => { snapshot(); const head=panel.querySelector('.dian-cufe-head strong'); if(head) head.textContent=`${cufes().length} / ${MAX}`; });
  }
  function addStyle() {
    if (document.getElementById('dian-central-style')) return;
    const style = document.createElement('style'); style.id = 'dian-central-style';
    style.textContent = `body.dian-mode main{width:100%;max-width:none;padding:14px clamp(16px,3vw,40px)!important}.dian-panel{display:none}.dian-panel.active{display:block}.dian-desk{color:#eef7e9}.dian-bar{display:flex;gap:12px;align-items:center;border-bottom:1px solid #315438;padding:0 0 12px}.dian-brand{display:flex;gap:8px;align-items:baseline}.dian-brand span,.dian-side-title,.dian-token-strip label span{font-size:10px;font-weight:900;letter-spacing:.1em;color:#caff3d}.dian-brand b{font-size:14px}.dian-bar-spacer{flex:1}.dian-reset{border:0;background:transparent;color:#caff3d;font-size:20px;cursor:pointer}.dian-board{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:22px;padding-top:18px}.dian-board-main{display:grid;gap:11px;min-width:0}.dian-token-strip{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.dian-token-strip label{display:grid;gap:6px}.dian-token-strip input,.dian-board-cufes,.dian-date-range input{width:100%;box-sizing:border-box;border:1px solid #478052;border-radius:10px;background:linear-gradient(145deg,#25442f,#0d2717);color:#eff8ec;padding:11px;font:12px ui-monospace,Consolas,monospace}.dian-token-strip input{height:42px}.dian-board-cufes{height:190px;resize:vertical;line-height:1.45}.dian-cufe-head{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center}.dian-cufe-head b,.dian-cufe-head strong{color:#caff3d;font-size:11px}.dian-cufe-head span{font-size:11px;color:#a8b9a5}.dian-date-range{display:flex;gap:9px;align-items:end;flex-wrap:wrap}.dian-date-range label{display:grid;gap:5px;color:#caff3d;font-weight:900;font-size:9px;letter-spacing:.08em}.dian-date-range input{height:36px;min-width:156px;padding:7px}.dian-date-range small{color:#a8b9a5;font-size:10px;margin-bottom:10px}.dian-board-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dian-btn,.dian-format{border:1px solid #588464;border-radius:999px;background:linear-gradient(145deg,#31583a,#183921);color:#edf6e8;padding:6px 11px;font:800 10px inherit;cursor:pointer}.dian-btn{display:inline-flex!important;width:auto!important;min-height:31px!important;align-items:center;justify-content:center;flex:0 0 auto!important;line-height:1}.dian-btn-primary,.dian-format .active{background:#caff3d;color:#17200e;border-color:#caff3d}.dian-btn-primary[data-create],.dian-btn-primary[data-resume]{min-width:132px}.dian-btn:disabled{opacity:.4;cursor:not-allowed}.dian-total{display:grid;text-align:center;min-width:58px;padding:3px 7px;border:1px solid #4b8054;border-radius:8px;background:#193c23}.dian-total b{font-size:14px}.dian-total small{font-size:7px;color:#caff3d}.dian-format{display:inline-flex!important;align-items:center;gap:2px;margin-left:auto;padding:2px;flex:0 0 auto!important;width:auto!important}.dian-format button{display:inline-flex!important;width:auto!important;min-height:28px!important;align-items:center;border:0;border-radius:99px;background:transparent;color:#dbe7d7;padding:5px 9px;font-size:10px;font-weight:800;cursor:pointer}.dian-board-progress,.dian-board-summary{border:1px solid #35633f;border-radius:10px;background:rgba(30,67,38,.52)}.dian-board-progress{padding:10px 13px}.dian-board-progress>div{display:flex;justify-content:space-between;font-size:10px;margin-bottom:7px}.dian-board-progress b{color:#caff3d}.dian-board-progress i{display:block;height:5px;background:#17301c;border-radius:6px;overflow:hidden}.dian-board-progress em{display:block;height:100%;background:#baff43}.dian-board-summary{display:grid;grid-template-columns:repeat(3,1fr);overflow:hidden}.dian-summary-title,.dian-board-summary>div{padding:10px 12px}.dian-summary-title,.dian-board-summary p{grid-column:1/-1;background:#254f2d;color:#caff3d;font-size:10px;font-weight:900;letter-spacing:.1em}.dian-board-summary span{display:block;color:#9eb39b;font-size:10px}.dian-board-summary b{font-size:12px}.dian-board-summary p{margin:0;letter-spacing:0;font-weight:500}.dian-board-side{min-height:450px;border:1px solid #46764f;border-radius:14px;padding:16px;display:flex;flex-direction:column;background:linear-gradient(145deg,#244d2d,#0a2514)}.dian-session-status{display:flex;gap:8px;align-items:center;padding:9px;border:1px solid #864c43;border-radius:10px;color:#ffc6bd}.dian-session-status i{width:9px;height:9px;border-radius:50%;background:#f06b5e}.dian-session-status div{display:grid;gap:2px}.dian-session-status b{font-size:10px;letter-spacing:.1em}.dian-session-status small{font-size:9px}.dian-session-status.online{border-color:#58a462;color:#dff9dc}.dian-session-status.online i{background:#8cf07e;box-shadow:0 0 10px #8cf07e}.dian-side-title{display:flex;justify-content:space-between;margin:17px 0 9px}.dian-side-title small{font-size:9px;color:#a9bca5}.dian-folder-board{min-height:100px;border:1px dashed #7fb56a;border-radius:10px;background:#16391e;color:#eef7e8;display:grid;place-content:center;text-align:center;gap:6px;cursor:pointer}.dian-folder-board span{font-size:28px;color:#caff3d}.dian-folder-board b{font-size:12px}.dian-folder-board small,.dian-folder-state span,.dian-folder-file small,.dian-folder-empty{font-size:9px;color:#a8b9a4}.dian-folder-state{display:grid;gap:4px;padding:12px 0;border-bottom:1px solid #385c3c}.dian-folder-state b{font-size:11px}.dian-folder-files{flex:1;max-height:250px;overflow:auto;padding:6px 0}.dian-folder-file{display:flex;gap:7px;padding:7px 1px;border-bottom:1px solid #29472e}.dian-folder-file>span{color:#caff3d}.dian-folder-file div{display:grid;min-width:0}.dian-folder-file b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dian-pause{margin-top:9px}.dian-foot{margin:14px 0 0;padding-top:10px;border-top:1px solid #315438;color:#91a78e;font-size:10px}.dian-folder-dialog{border:1px solid #56835a;border-radius:12px;background:#112b18;color:#eef7e8}.dian-folder-dialog form{padding:20px}.dian-folder-dialog input{width:100%;box-sizing:border-box;margin:12px 0;padding:10px;background:#203e27;border:1px solid #5c8660;border-radius:7px;color:white}.dian-folder-dialog menu{display:flex;justify-content:flex-end;gap:8px;padding:0}.dian-folder-dialog button{padding:8px 10px;border:1px solid #6b946d;border-radius:7px;background:transparent;color:white}@media(max-width:850px){body.dian-mode main{padding:14px!important}.dian-board{grid-template-columns:1fr}.dian-board-side{min-height:290px}.dian-token-strip{grid-template-columns:1fr}.dian-cufe-head{grid-template-columns:1fr auto}.dian-cufe-head span{grid-column:1/-1}.dian-date-range{align-items:stretch}.dian-date-range label{flex:1}.dian-date-range input{min-width:0}.dian-date-range small{width:100%;margin:0}.dian-format{margin-left:0}.dian-board-summary{grid-template-columns:1fr 1fr}}`;
    style.textContent += '.dian-local-folder{display:grid;grid-template-columns:20px 1fr;gap:1px 7px;align-items:center;margin:10px 0 3px;padding:9px 2px;border:0;border-bottom:1px solid #385c3c;background:transparent;color:#edf8e9;text-align:left;cursor:pointer}.dian-local-folder:hover b{color:#caff3d}.dian-local-folder span{grid-row:1/3;color:#caff3d;font-size:16px}.dian-local-folder b{font-size:10px}.dian-local-folder small{font-size:9px;color:#a8b9a4}.dian-agent-pill{font-size:10px;color:#ffc6bd}.dian-agent-pill.online{color:#9ff391}.dian-queue{display:grid;gap:9px;border:1px solid #507952;border-radius:10px;padding:12px;background:#0e2816}.dian-queue>b{font-size:10px;color:#caff3d;letter-spacing:.1em}.dian-queue code{display:block;max-height:44px;overflow:auto;color:#edf8e9;word-break:break-all;font:11px ui-monospace,Consolas,monospace}.dian-queue>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dian-queue small{font-size:10px;color:#a8b9a4}';
    document.head.appendChild(style);
  }
  async function activate() { document.querySelectorAll('.tab,.panel').forEach(el => el.classList.remove('active')); document.querySelector('#dian-tab')?.classList.add('active'); panel?.classList.add('active'); document.body.classList.add('dian-mode'); await refreshLocalAgent(); render(); }
  function build() {
    const main = document.querySelector('main');
    if (!main || document.querySelector('#dian-panel')) return;
    restoreDraft();
    addStyle(); panel = document.createElement('section'); panel.id = 'dian-panel'; panel.className = 'panel dian-panel'; main.prepend(panel);
    const tab = document.createElement('button'); tab.id = 'dian-tab'; tab.dataset.kind = 'dian'; tab.type = 'button'; tab.className = 'tab'; tab.innerHTML = '<span class="nav-icon">DN</span><strong>D. DIAN</strong>'; tab.addEventListener('click', activate);
    // La pestaña es técnica e invisible: se abre exclusivamente desde el robot
    // del panel de Agentes, no como submódulo de Tesorería.
    const host = document.createElement('div'); host.hidden = true; host.style.display = 'none';
    host.appendChild(tab); document.querySelector('nav.tabs')?.appendChild(host);
    if (location.hash === '#dian') activate();
    // El formulario es un borrador del usuario: no se vuelve a dibujar mientras
    // no exista un lote. Antes se refrescaba la carpeta cada 5 segundos y ese
    // render reemplazaba los campos de fecha mientras el usuario los editaba.
    // La carpeta se actualiza al abrirla, al escoger destino y durante un lote.
    if (timer) clearInterval(timer); timer = setInterval(() => {
      if (!document.hidden && panel?.classList.contains('active') && state.batch) {
        snapshot();
        pollBatch();
      }
    }, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
}());
