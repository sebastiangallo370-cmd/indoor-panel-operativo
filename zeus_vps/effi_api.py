"""Cliente mínimo de la API de Effi para crear órdenes de compra de tela (https://effi.com.co/app/api#orden_c_crear).
Autenticación: Authorization: Bearer <EFFI_API_KEY> (la llave del usuario de Effi: Administración > Usuarios > Ver más detalles). Nunca se imprime.
Variables (zeus.env): EFFI_API_KEY (obligatoria), EFFI_API_URL (por defecto https://effi.com.co/api), EFFI_SUCURSAL=1, EFFI_BODEGA=10, EFFI_CENTRO_COSTOS=1,
EFFI_FORMA_PAGO (id de respaldo si el proveedor no trae una), EFFI_DESCUENTO_PCT=0 (porcentaje de descuento a cada concepto), EFFI_RETENCIONES (ids separados por coma).
Los totales los calcula Effi y los compara con los que se envían (tolerancia 0,01 %): aquí se calculan igual (descuento, impuestos en porcentaje y retenciones en porcentaje).
Uso de prueba (NO crea nada):  python effi_api.py prueba <referencia_tela> <metros> <proveedor>"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import ROUND_HALF_UP, Decimal

BASE = os.getenv('EFFI_API_URL', 'https://effi.com.co/api').rstrip('/')


class EffiError(Exception):
    def __init__(self, mensaje: str, estado: int = 0, cuerpo: dict | None = None):
        super().__init__(mensaje)
        self.estado, self.cuerpo = estado, cuerpo or {}


def llave() -> str:
    return (os.getenv('EFFI_API_KEY') or '').strip()


def disponible() -> bool:
    return bool(llave())


def _peticion(metodo: str, ruta: str, params: dict | None = None, cuerpo: dict | None = None, reintento: bool = True) -> dict:
    url = f'{BASE}/{ruta.lstrip("/")}' + ('?' + urllib.parse.urlencode(params) if params else '')
    datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8') if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo, headers={'Authorization': 'Bearer ' + llave(), 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        texto = e.read().decode('utf-8', 'replace')
        try:
            j = json.loads(texto)
        except ValueError:
            j = {}
        if e.code == 429 and reintento:   # 120 peticiones por minuto: se espera lo que pida Effi y se reintenta una vez
            time.sleep(min(60, int(e.headers.get('Retry-After') or 5)))
            return _peticion(metodo, ruta, params, cuerpo, reintento=False)
        mensaje = j.get('mensaje') or {401: 'La API key no es válida o venció (renuévala en Effi: Administración > Usuarios).', 403: 'La API key no tiene permiso para esa función.'}.get(e.code) or f'Effi respondió {e.code}'
        raise EffiError(mensaje, e.code, j)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise EffiError(f'No se pudo conectar con la API de Effi: {e}', 0)


def _lista(ruta: str, params: dict | None = None) -> list[dict]:
    d = _peticion('GET', ruta, {**(params or {}), 'por_pagina': 100})
    return d.get('data') or []


def _d(valor) -> Decimal:
    try:
        return Decimal(str(valor).replace(',', '')) if valor not in (None, '') else Decimal(0)
    except Exception:   # noqa: BLE001
        return Decimal(0)


def _redondear(x: Decimal) -> Decimal:
    return x.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def proveedor(nombre: str) -> dict:
    """Busca el proveedor por palabras de su nombre (el elegido en Estándar 2026) y devuelve su código interno, dirección y forma de pago."""
    palabras = ' '.join(re.findall(r'\w+', nombre))[:60]
    candidatos = _lista('proveedor', {'nombre': palabras})
    if not candidatos:
        raise EffiError(f'No encontré el proveedor «{nombre}» en Effi')
    exacto = [c for c in candidatos if re.sub(r'\W+', '', str(c.get('nombre') or c.get('nombre_razon_social') or '')).upper() == re.sub(r'\W+', '', nombre).upper()]
    elegido = (exacto or candidatos)[0]
    if len(candidatos) > 1 and not exacto:
        raise EffiError(f'«{nombre}» coincide con {len(candidatos)} proveedores de Effi; escribe el nombre completo en Estándar 2026')
    codigo = elegido.get('tercero') or elegido.get('codigo_tercero')
    if not codigo:
        raise EffiError('La respuesta del proveedor no trae su código interno (campo «tercero»)')
    return {'codigo': int(codigo), 'direcciones': elegido.get('direcciones') or [], 'forma_pago': elegido.get('t_forma_pago'), 'nombre': elegido.get('nombre') or nombre}


def articulo(referencia: str) -> dict:
    """Artículo cuya REFERENCIA es exactamente la pedida (la búsqueda de Effi es por «contiene»)."""
    for a in _lista('articulo', {'referencia': referencia}):
        if str(a.get('referencia') or '').strip() == str(referencia).strip():
            return a
    raise EffiError(f'No hay en Effi un artículo con Referencia exacta {referencia}')


def impuestos_de(etiquetas_texto: str | None) -> list[dict]:
    """Impuestos de la empresa que corresponden a las etiquetas del artículo (el artículo trae el texto, el pedido necesita los ids)."""
    if not etiquetas_texto:
        return []
    etiquetas = [e.strip() for e in re.split(r'<hr[^>]*>|;', str(etiquetas_texto)) if e.strip()]
    todos = _lista('impuesto')
    encontrados = []
    for e in etiquetas:
        c = [i for i in todos if str(i.get('etiqueta') or '').strip().upper() == e.upper() or str(i.get('nombre') or '').strip().upper() == e.upper()]
        if not c:
            raise EffiError(f'No encontré el impuesto «{e}» del artículo en la lista de impuestos de Effi')
        encontrados.append(c[0])
    return encontrados


def retenciones_de(ids: list[int]) -> list[dict]:
    if not ids:
        return []
    todas = _lista('retencion')
    por_id = {int(r['id']): r for r in todas}
    faltan = [i for i in ids if i not in por_id]
    if faltan:
        raise EffiError(f'No encontré las retenciones {faltan} en Effi')
    return [por_id[i] for i in ids]


def construir_pedido(item_id, referencia: str, metros: float, nombre_proveedor: str, descripcion: str = '') -> dict:
    """Arma el cuerpo de POST /orden_c. Devuelve {'cuerpo', 'resumen'}; no envía nada."""
    prov = proveedor(nombre_proveedor)
    art = articulo(referencia)
    precio = _d(art.get('p_costo_ultimo')) or _d(art.get('p_costo'))
    if precio <= 0:
        raise EffiError('El artículo no tiene costo en Effi (o la llave no tiene permiso de «Artículos - Costos»): no se sabe el precio')
    imps = impuestos_de(art.get('impuesto'))
    for i in imps:
        if str(i.get('tipo_calculo') or '').lower() != 'porcentaje':
            raise EffiError(f"El impuesto «{i.get('etiqueta')}» no es de porcentaje: no sé calcularlo")
    rets = retenciones_de([int(x) for x in re.findall(r'\d+', os.getenv('EFFI_RETENCIONES', ''))])
    cantidad = _d(metros)
    bruto = precio * cantidad
    desc_pct = _d(os.getenv('EFFI_DESCUENTO_PCT', '0'))
    descuento = _redondear(bruto * desc_pct / 100)
    subtotal = bruto - descuento
    imp_valor = sum((subtotal * _d(i.get('valor')) / 100 for i in imps), Decimal(0))
    ret_valor = Decimal(0)
    for r in rets:
        if str(r.get('tipo_calculo') or '').lower() not in ('porcentaje', 'sobre impuesto principal'):
            raise EffiError(f"La retención «{r.get('etiqueta')}» no es de porcentaje: no sé calcularla")
        base = subtotal if str(r.get('tipo_calculo')).lower() == 'porcentaje' else imp_valor
        ret_valor += base * _d(r.get('valor')) / 100
    total = _redondear(subtotal + imp_valor - ret_valor)
    forma = prov['forma_pago'] or os.getenv('EFFI_FORMA_PAGO')
    if not forma:
        raise EffiError('El proveedor no tiene forma de pago en Effi y no hay EFFI_FORMA_PAGO de respaldo')
    cuerpo = {
        'idempotency_key': f'zeus-oc-{item_id}'[:36],
        'sucursal': int(os.getenv('EFFI_SUCURSAL', '1')), 'bodega': int(os.getenv('EFFI_BODEGA', '10')), 'centro_costos': int(os.getenv('EFFI_CENTRO_COSTOS', '1')),
        'proveedor': prov['codigo'],
        'articulo': [str(art['id'])], 'descripcion': [(descripcion or str(art.get('descripcion') or referencia))[:120]],
        'cantidad': [float(cantidad)], 'precio': [float(precio)], 'descuento': [float(descuento)],
        't_forma_pago': [int(forma)], 'valor_forma_pago': [float(total)],
        'observacion': 'Orden creada por el AGENTE INVENTARIO (Tela programada)',
    }
    if imps:
        cuerpo['impuestos'] = {'1': [int(i['id']) for i in imps]}
    if rets:
        cuerpo['retenciones'] = [int(r['id']) for r in rets]
    d = next((x for x in prov['direcciones'] if x.get('id_ciudad') and x.get('direccion')), None)   # misma dirección que ya tiene el proveedor
    if d:
        cuerpo.update(id_pais_proveedor=int(d['id_pais']), id_provincia_proveedor=int(d['id_provincia']), id_ciudad_proveedor=int(d['id_ciudad']), direccion_proveedor=str(d['direccion'])[:200])
    resumen = {'proveedor': prov['nombre'], 'articulo': art.get('descripcion'), 'precio': float(precio), 'bruto': float(_redondear(bruto)), 'descuento': float(descuento),
               'impuestos': float(_redondear(imp_valor)), 'retenciones': float(_redondear(ret_valor)), 'total': float(total)}
    return {'cuerpo': cuerpo, 'resumen': resumen}


def crear_orden(item_id, referencia: str, metros: float, nombre_proveedor: str, descripcion: str = '') -> dict:
    """Crea la orden por la API. Devuelve {'oc': id, 'detalle': texto}. Un reintento con la misma clave no crea otra orden (409 → se devuelve la ya creada)."""
    p = construir_pedido(item_id, referencia, metros, nombre_proveedor, descripcion)
    try:
        r = _peticion('POST', 'orden_c', cuerpo=p['cuerpo'])
        data = r.get('data') or {}
    except EffiError as e:
        if e.estado != 409:
            raise
        data = (e.cuerpo.get('data') or {}) if isinstance(e.cuerpo, dict) else {}
        if not data.get('id'):
            raise EffiError('Effi dice que esta orden ya se creó, pero no devolvió su número: revísala en Compras > Órdenes de compra', 409)
    res = p['resumen']
    return {'oc': str(data.get('id')), 'detalle': f"API Effi {data.get('id_transaccion') or data.get('id')} · {res['proveedor'][:40]} · {metros:g} MTS · total ${data.get('total') or res['total']}"}


if __name__ == '__main__':
    if len(sys.argv) >= 5 and sys.argv[1] == 'prueba':
        if not disponible():
            print('Falta EFFI_API_KEY en el entorno (zeus.env).'); sys.exit(1)
        try:
            out = construir_pedido('prueba', sys.argv[2], float(sys.argv[3]), sys.argv[4])
            print(json.dumps(out, ensure_ascii=False, indent=1))
            print('\nNo se envió nada: es solo la vista previa del pedido.')
        except EffiError as e:
            print('Error:', e); sys.exit(2)
    else:
        print(__doc__)
