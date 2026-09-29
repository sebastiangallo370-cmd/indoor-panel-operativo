import base64
import csv
import io
import os
import re
import subprocess
import tempfile
import time
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime
from pathlib import Path

import requests
import pdfplumber
import xlrd
from docx import Document
from openpyxl import load_workbook
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from app.excel_linux import crear_excel_listado


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "moondream")


def _query_image(image_path: Path, prompt: str) -> str:
    image = base64.b64encode(image_path.read_bytes()).decode("ascii")
    last_error = None
    for attempt in range(3):
        try:
            response = requests.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL, "prompt": prompt, "images": [image],
                    "stream": False, "keep_alive": "2m",
                    "options": {"num_predict": 120, "temperature": 0.2},
                }, timeout=900,
            )
            response.raise_for_status()
            text = re.sub(r"\s+", " ", response.json().get("response", "").strip())[:500]
            latin = sum(character.isascii() for character in text)
            letters = sum(character.isascii() and character.isalpha() for character in text)
            if (
                not text or latin / max(len(text), 1) < 0.75 or letters < 20
                or text.lower().startswith(("ids:", "tokens:", "["))
            ):
                return ""
            return text
        except requests.RequestException as error:
            last_error = error
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"El modelo visual no pudo analizar la imagen: {last_error}")


def _description(image_path: Path, design: int) -> str:
    prompt = (
        "Describe this garment or uniform image for a production sheet. Identify the garment "
        "type, colors, visible logos or artwork positions, and construction details. Do not "
        "invent unreadable text. Answer in simple Spanish, one short paragraph, maximum 60 words. "
        f"This is design D{design}."
    )
    return _query_image(image_path, prompt) or f"Diseno D{design} generado desde la imagen adjunta"


def _sizes(value: str) -> list[dict]:
    rows = []
    for size, count in re.findall(r"([A-Z0-9.-]{1,8})\s*(?:X|:)?\s*(\d+)", value.upper()):
        for _ in range(min(int(count), 500)):
            rows.append({"talla": size, "numero": ""})
    return rows


VALID_SIZES = ("XS", "S", "M", "L", "XL", "XXL", "XXXL", "10", "12", "14", "16")


def _clean_size(value: str) -> str:
    """Normaliza la talla tal como aparece en listados reales.

    Los listados fotografiados mezclan notaciones: 2XL, 2X, XL2 o "2xl". Antes
    una sola de esas formas descartaba la fila completa, dejando fuera personas
    que si estaban en la foto. Aqui se traducen a la forma de la plantilla.
    """
    raw = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if not raw:
        return ""
    if raw in VALID_SIZES:
        return raw
    # 2XL, 3XL, 4XL -> XXL, XXXL, XXXL
    match = re.fullmatch(r"([234])X?L", raw) or re.fullmatch(r"L([234])", raw)
    if match:
        digit = int(match.group(1))
        return "XXL" if digit == 2 else "XXXL"
    # "2X", "3X" sueltas suelen ser la version corta de una talla de letra.
    match = re.fullmatch(r"([234])X", raw)
    if match:
        return "XXL" if int(match.group(1)) == 2 else "XXXL"
    if raw in {"1", "2", "3"}:
        return {"1": "S", "2": "M", "3": "L"}[raw]
    if raw in {"I", "1X"}:
        return "S"
    if raw in {"3", "LI"}:
        return "L"
    return raw if re.fullmatch(r"(?:XS|S|M|L|XL|XXL|XXXL|\d{1,2})", raw) else ""


def _clean_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^\W+|\W+$", "", str(value or ""))).strip()


def _table_rows_from_vision(image_path: Path) -> list[dict]:
    """Segunda lectura, independiente de la geometría concreta de la tabla."""
    try:
        image = base64.b64encode(image_path.read_bytes()).decode("ascii")
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": (
                    "Transcribe ALL data rows visible in this list or table. Detect the columns by their "
                    "meaning, even if their position, size or style changes. Return only one line per row "
                    "with exactly this separator format: ROW|shirt name|size|number. Use the value under "
                    "NOMBRE CAMISETA or NOMBRE DORSAL as shirt name; if absent use the person's name. "
                    "Never invent unreadable values and never include headers or explanations."
                ),
                "images": [image], "stream": False, "keep_alive": "2m",
                "options": {"num_predict": 1400, "temperature": 0},
            }, timeout=900,
        )
        response.raise_for_status()
        text = response.json().get("response", "")
    except (requests.RequestException, ValueError):
        return []
    rows = []
    valid_sizes = {"XS", "S", "M", "L", "XL", "XXL", "XXXL", "10", "12", "14", "16"}
    for line in text.splitlines():
        match = re.match(r"\s*(?:ROW\s*)?\|?\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\s*$", line, re.I)
        if not match:
            continue
        name, size, number = (part.strip(" .,-") for part in match.groups())
        size = re.sub(r"[^A-Z0-9]", "", size.upper())
        number_match = re.search(r"\d{1,3}", number)
        if not name or size not in valid_sizes or not number_match:
            continue
        rows.append({
            "nombre": name.title() if name.lower() != "sin nombre" else "sin nombre",
            "deportista": "", "talla": size, "numero": number_match.group(),
            "observaciones": "",
        })
    return rows


