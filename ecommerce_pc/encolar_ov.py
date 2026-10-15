"""Pone una orden de venta ya descargada (PDF_OV\\OV_<n>.pdf) en la cola de ECOMMERCE para que BRISA y CIRO la ejecuten,
sin pasar por Effi (sin ALMA). Sirve para repetir o probar una orden, por ejemplo:  python encolar_ov.py 1216

Ojo: BRISA y CIRO la ejecutan DE VERDAD (exportan tallas, generan los PDF, rehacen el listado y agregan otra fila en Google Sheets).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agente_ov as ag  # noqa: E402


def main():
    if len(sys.argv) < 2 or not sys.argv[1].strip().upper().replace('OV', '').isdigit():
        print('Uso: python encolar_ov.py 1216')
        return 1
    numero = sys.argv[1].strip().upper().replace('OV', '')
    pdf = ag.carpeta_ov() / 'PDF_OV' / f'OV_{numero}.pdf'
    if not pdf.exists():
        print(f'No encuentro {pdf}. Solo se pueden encolar órdenes que ya están descargadas en PDF_OV.')
        return 1
    if numero in ag.numeros_en_cola():
        print(f'OV{numero} ya está en la cola (mira ecommerce\\cola\\). Si quedó en «errores», muévela a 1_descargadas.')
        return 1
    ag.guardar_trabajo('1_descargadas', {'numero': numero, 'pdf': str(pdf), 'intentos': 0, 'origen': 'encolar_ov.py'})
    print(f'OV{numero} quedó en la cola 1_descargadas. Inicia a BRISA y luego a CIRO desde el panel (Ecommerce).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
