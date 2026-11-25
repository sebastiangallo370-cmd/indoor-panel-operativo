// OLVER: exporta cada mesa de trabajo como archivo independiente.
// PARAMS = { ai, carpeta, prefijo: "cliente_referencia", formato: "ai" | "pdf" | "png" | "ambos" }
// "ai": cada mesa de trabajo se guarda como su propio archivo .ai (solo esa mesa)
// Sin cuadros de diálogo (fuentes o vínculos faltantes, perfiles de color…): si Illustrator se queda esperando un clic, la exportación no avanza.
// Copia con reintentos: en la red (unidad Z: o \NAS) la copia a veces falla un instante por bloqueos o por una carpeta que aún no responde.
function copiarConReintentos(origen, destino) {
    var ultimo = "";
    for (var intento = 1; intento <= 5; intento++) {
        try {
            var carpeta = destino.parent;
            if (carpeta && !carpeta.exists) carpeta.create();
            if (destino.exists) { try { destino.readonly = false; } catch (er1) {} destino.remove(); }
            if (origen.copy(destino.fsName) && destino.exists) return true;
            ultimo = origen.error || destino.error || "";
        } catch (er2) { ultimo = String(er2); }
        $.sleep(1500 * intento);
    }
    // Último recurso: la copia de Windows (cmd), que no depende de la E/S de Illustrator (a veces da «Error de E/S» sobre la NAS)
    try {
        if (typeof app.system === "function") app.system('cmd /c copy /Y "' + origen.fsName + '" "' + destino.fsName + '"');
        $.sleep(800);
        if (destino.exists && destino.length > 0) return true;
    } catch (er3) { ultimo += " | cmd: " + er3; }
    throw "No pude copiar " + destino.name + " a la carpeta de destino (" + destino.parent.fsName + ")" + (ultimo ? ": " + ultimo : "");
}

