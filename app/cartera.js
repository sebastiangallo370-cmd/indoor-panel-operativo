const API_URL = '/api/cartera';

let state = {
    datos: null,
    filtros: {
        buscar: '',
        vendedor: 'Todos',
        cliente: 'Todos',
        pago: 'Todos',
        estado: 'pendiente',
        rangoTipo: 'fechaCreacion',
        desde: '',
        hasta: '',
        tramo: 'todos'
    }
};

const USD = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

async function loadDatos() {
    try {
        const res = await fetch(`${API_URL}/datos`);
        state.datos = await res.json();
        document.getElementById('conn-status').className = 'indicator green';
        document.getElementById('conn-status').textContent = '● Conectado · datos compartidos';
        document.getElementById('db-stats').textContent = `${state.datos.documentos.length} documentos · ${state.datos.comprobantes.length} comprobantes · próximo comprobante CI-${String(state.datos.contadorComprobante).padStart(4, '0')}`;
        const lastSync = state.datos.ultimaSincronizacionIndoor;
        document.getElementById('sync-status').textContent = lastSync ? `Última sincronización de Indoor: ${new Date(lastSync).toLocaleString('es-CO')}` : 'Aún no se han sincronizado datos de Indoor.';
        
        // La sesión se muestra en la plataforma principal. Aquí evitamos
        // duplicar o inventar un usuario dentro del módulo embebido.
        document.getElementById('user-btn').textContent = 'Sesión activa';
        
        updateUI();
    } catch (e) {
        document.getElementById('conn-status').className = 'indicator red';
        document.getElementById('conn-status').textContent = '● Error de conexión';
    }
}

function processData() {
    const { documentos, comprobantes, config } = state.datos;
    const now = new Date();
    
    // 1. Calcular pagos
    const pagosPorCot = {};
    comprobantes.forEach(c => {
        if (!c.anulado) {
            pagosPorCot[c.cotizacionNumero] = (pagosPorCot[c.cotizacionNumero] || 0) + Number(c.valor);
        }
    });

    let procesados = documentos.map(doc => {
        const pagado = Number(doc.pagadoImportado || 0) + (pagosPorCot[doc.numero] || 0);
        const saldo = Math.max(0, doc.total - pagado);
        
        // Fechas
        let fechaBase = new Date(doc.fechaCreacion);
        if (config.plazoDesde === 'entrega' && doc.fechaEntrega) {
            fechaBase = new Date(doc.fechaEntrega);
        }
        
        // Forma pago
        let diasPlazo = 0;
        const fp = (doc.formaPago || '').toLowerCase();
        if (fp.includes('7')) diasPlazo = 7;
        else if (fp.includes('10')) diasPlazo = 10;
        else if (fp.includes('15')) diasPlazo = 15;
        else if (fp.includes('30')) diasPlazo = 30;
        else if (fp.includes('45')) diasPlazo = 45;
        else if (fp.includes('contado')) diasPlazo = config.contadoEquivale === 'un_dia_despues' ? 1 : 0;
        
        const fVence = new Date(fechaBase);
        fVence.setDate(fVence.getDate() + diasPlazo);
        
        const diffTime = now - fVence;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let estadoVisual = 'En cartera';
        if (doc.estado === 'anulada') estadoVisual = 'Anulada';
        else if (doc.estado === 'excluida') estadoVisual = 'Excluida de cartera';
        else if (saldo === 0) estadoVisual = 'Pagada';
        else if (diffDays > 0) estadoVisual = `Vencida ${diffDays} d`;
        else if (pagado > 0) estadoVisual = 'Abonada';
        
        return {
            ...doc,
            pagado,
            saldo,
            fechaBase,
            fechaVencimiento: fVence.toISOString().split('T')[0],
            diasVencido: diffDays, // Positivo es vencido, Negativo por vencer
            estadoVisual,
            diasPlazo
        };
    });

    // Filtros
    const f = state.filtros;
    if (f.buscar) {
        const b = f.buscar.toLowerCase();
        procesados = procesados.filter(d => 
            String(d.numero).toLowerCase().includes(b) || 
            String(d.cliente).toLowerCase().includes(b) || 
            String(d.club || '').toLowerCase().includes(b)
        );
    }
    if (f.vendedor !== 'Todos') procesados = procesados.filter(d => d.vendedor === f.vendedor);
    if (f.cliente !== 'Todos') procesados = procesados.filter(d => d.cliente === f.cliente);
    if (f.pago !== 'Todos') procesados = procesados.filter(d => (d.formaPago || '') === f.pago);
    if (f.tramo === 'sin-vencer') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido <= 0);
    if (f.tramo === '1-15') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido >= 1 && d.diasVencido <= 15);
    if (f.tramo === '16-30') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido >= 16 && d.diasVencido <= 30);
    if (f.tramo === '31-60') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido >= 31 && d.diasVencido <= 60);
    if (f.tramo === 'mas-60') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido > 60);
    if (f.tramo === 'vencida') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido > 0);
    if (f.tramo === 'vence-7') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido >= -7 && d.diasVencido <= 0);
    
    if (f.estado === 'pendiente') procesados = procesados.filter(d => d.saldo > 0 && d.estado !== 'anulada' && d.estado !== 'excluida');
    else if (f.estado === 'pagadas') procesados = procesados.filter(d => d.saldo === 0 && d.estado !== 'anulada');
    else if (f.estado === 'anuladas') procesados = procesados.filter(d => d.estado === 'anulada');
    else if (f.estado === 'en_cartera') procesados = procesados.filter(d => d.saldo > 0 && d.diasVencido <= 0 && d.estado !== 'anulada');

    if (f.desde) procesados = procesados.filter(d => d[f.rangoTipo] >= f.desde);
    if (f.hasta) procesados = procesados.filter(d => d[f.rangoTipo] <= f.hasta);

    return procesados;
}

