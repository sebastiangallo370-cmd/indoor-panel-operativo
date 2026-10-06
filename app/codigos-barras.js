// CÓDIGOS DE BARRAS (Inventarios · Stock tela): código de cada tela y de cada ROLLO; escanear e imprimir etiquetas en la impresora de etiquetas.
(() => {
  if (window.__codigosBarrasLoaded) return;
  window.__codigosBarrasLoaded = true;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const compacto = value => norm(value).replace(/\s+/g, '');
  const fmt = value => Number(value || 0).toLocaleString('es-CO', {maximumFractionDigits: 2});

  // ---------------------------------------------------------------- Code128 (juego B: letras, números y signos)
  const PATRONES = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

  function code128(texto) {
    const limpio = String(texto ?? '').split('').map(c => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126 ? c : '?')).join('');
    const codigos = limpio.split('').map(c => c.charCodeAt(0) - 32);
    let suma = 104;
    codigos.forEach((c, i) => { suma += c * (i + 1); });
    const secuencia = [104, ...codigos, suma % 103, 106];
    const anchos = secuencia.flatMap(v => PATRONES[v].split('').map(Number));
    return {texto: limpio, anchos, modulos: anchos.reduce((a, b) => a + b, 0)};
  }

  // SVG: una barra por cada ancho impar (barra) y un hueco por cada par; viewBox en módulos para que escale exacto
  function svgBarras(texto, altoMm, moduloMm, margenModulos = 10) {
    const c = code128(texto);
    let x = margenModulos, barras = '';
    c.anchos.forEach((ancho, i) => {
      if (i % 2 === 0) barras += '<rect x="' + x + '" y="0" width="' + ancho + '" height="1"/>';
      x += ancho;
    });
    const total = c.modulos + margenModulos * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block;width:' + (total * moduloMm).toFixed(3) + 'mm;height:' + altoMm + 'mm" fill="#000">' + barras + '</svg>';
  }
  const modulosDe = texto => code128(texto).modulos + 20;
  // El módulo (barra más fina) es múltiplo del punto de la impresora (203 dpi = 0,125 mm) para que las barras salgan nítidas
  function moduloMm(texto, anchoDisponibleMm) {
    const k = Math.max(1, Math.min(5, Math.floor(anchoDisponibleMm / modulosDe(texto) / 0.125)));
    return k * 0.125;
  }

  // ---------------------------------------------------------------- ajustes de la etiqueta
  const SOLO_CATEGORIA = 'BODEGA TELA';
  const TAMANOS = {'100x50': [100, 50], '100x70': [100, 70], '60x40': [60, 40], '50x30': [50, 30], '40x25': [40, 25]};
  const POR_DEFECTO = {tamano: '100x50', ancho: 100, alto: 50, copias: 1, nombre: true, stock: true, categoria: true, fecha: false};
  let cfg = {...POR_DEFECTO};
  try { cfg = {...POR_DEFECTO, ...JSON.parse(localStorage.getItem('codigosBarrasCfg') || '{}')}; } catch (_) {}
  const guardarCfg = () => { try { localStorage.setItem('codigosBarrasCfg', JSON.stringify(cfg)); } catch (_) {} };
  const medidas = () => cfg.tamano === 'otro' ? [Math.max(20, Math.min(200, Number(cfg.ancho) || 100)), Math.max(15, Math.min(200, Number(cfg.alto) || 50))] : TAMANOS[cfg.tamano] || TAMANOS['100x50'];

  // item.tipo === 'rollo': etiqueta de un rollo (código propio + metros); si no, etiqueta de la tela
  function etiquetaHTML(item, [w, h]) {
    const rollo = item.tipo === 'rollo';
    const pad = h >= 40 ? 3 : 2;
    const nombreImpreso = String(item.nombre || '').replace(/^\s*\([^)]*\)\s*/, '').trim() || item.nombre;   // el código ya sale debajo de las barras
    const nombreMm = (h >= 60 ? 5 : h >= 45 ? 4.2 : h >= 35 ? 3.4 : 2.7) * (nombreImpreso.length > 50 ? 0.82 : nombreImpreso.length > 32 ? 0.92 : 1);
    const codigoMm = h >= 45 ? 4 : h >= 35 ? 3.4 : 2.8;
    const metrosMm = h >= 60 ? 8 : h >= 45 ? 6.5 : h >= 35 ? 5 : 3.8;
    const pieMm = h >= 45 ? 2.8 : 2.3;
    const disponible = w - pad * 2;
    const modulo = moduloMm(item.codigo, disponible);
    const altoBarras = Math.max(7, Math.round(h * (rollo ? (cfg.nombre ? 0.27 : 0.38) : (cfg.nombre ? 0.36 : 0.5))));
    const fecha = cfg.fecha ? new Date().toLocaleDateString('es-CO') : '';
    const pie = rollo
      ? ['Rollo ' + item.n + (item.empezado ? ' · EMPEZADO' : ''), fecha].filter(Boolean).join(' · ')
      : [cfg.categoria ? item.categoria_label : '', cfg.stock && item.total_label ? item.total_label + (item.categoria === 'BODEGA TELA' ? ' MTS' : '') : '', fecha].filter(Boolean).join(' · ');
    return '<div class="l">' +
      (cfg.nombre ? '<div class="n">' + esc(nombreImpreso) + '</div>' : '') +
      '<div class="b">' + svgBarras(item.codigo, altoBarras, modulo) + '</div>' +
      '<div class="c">' + esc(item.codigo) + '</div>' +
      (rollo ? '<div class="m">' + esc(fmt(item.valor)) + ' MTS</div>' : '') +
      (pie ? '<div class="p">' + esc(pie) + '</div>' : '') +
      '</div>' + '<style>.l .n{font-size:' + nombreMm + 'mm}.l .c{font-size:' + codigoMm + 'mm}.l .m{font-size:' + metrosMm + 'mm}.l .p{font-size:' + pieMm + 'mm}</style>';
  }
  function estiloEtiqueta([w, h]) {
    const pad = h >= 40 ? 3 : 2;
    return '.l{width:' + w + 'mm;height:' + h + 'mm;padding:' + pad + 'mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;align-items:center;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;text-align:center}' +
      '.l .n{font-weight:700;line-height:1.1;max-height:2.3em;overflow:hidden;width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.l .b{display:flex;justify-content:center;width:100%}.l .c{font-family:Consolas,"Courier New",monospace;font-weight:700;letter-spacing:.08em}' +
      '.l .m{font-weight:800;line-height:1}.l .p{color:#222;line-height:1.1;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
  }

  function imprimir(items) {
    const tam = medidas(), [w, h] = tam, copias = Math.max(1, Math.min(200, Number(cfg.copias) || 1));
    const paginas = [];
    items.forEach(item => { for (let i = 0; i < copias; i++) paginas.push('<section class="pg">' + etiquetaHTML(item, tam) + '</section>'); });
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:' + w + 'mm ' + h + 'mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}' +
      '.pg{width:' + w + 'mm;height:' + h + 'mm;page-break-after:always;break-after:page;overflow:hidden}.pg:last-child{page-break-after:auto;break-after:auto}' + estiloEtiqueta(tam) + '</style></head><body>' + paginas.join('') + '</body></html>';
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(marco);
    marco.onload = () => { try { marco.contentWindow.focus(); marco.contentWindow.print(); } finally { setTimeout(() => marco.remove(), 120000); } };
    marco.srcdoc = html;
  }

  // ---------------------------------------------------------------- pantalla
  const estilo = document.createElement('style');
  estilo.textContent = `
.cb{display:grid;gap:16px;width:100%;padding-bottom:110px}
.cb-hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:24px 28px;border:1px solid var(--line,rgba(208,244,76,.22));border-radius:22px;background:linear-gradient(135deg,rgba(208,244,76,.08),rgba(20,24,19,.6))}
.cb-hero h2{margin:4px 0 6px;font-size:1.9rem}.cb-hero p{margin:0;color:var(--muted,#a7b0a0);max-width:680px;line-height:1.5}
.cb-scan{display:flex;gap:10px;align-items:center;padding:14px 16px;border:2px solid #d0f44c;border-radius:16px;background:#10170f}
.cb-scan span{font:800 11px Arial;letter-spacing:.1em;color:#d0f44c;white-space:nowrap}
.cb-scan input{flex:1;min-width:0;padding:12px 14px;border:1px solid #4f6545;border-radius:10px;background:#1b261c;color:#fff;font:700 18px Consolas,monospace;letter-spacing:.06em}
.cb-scan input:focus{outline:none;border-color:#d0f44c}
.cb-eco{min-height:22px;padding:0 4px;font-size:14px}.cb-eco.ok{color:#8fe08f}.cb-eco.mal{color:#ff9d8f}
.cb-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.cb-tools input[type=search],.cb-tools select,.cb-barra select{width:auto!important}
.cb-tools input[type=search],.cb-tools select{padding:11px 13px;border:1px solid #3f553d;border-radius:10px;background:#162016;color:#eef4e9;font:14px Arial;min-width:200px}
.cb-tools button,.cb-barra button,.cb-prev button{width:auto!important;min-width:0;flex:0 0 auto;padding:10px 15px;border:1px solid #4f6545;border-radius:10px;background:#1f2b17;color:#eaf6c7;font:700 13px Arial;cursor:pointer}
.cb-tools button:hover,.cb-barra button:hover{border-color:#d0f44c}
.cb-tools .cuenta{margin-left:auto;color:var(--muted,#a7b0a0);font-size:13px}
.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;align-items:start}
.cb-card{display:grid;gap:8px;padding:13px;border:1px solid #2f402e;border-radius:14px;background:#0f150e;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.cb-card:hover{border-color:#6c8a4a}.cb-card.sel{border-color:#d0f44c;box-shadow:0 0 0 2px #d0f44c33}.cb-card.halo{animation:cbhalo 1.6s}@keyframes cbhalo{0%,60%{box-shadow:0 0 0 5px #d0f44c}100%{box-shadow:0 0 0 0 #d0f44c00}}
.cb-card header{display:flex;align-items:center;gap:8px}.cb-card header input{width:18px;height:18px;accent-color:#d0f44c}
.cb-card .cod{font:800 17px Consolas,monospace;letter-spacing:.08em;color:#d0f44c}.cb-card .cat{margin-left:auto;padding:2px 8px;border-radius:99px;background:#1c2a18;color:#aebba7;font:700 10px Arial;white-space:nowrap}
.cb-card .nom{font:700 14px Arial;line-height:1.25;color:#eef4e9;overflow-wrap:anywhere}.cb-card .stk{color:#8fa088;font-size:12px}
.cb-card .bar{padding:8px;border-radius:8px;background:#fff;overflow:hidden}.cb-card .bar svg{width:100%!important;height:46px!important}
.cb-rl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cb-rl button{width:auto!important;padding:6px 11px;border:1px solid #4f6545;border-radius:8px;background:#1a2616;color:#eaf6c7;font:700 12px Arial;cursor:pointer}.cb-rl button:hover{border-color:#d0f44c}
.cb-lista{display:flex;flex-wrap:wrap;gap:6px;padding-top:2px}
.cb-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid #3a5033;border-radius:8px;background:#142014;color:#d7e4cf;font:600 12px Arial;cursor:pointer;user-select:none}
.cb-chip b{font:800 12px Consolas,monospace;color:#d0f44c}.cb-chip.emp{border-color:#9a6a1f;background:#2a1f10}.cb-chip.emp b{color:#ffb454}
.cb-chip.sel{border-color:#d0f44c;background:#27391b;box-shadow:0 0 0 2px #d0f44c33}.cb-chip.halo{animation:cbhalo 1.6s}
.cb-vacio{padding:40px;text-align:center;color:#8fa088;border:1px dashed #34432f;border-radius:14px}
.cb-barra{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:60;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;max-width:calc(100vw - 24px);padding:12px 16px;border:1px solid #4a6338;border-radius:16px;background:#0b110bf2;box-shadow:0 14px 40px #000b;backdrop-filter:blur(6px)}
.cb-barra:not(.on){display:none}.cb-barra label{display:flex;align-items:center;gap:6px;color:#c5d1bf;font:600 12px Arial}.cb-barra select,.cb-barra input[type=number]{padding:8px 9px;border:1px solid #3f553d;border-radius:8px;background:#162016;color:#fff;font:13px Arial}
.cb-barra input[type=number]{width:64px!important}.cb-barra input[type=checkbox]{width:auto!important}.cb-barra .p{background:#d0f44c;border-color:#d0f44c;color:#16200c}.cb-barra b{color:#d0f44c}
.cb-prev{position:fixed;inset:0;z-index:90;display:none;place-items:center;background:#000c}.cb-prev.on{display:grid}.cb-prev>div{max-width:92vw;max-height:92vh;overflow:auto;padding:18px;border-radius:16px;background:#1a2218;border:1px solid #4a6338}
.cb-prev h3{margin:0 0 12px;font:800 13px Arial;letter-spacing:.08em;color:#d0f44c}.cb-prev .hoja{display:inline-block;padding:0;border:1px dashed #888;background:#fff;box-shadow:0 8px 28px #0008}
.cb-prev button{margin-top:14px}
@media(max-width:700px){.cb-hero{padding:18px}.cb-scan{flex-wrap:wrap}.cb-tools .cuenta{margin-left:0}}
`;
  document.head.appendChild(estilo);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'codigos-barras';
  panel.innerHTML = '<div class="cb">' +
    '<section class="cb-hero"><div><span class="eyebrow">Producción · Inventarios</span><h2>CÓDIGOS DE BARRAS</h2>' +
    '<p>Cada tela de Stock tela tiene su código permanente y cada <b>rollo</b> tiene el suyo (por ejemplo T100-007). Búscalos, escanéalos con el lector o selecciona los que quieras e imprime sus etiquetas.</p></div></section>' +
    '<div class="cb-scan"><span>ESCANEAR / BUSCAR CÓDIGO</span><input type="text" data-cb-scan autocomplete="off" spellcheck="false" placeholder="Pasa el lector o escribe, por ejemplo T100 o T100-007"></div><div class="cb-eco" data-cb-eco></div>' +
    '<div class="cb-tools"><input type="search" data-cb-q placeholder="Buscar tela por nombre o código"><select data-cb-cat hidden><option value="">Todas las categorías</option></select>' +
    '<button type="button" data-cb-todos>Seleccionar las telas visibles</button><button type="button" data-cb-todosrollos>Seleccionar todos los rollos visibles</button><button type="button" data-cb-ninguno>Quitar selección</button><button type="button" data-cb-recargar>Actualizar</button><span class="cuenta" data-cb-cuenta></span></div>' +
    '<div class="cb-grid" data-cb-grid></div></div>';

  const extras = document.createElement('div');
  extras.dataset.cbExtras = 'true';
  extras.innerHTML = '<div class="cb-barra" data-cb-barra><span><b data-cb-n>0</b> etiquetas <small data-cb-det></small></span>' +
    '<label>Etiqueta <select data-cb-tam>' + Object.keys(TAMANOS).map(k => '<option value="' + k + '">' + k.replace('x', ' × ') + ' mm</option>').join('') + '<option value="otro">Otro tamaño…</option></select></label>' +
    '<label data-cb-otro hidden>Ancho <input type="number" min="20" max="200" data-cb-w> × Alto <input type="number" min="15" max="200" data-cb-h> mm</label>' +
    '<label>Copias <input type="number" min="1" max="200" data-cb-copias></label>' +
    '<label><input type="checkbox" data-cb-op="nombre"> Nombre</label><label><input type="checkbox" data-cb-op="categoria"> Categoría</label><label><input type="checkbox" data-cb-op="stock"> Cantidad</label><label><input type="checkbox" data-cb-op="fecha"> Fecha</label>' +
    '<button type="button" data-cb-vista>Vista previa</button><button type="button" class="p" data-cb-imprimir>Imprimir etiquetas</button></div>' +
    '<div class="cb-prev" data-cb-prev><div><h3>VISTA PREVIA · tamaño real de la etiqueta</h3><div data-cb-hoja></div><button type="button" data-cb-cerrar>Cerrar</button></div></div>';
  document.body.appendChild(extras);

  const q = sel => panel.querySelector(sel) || extras.querySelector(sel);
  const estado = {items: [], sel: new Set(), selR: new Set(), abiertos: new Set(), rollMap: new Map(), texto: '', cat: '', cargando: false};
  let cargado = false, pendiente = '';

  const visibles = () => {
    const t = norm(estado.texto);
    return estado.items.filter(i => (!estado.cat || i.categoria === estado.cat) && (!t || norm(i.nombre + ' ' + i.codigo).includes(t) || (i.detalle_rollos || []).some(r => compacto(r.codigo).includes(compacto(t)))));
  };
  const totalSeleccion = () => estado.sel.size + estado.selR.size;
  const pintar = () => {
    const lista = visibles();
    q('[data-cb-grid]').innerHTML = lista.length ? lista.map(i => {
      const rollos = i.detalle_rollos || [], abierto = estado.abiertos.has(i.codigo);
      const chips = abierto ? '<div class="cb-lista">' + rollos.map(r => '<span class="cb-chip' + (r.empezado ? ' emp' : '') + (estado.selR.has(r.codigo) ? ' sel' : '') + '" data-roll="' + esc(r.codigo) + '" title="' + esc(r.codigo) + '"><b>' + String(r.n).padStart(3, '0') + '</b>' + esc(fmt(r.valor)) + ' m</span>').join('') + '</div>' : '';
      const botones = rollos.length ? '<div class="cb-rl"><button type="button" data-roll-toggle="' + esc(i.codigo) + '">' + (abierto ? '▾' : '▸') + ' ' + rollos.length + (rollos.length === 1 ? ' rollo' : ' rollos') + '</button>' + (abierto ? '<button type="button" data-roll-todos="' + esc(i.codigo) + '">Seleccionar todos</button>' : '') + '</div>' + chips : '';
      return '<article class="cb-card' + (estado.sel.has(i.codigo) ? ' sel' : '') + '" data-cod="' + esc(i.codigo) + '"><header><input type="checkbox" tabindex="-1"' + (estado.sel.has(i.codigo) ? ' checked' : '') + '><span class="cod">' + esc(i.codigo) + '</span><span class="cat">' + esc(i.categoria_label) + '</span></header>' +
        '<div class="nom">' + esc(i.nombre) + '</div><div class="stk">' + esc(i.total_label || '—') + (i.categoria === 'BODEGA TELA' ? ' MTS' : '') + (i.rollos ? ' · ' + i.rollos + ' rollos' : '') + '</div>' +
        '<div class="bar">' + svgBarras(i.codigo, 46, 1, 10) + '</div>' + botones + '</article>';
    }).join('') : '<div class="cb-vacio">' + (estado.cargando ? 'Cargando telas…' : 'No hay telas que coincidan.') + '</div>';
    q('[data-cb-cuenta]').textContent = lista.length + ' de ' + estado.items.length + ' telas';
    q('[data-cb-n]').textContent = totalSeleccion();
    q('[data-cb-det]').textContent = totalSeleccion() ? '(' + estado.sel.size + ' telas · ' + estado.selR.size + ' rollos)' : '';
    q('[data-cb-barra]').classList.toggle('on', totalSeleccion() > 0 && panel.classList.contains('active'));
  };
  const eco = (texto, tipo) => { const e = q('[data-cb-eco]'); e.textContent = texto; e.className = 'cb-eco ' + (tipo || ''); };

  async function cargar() {
    estado.cargando = true; pintar();
    try {
      const r = await fetch('/api/inventarios/codigos', {cache: 'no-store'});
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || 'No se pudieron cargar los códigos');
      estado.items = (d.codigos || []).filter(i => i.categoria === SOLO_CATEGORIA);   // por ahora solo Stock tela
      estado.rollMap = new Map();
      estado.items.forEach(i => (i.detalle_rollos || []).forEach(rl => estado.rollMap.set(compacto(rl.codigo), {rollo: rl, tela: i})));
      const vivos = new Set(estado.items.flatMap(i => (i.detalle_rollos || []).map(rl => rl.codigo)));
      estado.selR = new Set([...estado.selR].filter(c => vivos.has(c)));   // un rollo que ya no existe se quita de la selección
      cargado = true;
    } catch (error) { eco(error.message, 'mal'); }
    estado.cargando = false; pintar();
    if (pendiente && cargado) { const v = pendiente; pendiente = ''; escanear(v); }
  }

  function enfocar(selector) {
    const el = q(selector);
    if (el) { el.scrollIntoView({block: 'center', behavior: 'smooth'}); el.classList.add('halo'); setTimeout(() => el.classList.remove('halo'), 1700); }
  }
  function escanear(valor) {
    const t = compacto(valor);
    if (!t) return;
    if (!cargado) { pendiente = valor; eco('Cargando telas… se buscará «' + valor + '» al terminar.', ''); return; }
    const hit = estado.rollMap.get(t);
    if (hit) {   // código de un rollo
      estado.selR.add(hit.rollo.codigo); estado.abiertos.add(hit.tela.codigo);
      estado.texto = ''; q('[data-cb-q]').value = '';
      pintar();
      eco('✓ Rollo ' + hit.rollo.codigo + ' · ' + hit.tela.nombre + ' · ' + fmt(hit.rollo.valor) + ' MTS' + (hit.rollo.empezado ? ' (empezado)' : ' (nuevo)'), 'ok');
      enfocar('[data-roll="' + CSS.escape(hit.rollo.codigo) + '"]');
      return;
    }
    const exacto = estado.items.find(i => compacto(i.codigo) === t);
    const parecidos = exacto ? [] : estado.items.filter(i => compacto(i.codigo).includes(t));
    const item = exacto || (parecidos.length === 1 ? parecidos[0] : null);
    if (!item) { eco(parecidos.length ? parecidos.length + ' telas coinciden con «' + valor + '»: sigue escribiendo.' : 'No encontré el código «' + valor + '».', 'mal'); return; }
    estado.sel.add(item.codigo);
    estado.texto = ''; q('[data-cb-q]').value = '';
    pintar();
    eco('✓ ' + item.codigo + ' · ' + item.nombre + ' · ' + (item.total_label || '—') + ' MTS · ' + (item.detalle_rollos || []).length + ' rollos', 'ok');
    enfocar('[data-cod="' + CSS.escape(item.codigo) + '"]');
  }

  const aplicarCfg = () => {
    q('[data-cb-tam]').value = cfg.tamano; q('[data-cb-w]').value = cfg.ancho; q('[data-cb-h]').value = cfg.alto; q('[data-cb-copias]').value = cfg.copias;
    q('[data-cb-otro]').hidden = cfg.tamano !== 'otro';
    extras.querySelectorAll('[data-cb-op]').forEach(c => { c.checked = !!cfg[c.dataset.cbOp]; });
  };
  // etiquetas a imprimir: primero las telas y luego los rollos seleccionados
  const seleccionados = () => {
    const telas = estado.items.filter(i => estado.sel.has(i.codigo)).map(i => ({...i, tipo: 'tela'}));
    const rollos = [];
    estado.items.forEach(i => (i.detalle_rollos || []).forEach(rl => {
      if (estado.selR.has(rl.codigo)) rollos.push({tipo: 'rollo', codigo: rl.codigo, n: rl.n, valor: rl.valor, empezado: rl.empezado, nombre: i.nombre, categoria: i.categoria, categoria_label: i.categoria_label});
    }));
    return [...telas, ...rollos];
  };

  const alClic = e => {
    const chip = e.target.closest('[data-roll]');
    if (chip) { const c = chip.dataset.roll; estado.selR.has(c) ? estado.selR.delete(c) : estado.selR.add(c); pintar(); return; }
    const abrirRollos = e.target.closest('[data-roll-toggle]');
    if (abrirRollos) { const c = abrirRollos.dataset.rollToggle; estado.abiertos.has(c) ? estado.abiertos.delete(c) : estado.abiertos.add(c); pintar(); return; }
    const todos = e.target.closest('[data-roll-todos]');
    if (todos) {
      const tela = estado.items.find(i => i.codigo === todos.dataset.rollTodos);
      const rolls = (tela?.detalle_rollos || []).map(r => r.codigo);
      const todosYa = rolls.every(c => estado.selR.has(c));
      rolls.forEach(c => todosYa ? estado.selR.delete(c) : estado.selR.add(c)); pintar(); return;
    }
    const tarjeta = e.target.closest('[data-cod]');
    if (tarjeta && !e.target.closest('.cb-rl, .cb-lista')) { const c = tarjeta.dataset.cod; estado.sel.has(c) ? estado.sel.delete(c) : estado.sel.add(c); pintar(); return; }
    if (e.target.closest('[data-cb-todos]')) { visibles().forEach(i => estado.sel.add(i.codigo)); pintar(); return; }
    if (e.target.closest('[data-cb-todosrollos]')) { visibles().forEach(i => { (i.detalle_rollos || []).forEach(r => estado.selR.add(r.codigo)); estado.abiertos.add(i.codigo); }); pintar(); return; }
    if (e.target.closest('[data-cb-ninguno]')) { estado.sel.clear(); estado.selR.clear(); pintar(); return; }
    if (e.target.closest('[data-cb-recargar]')) { cargar(); return; }
    if (e.target.closest('[data-cb-vista]')) {
      const lista = seleccionados(); if (!lista.length) return;
      const tam = medidas();
      q('[data-cb-hoja]').innerHTML = '<style>' + estiloEtiqueta(tam) + '</style><div class="hoja">' + etiquetaHTML(lista[0], tam) + '</div>' + (lista.length > 1 ? '<p style="color:#aebba7;font:12px Arial">Se muestra la primera de ' + lista.length + ' etiquetas.</p>' : '');
      q('[data-cb-prev]').classList.add('on'); return;
    }
    if (e.target.closest('[data-cb-cerrar]') || e.target === q('[data-cb-prev]')) { q('[data-cb-prev]').classList.remove('on'); return; }
    if (e.target.closest('[data-cb-imprimir]')) { const lista = seleccionados(); if (lista.length) imprimir(lista); }
  };
  const alEscribir = e => {
    if (e.target.matches('[data-cb-q]')) { estado.texto = e.target.value; pintar(); }
    else if (e.target.matches('[data-cb-copias]')) { cfg.copias = e.target.value; guardarCfg(); }
    else if (e.target.matches('[data-cb-w]')) { cfg.ancho = e.target.value; guardarCfg(); }
    else if (e.target.matches('[data-cb-h]')) { cfg.alto = e.target.value; guardarCfg(); }
  };
  const alCambiar = e => {
    if (e.target.matches('[data-cb-cat]')) { estado.cat = e.target.value; pintar(); }
    else if (e.target.matches('[data-cb-tam]')) { cfg.tamano = e.target.value; q('[data-cb-otro]').hidden = cfg.tamano !== 'otro'; guardarCfg(); }
    else if (e.target.matches('[data-cb-op]')) { cfg[e.target.dataset.cbOp] = e.target.checked; guardarCfg(); }
  };
  [panel, extras].forEach(zona => { zona.addEventListener('click', alClic); zona.addEventListener('input', alEscribir); zona.addEventListener('change', alCambiar); });
  q('[data-cb-scan]').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); escanear(e.target.value); e.target.value = '';   // el lector escribe el código y pulsa Enter
  });

  const abrir = boton => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === boton));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p === panel));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
    aplicarCfg();
    if (!cargado) cargar(); else { pintar(); cargar(); }   // al volver se refrescan los metros de los rollos
    setTimeout(() => q('[data-cb-scan]').focus(), 60);
  };
  // la barra de impresión y la vista previa solo se ven en esta pantalla
  new MutationObserver(() => { if (!panel.classList.contains('active')) { q('[data-cb-barra]').classList.remove('on'); q('[data-cb-prev]').classList.remove('on'); } }).observe(panel, {attributes: true, attributeFilter: ['class']});

  const montar = () => {
    if (document.querySelector('[data-codigos-nav]')) return true;
    const grupo = [...document.querySelectorAll('.nav-group')].find(g => /INVENTARIOS/i.test(g.querySelector('.nav-parent')?.textContent || ''));
    const hijos = grupo?.querySelector('.nav-children');
    const main = document.querySelector('main');
    if (!hijos || !main) return false;
    main.appendChild(panel);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'tab inventory-control-nav';
    boton.dataset.codigosNav = 'true';
    boton.innerHTML = '<span class="nav-icon">CB</span><strong>CÓDIGOS DE BARRAS</strong>';
    boton.onclick = () => abrir(boton);
    hijos.appendChild(boton);
    return true;
  };
  if (!montar()) { const t = setInterval(() => { if (montar()) clearInterval(t); }, 300); setTimeout(() => clearInterval(t), 15000); }
})();
