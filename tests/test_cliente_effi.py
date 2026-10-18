"""CREAR CLIENTE: lectura de los datos, cuerpo que se manda a Effi y permisos."""
import unittest
from unittest import mock

from fastapi import HTTPException

from app import cliente_effi as ce
from app import effi_api


class Interpretar(unittest.TestCase):
    def test_empresa_con_nit(self):
        c = ce.interpretar('CONFECCIONES LA 80 S.A.S.\nNIT: 900.123.456-7\nDirección: Calle 10 # 20-30 Barrio Centro\nCiudad: Medellín\nTel 604 321 4455 Cel 300 123 4567\nventas@la80.com')
        self.assertEqual((c['t_dni'], c['t_persona'], c['numero']), (1, 2, '900123456'))
        self.assertEqual(c['nombre'], 'Confecciones la 80 S.A.S.')
        self.assertEqual(c['celular'], '3001234567')
        self.assertEqual(c['telefono1'], '6043214455')
        self.assertEqual(c['email'], 'ventas@la80.com')
        self.assertEqual(c['ciudad_texto'], 'Medellín')

    def test_persona_con_cedula_y_ciudad_al_final_de_la_direccion(self):
        c = ce.interpretar('Nombre: Ana Pérez\nC.C. 1.020.304.050\nCarrera 7 No 45-12, Bogotá')
        self.assertEqual((c['t_dni'], c['numero'], c['nombre']), (2, '1020304050', 'Ana Pérez'))
        self.assertEqual(c['direccion'], 'Carrera 7 No 45-12')
        self.assertEqual(c['ciudad_texto'], 'Bogotá')

    def test_el_celular_no_se_toma_como_cedula(self):
        c = ce.interpretar('Juan Gómez\n3001234567')
        self.assertNotEqual(c.get('numero'), '3001234567')
        self.assertEqual(c['celular'], '3001234567')

    def test_texto_vacio(self):
        self.assertEqual(ce.interpretar(''), {})


DATOS = {'t_dni': 2, 'numero': '1020304050', 'nombre': 'Ana Pérez', 'email': 'ana@x.co', 'direccion': 'Calle 1 # 2-3', 'id_ciudad': 12601, 'id_provincia': 776}


RUT_NATURAL = """. ) | Js Nj Formulario del Registro Unico Tributario O
2. Concepto 0 |2| Actualización
4. Número de formulario 141172216952
5. Número de Identificación Tributaria (NIT) 6. DV
1035852152 7
24. Tipo de contribuyente Persona natural
31. Primer apellido 32. Segundo apellido 33. Primer nombre 34. Otros nombres
GOMEZ PEREZ JUAN CARLOS
41. Dirección principal
CL 10 20 30 BRR CENTRO
42. Correo electrónico
juan@correo.com
44. Teléfono 1
3136589522"""
RUT_EMPRESA = """Formulario del Registro Único Tributario
5. Número de Identificación Tributaria (NIT) 6. DV
900123456 7
24. Tipo de contribuyente Persona jurídica
35. Razón social
CONFECCIONES LA 80 S A S
42. Correo electrónico
ventas@la80.com"""


class Rut(unittest.TestCase):
    def test_persona_natural_no_toma_el_numero_de_formulario_ni_el_encabezado(self):
        c = ce.interpretar(RUT_NATURAL)
        self.assertEqual((c['t_dni'], c['t_persona'], c['numero']), (2, 1, '1035852152'))
        self.assertEqual(c['nombre'], 'Juan Carlos Gomez Perez')
        self.assertEqual(c['direccion'], 'CL 10 20 30 BRR CENTRO')
        self.assertEqual((c['email'], c['celular']), ('juan@correo.com', '3136589522'))
        self.assertNotIn('telefono1', c)

    def test_empresa(self):
        c = ce.interpretar(RUT_EMPRESA)
        self.assertEqual((c['t_dni'], c['t_persona'], c['numero']), (1, 2, '900123456'))
        self.assertEqual(c['nombre'], 'Confecciones la 80 S A S')


