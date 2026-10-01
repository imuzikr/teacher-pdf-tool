import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  Image,
} from "@napi-rs/canvas";
import { createServer } from "vite";
import { resolve } from "node:path";
import {
  createDemoPdf,
  loadSource,
  sourcePages,
  extractText,
  renderPage,
} from "../src/pdf-engine.js";

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D, Image });
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const renderer = {
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

test("React flow: import, select, rotate, delete/undo, copy, redact, and save a safe PDF", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://test.local/", pretendToBeVisual: true },
  );
  const { window } = dom;
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  });
  const canvases = new WeakMap();
  function backing(element) {
    let canvas = canvases.get(element);
    if (!canvas) {
      canvas = createCanvas(element.width, element.height);
      canvases.set(element, canvas);
    }
    if (canvas.width !== element.width) canvas.width = element.width;
    if (canvas.height !== element.height) canvas.height = element.height;
    return canvas;
  }
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    const ctx = backing(this).getContext(type);
    if (!ctx.__htmlBridge) {
      const original = ctx.drawImage.bind(ctx);
      ctx.drawImage = (image, ...args) =>
        original(
          image instanceof window.HTMLCanvasElement ? backing(image) : image,
          ...args,
        );
      ctx.__htmlBridge = true;
    }
    return ctx;
  };
  window.HTMLCanvasElement.prototype.toDataURL = function (...args) {
    return backing(this).toDataURL(...args);
  };
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const target = this.tagName === "CANVAS" ? this.parentElement : this;
    const width = parseFloat(target.style.width) || 1100;
    const height = parseFloat(target.style.height) || 800;
    return {
      left: 0,
      top: 0,
      x: 0,
      y: 0,
      width,
      height,
      right: width,
      bottom: height,
    };
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback([{ contentRect: { width: 1100, height: 800 } }]);
    }
    disconnect() {}
  };
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback([{ isIntersecting: true }]);
    }
    disconnect() {}
  };
  let copied = "";
  let downloaded;
  window.navigator.clipboard = {
    writeText: async (value) => {
      copied = value;
    },
  };
  URL.createObjectURL = (blob) => {
    downloaded = blob;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  // Shorten only long-lived notification and URL cleanup timers in this simulated DOM.
  const timer = globalThis.setTimeout;
  const { default: React, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  const { default: App } = await server.ssrLoadModule("/src/App.jsx");
  globalThis.setTimeout = (fn, milliseconds, ...args) => {
    const handle = timer(fn, milliseconds, ...args);
    if ([4500, 7000, 30000].includes(milliseconds)) handle.unref();
    return handle;
  };
  const root = createRoot(document.getElementById("root"));
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => {
    errors.push(args.join(" "));
  };
  async function settle() {
    await act(async () => {
      await new Promise((r) => timer(r, 60));
    });
  }
  async function click(text) {
    const buttons = [...document.querySelectorAll("button")];
    const button = buttons.find(
      (b) =>
        b.textContent.trim() === text || b.textContent.trim().startsWith(text),
    );
    assert.ok(button, `button exists: ${text}`);
    assert.equal(button.disabled, false, `button enabled: ${text}`);
    await act(async () =>
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    );
    await settle();
  }
  try {
    await act(async () =>
      root.render(
        React.createElement(App, {
          pdfjs: renderer,
          createOcrWorker: async () => ({
            recognize: async () => ({
              data: {
                blocks: [
                  {
                    paragraphs: [
                      {
                        lines: [
                          {
                            words: [
                              {
                                text: "SCHOOL",
                                confidence: 90,
                                bbox: { x0: 40, y0: 40, x1: 200, y1: 80 },
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            }),
            terminate: async () => {},
          }),
        }),
      ),
    );
    assert.match(document.body.textContent, /수업 준비가/);
    await click("파일 없이 먼저 둘러보기");
    for (let i = 0; i < 20 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(document.querySelectorAll(".thumbnail").length, 3);
    assert.equal(
      document.querySelector(".page-error"),
      null,
      "sample renders successfully",
    );
    const fileInput = document.querySelector("input[type=file]");
    const bytes = await createDemoPdf();
    Object.defineProperty(fileInput, "files", {
      value: [
        {
          name: "additional.pdf",
          size: bytes.length,
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
        },
      ],
    });
    await act(async () =>
      fileInput.dispatchEvent(new window.Event("change", { bubbles: true })),
    );
    for (let i = 0; i < 20 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(document.querySelectorAll(".thumbnail").length, 6);
    await click("전체 선택");
    assert.equal(document.querySelectorAll(".page-checkbox:checked").length, 6);
    await click("회전");
    const shownPage = document.querySelector(".document-stage .page-canvas");
    assert.ok(
      parseFloat(shownPage.style.width) > parseFloat(shownPage.style.height),
    );
    await click("삭제");
    assert.equal(document.querySelectorAll(".thumbnail").length, 0);
    await click("실행 취소");
    assert.equal(document.querySelectorAll(".thumbnail").length, 6);
    await act(async () => document.querySelector(".thumbnail-open").click());
    await settle();
    await click("텍스트 복사");
    assert.match(copied, /Classroom Notes/);
    assert.match(document.querySelector(".brand").textContent, /Sen PDF/);
    await act(async () =>
      document.querySelectorAll(".page-checkbox")[1].click(),
    );
    await click("개인정보 가리기");
    assert.equal(
      document.querySelector("[role=dialog] h2").textContent,
      "개인정보 가리기",
    );
    await act(async () =>
      document
        .querySelector('input[name="redaction-scope"][value="selected"]')
        .click(),
    );
    await click("영역 지정");
    const drawing = document.querySelector(
      ".document-stage .annotation-canvas",
    );
    const rect = drawing.getBoundingClientRect();
    const pointer = (name, x, y) => {
      const event = new window.MouseEvent(name, {
        bubbles: true,
        clientX: x * rect.width,
        clientY: y * rect.height,
        button: 0,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      drawing.dispatchEvent(event);
    };
    await act(async () => {
      pointer("pointerdown", 0.1, 0.1);
      pointer("pointermove", 0.4, 0.3);
      pointer("pointerup", 0.4, 0.3);
    });
    await settle();
    assert.equal(document.querySelectorAll(".annotation-indicator").length, 2);
    await click("실행 취소");
    assert.equal(document.querySelectorAll(".annotation-indicator").length, 0);
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Z",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    await settle();
    assert.equal(document.querySelectorAll(".annotation-indicator").length, 2);
    await click("개인정보 가리기");
    await act(async () =>
      document
        .querySelector('input[name="redaction-scope"][value="all"]')
        .click(),
    );
    await click("영역 지정");
    await act(async () => {
      pointer("pointerdown", 0.6, 0.1);
      pointer("pointermove", 0.8, 0.2);
      pointer("pointerup", 0.8, 0.2);
    });
    await settle();
    assert.equal(document.querySelectorAll(".annotation-indicator").length, 6);
    await click("저장");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.ok(
      downloaded,
      `save initiates a real PDF download; notice: ${document.querySelector(".toast")?.textContent}`,
    );
    const result = await loadSource(
      await downloaded.arrayBuffer(),
      "safe.pdf",
      renderer,
    );
    const savedPages = await sourcePages(result);
    assert.equal(savedPages.length, 6);
    assert.equal(await extractText(savedPages), "");
    await result.document.destroy();
    await click("슬라이드 재생");
    assert.ok(document.querySelector(".presentation-mode"));
    await click("펜");
    assert.ok(document.querySelector(".tool-pen"));
    const slideCanvas = document.querySelector(
      ".document-stage .annotation-canvas",
    );
    const slideRect = slideCanvas.getBoundingClientRect();
    await act(async () => {
      for (const [name, x, y] of [
        ["pointerdown", 0.2, 0.6],
        ["pointermove", 0.5, 0.6],
        ["pointerup", 0.5, 0.6],
      ]) {
        const event = new window.MouseEvent(name, {
          bubbles: true,
          clientX: x * slideRect.width,
          clientY: y * slideRect.height,
          button: 0,
        });
        Object.defineProperty(event, "pointerId", { value: 2 });
        slideCanvas.dispatchEvent(event);
      }
    });
    await click("종료");
    assert.equal(document.querySelector(".presentation-mode"), null);
    await click("저장");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    const written = await loadSource(
      await downloaded.arrayBuffer(),
      "written.pdf",
      renderer,
    );
    const writtenPages = await sourcePages(written);
    const writtenCanvas = await renderPage(writtenPages[0], 1, () =>
      createCanvas(1, 1),
    );
    const penPixel = writtenCanvas
      .getContext("2d")
      .getImageData(
        Math.round(writtenCanvas.width * 0.35),
        Math.round(writtenCanvas.height * 0.6),
        1,
        1,
      ).data;
    assert.ok(
      penPixel[1] > penPixel[0] + 40,
      "slide drawing is retained in the downloaded PDF",
    );
    await written.document.destroy();
    await click("새로 만들기");
    await click("새로 시작");
    assert.equal(document.querySelectorAll(".thumbnail").length, 0);
    await click("파일 없이 먼저 둘러보기");
    for (let i = 0; i < 20 && document.querySelector(".busy-indicator"); i++)
      await settle();
    await click("개인정보 가리기");
    assert.equal(
      document.querySelector('input[name="redaction-region"]').checked,
      true,
    );
    assert.equal(
      document.querySelector('input[name="redaction-ocr"]').checked,
      false,
    );
    await act(async () =>
      document.querySelector('input[name="redaction-ocr"]').click(),
    );
    await act(async () => {
      const input = document.getElementById("ocr-terms");
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set.call(input, "SCHOOL");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await click("OCR로 단어 찾기");
    for (let i = 0; i < 20 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(
      document.querySelector("[role=dialog] h2").textContent,
      "OCR 검색 결과 확인",
    );
    assert.equal(document.querySelectorAll(".ocr-result").length, 1);
    await click("선택한 1곳 적용 후 영역 지정");
    assert.ok(
      document.querySelector(".tool-redact"),
      "combined mode continues manual redaction",
    );
    assert.equal(document.querySelectorAll(".annotation-indicator").length, 1);
    await click("새로 만들기");
    await click("새로 시작");
    assert.deepEqual(errors, [], "no React runtime errors");
  } finally {
    await act(async () => root.unmount());
    console.error = consoleError;
    globalThis.setTimeout = timer;
    await server.close();
    dom.window.close();
  }
});
