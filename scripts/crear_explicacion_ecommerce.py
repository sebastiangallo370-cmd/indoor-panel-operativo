from pathlib import Path
from datetime import date
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "Explicacion_Ecommerce_Indoor_Sport.docx"

NAVY = "12355B"
BLUE = "2F78C4"
LIGHT = "EAF2FA"
GREEN = "2E7D32"
GREY = "5B6573"

def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:fill'), fill)
    tc_pr.append(shd)

def border_bottom(paragraph, color=NAVY, size="10"):
    p = paragraph._p
    pPr = p.get_or_add_pPr()
    borders = pPr.first_child_found_in('w:pBdr')
    if borders is None:
        borders = OxmlElement('w:pBdr')
        pPr.append(borders)
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), size)
    bottom.set(qn('w:space'), '6')
    bottom.set(qn('w:color'), color)
    borders.append(bottom)

def set_cell_text(cell, text, bold=False, color=None, size=9):
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run(text)
    r.bold = bold
    r.font.size = Pt(size)
    if color:
        r.font.color.rgb = RGBColor.from_string(color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def bullet(doc, text):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_after = Pt(4)
    p.add_run(text)
    return p

def add_heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    p.style.font.color.rgb = RGBColor.from_string(NAVY)
    if level == 1:
        border_bottom(p)
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(7)
    return p

def add_note(doc, title, text, tone=LIGHT):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    shade(cell, tone)
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(title + '  ')
    r.bold = True
    r.font.color.rgb = RGBColor.from_string(NAVY)
    p.add_run(text)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)

