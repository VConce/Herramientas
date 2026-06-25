import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
const { createWorker, PSM } = Tesseract;
const TOP_NAME_SEARCH_RATIO = 0.28;
const TOP_NAME_OCR_SCALE = 1.8;

const state = {
  file: null,
  bytes: null,
  pdf: null,
  totalPages: 0,
  ranges: [],
  previewPage: 1
};

const overlayDrag = {
  active: false,
  action: "move",
  startX: 0,
  startY: 0,
  startZone: null
};

const els = {
  pdfInput: document.getElementById("pdfInput"),
  dropZone: document.getElementById("dropZone"),
  fileInfo: document.getElementById("fileInfo"),
  markerPhrase: document.getElementById("markerPhrase"),
  extraKeywords: document.getElementById("extraKeywords"),
  keywordRequirement: document.getElementById("keywordRequirement"),
  manualStarts: document.getElementById("manualStarts"),
  detectButton: document.getElementById("detectButton"),
  clearButton: document.getElementById("clearButton"),
  anonymizeToggle: document.getElementById("anonymizeToggle"),
  codePrefix: document.getElementById("codePrefix"),
  applyMode: document.getElementById("applyMode"),
  nameSearchMode: document.getElementById("nameSearchMode"),
  zoneX: document.getElementById("zoneX"),
  zoneY: document.getElementById("zoneY"),
  zoneW: document.getElementById("zoneW"),
  zoneH: document.getElementById("zoneH"),
  findNamesButton: document.getElementById("findNamesButton"),
  renderPreviewButton: document.getElementById("renderPreviewButton"),
  previewCanvas: document.getElementById("previewCanvas"),
  zoneOverlay: document.getElementById("zoneOverlay"),
  rangesBody: document.getElementById("rangesBody"),
  zipButton: document.getElementById("zipButton"),
  progressText: document.getElementById("progressText"),
  progressPercent: document.getElementById("progressPercent"),
  progressBar: document.getElementById("progressBar"),
  logBox: document.getElementById("logBox")
};

function log(message, type = "info") {
  const marks = { info: "-", ok: "OK", warn: "AVISO", error: "ERROR" };
  els.logBox.textContent += `\n[${marks[type] || marks.info}] ${message}`;
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function formatError(error, fallback = "Error desconocido.") {
  if (typeof error === "string" && error.trim()) return error;
  if (error?.message) return error.message;
  if (error?.name) return error.name;
  const text = String(error || "").trim();
  return text && text !== "[object Object]" ? text : fallback;
}

function resetLog(message = "Listo. Carga un PDF para empezar.") {
  els.logBox.textContent = message;
}

function setProgress(value, message) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  els.progressBar.value = safe;
  els.progressPercent.textContent = `${safe}%`;
  els.progressText.textContent = message;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsFrom(value) {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length >= 3);
}

function parseKeywords(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,;]+/)
      .map(normalizeText)
      .filter((item) => item.length >= 2)
  )];
}

function parseManualStarts(value, totalPages) {
  const starts = String(value || "")
    .split(/[,\s;]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= totalPages);
  return [...new Set(starts)].sort((a, b) => a - b);
}

function phraseFound(pageText, markerPhrase) {
  const normalizedPage = normalizeText(pageText);
  const normalizedMarker = normalizeText(markerPhrase);
  if (!normalizedMarker) return false;
  if (normalizedPage.includes(normalizedMarker)) return true;

  const markerWords = [...new Set(wordsFrom(markerPhrase))];
  if (!markerWords.length) return false;
  const hits = markerWords.filter((word) => normalizedPage.includes(word)).length;
  const ratio = hits / markerWords.length;
  if (markerWords.length <= 2) return ratio === 1;
  if (markerWords.length <= 4) return ratio >= 0.75;
  return ratio >= 0.65;
}

function keywordCheck(pageText, keywords) {
  const normalizedPage = normalizeText(pageText);
  const hits = keywords.filter((keyword) => normalizedPage.includes(keyword));
  const requirement = els.keywordRequirement.value;
  if (requirement === "0" || !keywords.length) return { ok: true, hits, needed: 0 };
  const needed = requirement === "all" ? keywords.length : Math.min(Number(requirement), keywords.length);
  return { ok: hits.length >= needed, hits, needed };
}

function isCoverPage(pageText, markerPhrase, keywords) {
  const phrase = phraseFound(pageText, markerPhrase);
  const keys = keywordCheck(pageText, keywords);
  return {
    ok: phrase && keys.ok,
    phrase,
    hits: keys.hits,
    needed: keys.needed
  };
}

function buildRanges(startPages, totalPages) {
  return startPages.map((start, index) => ({
    start,
    end: index + 1 < startPages.length ? startPages[index + 1] - 1 : totalPages,
    name: "",
    code: `${els.codePrefix.value || "COD"}${String(index + 1).padStart(3, "0")}`,
    nameZones: []
  }));
}

