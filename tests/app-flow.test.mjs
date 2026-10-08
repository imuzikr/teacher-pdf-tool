import { createTestPdf } from "./pdf-fixture.mjs";
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
  loadSource,
  sourcePages,
  extractText,
  renderPage,
} from "../src/pdf-engine.js";

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
    const buttons = [
      ...(
        document.querySelector('[role="dialog"]') || document
      ).querySelectorAll("button"),
    ];
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
    const actionPanel = document.querySelector(
      'aside[aria-label="문서 작업 도구"]',
    );
    assert.ok(actionPanel, "document tools are in a left sidebar");
    assert.equal(actionPanel.querySelectorAll(".tool-button").length, 12);
    assert.equal(
      document.querySelector(".app-header"),
      null,
      "no horizontal button header remains",
    );
    assert.match(actionPanel.querySelector(".brand").textContent, /My PDF/);

    const importTestPdf = async () => {
      const input = document.querySelector("input[type=file]");
      const data = await createTestPdf();
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [
          {
            name: "수업자료_예제.pdf",
            size: data.length,
            arrayBuffer: async () => data.slice().buffer,
          },
        ],
      });
      await act(async () =>
        input.dispatchEvent(new window.Event("change", { bubbles: true })),
      );
    };
    assert.equal(document.querySelector(".demo-button"), null);
    assert.equal(document.querySelector(".empty-icon"), null);
    assert.doesNotMatch(
      document.body.textContent,
      /LESS PAPERWORK|여러 PDF를 하나로|파일 없이 먼저 둘러보기/,
    );
    await importTestPdf();
    for (let i = 0; i < 20 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(document.querySelectorAll(".thumbnail").length, 3);
    assert.equal(
      document.querySelector(".page-error"),
      null,
      "imported PDF renders successfully",
    );
    const zoomControls = document.querySelector(".document-zoom");
    const documentCanvas = document.querySelector(
      ".document-stage .page-canvas",
    );
    const initialWidth = parseFloat(documentCanvas.style.width);
    await act(async () =>
      zoomControls.querySelector('[aria-label="문서 확대"]').click(),
    );
    assert.ok(parseFloat(documentCanvas.style.width) > initialWidth);
    assert.equal(zoomControls.querySelector(".zoom-value").textContent, "110%");
    assert.equal(
      document.querySelector(".statusbar .zoom-value").textContent,
      "110%",
    );
    await act(async () =>
      zoomControls.querySelector('[aria-label="문서 축소"]').click(),
    );
    assert.equal(parseFloat(documentCanvas.style.width), initialWidth);
    await act(async () =>
      zoomControls.querySelector('[aria-label="문서 확대"]').click(),
    );
    await act(async () =>
      zoomControls.querySelector('[aria-label="문서 화면에 맞춤"]').click(),
    );
    assert.equal(parseFloat(documentCanvas.style.width), initialWidth);
    const fileInput = document.querySelector("input[type=file]");
    const bytes = await createTestPdf();
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
    await click("페이지 추출·병합");
    assert.equal(
      document.querySelectorAll(".assembly-source").length,
      2,
      "one horizontal source row per file",
    );
    assert.ok(document.querySelector(".assembly-placeholder"));
    await act(async () => {
      for (const input of document.querySelectorAll(
        ".assembly-source-checkbox:checked",
      ))
        input.click();
    });
    assert.equal(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "새 문서 PDF 저장",
      ).disabled,
      true,
    );
    await act(async () => {
      const inputs = document.querySelectorAll(".assembly-source-checkbox");
      inputs[1].click();
      inputs[5].click();
    });
    await act(async () =>
      document
        .querySelector('.assembly-source button[aria-label$="선택 해제"]')
        .click(),
    );
    assert.equal(
      document.querySelectorAll(".assembly-source-checkbox")[1].checked,
      false,
      "clear deselects this file even with a partial selection",
    );
    assert.equal(
      document.querySelectorAll(".assembly-source-checkbox")[5].checked,
      true,
      "clearing one file preserves other files' selections",
    );
    await act(async () =>
      document.querySelectorAll(".assembly-source-checkbox")[1].click(),
    );
    await click("선택한 페이지 새 문서에 추가");
    assert.equal(document.querySelectorAll(".assembly-draft-page").length, 2);
    await act(async () =>
      document.querySelector('[aria-label="새 문서 2쪽 앞으로 이동"]').click(),
    );
    assert.match(
      document.querySelector(".assembly-draft-page").textContent,
      /additional.pdf/,
    );
    await act(async () =>
      document.querySelector('[aria-label="새 문서 2쪽 제거"]').click(),
    );
    const drag = (element, type, coordinates = {}) => {
      const event = new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 400,
        ...coordinates,
      });
      Object.defineProperty(event, "dataTransfer", {
        value: { setData() {}, files: [], types: [] },
      });
      element.dispatchEvent(event);
    };
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const frames = new Map();
    let frameId = 0;
    window.requestAnimationFrame = (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    };
    window.cancelAnimationFrame = (id) => frames.delete(id);
    const advance = (time) => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    };
    try {
      await act(async () => {
        drag(document.querySelector(".assembly-source-page"), "dragstart");
        // Scrolling must start before the destination becomes visible, even
        // when the pointer is over the footer rather than the drop area.
        drag(document.body, "dragover", { clientY: window.innerHeight - 2 });
        for (let time = 0; time <= 320; time += 16) advance(time);
        const workspace = document.querySelector(".assembly-workspace");
        assert.ok(
          workspace.scrollTop > 200,
          "drag near the bottom continuously scrolls toward the destination",
        );
        const bottomPosition = workspace.scrollTop;
        drag(document.body, "dragover", { clientY: 400 });
        advance(336);
        assert.equal(
          workspace.scrollTop,
          bottomPosition,
          "moving away from the edge pauses scrolling",
        );
        drag(document.body, "dragover", { clientY: 2 });
        advance(352);
        assert.ok(
          workspace.scrollTop < bottomPosition,
          "the top edge scrolls upward",
        );
        drag(document.querySelector(".assembly-destination"), "drop");
        assert.equal(
          frames.size,
          0,
          "drop cancels the animation without preventing page addition",
        );
        drag(document.querySelector(".assembly-source-page"), "dragstart");
        drag(document.body, "dragover", { clientY: window.innerHeight - 2 });
        advance(368);
        drag(document.querySelector(".assembly-source-page"), "dragend");
        assert.equal(frames.size, 0, "cancelled drags stop auto scrolling");
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    }
    assert.equal(
      document.querySelectorAll(".assembly-draft-page").length,
      2,
      "source drag adds a page",
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[0], "dragstart"),
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[1], "dragover", {
        clientX: 900,
      }),
    );
    assert.ok(
      document.querySelector(".assembly-draft-page.drop-after"),
      "a faint insertion target is displayed at the end",
    );
    assert.match(
      document.querySelector(".assembly-drop-hint").textContent,
      /뒤에/,
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[1], "drop", {
        clientX: 900,
      }),
    );
    assert.equal(
      document.querySelector(".assembly-drop-hint"),
      null,
      "drop clears the target indicator",
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[1], "dragstart"),
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[0], "dragover", {
        clientX: 100,
      }),
    );
    assert.ok(
      document.querySelector(".assembly-draft-page.drop-before"),
      "the first insertion position is indicated",
    );
    await act(async () =>
      drag(document.querySelectorAll(".assembly-draft-page")[1], "dragend"),
    );
    assert.equal(
      document.querySelector(".assembly-drop-hint"),
      null,
      "cancelling a drag clears the target without reordering",
    );
    assert.match(
      document.querySelector(".assembly-draft-page").textContent,
      /수업자료_예제.pdf/,
    );
    await click("새 문서 PDF 저장");
    const assembledSource = await loadSource(
      await downloaded.arrayBuffer(),
      "assembled.pdf",
      renderer,
    );
    const assembledPages = await sourcePages(assembledSource);
    assert.equal(assembledPages.length, 2);
    const assembledText = await extractText(assembledPages);
    assert.match(assembledText, /Classroom Notes[\s\S]*Make it your own/);
    assert.doesNotMatch(assembledText, /What did we learn today/);
    await assembledSource.document.destroy();
    await act(async () =>
      document.querySelector('[aria-label="새 문서 2쪽 제거"]').click(),
    );
    await click("새 문서 PDF 저장");
    const singleSource = await loadSource(
      await downloaded.arrayBuffer(),
      "single.pdf",
      renderer,
    );
    assert.equal(singleSource.document.numPages, 1, "single PDF extraction");
    await singleSource.document.destroy();
    await click("페이지 편집으로 돌아가기");
    assert.equal(
      document.querySelectorAll(".thumbnail").length,
      6,
      "assembling leaves source pages intact",
    );
    await click("페이지 추출·병합");
    assert.equal(
      document.querySelectorAll(".assembly-draft-page").length,
      1,
      "new document survives switching views",
    );
    await click("페이지 편집으로 돌아가기");
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
    assert.match(document.querySelector(".brand").textContent, /My PDF/);
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
        .querySelector('input[name="region-mode"][value="repeat"]')
        .click(),
    );
    await act(async () =>
      document
        .querySelector('input[name="region-scope"][value="selected"]')
        .click(),
    );
    const repeatPages = document.querySelectorAll(".repeat-page-list input");
    assert.equal(repeatPages.length, 6);
    assert.equal([...repeatPages].filter((input) => input.checked).length, 2);
    await act(async () => repeatPages[2].click());
    assert.equal(document.querySelectorAll(".page-checkbox:checked").length, 3);
    assert.match(
      document.querySelector(".region-targets").textContent,
      /현재 3쪽 선택/,
    );
    await act(async () => repeatPages[2].click());
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
      document.querySelector('input[name="region-scope"][value="all"]').click(),
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
    assert.equal(
      savedPages.length,
      6,
      document.querySelector(".toast")?.textContent,
    );
    assert.equal(await extractText(savedPages), "");
    await result.document.destroy();
    await click("슬라이드 재생");
    assert.ok(document.querySelector(".presentation-mode"));
    const editedCount = document.querySelectorAll(
      ".annotation-indicator",
    ).length;
    await click("레이저 포인터");
    const laserStage = document.querySelector(".document-stage");
    await act(async () => {
      for (const x of [100, 130])
        laserStage.dispatchEvent(
          new window.MouseEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: 120,
          }),
        );
    });
    assert.ok(document.querySelector(".laser-overlay circle"));
    assert.equal(
      document
        .querySelector(".laser-overlay polyline")
        .getAttribute("points")
        .split(" ").length,
      2,
    );
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      editedCount,
      "laser is transient and adds no PDF annotation",
    );
    await click("프레젠테이션");
    assert.ok(document.querySelector(".fullscreen-presentation"));
    assert.equal(document.querySelector(".document-heading"), null);
    assert.equal(document.querySelector(".slide-options"), null);
    assert.equal(document.querySelector(".laser-overlay"), null);
    const pageBefore = document.querySelector(".slide-page-number").textContent;
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      ),
    );
    assert.notEqual(
      document.querySelector(".slide-page-number").textContent,
      pageBefore,
    );
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      ),
    );
    assert.equal(
      document.querySelector(".slide-page-number").textContent,
      pageBefore,
    );
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "l", bubbles: true }),
      ),
    );
    assert.ok(document.querySelector(".laser-active"));
    await act(async () =>
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(document.querySelector(".presentation-mode"), null);
    await click("슬라이드 재생");
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
    assert.match(
      document.querySelector("[role=dialog] h2").textContent,
      /저장할까요/,
    );
    await click("저장하고 종료");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
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
    const baselineThumbnails = document.querySelectorAll(".thumbnail").length;
    const baselineAnnotations = document.querySelectorAll(
      ".annotation-indicator",
    ).length;
    await click("슬라이드 재생");
    await click("캡처 모드");
    const captureCanvas = document.querySelector(
      ".document-stage .annotation-canvas",
    );
    const captureBounds = captureCanvas.getBoundingClientRect();
    await act(async () => {
      for (const [type, x, y] of [
        ["pointerdown", 0.15, 0.45],
        ["pointermove", 0.65, 0.7],
        ["pointerup", 0.65, 0.7],
      ]) {
        const e = new window.MouseEvent(type, {
          bubbles: true,
          clientX: captureBounds.width * x,
          clientY: captureBounds.height * y,
          button: 0,
        });
        Object.defineProperty(e, "pointerId", { value: 3 });
        captureCanvas.dispatchEvent(e);
      }
    });
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    const pinned = document.querySelector(".pinned-capture");
    assert.ok(pinned);
    assert.match(pinned.querySelector("img").src, /^data:image\/png/);
    const captureWidth = parseFloat(pinned.style.width);
    await act(async () =>
      pinned.querySelector('[aria-label="캡처 확대"]').click(),
    );
    assert.ok(parseFloat(pinned.style.width) > captureWidth);
    await act(async () =>
      pinned.querySelector('[aria-label="캡처 축소"]').click(),
    );
    assert.ok(Math.abs(parseFloat(pinned.style.width) - captureWidth) < 0.01);
    const captureLeft = parseFloat(pinned.style.left);
    await act(async () =>
      pinned.querySelector(".capture-handle").dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      ),
    );
    assert.equal(parseFloat(pinned.style.left), captureLeft + 10);
    const captureHandle = pinned.querySelector(".capture-handle");
    await act(async () => {
      for (const [type, x, y] of [
        ["pointerdown", 100, 100],
        ["pointermove", 130, 120],
        ["pointerup", 130, 120],
      ]) {
        const event = new window.MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
        });
        Object.defineProperty(event, "pointerId", { value: 4 });
        captureHandle.dispatchEvent(event);
      }
    });
    assert.equal(
      parseFloat(pinned.style.left),
      captureLeft + 40,
      "capture can be dragged",
    );
    assert.ok(
      pinned
        .querySelector(".capture-handle")
        .firstElementChild.classList.contains("capture-size-buttons"),
      "zoom controls are anchored on the left",
    );
    const widthBeforeResize = parseFloat(pinned.style.width);
    const leftBeforeResize = parseFloat(pinned.style.left);
    const edge = pinned.querySelector(".capture-resize-e");
    await act(async () => {
      for (const [type, x] of [
        ["pointerdown", 100],
        ["pointermove", 180],
        ["pointerup", 180],
      ]) {
        const e = new window.MouseEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: 100,
          button: 0,
        });
        Object.defineProperty(e, "pointerId", { value: 5 });
        edge.dispatchEvent(e);
      }
    });
    assert.equal(parseFloat(pinned.style.width), widthBeforeResize + 80);
    assert.equal(parseFloat(pinned.style.left), leftBeforeResize);
    const floatingDrawing = pinned.querySelector(".capture-drawing");
    floatingDrawing.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    });
    await click("펜");
    const pdfOverlayBeforeCaptureInk = document
      .querySelector(".document-stage .annotation-canvas")
      .toDataURL();
    await act(async () => {
      for (const [type, x, y] of [
        ["pointerdown", 0.2, 0.2],
        ["pointermove", 0.7, 0.5],
        ["pointerup", 0.7, 0.5],
      ]) {
        const e = new window.MouseEvent(type, {
          bubbles: true,
          clientX: x * 400,
          clientY: y * 200,
          button: 0,
        });
        Object.defineProperty(e, "pointerId", { value: 6 });
        floatingDrawing.dispatchEvent(e);
      }
    });
    assert.equal(
      floatingDrawing.querySelectorAll("polyline").length,
      1,
      "pen works on floating capture",
    );
    assert.equal(
      document.querySelector(".document-stage .annotation-canvas").toDataURL(),
      pdfOverlayBeforeCaptureInk,
      "capture ink does not modify PDF annotations",
    );
    const pointsBeforeZoom = floatingDrawing
      .querySelector("polyline")
      .getAttribute("points");
    await act(async () =>
      pinned.querySelector('[aria-label="캡처 확대"]').click(),
    );
    assert.equal(
      floatingDrawing.querySelector("polyline").getAttribute("points"),
      pointsBeforeZoom,
      "ink stays aligned when capture resizes",
    );
    await click("레이저 포인터");
    let capturedLaserPointer;
    floatingDrawing.setPointerCapture = (id) => {
      capturedLaserPointer = id;
    };
    const laserDown = new window.MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    Object.defineProperty(laserDown, "pointerId", { value: 8 });
    await act(async () => floatingDrawing.dispatchEvent(laserDown));
    assert.ok(
      laserDown.defaultPrevented,
      "laser drag suppresses browser selection",
    );
    assert.equal(
      capturedLaserPointer,
      8,
      "laser keeps tracking after leaving capture bounds",
    );
    assert.ok(document.querySelector(".laser-mode"));
    await act(async () =>
      floatingDrawing.dispatchEvent(
        new window.MouseEvent("pointermove", {
          bubbles: true,
          clientX: 650,
          clientY: 100,
        }),
      ),
    );
    assert.ok(
      document.querySelector(".laser-overlay circle"),
      "laser works over capture",
    );
    await click("지우개");
    await act(async () =>
      floatingDrawing.dispatchEvent(
        new window.MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 180,
          clientY: 70,
          button: 0,
        }),
      ),
    );
    assert.equal(
      floatingDrawing.querySelectorAll("polyline").length,
      0,
      "capture ink can be erased",
    );
    await click("다음");
    assert.ok(
      document.querySelector(".pinned-capture"),
      "capture remains pinned across pages",
    );
    const pageBeforeBlank =
      document.querySelector(".slide-page-number").textContent;
    await click("빈 페이지 추가");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(
      document.querySelector(".slide-page-number").textContent.trim(),
      `${parseInt(pageBeforeBlank) + 1} / ${baselineThumbnails + 1}`,
    );
    assert.ok(document.querySelector(".tool-pen"));
    assert.ok(
      document.querySelector('[aria-label="왼쪽 참고 페이지"] .page-canvas'),
    );
    assert.ok(
      document.querySelector('[aria-label="오른쪽 연습 페이지"] .tool-pen'),
    );
    assert.equal(
      document.querySelectorAll(".two-page-spread .page-canvas").length,
      2,
    );
    for (const pane of document.querySelectorAll(".practice-pane")) {
      assert.equal(
        pane.style.width,
        pane.querySelector(".page-canvas").style.width,
        "page wrapper creates no inner gap",
      );
    }

    await click("캡처 모드");
    const leftCanvas = document.querySelector(
      '[aria-label="왼쪽 참고 페이지"] .annotation-canvas',
    );
    const leftBounds = leftCanvas.getBoundingClientRect();
    await act(async () => {
      for (const [type, x, y] of [
        ["pointerdown", 0.1, 0.1],
        ["pointermove", 0.6, 0.5],
        ["pointerup", 0.6, 0.5],
      ]) {
        const event = new window.MouseEvent(type, {
          bubbles: true,
          clientX: leftBounds.width * x,
          clientY: leftBounds.height * y,
          button: 0,
        });
        Object.defineProperty(event, "pointerId", { value: 7 });
        leftCanvas.dispatchEvent(event);
      }
    });
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(
      document.querySelectorAll(".pinned-capture").length,
      2,
      "reference page supports capture without leaving two-page view",
    );
    await click("종료");
    await click("취소");
    assert.ok(document.querySelector(".presentation-mode"));
    await act(async () =>
      document.dispatchEvent(new window.Event("fullscreenchange")),
    );
    assert.match(
      document.querySelector("[role=dialog] h2").textContent,
      /저장할까요/,
    );
    await click("저장하지 않고 종료");
    assert.equal(
      document.querySelectorAll(".thumbnail").length,
      baselineThumbnails,
    );
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      baselineAnnotations,
    );
    assert.equal(document.querySelector(".pinned-capture"), null);
    await click("슬라이드 재생");
    await click("빈 페이지 추가");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    await click("종료");
    const createDownloadUrl = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error("download unavailable");
    };
    await click("저장하고 종료");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.ok(
      document.querySelector(".presentation-mode"),
      "failed download keeps session open",
    );
    assert.ok(
      document.querySelector('[role="dialog"]'),
      "failed download retains save choices",
    );
    URL.createObjectURL = createDownloadUrl;
    await click("저장하고 종료");
    for (let i = 0; i < 40 && document.querySelector(".busy-indicator"); i++)
      await settle();
    assert.equal(document.querySelector(".presentation-mode"), null);
    const practice = await loadSource(
      await downloaded.arrayBuffer(),
      "practice.pdf",
      renderer,
    );
    const practicePages = await sourcePages(practice);
    assert.equal(practicePages.length, baselineThumbnails + 1);
    assert.equal(
      document.querySelectorAll(".thumbnail").length,
      baselineThumbnails + 1,
    );
    await practice.document.destroy();
    await click("새 작업");
    await click("새 작업 시작");
    assert.equal(document.querySelectorAll(".thumbnail").length, 0);
    await importTestPdf();
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
    // Region scope must not change the independent OCR scope.
    await act(async () =>
      document
        .querySelector('input[name="region-mode"][value="manual"]')
        .click(),
    );
    assert.equal(
      document.querySelector('input[name="region-scope"]'),
      null,
      "manual mode always allows the full document",
    );
    assert.equal(
      document.querySelector('input[name="ocr-scope"][value="current"]')
        .checked,
      true,
    );
    assert.ok(document.querySelector(".modal.columns .redaction-columns"));
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
    const drawMask = async () => {
      await act(async () => {
        const canvas = document.querySelector(
          ".document-stage .annotation-canvas",
        );
        const bounds = canvas.getBoundingClientRect();
        for (const [type, x, y] of [
          ["pointerdown", 0.1, 0.4],
          ["pointermove", 0.3, 0.5],
          ["pointerup", 0.3, 0.5],
        ]) {
          const event = new window.MouseEvent(type, {
            bubbles: true,
            button: 0,
            clientX: x * bounds.width,
            clientY: y * bounds.height,
          });
          Object.defineProperty(event, "pointerId", { value: 1 });
          canvas.dispatchEvent(event);
        }
      });
      await settle();
    };
    await drawMask();
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      1,
      "manual mode only changes the current page",
    );
    await click("다음 작업 페이지");
    await drawMask();
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      2,
      "each manual page receives its own mask",
    );
    await click("이전 작업 페이지");
    assert.match(
      document.querySelector(".region-navigation").textContent,
      /1 \/ 3쪽/,
    );
    await click("개인정보 가리기");
    await act(async () =>
      document.querySelector('input[name="redaction-ocr"]').click(),
    );
    await act(async () =>
      document
        .querySelector('input[name="region-mode"][value="single"]')
        .click(),
    );
    assert.equal(
      document.querySelector('input[name="region-scope"]'),
      null,
      "single mode needs no page range restriction",
    );
    await click("영역 지정");
    await drawMask();
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      2,
      "single mode keeps masks on the active page",
    );
    await act(async () =>
      document.querySelectorAll(".thumbnail-open")[2].click(),
    );
    await drawMask();
    assert.equal(
      document.querySelectorAll(".annotation-indicator").length,
      3,
      "single mode can edit another page without reopening settings",
    );
    await click("새 작업");
    await click("새 작업 시작");
    assert.deepEqual(errors, [], "no React runtime errors");
  } finally {
    await act(async () => root.unmount());
    console.error = consoleError;
    globalThis.setTimeout = timer;
    await server.close();
    dom.window.close();
  }
});
