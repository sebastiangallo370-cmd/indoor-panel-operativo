(() => {
  // PROMEDIOS MAESTROS: consumo promedio de tela por maestro y talla (mismos formularios del sistema de promedios de la red).
  if (window.__promediosListo) return;
  window.__promediosListo = true;
  const GRUPOS = [
    ['nino', 'NIÑO · TALLA 2 A 16', 'nino'], ['nina', 'NIÑA · TALLA 2 A 16', 'nino'],
    ['masc', 'MASCULINO · XS A 4XL', 'adulto'], ['fem', 'FEMENINO · XS A 4XL', 'adulto']];
  const NOMBRE_NOTA = { NOTA: 'NOTA (aviso)', OMITIR_MANUAL: 'OMITIR MANUAL', SIN_FUSIONADO: 'SIN FUSIONADO', SIN_SUBCARPETAS: 'SIN SUBCARPETAS' };
  const st = { datos: null, buscar: '', editando: null, nueva: false, puedeEditar: false, abierto: {}, mensaje: '', pendientes: null, prefill: '', materialActivo: '' };
  let panel, tab;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 2) => Number(v || 0).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const plano = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  async function api(url, options) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...((options || {}).headers || {}) } });
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.detail) || 'No fue posible completar la acción');
    return d;
  }

  const css = document.createElement('style');
  css.textContent = `
  .pm{display:grid;gap:16px;width:100%;max-width:1280px;margin:0 auto}
  .pm *{box-sizing:border-box}
  .pm-pend{display:grid;gap:8px;margin:0 0 14px;padding:14px 16px;border-radius:16px;border:1px solid rgba(243,184,82,.45);background:rgba(243,184,82,.06)}.pm-pend-cab{display:grid;gap:3px}.pm-pend-cab b{color:#f3b852;font:900 14px Arial}.pm-pend-cab span{color:#c9d6c2;font:600 12px Arial}.pm-pend-fila{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:#111a15;border:1px solid #35463c;flex-wrap:wrap}.pm-pend-fila b{font:900 14px Arial;color:#eef4e9}.pm-pend-fila small{display:block;font:600 11px Arial;color:#a6b7ab;margin-top:2px}.pm-pend-todas{min-height:40px;margin-top:4px;padding:0 16px;border-radius:999px;border:1px solid #f3b852;background:#f3b852;color:#2a1c04;font:900 11px Arial;letter-spacing:.05em;cursor:pointer;width:max-content}.pm-pend-cargar{min-height:36px;padding:0 14px;border-radius:999px;border:0;background:var(--lima,#d0f44c);color:#18220c;font:900 11px Arial;letter-spacing:.05em;cursor:pointer;width:auto}@media(max-width:600px){.pm-pend-cargar{width:100%}}
  .pm-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;padding:20px 22px;border:1px solid #34432f;border-radius:16px;background:linear-gradient(135deg,#101a16,#0c110d)}
  .pm-head small{color:#7da4ff;letter-spacing:.14em;font-weight:800;font-size:.68rem}.pm-head h2{margin:4px 0 4px;font-size:1.6rem}.pm-head p{margin:0;color:#aebba7;font-size:.88rem}
  .pm-head input{min-height:44px;min-width:260px;padding:0 14px;border:1px solid #34432f;border-radius:12px;background:#0c110d;color:inherit;font-size:.95rem}
  .pm-head-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pm-head-actions .pm-btn{min-height:44px;font-size:.72rem;white-space:nowrap}
  .pm-form{display:grid;gap:20px;padding:22px;border:1px solid #406245;border-radius:18px;background:radial-gradient(circle at 0 0,rgba(105,155,88,.13),transparent 34%),#0c110d;box-shadow:0 18px 40px rgba(0,0,0,.18)}
  .pm-form h3{margin:0;padding-bottom:12px;border-bottom:1px solid rgba(158,196,144,.22);font-size:.82rem;letter-spacing:.14em;color:#d7ff3a}
  .pm-form-hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:4px 2px 17px;border-bottom:1px solid rgba(158,196,144,.22)}.pm-form-hero h3{padding:0;border:0;font-size:1.45rem;letter-spacing:.03em;color:#f3f8ed}.pm-form-hero p{margin:6px 0 0;color:#aebba7;line-height:1.45;font-size:.82rem;max-width:680px}.pm-section-kicker{display:block;color:#c9fa46;font:900 .61rem Arial;letter-spacing:.16em}.pm-form-state{flex:0 0 auto;padding:7px 10px;border-radius:999px;background:rgba(126,185,70,.13);border:1px solid rgba(145,209,87,.38);color:#d7ff83;font:900 .6rem Arial;letter-spacing:.1em}.pm-flow{display:flex;align-items:center;gap:5px;padding:9px 11px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(158,196,144,.15);overflow:auto}.pm-flow span{display:flex;align-items:center;gap:6px;white-space:nowrap;color:#81907d;font:800 .66rem Arial}.pm-flow span:not(:last-child)::after{content:'›';margin-left:4px;color:#4f6252;font-size:1.2rem}.pm-flow i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#202b20;color:#aab9a6;font-style:normal}.pm-flow .active{color:#eaf5e1}.pm-flow .active i{background:#c9fa46;color:#16200d}.pm-form-block{display:grid;gap:13px;padding:16px;border-radius:15px;border:1px solid rgba(107,152,107,.28);background:rgba(255,255,255,.025)}.pm-block-title{display:grid;gap:4px}.pm-block-title>b{font-size:.9rem;color:#eff7e9}
  .pm-fila{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
  .pm label{display:grid;gap:6px;font-size:.66rem;letter-spacing:.1em;color:#9fb09a;font-weight:800;text-transform:uppercase}
  .pm input,.pm select{min-height:42px;padding:0 12px;border:1px solid #2c3a2a;border-radius:10px;background:#101710;color:inherit;font-size:.92rem;width:100%}
  .pm-grupo{display:grid;gap:8px}.pm-grupo>b{font-size:.66rem;letter-spacing:.12em;color:#aebba7}
  .pm-tallas{display:grid;gap:8px;grid-template-columns:repeat(8,minmax(0,1fr))}.pm-talla-extra{position:relative}.pm-talla-extra>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-quitar-talla{position:absolute;top:-5px;right:2px;width:15px;height:15px;padding:0;border:0;border-radius:50%;background:#81403d;color:#fff;font-size:11px;line-height:15px;cursor:pointer}.pm-add-size{display:grid!important;place-items:center;align-self:end;width:38px!important;min-height:38px!important;padding:0!important;border:2px solid #c9fa46!important;border-radius:10px!important;background:#112615!important;color:#dfff86!important;font:900 25px/1 Arial!important;cursor:pointer;box-shadow:0 0 0 1px rgba(201,250,70,.16),0 0 14px rgba(201,250,70,.15)}.pm-add-size:hover{background:#c9fa46!important;color:#16200d!important;transform:scale(1.06)}
  .pm-tallas label{text-align:center;font-size:.62rem}.pm-tallas input{text-align:center;padding:0 4px;border-radius:999px}
  .pm-acciones{display:flex;gap:10px;flex-wrap:wrap}
  .pm-btn{min-height:44px;padding:0 20px;border:1px solid #34432f;border-radius:12px;background:#17211a;color:inherit;font-weight:800;cursor:pointer;letter-spacing:.06em;width:auto!important}
  .pm-btn.pri{background:#d7ff3a;color:#10140a;border-color:#d7ff3a}.pm-btn.pel{border-color:#7b3434;color:#ff9a9d}.pm-btn:disabled{opacity:.5;cursor:default}
  .pm-msg{min-height:1.2em;font-size:.85rem;color:#aebba7}.pm-msg.err{color:#ff9a9d}.pm-msg.ok{color:#8bd450}
  .pm-lista{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))}
  .pm-card{display:grid;gap:12px;padding:18px;border:1px solid #34432f;border-radius:16px;background:#0c110d;align-content:start}
  .pm-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .pm-card small{font-size:.62rem;letter-spacing:.14em;color:#9fb09a;font-weight:800}.pm-card h4{margin:2px 0 0;font-size:1.7rem;letter-spacing:.02em}
  .pm-badge{display:inline-grid;place-items:center;min-width:34px;height:34px;padding:0 10px;border-radius:999px;background:#1a2640;color:#9db8ff;font-weight:800;font-size:.72rem}
  .pm-ico{width:36px!important;height:36px;min-height:36px!important;padding:0!important;border-radius:50%;border:1px solid #34432f;background:#17211a;color:inherit;cursor:pointer;display:grid;place-items:center;font-size:.95rem}
  .pm-prom{display:grid;gap:4px;padding:14px;border-radius:12px;background:#111a14}
  .pm-prom b{font-size:1.5rem;color:#fff}.pm-prom em{font-style:normal;color:#d7ff3a}
  .pm-prom summary{cursor:pointer;color:#9db8ff;font-size:.78rem;margin-top:4px}
  .pm-materiales{display:grid;gap:8px;padding:12px;border:1px solid #344a37;border-radius:12px;background:#0d1710}.pm-materiales>b{font-size:.65rem;letter-spacing:.12em;color:#aebba7}.pm-material{display:grid;gap:7px;padding:10px 11px;border-radius:10px;background:#121d14;border-left:3px solid #80bd49}.pm-material.fusionado{order:-1;border-left-color:#78aee8;background:linear-gradient(90deg,rgba(57,104,152,.2),#121d14)}.pm-material summary{display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;font-size:.76rem;color:#eaf5e1;font-weight:800}.pm-material summary em{font-style:normal;color:#d7ff3a;font-size:.72rem;white-space:nowrap}.pm-material .pm-grupo>b{font-size:.58rem}
  .pm-materiales-editor{display:grid;gap:14px;padding:16px;border:1px solid #42674a;border-radius:16px;background:linear-gradient(135deg,rgba(42,85,49,.38),#0b130d)}.pm-materiales-editor-head,.pm-material-edit-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.pm-materiales-editor-head b,.pm-material-edit-head b{display:block;margin-top:4px;font-size:.72rem;letter-spacing:.12em;color:#d7ff3a}.pm-materiales-editor-head small{display:block;margin-top:5px;color:#b6c3b2;font-size:.75rem;line-height:1.35;max-width:720px}.pm-materiales-editor-head .pm-btn{min-height:38px;padding:0 15px;font-size:.7rem;white-space:nowrap}.pm-add-material{border-color:rgba(201,250,70,.48);background:rgba(201,250,70,.1)!important;color:#e8ff99}.pm-add-material span{font-size:1.1rem;vertical-align:-1px}.pm-material-picker{display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:11px 12px;border:1px solid rgba(89,200,232,.28);border-radius:13px;background:linear-gradient(100deg,rgba(89,200,232,.09),rgba(201,250,70,.06))}.pm-material-picker label{width:min(260px,100%);color:#bfeaff}.pm-material-picker select{min-height:40px;border-color:rgba(89,200,232,.48);font-weight:900;color:#ecfaff}.pm-material-picker small{padding:0 0 10px;color:#aac0ad;font-size:.68rem}.pm-material-edit{display:none;gap:14px;margin-top:10px;padding:16px;border-radius:14px;border:1px solid #314b37;background:linear-gradient(145deg,#0e1a11,#09100b);transition:border-color .2s,box-shadow .2s}.pm-material-edit.is-active-material{display:grid}.pm-material-edit:hover{border-color:#598760;box-shadow:0 8px 20px rgba(0,0,0,.16)}.pm-material-edit.is-fusionado{border-color:rgba(88,200,231,.62);background:linear-gradient(145deg,rgba(20,65,79,.45),#09100b)}.pm-material-edit-head{padding-bottom:10px;border-bottom:1px solid rgba(158,196,144,.16)}.pm-material-edit-head>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pm-material-edit-head small{flex-basis:100%;color:#8fa58f;font-size:.68rem}.pm-material-index{display:inline-grid;place-items:center;min-width:31px;height:25px;padding:0 8px;border-radius:999px;background:#c9fa46;color:#17210e;font:900 .68rem Arial}.is-fusionado .pm-material-index{background:#59c8e8;color:#09212b}.pm-material-edit .pm-ico{width:28px!important;height:28px;min-height:28px!important;color:#ff9a9d}.pm-material-edit .pm-grupo>b{font-size:.6rem}.pm-material-identidad{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.pm-material-identidad>label:first-child{width:min(260px,100%)}.pm-material-code{display:flex;align-items:center;min-height:42px;padding:0 13px;border:1px solid rgba(201,250,70,.45);border-radius:10px;background:rgba(201,250,70,.08);color:#ecff9e;font:900 .86rem Arial;letter-spacing:.06em}.pm-material-code small{margin-left:auto;color:#aebba7;font:700 .58rem Arial;letter-spacing:.04em}.pm-consumos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pm-familia-tallas{display:grid;gap:12px;padding:13px;border:1px solid rgba(98,137,100,.28);border-radius:12px;background:rgba(10,20,13,.7)}.pm-familia-titulo{display:flex;align-items:center;gap:8px;color:#d7ff3a;font-size:.66rem;font-weight:900;letter-spacing:.12em}.pm-familia-titulo::before{content:'';width:7px;height:7px;border-radius:50%;background:#76d292;box-shadow:0 0 10px #76d292}.pm-fusionado-check{display:inline-flex!important;align-items:center;gap:7px;margin:0;color:#bfeaff!important;font-size:.72rem!important;font-weight:800}.pm-fusionado-check input{width:16px!important;min-height:16px!important;margin:0;accent-color:#58c8e7}
  .pm-extras{border:1px solid rgba(98,137,100,.34);border-radius:14px;background:rgba(255,255,255,.025)}.pm-extras summary{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 15px;cursor:pointer;list-style:none}.pm-extras summary::-webkit-details-marker{display:none}.pm-extras summary b{display:block;color:#edf5e9;font-size:.82rem}.pm-extras summary small{display:block;margin-top:3px;color:#8fa58f;font-size:.7rem}.pm-extras summary i{color:#c9fa46;font-style:normal;font-size:1.1rem;transition:transform .18s}.pm-extras[open] summary i{transform:rotate(180deg)}.pm-extras-body{display:grid;gap:14px;padding:0 15px 15px}.pm-savebar{align-items:center;padding:14px 0 0;border-top:1px solid rgba(158,196,144,.22)}.pm-savebar>div{display:grid;gap:3px;margin-right:auto}.pm-savebar small{color:#91a18e;font-size:.72rem}
  .pm-material-edit-head>.pm-material-live{margin-left:auto!important;display:flex!important;align-items:flex-end!important;justify-content:center;gap:1px!important;flex-direction:column!important;padding:5px 10px;border-radius:10px;border:1px solid rgba(201,250,70,.25);background:rgba(201,250,70,.06);line-height:1.1}.pm-material-live span{color:#9eae98;font:700 .6rem Arial;letter-spacing:.04em}.pm-material-live strong{color:#e5ff86;font:900 .82rem Arial;letter-spacing:.04em}.pm-material-edit.has-values .pm-material-live{border-color:rgba(201,250,70,.62);background:rgba(201,250,70,.12);box-shadow:0 0 16px -8px #c9fa46}.pm-tallas input.pm-input-listo{border-color:rgba(201,250,70,.62);background:rgba(201,250,70,.1);color:#f2ffba;box-shadow:inset 0 0 0 1px rgba(201,250,70,.12)}.pm-completar{margin-left:auto;padding:3px 7px;border:1px solid rgba(201,250,70,.32);border-radius:999px;background:rgba(201,250,70,.08);color:#dfff86;font:800 .54rem Arial;letter-spacing:.06em;cursor:pointer}.pm-completar:hover{background:rgba(201,250,70,.18)}
  .pm-studio-telemetry{display:grid;justify-items:end;gap:5px;min-width:146px}.pm-studio-telemetry>b{color:#dfff86;font:900 .64rem Arial;letter-spacing:.1em}.pm-studio-telemetry>div{width:146px;height:5px;overflow:hidden;border-radius:99px;background:rgba(212,245,192,.16)}.pm-studio-telemetry>div i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#70d692,#d8ff58);box-shadow:0 0 12px rgba(201,250,70,.65);transition:width .25s ease}.pm-family-status{display:inline-flex!important;align-items:center;gap:5px;margin-left:auto;color:#a7b5a2;font:800 .57rem Arial;letter-spacing:.06em}.pm-family-status i{width:6px;height:6px;border-radius:50%;background:#405846;box-shadow:none}.pm-familia-tallas.is-complete .pm-family-status{color:#dbff8c}.pm-familia-tallas.is-complete .pm-family-status i{background:#75dc93;box-shadow:0 0 8px #75dc93}.pm-family-track{height:3px;overflow:hidden;border-radius:99px;background:rgba(214,244,185,.1);margin-top:-5px}.pm-family-track i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#58c8e8,#c9fa46);transition:width .25s ease}.pm-familia-tallas.is-complete .pm-family-track i{background:linear-gradient(90deg,#75dc93,#d8ff58)}
  .pm-material-live small{color:#7f9380;font:800 .5rem Arial;letter-spacing:.06em;white-space:nowrap}.pm-material-edit.has-values .pm-material-live small{color:#9fbe9c}.pm-rail-progress{display:grid;gap:7px;padding:12px;border-radius:13px;border:1px solid rgba(89,200,232,.24);background:linear-gradient(135deg,rgba(89,200,232,.08),rgba(201,250,70,.04));margin-top:2px}.pm-rail-progress span{color:#9bb1a0;font:800 .56rem Arial;letter-spacing:.09em}.pm-rail-progress strong{color:#edf8dc;font:900 .78rem Arial;letter-spacing:.07em}.pm-rail-progress>div{height:6px;overflow:hidden;border-radius:99px;background:rgba(214,244,185,.15)}.pm-rail-progress>div i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#58c8e8,#c9fa46);box-shadow:0 0 12px rgba(89,200,232,.6);transition:width .25s ease}.pm-rail-progress small{color:#a8b9a7;font-size:.66rem;line-height:1.35}
  .pm-lista{grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}.pm-card-nueva{position:relative;gap:14px;min-height:0;padding:0;overflow:hidden;border-color:rgba(89,203,130,.44);background:linear-gradient(155deg,rgba(28,52,38,.96),rgba(7,16,10,.98));box-shadow:0 12px 28px rgba(0,0,0,.17);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}.pm-card-nueva:hover{transform:translateY(-3px);border-color:#7ae09b;box-shadow:0 18px 34px rgba(0,0,0,.28)}.pm-card-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 18px 0;background:radial-gradient(circle at 0 0,rgba(217,255,116,.16),transparent 52%)}.pm-card-hero h4{font-size:2rem;line-height:1;margin:4px 0 7px;color:#f7fbf2}.pm-card-caption{display:inline-flex;padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.08);color:#c2d2bd;font:800 .58rem Arial;letter-spacing:.09em}.pm-card-actions{display:flex;align-items:center;gap:6px}.pm-card-actions .pm-ico{width:30px!important;height:30px;min-height:30px!important;font-size:.8rem;background:rgba(6,13,8,.45)}.pm-card-kpi{display:flex;justify-content:space-between;align-items:flex-end;margin:0 18px;padding:13px 14px;border:1px solid rgba(201,250,70,.25);border-radius:14px;background:linear-gradient(100deg,rgba(201,250,70,.1),rgba(89,200,232,.06))}.pm-card-kpi small{display:block;color:#a9bba4;font-size:.57rem}.pm-card-kpi strong{display:block;margin-top:4px;color:#e8ff92;font:900 1.55rem Arial;letter-spacing:-.03em}.pm-card-kpi strong em{margin-left:4px;color:#d7e6cf;font:800 .63rem Arial;letter-spacing:.06em}.pm-card-kpi span{display:block;margin-top:3px;color:#93a58f;font:700 .61rem Arial}.pm-card-kpi>i{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:rgba(201,250,70,.15);color:#dfff86;font-size:1.25rem;font-style:normal}.pm-card-materiales{margin:0 18px;padding:0;border:0;background:transparent}.pm-materiales-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}.pm-materiales-title>b{color:#a9bba4;font-size:.58rem}.pm-materiales-title span{color:#7f9380;font:700 .58rem Arial}.pm-card-materiales .pm-material{padding:11px 12px;border-radius:12px;border-left-width:4px;background:rgba(4,12,7,.5);transition:background .18s}.pm-card-materiales .pm-material:hover{background:rgba(31,57,38,.68)}.pm-card-materiales .pm-material summary span{display:flex;align-items:center;gap:7px}.pm-card-materiales .pm-material summary span::before{content:'↗';display:grid;place-items:center;width:19px;height:19px;border-radius:6px;background:rgba(201,250,70,.18);color:#dfff86;font:900 .62rem Arial}.pm-card-materiales .pm-material.fusionado summary span::before{content:'✦';background:rgba(89,200,232,.2);color:#bfeaff}.pm-card-details,.pm-card-support{margin:0 18px;border-top:1px solid rgba(214,244,185,.14);padding:11px 0 0;background:transparent}.pm-card-details summary,.pm-card-support summary{display:flex;justify-content:space-between;cursor:pointer;list-style:none;color:#b9d2b3;font:800 .62rem Arial;letter-spacing:.08em}.pm-card-details summary::-webkit-details-marker,.pm-card-support summary::-webkit-details-marker{display:none}.pm-card-details summary em{font-style:normal;color:#dfff86;font-size:1.1rem;line-height:.5}.pm-card-groups{display:grid;gap:10px;margin-top:12px}.pm-card-support .pm-plant{margin-top:10px}.pm-card-empty{margin:0 18px;padding:12px;border:1px dashed rgba(158,196,144,.26);border-radius:12px;color:#93a58f;font-size:.72rem}.pm-card-nueva .pm-notas{margin:0 18px 18px}
  .pm-workbench.pm-workbench-nuevo{display:grid;grid-template-columns:1fr;border-top:1px solid rgba(214,244,185,.15)}.pm-identidad-bar{display:grid;grid-template-columns:minmax(190px,1fr) minmax(200px,1.2fr) 150px minmax(210px,1fr);gap:14px;align-items:end;padding:18px 24px;border-bottom:1px solid rgba(214,244,185,.15);background:linear-gradient(90deg,rgba(201,250,70,.08),rgba(89,200,232,.045),transparent)}.pm-identidad-intro{align-self:center}.pm-identidad-intro>b{display:block;margin-top:5px;color:#f3f8ee;font-size:1rem}.pm-identidad-intro small{display:block;margin-top:4px;color:#9bad99;font-size:.7rem;line-height:1.35}.pm-identidad-bar label{margin:0}.pm-identidad-bar .pm-rail-progress{min-width:0;margin:0;padding:10px 12px}.pm-identidad-bar .pm-rail-progress small{display:none}.pm-workbench-nuevo .pm-studio-main{padding:24px 28px}.pm-workbench-nuevo .pm-studio-title{padding:0 0 4px}.pm-workbench-nuevo .pm-materiales-editor-head{align-items:flex-end}.pm-workbench-nuevo .pm-material-edit{border-radius:20px;padding:18px;background:linear-gradient(145deg,rgba(10,23,13,.97),rgba(7,13,8,.97))}.pm-workbench-nuevo .pm-consumos{gap:16px}.pm-workbench-nuevo .pm-familia-tallas{padding:15px;border-radius:15px;background:linear-gradient(145deg,rgba(17,34,21,.78),rgba(6,13,8,.75))}.pm-workbench-nuevo .pm-tallas{gap:10px}.pm-workbench-nuevo .pm-tallas input{min-height:46px;background:rgba(255,255,255,.055)}.pm-workbench-nuevo .pm-extras{border-radius:16px}.pm-workbench-nuevo .pm-savebar{position:sticky;bottom:0;z-index:2;box-shadow:0 -10px 25px rgba(0,0,0,.22)}
  .pm-capture-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 11px;border:1px solid rgba(89,200,232,.22);border-radius:13px;background:rgba(89,200,232,.045)}.pm-capture-toolbar>span{color:#8bbbd0;font:900 .57rem Arial;letter-spacing:.12em}.pm-capture-toolbar>div{display:flex;gap:4px;padding:3px;border-radius:999px;background:rgba(0,0,0,.25)}.pm-capture-toolbar button{min-height:25px;padding:0 9px;border:0;border-radius:999px;background:transparent;color:#91a892;font:800 .56rem Arial;letter-spacing:.06em;cursor:pointer}.pm-capture-toolbar button.active{background:#c9fa46;color:#18220d;box-shadow:0 2px 8px rgba(201,250,70,.18)}.pm-capture-toolbar small{margin-left:auto;color:#7f9380;font-size:.62rem}.pm-material-edit.pm-focus-ninos [data-familia='adultos'],.pm-material-edit.pm-focus-adultos [data-familia='ninos']{display:none}.pm-material-edit.pm-focus-ninos .pm-consumos,.pm-material-edit.pm-focus-adultos .pm-consumos{grid-template-columns:minmax(0,1fr)}
  .pm-capture-deck{display:grid;gap:10px;padding:12px;border:1px solid rgba(89,200,232,.25);border-radius:17px;background:linear-gradient(145deg,rgba(8,26,15,.95),rgba(8,15,10,.9))}.pm-capture-deck-top{display:flex;align-items:end;justify-content:space-between;gap:10px}.pm-capture-deck-top b{display:block;margin-top:3px;color:#eef8e9;font-size:.86rem}.pm-capture-deck-top small{color:#8da38c;font-size:.63rem}.pm-family-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.pm-family-nav button{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px;padding:7px 8px;border:1px solid rgba(158,196,144,.18);border-radius:10px;background:rgba(255,255,255,.025);color:#abbba6;cursor:pointer;text-align:left}.pm-family-nav button span{font:900 .58rem Arial;letter-spacing:.08em}.pm-family-nav button b{font:800 .56rem Arial;color:#91a990}.pm-family-nav button i{grid-column:1/-1;height:2px;overflow:hidden;border-radius:8px;background:rgba(214,244,185,.14)}.pm-family-nav button i::before{content:'';display:block;height:100%;width:var(--pm-progress,0%);border-radius:inherit;background:linear-gradient(90deg,#58c8e8,#c9fa46);transition:width .25s ease}.pm-family-nav button.active{border-color:rgba(201,250,70,.62);background:rgba(201,250,70,.09);color:#eaffae;box-shadow:0 0 0 1px rgba(201,250,70,.12)}.pm-family-nav button.active b{color:#dfff86}.pm-consumos-deck{display:block!important}.pm-consumos-deck .pm-familia-tallas{display:none!important;min-height:190px}.pm-consumos-deck[data-active-family='nino'] [data-familia='nino'],.pm-consumos-deck[data-active-family='nina'] [data-familia='nina'],.pm-consumos-deck[data-active-family='masc'] [data-familia='masc'],.pm-consumos-deck[data-active-family='fem'] [data-familia='fem']{display:grid!important}.pm-consumos-deck .pm-tallas{grid-template-columns:repeat(8,88px);gap:8px;justify-content:start;max-width:100%}.pm-consumos-deck .pm-tallas label{font-size:.56rem}.pm-consumos-deck .pm-tallas input{min-height:38px;font-size:.82rem;padding:0 3px}
  /* Estudio de edición: identidad a la izquierda, mediciones como área de trabajo. */
  .pm-studio{gap:0;padding:0;overflow:hidden;border-radius:22px;background:linear-gradient(155deg,#101a13,#080e09)}.pm-studio-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:25px 28px 20px;background:linear-gradient(105deg,rgba(201,250,70,.13),rgba(255,255,255,.025) 42%,transparent)}.pm-studio-top h3{margin:5px 0 0;padding:0;border:0;color:#f5faef;font-size:1.62rem;letter-spacing:.02em}.pm-workbench{display:grid;grid-template-columns:280px minmax(0,1fr);border-top:1px solid rgba(214,244,185,.15)}.pm-rail{display:grid;align-content:start;gap:16px;padding:24px 20px;background:linear-gradient(180deg,rgba(51,85,48,.34),rgba(11,19,12,.85));border-right:1px solid rgba(214,244,185,.15)}.pm-rail-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#c9fa46;color:#14200c;font:900 15px Arial;box-shadow:0 0 0 5px rgba(201,250,70,.1)}.pm-rail>b{font-size:1rem;color:#f1f8eb}.pm-rail p{margin:6px 0 0;color:#aebba7;font-size:.76rem;line-height:1.5}.pm-rail label{font-size:.62rem}.pm-rail-tip{display:flex;gap:9px;align-items:flex-start;padding:11px;border-radius:12px;background:rgba(201,250,70,.08);border:1px solid rgba(201,250,70,.2);color:#c8d8c0;font-size:.71rem;line-height:1.4}.pm-rail-tip i{display:grid;place-items:center;flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:#c9fa46;color:#16200c;font-style:normal;font-weight:900}.pm-studio-main{display:grid;gap:18px;padding:24px;min-width:0}.pm-studio-title{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.pm-studio-title b{display:block;margin-top:5px;color:#f0f7eb;font-size:1.05rem}.pm-studio-title small{display:block;margin-top:5px;color:#a7b5a2;font-size:.75rem;line-height:1.4}.pm-measure-pill{padding:7px 10px;border-radius:999px;border:1px solid rgba(89,200,232,.46);background:rgba(89,200,232,.08);color:#bceeff;font:900 .62rem Arial;letter-spacing:.1em;white-space:nowrap}.pm-studio .pm-materiales-editor{padding:0;border:0;background:transparent}.pm-studio .pm-materiales-editor-head{padding:0 0 13px;border-bottom:1px solid rgba(158,196,144,.16)}.pm-studio .pm-materiales-editor-head>b{font-size:.78rem}.pm-studio .pm-material-edit{margin-top:12px;border-radius:16px}.pm-studio .pm-extras{margin-top:2px}.pm-studio .pm-savebar{margin:0;padding:17px 28px;border-top:1px solid rgba(214,244,185,.17);background:rgba(0,0,0,.16)}
  .pm-chips{display:flex;flex-wrap:wrap;gap:6px}.pm-chip{display:grid;gap:2px;text-align:center;font-size:.58rem;color:#9fb09a}.pm-chip span{display:block;min-width:44px;padding:6px 8px;border-radius:999px;background:#17211a;color:#fff;font-size:.82rem}
  .pm-plant{display:grid;gap:3px;font-size:.78rem;color:#aebba7}.pm-plant b{color:#d7e3d1}
  .pm-notas{display:grid;gap:6px}.pm-nota{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;padding:8px 10px;border-radius:10px;background:#141c15;font-size:.8rem}.pm-nota i{font-style:normal;font-size:.62rem;letter-spacing:.08em;color:#ffcf5c;font-weight:800;display:block}
  .pm-nota button{width:auto!important;min-height:0!important;padding:2px 8px!important;border:0;background:transparent;color:#ff9a9d;cursor:pointer}
  .pm-vacio{padding:34px;text-align:center;color:#aebba7;border:1px dashed #34432f;border-radius:14px}
  /* Edición compacta: la captura es lo principal; los detalles siguen disponibles sin competir visualmente. */
  .pm-studio-top,.pm-studio-title,.pm-identidad-intro,.pm-identidad-bar .pm-rail-progress,.pm-materiales-editor-head small,.pm-material-picker small,.pm-material-live,.pm-material-edit-head>.pm-material-live,.pm-material-edit-head>div>small{display:none!important}.pm-workbench{border-top:0}.pm-identidad-bar{grid-template-columns:repeat(2,minmax(0,1fr));padding:14px 18px;gap:12px}.pm-identidad-bar label{min-width:0}.pm-studio-main{gap:14px;padding-top:16px}.pm-materiales-editor-head{padding-bottom:10px;align-items:center}.pm-materiales-editor-head>div>b{font-size:.76rem}.pm-material-picker{padding:9px 11px;align-items:center}.pm-material-picker label{width:min(250px,100%)}.pm-material-picker select{min-height:38px}.pm-material-edit{margin-top:8px}.pm-material-edit-head{min-height:38px;padding-bottom:8px}.pm-material-edit-head>div{min-width:0}.pm-family-nav{align-items:stretch}.pm-family-nav button{min-height:58px}.pm-consumos-deck .pm-familia-tallas{min-height:0}.pm-savebar>div{display:none}.pm-savebar{justify-content:flex-end}
  /* Tarjetas operativas: compactas, homogéneas y con detalle solo al solicitarlo. */
  .pm-lista{grid-template-columns:repeat(auto-fill,minmax(310px,370px));align-items:stretch;gap:16px}.pm-card-nueva{min-height:414px;grid-template-rows:auto auto minmax(0,1fr) auto;border:1px solid rgba(126,191,130,.48);border-left:4px solid #b8ef49;border-radius:18px;background:linear-gradient(160deg,rgba(31,54,39,.98),rgba(9,20,13,.98));box-shadow:0 12px 28px rgba(0,0,0,.2);overflow:hidden}.pm-card-nueva::after{content:'';position:absolute;inset:auto 0 0;height:3px;background:linear-gradient(90deg,#77d692,#d7ff3a,#58c8e8);transform:scaleX(.14);transform-origin:left;transition:transform .28s ease}.pm-card-nueva:hover{transform:translateY(-5px);border-color:#93e78a;box-shadow:0 20px 36px rgba(0,0,0,.32)}.pm-card-nueva:hover::after{transform:scaleX(1)}.pm-card-hero{padding:17px 16px 12px;background:linear-gradient(115deg,rgba(201,250,70,.15),rgba(89,200,232,.08),transparent 68%)}.pm-card-hero h4{font-size:1.92rem}.pm-card-caption{background:rgba(201,250,70,.13);color:#e5ff9a}.pm-card-actions .pm-ico{border-color:rgba(215,255,58,.22);transition:transform .18s ease,background .18s ease}.pm-card-actions .pm-ico:hover{transform:scale(1.08);background:rgba(201,250,70,.18)}.pm-card-kpi{margin:0 16px;padding:12px 13px;border-radius:12px;background:linear-gradient(105deg,rgba(201,250,70,.14),rgba(89,200,232,.09))}.pm-card-materiales{display:grid;align-content:start;gap:7px;margin:0 16px;padding-top:2px}.pm-materiales-title{margin:0}.pm-materiales-title span{font-size:0}.pm-materiales-title span::after{content:'selecciona para ver tallas';font-size:.58rem}.pm-card-materiales .pm-material{padding:0;border:1px solid rgba(132,183,124,.24);border-left:4px solid #b8ef49;border-radius:11px;background:rgba(5,14,8,.66);overflow:hidden}.pm-card-materiales .pm-material summary{min-height:45px;padding:0 11px}.pm-card-materiales .pm-material summary:hover{background:rgba(201,250,70,.08)}.pm-card-materiales .pm-material summary em{color:#ddff65;font-size:.76rem}.pm-card-materiales .pm-material[open]{background:rgba(35,68,42,.7);border-color:rgba(201,250,70,.48)}.pm-card-materiales .pm-material .pm-grupo{padding:0 11px 11px}.pm-card-details,.pm-card-support{margin:0 16px;padding:10px 0 13px}.pm-card-nueva .pm-notas{margin:0 16px 16px}.pm-card-empty{margin:0 16px}.pm-material-identidad{justify-content:flex-end;min-height:0}.pm-material-identidad>label:first-child{display:none!important}.pm-fusionado-check{min-height:28px}.pm-capture-deck{transition:border-color .2s ease,box-shadow .2s ease}.pm-capture-deck:focus-within{border-color:rgba(201,250,70,.58);box-shadow:0 0 0 3px rgba(201,250,70,.07)}
  @keyframes pm-card-enter{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes pm-glow{0%,100%{opacity:.35;transform:translate3d(-18%,0,0)}50%{opacity:.8;transform:translate3d(16%,0,0)}}@keyframes pm-material-enter{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}.pm-card-nueva{isolation:isolate;animation:pm-card-enter .42s both cubic-bezier(.2,.8,.2,1)}.pm-card-nueva:nth-child(2){animation-delay:.05s}.pm-card-nueva:nth-child(3){animation-delay:.1s}.pm-card-nueva:nth-child(4){animation-delay:.15s}.pm-card-nueva::before{content:'';position:absolute;z-index:-1;top:-34%;left:-18%;width:72%;height:72%;border-radius:50%;background:radial-gradient(circle,rgba(201,250,70,.15),transparent 68%);pointer-events:none;animation:pm-glow 7s ease-in-out infinite}.pm-card-materiales .pm-material{transition:transform .18s ease,border-color .18s ease,background .18s ease}.pm-card-materiales .pm-material:hover{transform:translateX(3px);border-color:rgba(201,250,70,.62)}.pm-card-materiales .pm-material summary::after,.pm-card-details summary::after,.pm-card-support summary::after{content:'›';margin-left:auto;color:#dcff6e;font:900 1rem Arial;transition:transform .2s ease}.pm-card-details summary em{display:none}.pm-card-materiales .pm-material[open] summary::after,.pm-card-details[open] summary::after,.pm-card-support[open] summary::after{transform:rotate(90deg)}.pm-card-materiales .pm-material[open] .pm-grupo{animation:pm-material-enter .22s ease-out}.pm-card-details,.pm-card-support{border:1px solid rgba(144,194,139,.18);border-radius:10px;padding:0}.pm-card-details summary,.pm-card-support summary{min-height:40px;padding:0 11px;align-items:center}.pm-card-details[open] .pm-card-groups,.pm-card-support[open] .pm-plant{padding:0 11px 11px;animation:pm-material-enter .22s ease-out}.pm-material-picker select{cursor:pointer;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease}.pm-material-picker select:hover{border-color:#bde957;transform:translateY(-1px)}.pm-material-edit.is-active-material{animation:pm-material-enter .28s ease-out}.pm-family-nav button{transition:transform .16s ease,border-color .16s ease,background .16s ease}.pm-family-nav button:hover{transform:translateY(-2px);border-color:rgba(201,250,70,.5)}.pm-family-nav button.active{box-shadow:0 0 0 1px rgba(201,250,70,.13),0 8px 18px rgba(0,0,0,.18)}@media(prefers-reduced-motion:reduce){.pm-card-nueva,.pm-card-nueva::before,.pm-material-edit.is-active-material{animation:none}.pm-card-nueva,.pm-card-materiales .pm-material,.pm-family-nav button,.pm-material-picker select{transition:none}}
  body:has(.panel[data-panel='promedios'].active) main{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important;padding-left:clamp(10px,1.2vw,24px)!important;padding-right:clamp(10px,1.2vw,24px)!important;padding-top:10px!important}
  .tab[data-kind='promedios'] .nav-icon{display:none!important}
  @media(min-width:701px){.nav-group:has(>.tab[data-kind='promedios']){display:none!important}}
  @media(max-width:1000px){.pm-lista{grid-template-columns:1fr}.pm-tallas{grid-template-columns:repeat(4,minmax(0,1fr))}.pm-consumos{grid-template-columns:1fr}}
  .pm-consumos-deck .pm-tallas{display:flex!important;flex-wrap:nowrap!important;align-items:end!important;gap:8px;justify-content:flex-start;max-width:100%;overflow-x:auto;padding:2px 2px 7px;scrollbar-width:thin}.pm-consumos-deck .pm-tallas label{flex:0 0 70px!important;min-width:70px}.pm-consumos-deck .pm-tallas .pm-add-size{flex:0 0 38px!important;margin-bottom:0}
  @media(max-width:700px){.pm-head{padding:14px 16px}.pm-head h2{font-size:1.25rem}.pm-head-actions{width:100%}.pm-head input{width:100%;min-width:0;font-size:16px}.pm-head-actions .pm-btn{width:100%!important}.pm-form{padding:14px}.pm-form-hero{gap:10px;flex-direction:column}.pm-form-hero h3{font-size:1.2rem}.pm-form-state{align-self:flex-start}.pm-flow{gap:3px}.pm-flow span{font-size:.59rem}.pm-flow i{width:18px;height:18px}.pm-materiales-editor,.pm-material-edit{padding:12px}.pm-materiales-editor-head{align-items:flex-start;flex-direction:column}.pm-materiales-editor-head .pm-btn{width:100%!important}.pm-material-identidad{align-items:flex-start;flex-direction:column;gap:9px}.pm input,.pm select{font-size:16px}.pm-card h4{font-size:1.4rem}.pm-btn{flex:1 1 40%}.pm-savebar{align-items:stretch}.pm-savebar>div{flex-basis:100%}.pm-savebar .pm-btn{min-height:46px}.pm-extras-body{padding:0 12px 12px}.pm-studio-top{padding:19px 16px}.pm-studio-top h3{font-size:1.3rem}.pm-studio-telemetry{justify-items:start}.pm-studio-telemetry>div{width:min(190px,100%)}.pm-workbench{grid-template-columns:1fr}.pm-rail{grid-template-columns:42px 1fr;gap:12px;padding:17px 16px;border-right:0;border-bottom:1px solid rgba(214,244,185,.15)}.pm-rail>div:nth-child(2){min-width:0}.pm-rail label,.pm-rail-tip{grid-column:1/-1}.pm-studio-main{padding:18px 14px}.pm-studio-title{align-items:flex-start;flex-direction:column}.pm-studio .pm-savebar{padding:15px 16px}.pm-measure-pill{align-self:flex-start}.pm-family-nav{grid-template-columns:repeat(2,minmax(0,1fr))}.pm-consumos-deck .pm-tallas{grid-template-columns:repeat(4,minmax(0,1fr))}.pm-consumos-deck .pm-familia-tallas{min-height:0}.pm-capture-deck-top{align-items:flex-start;flex-direction:column}}
  @media(max-width:900px){.pm-identidad-bar{grid-template-columns:repeat(2,minmax(0,1fr));padding:16px}.pm-identidad-intro{grid-column:1/-1}.pm-workbench-nuevo .pm-studio-main{padding:18px 16px}}@media(max-width:560px){.pm-identidad-bar{grid-template-columns:1fr}.pm-identidad-bar .pm-rail-progress{width:100%}.pm-workbench-nuevo .pm-material-edit{padding:13px}.pm-workbench-nuevo .pm-familia-tallas{padding:12px}.pm-workbench-nuevo .pm-tallas{gap:7px}.pm-workbench-nuevo .pm-tallas input{min-height:42px}.pm-card-nueva{border-radius:16px}.pm-card-hero h4{font-size:1.65rem}.pm-card-kpi{margin:0 14px}.pm-card-materiales{margin:0 14px}.pm-card-details,.pm-card-support{margin:0 14px}.pm-card-nueva .pm-notas{margin:0 14px 14px}}
  `;
  document.head.appendChild(css);

  function tallasInputs(grupo, titulo, tipo, valores) {
    const tallas = st.datos.tallas[tipo];
    return '<div class="pm-grupo"><b>' + titulo + '</b><div class="pm-tallas">' + tallas.map((t, i) =>
      '<label>' + esc(t) + '<input type="text" inputmode="decimal" data-g="' + grupo + '" data-i="' + i + '" placeholder="0,00" value="' + (valores && valores[i] ? esc(String(valores[i]).replace('.', ',')) : '') + '"></label>').join('') + '</div></div>';
  }

  function tallasMaterial(indice, grupo, titulo, tipo, valores) {
    const tallas = st.datos.tallas[tipo];
    const extras = (arguments[5] || []);
    return '<div class="pm-grupo"><b>' + titulo + '</b><div class="pm-tallas" data-tallas-grupo="' + grupo + '">' + tallas.map((t, i) =>
      '<label>' + esc(t) + '<input type="text" inputmode="decimal" data-mg="' + grupo + '" data-mi="' + indice + '" data-ti="' + i + '" placeholder="0,00" value="' + (valores && valores[i] ? esc(String(valores[i]).replace('.', ',')) : '') + '"></label>').join('') + extras.map(x => tallaExtraHtml(indice, grupo, x.talla, x.consumo)).join('') + '<button type="button" class="pm-add-size" data-agregar-talla data-grupo="' + grupo + '" data-indice="' + indice + '" title="Agregar talla" aria-label="Agregar talla">+</button></div></div>';
  }

  function tallaExtraHtml(indice, grupo, talla, consumo) {
    return '<label class="pm-talla-extra"><span>' + esc(talla) + '</span><button type="button" class="pm-quitar-talla" data-quitar-talla aria-label="Quitar talla ' + esc(talla) + '">×</button><input type="text" inputmode="decimal" data-mg="' + grupo + '" data-mi="' + indice + '" data-extra-talla="' + esc(talla) + '" placeholder="0,00" value="' + (consumo ? esc(String(consumo).replace('.', ',')) : '') + '"></label>';
  }

  function familiaTallas(indice, titulo, grupos, material) {
    const familia = grupos[0][0];
    const total = grupos.reduce((suma, [g, , tipo]) => suma + st.datos.tallas[tipo].length + ((material.extras || {})[g] || []).length, 0);
    return '<section class="pm-familia-tallas" data-familia="' + familia + '"><div class="pm-familia-titulo"><span>' + titulo + '</span><span class="pm-family-status" data-family-status><i></i><b>0 / ' + total + '</b></span><button type="button" class="pm-completar" data-completar-familia="' + indice + '" data-familias="' + grupos.map(([g]) => g).join(',') + '">RELLENAR VACÍOS</button></div><div class="pm-family-track"><i data-family-track></i></div>' + grupos.map(([g, nombre, tipo]) => tallasMaterial(indice, g, nombre, tipo, material[g], (material.extras || {})[g] || [])).join('') + '</section>';
  }

  function editorMaterial(material, indice) {
    const m = material || {};
    const esFusionado = !!m.fusionado || String(m.tela || '').trim().toUpperCase() === 'FUSIONADO';
    const identificador = m.material || 'M1';
    return '<section class="pm-material-edit' + (esFusionado ? ' is-fusionado' : '') + '" data-material-edit="' + indice + '"><div class="pm-material-edit-head"><div><span class="pm-material-index">' + esc(identificador) + '</span><b>CONSUMO POR UNIDAD</b><small>Registra el metraje real de cada talla.</small></div><div class="pm-material-live" data-material-live><span data-live-progress>0 / 32 tallas</span><strong data-live-avg>0,00 MTS</strong><small data-live-last>ESPERANDO MEDICIONES</small></div><button class="pm-ico" type="button" data-quitar-material title="Quitar material" aria-label="Quitar material">×</button></div>' +
      '<div class="pm-material-identidad"><label>Identificador<input type="hidden" data-material-id value="' + esc(identificador) + '"><span class="pm-material-code">' + esc(identificador) + '<small>material independiente</small></span></label><input type="hidden" data-material-tela value="' + esc(m.tela || '') + '"><label class="pm-fusionado-check"><input type="checkbox" data-material-fusionado' + (esFusionado ? ' checked' : '') + '> FUSIONADO <small>segunda sublimación</small></label></div><div class="pm-capture-deck"><div class="pm-capture-deck-top"><div><span class="pm-section-kicker">CAPTURA POR BLOQUES</span><b>Elige la familia que vas a medir</b></div><small>Enter avanza al siguiente dato.</small></div><nav class="pm-family-nav">' + GRUPOS.map(([g, nombre, tipo], posicion) => '<button type="button" class="' + (posicion === 0 ? 'active' : '') + '" data-seleccionar-familia="' + g + '"><span>' + esc(nombre.split('·')[0].trim()) + '</span><b data-tab-progress="' + g + '">0 / ' + st.datos.tallas[tipo].length + '</b><i></i></button>').join('') + '</nav><div class="pm-consumos pm-consumos-deck" data-active-family="nino">' + GRUPOS.map(([g, nombre, tipo]) => familiaTallas(indice, nombre, [[g, nombre, tipo]], m)).join('') + '</div></div></section>';
  }

  function sincronizarMaterialActivo(form, preferido) {
    if (!form) return;
    const secciones = [...form.querySelectorAll('[data-material-edit]')];
    const materiales = secciones.map(seccion => seccion.querySelector('[data-material-id]')?.value).filter(Boolean);
    const activo = materiales.includes(preferido) ? preferido : materiales.includes(st.materialActivo) ? st.materialActivo : materiales[0];
    if (!activo) return;
    st.materialActivo = activo;
    secciones.forEach(seccion => seccion.classList.toggle('is-active-material', seccion.querySelector('[data-material-id]')?.value === activo));
    const selector = form.querySelector('[data-seleccionar-material]');
    if (selector) {
      selector.innerHTML = materiales.map(material => '<option value="' + esc(material) + '">' + esc(material) + '</option>').join('');
      selector.value = activo;
    }
  }

  function materialesFormulario(m) {
    const base = m && Array.isArray(m.materiales) && m.materiales.length ? m.materiales : [{ material: 'M1', tela: '', fem: m?.fem, masc: m?.masc, nina: m?.nina, nino: m?.nino }];
    return '<section class="pm-materiales-editor"><div class="pm-materiales-editor-head"><div><span class="pm-section-kicker">PASO 2 · CONSUMOS</span><b>MATERIALES Y PROMEDIOS POR TALLA</b><small>Registra M1, M2, M3… y el consumo real por talla. La variante de tela puede cambiar sin modificar este maestro.</small></div><button class="pm-btn pm-add-material" type="button" data-agregar-material><span>＋</span> AGREGAR MATERIAL</button></div><div class="pm-material-picker"><label>Material que estás midiendo<select data-seleccionar-material aria-label="Seleccionar material"></select></label><small>Solo se muestra un material a la vez.</small></div><div data-materiales-editor>' + base.map((material, indice) => editorMaterial(material, indice)).join('') + '</div></section>';
  }

  function formulario() {
    const m = st.editando ? st.datos.maestros.find(x => x.ref === st.editando) : null;
    const t = k => esc(m ? m[k] : (k === 'ref' ? st.prefill : ''));
    if (!st.puedeEditar || (!m && !st.nueva)) return '';
    return '<form class="pm-form pm-studio" data-form autocomplete="off">' +
      '<div class="pm-studio-top"><div><span class="pm-section-kicker">PROMEDIOS MAESTROS · ' + (m ? 'MODO EDICIÓN' : 'NUEVO REGISTRO') + '</span><h3>' + (m ? 'MAESTRO ' + esc(m.ref) : 'NUEVA REFERENCIA') + '</h3></div><div class="pm-studio-telemetry" data-form-progress><span class="pm-form-state">' + (m ? 'EDITANDO' : 'SIN GUARDAR') + '</span><b data-form-progress-text>0% COMPLETO</b><div><i data-form-progress-bar></i></div></div></div>' +
      '<div class="pm-workbench pm-workbench-nuevo"><section class="pm-identidad-bar"><div class="pm-identidad-intro"><span class="pm-section-kicker">01 · IDENTIDAD</span><b>Define el maestro</b><small>La referencia y diseño organizan las mediciones.</small></div><label>Referencia base / maestro<input type="text" name="ref" maxlength="14" placeholder="Ej: BZ03" value="' + t('ref') + '"' + (m ? ' readonly' : '') + ' required></label>' +
      '<label>Diseño<select name="diseno"><option value=""' + (!(m && m.diseno) ? ' selected' : '') + '>Sin diseño fijo</option>' + st.datos.disenos.map(d => '<option' + ((m && m.diseno) === d ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></label><div class="pm-rail-progress" data-rail-progress><span>AVANCE DEL MAESTRO</span><strong>0% COMPLETO</strong><div><i></i></div><small>Las tallas registradas se guardan por material.</small></div></section>' +
      '<main class="pm-studio-main"><div class="pm-studio-title"><div><span class="pm-section-kicker">02 · MEDICIONES</span><b>Materiales y consumo real</b><small>Agrega solo los materiales que usa esta referencia. Marca Fusionado cuando corresponda.</small></div><span class="pm-measure-pill">POR UNIDAD</span></div>' + materialesFormulario(m) +
      '<details class="pm-extras"><summary><span><b>Archivos, complementos y reglas</b><small>Opcional · se conservan para los agentes y la producción</small></span><i>⌄</i></summary><div class="pm-extras-body"><div class="pm-fila"><label>Plantilla masculino<input name="p_masculino" placeholder="Ej: PLANTILLA_MASCULINO.ai" value="' + t('p_masculino') + '"></label>' +
      '<label>Plantilla femenino<input name="p_femenino" placeholder="Peto (Ej: PE03F.ai)" value="' + t('p_femenino') + '"><input name="p_femenino_short" placeholder="Short (Ej: SHT01F.ai)" value="' + t('p_femenino_short') + '"></label>' +
      '<label>Plantilla niño<input name="p_nino" placeholder="Ej: PLANTILLA_NINO.ai" value="' + t('p_nino') + '"></label>' +
      '<label>Plantilla niña<input name="p_nina" placeholder="Peto (Ej: PLANTILLA_NINA.ai)" value="' + t('p_nina') + '"><input name="p_nina_short" placeholder="Short (Ej: SHT01N.ai)" value="' + t('p_nina_short') + '"></label></div>' +
      '<div class="pm-fila"><label>Complemento adulto<input name="c_adulto" placeholder="Ej: PERILLAS ADULTO.ai" value="' + t('c_adulto') + '"></label>' +
      '<label>Complemento niño<input name="c_nino" placeholder="Ej: PERILLAS DE NIÑO.ai" value="' + t('c_nino') + '"></label></div>' +
      '<div class="pm-fila" style="grid-template-columns:minmax(180px,240px) 1fr"><label>Nota / regla para esta referencia (opcional)<select name="nota_tipo">' + st.datos.tipos_nota.map(x => '<option value="' + x + '">' + esc(NOMBRE_NOTA[x] || x) + '</option>').join('') + '</select></label>' +
      '<label>&nbsp;<input name="nota_texto" maxlength="500" placeholder="Ej: esta referencia se corta a mano, no lleva plotter"></label></div></div></details></main></div>' +
      '<div class="pm-acciones pm-savebar"><div><span class="pm-section-kicker">03 · CONFIRMAR</span><small>Al guardar, el promedio se calcula con los valores registrados.</small></div><button class="pm-btn" type="button" data-cancelar>DESCARTAR</button><button class="pm-btn pri" type="submit">' + (m ? 'GUARDAR CAMBIOS' : 'CREAR MAESTRO') + '</button></div>' +
      '<div class="pm-msg' + (st.mensaje.startsWith('✓') ? ' ok' : st.mensaje ? ' err' : '') + '" data-msg>' + esc(st.mensaje) + '</div></form>';
  }

  function tarjeta(m) {
    const notas = st.datos.notas.filter(n => n.ref === m.ref);
    const grupos = GRUPOS.map(([g, titulo, tipo]) => {
      const tallas = st.datos.tallas[tipo];
      const extras = (m.extras || {})[g] || [];
      if (!(m[g] || []).some(v => v) && !extras.some(x => x.consumo)) return '';
      return '<div class="pm-grupo"><b>' + titulo + '</b><div class="pm-chips">' + tallas.map((t, i) => '<div class="pm-chip">' + esc(t) + '<span>' + (m[g][i] ? num(m[g][i]) : '—') + '</span></div>').join('') + extras.map(x => '<div class="pm-chip">' + esc(x.talla) + '<span>' + (x.consumo ? num(x.consumo) : '—') + '</span></div>').join('') + '</div></div>';
    }).join('');
    const plantillas = [['Masculino', m.p_masculino], ['Femenino', [m.p_femenino, m.p_femenino_short].filter(Boolean).join(' + ')], ['Niño', m.p_nino], ['Niña', [m.p_nina, m.p_nina_short].filter(Boolean).join(' + ')],
      ['Complemento adulto', m.c_adulto], ['Complemento niño', m.c_nino]].filter(x => x[1]).map(x => '<div><b>' + x[0] + ':</b> ' + esc(x[1]) + '</div>').join('');
    const conValores = material => GRUPOS.some(([g]) => (material[g] || []).some(v => v) || ((material.extras || {})[g] || []).some(x => x.consumo));
    const materiales = (m.materiales || []).filter(conValores).sort((a, b) => (a.material === 'M4' ? 1 : b.material === 'M4' ? -1 : String(a.material).localeCompare(String(b.material)))).map(material => {
      const esFusionado = !!material.fusionado || String(material.tela || '').trim().toUpperCase() === 'FUSIONADO' || material.material === 'M4';
      const etiqueta = esFusionado ? 'FUSIONADO · ' + material.material : material.material;
      const valores = GRUPOS.flatMap(([g]) => [...(material[g] || []), ...((material.extras || {})[g] || []).map(x => x.consumo)]).filter(v => Number(v));
      const promedioMaterial = valores.length ? valores.reduce((s, v) => s + Number(v), 0) / valores.length : 0;
      const detalle = GRUPOS.map(([g, titulo, tipo]) => {
        const extras = (material.extras || {})[g] || [];
        if (!(material[g] || []).some(v => v) && !extras.some(x => x.consumo)) return '';
        const tallas = st.datos.tallas[tipo];
        return '<div class="pm-grupo"><b>' + esc(titulo) + '</b><div class="pm-chips">' + tallas.map((t, i) => '<div class="pm-chip">' + esc(t) + '<span>' + (material[g][i] ? num(material[g][i]) : '—') + '</span></div>').join('') + extras.map(x => '<div class="pm-chip">' + esc(x.talla) + '<span>' + (x.consumo ? num(x.consumo) : '—') + '</span></div>').join('') + '</div></div>';
      }).join('');
      return '<details class="pm-material' + (esFusionado ? ' fusionado' : '') + '"><summary><span>' + esc(etiqueta) + '</span><em>' + num(promedioMaterial) + ' MTS</em></summary>' + detalle + '</details>';
    }).join('');
    const cantidadMateriales = (m.materiales || []).filter(conValores).length;
    const detalleDiseno = m.diseno ? ' · ' + esc(m.diseno) : '';
    const badgeDiseno = m.diseno ? '<span class="pm-badge">' + esc(m.diseno) + '</span>' : '';
    return '<article class="pm-card pm-card-nueva" data-ref="' + esc(m.ref) + '"><header class="pm-card-hero"><div><small>REFERENCIA MAESTRA</small><h4>' + esc(m.ref) + '</h4><span class="pm-card-caption">' + cantidadMateriales + ' MATERIAL' + (cantidadMateriales === 1 ? '' : 'ES') + detalleDiseno + '</span></div><div class="pm-card-actions">' + badgeDiseno +
      (st.puedeEditar ? '<button class="pm-ico" type="button" data-editar="' + esc(m.ref) + '" title="Editar" aria-label="Editar ' + esc(m.ref) + '">✎</button><button class="pm-ico" type="button" data-borrar="' + esc(m.ref) + '" title="Eliminar" aria-label="Eliminar ' + esc(m.ref) + '">🗑</button>' : '') + '</div></header>' +
      '<section class="pm-card-kpi"><div><small>PROMEDIO GENERAL</small><strong>' + num(m.promedio) + '<em>MTS</em></strong><span>Consumo estimado por unidad</span></div><i>◒</i></section>' +
      (materiales ? '<section class="pm-materiales pm-card-materiales"><div class="pm-materiales-title"><b>MATERIALES REGISTRADOS</b><span>toca para ver tallas</span></div>' + materiales + '</section>' : '<div class="pm-card-empty">Aún no hay consumos por material.</div>') +
      '<details class="pm-prom pm-card-details"' + (st.abierto[m.ref] ? ' open' : '') + ' data-det="' + esc(m.ref) + '"><summary>VER CONSUMOS POR TALLA <em>›</em></summary><div class="pm-card-groups">' + grupos + '</div></details>' +
      (plantillas ? '<details class="pm-card-support"><summary>ARCHIVOS Y COMPLEMENTOS</summary><div class="pm-plant">' + plantillas + '</div></details>' : '') +
      (notas.length ? '<div class="pm-notas">' + notas.map(n => '<div class="pm-nota"><div><i>' + esc(NOMBRE_NOTA[n.tipo] || n.tipo) + '</i>' + esc(n.texto) + '</div>' + (st.puedeEditar ? '<button type="button" data-nota-borrar="' + esc(n.id) + '" title="Quitar nota">✕</button>' : '') + '</div>').join('') + '</div>' : '') + '</article>';
  }

  function pintar(conservarForm) {
    if (!st.datos) return;
    const q = plano(st.buscar).trim();
    const lista = st.datos.maestros.filter(m => !q || plano(m.ref + ' ' + m.diseno + ' ' + m.p_masculino + ' ' + m.p_femenino + ' ' + m.p_nino + ' ' + m.p_nina).includes(q));
    const host = panel.querySelector('.pm');
    const formViejo = conservarForm ? host.querySelector('[data-form]') : null;
    host.innerHTML = '<div class="pm-head"><div><small>EDICIÓN · INTELIGENCIA</small><h2>PROMEDIOS MAESTROS</h2><p>Promedios por maestro, material y talla. ' + st.datos.maestros.length + ' maestros registrados.</p></div><div class="pm-head-actions"><input type="search" data-buscar placeholder="Buscar referencia..." value="' + esc(st.buscar) + '">' + (st.puedeEditar ? '<button class="pm-btn pri" type="button" data-nueva-referencia>REGISTRAR NUEVA REFERENCIA</button>' : '') + '</div></div>' +
      bannerPendientes() + '<div data-form-lugar></div><section class="pm-lista">' + (lista.map(tarjeta).join('') || '<div class="pm-vacio" style="grid-column:1/-1">Ninguna referencia coincide con la búsqueda.</div>') + '</section>';
    const destino = host.querySelector('[data-form-lugar]');
    if (formViejo) destino.appendChild(formViejo); else destino.innerHTML = formulario();
    sincronizarMaterialActivo(host.querySelector('[data-form]'));
    const caja = host.querySelector('[data-buscar]');
    if (document.activeElement === document.body && st.buscar) { caja.focus(); caja.setSelectionRange(st.buscar.length, st.buscar.length); }
    actualizarResumenesMateriales();
  }

  // Referencias que aún usan el promedio general de su ficha: se ven aquí para cargar su maestro talla por talla
  function bannerPendientes() {
    return '';   // el aviso «referencias sin maestro talla por talla» ya no se muestra
    const lista = st.pendientes;
    if (!lista || !lista.length) return '';
    return '<section class="pm-pend"><div class="pm-pend-cab"><b>' + lista.length + ' referencia' + (lista.length === 1 ? '' : 's') + ' sin maestro talla por talla</b><span>Mientras tanto usan el promedio general de su ficha. Cárguelas aquí cuando tenga los consumos.</span></div>' +
      (st.puedeEditar ? '<button type="button" class="pm-pend-todas" data-pend-todas>REGISTRAR TODAS CON EL PROMEDIO GENERAL</button>' : '') +
      lista.map(x => '<div class="pm-pend-fila"><div><b>' + esc(x.ref) + '</b><small>' + esc(x.tela) + ' · ' + (x.general ? 'promedio general de ficha ' + esc(String(x.general).replace('.', ',')) + ' MTS' : 'sin ficha ni maestro') + '</small><small>Órdenes: ' + esc(x.ordenes.join(', ')) + '</small></div>' +
      (st.puedeEditar ? '<button type="button" class="pm-pend-cargar" data-pend-cargar="' + esc(x.ref) + '">CARGAR MAESTRO</button>' : '') + '</div>').join('') + '</section>';
  }

  async function cargar() {
    const host = panel.querySelector('.pm');
    if (!st.datos) host.innerHTML = '<div class="pm-vacio">Cargando promedios…</div>';
    try { st.datos = await api('/api/promedios'); pintar(false); } catch (e) { host.innerHTML = '<div class="pm-vacio">' + esc(e.message) + '</div>'; return; }
    st.pendientes = st.datos.pendientes_maestro || []; pintar(false);
  }

  function leerForm(form) {
    const cuerpo = { ref: form.ref.value, diseno: form.diseno.value };
    ['p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short', 'c_adulto', 'c_nino'].forEach(k => { cuerpo[k] = form[k].value; });
    cuerpo.materiales = [...form.querySelectorAll('[data-material-edit]')].map(seccion => {
      const indice = seccion.dataset.materialEdit;
      const material = { material: seccion.querySelector('[data-material-id]').value, tela: seccion.querySelector('[data-material-tela]').value.trim(), fusionado: !!seccion.querySelector('[data-material-fusionado]')?.checked };
      material.extras = {};
      GRUPOS.forEach(([g, , tipo]) => {
        material[g] = st.datos.tallas[tipo].map((_, i) => seccion.querySelector('[data-mg="' + g + '"][data-mi="' + indice + '"][data-ti="' + i + '"]').value.trim().replace(',', '.') || '0');
        const extras = [...seccion.querySelectorAll('[data-mg="' + g + '"][data-mi="' + indice + '"][data-extra-talla]')].map(input => ({ talla: input.dataset.extraTalla, consumo: input.value.trim().replace(',', '.') || '0' }));
        if (extras.length) material.extras[g] = extras;
      });
      return material;
    });
    const principal = cuerpo.materiales.find(material => material.material === 'M1') || cuerpo.materiales[0];
    GRUPOS.forEach(([g, , tipo]) => { cuerpo[g] = (principal && principal[g]) || st.datos.tallas[tipo].map(() => '0'); });
    cuerpo.extras = (principal && principal.extras) || {};
    return cuerpo;
  }

  async function guardar(form) {
    const boton = form.querySelector('[type=submit]');
    boton.disabled = true; st.mensaje = '';
    try {
      const cuerpo = leerForm(form);
      const r = await api('/api/promedios/maestro', { method: 'POST', body: JSON.stringify(cuerpo) });
      if (form.nota_texto.value.trim()) await api('/api/promedios/nota', { method: 'POST', body: JSON.stringify({ ref: cuerpo.ref, tipo: form.nota_tipo.value, texto: form.nota_texto.value }) });
      st.mensaje = '✓ ' + (r.creado ? 'Referencia agregada' : 'Cambios guardados') + ' · promedio ' + num(r.maestro.promedio) + ' MTS';
      st.editando = null; st.nueva = false; st.prefill = ''; st.datos = await api('/api/promedios');
      st.pendientes = st.datos.pendientes_maestro || [];
      pintar(false);
    } catch (e) { st.mensaje = e.message; const m = form.querySelector('[data-msg]'); m.textContent = e.message; m.className = 'pm-msg err'; boton.disabled = false; }
  }

  function valorCampo(input) {
    return Number(String(input?.value || '').trim().replace(',', '.')) || 0;
  }

  function actualizarResumenMaterial(seccion, inputActivo) {
    if (!seccion) return;
    const inputs = [...seccion.querySelectorAll('[data-mg]')];
    const valores = inputs.map(valorCampo).filter(valor => valor > 0);
    const promedio = valores.length ? valores.reduce((suma, valor) => suma + valor, 0) / valores.length : 0;
    seccion.classList.toggle('has-values', valores.length > 0);
    inputs.forEach(input => input.classList.toggle('pm-input-listo', valorCampo(input) > 0));
    const vivo = seccion.querySelector('[data-material-live]');
    if (!vivo) return;
    const progreso = vivo.querySelector('[data-live-progress]');
    const media = vivo.querySelector('[data-live-avg]');
    if (progreso) progreso.textContent = valores.length + ' / ' + inputs.length + ' tallas';
    if (media) media.textContent = num(promedio) + ' MTS';
    const ultimo = vivo.querySelector('[data-live-last]');
    if (ultimo && inputActivo && seccion.contains(inputActivo)) {
      const talla = [...inputActivo.closest('label').childNodes].find(n => n.nodeType === Node.TEXT_NODE)?.textContent?.trim() || 'TALLA';
      ultimo.textContent = valorCampo(inputActivo) > 0 ? 'ÚLTIMA: TALLA ' + talla : 'TALLA ' + talla + ' SIN DATO';
    } else if (ultimo && valores.length) ultimo.textContent = 'REGISTRO ACTIVO';
    else if (ultimo) ultimo.textContent = 'ESPERANDO MEDICIONES';
    seccion.querySelectorAll('.pm-familia-tallas').forEach(familia => {
      const campos = [...familia.querySelectorAll('[data-mg]')];
      const llenos = campos.filter(input => valorCampo(input) > 0).length;
      familia.classList.toggle('is-complete', llenos === campos.length && campos.length > 0);
      const estado = familia.querySelector('[data-family-status] b');
      const barra = familia.querySelector('[data-family-track]');
      if (estado) estado.textContent = llenos + ' / ' + campos.length;
      if (barra) barra.style.width = (campos.length ? (llenos / campos.length) * 100 : 0) + '%';
      const tabProgreso = seccion.querySelector('[data-tab-progress="' + familia.dataset.familia + '"]');
      if (tabProgreso) {
        tabProgreso.textContent = llenos + ' / ' + campos.length;
        const boton = tabProgreso.closest('button');
        if (boton) boton.style.setProperty('--pm-progress', (campos.length ? (llenos / campos.length) * 100 : 0) + '%');
      }
    });
  }

  function actualizarResumenesMateriales(inputActivo) {
    panel?.querySelectorAll('[data-material-edit]').forEach(seccion => actualizarResumenMaterial(seccion, inputActivo));
    const form = panel?.querySelector('[data-form]');
    if (!form) return;
    const campos = [...form.querySelectorAll('[data-mg]')];
    const llenos = campos.filter(input => valorCampo(input) > 0).length;
    const porcentaje = campos.length ? Math.round((llenos / campos.length) * 100) : 0;
    const texto = form.querySelector('[data-form-progress-text]');
    const barra = form.querySelector('[data-form-progress-bar]');
    if (texto) texto.textContent = porcentaje + '% COMPLETO · ' + llenos + ' TALLAS';
    if (barra) barra.style.width = porcentaje + '%';
    const rail = form.querySelector('[data-rail-progress]');
    if (rail) {
      const railTexto = rail.querySelector('strong');
      const railBarra = rail.querySelector('i');
      if (railTexto) railTexto.textContent = porcentaje + '% COMPLETO';
      if (railBarra) railBarra.style.width = porcentaje + '%';
    }
  }

  function build() {
    const anchor = document.querySelector('nav.tabs .tab[data-kind="produccion"]')?.closest('.nav-group') || document.querySelector('nav.tabs .nav-group:last-child');
    const main = document.querySelector('main');
    if (!anchor || !main) return false;
    if (document.querySelector('.tab[data-kind="promedios"]')) return true;
    panel = document.createElement('section'); panel.className = 'panel'; panel.dataset.panel = 'promedios';
    panel.innerHTML = '<div class="pm"></div>';
    main.appendChild(panel);
    const group = document.createElement('div'); group.className = 'nav-group';
    group.innerHTML = '<button class="tab" data-kind="promedios" type="button"><span class="nav-icon">PM</span><strong>PROMEDIOS MAESTROS</strong></button>';
    anchor.insertAdjacentElement('afterend', group);
    tab = group.querySelector('.tab');
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panel));
      document.body.classList.remove('inicio-mode', 'inventory-mode', 'production-mode', 'schedule-mode', 'operarios-mode', 'cartera-mode', 'trace-cards-mode');
      cargar();
    });
    panel.addEventListener('click', async e => {
      const editar = e.target.closest('[data-editar]'), borrar = e.target.closest('[data-borrar]'), nota = e.target.closest('[data-nota-borrar]');
      if (e.target.closest('[data-nueva-referencia]')) { st.editando = null; st.nueva = true; st.prefill = ''; st.materialActivo = ''; st.mensaje = ''; pintar(false); panel.querySelector('[data-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const selectorFamilia = e.target.closest('[data-seleccionar-familia]');
      if (selectorFamilia) {
        const material = selectorFamilia.closest('[data-material-edit]');
        const cubierta = material?.querySelector('[data-active-family]');
        if (cubierta) cubierta.dataset.activeFamily = selectorFamilia.dataset.seleccionarFamilia;
        material?.querySelectorAll('[data-seleccionar-familia]').forEach(boton => boton.classList.toggle('active', boton === selectorFamilia));
        return;
      }
      const completar = e.target.closest('[data-completar-familia]');
      if (completar) {
        const seccion = completar.closest('[data-material-edit]');
        const grupos = String(completar.dataset.familias || '').split(',').filter(Boolean);
        const texto = prompt('Metraje que deseas aplicar únicamente a las tallas vacías (MTS):', '');
        if (texto === null) return;
        const valor = String(texto).trim().replace(',', '.');
        if (!valor || Number.isNaN(Number(valor)) || Number(valor) < 0) { st.mensaje = 'Escribe un metraje válido.'; return; }
        grupos.forEach(grupo => seccion?.querySelectorAll('[data-mg="' + grupo + '"]').forEach(input => { if (!valorCampo(input)) input.value = valor; }));
        actualizarResumenesMateriales();
        return;
      }
      const agregarTalla = e.target.closest('[data-agregar-talla]');
      if (agregarTalla) {
        const grupo = agregarTalla.dataset.grupo;
        const tipo = GRUPOS.find(([g]) => g === grupo)?.[2];
        const texto = prompt('Nombre de la nueva talla (ej.: 5XL, 6XL, 18 o ÚNICA):', '');
        if (texto === null) return;
        const talla = String(texto).trim().replace(/\s+/g, '').toUpperCase();
        const estandar = st.datos.tallas[tipo] || [];
        const contenedor = agregarTalla.closest('[data-tallas-grupo]');
        const existentes = [...contenedor.querySelectorAll('[data-extra-talla]')].map(input => input.dataset.extraTalla);
        if (!/^[A-Z0-9+\-]{1,10}$/.test(talla) || estandar.includes(talla) || existentes.includes(talla)) {
          alert('Escribe una talla nueva válida, sin repetir las ya registradas.');
          return;
        }
        const extras = contenedor.querySelectorAll('[data-extra-talla]').length;
        if (extras >= 12) { alert('Máximo 12 tallas adicionales por familia.'); return; }
        agregarTalla.insertAdjacentHTML('beforebegin', tallaExtraHtml(agregarTalla.dataset.indice, grupo, talla, ''));
        actualizarResumenesMateriales();
        const nuevo = contenedor.querySelector('[data-extra-talla="' + CSS.escape(talla) + '"]');
        nuevo?.focus();
        return;
      }
      const quitarTalla = e.target.closest('[data-quitar-talla]');
      if (quitarTalla) {
        quitarTalla.closest('.pm-talla-extra')?.remove();
        actualizarResumenesMateriales();
        return;
      }
      const agregarMaterial = e.target.closest('[data-agregar-material]');
      if (agregarMaterial) {
        const form = agregarMaterial.closest('[data-form]');
        const destino = form?.querySelector('[data-materiales-editor]');
        if (!destino) return;
        const usados = [...destino.querySelectorAll('[data-material-id]')].map(x => x.value);
        const identificador = Array.from({ length: 8 }, (_, i) => 'M' + (i + 1)).find(x => !usados.includes(x));
        if (!identificador) { st.mensaje = 'Máximo 8 materiales por referencia.'; pintar(true); return; }
        const indices = [...destino.querySelectorAll('[data-material-edit]')].map(x => Number(x.dataset.materialEdit) || 0);
        destino.insertAdjacentHTML('beforeend', editorMaterial({ material: identificador, tela: '' }, (Math.max(-1, ...indices) + 1)));
        sincronizarMaterialActivo(form, identificador);
        actualizarResumenesMateriales();
        return;
      }
      const quitarMaterial = e.target.closest('[data-quitar-material]');
      if (quitarMaterial) {
        const form = quitarMaterial.closest('[data-form]');
        const secciones = quitarMaterial.closest('[data-materiales-editor]')?.querySelectorAll('[data-material-edit]') || [];
        if (secciones.length <= 1) { st.mensaje = 'La referencia debe conservar por lo menos un material.'; pintar(true); return; }
        const materialQuitado = quitarMaterial.closest('[data-material-edit]')?.querySelector('[data-material-id]')?.value;
        quitarMaterial.closest('[data-material-edit]')?.remove();
        sincronizarMaterialActivo(form, materialQuitado === st.materialActivo ? '' : st.materialActivo);
        actualizarResumenesMateriales();
        return;
      }
      if (e.target.closest('[data-pend-todas]')) {
        const refs = (st.pendientes || []).filter(x => x.general).map(x => x.ref);
        if (!refs.length) { st.mensaje = 'No hay referencias con promedio general de ficha para registrar.'; pintar(false); return; }
        try {
          const r = await api('/api/promedios/registrar-generales', { method: 'POST', body: JSON.stringify({ refs }) });
          st.mensaje = '✓ ' + r.creados.length + ' registradas con el promedio general' + (r.omitidos.length ? ' · ' + r.omitidos.length + ' sin cambios (' + r.omitidos.map(o => o.ref + ': ' + o.motivo).join('; ') + ')' : '');
          st.datos = await api('/api/promedios');
          st.pendientes = st.datos.pendientes_maestro || [];
        } catch (x) { st.mensaje = x.message; }
        pintar(false); return;
      }
      const pendCargar = e.target.closest('[data-pend-cargar]');
      if (pendCargar) { st.editando = null; st.nueva = true; st.prefill = pendCargar.dataset.pendCargar; st.materialActivo = ''; st.mensaje = ''; pintar(false); panel.querySelector('[data-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (editar) { st.editando = editar.dataset.editar; st.nueva = false; st.materialActivo = ''; st.mensaje = ''; pintar(false); panel.querySelector('[data-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (e.target.closest('[data-cancelar]')) { st.editando = null; st.nueva = false; st.prefill = ''; st.materialActivo = ''; st.mensaje = ''; pintar(false); }
      else if (borrar) {
        const ref = borrar.dataset.borrar;
        if (!confirm('¿Eliminar el maestro ' + ref + ' y sus consumos? Esta acción no se puede deshacer.')) return;
        try { await api('/api/promedios/maestro/' + encodeURIComponent(ref), { method: 'DELETE' }); st.mensaje = '✓ Maestro ' + ref + ' eliminado'; st.datos = await api('/api/promedios'); pintar(false); } catch (err) { alert(err.message); }
      } else if (nota) {
        try { await api('/api/promedios/nota/' + encodeURIComponent(nota.dataset.notaBorrar), { method: 'DELETE' }); st.datos = await api('/api/promedios'); pintar(true); } catch (err) { alert(err.message); }
      }
    });
    panel.addEventListener('toggle', e => { const d = e.target.closest?.('[data-det]'); if (d) st.abierto[d.dataset.det] = d.open; }, true);
    panel.addEventListener('submit', e => { if (e.target.matches('[data-form]')) { e.preventDefault(); guardar(e.target); } });
    panel.addEventListener('input', e => {
      if (e.target.matches('[data-mg]')) actualizarResumenesMateriales(e.target);
      if (e.target.matches('[data-buscar]')) { st.buscar = e.target.value; pintar(true); const c = panel.querySelector('[data-buscar]'); c.focus(); c.setSelectionRange(st.buscar.length, st.buscar.length); }
    });
    panel.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches('[data-mg]')) return;
      e.preventDefault();
      const material = e.target.closest('[data-material-edit]');
      const cubierta = material?.querySelector('[data-active-family]');
      const familia = cubierta?.dataset.activeFamily;
      const campos = [...(cubierta?.querySelectorAll('[data-familia="' + familia + '"] [data-mg]') || [])];
      const siguiente = campos[campos.indexOf(e.target) + 1];
      if (siguiente) { siguiente.focus(); siguiente.select(); return; }
      const botones = [...(material?.querySelectorAll('[data-seleccionar-familia]') || [])];
      const actual = botones.findIndex(boton => boton.dataset.seleccionarFamilia === familia);
      const proximo = botones[(actual + 1) % botones.length];
      if (proximo && proximo !== botones[actual]) {
        proximo.click();
        const primero = material?.querySelector('[data-familia="' + proximo.dataset.seleccionarFamilia + '"] [data-mg]');
        primero?.focus(); primero?.select();
      }
    });
    panel.addEventListener('change', e => {
      if (e.target.matches('[data-seleccionar-material]')) {
        sincronizarMaterialActivo(e.target.closest('[data-form]'), e.target.value);
        return;
      }
      const material = e.target.closest('[data-material-edit]');
      if (!material) return;
      if (e.target.matches('[data-material-fusionado]')) material.classList.toggle('is-fusionado', e.target.checked);
      if (e.target.matches('[data-material-id]')) {
        const badge = material.querySelector('.pm-material-index');
        if (badge) badge.textContent = e.target.value;
      }
    });
    return true;
  }

  function addMenuItem() {
    const menu = document.querySelector('.user-dropdown');
    if (!menu || !tab) return !!document.getElementById('open-promedios');
    if (document.getElementById('open-promedios')) return true;
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'open-promedios'; button.textContent = 'Promedios maestros';
    const anterior = document.getElementById('open-agentes') || document.getElementById('open-personal-notes');
    anterior ? anterior.insertAdjacentElement('afterend', button) : menu.querySelector('p')?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => { document.querySelector('.user-menu')?.removeAttribute('open'); tab.click(); });
    return true;
  }

  // Solo quien tiene permiso «Promedios maestros» (Administración/Coordinador y Edición, ver PERMISOS).
  fetch('/api/permisos/mi', { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(mi => {
    const p = (mi && mi.permisos && mi.permisos.promedios) || {};
    if (!p.ver) return;
    st.puedeEditar = !!p.editar;
    let tries = 0;
    const wait = setInterval(() => { if ((build() && addMenuItem()) || ++tries > 60) clearInterval(wait); }, 250);
  }).catch(() => { /* sin permisos confirmados: no se muestra */ });
})();