function getZone() {
  const zone = {
    x: clampNumber(els.zoneX.value, 0, 99),
    y: clampNumber(els.zoneY.value, 0, 99),
    w: clampNumber(els.zoneW.value, 1, 100),
    h: clampNumber(els.zoneH.value, 1, 100)
  };
  zone.w = Math.min(zone.w, 100 - zone.x);
  zone.h = Math.min(zone.h, 100 - zone.y);
  return zone;
}

function setZoneInputs(zone) {
  const safe = {
    x: clampNumber(zone.x, 0, 99),
    y: clampNumber(zone.y, 0, 99),
    w: clampNumber(zone.w, 1, 100),
    h: clampNumber(zone.h, 1, 100)
  };
  safe.w = Math.min(safe.w, 100 - safe.x);
  safe.h = Math.min(safe.h, 100 - safe.y);
  els.zoneX.value = formatZoneNumber(safe.x);
  els.zoneY.value = formatZoneNumber(safe.y);
  els.zoneW.value = formatZoneNumber(safe.w);
  els.zoneH.value = formatZoneNumber(safe.h);
  updateOverlay();
}

function formatZoneNumber(value) {
  return String(Math.round(value * 10) / 10);
}

function clampNumber(value, min, max) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function updateButtons() {
  els.detectButton.disabled = !state.bytes;
  els.renderPreviewButton.disabled = !state.pdf;
  els.findNamesButton.disabled = !state.pdf || !state.ranges.length;
  els.zipButton.disabled = !state.bytes || state.ranges.length === 0;
}

async function readPdfFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Selecciona un archivo PDF.");
    return;
  }

  try {
    setProgress(5, "Leyendo archivo...");
    resetLog("Leyendo PDF...");
    state.file = file;
    state.bytes = new Uint8Array(await file.arrayBuffer());

    setProgress(35, "Abriendo PDF...");
    state.pdf = await pdfjsLib.getDocument({ data: state.bytes.slice() }).promise;
    state.totalPages = state.pdf.numPages;
    state.ranges = [];

    els.fileInfo.textContent = `${file.name} - ${(file.size / 1024 / 1024).toFixed(2)} MB - ${state.totalPages} paginas`;
    log(`PDF cargado. Paginas detectadas: ${state.totalPages}`, "ok");
    setProgress(100, "PDF cargado.");
    renderRanges();
    updateButtons();

    try {
      await renderPreview(1);
    } catch (previewError) {
      console.warn(previewError);
      log("El PDF se ha cargado, pero no se pudo generar la vista previa inicial. Puedes continuar con la deteccion.", "warn");
    }
  } catch (error) {
    console.error(error);
    state.file = null;
    state.bytes = null;
    state.pdf = null;
    state.totalPages = 0;
    state.ranges = [];
    els.fileInfo.textContent = "No se pudo cargar el PDF.";
    setProgress(0, "Error al cargar PDF.");
    log(error.message || "No se pudo abrir el PDF.", "error");
    alert(error.message || "No se pudo abrir el PDF.");
    updateButtons();
  }
}

