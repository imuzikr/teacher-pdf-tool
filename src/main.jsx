import React from "react";
import { createRoot } from "react-dom/client";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import App from "./App.jsx";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = worker;
const renderer = {
  getDocument: (options) =>
    pdfjs.getDocument({
      ...options,
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
    }),
};
createRoot(document.getElementById("root")).render(<App pdfjs={renderer} />);
