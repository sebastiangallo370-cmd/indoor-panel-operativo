"""Arma una página local (carpeta pasada como argumento) con el HTML/CSS REAL del panel y solo los scripts de Inventarios, con datos de ejemplo,
para revisar la pestaña «Tela programada» en ancho de celular. Uso: python armar_prueba_movil.py <home.html> <carpeta_destino>"""
import re, shutil, sys
from pathlib import Path

home, destino = Path(sys.argv[1]), Path(sys.argv[2])
destino.mkdir(parents=True, exist_ok=True)
html = home.read_text(encoding='utf-8')
# fuera TODOS los scripts (inline y externos); se agregan solo los necesarios
html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S | re.I)
repo = Path(__file__).resolve().parent.parent
for nombre in ('bodega-dashboard.js', 'liquid-stats.js'):
    shutil.copy(repo / 'app' / nombre, destino / nombre)
datos = r"""
<script>
const mk=(o,r,t,c,p,e,est)=>({orden:o,cliente:'CLIENTE',proyecto:'PROYECTO',referencia:r,tela:t,cantidad:c,promedio:p,mts:+(c*p).toFixed(2),entrega:e,estado:est||'',maestros:['CA00'],telas:[t]});
const ord=[
 Object.assign(mk('RM7658','A200CA01','DIAMANTE',4,0.78,'2026-10-23'),{situacion:'alcanza',falta:0,disponible:4056}),
 Object.assign(mk('CO6190','A300CA03-A300PT01','HYDROTECH',25,1.43,'2026-10-31'),{situacion:'alcanza',falta:0,disponible:574}),
 Object.assign(mk('RM7648','A700CA00','TOUR',200,0.78,'2026-11-03'),{situacion:'no_alcanza',falta:26,disponible:130}),
 Object.assign(mk('RM9999','A800CA00','TELA SIN STOCK',10,1,'2026-11-05'),{situacion:'sin_tela',falta:10,disponible:0}),
 {orden:'RM7631',cliente:'ZUS',proyecto:'LAB',referencia:'A4403-4400-8103BS01ZUSM',tela:'VIOTO',cantidad:102,promedio:0,mts:0,entrega:'2026-10-23',estado:'',situacion:'sin_promedio',falta:0,maestros:[],telas:[],motivo:'Sin promedio'}];
const nec={disponible:true,mts:239.6,pedidos:4,faltan:36,telas_no_alcanzan:2,ordenes:ord,
 telas:[{tela:'TOUR',mts:156,prendas:200,disponible:130,encontrada:true,telas:['(700) TOUR'],faltan:26,alcanza:false,pedidos:[ord[2]]},
        {tela:'HYDROTECH',mts:35.75,prendas:25,disponible:574,encontrada:true,telas:['(300) HYDROTECH'],faltan:0,alcanza:true,pedidos:[ord[1]]},
        {tela:'DIAMANTE',mts:3.12,prendas:4,disponible:4056,encontrada:true,telas:['(200) DIAMANTE'],faltan:0,alcanza:true,pedidos:[ord[0]]}]};
const dash={updated_at:new Date().toISOString(),umbral_bajo:100,telas:[],kpis:{mts:24118,telas:106,telas_con_stock:99,telas_sin_stock:7,rollos:381,rollos_nuevos:258,mts_nuevos:21611,rollos_empezados:123,mts_empezados:4250},top:[],bajo_stock:[],sin_stock:[],proveedores_telas:{},proveedores:[],listas:[],listas_no_alcanzan:0,sublimacion:{ordenes:0,mts:0,no_alcanzan:0,faltan:0,lista:[]},consumos:{mts_30d:2504,ordenes_30d:39,ultimos:[]},movimientos:{ingresos:0,ingresos_mts:0,salidas:0,salidas_mts:0,ultimos:[]},documentos:0};
window.fetch=async(u)=>({ok:true,json:async()=>String(u).includes('tela-necesaria')?nec:String(u).includes('dashboard')?dash:{vinculado:true,activo:true}});
const g0=document.querySelector('.nav-group'); const g=document.createElement('div'); g.className='nav-group'; g.innerHTML='<button type="button" class="nav-parent"><span class="nav-icon">IV</span>INVENTARIOS</button><div class="nav-children"></div>'; g0.parentElement.appendChild(g);
</script><script src="bodega-dashboard.js"></script><script src="liquid-stats.js"></script>
<script>document.documentElement.classList.add('ui-ready');setTimeout(()=>{const g=[...document.querySelectorAll('.nav-group')].find(x=>/INVENTARIOS/i.test(x.textContent));document.querySelector('[data-bodega-dashboard]')?.click();setTimeout(()=>document.querySelector('[data-bd-tab=tela]')?.click(),500)},600)</script>
"""
html = html.replace('</body>', datos + '</body>') if '</body>' in html else html + datos
(destino / 'test.html').write_text(html, encoding='utf-8')
print('listo', destino / 'test.html')
