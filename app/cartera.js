// cartera.js — el HTML ya existe en el DOM al cargar este script
'use strict';

const _ctBody      = document.getElementById('cartera-body');
const _ctStatus    = document.getElementById('cartera-status');
const _ctSearch    = document.getElementById('cartera-search');
const _ctSync      = document.getElementById('btn-cartera-sync');
const _ctKpiTotal  = document.getElementById('ct-kpi-total');
const _ctKpiSaldo  = document.getElementById('ct-kpi-saldo');
const _ctKpiAct    = document.getElementById('ct-kpi-activas');

// Input oculto reutilizable para seleccionar archivos PDF
const _ctFileInput = (() => {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = 'application/pdf,.pdf';
  el.className = 'ct-pdf-upload';
  document.body.appendChild(el);
  return el;
})();

let _ctData = null;

function _e(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function _fmt(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}

function _updateKpis() {
  if (!_ctData) return;
  const docs = _ctData.documentos;
  const totalSaldo = docs.reduce((s, d) => s + (d.saldo || 0), 0);
  const activas    = docs.filter(d => d.saldo > 0).length;
  if (_ctKpiTotal) _ctKpiTotal.textContent = docs.length;
  if (_ctKpiSaldo) _ctKpiSaldo.textContent = '$ ' + Math.round(totalSaldo).toLocaleString('es-CO');
  if (_ctKpiAct)   _ctKpiAct.textContent   = activas;
}

function _pdfCell(d) {
  if (d.has_pdf) {
    return '<td><a href="/api/cartera/pdf/' + encodeURIComponent(d.numero) +
      '" target="_blank" rel="noopener" class="ct-pdf-btn ct-has-pdf" title="Ver PDF">📄 Ver PDF</a></td>';
  }
  return '<td><button type="button" class="ct-pdf-btn" ' +
    'data-ct-upload="' + _e(d.numero) + '" title="Subir PDF">⬆ Subir PDF</button></td>';
}

function carteraRender() {
  if (!_ctData) return;
  _updateKpis();
  const q = (_ctSearch.value || '').trim().toLowerCase();
  const docs = _ctData.documentos.filter(d =>
    !q ||
    (d.cliente  || '').toLowerCase().includes(q) ||
    (d.numero   || '').toLowerCase().includes(q) ||
    (d.vendedor || '').toLowerCase().includes(q)
  );
  if (!docs.length) {
    _ctBody.innerHTML =
      '<tr><td colspan="8" class="ct-empty">' +
      (q ? 'Sin resultados para «' + _e(q) + '».' : 'No hay cotizaciones. Presiona Sincronizar.') +
      '</td></tr>';
    return;
  }
  _ctBody.innerHTML = docs.map(d => {
    const cls = d.saldo > 0 ? 'ct-pend' : 'ct-ok';
    return '<tr>' +
      '<td>'                            + _e(d.numero)           + '</td>' +
      '<td>'                            + _e(d.cliente)          + '</td>' +
      '<td>'                            + _e(d.vendedor || '—')  + '</td>' +
      '<td>'                            + _e(d.fecha    || '—')  + '</td>' +
      '<td class="ct-num">'             + _fmt(d.total)          + '</td>' +
      '<td class="ct-num ' + cls + '">' + _fmt(d.saldo)          + '</td>' +
      '<td><span class="ct-badge ct-'  + _e(d.estado) + '">'    + _e(d.estado) + '</span></td>' +
      _pdfCell(d) +
      '</tr>';
  }).join('');
}

async function loadCartera() {
  _ctStatus.textContent = 'Cargando datos…';
  try {
    const r = await fetch('/api/cartera/datos');
    if (!r.ok) throw new Error('Error ' + r.status);
    _ctData = await r.json();
    carteraRender();
    if (_ctData.ultima_sync) {
      const t = new Date(_ctData.ultima_sync)
        .toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });
      _ctStatus.textContent = _ctData.documentos.length + ' cotizaciones · sincronizado ' + t;
    } else {
      _ctStatus.textContent = 'Sin datos. Presiona Sincronizar para importar desde Google Sheets.';
    }
  } catch (e) {
    _ctStatus.textContent = 'Error cargando datos: ' + e.message;
  }
}

// Delegación de eventos: click en botones "Subir PDF"
if (_ctBody) {
  _ctBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-ct-upload]');
    if (!btn) return;
    const numero = btn.dataset.ctUpload;
    _ctFileInput.value = '';
    _ctFileInput.onchange = async () => {
      const file = _ctFileInput.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Subiendo…';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/cartera/pdf/' + encodeURIComponent(numero), {
          method: 'POST', body: fd,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || 'Error al subir');
        // Actualizar has_pdf en los datos locales sin recargar todo
        const doc = _ctData.documentos.find(x => x.numero === numero);
        if (doc) doc.has_pdf = true;
        carteraRender();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '⬆ Subir PDF';
        _ctStatus.textContent = 'Error al subir PDF: ' + err.message;
      }
    };
    _ctFileInput.click();
  });
}

if (_ctSync) {
  _ctSync.addEventListener('click', async () => {
    _ctSync.disabled = true;
    _ctSync.textContent = 'Sincronizando…';
    _ctStatus.textContent = 'Leyendo desde Google Sheets…';
    try {
      const r = await fetch('/api/cartera/sincronizar', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Error al sincronizar');
      await loadCartera();
    } catch (e) {
      _ctStatus.textContent = 'Error: ' + e.message;
    } finally {
      _ctSync.disabled = false;
      _ctSync.textContent = '↻ Sincronizar';
    }
  });
}

if (_ctSearch) {
  _ctSearch.addEventListener('input', carteraRender);
}