async function renderPage(pageNumber, scale = 1.6) {
  const page = await state.pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

async function renderPreview(pageNumber = state.previewPage) {
  if (!state.pdf) return;
  state.previewPage = pageNumber;
  const canvas = await renderPage(pageNumber, 1.15);
  const context = els.previewCanvas.getContext("2d");
  els.previewCanvas.width = canvas.width;
  els.previewCanvas.height = canvas.height;
  context.drawImage(canvas, 0, 0);
  updateOverlay();
}

function updateOverlay() {
  const zone = getZone();
  const canvas = els.previewCanvas;
  if (!canvas.width || !canvas.height) return;
  els.zoneOverlay.style.display = "block";
  els.zoneOverlay.style.left = `${zone.x}%`;
  els.zoneOverlay.style.top = `${zone.y}%`;
  els.zoneOverlay.style.width = `${zone.w}%`;
  els.zoneOverlay.style.height = `${zone.h}%`;
}

function overlayActionFromPointer(event) {
  const rect = els.zoneOverlay.getBoundingClientRect();
  const edge = 10;
  const nearLeft = event.clientX - rect.left <= edge;
  const nearRight = rect.right - event.clientX <= edge;
  const nearTop = event.clientY - rect.top <= edge;
  const nearBottom = rect.bottom - event.clientY <= edge;
  const x = nearLeft ? "left" : nearRight ? "right" : "";
  const y = nearTop ? "top" : nearBottom ? "bottom" : "";
  return x || y ? `${y}${x}` : "move";
}

function updateOverlayCursor(event) {
  if (overlayDrag.active) return;
  const action = overlayActionFromPointer(event);
  const cursors = {
    top: "ns-resize",
    bottom: "ns-resize",
    left: "ew-resize",
    right: "ew-resize",
    topleft: "nwse-resize",
    bottomright: "nwse-resize",
    topright: "nesw-resize",
    bottomleft: "nesw-resize",
    move: "move"
  };
  els.zoneOverlay.style.cursor = cursors[action] || "move";
}

function beginOverlayDrag(event) {
  if (!els.previewCanvas.width || !els.previewCanvas.height) return;
  event.preventDefault();
  overlayDrag.active = true;
  overlayDrag.action = overlayActionFromPointer(event);
  overlayDrag.startX = event.clientX;
  overlayDrag.startY = event.clientY;
  overlayDrag.startZone = getZone();
  els.zoneOverlay.setPointerCapture?.(event.pointerId);
}

function moveOverlayDrag(event) {
  if (!overlayDrag.active || !overlayDrag.startZone) return;
  event.preventDefault();

  const rect = els.previewCanvas.getBoundingClientRect();
  const dx = ((event.clientX - overlayDrag.startX) / rect.width) * 100;
  const dy = ((event.clientY - overlayDrag.startY) / rect.height) * 100;
  const next = { ...overlayDrag.startZone };
  const minSize = 1;

  if (overlayDrag.action === "move") {
    next.x = overlayDrag.startZone.x + dx;
    next.y = overlayDrag.startZone.y + dy;
  } else {
    if (overlayDrag.action.includes("left")) {
      next.x = overlayDrag.startZone.x + dx;
      next.w = overlayDrag.startZone.w - dx;
    }
    if (overlayDrag.action.includes("right")) {
      next.w = overlayDrag.startZone.w + dx;
    }
    if (overlayDrag.action.includes("top")) {
      next.y = overlayDrag.startZone.y + dy;
      next.h = overlayDrag.startZone.h - dy;
    }
    if (overlayDrag.action.includes("bottom")) {
      next.h = overlayDrag.startZone.h + dy;
    }
  }

  if (next.w < minSize) {
    if (overlayDrag.action.includes("left")) next.x -= minSize - next.w;
    next.w = minSize;
  }
  if (next.h < minSize) {
    if (overlayDrag.action.includes("top")) next.y -= minSize - next.h;
    next.h = minSize;
  }

  next.x = Math.max(0, Math.min(100 - next.w, next.x));
  next.y = Math.max(0, Math.min(100 - next.h, next.y));
  next.w = Math.min(next.w, 100 - next.x);
  next.h = Math.min(next.h, 100 - next.y);
  setZoneInputs(next);
}

function endOverlayDrag(event) {
  if (!overlayDrag.active) return;
  overlayDrag.active = false;
  overlayDrag.startZone = null;
  els.zoneOverlay.releasePointerCapture?.(event.pointerId);
}

async function createOcrWorker() {
  return createWorker("spa+eng", 1, {
    workerPath: "./vendor/tesseract/worker.min.js",
    corePath: "./vendor/tesseract-core",
    langPath: "./vendor/tessdata",
    workerBlobURL: false,
    gzip: true,
    logger: (message) => {
      if (message.status === "recognizing text") {
        const pct = Math.round((message.progress || 0) * 100);
        els.progressText.textContent = `OCR de pagina en curso (${pct}%)`;
      }
    }
  });
}

async function ocrCanvas(worker, canvas) {
  return worker.recognize(canvas);
}

async function ocrText(worker, canvas) {
  const result = await ocrCanvas(worker, canvas);
  return result?.data?.text || "";
}

function cropCanvasByZone(sourceCanvas, zone) {
  const x = Math.round((zone.x / 100) * sourceCanvas.width);
  const y = Math.round((zone.y / 100) * sourceCanvas.height);
  const width = Math.max(1, Math.round((zone.w / 100) * sourceCanvas.width));
  const height = Math.max(1, Math.round((zone.h / 100) * sourceCanvas.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return canvas;
}

function makeTopNameOcrCanvas(sourceCanvas) {
  const sourceHeight = Math.max(1, Math.round(sourceCanvas.height * TOP_NAME_SEARCH_RATIO));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * TOP_NAME_OCR_SCALE));
  canvas.height = Math.max(1, Math.round(sourceHeight * TOP_NAME_OCR_SCALE));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceHeight, 0, 0, canvas.width, canvas.height);
  enhanceCanvasForOcr(canvas);
  return canvas;
}

