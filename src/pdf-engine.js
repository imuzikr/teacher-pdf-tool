import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export const uid = () => crypto.randomUUID();
export const normalizeRotation = (value) => ((value % 360) + 360) % 360;

export async function loadSource(bytes, name, pdfjs) {
  const data = new Uint8Array(bytes);
  const document = await pdfjs.getDocument({
    data: data.slice(),
    isEvalSupported: false,
  }).promise;
  // PDF.js 5.4 shares PagesMapper across open documents. Loading a shorter
  // document shrinks its global page limit; restore it before each request.
  // Check against this document's own count so a larger shared limit never
  // makes out-of-range requests valid.
  if (pdfjs.PagesMapper) {
    const getPage = document.getPage.bind(document);
    document.getPage = (number) => {
      if (!Number.isInteger(number) || number < 1 || number > document.numPages)
        return Promise.reject(new Error("Invalid page request."));
      const mapper = pdfjs.PagesMapper.instance;
      mapper.pagesNumber = Math.max(mapper.pagesNumber, document.numPages);
      return getPage(number);
    };
  }
  return { id: uid(), name, bytes: data, document };
}

export async function sourcePages(source) {
  const pages = [];
  for (let index = 0; index < source.document.numPages; index++) {
    const pdfPage = await source.document.getPage(index + 1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    pages.push({
      id: uid(),
      source,
      index,
      rotation: 0,
      baseRotation: pdfPage.rotate,
      width: viewport.width,
      height: viewport.height,
      annotations: [],
    });
  }
  return pages;
}

export function toBasePoint(x, y, rotation) {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

export function rotatedSize(page) {
  return normalizeRotation(page.rotation) % 180
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

// Copy the visible region, including across pages with different quarter-turns.
export function applyRedaction(pages, reference, annotation, targetIds) {
  const displayPoint = (x, y) => {
    const rotation = normalizeRotation(reference.rotation);
    if (rotation === 90) return { x: 1 - y, y: x };
    if (rotation === 180) return { x: 1 - x, y: 1 - y };
    if (rotation === 270) return { x: y, y: 1 - x };
    return { x, y };
  };
  const corners = [
    [annotation.x, annotation.y],
    [annotation.x + annotation.width, annotation.y],
    [annotation.x, annotation.y + annotation.height],
    [annotation.x + annotation.width, annotation.y + annotation.height],
  ].map(([x, y]) => displayPoint(x, y));
  return pages.map((page) => {
    if (!targetIds.has(page.id)) return page;
    const points = corners.map((p) => toBasePoint(p.x, p.y, page.rotation));
    const x = Math.min(...points.map((p) => p.x));
    const y = Math.min(...points.map((p) => p.y));
    const region = {
      ...annotation,
      id: uid(),
      x,
      y,
      width: Math.max(...points.map((p) => p.x)) - x,
      height: Math.max(...points.map((p) => p.y)) - y,
    };
    return { ...page, annotations: [...page.annotations, region] };
  });
}

const imageCache = new Map();
async function getImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      }),
    );
  }
  return imageCache.get(url);
}

export async function drawAnnotations(
  ctx,
  page,
  width,
  height,
  annotations = page.annotations,
  showRedactionBounds = false,
) {
  ctx.save();
  const rotation = normalizeRotation(page.rotation);
  const w = rotation % 180 ? height : width;
  const h = rotation % 180 ? width : height;
  if (rotation === 90) {
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
  }
  if (rotation === 180) {
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
  }
  if (rotation === 270) {
    ctx.translate(0, height);
    ctx.rotate(-Math.PI / 2);
  }
  try {
    // Redactions always paint last so later writing cannot expose the covered content.
    const ordered = [
      ...annotations.filter((a) => a.type !== "redact"),
      ...annotations.filter((a) => a.type === "redact"),
    ];
    for (const a of ordered) {
      ctx.save();
      ctx.strokeStyle = a.color || "#145c43";
      ctx.fillStyle = a.color || "#145c43";
      ctx.lineWidth = (a.size || 0.004) * w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (a.type === "pen" || a.type === "highlight") {
        ctx.globalAlpha = a.type === "highlight" ? 0.32 : 1;
        ctx.lineWidth =
          (a.type === "highlight" ? Math.max(a.size, 0.025) : a.size) * w;
        ctx.beginPath();
        a.points.forEach((p, i) =>
          i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h),
        );
        if (a.points.length === 1)
          ctx.lineTo(a.points[0].x * w + 0.1, a.points[0].y * h);
        ctx.stroke();
      } else if (a.type === "text") {
        ctx.font = `${a.size * w}px Arial, "Noto Sans KR", sans-serif`;
        ctx.textBaseline = "top";
        a.text
          .split("\n")
          .forEach((line, i) =>
            ctx.fillText(line, a.x * w, a.y * h + i * a.size * w * 1.35),
          );
      } else if (a.type === "signature") {
        ctx.drawImage(
          await getImage(a.dataUrl),
          a.x * w,
          a.y * h,
          a.width * w,
          a.height * h,
        );
      } else if (a.type === "ocr-preview") {
        ctx.fillStyle = "#087f5b";
        ctx.globalAlpha = 0.12;
        ctx.fillRect(a.x * w, a.y * h, a.width * w, a.height * h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#087f5b";
        ctx.lineWidth = Math.max(1, w / 600);
        ctx.strokeRect(a.x * w, a.y * h, a.width * w, a.height * h);
      } else if (a.type === "redact") {
        ctx.fillStyle = a.color || "#ffffff";
        ctx.globalAlpha = 1;
        ctx.fillRect(a.x * w, a.y * h, a.width * w, a.height * h);
        if (showRedactionBounds) {
          ctx.strokeStyle = "#087f5b";
          ctx.lineWidth = Math.max(1, w / 600);
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(a.x * w, a.y * h, a.width * w, a.height * h);
        }
      }
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}

export async function renderPage(
  page,
  scale = 1,
  canvasFactory = () => document.createElement("canvas"),
) {
  const original = await page.source.document.getPage(page.index + 1);
  const viewport = original.getViewport({
    scale,
    rotation: normalizeRotation(page.baseRotation + page.rotation),
  });
  const canvas = canvasFactory();
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await original.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    background: "#ffffff",
  }).promise;
  return canvas;
}