var __nivelIA = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
var __resultadoIA;
try { __resultadoIA = (function () {
    function limpio(s) {
        return String(s).replace(/[\\\/:*?"<>|\[\]]/g, "").replace(/\s+/g, "-");
    }
    // Sufijo M / F / N según el nombre de la mesa; si no lo dice, usa PARAMS.generoUnico (solo si hay uno seguro)
    function sufijo(nombre) {
        var n = nombre.toUpperCase();
        if (/(^|[-_ ])(FEM|FEMENINO|F)($|[-_ ])/.test(n)) return "F";
        if (/NI[ÑN]O|NI[ÑN]A|(^|[-_ ])N($|[-_ ])/.test(n)) return "N";
        if (/(^|[-_ ])(MASC|MASCULINO|M)($|[-_ ])/.test(n)) return "M";
        return PARAMS.generoUnico || "";
    }
    // avisa al panel en qué paso va (el programa de los agentes lee este archivo y lo muestra en el registro)
    function prog(t) { try { if (PARAMS.progreso) { var pf = new File(PARAMS.progreso); pf.encoding = "UTF-8"; pf.open("w"); pf.write(t); pf.close(); } } catch (ep) {} }
    // borra una carpeta temporal con sus archivos (Folder.remove() solo borra carpetas vacías)
    function borrarCarpeta(f) { try { var xs = f.getFiles(); for (var k = 0; k < xs.length; k++) { try { xs[k].remove(); } catch (e1) {} } f.remove(); } catch (e2) {} }
    var doc = null;
    try {
        var carpeta = new Folder(PARAMS.carpeta);
        if (!carpeta.exists) carpeta.create();
        // Copia local ya incrustada del maestro (PARAMS.cache): abrirla toma segundos; el original en la NAS (con cientos de imágenes
        // vinculadas) tarda minutos solo en abrir y otro tanto en incrustarlas. La primera vez se crea; después se reutiliza.
        var cacheF = PARAMS.cache ? new File(PARAMS.cache) : null;
        if (cacheF && cacheF.exists) {
            prog("Abro la copia local del maestro");
            doc = app.open(cacheF);
        } else {
            prog("Abro el maestro desde la NAS (la primera vez tarda)");
            doc = app.open(new File(PARAMS.ai));
            prog("Maestro abierto: " + doc.artboards.length + " mesas, " + doc.placedItems.length + " imágenes vinculadas");
            if (cacheF) {
                try {
                    var nc = doc.placedItems.length;
                    for (var cp = nc - 1; cp >= 0; cp--) { try { doc.placedItems[cp].embed(); } catch (ec) {} if ((nc - cp) % 5 == 0) prog("Incrustando imágenes del maestro: " + (nc - cp) + " de " + nc); }
                    prog("Guardando la copia local del maestro (solo la primera vez)");
                    var oc = new IllustratorSaveOptions();
                    oc.pdfCompatible = false;
                    oc.compressed = true;
                    new Folder(cacheF.parent.fsName).create();
                    var tmpC = new File(cacheF.fsName.replace(/\.ai$/i, "") + "_tmp.ai");
                    doc.saveAs(tmpC, oc);          // el documento pasa a ser la copia local (el maestro de la NAS no se toca)
                    if (cacheF.exists) cacheF.remove();
                    tmpC.rename(cacheF.name);
                } catch (ecache) { /* sin copia local: se sigue con el documento abierto */ }
            }
        }
        if (PARAMS.tallas && PARAMS.tallas.length) {
            // Un .ai independiente por mesa. En producción PARAMS.todas es
            // verdadero: incluye TODAS las mesas, incluso si su nombre no
            // contiene "Talla". Las ya existentes se reutilizan abajo.
            var pedidas = {}, hay = {}, idx = [];
            var exportarTodas = PARAMS.todas === true;
            for (var t = 0; t < PARAMS.tallas.length; t++) pedidas[String(PARAMS.tallas[t]).toUpperCase()] = 1;
            for (var k = 0; k < doc.artboards.length; k++) {
                var mt = /Talla[_ ]([A-Za-z0-9]+)[_ ]/i.exec(doc.artboards[k].name);
                var tl = mt ? mt[1].toUpperCase() : "";
                if (exportarTodas || (tl && pedidas[tl])) {
                    if (tl) hay[tl] = 1;
                    idx.push(k + 1);
                }
            }
            if (!idx.length) throw "El maestro no tiene mesas de las tallas pedidas (" + PARAMS.tallas.join(", ") + ")";
            var nombres = [];
            for (var n = 0; n < idx.length; n++) nombres.push(limpio(doc.artboards[idx[n] - 1].name));
            var pendientes = [];
            for (var e = 0; e < nombres.length; e++) {
                var existente = new File(PARAMS.carpeta + "/" + nombres[e] + ".ai");
                // Reutiliza una mesa correcta ya exportada. Solo una acción
                // explícita de sobrescribir permite volver a crearla.
                if (!PARAMS.sobrescribir && existente.exists && existente.length > 0) continue;
                pendientes.push(e);
            }
            if (!pendientes.length) {
                doc.close(SaveOptions.DONOTSAVECHANGES);
                return "OK|0";
            }
            // las imágenes vinculadas NO se incrustan aquí: las mesas se guardan tal cual (rápido); las imágenes las trata quien pone nombre y número
            // Si alguien toca Illustrator (Esc, un clic, un diálogo) mientras guarda, da «the operation was cancelled»: se reintenta la misma mesa hasta 4 veces.
            var guardarReintento = function (archivo, opciones, mesa) {
                for (var intento = 1; ; intento++) {
                    try { doc.artboards.setActiveArtboardIndex(mesa - 1); doc.saveAs(archivo, opciones); return; }
                    catch (eg) {
                        if (intento >= 4 || String(eg).toLowerCase().indexOf("cancel") < 0) throw eg;
                        prog("Illustrator canceló el guardado; reintento " + intento + " de 3 (no toques Illustrator)…");
                        $.sleep(3000);
                    }
                }
            };
            var ou = new IllustratorSaveOptions();
            ou.pdfCompatible = true;
            ou.compressed = true;
            ou.saveMultipleArtboards = true;
            // una mesa a la vez: así cada archivo aparece en la carpeta apenas termina y el panel puede ir avisando «EXPORTADA: …»
            var fallidas = [], buenas = 0, borrar = [];
            for (var p = 0; p < pendientes.length; p++) {
                var n2 = pendientes[p];
                try {
                // se ve trabajar: va a la mesa de cada talla en pantalla antes de exportarla
                prog("Exportando mesa " + (p + 1) + " de " + pendientes.length + ": " + nombres[n2]);
                try { doc.artboards.setActiveArtboardIndex(idx[n2] - 1); app.executeMenuCommand("fitin"); app.redraw(); $.sleep(350); } catch (evis) {}
                // con PARAMS.local Illustrator solo GUARDA en una carpeta LOCAL (una subcarpeta por mesa con su nombre final) y Python la lleva a la NAS:
                // en algunos PC el File.copy de Illustrator da «Error de E/S» (hasta en local)
                var tmpU = PARAMS.local ? new Folder(PARAMS.local + "/" + nombres[n2]) : new Folder(Folder.temp + "/olver_" + new Date().getTime() + "_" + n2);
                tmpU.create();
                ou.artboardRange = String(idx[n2]);
                guardarReintento(new File(tmpU.fsName + "/m.ai"), ou, idx[n2]);
                var gen = tmpU.getFiles("*.ai");
                if (!gen || gen.length != 1) throw "No pude guardar la mesa " + nombres[n2] + " como .ai";
                // Copia de TRABAJO (solo en este PC, no va a la NAS): igual pero con las imágenes incrustadas. La usa quien pone nombre y número, porque
                // abrirla tarda ~1 s en vez de ~11 s. La mesa que queda en la NAS NO se toca: sigue con sus imágenes vinculadas, intacta.
                if (PARAMS.trabajo) {
                    var ow = new IllustratorSaveOptions();
                    ow.pdfCompatible = true;
                    ow.compressed = true;
                    ow.saveMultipleArtboards = true;
                    ow.embedLinkedFiles = true;
                    ow.artboardRange = String(idx[n2]);
                    var tw = new Folder(PARAMS.trabajo + "/" + nombres[n2]);
                    tw.create();
                    // La copia de trabajo es solo una ayuda de velocidad: si Illustrator la cancela (pasaba con la 2.ª/3.ª mesa), se sigue sin ella
                    // y el paso de nombre y número abre la mesa de la NAS. Nunca debe frenar la exportación de las mesas.
                    try { doc.artboards.setActiveArtboardIndex(idx[n2] - 1); doc.saveAs(new File(tw.fsName + "/m.ai"), ow); }
                    catch (etw) { prog("Sin copia de trabajo de " + nombres[n2] + " (se sigue igual): " + etw); try { tw.remove(); } catch (etw2) {} }
                }
                if (PARAMS.local) { buenas++; continue; }
                var fin = new File(PARAMS.carpeta + "/" + nombres[n2] + ".ai");
                copiarConReintentos(gen[0], fin);
                // la carpeta temporal NO se borra aquí: Illustrator sigue apuntando a ese archivo hasta el siguiente saveAs (si se borra, la siguiente mesa se cancela)
                borrar.push(tmpU);
                buenas++;
                } catch (efalla) {
                    // una mesa que Illustrator no guarda NO detiene las demás: se registra y se sigue con las siguientes
                    fallidas.push(nombres[n2]);
                    prog("No se pudo exportar la mesa " + nombres[n2] + " (se siguen las demás): " + efalla);
                    borrar.push(tmpU);
                }
            }
            doc.close(SaveOptions.DONOTSAVECHANGES);
            doc = null;
            for (var bj = 0; bj < borrar.length; bj++) borrarCarpeta(borrar[bj]);
            if (fallidas.length) return "PARCIAL|" + buenas + "|" + fallidas.join(", ");
            var faltan = [];
            for (var q = 0; q < PARAMS.tallas.length; q++) if (!hay[String(PARAMS.tallas[q]).toUpperCase()]) faltan.push(PARAMS.tallas[q]);
            return faltan.length ? "FALTAN|" + faltan.join(", ") : "OK|" + idx.length;
        }
        var usados = {};
        var fallidas2 = [], borrar2 = [];
        var total = doc.artboards.length;
        for (var i = 0; i < total; i++) {
            var nombre = limpio(doc.artboards[i].name) || ("mesa" + (i + 1));
            if (usados[nombre]) { usados[nombre]++; nombre = nombre + "_" + usados[nombre]; }
            else { usados[nombre] = 1; }
            var g = PARAMS.conGenero ? sufijo(doc.artboards[i].name) : "";
            if (PARAMS.conGenero && !g) throw "La mesa «" + doc.artboards[i].name + "» no dice si es M, F o N";
            var base;
            if (PARAMS.conGenero) {   // D1_FUT01M  (diseño_referencia+género)
                var dm = /(^|[^A-Z0-9])D(\d+)/i.exec(doc.artboards[i].name);
                var dn = dm ? dm[2] : (PARAMS.disenos.length == 1 ? PARAMS.disenos[0] : "");
                if (!dn) throw "La mesa «" + doc.artboards[i].name + "» no dice qué diseño es (D1, D2...)";
                base = "D" + dn + "_" + PARAMS.ref + g;
            } else {
                base = (PARAMS.prefijo ? PARAMS.prefijo + "_" : "") + nombre;
            }
            if (!PARAMS.sobrescribir && (new File(PARAMS.carpeta + "/" + base + ".ai").exists || new File(PARAMS.carpeta + "/" + base + ".pdf").exists || new File(PARAMS.carpeta + "/" + base + ".png").exists)) {
                // Una mesa ya producida se conserva y se sigue revisando el
                // resto del archivo; así una mesa existente no impide que se
                // exporten las demás que aún faltan.
                continue;
            }

            if (PARAMS.formato == "ai") {
                try {
                // Illustrator guarda cada mesa como "<nombre>-<mesa>.ai": se guarda en una carpeta temporal y se copia con el nombre final
                var tmp = new Folder(Folder.temp + "/olver_" + new Date().getTime() + "_" + i);
                tmp.create();
                var a = new IllustratorSaveOptions();
                a.pdfCompatible = true;
                a.compressed = true;
                a.saveMultipleArtboards = true;
                a.artboardRange = String(i + 1);
                doc.saveAs(new File(tmp.fsName + "/m.ai"), a);
                var generados = tmp.getFiles("*.ai");
                if (!generados || generados.length != 1) throw "No pude guardar la mesa «" + doc.artboards[i].name + "» como .ai";
                var destino = new File(PARAMS.carpeta + "/" + base + ".ai");
                copiarConReintentos(generados[0], destino);
                borrar2.push(tmp);
                } catch (efalla2) {
                    fallidas2.push(base);
                    prog("No se pudo exportar la mesa " + base + " (se siguen las demás): " + efalla2);
                }
            }
            if (PARAMS.formato == "pdf" || PARAMS.formato == "ambos") {
                var p = new PDFSaveOptions();
                p.compatibility = PDFCompatibility.ACROBAT7;
                p.preserveEditability = false;
                p.viewAfterSaving = false;
                p.artboardRange = String(i + 1);
                doc.saveAs(new File(PARAMS.carpeta + "/" + base + ".pdf"), p);
            }
            if (PARAMS.formato == "png" || PARAMS.formato == "ambos") {
                var o = new ExportOptionsPNG24();
                o.artBoardClipping = true;
                o.transparency = true;
                o.horizontalScale = 100;
                o.verticalScale = 100;
                doc.artboards.setActiveArtboardIndex(i);
                doc.exportFile(new File(PARAMS.carpeta + "/" + base + ".png"), ExportType.PNG24, o);
            }
        }
        doc.close(SaveOptions.DONOTSAVECHANGES);
        for (var bk = 0; bk < borrar2.length; bk++) borrarCarpeta(borrar2[bk]);
        return fallidas2.length ? "PARCIAL|" + (total - fallidas2.length) + "|" + fallidas2.join(", ") : "OK|" + total;
    } catch (e) {
        try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        return "ERROR: " + e;
    }
})(); } finally { app.userInteractionLevel = __nivelIA; }
__resultadoIA;
