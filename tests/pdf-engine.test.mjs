import test from "node:test";
import assert from "node:assert/strict";
import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  Image,
} from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { resolve } from "node:path";
import {
  exportPdf,
  extractText,
  loadSource,
  sourcePages,
  renderPage,
  drawAnnotations,
  toBasePoint,
  rotatedSize,
  createDemoPdf,
} from "../src/pdf-engine.js";

import {
  addAssemblyPages,
  moveAssemblyEntry,
  resolveAssemblyPages,
} from "../src/assembly.js";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D, Image });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const renderer = {
  PagesMapper: pdfjs.PagesMapper,
  getDocument: (options) =>
    pdfjs.getDocument({
      ...options,
      standardFontDataUrl:
        resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
      cMapUrl: resolve("node_modules/pdfjs-dist/cmaps") + "/",
      cMapPacked: true,
      wasmUrl: resolve("node_modules/pdfjs-dist/wasm") + "/",
    }),
};
const canvasFactory = () => createCanvas(1, 1);

async function fixture(name, titles, rotation = 0) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const title of titles) {
    const page = pdf.addPage([400, 600]);
    page.setRotation(degrees(rotation));
    page.drawRectangle({
      x: 0,
      y: 450,
      width: 400,
      height: 150,
      color: rgb(0.6, 0.6, 0.6),
    });
    page.drawText(title, {
      x: 45,
      y: 520,
      size: 18,
      font,
      color: rgb(0.1, 0.2, 0.1),
    });
  }
  const source = await loadSource(await pdf.save(), name, renderer);
  return { source, pages: await sourcePages(source) };
}

test("merge, reorder, delete, and rotate retain searchable source text", async () => {
  const a = await fixture("a.pdf", ["FIRST", "SECOND"]);
  const b = await fixture("b.pdf", ["THIRD"], 90);
  const exported = await exportPdf([
    { ...b.pages[0], rotation: 90 },
    a.pages[0],
  ]);
  const output = await PDFDocument.load(exported);
  assert.equal(output.getPageCount(), 2);
  assert.equal(output.getPage(0).getRotation().angle, 180);
  const source = await loadSource(exported, "output.pdf", renderer);
  const text = await extractText(await sourcePages(source));
  assert.match(text, /THIRD[\s\S]*FIRST/);
  assert.doesNotMatch(text, /SECOND/);
  await Promise.all([
    a.source.document.destroy(),
    b.source.document.destroy(),
    source.document.destroy(),
  ]);
});

test("redaction removes text from the entire exported document and paints an opaque region", async () => {
  const original = await fixture("private.pdf", [
    "SECRET NAME",
    "SECOND PRIVATE PAGE",
  ]);
  const pages = original.pages.map((p, i) =>
    i === 0
      ? {
          ...p,
          annotations: [
            {
              id: "redaction",
              type: "redact",
              x: 0.08,
              y: 0.08,
              width: 0.7,
              height: 0.12,
              color: "#ffffff",
            },
          ],
        }
      : p,
  );
  await assert.rejects(extractText(pages), /텍스트 복사/);
  const bytes = await exportPdf(pages, { canvasFactory });
  const source = await loadSource(bytes, "safe.pdf", renderer);
  const safePages = await sourcePages(source);
  assert.equal(safePages.length, 2);
  assert.equal(await extractText(safePages), "");
  const originalCanvas = await renderPage(original.pages[0], 1, canvasFactory);
  assert.ok(
    originalCanvas.getContext("2d").getImageData(100, 80, 1, 1).data[0] < 200,
  );
  const canvas = await renderPage(safePages[0], 1, canvasFactory);
  const pixel = canvas.getContext("2d").getImageData(100, 80, 1, 1).data;
  assert.ok(
    pixel[0] > 245 && pixel[1] > 245 && pixel[2] > 245,
    `redacted pixel: ${pixel}`,
  );
  const untouchedPixel = canvas
    .getContext("2d")
    .getImageData(330, 300, 1, 1).data;
  assert.ok(untouchedPixel[0] > 240);
  assert.match(await extractText(original.pages), /SECRET NAME/);
  await Promise.all([
    original.source.document.destroy(),
    source.document.destroy(),
  ]);
});

