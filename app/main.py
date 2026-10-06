import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
from difflib import SequenceMatcher
import secrets
import shutil
import tempfile
import sqlite3
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from openpyxl import load_workbook

from app.excel_linux import crear_excel_listado
from app.excel_mockups import listing_designs
from app import excel_mockups
from app.uploaded_mockups import sync_order_uploads, require_mockup_upload
from app import sheets_sync, db_backup, respaldo
from app.creator_xlsx import _data_from_source, create_from_images, create_from_sheet_bundle, normalize_output_name
from app.settings import STATE_DIR, UPLOAD_DIR, prepare_pedidos_runtime, prepare_runtime

import monitor_archivos as legacy
import pedidos_legacy as pedidos

legacy.crear_excel_listado = crear_excel_listado
CONFIG = prepare_runtime()
PEDIDOS_CONFIG = prepare_pedidos_runtime()
pedidos.CONFIG_PATH = STATE_DIR / "pedidos_config.json"
DB_PATH = STATE_DIR / "jobs.sqlite3"
security = HTTPBasic(auto_error=False)
from app.cartera_api import cartera_router
from app.inventario_api import inventario_router, start_sublimacion_worker, inventory_alerts
from app import permisos as permisos_mod, exportar as exportar_mod, reposiciones as reposiciones_mod, agentes_canal as agentes_mod, promedios as promedios_mod
from app.cartera_externa import externa_router
app = FastAPI(title="Asistente de Reprogramaciones", version="1.0.0")


@app.middleware("http")
async def no_cache_html(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" and response.headers.get("content-type", "").startswith("text/html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response
PRODUCTION_START_ROW = 726
PRODUCTION_CACHE = {"at": 0.0, "data": None}
PRODUCTION_CACHE_LOCK = threading.Lock()
LOGO_FILE = Path(__file__).resolve().parent / "indoor-logo.png"
LOGO_SVG_FILE = Path(__file__).resolve().parent / "indoor-logo.svg"
FAVICON_FILE = Path(__file__).resolve().parent / "favicon.png"
FAVICON_SVG_FILE = Path(__file__).resolve().parent / "favicon.svg"

REWORK_MODULE_SCRIPT = """<script>(()=>{const nav=document.querySelector('#news-toggle')?.closest('.nav-group');if(!nav)return;const panel=document.createElement('section');panel.className='panel';panel.dataset.panel='reproceso';panel.innerHTML='<div class="rework-module"><header><div><span>CONTROL DE CALIDAD</span><h2>REPROCESO</h2><p>Órdenes que requieren corrección y su motivo registrado.</p></div><button type="button" id="rework-refresh">Actualizar</button></header><div id="rework-summary" class="rework-summary">Cargando reprocesos…</div><div id="rework-cards" class="rework-cards"></div></div>';document.querySelector('main').appendChild(panel);const group=document.createElement('div');group.className='nav-group';group.innerHTML='<button class="tab" data-kind="reproceso" type="button"><span class="nav-icon">RP</span><strong>REPROCESO</strong></button>';nav.insertAdjacentElement('afterend',group);const css=document.createElement('style');css.textContent='.rework-module{display:grid;gap:16px;max-width:1440px;margin:auto}.rework-module>header{display:flex;justify-content:space-between;gap:16px;align-items:start;padding:24px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(135deg,#241515,#11150f)}.rework-module header span{color:#ff9c99;font-size:.68rem;font-weight:900;letter-spacing:.12em}.rework-module h2{margin:5px 0;font-size:1.7rem}.rework-module p{margin:0;color:var(--muted)}.rework-module button{width:auto;padding:9px 14px;background:#ef7370;color:#251111;border:0;border-radius:9px;font-weight:900}.rework-summary{padding:13px 16px;border:1px solid rgba(239,115,112,.25);border-radius:12px;background:rgba(239,115,112,.07);color:#ffd2ce}.rework-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:13px}.rework-card{display:grid;gap:12px;padding:17px;border:1px solid rgba(239,115,112,.26);border-top:3px solid #ef7370;border-radius:15px;background:linear-gradient(150deg,#211817,#10140f)}.rework-card header{display:flex;justify-content:space-between;gap:8px}.rework-card small{color:#b8c4b2;font-size:.68rem}.rework-card h3{margin:4px 0;font-size:1rem}.rework-card p{margin:0;color:#e3ebe0;white-space:pre-wrap;line-height:1.45}.rework-card footer{display:flex;justify-content:space-between;gap:8px;color:#aeb9a6;font-size:.7rem}.rework-empty{padding:42px;text-align:center;border:1px dashed #6f403d;border-radius:14px;color:#b7c0b3}@media(max-width:620px){.rework-module>header{padding:17px;flex-direction:column}.rework-module>header button{width:100%}.rework-cards{grid-template-columns:1fr}}';document.head.appendChild(css);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function load(){const box=document.querySelector('#rework-cards'),summary=document.querySelector('#rework-summary');try{const response=await fetch('/api/reproceso',{cache:'no-store'}),rows=await response.json();if(!response.ok)throw Error(rows.detail||'No fue posible cargar');summary.textContent=rows.length+' reproceso'+(rows.length===1?' activo':'s')+' registrado'+(rows.length===1?'':'s');box.innerHTML=rows.map(row=>'<article class="rework-card"><header><div><small>ORDEN</small><h3>'+esc(row.order||'Sin orden')+'</h3><small>'+esc(row.client||'Sin cliente')+'</small></div><small>'+new Date(row.created_at).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})+'</small></header><div><small>PROCESO</small><p>'+esc(row.process||'Sin proceso')+'</p></div><div><small>MOTIVO</small><p>'+esc(row.reason)+'</p></div><footer><span>Registró: '+esc(row.username)+'</span><span>Fila '+esc(row.source_row)+'</span></footer></article>').join('')||'<div class="rework-empty">No hay reprocesos registrados.</div>'}catch(error){summary.textContent=error.message}}group.querySelector('button').onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===group.querySelector('button')));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x===panel));document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');load()};document.querySelector('#rework-refresh').onclick=load})();</script>"""

REWORK_CONTROLS_SCRIPT = """<script>
(() => {
  const refresh = document.getElementById('rework-refresh');
  const board = document.getElementById('rework-cards');
  const tab = document.querySelector('.tab[data-kind="reproceso"]');
  if (!refresh || !board || !tab) return;
  let rows = [];
  const reworkCanDelete = ['ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO', 'COORDINADOR'].includes(
    String(document.querySelector('.user-info small')?.textContent || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
  );
  const filters = document.createElement('section');
  filters.className = 'rework-filters';
  filters.innerHTML = '<label>Cliente<input type="search" data-rework-filter="client" placeholder="Buscar cliente"></label><label>Orden<input type="search" data-rework-filter="order" placeholder="N° de orden"></label><label>Referencia<input type="search" data-rework-filter="reference" placeholder="Referencia"></label><label>Observaciones<input type="search" data-rework-filter="reason" placeholder="Buscar observación"></label><label>Operario<input type="search" data-rework-filter="username" placeholder="Usuario responsable"></label><label>Fecha desde<input type="date" data-rework-filter="from"></label><label>Fecha hasta<input type="date" data-rework-filter="to"></label><button type="button" data-rework-clear>Limpiar</button>';
  refresh.closest('.rework-module')?.insertBefore(filters, refresh.closest('.rework-module')?.querySelector('.rework-summary'));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const applyFilters = () => {
    const values = Object.fromEntries([...filters.querySelectorAll('[data-rework-filter]')].map(input => [input.dataset.reworkFilter, normalize(input.value)]));
    board.querySelectorAll('.rework-card').forEach((card, index) => {
      const row = rows[index];
      if (!row) return;
      const date = String(row.created_at || '').slice(0, 10);
      // Rango de fechas: desde y/o hasta (cualquiera de los dos puede quedar vacío).
      const outOfRange = (values.from && date < values.from) || (values.to && date > values.to);
      card.hidden = !['client','order','reference','reason','username'].every(field => !values[field] || normalize(row[field]).includes(values[field])) || !!outOfRange;
    });
  };
  filters.addEventListener('input', applyFilters);
  filters.querySelector('[data-rework-clear]').onclick = () => { filters.querySelectorAll('input').forEach(input => input.value = ''); applyFilters(); };
  const decorate = async () => {
    try {
      const response = await fetch('/api/reproceso', {cache: 'no-store'});
      if (!response.ok) return;
      rows = await response.json();
      const cards = [...board.querySelectorAll('.rework-card')];
      cards.forEach((card, index) => {
        const row = rows[index];
        if (!row || card.querySelector('.rework-card-actions')) return;
        const actions = document.createElement('div');
        actions.className = 'rework-card-actions';
        actions.innerHTML = '<button type="button" data-rework-edit="' + row.id + '">Editar</button>' + (reworkCanDelete ? '<button type="button" data-rework-delete="' + row.id + '">Eliminar</button>' : '');
        card.appendChild(actions);
      });
      applyFilters();
    } catch (_) {}
  };
  const afterLoad = () => setTimeout(decorate, 350);
  tab.addEventListener('click', afterLoad);
  refresh.addEventListener('click', afterLoad);
  const observer = new MutationObserver(() => { if (board.children.length) decorate(); });
  observer.observe(board, {childList: true});
  board.addEventListener('click', async event => {
    const edit = event.target.closest('[data-rework-edit]');
    const remove = event.target.closest('[data-rework-delete]');
    const button = edit || remove;
    if (!button) return;
    const id = Number(button.dataset.reworkEdit || button.dataset.reworkDelete);
    const row = rows.find(item => Number(item.id) === id);
    if (!id || !row) return;
    if (edit) {
      const reason = prompt('Editar observación de reproceso:', row.reason || '');
      if (reason === null) return;
      const value = reason.trim();
      if (!value || value.length > 2000) { alert('Escribe una observación entre 1 y 2000 caracteres.'); return; }
      button.disabled = true;
      try {
        const response = await fetch('/api/produccion/operaciones/evento/' + id, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({reason: value})});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(data.detail || 'No fue posible editar el reproceso');
        refresh.click();
      } catch (error) { alert(error.message); button.disabled = false; }
      return;
    }
    if (!confirm('¿Eliminar este registro de reproceso?')) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/produccion/operaciones/evento/' + id, {method: 'DELETE'});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.detail || 'No fue posible eliminar el reproceso');
      refresh.click();
    } catch (error) { alert(error.message); button.disabled = false; }
  });
})();
</script>"""

INVENTORY_CONTROL_SCRIPT = """<script>
(() => {
  const group = [...document.querySelectorAll('.nav-group')].find(item => /INVENTARIOS/i.test(item.querySelector('.nav-parent')?.textContent || ''));
  const children = group?.querySelector('.nav-children');
  if (!children || children.querySelector('[data-inventory-control]')) return;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'panel-control';
  panel.innerHTML = '<div class="control-panel"><div class="control-panel-head"><div><span>RESUMEN</span><h2>PANEL DE CONTROL</h2></div><button type="button" class="control-panel-refresh">Actualizar</button></div><div class="control-panel-cards">Cargando resumen…</div></div>';
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'tab inventory-control-nav';
  control.dataset.inventoryControl = 'true';
  control.innerHTML = '<span class="nav-icon">PC</span><strong>PANEL DE CONTROL</strong>';
  const cards = panel.querySelector('.control-panel-cards');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const load = async () => {
    cards.textContent = 'Actualizando resumen…';
    try {
      const [stockResponse, productionResponse, reworkResponse] = await Promise.all([fetch('/api/inventarios', {cache:'no-store'}), fetch('/api/produccion', {cache:'no-store'}), fetch('/api/reproceso', {cache:'no-store'})]);
      const [stock, production, rework] = await Promise.all([stockResponse.json(), productionResponse.json(), reworkResponse.json()]);
      if (!stockResponse.ok || !productionResponse.ok || !reworkResponse.ok) throw Error('No fue posible cargar el resumen');
      const orderIndex = (production.headers || []).findIndex(header => String(header || '').trim().toUpperCase() === 'ORDEN');
      const orders = new Set((production.rows || []).map(row => String((row.values || [])[orderIndex] || '').trim()).filter(Boolean)).size;
      const categories = (stock.categories || []).filter(category => category.available && category.key !== 'DOCUMENTACION PROCESO').length;
      cards.innerHTML = '<article><small>ÓRDENES ACTIVAS</small><strong>' + orders.toLocaleString('es-CO') + '</strong><span>Pedidos cargados en producción</span></article><article><small>REFERENCIAS EN STOCK</small><strong>' + Number(stock.summary?.items || 0).toLocaleString('es-CO') + '</strong><span>' + categories + ' categorías disponibles</span></article><article><small>REPROCESOS</small><strong>' + rework.length.toLocaleString('es-CO') + '</strong><span>Registros pendientes de seguimiento</span></article>';
    } catch (error) { cards.innerHTML = '<p>' + esc(error.message) + '</p>'; }
  };
  control.onclick = () => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === control));
    document.querySelectorAll('.panel').forEach(item => item.classList.toggle('active', item === panel));
    document.body.classList.remove('inicio-mode','inventory-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');
    load();
  };
  panel.querySelector('.control-panel-refresh').onclick = load;
  const inventoryToolbar = document.querySelector('.inventory-toolbar');
  if (inventoryToolbar) {
    const movementActions = document.createElement('div');
    movementActions.className = 'inventory-movement-actions';
    movementActions.innerHTML = '<input type="file" class="inventory-doc-input" accept="application/pdf,image/*" hidden><button type="button" class="inventory-new-btn" data-inventory-newtela title="Registrar una tela que todavía no existe en el inventario">+ TELA NUEVA</button><button type="button" class="inventory-doc-btn" data-inventory-doc title="Sube una nota de entrega en PDF o imagen">📎 SUBIR DOCUMENTO</button><button type="button" data-inventory-movement="INGRESO">INGRESO</button><button type="button" data-inventory-movement="SALIDA">SALIDA</button>';
    inventoryToolbar.appendChild(movementActions);
    const movementDialog = document.createElement('dialog');
    movementDialog.className = 'inventory-movement-dialog';
    movementDialog.innerHTML = '<form method="dialog" novalidate><button type="button" class="inventory-movement-close" aria-label="Cerrar">×</button><header class="im-head"><span class="im-badge">MOVIMIENTO</span><h2></h2><p class="im-sub"></p></header><div class="im-grid"><label class="im-wide">Nombre tela<input name="name" list="inventory-telas-list" autocomplete="off" required placeholder="Escribe para buscar la tela"><datalist id="inventory-telas-list"></datalist></label><label class="im-wide">Código<input name="code" autocomplete="off" inputmode="numeric" placeholder="Escribe el código y se completa el nombre"></label><div class="im-lines im-wide"><div class="im-lines-head"><span>MTS</span><span>Rollos</span><span></span></div><div class="im-line im-line-first"><input name="mts" data-mts type="number" inputmode="decimal" min="0" max="999999" step="0.01" required placeholder="0,00" aria-label="MTS"><div class="im-stepper"><button type="button" data-step="-1" aria-label="Menos un rollo">−</button><input name="rolls" data-rolls type="number" min="1" max="9999" step="1" value="1" required aria-label="Rollos"><button type="button" data-step="1" aria-label="Más un rollo">+</button></div><span></span><div data-line-bodega class="im-line-bodega im-chips" role="group" aria-label="Bodega de estos rollos"></div></div><button type="button" class="im-add" title="Agregar otra línea de MTS y rollos">+ Agregar otra línea</button></div></div><section class="inventory-movement-preview im-preview"><div class="im-prev-main"><small>RESUMEN</small><strong>Selecciona una tela</strong><span>1 rollo(s) · 0 MTS</span></div><div class="im-stock"><small>STOCK ACTUAL</small><b class="im-now">—</b></div><div class="im-stock im-after"><small>QUEDARÍA</small><b class="im-next">—</b></div></section><p class="inventory-movement-message" role="status"></p><div class="inventory-movement-form-actions"><button type="button" value="cancel">Cancelar</button><button type="submit" disabled>Guardar movimiento</button></div></form>';
    document.body.appendChild(movementDialog);
    const movementForm = movementDialog.querySelector('form'), nameSelect = movementForm.elements.name, codeInput = movementForm.elements.code, telaList = movementDialog.querySelector('#inventory-telas-list');
    let movementType = 'INGRESO';
    const movementItems = new Map(), fmtN = n => Number(n).toLocaleString('es-CO', {maximumFractionDigits: 2});
    const loadMovementNames = async () => { const response = await fetch('/api/inventarios', {cache:'no-store'}); const data = await response.json(); const allowed = new Set(['BODEGA TELA','RETAL CANASTAS']); movementItems.clear(); const list = (data.items || []).filter(item => allowed.has(String(item.categoria || '').toUpperCase())); list.forEach(item => { if (!movementItems.has(item.nombre)) movementItems.set(item.nombre, item); }); telaList.innerHTML = list.map(item => { const match = String(item.nombre || '').match(/^\s*\(([^)]+)\)\s*(.*)$/); return '<option value="' + esc(item.nombre) + '" label="' + esc(fmtN(item.total ?? item.mts ?? 0) + ' MTS') + '" data-code="' + esc(match ? match[1] : '') + '"></option>'; }).join(''); nameSelect.value = ''; codeInput.value = ''; movementForm.elements.rolls.value = '1'; };
    const normMov = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const resolveMovementItem = () => {
      const typed = nameSelect.value.trim();
      if (!typed) return {item: null, count: 0};
      const exact = movementItems.get(typed);
      if (exact) return {item: exact, count: 1};
      const query = normMov(typed);
      const codeMatch = [...movementItems.values()].filter(candidate => (normMov(candidate.nombre).match(/^\((\d+)\)/) || [])[1] === query);
      if (codeMatch.length === 1) return {item: codeMatch[0], count: 1};
      const found = [...movementItems.values()].filter(candidate => { const name = normMov(candidate.nombre), code = name.match(/^\((\d+)\)/); return name.includes(query) || (code && code[1] === query); });
      return {item: found.length === 1 ? found[0] : null, count: found.length};
    };
    const movementLines = () => [...movementForm.querySelectorAll('.im-line')].map(line => ({mts: Number(line.querySelector('[data-mts]').value || 0), rolls: Number(line.querySelector('[data-rolls]').value || 1), bodega: line.querySelector('[data-line-bodega] .im-chip.on')?.dataset.bodegaValue || ''}));
    const updateMovementPreview = () => {
      const preview = movementDialog.querySelector('.inventory-movement-preview'), submitButton = movementForm.querySelector('[type=submit]'), message = movementForm.querySelector('.inventory-movement-message');
      const {item, count} = resolveMovementItem(), lines = movementLines(), mts = lines.reduce((sum, line) => sum + line.mts, 0), rolls = lines.reduce((sum, line) => sum + line.rolls, 0);
      preview.querySelector('strong').textContent = item ? item.nombre : (nameSelect.value || 'Selecciona una tela'); if (item) codeInput.value = (String(item.nombre).match(/^\s*\(([^)]+)\)/) || [])[1] || ''; else if (document.activeElement !== codeInput) codeInput.value = '';
      preview.querySelector('.im-prev-main span').textContent = rolls + ' rollo(s) · ' + fmtN(mts) + ' MTS' + (lines.length > 1 ? ' · ' + lines.length + ' líneas' : '');
      const stock = item ? Number(item.total ?? item.mts ?? 0) : null, after = stock === null ? null : stock + (movementType === 'INGRESO' ? mts : -mts);
      preview.querySelector('.im-now').textContent = stock === null ? '—' : fmtN(stock) + ' MTS';
      const next = preview.querySelector('.im-next'); next.textContent = after === null ? '—' : fmtN(after) + ' MTS';
      const tooMuch = movementType === 'SALIDA' && stock !== null && mts > stock;
      next.classList.toggle('im-bad', tooMuch);
      const typed = nameSelect.value.trim();
      message.classList.toggle('im-error', tooMuch || (!!typed && !item));
      if (!movementForm.dataset.saving) message.textContent = tooMuch ? 'La salida supera el stock disponible (' + fmtN(stock) + ' MTS).' : (typed && !item ? (count > 1 ? count + ' telas coinciden: sigue escribiendo o elige una de la lista.' : 'No hay una tela con ese nombre.') : '');
      submitButton.disabled = !item || !lines.length || lines.some(line => !(line.mts > 0) || !(line.rolls >= 1)) || tooMuch;
    };
    codeInput.oninput = () => { const typed = codeInput.value.trim(), match = [...movementItems.values()].find(candidate => (String(candidate.nombre).match(/^\s*\(([^)]+)\)/) || [])[1] === typed); if (match) nameSelect.value = match.nombre; updateMovementPreview(); };
    nameSelect.oninput = updateMovementPreview;
    nameSelect.onchange = () => { const {item} = resolveMovementItem(); if (item) nameSelect.value = item.nombre; updateMovementPreview(); };
    movementForm.elements.mts.oninput = updateMovementPreview; movementForm.elements.rolls.oninput = updateMovementPreview;
    movementDialog.addEventListener('click', event => {
      if (event.target === movementDialog) { movementDialog.close(); return; }
      const step = event.target.closest('[data-step]');
      if (step) { const input = step.parentElement.querySelector('[data-rolls]'); input.value = Math.max(1, Math.min(9999, Number(input.value || 1) + Number(step.dataset.step))); updateMovementPreview(); return; }
      const remove = event.target.closest('.im-remove');
      if (remove) { remove.closest('.im-line').remove(); updateMovementPreview(); return; }
      if (event.target.closest('.im-add')) {
        const box = movementForm.querySelector('.im-lines');
        if (box.querySelectorAll('.im-line').length >= 20) return;
        const line = document.createElement('div');
        line.className = 'im-line';
        line.innerHTML = '<input data-mts type="number" inputmode="decimal" min="0" max="999999" step="0.01" placeholder="0,00" aria-label="MTS"><div class="im-stepper"><button type="button" data-step="-1" aria-label="Menos un rollo">−</button><input data-rolls type="number" min="1" max="9999" step="1" value="1" aria-label="Rollos"><button type="button" data-step="1" aria-label="Más un rollo">+</button></div><button type="button" class="im-remove" aria-label="Quitar línea" title="Quitar línea">×</button><div data-line-bodega class="im-line-bodega im-chips" role="group" aria-label="Bodega de estos rollos">' + bodegaChipsHtml('') + '</div>';
        box.insertBefore(line, box.querySelector('.im-add'));
        line.querySelector('[data-mts]').focus();
        updateMovementPreview();
      }
    });
    movementDialog.addEventListener('click', event => { const chip = event.target.closest('[data-line-bodega] .im-chip'); if (!chip) return; chip.parentElement.querySelectorAll('.im-chip').forEach(other => other.classList.toggle('on', other === chip)); });
    movementDialog.addEventListener('input', updateMovementPreview);
    movementActions.onclick = async event => { const button = event.target.closest('[data-inventory-movement]'); if (!button) return; movementType = button.dataset.inventoryMovement; movementDialog.dataset.type = movementType; movementForm.reset(); movementForm.querySelectorAll('.im-line:not(.im-line-first)').forEach(line => line.remove()); delete movementForm.dataset.saving; movementForm.querySelector('h2').textContent = movementType === 'INGRESO' ? 'Ingreso de tela' : 'Salida de tela'; movementForm.querySelector('.im-sub').textContent = movementType === 'INGRESO' ? 'Suma metros y rollos al inventario de la bodega.' : 'Resta metros y rollos del inventario de la bodega.'; movementForm.querySelector('.inventory-movement-message').textContent = 'Cargando telas…'; try { await loadBodegaOptions(); movementForm.querySelectorAll('[data-line-bodega]').forEach(box => { box.innerHTML = bodegaChipsHtml(''); }); await loadMovementNames(); movementDialog.showModal(); updateMovementPreview(); setTimeout(() => nameSelect.focus(), 50); } catch (_) { movementForm.querySelector('.inventory-movement-message').textContent = 'No se pudieron cargar las telas.'; movementDialog.showModal(); } };
    movementDialog.querySelector('.inventory-movement-close').onclick = () => movementDialog.close();
    movementForm.querySelector('[value="cancel"]').onclick = () => movementDialog.close();
    movementForm.onsubmit = async event => { event.preventDefault(); movementForm.dataset.saving = '1'; const message = movementForm.querySelector('.inventory-movement-message'), name = resolveMovementItem().item?.nombre || nameSelect.value, code = codeInput.value; message.classList.remove('im-error'); message.textContent = 'Guardando…'; try { for (const line of movementLines()) { const response = await fetch('/api/inventarios/movimiento', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, code, type:movementType, mts:line.mts, rolls:line.rolls, bodega: movementType === 'INGRESO' ? line.bodega : ''})}); const body = await response.json().catch(() => ({})); if (!response.ok) throw Error(body.detail || 'No se pudo guardar el movimiento.'); } message.textContent = 'Movimiento registrado correctamente.'; setTimeout(() => { movementDialog.close(); location.reload(); }, 700); } catch (error) { delete movementForm.dataset.saving; message.classList.add('im-error'); message.textContent = error.message; } };
    const movementStyle = document.createElement('style'); movementStyle.textContent = '.inventory-movement-actions{display:flex;gap:8px;margin-left:auto}.inventory-movement-actions button{width:auto;padding:9px 14px;border:1px solid #718c4a;border-radius:9px;background:#26351d;color:#e8f8c8;font-weight:900}.inventory-movement-actions button:last-child{border-color:#a45c58;background:#3b211f;color:#ffd0cc}.inventory-movement-dialog{--im:#d0f44c;box-sizing:border-box;width:min(720px,94vw);max-width:none;max-height:92vh;margin:auto;padding:0;border:1px solid #3f553d;border-radius:22px;background:linear-gradient(160deg,#18231a,#0f160f);color:#f1f7ec;box-shadow:0 30px 80px #000c;overflow:auto}.inventory-movement-dialog[data-type=SALIDA]{--im:#ff7a70;border-color:#6b3a36}.inventory-movement-dialog::backdrop{background:#000b;backdrop-filter:blur(3px)}.inventory-movement-dialog form{display:grid;gap:18px;box-sizing:border-box;padding:30px 32px 26px}.im-head{display:grid;gap:6px;padding-right:44px}.im-badge{justify-self:start;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--im) 18%,transparent);border:1px solid var(--im);color:var(--im);font:800 10px Arial;letter-spacing:.12em}.inventory-movement-dialog h2{margin:0;font-size:clamp(24px,3vw,32px)}.im-sub{margin:0;color:#a9b8a3;font-size:13px}.im-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.im-wide{grid-column:1/-1}.inventory-movement-dialog label{display:grid;gap:7px;padding:13px 14px;border:1px solid #344934;border-radius:12px;background:#101811;color:#b8c7b1;font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase}.inventory-movement-dialog label:focus-within{border-color:var(--im);box-shadow:0 0 0 3px color-mix(in srgb,var(--im) 22%,transparent)}.inventory-movement-dialog input{padding:13px;border:1px solid #4f6545;border-radius:9px;background:#202d22;color:#fff;font:16px Arial;min-width:0;width:100%;box-sizing:border-box}.inventory-movement-dialog input:focus{outline:none;border-color:var(--im)}.inventory-movement-dialog input[readonly]{opacity:.7}.im-stepper{display:grid;grid-template-columns:52px 1fr 52px;gap:8px}.im-stepper button{border:1px solid #4f6545;border-radius:9px;background:#26351d;color:#fff;font:700 22px Arial;cursor:pointer}.im-stepper button:hover{border-color:var(--im);color:var(--im)}.im-stepper input{text-align:center;font-weight:700}.im-lines{display:grid;gap:8px;padding:13px 14px;border:1px solid #344934;border-radius:12px;background:#101811}.im-lines-head,.im-line{display:grid;grid-template-columns:1fr 1.3fr 40px;gap:8px;align-items:stretch}.im-lines-head span{color:#b8c7b1;font:800 11px Arial;letter-spacing:.06em;text-transform:uppercase}.im-line .im-stepper{grid-template-columns:44px 1fr 44px}.im-line-bodega{grid-column:1/-1}dialog[data-type="SALIDA"] .im-line-bodega{display:none}.im-remove{border:1px solid #6b3a36;border-radius:9px;background:#3b211f;color:#ffd0cc;cursor:pointer;font:700 20px Arial}.im-remove:hover{background:#5a2a27}.im-add{justify-self:start;margin-top:2px;padding:10px 16px;border:1px dashed var(--im);border-radius:10px;background:color-mix(in srgb,var(--im) 10%,transparent);color:var(--im);font:800 13px Arial;cursor:pointer}.im-add:hover{background:color-mix(in srgb,var(--im) 20%,transparent)}.im-preview{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:12px;padding:14px;border:1px solid #344934;border-radius:14px;background:#0d140e}.im-preview small{display:block;color:#8fa088;font:800 10px Arial;letter-spacing:.1em}.im-prev-main strong{display:block;margin:5px 0 3px;font-size:15px;overflow-wrap:anywhere}.im-prev-main span{color:#a9b8a3;font-size:12px}.im-stock{padding:4px 12px;border-left:1px solid #2a3a2b}.im-stock b{display:block;margin-top:6px;font:800 20px Arial;color:#f1f7ec}.im-after b{color:var(--im)}.im-after b.im-bad{color:#ff6b6b}.inventory-movement-close{position:absolute;top:18px;right:18px;width:38px!important;min-height:38px;padding:4px!important;background:#29352b!important;color:#fff;border:1px solid #66775f!important;border-radius:9px;cursor:pointer}.inventory-movement-form-actions{display:flex;justify-content:flex-end;gap:10px}.inventory-movement-form-actions button{width:auto;padding:13px 22px;border:1px solid #64795b;border-radius:10px;background:#293629;color:#fff;font-weight:800;cursor:pointer}.inventory-movement-form-actions button[type=submit]{background:var(--im);border-color:var(--im);color:#17210f}.inventory-movement-form-actions button[type=submit]:disabled{opacity:.35;cursor:not-allowed}.inventory-movement-message{min-height:18px;margin:0;color:var(--im);font-size:13px}.inventory-movement-message.im-error{color:#ff8a80}@media(max-width:600px){.inventory-toolbar .inventory-movement-actions{margin-top:10px}.inventory-movement-actions{width:100%}.inventory-movement-actions button{flex:1}.inventory-movement-dialog{width:100vw;max-height:100vh;border-radius:0}.inventory-movement-dialog form{padding:26px 18px 22px}.im-grid{grid-template-columns:1fr}.im-preview{grid-template-columns:1fr 1fr}.im-prev-main{grid-column:1/-1}.im-stock:first-of-type{border-left:0}.inventory-movement-form-actions{flex-direction:column-reverse}.inventory-movement-form-actions button{width:100%}}'; document.head.appendChild(movementStyle);
    const newDialog = document.createElement('dialog');
    newDialog.className = 'inventory-movement-dialog inventory-new-dialog';
    newDialog.dataset.type = 'INGRESO';
    newDialog.innerHTML = '<form method="dialog" novalidate><button type="button" class="inventory-movement-close" aria-label="Cerrar">×</button><header class="im-head"><span class="im-badge">TELA NUEVA</span><h2>Registrar tela nueva</h2><p class="im-sub">Crea la tela en Stock tela. Si quieres, registra también su primer ingreso.</p></header><div class="im-grid"><label>Código<input name="codigo" autocomplete="off" required maxlength="12" placeholder="Ej. 1250"></label><label>Nombre de la tela<input name="nombre" autocomplete="off" required maxlength="80" placeholder="Ej. MONTECATINI VERDE" style="text-transform:uppercase"></label></div><section class="im-new-initial"><small>INGRESO INICIAL (OPCIONAL)</small><div class="im-grid"><label>MTS<input name="mts" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00"></label><label>Rollos<input name="rolls" type="number" min="1" max="9999" step="1" value="1"></label></div></section><section class="inventory-movement-preview im-preview im-new-preview"><div class="im-prev-main"><small>SE CREARÁ COMO</small><strong>(código) NOMBRE</strong><span></span></div></section><p class="inventory-movement-message" role="status"></p><div class="inventory-movement-form-actions"><button type="button" value="cancel">Cancelar</button><button type="submit" disabled>Registrar tela</button></div></form>';
    document.body.appendChild(newDialog);
    const newForm = newDialog.querySelector('form'), newMessage = newForm.querySelector('.inventory-movement-message'), newSubmit = newForm.querySelector('[type=submit]');
    const updateNewFabric = () => {
      const code = newForm.elements.codigo.value.trim(), name = newForm.elements.nombre.value.trim().replace(/\s+/g, ' ').toUpperCase(), mts = Number(newForm.elements.mts.value || 0), rolls = Number(newForm.elements.rolls.value || 1);
      newForm.querySelector('.im-new-preview strong').textContent = '(' + (code || 'código') + ') ' + (name || 'NOMBRE');
      newForm.querySelector('.im-new-preview .im-prev-main span').textContent = mts > 0 ? 'Con ingreso inicial: ' + rolls + ' rollo(s) · ' + fmtN(mts) + ' MTS' : 'Sin ingreso inicial (0 MTS)';
      const names = [...movementItems.keys()];
      const sameCode = names.find(item => (item.match(/^\s*\(([^)]+)\)/) || [])[1] === code);
      const sameName = names.find(item => normMov(item.replace(/^\s*\([^)]*\)\s*/, '')) === normMov(name));
      let problem = '';
      if (code && !/^[A-Za-z0-9-]+$/.test(code)) problem = 'El código solo puede tener letras, números o guion.';
      else if (code && sameCode) problem = 'El código ' + code + ' ya existe: ' + sameCode;
      else if (name && sameName) problem = 'Ya existe una tela con ese nombre: ' + sameName;
      newMessage.classList.toggle('im-error', !!problem);
      if (!newForm.dataset.saving) newMessage.textContent = problem;
      newSubmit.disabled = !!problem || !code || name.length < 2 || (mts > 0 && !(rolls >= 1));
    };
    newDialog.addEventListener('input', updateNewFabric);
    newDialog.addEventListener('click', event => { if (event.target === newDialog) newDialog.close(); });
    newDialog.querySelector('.inventory-movement-close').onclick = () => newDialog.close();
    newForm.querySelector('[value="cancel"]').onclick = () => newDialog.close();
    movementActions.addEventListener('click', async event => {
      if (!event.target.closest('[data-inventory-newtela]')) return;
      newForm.reset(); delete newForm.dataset.saving; newMessage.classList.remove('im-error'); newMessage.textContent = 'Cargando telas…'; newSubmit.disabled = true;
      newDialog.showModal();
      try { await loadMovementNames(); newMessage.textContent = ''; } catch (_) { newMessage.textContent = 'No se pudo comprobar si la tela ya existe.'; }
      updateNewFabric();
      setTimeout(() => newForm.elements.codigo.focus(), 50);
    });
    newForm.onsubmit = async event => {
      event.preventDefault();
      if (newSubmit.disabled) return;
      newForm.dataset.saving = '1'; newSubmit.disabled = true; newMessage.classList.remove('im-error'); newMessage.textContent = 'Registrando tela…';
      const codigo = newForm.elements.codigo.value.trim(), nombre = newForm.elements.nombre.value.trim().replace(/\s+/g, ' ').toUpperCase(), mts = Number(newForm.elements.mts.value || 0), rolls = Number(newForm.elements.rolls.value || 1);
      try {
        const response = await fetch('/api/inventarios/tela', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({codigo, nombre})});
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(typeof body.detail === 'string' ? body.detail : 'No se pudo registrar la tela.');
        if (mts > 0) {
          const move = await fetch('/api/inventarios/movimiento', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: body.nombre, code: codigo, type: 'INGRESO', mts, rolls})});
          if (!move.ok) throw Error('La tela se creó, pero no se pudo registrar el ingreso inicial. Regístralo con INGRESO.');
        }
        newMessage.textContent = '✓ Tela registrada: ' + body.nombre;
        setTimeout(() => { newDialog.close(); location.reload(); }, 900);
      } catch (error) { delete newForm.dataset.saving; newMessage.classList.add('im-error'); newMessage.textContent = error.message; updateNewFabric(); }
    };
    const newStyle = document.createElement('style');
    newStyle.textContent = '.inventory-movement-actions .inventory-new-btn{border-color:#d0f44c;background:#1f2b12;color:#d0f44c}.im-new-initial{display:grid;gap:8px}.im-new-initial small{color:#8fa088;font:800 10px Arial;letter-spacing:.1em}@media(max-width:600px){.inventory-movement-actions .inventory-new-btn{flex-basis:100%}}';
    document.head.appendChild(newStyle);
    const docDialog = document.createElement('dialog');
    docDialog.className = 'inventory-movement-dialog inventory-doc-dialog';
    docDialog.dataset.type = 'INGRESO';
    docDialog.innerHTML = '<form method="dialog" novalidate><button type="button" class="inventory-movement-close" aria-label="Cerrar">×</button><header class="im-head"><span class="im-badge">INGRESO DESDE DOCUMENTO</span><h2>Revisa el documento</h2><p class="im-sub"></p></header><section class="im-doc-detect"></section><div class="im-doc-body"></div><section class="im-doc-total"></section><p class="inventory-movement-message" role="status"></p><div class="inventory-movement-form-actions"><button type="button" value="cancel">Cancelar</button><button type="submit" disabled>Registrar ingreso</button></div></form>';
    document.body.appendChild(docDialog);
    const docForm = docDialog.querySelector('form'), docBody = docDialog.querySelector('.im-doc-body'), docTotal = docDialog.querySelector('.im-doc-total'), docDetect = docDialog.querySelector('.im-doc-detect'), docMessage = docDialog.querySelector('.inventory-movement-message'), docSubmit = docForm.querySelector('[type=submit]'), docInput = movementActions.querySelector('.inventory-doc-input');
    let docState = null;
    let bodegaNames = [];
    const loadBodegaOptions = async () => { try { const response = await fetch('/api/inventarios/bodegas', {cache: 'no-store'}); const data = await response.json(); bodegaNames = data.bodegas || []; } catch (error) { bodegaNames = bodegaNames.length ? bodegaNames : ['BODEGA INDOOR']; } };
    loadBodegaOptions();
    const rollBodega = (line, r) => (line.bodegas && line.bodegas[r]) || line.bodega || defaultBodega();
    const defaultBodega = () => bodegaNames.includes('BODEGA INDOOR') ? 'BODEGA INDOOR' : (bodegaNames[0] || '');
    const BODEGA_COLORS = {'BODEGA GLORIA': ['#dde9f5', '#12335c', '#8fb3d9'], 'BODEGA CASA': ['#fff2cc', '#5a4500', '#e0c060'], 'BODEGA SEGUNDO PISO': ['#d9d2e9', '#3b2a63', '#a593cf'], 'BODEGA INDOOR': ['#26351d', '#d0f44c', '#718c4a']};
    const bodegaStyle = name => { const c = BODEGA_COLORS[name] || ['#26351d', '#d0f44c', '#718c4a']; return '--c-bg:' + c[0] + ';--c-fg:' + c[1] + ';--c-bd:' + c[2]; };
    const bodegaShort = name => String(name).replace(/^BODEGA /, '');
    const bodegaChipsHtml = selected => bodegaNames.map(name => '<button type="button" class="im-chip' + (name === (selected || defaultBodega()) ? ' on' : '') + '" data-bodega-value="' + esc(name) + '" style="' + bodegaStyle(name) + '">' + esc(bodegaShort(name)) + '</button>').join('');
    const docSum = line => line.rollos.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const docOptions = () => [...movementItems.values()].map(item => '<option value="' + esc(item.nombre) + '"></option>').join('');
    const resolveDocTela = text => { const typed = String(text || '').trim(); if (!typed) return null; const exact = movementItems.get(typed); if (exact) return exact; const query = normMov(typed), found = [...movementItems.values()].filter(item => normMov(item.nombre).includes(query)); return found.length === 1 ? found[0] : null; };
    const updateDoc = () => {
      if (!docState) return;
      let totalMts = 0, totalRolls = 0, problem = '';
      docState.lineas.forEach((line, lineIndex) => {
        const sum = docSum(line), box = docBody.querySelector('[data-doc-sum="' + lineIndex + '"]');
        if (box) box.textContent = fmtN(sum) + ' MTS · ' + line.rollos.length + ' rollo(s)' + (line.esperado ? (Math.abs(sum - line.esperado) < 0.5 ? ' · ✓ coincide con el subtotal del documento (' + fmtN(line.esperado) + ')' : ' · ⚠ el documento dice ' + fmtN(line.esperado) + ' MTS: revisa los rollos') : '');
        totalMts += sum; totalRolls += line.rollos.length;
        const hint = docBody.querySelector('[data-doc-hint="' + lineIndex + '"]');
        if (hint) { const typed = String(line.telaText ?? line.tela ?? '').trim(); hint.textContent = line.tela ? '✓ Tela del inventario' : (typed ? 'No coincide con una tela del inventario: elige una de la lista.' : 'Escribe o elige una tela de la lista.'); hint.className = 'im-doc-hint ' + (line.tela ? 'im-hint-ok' : 'im-hint-bad'); }
        if (!line.tela) problem = problem || 'Elige la tela del inventario en cada línea.';
        if (!line.rollos.length) problem = problem || 'Hay una tela sin rollos.';
        if (line.rollos.some(value => !(Number(value) > 0))) problem = problem || 'Hay rollos sin metros: completa o quita esos rollos.';
      });
      docDetect.innerHTML = '<small>DETECTADO EN EL DOCUMENTO</small><table><thead><tr><th>TELA</th><th>CANTIDAD</th><th>ROLLOS</th></tr></thead><tbody>' + docState.lineas.map(line => '<tr><td>' + esc(line.referencia || line.descripcion) + (line.referencia && line.descripcion ? '<em>' + esc(line.descripcion) + '</em>' : '') + '</td><td>' + fmtN(docSum(line)) + ' MTS</td><td>' + line.rollos.length + '<em>' + line.rollos.map(value => fmtN(Number(value) || 0)).join(' · ') + '</em></td></tr>').join('') + '</tbody></table>';
      const expected = docState.total_documento;
      let check = '';
      if (expected) check = Math.abs(totalMts - expected) < 0.5 ? '<span class="im-ok">✓ Coincide con el total del documento (' + fmtN(expected) + ' MTS)</span>' : '<span class="im-warn">⚠ La suma (' + fmtN(totalMts) + ' MTS) no coincide con el total del documento (' + fmtN(expected) + ' MTS). Revisa los rollos.</span>';
      docTotal.innerHTML = '<div><small>TOTAL A INGRESAR</small><strong>' + fmtN(totalMts) + ' MTS</strong><span>' + totalRolls + ' rollo(s) · ' + docState.lineas.length + ' tela(s)</span></div><div>' + check + '</div>';
      if (docState.duplicado) problem = 'Este documento ya fue registrado el ' + new Date(docState.duplicado.fecha).toLocaleDateString('es-CO') + '.';
      docMessage.classList.toggle('im-error', !!problem);
      if (!docForm.dataset.saving) docMessage.textContent = problem;
      docSubmit.disabled = !!problem || !docState.lineas.length || totalMts <= 0;
    };
    const docTabLabel = line => { const name = String(line.descripcion || '').replace(/\s*\(.*$/, '').trim(), color = (String(line.descripcion || '').match(/\(([^)]+)\)/) || [])[1] || '', word = color.split(/\s+/).pop() === 'NIEVE' ? color.split(/\s+/)[0] : color.split(/\s+/).pop(); return (name + (word ? ' · ' + word : '')).slice(0, 26) || 'Tela'; };
    const docTabsHtml = () => '<div class="im-tabs"><span class="im-tabs-tit" data-doc-tit></span><span class="im-tabs-pills">' + docState.lineas.map((line, i) => '<button type="button" class="im-pill" data-doc-tab="' + i + '">' + esc(docTabLabel(line)) + '</button>').join('') + '</span><span class="im-tabs-arrows"><button type="button" class="im-arrow" data-doc-step="-1" aria-label="Tela anterior">‹</button><button type="button" class="im-arrow" data-doc-step="1" aria-label="Tela siguiente">›</button></span></div>';
    const setDocActive = index => {
      if (!docState) return;
      docState.activa = index;
      docBody.querySelectorAll('.im-doc-line').forEach((section, i) => section.classList.toggle('im-activa', i === index));
      docBody.querySelectorAll('[data-doc-tab]').forEach((button, i) => button.classList.toggle('on', i === index));
      const title = docBody.querySelector('[data-doc-tit]'); if (title) title.textContent = 'TELA ' + (index + 1) + ' · ' + (index + 1) + '/' + docState.lineas.length;
    };
    const renderDoc = () => {
      docDialog.classList.add('im-ancho');
      docBody.innerHTML = '<datalist id="im-doc-telas">' + docOptions() + '</datalist>' + docState.lineas.map((line, lineIndex) => '<section class="im-doc-line"><div class="im-doc-head"><div><strong>' + esc(line.descripcion) + '</strong><small>' + esc(line.referencia || '') + '</small></div><button type="button" class="im-remove" data-doc-del="' + lineIndex + '" title="Quitar esta tela" aria-label="Quitar esta tela">×</button></div><label>Tela del inventario<input type="text" list="im-doc-telas" autocomplete="off" spellcheck="false" data-doc-tela="' + lineIndex + '" value="' + esc(line.telaText ?? line.tela) + '" placeholder="Escribe o pega el nombre de la tela"><small class="im-doc-hint" data-doc-hint="' + lineIndex + '"></small></label><div class="im-doc-bodega"><span>Bodega de todos los rollos</span><div class="im-chips" data-doc-bodega="' + lineIndex + '">' + bodegaChipsHtml(line.bodega) + '</div></div><div class="im-doc-rolls">' + line.rollos.map((value, rollIndex) => '<span class="im-doc-roll"><input type="number" inputmode="decimal" min="0" step="0.01" data-doc-roll="' + lineIndex + ':' + rollIndex + '" value="' + (value ?? '') + '" aria-label="Metros del rollo ' + (rollIndex + 1) + '"><button type="button" class="im-roll-bodega" data-doc-roll-bodega="' + lineIndex + ':' + rollIndex + '" style="' + bodegaStyle(rollBodega(line, rollIndex)) + '" title="Toca para cambiar la bodega de este rollo" aria-label="Bodega del rollo ' + (rollIndex + 1) + '">' + esc(bodegaShort(rollBodega(line, rollIndex))) + '</button><button type="button" data-doc-roll-del="' + lineIndex + ':' + rollIndex + '" aria-label="Quitar rollo">×</button></span>').join('') + '<button type="button" class="im-add im-add-roll" data-doc-roll-add="' + lineIndex + '">+ Rollo</button></div><div class="im-doc-sum" data-doc-sum="' + lineIndex + '"></div></section>').join('') || '<p class="im-sub">No se encontraron telas en el documento.</p>';
      if (docState.lineas.length > 1) { docBody.dataset.multi = '1'; docBody.insertAdjacentHTML('afterbegin', docTabsHtml()); setDocActive(Math.min(docState.activa || 0, docState.lineas.length - 1)); }
      else { delete docBody.dataset.multi; }
      updateDoc();
    };
    docDialog.addEventListener('click', event => {
      const tabBtn = event.target.closest?.('[data-doc-tab]'), step = event.target.closest?.('[data-doc-step]');
      if (tabBtn) { setDocActive(Number(tabBtn.dataset.docTab)); return; }
      if (step && docState) { const n = docState.lineas.length; setDocActive((((docState.activa || 0) + Number(step.dataset.docStep)) % n + n) % n); return; }
      if (event.target === docDialog) { docDialog.close(); return; }
      const groupChip = event.target.closest('[data-doc-bodega] .im-chip'), rollBodegaBtn = event.target.closest('[data-doc-roll-bodega]');
      if (groupChip && docState) { const line = docState.lineas[Number(groupChip.parentElement.dataset.docBodega)]; line.bodega = groupChip.dataset.bodegaValue; line.bodegas = []; renderDoc(); return; }
      if (rollBodegaBtn && docState) { const [l, r] = rollBodegaBtn.dataset.docRollBodega.split(':').map(Number), line = docState.lineas[l], at = Math.max(0, bodegaNames.indexOf(rollBodega(line, r))); (line.bodegas = line.bodegas || [])[r] = bodegaNames[(at + 1) % bodegaNames.length]; renderDoc(); return; }
      const del = event.target.closest('[data-doc-del]'), rollDel = event.target.closest('[data-doc-roll-del]'), rollAdd = event.target.closest('[data-doc-roll-add]');
      if (del) { docState.lineas.splice(Number(del.dataset.docDel), 1); renderDoc(); }
      else if (rollDel) { const [l, r] = rollDel.dataset.docRollDel.split(':').map(Number); docState.lineas[l].rollos.splice(r, 1); if (docState.lineas[l].bodegas) docState.lineas[l].bodegas.splice(r, 1); renderDoc(); }
      else if (rollAdd) { docState.lineas[Number(rollAdd.dataset.docRollAdd)].rollos.push(''); renderDoc(); }
    });
    docDialog.addEventListener('input', event => {
      const roll = event.target.closest('[data-doc-roll]');
      if (roll) { const [l, r] = roll.dataset.docRoll.split(':').map(Number); docState.lineas[l].rollos[r] = roll.value; updateDoc(); return; }
      const tela = event.target.closest('[data-doc-tela]');
      if (tela) { const line = docState.lineas[Number(tela.dataset.docTela)]; line.telaText = tela.value; line.tela = resolveDocTela(tela.value)?.nombre || ''; updateDoc(); }
    });
    docDialog.addEventListener('change', event => {
      const tela = event.target.closest('[data-doc-tela]');
      if (!tela) return;
      const line = docState.lineas[Number(tela.dataset.docTela)], item = resolveDocTela(tela.value);
      if (item) { tela.value = item.nombre; line.telaText = item.nombre; line.tela = item.nombre; }
      updateDoc();
    });
    docDialog.querySelector('.inventory-movement-close').onclick = () => docDialog.close();
    docForm.querySelector('[value="cancel"]').onclick = () => docDialog.close();
    const processDocFile = async file => {
      if (!(file.type === 'application/pdf' || file.type.startsWith('image/') || /[.](pdf|png|jpe?g|webp)$/i.test(file.name))) {
        docMessage.classList.add('im-error'); docMessage.textContent = 'Sube un PDF o una imagen (JPG, PNG).'; return;
      }
      docState = null; delete docForm.dataset.saving; docDialog.classList.remove('im-ancho');
      docBody.innerHTML = '<div class="im-doc-loading"><span class="im-spinner"></span><p>Leyendo el documento… puede tardar hasta 30 segundos.</p></div>';
      docTotal.innerHTML = ''; docMessage.textContent = ''; docMessage.classList.remove('im-error'); docSubmit.disabled = true;
      docForm.querySelector('.im-sub').textContent = file.name;
      if (!docDialog.open) docDialog.showModal();
      try {
        await loadMovementNames();
        const form = new FormData(); form.append('file', file); form.append('formato', docFormat);
        const response = await fetch('/api/inventarios/documento', {method: 'POST', body: form});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(data.detail || 'No se pudo leer el documento.');
        docState = {hash: data.hash, nombre: data.nombre, total_documento: data.total_documento, duplicado: data.duplicado, proveedor: data.proveedor, fecha: data.fecha,
          lineas: (data.lineas || []).map(line => ({descripcion: line.descripcion, referencia: line.referencia, esperado: line.total_esperado, rollos: line.rollos.map(roll => roll.mts), tela: (line.sugerencias?.[0]?.score >= 1 && movementItems.has(line.sugerencias[0].nombre)) ? line.sugerencias[0].nombre : '', telaText: undefined}))};
        docForm.querySelector('.im-sub').textContent = [file.name, data.proveedor, data.fecha].filter(Boolean).join(' · ');
        renderDoc();
      } catch (error) {
        docBody.innerHTML = '<p class="im-sub">' + esc(error.message) + '</p>';
        docMessage.classList.add('im-error'); docMessage.textContent = 'No se pudo procesar el documento. Puedes cargar los datos manualmente con INGRESO.';
      }
    };
    let docFormats = [{id: 'lindatextil', nombre: 'Lindatextil', disponible: true, ayuda: ''}], docFormat = 'lindatextil';
    try { docFormat = localStorage.getItem('inv_doc_formato') || 'lindatextil'; } catch (error) { /* sin almacenamiento */ }
    fetch('/api/inventarios/documento/formatos', {cache: 'no-store', credentials: 'same-origin'}).then(r => r.ok ? r.json() : null).then(d => { if (d && d.formatos && d.formatos.length) docFormats = d.formatos; }).catch(() => {});
    const formatPickerMarkup = () => {
      const current = docFormats.find(f => f.id === docFormat && f.disponible) || docFormats.find(f => f.disponible) || docFormats[0];
      docFormat = current.id;
      return '<label class="im-format">Formato del proveedor<select data-doc-format>' + docFormats.map(f => '<option value="' + esc(f.id) + '"' + (f.id === current.id ? ' selected' : '') + (f.disponible ? '' : ' disabled') + '>' + esc(f.nombre) + '</option>').join('') + '</select><small>' + esc(current.ayuda || '') + '</small></label>';
    };
    const dropzoneHtml = () => formatPickerMarkup() + dropzoneMarkup;
    const dropzoneMarkup = '<div class="im-dropzone" tabindex="0" role="button" aria-label="Seleccionar documento"><span class="im-drop-icon">⇧</span><strong>Arrastra el documento aquí</strong><small>o haz clic para seleccionar · PDF, JPG o PNG</small></div>';
    const openDocDialog = () => {
      docState = null; delete docForm.dataset.saving; docInput.value = ''; docDialog.classList.remove('im-ancho');
      docBody.innerHTML = dropzoneHtml(); docDetect.innerHTML = ''; docTotal.innerHTML = '';
      docMessage.textContent = ''; docMessage.classList.remove('im-error'); docSubmit.disabled = true;
      docForm.querySelector('.im-sub').textContent = 'Sube la nota de entrega del proveedor y se leerán la tela, los metros y los rollos.';
      docDialog.showModal();
    };
    movementActions.addEventListener('click', event => { if (event.target.closest('[data-inventory-doc]')) openDocDialog(); });
    docDialog.addEventListener('change', event => {
      const picker = event.target.closest?.('[data-doc-format]');
      if (!picker) return;
      docFormat = picker.value;
      try { localStorage.setItem('inv_doc_formato', docFormat); } catch (error) { /* sin almacenamiento */ }
      const current = docFormats.find(f => f.id === docFormat);
      const hint = picker.parentElement.querySelector('small'); if (hint) hint.textContent = current ? (current.ayuda || '') : '';
    });
    docInput.onchange = () => { if (docInput.files[0]) processDocFile(docInput.files[0]); };
    docDialog.addEventListener('click', event => { if (event.target.closest('.im-dropzone')) { docInput.value = ''; docInput.click(); } });
    docDialog.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('.im-dropzone')) { event.preventDefault(); docInput.value = ''; docInput.click(); } });
    docDialog.addEventListener('dragover', event => { const zone = event.target.closest('.im-dropzone'); if (zone) { event.preventDefault(); zone.classList.add('im-over'); } });
    docDialog.addEventListener('dragleave', event => { event.target.closest?.('.im-dropzone')?.classList.remove('im-over'); });
    docDialog.addEventListener('drop', event => { const zone = event.target.closest('.im-dropzone'); if (!zone) return; event.preventDefault(); zone.classList.remove('im-over'); if (event.dataTransfer.files[0]) processDocFile(event.dataTransfer.files[0]); });
    docForm.onsubmit = async event => {
      event.preventDefault();
      if (!docState || docSubmit.disabled) return;
      docForm.dataset.saving = '1'; docSubmit.disabled = true; docMessage.classList.remove('im-error'); docMessage.textContent = 'Registrando ingreso…';
      const movements = [];
      docState.lineas.forEach(line => line.rollos.forEach((value, rollIndex) => { const code = (String(line.tela).match(/^\s*\(([^)]+)\)/) || [])[1] || ''; movements.push({name: line.tela, code, type: 'INGRESO', mts: Number(value), rolls: 1, bodega: rollBodega(line, rollIndex)}); }));
      try {
        const response = await fetch('/api/inventarios/movimientos', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({movements, doc_hash: docState.hash, doc_name: docState.nombre})});
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(body.detail || 'No se pudo registrar el ingreso.');
        docMessage.textContent = '✓ Ingreso registrado: ' + movements.length + ' rollo(s).';
        setTimeout(() => { docDialog.close(); location.reload(); }, 900);
      } catch (error) { delete docForm.dataset.saving; docMessage.classList.add('im-error'); docMessage.textContent = error.message; updateDoc(); }
    };
    const docStyle = document.createElement('style');
    docStyle.textContent = '.inventory-doc-dialog.im-ancho{width:98vw;max-height:97vh}.inventory-doc-dialog.im-ancho .im-doc-body{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}@media(max-width:1000px){.inventory-doc-dialog.im-ancho .im-doc-body{grid-template-columns:minmax(0,1fr)}}.inventory-doc-dialog.im-ancho .im-doc-detect table{width:100%}.inventory-doc-dialog.im-ancho .im-doc-detect td em{display:none}.inventory-doc-dialog.im-ancho .im-doc-detect td{padding:5px 8px}.inventory-doc-dialog.im-ancho .im-doc-body{gap:10px}.inventory-doc-dialog.im-ancho .im-doc-line{padding:10px;gap:7px}.inventory-doc-dialog.im-ancho .im-doc-rolls{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:5px}.inventory-doc-dialog.im-ancho .im-doc-roll{display:flex}.inventory-doc-dialog.im-ancho .im-doc-roll input{width:100%!important;min-width:0;flex:1 1 auto;padding:6px 4px!important;font-size:13px!important}.inventory-doc-dialog.im-ancho .im-doc-roll button.im-roll-bodega{min-width:0;padding:0 4px;font-size:8px}.inventory-doc-dialog.im-ancho .im-doc-roll button:not(.im-roll-bodega){width:22px}.inventory-doc-dialog.im-ancho .im-add-roll{grid-column:1/-1}.inventory-doc-dialog.im-ancho .im-doc-detect{display:none}.im-tabs{display:none;grid-column:1/-1;align-items:center;gap:10px;flex-wrap:wrap;padding-right:46px}.im-tabs-tit{padding:7px 14px;border-radius:999px;background:#2b3326;color:#d7ff3a;font:800 12px Arial;letter-spacing:.08em}.im-tabs-pills{display:flex;gap:6px;flex-wrap:wrap;flex:1}.im-tabs .im-pill{width:auto;min-height:0;padding:7px 14px;border:1px solid #4f6545;border-radius:999px;background:#1a2218;color:#e9f1e3;font:800 12px Arial;cursor:pointer}.im-tabs .im-pill.on{background:#0c0f0b;border-color:#d7ff3a;color:#d7ff3a}.im-tabs .im-arrow{width:36px;min-height:0;height:36px;padding:0;border:0;border-radius:50%;background:#2a2f27;color:#fff;font:700 20px Arial;cursor:pointer}@media(max-width:1000px){.im-doc-body[data-multi] .im-tabs{display:flex}.im-doc-body[data-multi] .im-doc-line:not(.im-activa){display:none}}.inventory-doc-dialog.im-ancho .im-doc-roll input,.inventory-doc-dialog.im-ancho .im-doc-roll button{height:30px!important;min-height:30px!important;padding-top:0!important;padding-bottom:0!important;line-height:30px}.inventory-doc-dialog.im-ancho .im-add-roll{height:30px!important;min-height:30px!important;padding:0!important}.inventory-doc-dialog.im-ancho .im-doc-line label input{height:36px!important;min-height:36px!important;padding-top:0!important;padding-bottom:0!important}.inventory-doc-dialog.im-ancho .im-doc-bodega{padding:6px 10px}.im-format{display:grid;gap:6px;margin-bottom:14px;font:800 11px Arial;letter-spacing:.08em;text-transform:uppercase;color:#aebba7}.im-format select{min-height:42px;padding:0 12px;border:1px solid #34432f;border-radius:10px;background:#101710;color:inherit;font:600 14px Arial;text-transform:none;letter-spacing:0}.im-format small{font:600 11px Arial;letter-spacing:0;text-transform:none;color:#8fa08a;line-height:1.4}.im-doc-hint{text-transform:none;letter-spacing:0;font:600 11px Arial}.im-hint-ok{color:#8fe08f}.im-hint-bad{color:#ffb86b}.inventory-doc-dialog input[data-doc-tela]{user-select:text}.im-dropzone{display:grid;justify-items:center;gap:10px;padding:54px 20px;border:2px dashed var(--im);border-radius:26px;background:radial-gradient(circle at 50% 70%,color-mix(in srgb,var(--im) 14%,transparent),transparent 62%),#0d140e;text-align:center;cursor:pointer;transition:background .15s,box-shadow .15s}.im-dropzone:hover,.im-dropzone:focus-visible,.im-dropzone.im-over{outline:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--im) 25%,transparent);background:radial-gradient(circle at 50% 70%,color-mix(in srgb,var(--im) 26%,transparent),transparent 66%),#101a11}.im-drop-icon{display:grid;place-items:center;width:62px;height:62px;border-radius:18px;border:1px solid color-mix(in srgb,var(--im) 55%,transparent);background:color-mix(in srgb,var(--im) 18%,transparent);color:var(--im);font:700 30px Arial}.im-dropzone strong{font-size:20px;color:#fff}.im-dropzone small{color:#a9b8a3;font-size:13px}.im-doc-detect{display:grid;gap:8px;padding:14px 16px;border:1px solid #3f553d;border-radius:14px;background:#142016}.im-doc-detect:empty{display:none}.im-doc-detect small{color:#8fa088;font:800 10px Arial;letter-spacing:.1em}.im-doc-detect table{width:100%;border-collapse:collapse}.im-doc-detect th{padding:6px 8px;text-align:left;color:var(--im);font:800 11px Arial;letter-spacing:.08em;border-bottom:1px solid #3f553d}.im-doc-detect td{padding:9px 8px;font:700 14px Arial;border-bottom:1px solid #243424;vertical-align:top}.im-doc-detect td em{display:block;margin-top:2px;color:#8fa088;font:400 11px Arial;font-style:normal;overflow-wrap:anywhere}.inventory-movement-actions .inventory-doc-btn{border-color:#4da3ff;background:#12335c;color:#d6e9ff}.inventory-doc-dialog{width:min(900px,95vw)}.im-doc-body{display:grid;gap:12px}.im-doc-line{display:grid;gap:10px;padding:14px;border:1px solid #344934;border-radius:14px;background:#101811}.im-doc-head{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}.im-doc-head strong{display:block;font-size:15px}.im-doc-head small{color:#8fa088;font-size:11px}.im-doc-head .im-remove{width:36px;height:36px}.inventory-doc-dialog select{padding:13px;border:1px solid #4f6545;border-radius:9px;background:#202d22;color:#fff;font:15px Arial;width:100%;box-sizing:border-box}.inventory-doc-dialog select:focus{outline:none;border-color:var(--im)}.im-doc-rolls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.im-doc-roll{display:inline-flex;align-items:stretch}.im-doc-roll input{width:96px!important;padding:10px 8px!important;text-align:center;border-radius:9px 0 0 9px!important}.im-chips{display:flex;flex-wrap:wrap;gap:4px}.im-chip{display:inline-flex;align-items:center;gap:5px;width:auto;min-height:0;height:24px;padding:0 9px;border:1px solid #344934;border-radius:999px;background:#101811;color:#9fb08c;font:800 9.5px Arial;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;opacity:.8;transition:all .15s}.im-chip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c-bg);border:1px solid var(--c-bd)}.im-chip:hover{opacity:1;border-color:var(--c-bd)}.im-chip.on{opacity:1;background:var(--c-bg);color:var(--c-fg);border-color:var(--c-bd);box-shadow:0 0 0 2px color-mix(in srgb,var(--c-bd) 30%,transparent)}.im-chip.on::before{background:var(--c-fg);border-color:var(--c-fg)}@media(max-width:700px){.im-chip{height:34px;padding:0 13px;font-size:10.5px}.im-doc-roll button.im-roll-bodega{min-width:56px;font-size:10px}.im-chips{gap:6px}}.im-doc-bodega{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 12px;border:1px solid #344934;border-radius:12px;background:#101811}.im-doc-bodega>span{font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase;color:#b8c7b1}.im-doc-roll button.im-roll-bodega{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:0;padding:0 7px;border:1px solid var(--c-bd);border-left:0;border-radius:0;background:var(--c-bg);color:var(--c-fg);font:800 9px Arial;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}.im-doc-roll button.im-roll-bodega:hover{filter:brightness(1.12)}.im-doc-roll button{width:30px;border:1px solid #6b3a36;border-left:0;border-radius:0 9px 9px 0;background:#3b211f;color:#ffd0cc;cursor:pointer}.im-add-roll{margin:0;padding:9px 14px}.im-doc-sum{color:var(--im);font:800 12px Arial;letter-spacing:.04em}.im-doc-total{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px 16px;border:1px solid #344934;border-radius:14px;background:#0d140e}.im-doc-total small{display:block;color:#8fa088;font:800 10px Arial;letter-spacing:.1em}.im-doc-total strong{display:block;margin:4px 0 2px;font:800 24px Arial;color:var(--im)}.im-doc-total span{font-size:12px;color:#a9b8a3}.im-doc-total .im-ok{color:#8fe08f}.im-doc-total .im-warn{color:#ffb86b;font-weight:700}.im-doc-loading{display:grid;justify-items:center;gap:12px;padding:40px 10px;color:#a9b8a3}.im-spinner{width:36px;height:36px;border:4px solid #344934;border-top-color:var(--im);border-radius:50%;animation:im-spin 0.9s linear infinite}@keyframes im-spin{to{transform:rotate(360deg)}}@media(max-width:600px){.im-doc-total{flex-direction:column;align-items:flex-start}.inventory-movement-actions .inventory-doc-btn{flex-basis:100%}}';
    document.head.appendChild(docStyle);
  }
  const style = document.createElement('style');
  style.textContent = '.control-panel{display:grid;gap:16px;max-width:1100px;margin:auto}.control-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.control-panel-head span{color:#d0f44c;font:800 10px Arial;letter-spacing:.1em}.control-panel-head h2{margin:4px 0 0;font-size:1.4rem}.control-panel-refresh{width:auto!important;padding:9px 13px!important;border:1px solid #60754d!important;border-radius:9px!important;background:#233020!important;color:#eff9df!important;font-weight:800}.control-panel-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.control-panel-cards article{display:grid;gap:8px;min-height:115px;padding:17px;border:1px solid #3d4f3d;border-radius:14px;background:linear-gradient(145deg,#182118,#101510)}.control-panel-cards small{color:#aebba7;font:800 10px Arial;letter-spacing:.07em}.control-panel-cards strong{color:#d0f44c;font:800 28px Arial}.control-panel-cards span,.control-panel-cards p{color:#bdc8b8;font-size:12px;margin:0}@media(max-width:700px){.control-panel-cards{grid-template-columns:1fr}.control-panel-head{align-items:flex-start}.control-panel-refresh{min-height:40px}}';
  document.head.appendChild(style);
  let inventoryRetryCount = 0;
  const retryInventoryIfStuck = () => {
    const body = document.getElementById('inventory-body');
    if (body && body.textContent.includes('Cargando inventario local') && inventoryRetryCount < 3) {
      inventoryRetryCount += 1;
      document.getElementById('inventory-refresh')?.click();
    }
  };
  setInterval(retryInventoryIfStuck, 10000);
  const renderLocalInventory = async () => {
    const body = document.getElementById('inventory-body');
    const status = document.getElementById('inventory-status');
    if (!body || body.dataset.localRendered === 'true') return;
    try {
      const response = await fetch('/api/inventarios', {cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.detail || 'No fue posible cargar Inventarios');
      const esc = value => String(value ?? '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
      const activeCategory = [...document.querySelectorAll('.nav-children .tab.active strong')].map(node => node.textContent.trim().toUpperCase()).find(Boolean)?.replace(/^STOCK TELA$/, 'BODEGA TELA') || 'BODEGA TELA';
      const plainCategory = value => String(value || '').normalize('NFD').replace(/\\p{M}/gu, '').trim().toUpperCase();
      const visibleItems = (data.items || []).filter(item => plainCategory(item.categoria) === plainCategory(activeCategory));
      const pickRolls = new Map(), pickNotes = new Map();
      if (activeCategory === 'BODEGA TELA') {
        (data.sublimacion || []).forEach(plan => {
          plan.rolls.forEach(roll => {
            if (!pickRolls.has(roll.id)) pickRolls.set(roll.id, new Map());
            pickRolls.get(roll.id).set(roll.index, plan.short ? 'short' : String(plan.color));
          });
          const note = {label: plan.label, short: plan.short, missing: plan.missing, color: plan.color, mts: Number(plan.mts) || 0, orden: plan.orden};
          (plan.owners || []).forEach(id => pickNotes.set(id, [...(pickNotes.get(id) || []), note]));
        });
      }
      if (!document.getElementById('inventory-pick-style-v2')) {
        const pickStyle = document.createElement('style');
        pickStyle.id = 'inventory-pick-style-v2';
        const palette = [['#4da3ff','#12335c','#d6e9ff'],['#b57bff','#2f1b57','#ecdcff'],['#27d3c3','#0f3d3a','#cffaf5'],['#ff6fb5','#4a1634','#ffd9ec'],['#e6e6e6','#3a3a3a','#ffffff'],['#ff3b3b','#6b0f0f','#ffe0e0']];
        const names = ['0','1','2','3','4','short'];
        pickStyle.textContent = palette.map(([border, bg, fg], n) => '.inventory-roll.roll-pick-'+names[n]+'{border-color:'+border+'!important;background:'+bg+'!important;color:'+fg+'!important;box-shadow:0 0 0 2px '+border+'66}.inv-pick.pick-'+names[n]+'{background:'+bg+';border:1px solid '+border+';color:'+fg+'}').join('') + '.inv-pick{display:block;margin-top:6px;padding:4px 8px;border-radius:6px;font:600 10px Arial;letter-spacing:.03em}.inv-pick.pick-short{font-weight:800}.inventory-roll.roll-left.roll-started{outline:0!important;box-shadow:none!important;border-color:#ff9f1c!important;background:#4d3410!important;color:#ffd9a0!important}.inv-left{display:block;margin-top:6px;padding:4px 8px;border:1px dashed #ff9f1c;border-radius:6px;background:#2a1a05;color:#ffd9a0;font:800 10px Arial;letter-spacing:.04em}.inv-pick-group{display:grid;gap:3px;margin-top:6px;padding:6px;border:1px solid #3d5a8a;border-radius:9px;background:#0f1b2e}.inv-pick-group .inv-pick{margin-top:0}.inv-pick-total{display:block;padding:2px 4px 4px;color:#d6e9ff;font:850 10px Arial;letter-spacing:.05em}';
        document.head.appendChild(pickStyle);
      }
      const fmtPick = n => Number(n).toLocaleString('es-CO', {maximumFractionDigits: 2});
      const pickLine = n => '<span class="inv-pick pick-'+(n.short?'short':n.color)+'">'+(n.short?'⚠ NO ALCANZA · '+esc(n.label)+' · FALTAN '+esc(fmtPick(n.missing))+' MTS':'SUBLIMACIÓN: '+esc(n.label))+'</span>';
      // Varias referencias de la MISMA ORDEN sobre la misma tela se unifican: un solo total y debajo el detalle.
      // Órdenes distintas se muestran por separado.
      const pickBlock = notes => {
        const byOrder = new Map();
        notes.forEach(n => { const key = n.orden || n.label.split(' · ')[0]; byOrder.set(key, [...(byOrder.get(key) || []), n]); });
        return [...byOrder.entries()].map(([order, group]) => {
          if (group.length < 2) return pickLine(group[0]);
          const total = group.reduce((sum, n) => sum + (n.mts || 0), 0), missing = group.reduce((sum, n) => sum + (n.short ? Number(n.missing) || 0 : 0), 0);
          return '<div class="inv-pick-group"><span class="inv-pick-total">'+(missing?'⚠ ':'')+'SUBLIMACIÓN · '+esc(order)+' · '+group.length+' REFERENCIAS · TOTAL '+esc(fmtPick(total))+' MTS'+(missing?' · FALTAN '+esc(fmtPick(missing))+' MTS':'')+'</span>'+group.map(pickLine).join('')+'</div>';
        }).join('');
      };
      body.innerHTML = visibleItems.map(item => '<article class="inventory-item-card"><span class="inv-badge">'+esc(item.categoria_label)+'</span><strong class="inv-name">'+esc(item.nombre)+'</strong><div class="inventory-rolls">'+(() => { const left = [...(item.sobrantes || [])]; return (item.roll_values || []).map((value,index) => { const k = left.findIndex(x => item.roll_statuses?.[index]==='started' && Math.abs(Number(x.valor) - Number(value)) < 0.011); const mark = k >= 0 ? left.splice(k,1)[0] : null; return '<span class="inventory-roll '+(item.roll_statuses?.[index]==='started'?'roll-started':'roll-new')+(mark?' roll-left':'')+(pickRolls.get(item.id)?.has(index)?' roll-pick roll-pick-'+pickRolls.get(item.id).get(index):'')+'"'+'>'+esc(value)+'</span>'; }).join(''); })()+'</div>'+'<span class="inv-total">'+esc(item.mts ?? item.total ?? 0)+' MTS</span><span class="inv-unit">'+esc(item.rolls || (item.roll_values || []).length)+' rollos</span>'+pickBlock(pickNotes.get(item.id)||[])+'</article>').join('') || '<div class="inventory-empty">No hay referencias en el inventario local.</div>';
      if (status) status.textContent = (data.summary?.items || data.items?.length || 0) + ' referencias disponibles · inventario local';
      body.dataset.localRendered = 'true';
    } catch (error) { body.innerHTML = '<div class="inventory-empty">'+String(error.message || error)+'</div>'; }
  };
  renderLocalInventory();
  document.addEventListener('click', event => {
    const tab = event.target.closest('.nav-children .tab');
    if (!tab || tab.dataset.bodegaDashboard || tab.dataset.bodegasNav || !/INVENTARIOS/i.test(tab.closest('.nav-group')?.querySelector('.nav-parent')?.textContent || '')) return;
    setTimeout(() => {
      const inventoryBody = document.getElementById('inventory-body');
      if (inventoryBody) { inventoryBody.dataset.localRendered = 'false'; renderLocalInventory(); }
    }, 60);
  });
  setInterval(() => {
    const inventoryBody = document.getElementById('inventory-body');
    if (inventoryBody && !inventoryBody.querySelector('.inventory-rolls')) {
      inventoryBody.dataset.localRendered = 'false';
      renderLocalInventory();
    }
  }, 1200);
  setInterval(() => {
    const inventoryBody = document.getElementById('inventory-body'), search = document.getElementById('inventory-search');
    if (inventoryBody && inventoryBody.offsetParent && !(search && search.value.trim())) { inventoryBody.dataset.localRendered = 'false'; renderLocalInventory(); }
  }, 60000);
  const inventorySearchBox = document.getElementById('inventory-search');
  if (inventorySearchBox) inventorySearchBox.addEventListener('input', event => {
    event.stopImmediatePropagation();
    const query = String(event.target.value || '').trim().toLocaleLowerCase('es');
    document.querySelectorAll('#inventory-body .inventory-item-card').forEach(card => {
      card.hidden = false;
      card.style.display = !query || String(card.querySelector('.inv-name')?.textContent || '').toLocaleLowerCase('es').includes(query) ? '' : 'none';
    });
  }, true);
  const rollStyle = document.createElement('style');
  rollStyle.textContent = '.inventory-category-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px!important}.inventory-category{display:grid!important;gap:6px;min-height:92px;padding:15px!important;border-radius:15px!important;background:linear-gradient(145deg,#182319,#0d130e)!important;text-align:left!important}.inventory-category small{font-size:.68rem}.inventory-category b{font-size:1.35rem!important}.inventory-category span{margin-left:0!important}.inventory-rolls{display:flex;flex-wrap:wrap;gap:7px;margin:7px 0 3px}.inventory-roll{display:inline-grid;place-items:center;min-width:34px;height:34px;padding:0 7px;border:2px solid #b5e834;border-radius:50%;background:#182719;color:#e8ff9b;font:800 12px Arial;box-sizing:border-box}.inventory-roll.roll-started{border-color:#ff9f1c;background:#4d3410;color:#ffd9a0}.inventory-roll.roll-new{border-color:#79d66f;background:#1d4922;color:#d9ffd4}.inventory-item-card .inv-total{margin-top:3px}';
  document.head.appendChild(rollStyle);
  const inventoryCategoryStrip = document.getElementById('inventory-categories');
  if (inventoryCategoryStrip) inventoryCategoryStrip.style.setProperty('display', 'none', 'important');
  const inventoryGroup = [...document.querySelectorAll('.nav-group')].find(item => /STOCK TELA|BODEGA TELA/i.test(item.textContent));
  if (inventoryGroup) {
    inventoryGroup.classList.add('inventory-hover-group', 'collapsed');
    inventoryGroup.addEventListener('mouseenter', () => inventoryGroup.classList.remove('collapsed'));
    inventoryGroup.addEventListener('mouseleave', () => inventoryGroup.classList.add('collapsed'));
  }
  const decorateRollCards = async () => {
    const body = document.getElementById('inventory-body');
    if (!body) return;
    try {
      const response = await fetch('/api/inventarios', {cache:'no-store'});
      const data = await response.json();
      const byName = new Map((data.items || []).map(item => [String(item.nombre), item]));
      body.querySelectorAll('.inventory-item-card').forEach(card => {
        const name = card.querySelector('.inv-name')?.textContent?.trim();
        const item = byName.get(name);
        if (!item || card.querySelector('.inventory-rolls')) return;
        const rolls = document.createElement('div');
        rolls.className = 'inventory-rolls';
        rolls.innerHTML = (item.roll_values || []).map(value => '<span class="inventory-roll">' + String(value) + '</span>').join('');
        card.querySelector('.inv-total')?.before(rolls);
        const unit = card.querySelector('.inv-unit');
        if (unit) unit.textContent = (item.rolls || (item.roll_values || []).length) + ' rollos';
      });
    } catch (_) {}
  };
  setInterval(decorateRollCards, 700);
})();
</script>"""

# Renderizado de respaldo del inventario local. Este bloque es independiente del
# script histórico del módulo y evita que una excepción de navegación deje la
# pantalla atrapada en "Cargando".
INVENTORY_LOCAL_RENDER_SCRIPT = """<script>
(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>\"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
  const format = value => new Intl.NumberFormat('es-CO', {maximumFractionDigits: 2}).format(Number(value) || 0);
  const render = async () => {
    const body = document.getElementById('inventory-body');
    const status = document.getElementById('inventory-status');
    const categories = document.getElementById('inventory-categories');
    if (!body || body.dataset.localRendered === 'true') return;
    try {
      const response = await fetch('/api/inventarios', {cache: 'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'No fue posible cargar Inventarios');
      const items = data.items || [];
      body.innerHTML = items.length ? items.map((item, index) => '<article class="inventory-item-card" style="animation-delay:' + Math.min(index * 15, 600) + 'ms"><span class="inv-badge">' + escapeHtml(item.categoria_label) + '</span><strong class="inv-name">' + escapeHtml(item.nombre) + '</strong><span class="inv-total">' + escapeHtml(item.total_label || format(item.total)) + '</span><span class="inv-unit">unidades</span></article>').join('') : '<div class="inventory-empty">No hay referencias en el inventario local.</div>';
      if (categories) categories.innerHTML = (data.categories || []).filter(item => item.available).map(item => '<button type="button" class="inventory-category"><small>' + escapeHtml(item.label) + '</small><b>' + format(item.items) + '</b><span>referencias · ' + escapeHtml(item.units_label) + ' und.</span></button>').join('');
      if (status) status.textContent = (data.summary?.items || items.length) + ' referencias disponibles · inventario local';
      body.dataset.localRendered = 'true';
    } catch (error) {
      body.innerHTML = '<div class="inventory-empty">' + escapeHtml(error.message) + '</div>';
      if (status) status.textContent = 'Inventario local no disponible';
    }
  };
  const openGroup = () => [...document.querySelectorAll('.nav-group')].find(group => /STOCK TELA|BODEGA TELA/i.test(group.textContent))?.classList.remove('collapsed');
  openGroup();
  render();
  setInterval(() => { openGroup(); render(); }, 1000);
})();
</script>"""

REWORK_LAYOUT_STYLE = """<style>
body:has(.panel[data-panel='reproceso'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(18px,4vw,76px)!important;padding-right:clamp(18px,4vw,76px)!important}
.panel[data-panel='reproceso'],.panel[data-panel='reproceso'].active,.rework-module{width:100%!important;max-width:none!important}
.rework-module{margin:0!important;gap:20px!important}.rework-module>header{justify-content:flex-end!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}.rework-module>header>div{display:none!important}.rework-module>header button{margin-left:auto!important}nav.tabs :is(.tab>strong,.nav-parent>span:not(.nav-icon)){font:800 12px/1 Arial,sans-serif!important;letter-spacing:0!important}nav.tabs .tab{line-height:1!important}.rework-cards{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:16px!important}.rework-card{min-height:260px;padding:20px!important}@media(max-width:1050px){.rework-cards{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:620px){body:has(.panel[data-panel='reproceso'].active) main{padding-left:12px!important;padding-right:12px!important}.rework-module>header{padding:0!important}.rework-cards{grid-template-columns:1fr!important}.rework-card{min-height:0}}
.rework-card-actions{display:flex;gap:8px;margin-top:auto}.rework-card-actions button{flex:1;width:auto!important;padding:8px 10px!important;border:1px solid #6e875c!important;border-radius:8px!important;background:#233321!important;color:#e4f5d4!important;font-size:12px!important}.rework-card-actions button[data-rework-delete]{border-color:#a85a55!important;background:#3a201e!important;color:#ffc4bd!important}.rework-filters{display:grid;grid-template-columns:repeat(7,minmax(110px,1fr)) auto;gap:9px;padding:13px;border:1px solid #394839;border-radius:12px;background:#131a14}.rework-filters label{display:grid;gap:5px;color:#aebaa8;font:800 10px Arial;letter-spacing:.06em;text-transform:uppercase}.rework-filters input{min-width:0;padding:9px 10px;border:1px solid #465644;border-radius:8px;background:#202b21;color:#f1f7ed;font:600 12px Arial}.rework-filters button{align-self:end;width:auto!important;min-height:35px;padding:8px 11px!important;border:1px solid #657661!important;border-radius:8px!important;background:#2b382a!important;color:#edf5e6!important;font-size:12px!important}@media(max-width:1050px){.rework-filters{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.rework-filters{grid-template-columns:1fr}.rework-filters button{width:100%!important}}
</style>"""

PERSONAL_NOTES_SCRIPT = """
<script>
(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, {headers: {'Content-Type': 'application/json', ...(options.headers || {})}, ...options});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.detail || 'No fue posible guardar la nota.');
    return body;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let notes = [];
  const dialog = document.createElement('dialog'); dialog.className = 'personal-notes-dialog'; document.body.appendChild(dialog);
  const style = document.createElement('style'); style.textContent = `.personal-notes-dialog{width:min(980px,94vw);max-height:90dvh;padding:0;border:1px solid rgba(208,244,76,.6);border-radius:20px;background:#0c110b;color:#f3f7ee;box-shadow:0 30px 90px #000b}.personal-notes-dialog::backdrop{background:#000b}.personal-notes{padding:24px}.personal-notes header{display:flex;justify-content:space-between;gap:16px;padding-bottom:17px;border-bottom:1px solid rgba(255,255,255,.1)}.personal-notes header span{color:#d0f44c;font-size:.65rem;font-weight:900;letter-spacing:.12em}.personal-notes h2{margin:4px 0;font-size:1.45rem}.personal-notes p{margin:0;color:#aeb9a6;font-size:.82rem}.notes-close{width:36px;height:36px;padding:0;border-radius:10px;background:#20271e;color:#fff;border:1px solid #44503f;font-size:1.25rem}.personal-notes form{display:grid;grid-template-columns:1fr 2fr;gap:11px;margin:18px 0;padding:16px;border:1px solid rgba(208,244,76,.2);border-radius:14px;background:rgba(208,244,76,.045)}.personal-notes label{display:grid;gap:5px;color:#aab5a4;font-size:.62rem;font-weight:850;letter-spacing:.08em}.personal-notes input,.personal-notes textarea,.personal-notes select{width:100%;padding:10px;border:1px solid #3d4938;border-radius:9px;background:#171e15;color:#f4f7ef;font:inherit}.personal-notes textarea{min-height:92px;resize:vertical}.note-form-actions{display:flex;align-items:end;justify-content:space-between;gap:12px;grid-column:1/-1}.note-form-actions label{min-width:130px}.note-form-actions button{width:auto;padding:10px 15px;border:0;border-radius:9px;background:#d0f44c;color:#13200c;font-weight:900}.personal-note-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}.personal-note-card{display:flex;flex-direction:column;justify-content:space-between;min-height:178px;padding:15px;border:1px solid rgba(255,255,255,.1);border-top:3px solid var(--note-color,#d0f44c);border-radius:14px;background:linear-gradient(150deg,#1b2318,#10150f)}.personal-note-card.tone-blue{--note-color:#6ab8ff}.personal-note-card.tone-pink{--note-color:#ef78b4}.personal-note-card.tone-orange{--note-color:#f4ae4e}.personal-note-card small{color:var(--note-color,#d0f44c);font-size:.64rem;font-weight:800}.personal-note-card h3{margin:8px 0 7px;font-size:.96rem}.personal-note-card p{white-space:normal;overflow-wrap:anywhere;line-height:1.45}.personal-note-card footer{display:flex;gap:7px;margin-top:14px}.personal-note-card footer button{width:auto;padding:6px 9px;border:1px solid #3e493a;border-radius:8px;background:transparent;color:#e9f0e4;font-size:.72rem}.personal-note-card footer button:last-child{color:#ffaaa3;border-color:#6a3d38}.personal-notes-empty{display:grid;place-items:center;min-height:130px;border:1px dashed #46533c;border-radius:13px;color:#aeb9a6;font-size:.82rem}@media(max-width:600px){.personal-notes-dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}.personal-notes{padding:17px;overflow:auto}.personal-notes form{grid-template-columns:1fr}.note-form-actions{grid-column:auto;align-items:stretch;flex-direction:column}.note-form-actions button{width:100%;min-height:44px}.personal-note-grid{grid-template-columns:1fr}.personal-notes header h2{font-size:1.2rem}}`; document.head.appendChild(style);
  const render = () => {
    dialog.innerHTML = `<section class="personal-notes"><header><div><span>ESPACIO PRIVADO</span><h2>Notas personales</h2><p>Solo tú puedes ver y editar estos apuntes.</p></div><button type="button" class="notes-close" aria-label="Cerrar">×</button></header><form id="personal-note-form"><input type="hidden" name="id"><label>TÍTULO<input name="title" maxlength="100" required placeholder="Ej. Llamar al cliente"></label><label>NOTA<textarea name="content" maxlength="4000" required placeholder="Escribe tu apunte personal…"></textarea></label><div class="note-form-actions"><label>COLOR<select name="color"><option value="lime">Verde</option><option value="blue">Azul</option><option value="pink">Rosa</option><option value="orange">Naranja</option></select></label><button>Guardar nota</button></div></form><div class="personal-note-grid">${notes.map(note => `<article class="personal-note-card tone-${esc(note.color)}"><div><small>${new Date(note.updated_at).toLocaleDateString('es-CO',{day:'2-digit',month:'short'})}</small><h3>${esc(note.title)}</h3><p>${esc(note.content).replace(/\\n/g,'<br>')}</p></div><footer><button type="button" data-edit-note="${note.id}">Editar</button><button type="button" data-delete-note="${note.id}">Eliminar</button></footer></article>`).join('') || '<div class="personal-notes-empty">Aún no tienes notas. Crea la primera arriba.</div>'}</div></section>`;
    dialog.querySelector('.notes-close').onclick = () => dialog.close();
    dialog.querySelector('#personal-note-form').onsubmit = async event => { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); try { if (form.id) await api('/api/notas-personales/' + form.id, {method:'PUT', body:JSON.stringify(form)}); else await api('/api/notas-personales', {method:'POST', body:JSON.stringify(form)}); await openNotes(); } catch (error) { alert(error.message); } };
    dialog.querySelectorAll('[data-edit-note]').forEach(button => button.onclick = () => { const note = notes.find(item => item.id === Number(button.dataset.editNote)); const form = dialog.querySelector('#personal-note-form'); form.id.value = note.id; form.title.value = note.title; form.content.value = note.content; form.color.value = note.color; form.title.focus(); });
    dialog.querySelectorAll('[data-delete-note]').forEach(button => button.onclick = async () => { if (!confirm('¿Eliminar esta nota personal?')) return; try { await api('/api/notas-personales/' + button.dataset.deleteNote, {method:'DELETE'}); await openNotes(); } catch (error) { alert(error.message); } });
  };
  async function openNotes() { try { notes = await api('/api/notas-personales'); render(); if (!dialog.open) dialog.showModal(); } catch (error) { alert(error.message); } }
  const addButton = () => { const menu = document.querySelector('.user-dropdown'); if (!menu || menu.querySelector('#open-personal-notes')) return; const button = document.createElement('button'); button.type = 'button'; button.id = 'open-personal-notes'; button.textContent = 'Notas personales'; button.onclick = openNotes; menu.insertBefore(button, menu.querySelector('a[href="/logout"]')); };
  addButton(); new MutationObserver(addButton).observe(document.body, {childList:true, subtree:true});
})();
</script>
"""


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        order_number TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
        )"""
    )
    columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
    if "kind" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'reprogramacion'")
    if "result_file" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN result_file TEXT")
    if "progress" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
    if "input_summary" not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN input_summary TEXT")
    db.execute(
        """CREATE TABLE IF NOT EXISTS production_rows (
        source_row INTEGER PRIMARY KEY,
        values_json TEXT NOT NULL
        )"""
    )
    db.execute("""CREATE TABLE IF NOT EXISTS production_notes (
        source_row INTEGER NOT NULL, column_number INTEGER NOT NULL,
        note TEXT NOT NULL, username TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(source_row, column_number)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_rework (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, process TEXT NOT NULL,
        reason TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_started (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS production_finished (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER NOT NULL,
        column_number INTEGER NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    production_columns = {row[1] for row in db.execute("PRAGMA table_info(production_rows)")}
    if "sort_order" not in production_columns:
        db.execute("ALTER TABLE production_rows ADD COLUMN sort_order INTEGER")
        db.execute("UPDATE production_rows SET sort_order = source_row WHERE sort_order IS NULL")
    db.execute(
        """CREATE TABLE IF NOT EXISTS production_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL DEFAULT '',
        process TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
        )"""
    )
    try:
        db.execute("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
    except Exception:
        pass
    db.execute("""CREATE TABLE IF NOT EXISTS personal_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'lime',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    db.commit()
    return db


def _session_signature(value: str) -> str:
    secret = os.getenv("APP_SESSION_SECRET") or (os.getenv("APP_PASSWORD", "") + "|indoor-session")
    return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(username: str) -> str:
    payload = f"{username}|{int(time.time()) + 43200}"
    signed = f"{payload}|{_session_signature(payload)}"
    return base64.urlsafe_b64encode(signed.encode("utf-8")).decode("ascii")


def password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)
    return base64.urlsafe_b64encode(salt).decode("ascii") + "$" + base64.urlsafe_b64encode(digest).decode("ascii")


def password_matches(password: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 240000)
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def account_exists(username: str) -> bool:
    if username == os.getenv("APP_USER", "indoor"):
        return True
    with connect() as db:
        return db.execute("SELECT 1 FROM users WHERE name=? COLLATE NOCASE", (username,)).fetchone() is not None


def session_username(token: str) -> str | None:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        username, expires, signature = decoded.rsplit("|", 2)
        payload = f"{username}|{expires}"
        if int(expires) >= int(time.time()) and secrets.compare_digest(signature, _session_signature(payload)) and account_exists(username):
            return username
    except (ValueError, TypeError, UnicodeError):
        pass
    return None


def authenticate(request: Request):
    session_token = request.cookies.get("indoor_session", "")
    username = session_username(session_token)
    if username:
        return username
    if request.url.path in {"/", "/cartera"}:
        raise HTTPException(status_code=307, headers={"Location": "/login"})
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida")


def _process_of(username: str):
    with connect() as db:
        row = db.execute('SELECT process FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    return row['process'] if row else None


permisos_mod.registrar_lookup(_process_of)
permisos_mod.registrar_autenticacion(authenticate)
exportar_mod.configurar(lambda: read_local_production(), authenticate)
reposiciones_mod.configurar(lambda: legacy.get_gspread())
app.include_router(reposiciones_mod.router, dependencies=[Depends(authenticate)])
agentes_mod.configurar(authenticate, lambda u: permisos_mod.rol_de(u) == 'administracion')
app.include_router(agentes_mod.router, dependencies=[Depends(authenticate), Depends(permisos_mod.exigir('agentes'))])
promedios_mod.configurar(authenticate)
app.include_router(promedios_mod.router, dependencies=[Depends(authenticate), Depends(permisos_mod.exigir('promedios'))])
app.include_router(agentes_mod.pc_router)  # el PC de los agentes entra con su token, sin sesión
app.include_router(permisos_mod.router)
app.include_router(exportar_mod.router)
app.include_router(cartera_router, dependencies=[Depends(authenticate), Depends(permisos_mod.exigir('cartera'))])
app.include_router(inventario_router, dependencies=[Depends(authenticate), Depends(permisos_mod.exigir('inventario'))])
app.include_router(externa_router, dependencies=[Depends(authenticate)])



def update_job(job_id: int, state: str, detail: str = "", order_number: str = ""):
    now = datetime.now(timezone.utc).isoformat()
    detail_lower = detail.lower()
    if state in ("COMPLETADO", "ERROR", "REVISAR"):
        progress = 100
    elif "validando" in detail_lower or "leyendo" in detail_lower:
        progress = 15
    elif "analizando" in detail_lower:
        progress = 30
    elif "generando" in detail_lower:
        progress = 40
    elif "creando la orden" in detail_lower or "sincronizando" in detail_lower:
        progress = 55
    else:
        progress = 5 if state == "RECIBIDO" else 10
    with connect() as db:
        db.execute(
            "UPDATE jobs SET status=?, detail=?, order_number=COALESCE(NULLIF(?, ''), order_number), "
            "progress=MAX(COALESCE(progress,0),?), updated_at=? WHERE id=?",
            (state, detail, order_number, progress, now, job_id),
        )


def update_job_progress(job_id: int, progress: int, detail: str):
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute(
            "UPDATE jobs SET status='PROCESANDO', detail=?, progress=?, updated_at=? WHERE id=?",
            (detail, max(1, min(99, int(progress))), now, job_id),
        )


def run_with_live_progress(job_id: int, start: int, ceiling: int, detail: str, operation):
    """Ejecuta una etapa bloqueante y publica avance visible mientras termina."""
    result, failure = [], []

    def worker():
        try:
            result.append(operation())
        except Exception as error:
            failure.append(error)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    progress = start
    update_job_progress(job_id, progress, detail)
    while thread.is_alive():
        thread.join(timeout=.75)
        if thread.is_alive() and progress < ceiling:
            progress += 1
            update_job_progress(job_id, progress, detail)
    if failure:
        raise failure[0]
    return result[0] if result else None


def append_local_production(record: dict, row_builder=None, observations: str = '', author: str = '', linea: str = ''):
    """Registra una referencia directamente en la trazabilidad local."""
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        meta = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM production_meta")}
        headers = json.loads(meta.get("headers") or "[]")
        if not headers:
            raise RuntimeError("La base local de Producción no está inicializada")
        if row_builder:
            values = list(row_builder(record))
        else:
            values = [""] * len(headers)
        width = len(headers)
        values = (values + [""] * width)[:width]
        # Línea de producto elegida al programar el pedido (columna LINEA = columna B del Sheet)
        line_index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'LINEA'), -1)
        if linea.strip() and line_index >= 0:
            values[line_index] = linea.strip().upper()
        groups = json.loads(meta.get('groups') or '[]')
        values = fresh_production_values(values, headers, groups)
        # Never recycle a row identity, even if the last order was deleted.
        highest = max(PRODUCTION_START_ROW - 1, int(meta.get('last_allocated_row') or 0))
        for table in ('production_rows', 'production_notes', 'production_started', 'production_finished', 'production_rework', 'production_operator_events'):
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                highest = max(highest, int(db.execute(f'SELECT COALESCE(MAX(source_row),0) FROM {table}').fetchone()[0]))
        source_row = highest + 1
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('last_allocated_row',?)", (str(source_row),))
        sort_order = int(db.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM production_rows").fetchone()[0])
        db.execute(
            "INSERT INTO production_rows(source_row, values_json, sort_order) VALUES (?, ?, ?)",
            (source_row, json.dumps(values, ensure_ascii=False), sort_order),
        )
        now = datetime.now(timezone.utc).isoformat()
        if observations.strip():
            # Save the programming instruction atomically with each new card.
            note_column = next((i + 1 for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), 1)
            db.execute('INSERT INTO production_notes(source_row,column_number,note,username,updated_at) VALUES(?,?,?,?,?)',
                       (source_row, note_column, observations.strip(), author, now))
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return source_row
    finally:
        db.close()


def verify_order_mockups(order_dir, records):
    """Use the same reader as cards; never publish a reference without a design."""
    files = [p for p in Path(order_dir).iterdir() if p.is_file() and not p.is_symlink()]
    if not records:
        raise ValueError('No hay referencias para programar')
    for record in records:
        reference = str(record.get('referencia') or '').strip()
        designs, status = listing_designs(files, reference)
        if not designs:
            raise ValueError(f'No se programó la tarjeta: falta el mockup de {reference}. {status}. '
                             'Sube la imagen con la referencia correcta en el nombre y vuelve a procesar.')


def process_job(job_id: int, pdf_path: Path, extra_paths: list[Path], observations: str = '', author: str = ''):
    try:
        pending_records = []
        parsed = run_with_live_progress(
            job_id, 8, 34, "Leyendo y verificando el PDF",
            lambda: legacy.extraer_info_pdf(str(pdf_path)),
        )
        _, header, _, warnings = parsed
        order_number = header.get("orden") or legacy.extraer_prefijo_numero_nombre(pdf_path.name)[1]
        if not order_number:
            raise ValueError("No se pudo identificar el número de orden")
        update_job_progress(job_id, 36, "Preparando la orden " + order_number)
        ok = run_with_live_progress(
            job_id, 38, 92, "Creando archivos y registrando en Producción local",
            lambda: legacy.procesar_orden(
                order_number, str(pdf_path), CONFIG,
                production_writer=lambda record: pending_records.append(dict(record)),
                write_google_sheets=False,
            ),
        )
        if ok:
            cliente = legacy.sanitize(header.get("cliente") or "")
            proyecto = legacy.sanitize(header.get("proyecto") or "")
            order_dir = Path(CONFIG["ruta_nas_clientes"]) / cliente / f"{order_number}_{proyecto}"
            copied = 0
            for extra_path in extra_paths:
                update_job_progress(job_id, min(98, 93 + copied), "Copiando imágenes anexas a la orden")
                # Las imagenes usadas para crear el Excel ya fueron copiadas y
                # eliminadas por el procesador. Las restantes tambien se anexan.
                if extra_path.exists():
                    legacy.copiar_archivo(str(extra_path), str(order_dir))
                    extra_path.unlink()
                copied += 1
            detail = "NAS y trazabilidad local de Producción actualizados"
            inserted, image_issues = sync_order_uploads(order_dir, STATE_DIR / 'mockup-backups', uploaded_names={p.name for p in extra_paths})
            detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
            if image_issues:
                detail += ". Revisar imágenes: " + " | ".join(image_issues)
            if copied:
                detail += f". {copied} imagen(es) anexada(s) a la orden"
            if warnings:
                detail += ". Avisos: " + " | ".join(warnings)
            if image_issues:
                raise ValueError('No se programó: ' + ' | '.join(image_issues))
            verify_order_mockups(order_dir, pending_records)
            for record in pending_records:
                append_local_production(record, legacy._fila_produccion, observations, author)
            update_job(job_id, "COMPLETADO", detail, order_number)
        else:
            update_job(job_id, "REVISAR", "El documento incumple una regla de negocio", order_number)
    except Exception as error:
        logging.exception("Error procesando trabajo %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_reprogram_excel_job(job_id: int, excel_path: Path, extra_paths: list[Path], observations: str = '', author: str = ''):
    try:
        update_job_progress(job_id, 8, "Leyendo el listado Excel")
        workbook = load_workbook(excel_path, read_only=True, data_only=True)
        sheets = [sheet for sheet in workbook.worksheets if sheet.title.upper() != "BASE_DATOS"]
        if not sheets:
            raise ValueError("El Excel no contiene pestañas de listado")
        first = sheets[0]
        cliente = str(first["K2"].value or "").strip()
        proyecto = str(first["K3"].value or "").strip()
        vendedor = str(first["K4"].value or "").strip()
        fecha_entrega = first["K5"].value
        if not cliente or not proyecto:
            raise ValueError("El Excel debe contener cliente en K2 y proyecto en K3")
        prefix, number = legacy.extraer_prefijo_numero_nombre(excel_path.name)
        if not number:
            raise ValueError("El nombre del Excel debe incluir el número CO#### o RM####")
        order_number = f"{prefix or 'CO'}{number}"
        update_job(job_id, "PROCESANDO", "Orden identificada desde el Excel", order_number)
        cliente_safe, proyecto_safe = legacy.sanitize(cliente), legacy.sanitize(proyecto)
        order_dir = Path(CONFIG["ruta_nas_clientes"]) / cliente_safe / f"{order_number}_{proyecto_safe}"
        update_job_progress(job_id, 24, "Creando la carpeta de la reprogramación")
        legacy.crear_carpeta(str(order_dir.parent))
        legacy.crear_carpeta(str(order_dir))
        for subfolder in ("APLIQUE (BORDADO,VINILOS,TRANSFER)", "CORTE PLT", "IMPRESION (NOMBRE MAQUINA)"):
            legacy.crear_carpeta(str(order_dir / subfolder))
        legacy.copiar_archivo(str(excel_path), str(order_dir))
        update_job_progress(job_id, 42, "Leyendo referencias y cantidades del Excel")
        records = []
        for sheet in sheets:
            reference = sheet.title.strip()
            quantity = 0
            for row in range(8, sheet.max_row + 1):
                if any(sheet.cell(row, column).value not in (None, "") for column in (3, 4, 5)):
                    quantity += 1
            if not reference or quantity == 0:
                continue
            records.append({
                "cliente": cliente_safe, "proyecto": proyecto_safe, "orden": order_number,
                "referencia": reference, "cantidad": str(quantity),
                "fecha_creacion": legacy.fecha_es(datetime.now()),
                "fecha_entrega": legacy.fecha_es(datetime.combine(fecha_entrega, datetime.min.time())) if hasattr(fecha_entrega, "year") else str(fecha_entrega or ""),
                "vendedor": vendedor, "tela": legacy.buscar_tela_por_ref(reference),
                "logo_texturizado": "NO",
            })
        workbook.close()
        if not records:
            raise ValueError("No se encontraron referencias con prendas en el Excel")
        update_job_progress(job_id, 58, "Actualizando clientes y referencias")
        legacy.guardar_cliente_supabase(cliente_safe, str(order_dir.parent))
        total_records = len(records)
        for index, record in enumerate(records, start=1):
            update_job_progress(job_id, 58 + int(index * 30 / total_records), f"Registrando referencia {index} de {total_records} en Producción local")
            legacy.guardar_referencia_supabase(record["referencia"], proyecto_safe)
        copied = 0
        for extra_path in extra_paths:
            update_job_progress(job_id, min(98, 90 + copied), "Copiando anexos de la reprogramación")
            if extra_path.exists():
                legacy.copiar_archivo(str(extra_path), str(order_dir))
                extra_path.unlink()
            copied += 1
        detail = "Excel archivado en NAS y reprogramación registrada en Producción local"
        inserted, image_issues = sync_order_uploads(order_dir, STATE_DIR / 'mockup-backups', uploaded_names={p.name for p in extra_paths})
        detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
        if image_issues:
            detail += ". Revisar imágenes: " + " | ".join(image_issues)
        if copied:
            detail += f". {copied} anexo(s) copiado(s)"
        if image_issues:
            raise ValueError('No se programó: ' + ' | '.join(image_issues))
        verify_order_mockups(order_dir, records)
        for record in records:
            append_local_production(record, legacy._fila_produccion, observations, author)
        update_job(job_id, "COMPLETADO", detail, order_number)
    except Exception as error:
        logging.exception("Error procesando reprogramación Excel %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_order_job(job_id: int, job_dir: Path, pdf_path: Path, excel_path: Path, observations: str = '', author: str = '', linea: str = '', overrides: dict | None = None):
    try:
        pending_records = []
        # The legacy processor moves/removes attachments: remember them beforehand.
        uploaded_names = {p.name for p in job_dir.iterdir() if p.is_file() and p not in (pdf_path, excel_path)}
        update_job_progress(job_id, 8, "Validando la pareja PDF + Excel")
        pdf_prefix, pdf_number = pedidos.extraer_prefijo_numero_nombre(pdf_path.name)
        xls_prefix, xls_number = pedidos.extraer_prefijo_numero_nombre(excel_path.name)
        if not pdf_number or not xls_number:
            raise ValueError("El PDF y el Excel deben incluir el numero CO#### o RM#### en el nombre")
        if (pdf_prefix, pdf_number) != (xls_prefix, xls_number):
            raise ValueError("El PDF y el Excel no corresponden a la misma orden")
        order_number = f"{pdf_prefix}{pdf_number}"
        update_job(job_id, "PROCESANDO", "Orden identificada. Preparando archivos", order_number)
        update_job_progress(job_id, 18, "Preparando la orden " + order_number)
        ok = run_with_live_progress(
            job_id, 20, 93, "Creando la orden y registrando en Producción local",
            lambda: pedidos.procesar_orden(
                order_number, str(pdf_path), str(excel_path), PEDIDOS_CONFIG,
                production_writer=lambda record: pending_records.append(dict(record)),
                write_google_sheets=False,
            ),
        )
        if ok:
            copied = 0
            for attachment in job_dir.iterdir():
                if not attachment.is_file() or attachment in (pdf_path, excel_path):
                    continue
                update_job_progress(job_id, min(98, 94 + copied), "Copiando anexos del pedido")
                pedidos.copiar_archivo(str(attachment), str(ok))
                uploaded_names.add(attachment.name)
                attachment.unlink()
                copied += 1
            detail = "Pedido creado en NAS y registrado en Producción local"
            inserted, image_issues = sync_order_uploads(Path(ok), STATE_DIR / 'mockup-backups', uploaded_names=uploaded_names)
            detail += f". {inserted} mockup(s) insertado(s) en el listado; originales conservados en la carpeta"
            if image_issues:
                detail += ". Revisar imágenes: " + " | ".join(image_issues)
            if copied:
                detail += f". {copied} anexo(s) copiado(s)"
            if image_issues:
                raise ValueError('No se programó: ' + ' | '.join(image_issues))
            verify_order_mockups(Path(ok), pending_records)
            for record in pending_records:
                if overrides:
                    record.update(overrides)
                append_local_production(record, pedidos._fila_produccion, observations, author, linea)
            update_job(job_id, "COMPLETADO", detail, order_number)
        else:
            update_job(job_id, "REVISAR", "El pedido incumple una regla de negocio", order_number)
    except Exception as error:
        logging.exception("Error procesando pedido normal %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_creator_job(job_id: int, data_image: Path, images: list[tuple[int, Path]], output_name: str, sheet_name: str = ""):
    try:
        update_job(job_id, "PROCESANDO", "La IA esta analizando las imagenes")
        output = create_from_images(
            data_image=data_image, images=images, output_dir=STATE_DIR / "generated",
            output_name=output_name, sheet_name=sheet_name,
            progress_callback=lambda value, detail: update_job_progress(job_id, value, detail),
        )
        now = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute(
                "UPDATE jobs SET status=?, detail=?, result_file=?, progress=100, updated_at=? WHERE id=?",
                ("COMPLETADO", "Listado XLSX creado. Ya puedes descargarlo", str(output), now, job_id),
            )
    except Exception as error:
        logging.exception("Error creando XLSX %s", job_id)
        update_job(job_id, "ERROR", str(error))


def process_creator_bundle_job(job_id: int, sheets: list[dict], output_name: str):
    try:
        update_job(job_id, "PROCESANDO", f"Analizando {len(sheets)} pestaña(s) de Excel")
        output = create_from_sheet_bundle(
            sheets=sheets, output_dir=STATE_DIR / "generated", output_name=output_name,
            progress_callback=lambda value, detail: update_job_progress(job_id, value, detail),
        )
        now = datetime.now(timezone.utc).isoformat()
        with connect() as db:
            db.execute(
                "UPDATE jobs SET status=?, detail=?, result_file=?, progress=100, updated_at=? WHERE id=?",
                ("COMPLETADO", f"Libro creado con {len(sheets)} pestaña(s). Ya puedes descargarlo", str(output), now, job_id),
            )
    except Exception as error:
        logging.exception("Error creando XLSX con varias pestañas %s", job_id)
        update_job(job_id, "ERROR", str(error))


@app.on_event("startup")
def startup():
    with connect():
        pass
    legacy.setup_logging(CONFIG["log_file"])
    # Activar la sincronizacion con Google Sheets al arrancar (los datos de produccion deben reflejar la hoja),
    # salvo que alguien la haya desvinculado a proposito con el interruptor del Panel de control.
    flag = STATE_DIR / 'sheets-sync-enabled'
    flag.parent.mkdir(parents=True, exist_ok=True)
    if (STATE_DIR / 'sheets-sync-desvinculado').exists():
        flag.unlink(missing_ok=True)
    else:
        flag.touch(exist_ok=True)
    sheets_sync.start(connect, legacy.get_gspread, STATE_DIR)
    start_sublimacion_worker()
    db_backup.start(DB_PATH, STATE_DIR, legacy.get_supabase)
    respaldo.start(DATA_ROOT, DB_PATH)
    threading.Thread(target=_warm_card_assets, name='precarga-disenos', daemon=True).start()
    threading.Thread(target=_vigilar_edicion, name='agentes-auto-edicion', daemon=True).start()


DATA_ROOT = STATE_DIR.parent


@app.get('/tema.js')
def tema_js():
    return FileResponse(Path(__file__).with_name('tema.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/tarjeta-iconos.js')
def tarjeta_iconos_js():
    return FileResponse(Path(__file__).with_name('tarjeta-iconos.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/inventario-alertas.js')
def inventario_alertas_js():
    return FileResponse(Path(__file__).with_name('inventario-alertas.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


# Personas que reciben el aviso de telas por reponer (se compara el usuario y su nombre, sin tildes ni mayúsculas).
TELA_ALERT_USERS = {'ALEJANDRO PADILLA', 'STIVEN SANCHEZ', 'INDOOR SPORT'}


@app.get('/session-guard.js')
def session_guard_js():
    return FileResponse(Path(__file__).with_name('session-guard.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/alertas-telas.js')
def alertas_telas_js():
    return FileResponse(Path(__file__).with_name('alertas-telas.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/api/alertas-telas')
def alertas_telas(request: Request, _=Depends(authenticate)):
    """Telas por debajo de su mínimo, solo para las personas autorizadas (aviso al iniciar sesión y a las 4 p. m.)."""
    with connect() as db:
        profile = db.execute('SELECT name, display_name FROM users WHERE name=? COLLATE NOCASE', (_,)).fetchone()
    names = {_plain_text(profile['name']), _plain_text(profile['display_name'])} if profile else {_plain_text(_)}
    if not names & TELA_ALERT_USERS:
        return {'aplica': False, 'alertas': []}
    data = inventory_alerts()
    # Identifica este inicio de sesión (cambia cada vez que la persona entra con su usuario)
    session = hashlib.sha256((request.cookies.get('indoor_login', '') + '|' + request.cookies.get('indoor_session', '')).encode()).hexdigest()[:16]
    return {'aplica': True, 'sesion': session, 'alertas': [a for a in data['alertas'] if a.get('categoria') == 'BODEGA TELA']}


@app.get('/linea-info.js')
def linea_info_js():
    return FileResponse(Path(__file__).with_name('linea-info.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


LINEAS_MOCKUPS_DIR = STATE_DIR.parent / 'lineas_mockups'
LINEAS_FILE = STATE_DIR.parent / 'lineas_producto.json'
LINEAS_HISTORIAL = STATE_DIR.parent / 'lineas_producto_historial'
LINEA_ESTILOS = ('premium', 'estandar', 'plus', 'maquila', 'otro')
_lineas_lock = threading.Lock()


def _linea_slug(value) -> str:
    plain = ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', plain.upper())


def _can_edit_lines(username: str) -> bool:
    """Pueden editar las líneas: el usuario administrador y los perfiles Administración o Coordinador."""
    if username == os.getenv('APP_USER', 'indoor'):
        return True
    with connect() as db:
        profile = db.execute('SELECT process FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    return bool(profile and can_delete_rework_profile(profile['process']))


def _normalize_lineas(data: dict) -> dict:
    """Cada línea lleva un id estable (nombre del mockup), alias (cómo aparece en la columna B del Sheet) y nota."""
    used = set()
    for line in data.get('lineas', []):
        line.setdefault('alias', [])
        line.setdefault('nota', '')
        if line.get('estilo') not in LINEA_ESTILOS:
            line['estilo'] = 'otro'
        ident = _linea_slug(line.get('id') or line.get('nombre')) or 'LINEA'
        base, n = ident, 2
        while ident in used:
            ident, n = f'{base}{n}', n + 1
        line['id'] = ident
        used.add(ident)
    if 'edicion' not in data:
        data['edicion'] = str(data.get('fuente', '')).split('·')[-1].strip()
    return data


def _load_lineas() -> dict:
    try:
        data = json.loads(LINEAS_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = json.loads(Path(__file__).with_name('lineas_producto.json').read_text(encoding='utf-8'))
    return _normalize_lineas(data)


def _linea_mockups() -> dict:
    """Mockup de referencia por línea: /data/lineas_mockups/<ID>.jpg|png|webp."""
    found = {}
    if LINEAS_MOCKUPS_DIR.is_dir():
        for path in sorted(LINEAS_MOCKUPS_DIR.iterdir()):
            if path.is_file() and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
                slug = _linea_slug(path.stem)
                found[slug] = f'/api/lineas-producto/mockup/{slug}?v={int(path.stat().st_mtime)}'
    return found


def _lineas_response(username: str) -> dict:
    data = _load_lineas()
    data['mockups'] = _linea_mockups()
    data['puede_editar'] = _can_edit_lines(username)
    data['estilos'] = list(LINEA_ESTILOS)
    return data


def _clean_text(value, limit: int) -> str:
    return ' '.join(str(value or '').split())[:limit]


@app.get('/api/lineas-producto')
def lineas_producto(_=Depends(authenticate)):
    """Qué incluye cada línea de producto y qué líneas tienen mockup."""
    return _lineas_response(_)


@app.put('/api/lineas-producto')
def lineas_producto_guardar(payload: dict = Body(...), _=Depends(authenticate)):
    if not _can_edit_lines(_):
        raise HTTPException(403, 'Tu usuario no puede editar las líneas de producto')
    raw_lines = payload.get('lineas')
    if not isinstance(raw_lines, list) or not 1 <= len(raw_lines) <= 40:
        raise HTTPException(400, 'Debe haber entre 1 y 40 líneas')
    lines, names, ids, claimed = [], set(), set(), {}
    for raw in raw_lines:
        if not isinstance(raw, dict):
            raise HTTPException(400, 'Formato de línea no válido')
        nombre = _clean_text(raw.get('nombre'), 40).upper()
        slug = _linea_slug(nombre)
        if not slug:
            raise HTTPException(400, 'Cada línea necesita un nombre')
        if slug in claimed:
            raise HTTPException(400, f'El nombre {nombre} está repetido')
        claimed[slug] = nombre
        ident = _linea_slug(raw.get('id')) or slug
        base, n = ident, 2
        while ident in ids:
            ident, n = f'{base}{n}', n + 1
        ids.add(ident)
        alias = []
        for item in (raw.get('alias') or [])[:10]:
            text = _clean_text(item, 40).upper()
            key = _linea_slug(text)
            if not key or key == slug or key in claimed:
                if key and key != slug:
                    raise HTTPException(400, f'«{text}» ya está usado por otra línea')
                continue
            claimed[key] = nombre
            alias.append(text)
        features = [_clean_text(c, 160).upper() for c in (raw.get('caracteristicas') or [])]
        lines.append({
            'id': ident, 'nombre': nombre,
            'estilo': raw.get('estilo') if raw.get('estilo') in LINEA_ESTILOS else 'otro',
            'alias': alias, 'caracteristicas': [c for c in features if c][:80],
            'nota': _clean_text(raw.get('nota'), 300),
        })
    previous = _load_lineas()
    edicion = _clean_text(payload.get('edicion'), 40)
    data = {
        'fuente': 'Líneas de producto · Especificaciones por línea' + (f' · {edicion}' if edicion else ''),
        'edicion': edicion, 'documento': previous.get('documento', ''), 'lema': previous.get('lema', ''),
        'lineas': lines, 'editado_por': _, 'editado_en': datetime.now(timezone.utc).isoformat(),
    }
    with _lineas_lock:
        LINEAS_HISTORIAL.mkdir(parents=True, exist_ok=True)
        if LINEAS_FILE.exists():
            shutil.copy2(LINEAS_FILE, LINEAS_HISTORIAL / f"lineas-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json")
            for old in sorted(LINEAS_HISTORIAL.glob('lineas-*.json'))[:-25]:
                old.unlink(missing_ok=True)
        tmp = LINEAS_FILE.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(tmp, LINEAS_FILE)
    return _lineas_response(_)


@app.get('/api/lineas-producto/mockup/{slug}')
def linea_mockup(slug: str, v: str = '', _=Depends(authenticate)):
    clean = _linea_slug(slug)
    if clean and LINEAS_MOCKUPS_DIR.is_dir():
        for path in sorted(LINEAS_MOCKUPS_DIR.iterdir()):
            if path.is_file() and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp') and _linea_slug(path.stem) == clean:
                cache = 'private, max-age=31536000, immutable' if v else 'private, no-cache'
                return FileResponse(path, headers={'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff'})
    raise HTTPException(404, 'Esa línea no tiene mockup')


def _save_linea_mockup(ident: str, content: bytes):
    import io
    from PIL import Image
    image = Image.open(io.BytesIO(content))
    image.load()
    if image.mode in ('RGBA', 'LA', 'P'):
        image = image.convert('RGBA')
        background = Image.new('RGB', image.size, 'white')
        background.paste(image, mask=image.split()[-1])
        image = background
    else:
        image = image.convert('RGB')
    image.thumbnail((1100, 1950))
    LINEAS_MOCKUPS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = LINEAS_MOCKUPS_DIR / f'.{ident}.tmp.jpg'
    image.save(tmp, 'JPEG', quality=86, optimize=True)
    for other in LINEAS_MOCKUPS_DIR.iterdir():
        if other.is_file() and other != tmp and _linea_slug(other.stem) == ident:
            other.unlink(missing_ok=True)
    os.replace(tmp, LINEAS_MOCKUPS_DIR / f'{ident}.jpg')


@app.post('/api/lineas-producto/mockup/{ident}')
async def linea_mockup_subir(ident: str, file: UploadFile = File(...), _=Depends(authenticate)):
    if not _can_edit_lines(_):
        raise HTTPException(403, 'Tu usuario no puede editar las líneas de producto')
    ident = _linea_slug(ident)
    if ident not in {line['id'] for line in _load_lineas()['lineas']}:
        raise HTTPException(404, 'Guarda primero la línea y luego sube su imagen')
    content = await file.read()
    if not content or len(content) > 12 * 1024 * 1024:
        raise HTTPException(413, 'La imagen debe pesar menos de 12 MB')
    try:
        await asyncio.to_thread(_save_linea_mockup, ident, content)
    except Exception:
        raise HTTPException(400, 'No se pudo leer la imagen. Usa un JPG, PNG o WEBP')
    return {'ok': True, 'mockups': _linea_mockups()}


@app.delete('/api/lineas-producto/mockup/{ident}')
def linea_mockup_quitar(ident: str, _=Depends(authenticate)):
    if not _can_edit_lines(_):
        raise HTTPException(403, 'Tu usuario no puede editar las líneas de producto')
    clean = _linea_slug(ident)
    if clean and LINEAS_MOCKUPS_DIR.is_dir():
        for path in LINEAS_MOCKUPS_DIR.iterdir():
            if path.is_file() and _linea_slug(path.stem) == clean:
                path.unlink(missing_ok=True)
    return {'ok': True, 'mockups': _linea_mockups()}


@app.get('/linea-editor.js')
def linea_editor_js():
    return FileResponse(Path(__file__).with_name('linea-editor.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/nav-liquid.js')
def nav_liquid_js():
    return FileResponse(Path(__file__).with_name('nav-liquid.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/agentes.js')
def agentes_js():
    return FileResponse(Path(__file__).with_name('agentes.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/promedios.js')
def promedios_js():
    return FileResponse(Path(__file__).with_name('promedios.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/reposiciones.js')
def reposiciones_js():
    return FileResponse(Path(__file__).with_name('reposiciones.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/permisos.js')
def permisos_js():
    return FileResponse(Path(__file__).with_name('permisos.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/permisos', response_class=HTMLResponse)
def permisos_page(request: Request):
    username = session_username(request.cookies.get('indoor_session', ''))
    if not username:
        return RedirectResponse('/login', status_code=303)
    if permisos_mod.rol_de(username) != 'administracion':
        return HTMLResponse("<h1>Sin permiso</h1><p>Solo la administración puede cambiar los permisos.</p><p><a href='/'>Volver</a></p>", status_code=403)
    return HTMLResponse(Path(__file__).with_name('permisos.html').read_text(encoding='utf-8'), headers={'Cache-Control': 'no-store'})


@app.get('/salud.js')
def salud_js():
    return FileResponse(Path(__file__).with_name('salud.js'), media_type='application/javascript', headers={'Cache-Control': 'no-cache'})


@app.get('/api/salud-panel')
def salud_panel(_=Depends(authenticate)):
    """Problemas visibles para el usuario: sincronizacion detenida, NAS caido, respaldo atrasado."""
    problemas = []
    now = datetime.now(timezone.utc)

    def age(iso):
        try:
            return (now - datetime.fromisoformat(iso)).total_seconds()
        except Exception:
            return None
    db = connect()
    try:
        meta = dict(db.execute("SELECT key,value FROM production_meta WHERE key LIKE 'sheets_sync_%'"))
    finally:
        db.close()
    if _sheets_sync_flag().exists():
        seconds = age(meta.get('sheets_sync_checked_at') or '')
        if meta.get('sheets_sync_error'):
            problemas.append('Producción no se está sincronizando con Google Sheets: ' + meta['sheets_sync_error'][:120])
        elif seconds is not None and seconds > 600:
            problemas.append('Producción lleva %d min sin sincronizar con Google Sheets' % (seconds // 60))
    try:
        from app import inventario_api
        if inventario_api.sheet_linked():
            snap = Path(inventario_api._snapshot_file)
            if snap.exists() and (now.timestamp() - snap.stat().st_mtime) > 1800:
                problemas.append('Inventario lleva %d min sin actualizarse desde Google Sheets' % ((now.timestamp() - snap.stat().st_mtime) // 60))
    except Exception:
        pass
    if not Path(CONFIG['ruta_nas_clientes']).is_dir():
        problemas.append('El NAS no está disponible (se reintenta solo): los archivos de clientes no abren')
    info = respaldo.load_status(DATA_ROOT)
    seconds = age(info.get('last_ok_at') or '')
    if info.get('last_error'):
        problemas.append('Falló el último respaldo: ' + info['last_error'][:100])
    elif seconds is not None and seconds > 36 * 3600:
        problemas.append('El último respaldo tiene más de un día y medio')
    return {'problemas': problemas}


@app.get('/api/respaldos')
def respaldos_lista(_=Depends(authenticate)):
    return {'estado': respaldo.load_status(DATA_ROOT), 'archivos': respaldo.listing(DATA_ROOT)}


@app.post('/api/respaldos/ahora')
def respaldos_ahora(_=Depends(authenticate)):
    try:
        name = respaldo.run_once(DATA_ROOT, DB_PATH)
    except Exception as error:
        raise HTTPException(500, 'No se pudo respaldar: ' + str(error)[:200])
    return {'ok': True, 'name': name}


@app.get('/api/respaldos/{name}')
def respaldos_descargar(name: str, _=Depends(authenticate)):
    path = respaldo.backups_dir(DATA_ROOT) / name
    if not re.fullmatch(r'respaldo-\d{8}-\d{6}\.tar\.gz', name) or not path.is_file():
        raise HTTPException(404, 'Respaldo no encontrado')
    return FileResponse(path, media_type='application/gzip', filename=name)


@app.get("/salud")
def health():
    nas = Path(CONFIG["ruta_nas_clientes"])
    db = connect()
    local_rows = db.execute("SELECT COUNT(*) FROM production_rows").fetchone()[0]
    db.close()
    return {
        "estado": "ok",
        "disenos_en_memoria": len(_ASSET_CACHE),
        "nas_disponible": nas.is_dir(),
        "produccion_local": local_rows,
        "pedidos_habilitados": True,
    }


INPUT_CONTRAST_STYLE = """<style id="indoor-input-contrast">
/* Keep typed and autofilled text legible, including focused browser autofill. */
input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, select {
  color-scheme:dark; background-color:#25312a!important; color:#f4f7f2!important;
  -webkit-text-fill-color:#f4f7f2!important; caret-color:#e0fc82!important;
}
input::placeholder,textarea::placeholder {color:#b8c4bb!important;-webkit-text-fill-color:#b8c4bb!important;opacity:1}
input:autofill,input:autofill:hover,input:autofill:focus,input:autofill:active {
  background-color:#25312a!important;color:#f4f7f2!important;
  box-shadow:0 0 0 1000px #25312a inset!important;
}
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active {
  -webkit-text-fill-color:#f4f7f2!important;caret-color:#e0fc82!important;
  -webkit-box-shadow:0 0 0 1000px #25312a inset!important;box-shadow:0 0 0 1000px #25312a inset!important;
}
input:focus-visible,textarea:focus-visible,select:focus-visible {outline:2px solid #d4ec98!important;outline-offset:2px}
input::selection,textarea::selection {background:#d4ec98;color:#142014;-webkit-text-fill-color:#142014}
select option {background:#25312a;color:#f4f7f2}
</style>"""


def login_page(error: str = "") -> str:
    template = Path(__file__).with_name("login.html").read_text(encoding="utf-8")
    return template.replace("__LOGIN_ERROR__", escape(error)).replace('</head>', INPUT_CONTRAST_STYLE + '</head>')


@app.get("/landing/{nombre}.jpg")
def landing_foto(nombre: str):
    if not re.fullmatch(r"(hero|proceso-[1-6]|uniforme-[1-6])", nombre):
        raise HTTPException(status_code=404)
    return FileResponse(Path(__file__).with_name("landing") / f"{nombre}.jpg", media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/login-sport.jpg")
def login_sport_image():
    return FileResponse(Path(__file__).with_name("login-sport.jpg"), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    if session_username(request.cookies.get("indoor_session", "")):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(login_page())


_rate_hits: dict = {}
_rate_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    return (request.headers.get('cf-connecting-ip') or (request.headers.get('x-forwarded-for') or '').split(',')[-1].strip()
            or (request.client.host if request.client else 'desconocida'))


def _too_many(bucket: str, request: Request, limit: int, seconds: int = 60) -> bool:
    """Limitador simple por IP: más de `limit` peticiones en `seconds` segundos."""
    now = time.monotonic()
    key = (bucket, _client_ip(request))
    with _rate_lock:
        hits = [t for t in _rate_hits.get(key, []) if now - t < seconds]
        hits.append(now)
        _rate_hits[key] = hits
        if len(_rate_hits) > 5000:
            for old in [k for k, v in _rate_hits.items() if not v or now - v[-1] > 3600]:
                _rate_hits.pop(old, None)
        return len(hits) > limit


def _row_steps(headers: list, values: list) -> list:
    """Estado de cada proceso (sin DISEÑO) para una referencia."""
    steps = []
    for index, process in enumerate(PROCESS_FLOW):
        label = process['label']
        if _plain_text(label) == 'DISENO':
            continue
        columns = [i for i, h in enumerate(headers) if official_process(h) == index and operator_process_header(h)]
        if not columns:
            continue
        cells = [str(values[i] or '').strip().upper() for i in columns]
        closed = [c == 'N/A' or bool(parse_production_date(c)) for c in cells]
        state = 'rework' if 'R' in cells else 'active' if 'P' in cells else 'finished' if closed and all(closed) else 'partial' if any(closed) else 'pending'
        steps.append((label, state))
    return steps


def _furthest(steps: list) -> tuple:
    """(posición, estado, texto) del proceso MÁS AVANZADO que ya empezó; solo eso se le muestra al cliente."""
    for position in range(len(steps) - 1, -1, -1):
        label, state = steps[position]
        if state == 'pending':
            continue
        if state == 'finished' and position == len(steps) - 1:
            return position, 'finished', 'Terminado'
        if state == 'finished':
            return position, 'active', f'Terminó {label}'
        if state == 'rework':
            return position, 'rework', f'En revisión · {label}'
        return position, 'active', f'En proceso · {label}'
    return -1, 'pending', 'Recibido · en cola de producción'


def _assets_with_timeout(source_row: int, seconds: int = 12):
    """Mockups de una referencia con tope de espera; si el NAS tarda o falla, se recuerda el resultado para no repetir la espera."""
    entry = _ASSET_CACHE.get(source_row)
    if entry:
        return entry[1]
    result = {}

    def work():
        try:
            payload = _compute_card_assets(source_row)
        except Exception:
            payload = {'images': []}
        with _ASSET_LOCK:
            _ASSET_CACHE[source_row] = (time.monotonic(), payload)
        result['payload'] = payload
    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(seconds)
    return result.get('payload')


_PUBLIC_EXTRA: dict = {}


def _ref_file_match(stem: str, reference: str) -> bool:
    parts = [x for x in re.split(r'[^A-Z0-9]+', stem.upper()) if x]
    ref = reference.upper().strip()
    tokens = {t for t in re.findall(r'[A-Z]+\d+', ref) if len(re.sub(r'\d', '', t)) >= 2}
    return any(x == ref or x in tokens for x in parts)


def _folder_design_numbers(source_row: int, base_count: int = 0) -> list:
    """Mockups de la referencia en la carpeta del pedido cuando son MÁS que los del listado Excel (el listado solo guarda unos pocos).
    Se guardan en memoria y en disco (miniaturas) y se devuelven sus números; si no hay más que en el Excel, devuelve []."""
    hit = _PUBLIC_EXTRA.get(source_row)
    if hit and time.monotonic() - hit[0] < 21600 and hit[2] == base_count:
        return hit[1]
    numbers = []
    try:
        files, _, _client = production_row_files(source_row, excel_only=True)
        folder = files[0].parent if files else None
        with connect() as db:
            record = db.execute('SELECT values_json FROM production_rows WHERE source_row=?', (source_row,)).fetchone()
            headers = json.loads(db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()[0])
        values = json.loads(record['values_json']) if record else []
        ref_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'REFERENCIA'), -1)
        reference = str(values[ref_idx]).strip() if 0 <= ref_idx < len(values) else ''
        if folder and reference:
            images = [p for p in folder.iterdir() if p.is_file() and not p.is_symlink() and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')
                      and _ref_file_match(p.stem, reference) and p.stat().st_size <= 8 * 1024 * 1024]
            if len(images) > base_count:
                images.sort(key=lambda p: [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', p.name.casefold())])
                cache_dir = STATE_DIR / 'mockups_carpeta'
                cache_dir.mkdir(parents=True, exist_ok=True)
                for k, path in enumerate(images[:24]):
                    stat = path.stat()
                    key = cache_dir / (hashlib.sha1(f'{path}|{stat.st_mtime_ns}|{stat.st_size}'.encode()).hexdigest() + '.jpg')
                    if key.exists():
                        data = key.read_bytes()
                    else:
                        data = excel_mockups._thumbnail(path.read_bytes())
                        key.write_bytes(data)
                    mime = 'image/png' if data[:4] == bytes([137, 80, 78, 71]) else 'image/jpeg'
                    _remember_image(source_row, 101 + k, hashlib.sha256(data).hexdigest()[:20], mime, data)
                    numbers.append(101 + k)
    except Exception:
        numbers = []
    _PUBLIC_EXTRA[source_row] = (time.monotonic(), numbers, base_count)
    return numbers


def _signed_images(source_row: int, payload: dict, expires: int, with_folder: bool = False) -> list:
    designs = [image.get('design') for image in ((payload or {}).get('images') or []) if isinstance(image.get('design'), int)]
    if with_folder:
        extra = _folder_design_numbers(source_row, len(designs))
        if len(extra) > len(designs):
            designs = extra
    urls = []
    for design in designs[:24]:
        sig = _session_signature(f'mockup|{source_row}|{design}|{expires}')
        urls.append(f'/api/consulta-pedido/mockup/{source_row}/{design}?e={expires}&s={sig}')
    return urls


_PREFETCH_BUSY: set = set()
_PREFETCH_LOCK = threading.Lock()
_PREFETCH_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix="prefetch-public")


def _prefetch_extra(source_row: int):
    entry = _ASSET_CACHE.get(source_row)
    count = len([i for i in ((entry[1] if entry else {}) or {}).get('images') or [] if isinstance(i.get('design'), int)])
    _folder_design_numbers(source_row, count)


def _prefetch_public(source_row: int):
    """Empieza a preparar los mockups de una referencia apenas se consulta, para que estén listos cuando la página los pida."""
    with _PREFETCH_LOCK:
        if source_row in _PREFETCH_BUSY:
            return
        _PREFETCH_BUSY.add(source_row)
    try:
        if _assets_with_timeout(source_row, 60) is not None:
            _prefetch_extra(source_row)
    except Exception:
        pass
    finally:
        with _PREFETCH_LOCK:
            _PREFETCH_BUSY.discard(source_row)


def _public_mockup_info(source_row: int) -> dict:
    """Si los mockups ya están en memoria se entregan; si no, se da un enlace firmado para pedirlos aparte (sin hacer esperar la consulta)."""
    expires = int(time.time()) + 1800
    entry = _ASSET_CACHE.get(source_row)
    if entry and source_row in _PUBLIC_EXTRA:
        return {'mockups': _signed_images(source_row, entry[1], expires, True), 'mockups_lista': None}
    sig = _session_signature(f'mockups|{source_row}|{expires}')
    return {'mockups': [], 'mockups_lista': f'/api/consulta-pedido/mockups/{source_row}?e={expires}&s={sig}'}


@app.get('/api/consulta-pedido/mockups/{source_row}')
def consulta_publica_lista_mockups(request: Request, source_row: int, e: int = 0, s: str = ''):
    if _too_many('consulta-lista', request, 40):
        raise HTTPException(429, 'Demasiadas solicitudes.')
    if e < time.time() or not hmac.compare_digest(str(s), _session_signature(f'mockups|{source_row}|{e}')):
        raise HTTPException(403, 'Enlace vencido. Vuelve a consultar tu pedido.')
    return {'mockups': _signed_images(source_row, _assets_with_timeout(source_row), int(time.time()) + 1800, True)}


@app.get('/api/consulta-pedido/mockup/{source_row}/{design}')
def consulta_publica_mockup(request: Request, source_row: int, design: int, e: int = 0, s: str = ''):
    """Imagen de un mockup para la consulta pública: solo con el enlace firmado y temporal que entrega la consulta."""
    if _too_many('consulta-img', request, 90):
        raise HTTPException(429, 'Demasiadas solicitudes.')
    if e < time.time() or not hmac.compare_digest(str(s), _session_signature(f'mockup|{source_row}|{design}|{e}')):
        raise HTTPException(403, 'Enlace vencido. Vuelve a consultar tu pedido.')
    with _ASSET_LOCK:
        hit = _IMAGE_CACHE.get((source_row, design))
    if not hit:
        if design > 100:
            _PUBLIC_EXTRA.pop(source_row, None)
            _prefetch_extra(source_row)
        else:
            _assets_with_timeout(source_row)
        with _ASSET_LOCK:
            hit = _IMAGE_CACHE.get((source_row, design))
    if not hit:
        raise HTTPException(404, 'Imagen no encontrada.')
    return Response(hit[2], media_type=hit[1], headers={'Cache-Control': 'private, max-age=1800', 'X-Content-Type-Options': 'nosniff'})


@app.get('/api/consulta-pedido')
def consulta_publica_pedido(request: Request, q: str = '', orden: str = ''):
    """Consulta pública para el cliente, por número de orden o por nombre del cliente: sus órdenes, la referencia, el mockup
    y solo el proceso más avanzado. Nada de cantidades, notas ni precios."""
    if _too_many('consulta', request, 12):
        raise HTTPException(429, 'Demasiadas consultas. Intenta de nuevo en un minuto.')
    text = ' '.join(str(q or orden or '').split())
    compact = re.sub(r'[\s-]+', '', text).upper()
    by_order = bool(re.fullmatch(r'[A-Z]{1,3}\d{3,6}', compact))
    tokens = [t for t in re.split(r'\s+', _plain_text(text)) if len(t) >= 2]
    if not by_order and (len(re.sub(r'[^A-Z0-9]', '', _plain_text(text))) < 4 or not any(len(t) >= 3 for t in tokens)):
        raise HTTPException(400, 'Escribe tu número de orden (por ejemplo CO6128) o el nombre de tu cliente (mínimo 4 letras).')
    if not by_order and _too_many('consulta-nombre', request, 6):
        raise HTTPException(429, 'Demasiadas búsquedas por nombre. Intenta de nuevo en un minuto.')
    db = connect()
    try:
        meta = {r['key']: r['value'] for r in db.execute("SELECT key,value FROM production_meta WHERE key='headers'")}
        headers = json.loads(meta.get('headers') or '[]')
        index = {str(h).strip().upper(): i for i, h in enumerate(headers)}
        order_idx, client_idx = index.get('ORDEN', -1), index.get('NOMBRE DEL CLIENTE', -1)
        project_idx, ref_idx, due_idx = index.get('NOMBRE PROYECTO', -1), index.get('REFERENCIA', -1), index.get('FECHA DE ENTREGA', -1)
        matches = []
        for raw in db.execute('SELECT source_row, values_json FROM production_rows ORDER BY source_row'):
            values = json.loads(raw['values_json'])
            values = values + [''] * max(0, len(headers) - len(values))
            order_value = re.sub(r'[\s-]+', '', str(values[order_idx])).upper() if order_idx >= 0 else ''
            if not order_value:
                continue
            if by_order:
                ok = order_value == compact
            else:
                name = _plain_text(values[client_idx]) if client_idx >= 0 else ''
                ok = bool(name) and all(t in name for t in tokens)
            if ok:
                matches.append((raw['source_row'], order_value, values))
    finally:
        db.close()
    if not matches:
        raise HTTPException(404, 'No encontramos ese pedido. Revisa el dato o comunícate con tu asesor.')
    if not by_order and len({_plain_text(v[client_idx]) for _, _, v in matches}) > 1:
        return {'tipo': 'varios', 'mensaje': 'Hay varios clientes con ese nombre. Escribe el nombre completo o tu número de orden.'}
    grouped: dict = {}
    for source_row, order_value, values in matches:
        grouped.setdefault(order_value, []).append((source_row, values))
    for rows_ in grouped.values():
        for source_row_, _values in rows_[:12]:
            if source_row_ not in _ASSET_CACHE or source_row_ not in _PUBLIC_EXTRA:
                _PREFETCH_POOL.submit(_prefetch_public, source_row_)
    pedidos = []
    for order_value, rows in grouped.items():
        references, best = [], (-2, 'pending', 'Recibido · en cola de producción')
        for source_row, values in rows[:12]:
            result = _furthest(_row_steps(headers, values))
            if (result[0], not result[2].startswith('Terminó')) > (best[0], not best[2].startswith('Terminó')):
                best = result
            references.append({'referencia': ' '.join(str(values[ref_idx] or '').split())[:80] if ref_idx >= 0 else '',
                               'estado': result[1], 'texto': result[2], **_public_mockup_info(source_row)})
        due = None
        if due_idx >= 0:
            dates = [d for d in (parse_production_date(str(v[due_idx])) for _, v in rows) if d]
            due = min(dates).isoformat() if dates else None
        item = {'orden': order_value, 'estado': best[1], 'texto': best[2], 'entrega': due, 'referencias': references, 'repetir': _repeat_token(order_value)}
        if not by_order and project_idx >= 0:
            item['proyecto'] = ' '.join(str(rows[0][1][project_idx] or '').split())[:80]
        pedidos.append(item)
    pedidos.sort(key=lambda x: (x['estado'] == 'finished', x['entrega'] or '9999'))
    return {'tipo': 'orden' if by_order else 'cliente', 'pedidos': pedidos[:10], 'total': len(pedidos)}


_repeat_lock = threading.Lock()


def _repeat_token(order: str) -> str:
    expires = int(time.time()) + 3600
    return f"{order}.{expires}.{_session_signature(f'repetir|{order}|{expires}')[:32]}"


def _verify_repeat_token(token: str) -> str:
    try:
        order, expires, sig = str(token).rsplit('.', 2)
        expires = int(expires)
    except ValueError:
        raise HTTPException(403, 'Solicitud no válida. Vuelve a consultar tu pedido.')
    if expires < time.time() or not hmac.compare_digest(sig, _session_signature(f'repetir|{order}|{expires}')[:32]):
        raise HTTPException(403, 'Esta solicitud venció. Vuelve a consultar tu pedido.')
    return order


def _client_match(first: str, second: str) -> bool:
    a = {t for t in re.split(r'\s+', _plain_text(first)) if len(t) >= 3}
    b = {t for t in re.split(r'\s+', _plain_text(second)) if len(t) >= 3}
    return bool(a and b) and len(a & b) / min(len(a), len(b)) >= 0.6


def _order_already_exists(db, new_order: str, doc_hash: str, ignore_review: bool = False) -> str:
    """Motivo por el que NO se puede programar (ya se produjo, se programó o se envió antes); '' si está libre."""
    compact = lambda v: re.sub(r'[\s-]+', '', str(v or '')).upper()
    headers = json.loads((db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone() or ['[]'])[0] or '[]')
    order_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), -1)
    if order_idx >= 0:
        for raw in db.execute('SELECT values_json FROM production_rows'):
            values = json.loads(raw[0])
            if order_idx < len(values) and compact(values[order_idx]) == new_order:
                return 'Esa cotización o remisión ya fue programada en producción.'
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='production_deleted_rows'").fetchone():
            for (payload,) in db.execute('SELECT payload FROM production_deleted_rows'):
                try:
                    values = json.loads(json.loads(payload)['values_json'])
                except (ValueError, KeyError, TypeError):
                    continue
                if order_idx < len(values) and compact(values[order_idx]) == new_order:
                    return 'Esa cotización o remisión ya fue usada en un pedido anterior.'
    skipped = ('ERROR', 'REVISAR') if ignore_review else ('ERROR',)
    if db.execute(f"SELECT 1 FROM jobs WHERE order_number=? AND status NOT IN ({','.join('?' * len(skipped))}) LIMIT 1", (new_order, *skipped)).fetchone():
        return 'Esa cotización o remisión ya fue enviada y se está programando.'
    db.execute('CREATE TABLE IF NOT EXISTS web_repeat_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_hash TEXT, new_order TEXT, prev_order TEXT, ip TEXT, job_id INTEGER, created_at TEXT)')
    if db.execute('SELECT 1 FROM web_repeat_requests r LEFT JOIN jobs j ON j.id=r.job_id WHERE (r.doc_hash=? OR r.new_order=?) AND COALESCE(j.status,\'\')<>\'ERROR\' LIMIT 1', (doc_hash, new_order)).fetchone():
        return 'Ese documento ya fue enviado antes.'
    return ''


def _nas_has_order(client_name: str, new_order: str) -> bool:
    """¿Ya hay carpeta de esta orden en el NAS dentro de la carpeta del cliente?"""
    root = Path(CONFIG['ruta_nas_clientes']).resolve()
    client = resolve_nas_client(root, legacy.sanitize(client_name))
    return any(p.is_dir() and re.match(rf'^{re.escape(new_order)}(?:[\s_-]|$)', p.name.upper()) for p in client.iterdir())


def _prepare_repeat(previous: str, content: bytes, phone: str, notes: str, ip: str) -> dict:
    db = connect()
    try:
        meta = {r['key']: r['value'] for r in db.execute("SELECT key,value FROM production_meta WHERE key='headers'")}
        headers = json.loads(meta.get('headers') or '[]')
        index = {str(h).strip().upper(): i for i, h in enumerate(headers)}
        order_idx, client_idx = index.get('ORDEN', -1), index.get('NOMBRE DEL CLIENTE', -1)
        previous_rows = []
        for raw in db.execute('SELECT values_json FROM production_rows'):
            values = json.loads(raw['values_json'])
            if order_idx >= 0 and order_idx < len(values) and re.sub(r'[\s-]+', '', str(values[order_idx])).upper() == previous:
                previous_rows.append(values + [''] * max(0, len(headers) - len(values)))
    finally:
        db.close()
    if not previous_rows:
        raise HTTPException(404, 'No encontramos el pedido anterior. Vuelve a consultarlo.')
    previous_client = str(previous_rows[0][client_idx] or '').strip()
    line = str(previous_rows[0][1] or '').strip()
    line = '' if line.upper() == 'BOT' else line
    # 1) leer el documento nuevo
    stamp = datetime.now().strftime('%Y%m%d%H%M%S%f')
    job_dir = UPLOAD_DIR / 'pedidos' / f'web-{stamp}'
    job_dir.mkdir(parents=True, exist_ok=False)
    keep = False
    try:
        pdf_tmp = job_dir / 'documento.pdf'
        pdf_tmp.write_bytes(content)
        try:
            _, header, _, _ = legacy.extraer_info_pdf(str(pdf_tmp))
        except Exception:
            raise HTTPException(400, 'No pudimos leer el documento. Sube el PDF original de tu cotización o remisión.')
        new_order = str(header.get('orden') or '')
        if not re.fullmatch(r'(CO|RM)\d{3,6}', new_order) or header.get('tipo_doc') not in ('COTIZACION', 'REMISION'):
            raise HTTPException(400, 'El documento debe ser una cotización o una remisión de Indoor Sport.')
        if not _client_match(header.get('cliente') or '', previous_client):
            raise HTTPException(400, 'Esa cotización o remisión no corresponde al mismo cliente del pedido anterior.')
        doc_hash = hashlib.sha256(content).hexdigest()
        # 2) verificar que esa orden NO se haya producido ni programado antes
        with _repeat_lock:
            db = connect()
            try:
                reason = _order_already_exists(db, new_order, doc_hash)
            finally:
                db.close()
            if not reason:
                try:
                    if _nas_has_order(previous_client, new_order):
                        reason = 'Esa cotización o remisión ya tiene carpeta de producción.'
                except HTTPException as error:
                    if error.status_code != 404:
                        raise HTTPException(503, 'No podemos verificar el pedido en este momento. Intenta de nuevo en unos minutos.')
                except OSError:
                    raise HTTPException(503, 'No podemos verificar el pedido en este momento. Intenta de nuevo en unos minutos.')
            if reason:
                raise HTTPException(409, 'Apreciado cliente, tu orden ya está en proceso de producción y por lo tanto no es permitido volver a programar.')
            # 3) listado y mockups del pedido anterior
            try:
                root = Path(CONFIG['ruta_nas_clientes']).resolve()
                client_dir = resolve_nas_client(root, legacy.sanitize(previous_client))
                folder = next(p for p in client_dir.iterdir() if p.is_dir() and re.match(rf'^{re.escape(previous)}(?:[\s_-]|$)', p.name.upper()))
            except (HTTPException, StopIteration, OSError):
                raise HTTPException(409, 'No encontramos el listado del pedido anterior. Un asesor te ayudará con tu pedido.')
            sheets = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in ('.xlsx', '.xlsm') and not p.name.startswith('~$')]
            preferred = [p for p in sheets if p.name.upper().startswith(previous)] or sheets
            if not preferred:
                raise HTTPException(409, 'No encontramos el listado del pedido anterior. Un asesor te ayudará con tu pedido.')
            source = max(preferred, key=lambda p: p.stat().st_mtime)
            base = re.sub(r'^(?:CO|RM)\d+[\s_-]*', '', source.stem, flags=re.I)[:70] or 'LISTADO'
            excel_path = job_dir / f'{new_order}_{base}{source.suffix.lower()}'
            shutil.copy2(source, excel_path)
            pdf_path = job_dir / f"{new_order}_{re.sub(r'[^A-Za-z0-9]+', '_', _plain_text(previous_client))[:40]}.pdf"
            pdf_tmp.rename(pdf_path)
            overrides = {'fecha_creacion': header.get('fecha_creacion') or pedidos.fecha_es(datetime.now())}
            if header.get('fecha_entrega_date'):
                overrides['fecha_entrega'] = pedidos.fecha_es(datetime.combine(header['fecha_entrega_date'], datetime.min.time()))
            now = datetime.now(timezone.utc).isoformat()
            with connect() as db:
                db.execute('CREATE TABLE IF NOT EXISTS web_repeat_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_hash TEXT, new_order TEXT, prev_order TEXT, ip TEXT, job_id INTEGER, created_at TEXT)')
                cursor = db.execute(
                    'INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary,order_number) VALUES(?,?,?,?,?,?,?,?)',
                    (f'WEB · {new_order} (repite {previous})', 'RECIBIDO', 'Solicitud del cliente desde la web', now, now, 'pedido',
                     json.dumps({'origen': 'web', 'repite': previous, 'telefono': phone, 'notas': notes}, ensure_ascii=False), new_order))
                job_id = cursor.lastrowid
                db.execute('INSERT INTO web_repeat_requests(doc_hash,new_order,prev_order,ip,job_id,created_at) VALUES(?,?,?,?,?,?)',
                           (doc_hash, new_order, previous, ip, job_id, now))
        keep = True
    finally:
        if not keep:
            shutil.rmtree(job_dir, ignore_errors=True)
    observations = f'Pedido repetido desde {previous} · solicitado por el cliente desde la página web' + (f' · Tel: {phone}' if phone else '') + (f' · {notes}' if notes else '')
    threading.Thread(target=process_order_job, name=f'repetir-{new_order}', daemon=True,
                     args=(job_id, job_dir, pdf_path, excel_path, observations, 'Cliente (web)', line), kwargs={'overrides': overrides}).start()
    return {'ok': True, 'orden': new_order, 'job': job_id, 'sig': _session_signature(f'repetir-job|{job_id}')[:32]}


@app.post('/api/repetir-pedido', status_code=202)
async def repetir_pedido_publico(request: Request, token: str = Form(...), pdf: UploadFile = File(...),
                                 telefono: str = Form(default='', max_length=30), notas: str = Form(default='', max_length=400),
                                 website: str = Form(default='')):
    """Repetir un pedido anterior desde la página pública: exige una cotización o remisión NUEVA del mismo cliente."""
    if website:  # trampa para robots: se finge éxito
        return {'ok': True, 'orden': '', 'job': 0, 'sig': ''}
    if _too_many('repetir', request, 3, 3600):
        raise HTTPException(429, 'Ya enviaste varias solicitudes. Intenta de nuevo más tarde.')
    previous = _verify_repeat_token(token)
    content = await pdf.read()
    if not content or len(content) > 8 * 1024 * 1024 or not content.startswith(b'%PDF'):
        raise HTTPException(400, 'Sube el PDF de tu cotización o remisión (máximo 8 MB).')
    phone = re.sub(r'[^0-9+() -]', '', telefono)[:30]
    notes = ' '.join(notas.split())[:400]
    return await asyncio.to_thread(_prepare_repeat, previous, content, phone, notes, _client_ip(request))


def _prepare_new_order(pdf_bytes: bytes, excel_bytes: bytes, excel_name: str, mockups: list, phone: str, notes: str, ip: str) -> dict:
    """Pedido nuevo del cliente desde la web: PDF + Excel + mockups, con las mismas validaciones que el formulario interno."""
    stamp = datetime.now().strftime('%Y%m%d%H%M%S%f')
    job_dir = UPLOAD_DIR / 'pedidos' / f'web-{stamp}'
    job_dir.mkdir(parents=True, exist_ok=False)
    keep = False
    try:
        pdf_tmp = job_dir / 'documento.pdf'
        pdf_tmp.write_bytes(pdf_bytes)
        try:
            _, header, _, _ = legacy.extraer_info_pdf(str(pdf_tmp))
        except Exception:
            raise HTTPException(400, 'No pudimos leer el PDF. Sube el original de tu cotización o remisión.')
        new_order = str(header.get('orden') or '')
        if not re.fullmatch(r'(CO|RM)\d{3,6}', new_order) or header.get('tipo_doc') not in ('COTIZACION', 'REMISION'):
            raise HTTPException(400, 'El PDF debe ser una cotización o una remisión de Indoor Sport.')
        client_name = str(header.get('cliente') or '').strip()
        excel_prefix, excel_number = pedidos.extraer_prefijo_numero_nombre(excel_name)
        if excel_number and f'{excel_prefix}{excel_number}' != new_order:
            raise HTTPException(400, f'El Excel corresponde a otra orden ({excel_prefix}{excel_number}); el PDF es {new_order}.')
        db = connect()
        try:
            headers = json.loads((db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone() or ['[]'])[0] or '[]')
            client_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'NOMBRE DEL CLIENTE'), -1)
            known = client_idx >= 0 and any(
                _client_match(client_name, (json.loads(r[0]) + [''] * 60)[client_idx]) for r in db.execute('SELECT values_json FROM production_rows'))
        finally:
            db.close()
        if not known:
            raise HTTPException(403, 'No encontramos tu empresa entre nuestros clientes. Comunícate con tu asesor para programar tu pedido.')
        doc_hash = hashlib.sha256(pdf_bytes).hexdigest()
        with _repeat_lock:
            db = connect()
            try:
                reason = _order_already_exists(db, new_order, doc_hash)
            finally:
                db.close()
            if not reason:
                try:
                    if _nas_has_order(client_name, new_order):
                        reason = 'Esa cotización o remisión ya tiene carpeta de producción.'
                except HTTPException as error:
                    if error.status_code != 404:
                        raise HTTPException(503, 'No podemos verificar el pedido en este momento. Intenta de nuevo en unos minutos.')
                except OSError:
                    raise HTTPException(503, 'No podemos verificar el pedido en este momento. Intenta de nuevo en unos minutos.')
            if reason:
                raise HTTPException(409, 'Apreciado cliente, tu orden ya está en proceso de producción y por lo tanto no es permitido volver a programar.')
            base = re.sub(r'^(?:CO|RM)\d+[\s_-]*', '', Path(excel_name).stem, flags=re.I)[:70] or 'LISTADO'
            excel_path = job_dir / f'{new_order}_{base}{Path(excel_name).suffix.lower()}'
            excel_path.write_bytes(excel_bytes)
            pdf_path = job_dir / f"{new_order}_{re.sub(r'[^A-Za-z0-9]+', '_', _plain_text(client_name))[:40]}.pdf"
            pdf_tmp.rename(pdf_path)
            for index, (name, content) in enumerate(mockups):
                target = job_dir / name
                if target.exists():
                    target = job_dir / f'{index}_{name}'
                target.write_bytes(content)
            now = datetime.now(timezone.utc).isoformat()
            with connect() as db:
                db.execute('CREATE TABLE IF NOT EXISTS web_repeat_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_hash TEXT, new_order TEXT, prev_order TEXT, ip TEXT, job_id INTEGER, created_at TEXT)')
                cursor = db.execute(
                    'INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary,order_number) VALUES(?,?,?,?,?,?,?,?)',
                    (f'WEB · {new_order}', 'RECIBIDO', 'Pedido del cliente desde la web', now, now, 'pedido',
                     json.dumps({'origen': 'web', 'telefono': phone, 'notas': notes}, ensure_ascii=False), new_order))
                job_id = cursor.lastrowid
                db.execute('INSERT INTO web_repeat_requests(doc_hash,new_order,prev_order,ip,job_id,created_at) VALUES(?,?,?,?,?,?)',
                           (doc_hash, new_order, '', ip, job_id, now))
        keep = True
    finally:
        if not keep:
            shutil.rmtree(job_dir, ignore_errors=True)
    observations = 'Pedido programado por el cliente desde la página web' + (f' · Tel: {phone}' if phone else '') + (f' · {notes}' if notes else '')
    threading.Thread(target=process_order_job, name=f'web-{new_order}', daemon=True,
                     args=(job_id, job_dir, pdf_path, excel_path, observations, 'Cliente (web)', '')).start()
    return {'ok': True, 'orden': new_order, 'job': job_id, 'sig': _session_signature(f'repetir-job|{job_id}')[:32]}


@app.post('/api/programar-pedido', status_code=202)
async def programar_pedido_publico(request: Request, pdf: UploadFile = File(...), excel: UploadFile = File(...),
                                   extras: list[UploadFile] = File(default=[]),
                                   telefono: str = Form(default='', max_length=30), notas: str = Form(default='', max_length=400),
                                   website: str = Form(default='')):
    """Programar un pedido nuevo desde el acceso público (PDF + Excel + mockups) para clientes ya registrados."""
    if website:
        return {'ok': True, 'orden': '', 'job': 0, 'sig': ''}
    if _too_many('programar', request, 3, 3600):
        raise HTTPException(429, 'Ya enviaste varias solicitudes. Intenta de nuevo más tarde.')
    extras = [e for e in extras if e.filename]
    if any(Path(e.filename).suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'} for e in extras):
        raise HTTPException(400, 'Los mockups deben ser imágenes JPG, PNG o WEBP.')
    try:
        await require_mockup_upload(extras)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not pdf.filename or Path(pdf.filename).suffix.lower() != '.pdf':
        raise HTTPException(400, 'El primer archivo debe ser un PDF.')
    if not excel.filename or Path(excel.filename).suffix.lower() not in {'.xlsx', '.xlsm'}:
        raise HTTPException(400, 'El listado debe ser un archivo .xlsx o .xlsm.')
    if len(extras) > 20:
        raise HTTPException(400, 'Máximo 20 diseños.')
    pdf_bytes, excel_bytes = await pdf.read(), await excel.read()
    if not pdf_bytes.startswith(b'%PDF') or not excel_bytes.startswith(b'PK'):
        raise HTTPException(400, 'Los archivos no son válidos. Sube el PDF y el Excel originales.')
    mockups, total = [], len(pdf_bytes) + len(excel_bytes)
    for item in extras:
        content = await item.read()
        total += len(content)
        mockups.append((Path(item.filename).name, content))
    if total > 40 * 1024 * 1024:
        raise HTTPException(413, 'Los archivos superan 40 MB.')
    phone = re.sub(r'[^0-9+() -]', '', telefono)[:30]
    notes = ' '.join(notas.split())[:400]
    return await asyncio.to_thread(_prepare_new_order, pdf_bytes, excel_bytes, excel.filename, mockups, phone, notes, _client_ip(request))


@app.get('/api/repetir-pedido/estado')
def repetir_pedido_estado(job: int = 0, s: str = ''):
    if not hmac.compare_digest(str(s), _session_signature(f'repetir-job|{job}')[:32]):
        raise HTTPException(403, 'Enlace no válido.')
    with connect() as db:
        row = db.execute('SELECT status, order_number FROM jobs WHERE id=?', (job,)).fetchone()
    if not row:
        raise HTTPException(404, 'No encontrado.')
    state = {'COMPLETADO': 'listo', 'ERROR': 'revision', 'REVISAR': 'revision'}.get(row['status'], 'procesando')
    return {'estado': state, 'orden': row['order_number']}


def _is_admin_session(request: Request) -> str | None:
    username = session_username(request.cookies.get('indoor_session', ''))
    return username if username and _can_edit_lines(username) else None


@app.post("/login")
def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    if _too_many('login', request, 8):
        return HTMLResponse(login_page("Demasiados intentos. Espera un minuto e inténtalo de nuevo."), status_code=429)
    expected_user = os.getenv("APP_USER", "indoor")
    expected_password = os.getenv("APP_PASSWORD", "")
    with connect() as db:
        user = db.execute("SELECT name, password_hash FROM users WHERE name = ? COLLATE NOCASE", (username.strip(),)).fetchone()
    valid = bool(user) and password_matches(password, user["password_hash"])
    if not user:
        valid = secrets.compare_digest(username.strip(), expected_user)
        valid &= bool(expected_password) and secrets.compare_digest(password, expected_password)
    if not valid:
        return HTMLResponse(login_page("Usuario o contraseña incorrectos."), status_code=401)
    response = RedirectResponse("/", status_code=303)
    session_name = user["name"] if user and password_matches(password, user["password_hash"]) else expected_user
    response.set_cookie("indoor_session", create_session_token(session_name), max_age=43200, httponly=True, secure=True, samesite="lax")
    response.set_cookie("indoor_fresh", "1", max_age=60, secure=True, samesite="lax")  # marca de inicio de sesión recién hecho (la lee el panel una sola vez)
    response.set_cookie("indoor_login", secrets.token_hex(8), max_age=43200, httponly=True, secure=True, samesite="lax")  # identifica cada inicio de sesión (aviso de telas)
    return response


def register_page(error: str = "") -> str:
    template = Path(__file__).with_name('register.html').read_text(encoding='utf-8')
    ok_style = '<style>.error.ok{background:#1d3a16!important;border-color:#5fa84a!important;color:#dff7d3!important}</style>' if error.startswith('✓') else ''
    page = template.replace('__REGISTER_ERROR__', escape(error)).replace('</head>', INPUT_CONTRAST_STYLE + ok_style + '</head>')
    return page.replace('class="error"', 'class="error ok"', 1) if error.startswith('✓') else page


@app.get("/registro", response_class=HTMLResponse)
def register_form(request: Request):
    # Las cuentas las crea solo la administración (antes cualquiera podía registrarse y elegir su proceso).
    if not session_username(request.cookies.get("indoor_session", "")):
        return RedirectResponse("/login", status_code=303)
    if not _is_admin_session(request):
        return HTMLResponse("<h1>Sin permiso</h1><p>Las cuentas nuevas las crea la administración.</p><p><a href='/'>Volver</a></p>", status_code=403)
    return HTMLResponse(register_page())


@app.post("/registro")
def register_submit(request: Request, name: str = Form(...), process: str = Form(...), password: str = Form(...)):
    if not _is_admin_session(request):
        return HTMLResponse("<h1>Sin permiso</h1><p>Las cuentas nuevas las crea la administración.</p>", status_code=403)
    clean_name = " ".join(name.split())
    clean_process = " ".join(process.split())
    if len(clean_name) < 3 or len(clean_process) < 2:
        return HTMLResponse(register_page("Completa el nombre y el proceso del operario."), status_code=400)
    if len(password) < 6:
        return HTMLResponse(register_page("La contraseña debe tener al menos 6 caracteres."), status_code=400)
    try:
        with connect() as db:
            db.execute(
                "INSERT INTO users(name, process, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (clean_name, clean_process, password_hash(password), datetime.now(timezone.utc).isoformat()),
            )
    except sqlite3.IntegrityError:
        return HTMLResponse(register_page("Ya existe un operario registrado con ese nombre."), status_code=409)
    # La cuenta nueva NO inicia sesión: quien la creó sigue con su propia sesión.
    return HTMLResponse(register_page(f"✓ Cuenta creada: {clean_name}. Puedes crear otra."))


@app.get("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie("indoor_session")
    return response


@app.get("/marca-indoor.png")
def indoor_brand():
    return FileResponse(LOGO_FILE, media_type="image/png")


@app.get("/marca-indoor.svg")
def indoor_brand_svg():
    return FileResponse(LOGO_SVG_FILE, media_type="image/svg+xml")


@app.get("/favicon.png")
def indoor_favicon():
    return FileResponse(FAVICON_FILE, media_type="image/png")


@app.get("/favicon.svg")
def indoor_favicon_svg():
    return FileResponse(FAVICON_SVG_FILE, media_type="image/svg+xml")


@app.get("/home-dashboard.js")
def home_dashboard_js():
    return FileResponse(Path(__file__).with_name("home-dashboard.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/bodega-dashboard.js")
def bodega_dashboard_js():
    return FileResponse(Path(__file__).with_name("bodega-dashboard.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/bodegas.js")
def bodegas_js():
    return FileResponse(Path(__file__).with_name("bodegas.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/mobile-nav.js")
def mobile_nav_js():
    return FileResponse(Path(__file__).with_name("mobile-nav.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})


BUILD_ID = str(int(__import__("time").time()))


@app.get("/api/build")
def build_id(_=Depends(authenticate)):
    return {"build": BUILD_ID}


@app.get("/build-watch.js")
def build_watch_js():
    return FileResponse(Path(__file__).with_name("build-watch.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/trace-ui.js")
def trace_ui_script():
    return FileResponse(Path(__file__).with_name("trace-ui.js"), media_type="application/javascript")


@app.get("/manifest.webmanifest")
def web_manifest():
    """Permite instalar el panel en el teléfono y abrirlo a pantalla completa, sin barras del navegador."""
    return JSONResponse({
        "name": "Indoor Sport · Panel operativo",
        "short_name": "Indoor",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#050605",
        "theme_color": "#050605",
        "icons": [
            {"src": "/favicon.svg?v=6", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
            {"src": "/favicon.png", "sizes": "64x64", "type": "image/png"},
        ],
    }, media_type="application/manifest+json")


def read_production_sheet() -> dict:
    """Lee la línea de producción desde la fila 726 sin modificar Google Sheets."""
    now = time.time()
    with PRODUCTION_CACHE_LOCK:
        cached = PRODUCTION_CACHE.get("data")
        if cached and now - float(PRODUCTION_CACHE.get("at") or 0) < 45:
            return cached
        worksheet = legacy.get_gspread()
        last_row = max(PRODUCTION_START_ROW, int(worksheet.row_count or PRODUCTION_START_ROW))
        ranges = ["A2:CE3"]
        for start in range(PRODUCTION_START_ROW, last_row + 1, 250):
            ranges.append(f"A{start}:CE{min(start + 249, last_row)}")
        blocks = worksheet.batch_get(ranges)
        heading_rows = blocks[0] if blocks else []
        groups = list(heading_rows[0]) if heading_rows else []
        headers = list(heading_rows[1]) if len(heading_rows) > 1 else []
        width = max(len(groups), len(headers), 83)
        groups += [""] * (width - len(groups))
        headers += [""] * (width - len(headers))
        current_group = "GENERAL"
        normalized_groups = []
        for value in groups:
            if str(value or "").strip():
                current_group = str(value).strip()
            normalized_groups.append(current_group)
        normalized_headers = [
            str(value or "").strip() or f"COLUMNA {index + 1}"
            for index, value in enumerate(headers)
        ]
        rows = []
        for range_name, block in zip(ranges[1:], blocks[1:]):
            source_row = int(re.search(r"A(\d+)", range_name).group(1))
            for offset, raw in enumerate(block):
                row = list(raw) + [""] * (width - len(raw))
                if any(str(value or "").strip() for value in row):
                    rows.append({"source_row": source_row + offset, "values": row[:width]})
        data = {
            "sheet": worksheet.title,
            "start_row": PRODUCTION_START_ROW,
            "groups": normalized_groups,
            "headers": normalized_headers,
            "rows": rows,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        PRODUCTION_CACHE.update({"at": now, "data": data})
        return data


def import_production_from_google() -> dict:
    """Importación administrativa de una sola vez; la web no llama esta función."""
    with PRODUCTION_CACHE_LOCK:
        PRODUCTION_CACHE.update({"at": 0.0, "data": None})
    data = read_production_sheet()
    db = connect()
    try:
        db.execute("DELETE FROM production_rows")
        db.executemany(
            "INSERT INTO production_rows(source_row, values_json, sort_order) VALUES (?, ?, ?)",
            [(int(row["source_row"]), json.dumps(row["values"], ensure_ascii=False), index) for index, row in enumerate(data["rows"], start=1)],
        )
        meta = {
            "sheet": data.get("sheet", "PRODUCCIÓN LOCAL"),
            "start_row": str(data.get("start_row", PRODUCTION_START_ROW)),
            "groups": json.dumps(data.get("groups", []), ensure_ascii=False),
            "headers": json.dumps(data.get("headers", []), ensure_ascii=False),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        db.executemany(
            "INSERT OR REPLACE INTO production_meta(key, value) VALUES (?, ?)",
            list(meta.items()),
        )
        db.commit()
        return {"rows": len(data["rows"]), "updated_at": meta["updated_at"]}
    finally:
        db.close()


def parse_production_date(value: str):
    text = str(value or "").strip().lower().replace(".", "")
    if not text:
        return None
    months = {
        "ene": 1, "enero": 1, "jan": 1, "feb": 2, "febrero": 2,
        "mar": 3, "marzo": 3, "abr": 4, "abril": 4, "apr": 4,
        "may": 5, "mayo": 5, "jun": 6, "junio": 6, "jul": 7,
        "julio": 7, "ago": 8, "agosto": 8, "aug": 8, "sept": 9,
        "sep": 9, "septiembre": 9, "oct": 10, "octubre": 10,
        "nov": 11, "noviembre": 11, "dic": 12, "diciembre": 12, "dec": 12,
    }
    match = re.fullmatch(r"(\d{1,2})[-/\s]([a-záéíóú]+|\d{1,2})[-/\s](\d{2,4})", text)
    if not match:
        return None
    day, month_text, year = match.groups()
    month = int(month_text) if month_text.isdigit() else months.get(month_text)
    if not month:
        return None
    year = int(year)
    if year < 100:
        year += 2000
    try:
        return datetime(year, month, int(day)).date()
    except ValueError:
        return None


def business_days_remaining(value: str):
    due = parse_production_date(value)
    if not due:
        return ""
    today = datetime.now(timezone(timedelta(hours=-5))).date()
    direction = 1 if due >= today else -1
    current = today
    total = 0
    while True:
        if current.weekday() < 5:
            total += 1
        if current == due:
            break
        current += timedelta(days=direction)
    return str(total if direction > 0 else -total)


def read_local_production() -> dict:
    db = connect()
    try:
        meta = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM production_meta")}
        if not meta.get("headers"):
            raise RuntimeError("La base local de Producción todavía no ha sido inicializada")
        rows = [
            {"source_row": row["source_row"], "values": json.loads(row["values_json"])}
            for row in db.execute("SELECT source_row, values_json FROM production_rows ORDER BY COALESCE(sort_order, source_row), source_row")
        ]
        headers = json.loads(meta["headers"])
        normalized = [str(header or "").strip().upper() for header in headers]
        identity_indexes = [
            index for index, title in enumerate(normalized)
            if title in {"ORDEN", "NOMBRE DEL CLIENTE", "REFERENCIA"}
        ]
        rows.sort(
            key=lambda row: not any(
                index < len(row["values"]) and str(row["values"][index] or "").strip()
                for index in identity_indexes
            )
        )
        due_index = next((index for index, title in enumerate(normalized) if title == "FECHA DE ENTREGA"), -1)
        days_index = next((index for index, title in enumerate(normalized) if "DÍAS ENTREGA FINAL" in title or "DIAS ENTREGA FINAL" in title), -1)
        if due_index >= 0 and days_index >= 0:
            for row in rows:
                row["values"][days_index] = business_days_remaining(row["values"][due_index])
        groups = json.loads(meta["groups"])
        started = {(r["source_row"], r["column_number"] - 1): r["id"]
                   for r in db.execute("SELECT id,source_row,column_number FROM production_started ORDER BY id")}
        finished = {}
        for event in db.execute("SELECT id,source_row,column_number,value FROM production_finished ORDER BY id"):
            finished[(event["source_row"], event["column_number"] - 1, event["value"])] = event["id"]
        def process_label(i):
            stage = official_process(headers[i]) if i < len(headers) else None
            return PROCESS_FLOW[stage]['label'] if stage is not None else ''
        for row in rows:
            values = row["values"]
            active = [i for i, value in enumerate(values) if i < len(headers) and process_label(i) and str(value).strip().upper() == "P"]
            completed = [(i, parse_production_date(value)) for i, value in enumerate(values)
                         if i < len(headers) and process_label(i)]
            completed = [(i, date) for i, date in completed if date]
            if active:
                i = max(active, key=lambda i: (started.get((row["source_row"], i), 0), i))
                row["current_process"] = {"label": process_label(i), "state": "active"}
            elif completed:
                i, _date = max(completed, key=lambda item: (
                    finished.get((row["source_row"], item[0], str(values[item[0]])), 0),
                    item[1].toordinal(), item[0]))
                row["current_process"] = {"label": process_label(i), "state": "finished"}
            else:
                row["current_process"] = {"label": "Sin iniciar", "state": "pending"}
        return sheets_sync.decorate(db, {
            "sheet": meta.get("sheet", "PRODUCCIÓN LOCAL"),
            "start_row": int(meta.get("start_row", PRODUCTION_START_ROW)),
            "groups": json.loads(meta["groups"]),
            "headers": headers,
            "rows": rows,
            "updated_at": meta.get("updated_at", datetime.now(timezone.utc).isoformat()),
            "source": "local",
            "process_responsibles": {f"{event['source_row']}:{event['column_number']}": event['responsible'] for event in db.execute("SELECT source_row,column_number,responsible FROM production_operator_events WHERE action IN ('start','rework','finish','na') ORDER BY id")} if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_operator_events'").fetchone() else {},
            "auto_closed": [f"{event['source_row']}:{event['column_number']}" for event in db.execute("SELECT source_row,column_number FROM production_operator_events WHERE action='Cierre automático'")] if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_operator_events'").fetchone() else [],
            "paused": {f"{p['source_row']}:{p['column_number']}": p["created_at"]
                       for p in db.execute("SELECT source_row,column_number,created_at FROM production_paused")}
                      if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='production_paused'").fetchone() else {},
            "notes": {f"{n['source_row']}:{n['column_number']}": n["note"]
                      for n in db.execute("SELECT source_row,column_number,note FROM production_notes")},
            "note_entries": {f"{n['source_row']}:{n['column_number']}": [{"text": n["note"], "author": n["username"]}]
                             for n in db.execute("SELECT source_row,column_number,note,username FROM production_notes")},
        })
    finally:
        db.close()


@app.put("/api/produccion/nota")
def save_production_note(payload: dict = Body(...), _=Depends(authenticate)):
    row, column, note = payload.get("row"), payload.get("column"), payload.get("note")
    if type(row) is not int or type(column) is not int or not isinstance(note, str) or len(note) > 5000:
        raise HTTPException(400, "Nota inválida. Máximo 5000 caracteres.")
    with connect() as db:
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row=?", (row,)).fetchone()
        if not record or not 1 <= column <= len(json.loads(record["values_json"])):
            raise HTTPException(404, "La celda ya no existe")
        now = datetime.now(timezone.utc).isoformat()
        note = note.strip()
        if note:
            db.execute("INSERT OR REPLACE INTO production_notes VALUES (?,?,?,?,?)", (row, column, note, str(_), now))
        else:
            db.execute("DELETE FROM production_notes WHERE source_row=? AND column_number=?", (row, column))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (now,))
    return {"ok": True, "note": note, "author": str(_)}


def _edicion_en_proceso() -> list[dict]:
    """Tarjetas de producción cuyo proceso EDICIÓN está en proceso (columna con «P»): [{'clave', 'orden', 'ref', 'usuario'}]."""
    plano = lambda v: re.sub(r'\s+', '', str(v or '')).upper()
    with connect() as db:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key, value FROM production_meta')}
        headers = json.loads(meta.get('headers') or '[]')
        titulos = [str(h or '').strip().upper() for h in headers]
        if 'ORDEN' not in titulos or 'REFERENCIA' not in titulos:
            return []
        i_orden, i_ref = titulos.index('ORDEN'), titulos.index('REFERENCIA')
        etapa = official_process('EDICION')
        columnas = [i for i, h in enumerate(headers) if etapa is not None and official_process(h) == etapa]
        resultado = []
        for r in db.execute('SELECT source_row, values_json FROM production_rows ORDER BY source_row'):
            v = json.loads(r['values_json'])
            if not any(i < len(v) and str(v[i]).strip().upper() == 'P' for i in columnas):
                continue
            orden, ref = plano(v[i_orden] if i_orden < len(v) else ''), plano(v[i_ref] if i_ref < len(v) else '')
            if not orden:
                continue
            usuario = ''
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='production_operator_events'").fetchone():
                marcas = ','.join('?' * len(columnas)) or '0'
                ev = db.execute(f"SELECT username FROM production_operator_events WHERE source_row=? AND action='start' AND column_number IN ({marcas}) ORDER BY id DESC LIMIT 1",
                                (r['source_row'], *[c + 1 for c in columnas])).fetchone()
                usuario = ev['username'] if ev else ''
                if usuario and not permisos_mod.puede(usuario, 'agentes', 'ver'):
                    usuario = ''   # quien la puso en proceso no usa los agentes: el aviso va a quien los usó por última vez
            resultado.append({'clave': f'{orden}|{ref}', 'orden': orden, 'ref': ref, 'usuario': usuario})
        return resultado


def _vigilar_edicion():
    """Cada 30 s: si una tarjeta pasó a EDICIÓN en proceso, arranca los agentes con esa orden (ver agentes_canal.auto_procesar)."""
    while True:
        try:
            lanzadas = agentes_mod.auto_procesar(_edicion_en_proceso())
            if lanzadas:
                logging.info('Agentes: inicio automático para %s (EDICIÓN en proceso)', ', '.join(lanzadas))
        except Exception:
            logging.exception('No se pudo revisar las tarjetas de EDICIÓN para el inicio automático de los agentes')
        time.sleep(30)


def _terry_nota_en_sheet(source_row: int, orden: str, referencia: str, mts: str) -> dict:
    """Escribe «REFERENCIA : NN,NN MTS» como nota de la celda de la columna 17 de la hoja de producción en Google Sheets.
    Antes comprueba EN VIVO que esa fila del Sheet sea la misma orden y referencia (las filas pueden moverse) y que la celda no tenga ya MTS."""
    import gspread
    plano = lambda v: re.sub(r'\s+', '', str(v or '')).upper()
    try:
        with connect() as db:
            link = db.execute('SELECT sheet_row FROM production_sheet_links WHERE source_row=?', (source_row,)).fetchone()
        if not link:
            return {'sheet': False, 'sheet_motivo': 'La tarjeta no está enlazada a una fila del Google Sheets'}
        fila = int(link['sheet_row'])
        ws = legacy.get_gspread()
        vivos = ws.row_values(fila)
        if len(vivos) < 7 or plano(vivos[4]) != plano(orden) or plano(vivos[6]) != plano(referencia):
            return {'sheet': False, 'sheet_motivo': f'La fila {fila} del Google Sheets ya no corresponde a {orden} / {referencia}; no escribí nada allá'}
        titulo = ws.title.replace("'", "''")
        meta = ws.spreadsheet.fetch_sheet_metadata(params={'ranges': f"'{titulo}'!{gspread.utils.rowcol_to_a1(fila, 17)}", 'includeGridData': 'true',
                                                          'fields': 'sheets(data(rowData(values(note))))'})
        previa = ''
        for hoja in meta.get('sheets', []):
            for bloque in hoja.get('data', []):
                for fila_datos in bloque.get('rowData', []):
                    for celda in fila_datos.get('values', []):
                        previa = celda.get('note', '') or previa
        if re.search(r'\d+(?:[.,]\d+)?\s*MTS', previa, re.I):
            return {'sheet': False, 'sheet_motivo': f'La celda del Sheet ya tiene MTS ({previa.strip()}); no la cambié'}
        linea = f"{referencia} : {mts}"
        ws.update_note(gspread.utils.rowcol_to_a1(fila, 17), (previa.strip() + '\n' + linea) if previa.strip() else linea)
        return {'sheet': True, 'sheet_fila': fila}
    except Exception as exc:  # noqa: BLE001
        logging.exception('TERRY: no se pudo escribir el MTS en Google Sheets')
        return {'sheet': False, 'sheet_motivo': f'No pude escribir en Google Sheets: {exc}'}


def _terry_guardar_mts(orden: str, referencia: str, texto: str) -> dict:
    """Escribe «NN.NN MTS» en la nota de MTS REQUERIDOS (columna 17) de la tarjeta de la orden. No pisa un valor puesto por una persona."""
    plano = lambda v: re.sub(r'\s+', '', str(v or '')).upper()
    with connect() as db:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key, value FROM production_meta')}
        titulos = [str(h or '').strip().upper() for h in json.loads(meta.get('headers') or '[]')]
        if 'ORDEN' not in titulos or 'REFERENCIA' not in titulos:
            return {'ok': False, 'motivo': 'Producción no tiene las columnas ORDEN y REFERENCIA'}
        i_orden, i_ref = titulos.index('ORDEN'), titulos.index('REFERENCIA')
        filas = [r['source_row'] for r in db.execute('SELECT source_row, values_json FROM production_rows ORDER BY source_row')
                 if len(json.loads(r['values_json'])) > max(i_orden, i_ref)
                 and plano(json.loads(r['values_json'])[i_orden]) == plano(orden) and plano(json.loads(r['values_json'])[i_ref]) == plano(referencia)]
        if not filas:
            return {'ok': False, 'motivo': f'No encontré en Producción la orden {orden} con la referencia {referencia}'}
        fila = filas[0]
        del_sheet = db.execute('SELECT note FROM production_sheet_notes WHERE source_row=? AND column_number=17', (fila,)).fetchone() \
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='production_sheet_notes'").fetchone() else None
        if del_sheet and re.search(r'\d+(?:[.,]\d+)?\s*MTS', del_sheet[0], re.I):   # el equipo ya registró los MTS en el Sheet: no se pisan
            return {'ok': False, 'fila': fila, 'motivo': f'El Sheet ya tiene MTS registrados en esa tarjeta ({del_sheet[0].strip()}); no los cambié'}
        previa = db.execute('SELECT note, username FROM production_notes WHERE source_row=? AND column_number=17', (fila,)).fetchone()
        if previa and previa['note'].strip() and previa['username'] != 'TERRY':
            return {'ok': False, 'fila': fila, 'motivo': f"La tarjeta ya tiene MTS registrados ({previa['note'].strip()}) por {previa['username']}; no los cambié"}
        ahora = datetime.now(timezone.utc).isoformat()
        db.execute('INSERT OR REPLACE INTO production_notes VALUES (?,?,?,?,?)', (fila, 17, texto, 'TERRY', ahora))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (ahora,))
    resultado = {'ok': True, 'fila': fila}
    resultado.update(_terry_nota_en_sheet(fila, orden, referencia, texto.replace('.', ',')))   # también en el Google Sheets (por ahora)
    return resultado


agentes_mod.configurar_mts(_terry_guardar_mts)


@app.get("/api/produccion")
async def production_data(force: bool = False, _=Depends(authenticate)):
    try:
        return await asyncio.to_thread(read_local_production)
    except Exception as exc:
        logging.exception("No se pudo consultar la base local de producción")
        raise HTTPException(503, f"No se pudo abrir Producción: {exc}") from exc


PROCESS_STATUS_HEADERS = {
    "EDICION", "MATERIALES ESPECIALES", "MTS REQUERIDO", "IMPRESION",
    "SUBLIMACION", "CORTE LASER", "TRAZO", "BORDADO",
    "TEXTURIZADO-APLIQUE-BORDADO", "INSUMOS", "EMPACADO Y EMBALAJE",
    "ENTREGADO", "FACTURADO",
}


def is_process_status_header(header):
    normalized = "".join(c for c in unicodedata.normalize("NFD", str(header or ""))
                         if not unicodedata.combining(c)).strip().upper()
    return normalized in PROCESS_STATUS_HEADERS


OPERATOR_PROCESS_HEADERS = PROCESS_STATUS_HEADERS | {'DISEÑO', 'DISENO', 'CONFECCION', 'CORTE TEXTIL', 'CORTE TEXTIL/PLT'}

PROCESS_FLOW = json.loads(Path(__file__).with_name('process-flow.json').read_text(encoding='utf-8'))


def official_process(header):
    key = ''.join(c for c in unicodedata.normalize('NFD', str(header)) if not unicodedata.combining(c)).strip().upper()
    return next((i for i, process in enumerate(PROCESS_FLOW) if key in process['headers']), None)


def fresh_production_values(values, headers, groups):
    """Keep the order specifications, never copy execution state into a new order."""
    result = list(values)
    for i, header in enumerate(headers):
        title = str(header).strip().upper()
        group = str(groups[i] if i < len(groups) else '').strip('" ').upper()
        operational = group and group != 'GENERAL' and 'LINEA PRODUCCION' not in group and 'METODOLOG' not in group
        status = official_process(header) is not None or title in ('CORTE TEXTIL', 'CORTE TEXTIL/PLT', 'TRAZO')
        if status or (operational and (title.startswith(('RESP', 'HORA ')) or title in ('ESTADO', 'CONFECCIONISTA'))):
            result[i] = ''
    return result


def archive_production_activity(db, row, reason):
    """Recoverably separate a prior lifecycle from an explicitly reset order."""
    db.execute('CREATE TABLE IF NOT EXISTS production_activity_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, source_table TEXT, payload TEXT, reason TEXT, archived_at TEXT)')
    now = datetime.now(timezone.utc).isoformat()
    counts = {}
    for table in ('production_notes', 'production_started', 'production_finished', 'production_rework', 'production_operator_events'):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        records = [dict(r) for r in db.execute(f'SELECT * FROM {table} WHERE source_row=?', (row,))]
        counts[table] = len(records)
        if records:
            db.execute('INSERT INTO production_activity_archive(source_row,source_table,payload,reason,archived_at) VALUES (?,?,?,?,?)', (row,table,json.dumps(records,ensure_ascii=False),reason,now))
            db.execute(f'DELETE FROM {table} WHERE source_row=?', (row,))
    return counts


def operator_process_header(header):
    key = ''.join(c for c in unicodedata.normalize('NFD', str(header)) if not unicodedata.combining(c)).strip().upper()
    return key in OPERATOR_PROCESS_HEADERS


def ensure_operator_events(db):
    db.execute('CREATE TABLE IF NOT EXISTS production_operator_events (id INTEGER PRIMARY KEY, source_row INTEGER, column_number INTEGER, action TEXT, username TEXT, responsible TEXT, reason TEXT, created_at TEXT)')


def ensure_paused(db):
    # Pausa de un proceso en curso: la celda sigue en "P" (no se pierde el inicio ni los rollos apartados).
    db.execute('CREATE TABLE IF NOT EXISTS production_paused (source_row INTEGER, column_number INTEGER, username TEXT, created_at TEXT, PRIMARY KEY(source_row, column_number))')


DEPARTED_OPERATORS = ('ALEJANDRO MORA', 'AM', 'KEYNER PIEDRAHITA', 'K', 'CAROLINA OSORNO')


def is_departed_operator(responsible: str) -> bool:
    """Los operarios que ya no hacen parte de la empresa no deben figurar en los tableros."""
    key = ''.join(c for c in unicodedata.normalize('NFD', str(responsible or '')) if not unicodedata.combining(c)).strip().upper()
    if not key:
        return False
    for gone in DEPARTED_OPERATORS:
        full = ''.join(c for c in unicodedata.normalize('NFD', gone) if not unicodedata.combining(c)).strip().upper()
        if key == full or (full.split(' ')[0] != full and key == full.split(' ')[0]):
            return True
    return False


# Por defecto, finalizar un proceso solo afecta a ese proceso (no se cierran los anteriores).
# PRODUCCION_CIERRE_AUTOMATICO=1 devuelve el comportamiento antiguo.
PRODUCCION_CIERRE_AUTOMATICO = os.getenv('PRODUCCION_CIERRE_AUTOMATICO', '0') == '1'


@app.post('/api/produccion/operacion')
def production_operator_action(payload: dict = Body(...), _=Depends(authenticate)):
    row, column, action = payload.get('row'), payload.get('column'), payload.get('action')
    if type(row) is not int or type(column) is not int or action not in ('start', 'rework', 'finish', 'na', 'clear', 'pause', 'resume'):
        raise HTTPException(400, 'Operación inválida')
    reason = str(payload.get('reason') or '').strip()
    responsible = str(_).strip()
    if not responsible or len(responsible) > 80:
        raise HTTPException(400, 'Indica el responsable (máximo 80 caracteres)')
    if len(reason) > 2000 or (action == 'rework' and not reason):
        raise HTTPException(400, 'El reproceso requiere un motivo de hasta 2000 caracteres')
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        record = db.execute('SELECT values_json FROM production_rows WHERE source_row=?', (row,)).fetchone()
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers, groups = json.loads(meta.get('headers', '[]')), json.loads(meta.get('groups', '[]'))
        if not record or not 1 <= column <= len(headers) or official_process(headers[column-1]) is None:
            raise HTTPException(400, 'Selecciona un proceso válido de esta orden')
        values = json.loads(record['values_json'])
        values.extend([''] * max(0, len(headers)-len(values)))
        previous = str(values[column-1] or '')
        if payload.get('expected') != previous:
            raise HTTPException(409, 'Otro usuario actualizó este proceso. Cierra y vuelve a abrir Producción.')
        if action in ('pause', 'resume'):
            if previous.strip().upper() != 'P':
                raise HTTPException(409, 'Solo se puede pausar o reanudar un proceso que está en curso.')
            ensure_paused(db)
            ensure_operator_events(db)
            paused = db.execute('SELECT 1 FROM production_paused WHERE source_row=? AND column_number=?', (row, column)).fetchone()
            if (action == 'pause') == bool(paused):
                raise HTTPException(409, 'El proceso ya está ' + ('pausado.' if paused else 'en curso.') + ' Actualiza antes de continuar.')
            timestamp = datetime.now(timezone(timedelta(hours=-5))).isoformat()
            if action == 'pause':
                db.execute('INSERT INTO production_paused(source_row,column_number,username,created_at) VALUES (?,?,?,?)', (row, column, str(_), timestamp))
            else:
                db.execute('DELETE FROM production_paused WHERE source_row=? AND column_number=?', (row, column))
            db.execute('INSERT INTO production_operator_events(source_row,column_number,action,username,responsible,reason,created_at) VALUES (?,?,?,?,?,?,?)', (row, column, action, str(_), responsible, reason, timestamp))
            db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (timestamp,))
            db.commit()
            return {'ok': True, 'values': values, 'created_at': timestamp, 'paused': action == 'pause'}
        if action not in ('rework', 'clear') and (previous.strip().upper() == 'N/A' or parse_production_date(previous)):
            raise HTTPException(409, 'Este proceso ya fue terminado. Para reabrirlo registra un reproceso con su motivo.')
        if action == 'clear' and not previous.strip():
            raise HTTPException(409, 'Este proceso ya está vacío.')
        now = datetime.now(timezone(timedelta(hours=-5)))
        timestamp = now.isoformat()
        value = {'start':'P', 'rework':'R', 'finish':now.strftime('%d/%m/%Y'), 'na':'N/A', 'clear':''}[action]
        if previous == value and action in ('start','finish','na'):
            raise HTTPException(409, 'El proceso ya tiene ese estado. Actualiza antes de continuar.')
        values[column-1] = value
        process_index = official_process(headers[column-1])
        # Multiple legacy applique columns belong to one official production stage.
        for i, header in enumerate(headers):
            if i != column-1 and official_process(header) == process_index and str(values[i] or '').strip().upper() in ('', 'P', 'R'):
                values[i] = value
        group = groups[column-1] if column <= len(groups) else ''
        # Keep existing layout and stamp the process's own time/responsible fields.
        for i in range(column, len(headers)):
            if i >= len(groups) or groups[i] != group or operator_process_header(headers[i]):
                break
            title = str(headers[i]).strip().upper()
            if action == 'start' and title == 'HORA INICIO': values[i] = now.strftime('%H:%M')
            if action == 'start' and title == 'HORA FINAL': values[i] = ''
            if action == 'finish' and title == 'HORA FINAL': values[i] = now.strftime('%H:%M')
            if title.startswith('RESP') or title == 'CONFECCIONISTA': values[i] = responsible
        ensure_operator_events(db)
        ensure_paused(db)
        db.execute('DELETE FROM production_paused WHERE source_row=? AND column_number=?', (row, column))
        db.execute('INSERT INTO production_operator_events(source_row,column_number,action,username,responsible,reason,created_at) VALUES (?,?,?,?,?,?,?)', (row,column,action,str(_),responsible,reason,timestamp))
        if action == 'start': db.execute('INSERT INTO production_started(source_row,column_number,created_at) VALUES (?,?,?)',(row,column,timestamp))
        if action == 'finish':
            for prior_index in (range(process_index) if PRODUCCION_CIERRE_AUTOMATICO else ()):
                indexes = [i for i, header in enumerate(headers) if official_process(header) == prior_index]
                changed = []
                # Preserve existing dates, N/A, quantities, responsible users and actual times.
                for i in indexes:
                    if operator_process_header(headers[i]) and str(values[i] or '').strip().upper() in ('', 'P', 'R'):
                        values[i] = value
                        changed.append(i)
                        db.execute('INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)',(row,i+1,value,timestamp))
                if not changed:
                    continue
                automatic_reason = f'Cierre automático al terminar {headers[column-1]}. No indica la hora real de ejecución del proceso anterior.'
                db.execute('INSERT INTO production_operator_events(source_row,column_number,action,username,responsible,reason,created_at) VALUES (?,?,?,?,?,?,?)',(row,changed[0]+1,'Cierre automático',str(_),'Sin atribuir',automatic_reason,timestamp))
            db.execute('INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)',(row,column,value,timestamp))
        if action == 'rework': db.execute('INSERT INTO production_rework(source_row,column_number,process,reason,username,created_at) VALUES (?,?,?,?,?,?)',(row,column,group,reason,str(_),timestamp))
        db.execute('UPDATE production_rows SET values_json=? WHERE source_row=?',(json.dumps(values,ensure_ascii=False),row))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)",(timestamp,))
        db.commit()
        return {'ok':True,'values':values,'created_at':timestamp}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get('/api/produccion/operaciones/{row}')
def production_operator_history(row: int, _=Depends(authenticate)):
    db = connect()
    try:
        ensure_operator_events(db)
        db.commit()
        return [dict(r) for r in db.execute('SELECT id,column_number,action,username,responsible,reason,created_at FROM production_operator_events WHERE source_row=? ORDER BY id DESC LIMIT 100',(row,))]
    finally:
        db.close()


@app.patch('/api/produccion/operaciones/evento/{event_id}')
def update_production_rework_event(event_id: int, payload: dict = Body(...), _=Depends(authenticate)):
    reason = str(payload.get('reason') or '').strip()
    if not reason or len(reason) > 2000:
        raise HTTPException(400, 'Escribe una observación entre 1 y 2000 caracteres')
    with connect() as db:
        event = db.execute('SELECT source_row,column_number,action,username,created_at FROM production_operator_events WHERE id=?', (event_id,)).fetchone()
        if not event:
            raise HTTPException(404, 'El reproceso ya no existe')
        if event['action'] != 'rework':
            raise HTTPException(400, 'Solo se pueden editar observaciones de reproceso')
        db.execute('UPDATE production_operator_events SET reason=? WHERE id=?', (reason, event_id))
        db.execute('UPDATE production_rework SET reason=? WHERE source_row=? AND column_number=? AND username=? AND created_at=?', (reason, event['source_row'], event['column_number'], event['username'], event['created_at']))
        db.commit()
    return {'ok': True, 'reason': reason}


@app.delete('/api/produccion/operaciones/evento/{event_id}')
def delete_production_operator_event(event_id: int, _=Depends(authenticate)):
    db = connect()
    try:
        ensure_operator_events(db)
        event = db.execute('SELECT source_row,column_number,action,username,created_at FROM production_operator_events WHERE id=?', (event_id,)).fetchone()
        if not event:
            raise HTTPException(404, "La nota ya no existe")
        if event['action'] == 'rework':
            profile = db.execute('SELECT process FROM users WHERE name=? COLLATE NOCASE', (_,)).fetchone()
            if not profile or not can_delete_rework_profile(profile['process']):
                raise HTTPException(403, 'Solo el área Administrativa y Coordinación pueden eliminar reprocesos')
        deleted = db.execute('DELETE FROM production_operator_events WHERE id=?', (event_id,)).rowcount
        if event['action'] == 'rework':
            db.execute('DELETE FROM production_rework WHERE source_row=? AND column_number=? AND username=? AND created_at=?', (event['source_row'], event['column_number'], event['username'], event['created_at']))
        db.commit()
        if not deleted:
            raise HTTPException(404, "La nota ya no existe")
        return {'ok': True}
    finally:
        db.close()


def _sheets_sync_flag():
    return STATE_DIR / 'sheets-sync-enabled'


@app.get('/api/produccion/sheets-sync/estado')
def sheets_sync_estado(_=Depends(authenticate)):
    db = connect()
    try:
        meta = dict(db.execute("SELECT key,value FROM production_meta WHERE key LIKE 'sheets_sync_%'"))
    finally:
        db.close()
    return {
        'enabled': _sheets_sync_flag().exists(),
        'resync': (STATE_DIR / 'sheets-sync-resync').exists(),
        'checked_at': meta.get('sheets_sync_checked_at'),
        'error': meta.get('sheets_sync_error', ''),
        'counts': json.loads(meta['sheets_sync_counts']) if meta.get('sheets_sync_counts') else None,
    }


@app.post('/api/produccion/sheets-sync/activar')
def sheets_sync_activar(_=Depends(authenticate)):
    """Vincula la hoja de Google Sheets: desde este momento, las filas nuevas que se
    agreguen ahi (o se editen) se importan a Produccion automaticamente cada 30s.
    No borra ni sobrescribe nada que ya exista solo en la web (ver sheets_sync.apply)."""
    flag = _sheets_sync_flag()
    flag.parent.mkdir(parents=True, exist_ok=True)
    marker = STATE_DIR / 'sheets-sync-desvinculado'
    if marker.exists():
        # Estaba desvinculada: al volver a conectar se iguala TODO al Google Sheets (con copia de seguridad).
        (STATE_DIR / 'sheets-sync-resync').touch(exist_ok=True)
    marker.unlink(missing_ok=True)
    flag.touch(exist_ok=True)
    return {'ok': True, 'enabled': True, 'resync': (STATE_DIR / 'sheets-sync-resync').exists()}


@app.post('/api/produccion/sheets-sync/desactivar')
def sheets_sync_desactivar(_=Depends(authenticate)):
    _sheets_sync_flag().unlink(missing_ok=True)
    (STATE_DIR / 'sheets-sync-desvinculado').touch(exist_ok=True)  # se recuerda aunque el servidor se reinicie
    return {'ok': True, 'enabled': False}


@app.get('/api/produccion/backup/estado')
def backup_estado(_=Depends(authenticate)):
    return db_backup.status


@app.post('/api/produccion/backup/ahora')
def backup_ahora(_=Depends(authenticate)):
    try:
        db_backup.run_once(DB_PATH, STATE_DIR, legacy.get_supabase)
    except Exception as error:
        raise HTTPException(500, f"No se pudo hacer la copia de seguridad: {error}")
    return {'ok': True, **db_backup.status}


OPERATOR_SHEET_GID = 1538767125
OPERATOR_SHEET_TTL_SECONDS = 90
_operator_sheet_cache = {"at": 0.0, "data": None, "error": None}


def parse_operator_sheet(values: list) -> dict:
    """Interpreta CONTROL OPERARIOS: fila 1 = area (celdas combinadas), fila 2 = codigo
    de operario, columna A = fecha, y cada celda la cantidad que cerro ese operario
    ese dia. Se lee tal cual esta en la hoja, sin una lista fija de codigos."""
    if len(values) < 3:
        return {"areas": [], "columns": [], "daily": {}}
    header_area, header_code = values[0], values[1]
    width = max(len(header_area), len(header_code))
    columns = []
    current_area = ""
    for i in range(1, width):
        area_cell = header_area[i].strip() if i < len(header_area) else ""
        if area_cell:
            current_area = area_cell
        code = header_code[i].strip() if i < len(header_code) else ""
        if code:
            columns.append({"index": i, "area": current_area, "code": code})
    daily: dict = {}
    for row in values[2:]:
        if not row or not str(row[0]).strip():
            continue
        date_value = parse_production_date(str(row[0]).strip())
        if not date_value:
            continue
        date_iso = date_value.isoformat()
        for col in columns:
            if col["index"] >= len(row):
                continue
            raw = str(row[col["index"]]).strip().replace(",", ".")
            if not raw:
                continue
            try:
                count = int(float(raw))
            except ValueError:
                continue
            if count <= 0:
                continue
            by_date = daily.setdefault(col["code"], {})
            by_date[date_iso] = by_date.get(date_iso, 0) + count
    # En el orden en que aparecen las columnas en la hoja (de izquierda a derecha), que es
    # el mismo orden del proceso de producción; no alfabético.
    areas = list(dict.fromkeys(col["area"] for col in columns if col["area"]))
    return {"areas": areas, "columns": columns, "daily": daily}


def read_operator_sheet(force: bool = False):
    """Lee en vivo la pestaña CONTROL OPERARIOS de Google Sheets (solo lectura),
    reutilizando la misma conexion autenticada que ya usa Produccion. Se guarda en
    caché un par de minutos para no golpear la API de Google en cada actualización."""
    cache = _operator_sheet_cache
    now = time.time()
    if not force and cache["data"] is not None and now - cache["at"] < OPERATOR_SHEET_TTL_SECONDS:
        return cache["data"], cache["error"]
    try:
        production_worksheet = legacy.get_gspread()
        operator_worksheet = production_worksheet.spreadsheet.get_worksheet_by_id(OPERATOR_SHEET_GID)
        values = operator_worksheet.get_all_values()
        data = parse_operator_sheet(values)
        cache.update(at=now, data=data, error=None)
        return data, None
    except Exception as error:
        logging.exception("No se pudo leer CONTROL OPERARIOS desde Google Sheets")
        message = str(error) or error.__class__.__name__
        if cache["data"] is not None:
            return cache["data"], message
        cache.update(at=now, data=None, error=message)
        return None, message


ACTION_LABELS = {'start': 'Inicio', 'finish': 'Finalizado', 'rework': 'Reproceso', 'na': 'No aplica',
                 'clear': 'Reiniciado', 'pause': 'Pausa', 'resume': 'Reanudó'}


def _plain_text(value) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).upper().strip()


def _initials(name) -> str:
    return ''.join(word[0] for word in _plain_text(name).split() if word)


@app.get('/api/produccion/operarios/informe')
def production_operators_report(desde: str = '', hasta: str = '', operario: str = '', _=Depends(authenticate)):
    """Informe en Excel de lo que hizo cada operario en un periodo (por defecto, el mes actual)."""
    import io
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    tz = timezone(timedelta(hours=-5))
    today = datetime.now(tz).date()
    try:
        first = datetime.strptime(desde, '%Y-%m-%d').date() if desde else today.replace(day=1)
        last = datetime.strptime(hasta, '%Y-%m-%d').date() if hasta else today
    except ValueError:
        raise HTTPException(400, 'Las fechas deben tener el formato AAAA-MM-DD')
    if first > last:
        first, last = last, first
    if (last - first).days > 366:
        raise HTTPException(400, 'El periodo no puede superar un año')
    person = _plain_text(operario)
    db = connect()
    try:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers = json.loads(meta.get('headers', '[]'))
        order_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), -1)
        client_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'NOMBRE DEL CLIENTE'), -1)
        quantity_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'CANTIDAD'), -1)
        rows_values = {r['source_row']: json.loads(r['values_json']) for r in db.execute('SELECT source_row,values_json FROM production_rows')}
        events = db.execute(
            "SELECT source_row,column_number,action,responsible,reason,created_at FROM production_operator_events "
            "WHERE responsible IS NOT NULL AND responsible<>'' AND responsible<>'Sin atribuir' AND substr(created_at,1,10)>=? AND substr(created_at,1,10)<=? ORDER BY id",
            (first.isoformat(), last.isoformat())).fetchall()
    finally:
        db.close()

    def cell(values, index):
        return str(values[index]).strip() if 0 <= index < len(values) else ''

    def quantity(values):
        try:
            return int(float(cell(values, quantity_idx).replace(',', '.')))
        except ValueError:
            return 0

    def process_label(column_number):
        index = (column_number or 0) - 1
        if not 0 <= index < len(headers):
            return ''
        process_index = official_process(headers[index])
        return PROCESS_FLOW[process_index]['label'] if process_index is not None else str(headers[index])

    detail, people = [], {}
    for event in events:
        name = event['responsible']
        if is_departed_operator(name):
            continue
        if person and person not in _plain_text(name) and person != _initials(name):
            continue
        values = rows_values.get(event['source_row'], [])
        created = str(event['created_at'] or '')
        day, hour = created[:10], created[11:19]
        label = process_label(event['column_number'])
        qty = quantity(values)
        record = people.setdefault(name, {'finish': 0, 'start': 0, 'rework': 0, 'units': 0, 'days': set(), 'first': '', 'last': '', 'by_day': {}, 'by_process': {}})
        action = event['action']
        if action in ('start', 'rework'):
            record[action] += 1
        if action == 'finish':
            record['finish'] += 1
            record['units'] += qty
            record['days'].add(day)
            record['by_day'][day] = record['by_day'].get(day, 0) + 1
            record['by_process'][label] = record['by_process'].get(label, 0) + 1
            stamp = day + ' ' + hour
            record['first'] = min(record['first'] or stamp, stamp)
            record['last'] = max(record['last'], stamp)
        detail.append((day, hour, name, label, ACTION_LABELS.get(action, action), cell(values, order_idx), cell(values, client_idx), qty, event['reason'] or ''))

    workbook = Workbook()
    head_fill, head_font = PatternFill('solid', fgColor='1F2B12'), Font(bold=True, color='D0F44C')
    total_fill = PatternFill('solid', fgColor='E8F2C8')

    def sheet(title, header, rows, first_sheet=False, note=None):
        ws = workbook.active if first_sheet else workbook.create_sheet()
        ws.title = title
        start = 1
        if note:
            ws.cell(1, 1, note[0]).font = Font(bold=True, size=14)
            for offset, line in enumerate(note[1:], start=2):
                ws.cell(offset, 1, line).font = Font(color='555555')
            start = len(note) + 2
        for column, text in enumerate(header, start=1):
            c = ws.cell(start, column, text)
            c.fill, c.font, c.alignment = head_fill, head_font, Alignment(horizontal='center', vertical='center', wrap_text=True)
        for r, row in enumerate(rows, start=start + 1):
            for column, value in enumerate(row, start=1):
                ws.cell(r, column, value)
        for column in range(1, len(header) + 1):
            width = max([len(str(header[column - 1]))] + [len(str(row[column - 1])) for row in rows[:300]] + [8])
            ws.column_dimensions[get_column_letter(column)].width = min(width + 3, 42)
        ws.freeze_panes = ws.cell(start + 1, 2)
        if rows:
            ws.auto_filter.ref = f'A{start}:{get_column_letter(len(header))}{start + len(rows)}'
        return ws, start

    ranking = sorted(people.items(), key=lambda pair: (-pair[1]['finish'], pair[0]))
    period = f"{first.strftime('%d/%m/%Y')} al {last.strftime('%d/%m/%Y')}"
    note = ['Informe de operarios · Indoor Sport', f'Periodo: {period}', 'Filtro de operario: ' + (operario or 'todos'),
            'Generado: ' + datetime.now(tz).strftime('%d/%m/%Y %H:%M') + ' · Cierres = procesos finalizados']
    rows = [(n, d['finish'], d['units'], len(d['days']), round(d['finish'] / len(d['days']), 1) if d['days'] else 0, d['start'], d['rework'], d['first'], d['last']) for n, d in ranking]
    ws, start = sheet('Resumen', ['Operario', 'Cierres', 'Unidades cerradas', 'Días con cierres', 'Cierres por día', 'Inicios', 'Reprocesos', 'Primer cierre', 'Último cierre'], rows, True, note)
    total_row = start + len(rows) + 1
    ws.cell(total_row, 1, 'TOTAL')
    for column, letter in ((2, 'B'), (3, 'C'), (6, 'F'), (7, 'G')):
        ws.cell(total_row, column, f'=SUM({letter}{start + 1}:{letter}{start + len(rows)})' if rows else 0)
    for column in range(1, 10):
        ws.cell(total_row, column).font, ws.cell(total_row, column).fill = Font(bold=True), total_fill

    days, cursor = [], first
    while cursor <= last:
        days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    rows = [(n, *[d['by_day'].get(day, 0) or None for day in days], d['finish']) for n, d in ranking]
    sheet('Cierres por día', ['Operario', *[day[8:10] + '/' + day[5:7] for day in days], 'Total'], rows)

    processes = sorted({label for _, d in ranking for label in d['by_process']})
    rows = [(n, *[d['by_process'].get(label, 0) or None for label in processes], d['finish']) for n, d in ranking]
    sheet('Cierres por proceso', ['Operario', *processes, 'Total'], rows)

    detail.sort(key=lambda r: (r[0], r[1]))
    sheet('Detalle', ['Fecha', 'Hora', 'Operario', 'Proceso', 'Acción', 'Orden', 'Cliente', 'Cantidad', 'Motivo'], detail)
    buffer = io.BytesIO()
    workbook.save(buffer)
    name = f"informe-operarios_{first.isoformat()}_{last.isoformat()}.xlsx"
    return Response(buffer.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition': f'attachment; filename="{name}"', 'Cache-Control': 'no-store'})


@app.get('/api/produccion/operarios')
def production_operators(refresh: bool = False, _=Depends(authenticate)):
    sheet_data, sheet_error = read_operator_sheet(force=refresh)
    db = connect()
    try:
        ensure_operator_events(db)
        db.commit()
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers = json.loads(meta.get('headers', '[]'))
        groups = json.loads(meta.get('groups', '[]'))
        order_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), -1)
        client_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'NOMBRE DEL CLIENTE'), -1)
        quantity_idx = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'CANTIDAD'), -1)
        rows_values = {r['source_row']: json.loads(r['values_json']) for r in db.execute('SELECT source_row,values_json FROM production_rows')}
        tz = timezone(timedelta(hours=-5))
        today = datetime.now(tz).date()
        today_start = datetime(today.year, today.month, today.day, tzinfo=tz).isoformat()
        events = db.execute(
            "SELECT source_row,column_number,action,responsible,reason,created_at FROM production_operator_events "
            "WHERE responsible IS NOT NULL AND responsible<>'' AND responsible<>'Sin atribuir' ORDER BY id"
        ).fetchall()
        operators: dict = {}
        finished_by_process: dict = {}
        daily: dict = {}
        daily_active: dict = {}
        daily_rework: dict = {}

        def process_label(column_number):
            index = column_number - 1
            if not 0 <= index < len(headers):
                return ''
            process_index = official_process(headers[index])
            return PROCESS_FLOW[process_index]['label'] if process_index is not None else str(headers[index])

        def row_quantity(values):
            if quantity_idx < 0 or quantity_idx >= len(values):
                return 0
            try:
                return int(float(str(values[quantity_idx]).replace(',', '.')))
            except ValueError:
                return 0

        # Estado final de cada (row, column) según eventos de operarios.
        # Solo se muestra P/R si el último evento registrado NO fue 'finish'.
        event_pending: dict = {}  # (source_row, col_number) → {day, qty, resp, kind}
        for event in events:
            responsible = event['responsible']
            if is_departed_operator(responsible):
                continue
            operator = operators.setdefault(responsible, {
                'responsible': responsible, 'current': None, 'today_count': 0, 'last_at': None,
            })
            label = process_label(event['column_number'])
            values = rows_values.get(event['source_row'], [])
            order = str(values[order_idx]).strip() if order_idx >= 0 and order_idx < len(values) else ''
            client = str(values[client_idx]).strip() if client_idx >= 0 and client_idx < len(values) else ''
            if event['action'] == 'start':
                operator['current'] = {
                    'row': event['source_row'], 'process': label, 'order': order, 'client': client,
                    'since': event['created_at'],
                }
            elif operator['current'] and operator['current']['row'] == event['source_row'] and operator['current']['process'] == label:
                operator['current'] = None
            if event['action'] == 'finish' and event['created_at'] >= today_start:
                operator['today_count'] += 1
                if label:
                    finished_by_process[label] = finished_by_process.get(label, 0) + 1
            if event['action'] == 'finish':
                day = str(event['created_at'] or '')[:10]
                if len(day) == 10:
                    days = daily.setdefault(responsible, {})
                    days[day] = days.get(day, 0) + 1
            key = (event['source_row'], event['column_number'])
            if event['action'] in ('start', 'rework'):
                day = str(event['created_at'] or '')[:10]
                if len(day) == 10:
                    event_pending[key] = {
                        'day': day, 'qty': row_quantity(values),
                        'resp': responsible,
                        'kind': 'active' if event['action'] == 'start' else 'rework',
                    }
            elif event['action'] == 'finish':
                event_pending.pop(key, None)
            if not operator['last_at'] or event['created_at'] > operator['last_at']:
                operator['last_at'] = event['created_at']
        today_str = today.isoformat()
        for info in event_pending.values():
            bucket = daily_active if info['kind'] == 'active' else daily_rework
            days_map = bucket.setdefault(info['resp'], {})
            # Proceso aún abierto: se muestra en HOY, no en el día en que se inició.
            days_map[today_str] = max(days_map.get(today_str, 0), info['qty'])

        # Complementar P/R historico con los cambios que llegan de Google Sheets.
        # Cuando la hoja cambia una celda a P o R, el sync lo registra en
        # production_sheet_audit; se usa ese timestamp para poblar daily_active/rework
        # por responsable, de modo que el calendario muestre datos reales de la hoja
        # aunque los operarios no hayan pulsado ningun boton en la app.
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='production_sheet_audit'").fetchone():
            resp_cols_by_group_pre: dict = {}
            process_cols_pre: dict = {}  # column_index -> process_label
            for idx, header in enumerate(headers):
                title = str(header or '').strip().upper()
                if title.startswith('RESP'):
                    group_value = str(groups[idx] if idx < len(groups) else '').strip('" ').upper()
                    resp_cols_by_group_pre.setdefault(group_value, []).append(idx)
                p_index = official_process(header)
                if p_index is not None:
                    label = PROCESS_FLOW[p_index]['label']
                    process_cols_pre[idx] = label
            # Rastrear el estado FINAL de cada celda (source_row, col_idx).
            # Si una celda pasó de P a una fecha (Terminado), solo cuenta Terminado;
            # P y R se muestran únicamente mientras ese es el estado actual de la celda.
            cell_final: dict = {}
            for audit_row in db.execute(
                'SELECT source_row, previous_values, new_values, created_at FROM production_sheet_audit ORDER BY id'
            ):
                day = str(audit_row['created_at'] or '')[:10]
                if len(day) != 10:
                    continue
                try:
                    prev = json.loads(audit_row['previous_values'])
                    curr = json.loads(audit_row['new_values'])
                except Exception:
                    continue
                row_vals = rows_values.get(audit_row['source_row'], curr)
                qty = row_quantity(row_vals)
                if qty <= 0:
                    continue
                for col_idx, _label in process_cols_pre.items():
                    if col_idx >= len(curr):
                        continue
                    new_val = str(curr[col_idx] or '').strip().upper()
                    old_val = str(prev[col_idx] if col_idx < len(prev) else '').strip().upper()
                    if new_val == old_val:
                        continue
                    if new_val in ('P', 'R'):
                        state = new_val
                    elif new_val:
                        state = 'T'  # Terminado: fecha u otro valor no vacío
                    else:
                        cell_final.pop((audit_row['source_row'], col_idx), None)
                        continue
                    group_key = str(groups[col_idx] if col_idx < len(groups) else '').strip('" ').upper()
                    resp_name = ''
                    for ri in resp_cols_by_group_pre.get(group_key, []):
                        if ri < len(row_vals) and str(row_vals[ri]).strip():
                            resp_name = str(row_vals[ri]).strip()
                            break
                    if not resp_name:
                        resp_name = 'Sin asignar'
                    cell_final[(audit_row['source_row'], col_idx)] = {
                        'state': state, 'day': day, 'qty': qty, 'resp': resp_name
                    }
            # Solo agregar P/R al calendario si ese sigue siendo el estado final.
            # Verificar también el valor actual en rows_values: si la celda ya tiene una
            # fecha u otro valor distinto de P/R, el proceso está Terminado aunque el
            # audit no haya capturado esa transición (p.ej. si el sync empezó después).
            for (src_row, col_idx), info in cell_final.items():
                if info['state'] == 'T':
                    continue
                current_row = rows_values.get(src_row)
                if current_row is not None and col_idx < len(current_row):
                    current_val = str(current_row[col_idx] or '').strip().upper()
                    if current_val and current_val not in ('P', 'R'):
                        continue  # ya está Terminado en Sheets
                bucket = daily_active if info['state'] == 'P' else daily_rework
                days_map = bucket.setdefault(info['resp'], {})
                # Proceso aún abierto: se muestra en HOY, no en el día original.
                days_map[today_str] = max(days_map.get(today_str, 0), info['qty'])
            # Escanear el estado ACTUAL de todas las filas para capturar P/R que
            # existían antes de que el audit empezara a rastrear (no aparecen en cell_final).
            for src_row, row_vals in rows_values.items():
                qty = row_quantity(row_vals)
                if qty <= 0:
                    continue
                for col_idx in process_cols_pre:
                    if col_idx >= len(row_vals):
                        continue
                    current_val = str(row_vals[col_idx] or '').strip().upper()
                    if current_val not in ('P', 'R'):
                        continue
                    group_key = str(groups[col_idx] if col_idx < len(groups) else '').strip('" ').upper()
                    resp_name = ''
                    for ri in resp_cols_by_group_pre.get(group_key, []):
                        if ri < len(row_vals) and str(row_vals[ri]).strip():
                            resp_name = str(row_vals[ri]).strip()
                            break
                    if not resp_name:
                        resp_name = 'Sin asignar'
                    bucket = daily_active if current_val == 'P' else daily_rework
                    days_map = bucket.setdefault(resp_name, {})
                    days_map[today_str] = max(days_map.get(today_str, 0), qty)

        # Unidades activas (P) y en reproceso (R) por area, leidas directamente del estado
        # actual de cada pedido en Produccion (misma logica que usa el Cronograma), no del
        # historial de eventos: es una foto de lo que hay AHORA mismo en cada proceso.
        # Tambien se reparte por responsable (columna RESP... de ese mismo grupo), para poder
        # mostrar el desglose por operario en la tarjeta de hoy.
        def normalize_group(value):
            return str(value or '').strip('" ').upper()

        def normalize_cell(value):
            text = ''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c))
            return text.strip().upper()

        resp_cols_by_group: dict = {}
        for index, header in enumerate(headers):
            if str(header or '').strip().upper().startswith('RESP'):
                group_value = normalize_group(groups[index] if index < len(groups) else '')
                resp_cols_by_group.setdefault(group_value, []).append(index)

        # Columnas de proceso en el orden en que aparecen en la hoja, que es el orden en que
        # la produccion avanza de izquierda a derecha.
        process_columns = [index for index, header in enumerate(headers) if official_process(header) is not None]
        due_index = next((index for index, header in enumerate(headers)
                          if str(header or '').strip().upper() in ('FECHA DE ENTREGA', 'FECHA ENTREGA')), -1)

        def process_cell_state(values, index):
            """'active' (P), 'rework' (R), 'closed' (fecha o N/A) o 'blank' de una celda de proceso."""
            cell = normalize_cell(values[index]) if index < len(values) else ''
            if cell == 'R':
                return 'rework'
            if cell == 'P':
                return 'active'
            return 'closed' if cell == 'N/A' or parse_production_date(cell) else 'blank'

        def current_process_state(values, today):
            """Proceso vigente de la orden HOY: el primero que sigue abierto ("P" o "R").

            Antes este tablero contaba la orden en TODOS los procesos que tuvieran "P" o "R",
            aunque ya los hubiera superado, y le sumaba la cantidad completa de la fila. Por eso
            una orden de 8 unidades en reproceso se veia como 26 (18 de una "R" vieja + 8).
            Ahora la orden se cuenta una sola vez, en el proceso donde esta de verdad, y una "R"
            vieja deja de contar cuando: todos los procesos posteriores ya estan cerrados (el
            pedido supero ese proceso) o su fecha de entrega ya vencio (todavia esta pendiente).
            Asi el tablero se actualiza solo conforme pasan los dias y se mueven las ordenes, en
            vez de arrastrar reprocesos de meses anteriores. "R" cuenta como abierto, igual que
            en la tarjeta de Trazabilidad."""
            for position, index in enumerate(process_columns):
                state = process_cell_state(values, index)
                if state not in ('active', 'rework'):
                    continue
                if all(process_cell_state(values, later) == 'closed'
                       for later in process_columns[position + 1:]):
                    return None, None
                if due_index >= 0 and due_index < len(values):
                    due = parse_production_date(str(values[due_index] or '').strip())
                    if due and due < today:
                        return None, None
                return index, state
            return None, None

        process_status: dict = {}
        for values in rows_values.values():
            index, state = current_process_state(values, today)
            if index is None:
                continue
            quantity = row_quantity(values)
            process_index = official_process(headers[index])
            label = PROCESS_FLOW[process_index]['label']
            state_key = 'rework_units' if state == 'rework' else 'active_units'
            bucket = process_status.setdefault(label, {'active_units': 0, 'rework_units': 0, 'by_responsible': {}})
            bucket[state_key] += quantity
            group_value = normalize_group(groups[index] if index < len(groups) else '')
            responsible_name = ''
            for ri in resp_cols_by_group.get(group_value, []):
                if ri < len(values) and str(values[ri]).strip():
                    responsible_name = str(values[ri]).strip()
                    break
            if responsible_name:
                person = bucket['by_responsible'].setdefault(responsible_name, {'active_units': 0, 'rework_units': 0})
                person[state_key] += quantity

        return {
            'today': today.isoformat(),
            'operators': sorted(operators.values(), key=lambda item: item['responsible'].casefold()),
            'finished_by_process': finished_by_process,
            'daily': daily,
            'daily_active': daily_active,
            'daily_rework': daily_rework,
            'process_status': process_status,
            'sheet': {
                'available': sheet_data is not None,
                'error': sheet_error,
                'areas': sheet_data['areas'] if sheet_data else [],
                'columns': sheet_data['columns'] if sheet_data else [],
                'daily_by_code': sheet_data['daily'] if sheet_data else {},
            },
        }
    finally:
        db.close()


def stamp_edition_start(values, headers, groups, column, previous, value):
    index = column - 1
    header = str(headers[index]).strip().upper() if index < len(headers) else ""
    if not is_process_status_header(header):
        return
    now = datetime.now(timezone(timedelta(hours=-5)))
    is_start = value.strip().upper() == "P"
    is_today = parse_production_date(value) == now.date()
    if not is_start and not is_today:
        return
    target_header = "HORA INICIO" if is_start else "HORA FINAL"
    group = groups[index] if index < len(groups) else None
    for start_index in range(index + 1, len(headers)):
        if group is not None and (start_index >= len(groups) or groups[start_index] != group):
            break
        title = str(headers[start_index]).strip().upper()
        if title in ("OK", "HORA INICIO") and title != target_header:
            continue
        if title != target_header:
            if is_process_status_header(title):
                continue
            break
        if len(values) <= start_index:
            values.extend([""] * (start_index + 1 - len(values)))
        if previous != value or not str(values[start_index] or "").strip():
            values[start_index] = now.strftime("%H:%M")
        break


@app.patch("/api/produccion/celda")
async def update_production_cell(payload: dict = Body(...), _=Depends(authenticate)):
    try:
        row = int(payload.get("row"))
        column = int(payload.get("column"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Fila o columna inválida") from exc
    value = str(payload.get("value", ""))
    if row < PRODUCTION_START_ROW or column < 1 or column > 83:
        raise HTTPException(400, "La celda está fuera del área editable de Producción")
    if len(value) > 5000:
        raise HTTPException(400, "El contenido de la celda es demasiado largo")
    try:
        db = connect()
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row = ?", (row,)).fetchone()
        if not record:
            db.close()
            raise HTTPException(404, "La fila no existe en la base local")
        values = json.loads(record["values_json"])
        if column > len(values):
            values.extend([""] * (column - len(values)))
        previous = values[column - 1]
        values[column - 1] = value
        header_record = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
        headers = json.loads(header_record["value"]) if header_record else []
        group_record = db.execute("SELECT value FROM production_meta WHERE key = 'groups'").fetchone()
        groups = json.loads(group_record["value"]) if group_record else []
        header = str(headers[column - 1]).strip().upper() if column <= len(headers) else ""
        if is_process_status_header(header) and value.strip().upper() == "R":
            reason = payload.get("reason")
            if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 2000:
                db.close()
                raise HTTPException(400, "Escribe el motivo del reproceso (máximo 2000 caracteres)")
            value = "R"
            values[column - 1] = value
            db.execute("INSERT INTO production_rework(source_row, column_number, process, reason, username, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                       (row, column, str(groups[column - 1]) if column <= len(groups) else header,
                        reason.strip(), str(_), datetime.now(timezone.utc).isoformat()))
        stamp_edition_start(values, headers, groups, column, previous, value)
        if value != previous and parse_production_date(value):
            db.execute("INSERT INTO production_finished(source_row,column_number,value,created_at) VALUES (?,?,?,?)",
                       (row, column, value, datetime.now(timezone.utc).isoformat()))
        if value.strip().upper() == "P" and str(previous).strip().upper() != "P":
            db.execute("INSERT INTO production_started(source_row,column_number,created_at) VALUES (?,?,?)",
                       (row, column, datetime.now(timezone.utc).isoformat()))
        now = datetime.now(timezone.utc).isoformat()
        db.execute("UPDATE production_rows SET values_json = ? WHERE source_row = ?", (json.dumps(values, ensure_ascii=False), row))
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        db.close()
        return {"ok": True, "row": row, "column": column, "value": value, "values": values}
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        logging.exception("No se pudo editar la celda de producción")
        raise HTTPException(503, f"No se pudo guardar el cambio: {exc}") from exc


@app.get("/api/produccion/reprocesos/{row}/{column}")
def production_rework_history(row: int, column: int, _=Depends(authenticate)):
    with connect() as db:
        records = db.execute("SELECT process, reason, username, created_at FROM production_rework WHERE source_row = ? AND column_number = ? ORDER BY id DESC", (row, column)).fetchall()
    return [dict(record) for record in records]


@app.get("/api/reproceso")
def list_rework_module(_=Depends(authenticate)):
    with connect() as db:
        meta = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM production_meta")}
        headers = json.loads(meta.get("headers", "[]"))
        order_index = next((i for i, value in enumerate(headers) if str(value).strip().upper() == "ORDEN"), -1)
        client_index = next((i for i, value in enumerate(headers) if str(value).strip().upper() in {"NOMBRE DEL CLIENTE", "CLIENTE"}), -1)
        project_index = next((i for i, value in enumerate(headers) if str(value).strip().upper() in {"NOMBRE PROYECTO", "PROYECTO"}), -1)
        reference_index = next((i for i, value in enumerate(headers) if str(value).strip().upper() == "REFERENCIA"), -1)
        values_by_row = {row["source_row"]: json.loads(row["values_json"]) for row in db.execute("SELECT source_row, values_json FROM production_rows")}
        events = db.execute("""
            SELECT event.id, event.source_row, event.column_number,
                   COALESCE(rework.process, '') AS process, event.reason, event.username, event.created_at
            FROM production_operator_events AS event
            LEFT JOIN production_rework AS rework
              ON rework.source_row=event.source_row
             AND rework.column_number=event.column_number
             AND rework.username=event.username
             AND rework.created_at=event.created_at
            WHERE event.action='rework'
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT 250
        """).fetchall()
    result = []
    for event in events:
        values = values_by_row.get(event["source_row"], [])
        result.append({
            **dict(event),
            "order": str(values[order_index]).strip() if 0 <= order_index < len(values) else "",
            "client": str(values[client_index]).strip() if 0 <= client_index < len(values) else "",
            "project": str(values[project_index]).strip() if 0 <= project_index < len(values) else "",
            "reference": str(values[reference_index]).strip() if 0 <= reference_index < len(values) else "",
        })
    return result


@app.get("/api/produccion/proceso-orden")
def order_active_process(order: str, _=Depends(authenticate)):
    with connect() as db:
        meta = {r['key']: r['value'] for r in db.execute('SELECT key,value FROM production_meta')}
        headers = json.loads(meta.get('headers', '[]'))
        groups = json.loads(meta.get('groups', '[]'))
        order_index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == 'ORDEN'), -1)
        if order_index < 0:
            return {'process': '', 'basis': 'none'}
        records = [(r['source_row'], json.loads(r['values_json'])) for r in db.execute('SELECT source_row,values_json FROM production_rows')]
        rows = {row: values for row, values in records if len(values) > order_index and str(values[order_index]).strip().upper() == order.strip().upper()}
        def process_at(index):
            stage = official_process(headers[index]) if 0 <= index < len(headers) else None
            return PROCESS_FLOW[stage]['label'] if stage is not None else ''
        active = [(row, i) for row, values in rows.items() for i, value in enumerate(values) if str(value).strip().upper() == 'P' and process_at(i)]
        history = [(r['source_row'], r['column_number']-1) for r in db.execute('SELECT source_row,column_number FROM production_started ORDER BY id DESC') if r['source_row'] in rows and process_at(r['column_number']-1)]
        latest_active = next((item for item in history if item in active), None)
        if latest_active:
            return {'process': process_at(latest_active[1]), 'basis': 'active'}
        if active:
            return {'process': process_at(max(active, key=lambda item:item[1])[1]), 'basis': 'legacy'}
        completed = {(row, i): date for row, values in rows.items() for i, value in enumerate(values)
                     if process_at(i) and (date := parse_production_date(str(value)))}
        for item in db.execute('SELECT source_row,column_number,value FROM production_finished ORDER BY id DESC'):
            key = (item['source_row'], item['column_number'] - 1)
            if key in completed and str(rows[key[0]][key[1]]) == item['value']:
                return {'process': process_at(key[1]), 'basis': 'finished'}
        if completed:
            key = max(completed, key=lambda item: (completed[item], item[1]))
            return {'process': process_at(key[1]), 'basis': 'finished_legacy'}
        return {'process': '', 'basis': 'none'}


@app.post("/api/produccion/orden")
async def update_production_order(payload: dict = Body(...), _=Depends(authenticate)):
    raw_rows = payload.get("rows")
    if not isinstance(raw_rows, list):
        raise HTTPException(400, "El orden de filas no es válido")
    try:
        rows = [int(value) for value in raw_rows]
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "El orden contiene una fila inválida") from exc
    if len(rows) != len(set(rows)):
        raise HTTPException(400, "El orden contiene filas repetidas")
    db = connect()
    try:
        existing = {int(row[0]) for row in db.execute("SELECT source_row FROM production_rows")}
        if set(rows) != existing:
            raise HTTPException(400, "Debes ordenar todas las filas visibles sin aplicar filtros")
        db.executemany(
            "UPDATE production_rows SET sort_order = ? WHERE source_row = ?",
            [(index, source_row) for index, source_row in enumerate(rows, start=1)],
        )
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return {"ok": True, "rows": len(rows), "updated_at": now}
    finally:
        db.close()


@app.post("/api/produccion/ordenar-entrega")
def sort_production_by_delivery(_=Depends(authenticate)):
    db = connect()
    try:
        db.execute("BEGIN IMMEDIATE")
        meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
        headers = json.loads(meta["value"]) if meta else []
        index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == "FECHA DE ENTREGA"), -1)
        if index < 0:
            raise HTTPException(400, "No se encontró la columna Fecha de entrega")
        records = list(db.execute("SELECT source_row,values_json FROM production_rows ORDER BY COALESCE(sort_order,source_row),source_row"))
        def date_key(record):
            values = json.loads(record["values_json"])
            date = parse_production_date(values[index]) if index < len(values) else None
            return (date is None, date.toordinal() if date else 0)
        records.sort(key=date_key)
        db.executemany("UPDATE production_rows SET sort_order=? WHERE source_row=?",
                       [(position, record["source_row"]) for position, record in enumerate(records, 1)])
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('updated_at',?)", (now,))
        db.commit()
        return {"ok": True, "rows": len(records)}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def can_delete_production_profile(profile):
    normalized = ''.join(c for c in unicodedata.normalize('NFD', str(profile)) if not unicodedata.combining(c))
    return ' '.join(normalized.upper().split()) in {'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO', 'COORDINADOR', 'EDICION', 'COMERCIAL', 'COMERCIALES', 'ASISTENTE COMERCIAL', 'ASISTENTES COMERCIALES'}


def can_delete_rework_profile(profile):
    normalized = ''.join(c for c in unicodedata.normalize('NFD', str(profile or '')) if not unicodedata.combining(c))
    return ' '.join(normalized.upper().split()) in {'ADMINISTRACION', 'ADMINISTRATIVA', 'ADMINISTRATIVO', 'COORDINADOR'}


def production_delete_target(db, row, username):
    profile = db.execute('SELECT process FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    if username != os.getenv('APP_USER', 'indoor') and not (profile and can_delete_production_profile(profile['process'])):
        raise HTTPException(403, 'Solo Administración y Edición pueden eliminar órdenes')
    record = db.execute('SELECT * FROM production_rows WHERE source_row=?', (row,)).fetchone()
    if not record:
        raise HTTPException(404, 'La tarjeta ya no existe')
    meta = db.execute("SELECT value FROM production_meta WHERE key='headers'").fetchone()
    headers = json.loads(meta['value']) if meta else []
    values = json.loads(record['values_json'])
    def field(items, title):
        index = next((i for i,h in enumerate(headers) if str(h).strip().upper()==title), -1)
        return str(items[index] or '').strip() if 0 <= index < len(items) else ''
    order, client_name = field(values, 'ORDEN').upper(), legacy.sanitize(field(values, 'NOMBRE DEL CLIENTE'))
    if not client_name or not re.fullmatch(r'[A-Z0-9_-]{2,40}', order) or not any(c.isdigit() for c in order):
        raise HTTPException(409, 'La tarjeta no identifica un cliente y una orden válidos. No se eliminó nada.')
    for other in db.execute('SELECT source_row,values_json FROM production_rows WHERE source_row<>?', (row,)):
        other_values = json.loads(other['values_json'])
        if field(other_values,'ORDEN').upper()==order:
            raise HTTPException(409, 'Otra tarjeta comparte esta orden. No se puede borrar su carpeta mientras siga programada.')
    root = Path(CONFIG['ruta_nas_clientes']).resolve(strict=True)
    client = root / client_name
    if client.is_symlink() or client.resolve().parent != root or not client.is_dir():
        raise HTTPException(409, 'No se pudo confirmar la carpeta exacta del cliente. No se eliminó nada.')
    client = client.resolve(strict=True)
    matches = [p for p in client.iterdir() if p.is_dir() and (p.name.upper()==order or any(p.name.upper().startswith(order+s) for s in ('_', ' ', '-')))]
    if len(matches)!=1:
        raise HTTPException(409, 'Debe existir una única carpeta de esta orden en el cliente. No se eliminó nada.')
    candidate = matches[0]
    target = candidate.resolve(strict=True)
    if candidate.is_symlink() or target.parent!=client or len(target.relative_to(root).parts)!=2:
        raise HTTPException(403, 'Ruta de orden no permitida')
    # Reject links/junctions and nested mount points before any recursive deletion.
    for parent, dirs, files in os.walk(target, followlinks=False):
        for name in dirs + files:
            entry = Path(parent) / name
            if entry.is_symlink() or (hasattr(entry, 'is_junction') and entry.is_junction()) or os.path.ismount(entry) or not entry.resolve().is_relative_to(target):
                raise HTTPException(409, 'La carpeta contiene enlaces o rutas externas. Se requiere revisión manual.')
    relative = str(target.relative_to(root)).replace('\\','/')
    fingerprint = hashlib.sha256((record['values_json']+'\n'+relative).encode()).hexdigest()
    return record, target, order, relative, fingerprint


@app.get('/api/produccion/fila/{row}/eliminacion')
def preview_production_delete(row: int, _=Depends(authenticate)):
    db = connect()
    try:
        record, target, order, relative, fingerprint = production_delete_target(db,row,_)
        return dict(order=order, folder='\\\\192.168.0.120\\NAS INDOOR\\CLIENTES\\'+relative.replace('/','\\'), confirmation=fingerprint)
    except OSError as error:
        raise HTTPException(503, 'No se pudo acceder al NAS. No se eliminó nada.') from error
    finally:
        db.close()


def verify_delete_password(db, username, password):
    db.execute('CREATE TABLE IF NOT EXISTS production_delete_attempts (username TEXT PRIMARY KEY COLLATE NOCASE, attempts INTEGER, started REAL)')
    now = time.time()
    attempt = db.execute('SELECT attempts,started FROM production_delete_attempts WHERE username=?', (username,)).fetchone()
    count = attempt['attempts'] if attempt and now-attempt['started']<900 else 0
    if count >= 5:
        raise HTTPException(429, 'Demasiados intentos de contraseña. Espera 15 minutos antes de volver a eliminar.')
    user = db.execute('SELECT password_hash FROM users WHERE name=? COLLATE NOCASE', (username,)).fetchone()
    valid = isinstance(password,str) and 0 < len(password) <= 256 and (
        password_matches(password,user['password_hash']) if user else
        username==os.getenv('APP_USER','indoor') and bool(os.getenv('APP_PASSWORD','')) and secrets.compare_digest(password.encode(),os.getenv('APP_PASSWORD','').encode()))
    if not valid:
        db.execute('INSERT OR REPLACE INTO production_delete_attempts(username,attempts,started) VALUES (?,?,?)',
                   (username,count+1,attempt['started'] if count else now))
        db.commit()
        raise HTTPException(403, 'Contraseña incorrecta. No se eliminó la tarjeta ni la carpeta.')
    db.execute('DELETE FROM production_delete_attempts WHERE username=?',(username,))


@app.delete("/api/produccion/fila/{row}")
def delete_production_row(row: int, payload: dict = Body(...), _=Depends(authenticate)):
    if row < PRODUCTION_START_ROW:
        raise HTTPException(400, "La fila está fuera del área de Producción")
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        record, target, order, relative, fingerprint = production_delete_target(db,row,_)
        verify_delete_password(db, _, payload.get('password'))
        if payload.get('confirmation')!=fingerprint or payload.get('order')!=order:
            raise HTTPException(409, 'Confirma la carpeta y la orden actual antes de eliminarla.')
        backup_dir = STATE_DIR / 'deleted-order-backups'
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_base = backup_dir / (str(row)+'-'+secrets.token_hex(12))
        # Complete a server-side recovery copy before touching NAS files.
        backup = shutil.make_archive(str(backup_base), 'zip', root_dir=str(target.parent), base_dir=target.name)
        db.execute('CREATE TABLE IF NOT EXISTS production_nas_deletions (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, folder TEXT, backup TEXT, actor TEXT, deleted_at TEXT)')
        db.execute('INSERT INTO production_nas_deletions(source_row,folder,backup,actor,deleted_at) VALUES (?,?,?,?,?)',
                   (row,relative,backup,_,datetime.now(timezone.utc).isoformat()))
        # Resolve again after backup and require the same exact target and row.
        verified_record, verified, verified_order, verified_relative, verified_fingerprint = production_delete_target(db,row,_)
        if verified!=target or verified_fingerprint!=fingerprint:
            raise HTTPException(409, 'La orden cambió durante la operación. No se eliminó nada.')
        shutil.rmtree(verified)
        db.execute('CREATE TABLE IF NOT EXISTS production_deleted_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, source_row INTEGER, payload TEXT, deleted_by TEXT, deleted_at TEXT)')
        db.execute('INSERT INTO production_deleted_rows(source_row,payload,deleted_by,deleted_at) VALUES (?,?,?,?)',
                   (row, json.dumps(dict(record), ensure_ascii=False), _, datetime.now(timezone.utc).isoformat()))
        archive_production_activity(db, row, 'Orden eliminada por ' + str(_))
        highest = max(row, int((db.execute("SELECT value FROM production_meta WHERE key='last_allocated_row'").fetchone() or [0])[0]))
        db.execute("INSERT OR REPLACE INTO production_meta(key,value) VALUES ('last_allocated_row',?)", (str(highest),))
        db.execute("DELETE FROM production_rows WHERE source_row = ?", (row,))
        db.execute("DELETE FROM production_notes WHERE source_row = ?", (row,))
        now = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT OR REPLACE INTO production_meta(key, value) VALUES ('updated_at', ?)", (now,))
        db.commit()
        return {"ok": True, "row": row, "updated_at": now, "nas_deleted": relative}
    except OSError as error:
        db.rollback()
        logging.exception('No se completó la eliminación NAS de fila %s', row)
        raise HTTPException(503, 'No se completó la eliminación del NAS. La tarjeta se conserva; si comenzó el borrado, hay un respaldo en el servidor para recuperación.') from error
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/descargar-conector-nas")
def download_nas_connector(_=Depends(authenticate)):
    handler = r'''param([string]$Uri)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IndoorExplorerWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@
function Get-ViewIdentity($view) {
    $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($view)
    try { return $pointer.ToInt64().ToString() }
    finally { [Runtime.InteropServices.Marshal]::Release($pointer) | Out-Null }
}
function Open-OrderAndMasters([string]$OrderPath) {
    $masters = Join-Path ([System.IO.Path]::GetDirectoryName($OrderPath.TrimEnd('\'))) "MAESTROS"
    Start-Process explorer.exe -ArgumentList ('"' + $OrderPath + '"')
    if (-not (Test-Path -LiteralPath $masters -PathType Container)) {
        [System.Windows.MessageBox]::Show("Se abrió la orden. Este cliente no tiene una carpeta MAESTROS disponible.", "Indoor NAS") | Out-Null
        return
    }
    try {
        $shellApp = New-Object -ComObject Shell.Application
        $orderView = $null
        for ($attempt = 0; $attempt -lt 40 -and $null -eq $orderView; $attempt++) {
            foreach ($view in @($shellApp.Windows())) {
                try {
                    if ($view.Document.Folder.Self.Path.TrimEnd('\') -ieq $OrderPath.TrimEnd('\')) { $orderView = $view; break }
                } catch {}
            }
            if ($null -eq $orderView) { Start-Sleep -Milliseconds 200 }
        }
        if ($null -eq $orderView) { throw "No se identificó la ventana de la orden." }
        $windowHandle = [IntPtr]([long]$orderView.HWND)
        $before = @($shellApp.Windows() | ForEach-Object { Get-ViewIdentity $_ })
        [IndoorExplorerWindow]::ShowWindow($windowHandle, 9) | Out-Null
        [IndoorExplorerWindow]::SetForegroundWindow($windowHandle) | Out-Null
        Start-Sleep -Milliseconds 250
        if ([IndoorExplorerWindow]::GetForegroundWindow() -ne $windowHandle) { throw "No se pudo activar la ventana de la orden." }
        # Only the shortcut is sent to the verified Explorer window; paths use COM, never keystrokes.
        [System.Windows.Forms.SendKeys]::SendWait("^t")
        $newTab = $null
        for ($attempt = 0; $attempt -lt 30 -and $null -eq $newTab; $attempt++) {
            Start-Sleep -Milliseconds 150
            foreach ($view in @($shellApp.Windows())) {
                try {
                    if ([long]$view.HWND -eq $windowHandle.ToInt64() -and (Get-ViewIdentity $view) -notin $before) { $newTab = $view; break }
                } catch {}
            }
        }
        if ($null -eq $newTab) { throw "Windows no expuso la nueva pestaña." }
        $newTab.Navigate2($masters)
    } catch {
        # Compatibility fallback: still provide both folders without navigating an unrelated tab.
        Start-Process explorer.exe -ArgumentList ('"' + $masters + '"')
    }
}
try {
    $parsed = [System.Uri]$Uri
    if ($parsed.Host -eq "folder") {
        $parts = $parsed.AbsolutePath.Trim('/').Split('/')
        if ($parts.Count -ne 2) { throw "Ruta de carpeta inválida." }
        $clientName = [System.Uri]::UnescapeDataString($parts[0])
        $folderName = [System.Uri]::UnescapeDataString($parts[1])
        foreach ($part in @($clientName, $folderName)) {
            if ([string]::IsNullOrWhiteSpace($part) -or $part -in @(".", "..") -or $part.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) { throw "Nombre de carpeta inválido." }
        }
        $base = "\\192.168.0.120\NAS INDOOR\CLIENTES"
        $target = Join-Path (Join-Path $base $clientName) $folderName
        if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw "No existe la carpeta de la orden o no hay conexión al NAS." }
        Open-OrderAndMasters $target
        exit 0
    }
    $order = [System.Uri]::UnescapeDataString($parsed.AbsolutePath.Trim('/')).Trim()
    if ([string]::IsNullOrWhiteSpace($order)) { throw "La orden no fue especificada." }
    $root = "\\192.168.0.120\NAS INDOOR\CLIENTES"
    $found = $null
    foreach ($client in Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop) {
        $found = Get-ChildItem -LiteralPath $client.FullName -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like ($order + "*") } |
            Select-Object -First 1
        if ($null -ne $found) { break }
    }
    if ($null -eq $found) {
        [System.Windows.MessageBox]::Show("No se encontró la carpeta de la orden $order en el NAS.", "Indoor NAS") | Out-Null
        exit 2
    }
    Open-OrderAndMasters $found.FullName
} catch {
    [System.Windows.MessageBox]::Show("No fue posible abrir la orden. Verifica que estés conectado a la red de Indoor.`n`n" + $_.Exception.Message, "Indoor NAS") | Out-Null
    exit 1
}
'''
    # utf-8-sig: Windows PowerShell 5.1 lee un .ps1 sin BOM como ANSI y los acentos salen como «encontrÃ³».
    encoded = base64.b64encode(handler.encode("utf-8-sig")).decode("ascii")
    launcher = r'''Set shell = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
scriptPath = shell.ExpandEnvironmentStrings("%ProgramData%") & "\IndoorNAS\open-order.ps1"
uri = Replace(WScript.Arguments(0), Chr(34), Chr(34) & Chr(34))
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34) & " " & Chr(34) & uri & Chr(34)
shell.Run command, 0, False
'''
    launcher_encoded = base64.b64encode(launcher.encode("utf-8")).decode("ascii")
    # HKLM + %ProgramData% (no HKCU + %LOCALAPPDATA%): el protocolo y los scripts deben quedar
    # a nivel de equipo, para que cualquier cuenta de Windows de ese PC use el botón, no solo
    # quien corrió el instalador. Escribir en HKLM exige permisos de administrador, así que el
    # script se reejecuta a sí mismo elevado (UAC) cuando no corre ya como Administrador.
    installer = fr'''@echo off
setlocal
title Instalador Indoor NAS
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Se necesitan permisos de Administrador para instalarlo en todos los usuarios de este equipo.
  echo Se abrira un aviso de Windows para confirmarlo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "INDOOR_DIR=%ProgramData%\IndoorNAS"
if not exist "%INDOOR_DIR%" mkdir "%INDOOR_DIR%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$handler=[Convert]::FromBase64String('{encoded}'); $launcher=[Convert]::FromBase64String('{launcher_encoded}'); [IO.File]::WriteAllBytes($env:ProgramData+'\IndoorNAS\open-order.ps1',$handler); [IO.File]::WriteAllBytes($env:ProgramData+'\IndoorNAS\open-order.vbs',$launcher); $key='HKLM:\Software\Classes\indoor-nas'; New-Item -Path $key -Force | Out-Null; Set-Item -Path $key -Value 'URL:Indoor NAS'; New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -Force | Out-Null; $commandKey=$key+'\shell\open\command'; New-Item -Path $commandKey -Force | Out-Null; Set-Item -Path $commandKey -Value ('wscript.exe "'+$env:ProgramData+'\IndoorNAS\open-order.vbs" "%%1"')"
if errorlevel 1 (
  echo No fue posible instalar el conector.
  pause
  exit /b 1
)
rem Una instalacion antigua por usuario (HKCU / AppData) tiene prioridad sobre la de equipo: se elimina SOLO la clave indoor-nas y la carpeta IndoorNAS de cada perfil.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem Registry::HKEY_USERS -ErrorAction SilentlyContinue | Where-Object {{ $_.PSChildName -match '^S-1-5-21-[0-9-]+$' }} | ForEach-Object {{ Remove-Item -LiteralPath ($_.PSPath + '\Software\Classes\indoor-nas') -Recurse -Force -ErrorAction SilentlyContinue }}; Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {{ Remove-Item -LiteralPath ($_.FullName + '\AppData\Local\IndoorNAS') -Recurse -Force -ErrorAction SilentlyContinue }}"
echo.
echo Conector Indoor NAS instalado correctamente para todos los usuarios de este equipo.
echo Ya puedes cerrar esta ventana y pulsar una fila en Produccion.
echo.
pause
'''
    return Response(
        content=installer.encode("utf-8"),
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="Instalar-Conector-Indoor-NAS.cmd"'},
    )
def nas_client_key(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', str(value))
                           if not unicodedata.combining(c)).casefold().split())


_NAS_CLIENTS = {'at': 0.0, 'map': {}}


def _nas_client_index(root: Path, force=False) -> dict:
    now = time.monotonic()
    if force or not _NAS_CLIENTS['map'] or now - _NAS_CLIENTS['at'] > 300:
        found = {}
        for entry in root.iterdir():
            try:
                if entry.is_dir() and entry.resolve().parent == root:
                    found.setdefault(nas_client_key(entry.name), []).append(entry.resolve())
            except OSError:
                continue
        _NAS_CLIENTS.update(at=now, map=found)
    return _NAS_CLIENTS['map']


def resolve_nas_client(root: Path, client_name: str) -> Path:
    root = root.resolve()
    if not client_name or (root / client_name).resolve().parent != root:
        raise HTTPException(400, 'Nombre de cliente inválido')
    # Primero la carpeta exacta del cliente (una sola consulta al NAS); solo si no existe así,
    # se compara contra la lista de clientes ignorando tildes y mayúsculas.
    direct = root / client_name
    if direct.is_dir():
        return direct.resolve()
    if not root.is_dir():
        raise HTTPException(503, 'El NAS no está disponible')
    matches = [m for m in _nas_client_index(root).get(nas_client_key(client_name), []) if m.is_dir()]
    if not matches and time.monotonic() - _NAS_CLIENTS['at'] > 20:
        # puede ser un cliente recién creado: se vuelve a leer la lista (máximo cada 20 s)
        matches = [m for m in _nas_client_index(root, force=True).get(nas_client_key(client_name), []) if m.is_dir()]
    if len(matches) > 1:
        raise HTTPException(409, 'Hay varias carpetas con el mismo nombre de cliente al ignorar tildes. Revisa cuál corresponde a la orden.')
    if not matches:
        raise HTTPException(404, f'No se encontró la carpeta del cliente {client_name}, incluso ignorando tildes y mayúsculas.')
    return matches[0]


def find_nas_order(order: str) -> Path:
    clean = str(order or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", clean):
        raise HTTPException(400, "Número de orden inválido")
    root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    if not root.is_dir():
        raise HTTPException(503, "El NAS no está disponible")
    matches = []
    for client_dir in root.iterdir():
        if not client_dir.is_dir() or client_dir.resolve().parent != root:
            continue
        for candidate in client_dir.iterdir():
            name = candidate.name.upper()
            if candidate.is_dir() and (name == clean or any(name.startswith(clean + separator) for separator in ('_', ' ', '-'))):
                target = candidate.resolve()
                if target.parent == client_dir.resolve():
                    matches.append(target)
    if len(matches) > 1:
        raise HTTPException(409, f'Hay varias carpetas para la orden {clean}. Revisa la carpeta correcta; no se abrió ninguna.')
    if matches:
        return matches[0]
    raise HTTPException(404, f"No se encontró la orden {clean} en el NAS")


def production_row_files(source_row: int, excel_only=False):
    with connect() as db:
        record = db.execute("SELECT values_json FROM production_rows WHERE source_row = ?", (source_row,)).fetchone()
        meta = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
    if not record or not meta:
        raise HTTPException(404, "Fila no encontrada")
    values, headers = json.loads(record['values_json']), json.loads(meta['value'])
    def field(name):
        index = next((i for i, h in enumerate(headers) if str(h).strip().upper() == name), -1)
        return str(values[index] or '').strip() if 0 <= index < len(values) else ''
    root = Path(CONFIG['ruta_nas_clientes']).resolve()
    def normalized_name(value):
        return ' '.join(''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.combining(c)).casefold().split())
    client_name = legacy.sanitize(field('NOMBRE DEL CLIENTE'))
    order = field('ORDEN').upper()
    if not client_name or not re.fullmatch(r'[A-Z0-9_-]{2,40}', order):
        raise HTTPException(404, "La fila no tiene cliente u orden válidos")
    client = resolve_nas_client(root, client_name)
    matches = [p.resolve() for p in client.iterdir() if p.is_dir() and
               (p.name.upper() == order or any(p.name.upper().startswith(order + s) for s in ('_', ' ', '-')))]
    files = []
    if len(matches) == 1 and matches[0].parent == client:
        files = [p for p in matches[0].iterdir() if p.is_file() and p.resolve().parent == matches[0]]
    reference = field('REFERENCIA').upper()
    if excel_only:
        return [p for p in files if not p.name.startswith('~$') and p.suffix.lower() in ('.xlsx', '.xlsm', '.xls', '.pdf', '.csv')], [], client
    def child(parent, name):
        found = [p.resolve() for p in parent.iterdir() if p.is_dir() and p.name.casefold() == name.casefold() and p.resolve().parent == parent]
        return found[0] if len(found) == 1 else None
    masters = child(client, 'MAESTROS')
    project_name = legacy.sanitize(field('NOMBRE PROYECTO'))
    # Explicit client/project correspondences confirmed by the user.
    client_key = normalized_name(client_name)
    if client_key == 'corporacion deportiva inter club' and project_name.upper() == 'UNIFORMES PROFES':
        project_name = 'PROFES 2027'
    if client_key == 'andrea villada villada' and project_name.upper() == 'CORPORACION FCV':
        masters = child(client, 'Maestro')
        project_name = 'CORPORACION'
    project = child(masters, project_name) if masters and project_name else None
    images = []
    if project and reference:
        # Match complete reference tokens, never a substring from another model.
        tokens = set(re.findall(r'[A-Z]+\d+', reference))
        if client_key == 'dimelo jara company sas' and project_name.upper() == 'ALCALDIA DE ITAGUI' and reference == 'A11200CA02-A11200PT01':
            tokens = {'FUT02'}
        designs = []
        for folder in project.iterdir():
            if not folder.is_dir() or folder.resolve().parent != project:
                continue
            code = re.split(r'[_\s-]', folder.name.upper())[0]
            if code == reference or code in tokens:
                designs.append(folder.resolve())
        if len(designs) == 1:
            images = [p for p in designs[0].iterdir() if p.is_file() and p.resolve().parent == designs[0] and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
            # Up to four versions within the uniquely matched design folder.
            images = sorted(images, key=lambda p: p.name.casefold())[:4]
    # Verified NAS naming exception: same client's 2018-2019 flag project.
    if normalized_name(client_name) == 'corporacion cracks antioquia' and field('NOMBRE PROYECTO').upper() == 'BANDERA 2018-2019' and reference == 'A3000BN01' and masters:
        flag_project = child(masters, 'BANDERA 18-19')
        if flag_project:
            flags = [p for p in flag_project.iterdir() if p.is_file() and p.resolve().parent == flag_project and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
            if len(flags) == 1:
                images = flags
    # These current orders were explicitly requested without mockups.
    if order in {'RM7585', 'RM7603', 'CO6072', 'CO6073'}:
        images = []
    files = [p for p in files if p.suffix.lower() in ('.xlsx', '.xls', '.pdf', '.csv')] + images
    return files, images, client


import collections

_ASSET_CACHE: dict = {}
_ASSET_BUSY: set = set()
_ASSET_LOCK = threading.Lock()
_IMAGE_CACHE: "collections.OrderedDict" = collections.OrderedDict()
ASSET_FRESH_SECONDS = 30


def _remember_image(source_row, number, digest, mime, data):
    with _ASSET_LOCK:
        _IMAGE_CACHE[(source_row, number)] = (digest, mime, data)
        _IMAGE_CACHE.move_to_end((source_row, number))
        while len(_IMAGE_CACHE) > 1500:
            _IMAGE_CACHE.popitem(last=False)


def _compute_card_assets(source_row: int):
    try:
        files, mockups, client = production_row_files(source_row, excel_only=True)
        designs, status = production_excel_designs(source_row, files)
    except OSError:
        raise HTTPException(503, 'El NAS no está disponible')
    documents = []
    for path in sorted(files, key=lambda p: p.name.lower()):
        if path.suffix.lower() in ('.xlsx', '.xls', '.pdf', '.csv'):
            url = f'/api/produccion/fila/{source_row}/archivo?name=' + quote(path.relative_to(client).as_posix(), safe='')
            documents.append({'name': path.name, 'url': url})
    if designs:
        for number, mime, data in designs:
            _remember_image(source_row, number, hashlib.sha256(data).hexdigest()[:20], mime, data)
        images = [{'name': f'D{number} · imagen del listado Excel', 'design': number,
                   'url': f'/api/produccion/fila/{source_row}/mockup-excel/{number}?v=' + hashlib.sha256(data).hexdigest()[:20]}
                  for number, mime, data in designs]
        return {'images': images, 'documents': documents[:20], 'image_status': status, 'image_source': 'excel'}
    # Sin diseño en el Excel: buscar en la carpeta MAESTROS del NAS como respaldo.
    try:
        _, nas_images, nas_client = production_row_files(source_row, excel_only=False)
        if nas_images:
            images = [{'name': p.name,
                       'url': f'/api/produccion/fila/{source_row}/archivo?name=' + quote(p.relative_to(nas_client).as_posix(), safe='')}
                      for p in nas_images]
            return {'images': images, 'documents': documents[:20], 'image_status': 'Imagen desde carpeta MAESTROS', 'image_source': 'nas'}
    except (OSError, HTTPException):
        pass
    return {'images': [], 'documents': documents[:20], 'image_status': status, 'image_source': 'none'}


def _warm_card_assets():
    """Mantiene en memoria los diseños de TODAS las órdenes (tarjetas de Producción y consulta del cliente) para que aparezcan al instante."""
    time.sleep(5)
    while True:
        try:
            with connect() as db:
                rows = [r[0] for r in db.execute('SELECT source_row FROM production_rows ORDER BY source_row DESC')]
        except Exception:
            rows = []
        for row in rows:
            entry = _ASSET_CACHE.get(row)
            try:
                if not entry or time.monotonic() - entry[0] > 1200:
                    payload = _compute_card_assets(row)
                    with _ASSET_LOCK:
                        _ASSET_CACHE[row] = (time.monotonic(), payload)
                _prefetch_extra(row)
            except Exception:
                pass
            time.sleep(0.2)
        time.sleep(600)


def _refresh_card_assets(source_row: int):
    try:
        payload = _compute_card_assets(source_row)
        with _ASSET_LOCK:
            _ASSET_CACHE[source_row] = (time.monotonic(), payload)
    except Exception:
        pass
    finally:
        with _ASSET_LOCK:
            _ASSET_BUSY.discard(source_row)


@app.get('/api/produccion/fila/{source_row}/archivos')
def production_card_assets(source_row: int, _=Depends(authenticate)):
    """Los diseños se entregan al instante desde memoria; si ya pasaron 30 s se renuevan en segundo plano."""
    with _ASSET_LOCK:
        entry = _ASSET_CACHE.get(source_row)
        stale = bool(entry) and time.monotonic() - entry[0] > ASSET_FRESH_SECONDS and source_row not in _ASSET_BUSY
        if stale:
            _ASSET_BUSY.add(source_row)
    if entry:
        if stale:
            threading.Thread(target=_refresh_card_assets, args=(source_row,), daemon=True).start()
        return entry[1]
    payload = _compute_card_assets(source_row)
    with _ASSET_LOCK:
        _ASSET_CACHE[source_row] = (time.monotonic(), payload)
    return payload


def production_excel_designs(source_row, files):
    with connect() as db:
        record = db.execute('SELECT values_json FROM production_rows WHERE source_row = ?', (source_row,)).fetchone()
        meta = db.execute("SELECT value FROM production_meta WHERE key = 'headers'").fetchone()
    if not record or not meta:
        raise HTTPException(404, 'Fila no encontrada')
    values, headers = json.loads(record['values_json']), json.loads(meta['value'])
    fields = {str(h).strip().upper(): str(v or '').strip() for h, v in zip(headers, values)}
    order, reference = fields.get('ORDEN', '').upper(), fields.get('REFERENCIA', '').upper()
    # Previously confirmed correspondence for this exact order/reference.
    if order == 'RM7613' and reference == 'A11200CA02-A11200PT01':
        reference = 'A11200FUT02'
    # CO6032 has a blank reference in Sheets; its order listing identifies IBOLDEP.
    if order == 'CO6032' and not reference:
        reference = 'IBOLDEP'
    try:
        return listing_designs(files, reference)
    except OSError:
        raise
    except Exception:
        logging.exception('No se pudo leer el mockup Excel de la fila %s', source_row)
        return (), 'No se pudo leer la imagen del listado'


@app.get('/api/produccion/fila/{source_row}/mockup-excel/{design}')
def production_excel_image(source_row: int, design: int, request: Request = None, _=Depends(authenticate)):
    if not 1 <= design <= 40:
        raise HTTPException(404, 'Diseño no encontrado')
    with _ASSET_LOCK:
        hit = _IMAGE_CACHE.get((source_row, design))
        if hit:
            _IMAGE_CACHE.move_to_end((source_row, design))
    version = request.query_params.get('v') if request is not None else None
    if hit and (not version or version == hit[0]):
        digest, mime, data = hit
        cache = 'private, max-age=31536000, immutable' if version == digest else 'private, no-cache'
        headers = {'Cache-Control': cache, 'ETag': '"' + digest + '"', 'X-Content-Type-Options': 'nosniff'}
        if request.headers.get('if-none-match') == headers['ETag']:
            return Response(status_code=304, headers=headers)
        return Response(data, media_type=mime, headers=headers)
    try:
        files, _, _client = production_row_files(source_row, excel_only=True)
        images, _status = production_excel_designs(source_row, files)
    except OSError:
        raise HTTPException(503, 'El NAS no está disponible')
    target = next((image for image in images if image[0] == design), None)
    if target is None:
        raise HTTPException(404, 'Diseño no encontrado en el Excel')
    etag = '"' + hashlib.sha256(target[2]).hexdigest() + '"'
    headers = {'Cache-Control': 'private, no-cache', 'ETag': etag,
               'X-Content-Type-Options': 'nosniff'}
    if request is not None and request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    return Response(target[2], media_type=target[1], headers=headers)


@app.get('/api/produccion/fila/{source_row}/archivo')
def production_card_file(source_row: int, name: str, _=Depends(authenticate)):
    files, mockups, client = production_row_files(source_row)
    target = next((p for p in files if p.relative_to(client).as_posix() == name), None)
    if target is None or target.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.pdf', '.csv'):
        raise HTTPException(404, 'Archivo no encontrado')
    if target.stat().st_size > 30 * 1024 * 1024:
        raise HTTPException(413, 'Archivo demasiado grande; ábrelo desde el NAS')
    return FileResponse(target, headers={'Cache-Control': 'private, max-age=120', 'X-Content-Type-Options': 'nosniff'})


@app.post("/api/nas/preparar")
def prepare_nas_order(payload: dict = Body(...), _=Depends(authenticate)):
    order = str(payload.get("order") or "").strip().upper()
    client = str(payload.get("client") or "").strip()
    project = str(payload.get("project") or "").strip()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", order):
        raise HTTPException(400, "Número de orden inválido")
    if not client:
        raise HTTPException(400, "La fila no tiene nombre de cliente")
    root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    if not root.is_dir():
        raise HTTPException(503, "El NAS no está disponible")
    try:
        existing = find_nas_order(order)
        return {"ok": True, "created": False, "folder": existing.name}
    except HTTPException as error:
        if error.status_code != 404:
            raise
    client_name = legacy.sanitize(client)
    project_name = legacy.sanitize(project) if project else "ORDEN"
    client_dir = (root / client_name).resolve()
    if root not in client_dir.parents:
        raise HTTPException(400, "Nombre de cliente inválido")
    order_dir = (client_dir / f"{order}_{project_name}").resolve()
    if client_dir not in order_dir.parents:
        raise HTTPException(400, "Nombre de proyecto inválido")
    try:
        order_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logging.exception("No se pudo preparar la carpeta NAS %s", order_dir)
        raise HTTPException(500, f"No se pudo crear la carpeta en el NAS: {error}") from error
    return {"ok": True, "created": True, "folder": order_dir.name}


# Un mount CIFS/VPN caído deja iterdir()/resolve() bloqueados indefinidamente (no lanzan
# excepción, se cuelgan). Resolver en un hilo aparte con límite de tiempo evita que un NAS
# sin responder deje la pestaña del usuario cargando para siempre.
_nas_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="nas-resolve")


_NAS_NAME_STOPWORDS = {'SAS', 'S', 'A', 'SA', 'LTDA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'CIA', 'CO', 'INC', 'EU', 'ESP'}


def _nas_name_tokens(value: str) -> set:
    return {token for token in re.split(r'[^A-Z0-9]+', nas_client_key(value).upper()) if token and token not in _NAS_NAME_STOPWORDS}


def _nas_order_in(folder: Path, clean: str):
    """Carpeta exacta de la orden dentro de una carpeta de cliente: RM7628 o RM7628_/ -/espacio… (nunca RM76281)."""
    found = []
    for candidate in folder.iterdir():
        name = candidate.name.upper()
        if (name == clean or any(name.startswith(clean + separator) for separator in ('_', ' ', '-'))) and candidate.is_dir():
            resolved = candidate.resolve()
            if resolved.parent == folder:
                found.append(resolved)
    return found


def resolve_nas_order_path(root_raw: Path, clean: str, client_name: str):
    root = root_raw.resolve()
    if not client_name:
        # Enlaces sin cliente (antiguos): única situación en la que se revisan todas las carpetas.
        return root, find_nas_order(clean)
    # 1) Carpeta del cliente: se busca la orden exacta solo ahí.
    try:
        client_dir = resolve_nas_client(root, client_name)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        client_dir = None
    if client_dir:
        found = _nas_order_in(client_dir, clean)
        if len(found) == 1:
            return root, found[0]
        if len(found) > 1:
            raise HTTPException(409, f'Hay varias carpetas para la orden {clean} en {client_dir.name}; no se abrió ninguna.')
    # 2) Si no está, solo las carpetas de cliente con nombre parecido (p. ej. YAMAHA / ...YAMAHA S.A), máximo 4.
    wanted = _nas_name_tokens(client_name)
    similar = []
    if wanted:
        for folder in root.iterdir():
            if client_dir is not None and folder.name == client_dir.name:
                continue
            tokens = _nas_name_tokens(folder.name)
            # Palabras casi iguales cuentan igual (TRASFORMEMOS ~ TRANSFORMEMOS).
            common = sum(1 for w in wanted if any(w == t or (len(w) >= 5 and SequenceMatcher(None, w, t).ratio() >= 0.85) for t in tokens))
            if not tokens or not common:
                continue
            score = common / len(wanted)
            if tokens <= wanted or score >= 0.6:
                similar.append((score, folder))
    similar.sort(key=lambda pair: -pair[0])
    found = []
    for _, folder in similar[:4]:
        if folder.is_dir() and folder.resolve().parent == root:
            found.extend(_nas_order_in(folder.resolve(), clean))
    if len(found) == 1:
        return root, found[0]
    if len(found) > 1:
        raise HTTPException(409, f'Hay varias carpetas para la orden {clean} en carpetas parecidas del cliente; no se abrió ninguna.')
    where = client_dir.name if client_dir else client_name
    raise HTTPException(404, f'No se encontró la carpeta de la orden {clean} en la carpeta del cliente {where} ni en carpetas con nombre parecido. Revisa que esté creada con ese número.')


def nas_native_redirect(request: Request, parts: list) -> RedirectResponse:
    smb_url = "smb://192.168.0.120/NAS%20INDOOR/" + "/".join(quote(part, safe="") for part in parts)
    if "Windows" in request.headers.get("user-agent", ""):
        unc_path = "\\\\192.168.0.120\\NAS INDOOR\\" + "\\".join(parts)
        explorer_url = "search-ms:query=*&crumb=location:" + quote(unc_path, safe="")
        return RedirectResponse(explorer_url, status_code=307)
    return RedirectResponse(smb_url, status_code=307)


def nas_indoor_redirect(request: Request, target: Path, parts: list) -> RedirectResponse:
    """A diferencia de search-ms (vista de resultados de búsqueda), indoor-nas:// abre la
    carpeta real y navegable en Explorador — pero exige el conector instalado en el PC."""
    if "Windows" in request.headers.get("user-agent", ""):
        windows_url = "indoor-nas://folder/" + quote(target.parent.name, safe="") + "/" + quote(target.name, safe="")
        return RedirectResponse(windows_url, status_code=307)
    smb_url = "smb://192.168.0.120/NAS%20INDOOR/" + "/".join(quote(part, safe="") for part in parts)
    return RedirectResponse(smb_url, status_code=307)


def nas_error_page(message: str) -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>NAS Indoor</title><style>
    body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b08;color:#f4f7f1;font-family:Inter,Arial,sans-serif;padding:24px;box-sizing:border-box}}
    .box{{max-width:420px;text-align:center}}h1{{font-size:1.3rem;margin:0 0 12px}}p{{margin:0 0 18px;color:#98a393;line-height:1.5}}a{{color:#d0f44c;text-decoration:none}}a:hover{{text-decoration:underline}}</style></head>
    <body><div class='box'><h1>No se pudo abrir la carpeta</h1><p>{escape(message)}</p><a href='/'>← Volver a Producción</a></div></body></html>""", status_code=200)


@app.get("/nas/abrir")
def open_nas_order_direct(order: str, request: Request, client: str = "", _=Depends(authenticate)):
    """Resuelve y redirige de un solo salto, para que el enlace cuente como clic directo
    del usuario: así el navegador entrega indoor-nas:/smb: al Explorador/Finder en vez de
    bloquearlo en silencio por falta de gesto reciente."""
    clean = str(order or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{2,40}", clean):
        return nas_error_page("Número de orden inválido.")
    # Path(...) por sí solo no toca el filesystem; el .resolve() (y todo lo demás que sí
    # lo toca) ocurre dentro de resolve_nas_order_path, cubierto por el límite de tiempo.
    root_raw = Path(CONFIG["ruta_nas_clientes"])
    client_name = legacy.sanitize(str(client or "").strip())
    future = _nas_pool.submit(resolve_nas_order_path, root_raw, clean, client_name)
    try:
        root, target = future.result(timeout=8)
    except FuturesTimeoutError:
        return nas_error_page("El NAS está tardando demasiado en responder. Puede que la conexión con el NAS esté caída; avisa a soporte técnico.")
    except HTTPException as error:
        return nas_error_page(str(error.detail))
    relative = target.relative_to(root)
    return nas_indoor_redirect(request, target, ["CLIENTES", *relative.parts])


@app.get("/nas/orden/{order}/abrir-explorador")
def open_nas_order_in_explorer(order: str, request: Request, _=Depends(authenticate)):
    order_root = find_nas_order(order)
    nas_root = Path(CONFIG["ruta_nas_clientes"]).resolve()
    relative = order_root.relative_to(nas_root)
    return nas_native_redirect(request, ["CLIENTES", *relative.parts])


@app.get("/nas/orden/{order}", response_class=HTMLResponse)
@app.get("/nas/orden/{order}/{relative_path:path}")
def browse_nas_order(order: str, relative_path: str = "", _=Depends(authenticate)):
    order_root = find_nas_order(order)
    target = (order_root / relative_path).resolve()
    if target != order_root and order_root not in target.parents:
        raise HTTPException(403, "Ruta no permitida")
    if not target.exists():
        raise HTTPException(404, "El archivo o carpeta ya no existe")
    if target.is_file():
        return FileResponse(target, filename=target.name)
    items = sorted(target.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
    parent = ""
    if target != order_root:
        parent_rel = target.parent.relative_to(order_root).as_posix()
        parent = f"<a class='nas-back' href='/nas/orden/{quote(order)}/{quote(parent_rel)}'>← Volver</a>"
    cards = []
    for item in items:
        rel = item.relative_to(order_root).as_posix()
        href = f"/nas/orden/{quote(order)}/{quote(rel)}"
        kind = "Carpeta" if item.is_dir() else "Archivo"
        icon = "▣" if item.is_dir() else "↧"
        cards.append(f"<a class='nas-item' href='{href}'><span>{icon}</span><div><strong>{escape(item.name)}</strong><small>{kind}</small></div></a>")
    content = "".join(cards) or "<div class='nas-empty'>Esta carpeta está vacía.</div>"
    breadcrumb = escape(target.relative_to(order_root).as_posix() or order_root.name)
    return HTMLResponse(f"""<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{escape(order)} · NAS Indoor</title><style>
    :root{{--lime:#d0f44c;--bg:#080b08;--panel:#111610;--line:rgba(208,244,76,.22);--muted:#98a393}}*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 85% 0,rgba(92,121,34,.16),transparent 35%),var(--bg);color:#f4f7f1;font-family:Inter,Arial,sans-serif}}header{{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);background:rgba(8,11,8,.94);backdrop-filter:blur(12px)}}header img{{width:125px}}header i{{width:28px;height:1px;background:var(--lime)}}header b{{color:var(--lime);letter-spacing:.08em}}main{{max-width:1180px;margin:auto;padding:34px 24px}}.nas-title{{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}}h1{{margin:0 0 7px;font-size:clamp(1.5rem,3vw,2.4rem)}}p{{margin:0;color:var(--muted)}}.nas-back{{display:inline-flex;margin-bottom:18px;padding:9px 13px;border:1px solid var(--line);border-radius:10px;color:#e9eee5;text-decoration:none}}.nas-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(245px,1fr));gap:12px}}.nas-item{{display:flex;align-items:center;gap:13px;min-height:76px;padding:15px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:var(--panel);color:#fff;text-decoration:none;transition:.18s}}.nas-item:hover{{transform:translateY(-2px);border-color:rgba(208,244,76,.5);background:#182016}}.nas-item>span{{display:grid;place-items:center;flex:0 0 38px;height:38px;border-radius:10px;background:rgba(208,244,76,.12);color:var(--lime);font-size:1.15rem}}.nas-item div{{min-width:0}}.nas-item strong{{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.nas-item small{{display:block;margin-top:5px;color:var(--muted)}}.nas-empty{{padding:40px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}}.nas-explorer-btn{{display:inline-flex;flex:0 0 auto;padding:10px 15px;border:1px solid var(--line);border-radius:10px;color:#9ac9ee;text-decoration:none;font-size:.82rem;white-space:nowrap}}.nas-explorer-btn:hover{{border-color:#9ac9ee;background:#101a22}}</style></head><body><header><img src='/marca-indoor.svg' alt='Indoor'><i></i><b>NAS · ORDEN {escape(order.upper())}</b></header><main><div class='nas-title'><div><h1>{escape(order_root.name)}</h1><p>{breadcrumb}</p></div><a class='nas-explorer-btn' href='/nas/orden/{quote(order)}/abrir-explorador' target='_blank'>Abrir en Finder / Explorador ↗<br><small style="font-weight:400">Solo en la red/VPN de la oficina</small></a></div>{parent}<div class='nas-grid'>{content}</div></main></body></html>""")


@app.post("/api/cuenta/password")
def change_account_password(payload: dict = Body(...), username=Depends(authenticate)):
    current, password = payload.get("current"), payload.get("password")
    if not isinstance(current, str) or not isinstance(password, str) or not 6 <= len(password) <= 256:
        raise HTTPException(400, "La nueva contraseña debe tener entre 6 y 256 caracteres")
    with connect() as db:
        user = db.execute("SELECT password_hash FROM users WHERE name = ? COLLATE NOCASE", (username,)).fetchone()
        valid = password_matches(current, user["password_hash"]) if user else (
            username == os.getenv("APP_USER", "indoor") and bool(os.getenv("APP_PASSWORD", ""))
            and secrets.compare_digest(current, os.getenv("APP_PASSWORD", "")))
        if not valid:
            raise HTTPException(400, "La contraseña actual es incorrecta")
        if user:
            db.execute("UPDATE users SET password_hash = ? WHERE name = ? COLLATE NOCASE", (password_hash(password), username))
        else:
            db.execute("INSERT INTO users(name, process, password_hash, created_at) VALUES (?, ?, ?, ?)",
                       (username, "Administración", password_hash(password), datetime.now(timezone.utc).isoformat()))
        db.commit()
    return {"ok": True}


@app.post("/api/cuenta/nombre")
def change_account_name(payload: dict = Body(...), username=Depends(authenticate)):
    new_name = " ".join(str(payload.get("name") or "").split())
    password = payload.get("password")
    if not 2 <= len(new_name) <= 80:
        raise HTTPException(400, "El nombre debe tener entre 2 y 80 caracteres")
    if not isinstance(password, str):
        raise HTTPException(400, "Ingresa tu contraseña actual para confirmar")
    with connect() as db:
        user = db.execute("SELECT password_hash FROM users WHERE name = ? COLLATE NOCASE", (username,)).fetchone()
        valid = password_matches(password, user["password_hash"]) if user else (
            username == os.getenv("APP_USER", "indoor") and bool(os.getenv("APP_PASSWORD", ""))
            and secrets.compare_digest(password, os.getenv("APP_PASSWORD", "")))
        if not valid:
            raise HTTPException(400, "La contraseña actual es incorrecta")
        try:
            if user:
                db.execute("UPDATE users SET name = ? WHERE name = ? COLLATE NOCASE", (new_name, username))
            else:
                # Cuenta compartida (usuario/clave del .env, sin fila propia en la tabla users):
                # para tener un nombre propio se crea una cuenta individual, con esa misma
                # contraseña compartida; puede cambiarla luego desde "Cambiar contraseña".
                db.execute("INSERT INTO users(name, process, password_hash, created_at) VALUES (?, ?, ?, ?)",
                           (new_name, "Administración", password_hash(password), datetime.now(timezone.utc).isoformat()))
            db.commit()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Ya existe una cuenta con ese nombre")
    response = JSONResponse({"ok": True, "name": new_name})
    response.set_cookie("indoor_session", create_session_token(new_name), max_age=43200, httponly=True, secure=True, samesite="lax")
    return response


def _personal_note_payload(payload: dict) -> tuple[str, str, str]:
    title = " ".join(str(payload.get("title") or "").split())
    content = str(payload.get("content") or "").strip()
    color = str(payload.get("color") or "lime")
    if not 1 <= len(title) <= 100 or not 1 <= len(content) <= 4000:
        raise HTTPException(400, "La nota debe tener título y contenido.")
    if color not in {"lime", "blue", "pink", "orange"}:
        color = "lime"
    return title, content, color


@app.get("/api/notas-personales")
def list_personal_notes(username=Depends(authenticate)):
    with connect() as db:
        rows = db.execute("SELECT id, title, content, color, created_at, updated_at FROM personal_notes WHERE username=? COLLATE NOCASE ORDER BY updated_at DESC, id DESC", (username,)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/notas-personales")
def create_personal_note(payload: dict = Body(...), username=Depends(authenticate)):
    title, content, color = _personal_note_payload(payload)
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        cursor = db.execute("INSERT INTO personal_notes(username, title, content, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (username, title, content, color, now, now))
        db.commit()
    return {"ok": True, "id": cursor.lastrowid}


@app.put("/api/notas-personales/{note_id}")
def update_personal_note(note_id: int, payload: dict = Body(...), username=Depends(authenticate)):
    title, content, color = _personal_note_payload(payload)
    with connect() as db:
        cursor = db.execute("UPDATE personal_notes SET title=?, content=?, color=?, updated_at=? WHERE id=? AND username=? COLLATE NOCASE", (title, content, color, datetime.now(timezone.utc).isoformat(), note_id, username))
        db.commit()
    if not cursor.rowcount:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True}


@app.delete("/api/notas-personales/{note_id}")
def delete_personal_note(note_id: int, username=Depends(authenticate)):
    with connect() as db:
        cursor = db.execute("DELETE FROM personal_notes WHERE id=? AND username=? COLLATE NOCASE", (note_id, username))
        db.commit()
    if not cursor.rowcount:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def home(_=Depends(authenticate)):
    # These HTML strings also appear inside JavaScript template literals.
    from html import escape as html_escape
    def escape(value):
        return html_escape(value).replace('`', '&#96;').replace('$', '&#36;').replace('\\', '&#92;')
    with connect() as db:
        profile = db.execute("SELECT process, display_name FROM users WHERE name = ? COLLATE NOCASE", (_,)).fetchone()
    user_process = profile["process"] if profile else "Administración"
    user_display = profile["display_name"] if profile and profile["display_name"] else str(_)
    user_initials = str(_).upper()
    fabrics = json.loads(Path(__file__).with_name('fabrics.json').read_text(encoding='utf-8'))
    fabric_rows = ''.join("<tr><td>" + escape(item['code']) + "</td><td>" + escape(item['name']) + "</td><td aria-label='Stock sin registrar'>—</td></tr>" for item in fabrics)
    rows = "<tr class='empty-row'><td colspan='5'><div class='empty-icon'>↗</div><strong>Envía una orden para comenzar</strong><span>Aquí aparecerá únicamente el proceso actual.</span></td></tr>"
    return f"""<!doctype html><html lang='es'><head><meta charset='utf-8'>
    <meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>
    <meta name='theme-color' content='#050605'>
    {INPUT_CONTRAST_STYLE}
    <link rel='manifest' href='/manifest.webmanifest'><link rel='apple-touch-icon' href='/favicon.png'>
    <meta name='mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-status-bar-style' content='black'><meta name='apple-mobile-web-app-title' content='Indoor'>
    <link rel='icon' type='image/svg+xml' href='/favicon.svg?v=6'>
    <title>Indoor Sport SAS</title><style>
    :root{{--lime:#d0f44c;--lime-2:#8eaa25;--metal:linear-gradient(135deg,#6f871d 0%,#d0f44c 24%,#efffa5 48%,#d0f44c 68%,#78921e 100%);--ink:#f7f9f2;--muted:#a7b0a0;--line:rgba(208,244,76,.22);--glass:rgba(20,24,19,.62);--panel:#11150f}}
    *{{box-sizing:border-box}} body{{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#050605;margin:0;color:var(--ink);font-size:16px;line-height:1.5;min-height:100vh;min-height:100dvh;overflow-x:hidden}}
    body:before,body:after{{content:"";position:fixed;z-index:-2;border-radius:50%;filter:blur(80px);opacity:.13;background:var(--lime)}}
    body:before{{width:360px;height:360px;left:-180px;top:130px}} body:after{{width:430px;height:430px;right:-240px;bottom:-180px}}
    .topbar{{position:fixed;z-index:90;inset:0 0 auto;height:4px;background:linear-gradient(90deg,#71891e,#d0f44c,#a7ca32,#d0f44c,#71891e);box-shadow:0 0 26px rgba(208,244,76,.32)}}
    main{{max-width:none;margin:0 0 0 248px;padding:18px 18px 68px;position:relative;transition:margin-left .24s ease}}
    main:before{{content:"";position:absolute;z-index:-1;inset:80px 12% auto;height:480px;background:radial-gradient(circle,rgba(208,244,76,.08),transparent 68%);filter:blur(22px)}}
    .sidebar{{position:fixed;z-index:80;inset:4px auto 0 0;width:248px;display:flex;flex-direction:column;background:linear-gradient(180deg,#11160f 0%,#080b08 100%);border-right:1px solid rgba(208,244,76,.24);box-shadow:18px 0 55px rgba(0,0,0,.38);transition:transform .24s ease}} body.sidebar-hidden .sidebar{{transform:translateX(-105%)}} body.sidebar-hidden main{{margin-left:0}} .sidebar-brand{{height:86px;display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}} .sidebar-brand img{{width:136px;height:52px;object-fit:contain;object-position:left center}} .session-card{{display:grid;grid-template-columns:48px 1fr;gap:11px;align-items:center;padding:18px 17px;border-bottom:1px solid var(--line);background:rgba(208,244,76,.045)}} .session-avatar{{display:grid;place-items:center;width:48px;height:48px;border:1px solid rgba(208,244,76,.5);border-radius:50%;background:var(--metal);color:#11150e;font-weight:950;letter-spacing:-.04em}} .session-copy strong,.session-copy span{{display:block}} .session-copy strong{{font-size:.83rem;color:#fff}} .session-copy span{{margin-top:2px;color:var(--muted);font-size:.72rem}} .sidebar-label{{padding:16px 18px 8px;color:#778272;font-size:.68rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}} .sidebar .tabs{{display:flex;flex-direction:column;align-items:stretch;gap:5px;margin:0;padding:0 10px;overflow:visible}} .nav-parent{{display:grid;grid-template-columns:34px 1fr auto;align-items:center;width:100%;padding:11px 10px;border:1px solid rgba(208,244,76,.17);border-radius:10px;background:rgba(208,244,76,.065);color:#f2f7ec;text-align:left;font:inherit;font-size:.79rem;font-weight:850;box-shadow:none}} .nav-parent:after{{content:'⌃';color:var(--lime);font-size:.9rem}} .nav-group.collapsed .nav-parent:after{{content:'⌄'}} .nav-group.collapsed .nav-children{{display:none}} .nav-children{{display:flex;flex-direction:column;gap:3px;margin:5px 0 9px 13px;padding-left:10px;border-left:1px solid rgba(208,244,76,.2)}} .sidebar .tab{{display:grid;grid-template-columns:34px 1fr auto;align-items:center;width:100%;padding:10px;border:1px solid transparent;border-radius:10px;background:transparent;color:#c8d0c3;text-align:left;font-size:.76rem}} .sidebar .tab strong{{font-size:.76rem}} .sidebar .tab:after{{content:'›';color:#809077;font-size:1.15rem;font-weight:900}} .sidebar .tab:hover{{background:rgba(208,244,76,.075);border-color:rgba(208,244,76,.16)}} .sidebar .tab.active{{background:linear-gradient(90deg,rgba(208,244,76,.2),rgba(208,244,76,.055));border-color:rgba(208,244,76,.35);color:#f3ffc5;box-shadow:inset 3px 0 0 var(--lime)}} .sidebar .tab.active:after{{color:var(--lime)}} .sidebar .production-nav{{margin-top:3px}} .nav-icon{{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:rgba(255,255,255,.055);color:var(--lime);font-size:.65rem;font-weight:950}} .sidebar-foot{{margin-top:auto;padding:15px 18px;border-top:1px solid var(--line);color:#6f796b;font-size:.69rem}} .menu-toggle{{display:grid;place-items:center;position:fixed;z-index:95;left:202px;top:18px;width:34px;height:34px;padding:0;border-radius:10px;background:rgba(10,14,9,.92);color:var(--lime);border-color:rgba(208,244,76,.4);box-shadow:0 8px 24px rgba(0,0,0,.38);transition:left .24s ease}} body.sidebar-hidden .menu-toggle{{left:14px;background:var(--metal);color:#11150e}}
    .brand{{position:sticky;top:4px;z-index:50;display:flex;align-items:center;gap:13px;margin:0;padding:8px 6px 13px;border-bottom:1px solid rgba(208,244,76,.18);background:linear-gradient(180deg,rgba(3,5,4,.98),rgba(3,5,4,.9));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}} .brand-logo{{display:block;width:125px;height:50px;overflow:hidden;flex:0 0 auto}} .brand-logo img{{display:block;width:100%;height:100%;object-fit:contain}} .brand-line{{width:32px;height:2px;background:linear-gradient(90deg,#748d1f,#d0f44c,#99b92a)}}
    .brand .systems{{margin-left:auto}}
    header{{display:block;text-align:center;margin:0 auto;padding:76px 20px 42px}}
    body.production-mode header{{display:none}} body.production-mode .panel[data-panel='produccion']{{margin-top:18px}}
    .eyebrow{{color:var(--lime);font-size:.76rem;font-weight:850;letter-spacing:.17em;text-transform:uppercase;margin-bottom:7px}}
    h1{{font-size:clamp(2.8rem,6vw,5.25rem);letter-spacing:-.065em;line-height:.96;margin:0 auto;color:#fff;max-width:960px}}
    .subtitle{{color:var(--muted);margin:18px auto 0;max-width:660px;font-size:1.03rem}}
    .systems{{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}}
    .system{{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid var(--line);border-radius:999px;padding:9px 13px;color:#e7ecdf;font-size:.82rem;font-weight:700;backdrop-filter:blur(14px)}}
    .system i,.state i{{width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#efffa5,#d0f44c 45%,#71891e);box-shadow:0 0 0 3px rgba(208,244,76,.13),0 0 9px rgba(208,244,76,.42)}}
    .workspace{{display:grid;grid-template-columns:minmax(330px,.82fr) minmax(0,1.55fr);gap:22px;align-items:stretch}}
    .card{{position:relative;background:linear-gradient(145deg,rgba(22,25,21,.94),rgba(7,9,7,.92));border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.055);overflow:hidden;backdrop-filter:blur(22px) saturate(125%);-webkit-backdrop-filter:blur(22px) saturate(125%)}}
    .card:before{{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,var(--lime),transparent);opacity:.45}}
    .card-head{{padding:24px 26px 0}} h2{{font-size:1.16rem;letter-spacing:-.015em;margin:0 0 5px;color:#fff}}
    .card-head p{{color:var(--muted);font-size:.91rem;margin:0}} .upload-wrap{{padding:20px 26px 26px}}
    .dropzone{{display:flex;min-height:230px;align-items:center;justify-content:center;text-align:center;border:1px dashed rgba(208,244,76,.5);border-radius:18px;background:rgba(255,255,255,.035);padding:28px 20px;cursor:pointer;transition:.2s ease}}
    .dropzone:hover,.dropzone.drag{{border-color:var(--lime);background:rgba(208,244,76,.075);transform:translateY(-1px);box-shadow:inset 0 0 40px rgba(208,244,76,.05)}}
    .upload-icon{{width:56px;height:56px;margin:0 auto 14px;border-radius:17px;display:grid;place-items:center;background:var(--metal);color:#10140d;border:1px solid #d0f44c;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 12px 28px rgba(208,244,76,.24)}}
    .upload-icon svg{{width:27px;height:27px}} .dropzone strong{{display:block;font-size:1rem;color:#fff}}
    .dropzone span{{display:block;color:var(--muted);font-size:.85rem;margin-top:5px}} input[type=file]{{position:absolute;opacity:0;pointer-events:none}}
    .selected{{display:none;margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(208,244,76,.1);border:1px solid rgba(208,244,76,.24);color:#eef0ed;font-size:.86rem;overflow-wrap:anywhere}}
    .selected.show{{display:block}} .actions{{display:flex;gap:10px;margin-top:14px}}
    button{{width:100%;border:1px solid #d0f44c;border-radius:12px;background:var(--metal);color:#111318;font:inherit;font-weight:900;padding:13px 18px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(0,0,0,.28),0 10px 24px rgba(208,244,76,.18);transition:.18s ease}}
    button:hover{{filter:brightness(1.05);transform:translateY(-1px)}} button:disabled{{opacity:.48;cursor:not-allowed;transform:none}}
    #creator-submit,#submit,#order-submit{{position:relative;overflow:hidden;transition:background .35s ease,color .2s ease}} #creator-submit.is-progress,#submit.is-progress,#order-submit.is-progress{{opacity:1;background:linear-gradient(90deg,#b5dc2d 0%,#d0f44c var(--creator-progress,5%),#20280e var(--creator-progress,5%),#0f1309 100%);color:#fff;border-color:#d0f44c;text-shadow:0 1px 3px #000,0 0 8px #000;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 0 30px rgba(208,244,76,.42);animation:creatorWorking .75s ease-in-out infinite alternate;padding-left:48px}} #creator-submit.is-progress:disabled,#submit.is-progress:disabled,#order-submit.is-progress:disabled{{cursor:progress}} #creator-submit.is-progress:before,#submit.is-progress:before,#order-submit.is-progress:before{{content:'';position:absolute;left:17px;top:50%;width:17px;height:17px;margin-top:-10px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;filter:drop-shadow(0 1px 2px #000);animation:progressSpin .7s linear infinite}} #creator-submit.is-progress:after,#submit.is-progress:after,#order-submit.is-progress:after{{content:'';position:absolute;inset:0;width:38%;transform:translateX(-150%) skewX(-20deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);animation:progressSweep 1.25s linear infinite;pointer-events:none}} @keyframes creatorWorking{{from{{filter:brightness(.9)}}to{{filter:brightness(1.18)}}}} @keyframes progressSpin{{to{{transform:rotate(360deg)}}}} @keyframes progressSweep{{to{{transform:translateX(390%) skewX(-20deg)}}}}
    .message{{display:none;margin-top:14px;padding:11px 13px;border-radius:11px;font-size:.86rem;font-weight:650}} .message.show{{display:block}}
    .message.ok{{background:rgba(208,244,76,.12);color:#eaff9a}} .message.error{{background:rgba(255,70,70,.12);color:#ffaaaa}}
    .history{{min-width:0;min-height:430px}} .history-head{{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:24px 26px 16px}}
    .history-head h2:before{{content:'01';display:inline-grid;place-items:center;width:34px;height:24px;margin-right:10px;border:1px solid rgba(208,244,76,.4);border-radius:999px;color:var(--lime);font-size:.65rem;letter-spacing:.08em;vertical-align:3px}}
    .history-head p{{margin:0;color:var(--muted);font-size:.84rem}} .refresh{{width:auto;padding:8px 12px;background:rgba(255,255,255,.08);color:#eef3e8;border:1px solid var(--line);box-shadow:none;font-size:.82rem}}
    .table-wrap{{overflow:auto}} table{{width:100%;border-collapse:collapse;min-width:700px}} th{{padding:11px 16px;background:rgba(255,255,255,.045);color:#adb7a6;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;text-align:left}}
    td{{padding:20px 16px;border-top:1px solid rgba(255,255,255,.09);vertical-align:middle;font-size:.86rem}} tbody tr:hover{{background:rgba(255,255,255,.035)}} .id{{color:var(--lime);font-variant-numeric:tabular-nums;font-weight:850}}
    .file-name{{display:block;max-width:235px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#f5f7ef}}
    .detail{{color:#aab3a5;max-width:310px;line-height:1.55}} .state{{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:7px 11px;font-size:.7rem;font-weight:850;letter-spacing:.03em;background:rgba(255,255,255,.08);color:#dce3d6}}
    .progress-track{{width:100%;height:6px;margin-top:10px;border-radius:99px;background:rgba(208,244,76,.1);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}} .progress-fill{{height:100%;border-radius:inherit;background:linear-gradient(90deg,#71891e,#d0f44c 48%,#a8ca34);box-shadow:0 0 16px rgba(208,244,76,.4);transition:width .45s ease}}
    .state i{{width:6px;height:6px;box-shadow:none;background:#8eaa25}} .state.completado{{background:rgba(208,244,76,.13);color:#eaff9a}} .state.completado i{{background:var(--lime)}}
    .state.procesando,.state.recibido{{background:rgba(100,170,255,.13);color:#a9d2ff}} .state.procesando i,.state.recibido i{{background:#73b5ff;animation:pulse 1.2s infinite}}
    .state.error,.state.revisar{{background:rgba(255,70,70,.12);color:#ffaaaa}} .state.error i,.state.revisar i{{background:#ff7070}}
    .preview-modal{{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}} .preview-modal.open{{display:flex}} .preview-dialog{{width:min(1180px,96vw);max-height:90vh;display:flex;flex-direction:column;border:1px solid rgba(208,244,76,.45);border-radius:20px;background:#0d100d;box-shadow:0 30px 90px rgba(0,0,0,.7),0 0 40px rgba(208,244,76,.12);overflow:hidden}} .preview-head{{display:grid;grid-template-columns:minmax(280px,.9fr) minmax(440px,1.4fr) auto;gap:20px;align-items:center;padding:16px 24px;border-bottom:1px solid var(--line)}} .preview-head h2{{font-size:1.25rem}} .preview-head p{{margin:5px 0 0;color:var(--muted);font-size:.88rem}} .preview-overview{{display:flex;align-items:center;gap:10px;min-width:0}} .preview-designs{{display:flex;gap:7px;flex:0 0 auto}} .preview-design{{position:relative;width:66px;height:66px;border:1px solid rgba(208,244,76,.4);border-radius:10px;overflow:hidden;background:#181d15}} .preview-design img{{width:100%;height:100%;object-fit:contain;background:#fff}} .preview-design span{{position:absolute;left:3px;bottom:3px;padding:2px 5px;border-radius:5px;background:rgba(0,0,0,.82);color:#fff;font-size:.62rem;font-weight:800}} .preview-no-design{{padding:8px 10px;border:1px dashed rgba(208,244,76,.32);border-radius:10px;color:var(--muted);font-size:.75rem;white-space:nowrap}} .preview-size-summary{{display:flex;flex:1;flex-wrap:wrap;align-items:center;justify-content:center;gap:7px;min-height:48px;padding:8px 10px;border:1px solid rgba(208,244,76,.28);border-radius:12px;background:rgba(208,244,76,.045)}} .size-total,.size-chip{{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;white-space:nowrap;font-size:.82rem;font-weight:850}} .size-total{{background:var(--lime);color:#0a0d08}} .size-chip{{border:1px solid rgba(208,244,76,.34);background:#181d15;color:#fff}} .size-chip b{{color:var(--lime)}} .preview-close{{width:auto;padding:7px 11px;background:transparent;color:#fff;border-color:var(--line);box-shadow:none}} .preview-content{{padding:18px 24px;overflow:auto}} .preview-sheet{{margin-bottom:22px}} .preview-sheet-title{{display:flex;align-items:center;gap:12px;margin-bottom:10px}} .preview-sheet-title input{{max-width:320px}} .preview-table{{width:100%;min-width:760px;border-collapse:separate;border-spacing:0}} .preview-table th{{position:sticky;top:0;z-index:1;background:#20251e}} .preview-table td{{padding:7px;border-top:1px solid rgba(255,255,255,.08)}} .preview-table input,.preview-table select{{width:100%;min-width:70px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#171b17;color:#fff;font:inherit}} .preview-table tr.warning td{{background:rgba(255,184,52,.08)}} .preview-row-actions{{width:46px;text-align:center}} .preview-delete{{width:auto;padding:6px 9px;background:transparent;color:#ffaaaa;border-color:rgba(255,90,90,.35);box-shadow:none}} .preview-warnings{{margin:0 0 14px;padding:11px 13px;border-radius:10px;background:rgba(255,184,52,.1);color:#ffd28a;font-size:.84rem}} .preview-actions{{display:flex;gap:10px;padding:16px 24px;border-top:1px solid var(--line)}} .preview-actions button{{width:auto;min-width:190px}} .preview-cancel{{background:#222722;color:#fff;border-color:var(--line);box-shadow:none}} @media(max-width:850px){{.preview-head{{grid-template-columns:1fr auto}}.preview-overview{{grid-column:1/-1;grid-row:2;align-items:stretch;flex-direction:column}}.preview-size-summary{{justify-content:flex-start}}}}
    .empty-row td{{height:245px;text-align:center;color:var(--muted)}} .empty-row strong,.empty-row span{{display:block}} .empty-row strong{{color:#eef3e8;margin-top:10px}} .empty-icon{{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;margin:auto;background:rgba(208,244,76,.12);color:var(--lime);font-weight:900}}
    body.inicio-mode header{{display:none}} .home-page{{display:grid;grid-template-columns:minmax(0,1fr);gap:26px;margin-top:8px}} .home-hero{{position:relative;min-height:190px;border-radius:18px;overflow:hidden;border:1px solid var(--line)}} .home-hero img{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}} .home-hero:after{{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,11,8,.88) 0,rgba(8,11,8,.55) 45%,rgba(8,11,8,.05) 100%)}} .home-hero-copy{{position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;gap:8px;height:100%;min-height:inherit;max-width:640px;padding:28px 34px}} .home-hero-copy h2{{margin:0;font-size:clamp(1.6rem,3.2vw,2.4rem);line-height:1.1}} .home-hero-copy p::first-letter{{text-transform:uppercase}} .home-hero-copy p{{margin:0;color:#d5dccf;font-size:1rem;line-height:1.5}} .home-section h3{{margin:0 0 14px;font-size:1.25rem}} .home-gallery{{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(200px,230px);gap:12px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory;scrollbar-width:thin}} .home-gallery figure{{scroll-snap-align:start}} .home-gallery figure{{position:relative;margin:0;aspect-ratio:3/2;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#0d100d}} .home-gallery img{{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s ease}} .home-gallery figure:hover img{{transform:scale(1.04)}} .home-gallery figcaption{{position:absolute;left:0;right:0;bottom:0;padding:26px 14px 10px;font-size:.82rem;font-weight:700;background:linear-gradient(transparent,rgba(0,0,0,.78))}} @media(max-width:700px){{.home-hero{{min-height:170px}} .home-hero:after{{background:linear-gradient(0deg,rgba(8,11,8,.9) 0,rgba(8,11,8,.35) 100%)}} .home-hero-copy{{justify-content:flex-end;padding:22px}}}}
    .inventory-shell{{display:grid;gap:18px}}.inventory-hero{{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:25px;background:linear-gradient(120deg,#1f2a16,#11170e 60%,#222c17);border:1px solid rgba(208,244,76,.4);border-radius:16px;box-shadow:0 18px 35px rgba(0,0,0,.2)}}.inventory-hero h2{{margin:6px 0;font-size:clamp(1.45rem,3vw,2.15rem)}}.inventory-hero p{{margin:0;color:#c5cec0;max-width:630px;line-height:1.5}}.inventory-refresh{{width:auto;white-space:nowrap;padding:10px 14px;background:var(--lime);color:#10150c;border:0;border-radius:10px;font:inherit;font-weight:900;cursor:pointer}}.inventory-refresh:disabled{{opacity:.6;cursor:wait}}.inventory-kpi,.inventory-category{{border:1px solid var(--line);border-radius:14px;background:linear-gradient(145deg,#151b12,#0d110c);padding:17px;box-shadow:0 10px 20px rgba(0,0,0,.16)}}.inventory-kpi span,.inventory-category small{{display:block;color:#aeb9a7;font-size:.7rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase}}.inventory-category-grid{{display:flex;flex-wrap:wrap;gap:7px;padding:2px 0}}.inventory-category{{cursor:pointer;transition:.15s;padding:8px 14px;border-radius:999px;text-align:left}}.inventory-category:hover,.inventory-category.active{{border-color:var(--lime);background:#1a2414}}.inventory-category b{{display:inline;font-size:.82rem;color:#f2f7ed}}.inventory-category span{{display:inline;color:#d0f44c;font-weight:900;font-size:.75rem;margin-left:5px}}.inventory-table-card{{padding:0;overflow:hidden}}.inventory-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border-bottom:1px solid var(--line)}}.inventory-toolbar input{{width:min(100%,400px);border:1px solid var(--line);border-radius:9px;background:#11170e;color:#fff;padding:10px 12px;font:inherit;outline:none}}.inventory-toolbar input:focus{{border-color:var(--lime)}}.inventory-status{{color:#aeb9a7;font-size:.78rem}}.inventory-cards-wrap{{overflow-y:auto;max-height:560px;padding:14px}}.inventory-cards-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px}}@keyframes cardIn{{from{{opacity:0;transform:translateY(10px)}}to{{opacity:1;transform:none}}}}.inventory-item-card{{padding:16px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(145deg,#151b12,#0d110c);transition:transform .18s,border-color .18s,box-shadow .18s;animation:cardIn .28s ease both}}.inventory-item-card:hover{{transform:translateY(-3px);border-color:rgba(208,244,76,.5);box-shadow:0 10px 28px rgba(0,0,0,.3)}}.inv-badge{{display:inline-flex;padding:3px 8px;border-radius:999px;background:rgba(208,244,76,.12);color:#e7ff9a;font-size:.62rem;font-weight:850;margin-bottom:10px;letter-spacing:.04em;text-transform:uppercase}}.inv-name{{display:block;font-size:.84rem;font-weight:700;color:#f0f4eb;line-height:1.35;overflow-wrap:anywhere;margin-bottom:12px}}.inv-total{{display:block;font-size:1.5rem;font-weight:900;color:var(--lime);line-height:1}}.inv-unit{{display:block;color:#8a9485;font-size:.67rem;font-weight:700;margin-top:3px;letter-spacing:.04em;text-transform:uppercase}}.inv-fields{{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07);font-size:.69rem}}.inv-fields dt{{color:#9aaa93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px}}.inv-fields dd{{margin:0;color:#dde8d5;overflow-wrap:anywhere}}.inventory-category-pill{{display:inline-flex;padding:5px 8px;border-radius:999px;background:rgba(208,244,76,.12);color:#e7ff9a;font-size:.71rem;font-weight:850}}.inventory-empty{{padding:48px 20px;text-align:center;color:#aeb9a7;grid-column:1/-1}}@media(max-width:900px){{.inventory-kpis{{grid-template-columns:repeat(2,minmax(0,1fr))}}.inventory-category-grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}@media(max-width:600px){{.inventory-hero{{display:block;padding:20px}}.inventory-refresh{{margin-top:15px;width:100%}}.inventory-kpis{{grid-template-columns:1fr 1fr}}.inventory-category-grid{{grid-template-columns:1fr}}.inventory-toolbar{{display:block}}.inventory-toolbar input{{margin-top:10px;width:100%}}.inventory-cards-grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
    .footer-note{{text-align:center;color:#778071;font-size:.75rem;margin-top:22px}}
    .tabs{{display:flex;align-items:center;gap:7px;margin-left:8px}}
    .tab{{width:auto;min-height:0;box-shadow:none;background:rgba(255,255,255,.035);color:#aeb5ab;padding:9px 12px;border:1px solid rgba(255,255,255,.12);border-radius:11px;text-align:center;font-size:.72rem;white-space:nowrap}}
    .tab strong{{display:block;color:inherit;font-size:.72rem;margin:0}} .tab small{{display:none}}
    .tab:hover{{background:rgba(208,244,76,.09);border-color:rgba(208,244,76,.38);filter:none}} .tab.active{{background:var(--metal);border-color:#d0f44c;color:#111318;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 5px 16px rgba(208,244,76,.18)}}
    .panel{{display:none;margin-left:0}} .panel.active{{display:grid}}
    .panel[data-panel='creador'].active,.panel[data-panel='produccion'].active{{display:block}} .creator-history{{display:none!important}} .creator-form{{width:100%}} .creator-workbook-name{{display:flex;align-items:center;gap:16px;max-width:720px;margin:0 auto 20px;padding:15px 18px;border:1px solid rgba(208,244,76,.42);border-radius:15px;background:linear-gradient(145deg,rgba(208,244,76,.1),rgba(12,14,13,.94))}} .creator-workbook-name label{{flex:0 0 auto;color:#fff;font-size:.82rem;font-weight:850}} .creator-workbook-name input{{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;padding:11px 12px;font:inherit;font-weight:750;outline:none}} .creator-cards{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;gap:16px;width:100%;padding:2px 2px 18px}} .creator-main-card,.excel-sheet{{width:100%;min-width:0}} #extra-sheets{{display:contents}} .creator-actions{{max-width:620px;margin:4px auto 0}}
    .production-shell{{overflow:hidden;border-radius:15px}} .production-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 16px;border-bottom:1px solid var(--line);background:#0c100b}} .production-title h2{{font-size:1.15rem;margin:0 0 2px}} .production-title p{{margin:0;color:var(--muted);font-size:.74rem}} .production-controls{{display:flex;align-items:center;gap:8px;min-width:min(690px,64vw)}} .production-search{{flex:1;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.055);color:#fff;padding:8px 10px;font:inherit;font-size:.82rem;outline:none;transition:.2s}} .production-search:focus{{border-color:var(--lime);box-shadow:0 0 0 3px rgba(208,244,76,.1)}} .production-zoom{{width:82px;flex:0 0 82px;border:1px solid rgba(208,244,76,.38);border-radius:9px;background:#151b12;color:#fff;padding:8px;font:inherit;font-size:.8rem;font-weight:800;outline:none;cursor:pointer}} .production-zoom:focus{{border-color:var(--lime)}} .production-zoom option{{background:#151b12;color:#fff}} .production-refresh,.production-connector{{width:auto;white-space:nowrap;padding:8px 11px;border:1px solid rgba(208,244,76,.38);border-radius:9px;background:rgba(208,244,76,.1);color:#efffb0;box-shadow:none;font:inherit;font-size:.8rem;font-weight:800;text-decoration:none;cursor:pointer}} .production-connector:hover{{border-color:var(--lime);background:rgba(208,244,76,.17)}} .production-kpis{{display:flex;align-items:center;gap:18px;padding:8px 16px;background:#10140e;border-bottom:1px solid rgba(255,255,255,.06)}} .production-kpi{{display:flex;align-items:center;gap:7px;padding:0;border:0;background:none}} .production-kpi span{{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}} .production-kpi strong{{color:var(--lime);font-size:.83rem}} .production-status{{margin-left:auto;color:#7f8a79;font-size:.69rem}} .production-x-scroll{{height:16px;overflow-x:auto;overflow-y:hidden;background:#0a0d09;border-bottom:1px solid rgba(208,244,76,.2)}} .production-x-scroll>div{{height:1px}} .production-table-wrap{{max-height:calc(100vh - 206px);max-height:calc(100dvh - 206px);min-height:430px;overflow:auto;background:#080a08;border-top:1px solid rgba(208,244,76,.18)}} .production-table{{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;zoom:var(--production-zoom,1);font-size:.76rem}} .production-table th{{position:sticky;z-index:3;min-width:96px;max-width:180px;padding:7px 7px;background:#182014;border-right:1px solid rgba(208,244,76,.17);border-bottom:1px solid rgba(208,244,76,.34);color:#d9e0d3;white-space:normal;text-align:center;line-height:1.25}} .production-table .production-groups th{{top:0;height:34px;background:linear-gradient(180deg,#27351d,#172012);color:#efffb0;font-size:.68rem;letter-spacing:.055em;text-transform:uppercase;box-shadow:inset 0 -2px rgba(208,244,76,.14)}} .production-table .production-groups th:nth-child(3n){{background:linear-gradient(180deg,#30391e,#202715)}} .production-table .production-groups th:nth-child(3n+1){{background:linear-gradient(180deg,#1d3425,#14251a)}} .production-table .production-columns th{{top:34px;height:42px;background:#151b12;color:#dce5d5;font-size:.65rem}} .production-table th.production-row-head{{min-width:58px;width:58px}} .production-table td{{height:38px;min-width:96px;max-width:190px;padding:6px 7px;border-right:1px solid rgba(255,255,255,.075);border-top:1px solid rgba(255,255,255,.075);color:#e9eee5;white-space:normal;overflow-wrap:anywhere;line-height:1.25;cursor:cell;transition:background .15s,color .15s}} .production-table td:first-child{{min-width:58px;width:58px;color:var(--lime);font-weight:850;text-align:center;cursor:default}} .production-table .production-frozen{{position:sticky;background:#0f140d}} .production-table th.production-frozen{{z-index:7;background:#182014}} .production-table td.production-frozen{{z-index:2}} .production-table .production-frozen-edge{{box-shadow:10px 0 18px rgba(0,0,0,.58),2px 0 0 rgba(208,244,76,.42)}} .production-table tr:nth-child(even) td{{background:#0b0e0b}} .production-table tr:nth-child(even) td.production-frozen{{background:#10150e}} .production-table tr:hover td,.production-table tr:hover td.production-frozen{{background:#1b2417}} .production-table tr.is-selected td,.production-table tr.is-selected td.production-frozen{{background:#25341b;box-shadow:inset 0 1px rgba(208,244,76,.18),inset 0 -1px rgba(208,244,76,.18)}} .production-table td.cell-positive{{background:rgba(126,164,25,.2);color:#efffb0;font-weight:800}} .production-table td.cell-warning{{background:rgba(255,174,0,.18);color:#ffd77f;font-weight:800;text-align:center}} .production-table td.cell-chip{{color:#dfff6f;font-weight:800}} .production-resp-select{{width:100%;min-width:72px;border:1px solid rgba(208,244,76,.4);border-radius:999px;background:linear-gradient(135deg,#243313,#17220f);color:#dfff6f;padding:5px 22px 5px 9px;font:inherit;font-weight:900;outline:none;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.22);transition:.2s}} .production-resp-select:hover,.production-resp-select:focus{{border-color:var(--lime);background:#2c4015;box-shadow:0 0 0 2px rgba(208,244,76,.14)}} .production-resp-select option{{background:#151b12;color:#fff}} .production-table td.is-editing{{padding:2px;background:#1a2415!important;box-shadow:inset 0 0 0 2px var(--lime)}} .production-cell-input{{width:100%;min-width:80px;height:32px;border:0;background:#f6f8f2;color:#10130e;padding:4px 6px;font:inherit;font-weight:750;outline:none}} .production-table td.is-saving{{opacity:.55;cursor:wait}} .production-table td.is-saved{{animation:cellSaved .8s ease}} @keyframes cellSaved{{50%{{background:#52720f;color:white;box-shadow:inset 0 0 0 2px var(--lime)}}}} .production-empty{{padding:50px 24px;text-align:center;color:var(--muted)}}
    .production-table td.semaphore-green,.production-table td.semaphore-yellow,.production-table td.semaphore-orange,.production-table td.semaphore-red{{position:relative;padding-left:24px;font-weight:900}} .production-table td.semaphore-green::before,.production-table td.semaphore-yellow::before,.production-table td.semaphore-orange::before,.production-table td.semaphore-red::before{{content:'';position:absolute;left:8px;top:50%;width:9px;height:9px;border-radius:50%;transform:translateY(-50%);box-shadow:0 0 8px currentColor}} .production-table td.semaphore-green{{color:#cfff67;background:rgba(58,145,38,.2)}} .production-table td.semaphore-green::before{{background:#74ef4b}} .production-table td.semaphore-yellow{{color:#ffe36b;background:rgba(218,167,0,.2)}} .production-table td.semaphore-yellow::before{{background:#ffd52f}} .production-table td.semaphore-orange{{color:#ffc078;background:rgba(218,111,0,.2)}} .production-table td.semaphore-orange::before{{background:#ff8a24}} .production-table td.semaphore-red{{color:#ff9189;background:rgba(200,45,35,.2)}} .production-table td.semaphore-red::before{{background:#ff5147}}
    .production-table td{{overflow:hidden}} .production-table th{{overflow:hidden}} .production-table td.production-frozen{{z-index:6!important;isolation:isolate;overflow:hidden!important;background:#0f140d!important;background-clip:border-box!important}} .production-table tr:nth-child(even) td.production-frozen{{background:#11170f!important}} .production-table tr:hover td.production-frozen{{background:#1b2417!important}} .production-table tr.is-selected td.production-frozen{{background:#25341b!important}} .production-table th.production-frozen{{z-index:10!important;isolation:isolate;overflow:hidden!important;background:#182014!important;background-clip:border-box!important}} .production-table .production-frozen-edge{{border-right:3px solid var(--lime)!important;box-shadow:18px 0 24px rgba(0,0,0,1)!important}}
    .production-table td.production-frozen.semaphore-green,.production-table td.production-frozen.semaphore-yellow,.production-table td.production-frozen.semaphore-orange,.production-table td.production-frozen.semaphore-red{{position:sticky!important}}
    .production-table .production-groups th{{background:linear-gradient(180deg,#222821,#171c17);color:#d8dfd3;box-shadow:inset 0 -2px #687b42}} .production-table .production-groups th:nth-child(3n){{background:linear-gradient(180deg,#252725,#191b19);box-shadow:inset 0 -2px #6f746a}} .production-table .production-groups th:nth-child(3n+1){{background:linear-gradient(180deg,#1e2725,#151c1a);box-shadow:inset 0 -2px #4d7770}} .production-table .production-columns th{{background:#151916;color:#cbd2c7}} .production-table td{{color:#d6dcd3}} .production-table td.cell-chip{{color:#d7ddd4}} .production-table tr:hover td,.production-table tr:hover td.production-frozen{{background:#171e18!important}} .production-table tr.is-selected td,.production-table tr.is-selected td.production-frozen{{background:#202a21!important;box-shadow:inset 0 1px rgba(185,211,112,.22),inset 0 -1px rgba(185,211,112,.22)}} .production-resp-select{{border-color:#4f5e43;background:#1a201a;color:#dce4d7;box-shadow:none}} .production-resp-select:hover,.production-resp-select:focus{{border-color:#9ab64b;background:#222b1d;box-shadow:0 0 0 2px rgba(154,182,75,.1)}} .production-table td.semaphore-green{{color:#dce6d8;background:rgba(71,128,58,.09)}} .production-table td.semaphore-yellow{{color:#e4dfd1;background:rgba(161,126,42,.09)}} .production-table td.semaphore-red{{color:#e5d8d6;background:rgba(148,63,55,.09)}} .production-table td.semaphore-green::before{{background:#79bd68;box-shadow:0 0 6px rgba(121,189,104,.55)}} .production-table td.semaphore-yellow::before{{background:#d2ae55;box-shadow:0 0 6px rgba(210,174,85,.5)}} .production-table td.semaphore-red::before{{background:#cf7169;box-shadow:0 0 6px rgba(207,113,105,.5)}}
    .production-row-open{{display:inline-flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:4px;min-width:46px;padding:5px 7px;border:1px solid rgba(208,244,76,.32);border-radius:8px;background:#182016;color:#d9ea9c;text-decoration:none;font-weight:900;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;transition:.18s}} .production-row-open span{{flex:0 0 auto;font-size:.75rem;opacity:.65}} .production-row-open:hover{{border-color:var(--lime);background:#26331d;color:#fff;transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3)}}
    .file-pair{{display:grid;gap:10px}} .file-row{{position:relative;display:flex;align-items:flex-start;gap:12px;width:100%;min-width:0;padding:13px 14px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.04);cursor:pointer}}
    .file-row>div{{display:flex;flex-direction:column;gap:3px;min-width:0;width:100%}} .file-row:hover{{border-color:rgba(208,244,76,.55)}} .file-row b{{display:block;color:#fff;font-size:.87rem;line-height:1.35;overflow-wrap:anywhere}} .file-row span{{display:block;color:var(--muted);font-size:.78rem;line-height:1.4;white-space:normal;overflow-wrap:anywhere;word-break:break-word}} .file-row input{{inset:0;width:100%;height:100%;cursor:pointer}}
    .file-row.has-file{{border-color:#d0f44c;background:linear-gradient(135deg,rgba(208,244,76,.24),rgba(112,137,27,.13));box-shadow:inset 4px 0 0 #d0f44c,0 0 18px rgba(208,244,76,.12)}} .file-row.has-file:after{{content:'✓';display:grid;place-items:center;flex:0 0 25px;width:25px;height:25px;border-radius:50%;background:#d0f44c;color:#10140d;font-size:.84rem;font-weight:950;box-shadow:0 0 12px rgba(208,244,76,.38)}} .file-row.has-file span{{color:#dff986}} .dropzone.has-file{{border-color:#d0f44c;background:rgba(208,244,76,.12);box-shadow:inset 0 0 45px rgba(208,244,76,.08),0 0 20px rgba(208,244,76,.12)}}
    .mockup-slot{{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:stretch}} .mockup-slot[hidden]{{display:none}} .mockup-slot .file-row{{height:100%}}
    .add-mockup{{margin-top:2px;background:rgba(255,255,255,.045);color:#eef0ed;border:1px dashed rgba(208,244,76,.42);box-shadow:none}} .add-mockup:hover{{background:rgba(208,244,76,.1);filter:none}}
    .remove-mockup{{width:44px;padding:0;background:rgba(255,255,255,.04);color:#b8c0b5;border:1px solid var(--line);box-shadow:none;font-size:1.15rem}} .remove-mockup:hover{{color:#fff;background:rgba(255,90,90,.12);border-color:rgba(255,120,120,.35);filter:none}}
    .excel-sheet{{padding:0;border:1px solid var(--line);border-radius:22px;background:linear-gradient(145deg,#151815,#090b09);overflow:hidden}} .excel-sheet-head{{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}} .excel-sheet-head>div{{min-width:0}} .excel-sheet-head h2{{margin:0 0 6px;color:#fff;font-size:1.05rem}} .excel-sheet-head p{{margin:0;color:var(--muted);font-size:.8rem;line-height:1.45}} .remove-sheet{{width:auto;padding:7px 10px;background:rgba(255,255,255,.04);color:#c5ccc2;border-color:var(--line);box-shadow:none;font-size:.76rem;flex:0 0 auto}}
    .add-sheet{{width:100%;min-height:280px;margin:0;background:linear-gradient(145deg,rgba(208,244,76,.1),rgba(12,14,13,.94));color:#fff;border:1px dashed rgba(208,244,76,.48);box-shadow:none;font-size:1rem}} .add-sheet:hover{{background:rgba(208,244,76,.12);filter:none}}
    .form-grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}} .field{{display:flex;flex-direction:column;gap:6px;min-width:0}} .field.full{{grid-column:1/-1}} .field label{{font-size:.76rem;font-weight:800;color:#cfd6ca}} .field input,.field select,.field textarea{{width:100%;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.055);color:#fff;padding:11px 12px;font:inherit;font-size:.85rem;outline:none}} .field textarea{{min-height:82px;resize:vertical}} .field input:focus,.field select:focus,.field textarea:focus{{border-color:var(--lime)}} .field select option{{background:#161a15}} .download{{display:inline-block;margin-top:6px;color:var(--lime);font-weight:850;text-decoration:none}}
    @keyframes pulse{{50%{{opacity:.35}}}} @media(max-width:1120px){{.brand{{flex-wrap:wrap}}header{{padding-top:56px}}.workspace{{grid-template-columns:1fr}}.dropzone{{min-height:190px}}.creator-cards{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
    @media(max-width:720px){{.creator-cards{{grid-template-columns:1fr}}}}
    @media(max-width:860px){{main,body.sidebar-hidden main{{margin-left:0;padding-top:70px}}.sidebar,body.sidebar-hidden .sidebar{{transform:translateX(-105%)}}.sidebar .tabs{{overflow-y:auto;flex:1;padding-bottom:16px}}body.menu-open .sidebar{{transform:translateX(0)}}.menu-toggle,body.sidebar-hidden .menu-toggle{{left:14px;width:42px;height:42px;background:var(--metal);color:#11150e}}body.menu-open:after{{content:'';position:fixed;z-index:70;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px)}}.brand{{top:4px}}}}
    @media(max-width:620px){{main{{padding:70px 14px 44px}}header{{padding:38px 4px 34px}}.brand .eyebrow,.brand-line,.brand-logo{{display:none}}.brand .systems{{margin-left:auto}}.brand .systems .system:last-child{{display:none}}.card-head,.upload-wrap,.history-head{{padding-left:18px;padding-right:18px}}.system{{font-size:.72rem;padding:7px 10px}}.workspace{{gap:14px}}.creator-workbook-name{{align-items:stretch;flex-direction:column;gap:8px}}.production-toolbar{{align-items:stretch;flex-direction:column}}.production-controls{{min-width:0;width:100%}}.production-kpis{{grid-template-columns:1fr}}}}
    .production-connector{{font-size:0}} .production-connector::after{{content:'NAS';font-size:.8rem}}
    body.inventory-mode header{{display:none}}.fabric-card{{padding:24px;margin-top:20px}}.fabric-heading{{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}}.fabric-heading h2{{margin:8px 0}}.fabric-heading p{{color:#b7c2ae;font-size:.85rem}}#fabric-search{{width:min(100%,360px);padding:12px;background:#182014;color:#fff;border:1px solid #718b38;border-radius:10px;font:inherit}}.fabric-count{{margin:20px 0;color:#d0f44c;font-size:.85rem}}.fabric-table{{width:100%;border-collapse:collapse;table-layout:fixed}}.fabric-table th,.fabric-table td{{padding:14px 12px;text-align:left;border-bottom:1px solid #ffffff18;overflow-wrap:anywhere}}.fabric-table th{{background:#20291a;color:#d0f44c}}.fabric-table th:first-child{{width:100px}}.fabric-table td:first-child{{font-weight:800;color:#d0f44c}}.fabric-table tr:hover{{background:#d0f44c09}}.fabric-table tr[hidden]{{display:none}}@media(max-width:620px){{.fabric-card{{padding:16px}}.fabric-heading{{display:block}}#fabric-search{{margin-top:16px;width:100%}}.fabric-table td{{padding:12px 8px;font-size:.8rem}}}}
    .production-process-filter{{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#10160e;border-bottom:1px solid var(--line)}}.production-process-filter label{{font-size:.8rem;color:#d0f44c;font-weight:800}}.production-process-filter select{{min-width:220px;max-width:100%;padding:9px 12px;border:1px solid #657c32;border-radius:9px;background:#182014;color:#f3f7ed;font:inherit;font-size:.82rem}}@media(max-width:620px){{.production-process-filter select{{min-width:0;flex:1}}}}
    .user-menu{{position:relative;color:#efffb0}}.user-menu summary{{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;padding:7px 12px;border:1px solid var(--line);border-radius:24px;background:#151b12}}.user-menu summary::-webkit-details-marker{{display:none}}.user-avatar{{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:50%;background:#d0f44c;color:#10140d;font-weight:900}}.user-info{{display:grid;text-align:left;max-width:220px}}.user-info strong{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem}}.user-info small,.user-dropdown p{{font-size:.72rem;color:#b4bfa9}}.user-dropdown{{position:absolute;right:0;top:calc(100% + 8px);width:230px;padding:12px;background:#151b12;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 30px #0008;z-index:1100}}.user-dropdown button,.user-dropdown a{{display:block;width:100%;text-align:left;padding:10px;background:transparent;color:#f0f5e8;border:0;box-shadow:none;text-decoration:none;font:inherit;font-size:.82rem}}.user-dropdown button:hover,.user-dropdown a:hover{{background:#28351b;border-radius:8px}}.account-dialog{{width:min(440px,92vw);padding:28px;background:#11180f;color:#f1f5eb;border:1px solid #8aa332;border-radius:20px}}.account-dialog::backdrop{{background:#000a}}.account-close{{float:right;width:auto;padding:3px 10px}}.account-dialog label{{display:block;margin:16px 0}}.account-dialog input{{display:block;width:100%;padding:12px;margin-top:6px;background:#1c2518;color:white;border:1px solid #77864a;border-radius:8px;font:inherit}}.account-dialog p{{color:#c5d5b8}}.account-dialog .account-hint{{margin:10px 0 4px;font-size:.76rem;line-height:1.4;color:#9db08c}}@media(max-width:620px){{.user-info small{{display:none}}.user-info{{max-width:140px}}.user-menu summary{{padding:5px 8px}}}}
    .brand .systems .session-user{{display:inline-flex;align-items:center;gap:8px;max-width:min(48vw,340px);padding:9px 14px;border:1px solid var(--line);border-radius:24px;background:#151b12;color:#efffb0;font-size:.8rem;overflow-wrap:anywhere}} .brand .systems .logout-link{{display:inline-flex!important;font-size:.74rem}}
    .production-table th{{min-width:124px;max-width:230px;padding:9px 11px;line-height:1.35}} .production-table td{{min-width:124px;max-width:230px;height:46px;padding:8px 11px;line-height:1.4}} .production-table th.production-row-head,.production-table td:first-child{{min-width:76px;width:76px;max-width:76px}} .production-table .production-columns th{{height:48px}} .production-table .production-groups th{{height:38px}}
    .production-table{{font-size:var(--production-body-font,.76rem);text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}} .production-table thead{{position:sticky;top:0;z-index:1000;isolation:isolate}} .production-table tbody{{position:relative;z-index:1}} .production-table th{{top:auto;z-index:1001!important;font-weight:900;text-shadow:0 1px 1px rgba(0,0,0,.85)}} .production-table thead th.production-frozen{{z-index:1002!important}} .production-table tbody td.production-frozen{{z-index:2}} .production-table .production-groups th{{font-size:var(--production-group-font,.68rem)}} .production-table .production-columns th{{font-size:var(--production-head-font,.65rem)}} .production-table td{{text-align:center;vertical-align:middle;font-weight:700;letter-spacing:.005em}} .production-table td .production-resp-select,.production-table td .production-cell-input{{text-align:center;text-align-last:center;font-size:inherit}}
    .production-line-select{{border-width:1px;color:#10140e!important;box-shadow:inset 0 1px rgba(255,255,255,.22)!important}} .production-line-select.line-empty{{background:#1a201a!important;color:#dce4d7!important}} .production-line-select.line-copa{{background:#eac878!important;border-color:#f4d995!important}} .production-line-select.line-mundial{{background:#eead78!important;border-color:#ffc59a!important}} .production-line-select.line-olimpica{{background:#88aaa4!important;border-color:#afd0ca!important}} .production-line-select.line-muestra{{background:#82c998!important;border-color:#a8dfb8!important}} .production-line-select.line-plus{{background:#b79bd8!important;border-color:#d1b9ec!important}} .production-line-select.line-bot{{background:#6f9fcd!important;border-color:#98bee2!important}} .production-line-select option{{background:#eef1ea;color:#121612}}
    .production-table td.is-active-cell{{outline:2px solid var(--lime);outline-offset:-2px;background:#26301f!important}}
    @media(max-width:620px){{html{{max-width:100%;overflow-x:hidden;overflow-y:auto;touch-action:pan-y}}html body.schedule-mode{{max-width:100vw;overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y;-webkit-overflow-scrolling:touch}}html body.schedule-mode main,html body.schedule-mode .schedule-shell,html body.schedule-mode .schedule-grid{{max-width:100%;overflow-x:hidden!important;touch-action:pan-y}}html body.schedule-mode .schedule-events{{overflow-x:hidden!important;overflow-y:auto!important;touch-action:pan-y}}}}
    @media(max-width:620px){{body.schedule-mode{{overflow-x:hidden;overflow-y:auto}}body.schedule-mode main{{width:100%;margin:0;padding:68px 7px 18px}}body.schedule-mode .brand{{left:58px;right:8px;width:auto;padding:8px}}body.schedule-mode .brand .systems{{gap:5px}}body.schedule-mode .system{{padding:6px 8px;font-size:.62rem}}body.schedule-mode .schedule-shell{{width:100%;overflow:hidden!important;border-radius:13px}}body.schedule-mode .schedule-toolbar{{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;padding:12px 10px}}body.schedule-mode .schedule-title{{min-width:0}}body.schedule-mode .schedule-title .eyebrow{{font-size:.55rem;letter-spacing:.1em}}body.schedule-mode .schedule-title h2{{font-size:1.12rem;white-space:nowrap}}body.schedule-mode .schedule-title p{{font-size:.65rem;line-height:1.35}}body.schedule-mode .schedule-actions{{gap:4px}}body.schedule-mode .schedule-actions button{{min-width:32px;padding:7px 8px;font-size:.7rem}}body.schedule-mode .schedule-summary{{gap:8px;padding:7px 9px}}body.schedule-mode .schedule-summary strong{{font-size:.78rem;white-space:nowrap}}body.schedule-mode .schedule-summary span{{font-size:.59rem;text-align:right}}body.schedule-mode .schedule-weekdays,body.schedule-mode .schedule-grid{{width:100%;min-width:0!important;grid-template-columns:repeat(7,minmax(0,1fr))!important}}body.schedule-mode .schedule-weekdays div{{min-width:0;padding:6px 1px;font-size:.5rem}}body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,82px)}}body.schedule-mode .schedule-day{{min-width:0;height:auto!important;padding:3px 2px}}body.schedule-mode .schedule-day-number{{width:19px;height:19px;margin:0 1px 2px auto;font-size:.58rem}}body.schedule-mode .schedule-events{{max-height:56px;overflow-y:auto;overflow-x:hidden;gap:2px}}body.schedule-mode .schedule-event{{min-width:0;padding:3px 1px;border-radius:5px}}body.schedule-mode .schedule-event strong{{font-size:.48rem;letter-spacing:-.02em;white-space:normal;line-height:1.15}}}}
    .system.logout-link{{color:#ffb0aa;text-decoration:none;border-color:rgba(255,104,94,.3)}} .system.logout-link:hover{{background:rgba(255,104,94,.1);border-color:#ff746b}}
    .production-delete-row{{display:inline-grid;place-items:center;flex:0 0 29px;width:29px;height:29px;padding:0;border:1px solid rgba(255,103,94,.65);border-radius:8px;background:#251210;color:#ff8c84;font-size:16px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-delete-row:hover{{background:#481b17;color:#fff;border-color:#ff746b;filter:none}} body.production-mode .production-table th.production-row-head,body.production-mode .production-table td:first-child{{min-width:154px!important;width:154px!important;max-width:154px!important}}
    body.schedule-mode .schedule-events{{overflow-x:hidden}} body.schedule-mode .schedule-event{{text-align:center;white-space:nowrap}} body.schedule-mode .schedule-event strong{{font-size:.72rem;overflow:hidden;text-overflow:ellipsis}}
    html{{scroll-behavior:auto}}body{{text-rendering:optimizeLegibility}}main,.brand,.panel,.card{{transform:translateZ(0)}}.panel.active{{animation:panelReveal .18s ease-out}}@keyframes panelReveal{{from{{opacity:.72;transform:translateY(3px)}}to{{opacity:1;transform:none}}}}.production-table-wrap,.production-x-scroll,.schedule-events{{-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-gutter:stable}}.production-table-wrap{{contain:layout paint;touch-action:pan-x pan-y}}.production-table td,.production-table th{{backface-visibility:hidden}}button,.tab,.nav-parent,.production-row-open,.file-row,.schedule-event{{transition-duration:.14s!important}}@media(prefers-reduced-motion:reduce){{*,*::before,*::after{{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}}}@media(max-width:860px){{.sidebar,.brand{{will-change:transform}}body.menu-open:after{{backdrop-filter:none!important}}}}
    body.schedule-mode{{overflow:hidden}} body.schedule-mode main{{padding-top:18px;padding-bottom:0}} body.schedule-mode .schedule-toolbar{{padding-top:14px;padding-bottom:14px}} body.schedule-mode .schedule-title h2{{margin-top:2px;margin-bottom:3px}} body.schedule-mode .schedule-summary{{padding-top:8px;padding-bottom:8px}} body.schedule-mode .schedule-weekdays div{{padding-top:7px;padding-bottom:7px}} body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,minmax(68px,calc((100dvh - 352px)/6)))}} body.schedule-mode .schedule-day{{min-height:0;height:auto;padding:6px 8px}} body.schedule-mode .schedule-day-number{{height:20px;margin-bottom:3px}} body.schedule-mode .schedule-events{{gap:3px;max-height:calc(100% - 23px);overflow:auto;scrollbar-width:thin}} body.schedule-mode .schedule-event{{padding:4px 6px}}
    body.schedule-mode header{{display:none}} .panel[data-panel='cronograma'].active{{display:block}} .schedule-shell{{overflow:hidden;border-radius:18px}} .schedule-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 26px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#121810,#0b0e0b)}} .schedule-title h2{{margin:4px 0 5px;font-size:1.45rem}} .schedule-title p{{color:var(--muted);font-size:.84rem}} .schedule-actions{{display:flex;gap:8px}} .schedule-actions button{{width:auto;min-width:42px;padding:9px 13px;background:#171e14;color:#efffb0;border:1px solid rgba(208,244,76,.38);box-shadow:none}} .schedule-actions button:hover{{background:#243019;filter:none}} .schedule-summary{{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;background:#10150e;border-bottom:1px solid var(--line)}} .schedule-summary strong{{color:var(--lime);font-size:1rem;text-transform:capitalize}} .schedule-summary span{{color:var(--muted);font-size:.78rem}} .schedule-weekdays,.schedule-grid{{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}} .schedule-weekdays{{background:#161d13;border-bottom:1px solid var(--line)}} .schedule-weekdays div{{padding:10px 8px;text-align:center;color:#aeb9a7;font-size:.66rem;font-weight:900;letter-spacing:.08em}} .schedule-day{{min-height:126px;padding:9px;border-right:1px solid rgba(255,255,255,.075);border-bottom:1px solid rgba(255,255,255,.075);background:#0d110d;overflow:hidden}} .schedule-day:nth-child(7n){{border-right:0}} .schedule-day.outside{{background:#090c09;color:#596255}} .schedule-day.today{{box-shadow:inset 0 0 0 2px var(--lime)}} .schedule-day-number{{display:grid;place-items:center;width:25px;height:25px;margin:0 0 7px auto;border-radius:50%;font-size:.75rem;font-weight:900}} .schedule-day.today .schedule-day-number{{background:var(--lime);color:#10140d}} .schedule-events{{display:grid;gap:5px}} .schedule-event{{width:100%;padding:6px 7px;border:1px solid rgba(208,244,76,.28);border-radius:7px;background:#1b2516;color:#edf6e8;box-shadow:none;text-align:left;line-height:1.25;cursor:pointer}} .schedule-event:hover{{background:#29371e;filter:none;border-color:var(--lime)}} .schedule-event strong{{display:block;color:#dfff75;font-size:.7rem}} .schedule-event span{{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cad3c4;font-size:.64rem}} @media(max-width:900px){{.schedule-day{{min-height:95px;padding:5px}}.schedule-event span{{display:none}}}} @media(max-width:620px){{.schedule-toolbar{{align-items:flex-start;flex-direction:column;padding:18px}}.schedule-grid,.schedule-weekdays{{min-width:720px}}.schedule-shell{{overflow:auto}}}}
    .production-table td.delivery-days-cell{{position:sticky!important;z-index:30!important;text-align:center!important;font-size:.82rem!important;font-weight:950!important;opacity:1!important}} .production-table td.delivery-days-cell.semaphore-green{{color:#dfffc4!important;background:#193719!important}} .production-table td.delivery-days-cell.semaphore-orange{{color:#ffe0b3!important;background:#4a2d12!important}} .production-table td.delivery-days-cell.semaphore-red{{color:#ffd0cc!important;background:#461a18!important}} .production-table td.delivery-days-cell::before{{display:block!important}} .production-table tr.row-semaphore-green td:not(.delivery-days-cell){{background:rgba(42,104,38,.16)!important}} .production-table tr.row-semaphore-orange td:not(.delivery-days-cell){{background:rgba(151,85,22,.16)!important}} .production-table tr.row-semaphore-red td:not(.delivery-days-cell){{background:rgba(133,43,38,.16)!important}} .production-table tr.row-semaphore-green:hover td:not(.delivery-days-cell){{background:rgba(53,126,47,.24)!important}} .production-table tr.row-semaphore-orange:hover td:not(.delivery-days-cell){{background:rgba(177,99,27,.24)!important}} .production-table tr.row-semaphore-red:hover td:not(.delivery-days-cell){{background:rgba(158,52,46,.24)!important}} .production-table th.production-row-head,.production-table td:first-child{{min-width:112px!important;width:112px!important;max-width:112px!important}} .production-row-tools{{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;white-space:nowrap}} .production-drag-handle{{display:inline-grid;place-items:center;flex:0 0 29px;width:29px;height:29px;padding:0;border:1px solid #769329;border-radius:8px;background:#11170e;color:#d0f44c;font-size:16px;line-height:1;cursor:grab;user-select:none;touch-action:none;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-row-tools .production-row-open{{flex:0 0 auto;min-width:50px;border-color:#9abb36;background:#263119;color:#f1ffb8;box-shadow:0 2px 7px rgba(0,0,0,.35)}} .production-drag-handle:hover{{background:#253218;border-color:#d0f44c}} .production-drag-handle:active{{cursor:grabbing}} .production-table tr.is-dragging{{opacity:.45}} .production-table tr.drag-target td{{box-shadow:inset 0 2px #d0f44c!important}}

    /* Móvil y pantalla completa */
    .schedule-units .u-full,.schedule-units .u-short{{display:inline!important}}.schedule-units .u-short{{display:none!important}}
    @media(max-width:700px){{.schedule-units .u-full{{display:none!important}}.schedule-units .u-short{{display:inline!important}}}}
    @media(max-width:860px){{
      .sidebar-brand{{padding-left:68px}}
      .sidebar{{width:min(300px,86vw);padding-bottom:env(safe-area-inset-bottom)}}
      main,body.sidebar-hidden main,body.schedule-mode main,body.production-mode.trace-cards-mode main{{padding-left:max(8px,env(safe-area-inset-left))!important;padding-right:max(8px,env(safe-area-inset-right))!important}}
      body.schedule-mode main,body.production-mode main{{padding-bottom:env(safe-area-inset-bottom)!important}}
    }}
    @media(max-width:620px){{main{{padding-top:64px}}.card{{border-radius:16px}}}}
    /* Trazabilidad en móvil: encabezado compacto para que las tarjetas usen la pantalla */
    @media(max-width:860px){{
      body.production-mode.trace-cards-mode .production-title p,
      body.production-mode.trace-cards-mode .production-status,
      body.production-mode.trace-cards-mode .production-zoom-group,
      body.production-mode.trace-cards-mode .production-tools-menu{{display:none!important}}
      body.production-mode.trace-cards-mode .production-toolbar{{gap:8px;padding:10px 12px}}
      body.production-mode.trace-cards-mode .production-title h2{{margin:0;font-size:1.05rem}}
      body.production-mode.trace-cards-mode .production-controls{{display:flex;flex-wrap:nowrap;gap:8px;width:100%;min-width:0}}
      body.production-mode.trace-cards-mode .production-search{{flex:1 1 auto;min-width:0;width:auto}}
      body.production-mode.trace-cards-mode .production-controls button{{flex:0 0 auto;white-space:nowrap}}
      body.production-mode.trace-cards-mode .production-process-filter{{flex-wrap:nowrap;overflow-x:auto;gap:8px;padding:8px 12px;-webkit-overflow-scrolling:touch}}
      body.production-mode.trace-cards-mode .production-process-filter>label{{display:none}}
      body.production-mode.trace-cards-mode .production-process-filter select{{flex:1 0 150px;min-width:150px}}
      body.production-mode.trace-cards-mode .production-process-filter button{{flex:0 0 auto;white-space:nowrap}}
      body.production-mode.trace-cards-mode .production-kpis{{padding:6px 12px;gap:14px}}
    }}
    /* Control de operarios: quién está trabajando ahora y cuántos procesos cerró hoy */
    body.operarios-mode{{--line:rgba(180,195,167,.16)}}
    body.operarios-mode header{{display:none}}
    body.operarios-mode .footer-note{{display:none}}
    body.operarios-mode main{{padding-bottom:12px}}
    .panel[data-panel='operarios'].active{{display:block}}
    .operarios-shell{{overflow:hidden;border-radius:18px}}
    .operarios-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 26px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#121810,#0b0e0b)}}
    .operarios-title{{display:flex;align-items:center}}
    .operarios-title .eyebrow{{margin:0}}
    .operarios-toolbar .production-refresh{{padding:8px 13px;flex:0 0 auto}}
    .operarios-hover-wrap{{display:flex;align-items:stretch;flex-wrap:wrap;gap:10px;padding:8px 26px 8px}}
    .operarios-day-filter-slot{{display:flex;align-items:center;justify-content:flex-end;margin-left:auto}}
    .operarios-day-filter-slot:empty{{display:none}}
    @media(max-width:1180px){{.operarios-day-filter-slot{{margin-left:0;justify-content:flex-start;flex:1 1 100%}}}}
    .operarios-goal{{width:260px;flex:0 0 auto;display:grid;align-content:center;gap:4px;padding:7px 16px;background:linear-gradient(160deg,#12160f,#0b0e0a);border:1px solid var(--line);border-radius:11px;box-shadow:0 6px 14px rgba(0,0,0,.18)}}
    .operarios-goal-head{{display:flex;justify-content:space-between;align-items:baseline;gap:10px}}
    .operarios-goal-head span{{font-size:.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;font-weight:700}}
    .operarios-goal-head strong{{font-size:.84rem;color:#eef3e8;font-variant-numeric:tabular-nums;letter-spacing:.01em}}
    .operarios-goal-bar{{height:6px;border-radius:999px;background:#1c231b;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.4)}}
    .operarios-goal-bar i{{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#7aad50,var(--lime));transition:width .4s ease}}
    .operarios-goal.over-goal .operarios-goal-bar i{{background:linear-gradient(90deg,#3fae7a,#8bd450)}}
    .operarios-goal-pct{{font-size:.64rem;color:#c7d1c0;font-weight:600}}
    .operarios-goal.over-goal .operarios-goal-pct{{color:#a6e26d;font-weight:800}}
    .operarios-hover-btn{{width:300px;flex:0 0 auto;display:grid;align-content:center;gap:3px;padding:7px 18px;background:linear-gradient(160deg,rgba(208,244,76,.07),rgba(208,244,76,.02));border:1px solid rgba(208,244,76,.28);border-radius:11px;text-align:center;box-shadow:0 6px 14px rgba(0,0,0,.18);transition:border-color .15s,background .15s}}
    .operarios-hover-btn.has-data{{border-color:rgba(208,244,76,.5)}}
    .operarios-hover-nav{{display:flex;align-items:center;justify-content:center;gap:10px}}
    .operarios-hover-nav button{{width:auto;min-width:0;flex:0 0 24px;height:24px;padding:0;display:grid;place-items:center;background:#0f120d;border:1px solid rgba(208,244,76,.35);border-radius:50%;color:var(--lime);box-shadow:none;font-size:13px;line-height:1}}
    .operarios-hover-nav button:hover{{border-color:var(--lime);background:rgba(208,244,76,.12);filter:none}}
    .operarios-hover-title{{flex:1;min-width:0;font-size:.88rem;color:#f2f7ea;letter-spacing:.02em;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
    .operarios-hover-detail{{font-size:.68rem;color:#c7d1c0;line-height:1.3}}
    @media(max-width:980px){{.operarios-hover-btn,.operarios-goal{{width:100%}}}}
    .operarios-grid{{padding:0}}
    .operarios-hover-calendar{{margin:8px 26px 10px;border:1px solid var(--line);border-radius:16px;background:#10140f;min-height:120px}}
    .operarios-hover-calendar:empty{{display:none}}
    .operarios-hover-cal-title{{margin:0;padding:8px 20px 0;font-size:1rem;color:#eef3e8;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px}}
    .operarios-hover-cal-title small{{margin-left:0;color:var(--muted);font-size:.72rem;font-weight:400;text-transform:capitalize}}
    .operarios-day-filter-row{{display:flex;align-items:center;gap:6px}}
    .operarios-day-filter{{background:#0a0d09;border:1px solid var(--line);border-radius:9px;color:#e7ede2;font:inherit;font-size:.76rem;padding:7px 12px;color-scheme:dark;width:180px}}
    .operarios-day-filter:focus{{outline:none;border-color:var(--lime)}}
    .operarios-day-filter-clear{{width:auto;padding:5px 10px;border:1px solid rgba(208,244,76,.35);border-radius:9px;background:#141a10;color:#efffb0;font:inherit;font-size:.66rem;font-weight:700;box-shadow:none;cursor:pointer}}
    .operarios-day-filter-clear:hover{{border-color:var(--lime);background:#1d2517}}
    .operarios-day-filter-clear[hidden]{{display:none}}
    .operarios-hover-calendar .operarios-dialog-kpis{{border-bottom:1px solid rgba(255,255,255,.07);margin-top:8px;padding:8px 20px}}
    .operarios-hover-calendar .operarios-cal-empty{{padding:20px;color:var(--muted);font-size:.85rem}}
    @media(max-width:860px){{.operarios-hover-calendar{{margin:14px}}}}
    .operarios-kpis{{display:flex;align-items:center;gap:18px;padding:8px 20px;background:#10150e;border-bottom:1px solid var(--line)}}
    .operarios-kpi{{display:flex;align-items:baseline;gap:7px}}
    .operarios-kpi span{{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}}
    .operarios-kpi strong{{color:var(--lime);font-size:1rem}}
    .operarios-status{{margin-left:auto;color:#7f8a79;font-size:.7rem}}
    .operarios-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:12px;padding:0 20px 20px}}
    #operarios-grid[hidden]{{display:none!important}}
    .operarios-openarea{{display:grid;grid-template-rows:auto 1fr auto;gap:10px;width:100%;padding:17px;text-align:left;border:1px solid rgba(255,255,255,.09);border-radius:15px;background:#0d110d;color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}}
    .operarios-openarea:hover{{border-color:rgba(208,244,76,.55);background:#151b12;transform:translateY(-1px)}}
    .operarios-openarea.is-busy{{border-color:rgba(208,244,76,.42);background:#151b12}}
    .operarios-openarea-head{{display:flex;align-items:baseline;gap:9px}}
    .operarios-openarea-name{{font-size:1rem;font-weight:900;letter-spacing:.05em;text-transform:uppercase}}
    .operarios-openarea-count{{margin-left:auto;flex:0 0 auto;padding:2px 9px;border-radius:999px;background:rgba(208,244,76,.14);color:var(--lime);font-size:.7rem;font-weight:900}}
    .operarios-openarea-bar{{height:6px;border-radius:3px;background:#1d2419;overflow:hidden}}
    .operarios-openarea-bar i{{display:block;height:100%;border-radius:3px;background:var(--lime)}}
    .operarios-openarea-foot{{display:flex;justify-content:space-between;gap:8px;color:#7f8a79;font-size:.7rem}}
    .operarios-openarea-foot b{{color:var(--lime);font-weight:900}}
    .operarios-dialog{{width:min(1180px,96vw);max-width:96vw;max-height:92dvh;padding:0;border:1px solid rgba(208,244,76,.4);border-radius:20px;background:#0d100d;color:#f4f7f1;box-shadow:0 30px 90px rgba(0,0,0,.72);overflow:hidden}}
    .operarios-dialog::backdrop{{background:rgba(0,0,0,.8);backdrop-filter:blur(6px)}}
    .operarios-dialog-head{{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:18px 22px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#121810,#0b0e0b)}}
    .operarios-dialog-head h2{{margin:3px 0 2px;font-size:1.3rem;letter-spacing:.04em}}
    .operarios-dialog-head p{{margin:0;color:var(--muted);font-size:.78rem}}
    .operarios-dialog-actions{{display:flex;align-items:center;gap:8px}}
    .operarios-dialog-actions button{{width:auto;min-width:34px;padding:8px 11px;border:1px solid rgba(208,244,76,.38);border-radius:9px;background:#171e14;color:#efffb0;font:inherit;font-size:.8rem;font-weight:800;box-shadow:none;cursor:pointer}}
    .operarios-dialog-actions button:hover{{border-color:var(--lime);background:#243019}}
    .operarios-dialog-actions strong{{padding:0 6px;color:#e7ede2;font-size:.9rem;text-transform:capitalize;white-space:nowrap}}
    .operarios-dialog-x{{margin-left:6px;font-size:1.1rem!important;line-height:1}}
    .operarios-dialog-kpis{{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid rgba(255,255,255,.07);background:#10150e}}
    .operarios-dialog-kpis div{{display:flex;align-items:baseline;gap:7px}}
    .operarios-dialog-kpis span{{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em}}
    .operarios-dialog-kpis strong{{color:var(--lime);font-size:1rem}}
    .operarios-dialog-body{{max-height:60dvh;overflow:auto;-webkit-overflow-scrolling:touch}}
    .operarios-days{{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;padding:10px 22px 14px;max-height:46vh;overflow-y:auto;scrollbar-color:rgba(208,244,76,.4) #10140f;scrollbar-width:thin}}
    .operarios-days::-webkit-scrollbar{{width:9px}}
    .operarios-days::-webkit-scrollbar-track{{background:#10140f}}
    .operarios-days::-webkit-scrollbar-thumb{{background:rgba(208,244,76,.35);border-radius:999px}}
    .operarios-days::-webkit-scrollbar-thumb:hover{{background:rgba(208,244,76,.55)}}
    @media(max-width:860px){{.operarios-days{{max-height:60vh}}}}
    .operarios-daycard{{position:relative;display:grid;grid-template-rows:auto 1fr auto;gap:12px;padding:16px 16px 15px;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:linear-gradient(160deg,#10140f,#0c0f0b);box-shadow:0 6px 16px rgba(0,0,0,.22);transition:border-color .15s,transform .15s}}
    .operarios-daycard:hover{{border-color:rgba(208,244,76,.4);transform:translateY(-1px)}}
    .operarios-daycard.is-today{{border-color:var(--lime);background:linear-gradient(160deg,#182014,#0f130d);box-shadow:0 8px 20px rgba(208,244,76,.1)}}
    .operarios-daycard.is-today:before{{content:'HOY';position:absolute;top:-8px;right:12px;padding:2px 8px;border-radius:999px;background:var(--lime);color:#0d1108;font-size:.56rem;font-weight:900;letter-spacing:.05em}}
    .operarios-daycard-head{{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-bottom:11px;border-bottom:1px solid rgba(255,255,255,.07)}}
    .operarios-daycard-num{{flex:0 0 auto;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:rgba(208,244,76,.12);border:1px solid rgba(208,244,76,.3);color:var(--lime);font-size:.86rem;font-weight:900;font-variant-numeric:tabular-nums}}
    .operarios-daycard.is-today .operarios-daycard-num{{background:var(--lime);color:#0d1108;border-color:var(--lime)}}
    .operarios-daycard-date{{display:flex;flex-direction:column;line-height:1.2;gap:1px}}
    .operarios-daycard-date b{{color:#efffb0;font-size:.7rem;font-weight:900;letter-spacing:.02em}}
    .operarios-daycard-date small{{color:var(--muted);font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em}}
    .operarios-daycard.is-today .operarios-daycard-date b{{color:var(--lime)}}
    .operarios-daycard-total{{margin-left:auto;flex:0 0 auto;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.06);color:#dbe4d3;font-size:.68rem;font-weight:800;font-variant-numeric:tabular-nums}}
    .operarios-daycard.is-today .operarios-daycard-total{{background:rgba(208,244,76,.16);color:var(--lime)}}
    .operarios-daylist{{display:flex;flex-wrap:wrap;gap:7px;align-content:start;margin:0;padding:0;list-style:none}}
    .operarios-daylist li{{display:flex;align-items:center;gap:7px;padding:5px 11px 5px 5px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0a0d09}}
    .operarios-daylist b{{display:grid;place-items:center;flex:0 0 auto;min-width:24px;height:21px;padding:0 5px;white-space:nowrap;border-radius:999px;background:rgba(255,255,255,.08);color:#e7ede2;font-size:.62rem;font-weight:900;letter-spacing:.02em}}
    .operarios-daylist-stats{{display:flex;flex-wrap:wrap;align-items:center;gap:2px 9px}}
    .op-stat{{display:inline-flex;align-items:center;gap:4px;font-size:.72rem;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}}
    .op-stat-icon{{display:inline-grid;place-items:center;flex:0 0 auto;width:16px;height:16px;border-radius:50%;font-size:.58rem;font-weight:900;line-height:1}}
    .op-stat-done{{color:#4ade80}}
    .op-stat-done .op-stat-icon{{background:rgba(74,222,128,.16);border:1px solid rgba(74,222,128,.55);color:#4ade80}}
    .op-stat-active{{color:#ffa63d}}
    .op-stat-active .op-stat-icon{{background:rgba(255,166,61,.16);border:1px solid rgba(255,166,61,.55);color:#ffa63d}}
    .op-stat-rework{{color:#ff5c5c}}
    .op-stat-rework .op-stat-icon{{background:rgba(255,92,92,.16);border:1px solid rgba(255,92,92,.55);color:#ff5c5c}}
    .operarios-badge{{display:inline-grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border:1px solid rgba(208,244,76,.55);border-radius:50%;background:rgba(208,244,76,.12);color:var(--lime);font-size:.62rem;font-weight:900;letter-spacing:.02em;box-sizing:border-box}}
    .operarios-daynone{{color:#77816f;font-size:.68rem;text-align:center;padding:6px 0}}
    .operarios-cal-empty{{padding:44px 20px;text-align:center;color:var(--muted);font-size:.85rem}}
    .operarios-empty{{grid-column:1/-1;padding:44px 20px;text-align:center;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:.85rem}}
    body.operarios-mode .production-refresh:disabled{{opacity:.55;cursor:progress}}
    @media(max-width:860px){{
      body.operarios-mode .operarios-toolbar{{padding:14px;gap:10px}}
      body.operarios-mode .operarios-title h2{{font-size:1.1rem}}
      body.operarios-mode .operarios-title p{{font-size:.68rem;line-height:1.35}}
      body.operarios-mode .operarios-kpis{{padding:9px 12px;gap:14px;flex-wrap:wrap}}
      body.operarios-mode .operarios-status{{display:none}}
      body.operarios-mode .operarios-grid{{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:9px;padding:12px}}
    }}
    @media(max-width:620px){{
      body.operarios-mode .operarios-toolbar{{display:grid;grid-template-columns:1fr auto;align-items:center}}
      body.operarios-mode .operarios-title h2{{white-space:nowrap}}
      body.operarios-mode .operarios-grid{{grid-template-columns:1fr}}
    }}
    @media(hover:none) and (pointer:coarse){{.tab,.nav-parent,.user-menu summary,.menu-toggle{{min-height:44px}}input,select,textarea{{font-size:16px}}}}
    .ct-shell{{gap:12px}}
    .ct-hero{{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:28px 32px 20px}}
    .ct-hero div p{{color:var(--muted);font-size:14px;max-width:520px;margin:6px 0 0;line-height:1.5}}
    .ct-sync-btn{{background:var(--lime);color:#1a2a0a;font-weight:700;border:none;border-radius:8px;padding:10px 22px;cursor:pointer;font-size:14px;white-space:nowrap;flex-shrink:0;width:fit-content;align-self:center}}
    .ct-sync-btn:hover{{opacity:.88}}.ct-sync-btn:disabled{{opacity:.5;cursor:not-allowed}}
    .ct-kpi-row{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:0 32px 8px}}
    .ct-kpi{{background:var(--glass);border:1px solid var(--line);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:4px}}
    .ct-kpi span{{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}}
    .ct-kpi strong{{font-size:22px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}}
    .ct-kpi small{{font-size:12px;color:var(--muted)}}
    .ct-kpi.ct-kpi-alert strong{{color:#f87171}}
    .ct-table-card{{margin:0 32px 32px}}
    .ct-toolbar{{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}}
    .ct-toolbar-left strong{{font-size:15px;font-weight:600;color:var(--ink)}}
    .ct-status{{font-size:12px;color:var(--muted);margin:2px 0 0}}
    .ct-search{{background:#1a1f18;border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:8px 14px;font-size:13px;width:280px}}
    .ct-table-wrap{{overflow-x:auto;border-radius:10px;border:1px solid var(--line)}}
    .ct-table{{width:100%;border-collapse:collapse;font-size:13px}}
    .ct-table th{{background:#1a1f18;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:10px 14px;text-align:left;border-bottom:1px solid var(--line)}}
    .ct-table td{{padding:10px 14px;border-bottom:1px solid rgba(208,244,76,.07);color:var(--ink)}}
    .ct-table tr:last-child td{{border-bottom:none}}.ct-table tbody tr:hover td{{background:rgba(208,244,76,.04)}}
    .ct-num{{font-variant-numeric:tabular-nums;text-align:right}}
    .ct-pend{{color:#f87171;font-weight:600}}.ct-ok{{color:#4ade80}}
    .ct-empty{{text-align:center;color:var(--muted);padding:40px 20px;font-size:14px}}
    .ct-badge{{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;background:rgba(208,244,76,.12);color:var(--lime)}}
    .ct-badge.ct-anulada{{background:rgba(248,113,113,.12);color:#f87171}}
    .ct-badge.ct-activa{{background:rgba(74,222,128,.12);color:#4ade80}}
    .ct-pdf-btn{{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;border:1px solid var(--line);background:transparent;cursor:pointer;color:var(--muted);transition:color .15s,border-color .15s;white-space:nowrap}}
    .ct-pdf-btn:hover{{color:var(--ink);border-color:var(--muted)}}
    .ct-pdf-btn.ct-has-pdf{{color:#60a5fa;border-color:rgba(96,165,250,.35)}}
    .ct-pdf-btn.ct-has-pdf:hover{{background:rgba(96,165,250,.08)}}
    .ct-pdf-upload{{display:none}}
    /* Cartera: panel operativo compartido */
    .ct-head{{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:24px 32px 12px;flex-wrap:wrap}}.ct-head h2{{margin:4px 0;font-size:1.7rem}}.ct-head small{{color:#7ee39b;font-size:.75rem}}.ct-head button,.ct-card button,.ct-settings button,.ct-filters button{{width:auto;padding:8px 12px;border-radius:8px;background:var(--lime);color:#15200b;border:0;font-weight:800;box-shadow:none;cursor:pointer}}.ct-tabs{{display:flex;gap:4px;overflow:auto;padding:0 32px 12px;border-bottom:1px solid var(--line)}}.ct-tabs button{{width:auto;padding:9px 12px;background:transparent;color:var(--muted);border:0;border-bottom:2px solid transparent;box-shadow:none;white-space:nowrap;font-weight:700}}.ct-tabs button.active{{color:var(--lime);border-color:var(--lime)}}.ct-filters{{display:grid;grid-template-columns:2fr repeat(3,1fr) auto;gap:10px;margin:14px 32px;padding:13px;background:#111710;border:1px solid var(--line);border-radius:12px}}.ct-filters label,.ct-settings label,.ct-form label{{display:grid;gap:4px;color:var(--muted);font-size:.62rem;letter-spacing:.07em;font-weight:800}}.ct-filters input,.ct-filters select,.ct-settings input,.ct-settings select,.ct-form input,.ct-form select{{min-width:0;padding:8px;border:1px solid var(--line);border-radius:7px;background:#1a2018;color:var(--ink);font:inherit;font-size:.82rem}}.ct-main{{padding:0 32px 32px}}.ct-aging,.ct-card,.ct-group,.ct-alerts,.ct-settings article{{padding:16px 18px;background:var(--glass);border:1px solid var(--line);border-radius:13px}}.ct-aging h3,.ct-group h3,.ct-alerts h3,.ct-card h3,.ct-settings h3{{margin:0 0 6px;font-size:1rem}}.ct-aging p,.ct-card small,.ct-settings p{{margin:0;color:var(--muted);font-size:.76rem}}.ct-bands{{display:flex;gap:3px;min-height:68px;margin-top:13px}}.ct-bands button{{min-width:90px;padding:8px;border:0;color:#fff;text-align:left;cursor:pointer}}.ct-bands button b,.ct-bands button span{{display:block;font-size:.62rem}}.ct-bands button span{{margin-top:8px;font-weight:800;font-size:.75rem}}.ct-bands .selected{{outline:2px solid white;z-index:1}}.b-sin{{background:#1d3bc4}}.b-1-15{{background:#b36b00}}.b-16-30{{background:#d24a2f}}.b-31-60{{background:#d0107a}}.b-60+{{background:#7a0a3a}}.ct-kpis{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}}.ct-kpi{{padding:13px!important;border-radius:11px!important}}.ct-kpi.danger strong,.late{{color:#ef6ca8!important}}.ct-kpi.good strong,.paid{{color:#62d997!important}}.ct-groups{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.ct-group div{{display:grid;grid-template-columns:minmax(100px,1fr) 1.4fr auto;gap:8px;align-items:center;margin:11px 0;font-size:.76rem}}.ct-group small{{color:var(--muted)}}.ct-group i{{height:6px;background:#273025;border-radius:5px;overflow:hidden}}.ct-group i b{{display:block;height:100%;background:#3979dc;border-radius:5px}}.ct-group strong{{font-variant-numeric:tabular-nums}}.ct-alerts{{margin-top:12px}}.ct-alerts article{{margin-top:9px;padding:10px 12px;border-left:3px solid #d0107a;background:rgba(208,16,122,.08);font-size:.8rem}}.ct-alerts p{{line-height:1.5}}.ct-alerts small{{color:var(--muted)}}.ct-card header{{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:13px}}.ct-card td small{{display:block;color:var(--muted);font-size:.65rem}}.ct-card em{{font-style:normal;padding:3px 7px;background:rgba(96,165,250,.15);border-radius:999px;font-size:.68rem}}.ct-card button{{padding:5px 7px;margin:1px;font-size:.72rem}}.ct-card .void{{opacity:.55;text-decoration:line-through}}.ct-settings{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.ct-settings article{{display:grid;align-content:start;gap:12px}}.ct-settings .file{{display:inline-grid;width:max-content;padding:8px 12px;background:#263020;border-radius:8px;color:#efffb0;font-size:.8rem;cursor:pointer}}.ct-settings .file input{{display:none}}.ct-drop{{display:grid;gap:8px;max-width:500px;padding:24px;border:2px dashed var(--line);border-radius:12px;color:var(--muted)}}.ct-drop input{{color:var(--muted)}}#ct-dialog{{width:min(560px,94vw);max-height:90vh;padding:0;border:1px solid var(--lime);border-radius:14px;background:#111710;color:var(--ink)}}#ct-dialog::backdrop{{background:#000b}}.ct-form,.ct-detail{{display:grid;gap:11px;padding:22px}}.ct-form h3,.ct-detail h3{{margin:0}}.ct-form button,.ct-detail button{{width:auto;padding:9px 13px;background:var(--lime);border:0;border-radius:8px;font-weight:800}}.ct-error{{padding:22px;color:#ff9c9c}}@media(max-width:950px){{.ct-kpis{{grid-template-columns:repeat(2,1fr)}}.ct-filters{{grid-template-columns:1fr 1fr}}}}@media(max-width:700px){{.ct-head,.ct-main{{padding-left:16px;padding-right:16px}}.ct-tabs{{padding-left:16px}}.ct-filters{{margin:12px 16px;grid-template-columns:1fr}}.ct-groups,.ct-settings{{grid-template-columns:1fr}}.ct-bands{{overflow:auto}}.ct-bands button{{flex:0 0 130px!important}}}}
    /* Cartera usa los mismos paneles vivos y tarjetas adaptativas del panel. */
    body.cartera-mode main{{max-width:1560px;padding-top:14px}}body.cartera-mode .ct-shell{{max-width:1480px;margin:0 auto;background:transparent;border:0;box-shadow:none;overflow:visible}}body.cartera-mode .ct-head{{padding:22px 4px 15px;border-bottom:1px solid rgba(208,244,76,.16)}}body.cartera-mode .ct-head h2{{font-size:clamp(1.4rem,2.3vw,2rem);letter-spacing:-.035em}}body.cartera-mode .ct-head>div:last-child{{display:flex;gap:9px;flex-wrap:wrap}}body.cartera-mode .ct-head button{{min-height:40px;padding:9px 15px;border-radius:10px}}body.cartera-mode .ct-head button:first-child{{background:rgba(255,255,255,.07);color:#eef3e8;border:1px solid var(--line)}}body.cartera-mode .ct-tabs{{gap:18px;padding:11px 4px 0;border:0}}body.cartera-mode .ct-tabs button{{width:auto;padding:9px 2px;font-size:.76rem;letter-spacing:.05em;text-transform:uppercase}}body.cartera-mode .ct-filters{{grid-template-columns:minmax(210px,1.7fr) repeat(3,minmax(145px,1fr)) auto;margin:16px 0;padding:14px 16px;border-radius:16px;background:linear-gradient(145deg,rgba(22,25,21,.94),rgba(7,9,7,.92));box-shadow:0 16px 42px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.05)}}body.cartera-mode .ct-filters button{{align-self:end;min-height:35px;background:rgba(255,255,255,.07);color:#eff3e8;border:1px solid var(--line)}}body.cartera-mode .ct-main{{padding:0}}body.cartera-mode .ct-aging,body.cartera-mode .ct-card,body.cartera-mode .ct-group,body.cartera-mode .ct-alerts,body.cartera-mode .ct-settings article{{position:relative;background:linear-gradient(145deg,rgba(22,25,21,.94),rgba(7,9,7,.92));border-color:var(--line);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.05);overflow:hidden}}body.cartera-mode .ct-aging:before,body.cartera-mode .ct-card:before,body.cartera-mode .ct-group:before,body.cartera-mode .ct-alerts:before,body.cartera-mode .ct-settings article:before{{content:'';position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,var(--lime),transparent);opacity:.46}}body.cartera-mode .ct-kpis{{grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:12px}}body.cartera-mode .ct-kpi{{min-height:126px;padding:17px!important;background:linear-gradient(145deg,rgba(22,25,21,.96),rgba(7,9,7,.94));border-color:var(--line);border-radius:16px!important;box-shadow:0 14px 34px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.05);transition:transform .18s ease,border-color .18s ease}}body.cartera-mode .ct-kpi:hover,body.cartera-mode .ct-group:hover{{transform:translateY(-2px);border-color:rgba(208,244,76,.52)}}body.cartera-mode .ct-kpi strong{{margin-top:auto;font-size:clamp(1.15rem,1.8vw,1.65rem)}}body.cartera-mode .ct-bands{{gap:7px;min-height:78px}}body.cartera-mode .ct-bands button{{border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18);transition:transform .16s ease,filter .16s ease}}body.cartera-mode .ct-bands button:hover{{transform:translateY(-2px);filter:brightness(1.1)}}body.cartera-mode .ct-groups{{grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:13px}}body.cartera-mode .ct-group{{min-height:208px}}body.cartera-mode .ct-group h3{{padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.08)}}body.cartera-mode .ct-group i b{{background:linear-gradient(90deg,#71891e,var(--lime))}}body.cartera-mode .ct-card header{{padding-bottom:13px;border-bottom:1px solid rgba(255,255,255,.08)}}body.cartera-mode .ct-table-wrap{{border-color:rgba(208,244,76,.18)}}body.cartera-mode .ct-table th{{background:rgba(255,255,255,.045)}}body.cartera-mode .ct-table td{{padding:14px}}body.cartera-mode .ct-alerts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}}body.cartera-mode .ct-alerts h3{{grid-column:1/-1}}body.cartera-mode .ct-alerts article{{margin:0;border:1px solid rgba(208,244,76,.16);border-left:3px solid #d0107a;border-radius:12px}}body.cartera-mode .ct-settings{{grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}}@media(max-width:900px){{body.cartera-mode .ct-filters{{grid-template-columns:1fr 1fr}}body.cartera-mode .ct-groups{{grid-template-columns:1fr}}}}@media(max-width:620px){{body.cartera-mode .ct-head{{padding:16px 0 10px}}body.cartera-mode .ct-head>div:last-child{{width:100%}}body.cartera-mode .ct-head>div:last-child button{{flex:1}}body.cartera-mode .ct-filters{{grid-template-columns:1fr;margin:12px 0}}body.cartera-mode .ct-kpis{{grid-template-columns:1fr 1fr;gap:8px}}body.cartera-mode .ct-kpi{{min-height:112px;padding:13px!important}}body.cartera-mode .ct-kpi strong{{font-size:1.1rem}}body.cartera-mode .ct-alerts{{grid-template-columns:1fr}}}}
    /* No limitar Cartera a la columna central: ocupa el ancho útil del escritorio. */
    body.cartera-mode main,body:has(.panel[data-panel='cartera'].active) main{{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(18px,4vw,76px)!important;padding-right:clamp(18px,4vw,76px)!important}}body.cartera-mode .panel[data-panel='cartera'],body:has(.panel[data-panel='cartera'].active) .panel[data-panel='cartera'],body.cartera-mode .ct-shell,body:has(.panel[data-panel='cartera'].active) .ct-shell{{width:100%!important;max-width:none!important}}@media(max-width:860px){{body.cartera-mode main,body:has(.panel[data-panel='cartera'].active) main{{padding-left:14px!important;padding-right:14px!important}}}}
    /* Carga de PDF: estado vacío útil y zona de acción protagonista. */
    .ct-upload-layout{{display:grid;gap:14px;max-width:1180px;margin:22px auto 0}}.ct-upload-intro{{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:17px;padding:23px 25px;border:1px solid rgba(208,244,76,.36);border-radius:18px;background:linear-gradient(110deg,rgba(208,244,76,.14),rgba(20,27,16,.92) 44%,rgba(7,10,7,.94));box-shadow:0 20px 52px rgba(0,0,0,.3),inset 0 1px rgba(255,255,255,.08)}}.ct-upload-intro h3{{margin:2px 0 5px;font-size:1.25rem}}.ct-upload-intro p{{margin:0;max-width:640px;color:#c1cbbc;font-size:.84rem}}.ct-upload-icon{{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:var(--metal);color:#12170d;font-size:2rem;font-weight:900;box-shadow:0 12px 28px rgba(208,244,76,.25)}}.ct-upload-stat{{display:flex;align-items:center;gap:10px;padding-left:20px;border-left:1px solid rgba(208,244,76,.25)}}.ct-upload-stat strong{{font-size:2rem;color:var(--lime);line-height:1}}.ct-upload-stat span{{color:var(--muted);font-size:.7rem;line-height:1.3;text-transform:uppercase;letter-spacing:.06em;font-weight:800}}.ct-upload-card{{padding:22px!important}}.ct-upload-card header{{margin:0 0 17px!important}}.ct-upload-grid{{display:grid;grid-template-columns:minmax(250px,.7fr) minmax(360px,1.3fr);gap:14px;align-items:stretch}}.ct-upload-field{{display:grid;align-content:center;gap:8px;padding:17px;border:1px solid rgba(208,244,76,.18);border-radius:13px;background:rgba(255,255,255,.025)}}.ct-upload-field span{{font-size:.65rem;color:var(--lime);font-weight:850;letter-spacing:.1em}}.ct-upload-field select{{width:100%;padding:11px;border:1px solid var(--line);border-radius:9px;background:#1a2018;color:var(--ink);font:inherit}}.ct-upload-zone{{position:relative;display:grid;place-items:center;align-content:center;min-height:150px;padding:20px;text-align:center;border:1px dashed rgba(208,244,76,.56);border-radius:13px;background:radial-gradient(circle at center,rgba(208,244,76,.12),rgba(255,255,255,.02) 62%);cursor:pointer;transition:.18s ease}}.ct-upload-zone:hover{{transform:translateY(-2px);border-color:var(--lime);background:radial-gradient(circle at center,rgba(208,244,76,.18),rgba(255,255,255,.02) 65%)}}.ct-upload-zone b{{margin-top:8px;font-size:.88rem}}.ct-upload-zone small{{margin-top:4px;color:var(--muted);font-size:.7rem}}.ct-upload-zone-icon{{display:grid;place-items:center;width:39px;height:39px;border-radius:10px;background:rgba(208,244,76,.16);border:1px solid rgba(208,244,76,.42);color:var(--lime);font-size:.62rem;font-weight:950;letter-spacing:.05em}}.ct-upload-zone input{{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:0!important;pointer-events:none!important}}.ct-upload-msg{{min-height:22px;margin:13px 0 0;color:#8ee9b0;font-size:.78rem;font-weight:700}}.ct-upload-empty{{display:grid;gap:5px;place-items:center;min-height:145px;padding:20px;border:1px dashed rgba(208,244,76,.28);border-radius:13px;color:var(--muted);text-align:center;font-size:.78rem}}.ct-upload-empty b{{color:#eff5e9;font-size:.9rem}}.ct-upload-help{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}.ct-upload-help article{{display:flex;gap:11px;padding:14px;border:1px solid rgba(208,244,76,.17);border-radius:13px;background:rgba(13,17,12,.7)}}.ct-upload-help b{{display:grid;place-items:center;flex:0 0 28px;height:28px;border:1px solid rgba(208,244,76,.4);border-radius:50%;color:var(--lime);font-size:.68rem}}.ct-upload-help strong,.ct-upload-help span{{display:block}}.ct-upload-help strong{{color:#eff5e9;font-size:.75rem}}.ct-upload-help span{{margin-top:3px;color:var(--muted);font-size:.67rem;line-height:1.35}}.ct-upl-shell{{display:grid;gap:14px;max-width:860px;margin:0 auto}}.ct-upl-zone{{position:relative;display:grid;place-items:center;gap:9px;padding:44px 32px;border:2px dashed rgba(208,244,76,.44);border-radius:22px;background:radial-gradient(ellipse at 50% 115%,rgba(208,244,76,.13),transparent 66%),rgba(12,17,10,.85);cursor:pointer;text-align:center;transition:.22s ease;overflow:hidden}}.ct-upl-zone:hover,.ct-upl-zone.drag-over{{border-color:var(--lime);background:radial-gradient(ellipse at 50% 115%,rgba(208,244,76,.22),transparent 66%),rgba(16,23,13,.9);box-shadow:0 0 0 5px rgba(208,244,76,.09)}}.ct-upl-zone.drag-over{{transform:scale(1.015)}}.ct-upl-glow{{position:absolute;bottom:-70px;left:50%;transform:translateX(-50%);width:300px;height:130px;background:radial-gradient(circle,rgba(208,244,76,.17),transparent 70%);pointer-events:none;transition:.3s ease}}.ct-upl-zone:hover .ct-upl-glow,.ct-upl-zone.drag-over .ct-upl-glow{{bottom:-30px}}.ct-upl-icon-box{{display:grid;place-items:center;width:62px;height:62px;border-radius:20px;border:1px solid rgba(208,244,76,.42);background:rgba(208,244,76,.14);color:var(--lime);font-size:1.7rem;transition:.22s ease;user-select:none}}.ct-upl-zone:hover .ct-upl-icon-box,.ct-upl-zone.drag-over .ct-upl-icon-box{{transform:translateY(-5px);background:rgba(208,244,76,.24)}}.ct-upl-zone b{{color:#e5eee0;font-size:1rem;font-weight:800}}.ct-upl-zone span{{color:var(--muted);font-size:.76rem}}.ct-upl-zone input{{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}}.ct-upl-zone .ct-upload-msg{{min-height:0;margin:0;color:#8ee9b0;font-size:.75rem}}.ct-upl-zone .ct-upload-msg:empty{{display:none}}.ct-upl-results{{display:grid;gap:9px}}.ct-upl-card{{display:flex;align-items:center;gap:14px;padding:13px 17px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(14,20,12,.9);animation:ct-upl-in .3s ease both}}.ct-upl-card.ok{{border-left:3px solid #62d997}}.ct-upl-card.err{{border-left:3px solid #e85b99}}.ct-upl-card.loading{{border-left:3px solid rgba(208,244,76,.55)}}.ct-upl-card .ct-upl-icon{{display:grid;place-items:center;flex:0 0 33px;width:33px;height:33px;border-radius:50%;font-size:.85rem;font-weight:900}}.ct-upl-card.ok .ct-upl-icon{{background:rgba(98,217,151,.15);color:#62d997}}.ct-upl-card.err .ct-upl-icon{{background:rgba(232,91,153,.14);color:#e85b99}}.ct-upl-card.loading .ct-upl-icon{{background:rgba(208,244,76,.12);color:var(--lime);animation:ct-upl-spin 1s linear infinite}}.ct-upl-card strong{{display:block;font-size:.83rem}}.ct-upl-card span{{display:block;margin-top:3px;color:var(--muted);font-size:.71rem}}.ct-upl-foot{{display:flex;justify-content:space-between;align-items:center;padding:10px 2px 0;border-top:1px solid rgba(255,255,255,.07)}}.ct-upl-foot small{{color:var(--muted);font-size:.72rem}}.ct-upl-foot button{{width:auto;padding:8px 15px;background:rgba(208,244,76,.1);border:1px solid rgba(208,244,76,.28);color:var(--lime);border-radius:9px;font-size:.72rem;font-weight:800}}@keyframes ct-upl-in{{from{{opacity:0;transform:translateY(10px)}}to{{opacity:1;transform:none}}}}@keyframes ct-upl-spin{{to{{transform:rotate(360deg)}}}}@media(max-width:760px){{.ct-upload-intro{{grid-template-columns:auto 1fr;padding:18px}}.ct-upload-stat{{grid-column:1/-1;padding:12px 0 0;border-left:0;border-top:1px solid rgba(208,244,76,.2)}}.ct-upload-grid,.ct-upload-help{{grid-template-columns:1fr}}}}
    .ct-pending{{padding:18px!important}}.ct-pending>article{{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px 0;border-top:1px solid rgba(255,255,255,.08)}}.ct-pending>article>span{{display:grid;place-items:center;width:39px;height:39px;border-radius:10px;background:rgba(208,244,76,.16);color:var(--lime);font-size:.62rem;font-weight:900}}.ct-pending strong,.ct-pending small{{display:block}}.ct-pending small{{margin-top:3px}}.ct-pending header>b{{color:var(--lime);font-size:.78rem}}.ct-pdf-summary{{padding:22px}}.ct-pdf-summary h3{{margin:0 0 5px}}.ct-pdf-summary>p,.ct-form-note{{color:var(--muted);font-size:.8rem}}.ct-pdf-summary>div{{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:17px 0}}.ct-pdf-summary article{{padding:10px;border-radius:9px;background:rgba(255,255,255,.045)}}.ct-pdf-summary article span,.ct-pdf-summary article b{{display:block}}.ct-pdf-summary article span{{color:var(--muted);font-size:.62rem;font-weight:800}}.ct-pdf-summary article b{{margin-top:4px;font-size:.85rem}}.ct-pdf-summary details{{margin:14px 0;color:var(--muted);font-size:.8rem}}.ct-pdf-summary pre{{max-height:180px;overflow:auto;padding:10px;background:#080b08;border-radius:8px;white-space:pre-wrap;font:inherit;font-size:.7rem}}.ct-pdf-summary footer{{display:flex;gap:8px;flex-wrap:wrap}}.ct-pdf-summary button{{width:auto;padding:9px 12px;border:0;border-radius:8px;background:var(--lime);color:#14200b;font-weight:800}}@media(max-width:600px){{.ct-pending>article{{grid-template-columns:auto 1fr}}.ct-pending>article button{{grid-column:1/-1}}.ct-pdf-summary>div{{grid-template-columns:1fr}}}}
    /* Tablero ejecutivo y ficha de revisión de PDF. */
    body.cartera-mode .ct-aging{{padding:20px 22px;background:linear-gradient(130deg,rgba(35,48,25,.72),rgba(9,12,9,.95) 52%,rgba(16,28,16,.84))}}body.cartera-mode .ct-aging>header,.ct-pdf-summary>header{{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}}.ct-section-kicker{{display:block;margin-bottom:5px;color:var(--lime);font-size:.61rem;letter-spacing:.13em;font-weight:900}}body.cartera-mode .ct-aging h3{{font-size:1.1rem}}.ct-aging-total{{min-width:120px;padding:10px 13px;border:1px solid rgba(208,244,76,.28);border-radius:12px;background:rgba(208,244,76,.07);color:var(--lime);font-size:1.1rem;text-align:right}}.ct-aging-total small{{display:block;margin-top:3px;color:var(--muted);font-size:.6rem;text-transform:uppercase;letter-spacing:.08em}}body.cartera-mode .ct-bands{{margin-top:18px;gap:9px}}body.cartera-mode .ct-bands button{{position:relative;min-height:88px;padding:13px 14px;overflow:hidden}}body.cartera-mode .ct-bands button:after{{content:'';position:absolute;inset:auto -20px -34px auto;width:78px;height:78px;border:1px solid rgba(255,255,255,.18);border-radius:50%}}body.cartera-mode .ct-bands button b{{position:relative;font-size:.65rem;letter-spacing:.06em}}body.cartera-mode .ct-bands button span{{position:relative;margin-top:12px;font-size:1rem}}body.cartera-mode .ct-bands button small{{position:relative;display:block;margin-top:5px;color:rgba(255,255,255,.76);font-size:.61rem}}body.cartera-mode .ct-kpi{{position:relative;overflow:hidden}}body.cartera-mode .ct-kpi:after{{content:'';position:absolute;right:-21px;bottom:-28px;width:82px;height:82px;border:1px solid rgba(208,244,76,.13);border-radius:50%}}.ct-kpi-icon{{position:absolute;right:15px;top:14px;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:rgba(208,244,76,.1);color:var(--lime);font-style:normal;font-size:1rem;font-weight:900}}body.cartera-mode .ct-kpi.danger .ct-kpi-icon{{background:rgba(239,108,168,.12);color:#ef6ca8}}body.cartera-mode .ct-kpi.good .ct-kpi-icon{{background:rgba(98,217,151,.12);color:#62d997}}body.cartera-mode .ct-group{{min-height:185px;padding:18px}}body.cartera-mode .ct-group header{{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08)}}body.cartera-mode .ct-group header h3{{margin:0;border:0;padding:0}}body.cartera-mode .ct-group header span{{color:var(--muted);font-size:.65rem}}.ct-empty{{display:grid;place-items:center;min-height:90px;margin:12px 0 0!important;border:1px dashed rgba(208,244,76,.16);border-radius:10px;color:var(--muted);font-size:.76rem}}body.cartera-mode .ct-alerts{{min-height:88px;padding:16px 18px}}body.cartera-mode .ct-alerts:has(article){{min-height:unset}}.ct-pdf-summary{{padding:0!important;overflow:hidden;background:linear-gradient(145deg,#151d14,#0b0f0b)!important}}.ct-pdf-summary>header{{padding:24px 24px 18px;background:linear-gradient(110deg,rgba(208,244,76,.14),transparent 58%)}}.ct-pdf-summary h3{{font-size:1.25rem!important}}.ct-detected{{padding:9px 11px;border-left:1px solid rgba(208,244,76,.35);color:var(--muted);font-size:.61rem;line-height:1.15;text-transform:uppercase;letter-spacing:.06em;text-align:right}}.ct-detected strong{{color:var(--lime);font-size:1.35rem;letter-spacing:0}}.ct-summary-grid{{padding:0 24px;grid-template-columns:1fr 1fr!important;gap:10px!important}}.ct-summary-grid article{{position:relative;min-height:82px;padding:13px 12px 12px 45px!important;border:1px solid rgba(255,255,255,.045);background:rgba(255,255,255,.04)!important;transition:.18s ease}}.ct-summary-grid article:hover{{transform:translateY(-2px);border-color:rgba(208,244,76,.35);background:rgba(208,244,76,.08)!important}}.ct-summary-grid article i{{position:absolute;left:12px;top:13px;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:rgba(208,244,76,.13);color:var(--lime);font-style:normal;font-size:.8rem;font-weight:900}}.ct-summary-grid article b{{line-height:1.28;font-size:.79rem!important;word-break:break-word}}.ct-pdf-summary details{{margin:16px 24px!important;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.16)}}.ct-pdf-summary summary{{cursor:pointer;color:#dbe7d5;font-weight:700}}.ct-pdf-summary footer{{padding:0 24px 24px}}.ct-pdf-summary footer button:first-child{{display:flex;gap:10px;align-items:center;background:var(--lime)}}.ct-pdf-summary footer button:first-child span{{font-size:1rem}}.ct-pdf-summary footer button:last-child{{background:rgba(255,255,255,.08);color:#eef3e8}}.ct-btn-danger{{background:rgba(232,91,153,.15)!important;border:1px solid rgba(232,91,153,.4)!important;color:#e85b99!important;margin-top:6px}}.ct-btn-danger:hover{{background:rgba(232,91,153,.28)!important}}.ct-filter-active{{background:rgba(250,204,21,.12)!important;border-color:rgba(250,204,21,.5)!important;color:#facc15!important;font-weight:600}}.ct-loading{{display:grid;place-items:center;min-height:60vh;gap:14px;color:var(--muted);font-size:.88rem;text-align:center}}@keyframes ct-spin{{to{{transform:rotate(360deg)}}}}.ct-spinner{{width:36px;height:36px;border:2.5px solid rgba(208,244,76,.18);border-top-color:var(--lime);border-radius:50%;animation:ct-spin .75s linear infinite}}.ct-pay-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;padding:16px 0}}.ct-pay-card{{display:flex;flex-direction:column;gap:9px;padding:16px 18px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.04);transition:.18s ease}}.ct-pay-card:hover{{border-color:rgba(208,244,76,.25);background:rgba(208,244,76,.05)}}.ct-pay-card.void{{opacity:.38}}.ct-pay-card>header{{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}}.ct-pay-card h4{{margin:3px 0 0;font-size:.85rem}}.ct-pay-card>header small{{color:var(--muted);font-size:.65rem}}.ct-pay-amount{{font-size:1.35rem;font-weight:800;color:var(--lime);letter-spacing:-.02em}}.ct-pay-card.void .ct-pay-amount{{color:var(--muted)}}.ct-pay-ref{{padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.05);font-size:.68rem;color:var(--muted)}}.ct-pay-ref small{{text-transform:uppercase;font-weight:700;margin-right:4px;opacity:.6}}.ct-pay-card footer{{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}}.ct-pay-card footer small{{color:var(--muted);font-size:.65rem}}.ct-pay-card footer>div{{display:flex;gap:6px}}@media(max-width:600px){{body.cartera-mode .ct-aging>header,.ct-pdf-summary>header{{display:grid}}.ct-aging-total{{text-align:left}}.ct-summary-grid{{grid-template-columns:1fr!important;padding:0 16px}}.ct-pdf-summary>header,.ct-pdf-summary footer{{padding-left:16px;padding-right:16px}}.ct-pdf-summary details{{margin-left:16px!important;margin-right:16px!important}}}}
    .ct-assistant-steps{{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:0;padding:14px 24px 18px;list-style:none;border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.12)}}.ct-assistant-steps li{{position:relative;display:flex;gap:8px;align-items:center;color:var(--muted);font-size:.7rem}}.ct-assistant-steps li:not(:last-child):after{{content:'';position:absolute;top:15px;left:31px;right:8px;height:1px;background:rgba(255,255,255,.12)}}.ct-assistant-steps b{{z-index:1;display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border:1px solid rgba(255,255,255,.16);border-radius:50%;background:#121812;color:var(--muted);font-size:.7rem}}.ct-assistant-steps span{{display:grid;gap:1px;font-weight:800;color:#d7e0d2}}.ct-assistant-steps small{{font-size:.59rem;color:var(--muted);font-weight:500}}.ct-assistant-steps .done b{{background:#214331;border-color:#62d997;color:#b8f5ce}}.ct-assistant-steps .active b{{background:var(--lime);border-color:var(--lime);color:#17200e;box-shadow:0 0 0 5px rgba(208,244,76,.1)}}.ct-assistant-steps .active span{{color:var(--lime)}}@media(max-width:600px){{.ct-assistant-steps{{grid-template-columns:1fr;padding:13px 16px;gap:11px}}.ct-assistant-steps li:not(:last-child):after{{top:31px;bottom:-11px;left:15px;right:auto;width:1px;height:auto}}}}
    #ct-dialog:has(.ct-pdf-full){{width:100vw;max-width:none;height:100dvh;max-height:none;border:0;border-radius:0;background:#090d09}}#ct-dialog:has(.ct-pdf-full)::backdrop{{background:#050805}}.ct-pdf-full{{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;height:100dvh!important;max-width:1640px;margin:auto;background:radial-gradient(circle at top left,rgba(208,244,76,.10),transparent 34%),#090d09!important}}.ct-pdf-full>header{{padding:24px clamp(24px,4vw,64px) 18px}}.ct-pdf-full .ct-assistant-steps{{padding-left:clamp(24px,4vw,64px);padding-right:clamp(24px,4vw,64px)}}.ct-pdf-workspace{{display:grid!important;grid-template-columns:minmax(360px,.82fr) minmax(500px,1.18fr);gap:16px;min-height:0;margin:0!important;padding:18px clamp(24px,4vw,64px)!important}}.ct-pdf-side,.ct-pdf-viewer{{min-height:0;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:linear-gradient(150deg,rgba(25,33,23,.94),rgba(10,14,10,.96));overflow:auto}}.ct-side-title{{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}}.ct-side-title span{{color:var(--lime);font-size:.66rem;font-weight:900;letter-spacing:.1em}}.ct-side-title small{{color:var(--muted);font-size:.65rem}}.ct-pdf-full .ct-summary-grid{{padding:16px;grid-template-columns:1fr 1fr!important}}.ct-pdf-full details{{margin:0 16px 16px!important}}.ct-pdf-viewer{{display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}}.ct-pdf-viewer iframe{{width:100%;height:100%;min-height:480px;border:0;background:#fff}}.ct-pdf-full footer{{padding:15px clamp(24px,4vw,64px) 22px;border-top:1px solid rgba(255,255,255,.08)}}@media(max-width:850px){{#ct-dialog:has(.ct-pdf-full){{height:100dvh}}.ct-pdf-full{{height:100dvh!important;overflow:auto}}.ct-pdf-workspace{{grid-template-columns:1fr;overflow:visible}}.ct-pdf-viewer{{min-height:520px}}.ct-pdf-full>header{{padding:18px 16px}}.ct-pdf-full .ct-assistant-steps,.ct-pdf-full footer{{padding-left:16px;padding-right:16px}}.ct-pdf-workspace{{padding:14px 16px!important}}}}
    .ct-documents{{padding:22px!important}}.ct-document-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}}.ct-document-card{{display:grid;gap:14px;padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:15px;background:linear-gradient(145deg,rgba(29,37,27,.95),rgba(9,13,9,.95));box-shadow:inset 0 1px rgba(255,255,255,.05);transition:.2s ease;overflow:hidden}}.ct-document-card:hover{{transform:translateY(-3px);border-color:rgba(208,244,76,.45);box-shadow:0 17px 31px rgba(0,0,0,.24)}}.ct-document-card.overdue{{border-left:3px solid #e85b99}}.ct-document-card header{{display:flex!important;justify-content:space-between;align-items:start;margin:0!important;padding:0!important;border:0!important}}.ct-doc-number{{display:inline-flex;align-items:center;gap:7px;color:var(--lime);font-family:ui-monospace,monospace;font-size:.78rem;font-weight:900}}.ct-doc-number i{{padding:3px 6px;border-radius:5px;background:rgba(208,244,76,.13);color:#dffb87;font-family:Inter,Arial,sans-serif;font-size:.53rem;font-style:normal;letter-spacing:.08em}}.ct-document-card h4{{max-width:210px;margin:7px 0 2px;font-size:.94rem;line-height:1.2}}.ct-document-card header em{{background:rgba(96,165,250,.16);color:#deebff;white-space:nowrap}}.ct-doc-meta,.ct-doc-values{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}.ct-doc-meta span,.ct-doc-values span{{display:grid;gap:4px}}.ct-doc-meta small,.ct-doc-values small{{color:var(--muted);font-size:.6rem;font-weight:850;letter-spacing:.07em}}.ct-doc-meta b{{font-size:.72rem;line-height:1.32}}.ct-doc-values{{padding:11px;border-radius:10px;background:rgba(255,255,255,.035)}}.ct-doc-values span:last-child b{{color:var(--lime);font-size:.92rem}}.ct-doc-progress{{height:5px;overflow:hidden;border-radius:999px;background:#283026}}.ct-doc-progress i{{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3ebc7d,#a8f553)}}.ct-document-card footer{{display:flex;justify-content:space-between;gap:8px;align-items:center;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}}.ct-document-card footer>small{{font-size:.62rem}}.ct-document-card footer div{{display:flex;gap:4px}}.ct-document-card footer button{{width:29px;height:29px;margin:0;padding:0;border-radius:9px;font-size:.75rem}}@media(max-width:600px){{.ct-documents{{padding:14px!important}}.ct-document-grid{{grid-template-columns:1fr}}}}
    /* Tramos de vencimiento: cada tarjeta se llena como un nivel de líquido. */
    body.cartera-mode .ct-bands{{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;min-height:172px}}body.cartera-mode .ct-bands .ct-liquid-card{{isolation:isolate;display:block;min-width:0;min-height:172px;padding:16px;border:1px solid rgba(255,255,255,.16);border-radius:17px;background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(0,0,0,.18));text-shadow:none;transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease;overflow:hidden}}body.cartera-mode .ct-bands .ct-liquid-card:hover{{transform:translateY(-5px);filter:none;border-color:var(--liquid);box-shadow:0 16px 30px color-mix(in srgb,var(--liquid) 25%,transparent)}}body.cartera-mode .ct-bands .ct-liquid-card.selected{{outline:0;border:2px solid var(--liquid);box-shadow:0 0 0 4px color-mix(in srgb,var(--liquid) 16%,transparent)}}.ct-liquid-card.b-sin{{--liquid:#3153e2}}.ct-liquid-card.b-1-15{{--liquid:#d38800}}.ct-liquid-card.b-16-30{{--liquid:#eb5a3d}}.ct-liquid-card.b-31-60{{--liquid:#e31189}}.ct-liquid-card.b-60+{{--liquid:#c9fa3f}}.ct-liquid-fill{{position:absolute;z-index:-2;left:0;right:0;bottom:0;height:var(--level);background:linear-gradient(180deg,color-mix(in srgb,var(--liquid) 80%,white),var(--liquid));opacity:.93;transition:height .8s cubic-bezier(.2,.8,.2,1)}}.ct-liquid-wave{{position:absolute;z-index:-1;left:-15%;bottom:calc(var(--level) - 10px);width:130%;height:25px;border-radius:50%;background:color-mix(in srgb,var(--liquid) 82%,white);opacity:.92;animation:ct-water-wave 4s ease-in-out infinite;transition:bottom .8s cubic-bezier(.2,.8,.2,1)}}.ct-liquid-card b,.ct-liquid-card span,.ct-liquid-card small,.ct-liquid-card em{{position:relative;z-index:1;display:block!important;color:#fff!important}}.ct-liquid-card b{{font-size:.7rem!important;letter-spacing:.07em}}.ct-liquid-card span{{margin-top:29px!important;font-size:1.35rem!important;font-variant-numeric:tabular-nums}}.ct-liquid-card small{{margin-top:5px!important;font-size:.66rem!important;opacity:.9}}.ct-liquid-card em{{position:absolute;right:13px;bottom:12px;font-size:.68rem;font-style:normal;font-weight:900;opacity:.9}}.ct-liquid-card[style*="--level:0%"]{{background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(0,0,0,.22))}}.ct-liquid-card[style*="--level:0%"] .ct-liquid-wave{{display:none}}@keyframes ct-water-wave{{0%,100%{{transform:translateX(-2%) scaleY(.9)}}50%{{transform:translateX(3%) scaleY(1.12)}}}}@media(max-width:900px){{body.cartera-mode .ct-bands{{grid-template-columns:repeat(3,minmax(0,1fr))}}}}@media(max-width:600px){{body.cartera-mode .ct-bands{{grid-template-columns:repeat(2,minmax(0,1fr));min-height:0}}body.cartera-mode .ct-bands .ct-liquid-card{{min-height:145px}}}}
    body.cartera-mode .footer-note{{display:none}}
    @media(max-width:700px){{.ct-hero,.ct-kpi-row,.ct-table-card{{padding-left:16px;padding-right:16px}}.ct-search{{width:100%}}}}
    /* Adaptación integral para pantallas táctiles y móviles. */
    @media(max-width:860px){{html,body{{width:100%;max-width:100%;overflow-x:hidden}}body{{-webkit-tap-highlight-color:transparent}}main,body.sidebar-hidden main{{width:100%;min-width:0;padding:76px 14px 34px}}.brand{{position:fixed;top:4px;left:64px;right:8px;width:auto;min-width:0;padding:7px 9px 9px}}.brand-logo{{width:96px;height:38px}}.panel,.panel.active{{min-width:0;width:100%}}button,input,select,textarea{{font-size:16px!important}}button{{min-height:42px}}.card,.ct-card,.ct-aging,.ct-group,.ct-alerts{{max-width:100%}}}}
    @media(max-width:620px){{main,body.sidebar-hidden main{{padding:72px 10px 28px}}.brand{{left:58px;right:6px;gap:7px}}.brand-logo{{width:78px;height:34px}}.session-user{{max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.home-page{{gap:18px}}.home-hero-copy{{padding:18px}}.home-hero-copy p{{font-size:.88rem}}.home-section h3{{font-size:1.05rem}}.home-gallery{{grid-auto-columns:minmax(175px,78vw)}}.ct-head{{align-items:stretch!important}}.ct-head h2{{font-size:1.42rem!important}}.ct-head>div:last-child{{display:grid!important;grid-template-columns:1fr 1fr;gap:8px}}.ct-head>div:last-child button{{width:100%;padding:9px 7px!important}}.ct-tabs{{gap:12px!important;padding-bottom:8px!important;scrollbar-width:none}}.ct-tabs::-webkit-scrollbar{{display:none}}.ct-tabs button{{font-size:.68rem!important}}.ct-filters{{gap:8px!important;padding:11px!important}}.ct-filters label{{font-size:.61rem!important}}.ct-filters input,.ct-filters select{{min-height:42px;padding:10px!important}}.ct-filters button{{width:100%;min-height:42px}}.ct-aging,.ct-documents,.ct-card,.ct-group,.ct-alerts{{border-radius:14px!important}}.ct-aging{{padding:14px!important}}.ct-aging-total{{min-width:0!important;width:100%;text-align:left!important}}body.cartera-mode .ct-bands{{grid-template-columns:1fr 1fr!important;gap:8px!important;overflow:visible!important}}body.cartera-mode .ct-bands .ct-liquid-card{{min-width:0!important;min-height:132px!important;padding:12px!important}}.ct-liquid-card span{{margin-top:20px!important;font-size:1.05rem!important}}.ct-kpis,body.cartera-mode .ct-kpis{{grid-template-columns:1fr 1fr!important}}.ct-kpi,body.cartera-mode .ct-kpi{{min-width:0;min-height:104px!important;padding:12px!important}}.ct-kpi span{{font-size:.57rem}}.ct-kpi strong{{font-size:1rem!important;overflow-wrap:anywhere}}.ct-kpi-icon{{right:10px!important;top:10px!important;transform:scale(.86)}}.ct-groups,body.cartera-mode .ct-groups{{grid-template-columns:1fr!important}}.ct-group{{min-height:0!important;padding:14px!important}}.ct-group div{{grid-template-columns:minmax(88px,1fr) minmax(54px,.9fr) auto!important;font-size:.68rem!important}}.ct-group strong{{font-size:.66rem}}.ct-document-card{{padding:14px!important}}.ct-document-card h4{{max-width:170px;font-size:.86rem!important}}.ct-doc-meta,.ct-doc-values{{gap:7px!important}}.ct-document-card footer{{align-items:flex-start!important;flex-direction:column}}.ct-document-card footer>small{{line-height:1.45}}.ct-document-card footer div{{width:100%}}.ct-document-card footer button{{width:36px!important;height:36px!important}}.ct-table-wrap{{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px}}.ct-table-wrap table{{min-width:720px}}.ct-card header{{align-items:stretch!important}}.ct-card header>div:last-child{{display:flex;gap:6px;flex-wrap:wrap}}.ct-card header button{{min-height:38px}}.ct-settings{{gap:10px!important}}.ct-settings article{{padding:16px!important}}#ct-dialog{{width:calc(100vw - 20px);max-height:calc(100dvh - 20px);border-radius:14px}}.ct-form,.ct-detail{{max-height:calc(100dvh - 40px);overflow:auto;padding:17px}}.ct-form button,.ct-detail button{{min-height:44px;width:100%}}.ct-upload-layout{{gap:12px!important}}.ct-upload-intro{{grid-template-columns:auto 1fr!important;padding:17px!important}}.ct-upload-stat{{grid-column:1/-1;justify-self:stretch;text-align:left!important;border-left:0!important;border-top:1px solid rgba(208,244,76,.18);padding:10px 0 0!important}}.ct-upload-card{{padding:16px!important}}.ct-upload-grid{{grid-template-columns:1fr!important}}.ct-upload-zone{{min-height:150px!important}}.ct-pending>article{{padding:12px 0!important}}.ct-pending-actions{{grid-column:1/-1;width:100%}}.ct-pending-actions button{{flex:1;min-height:40px}}.preview-modal{{padding:8px}}.preview-dialog{{width:100%;max-height:calc(100dvh - 16px);border-radius:14px}}.preview-head,.preview-content,.preview-actions{{padding:14px!important}}.preview-actions{{flex-direction:column}}.preview-actions button{{width:100%;min-width:0}}}}
    html{{background:#080b08}}html:not(.ui-ready) body{{visibility:hidden}}</style><script src='/session-guard.js?v=20261005-2'></script><script>window.__telasP=fetch('/api/alertas-telas',{{cache:'no-store',credentials:'same-origin'}}).then(function(r){{return r.ok?r.json():null}}).catch(function(){{return null}})</script><script src='/alertas-telas.js?v=20261005-6'></script><script>try{{if(localStorage.getItem('indoor-theme')==='light')document.documentElement.classList.add('theme-light')}}catch(e){{}}setTimeout(function(){{document.documentElement.classList.add('ui-ready')}},3500)</script></head><body class='inicio-mode'><div class='topbar'></div><button id='menu-toggle' class='menu-toggle' type='button' aria-label='Ocultar menú' aria-expanded='true'>‹</button><aside class='sidebar' aria-label='Menú principal'><div class='sidebar-brand'><img src='/marca-indoor.svg' alt='Indoor'></div><div class='session-card'><div class='session-avatar'>IS</div><div class='session-copy'><strong>INDOOR SPORT SAS</strong><span>Panel operativo</span></div></div><div class='sidebar-label'>Menú principal</div><nav class='tabs' aria-label='Navegación principal'><button class='tab home-nav active' data-kind='inicio' type='button'><span class='nav-icon'>IN</span><strong>INICIO</strong></button><div class='nav-group collapsed'><button id='news-toggle' class='nav-parent' type='button'><span class='nav-icon'>NV</span><span>NOVEDADES</span></button><div class='nav-children'><button class='tab schedule-nav' data-kind='cronograma' type='button'><span class='nav-icon'>CR</span><strong>CRONOGRAMA</strong></button><button class='tab' data-kind='operarios' type='button'><span class='nav-icon'>OP</span><strong>CONTROL OPERARIOS</strong></button></div></div><div class='nav-group'><button id='commercial-toggle' class='nav-parent' type='button'><span class='nav-icon'>AC</span><span>Asistentes Comerciales</span></button><div class='nav-children'><button class='tab' data-kind='reprogramacion' type='button'><span class='nav-icon'>RP</span><strong>REPROGRAMACIONES</strong></button><button class='tab' data-kind='pedido' type='button'><span class='nav-icon'>PN</span><strong>PROGRAMAR</strong></button><button class='tab' data-kind='creador' type='button'><span class='nav-icon'>XL</span><strong>EXCEL</strong></button><button class='tab' data-kind='cartera' type='button'><span class='nav-icon'>CT</span><strong>CARTERA</strong></button></div></div><div class='nav-group collapsed'><button id='production-toggle' class='nav-parent' type='button'><span class='nav-icon'>PR</span><span>Producción</span></button><div class='nav-children'><button class='tab production-nav' data-kind='produccion' type='button'><span class='nav-icon'>TR</span><strong>TRAZABILIDAD</strong></button><button class='tab' data-kind='inventario' type='button'><span class='nav-icon'>IT</span><strong>INVENTARIOS</strong></button></div></div></nav><div class='sidebar-foot'>Indoor Sport · Operación interna</div></aside><main>
    <section class='panel' data-panel='inventario'><div class='inventory-shell'><section class='inventory-hero'><div><span class='eyebrow'>Producción · Existencias</span><h2>INVENTARIOS</h2><p>Catálogo local de telas, insumos y materia prima, disponible de inmediato.</p></div><button id='inventory-refresh' class='inventory-refresh' type='button'>↻ Actualizar</button></section><section id='inventory-categories' class='inventory-category-grid' aria-label='Categorías de inventarios'></section><section class='card inventory-table-card'><div class='inventory-toolbar'><div><strong>Detalle de existencias</strong><div id='inventory-status' class='inventory-status'>Cargando inventario local…</div></div><input id='inventory-search' type='search' placeholder='Buscar referencia, tela o insumo' aria-label='Buscar inventario'></div><div class='inventory-cards-wrap'><div id='inventory-body' class='inventory-cards-grid'><div class='inventory-empty'>Cargando inventario local…</div></div></div></section></div></section>
    <div class='brand'><span class='brand-logo' aria-label='Indoor'><img src='/marca-indoor.svg' alt='Indoor'></span><span class='brand-line'></span><span class='eyebrow'>Panel operativo</span><div class='systems'><span class='session-user' aria-label='Usuario conectado'>{escape(user_display)}</span></div></div>
    <section class='panel active' data-panel='inicio'><div class='home-page'>
    <div class='home-hero'><img src='/landing/hero.jpg' alt='Uniforme Indoor Sport en la cancha'><div class='home-hero-copy'><span class='eyebrow'>Indoor Sport · Panel operativo</span><h2 id='home-greeting'>Hola</h2><p id='home-date'>Del diseño a la entrega: pedidos, producción y fechas en un solo lugar.</p></div></div>
    <div id='home-dashboard' aria-live='polite'></div>
    <div class='home-section'><h3>Nuestro proceso</h3><div class='home-gallery'><figure><img src='/landing/proceso-1.jpg' alt='Impresión de diseños' loading='lazy'><figcaption>Impresión de diseños</figcaption></figure><figure><img src='/landing/proceso-2.jpg' alt='Corte y armado' loading='lazy'><figcaption>Corte y armado</figcaption></figure><figure><img src='/landing/proceso-3.jpg' alt='Corte láser' loading='lazy'><figcaption>Corte láser</figcaption></figure><figure><img src='/landing/proceso-4.jpg' alt='Aplicación en plancha' loading='lazy'><figcaption>Aplicación en plancha</figcaption></figure><figure><img src='/landing/proceso-5.jpg' alt='Diseño digital' loading='lazy'><figcaption>Diseño digital</figcaption></figure><figure><img src='/landing/proceso-6.jpg' alt='Empaque final' loading='lazy'><figcaption>Empaque final</figcaption></figure></div></div>
    <div class='home-section'><h3>Nuestros uniformes</h3><div class='home-gallery'><figure><img src='/landing/uniforme-1.jpg' alt='Uniforme en cancha' loading='lazy'><figcaption>Uniforme en cancha</figcaption></figure><figure><img src='/landing/uniforme-2.jpg' alt='Uniforme premium' loading='lazy'><figcaption>Uniforme premium</figcaption></figure><figure><img src='/landing/uniforme-3.jpg' alt='Escudo texturizado' loading='lazy'><figcaption>Escudo texturizado</figcaption></figure><figure><img src='/landing/uniforme-4.jpg' alt='Numeración' loading='lazy'><figcaption>Numeración</figcaption></figure><figure><img src='/landing/uniforme-5.jpg' alt='Diseño bicolor' loading='lazy'><figcaption>Diseño bicolor</figcaption></figure><figure><img src='/landing/uniforme-6.jpg' alt='Uniforme sublimado' loading='lazy'><figcaption>Uniforme sublimado</figcaption></figure></div></div>
    </div></section>
    <section class='panel' data-panel='operarios'><div class='card operarios-shell'><div class='operarios-toolbar'><div class='operarios-title'><span class='eyebrow'>Producción · En vivo · Reparto por área</span></div><button id='operarios-refresh' type='button' class='production-refresh'>Actualizar</button><button id='operarios-report' type='button' class='production-refresh' title='Descarga un Excel con lo que hizo cada operario en el periodo y el filtro que tienes'>Descargar informe</button></div><div class='operarios-hover-wrap'><div id='operarios-hover' class='operarios-hover-btn' aria-live='polite'><div class='operarios-hover-nav'><button id='operarios-hover-prev' type='button' aria-label='Área anterior'>‹</button><span class='operarios-hover-title'>Cargando áreas…</span><button id='operarios-hover-next' type='button' aria-label='Área siguiente'>›</button></div><div class='operarios-hover-detail'>Verás aquí quién está trabajando y cuántos cerró hoy.</div></div><div id='operarios-goal' class='operarios-goal'><div class='operarios-goal-head'><span id='operarios-goal-label'>Unidades del mes</span><strong id='operarios-goal-count'>—</strong></div><div class='operarios-goal-bar'><i id='operarios-goal-fill' style='width:0%'></i></div><span id='operarios-goal-pct' class='operarios-goal-pct'>Cargando…</span></div><div id='operarios-day-filter-slot' class='operarios-day-filter-slot'></div></div><div class='operarios-kpis'><div class='operarios-kpi'><span>Operarios</span><strong id='operarios-total'>—</strong></div><div class='operarios-kpi'><span>Trabajando</span><strong id='operarios-busy'>—</strong></div><div class='operarios-kpi'><span>Libres</span><strong id='operarios-idle'>—</strong></div><div class='operarios-kpi'><span>Cerrados hoy</span><strong id='operarios-done'>—</strong></div><div id='operarios-status' class='operarios-status' role='status'>Cargando operarios…</div></div><div id='operarios-area-stats' class='operarios-area-stats' hidden></div><div id='operarios-grid' class='operarios-grid' hidden></div><div id='operarios-hover-calendar' class='operarios-hover-calendar'></div></div></section>
<dialog id='operarios-dialog' class='operarios-dialog' aria-labelledby='operarios-dialog-title'><div class='operarios-dialog-head'><div><span class='eyebrow'>Producción · Calendario</span><h2 id='operarios-dialog-title'>Proceso</h2><p id='operarios-dialog-sub'>Procesos cerrados por operario y día</p></div><div class='operarios-dialog-actions'><button id='operarios-dialog-prev' type='button' aria-label='Mes anterior'>‹</button><strong id='operarios-dialog-month'>—</strong><button id='operarios-dialog-next' type='button' aria-label='Mes siguiente'>›</button><button id='operarios-dialog-close' type='button' class='operarios-dialog-x' aria-label='Cerrar'>×</button></div></div><div class='operarios-dialog-kpis' id='operarios-dialog-kpis'></div><div class='operarios-dialog-body' id='operarios-dialog-body'></div></dialog>
    <section class='panel' data-panel='cronograma'><div class='card schedule-shell'><div class='schedule-toolbar'><div class='schedule-title'><span class='eyebrow'>Planeación de entregas</span><h2>CRONOGRAMA</h2><p>Fechas de entrega de todos los pedidos registrados en Producción.</p></div><div class='schedule-actions'><button id='schedule-prev' type='button' aria-label='Mes anterior'>‹</button><button id='schedule-today' type='button'>Hoy</button><button id='schedule-next' type='button' aria-label='Mes siguiente'>›</button></div></div><div class='schedule-days-block'><div class='schedule-days-nav'><h4 class='schedule-overview-title'>Entregas de la semana <small id='schedule-days-range'></small></h4><div class='schedule-days-actions'><button id='schedule-days-prev' type='button' aria-label='Semana anterior'>‹</button><button id='schedule-days-today' type='button'>Hoy</button><button id='schedule-days-next' type='button' aria-label='Semana siguiente'>›</button></div></div><div id='schedule-days' class='schedule-days' aria-label='Próximos días'></div></div><div class='schedule-summary'><strong id='schedule-month'>—</strong><span id='schedule-count'>Cargando pedidos…</span></div><div class='schedule-weekdays'><div>LUN</div><div>MAR</div><div>MIÉ</div><div>JUE</div><div>VIE</div><div>SÁB</div><div>DOM</div></div><div id='schedule-grid' class='schedule-grid'></div><div id='schedule-cards' class='schedule-cards' hidden></div></div></section>
    <section class='workspace panel' data-panel='reprogramacion'><div class='card'><div class='card-head'><h2>Nueva reprogramación</h2><p>Selecciona una cotización, remisión o listado en PDF o Excel.</p></div><div class='upload-wrap'>
    <form id='upload-form' method='post' action='/procesar' enctype='multipart/form-data'>
    <label class='dropzone' id='dropzone' for='archivo'><div><div class='upload-icon'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' aria-hidden='true'><path d='M12 16V4m0 0L7 9m5-5 5 5'/><path d='M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4'/></svg></div><strong>Arrastra el PDF o Excel aquí</strong><span>o haz clic para buscar · máximo 25 MB</span></div></label>
    <input required id='archivo' type='file' name='archivo' accept='application/pdf,.pdf,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'><div id='selected' class='selected'></div>
    <label class='file-row' style='margin-top:14px'><div><b>MOCKUP OBLIGATORIO</b><span id='repro-extras-label'>Adjunta la imagen que aparecerá en la tarjeta</span></div><input id='repro-extras' type='file' name='extras' accept='image/*,.ai,.eps,.svg' multiple required></label>
    <div class='actions'><button id='submit' type='submit' disabled>Procesar documento</button></div><div id='message' class='message' role='status' aria-live='polite'></div></form></div></div>
    <div class='card history'><div class='history-head'><div><h2>Orden actual</h2><p class='count'>Sin una orden seleccionada</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Archivo</th><th>Orden</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id='jobs'>{rows}</tbody></table></div></div></section>
    <section class='workspace panel' data-panel='pedido'><div class='card'><div class='card-head'><h2>Nuevo pedido normal</h2><p>Sube juntos el PDF y el Excel de la misma orden. Puedes añadir imágenes u otros anexos.</p></div><div class='upload-wrap'>
    <form id='order-form' method='post' action='/procesar/pedido' enctype='multipart/form-data'><div class='file-pair'>
    <label class='file-row'><div><b>Documento PDF</b><span id='pdf-label'>Seleccionar cotización o remisión</span></div><input required id='pedido-pdf' type='file' name='pdf' accept='application/pdf,.pdf'></label>
    <label class='file-row'><div><b>Listado Excel</b><span id='excel-label'>Seleccionar archivo .xlsx o .xlsm</span></div><input required id='pedido-excel' type='file' name='excel' accept='.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'></label>
    <label class='file-row'><div><b>MOCKUP OBLIGATORIO Y ANEXOS</b><span id='extras-label'>Adjunta la imagen que aparecerá en la tarjeta</span></div><input id='pedido-extras' type='file' name='extras' multiple required></label></div>
    <div class='field full' style='margin:14px 0'><label for='order-line'>Línea de producto (columna B del Sheet · opcional)</label><input id='order-line' class='sheet-name-input' type='text' name='linea' list='order-lines' maxlength='40' autocomplete='off' placeholder='Ej. BOT, PLUS, OLIMPICA, COPA' style='text-transform:uppercase'><datalist id='order-lines'></datalist></div>
    <div class='actions'><button id='order-submit' type='submit' disabled>Procesar pedido</button></div><div id='order-message' class='message' role='status' aria-live='polite'></div></form></div></div>
    <div class='card history'><div class='history-head'><div><h2>Pedido actual</h2><p class='count'>Sin un pedido seleccionado</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Archivos</th><th>Orden</th><th>Estado</th><th>Detalle</th></tr></thead><tbody id='order-jobs'></tbody></table></div></div></section>
    <section class='workspace panel' data-panel='creador'><form class='creator-form' id='creator-form' method='post' action='/crear-xlsx' enctype='multipart/form-data'><div class='creator-workbook-name'><label for='creator-name'>Nombre del archivo Excel</label><input id='creator-name' type='text' name='nombre_archivo' maxlength='120' placeholder='Ej. LISTADO ASCUN 2026' required></div><div class='creator-cards'><div class='card creator-main-card'><div class='card-head'><h2>CREADOR XLSX</h2><p>Sube la foto de datos y el mockup principal de esta pestaña.</p></div><div class='upload-wrap'>
    <div class='field full' style='margin-bottom:14px'><label for='first-sheet-name'>Nombre de la pestaña</label><input id='first-sheet-name' class='sheet-name-input' type='text' name='nombre_hoja' maxlength='31' placeholder='Ej. UNIFORME NEGRO'></div><div class='file-pair'>
    <label class='file-row' style='border-color:rgba(208,244,76,.5);background:rgba(208,244,76,.07)'><div><b>Archivo con los datos del listado</b><span id='datos-label'>Excel, Word, PDF, CSV, TXT, JPG o PNG</span></div><input id='datos-listado' type='file' name='datos' accept='.xlsx,.xls,.xlsm,.doc,.docx,.pdf,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff' required></label>
    <label class='file-row'><div><b>D1 · Mockup principal (opcional)</b><span id='d1-label'>JPG o PNG · se insertará en la celda S3</span></div><input id='d1' type='file' name='d1' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label>
    <div class='mockup-slot' data-design='2' hidden><label class='file-row'><div><b>D2 · Segundo diseño (opcional)</b><span id='d2-label'>JPG o PNG · se insertará en la celda Y3</span></div><input id='d2' type='file' name='d2' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D2' title='Quitar mockup'>×</button></div>
    <div class='mockup-slot' data-design='3' hidden><label class='file-row'><div><b>D3 · Tercer diseño (opcional)</b><span id='d3-label'>JPG o PNG · se insertará en la celda AE3</span></div><input id='d3' type='file' name='d3' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D3' title='Quitar mockup'>×</button></div>
    <div class='mockup-slot' data-design='4' hidden><label class='file-row'><div><b>D4 · Cuarto diseño (opcional)</b><span id='d4-label'>JPG o PNG · se insertará en la celda AK3</span></div><input id='d4' type='file' name='d4' accept='.jpg,.jpeg,.png,image/jpeg,image/png'></label><button class='remove-mockup' type='button' aria-label='Quitar mockup D4' title='Quitar mockup'>×</button></div>
    <button class='add-mockup' id='add-mockup' type='button'>＋ Agregar otro mockup</button></div></div></div>
    <div id='extra-sheets'></div><button class='add-sheet' id='add-excel-sheet' type='button'>＋ Agregar pestaña de Excel</button></div>
    <div class='creator-actions'><div class='actions'><button id='creator-submit' type='submit'>Crear listado XLSX</button></div><div id='creator-message' class='message' role='status' aria-live='polite'></div></div></form>
    <div class='card history creator-history' aria-hidden='true'><div class='history-head'><div><h2>Listado actual</h2><p class='count'>Sin un listado seleccionado</p></div><button class='refresh' type='button'>Actualizar</button></div>
    <div class='table-wrap'><table><thead><tr><th>ID</th><th>Referencia</th><th>Orden</th><th>Estado</th><th>Resultado</th></tr></thead><tbody id='creator-jobs'></tbody></table></div></div></section>
    <section class='panel' data-panel='produccion'><div class='card production-shell'><div class='production-toolbar'><div class='production-title'><h2>Producción</h2><p>Órdenes de producción desde la fila 726 · doble clic para editar</p></div><div class='production-controls'><input id='production-search' class='production-search' type='search' placeholder='Buscar cliente, orden, referencia o responsable'><a class='production-connector' href='/descargar-conector-nas' title='Instalar una sola vez por equipo, como Administrador. Queda disponible para todos los usuarios de Windows de ese PC.'>Instalar conexión NAS</a><select id='production-zoom' class='production-zoom' aria-label='Tamaño de la tabla'><option value='0.5'>50%</option><option value='0.6'>60%</option><option value='0.75'>75%</option><option value='0.9'>90%</option><option value='1' selected>100%</option><option value='1.25'>125%</option><option value='1.5'>150%</option></select><button id='production-refresh' class='production-refresh' type='button'>Actualizar</button></div></div><div class='production-kpis'><div class='production-kpi'><span>Registros visibles</span><strong id='production-records'>—</strong></div><div class='production-kpi'><span>Unidades</span><strong id='production-units'>—</strong></div><div id='production-status' class='production-status'>Abre esta pestaña para consultar la información.</div></div><div id='production-x-scroll' class='production-x-scroll' aria-label='Desplazamiento horizontal de procesos'><div id='production-x-scroll-inner'></div></div><div class='production-table-wrap' id='production-table-wrap'><table class='production-table' id='production-table'><thead id='production-head'></thead><tbody id='production-body'></tbody></table><div id='production-empty' class='production-empty' hidden>No hay registros para mostrar.</div></div></div></section>
    <div id='preview-modal' class='preview-modal' role='dialog' aria-modal='true' aria-labelledby='preview-title'><div class='preview-dialog'><div class='preview-head'><div><h2 id='preview-title'>Revisar datos antes de crear</h2><p>Corrige cualquier valor. El Excel se generará exactamente con estas filas.</p></div><div class='preview-overview'><div id='preview-designs' class='preview-designs'></div><div id='preview-size-summary' class='preview-size-summary' aria-live='polite'></div></div><button id='preview-close' class='preview-close' type='button'>Cerrar</button></div><div id='preview-content' class='preview-content'></div><div class='preview-actions'><button id='preview-confirm' type='button'>Confirmar y crear XLSX</button><button id='preview-cancel' class='preview-cancel' type='button'>Volver a los archivos</button></div></div></div>
    <section class='panel cartera-panel' data-panel='cartera'>
      <div id='cartera-app' class='inventory-shell ct-shell'><p class='ct-empty'>Cargando control de cartera…</p></div>
    </section>
    <p class='footer-note'>Los documentos se procesan de forma segura en el servidor de Indoor.</p></main><script>
    const deleteProductionAllowed={json.dumps(can_delete_production_profile(user_process))};
    const form=document.getElementById('upload-form'),input=document.getElementById('archivo'),drop=document.getElementById('dropzone'),selected=document.getElementById('selected'),submit=document.getElementById('submit'),message=document.getElementById('message'),reproExtras=document.getElementById('repro-extras');
    const tbody=document.getElementById('jobs'),orderBody=document.getElementById('order-jobs'),creatorBody=document.getElementById('creator-jobs'); let allJobs=[],hydratedCreatorJob=0;
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}}[c]));
    function choose(file){{if(!file)return;const ext=file.name.toLowerCase().split('.').pop();if(!['pdf','xlsx','xlsm'].includes(ext)){{show('Selecciona un archivo PDF, XLSX o XLSM válido.','error');input.value='';drop.classList.remove('has-file');submit.disabled=true;return}} if(file.size>25*1024*1024){{show('El archivo supera el límite de 25 MB.','error');input.value='';drop.classList.remove('has-file');submit.disabled=true;return}} selected.textContent=file.name+' · '+(file.size/1024/1024).toFixed(1)+' MB';selected.classList.add('show');drop.classList.add('has-file');submit.disabled=false;message.className='message'}}
    function show(text,type){{message.textContent=text;message.className='message show '+type}}
    document.addEventListener('change',event=>{{const field=event.target;if(!field.matches('input[type="file"]'))return;const row=field.closest('.file-row');if(row){{row.classList.toggle('has-file',field.files.length>0);const label=row.querySelector('span');if(label&&field.files.length)label.textContent=field.files.length===1?field.files[0].name:field.files.length+' archivos seleccionados'}}}});
    input.addEventListener('change',()=>{{choose(input.files[0]);if(input.files.length){{localStorage.removeItem(currentKeys.reprogramacion);resetProgressButton(submit,'Procesar documento')}}}}); ['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{{x.preventDefault();drop.classList.add('drag')}})); ['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{{x.preventDefault();drop.classList.remove('drag')}}));
    function accumulateAttachments(field){{try{{new DataTransfer()}}catch(e){{return}}
      let files=[];
      const row=field.closest('.file-row'),list=document.createElement('div'),hint=document.createElement('p');
      list.className='attachment-list';list.setAttribute('aria-label','Archivos seleccionados');
      hint.textContent='Anexos adicionales: puedes añadir archivos de distintas carpetas. Los mockups se cargan arriba, en D1–D4 (hasta 10 MB por imagen).';
      hint.style.cssText='font-size:12px;color:#aebcae;line-height:1.5;margin:8px 0';
      row.after(hint,list);
      function sync(){{
        const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));field.files=transfer.files;
        list.replaceChildren();row.classList.toggle('has-file',files.length>0);
        row.querySelector('span').textContent=files.length?files.length+' archivo(s) seleccionado(s) · Añadir más':'Seleccionar anexos opcionales';
        files.forEach((file,index)=>{{
          const item=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');
          item.style.cssText='display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #39443a';
          name.textContent=(index+1)+'. '+file.name+' · '+(file.size/1024/1024).toFixed(2)+' MB';name.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere;font-size:13px';
          remove.type='button';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar archivo '+(index+1)+': '+file.name);remove.style.cssText='width:auto;padding:8px 12px;margin:0;background:#263429;color:#e5eddf;box-shadow:none';
          remove.addEventListener('click',()=>{{files.splice(index,1);sync()}});item.append(name,remove);list.appendChild(item);
        }});
      }}
      field.addEventListener('change',()=>{{files.push(...field.files);sync()}});
      field.addEventListener('cancel',sync);
      field.form.addEventListener('reset',event=>queueMicrotask(()=>{{if(!event.defaultPrevented){{files=[];sync()}}}}));
      sync();
    }}
    [reproExtras,document.getElementById('pedido-extras')].forEach(accumulateAttachments);
    for (const [formId,fieldId,messageId] of [['upload-form','repro-extras','message'],['order-form','pedido-extras','order-message']]){{
      const targetForm=document.getElementById(formId),annex=document.getElementById(fieldId),annexRow=annex.closest('.file-row');
      annex.required=false;annexRow.querySelector('b').textContent='ANEXOS ADICIONALES (OPCIONAL)';
      const annexList=annexRow.nextElementSibling?.nextElementSibling,annexHint=annexRow.nextElementSibling;
      const optional=document.createElement('details'),optionalTitle=document.createElement('summary');
      optionalTitle.textContent='＋ Anexos adicionales (opcional)';optional.style.cssText='margin:8px 0;font-size:12px';
      annexRow.before(optional);optional.append(optionalTitle,annexRow);
      if(annexHint)optional.append(annexHint);if(annexList)optional.append(annexList);
      const designs=document.createElement('fieldset');designs.className='required-mockups';
      designs.style.cssText='border:1px solid #526344;border-radius:12px;padding:10px;margin:10px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px';
      designs.innerHTML='<legend style="font-size:12px">MOCKUPS · AL MENOS UNO OBLIGATORIO</legend>';
      for(let number=1;number<=4;number++){{
        const slot=document.createElement('label');slot.className='file-row';
        slot.innerHTML='<div><b>D'+number+'</b><span>Seleccionar imagen</span></div><input type="file" name="mockup_d'+number+'" accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff">';
        designs.appendChild(slot);
      }}
      optional.before(designs);
      targetForm.addEventListener('reset',()=>queueMicrotask(()=>{{
        designs.querySelectorAll('.file-row').forEach(row=>{{row.classList.remove('has-file');row.querySelector('span').textContent='Seleccionar imagen'}});
      }}));
      document.getElementById(formId).addEventListener('submit',event=>{{
        const files=[...designs.querySelectorAll('input')].flatMap(field=>[...field.files]);
        if(!files.some(file=>/\\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name))){{
          event.preventDefault();event.stopImmediatePropagation();
          const notice=document.getElementById(messageId);notice.className='message show error';
          notice.textContent='Adjunta un mockup JPG, PNG o WEBP. La orden no se programará sin imagen en su tarjeta.';
        }}
      }},true);
    }}
    drop.addEventListener('drop',e=>{{const file=e.dataTransfer.files[0];if(file){{try{{const dt=new DataTransfer();dt.items.add(file);input.files=dt.files}}catch(ex){{}}choose(file)}}}});
    const currentKeys={{reprogramacion:'indoor-current-reprogramacion',pedido:'indoor-current-pedido',creador:'indoor-current-creador'}};
    const currentId=kind=>Number(localStorage.getItem(currentKeys[kind])||0); const remember=(kind,id)=>localStorage.setItem(currentKeys[kind],String(id));
    function resetProgressButton(button,label){{button.classList.remove('is-progress');button.style.removeProperty('--creator-progress');button.textContent=label}}
    function updateFlowButton(group,button,idleLabel,messageTarget){{const job=group[0];if(!job)return;const p=progressOf(job);button.classList.add('is-progress');button.style.setProperty('--creator-progress',p+'%');if(job.status==='ERROR'||job.status==='REVISAR'){{button.disabled=false;button.textContent='Intentar nuevamente · '+p+'%';messageTarget.textContent=job.detail||'El proceso necesita revisión.';messageTarget.className='message show error';return}}button.disabled=true;button.textContent=(job.status==='COMPLETADO'?'Completado':(job.detail||'Procesando'))+' · '+p+'%'}}
    function stateClass(s){{return esc(String(s).toLowerCase())}} function progressOf(j){{if(['COMPLETADO','ERROR','REVISAR'].includes(j.status))return 100;return Math.max(5,Math.min(99,Number(j.progress)||5))}} function tableRows(data){{return data.length?data.map(j=>{{const p=progressOf(j);return `<tr><td class="id">#${{esc(j.id)}}</td><td><span class="file-name" title="${{esc(j.filename)}}">${{esc(j.filename)}}</span></td><td>${{esc(j.order_number||'Por identificar')}}</td><td><span class="state ${{stateClass(j.status)}}"><i></i>${{esc(j.status)}} · ${{p}}%</span><div class="progress-track"><div class="progress-fill" style="width:${{p}}%"></div></div></td><td class="detail">${{esc(j.detail||'Preparando proceso…')}}${{j.result_file?`<br><a class="download" href="/descargar/${{esc(j.id)}}">Descargar XLSX</a>`:''}}</td></tr>`}}).join(''):'<tr class="empty-row"><td colspan="5"><div class="empty-icon">↗</div><strong>Envía una orden para comenzar</strong><span>Aquí aparecerá únicamente el proceso actual.</span></td></tr>'}}
    function autoDownloadCreator(group){{const job=group[0];if(!job||job.status!=='COMPLETADO'||!job.result_file)return;const key='indoor-downloaded-creator',signature=job.id+':'+job.result_file,saved=localStorage.getItem(key)||'';if(saved===signature){{resetCreatorWorkspace();return}}localStorage.setItem(key,signature);creatorMessage.textContent='Listado completado. La descarga comenzó automáticamente.';creatorMessage.className='message show ok';const link=document.createElement('a');link.href='/descargar/'+job.id;link.download='';link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(resetCreatorWorkspace,1400)}}
    function updateCreatorButton(group){{const job=group[0];if(!job)return;const p=progressOf(job);if(job.status==='ERROR'){{creatorSubmit.disabled=false;creatorSubmit.classList.remove('is-progress');creatorSubmit.style.removeProperty('--creator-progress');creatorSubmit.textContent='Intentar nuevamente';creatorMessage.textContent=job.detail||'No se pudo crear el Excel.';creatorMessage.className='message show error';return}}creatorSubmit.classList.add('is-progress');creatorSubmit.style.setProperty('--creator-progress',p+'%');creatorSubmit.disabled=job.status!=='COMPLETADO';creatorSubmit.textContent=job.status==='COMPLETADO'?'Completado · 100%':(job.detail||'Creando el Excel')+' · '+p+'%'}}
    function render(data){{allJobs=data;const groups=['reprogramacion','pedido','creador'].map(kind=>{{const candidates=data.filter(j=>(kind==='reprogramacion'&&(j.kind==='reprogramacion'||!j.kind))||j.kind===kind),own=candidates.filter(j=>j.id===currentId(kind));if(own.length)return own;const active=candidates.filter(j=>j.status==='RECIBIDO'||j.status==='PROCESANDO').slice(0,1);if(active.length)remember(kind,active[0].id);return active}});tbody.innerHTML=tableRows(groups[0]);orderBody.innerHTML=tableRows(groups[1]);creatorBody.innerHTML=tableRows(groups[2]);document.querySelectorAll('.count').forEach((e,i)=>e.textContent=groups[i].length?'Seguimiento en tiempo real':'Sin una orden seleccionada');hydrateCreatorWorkspace(groups[2][0]);updateFlowButton(groups[0],submit,'Procesar documento',message);updateFlowButton(groups[1],orderSubmit,'Procesar pedido',orderMessage);updateCreatorButton(groups[2]);autoDownloadCreator(groups[2])}}
    async function refresh(){{try{{const r=await fetch('/api/procesos');if(r.ok)render(await r.json())}}catch(e){{}}}}
    const completedCleanup=new Set();function resetCompletedFlows(){{['reprogramacion','pedido'].forEach(kind=>{{const id=currentId(kind);if(!id||completedCleanup.has(kind+':'+id))return;const job=allJobs.find(item=>item.id===id);if(!job||job.status!=='COMPLETADO')return;completedCleanup.add(kind+':'+id);setTimeout(()=>{{if(currentId(kind)!==id)return;localStorage.removeItem(currentKeys[kind]);if(kind==='reprogramacion'){{form.reset();selected.textContent='';selected.classList.remove('show');drop.classList.remove('has-file','drag');form.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));document.getElementById('repro-extras-label').textContent='Opcional · selecciona una o varias imágenes';resetProgressButton(submit,'Procesar documento');submit.disabled=true;message.textContent='';message.className='message'}}else{{orderForm.reset();orderForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));checkOrder();resetProgressButton(orderSubmit,'Procesar pedido');orderSubmit.disabled=true;orderMessage.textContent='';orderMessage.className='message'}}refresh()}},2200)}})}}setInterval(resetCompletedFlows,500);
    document.querySelectorAll('.refresh').forEach(b=>b.addEventListener('click',refresh)); form.addEventListener('submit',async e=>{{e.preventDefault();submit.disabled=true;submit.classList.add('is-progress');submit.style.setProperty('--creator-progress','5%');submit.textContent='Enviando documento · 5%';show('Documento recibido. Iniciando el proceso…','ok');try{{const r=await fetch('/procesar',{{method:'POST',body:new FormData(form)}});const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo procesar');remember('reprogramacion',data.id);show('Orden enviada. El avance se actualizará en tiempo real.','ok');form.reset();selected.classList.remove('show');drop.classList.remove('has-file');form.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));await refresh()}}catch(err){{resetProgressButton(submit,'Procesar documento');submit.disabled=!input.files.length;show(err.message,'error')}}}});
    const productionZoomSelect=document.getElementById('production-zoom'),productionZoomInput=document.createElement('input');productionZoomInput.id='production-zoom';productionZoomInput.className='production-zoom';productionZoomInput.type='number';productionZoomInput.min='25';productionZoomInput.max='200';productionZoomInput.step='1';productionZoomInput.value=String(Math.round(Number(productionZoomSelect.value||1)*100));productionZoomInput.setAttribute('aria-label','Tamaño de la tabla en porcentaje');productionZoomInput.title='Escribe cualquier porcentaje entre 25 y 200';productionZoomSelect.replaceWith(productionZoomInput);
    const productionSearch=document.getElementById('production-search'),productionZoom=document.getElementById('production-zoom'),productionTable=document.getElementById('production-table'),productionHead=document.getElementById('production-head'),productionBody=document.getElementById('production-body'),productionStatus=document.getElementById('production-status'),productionEmpty=document.getElementById('production-empty'),productionRefresh=document.getElementById('production-refresh'),productionTableWrap=document.getElementById('production-table-wrap'),productionXScroll=document.getElementById('production-x-scroll'),productionXScrollInner=document.getElementById('production-x-scroll-inner');let productionData=null,productionTimer=null,productionScrollSync=false;
    function productionGroupSegments(groups){{const result=[];(groups||[]).forEach(name=>{{const label=String(name||'GENERAL').replace(/^["']|["']$/g,'').trim()||'GENERAL',last=result[result.length-1];if(last&&last.label===label)last.count+=1;else result.push({{label,count:1}})}});return result}}
    function productionCellClass(value,header){{const text=String(value||'').trim().toUpperCase(),title=String(header||'').trim().toUpperCase(),number=Number(text.replace(',','.').replace(/[^0-9.-]/g,''));if((title.includes('DÍAS ENTREGA FINAL')||title.includes('DIAS ENTREGA FINAL'))&&text&&Number.isFinite(number))return 'delivery-days-cell '+(number<=9?'semaphore-red':number<=14?'semaphore-orange':'semaphore-green');if(title.includes('FECHA')&&text)return 'semaphore-green';if(text==='P')return 'semaphore-orange';if(text==='R')return 'semaphore-red';if(title==='ESTADO'&&text&&Number.isFinite(number))return number<0?'semaphore-red':number===0?'semaphore-yellow':'semaphore-green';if(['SI','SÍ','OK','COMPLETADO','FINALIZADO'].includes(text))return 'semaphore-green';if(text==='NO'||text==='VENCIDO'||text==='ATRASADO')return 'semaphore-red';if((title.includes('RESP')||title==='LINEA'||title==='LÍNEA'||title==='TELA')&&text)return 'cell-chip';return ''}}
    const productionResponsibles=[['','Sin asignar'],['EJ','Ediht Johana Londoño'],['AP','Alejandro Padilla'],['AL','Andrés López'],['AU','Augusto López'],['CC','Carlos Cáceres'],['DB','Dagoberto Botero'],['EE','Edwin Espinosa'],['ES','Esteban Estrada'],['HL','Hesleidy Londoño'],['JP','Jeison Padilla'],['JO','Julian Ocampo'],['JD','Juliana Diaz'],['SV','Santiago Vásquez'],['SG','Sebastian Gallo'],['SS','Stiven Sánchez'],['DD','Dairo Diaz'],['YS','Yenifer Sánchez Arcila'],['G','Gloria'],['DH','David Hincapie'],['GP','Geovanny Piedrahita'],['BOT','Automatización'],['DG','Daniel Gonzales']];
    const productionLines=['','COPA','MUNDIAL','OLIMPICA','MUESTRA','PLUS','BOT'];
    function isResponsibleHeader(header){{const title=String(header||'').trim().toUpperCase();return title.startsWith('RESP')||['CONFECCIONISTA','COMERCIAL','VENDEDOR'].includes(title)}}
    function isLineHeader(header){{const title=String(header||'').trim().toUpperCase();return title==='LINEA'||title==='LÍNEA'}}
    const sewingResponsibles=['ALBA','ANGELA','BLANCA','BLANCA EMILSE','EUCARIS','FANNY','GLORIA','GLORIA LOPEZ','CARMEN','JUAN ESTEBAN','MIRYAM','NOELIA','NURY','OMAIRA','OMAIRA BERGARA','PATRICIA','SANDRA','OFELIA','YINI','LILIANA','YENNY','CANDELARIA','EJ','JO','DB'];
    const processResponsibles={{EDICION:['SG','AM','BOT','CO','JD','EE'],IMPRESION:['SG','SV','K'],SUBLIMACION:['G','CC','GP','JP'],'CORTE LASER':['CC','DD','ES','JP','K','HL','G','SV','SG'],APLIQUES:['HL'],CONFECCION:sewingResponsibles,TERMINACION:sewingResponsibles,EMPAQUE:['JO','JHO'],COMERCIAL:['AU','AL','YS','DH'],VENDEDOR:['AU','AL','YS','DH']}};
    function responsibleSelect(value,row,column){{const current=String(value||'').trim(),normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('"','').trim().toUpperCase(),group=normalize(productionData.groups[column-1]),header=normalize(productionData.headers[column-1]),key=group==='LINEA PRODUCCION INDOOR SPORT SAS'?'COMERCIAL':(['COMERCIAL','VENDEDOR'].includes(header)?header:group),allowed=processResponsibles[key],choices=allowed?[['','Sin asignar'],...allowed.map(code=>[code,code])]:productionResponsibles,known=choices.some(item=>item[0]===current),legacyOption=known?'':'<option disabled selected value="'+esc(current)+'">'+esc(current)+' · anterior</option>';return '<select class="production-resp-select production-responsible" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(current)+'" aria-label="Responsable de '+esc(key)+'">'+legacyOption+choices.map(item=>'<option value="'+esc(item[0])+'" title="'+esc(item[1])+'" '+(item[0]===current?'selected':'')+'>'+esc(item[0]||'—')+'</option>').join('')+'</select>'}}
    function lineSelect(value,row,column){{const current=String(value||'').trim().toUpperCase(),choices=productionLines.includes(current)?productionLines:[current,...productionLines],colorClass='line-'+(current?current.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-'):'empty');return '<select class="production-resp-select production-line-select '+colorClass+'" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(current)+'" aria-label="Línea">'+choices.map(item=>'<option value="'+esc(item)+'" '+(item===current?'selected':'')+'>'+esc(item||'—')+'</option>').join('')+'</select>'}}
    function productionRowButton(row,order,client,project){{const clean=String(order||'').trim();if(!clean)return '—';const record=productionData?.rows.find(item=>Number(item.source_row)===Number(row)),indexOf=name=>productionData?.headers.findIndex(header=>String(header||'').trim().toUpperCase()===name)??-1,clientIndex=indexOf('NOMBRE DEL CLIENTE');client=client||((record&&clientIndex>=0)?record.values[clientIndex]:'');
    // Enlace real (no JS), SIN target=_blank: al navegar en la misma pestaña, el navegador
    // entrega indoor-nas:/smb: al Explorador/Finder sin ni siquiera abandonar esta página
    // (solo la redirige si falla y cae en la página de error). Nada de pestañas nuevas.
    const url='/nas/abrir?order='+encodeURIComponent(clean)+'&client='+encodeURIComponent(client||'');
    return '<a class="production-row-open" href="'+esc(url)+'" data-order="'+esc(clean)+'" data-client="'+esc(client||'')+'" title="Abrir la carpeta de la orden '+esc(clean)+' en el Explorador de archivos / Finder">NAS <span>↗</span></a>'}}
    const nasNotice=document.createElement('div');nasNotice.hidden=true;nasNotice.setAttribute('role','status');nasNotice.setAttribute('aria-label','Estado de acceso al NAS');nasNotice.style.cssText='position:fixed;right:20px;bottom:20px;padding:14px 18px;background:#142017;color:#f2f7ed;border:1px solid #91ac36;border-radius:12px;box-shadow:0 12px 40px #0008;z-index:10000;font-size:14px;font-weight:700';
    document.body.appendChild(nasNotice);
    // Sin async/fetch antes de navegar: mostrar el aviso y saltar deben ocurrir en el mismo
    // clic (gesto) del usuario, o el navegador puede bloquear en silencio la entrega a
    // indoor-nas:/search-ms:/smb: por considerarlo un salto no solicitado.
    productionBody.addEventListener('click',event=>{{const link=event.target.closest('.production-row-open');if(!link)return;event.preventDefault();event.stopPropagation();nasNotice.textContent='Procesando '+(link.dataset.client||'la orden '+link.dataset.order)+'…';nasNotice.hidden=false;clearTimeout(nasNotice._hideTimer);nasNotice._hideTimer=setTimeout(()=>{{nasNotice.hidden=true}},3000);window.location.assign(link.href)}},true);
    function freezeProductionColumns(){{const columnsRow=productionHead.querySelector('.production-columns'),rowHead=productionHead.querySelector('.production-row-head');if(!columnsRow||!rowHead)return;const bodyRows=[...productionBody.querySelectorAll('tr')],headers=[...columnsRow.children],deliveryIndex=headers.findIndex(header=>{{const title=header.textContent.trim().toUpperCase();return title.includes('DÍAS ENTREGA FINAL')||title.includes('DIAS ENTREGA FINAL')}}),freezeCount=deliveryIndex>=0?deliveryIndex+1:Math.min(10,headers.length),zoom=(Number(productionZoom.value)||100)/100,layoutWidth=element=>element.getBoundingClientRect().width/zoom;rowHead.classList.add('production-frozen');rowHead.style.left='0px';bodyRows.forEach(row=>{{const cell=row.children[0];if(cell){{cell.classList.add('production-frozen');cell.style.left='0px'}}}});let left=layoutWidth(rowHead);for(let index=0;index<freezeCount;index++){{const edge=index===freezeCount-1,header=headers[index];header.classList.add('production-frozen');header.classList.toggle('production-frozen-edge',edge);header.style.left=left+'px';bodyRows.forEach(row=>{{const cell=row.children[index+1];if(!cell)return;cell.classList.add('production-frozen');cell.classList.toggle('production-frozen-edge',edge);cell.style.left=left+'px'}});left+=layoutWidth(header)}}}}
    function syncProductionWidth(){{productionXScrollInner.style.width=productionTable.scrollWidth+'px'}}
   const processStatusHeaders=new Set({json.dumps(sorted(PROCESS_STATUS_HEADERS))});
   function editionDropdowns(){{if(!productionData)return;const columns=new Set(productionData.headers.flatMap((header,index)=>processStatusHeaders.has(processKey(header))?[String(index+1)]:[]));productionBody.querySelectorAll('td[data-column]').forEach(cell=>{{if(!columns.has(cell.dataset.column)||cell.querySelector('select'))return;const original=String(productionData.rows.find(row=>String(row.source_row)===cell.dataset.row)?.values[Number(cell.dataset.column)-1]||'').trim(),select=document.createElement('select');select.className='production-resp-select edition-status';select.setAttribute('aria-label','Estado de '+productionData.headers[Number(cell.dataset.column)-1]);select.dataset.original=original;const state=original.toUpperCase(),tone=state==='P'?'#f5a623':state==='R'?'#c93636':state==='N/A'||scheduleParseDate(original)?'#31834a':null;if(tone){{select.style.setProperty('background',tone,'important');select.style.setProperty('color',state==='P'?'#241800':'#fff','important');select.style.setProperty('border','1px solid '+tone,'important');select.style.setProperty('font-weight','700','important')}}const options=[['','Vacío'],['P','P'],['R','R'],['__today','Fecha de hoy'],['N/A','N/A']];if(original&&!['P','R','N/A'].includes(original))options.unshift([original,displayProductionDate(original)]);options.forEach(([value,label])=>select.add(new Option(label,value,false,value===original)));cell.textContent='';cell.appendChild(select);if(original==='R'){{const history=document.createElement('button');history.type='button';history.className='rework-history';history.textContent=original==='R'?'R · Ver motivo':'Reprocesos';history.title='Consultar motivos, usuario y fecha';history.style.cssText='display:block;width:100%;padding:3px;margin-top:4px;background:#201916;color:#ffd2c5;border:1px solid #78564b;box-shadow:none;font:inherit;font-size:.85em';cell.appendChild(history);}}cell.title='Selecciona P, R, Fecha de hoy o N/A'}})}}const editionObserver=new MutationObserver(editionDropdowns);editionObserver.observe(productionBody,{{childList:true}});
    productionBody.addEventListener('click',async event=>{{const button=event.target.closest('.rework-history');if(!button)return;event.stopPropagation();const cell=button.closest('td');button.disabled=true;try{{const response=await fetch('/api/produccion/reprocesos/'+cell.dataset.row+'/'+cell.dataset.column),items=await response.json();if(!response.ok)throw new Error(items.detail||'No se pudo consultar');alert(items.length?items.map(item=>item.process+' · '+item.username+' · '+new Date(item.created_at).toLocaleString('es-CO',{{timeZone:'America/Bogota'}})+'\\n'+item.reason).join('\\n\\n'):'No hay motivos registrados para esta celda.')}}catch(error){{alert(error.message)}}finally{{button.disabled=false}}}});
   productionBody.addEventListener('change',async event=>{{const select=event.target.closest('.edition-status');if(!select)return;event.stopImmediatePropagation();const cell=select.closest('td'),original=select.dataset.original;let value=select.value;if(value==='__today')value=productionDateShortcut(new Date());select.disabled=true;cell.classList.add('is-editing');const ok=await saveProductionCell(cell,value,original);select.disabled=false;cell.classList.remove('is-editing');if(ok)renderProduction();else select.value=original}});
    const processFilterBar=document.createElement('div');processFilterBar.className='production-process-filter';processFilterBar.innerHTML='<label for="production-process">Proceso</label><select id="production-process" aria-label="Filtrar columnas por proceso"><option value="">Todos los procesos</option></select>';document.querySelector('.production-toolbar').insertAdjacentElement('afterend',processFilterBar);const productionProcess=document.getElementById('production-process');let selectedProcess=localStorage.getItem('indoor-production-process')||'';
    const deliverySortButton=document.createElement('button');deliverySortButton.type='button';deliverySortButton.className='production-refresh';deliverySortButton.textContent='Ordenar por fecha de entrega';deliverySortButton.title='Ordena todas las filas: fechas más próximas primero y sin fecha al final. Se guarda para todos.';processFilterBar.appendChild(deliverySortButton);deliverySortButton.addEventListener('click',async()=>{{if(!productionData||productionBody.querySelector('.is-editing'))return;if(!confirm('¿Ordenar todas las filas por fecha de entrega, de la más antigua a la más lejana? Las filas sin fecha irán al final. El orden se guardará para todos los usuarios.'))return;deliverySortButton.disabled=true;deliverySortButton.textContent='Ordenando…';try{{const response=await fetch('/api/produccion/ordenar-entrega',{{method:'POST'}}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo ordenar');await loadProduction();productionTableWrap.scrollTop=0;productionStatus.textContent='✓ Filas ordenadas por fecha de entrega para todos los usuarios'}}catch(error){{productionStatus.textContent=error.message}}finally{{deliverySortButton.disabled=false;deliverySortButton.textContent='Ordenar por fecha de entrega'}}}});
    const productionTools=document.createElement('details');productionTools.className='production-tools-menu';productionTools.innerHTML='<summary>Herramientas</summary><div class="production-tools-popover"></div>';document.querySelector('.production-controls').appendChild(productionTools);productionTools.querySelector('div').appendChild(document.querySelector('.production-connector'));const zoomGroup=document.createElement('label');zoomGroup.className='production-zoom-group';zoomGroup.append('Tamaño ');zoomGroup.appendChild(productionZoom);zoomGroup.append(' %');processFilterBar.appendChild(zoomGroup);document.querySelector('.production-title h2').textContent='Trazabilidad de producción';document.querySelector('.production-title p').textContent='Doble clic para editar · Clic derecho para notas';productionSearch.placeholder='Buscar cliente, orden o referencia';deliverySortButton.textContent='Ordenar entregas';document.addEventListener('click',event=>{{if(!productionTools.contains(event.target))productionTools.open=false}});
    /* Vincular Google Sheets: cuando se activa, las filas nuevas que se agreguen en la hoja
       (o los cambios que se hagan ahi) se importan solas a Producción cada 30 segundos. */
    const sheetsSyncBox=document.createElement('div');sheetsSyncBox.className='sheets-sync-box';sheetsSyncBox.innerHTML='<strong>Google Sheets · Sincronización automática</strong><p id="sheets-sync-status">Consultando estado…</p><button type="button" id="sheets-sync-toggle" class="production-refresh">Consultando…</button>';productionTools.querySelector('div').appendChild(sheetsSyncBox);
    /* Indicador compacto de sync en la barra de produccion (siempre visible) */
    const syncPill=document.createElement('span');syncPill.id='sheets-sync-pill';syncPill.className='sheets-sync-pill';syncPill.title='Vinculado a Google Sheets';syncPill.innerHTML='<i class="sheets-sync-dot"></i><span id="sheets-sync-pill-text">Sheets…</span>';document.querySelector('.production-kpis').appendChild(syncPill);
    async function refreshSheetsSyncStatus(){{try{{const response=await fetch('/api/produccion/sheets-sync/estado'),data=await response.json();if(!response.ok)throw Error();const statusEl=document.getElementById('sheets-sync-status'),toggleEl=document.getElementById('sheets-sync-toggle'),pill=document.getElementById('sheets-sync-pill'),pillText=document.getElementById('sheets-sync-pill-text');const lastCheck=data.checked_at?new Date(data.checked_at).toLocaleTimeString('es-CO',{{timeZone:'America/Bogota'}}):'';if(data.enabled){{statusEl.textContent='Sincronización activa · los cambios de Google Sheets se reflejan aquí cada 30s.'+(lastCheck?' Última revisión: '+lastCheck:'')+(data.error?' · Error: '+data.error:'');toggleEl.textContent='Pausar sync';toggleEl.dataset.action='desactivar';pill.classList.toggle('pill-error',!!data.error);pill.classList.remove('pill-off');pillText.textContent=lastCheck?'Sheets · '+lastCheck:'Sheets activo'}}else{{statusEl.textContent='Sincronización pausada · los cambios en Google Sheets NO se reflejan en la página. El servidor la reactiva sola al reiniciar.';toggleEl.textContent='Reactivar sync';toggleEl.dataset.action='activar';pill.classList.add('pill-off');pill.classList.remove('pill-error');pillText.textContent='Sheets pausado'}}}}catch(error){{document.getElementById('sheets-sync-status').textContent='No se pudo consultar el estado.'}}}}
    document.getElementById('sheets-sync-toggle').addEventListener('click',async event=>{{const button=event.currentTarget,action=button.dataset.action;if(action==='desactivar'&&!confirm('¿Pausar la sincronización con Google Sheets? Los cambios que hagas allá no se reflejarán aquí hasta reactivarla. El servidor la activa sola al reiniciar.'))return;if(action==='activar'&&!confirm('¿Reactivar la sincronización con Google Sheets?'))return;button.disabled=true;button.textContent='Un momento…';try{{const response=await fetch('/api/produccion/sheets-sync/'+action,{{method:'POST'}});if(!response.ok)throw Error();await refreshSheetsSyncStatus()}}catch(error){{document.getElementById('sheets-sync-status').textContent='No se pudo actualizar. Intenta de nuevo.'}}finally{{button.disabled=false}}}});
    refreshSheetsSyncStatus();setInterval(refreshSheetsSyncStatus,60000);
    /* Copia de seguridad: cada 6 horas se sube una foto de la base de datos a Supabase,
       por si el servidor falla. El botón permite forzar una copia y ver cuándo fue la última. */
    const backupBox=document.createElement('div');backupBox.className='sheets-sync-box';backupBox.innerHTML='<strong>Copia de seguridad</strong><p id="backup-status">Consultando estado…</p><button type="button" id="backup-now" class="production-refresh">Respaldar ahora</button>';productionTools.querySelector('div').appendChild(backupBox);
    async function refreshBackupStatus(){{try{{const response=await fetch('/api/produccion/backup/estado'),data=await response.json();if(!response.ok)throw Error();const statusEl=document.getElementById('backup-status');statusEl.textContent=(data.last_ok_at?'Última copia: '+new Date(data.last_ok_at).toLocaleString('es-CO',{{timeZone:'America/Bogota'}}):'Todavía no se ha hecho ninguna copia.')+(data.last_error?' · Aviso: '+data.last_error:'')}}catch(error){{document.getElementById('backup-status').textContent='No se pudo consultar el estado.'}}}}
    document.getElementById('backup-now').addEventListener('click',async event=>{{const button=event.currentTarget;button.disabled=true;button.textContent='Respaldando…';try{{const response=await fetch('/api/produccion/backup/ahora',{{method:'POST'}}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo respaldar');await refreshBackupStatus()}}catch(error){{document.getElementById('backup-status').textContent=error.message}}finally{{button.disabled=false;button.textContent='Respaldar ahora'}}}});
    refreshBackupStatus();
    const cleanProductionStyle=document.createElement('style');cleanProductionStyle.textContent=`
body.production-mode{{--line:rgba(180,195,167,.16)}}
body.production-mode .production-shell{{border-color:#344032;box-shadow:none}}
body.production-mode .production-toolbar{{gap:20px;padding:16px 20px;background:#111610;flex-wrap:wrap;overflow:visible}}
body.production-mode .production-title h2{{font-size:18px;font-weight:650}}
body.production-mode .production-title p{{font-size:12px;font-weight:400;color:#a6b09f;margin-top:4px}}
body.production-mode .production-controls{{min-width:0;flex:1;max-width:680px;flex-wrap:wrap}}
body.production-mode .production-search{{min-width:170px;height:38px;background:#1b221a;border-color:#3b4635;font-weight:400}}
body.production-mode .production-refresh,body.production-mode .production-tools-menu summary{{font-size:12px;font-weight:550;min-height:36px;padding:8px 12px;border-radius:7px;border:1px solid #46543b;background:#202a1c;color:#e6eddf;box-shadow:none;cursor:pointer;list-style:none}}
body.production-mode .production-process-filter{{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 20px;background:#111610;border-bottom:1px solid #30392b}}
body.production-mode .production-process-filter>label{{font-size:12px;color:#abb69f;font-weight:500}}
body.production-mode #production-process{{font-size:12px;font-weight:500;min-height:36px;background:#20271c;border-color:#47543b;max-width:230px}}
body.production-mode .production-zoom-group{{display:flex;gap:7px;align-items:center;margin-left:auto}}
body.production-mode .production-zoom{{width:66px;flex-basis:66px;font-size:12px;min-height:34px;background:#1a2117;border-color:#47543b;font-weight:500}}
body.production-mode .production-kpis{{padding:8px 20px;gap:22px;background:#10160e}}
body.production-mode .production-kpi span{{font-size:10px;font-weight:500;letter-spacing:.03em}}
body.production-mode .production-kpi strong{{font-size:13px;font-weight:650}}
body.production-mode .production-status{{font-size:11px;font-weight:400;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
body.production-mode .production-table{{font-family:Arial,sans-serif}}
body.production-mode .production-table td{{font-size:.98rem}}
body.production-mode .production-table .production-columns th{{font-size:1.15rem;padding:14px 12px;height:68px;overflow-wrap:break-word}}
body.production-mode .production-table .production-groups th{{font-size:1rem;padding:12px;height:44px}}
body.production-mode .production-table td.delivery-days-cell{{font-size:.94rem!important}}
body.production-mode .production-table td{{font-weight:400!important;line-height:1.45;padding:10px 9px;border-right-color:rgba(180,195,167,.065);border-top-color:rgba(180,195,167,.12);text-shadow:none!important}}
body.production-mode .production-table th{{font-weight:600!important;letter-spacing:.015em;line-height:1.35;border-right-color:#3a4333;border-bottom-color:#505f3e}}
body.production-mode .production-table .production-groups th{{background:#26301f!important;color:#b8c9a0;font-weight:500!important}}
body.production-mode .production-table .production-columns th{{background:#182014!important;color:#e3ead9}}
body.production-mode .production-resp-select,body.production-mode .production-machine-picker{{border-color:transparent!important;background:transparent!important;box-shadow:none!important;border-radius:5px!important;color:#e2ebd6!important;font-weight:500!important}}
body.production-mode .production-resp-select:hover,body.production-mode .production-resp-select:focus,body.production-mode .production-machine-picker:hover{{border-color:#637650!important;background:#25341f!important}}
body.production-mode .production-line-select{{background:#253c45!important;color:#cae9f4!important}}
body.production-mode .production-table .production-responsible{{background:#9ac9ee!important;color:#15334b!important;border:1px solid #b8ddf7!important;font-weight:700!important}}
body.production-mode .production-table .production-responsible:hover,body.production-mode .production-table .production-responsible:focus{{background:#b5dcf6!important;color:#15334b!important;border-color:#d8edfc!important}}
body.production-mode .production-table td:not(.delivery-days-cell)::before{{display:none!important}}
body.production-mode .production-table td.delivery-days-cell{{font-weight:700!important;box-shadow:none!important}}
body.production-mode .production-frozen-edge{{box-shadow:2px 0 0 #52613b!important}}
body.production-mode .production-row-tools{{gap:6px}}
body.production-mode .production-row-open{{background:#26311c!important;border-color:#58673f!important;color:#d1e2b2!important;box-shadow:none!important;font-weight:600}}
body.production-mode .production-drag-handle{{box-shadow:none;border-color:#4f5d3e;background:#1b2516;color:#9cab86}}
body.production-mode .production-delete-row{{box-shadow:none!important;background:transparent!important;border-color:#67483d!important;color:#d8a293!important}}
body.production-mode .production-tools-menu{{position:relative}}
body.production-mode .production-tools-popover{{position:absolute;right:0;top:42px;z-index:120;background:#1c2517;padding:10px;border:1px solid #596745;border-radius:9px;box-shadow:0 10px 25px #0008;min-width:185px}}
.sheets-sync-box{{margin-top:10px;padding-top:10px;border-top:1px solid #3a4530;display:grid;gap:6px}}
.sheets-sync-box strong{{font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:#c7d1b8}}
.sheets-sync-box p{{margin:0;font-size:.72rem;line-height:1.4;color:#a9b599}}
.sheets-sync-box button{{width:100%}}
.sheets-sync-pill{{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:3px 9px;border-radius:999px;background:rgba(208,244,76,.1);border:1px solid rgba(208,244,76,.28);font-size:.66rem;font-weight:700;color:#c8e87a;white-space:nowrap;cursor:default;transition:.2s}}
.sheets-sync-pill.pill-off{{background:rgba(255,200,80,.08);border-color:rgba(255,200,80,.3);color:#f0d070}}
.sheets-sync-pill.pill-error{{background:rgba(255,80,80,.09);border-color:rgba(255,80,80,.3);color:#ffa0a0}}
.sheets-sync-dot{{display:inline-block;width:6px;height:6px;border-radius:50%;background:#d0f44c;box-shadow:0 0 6px rgba(208,244,76,.7);animation:syncPulse 2.5s ease-in-out infinite}}
.sheets-sync-pill.pill-off .sheets-sync-dot{{background:#e0b840;box-shadow:0 0 6px rgba(224,184,64,.5);animation:none}}
.sheets-sync-pill.pill-error .sheets-sync-dot{{background:#ff7070;box-shadow:0 0 6px rgba(255,112,112,.5)}}
@keyframes syncPulse{{0%,100%{{opacity:1}}50%{{opacity:.45}}}}
.operarios-legend{{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 20px 4px;border-bottom:1px solid rgba(255,255,255,.06)}}
.operarios-legend .op-stat{{font-size:.7rem;font-weight:700;gap:5px}}
.operarios-legend-source{{margin-left:auto;font-size:.62rem;color:#6e7d65;font-weight:600;font-style:italic}}
body.production-mode .production-tools-popover a{{display:block;font-size:12px}}
@media(max-width:860px){{body.production-mode .production-toolbar{{padding:12px}}body.production-mode .production-controls{{max-width:none;width:100%}}body.production-mode .production-process-filter{{padding:10px 12px;gap:8px}}body.production-mode .production-status{{display:none}}body.production-mode .production-zoom-group{{margin-left:0}}}}
`;document.head.appendChild(cleanProductionStyle);
    const orderProgress=document.createElement('p');orderProgress.hidden=true;orderProgress.style.cssText='padding:12px 16px;margin:0;color:#d0f44c;background:#182014;font-weight:700';processFilterBar.insertAdjacentElement('afterend',orderProgress);
    let exactScheduleOrder='';productionSearch.addEventListener('input',()=>{{exactScheduleOrder='';orderProgress.hidden=true}});
    function processKey(value){{return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('"','').trim().toUpperCase()}}
    function fixedDeliveryIndex(){{return productionData.headers.findIndex(header=>processKey(header)==='DIAS ENTREGA FINAL')}}
    function processColumnVisible(column){{return !selectedProcess||column.sourceIndex<=fixedDeliveryIndex()||processKey(column.group)===selectedProcess}}
    function updateProcessFilter(){{const labels=new Map();productionData.groups.forEach((group,index)=>{{const key=processKey(group);if(index>fixedDeliveryIndex()&&key&&key!=='GENERAL'&&!key.includes('LINEA PRODUCCION')&&!key.includes('METODOLOG'))labels.set(key,String(group).replaceAll('"',''))}});if(selectedProcess&&!labels.has(selectedProcess))selectedProcess='';const signature=JSON.stringify([...labels]);if(productionProcess.dataset.signature!==signature){{productionProcess.replaceChildren(new Option('Todos los procesos',''));labels.forEach((label,key)=>productionProcess.add(new Option(label,key)));productionProcess.dataset.signature=signature}}productionProcess.value=selectedProcess}}
    productionProcess.addEventListener('change',()=>{{selectedProcess=productionProcess.value;localStorage.setItem('indoor-production-process',selectedProcess);productionTableWrap.scrollLeft=0;productionXScroll.scrollLeft=0;renderProduction()}});
    const printingMachines=['SHUREZ','EPSON','GRAPHTEC','GT','JET','M2','SNAKE','N/A','ROLAND','SNAKE CE','EPSON YEINSON','EPSON JESAM','M2 DIC 2025','SNAKE CE OLD NEGRO','SNAKE STS INKS','SNAKE CE OLD','IMPRES. UV','DTF','PLT','BORDADO'];
    function isMachineHeader(header){{return String(header||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()==='MAQUINA DE IMPRESION'}}
    function machineSelect(value,row,column){{const current=String(value||'').trim();return '<button type="button" class="production-machine-picker" style="width:100%;background:#182016;color:#e9f7d4;border:1px solid #647448;border-radius:8px;padding:5px;font:inherit;cursor:pointer" data-original="'+esc(current)+'" aria-label="Seleccionar máquinas de impresión">'+esc(current||'Seleccionar')+' ▾</button>'}}
    const machineDialog=document.createElement('dialog');machineDialog.style.cssText='width:min(440px,92vw);max-height:85vh;overflow:auto;background:#142017;color:#f4f8ed;border:1px solid #91ac36;border-radius:16px;padding:24px';machineDialog.innerHTML='<h3 style="margin-top:0">Máquinas de impresión</h3><p>Selecciona una o varias máquinas.</p><div class="machine-choices"></div><p class="machine-error" role="alert"></p><div style="display:flex;gap:10px;margin-top:20px"><button type="button" class="machine-cancel">Cancelar</button><button type="button" class="machine-save">Guardar selección</button></div>';document.body.appendChild(machineDialog);let machineCell=null,machineOriginal='';
    productionBody.addEventListener('click',event=>{{const picker=event.target.closest('.production-machine-picker');if(!picker)return;machineCell=picker.closest('td');machineOriginal=picker.dataset.original;const selected=machineOriginal.split(/\\s*[,;]\\s*/).filter(Boolean),choices=[...new Set([...printingMachines,...selected])];machineDialog.querySelector('.machine-choices').innerHTML=choices.map(name=>'<label style="display:flex;align-items:center;gap:12px;padding:9px 0"><input type="checkbox" style="width:18px;height:18px;flex:none" value="'+esc(name)+'" '+(selected.includes(name)?'checked':'')+'><span>'+esc(name)+'</span></label>').join('');machineDialog.querySelector('.machine-error').textContent='';machineDialog.showModal()}});
    machineDialog.querySelector('.machine-cancel').addEventListener('click',()=>machineDialog.close());
    machineDialog.querySelector('.machine-save').addEventListener('click',async()=>{{const button=machineDialog.querySelector('.machine-save'),value=[...machineDialog.querySelectorAll('input:checked')].map(input=>input.value).join(', ');button.disabled=true;machineDialog.querySelector('.machine-cancel').disabled=true;try{{const ok=await saveProductionCell(machineCell,value,machineOriginal);if(ok){{machineDialog.close();renderProduction()}}else machineDialog.querySelector('.machine-error').textContent='No se pudo guardar. Intenta nuevamente.'}}finally{{button.disabled=false;machineDialog.querySelector('.machine-cancel').disabled=false}}}});
    machineDialog.addEventListener('cancel',event=>{{if(machineDialog.querySelector('.machine-save').disabled)event.preventDefault()}});
    const noteDialog=document.createElement('dialog');noteDialog.style.cssText='width:min(460px,92vw);background:#142017;color:#fff;border:1px solid #91ac36;border-radius:14px;padding:24px';noteDialog.innerHTML='<h3>Nota de la celda</h3><label for="cell-note-text">Escribe tu nota (máximo 5000 caracteres)</label><textarea id="cell-note-text" maxlength="5000" rows="7" style="width:100%;margin:12px 0;background:#fdfdf4;color:#17221b;padding:12px;font:inherit"></textarea><p class="note-error" role="alert"></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="note-save">Guardar nota</button><button type="button" class="note-delete">Eliminar nota</button><button type="button" class="note-cancel">Cancelar</button></div>';document.body.appendChild(noteDialog);let noteTarget=null;
    function decorateNotes(){{productionBody.querySelectorAll('td[data-row][data-column]').forEach(cell=>{{const note=productionData.notes?.[cell.dataset.row+':'+cell.dataset.column];cell.tabIndex=0;if(note){{cell.style.setProperty('background-image','linear-gradient(#78a9d5,#78a9d5)','important');cell.style.setProperty('background-repeat','no-repeat','important');cell.style.setProperty('background-position','right top','important');cell.style.setProperty('background-size','4px 4px','important');cell.removeAttribute('title');cell.dataset.note=note}}else cell.title+=' · Clic derecho: agregar nota'}})}}
    const notePreview=document.createElement('aside');notePreview.hidden=true;notePreview.setAttribute('aria-label','Nota de la celda');notePreview.style.cssText='position:fixed;z-index:2000;width:min(230px,calc(100vw - 24px));min-height:96px;max-height:45vh;resize:both;overflow:auto;padding:10px;background:#fff;color:#444;border:1px solid #d0d0d0;border-radius:2px;box-shadow:0 2px 6px #0002;font:13px/1.45 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere';notePreview.innerHTML='<div class="note-preview-text"></div>';document.body.appendChild(notePreview);let notePreviewTimer;
    function hideNotePreview(){{clearTimeout(notePreviewTimer);notePreview.hidden=true}}
    function showNotePreview(cell){{const note=productionData.notes?.[cell.dataset.row+':'+cell.dataset.column];if(!note)return;clearTimeout(notePreviewTimer);notePreview.querySelector('.note-preview-text').textContent=note;notePreview.hidden=false;const bounds=cell.getBoundingClientRect(),width=notePreview.offsetWidth,height=notePreview.offsetHeight;notePreview.style.left=Math.max(12,Math.min(bounds.left,innerWidth-width-12))+'px';notePreview.style.top=Math.max(12,bounds.bottom+height+10<innerHeight?bounds.bottom+6:bounds.top-height-6)+'px'}}
    productionBody.addEventListener('pointerover',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(cell)showNotePreview(cell)}});productionBody.addEventListener('focusin',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(cell)showNotePreview(cell)}});productionBody.addEventListener('pointerout',()=>{{notePreviewTimer=setTimeout(hideNotePreview,250)}});notePreview.addEventListener('pointerenter',()=>clearTimeout(notePreviewTimer));notePreview.addEventListener('pointerleave',hideNotePreview);productionTableWrap.addEventListener('scroll',hideNotePreview,{{passive:true}});document.addEventListener('keydown',event=>{{if(event.key==='Escape')hideNotePreview()}});window.addEventListener('resize',hideNotePreview);
    function openNote(cell){{hideNotePreview();noteTarget={{row:Number(cell.dataset.row),column:Number(cell.dataset.column)}};noteDialog.querySelector('textarea').value=productionData.notes?.[noteTarget.row+':'+noteTarget.column]||'';noteDialog.querySelector('.note-error').textContent='';noteDialog.showModal();noteDialog.querySelector('textarea').focus()}}
    productionBody.addEventListener('contextmenu',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell)return;event.preventDefault();openNote(cell)}});
    productionBody.addEventListener('keydown',event=>{{if(event.key==='F10'&&event.shiftKey){{const cell=event.target.closest('td[data-row][data-column]');if(cell){{event.preventDefault();openNote(cell)}}}}}});
    noteDialog.querySelector('.note-cancel').addEventListener('click',()=>noteDialog.close());
    async function persistNote(note){{noteDialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{{const response=await fetch('/api/produccion/nota',{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{...noteTarget,note}})}}),data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo guardar la nota');productionData.notes=productionData.notes||{{}};productionData.notes[noteTarget.row+':'+noteTarget.column]=data.note;productionData.note_entries=productionData.note_entries||{{}};productionData.note_entries[noteTarget.row+':'+noteTarget.column]=[{{text:data.note,author:data.author||''}}];noteDialog.close();renderProduction()}}catch(error){{noteDialog.querySelector('.note-error').textContent=error.message}}finally{{noteDialog.querySelectorAll('button').forEach(b=>b.disabled=false)}}}}
    noteDialog.querySelector('.note-save').addEventListener('click',()=>persistNote(noteDialog.querySelector('textarea').value));noteDialog.querySelector('.note-delete').addEventListener('click',()=>{{if(confirm('¿Eliminar la nota de esta celda?'))persistNote('')}});noteDialog.addEventListener('cancel',event=>{{if(noteDialog.querySelector('.note-save').disabled)event.preventDefault()}});
    function fitProductionHeight(){{if(!document.body.classList.contains('production-mode'))return;const top=productionTableWrap.getBoundingClientRect().top,available=Math.max(240,window.innerHeight-Math.max(0,top)-10);productionTableWrap.style.height=available+'px';productionTableWrap.style.maxHeight=available+'px';productionTableWrap.style.minHeight='0'}}
    productionBody.addEventListener('click',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell||event.target.closest('button,a,input,select,textarea')||cell.classList.contains('delivery-days-cell'))return;hideNotePreview();const select=cell.querySelector('select'),picker=cell.querySelector('.production-machine-picker');if(select){{cell.focus();return}}if(picker){{picker.click();return}}cell.focus()}});
    function guardSelectBody(event){{const select=event.target.closest('select');if(!select||!productionBody.contains(select))return;const bounds=select.getBoundingClientRect(),arrowWidth=Math.min(24,Math.max(12,bounds.width*.22));if(event.clientX<bounds.right-arrowWidth){{event.preventDefault();event.stopImmediatePropagation();const cell=select.closest('td');cell.focus();showNotePreview(cell)}}else hideNotePreview()}}productionBody.addEventListener('pointerdown',guardSelectBody,true);productionBody.addEventListener('mousedown',guardSelectBody,true);productionBody.addEventListener('click',guardSelectBody,true);
    function moveProductionCell(cell,key){{const row=cell.closest('tr'),cells=[...row.querySelectorAll('td[data-column]')],index=cells.indexOf(cell);let next;if(key==='ArrowLeft'||key==='ArrowRight')next=cells[index+(key==='ArrowRight'?1:-1)];else{{const nextRow=key==='ArrowDown'?row.nextElementSibling:row.previousElementSibling;next=nextRow?.querySelector('td[data-column="'+cell.dataset.column+'"]')}}if(next){{next.focus();next.scrollIntoView({{block:'nearest',inline:'nearest'}})}}}}
    productionBody.addEventListener('keydown',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(!cell)return;if(event.target.tagName==='INPUT'&&event.target.classList.contains('production-cell-input')&&['ArrowUp','ArrowDown'].includes(event.key)){{event.preventDefault();event.target.blur();moveProductionCell(cell,event.key);return}}if(event.target.tagName!=='TD')return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){{event.preventDefault();moveProductionCell(cell,event.key);return}}if(['Enter','F2'].includes(event.key)){{event.preventDefault();if(cell.querySelector('select,button'))cell.click();else{{hideNotePreview();editProductionCell(cell)}}return}}if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||cell.querySelector('select,button')||cell.classList.contains('delivery-days-cell'))return;if(event.key.length===1||['Backspace','Delete'].includes(event.key)){{event.preventDefault();hideNotePreview();editProductionCell(cell);const input=cell.querySelector('input');if(input)input.value=event.key.length===1?event.key:''}}}});
    productionBody.addEventListener('paste',event=>{{const cell=event.target.closest('td[data-row][data-column]');if(event.target.tagName!=='TD'||!cell||cell.querySelector('select,button')||cell.classList.contains('delivery-days-cell'))return;const text=event.clipboardData?.getData('text/plain');if(text===undefined)return;event.preventDefault();hideNotePreview();editProductionCell(cell);const input=cell.querySelector('input');if(input)input.value=text}});
    const activeCellStyle=document.createElement('style');activeCellStyle.textContent='.production-table td[data-column]:focus{{outline:2px solid #8fb9e1;outline-offset:-2px}}';document.head.appendChild(activeCellStyle);
    const clickEditStyle=document.createElement('style');clickEditStyle.textContent='body.production-mode .production-table td.is-editing .production-cell-input{{min-height:36px;width:100%;font:inherit;color:inherit;background:transparent!important;border:0!important;border-radius:0;outline:0!important;box-shadow:none!important;caret-color:#f1f5ed;padding:0;text-align:center}}body.production-mode .production-table td.is-editing{{padding:10px 9px}}';document.head.appendChild(clickEditStyle);
    let productionHeightFrame=0;function scheduleProductionHeight(){{if(productionHeightFrame)return;productionHeightFrame=requestAnimationFrame(()=>{{productionHeightFrame=0;fitProductionHeight()}})}}window.addEventListener('resize',scheduleProductionHeight);window.addEventListener('scroll',scheduleProductionHeight,{{passive:true}});new MutationObserver(scheduleProductionHeight).observe(document.body,{{attributes:true,attributeFilter:['class']}});
    const productionSpaceStyle=document.createElement('style');productionSpaceStyle.textContent='body.production-mode .footer-note{{display:none}}body.production-mode main{{padding-bottom:0}}';document.head.appendChild(productionSpaceStyle);
    function isAppliqueHeader(header){{const title=String(header||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();return title.startsWith('APLIQUE')&&title.includes('TEXTURIZADO')}}
    function appliqueSelect(value,row,column){{const original=String(value||'').trim(),current=original.toUpperCase()==='SÍ'?'SI':original.toUpperCase(),choices=['','SI','NO'],legacy=current&&!choices.includes(current)?'<option disabled selected value="'+esc(original)+'">'+esc(original)+' · anterior</option>':'';return '<select class="production-resp-select production-applique-select" data-row="'+row+'" data-column="'+column+'" data-original="'+esc(original)+'" aria-label="¿Lleva apliques?">'+legacy+choices.map(item=>'<option value="'+item+'" '+(item===current?'selected':'')+'>'+(item||'—')+'</option>').join('')+'</select>'}}
    function orderIdentity(value,row){{if(!String(value||'').trim())return '';return '<strong class="order-identity" style="margin-bottom:0">'+esc(value)+'</strong>'}}
    const orderIdentityStyle=document.createElement('style');orderIdentityStyle.textContent='.order-identity{{display:block;color:#f1ffc5;font-size:1.18em;font-weight:750;letter-spacing:.02em;margin-bottom:5px}}.order-process{{display:block;border-radius:5px;padding:4px 6px;font-size:.88em;line-height:1.3;font-weight:600;white-space:normal;background:#283224;color:#c5d1b8}}.order-process.active{{background:#394925;color:#ecffb8;border-left:3px solid #d0f44c}}.order-process.finished{{background:#1d3432;color:#b2ddd6;border-left:3px solid #6bb5a7}}.order-process.pending{{color:#aab0a5}}';document.head.appendChild(orderIdentityStyle);
    const neutralTableStyle=document.createElement('style');neutralTableStyle.textContent=`
body.production-mode .production-table td:not(.delivery-days-cell){{background-color:#181b18!important;color:#dce1d9}}
body.production-mode .production-table th,body.production-mode .production-table .production-groups th,body.production-mode .production-table .production-columns th{{background:#292e29!important;color:#f4f6f2!important;border-color:#495047;font-weight:700!important;text-shadow:none;line-height:1.4}}
body.production-mode .production-table th.production-row-head{{font-size:1rem}}
body.production-mode .production-table .production-line-select{{background:#282e28!important;color:#d4ddd0!important}}
body.production-mode .production-table .production-row-open{{background:#252c23!important;color:#cbd6c2!important;border-color:#485341!important}}
body.production-mode .production-table .production-drag-handle{{background:#252a24;color:#a9b2a3;border-color:#424a3d}}
body.production-mode .production-table .production-delete-row{{color:#aeb5a8!important;border-color:#485043!important}}
body.production-mode .production-table .production-delete-row:hover{{color:#ffc6bc!important;border-color:#b66f64!important}}
body.production-mode .production-table .order-identity{{color:#f0f3ed}}
body.production-mode .production-table .order-process.active{{background:#2d3826;color:#d5e7bd;border-left-color:#93ae6f}}
body.production-mode .production-table .order-process.finished{{background:#263333;color:#bcd3cd;border-left-color:#779c93}}
body.production-mode .production-table .order-process.pending{{background:#282d28;color:#aeb7a8}}
body.production-mode .production-table td.delivery-days-cell.semaphore-green{{background:#243326!important;color:#cee5c5!important}}
body.production-mode .production-table td.delivery-days-cell.semaphore-orange{{background:#3b3023!important;color:#eed7b3!important}}
body.production-mode .production-table td.delivery-days-cell.semaphore-red{{background:#3c2727!important;color:#efc6c1!important}}
`;document.head.appendChild(neutralTableStyle);
    function renderProduction(){{if(!productionData)return;updateProcessFilter();const hiddenHeaders=new Set(['COLUMNA 46','TELA','TA','OK','METODOLOGIA','METODOLOGÍA','PERFIL','ESTADO','TIPO DE DISEÑO','TIPO DE DISENO']),query=productionSearch.value.trim().toLocaleLowerCase('es'),rows=exactScheduleOrder?productionData.rows.filter(row=>String(row.values[scheduleHeaderIndex('ORDEN')]||'').trim().toUpperCase()===exactScheduleOrder.toUpperCase()):query?productionData.rows.filter(row=>row.values.some(value=>String(value||'').toLocaleLowerCase('es').includes(query))):productionData.rows,columns=productionData.headers.map((header,sourceIndex)=>({{header,group:productionData.groups[sourceIndex]||'GENERAL',sourceIndex}})).slice(1).filter(column=>{{const title=String(column.header||'').replace(/^['"]|['"]$/g,'').trim().toUpperCase(),group=String(column.group||'').replace(/^['"]|['"]$/g,'').trim().toUpperCase();return !(group==='CORTE TEXTIL'&&(title==='CORTE TEXTIL'||title.startsWith('RESP')))&&processColumnVisible(column)&&!hiddenHeaders.has(title)&&!title.includes('CORREO')&&!(group.includes('METODOLOG')&&title.startsWith('RESP'))}}),visibleHeaders=columns.map(column=>column.header),groups=productionGroupSegments(columns.map(column=>column.group)),orderIndex=productionData.headers.findIndex(header=>String(header||'').trim().toUpperCase()==='ORDEN');productionHead.innerHTML='<tr class="production-groups"><th class="production-row-head" rowspan="2">FILA</th>'+groups.map(group=>`<th colspan="${{group.count}}">${{esc(group.label)}}</th>`).join('')+'</tr><tr class="production-columns">'+visibleHeaders.map(header=>`<th>${{esc(header)}}</th>`).join('')+'</tr>';productionBody.innerHTML=rows.map(row=>'<tr><td>'+productionRowButton(row.source_row,orderIndex>=0?row.values[orderIndex]:'')+'</td>'+columns.map(column=>{{const value=row.values[column.sourceIndex]||'',sheetColumn=column.sourceIndex+1,selectable=isAppliqueHeader(column.header)||isMachineHeader(column.header)||isResponsibleHeader(column.header)||isLineHeader(column.header),content=column.sourceIndex===orderIndex?orderIdentity(value,row):isAppliqueHeader(column.header)?appliqueSelect(value,row.source_row,sheetColumn):isMachineHeader(column.header)?machineSelect(value,row.source_row,sheetColumn):isResponsibleHeader(column.header)?responsibleSelect(value,row.source_row,sheetColumn):isLineHeader(column.header)?lineSelect(value,row.source_row,sheetColumn):esc((processKey(column.header).includes('FECHA')||processStatusHeaders.has(processKey(column.header)))?displayProductionDate(value):value);return '<td data-row="'+row.source_row+'" data-column="'+sheetColumn+'" title="'+(selectable?'Selecciona una opción':'Doble clic para editar')+'" class="'+productionCellClass(value,column.header)+'">'+content+'</td>'}}).join('')+'</tr>').join('');productionEmpty.hidden=rows.length>0;document.getElementById('production-records').textContent=rows.length.toLocaleString('es-CO');document.getElementById('production-units').textContent=rows.reduce((total,row)=>total+(Number(String(row.values[7]||'').replace(/[^0-9.-]/g,''))||0),0).toLocaleString('es-CO');productionStatus.textContent=query?`Mostrando ${{rows.length}} de ${{productionData.rows.length}} registros · doble clic para editar`:`Todos los procesos disponibles · filas desde la ${{productionData.start_row}} · doble clic para editar`;decorateNotes();requestAnimationFrame(()=>{{freezeProductionColumns();syncProductionWidth();fitProductionHeight()}})}}
async function saveProductionCell(cell,value,original){{let reason=null;const header=String(productionData.headers[Number(cell.dataset.column)-1]||'').trim().toUpperCase();if(value==='R'&&processStatusHeaders.has(processKey(header))){{reason=prompt('REPROCESO · Escribe el motivo (obligatorio, máximo 2000 caracteres):');if(reason===null)return false;reason=reason.trim();if(!reason||reason.length>2000){{alert('Escribe un motivo entre 1 y 2000 caracteres.');return false}}}}if(value===original&&!reason)return true;cell.classList.add('is-saving');productionStatus.textContent=`Guardando fila ${{cell.dataset.row}}…`;try{{const response=await fetch('/api/produccion/celda',{{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{row:Number(cell.dataset.row),column:Number(cell.dataset.column),value,reason}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar');cell.classList.add('is-saved');setTimeout(()=>cell.classList.remove('is-saved'),900);const record=productionData.rows.find(row=>String(row.source_row)===cell.dataset.row);if(record){{if(data.values)record.values=data.values;else record.values[Number(cell.dataset.column)-1]=value;}}productionStatus.textContent=`✓ Cambio guardado en la fila ${{cell.dataset.row}}`;return true}}catch(error){{productionStatus.textContent=error.message;return false}}finally{{cell.classList.remove('is-saving')}}}}
    const productionMonthNames=['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
    function displayProductionDate(value){{const date=scheduleParseDate(value);return date?String(date.getDate()).padStart(2,'0')+'-'+productionMonthNames[date.getMonth()]+'-'+String(date.getFullYear()).slice(-2):value}}
    function productionDateShortcut(now,withTime=false,timeOnly=false){{const parts=new Intl.DateTimeFormat('en-CA',{{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'numeric'}}).formatToParts(now),get=type=>parts.find(p=>p.type===type).value,date=get('day')+'-'+productionMonthNames[Number(get('month'))-1]+'-'+get('year').slice(-2),time=new Intl.DateTimeFormat('es-CO',{{timeZone:'America/Bogota',hour:'2-digit',minute:'2-digit',hour12:false}}).format(now);return timeOnly?time:withTime?date+' '+time:date}}
    async function editProductionCell(cell){{if(cell.classList.contains('is-editing')||cell.classList.contains('delivery-days-cell')||cell.querySelector('select'))return;const storedRow=productionData.rows.find(row=>String(row.source_row)===cell.dataset.row),original=String(storedRow?.values[Number(cell.dataset.column)-1]??''),input=document.createElement('input');input.className='production-cell-input';input.value=original;cell.classList.add('is-editing');cell.textContent='';cell.appendChild(input);input.focus();input.select();let finished=false;const finish=async save=>{{if(finished)return;finished=true;const value=input.value;cell.classList.remove('is-editing');cell.textContent=save?value:original;if(save&&value!==original){{const ok=await saveProductionCell(cell,value,original);if(!ok)cell.textContent=original;else setTimeout(renderProduction,120)}}}};input.addEventListener('keydown',event=>{{if(event.ctrlKey&&event.code==='Semicolon'){{event.preventDefault();const now=new Date();input.value=productionDateShortcut(now,event.altKey,event.shiftKey&&!event.altKey);return}}if(event.key==='Enter'){{event.preventDefault();input.blur()}}else if(event.key==='Escape'){{event.preventDefault();finished=true;cell.classList.remove('is-editing');cell.textContent=original}}}});input.addEventListener('blur',()=>finish(true))}}
    async function loadProduction(force=false){{productionRefresh.disabled=true;productionRefresh.textContent='Actualizando…';productionStatus.textContent='Cargando base local…';try{{const response=await fetch('/api/produccion'+(force?'?force=true':''));const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo consultar Producción');productionData=data;renderProduction()}}catch(error){{productionStatus.textContent=error.message;productionEmpty.hidden=false;productionEmpty.textContent='No fue posible cargar la información de producción.'}}finally{{productionRefresh.disabled=false;productionRefresh.textContent='Actualizar'}}}}
    const savedProductionZoom=Number(localStorage.getItem('indoor-production-zoom'));if(Number.isFinite(savedProductionZoom)&&savedProductionZoom>=.25&&savedProductionZoom<=2)productionZoom.value=String(Math.round(savedProductionZoom*100));function applyProductionZoom(){{const percent=Math.min(200,Math.max(25,Number(productionZoom.value)||100)),scale=percent/100;productionZoom.value=String(percent);productionTable.style.setProperty('--production-zoom',scale);localStorage.setItem('indoor-production-zoom',String(scale));requestAnimationFrame(()=>{{freezeProductionColumns();syncProductionWidth()}})}}applyProductionZoom();productionZoom.addEventListener('change',applyProductionZoom);productionZoom.addEventListener('keydown',event=>{{if(event.key==='Enter'){{event.preventDefault();applyProductionZoom();productionZoom.blur()}}}});productionSearch.addEventListener('input',()=>{{clearTimeout(productionTimer);productionTimer=setTimeout(renderProduction,220)}});productionRefresh.addEventListener('click',()=>loadProduction(true));productionBody.addEventListener('dblclick',event=>{{const cell=event.target.closest('td[data-row]');if(cell)editProductionCell(cell)}});productionBody.addEventListener('click',event=>{{const row=event.target.closest('tr');if(!row)return;productionBody.querySelectorAll('tr.is-selected').forEach(item=>item.classList.remove('is-selected'));row.classList.add('is-selected')}});productionBody.addEventListener('change',async event=>{{const select=event.target.closest('.production-resp-select');if(!select)return;const cell=select.closest('td'),original=select.dataset.original,value=select.value,ok=await saveProductionCell(cell,value,original);if(ok){{select.dataset.original=value;if(select.classList.contains('production-line-select')||select.classList.contains('production-applique-select'))renderProduction()}}else select.value=original}});let productionScrollFrame=0,productionScrollSource=null;function scheduleProductionScroll(source){{productionScrollSource=source;if(productionScrollFrame)return;productionScrollFrame=requestAnimationFrame(()=>{{productionScrollFrame=0;productionScrollSync=true;if(productionScrollSource===productionXScroll)productionTableWrap.scrollLeft=productionXScroll.scrollLeft;else productionXScroll.scrollLeft=productionTableWrap.scrollLeft;productionScrollSync=false}})}}productionXScroll.addEventListener('scroll',()=>{{if(!productionScrollSync)scheduleProductionScroll(productionXScroll)}},{{passive:true}});productionTableWrap.addEventListener('scroll',()=>{{if(!productionScrollSync)scheduleProductionScroll(productionTableWrap)}},{{passive:true}});
    let productionActiveCell=null;productionBody.addEventListener('click',event=>{{const cell=event.target.closest('td[data-row]');if(!cell)return;if(productionActiveCell)productionActiveCell.classList.remove('is-active-cell');productionActiveCell=cell;cell.classList.add('is-active-cell')}});document.addEventListener('keydown',async event=>{{if(!event.ctrlKey||event.code!=='Semicolon'||!productionActiveCell||productionActiveCell.classList.contains('delivery-days-cell')||productionActiveCell.querySelector('input,select'))return;event.preventDefault();const cell=productionActiveCell,original=cell.textContent,now=new Date(),value=productionDateShortcut(now,event.altKey,event.shiftKey&&!event.altKey);cell.textContent=value;const ok=await saveProductionCell(cell,value,original);if(ok)setTimeout(renderProduction,120);else cell.textContent=original}});
    const menuToggle=document.getElementById('menu-toggle'),commercialToggle=document.getElementById('commercial-toggle');function syncMenuButton(){{if(window.innerWidth<=860){{const open=document.body.classList.contains('menu-open');menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');menuToggle.textContent=open?'×':'☰'}}else{{const hidden=document.body.classList.contains('sidebar-hidden');menuToggle.setAttribute('aria-expanded',String(!hidden));menuToggle.setAttribute('aria-label',hidden?'Mostrar menú':'Ocultar menú');menuToggle.textContent=hidden?'☰':'‹'}}}}if(localStorage.getItem('indoor-sidebar-hidden')==='1')document.body.classList.add('sidebar-hidden');syncMenuButton();menuToggle.addEventListener('click',()=>{{if(window.innerWidth<=860)document.body.classList.toggle('menu-open');else{{const hidden=document.body.classList.toggle('sidebar-hidden');localStorage.setItem('indoor-sidebar-hidden',hidden?'1':'0')}}syncMenuButton()}});window.addEventListener('resize',()=>{{syncMenuButton();requestAnimationFrame(freezeProductionColumns)}});commercialToggle.addEventListener('click',()=>{{const g=commercialToggle.closest('.nav-group');g.classList.toggle('collapsed');if(!g.classList.contains('collapsed')&&window.innerWidth>860)g.querySelector('.nav-children .tab')?.click()}});
    document.getElementById('news-toggle').addEventListener('click',()=>{{const g=document.getElementById('news-toggle').closest('.nav-group');g.classList.toggle('collapsed');if(!g.classList.contains('collapsed')&&window.innerWidth>860)g.querySelector('.nav-children .tab')?.click()}});
    const inventoryStyle=document.createElement('style');inventoryStyle.textContent='.inventory-shell{{gap:16px;min-height:calc(100vh - 150px)}}.inventory-hero,.inventory-category-grid{{display:none!important}}.inventory-table-card{{min-height:calc(100vh - 190px);display:flex;flex-direction:column}}.inventory-cards-wrap{{max-height:none;height:calc(100vh - 285px);flex:1;overflow-y:auto}}.inventory-cards-grid{{grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}}.inventory-item-card{{display:grid;align-content:start;gap:10px;min-height:220px;padding:22px;border-radius:18px;background:linear-gradient(155deg,#1a2418,#0e140f);border:1px solid #46563f;box-shadow:0 12px 24px rgba(0,0,0,.18)}}.inventory-item-card:hover{{border-color:#d0f44c;transform:translateY(-2px)}}.inventory-item-card .inv-name{{font-size:1.08rem;min-height:48px}}.inventory-item-card .inv-color{{color:#9fb584;font-size:.78rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-top:-4px}}.inventory-item-card .inv-total{{font-size:2rem}}.inv-summary{{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:8px}}.inv-summary strong{{color:#e5ff83;font:bold 1.45rem Arial}}.inv-summary span{{color:#c8d5bd;font:800 .82rem Arial;white-space:nowrap}}.inv-rolls{{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}}.inv-rolls span{{display:grid;place-items:center;min-width:38px;height:38px;padding:0 6px;border:1px solid #8ca35a;border-radius:50%;background:#1f2c1b;color:#e5f6b8;font:800 13px Arial}}@media(max-width:600px){{.inventory-shell{{min-height:calc(100vh - 120px)}}.inventory-table-card{{min-height:calc(100vh - 155px)}}.inventory-cards-wrap{{height:calc(100vh - 260px)}}.inventory-cards-grid{{grid-template-columns:1fr}}}}';document.head.appendChild(inventoryStyle);
    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===t.dataset.kind));document.body.classList.toggle('inventory-mode',t.dataset.kind==='inventario');document.body.classList.toggle('production-mode',t.dataset.kind==='produccion');document.body.classList.toggle('inicio-mode',t.dataset.kind==='inicio');document.body.classList.toggle('schedule-mode',t.dataset.kind==='cronograma');document.body.classList.toggle('operarios-mode',t.dataset.kind==='operarios');document.body.classList.toggle('cartera-mode',t.dataset.kind==='cartera');if(t.dataset.kind==='inventario'&&!inventoryData)loadInventory();if(t.dataset.kind==='produccion')loadProduction();if(t.dataset.kind==='cronograma')loadSchedule();if(t.dataset.kind==='operarios')loadOperators();if(t.dataset.kind==='cartera'&&!carteraLoaded){{carteraLoaded=true;loadCartera();}}if(window.innerWidth<=860){{document.body.classList.remove('menu-open');syncMenuButton()}}}}));
    const inventoryNav=document.querySelector('.tab[data-kind="inventario"]'),productionGroup=document.getElementById('production-toggle')?.closest('.nav-group');if(inventoryNav&&productionGroup){{const inventoryGroup=document.createElement('div'),inventoryChildren=document.createElement('div'),inventoryWindows=[['BODEGA TELA','STOCK TELA'],['STOCK PARA MERCAR','STOCK PARA MERCAR'],['INSUMOS','INSUMOS'],['MATERIA PRIMA IMPRESION','MATERIA PRIMA IMPRESIÓN'],['RETAL CANASTAS','RETAL CANASTAS']];inventoryGroup.className='nav-group collapsed';inventoryGroup.innerHTML='<button class="nav-parent" type="button"><span class="nav-icon">IV</span><span>INVENTARIOS</span></button>';inventoryChildren.className='nav-children';inventoryWindows.forEach(([category,label])=>{{const button=document.createElement('button');button.type='button';button.className='tab';button.innerHTML='<span class="nav-icon">SH</span><strong>'+label+'</strong>';button.onclick=()=>{{inventoryNav.click();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===button));inventoryRequestedCategory=category;inventoryCategory=category;if(inventoryData)inventoryRender()}};inventoryChildren.appendChild(button)}});inventoryNav.remove();inventoryGroup.appendChild(inventoryChildren);productionGroup.insertAdjacentElement('afterend',inventoryGroup);inventoryGroup.querySelector('.nav-parent').onclick=()=>inventoryGroup.classList.toggle('collapsed');}}
    const inventoryBody=document.getElementById('inventory-body'),inventoryCategories=document.getElementById('inventory-categories'),inventoryStatus=document.getElementById('inventory-status'),inventorySearch=document.getElementById('inventory-search'),inventoryRefresh=document.getElementById('inventory-refresh');let inventoryData=null,inventoryCategory='',inventoryRequestedCategory='';const inventoryEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[char]));const inventoryFormat=value=>new Intl.NumberFormat('es-CO',{{maximumFractionDigits:2}}).format(Number(value)||0);function inventoryRender(){{if(!inventoryData)return;const query=inventorySearch.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const rows=(inventoryData.items||[]).filter(item=>{{const matchesCategory=!inventoryCategory||item.categoria===inventoryCategory;const haystack=(item.nombre+' '+item.categoria_label).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return matchesCategory&&(!query||haystack.includes(query))}});inventoryBody.innerHTML=rows.length?rows.map((item,i)=>`<article class="inventory-item-card" style="animation-delay:${{Math.min(i*15,600)}}ms"><span class="inv-badge">${{inventoryEscape(item.categoria_label)}}</span><strong class="inv-name">${{inventoryEscape(item.nombre)}}</strong><span class="inv-total">${{inventoryEscape(item.total_label)}}</span><span class="inv-unit">unidades</span></article>`).join(''):'<div class="inventory-empty">No hay artículos que coincidan con los filtros.</div>';inventoryStatus.textContent=`${{rows.length}} de ${{inventoryData.summary?.items||rows.length}} referencias${{inventoryCategory?' · '+((inventoryData.categories||[]).find(category=>category.key===inventoryCategory)?.label||inventoryCategory):''}}`;inventoryCategories.querySelectorAll('[data-inventory-category]').forEach(card=>card.classList.toggle('active',card.dataset.inventoryCategory===inventoryCategory));}}function inventoryRenderSummary(){{inventoryCategories.innerHTML=(inventoryData.categories||[]).filter(category=>category.available&&category.key!=='DOCUMENTACION PROCESO').map(category=>`<button type="button" class="inventory-category" data-inventory-category="${{inventoryEscape(category.key)}}"><small>${{inventoryEscape(category.label)}}</small><b>${{inventoryFormat(category.items)}}</b><span>refs · ${{inventoryEscape(category.units_label)}} und.</span></button>`).join('');inventoryCategories.querySelectorAll('[data-inventory-category]').forEach(card=>card.addEventListener('click',()=>{{inventoryCategory=inventoryCategory===card.dataset.inventoryCategory?'':card.dataset.inventoryCategory;inventoryRender()}}));inventoryRender()}}async function loadInventory(force=false){{inventoryRefresh.disabled=true;inventoryRefresh.textContent='Actualizando…';inventoryStatus.textContent='Leyendo inventario local…';try{{const response=await fetch('/api/inventarios'+(force?'?refresh=true':'')),data=await response.json();if(!response.ok)throw new Error(data.detail||'No fue posible cargar Inventarios');inventoryData=data;inventoryCategory=inventoryRequestedCategory;inventoryRequestedCategory='';inventoryRenderSummary();const time=new Intl.DateTimeFormat('es-CO',{{dateStyle:'short',timeStyle:'short'}}).format(new Date(data.updated_at));inventoryStatus.textContent=`${{data.summary?.items||data.items?.length||0}} referencias disponibles · inventario local · actualizado ${{time}}`}}catch(error){{inventoryBody.innerHTML=`<div class="inventory-empty">${{inventoryEscape(error.message)}}</div>`;inventoryCategories.innerHTML='';inventoryStatus.textContent='Inventarios no disponibles'}}finally{{inventoryRefresh.disabled=false;inventoryRefresh.textContent='↻ Actualizar'}}}}inventorySearch.addEventListener('input',inventoryRender);inventoryRefresh.addEventListener('click',()=>loadInventory(true));setTimeout(()=>{{if(inventoryBody?.textContent.includes('Cargando'))loadInventory()}},200);
    const bodegaShortcut=document.querySelector('.nav-children .tab strong')?.closest('.tab');
    document.querySelectorAll('.nav-children .tab').forEach(tab=>{{if(tab.textContent.toUpperCase().includes('STOCK TELA'))tab.addEventListener('click',()=>{{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel==='inventario'));document.body.classList.add('inventory-mode');document.body.classList.remove('inicio-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');inventoryCategory='BODEGA TELA';inventoryRequestedCategory='BODEGA TELA';if(!inventoryData)loadInventory();else inventoryRender();}});}});
    document.addEventListener('click',event=>{{const tab=event.target.closest('.nav-children .tab');if(!tab||!tab.textContent.toUpperCase().includes('STOCK TELA'))return;event.preventDefault();event.stopPropagation();document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.dataset.panel==='inventario'));document.body.classList.add('inventory-mode');document.body.classList.remove('inicio-mode','production-mode','schedule-mode','operarios-mode','cartera-mode');inventoryCategory='BODEGA TELA';inventoryRequestedCategory='BODEGA TELA';if(!inventoryData)loadInventory();else inventoryRender();}});
    const orderForm=document.getElementById('order-form'),pdf=document.getElementById('pedido-pdf'),excel=document.getElementById('pedido-excel'),extras=document.getElementById('pedido-extras'),orderSubmit=document.getElementById('order-submit'),orderMessage=document.getElementById('order-message');
    function checkOrder(){{document.getElementById('pdf-label').textContent=pdf.files[0]?.name||'Seleccionar cotización o remisión';document.getElementById('excel-label').textContent=excel.files[0]?.name||'Seleccionar archivo .xlsx o .xlsm';document.getElementById('extras-label').textContent=extras.files.length?extras.files.length+' anexo(s) seleccionado(s)':'Imágenes u otros archivos del pedido';orderSubmit.disabled=!(pdf.files.length&&excel.files.length)}} [pdf,excel,extras].forEach(x=>x.addEventListener('change',()=>{{checkOrder();if(pdf.files.length||excel.files.length){{localStorage.removeItem(currentKeys.pedido);resetProgressButton(orderSubmit,'Procesar pedido')}}}}));
    orderForm.addEventListener('submit',async e=>{{e.preventDefault();orderSubmit.disabled=true;orderSubmit.classList.add('is-progress');orderSubmit.style.setProperty('--creator-progress','5%');orderSubmit.textContent='Enviando archivos · 5%';orderMessage.textContent='Archivos recibidos. Validando la orden…';orderMessage.className='message show ok';try{{const r=await fetch('/procesar/pedido',{{method:'POST',body:new FormData(orderForm)}});const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo procesar el pedido');remember('pedido',data.id);orderMessage.textContent='Pedido enviado. El avance se actualizará en tiempo real.';orderForm.reset();orderForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));checkOrder();await refresh()}}catch(err){{resetProgressButton(orderSubmit,'Procesar pedido');checkOrder();orderMessage.textContent=err.message;orderMessage.className='message show error'}}}}); refresh();setInterval(refresh,750);
    const creatorForm=document.getElementById('creator-form'),creatorName=document.getElementById('creator-name'),dataInput=document.getElementById('datos-listado'),creatorInputs=[1,2,3,4].map(n=>document.getElementById('d'+n)),creatorSubmit=document.getElementById('creator-submit'),creatorMessage=document.getElementById('creator-message'),addMockup=document.getElementById('add-mockup'),mockupSlots=[...document.querySelectorAll('.mockup-slot')],extraSheets=document.getElementById('extra-sheets'),addExcelSheet=document.getElementById('add-excel-sheet');
    const mockupHints=['Opcional · JPG o PNG · celda S3','Opcional · JPG o PNG · celda Y3','Opcional · JPG o PNG · celda AE3','Opcional · JPG o PNG · celda AK3'];
    function updateMockupButton(){{const hidden=mockupSlots.filter(slot=>slot.hidden);addMockup.hidden=!hidden.length;addMockup.textContent=hidden.length?'＋ Agregar otro mockup':''}}
    function resetCreatorWorkspace(){{creatorForm.reset();extraSheets.innerHTML='';creatorForm.querySelectorAll('.has-file').forEach(row=>row.classList.remove('has-file'));mockupSlots.forEach(slot=>slot.hidden=true);creatorInputs.forEach((field,index)=>{{field.value='';document.getElementById('d'+(index+1)+'-label').textContent=mockupHints[index]}});document.getElementById('datos-label').textContent='Excel, Word, PDF, CSV, TXT, JPG o PNG';creatorSubmit.disabled=false;creatorSubmit.classList.remove('is-progress');creatorSubmit.style.removeProperty('--creator-progress');creatorSubmit.textContent='Crear listado XLSX';creatorMessage.textContent='';creatorMessage.className='message';localStorage.removeItem(currentKeys.creador);addExcelSheet.hidden=false;updateMockupButton()}}
    function hydrateCreatorWorkspace(job){{if(!job||hydratedCreatorJob===job.id||!job.input_summary||!['RECIBIDO','PROCESANDO'].includes(job.status))return;let summary;try{{summary=JSON.parse(job.input_summary)}}catch(e){{return}}if(!summary?.sheets?.length)return;hydratedCreatorJob=job.id;creatorForm.reset();extraSheets.innerHTML='';creatorName.value=summary.workbook_name||'';const first=summary.sheets[0],firstData=document.getElementById('datos-listado').closest('.file-row');document.getElementById('first-sheet-name').value=first.name||'';document.getElementById('datos-label').textContent=(first.data_filename||'Archivo recibido')+' · cargado';firstData.classList.add('has-file');mockupSlots.forEach(slot=>slot.hidden=true);(first.mockups||[]).forEach(mock=>{{const design=Number(mock.design);if(design>1&&mockupSlots[design-2])mockupSlots[design-2].hidden=false;const label=document.getElementById('d'+design+'-label');if(label){{label.textContent=mock.filename+' · cargado';label.closest('.file-row').classList.add('has-file')}}}});for(const spec of summary.sheets.slice(1)){{addExcelSheet.click();const sheet=extraSheets.lastElementChild,dataRow=sheet.querySelector('.sheet-data').closest('.file-row');sheet.querySelector('.sheet-name-input').value=spec.name||'';dataRow.querySelector('span').textContent=(spec.data_filename||'Archivo recibido')+' · cargado';dataRow.classList.add('has-file');const mocks=spec.mockups||[];const highest=Math.max(1,...mocks.map(mock=>Number(mock.design)||1));while(sheet.querySelectorAll('.sheet-mockup').length<highest)addDynamicMockup(sheet);mocks.forEach(mock=>{{const field=sheet.querySelector(`.sheet-mockup[data-design="${{mock.design}}"]`);if(field){{field.closest('.file-row').querySelector('span').textContent=mock.filename+' · cargado';field.closest('.file-row').classList.add('has-file')}}}})}}updateMockupButton();creatorMessage.textContent='Carga recuperada del servidor. El proceso continúa en tiempo real.';creatorMessage.className='message show ok'}}
    addMockup.addEventListener('click',()=>{{const next=mockupSlots.find(slot=>slot.hidden);if(next)next.hidden=false;updateMockupButton()}});
    mockupSlots.forEach(slot=>slot.querySelector('.remove-mockup').addEventListener('click',()=>{{const design=Number(slot.dataset.design),field=document.getElementById('d'+design);field.value='';document.getElementById('d'+design+'-label').textContent=mockupHints[design-1];slot.hidden=true;updateMockupButton()}}));
    function renumberSheets(){{[...extraSheets.querySelectorAll('.excel-sheet')].forEach((sheet,i)=>{{sheet.dataset.sheetIndex=i+1;sheet.querySelector('.sheet-title').textContent='CREADOR XLSX'}});addExcelSheet.hidden=extraSheets.children.length>=29}}
    function addDynamicMockup(sheet){{const shown=sheet.querySelectorAll('.sheet-mockup').length;if(shown>=4)return;const design=shown+1,slot=document.createElement('label');slot.className='file-row';slot.innerHTML=`<div><b>D${{design}} · ${{design===1?'Mockup principal':'Mockup adicional'}} (opcional)</b><span>JPG o PNG · se insertará en la celda ${{['S3','Y3','AE3','AK3'][design-1]}}</span></div><input class="sheet-mockup" data-design="${{design}}" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png">`;sheet.querySelector('.sheet-files').appendChild(slot);if(design===4)sheet.querySelector('.sheet-add-mockup').hidden=true}}
    addExcelSheet.addEventListener('click',()=>{{const sheet=document.createElement('div');sheet.className='excel-sheet';sheet.innerHTML=`<div class="excel-sheet-head card-head"><div><h2 class="sheet-title"></h2><p>Sube el archivo de datos y el mockup principal de esta pestaña.</p></div><button class="remove-sheet" type="button">Quitar pestaña</button></div><div class="upload-wrap"><div class="field full" style="margin-bottom:14px"><label>Nombre de la pestaña</label><input class="sheet-name-input" type="text" maxlength="31" placeholder="Ej. UNIFORME BLANCO"></div><div class="file-pair sheet-files"><label class="file-row" style="border-color:rgba(208,244,76,.5);background:rgba(208,244,76,.07)"><div><b>Archivo con los datos del listado</b><span>Excel, Word, PDF, CSV, TXT, JPG o PNG</span></div><input class="sheet-data" type="file" accept=".xlsx,.xls,.xlsm,.doc,.docx,.pdf,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" required></label></div><button class="add-mockup sheet-add-mockup" type="button">＋ Agregar otro mockup</button></div>`;extraSheets.appendChild(sheet);addDynamicMockup(sheet);sheet.querySelector('.sheet-add-mockup').addEventListener('click',()=>addDynamicMockup(sheet));sheet.querySelector('.remove-sheet').addEventListener('click',()=>{{sheet.remove();renumberSheets()}});renumberSheets()}});
    const previewModal=document.getElementById('preview-modal'),previewContent=document.getElementById('preview-content'),previewDesigns=document.getElementById('preview-designs'),previewSizeSummary=document.getElementById('preview-size-summary'),previewConfirm=document.getElementById('preview-confirm'),previewClose=document.getElementById('preview-close'),previewCancel=document.getElementById('preview-cancel');let previewDraft=null;
    function closePreview(){{previewModal.classList.remove('open')}} previewClose.addEventListener('click',closePreview);previewCancel.addEventListener('click',closePreview);
    function creatorPayload(){{const body=new FormData();body.append('nombre_archivo',creatorName.value);const added=[...extraSheets.querySelectorAll('.excel-sheet')],sheets=[null,...added];sheets.forEach((sheet,index)=>{{body.append('hoja_nombres',index===0?document.getElementById('first-sheet-name').value:sheet.querySelector('.sheet-name-input').value);body.append('datos_hoja',index===0?dataInput.files[0]:sheet.querySelector('.sheet-data').files[0]);const mocks=index===0?creatorInputs:[...sheet.querySelectorAll('.sheet-mockup')];mocks.forEach((field,i)=>{{if(field.files.length){{body.append('mockup_slots',index+':'+(Number(field.dataset.design)||i+1));body.append('mockups',field.files[0])}}}})}});return body}}
    function rowMarkup(row,index){{const size=String(row.talla||'').toUpperCase(),gender=String(row.genero||''),design=String(row.diseno||row['diseño']||'1').replace(/[^1-4]/g,'')||'1';return `<tr data-row><td>${{index+1}}</td><td><input data-field="nombre" value="${{esc(row.nombre||'')}}"></td><td><input data-field="talla" value="${{esc(size)}}"></td><td><input data-field="numero" value="${{esc(row.numero||'')}}"></td><td><select data-field="diseno"><option value="1" ${{design==='1'?'selected':''}}>D1</option><option value="2" ${{design==='2'?'selected':''}}>D2</option><option value="3" ${{design==='3'?'selected':''}}>D3</option><option value="4" ${{design==='4'?'selected':''}}>D4</option></select></td><td><select data-field="genero"><option value="" ${{!gender?'selected':''}}>Sin definir</option><option value="MASC" ${{gender==='MASC'?'selected':''}}>MASC</option><option value="FEM" ${{gender==='FEM'?'selected':''}}>FEM</option></select></td><td><input data-field="observaciones" value="${{esc(row.observaciones||'')}}"></td><td class="preview-row-actions"><button class="preview-delete" type="button" title="Quitar fila">×</button></td></tr>`}}
    function updateSizeSummary(){{const counts=new Map();let total=0;previewContent.querySelectorAll('tr[data-row] [data-field="talla"]').forEach(field=>{{const size=field.value.trim().toUpperCase();if(!size)return;counts.set(size,(counts.get(size)||0)+1);total++}});const preferred=['2','4','6','8','10','12','14','16','XS','S','M','L','XL','2XL','XXL','3XL','XXXL','4XL'];const sizes=[...counts.keys()].sort((a,b)=>{{const ai=preferred.indexOf(a),bi=preferred.indexOf(b);if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);return a.localeCompare(b,undefined,{{numeric:true}})}});previewSizeSummary.innerHTML=`<span class="size-total">TOTAL <b>${{total}}</b> UND.</span>${{sizes.map(size=>`<span class="size-chip">${{esc(size)}} <b>${{counts.get(size)}}</b></span>`).join('')}}`;}}
    function validatePreview(){{let warnings=[];document.querySelectorAll('.preview-sheet').forEach((sheet,sheetIndex)=>{{const seen=new Set();sheet.querySelectorAll('tr[data-row]').forEach((row,rowIndex)=>{{row.classList.remove('warning');const number=row.querySelector('[data-field="numero"]').value.trim(),size=row.querySelector('[data-field="talla"]').value.trim().toUpperCase();let issue=false;if(!size||!/^(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|[0-9]{{1,2}})$/.test(size)){{warnings.push(`Pestaña ${{sheetIndex+1}}, fila ${{rowIndex+1}}: talla por revisar`);issue=true}}if(!number){{warnings.push(`Pestaña ${{sheetIndex+1}}, fila ${{rowIndex+1}}: falta el número`);issue=true}}else if(seen.has(number)){{warnings.push(`Pestaña ${{sheetIndex+1}}: número ${{number}} repetido`);issue=true}}seen.add(number);row.classList.toggle('warning',issue)}})}});document.querySelectorAll('.preview-warnings').forEach(e=>e.remove());if(warnings.length){{previewContent.insertAdjacentHTML('afterbegin',`<div class="preview-warnings"><strong>Datos para revisar:</strong> ${{esc(warnings.slice(0,8).join(' · '))}}${{warnings.length>8?' · y '+(warnings.length-8)+' más':''}}</div>`)}}updateSizeSummary();return warnings}}
    function renderPreview(data){{previewDraft=data;const designs=data.sheets.flatMap((sheet,sheetIndex)=>(sheet.mockups||[]).map((mockup,designIndex)=>({{...mockup,sheetIndex,designIndex}})));previewDesigns.innerHTML=designs.length?designs.map(item=>`<div class="preview-design" title="Pestaña ${{item.sheetIndex+1}} · Diseño ${{item.design}}"><img src="${{esc(item.url)}}" alt="Diseño de la pestaña ${{item.sheetIndex+1}}"><span>P${{item.sheetIndex+1}} · D${{item.design}}</span></div>`).join(''):'<span class="preview-no-design">Sin diseño cargado</span>';previewContent.innerHTML=data.sheets.map((sheet,sheetIndex)=>`<section class="preview-sheet" data-sheet="${{sheetIndex}}"><div class="preview-sheet-title"><strong>Pestaña ${{sheetIndex+1}}</strong><input data-sheet-name value="${{esc(sheet.name||'')}}" placeholder="Nombre de la pestaña"><span>${{sheet.rows.length}} filas detectadas</span></div><div class="table-wrap"><table class="preview-table"><thead><tr><th>#</th><th>Nombre dorsal</th><th>Talla</th><th>Número</th><th>Diseño</th><th>Género</th><th>Observaciones</th><th></th></tr></thead><tbody>${{sheet.rows.map(rowMarkup).join('')}}</tbody></table></div><button class="preview-add" type="button">＋ Agregar fila</button></section>`).join('');previewContent.querySelectorAll('.preview-delete').forEach(button=>button.addEventListener('click',()=>{{button.closest('tr').remove();validatePreview()}}));previewContent.querySelectorAll('.preview-add').forEach(button=>button.addEventListener('click',()=>{{const tbody=button.closest('.preview-sheet').querySelector('tbody');tbody.insertAdjacentHTML('beforeend',rowMarkup({{}},tbody.children.length));tbody.lastElementChild.querySelector('.preview-delete').addEventListener('click',e=>{{e.currentTarget.closest('tr').remove();validatePreview()}})}}));previewContent.oninput=validatePreview;previewContent.onchange=validatePreview;validatePreview();previewModal.classList.add('open')}}
    dataInput.addEventListener('change',()=>{{document.getElementById('datos-label').textContent=dataInput.files[0]?dataInput.files[0].name:'Excel, Word, PDF, CSV, TXT, JPG o PNG'}});creatorInputs.forEach((input,i)=>input.addEventListener('change',()=>{{document.getElementById('d'+(i+1)+'-label').textContent=input.files[0]?input.files[0].name:mockupHints[i]}}));creatorForm.addEventListener('submit',async e=>{{e.preventDefault();if(!creatorName.value.trim()){{creatorMessage.textContent='Escribe el nombre que tendrá el archivo Excel.';creatorMessage.className='message show error';return}}if(!dataInput.files.length){{creatorMessage.textContent='Selecciona el archivo con los datos del listado.';creatorMessage.className='message show error';return}}const added=[...extraSheets.querySelectorAll('.excel-sheet')];if(added.some(sheet=>!sheet.querySelector('.sheet-data').files.length)){{creatorMessage.textContent='Cada pestaña de Excel debe tener su archivo con los datos.';creatorMessage.className='message show error';return}}creatorSubmit.disabled=true;creatorSubmit.classList.add('is-progress');let previewProgress=8;creatorSubmit.style.setProperty('--creator-progress',previewProgress+'%');creatorSubmit.textContent='Subiendo archivos · '+previewProgress+'%';creatorMessage.textContent='Leyendo y validando los datos antes de crear el Excel.';creatorMessage.className='message show ok';const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000),progressTimer=setInterval(()=>{{previewProgress=Math.min(88,previewProgress+(previewProgress<45?4:previewProgress<70?2:1));creatorSubmit.style.setProperty('--creator-progress',previewProgress+'%');creatorSubmit.textContent=(previewProgress<35?'Subiendo archivos':previewProgress<70?'Analizando datos':'Preparando vista previa')+' · '+previewProgress+'%'}},1400);try{{const r=await fetch('/crear-xlsx/vista-previa',{{method:'POST',body:creatorPayload(),signal:controller.signal}}),data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo preparar la vista previa');creatorSubmit.style.setProperty('--creator-progress','100%');creatorSubmit.textContent='Vista previa lista · 100%';renderPreview(data);setTimeout(()=>resetProgressButton(creatorSubmit,'Crear listado XLSX'),350);creatorSubmit.disabled=false;creatorMessage.textContent='Vista previa lista. Revisa los datos y confirma la creación.'}}catch(err){{resetProgressButton(creatorSubmit,'Crear listado XLSX');creatorSubmit.disabled=false;creatorMessage.textContent=err.name==='AbortError'?'La lectura tardó demasiado. Intenta nuevamente; tus archivos siguen seleccionados.':err.message;creatorMessage.className='message show error'}}finally{{clearTimeout(timeout);clearInterval(progressTimer)}}}});
    previewConfirm.addEventListener('click',async()=>{{if(!previewDraft)return;const sheets=[...previewContent.querySelectorAll('.preview-sheet')].map(sheet=>({{name:sheet.querySelector('[data-sheet-name]').value,rows:[...sheet.querySelectorAll('tr[data-row]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(field=>[field.dataset.field,field.value.trim()])) )}}));if(sheets.some(sheet=>!sheet.rows.length)){{alert('Cada pestaña debe tener al menos una fila.');return}}previewConfirm.disabled=true;previewConfirm.textContent='Creando Excel…';try{{const r=await fetch('/crear-xlsx/confirmar',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{draft_id:previewDraft.draft_id,workbook_name:previewDraft.workbook_name,sheets}})}}),data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo crear el Excel');remember('creador',data.id);closePreview();creatorSubmit.classList.add('is-progress');creatorSubmit.disabled=true;creatorMessage.textContent='Datos confirmados. El avance se actualizará en tiempo real.';creatorMessage.className='message show ok';await refresh()}}catch(err){{alert(err.message)}}finally{{previewConfirm.disabled=false;previewConfirm.textContent='Confirmar y crear XLSX'}}}});
    function enhanceProductionReadability(){{const scale=Math.min(2,Math.max(.25,(Number(productionZoom.value)||100)/100)),bodyPx=Math.max(12,10/scale),headPx=Math.max(10.5,8.5/scale);productionTable.style.setProperty('--production-body-font',bodyPx+'px');productionTable.style.setProperty('--production-head-font',headPx+'px');productionTable.style.setProperty('--production-group-font',headPx+'px')}}enhanceProductionReadability();productionZoom.addEventListener('input',enhanceProductionReadability);productionZoom.addEventListener('change',enhanceProductionReadability);function applyProductionRowSemaphores(){{productionBody.querySelectorAll('tr').forEach(row=>{{row.classList.remove('row-semaphore-green','row-semaphore-orange','row-semaphore-red');const delivery=row.querySelector('.delivery-days-cell');if(!delivery)return;if(delivery.classList.contains('semaphore-green'))row.classList.add('row-semaphore-green');else if(delivery.classList.contains('semaphore-orange'))row.classList.add('row-semaphore-orange');else if(delivery.classList.contains('semaphore-red'))row.classList.add('row-semaphore-red')}})}}const productionSemaphoreObserver=new MutationObserver(applyProductionRowSemaphores);productionSemaphoreObserver.observe(productionBody,{{childList:true}});applyProductionRowSemaphores();
    function enforceProductionRowColors(){{productionBody.querySelectorAll('tr').forEach(row=>{{const delivery=row.querySelector('.delivery-days-cell');if(!delivery)return;let tone='';if(delivery.classList.contains('semaphore-green'))tone='green';else if(delivery.classList.contains('semaphore-orange'))tone='orange';else if(delivery.classList.contains('semaphore-red'))tone='red';if(!tone)return;const rowColors={{green:'#181b18',orange:'#181b18',red:'#181b18'}},deliveryColors={{green:'#193719',orange:'#4a2d12',red:'#461a18'}},textColors={{green:'#dfffc4',orange:'#ffe0b3',red:'#ffd0cc'}};row.querySelectorAll('td').forEach(cell=>cell.style.setProperty('background-color',rowColors[tone],'important'));delivery.style.setProperty('background-color',deliveryColors[tone],'important');delivery.style.setProperty('color',textColors[tone],'important')}})}}const productionColorObserver=new MutationObserver(enforceProductionRowColors);productionColorObserver.observe(productionBody,{{childList:true}});enforceProductionRowColors();
    let productionDragArmed=null,productionDraggedRow=null,productionDragTarget=null,productionDragPointerY=0,productionDragFrame=0;function enhanceProductionDragHandles(){{const filtered=Boolean(productionSearch.value.trim());productionBody.querySelectorAll('tr').forEach(row=>{{const dataCell=row.querySelector('td[data-row]'),first=row.children[0];if(!dataCell||!first)return;row.dataset.sourceRow=dataCell.dataset.row;row.draggable=!filtered;if(filtered||first.querySelector('.production-drag-handle'))return;const existing=[...first.childNodes],tools=document.createElement('div'),handle=document.createElement('span');tools.className='production-row-tools';handle.className='production-drag-handle';handle.textContent='☰';handle.title='Arrastra para mover esta fila';handle.setAttribute('aria-label','Mover fila');tools.appendChild(handle);existing.forEach(node=>tools.appendChild(node));first.appendChild(tools)}})}}const productionDragObserver=new MutationObserver(enhanceProductionDragHandles);productionDragObserver.observe(productionBody,{{childList:true}});enhanceProductionDragHandles();function pauseProductionObservers(){{productionSemaphoreObserver.disconnect();productionColorObserver.disconnect();productionDragObserver.disconnect()}}function resumeProductionObservers(){{productionSemaphoreObserver.observe(productionBody,{{childList:true}});productionColorObserver.observe(productionBody,{{childList:true}});productionDragObserver.observe(productionBody,{{childList:true}});applyProductionRowSemaphores();enforceProductionRowColors();enhanceProductionDragHandles()}}productionBody.addEventListener('pointerdown',event=>{{const handle=event.target.closest('.production-drag-handle');productionDragArmed=handle?handle.closest('tr'):null}});productionBody.addEventListener('dragstart',event=>{{const row=event.target.closest('tr');if(!row||row!==productionDragArmed||productionSearch.value.trim()){{event.preventDefault();return}}pauseProductionObservers();productionDraggedRow=row;row.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',row.dataset.sourceRow)}});productionBody.addEventListener('dragover',event=>{{if(!productionDraggedRow)return;event.preventDefault();const target=event.target.closest('tr');if(!target||target===productionDraggedRow)return;productionDragTarget=target;productionDragPointerY=event.clientY;if(productionDragFrame)return;productionDragFrame=requestAnimationFrame(()=>{{productionDragFrame=0;const activeTarget=productionDragTarget;if(!activeTarget||activeTarget===productionDraggedRow)return;productionBody.querySelectorAll('.drag-target').forEach(row=>row.classList.remove('drag-target'));activeTarget.classList.add('drag-target');const rect=activeTarget.getBoundingClientRect(),after=productionDragPointerY>rect.top+rect.height/2;productionBody.insertBefore(productionDraggedRow,after?activeTarget.nextSibling:activeTarget);const wrapRect=productionTableWrap.getBoundingClientRect(),edge=70;if(productionDragPointerY<wrapRect.top+edge)productionTableWrap.scrollTop-=18;else if(productionDragPointerY>wrapRect.bottom-edge)productionTableWrap.scrollTop+=18}})}});productionBody.addEventListener('drop',event=>{{if(productionDraggedRow)event.preventDefault()}});productionBody.addEventListener('dragend',async()=>{{if(!productionDraggedRow)return;if(productionDragFrame)cancelAnimationFrame(productionDragFrame);productionDragFrame=0;productionDraggedRow.classList.remove('is-dragging');productionBody.querySelectorAll('.drag-target').forEach(row=>row.classList.remove('drag-target'));productionDraggedRow=null;productionDragTarget=null;productionDragArmed=null;resumeProductionObservers();const orderedRows=[...productionBody.querySelectorAll('tr[data-source-row]')].map(row=>Number(row.dataset.sourceRow));productionStatus.textContent='Guardando nuevo orden…';try{{const response=await fetch('/api/produccion/orden',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{rows:orderedRows}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar el orden');const byRow=new Map(productionData.rows.map(row=>[Number(row.source_row),row]));productionData.rows=orderedRows.map(row=>byRow.get(row)).filter(Boolean);productionStatus.textContent='✓ Nuevo orden guardado para todos los operarios'}}catch(error){{productionStatus.textContent=error.message;await loadProduction()}}}});
    function enhanceProductionDeleteButtons(){{productionBody.querySelectorAll('tr[data-source-row] .production-row-tools').forEach(tools=>{{if(tools.querySelector('.production-delete-row'))return;const button=document.createElement('button');button.type='button';button.className='production-delete-row';button.textContent='×';button.title='Eliminar esta fila';button.setAttribute('aria-label','Eliminar fila');const handle=tools.querySelector('.production-drag-handle');handle.insertAdjacentElement('afterend',button)}})}}const productionDeleteObserver=new MutationObserver(enhanceProductionDeleteButtons);productionDeleteObserver.observe(productionBody,{{childList:true,subtree:true}});enhanceProductionDeleteButtons();productionBody.addEventListener('click',async event=>{{const button=event.target.closest('.production-delete-row');if(!button)return;event.preventDefault();event.stopPropagation();const row=button.closest('tr'),sourceRow=Number(row.dataset.sourceRow),record=productionData?.rows.find(item=>Number(item.source_row)===sourceRow),orderIndex=productionData?.headers.findIndex(header=>String(header||'').trim().toUpperCase()==='ORDEN')??-1,order=record&&orderIndex>=0?String(record.values[orderIndex]||'').trim():'';if(!confirm(`¿Eliminar definitivamente la fila${{order?' de la orden '+order:''}}?`))return;button.disabled=true;productionStatus.textContent='Eliminando fila…';try{{const response=await fetch('/api/produccion/fila/'+sourceRow,{{method:'DELETE'}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo eliminar la fila');productionData=null;await loadProduction();productionStatus.textContent='✓ Fila eliminada correctamente'}}catch(error){{button.disabled=false;productionStatus.textContent=error.message}}}});
    function sealFrozenProductionColumns(){{productionBody.querySelectorAll('tr').forEach(row=>{{let color='#0f140d';if(row.classList.contains('row-semaphore-green'))color='#142714';else if(row.classList.contains('row-semaphore-orange'))color='#2d2012';else if(row.classList.contains('row-semaphore-red'))color='#2b1715';row.querySelectorAll('td.production-frozen').forEach(cell=>{{cell.style.setProperty('background-color',color,'important');cell.style.setProperty('opacity','1','important')}})}})}}let frozenSealFrame=0;function scheduleFrozenSeal(){{if(frozenSealFrame)return;frozenSealFrame=requestAnimationFrame(()=>{{frozenSealFrame=0;sealFrozenProductionColumns()}})}}const frozenSealObserver=new MutationObserver(scheduleFrozenSeal);frozenSealObserver.observe(productionBody,{{childList:true,subtree:true}});window.addEventListener('resize',scheduleFrozenSeal,{{passive:true}});
const scheduleGrid=document.getElementById('schedule-grid'),scheduleMonth=document.getElementById('schedule-month'),scheduleCount=document.getElementById('schedule-count');
function scheduleToday(){{const p=new Intl.DateTimeFormat('en-CA',{{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}}).formatToParts(new Date());const get=k=>Number(p.find(x=>x.type===k).value);return new Date(get('year'),get('month')-1,get('day'))}}
let scheduleDate=scheduleToday();const scheduleView='month';
const scheduleOverview=document.createElement('div');scheduleOverview.className='schedule-overview';
const scheduleExtras=document.createElement('div');scheduleExtras.className='schedule-extras';scheduleExtras.innerHTML='<div class="schedule-metrics" aria-label="Estadísticas de entregas"></div><div class="schedule-filters"><input id="schedule-search" type="search" placeholder="Buscar cliente u orden" aria-label="Buscar cliente u orden"></div>';
const scheduleStatsBar=document.createElement('div');scheduleStatsBar.className='schedule-stats-bar';scheduleStatsBar.innerHTML='<h4 class="schedule-overview-title">Resumen del mes</h4><div class="schedule-stats-chart" id="schedule-week-chart" aria-label="Entregas por semana del mes"></div><div class="schedule-stats-kpis" id="schedule-stats-kpis"></div>';
scheduleOverview.append(scheduleExtras,scheduleStatsBar);document.querySelector('.schedule-summary').before(scheduleOverview);
const scheduleCards=document.getElementById('schedule-cards');
const scheduleSearch=document.getElementById('schedule-search');
scheduleSearch.addEventListener('input',renderSchedule);
let scheduleStatFilter='all';
function scheduleStatClick(event){{const button=event.target.closest('[data-stat]');if(!button)return;scheduleStatFilter=scheduleStatFilter===button.dataset.stat?'all':button.dataset.stat;renderSchedule()}}document.querySelector('.schedule-metrics').addEventListener('click',scheduleStatClick);
/* Calendario interactivo del mes: puntos por pedido, intensidad segun unidades, detalle al pasar
   el mouse y clic para filtrar la lista por dia o por semana completa. */
const scheduleCap=text=>text.charAt(0).toUpperCase()+text.slice(1);
function scheduleTone(item,today){{return item.delivered?'done':item.date<today?'late':scheduleISO(item.date)===scheduleISO(today)?'due':'planned'}}
function scheduleCalendarHTML(all,today){{
  const y=scheduleDate.getFullYear(),m=scheduleDate.getMonth(),first=new Date(y,m,1),lead=(first.getDay()+6)%7,start=new Date(y,m,1-lead);
  const weeksNeeded=Math.ceil((lead+new Date(y,m+1,0).getDate())/7),todayKey=scheduleISO(today),byDay=new Map();
  all.forEach(item=>{{const k=scheduleISO(item.date);if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(item)}});
  const monthKey=scheduleISO(first).slice(0,7),maxUnits=Math.max(1,...[...byDay.entries()].filter(([k])=>k.slice(0,7)===monthKey).map(([,list])=>list.reduce((s,i)=>s+i.units,0)));
  let cells='';
  for(let w=0;w<weeksNeeded;w++){{
    const ws=new Date(start);ws.setDate(start.getDate()+w*7);let wCount=0,wUnits=0,wLate=0;
    for(let d=0;d<7;d++){{
      const day=new Date(ws);day.setDate(ws.getDate()+d);const k=scheduleISO(day),list=byDay.get(k)||[],units=list.reduce((s,i)=>s+i.units,0),inMonth=day.getMonth()===m;
      if(inMonth){{wCount+=list.length;wUnits+=units;wLate+=list.filter(i=>scheduleTone(i,today)==='late').length}}
      const heat=list.length?Math.round(15+units/maxUnits*85):0;
      const dots=list.slice(0,4).map(i=>'<i class="'+scheduleTone(i,today)+'"></i>').join('')+(list.length>4?'<em>+'+(list.length-4)+'</em>':'');
      cells+='<button type="button" class="sch-cal-day'+(inMonth?'':' out')+(k===todayKey?' today':'')+(scheduleStatFilter==='day|'+k?' selected':'')+(list.length?' has':'')+'" data-calday="'+k+'" style="--heat:'+heat+'%" aria-label="'+day.getDate()+': '+list.length+' entregas"><span class="sch-cal-num">'+day.getDate()+'</span>'+(list.length?'<span class="sch-cal-count">'+list.length+'</span><span class="sch-cal-dots">'+dots+'</span>':'')+'</button>';
    }}
    const wk=scheduleISO(ws);
    cells+='<button type="button" class="sch-cal-week'+(scheduleStatFilter==='wk|'+wk?' selected':'')+(wLate?' late':'')+'" data-calweek="'+wk+'" title="Ver toda la semana"><strong>'+wCount+'</strong><span>'+wUnits.toLocaleString('es-CO')+' u.</span>'+(wLate?'<em>'+wLate+' venc.</em>':'')+'</button>';
  }}
  return '<div class="sch-cal-head"><span class="sch-chart-title">Calendario de entregas · '+scheduleDate.toLocaleDateString('es-CO',{{month:'long',year:'numeric'}})+'</span><span class="sch-cal-legend"><i class="planned"></i>Programado<i class="due"></i>Hoy<i class="late"></i>Vencido<i class="done"></i>Entregado</span></div>'+
    '<div class="sch-cal">'+['Lun','Mar','Mié','Jue','Vie','Sáb','Dom','Semana'].map(d=>'<span class="sch-cal-dow">'+d+'</span>').join('')+cells+'</div>';
}}
function scheduleFilterLabel(){{
  const f=scheduleStatFilter;if(f==='all')return '';
  if(f.startsWith('day|'))return 'Entregas del '+new Date(f.slice(4)+'T00:00:00').toLocaleDateString('es-CO',{{weekday:'long',day:'numeric',month:'short'}});
  if(f.startsWith('wk|'))return 'Semana del '+new Date(f.slice(3)+'T00:00:00').toLocaleDateString('es-CO',{{day:'numeric',month:'short'}});
  return {{week:'Esta semana',soon:'Próximos 7 días',late:'Vencidas sin entregar',done:'Entregadas',today:'Hoy',month:'Este mes'}}[f]||'';
}}
const scheduleFilterPill=document.createElement('div');scheduleFilterPill.className='sch-filter-pill';document.querySelector('.schedule-summary').appendChild(scheduleFilterPill);
scheduleFilterPill.addEventListener('click',event=>{{if(!event.target.closest('[data-clearfilter]'))return;scheduleStatFilter='all';renderSchedule()}});
const scheduleTip=document.createElement('div');scheduleTip.className='sch-tip';scheduleTip.hidden=true;document.body.appendChild(scheduleTip);
scheduleStatsBar.addEventListener('mouseover',event=>{{
  const cell=event.target.closest('.sch-cal-day.has');if(!cell){{scheduleTip.hidden=true;return}}
  const today=scheduleToday(),list=scheduleOrders().filter(i=>scheduleISO(i.date)===cell.dataset.calday);
  scheduleTip.innerHTML='<strong>'+scheduleCap(new Date(cell.dataset.calday+'T00:00:00').toLocaleDateString('es-CO',{{weekday:'long',day:'numeric',month:'long'}}))+'</strong>'+list.slice(0,8).map(i=>'<div class="sch-tip-row"><i class="'+scheduleTone(i,today)+'"></i><span>'+esc(i.order)+' · '+esc(i.client||'Sin cliente')+'</span><b>'+i.units.toLocaleString('es-CO')+' u.</b></div>').join('')+(list.length>8?'<em>y '+(list.length-8)+' más</em>':'')+'<small>Clic para ver solo este día</small>';
  scheduleTip.hidden=false;const r=cell.getBoundingClientRect(),w=scheduleTip.offsetWidth,h=scheduleTip.offsetHeight;
  scheduleTip.style.left=Math.max(8,Math.min(r.left+r.width/2-w/2,innerWidth-w-8))+'px';scheduleTip.style.top=(r.top-h-8>8?r.top-h-8:r.bottom+8)+'px';
}});
scheduleStatsBar.addEventListener('mouseleave',()=>{{scheduleTip.hidden=true}});
scheduleStatsBar.addEventListener('click',event=>{{
  const day=event.target.closest('[data-calday]'),week=event.target.closest('[data-calweek]');if(!day&&!week)return;
  const key=day?'day|'+day.dataset.calday:'wk|'+week.dataset.calweek;scheduleStatFilter=scheduleStatFilter===key?'all':key;scheduleTip.hidden=true;renderSchedule();
  document.querySelector('.schedule-summary').scrollIntoView({{behavior:'smooth',block:'start'}});
}});
const scheduleUiStyle=document.createElement('style');scheduleUiStyle.textContent=`
html body.schedule-mode .schedule-shell{{grid-template-rows:none!important;grid-auto-rows:auto;overflow-y:auto!important;scrollbar-width:thin}}
html body.schedule-mode .schedule-cards{{overflow:visible}}
.schedule-daycard{{min-height:0}}.schedule-daycard-mockup.empty{{height:56px}}.schedule-daycard-empty{{min-height:90px}}
:is(.sch-day-picks,.sch-cal-dots,.sch-cal-legend,.sch-tip-row) .planned{{background:#6cb6ff}}:is(.sch-day-picks,.sch-cal-dots,.sch-cal-legend,.sch-tip-row) .due{{background:#ffb347}}:is(.sch-day-picks,.sch-cal-dots,.sch-cal-legend,.sch-tip-row) .late{{background:#ff6b6b}}:is(.sch-day-picks,.sch-cal-dots,.sch-cal-legend,.sch-tip-row) .done{{background:#8bd450}}
.sch-day-picks{{display:flex;flex-wrap:wrap;gap:5px}}.sch-day-picks button{{width:14px;height:14px;min-height:0;padding:0;border-radius:50%;border:2px solid transparent;box-shadow:none;cursor:pointer;transition:transform .12s}}.sch-day-picks button:hover{{transform:scale(1.2);filter:none}}.sch-day-picks button.on{{border-color:#fff;transform:scale(1.15)}}
.sch-cal-head{{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}}.sch-cal-head .sch-chart-title{{margin:0}}
.sch-cal-legend{{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10px;color:#8fa385}}.sch-cal-legend i{{width:8px;height:8px;border-radius:50%;margin-left:8px}}
.sch-cal{{display:grid;grid-template-columns:repeat(7,minmax(0,1fr)) 84px;gap:5px}}
.sch-cal-dow{{font-size:10px;color:#7a8f7a;text-align:center;text-transform:uppercase;letter-spacing:.05em}}
.sch-cal-day{{position:relative;display:grid;grid-template-rows:auto 1fr;align-content:space-between;min-height:58px;width:auto;padding:6px 7px;background:color-mix(in srgb,#4b6a1f var(--heat),#0f120d);border:1px solid #263123;border-radius:9px;box-shadow:none;text-align:left;cursor:pointer;transition:transform .12s,border-color .12s}}
.sch-cal-day:hover{{transform:translateY(-2px);border-color:#9bb57f;filter:none}}.sch-cal-day.out{{opacity:.35}}.sch-cal-day.today{{border-color:var(--lime);box-shadow:0 0 0 1px var(--lime)}}.sch-cal-day.selected{{border-color:#fff;box-shadow:0 0 0 2px #fff}}
.sch-cal-num{{font-size:12px;font-weight:700;color:#dfe7d8}}.sch-cal-count{{position:absolute;top:5px;right:6px;font-size:10px;font-weight:900;line-height:16px;padding:0 6px;border-radius:999px;background:#d0f44c;color:#0d1108}}
.sch-cal-dots{{display:flex;align-items:center;gap:3px;flex-wrap:wrap;align-self:end}}.sch-cal-dots i{{width:7px;height:7px;border-radius:50%}}.sch-cal-dots em{{font-style:normal;font-size:9px;color:#dfe7d8}}
.sch-cal-week{{display:grid;align-content:center;justify-items:center;gap:1px;width:auto;min-height:58px;padding:4px;background:#0b0e0a;border:1px dashed #2d352a;border-radius:9px;box-shadow:none;cursor:pointer}}.sch-cal-week:hover{{border-color:#9bb57f;filter:none}}.sch-cal-week.selected{{border:1px solid #fff}}.sch-cal-week.late{{border-color:#6a3a32}}
.sch-cal-week strong{{font-size:16px;color:#e8f0e2}}.sch-cal-week span{{font-size:9px;color:#7a8f7a}}.sch-cal-week em{{font-style:normal;font-size:9px;font-weight:700;color:#f5a97f}}
.sch-tip{{position:fixed;z-index:3000;width:min(300px,calc(100vw - 16px));display:grid;gap:5px;padding:10px 12px;background:#10140f;border:1px solid #4d5c45;border-radius:10px;box-shadow:0 12px 30px #000a;pointer-events:none;font-size:12px;color:#dfe7d8}}.sch-tip[hidden]{{display:none}}
.sch-tip strong{{color:#f2f7ea}}.sch-tip-row{{display:flex;align-items:center;gap:7px}}.sch-tip-row i{{width:8px;height:8px;border-radius:50%;flex-shrink:0}}.sch-tip-row span{{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.sch-tip em{{font-style:normal;color:#a3aea0}}.sch-tip small{{color:#7a8f7a;font-size:10px}}
.sch-filter-pill{{display:flex;align-items:center;gap:8px;flex-wrap:wrap}}.sch-filter-pill:empty{{display:none}}.sch-filter-pill span{{font-size:12px;color:#c4cec2}}.sch-filter-pill b{{color:var(--lime)}}.sch-filter-pill button{{width:auto;min-height:0;padding:4px 10px;font-size:11px;background:#232e18;border:1px solid var(--lime);color:var(--lime);border-radius:999px;box-shadow:none}}
.sch-group{{grid-column:1/-1;display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 2px 4px;border-bottom:1px solid #2a3128}}.sch-group:first-child{{padding-top:0}}.sch-group strong{{font-size:12px;color:#e3eadc}}.sch-group span{{font-size:11px;color:#8fa385}}.sch-group.today strong{{color:var(--lime)}}.sch-group.past strong{{color:#a3aea0}}
button.schedule-card-item{{transition:transform .15s,border-color .15s,background .15s}}button.schedule-card-item:hover{{transform:translateY(-2px)}}
html body button.schedule-card-item.tone-done{{border-left:4px solid #8bd450!important}}html body button.schedule-card-item.tone-late{{border-left:4px solid #ff6b6b!important}}html body button.schedule-card-item.tone-due{{border-left:4px solid #ffb347!important}}html body button.schedule-card-item.tone-planned{{border-left:4px solid #6cb6ff!important}}
@media(max-width:700px){{.sch-cal{{grid-template-columns:repeat(7,minmax(0,1fr))}}.sch-cal-week,.sch-cal-dow:nth-child(8){{display:none}}.sch-cal-day{{min-height:44px;padding:4px}}.sch-cal-count{{display:none}}}}
`;document.head.appendChild(scheduleUiStyle);
const scheduleDayIndex={{}};let scheduleDaysOffset=0;
document.getElementById('schedule-days-prev').addEventListener('click',()=>{{scheduleDaysOffset-=7;renderDayCards()}});
document.getElementById('schedule-days-next').addEventListener('click',()=>{{scheduleDaysOffset+=7;renderDayCards()}});
document.getElementById('schedule-days-today').addEventListener('click',()=>{{scheduleDaysOffset=0;renderDayCards()}});
async function renderDayCards(){{if(!productionData)return;const today=scheduleToday(),todayISO=scheduleISO(today),all=scheduleOrders(),slots=[],pending=[];const base=new Date(today);base.setDate(today.getDate()+scheduleDaysOffset);const rangeEnd=new Date(base);rangeEnd.setDate(base.getDate()+7);document.getElementById('schedule-days-range').textContent=scheduleDaysOffset===0?'':'· '+base.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}})+' — '+rangeEnd.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}});document.getElementById('schedule-days-today').setAttribute('aria-pressed',String(scheduleDaysOffset===0));for(let n=0;n<8;n++){{const d=new Date(base);d.setDate(base.getDate()+n);const iso=scheduleISO(d),items=all.filter(i=>scheduleISO(i.date)===iso).sort((a,b)=>a.order.localeCompare(b.order));let idx=scheduleDayIndex[iso]||0;if(idx>=items.length)idx=0;scheduleDayIndex[iso]=idx;const item=items[idx];slots.push({{d,iso,items,item,idx}});if(item&&item.sourceRow!=null&&!traceAssets.has(item.sourceRow)&&!traceAssetBusy.has(item.sourceRow))pending.push(loadTraceAssets(item.sourceRow))}}if(pending.length)await Promise.all(pending);const cards=slots.map(({{d,iso,items,item,idx}})=>{{let mockup='';if(item){{const asset=item.sourceRow!=null?traceAssets.get(item.sourceRow):null;const image=asset&&!asset.error&&asset.images&&asset.images[0];mockup=image?'<div class="schedule-daycard-mockup"><img loading="lazy" src="'+esc(image.url)+'" alt="'+esc(image.name||'Diseño')+'"></div>':'<div class="schedule-daycard-mockup empty">'+(asset?'Sin diseño adjunto':'Cargando diseño…')+'</div>'}}const dayStateColor={{finished:'#8bd450',active:'#6cb6ff',rework:'#ff6b6b',pending:'#4b5648'}},dayStateLabel={{finished:'Terminado',active:'En proceso',rework:'Reproceso',pending:'Pendiente'}};const dots=item?(item.states||[]).map(st=>'<i style="background:'+dayStateColor[st.state]+'" title="'+esc(st.label+': '+dayStateLabel[st.state])+'"></i>').join(''):'';const progress=item?'<div class="schedule-daycard-progress"><div class="schedule-card-dots">'+dots+'</div><div class="schedule-card-progress"><span><b style="width:'+(item.percent||0)+'%"></b></span><em>'+(item.percent||0)+'%</em></div><div class="schedule-card-focus"><i style="background:'+(item.focus?dayStateColor[item.focus.state]:'#4b5648')+'"></i>'+(item.focus?esc(item.focus.label)+' · '+dayStateLabel[item.focus.state]:'Sin proceso pendiente')+'</div></div>':'';const body=item?mockup+'<div class="schedule-daycard-fields"><div><span>CLIENTE</span><b>'+esc(item.client||'Sin cliente')+'</b></div><div><span>PROYECTO</span><b>'+esc(item.project||'—')+'</b></div><div><span>ORDEN</span><b>'+esc(item.order)+'</b></div><div><span>CANTIDAD</span><b>'+item.units.toLocaleString('es-CO')+' und.'+(item.delivered?' · Entregado':'')+'</b></div></div>'+progress:'<div class="schedule-daycard-empty">Sin entregas</div>';const pager=items.length>1?'<div class="schedule-daycard-pager"><button type="button" data-daynav="prev" data-iso="'+iso+'" aria-label="Entrega anterior">‹</button><span>'+(idx+1)+'/'+items.length+'</span><button type="button" data-daynav="next" data-iso="'+iso+'" aria-label="Entrega siguiente">›</button></div>':'';return '<div class="schedule-daycard'+(iso===todayISO?' is-today':'')+(scheduleStatFilter==='day|'+iso?' active':'')+'" data-iso="'+iso+'"><div class="schedule-daycard-head"><span class="schedule-daycard-dow">'+d.toLocaleDateString('es-CO',{{weekday:'short'}}).replace('.','')+'</span><span class="schedule-daycard-num">'+d.getDate()+'</span><b>'+items.length+'</b></div>'+(items.length>1?'<div class="sch-day-picks">'+items.map((it,j)=>'<button type="button" class="'+scheduleTone(it,today)+(j===idx?' on':'')+'" data-daypick="'+j+'" data-iso="'+iso+'" title="'+esc(it.order+' · '+(it.client||'Sin cliente'))+'" aria-label="Ver '+esc(it.order)+'"></button>').join('')+'</div>':'')+body+pager+'</div>'}});document.getElementById('schedule-days').innerHTML=cards.join('')}}
document.getElementById('schedule-days').addEventListener('click',event=>{{const pick=event.target.closest('[data-daypick]');if(pick){{event.stopPropagation();scheduleDayIndex[pick.dataset.iso]=Number(pick.dataset.daypick);renderDayCards();return}}const nav=event.target.closest('[data-daynav]');if(nav){{event.stopPropagation();const iso=nav.dataset.iso,items=scheduleOrders().filter(i=>scheduleISO(i.date)===iso);if(!items.length)return;let idx=scheduleDayIndex[iso]||0;idx=nav.dataset.daynav==='next'?(idx+1)%items.length:(idx-1+items.length)%items.length;scheduleDayIndex[iso]=idx;renderDayCards();return}}const card=event.target.closest('.schedule-daycard');if(!card)return;const iso=card.dataset.iso;scheduleStatFilter=scheduleStatFilter==='day|'+iso?'all':'day|'+iso;renderSchedule()}});
function scheduleMove(direction){{scheduleDate=scheduleView==='week'?new Date(scheduleDate.getFullYear(),scheduleDate.getMonth(),scheduleDate.getDate()+direction*7):new Date(scheduleDate.getFullYear(),scheduleDate.getMonth()+direction,1);renderSchedule()}}

    function scheduleHeaderIndex(name){{const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();return productionData?productionData.headers.findIndex(header=>normalize(header)===normalize(name)):-1}}
    function scheduleParseDate(value){{const raw=String(value||'').trim().toLowerCase().replaceAll('.','');if(!raw)return null;const parts=raw.split(/[-/ ]+/);if(parts.length<3)return null;const months={{ene:0,enero:0,feb:1,febrero:1,mar:2,marzo:2,abr:3,abril:3,may:4,mayo:4,jun:5,junio:5,jul:6,julio:6,ago:7,agosto:7,sep:8,sept:8,septiembre:8,oct:9,octubre:9,nov:10,noviembre:10,dic:11,diciembre:11}};let day=Number(parts[0]),month=/^[0-9]+$/.test(parts[1])?Number(parts[1])-1:months[parts[1]],year=Number(parts[2]);if(year<100)year+=2000;if(!Number.isInteger(day)||month===undefined||!Number.isInteger(year))return null;const date=new Date(year,month,day);return date.getFullYear()===year&&date.getMonth()===month&&date.getDate()===day?date:null}}
    function scheduleISO(date){{return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}}
    function scheduleNorm(value){{return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()}}
    function scheduleOrders(){{if(!productionData)return[];const headers=productionData.headers,delivery=scheduleHeaderIndex('FECHA DE ENTREGA'),order=scheduleHeaderIndex('ORDEN'),client=scheduleHeaderIndex('NOMBRE DEL CLIENTE'),project=scheduleHeaderIndex('NOMBRE PROYECTO'),quantity=scheduleHeaderIndex('CANTIDAD'),reference=scheduleHeaderIndex('REFERENCIA'),delivered=scheduleHeaderIndex('ENTREGADO');if(delivery<0)return[];const flow=typeof indoorProcessFlow!=='undefined'?indoorProcessFlow:[];const procCols=flow.map(proc=>({{label:proc.label,external:scheduleNorm(proc.label)==='DISENO',cols:proc.headers.flatMap(h=>headers.flatMap((hh,i)=>scheduleNorm(hh)===h?[i]:[]))}})).filter(proc=>proc.cols.length);const grouped=new Map();productionData.rows.forEach(row=>{{const values=row.values||row;const date=scheduleParseDate(values[delivery]);if(!date)return;const orderName=String(values[order]||'SIN ORDEN').trim(),key=scheduleISO(date)+'|'+orderName;let item=grouped.get(key);if(!item){{item={{date,order:orderName,client:String(values[client]||'').trim(),project:String(values[project]||'').trim(),units:0,references:0,delivered:true,cells:procCols.map(()=>[]),sourceRow:row.source_row}};grouped.set(key,item)}}item.delivered=item.delivered&&(delivered>=0&&(!!scheduleParseDate(values[delivered])||scheduleNorm(values[delivered])==='SI'));item.units+=Number(String(values[quantity]||'0').replace(/[^0-9.-]/g,''))||0;if(String(values[reference]||'').trim())item.references++;procCols.forEach((proc,i)=>proc.cols.forEach(c=>item.cells[i].push(scheduleNorm(values[c]))))}});return[...grouped.values()].map(item=>{{const states=procCols.map((proc,i)=>{{const cells=item.cells[i],closed=cells.map(c=>c==='N/A'||!!scheduleParseDate(c));const state=cells.includes('R')?'rework':cells.includes('P')?'active':cells.length&&closed.every(Boolean)?'finished':'pending';return{{label:proc.label,external:proc.external,state}}}});const internal=states.filter(st=>!st.external);const done=internal.filter(st=>st.state==='finished').length;item.states=states;item.percent=internal.length?Math.round(done/internal.length*100):0;item.focus=internal.find(st=>st.state==='rework')||[...internal].reverse().find(st=>st.state==='active')||internal.find(st=>st.state!=='finished');delete item.cells;return item}})}}
function renderSchedule(){{
if(!scheduleGrid||!productionData)return;
const today=scheduleToday(),todayKey=scheduleISO(today),weekStart=new Date(today);weekStart.setDate(today.getDate()-(today.getDay()+6)%7);const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+7);
const all=scheduleOrders(),query=scheduleSearch.value.trim().toLocaleLowerCase('es');let orders=all.filter(item=>!query||(item.order+' '+item.client).toLocaleLowerCase('es').includes(query));
const next7=new Date(today);next7.setDate(today.getDate()+7);
const statDefs=[['all','Todas',all.length,''],['week','Esta semana',all.filter(i=>i.date>=weekStart&&i.date<weekEnd).length,''],['soon','Próximas 7 días',all.filter(i=>i.date>=today&&i.date<next7&&!i.delivered).length,'warn'],['late','Vencidas sin entregar',all.filter(i=>i.date<today&&!i.delivered).length,'bad'],['done','Entregadas',all.filter(i=>i.delivered).length,'good']];
document.querySelector('.schedule-metrics').innerHTML=statDefs.map(([id,label,count,tone])=>'<button type="button" class="schedule-stat '+tone+(scheduleStatFilter===id?' active':'')+(id==='late'&&count>0?' has-value':'')+'" data-stat="'+id+'" aria-pressed="'+(scheduleStatFilter===id)+'"><span>'+label+'</span><strong>'+count+'</strong></button>').join('');
(function renderScheduleStats(){{const weekChart=document.getElementById('schedule-week-chart'),kpisEl=document.getElementById('schedule-stats-kpis');if(!weekChart||!kpisEl)return;const curMonth=scheduleDate.getMonth(),curYear=scheduleDate.getFullYear(),monthOrders=all.filter(i=>i.date.getMonth()===curMonth&&i.date.getFullYear()===curYear);const weeks=[];for(let w=0;w<6;w++){{const ws=new Date(curYear,curMonth,1-((new Date(curYear,curMonth,1).getDay()+6)%7)+w*7),we=new Date(ws);we.setDate(ws.getDate()+7);const inWeek=monthOrders.filter(i=>i.date>=ws&&i.date<we);if(inWeek.length||weeks.length<6)weeks.push({{ws,we,count:inWeek.length,units:inWeek.reduce((s,i)=>s+i.units,0),late:inWeek.filter(i=>i.date<today&&!i.delivered).length,done:inWeek.filter(i=>i.delivered).length}})}}const maxCount=Math.max(1,...weeks.map(w=>w.count));const totalUnits=monthOrders.reduce((s,i)=>s+i.units,0),totalDone=monthOrders.filter(i=>i.delivered).length,totalLate=monthOrders.filter(i=>i.date<today&&!i.delivered).length,pctDone=monthOrders.length?Math.round(totalDone/monthOrders.length*100):0;weekChart.innerHTML=scheduleCalendarHTML(all,today);kpisEl.innerHTML='<div class="sch-kpi"><span>Unidades mes</span><strong>'+totalUnits.toLocaleString("es-CO")+'</strong></div><div class="sch-kpi"><span>Entregados</span><strong class="sch-done">'+totalDone+'</strong></div><div class="sch-kpi"><span>Vencidos</span><strong class="'+(totalLate?'sch-late':'sch-ok')+'">'+totalLate+'</strong></div><div class="sch-kpi"><span>% Cumplimiento</span><div class="sch-progress-wrap"><div class="sch-progress-fill" style="width:'+pctDone+'%"></div><span class="sch-progress-label">'+pctDone+'%</span></div></div>'}})()
const statMatch=item=>{{if(scheduleStatFilter.startsWith('day|'))return scheduleISO(item.date)===scheduleStatFilter.slice(4);if(scheduleStatFilter.startsWith('wk|')){{const ws=new Date(scheduleStatFilter.slice(3)+'T00:00:00'),we=new Date(ws);we.setDate(ws.getDate()+7);return item.date>=ws&&item.date<we}}switch(scheduleStatFilter){{case 'today':return scheduleISO(item.date)===todayKey;case 'week':return item.date>=weekStart&&item.date<weekEnd;case 'month':return item.date.getMonth()===scheduleDate.getMonth()&&item.date.getFullYear()===scheduleDate.getFullYear();case 'soon':return item.date>=today&&item.date<next7&&!item.delivered;case 'late':return item.date<today&&!item.delivered;case 'done':return item.delivered;default:return true}}}};
orders=orders.filter(statMatch);
const filterLabel=scheduleFilterLabel();scheduleFilterPill.innerHTML=filterLabel?'<span>Filtro: <b>'+esc(filterLabel)+'</b></span><button type="button" data-clearfilter>✕ Quitar filtro</button>':'';
renderDayCards();
const cardsMode=true;
document.querySelector('.schedule-weekdays').style.display='none';scheduleGrid.style.display='none';scheduleCards.style.display='grid';
const month=scheduleDate.getMonth(),start=scheduleView==='week'?new Date(scheduleDate):new Date(scheduleDate.getFullYear(),month,1);start.setDate(start.getDate()-(start.getDay()+6)%7);
const days=scheduleView==='week'?7:42,end=new Date(start);end.setDate(start.getDate()+days);const last=new Date(end);last.setDate(last.getDate()-1);
scheduleMonth.textContent='Pedidos en seguimiento';
const visible=orders.filter(i=>i.date>=start&&i.date<end);
if(cardsMode){{const sorted=[...orders].sort((x,y)=>x.date-y.date);scheduleCount.textContent=sorted.length+' pedido'+(sorted.length===1?'':'s')+' coinciden'+(query?' · búsqueda activa':'');const stateColor={{finished:'#8bd450',active:'#6cb6ff',rework:'#ff6b6b',pending:'#4b5648'}},stateLabel={{finished:'Terminado',active:'En proceso',rework:'Reproceso',pending:'Pendiente'}};let lastGroup='';scheduleCards.innerHTML=sorted.length?sorted.map(item=>{{const groupKey=scheduleISO(item.date);let head='';if(groupKey!==lastGroup){{lastGroup=groupKey;const group=sorted.filter(i=>scheduleISO(i.date)===groupKey),diff=Math.round((item.date-today)/86400000),rel=diff===0?'Hoy · ':diff===1?'Mañana · ':diff===-1?'Ayer · ':'';head='<div class="sch-group'+(diff<0?' past':'')+(diff===0?' today':'')+'"><strong>'+rel+scheduleCap(item.date.toLocaleDateString('es-CO',{{weekday:'long',day:'numeric',month:'short'}}))+'</strong><span>'+group.length+' pedido'+(group.length===1?'':'s')+' · '+group.reduce((s,i)=>s+i.units,0).toLocaleString('es-CO')+' und.</span></div>'}}const status=item.delivered?'Entregado':item.date<today?'Vencido':scheduleISO(item.date)===todayKey?'Hoy':'Programado',tone=item.delivered?'done':item.date<today?'late':scheduleISO(item.date)===todayKey?'due':'planned';const dots=(item.states||[]).map(st=>'<i style="background:'+stateColor[st.state]+'" title="'+esc(st.label+': '+stateLabel[st.state])+'"></i>').join('');return head+'<button class="schedule-event schedule-card-item tone-'+tone+'" type="button" data-order="'+esc(item.order)+'" title="Abrir '+esc(item.order)+' · '+esc(item.client)+' en Trazabilidad"><span class="schedule-card-top"><strong>'+esc(item.order)+'</strong><small class="schedule-badge '+tone+'">'+status+'</small></span><span class="schedule-card-client">'+esc(item.client||item.project||'Sin cliente')+'</span><span class="schedule-card-dots">'+dots+'</span><span class="schedule-card-progress"><span><b style="width:'+(item.percent||0)+'%"></b></span><em>'+(item.percent||0)+'%</em></span><span class="schedule-card-focus"><i style="background:'+(item.focus?stateColor[item.focus.state]:'#4b5648')+'"></i>'+(item.focus?esc(item.focus.label)+' · '+stateLabel[item.focus.state]:'Sin proceso pendiente')+'</span><span class="schedule-card-bottom"><span>'+item.date.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}})+'</span><span>'+item.units.toLocaleString('es-CO')+' und.'+(item.references?' · '+item.references+' ref.':'')+'</span></span></button>'}}).join(''):'<p class="schedule-cards-empty">No hay pedidos con este filtro.</p>';return}}
scheduleCount.textContent=visible.length+' pedidos en vista'+(query?' · búsqueda activa':'');
scheduleGrid.classList.toggle('week-view',scheduleView==='week');
scheduleExtras.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===scheduleView)));
document.getElementById('schedule-prev').setAttribute('aria-label','Mes anterior');document.getElementById('schedule-next').setAttribute('aria-label','Mes siguiente');
const byDate=new Map();visible.forEach(item=>{{const key=scheduleISO(item.date);if(!byDate.has(key))byDate.set(key,[]);byDate.get(key).push(item)}});
let html='';for(let n=0;n<days;n++){{const date=new Date(start);date.setDate(start.getDate()+n);const key=scheduleISO(date),events=byDate.get(key)||[];html+='<div class="schedule-day'+(scheduleView==='month'&&date.getMonth()!==month?' outside':'')+(key===todayKey?' today':'')+(events.length>1?' multiple-deliveries':'')+'">'+(events.length>1?'<button type="button" class="schedule-day-total" aria-label="Ver las '+events.length+' entregas">'+events.length+' entregas</button>':'')+'<div class="schedule-day-number">'+date.getDate()+'</div><div class="schedule-events">'+events.map(item=>{{const status=item.delivered?'Entregado':item.date<today?'Vencido':key===todayKey?'Hoy':'Programado',tone=item.delivered?'done':item.date<today?'late':key===todayKey?'due':'planned';return '<button class="schedule-event" type="button" data-order="'+esc(item.order)+'" title="Abrir '+esc(item.order)+' · '+esc(item.client)+' en Trazabilidad"><strong>'+esc(item.order)+'</strong><span class="schedule-client">'+esc(item.client||item.project||'Sin cliente')+'</span><span class="schedule-units">'+item.units.toLocaleString('es-CO')+' <span class="u-full">unidades</span><span class="u-short">u.</span></span><small class="schedule-badge '+tone+'">'+status+'</small></button>'}}).join('')+(!events.length&&scheduleView==='week'?'<span class="schedule-no-orders">Sin entregas</span>':'')+'</div></div>'}}scheduleGrid.innerHTML=html;requestAnimationFrame(fitDeliveryChips);
}}
    async function loadSchedule(){{if(productionData){{renderSchedule();return}}scheduleCount.textContent='Cargando pedidos…';try{{const response=await fetch('/api/produccion'),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo cargar el cronograma');productionData=data;renderSchedule()}}catch(error){{scheduleCount.textContent=error.message;scheduleGrid.innerHTML='<div class="schedule-empty">No fue posible cargar las fechas de los pedidos.</div>'}}}}
    /* Control de operarios: quién trabaja ahora y cuántos procesos cerró hoy */
    const operariosGrid=document.getElementById('operarios-grid'),operariosStatus=document.getElementById('operarios-status'),operariosRefresh=document.getElementById('operarios-refresh'),operariosBusy=document.getElementById('operarios-busy'),operariosIdle=document.getElementById('operarios-idle'),operariosDone=document.getElementById('operarios-done');
    let operariosPending=false,operariosTimer=null;
    /* Mismo listado curado que usan las observaciones de Trazabilidad, para que las
       iniciales de un operario se vean siempre igual en toda la app. */
    const operarioBadgeMap=new Map([
      ['Ediht Johana Londoño','EJ'],['Edith Johana Londoño','EJ'],
      ['Alejandro Mora','AM'],['Alejandro Padilla','AP'],
      ['Andrés López','AL'],['Augusto López','AU'],
      ['Carlos Cáceres','CC'],['Keyner','K'],
      ['Dagoberto Botero','DB'],['Edwin Espinosa','EE'],
      ['Esteban Estrada','ES'],['Hesleidy Londoño','HL'],
      ['Jeison Padilla','JP'],['Julian Ocampo','JO'],
      ['Juliana Diaz','JD'],['Santiago Vásquez','SV'],
      ['Sebastian Gallo','SG'],['Stiven Sánchez','SS'],
      ['Dairo Diaz','DD'],['Yenifer Sánchez Arcila','YS'],
      ['Gloria','G'],['David Hincapie','DH'],
      ['Geovanny Piedrahita','GP'],['AUTOMATIZACION','BOT'],
      ['Daniel Gonzales','DG']
    ].flatMap(([name,initials])=>[[processKey(name),initials],[processKey(initials),initials]]));
    function operatorInitials(name){{
      const assigned=operarioBadgeMap.get(processKey(name));
      if(assigned)return assigned;
      const words=processKey(name).match(/[A-ZÁÉÍÓÚÑ0-9]+/g)||[];
      return words.length?words.map(word=>word[0]).join('').slice(0,3):'—';
    }}
    function operatorBadgeHTML(name){{return '<b class="operarios-badge" title="'+esc(name||'')+'">'+esc(operatorInitials(name))+'</b>'}}
    function operatorAgo(value){{const stamp=Date.parse(value);if(!value||!Number.isFinite(stamp))return'sin registro';const minutes=Math.floor((Date.now()-stamp)/60000);if(minutes<1)return'ahora mismo';if(minutes<60)return'hace '+minutes+' min';const hours=Math.floor(minutes/60);if(hours<24)return'hace '+hours+(hours===1?' hora':' horas');const days=Math.floor(hours/24);if(days===1)return'ayer';if(days<7)return'hace '+days+' días';const moment=new Date(stamp);return moment.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}})+' · '+moment.toLocaleTimeString('es-CO',{{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}})}}
    /* Roster por area, tomado de las columnas de la hoja de produccion. */
    const operariosAreaStats=document.getElementById('operarios-area-stats'),operariosTotal=document.getElementById('operarios-total');
    const operariosDialog=document.getElementById('operarios-dialog'),operariosDialogTitle=document.getElementById('operarios-dialog-title'),operariosDialogKpis=document.getElementById('operarios-dialog-kpis'),operariosDialogBody=document.getElementById('operarios-dialog-body'),operariosDialogMonth=document.getElementById('operarios-dialog-month'),operariosDialogClose=document.getElementById('operarios-dialog-close'),operariosDialogPrev=document.getElementById('operarios-dialog-prev'),operariosDialogNext=document.getElementById('operarios-dialog-next');
    const operariosHoverCalendar=document.getElementById('operarios-hover-calendar');
    const operariosDayFilterSlot=document.getElementById('operarios-day-filter-slot');
    const operatorState={{data:[],daily:{{}},dailyByCode:{{}},dailyActive:{{}},dailyRework:{{}},finished:{{}},byRef:{{}},area:'',year:0,month:0,daysInMonth:30,today:'',sheetAvailable:false,daySearch:'',dayFrom:'',dayTo:'',dayPerson:'',processStatus:{{}}}};
    try{{const saved=JSON.parse(localStorage.getItem('operarios-filtro')||'{{}}');operatorState.dayFrom=saved.from||'';operatorState.dayTo=saved.to||'';operatorState.dayPerson=saved.person||''}}catch(_){{}}
    const saveOperatorFilter=()=>{{try{{localStorage.setItem('operarios-filtro',JSON.stringify({{from:operatorState.dayFrom,to:operatorState.dayTo,person:operatorState.dayPerson}}))}}catch(_){{}}}};
    const plainOperator=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
    /* Respaldo por si Google Sheets no responde: se usa mientras carga o si falla la conexión.
       Cuando la hoja CONTROL OPERARIOS SÍ responde, esta lista se reemplaza con lo que haya ahí. */
    const operatorAreaFallback=[
      {{area:'EDICIÓN',columns:[['SG'],['BOT'],['CO','JD','EE']]}},
      {{area:'IMPRESIÓN',columns:[['SG'],['SV']]}},
      {{area:'SUBLIMACIÓN',columns:[['G'],['CC'],['GP'],['JP']]}},
      {{area:'CORTE LÁSER',columns:[['CC'],['DD'],['ES'],['JP'],['HL'],['G'],['SV'],['SG']]}},
      {{area:'APLIQUES',columns:[['HL']]}},
      {{area:'CONFECCIÓN',columns:[['ALBA'],['ANGELA'],['BLANCA'],['BLANCA EMILSE'],['EUCARIS'],['FANNY'],['GLORIA'],['GLORIA LOPEZ'],['CARMEN'],['JUAN ESTEBAN'],['MIRYAM'],['NOELIA'],['NURY'],['OMAIRA'],['OMAIRA BERGARA'],['PATRICIA'],['SANDRA'],['OFELIA'],['YINI'],['LILIANA'],['YENNY'],['CANDELARIA']]}},
      {{area:'TERMINACIÓN',columns:[['EJ'],['JO'],['DB']]}}
    ];
    let operatorAreaColumns=operatorAreaFallback;
    const operatorAreaOfProcess={{EDICION:'EDICIÓN',IMPRESION:'IMPRESIÓN',SUBLIMACION:'SUBLIMACIÓN','CORTE LASER':'CORTE LÁSER',APLIQUE:'APLIQUES',CONFECCION:'CONFECCIÓN',TERMINACION:'TERMINACIÓN',EMPAQUE:'EMPAQUE'}};
    const operatorCodeByName={{}},operatorNameByCode={{}};
    productionResponsibles.forEach(entry=>{{if(entry[0]&&entry[1]){{operatorCodeByName[processKey(entry[1])]=entry[0];operatorNameByCode[entry[0]]=entry[1]}}}});
    function operatorCode(responsible){{const key=processKey(responsible);if(operatorCodeByName[key])return operatorCodeByName[key];return /^[A-ZÁÉÍÓÚÑ0-9 .'-]{{1,4}}$/.test(key)?key:''}}
    let operariosOpenAreas=['EDICIÓN','IMPRESIÓN','SUBLIMACIÓN','CORTE LÁSER','CONFECCIÓN'];
    /* Reconstruye el reparto por area con lo que realmente hay hoy en la pestaña CONTROL OPERARIOS
       de Google Sheets (columnas y codigos de operario), en vez de la lista fija de respaldo. */
    function applyOperatorSheet(sheet){{
      if(!sheet||!sheet.available||!(sheet.columns||[]).length)return false;
      const byArea=new Map();
      sheet.columns.forEach(col=>{{
        if(!col.area||!col.code)return;
        if(!byArea.has(col.area))byArea.set(col.area,new Map());
        const codes=byArea.get(col.area);
        if(!codes.has(col.code))codes.set(col.code,[col.code]);
      }});
      if(!byArea.size)return false;
      operatorAreaColumns=[...byArea.entries()].map(([area,codes])=>({{area,columns:[...codes.values()]}}));
      operariosOpenAreas=(sheet.areas&&sheet.areas.length)?sheet.areas:operatorAreaColumns.map(item=>item.area);
      return true;
    }}
    function operatorTodayTotal(code,todayKey){{const byCode=operatorState.dailyByCode||{{}};return((byCode[code]||{{}})[todayKey])||0}}
    function operatorDayKey(year,month,day){{return year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0')}}
    function renderOperators(data){{
      const operators=(data&&data.operators)||[],daily=(data&&data.daily)||{{}};
      const sheet=(data&&data.sheet)||{{}},dailyByCode=sheet.daily_by_code||{{}};
      const dailyActive=(data&&data.daily_active)||{{}},dailyRework=(data&&data.daily_rework)||{{}};
      const sheetAvailable=applyOperatorSheet(sheet);
      const busy=operators.filter(item=>item.current);
      const todayKey=(data&&data.today)||'';
      const finished=(data&&data.finished_by_process)||{{}};
      const processStatus=(data&&data.process_status)||{{}};
      operatorState.data=operators;operatorState.daily=daily;operatorState.dailyByCode=dailyByCode;operatorState.dailyActive=dailyActive;operatorState.dailyRework=dailyRework;operatorState.finished=finished;operatorState.today=todayKey;operatorState.sheetAvailable=sheetAvailable;operatorState.processStatus=processStatus;
      operatorState.byRef={{}};
      const byRef=operatorState.byRef;
      operators.forEach(item=>{{const key=processKey(item.responsible);if(key)byRef[key]=item;const code=operatorCode(item.responsible);if(code)byRef[code]=item}});
      let totalPeople=0,totalWorking=0,totalDone=0;
      const seenCodes=new Set();
      operatorState.areaDetails={{}};
      const cards=operariosOpenAreas.map((label,index)=>{{
        const group=operatorAreaColumns.find(item=>processKey(item.area)===processKey(label));
        if(!group)return '';
        const people=[];
        group.columns.forEach(column=>column.forEach(member=>{{
          const record=byRef[processKey(member)],name=record?record.responsible:(operatorNameByCode[member]||member);
          if(!people.some(entry=>processKey(entry.name)===processKey(name)))people.push({{name:name,member:member,record:record}});
        }}));
        const working=people.filter(entry=>entry.record&&entry.record.current).length;
        const closed=people.reduce((sum,entry)=>{{
          if(sheetAvailable)return sum+operatorTodayTotal(entry.member,todayKey);
          return sum+(entry.record?(Number(entry.record.today_count)||0):0);
        }},0);
        totalPeople+=people.length;totalWorking+=working;totalDone+=closed;
        people.forEach(entry=>seenCodes.add(processKey(entry.member)));
        operatorState.areaDetails[label]={{working:working,total:people.length,closed:closed,people:people}};
        const pct=people.length?Math.round(working/people.length*100):0;
        return '<button class="operarios-openarea'+(working?' is-busy':'')+'" type="button" data-area="'+esc(label)+'"><span class="operarios-openarea-head"><span class="operarios-openarea-name">'+esc(label)+'</span><span class="operarios-openarea-count">'+working+'/'+people.length+'</span></span><span class="operarios-openarea-bar"><i style="width:'+pct+'%"></i></span><span class="operarios-openarea-foot"><span>'+people.length+' operario'+(people.length===1?'':'s')+'</span><span><b>'+closed+'</b> hoy</span></span></button>';
      }});
      operariosTotal.textContent=String(totalPeople||operators.length);
      operariosBusy.textContent=String(totalWorking||busy.length);
      operariosIdle.textContent=String(Math.max(0,(totalPeople||operators.length)-(totalWorking||busy.length)));
      operariosDone.textContent=String(totalDone);
      operariosGrid.innerHTML=cards.filter(Boolean).join('')||'<p class="operarios-empty">Todavía no hay procesos configurados.</p>';
      operariosStatus.dataset.sheet=sheetAvailable?'ok':(sheet.error?'error':'sin-datos');
      operariosStatus.title=sheetAvailable?'Cantidades tomadas de Google Sheets · CONTROL OPERARIOS':(sheet.error?'No se pudo leer Google Sheets: '+sheet.error+'. Mostrando lo que registra la app.':'');
      const keepArea=operariosHover.dataset.area&&operariosOpenAreas.includes(operariosHover.dataset.area)?operariosHover.dataset.area:operariosOpenAreas[operariosHoverIndex]||operariosOpenAreas[0];
      if(keepArea)showOperatorsHoverArea(keepArea);
    }}
    /* Al pasar el mouse (o el foco, para teclado) sobre un area, se ve aqui mismo
       quien la integra, quien esta trabajando ahora mismo y cuanto ha cerrado hoy. */
    /* El botón de arriba recorre las áreas con las flechas; abajo (operarios-hover-calendar)
       se ve el calendario completo del área elegida, sin tener que abrir el diálogo. */
    const operariosHover=document.getElementById('operarios-hover'),operariosHoverPrev=document.getElementById('operarios-hover-prev'),operariosHoverNext=document.getElementById('operarios-hover-next');
    let operariosHoverIndex=0;
    function ensureOperatorsMonth(){{
      if(operatorState.year)return;
      const now=new Date();
      operatorState.year=now.getFullYear();operatorState.month=now.getMonth();
      operatorState.daysInMonth=new Date(operatorState.year,operatorState.month+1,0).getDate();
    }}
    function showOperatorsHoverIndex(index){{
      if(!operariosOpenAreas.length)return;
      operariosHoverIndex=((index%operariosOpenAreas.length)+operariosOpenAreas.length)%operariosOpenAreas.length;
      showOperatorsHoverArea(operariosOpenAreas[operariosHoverIndex]);
    }}
    function showOperatorsHoverArea(area){{
      const info=operatorState.areaDetails&&operatorState.areaDetails[area];
      operariosHover.dataset.area=area;
      operariosHover.classList.toggle('has-data',!!info);
      const count=operariosOpenAreas.length,position=operariosOpenAreas.indexOf(area);
      if(position>=0)operariosHoverIndex=position;
      operariosHover.querySelector('.operarios-hover-title').textContent=area+(count>1?' · '+(operariosHoverIndex+1)+'/'+count:'');
      const detail=operariosHover.querySelector('.operarios-hover-detail');
      if(!info){{detail.textContent='Cargando…'}}
      else{{
        const working=info.people.filter(entry=>entry.record&&entry.record.current);
        detail.textContent=info.working+'/'+info.total+' trabajando · '+info.closed+' hoy'+(working.length?' · '+working.map(entry=>entry.name).join(', '):'');
      }}
      ensureOperatorsMonth();
      operatorState.area=area;
      renderOperatorsCalendar();
    }}
    operariosHoverPrev.addEventListener('click',()=>showOperatorsHoverIndex(operariosHoverIndex-1));
    operariosHoverNext.addEventListener('click',()=>showOperatorsHoverIndex(operariosHoverIndex+1));
    operariosGrid.addEventListener('mouseover',event=>{{const card=event.target.closest('.operarios-openarea');if(card)showOperatorsHoverArea(card.dataset.area)}});
    operariosGrid.addEventListener('focusin',event=>{{const card=event.target.closest('.operarios-openarea');if(card)showOperatorsHoverArea(card.dataset.area)}});
    function renderOperatorsCalendar(){{
      const group=operatorAreaColumns.find(item=>processKey(item.area)===processKey(operatorState.area));
      if(!group)return;
      const byRef=operatorState.byRef,daily=operatorState.daily,dailyByCode=operatorState.dailyByCode||{{}},sheetAvailable=operatorState.sheetAvailable;
      const dailyActive=operatorState.dailyActive||{{}},dailyRework=operatorState.dailyRework||{{}};
      const roster=[];
      group.columns.forEach(column=>column.forEach(member=>{{
        const record=byRef[processKey(member)],name=record?record.responsible:(operatorNameByCode[member]||member);
        if(!roster.some(entry=>processKey(entry.name)===processKey(name)))roster.push({{name:name,member:member,record:record}});
      }}));

      const year=operatorState.year,month=operatorState.month,total=operatorState.daysInMonth;
      const todayKey=operatorState.today||operatorDayKey(year,month,Math.min(new Date().getDate(),total));
      operariosDialogMonth.textContent=new Date(year,month,1).toLocaleDateString('es-CO',{{month:'long',year:'numeric'}});

      /* En proceso (P) y en reproceso (R) por operario: para hoy se usa la foto EN VIVO del
         estado actual de los pedidos en Produccion (lo mas exacto, porque un P/R de hoy puede
         cambiar en cualquier momento); para dias anteriores se usa el historial de cuando se
         marco Iniciar/Reproceso ese dia. Se calcula antes que "days" porque un operario puede
         estar trabajando hoy sin haber cerrado nada todavia (count=0). */
      const statusMap=operatorState.processStatus||{{}};
      const statusKey=Object.keys(statusMap).find(key=>processKey(key)===processKey(group.area));
      const byResponsible=(statusKey&&statusMap[statusKey].by_responsible)||{{}};
      const responsibleKeys=Object.keys(byResponsible);
      function personExtraStats(name){{
        const key=responsibleKeys.find(item=>processKey(item)===processKey(name));
        return key?byResponsible[key]:null;
      }}

      // Rango de días: el mes que se muestra, o EXACTAMENTE el rango elegido en Desde/Hasta (puede cruzar meses).
      const pickFrom=operatorState.dayFrom||'',pickTo=operatorState.dayTo||'';
      const parseDay=value=>{{const parts=String(value).split('-').map(Number);return new Date(parts[0],parts[1]-1,parts[2])}};
      let rangeStart=new Date(year,month,1),rangeEnd=new Date(year,month,total);
      if(pickFrom||pickTo){{
        const one=parseDay(pickFrom||pickTo);
        rangeStart=pickFrom?parseDay(pickFrom):new Date(one.getFullYear(),one.getMonth(),1);
        rangeEnd=pickTo?parseDay(pickTo):new Date(one.getFullYear(),one.getMonth()+1,0);
        if(rangeEnd<rangeStart){{const swap=rangeStart;rangeStart=rangeEnd;rangeEnd=swap}}
        if((rangeEnd-rangeStart)/86400000>400)rangeEnd=new Date(rangeStart.getFullYear(),rangeStart.getMonth(),rangeStart.getDate()+400);
      }}
      const periodLabel=(pickFrom||pickTo)?rangeStart.toLocaleDateString('es-CO',{{day:'numeric',month:'short'}})+' – '+rangeEnd.toLocaleDateString('es-CO',{{day:'numeric',month:'short',year:'numeric'}}):new Date(year,month,1).toLocaleDateString('es-CO',{{month:'long',year:'numeric'}});
      operariosDialogMonth.textContent=periodLabel;
      const dayDates=[];
      for(const cursor=new Date(rangeStart);cursor<=rangeEnd;cursor.setDate(cursor.getDate()+1))dayDates.push(new Date(cursor));
      const days=dayDates.map(date=>{{
        const day=date.getDate(),key=operatorDayKey(date.getFullYear(),date.getMonth(),day);
        const isToday=key===todayKey;
        const peopleMap=new Map();
        let matchedActive=0,matchedRework=0;
        roster.forEach(entry=>{{
          const count=sheetAvailable?((dailyByCode[entry.member]||{{}})[key]||0):((daily[entry.name]||{{}})[key]||0);
          const extra=isToday?personExtraStats(entry.name):null;
          const active=isToday?(extra&&extra.active_units||0):((dailyActive[entry.name]||{{}})[key]||0);
          const rework=isToday?(extra&&extra.rework_units||0):((dailyRework[entry.name]||{{}})[key]||0);
          if(isToday){{matchedActive+=active;matchedRework+=rework}}
          if(count<=0&&active<=0&&rework<=0)return;
          const codeKey=entry.member||entry.name;
          if(peopleMap.has(codeKey)){{const p=peopleMap.get(codeKey);p.count+=count;p.active+=active;p.rework+=rework}}
          else peopleMap.set(codeKey,{{name:entry.name,record:entry.record,count:count,active:active,rework:rework}});
        }});
        /* Lo que este EN VIVO en "P"/"R" pero cuya fila no tiene el RESP... diligenciado no
           se le puede atribuir a ningun operario del roster: igual debe contarse, para que el
           total que se ve aqui hoy coincida con lo que muestra el filtro Reproceso/En proceso
           de Trazabilidad. Se agrupa como "Sin asignar". */
        if(isToday){{
          const bucket=statusKey?statusMap[statusKey]:null;
          const leftoverActive=Math.max(0,((bucket&&bucket.active_units)||0)-matchedActive);
          const leftoverRework=Math.max(0,((bucket&&bucket.rework_units)||0)-matchedRework);
          if(leftoverActive>0||leftoverRework>0)peopleMap.set('__unassigned',{{name:'Sin asignar',record:null,count:0,active:leftoverActive,rework:leftoverRework}});
        }}
        const people=Array.from(peopleMap.values()).sort((a,b)=>b.count-a.count);
        return {{day:day,date:date,key:key,people:people,total:people.reduce((sum,entry)=>sum+entry.count,0)}};
      }}).filter(entry=>pickFrom||pickTo||entry.people.length>0||entry.key===todayKey).reverse();
      /* Meta de produccion: 10.000 unidades al mes POR AREA (asi esta calculado en la propia
         hoja de Google Sheets, pestana CONTROL OPERARIOS: cada area se mide contra su propia
         meta de 10.000, no la suma de toda la fabrica). */
      const OPERATORS_MONTHLY_GOAL=10000;
      const monthUnits=sheetAvailable?days.reduce((sum,entry)=>sum+entry.total,0):0;
      const goalPct=Math.round(monthUnits/OPERATORS_MONTHLY_GOAL*100);
      const goalEl=document.getElementById('operarios-goal');
      goalEl.classList.toggle('over-goal',goalPct>=100);
      document.getElementById('operarios-goal-label').textContent='Unidades del mes · '+group.area;
      document.getElementById('operarios-goal-count').textContent=monthUnits.toLocaleString('es-CO')+' / '+OPERATORS_MONTHLY_GOAL.toLocaleString('es-CO');
      document.getElementById('operarios-goal-fill').style.width=Math.min(100,goalPct)+'%';
      document.getElementById('operarios-goal-pct').textContent=sheetAvailable?goalPct+'% de la meta del mes':'Sin datos de Google Sheets para calcular la meta.';
      if(!roster.length){{
        const emptyMsg='<p class="operarios-cal-empty">Este proceso no tiene operarios asignados.</p>';
        operariosDialogBody.innerHTML=emptyMsg;operariosDialogKpis.innerHTML='';
        operariosHoverCalendar.innerHTML='<h3 class="operarios-hover-cal-title">'+esc(group.area)+'</h3>'+emptyMsg;
        return;
      }}
      const from=operatorState.dayFrom||'',to=operatorState.dayTo||'',personQuery=plainOperator(operatorState.dayPerson);
      const search=from||to||personQuery;
      const visibleDays=days.filter(entry=>(!from||entry.key>=from)&&(!to||entry.key<=to)).map(entry=>{{
        if(!personQuery)return entry;
        const people=entry.people.filter(person=>plainOperator(person.name).includes(personQuery)||plainOperator(operatorInitials(person.name))===personQuery||plainOperator(operatorInitials(person.name)).startsWith(personQuery));
        return {{...entry,people,total:people.reduce((sum,person)=>sum+(person.count||0),0)}};
      }}).filter(entry=>!personQuery||entry.people.length||pickFrom||pickTo);
      const cards=visibleDays.map(entry=>{{
        const moment=entry.date;
        const dowFull=moment.toLocaleDateString('es-CO',{{weekday:'long'}}).toUpperCase();
        const monthFull=moment.toLocaleDateString('es-CO',{{month:'long'}}).toUpperCase();
        const isToday=entry.key===todayKey;
        const list=entry.people.length
          ?'<ul class="operarios-daylist">'+entry.people.map(person=>{{
              const stats=person.count>0?['<span class="op-stat op-stat-done"><i class="op-stat-icon">✓</i>'+person.count.toLocaleString('es-CO')+' unds</span>']:[];
              if(person.active)stats.push('<span class="op-stat op-stat-active"><i class="op-stat-icon">P</i>'+person.active.toLocaleString('es-CO')+' unds</span>');
              if(person.rework)stats.push('<span class="op-stat op-stat-rework"><i class="op-stat-icon">R</i>'+person.rework.toLocaleString('es-CO')+' unds</span>');
              return '<li>'+operatorBadgeHTML(person.name)+'<span class="operarios-daylist-stats">'+stats.join('')+'</span></li>';
            }}).join('')+'</ul>'
          :'<p class="operarios-daynone">Sin cierres</p>';
        return '<article class="operarios-daycard'+(isToday?' is-today':'')+'"><div class="operarios-daycard-head"><span class="operarios-daycard-num">'+entry.day+'</span><span class="operarios-daycard-date"><b>'+esc(dowFull)+'</b><small>'+esc(monthFull)+'</small></span><span class="operarios-daycard-total">Total '+entry.total+' unds</span></div>'+list+'</article>';
      }}).join('');
      const legendHTML='<div class="operarios-legend"><span class="op-stat op-stat-done"><i class="op-stat-icon">✓</i>Terminado</span><span class="op-stat op-stat-active"><i class="op-stat-icon">P</i>En proceso</span><span class="op-stat op-stat-rework"><i class="op-stat-icon">R</i>Reproceso</span><small class="operarios-legend-source">Datos reales · Google Sheets</small></div>';
      const kpisHTML='<div><span>Operarios</span><strong>'+roster.length+'</strong></div><div><span>Trabajando</span><strong>'+roster.filter(entry=>entry.record&&entry.record.current).length+'</strong></div><div><span>Días con registro</span><strong>'+days.filter(entry=>entry.total>0).length+'</strong></div><div><span>Procesos del mes</span><strong>'+days.reduce((sum,entry)=>sum+entry.total,0)+'</strong></div>';
      const bodyHTML=cards?legendHTML+'<div class="operarios-days">'+cards+'</div>':legendHTML+'<p class="operarios-cal-empty">'+(search?'No hay registros con esos filtros (operario / fechas).':'No hay procesos cerrados en este mes.')+'</p>';
      operariosDialogKpis.innerHTML=kpisHTML;
      operariosDialogBody.innerHTML=bodyHTML;
      const minDate=year+'-'+String(month+1).padStart(2,'0')+'-01';
      const maxDate=year+'-'+String(month+1).padStart(2,'0')+'-'+String(total).padStart(2,'0');
      const names=[...new Set(days.flatMap(entry=>entry.people.map(person=>person.name)))].sort();
      const filterHTML='<div class="operarios-day-filter-row" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end"><label class="op-filter-field" style="display:grid;gap:4px;font:800 10px Arial;letter-spacing:.06em;color:#aebaa8;text-transform:uppercase;flex:1 1 140px">Operario<input type="search" id="operarios-person-filter" class="operarios-day-filter" list="operarios-person-list" value="'+esc(operatorState.dayPerson||'')+'" placeholder="Nombre"><datalist id="operarios-person-list">'+names.map(name=>'<option value="'+esc(name)+'"></option>').join('')+'</datalist></label><label class="op-filter-field" style="display:grid;gap:4px;font:800 10px Arial;letter-spacing:.06em;color:#aebaa8;text-transform:uppercase;flex:1 1 140px">Desde<input type="date" id="operarios-day-from" class="operarios-day-filter" value="'+esc(from)+'" ></label><label class="op-filter-field" style="display:grid;gap:4px;font:800 10px Arial;letter-spacing:.06em;color:#aebaa8;text-transform:uppercase;flex:1 1 140px">Hasta<input type="date" id="operarios-day-to" class="operarios-day-filter" value="'+esc(to)+'"></label><button type="button" id="operarios-day-filter-apply" class="operarios-day-filter-apply" style="align-self:flex-end;flex:0 0 auto!important;width:auto!important;min-height:36px!important;padding:6px 14px!important;border:0;border-radius:9px;background:#d0f44c;color:#15200b;font:900 12px Arial;cursor:pointer;white-space:nowrap">Aplicar filtro</button><button type="button" id="operarios-day-filter-clear" class="operarios-day-filter-clear"'+(search?'':' hidden')+'>Ver todo</button></div>';
      // Los filtros se dibujan UNA sola vez: si la pantalla se actualiza sola mientras tienes el calendario abierto o
      // estás escribiendo, no se tocan (antes se redibujaban y se cerraba el calendario).
      if(!operariosDayFilterSlot.querySelector('#operarios-day-from')){{operariosDayFilterSlot.innerHTML=filterHTML}}
      else{{
        const list=operariosDayFilterSlot.querySelector('#operarios-person-list');
        const options=names.map(name=>'<option value="'+esc(name)+'"></option>').join('');
        if(list&&list.innerHTML!==options)list.innerHTML=options;
        const clear=operariosDayFilterSlot.querySelector('#operarios-day-filter-clear');
        if(clear)clear.hidden=!search;
      }}
      operariosHoverCalendar.innerHTML='<h3 class="operarios-hover-cal-title">'+esc(group.area)+' <small>'+esc(periodLabel)+'</small></h3><div class="operarios-dialog-kpis">'+kpisHTML+'</div>'+bodyHTML;
    }}
    function applyOperatorFilter(){{
      const from=(document.getElementById('operarios-day-from')||{{}}).value||'',to=(document.getElementById('operarios-day-to')||{{}}).value||'';
      const person=((document.getElementById('operarios-person-filter')||{{}}).value||'').trim();
      operatorState.dayFrom=from;operatorState.dayTo=to;operatorState.dayPerson=person;
      const anchor=from||to;
      if(anchor){{const parts=anchor.split('-').map(Number);operatorState.year=parts[0];operatorState.month=parts[1]-1;operatorState.daysInMonth=new Date(parts[0],parts[1],0).getDate()}}
      saveOperatorFilter();
      renderOperatorsCalendar();
    }}
    operariosDayFilterSlot.addEventListener('keydown',event=>{{
      if(event.target.id==='operarios-person-filter'&&event.key==='Enter'){{event.preventDefault();applyOperatorFilter()}}
    }});
    operariosDayFilterSlot.addEventListener('click',event=>{{
      if(event.target.closest('#operarios-day-filter-apply')){{applyOperatorFilter();return}}
      if(!event.target.closest('#operarios-day-filter-clear'))return;
      operatorState.dayFrom='';operatorState.dayTo='';operatorState.dayPerson='';
      {{const now=new Date();operatorState.year=now.getFullYear();operatorState.month=now.getMonth();operatorState.daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate()}}
      ['operarios-day-from','operarios-day-to','operarios-person-filter'].forEach(id=>{{const input=document.getElementById(id);if(input)input.value=''}});
      saveOperatorFilter();
      renderOperatorsCalendar();
    }});
    function openOperatorsArea(area){{
      showOperatorsHoverArea(area);
      const group=operatorAreaColumns.find(item=>processKey(item.area)===processKey(area));
      operariosDialogTitle.textContent=group?group.area:area;
      operariosDialog.showModal();
    }}
    operariosGrid.addEventListener('click',event=>{{
      const button=event.target.closest('.operarios-openarea');
      if(button)openOperatorsArea(button.dataset.area);
    }});
    operariosDialogClose.addEventListener('click',()=>operariosDialog.close());
    operariosDialogPrev.addEventListener('click',()=>{{
      operatorState.month-=1;
      if(operatorState.month<0){{operatorState.month=11;operatorState.year-=1}}
      operatorState.daysInMonth=new Date(operatorState.year,operatorState.month+1,0).getDate();
      renderOperatorsCalendar();
    }});
    operariosDialogNext.addEventListener('click',()=>{{
      operatorState.month+=1;
      if(operatorState.month>11){{operatorState.month=0;operatorState.year+=1}}
      operatorState.daysInMonth=new Date(operatorState.year,operatorState.month+1,0).getDate();
      renderOperatorsCalendar();
    }});
    async function loadOperators(){{
      if(operariosPending)return;operariosPending=true;
      operariosRefresh.disabled=true;operariosRefresh.textContent='Actualizando…';
      if(!operariosGrid.children.length)operariosStatus.textContent='Cargando operarios…';
      try{{
        const response=await fetch('/api/produccion/operarios',{{cache:'no-store'}}),data=await response.json();
        if(!response.ok)throw new Error(data.detail||'No se pudieron consultar los operarios');
        renderOperators(data);
        operariosStatus.textContent='Actualizado a las '+new Date().toLocaleTimeString('es-CO',{{hour:'numeric',minute:'2-digit',timeZone:'America/Bogota'}});
      }}catch(error){{
        operariosStatus.textContent=error.message;
        if(!operariosGrid.children.length)operariosGrid.innerHTML='<p class="operarios-empty">No fue posible cargar la información de los operarios.</p>';
      }}finally{{operariosPending=false;operariosRefresh.disabled=false;operariosRefresh.textContent='Actualizar'}}
    }}
    function startOperatorsAutoRefresh(){{clearInterval(operariosTimer);operariosTimer=setInterval(()=>{{if(document.hidden||!document.body.classList.contains('operarios-mode'))return;loadOperators()}},5000)}}
    operariosRefresh.addEventListener('click',loadOperators);
    document.getElementById('operarios-report').addEventListener('click',()=>{{
      const pad=number=>String(number).padStart(2,'0');
      let from=operatorState.dayFrom,to=operatorState.dayTo;
      if(!from&&!to&&operatorState.year){{from=operatorState.year+'-'+pad(operatorState.month+1)+'-01';to=operatorState.year+'-'+pad(operatorState.month+1)+'-'+pad(operatorState.daysInMonth)}}
      else if(from||to){{from=from||to;to=to||from}}
      const query=new URLSearchParams();if(from)query.set('desde',from);if(to)query.set('hasta',to);
      if(operatorState.dayPerson)query.set('operario',operatorState.dayPerson);
      window.location.href='/api/produccion/operarios/informe?'+query.toString();
    }});
    operariosGrid.addEventListener('click',async event=>{{
      const button=event.target.closest('.operarios-open');
      if(!button)return;
      const order=button.dataset.order;
      if(!order)return;
      button.disabled=true;
      try{{
        const response=await fetch('/api/produccion/proceso-orden?order='+encodeURIComponent(order)),data=await response.json();
        if(!response.ok)throw new Error(data.detail||'No se pudo consultar el proceso');
        selectedProcess=processKey(data.process);
        localStorage.setItem('indoor-production-process',selectedProcess);
        exactScheduleOrder=order;productionSearch.value=order;
        orderProgress.hidden=false;
        orderProgress.textContent=order+' · '+(data.process?(data.basis.startsWith('finished')?'Último proceso terminado: ':'En proceso: ')+data.process:'Sin proceso en curso ni fecha de terminado');
        productionTableWrap.scrollLeft=0;productionTableWrap.scrollTop=0;productionXScroll.scrollLeft=0;
        document.getElementById('production-toggle').closest('.nav-group').classList.remove('collapsed');
        document.querySelector('.tab[data-kind="produccion"]').click();
        await loadProduction();renderProduction();
      }}catch(error){{alert(error.message)}}finally{{button.disabled=false}}
    }});
    startOperatorsAutoRefresh();
    operariosDialog.addEventListener('close',()=>{{operatorState.area=''}});
    document.addEventListener('visibilitychange',()=>{{if(!document.hidden&&document.body.classList.contains('operarios-mode'))loadOperators()}});
    window.addEventListener('focus',()=>{{if(document.body.classList.contains('operarios-mode'))loadOperators()}});
document.getElementById('schedule-prev').addEventListener('click',()=>scheduleMove(-1));document.getElementById('schedule-next').addEventListener('click',()=>scheduleMove(1));document.getElementById('schedule-today').addEventListener('click',()=>{{scheduleDate=scheduleToday();renderSchedule()}});async function handleScheduleEventClick(event){{const button=event.target.closest('.schedule-event');if(!button)return;button.disabled=true;try{{const response=await fetch('/api/produccion/proceso-orden?order='+encodeURIComponent(button.dataset.order)),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo consultar el proceso');orderProgress.hidden=false;orderProgress.textContent=button.dataset.order+' · '+(data.process?(data.basis.startsWith('finished')?'Último proceso terminado: ':'En proceso: ')+data.process:'Sin proceso en curso ni fecha de terminado');selectedProcess=processKey(data.process);localStorage.setItem('indoor-production-process',selectedProcess);exactScheduleOrder=button.dataset.order;productionSearch.value=button.dataset.order;productionTableWrap.scrollLeft=0;productionTableWrap.scrollTop=0;productionXScroll.scrollLeft=0;document.getElementById('production-toggle').closest('.nav-group').classList.remove('collapsed');document.querySelector('.tab[data-kind="produccion"]').click();renderProduction()}}catch(error){{alert(error.message)}}finally{{button.disabled=false}}}}scheduleGrid.addEventListener('click',handleScheduleEventClick);scheduleCards.addEventListener('click',handleScheduleEventClick);loadSchedule();
const scheduleStyle=document.createElement('style');scheduleStyle.textContent=`
body.schedule-mode{{overflow-y:auto}}
body.schedule-mode .schedule-toolbar{{padding:18px 24px}}
.schedule-extras{{padding:14px 20px;background:#171b18;border-bottom:1px solid #343b34}}
.schedule-days-block{{margin:14px 20px 0;display:grid;gap:8px}}.schedule-days-nav{{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}}.schedule-days-nav .schedule-overview-title{{display:flex;align-items:baseline;gap:8px}}.schedule-days-nav .schedule-overview-title small{{font-weight:400;color:#7a8f7a;text-transform:none;letter-spacing:0;font-size:11px}}.schedule-days-actions{{display:flex;gap:6px}}.schedule-days-actions button{{width:auto;min-width:32px;padding:6px 10px;font-size:.72rem;background:#171e14;color:#efffb0;border:1px solid rgba(208,244,76,.38);border-radius:8px;box-shadow:none}}.schedule-days-actions button:hover{{border-color:var(--lime);filter:none}}.schedule-days-actions button[aria-pressed=true]{{background:rgba(208,244,76,.16);color:var(--lime)}}.schedule-days{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}.schedule-daycard{{display:grid;grid-template-rows:auto auto 1fr auto;gap:10px;width:100%;min-height:300px;padding:14px;background:#1b211a;border:1px solid #3a423a;border-radius:14px;box-shadow:none;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}}.schedule-daycard:hover{{border-color:#7f9a6d;transform:translateY(-1px)}}.schedule-daycard.is-today{{border-color:#899967}}.schedule-daycard.active{{border-color:var(--lime);background:#232e18;box-shadow:0 0 0 1px var(--lime)}}.schedule-daycard-head{{display:flex;align-items:baseline;gap:7px}}.schedule-daycard-dow{{font-size:10px;color:#8fa385;text-transform:uppercase;letter-spacing:.04em}}.schedule-daycard-num{{font-size:13px;color:#c4cec2;font-weight:700}}.schedule-daycard-head b{{margin-left:auto;font-size:11px;font-weight:700;color:#8fa385;background:#0f120d;border-radius:999px;padding:1px 8px}}.schedule-daycard-mockup{{height:150px;border-radius:9px;overflow:hidden;background:#f5f7f3;padding:6px;box-sizing:border-box;display:flex;align-items:center;justify-content:center}}.schedule-daycard-mockup img{{width:100%;height:100%;object-fit:contain;display:block}}.schedule-daycard-mockup.empty{{background:#0f120d;text-align:center;font-size:11px;color:#5f6c5a;padding:8px}}.schedule-daycard-fields{{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}}.schedule-daycard-fields div{{display:grid;gap:1px;min-width:0}}.schedule-daycard-fields span{{font-size:9px;color:#7a8f7a;text-transform:uppercase;letter-spacing:.04em}}.schedule-daycard-fields b{{font-size:13px;color:#f1f5ed;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.schedule-daycard-empty{{min-height:150px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#5f6c5a;border:1px dashed #333c33;border-radius:9px}}.schedule-daycard-progress{{display:grid;gap:6px;padding-top:8px;border-top:1px solid #2a3128}}.schedule-daycard-pager{{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:6px;border-top:1px solid #2a3128}}.schedule-daycard-pager button{{width:26px;height:26px;min-height:0;padding:0;display:grid;place-items:center;background:#0f120d;border:1px solid #3a423a;border-radius:8px;color:#dfe7d8;box-shadow:none;font-size:14px;line-height:1}}.schedule-daycard-pager button:hover{{border-color:var(--lime);filter:none}}.schedule-daycard-pager span{{font-size:11px;color:#8fa385}}@media(max-width:700px){{.schedule-days{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}.schedule-overview{{margin:14px 20px 0;padding:16px 18px;background:#12160f;border:1px solid #2d352a;border-radius:16px;display:grid;gap:14px}}.schedule-overview .schedule-extras{{padding:0;background:none;border:0}}.schedule-overview-title{{margin:0;font-size:12px;color:#93a68a;text-transform:uppercase;letter-spacing:.08em;font-weight:700}}.schedule-metrics{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}}button.schedule-stat{{display:flex;flex-direction:column;gap:3px;width:100%;min-height:0;padding:12px 16px;background:#1b211a;border:1px solid #3a423a;border-radius:12px;box-shadow:none;text-align:left;transition:border-color .15s,background .15s,transform .15s}}button.schedule-stat:hover{{border-color:#7f9a6d;filter:none;transform:translateY(-1px)}}button.schedule-stat span{{font-size:11px;color:#a9b4a4;text-transform:uppercase;letter-spacing:.04em}}button.schedule-stat strong{{font-size:24px;color:#f3f5f2;line-height:1.15}}button.schedule-stat.warn strong{{color:#ffc36b}}button.schedule-stat.bad strong{{color:#ff8a8a}}button.schedule-stat.good strong{{color:#a6e26d}}button.schedule-stat.active{{border-color:var(--lime);background:#232e18;box-shadow:0 0 0 1px var(--lime)}}button.schedule-stat.active span{{color:#d9e6c9}}
button.schedule-stat.has-value strong{{color:#f3b9af}}button.schedule-stat.has-value{{animation:sch-pulse 2s ease-in-out infinite}}
@keyframes sch-pulse{{0%,100%{{opacity:1}}50%{{opacity:.65}}}}
.schedule-cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;padding:14px 20px 18px;overflow:auto}}button.schedule-card-item{{display:grid;gap:7px;width:auto;min-height:0;padding:12px 13px;background:#171b18;border:1px solid #333c33;border-left:3px solid #4a5348;border-radius:10px;box-shadow:none;text-align:left;align-content:start}}button.schedule-card-item:hover{{border-color:#7f9a6d;filter:none;background:#1d231c}}.schedule-card-top{{display:flex;justify-content:space-between;align-items:center;gap:8px}}.schedule-card-top strong{{font-size:13px;color:#f1f5ed}}.schedule-card-client{{font-size:12px;color:#c1cbbd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.schedule-card-dots{{display:flex;gap:3px}}.schedule-card-dots i{{flex:1;height:6px;border-radius:3px}}.schedule-card-progress{{display:flex;align-items:center;gap:8px}}.schedule-card-progress span{{flex:1;height:6px;border-radius:4px;background:#232b21;overflow:hidden}}.schedule-card-progress b{{display:block;height:100%;background:var(--lime);border-radius:4px}}.schedule-card-progress em{{font-style:normal;font-size:11px;color:#c4cec2}}.schedule-card-focus{{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#d5dccf}}.schedule-card-focus i{{width:8px;height:8px;border-radius:50%;flex-shrink:0}}.schedule-card-bottom{{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#a3aea0}}p.schedule-cards-empty{{grid-column:1/-1;color:#8a9587;font-size:13px;padding:20px 4px}}
.schedule-filters{{display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between}}.schedule-filters input{{width:min(440px,65%);padding:10px 12px;background:#222723;border:1px solid #485047;border-radius:8px;color:white;font:inherit;font-size:14px}}.schedule-view{{display:flex;gap:5px}}.schedule-view button{{width:auto;padding:9px 18px;background:#232924;border:1px solid #465044;color:#c9d2c5;box-shadow:none}}.schedule-view button[aria-pressed=true]{{background:#3a4630;color:#f1f6e9;border-color:#899967}}
.schedule-stats-bar{{display:grid;gap:12px;padding:14px 16px;background:#171c15;border:1px solid #2d352a;border-radius:12px}}
.sch-chart-title{{font-size:11px;color:#8fa385;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}}
.schedule-stats-chart{{min-width:0}}.sch-week-cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px}}.sch-week-card{{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 6px;background:#0f120d;border:1px solid #263123;border-radius:10px}}.sch-week-label{{font-size:10px;color:#8fa385;text-transform:uppercase;letter-spacing:.05em}}.sch-week-card strong{{font-size:20px;color:#e8f0e2;line-height:1.2}}.sch-week-units{{font-size:10px;color:#7a8f7a}}.sch-week-warn{{font-size:10px;color:#f5a97f;font-weight:700}}.sch-week-current{{border-color:var(--lime);background:#182210}}.sch-week-current .sch-week-label{{color:#c8e89a;font-weight:700}}.sch-week-late{{border-color:#5a352f}}
.schedule-stats-kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:14px;padding-top:2px}}
.sch-kpi{{display:flex;flex-direction:column;gap:3px;padding:8px 12px;background:#0f120d;border-radius:10px}}.sch-kpi span{{font-size:10px;color:#8fa385;text-transform:uppercase;letter-spacing:.05em}}.sch-kpi strong{{font-size:19px;color:#e8f0e2;line-height:1}}
.sch-done{{color:#9fe87a!important}}.sch-late{{color:#f5a97f!important}}.sch-ok{{color:#9fe87a!important}}
.sch-progress-wrap{{position:relative;width:80px;height:8px;background:#263228;border-radius:4px;overflow:hidden;margin-top:2px}}
.sch-progress-fill{{height:100%;background:linear-gradient(90deg,#4d9e30,#88cc50);border-radius:4px;transition:width .5s ease}}
.sch-progress-label{{position:absolute;top:-1px;left:0;width:100%;font-size:9px;color:#c8e89a;text-align:center;line-height:10px}}
body.schedule-mode .schedule-grid{{grid-template-rows:repeat(6,minmax(84px,auto))}}
body.schedule-mode .schedule-grid.week-view{{grid-template-rows:minmax(330px,auto)}}
body.schedule-mode .schedule-day{{background:#171b18;padding:6px 7px;min-height:84px}}
body.schedule-mode .schedule-day.outside{{background:#111512}}
body.schedule-mode .schedule-day.today{{box-shadow:inset 0 0 0 1px #a2b878}}
body.schedule-mode .schedule-events{{max-height:150px;display:flex;flex-direction:column;gap:5px;overflow:auto}}
body.schedule-mode .week-view .schedule-events{{max-height:55vh}}
body.schedule-mode .schedule-event{{background:#252c27;border:1px solid #424b41;border-radius:7px;padding:6px 7px;text-align:left;white-space:normal;flex-shrink:0;box-shadow:none}}
body.schedule-mode .schedule-event:hover{{background:#303a31;border-color:#8a9c79}}
body.schedule-mode .schedule-event strong{{font-size:12px;color:#f1f5ed;line-height:1.3}}
body.schedule-mode .schedule-event span{{display:block;white-space:normal;font-size:12px;line-height:1.45;margin-top:4px;color:#c1cbbd;overflow-wrap:anywhere}}
body.schedule-mode .schedule-event .schedule-units{{color:#a3aea0;font-size:11px}}
.schedule-badge{{display:inline-block;margin-top:8px;padding:2px 6px;border-radius:4px;background:#353e36;color:#c4cec2;font-size:10px}}
.schedule-badge.late{{background:#49302e;color:#f3b9af}}.schedule-badge.due{{background:#49422d;color:#ead99e}}.schedule-badge.done{{background:#294239;color:#bbd9cb}}
.schedule-no-orders{{font-size:12px;color:#798477;padding-top:12px}}
body.schedule-mode .schedule-day-number{{font-size:13px}}
@media(max-width:700px){{.schedule-metrics{{grid-template-columns:repeat(2,1fr);gap:8px}}button.schedule-stat strong{{font-size:20px}}body.schedule-mode .schedule-grid.week-view{{display:flex;flex-direction:column}}body.schedule-mode .week-view .schedule-day{{min-height:100px}}body.schedule-mode .schedule-event{{padding:6px}}body.schedule-mode .schedule-event strong{{font-size:11px}}body.schedule-mode .schedule-event span{{font-size:10px}}.schedule-extras{{padding:12px}}.schedule-view button{{padding:8px}}.schedule-filters input{{min-width:0}}}}
`;document.head.appendChild(scheduleStyle);
    const scheduleFitStyle=document.createElement('style');scheduleFitStyle.textContent=`
html:has(body.schedule-mode),html body.schedule-mode{{overflow:hidden!important;height:100dvh}}
body.schedule-mode main{{padding-bottom:0!important}}
body.schedule-mode .footer-note{{display:none}}
body.schedule-mode .schedule-shell{{display:grid;grid-template-rows:auto auto auto auto auto minmax(0,1fr);height:var(--schedule-height,calc(100dvh - 150px));min-height:0;overflow:hidden!important}}
body.schedule-mode .schedule-toolbar{{padding:9px 16px;gap:8px}}
body.schedule-mode .schedule-title .eyebrow,body.schedule-mode .schedule-title p{{display:none}}
body.schedule-mode .schedule-title h2{{font-size:18px;margin:0}}
body.schedule-mode .schedule-actions button{{padding:6px 10px;min-width:36px}}
body.schedule-mode .schedule-days-block{{margin:10px 16px 0}}body.schedule-mode .schedule-overview{{margin:10px 16px 0;padding:12px 14px;gap:10px}}body.schedule-mode .schedule-extras{{display:grid;gap:8px;padding:0}}body.schedule-mode .schedule-filters{{justify-content:flex-end}}
body.schedule-mode .schedule-metrics{{margin:0;gap:20px;flex-wrap:nowrap}}
body.schedule-mode .schedule-metrics strong{{font-size:18px}}
body.schedule-mode .schedule-filters{{flex:0 1 320px;min-width:0}}
body.schedule-mode .schedule-filters input{{width:100%;padding:7px 10px}}
body.schedule-mode .schedule-summary{{padding:6px 16px}}
body.schedule-mode .schedule-stats-bar{{padding:10px 12px;gap:8px;min-height:0}}
body.schedule-mode .schedule-stats-chart{{min-width:0}}
body.schedule-mode .sch-bars{{height:52px}}
body.schedule-mode .sch-bar-fill{{max-width:24px}}
body.schedule-mode .sch-bar-num{{font-size:8px}}
body.schedule-mode .sch-chart-title{{margin-bottom:2px;font-size:9px}}
body.schedule-mode .sch-kpi strong{{font-size:15px}}
body.schedule-mode .schedule-grid{{min-height:0;overflow:hidden;grid-template-rows:repeat(6,minmax(0,1fr))!important}}
body.schedule-mode .schedule-day{{display:flex;flex-direction:column;min-height:0;height:100%;padding:4px 6px;overflow:hidden}}
body.schedule-mode .schedule-day-number{{flex:0 0 18px;height:18px;margin-bottom:2px;font-size:12px}}
@media(max-width:860px){{body.schedule-mode .sidebar{{transform:translateX(-105%)}}body.schedule-mode.menu-open .sidebar{{transform:translateX(0)}}body.schedule-mode main{{margin-left:0!important;width:100%;padding:68px 7px 0!important}}body.schedule-mode .brand{{position:fixed;top:4px;left:64px;right:7px;width:auto}}}}
@media(max-height:500px) and (min-width:621px){{body.schedule-mode .brand{{display:none}}body.schedule-mode main{{padding-top:4px!important}}body.schedule-mode .schedule-toolbar{{padding-left:65px}}}}
body.schedule-mode .schedule-events{{flex:1;min-height:0;max-height:none!important;gap:4px;overflow-y:auto!important;overscroll-behavior:contain}}
body.schedule-mode .schedule-event{{padding:4px 6px;text-align:center}}
body.schedule-mode .schedule-event strong{{font-size:12px}}
body.schedule-mode .schedule-event span{{font-size:11px;margin-top:1px;line-height:1.2}}
body.schedule-mode .schedule-event .schedule-client{{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
body.schedule-mode .schedule-badge{{margin-top:3px;font-size:9px}}
@media(max-width:700px){{
body.schedule-mode .schedule-extras{{display:block;padding:5px 8px}}
body.schedule-mode .schedule-metrics{{justify-content:space-between;gap:6px;margin-bottom:4px}}
body.schedule-mode .schedule-metrics>div{{gap:5px}}
body.schedule-mode .schedule-metrics span{{font-size:10px}}
body.schedule-mode .schedule-metrics strong{{font-size:15px}}
body.schedule-mode .schedule-filters input{{font-size:16px;padding:4px 8px}}
body.schedule-mode .schedule-toolbar{{padding:6px 8px;display:flex;flex-direction:row}}
body.schedule-mode .schedule-title h2{{font-size:15px}}
body.schedule-mode .schedule-summary{{padding:4px 8px}}
body.schedule-mode .schedule-summary strong{{font-size:12px}}
body.schedule-mode .schedule-summary span{{font-size:9px}}
body.schedule-mode .schedule-day{{padding:2px}}
body.schedule-mode .schedule-event{{padding:3px 2px}}
body.schedule-mode .schedule-event strong{{font-size:9px;white-space:normal;overflow-wrap:anywhere}}
body.schedule-mode .schedule-event span{{font-size:9px}}
body.schedule-mode .schedule-event .schedule-units{{font-size:8px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}}
body.schedule-mode .schedule-events{{scrollbar-gutter:auto;scrollbar-width:thin}}
body.schedule-mode .schedule-badge{{font-size:8px;padding:1px 2px}}
}}
`;document.head.appendChild(scheduleFitStyle);
    const deliveryChipStyle=document.createElement('style');deliveryChipStyle.textContent=`
body.schedule-mode .schedule-day{{position:relative}}
body.schedule-mode .schedule-events{{overflow:hidden!important;scrollbar-gutter:auto}}
body.schedule-mode .schedule-events{{display:grid;grid-template-columns:repeat(auto-fit,minmax(85px,1fr));grid-auto-rows:max-content;align-content:start;gap:3px}}
body.schedule-mode .schedule-event{{padding:3px;min-width:0;height:auto;border-radius:5px}}
body.schedule-mode .schedule-event strong{{font-size:11px;white-space:nowrap}}
body.schedule-mode .schedule-event span{{display:block;font-size:10px;line-height:1.15;margin-top:2px}}
body.schedule-mode .schedule-event .schedule-client{{white-space:normal;overflow-wrap:anywhere}}
body.schedule-mode .schedule-badge{{display:inline-block;margin-top:2px;font-size:8px}}
.schedule-day-total{{position:absolute;top:3px;left:5px;width:auto;padding:0 3px;border:0;background:transparent;color:#cdddbb;font-size:10px;line-height:18px;box-shadow:none;cursor:pointer}}
.schedule-deliveries-dialog{{width:min(520px,94vw);max-height:85dvh;overflow:auto;background:#1b211c;color:#eef3e9;border:1px solid #647456;border-radius:14px;padding:20px}}
.schedule-deliveries-dialog::backdrop{{background:#000a}}
.schedule-deliveries-dialog h2{{font-size:18px;margin-bottom:15px}}
.schedule-deliveries-dialog .schedule-event{{display:block;text-align:center;margin-top:8px;width:100%}}
.schedule-deliveries-close{{width:auto;float:right;background:#323b2c;color:#fff;padding:5px 10px;box-shadow:none}}
@media(max-width:700px){{body.schedule-mode .schedule-events{{grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;gap:2px}}body.schedule-mode .schedule-event{{height:auto;padding:2px}}body.schedule-mode .schedule-event strong{{font-size:9px}}body.schedule-mode .schedule-event span{{font-size:9px}}body.schedule-mode .multiple-deliveries .schedule-day-number{{margin-bottom:15px}}.schedule-day-total{{top:20px;left:1px;font-size:8px;line-height:13px;padding:0}}}}
`;document.head.appendChild(deliveryChipStyle);
    const simpleDeliveryStyle=document.createElement('style');simpleDeliveryStyle.textContent='body.schedule-mode .schedule-event .schedule-client,body.schedule-mode .schedule-event .schedule-badge{{display:none!important}}body.schedule-mode .schedule-event{{text-align:center}}body.schedule-mode .schedule-event .schedule-units{{display:block;white-space:normal;font-size:10px;line-height:1.25;margin-top:2px}}';document.head.appendChild(simpleDeliveryStyle);
    function fitDeliveryChips(){{document.querySelectorAll('.multiple-deliveries .schedule-events').forEach(list=>{{const buttons=[...list.children];buttons.forEach(button=>button.style.visibility='');const bottom=list.getBoundingClientRect().bottom;buttons.forEach(button=>{{if(button.getBoundingClientRect().bottom>bottom+1)button.style.visibility='hidden'}})}})}}window.addEventListener('resize',()=>requestAnimationFrame(fitDeliveryChips));new ResizeObserver(fitDeliveryChips).observe(scheduleGrid);
    const deliveriesDialog=document.createElement('dialog');deliveriesDialog.className='schedule-deliveries-dialog';deliveriesDialog.innerHTML='<button type="button" class="schedule-deliveries-close" aria-label="Cerrar entregas">×</button><h2>Entregas del día</h2><div class="schedule-deliveries-list"></div>';document.body.appendChild(deliveriesDialog);deliveriesDialog.querySelector('.schedule-deliveries-close').onclick=()=>deliveriesDialog.close();let deliverySourceButtons=[];scheduleGrid.addEventListener('click',event=>{{const total=event.target.closest('.schedule-day-total');if(!total)return;deliverySourceButtons=[...total.closest('.schedule-day').querySelectorAll('.schedule-event')];deliveriesDialog.querySelector('h2').textContent=total.textContent+' · día '+total.closest('.schedule-day').querySelector('.schedule-day-number').textContent;const list=deliveriesDialog.querySelector('.schedule-deliveries-list');list.replaceChildren();deliverySourceButtons.forEach(source=>{{const clone=source.cloneNode(true);clone.style.visibility='';clone.onclick=()=>{{deliveriesDialog.close();source.click()}};list.appendChild(clone)}});deliveriesDialog.showModal()}});
    let scheduleFitFrame=0;function fitScheduleViewport(){{if(scheduleFitFrame)return;scheduleFitFrame=requestAnimationFrame(()=>{{scheduleFitFrame=0;if(!document.body.classList.contains('schedule-mode'))return;const shell=document.querySelector('.schedule-shell'),viewport=window.visualViewport,top=shell.getBoundingClientRect().top,bottom=viewport?viewport.height+viewport.offsetTop:window.innerHeight;shell.style.setProperty('--schedule-height',Math.max(0,Math.min(1300,Math.floor(bottom-top-6)))+'px')}})}}window.addEventListener('resize',fitScheduleViewport);window.visualViewport?.addEventListener('resize',fitScheduleViewport);new MutationObserver(fitScheduleViewport).observe(document.body,{{attributes:true,attributeFilter:['class']}});new ResizeObserver(fitScheduleViewport).observe(document.querySelector('.brand'));fitScheduleViewport();
    let realtimeSyncBusy=false;async function syncProductionRealtime(){{if(realtimeSyncBusy||document.hidden||productionDraggedRow||productionBody.querySelector('.is-editing'))return;realtimeSyncBusy=true;try{{const response=await fetch('/api/produccion',{{cache:'no-store'}});if(!response.ok)return;const data=await response.json(),changed=!productionData||data.updated_at!==productionData.updated_at||data.rows.length!==productionData.rows.length||JSON.stringify(data.notes||{{}})!==JSON.stringify(productionData.notes||{{}});if(!changed)return;productionData=data;const active=document.querySelector('.tab.active')?.dataset.kind;if(active==='produccion'){{renderProduction();productionStatus.textContent='✓ Datos sincronizados automáticamente'}}else if(active==='cronograma')renderSchedule()}}catch(error){{console.warn('Sincronización pendiente',error)}}finally{{realtimeSyncBusy=false}}}}setInterval(syncProductionRealtime,3000);document.addEventListener('visibilitychange',()=>{{if(!document.hidden)syncProductionRealtime()}});window.addEventListener('focus',syncProductionRealtime);
    const userArea=document.querySelector('.systems');userArea.innerHTML=`<details class="user-menu"><summary><span class="user-avatar">{escape(user_initials)}</span><span class="user-info"><strong>{escape(user_display)}</strong><small>{escape(user_process)}</small></span><span aria-hidden="true">▾</span></summary><div class="user-dropdown"><p>{escape(user_process)}</p><button type="button" id="open-profile">Mi perfil</button><button type="button" id="open-name">Cambiar nombre</button><button type="button" id="open-password">Cambiar contraseña</button><a href="/logout">Cerrar sesión</a></div></details>`;
    const accountDialog=document.createElement('dialog');accountDialog.className='account-dialog';accountDialog.innerHTML=`<button type="button" class="account-close" aria-label="Cerrar">×</button><h2 id="account-title">Mi perfil</h2><section id="account-profile"><p>Nombre</p><strong>{escape(user_display)}</strong><p>Proceso</p><strong>{escape(user_process)}</strong></section><form id="account-name" hidden><label>Nuevo nombre<input name="name" type="text" autocomplete="name" required maxlength="80" value="{escape(str(_))}"></label><label>Contraseña actual<input name="current" type="password" autocomplete="new-password" required maxlength="256"></label><p class="account-hint">Este nombre es el que aparece en Producción al registrar actividad; si otras personas ya lo usan para asignarte procesos, avísales del cambio.</p><button type="submit">Guardar nombre</button></form><form id="account-password" hidden><label>Contraseña actual<input name="current" type="password" autocomplete="new-password" required maxlength="256"></label><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="6" maxlength="256" required></label><label>Confirmar contraseña<input name="confirm" type="password" autocomplete="new-password" minlength="6" maxlength="256" required></label><button type="submit">Guardar contraseña</button></form><p id="account-message" role="status"></p>`;document.body.appendChild(accountDialog);
    function openAccount(mode){{document.querySelector('.user-menu').open=false;document.getElementById('account-title').textContent=mode==='name'?'Cambiar nombre':mode==='password'?'Cambiar contraseña':'Mi perfil';document.getElementById('account-profile').hidden=mode!=='profile';document.getElementById('account-name').hidden=mode!=='name';document.getElementById('account-password').hidden=mode!=='password';document.getElementById('account-name').reset();document.getElementById('account-password').reset();document.getElementById('account-message').textContent='';accountDialog.showModal()}}document.getElementById('open-profile').onclick=()=>openAccount('profile');document.getElementById('open-name').onclick=()=>openAccount('name');document.getElementById('open-password').onclick=()=>openAccount('password');accountDialog.querySelector('.account-close').onclick=()=>accountDialog.close();document.addEventListener('click',event=>{{if(!event.target.closest('.user-menu'))document.querySelector('.user-menu').open=false}});document.addEventListener('keydown',event=>{{if(event.key==='Escape')document.querySelector('.user-menu').open=false}});
    document.getElementById('account-name').onsubmit=async event=>{{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),message=document.getElementById('account-message'),button=form.querySelector('button'),name=String(fields.get('name')||'').trim();if(name.length<2){{message.textContent='Escribe un nombre válido.';return}}button.disabled=true;try{{const response=await fetch('/api/cuenta/nombre',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{name:name,password:fields.get('current')}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar');message.textContent='Nombre actualizado. Recargando…';setTimeout(()=>location.reload(),900)}}catch(error){{message.textContent=error.message;button.disabled=false}}}};
    document.getElementById('account-password').onsubmit=async event=>{{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),message=document.getElementById('account-message'),button=form.querySelector('button');if(fields.get('password')!==fields.get('confirm')){{message.textContent='Las contraseñas no coinciden.';return}}button.disabled=true;try{{const response=await fetch('/api/cuenta/password',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{current:fields.get('current'),password:fields.get('password')}})}}),data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar');form.reset();message.textContent='Contraseña actualizada correctamente.'}}catch(error){{message.textContent=error.message}}finally{{button.disabled=false}}}};
const traceViewBar=document.createElement('div');traceViewBar.className='trace-view-bar';traceViewBar.innerHTML='<span>Vista</span><button type="button" data-trace-view="cards">Tarjetas</button><button type="button" data-trace-view="table">Tabla</button>';
document.querySelector('.production-process-filter').appendChild(traceViewBar);
const traceScheduleButton=document.createElement('button');traceScheduleButton.type='button';traceScheduleButton.className='production-refresh';traceScheduleButton.id='trace-schedule-order';traceScheduleButton.textContent='+ Programar pedido';traceScheduleButton.onclick=()=>{{document.getElementById('commercial-toggle').closest('.nav-group').classList.remove('collapsed');document.querySelector('.tab[data-kind="pedido"]').click();document.getElementById('order-form').scrollIntoView({{block:'start',behavior:'smooth'}})}};traceViewBar.after(traceScheduleButton);
const traceCards=document.createElement('div');traceCards.className='trace-cards';traceCards.hidden=true;productionTableWrap.after(traceCards);
const traceDetail=document.createElement('dialog');traceDetail.className='trace-detail';traceDetail.innerHTML='<button type="button" class="trace-close" aria-label="Cerrar detalle">×</button><div class="trace-detail-content"></div>';document.body.appendChild(traceDetail);traceDetail.querySelector('.trace-close').onclick=()=>traceDetail.close();
const canViewAdministration={json.dumps(' '.join(str(user_process).casefold().split()) in ('administración', 'administracion', 'administrativa', 'administrativo', 'coordinador', 'comercial', 'comerciales', 'asistente comercial', 'asistentes comerciales'))};
let traceView='cards';
const traceAssets=new Map(),traceAssetBusy=new Set();
const traceDesignSelection=new Map();
function traceField(row,name){{const index=scheduleHeaderIndex(name);return index>=0?String(row.values[index]||''):''}}
function traceOpenTable(sourceRow){{openOperatorProduction(Number(sourceRow))}}
function setTraceView(){{if(traceView==='table'&&!canViewAdministration)traceView='cards';localStorage.setItem('indoor-trace-view',traceView);document.body.classList.toggle('trace-cards-mode',traceView==='cards');traceCards.hidden=traceView!=='cards';traceViewBar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.traceView===traceView)));if(traceView==='cards')renderTraceCards();else requestAnimationFrame(()=>{{freezeProductionColumns();fitProductionHeight()}})}}
traceViewBar.querySelectorAll('button').forEach(b=>b.onclick=()=>{{traceView=b.dataset.traceView;setTraceView()}});
function traceAssetsMarkup(sourceRow){{const asset=traceAssets.get(sourceRow);if(!asset)return '<span>Buscando diseño…</span>';if(asset.error)return '<span>'+esc(asset.error)+'</span><button type="button" data-card-retry="'+sourceRow+'">Reintentar</button>';if(!asset.images.length)return '<div class="trace-no-design"><span aria-hidden="true">◇</span><strong>Sin diseño adjunto</strong><small>'+esc(asset.image_status||'Información del pedido disponible')+'</small></div>';const images=asset.images,selected=Math.min(traceDesignSelection.get(Number(sourceRow))||0,images.length-1),current=images[selected];const total=images.length,prev=(selected-1+total)%total,next=(selected+1)%total;return '<div class="trace-design-view"><div class="trace-design-stage"><a class="trace-design-main" href="'+esc(current.url)+'" target="_blank" rel="noopener" title="Ampliar diseño del listado Excel"><img loading="lazy" src="'+esc(current.url)+'" alt="'+esc(current.name)+'"></a><span class="trace-design-count">DISEÑO '+(current.design||selected+1)+(total>1?' <small>· '+(selected+1)+'/'+total+'</small>':'')+'</span><span class="trace-design-zoom" aria-hidden="true">⤢</span>'+(total>1?'<button type="button" class="trace-design-nav is-prev" data-design-row="'+sourceRow+'" data-design-index="'+prev+'" aria-label="Diseño anterior">‹</button><button type="button" class="trace-design-nav is-next" data-design-row="'+sourceRow+'" data-design-index="'+next+'" aria-label="Diseño siguiente">›</button>':'')+'</div><div class="trace-design-tabs" aria-label="Diseños del pedido">'+images.map((image,i)=>'<button type="button" data-design-row="'+sourceRow+'" data-design-index="'+i+'" aria-pressed="'+(i===selected)+'">D'+(image.design||i+1)+'</button>').join('')+'</div></div>'}}
function paintTraceAssets(sourceRow){{const card=traceCards.querySelector('[data-card-row="'+sourceRow+'"]');if(card){{card.querySelector('.trace-media').innerHTML=traceAssetsMarkup(sourceRow);const tabs=card.querySelector('.trace-design-tabs'),on=tabs&&tabs.querySelector('[aria-pressed=true]');if(on)tabs.scrollLeft=on.offsetLeft-(tabs.clientWidth-on.offsetWidth)/2}}}}
async function loadTraceAssets(sourceRow,force=false){{if((traceAssets.has(sourceRow)&&!force)||traceAssetBusy.has(sourceRow))return;traceAssetBusy.add(sourceRow);let changed=false;try{{const response=await fetch('/api/produccion/fila/'+sourceRow+'/archivos',{{cache:'no-store'}});const data=await response.json();if(!response.ok)throw Error(data.detail||'No se pudo consultar el NAS');if(JSON.stringify(traceAssets.get(sourceRow))!==JSON.stringify(data)){{traceAssets.set(sourceRow,data);changed=true}}}}catch(error){{if(!traceAssets.has(sourceRow)){{traceAssets.set(sourceRow,{{error:error.message}});changed=true}}}}finally{{traceAssetBusy.delete(sourceRow);if(changed)paintTraceAssets(sourceRow)}}}}
let traceSyncBusy=false;
async function syncTraceMockups(){{if(traceSyncBusy||document.hidden||traceCards.hidden||document.querySelector('.tab.active')?.dataset.kind!=='produccion')return;traceSyncBusy=true;try{{const bounds=traceCards.getBoundingClientRect(),rows=[...traceCards.querySelectorAll('[data-card-row]')].filter(card=>{{const r=card.getBoundingClientRect();return r.bottom>Math.max(0,bounds.top)&&r.top<Math.min(innerHeight,bounds.bottom)}}).map(card=>Number(card.dataset.cardRow));for(let i=0;i<rows.length;i+=2){{if(document.hidden||traceCards.hidden)break;await Promise.all(rows.slice(i,i+2).map(id=>loadTraceAssets(id,true)))}}}}finally{{traceSyncBusy=false}}}}
setInterval(syncTraceMockups,15000);window.addEventListener('focus',syncTraceMockups);document.addEventListener('visibilitychange',()=>{{if(!document.hidden)syncTraceMockups()}});
const traceImageObserver=new IntersectionObserver(entries=>{{entries.filter(e=>e.isIntersecting).forEach(e=>{{loadTraceAssets(Number(e.target.dataset.cardRow));traceImageObserver.unobserve(e.target)}})}},{{root:traceCards,rootMargin:'100px'}});
const traceExpandedProcesses=new Set();
traceCards.addEventListener('click',event=>{{const summary=event.target.closest('.trace-process summary');if(!summary)return;const detail=summary.parentElement;traceCards.querySelectorAll('.trace-process[open]').forEach(other=>{{if(other!==detail){{other.open=false;traceExpandedProcesses.delete(other.dataset.processKey)}}}});const info=detail.querySelector('.trace-process-info');if(!info.querySelector('.trace-node-title')){{const title=document.createElement('h4');title.className='trace-node-title';title.textContent=summary.querySelector('strong').textContent+' · '+summary.querySelector('small').textContent;info.prepend(title)}}}});
document.addEventListener('click',event=>{{if(event.target.closest('.trace-process'))return;traceCards.querySelectorAll('.trace-process[open]').forEach(detail=>{{detail.open=false;traceExpandedProcesses.delete(detail.dataset.processKey)}})}});
traceViewBar.hidden=true;
const adminGroup=document.createElement('div');adminGroup.className='nav-group collapsed';adminGroup.innerHTML='<button class="nav-parent" type="button"><span class="nav-icon">AD</span><span>ADMINISTRACIÓN</span></button><div class="nav-children"><button class="tab" data-kind="produccion" data-admin-summary="true" type="button"><span class="nav-icon">RP</span><strong>PEDIDOS</strong></button></div>';document.querySelector('nav.tabs').appendChild(adminGroup);adminGroup.querySelector('.nav-parent').onclick=()=>{{adminGroup.classList.toggle('collapsed');if(!adminGroup.classList.contains('collapsed'))adminGroup.querySelector('.nav-children .tab')?.click()}};
const traceNav=document.querySelector('.tab.production-nav'),adminNav=adminGroup.querySelector('.tab');
traceNav.addEventListener('click',()=>{{traceView='cards';setTraceView();document.body.classList.remove('admin-summary-mode')}});
adminNav.onclick=()=>{{if(!canViewAdministration)return;traceNav.click();document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===adminNav));traceView='table';setTraceView();document.body.classList.add('admin-summary-mode');adminGroup.classList.remove('collapsed')}};
const commercialMenu=commercialToggle.closest('.nav-group');
commercialMenu.querySelectorAll('.nav-children > .tab').forEach(tab=>adminGroup.querySelector('.nav-children').appendChild(tab));
let carteraLoaded=false;
commercialMenu.hidden=true;commercialMenu.style.display='none';
traceScheduleButton.hidden=!canViewAdministration;
traceScheduleButton.onclick=()=>{{if(!canViewAdministration)return;adminGroup.classList.remove('collapsed');adminGroup.querySelector('[data-kind="pedido"]').click();document.getElementById('order-form').scrollIntoView({{block:'start',behavior:'smooth'}})}};
if(!canViewAdministration)adminGroup.remove();
const inventoryRenderSummaryTable=inventoryRender;
inventoryRender=()=>{{
  if(!inventoryData)return;
  const query=inventorySearch.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),rows=inventoryData.items.filter(item=>{{const matchesCategory=!inventoryCategory||item.categoria===inventoryCategory,haystack=(item.nombre+' '+item.categoria_label+' '+Object.values(item.campos||{{}}).join(' ')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return matchesCategory&&(!query||haystack.includes(query))}}),selected=inventoryData.categories.find(category=>category.key===inventoryCategory);
  const cardName=item=>{{const match=String(item.nombre||'').match(/^\s*\(([^)]+)\)\s*(.*)$/),colors=/\s+(BLANCO|NEGRO|AMARILLO|AZUL|ROJO|VERDE|GRIS|NARANJA|MORADO|ROSADO|BEIGE|CAFE|CAFÉ|CAMO|CAMUFLADO|PLATA|DORADO)\s*$/i,raw=(match?match[2]:String(item.nombre||'')),colorMatch=raw.match(colors);return {{code:match?match[1]:'',name:raw.replace(colors,'').trim(),color:colorMatch?colorMatch[1].toUpperCase():''}}}};
  const numericValue=value=>{{const text=String(value??'').trim();if(!text)return NaN;return Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text.replace(/\./g,''))}};
  inventoryStatus.textContent=`${{rows.length}} de ${{inventoryData.summary.items}} referencias${{inventoryCategory?' · '+(selected?.label||inventoryCategory):''}}`;inventoryCategories.querySelectorAll('[data-inventory-category]').forEach(card=>card.classList.toggle('active',card.dataset.inventoryCategory===inventoryCategory));
}};
const indoorProcessFlow={json.dumps(PROCESS_FLOW, ensure_ascii=False)};
const operatorHeaders=new Set(indoorProcessFlow.flatMap(p=>p.headers));
const operatorDialog=document.createElement('dialog');operatorDialog.className='operator-dialog';operatorDialog.innerHTML='<form id="operator-form"><button type="button" class="operator-close" aria-label="Cerrar">×</button><h2>Producción</h2><p class="operator-order"></p><label>Proceso<select name="column" required></select></label><p class="operator-current"></p><label>Responsable / iniciales<input name="responsible" required maxlength="80" autocomplete="off"></label><label>Motivo u observación<textarea name="reason" maxlength="2000" rows="3" placeholder="Obligatorio para reproceso"></textarea></label><div class="operator-actions"><button name="action" value="start" type="submit">Iniciar / retomar</button><button name="action" value="rework" type="submit">Reproceso</button><button name="action" value="finish" type="submit">Terminar</button><button name="action" value="na" type="submit">No aplica</button><button name="action" value="clear" type="submit">Cambiar estado</button></div><p class="operator-message" role="status"></p></form><h3>Historial de actividad</h3><div class="operator-history"></div>';document.body.appendChild(operatorDialog);
const mtsDialog=document.createElement('dialog');mtsDialog.className='operator-dialog';mtsDialog.innerHTML='<button type="button" class="operator-close" aria-label="Cerrar">×</button><h2>Ingresar MTS REQUERIDOS</h2><p class="mts-order"></p><p class="mts-current-val"></p><label>Metros requeridos<input class="mts-input" type="text" inputmode="decimal" autocomplete="off" maxlength="30" placeholder="Ej: 145.5"></label><div class="operator-actions" style="grid-template-columns:1fr 1fr"><button class="mts-save" type="button">Guardar</button><button class="mts-cancel" type="button" style="background:#2a3550;color:#c9d6f5">Cancelar</button></div><p class="mts-msg" role="status"></p>';document.body.appendChild(mtsDialog);
let mtsTarget=null;mtsDialog.querySelector('.operator-close').onclick=()=>mtsDialog.close();mtsDialog.querySelector('.mts-cancel').onclick=()=>mtsDialog.close();
mtsDialog.querySelector('.mts-save').onclick=async()=>{{if(!mtsTarget)return;const inp=mtsDialog.querySelector('.mts-input'),value=inp.value.trim(),msg=mtsDialog.querySelector('.mts-msg'),saveBtn=mtsDialog.querySelector('.mts-save');msg.textContent='Guardando…';saveBtn.disabled=true;try{{const noteValue=value+(value.trim().toUpperCase().includes('MTS')?'':' MTS');const resp=await fetch('/api/produccion/nota',{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{row:mtsTarget.sourceRow,column:mtsTarget.colIdx+1,note:noteValue}})}});const data=await resp.json();if(!resp.ok)throw new Error(data.detail||'Error al guardar');if(!productionData.notes)productionData.notes={{}};productionData.notes[mtsTarget.sourceRow+':'+(mtsTarget.colIdx+1)]=noteValue;msg.textContent='✓ Guardado';setTimeout(()=>{{mtsDialog.close();renderTraceCards();}},600);}}catch(e){{msg.textContent='Error: '+e.message;}}finally{{saveBtn.disabled=false;}}}};
let operatorRow=null,operatorExpected='',operatorSaving=false;
const operatorForm=operatorDialog.querySelector('form');
operatorForm.elements.responsible.readOnly=true;
operatorForm.elements.responsible.closest('label').firstChild.textContent='Responsable · usuario conectado';
operatorDialog.querySelector('.operator-close').onclick=()=>{{if(!operatorSaving)operatorDialog.close()}};operatorDialog.addEventListener('cancel',e=>{{if(operatorSaving)e.preventDefault()}});
function operatorSelection(){{const row=productionData.rows.find(r=>r.source_row===operatorRow),i=Number(operatorForm.elements.column.value)-1;if(!row||i<0)return;operatorExpected=String(row.values[i]||'');operatorDialog.querySelector('.operator-current').textContent='Estado actual: '+(operatorExpected?displayProductionDate(operatorExpected):'Pendiente');operatorForm.elements.responsible.value=document.querySelector('.user-info strong').textContent;operatorForm.elements.reason.value=''}}
operatorForm.elements.column.onchange=operatorSelection;
async function operatorHistory(){{const id=operatorRow;try{{const response=await fetch('/api/produccion/operaciones/'+id,{{cache:'no-store'}});if(!response.ok)throw Error();const events=await response.json();if(id!==operatorRow)return;const labels={{start:'Inicio / retoma',rework:'Reproceso',finish:'Terminado',na:'No aplica',clear:'Cambio de estado'}};operatorDialog.querySelector('.operator-history').innerHTML=events.map(e=>'<article><strong>'+esc(productionData.headers[e.column_number-1]||'Proceso')+' · '+esc(labels[e.action]||e.action)+'</strong><p>'+esc(e.responsible)+' · Registró: '+esc(e.username)+'</p><time>'+esc(new Date(e.created_at).toLocaleString('es-CO',{{timeZone:'America/Bogota'}}))+'</time>'+(e.reason?'<p>'+esc(e.reason)+'</p>':'')+'</article>').join('')||'<p>Sin registros nuevos. Los datos anteriores se conservan en la tarjeta.</p>'}}catch(error){{operatorDialog.querySelector('.operator-history').textContent='No se pudo consultar el historial.'}}}}
function openOperatorProduction(id){{operatorRow=id;const row=productionData.rows.find(r=>r.source_row===id);if(!row)return;operatorDialog.querySelector('.operator-order').textContent=traceField(row,'ORDEN')+' · '+traceField(row,'REFERENCIA')+' · '+traceField(row,'NOMBRE DEL CLIENTE');const area=processKey(document.querySelector('.user-info small')?.textContent||''),eligible=productionData.headers.map((h,i)=>({{h,i}})).filter(item=>operatorHeaders.has(processKey(item.h))),matches=eligible.filter(item=>processKey(item.h)===area),groupMatches=eligible.filter(item=>processKey(productionData.groups[item.i]||'')===area),selected=matches.length===1?matches[0]:groupMatches.length===1?groupMatches[0]:null;operatorForm.elements.column.innerHTML='<option value="">Selecciona un proceso</option>'+eligible.map(({{h,i}})=>'<option value="'+(i+1)+'">'+esc(productionData.groups[i]||h)+' · '+esc(h)+'</option>').join('');if(selected)operatorForm.elements.column.value=String(selected.i+1);operatorDialog.querySelector('.operator-current').textContent='';operatorForm.elements.responsible.value=document.querySelector('.user-info strong').textContent;operatorForm.elements.reason.value='';operatorExpected='';operatorSelection();operatorDialog.querySelector('.operator-message').textContent=selected?'Proceso seleccionado según tu perfil. La fecha y hora se guardan automáticamente.':'Selecciona el proceso de esta actividad. Tu perfil no tiene un proceso único asignado.';operatorDialog.querySelector('.operator-history').textContent='Consultando…';operatorDialog.showModal();operatorHistory()}}
operatorForm.onsubmit=async event=>{{
  event.preventDefault();
  if(operatorSaving)return;
  const action=event.submitter?.value;
  if(!action)return;
  const reason=operatorForm.elements.reason.value.trim(),responsible=operatorForm.elements.responsible.value.trim(),message=operatorDialog.querySelector('.operator-message');
  if(!responsible||action==='rework'&&!reason){{message.textContent='Indica el responsable y, para reproceso, el motivo.';return}}
  if(action==='clear'&&!confirm('¿Vaciar el estado de este proceso? Vuelve a quedar pendiente para elegir otro estado.'))return;
  operatorSaving=true;
  const controls=[...operatorForm.querySelectorAll('button,input,select,textarea')],payload={{row:operatorRow,column:Number(operatorForm.elements.column.value),action,responsible,reason,expected:operatorExpected}};
  controls.forEach(c=>c.disabled=true);
  message.textContent='Guardando…';
  try{{
    const response=await fetch('/api/produccion/operacion',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(payload)}}),data=await response.json();
    if(!response.ok)throw Error(data.detail||'No se pudo guardar');
    const row=productionData.rows.find(r=>r.source_row===operatorRow);
    if(row)row.values=data.values;
    operatorExpected=String(data.values[payload.column-1]||'');
    operatorForm.elements.reason.value='';
    operatorDialog.close();
    await syncProductionRealtime();
    renderTraceCards();
    productionStatus.textContent='✓ Actividad guardada con fecha y hora.';
  }}catch(error){{message.textContent=error.message}}
  finally{{operatorSaving=false;controls.forEach(c=>c.disabled=false)}}
}};
function traceProcessMarkup(row){{
const groups=[];productionData.headers.forEach((header,index)=>{{const label=String(productionData.groups[index]||'').replace(/^['"]|['"]$/g,'').trim(),key=processKey(label);if(!key||key==='GENERAL'||key.includes('LINEA PRODUCCION')||key.includes('METODOLOG'))return;let group=groups[groups.length-1];if(!group||group.key!==key||group.end!==index-1){{group={{key,label,start:index,end:index,columns:[]}};groups.push(group)}}group.end=index;group.columns.push(index)}});
return '<section class="trace-processes"><h4>Seguimiento de producción</h4><div class="trace-process-grid">'+groups.map(group=>{{
const columns=group.columns.filter(i=>!processKey(productionData.headers[i]).includes('CORREO')),statusColumns=columns.filter(i=>processStatusHeaders.has(processKey(productionData.headers[i]))||processKey(productionData.headers[i])===group.key||['DISEÑO','DISENO','CONFECCION','CORTE TEXTIL/PLT'].includes(processKey(productionData.headers[i]))),states=statusColumns.map(i=>String(row.values[i]||'').trim().toUpperCase());
let tone='pending',status='Pendiente';if(states.includes('R')){{tone='rework';status='Reproceso'}}else if(states.includes('P')){{tone='active';status='En proceso'}}else if(states.length&&states.every(v=>v==='N/A'||scheduleParseDate(v))){{tone='finished';status=states.every(v=>v==='N/A')?'No aplica':'Completado'}}else if(states.some(v=>v==='N/A'||scheduleParseDate(v))){{tone='partial';status='Avance parcial'}}
if(['pending','partial'].includes(tone)&&(productionData.auto_closed||[]).includes(row.source_row+':'+(group.start+1))){{tone='finished';status='Cierre automático'}}
const responsible=columns.filter(i=>isResponsibleHeader(productionData.headers[i])||processKey(productionData.headers[i])==='CONFECCIONISTA').map(i=>String(row.values[i]||'').trim()).filter(Boolean).join(' · '),notes=columns.filter(i=>productionData.notes?.[row.source_row+':'+(i+1)]),id=row.source_row+':'+group.start;
const fields=columns.filter(i=>String(row.values[i]??'').trim()).map(i=>'<div><dt>'+esc(productionData.headers[i])+'</dt><dd>'+esc(displayProductionDate(String(row.values[i])))+'</dd></div>').join('');
return '<details class="trace-process '+tone+'" data-process-key="'+id+'" '+(traceExpandedProcesses.has(id)?'open':'')+'><summary><span class="trace-process-dot" aria-hidden="true"></span><span><strong>'+esc(group.label)+'</strong><small>'+status+'</small></span>'+(notes.length?'<span class="trace-process-note">'+notes.length+' nota'+(notes.length===1?'':'s')+'</span>':'')+'</summary><div class="trace-process-info"><p class="trace-process-responsible">Responsable: '+esc(responsible||'Sin asignar')+'</p><dl>'+fields+'</dl>'+(!fields?'<p>Sin información registrada todavía.</p>':'')+notes.map(i=>'<div class="trace-process-comment"><strong>'+esc(productionData.headers[i])+'</strong><p>'+esc(productionData.notes[row.source_row+':'+(i+1)])+'</p></div>').join('')+'</div></details>'}}).join('')+'</div></section>';
}}
function renderTraceCards(){{
if(!productionData||traceView!=='cards')return;traceImageObserver.disconnect();const mtsColi=productionData.headers.findIndex(h=>String(h||'').trim().toUpperCase()==='MTS REQUERIDO');
const visible=new Set([...productionBody.querySelectorAll('tr')].map(tr=>Number(tr.querySelector('td[data-row]')?.dataset.row))),rows=productionData.rows.filter(row=>visible.has(row.source_row)&&['ORDEN','NOMBRE DEL CLIENTE','NOMBRE PROYECTO','REFERENCIA'].some(name=>traceField(row,name).trim()));
traceCards.innerHTML=rows.map(row=>{{const reference=String(traceField(row,'REFERENCIA')||'').trim(),allNotes=Object.entries(productionData.notes||{{}}).filter(([,value])=>value),rowNotes=allNotes.filter(([key])=>key.startsWith(row.source_row+':')),hasMts=value=>String(value||'').toUpperCase().includes('MTS'),mtsV=String(productionData.notes?.[row.source_row+':17']||rowNotes.find(([,value])=>hasMts(value))?.[1]||allNotes.find(([,value])=>reference&&String(value).toUpperCase().includes(reference.toUpperCase())&&hasMts(value))?.[1]||'').trim(),current=row.current_process||{{label:'Sin iniciar',state:'pending'}},notes=rowNotes,colQNota=String(row.values[16]||'').trim(),processIndex=productionData.groups.findIndex(g=>processKey(g)===processKey(current.label));let responsible='';for(let i=Math.max(0,processIndex);processIndex>=0&&i<productionData.headers.length&&productionData.groups[i]===productionData.groups[processIndex];i++){{if(isResponsibleHeader(productionData.headers[i])){{responsible=row.values[i]||'';break}}}}
return '<article class="trace-card" data-card-row="'+row.source_row+'"><div class="trace-media">'+traceAssetsMarkup(row.source_row)+'</div><div class="trace-card-body"><div class="trace-card-heading"><h3>'+esc(traceField(row,'ORDEN'))+'</h3><span>Fila '+row.source_row+'</span></div><div class="trace-client-row"><div class="trace-client-info"><p class="trace-client">'+esc(traceField(row,'NOMBRE DEL CLIENTE'))+'</p><p class="trace-project">'+esc(traceField(row,'NOMBRE PROYECTO'))+'</p></div><button class="trace-mts-btn'+(mtsV?' has-value':'')+'" type="button" data-card-mts="'+row.source_row+'"><span class="mts-label">Ingresar MTS REQUERIDOS</span>'+(mtsV?'<strong class="mts-current">'+esc(mtsV)+' mts</strong>':'')+'</button></div><dl><div><dt>Referencia</dt><dd>'+esc(traceField(row,'REFERENCIA'))+'</dd></div><div><dt>Cantidad</dt><dd>'+esc(traceField(row,'CANTIDAD'))+' und.</dd></div><div><dt>Entrega</dt><dd>'+esc(displayProductionDate(traceField(row,'FECHA DE ENTREGA')))+'</dd></div><div><dt>Responsable del proceso</dt><dd>'+esc(responsible||'Sin asignar')+'</dd></div></dl><div class="trace-stage '+esc(current.state)+'">'+esc((current.state==='active'?'En proceso: ':current.state==='finished'?'Último terminado: ':'')+current.label)+'</div><p class="trace-note-count">'+notes.length+' nota'+(notes.length===1?'':'s')+'</p>'+(colQNota?'<div class="trace-q-nota"><span>📋</span><p>'+esc(colQNota)+'</p></div>':'')+'<div class="trace-card-actions"><button type="button" data-card-detail="'+row.source_row+'">Ver detalle</button><button type="button" data-card-edit="'+row.source_row+'">Editar fila</button><button type="button" data-card-rework="'+esc(traceField(row,'ORDEN'))+'">Reproceso</button><button type="button" data-card-nas="'+row.source_row+'">NAS ↗</button></div></div></article>'}}).join('')||'<p class="trace-empty">No hay filas que coincidan con la búsqueda.</p>';
traceCards.querySelectorAll('[data-card-row]').forEach(card=>{{const row=rows.find(r=>r.source_row===Number(card.dataset.cardRow));const action=card.querySelector('[data-card-edit]');action.textContent='Producción';action.classList.add('operator-open');card.insertAdjacentHTML('beforeend',traceProcessMarkup(row));card.querySelectorAll('[data-process-key]').forEach(detail=>detail.addEventListener('toggle',()=>{{if(!detail.isConnected)return;if(detail.open)traceExpandedProcesses.add(detail.dataset.processKey);else traceExpandedProcesses.delete(detail.dataset.processKey)}}));traceImageObserver.observe(card)}});fitTraceCards();
}}
function fitTraceCards(){{if(!document.body.classList.contains('production-mode')||traceView!=='cards')return;traceCards.style.height=Math.max(180,innerHeight-traceCards.getBoundingClientRect().top-12)+'px'}}
window.addEventListener('resize',fitTraceCards);new MutationObserver(()=>{{if(traceView==='cards')renderTraceCards()}}).observe(productionBody,{{childList:true}});
traceCards.addEventListener('click',async event=>{{const button=event.target.closest('button');if(!button)return;
if(button.dataset.cardRetry){{const id=Number(button.dataset.cardRetry);traceAssets.delete(id);paintTraceAssets(id);loadTraceAssets(id);return}}
if(button.dataset.designRow){{const id=Number(button.dataset.designRow);traceDesignSelection.set(id,Number(button.dataset.designIndex));paintTraceAssets(id);traceCards.querySelector('[data-design-row="'+id+'"][data-design-index="'+button.dataset.designIndex+'"]')?.focus();return}}
if(button.dataset.cardEdit){{traceOpenTable(button.dataset.cardEdit);return}}
if(button.dataset.cardNas){{productionBody.querySelector('td[data-row="'+button.dataset.cardNas+'"]')?.closest('tr').querySelector('.production-row-open')?.click();return}}
if(button.dataset.cardRework){{document.querySelector('.tab[data-kind="reproceso"]')?.click();return}}
if(button.dataset.cardMts){{const id=Number(button.dataset.cardMts),row=productionData?.rows.find(r=>r.source_row===id);if(!row||!productionData)return;const ci=productionData.headers.findIndex(h=>String(h||'').trim().toUpperCase()==='MTS REQUERIDO');if(ci<0){{alert('No se encontró la columna MTS REQUERIDO');return}}const cur=String(row.values[ci]||'').trim();mtsTarget={{sourceRow:id,colIdx:ci,rowRef:row}};mtsDialog.querySelector('.mts-order').textContent=traceField(row,'ORDEN')+' · '+traceField(row,'REFERENCIA')+' · '+traceField(row,'NOMBRE DEL CLIENTE');mtsDialog.querySelector('.mts-current-val').textContent=cur?'Valor actual: '+cur+' mts':'Sin valor registrado';mtsDialog.querySelector('.mts-input').value=cur;mtsDialog.querySelector('.mts-msg').textContent='';mtsDialog.showModal();setTimeout(()=>mtsDialog.querySelector('.mts-input').select(),50);return;}}
if(button.dataset.cardDetail){{const id=Number(button.dataset.cardDetail),row=productionData.rows.find(r=>r.source_row===id);if(!row)return;traceDetail.querySelector('.trace-detail-content').innerHTML='<h2>'+esc(traceField(row,'ORDEN'))+' · '+esc(traceField(row,'REFERENCIA'))+'</h2><p>'+esc(traceField(row,'NOMBRE DEL CLIENTE'))+'</p><div class="trace-detail-assets">Consultando archivos…</div><h3>Información de la fila</h3><dl>'+productionData.headers.map((h,i)=>row.values[i]?'<div><dt>'+esc(h)+'</dt><dd>'+esc(row.values[i])+'</dd></div>':'').join('')+'</dl><h3>Notas</h3>'+Object.entries(productionData.notes||{{}}).filter(([key,value])=>key.startsWith(id+':')&&value).map(([key,value])=>'<p class="trace-full-note"><strong>'+esc(productionData.headers[Number(key.split(':')[1])-1])+'</strong><br>'+esc(value)+'</p>').join('');traceDetail.showModal();await loadTraceAssets(id);const asset=traceAssets.get(id);if(!traceDetail.open)return;traceDetail.querySelector('.trace-detail-assets').innerHTML=asset?.error?esc(asset.error):asset?asset.images.map(image=>'<a href="'+esc(image.url)+'" target="_blank" rel="noopener"><img src="'+esc(image.url)+'" alt="'+esc(image.name)+'"></a>').join('')+'<h3>Listados y documentos de la orden</h3>'+(asset.documents.map(file=>'<a class="trace-document" href="'+esc(file.url)+'" target="_blank" rel="noopener">'+esc(file.name)+'</a>').join('')||'<p>No se encontraron documentos en la carpeta principal.</p>'):'La imagen sigue cargando; vuelve a abrir el detalle.'}}
}});
const traceStyle=document.createElement('style');traceStyle.textContent=`
.sidebar nav.tabs button{{text-transform:uppercase}}
.trace-view-bar[hidden]{{display:none!important}}.operator-dialog{{width:min(600px,94vw);max-height:90dvh;overflow:auto;background:#19221c;color:#e5eee7;border:1px solid #53654f;border-radius:16px;padding:24px}}.operator-dialog::backdrop{{background:#000a}}.operator-dialog label{{display:block;margin:14px 0;font-size:13px}}.operator-dialog input,.operator-dialog select,.operator-dialog textarea{{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;background:#27312b;color:#edf3ef;border:1px solid #526355;border-radius:7px;font:14px Arial}}.operator-actions{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}.operator-actions button{{padding:12px;border-radius:8px;font:600 13px Arial;border:1px solid #556955;background:#cfeb96;color:#172116;cursor:pointer}}.operator-actions button[value=rework]{{background:#873737;color:white}}.operator-actions button[value=start]{{background:#efb65c;color:#241a09}}.operator-actions button[value=clear]{{background:#2a3550;color:#c9d6f5}}.operator-dialog button:disabled{{opacity:.5;cursor:wait}}.operator-close{{float:right;width:32px!important;background:transparent!important;color:white!important;border:0!important;padding:4px!important}}.operator-history article{{border-top:1px solid #3f4d42;padding:12px 0;font:12px/1.5 Arial}}.operator-history p{{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}}.operator-message{{font-size:13px;color:#cfeb96}}.operator-current{{font-size:13px;color:#a9d5ee}}body.production-mode .trace-card-actions .operator-open{{background:#d4ec98;color:#182315;font-weight:600}}
.trace-processes{{grid-column:1/-1;padding:18px 22px;border-top:1px solid #35403a;background:#171e1a;min-width:0}}.trace-processes h4{{margin:0 0 12px;font:600 14px Arial;color:#e5ece7}}.trace-process-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;align-items:start}}.trace-process{{border:1px solid #374039;border-radius:8px;background:#202823;min-width:0}}.trace-process summary{{display:flex;align-items:center;gap:8px;padding:11px;cursor:pointer;list-style:none}}.trace-process summary::-webkit-details-marker{{display:none}}.trace-process summary strong{{display:block;font:500 11px Arial;overflow-wrap:anywhere;color:#e3eae5}}.trace-process summary small{{display:block;margin-top:5px;font:11px Arial;color:#a8b4ab}}.trace-process-dot{{width:8px;height:8px;flex:none;border-radius:50%;background:#78837b}}.trace-process.active .trace-process-dot{{background:#f5a623}}.trace-process.rework .trace-process-dot{{background:#ef6262}}.trace-process.finished .trace-process-dot{{background:#66c58a}}.trace-process.partial .trace-process-dot{{background:#9ac9ee}}.trace-process-note{{margin-left:auto;font:10px Arial;color:#9ac9ee;white-space:nowrap}}.trace-process-info{{padding:0 11px 12px;font:12px/1.5 Arial;color:#c3cfc6}}.trace-process-info dl{{display:block;margin:10px 0}}.trace-process-info dl div{{margin-bottom:8px}}.trace-process-info dt{{font-size:10px;color:#9aa99f}}.trace-process-info dd{{margin:2px 0;overflow-wrap:anywhere;color:#e6eee9}}.trace-process-responsible{{color:#aad6f4}}.trace-process-comment{{border-top:1px solid #39483e;padding-top:8px;margin-top:8px}}.trace-process-comment p{{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}}.trace-process summary:focus-visible{{outline:2px solid #9ac9ee;border-radius:8px}}
.trace-process-grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 0;align-items:start;overflow:visible;padding:8px 0;counter-reset:process-node}}
.trace-processes h4::after{{content:'Pulsa un punto para ver los detalles';display:block;margin-top:6px;font:11px/1.5 Arial;color:#97aa9d}}
.trace-process{{position:relative;flex:0 0 132px;border:0;border-radius:0;background:transparent;counter-increment:process-node}}
.trace-process::before{{content:'';position:absolute;top:10px;left:0;right:0;height:2px;background:#425147;pointer-events:none}}
.trace-process:nth-child(4n+1)::before{{left:50%}}.trace-process:nth-child(4n)::before,.trace-process:last-child::before{{right:50%}}
.trace-process summary{{position:relative;flex-direction:column;justify-content:flex-start;gap:8px;text-align:center;padding:0 5px 6px;min-height:76px}}
.trace-process-dot{{position:relative;z-index:1;width:22px;height:22px;box-sizing:border-box;display:grid;place-items:center;border:2px solid #718077;background:#202a23;box-shadow:0 0 0 3px #171e1a;color:#becbc2;font:600 10px Arial}}
.trace-process-dot::after{{content:counter(process-node)}}
.trace-process.active .trace-process-dot{{background:#312718;border:3px solid #f5a623;color:#ffd38c;box-shadow:0 0 0 5px #171e1a,0 0 0 8px #f5a62330}}
.trace-process.active .trace-process-dot::after{{content:'';width:6px;height:6px;border-radius:50%;background:#f5a623;animation:trace-node-pulse 1.6s ease-in-out infinite}}
.trace-process.finished .trace-process-dot{{background:#214733;border-color:#70d798;color:#a9f4c5}}.trace-process.finished .trace-process-dot::after{{content:'✓';font-size:22px}}
.trace-process.rework .trace-process-dot{{background:#422525;border-color:#ef6262;color:#ffb2b2}}.trace-process.rework .trace-process-dot::after{{content:'!';font-size:22px}}
.trace-process.partial .trace-process-dot{{background:#213743;border-color:#9ac9ee;color:#c5e6ff}}
.trace-process summary strong{{font-size:11px;line-height:1.4}}.trace-process.active summary small{{color:#ffd38c}}.trace-process.finished summary small{{color:#9ce6b6}}.trace-process.rework summary small{{color:#ffa8a8}}
.trace-process-note{{margin:0;font-size:10px}}.trace-process[open]{{min-width:0}}.trace-process-info{{background:#222e26;border:1px solid #405448;border-radius:10px;margin:0 3px;padding:8px;text-align:left;overflow-wrap:anywhere}}.trace-process.finished .trace-process-dot::after,.trace-process.rework .trace-process-dot::after{{font-size:13px}}
@media(max-width:700px){{.trace-process-grid{{grid-template-columns:repeat(3,minmax(0,1fr))}}.trace-process:nth-child(n)::before{{left:0;right:0}}.trace-process:nth-child(3n+1)::before{{left:50%}}.trace-process:nth-child(3n)::before,.trace-process:last-child::before{{right:50%}}.trace-processes{{padding:16px 12px}}.trace-process summary strong{{font-size:10px}}}}
@keyframes trace-node-pulse{{0%,100%{{opacity:1;transform:scale(1)}}50%{{opacity:.5;transform:scale(.72)}}}}@media(prefers-reduced-motion:reduce){{.trace-process.active .trace-process-dot::after{{animation:none}}}}
.trace-process-grid{{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:0;align-items:start}}
.trace-process:nth-child(n)::before{{left:0;right:0;top:9px}}.trace-process:first-child::before{{left:50%}}.trace-process:last-child::before{{right:50%}}
.trace-process-dot{{width:20px;height:20px;font-size:9px}}.trace-process summary{{padding:0 2px 8px;gap:8px;min-height:90px}}.trace-process summary strong{{font-size:9px;line-height:1.3;overflow-wrap:anywhere}}.trace-process summary small{{font-size:9px;overflow-wrap:anywhere}}.trace-process-note{{font-size:8px;white-space:normal}}
.trace-process[open] .trace-process-info{{position:fixed;z-index:1200;bottom:20px;left:50%;transform:translateX(-50%);width:min(400px,calc(100vw - 48px));box-sizing:border-box;max-height:50dvh;overflow:auto;box-shadow:0 12px 45px #000b;padding:18px}}.trace-process[open] summary{{background:#ffffff0a;border-radius:6px}}
@media(max-width:700px){{.trace-process-grid{{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}}.trace-process-dot{{width:14px;height:14px;font-size:8px;border-width:1px}}.trace-process.active .trace-process-dot{{border-width:2px;box-shadow:0 0 0 2px #171e1a,0 0 0 3px #f5a62330}}.trace-process:nth-child(n)::before{{top:6px}}.trace-process summary{{min-height:32px;padding:4px 0 8px}}.trace-process:nth-child(n)::before{{top:10px}}.trace-process summary>span:not(.trace-process-dot){{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}.trace-process.finished .trace-process-dot::after,.trace-process.rework .trace-process-dot::after{{font-size:10px}}}}
.trace-process summary>span:not(.trace-process-dot){{min-width:0;max-width:100%}}.trace-process summary strong,.trace-process summary small,.trace-process-note{{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;max-width:100%}}.trace-process summary{{min-height:64px}}.trace-processes h4::after{{content:'Procesos en línea · pulsa un punto para ver su nombre completo y detalles'}}
.trace-view-bar{{display:flex;align-items:center;gap:5px;font-size:13px}}.trace-view-bar button,.trace-card-actions button{{width:auto;padding:8px 12px;background:#273026;color:#e6efdf;border:1px solid #52624a;border-radius:7px;box-shadow:none;font-size:13px}}
.trace-view-bar button[aria-pressed=true]{{background:#caed61;color:#18210d}}
body.production-mode.trace-cards-mode .production-table-wrap,body.production-mode.trace-cards-mode .production-x-scroll{{display:none}}
body.production-mode.trace-cards-mode .production-zoom-group{{display:none}}
.trace-cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(295px,1fr));align-content:start;gap:18px;padding:18px;overflow:auto;background:#111612}}
.trace-cards[hidden]{{display:none}}.trace-card{{border:1px solid #3a4439;border-radius:13px;overflow:hidden;background:#1b221c}}
.trace-media{{height:180px;background:#e9eeea;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#52604f;text-align:center;font-size:13px;padding:8px}}.trace-media img{{width:100%;height:100%;object-fit:contain}}
.trace-card-body{{padding:16px}}.trace-card-heading{{display:flex;align-items:center;justify-content:space-between}}.trace-card-heading h3{{margin:0;color:#e4f7ac;font-size:20px}}.trace-card-heading span{{font-size:12px;color:#899685}}
.trace-client{{font-size:15px;color:#f0f3eb;margin:9px 0 4px}}.trace-project{{font-size:13px;color:#aab6a5;margin:0 0 16px}}
.trace-card dl{{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 15px}}.trace-card dt,.trace-detail dt{{font-size:12px;color:#9caa95}}.trace-card dd,.trace-detail dd{{margin:3px 0 0;font-size:14px;color:#ecf0e7;overflow-wrap:anywhere}}
.trace-stage{{padding:8px;border-radius:6px;background:#30392c;font-size:13px;color:#d3ddc9}}.trace-stage.active{{background:#4b3b21;color:#f3d196}}.trace-stage.finished{{background:#254236;color:#bce4c9}}
.trace-note-count{{font-size:12px;color:#aebca5;margin:10px 0}}.trace-q-nota{{display:flex;gap:8px;align-items:flex-start;background:#1d2e22;border:1px solid #3a5040;border-radius:8px;padding:9px 12px;margin:10px 0}}.trace-q-nota span{{font-size:14px;flex-shrink:0;margin-top:1px}}.trace-q-nota p{{margin:0;font-size:12px;color:#c7e0cc;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}}.trace-card-actions{{display:flex;gap:7px;flex-wrap:wrap}}
.trace-detail{{width:min(880px,94vw);max-height:88dvh;overflow:auto;background:#1b221c;border:1px solid #61704f;border-radius:14px;color:#e8eee2;padding:24px}}.trace-detail::backdrop{{background:#000a}}.trace-close{{float:right;width:auto;background:#303b29;color:white;padding:5px 10px;box-shadow:none}}.trace-detail dl{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}.trace-detail-assets img{{max-width:180px;height:150px;object-fit:contain;background:#eee;margin:8px}}.trace-document{{display:block;color:#acd6ff;margin:8px 0}}.trace-full-note{{white-space:pre-wrap;background:#273025;padding:12px;border-radius:8px}}
@media(max-width:620px){{.trace-cards{{grid-template-columns:1fr;padding:10px;gap:12px}}.trace-detail dl{{grid-template-columns:1fr 1fr}}}}
@media(max-width:860px){{body.production-mode.trace-cards-mode .sidebar{{transform:translateX(-105%)}}body.production-mode.trace-cards-mode.menu-open .sidebar{{transform:translateX(0)}}body.production-mode.trace-cards-mode main{{margin-left:0!important;width:100%;padding:68px 7px 0}}body.production-mode.trace-cards-mode .brand{{position:fixed;top:4px;left:64px;right:7px;width:auto}}}}
body.production-mode .trace-cards{{grid-auto-rows:max-content}}body.production-mode .trace-card{{min-height:480px}}
`;document.head.appendChild(traceStyle);
const tracePolish=document.createElement('style');tracePolish.textContent=`
body.production-mode .trace-cards{{grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:22px;padding:24px;background:#101412}}
body.production-mode .trace-card{{min-height:0;display:flex;flex-direction:column;background:#1a201d;border:1px solid #35403a;border-radius:16px;box-shadow:0 4px 16px #0002;transition:border-color .18s,box-shadow .18s}}
body.production-mode .trace-card:hover{{border-color:#65765c;box-shadow:0 8px 24px #0004}}
body.production-mode .trace-media{{height:210px;padding:14px;background:#edf0ee;border-bottom:1px solid #35403a}}
body.production-mode .trace-media:not(:has(img)){{height:94px;background:linear-gradient(120deg,#252f29,#1d2621);color:#a4b2a7;font-size:13px;padding:20px 26px}}
body.production-mode .trace-media img{{border-radius:6px}}
.trace-mockups{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;height:100%;min-height:0}}.trace-mockups[data-count="1"]{{grid-template-columns:1fr}}.trace-mockups a{{display:flex;flex-direction:column;align-items:center;min-width:0;min-height:0;text-decoration:none;color:#334238}}.trace-mockups img{{flex:1;min-height:0;object-fit:contain}}.trace-mockups span{{flex:none;font-size:11px;line-height:18px}}.trace-mockups a:focus-visible{{outline:2px solid #357bbc;outline-offset:2px}}
body.production-mode .trace-card-body{{padding:22px;display:flex;flex-direction:column;flex:1}}
body.production-mode .trace-card-heading{{gap:10px;margin-bottom:13px}}
body.production-mode .trace-card-heading h3{{font-size:23px;letter-spacing:-.025em;font-weight:700;color:#f4f7f2;line-height:1.2}}
body.production-mode .trace-card-heading>span{{border:1px solid #3c4940;border-radius:20px;padding:3px 8px;font-size:11px;color:#9fafa3;white-space:nowrap}}
body.production-mode .trace-client{{font-size:15px;font-weight:600;line-height:1.45;margin:0 0 5px;color:#e0e7e0}}
body.production-mode .trace-project{{font-size:13px;line-height:1.45;font-weight:400;color:#98a79b;margin:0 0 20px}}
body.production-mode .trace-card dl{{gap:17px 14px;padding:17px 0;margin:0 0 17px;border-top:1px solid #323c35;border-bottom:1px solid #323c35}}
body.production-mode .trace-card dt{{font-size:12px;font-weight:400;color:#92a296;margin-bottom:5px}}
body.production-mode .trace-card dd{{font-size:15px;font-weight:600;line-height:1.35;color:#e8efe8;margin:0}}
body.production-mode .trace-stage{{align-self:flex-start;border-radius:20px;padding:6px 11px;background:#303b34;color:#c2d1c5;font-size:12px;font-weight:600;line-height:1.4}}
body.production-mode .trace-stage.active{{background:#473c26;color:#f3d59a}}
body.production-mode .trace-stage.finished{{background:#243f34;color:#abdbbe}}
body.production-mode .trace-note-count{{font-size:12px;color:#9eafa3;margin:13px 0 16px;font-weight:400}}
body.production-mode .trace-card-actions{{margin-top:auto;display:grid;grid-template-columns:1fr auto auto auto;gap:8px;padding-top:4px}}
body.production-mode .trace-card-actions button{{padding:9px 10px;font-size:13px;font-weight:600;border:1px solid #455449;background:transparent;color:#c4d2c6;border-radius:8px;box-shadow:none;min-width:0}}
body.production-mode .trace-card-actions button[data-card-detail]{{background:#d1eb89;color:#202a14;border-color:#d1eb89}}
body.production-mode .trace-card-actions button[data-card-rework]{{background:#ef7370;color:#2a1010;border-color:#ef7370}}
body.production-mode .trace-card-actions button:hover{{filter:brightness(1.1);border-color:#a0b582}}
body.production-mode .trace-view-bar{{border:1px solid #3e4c40;background:#1a231c;padding:4px;border-radius:10px;gap:3px}}
body.production-mode .trace-view-bar>span{{display:none}}
body.production-mode .trace-view-bar button{{border:0;background:transparent;color:#b5c3b6;border-radius:6px;padding:8px 13px}}
body.production-mode .trace-view-bar button[aria-pressed=true]{{background:#d1eb89;color:#202a14}}
.trace-detail{{border-radius:18px;padding:28px;background:#19211c}}
.trace-detail h2{{font-size:23px;line-height:1.3;margin-bottom:8px}}
.trace-detail dl>div{{padding:12px;background:#222d25;border-radius:8px}}
@media(max-width:620px){{body.production-mode .trace-cards{{grid-template-columns:minmax(0,1fr);padding:12px;gap:14px}}body.production-mode .trace-card-body{{padding:18px}}body.production-mode .trace-media:has(img){{height:190px}}}}
.trace-client-row{{display:flex;align-items:flex-start;gap:10px;margin-bottom:16px}}.trace-client-info{{flex:1;min-width:0}}.trace-client-info .trace-client{{margin-top:9px;margin-bottom:4px}}.trace-client-info .trace-project{{margin-bottom:0}}
.trace-mts-btn{{flex:none;width:130px;padding:10px 8px;border:1.5px dashed #4e6348;border-radius:10px;background:rgba(208,244,76,.05);color:#b0c2ab;font-size:11px;font-weight:700;text-align:center;cursor:pointer;line-height:1.45;text-transform:uppercase;letter-spacing:.04em;transition:border-color .15s,background .15s;box-shadow:none}}.trace-mts-btn:hover{{border-color:#91b87a;background:rgba(208,244,76,.1);color:#d5e8ce}}.trace-mts-btn.has-value{{border-style:solid;border-color:#5f9650;background:rgba(208,244,76,.09)}}.mts-label{{display:block}}.mts-current{{display:block;margin-top:6px;font-size:15px;color:#d0f44c;font-weight:900;letter-spacing:-.01em}}
.mts-order{{font-size:13px;color:#b5cbb8;margin:4px 0 8px}}.mts-current-val{{font-size:13px;color:#a9d5ee;margin:0 0 10px}}.mts-msg{{font-size:13px;color:#cfeb96;margin-top:10px;min-height:18px}}
body.production-mode .trace-client-row{{margin-bottom:20px}}body.production-mode .trace-client-info .trace-client{{margin:0 0 5px}}body.production-mode .trace-client-info .trace-project{{margin:0}}body.production-mode .trace-mts-btn{{font-size:11px;width:128px}}
`;document.head.appendChild(tracePolish);
const traceFigmaStyle=document.createElement('style');traceFigmaStyle.textContent=`
body.production-mode .trace-cards{{grid-template-columns:repeat(auto-fill,minmax(500px,1fr));gap:20px;padding:24px;align-items:start;background:#111715;font-family:Arial,sans-serif}}
body.production-mode .trace-card{{display:grid;grid-template-columns:38% minmax(0,1fr);min-height:390px;border-radius:18px;background:#1b211f;border:1px solid #35403a;box-shadow:0 5px 20px #0002}}
body.production-mode .trace-media,body.production-mode .trace-media:not(:has(img)),body.production-mode .trace-media:has(img){{height:100%;min-height:390px;padding:16px;background:#edefea;border:0;color:#58655c}}
.trace-design-view{{display:flex;flex-direction:column;width:100%;height:100%;gap:12px}}.trace-design-main{{display:flex;flex:1;min-height:0;align-items:center;justify-content:center}}body.production-mode .trace-design-main img{{height:310px;width:100%;object-fit:contain}}
.trace-design-tabs{{display:flex;gap:5px;justify-content:center}}body.production-mode .trace-design-tabs button{{width:auto;padding:7px 12px;background:transparent;border:1px solid transparent;border-radius:6px;color:#526052;font:600 12px Arial;box-shadow:none}}body.production-mode .trace-design-tabs button[aria-pressed=true]{{background:#fff;border-color:#cbd3c7;color:#263c29}}.trace-design-tabs button:focus-visible{{outline:2px solid #357bbc}}
.trace-no-design{{display:flex;flex-direction:column;gap:9px;align-items:center;max-width:180px}}.trace-no-design>span{{font-size:45px;font-weight:400;color:#8c998e}}.trace-no-design strong{{font-size:13px}}.trace-no-design small{{font-size:11px;line-height:1.5;color:#7c887f}}
body.production-mode .trace-card-body{{padding:24px;gap:0}}body.production-mode .trace-card-heading{{align-items:center;margin-bottom:14px}}body.production-mode .trace-card h3{{font-size:25px;letter-spacing:-.6px;font-weight:600}}body.production-mode .trace-card-heading>span{{font-size:10px;border:0;padding:0;color:#819187}}
body.production-mode .trace-client{{font-size:16px;font-weight:500;line-height:1.4;margin:0 0 5px;color:#f2f5f0}}body.production-mode .trace-project{{font-size:12px;font-weight:400;color:#9cab9f;margin:0 0 17px}}
body.production-mode .trace-card dl{{padding:0;margin:0 0 18px;border:0;gap:13px 16px}}body.production-mode .trace-card dt{{font-size:11px;font-weight:400;color:#93a398;margin-bottom:5px}}body.production-mode .trace-card dd{{font-size:13px;font-weight:500;color:#e4ebe4;line-height:1.45}}
body.production-mode .trace-stage{{font-size:11px;border-radius:6px;padding:8px 10px;max-width:100%;font-weight:500}}body.production-mode .trace-note-count{{font-size:11px;margin:10px 0 14px}}body.production-mode .trace-card-actions{{padding-top:7px;gap:7px;align-items:center}}body.production-mode .trace-card-actions button{{font-size:12px;padding:9px 8px;font-weight:500}}body.production-mode .trace-card-actions button[data-card-detail]{{background:#d4ec98;color:#20291b}}body.production-mode .trace-card-actions button:not([data-card-detail]){{border-color:transparent}}
@media(max-width:700px){{body.production-mode .trace-cards{{grid-template-columns:minmax(0,1fr);padding:12px}}body.production-mode .trace-card{{grid-template-columns:minmax(0,1fr)}}body.production-mode .trace-media,body.production-mode .trace-media:has(img),body.production-mode .trace-media:not(:has(img)){{height:300px;min-height:0}}body.production-mode .trace-design-main img{{height:235px}}body.production-mode .trace-media:not(:has(img)){{height:120px}}.trace-no-design>span{{display:none}}body.production-mode .trace-card-body{{padding:20px}}}}
`;document.head.appendChild(traceFigmaStyle);setTraceView();
    const commercialGroup=commercialToggle.closest('.nav-group');commercialGroup.classList.add('collapsed');const productionToggle=document.getElementById('production-toggle');if(productionToggle)productionToggle.addEventListener('click',()=>{{const g=productionToggle.closest('.nav-group');g.classList.toggle('collapsed');if(!g.classList.contains('collapsed')&&window.innerWidth>860)g.querySelector('.nav-children .tab')?.click()}});
    setTimeout(()=>{{if(!document.querySelector('.panel.active'))document.querySelector('.tab[data-kind="inicio"]')?.click()}},0);
    </script>{PERSONAL_NOTES_SCRIPT}{REWORK_MODULE_SCRIPT}{REWORK_LAYOUT_STYLE}{REWORK_CONTROLS_SCRIPT}{INVENTORY_CONTROL_SCRIPT}<script src='/permisos.js?v=20261006-1'></script><script src='/reposiciones.js?v=20261005-4'></script><script src='/agentes.js?v=20261006-26'></script><script src='/promedios.js?v=20261006-7'></script><script src='/api/cartera/cartera.js?v=20261002-5'></script><script src='/trace-ui.js?v=20261005-1'></script><script src='/home-dashboard.js?v=20261005-9'></script><script src='/bodega-dashboard.js?v=20261002-10'></script><script src='/bodegas.js?v=20261002-4'></script><script src='/mobile-nav.js?v=20261006-1'></script><script src='/nav-liquid.js?v=20261003-3'></script><script src='/build-watch.js?v=20261002-1'></script><script src='/salud.js?v=20261002-1'></script><script src='/tema.js?v=20261002-3'></script><script src='/tarjeta-iconos.js?v=20261002-5'></script><script src='/linea-info.js?v=20261003-1'></script><script src='/inventario-alertas.js?v=20261005-3'></script><script src='/linea-editor.js?v=20261003-3'></script><script>setTimeout(function(){{const panels=[...document.querySelectorAll('.panel')],visible=panels.some(panel=>panel.classList.contains('active')&&getComputedStyle(panel).display!=='none');if(!visible){{const home=document.querySelector('.panel[data-panel="inicio"]'),homeTab=document.querySelector('.tab[data-kind="inicio"]');panels.forEach(panel=>panel.classList.toggle('active',panel===home));document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===homeTab));document.body.classList.add('inicio-mode');document.body.classList.remove('inventory-mode','production-mode','schedule-mode','operarios-mode')}}}},80);setTimeout(function(){{document.documentElement.classList.add('ui-ready')}},150);</script></body></html>"""


def ordered_mockup_uploads(extras, slots):
    uploads = list(extras)
    for number, image in enumerate(slots, 1):
        if image and image.filename:
            image.filename = f'D{number}_' + Path(image.filename).name
            uploads.append(image)
    return uploads


@app.post("/procesar", status_code=202)
async def upload(
    archivo: UploadFile = File(...),
    observaciones: str = Form(default='', max_length=5000),
    extras: list[UploadFile] = File(default=[]),
    mockup_d1: UploadFile = File(default=None),
    mockup_d2: UploadFile = File(default=None),
    mockup_d3: UploadFile = File(default=None),
    mockup_d4: UploadFile = File(default=None),
    _=Depends(authenticate),
):
    extras = ordered_mockup_uploads(extras, [mockup_d1, mockup_d2, mockup_d3, mockup_d4])
    try:
        await require_mockup_upload(extras)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    extension = Path(archivo.filename or "").suffix.lower()
    if extension not in {".pdf", ".xlsx", ".xlsm"}:
        raise HTTPException(400, "Solo se permiten archivos PDF, XLSX o XLSM")
    safe_name = Path(archivo.filename).name
    stamp = datetime.now().strftime('%Y%m%d%H%M%S%f')
    job_dir = UPLOAD_DIR / "reprogramaciones" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    target = job_dir / safe_name
    content = await archivo.read()
    total = len(content)
    if total > 25 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera 25 MB")
    target.write_bytes(content)
    extra_paths = []
    allowed_images = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".ai", ".eps"}
    valid_extras = [item for item in extras if item.filename]
    for index, item in enumerate(valid_extras):
        name = Path(item.filename).name
        if Path(name).suffix.lower() not in allowed_images:
            raise HTTPException(400, f"El anexo {name} no es una imagen permitida")
        data = await item.read()
        total += len(data)
        if total > 75 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 75 MB")
        extra_target = job_dir / name
        if extra_target.exists():
            extra_target = job_dir / f"{index}_{name}"
        extra_target.write_bytes(data)
        extra_paths.append(extra_target)
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?)",
            (safe_name, "RECIBIDO", "En cola", now, now, "reprogramacion", json.dumps({'observaciones': observaciones.strip()}, ensure_ascii=False)),
        )
        job_id = cursor.lastrowid
    processor = process_job if extension == ".pdf" else process_reprogram_excel_job
    asyncio.create_task(asyncio.to_thread(processor, job_id, target, extra_paths, observaciones.strip(), str(_)))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El documento se está procesando"}


def _reject_existing_order(pdf_bytes: bytes, pdf_name: str):
    """Impide programar una orden que ya está en el sistema (producción, tarjetas eliminadas, pedidos enviados o carpeta del NAS)."""
    tmp = Path(tempfile.mkdtemp(prefix='chk-'))
    try:
        path = tmp / 'documento.pdf'
        path.write_bytes(pdf_bytes)
        try:
            _, header, _, _ = legacy.extraer_info_pdf(str(path))
        except Exception:
            return ''  # el procesamiento normal informará si el PDF no se puede leer
        prefix, number = pedidos.extraer_prefijo_numero_nombre(pdf_name)
        order = str(header.get('orden') or (f'{prefix}{number}' if number else '')).upper()
        if not order:
            return ''
        db = connect()
        try:
            reason = _order_already_exists(db, order, hashlib.sha256(pdf_bytes).hexdigest(), ignore_review=True)
        finally:
            db.close()
        if not reason:
            try:
                if _nas_has_order(str(header.get('cliente') or ''), order):
                    reason = 'Esa orden ya tiene carpeta de producción en el NAS.'
            except (HTTPException, OSError):
                pass
        if reason:
            raise HTTPException(409, f'La orden {order} ya está en el sistema. ' + reason)
        return order
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/procesar/pedido", status_code=202)
async def upload_order(
    pdf: UploadFile = File(...),
    observaciones: str = Form(default='', max_length=5000),
    linea: str = Form(default='', max_length=40),
    excel: UploadFile = File(...),
    extras: list[UploadFile] = File(default=[]),
    mockup_d1: UploadFile = File(default=None),
    mockup_d2: UploadFile = File(default=None),
    mockup_d3: UploadFile = File(default=None),
    mockup_d4: UploadFile = File(default=None),
    _=Depends(authenticate),
):
    extras = ordered_mockup_uploads(extras, [mockup_d1, mockup_d2, mockup_d3, mockup_d4])
    try:
        await require_mockup_upload(extras)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not pdf.filename or Path(pdf.filename).suffix.lower() != ".pdf":
        raise HTTPException(400, "El primer archivo debe ser un PDF")
    if not excel.filename or Path(excel.filename).suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HTTPException(400, "El listado debe ser un archivo .xlsx o .xlsm")
    valid_extras = [item for item in extras if item.filename]
    files = [pdf, excel, *valid_extras]
    contents = []
    total = 0
    for item in files:
        content = await item.read()
        total += len(content)
        if total > 75 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 75 MB")
        contents.append(content)
    checked_order = await asyncio.to_thread(_reject_existing_order, contents[0], pdf.filename)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "pedidos" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    saved = []
    for index, (item, content) in enumerate(zip(files, contents)):
        name = Path(item.filename or f"anexo-{index}").name
        target = job_dir / name
        if target.exists():
            target = job_dir / f"{index}_{name}"
        target.write_bytes(content)
        saved.append(target)
    now = datetime.now(timezone.utc).isoformat()
    display_name = f"{saved[0].name} + {saved[1].name}"
    if valid_extras:
        display_name += f" + {len(valid_extras)} anexo(s)"
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,status,detail,created_at,updated_at,kind,input_summary,order_number) VALUES(?,?,?,?,?,?,?,?)",
            (display_name, "RECIBIDO", "En cola", now, now, "pedido", json.dumps({'observaciones': observaciones.strip(), 'linea': linea.strip()}, ensure_ascii=False), checked_order or None),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_order_job, job_id, job_dir, saved[0], saved[1], observaciones.strip(), str(_), linea.strip()))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El pedido se está procesando"}


@app.post("/crear-xlsx/vista-previa")
async def preview_xlsx(
    nombre_archivo: str = Form(...),
    hoja_nombres: list[str] = Form(...),
    datos_hoja: list[UploadFile] = File(...),
    mockups: list[UploadFile] = File(default=[]),
    mockup_slots: list[str] = Form(default=[]),
    _=Depends(authenticate),
):
    """Guarda un borrador y devuelve filas editables antes de crear el Excel."""
    if not datos_hoja or len(datos_hoja) != len(hoja_nombres):
        raise HTTPException(400, "Cada pestaña debe tener su archivo con los datos")
    if len(datos_hoja) > 30 or len(mockups) != len(mockup_slots):
        raise HTTPException(400, "La carga no corresponde con las pestañas seleccionadas")
    output_name = normalize_output_name(nombre_archivo)
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    token = secrets.token_urlsafe(24)
    draft_dir = UPLOAD_DIR / "creator-preview" / token
    draft_dir.mkdir(parents=True, exist_ok=False)
    sheets, total = [], 0
    for index, (name, upload) in enumerate(zip(hoja_nombres, datos_hoja)):
        filename = Path(upload.filename or "").name
        if not filename or Path(filename).suffix.lower() not in allowed:
            raise HTTPException(400, f"El archivo de la pestaña {index + 1} no es compatible")
        content = await upload.read()
        total += len(content)
        path = draft_dir / f"H{index + 1}_DATOS_{filename}"
        path.write_bytes(content)
        extracted = await asyncio.to_thread(_data_from_source, path)
        extracted.pop("OCR", None)
        sheets.append({
            "sheet_name": (name or "").strip(), "data_image": str(path),
            "data_filename": filename, "images": [], "extracted": extracted,
        })
    for slot, upload in zip(mockup_slots, mockups):
        try:
            sheet_index, design = (int(value) for value in slot.split(":", 1))
        except (ValueError, AttributeError):
            raise HTTPException(400, "Posición de mockup inválida")
        filename = Path(upload.filename or "").name
        if not (0 <= sheet_index < len(sheets) and 1 <= design <= 4) or Path(filename).suffix.lower() not in image_allowed:
            raise HTTPException(400, "Uno de los mockups no es compatible")
        content = await upload.read()
        total += len(content)
        if total > 100 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de archivos supera 100 MB")
        path = draft_dir / f"H{sheet_index + 1}_D{design}_{filename}"
        path.write_bytes(content)
        sheets[sheet_index]["images"].append([design, str(path)])
    manifest = {"output_name": output_name, "sheets": sheets}
    (draft_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return {
        "draft_id": token, "workbook_name": output_name,
        "sheets": [{
            "name": sheet["sheet_name"], "filename": sheet["data_filename"],
            "rows": sheet["extracted"].get("FILAS") or [],
            "mockups": [{
                "design": design,
                "url": f"/crear-xlsx/vista-previa/{token}/mockup/{index}/{design}",
            } for design, _path in sorted(sheet["images"], key=lambda item: item[0])],
        } for index, sheet in enumerate(sheets)],
    }


@app.get("/crear-xlsx/vista-previa/{token}/mockup/{sheet_index}/{design}")
async def preview_xlsx_mockup(
    token: str, sheet_index: int, design: int, _=Depends(authenticate),
):
    """Muestra de forma segura un mockup guardado en el borrador de vista previa."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
        raise HTTPException(400, "La vista previa no es válida")
    draft_dir = (UPLOAD_DIR / "creator-preview" / token).resolve()
    preview_root = (UPLOAD_DIR / "creator-preview").resolve()
    if preview_root not in draft_dir.parents:
        raise HTTPException(400, "La vista previa no es válida")
    manifest_path = draft_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, "La vista previa venció")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sheets = manifest.get("sheets") or []
    if not 0 <= sheet_index < len(sheets):
        raise HTTPException(404, "El diseño no existe")
    for saved_design, raw_path in sheets[sheet_index].get("images") or []:
        if int(saved_design) == design:
            image_path = Path(raw_path).resolve()
            if draft_dir not in image_path.parents or not image_path.exists():
                raise HTTPException(404, "El diseño no existe")
            return FileResponse(image_path)
    raise HTTPException(404, "El diseño no existe")


@app.post("/crear-xlsx/confirmar", status_code=202)
async def confirm_xlsx(payload: dict = Body(...), _=Depends(authenticate)):
    token = str(payload.get("draft_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
        raise HTTPException(400, "La vista previa no es válida")
    draft_dir = (UPLOAD_DIR / "creator-preview" / token).resolve()
    preview_root = (UPLOAD_DIR / "creator-preview").resolve()
    if preview_root not in draft_dir.parents:
        raise HTTPException(400, "La vista previa no es válida")
    manifest_path = draft_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, "La vista previa venció; vuelve a cargar los archivos")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    edited = payload.get("sheets") or []
    if len(edited) != len(manifest["sheets"]):
        raise HTTPException(400, "Las pestañas editadas no coinciden con la vista previa")
    sheets = []
    for original, changes in zip(manifest["sheets"], edited):
        rows = changes.get("rows") or []
        if not rows:
            raise HTTPException(400, "Cada pestaña debe conservar al menos una fila")
        extracted = dict(original["extracted"])
        extracted["FILAS"] = rows
        extracted["CANTIDAD"] = str(len(rows))
        sheets.append({
            "sheet_name": str(changes.get("name") or original["sheet_name"]).strip(),
            "data_image": Path(original["data_image"]),
            "images": sorted(((int(design), Path(path)) for design, path in original["images"]), key=lambda item: item[0]),
            "extracted_override": extracted,
        })
    output_name = normalize_output_name(str(payload.get("workbook_name") or manifest["output_name"]))
    now = datetime.now(timezone.utc).isoformat()
    summary = json.dumps({"workbook_name": output_name, "sheets": [{"name": s["sheet_name"]} for s in sheets]}, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", f"{len(sheets)} PESTAÑAS", "RECIBIDO", "Datos confirmados; preparando Excel", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_bundle_job, job_id, sheets, output_name))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "Vista previa confirmada"}


@app.post("/crear-xlsx", status_code=202)
async def create_xlsx(
    datos: UploadFile = File(...),
    nombre_archivo: str = Form(...),
    nombre_hoja: str = Form(default=""),
    d1: UploadFile | None = File(None), d2: UploadFile | None = File(None),
    d3: UploadFile | None = File(None), d4: UploadFile | None = File(None),
    _=Depends(authenticate),
):
    valid = [(design, item) for design, item in enumerate((d1, d2, d3, d4), start=1) if item and item.filename]
    if not datos.filename:
        raise HTTPException(400, "Debes subir el archivo con los datos del listado")
    try:
        output_name = normalize_output_name(nombre_archivo)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "creador-xlsx" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    paths, total = [], 0
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    data_name = Path(datos.filename).name
    if Path(data_name).suffix.lower() not in allowed:
        raise HTTPException(400, "El archivo de datos no tiene un formato compatible")
    data_content = await datos.read()
    total += len(data_content)
    data_path = job_dir / f"DATOS_{data_name}"
    data_path.write_bytes(data_content)
    for design, image in valid:
        name = Path(image.filename).name
        if Path(name).suffix.lower() not in image_allowed:
            raise HTTPException(400, f"{name} no es una imagen compatible")
        content = await image.read()
        total += len(content)
        if total > 40 * 1024 * 1024:
            raise HTTPException(413, "Las imágenes superan 40 MB")
        path = job_dir / f"D{design}_{name}"
        path.write_bytes(content)
        paths.append((design, path))
    now = datetime.now(timezone.utc).isoformat()
    auto_ref = f"IMG-{datetime.now():%Y%m%d-%H%M%S}"
    summary = json.dumps({
        "workbook_name": output_name,
        "sheets": [{
            "name": nombre_hoja,
            "data_filename": data_name,
            "mockups": [{"design": design, "filename": Path(image.filename).name} for design, image in valid],
        }],
    }, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", auto_ref, "RECIBIDO", "En cola para análisis visual", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_job, job_id, data_path, paths, output_name, nombre_hoja))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": "El asistente está analizando los archivos"}


@app.post("/crear-xlsx-multiple", status_code=202)
async def create_xlsx_multiple(
    nombre_archivo: str = Form(...),
    hoja_nombres: list[str] = Form(...),
    datos_hoja: list[UploadFile] = File(...),
    mockups: list[UploadFile] = File(default=[]),
    mockup_slots: list[str] = Form(default=[]),
    _=Depends(authenticate),
):
    if not datos_hoja or len(datos_hoja) != len(hoja_nombres):
        raise HTTPException(400, "Cada pestaña debe tener su archivo con los datos")
    if len(datos_hoja) > 30:
        raise HTTPException(400, "El máximo es de 30 pestañas por archivo")
    if len(mockups) != len(mockup_slots):
        raise HTTPException(400, "Los mockups recibidos no corresponden a sus pestañas")
    try:
        output_name = normalize_output_name(nombre_archivo)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    image_allowed = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
    allowed = image_allowed | {".xlsx", ".xls", ".xlsm", ".doc", ".docx", ".pdf", ".csv", ".tsv", ".txt"}
    stamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    job_dir = UPLOAD_DIR / "creador-xlsx-multiple" / stamp
    job_dir.mkdir(parents=True, exist_ok=False)
    sheets, total = [], 0
    for index, (name, upload) in enumerate(zip(hoja_nombres, datos_hoja)):
        if not upload.filename or Path(upload.filename).suffix.lower() not in allowed:
            raise HTTPException(400, f"El archivo de datos de la pestaña {index + 1} no es compatible")
        content = await upload.read()
        total += len(content)
        path = job_dir / f"H{index + 1}_DATOS_{Path(upload.filename).name}"
        path.write_bytes(content)
        sheets.append({"sheet_name": (name or "").strip(), "data_image": path, "images": []})
    for slot, upload in zip(mockup_slots, mockups):
        try:
            sheet_index, design = (int(value) for value in slot.split(":", 1))
        except (ValueError, AttributeError):
            raise HTTPException(400, "Posición de mockup inválida")
        if not (0 <= sheet_index < len(sheets) and 1 <= design <= 4):
            raise HTTPException(400, "Posición de mockup fuera de rango")
        if not upload.filename or Path(upload.filename).suffix.lower() not in image_allowed:
            raise HTTPException(400, "Uno de los mockups no es una imagen compatible")
        content = await upload.read()
        total += len(content)
        if total > 100 * 1024 * 1024:
            raise HTTPException(413, "El conjunto de imágenes supera 100 MB")
        path = job_dir / f"H{sheet_index + 1}_D{design}_{Path(upload.filename).name}"
        path.write_bytes(content)
        sheets[sheet_index]["images"].append((design, path))
    now = datetime.now(timezone.utc).isoformat()
    summary_sheets = [{
        "name": sheet["sheet_name"],
        "data_filename": Path(sheet["data_image"]).name.split("_DATOS_", 1)[-1],
        "mockups": [{"design": design, "filename": Path(path).name.split(f"_D{design}_", 1)[-1]} for design, path in sheet["images"]],
    } for sheet in sheets]
    summary = json.dumps({"workbook_name": output_name, "sheets": summary_sheets}, ensure_ascii=False)
    with connect() as db:
        cursor = db.execute(
            "INSERT INTO jobs(filename,order_number,status,detail,created_at,updated_at,kind,input_summary) VALUES(?,?,?,?,?,?,?,?)",
            (f"{output_name}.xlsx", f"{len(sheets)} PESTAÑAS", "RECIBIDO", "En cola para análisis visual", now, now, "creador", summary),
        )
        job_id = cursor.lastrowid
    asyncio.create_task(asyncio.to_thread(process_creator_bundle_job, job_id, sheets, output_name))
    return {"id": job_id, "estado": "RECIBIDO", "mensaje": f"Analizando {len(sheets)} pestaña(s)"}


@app.get("/descargar/{job_id}")
def download_xlsx(job_id: int, _=Depends(authenticate)):
    with connect() as db:
        row = db.execute("SELECT result_file FROM jobs WHERE id=? AND kind='creador'", (job_id,)).fetchone()
    if not row or not row["result_file"]:
        raise HTTPException(404, "El archivo todavía no está disponible")
    path = Path(row["result_file"]).resolve()
    allowed_root = (STATE_DIR / "generated").resolve()
    if allowed_root not in path.parents or not path.is_file():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/procesos")
def jobs(_=Depends(authenticate)):
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT 100")]
