#target illustrator
/**
 * INDOOR SPORT - GENERADOR DE PDF PARA LOS AGENTES (igual que Generador_PDFS.jsx, SIN diálogos).
 * Lo que hace igual: abre el maestro, busca en su carpeta y en las carpetas hermanas del MISMO diseño los .ai con la
 * misma talla, diseño y género (Tipo_D#), y genera un PDF por cada fila (jugador) para cada uno de esos .ai.
 * Lo que cambia: no pregunta nada. El agente pone estas variables ANTES de este código:
 *   INDOOR_DOC       ruta del .ai del maestro (con /)
 *   INDOOR_CSV       texto CSV: cabecera (NOMBRE1;NUMERO1) y una fila por prenda
 *   INDOOR_MONTAJES  carpeta Montajes del diseño (la raíz de los hermanos)
 *   INDOOR_SALIDA    carpeta donde se guardan los PDF (se respeta la estructura Montajes → Salida)
 *   INDOOR_TMP       carpeta temporal local
 *   INDOOR_PREFIJO   prefijo del nombre del archivo (orden_tela_), puede ir vacío
 * Al terminar deja en INDOOR_JSX_MESSAGES los mensajes y el resultado (PDF creados por archivo).
 */

var INDOOR_JSX_MESSAGES = (typeof INDOOR_JSX_MESSAGES !== "undefined") ? INDOOR_JSX_MESSAGES : [];
var INDOOR_RESULTADO = [];
var INDOOR_PAUSA_MS = (typeof INDOOR_PAUSA_MS !== "undefined") ? INDOOR_PAUSA_MS : 700;   // pausa para que se vea cada archivo

