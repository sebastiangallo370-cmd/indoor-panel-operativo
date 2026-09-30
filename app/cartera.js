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
        hasta: ''
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
        const pagado = pagosPorCot[doc.numero] || 0;
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
        const seg = (val, cls, label) => val > 0 ? `<div class="aging-segment ${cls}" style="width:${(val/totalSal)*100}%" title="${label}: ${USD.format(val)}">${(val/1e6).toFixed(1)}M</div>` : '';
        ab.innerHTML = seg(s0, 'bg-sin-vencer', 'Sin Vencer') + seg(s15, 'bg-1-15', '1 a 15 días') + seg(s30, 'bg-16-30', '16 a 30 días') + seg(s60, 'bg-31-60', '31 a 60 días') + seg(sMas, 'bg-mas-60', 'Más de 60');
    }

    // KPIs
    const kpi = (title, val, sub, color='') => `<div class="kpi-card"><div class="kpi-title">${title}</div><div class="kpi-value" style="color:${color}">${val}</div><div class="kpi-support">${sub}</div></div>`;
    
    let sumSaldos = totalSal;
    let sumVencida = s15+s30+s60+sMas;
    let vence7 = docs.filter(d => d.saldo>0 && d.diasVencido>=-7 && d.diasVencido<=0).reduce((a,b)=>a+b.saldo,0);
    
    let now = new Date();
    let recMes = state.datos.comprobantes.filter(c => !c.anulado && new Date(c.fecha).getMonth() === now.getMonth()).reduce((a,b)=>a+Number(c.valor), 0);
    
    let sumDiasXPeso = docs.filter(d=>d.saldo>0).reduce((a,b)=>a + (b.saldo * b.diasVencido), 0);
    let dso = sumSaldos > 0 ? Math.round(sumDiasXPeso / sumSaldos) : 0;
    
    const clis = {}; docs.forEach(d => { if(d.saldo>0) clis[d.cliente] = (clis[d.cliente]||0)+d.saldo; });
    const maxCli = Math.max(0, ...Object.values(clis));
    
    let html = kpi('CARTERA POR COBRAR', USD.format(sumSaldos), `${docs.filter(d=>d.saldo>0).length} documentos con saldo`);
    html += kpi('CARTERA VENCIDA', USD.format(sumVencida), sumSaldos>0 ? `${Math.round((sumVencida/sumSaldos)*100)}% del total` : '0%', 'var(--c-magenta)');
    html += kpi('VENCE EN 7 DÍAS', USD.format(vence7), 'Gestione el cobro esta semana');
    html += kpi('RECAUDADO ESTE MES', USD.format(recMes), 'Caja efectivamente ingresada', 'var(--c-green)');
    html += kpi('DÍAS DE CARTERA (DSO)', `${dso > 0 ? '+'+dso : dso} d`, 'Promedio ponderado por saldo');
    html += kpi('CONCENTRACIÓN', sumSaldos>0 ? `${Math.round((maxCli/sumSaldos)*100)}%` : '0%', 'Peso del cliente más grande');
    
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
    document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
    const tab = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const view = document.getElementById(`view-${tabName}`);
    if (!tab || !view) return;
    tab.classList.add('active');
    view.classList.add('active');
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', e => openTab(e.currentTarget.dataset.tab)));
document.querySelectorAll('.quick-tab').forEach(b => b.addEventListener('click', e => openTab(e.currentTarget.dataset.targetTab)));

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

// INIT
scheduleDate();
loadDatos();
setInterval(loadDatos, 30000);