function updateUI() {
    // Dropdowns
    const vends = new Set(), clis = new Set();
    state.datos.documentos.forEach(d => { if(d.vendedor) vends.add(d.vendedor); if(d.cliente) clis.add(d.cliente); });
    
    const fillSel = (id, set, val) => {
        const sel = document.getElementById(id);
        const curr = sel.value;
        sel.innerHTML = '<option value="Todos">Todos</option>' + [...set].sort().map(x => `<option value="${x}">${x}</option>`).join('');
        sel.value = val !== 'Todos' && set.has(val) ? val : 'Todos';
    };
    fillSel('f-vendedor', vends, state.filtros.vendedor);
    fillSel('f-cliente', clis, state.filtros.cliente);

    const docs = processData();
    renderCartera(docs);
    renderTablero(docs);
    renderPagos();
}

function renderCartera(docs) {
    const tb = document.querySelector('#table-cartera tbody');
    tb.innerHTML = docs.map(d => `
        <tr>
            <td><strong>${d.numero}</strong>${d.revisar ? '<span style="color:var(--c-amber)">●</span>' : ''}</td>
            <td>${d.cliente}<br><small class="muted">${d.ciudad || ''} ${d.club || ''}</small></td>
            <td>${d.vendedor || '-'}</td>
            <td>${d.fechaCreacion || '-'}</td>
            <td>${d.fechaEntrega || '-'}</td>
            <td>${d.formaPago || 'Contado'}</td>
            <td>${d.fechaVencimiento}</td>
            <td style="color:${d.diasVencido > 0 ? 'var(--c-magenta)' : 'var(--text-muted)'}">${d.diasVencido > 0 ? '+'+d.diasVencido : d.diasVencido}</td>
            <td class="num">${USD.format(d.total)}</td>
            <td class="num" style="color:var(--c-green)">${USD.format(d.pagado)}</td>
            <td class="num"><strong>${USD.format(d.saldo)}</strong></td>
            <td><span class="chip ${d.saldo === 0 ? 'c-green' : d.diasVencido > 0 ? 'c-magenta' : 'c-gray'}">${d.estadoVisual}</span></td>
            <td>
                <button class="btn-secondary" onclick="openPago('${d.numero}', ${d.saldo})" ${d.saldo===0||d.estado==='anulada'?'disabled':''}>＄</button>
            </td>
        </tr>
    `).join('');
    
    const tot = docs.reduce((a,b)=>a+b.total, 0), rec = docs.reduce((a,b)=>a+b.pagado, 0), sal = docs.reduce((a,b)=>a+b.saldo, 0);
    document.getElementById('cartera-summary').textContent = `${docs.length} documentos · Valor ${USD.format(tot)} · Recaudado ${USD.format(rec)} · Saldo ${USD.format(sal)}`;
}

