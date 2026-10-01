import test from "node:test";
import assert from "node:assert/strict";
import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  GlobalFonts,
} from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { createWorker } from "tesseract.js";
import { resolve } from "node:path";
import {
  scanPdfWords,
  findOcrMatches,
  parseTerms,
  applyOcrMatches,
} from "../src/ocr-engine.js";
import {
  loadSource,
  sourcePages,
  exportPdf,
  extractText,
  renderPage,
} from "../src/pdf-engine.js";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const renderer = {
  getDocument: (options) =>
    pdfjs.getDocument({
      ...options,
      standardFontDataUrl: resolve("public/pdf-assets/standard_fonts") + "/",
    }),
};
const canvasFactory = () => createCanvas(1, 1);

test("OCR word matching joins Korean words, prefers longer terms, and retains separate occurrences", () => {
  const data = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  {
                    text: "한성",
                    confidence: 90,
                    bbox: { x0: 10, y0: 10, x1: 50, y1: 30 },
                  },
                  {
                    text: "여자고등학교",
                    confidence: 85,
                    bbox: { x0: 55, y0: 10, x1: 180, y1: 30 },
                  },
                  {
                    text: "한성",
                    confidence: 75,
                    bbox: { x0: 220, y0: 10, x1: 260, y1: 30 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const matches = findOcrMatches(
    data,
    parseTerms("한성,한성여자고등학교\n한성"),
    300,
    100,
  );
  assert.equal(matches.length, 2);
  assert.equal(matches[0].term, "한성여자고등학교");
  assert.equal(matches[1].term, "한성");
  assert.ok(matches[0].width > 0.5);
  assert.equal(matches[0].confidence, 85);
});

test("OCR cancellation terminates the worker and commits no partial results", async () => {
  const controller = new AbortController();
  let terminated = 0;
  const page = {
    id: "cancel",
    width: 100,
    height: 100,
    rotation: 0,
    baseRotation: 0,
    source: {
      document: {
        getPage: async () => ({
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      },
    },
  };
  const scan = scanPdfWords([page], ["secret"], {
    signal: controller.signal,
    canvasFactory,
    createWorker: async () => ({
      recognize: () => new Promise(() => {}),
      terminate: async () => {
        terminated++;
      },
    }),
  });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(scan, { name: "AbortError" });
  assert.equal(terminated, 1);
});

test(
  "actual Korean/English OCR finds words in an image-only PDF and exports white masks",
  { timeout: 120000 },
  async () => {
    GlobalFonts.registerFromPath(
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "OcrTestKorean",
    );
    const canvas = createCanvas(1200, 700);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "bold 52px OcrTestKorean";
    ctx.fillText("한성여자고등학교", 90, 180);
    ctx.font = "bold 52px Arial";
    ctx.fillText("HANSUNG SCHOOL", 90, 350);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(canvas.toBuffer("image/png"));
    pdf
      .addPage([600, 350])
      .drawImage(image, { x: 0, y: 0, width: 600, height: 350 });
    const source = await loadSource(await pdf.save(), "scanned.pdf", renderer);
    const pages = await sourcePages(source);
    assert.equal(
      await extractText(pages),
      "",
      "input is a scan without a text layer",
    );
    const result = await scanPdfWords(
      pages,
      parseTerms("한성여자고등학교,HANSUNG SCHOOL"),
      {
        canvasFactory,
        createWorker: () =>
          createWorker(["kor", "eng"], 1, {
            langPath: resolve("public/ocr-assets/lang"),
            cacheMethod: "none",
            gzip: true,
            errorHandler: () => {},
          }),
      },
    );
    assert.equal(result.scannedPages, 1);
    assert.ok(
      result.matches.some((m) => m.term === "한성여자고등학교"),
      "recognizes Korean school name",
    );
    assert.ok(
      result.matches.some((m) => m.term === "HANSUNG SCHOOL"),
      "recognizes English phrase",
    );
    const applied = applyOcrMatches(pages, result.matches);
    const bytes = await exportPdf(applied, { canvasFactory });
    const output = await loadSource(bytes, "safe.pdf", renderer);
    const [safePage] = await sourcePages(output);
    assert.equal(await extractText([safePage]), "");
    const safeCanvas = await renderPage(safePage, 2, canvasFactory);
    for (const match of result.matches) {
      const rect = safeCanvas
        .getContext("2d")
        .getImageData(
          Math.ceil(match.x * safeCanvas.width) + 3,
          Math.ceil(match.y * safeCanvas.height) + 3,
          Math.max(1, Math.floor(match.width * safeCanvas.width) - 6),
          Math.max(1, Math.floor(match.height * safeCanvas.height) - 6),
        ).data;
      assert.ok(
        [...rect].every((v) => v >= 235),
        "matched area is white in the exported PDF",
      );
    }
    await source.document.destroy();
    await output.document.destroy();
  },
);
