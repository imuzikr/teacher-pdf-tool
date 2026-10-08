import { PDFDocument } from "pdf-lib";
import { renderPage, drawAnnotations, rotatedSize } from "./pdf-engine.js";

export async function createBlankPdf(width, height) {
  const pdf = await PDFDocument.create();
  pdf.addPage([width, height]);
  return pdf.save();
}

// Capture the visible orientation, including existing annotations and masks.
export async function captureRegion(
  page,
  region,
  canvasFactory = () => document.createElement("canvas"),
) {
  const { width, height } = rotatedSize(page);
  const scale = Math.min(2, 4096 / Math.max(width, height));
  const rendered = await renderPage(page, scale, canvasFactory);
  await drawAnnotations(
    rendered.getContext("2d"),
    page,
    rendered.width,
    rendered.height,
  );
  const x = Math.max(0, Math.min(1, region.x));
  const y = Math.max(0, Math.min(1, region.y));
  const w = Math.min(1 - x, Math.max(0, region.width));
  const h = Math.min(1 - y, Math.max(0, region.height));
  if (w <= 0 || h <= 0) throw new Error("캡처할 영역을 지정해 주세요.");
  const result = canvasFactory();
  result.width = Math.max(1, Math.round(w * rendered.width));
  result.height = Math.max(1, Math.round(h * rendered.height));
  result
    .getContext("2d")
    .drawImage(
      rendered,
      x * rendered.width,
      y * rendered.height,
      w * rendered.width,
      h * rendered.height,
      0,
      0,
      result.width,
      result.height,
    );
  const dataUrl = result.toDataURL("image/png");
  rendered.width = rendered.height = 1;
  return { dataUrl, aspectRatio: result.width / result.height };
}