/* Acabado vidrio para el catálogo de referencias: mantiene el contenido y acciones intactos. */
(() => {
  const id = 'pm-vidrio-profundo';
  document.getElementById(id)?.remove();
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    body .pm-head {
      border-color: rgba(227,255,222,.28) !important;
      background: linear-gradient(118deg,rgba(255,255,255,.13),rgba(119,218,166,.06) 38%,rgba(5,21,14,.58)) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.38),0 18px 42px rgba(0,0,0,.22) !important;
      -webkit-backdrop-filter: blur(24px) saturate(1.35); backdrop-filter: blur(24px) saturate(1.35);
    }
    body .pm-card-nueva {
      border: 1px solid rgba(229,255,225,.29) !important;
      border-left: 1px solid rgba(229,255,225,.29) !important;
      border-radius: 22px !important;
      background: linear-gradient(145deg,rgba(255,255,255,.18),rgba(51,141,100,.13) 34%,rgba(4,22,14,.34) 78%) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.50),inset 0 -1px 0 rgba(171,255,175,.08),0 18px 38px rgba(0,0,0,.30) !important;
      -webkit-backdrop-filter: blur(22px) saturate(1.35); backdrop-filter: blur(22px) saturate(1.35);
    }
    body .pm-card-nueva::before { opacity:.72; background:radial-gradient(circle,rgba(186,255,166,.28),transparent 67%) !important; }
    body .pm-card-nueva::after { height:2px !important; background:linear-gradient(90deg,transparent,#d9ff72 32%,#75e0bd 68%,transparent) !important; transform:scaleX(.72) !important; }
    body .pm-card-nueva:hover { transform:translateY(-7px) scale(1.01) !important; border-color:rgba(221,255,163,.68) !important; box-shadow:inset 0 1px 0 rgba(255,255,255,.64),0 28px 52px rgba(0,0,0,.43),0 0 0 1px rgba(207,255,121,.15) !important; }
    body .pm-card-nueva:hover::after { transform:scaleX(1) !important; }
    body .pm-lista { position:relative; padding:14px; border:1px solid rgba(218,255,195,.16); border-radius:28px; background:radial-gradient(30rem 22rem at 8% 0%,rgba(197,255,102,.18),transparent 65%),radial-gradient(26rem 24rem at 94% 35%,rgba(71,216,181,.18),transparent 66%),rgba(2,18,11,.20); }
    body .pm-card-hero { padding:19px 18px 13px !important; background:linear-gradient(115deg,rgba(255,255,255,.16),rgba(210,255,119,.11),transparent 70%) !important; }
    body .pm-card-caption { border:1px solid rgba(226,255,168,.25); background:rgba(207,255,121,.13) !important; color:#ecffbd !important; }
    body .pm-card-kpi { border-color:rgba(235,255,205,.26) !important; background:linear-gradient(110deg,rgba(255,255,255,.12),rgba(125,228,190,.08)) !important; box-shadow:inset 0 1px 0 rgba(255,255,255,.22); }
    body .pm-card-kpi>i { background:rgba(217,255,114,.16) !important; box-shadow:0 8px 18px rgba(154,255,110,.12); }
    body .pm-card-materiales .pm-material,body .pm-card-details,body .pm-card-support { border-color:rgba(231,255,222,.19) !important; background:rgba(2,19,11,.34) !important; }
    body .pm-card-materiales .pm-material:hover { background:rgba(112,207,151,.14) !important; }
    body .pm-card-actions .pm-ico { border-color:rgba(234,255,214,.28) !important; background:rgba(255,255,255,.10) !important; }
    @media (max-width:600px) { body .pm-card-nueva { border-radius:18px !important; } body .pm-card-nueva:hover { transform:none !important; } }
    @media (prefers-reduced-motion:reduce) { body .pm-card-nueva { transition:none !important; } }
  `;
  document.head.appendChild(style);
})();