function renderTablero(docs) {
    // Aging
    let s0=0, s15=0, s30=0, s60=0, sMas=0;
    docs.forEach(d => {
        if(d.saldo<=0 || d.estado==='anulada') return;
        if (d.diasVencido <= 0) s0 += d.saldo;
        else if (d.diasVencido <= 15) s15 += d.saldo;
        else if (d.diasVencido <= 30) s30 += d.saldo;
        else if (d.diasVencido <= 60) s60 += d.saldo;
        else sMas += d.saldo;
    });
    const totalSal = s0+s15+s30+s60+sMas;
    
    const ab = document.getElementById('aging-bar');
    if (totalSal === 0) ab.innerHTML = '<div class="aging-segment bg-sin-vencer" style="width:100%; color:var(--text-muted); background:#f3f4f6">Sin saldo</div>';
    else {
        const seg = (val, cls, label, tramo) => val > 0 ? `<button class="aging-segment ${cls}" data-tramo="${tramo}" style="width:${(val/totalSal)*100}%" title="${label}: ${USD.format(val)}">${(val/1e6).toFixed(1)}M</button>` : '';
        ab.innerHTML = seg(s0, 'bg-sin-vencer', 'Sin Vencer', 'sin-vencer') + seg(s15, 'bg-1-15', '1 a 15 días', '1-15') + seg(s30, 'bg-16-30', '16 a 30 días', '16-30') + seg(s60, 'bg-31-60', '31 a 60 días', '31-60') + seg(sMas, 'bg-mas-60', 'Más de 60', 'mas-60');
    }

    // KPIs
    const kpi = (title, val, sub, action, color='') => `<button class="kpi-card" type="button" data-kpi-action="${action}" title="Ver detalle"><span class="kpi-title">${title}</span><strong class="kpi-value" style="color:${color}">${val}</strong><span class="kpi-support">${sub}</span><small>Ver detalle →</small></button>`;
    
    let sumSaldos = totalSal;
    let sumVencida = s15+s30+s60+sMas;
    let vence7 = docs.filter(d => d.saldo>0 && d.diasVencido>=-7 && d.diasVencido<=0).reduce((a,b)=>a+b.saldo,0);
    
    let now = new Date();
    let recMes = state.datos.comprobantes.filter(c => !c.anulado && new Date(c.fecha).getMonth() === now.getMonth()).reduce((a,b)=>a+Number(b.valor), 0);
    
    let sumDiasXPeso = docs.filter(d=>d.saldo>0).reduce((a,b)=>a + (b.saldo * b.diasVencido), 0);
    let dso = sumSaldos > 0 ? Math.round(sumDiasXPeso / sumSaldos) : 0;
    
    const clis = {}; docs.forEach(d => { if(d.saldo>0) clis[d.cliente] = (clis[d.cliente]||0)+d.saldo; });
    const maxCli = Math.max(0, ...Object.values(clis));
    
    let html = kpi('CARTERA POR COBRAR', USD.format(sumSaldos), `${docs.filter(d=>d.saldo>0).length} documentos con saldo`, 'todos');
    html += kpi('CARTERA VENCIDA', USD.format(sumVencida), sumSaldos>0 ? `${Math.round((sumVencida/sumSaldos)*100)}% del total` : '0%', 'vencida', 'var(--c-magenta)');
    html += kpi('VENCE EN 7 DÍAS', USD.format(vence7), 'Gestione el cobro esta semana', 'vence-7');
    html += kpi('RECAUDADO ESTE MES', USD.format(recMes), 'Caja efectivamente ingresada', 'pagos', 'var(--c-green)');
    html += kpi('DÍAS DE CARTERA (DSO)', `${dso > 0 ? '+'+dso : dso} d`, 'Promedio ponderado por saldo', 'todos');
    html += kpi('CONCENTRACIÓN', sumSaldos>0 ? `${Math.round((maxCli/sumSaldos)*100)}%` : '0%', 'Peso del cliente más grande', 'todos');
    
    document.getElementById('kpi-grid').innerHTML = html;
    
    // Alertas
    let htmlAlertas = '';
    const alertDocs60 = docs.filter(d => d.diasVencido > 60 && d.saldo > 0);
    if(alertDocs60.length) htmlAlertas += `<div class="alert-card"><h5>Documentos > 60 días (${alertDocs60.length})</h5><p>Acuerdo de pago o suspensión recomendada.</p><ul>${alertDocs60.slice(0,5).map(d=>`<li>${d.numero} - ${d.cliente}</li>`).join('')}</ul></div>`;
    
    const alertRev = docs.filter(d => d.revisar);
    if(alertRev.length) htmlAlertas += `<div class="alert-card"><h5>Ítems por revisar (${alertRev.length})</h5><p>La suma de los ítems no coincide con el total de la cotización.</p><ul>${alertRev.slice(0,5).map(d=>`<li>${d.numero} - ${d.cliente}</li>`).join('')}</ul></div>`;
    
    document.getElementById('alerts-grid').innerHTML = htmlAlertas || '<p class="muted">No hay alertas activas en los documentos filtrados.</p>';
}

