import re
import pdfplumber

def parse_effi_pdf(file_path_or_stream):
    """
    Extrae los datos de una cotización en PDF de Effi.
    Retorna un diccionario con los campos estructurados.
    """
    doc_data = {
        "numero": None, "fechaCreacion": None, "fechaEntrega": None,
        "cliente": None, "ccNit": None, "telefono": None, "correo": None,
        "ciudad": None, "vendedor": None, "elaboradoPor": None, "club": "",
        "formaPago": None, "plazoDias": 0, "total": 0, "iva": 0,
        "unidades": 0, "items": [], "estado": "pedido", "revisar": False, "notas": ""
    }
    
    texto_completo = ""
    with pdfplumber.open(file_path_or_stream) as pdf:
        for page in pdf.pages:
            texto_completo += page.extract_text() + "\n"

    # Buscar si está anulada
    if "TRANSACCIÓN ANULADA" in texto_completo.upper() or "TRANSACCION ANULADA" in texto_completo.upper():
        doc_data["estado"] = "anulada"

    # Expresiones regulares
    m_num = re.search(r"COTIZACI[OÓ]N\s*No\.?\s*(\d+)", texto_completo, re.IGNORECASE)
    if m_num: doc_data["numero"] = m_num.group(1)

    m_creacion = re.search(r"Creaci[oó]n:\s*([\d-]+)", texto_completo, re.IGNORECASE)
    if m_creacion: doc_data["fechaCreacion"] = m_creacion.group(1)

    m_entrega = re.search(r"Entrega:\s*([\d-]+)", texto_completo, re.IGNORECASE)
    if m_entrega: doc_data["fechaEntrega"] = m_entrega.group(1)

    m_cliente = re.search(r"Cliente:\s*(.*?)\s+NIT:\s*([\d-]+)", texto_completo, re.IGNORECASE)
    if m_cliente:
        doc_data["cliente"] = m_cliente.group(1).strip()
        doc_data["ccNit"] = m_cliente.group(2).strip()
    
    m_tel_email = re.search(r"Tel[eé]fono:\s*([\d\s]+)\s+Email:\s*(\S+)", texto_completo, re.IGNORECASE)
    if m_tel_email:
        doc_data["telefono"] = m_tel_email.group(1).strip()
        doc_data["correo"] = m_tel_email.group(2).strip()
    
    m_dir = re.search(r"Direcci[oó]n:\s*(.*)", texto_completo, re.IGNORECASE)
    if m_dir:
        doc_data["ciudad"] = m_dir.group(1).strip() # Puede incluir toda la direccion

    m_elab = re.search(r"Elabor[oó]:\s*(.*)", texto_completo, re.IGNORECASE)
    if m_elab: doc_data["elaboradoPor"] = m_elab.group(1).strip()

    m_vend = re.search(r"Vendedor:\s*(.*)", texto_completo, re.IGNORECASE)
    if m_vend: doc_data["vendedor"] = m_vend.group(1).strip()

    # Forma de pago
    m_pago = re.search(r"FORMA DE PAGO:\s*(.*?)\s*-Valor:", texto_completo, re.IGNORECASE)
    if m_pago: 
        doc_data["formaPago"] = m_pago.group(1).strip()
    
    # Total
    m_total = re.search(r"TOTAL NETO\s*\$([\d,.]+)", texto_completo, re.IGNORECASE)
    if m_total:
        val_str = m_total.group(1).replace(",", "").replace(".", "")
        # A veces el punto es decimal, pero en COP suele ser miles. Si termina en 00 y tiene coma...
        # Asumimos formato $90,000 = 90000
        # Corregimos por si hay decimales reales.
        val_str = re.sub(r'[^\d]', '', m_total.group(1))
        doc_data["total"] = int(val_str)

    # Buscar items usando regex para las lineas de la tabla
    # ÍTEM REF. DESCRIPCIÓN CANT. PRECIO UD. DESCUENTO IMPUESTOS TOTAL NETO
    # 1 A100FUT01 UNIFORME FUTBOL 1 $55,000 $0 $55,000
    lineas = texto_completo.split('\n')
    en_tabla = False
    suma_items = 0
    for linea in lineas:
        if "ÍTEM" in linea.upper() and "REF" in linea.upper():
            en_tabla = True
            continue
        if en_tabla:
            if "Total ítems:" in linea:
                # Extraer total unidades
                m_unid = re.search(r"Total unidades:\s*(\d+)", linea)
                if m_unid: doc_data["unidades"] = int(m_unid.group(1))
                break
            
            # Match item row
            m_item = re.search(r"^\s*(\d+)\s+(\S+)\s+(.*?)\s+(\d+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)?", linea)
            if m_item:
                cant = int(m_item.group(4))
                precio_ud = int(re.sub(r'[^\d]', '', m_item.group(5)))
                total_linea = cant * precio_ud
                doc_data["items"].append({
                    "referencia": m_item.group(2),
                    "descripcion": m_item.group(3).strip(),
                    "cantidad": cant,
                    "precioUnitario": precio_ud,
                    "total": total_linea
                })
                suma_items += total_linea
    
    if doc_data["total"] > 0 and suma_items > 0 and doc_data["total"] != suma_items:
        doc_data["revisar"] = True

    return doc_data