def _merge_table_readings(ocr_rows: list[dict], vision_rows: list[dict]) -> list[dict]:
    """Mejora valores sin permitir que el modelo agregue o elimine personas."""
    if not ocr_rows or len(ocr_rows) != len(vision_rows):
        return ocr_rows
    valid_sizes = {"XS", "S", "M", "L", "XL", "XXL", "XXXL", "10", "12", "14", "16"}
    merged = []
    for ocr, vision in zip(ocr_rows, vision_rows):
        row = dict(ocr)
        # La lectura visual suele conservar mejor las letras de nombres muy
        # pequeños; números y tallas solo reemplazan valores ausentes.
        if vision.get("nombre"):
            row["nombre"] = vision["nombre"]
        if row.get("talla") not in valid_sizes:
            row["talla"] = vision.get("talla", "")
        if not row.get("numero"):
            row["numero"] = vision.get("numero", "")
        merged.append(row)
    return merged


def _grid_cells(image_path: Path) -> list[list]:
    """Lee una tabla fotografiada como celdas usando su encabezado real.

    El lector historico exigia cinco columnas en posiciones fijas (deportista,
    camiseta, talla, numero). Los listados reales llegan con tres columnas
    (item, nombre, talla) o con otras combinaciones, y con el camino anterior
    se descartaban por completo. Aqui se devuelven las celdas tal como estan y
    las interpreta _rows_from_cells, que ya reconoce el encabezado.
    """
    with Image.open(image_path) as source:
        source = ImageOps.exif_transpose(source).convert("L")
        width, height = source.size
        if width < 40 or height < 40:
            return []
        pixels = source.load()
        horizontal = []
        for y in range(height):
            dark = sum(1 for x in range(width) if pixels[x, y] < 90)
            if dark > width * .55 and (not horizontal or y - horizontal[-1] > 2):
                horizontal.append(y)
        if not horizontal:
            return []
        if horizontal[0] > 2:
            horizontal.insert(0, 0)
        table_top = horizontal[0]
        vertical = []
        for x in range(width):
            dark = sum(1 for y in range(table_top, height) if pixels[x, y] < 90)
            if dark > max(10, (height - table_top) * .55) and (not vertical or x - vertical[-1] > 2):
                vertical.append(x)
        if vertical and vertical[0] > 2:
            vertical.insert(0, 0)
        if vertical and vertical[-1] < width - 4:
            vertical.append(width - 1)
        # Se necesita al menos un encabezado, un dato y separadores para tres columnas.
        if len(horizontal) < 3 or len(vertical) < 3:
            return []
        if horizontal[-1] < height - 4:
            horizontal.append(height - 1)

        def cell_text(left: int, top: int, right: int, bottom: int) -> str:
            if right - left < 4 or bottom - top < 7:
                return ""
            cell = source.crop((left + 1, top + 1, min(width, right + 1), bottom - 1))
            scale = 16 if cell.width < 60 else 10
            cell = ImageOps.autocontrast(cell).resize(
                (max(1, cell.width * scale), max(1, cell.height * scale)),
                Image.Resampling.LANCZOS,
            ).filter(ImageFilter.SHARPEN)
            cell = ImageOps.expand(cell, border=30, fill=255)
            handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            name = handle.name
            handle.close()
            try:
                cell.save(name)
                result = subprocess.run(
                    ["tesseract", name, "stdout", "-l", "spa+eng", "--psm", "7"],
                    capture_output=True, text=True, timeout=30, check=False,
                )
                return re.sub(r"\s+", " ", result.stdout or "").strip(" |.,-")
            except OSError:
                return ""
            finally:
                Path(name).unlink(missing_ok=True)

        cells = []
        for index in range(len(horizontal) - 1):
            top, bottom = horizontal[index], horizontal[index + 1]
            if bottom - top < 7:
                continue
            row = [cell_text(vertical[i], top, vertical[i + 1], bottom) for i in range(len(vertical) - 1)]
            if any(row):
                cells.append(row)
        return cells