function enhanceCanvasForOcr(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    const value = luma > 238 ? 255 : Math.max(0, Math.round((luma - 18) * 0.78));
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function manualNameZone(pageNumber) {
  return {
    page: pageNumber,
    zone: getZone(),
    text: "",
    source: "manual",
    confidence: 0
  };
}

function findNameZoneFromOcr(result, pageNumber, canvas) {
  const words = extractOcrWords(result);
  if (!words.length) return null;

  const labels = words.filter((word) => isNameLabel(word.text));
  if (!labels.length) return null;

  const orderedLabels = labels.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  for (const label of orderedLabels) {
    const lineHeight = Math.max(18, label.bbox.y1 - label.bbox.y0);
    const sameLine = words.filter((word) => {
      const center = (word.bbox.y0 + word.bbox.y1) / 2;
      return word !== label &&
        word.bbox.x0 > label.bbox.x1 - 4 &&
        center >= label.bbox.y0 - lineHeight * 0.9 &&
        center <= label.bbox.y1 + lineHeight * 0.9;
    });

    const belowLine = words.filter((word) => {
      const center = (word.bbox.y0 + word.bbox.y1) / 2;
      return word !== label &&
        word.bbox.x0 >= Math.max(0, label.bbox.x0 - canvas.width * 0.04) &&
        center > label.bbox.y1 &&
        center <= label.bbox.y1 + lineHeight * 3.2;
    });

    const candidates = sameLine.length ? sameLine : belowLine;
    const candidateText = cleanName(candidates.map((word) => word.text).join(" "));
    const box = candidates.length
      ? paddedWordBox(candidates, canvas, lineHeight)
      : fallbackBoxFromLabel(label, canvas, lineHeight);

    if (!box) continue;
    return {
      page: pageNumber,
      zone: boxToPercentZone(box, canvas),
      text: candidateText,
      source: candidates.length ? "ocr-name" : "ocr-label",
      confidence: candidates.length ? 0.82 : 0.55
    };
  }

  return null;
}

function findTopDuplicateNameZone(result, pageNumber, canvas, referenceName, topRatio = TOP_NAME_SEARCH_RATIO) {
  const reference = normalizeNameForMatch(referenceName);
  if (reference.length < 4) return null;

  const words = extractOcrWords(result)
    .filter((word) => {
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      return centerY <= canvas.height * topRatio;
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  if (!words.length) return null;

  const candidates = buildTopNameCandidates(words, canvas);
  let best = null;

  candidates.forEach((candidate) => {
    const text = cleanName(candidate.words.map((word) => word.text).join(" "));
    const normalized = normalizeNameForMatch(text);
    if (normalized.length < 3) return;
    const score = similarityScore(reference, normalized);
    if (!best || score > best.score) {
      best = { ...candidate, text, score };
    }
  });

  if (!best || best.score < 0.5) return null;

  const lineHeight = Math.max(18, ...best.words.map((word) => word.bbox.y1 - word.bbox.y0));
  return {
    page: pageNumber,
    zone: boxToPercentZone(paddedWordBox(best.words, canvas, lineHeight), canvas),
    text: best.text,
    source: "ocr-duplicate-top",
    confidence: best.score
  };
}

async function findTopDuplicateNameZoneFromCrop(worker, pageNumber, pageCanvas, referenceName) {
  const topCanvas = makeTopNameOcrCanvas(pageCanvas);
  const sparseMode = PSM.SPARSE_TEXT ?? PSM.AUTO;
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: sparseMode,
      preserve_interword_spaces: "1"
    });
    const result = await ocrCanvas(worker, topCanvas);
    const detected = findTopDuplicateNameZone(result, pageNumber, topCanvas, referenceName, 1);
    if (!detected) return null;
    return {
      ...detected,
      zone: remapTopCropZone(detected.zone)
    };
  } finally {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1"
    });
  }
}

function remapTopCropZone(zone) {
  return {
    x: zone.x,
    y: zone.y * TOP_NAME_SEARCH_RATIO,
    w: zone.w,
    h: zone.h * TOP_NAME_SEARCH_RATIO
  };
}

function buildTopNameCandidates(words, canvas) {
  const lines = [];
  words.forEach((word) => {
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    const line = lines.find((item) => Math.abs(item.centerY - centerY) < canvas.height * 0.018);
    if (line) {
      line.words.push(word);
      line.centerY = (line.centerY + centerY) / 2;
    } else {
      lines.push({ centerY, words: [word] });
    }
  });

  const candidates = [];
  lines.forEach((line) => {
    const sorted = line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    for (let start = 0; start < sorted.length; start += 1) {
      for (let length = 1; length <= 5 && start + length <= sorted.length; length += 1) {
        const group = sorted.slice(start, start + length);
        const gapOk = group.every((word, index) => {
          if (index === 0) return true;
          const prev = group[index - 1];
          return word.bbox.x0 - prev.bbox.x1 <= canvas.width * 0.12;
        });
        if (gapOk) candidates.push({ words: group });
      }
    }
  });
  return candidates;
}

