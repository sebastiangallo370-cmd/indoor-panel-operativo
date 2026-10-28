(() => {
  // AGENTES unificado: un robot junto al botón del sol (cambio de tema) que abre una lista desplegable con todos los agentes agrupados por área
  // (Edición, Ecommerce, Inventario, Comercial). Cada área sigue siendo su propio panel (agentes.js, ecommerce.js, zeus.js, club-admin.js); esto solo
  // lleva a uno u otro. Solo salen las áreas a las que la cuenta tiene acceso. «Memoria de agentes» queda aparte, en el menú de la cuenta.
  if (window.__agentesHub) return;
  window.__agentesHub = true;
  const AREAS = [
    { id: 'coordinacion', kind: 'agentes', nombre: 'COORDINACIÓN', agentes: [['JEFE', 'Diagnostica y asigna las tareas']] },
    { id: 'edicion', kind: 'agentes', nombre: 'EDICIÓN', agentes: [['LEO', 'Lee el listado'], ['JACK', 'Crea la muestra'], ['OLVER', 'Mesas de trabajo'], ['OLIVER', 'Tallas, números y PDF'], ['TERRY', 'MTS y Google Sheets']] },
    // TRAZO es su propio desplegable: DRACO se atiende en el chat de Agentes, pero aparece aparte de los de Edición y deja escrito «draco » para pedirle
    { id: 'trazo', kind: 'draco', nombre: 'TRAZOS', agentes: [['DRACO', 'Trazos en Optitex Mark']] },   // su propia pantalla (draco-panel.js): cola de órdenes, DXF por talla y conversación con DRACO
    { id: 'ecommerce', kind: 'ecommerce', nombre: 'ECOMMERCE', agentes: [['ALMA', 'Descarga las órdenes'], ['BRISA', 'Exporta las tallas'], ['CIRO', 'PDF y Google Sheets']] },
    { id: 'zeus', kind: 'zeus', nombre: 'INVENTARIOS', agentes: [['ZEUS', 'Tela y órdenes de compra'], ['MINIMAXIMAN', 'Mantiene las telas entre su mínimo y su máximo', 'minimaximan'], ['STOCKMAN', 'Alinea el inventario del panel con Effi', 'stockman']] },   // el tercer dato es la pantalla propia del agente
    { id: 'club', kind: 'club', nombre: 'COMERCIAL', agentes: [['EFFITRON', 'Cotización de las reposiciones']] },
  ];
  const ROBOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4.6"/><circle cx="12" cy="3.6" r="1.1"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9.5 16.4h5M2.5 12.5v3M21.5 12.5v3"/></svg>';
  const AVATAR = { JEFE: '👑', TAVO: '🧑‍💼', LEO: '🧑‍💻', JACK: '🧑‍🎨', OLVER: '🧑‍🔧', OLIVER: '🧑‍💼', TERRY: '🧑‍💻', DRACO: '🤖', ALMA: '👩‍💼', BRISA: '👩‍💻', CIRO: '🧑‍🎨', ZEUS: '🧙', MINIMAXIMAN: '🧑‍🔬', STOCKMAN: '🧑‍💼', EFFITRON: '🤵' };
  const css = document.createElement('style');
  css.textContent = `
  #agentes-hub{position:relative;display:none;align-items:center;margin:0 6px 0 0;vertical-align:middle;z-index:1200}
  #agentes-hub.listo{display:inline-flex}
  #agentes-hub summary{flex:0 0 42px;width:42px;height:42px;padding:0;display:grid;place-items:center;list-style:none;cursor:pointer;border:1px solid rgba(208,244,76,.3);border-radius:50%;background:#10150e;color:#d0f44c;transition:transform .15s,box-shadow .15s,background .15s}
  #agentes-hub summary::-webkit-details-marker{display:none}
  #agentes-hub summary:hover{box-shadow:0 0 0 3px rgba(208,244,76,.15)}#agentes-hub summary:active{transform:scale(.92)}
  #agentes-hub[open] summary{background:#d0f44c;color:#10150e}
  #agentes-hub summary svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  #agentes-hub .ah-lista{position:absolute;right:0;left:auto;top:calc(100% + 10px);width:min(290px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;padding:8px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:linear-gradient(160deg,rgba(32,42,28,.97),rgba(12,16,10,.98));box-shadow:0 18px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.14);animation:ahIn .16s ease-out}
  #agentes-hub .ah-area{border-radius:13px;transition:background .15s}
  #agentes-hub .ah-area+.ah-area{margin-top:2px}
  #agentes-hub .ah-area.on{background:rgba(208,244,76,.1)}
  #agentes-hub .ah-fila{display:flex;align-items:center}
  #agentes-hub .ah-lista button{display:flex!important;align-items:center;gap:10px;min-width:0!important;margin:0!important;border:0!important;background:transparent!important;color:#e8f0e0!important;text-align:left;box-shadow:none!important;cursor:pointer;transition:background .12s,transform .12s}
  #agentes-hub .ah-ir{flex:1;justify-content:space-between;padding:12px 12px!important;border-radius:13px!important}
  #agentes-hub .ah-ir b{font:800 10.5px Arial!important;letter-spacing:.1em!important}
  #agentes-hub .ah-ir:hover,#agentes-hub .ah-mas:hover{background:rgba(208,244,76,.14)!important}
  #agentes-hub .ah-mas{flex:0 0 40px;width:40px!important;height:40px;justify-content:center;border-radius:11px!important;padding:0!important}
  #agentes-hub .ah-mas i{width:8px;height:8px;border-right:2px solid #d0f44c;border-bottom:2px solid #d0f44c;transform:rotate(45deg) translateY(-2px);transition:transform .2s}
  #agentes-hub .ah-area.abierta .ah-mas i{transform:rotate(-135deg) translate(-2px,-2px)}
  #agentes-hub .ah-ag{display:grid;overflow:hidden;max-height:0;opacity:0;transition:max-height .25s ease,opacity .2s}
  #agentes-hub .ah-area.abierta .ah-ag{max-height:420px;opacity:1;padding:0 4px 6px}
  #agentes-hub .ah-ag button{width:100%!important;padding:7px 10px!important;border-radius:10px!important}
  #agentes-hub .ah-ag button:hover{background:rgba(208,244,76,.14)!important;transform:translateX(2px)}
  #agentes-hub .ah-ag em{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:50%;background:rgba(208,244,76,.12);border:1px solid rgba(208,244,76,.28);font:900 11px Arial;font-style:normal;color:#d0f44c}
  #agentes-hub .ah-ag span{display:grid;gap:1px;min-width:0}
  #agentes-hub .ah-ag b{font:800 10px Arial!important;letter-spacing:.08em!important}
  #agentes-hub .ah-lista small{font:600 10px Arial;color:#9aa893}
  @keyframes ahIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  #open-ecommerce,#open-zeus,#open-minimaximan,#open-stockman,#open-agentes,#open-agentes-hub{display:none!important}   /* los agentes ya no van en el menú de la cuenta: se abren con el robot */
  .ag-general{max-width:1380px;margin:0 auto;padding:18px;color:#ecf3ed}.ag-general-head{display:flex;align-items:end;justify-content:space-between;gap:16px;padding:20px 22px;border:1px solid rgba(208,244,76,.25);border-radius:20px;background:linear-gradient(135deg,#142216,#09100b);box-shadow:0 18px 40px #0005}.ag-general-head h2{margin:0;font:900 clamp(1.45rem,3vw,2.3rem)/1 system-ui;letter-spacing:.08em}.ag-general-head p{margin:7px 0 0;color:#aebba8;font-size:.88rem}.ag-general-head small{color:#d0f44c;font:800 11px system-ui;letter-spacing:.1em}.ag-campus{position:relative;display:grid;grid-template-columns:repeat(3,minmax(190px,1fr));gap:22px;margin-top:18px;align-items:center}.ag-edificio{grid-column:2;grid-row:2;position:relative;z-index:2;min-height:205px;display:grid;place-items:center;text-align:center;border:2px solid #c8f95d;border-radius:20px;background:linear-gradient(145deg,#263e1b,#121e12);box-shadow:0 0 0 9px #baff5320,0 22px 46px #0008}.ag-edificio svg{width:76px;height:76px;fill:none;stroke:#d9ff74;stroke-width:1.4}.ag-edificio b{display:block;font:900 18px system-ui;letter-spacing:.09em}.ag-edificio span{color:#b7c6ae;font-size:12px}.ag-area-general{position:relative;z-index:2;display:grid;gap:9px;padding:13px;border:1px solid #40563c;border-radius:16px;background:linear-gradient(145deg,#152016,#0a100b);text-align:left;cursor:pointer;transition:.18s transform,.18s border-color}.ag-area-general:hover{transform:translateY(-3px);border-color:#d0f44c}.ag-area-general::after{content:"";position:absolute;z-index:-1;width:34%;height:1px;background:linear-gradient(90deg,#7ead47,transparent);top:50%;left:100%}.ag-area-general:nth-of-type(3n)::after{left:auto;right:100%;transform:rotate(180deg)}.ag-area-general strong{font:900 11px system-ui;letter-spacing:.13em;color:#d0f44c}.ag-area-general small{color:#aebaa8;font-size:11px}.ag-general-agentes{display:flex;flex-wrap:wrap;gap:5px}.ag-general-agentes span{padding:5px 7px;border:1px solid #40533d;border-radius:7px;background:#0c140d;color:#dae6d5;font:800 10px system-ui;letter-spacing:.05em}.ag-general-agentes i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#7ed14b;box-shadow:0 0 7px #7ed14b}.ag-general .a1{grid-column:1;grid-row:1}.ag-general .a2{grid-column:2;grid-row:1}.ag-general .a3{grid-column:3;grid-row:1}.ag-general .a4{grid-column:1;grid-row:2}.ag-general .a5{grid-column:3;grid-row:2}@media(max-width:780px){.ag-campus{grid-template-columns:1fr;gap:10px}.ag-edificio,.ag-general .a1,.ag-general .a2,.ag-general .a3,.ag-general .a4,.ag-general .a5{grid-column:1;grid-row:auto}.ag-edificio{min-height:160px;order:-1}.ag-area-general::after{display:none}.ag-general{padding:10px}.ag-general-head{align-items:start;flex-direction:column}}
  `;
  document.head.appendChild(css);
  const controlCss = document.createElement('style');
  controlCss.textContent = `
    .ag-general{max-width:1320px!important;padding:86px 24px 30px!important}.ag-general-head{padding:18px 20px!important;border-radius:18px!important;background:linear-gradient(110deg,#192d17,#0c140d)!important}.ag-general-head h2{font-size:clamp(1.25rem,2vw,1.8rem)!important}.ag-campus{display:grid!important;grid-template-columns:repeat(3,minmax(220px,1fr))!important;grid-template-rows:repeat(3,minmax(128px,auto))!important;gap:14px!important;margin-top:16px!important;padding:0!important;border:0!important;border-radius:0!important;background:none!important}.ag-area-general{min-height:0!important;padding:16px!important;gap:8px!important;border-color:#375337!important;border-radius:18px!important;background:linear-gradient(145deg,#111c12,#091009)!important;box-shadow:0 10px 22px #0004!important}.ag-area-general::after{display:none!important}.ag-area-general strong{font-size:12px!important}.ag-area-general strong::before{content:'●';color:#91e85b}.ag-general .a1{grid-column:2!important;grid-row:3!important}.ag-general .a2{grid-column:1!important;grid-row:1!important}.ag-general .a3{grid-column:1!important;grid-row:2!important}.ag-general .a4{grid-column:3!important;grid-row:1!important}.ag-general .a5{grid-column:3!important;grid-row:2!important}.ag-general .a6{grid-column:1!important;grid-row:3!important}.ag-edificio{grid-column:2!important;grid-row:1 / span 2!important;min-height:270px!important;border-radius:22px!important;background:linear-gradient(145deg,#203919,#101b10)!important;box-shadow:0 0 0 7px #baff5317,0 18px 34px #0008!important}.ag-edificio svg{width:64px!important;height:64px!important}.ag-edificio b{font-size:17px!important}.ag-general-agentes{gap:6px!important}.ag-general-agentes span{display:grid!important;grid-template-columns:10px 1fr!important;gap:0 5px;min-width:84px;padding:6px 8px!important}.ag-general-agentes span b.ag-muneco{grid-column:2;font-size:18px;line-height:1}.ag-general-agentes span small{grid-column:1/-1;margin-top:4px;max-width:138px;color:#9bac96;font:600 8.5px/1.2 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ag-general-agentes span.trabajando{border-color:#ffd15c!important;background:#30280f!important}.ag-jefe-chat{display:grid!important;grid-template-columns:54px minmax(0,1fr) 150px!important;gap:10px!important;align-items:stretch!important;margin-top:18px!important;padding:14px!important;border:1px solid #4f7940!important;border-radius:18px!important;background:linear-gradient(135deg,#152516,#0a110a)!important;box-shadow:0 14px 30px #0005!important}.ag-jefe-chat label{grid-column:1/-1!important;margin:0!important;color:#e3ff90!important;font:900 11px system-ui!important;letter-spacing:.12em!important}.ag-jefe-chat::before{grid-column:1!important;grid-row:2!important;content:'👑';display:grid;place-items:center;border-radius:13px;background:#cbed54;color:#17220f;font-size:25px}.ag-jefe-chat textarea{grid-column:2!important;grid-row:2!important;box-sizing:border-box!important;width:100%!important;min-width:0!important;min-height:58px!important;margin:0!important;padding:12px!important;border:1px solid #4b6744!important;border-radius:12px!important;background:#071008!important;color:#f4fff0!important;font:14px/1.35 system-ui!important;resize:vertical!important;outline:none!important}.ag-jefe-chat button{grid-column:3!important;grid-row:2!important;min-width:0!important;margin:0!important;border:0!important;border-radius:12px!important;background:linear-gradient(135deg,#e1ff72,#8dcb3b)!important;color:#12200d!important;font:900 11px system-ui!important;letter-spacing:.07em!important;cursor:pointer}.ag-jefe-respuesta{grid-column:1/-1!important;display:grid!important;gap:8px!important;max-height:260px!important;overflow:auto!important;padding:2px!important;background:transparent!important;color:#dce8d7!important}.ag-chat-msg{display:grid!important;gap:5px!important;padding:12px 14px!important;border:1px solid #2e4930!important;border-left:3px solid #d0f44c!important;border-radius:12px!important;background:#0b140c!important;font:13px/1.45 system-ui!important}.ag-chat-msg small{color:#9dbd91!important;font:800 9px system-ui!important;letter-spacing:.1em!important}.ag-chat-msg details{color:#aebea8;font-size:11px}.ag-chat-msg summary{cursor:pointer;color:#d1f26d}.ag-chat-msg p{margin:7px 0 0;white-space:pre-wrap}.ag-chat-msg.pendiente{border-left-color:#ffd15c!important;background:#201b0c!important}@media(max-width:780px){.ag-general{padding:76px 12px 20px!important}.ag-campus{grid-template-columns:1fr!important;grid-template-rows:auto!important}.ag-edificio,.ag-general .a1,.ag-general .a2,.ag-general .a3,.ag-general .a4,.ag-general .a5,.ag-general .a6{grid-column:1!important;grid-row:auto!important}.ag-edificio{min-height:170px!important;order:-1}.ag-jefe-chat{grid-template-columns:46px minmax(0,1fr)!important}.ag-jefe-chat textarea{grid-column:2!important}.ag-jefe-chat button{grid-column:1/-1!important;grid-row:auto!important;min-height:44px!important}.ag-general-agentes span{min-width:68px}}
  `;
  document.head.appendChild(controlCss);

  let caja = null, panelGeneral = null, tabGeneral = null, controlTimer = 0;
  const abiertas = new Set();   // áreas con sus agentes desplegados
  const tabDe = kind => document.querySelector('.tab[data-kind="' + kind + '"]');
  const activa = kind => !!document.querySelector('.panel[data-panel="' + kind + '"].active');
  const disponibles = () => AREAS.filter(a => tabDe(a.kind));
  const losAgentes = a => a.agentes.filter(g => !g[2] || tabDe(g[2]));   // un agente con pantalla propia solo sale si la cuenta tiene esa pantalla
  const areaActiva = a => activa(a.kind) || a.agentes.some(g => g[2] && activa(g[2]));

  function pintar() {
    const lista = disponibles();
    if (!caja) return;
    caja.classList.toggle('listo', lista.length > 0);
    if (!lista.length) return;
    const resaltada = a => !a.mensaje && areaActiva(a);   // TRAZO comparte la pantalla de Edición y no se marca como activa
    const clave = lista.map(a => a.id + losAgentes(a).length).join('|') + '>' + (lista.find(resaltada) || {}).id;
    if (caja.dataset.clave === clave) return;
    caja.dataset.clave = clave;
    const total = lista.reduce((n, a) => n + losAgentes(a).length, 0);
    // la lista muestra primero las ÁREAS (Edición, Ecommerce, Inventarios, Comercial); la flecha de cada una despliega sus agentes
    caja.innerHTML = `<summary title="Agentes (${total})" aria-label="Agentes">${ROBOT}</summary><div class="ah-lista"><button type="button" class="ah-ir" data-general><b>PANEL DE CONTROL AGENT</b><small>Todos los agentes</small></button>` +
      lista.map(a => `<div class="ah-area${abiertas.has(a.id) ? ' abierta' : ''}${resaltada(a) ? ' on' : ''}"><div class="ah-fila">` +
        `<button type="button" class="ah-ir" data-area="${a.id}"><b>${a.nombre}</b><small>${losAgentes(a).length} ${losAgentes(a).length === 1 ? 'agente' : 'agentes'}</small></button>` +
        `<button type="button" class="ah-mas" data-mas="${a.id}" title="Ver los agentes de ${a.nombre}" aria-label="Ver los agentes de ${a.nombre}"><i></i></button></div>` +
        `<div class="ah-ag">` + losAgentes(a).map(g => `<button type="button" data-area="${a.id}"${g[2] ? ` data-pantalla="${g[2]}"` : ''}><em>${g[0][0]}</em><span><b>${g[0]}</b><small>${g[1]}</small></span></button>`).join('') + '</div></div>').join('') + '</div>';
  }

  function ubicar() {
    // arriba a la derecha, justo después del sol del tema: esa zona no se redibuja nunca (los paneles sí) y siempre está a la vista
    const barra = document.querySelector('.systems');
    if (barra) {
      caja.style.display = '';
      const sol = barra.querySelector('.theme-icon');
      if (sol) { if (caja.previousElementSibling !== sol) sol.after(caja); }
      else if (caja.parentElement !== barra || caja !== barra.firstElementChild) barra.insertBefore(caja, barra.firstChild);
      return;
    }
    // sin la barra de arriba (pantallas angostas): solo se muestra encima del panel cuando se está en una pantalla de agentes
    const enAgentes = AREAS.some(a => areaActiva(a)), main = document.querySelector('main');
    caja.style.display = enAgentes ? '' : 'none';
    if (main && enAgentes && caja.parentElement !== main) main.prepend(caja);
  }

  function montar() {
    if (!document.querySelector('main')) return;
    if (!caja) {
      caja = document.createElement('details');
      caja.id = 'agentes-hub';
      caja.addEventListener('click', e => {
        if (e.target.closest('[data-general]')) { caja.removeAttribute('open'); abrirGeneral(); return; }
        const mas = e.target.closest('[data-mas]');
        if (mas) {   // la flecha despliega o pliega los agentes del área (sin cambiar de pantalla)
          const k = mas.dataset.mas, fila = mas.closest('.ah-area');
          abiertas.has(k) ? abiertas.delete(k) : abiertas.add(k);
          fila.classList.toggle('abierta', abiertas.has(k));
          return;
        }
        const b = e.target.closest('[data-area]');
        if (!b) return;
        caja.removeAttribute('open');
        const area = AREAS.find(a => a.id === b.dataset.area);
        const t = area && tabDe(b.dataset.pantalla || area.kind);   // un agente con pantalla propia (MINIMAXIMAN) abre la suya; los demás, la del área
        if (t) t.click();
        if (area && area.mensaje) {   // TRAZO: abre el chat de Agentes y deja escrito «draco » para pedirle lo que necesites
          setTimeout(() => {
            const caja = document.querySelector('.panel[data-panel="' + area.kind + '"] textarea');
            if (caja) { if (!caja.value.trim()) { caja.value = area.mensaje; caja.dispatchEvent(new Event('input', { bubbles: true })); } caja.focus(); }
          }, 350);
        }
      });
      document.addEventListener('click', e => { if (caja.open && !caja.contains(e.target)) caja.removeAttribute('open'); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') caja.removeAttribute('open'); });
    }
    pintar();
    crearPanelGeneral();
    ubicar();
    // el menú de la cuenta ya no lista los agentes (Edición, Ecommerce, Inventarios): se abren con el robot junto al sol
  }
  function abrirArea(area) {
    const t = area && tabDe(area.kind);
    if (t) t.click();
    if (area && area.mensaje) setTimeout(() => { const entrada = document.querySelector('.panel[data-panel="' + area.kind + '"] textarea'); if (entrada) { entrada.value = entrada.value || area.mensaje; entrada.dispatchEvent(new Event('input', { bubbles: true })); entrada.focus(); } }, 350);
  }
  function abrirGeneral() {
    if (!panelGeneral || !tabGeneral) return;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tabGeneral));
    document.querySelectorAll('.panel').forEach(x => x.classList.toggle('active', x === panelGeneral));
    refrescarControl();
  }
  const textoActividad = (id, actividad) => actividad ? actividad.slice(0, 72) : 'Disponible';
  async function refrescarControl() {
    if (!panelGeneral || !panelGeneral.classList.contains('active')) return;
    const pedir = ruta => fetch(ruta, { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const [edicion, ecommerce, zeus, chat] = await Promise.all([pedir('/api/agentes/estado'), pedir('/api/ecommerce/estado'), pedir('/api/zeus/estado'), pedir('/api/agentes/mensajes?desde=0')]);
    const actividades = {};
    (ecommerce?.agentes || []).forEach(a => { actividades[String(a.nombre || a.id).toUpperCase()] = a.ultima || ecommerce?.latidos?.[a.id]?.actividad || a.estado; });
    const trabajo = (edicion?.pcs || []).map(p => p.trabajo || '').join(' · ');
    actividades.JEFE = trabajo || 'Coordina y asigna tareas';
    ['TAVO','LEO','JACK','OLVER','OLIVER','TERRY','DRACO'].forEach(n => { actividades[n] = trabajo && trabajo.toUpperCase().includes(n) ? trabajo : 'Conectado al centro'; });
    if (zeus) actividades.ZEUS = zeus.actividad || zeus.estado || 'Revisando inventario';
    panelGeneral.querySelectorAll('[data-control-agent]').forEach(el => {
      const nombre = el.dataset.controlAgent, actividad = actividades[nombre] || 'Conectado al centro';
      el.classList.toggle('trabajando', !/^(Disponible|Conectado al centro|CORRIENDO|INACTIVO)$/i.test(actividad));
      el.title = textoActividad(nombre, actividad); el.querySelector('small').textContent = textoActividad(nombre, actividad);
    });
    const salida = panelGeneral.querySelector('[data-jefe-respuesta]');
    if (salida && chat) {
      const escapar = valor => String(valor || '').replace(/[&<>\"]/g, caracter => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[caracter]);
      const resumen = valor => {
        const limpio = String(valor || '').replace(/\s+/g, ' ').trim();
        return limpio.length > 280 ? limpio.slice(0, 280).replace(/\s+\S*$/, '') + '…' : limpio;
      };
      const ultimos = (chat.mensajes || []).filter(m => m.rol === 'bot').slice(-2);
      salida.innerHTML = ultimos.length
        ? ultimos.map(m => { const texto = String(m.texto || ''); const corto = resumen(texto); return `<article class="ag-chat-msg"><small>👑 JEFE · RESPUESTA</small><div>${escapar(corto)}</div>${texto.length > corto.length ? `<details><summary>Ver detalle completo</summary><p>${escapar(texto)}</p></details>` : ''}</article>`; }).join('')
        : `<article class="ag-chat-msg pendiente"><small>👑 JEFE · EN ESPERA</small><div>${chat.esperando ? 'JEFE está diagnosticando y asignando la tarea…' : 'Escríbele una tarea a JEFE para que la diagnostique y la envíe al agente indicado.'}</div></article>`;
    }
  }
  function crearPanelGeneral() {
    const main = document.querySelector('main'), nav = document.querySelector('nav.tabs');
    if (!main || !nav || panelGeneral) return;
    panelGeneral = document.createElement('section'); panelGeneral.className = 'panel'; panelGeneral.dataset.panel = 'agentes-general';
    const areas = AREAS.map((a, i) => `<button type="button" class="ag-area-general a${i + 1}" data-general-area="${a.id}"><strong>${a.nombre}</strong><small>${a.agentes.length} agentes conectados al centro</small><div class="ag-general-agentes">${a.agentes.map(g => `<span data-control-agent="${g[0]}" title="${g[0]}"><i></i><b class="ag-muneco" aria-label="${g[0]}">${AVATAR[g[0]] || '🤖'}</b><small>Conectado al centro</small></span>`).join('')}</div></button>`).join('');
    panelGeneral.innerHTML = `<div class="ag-general"><header class="ag-general-head"><div><h2>RED DE AGENTES</h2><p>Todos los asistentes conectados al centro operativo.</p></div><small>● RED DISPONIBLE</small></header><section class="ag-campus">${areas}<article class="ag-edificio"><div><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 56h48M14 56V18l18-10 18 10v38M24 56V35h16v21M21 23h6m10 0h6M21 30h6m10 0h6"/></svg><b>INDOOR SPORT SAS</b><span>Centro de operaciones</span></div></article></section><form class="ag-jefe-chat" data-jefe-form><label>👑 JEFE · pide una tarea o un diagnóstico</label><textarea data-jefe-input placeholder="Ej.: revisa la orden CO6268, crea la muestra y avísame si falta información"></textarea><button type="submit">ENVIAR A JEFE</button><div class="ag-jefe-respuesta" data-jefe-respuesta>Escríbele una tarea a JEFE.</div></form></div>`;
    main.appendChild(panelGeneral);
    const grupo = document.createElement('div'); grupo.hidden = true; grupo.style.display = 'none'; grupo.innerHTML = '<button class="tab" data-kind="agentes-general" type="button"></button>'; nav.appendChild(grupo); tabGeneral = grupo.querySelector('.tab');
    panelGeneral.addEventListener('click', e => { const b = e.target.closest('[data-general-area]'); if (b) { const area = AREAS.find(a => a.id === b.dataset.generalArea); abrirArea(area); } });
    panelGeneral.addEventListener('submit', async e => { if (!e.target.matches('[data-jefe-form]')) return; e.preventDefault(); const entrada = panelGeneral.querySelector('[data-jefe-input]'), texto = entrada.value.trim(); if (!texto) return; entrada.disabled = true; try { await fetch('/api/agentes/mensaje', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: texto }) }); entrada.value = ''; panelGeneral.querySelector('[data-jefe-respuesta]').textContent = 'JEFE recibió la tarea y está diagnosticando a quién asignarla…'; refrescarControl(); } finally { entrada.disabled = false; entrada.focus(); } });
    if (!controlTimer) controlTimer = setInterval(refrescarControl, 1000);
  }
  setInterval(montar, 400);
  document.addEventListener('click', () => setTimeout(() => { pintar(); ubicar(); }, 60), true);
})();
