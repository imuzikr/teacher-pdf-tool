import React from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import App from "./App.jsx";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = worker;
const pdfAssets = `${import.meta.env.BASE_URL}pdf-assets/`;
const renderer = {
  getDocument: (options) =>
    pdfjs.getDocument({
      ...options,
      cMapUrl: `${pdfAssets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfAssets}standard_fonts/`,
      wasmUrl: `${pdfAssets}wasm/`,
    }),
};
async function createOcrWorker(logger) {
  const { createWorker } = await import("tesseract.js");
  const root = new URL(
    `${import.meta.env.BASE_URL}ocr-assets/`,
    window.location.href,
  ).href;
  return createWorker(["kor", "eng"], 1, {
    workerPath: `${root}worker.min.js`,
    corePath: `${root}core`,
    langPath: `${root}lang`,
    workerBlobURL: false,
    gzip: true,
    logger,
    errorHandler: () => {},
  });
}
createRoot(document.getElementById("root")).render(
  <App pdfjs={renderer} createOcrWorker={createOcrWorker} />,
);
