"""API del control compartido de cartera; JSON único y escrituras atómicas."""
import io, json, os, re, shutil
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

cartera_router = APIRouter(prefix="/api/cartera", tags=["cartera"])
_ROOT=Path(os.getenv("CARTERA_STATE_DIR","/data/state")); _STATE=_ROOT/"cartera.json"; _OLD=_ROOT/"cartera_v2.json"
_PDF_DIR=_ROOT/"cartera_pdfs"; _BACKUPS=_ROOT/"respaldos"
def _empty(): return {"config":{"plazoDesde":"entrega","contadoEquivale":"mismo_dia_entrega","anticipoMinimoPct":50},"usuarios":["DANIEL","ANDRES","SEBASTIAN GALLO"],"documentos":[],"comprobantes":[],"contadorComprobante":1}
def _safe(v): return re.sub(r"[^A-Za-z0-9_-]","_",str(v))
def _date(v):
    if hasattr(v,"isoformat"): return v.isoformat()[:10]
    s=str(v or "").strip()[:10]
    for f in ("%Y-%m-%d","%d/%m/%Y","%d-%m-%Y"):
        try: return datetime.strptime(s,f).date().isoformat()
        except ValueError: pass
    return s
def _amount(v):
    if isinstance(v,(int,float)): return float(v)
    s=re.sub(r"[^0-9,.-]","",str(v or ""))
    if s.count(",")==1 and s.count(".")>=1: s=s.replace(".","").replace(",",".")
    elif s.count(",")==1: s=s.replace(",",".")
    try: return float(s)
    except ValueError: return 0.
def _term(v):
    m=re.search(r"(\d+)",str(v or "")); return int(m.group(1)) if m else 0
def _pdf_quote_number(content:bytes):
    """Identifica el consecutivo en PDFs de cotización sin detener una carga si el PDF no tiene texto."""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            text="\n".join((page.extract_text() or "") for page in pdf.pages[:2])
        found=re.search(r"(?:cotizaci[oó]n\s*(?:no\.?|n[°oº])?|(?:^|\n)no\.?)\s*[:#-]?\s*(\d{3,}[A-Z0-9-]*)",text,re.I)
        return found.group(1).strip() if found else ""
    except Exception:
        return ""
def _audit(d,action,user="Sistema"): d.setdefault("historial",[]).append({"fecha":datetime.now(timezone.utc).isoformat(),"accion":action,"usuario":user})
def _normalize(raw):
    data=_empty(); data.update(raw or {}); data["config"]={**_empty()["config"],**(data.get("config") or {})}; data["usuarios"]=data.get("usuarios") or _empty()["usuarios"]
    docs=[]
    for row in data.get("documentos") or []:
        d=dict(row); d["numero"]=str(d.get("numero","")).strip()
        if not d["numero"]: continue
        d["fechaCreacion"]=_date(d.get("fechaCreacion",d.get("fecha"))); d["fechaEntrega"]=_date(d.get("fechaEntrega")) or None; d["total"]=_amount(d.get("total")); d["pagadoImportado"]=_amount(d.get("pagadoImportado",d.get("pagado"))); d["items"]=d.get("items") or []; d["estado"]=d.get("estado","pedido"); d["historial"]=d.get("historial") or []; d["plazoDias"]=int(d.get("plazoDias") or _term(d.get("formaPago"))); docs.append(d)
    data["documentos"]=docs; data["comprobantes"]=data.get("comprobantes") or []; data["contadorComprobante"]=max(int(data.get("contadorComprobante") or 1),len(data["comprobantes"])+1); return data
def _load():
    _ROOT.mkdir(parents=True,exist_ok=True); source=_STATE if _STATE.exists() else _OLD
    if not source.exists(): return _empty()
    try: return _normalize(json.loads(source.read_text(encoding="utf-8")))
    except Exception as exc: raise HTTPException(500,"No se pudo leer cartera.json") from exc
