// cartera.js — el HTML ya existe en el DOM al cargar este script
'use strict';

const _ctBody   = document.getElementById('cartera-body');
const _ctStatus = document.getElementById('cartera-status');
const _ctSearch = document.getElementById('cartera-search');
const _ctSync   = document.getElementById('btn-cartera-sync');

let _ctData = null;

function _e(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function _fmt(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-CO');
}

function carteraRender() {
  if (!_ctData) return;
  const q = (_ctSearch.value || '').trim().toLowerCase();
  const docs = _ctData.documentos.filter(d =>
    !q ||
    (d.cliente  || '').toLowerCase().includes(q) ||
    (d.numero   || '').toLowerCase().includes(q) ||
    (d.vendedor || '').toLowerCase().includes(q)
  );
  if (!docs.length) {
    _ctBody.innerHTML =
      '<tr><td colspan="7" class="ct-empty">' +
      (q ? 'Sin resultados para «' + _e(q) + '».' : 'No hay cotizaciones. Presiona Sincronizar.') +
      '</td></tr>';
    return;
  }
  _ctBody.innerHTML = docs.map(d => {
    const cls = d.saldo > 0 ? 'ct-pend' : 'ct-ok';
    return '<tr>' +
      '<td>'                           + _e(d.numero)           + '</td>' +
      '<td>'                           + _e(d.cliente)          + '</td>' +
      '<td>'                           + _e(d.vendedor || '—')  + '</td>' +
      '<td>'                           + _e(d.fecha    || '—')  + '</td>' +
      '<td class="ct-num">'            + _fmt(d.total)          + '</td>' +
      '<td class="ct-num ' + cls + '">'+ _fmt(d.saldo)          + '</td>' +
      '<td><span class="ct-badge ct-' + _e(d.estado) + '">'    + _e(d.estado) + '</span></td>' +
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
