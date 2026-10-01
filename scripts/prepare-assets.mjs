import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
await mkdir(resolve(root, "public/pdf-assets"), { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(
    resolve(root, "node_modules/pdfjs-dist", directory),
    resolve(root, "public/pdf-assets", directory),
    { recursive: true },
  );
}
console.log("PDF rendering assets prepared locally.");
const ocrRoot = resolve(root, "public/ocr-assets");
await rm(resolve(ocrRoot, "core"), { recursive: true, force: true });
await mkdir(resolve(ocrRoot, "core"), { recursive: true });
await mkdir(resolve(ocrRoot, "lang"), { recursive: true });
await cp(
  resolve(root, "node_modules/tesseract.js/dist/worker.min.js"),
  resolve(ocrRoot, "worker.min.js"),
);
const coreRoot = resolve(root, "node_modules/tesseract.js-core");
for (const file of await readdir(coreRoot)) {
  if (
    file.endsWith(".wasm.js") ||
    file.endsWith(".wasm") ||
    file === "LICENSE"
  ) {
    await cp(resolve(coreRoot, file), resolve(ocrRoot, "core", file));
  }
}
for (const language of ["kor", "eng"]) {
  await cp(
    resolve(
      root,
      `node_modules/@tesseract.js-data/${language}/4.0.0/${language}.traineddata.gz`,
    ),
    resolve(ocrRoot, "lang", `${language}.traineddata.gz`),
  );
}
await cp(
  resolve(root, "node_modules/tesseract.js/LICENSE.md"),
  resolve(ocrRoot, "LICENSE.md"),
);
console.log("Local Korean and English browser OCR assets prepared.");