(function () {
    var originalInteraction = app.userInteractionLevel;

    function log(t) { INDOOR_JSX_MESSAGES.push(t); }
    function sanitize(str) { return str.replace(/[\\\/:*?"<>|]/g, "_"); }

    // Ruta relativa de una carpeta dentro de otra (usando '/')
    function getRelativePath(baseFolder, targetFolder) {
        if (!baseFolder || !targetFolder) return "";
        var basePath = decodeURI(baseFolder.fullName).toLowerCase();
        var targetPath = decodeURI(targetFolder.fullName).toLowerCase();
        if (targetPath.indexOf(basePath) === 0) {
            var rel = decodeURI(targetFolder.fullName).substring(basePath.length);
            if (rel.indexOf("/") === 0) { rel = rel.substring(1); }
            return rel;
        }
        return "";
    }

    function createFolderRecursive(baseFolder, relativePath) {
        var parts = relativePath.split("/");
        var currentFolder = baseFolder;
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "") continue;
            currentFolder = new Folder(decodeURI(currentFolder.fullName) + "/" + sanitize(parts[i]));
            if (!currentFolder.exists) { currentFolder.create(); }
        }
        return currentFolder;
    }

    function getFilesRecursive(folder) {
        var files = [];
        var allContents = folder.getFiles(function (item) {
            if (item instanceof Folder) return item.name.indexOf(".") !== 0;
            if (item instanceof File) return /\.ai$/i.test(item.name);
            return false;
        });
        if (allContents) {
            for (var i = 0; i < allContents.length; i++) {
                var item = allContents[i];
                if (item instanceof File) { files.push(item); }
                else if (item instanceof Folder) { files = files.concat(getFilesRecursive(item)); }
            }
        }
        return files;
    }

    // --- Talla, género y diseño (idénticos a Generador_PDFS.jsx) ---
    function getSize(name) {
        var decodedName = decodeURI(name);
        var n = decodedName.toUpperCase();
        var match = n.match(/TALLA[\s_-]*([A-Z0-9]+)/);
        if (match) { return match[1]; }
        var base = decodedName.replace(/\.[^\.]+$/, '').replace(/[\s_\-\.\(\)]+/g, ' ').toUpperCase();
        var words = base.split(' ');
        var sizes = ["5XL", "4XL", "3XL", "2XL", "XL", "XS", "S", "M", "L", "16", "14", "12", "10", "8", "6", "4", "2"];
        for (var i = words.length - 1; i >= 0; i--) {
            for (var s = 0; s < sizes.length; s++) { if (words[i] === sizes[s]) return words[i]; }
        }
        return null;
    }

    function getGender(name) {
        var n = decodeURI(name).toUpperCase();
        if (n.match(/GEN[\s_-]*M\b/) || n.match(/_M$/) || n.indexOf("HOMBRE") !== -1 || n.indexOf("MASCULINO") !== -1 || n.indexOf("MASC") !== -1) return "HOMBRE";
        if (n.match(/GEN[\s_-]*F\b/) || n.match(/_F$/) || n.indexOf("MUJER") !== -1 || n.indexOf("FEMENINO") !== -1 || n.indexOf("FEM") !== -1) return "MUJER";
        if (n.match(/GEN[\s_-]*N\b/) || n.match(/_N$/) || n.indexOf("NIÑO") !== -1 || n.indexOf("NINO") !== -1 || n.indexOf("NIÑA") !== -1 || n.indexOf("NINA") !== -1 || n.indexOf("KIDS") !== -1 || n.indexOf("INFANTIL") !== -1) return "NINO";
        if (n.indexOf("UNISEX") !== -1) return "UNISEX";
        return "OTRO";
    }

    function getDesignCode(name) {
        var m = decodeURI(name).toUpperCase().match(/TIPO[\s_-]*([A-Z0-9]+)/);
        return m ? m[1] : null;
    }

    function cleanName(name, folderName) {
        var base = decodeURI(name).replace(/\.[^\.]+$/, '').replace(/[\s_\-\.\(\)]+/g, ' ').toUpperCase();
        var sizes = ["5XL", "4XL", "3XL", "2XL", "XL", "XS", "S", "M", "L", "16", "14", "12", "10", "8", "6", "4", "2"];
        var genders = ["HOMBRE", "MASCULINO", "MASC", "MUJER", "FEMENINO", "FEM", "NINO", "NIÑO", "NINA", "NIÑA", "KIDS", "INFANTIL", "UNISEX", "GEN"];
        var parts = ["PETICO", "PETICOS", "SESGOS", "SESGO", "COMPLEMENTOS", "COMPLEMENTO", "COSTADOS", "COSTADO", "COTADOS", "COTADO", "CUELLO", "MANGAS", "MANGA", "FRENTE", "DELANTERO", "ESPALDA", "TRASERO", "PUÑOS", "PUÑO", "CANESU", "CANESÚ", "HOMBROS", "HOMBRO", "TALLA", "TALLAS", "TIPO", "FUSIONADO", "FUSIONADOS", "FUSIONADA", "FUSIONADAS"];
        var folderWords = decodeURI(folderName).replace(/[\s_\-\.\(\)]+/g, ' ').toUpperCase().split(' ');
        var words = base.split(' ');
        var out = [];
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (w === "") continue;
            var skip = false;
            var lists = [sizes, genders, parts, folderWords];
            for (var l = 0; l < lists.length && !skip; l++) {
                for (var k = 0; k < lists[l].length; k++) { if (w === lists[l][k]) { skip = true; break; } }
            }
            if (!skip) out.push(w);
        }
        return out.join(' ');
    }

    function sameDesign(nameA, folderNameA, nameB, folderNameB) {
        var codeA = getDesignCode(nameA), codeB = getDesignCode(nameB);
        if (codeA !== null && codeB !== null) { return codeA === codeB; }
        var cleanA = cleanName(nameA, folderNameA), cleanB = cleanName(nameB, folderNameB);
        return cleanA !== "" && cleanA === cleanB;
    }

    // --- Lectura del CSV que puso el agente (una fila por prenda) ---
    var filasDataGlobal = [];
    var contenidoCsv = (typeof INDOOR_CSV !== "undefined" ? String(INDOOR_CSV) : "").replace(/^﻿/, '');
    var lineasCsv = contenidoCsv.split(/\r\n|\r|\n/);
    for (var kG = 0; kG < lineasCsv.length; kG++) {
        if (lineasCsv[kG].replace(/\s/g, '').length > 0) { filasDataGlobal.push(lineasCsv[kG]); }
    }
    if (filasDataGlobal.length <= 1) {
        log("ERROR: el CSV no tiene filas de jugadores.");
        app.userInteractionLevel = originalInteraction;
        return;
    }

    var maestroFile = new File(INDOOR_DOC);
    var docA = app.open(maestroFile);
    var materialFolderA = maestroFile.parent;          // carpeta de material (p. ej. FUT09M)
    var designFolder = materialFolderA.parent;         // carpeta de diseño (p. ej. D1)
    var montajesFolder = new Folder(INDOOR_MONTAJES);
    var salidaRaiz = new Folder(INDOOR_SALIDA);
    if (!salidaRaiz.exists) { salidaRaiz.create(); }

    var sizeA = getSize(maestroFile.name);
    var genderA = getGender(maestroFile.name);
    log("Maestro: " + maestroFile.name + " | talla " + sizeA + " | género " + genderA + " | diseño " + (getDesignCode(maestroFile.name) || "(sin Tipo_D#)"));

    // --- 1) Archivos de la MISMA talla, diseño y género: en la carpeta del maestro y en las carpetas hermanas del diseño ---
    var filesToProcess = [];
    var addedPaths = {};
    function addFileUnique(f) {
        var key = decodeURI(f.fullName).toLowerCase();
        if (!addedPaths[key]) { addedPaths[key] = true; filesToProcess.push(f); }
    }
    var carpetas = [materialFolderA];
    var hermanas = designFolder.getFiles(function (f) { return f instanceof Folder && f.name.indexOf(".") !== 0; });
    for (var h = 0; hermanas && h < hermanas.length; h++) {
        if (decodeURI(hermanas[h].fullName).toLowerCase() !== decodeURI(materialFolderA.fullName).toLowerCase()) { carpetas.push(hermanas[h]); }
    }
    for (var c = 0; c < carpetas.length; c++) {
        var archivos = getFilesRecursive(carpetas[c]);
        for (var a = 0; a < archivos.length; a++) {
            var f = archivos[a];
            if (getSize(f.name) === sizeA && getGender(f.name) === genderA && sameDesign(maestroFile.name, materialFolderA.name, f.name, carpetas[c].name)) {
                addFileUnique(f);
            }
        }
    }
    log("Archivos a procesar (talla, diseño y género iguales): " + filesToProcess.length);

    // Modo listar: solo devuelve la lista de archivos (el agente la usa para procesarlos uno por uno)
    if (typeof INDOOR_SOLO_LISTAR !== "undefined" && INDOOR_SOLO_LISTAR) {
        for (var lf = 0; lf < filesToProcess.length; lf++) { INDOOR_JSX_MESSAGES.push("ARCHIVO:" + decodeURI(filesToProcess[lf].fullName)); }
        try { docA.close(SaveOptions.DONOTSAVECHANGES); } catch (eLC) {}
        app.userInteractionLevel = originalInteraction;
        return;
    }
    // Modo un archivo: solo procesa el indicado
    if (typeof INDOOR_SOLO_ARCHIVO !== "undefined" && INDOOR_SOLO_ARCHIVO) {
        var soloLista = [];
        for (var sf = 0; sf < filesToProcess.length; sf++) {
            if (decodeURI(filesToProcess[sf].fullName).toLowerCase() === decodeURI(INDOOR_SOLO_ARCHIVO).toLowerCase()) { soloLista.push(filesToProcess[sf]); }
        }
        filesToProcess = soloLista;
    }

    // --- 2) Columnas del CSV (igual que el original) ---
    var hCols = filasDataGlobal[0].split((filasDataGlobal[0].indexOf(";") !== -1) ? ";" : ",");
    var jugMapa = {};
    for (var hh = 0; hh < hCols.length; hh++) {
        var v = hCols[hh].toUpperCase().replace(/\s/g, '');
        var isN = (v.indexOf("NOMBRE") !== -1 || v.indexOf("NAME") !== -1);
        var isU = (v.indexOf("NUM") !== -1 || v.indexOf("NRO") !== -1 || v.indexOf("DORSAL") !== -1 || v === "N°");
        var m = v.match(/(\d+)$/); var jIdx = m ? (parseInt(m[1], 10) - 1) : 0;
        if (!jugMapa[jIdx]) jugMapa[jIdx] = { nom: -1, num: -1 };
        if (isN && v.indexOf("NUM") === -1) jugMapa[jIdx].nom = hh; else if (isU) jugMapa[jIdx].num = hh;
    }
    var columnas = [];
    var jK = [];
    for (var kk in jugMapa) { jK.push(parseInt(kk, 10)); }
    jK.sort(function (x, y) { return x - y; });
    for (var q = 0; q < jK.length; q++) { var mm = jugMapa[jK[q]]; if (mm.nom !== -1 || mm.num !== -1) columnas.push(mm); }
    var nP = columnas.length || 1;
    var separador = (filasDataGlobal[0].indexOf(";") !== -1) ? ";" : ",";

    var pdfOpt = new PDFSaveOptions();
    pdfOpt.preserveEditability = true;
    pdfOpt.optimization = false;
    pdfOpt.generateThumbnails = false;
    pdfOpt.compressArt = true;

    function unlockAllLayers(layerList) {
        for (var l = 0; l < layerList.length; l++) {
            layerList[l].locked = false;
            layerList[l].visible = true;
            try { if (layerList[l].layers && layerList[l].layers.length > 0) unlockAllLayers(layerList[l].layers); } catch (e) {}
        }
    }

    function reubicarYCentrar(candObj, nuevoTexto) {
        if (!candObj || !candObj.item) return;
        var it = candObj.item;
        it.contents = (nuevoTexto || "").toString();
        try { it.textRange.paragraphAttributes.justification = Justification.CENTER; } catch (e) {}
        var curCX = it.left + (it.width / 2);
        var curCY = it.top - (it.height / 2);
        it.translate(candObj.x - curCX, candObj.y - curCY);
    }

    // --- 3) Procesar cada archivo con las mismas filas del CSV ---
    function procesarDocumento(doc, targetFolder, nombreBase) {
        var tfs = doc.textFrames;
        var nameFrames = [];
        var i, tfi, txt;
        unlockAllLayers(doc.layers);
        var placed = doc.placedItems;
        for (i = placed.length - 1; i >= 0; i--) { try { placed[i].embed(); } catch (e) {} }

        for (i = 0; i < tfs.length; i++) {
            tfi = tfs[i];
            txt = tfi.contents.toString().toUpperCase().replace(/^\s+|\s+$/g, '');
            if (txt === "NOMBRE") {
                nameFrames.push({ item: tfi, type: "nom", x: tfi.left + tfi.width / 2, y: tfi.top - tfi.height / 2, origContents: tfi.contents });
                tfi.textRange.paragraphAttributes.justification = Justification.CENTER;
            }
        }
        var candidates = [].concat(nameFrames);
        for (i = 0; i < tfs.length; i++) {
            tfi = tfs[i];
            txt = tfi.contents.toString().toUpperCase().replace(/^\s+|\s+$/g, '');
            if (txt === "00") {
                var ya = false;
                for (var c0 = 0; c0 < candidates.length; c0++) { if (candidates[c0].item === tfi && candidates[c0].type === "num") { ya = true; break; } }
                if (!ya) {
                    candidates.push({ item: tfi, type: "num", x: tfi.left + tfi.width / 2, y: tfi.top - tfi.height / 2, origContents: tfi.contents });
                    tfi.textRange.paragraphAttributes.justification = Justification.CENTER;
                }
            }
        }
        var numberCandidates = [], nameCandidates = [];
        for (i = 0; i < candidates.length; i++) {
            candidates[i].item.paired = false;
            if (candidates[i].type === "num") numberCandidates.push(candidates[i]); else nameCandidates.push(candidates[i]);
        }
        var jerseys = [];
        for (var u = 0; u < numberCandidates.length; u++) {
            var numCand = numberCandidates[u], closestName = null, minD = 230;
            for (var n = 0; n < nameCandidates.length; n++) {
                var nc = nameCandidates[n];
                if (!nc.item.paired) {
                    var d = Math.sqrt(Math.pow(nc.x - numCand.x, 2) + Math.pow(nc.y - numCand.y, 2));
                    if (d < minD) { minD = d; closestName = nc; }
                }
            }
            if (closestName) {
                closestName.item.paired = true;
                jerseys.push({ x: (numCand.x + closestName.x) / 2, y: (numCand.y + closestName.y) / 2, num: [numCand], nom: [closestName] });
            } else {
                jerseys.push({ x: numCand.x, y: numCand.y, num: [numCand], nom: [] });
            }
        }
        for (var n2 = 0; n2 < nameCandidates.length; n2++) {
            if (!nameCandidates[n2].item.paired) { jerseys.push({ x: nameCandidates[n2].x, y: nameCandidates[n2].y, num: [], nom: [nameCandidates[n2]] }); }
        }
        jerseys.sort(function (a, b) { return (Math.abs(a.x - b.x) > 80) ? (a.x - b.x) : (b.y - a.y); });

        if (!targetFolder.exists) { targetFolder.create(); }

        var creados = 0;
        for (var row = 1; row < filasDataGlobal.length; row++) {
            var cdr = filasDataGlobal[row].split(separador);
            var pData = [];
            for (var cc = 0; cc < nP; cc++) {
                var nV = (columnas[cc] && columnas[cc].nom !== -1 ? (cdr[columnas[cc].nom] || "") : "").toString();
                var uV = (columnas[cc] && columnas[cc].num !== -1 ? (cdr[columnas[cc].num] || "") : "").toString();
                pData.push({ nom: nV.replace(/^\s+|\s+$/g, ''), num: uV.replace(/^\s+|\s+$/g, '') });
            }
            var piecesPerPerson = Math.floor(jerseys.length / nP) || 1;
            for (var j = 0; j < jerseys.length; j++) {
                var playerIdx = Math.floor(j / piecesPerPerson);
                var p = (pData.length > 0) ? pData[playerIdx % pData.length] : { nom: "", num: "" };
                var jr = jerseys[j];
                for (var a2 = 0; a2 < jr.nom.length; a2++) { jr.nom[a2].item.layer.locked = false; reubicarYCentrar(jr.nom[a2], p.nom); }
                for (var b2 = 0; b2 < jr.num.length; b2++) { jr.num[b2].item.layer.locked = false; reubicarYCentrar(jr.num[b2], p.num); }
            }
            // Para verlo en pantalla: se muestra el archivo con el nombre y número de este jugador antes de guardar su PDF
            try { doc.activate(); app.activeDocument = doc; app.executeMenuCommand("fitin"); app.redraw(); } catch (eVis) {}
            $.sleep(INDOOR_PAUSA_MS || 700);
            var rStr = (row < 10) ? ("0" + row) : row.toString();
            var fName = (INDOOR_PREFIJO || "") + nombreBase + "_" + rStr + ".pdf";
            var tempFile = new File(INDOOR_TMP + "/" + fName);
            if (tempFile.exists) { try { tempFile.remove(); } catch (eT) {} }
            var destFile = new File(decodeURI(targetFolder.fullName) + "/" + fName);
            try {
                doc.saveAs(tempFile, pdfOpt);
                if (tempFile.exists) {
                    tempFile.copy(destFile);
                    try { tempFile.remove(); } catch (eR) {}
                    creados++;
                }
            } catch (eSave) {
                log("Error al guardar " + fName + ": " + eSave);
            }
            // restaurar el texto original para la siguiente fila
            for (var j2 = 0; j2 < jerseys.length; j2++) {
                var jr2 = jerseys[j2];
                for (var a3 = 0; a3 < jr2.nom.length; a3++) { reubicarYCentrar(jr2.nom[a3], jr2.nom[a3].origContents); }
                for (var b3 = 0; b3 < jr2.num.length; b3++) { reubicarYCentrar(jr2.num[b3], jr2.num[b3].origContents); }
            }
        }
        return creados;
    }

    // --- 4) Recorrer los archivos: el maestro ya está abierto; los demás se abren y se cierran ---
    var relMontajes;
    for (var fIdx = 0; fIdx < filesToProcess.length; fIdx++) {
        var currentFile = filesToProcess[fIdx];
        var isDocA = (decodeURI(currentFile.fullName).toLowerCase() === decodeURI(maestroFile.fullName).toLowerCase());
        var currentDoc = isDocA ? docA : app.open(currentFile);
        relMontajes = getRelativePath(montajesFolder, currentFile.parent);
        var carpetaSalida = (relMontajes !== "") ? createFolderRecursive(salidaRaiz, relMontajes) : new Folder(salidaRaiz.fullName + "/" + sanitize(currentFile.parent.name));
        var nombreBase = currentFile.name.replace(/\.[^\.]+$/, '');
        var creados = procesarDocumento(currentDoc, carpetaSalida, nombreBase);
        INDOOR_RESULTADO.push({ archivo: currentFile.name, carpeta: decodeURI(carpetaSalida.fullName), pdf: creados });
        log("PDF creados de " + currentFile.name + ": " + creados + " en " + decodeURI(carpetaSalida.fullName));
        if (!isDocA) { try { currentDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {} }
    }

    try { docA.close(SaveOptions.DONOTSAVECHANGES); } catch (eCl) {}
    app.userInteractionLevel = originalInteraction;
})();
