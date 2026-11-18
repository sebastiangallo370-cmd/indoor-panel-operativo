// Enviar varias órdenes a Confección: una por una, cada una con su confeccionista, WhatsApp y precio.
// 1) En Producción se marcan tarjetas con la casilla; el botón CONFECCIÓN (n) abre el envío solo con esas.
// 2) En el panel de Confección, ENVIAR VARIAS permite elegir el cliente y sus órdenes.
// Reutiliza los mismos endpoints (cada orden se envía igual que con el botón normal).
(function () {
  'use strict';
  var norm = function (s) { return String(s || '').trim().toUpperCase(); };
  var api = async function (url, opts) {
    opts = opts || {};
    var r = await fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) }));
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.detail || ('Error ' + r.status));
    return d;
  };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var seleccion = new Set();

  function infoFilas(datos) {
    var h = (datos.headers || []).map(norm);
    var i = function (n) { return h.indexOf(n); };
    var out = {};
    (datos.rows || []).forEach(function (r) {
      var v = r.values || [];
      var orden = String(v[i('ORDEN')] || '').trim();
      if (!orden) return;
      out[r.source_row] = {
        row: r.source_row,
        cliente: String(v[i('NOMBRE DEL CLIENTE')] || v[i('CLIENTE')] || '').trim() || 'Sin cliente',
        orden: orden,
        referencia: String(v[i('REFERENCIA')] || '').trim(),
        cantidad: String(v[i('CANTIDAD')] || '').trim()
      };
    });
    return out;
  }

  // ---------- Producción: casillas en las tarjetas y botón flotante ----------
  var boton = null;
  function actualizarBoton() {
    if (!seleccion.size) { if (boton) boton.style.display = 'none'; return; }
    if (!boton) {
      boton = document.createElement('button');
      boton.type = 'button';
      boton.id = 'cv-btn';
      boton.style.cssText = 'position:fixed;right:22px;bottom:70px;z-index:9000;padding:14px 20px;border:0;border-radius:999px;background:#d0f44c;color:#13210b;font-weight:700;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.45);cursor:pointer';
      boton.onclick = function () { abrir(Array.from(seleccion)); };
      document.body.appendChild(boton);
    }
    boton.style.display = '';
    boton.textContent = 'CONFECCIÓN (' + seleccion.size + ')';
  }
  function marcarTarjetas() {
    document.querySelectorAll('.trace-card[data-card-row]').forEach(function (card) {
      if (card.querySelector('.cv-sel')) return;
      var fila = card.dataset.cardRow;
      var caja = document.createElement('input');
      caja.type = 'checkbox';
      caja.className = 'cv-sel';
      caja.title = 'Seleccionar para enviar a Confección';
      caja.checked = seleccion.has(String(fila));
      caja.style.cssText = 'position:absolute;top:10px;left:10px;z-index:5;width:20px;height:20px;cursor:pointer;accent-color:#d0f44c';
      caja.onchange = function () {
        if (caja.checked) seleccion.add(String(fila)); else seleccion.delete(String(fila));
        actualizarBoton();
      };
      caja.onclick = function (e) { e.stopPropagation(); };
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.appendChild(caja);
    });
  }
  new MutationObserver(marcarTarjetas).observe(document.body, { childList: true, subtree: true });
  marcarTarjetas();

  // ---------- Modal de envío ----------
  var modal = null;
  function cerrar() { if (modal) { modal.remove(); modal = null; } }

  function crearModal(titulo) {
    cerrar();
    modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,10,7,.92);display:flex;align-items:center;justify-content:center;padding:18px';
    modal.innerHTML = '<div style="width:min(1040px,100%);max-height:92vh;overflow:auto;background:#101a13;border:1px solid #2e4a35;border-radius:16px;padding:20px;color:#e8f0e2;font-family:Arial">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 style="margin:0;color:#d0f44c;font-size:18px">' + esc(titulo) + '</h2><button type="button" data-cerrar style="border:0;background:#23352a;color:#e8f0e2;border-radius:999px;padding:8px 14px;cursor:pointer">Cerrar</button></div>' +
      '<p style="color:#a9b5a3;font-size:13px">Cada orden se envía en su propio mensaje, con su precio. Marca las que quieres enviar.</p>' +
      '<div data-cuerpo></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('[data-cerrar]').onclick = cerrar;
    return modal.querySelector('[data-cuerpo]');
  }

  // Abre el envío con las tarjetas marcadas en Producción
  async function abrir(rows) {
    var cuerpo = crearModal('ENVIAR A CONFECCIÓN · ' + rows.length + ' ORDEN(ES)');
    cuerpo.innerHTML = '<div style="color:#a9b5a3">Cargando órdenes…</div>';
    try {
      var datos = await api('/api/produccion');
      var info = infoFilas(datos);
      var ordenes = rows.map(function (r) { return info[r]; }).filter(Boolean);
      await mostrarOrdenes(ordenes, cuerpo);
    } catch (error) {
      cuerpo.innerHTML = '<div style="color:#ff8982">' + esc(error.message) + '</div>';
    }
  }

  // Abre el envío desde el panel de Confección: elige el cliente
  async function abrirPorCliente() {
    var cuerpo = crearModal('ENVIAR VARIAS ÓRDENES · MISMO CLIENTE');
    cuerpo.innerHTML = '<div style="color:#a9b5a3">Cargando órdenes…</div>';
    try {
      var datos = await api('/api/produccion');
      var info = infoFilas(datos);
      var grupos = {};
      Object.keys(info).forEach(function (k) { var o = info[k]; (grupos[o.cliente] = grupos[o.cliente] || []).push(o); });
      var clientes = Object.keys(grupos).sort();
      cuerpo.innerHTML = '<label style="display:block;margin:10px 0;font-size:12px;color:#a9b5a3">CLIENTE<select data-cliente style="display:block;width:100%;margin-top:4px;padding:10px;border-radius:10px;background:#0b130d;color:#e8f0e2;border:1px solid #2e4a35"><option value="">Elige el cliente…</option>' + clientes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label><div data-lista></div>';
      cuerpo.querySelector('[data-cliente]').onchange = function (e) { mostrarOrdenes(grupos[e.target.value] || [], cuerpo.querySelector('[data-lista]')); };
    } catch (error) {
      cuerpo.innerHTML = '<div style="color:#ff8982">' + esc(error.message) + '</div>';
    }
  }

  async function mostrarOrdenes(ordenes, lugar) {
    lugar = lugar || modal.querySelector('[data-cuerpo]');
    if (!ordenes.length) { lugar.innerHTML = '<p style="color:#a9b5a3">No hay órdenes para enviar.</p>'; return; }
    lugar.innerHTML = '<p style="color:#a9b5a3;font-size:13px">Consultando confeccionistas de cada orden…</p><div data-estado style="margin-top:12px;color:#d0f44c;font-size:13px"></div>';
    var detalles = await Promise.all(ordenes.map(function (o) {
      return api('/api/produccion/fila/' + o.row + '/confeccion').catch(function () { return {}; });
    }));
    lugar.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px"><thead><tr style="color:#a9b5a3;text-align:left"><th></th><th>CLIENTE</th><th>ORDEN</th><th>REFERENCIA</th><th>CANT.</th><th>CONFECCIONISTA</th><th>WHATSAPP</th><th>PRECIO / PRENDA</th></tr></thead><tbody>' +
      ordenes.map(function (o, k) {
        var d = detalles[k] || {};
        var nombres = d.confeccionistas || [];
        var wa = d.whatsapps || {};
        var guardado = (d.preparacion || {}).confeccionista || '';
        return '<tr data-fila="' + o.row + '" style="border-top:1px solid #2e4a35"><td><input type="checkbox" data-marca checked></td><td>' + esc(o.cliente) + '</td><td>' + esc(o.orden) + '</td><td>' + esc(o.referencia) + '</td><td>' + esc(o.cantidad) + '</td>' +
          '<td><select data-maker style="padding:6px;border-radius:8px;background:#0b130d;color:#e8f0e2;border:1px solid #2e4a35"><option value="">—</option>' + nombres.map(function (n) { return '<option' + (n === guardado ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></td>' +
          '<td><input data-phone value="' + esc(wa[guardado] || '') + '" style="width:130px;padding:6px;border-radius:8px;background:#0b130d;color:#e8f0e2;border:1px solid #2e4a35"></td>' +
          '<td><input data-precio placeholder="5200" style="width:90px;padding:6px;border-radius:8px;background:#0b130d;color:#e8f0e2;border:1px solid #2e4a35"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<button type="button" data-enviar style="margin-top:14px;padding:12px 18px;border:0;border-radius:999px;background:#d0f44c;color:#13210b;font-weight:700;cursor:pointer">Enviar seleccionadas</button>';
    var filas = Array.prototype.slice.call(lugar.querySelectorAll('tbody tr'));
    filas.forEach(function (tr, k) {
      var sel = tr.querySelector('[data-maker]');
      sel.onchange = function () { tr.querySelector('[data-phone]').value = ((detalles[k] || {}).whatsapps || {})[sel.value] || ''; };
    });
    lugar.querySelector('[data-enviar]').onclick = function () { enviar(lugar); };
  }

  async function enviar(lugar) {
    var estado = lugar.querySelector('[data-estado]');
    var filas = Array.prototype.slice.call(lugar.querySelectorAll('tbody tr')).filter(function (tr) { return tr.querySelector('[data-marca]').checked; });
    if (!filas.length) { estado.textContent = 'Marca al menos una orden.'; return; }
    var ok = 0;
    for (var k = 0; k < filas.length; k++) {
      var tr = filas[k];
      var orden = tr.children[2].textContent;
      var maker = tr.querySelector('[data-maker]').value;
      var phone = tr.querySelector('[data-phone]').value.trim();
      var amount = Number(String(tr.querySelector('[data-precio]').value).replace(/[^0-9.]/g, ''));
      if (!maker || !(amount > 0)) { estado.textContent = 'Falta confeccionista o precio en la orden ' + orden + '. Se detuvo el envío.'; return; }
      estado.textContent = 'Enviando ' + (k + 1) + ' de ' + filas.length + ' (' + orden + ')…';
      try {
        await api('/api/produccion/fila/' + tr.dataset.fila + '/confeccion', { method: 'POST', body: JSON.stringify({ confeccionista: maker, whatsapp: phone, precio_prenda: amount }) });
        ok++;
      } catch (error) {
        estado.textContent = 'Error en la orden ' + orden + ': ' + error.message + '. Enviadas: ' + ok + '.';
        return;
      }
    }
    estado.textContent = 'Listo: ' + ok + ' de ' + filas.length + ' órdenes enviadas al agente de Confección.';
    seleccion.clear();
    document.querySelectorAll('.cv-sel').forEach(function (c) { c.checked = false; });
    actualizarBoton();
  }

  // Botón en la barra del panel de Confección
  function ponerBotonPanel() {
    var barra = document.querySelector('.confeccion-panel .cf-tabbar');
    if (!barra || barra.querySelector('[data-varias]')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.varias = '1';
    b.textContent = 'ENVIAR VARIAS';
    b.style.cssText = 'margin-left:auto;padding:10px 16px;border:0;border-radius:999px;background:#d0f44c;color:#13210b;font-weight:700;cursor:pointer';
    b.onclick = abrirPorCliente;
    barra.appendChild(b);
  }
  new MutationObserver(ponerBotonPanel).observe(document.body, { childList: true, subtree: true });
  ponerBotonPanel();
})();
