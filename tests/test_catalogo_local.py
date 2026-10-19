import os
import tempfile
import unittest

from app import catalogo_local as cat


class CatalogoLocal(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        os.environ['CATALOGO_DB'] = os.path.join(self.dir.name, 'catalogo.sqlite3')
        cat._listo = False
        self.cli = cat.create_client('http://no-se-usa', 'x')

    def tearDown(self):
        os.environ.pop('CATALOGO_DB', None)
        self.dir.cleanup()

    def test_cliente_se_guarda_y_se_actualiza_sin_duplicar(self):
        self.cli.table('clientes').upsert({'nombre': 'ACME SAS', 'carpeta_nas': 'A'}, on_conflict='nombre').execute()
        self.cli.table('clientes').upsert({'nombre': 'ACME SAS', 'carpeta_nas': 'B'}, on_conflict='nombre').execute()
        filas = self.cli.table('clientes').select('nombre, carpeta_nas').execute().data
        self.assertEqual(filas, [{'nombre': 'ACME SAS', 'carpeta_nas': 'B'}])

    def test_telas_como_las_pide_el_catalogo(self):
        self.cli.table('reprog_telas').upsert([{'codigo': '50', 'nombre': 'MONTECATINI 2'}, {'codigo': '700', 'nombre': 'TOUR'}], on_conflict='codigo').execute()
        r = self.cli.table('reprog_telas').select('codigo, nombre').execute()
        self.assertEqual({t['codigo']: t['nombre'] for t in r.data}, {'50': 'MONTECATINI 2', '700': 'TOUR'})

    def test_vendedor_con_correo(self):
        self.cli.table('vendedores').upsert({'nombre': 'ANDRES LOPEZ', 'sigla': 'AL', 'email': 'al@x.co'}).execute()
        self.assertEqual(self.cli.table('vendedores').select('nombre, email').execute().data, [{'nombre': 'ANDRES LOPEZ', 'email': 'al@x.co'}])

    def test_tabla_o_columna_desconocida_falla_claro(self):
        with self.assertRaises(ValueError):
            self.cli.table('otra').select('*').execute()
        with self.assertRaises(ValueError):
            self.cli.table('telas').select('codigo, inventada').execute()


if __name__ == '__main__':
    unittest.main()
