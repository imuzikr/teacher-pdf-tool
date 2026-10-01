import { cp, mkdir } from "node:fs/promises";
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