def _table_rows_from_tsv(image_path: Path) -> list[dict]:
    """Lee tablas fotografiadas usando la posición real de cada columna.

    La plantilla de entrada habitual tiene: deportista, nombre de camiseta,
    talla y número. Para el Excel se usa el nombre de camiseta, que corresponde
    a la columna NOMBRE DORSAL de la plantilla.
    """
    with Image.open(image_path) as source:
        source = ImageOps.exif_transpose(source).convert("L")
        width, height = source.size

        # Si la imagen conserva la cuadrícula, cada celda se lee por separado.
        # Esto evita que Tesseract mezcle los nombres largos con talla y número.
        horizontal = []
        pixels = source.load()
        for y in range(height):
            dark = sum(1 for x in range(width) if pixels[x, y] < 90)
            if dark > width * .55 and (not horizontal or y - horizontal[-1] > 2):
                horizontal.append(y)
        # En algunos JPG el borde superior se pierde al recortar. Si la
        # primera línea detectada está más abajo, el borde de la imagen es el
        # inicio real del encabezado; sin él se omitía la primera persona.
        if horizontal and horizontal[0] > 2:
            horizontal.insert(0, 0)
        vertical = []
        table_top = horizontal[0] if horizontal else 0
        for x in range(width):
            dark = sum(1 for y in range(table_top, height) if pixels[x, y] < 90)
            if dark > max(10, (height - table_top) * .55) and (not vertical or x - vertical[-1] > 2):
                vertical.append(x)
        # Algunas capturas recortan uno de los bordes exteriores de la tabla.
        # Completarlo con el límite de la imagen conserva las cinco columnas:
        # ítem, deportista, camiseta, talla y número.
        if vertical and vertical[0] > 2:
            vertical.insert(0, 0)
        if vertical and vertical[-1] < width - 4:
            vertical.append(width - 1)
        # Se usan vertical[0]..vertical[5], por lo que hacen falta seis
        # límites reales. Con cinco, continuar con el OCR alternativo.
        if len(horizontal) >= 3 and len(vertical) >= 6:
            if horizontal[-1] < height - 4:
                horizontal.append(height - 1)

            def cell_text(left: int, top: int, right: int, bottom: int, kind="text") -> str:
                cell = source.crop((left + 1, top + 1, min(width, right + 1), bottom - 1))
                # Las capturas reenviadas por WhatsApp pueden dejar letras de
                # apenas 5-7 píxeles. Un escalado mayor, conservando grises para
                # nombres, evita deformaciones como "Cristal" -> "Cratat".
                scale = 16 if kind == "text" else 10
                cell = ImageOps.autocontrast(cell).resize(
                    (max(1, cell.width * scale), max(1, cell.height * scale)),
                    Image.Resampling.LANCZOS,
                ).filter(ImageFilter.SHARPEN)
                if kind != "text":
                    cell = cell.point(lambda value: 0 if value < 185 else 255)
                cell = ImageOps.expand(cell, border=30, fill=255)
                handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                name = handle.name
                handle.close()
                try:
                    cell.save(name)
                    command = [
                        "tesseract", name, "stdout", "-l", "eng" if kind != "text" else "spa+eng",
                        "--psm", "7",
                    ]
                    if kind == "number":
                        command += ["-c", "tessedit_char_whitelist=0123456789"]
                    elif kind == "size":
                        command += ["-c", "tessedit_char_whitelist=XSML012346"]
                    ocr = subprocess.run(
                        command,
                        capture_output=True, text=True, timeout=30, check=False,
                    )
                    return re.sub(r"\s+", " ", ocr.stdout).strip(" |.,-")
                finally:
                    Path(name).unlink(missing_ok=True)

            def row_text(top: int, bottom: int) -> str:
                """OCR de respaldo para filas muy bajas (fotos de WhatsApp)."""
                row = source.crop((0, top + 1, width, bottom - 1))
                row = ImageOps.autocontrast(row).resize((max(1, row.width * 8), max(1, row.height * 8)))
                row = row.point(lambda value: 0 if value < 185 else 255)
                row = ImageOps.expand(row, border=18, fill=255)
                handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
                name = handle.name
                handle.close()
                try:
                    row.save(name)
                    ocr = subprocess.run(
                        ["tesseract", name, "stdout", "-l", "spa+eng", "--psm", "7"],
                        capture_output=True, text=True, timeout=30, check=False,
                    )
                    return re.sub(r"\s+", " ", ocr.stdout).strip()
                finally:
                    Path(name).unlink(missing_ok=True)

            grid_rows = []
            # La primera franja contiene los encabezados; las siguientes son datos.
            for row_index in range(1, len(horizontal) - 1):
                top, bottom = horizontal[row_index], horizontal[row_index + 1]
                if bottom - top < 7:
                    continue
                deportista = cell_text(vertical[1], top, vertical[2], bottom)
                camiseta = cell_text(vertical[2], top, vertical[3], bottom)
                talla = re.sub(r"[^A-Z0-9]", "", cell_text(vertical[3], top, vertical[4], bottom, "size").upper())
                if talla == "3":
                    talla = "S"
                elif talla == "I":
                    talla = "L"
                numero = re.sub(r"\D", "", cell_text(vertical[4], top, vertical[5], bottom, "number"))
                # En tablas comprimidas el OCR por celda puede perder la talla o
                # el número. La lectura de la fila completa conserva esos datos.
                full_row = row_text(top, bottom)
                parts = [part.strip() for part in full_row.split("|") if part.strip()]
                valid_sizes = {"XS", "S", "M", "L", "XL", "XXL", "XXXL", "10", "12", "14", "16"}
                if talla not in valid_sizes:
                    for part in reversed(parts[:-1]):
                        candidate = re.sub(r"[^A-Z0-9]", "", part.upper())
                        if candidate in valid_sizes:
                            talla = candidate
                            break
                row_numbers = re.findall(r"(?<!\d)\d{1,3}(?!\d)", full_row)
                row_number = row_numbers[-1] if row_numbers else ""
                if not numero or (row_number and len(row_number) > len(numero)):
                    numero = row_number
                # Una fila con nombre sigue siendo válida aunque una celda sea
                # ilegible; no se debe eliminar silenciosamente del listado.
                if not (camiseta or deportista) or not numero:
                    continue
                nombre = camiseta or deportista
                grid_rows.append({
                    "nombre": nombre.title() if nombre.lower() != "sin nombre" else "sin nombre",
                    "deportista": deportista.title(),
                    "talla": talla,
                    "numero": numero[:3],
                    "observaciones": "",
                })
            if len(grid_rows) >= 3:
                return grid_rows
    result = subprocess.run(
        ["tesseract", str(image_path), "stdout", "-l", "spa+eng", "--psm", "6", "tsv"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    if not result.stdout.strip():
        return []
    grouped = {}
    for item in csv.DictReader(io.StringIO(result.stdout), delimiter="\t"):
        text = (item.get("text") or "").strip(" |")
        if not text:
            continue
        try:
            x = int(item["left"])
            w = int(item["width"])
            key = (item["block_num"], item["par_num"], item["line_num"])
        except (KeyError, TypeError, ValueError):
            continue
        grouped.setdefault(key, []).append((x + w / 2, text))

    rows = []
    valid_sizes = {"XS", "S", "M", "L", "XL", "XXL", "XXXL", "10", "12", "14", "16"}
    for tokens in grouped.values():
        columns = {"deportista": [], "camiseta": [], "talla": [], "numero": []}
        for center, text in sorted(tokens):
            ratio = center / max(width, 1)
            if ratio < .085:
                continue
            if ratio < .45:
                columns["deportista"].append(text)
            elif ratio < .70:
                columns["camiseta"].append(text)
            elif ratio < .83:
                columns["talla"].append(text)
            else:
                columns["numero"].append(text)
        talla = re.sub(r"[^A-Z0-9]", "", "".join(columns["talla"]).upper())
        numero_text = " ".join(columns["numero"])
        number_match = re.search(r"\d{1,3}", numero_text)
        if talla not in valid_sizes or not number_match:
            continue
        camiseta = re.sub(r"\s+", " ", " ".join(columns["camiseta"])).strip(" .,-")
        deportista = re.sub(r"\s+", " ", " ".join(columns["deportista"])).strip(" .,-")
        nombre = camiseta or deportista
        if not nombre:
            continue
        rows.append({
            "nombre": nombre.title() if nombre.lower() != "sin nombre" else "sin nombre",
            "deportista": deportista.title(),
            "talla": talla,
            "numero": number_match.group(),
            "observaciones": "",
        })
    return rows


def _mockup_metadata(image_path: Path) -> dict:
    result = subprocess.run(
        ["tesseract", str(image_path), "stdout", "-l", "spa+eng", "--psm", "3"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    text = re.sub(r"[ \t]+", " ", result.stdout or "")
    compact = re.sub(r"\s+", " ", text).strip()
    client = ""
    match = re.search(r"C(?:LIENTE|UENTE)\s+(.+?)(?=\s+(?:C[OÓ]D|CODIGO|DISE[NÑ]O|\*)\b|$)", compact, re.I)
    if match:
        client = match.group(1).strip(" :-")
    code = ""
    heading_text = ""
    temporary = None
    heading_temporary = None
    try:
        with Image.open(image_path) as source:
            source = ImageOps.exif_transpose(source).convert("L")
            w, h = source.size
            heading = source.crop((0, 0, w, int(h * .16)))
            heading = ImageOps.autocontrast(heading).resize((max(1, heading.width * 6), max(1, heading.height * 6)))
            heading_handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            heading_temporary = heading_handle.name
            heading_handle.close()
            heading.save(heading_temporary)
            code_area = source.crop((int(w * .34), int(h * .09), int(w * .75), int(h * .135)))
            code_area = ImageOps.autocontrast(code_area).resize((max(1, code_area.width * 8), max(1, code_area.height * 8)))
            code_area = code_area.point(lambda value: 0 if value < 235 else 255)
            handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            temporary = handle.name
            handle.close()
            code_area.save(temporary)
        code_result = subprocess.run(
            ["tesseract", temporary, "stdout", "-l", "spa+eng", "--psm", "11"],
            capture_output=True, text=True, timeout=60, check=False,
        )
        compact += " " + re.sub(r"\s+", " ", code_result.stdout or "")
        heading_result = subprocess.run(
            ["tesseract", heading_temporary, "stdout", "-l", "spa+eng", "--psm", "3"],
            capture_output=True, text=True, timeout=60, check=False,
        )
        heading_text = re.sub(r"\s+", " ", heading_result.stdout or "")
        compact += " " + heading_text
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)
        if heading_temporary:
            Path(heading_temporary).unlink(missing_ok=True)
    match = re.search(r"C[OÓ]D(?:IGO)?\s*[:.-]?\s*([A-Z0-9-]{2,30})", compact, re.I)
    if match:
        code = match.group(1).upper()
    gender = "FEM" if re.search(r"\bfemenin[ao]\b", compact, re.I) else ""
    if not gender:
        words = re.findall(r"[A-Za-z]{5,12}", unicodedata.normalize("NFKD", heading_text).encode("ascii", "ignore").decode())
        if any(SequenceMatcher(None, word.lower(), "femenino").ratio() >= .55 for word in words):
            gender = "FEM"
        elif any(SequenceMatcher(None, word.lower(), "masculino").ratio() >= .65 for word in words):
            gender = "MASC"
    return {"CLIENTE": client, "REFERENCIA": code, "GENERO": gender, "OCR": compact}


def _gender_from_image(image_path: Path) -> str:
    try:
        image = base64.b64encode(image_path.read_bytes()).decode("ascii")
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": OLLAMA_MODEL,
                "prompt": (
                    "Read the small heading at the TOP LEFT next to 'DISENO 1'. Do not infer gender "
                    "from the clothes. If that heading says femenino/femenina/women answer FEM. "
                    "If it explicitly says masculino/men answer MASC. Answer only FEM or MASC."
                ),
                "images": [image], "stream": False, "keep_alive": "2m",
                "options": {"num_predict": 8, "temperature": 0},
            }, timeout=300,
        )
        response.raise_for_status()
        answer = response.json().get("response", "").upper()
        if "FEM" in answer or "WOM" in answer:
            return "FEM"
        if "MASC" in answer or "MEN" in answer or "MALE" in answer:
            return "MASC"
    except requests.RequestException:
        pass
    return ""


def _normalized_gender(value: str, description: str = "") -> str:
    combined = f"{value or ''} {description or ''}"
    if re.search(r"\b(FEM|mujer|dama|femenin[ao])\b", combined, re.I):
        return "FEM"
    if re.search(r"\b(MASC|hombre|varon|varón|masculin[ao])\b", combined, re.I):
        return "MASC"
    return ""


def _ocr_text(image_path: Path) -> str:
    """OCR local: no usa APIs pagas y funciona dentro del VPS."""
    temporary = None
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source).convert("L")
            image = ImageOps.autocontrast(image)
            image = image.resize((image.width * 2, image.height * 2))
            image = ImageEnhance.Contrast(image).enhance(1.5)
            image = image.filter(ImageFilter.SHARPEN)
            handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            temporary = handle.name
            handle.close()
            image.save(temporary)
        results = []
        for source in (str(image_path), temporary):
            for psm in (6, 11):
                result = subprocess.run(
                    ["tesseract", source, "stdout", "-l", "spa+eng", "--psm", str(psm)],
                    capture_output=True, text=True, timeout=120, check=False,
                )
                if result.stdout.strip():
                    results.append(result.stdout.strip())

        # Las fotos de tablas tomadas a una pantalla se leen mejor fila por fila.
        with Image.open(image_path) as source:
            source = ImageOps.exif_transpose(source)
            left, right = int(source.width * .128), int(source.width * .922)
            start = int(source.height * .206)
            step = max(24, int(source.height * .025))
            height = max(30, int(source.height * .025))
            lines = []
            for index in range(20):
                top = start + index * step
                if top + height > source.height * .72:
                    break
                line = source.crop((left, top, right, top + height)).convert("L")
                small = line.resize((max(1, line.width // 2), max(1, line.height // 2)))
                line = ImageOps.autocontrast(small).resize((small.width * 4, small.height * 4))
                line_file = f"{temporary}-{index}.png"
                line.save(line_file)
                try:
                    result = subprocess.run(
                        ["tesseract", line_file, "stdout", "-l", "spa+eng", "--psm", "7"],
                        capture_output=True, text=True, timeout=30, check=False,
                    )
                    if "talla" in result.stdout.lower():
                        lines.append(result.stdout.strip())
                finally:
                    Path(line_file).unlink(missing_ok=True)
            if lines:
                results.append("\n".join(lines))
        return "\n".join(results)
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)


def _table_rows_from_text(text: str) -> list[dict]:
    """Interpreta OCR plano como tabla cuando las celdas vienen separadas.

    Cuando la imagen no conserva una cuadrícula visible, Tesseract devuelve las
    columnas separadas por espacios amplios o barras. Antes esa forma se perdia
    porque _person_rows exigia la palabra "talla" en cada linea.
    """
    raw_lines = [line.rstrip() for line in text.splitlines() if line.strip()]

    def flat(value: str) -> str:
        return re.sub(r"[ \t]+", " ", value).strip(" |")

    lines = [flat(line) for line in raw_lines]
    header_index = None
    for index, line in enumerate(lines[:15]):
        if re.search(r"\btalla\b", line, re.I) and re.search(r"\b(nombre|numero|n[uú]mero|dorsal)\b", line, re.I):
            header_index = index
            break
    if header_index is None:
        return []
    header = re.split(r"\s{2,}|\t|\|", raw_lines[header_index])
    columns = {}
    for field, names in {
        "nombre": ("nombre", "deportista", "jugador", "dorsal"),
        "talla": ("talla", "size"),
        "numero": ("numero", "número", "number"),
    }.items():
        for position, value in enumerate(header):
            plain = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower())
            if plain and any(re.sub(r"[^a-z0-9]", "", n) in plain for n in names):
                columns[field] = position
                break
    if "talla" not in columns or "nombre" not in columns:
        return []
    rows = []
    for original in raw_lines[header_index + 1:]:
        cells = re.split(r"\s{2,}|\t|\|", original)
        if len(cells) <= max(columns.values()):
            continue
        name = _clean_name(cells[columns["nombre"]])
        size = _clean_size(cells[columns["talla"]])
        if not name or not size:
            continue
        number = _clean_name(cells[columns["numero"]]) if "numero" in columns and columns["numero"] < len(cells) else ""
        rows.append({"nombre": name, "talla": size, "numero": number, "genero": "", "observaciones": ""})
    return rows


def _person_rows(text: str) -> list[dict]:
    rows = []

    def normalized(value: str) -> str:
        value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
        return re.sub(r"[^a-z]", "", value.lower())

    for original in text.splitlines():
        line = re.sub(r"\s+", " ", original).strip(" |,;.-")
        if not re.search(r"\btalla\b", line, re.I):
            continue
        match = re.search(r"^(?:(?P<nombre>.*?)\s*:\s*)?talla\s*(?P<resto>.*)$", line, re.I)
        if not match:
            continue
        nombre = (match.group("nombre") or "").strip(" :.-")
        nombre = re.sub(r"^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$", "", nombre).strip()
        resto = match.group("resto").strip()
        size_match = re.search(r"^(14|16|12|10|XS|XXL|XL|S|M|L)", resto, re.I)
        if not size_match:
            continue
        talla = size_match.group(1).upper()
        after = resto[size_match.end():]
        marked = re.search(r"(?P<mark>[#\$%])\s*[4t]?\s*(?P<number>\d{1,3})", after, re.I)
        numbers = re.findall(r"\d{1,3}", after)
        numero = marked.group("number") if marked else (numbers[-1] if numbers else "")
        if marked and marked.group("mark") == "$" and numero.startswith("4") and len(numero) > 1:
            numero = numero[1:]
        if len(numero) == 3 and numero.startswith("4"):
            numero = numero[1:]
        observacion = "Portero" if "portero" in line.lower() else ""
        if "portero" in line.lower() and "portero" not in observacion.lower():
            observacion = "Portero"
        row = {
            "nombre": nombre.title() if nombre else "",
            "talla": talla,
            "numero": numero,
            "observaciones": observacion.capitalize() if observacion else "",
        }
        if not row["nombre"]:
            rows.append(row)
            continue
        current_name = normalized(row["nombre"])
        duplicate = None
        for item in rows:
            saved_name = normalized(item["nombre"])
            if saved_name and SequenceMatcher(None, current_name, saved_name).ratio() >= .72:
                duplicate = item
                break
        if duplicate:
            if len(current_name) > len(normalized(duplicate["nombre"])):
                duplicate["nombre"] = row["nombre"]
            if row["numero"] and (not duplicate["numero"] or len(row["numero"]) <= 2):
                duplicate["numero"] = row["numero"]
            if row["observaciones"]:
                duplicate["observaciones"] = row["observaciones"]
        else:
            rows.append(row)
    return rows


def _data_from_image(image_path: Path) -> dict:
    prompt = (
        "Read this order/list image carefully. Return only these fields on separate lines using "
        "this exact format: CLIENTE=, PROYECTO=, REFERENCIA=, CANTIDAD=, GENERO=, TALLAS=, "
        "DESCRIPCION=. Use visible information only. For TALLAS use examples like S X 5, M X 10."
    )
    # Primero se respeta el encabezado real de la tabla fotografiada: sirve para
    # cualquier combinacion de columnas, no solo las cinco de la plantilla vieja.
    parsed_rows = _rows_from_cells(_grid_cells(image_path))
    if parsed_rows:
        parsed_rows = _merge_table_readings(parsed_rows, _table_rows_from_vision(image_path))
    if not parsed_rows:
        parsed_rows = _table_rows_from_tsv(image_path)
        if parsed_rows:
            parsed_rows = _merge_table_readings(parsed_rows, _table_rows_from_vision(image_path))
    ocr = "" if parsed_rows else _ocr_text(image_path)
    if not parsed_rows:
        parsed_rows = _table_rows_from_text(ocr) or _person_rows(ocr)
    if parsed_rows:
        raw = ""
    else:
        try:
            raw = _query_image(image_path, prompt)
        except RuntimeError:
            raw = ""
    data = {}
    for key in ("CLIENTE", "PROYECTO", "REFERENCIA", "CANTIDAD", "GENERO", "TALLAS", "DESCRIPCION"):
        match = re.search(rf"(?:^|\s){key}\s*=\s*(.*?)(?=\s(?:CLIENTE|PROYECTO|REFERENCIA|CANTIDAD|GENERO|TALLAS|DESCRIPCION)\s*=|$)", raw, re.I)
        data[key] = match.group(1).strip(" ,;.-") if match else ""
    data["OCR"] = ocr
    data["FILAS"] = parsed_rows
    return data


def _rows_from_cells(rows: list[list]) -> list[dict]:
    """Convierte una tabla de Excel/Word/PDF/CSV al formato de la plantilla."""
    clean = [[re.sub(r"\s+", " ", str(value or "")).strip() for value in row] for row in rows]
    header_index, columns = None, {}
    aliases = {
        "nombre": ("nombre camiseta", "nombre dorsal", "deportista", "nombre", "jugador"),
        "talla": ("talla", "size"),
        # "Dorsal" por sí solo no identifica esta columna: en las plantillas
        # de Indoor aparece dentro de "NOMBRE DORSAL" y provocaba que se
        # leyera esa columna vacía en lugar de NÚMERO.
        "numero": ("numero", "número", "number", "numero dorsal", "número dorsal"),
        "observaciones": ("observaciones", "observacion", "notas", "nota"),
    }

    def canonical(value: str) -> str:
        value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]", "", value)

    def matches_header(value: str, names: tuple[str, ...]) -> bool:
        current = canonical(value)
        if not current:
            return False
        for name in names:
            expected = canonical(name)
            if expected in current or current in expected:
                return True
            # Excel antiguos o exportaciones dañadas pueden convertir Ú/Ñ en
            # el carácter de reemplazo: NÚMERO -> N�MERO. La comparación
            # aproximada recupera el encabezado sin depender de la codificación.
            if SequenceMatcher(None, current, expected).ratio() >= .78:
                return True
        return False

    for index, row in enumerate(clean[:30]):
        found = {}
        for field, names in aliases.items():
            for position, value in enumerate(row):
                if matches_header(value, names):
                    found[field] = position
                    break
        if "talla" in found and ("nombre" in found or "numero" in found):
            header_index, columns = index, found
            break
    if header_index is None:
        return []
    # Género suele estar en un segundo nivel de encabezados (MASCULINO /
    # NIÑO y FEMENINO). Se detecta aparte para conservarlo fila por fila.
    for header_row in clean[header_index:min(len(clean), header_index + 3)]:
        for position, value in enumerate(header_row):
            label = canonical(value)
            if "masculino" in label or label in {"masc", "hombre", "nino"}:
                columns.setdefault("masc", position)
            if "femenino" in label or label in {"fem", "mujer", "nina"}:
                columns.setdefault("fem", position)
    result = []
    for row in clean[header_index + 1:]:
        def value(field):
            position = columns.get(field)
            return row[position] if position is not None and position < len(row) else ""
        name, size, number = _clean_name(value("nombre")), _clean_size(value("talla")), _clean_name(value("numero"))
        if not any((name, size, number)):
            continue
        if not size:
            continue
        masc_value = value("masc").strip().upper()
        fem_value = value("fem").strip().upper()
        gender = "MASC" if masc_value in {"X", "1", "SI", "SÍ"} else ("FEM" if fem_value in {"X", "1", "SI", "SÍ"} else "")
        result.append({
            "nombre": name, "talla": size, "numero": number,
            "genero": gender, "observaciones": value("observaciones"),
        })
    return result


