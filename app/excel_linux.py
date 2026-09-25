from copy import copy, deepcopy
from datetime import datetime
from io import BytesIO
from pathlib import Path
import os
import re

from openpyxl import load_workbook
from openpyxl.drawing.image import Image

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = BASE_DIR / "FORMATO_EXCEL.xlsx"
FIRST_ROW = 8
DESIGN_COLUMNS = {1: "K", 2: "L", 3: "M", 4: "N"}
GENDER_COLUMNS = {"MASC": "O", "FEM": "P"}
INVALID_SHEET = re.compile(r"[\[\]:*?/\\]")
DESIGN_BOX = {1: "S3", 2: "Y3", 3: "AE3", 4: "AK3"}


def family(reference: str) -> str:
    return re.sub(r"[-_]*\d+$", "", reference) or reference


def sheet_name(value: str, used: set[str]) -> str:
    base = INVALID_SHEET.sub("-", value).strip("'")[:31] or "REF"
    candidate, number = base, 2
    while candidate.upper() in used:
        suffix = f" ({number})"
        candidate = base[: 31 - len(suffix)] + suffix
        number += 1
    used.add(candidate.upper())
    return candidate


def clone_images(source, target) -> None:
    for original in getattr(source, "_images", []):
        data = getattr(original, "_indoor_clone_bytes", None)
        if data is None:
            data = original._data()
            original._indoor_clone_bytes = data
        cloned = Image(BytesIO(data))
        cloned.width = original.width
        cloned.height = original.height
        cloned.anchor = copy(original.anchor)
        target.add_image(cloned)


def clone_conditional_formatting(source, target) -> None:
    """copy_worksheet no conserva estas reglas; se replican rango por rango."""
    for conditional_format in source.conditional_formatting:
        for rule in source.conditional_formatting[conditional_format]:
            target.conditional_formatting.add(str(conditional_format.sqref), deepcopy(rule))


def add_design_image(sheet, path: str, design: int) -> bool:
    try:
        image = Image(path)
        # El área combinada S3:W27 (y sus equivalentes D2-D4) admite una
        # imagen vertical de aproximadamente 330 x 620 px. Se ajusta usando
        # toda la caja, siempre sin deformar ni invadir la franja de notas.
        max_width, max_height = 330, 620
        scale = min(max_width / image.width, max_height / image.height)
        image.width = int(image.width * scale)
        image.height = int(image.height * scale)
        sheet.add_image(image, DESIGN_BOX[design])
        return True
    except Exception:
        return False


