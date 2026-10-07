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
  const modulosDe = (texto, margen = 10) => code128(texto).modulos + margen * 2;
  // El módulo (barra más fina) es múltiplo del punto de la impresora (203 dpi = 0,125 mm) para que las barras salgan nítidas
  function moduloMm(texto, anchoDisponibleMm, margen = 10) {
    const k = Math.max(1, Math.min(5, Math.floor(anchoDisponibleMm / modulosDe(texto, margen) / 0.125)));
    return k * 0.125;
  }

  // ---------------------------------------------------------------- ajustes de la etiqueta
  const SOLO_CATEGORIA = 'BODEGA TELA';
  const TAMANOS = {'42x30': [42, 30], '40x40': [40, 40], '45x40': [45, 40], '50x40': [50, 40], '100x50': [100, 50], '100x70': [100, 70], '60x40': [60, 40], '50x30': [50, 30], '40x25': [40, 25]};
  const POR_DEFECTO = {tamano: '42x30', ancho: 42, alto: 30, copias: 1, nombre: true, stock: true, categoria: true, fecha: false, imagen: true, dx: 0, dy: 0, anchoBarras: 1, hoja: 'igual'};
  let cfg = {...POR_DEFECTO};
  try { cfg = {...POR_DEFECTO, ...JSON.parse(localStorage.getItem('codigosBarrasCfg9') || '{}')}; } catch (_) {}
  const guardarCfg = () => { try { localStorage.setItem('codigosBarrasCfg9', JSON.stringify(cfg)); } catch (_) {} };
  const medidas = () => cfg.tamano === 'otro' ? [Math.max(20, Math.min(200, Number(cfg.ancho) || 100)), Math.max(15, Math.min(200, Number(cfg.alto) || 50))] : TAMANOS[cfg.tamano] || TAMANOS['100x50'];

  // item.tipo === 'rollo': etiqueta de un rollo (código propio + metros); si no, etiqueta de la tela
  function paramsEtiqueta(item, [w, h]) {
    const rollo = item.tipo === 'rollo';
    const compacta = w <= 46;
    const pad = compacta ? (w <= 42 ? 1 : 1.5) : (h >= 40 ? 3 : 2);
    const margen = compacta ? (w <= 42 ? 3 : 6) : 10;   // la zona blanca del lado también la da el borde de la etiqueta
    const nombreImpreso = String(item.nombre || '').replace(/^\s*\([^)]*\)\s*/, '').trim() || item.nombre;   // el código ya sale debajo de las barras
    const baja = compacta && h <= 32;   // etiqueta baja (42 x 30): todo más compacto
    const nombreMm = baja ? (nombreImpreso.length > 40 ? 2.2 : nombreImpreso.length > 24 ? 2.4 : 2.6) : compacta ? (nombreImpreso.length > 40 ? 2.6 : nombreImpreso.length > 24 ? 2.9 : 3.2)
      : (h >= 60 ? 5 : h >= 45 ? 4.2 : h >= 35 ? 3.4 : 2.7) * (nombreImpreso.length > 50 ? 0.82 : nombreImpreso.length > 32 ? 0.92 : 1);
    const codigoMm = baja ? 3 : compacta ? 3.4 : h >= 45 ? 4 : h >= 35 ? 3.4 : 2.8;
    const metrosMm = baja ? 4.4 : compacta ? 5.6 : h >= 60 ? 8 : h >= 45 ? 6.5 : h >= 35 ? 5 : 3.8;
    const pieMm = baja ? 2 : compacta ? 2.3 : h >= 45 ? 2.8 : 2.3;
    const disponible = (w - pad * 2) * (Number(cfg.anchoBarras) || 1);
    const modulo = moduloMm(item.codigo, disponible, margen);
    const altoBarras = baja ? (cfg.nombre ? 9 : 12) : compacta ? Math.round(h * (cfg.nombre ? 0.34 : 0.45)) : Math.max(7, Math.round(h * (rollo ? (cfg.nombre ? 0.27 : 0.38) : (cfg.nombre ? 0.36 : 0.5))));
    const fecha = cfg.fecha ? new Date().toLocaleDateString('es-CO') : '';
    const pie = rollo
      ? ['Rollo ' + item.n + (item.empezado ? ' · EMPEZADO' : ''), fecha].filter(Boolean).join(' · ')
      : [cfg.categoria ? item.categoria_label : '', cfg.stock && item.total_label ? item.total_label + (item.categoria === 'BODEGA TELA' ? ' MTS' : ' UND') : '', cfg.stock && item.rollos ? item.rollos + (item.rollos === 1 ? ' ROLLO' : ' ROLLOS') : '', fecha].filter(Boolean).join(' · ');
    return {rollo, compacta, pad, margen, nombreImpreso, nombreMm, codigoMm, metrosMm, pieMm, modulo, altoBarras, fecha, pie};
  }
  function etiquetaHTML(item, tam) {
    const [w, h] = tam;
    const {rollo, pad, margen, nombreImpreso, nombreMm, codigoMm, metrosMm, pieMm, modulo, altoBarras, pie} = paramsEtiqueta(item, tam);
    return '<div class="l">' +
      (cfg.nombre ? '<div class="n">' + esc(nombreImpreso) + '</div>' : '') +
      '<div class="b">' + svgBarras(item.codigo, altoBarras, modulo, margen) + '</div>' +
      '<div class="c">' + esc(item.codigo) + '</div>' +
      (rollo ? '<div class="m">' + esc(fmt(item.valor)) + ' MTS</div>' : '') +
      (pie ? '<div class="p">' + esc(pie) + '</div>' : '') +
      '</div>' + '<style>.l .n{font-size:' + nombreMm + 'mm}.l .c{font-size:' + codigoMm + 'mm}.l .m{font-size:' + metrosMm + 'mm}.l .p{font-size:' + pieMm + 'mm}</style>';
  }
  function estiloEtiqueta([w, h]) {
    const pad = w <= 46 ? (w <= 42 ? 1 : 1.5) : (h >= 40 ? 3 : 2);
    return '.l{width:' + w + 'mm;height:' + h + 'mm;padding:' + pad + 'mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;align-items:center;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;text-align:center}' +
      '.l .n{font-weight:700;line-height:1.1;max-height:2.3em;overflow:hidden;width:100%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.l .b{display:flex;justify-content:center;width:100%}.l .c{font-family:Consolas,"Courier New",monospace;font-weight:700;letter-spacing:.08em}' +
      '.l .m{font-weight:800;line-height:1}.l .p{color:#222;line-height:1.1;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
  }


  // ---------------------------------------------------------------- etiqueta como IMAGEN a la medida exacta (203 dpi = 8 puntos por mm)
  const DPM = 8;
  function etiquetaCanvas(item, tam) {
    const [w, h] = tam, P = paramsEtiqueta(item, tam);
    const W = Math.round(w * DPM), H = Math.round(h * DPM), padPx = Math.round(P.pad * DPM), ancho = W - padPx * 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', {willReadFrequently: true});
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'top';
    const FUENTE = 'Arial, Helvetica, sans-serif';
    const lineasDe = (texto, px, peso, maxLineas) => {
      g.font = peso + ' ' + px + 'px ' + FUENTE;
      const lineas = []; let actual = '';
      String(texto).split(/\s+/).filter(Boolean).forEach(pal => {
        const t = actual ? actual + ' ' + pal : pal;
        if (g.measureText(t).width <= ancho || !actual) actual = t; else { lineas.push(actual); actual = pal; }
      });
      if (actual) lineas.push(actual);
      if (lineas.length > maxLineas) {
        lineas.length = maxLineas; let u = lineas[maxLineas - 1];
        while (u.length > 1 && g.measureText(u + '…').width > ancho) u = u.slice(0, -1);
        lineas[maxLineas - 1] = u + '…';
      }
      return lineas;
    };
    const texto = (txt, px, peso, maxLineas) => {   // reduce la letra hasta que quepa a lo ancho
      let lineas = lineasDe(txt, px, peso, maxLineas);
      while (px > 9 && lineas.some(l => g.measureText(l).width > ancho)) { px -= 1; lineas = lineasDe(txt, px, peso, maxLineas); }
      return {tipo: 'texto', lineas, px, peso, h: Math.ceil(lineas.length * px * 1.12)};
    };
    const bloques = [];
    if (cfg.nombre) bloques.push(texto(P.nombreImpreso, Math.round(P.nombreMm * DPM), '700', 2));
    const altoBarras = Math.round(P.altoBarras * DPM);
    bloques.push({tipo: 'barras', h: altoBarras});
    bloques.push(texto(item.codigo, Math.round(P.codigoMm * DPM), '700', 1));
    if (P.rollo) bloques.push(texto(fmt(item.valor) + ' MTS', Math.round(P.metrosMm * DPM), '800', 1));
    if (P.pie) bloques.push(texto(P.pie, Math.round(P.pieMm * DPM), '400', 1));
    const total = bloques.reduce((a, b) => a + b.h, 0), libre = H - padPx * 2 - total;
    const hueco = bloques.length > 1 ? Math.max(0, libre / (bloques.length - 1)) : 0;
    let y = bloques.length > 1 ? padPx : Math.max(padPx, (H - total) / 2);
    bloques.forEach(b => {
      if (b.tipo === 'texto') {
        g.font = b.peso + ' ' + b.px + 'px ' + FUENTE;
        b.lineas.forEach((l, i) => g.fillText(l, W / 2, Math.round(y + i * b.px * 1.12)));
      } else {
        const modulo = Math.max(1, Math.round(P.modulo * DPM)), cod = code128(item.codigo), totalMod = cod.modulos + P.margen * 2;
        let x = Math.round((W - totalMod * modulo) / 2) + P.margen * modulo;
        cod.anchos.forEach((a, i) => { if (i % 2 === 0) g.fillRect(x, Math.round(y), a * modulo, b.h); x += a * modulo; });
      }
      y += b.h + hueco;
    });
    // ajuste fino: mover todo el contenido unos milímetros (si la impresora corre la etiqueta)
    const dx = Math.round((Number(cfg.dx) || 0) * DPM), dy = Math.round((Number(cfg.dy) || 0) * DPM);
    if (dx || dy) {
      const copia = document.createElement('canvas'); copia.width = W; copia.height = H;
      copia.getContext('2d').drawImage(c, 0, 0);
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(copia, dx, dy);
    }
    // blanco y negro puros: sin grises que el driver de la etiquetadora tenga que adivinar
    const d = g.getImageData(0, 0, W, H), px = d.data;
    for (let i = 0; i < px.length; i += 4) { const v = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) < 150 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    return c;
  }
  function imprimirHTML(html) {
    let ventana = null;
    try { ventana = window.open('', '_blank'); } catch (e) { ventana = null; }
    if (ventana && ventana.document) {
      const auto = '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},300)});window.addEventListener("afterprint",function(){setTimeout(function(){window.close()},400)});<\/script>';
      ventana.document.open();
      ventana.document.write(html.replace('</body>', auto + '</body>'));
      ventana.document.close();
      return;
    }
    // sin ventana (bloqueada): se imprime desde un marco oculto
    const marco = document.createElement('iframe');
    marco.setAttribute('aria-hidden', 'true');
    marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(marco);
    marco.onload = () => { try { marco.contentWindow.focus(); marco.contentWindow.print(); } finally { setTimeout(() => marco.remove(), 120000); } };
    marco.srcdoc = html;
  }
  function imprimirPrueba() {
    const tam = medidas(), [w, h] = tam;
    const c = etiquetaCanvas({tipo: 'tela', codigo: 'T100', nombre: 'PRUEBA ' + w + ' x ' + h + ' mm', categoria_label: 'Stock tela', total_label: '', rollos: 0}, tam);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, 2); g.fillRect(0, c.height - 2, c.width, 2); g.fillRect(0, 0, 2, c.height); g.fillRect(c.width - 2, 0, 2, c.height);   // borde: si se corta, el papel no es de esta medida
    g.fillRect(0, 0, 14, 2); g.fillRect(0, 0, 2, 14);
    imprimirHTML(paginaImagenes([c.toDataURL('image/png')], 'Etiqueta de prueba'));
  }
  // Papel de la impresora: normalmente igual a la etiqueta; si el driver solo trabaja con un papel más grande, la etiqueta va en su esquina superior izquierda
  const medidasHoja = () => (cfg.hoja && cfg.hoja !== 'igual' && TAMANOS[cfg.hoja]) ? TAMANOS[cfg.hoja] : medidas();
  function paginaImagenes(srcs, titulo) {
    const [w, h] = medidas(), [HW, HH] = medidasHoja();
    const paginas = srcs.map(src => '<section class="pg"><img alt="" src="' + src + '"></section>').join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + titulo + '</title><style>@page{size:' + HW + 'mm ' + HH + 'mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}' +
      '.pg{position:relative;width:' + HW + 'mm;height:' + HH + 'mm;overflow:hidden;page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}' +
      '.pg img{position:absolute;left:0;top:0;display:block;width:' + w + 'mm;height:' + h + 'mm;image-rendering:pixelated;image-rendering:crisp-edges}</style></head><body>' + paginas + '</body></html>';
  }
  function imprimirImagen(items) {
    const [w, h] = medidas(), copias = Math.max(1, Math.min(200, Number(cfg.copias) || 1));
    const srcs = [];
    items.forEach(item => { const src = etiquetaCanvas(item, [w, h]).toDataURL('image/png'); for (let i = 0; i < copias; i++) srcs.push(src); });
    imprimirHTML(paginaImagenes(srcs, 'Etiquetas'));
  }

  function imprimir(items) {
    if (cfg.imagen) { imprimirImagen(items); return; }
    const tam = medidas(), [w, h] = tam, copias = Math.max(1, Math.min(200, Number(cfg.copias) || 1));
    const paginas = [];
    items.forEach(item => { for (let i = 0; i < copias; i++) paginas.push('<section class="pg">' + etiquetaHTML(item, tam) + '</section>'); });
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:' + w + 'mm ' + h + 'mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}' +
      '.pg{width:' + w + 'mm;height:' + h + 'mm;page-break-after:always;break-after:page;overflow:hidden}.pg:last-child{page-break-after:auto;break-after:auto}' + estiloEtiqueta(tam) + '</style></head><body>' + paginas.join('') + '</body></html>';
    imprimirHTML(html);
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
.cb-scan{width:fit-content;max-width:100%;padding:8px 12px;gap:8px;border-width:1px}.cb-scan input{flex:0 1 380px!important;width:380px!important;min-width:200px!important;padding:8px 12px!important;font-size:14px!important}.cb-scan .cb-cam{flex:0 0 auto!important;width:auto!important;min-width:0;min-height:36px!important;padding:0 12px!important;font-size:12px!important}.cb-scan span{font-size:10px}
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
.cb-card .nom{font:700 14px Arial;line-height:1.25;color:#eef4e9;overflow-wrap:anywhere}.cb-card .stk{display:flex;gap:8px;flex-wrap:wrap}.cb-card .cif{display:flex;align-items:baseline;gap:5px;padding:5px 10px;border-radius:9px;background:#16221a;border:1px solid #2f402e}.cb-card .cif b{font:800 18px Arial;color:#eaf6c7}.cb-card .cif small{font:800 10px Arial;letter-spacing:.08em;color:#8fa088}.cb-card .cif.und{background:#27391b;border-color:#6c8a4a}.cb-card .cif.und b{color:#d0f44c}
.cb-card .bar{padding:8px;border-radius:8px;background:#fff;overflow:hidden}.cb-card .bar svg{width:100%!important;height:46px!important}
.cb-rl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cb-rl button{width:auto!important;padding:6px 11px;border:1px solid #4f6545;border-radius:8px;background:#1a2616;color:#eaf6c7;font:700 12px Arial;cursor:pointer}.cb-rl button:hover{border-color:#d0f44c}
.cb-lista{display:flex;flex-wrap:wrap;gap:6px;padding-top:2px}
.cb-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid #3a5033;border-radius:8px;background:#142014;color:#d7e4cf;font:600 12px Arial;cursor:pointer;user-select:none}
.cb-chip b{font:800 12px Consolas,monospace;color:#d0f44c}.cb-chip.emp{border-color:#9a6a1f;background:#2a1f10}.cb-chip.emp b{color:#ffb454}
.cb-chip.sel{border-color:#d0f44c;background:#27391b;box-shadow:0 0 0 2px #d0f44c33}.cb-chip.halo{animation:cbhalo 1.6s}
.cb-vacio{padding:40px;text-align:center;color:#8fa088;border:1px dashed #34432f;border-radius:14px}
.cb-barra{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:60;display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;max-width:calc(100vw - 24px);padding:12px 16px;border:1px solid #4a6338;border-radius:16px;background:#0b110bf2;box-shadow:0 14px 40px #000b;backdrop-filter:blur(6px)}
.cb-mas{display:none!important}.cb-opc{display:contents}.cb-opcbtn{display:none}.cb-barra:not(.on){display:none}.cb-barra label{display:flex;align-items:center;gap:6px;color:#c5d1bf;font:600 12px Arial}.cb-barra select,.cb-barra input[type=number]{padding:8px 9px;border:1px solid #3f553d;border-radius:8px;background:#162016;color:#fff;font:13px Arial}
.cb-barra input[type=number]{width:64px!important}.cb-barra input[type=checkbox]{width:auto!important}.cb-barra .p{background:#d0f44c;border-color:#d0f44c;color:#16200c}.cb-barra b{color:#d0f44c}
.cb-prev{position:fixed;inset:0;z-index:90;display:none;place-items:center;background:#000c}.cb-prev.on{display:grid}.cb-prev>div{max-width:92vw;max-height:92vh;overflow:auto;padding:18px;border-radius:16px;background:#1a2218;border:1px solid #4a6338}
.cb-prev h3{margin:0 0 12px;font:800 13px Arial;letter-spacing:.08em;color:#d0f44c}.cb-prev .hoja{display:inline-block;padding:0;border:1px dashed #888;background:#fff;box-shadow:0 8px 28px #0008}
.cb-prev button{margin-top:14px}
.cb-kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.cb-kpi>div{display:grid;gap:2px;padding:12px 16px;border:1px solid #2f402e;border-radius:14px;background:linear-gradient(145deg,#142016,#0f150e)}
.cb-kpi small{font:800 10px Arial;letter-spacing:.1em;color:#8fa088}.cb-kpi b{font:800 24px Arial;color:#eef4e9}.cb-kpi .v b{color:#d0f44c}.cb-kpi .n b{color:#ffb454}
.cb-filtros{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cb-filtros .fc{min-height:36px;padding:6px 14px;border:1px solid #3f553d;border-radius:999px;background:#122015;color:#c9d7bf;font:700 13px Arial;cursor:pointer;white-space:nowrap;width:auto!important}
.cb-filtros .fc.on{background:#d0f44c;border-color:#d0f44c;color:#142017}
.cb-filtros select{margin-left:auto;width:auto!important;padding:8px 12px;border:1px solid #3f553d;border-radius:10px;background:#162016;color:#eef4e9;font:13px Arial}
.cb-res{display:grid;gap:10px;padding:16px 18px;border:2px solid #8bd450;border-radius:16px;background:linear-gradient(145deg,#1a2a16,#0f150e)}
.cb-res[hidden]{display:none}.cb-res.emp{border-color:#ffb454}
.cb-res .top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.cb-res .cod{font:800 26px Consolas,monospace;letter-spacing:.06em;color:#d0f44c}
.cb-res .tag{padding:4px 12px;border-radius:999px;font:800 12px Arial;letter-spacing:.06em;background:#27391b;color:#d0f44c;border:1px solid #6c8a4a}.cb-res.emp .tag{background:#2a1f10;color:#ffb454;border-color:#9a6a1f}
.cb-res .nom{font:700 17px Arial;color:#eef4e9;overflow-wrap:anywhere}
.cb-res .dat{display:flex;gap:10px;flex-wrap:wrap}.cb-res .dat span{display:grid;gap:1px;padding:8px 14px;border-radius:10px;background:#0c110d;border:1px solid #2f402e}
.cb-res .dat small{font:800 10px Arial;letter-spacing:.08em;color:#8fa088}.cb-res .dat b{font:800 20px Arial;color:#eaf6c7}
.cb-res .acc{display:flex;gap:8px;flex-wrap:wrap}.cb-res .acc button{min-height:42px;padding:0 16px;border:1px solid #60754d;border-radius:10px;background:transparent;color:#eaf6c7;font:800 13px Arial;cursor:pointer;width:auto!important}
.cb-res .acc button.p{background:#d0f44c;color:#142017;border-color:#d0f44c}
.cb-card .emp-badge{padding:2px 8px;border-radius:99px;background:#2a1f10;color:#ffb454;border:1px solid #9a6a1f;font:800 10px Arial;white-space:nowrap}
@media(max-width:700px){.cb-kpi{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cb-kpi>div{padding:9px 12px}.cb-kpi b{font-size:19px}
.cb-filtros{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px}.cb-filtros::-webkit-scrollbar{display:none}.cb-filtros select{margin-left:0;flex:none;font-size:14px}
.cb-res{padding:12px 14px}.cb-res .cod{font-size:22px}.cb-res .nom{font-size:15px}.cb-res .dat b{font-size:17px}.cb-res .acc button{flex:1 1 40%}}
@media(max-width:700px){
.cb{gap:12px;padding-bottom:150px}
.cb-hero{padding:16px 16px;border-radius:16px}.cb-hero h2{font-size:1.45rem}.cb-hero p{font-size:.88rem}
.cb-scan{flex-wrap:wrap;gap:8px;padding:12px}.cb-scan span{flex:1 1 100%;white-space:normal}.cb-scan input{flex:1 1 100%;font-size:16px}
.cb-scan .cb-cam{flex:1 1 100%;min-height:50px;font-size:15px}
.cb-tools{gap:8px}.cb-tools input[type=search],.cb-tools select{flex:1 1 100%;min-width:0;font-size:16px}
.cb-tools button{flex:1 1 calc(50% - 8px);min-height:44px}.cb-tools .cuenta{margin-left:0;flex:1 1 100%}
.cb-grid{grid-template-columns:1fr;gap:8px}
.cb-hero p{display:none}.cb-hero{padding:12px 14px}.cb-hero h2{margin:2px 0 0;font-size:1.25rem}.cb-hero .eyebrow{display:none}
.cb-scan{flex-wrap:nowrap!important;align-items:center;width:auto!important;padding:12px!important}.cb-scan span{display:none}.cb-scan input{flex:1 1 0!important;min-width:0!important;width:auto!important;padding:12px 14px!important;font-size:16px!important}
.cb-scan .cb-cam{flex:0 0 54px!important;width:54px!important;min-height:48px!important;padding:0!important;font-size:0!important;text-align:center}.cb-scan .cb-cam::before{content:'📷';font-size:24px;line-height:48px}
.cb-eco{min-height:0}.cb-eco:empty{display:none}
.cb-tools{gap:6px}.cb-tools input[type=search]{flex:1 1 100%}
.cb-tools button{flex:1 1 calc(33% - 6px);min-height:40px;padding:6px 8px;font-size:12px}
.cb-mas{display:inline-block!important}.cb-tools:not(.mas) .cb-sec{display:none}.cb-tools .cuenta{flex:1 1 100%;font-size:12px}
.cb-card{padding:10px;gap:6px}.cb-card .bar{padding:5px}.cb-card .bar svg{height:34px!important}.cb-card .nom{font-size:13px}
.cb-chip{padding:8px 11px;font-size:13px}.cb-rl button{min-height:40px}
.cb-barra{left:8px;right:8px;bottom:8px;transform:none;max-width:none;padding:10px 12px;gap:8px;justify-content:space-between}
.cb-barra button{min-height:44px;flex:1 1 40%}.cb-barra label{flex:1 1 45%}.cb-barra select{flex:1;min-width:0}
.cb-prev>div{max-width:98vw;max-height:94vh;padding:12px}
.cb-opcbtn{display:inline-block;flex:1 1 30%}.cb-opc{display:none;flex:1 1 100%;flex-wrap:wrap;gap:8px;align-items:center;order:5}.cb-barra.opc .cb-opc{display:flex}
.cb-barra>span{flex:1 1 100%;order:0}.cb-barra button.p{flex:1 1 100%;order:9}
}
`;
  document.head.appendChild(estilo);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.dataset.panel = 'codigos-barras';
  panel.innerHTML = '<div class="cb">' +
    '<section class="cb-hero"><div><span class="eyebrow">Producción · Inventarios</span><h2>CÓDIGOS DE BARRAS</h2>' +
    '<p>Cada tela de Stock tela tiene su código permanente y cada <b>rollo</b> tiene el suyo (por ejemplo T100-007). Búscalos, escanéalos con el lector o selecciona los que quieras e imprime sus etiquetas.</p></div></section>' +
    '<div class="cb-kpi" data-cb-kpi></div>' +
    '<div class="cb-scan"><span>ESCANEAR / BUSCAR CÓDIGO</span><input type="text" data-cb-scan autocomplete="off" spellcheck="false" placeholder="Pasa el lector o escribe, por ejemplo T100 o T100-007"><button type="button" class="cb-cam" data-cb-cam aria-label="Escanear con la cámara">📷 Escanear con la cámara</button></div><div class="cb-eco" data-cb-eco></div><section class="cb-res" data-cb-res hidden></section>' +
    '<div class="cb-tools"><input type="search" data-cb-q placeholder="Buscar tela por nombre o código"><select data-cb-cat hidden><option value="">Todas las categorías</option></select>' +
    '<button type="button" class="cb-mas" data-cb-mas>⋯ Más</button><button type="button" class="cb-sec" data-cb-todos>Seleccionar las telas visibles</button><button type="button" class="cb-sec" data-cb-todosrollos>Seleccionar todos los rollos visibles</button><button type="button" data-cb-ninguno>Quitar selección</button><button type="button" data-cb-prueba title="Imprime una etiqueta de prueba con un recuadro en el borde para comprobar la medida del papel">🧪 Etiqueta de prueba</button><button type="button" data-cb-recargar>Actualizar</button><span class="cuenta" data-cb-cuenta></span></div>' +
    '<div class="cb-filtros" data-cb-filtros><button type="button" class="fc on" data-cb-f="">Todas</button><button type="button" class="fc" data-cb-f="emp">Con rollos empezados</button><button type="button" class="fc" data-cb-f="bajo">Stock bajo</button><button type="button" class="fc" data-cb-f="sin">Sin rollos</button>' +
    '<select data-cb-orden aria-label="Ordenar"><option value="nombre">Ordenar: A–Z</option><option value="mts-desc">Más metros primero</option><option value="mts-asc">Menos metros primero</option><option value="rollos-desc">Más rollos primero</option></select></div>' +
    '<div class="cb-grid" data-cb-grid></div></div>';

  const extras = document.createElement('div');
  extras.dataset.cbExtras = 'true';
  extras.innerHTML = '<div class="cb-barra" data-cb-barra><span><b data-cb-n>0</b> etiquetas <small data-cb-det></small></span><button type="button" class="cb-opcbtn" data-cb-opcbtn>⚙ Opciones</button><div class="cb-opc">' +
    '<label>Etiqueta <select data-cb-tam>' + Object.keys(TAMANOS).map(k => '<option value="' + k + '">' + k.replace('x', ' × ') + ' mm</option>').join('') + '<option value="otro">Otro tamaño…</option></select></label>' +
    '<label data-cb-otro hidden>Ancho <input type="number" min="20" max="200" data-cb-w> × Alto <input type="number" min="15" max="200" data-cb-h> mm</label>' +
    '<label>Copias <input type="number" min="1" max="200" data-cb-copias></label>' +
    '<label>Papel de la impresora <select data-cb-papel><option value="igual">Igual que la etiqueta</option>' + Object.keys(TAMANOS).map(k => '<option value="' + k + '">' + k.replace('x', ' × ') + ' mm</option>').join('') + '</select></label>' +
    '<label>Mover → <input type="number" step="0.5" min="-10" max="10" data-cb-dx> mm</label><label>↓ <input type="number" step="0.5" min="-10" max="10" data-cb-dy> mm</label>' +
    '<label>Barras <select data-cb-ab><option value="1">Ancho máximo</option><option value="0.9">90 %</option><option value="0.8">80 %</option><option value="0.7">70 %</option></select></label>' +
    '<label><input type="checkbox" data-cb-op="nombre"> Nombre</label><label><input type="checkbox" data-cb-op="categoria"> Categoría</label><label><input type="checkbox" data-cb-op="stock"> Cantidad</label><label><input type="checkbox" data-cb-op="fecha"> Fecha</label><label><input type="checkbox" data-cb-op="imagen"> Como imagen</label></div>' +
    '<button type="button" data-cb-vista>Vista previa</button><button type="button" class="p" data-cb-imprimir>Imprimir etiquetas</button></div>' +
    '<div class="cb-prev" data-cb-prev><div><h3>VISTA PREVIA · tamaño real de la etiqueta</h3><div data-cb-hoja></div><button type="button" data-cb-cerrar>Cerrar</button></div></div>';
  document.body.appendChild(extras);

  const q = sel => panel.querySelector(sel) || extras.querySelector(sel);
  const estado = {items: [], sel: new Set(), selR: new Set(), abiertos: new Set(), rollMap: new Map(), texto: '', cat: '', cargando: false, filtro: '', orden: 'nombre'};
  const BAJO_MTS = 100;
  const empezados = i => (i.detalle_rollos || []).filter(r => r.empezado).length;
  let cargado = false, pendiente = '';

  const visibles = () => {
    const t = norm(estado.texto);
    const lista = estado.items.filter(i => (!estado.cat || i.categoria === estado.cat) && (!t || norm(i.nombre + ' ' + i.codigo).includes(t) || (i.detalle_rollos || []).some(r => compacto(r.codigo).includes(compacto(t))))
      && (!estado.filtro || (estado.filtro === 'emp' ? empezados(i) > 0 : estado.filtro === 'bajo' ? Number(i.mts || 0) < BAJO_MTS : !(i.rollos > 0))));
    const por = {'mts-desc': (a, b) => Number(b.mts || 0) - Number(a.mts || 0), 'mts-asc': (a, b) => Number(a.mts || 0) - Number(b.mts || 0), 'rollos-desc': (a, b) => Number(b.rollos || 0) - Number(a.rollos || 0)}[estado.orden];
    return por ? lista.slice().sort(por) : lista;
  };
  const pintarKpi = () => {
    const el = q('[data-cb-kpi]'); if (!el) return;
    const it = estado.items, rollos = it.reduce((a, i) => a + Number(i.rollos || 0), 0), mts = it.reduce((a, i) => a + Number(i.mts || 0), 0), emp = it.reduce((a, i) => a + empezados(i), 0);
    el.innerHTML = '<div><small>TELAS</small><b>' + it.length + '</b></div><div class="v"><small>METROS EN BODEGA</small><b>' + fmt(mts) + '</b></div><div><small>ROLLOS</small><b>' + rollos + '</b></div><div class="n"><small>ROLLOS EMPEZADOS</small><b>' + emp + '</b></div>';
  };
  const totalSeleccion = () => estado.sel.size + estado.selR.size;
  const pintar = () => {
    const lista = visibles();
    q('[data-cb-grid]').innerHTML = lista.length ? lista.map(i => {
      const rollos = i.detalle_rollos || [], abierto = estado.abiertos.has(i.codigo);
      const chips = abierto ? '<div class="cb-lista">' + rollos.map(r => '<span class="cb-chip' + (r.empezado ? ' emp' : '') + (estado.selR.has(r.codigo) ? ' sel' : '') + '" data-roll="' + esc(r.codigo) + '" title="' + esc(r.codigo) + '"><b>' + String(r.n).padStart(3, '0') + '</b>' + esc(fmt(r.valor)) + ' m</span>').join('') + '</div>' : '';
      const botones = rollos.length ? '<div class="cb-rl"><button type="button" data-roll-toggle="' + esc(i.codigo) + '">' + (abierto ? '▾' : '▸') + ' ' + rollos.length + (rollos.length === 1 ? ' rollo' : ' rollos') + '</button>' + (abierto ? '<button type="button" data-roll-todos="' + esc(i.codigo) + '">Seleccionar todos</button>' : '') + '</div>' + chips : '';
      return '<article class="cb-card' + (estado.sel.has(i.codigo) ? ' sel' : '') + '" data-cod="' + esc(i.codigo) + '"><header><input type="checkbox" tabindex="-1"' + (estado.sel.has(i.codigo) ? ' checked' : '') + '><span class="cod">' + esc(i.codigo) + '</span><span class="cat">' + esc(i.categoria_label) + '</span>' + (empezados(i) ? '<span class="emp-badge">' + empezados(i) + (empezados(i) > 1 ? ' empezados' : ' empezado') + '</span>' : '') + '</header>' +
        '<div class="nom">' + esc(i.nombre) + '</div><div class="stk"><span class="cif"><b>' + esc(i.total_label || '—') + '</b><small>' + (i.categoria === 'BODEGA TELA' ? 'MTS' : 'UND') + '</small></span>' + (i.rollos ? '<span class="cif und"><b>' + i.rollos + '</b><small>' + (i.rollos === 1 ? 'ROLLO' : 'ROLLOS') + '</small></span>' : '') + '</div>' +
        '<div class="bar">' + svgBarras(i.codigo, 46, 1, 10) + '</div>' + botones + '</article>';
    }).join('') : '<div class="cb-vacio">' + (estado.cargando ? 'Cargando telas…' : 'No hay telas que coincidan.') + '</div>';
    q('[data-cb-cuenta]').textContent = lista.length + ' de ' + estado.items.length + ' telas';
    pintarKpi();
    q('[data-cb-filtros]').querySelectorAll('[data-cb-f]').forEach(b => b.classList.toggle('on', b.dataset.cbF === estado.filtro));
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
  function mostrarResultado(tipo, tela, rollo) {
    const box = q('[data-cb-res]'); if (!box) return;
    const nuevos = (tela.detalle_rollos || []).filter(r => !r.empezado).length, ya = empezados(tela);
    box.className = 'cb-res' + (tipo === 'rollo' && rollo.empezado ? ' emp' : '');
    box.hidden = false;
    box.innerHTML = '<div class="top"><span class="cod">' + esc(tipo === 'rollo' ? rollo.codigo : tela.codigo) + '</span><span class="tag">' + (tipo === 'rollo' ? (rollo.empezado ? 'ROLLO EMPEZADO' : 'ROLLO NUEVO') : 'TELA') + '</span></div>' +
      '<div class="nom">' + esc(tela.nombre) + '</div>' +
      '<div class="dat">' + (tipo === 'rollo'
        ? '<span><small>METROS DEL ROLLO</small><b>' + esc(fmt(rollo.valor)) + '</b></span><span><small>TELA EN TOTAL</small><b>' + esc(tela.total_label || '—') + ' MTS</b></span><span><small>ROLLOS DE ESTA TELA</small><b>' + (tela.rollos || 0) + '</b></span>'
        : '<span><small>METROS EN BODEGA</small><b>' + esc(tela.total_label || '—') + '</b></span><span><small>ROLLOS</small><b>' + (tela.rollos || 0) + '</b></span><span><small>NUEVOS · EMPEZADOS</small><b>' + nuevos + ' · ' + ya + '</b></span>') + '</div>' +
      '<div class="acc"><button type="button" class="p" data-res-imp="' + esc(tipo === 'rollo' ? rollo.codigo : tela.codigo) + '">🖨 Imprimir esta etiqueta</button><button type="button" data-res-x>Cerrar</button></div>';
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
      mostrarResultado('rollo', hit.tela, hit.rollo);
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
    mostrarResultado('tela', item);
    eco('✓ ' + item.codigo + ' · ' + item.nombre + ' · ' + (item.total_label || '—') + ' MTS · ' + (item.detalle_rollos || []).length + ' rollos', 'ok');
    enfocar('[data-cod="' + CSS.escape(item.codigo) + '"]');
  }

  const aplicarCfg = () => {
    q('[data-cb-tam]').value = cfg.tamano; q('[data-cb-w]').value = cfg.ancho; q('[data-cb-h]').value = cfg.alto; q('[data-cb-copias]').value = cfg.copias; q('[data-cb-dx]').value = cfg.dx; q('[data-cb-dy]').value = cfg.dy; q('[data-cb-ab]').value = String(cfg.anchoBarras); q('[data-cb-papel]').value = cfg.hoja || 'igual';
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
    if (e.target.closest('[data-cb-prueba]')) { imprimirPrueba(); return; }
    const filtro = e.target.closest('[data-cb-f]');
    if (filtro) { estado.filtro = filtro.dataset.cbF; pintar(); return; }
    if (e.target.closest('[data-res-x]')) { q('[data-cb-res]').hidden = true; return; }
    const imp1 = e.target.closest('[data-res-imp]');
    if (imp1) {
      const c = imp1.dataset.resImp, hit = estado.rollMap.get(compacto(c));
      if (hit) imprimir([{tipo: 'rollo', codigo: hit.rollo.codigo, n: hit.rollo.n, valor: hit.rollo.valor, empezado: hit.rollo.empezado, nombre: hit.tela.nombre, categoria: hit.tela.categoria, categoria_label: hit.tela.categoria_label}]);
      else { const t = estado.items.find(i => i.codigo === c); if (t) imprimir([{...t, tipo: 'tela'}]); }
      return;
    }
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
      q('[data-cb-hoja]').innerHTML = (cfg.imagen ? '<div class="hoja"><img alt="" style="display:block;width:' + tam[0] + 'mm;height:' + tam[1] + 'mm;image-rendering:pixelated" src="' + etiquetaCanvas(lista[0], tam).toDataURL('image/png') + '"></div>' : '<style>' + estiloEtiqueta(tam) + '</style><div class="hoja">' + etiquetaHTML(lista[0], tam) + '</div>') + (lista.length > 1 ? '<p style="color:#aebba7;font:12px Arial">Se muestra la primera de ' + lista.length + ' etiquetas.</p>' : '');
      q('[data-cb-prev]').classList.add('on'); return;
    }
    if (e.target.closest('[data-cb-cerrar]') || e.target === q('[data-cb-prev]')) { q('[data-cb-prev]').classList.remove('on'); return; }
    if (e.target.closest('[data-cb-imprimir]')) { const lista = seleccionados(); if (lista.length) imprimir(lista); }
  };
  const alEscribir = e => {
    if (e.target.matches('[data-cb-q]')) { estado.texto = e.target.value; pintar(); }
    else if (e.target.matches('[data-cb-copias]')) { cfg.copias = e.target.value; guardarCfg(); }
    else if (e.target.matches('[data-cb-dx]')) { cfg.dx = Number(e.target.value) || 0; guardarCfg(); }
    else if (e.target.matches('[data-cb-dy]')) { cfg.dy = Number(e.target.value) || 0; guardarCfg(); }
    else if (e.target.matches('[data-cb-w]')) { cfg.ancho = e.target.value; guardarCfg(); }
    else if (e.target.matches('[data-cb-h]')) { cfg.alto = e.target.value; guardarCfg(); }
  };
  const alCambiar = e => {
    if (e.target.matches('[data-cb-cat]')) { estado.cat = e.target.value; pintar(); }
    else if (e.target.matches('[data-cb-papel]')) { cfg.hoja = e.target.value; guardarCfg(); }
    else if (e.target.matches('[data-cb-ab]')) { cfg.anchoBarras = Number(e.target.value) || 1; guardarCfg(); }
    else if (e.target.matches('[data-cb-orden]')) { estado.orden = e.target.value; pintar(); }
    else if (e.target.matches('[data-cb-tam]')) { cfg.tamano = e.target.value; q('[data-cb-otro]').hidden = cfg.tamano !== 'otro'; guardarCfg(); }
    else if (e.target.matches('[data-cb-op]')) { cfg[e.target.dataset.cbOp] = e.target.checked; guardarCfg(); }
  };
  panel.addEventListener('click', e => { if (e.target.closest('[data-cb-mas]')) q('.cb-tools').classList.toggle('mas'); });
  extras.addEventListener('click', e => { const b = e.target.closest('[data-cb-opcbtn]'); if (b) q('[data-cb-barra]').classList.toggle('opc'); });
  [panel, extras].forEach(zona => { zona.addEventListener('click', alClic); zona.addEventListener('input', alEscribir); zona.addEventListener('change', alCambiar); });
  q('[data-cb-scan]').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); escanear(e.target.value); e.target.value = '';   // el lector escribe el código y pulsa Enter
  });


  // ---------------------------------------------------------------- escanear con la cámara del celular (o de cualquier equipo con cámara)
  const camCss = document.createElement('style');
  camCss.textContent = `
  .cb-cam{flex:none;min-height:46px;padding:0 16px;border:0;border-radius:10px;background:#d0f44c;color:#142017;font:800 13px Arial;cursor:pointer;white-space:nowrap}
  .cb-cam-ov{position:fixed;inset:0;z-index:100000;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#050805;color:#fff}
  .cb-cam-ov header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 16px;background:#0c110d}
  .cb-cam-ov header b{font:800 13px Arial;letter-spacing:.1em;color:#d0f44c}
  .cb-cam-ov header button{min-height:42px;padding:0 18px;border:1px solid #60754d;border-radius:10px;background:transparent;color:#fff;font:800 13px Arial;cursor:pointer}
  .cb-cam-ov .vista{position:relative;overflow:hidden;background:#000}
  .cb-cam-ov video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .cb-cam-ov .mira{position:absolute;left:8%;right:8%;top:50%;height:26%;transform:translateY(-50%);border:3px solid #d0f44c;border-radius:14px;box-shadow:0 0 0 100vmax rgba(0,0,0,.45)}
  .cb-cam-ov .mira::after{content:'';position:absolute;left:6%;right:6%;top:50%;height:2px;background:#ff5a5a;box-shadow:0 0 8px #ff5a5a}
  .cb-cam-ov footer{padding:14px 16px 22px;background:#0c110d;display:grid;gap:8px;text-align:center}
  .cb-cam-ov .res{font:800 16px Arial;min-height:22px}.cb-cam-ov .res.ok{color:#8bd450}.cb-cam-ov .res.mal{color:#ff8a7c}
  .cb-cam-ov small{color:#aebba7;font-size:12px;line-height:1.4}
  .cb-cam-ov .foto{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;border:1px solid #d0f44c;border-radius:12px;color:#d0f44c;font:800 14px Arial;cursor:pointer}`;
  document.head.appendChild(camCss);

  let camActiva = null;
  // El lector (ZXing) se sirve desde el propio panel: no depende de internet externo ni de bloqueadores del celular
  function cargarZXing() {
    return new Promise((ok, mal) => {
      if (window.ZXing) return ok(window.ZXing);
      const sc = document.createElement('script');
      sc.src = '/zxing.js?v=1';
      sc.onload = () => (window.ZXing ? ok(window.ZXing) : mal(new Error('El lector de códigos no se pudo iniciar.')));
      sc.onerror = () => mal(new Error('No se pudo cargar el lector de códigos. Revisa tu conexión y vuelve a intentar.'));
      document.head.appendChild(sc);
    });
  }
  // Devuelve una función canvas -> texto leído (o null)
  function crearDecodificador(ZX) {
    const hints = new Map();
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.QR_CODE]);
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    const lector = new ZX.MultiFormatReader();
    lector.setHints(hints);
    return canvas => {
      try { return lector.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.HTMLCanvasElementLuminanceSource(canvas)))).getText(); } catch (e) { return null; }
    };
  }
  // Recorta una región de una imagen/video y la escala (más píxeles por barra = lectura más fácil)
  function recorte(fuente, sw, sh, x, y, w, h, anchoMax, giro) {
    const esc = Math.min(2, anchoMax / w), cw = Math.round(w * esc), ch = Math.round(h * esc);
    const c = document.createElement('canvas');
    if (giro) { c.width = ch; c.height = cw; const g = c.getContext('2d'); g.translate(ch, 0); g.rotate(Math.PI / 2); g.drawImage(fuente, x, y, w, h, 0, 0, cw, ch); }
    else { c.width = cw; c.height = ch; c.getContext('2d').drawImage(fuente, x, y, w, h, 0, 0, cw, ch); }
    return c;
  }
  // Intenta varias regiones: franja central (donde apunta la mira), la imagen entera y la imagen girada
  function leerImagen(fuente, sw, sh, decodificar, completo) {
    const bandas = [[0, sh * 0.32, sw, sh * 0.36], [sw * 0.05, sh * 0.38, sw * 0.9, sh * 0.24], [0, 0, sw, sh]];
    if (completo) bandas.push([0, sh * 0.2, sw, sh * 0.6], [0, 0, sw, sh / 2], [0, sh / 2, sw, sh / 2]);
    for (const [x, y, w, h] of bandas) {
      for (const giro of completo ? [false, true] : [false]) {
        const t = decodificar(recorte(fuente, sw, sh, x, y, w, h, 1280, giro));
        if (t) return t;
      }
    }
    return null;
  }
  async function abrirCamara() {
    if (camActiva) return;
    const ov = document.createElement('div');
    ov.className = 'cb-cam-ov';
    ov.innerHTML = '<header><b>ESCANEAR CÓDIGO</b><button type="button" data-cam-x>Cerrar</button></header><div class="vista"><video playsinline muted autoplay></video><div class="mira"></div></div>' +
      '<footer><div class="res" data-cam-res></div><small data-cam-ayuda>Apunta a la barra del código de la etiqueta. Mantén el celular quieto, a unos 15-20 cm, con buena luz.</small>' +
      '<label class="foto"><input type="file" accept="image/*" capture="environment" data-cam-foto hidden>📷 Tomar una foto del código</label></footer>';
    document.body.appendChild(ov);
    const video = ov.querySelector('video'), res = ov.querySelector('[data-cam-res]'), ayuda = ov.querySelector('[data-cam-ayuda]');
    let corriendo = true, stream = null, ultimo = '', ultimoT = 0, intentos = 0, decodificar = null;
    // El botón «Atrás» del celular cierra solo la cámara (no sale de la página ni pide iniciar sesión otra vez)
    let conHistoria = false;
    try { history.pushState({ cbcam: 1 }, '', location.href); conHistoria = true; } catch (e) { /* sin historial */ }
    const alAtras = () => { if (camActiva) { conHistoria = false; cerrar(); } };
    window.addEventListener('popstate', alAtras);
    const cerrar = () => {
      window.removeEventListener('popstate', alAtras);
      const volver = conHistoria && history.state && history.state.cbcam; conHistoria = false;
      corriendo = false; camActiva = null;
      if (stream) stream.getTracks().forEach(t => t.stop());
      ov.remove();
      if (volver) { try { history.back(); } catch (e) { /* nada */ } }
    };
    camActiva = { cerrar };
    ov.querySelector('[data-cam-x]').onclick = cerrar;
    const mensaje = (texto, clase) => { res.className = 'res ' + (clase || ''); res.textContent = texto; };
    const alLeer = valor => {
      valor = String(valor || '').trim(); if (!valor) return;
      const ahora = Date.now();
      if (valor === ultimo && ahora - ultimoT < 2500) return;   // no repetir el mismo código mientras sigue enfrente
      ultimo = valor; ultimoT = ahora;
      try { navigator.vibrate && navigator.vibrate(120); } catch (e) { /* sin vibración */ }
      escanear(valor);
      const eco = (q('[data-cb-eco]').textContent || '').trim();
      mensaje(eco || valor, q('[data-cb-eco]').classList.contains('mal') ? 'mal' : 'ok');
    };
    // Foto del código (funciona aunque el navegador no deje usar la cámara en vivo, por ejemplo dentro de otra app)
    ov.querySelector('[data-cam-foto]').addEventListener('change', async e => {
      const archivo = e.target.files && e.target.files[0]; e.target.value = ''; if (!archivo) return;
      mensaje('Leyendo la foto…', '');
      try {
        const ZX = await cargarZXing(); if (!decodificar) decodificar = crearDecodificador(ZX);
        const bmp = await (window.createImageBitmap ? createImageBitmap(archivo) : new Promise((ok, mal) => { const im = new Image(); im.onload = () => ok(im); im.onerror = mal; im.src = URL.createObjectURL(archivo); }));
        const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
        const texto = leerImagen(bmp, w, h, decodificar, true);
        if (texto) alLeer(texto); else mensaje('No pude leer el código en esa foto. Acércate para que la barra ocupe casi todo el ancho y vuelve a intentar.', 'mal');
      } catch (err) { mensaje((err && err.message) || 'No se pudo leer la foto.', 'mal'); }
    });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('Este navegador no deja usar la cámara en vivo. Usa «Tomar una foto del código» o abre el panel directamente en Safari/Chrome.'), { name: 'SinCamara' });
      mensaje('Abriendo la cámara…', '');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const pista = stream.getVideoTracks()[0];
      try { await pista.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* sin enfoque continuo */ }
      video.srcObject = stream; await video.play();
      mensaje('Buscando el código…', '');
      let detector = null;
      if ('BarcodeDetector' in window) {
        try { const fm = await BarcodeDetector.getSupportedFormats(); if (fm.includes('code_128')) detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] }); } catch (e) { detector = null; }
      }
      if (!detector) { ayuda.textContent = 'Cargando el lector…'; const ZX = await cargarZXing(); decodificar = crearDecodificador(ZX); ayuda.textContent = 'Apunta a la barra del código de la etiqueta. Mantén el celular quieto, a unos 15-20 cm, con buena luz.'; }
      let alterna = 0;
      const ciclo = async () => {
        if (!corriendo) return;
        try {
          const vw = video.videoWidth, vh = video.videoHeight;
          if (vw && vh) {
            intentos++;
            let texto = null;
            if (detector) { const r = await detector.detect(video); if (r.length) texto = r[0].rawValue; }
            else { alterna++; texto = leerImagen(video, vw, vh, decodificar, alterna % 4 === 0); }
            if (texto) alLeer(texto);
            else if (intentos % 8 === 0 && !res.classList.contains('ok') && !res.classList.contains('mal')) mensaje('Buscando el código… (' + intentos + ')', '');
          }
        } catch (e) { /* cuadro sin imagen */ }
        setTimeout(ciclo, detector ? 120 : 180);
      };
      ciclo();
    } catch (err) {
      const motivo = String(err && (err.name + ' ' + err.message));
      mensaje(/Permission|NotAllowed/i.test(motivo) ? 'La cámara está bloqueada. Permite el acceso a la cámara para este sitio (Ajustes del navegador) o usa «Tomar una foto del código».'
        : /NotFound|not found/i.test(motivo) ? 'No encontré una cámara en este equipo. Ábrelo desde tu celular.' : (err && err.message) || 'No se pudo abrir la cámara.', 'mal');
    }
  }
  panel.addEventListener('click', e => { if (e.target.closest('[data-cb-cam]')) abrirCamara(); });

  // Al registrar un INGRESO, los rollos nuevos reciben su código de barras y aquí se ofrece imprimir sus etiquetas de una vez
  function ofrecerEtiquetas(lista) {
    if (!Array.isArray(lista) || !lista.length) return;
    const ov = document.createElement('div');
    ov.className = 'cb-nuevos-ov';
    ov.innerHTML = '<div class="cb-nuevos"><h3>✓ Ingreso registrado · códigos de barras de los rollos nuevos</h3>' +
      '<div class="lst">' + lista.map(r => '<div><b>' + esc(r.codigo) + '</b><span>' + esc(r.tela) + '</span><em>' + esc(fmt(r.valor)) + ' MTS</em></div>').join('') + '</div>' +
      '<div class="acc"><button type="button" class="p" data-nv-imp>🖨 Imprimir ' + lista.length + (lista.length === 1 ? ' etiqueta' : ' etiquetas') + '</button><button type="button" data-nv-x>Ahora no</button></div>' +
      '<small>Las etiquetas salen con el tamaño elegido en Inventarios → Códigos de barras. Los rollos quedan en esa pantalla cuando quieras imprimirlos después.</small></div>';
    document.body.appendChild(ov);
    ov.querySelector('[data-nv-x]').onclick = () => ov.remove();
    ov.querySelector('[data-nv-imp]').onclick = () => {
      imprimir(lista.map(r => ({tipo: 'rollo', codigo: r.codigo, n: r.n, valor: r.valor, empezado: false, nombre: r.tela, categoria: 'BODEGA TELA', categoria_label: 'Stock tela'})));
    };
  }
  const nuevosCss = document.createElement('style');
  nuevosCss.textContent = '.cb-nuevos-ov{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px;background:#000b}' +
    '.cb-nuevos{width:min(560px,100%);max-height:90vh;overflow:auto;display:grid;gap:12px;padding:20px;border:1px solid #4a6338;border-radius:18px;background:#10170f;color:#eef4e9}' +
    '.cb-nuevos h3{margin:0;font:800 14px Arial;color:#d0f44c;line-height:1.35}.cb-nuevos .lst{display:grid;gap:6px;max-height:40vh;overflow:auto}' +
    '.cb-nuevos .lst div{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid #2f402e;border-radius:10px;background:#0c110d;font-size:13px}' +
    '.cb-nuevos .lst b{font:800 15px Consolas,monospace;color:#d0f44c}.cb-nuevos .lst span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c4cfbf}.cb-nuevos .lst em{font-style:normal;font-weight:800}' +
    '.cb-nuevos .acc{display:flex;gap:10px;flex-wrap:wrap}.cb-nuevos button{flex:1 1 40%;min-height:46px;border:1px solid #60754d;border-radius:12px;background:transparent;color:#eaf6c7;font:800 14px Arial;cursor:pointer}' +
    '.cb-nuevos button.p{background:#d0f44c;color:#142017;border-color:#d0f44c}.cb-nuevos small{color:#8fa088;font-size:12px;line-height:1.4}';
  document.head.appendChild(nuevosCss);
  setTimeout(() => {
    try { const raw = sessionStorage.getItem('cbPend'); if (raw) { sessionStorage.removeItem('cbPend'); ofrecerEtiquetas(JSON.parse(raw)); } } catch (e) { /* sin sessionStorage */ }
  }, 900);

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
