(() => {
  // PROVEEDORES DE TELA (pestaña de Estándar 2026): por cada código de tela de Bodega se elige el proveedor.
  // El agente de inventario lo usa al crear la orden de compra en Effi (Effi no rellena el proveedor al elegir la tela).
  // Una tarjeta por tela: con proveedor muestra su ficha (cambiar / quitar); sin proveedor ofrece los habituales con un toque o escribir otro.
  // Todo se guarda solo y se actualiza en el sitio (sin redibujar la pantalla ni perder el cursor).
  if (window.__proveedoresTelaListo) return;
  window.__proveedoresTelaListo = true;
  let pref = {}; try { pref = JSON.parse(localStorage.getItem('pv-vista') || '{}'); } catch (e) { /* sin almacenamiento */ }
  const st = { datos: null, buscar: '', filtro: '', cargando: false, sel: new Set(), edit: new Set(), estado: {}, reciente: '', agrupar: false, compacto: !!pref.compacto, plegadas: new Set() };
  const guardarVista = () => { try { localStorage.setItem('pv-vista', JSON.stringify({ agrupar: st.agrupar, compacto: st.compacto })); } catch (e) { /* sin almacenamiento */ } };
  let host = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function api(url, options) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No fue posible completar la acción');
    return d;
  }

  const css = document.createElement('style');
  css.textContent = `
  .pv{display:grid;gap:14px;width:100%;max-width:none;margin:0}
  .pv *{box-sizing:border-box}
  .pv-glass{border:1px solid rgba(255,255,255,.22);border-radius:18px;background:radial-gradient(120% 90% at 10% 0%,rgba(255,255,255,.16),rgba(255,255,255,0) 55%),linear-gradient(160deg,rgba(255,255,255,.12),rgba(255,255,255,.04));-webkit-backdrop-filter:blur(22px) saturate(1.4);backdrop-filter:blur(22px) saturate(1.4);box-shadow:0 14px 34px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.2)}
  .pv-head{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;padding:18px 22px}
  .pv-head small{display:block;color:#c9d3c4;letter-spacing:.2em;font-weight:800;font-size:.62rem}.pv-head h2{margin:4px 0 2px;font-size:1.4rem;letter-spacing:.02em}.pv-head p{margin:0;color:#b6c2b0;font-size:.82rem;max-width:560px}
  .pv-campos{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:10px;margin-top:12px}
  .pv-campos .pv-campo{margin-top:0}.pv-campo.falta input{border-color:#b9824a}.pv-campo.falta span{color:#ffc86b}
  .pv-kpis{display:flex;gap:10px;flex-wrap:wrap}
  .pv-kpi{position:relative;overflow:hidden;min-width:108px;padding:10px 16px;border-radius:14px;text-align:center}
  .pv-kpi b{position:relative;display:block;font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums}.pv-kpi span{position:relative;font-size:.58rem;letter-spacing:.14em;font-weight:800;color:#c9d3c4}
  .pv-kpi::before{content:"";position:absolute;left:0;bottom:0;height:var(--n,0%);width:100%;background:linear-gradient(180deg,rgba(139,212,80,.28),rgba(139,212,80,.08));transition:height .6s cubic-bezier(.2,.8,.2,1)}
  .pv-kpi.sin::before{background:linear-gradient(180deg,rgba(224,164,55,.34),rgba(224,164,55,.08))}
  .pv input{min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font-size:.92rem;width:100%;outline:none;transition:border-color .2s,box-shadow .2s}
  .pv input:focus{border-color:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(255,255,255,.1)}
  .pv-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:12px 14px}
  .pv-bar input[type=search]{flex:1;min-width:220px;width:auto}
  .pv-fil{min-height:36px;padding:0 15px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.06);color:#d3dccf;font-weight:800;font-size:.68rem;letter-spacing:.08em;cursor:pointer;width:auto!important;white-space:nowrap;transition:background .2s,transform .15s}
  .pv-fil:hover{background:rgba(255,255,255,.14);transform:translateY(-1px)}.pv-fil.on{background:rgba(255,255,255,.92);color:#10140a;border-color:#fff}
  .pv-fil.ambar.on{background:#ffc86b;border-color:#ffc86b}
  .pv-fil em{margin-left:6px;padding:1px 7px;border-radius:99px;background:rgba(255,255,255,.14);font-style:normal;font-size:.62rem}.pv-fil.on em{background:rgba(0,0,0,.14)}
  .pv-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 4px}
  .pv-masa{display:none;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-color:rgba(208,244,76,.6)!important;animation:pvIn .2s ease-out}
  .pv-masa.on{display:flex}.pv-masa b{font-size:.8rem;letter-spacing:.04em;color:#d0f44c}.pv-masa input{flex:1;min-width:200px;width:auto}
  @keyframes pvIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  .pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .pv-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:16px 16px 14px;border-radius:20px;overflow:hidden;transition:transform .2s,box-shadow .3s,border-color .3s}
  .pv-card::before{content:"";position:absolute;left:0;right:0;top:0;height:5px;background:linear-gradient(90deg,#4f9f2a,#8bd450);transition:background .3s}
  .pv-card.sin::before{background:linear-gradient(90deg,#c9821a,#ffc86b)}
  .pv-card:hover{transform:translateY(-3px);box-shadow:0 18px 36px -14px #000}
  .pv-card.sel{border-color:rgba(208,244,76,.8)}
  .pv-card.nueva{animation:pvFlash 1.1s ease-out}
  @keyframes pvFlash{0%{box-shadow:0 0 0 0 rgba(155,224,90,.75)}100%{box-shadow:0 0 0 16px rgba(155,224,90,0)}}
  .pv-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .pv-cod{font-size:1.9rem;font-weight:900;letter-spacing:.01em;line-height:1}
  .pv-top input[type=checkbox]{width:20px;min-height:20px;height:20px;padding:0;accent-color:#d0f44c;cursor:pointer}
  .pv-nom{font-size:.96rem;font-weight:800;line-height:1.25;min-height:2.4em}
  .pv-sub{font-size:.7rem;color:#aab6a5;letter-spacing:.03em}
  .pv-prov{display:grid;gap:8px;margin-top:6px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14)}
  .pv-ficha{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px 8px 14px;border-radius:12px;background:rgba(139,212,80,.14);border:1px solid rgba(139,212,80,.45)}
  .pv-ficha b{font-size:.8rem;letter-spacing:.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d6f7b0}
  .pv-ficha div{display:flex;gap:4px;flex:0 0 auto}
  .pv-mini{min-height:28px;padding:0 10px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.08);color:#e8f0e0;font:800 .62rem Arial;letter-spacing:.08em;cursor:pointer;width:auto!important;transition:background .15s}
  .pv-mini:hover{background:rgba(255,255,255,.2)}.pv-mini.rojo:hover{background:rgba(255,106,90,.3)}
  .pv-sug{display:flex;flex-wrap:wrap;gap:6px}
  .pv-sug .pv-mini{min-height:30px;padding:0 12px;font-size:.66rem}
  .pv-sin-txt{font-size:.66rem;font-weight:800;letter-spacing:.1em;color:#ffc86b}
  .pv-prov input{min-height:38px;font-size:.84rem}
  .pv-est{min-height:14px;font-size:.62rem;font-weight:800;letter-spacing:.06em;color:#b6c2b0}.pv-est.ok{color:#9be05a}.pv-est.err{color:#ff9a9d}.pv-est.guardando{color:#9db8ff}
  .pv-vacio{grid-column:1/-1;padding:30px;text-align:center;color:#b6c2b0;border-radius:16px}
  .pv-masa{display:none!important}   /* sin casillas de selección: el proveedor se asigna por tela, por familia o con una lista pegada */
  .pv-masa-chips{display:flex;gap:6px;flex-wrap:wrap}
  .pv-herr{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .pv-herr .pv-fil{min-height:34px}.pv-herr .pv-fil.on{background:rgba(208,244,76,.92);border-color:#d0f44c}
  .pv-grupos{display:grid;gap:18px}
  [data-pv-agrupar]{display:none!important}
  .pv-fam{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 10px;padding:10px 14px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16)}
  .pv-fam-t{display:flex;align-items:center;gap:10px;padding:0;border:0;background:transparent;color:#f3f8ee;font:900 1rem Arial;letter-spacing:.06em;cursor:pointer;width:auto!important}
  .pv-fam-t i{display:inline-block;transition:transform .2s;font-style:normal;color:#d0f44c}.pv-fam.cerrada .pv-fam-t i{transform:rotate(-90deg)}
  .pv-fam-t em{font:700 .7rem Arial;font-style:normal;color:#aab6a5;letter-spacing:.04em}
  .pv-fam-est{flex:1;display:flex;gap:6px;align-items:center;min-width:120px}
  .pv-fam-est span{padding:2px 9px;border-radius:99px;font:800 .62rem Arial;letter-spacing:.06em;background:rgba(139,212,80,.18);color:#b9f08a}.pv-fam-est span.sin{background:rgba(224,164,55,.2);color:#ffc86b}
  .pv-fam-barra{flex:1 1 90px;max-width:220px;height:6px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}.pv-fam-barra b{display:block;height:100%;background:linear-gradient(90deg,#4f9f2a,#8bd450);border-radius:inherit;transition:width .4s}
  .pv-fam-asig{display:flex;gap:6px;align-items:center;flex:1 1 280px;max-width:430px}.pv-fam-asig input{min-height:34px;font-size:.8rem;padding:0 12px}.pv-fam-asig .pv-mini{min-height:34px;white-space:nowrap;background:rgba(208,244,76,.9);color:#12200a;border-color:#d0f44c}
  .pv-lista{display:none;gap:10px;padding:14px;border-color:rgba(208,244,76,.5)!important;animation:pvIn .2s ease-out}.pv-lista.on{display:grid}
  .pv-lista h3{margin:0;font-size:.95rem}.pv-lista p{margin:0;color:#b6c2b0;font-size:.78rem}
  .pv-lista textarea{width:100%;min-height:130px;padding:10px 12px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(0,0,0,.28);color:inherit;font:600 .85rem Consolas,monospace;outline:none;resize:vertical}
  .pv-lista-res{font-size:.8rem;line-height:1.45;color:#dfe8d9}.pv-lista-res b{color:#d0f44c}.pv-lista-res .no{color:#ffb6af}
  .pv-grid.compacto{grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .pv-grid.compacto .pv-card{padding:10px 12px;border-radius:14px}.pv-grid.compacto .pv-card::before{height:3px}
  .pv-grid.compacto .pv-cod{font-size:1.15rem}.pv-grid.compacto .pv-nom{font-size:.78rem;min-height:0}.pv-grid.compacto .pv-sub{display:none}
  .pv-grid.compacto .pv-prov{margin-top:2px;padding-top:6px;gap:5px}.pv-grid.compacto .pv-prov input{min-height:32px;font-size:.78rem}.pv-grid.compacto .pv-est{min-height:0}.pv-grid.compacto .pv-sin-txt{display:none}
  /* cada familia es UNA tarjeta con sus telas dentro; las familias se acomodan en columnas y llenan toda la pantalla */
  .pv-grupos{display:block;columns:380px;column-gap:18px}
  .pv-fcard{display:inline-block;width:100%;margin:0 0 18px;padding:14px;border-radius:22px;break-inside:avoid;overflow:hidden}
  .pv-fcard .pv-fam{margin:0 0 12px;padding:0 0 12px;border:0;border-bottom:1px solid rgba(255,255,255,.14);border-radius:0;background:transparent;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;flex-wrap:wrap;gap:8px 10px}
  .pv-fcard .pv-fam-t{font-size:1.1rem}
  .pv-fcard .pv-fam-est{flex:1 1 140px}
  .pv-fcard .pv-fam-asig{flex:1 1 100%;max-width:none;order:5}
  .pv-fcard .pv-fam-asig{flex-wrap:wrap}.pv-fcard .pv-fam-asig input{flex:1 1 150px;min-width:0}
  .pv-ftelas{display:grid;gap:10px}
  .pv-ftelas .pv-card{padding:12px 14px 10px;border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
  .pv-ftelas .pv-card::before{height:3px}
  .pv-ftelas .pv-card:hover{transform:none;box-shadow:0 10px 24px -14px #000;border-color:rgba(255,255,255,.28)}
  .pv-ftelas .pv-cod{font-size:1.5rem}.pv-ftelas .pv-nom{font-size:.9rem;min-height:0}
  .pv-ftelas .pv-prov{margin-top:4px;padding-top:8px}
  .pv-ftelas .pv-sin-txt{display:none}
  .pv-ftelas .pv-card.sin .pv-sub::after{content:"  ·  SIN PROVEEDOR";color:#ffc86b;font-weight:800}
  .pv-ftelas .pv-ficha{padding:9px 10px 9px 14px}
  .pv-ftelas.compacto .pv-card{padding:9px 12px 8px}.pv-ftelas.compacto .pv-sub,.pv-ftelas.compacto .pv-est{display:none}.pv-ftelas.compacto .pv-cod{font-size:1.15rem}
  .pv-fam-t em{margin-left:2px}
  /* tarjeta de tela compacta e informativa: código + nombre en una línea, datos (rollos, MTS, estado) y el proveedor al pie */
  .pv-card{padding:12px 14px 10px;gap:6px}
  .pv-card .pv-top{display:flex;align-items:baseline;gap:10px}
  .pv-card .pv-cod{font-size:1.4rem;flex:0 0 auto}
  .pv-card .pv-nom{flex:1;min-width:0;min-height:0;font-size:.88rem;line-height:1.25}
  .pv-card .pv-sub{display:none}
  .pv-datos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  .pv-datos div{padding:6px 4px 5px;border-radius:10px;background:rgba(0,0,0,.24);text-align:center;min-width:0}
  .pv-datos b{display:block;font-size:.98rem;line-height:1.1;font-variant-numeric:tabular-nums;color:#f3f8ee}
  .pv-datos small{display:block;margin-top:2px;font:800 .5rem Arial;letter-spacing:.08em;color:#9fae9a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pv-meta .pv-inv{background:rgba(120,170,255,.16);color:#bcd3ff}
  .pv-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .pv-meta span{padding:2px 9px;border-radius:99px;background:rgba(255,255,255,.09);font:700 .66rem Arial;letter-spacing:.05em;color:#c9d3c4}
  .pv-meta .pv-ins{margin-left:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
  .pv-meta .pv-ins.sin{background:rgba(224,164,55,.22);color:#ffc86b}.pv-meta .pv-ins.ok{background:rgba(139,212,80,.22);color:#c6f59a}
  .pv-card .pv-prov{margin-top:2px;padding-top:8px;gap:6px}
  .pv-fila-in{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.pv-fila-in input{flex:1 1 120px;min-width:0;min-height:34px;font-size:.82rem;padding:0 12px}
  .pv-acc{display:flex;gap:6px}
  .pv-card .pv-est{min-height:0}.pv-card .pv-est:empty{display:none}
  .pv-card.sin{border-color:rgba(224,164,55,.35)}.pv-card:not(.sin){border-color:rgba(139,212,80,.35)}
  /* ---- tarjeta de tela (rediseño): barra lateral de estado, código en etiqueta, proveedor a la derecha y una sola fila de datos ---- */
  .pv-card,.pv-ftelas .pv-card{padding:10px 12px 10px 17px;gap:7px;border-radius:14px}
  .pv-card::before,.pv-ftelas .pv-card::before{top:0;bottom:0;left:0;right:auto;width:5px;height:auto;background:linear-gradient(180deg,#9be05a,#4f9f2a)}
  .pv-card.sin::before,.pv-ftelas .pv-card.sin::before{background:linear-gradient(180deg,#ffc86b,#c9821a)}
  .pv-card .pv-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
  .pv-card .pv-cod{font-size:.82rem;font-weight:900;padding:3px 9px;border-radius:8px;background:rgba(255,255,255,.13);letter-spacing:.04em;line-height:1.3}
  .pv-card .pv-nom{flex:1 1 140px;min-width:0;font-size:.92rem;font-weight:800;line-height:1.2}
  .pv-estado{display:flex;align-items:center;gap:5px;margin-left:auto;max-width:100%}
  .pv-pill{padding:4px 11px;border-radius:99px;font:800 .64rem Arial;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
  .pv-pill.ok{background:rgba(139,212,80,.2);color:#c6f59a}.pv-pill.sin{background:rgba(224,164,55,.22);color:#ffc86b}
  .pv-ico{width:26px!important;height:26px;min-height:26px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#dfe8d9;font-size:.78rem;line-height:1;cursor:pointer}
  .pv-ico:hover{background:rgba(255,255,255,.2)}.pv-ico.rojo:hover{background:rgba(255,106,90,.3)}
  .pv-stats{display:flex;flex-wrap:wrap;gap:3px 16px;font-size:.72rem;color:#9fae9a}.pv-stats b{color:#f3f8ee;font-size:.85rem}
  .pv-uso{display:grid;gap:3px}.pv-uso i{display:block;height:5px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
  .pv-uso i b{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#6aa8ff,#9cc4ff)}.pv-uso small{font-size:.62rem;color:#9fb4d6;letter-spacing:.03em}
  .pv-aviso{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.7rem;color:#bcd3ff}.pv-aviso b{color:#dbe8ff}
  .pv-mini.inv{border-color:rgba(120,170,255,.65);color:#c9dcff}
  .pv-card .pv-prov{margin-top:0;padding-top:7px;border-top:1px solid rgba(255,255,255,.1)}
  /* ---- MISMO ESTILO QUE LAS TARJETAS DE PRODUCCIÓN: fondo plano verde oscuro, borde superior de estado, etiqueta rectangular, datos en lista y botones de acción ---- */
  .pv-glass{background:#18251d!important;border:1px solid #3a4a40!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  .pv-fcard{background:#121d17!important;border-color:#35473b!important;border-radius:22px}
  .pv-fcard .pv-fam{background:transparent!important;border:0!important;border-bottom:1px solid #35473b!important}
  .pv-kpi::before{display:none}.pv-kpi{background:#1d2b23!important}
  .pv-fil{border-radius:8px;background:#1d2b23;border-color:#4a5b4e;color:#e0eddf}.pv-fil.on{background:#d0ec93;color:#1c2b13;border-color:#d0ec93}.pv-fil.ambar.on{background:#f3b852;border-color:#f3b852;color:#332306}
  .pv-fam-est span{border-radius:6px;background:#8bdbaf;color:#103423;font-weight:700}.pv-fam-est span.sin{background:#f3b852;color:#332306}
  .pv-fam-asig .pv-mini{border-radius:8px;background:#d0ec93;border-color:#d0ec93;color:#1c2b13}
  .pv-card,.pv-ftelas .pv-card{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:16px;background:#18251d!important;border:1px solid #3a4a40!important;border-top:3px solid #8bdbaf!important;box-shadow:none!important;font-family:Arial,sans-serif}
  .pv-card.sin,.pv-ftelas .pv-card.sin{border-top-color:#f3b852!important}
  .pv-card::before,.pv-ftelas .pv-card::before{display:none!important}
  .pv-card:hover,.pv-ftelas .pv-card:hover{transform:none;box-shadow:none!important;border-color:#4a5b4e!important}
  .pv-th{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
  .pv-th h3{margin:0;font:700 19px/1.2 Arial;letter-spacing:-.4px;flex:1 1 150px;min-width:0;overflow-wrap:anywhere;color:#f3f8ee}
  .pv-stage{display:inline-block;font:600 12px/1.4 Arial;border-radius:6px;padding:5px 9px;border:1px solid transparent;white-space:nowrap}
  .pv-stage.fin{background:#8bdbaf;color:#103423;border-color:#8bdbaf}.pv-stage.act{background:#f3b852;color:#332306;border-color:#f3b852}
  .pv-cod-line{font:13px/1.4 Arial;color:#a4b7aa;margin-top:-6px}
  .pv-campo{display:grid;gap:5px;margin-top:auto}.pv-campo span{font:12px/1.5 Arial;color:#a6b7ab}
  .pv-campo input{box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:0 12px;border:1px solid #4a5b4e;border-radius:8px;background:#1d2b23;color:#e0eddf;font:600 14px Arial;outline:none}
  .pv-campo input:focus{border-color:#d0ec93;box-shadow:0 0 0 2px rgba(208,236,147,.18)}
  .pv-card:not(.sin) .pv-campo input{border-color:#5f8f69;color:#d9ffd4}
  .pv-dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:12px 14px;margin:0}
  .pv-acciones>*{min-width:0}.pv-card{min-width:0;overflow:hidden}
  .pv-dl>div{min-width:0}.pv-dl dt{font:12px/1.5 Arial;color:#a6b7ab;margin:0 0 3px}.pv-dl dd{margin:0;font:500 14px/1.4 Arial;color:#eef5ed;overflow-wrap:anywhere}
  .pv-dl .pv-full{grid-column:1/-1}.pv-dl .pv-nada{color:#afbbb3}.pv-dl .pv-prov-n{font-weight:700;color:#d9ffd4}
  .pv-progress{height:3px;border-radius:4px;background:#334238}.pv-progress>span{display:block;height:100%;background:#83dca4;border-radius:inherit}
  .pv-cap{font:12px/1.4 Arial;color:#a4b7aa;margin-top:-6px}
  .pv-acciones{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-top:auto}
  .pv-acciones input{grid-column:1/-1;box-sizing:border-box;max-width:100%;min-width:0;min-height:42px;border:1px solid #4a5b4e;border-radius:8px;background:#1d2b23;color:#e0eddf;font:600 13px Arial;padding:0 12px;width:100%}
  .pv-btn{min-height:42px;padding:10px 9px;border:1px solid #4a5b4e;border-radius:8px;background:#1d2b23;color:#e0eddf;font:600 12px Arial;cursor:pointer;width:auto!important}
  .pv-btn:hover{border-color:#6f8a76}.pv-btn.pri{background:#d0ec93;color:#1c2b13;border-color:#d0ec93}.pv-btn.rojo:hover{background:#542a2a;border-color:#f47d78}
  .pv-acciones .full{grid-column:1/-1}
  .pv-card .pv-est{min-height:0;font:600 12px Arial}.pv-card .pv-est:empty{display:none}
  /* TARJETA DE TELA: ficha ordenada (nombre, filas etiqueta + dato y existencias abajo) */
  .pv-card.pv-t,.pv-ftelas .pv-card.pv-t{gap:0;padding:0;border-radius:14px;background:#16231b!important;border:1px solid #33463a!important;border-top:3px solid #8bdbaf!important;overflow:hidden}
  .pv-card.pv-t.sin{border-top-color:#f3b852!important}
  .pv-grid{grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px}
  .pv-card.pv-t{transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .25s,border-color .25s}
  .pv-card.pv-t:hover{transform:translateY(-5px)!important;box-shadow:0 22px 40px -18px #000!important;border-color:#55705c!important}
  .pv-card.pv-t:focus-within{border-color:#d0ec93!important;box-shadow:0 0 0 2px rgba(208,236,147,.18),0 22px 40px -18px #000!important}
  .pt-head{display:flex;align-items:center;gap:12px;padding:20px 22px;border-bottom:1px solid #28382e}
  .pt-nom{margin:0;flex:1;min-width:0;font:800 21px/1.2 Arial;color:#f3f8ee;text-transform:uppercase;overflow-wrap:anywhere}
  .pt-n{flex:0 0 auto;font:800 14px/1 Arial;padding:8px 13px;border-radius:999px;background:#f3b852;color:#332306}.pt-n.ok{background:#8bdbaf;color:#103423}
  .pt-form{display:grid;padding:8px 22px}
  .pt-row{display:grid;grid-template-columns:112px minmax(0,1fr);align-items:center;gap:12px;min-height:62px;margin:0;border-bottom:1px solid #223128;transition:background .2s}
  .pt-row:hover{background:rgba(255,255,255,.03)}
  .pt-chips{display:none;flex-wrap:wrap;gap:6px;padding:0 0 12px 124px}
  .pt-row:focus-within+.pt-chips,.pt-chips:hover{display:flex;animation:ptIn .18s ease-out}
  .pt-chips button{font:700 12px/1 Arial;padding:8px 12px;border-radius:999px;border:1px solid #3f5a46;background:#122018;color:#cfe8d3;cursor:pointer;transition:background .15s,transform .15s}
  .pt-chips button:hover{background:#d0ec93;color:#14210f;transform:translateY(-1px)}
  @media(max-width:700px){.pt-nom{font-size:18px}.pt-head{padding:16px}.pt-form{padding:6px 16px}.pt-stats b{font-size:clamp(17px,6vw,24px)}.pt-nom{overflow-wrap:break-word;hyphens:auto}}
  .pt-val{font:700 17px/1.3 Arial;color:#eef5ed;overflow-wrap:anywhere;cursor:text}.pt-val.vacio{color:#ffc86b;font-weight:700;font-size:15px}
  .pt-lapiz{flex:0 0 auto;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid #3f5a46;background:#122018;color:#cfe8d3;cursor:pointer;padding:0;transition:background .18s,color .18s,transform .18s}
  .pt-lapiz:hover{background:#d0ec93;color:#14210f;transform:rotate(-12deg) scale(1.08)}.pt-lapiz.pri{border-color:#d0ec93;color:#d0ec93}
  .pt-acc{display:flex;gap:10px;padding:4px 22px 18px}
  .pt-b{flex:1;white-space:nowrap;padding:0 8px;height:46px;border-radius:12px;border:1px solid #3f5a46;background:#122018;color:#e3f1e6;font:800 13px/1 Arial;letter-spacing:.06em;cursor:pointer;transition:background .18s,transform .18s,box-shadow .18s}
  .pt-b:hover{background:#1b3024;transform:translateY(-2px)}.pt-b:active{transform:none}
  .pt-b.pri{background:#d0ec93;border-color:#d0ec93;color:#14210f}.pt-b.pri:hover{background:#e0f6aa;box-shadow:0 10px 22px -10px #d0ec93}
  .pv-card.pv-t.editando{border-color:#d0ec93!important;box-shadow:0 0 0 2px rgba(208,236,147,.2),0 22px 40px -18px #000!important}
  .pv-card.pv-t.editando .pt-n{background:#d0ec93;color:#14210f}
  @media(max-width:700px){.pt-acc{padding:4px 16px 16px}}
  @keyframes ptIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .pt-row:last-child{border-bottom:0}
  @media(max-width:360px){.pt-row{grid-template-columns:1fr;gap:4px;padding:8px 0}.pt-row.fijo{grid-template-columns:1fr auto}.pt-chips{padding-left:0}}
  .pt-lbl{font:700 14px/1.2 Arial;color:#a4b7aa}.pt-lbl b{color:#ffc86b;margin-left:3px}
  .pt-row.falta .pt-lbl{color:#ffc86b}
  .pt-cod{justify-self:start;font:800 26px/1 Arial;color:#d0ec93;letter-spacing:.04em;background:transparent;border:1px dashed transparent;border-radius:8px;padding:4px 8px;margin-left:-8px;cursor:copy;transition:border-color .2s,background .2s}
  .pt-cod:hover{border-color:#5f8f69;background:#0e1812}.pt-cod.copiado{background:#8bdbaf;color:#103423}.pt-cod.copiado::after{content:" ✓ copiado";font:700 11px Arial}
  .pt-row input{width:100%;box-sizing:border-box;height:44px;padding:0 13px;border-radius:10px;border:1px solid #3a4a40;background:#0e1812;color:#eef5ed;font:700 16px Arial;outline:0;transition:border-color .2s,box-shadow .2s}
  .pt-row input::placeholder{color:#6f8276;font-weight:400}
  .pt-row input:focus{border-color:#d0ec93;box-shadow:0 0 0 2px rgba(208,236,147,.15)}
  .pt-row.falta input{border-color:#b9824a}
  .pt-row:not(.falta):not(.fijo) input:not([data-pv-ide]){border-color:#4d7a58;color:#d9ffd4}
  .pt-stats{display:grid;grid-template-columns:repeat(3,1fr);background:#0e1812;border-top:1px solid #28382e}
  .pt-stats>div{padding:18px 10px 14px;text-align:center;border-right:1px solid #223128;transition:background .2s}.pt-stats>div:last-child{border-right:0}
  .pt-stats>div:hover{background:#142218}
  .pt-stats b{display:block;font:800 30px/1.1 Arial;color:#f3f8ee;font-variant-numeric:tabular-nums}
  .pt-stats span{display:block;margin-top:6px;font:700 11px/1.3 Arial;letter-spacing:.06em;text-transform:uppercase;color:#8fa596}
  .pv-card.pv-t .pv-progress>span{transition:width .8s cubic-bezier(.2,.8,.2,1)}
  .pv-card.pv-t .pv-progress{height:5px;margin:0;border-radius:0;background:#223128}
  .pv-card.pv-t .pv-est{padding:0 16px}.pv-card.pv-t .pv-est:not(:empty){padding:8px 16px}
  @media(max-width:700px){.pv-grupos{columns:1}.pv-head{padding:16px}.pv-head h2{font-size:1.2rem}.pv-kpis{width:100%}.pv-kpi{flex:1;min-width:0;padding:8px}.pv-bar input[type=search]{min-width:0;width:100%;flex-basis:100%}.pv input{font-size:16px}.pv-grid{grid-template-columns:1fr}.pv-cod{font-size:1.6rem}.pv-herr{width:100%}.pv-herr .pv-fil,.pv-masa-chips .pv-fil{white-space:normal;flex:1 1 100%;text-align:center;line-height:1.2;padding:8px 12px}.pv-masa{bottom:8px}}
  `;
  document.head.appendChild(css);

  const telas = () => (st.datos && st.datos.telas) || [];
  const cuentaProv = () => { const c = {}; telas().forEach(t => { if (t.proveedor) c[t.proveedor] = (c[t.proveedor] || 0) + 1; }); return c; };
  const habituales = () => { const c = cuentaProv(); return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)); };
  const visibles = () => {
    const q = plano(st.buscar);
    return telas().filter(t => (!st.filtro || (st.filtro === '__sin' ? !(t.proveedor && t.ancho) : t.proveedor === st.filtro)) && (!q || plano(t.codigo + ' ' + t.nombre + ' ' + t.proveedor).includes(q)));
  };
  const q1 = s => host.querySelector(s);

  function contar(el, hasta) {
    const desde = Number(el.dataset.v || 0); el.dataset.v = hasta;
    if (desde === hasta) { el.textContent = hasta; return; }
    const t0 = performance.now();
    (function paso(t) { const p = Math.min(1, (t - t0) / 450); el.textContent = Math.round(desde + (hasta - desde) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(paso); })(t0);
  }
  function pintarKpis() {
    const total = telas().length, sin = telas().filter(t => !(t.proveedor && t.ancho)).length, con = total - sin;
    const f = (k, n) => { const c = q1('[data-kpi="' + k + '"]'); if (!c) return; contar(c.querySelector('b'), n); c.style.setProperty('--n', total ? Math.round(n / total * 100) + '%' : '0%'); };
    f('total', total); f('con', con); f('sin', sin);
  }
  function pintarChips() {
    const c = cuentaProv(), total = telas().length, sin = telas().filter(t => !(t.proveedor && t.ancho)).length;
    const chip = (k, txt, n, extra) => `<button type="button" class="pv-fil${extra || ''}${st.filtro === k ? ' on' : ''}" data-pv-filtro="${esc(k)}">${esc(txt)}<em>${n}</em></button>`;
    q1('.pv-chips').innerHTML = chip('', 'TODAS', total) + chip('__sin', 'INCOMPLETAS', sin, ' ambar') + habituales().map(n => chip(n, n, c[n])).join('');
    q1('#pv-proveedores').innerHTML = habituales().map(n => `<option value="${esc(n)}">`).join('');
    q1('.pv-masa-chips').innerHTML = habituales().slice(0, 6).map(n => `<button type="button" class="pv-fil on" data-pv-masa-poner="${esc(n)}">ASIGNAR ${esc(n)}</button>`).join('');
    const ag = q1('[data-pv-agrupar]'), co = q1('[data-pv-compacto]'); if (ag) ag.classList.toggle('on', st.agrupar); if (co) co.classList.toggle('on', st.compacto);
    const ns = q1('[data-pv-selsin]'); if (ns) ns.textContent = 'SELECCIONAR LAS SIN PROVEEDOR (' + visibles().filter(t => !t.proveedor).length + ')';
  }
  const anchosHabituales = () => {
    const c = {}; telas().forEach(t => { if (t.ancho) c[t.ancho] = (c[t.ancho] || 0) + 1; });
    const usados = Object.keys(c).sort((a, b) => c[b] - c[a]);
    return [...new Set([...usados, '150', '160', '170', '180'])].slice(0, 5);
  };
  // Atajos que aparecen al tocar el campo (proveedores y anchos más usados): un toque llena y guarda
  const sugerencias = (tipo, lista) => lista.length ? `<div class="pt-chips">${lista.map(v => `<button type="button" data-pv-chip="${tipo}" data-v="${esc(v)}">${esc(v)}${tipo === 'ancho' ? ' cm' : ''}</button>`).join('')}</div>` : '';
  function tarjetaHtml(t) {
    const e = st.estado[t.codigo] || {};
    const editando = st.edit.has(t.codigo) || !t.proveedor;
    const sug = habituales().filter(n => n !== t.proveedor).slice(0, 2);
    const rollos = t.rollos_reales || t.rollos || 0, mts = Math.round(Number(t.mts) || 0), ped = t.uso_pedidos || 0, uso = Math.round(t.uso_mts || 0);
    const pct = mts > 0 ? Math.min(100, Math.round(uso / mts * 100)) : 0, f0 = n => Number(n).toLocaleString('es-CO');
    const sugInv = t.prov_inventario && !/\s-\s/.test(t.prov_inventario) ? t.prov_inventario : '';   // lo que dice el inventario (si no son varios juntos)
    const rapidos = [...new Set([sugInv, ...sug].filter(n => n && n !== t.proveedor))].slice(0, 3);
    const falta = !t.proveedor ? (t.ancho ? 'FALTA PROVEEDOR' : 'FALTAN PROVEEDOR Y ANCHO') : (!t.ancho ? 'FALTA ANCHO' : '');
    const listos = 2 + (t.proveedor ? 1 : 0) + (t.ancho ? 1 : 0);
    const edit = st.edit.has(t.codigo);   // por defecto la tarjeta se ve limpia; el botón EDITAR abre los campos
    const fila = (cod, etiqueta, valor, atrib, req, falto, ayuda, sufijo) => edit
      ? `<label class="pt-row${falto ? ' falta' : ''}"><span class="pt-lbl">${etiqueta}${req ? '<b>*</b>' : ''}</span>` +
        `<input type="text" ${atrib} value="${esc(valor || '')}" placeholder="${esc(ayuda)}" autocomplete="off"${req ? ' required' : ''}></label>`
      : `<div class="pt-row${falto ? ' falta' : ''}"><span class="pt-lbl">${etiqueta}${req ? '<b>*</b>' : ''}</span>` +
        `<span class="pt-val${valor ? '' : ' vacio'}" data-pv-dbl title="Doble toque para editar">${valor ? esc(valor) + (sufijo || '') : (req ? '⚠ Falta' : '—')}</span></div>`;
    const acciones = edit
      ? '<div class="pt-acc"><button type="button" class="pt-b pri" data-pv-guardar>✓ GUARDAR</button><button type="button" class="pt-b" data-pv-cancelar>CANCELAR</button></div>'
      : '';
    const lapiz = edit ? '' : `<button type="button" class="pt-lapiz${falta ? ' pri' : ''}" data-pv-editar title="Editar tarjeta" aria-label="Editar tarjeta"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>`;
    return `<div class="pv-card pv-t${falta ? ' sin' : ''}${edit ? ' editando' : ''}${st.reciente === t.codigo ? ' nueva' : ''}" data-cod="${esc(t.codigo)}">` +
      `<div class="pt-head"><h3 class="pt-nom">${esc(t.nombre)}</h3><span class="pt-n${falta ? '' : ' ok'}" title="${falta ? esc(falta) : 'Los 4 datos obligatorios están completos'}">${listos}/4</span>${lapiz}</div>` +
      `<div class="pt-form"><div class="pt-row fijo"><span class="pt-lbl">Código<b>*</b></span><button type="button" class="pt-cod" data-pv-copiar title="Tocar para copiar el código">${esc(t.codigo)}</button></div>` +
      fila(t.codigo, 'Proveedor', t.proveedor, 'list="pv-proveedores" data-pv-input', true, !t.proveedor, 'Escribe el proveedor…') +
      (edit ? sugerencias('prov', habituales().slice(0, 5)) : '') +
      fila(t.codigo, 'Ancho (cm)', t.ancho, 'inputmode="decimal" data-pv-ancho', true, !t.ancho, 'Ej. 150', ' cm') +
      (edit ? sugerencias('ancho', anchosHabituales()) : '') +
      fila(t.codigo, 'ID Effi', t.id_effi, 'inputmode="numeric" data-pv-ide', false, false, 'Opcional') + '</div>' + acciones +
      `<div class="pt-stats"><div><b>${f0(mts)}</b><span>MTS en bodega</span></div><div><b>${f0(rollos)}</b><span>Rollos</span></div><div><b>${f0(uso)}</b><span>MTS en ${f0(ped)} pedidos</span></div></div>` +
      (uso > 0 ? `<div class="pv-progress" title="${pct}% de la bodega está comprometida en pedidos"><span style="width:${pct}%"></span></div>` : '') +
      `<div class="pv-est ${esc(e.c || '')}" data-pv-est>${esc(e.t || '')}</div></div>`;
  }
  const familia = n => (String(n || '').toUpperCase().replace(/\(.*?\)/g, ' ').trim().split(/\s+/)[0]) || 'OTRAS';
  function cabeceraFam(f, lista) {
    const con = lista.filter(t => t.proveedor).length, sin = lista.length - con, cerrada = st.plegadas.has(f);
    const todas = lista.every(t => st.sel.has(t.codigo));
    return `<div class="pv-fam pv-glass${cerrada ? ' cerrada' : ''}" data-fam="${esc(f)}"><button type="button" class="pv-fam-t" data-pv-plegar="${esc(f)}"><i>▾</i>${esc(f)}<em>${lista.length} ${lista.length === 1 ? 'tela' : 'telas'}</em></button>` +
      `<div class="pv-fam-est"><div class="pv-fam-barra"><b style="width:${Math.round(con / lista.length * 100)}%"></b></div>${con ? `<span>${con} CON</span>` : ''}${sin ? `<span class="sin">${sin} SIN</span>` : ''}</div>` +
      (lista.length > 1 ? `<div class="pv-fam-asig"><input type="text" list="pv-proveedores" data-pv-fam-input="${esc(f)}" placeholder="Proveedor para las ${lista.length} telas…" autocomplete="off"><button type="button" class="pv-mini" data-pv-fam-aplicar="${esc(f)}">APLICAR A TODAS</button></div>` : '') + '</div>';
  }
  function refrescarCabeceras() {
    const g = {}; visibles().forEach(t => { (g[familia(t.nombre)] = g[familia(t.nombre)] || []).push(t); });
    host.querySelectorAll('.pv-fam').forEach(h => { const f = h.dataset.fam; if (g[f]) h.outerHTML = cabeceraFam(f, g[f]); });
  }
  function pintarGrid() {
    const l = visibles(), cont = q1('#pv-cont');
    if (!l.length) cont.innerHTML = '<div class="pv-vacio pv-glass">No hay telas con ese filtro.</div>';
    else if (!st.agrupar) cont.innerHTML = `<div class="pv-grid${st.compacto ? ' compacto' : ''}">` + l.map(tarjetaHtml).join('') + '</div>';
    else {
      const g = {}; l.forEach(t => { (g[familia(t.nombre)] = g[familia(t.nombre)] || []).push(t); });
      cont.innerHTML = '<div class="pv-grupos">' + Object.keys(g).sort().map(f => '<section class="pv-fcard pv-glass">' + cabeceraFam(f, g[f]) + (st.plegadas.has(f) ? '' : `<div class="pv-ftelas${st.compacto ? ' compacto' : ''}">` + g[f].map(tarjetaHtml).join('') + '</div>') + '</section>').join('') + '</div>';
    }
    st.reciente = '';
    pintarMasa();
  }
  function pintarMasa() {
    const n = st.sel.size;
    q1('.pv-masa').classList.toggle('on', n > 0);
    q1('[data-pv-nsel]').textContent = n + (n === 1 ? ' tela seleccionada' : ' telas seleccionadas');
  }
  function cambiarTarjeta(cod) {
    const t = telas().find(x => x.codigo === cod), viejo = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"]');
    if (!t || !viejo) return;
    const enFiltro = visibles().some(x => x.codigo === cod);
    if (!enFiltro) { viejo.style.transition = 'opacity .3s,transform .3s'; viejo.style.opacity = '0'; viejo.style.transform = 'scale(.94)'; setTimeout(() => { if (!visibles().some(x => x.codigo === cod)) viejo.remove(); }, 320); return; }
    const tmp = document.createElement('div'); tmp.innerHTML = tarjetaHtml(t); viejo.replaceWith(tmp.firstElementChild);
    st.reciente = '';
  }
  function pintar() {
    if (!host) return;
    if (!st.datos) { host.innerHTML = '<div class="pv-vacio">Cargando telas…</div>'; return; }
    if (!q1('#pv-cont')) {
      host.innerHTML = '<div class="pv-head pv-glass"><div><small>ESTÁNDAR 2026</small><h2>INFORMACIÓN TELA</h2><p>Una tarjeta por tela: elige su proveedor con un toque o escribe otro. Se guarda solo y el agente de inventario lo usa al crear la orden de compra.</p></div>' +
        '<div class="pv-kpis"><div class="pv-kpi pv-glass" data-kpi="total"><b>0</b><span>TELAS</span></div><div class="pv-kpi pv-glass" data-kpi="con"><b>0</b><span>COMPLETAS</span></div><div class="pv-kpi pv-glass sin" data-kpi="sin"><b>0</b><span>INCOMPLETAS</span></div></div></div>' +
        '<div class="pv-bar pv-glass"><input type="search" data-pv-buscar placeholder="Buscar código, tela o proveedor" value="' + esc(st.buscar) + '"><div class="pv-herr"><button type="button" class="pv-fil" data-pv-agrupar>AGRUPAR POR TELA</button><button type="button" class="pv-fil" data-pv-compacto>VISTA COMPACTA</button><button type="button" class="pv-fil ambar" data-pv-inv>TRAER LOS PROVEEDORES DEL INVENTARIO</button><button type="button" class="pv-fil" data-pv-pegar>PEGAR LISTA DE PROVEEDORES</button></div></div>' +
        '<div class="pv-lista pv-glass"><h3>Pegar lista de proveedores</h3><p>Una línea por tela o familia, con dos puntos: <b>MONTECATINI: LINDATEXTIL</b> o <b>100: LINDATEXTIL</b>. Puedes pegarla desde Excel (dos columnas).</p><textarea data-pv-texto placeholder="MONTECATINI: LINDATEXTIL&#10;DIAMANTE: OTRO PROVEEDOR&#10;700: OTRO"></textarea><div class="pv-lista-res" data-pv-res></div><div class="pv-herr"><button type="button" class="pv-fil" data-pv-lista-ver>VER LOS CAMBIOS</button><button type="button" class="pv-fil on" data-pv-lista-ok disabled>APLICAR</button></div></div>' +
        '<div class="pv-chips"></div>' +
        '<div class="pv-masa pv-glass"><b data-pv-nsel></b><div class="pv-masa-chips"></div><input type="text" list="pv-proveedores" data-pv-masa placeholder="…o escribe otro proveedor" autocomplete="off"><button type="button" class="pv-fil on" data-pv-masa-ok>ASIGNAR</button><button type="button" class="pv-fil" data-pv-masa-no>QUITAR SELECCIÓN</button></div>' +
        '<datalist id="pv-proveedores"></datalist><div id="pv-cont"></div>';
    }
    pintarKpis(); pintarChips(); pintarGrid();
  }

  async function cargar() {
    if (st.cargando) return;
    st.cargando = true;
    try { st.datos = await api('/api/proveedores-tela'); }
    catch (e) { host.innerHTML = '<div class="pv-vacio">' + esc(e.message) + '</div>'; st.cargando = false; return; }
    st.cargando = false;
    pintar();
  }

  function estado(cod, c, t) {
    st.estado[cod] = { c, t };
    const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]');
    if (e) { e.className = 'pv-est ' + c; e.textContent = t; }
  }
  async function guardar(cod, prov) {
    prov = String(prov || '').trim();
    const t = telas().find(x => x.codigo === cod);
    if (!t) return false;
    if (t.proveedor === prov) { st.edit.delete(cod); cambiarTarjeta(cod); return true; }
    estado(cod, 'guardando', 'Guardando…');
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify({ codigo: cod, proveedor: prov }) });
      t.proveedor = prov; st.edit.delete(cod); st.reciente = cod;
      st.estado[cod] = { c: 'ok', t: prov ? '✓ Guardado' : '✓ Proveedor quitado' };
      cambiarTarjeta(cod); pintarKpis(); pintarChips(); if (st.agrupar) refrescarCabeceras();
      setTimeout(() => { if ((st.estado[cod] || {}).c === 'ok') { delete st.estado[cod]; const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]'); if (e) { e.className = 'pv-est'; e.textContent = ''; } } }, 2200);
      return true;
    } catch (e) { estado(cod, 'err', e.message); return false; }
  }
  const guardarAncho = (cod, v) => guardarCampo(cod, 'ancho', v);
  async function guardarCampo(cod, campo, valor) {
    const nom = campo === 'ancho' ? 'Ancho' : 'ID Effi';
    let ancho = String(valor || '').trim(); if (campo === 'ancho') ancho = ancho.replace(',', '.');
    const t = telas().find(x => x.codigo === cod);
    if (!t || (t[campo] || '') === ancho.replace(campo === 'ancho' ? /\.0+$/ : /$^/, '')) return true;
    estado(cod, 'guardando', 'Guardando…');
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify({ codigo: cod, [campo]: ancho }) });
      t[campo] = ancho && campo === 'ancho' ? String(Number(ancho)) : ancho; st.reciente = cod;
      st.estado[cod] = { c: 'ok', t: ancho ? '✓ ' + nom + ' guardado' : '✓ ' + nom + ' quitado' };
      cambiarTarjeta(cod); pintarKpis(); pintarChips();
      setTimeout(() => { if ((st.estado[cod] || {}).c === 'ok') { delete st.estado[cod]; const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]'); if (e) { e.className = 'pv-est'; e.textContent = ''; } } }, 2200);
      return true;
    } catch (e) { estado(cod, 'err', e.message); return false; }
  }
  function abrirEdicion(cod) {
    st.edit.add(cod); cambiarTarjeta(cod);
    const tj = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"]');
    const vacio = tj && [...tj.querySelectorAll('.pt-row input')].find(i => !i.value && i.required);
    (vacio || (tj && tj.querySelector('.pt-row input')) || { focus() {} }).focus();
  }
  // Guarda de una vez proveedor, ancho e ID Effi de la tarjeta en edición
  async function guardarTodo(cod) {
    const tj = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"]'), t = telas().find(x => x.codigo === cod);
    if (!tj || !t) return false;
    const v = s => (tj.querySelector(s) || { value: '' }).value.trim();
    const cuerpo = { codigo: cod, proveedor: v('[data-pv-input]'), ancho: v('[data-pv-ancho]').replace(',', '.'), id_effi: v('[data-pv-ide]') };
    estado(cod, 'guardando', 'Guardando…');
    try {
      await api('/api/proveedores-tela', { method: 'PUT', body: JSON.stringify(cuerpo) });
      t.proveedor = cuerpo.proveedor; t.ancho = cuerpo.ancho ? String(Number(cuerpo.ancho)) : ''; t.id_effi = cuerpo.id_effi;
      st.edit.delete(cod); st.reciente = cod; st.estado[cod] = { c: 'ok', t: '✓ Guardado' };
      cambiarTarjeta(cod); pintarKpis(); pintarChips();
      setTimeout(() => { if ((st.estado[cod] || {}).c === 'ok') { delete st.estado[cod]; const e = host.querySelector('.pv-card[data-cod="' + CSS.escape(cod) + '"] [data-pv-est]'); if (e) { e.className = 'pv-est'; e.textContent = ''; } } }, 2200);
      return true;
    } catch (e) { estado(cod, 'err', e.message); return false; }
  }
  async function aplicarMasa(dado) {
    const prov = String(dado || q1('[data-pv-masa]').value).trim(); if (!prov) { q1('[data-pv-masa]').focus(); return; }
    const boton = q1('[data-pv-masa-ok]'); boton.disabled = true;
    for (const c of [...st.sel]) { if (await guardar(c, prov)) st.sel.delete(c); }
    boton.disabled = false; q1('[data-pv-masa]').value = '';
    pintarGrid();
  }

  // ---- asignar a toda una familia y cargar una lista pegada ----
  const telasDe = f => telas().filter(t => familia(t.nombre) === f);
  async function asignarVarias(lista, prov, boton) {
    let hechas = 0;
    for (const t of lista) { if (await guardar(t.codigo, prov)) hechas++; if (boton) boton.textContent = hechas + ' / ' + lista.length; }
    return hechas;
  }
  async function aplicarFamilia(f, boton) {
    const campo = host.querySelector('[data-pv-fam-input="' + CSS.escape(f) + '"]'), prov = String((campo && campo.value) || '').trim().toUpperCase();
    if (!prov) { if (campo) campo.focus(); return; }
    const lista = telasDe(f), otros = lista.filter(t => t.proveedor && t.proveedor !== prov);
    if (otros.length && !confirm(otros.length + (otros.length === 1 ? ' tela de ' : ' telas de ') + f + ' ya tiene otro proveedor y quedará con ' + prov + '.\n¿Continuar?')) return;
    boton.disabled = true;
    await asignarVarias(lista.filter(t => t.proveedor !== prov), prov, boton);
    pintarGrid();
  }
  function analizarLista() {
    const res = q1('[data-pv-res]'), ok = q1('[data-pv-lista-ok]'), cambios = new Map(), noHalladas = [];
    q1('[data-pv-texto]').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      const m = l.match(/^(.+?)\s*(?::|\t|;|=|\s-\s)\s*(.+)$/);
      const clave = m ? plano(m[1]).trim() : '', prov = m ? m[2].trim().toUpperCase() : '';
      const halladas = clave ? telas().filter(t => plano(t.codigo) === clave || plano(familia(t.nombre)) === clave || plano(t.nombre) === clave) : [];
      if (!m || !prov || !halladas.length) { noHalladas.push(l); return; }
      halladas.forEach(t => cambios.set(t.codigo, prov));
    });
    st.pendientes = [...cambios.entries()].filter(([cod, prov]) => (telas().find(t => t.codigo === cod) || {}).proveedor !== prov);
    const pisan = st.pendientes.filter(([cod]) => (telas().find(t => t.codigo === cod) || {}).proveedor).length;
    res.innerHTML = (st.pendientes.length ? 'Se asignará proveedor a <b>' + st.pendientes.length + ' telas</b>' + (pisan ? ' (' + pisan + ' ya tenían otro y se cambian)' : '') + '.' : 'No hay cambios por hacer.') +
      (noHalladas.length ? '<br><span class="no">No encontré: ' + noHalladas.map(esc).join(' · ') + '</span>' : '');
    ok.disabled = !st.pendientes.length;
  }
  async function aplicarLista(boton) {
    const lista = st.pendientes || [];
    if (!lista.length) return;
    boton.disabled = true; let n = 0;
    for (const [cod, prov] of lista) { if (await guardar(cod, prov)) n++; boton.textContent = n + ' / ' + lista.length; }
    st.pendientes = null; boton.textContent = 'APLICAR';
    q1('[data-pv-texto]').value = ''; q1('[data-pv-res]').innerHTML = '<b>' + n + '</b> telas actualizadas.';
    pintarGrid();
  }

  window.proveedoresTelaPintar = el => {
    if (host !== el) {
      host = el;
      const cod = e => { const c = e.target.closest('.pv-card'); return c && c.dataset.cod; };
      host.addEventListener('mousedown', e => { if (e.target.closest('.pt-chips button')) e.preventDefault(); });   // el campo no pierde el foco al tocar un atajo
      host.addEventListener('click', e => {
        const f = e.target.closest('[data-pv-filtro]'); if (f) { st.filtro = f.dataset.pvFiltro; pintarChips(); pintarGrid(); return; }
        const ch = e.target.closest('[data-pv-chip]'); if (ch) { const tj = ch.closest('.pv-card'), inp = tj && tj.querySelector(ch.dataset.pvChip === 'ancho' ? '[data-pv-ancho]' : '[data-pv-input]'); if (inp) { inp.value = ch.dataset.v; inp.focus(); } return; }
        if (e.target.closest('[data-pv-editar],[data-pv-dbl]')) { const c = cod(e); if (c) abrirEdicion(c); return; }
        if (e.target.closest('[data-pv-cancelar]')) { const c = cod(e); if (c) { st.edit.delete(c); delete st.estado[c]; cambiarTarjeta(c); } return; }
        if (e.target.closest('[data-pv-guardar]')) { const c = cod(e); if (c) guardarTodo(c); return; }
        const cp = e.target.closest('[data-pv-copiar]'); if (cp) { try { navigator.clipboard.writeText(cp.textContent.trim()); } catch (x) { /* sin portapapeles */ } cp.classList.add('copiado'); setTimeout(() => cp.classList.remove('copiado'), 1200); return; }
        const p = e.target.closest('[data-pv-poner]'); if (p) { guardar(cod(e), p.dataset.pvPoner); return; }
        if (e.target.closest('[data-pv-quitar]')) { guardar(cod(e), ''); return; }
        if (e.target.closest('[data-pv-cambiar]')) { const c = cod(e); st.edit.add(c); cambiarTarjeta(c); host.querySelector('.pv-card[data-cod="' + CSS.escape(c) + '"] [data-pv-input]')?.focus(); return; }
        if (e.target.closest('[data-pv-listo]')) { const c = cod(e); st.edit.delete(c); cambiarTarjeta(c); return; }
        const fa = e.target.closest('[data-pv-fam-aplicar]'); if (fa) { aplicarFamilia(fa.dataset.pvFamAplicar, fa); return; }
        if (e.target.closest('[data-pv-inv]')) {   // propone el proveedor que ya dice el inventario para las telas sin proveedor; se revisa y se aplica
          const claro = t => t.prov_inventario && !/\s-\s/.test(t.prov_inventario);   // «ELIOT - TEKS - PATPRIMO» son varios proveedores juntos: no se sabe cuál es
          const prop = telas().filter(t => !t.proveedor && claro(t)), sin = telas().filter(t => !t.proveedor && !claro(t)).length;
          q1('.pv-lista').classList.add('on'); q1('[data-pv-texto]').value = prop.map(t => t.codigo + ': ' + t.prov_inventario).join('\n'); analizarLista();
          q1('[data-pv-res]').insertAdjacentHTML('beforeend', '<br>Viene del inventario (columna del Sheet donde está cada tela). <span class="no">' + sin + ' telas quedan sin sugerencia (VARIAS u otra empresa).</span> Puedes editar la lista antes de aplicar.');
          q1('.pv-lista').scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
        }
        if (e.target.closest('[data-pv-pegar]')) { q1('.pv-lista').classList.toggle('on'); q1('[data-pv-texto]').focus(); return; }
        if (e.target.closest('[data-pv-lista-ver]')) { analizarLista(); return; }
        const lo = e.target.closest('[data-pv-lista-ok]'); if (lo) { aplicarLista(lo); return; }
        const mp = e.target.closest('[data-pv-masa-poner]'); if (mp) { aplicarMasa(mp.dataset.pvMasaPoner); return; }
        if (e.target.closest('[data-pv-agrupar]')) { st.agrupar = !st.agrupar; guardarVista(); pintarChips(); pintarGrid(); return; }
        if (e.target.closest('[data-pv-compacto]')) { st.compacto = !st.compacto; guardarVista(); pintarChips(); pintarGrid(); return; }
        if (e.target.closest('[data-pv-selsin]')) { visibles().filter(t => !t.proveedor).forEach(t => st.sel.add(t.codigo)); pintarGrid(); return; }
        const pl = e.target.closest('[data-pv-plegar]'); if (pl) { const f = pl.dataset.pvPlegar; st.plegadas.has(f) ? st.plegadas.delete(f) : st.plegadas.add(f); pintarGrid(); return; }
        const sf = e.target.closest('[data-pv-selfam]'); if (sf) { const lista = visibles().filter(t => familia(t.nombre) === sf.dataset.pvSelfam), todas = lista.every(t => st.sel.has(t.codigo)); lista.forEach(t => todas ? st.sel.delete(t.codigo) : st.sel.add(t.codigo)); pintarGrid(); return; }
        if (e.target.closest('[data-pv-masa-ok]')) { aplicarMasa(); return; }
        if (e.target.closest('[data-pv-masa-no]')) { st.sel.clear(); pintarGrid(); return; }
      });
      host.addEventListener('change', e => {
        const c = cod(e);
        if (e.target.matches('[data-pv-sel]') && c) { e.target.checked ? st.sel.add(c) : st.sel.delete(c); e.target.closest('.pv-card').classList.toggle('sel', e.target.checked); pintarMasa(); return; }
        // los campos de la tarjeta ya no se guardan solos: se guardan con el botón GUARDAR (o Enter) de la tarjeta en edición
      });
      host.addEventListener('input', e => { if (e.target.matches('[data-pv-buscar]')) { st.buscar = e.target.value; pintarGrid(); } });
      host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-pv-fam-input]')) { e.preventDefault(); const b = e.target.parentElement.querySelector('[data-pv-fam-aplicar]'); if (b) aplicarFamilia(e.target.dataset.pvFamInput, b); return; } if (e.target.matches('.pt-row input')) { const c = cod(e); if (c && e.key === 'Enter') { e.preventDefault(); guardarTodo(c); } if (c && e.key === 'Escape') { st.edit.delete(c); delete st.estado[c]; cambiarTarjeta(c); } } });
    }
    if (!st.datos) { pintar(); cargar(); }
    else if (!host.firstElementChild) pintar();
  };
})();
