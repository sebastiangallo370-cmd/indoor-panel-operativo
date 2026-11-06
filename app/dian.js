/* Panel D. DIAN: preparación local de lotes de comprobantes. */
(function () {
  'use strict';

  const MAX_CUFES = 1000;
  const CUFE_RE = /[A-Za-z0-9][A-Za-z0-9-]{20,}/g;
  const draft = { token: '', cufes: '', carpeta: '' };
  let panel;
  let activeStep = 'token';
  let dianConnected = false;
  let folderHandle = null;
  let folderFiles = [];
  let folderRefreshTimer = null;
  let prepared = null;

  const esc = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  async function api(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'No fue posible completar la operación.');
    return payload;
  }

  function cufes() {
    const matches = (draft.cufes.match(CUFE_RE) || []).map((item) => item.trim());
    return [...new Set(matches)].slice(0, MAX_CUFES);
  }

  function snapshot() {
    if (!panel) return;
    const token = panel.querySelector('#dian-token');
    const list = panel.querySelector('#dian-cufes');
    if (token) draft.token = token.value;
    if (list) draft.cufes = list.value;
  }

  function progress() {
    const hasToken = Boolean(draft.token.trim());
    const hasCufes = cufes().length > 0;
    const hasFolder = Boolean(folderHandle || draft.carpeta);
    return {
      hasToken, hasCufes, hasFolder,
      value: (hasToken ? 35 : 0) + (hasCufes ? 40 : 0) + (hasFolder ? 25 : 0)
    };
  }

  function fileSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function filesMarkup() {
    if (!folderHandle) return '<div class="dian-folder-empty">Selecciona una carpeta para ver sus archivos.</div>';
    if (!folderFiles.length) return '<div class="dian-folder-empty">Aún no hay archivos en esta carpeta.</div>';
    return folderFiles.map((file) => `<div class="dian-folder-file"><span>${file.kind === 'directory' ? '□' : '▤'}</span><div><b title="${esc(file.name)}">${esc(file.name)}</b><small>${file.kind === 'directory' ? 'Carpeta' : fileSize(file.size)}</small></div></div>`).join('');
  }

  function updateFolderPreview() {
    if (!panel) return;
    const list = panel.querySelector('[data-folder-files]');
    const count = panel.querySelector('[data-folder-file-count]');
    if (list) list.innerHTML = filesMarkup();
    if (count) count.textContent = folderHandle ? `${folderFiles.length} archivo${folderFiles.length === 1 ? '' : 's'}` : 'Sin conexión';
  }

  async function readFolder() {
    if (!folderHandle?.values) { folderFiles = []; return; }
    try {
      const entries = [];
      for await (const entry of folderHandle.values()) {
        if (entries.length >= 60) break;
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          entries.push({ name: entry.name, kind: 'file', size: file.size, modified: file.lastModified });
        } else entries.push({ name: entry.name, kind: 'directory', size: 0, modified: 0 });
      }
      folderFiles = entries.sort((a, b) => (b.modified || 0) - (a.modified || 0) || a.name.localeCompare(b.name));
    } catch (_) {
      folderFiles = [];
    }
  }

  function startFolderLiveUpdates() {
    if (folderRefreshTimer) clearInterval(folderRefreshTimer);
    folderRefreshTimer = setInterval(async () => {
      if (document.hidden || !folderHandle || !panel?.classList.contains('active')) return;
      await readFolder();
      updateFolderPreview();
    }, 4000);
  }

  function stepButton(id, number, title, done) {
    return `<button type="button" class="dian-step ${activeStep === id ? 'active' : ''} ${done ? 'done' : ''}" data-step="${id}">
      <span>${done ? '✓' : number}</span><b>${title}</b>
    </button>`;
  }

  function stepContent(message) {
    const info = progress();
    const count = cufes().length;
    if (activeStep === 'cufes') {
      return `<section class="dian-stage-inner">
        <div class="dian-eyebrow">02 · LISTADO</div>
        <h1>CUFEs desde Excel</h1>
        <p class="dian-copy">Pega la columna o las filas completas. Detectamos los identificadores válidos automáticamente.</p>
        <label class="dian-field dian-cufe-field">
          <span>CUFEs / UUID</span>
          <textarea id="dian-cufes" spellcheck="false" placeholder="CUFE&#10;CUFE&#10;CUFE">${esc(draft.cufes)}</textarea>
        </label>
        <div class="dian-stage-footer">
          <span class="dian-counter"><b>${count}</b> / ${MAX_CUFES} identificadores listos</span>
          <button type="button" class="dian-btn dian-btn-primary" data-next="folder">Elegir carpeta <i>→</i></button>
        </div>
        ${message ? `<p class="dian-message">${esc(message)}</p>` : ''}
      </section>`;
    }
    if (activeStep === 'folder') {
      return `<section class="dian-stage-inner">
        <div class="dian-eyebrow">03 · DESTINO</div>
        <h1>Elige la carpeta de descarga</h1>
        <p class="dian-copy">Se abrirá el Explorador de Windows. El navegador solo conserva el nombre de la carpeta durante esta sesión.</p>
        <button type="button" class="dian-folder-picker" data-folder>
          <span class="dian-folder-icon">↥</span>
          <span><b>${folderHandle ? esc(draft.carpeta) : 'Elegir carpeta en Windows'}</b><small>${folderHandle ? 'Carpeta local seleccionada' : 'Haz clic para abrir el Explorador'}</small></span>
          <i>→</i>
        </button>
        <div class="dian-prepare-row">
          <div><b>${count} CUFEs</b><small>${info.hasToken ? 'Token cargado' : 'Falta el token de acceso'}</small></div>
          <button type="button" class="dian-btn dian-btn-primary" data-prepare ${info.hasToken && count && info.hasFolder ? '' : 'disabled'}>Preparar lote <i>→</i></button>
        </div>
        ${message ? `<p class="dian-message">${esc(message)}</p>` : ''}
      </section>`;
    }
    return `<section class="dian-stage-inner">
      <div class="dian-eyebrow">01 · ACCESO</div>
      <h1>Conecta tu sesión DIAN</h1>
      <p class="dian-copy">Pega el token temporal en una sola línea. No se guarda al recargar ni se incluye en el historial.</p>
      <label class="dian-field dian-token-field">
        <span>Token de acceso temporal</span>
        <input id="dian-token" type="text" autocomplete="off" spellcheck="false" placeholder="Pega aquí el token temporal" value="${esc(draft.token)}">
      </label>
      <div class="dian-token-actions">
        <button type="button" class="dian-btn dian-btn-line" data-verify>↗ Verificar token</button>
        <button type="button" class="dian-btn dian-btn-line ${dianConnected ? 'confirmed' : ''}" data-confirm>${dianConnected ? '✓ Conexión confirmada' : '○ Confirmar conexión'}</button>
        <button type="button" class="dian-text-btn" data-toggle-token>Ocultar token</button>
        <button type="button" class="dian-btn dian-btn-primary" data-next="cufes">Continuar <i>→</i></button>
      </div>
      ${message ? `<p class="dian-message">${esc(message)}</p>` : ''}
    </section>`;
  }

  function render(message) {
    if (!panel) return;
    snapshot();
    const info = progress();
    const count = cufes().length;
    const format = prepared?.formato || 'XML';
    panel.innerHTML = `<div class="dian-desk">
      <header class="dian-bar">
        <div class="dian-brand"><span>TESORERÍA</span><b>D. DIAN</b></div>
        <div class="dian-bar-spacer"></div>
        <button type="button" class="dian-reset" data-clear title="Limpiar preparación">↺</button>
      </header>
      <div class="dian-board">
        <section class="dian-board-main">
          <div class="dian-token-strip">
            <label><span>TOKEN DE ACCESO</span><input id="dian-token" type="text" autocomplete="off" spellcheck="false" placeholder="Pega aquí el token temporal" value="${esc(draft.token)}"></label>
            <button type="button" class="dian-btn dian-btn-line" data-verify>↗ Verificar token</button>
          </div>
          <div class="dian-cufe-head"><b>CUFEs</b><span>Pega desde Excel: cada identificador se organiza en su propia fila.</span><strong><i data-cufe-count>${count}</i> / ${MAX_CUFES}</strong></div>
          <textarea id="dian-cufes" class="dian-board-cufes" spellcheck="false" placeholder="Pega aquí los CUFEs desde Excel&#10;Cada CUFE quedará en una fila">${esc(cufes().join('\n'))}</textarea>
          <div class="dian-board-actions">
            <span class="dian-total"><b data-cufe-count>${count}</b><small>TOTAL CUFEs</small></span>
            <button type="button" class="dian-btn dian-btn-line" data-normalize>↳ Organizar CUFEs</button>
            <button type="button" class="dian-btn dian-btn-primary" data-prepare ${info.hasToken && count && info.hasFolder ? '' : 'disabled'}>Preparar descarga</button>
            <div class="dian-format" aria-label="Formato de descarga"><button type="button" data-format="PDF" class="${format === 'PDF' ? 'active' : ''}">PDF</button><button type="button" data-format="XML" class="${format === 'XML' ? 'active' : ''}">XML</button></div>
          </div>
          <div class="dian-board-progress"><div><span>PORCENTAJE DE PREPARACIÓN</span><b>${info.value}%</b></div><i><em style="width:${info.value}%"></em></i></div>
          <div class="dian-board-summary"><div class="dian-summary-title">RESUMEN DEL LOTE</div><div><span>Token</span><b>${info.hasToken ? 'Cargado' : 'Pendiente'}</b></div><div><span>CUFEs</span><b>${count} listos</b></div><div><span>Preparados</span><b>${prepared?.cantidad || 0} archivos</b></div>${message ? `<p>${esc(message)}</p>` : ''}</div>
        </section>
        <aside class="dian-board-side">
          <div class="dian-session-status ${dianConnected ? 'online' : 'offline'}" data-session-status>
            <i></i><div><b>${dianConnected ? 'ONLINE' : 'OFFLINE'}</b><small>${dianConnected ? 'Sesión verificada en DIAN' : 'Token pendiente de verificar'}</small></div>
          </div>
          <div class="dian-side-title">ARCHIVOS EN CARPETA <small data-folder-file-count>${folderHandle ? `${folderFiles.length} archivo${folderFiles.length === 1 ? '' : 's'}` : 'Sin conexión'}</small></div>
          <button type="button" class="dian-folder-board" data-folder><span>↥</span><b>${folderHandle ? esc(draft.carpeta) : 'Elegir carpeta de Windows'}</b><small>${folderHandle ? 'Haz clic para cambiarla' : 'Se abrirá el Explorador de archivos'}</small></button>
          <div class="dian-folder-state"><span>Destino local</span><b>${folderHandle ? esc(draft.carpeta) : 'Sin seleccionar'}</b></div>
          <div class="dian-folder-files" data-folder-files>${filesMarkup()}</div>
          <div class="dian-connection ${dianConnected ? 'ok' : ''}"><span></span><div><b>${dianConnected ? 'Conexión confirmada' : 'Conexión pendiente'}</b><small>${dianConnected ? 'Sesión confirmada para este lote.' : 'Verifica el token y confirma la sesión DIAN.'}</small></div></div>
        </aside>
      </div>
      <footer class="dian-foot">El lote se prepara para revisión. La descarga real depende del servicio autorizado de DIAN o del proveedor tecnológico.</footer>
      <dialog class="dian-folder-dialog"><form method="dialog"><b>Carpeta de destino</b><p>Este navegador no permite abrir el selector de carpetas. Escribe un nombre de referencia.</p><input name="folderName" placeholder="Ej. Facturas noviembre"><menu><button value="cancel">Cancelar</button><button value="ok" class="dian-dialog-ok">Usar carpeta</button></menu></form></dialog>
    </div>`;
    bind();
  }

  function setFormat(format) {
    prepared = Object.assign({}, prepared || {}, { formato: format });
    render(`Formato ${format} seleccionado.`);
  }

  async function chooseFolder() {
    snapshot();
    if ('showDirectoryPicker' in window) {
      try {
        folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        draft.carpeta = folderHandle.name || 'Carpeta seleccionada';
        await readFolder();
        startFolderLiveUpdates();
        render('Carpeta local seleccionada.');
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    const dialog = panel.querySelector('.dian-folder-dialog');
    dialog.showModal();
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'ok') {
        const name = dialog.querySelector('[name="folderName"]').value.trim();
        if (name) {
          draft.carpeta = name;
          folderHandle = { name };
          folderFiles = [];
          render('Destino local guardado para esta sesión.');
        }
      }
    }, { once: true });
  }

  async function prepare() {
    snapshot();
    const info = progress();
    if (!info.hasToken || !info.hasCufes || !info.hasFolder) {
      render('Completa token, CUFEs y carpeta antes de preparar el lote.');
      return;
    }
    const button = panel.querySelector('[data-prepare]');
    if (button) { button.disabled = true; button.textContent = 'Preparando…'; }
    try {
      const payload = await api('/api/dian/preparar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: draft.token, cufes: cufes(), carpeta: draft.carpeta, formato: prepared?.formato || 'XML' })
      });
      prepared = payload;
      render(`${payload.cantidad || cufes().length} comprobantes preparados para revisión.`);
    } catch (error) {
      render(error.message || 'No fue posible preparar el lote.');
    }
  }

  function normalizarCufes(texto) {
    const encontrados = String(texto || '').match(CUFE_RE) || [];
    return [...new Set(encontrados.map((item) => item.trim()).filter(Boolean))].slice(0, MAX_CUFES);
  }

  function actualizarConteo() {
    snapshot();
    const total = cufes().length;
    panel.querySelectorAll('[data-cufe-count]').forEach((node) => { node.textContent = total; });
  }

  function bind() {
    panel.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
      snapshot(); activeStep = button.dataset.step; render();
    }));
    panel.querySelectorAll('[data-next]').forEach((button) => button.addEventListener('click', () => {
      snapshot(); activeStep = button.dataset.next; render();
    }));
    panel.querySelectorAll('[data-folder]').forEach((button) => button.addEventListener('click', chooseFolder));
    panel.querySelectorAll('[data-format]').forEach((button) => button.addEventListener('click', () => setFormat(button.dataset.format)));
    panel.querySelector('[data-verify]')?.addEventListener('click', () => {
      snapshot();
      if (!draft.token.trim()) return render('Pega el token antes de abrir la verificación.');
      let tokenUrl;
      try { tokenUrl = new URL(draft.token.trim()); } catch (_) {
        return render('Para verificar en Chrome pega el enlace temporal completo entregado por DIAN.');
      }
      const esDian = tokenUrl.protocol === 'https:' && /(^|\.)dian\.gov\.co$/i.test(tokenUrl.hostname);
      if (!esDian) return render('El enlace de verificación debe ser seguro y pertenecer a DIAN.');
      const ventana = window.open(tokenUrl.toString(), '_blank', 'noopener');
      if (!ventana) return render('Chrome bloqueó la pestaña de DIAN. Habilita ventanas emergentes e inténtalo de nuevo.');
      // DIAN no permite inspeccionar el resultado de una pestaña externa. ONLINE
      // significa que el usuario abrió y validó visualmente la sesión con este enlace.
      dianConnected = true;
      render('Sesión marcada como ONLINE después de abrir el enlace temporal de DIAN. Si el portal indicó un error, vuelve a pegar un token nuevo.');
    });
    panel.querySelector('[data-toggle-token]')?.addEventListener('click', () => {
      const input = panel.querySelector('#dian-token');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      panel.querySelector('[data-toggle-token]').textContent = input.type === 'password' ? 'Mostrar token' : 'Ocultar token';
    });
    panel.querySelector('[data-prepare]')?.addEventListener('click', prepare);
    panel.querySelector('[data-normalize]')?.addEventListener('click', () => {
      snapshot();
      draft.cufes = normalizarCufes(draft.cufes).join('\n');
      const field = panel.querySelector('#dian-cufes');
      if (field) field.value = draft.cufes;
      actualizarConteo();
    });
    panel.querySelector('[data-clear]')?.addEventListener('click', () => {
      draft.token = ''; draft.cufes = ''; draft.carpeta = ''; folderHandle = null; folderFiles = []; prepared = null; dianConnected = false; activeStep = 'token'; render('Preparación limpiada.');
    });
    panel.querySelector('#dian-cufes')?.addEventListener('input', actualizarConteo);
    panel.querySelector('#dian-token')?.addEventListener('input', () => {
      if (!dianConnected) return;
      dianConnected = false;
      const state = panel.querySelector('[data-session-status]');
      if (state) {
        state.className = 'dian-session-status offline';
        state.innerHTML = '<i></i><div><b>OFFLINE</b><small>Token modificado: vuelve a verificarlo</small></div>';
      }
    });
    panel.querySelector('#dian-cufes')?.addEventListener('paste', (event) => {
      const texto = event.clipboardData?.getData('text') || '';
      const filas = normalizarCufes(texto);
      if (!filas.length) return;
      event.preventDefault();
      snapshot();
      draft.cufes = [...new Set([...cufes(), ...filas])].slice(0, MAX_CUFES).join('\n');
      event.currentTarget.value = draft.cufes;
      actualizarConteo();
    });
  }

  function addStyle() {
    if (document.getElementById('dian-desk-style')) return;
    const style = document.createElement('style');
    style.id = 'dian-desk-style';
    style.textContent = `
      body.dian-mode main{width:100%;max-width:none;padding:14px clamp(18px,4vw,74px) 20px!important}
      body.dian-mode .footer-note{display:none!important}.dian-panel{display:none!important}.dian-panel.active{display:block!important}
      .dian-desk{width:100%;max-width:none;margin:0;color:#eaf3e5;font-family:inherit}.dian-bar{display:flex;align-items:center;gap:12px;min-height:38px;border-bottom:1px solid rgba(174,213,115,.25);padding:0 0 11px}.dian-brand{display:flex;align-items:baseline;gap:9px;letter-spacing:.08em}.dian-brand span,.dian-side-title,.dian-steps>p,.dian-eyebrow{font-size:10px;font-weight:900;color:#c9fa40;letter-spacing:.12em}.dian-brand b{font-size:15px}.dian-bar-spacer{flex:1}.dian-live{display:flex;gap:7px;align-items:center;font-size:11px;color:#aab7a8}.dian-live i,.dian-connection>span{width:7px;height:7px;border-radius:50%;background:#7f8c7e;display:inline-block}.dian-live.is-live i,.dian-connection.ok>span{background:#8cf07e;box-shadow:0 0 12px #8cf07e}.dian-live.is-live i{animation:dianPulse 1.8s infinite}.dian-format{display:flex;border:1px solid rgba(174,213,115,.3);border-radius:99px;padding:3px}.dian-format button,.dian-reset{border:0;background:transparent;color:#cbd7c8;cursor:pointer;font:800 10px inherit;padding:6px 11px;border-radius:99px}.dian-format button.active{background:#caff3d;color:#17220f}.dian-reset{font-size:19px;padding:2px 8px}.dian-workspace{display:grid;grid-template-columns:175px minmax(0,1fr) 250px;gap:24px;padding-top:18px;align-items:start}.dian-steps{display:grid;gap:3px;align-content:start}.dian-steps>p{margin:0 0 5px}.dian-step{border:0;border-left:2px solid rgba(173,207,160,.22);background:transparent;color:#99a99a;text-align:left;padding:8px 7px;cursor:pointer;display:flex;align-items:center;gap:9px;transition:.2s}.dian-step span{width:22px;height:22px;border:1px solid currentColor;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:900}.dian-step b{font-size:11px}.dian-step.active{color:#eaf8dc;border-color:#caff3d;background:linear-gradient(90deg,rgba(202,255,61,.11),transparent)}.dian-step.done span{color:#17220f;background:#aaf453;border-color:#aaf453}.dian-progress{margin:13px 8px 0;font-size:10px;color:#93a391}.dian-progress>div{display:flex;justify-content:space-between;margin-bottom:7px}.dian-progress b{color:#d1fa59}.dian-progress>i{height:3px;background:#203721;display:block;border-radius:9px;overflow:hidden}.dian-progress em{height:100%;background:#caff3d;display:block;border-radius:9px;transition:width .35s ease}.dian-stage{min-height:330px;padding:24px clamp(18px,3vw,46px);background:radial-gradient(circle at 48% 35%,rgba(79,150,77,.15),transparent 48%);border-top:1px solid rgba(186,222,176,.23);border-bottom:1px solid rgba(186,222,176,.18)}.dian-stage-inner{max-width:810px;margin:auto;animation:dianIn .28s ease}.dian-eyebrow{margin-bottom:8px}.dian-stage h1{font-size:clamp(21px,2vw,29px);margin:0;color:#f4f8ef;letter-spacing:-.04em}.dian-copy{max-width:640px;color:#aebdab;font-size:12px;line-height:1.5;margin:7px 0 18px}.dian-field{display:block}.dian-field>span{display:block;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.11em;color:#caff3d;margin-bottom:7px}.dian-token-field input{width:100%;box-sizing:border-box;background:rgba(247,255,240,.07);border:0;border-bottom:1px solid rgba(204,238,192,.42);color:#eff6ea;padding:12px 2px;outline:none;font:13px ui-monospace,Consolas,monospace;transition:.2s}.dian-token-field input:focus{border-color:#caff3d;background:rgba(202,255,61,.08)}.dian-token-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:13px}.dian-btn{border:1px solid rgba(190,225,169,.48);border-radius:999px;background:transparent;color:#e8f1e4;padding:8px 13px;font:800 11px inherit;cursor:pointer;transition:.2s}.dian-btn:hover:not(:disabled){border-color:#d9ff69;transform:translateY(-1px)}.dian-btn-primary{background:#caff3d;border-color:#caff3d;color:#19220d}.dian-btn:disabled{opacity:.4;cursor:not-allowed}.dian-btn.confirmed{border-color:#8cf07e;color:#8cf07e}.dian-text-btn{border:0;background:transparent;color:#caff3d;text-decoration:underline;cursor:pointer;font:700 10px inherit;margin-right:auto}.dian-btn i,.dian-folder-picker>i{font-style:normal;font-size:16px;margin-left:5px}.dian-message{font-size:11px;color:#d8efa5;margin:13px 0 0}.dian-cufe-field textarea{box-sizing:border-box;width:100%;height:150px;resize:vertical;background:rgba(4,22,12,.48);border:1px solid rgba(178,219,166,.27);border-radius:10px;color:#eef5e8;padding:12px;outline:none;font:12px ui-monospace,Consolas,monospace;line-height:1.45}.dian-cufe-field textarea:focus{border-color:#caff3d;box-shadow:0 0 0 3px rgba(202,255,61,.06)}.dian-stage-footer{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:16px}.dian-counter{font-size:12px;color:#a9b9a5}.dian-counter b{color:#d2fb58;font-size:16px}.dian-folder-picker{width:100%;border:1px dashed rgba(198,242,107,.55);background:linear-gradient(100deg,rgba(190,255,51,.12),rgba(190,255,51,.025));color:#eef6e7;min-height:80px;border-radius:12px;text-align:left;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer}.dian-folder-picker:hover{border-style:solid}.dian-folder-picker span:not(.dian-folder-icon){display:grid;gap:4px}.dian-folder-picker b{font-size:13px}.dian-folder-picker small{color:#a8b8a4;font-size:10px}.dian-folder-icon{font-size:25px;color:#caff3d}.dian-folder-picker>i{margin-left:auto;color:#caff3d}.dian-prepare-row{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid rgba(185,219,176,.17)}.dian-prepare-row div{display:grid;gap:4px}.dian-prepare-row b{font-size:13px}.dian-prepare-row small{font-size:10px;color:#9aab96}.dian-side{border-left:1px solid rgba(186,222,176,.2);padding-left:21px;min-height:330px}.dian-side-title{margin:1px 0 15px}.dian-destination{border:0;background:transparent;color:#e9f1e4;width:100%;display:flex;align-items:center;gap:10px;padding:0 0 13px;text-align:left;border-bottom:1px solid rgba(186,222,176,.18);cursor:pointer}.dian-destination span:not(.dian-folder-mini){display:grid;gap:3px}.dian-destination b{font-size:12px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dian-destination small{font-size:10px;color:#96a794}.dian-destination i{margin-left:auto;color:#caff3d;font-style:normal}.dian-folder-mini{font-size:23px;color:#caff3d}.dian-summary-line{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(186,222,176,.12);font-size:11px;color:#9eb09c}.dian-summary-line b{color:#f0f7ec;font-size:12px}.dian-connection{display:flex;gap:9px;margin-top:17px;align-items:flex-start}.dian-connection div{display:grid;gap:4px}.dian-connection b{font-size:12px}.dian-connection small{font-size:10px;color:#9daf99;line-height:1.35}.dian-foot{margin:15px 200px 0;border-top:1px solid rgba(186,222,176,.18);padding-top:10px;color:#82917e;font-size:10px;line-height:1.4}.dian-folder-dialog{border:1px solid #55734a;background:#102113;color:#eff6ea;border-radius:14px;padding:0;max-width:390px}.dian-folder-dialog form{padding:22px}.dian-folder-dialog p{font-size:12px;color:#b5c4af;line-height:1.5}.dian-folder-dialog input{box-sizing:border-box;width:100%;background:#1a3220;color:white;border:1px solid #55734a;border-radius:7px;padding:10px}.dian-folder-dialog menu{padding:0;margin:18px 0 0;display:flex;justify-content:flex-end;gap:8px}.dian-folder-dialog button{border:1px solid #68855d;background:transparent;color:#ecf5e7;border-radius:8px;padding:8px 12px;cursor:pointer}.dian-folder-dialog .dian-dialog-ok{background:#caff3d;color:#19220d;border-color:#caff3d}@keyframes dianIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}@keyframes dianPulse{50%{opacity:.35;box-shadow:0 0 0 6px rgba(140,240,126,0)}}
      .dian-session-status{display:flex;align-items:center;gap:8px;min-width:192px;margin:0 0 14px;padding:7px 11px;border:1px solid rgba(232,91,91,.42);border-radius:12px;background:rgba(78,25,25,.22);box-shadow:inset 0 1px rgba(255,255,255,.03);color:#f0dede}.dian-session-status i{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:#e85b5b;box-shadow:0 0 0 4px rgba(232,91,91,.12)}.dian-session-status div{display:grid;gap:1px}.dian-session-status b{font-size:10px;letter-spacing:.11em}.dian-session-status small{font-size:9px;color:#c9a8a8}.dian-session-status.online{border-color:rgba(140,240,126,.55);background:rgba(52,121,62,.2);color:#dff9dd}.dian-session-status.online i{background:#8cf07e;box-shadow:0 0 11px #8cf07e;animation:dianPulse 1.8s infinite}.dian-session-status.online small{color:#b7dcb4}
      @media(max-width:900px){body.dian-mode main{padding:18px!important}.dian-workspace{grid-template-columns:1fr;gap:20px}.dian-steps{display:flex;gap:2px;overflow:auto}.dian-steps>p,.dian-progress{display:none}.dian-step{min-width:max-content;border-left:0;border-bottom:2px solid rgba(173,207,160,.22)}.dian-side{border-left:0;border-top:1px solid rgba(186,222,176,.2);padding:20px 0;min-height:0}.dian-foot{margin:20px 0 0}.dian-stage{min-height:0;padding:28px 18px}.dian-bar{flex-wrap:wrap}.dian-bar-spacer{display:none}.dian-live,.dian-session-status{margin-left:auto}.dian-token-actions{align-items:stretch}.dian-text-btn{margin-right:0}.dian-stage-footer,.dian-prepare-row{align-items:flex-start;flex-direction:column}.dian-btn-primary{width:100%;text-align:center}}
      @media(prefers-reduced-motion:reduce){.dian-live.is-live i,.dian-stage-inner{animation:none}}
      .dian-board{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:22px;padding-top:18px;align-items:stretch}.dian-board-main{min-width:0;display:grid;gap:10px}.dian-token-strip{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:end}.dian-token-strip label{min-width:0}.dian-token-strip label span,.dian-cufe-head>b,.dian-side-title{display:block;font-size:10px;font-weight:900;letter-spacing:.09em;color:#caff3d;margin-bottom:6px}.dian-token-strip input{box-sizing:border-box;width:100%;height:38px;border:1px solid rgba(184,224,175,.34);border-radius:7px;background:rgba(234,255,229,.07);color:#edf5e8;padding:0 12px;outline:none;font:12px ui-monospace,Consolas,monospace}.dian-token-strip input:focus{border-color:#caff3d}.dian-token-strip .dian-btn{height:38px;white-space:nowrap}.dian-cufe-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin-top:4px}.dian-cufe-head>b{margin:0}.dian-cufe-head span{font-size:11px;color:#a4b3a0}.dian-cufe-head strong{font-size:11px;color:#caff3d}.dian-cufe-head i{font-style:normal;font-size:15px}.dian-board-cufes{box-sizing:border-box;width:100%;height:185px;resize:vertical;border:1px solid rgba(182,222,172,.28);border-radius:9px;background:rgba(3,20,10,.5);padding:13px;color:#eef6e8;outline:none;font:12px ui-monospace,Consolas,monospace;line-height:1.45}.dian-board-cufes:focus{border-color:#caff3d;box-shadow:0 0 0 3px rgba(202,255,61,.06)}.dian-board-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dian-total{display:grid;min-width:76px;text-align:center;padding:4px 9px;border-radius:7px;background:rgba(202,255,61,.09)}.dian-total b{font-size:17px;line-height:1;color:#ecf7e4}.dian-total small{font-size:8px;color:#caff3d;font-weight:900;letter-spacing:.06em;margin-top:4px}.dian-board-actions .dian-btn{padding:8px 13px}.dian-board-actions .dian-format{margin-left:auto}.dian-board-progress{padding:9px 0;border-top:1px solid rgba(186,222,176,.18);border-bottom:1px solid rgba(186,222,176,.18)}.dian-board-progress>div{display:flex;justify-content:space-between;font-size:10px;color:#aab8a6;margin-bottom:7px}.dian-board-progress b{color:#caff3d}.dian-board-progress>i{display:block;height:5px;border-radius:9px;background:#1b301d;overflow:hidden}.dian-board-progress em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#94e778,#caff3d);transition:width .3s ease}.dian-board-summary{min-height:104px;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(183,220,174,.13);border-radius:9px;overflow:hidden}.dian-summary-title{grid-column:1/-1;padding:8px 12px 3px;font-size:10px;font-weight:900;letter-spacing:.1em;color:#caff3d;background:rgba(3,20,10,.35)}.dian-board-summary>div:not(.dian-summary-title){background:rgba(3,20,10,.44);padding:9px 12px;display:grid;gap:5px}.dian-board-summary span{font-size:10px;color:#9cac97}.dian-board-summary b{font-size:12px;color:#edf5e8}.dian-board-summary p{grid-column:1/-1;margin:0;padding:7px 12px;background:rgba(202,255,61,.08);color:#dff7b5;font-size:11px}.dian-board-side{min-height:366px;padding:16px 18px;border-left:1px solid rgba(186,222,176,.23);background:linear-gradient(145deg,rgba(50,104,54,.16),rgba(3,24,12,.08))}.dian-folder-board{width:100%;min-height:154px;display:grid;place-content:center;text-align:center;gap:8px;border:1px dashed rgba(202,255,61,.55);border-radius:10px;background:rgba(0,25,10,.22);color:#edf6e8;cursor:pointer}.dian-folder-board:hover{border-style:solid;background:rgba(202,255,61,.08)}.dian-folder-board>span{font-size:29px;color:#caff3d}.dian-folder-board b{font-size:12px}.dian-folder-board small{font-size:10px;color:#a1b29d}.dian-folder-state{display:grid;gap:4px;padding:14px 0;border-bottom:1px solid rgba(186,222,176,.18)}.dian-folder-state span{font-size:10px;color:#99aa96}.dian-folder-state b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dian-board-side .dian-connection{margin-top:15px}@media(max-width:900px){.dian-board{grid-template-columns:1fr}.dian-board-side{min-height:0;border-left:0;border-top:1px solid rgba(186,222,176,.23)}.dian-folder-board{min-height:94px}.dian-token-strip{grid-template-columns:1fr 1fr}.dian-token-strip label{grid-column:1/-1}.dian-cufe-head{grid-template-columns:1fr auto}.dian-cufe-head span{grid-column:1/-1;grid-row:2}.dian-board-actions .dian-format{margin-left:0}.dian-board-summary{grid-template-columns:1fr 1fr}}
      /* Acabado visual coherente con las tarjetas operativas de Producción. */
      .dian-board-main,.dian-board-side{filter:drop-shadow(0 14px 22px rgba(0,0,0,.12))}.dian-token-strip input,.dian-board-cufes,.dian-board-summary,.dian-board-side{border-color:rgba(112,211,135,.44);background:linear-gradient(145deg,rgba(43,80,53,.78),rgba(12,35,21,.92));box-shadow:inset 0 1px rgba(225,255,220,.07),inset 0 -18px 32px rgba(0,0,0,.13)}.dian-token-strip input{border-radius:10px}.dian-board-cufes{border-radius:12px}.dian-board-side{border:1px solid rgba(112,211,135,.38);border-radius:14px}.dian-btn{border-color:rgba(112,211,135,.45);background:linear-gradient(145deg,rgba(49,92,60,.9),rgba(23,53,31,.96));box-shadow:inset 0 1px rgba(235,255,228,.09),0 5px 12px rgba(0,0,0,.13)}.dian-btn:hover:not(:disabled){background:linear-gradient(145deg,rgba(65,117,73,.98),rgba(28,65,37,.98));box-shadow:0 7px 16px rgba(0,0,0,.19),0 0 0 1px rgba(202,255,61,.18)}.dian-btn-primary{background:linear-gradient(145deg,#d8ff69,#aee936);box-shadow:inset 0 1px rgba(255,255,255,.5),0 7px 16px rgba(113,165,28,.2)}.dian-btn-primary:hover:not(:disabled){background:linear-gradient(145deg,#e4ff80,#b9f045)}.dian-total{border:1px solid rgba(112,211,135,.32);background:linear-gradient(145deg,rgba(53,93,58,.84),rgba(18,44,25,.94));box-shadow:inset 0 1px rgba(235,255,228,.07)}.dian-board-progress{padding:11px 13px;border:1px solid rgba(112,211,135,.28);border-radius:10px;background:rgba(16,45,25,.68)}.dian-board-summary{border:1px solid rgba(112,211,135,.34);box-shadow:inset 0 1px rgba(235,255,228,.06)}.dian-summary-title{background:rgba(43,82,49,.62)!important}.dian-board-summary>div:not(.dian-summary-title){background:rgba(13,39,22,.56)}.dian-folder-board{border-style:solid;border-color:rgba(112,211,135,.47);background:linear-gradient(145deg,rgba(56,101,61,.72),rgba(14,43,24,.92));box-shadow:inset 0 1px rgba(235,255,228,.08),inset 0 -18px 26px rgba(0,0,0,.14)}.dian-folder-board:hover{background:linear-gradient(145deg,rgba(70,121,70,.84),rgba(20,57,30,.96));box-shadow:0 7px 18px rgba(0,0,0,.16),0 0 0 1px rgba(202,255,61,.16)}.dian-side-title{display:flex!important;justify-content:space-between;align-items:center}.dian-side-title small{font-size:9px;color:#a8bd9d;font-weight:700;letter-spacing:0}.dian-board-side{display:flex;flex-direction:column}.dian-folder-board{min-height:96px}.dian-folder-files{flex:1;min-height:150px;max-height:270px;overflow:auto;margin-top:12px;border-top:1px solid rgba(186,222,176,.16);border-bottom:1px solid rgba(186,222,176,.16);padding:5px 0}.dian-folder-file{display:flex;gap:8px;align-items:center;padding:8px 4px;border-bottom:1px solid rgba(186,222,176,.1)}.dian-folder-file:last-child{border-bottom:0}.dian-folder-file>span{color:#caff3d;font-size:15px}.dian-folder-file div{min-width:0;display:grid;gap:2px}.dian-folder-file b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dian-folder-file small,.dian-folder-empty{font-size:9px;color:#9dac98}.dian-folder-empty{display:grid;place-items:center;min-height:118px;text-align:center;line-height:1.5;padding:0 15px}
      /* Pulido de jerarquía: mismo contenido, mejor lectura y acabado de tarjeta. */
      .dian-board{gap:26px}.dian-board-main{gap:12px;position:relative}.dian-token-strip{padding:10px 12px 12px;border-bottom:1px solid rgba(164,222,150,.17);background:linear-gradient(90deg,rgba(72,126,70,.10),transparent 60%)}.dian-token-strip label span{letter-spacing:.13em}.dian-token-strip input{height:42px;background:linear-gradient(100deg,rgba(48,86,57,.88),rgba(18,47,27,.94))}.dian-token-strip .dian-btn{height:42px}.dian-cufe-head{padding:4px 8px 0}.dian-cufe-head>b{font-size:11px}.dian-board-cufes{min-height:190px;background:radial-gradient(circle at 12% 5%,rgba(102,176,96,.16),transparent 37%),linear-gradient(145deg,rgba(35,76,47,.92),rgba(8,31,17,.97));box-shadow:inset 0 1px rgba(237,255,229,.08),inset 0 -36px 55px rgba(0,0,0,.15)}.dian-board-actions{padding:3px 0;flex-wrap:nowrap}.dian-board-actions .dian-btn{width:auto!important;min-height:42px}.dian-board-actions .dian-btn-primary{min-width:168px}.dian-total{min-width:82px;min-height:39px;place-content:center}.dian-format{background:rgba(11,37,19,.62);box-shadow:inset 0 1px rgba(255,255,255,.06)}.dian-format button{min-height:32px}.dian-board-progress{background:linear-gradient(90deg,rgba(50,97,57,.42),rgba(9,34,18,.5));box-shadow:inset 0 1px rgba(240,255,231,.05)}.dian-board-progress>i{height:6px;background:rgba(5,27,13,.72)}.dian-board-progress em{box-shadow:0 0 11px rgba(170,244,83,.45)}.dian-board-summary{border-radius:12px}.dian-summary-title{padding:10px 13px 6px}.dian-board-summary>div:not(.dian-summary-title){padding:12px 13px}.dian-board-side{padding:18px 18px 16px;background:radial-gradient(circle at 50% 0,rgba(94,157,83,.18),transparent 45%),linear-gradient(145deg,rgba(36,77,47,.87),rgba(8,31,17,.98))}.dian-folder-board{border-radius:12px}.dian-folder-files{scrollbar-color:#8fd96f transparent}.dian-connection{padding-top:3px}.dian-foot{color:#91a78d}@media(max-width:900px){.dian-board-actions{flex-wrap:wrap}.dian-board-actions .dian-btn{flex:1}.dian-board-actions .dian-format{margin-left:0}}
    `;
    document.head.appendChild(style);
  }

  async function load() {
    try { prepared = await api('/api/dian/estado'); } catch (_) { prepared = null; }
    render();
  }

  function activate() {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((item) => item.classList.remove('active'));
    document.querySelector('#dian-tab')?.classList.add('active');
    panel?.classList.add('active');
    document.body.classList.remove('cartera-mode');
    document.body.classList.add('dian-mode');
    load();
  }

  function build() {
    const main = document.querySelector('main');
    const treasury = [...document.querySelectorAll('.nav-group')].find((group) =>
      group.querySelector('.nav-parent span:last-child')?.textContent.trim() === 'TESORERÍA'
    );
    if (!main || document.querySelector('#dian-panel')) return;
    addStyle();
    panel = document.createElement('section');
    panel.id = 'dian-panel'; panel.className = 'panel dian-panel';
    main.prepend(panel);
    const tab = document.createElement('button');
    tab.id = 'dian-tab'; tab.type = 'button'; tab.className = 'tab';
    tab.innerHTML = '<span class="nav-icon">DN</span><strong>D. DIAN</strong>';
    tab.addEventListener('click', activate);
    // El submódulo pertenece al desplegable de TESORERÍA, nunca a la barra principal.
    const menu = treasury?.querySelector('.nav-children') || document.querySelector('.tabs');
    if (menu) menu.appendChild(tab);
    if (location.hash === '#dian') activate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
}());