test("rotated redaction uses visible coordinates correctly", async () => {
  const original = await fixture("rotated.pdf", ["PRIVATE"]);
  const edited = {
    ...original.pages[0],
    rotation: 90,
    annotations: [{ type: "redact", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
  };
  const bytes = await exportPdf([edited], { canvasFactory });
  const source = await loadSource(bytes, "rotated-safe.pdf", renderer);
  const [result] = await sourcePages(source);
  assert.deepEqual(rotatedSize(result), { width: 600, height: 400 });
  const canvas = await renderPage(result, 1, canvasFactory);
  const pixel = canvas.getContext("2d").getImageData(480, 80, 1, 1).data;
  assert.ok(pixel[0] > 245 && pixel[1] > 245 && pixel[2] > 245);
  assert.equal(await extractText([result]), "");
  await Promise.all([
    original.source.document.destroy(),
    source.document.destroy(),
  ]);
});

test("compression creates a reopenable image PDF with requested page count and orientation", async () => {
  const original = await fixture("compress.pdf", ["ONE", "TWO"]);
  const bytes = await exportPdf(
    [original.pages[0], { ...original.pages[1], rotation: 270 }],
    { dpi: 110, quality: 0.68, canvasFactory },
  );
  const source = await loadSource(bytes, "compressed.pdf", renderer);
  const result = await sourcePages(source);
  assert.equal(result.length, 2);
  assert.equal(await extractText(result), "");
  assert.deepEqual(rotatedSize(result[1]), { width: 600, height: 400 });
  assert.ok(bytes.length > 1000);
  await Promise.all([
    original.source.document.destroy(),
    source.document.destroy(),
  ]);
});

test("pen, highlight, text, and signature survive export while unchanged pages preserve text", async () => {
  const original = await fixture("annotated.pdf", [
    "PAGE ONE",
    "SEARCHABLE PAGE TWO",
  ]);
  const signature = createCanvas(120, 40);
  const ctx = signature.getContext("2d");
  ctx.fillStyle = "#087f5b";
  ctx.fillRect(10, 10, 100, 20);
  const edited = {
    ...original.pages[0],
    annotations: [
      {
        type: "pen",
        points: [
          { x: 0.1, y: 0.5 },
          { x: 0.8, y: 0.5 },
        ],
        size: 0.01,
        color: "#087f5b",
      },
      {
        type: "highlight",
        points: [
          { x: 0.1, y: 0.55 },
          { x: 0.8, y: 0.55 },
        ],
        size: 0.03,
        color: "#f2bc3d",
      },
      {
        type: "text",
        x: 0.1,
        y: 0.6,
        text: "Teaching note",
        size: 0.03,
        color: "#087f5b",
      },
      {
        type: "signature",
        x: 0.1,
        y: 0.7,
        width: 0.3,
        height: 0.067,
        dataUrl: signature.toDataURL("image/png"),
      },
    ],
  };
  const canvas = await renderPage(edited, 1, canvasFactory);
  await drawAnnotations(canvas.getContext("2d"), edited, 400, 600);
  const penPixel = canvas.getContext("2d").getImageData(150, 300, 1, 1).data;
  assert.ok(penPixel[1] > penPixel[0] + 50);
  const signaturePixel = canvas
    .getContext("2d")
    .getImageData(80, 440, 1, 1).data;
  assert.ok(signaturePixel[1] > signaturePixel[0] + 50);
  const bytes = await exportPdf([edited, original.pages[1]], { canvasFactory });
  const source = await loadSource(bytes, "written.pdf", renderer);
  const result = await sourcePages(source);
  assert.equal(await extractText([result[0]]), "");
  assert.match(await extractText([result[1]]), /SEARCHABLE PAGE TWO/);
  assert.ok(bytes.length > 3000);
  await Promise.all([
    original.source.document.destroy(),
    source.document.destroy(),
  ]);
});

test("pointer coordinates map through every quarter-turn", () => {
  assert.deepEqual(toBasePoint(0.2, 0.3, 0), { x: 0.2, y: 0.3 });
  assert.deepEqual(toBasePoint(0.2, 0.3, 90), { x: 0.3, y: 0.8 });
  assert.deepEqual(toBasePoint(0.2, 0.3, 180), { x: 0.8, y: 0.7 });
  assert.deepEqual(toBasePoint(0.2, 0.3, 270), { x: 0.7, y: 0.2 });
});

test("built-in sample is a real three-page searchable PDF", async () => {
  const source = await loadSource(
    await createDemoPdf(),
    "sample.pdf",
    renderer,
  );
  const pages = await sourcePages(source);
  assert.equal(pages.length, 3);
  assert.match(await extractText(pages), /Classroom Notes/);
  await source.document.destroy();
});

test("empty export and invalid PDF fail explicitly", async () => {
  await assert.rejects(exportPdf([]), /페이지가 없습니다/);
  await assert.rejects(
    loadSource(new TextEncoder().encode("invalid PDF"), "bad.pdf", renderer),
  );
});

test("new document extracts and merges source pages independently with duplicates and current edits", async () => {
  const a = await fixture("first.pdf", ["A ONE", "A TWO", "A THREE"]);
  const b = await fixture("second.pdf", ["B ONE", "B TWO"]);
  assert.match(
    await extractText([a.pages[2]]),
    /A THREE/,
    "a shorter PDF must not invalidate a longer document's pages",
  );
  await assert.rejects(a.source.document.getPage(4), /Invalid page request/);
  const pages = [...a.pages, ...b.pages];
  let entries = addAssemblyPages(
    [],
    pages,
    new Set([a.pages[2].id, b.pages[0].id]),
  );
  entries = addAssemblyPages(entries, pages, new Set([a.pages[2].id]));
  assert.equal(
    new Set(entries.map((e) => e.id)).size,
    3,
    "duplicate source pages have separate destination identities",
  );
  entries = moveAssemblyEntry(entries, entries[1].id, 0);
  const edited = pages.map((p) =>
    p.id === b.pages[0].id ? { ...p, rotation: 90 } : p,
  );
  const result = await exportPdf(resolveAssemblyPages(entries, edited));
  const pdf = await PDFDocument.load(result);
  assert.equal(pdf.getPageCount(), 3);
  assert.equal(pdf.getPage(0).getRotation().angle, 90);
  const out = await loadSource(result, "new.pdf", renderer);
  const text = await extractText(await sourcePages(out));
  assert.match(text, /B ONE[\s\S]*A THREE[\s\S]*A THREE/);
  assert.doesNotMatch(text, /A ONE|A TWO|B TWO/);
  assert.equal(pages.length, 5);
  assert.equal(b.pages[0].rotation, 0);
  assert.equal(moveAssemblyEntry(entries, entries[0].id, -1), entries);
  assert.equal(
    resolveAssemblyPages(entries, [])[0],
    b.pages[0],
    "source removal retains the destination copy",
  );
  await Promise.all([
    a.source.document.destroy(),
    b.source.document.destroy(),
    out.document.destroy(),
  ]);
});