def _backup():
    _BACKUPS.mkdir(parents=True,exist_ok=True); out=_BACKUPS/f"cartera-{datetime.now().date().isoformat()}.json"
    if not out.exists() and _STATE.exists(): shutil.copy2(_STATE,out)
    for old in sorted(_BACKUPS.glob("cartera-*.json"))[:-30]: old.unlink(missing_ok=True)
def _save(data):
    data=_normalize(data); data["actualizadoEn"]=datetime.now(timezone.utc).isoformat(); _ROOT.mkdir(parents=True,exist_ok=True); tmp=_STATE.with_suffix(".tmp"); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8"); tmp.replace(_STATE); _backup(); return data

@cartera_router.get("/datos")
def datos():
    data=_load(); _PDF_DIR.mkdir(parents=True,exist_ok=True)
    for d in data["documentos"]: d["has_pdf"]=(_PDF_DIR/f"{_safe(d['numero'])}.pdf").exists()
    return data
@cartera_router.put("/datos")
async def guardar_datos(payload:dict): return _save(payload)
@cartera_router.post("/documentos")
async def guardar_documento(payload:dict):
    data=_load(); doc=dict(payload); numero=str(doc.get("numero","")).strip()
    if not numero: raise HTTPException(400,"El número de cotización es obligatorio")
    user=doc.pop("usuario","Usuario"); old=next((x for x in data["documentos"] if x["numero"]==numero),None)
    if old:
        history=old.get("historial",[]); old.update(doc); old["historial"]=history; _audit(old,"Documento actualizado",user)
    else: doc["historial"]=[]; _audit(doc,"Documento creado",user); data["documentos"].append(doc)
    _save(data); return {"ok":True,"numero":numero}
@cartera_router.post("/comprobantes")
async def guardar_comprobante(payload:dict):
    data=_load(); p=dict(payload); numero=str(p.get("cotizacionNumero","")).strip(); doc=next((x for x in data["documentos"] if x["numero"]==numero),None)
    if not doc: raise HTTPException(400,"La cotización no existe")
    p["valor"]=_amount(p.get("valor"))
    if p["valor"]<=0: raise HTTPException(400,"El valor debe ser mayor a cero")
    if p.get("id"):
        old=next((x for x in data["comprobantes"] if x["id"]==p["id"]),None)
        if not old: raise HTTPException(404,"Comprobante no encontrado")
        old.update(p); old["editado"]=True; p=old
    else:
        p.update({"id":f"CI-{data['contadorComprobante']:04d}","anulado":False,"editado":False,"creadoEn":datetime.now(timezone.utc).isoformat()}); data["contadorComprobante"]+=1; data["comprobantes"].append(p)
    _audit(doc,f"Pago {p['id']} registrado",p.get("recibio","Usuario")); _save(data); return p
@cartera_router.post("/comprobantes/{identificador}/anular")
async def anular(identificador:str,payload:dict):
    data=_load(); p=next((x for x in data["comprobantes"] if x["id"]==identificador),None)
    if not p: raise HTTPException(404,"Comprobante no encontrado")
    p["anulado"]=bool(payload.get("anulado",True)); p["motivoAnulacion"]=payload.get("motivo",""); p["editado"]=True; _save(data); return p
@cartera_router.post("/pdf/{numero}")
async def subir_pdf(numero:str,file:UploadFile=File(...)):
    content=await file.read()
    if content[:4]!=b"%PDF": raise HTTPException(400,"El archivo no es un PDF válido")
    _PDF_DIR.mkdir(parents=True,exist_ok=True); (_PDF_DIR/f"{_safe(numero)}.pdf").write_bytes(content); return {"ok":True,"numero":numero}