class Crear(unittest.TestCase):
    def test_cuerpo_minimo_y_direccion(self):
        cuerpo = ce._cuerpo_cliente({'t_dni': '1', 'numero': '900.123.456', 'nombre': 'La 80 SAS', 't_persona': '2', 'email': 'a@b.co', 'celular': '300 123 4567', 'id_ciudad': 12601, 'id_provincia': 776, 'direccion': 'Calle 10 # 20-30'})
        self.assertEqual((cuerpo['t_dni'], cuerpo['numero'], cuerpo['t_persona']), (1, '900123456', 2))
        self.assertEqual(cuerpo['celular'], '3001234567')
        self.assertEqual(cuerpo['direcciones'], [{'id_provincia': 776, 'id_ciudad': 12601, 'direccion': 'Calle 10 # 20-30'}])

    def test_faltan_datos(self):
        for p in ({'t_dni': '9', 'numero': '1', 'nombre': 'Ana'}, {'t_dni': '2', 'numero': '', 'nombre': 'Ana'}, {'t_dni': '2', 'numero': '123456', 'nombre': 'A'}):
            with self.assertRaises(HTTPException):
                ce._cuerpo_cliente(p)

    def test_crear_llama_a_effi_y_anota_quien_lo_creo(self):
        ce.configurar(lambda request: 'Laura', lambda u: True, lambda: 'K' * 40)
        respuesta = {'ok': True, 'data': {'tercero': '6490', 'nombre': 'Ana Pérez', 'abreviacion': 'CC', 'id': '1020304050', 'dv': None}}
        try:
            with mock.patch.object(effi_api, '_peticion', return_value=respuesta) as llamada:
                r = ce.crear(None, DATOS)
            args, kwargs = llamada.call_args
            self.assertEqual(args[:2], ('POST', 'cliente'))
            self.assertIn('Laura', kwargs['cuerpo']['observacion'])
            self.assertEqual((r['tercero'], r['documento']), ('6490', 'CC 1020304050'))
        finally:
            effi_api.usar_llave('')

    def test_error_de_effi_llega_al_comercial(self):
        ce.configurar(lambda request: 'Laura', lambda u: True, lambda: 'K' * 40)
        try:
            with mock.patch.object(effi_api, '_peticion', side_effect=effi_api.EffiError('El Número de identificación ingresado corresponde a un cliente vigente de la empresa.', 400)):
                with self.assertRaises(HTTPException) as e:
                    ce.crear(None, DATOS)
            self.assertEqual(e.exception.status_code, 400)
            self.assertIn('cliente vigente', e.exception.detail)
        finally:
            effi_api.usar_llave('')

    def test_exige_correo_y_direccion(self):
        for quitar in ('email', 'direccion', 'id_ciudad'):
            d = {k: v for k, v in DATOS.items() if k != quitar}
            with self.assertRaises(HTTPException) as e:
                ce._cuerpo_cliente(d)
            self.assertEqual(e.exception.status_code, 400)

    def test_nombre_en_formato_titulo_y_regimen(self):
        c = ce.interpretar('CONFECCIONES LA 80 S.A.S.\nNIT 900123456-7\n49 - No responsable de IVA')
        self.assertEqual(c['nombre'], 'Confecciones la 80 S.A.S.')
        self.assertEqual(c['t_regimen_iva'], 5)

    def test_fuentes_que_se_contradicen(self):
        avisos = ce.conflictos(['Ana Pérez C.C. 1020304050', 'Ana Pérez C.C. 1020304051'])
        self.assertTrue(any('identificación' in a for a in avisos))

    def test_sin_permiso_comercial(self):
        ce.configurar(lambda request: 'Operario', lambda u: False, lambda: 'K' * 40)
        with self.assertRaises(HTTPException) as e:
            ce.crear(None, {})
        self.assertEqual(e.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
