"""Flujo guiado de Telegram para crear cotizaciones y remisiones en Effi (sin IA).

Es una máquina de estados pura: recibe el estado del chat y lo que escribió el usuario (texto o botón)
y devuelve el nuevo estado, el texto a mostrar y los botones. No habla con Telegram ni con Effi:
eso lo hace telegram_bot.py. Así el flujo se prueba sin conexión.

Pasos: tipo -> cliente -> referencia -> talla y cantidad -> forma de pago -> resumen -> crear o cancelar.
"""
from __future__ import annotations

import copy
import re
from datetime import date, timedelta

MESES = {'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
         'septiembre': 9, 'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12}


def parse_fecha(texto: str) -> str | None:
    """Fecha de entrega en ISO (YYYY-MM-DD) a partir de '20/12/2026', '20-12', '20 de diciembre de 2026' o '2026-12-20'.
    Si no trae año se usa el próximo año que no quede en el pasado. Devuelve None si no entiende."""
    t = (texto or '').lower().strip()
    hoy = date.today()
    m = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', t)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return None
    anio = None
    m = re.search(r'(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?', t)
    if m:
        dia, mes = int(m[1]), int(m[2])
        if m[3]:
            anio = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
    else:
        m = re.search(r'(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)(?:\s+(?:de\s+)?(\d{4}))?', t)
        if not m or m[2] not in MESES:
            return None
        dia, mes = int(m[1]), MESES[m[2]]
        anio = int(m[3]) if m[3] else None
    try:
        if anio:
            return date(anio, mes, dia).isoformat()
        f = date(hoy.year, mes, dia)
        if f < hoy:
            f = date(hoy.year + 1, mes, dia)
        return f.isoformat()
    except ValueError:
        return None

TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
PAGOS = ['Contado', 'Crédito 30 días', 'Crédito 60 días']
PASO_INICIAL = {'paso': 'inicio', 'tipo': '', 'cliente': '', 'lineas': [], 'linea': {}, 'pago': '', 'entrega': ''}


def _teclado(filas: list[list[tuple[str, str]]]) -> list[list[dict]]:
    """Filas de (texto, dato del botón) -> formato inline_keyboard de Telegram."""
    return [[{'text': t, 'callback_data': d} for t, d in fila] for fila in filas]


def _resumen(e: dict) -> str:
    lineas = '\n'.join(f"  • {x['referencia']} · talla {x['talla']} · {x['cantidad']} u" for x in e['lineas']) or '  (sin líneas)'
    return (f"<b>{'Cotización' if e['tipo'] == 'cotizacion' else 'Remisión de venta'}</b>\n"
            f"Cliente: {e['cliente']}\nForma de pago: {e['pago']}\nFecha de entrega: {e.get('entrega') or '(sin fecha)'}\nProductos:\n{lineas}")


def inicio(texto: str = '') -> dict:
    return copy.deepcopy(PASO_INICIAL)


def interpretar_voz(estado: dict | None, texto: str) -> str:
    """Convierte lo que dijo el comercial (transcrito) en la entrada del paso actual. Sin IA: busca palabras clave.
    Devuelve el texto tal cual para cliente y referencia; para talla, pago y cantidad devuelve el dato de botón o el número."""
    paso = (estado or {}).get('paso', 'inicio')
    t = ' '.join((texto or '').split())
    if paso == 'talla':
        for talla in TALLAS:
            if f' {talla} ' in f' {t.upper()} ' or t.upper() == talla:
                return f't:{talla}'
        return t
    if paso == 'entrega':
        baja = t.lower()
        if re.search(r'\b15\b', baja) and 'día' in baja:
            return 'e:15'
        if re.search(r'\b30\b', baja) and 'día' in baja:
            return 'e:30'
        return t
    if paso == 'pago':
        baja = t.lower()
        if 'contado' in baja or 'de contado' in baja:
            return 'p:Contado'
        if '60' in baja or 'sesenta' in baja:
            return 'p:Crédito 60 días'
        if '30' in baja or 'treinta' in baja:
            return 'p:Crédito 30 días'
        return t
    if paso == 'cantidad':
        digitos = ''.join(ch for ch in t if ch.isdigit())
        return digitos or t
    if paso == 'mas':
        baja = t.lower()
        if baja.startswith('si') or baja.startswith('sí') or 'otra' in baja:
            return 'mas:si'
        if baja.startswith('no') or 'sigo' in baja:
            return 'mas:no'
        return t
    return t


def procesar(estado: dict | None, entrada: str, *, buscar_clientes=None, buscar_referencias=None) -> tuple[dict, str, list | None]:
    """Devuelve (estado_nuevo, texto, teclado). `entrada` es un comando (/cotizar), un dato de botón o texto libre.
    buscar_clientes(q) y buscar_referencias(cliente, q) son funciones inyectadas (Effi / panel) que devuelven listas de strings."""
    e = copy.deepcopy(estado) if estado else inicio()
    entrada = (entrada or '').strip()
    if entrada in ('/start', '/ayuda'):
        return inicio(), ('Puedo crear <b>cotizaciones</b> y <b>remisiones</b> en Effi.\n'
                          'Escribe /cotizar o /remision para empezar. /cancelar para dejarlo.'), None
    if entrada == '/cancelar' or entrada == 'cancelar':
        return inicio(), 'Listo, cancelado. No se creó nada.', None
    if entrada in ('/cotizar', '/remision'):
        e = inicio()
        e['tipo'] = 'cotizacion' if entrada == '/cotizar' else 'remision'
        e['paso'] = 'cliente'
        return e, '¿Para qué cliente? Escribe el nombre.', None

    paso = e['paso']
    if paso == 'cliente':
        if not entrada:
            return e, 'Escribe el nombre del cliente.', None
        opciones = (buscar_clientes(entrada) if buscar_clientes else [])[:6]
        if not opciones:
            return e, f'No encontré “{entrada}”. Escribe otro nombre o parte del nombre.', None
        if len(opciones) == 1 and opciones[0].lower() == entrada.lower():
            e['cliente'] = opciones[0]; e['paso'] = 'referencia'
            return e, '¿Qué referencia? Escribe el código (ej. A100FUT01).', None
        e['paso'] = 'cliente_elegir'
        return e, 'Elige el cliente:', _teclado([[(o, f'c:{o}')] for o in opciones])

    if paso == 'cliente_elegir' and entrada.startswith('c:'):
        e['cliente'] = entrada[2:]; e['paso'] = 'referencia'
        return e, '¿Qué referencia? Escribe el código (ej. A100FUT01).', None

    if paso == 'referencia':
        if not entrada:
            return e, 'Escribe el código de la referencia.', None
        refs = (buscar_referencias(e['cliente'], entrada) if buscar_referencias else [])[:6] or [entrada.upper()]
        e['linea'] = {'referencia': refs[0] if len(refs) == 1 else ''}
        if len(refs) > 1:
            e['paso'] = 'referencia_elegir'
            return e, 'Elige la referencia:', _teclado([[(r, f'r:{r}')] for r in refs])
        e['paso'] = 'talla'
        return e, f"Talla de {e['linea']['referencia']}:", _teclado([[(t, f't:{t}') for t in TALLAS[i:i + 3]] for i in range(0, len(TALLAS), 3)])

    if paso == 'referencia_elegir' and entrada.startswith('r:'):
        e['linea'] = {'referencia': entrada[2:]}; e['paso'] = 'talla'
        return e, f"Talla de {entrada[2:]}:", _teclado([[(t, f't:{t}') for t in TALLAS[i:i + 3]] for i in range(0, len(TALLAS), 3)])

    if paso == 'talla' and entrada.startswith('t:'):
        e['linea']['talla'] = entrada[2:]; e['paso'] = 'cantidad'
        return e, '¿Cuántas unidades? Escribe el número.', None

    if paso == 'cantidad':
        if not entrada.isdigit() or int(entrada) <= 0 or int(entrada) > 5000:
            return e, 'Escribe un número entre 1 y 5000.', None
        e['linea']['cantidad'] = int(entrada)
        e['lineas'].append(dict(e['linea'])); e['linea'] = {}
        e['paso'] = 'mas'
        return e, '¿Agregar otra línea?', _teclado([[('Sí, otra', 'mas:si'), ('No, sigo', 'mas:no')]])

    if paso == 'mas' and entrada in ('mas:si', 'mas:no'):
        if entrada == 'mas:si':
            e['paso'] = 'referencia'
            return e, '¿Qué referencia? Escribe el código.', None
        e['paso'] = 'pago'
        return e, 'Forma de pago:', _teclado([[(p, f'p:{p}')] for p in PAGOS])

    if paso == 'pago' and entrada.startswith('p:'):
        e['pago'] = entrada[2:]; e['paso'] = 'entrega'
        return e, '¿Para qué fecha de entrega?', _teclado([[('En 15 días', 'e:15'), ('En 30 días', 'e:30')], [('Escribir fecha', 'e:otra')]])

    if paso == 'entrega':
        fecha = parse_fecha(entrada)   # también acepta una fecha escrita o dictada
        if entrada.startswith('e:') and entrada != 'e:otra':
            fecha = (date.today() + timedelta(days=int(entrada[2:]))).isoformat()
        elif entrada == 'e:otra':
            e['paso'] = 'entrega_fecha'
            return e, 'Escribe la fecha de entrega (dd/mm/aaaa), por ejemplo 20/12/2026.', None
        if fecha:
            e['entrega'] = fecha; e['paso'] = 'resumen'
            return e, _resumen(e), _teclado([[('✅ Crear en Effi', 'crear'), ('❌ Cancelar', 'cancelar')]])
        return e, '¿Para qué fecha de entrega? Elige un botón o escribe la fecha.', _teclado([[('En 15 días', 'e:15'), ('En 30 días', 'e:30')], [('Escribir fecha', 'e:otra')]])

    if paso == 'entrega_fecha':
        fecha = parse_fecha(entrada)
        if not fecha:
            return e, 'No entendí la fecha. Escríbela como 20/12/2026.', None
        e['entrega'] = fecha; e['paso'] = 'resumen'
        return e, _resumen(e), _teclado([[('✅ Crear en Effi', 'crear'), ('❌ Cancelar', 'cancelar')]])

    if paso == 'resumen':
        if entrada == 'crear':
            e['paso'] = 'creando'
            return e, 'Creando en Effi…', None
        if entrada == 'cancelar':
            return inicio(), 'Cancelado. No se creó nada.', None

    return e, 'No entendí. Escribe /cotizar, /remision o /cancelar.', None