def crear_excel_listado(
    header, items, ruta_destino, imagenes=None, preserve_template=False, headers=None
):
    """Generador Linux. Conserva hojas, fórmulas y estilos de la plantilla."""
    imagenes = imagenes or {}
    groups = {}
    for item in items:
        groups.setdefault(item.get("sheet_group") or family(item["ref"]), []).append(item)

    workbook = load_workbook(TEMPLATE)
    base = workbook["REFERENCIA"]
    used = {name.upper() for name in workbook.sheetnames}
    inserted = []

    if preserve_template and len(groups) != 1:
        raise ValueError(
            "El modo de plantilla original admite un único listado por archivo"
        )

    for group, group_items in groups.items():
        references = list(dict.fromkeys(item["ref"] for item in group_items))
        code = group_items[0].get("display_code") or (references[0] if len(references) == 1 else group)
        group_header = (headers or {}).get(group, header)
        if preserve_template:
            # CREADOR XLSX usa la hoja original sin copiarla, renombrarla ni
            # reconstruirla. Así conserva anchos, alturas, combinaciones,
            # estilos, fórmulas, formatos condicionales y zonas en blanco.
            sheet = base
            requested_title = group_items[0].get("sheet_title")
            if requested_title:
                used.discard(sheet.title.upper())
                sheet.title = sheet_name(requested_title, used)
        else:
            sheet = workbook.copy_worksheet(base)
            clone_images(base, sheet)
            clone_conditional_formatting(base, sheet)
            sheet.title = sheet_name(group_items[0].get("sheet_title") or code, used)
        sheet["F2"] = f"{code} - {group_items[0]['descripcion_base']}".strip(" -")
        sheet["K2"] = group_header.get("cliente") or ""
        sheet["K3"] = group_header.get("proyecto") or ""
        sheet["K4"] = group_header.get("vendedor") or ""
        if group_header.get("fecha_entrega_date"):
            sheet["K5"] = group_header["fecha_entrega_date"]
            sheet["K5"].number_format = "dd-mm-yy"

        row = FIRST_ROW
        # La fila 8 define la presentación oficial de los datos. Algunas filas
        # vacías de la plantilla traen fuentes distintas; normalizamos solo
        # tipografía, alineación y formato numérico, conservando bordes,
        # rellenos y formatos condicionales originales.
        data_style = {
            column: {
                "font": copy(sheet[f"{column}{FIRST_ROW}"].font),
                "alignment": copy(sheet[f"{column}{FIRST_ROW}"].alignment),
                "number_format": sheet[f"{column}{FIRST_ROW}"].number_format,
            }
            # Solo las columnas que reciben información del listado. Los demás
            # espacios conservan exactamente el formato propio de la plantilla.
            for column in ("C", "D", "E")
        }
        for design in sorted({item["diseno"] for item in group_items}):
            for item in (candidate for candidate in group_items if candidate["diseno"] == design):
                units = list(item["tallas"])
                units += [None] * max(0, item["cantidad"] - len(units))
                for unit in units:
                    for column, style in data_style.items():
                        target = sheet[f"{column}{row}"]
                        target.font = copy(style["font"])
                        target.alignment = copy(style["alignment"])
                        target.number_format = style["number_format"]
                    if unit:
                        sheet[f"C{row}"] = unit.get("nombre") or ""
                        size = str(unit.get("talla") or "").strip().upper()
                        # Las tallas 10/12/14/16 son números reales. Guardarlas
                        # como texto produce el triángulo verde de Excel.
                        sheet[f"D{row}"] = int(size) if size.isdigit() else size
                        number = unit.get("numero")
                        number = str(number or "").strip()
                        if number.isdigit():
                            sheet[f"E{row}"] = int(number)
                            # Conserva dorsales como 00 o 01 sin convertirlos
                            # en texto ni activar advertencias de Excel.
                            sheet[f"E{row}"].number_format = "0" * len(number) if len(number) > 1 and number.startswith("0") else "0"
                        else:
                            sheet[f"E{row}"] = number
                        sheet[f"Q{row}"] = unit.get("observaciones") or ""
                    # La vista previa permite asignar D1-D4 por persona. Si
                    # la fuente no especifica diseño, conserva el diseño
                    # general del bloque para mantener compatibilidad.
                    unit_design = str((unit or {}).get("diseno") or design).strip().upper()
                    unit_design = re.sub(r"[^1-4]", "", unit_design)
                    effective_design = int(unit_design) if unit_design else design
                    if effective_design in DESIGN_COLUMNS:
                        sheet[f"{DESIGN_COLUMNS[effective_design]}{row}"] = "X"
                    else:
                        sheet[f"Q{row}"] = f"DISEÑO {effective_design}"
                    # El género del listado original tiene prioridad y puede
                    # variar por persona. Si la fuente no lo trae, se conserva
                    # el género general detectado para el diseño.
                    gender = (unit or {}).get("genero") or item.get("genero")
                    if gender in GENDER_COLUMNS:
                        sheet[f"{GENDER_COLUMNS[gender]}{row}"] = "X"
                    row += 1

        for design in DESIGN_BOX:
            candidates = list(dict.fromkeys(
                imagenes[ref][design]
                for ref in references
                if design in imagenes.get(ref, {})
            ))
            if candidates and add_design_image(sheet, candidates[0], design):
                inserted.append(candidates[0])

    if not preserve_template:
        workbook.remove(base)
    if "BASE_DATOS" in workbook.sheetnames:
        base_data = workbook["BASE_DATOS"]
        workbook._sheets.remove(base_data)
        workbook._sheets.append(base_data)
    Path(ruta_destino).parent.mkdir(parents=True, exist_ok=True)
    workbook.save(ruta_destino)
    return ruta_destino, list(dict.fromkeys(inserted))