@cartera_router.post("/cargar-pdf")
async def cargar_pdfs(files:list[UploadFile]=File(...)):
    """Conserva PDFs aún sin cotización; permite cargarlos antes de completar sus datos."""
    pending=_PDF_DIR/"pendientes"; pending.mkdir(parents=True,exist_ok=True); saved=[]; skipped=[]
    existentes={str(d.get("numero","")).strip():d for d in _load().get("documentos",[])}
    for file in files:
        content=await file.read()
        if content[:4]!=b"%PDF":
            raise HTTPException(400,f"{file.filename or 'Archivo'} no es un PDF válido")
        numero=_pdf_quote_number(content)
        if numero and numero in existentes:
            skipped.append({"archivo":file.filename or "PDF","numero":numero,"cliente":existentes[numero].get("cliente","")})
            continue
        stem=_safe(Path(file.filename or "cotizacion.pdf").stem) or "cotizacion"
        name=f"{stem}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}.pdf"
        (pending/name).write_bytes(content); saved.append(file.filename or name)
    message=f"{len(saved)} PDF(s) cargado(s) y pendiente(s) de asociar"
    if skipped: message+=f" · {len(skipped)} omitido(s) por estar ya registrado(s)"
    return {"ok":True,"archivos":saved,"omitidos":skipped,"mensaje":message}
@cartera_router.get("/pendientes")
def pendientes_pdf():
    pending=_PDF_DIR/"pendientes"
    pending.mkdir(parents=True,exist_ok=True)
    return [{"archivo":p.name,"tamano":p.stat().st_size,"cargadoEn":datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).isoformat()} for p in sorted(pending.glob("*.pdf"),key=lambda p:p.stat().st_mtime,reverse=True)]
@cartera_router.get("/pendientes/{archivo}/archivo")
def ver_pdf_pendiente(archivo:str):
    path=(_PDF_DIR/"pendientes"/_safe(Path(archivo).stem)).with_suffix(".pdf")
    if not path.is_file(): raise HTTPException(404,"PDF pendiente no encontrado")
    return FileResponse(path,media_type="application/pdf",filename=path.name)
@cartera_router.delete("/pendientes/{archivo}")
def eliminar_pdf_pendiente(archivo:str):
    path=(_PDF_DIR/"pendientes"/_safe(Path(archivo).stem)).with_suffix(".pdf")
    if not path.is_file(): raise HTTPException(404,"PDF pendiente no encontrado")
    path.unlink()
    return {"ok":True,"mensaje":"PDF pendiente eliminado"}
@cartera_router.get("/pendientes/{archivo}/resumen")
def resumen_pendiente(archivo:str):
    path=(_PDF_DIR/"pendientes"/_safe(Path(archivo).stem)).with_suffix(".pdf")
    if not path.is_file(): raise HTTPException(404,"PDF pendiente no encontrado")
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            paginas=len(pdf.pages)
            text="\n".join((page.extract_text() or "") for page in pdf.pages[:3])
    except Exception as exc: raise HTTPException(422,f"No se pudo leer el PDF: {exc}") from exc
    def match(*patterns):
        for pattern in patterns:
            found=re.search(pattern,text,re.I)
            if found: return found.group(1).strip(" .:-")
        return "No detectado"
    cliente=match(r"(?:cliente|señor(?:es)?)\s*[:#-]?\s*([^\n]{3,100}?)(?=\s*(?:\.?\s*(?:CC|C\.C\.|NIT|creaci[oó]n|tel[eé]fono|email)\b|$))")
    total=match(r"(?:total\s*(?:neto|a\s+pagar)?|valor\s+total)\s*[:$#-]*\s*(?:\n\s*)?([^\n]{2,40})")
    if not re.search(r"\d",total):
        amount=re.search(r"(?:total\s*(?:neto|a\s+pagar)?|valor\s+total)[\s\S]{0,180}?(\$?\s*\d[\d.,]+)",text,re.I)
        total=amount.group(1).strip() if amount else "No detectado"
    return {"archivo":archivo,"paginas":paginas,"cotizacion":match(r"(?:cotizaci[oó]n\s*(?:no\.?|n[°oº])?|(?:^|\n)no\.?)\s*[:#-]?\s*(\d{3,}[A-Z0-9-]*)",r"(?:pedido|cotizaci[oó]n|n[°oº])\s*[:#-]?\s*([A-Z0-9-]{3,})"),"fecha":match(r"(?:fecha|emisi[oó]n|creaci[oó]n)\s*[:#-]?\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})"),"cliente":cliente,"total":total,"texto":text[:5000] or "El PDF no tiene texto seleccionable; puede ser una imagen escaneada."}