function renderPagos() {
    const comp = state.datos.comprobantes;
    const tb = document.querySelector('#table-pagos tbody');
    tb.innerHTML = comp.map(c => `
        <tr style="${c.anulado ? 'opacity:0.5; text-decoration:line-through;' : ''}">
            <td><strong class="mono">${c.id}</strong></td>
            <td>${c.fecha.split('T')[0]}</td>
            <td>${c.cotizacionNumero}</td>
            <td>${c.cliente || '-'}</td>
            <td>${c.medio}</td>
            <td>${c.referencia || ''}</td>
            <td class="num" style="color:var(--c-green)">${USD.format(c.valor)}</td>
            <td><span class="chip c-green">${c.tipo}</span></td>
            <td>${c.recibio}</td>
            <td>
                ${c.anulado ? `<small>${c.motivoAnulacion}</small>` : `<button class="btn-secondary" onclick="anularPago('${c.id}')">✕</button>`}
            </td>
        </tr>
    `).reverse().join('');
}

// Interacciones
function openTab(tabName) {
    const panel = document.querySelector('.cartera-panel');
    if (!panel) return;
    panel.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
    panel.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    const tab = panel.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const view = panel.querySelector(`#view-${tabName}`);
    if (!tab || !view) return;
    tab.classList.add('active');
    view.classList.add('active');
    // Cargar valores actuales al abrir ajustes
    if (tabName === 'ajustes' && state.datos?.config) {
        const cfg = state.datos.config;
        const el = id => panel.querySelector('#' + id);
        if (el('conf-plazo')) el('conf-plazo').value = cfg.plazoDesde || 'entrega';
        if (el('conf-contado')) el('conf-contado').value = cfg.contadoEquivale || 'mismo_dia_entrega';
        if (el('conf-anticipo')) el('conf-anticipo').value = cfg.anticipoMinimoPct ?? 50;
    }
}

// Event delegation desde el panel persistente: funciona aunque el HTML interno se reinyecte
document.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn && btn.closest('.cartera-panel')) openTab(btn.dataset.tab);
    const qt = e.target.closest('.quick-tab');
    if (qt && qt.closest('.cartera-panel')) openTab(qt.dataset.targetTab);
});

function abrirDetalleCartera(action) {
    if (action === 'pagos') return openTab('pagos');
    state.filtros.tramo = action === 'vencida' ? '1-15' : action;
    if (action === 'vencida') {
        // Incluye todos los documentos vencidos, no solo los primeros 15 días.
        state.filtros.tramo = 'vencida';
    }
    openTab('cartera');
    updateUI();
}

document.getElementById('kpi-grid').addEventListener('click', event => {
    const card = event.target.closest('[data-kpi-action]');
    if (card) abrirDetalleCartera(card.dataset.kpiAction);
});

document.getElementById('aging-bar').addEventListener('click', event => {
    const segment = event.target.closest('[data-tramo]');
    if (segment) abrirDetalleCartera(segment.dataset.tramo);
});

document.getElementById('btn-sync-indoor').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Sincronizando…';
    try {
        const response = await fetch(`${API_URL}/sincronizar-indoor`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'No se pudo sincronizar');
        document.getElementById('sync-status').textContent = `${result.documentos} documentos reales actualizados desde Indoor.`;
        await loadDatos();
    } catch (error) {
        document.getElementById('sync-status').textContent = `Sincronización pendiente: ${error.message}`;
    } finally {
        button.disabled = false;
        button.textContent = '↻ Sincronizar Indoor';
    }
});