export async function exportPdf(pages, options = {}) {
  if (!pages.length) throw new Error("저장할 페이지가 없습니다.");
  const output = await PDFDocument.create();
  const hasRedaction = pages.some((p) =>
    p.annotations.some((a) => a.type === "redact"),
  );
  const rasterAll = Boolean(options.dpi || hasRedaction);
  const documents = new Map();
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    if (rasterAll || page.annotations.length) {
      const size = rotatedSize(page);
      const scale = (options.dpi || 150) / 72;
      // Bound working canvas memory for large format PDFs.
      const boundedScale = Math.min(
        scale,
        8192 / Math.max(size.width, size.height),
      );
      const canvas = await renderPage(
        page,
        boundedScale,
        options.canvasFactory,
      );
      await drawAnnotations(
        canvas.getContext("2d"),
        page,
        canvas.width,
        canvas.height,
      );
      const data = canvas.toDataURL("image/jpeg", options.quality || 0.88);
      const image = await output.embedJpg(data);
      const target = output.addPage([size.width, size.height]);
      target.drawImage(image, {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      });
      canvas.width = canvas.height = 1;
    } else {
      if (!documents.has(page.source.id)) {
        documents.set(
          page.source.id,
          await PDFDocument.load(page.source.bytes),
        );
      }
      const [copied] = await output.copyPages(documents.get(page.source.id), [
        page.index,
      ]);
      copied.setRotation(
        degrees(normalizeRotation(page.baseRotation + page.rotation)),
      );
      output.addPage(copied);
    }
    options.onProgress?.(index + 1, pages.length);
  }
  output.setTitle("Sen PDF 편집 문서");
  output.setProducer("Sen PDF");
  return output.save();
}

export async function extractText(pages) {
  const sections = [];
  for (const page of pages) {
    if (page.annotations.some((a) => a.type === "redact")) {
      throw new Error(
        "개인정보를 가린 페이지에서는 텍스트 복사를 사용할 수 없습니다.",
      );
    }
    const original = await page.source.document.getPage(page.index + 1);
    const content = await original.getTextContent();
    sections.push(
      content.items
        .map((item) => item.str + (item.hasEOL ? "\n" : " "))
        .join(""),
    );
  }
  return sections.join("\n\n").trim();
}

export async function createDemoPdf() {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const green = rgb(0.03, 0.42, 0.3);
  const titles = [
    "Classroom Notes",
    "A little space to think",
    "Make it your own",
  ];
  titles.forEach((title, i) => {
    const page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 818, width: 595, height: 24, color: green });
    page.drawText("TEACHER PDF / WORKBOOK", {
      x: 55,
      y: 754,
      size: 11,
      font: regular,
      color: green,
    });
    page.drawText(title, {
      x: 55,
      y: 632,
      size: i ? 30 : 42,
      font: bold,
      color: green,
    });
    page.drawText("A simple toolkit for your next great lesson.", {
      x: 55,
      y: 590,
      size: 15,
      font: regular,
    });
    const lines =
      i === 0
        ? [
            "Read. Write. Share.",
            "Your documents, all in one place.",
            "Rotate pages, add a signature, and save your work.",
          ]
        : i === 1
          ? [
              "01   What did we learn today?",
              "02   Which idea would you like to explore?",
              "03   Write a question for the next class.",
            ]
          : [
              "Try a pen or highlighter in presentation mode.",
              "Add a text note anywhere on the page.",
              "Private information? Cover it before sharing.",
            ];
    lines.forEach((line, n) =>
      page.drawText(line, { x: 55, y: 476 - n * 70, size: 14, font: regular }),
    );
    page.drawText(
      `SAMPLE DOCUMENT                                      ${i + 1} / 3`,
      { x: 55, y: 55, size: 10, font: regular, color: green },
    );
  });
  return pdf.save();
}

export function downloadPdf(bytes, filename) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
