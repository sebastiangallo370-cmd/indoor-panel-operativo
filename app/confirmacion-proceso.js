// Confirmación animada al cambiar el estado de un proceso (iniciar, finalizar, pausar, reproceso…).
// Escucha las respuestas correctas de /api/produccion/operacion, así cubre las tarjetas y el formulario de operarios sin tocar su código.
(function () {
  if (window.__confirmacionProceso) return; window.__confirmacionProceso = true;
  var TIPOS = {
    start:  { titulo: 'EN PROCESO',  color: '#d0f44c', icono: '<path d="M39 30 L39 66 L68 48 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' },
    resume: { titulo: 'REANUDADO',   color: '#d0f44c', icono: '<path d="M39 30 L39 66 L68 48 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' },
    finish: { titulo: 'FINALIZADO',  color: '#6fe07a', icono: '<path class="cp-trazo" pathLength="1" d="M29 49 L43 63 L68 35" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>', chispas: true },
    pause:  { titulo: 'PAUSADO',     color: '#ffbd4a', icono: '<path d="M38 31 V65 M58 31 V65" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>' },
    rework: { titulo: 'REPROCESO',   color: '#ff6b61', icono: '<path class="cp-trazo" pathLength="1" d="M66 40 A20 20 0 1 0 68 54 M66 27 V41 H52" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' },
    na:     { titulo: 'NO APLICA',   color: '#a7b0a0', icono: '<path class="cp-trazo" pathLength="1" d="M32 64 L64 32" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>' },
    clear:  { titulo: 'PENDIENTE',   color: '#a7b0a0', icono: '<path class="cp-trazo" pathLength="1" d="M34 48 H62" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>' }
  };
  var quieto = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var estilo = document.createElement('style');
  estilo.textContent =
    '#cp-capa{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(5,6,5,.55),rgba(5,6,5,0) 55%);animation:cpCapa 1.7s ease forwards}' +
    '#cp-capa .cp-caja{display:grid;justify-items:center;gap:12px;padding:26px 38px 22px;border-radius:24px;background:rgba(10,14,10,.93);border:1px solid var(--cp);box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 60px color-mix(in srgb,var(--cp) 30%,transparent);color:var(--cp);animation:cpCaja 1.7s cubic-bezier(.2,1.3,.4,1) forwards}' +
    '#cp-capa svg{width:104px;height:104px;overflow:visible}' +
    '#cp-capa .cp-aro{fill:color-mix(in srgb,var(--cp) 12%,transparent);stroke:currentColor;stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transform:rotate(-90deg);transform-origin:48px 48px;animation:cpDibuja .5s ease-out .05s forwards}' +
    '#cp-capa .cp-trazo{stroke-dasharray:1;stroke-dashoffset:1;animation:cpDibuja .35s ease-out .4s forwards}' +
    '#cp-capa .cp-icono{transform-origin:48px 48px;animation:cpIcono .45s cubic-bezier(.2,1.6,.4,1) .3s both}' +
    '#cp-capa .cp-chispa{stroke:currentColor;stroke-width:4;stroke-linecap:round;opacity:0;transform-origin:48px 48px;animation:cpChispa .6s ease-out .55s forwards}' +
    '#cp-capa strong{font:900 20px/1 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-indent:.14em}' +
    '#cp-capa span{color:#f4f7ee;font:700 13px/1.2 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.04em;text-align:center;max-width:70vw}' +
    '.cp-destello{animation:cpDestello 1.5s ease-out 1!important;position:relative;z-index:2}' +
    '@keyframes cpCapa{0%{opacity:0}10%,78%{opacity:1}100%{opacity:0}}' +
    '@keyframes cpCaja{0%{transform:scale(.7);opacity:0}14%{transform:scale(1);opacity:1}80%{transform:scale(1);opacity:1}100%{transform:scale(.94) translateY(-10px);opacity:0}}' +
    '@keyframes cpDibuja{to{stroke-dashoffset:0}}@keyframes cpIcono{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}' +
    '@keyframes cpChispa{0%{opacity:1;stroke-dasharray:0 30;stroke-dashoffset:0}100%{opacity:0;stroke-dasharray:10 30;stroke-dashoffset:-16}}' +
    '@keyframes cpDestello{0%{box-shadow:0 0 0 0 var(--cp,#d0f44c),0 0 0 0 transparent}25%{box-shadow:0 0 0 4px var(--cp,#d0f44c),0 0 46px 6px var(--cp,#d0f44c)}100%{box-shadow:0 0 0 0 transparent,0 0 0 0 transparent}}' +
    '@media(prefers-reduced-motion:reduce){#cp-capa,#cp-capa *{animation-duration:.01s!important;animation-delay:0s!important}#cp-capa{animation:cpCapa 1.4s steps(1,end) forwards!important}}';
  document.head.appendChild(estilo);

  function tarjeta(fila) { return document.querySelector('.trace-card[data-card-row="' + fila + '"]'); }
  function ordenDe(fila) {
    var t = tarjeta(fila); if (!t) return '';
    var nodos = t.querySelectorAll('*');
    for (var i = 0; i < nodos.length; i++) {   // el número de orden es un elemento con solo ese texto (p. ej. IS2408)
      var texto = nodos[i].children.length ? '' : nodos[i].textContent.trim();
      if (/^[A-Z]{2}\s?-?\d{3,5}$/.test(texto)) return texto;
    }
    return '';
  }
  function mostrar(accion, fila, orden) {
    var tipo = TIPOS[accion]; if (!tipo) return;
    var vieja = document.getElementById('cp-capa'); if (vieja) vieja.remove();
    var chispas = '';
    if (tipo.chispas && !quieto) for (var i = 0; i < 10; i++) chispas += '<path class="cp-chispa" d="M48 -4 V-20" transform="rotate(' + i * 36 + ' 48 48)"/>';
    var capa = document.createElement('div');
    capa.id = 'cp-capa'; capa.setAttribute('role', 'status'); capa.style.setProperty('--cp', tipo.color);
    capa.innerHTML = '<div class="cp-caja"><svg viewBox="0 0 96 96" aria-hidden="true"><circle class="cp-aro" pathLength="1" cx="48" cy="48" r="42"/>' +
      '<g class="cp-icono">' + tipo.icono + '</g>' + chispas + '</svg><strong>' + tipo.titulo + '</strong>' + (orden ? '<span>Orden ' + orden + '</span>' : '') + '</div>';
    document.body.appendChild(capa);
    setTimeout(function () { capa.remove(); }, 1750);
    // La tarjeta se vuelve a dibujar tras la respuesta (a veces más de una vez): se resalta la que quede en pantalla.
    var resaltada = null, intentos = 0, reloj = setInterval(function () {
      var t = tarjeta(fila);
      if (t && t !== resaltada) { resaltada = t; t.style.setProperty('--cp', tipo.color); t.classList.add('cp-destello'); }
      if (++intentos >= 8) { clearInterval(reloj); setTimeout(function () { if (resaltada) resaltada.classList.remove('cp-destello'); }, 1200); }
    }, 200);
  }
  window.indoorConfirmarProceso = mostrar;

  // ---------- Agentes de edición: aviso animado cuando empiezan y cuando terminan un proceso ----------
  // Los agentes anotan su trabajo en el servidor (HORA INICIO / HORA FINAL con responsable «AGENT», o el estado del proceso a su nombre).
  // Aquí se compara cada actualización de /api/produccion con la anterior y se avisa de lo que cambió.
  var AGENTES = ['AGENT', 'AGENTE', 'AGENTES', 'TAVO', 'LEO', 'JACK', 'OLVER', 'OLIVER', 'TERRY'];
  var plano = function (t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); };
  var esAgente = function (t) { var p = plano(t); return !!p && AGENTES.some(function (a) { return p === a || p.indexOf(a + ' ') === 0 || p.indexOf(' ' + a) > 0; }); };
  var esFecha = function (v) { var p = plano(v); return !!p && p !== 'P' && p !== 'R' && p !== 'N/A' && /\d/.test(p); };
  var estiloAg = document.createElement('style');
  estiloAg.textContent =
    '#ag-pila{position:fixed;z-index:2147481000;right:18px;top:84px;display:grid;gap:10px;pointer-events:none;width:min(360px,calc(100vw - 24px))}' +
    '.ag-aviso{--ag:#d0f44c;position:relative;display:grid;grid-template-columns:58px 1fr;gap:12px;align-items:center;padding:13px 16px 15px 13px;border-radius:18px;background:rgba(10,14,10,.95);border:1px solid var(--ag);box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 34px color-mix(in srgb,var(--ag) 26%,transparent);color:#f4f7ee;overflow:hidden;animation:agEntra .55s cubic-bezier(.2,1.2,.3,1) both,agSale .45s ease 5.2s forwards}' +
    '.ag-aviso svg{width:58px;height:58px;color:var(--ag);overflow:visible}' +
    '.ag-aviso .ag-orbita{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-dasharray:38 120;transform-origin:32px 32px;animation:agGira 1.1s linear infinite}' +
    '.ag-aviso.fin .ag-orbita{stroke-dasharray:1;stroke-dashoffset:1;animation:agDibuja .5s ease-out .15s forwards}' +
    '.ag-aviso .ag-cara{transform-origin:32px 34px;animation:agLate 1.1s ease-in-out infinite}' +
    '.ag-aviso.fin .ag-cara{animation:agSalta .5s cubic-bezier(.2,1.6,.4,1) .2s both}' +
    '.ag-aviso .ag-ojo{animation:agParpadea 2.6s steps(1,end) infinite}' +
    '.ag-aviso .ag-chulo{fill:none;stroke:#0b0f0a;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:agDibuja .35s ease-out .55s forwards}' +
    '.ag-aviso small{display:block;color:var(--ag);font:800 10px/1 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.16em;margin-bottom:5px}' +
    '.ag-aviso strong{display:block;font:900 15px/1.2 Inter,"Segoe UI",system-ui,Arial,sans-serif}' +
    '.ag-aviso span{display:block;margin-top:3px;color:#a7b0a0;font:600 12px/1.3 Inter,"Segoe UI",system-ui,Arial,sans-serif}' +
    '.ag-aviso i{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--ag);transform-origin:left;animation:agTiempo 5.2s linear forwards}' +
    '.ag-aviso:not(.fin):after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,color-mix(in srgb,var(--ag) 16%,transparent) 50%,transparent 70%);transform:translateX(-100%);animation:agBarrido 1.6s ease-in-out .3s 2}' +
    '@keyframes agEntra{from{transform:translateX(120%);opacity:0}to{transform:none;opacity:1}}@keyframes agSale{to{transform:translateX(120%);opacity:0}}' +
    '@keyframes agGira{to{transform:rotate(360deg)}}@keyframes agDibuja{to{stroke-dashoffset:0}}' +
    '@keyframes agLate{50%{transform:scale(1.07)}}@keyframes agSalta{from{transform:scale(.5)}to{transform:none}}' +
    '@keyframes agParpadea{0%,92%{transform:none}94%,98%{transform:scaleY(.1)}}' +
    '@keyframes agTiempo{to{transform:scaleX(0)}}@keyframes agBarrido{to{transform:translateX(100%)}}' +
    '@media(max-width:700px){#ag-pila{top:auto;bottom:calc(84px + env(safe-area-inset-bottom));right:12px}}' +
    '@media(prefers-reduced-motion:reduce){.ag-aviso,.ag-aviso *{animation-duration:.01s!important;animation-iteration-count:1!important}.ag-aviso{animation:agSale .01s linear 5.2s forwards!important}}';
  document.head.appendChild(estiloAg);
  function avisoAgente(tipo, orden, area, fila) {
    var pila = document.getElementById('ag-pila');
    if (!pila) { pila = document.createElement('div'); pila.id = 'ag-pila'; pila.setAttribute('aria-live', 'polite'); document.body.appendChild(pila); }
    while (pila.children.length >= 3) pila.firstChild.remove();
    var fin = tipo === 'fin', aviso = document.createElement('div');
    aviso.className = 'ag-aviso' + (fin ? ' fin' : ''); aviso.style.setProperty('--ag', fin ? '#6fe07a' : '#d0f44c');
    aviso.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ag-orbita" ' + (fin ? 'pathLength="1" ' : '') + 'cx="32" cy="32" r="29"/>' +
      '<g class="ag-cara"><path d="M32 12 V18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="10" r="3" fill="currentColor"/>' +
      '<rect x="15" y="18" width="34" height="28" rx="9" fill="currentColor"/>' +
      (fin ? '<path class="ag-chulo" pathLength="1" d="M23 33 L30 40 L42 26"/>'
           : '<g class="ag-ojo" style="transform-origin:32px 30px"><circle cx="25" cy="30" r="3.6" fill="#0b0f0a"/><circle cx="39" cy="30" r="3.6" fill="#0b0f0a"/></g><path d="M25 39 H39" stroke="#0b0f0a" stroke-width="3" stroke-linecap="round"/>') +
      '</g></svg><div><small>AGENTES DE EDICIÓN</small><strong>' + (fin ? 'Finalizaron' : 'Empezaron') + (area ? ' ' + area : ' un proceso') + '</strong><span>' + (orden ? 'Orden ' + orden : 'Producción') + '</span></div><i></i>';
    pila.appendChild(aviso);
    setTimeout(function () { aviso.remove(); }, 5750);
    var t = fila != null && tarjeta(fila);
    if (t) { t.style.setProperty('--cp', fin ? '#6fe07a' : '#d0f44c'); t.classList.add('cp-destello'); setTimeout(function () { t.classList.remove('cp-destello'); }, 1600); }
  }
  window.indoorAvisoAgente = avisoAgente;

  var anterior = null;   // fila -> {celda: valor} de la última actualización
  function revisarAgentes(datos) {
    if (!datos || !Array.isArray(datos.rows) || !Array.isArray(datos.headers)) return;
    var cab = datos.headers.map(plano), grupos = (datos.groups || []).map(plano), iOrden = cab.indexOf('ORDEN');
    var flujo = (typeof indoorProcessFlow !== 'undefined' && indoorProcessFlow) || [];
    var etiquetaDe = function (i) { for (var k = 0; k < flujo.length; k++) if ((flujo[k].headers || []).indexOf(cab[i]) >= 0) return flujo[k].label; return ''; };
    var procesos = [], horas = [];
    cab.forEach(function (h, i) {
      if (etiquetaDe(i)) procesos.push(i);
      if (h === 'HORA INICIO' || h === 'HORA FINAL') {
        var resp = -1, proc = -1;
        cab.forEach(function (h2, j) { if (grupos[j] && grupos[j] === grupos[i]) { if (h2.indexOf('RESP') === 0) resp = j; if (etiquetaDe(j)) proc = j; } });
        horas.push({ i: i, fin: h === 'HORA FINAL', resp: resp, area: proc >= 0 ? etiquetaDe(proc) : (datos.groups || [])[i] || '' });
      }
    });
    var responsables = datos.process_responsibles || {}, actual = {}, avisos = [];
    datos.rows.forEach(function (fila) {
      var v = fila.values || [], id = fila.source_row, foto = {}, antes = anterior && anterior[id], vistos = {};
      var avisar = function (tipo, area) { var clave = tipo + area; if (!vistos[clave]) { vistos[clave] = 1; avisos.push([tipo, plano(v[iOrden]) ? String(v[iOrden]).trim() : '', area, id]); } };
      horas.forEach(function (h) {
        var valor = plano(v[h.i]); foto['h' + h.i] = valor;
        if (antes && valor && !antes['h' + h.i] && h.resp >= 0 && esAgente(v[h.resp])) avisar(h.fin ? 'fin' : 'inicio', h.area);
      });
      procesos.forEach(function (i) {
        var valor = plano(v[i]); foto['p' + i] = valor;
        if (!antes || antes['p' + i] === valor || !esAgente(responsables[id + ':' + (i + 1)])) return;
        if (valor === 'P' && antes['p' + i] !== 'P') avisar('inicio', etiquetaDe(i));
        else if (esFecha(valor) && !esFecha(antes['p' + i])) avisar('fin', etiquetaDe(i));
      });
      actual[id] = foto;
    });
    anterior = actual;   // la primera lectura solo deja la referencia: no se avisa de lo que ya estaba
    avisos.slice(0, 3).forEach(function (a, k) { setTimeout(function () { avisoAgente(a[0], a[1], a[2], a[3]); }, k * 450); });
  }
  window.__revisarAgentes = revisarAgentes;

  // ---------- Módulo AGENTES: animación cuando los agentes arrancan un trabajo y cuando lo terminan ----------
  // Se apoya en lo que el propio módulo consulta (/api/agentes/mensajes): «trabajo» aparece cuando el PC toma el pedido
  // y «esperando» vuelve a falso cuando responden. Solo se muestra con el módulo AGENTES abierto.
  var EQUIPO = ['TAVO', 'LEO', 'JACK', 'OLVER', 'OLIVER', 'TERRY'];
  var MODOS = {
    inicio:   { titulo: 'AGENTES EN MARCHA',  color: '#d0f44c' },
    fin:      { titulo: 'TRABAJO FINALIZADO', color: '#6fe07a' },
    error:    { titulo: 'TERMINÓ CON ERROR',  color: '#ff6b61' },
    detenido: { titulo: 'TRABAJO DETENIDO',   color: '#ffbd4a' }
  };
  var estiloAm = document.createElement('style');
  estiloAm.textContent =
    '#am-capa{position:fixed;inset:0;z-index:2147481500;display:grid;place-items:center;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(5,6,5,.72),rgba(5,6,5,.15) 60%);animation:amCapa 2.9s ease forwards}' +
    '#am-capa .am-caja{position:relative;display:grid;justify-items:center;gap:14px;padding:30px 44px 26px;border-radius:26px;background:rgba(10,14,10,.95);border:1px solid var(--am);box-shadow:0 26px 80px rgba(0,0,0,.65),0 0 70px color-mix(in srgb,var(--am) 30%,transparent);color:var(--am);overflow:hidden;animation:amCaja 2.9s cubic-bezier(.2,1.25,.35,1) forwards;max-width:calc(100vw - 28px)}' +
    '#am-capa svg{width:112px;height:112px;overflow:visible}' +
    '#am-capa .am-orbita{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-dasharray:40 150;transform-origin:32px 32px;animation:amGira 1s linear infinite}' +
    '#am-capa .am-orbita.b{stroke-dasharray:16 190;stroke-width:2;opacity:.6;animation-duration:1.7s;animation-direction:reverse}' +
    '#am-capa.fija .am-orbita{stroke-dasharray:1;stroke-dashoffset:1;animation:amDibuja .55s ease-out .1s forwards}#am-capa.fija .am-orbita.b{display:none}' +
    '#am-capa .am-cara{transform-origin:32px 34px;animation:amDespierta .7s cubic-bezier(.2,1.6,.4,1) both}' +
    '#am-capa .am-marca{fill:none;stroke:#0b0f0a;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:amDibuja .4s ease-out .6s forwards}' +
    '#am-capa .am-chispa{stroke:currentColor;stroke-width:3;stroke-linecap:round;opacity:0;animation:amChispa .65s ease-out .75s forwards}' +
    '#am-capa strong{font:900 21px/1 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-indent:.14em;text-align:center}' +
    '#am-capa .am-orden{color:#f4f7ee;font:700 13px/1.2 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.05em}' +
    '#am-capa .am-equipo{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:330px}' +
    '#am-capa .am-equipo b{padding:5px 10px;border-radius:99px;border:1px solid rgba(255,255,255,.16);color:#7d8778;font:800 10px/1 Inter,"Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.1em;animation:amEnciende .4s ease forwards;animation-delay:calc(.45s + var(--i) * .13s)}' +
    '#am-capa .am-barrido{position:absolute;inset:0;background:linear-gradient(100deg,transparent 32%,color-mix(in srgb,var(--am) 18%,transparent) 50%,transparent 68%);transform:translateX(-100%);animation:amBarrido 1.3s ease-in-out .35s 2}' +
    '@keyframes amCapa{0%{opacity:0}8%,86%{opacity:1}100%{opacity:0}}' +
    '@keyframes amCaja{0%{transform:scale(.72);opacity:0}10%{transform:scale(1);opacity:1}87%{transform:scale(1);opacity:1}100%{transform:scale(.95) translateY(-12px);opacity:0}}' +
    '@keyframes amGira{to{transform:rotate(360deg)}}@keyframes amDibuja{to{stroke-dashoffset:0}}' +
    '@keyframes amDespierta{from{transform:scale(.35) rotate(-14deg);opacity:0}to{transform:none;opacity:1}}' +
    '@keyframes amEnciende{to{color:#0b0f0a;background:var(--am);border-color:var(--am);box-shadow:0 0 16px color-mix(in srgb,var(--am) 55%,transparent)}}' +
    '@keyframes amChispa{0%{opacity:1;stroke-dasharray:0 30;stroke-dashoffset:0}100%{opacity:0;stroke-dasharray:9 30;stroke-dashoffset:-14}}' +
    '@keyframes amBarrido{to{transform:translateX(100%)}}' +
    '@media(prefers-reduced-motion:reduce){#am-capa *{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}#am-capa,#am-capa .am-caja{animation:amCapa 2.4s steps(1,end) forwards!important}}';
  document.head.appendChild(estiloAm);
  function animarModulo(modo, orden, agentes) {
    var m = MODOS[modo]; if (!m) return;
    var vieja = document.getElementById('am-capa'); if (vieja) vieja.remove();
    var inicio = modo === 'inicio', capa = document.createElement('div'), chispas = '';
    if (modo === 'fin') for (var i = 0; i < 12; i++) chispas += '<path class="am-chispa" d="M32 -3 V-13" transform="rotate(' + i * 30 + ' 32 32)"/>';
    var marca = modo === 'fin' ? 'M23 33 L30 40 L42 26' : modo === 'error' ? 'M25 26 L39 40 M39 26 L25 40' : 'M26 26 V40 M38 26 V40';
    var lista = (agentes && agentes.length ? agentes : EQUIPO).slice(0, 6);
    capa.id = 'am-capa'; capa.className = inicio ? '' : 'fija'; capa.setAttribute('role', 'status'); capa.style.setProperty('--am', m.color);
    capa.innerHTML = '<div class="am-caja">' + (inicio ? '<span class="am-barrido"></span>' : '') +
      '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="am-orbita" ' + (inicio ? '' : 'pathLength="1" ') + 'cx="32" cy="32" r="30"/><circle class="am-orbita b" cx="32" cy="32" r="35"/>' +
      '<g class="am-cara"><path d="M32 12 V18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="10" r="3" fill="currentColor"/><rect x="15" y="18" width="34" height="28" rx="9" fill="currentColor"/>' +
      (inicio ? '<circle cx="25" cy="30" r="3.6" fill="#0b0f0a"/><circle cx="39" cy="30" r="3.6" fill="#0b0f0a"/><path d="M25 39 Q32 44 39 39" fill="none" stroke="#0b0f0a" stroke-width="3" stroke-linecap="round"/>'
              : '<path class="am-marca" pathLength="1" d="' + marca + '"/>') + '</g>' + chispas + '</svg>' +
      '<strong>' + m.titulo + '</strong>' + (orden ? '<span class="am-orden">Orden ' + String(orden).replace(/[<>&"]/g, '') + '</span>' : '') +
      (inicio ? '<div class="am-equipo">' + lista.map(function (a, k) { return '<b style="--i:' + k + '">' + String(a).replace(/[<>&"]/g, '') + '</b>'; }).join('') + '</div>' : '') + '</div>';
    document.body.appendChild(capa);
    setTimeout(function () { capa.remove(); }, 2950);
  }
  window.indoorAnimarAgentes = animarModulo;

  var canalPrevio = null;   // {trabajando, esperando} de la consulta anterior del módulo
  function revisarModuloAgentes(d) {
    if (!d || typeof d !== 'object') return;
    var ahora = { trabajando: !!(d.esperando && d.trabajo), esperando: !!d.esperando };
    var antes = canalPrevio; canalPrevio = ahora;
    var panel = document.querySelector('.panel[data-panel="agentes"]');
    if (!antes || !panel || !panel.classList.contains('active')) return;   // la primera consulta solo deja la referencia
    if (ahora.trabajando && !antes.trabajando) return animarModulo('inicio', d.orden, d.trabajo && d.trabajo.agentes && d.trabajo.agentes.length > 1 ? d.trabajo.agentes : null);
    if (antes.trabajando && !ahora.esperando) {
      var respuestas = (d.mensajes || []).filter(function (x) { return x && x.rol !== 'yo'; }), ultima = respuestas[respuestas.length - 1] || {};
      var estado = plano(ultima.estado);
      animarModulo(estado === 'ERROR' ? 'error' : (estado === 'DETENIDO' || estado === 'REINICIANDO') ? 'detenido' : 'fin', d.orden, null);
    }
  }
  window.__revisarModuloAgentes = revisarModuloAgentes;

  var original = window.fetch;
  window.fetch = function (entrada, opciones) {
    var promesa = original.apply(this, arguments);
    try {
      var url = String(typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '').split('?')[0];
      if (opciones && String(opciones.method || '').toUpperCase() === 'POST' && /\/api\/produccion\/operacion$/.test(url) && typeof opciones.body === 'string') {
        var cuerpo = JSON.parse(opciones.body), orden = ordenDe(cuerpo.row);
        promesa.then(function (respuesta) { if (respuesta.ok) mostrar(cuerpo.action, cuerpo.row, orden); }).catch(function () {});
      } else if ((!opciones || !opciones.method || String(opciones.method).toUpperCase() === 'GET') && /\/api\/produccion$/.test(url)) {
        promesa.then(function (respuesta) { if (respuesta.ok) return respuesta.clone().json().then(revisarAgentes); }).catch(function () {});
      } else if ((!opciones || !opciones.method || String(opciones.method).toUpperCase() === 'GET') && /\/api\/agentes\/mensajes$/.test(url)) {
        promesa.then(function (respuesta) { if (respuesta.ok) return respuesta.clone().json().then(revisarModuloAgentes); }).catch(function () {});
      }
    } catch (e) { /* la confirmación nunca debe estorbar la operación */ }
    return promesa;
  };
})();
