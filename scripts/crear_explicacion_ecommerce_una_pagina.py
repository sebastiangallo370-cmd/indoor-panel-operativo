from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = Path(__file__).resolve().parents[1] / 'output' / 'Explicacion_Ecommerce_Indoor_Sport.docx'
NAVY, PALE, BORDER = '17365D', 'F2F6FA', 'D9D9D9'

def shade(cell, color):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), color); tcpr.append(shd)

def borders(table):
    tblpr = table._tbl.tblPr
    border = OxmlElement('w:tblBorders')
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        tag = OxmlElement(f'w:{side}')
        tag.set(qn('w:val'), 'single'); tag.set(qn('w:sz'), '4'); tag.set(qn('w:color'), BORDER)
        border.append(tag)
    tblpr.append(border)

def text(cell, value, bold=False, color=None, size=9.2):
    cell.text = ''
    p = cell.paragraphs[0]; p.paragraph_format.space_after = Pt(0); p.paragraph_format.line_spacing = 1.05
    r = p.add_run(value); r.bold = bold; r.font.size = Pt(size)
    if color: r.font.color.rgb = RGBColor.from_string(color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def heading(doc, value):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(7); p.paragraph_format.space_after = Pt(3)
    r = p.add_run(value); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = RGBColor(0,0,0)

def main():
    doc = Document()
    s = doc.sections[0]
    s.top_margin = Inches(.56); s.bottom_margin = Inches(.55); s.left_margin = Inches(.68); s.right_margin = Inches(.68)
    style = doc.styles['Normal']; style.font.name='Aptos'; style._element.rPr.rFonts.set(qn('w:eastAsia'),'Aptos'); style.font.size=Pt(10.2); style.paragraph_format.space_after=Pt(4)
    header = s.header.paragraphs[0]; header.text='INDOOR SPORT SAS'; header.runs[0].font.size=Pt(8); header.runs[0].font.color.rgb=RGBColor(89,89,89)
    footer = s.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER; footer.text='Ecommerce  |  Explicación operativa'; footer.runs[0].font.size=Pt(8); footer.runs[0].font.color.rgb=RGBColor(89,89,89)

    title = doc.add_paragraph(style='Title'); title.alignment=WD_ALIGN_PARAGRAPH.CENTER; title.paragraph_format.space_after=Pt(2)
    run=title.add_run('Ecommerce de Indoor Sport'); run.font.name='Aptos Display'; run.font.size=Pt(21); run.bold=True; run.font.color.rgb=RGBColor(0,0,0)
    sub=doc.add_paragraph(); sub.alignment=WD_ALIGN_PARAGRAPH.CENTER; sub.paragraph_format.space_after=Pt(9)
    r=sub.add_run('Cómo funciona la línea automática de órdenes de venta'); r.font.size=Pt(11); r.font.color.rgb=RGBColor(0,0,0)

    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(5)
    p.add_run('Ecommerce recibe las órdenes de venta de Effi y las prepara para producción. ').bold=True
    p.add_run('Cuando está activado, descarga la orden, organiza las tallas, genera los archivos necesarios y programa la información en Google Sheets a nombre de INDOOR SPORT SAS. El equipo solo debe supervisar el avance y atender los avisos que requieran decisión humana.')

    heading(doc, 'Cómo avanza una orden')
    t=doc.add_table(rows=1, cols=5); t.alignment=WD_TABLE_ALIGNMENT.CENTER; borders(t)
    values=[('1  EFFI','Se crea la orden.'),('2  ALMA','Descarga el PDF.'),('3  BRISA','Prepara las tallas.'),('4  CIRO','Genera archivos por jugador.'),('5  SHEETS','Programa producción.')]
    for cell,(name,desc) in zip(t.rows[0].cells,values):
        shade(cell, PALE); cell.text=''; p=cell.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(1)
        r=p.add_run(name); r.bold=True; r.font.size=Pt(8.5); r.font.color.rgb=RGBColor.from_string(NAVY)
        p=cell.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(2); r=p.add_run(desc); r.font.size=Pt(7.7)

    heading(doc, 'Ventanas del producto')
    t=doc.add_table(rows=1, cols=2); t.alignment=WD_TABLE_ALIGNMENT.CENTER; borders(t)
    for c,v in zip(t.rows[0].cells,('Ventana','Qué muestra')): shade(c,NAVY); text(c,v,True,'FFFFFF',9)
    rows=[('Estado de Ecommerce','Interruptor general de la línea.'),('Flujo','Estado de ALMA, BRISA y CIRO, actividad y avisos.'),('Órdenes','Órdenes recibidas, su avance y los casos por revisar.'),('Agentes','Conexión de los agentes en el computador operativo.'),('Registro','Historial de lo que ocurrió con la línea.')]
    for i,(a,b) in enumerate(rows):
        cells=t.add_row().cells
        if i%2==0: [shade(c,PALE) for c in cells]
        text(cells[0],a,True,NAVY); text(cells[1],b)

    heading(doc, 'Qué significa el interruptor')
    t=doc.add_table(rows=1, cols=2); t.alignment=WD_TABLE_ALIGNMENT.CENTER; borders(t)
    for c,v in zip(t.rows[0].cells,('ACTIVADO','DESACTIVADO')): shade(c,NAVY); text(c,v,True,'FFFFFF',9)
    cells=t.add_row().cells
    text(cells[0],'Recibe órdenes nuevas, procesa el flujo y registra en Google Sheets.',size=9)
    text(cells[1],'Es como una línea apagada: no consulta Effi, no recibe ni procesa información y no escribe en Google Sheets.',size=9)

    heading(doc, 'Qué debe esperar el equipo')
    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(2)
    p.add_run('Resultado esperado: ').bold=True
    p.add_run('menos trabajo manual, órdenes con soportes listos para continuar y trazabilidad visible en el panel. Si faltan datos, una referencia, una plantilla o un archivo, la orden mostrará un aviso para que el equipo la revise antes de producir.')
    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(0)
    p.add_run('En resumen: ').bold=True
    p.add_run('Ecommerce transforma una orden de Effi en una orden preparada y programada para producción, mientras el equipo conserva el control de las excepciones.')
    OUT.parent.mkdir(exist_ok=True)
    doc.save(OUT)
    print(OUT)

if __name__=='__main__': main()
