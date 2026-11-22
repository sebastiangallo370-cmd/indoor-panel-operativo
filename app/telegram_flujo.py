"""Flujo guiado de Telegram para crear cotizaciones y remisiones en Effi (sin IA).

Es una máquina de estados pura: recibe el estado del chat y lo que escribió el usuario (texto o botón)
y devuelve el nuevo estado, el texto a mostrar y los botones. No habla con Telegram ni con Effi:
eso lo hace telegram_bot.py. Así el flujo se prueba sin conexión.

Pasos: tipo -> cliente -> referencia -> talla y cantidad -> forma de pago -> resumen -> crear o cancelar.
"""
from __future__ import annotations

import copy

TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
PAGOS = ['Contado', 'Crédito 30 días', 'Crédito 60 días']
PASO_INICIAL = {'paso': 'inicio', 'tipo': '', 'cliente': '', 'lineas': [], 'linea': {}, 'pago': ''}


def _teclado(filas: list[list[tuple[str, str]]]) -> list[list[dict]]:
    """Filas de (texto, dato del botón) -> formato inline_keyboard de Telegram."""
    return [[{'text': t, 'callback_data': d} for t, d in fila] for fila in filas]


def _resumen(e: dict) -> str:
    lineas = '\n'.join(f"  • {x['referencia']} · talla {x['talla']} · {x['cantidad']} u" for x in e['lineas']) or '  (sin líneas)'
    return (f"<b>{'Cotización' if e['tipo'] == 'cotizacion' else 'Remisión de venta'}</b>\n"
            f"Cliente: {e['cliente']}\nForma de pago: {e['pago']}\nProductos:\n{lineas}")


def inicio(texto: str = '') -> dict:
    return copy.deepcopy(PASO_INICIAL)


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
        e['pago'] = entrada[2:]; e['paso'] = 'resumen'
        return e, _resumen(e), _teclado([[('✅ Crear en Effi', 'crear'), ('❌ Cancelar', 'cancelar')]])

    if paso == 'resumen':
        if entrada == 'crear':
            e['paso'] = 'creando'
            return e, 'Creando en Effi…', None
        if entrada == 'cancelar':
            return inicio(), 'Cancelado. No se creó nada.', None

    return e, 'No entendí. Escribe /cotizar, /remision o /cancelar.', None
