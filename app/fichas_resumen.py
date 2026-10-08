"""Ficha técnica RESUMIDA para los operarios: lo que se necesita mirar mientras se trabaja (prenda, telas, medidas, insumos, confección, empaque).

Sale de las fichas ya importadas por app/fichas.py. Es de solo lectura y la puede ver cualquier usuario con sesión (no exige el permiso de Moldería).
"""
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import fichas as fichas_mod

router = APIRouter(prefix='/api/fichas', tags=['fichas'])

_REF = re.compile(r'[A-Za-z]{1,5}\d{2,3}')


def refs_de(texto: str) -> list[str]:
    """«A100FUT01» -> [FUT01]; «A100CB02-A100PT01» -> [CB02, PT01]; «A2100-502CH01» -> [CH01]; «A100-211CA04SUZ» -> [CA04]; «A100CA02ZUSM» -> [CA02].
    Quita el código de tela (A100, A2100-502) y lo que sobra detrás de la referencia (M, F, N, MFN, ZUSM…)."""
    t = str(texto or '').upper()
    t = re.sub(r'\bA\d+(?:-\d+)?(?=[A-Z]{1,5}\d{2,3})', ' ', t)
    salida = []
    for m in re.finditer(r'[A-Z]{1,5}\d{2,3}', t):
        if m.group(0) not in salida:
            salida.append(m.group(0))
    return salida


def _consumos(ref: str) -> dict | None:
    """Consumo de tela por talla del maestro (Promedios maestros): lo que se registró para esa REF."""
    try:
        from app import promedios as pm
        datos = pm._leer()
    except Exception:  # noqa: BLE001
        return None
    m = next((x for x in datos.get('maestros', []) if x.get('ref') == ref), None)
    if not m:
        return None
    grupos = []
    for clave, nombre, tallas in (('masc', 'MASCULINO', pm.TALLAS_ADULTO), ('fem', 'FEMENINO', pm.TALLAS_ADULTO), ('nino', 'NIÑO', pm.TALLAS_NINO), ('nina', 'NIÑA', pm.TALLAS_NINO)):
        vals = m.get(clave) or []
        if any(vals):
            grupos.append({'grupo': nombre, 'tallas': tallas, 'valores': vals})
    plantillas = [m.get(k) for k in ('p_masculino', 'p_femenino', 'p_femenino_short', 'p_nino', 'p_nina', 'p_nina_short') if m.get(k)]
    return {'ref': ref, 'promedio': pm.promedio(m), 'grupos': grupos, 'plantillas': plantillas}


def _resumir(f: dict) -> dict:
    imagenes = sorted(f.get('imagenes', []), key=lambda i: i['ancho'] * i['alto'], reverse=True)
    principales = [i for i in imagenes if i['zona'] in ('mockup', 'fisica')] + [i for i in imagenes if i['zona'] not in ('mockup', 'fisica')]
    telas = [t for t in f.get('telas', []) if re.sub(r'[-\s]', '', t.get('tela', ''))]
    promedios = []
    for p in f.get('promedios', []):
        vals = {k: v for k, v in p.get('valores', {}).items() if v not in ('', 'X')}
        if vals:
            promedios.append({'nombre': p['nombre'], 'valores': vals})
    clave = ('MAQUINA', 'AGUJA', 'HILO', 'RUEDO', 'PESPUNTE', 'DESCRIPCION CONFECCION')
    confeccion = [{'etiqueta': c['etiqueta'], 'valor': c['valor'] + (' — ' + c['extra'] if c.get('extra') else '')} for c in f.get('confeccion', [])
                  if c.get('etiqueta') and fichas_mod._plano(c['etiqueta']).startswith(clave)]
    return {
        'id': f['id'], 'ref': f['ref'], 'hoja': f['hoja'], 'familia': f['familia'], 'prenda': f.get('prenda', ''), 'referencia': f.get('referencia', ''),
        'nota': f.get('nota_prenda', ''), 'nota_promedio': f.get('nota_promedio', ''), 'telas': telas, 'promedios': promedios,
        'descripcion': [d['texto'] for d in f.get('descripcion', [])][:24],
        'piezas': [str(p) for p in (f.get('piezas') or [])][:40],
        'tallajes': [t for t in f.get('tallajes', []) if t.get('tallas')],
        'insumos': f.get('insumos', []), 'medidas_insumos': f.get('medidas_insumos', [])[:4],
        'confeccion': confeccion[:8], 'terminacion': f.get('terminacion', [])[:6], 'empaque_insumos': f.get('empaque_insumos', []),
        'imagenes': [i['archivo'] for i in principales[:8]], 'total_imagenes': len(imagenes), 'mockup': fichas_mod.con_mockup().get(f['ref']),
    }


@router.get('/resumen')
def resumen(ref: str):
    """Fichas (resumidas) de una referencia: acepta el código de la hoja de producción («A100FUT01») o la REF («FUT01»)."""
    buscadas = refs_de(ref) or [re.sub(r'\W+', '', ref).upper()]
    indice = fichas_mod.indice().get('fichas', [])
    salida = []
    for r in buscadas:
        for x in indice:
            if x['ref'] == r or x['hoja'].upper().replace(' ', '').startswith(r):
                f = fichas_mod.ficha(x['id'])
                if f and all(s['id'] != f['id'] for s in salida):
                    salida.append(_resumir(f))
    consumos = [c for c in (_consumos(r) for r in buscadas) if c]
    parecidas = []
    if not salida:
        familias = {re.sub(r'\d+$', '', r) for r in buscadas}
        parecidas = [{'ref': x['ref'], 'prenda': x['prenda']} for x in indice if re.sub(r'\d+$', '', x['ref']) in familias][:12]
    return {'buscadas': buscadas, 'fichas': salida, 'importadas': len(indice), 'consumos': consumos, 'parecidas': parecidas}


@router.get('/lista')
def lista():
    """Índice mínimo para el buscador de fichas."""
    mock = fichas_mod.con_mockup()
    return {'fichas': [{'ref': x['ref'], 'hoja': x['hoja'], 'familia': x['familia'], 'prenda': x['prenda'], 'portada': x['portada'], 'id': x['id'], 'mockup': mock.get(x['ref'])}
                       for x in fichas_mod.indice().get('fichas', [])]}


@router.get('/img')
def imagen(id: str, archivo: str):
    p = fichas_mod.ruta_imagen(id, archivo)
    if not p:
        raise HTTPException(404, 'Imagen no encontrada')
    return FileResponse(p, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@router.get('/mockup')
def mockup(ref: str):
    p = fichas_mod.ruta_mockup(ref)
    if not p:
        raise HTTPException(404, 'Esa referencia no tiene mockup')
    return FileResponse(p, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})