document.querySelectorAll('#global-filters input, #global-filters select').forEach(el => {
    el.addEventListener('change', e => {
        state.filtros[e.target.id.replace('f-', '').replace(/-([a-z])/g, g => g[1].toUpperCase())] = e.target.value;
        updateUI();
    });
    if (el.tagName === 'INPUT' && el.type === 'text') el.addEventListener('keyup', e => {
        state.filtros.buscar = e.target.value;
        updateUI();
    });
});

document.getElementById('f-limpiar').addEventListener('click', () => {
    state.filtros = { buscar:'', vendedor:'Todos', cliente:'Todos', pago:'Todos', estado:'pendiente', rangoTipo:'fechaCreacion', desde:'', hasta:'', tramo:'todos' };
    document.querySelectorAll('#global-filters input').forEach(input => input.value = '');
    document.getElementById('f-estado').value = 'pendiente';
    document.getElementById('f-rango-tipo').value = 'fechaCreacion';
    updateUI();
});

function openPago(num, max) {
    document.getElementById('pago-cotizacion').innerHTML = `<option value="${num}">${num}</option>`;
    document.getElementById('pago-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('pago-valor').value = max;
    document.getElementById('pago-valor').max = max;
    document.getElementById('pago-sugerido').textContent = `Sugerido: ${USD.format(max)}`;
    document.getElementById('modal-pago').showModal();
}

document.getElementById('form-pago').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {
        cotizacionNumero: document.getElementById('pago-cotizacion').value,
        fecha: document.getElementById('pago-fecha').value,
        medio: document.getElementById('pago-medio').value,
        referencia: document.getElementById('pago-referencia').value,
        valor: document.getElementById('pago-valor').value,
        tipo: document.getElementById('pago-tipo').value,
        recibio: document.getElementById('user-btn').textContent
    };
    
    await fetch(`${API_URL}/comprobantes`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
    document.getElementById('modal-pago').close();
    loadDatos();
});

document.getElementById('file-upload').addEventListener('change', async e => {
    const files = e.target.files;
    if(!files.length) return;
    const results = document.getElementById('upload-results');
    results.innerHTML = 'Procesando...';
    
    const docs = [];
    for(let i=0; i<files.length; i++) {
        const fd = new FormData();
        fd.append('file', files[i]);
        try {
            const r = await fetch(`${API_URL}/upload`, {method:'POST', body:fd});
            const d = await r.json();
            if(d.ok) docs.push(d.documento);
        } catch(err) {
            results.innerHTML += `<br>Error en ${files[i].name}`;
        }
    }
    
    if (docs.length) {
        await fetch(`${API_URL}/documentos`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(docs) });
        results.innerHTML = `<p style="color:var(--c-green)">${docs.length} documentos procesados correctamente.</p>`;
        loadDatos();
    }
});

function scheduleDate() {
    const d = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = d.toLocaleDateString('es-CO', options);
}

// ── Exportar CSV ─────────────────────────────────────────────────────────────
function downloadCSV(filename, headers, rows) {
    const sep = ';';
    const csv = [headers, ...rows]
        .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(sep))
        .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}

