"""Ficha técnica RESUMIDA para los operarios: lo que se necesita mirar mientras se trabaja (prenda, telas, medidas, insumos, confección, empaque).

Sale de las fichas ya importadas por app/fichas.py. Es de solo lectura y la puede ver cualquier usuario con sesión (no exige el permiso de Moldería).
"""
import json
import re
import threading
from datetime import datetime, timedelta, timezone

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


# ------------------------------------------------------------------ textos corregidos a mano (no se pierden al volver a importar el Excel)
_INSUMO = ('nombre', 'tipo', 'color', 'medida', 'cant', 'observacion')
# sección -> 'texto' (un solo texto), 'lista' (líneas) o las columnas de su tabla. Con esto se puede corregir TODA la ficha y agregarle especificaciones.
SECCIONES = {
    'prenda': 'texto', 'referencia': 'texto', 'familia': 'texto', 'nota': 'texto', 'nota_promedio': 'texto', 'composicion': 'texto',
    'piezas': ('a', 'nombre', 'material', 'oculta'),   # correcciones por pieza del molde: nombre, material (M1, M2…) y si se oculta; `a` es su imagen
    'descripcion': 'lista', 'terminacion': 'lista',
    'confeccion': ('etiqueta', 'valor'), 'especificaciones': ('etiqueta', 'valor'), 'telas': ('material', 'tela'),
    'promedios': ('nombre', 'masc', 'feme', 'nino'), 'insumos': _INSUMO, 'empaque_insumos': _INSUMO,
    'tallajes': ('titulo', 'tallas', 'ancho', 'alto', 'largo'), 'medidas_insumos': ('titulo', 'tallas', 'medidas'),
}


def _serie(texto, cuantos: int | None = None) -> list:
    """«XS S M L» -> ['XS', 'S', 'M', 'L']; «60 - 64» -> ['60', '', '64'] (el guion es un valor vacío). Con `cuantos`, se ajusta a ese largo."""
    valores = ['' if v == '-' else v for v in re.split(r'[\s;|]+', str(texto or '').strip()) if v]
    if cuantos is not None:
        valores = (valores + [''] * cuantos)[:cuantos]
    return valores
_lock_ed = threading.Lock()


def _archivo_ediciones():
    return fichas_mod.DATOS.parent / 'fichas_ediciones.json'