function normalizeNameForMatch(value) {
  return normalizeText(value)
    .replace(/\b(nombre|apellido|apellidos|alumno|alumna)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(reference, candidate) {
  const refCompact = reference.replace(/\s+/g, "");
  const candCompact = candidate.replace(/\s+/g, "");
  if (!refCompact || !candCompact) return 0;

  const distance = levenshteinDistance(refCompact, candCompact);
  const charScore = 1 - distance / Math.max(refCompact.length, candCompact.length);
  const refTokens = new Set(reference.split(" ").filter(Boolean));
  const candTokens = new Set(candidate.split(" ").filter(Boolean));
  const tokenHits = [...refTokens].filter((token) => {
    return candTokens.has(token) || [...candTokens].some((candidateToken) => {
      return token.length >= 4 && candidateToken.length >= 4 && (
        candidateToken.includes(token.slice(0, 4)) ||
        token.includes(candidateToken.slice(0, 4))
      );
    });
  }).length;
  const tokenScore = refTokens.size ? tokenHits / refTokens.size : 0;
  return Math.max(charScore, tokenScore * 0.9);
}

function levenshteinDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function extractOcrWords(result) {
  const rawWords = result?.data?.words || [];
  return rawWords
    .map((word) => ({
      text: String(word.text || "").trim(),
      bbox: normalizeBbox(word.bbox)
    }))
    .filter((word) => word.text && word.bbox);
}

function normalizeBbox(bbox) {
  if (!bbox) return null;
  const x0 = Number(bbox.x0 ?? bbox.left);
  const y0 = Number(bbox.y0 ?? bbox.top);
  const x1 = Number(bbox.x1 ?? (bbox.left + bbox.width));
  const y1 = Number(bbox.y1 ?? (bbox.top + bbox.height));
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return { x0, y0, x1, y1 };
}

function isNameLabel(value) {
  const text = normalizeText(value);
  return text === "nombre" ||
    text === "nombres" ||
    text === "apellido" ||
    text === "apellidos" ||
    text === "alumno" ||
    text === "alumna";
}

function paddedWordBox(words, canvas, lineHeight) {
  const x0 = Math.max(0, Math.min(...words.map((word) => word.bbox.x0)) - canvas.width * 0.015);
  const y0 = Math.max(0, Math.min(...words.map((word) => word.bbox.y0)) - lineHeight * 0.65);
  const x1 = Math.min(canvas.width, Math.max(...words.map((word) => word.bbox.x1)) + canvas.width * 0.08);
  const y1 = Math.min(canvas.height, Math.max(...words.map((word) => word.bbox.y1)) + lineHeight * 0.85);
  return { x0, y0, x1, y1 };
}

function fallbackBoxFromLabel(label, canvas, lineHeight) {
  const x0 = Math.min(canvas.width - 1, label.bbox.x1 + canvas.width * 0.015);
  const y0 = Math.max(0, label.bbox.y0 - lineHeight * 0.65);
  const x1 = Math.min(canvas.width, Math.max(x0 + canvas.width * 0.28, canvas.width * 0.92));
  const y1 = Math.min(canvas.height, label.bbox.y1 + lineHeight * 1.1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function boxToPercentZone(box, canvas) {
  return {
    x: (box.x0 / canvas.width) * 100,
    y: (box.y0 / canvas.height) * 100,
    w: ((box.x1 - box.x0) / canvas.width) * 100,
    h: ((box.y1 - box.y0) / canvas.height) * 100
  };
}

async function detectExams() {
  if (!state.pdf) return;
  els.detectButton.disabled = true;
  els.zipButton.disabled = true;
  setProgress(2, "Preparando deteccion...");
  resetLog("Detectando portadas...");

  const manualStarts = parseManualStarts(els.manualStarts.value, state.totalPages);
  if (manualStarts.length) {
    state.ranges = buildRanges(manualStarts, state.totalPages);
    log(`Usadas portadas manuales: ${manualStarts.join(", ")}`, "ok");
    await fillNamesIfNeeded();
    renderRanges();
    setProgress(100, "Revision lista.");
    updateButtons();
    return;
  }

  const marker = els.markerPhrase.value.trim();
  if (!marker) {
    alert("Escribe una frase distintiva o usa portadas manuales.");
    updateButtons();
    return;
  }

  const starts = [];
  const keywords = parseKeywords(els.extraKeywords.value);
  let worker = null;

  try {
    worker = await createOcrWorker();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1"
    });

    for (let pageNumber = 1; pageNumber <= state.totalPages; pageNumber += 1) {
      setProgress(5 + ((pageNumber - 1) / state.totalPages) * 70, `OCR pagina ${pageNumber} de ${state.totalPages}`);
      const canvas = await renderPage(pageNumber, 1.55);
      const text = await ocrText(worker, canvas);
      const cover = isCoverPage(text, marker, keywords);

      if (cover.ok) {
        starts.push(pageNumber);
        log(`Portada detectada en pagina ${pageNumber}. Claves: ${cover.hits.join(", ") || "sin claves requeridas"}.`, "ok");
      } else if (cover.phrase) {
        log(`Pagina ${pageNumber}: aparece la frase, pero faltan palabras clave (${cover.hits.length}/${cover.needed}).`, "warn");
      }
    }

    const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
    if (!uniqueStarts.length) {
      throw new Error("No se detecto ninguna portada. Prueba con portadas manuales o relaja las palabras clave.");
    }

    if (uniqueStarts[0] !== 1) {
      log("La primera portada detectada no esta en la pagina 1. Se ignoraran paginas anteriores.", "warn");
    }

    state.ranges = buildRanges(uniqueStarts, state.totalPages);
    await fillNamesIfNeeded(worker);
    renderRanges();
    setProgress(100, "Revision lista.");
  } catch (error) {
    console.error(error);
    setProgress(0, "Error de deteccion.");
    const message = formatError(error, "Error durante el OCR.");
    log(message, "error");
    alert(message);
  } finally {
    if (worker) await worker.terminate();
    updateButtons();
  }
}

async function fillNamesIfNeeded(existingWorker = null, force = false) {
  if ((!force && !els.anonymizeToggle.checked) || !state.ranges.length) return;
  let worker = existingWorker;
  let shouldTerminate = false;
  const mode = els.nameSearchMode.value;

  try {
    if (!worker && mode !== "manual") {
      worker = await createOcrWorker();
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1"
      });
      shouldTerminate = true;
    }

    for (let index = 0; index < state.ranges.length; index += 1) {
      const range = state.ranges[index];
      range.nameZones = [];
      const pages = pagesForNameSearch(range);

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const pageNumber = pages[pageIndex];
        const isFirstPage = pageNumber === range.start;
        setProgress(
          76 + ((index + pageIndex / pages.length) / state.ranges.length) * 12,
          `Buscando nombre ${index + 1} de ${state.ranges.length}, pagina ${pageNumber}`
        );

        let detected = null;
        if (mode !== "manual") {
          const pageCanvas = await renderPage(pageNumber, 2.05);
          const result = await ocrCanvas(worker, pageCanvas);
          detected = isFirstPage
            ? findNameZoneFromOcr(result, pageNumber, pageCanvas)
            : findTopDuplicateNameZone(result, pageNumber, pageCanvas, range.name);
          if (!detected && !isFirstPage) {
            detected = await findTopDuplicateNameZoneFromCrop(worker, pageNumber, pageCanvas, range.name);
          }
        }

        if (!detected && (mode === "manual" || (mode === "autoFallback" && isFirstPage))) {
          detected = manualNameZone(pageNumber);
        }

        if (detected) {
          range.nameZones.push(detected);
          if (!range.name && detected.text) range.name = detected.text;
          const kind = detected.source === "ocr-duplicate-top" ? "duplicado superior" : detected.source;
          log(`Nombre ${index + 1}: zona ${kind} en pagina ${pageNumber}${detected.text ? ` (${detected.text})` : ""}.`, detected.source === "manual" ? "warn" : "ok");
        } else {
          const message = isFirstPage
            ? `Nombre ${index + 1}: no se encontro etiqueta Nombre en pagina ${pageNumber}.`
            : `Nombre ${index + 1}: no se encontraron duplicados en la zona alta de la pagina ${pageNumber}.`;
          log(message, "warn");
        }
      }

      if (!range.name) {
        range.name = `Alumno ${String(index + 1).padStart(2, "0")}`;
      }
    }
  } finally {
    if (shouldTerminate && worker) await worker.terminate();
  }
}