def _data_from_document(path: Path) -> dict:
    suffix = path.suffix.lower()
    text, tables, structured = "", [], {}
    if suffix in {".xlsx", ".xlsm"}:
        workbook = load_workbook(path, read_only=True, data_only=True)
        try:
            for sheet in workbook.worksheets:
                rows = [list(row) for row in sheet.iter_rows(values_only=True)]
                tables.append(rows)
                text += "\n" + "\n".join(" | ".join(str(value or "") for value in row) for row in rows)
                for row in rows[:20]:
                    for position, raw_label in enumerate(row):
                        label = unicodedata.normalize("NFKD", str(raw_label or "")).encode("ascii", "ignore").decode().lower()
                        label = re.sub(r"[^a-z]", "", label)
                        field = ""
                        if "nombredelcliente" in label or label == "cliente":
                            field = "CLIENTE"
                        elif "nombredelproyecto" in label or label == "proyecto":
                            field = "PROYECTO"
                        elif label == "comercial" or "vendedor" in label:
                            field = "VENDEDOR"
                        if field:
                            value = next((str(cell).strip() for cell in row[position + 1:] if cell not in (None, "")), "")
                            if value:
                                structured.setdefault(field, value)
        finally:
            workbook.close()
    elif suffix == ".xls":
        workbook = xlrd.open_workbook(path)
        for sheet in workbook.sheets():
            rows = [sheet.row_values(index) for index in range(sheet.nrows)]
            tables.append(rows)
            text += "\n" + "\n".join(" | ".join(str(value or "") for value in row) for row in rows)
    elif suffix == ".csv":
        content = path.read_text(encoding="utf-8-sig", errors="replace")
        dialect = csv.Sniffer().sniff(content[:4096], delimiters=",;\t|")
        rows = list(csv.reader(io.StringIO(content), dialect))
        tables.append(rows)
        text = content
    elif suffix == ".pdf":
        with pdfplumber.open(path) as document:
            for page in document.pages:
                text += "\n" + (page.extract_text() or "")
                tables.extend(page.extract_tables() or [])
    elif suffix == ".docx":
        document = Document(path)
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        for table in document.tables:
            rows = [[cell.text for cell in row.cells] for row in table.rows]
            tables.append(rows)
            text += "\n" + "\n".join(" | ".join(row) for row in rows)
    elif suffix == ".doc":
        result = subprocess.run(["antiword", str(path)], capture_output=True, text=True, timeout=120, check=False)
        text = result.stdout
    elif suffix in {".txt", ".tsv"}:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        delimiter = "\t" if suffix == ".tsv" else None
        if delimiter:
            tables.append(list(csv.reader(io.StringIO(text), delimiter=delimiter)))
    # No basta con la primera hoja que produzca alguna fila: un Excel con
    # portada/datos del cliente en la primera pestaña puede disparar una
    # coincidencia falsa de encabezado y dejar sin leer la pestaña real con
    # el listado completo. Se usa la que aporta más filas.
    rows = []
    for table in tables:
        candidate = _rows_from_cells(table)
        if len(candidate) > len(rows):
            rows = candidate
    if not rows:
        rows = _person_rows(text)
    data = {key: "" for key in ("CLIENTE", "PROYECTO", "REFERENCIA", "CANTIDAD", "GENERO", "TALLAS", "DESCRIPCION")}
    data["CLIENTE"] = structured.get("CLIENTE", "")
    data["PROYECTO"] = structured.get("PROYECTO", "")
    labels = {
        "CLIENTE": r"(?:cliente|nombre del cliente)", "PROYECTO": r"(?:proyecto|nombre del proyecto)",
        "REFERENCIA": r"(?:referencia|ref\.?|codigo|código)", "CANTIDAD": r"cantidad",
        "GENERO": r"(?:genero|género)", "DESCRIPCION": r"(?:descripcion|descripción)",
    }
    for key, label in labels.items():
        match = re.search(rf"{label}\s*[:=\-]\s*([^\n|]{{1,120}})", text, re.I)
        if match and not data[key]:
            data[key] = match.group(1).strip(" ,;.-")
    data["OCR"], data["FILAS"] = text, rows
    if not data["CANTIDAD"] and rows:
        data["CANTIDAD"] = str(len(rows))
    return data


