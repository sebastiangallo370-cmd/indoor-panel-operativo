(() => {
  'use strict';
  if (window.__indoorVentasListo) return;
  window.__indoorVentasListo = true;

  // Todas las clases llevan el prefijo vx- para no chocar con el CSS global del panel.
  const DOCS = [['cotizacion', 'COTIZACIÓN', 'Cotización'], ['remision', 'REMISIÓN', 'Remisión de venta']];
  // MENÚ CO / MENÚ RM: lo ya creado en Effi, en tarjetas como las de producción.
  const MENUS = {
    'menu-co': { tipo: 'cotizacion', titulo: 'Cotizaciones', sigla: 'CO' },
    'menu-rm': { tipo: 'remision', titulo: 'Remisiones', sigla: 'RM' },
  };
  // Cada pestaña tiene dos vistas: crear un documento nuevo y ver los ya creados en Effi.
  const PESTANAS = DOCS.map(d => [d[0], d[1]]);
  const MENU_DE = { cotizacion: MENUS['menu-co'], remision: MENUS['menu-rm'] };
  const TONO = { pendientes: 'ambar', cerradas: 'verde', anuladas: 'rojo' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v || 0));
  const cifra = (v, decimales = 2) => Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: decimales });
  const hoy = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const plano = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const pct = v => Math.max(0, Math.min(100, Number(v || 0)));
  const sinAsterisco = t => String(t).replace(/\s*\*\s*$/, '').trim();

  // Cada opción de cualquier lista usa la misma estructura: título, detalle y dato a la derecha.
  // Resalta en el texto la parte que coincide con lo buscado (sin importar tildes ni mayúsculas).
  function resaltar(texto, q) {
    const t = String(texto || ''), buscado = String(q || '').trim(), i = buscado ? plano(t).indexOf(plano(buscado)) : -1;
    return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + buscado.length)) + '</mark>' + esc(t.slice(i + buscado.length));
  }
  const opcion = (titulo, sub = '', der = '') =>
    `<span class="vx-op-t">${esc(titulo)}</span>${sub ? `<span class="vx-op-s">${esc(sub)}</span>` : ''}${der ? `<span class="vx-op-d">${der}</span>` : ''}`;

  // Solo los vendedores que usa el equipo en Effi y las líneas de producto de la empresa.
  const VENDEDORES = ['AUGUSTO', 'ANDRES', 'YENIFFER', 'DAVID'];
  const LINEAS = ['PREMIUM', 'ESTÁNDAR', 'MÁQUINA', 'PLUS'];
  function filtrarVendedores(lista = []) {
    const palabras = nombre => plano(nombre).split(/[^A-Z0-9]+/);
    const elegidos = VENDEDORES.flatMap(v => lista.filter(x => palabras(x.nombre).includes(v)));
    const unicos = [...new Map(elegidos.map(x => [String(x.id), x])).values()];
    return unicos.length ? unicos : lista; // si Effi cambia los nombres, no deja el selector vacío
  }

  const FUENTES = {
    sucursal: o => o.sucursales, bodega: o => o.bodegas, centro: o => o.centros_costos,
    forma: o => o.formas_pago, vendedor: o => filtrarVendedores(o.vendedores),
    lineas: () => LINEAS.map(l => ({ id: l, nombre: l })),
  };
  const FOCO = {
    cliente: '[data-buscador="cliente"] [data-texto]', sucursal: '[data-buscador="sucursal"] [data-texto]',
    bodega: '[data-buscador="bodega"] [data-texto]', centro: '[data-buscador="centro"] [data-texto]',
    fecha: '[data-fecha]', forma: '[data-buscador="forma"] [data-texto]',
    proyecto: '[data-buscador="proyecto"] [data-texto]', lineas: '[data-buscador="lineas"] [data-texto]',
    articulo: '[data-buscador="articulo"] [data-texto]', cant: '[data-cant]',
  };

  let panel = null, actual = 'cotizacion', opciones = null;
  let cliente = null, tercero = null, direcciones = [], proyectos = [], puedeCrearProyecto = false;
  let articulos = [], retencionesSel = [], enviando = false, catalogoTimer = 0;
  let menu = { tipo: '', pagina: 0, documentos: [], q: '', filtro: 'todas', cargando: false, hayMas: false, turno: 0 }, turnoMenu = 0;
  const versiones = { stock: 0, proyecto: 0 };

  // ---------- Estilos ----------
  const css = `
    .vx{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;width:100%;max-width:1600px;min-width:0;margin:12px auto 110px;color:#dce8d6;font-family:Arial,sans-serif}
    .vx *,.vx *::before,.vx *::after{box-sizing:border-box}
    .vx-cab{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 20px;border:1px solid rgba(208,244,76,.3);border-radius:18px;background:linear-gradient(110deg,rgba(208,244,76,.14),rgba(7,16,8,.8))}
    .vx-kicker{display:block;color:#d0f44c;font:800 11px Arial;letter-spacing:.14em}
    .vx-titulo{margin:2px 0 0;color:#f5faef;font:900 24px Arial}
    .vx-tabs{display:flex;gap:6px;flex-wrap:wrap}
    .vx-tab{display:inline-flex;align-items:center;justify-content:center;min-height:34px;margin:0;padding:0 16px;border:1px solid rgba(255,255,255,.14);border-radius:11px;background:#0c160d;color:#c7d3c1;font:800 12px/1 Arial;letter-spacing:.06em;cursor:pointer;transition:background .18s,border-color .18s,color .18s}
    .vx-tab:hover{border-color:rgba(208,244,76,.5)}
    .vx-tab.activa{background:linear-gradient(135deg,#eaff85,#afe936);border-color:#d0f44c;color:#132012}
    .vx-card{padding:14px;border:1px solid rgba(208,244,76,.24);border-radius:18px;background:rgba(9,17,10,.8);box-shadow:0 18px 45px rgba(0,0,0,.25);animation:vxEntrar .35s ease both}
    @keyframes vxEntrar{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .vx-doc h3{margin:0 0 10px;color:#f5faef;font:900 20px Arial}
    .vx-sec{margin-top:10px;border-top:1px solid rgba(255,255,255,.1)}
    .vx-sec>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;padding-top:12px;color:#edffc1;font:900 14px Arial;cursor:pointer;list-style:none}
    .vx-sec>summary::-webkit-details-marker{display:none}
    .vx-sec>summary::after{content:'';width:9px;height:9px;border-right:2px solid #d0f44c;border-bottom:2px solid #d0f44c;transform:rotate(45deg);transition:transform .2s;margin-right:4px}
    .vx-sec[open]>summary::after{transform:rotate(-135deg)}
    .vx-sec>.vx-sec-cuerpo{padding:6px 0 4px}
    .vx-campos{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px}
    .vx-campos .vx-c2{grid-column:span 2}.vx-campos .vx-c3{grid-column:span 3}.vx-campos .vx-c4{grid-column:span 4}.vx-campos .vx-c6{grid-column:span 6}.vx-campos .vx-c12{grid-column:1/-1}
    .vx-campo{position:relative;display:grid;gap:6px;min-width:0}
    .vx-etq{color:#aebba9;font:800 10px Arial;letter-spacing:.08em;text-transform:uppercase}
    .vx-entrada{position:relative}
    .vx input.vx-in,.vx select.vx-in,.vx textarea.vx-in{width:100%;min-height:38px;padding:0 11px;border:1px solid #3f513f;border-radius:10px;background:#122013;color:#f5faef;font:600 14px Arial;outline:0;transition:border-color .15s,box-shadow .15s,background .15s;-webkit-appearance:none;appearance:none}
    .vx input.vx-in,.vx select.vx-in{height:auto;min-width:0;max-width:100%}
    .vx input.vx-in[type=date]{display:block;padding-right:8px}
    .vx input.vx-in[type=date]::-webkit-date-and-time-value{text-align:left}
    .vx input.vx-in[readonly]{color:#bff26a;background:#0e170f;cursor:pointer}
    .vx input.vx-in:focus,.vx select.vx-in:focus,.vx textarea.vx-in:focus{border-color:#d0f44c;box-shadow:0 0 0 3px rgba(208,244,76,.18);background:#162a17}
    .vx textarea.vx-in{min-height:56px;padding:9px 11px;resize:vertical}
    .vx-entrada input.vx-in{padding-right:44px}
    .vx-flecha{position:absolute;right:14px;top:50%;width:10px;height:10px;margin-top:-7px;border-right:2px solid #d0f44c;border-bottom:2px solid #d0f44c;transform:rotate(45deg);pointer-events:none;transition:transform .2s}
    .vx-busq.vx-abierto .vx-flecha{transform:rotate(-135deg);margin-top:-2px}
    .vx-busq{position:relative;z-index:1}
    .vx-busq.vx-abierto{z-index:60}
    .vx-lista{position:absolute;z-index:80;left:0;right:0;top:calc(100% + 6px);display:grid;max-height:min(340px,55vh);overflow-y:auto;padding:6px;border:1px solid #58704f;border-radius:14px;background:#0d170e;box-shadow:0 18px 40px rgba(0,0,0,.65);animation:vxAbrir .16s ease both;-webkit-overflow-scrolling:touch;scrollbar-color:#d0f44c33 transparent}
    @keyframes vxAbrir{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
    .vx-lista[hidden]{display:none}
    .vx-lista button.vx-op{appearance:none;-webkit-appearance:none;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;column-gap:12px;row-gap:2px;width:100%;min-height:50px;margin:0;padding:8px 10px;border:0;border-radius:9px;background:transparent;box-shadow:none;color:#edf8e7;font:inherit;text-align:left;cursor:pointer;transform:none;transition:background .12s}
    .vx-lista button.vx-op:hover,.vx-lista button.vx-op:focus-visible{background:rgba(208,244,76,.14);outline:none}
    .vx-lista button.vx-op+button.vx-op{border-top:1px solid rgba(255,255,255,.06)}
    .vx-op-t{grid-column:1;grid-row:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f1faea;font:800 14px/1.25 Arial}
    .vx-op-s{grid-column:1;grid-row:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9db28f;font:600 12px/1.25 Arial}
    .vx-op-d{grid-column:2;grid-row:1/3;justify-self:end;color:#d0f44c;font:900 13px Arial;white-space:nowrap;font-variant-numeric:tabular-nums}
    .vx-op-ref{display:inline-block;padding:2px 8px;border:1px solid #6f8f4f;border-radius:6px;background:#26391f;color:#eaffba;font:900 13px/1.3 Arial;letter-spacing:.03em}
    .vx-op-ref mark{padding:0 1px;border-radius:3px;background:#d0f44c;color:#132012}
    .vx-op-ya{margin-left:8px;color:#9be15d;font:800 11px Arial}
    .vx-lista button.vx-op.vx-op-crear{background:linear-gradient(135deg,#eaff85,#afe936);border-radius:10px}
    .vx-lista button.vx-op.vx-op-crear:hover,.vx-lista button.vx-op.vx-op-crear:focus-visible{background:linear-gradient(135deg,#f2ffa8,#c3f04f)}
    .vx-op-crear .vx-op-t{color:#132012;font-weight:900;letter-spacing:.06em}
    .vx-op-crear .vx-op-s{color:#33461f}
    .vx-lista button.vx-op.vx-op-nuevo{background:rgba(208,244,76,.12);box-shadow:inset 3px 0 0 #d0f44c}
    .vx-op-nuevo .vx-op-s{color:#c6f59a;font-weight:800}
    .vx-lista button.vx-op.vx-op-agregado{background:rgba(208,244,76,.08);box-shadow:inset 3px 0 0 #d0f44c}
    .vx-vacio-l{margin:0;padding:14px 12px;color:#a8b8a0;font:600 13px Arial;text-align:center}
    .vx-estado{display:block;color:#a8bf91;font:700 11px Arial}
    .vx-estado.vx-err{color:#ffbd8c}
    .vx-cat{display:flex;align-items:center;gap:10px;min-height:38px;margin-bottom:14px;padding:6px 10px 6px 14px;border:1px solid rgba(208,244,76,.25);border-radius:14px;background:rgba(208,244,76,.07);font:700 11px Arial}
    .vx-cat-dot{width:8px;height:8px;border-radius:50%;background:#7fa35a;flex:0 0 auto}
    .vx-cat.vx-sync .vx-cat-dot{background:#d0f44c;animation:vxPulso 1s infinite}
    @keyframes vxPulso{50%{opacity:.25}}
    .vx-cat-t{color:#d0f44c;letter-spacing:.1em;white-space:nowrap}
    .vx-cat-e{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e9f8e2;font-size:12px}
    .vx-cat-b{display:inline-flex;align-items:center;justify-content:center;min-height:32px;margin:0;padding:0 12px;border:1px solid rgba(208,244,76,.4);border-radius:9px;background:rgba(208,244,76,.12);color:#eaffba;font:800 11px/1 Arial;cursor:pointer;white-space:nowrap}
    .vx-artzona{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,.7fr);gap:14px;align-items:start}
    .vx-stock{display:flex;flex-direction:column;justify-content:center;gap:5px;min-height:70px;padding:12px 16px;border:1px solid #9bd13f66;border-radius:14px;background:linear-gradient(120deg,#22361c,#132315);color:#eaf6df;transition:background .25s,border-color .25s}
    .vx-stock small{color:#c9e394;font:800 10px Arial;letter-spacing:.08em}
    .vx-stock b{color:#d0f44c;font:900 18px Arial}
    .vx-stock span{color:#b9c9b4;font:600 12px Arial}
    .vx-stock.vx-stock-vacio{background:#101811;border-color:#40503f}
    .vx-stock.vx-stock-vacio b{color:#d5dfd1;font-size:14px}
    .vx-telas{display:flex;flex-wrap:wrap;gap:6px}
    .vx-telas i{padding:4px 8px;border-radius:7px;background:rgba(255,255,255,.08);color:#dcebd7;font:700 11px Arial;font-style:normal}
    .vx-ret-fila{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}.vx-ret-fila .vx-in{flex:1 1 320px;min-width:0}.vx-ret-fila .vx-btn{flex:0 0 auto}
    .vx-ayuda{margin:10px 0 0;color:#8fa08a;font:600 12px/1.45 Arial}
    .vx-cab-conc{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) 34px;gap:8px;margin-top:14px;padding:0 14px;color:#9fb097;font:900 10px Arial;letter-spacing:.08em;text-transform:uppercase}
    .vx-fila{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) 34px;gap:8px;align-items:end;margin-top:6px;padding:9px 10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.03);animation:vxEntrar .3s ease both}
    .vx-fila.vx-nueva{border-color:#d0f44c99;box-shadow:0 0 0 3px rgba(208,244,76,.12)}
    /* Cada artículo agregado se distingue del resto del formulario. */
    .vx-fila{position:relative;border-color:#4f6a3f;background:linear-gradient(110deg,rgba(208,244,76,.09),rgba(19,32,20,.92) 45%);box-shadow:inset 4px 0 0 #d0f44c}
    .vx-fila:focus-within{border-color:#d0f44c;box-shadow:inset 4px 0 0 #d0f44c,0 0 0 3px rgba(208,244,76,.16)}
    .vx-ref{display:inline-block;max-width:100%;padding:3px 9px;border-radius:7px;background:#d0f44c;color:#132012;font:900 13px/1.2 Arial;letter-spacing:.03em;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
    .vx-fila-art{min-width:0}
    .vx-fila-art>b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#edf6e8;font:800 14px Arial}
    .vx-fila-art>small{display:block;margin:3px 0 7px;color:#96a891;font:600 12px Arial}
    .vx-sf-caja{margin:-3px 0 6px;min-width:0}
    .vx-sf{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fbf8a;font:600 11px/1.3 Arial}
    .vx-sf b{display:inline;color:#c6f59a;font:800 11px/1.3 Arial}
    .vx-sf-vacio,.vx-sf-vacio b{color:#ffd27a}
    .vx-sf-cargando{color:#8fa08a}
    .vx-sf-sin{color:#ff9d9d;font-weight:800}
    .vx-pt{display:block;margin-top:6px;font:700 11px/1.3 Arial}.vx-pt-b{width:auto;padding:6px 12px;border:1px solid #d0f44c;border-radius:999px;background:rgba(208,244,76,.12);color:#d0f44c;cursor:pointer}.vx-pt-ok{color:#8fe28f}.vx-pt-info{color:#c9e394}.vx-pt-err{color:#ff9d9d;white-space:normal}
    .vx .vx-pdf{display:inline-flex;align-items:center;justify-content:center;min-height:30px;margin:0;padding:0 12px;border:1px solid rgba(208,244,76,.45);border-radius:9px;background:rgba(208,244,76,.12);color:#eaffba;font:800 11px/1 Arial;cursor:pointer;transition:background .15s}
    .vx .vx-pdf:hover{background:rgba(208,244,76,.25)}
    .vx-acc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:2px 0 4px}
    .vx .vx-acc-b{display:inline-flex;align-items:center;justify-content:center;min-height:34px;margin:0;padding:0 8px;border:1px solid;border-radius:9px;background:transparent;font:900 11px/1.1 Arial;letter-spacing:.04em;text-align:center;cursor:pointer;transition:background .15s}
    .vx .vx-acc-anular{border-color:#ff7d7d99;color:#ffb0b0}.vx .vx-acc-anular:hover{background:rgba(255,80,80,.15)}
    .vx .vx-acc-modificar{border-color:#f2b84b99;color:#ffd27a}.vx .vx-acc-modificar:hover{background:rgba(242,184,75,.15)}
    .vx .vx-acc-produccion{border-color:#79d66f99;color:#c6f59a}.vx .vx-acc-produccion:hover{background:rgba(121,214,111,.15)}
    .vx .vx-acc{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px}
    .vx .vx-acc .vx-acc-b{width:auto!important;min-height:30px;font-size:9.5px;padding:0 4px;letter-spacing:.02em;white-space:normal;line-height:1.15}
    .vx .vx-pdf{width:auto!important;min-height:28px}
    .vx-tj-mas{margin-top:2px}
    .vx-tj-mas summary{color:#d0f44c;font:800 10px Arial;letter-spacing:.04em;cursor:pointer;list-style:none;padding:4px 0}
    .vx-tj-mas summary::-webkit-details-marker{display:none}
    .vx-tj-mas summary::before{content:'+ '}
    .vx-tj-mas[open] summary::before{content:'− '}
    .vx-tj-mas .vx-tj-todo{margin-top:6px}
    /* Diseño de tarjetas: sobrio, con jerarquía clara. Va al final para tener prioridad sobre las reglas anteriores. */
    .vx-tarjetas{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px;align-items:stretch}
    .vx .vx-tj{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #243329;border-left:3px solid var(--tono,#3d5244);border-radius:14px;background:#111b15;box-shadow:0 10px 24px rgba(0,0,0,.22);transform:none;animation:vxEntrar .3s ease both;animation-delay:calc(var(--i,0) * 30ms)}
    .vx .vx-tj:hover{border-color:#34483a;border-left-color:var(--tono,#3d5244);box-shadow:0 14px 30px rgba(0,0,0,.32);transform:translateY(-1px)}
    .vx .vx-tj::before{display:none}
    .vx-tj-ambar{--tono:#d9a441}.vx-tj-verde{--tono:#7fcf8e}.vx-tj-rojo{--tono:#e2665e}
    .vx .vx-tj-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .vx .vx-tj-id{display:flex;align-items:baseline;gap:8px;min-width:0}
    .vx .vx-tj-num{font:800 15px/1.2 Arial;color:#f1f7ee;letter-spacing:.02em}
    .vx .vx-tj-tipo{font:700 9.5px/1 Arial;letter-spacing:.09em;text-transform:uppercase;color:#7d9182}
    .vx .vx-badge{padding:3px 9px;border:0;border-radius:999px;font:700 10px/1.3 Arial;letter-spacing:.02em;white-space:nowrap}
    .vx .vx-b-ambar{background:rgba(217,164,65,.14);color:#f1c76f}
    .vx .vx-b-verde{background:rgba(127,207,142,.14);color:#a6e2b4}
    .vx .vx-b-rojo{background:rgba(226,102,94,.15);color:#ff9d96}
    .vx .vx-tj-cli{margin:0;font:700 15px/1.3 Arial;color:#eef6e9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-pro{margin:-6px 0 0;font:500 12px/1.3 Arial;color:#8aa08f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-prog{display:flex;align-items:center;gap:8px}
    .vx .vx-tj-barra{flex:1;height:4px;border-radius:4px;background:#22302a;overflow:hidden}
    .vx .vx-tj-barra>span{display:block;height:100%;border-radius:inherit;background:#8fd16e}
    .vx .vx-tj-prog small{font:600 10px Arial;color:#8aa08f;min-width:28px;text-align:right}
    .vx .vx-tj-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .vx .vx-tj-celda{display:grid;gap:3px;min-width:0;padding:8px 10px;border:1px solid #213028;border-radius:9px;background:#16211b}
    .vx .vx-tj-celda span{font:700 9px/1.2 Arial;letter-spacing:.08em;text-transform:uppercase;color:#7d9182}
    .vx .vx-tj-celda b{font:700 13px/1.3 Arial;color:#eef6e9;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-grid .vx-tj-celda:first-child b{font-size:15px;color:#d6ef9a}
    .vx .vx-tj-plazo{font:600 10px Arial;font-style:normal;margin-left:4px;color:#8aa08f}
    .vx .vx-tj-plazo.vx-tarde{color:#ff9d96}.vx .vx-tj-plazo.vx-hoy{color:#f1c76f}
    .vx .vx-tj-info{margin:0;font:500 11px/1.4 Arial;color:#7d9182;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-pie{display:grid;gap:6px;margin-top:auto;padding-top:10px;border-top:1px solid #213028}
    .vx .vx-acc{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px}
    .vx .vx-acc .vx-acc-b{width:auto!important;min-height:30px;margin:0;padding:0 6px;border:1px solid #2a3a30;border-radius:8px;background:#16211b;color:#cfe0c8;font:700 10px/1.15 Arial;letter-spacing:.02em;white-space:normal;text-align:center}
    .vx .vx-acc .vx-acc-b:hover{background:#1d2b23}
    .vx .vx-acc-anular:hover{color:#ff9d96;border-color:#6b3a37}
    .vx .vx-acc-modificar:hover{color:#f1c76f;border-color:#5f4f2a}
    .vx .vx-acc-produccion{background:#d6ef9a!important;border-color:#d6ef9a!important;color:#132012!important}
    .vx .vx-acc-produccion:hover{background:#e3f7b0!important}
    .vx .vx-pdf{width:100%!important;min-height:30px;margin:0;border:1px dashed #3a4f40;border-radius:8px;background:transparent;color:#a9c3ad;font:700 11px/1 Arial;letter-spacing:.02em}
    .vx .vx-pdf:hover{border-style:solid;color:#e4f2d6;background:#16211b}
    .vx .vx-tj-mas{margin:0}
    .vx .vx-tj-mas summary{font:700 11px Arial;color:#8aa08f;cursor:pointer;list-style:none;padding:2px 0}
    .vx .vx-tj-mas summary::-webkit-details-marker{display:none}
    .vx .vx-tj-mas summary::before{content:'+ ';color:#d6ef9a}
    .vx .vx-tj-mas[open] summary::before{content:'− '}
    .vx .vx-tj-todo{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin:6px 0 0;padding:8px;border-radius:9px;background:#0d1511}
    .vx .vx-tj-todo dt{font:700 9px Arial;letter-spacing:.06em;text-transform:uppercase;color:#7d9182}
    .vx .vx-tj-todo dd{margin:2px 0 0;font:600 11px/1.35 Arial;color:#cfdcc9;overflow-wrap:anywhere}

    /* Tarjetas más compactas. */
    .vx-tarjetas{gap:10px}
    .vx .vx-tj{gap:7px;padding:12px}
    .vx .vx-tj-top{gap:6px}
    .vx .vx-tj-num{font-size:14px}
    .vx .vx-tj-cli{font-size:14px}
    .vx .vx-tj-pro{margin-top:-4px;font-size:11.5px}
    .vx .vx-tj-grid{gap:5px}
    .vx .vx-tj-celda{padding:6px 8px;gap:2px}
    .vx .vx-tj-celda b{font-size:12.5px}
    .vx .vx-tj-grid .vx-tj-celda:first-child b{font-size:14px}
    .vx .vx-tj-info{font-size:10.5px}
    .vx .vx-tj-pie{gap:5px;padding-top:7px}
    .vx .vx-acc{gap:5px}
    .vx .vx-acc .vx-acc-b{min-height:26px;font-size:9.5px}
    .vx .vx-pdf{min-height:26px}
    .vx .vx-tj-mas summary{font-size:10.5px}
    .vx .vx-tj-num{font-size:17px;letter-spacing:.03em}
    .vx .vx-tj-top{justify-content:flex-start;gap:10px}
    .vx .vx-tj-top .vx-tj-cli{flex:1;min-width:0;margin:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-top .vx-tj-num{flex:0 0 auto;font-size:14px;color:#d6ef9a}
    /* Tarjeta con toda la información visible. */
    .vx .vx-tj{gap:10px;padding:14px}
    .vx .vx-tj-top{min-width:0;align-items:baseline;gap:10px}
    .vx .vx-tj-top .vx-tj-cli{font-size:14px}
    .vx .vx-tj-top .vx-tj-num{font-size:14px}
    .vx .vx-tj-pro{margin:-4px 0 0;font:500 12px/1.3 Arial;color:#8aa08f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vx .vx-tj-total{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:10px;background:#16211b;border:1px solid #213028}
    .vx .vx-tj-total small{font:700 9px Arial;letter-spacing:.08em;text-transform:uppercase;color:#7d9182}
    .vx .vx-tj-total b{font:800 18px Arial;color:#d6ef9a;font-variant-numeric:tabular-nums}
    .vx .vx-tj-total em{margin-left:auto;font:700 10px Arial;font-style:normal;color:#8aa08f}
    .vx .vx-tj-fichas{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin:0}
    .vx .vx-tj-ficha{min-width:0}
    .vx .vx-tj-ancho{grid-column:1/-1}
    .vx .vx-tj-ficha dt{font:700 9px Arial;letter-spacing:.06em;text-transform:uppercase;color:#7d9182}
    .vx .vx-tj-ficha dd{margin:2px 0 0;font:600 12px/1.3 Arial;color:#e3eedd;overflow-wrap:anywhere}
    .vx .vx-tj-tots{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:6px}
    .vx .vx-tj-tot{padding:6px 8px;border-radius:8px;background:#0d1511;border:1px solid #213028;min-width:0}
    .vx .vx-tj-tot small{display:block;font:700 9px Arial;letter-spacing:.06em;text-transform:uppercase;color:#7d9182;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .vx .vx-tj-tot span{font:700 12px Arial;color:#cfdcc9;font-variant-numeric:tabular-nums}
    /* Movimiento de la tarjeta: se levanta al pasar el cursor y responde al pulsar. */
    .vx .vx-tj{transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease}
    .vx .vx-tj:hover{transform:translateY(-3px);box-shadow:0 18px 36px rgba(0,0,0,.42),0 0 0 1px rgba(214,239,154,.07)}
    .vx .vx-tj:hover .vx-tj-total{border-color:#3a5442}
    .vx .vx-tj:hover .vx-tj-total b{color:#e6f8b4}
    .vx .vx-tj-tot,.vx .vx-tj-ficha{transition:background .2s ease,transform .2s ease}
    .vx .vx-tj-tot:hover{background:#18251d;transform:translateY(-1px)}
    .vx .vx-tj-ficha:hover dd{color:#ffffff}
    .vx .vx-tj-total b{transition:color .2s ease}
    .vx .vx-acc-b,.vx .vx-pdf{transition:transform .12s ease,background .18s ease,color .18s ease}
    .vx .vx-acc-b:active,.vx .vx-pdf:active{transform:scale(.96)}
    .vx .vx-tj-ancho dd{color:#d6ef9a}
    /* Tarjeta con solo lo necesario. */
    .vx .vx-tj{gap:9px;padding:13px}
    .vx .vx-tj-fichas{grid-template-columns:1fr 1fr;gap:8px 12px}
    .vx .vx-tj-ficha{min-width:0}
    .vx .vx-tj-ficha dd{margin:2px 0 0;font:600 12.5px/1.3 Arial;color:#e3eedd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* Cliente y orden como texto normal, no como títulos. */
    .vx .vx-tj-top{align-items:center;gap:8px}
    .vx .vx-tj-top .vx-tj-cli{margin:0;font:600 12.5px/1.3 Arial;letter-spacing:0;color:#c9d9c4;text-transform:none}
    .vx .vx-tj-top .vx-tj-num{font:700 11.5px/1.3 Arial;letter-spacing:.04em;color:#8aa08f;flex:0 0 auto}
    .vx .vx-tj-top .vx-tj-num::before{content:'· ';color:#4f6453}



    .vx-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:16px;background:rgba(4,8,5,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
    .vx-modal-c{width:min(420px,100%);padding:20px;border-radius:18px;border:1px solid rgba(208,244,76,.4);background:linear-gradient(160deg,rgba(26,40,31,.97),rgba(12,20,15,.97));color:#eef6e9;box-shadow:0 24px 60px -10px #000;font-family:Arial,sans-serif}
    .vx-modal-c h4{margin:0 0 8px;font:900 15px Arial;color:#d0f44c}.vx-modal-c p{margin:0 0 16px;font:500 13px/1.45 Arial;color:#cfe0c8}
    .vx-modal-b{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .vx-btn-peligro{background:#e2665e!important;border-color:#e2665e!important;color:#fff!important}
    /* Tarjeta de vidrio con aro de estado, como las de Producción. */
    .vx .vx-tj{--r:#d9a441;position:relative;gap:12px;padding:15px 15px 13px;border:1px solid rgba(255,255,255,.1);border-left:1px solid rgba(255,255,255,.1);border-radius:18px;
      background:radial-gradient(120% 80% at 8% 0%,rgba(255,255,255,.1),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(26,40,31,.88),rgba(13,21,16,.9));
      -webkit-backdrop-filter:blur(18px) saturate(1.3);backdrop-filter:blur(18px) saturate(1.3);
      box-shadow:inset 0 1.5px 0 rgba(255,255,255,.14),0 0 0 1px color-mix(in srgb,var(--r) 45%,transparent),0 14px 30px -16px #000}
    .vx .vx-tj-ambar{--r:#ff9a1f}.vx .vx-tj-verde{--r:#35d46a}.vx .vx-tj-rojo{--r:#ff4b3e}
    .vx .vx-tj:hover{border-color:rgba(255,255,255,.18);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.2),0 0 0 1px var(--r),0 0 28px -8px var(--r),0 20px 38px -16px #000}
    .vx .vx-tj-top{align-items:flex-start;gap:10px}
    .vx .vx-tj-top .vx-tj-cli{flex:1;min-width:0;font:800 14.5px/1.25 Arial;color:#f4faef;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .vx .vx-tj-top .vx-tj-num{padding:4px 10px;border-radius:999px;background:rgba(208,244,76,.14);border:1px solid rgba(208,244,76,.45);color:#d0f44c;font:900 12px/1.2 Arial;letter-spacing:.04em}
    .vx .vx-tj-top .vx-tj-num::before{content:none}
    .vx .vx-tj-pro{margin:-6px 0 0;color:#8fa58f;font:600 11.5px/1.3 Arial}
    .vx .vx-tj-fichas{gap:6px}
    .vx .vx-tj-ficha{padding:8px 10px;border:1px solid rgba(255,255,255,.07);border-radius:11px;background:rgba(255,255,255,.04)}
    .vx .vx-tj-ficha dt{font:800 8.5px/1.2 Arial;letter-spacing:.09em;text-transform:uppercase;color:#7f9585}
    .vx .vx-tj-ficha:nth-child(2) dd{font:900 15px/1.2 Arial;color:#d0f44c;font-variant-numeric:tabular-nums}
    .vx .vx-tj-pie{display:grid;gap:8px;padding-top:11px;border-top:1px solid rgba(255,255,255,.08)}
    .vx .vx-acc{grid-template-columns:1fr 1fr 1.5fr!important;gap:6px}
    .vx .vx-acc .vx-acc-b{min-height:34px;border-radius:10px;font:800 10.5px/1.15 Arial;letter-spacing:.03em;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12)}
    .vx .vx-acc .vx-acc-anular{color:#ffb0aa}.vx .vx-acc .vx-acc-modificar{color:#ffd27a}
    .vx .vx-acc .vx-acc-produccion{background:linear-gradient(180deg,#e2f79a,#c4e84a)!important;border-color:#d0f44c!important;color:#10200f!important;box-shadow:0 0 16px -4px rgba(208,244,76,.6)}
    .vx .vx-pdf{justify-self:start;padding:0;border:0;background:none;color:#9fb79a;font:800 10.5px Arial;letter-spacing:.05em;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
    .vx .vx-pdf:hover{color:#d0f44c}
    @media(max-width:640px){
      .vx .vx-tj{padding:14px}
      .vx-tarjetas{grid-template-columns:1fr}
    }

    .vx-fila.vx-fila-sin{border-color:#ff7d7d99;background:rgba(255,80,80,.09);box-shadow:inset 4px 0 0 #ff5a50}
    .vx-celda{display:grid;gap:4px;min-width:0}
    .vx-celda>span{color:#8fa08a;font:800 9px Arial;letter-spacing:.07em;text-transform:uppercase}
    .vx input.vx-in.vx-sm,.vx select.vx-in.vx-sm{min-height:34px;font-size:13px;padding:0 8px}
    .vx-fila-art input.vx-in{min-height:34px;font-size:13px;padding:0 10px}
    .vx-celda.vx-total b{display:flex;align-items:center;min-height:34px;color:#edffc1;font:900 14px Arial;font-variant-numeric:tabular-nums}
    .vx-quitar{display:inline-flex;align-items:center;justify-content:center;align-self:end;width:34px;height:34px;margin:0;padding:0;border:0;border-radius:9px;background:#4c2525;color:#ffd1d1;font:400 19px/1 Arial;cursor:pointer;transition:background .15s}
    .vx-quitar:hover{background:#6a2f2f}
    /* Ningún botón del módulo se mueve al pasar el cursor: el CSS global del panel no debe torcerlos. */
    .vx button,.vx button:hover,.vx button:focus,.vx button:active{transform:none}
    .vx .vx-btn:active{transform:scale(.98)}
    .vx-vacio{margin:10px 0 0;padding:18px;border:1px dashed rgba(255,255,255,.18);border-radius:14px;color:#9fb097;font:600 13px Arial;text-align:center}
    .vx-totales{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:16px}
    .vx-totales div{padding:12px 14px;border:1px solid rgba(208,244,76,.22);border-radius:14px;background:rgba(208,244,76,.06)}
    .vx-totales small{display:block;color:#9fb097;font:800 10px Arial;letter-spacing:.06em;text-transform:uppercase}
    .vx-totales b{display:block;margin-top:4px;color:#f5faef;font:900 17px Arial;font-variant-numeric:tabular-nums}
    .vx-totales .vx-neto{border-color:#d0f44c80;background:linear-gradient(105deg,rgba(208,244,76,.22),rgba(20,35,18,.8))}
    .vx-totales .vx-neto b{color:#d0f44c;font-size:21px}
    .vx-acciones{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:16px}
    .vx-btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;margin:0;padding:0 14px;border:0;border-radius:11px;font:900 12px/1 Arial;letter-spacing:.03em;cursor:pointer;transition:background .15s,opacity .15s,transform .1s}
    .vx .vx-btn:active{transform:scale(.98)}
    .vx-btn-sec{background:rgba(255,255,255,.12);color:#f0f7eb}
    .vx-btn-sec:hover{background:rgba(255,255,255,.2)}
    .vx-btn-main{background:#d0f44c;color:#152015}
    .vx-btn-main:disabled{opacity:.42;cursor:not-allowed;transform:none}
    .vx-rev{margin-top:14px;padding:16px;border:1px solid rgba(208,244,76,.5);border-radius:16px;background:rgba(208,244,76,.07);animation:vxEntrar .3s ease both}
    .vx-rev.vx-rev-err{border-color:#ff9d9d88;background:rgba(255,120,120,.07)}
    .vx-rev h4{margin:0 0 8px;color:#f5faef;font:900 15px Arial}
    .vx-rev ul{margin:6px 0 0;padding-left:18px;color:#dce8d6;font:600 13px/1.7 Arial}
    .vx-peligro{color:#ffcf80}
    .vx-msg{min-height:20px;margin:12px 0 0;font:700 13px/1.4 Arial}
    .vx-msg.vx-err{color:#ff9d9d}
    .vx-msg.vx-ok{color:#bff26a}
    .vx-cargando{display:grid;gap:8px;justify-items:center;align-content:center;min-height:200px;text-align:center}
    .vx-cargando b{color:#d0f44c}
    .vx-cargando span{color:#a8b8a0;font:600 13px Arial}
    .vx-cargando button{min-height:40px;padding:0 16px;border:1px solid rgba(208,244,76,.4);border-radius:10px;background:rgba(208,244,76,.12);color:#ecffc6;font:800 12px Arial;cursor:pointer}
    /* El panel da ancho completo a todos los botones: aquí cada botón vuelve a su tamaño. */
    .vx .vx-tab,.vx .vx-cat-b,.vx .vx-btn,.vx .vx-chip,.vx .vx-seg-b{width:auto;max-width:100%}
    .vx .vx-quitar{width:34px}
    .vx .vx-cab{width:100%;max-width:none;margin:0}
    .vx-seg{display:flex;gap:4px;width:max-content;max-width:100%;margin:0 0 14px;padding:4px;border:1px solid rgba(208,244,76,.3);border-radius:13px;background:#0c160d}
    .vx .vx-seg-b{display:inline-flex;align-items:center;justify-content:center;min-height:34px;margin:0;padding:0 16px;border:0;border-radius:10px;background:transparent;color:#c7d3c1;font:800 12px/1 Arial;letter-spacing:.03em;cursor:pointer;transition:background .18s,color .18s}
    .vx .vx-seg-b:hover{color:#efffc6}
    .vx .vx-seg-b.activa{background:linear-gradient(135deg,#eaff85,#afe936);color:#132012}
    [data-cuerpo]{animation:vxCambio .25s ease both}
    .vx-card.vx-cambio{animation:vxCambio .28s ease both}
    @keyframes vxCambio{from{opacity:.25;transform:translateY(4px)}to{opacity:1;transform:none}}
    .vx-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:4px 0 12px}
    .vx-kpi{position:relative;overflow:hidden;min-height:62px;padding:10px 12px;border:1px solid rgba(208,244,76,.22);border-radius:12px;background:rgba(208,244,76,.06)}
    .vx-kpi small{display:block;color:#9fb097;font:800 10px Arial;letter-spacing:.06em;text-transform:uppercase}
    .vx-kpi b{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f5faef;font:900 18px Arial;font-variant-numeric:tabular-nums}
    .vx-barra{display:flex;gap:8px;align-items:center}
    .vx-buscar{flex:1;min-width:0}
    .vx-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px}
    .vx-chip{display:inline-flex;align-items:center;min-height:30px;margin:0;padding:0 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:#0c160d;color:#c7d3c1;font:800 11px/1 Arial;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
    .vx-chip.activa{background:rgba(208,244,76,.16);border-color:#d0f44c;color:#efffc6}
    /* Tarjetas con la misma medida y estructura que las de producción (trace-ui.js). */
    .vx-tarjetas{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:12px;align-items:start}
    .vx-tj{position:relative;display:flex;flex-direction:column;gap:9px;min-width:0;padding:14px;border:1px solid #3a4a40;border-top:3px solid var(--tono,#40584a);border-radius:16px;background:#19231e;box-shadow:0 6px 22px rgba(0,0,0,.13);animation:vxEntrar .35s ease both;animation-delay:calc(var(--i,0) * 40ms);transition:border-color .18s,box-shadow .18s,transform .18s}
    .vx-tj:hover{box-shadow:0 14px 30px rgba(0,0,0,.35);transform:translateY(-2px)}
    .vx-tj-ambar{--tono:#f2b84b}.vx-tj-verde{--tono:#83dca4}.vx-tj-rojo{--tono:#ff6b62}
    .vx-tj-rojo .vx-tj-cli,.vx-tj-rojo .vx-tj-valores b{opacity:.75}
    .vx-tj-cab{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .vx-tj-num{margin:0;color:#f5faef;font:700 24px/1.2 Arial;letter-spacing:-.6px}
    .vx-badge{display:inline-flex;align-items:center;padding:6px 9px;border:1px solid;border-radius:6px;font:700 12px/1.3 Arial;white-space:nowrap}
    .vx-b-ambar{background:#4a3613;border-color:#f2b84b;color:#ffe2a6}.vx-b-verde{background:#1d4922;border-color:#79d66f;color:#d9ffd4}.vx-b-rojo{background:#7a1712;border-color:#ff5a50;color:#fff}
    .vx-tj-cli{margin:0;color:#eef6e9;font:800 18px/1.3 Arial;overflow-wrap:anywhere}
    .vx-tj-pro{margin:-6px 0 0;color:#a8bf91;font:700 14px/1.3 Arial;overflow-wrap:anywhere}
    .vx-tj-avance{display:flex;align-items:center;gap:10px}
    .vx-tj-barra{flex:1;height:10px;border:1px solid #425c48;border-radius:8px;background:#324638;overflow:hidden}
    .vx-tj-barra>span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#76c995,#d0ec93);transform-origin:left;animation:vxLlenar .7s ease both}
    .vx-tj-rojo .vx-tj-barra>span{background:#7a4b48}
    @keyframes vxLlenar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    .vx-tj-avance small{color:#d0ec93;font:700 13px Arial;white-space:nowrap}
    .vx-tj-valores{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px}
    .vx-tj-valores div{padding:10px 12px;border:1px solid #33463a;border-radius:10px;background:#1f2c25}
    .vx-tj-valores .vx-principal{border-color:#6f8f4f;background:linear-gradient(120deg,#2a3d22,#1f2c25)}
    .vx-tj-valores small{display:block;color:#92a899;font:800 10px Arial;letter-spacing:.06em;text-transform:uppercase}
    .vx-tj-valores b{display:block;margin-top:3px;color:#eef6e9;font:900 15px Arial;font-variant-numeric:tabular-nums;white-space:nowrap}
    .vx-tj-valores .vx-principal b{color:#d0ec93;font-size:17px}
    .vx-tj-valores .vx-saldo b{color:#ffd27a}
    .vx-tj-datos,.vx-tj-todo{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 14px;margin:0}
    .vx-tj-datos div,.vx-tj-todo div{min-width:0}
    .vx-tj-datos .vx-ancho{grid-column:1/-1}
    .vx-tj dt{color:#92a899;font:700 11px Arial;letter-spacing:.04em;text-transform:uppercase}
    .vx-tj dd{margin:3px 0 0;color:#e3eedd;font:700 14px/1.35 Arial;overflow-wrap:anywhere}
    .vx-tj dd em{font-style:normal;color:#a8bf91;font-size:12px}.vx-tj dd em.vx-tarde{color:#ff9d9d}.vx-tj dd em.vx-hoy{color:#ffd27a}
    .vx-tj-sub{margin:4px 0 0;padding-top:10px;border-top:1px solid #33463a;color:#d0ec93;font:800 11px Arial;letter-spacing:.08em;text-transform:uppercase}
    .vx-tj-todo dd{font-size:13px;color:#cfdcc9}
    .vx-tj-meta{display:flex;justify-content:space-between;gap:10px;color:#92a899;font:12px Arial}
    .vx-tj.vx-esqueleto{min-height:190px;background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:300% 100%;animation:vxBrillo 1.2s linear infinite}
    .vx-tj.vx-esqueleto::before{display:none}
    @keyframes vxBrillo{to{background-position:-150% 0}}
    .vx-mas{display:flex;justify-content:center;margin-top:12px}
    @media(min-width:901px){
      .vx{grid-template-rows:auto 1fr;margin-bottom:16px}
      .vx-card{min-height:0}
    }
    @media(max-width:1100px){
      .vx-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
      .vx-campos .vx-c2,.vx-campos .vx-c3,.vx-campos .vx-c4{grid-column:span 6}
      .vx-artzona{grid-template-columns:1fr}
      .vx-totales{grid-template-columns:repeat(3,minmax(0,1fr))}
    }
    @media(max-width:1000px){
      .vx-cab-conc{display:none}
      .vx-fila{grid-template-columns:repeat(2,minmax(0,1fr))}
      .vx-fila-art{grid-column:1/-1}
      .vx-quitar{grid-column:2;justify-self:end}
    }
    @media(max-width:640px){
      .vx{margin:10px 0 110px}
      .vx-card{padding:14px}
      .vx-cab{padding:12px 14px}
      .vx-tabs{width:100%}
      .vx-tab{flex:1 1 40%;min-width:0;padding:0 10px;white-space:normal}
      .vx-seg{width:100%}
      .vx .vx-seg-b{flex:1 1 0;min-width:0;padding:0 8px;font-size:11px;white-space:normal;text-align:center;line-height:1.2}
      .vx-campos .vx-c2,.vx-campos .vx-c3,.vx-campos .vx-c4{grid-column:span 6}
      .vx-campos .vx-c6{grid-column:1/-1}
      .vx-totales{grid-template-columns:repeat(2,minmax(0,1fr))}
      .vx-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
      .vx-tarjetas{gap:12px}
      .vx-tj{gap:8px;padding:12px 13px}
      .vx-tj-num{font-size:19px}
      .vx-badge{padding:4px 7px;font-size:11px}
      .vx-tj-cli{font-size:15px}
      .vx-tj-pro{margin-top:-4px;font-size:12px}
      .vx-tj-barra{height:7px}
      .vx-tj-avance small{font-size:11px}
      .vx-tj-valores,.vx-tj-datos,.vx-tj-todo{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px}
      .vx-tj-valores .vx-principal{grid-column:1/-1}
      .vx-tj-valores div{padding:7px 9px;border-radius:9px}
      .vx-tj-valores small{font-size:9px}
      .vx-tj-valores b{font-size:13px}
      .vx-tj-valores .vx-principal b{font-size:16px}
      .vx-tj dt{font-size:9px}
      .vx-tj dd{margin-top:1px;font-size:12px}
      .vx-tj-todo dd{font-size:11px}
      .vx-tj-sub{margin-top:2px;padding-top:7px;font-size:10px}
      .vx-tj-meta{font-size:11px}
      .vx-acciones .vx-btn{flex:1 1 100%}
      .vx-lista{max-height:min(260px,40vh)}
      /* 16 px evita que Safari del iPhone haga zoom al escribir y descuadre la página. */
      .vx input.vx-in,.vx select.vx-in,.vx textarea.vx-in,.vx input.vx-in.vx-sm,.vx select.vx-in.vx-sm,.vx-fila-art input.vx-in{font-size:16px}
      .vx-busq{scroll-margin-top:84px}
    }
    /* En pantallas táctiles Safari hace zoom si un campo tiene menos de 16 px: se fija en 16 px siempre. */
    @media(pointer:coarse){
      .vx input,.vx select,.vx textarea{font-size:16px!important}
    }
    @media(prefers-reduced-motion:reduce){.vx *,.vx *::before,.vx *::after{animation:none!important;transition:none!important}}
  `;
  const estilo = document.createElement('style');
  estilo.id = 'vx-estilos';
  estilo.textContent = css;
  document.head.appendChild(estilo);

  // ---------- Utilidades ----------
  const api = async (ruta, opt = {}) => {
    const r = await fetch('/api/ventas-effi' + ruta, { credentials: 'same-origin', ...opt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'No se pudo consultar Effi');
    return j;
  };
  const $ = s => panel.querySelector(s);
  const valor = nombre => $(`[data-valor="${nombre}"]`)?.value || '';
  const textoDe = nombre => $(`[data-buscador="${nombre}"] [data-texto]`)?.value.trim() || '';
  const decir = (texto, tipo = '') => { const m = panel.querySelector('[data-cuerpo]:not([hidden]) [data-msg]') || $('[data-msg]'); if (m) { m.textContent = texto || ''; m.className = 'vx-msg' + (tipo ? ' vx-' + tipo : ''); } };
  const nombreDoc = () => DOCS.find(x => x[0] === actual)[2];

  function invalidar() {
    if (!panel) return;
    const crear = $('[data-crear]'), revision = $('[data-review]');
    if (crear) crear.disabled = true;
    if (revision) revision.innerHTML = '';
  }

  // ---------- Desplegables ----------
  function cerrarListas(excepto) {
    panel?.querySelectorAll('.vx-busq.vx-abierto').forEach(c => {
      if (c === excepto) return;
      c.classList.remove('vx-abierto');
      const lista = c.querySelector('.vx-lista');
      if (lista) lista.hidden = true;
      c._alCerrar?.();
    });
  }

  // En celular el teclado y el menú inferior tapan la lista: se sube el campo antes de abrirla.
  const esCelular = () => window.matchMedia('(max-width: 640px)').matches;

  function mostrar(campo, items, vacio = 'Sin coincidencias') {
    cerrarListas(campo);
    campo._items = items;
    const lista = campo.querySelector('.vx-lista');
    lista.innerHTML = items.length
      ? items.map((x, i) => `<button type="button" class="vx-op${x.clase ? ' ' + x.clase : ''}" data-i="${i}">${x.html ?? opcion(x.nombre)}</button>`).join('')
      : `<p class="vx-vacio-l">${esc(vacio)}</p>`;
    const yaAbierta = campo.classList.contains('vx-abierto');
    lista.hidden = false;
    lista.scrollTop = 0;
    campo.classList.add('vx-abierto');
    if (!yaAbierta && esCelular()) campo.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function teclas(campo) {
    return e => {
      if (e.key === 'Escape') return cerrarListas();
      if (e.key === 'Enter' && campo.classList.contains('vx-abierto') && campo._items?.length) {
        e.preventDefault();
        const item = campo._items.find(x => !x.crear) || campo._items[0]; // Enter elige un proyecto existente antes que CREAR
        cerrarListas();
        campo._elegir?.(item);
      }
    };
  }

  // La lista no se cierra al perder el foco (en iPhone eso pasa al ocultar el teclado):
  // se elige con un toque o clic y se cierra al tocar fuera del campo.
  document.addEventListener('mousedown', e => {
    if (e.target.closest('.vx-busq .vx-lista [data-i]')) e.preventDefault(); // en computador el campo conserva el foco
  });
  document.addEventListener('click', e => {
    const opcionEl = e.target.closest('.vx-busq .vx-lista [data-i]');
    if (!opcionEl) return;
    const campo = opcionEl.closest('.vx-busq');
    const item = campo._items?.[Number(opcionEl.dataset.i)];
    cerrarListas();
    if (item) campo._elegir?.(item);
  });
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.vx-busq')) cerrarListas();
  });

  // Lista fija (sucursal, bodega, forma de pago…): filtra mientras escribes y guarda el id elegido.
  function activarLista(campo, items) {
    const texto = campo.querySelector('[data-texto]');
    const oculto = campo.querySelector('[data-valor]');
    const sugerir = q => items.filter(x => plano(x.nombre).includes(plano(q))).slice(0, 80).map(x => ({ ...x, html: opcion(x.nombre) }));
    campo._elegir = item => { oculto.value = item.id; texto.value = item.nombre; invalidar(); };
    campo._alCerrar = () => { if (!oculto.value) texto.value = ''; }; // sin elegir, no queda texto suelto
    texto.addEventListener('focus', () => mostrar(campo, sugerir(''), 'Sin opciones'));
    texto.addEventListener('click', () => { if (!campo.classList.contains('vx-abierto')) mostrar(campo, sugerir(''), 'Sin opciones'); });
    texto.addEventListener('input', () => { oculto.value = ''; mostrar(campo, sugerir(texto.value), 'Sin coincidencias'); invalidar(); });
    texto.addEventListener('keydown', teclas(campo));
  }

  // Búsqueda contra Effi: espera a que el usuario pare de escribir y descarta respuestas viejas.
  function buscarRemoto(campo, buscar, { minimo = 2, espera = 200, vacio = 'Sin coincidencias', alEscribir } = {}) {
    const texto = campo.querySelector('[data-texto]');
    let turno = 0, reloj = 0;
    texto.addEventListener('input', () => {
      clearTimeout(reloj);
      const t = ++turno, q = texto.value.trim();
      alEscribir?.(q);
      if (q.length < minimo) return cerrarListas();
      mostrar(campo, [], 'Buscando en Effi…');
      reloj = setTimeout(async () => {
        try {
          const items = await buscar(q);
          if (t === turno) mostrar(campo, items, vacio);
        } catch (e) {
          if (t === turno) mostrar(campo, [], e.message);
        }
      }, espera);
    });
    texto.addEventListener('keydown', teclas(campo));
  }

  // ---------- Catálogo ----------
  async function pintarCatalogo(sincronizar = false) {
    const barra = $('[data-catalogo]');
    if (!barra) return null;
    const estado = barra.querySelector('[data-catalogo-estado]');
    try {
      if (sincronizar) await api('/catalogo/sincronizar', { method: 'POST' });
      const d = await api('/catalogo');
      estado.textContent = d.ejecutando
        ? `${d.estado} · ${d.clientes} clientes · ${d.articulos} artículos`
        : d.actualizado ? `Actualizado · ${d.clientes} clientes · ${d.articulos} artículos` : (d.error || d.estado || 'Catálogo sin datos');
      barra.classList.toggle('vx-sync', !!d.ejecutando);
      return d;
    } catch (e) {
      estado.textContent = 'Catálogo disponible mediante búsqueda en Effi';
      return null;
    }
  }

  function vigilarCatalogo(demora = 3000) {
    clearTimeout(catalogoTimer);
    catalogoTimer = setTimeout(async () => {
      if (!panel?.isConnected) return;
      if (!panel.classList.contains('active')) return vigilarCatalogo(15000);
      const d = await pintarCatalogo(false);
      vigilarCatalogo(d?.ejecutando ? 3000 : 20000);
    }, demora);
  }

  function estadoProyecto(texto, error = false) {
    const e = $('[data-proyecto-estado]');
    if (!e) return;
    e.textContent = texto;
    e.classList.toggle('vx-err', error);
  }

  let consultandoProyectos = false, recienCreado = '';
  async function cargarProyectos(nombre) {
    const t = ++versiones.proyecto;
    recienCreado = ''; // otro cliente: la marca de «recién creado» no aplica
    proyectos = [];
    puedeCrearProyecto = false;
    consultandoProyectos = true;
    estadoProyecto('Consultando MAESTROS…');
    try {
      const d = await api('/proyectos?cliente=' + encodeURIComponent(nombre));
      if (t !== versiones.proyecto) return;
      proyectos = d.proyectos || [];
      puedeCrearProyecto = !!d.puede_crear;
      estadoProyecto(proyectos.length ? `${proyectos.length} proyecto(s) en MAESTROS` : (d.estado || 'Sin proyectos'), !puedeCrearProyecto && !proyectos.length);
    } catch (e) {
      if (t === versiones.proyecto) estadoProyecto('No se pudieron leer los proyectos', true);
    } finally {
      if (t === versiones.proyecto) {
        consultandoProyectos = false;
        // Si la lista ya estaba abierta, se actualiza con lo que llegó de MAESTROS.
        const campo = $('[data-buscador="proyecto"]');
        if (campo?.classList.contains('vx-abierto')) sugerirProyectos(campo.querySelector('[data-texto]').value);
      }
    }
  }

  // ---------- Cliente, dirección y proyecto ----------
  function elegirDireccion(d) {
    const campo = $('[data-direccion]');
    campo.value = d?.direccion || 'Sin dirección principal en Effi';
    campo.dataset.pais = d?.id_pais || '';
    campo.dataset.provincia = d?.id_provincia || '';
    campo.dataset.ciudad = d?.id_ciudad || '';
    invalidar();
  }

  function elegirCliente(x) {
    cliente = x;
    direcciones = x.direcciones || [];
    $('[data-buscador="cliente"] [data-texto]').value = x.nombre;
    $('[data-cliente-ok]').textContent = `✓ Código Effi ${x.tercero}`;
    $('[data-buscador="proyecto"] [data-texto]').value = '';
    elegirDireccion(direcciones[0] || { direccion: x.direccion, id_pais: x.id_pais, id_provincia: x.id_provincia, id_ciudad: x.id_ciudad });
    cargarProyectos(x.nombre);
    decir('');
    invalidar();
  }

  function limpiarCliente() {
    cliente = null;
    direcciones = [];
    proyectos = [];
    puedeCrearProyecto = false;
    const dir = $('[data-direccion]');
    dir.value = '';
    dir.dataset.pais = dir.dataset.provincia = dir.dataset.ciudad = '';
    $('[data-buscador="proyecto"] [data-texto]').value = '';
    $('[data-cliente-ok]').textContent = '';
    estadoProyecto('Selecciona un cliente');
    invalidar();
  }

  function sugerirProyectos(q) {
    const campo = $('[data-buscador="proyecto"]');
    const filtro = plano(q);
    // El proyecto recién creado va primero y marcado, para verlo de inmediato.
    const nuevoPrimero = (a, b) => (plano(b) === plano(recienCreado)) - (plano(a) === plano(recienCreado));
    const lista = proyectos
      .filter(p => plano(p).includes(filtro))
      .sort(nuevoPrimero)
      .slice(0, 40)
      .map(p => plano(p) === plano(recienCreado)
        ? { nombre: p, clase: 'vx-op-nuevo', html: opcion(p, '✓ Recién creado en MAESTROS') }
        : { nombre: p, html: opcion(p, 'Proyecto de MAESTROS') });
    const exacto = proyectos.some(p => plano(p) === filtro);
    // Botón CREAR siempre arriba de la lista: usa el nombre escrito o lo pide.
    if (cliente && !consultandoProyectos) {
      const nuevo = q.trim() && !exacto ? q.trim() : '';
      lista.unshift({
        nombre: nuevo, crear: true, clase: 'vx-op-crear',
        html: `<span class="vx-op-t">+ CREAR</span><span class="vx-op-s">${nuevo ? `Nueva carpeta «${esc(nuevo)}» en MAESTROS · te pide confirmar el nombre` : 'Nueva carpeta de proyecto en MAESTROS · te pide el nombre'}</span>`,
      });
    }
    const vacio = !cliente ? 'Selecciona primero un cliente'
      : consultandoProyectos ? 'Consultando MAESTROS…'
      : (puedeCrearProyecto ? 'Sin proyectos que coincidan' : 'Este cliente no tiene MAESTROS para proyectos');
    mostrar(campo, lista, vacio);
  }

  function setProyecto(nombre) {
    $('[data-buscador="proyecto"] [data-texto]').value = nombre;
    invalidar();
  }

  // Desde el botón CREAR: siempre pregunta el nombre de la carpeta (prellenado con lo escrito);
  // aceptar ese cuadro ya cuenta como confirmación.
  function crearDesdeLista(nombre) {
    if (!cliente) return decir('Selecciona primero un cliente.', 'err');
    if (!puedeCrearProyecto) return decir('Este cliente no tiene carpeta MAESTROS en la NAS; no se puede crear el proyecto.', 'err');
    const pedido = (prompt(`Nombre de la carpeta del nuevo proyecto en MAESTROS de ${cliente.nombre}:`, nombre || '') || '').trim();
    if (pedido) crearProyecto(pedido, true);
  }

  async function crearProyecto(nombre, yaConfirmado = false) {
    if (!cliente) return decir('Selecciona primero un cliente.', 'err');
    if (!yaConfirmado && !confirm(`¿Crear la carpeta «${nombre}» dentro de MAESTROS de ${cliente.nombre}?`)) return;
    try {
      const d = await api('/proyectos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: cliente.nombre, proyecto: nombre }) });
      const final = d.proyecto || nombre;
      proyectos = d.proyectos || proyectos;
      // La NAS devuelve como mucho 150 carpetas: el nuevo proyecto se agrega aunque no venga en esa lista.
      if (!proyectos.some(p => plano(p) === plano(final))) proyectos = [final, ...proyectos];
      recienCreado = final;
      setProyecto(''); // no se elige solo: queda en la lista para que lo selecciones
      estadoProyecto(d.creado ? 'Proyecto creado en MAESTROS' : 'El proyecto ya existía');
      decir(d.creado ? `Proyecto «${final}» creado en MAESTROS. Elígelo en la lista.` : `El proyecto «${final}» ya existía en MAESTROS. Elígelo en la lista.`, 'ok');
      sugerirProyectos(''); // vuelve a abrir la lista con el nuevo proyecto arriba
    } catch (e) {
      decir(e.message, 'err');
    }
  }

  // ---------- Artículos y totales ----------
  const descuentoGlobal = () => pct($('[data-global]')?.value);
  const impuestoDe = x => (opciones?.impuestos || []).find(i => String(i.id) === String(x.impuesto_id || ''));

  function calcularLinea(x) {
    const bruto = Number(x.cantidad || 0) * Number(x.precio || 0);
    const descuento = Math.min(bruto, Number(x.descuento || 0) + bruto * descuentoGlobal() / 100);
    const base = Math.max(0, bruto - descuento);
    const impuesto = base * Number(impuestoDe(x)?.valor || 0) / 100;
    return { bruto, descuento, base, impuesto, total: base + impuesto };
  }

  function totales() {
    const r = articulos.map(calcularLinea).reduce((n, l) => ({
      bruto: n.bruto + l.bruto,
      descuentos: n.descuentos + l.descuento,
      impuestos: n.impuestos + l.impuesto,
    }), { bruto: 0, descuentos: 0, impuestos: 0 });
    const baseRet = r.bruto - r.descuentos;
    r.retencion = retencionesSel.reduce((suma, id) => {
      const x = (opciones?.retenciones || []).find(y => String(y.id) === String(id));
      if (!x) return suma;
      const tipo = String(x.tipo_calculo || '').toLowerCase();
      let base = baseRet;
      if (tipo === 'sobre impuesto principal') base = r.impuestos;
      else if (tipo === 'sobre base') {
        base = baseRet - Number(x.base_excluida || 0);
        if (base < Number(x.base || 0)) return suma;
      }
      return suma + Math.max(0, base) * Number(x.valor || 0) / 100;
    }, 0);
    r.total = r.bruto - r.descuentos + r.impuestos;
    r.neto = r.total - r.retencion;
    return r;
  }

  function pintarTotales() {
    if (!panel) return;
    const t = totales();
    const poner = (selector, v) => { const el = $(selector); if (el) el.textContent = money(v); };
    poner('[data-gross]', t.bruto);
    poner('[data-discount]', t.descuentos);
    poner('[data-tax-total]', t.impuestos);
    poner('[data-total]', t.total);
    poner('[data-retention-total]', t.retencion);
    poner('[data-net-total]', t.neto);
  }

  const opcionesImpuesto = seleccionado => '<option value="">Sin impuesto</option>' + (opciones?.impuestos || [])
    .filter(x => String(x.tipo_calculo || '').toLowerCase() === 'porcentaje' || !x.tipo_calculo)
    .map(x => `<option value="${esc(x.id)}" ${String(x.id) === String(seleccionado || '') ? 'selected' : ''}>${esc(x.nombre)}${Number(x.valor || 0) ? ` · ${esc(x.valor)}%` : ''}</option>`)
    .join('');

  // Stock de tela de cada artículo agregado; la misma referencia no se consulta otra vez en 5 minutos.
  const stockCache = new Map();
  function stockDe(referencia) {
    const guardado = stockCache.get(referencia);
    if (guardado && Date.now() - guardado.cuando < 300000) return guardado.promesa;
    const promesa = api('/stock-tela?referencia=' + encodeURIComponent(referencia)).catch(() => ({ estado: 'No fue posible consultar el stock' }));
    stockCache.set(referencia, { cuando: Date.now(), promesa });
    return promesa;
  }

  // Consumo por unidad de cada referencia (cambia poco: se guarda 10 minutos).
  const consumoCache = new Map();
  function consumoDe(referencia) {
    const guardado = consumoCache.get(referencia);
    if (guardado && Date.now() - guardado.cuando < 600000) return guardado.promesa;
    const promesa = api('/consumo?referencia=' + encodeURIComponent(referencia))
      .catch(() => ({ mts_por_unidad: 0, error: true }));
    consumoCache.set(referencia, { cuando: Date.now(), promesa });
    return promesa;
  }

  // Cuánta tela necesita el pedido (cantidad × metros por unidad) contra los metros disponibles.
  function estadoTela(x) {
    const ref = x.referencia || x.nombre;
    if (!x.stock || !x.consumo) return { ok: false, pendiente: true, texto: 'Calculando cuánta tela necesita…' };
    const disponible = Number(x.stock.mts_total || 0);
    const mtsUnidad = Number(x.consumo.mts_por_unidad || 0);
    if (!(mtsUnidad > 0)) {
      return { ok: false, texto: x.consumo.error ? `No se pudo calcular ${ref}` : `Sin consumo para ${ref} en Promedios` };
    }
    const cant = Number(x.cantidad) || 0;
    const necesario = Math.round(cant * mtsUnidad * 100) / 100;
    const ok = disponible > 0 && disponible >= necesario;
    const cuenta = `${cifra(cant, 3)} und × ${cifra(mtsUnidad)} mts = ${cifra(necesario)} mts`;
    return {
      ok, necesario, disponible,
      faltan: Math.round((necesario - disponible) * 100) / 100,
      texto: ok ? `Alcanza · necesita ${cifra(necesario)} mts · hay ${cifra(disponible)} mts`
        : `No alcanza · necesita ${cifra(necesario)} mts · hay ${cifra(disponible)} mts`,
      detalle: `${cuenta}`,
    };
  }
  const sinTela = x => !!x.stock && !!x.consumo && !estadoTela(x).ok;

  function stockFilaHtml(x) {
    const e = estadoTela(x);
    if (e.pendiente) return '<span class="vx-sf vx-sf-cargando">Calculando cuánta tela necesita…</span>';
    const telas = x.stock.telas || [];
    const detalle = telas.map(t => `${esc(String(t.nombre || '').replace(/^\s*\(\d+\)\s*/, ''))} ${cifra(t.mts)}`).join(' · ');
    return `<span class="vx-sf${e.ok ? '' : ' vx-sf-sin'}" title="${esc(e.detalle)}"><b>${e.ok ? '✓ ALCANZA' : '✗ NO ALCANZA'}</b> · REQUERIDO ${cifra(e.necesario)} mts · STOCK ${cifra(e.disponible)} mts</span>${pedirTelaHtml(x, e)}`;
  }

  // Si la tela no alcanza, el comercial se la pide al agente de inventario (ZEUS) con un clic: crea la orden de compra en Effi por los metros que faltan.
  function pedirTelaHtml(x, e) {
    if (e.ok || !(e.faltan > 0) || !(x.stock?.telas || []).length) return '';
    const p = x.pedido && x.pedido.cantidad === x.cantidad ? x.pedido : null;
    if (p?.enviando) return '<span class="vx-pt vx-pt-info">Enviando el requerimiento…</span>';
    if (p?.ok) return `<span class="vx-pt vx-pt-ok">✓ Requerimiento enviado a Inventarios · ${cifra(p.faltan)} mts${p.oc ? ' · OC ' + esc(p.oc) : ''}</span>`;
    const i = articulos.indexOf(x);
    return `<button type="button" class="vx-pt vx-pt-b" data-pedir-tela="${i}">Pedir ${cifra(e.faltan)} mts de tela a Inventarios</button>${p?.error ? `<span class="vx-pt vx-pt-err">${esc(p.error)}</span>` : ''}`;
  }

  async function pedirTela(i) {
    const x = articulos[i];
    if (!x) return;
    const cantidad = x.cantidad;
    x.pedido = { enviando: true, cantidad };
    refrescarFila(x);
    try {
      const d = await api('/requerimiento-tela', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        referencia: x.referencia || x.nombre, cantidad, codigo: x.stock?.telas?.[0]?.codigo || '', cliente: cliente?.nombre || '',
        proyecto: textoDe('proyecto'), fecha_entrega: $('[data-fecha]')?.value || '' }) });
      x.pedido = { ok: true, cantidad, faltan: d.faltan, oc: d.oc || '' };
    } catch (err) {
      x.pedido = { error: err.message || 'No se pudo enviar el requerimiento', cantidad };
    }
    refrescarFila(x);
  }

  function refrescarFila(x) {
    const i = articulos.indexOf(x);
    const caja = i >= 0 ? $(`[data-stock-fila="${i}"]`) : null;
    if (!caja) return;
    caja.innerHTML = stockFilaHtml(x);
    caja.closest('.vx-fila')?.classList.toggle('vx-fila-sin', sinTela(x));
  }

  function cargarStockFila(x) {
    const referencia = String(x.referencia || x.nombre || '').trim();
    if (referencia.length < 4) {
      x.stock = { estado: 'Sin referencia para consultar stock' };
      x.consumo = { mts_por_unidad: 0, error: true };
      return refrescarFila(x);
    }
    stockDe(referencia).then(d => { x.stock = d; refrescarFila(x); });
    consumoDe(referencia).then(c => { x.consumo = c; refrescarFila(x); });
  }

  function filaHtml(x, i, nueva) {
    const l = calcularLinea(x);
    return `<div class="vx-fila${nueva ? ' vx-nueva' : ''}${sinTela(x) ? ' vx-fila-sin' : ''}">
      <div class="vx-fila-art"><b><span class="vx-ref">${esc(x.referencia || x.nombre)}</span></b><small>${esc(x.nombre)}</small><div class="vx-sf-caja" data-stock-fila="${i}">${stockFilaHtml(x)}</div><input class="vx-in" data-nota="${i}" value="${esc(x.nota || '')}" placeholder="Nota por prenda (opcional)"></div>
      <label class="vx-celda"><span>Cant.</span><input class="vx-in vx-sm" data-cant="${i}" type="number" min="0.001" step="0.001" inputmode="decimal" value="${esc(x.cantidad)}"></label>
      <label class="vx-celda"><span>Precio u.</span><input class="vx-in vx-sm" readonly value="${esc(money(x.precio))}"></label>
      <label class="vx-celda"><span>Descuento</span><input class="vx-in vx-sm" data-desc="${i}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(x.descuento || 0)}"></label>
      <label class="vx-celda"><span>IVA</span><select class="vx-in vx-sm" data-tax="${i}">${opcionesImpuesto(x.impuesto_id)}</select></label>
      <div class="vx-celda vx-total"><span>Total</span><b data-linea-total="${i}">${money(l.total)}</b></div>
      <button type="button" class="vx-quitar" data-quitar="${i}" title="Quitar artículo" aria-label="Quitar artículo">×</button>
    </div>`;
  }

  // Solo se re-dibuja la lista al agregar, quitar o cambiar el IVA: al escribir cantidades no, para no perder el foco.
  function pintarArticulos(nuevaIdx = -1) {
    const contenedor = $('[data-items]');
    if (!contenedor) return;
    contenedor.innerHTML = articulos.length
      ? articulos.map((x, i) => filaHtml(x, i, i === nuevaIdx)).join('')
      : '<p class="vx-vacio">Aún no has agregado artículos. Escribe una referencia y elígela de la lista.</p>';
    pintarTotales();
  }

  function agregarArticulo(a) {
    const existente = articulos.findIndex(x => String(x.id) === String(a.id));
    if (existente >= 0) {
      articulos[existente].cantidad = Number(articulos[existente].cantidad || 0) + 1;
      pintarArticulos(existente);
    } else {
      const predeterminado = (opciones?.impuestos || []).find(i => i.nombre && plano(a.impuesto).includes(plano(i.nombre)));
      const nuevo = { ...a, cantidad: 1, descuento: 0, nota: '', impuesto_id: predeterminado?.id || '', stock: null };
      articulos.push(nuevo);
      pintarArticulos(articulos.length - 1);
      cargarStockFila(nuevo);
    }
    invalidar();
  }

  function pintarStock(d) {
    const caja = $('[data-stock]');
    if (!caja) return;
    const telas = d.telas || [];
    caja.classList.toggle('vx-stock-vacio', !telas.length);
    caja.innerHTML = telas.length
      ? `<small>STOCK DE TELA${d.codigos?.length ? ' · ' + esc(d.codigos.join(' · ')) : ''}</small><b>${cifra(d.mts_total)} mts disponibles</b><div class="vx-telas">${telas.map(t => `<i>${esc(String(t.nombre || '').replace(/^\s*\(\d+\)\s*/, ''))}: ${cifra(t.mts)} mts</i>`).join('')}</div>`
      : `<small>STOCK DE TELA</small><b>${esc(d.estado || 'Escribe una referencia')}</b><span>Se consulta con el código de la referencia.</span>`;
  }

  async function cargarStock(referencia) {
    const q = String(referencia || '').trim();
    const t = ++versiones.stock;
    if (q.length < 4) return pintarStock({});
    const caja = $('[data-stock]');
    if (caja) { caja.className = 'vx-stock vx-stock-vacio'; caja.innerHTML = '<small>STOCK DE TELA</small><b>Consultando disponibilidad…</b><span>Bodega Tela</span>'; }
    try {
      const d = await api('/stock-tela?referencia=' + encodeURIComponent(q));
      if (t === versiones.stock) pintarStock(d);
    } catch (e) {
      if (t === versiones.stock) pintarStock({ estado: 'No fue posible consultar stock' });
    }
  }

  // ---------- Validación, revisión y creación ----------
  function faltantes() {
    const errores = [];
    if (!cliente) errores.push(['cliente', 'Cliente']);
    if (!valor('sucursal')) errores.push(['sucursal', 'Sucursal']);
    if (!valor('bodega')) errores.push(['bodega', 'Bodega']);
    if (!valor('centro')) errores.push(['centro', 'Centro de costos']);
    if (!$('[data-fecha]').value) errores.push(['fecha', 'Fecha de entrega']);
    if (!valor('forma')) errores.push(['forma', 'Forma de pago']);
    if (!textoDe('proyecto')) errores.push(['proyecto', 'Nombre del proyecto']);
    if (!valor('lineas')) errores.push(['lineas', 'Línea de producto']);
    if (!articulos.length) errores.push(['articulo', 'Al menos un artículo']);
    else if (articulos.some(x => !(Number(x.cantidad) > 0))) errores.push(['cant', 'Cantidades mayores a cero']);
    // Ningún artículo sin tela: cotización y remisión comparten esta validación.
    if (articulos.length) {
      articulos.forEach(x => {
        const e = estadoTela(x);
        if (e.pendiente) errores.push(['articulo', `Esperando el cálculo de tela de ${x.referencia || x.nombre}`]);
        else if (!e.ok) errores.push(['articulo', e.faltan != null ? `${x.referencia || x.nombre}: faltan ${cifra(e.faltan)} mts` : `${x.referencia || x.nombre}: ${e.texto}`]);
      });
    }
    return errores;
  }

  function payload() {
    const dir = $('[data-direccion]');
    return {
      tipo: actual,
      cliente: cliente?.tercero || '',
      cliente_nombre: cliente?.nombre || '',
      tercero: tercero?.tercero || '',
      fecha_entrega: $('[data-fecha]').value,
      forma_pago: valor('forma'),
      proyecto: textoDe('proyecto'),
      lineas_producto: valor('lineas'),
      sucursal: valor('sucursal'),
      bodega: valor('bodega'),
      centro_costos: valor('centro'),
      vendedor: valor('vendedor'),
      ubicacion_venta: valor('ubicacion'),
      descuento_global: descuentoGlobal(),
      propina: $('[data-propina]').value || 0,
      prontopago: $('[data-pronto]').value || 0,
      fecha_prontopago: $('[data-fecha-pronto]').value || '',
      referencia_cliente: $('[data-ref-direccion]').value.trim(),
      retenciones: retencionesSel.slice(),
      direccion_cliente: dir.value,
      id_pais_cliente: dir.dataset.pais || '',
      id_provincia_cliente: dir.dataset.provincia || '',
      id_ciudad_cliente: dir.dataset.ciudad || '',
      articulos: articulos.map(x => ({ id: x.id, referencia: x.referencia || '', descripcion: x.nombre, cantidad: x.cantidad, precio: x.precio, descuento: x.descuento || 0, nota: x.nota || '', impuesto_id: x.impuesto_id || '' })),
    };
  }

  function mostrarFaltantes(errores) {
    invalidar();
    const nombres = errores.map(([, n]) => n);
    $('[data-review]').innerHTML = `<section class="vx-rev vx-rev-err"><h4>Completa los datos requeridos</h4><ul>${nombres.map(n => `<li>${esc(n)}</li>`).join('')}</ul></section>`;
    decir(`Faltan: ${nombres.join(', ')}.`, 'err');
    const campo = panel.querySelector(FOCO[errores[0][0]]);
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  }

  async function revisar() {
    const errores = faltantes();
    if (errores.length) return mostrarFaltantes(errores);
    decir('Validando artículos, impuestos y total con Effi…');
    try {
      const d = await api('/previsualizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
      const r = d.resumen;
      $('[data-review]').innerHTML = `<section class="vx-rev"><h4>Revisa antes de crear</h4><ul>
        <li><b>${esc(r.tipo)}</b> para <b>${esc(cliente.nombre)}</b></li>
        <li>Proyecto: <b>${esc(r.proyecto)}</b></li>
        <li>Líneas: ${esc(r.lineas_producto)}</li>
        <li>Bruto ${money(r.bruto)} · descuentos ${money(r.descuentos)} · total <b>${money(r.total_estimado)}</b></li>
        <li>${(r.lineas || []).length} artículo(s) · entrega ${esc(r.fecha_entrega)}</li>
        ${actual === 'remision' ? '<li class="vx-peligro">Esta remisión descontará inventario cuando la confirmes.</li>' : ''}
      </ul></section>`;
      $('[data-crear]').disabled = false;
      decir('Revisión correcta. Confirma solo si todos los datos son correctos.', 'ok');
    } catch (e) {
      invalidar();
      decir(e.message, 'err');
    }
  }

  async function crear() {
    if (enviando) return;
    if (!confirm(`¿Crear ${nombreDoc()} en Effi? Esta acción genera un documento real.`)) return;
    enviando = true;
    const boton = $('[data-crear]');
    boton.disabled = true;
    decir('Creando documento en Effi…');
    try {
      const d = await api('/crear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(), confirmado: true }) });
      $('[data-review]').innerHTML = `<section class="vx-rev"><h4>✓ Documento creado en Effi</h4>${(d.tela_pedida || []).map(t => `<p class="vx-pt vx-pt-ok">✓ Tela pedida a Inventarios: ${cifra(t.mts)} mts de ${esc(t.tela)} · ZEUS crea la orden de compra</p>`).join('')}<p><b>${esc(d.numero || d.id)}</b> · Total ${money(d.total || d.resumen?.total_estimado)}</p><p>Guarda este número antes de continuar con el siguiente documento.</p></section>`;
      decir('Documento creado correctamente.', 'ok');
    } catch (e) {
      decir(e.message, 'err');
      boton.disabled = false;
    } finally {
      enviando = false;
    }
  }

  // ---------- MENÚ CO / MENÚ RM ----------
  // Pide el PDF guardado en Cartera; si no existe, avisa dentro del panel. Si existe, lo abre en una pestaña nueva.
  async function verPdf(numero) {
    decir('Abriendo PDF…');
    try {
      const r = await fetch('/api/ventas-effi/pdf?numero=' + encodeURIComponent(numero), { credentials: 'same-origin' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || 'No se pudo abrir el PDF');
      }
      const url = URL.createObjectURL(await r.blob());
      const abierta = window.open(url, '_blank', 'noopener');
      if (!abierta) throw new Error('Permite las ventanas emergentes para ver el PDF.');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      decir('');
    } catch (e) {
      decir(e.message, 'err');
    }
  }

  const fechaCorta = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '—'); };
  const etiquetaCampo = k => { const t = String(k).replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

  function diasEntrega(v) {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return Math.round((new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) - new Date(hoy() + 'T00:00:00')) / 86400000);
  }

  // pendientes / cerradas (convertidas o facturadas) / anuladas
  function grupo(d) {
    if (!d.vigente) return 'anuladas';
    return d.estado_id && d.estado_id !== 1 ? 'cerradas' : 'pendientes';
  }

  function visibles() {
    const q = plano(menu.q.trim());
    return menu.documentos.filter(d => (menu.filtro === 'todas' || grupo(d) === menu.filtro)
      && (!q || plano([d.numero, d.cliente, d.proyecto, d.vendedor, d.observacion, d.responsable].join(' ')).includes(q)));
  }

  // Campos de Effi que la tarjeta ya muestra arriba; el resto va en «Más datos de Effi».
  const YA_MOSTRADOS = new Set(['id', 'id_transaccion', 'prefijo', 'total', 'subtotal', 'impuestos', 'impuesto', 'descuento', 'pdte_cobro',
    'garantia', 'observacion', 'responsable', 'fecha_trans', 'fecha_creacion', 'fecha', 'fecha_entrega', 'vigente', 'vigencia',
    'est_cotizacion', 'est_remision_v', 'nombre_est_cotizacion', 'nombre_est_remision_v',
    ...['cliente', 'vendedor', 'bodega', 'sucursal', 'centro_costos', 'forma_pago'].flatMap(b => [b, 'nombre_' + b, b + '_nombre'])]);

  // Avance del documento: de pendiente a convertida o facturada.
  function avance(d) {
    if (!d.vigente) return 0;
    if (menu.tipo === 'remision') return d.estado_id === 2 ? 100 : 50;
    return { 1: 25, 2: 50, 3: 75, 4: 100 }[d.estado_id] || 25;
  }

  // En OBSERVACIÓN se guarda «LÍNEAS DE PRODUCTO: PLUS · Creado desde el panel por …»; la tarjeta muestra solo la línea.
  const lineaDeProducto = d => {
    const m = String(d.observacion || '').match(/L[ÍI]NEAS DE PRODUCTO:\s*([^·]+)/i);
    return m ? m[1].trim() : (d.observacion || '');
  };

  function tarjetaDoc(d, i) {
    const tono = TONO[grupo(d)];
    const ficha = (etiqueta, valor) => `<div class="vx-tj-ficha"><dt>${etiqueta}</dt><dd>${valor === undefined || valor === null || valor === '' ? '—' : esc(valor)}</dd></div>`;
    return `<article class="vx-tj vx-tj-${tono}" style="--i:${Math.min(i, 12)}">
      <header class="vx-tj-top">
        <h4 class="vx-tj-cli" title="${esc(d.cliente)}">${esc(d.cliente || 'Cliente sin nombre')}</h4>
        <span class="vx-tj-num">${esc(((n => /^[A-Za-z]/.test(n) ? n : (menu.tipo === 'remision' ? 'RM' : 'CO') + n)(String(d.numero || d.id).replace(/[-#\s]/g, ''))))}</span>
      </header>
      ${d.proyecto ? `<p class="vx-tj-pro" title="${esc(d.proyecto)}">${esc(d.proyecto)}</p>` : ''}
      <dl class="vx-tj-fichas">
        ${ficha('Referencia', d.referencia)}
        ${ficha('Cantidad', d.cantidad ? cifra(d.cantidad, 0) : '')}
        ${ficha('Vendedor', d.vendedor)}
        ${ficha('Línea de producto', lineaDeProducto(d))}
      </dl>
      <footer class="vx-tj-pie">
        <div class="vx-acc">
          <button type="button" class="vx-acc-b vx-acc-anular" data-accion="anular" data-id="${esc(d.id)}">Anular</button>
          <button type="button" class="vx-acc-b vx-acc-modificar" data-accion="modificar" data-id="${esc(d.id)}">Modificar</button>
          <button type="button" class="vx-acc-b vx-acc-produccion" data-accion="produccion" data-id="${esc(d.id)}">Enviar a producción</button>
        </div>
        <button type="button" class="vx-pdf" data-pdf="${esc(d.numero)}">Ver PDF</button>
      </footer>
    </article>`;
  }

  // Números con el estilo líquido del panel (liquid-stats.js lee data-lq).
  function pintarKpis() {
    const caja = $('[data-kpis]');
    if (!caja) return;
    const docs = menu.documentos, n = docs.length;
    const cuenta = g => docs.filter(d => grupo(d) === g).length;
    const parte = x => (n ? Math.round(x * 100 / n) : 0);
    const valor = docs.filter(d => d.vigente).reduce((s, d) => s + Number(d.total || 0), 0);
    caja.innerHTML = [
      ['Cargadas', n, 100, 'teal', true],
      ['Pendientes', cuenta('pendientes'), parte(cuenta('pendientes')), 'ambar'],
      [menu.tipo === 'remision' ? 'Facturadas' : 'Convertidas', cuenta('cerradas'), parte(cuenta('cerradas')), 'verde'],
      ['Anuladas', cuenta('anuladas'), parte(cuenta('anuladas')), 'rojo'],
      ['Valor vigente', money(valor), 100, 'oliva', true],
    ].map(([t, v, lq, tono, sinPct]) => `<div class="vx-kpi" data-lq="${lq}" data-lq-tone="${tono}"${sinPct ? ' data-lq-nopct' : ''}><small>${t}</small><b>${v}</b></div>`).join('');
  }

  function pintarMenu() {
    const lista = $('[data-menu-lista]');
    if (!lista) return;
    pintarKpis();
    panel.querySelectorAll('[data-menu-filtro]').forEach(b => b.classList.toggle('activa', b.dataset.menuFiltro === menu.filtro));
    if (menu.cargando && !menu.documentos.length) {
      lista.innerHTML = Array.from({ length: 6 }, () => '<div class="vx-tj vx-esqueleto"></div>').join('');
    } else {
      const docs = visibles();
      lista.innerHTML = docs.length ? docs.map(tarjetaDoc).join('')
        : `<p class="vx-vacio">${menu.documentos.length ? 'Ningún documento coincide con la búsqueda o el filtro.' : 'No hay documentos para mostrar.'}</p>`;
    }
    const mas = $('[data-menu-mas]');
    if (mas) {
      mas.hidden = !menu.hayMas;
      mas.disabled = menu.cargando;
      mas.textContent = menu.cargando ? 'Cargando…' : 'Cargar más';
    }
  }

  async function cargarMenu(reiniciar = false) {
    if (menu.cargando) return;
    if (reiniciar) { menu.documentos = []; menu.pagina = 0; menu.hayMas = false; }
    const turno = ++turnoMenu, tipo = menu.tipo;
    menu.turno = turno;
    menu.cargando = true;
    pintarMenu();
    try {
      const d = await api(`/documentos?tipo=${encodeURIComponent(tipo)}&pagina=${menu.pagina + 1}`);
      if (turno !== menu.turno) return;
      menu.pagina = d.pagina;
      menu.hayMas = !!d.hay_mas;
      menu.documentos = menu.documentos.concat(d.documentos || []);
      decir(menu.documentos.length ? '' : 'Effi no devolvió documentos.');
    } catch (e) {
      if (turno === menu.turno) decir(e.message, 'err');
    } finally {
      if (turno === menu.turno) { menu.cargando = false; pintarMenu(); }
    }
  }

  function plantillaMenu(m) {
    const filtros = [['todas', 'Todas'], ['pendientes', 'Pendientes'], ['cerradas', m.tipo === 'remision' ? 'Facturadas' : 'Convertidas'], ['anuladas', 'Anuladas']];
    return `
      <div class="vx-doc"><span class="vx-kicker">MENÚ ${m.sigla} · EFFI</span><h3>${m.titulo}</h3></div>
      <div class="vx-kpis" data-kpis></div>
      <div class="vx-barra">
        <div class="vx-entrada vx-buscar"><input class="vx-in" data-menu-q autocomplete="off" placeholder="Busca por cliente, número, proyecto o vendedor"></div>
        <button type="button" class="vx-btn vx-btn-sec" data-menu-actualizar>Actualizar</button>
      </div>
      <div class="vx-chips">${filtros.map(([k, t]) => `<button type="button" class="vx-chip" data-menu-filtro="${k}">${t}</button>`).join('')}</div>
      <div class="vx-tarjetas" data-menu-lista></div>
      <div class="vx-mas"><button type="button" class="vx-btn vx-btn-sec" data-menu-mas hidden>Cargar más</button></div>
      <p class="vx-msg" data-msg></p>`;
  }

  // ---------- Formulario ----------
  const campo = (clase, etiqueta, control) => `<div class="vx-campo ${clase}"><span class="vx-etq">${esc(etiqueta)}</span>${control}</div>`;

  function buscador(nombre, etiqueta, items, seleccion, clase) {
    const elegido = (items || []).find(x => String(x.id) === String(seleccion ?? '')) || null;
    return `<div class="vx-campo vx-busq ${clase}" data-buscador="${nombre}">
      <span class="vx-etq">${esc(etiqueta)}</span>
      <div class="vx-entrada"><input class="vx-in" data-texto autocomplete="off" placeholder="Busca ${esc(sinAsterisco(etiqueta).toLowerCase())}" value="${esc(elegido?.nombre || '')}"><i class="vx-flecha"></i></div>
      <input type="hidden" data-valor="${nombre}" value="${esc(elegido?.id ?? '')}">
      <div class="vx-lista" hidden></div>
    </div>`;
  }

  const buscadorRemoto = (nombre, etiqueta, placeholder, clase, pie = '') => `<div class="vx-campo vx-busq ${clase}" data-buscador="${nombre}">
      <span class="vx-etq">${esc(etiqueta)}</span>
      <div class="vx-entrada"><input class="vx-in" data-texto autocomplete="off" placeholder="${esc(placeholder)}"><i class="vx-flecha"></i></div>
      ${pie}
      <div class="vx-lista" hidden></div>
    </div>`;

  // Retenciones como las muestra Effi: «id - ETIQUETA | nombre | % tipo - Base mínima», de menor a mayor porcentaje.
  const retencionesEffi = lista => (lista || []).slice().sort((a, b) => Number(a.valor || 0) - Number(b.valor || 0) || Number(a.id) - Number(b.id));
  const textoRetencion = x => {
    const tipo = String(x.tipo_calculo || '');
    const base = tipo.toLowerCase() === 'sobre base' ? ` - Base mínima: $${Number(x.base || 0).toLocaleString('en-US')}` : '';
    return `${x.id} - ${x.etiqueta || x.nombre} | ${x.detalle || x.nombre} | ${Number(x.valor || 0)}% ${tipo}${base}`.trim();
  };
  function pintarRetenciones() {
    const lista = $('[data-ret-lista]');
    if (lista) {
      lista.innerHTML = retencionesSel.map(id => {
        const x = (opciones?.retenciones || []).find(y => String(y.id) === String(id));
        return `<span class="vx-chip activa">${esc(x ? `${x.etiqueta || x.nombre} ${Number(x.valor || 0)}%` : id)} <button type="button" data-ret-quitar="${esc(id)}" aria-label="Quitar retención" style="margin-left:8px;background:none;border:0;color:inherit;cursor:pointer">×</button></span>`;
      }).join('');
    }
    pintarTotales();
  }

  function plantilla(doc) {
    const o = opciones || {};
    const retenciones = retencionesEffi(o.retenciones);
    const remision = doc[0] === 'remision';
    return `
      <div class="vx-doc"><span class="vx-kicker">ASISTENTE DE VENTAS · EFFI</span><h3>${esc(doc[2])}</h3></div>
      <div class="vx-cat" data-catalogo><span class="vx-cat-dot"></span><span class="vx-cat-t">CATÁLOGO</span><span class="vx-cat-e" data-catalogo-estado>Preparando catálogo…</span><button type="button" class="vx-cat-b" data-catalogo-actualizar>Actualizar</button></div>

      <details class="vx-sec" open>
        <summary>Operación</summary>
        <div class="vx-sec-cuerpo">
          <div class="vx-campos">
            ${buscador('sucursal', 'Sucursal *', o.sucursales, null, 'vx-c3')}
            ${buscador('bodega', 'Bodega *', o.bodegas, null, 'vx-c3')}
            ${buscador('centro', 'Centro de costos *', o.centros_costos, null, 'vx-c3')}
            ${campo('vx-c3', 'Fecha de entrega *', `<input class="vx-in" data-fecha type="date">`)}
            ${buscadorRemoto('cliente', 'Cliente *', 'Nombre o documento del cliente', 'vx-c6', '<span class="vx-estado" data-cliente-ok></span>')}
            <div class="vx-campo vx-busq vx-c6" data-buscador="proyecto">
              <span class="vx-etq">Garantía / nombre del proyecto *</span>
              <div class="vx-entrada"><input class="vx-in" data-texto autocomplete="off" placeholder="Selecciona o escribe el proyecto"><i class="vx-flecha"></i></div>
              <span class="vx-estado" data-proyecto-estado>Selecciona un cliente</span>
              <div class="vx-lista" hidden></div>
            </div>
            <div class="vx-campo vx-busq vx-c4" data-buscador="direccion">
              <span class="vx-etq">Dirección del cliente</span>
              <div class="vx-entrada"><input class="vx-in" data-texto data-direccion readonly placeholder="Primero selecciona un cliente"><i class="vx-flecha"></i></div>
              <div class="vx-lista" hidden></div>
            </div>
            ${buscador('forma', 'Forma de pago *', o.formas_pago, null, 'vx-c3')}
            ${buscador('vendedor', 'Vendedor', filtrarVendedores(o.vendedores), null, 'vx-c3')}
            ${campo('vx-c2', 'Descuento global %', `<input class="vx-in" data-global type="number" min="0" max="100" step=".01" inputmode="decimal" placeholder="0">`)}
          </div>
        </div>
      </details>

      <details class="vx-sec" open>
        <summary>Conceptos</summary>
        <div class="vx-sec-cuerpo">
          <div class="vx-artzona">
            <div class="vx-campo vx-busq" data-buscador="articulo">
              <span class="vx-etq">Referencia o ID de Effi *</span>
              <div class="vx-entrada"><input class="vx-in" data-texto autocomplete="off" placeholder="Escribe la referencia (FUT01, CA02…) o el ID de Effi"><i class="vx-flecha"></i></div>
              <div class="vx-lista" hidden></div>
            </div>
            <aside class="vx-stock vx-stock-vacio" data-stock><small>STOCK DE TELA</small><b>Escribe una referencia</b><span>Verás los metros disponibles aquí.</span></aside>
          </div>
          <p class="vx-ayuda">Elige el artículo de la lista para agregarlo con cantidad 1. Vuelve a elegirlo para sumar uno más.</p>
          <div class="vx-cab-conc"><span>Artículo</span><span>Cant.</span><span>Precio u.</span><span>Descuento</span><span>IVA</span><span>Total</span><span></span></div>
          <div data-items></div>
        </div>
      </details>

      <details class="vx-sec" open>
        <summary>Detalles de la ${esc(doc[2]).toLowerCase()}</summary>
        <div class="vx-sec-cuerpo">
          <div class="vx-campos">
            ${buscador('lineas', 'Líneas de producto *', LINEAS.map(l => ({ id: l, nombre: l })), null, 'vx-c4')}
            ${buscadorRemoto('tercero', 'Tercero multipropósito', 'Busca tercero en Effi', 'vx-c4')}
            ${campo('vx-c4', 'Referencia de dirección', `<input class="vx-in" data-ref-direccion placeholder="Oficina, apartamento o sede">`)}
            <div class="vx-campo vx-c12 vx-ret">
              <span class="vx-etq">Retenciones:</span>
              <div class="vx-ret-fila">
                <select class="vx-in" data-retention><option value="">Seleccionar...</option>${retenciones.map(x => `<option value="${esc(x.id)}">${esc(textoRetencion(x))}</option>`).join('')}</select>
                <button type="button" class="vx-btn vx-btn-sec" data-ret-add>+ Agregar retención</button>
              </div>
              <div class="vx-chips" data-ret-lista></div>
            </div>
            ${campo('vx-c3', '+ Propina', `<input class="vx-in" data-propina type="number" min="0" step=".01" inputmode="decimal" placeholder="0">`)}
            ${campo('vx-c3', 'Descuento prontopago', `<input class="vx-in" data-pronto type="number" min="0" step=".01" inputmode="decimal" placeholder="0">`)}
            ${campo('vx-c3', 'Fecha prontopago', `<input class="vx-in" data-fecha-pronto type="date">`)}
          </div>
        </div>
      </details>

      <section class="vx-totales">
        <div><small>TOTAL BRUTO</small><b data-gross>$0</b></div>
        <div><small>- Descuentos</small><b data-discount>$0</b></div>
        <div><small>+ Impuestos</small><b data-tax-total>$0</b></div>
        <div><small>Total</small><b data-total>$0</b></div>
        <div><small>- Retenciones</small><b data-retention-total>$0</b></div>
        <div class="vx-neto"><small>TOTAL NETO</small><b data-net-total>$0</b></div>
      </section>
      <p class="vx-ayuda">Effi valida el total final. ${remision ? 'La remisión descuenta inventario al confirmarla.' : 'La cotización no mueve inventario.'}</p>
      <div class="vx-acciones">
        <button type="button" class="vx-btn vx-btn-sec" data-revisar>Revisar resumen</button>
        <button type="button" class="vx-btn vx-btn-main" data-crear disabled>Confirmar y crear en Effi</button>
      </div>
      <div data-review></div>
      <p class="vx-msg" data-msg></p>`;
  }

  function activarBuscadores() {
    Object.keys(FUENTES).forEach(nombre => {
      const el = $(`[data-buscador="${nombre}"]`);
      if (!el) return;
      const items = (FUENTES[nombre](opciones) || []).map(x => ({ id: x.id, nombre: x.nombre || ('#' + x.id) }));
      activarLista(el, items);
    });

    const cli = $('[data-buscador="cliente"]');
    cli._elegir = elegirCliente;
    buscarRemoto(cli, q => api('/clientes?q=' + encodeURIComponent(q)).then(d => (d.clientes || []).map(x => ({
      ...x, html: opcion(x.nombre, `${x.documento} · código ${x.tercero}`),
    }))), { alEscribir: () => limpiarCliente(), vacio: 'Sin coincidencias en Effi' });

    const art = $('[data-buscador="articulo"]');
    art._elegir = a => {
      agregarArticulo(a);
      art.querySelector('[data-texto]').value = '';
      // La tela ya sale debajo del artículo: la tarjeta de arriba vuelve a estar vacía (y se ignoran consultas pendientes).
      versiones.stock++;
      pintarStock({});
      decir('Artículo agregado. Busca el siguiente.', 'ok');
    };
    buscarRemoto(art, q => {
      cargarStock(q);
      return api('/articulos?q=' + encodeURIComponent(q)).then(d => (d.articulos || []).map(x => {
        // Referencias parecidas (FUT01 / FUT02) se distinguen: etiqueta, parte buscada resaltada y si ya se agregó.
        const ya = articulos.find(a => String(a.id) === String(x.id));
        const marca = ya ? `<span class="vx-op-ya">✓ Agregado${Number(ya.cantidad) > 1 ? ' · ' + esc(ya.cantidad) + ' und' : ''}</span>` : '';
        return {
          ...x, clase: ya ? 'vx-op-agregado' : '',
          html: `<span class="vx-op-t"><span class="vx-op-ref">${resaltar(x.referencia || x.nombre, q)}</span>${marca}</span><span class="vx-op-s">${esc(x.nombre)}</span><span class="vx-op-d">${money(x.precio)}</span>`,
        };
      }));
    }, { espera: 150, vacio: 'Sin coincidencias en Effi' });

    const ter = $('[data-buscador="tercero"]');
    ter._elegir = x => {
      tercero = x;
      ter.querySelector('[data-texto]').value = x.nombre;
      invalidar();
    };
    buscarRemoto(ter, q => api('/terceros?q=' + encodeURIComponent(q)).then(d => (d.terceros || []).map(x => ({
      ...x, html: opcion(x.nombre, `${x.documento} · código ${x.tercero}`),
    }))), { alEscribir: () => { tercero = null; }, vacio: 'Sin coincidencias' });

    const pro = $('[data-buscador="proyecto"]');
    const textoPro = pro.querySelector('[data-texto]');
    pro._elegir = item => (item.crear ? crearDesdeLista(item.nombre) : setProyecto(item.nombre));
    textoPro.addEventListener('focus', () => sugerirProyectos(textoPro.value));
    textoPro.addEventListener('input', () => sugerirProyectos(textoPro.value));
    textoPro.addEventListener('keydown', teclas(pro));

    const dir = $('[data-buscador="direccion"]');
    const textoDir = dir.querySelector('[data-texto]');
    dir._elegir = elegirDireccion;
    const abrirDirecciones = () => {
      if (!cliente) return decir('Selecciona primero un cliente.', 'err');
      mostrar(dir, direcciones.map(d => ({ ...d, html: opcion(d.direccion, 'Dirección registrada en Effi') })), 'Este cliente no tiene direcciones registradas en Effi');
    };
    textoDir.addEventListener('focus', abrirDirecciones);
    textoDir.addEventListener('click', abrirDirecciones);
    textoDir.addEventListener('keydown', teclas(dir));
  }

  function render() {
    if (!panel) return;
    panel.querySelectorAll('.vx-tab').forEach(x => x.classList.toggle('activa', x.dataset.doc === actual));
    const contenido = $('[data-content]');
    contenido.classList.remove('vx-cambio');
    void contenido.offsetWidth; // reinicia la animación al cambiar de pestaña
    contenido.classList.add('vx-cambio');
    const doc = DOCS.find(x => x[0] === actual), m = MENU_DE[actual];
    contenido.innerHTML = `<div class="vx-seg">
        <button type="button" class="vx-seg-b activa" data-vista="nueva">Nueva ${doc[0] === 'remision' ? 'remisión' : 'cotización'}</button>
        <button type="button" class="vx-seg-b" data-vista="creadas">${m.titulo} creadas · ${m.sigla}</button>
      </div>
      <div data-cuerpo="nueva">${plantilla(doc)}</div>
      <div data-cuerpo="creadas" hidden></div>`;
    activarBuscadores();
    pintarArticulos();
    pintarCatalogo();
    decir('');
  }

  // Cambia entre «Nueva» y «Creadas» sin redibujar el formulario: lo escrito se conserva.
  function cambiarVista(vista) {
    cerrarListas();
    panel.querySelectorAll('[data-vista]').forEach(b => b.classList.toggle('activa', b.dataset.vista === vista));
    panel.querySelectorAll('[data-cuerpo]').forEach(c => { c.hidden = c.dataset.cuerpo !== vista; });
    const caja = $('[data-cuerpo="creadas"]');
    if (vista === 'creadas' && caja && !caja.childElementCount) {
      const m = MENU_DE[actual];
      menu = { tipo: m.tipo, pagina: 0, documentos: [], q: '', filtro: 'todas', cargando: false, hayMas: false, turno: 0 };
      caja.innerHTML = plantillaMenu(m);
      cargarMenu(true);
    }
  }

  function cambiarDocumento(doc) {
    actual = doc;
    cliente = null;
    tercero = null;
    direcciones = [];
    proyectos = [];
    articulos = [];
    retencionesSel = [];
    render();
  }

  async function cargar() {
    const contenido = $('[data-content]');
    contenido.innerHTML = '<div class="vx-cargando"><img class="indoor-carga-logo" src="/marca-indoor.svg" alt="Indoor Sport" style="display:block;width:min(150px,50vw);height:auto;margin:0 auto 8px;animation:indoorPulso 1.5s ease-in-out infinite"><style>@keyframes indoorPulso{0%,100%{opacity:.55;transform:scale(.97)}50%{opacity:1;transform:scale(1)}}</style><b>Preparando listas de Effi…</b><span>Esto solo se consulta una vez y luego queda disponible para el formulario.</span></div>';
    const aviso = setTimeout(() => {
      if (!opciones) contenido.innerHTML = '<div class="vx-cargando"><img class="indoor-carga-logo" src="/marca-indoor.svg" alt="Indoor Sport" style="display:block;width:min(150px,50vw);height:auto;margin:0 auto 8px;animation:indoorPulso 1.5s ease-in-out infinite"><style>@keyframes indoorPulso{0%,100%{opacity:.55;transform:scale(.97)}50%{opacity:1;transform:scale(1)}}</style><b>Effi está tardando más de lo normal.</b><span>Seguimos esperando la respuesta sin enviar ninguna información.</span></div>';
    }, 7000);
    try {
      opciones = await api('/opciones');
    } catch (e) {
      contenido.innerHTML = `<div class="vx-cargando"><img class="indoor-carga-logo" src="/marca-indoor.svg" alt="Indoor Sport" style="display:block;width:min(150px,50vw);height:auto;margin:0 auto 8px;animation:indoorPulso 1.5s ease-in-out infinite"><style>@keyframes indoorPulso{0%,100%{opacity:.55;transform:scale(.97)}50%{opacity:1;transform:scale(1)}}</style><b>No fue posible cargar las listas de Effi.</b><span>${esc(e.message)}</span><button type="button" data-reintentar>Reintentar</button></div>`;
      return;
    } finally {
      clearTimeout(aviso);
    }
    render();
    pintarCatalogo(true).then(d => vigilarCatalogo(d?.ejecutando ? 3000 : 20000));
  }

  // Ventas usa todo el ancho y alto libre de la ventana, sin tapar un menú lateral si lo hay.
  function ajustarEspacio() {
    const vx = panel?.querySelector('.vx');
    if (!vx) return;
    vx.style.marginLeft = vx.style.width = vx.style.maxWidth = vx.style.minHeight = '';
    if (!panel.classList.contains('active') || window.innerWidth < 901) return;
    const r = vx.getBoundingClientRect();
    if (!r.width) return;
    const ancho = document.documentElement.clientWidth, borde = 24;
    const y = Math.min(window.innerHeight - 5, Math.max(5, r.top + 40));
    // Un menú lateral es angosto; las capas de fondo a todo el ancho no cuentan como obstáculo.
    const libre = x => document.elementsFromPoint(x, y)
      .every(el => el.contains(panel) || el.getBoundingClientRect().width >= window.innerWidth * 0.6);
    const izq = r.left > borde && libre(borde / 2) ? borde : r.left;
    const der = ancho - r.right > borde && libre(ancho - borde / 2) ? ancho - borde : r.right;
    const padre = vx.parentElement, p = padre.getBoundingClientRect();
    const base = p.left + (parseFloat(getComputedStyle(padre).paddingLeft) || 0);
    vx.style.maxWidth = 'none';
    vx.style.width = `${Math.round(der - izq)}px`;
    vx.style.marginLeft = `${Math.round(izq - base)}px`;
    vx.style.minHeight = `${Math.max(0, Math.round(window.innerHeight - (r.top + window.scrollY) - 16))}px`;
  }
  let relojEspacio = 0;
  window.addEventListener('resize', () => { clearTimeout(relojEspacio); relojEspacio = setTimeout(ajustarEspacio, 120); });

  function abrir() {
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.kind === 'ventas'));
    document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode');
    panel.scrollIntoView({ block: 'start' });
    requestAnimationFrame(ajustarEspacio);
    pintarCatalogo();
    vigilarCatalogo(3000);
  }

  // Eventos del panel (delegados: sobreviven a cada redibujado del formulario).

  // Botones de la tarjeta: Anular y Modificar escriben en Effi (siempre con confirmación); Enviar a producción abre REPROGRAMACIONES o PROGRAMAR.
  const NOMBRE_DOC = () => (menu.tipo === 'remision' ? 'remisión' : 'cotización');
  const PREFIJO_DOC = () => (menu.tipo === 'remision' ? 'RM' : 'CO');
  function preguntar(titulo, texto, botones) {
    return new Promise(resolver => {
      const velo = document.createElement('div');
      velo.className = 'vx-modal';
      velo.innerHTML = `<div class="vx-modal-c" role="dialog" aria-modal="true"><h4>${esc(titulo)}</h4><p>${esc(texto)}</p><div class="vx-modal-b">${botones.map(([clave, rotulo, clase]) => `<button type="button" class="vx-btn ${clase || 'vx-btn-sec'}" data-r="${clave}">${esc(rotulo)}</button>`).join('')}</div></div>`;
      const cerrar = r => { velo.remove(); resolver(r); };
      velo.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) cerrar(b.dataset.r); else if (e.target === velo) cerrar(''); });
      document.body.appendChild(velo);
    });
  }
  async function anularDocumento(d) {
    const r = await fetch('/api/ventas-effi/anular', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: menu.tipo, id: d.id, confirmado: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || 'Effi no anuló el documento');
  }
  async function accionDocumento(accion, id) {
    const d = menu.documentos.find(x => String(x.id) === String(id));
    if (!d) return;
    const nombre = `${PREFIJO_DOC()}${String(d.numero || d.id).replace(/\D/g, '')}`;
    if (accion === 'produccion') {
      const r = await preguntar(`Enviar ${nombre} a producción`, `${d.cliente || ''}: ¿es una reprogramación o un pedido nuevo?`,
        [['reprogramacion', 'Reprogramación', 'vx-btn-sec'], ['pedido', 'Pedido nuevo', ''], ['', 'Cancelar', 'vx-btn-sec']]);
      if (!r) return;
      const tab = document.querySelector(`.tab[data-kind="${r}"]`);
      if (tab) tab.click(); else decir('No encontré esa pestaña en tu menú.', 'error');
      return;
    }
    if (!d.vigente) return decir(`${nombre} ya está anulada.`, 'error');
    const esMod = accion === 'modificar';
    const ok = await preguntar(esMod ? `Modificar ${nombre}` : `Anular ${nombre}`,
      esMod ? `Se anulará ${nombre} en Effi y se abrirá el formulario con el cliente para crear una nueva ${NOMBRE_DOC()} con los datos correctos. ¿Continuar?`
            : `Se anulará ${nombre} de ${d.cliente || 'este cliente'} en Effi. Esto no se puede deshacer desde el panel. ¿Anular?`,
      [['si', esMod ? 'Anular y crear nueva' : 'Sí, anular', 'vx-btn-peligro'], ['', 'Cancelar', 'vx-btn-sec']]);
    if (ok !== 'si') return;
    try {
      decir(`Anulando ${nombre} en Effi…`);
      await anularDocumento(d);
      decir(`${nombre} anulada en Effi.`, 'ok');
      if (esMod) {
        cambiarVista('nueva');
        try {
          const rc = await fetch('/api/ventas-effi/clientes?q=' + encodeURIComponent(d.cliente || ''), { credentials: 'same-origin' });
          const lista = (await rc.json()).clientes || [];
          const x = lista.find(c => String(c.nombre).trim().toUpperCase() === String(d.cliente).trim().toUpperCase()) || lista[0];
          if (x) elegirCliente(x);
        } catch (_) { /* el formulario queda abierto para elegir el cliente a mano */ }
      }
      cargarMenu(true);
    } catch (err) {
      decir(err.message || 'No se pudo anular', 'error');
    }
  }

  function instalarEventos() {
    panel.addEventListener('click', e => {
      const vista = e.target.closest('[data-vista]');
      if (vista) return cambiarVista(vista.dataset.vista);
      const doc = e.target.closest('[data-doc]');
      if (doc) return cambiarDocumento(doc.dataset.doc);
      const filtro = e.target.closest('[data-menu-filtro]');
      if (filtro) { menu.filtro = filtro.dataset.menuFiltro; return pintarMenu(); }
      if (e.target.closest('[data-menu-actualizar]')) return cargarMenu(true);
      if (e.target.closest('[data-menu-mas]')) return cargarMenu(false);
      if (e.target.closest('[data-revisar]')) return revisar();
      const pedirT = e.target.closest('[data-pedir-tela]');
      if (pedirT) return pedirTela(Number(pedirT.dataset.pedirTela));
      if (e.target.closest('[data-ret-add]')) {
        const sel = $('[data-retention]');
        if (sel?.value && !retencionesSel.includes(sel.value)) { retencionesSel.push(sel.value); pintarRetenciones(); invalidar(); }
        return;
      }
      const retQuitar = e.target.closest('[data-ret-quitar]');
      if (retQuitar) {
        retencionesSel = retencionesSel.filter(id => id !== retQuitar.dataset.retQuitar);
        pintarRetenciones();
        return invalidar();
      }
      if (e.target.closest('[data-crear]')) return crear();
      if (e.target.closest('[data-reintentar]')) return cargar();
      if (e.target.closest('[data-catalogo-actualizar]')) {
        return pintarCatalogo(true).then(d => vigilarCatalogo(d?.ejecutando ? 3000 : 20000));
      }
      const accion = e.target.closest('[data-accion]');
      if (accion) return accionDocumento(accion.dataset.accion, accion.dataset.id);
      const pdf = e.target.closest('[data-pdf]');
      if (pdf) return verPdf(pdf.dataset.pdf);
      const quitar = e.target.closest('[data-quitar]');
      if (quitar) {
        articulos.splice(Number(quitar.dataset.quitar), 1);
        pintarArticulos();
        invalidar();
      }
    });

    panel.addEventListener('input', e => {
      const t = e.target;
      if (t.matches('[data-menu-q]')) {
        menu.q = t.value;
        return pintarMenu();
      }
      if (t.matches('[data-global]')) {
        pintarArticulos();
        return invalidar();
      }
      if (t.closest('[data-items]')) {
        const idx = t.dataset.cant ?? t.dataset.desc ?? t.dataset.nota;
        const x = articulos[Number(idx)];
        if (x) {
          if (t.dataset.cant != null) { x.cantidad = t.value; refrescarFila(x); }
          if (t.dataset.desc != null) x.descuento = t.value;
          if (t.dataset.nota != null) x.nota = t.value;
          const total = panel.querySelector(`[data-linea-total="${idx}"]`);
          if (total) total.textContent = money(calcularLinea(x).total);
          pintarTotales();
        }
      }
      invalidar();
    });

    panel.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.tax != null) {
        const x = articulos[Number(t.dataset.tax)];
        if (x) x.impuesto_id = t.value;
        pintarArticulos(Number(t.dataset.tax));
        return invalidar();
      }
      invalidar();
    });
  }

  function build() {
    const ct = document.querySelector('.tab[data-kind="cliente-effi"]');
    const cp = document.querySelector('.panel[data-panel="cliente-effi"]');
    if (!ct || !cp) return false;
    if (document.querySelector('.tab[data-kind="ventas"]')) return true;

    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.dataset.kind = 'ventas';
    tab.innerHTML = '<span class="nav-icon">VT</span><strong>VENTAS</strong>';
    ct.insertAdjacentElement('afterend', tab);

    panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.panel = 'ventas';
    panel.innerHTML = `<div class="vx">
      <div class="vx-cab">
        <div><span class="vx-kicker">COMERCIALES · EFFI</span><h2 class="vx-titulo">Ventas</h2></div>
        <div class="vx-tabs">${PESTANAS.map(([clave, texto], i) => `<button type="button" class="vx-tab${i ? '' : ' activa'}" data-doc="${clave}">${texto}</button>`).join('')}</div>
      </div>
      <section class="vx-card" data-content><p>Cargando opciones de Effi…</p></section>
    </div>`;
    cp.insertAdjacentElement('afterend', panel);
    tab.onclick = abrir;
    instalarEventos();
    cargar();
    return true;
  }

  let tries = 0;
  const reloj = setInterval(() => { if (build() || ++tries > 40) clearInterval(reloj); }, 200);
})();