function pagesForNameSearch(range) {
  if (els.applyMode.value !== "all") return [range.start];
  const pages = [];
  for (let page = range.start; page <= range.end; page += 1) pages.push(page);
  return pages;
}

function cleanName(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return lines[0]
    .replace(/^nombre\s*[:.-]?\s*/i, "")
    .replace(/[^\p{L}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderRanges() {
  if (!state.ranges.length) {
    els.rangesBody.innerHTML = '<tr><td colspan="4">Carga un PDF y detecta los examenes.</td></tr>';
    return;
  }

  els.rangesBody.innerHTML = "";
  state.ranges.forEach((range, index) => {
    const row = document.createElement("tr");
    const zoneStatus = nameZoneStatus(range);
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${range.start}-${range.end}</td>
      <td>
        <input data-field="name" data-index="${index}" type="text" value="${escapeHtml(range.name || "")}" placeholder="Alumno ${String(index + 1).padStart(2, "0")}">
        <div class="cell-note">${escapeHtml(zoneStatus)}</div>
      </td>
      <td><input data-field="code" data-index="${index}" type="text" value="${escapeHtml(range.code)}"></td>
    `;
    els.rangesBody.appendChild(row);
  });
}

function nameZoneStatus(range) {
  if (!range.nameZones || !range.nameZones.length) return "Sin zona de nombre localizada.";
  const manual = range.nameZones.filter((zone) => zone.source === "manual").length;
  const duplicates = range.nameZones.filter((zone) => zone.source === "ocr-duplicate-top").length;
  const ocr = range.nameZones.length - manual - duplicates;
  const pages = range.nameZones.map((zone) => zone.page).join(", ");
  const parts = [];
  if (ocr) parts.push(`${ocr} OCR`);
  if (duplicates) parts.push(`${duplicates} duplicado${duplicates === 1 ? "" : "s"} arriba`);
  if (manual) parts.push(`${manual} manual`);
  if (parts.length > 1) return `Zonas: ${parts.join(", ")}. Paginas ${pages}.`;
  if (manual) return `Zona manual. Paginas ${pages}.`;
  if (duplicates && !ocr) return `Duplicado arriba. Paginas ${pages}.`;
  return `Zona OCR. Paginas ${pages}.`;
}

function syncRangesFromTable() {
  els.rangesBody.querySelectorAll("input[data-index]").forEach((input) => {
    const index = Number.parseInt(input.dataset.index, 10);
    const field = input.dataset.field;
    if (state.ranges[index] && (field === "name" || field === "code")) {
      state.ranges[index][field] = input.value.trim();
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function generateZip() {
  if (!state.bytes || !state.ranges.length) return;
  syncRangesFromTable();
  els.zipButton.disabled = true;
  els.detectButton.disabled = true;
  setProgress(0, "Generando PDFs...");
  log("Generando ZIP...");

  try {
    if (els.anonymizeToggle.checked) {
      const missingZones = state.ranges.some((range) => !range.nameZones || !range.nameZones.length);
      if (missingZones) {
        log("Faltan zonas de nombre. Buscando antes de generar el ZIP...", "warn");
        await fillNamesIfNeeded();
        renderRanges();
      }
    }

    const sourcePdf = await PDFDocument.load(state.bytes);
    const zip = new SimpleZip();
    const anonymize = els.anonymizeToggle.checked;

    for (let index = 0; index < state.ranges.length; index += 1) {
      const range = state.ranges[index];
      const outputPdf = await PDFDocument.create();
      const pageIndexes = [];
      for (let page = range.start; page <= range.end; page += 1) pageIndexes.push(page - 1);
      const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndexes);
      copiedPages.forEach((page) => outputPdf.addPage(page));

      if (anonymize) {
        await anonymizePdf(outputPdf, range, range.code || fallbackCode(index));
      }

      const pdfBytes = await outputPdf.save();
      zip.addFile(`Alumno${String(index + 1).padStart(2, "0")}.pdf`, pdfBytes);
      setProgress(8 + ((index + 1) / state.ranges.length) * 72, `Creado PDF ${index + 1} de ${state.ranges.length}`);
    }

    if (anonymize) {
      zip.addFile("correspondencias.xlsx", makeXlsx(state.ranges));
      zip.addFile("correspondencias.csv", makeCsv(state.ranges));
      zip.addFile("correspondencias.txt", makeTxt(state.ranges));
    }

    setProgress(88, "Comprimiendo ZIP...");
    const blob = zip.toBlob();
    downloadBlob(blob, anonymize ? "Examenes_anonimizados.zip" : "Examenes_separados.zip");
    setProgress(100, "ZIP generado.");
    log("ZIP generado correctamente.", "ok");
  } catch (error) {
    console.error(error);
    setProgress(0, "Error al generar ZIP.");
    const message = formatError(error, "No se pudo generar el ZIP.");
    log(message, "error");
    alert(message);
  } finally {
    updateButtons();
  }
}

async function anonymizePdf(pdfDoc, range, code) {
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const detections = Array.isArray(range.nameZones) ? range.nameZones : [];
  const firstPage = pages[0];
  const firstDetection = detections.find((detection) => detection.page === range.start);
  const firstZone = firstDetection?.zone || getZone();

  if (firstPage) {
    drawAnonymizeZone(firstPage, firstZone, code, font, true);
  }

  if (els.applyMode.value !== "all") return;

  for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const sourcePage = range.start + pageIndex;
    detections
      .filter((detection) => detection.page === sourcePage)
      .forEach((detection) => drawAnonymizeZone(page, detection.zone, code, font, false));
    drawTopCode(page, code, font);
  }
}

function drawAnonymizeZone(page, zone, code, font, drawCode = true) {
  const { width, height } = page.getSize();
  const rectW = (zone.w / 100) * width;
  const rectH = (zone.h / 100) * height;
  const x = (zone.x / 100) * width;
  const y = height - ((zone.y / 100) * height) - rectH;
  const fontSize = Math.max(10, Math.min(18, rectH * 0.36));

  page.drawRectangle({
    x,
    y,
    width: rectW,
    height: rectH,
    color: rgb(1, 1, 1),
    borderColor: rgb(1, 1, 1),
    borderWidth: 1
  });

  if (!drawCode) return;

  page.drawText(code, {
    x: x + Math.max(6, rectW * 0.04),
    y: y + (rectH - fontSize) / 2,
    size: fontSize,
    font,
    color: rgb(0, 0, 0)
  });
}

function drawTopCode(page, code, font) {
  const { width, height } = page.getSize();
  const fontSize = 10;
  const textWidth = font.widthOfTextAtSize(code, fontSize);
  const x = Math.max(2, width * 0.01);
  const y = height - fontSize - 2;

  page.drawRectangle({
    x: Math.max(0, x - 2),
    y: Math.max(0, y - 1),
    width: textWidth + 4,
    height: fontSize + 3,
    color: rgb(1, 1, 1)
  });

  page.drawText(code, {
    x,
    y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0)
  });
}

function fallbackCode(index) {
  return `${els.codePrefix.value || "COD"}${String(index + 1).padStart(3, "0")}`;
}

function makeCsv(ranges) {
  const rows = [["nombre_aproximado", "codigo", "archivo", "paginas"]];
  ranges.forEach((range, index) => {
    rows.push([
      range.name || `Alumno ${String(index + 1).padStart(2, "0")}`,
      range.code || fallbackCode(index),
      `Alumno${String(index + 1).padStart(2, "0")}.pdf`,
      `${range.start}-${range.end}`
    ]);
  });
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

function makeTxt(ranges) {
  return ranges.map((range, index) => {
    const file = `Alumno${String(index + 1).padStart(2, "0")}.pdf`;
    const name = range.name || `Alumno ${String(index + 1).padStart(2, "0")}`;
    return `${name} | ${range.code || fallbackCode(index)} | ${file} | paginas ${range.start}-${range.end}`;
  }).join("\r\n");
}

function makeXlsx(ranges) {
  const rows = [["Nombre aproximado", "Codigo", "Archivo", "Paginas"]];
  ranges.forEach((range, index) => {
    rows.push([
      range.name || `Alumno ${String(index + 1).padStart(2, "0")}`,
      range.code || fallbackCode(index),
      `Alumno${String(index + 1).padStart(2, "0")}.pdf`,
      `${range.start}-${range.end}`
    ]);
  });

  const workbook = new SimpleZip();
  workbook.addFile("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  workbook.addFile("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  workbook.addFile("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Correspondencias" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  workbook.addFile("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  workbook.addFile("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`);
  workbook.addFile("xl/worksheets/sheet1.xml", makeWorksheetXml(rows));
  return workbook.toUint8Array();
}

function makeWorksheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowNumber}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="32" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="4" width="12" customWidth="1"/>
  </cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class SimpleZip {
  constructor() {
    this.files = [];
  }

  addFile(name, data) {
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    this.files.push({ name, bytes });
  }

  toUint8Array() {
    const chunks = [];
    const central = [];
    let offset = 0;

    this.files.forEach((file) => {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = crc32(file.bytes);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      writeLocalHeader(localView, nameBytes, crc, file.bytes.length);
      local.set(nameBytes, 30);
      chunks.push(local, file.bytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      writeCentralHeader(centralView, nameBytes, crc, file.bytes.length, offset);
      centralHeader.set(nameBytes, 46);
      central.push(centralHeader);
      offset += local.length + file.bytes.length;
    });

    const centralOffset = offset;
    central.forEach((header) => {
      chunks.push(header);
      offset += header.length;
    });

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, this.files.length, true);
    endView.setUint16(10, this.files.length, true);
    endView.setUint32(12, offset - centralOffset, true);
    endView.setUint32(16, centralOffset, true);
    chunks.push(end);

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let cursor = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, cursor);
      cursor += chunk.length;
    });
    return output;
  }

  toBlob() {
    return new Blob([this.toUint8Array()], { type: "application/zip" });
  }
}