def _ediciones() -> dict:
    try:
        return json.loads(_archivo_ediciones().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _limpio(texto, largo: int = 600) -> str:
    return re.sub(r'[ \t]+', ' ', str(texto or '').replace('\r', '')).strip()[:largo]


def guardar_texto(usuario: str, ident: str, seccion: str, lineas) -> dict:
    """Guarda el texto corregido de una sección de la ficha (o lo quita, con lineas=None, para volver al del Excel). Devuelve la ficha resumida."""
    f = fichas_mod.ficha(ident)
    if not f:
        raise HTTPException(404, 'Ficha no encontrada')
    if seccion not in SECCIONES:
        raise HTTPException(400, 'Esa sección no se puede editar')
    with _lock_ed:
        todo = _ediciones()
        de_ficha = todo.setdefault(ident, {})
        if lineas is None:
            de_ficha.pop(seccion, None)
        else:
            if not isinstance(lineas, list) or len(lineas) > 60:
                raise HTTPException(400, 'Máximo 60 filas por sección')
            tipo = SECCIONES[seccion]
            if tipo == 'texto':
                valor = [_limpio(' '.join(str(x) for x in lineas if isinstance(x, str)), 1200)]
            elif tipo == 'lista':
                valor = [t for t in (_limpio(x) for x in lineas if isinstance(x, str)) if t]
            else:
                valor = [{c: _limpio(x.get(c), 300 if c in ('etiqueta', 'material', 'titulo') else 600) for c in tipo} for x in lineas if isinstance(x, dict)]
                valor = [x for x in valor if any(x.values())]
                if seccion == 'piezas':   # solo imágenes del fit, y solo las que traen alguna corrección
                    valor = [x for x in valor if re.fullmatch(r'[a-z0-9-]+_fit\d+\.png', x['a']) and (x['nombre'] or x['material'] or x['oculta'])]
            ahora = datetime.now(timezone(timedelta(hours=-5))).strftime('%Y-%m-%d %H:%M')
            de_ficha[seccion] = {'lineas': valor, 'por': str(usuario)[:60], 'fecha': ahora}
        if not de_ficha:
            todo.pop(ident, None)
        destino = _archivo_ediciones()
        tmp = destino.with_suffix('.tmp')
        tmp.write_text(json.dumps(todo, ensure_ascii=False, indent=1), encoding='utf-8')
        tmp.replace(destino)
    return _resumir(f)


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
    confeccion, etiqueta = [], ''
    for c in f.get('confeccion', []):   # las filas sin rótulo (celdas combinadas en el Excel) siguen siendo del rótulo de arriba
        etiqueta = c.get('etiqueta') or etiqueta
        valor = (c.get('valor') or '').strip()
        if not fichas_mod._plano(etiqueta).startswith(clave) or (not c.get('extra') and re.fullmatch(r'\d+/\d+', valor)):
            continue
        confeccion.append({'etiqueta': etiqueta, 'valor': valor + (' — ' + c['extra'] if c.get('extra') else '')})
    res = {
        'id': f['id'], 'ref': f['ref'], 'hoja': f['hoja'], 'familia': f['familia'], 'prenda': f.get('prenda', ''), 'referencia': f.get('referencia', ''),
        'nota': f.get('nota_prenda', ''), 'nota_promedio': f.get('nota_promedio', ''), 'composicion': f.get('composicion', ''), 'fit': f.get('fit'), 'telas': telas, 'promedios': promedios,
        'descripcion': [d['texto'] for d in f.get('descripcion', [])][:24],
        'piezas': [str(p) for p in (f.get('piezas') or [])][:40],
        'tallajes': [t for t in f.get('tallajes', []) if t.get('tallas')],
        'insumos': f.get('insumos', []), 'medidas_insumos': f.get('medidas_insumos', [])[:12],
        'confeccion': confeccion[:20], 'terminacion': f.get('terminacion', [])[:6], 'empaque_insumos': f.get('empaque_insumos', []),
        'imagenes': [i['archivo'] for i in principales[:8]], 'total_imagenes': len(imagenes), 'mockup': fichas_mod.con_mockup().get(f['ref']),
    }
    # textos corregidos a mano desde el panel: reemplazan a los del Excel en su sección
    editado = {}
    for seccion, e in (_ediciones().get(f['id']) or {}).items():
        if seccion not in SECCIONES or not isinstance(e, dict):
            continue
        lineas = e.get('lineas') or []
        tipo = SECCIONES[seccion]
        if tipo == 'texto':
            res[seccion] = ' '.join(str(x) for x in lineas)
        elif seccion == 'piezas':   # no pisa `piezas` (los rótulos del Excel): va aparte
            res['piezas_man'] = lineas
        elif seccion == 'promedios':
            res[seccion] = [{'nombre': x.get('nombre', ''), 'valores': {k: x[k] for k in ('masc', 'feme', 'nino') if x.get(k)}} for x in lineas]
        elif seccion == 'tallajes':
            res[seccion] = []
            for x in lineas:
                tallas = _serie(x.get('tallas'))
                res[seccion].append({'titulo': x.get('titulo', ''), 'tallas': tallas, 'nota': '', **{k: _serie(x.get(k), len(tallas)) for k in ('ancho', 'alto', 'largo')}})
        elif seccion == 'medidas_insumos':
            res[seccion] = [{'titulo': x.get('titulo', ''), 'tallas': _serie(x.get('tallas')), 'medidas': _serie(x.get('medidas'), len(_serie(x.get('tallas'))))} for x in lineas]
        else:
            res[seccion] = lineas
        editado[seccion] = {'por': e.get('por', ''), 'fecha': e.get('fecha', '')}
    res.setdefault('especificaciones', [])
    res.setdefault('piezas_man', [])
    res['editado'] = editado
    return res


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
    return FileResponse(p, media_type='image/png' if p.suffix == '.png' else 'image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@router.get('/mockup')
def mockup(ref: str):
    p = fichas_mod.ruta_mockup(ref)
    if not p:
        raise HTTPException(404, 'Esa referencia no tiene mockup')
    return FileResponse(p, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})