def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Inches(0.75)
    sec.bottom_margin = Inches(0.72)
    sec.left_margin = Inches(0.78)
    sec.right_margin = Inches(0.78)

    styles = doc.styles
    styles['Normal'].font.name = 'Aptos'
    styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'), 'Aptos')
    styles['Normal'].font.size = Pt(10.3)
    styles['Normal'].paragraph_format.space_after = Pt(6)
    for name, size in [('Title', 25), ('Heading 1', 15), ('Heading 2', 11.5)]:
        styles[name].font.name = 'Aptos Display'
        styles[name]._element.rPr.rFonts.set(qn('w:eastAsia'), 'Aptos Display')
        styles[name].font.size = Pt(size)

    # Header / footer
    header = sec.header.paragraphs[0]
    header.text = 'INDOOR SPORT SAS  |  EXPLICACIÓN DEL ECOMMERCE'
    header.runs[0].font.size = Pt(8)
    header.runs[0].font.color.rgb = RGBColor.from_string(GREY)
    footer = sec.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run('Documento informativo  •  26 de octubre de 2026')
    footer.runs[0].font.size = Pt(8)
    footer.runs[0].font.color.rgb = RGBColor.from_string(GREY)

    # Cover
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(60)
    r = p.add_run('Ecommerce')
    r.font.name = 'Aptos Display'; r.font.size = Pt(30); r.bold = True; r.font.color.rgb = RGBColor.from_string(NAVY)
    p = doc.add_paragraph()
    r = p.add_run('Cómo funciona la línea automática de órdenes de venta')
    r.font.size = Pt(16); r.font.color.rgb = RGBColor.from_string(BLUE)
    p.paragraph_format.space_after = Pt(24)
    add_note(doc, 'Propósito.', 'Explicar de forma sencilla qué recibe Ecommerce, qué hace cada agente, qué muestran sus ventanas y qué resultado debe esperar la operación.')
    doc.add_paragraph('Esta línea conecta las órdenes de venta de Effi con la preparación de archivos y la programación de producción. Está diseñada para reducir tareas repetitivas, conservar trazabilidad y entregar a producción la información lista para trabajar.', style='Normal')
    doc.add_paragraph('Al estar activa, las nuevas órdenes se programan a nombre de INDOOR SPORT SAS. Al estar apagada, Ecommerce queda detenido por completo: no recibe, no procesa y no registra información.', style='Normal')
    doc.add_page_break()

    add_heading(doc, '1. ¿Qué es Ecommerce?')
    doc.add_paragraph('Ecommerce es una línea operativa automática dentro de Producción. Su función es tomar una orden de venta nueva, preparar los soportes necesarios y dejarla registrada para el siguiente paso de producción.')
    doc.add_paragraph('No reemplaza las validaciones del equipo: organiza el trabajo repetitivo y muestra con claridad cuándo una orden necesita revisión.')

    add_heading(doc, '2. El recorrido de una orden', 1)
    table = doc.add_table(rows=1, cols=5)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    steps = [
        ('1', 'Effi', 'Se genera una orden de venta.'),
        ('2', 'ALMA', 'Descarga el PDF y detecta órdenes nuevas.'),
        ('3', 'BRISA', 'Lee la orden y prepara las tallas.'),
        ('4', 'CIRO', 'Genera los archivos por jugador.'),
        ('5', 'Sheets', 'Programa la orden para producción.'),
    ]
    for i, (num, name, desc) in enumerate(steps):
        c = table.cell(0, i)
        shade(c, NAVY if i in (0, 4) else LIGHT)
        c.text = ''
        p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(num); r.bold = True; r.font.size = Pt(16); r.font.color.rgb = RGBColor.from_string('FFFFFF' if i in (0,4) else BLUE)
        p = c.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(name); r.bold = True; r.font.size = Pt(9); r.font.color.rgb = RGBColor.from_string('FFFFFF' if i in (0,4) else NAVY)
        p = c.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(desc); r.font.size = Pt(7.6); r.font.color.rgb = RGBColor.from_string('FFFFFF' if i in (0,4) else GREY)
    doc.add_paragraph()
    add_note(doc, 'Resultado esperado.', 'Una orden correcta avanza desde Effi hasta Google Sheets con sus soportes listos, sin que el equipo tenga que repetir la descarga, lectura y armado básico de archivos.', 'EAF6EC')

    add_heading(doc, '3. Qué hace cada agente')
    roles = doc.add_table(rows=1, cols=3)
    roles.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = roles.rows[0].cells
    for c, val in zip(hdr, ['Agente', 'Responsabilidad', 'Qué entrega']):
        shade(c, NAVY); set_cell_text(c, val, True, 'FFFFFF', 9)
    rows = [
        ('ALMA', 'Vigila las órdenes nuevas y descarga el PDF de venta.', 'La orden disponible para ser procesada.'),
        ('BRISA', 'Interpreta el PDF, identifica la referencia y prepara las tallas.', 'Las tablas de tallas listas para el diseño.'),
        ('CIRO', 'Genera el PDF por jugador, el Excel de producción y registra la orden.', 'Archivos de producción y fila programada en Google Sheets.'),
    ]
    for idx, values in enumerate(rows):
        cells = roles.add_row().cells
        for c, value in zip(cells, values):
            if idx % 2 == 0: shade(c, 'F5F8FC')
            set_cell_text(c, value, bold=(c is cells[0]), color=NAVY if c is cells[0] else None)

    doc.add_page_break()
    add_heading(doc, '4. Las ventanas del producto')
    doc.add_paragraph('En el panel, la línea se consulta desde la sección Ecommerce. Las ventanas están pensadas para entender el estado de una orden sin entrar a herramientas técnicas.')
    windows = doc.add_table(rows=1, cols=2)
    windows.alignment = WD_TABLE_ALIGNMENT.CENTER
    for c, val in zip(windows.rows[0].cells, ['Ventana', 'Para qué sirve']):
        shade(c, NAVY); set_cell_text(c, val, True, 'FFFFFF', 9)
    entries = [
        ('Estado de Ecommerce', 'Es el interruptor principal de la línea. Indica si Ecommerce está trabajando o detenido.'),
        ('Flujo', 'Muestra el camino ALMA → BRISA → CIRO, el estado de cada etapa, actividad reciente y avisos.'),
        ('Órdenes', 'Permite ver las órdenes recibidas, su avance y si alguna requiere revisión.'),
        ('Agentes', 'Muestra si los tres agentes están conectados y trabajando desde el computador operativo.'),
        ('Registro', 'Conserva el historial de actividad para saber qué pasó y cuándo ocurrió.'),
    ]
    for idx, values in enumerate(entries):
        cells = windows.add_row().cells
        for c, value in zip(cells, values):
            if idx % 2 == 0: shade(c, 'F5F8FC')
            set_cell_text(c, value, bold=(c is cells[0]), color=NAVY if c is cells[0] else None)

    add_heading(doc, 'El interruptor: encendido y apagado', 2)
    states = doc.add_table(rows=1, cols=2)
    states.alignment = WD_TABLE_ALIGNMENT.CENTER
    for c, val, tone in zip(states.rows[0].cells, ['ACTIVADO', 'DESACTIVADO'], ['EAF6EC', 'FCEBEC']):
        shade(c, tone); set_cell_text(c, val, True, GREEN if val == 'ACTIVADO' else 'B3261E', 10)
    cells = states.add_row().cells
    set_cell_text(cells[0], 'Recibe órdenes nuevas de Effi, procesa el flujo y programa las nuevas órdenes en Google Sheets a nombre de INDOOR SPORT SAS.', size=9)
    set_cell_text(cells[1], 'Se comporta como una línea apagada: no consulta Effi, no recibe webhooks, no procesa la cola y no escribe en Google Sheets.', size=9)
    add_note(doc, 'Importante.', 'Apagar Ecommerce no borra ni modifica lo que ya fue registrado; únicamente detiene la recepción y el procesamiento futuro.')

    add_heading(doc, '5. Qué debe esperar el equipo de esta línea')
    expectations = [
        'Órdenes nuevas detectadas automáticamente cuando Ecommerce está activado.',
        'Menos trabajo manual en descarga de PDF, lectura inicial y preparación de archivos.',
        'PDF por jugador y archivo de producción preparados para continuar el proceso.',
        'Programación visible en Google Sheets bajo el nombre INDOOR SPORT SAS.',
        'Alertas y estados claros cuando una orden no puede avanzar por falta de información, plantilla o archivo.',
        'Trazabilidad: cada movimiento relevante queda visible en el flujo y en el registro.',
    ]
    for e in expectations: bullet(doc, e)
    doc.add_paragraph('La línea no debe interpretarse como una promesa de que toda orden se resolverá sola. Si una referencia, talla, archivo maestro o dato de origen está incompleto, el panel mostrará un aviso para que el equipo intervenga antes de producir.')

    doc.add_page_break()
    add_heading(doc, '6. Cómo saber que está funcionando bien')
    checks = doc.add_table(rows=1, cols=3)
    checks.alignment = WD_TABLE_ALIGNMENT.CENTER
    for c, val in zip(checks.rows[0].cells, ['Señal', 'Significado', 'Acción esperada']):
        shade(c, NAVY); set_cell_text(c, val, True, 'FFFFFF', 9)
    data = [
        ('Agentes vigilando', 'ALMA, BRISA y CIRO están disponibles.', 'Operación normal.'),
        ('Orden en proceso', 'La orden avanzó a una de las tres etapas.', 'Esperar el siguiente paso o revisar el detalle.'),
        ('Con avisos / error', 'Falta una condición para continuar.', 'Revisar la orden y completar o corregir la información.'),
        ('Ecommerce desactivado', 'La línea está intencionalmente detenida.', 'No esperar nuevas órdenes ni registros hasta volver a activarlo.'),
    ]
    for idx, values in enumerate(data):
        cells = checks.add_row().cells
        for c, value in zip(cells, values):
            if idx % 2 == 0: shade(c, 'F5F8FC')
            set_cell_text(c, value, bold=(c is cells[0]), color=NAVY if c is cells[0] else None)

    add_heading(doc, '7. Mensaje clave para la operación')
    add_note(doc, 'En una frase.', 'Ecommerce convierte una orden de venta de Effi en una orden preparada y programada para producción; el equipo supervisa el resultado y atiende únicamente los casos que requieran decisión humana.', 'EAF2FA')
    doc.add_paragraph('Para que la línea entregue valor, el origen debe tener órdenes completas y el computador de agentes debe permanecer disponible. El panel concentra la visibilidad: allí se puede confirmar si la línea está encendida, si las órdenes avanzan y si existe algún aviso.')
    doc.add_paragraph('Responsable de la información: Indoor Sport SAS.', style='Normal')

    doc.save(OUTPUT)
    print(OUTPUT)

if __name__ == '__main__':
    main()