document.getElementById('btn-export-cartera').addEventListener('click', () => {
    const docs = processData();
    const headers = ['N°','CLIENTE','VENDEDOR','FECHA CREACIÓN','FECHA ENTREGA','FORMA PAGO','VENCE','DÍAS','TOTAL','PAGADO','SALDO','ESTADO'];
    const rows = docs.map(d => [d.numero, d.cliente, d.vendedor||'', d.fechaCreacion||'', d.fechaEntrega||'', d.formaPago||'', d.fechaVencimiento, d.diasVencido, d.total, d.pagado, d.saldo, d.estadoVisual]);
    downloadCSV(`cartera_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
});

document.getElementById('btn-export-pagos').addEventListener('click', () => {
    const comps = [...state.datos.comprobantes].reverse();
    const headers = ['COMPROBANTE','FECHA','COTIZACIÓN','CLIENTE','MEDIO','REFERENCIA','VALOR','TIPO','RECIBIÓ','ESTADO'];
    const rows = comps.map(c => [c.id, (c.fecha||'').split('T')[0], c.cotizacionNumero, c.cliente||'', c.medio, c.referencia||'', c.valor, c.tipo, c.recibio, c.anulado ? 'Anulado' : 'Válido']);
    downloadCSV(`pagos_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
});

// Clic en el sugerido → rellena el campo valor
document.getElementById('pago-sugerido').addEventListener('click', () => {
    const max = document.getElementById('pago-valor').max;
    if (max) document.getElementById('pago-valor').value = max;
});

// btn-add-pago: abre modal con selector completo de cotizaciones
document.getElementById('btn-add-pago').addEventListener('click', () => {
    const options = (state.datos?.documentos || [])
        .filter(d => d.saldo > 0 && d.estado !== 'anulada')
        .sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
    document.getElementById('pago-cotizacion').innerHTML =
        '<option value="">— Seleccione cotización —</option>' +
        options.map(d => `<option value="${d.numero}">${d.numero} – ${d.cliente} (saldo ${USD.format(d.saldo)})</option>`).join('');
    document.getElementById('pago-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('pago-valor').value = '';
    document.getElementById('pago-valor').max = '';
    document.getElementById('pago-sugerido').textContent = '';
    document.getElementById('modal-pago').showModal();
});

// Actualizar max y sugerido al cambiar la cotización en el selector completo
document.getElementById('pago-cotizacion').addEventListener('change', e => {
    const num = e.target.value;
    const doc = (state.datos?.documentos || []).find(d => String(d.numero) === String(num));
    if (doc) {
        document.getElementById('pago-valor').max = doc.saldo;
        document.getElementById('pago-sugerido').textContent = `Sugerido: ${USD.format(doc.saldo)}`;
    } else {
        document.getElementById('pago-sugerido').textContent = '';
    }
});

// ── Anular comprobante ────────────────────────────────────────────────────────
async function anularPago(id) {
    const motivo = prompt('Motivo de anulación (requerido):');
    if (motivo === null || !motivo.trim()) return;
    const r = await fetch(`${API_URL}/comprobantes/${id}/anular`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() })
    });
    if (r.ok) loadDatos();
    else alert('No se pudo anular el comprobante');
}

// ── Agregar documento manual ──────────────────────────────────────────────────
document.getElementById('btn-add-doc').addEventListener('click', () => {
    const num = prompt('Número de cotización:');
    if (!num || !num.trim()) return;
    const cliente = prompt('Cliente:') || '';
    const vendedor = prompt('Vendedor:') || '';
    const totalStr = prompt('Total ($):') || '0';
    const total = parseFloat(totalStr.replace(/[^0-9.]/g, '')) || 0;
    const fechaCreacion = prompt('Fecha de creación (YYYY-MM-DD):', new Date().toISOString().split('T')[0]) || '';
    const fechaEntrega = prompt('Fecha de entrega (YYYY-MM-DD, opcional):') || '';
    const formaPago = prompt('Forma de pago (ej: Contado a 1 día, 30 días):') || 'Contado a 1 día';
    const doc = {
        numero: num.trim(), cliente: cliente.trim(), vendedor: vendedor.trim(),
        fechaCreacion, fechaEntrega, formaPago, total,
        pagadoImportado: 0, estado: 'pedido', origen: 'Manual', revisar: false, notas: ''
    };
    fetch(`${API_URL}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([doc])
    }).then(r => { if (r.ok) loadDatos(); else alert('No se pudo guardar el documento'); });
});

// ── Ajustes ───────────────────────────────────────────────────────────────────
document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const config = {
        plazoDesde: document.getElementById('conf-plazo').value,
        contadoEquivale: document.getElementById('conf-contado').value,
        anticipoMinimoPct: parseInt(document.getElementById('conf-anticipo').value) || 50
    };
    const r = await fetch(`${API_URL}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    if (r.ok) { await loadDatos(); alert('Ajustes guardados correctamente.'); }
    else alert('No se pudieron guardar los ajustes');
});

// ── Respaldo ──────────────────────────────────────────────────────────────────
document.getElementById('btn-backup').addEventListener('click', () => {
    const data = JSON.stringify(state.datos, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cartera_respaldo_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
});

// ── INIT ──────────────────────────────────────────────────────────────────────
scheduleDate();
loadDatos();
setInterval(loadDatos, 30000);