def _data_from_source(path: Path) -> dict:
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}:
        return _data_from_image(path)
    return _data_from_document(path)


def normalize_output_name(value: str) -> str:
    name = re.sub(r"\.xlsx$", "", (value or "").strip(), flags=re.I)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", name).strip(" .")
    if not name:
        raise ValueError("Escribe el nombre que tendrá el archivo Excel")
    return name[:120]


def create_from_images(
    data_image: Path, images: list[tuple[int, Path]], output_dir: Path, output_name: str,
    sheet_name: str = "", progress_callback=None,
) -> Path:
    if not data_image:
        raise ValueError("Debes subir la foto con los datos del listado")
    if len(images) > 4:
        raise ValueError("La plantilla admite hasta cuatro disenos por listado")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if progress_callback:
        progress_callback(20, "Leyendo el archivo con los datos")
    extracted = _data_from_source(data_image)
    if progress_callback:
        progress_callback(52, "Datos identificados. Analizando el mockup principal")
    metadata = _mockup_metadata(images[0][1]) if images and images[0][1] else {}
    reference_value = extracted.get("REFERENCIA") or metadata.get("REFERENCIA") or ""
    referencia = re.sub(r"[^A-Za-z0-9_-]+", "-", reference_value).strip("-") or f"IMG-{stamp}"
    header = {
        "cliente": extracted.get("CLIENTE") or metadata.get("CLIENTE") or "POR DEFINIR",
        "proyecto": extracted.get("PROYECTO") or "CREADO DESDE IMAGENES",
        "vendedor": "",
    }
    size_rows = extracted.get("FILAS") or _sizes(extracted.get("TALLAS", ""))
    quantity_match = re.search(r"\d+", extracted.get("CANTIDAD", ""))
    quantity = int(quantity_match.group()) if quantity_match else max(len(size_rows), 1)
    image_map = {referencia: {}}
    first_image = images[0] if images else (1, None)
    if extracted.get("DESCRIPCION"):
        description = extracted["DESCRIPCION"]
    elif metadata:
        description = f"Diseno D{first_image[0]} creado desde imagen"
        if metadata.get("REFERENCIA"):
            description += f" - {metadata['REFERENCIA']}"
    elif first_image[1]:
        description = _description(first_image[1], first_image[0])
    else:
        description = "Listado creado desde la foto de datos"
    extracted_gender = (extracted.get("GENERO") or metadata.get("GENERO") or "").upper()
    if not extracted_gender and first_image[1]:
        if progress_callback:
            progress_callback(68, "Confirmando diseño y género del uniforme")
        extracted_gender = _gender_from_image(first_image[1])
    genero = _normalized_gender(extracted_gender, description)
    # Los datos se escriben una sola vez. Los demás archivos son mockups que
    # se insertan en sus espacios D1-D4, no copias adicionales del listado.
    items = [{
        "ref": referencia,
        "sheet_title": sheet_name.strip(),
        "descripcion_base": description,
        "diseno": 1,
        "genero": genero,
        "cantidad": max(quantity, len(size_rows), 1),
        "tallas": list(size_rows),
    }]
    for design, image_path in images:
        if image_path:
            image_map[referencia][design] = str(image_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = normalize_output_name(output_name)
    destination = output_dir / f"{safe_name}.xlsx"
    suffix = 2
    while destination.exists():
        destination = output_dir / f"{safe_name} ({suffix}).xlsx"
        suffix += 1
    if progress_callback:
        progress_callback(86, "Construyendo la plantilla Excel")
    crear_excel_listado(
        header, items, str(destination), image_map, preserve_template=True
    )
    if progress_callback:
        progress_callback(96, "Excel terminado. Preparando la descarga")
    return destination


def create_from_sheet_bundle(
    sheets: list[dict], output_dir: Path, output_name: str, progress_callback=None
) -> Path:
    """Crea un solo libro con una copia intacta de la plantilla por pestaña."""
    if not sheets:
        raise ValueError("Debes agregar al menos una pestaña de Excel")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    headers, items, image_map = {}, [], {}
    for index, spec in enumerate(sheets, start=1):
        if progress_callback:
            progress_callback(12 + int((index - 1) * 66 / len(sheets)), f"Leyendo pestaña {index} de {len(sheets)}")
        data_image = Path(spec["data_image"])
        images = list(spec.get("images") or [])
        extracted = spec.get("extracted_override") or _data_from_source(data_image)
        metadata = _mockup_metadata(images[0][1]) if images and images[0][1] else {}
        actual_ref = re.sub(
            r"[^A-Za-z0-9_-]+", "-",
            extracted.get("REFERENCIA") or metadata.get("REFERENCIA") or "",
        ).strip("-") or f"IMG-{stamp}-{index}"
        group = f"sheet-{index}"
        image_key = f"{group}-{actual_ref}"
        header = {
            "cliente": extracted.get("CLIENTE") or metadata.get("CLIENTE") or "POR DEFINIR",
            "proyecto": extracted.get("PROYECTO") or "CREADO DESDE IMAGENES",
            "vendedor": "",
        }
        rows = extracted.get("FILAS") or _sizes(extracted.get("TALLAS", ""))
        quantity_match = re.search(r"\d+", extracted.get("CANTIDAD", ""))
        quantity = int(quantity_match.group()) if quantity_match else max(len(rows), 1)
        first_image = images[0] if images else (1, None)
        description = extracted.get("DESCRIPCION") or f"Diseno D{first_image[0]} creado desde imagen"
        if metadata.get("REFERENCIA"):
            description += f" - {metadata['REFERENCIA']}"
        gender_value = (extracted.get("GENERO") or metadata.get("GENERO") or "").upper()
        if not gender_value and first_image[1]:
            gender_value = _gender_from_image(first_image[1])
        gender = _normalized_gender(gender_value, description)
        headers[group] = header
        items.append({
            "ref": image_key,
            "display_code": actual_ref,
            "sheet_group": group,
            "sheet_title": spec.get("sheet_name") or actual_ref,
            "descripcion_base": description,
            "diseno": 1,
            "genero": gender,
            "cantidad": max(quantity, len(rows), 1),
            "tallas": list(rows),
        })
        image_map[image_key] = {
            design: str(path) for design, path in images if path
        }
        if progress_callback:
            progress_callback(12 + int(index * 66 / len(sheets)), f"Pestaña {index} de {len(sheets)} analizada")
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = normalize_output_name(output_name)
    destination = output_dir / f"{safe_name}.xlsx"
    suffix = 2
    while destination.exists():
        destination = output_dir / f"{safe_name} ({suffix}).xlsx"
        suffix += 1
    if progress_callback:
        progress_callback(88, f"Construyendo el Excel con {len(sheets)} pestaña(s)")
    crear_excel_listado(
        {}, items, str(destination), image_map,
        preserve_template=False, headers=headers,
    )
    if progress_callback:
        progress_callback(96, "Excel terminado. Preparando la descarga")
    return destination