function writeLocalHeader(view, nameBytes, crc, size) {
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime(), true);
  view.setUint16(12, dosDate(), true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
}

function writeCentralHeader(view, nameBytes, crc, size, offset) {
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime(), true);
  view.setUint16(14, dosDate(), true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
}

function dosTime(date = new Date()) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date = new Date()) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function crc32(bytes) {
  let crc = -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

els.pdfInput.addEventListener("change", () => readPdfFile(els.pdfInput.files[0]));
els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragover");
});
els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragover"));
els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragover");
  readPdfFile(event.dataTransfer.files[0]);
});
els.detectButton.addEventListener("click", detectExams);
els.zipButton.addEventListener("click", generateZip);
els.findNamesButton.addEventListener("click", async () => {
  if (!state.ranges.length) return;
  els.findNamesButton.disabled = true;
  try {
    resetLog("Buscando nombres...");
    await fillNamesIfNeeded(null, true);
    renderRanges();
    setProgress(100, "Nombres revisados.");
  } catch (error) {
    console.error(error);
    setProgress(0, "Error al buscar nombres.");
    const message = formatError(error, "No se pudieron buscar los nombres.");
    log(message, "error");
    alert(message);
  } finally {
    updateButtons();
  }
});
els.renderPreviewButton.addEventListener("click", () => renderPreview());
els.clearButton.addEventListener("click", () => {
  state.file = null;
  state.bytes = null;
  state.pdf = null;
  state.totalPages = 0;
  state.ranges = [];
  els.pdfInput.value = "";
  els.fileInfo.textContent = "Ningun archivo cargado.";
  els.previewCanvas.width = 0;
  els.previewCanvas.height = 0;
  els.zoneOverlay.style.display = "none";
  setProgress(0, "Listo.");
  resetLog();
  renderRanges();
  updateButtons();
});

[els.zoneX, els.zoneY, els.zoneW, els.zoneH].forEach((input) => {
  input.addEventListener("input", updateOverlay);
});

els.zoneOverlay.addEventListener("pointerdown", beginOverlayDrag);
els.zoneOverlay.addEventListener("pointermove", (event) => {
  updateOverlayCursor(event);
  moveOverlayDrag(event);
});
els.zoneOverlay.addEventListener("pointerup", endOverlayDrag);
els.zoneOverlay.addEventListener("pointercancel", endOverlayDrag);

els.codePrefix.addEventListener("input", () => {
  state.ranges.forEach((range, index) => {
    range.code = fallbackCode(index);
  });
  renderRanges();
});

if (window.location.protocol === "file:") {
  els.fileInfo.textContent = "Abre la aplicacion con Iniciar_App.bat para cargar PDFs correctamente.";
  log("La aplicacion se ha abierto como archivo local. Usa Iniciar_App.bat para que PDF y OCR funcionen bien.", "warn");
}

log("Motor OCR local preparado.", "ok");
document.documentElement.dataset.appReady = "true";

updateButtons();