@cartera_router.post("/pendientes/{archivo}/asociar/{numero}")
def asociar_pendiente(archivo:str,numero:str):
    source=(_PDF_DIR/"pendientes"/_safe(Path(archivo).stem)).with_suffix(".pdf")
    target=_PDF_DIR/f"{_safe(numero)}.pdf"
    if not source.is_file(): raise HTTPException(404,"PDF pendiente no encontrado")
    if target.exists(): raise HTTPException(409,"La cotización ya tiene un PDF asociado")
    source.replace(target)
    return {"ok":True,"mensaje":f"PDF asociado a la cotización {numero}"}
@cartera_router.get("/pdf/{numero}")
def ver_pdf(numero:str):
    path=_PDF_DIR/f"{_safe(numero)}.pdf"
    if not path.exists(): raise HTTPException(404,"PDF no encontrado")
    return FileResponse(path,media_type="application/pdf",filename=f"{numero}.pdf")
@cartera_router.get("/respaldo")
def respaldo(): return JSONResponse(_save(_load()),headers={"Content-Disposition":"attachment; filename=cartera-respaldo.json"})
@cartera_router.post("/restaurar")
async def restaurar(file:UploadFile=File(...)):
    try: return _save(json.loads((await file.read()).decode("utf-8")))
    except Exception as exc: raise HTTPException(400,"El respaldo no es un JSON válido") from exc
@cartera_router.post("/sincronizar")
def sincronizar():
    creds=Path(os.getenv("GOOGLE_CREDENTIALS","/run/secrets/google-service-account.json")); file_id=os.getenv("PAGOS_COTIZACIONES_FILE_ID","").strip()
    if not file_id or not creds.is_file(): raise HTTPException(503,"Falta configurar Google Sheets en el servidor")
    try:
        import openpyxl
        from google.oauth2.service_account import Credentials
        from google.auth.transport.requests import AuthorizedSession
        session=AuthorizedSession(Credentials.from_service_account_file(str(creds),scopes=["https://www.googleapis.com/auth/drive.readonly"])); response=session.get(f"https://www.googleapis.com/drive/v3/files/{file_id}",params={"alt":"media","supportsAllDrives":"true"},timeout=60); response.raise_for_status(); wb=openpyxl.load_workbook(io.BytesIO(response.content),data_only=True,read_only=True)
    except Exception as exc: raise HTTPException(502,f"No se pudo leer Google Sheets: {exc}") from exc
    name=os.getenv("PAGOS_COTIZACIONES_HOJA",""); ws=wb[name] if name in wb.sheetnames else wb[wb.sheetnames[0]]; rows=ws.iter_rows(values_only=True); heads=[str(x or "").upper().strip() for x in next(rows,[])]
    def col(word,default=None): return next((i for i,h in enumerate(heads) if word in h),default)
    n,cl,v,t,f,e=col("COTIZ",0),col("CLIENTE",1),col("VENDEDOR",2),col("TOTAL",3),col("FECHA"),col("ESTADO"); data=_load(); indexed={d["numero"]:d for d in data["documentos"]}; count=0
    for row in rows:
        get=lambda i:row[i] if i is not None and i<len(row) else ""; number=str(get(n) or "").strip()
        if not number: continue
        d=indexed.get(number,{"numero":number,"historial":[]}); d.update({"cliente":str(get(cl) or "SIN CLIENTE").strip(),"vendedor":str(get(v) or "").strip(),"fechaCreacion":_date(get(f)),"total":_amount(get(t)),"estado":"anulada" if "anulad" in str(get(e)).lower() else d.get("estado","pedido")}); d.setdefault("items",[]); d.setdefault("plazoDias",0)
        if number not in indexed: data["documentos"].append(d); indexed[number]=d
        count+=1
    _save(data); return {"ok":True,"documentos":count,"hoja":ws.title}
@cartera_router.get("/cartera.js")
def script(): return FileResponse(Path(__file__).with_name("cartera.js"),media_type="application/javascript")
