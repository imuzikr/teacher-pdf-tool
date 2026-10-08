import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FilePdf,
  FilePlus,
  FolderPlus,
  Copy,
  ArrowClockwise,
  Trash,
  Signature,
  ShieldCheck,
  ArrowUUpLeft,
  ArrowUUpRight,
  Presentation,
  FileArrowDown,
  FloppyDisk,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Hand,
  Cursor,
  PencilSimple,
  Highlighter,
  Shapes,
  TextT,
  Eraser,
  Minus,
  Plus,
  CornersOut,
  SignOut,
  UploadSimple,
  LockKey,
  X,
  Check,
  Info,
  Keyboard,
  ArrowsDownUp,
} from "@phosphor-icons/react";
import { ToolButton, Modal, PageCanvas, SignaturePad } from "./components.jsx";
import PdfAssembler from "./PdfAssembler.jsx";
import { shapeOptions, shapePoints, hitShape, resizeShape } from "./shapes.js";
import PinnedCapture from "./PinnedCapture.jsx";
import { createBlankPdf, captureRegion } from "./slide-tools.js";
import {
  parseTerms,
  scanPdfWords,
  applyOcrMatches,
  matchAnnotation,
} from "./ocr-engine.js";
import {
  loadSource,
  sourcePages,
  exportPdf,
  extractText,
  applyRedaction,
  downloadPdf,
  uid,
  toBasePoint,
  rotatedSize,
} from "./pdf-engine.js";

const penPalette = [
  ["검정", "#111111"],
  ["붉은색", "#e03131"],
  ["파란색", "#1c5fd4"],
  ["보라색", "#8e44ad"],
  ["주황색", "#f07818"],
  ["노란색", "#f5cc28"],
  ["흰색", "#ffffff"],
  ["초록색", "#087f5b"],
];
const highlightPalette = [
  ["노랑", "#ffe600"],
  ["연두", "#a3e635"],
  ["분홍", "#ff80b5"],
  ["하늘색", "#67d5f5"],
  ["주황", "#ffb347"],
  ["보라", "#c4a1ff"],
];
const compressionPresets = [
  {
    id: 200,
    title: "품질 우선",
    description: "200dpi · 작은 글씨도 선명하게",
    quality: 0.92,
  },
  {
    id: 150,
    title: "균형",
    description: "150dpi · 품질과 용량을 균형 있게",
    quality: 0.82,
  },
  {
    id: 110,
    title: "용량 우선",
    description: "110dpi · 작은 글씨의 선명도가 낮아질 수 있어요",
    quality: 0.68,
  },
];
const readableSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;

function annotationHit(a, p, page) {
  if (a.type === "shape")
    return hitShape(
      a.points,
      p,
      page.width / page.height,
      Math.max(a.size, 0.018),
    );
  if (a.points)
    return a.points.some(
      (q) =>
        Math.hypot(q.x - p.x, ((q.y - p.y) * page.height) / page.width) <
        Math.max(a.size, 0.025),
    );
  const width =
    a.width ||
    Math.min(
      0.9,
      Math.max(...a.text.split("\n").map((l) => l.length)) * a.size * 0.65,
    );
  const height =
    a.height ||
    ((a.size * page.width) / page.height) * a.text.split("\n").length * 1.4;
  return (
    p.x >= a.x - 0.01 &&
    p.x <= a.x + width + 0.01 &&
    p.y >= a.y - 0.01 &&
    p.y <= a.y + height + 0.01
  );
}

export default function App({ pdfjs, createOcrWorker }) {
  const [pages, setPages] = useState([]);
  const [assemblyView, setAssemblyView] = useState(false);
  const [assembly, setAssembly] = useState([]);
  const [assemblyDirty, setAssemblyDirty] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [slide, setSlide] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [captures, setCaptures] = useState([]);
  const [captureRect, setCaptureRect] = useState(null);
  const [practicePairs, setPracticePairs] = useState({});
  const slideSession = useRef(null);
  const [laserPoint, setLaserPoint] = useState(null);
  const [laserTrail, setLaserTrail] = useState([]);
  const [tool, setTool] = useState("move");
  const [shapeKind, setShapeKind] = useState("line");
  const [shapeMenu, setShapeMenu] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const colorMemory = useRef({
    pen: "#087f5b",
    highlight: "#ffe600",
    shape: "#087f5b",
    text: "#087f5b",
  });
  const chooseTool = (value) => {
    setTool(value);
    setShapeMenu(value === "shape");
    if (colorMemory.current[value]) setColor(colorMemory.current[value]);
  };
  useEffect(() => {
    setSelectedShapeId(null);
    if (tool !== "shape") setShapeMenu(false);
  }, [activeId, tool]);
  useEffect(() => {
    if (!shapeMenu) return;
    const close = (e) => {
      if (!e.target.closest(".shape-picker")) setShapeMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [shapeMenu]);
  const [color, setColor] = useState("#087f5b");
  const [size, setSize] = useState(0.004);
  const [fontSize, setFontSize] = useState(0.025);
  const [modal, setModal] = useState(null);
  const [compression, setCompression] = useState(150);
  const [regionMode, setRegionMode] = useState("single");
  const [regionScope, setRegionScope] = useState("all");
  const [regionSession, setRegionSession] = useState(null);
  const [ocrScope, setOcrScope] = useState("current");
  const [redactionMethods, setRedactionMethods] = useState({
    region: true,
    ocr: false,
  });
  const [ocrTerms, setOcrTerms] = useState("");
  const [ocrReview, setOcrReview] = useState(null);
  const [ocrPreviewId, setOcrPreviewId] = useState(null);
  const ocrAbort = useRef(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [dropOver, setDropOver] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [signature, setSignature] = useState(null);
  const [textValue, setTextValue] = useState("");
  const [viewerSize, setViewerSize] = useState({ width: 1000, height: 800 });
  const past = useRef([]);
  const future = useRef([]);
  const pointer = useRef(null);
  const upload = useRef(null);
  const workspace = useRef(null);
  const stage = useRef(null);
  const draggingPage = useRef(null);
  const operation = useRef(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const sources = useRef(new Map());
  const activeIndex = Math.max(
    0,
    pages.findIndex((p) => p.id === activeId),
  );
  const page = pages[activeIndex];
  const notify = useCallback(
    (message, error = false) => setToast({ message, error, id: Date.now() }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setViewerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [slide, pages.length > 0]);
  useEffect(() => {
    const beforeUnload = (e) => {
      if (dirty || assemblyDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, assemblyDirty]);
  const commit = useCallback((next) => {
    past.current.push(pagesRef.current);
    if (past.current.length > 20) past.current.shift();
    future.current = [];
    setPages(next);
    setDirty(true);
    setHistoryVersion((v) => v + 1);
  }, []);
  const updateAnnotations = (annotations) =>
    commit(pages.map((p) => (p.id === page.id ? { ...p, annotations } : p)));
  const undo = useCallback(() => {
    if (!past.current.length || operation.current) return;
    future.current.push(pagesRef.current);
    const restored = past.current.pop();
    setPages(restored);
    setDirty(true);
    setHistoryVersion((v) => v + 1);
    setDraft(null);
    pointer.current = null;
  }, []);
  const redo = useCallback(() => {
    if (!future.current.length || operation.current) return;
    past.current.push(pagesRef.current);
    setPages(future.current.pop());
    setDirty(true);
    setHistoryVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (pages.length && !pages.some((p) => p.id === activeId))
      setActiveId(pages[0].id);
    const valid = new Set(pages.map((p) => p.id));
    setSelected((old) => new Set([...old].filter((id) => valid.has(id))));
  }, [pages]);
  useEffect(() => {
    const current = new Map(pages.map((p) => [p.id, p]));
    setAssembly((old) => {
      let changed = false;
      const next = old.map((entry) => {
        const page = current.get(entry.page.id);
        if (!page || page === entry.page) return entry;
        changed = true;
        return { ...entry, page };
      });
      return changed ? next : old;
    });
  }, [pages]);
  const targets = pages.filter((p) => selected.has(p.id));
  const importFiles = async (files) => {
    if (operation.current) return;
    const list = Array.from(files);
    if (!list.length) return;
    operation.current = true;
    setBusy("PDF를 불러오는 중…");
    const added = [];
    const errors = [];
    try {
      for (const file of list) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          errors.push(`${file.name}: PDF 파일을 선택해 주세요.`);
          continue;
        }
        if (file.size > 100 * 1024 * 1024) {
          errors.push(`${file.name}: 파일당 100MB까지 지원합니다.`);
          continue;
        }
        let source;
        try {
          setBusy(`${file.name} 불러오는 중…`);
          source = await loadSource(await file.arrayBuffer(), file.name, pdfjs);
          const sourceList = await sourcePages(source);
          sources.current.set(source.id, source);
          added.push(...sourceList);
        } catch (e) {
          if (source) await source.document.destroy();
          errors.push(
            `${file.name}: ${e.name === "PasswordException" ? "암호가 걸린 PDF입니다. 암호를 해제한 파일을 사용해 주세요." : "PDF를 읽을 수 없습니다. 손상되지 않은 파일인지 확인해 주세요."}`,
          );
        }
      }
      if (added.length) {
        commit([...pagesRef.current, ...added]);
        setActiveId(added[0].id);
        setSelected(new Set([added[0].id]));
        setZoom(100);
        setTool("move");
        notify(`${added.length}페이지를 가져왔습니다.`);
      }
      if (errors.length)
        setModal({
          type: "error",
          title: "파일 가져오기 안내",
          message: errors.join("\n"),
        });
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  const save = async (
    preset,
    exportPages = pages,
    filename,
    assembled = false,
  ) => {
    if (!exportPages.length || operation.current) return;
    operation.current = true;
    setBusy("PDF를 준비하는 중…");
    try {
      const bytes = await exportPdf(exportPages, {
        ...(preset ? { dpi: preset.id, quality: preset.quality } : {}),
        onProgress: (n, total) =>
          setBusy(`PDF 저장 중 · ${n} / ${total}페이지`),
      });
      const name = (exportPages[0].source.name || "문서.pdf").replace(
        /\.pdf$/i,
        "",
      );
      const redacted = exportPages.some((p) =>
        p.annotations.some((a) => a.type === "redact"),
      );
      downloadPdf(
        bytes,
        filename ||
          `${name}_${preset ? "압축" : redacted ? "가림" : "편집"}.pdf`,
      );
      setModal(null);
      if (assembled) setAssemblyDirty(false);
      else if (!preset) setDirty(false);
      notify(
        `${readableSize(bytes.length)} PDF를 다운로드했습니다.${preset ? " 원본은 그대로 유지됩니다." : ""}`,
      );
      return true;
    } catch (e) {
      notify(`저장하지 못했습니다: ${e.message}`, true);
      return false;
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  const copyText = async () => {
    if (operation.current || !targets.length) return;
    operation.current = true;
    setBusy("텍스트를 읽는 중…");
    try {
      const text = await extractText(targets);
      if (!text) {
        setModal({
          type: "notice",
          title: "복사할 텍스트가 없습니다",
          message:
            "이 페이지는 이미지로 스캔된 PDF일 수 있습니다. 텍스트 복사는 PDF 자체에 포함된 글자에 적용됩니다. 스캔 문서의 단어를 가리려면 개인정보 가리기에서 브라우저 OCR을 선택해 주세요.",
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        notify(`${targets.length}페이지의 텍스트를 복사했습니다.`);
      } catch {
        setTextValue(text);
        setModal({ type: "copy" });
      }
    } catch (e) {
      notify(e.message, true);
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  const beginRegion = () => {
    const regionPages =
      regionMode !== "repeat" || regionScope === "all" ? pages : targets;
    if (!regionPages.length) return;
    const ids = regionPages.map((p) => p.id);
    setRegionSession({ mode: regionMode, ids });
    if (!ids.includes(page.id)) setActiveId(ids[0]);
    setTool("redact");
    setModal(null);
    setOcrReview(null);
  };
  const startOcr = async () => {
    if (operation.current) return;
    const terms = parseTerms(ocrTerms);
    const scanPages =
      ocrScope === "all" ? pages : ocrScope === "selected" ? targets : [page];
    if (!terms.length || !scanPages.length) return;
    if (terms.length > 100) {
      notify("한 번에 100개 이하의 단어를 입력해 주세요.", true);
      return;
    }
    operation.current = true;
    const controller = new AbortController();
    ocrAbort.current = controller;
    setBusy("한국어·영어 OCR을 준비하는 중…");
    setOcrReview(null);
    try {
      const result = await scanPdfWords(scanPages, terms, {
        createWorker: createOcrWorker,
        signal: controller.signal,
        onProgress: ({ stage, page: number, total, message }) => {
          if (controller.signal.aborted) return;
          if (
            stage === "initializing" ||
            (stage === "engine" && message.status !== "recognizing text")
          ) {
            setBusy(
              "한국어·영어 OCR 모델을 준비하는 중… 첫 사용에는 잠시 시간이 걸립니다.",
            );
          } else
            setBusy(
              `브라우저 OCR · ${number} / ${total}페이지${message?.progress != null ? ` · ${Math.round(message.progress * 100)}%` : ""}`,
            );
        },
      });
      setOcrReview({
        ...result,
        selected: new Set(result.matches.map((m) => m.id)),
        continueRegion: redactionMethods.region,
      });
      setOcrPreviewId(result.matches[0]?.pageId || scanPages[0].id);
      setModal({ type: "ocr-review" });
    } catch (error) {
      if (error.name === "AbortError")
        notify("OCR을 취소했습니다. 문서에는 변경 사항이 없습니다.");
      else
        notify(
          "OCR을 실행하지 못했습니다. 모델 다운로드와 브라우저 지원을 확인하고 다시 시도해 주세요.",
          true,
        );
    } finally {
      ocrAbort.current = null;
      operation.current = false;
      setBusy("");
    }
  };
  const acceptOcr = () => {
    const chosen = ocrReview.matches.filter((m) =>
      ocrReview.selected.has(m.id),
    );
    if (chosen.length) commit(applyOcrMatches(pagesRef.current, chosen));
    notify(
      `${chosen.length}곳을 흰색으로 가렸습니다. 인식 누락이 있을 수 있으니 문서를 확인해 주세요.`,
    );
    if (ocrReview.continueRegion) beginRegion();
    else {
      setTool("move");
      setModal(null);
      setOcrReview(null);
    }
  };
  const reset = () => {
    setAssembly([]);
    setAssemblyView(false);
    setAssemblyDirty(false);
    setPages([]);
    setSelected(new Set());
    setActiveId(null);
    past.current = [];
    future.current = [];
    setHistoryVersion((v) => v + 1);
    setDirty(false);
    setDraft(null);
    setSignature(null);
    setRegionMode("single");
    setRegionScope("all");
    setRegionSession(null);
    setOcrScope("current");
    setRedactionMethods({ region: true, ocr: false });
    setOcrTerms("");
    setOcrReview(null);
    setTool("move");
    setZoom(100);
    setModal(null);
    for (const source of sources.current.values())
      source.document.destroy().catch(() => {});
    sources.current.clear();
  };
  const finishSlide = () => {
    slideSession.current = null;
    setSlide(false);
    setPresenting(false);
    setCaptures([]);
    setPracticePairs({});
    setCaptureRect(null);
    setLaserPoint(null);
    setLaserTrail([]);
    setTool("move");
    setDraft(null);
    pointer.current = null;
    setModal(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const exitSlide = () => {
    if (operation.current) return;
    if (
      slideSession.current &&
      pagesRef.current !== slideSession.current.pages
    ) {
      pointer.current = null;
      setDraft(null);
      setCaptureRect(null);
      setModal({ type: "slide-exit" });
    } else finishSlide();
  };
  const discardSlide = () => {
    if (operation.current) return;
    const session = slideSession.current;
    if (session) {
      setPages(session.pages);
      setDirty(session.dirty);
      past.current = session.past;
      future.current = session.future;
      setHistoryVersion((v) => v + 1);
      setActiveId(session.activeId);
      setSelected(session.selected);
      for (const [id, source] of sources.current)
        if (!session.sourceIds.has(id)) {
          source.document.destroy().catch(() => {});
          sources.current.delete(id);
        }
    }
    finishSlide();
  };
  const startSlide = (mode) => {
    if (!pages.length) return;
    if (!slideSession.current)
      slideSession.current = {
        pages: pagesRef.current,
        dirty,
        past: [...past.current],
        future: [...future.current],
        activeId,
        selected: new Set(selected),
        sourceIds: new Set(sources.current.keys()),
      };
    setPresenting(mode === "present");
    setLaserPoint(null);
    setLaserTrail([]);
    setSlide(true);
    setZoom(100);
    setTool("move");
    workspace.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const change = () => {
      if (!document.fullscreenElement && slideSession.current) exitSlide();
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  });
  const addBlankPage = async () => {
    if (operation.current || !page) return;
    operation.current = true;
    setBusy("빈 연습 페이지를 추가하는 중…");
    try {
      const size = rotatedSize(page);
      const source = await loadSource(
        await createBlankPdf(size.width, size.height),
        "빈 연습 페이지.pdf",
        pdfjs,
      );
      sources.current.set(source.id, source);
      const [blank] = await sourcePages(source);
      const next = [...pagesRef.current];
      const index = next.findIndex((p) => p.id === page.id);
      next.splice(index + 1, 0, blank);
      commit(next);
      setPracticePairs((old) => ({ ...old, [blank.id]: page.id }));
      setActiveId(blank.id);
      setSelected(new Set([blank.id]));
      chooseTool("pen");
      setPresenting(false);
      setDraft(null);
      pointer.current = null;
    } catch (e) {
      notify(`빈 페이지를 추가하지 못했습니다: ${e.message}`, true);
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  const finishCapture = async (current) => {
    if (current.rect.width < 0.003 || current.rect.height < 0.003) return;
    operation.current = true;
    setBusy("선택한 영역을 캡처하는 중…");
    try {
      const image = await captureRegion(current.page, current.rect);
      setCaptures((old) => [
        ...old,
        {
          ...image,
          id: uid(),
          x: 20 + (old.length % 4) * 24,
          y: 20 + (old.length % 4) * 24,
          width: Math.min(360, window.innerWidth - 40),
        },
      ]);
      setTool("move");
    } catch (e) {
      notify(`캡처하지 못했습니다: ${e.message}`, true);
    } finally {
      operation.current = false;
      setBusy("");
    }
  };
  useEffect(() => {
    if (!slide || tool !== "laser") {
      setLaserPoint(null);
      setLaserTrail([]);
      return;
    }
    const timer = setInterval(() => {
      const cutoff = Date.now() - 450;
      setLaserTrail((old) =>
        old.some((p) => p.time < cutoff)
          ? old.filter((p) => p.time >= cutoff)
          : old,
      );
    }, 50);
    return () => clearInterval(timer);
  }, [slide, tool]);
  useEffect(() => {
    setLaserPoint(null);
    setLaserTrail([]);
  }, [activeId]);
  const moveLaser = (event) => {
    if (!slide || tool !== "laser") return;
    const bounds = workspace.current.getBoundingClientRect();
    const p = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      time: Date.now(),
    };
    setLaserPoint(p);
    setLaserTrail((old) =>
      [...old.filter((q) => q.time >= p.time - 450), p].slice(-36),
    );
  };
  const clearLaser = () => {
    setLaserPoint(null);
    setLaserTrail([]);
  };
  const selectPage = (p, event) => {
    setActiveId(p.id);
    setDraft(null);
    pointer.current = null;
    if (event.shiftKey && page) {
      const index = pages.findIndex((q) => q.id === p.id);
      const low = Math.min(activeIndex, index);
      const high = Math.max(activeIndex, index);
      setSelected(new Set(pages.slice(low, high + 1).map((q) => q.id)));
    } else if (event.ctrlKey || event.metaKey)
      setSelected((old) => {
        const next = new Set(old);
        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
        return next;
      });
    else setSelected(new Set([p.id]));
  };
  const navigateRegion = (delta) => {
    const id = regionSession?.ids[regionSession.ids.indexOf(activeId) + delta];
    if (!id) return;
    setActiveId(id);
    setDraft(null);
    pointer.current = null;
    stage.current?.scrollTo({ top: 0, left: 0 });
  };
  const navigate = (delta) => {
    if (tool === "redact" && regionSession?.mode === "manual") {
      navigateRegion(delta);
      return;
    }
    const next = pages[activeIndex + delta];
    if (!next) return;
    setActiveId(next.id);
    setSelected(new Set([next.id]));
    setDraft(null);
    pointer.current = null;
    stage.current?.scrollTo({ top: 0, left: 0 });
  };
  const point = (e) => {
    const rect =
      pointer.current?.resizeBounds || e.currentTarget.getBoundingClientRect();
    return toBasePoint(
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      page.rotation,
    );
  };
  const beginCapture = (e, reference) => {
    if (operation.current || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const bounds = e.currentTarget.getBoundingClientRect();
    const origin = {
      x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)),
    };
    pointer.current = {
      capture: true,
      origin,
      bounds,
      page: reference,
      rect: { ...origin, width: 0, height: 0 },
    };
    setCaptureRect({ ...pointer.current.rect, pageId: reference.id });
    return;
  };
  const beginPan = (e) => {
    if (operation.current || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointer.current = {
      pan: true,
      x: e.clientX,
      y: e.clientY,
      left: stage.current.scrollLeft,
      top: stage.current.scrollTop,
    };
  };
  const beginShapeResize = (e, corner, annotation, box) => {
    if (operation.current || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const canvas = e.currentTarget
      .closest(".page-canvas")
      .querySelector(".annotation-canvas");
    pointer.current = {
      moveAnnotation: annotation,
      resizeCorner: corner,
      box,
      resizeBounds: canvas.getBoundingClientRect(),
    };
  };
  const pointerDown = (e) => {
    if (operation.current || !page || e.button !== 0 || tool === "laser")
      return;
    if (
      tool === "redact" &&
      regionSession &&
      !regionSession.ids.includes(page.id)
    ) {
      notify(
        "영역 작업에 포함된 페이지를 선택하거나 가리기 설정을 다시 열어 주세요.",
        true,
      );
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "capture") {
      beginCapture(e, page);
      return;
    }
    const p = point(e);
    if (tool === "move") {
      beginPan(e);
      return;
    }
    if (tool === "signature" && signature) {
      const width = Math.min(0.3, 1 - p.x);
      const height = Math.min(
        (width * page.width) / page.height / signature.aspect,
        1 - p.y,
      );
      if (width > 0.01 && height > 0.01)
        updateAnnotations([
          ...page.annotations,
          {
            id: uid(),
            type: "signature",
            ...p,
            width,
            height,
            dataUrl: signature.dataUrl,
          },
        ]);
      setTool("move");
      notify("서명을 추가했습니다.");
      return;
    }
    if (tool === "text") {
      setTextValue("");
      setModal({ type: "text", anchor: p, pageId: page.id });
      return;
    }
    const hit = [...page.annotations]
      .reverse()
      .find((a) => annotationHit(a, p, page));
    if (tool === "erase") {
      if (hit)
        updateAnnotations(page.annotations.filter((a) => a.id !== hit.id));
      return;
    }
    if (tool === "select") {
      setSelectedShapeId(hit?.type === "shape" ? hit.id : null);
      if (hit) {
        pointer.current = { moveAnnotation: hit, origin: p };
        setDraft(hit);
      } else
        notify(
          "이 앱에서 추가한 필기·도형·텍스트·서명을 드래그해 이동할 수 있습니다.",
        );
      return;
    }
    if (!["pen", "highlight", "redact", "shape"].includes(tool)) return;
    const annotation = {
      id: uid(),
      type: tool,
      color: tool === "redact" ? "#ffffff" : color,
      size,
      ...(tool === "shape" ? { shapeKind } : {}),
      ...(tool === "redact" ? { ...p, width: 0, height: 0 } : { points: [p] }),
    };
    pointer.current = {
      annotation,
      origin: p,
      reference: page,
      targetIds: new Set(
        regionSession?.mode === "repeat" ? regionSession.ids : [page.id],
      ),
    };
    setDraft(annotation);
  };
  const pointerMove = (e) => {
    const current = pointer.current;
    if (!current) return;
    if (current.capture) {
      const x = Math.max(
        0,
        Math.min(1, (e.clientX - current.bounds.left) / current.bounds.width),
      );
      const y = Math.max(
        0,
        Math.min(1, (e.clientY - current.bounds.top) / current.bounds.height),
      );
      current.rect = {
        x: Math.min(x, current.origin.x),
        y: Math.min(y, current.origin.y),
        width: Math.abs(x - current.origin.x),
        height: Math.abs(y - current.origin.y),
      };
      setCaptureRect({ ...current.rect, pageId: current.page.id });
      return;
    }
    if (current.pan) {
      stage.current.scrollLeft = current.left - (e.clientX - current.x);
      stage.current.scrollTop = current.top - (e.clientY - current.y);
      return;
    }
    if (current.resizeCorner) {
      const bounds = current.resizeBounds,
        before = current.box;
      const x = Math.max(
        0,
        Math.min(1, (e.clientX - bounds.left) / bounds.width),
      );
      const y = Math.max(
        0,
        Math.min(1, (e.clientY - bounds.top) / bounds.height),
      );
      const west = current.resizeCorner.includes("w"),
        north = current.resizeCorner.includes("n");
      const fixedX = west ? before.x + before.width : before.x;
      const fixedY = north ? before.y + before.height : before.y;
      const edgeX = west
        ? Math.min(x, fixedX - 0.01)
        : Math.max(x, fixedX + 0.01);
      const edgeY = north
        ? Math.min(y, fixedY - 0.01)
        : Math.max(y, fixedY + 0.01);
      const after = {
        x: Math.min(edgeX, fixedX),
        y: Math.min(edgeY, fixedY),
        width: Math.abs(edgeX - fixedX),
        height: Math.abs(edgeY - fixedY),
      };
      current.updated = {
        ...current.moveAnnotation,
        points: resizeShape(
          current.moveAnnotation.points,
          before,
          after,
          page.rotation,
        ),
      };
      setDraft(current.updated);
      return;
    }
    const p = point(e);
    if (current.moveAnnotation) {
      const a = current.moveAnnotation;
      const dx = p.x - current.origin.x;
      const dy = p.y - current.origin.y;
      const coords = a.points || [
        { x: a.x, y: a.y },
        { x: a.x + (a.width || 0), y: a.y + (a.height || 0) },
      ];
      const boundedX = Math.max(
        -Math.min(...coords.map((q) => q.x)),
        Math.min(dx, 1 - Math.max(...coords.map((q) => q.x))),
      );
      const boundedY = Math.max(
        -Math.min(...coords.map((q) => q.y)),
        Math.min(dy, 1 - Math.max(...coords.map((q) => q.y))),
      );
      current.updated = a.points
        ? {
            ...a,
            points: a.points.map((q) => ({
              ...q,
              x: q.x + boundedX,
              y: q.y + boundedY,
            })),
          }
        : { ...a, x: a.x + boundedX, y: a.y + boundedY };
      setDraft(current.updated);
      return;
    }
    const a = current.annotation;
    current.annotation =
      a.type === "shape"
        ? {
            ...a,
            points: shapePoints(
              a.shapeKind,
              current.origin,
              p,
              page.width / page.height,
            ),
          }
        : a.type === "redact"
          ? {
              ...a,
              x: Math.min(p.x, current.origin.x),
              y: Math.min(p.y, current.origin.y),
              width: Math.abs(p.x - current.origin.x),
              height: Math.abs(p.y - current.origin.y),
            }
          : { ...a, points: [...a.points, p] };
    setDraft(current.annotation);
  };
  const pointerUp = () => {
    const current = pointer.current;
    pointer.current = null;
    setDraft(null);
    setCaptureRect(null);
    if (current?.capture) {
      finishCapture(current);
      return;
    }
    if (!current || current.pan) return;
    if (current.moveAnnotation) {
      if (current.updated)
        updateAnnotations(
          page.annotations.map((a) =>
            a.id === current.updated.id ? current.updated : a,
          ),
        );
      return;
    }
    const a = current.annotation;
    if (a.type === "redact" && (a.width < 0.003 || a.height < 0.003)) return;
    if (
      a.type === "shape" &&
      (a.points.length < 2 ||
        !a.points.some(
          (p) =>
            Math.hypot(
              p.x - a.points[0].x,
              ((p.y - a.points[0].y) * page.height) / page.width,
            ) > 0.005,
        ))
    )
      return;
    if (a.type === "redact") {
      commit(
        applyRedaction(
          pagesRef.current,
          current.reference,
          a,
          current.targetIds,
        ),
      );
      notify(
        current.targetIds.size > 1
          ? `${current.targetIds.size}페이지의 같은 위치를 흰색으로 가렸습니다.`
          : "이 페이지의 지정 영역을 흰색으로 가렸습니다.",
      );
    } else updateAnnotations([...page.annotations, a]);
  };
  useEffect(() => {
    const key = (e) => {
      if (
        modal ||
        operation.current ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (!slide) return;
      if (e.key === "Escape") exitSlide();
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key.toLowerCase() === "l" && !e.ctrlKey && !e.metaKey) {
        setTool((old) => (old === "laser" ? "move" : "laser"));
        return;
      }
      if (presenting) return;
      const keys = {
        q: "move",
        v: "select",
        p: "pen",
        h: "highlight",
        g: "shape",
        t: "text",
        e: "erase",
      };
      if (keys[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey)
        chooseTool(keys[e.key.toLowerCase()]);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const closeModal = useCallback(() => {
    if (!operation.current) {
      setModal(null);
      setOcrReview(null);
    }
  }, []);
  const originalBytes = [...new Set(pages.map((p) => p.source))].reduce(
    (sum, s) => sum + s.bytes.length,
    0,
  );
  const currentSize = page ? rotatedSize(page) : { width: 595, height: 842 };
  const practiceReference =
    slide && !presenting && practicePairs[page?.id]
      ? pages.find((p) => p.id === practicePairs[page.id])
      : null;
  const practicePaneWidth = Math.max(120, (viewerSize.width - 84) / 2);
  const practiceWidth = (p) => {
    const dimensions = rotatedSize(p);
    return (
      (Math.min(
        practicePaneWidth,
        (Math.max(120, viewerSize.height - 76) * dimensions.width) /
          dimensions.height,
      ) *
        zoom) /
      100
    );
  };
  const fitWidth = Math.min(
    slide
      ? (Math.max(150, viewerSize.height - 44) * currentSize.width) /
          currentSize.height
      : 570,
    Math.max(150, viewerSize.width - (slide ? 36 : 88)),
  );
  const displayWidth = practiceReference
    ? practiceWidth(page)
    : (fitWidth * zoom) / 100;
  const displayedPage =
    page && draft && pointer.current?.moveAnnotation
      ? {
          ...page,
          annotations: page.annotations.filter((a) => a.id !== draft.id),
        }
      : page;
  const ocrPreviewPage = pages.find((p) => p.id === ocrPreviewId);
  const ocrPreview =
    ocrPreviewPage && ocrReview
      ? {
          ...ocrPreviewPage,
          annotations: [
            ...ocrPreviewPage.annotations,
            ...ocrReview.matches
              .filter(
                (m) =>
                  m.pageId === ocrPreviewId && ocrReview.selected.has(m.id),
              )
              .map((m) => matchAnnotation(m, ocrPreviewPage, "ocr-preview")),
          ],
        }
      : null;
  void historyVersion;

  return (
    <div
      ref={workspace}
      className={`app ${slide ? "presentation-mode" : ""} ${presenting ? "fullscreen-presentation" : ""} ${slide && tool === "laser" ? "laser-mode" : ""}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          if (!busy) setDropOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropOver(false);
        importFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={upload}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {!slide && (
        <>
          <div className="brand-strip">
            <span>선생님을 위한 작은 도구, 더 편한 수업 준비</span>
            <span>
              <LockKey size={13} /> 파일은 이 브라우저 안에서만 처리됩니다
            </span>
          </div>
        </>
      )}

      <div className="app-body">
        {!slide && (
          <aside className="action-sidebar" aria-label="문서 작업 도구">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (!pages.length) return;
                setModal({ type: "new" });
              }}
              aria-label="My PDF 작업실"
            >
              <span className="brand-mark">
                <FilePdf size={27} weight="bold" />
              </span>
              <span>
                <b>My</b> PDF<small>TEACHER’S PDF STUDIO</small>
              </span>
            </a>
            <div className="action-group">
              <ToolButton
                icon={FilePlus}
                disabled={!!busy}
                onClick={() =>
                  pages.length
                    ? setModal({ type: "new" })
                    : upload.current.click()
                }
              >
                새 작업
              </ToolButton>
              <ToolButton
                icon={FolderPlus}
                disabled={!!busy}
                onClick={() => upload.current.click()}
              >
                파일 추가
              </ToolButton>
              <ToolButton
                icon={ArrowsDownUp}
                className={assemblyView ? "active" : ""}
                disabled={!!busy}
                onClick={() => setAssemblyView((value) => !value)}
              >
                {assemblyView ? "페이지 편집으로 돌아가기" : "페이지 추출·병합"}
              </ToolButton>
              <span className="tool-divider" />
              <ToolButton
                icon={Copy}
                disabled={!targets.length || !!busy}
                onClick={copyText}
              >
                텍스트 복사
              </ToolButton>
              <ToolButton
                icon={ArrowClockwise}
                disabled={!targets.length || !!busy}
                onClick={() =>
                  commit(
                    pages.map((p) =>
                      selected.has(p.id)
                        ? { ...p, rotation: (p.rotation + 90) % 360 }
                        : p,
                    ),
                  )
                }
              >
                회전
              </ToolButton>
              <ToolButton
                icon={Trash}
                disabled={!targets.length || !!busy}
                onClick={() => {
                  commit(pages.filter((p) => !selected.has(p.id)));
                  setSelected(new Set());
                  notify(
                    `${targets.length}페이지를 삭제했습니다. 실행 취소로 복원할 수 있습니다.`,
                  );
                }}
              >
                삭제
              </ToolButton>
              <ToolButton
                icon={Signature}
                disabled={!page || !!busy}
                onClick={() => setModal({ type: "signature" })}
              >
                서명 추가
              </ToolButton>
              <ToolButton
                icon={ShieldCheck}
                disabled={!page || !!busy}
                active={tool === "redact"}
                onClick={() => setModal({ type: "redact" })}
              >
                개인정보 가리기
              </ToolButton>
              <ToolButton
                icon={ArrowUUpLeft}
                disabled={!past.current.length || !!busy}
                onClick={undo}
              >
                실행 취소
              </ToolButton>
            </div>
            <div className="action-group">
              <ToolButton
                icon={Presentation}
                disabled={!page || !!busy}
                onClick={startSlide}
              >
                슬라이드 재생
              </ToolButton>
              <ToolButton
                icon={FileArrowDown}
                disabled={!pages.length || !!busy}
                onClick={() => setModal({ type: "compress" })}
              >
                용량 줄이기
              </ToolButton>
              <ToolButton
                icon={FloppyDisk}
                className="primary save-button"
                disabled={!pages.length || !!busy}
                onClick={() => save()}
              >
                저장
              </ToolButton>
            </div>
          </aside>
        )}
        <main
          className={`workspace ${assemblyView && !slide ? "assembly-workspace" : !slide ? "editor-workspace" : ""}`}
        >
          {assemblyView && !slide ? (
            <PdfAssembler
              pages={pages}
              selected={selected}
              setSelected={setSelected}
              entries={assembly}
              busy={!!busy}
              onAddFiles={() => upload.current.click()}
              onChange={(next) => {
                setAssembly(next);
                setAssemblyDirty(true);
              }}
              onSave={(newPages, name) => save(null, newPages, name, true)}
            />
          ) : (
            <>
              {!slide && (
                <aside className="page-strip" aria-label="페이지 목록">
                  <div className="page-strip-heading">
                    <div>
                      <strong>페이지</strong>
                      <span>{pages.length ? `${pages.length}쪽` : "0쪽"}</span>
                      <span className="page-strip-guide">
                        드래그해서 순서 변경 · 가로로 스크롤
                      </span>
                    </div>
                    <button
                      className="text-button"
                      disabled={!pages.length || !!busy}
                      onClick={() =>
                        setSelected(
                          selected.size === pages.length
                            ? new Set()
                            : new Set(pages.map((p) => p.id)),
                        )
                      }
                    >
                      {pages.length && selected.size === pages.length
                        ? "선택 해제"
                        : "전체 선택"}
                    </button>
                  </div>
                  {!pages.length ? (
                    <p className="page-strip-empty">
                      문서를 추가하면 페이지가 여기에 나타나요
                    </p>
                  ) : (
                    <div
                      className="thumbnails page-strip-list"
                      tabIndex={0}
                      aria-label="페이지 미리보기 · 가로 스크롤"
                    >
                      {pages.map((p, i) => (
                        <div
                          className={`thumbnail ${selected.has(p.id) ? "selected" : ""} ${p.id === page?.id ? "current" : ""}`}
                          key={p.id}
                          draggable={!busy}
                          onDragStart={(e) => {
                            draggingPage.current = p.id;
                            e.dataTransfer.setData("text/plain", p.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            if (draggingPage.current && !busy)
                              e.preventDefault();
                          }}
                          onDragEnd={() => {
                            draggingPage.current = null;
                          }}
                          onDrop={(e) => {
                            if (!draggingPage.current || busy) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const from = pages.findIndex(
                              (q) => q.id === draggingPage.current,
                            );
                            const next = [...pages];
                            const [moved] = next.splice(from, 1);
                            next.splice(i, 0, moved);
                            draggingPage.current = null;
                            commit(next);
                          }}
                        >
                          <input
                            className="page-checkbox"
                            type="checkbox"
                            checked={selected.has(p.id)}
                            aria-label={`${i + 1}페이지 선택`}
                            disabled={!!busy}
                            onChange={() =>
                              setSelected((old) => {
                                const next = new Set(old);
                                next.has(p.id)
                                  ? next.delete(p.id)
                                  : next.add(p.id);
                                return next;
                              })
                            }
                          />
                          <button
                            className="thumbnail-open"
                            aria-label={`${i + 1}페이지 보기`}
                            disabled={!!busy}
                            onClick={(e) => selectPage(p, e)}
                          >
                            <div className="page-strip-preview">
                              <PageCanvas
                                page={p}
                                width={Math.min(
                                  96,
                                  (124 * rotatedSize(p).width) /
                                    rotatedSize(p).height,
                                )}
                                thumbnail
                              />
                            </div>
                            <span>{i + 1}</span>
                          </button>
                          {p.annotations.length > 0 && (
                            <span
                              className="annotation-indicator"
                              title="편집한 페이지"
                            >
                              <PencilSimple size={12} />
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              )}

              <section className="document-area" aria-label="문서 작업 공간">
                {page && !presenting && (
                  <div
                    className={`document-heading ${slide ? "slide-heading" : ""}`}
                  >
                    <div className="document-name">
                      <FilePdf size={18} />
                      <span title={page.source.name}>{page.source.name}</span>
                      {dirty && (
                        <span
                          className="unsaved-dot"
                          title="저장하지 않은 변경 사항"
                        />
                      )}
                    </div>
                    <div className="document-controls">
                      {!slide && (
                        <div
                          className="document-zoom"
                          role="group"
                          aria-label="문서 확대 및 축소"
                        >
                          <button
                            className="icon-button"
                            aria-label="문서 축소"
                            title="축소"
                            disabled={zoom <= 30 || !!busy}
                            onClick={() => setZoom((z) => Math.max(30, z - 10))}
                          >
                            <Minus size={16} />
                          </button>
                          <span className="zoom-value">{zoom}%</span>
                          <button
                            className="icon-button"
                            aria-label="문서 확대"
                            title="확대"
                            disabled={zoom >= 250 || !!busy}
                            onClick={() =>
                              setZoom((z) => Math.min(250, z + 10))
                            }
                          >
                            <Plus size={16} />
                          </button>
                          <button
                            className="text-button"
                            aria-label="문서 화면에 맞춤"
                            disabled={!!busy}
                            onClick={() => setZoom(100)}
                          >
                            <CornersOut size={16} /> 화면에 맞춤
                          </button>
                          <button
                            className="text-button"
                            onClick={() => startSlide("present")}
                            disabled={!!busy}
                          >
                            <Presentation size={16} /> 프레젠테이션
                          </button>
                        </div>
                      )}
                      <div className="page-navigation">
                        <button
                          className="icon-button"
                          aria-label="이전 페이지"
                          disabled={activeIndex === 0 || !!busy}
                          onClick={() => navigate(-1)}
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <span>
                          {activeIndex + 1}
                          <i>/ {pages.length}</i>
                        </span>
                        <button
                          className="icon-button"
                          aria-label="다음 페이지"
                          disabled={activeIndex === pages.length - 1 || !!busy}
                          onClick={() => navigate(1)}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {page && !slide && (
                  <div
                    className={`document-hint ${tool !== "move" ? "editing" : ""}`}
                  >
                    {tool === "redact" ? (
                      <>
                        <ShieldCheck size={16} />
                        <span>
                          가릴 영역을 드래그하세요 ·{" "}
                          {regionSession?.mode === "repeat"
                            ? `${regionSession.ids.length}페이지의 같은 위치에 적용합니다.`
                            : regionSession?.mode === "manual"
                              ? "이 페이지에만 적용합니다. 페이지를 넘겨 각각 지정하세요."
                              : "선택한 한 페이지에만 적용합니다."}
                        </span>
                      </>
                    ) : tool === "signature" ? (
                      <>
                        <Signature size={16} />
                        <span>문서에서 서명을 넣을 위치를 클릭하세요.</span>
                      </>
                    ) : (
                      <>
                        <Info size={15} />
                        <span>
                          페이지를 선택해 편집하세요. 여러 페이지는 Ctrl / ⌘
                          또는 Shift와 함께 선택할 수 있어요.
                        </span>
                      </>
                    )}
                    {tool === "redact" && regionSession?.mode === "manual" && (
                      <div className="region-navigation">
                        <button
                          className="text-button"
                          disabled={regionSession.ids.indexOf(activeId) <= 0}
                          onClick={() => navigateRegion(-1)}
                        >
                          이전 작업 페이지
                        </button>
                        <span>
                          {Math.max(0, regionSession.ids.indexOf(activeId) + 1)}{" "}
                          / {regionSession.ids.length}쪽
                        </span>
                        <button
                          className="text-button"
                          disabled={
                            regionSession.ids.indexOf(activeId) < 0 ||
                            regionSession.ids.indexOf(activeId) >=
                              regionSession.ids.length - 1
                          }
                          onClick={() => navigateRegion(1)}
                        >
                          다음 작업 페이지
                        </button>
                      </div>
                    )}
                    {tool !== "move" && (
                      <button
                        className="text-button"
                        onClick={() => setTool("move")}
                      >
                        완료
                      </button>
                    )}
                  </div>
                )}
                <div
                  className="document-viewport"
                  onPointerMove={(e) => {
                    if (!slide || !page) return;
                    const bounds = e.currentTarget.getBoundingClientRect();
                    setZoomVisible(e.clientY >= bounds.bottom - 90);
                  }}
                  onPointerLeave={() => setZoomVisible(false)}
                >
                  <div
                    ref={stage}
                    className={`document-stage ${!page ? "empty-stage" : ""} ${slide && tool === "laser" ? "laser-active" : ""}`}
                    onPointerMove={moveLaser}
                    onPointerLeave={clearLaser}
                    onPointerCancel={clearLaser}
                  >
                    {page ? (
                      practiceReference ? (
                        <div className="two-page-spread">
                          <section
                            className="practice-pane"
                            aria-label="왼쪽 참고 페이지"
                            style={{ width: practiceWidth(practiceReference) }}
                          >
                            <div className="practice-pane-label">
                              참고 페이지 ·{" "}
                              {pages.indexOf(practiceReference) + 1}쪽
                            </div>
                            <PageCanvas
                              page={practiceReference}
                              width={practiceWidth(practiceReference)}
                              tool={tool === "capture" ? "capture" : "move"}
                              captureRect={
                                captureRect?.pageId === practiceReference.id
                                  ? captureRect
                                  : null
                              }
                              onPointerDown={
                                tool === "capture"
                                  ? (e) => beginCapture(e, practiceReference)
                                  : tool === "move"
                                    ? beginPan
                                    : undefined
                              }
                              onPointerMove={pointerMove}
                              onPointerUp={pointerUp}
                              onPointerCancel={() => {
                                pointer.current = null;
                                setCaptureRect(null);
                              }}
                            />
                          </section>
                          <section
                            className="practice-pane"
                            aria-label="오른쪽 연습 페이지"
                            style={{ width: practiceWidth(page) }}
                          >
                            <div className="practice-pane-label">
                              연습 페이지 · {activeIndex + 1}쪽
                            </div>
                            <PageCanvas
                              page={displayedPage}
                              width={displayWidth}
                              tool={tool}
                              draft={draft}
                              selectedShape={
                                tool === "select"
                                  ? draft?.id === selectedShapeId
                                    ? draft
                                    : page.annotations.find(
                                        (a) => a.id === selectedShapeId,
                                      )
                                  : null
                              }
                              onShapeResize={beginShapeResize}
                              captureRect={
                                captureRect?.pageId === page.id
                                  ? captureRect
                                  : null
                              }
                              onPointerCancel={() => {
                                pointer.current = null;
                                setCaptureRect(null);
                                setDraft(null);
                              }}
                              onPointerDown={pointerDown}
                              onPointerMove={pointerMove}
                              onPointerUp={pointerUp}
                            />
                          </section>
                        </div>
                      ) : (
                        <PageCanvas
                          page={displayedPage}
                          width={displayWidth}
                          tool={tool}
                          draft={draft}
                          selectedShape={
                            tool === "select"
                              ? draft?.id === selectedShapeId
                                ? draft
                                : page.annotations.find(
                                    (a) => a.id === selectedShapeId,
                                  )
                              : null
                          }
                          onShapeResize={beginShapeResize}
                          captureRect={
                            captureRect?.pageId === page.id ? captureRect : null
                          }
                          onPointerCancel={() => {
                            pointer.current = null;
                            setCaptureRect(null);
                            setDraft(null);
                          }}
                          onPointerDown={pointerDown}
                          onPointerMove={pointerMove}
                          onPointerUp={pointerUp}
                        />
                      )
                    ) : (
                      <div className="empty-state">
                        <h1>
                          수업 준비가
                          <br />
                          <em>조금 더 가벼워지도록.</em>
                        </h1>
                        <button
                          className="upload-zone"
                          disabled={!!busy}
                          onClick={() => upload.current.click()}
                        >
                          <UploadSimple size={28} />
                          <strong>PDF 파일을 여기에 놓아주세요</strong>
                          <span>
                            또는 클릭해서 파일 선택 · 여러 파일 추가 가능
                          </span>
                          <span className="file-limit">파일당 최대 100MB</span>
                        </button>
                        <div className="empty-features">
                          <span>
                            <FolderPlus size={18} />
                            모으고 편집
                          </span>
                          <span>
                            <ShieldCheck size={18} />
                            안전하게 가리기
                          </span>
                          <span>
                            <Presentation size={18} />
                            수업하며 필기
                          </span>
                        </div>
                        <p className="privacy-note">
                          <LockKey size={13} /> 파일을 서버에 업로드하지
                          않습니다.
                        </p>
                      </div>
                    )}
                  </div>
                  {slide && page && (
                    <div
                      className={`canvas-zoom ${zoomVisible ? "visible" : ""}`}
                      role="group"
                      aria-label="캔버스 확대·축소"
                      onPointerMove={(e) => e.stopPropagation()}
                    >
                      <button
                        className="icon-button"
                        aria-label="축소"
                        disabled={zoom <= 30}
                        onClick={() => setZoom((z) => Math.max(30, z - 10))}
                      >
                        <Minus size={20} />
                      </button>
                      <span aria-live="polite">{zoom}%</span>
                      <button
                        className="icon-button"
                        aria-label="확대"
                        disabled={zoom >= 250}
                        onClick={() => setZoom((z) => Math.min(250, z + 10))}
                      >
                        <Plus size={20} />
                      </button>
                      <ToolButton
                        icon={CornersOut}
                        onClick={() => setZoom(100)}
                      >
                        맞춤
                      </ToolButton>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {slide ? (
        <>
          {!presenting && (
            <div className="slide-options">
              <span>
                {tool === "capture"
                  ? "캡처할 영역을 드래그하세요. 캡처는 페이지를 넘겨도 화면 위에 유지됩니다."
                  : tool === "laser"
                    ? "마우스를 움직여 가리키세요. L 키로 레이저 포인터를 켜고 끌 수 있어요."
                    : tool === "move"
                      ? "드래그로 화면을 이동하세요. 방향키로 페이지를 넘길 수 있어요."
                      : tool === "select"
                        ? "추가한 필기·도형·텍스트·서명을 드래그해 이동하세요."
                        : tool === "erase"
                          ? "지울 필기·도형·텍스트를 클릭하세요."
                          : tool === "shape"
                            ? "도형을 선택하고 문서 위에서 드래그하세요."
                            : "문서 위에 바로 필기하세요."}
              </span>
              {["pen", "highlight", "text", "shape"].includes(tool) && (
                <div className="drawing-options">
                  <div
                    className="color-palette"
                    role="group"
                    aria-label={
                      tool === "highlight"
                        ? "형광펜 색상 팔레트"
                        : "필기 색상 팔레트"
                    }
                  >
                    {(tool === "highlight" ? highlightPalette : penPalette).map(
                      ([name, value]) => (
                        <button
                          key={value}
                          className="color-swatch"
                          style={{ background: value }}
                          aria-label={`${name} 색상`}
                          title={name}
                          aria-pressed={color === value}
                          onClick={() => {
                            setColor(value);
                            colorMemory.current[tool] = value;
                          }}
                        />
                      ),
                    )}
                  </div>
                  <label>
                    크기{" "}
                    <input
                      type="range"
                      aria-label="필기 크기"
                      min="0.002"
                      max="0.015"
                      step="0.001"
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          <footer className="slide-toolbar">
            <div className="slide-toolgroup">
              <ToolButton
                icon={ArrowLeft}
                disabled={activeIndex === 0}
                onClick={() => navigate(-1)}
              >
                이전
              </ToolButton>
              <span className="slide-page-number">
                {activeIndex + 1} / {pages.length}
              </span>
              <ToolButton
                icon={ArrowRight}
                disabled={activeIndex === pages.length - 1}
                onClick={() => navigate(1)}
              >
                다음
              </ToolButton>
            </div>
            {!presenting && (
              <div className="slide-toolgroup">
                {[
                  [Hand, "이동", "move"],
                  [Cursor, "선택", "select"],
                  [PencilSimple, "펜", "pen"],
                  [Highlighter, "형광펜", "highlight"],
                  [Shapes, "도형", "shape"],
                  [TextT, "텍스트", "text"],
                  [Eraser, "지우개", "erase"],
                ].map(([Icon, label, value]) =>
                  value === "shape" ? (
                    <div className="shape-picker" key={value}>
                      <ToolButton
                        icon={Icon}
                        active={tool === value}
                        aria-haspopup="menu"
                        aria-expanded={shapeMenu}
                        onClick={() => {
                          chooseTool(value);
                          setShapeMenu(!shapeMenu);
                        }}
                      >
                        {label}
                      </ToolButton>
                      {shapeMenu && (
                        <div
                          className="shape-menu"
                          role="menu"
                          aria-label="도형 종류"
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") setShapeMenu(false);
                          }}
                        >
                          {shapeOptions.map(([kind, title]) => (
                            <button
                              key={kind}
                              role="menuitemradio"
                              aria-checked={shapeKind === kind}
                              onClick={() => {
                                setShapeKind(kind);
                                setShapeMenu(false);
                              }}
                            >
                              {title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <ToolButton
                      key={value}
                      icon={Icon}
                      active={tool === value}
                      onClick={() => chooseTool(value)}
                    >
                      {label}
                    </ToolButton>
                  ),
                )}
              </div>
            )}
            <div className="slide-toolgroup">
              <ToolButton
                icon={Cursor}
                active={tool === "laser"}
                onClick={() => {
                  setTool((old) => (old === "laser" ? "move" : "laser"));
                  setDraft(null);
                  pointer.current = null;
                }}
              >
                레이저 포인터
              </ToolButton>
            </div>
            {!presenting && (
              <div className="slide-toolgroup">
                <ToolButton
                  icon={ArrowUUpLeft}
                  disabled={!past.current.length}
                  onClick={undo}
                >
                  취소
                </ToolButton>
                <ToolButton
                  icon={ArrowUUpRight}
                  disabled={!future.current.length}
                  onClick={redo}
                >
                  다시
                </ToolButton>
                <ToolButton
                  icon={Trash}
                  disabled={!page?.annotations.length}
                  onClick={() => setModal({ type: "clear" })}
                >
                  쪽 지우기
                </ToolButton>
              </div>
            )}
            <div className="slide-toolgroup">
              {!presenting && (
                <>
                  <ToolButton
                    icon={CornersOut}
                    active={tool === "capture"}
                    disabled={!!busy}
                    onClick={() => {
                      setTool((old) =>
                        old === "capture" ? "move" : "capture",
                      );
                      setDraft(null);
                      setCaptureRect(null);
                      pointer.current = null;
                    }}
                  >
                    캡처 모드
                  </ToolButton>
                </>
              )}
              {!presenting && (
                <ToolButton
                  icon={Presentation}
                  onClick={() => startSlide("present")}
                >
                  프레젠테이션
                </ToolButton>
              )}
              {!presenting && (
                <ToolButton
                  icon={FilePlus}
                  disabled={!!busy}
                  onClick={addBlankPage}
                >
                  빈 페이지 추가
                </ToolButton>
              )}
              {presenting && (
                <ToolButton
                  icon={Presentation}
                  disabled={!!busy}
                  onClick={() => {
                    setPresenting(false);
                    setTool("move");
                    setDraft(null);
                    setCaptureRect(null);
                    setLaserPoint(null);
                    setLaserTrail([]);
                    pointer.current = null;
                  }}
                >
                  슬라이드 재생으로 돌아가기
                </ToolButton>
              )}
              <ToolButton
                icon={SignOut}
                className="primary"
                onClick={exitSlide}
              >
                종료
              </ToolButton>
            </div>
            {!presenting && (
              <button
                className="shortcut-link"
                onClick={() => setModal({ type: "shortcuts" })}
              >
                <Keyboard size={15} /> 단축키 보기
              </button>
            )}
          </footer>
        </>
      ) : (
        <footer className="statusbar">
          <span>
            {pages.length ? (
              <>
                총 <b>{pages.length}</b>페이지 중 <b>{selected.size}</b>페이지
                선택{" "}
                <span className="status-size">
                  · {readableSize(originalBytes)}
                </span>
              </>
            ) : (
              "PDF를 추가해 작업을 시작하세요"
            )}
          </span>
          <div>
            <span className="status-ready">
              <span />
              {busy ? "처리 중" : "브라우저에서 안전하게"}
            </span>
            <span className="tool-divider" />
            <button
              className="icon-button"
              aria-label="축소"
              disabled={!page || zoom <= 30}
              onClick={() => setZoom((z) => Math.max(30, z - 10))}
            >
              <Minus size={16} />
            </button>
            <span className="zoom-value">{zoom}%</span>
            <button
              className="icon-button"
              aria-label="확대"
              disabled={!page || zoom >= 250}
              onClick={() => setZoom((z) => Math.min(250, z + 10))}
            >
              <Plus size={16} />
            </button>
            <button
              className="text-button"
              disabled={!page}
              onClick={() => setZoom(100)}
            >
              화면에 맞춤
            </button>
          </div>
        </footer>
      )}

      {slide &&
        captures.map((capture) => (
          <PinnedCapture
            key={capture.id}
            capture={capture}
            tool={tool}
            color={color}
            size={size}
            shapeKind={shapeKind}
            onLaserMove={moveLaser}
            onLaserLeave={clearLaser}
            onChange={(next) =>
              setCaptures((old) =>
                old.map((c) => (c.id === next.id ? next : c)),
              )
            }
            onClose={() =>
              setCaptures((old) => old.filter((c) => c.id !== capture.id))
            }
          />
        ))}
      {slide && tool === "laser" && laserPoint && (
        <svg className="laser-overlay" aria-hidden="true">
          <polyline
            points={laserTrail.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#ff3030"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.65"
          />
          <circle cx={laserPoint.x} cy={laserPoint.y} r="6" fill="#ff3030" />
          <circle cx={laserPoint.x} cy={laserPoint.y} r="2" fill="#fff4e5" />
        </svg>
      )}
      {dropOver && (
        <div className="drop-overlay">
          <UploadSimple size={52} />
          <h2>여기에 PDF를 놓아주세요</h2>
          <p>여러 파일을 한 번에 추가할 수 있어요</p>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <CheckCircle size={20} />
          <span>{toast.message}</span>
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status" aria-live="polite">
          <span className="spinner" />
          <span>{busy}</span>
          <small>큰 문서는 시간이 조금 걸릴 수 있어요.</small>
          {ocrAbort.current && (
            <ToolButton
              onClick={() => {
                ocrAbort.current?.abort();
                setBusy("OCR을 취소하는 중…");
              }}
            >
              OCR 취소
            </ToolButton>
          )}
        </div>
      )}

      {modal && (
        <Modal
          title={
            {
              compress: "용량 줄이기",
              redact: "개인정보 가리기",
              "ocr-review": "OCR 검색 결과 확인",
              signature: "서명 추가",
              text: "텍스트 추가",
              new: "새 작업 시작",
              clear: "이 페이지의 편집 지우기",
              shortcuts: "슬라이드 단축키",
              "slide-exit": "수업 작업을 저장할까요?",
              copy: "텍스트 복사",
            }[modal.type] || modal.title
          }
          onClose={closeModal}
          busy={!!busy}
          wide={modal.type === "signature" || modal.type === "ocr-review"}
          columns={modal.type === "redact"}
        >
          {modal.type === "slide-exit" && (
            <>
              <p className="modal-description">
                추가한 빈 페이지와 이번 슬라이드 작업의 필기를 원본 페이지와
                함께 새 PDF로 저장할 수 있습니다. 캡처 창은 저장되지 않습니다.
              </p>
              <p className="modal-footnote">
                저장하지 않으면 슬라이드 시작 전 상태로 돌아갑니다. 원본 파일과
                시작 전에 편집한 내용은 유지됩니다.
              </p>
              <div className="modal-footer slide-exit-actions">
                <ToolButton disabled={!!busy} onClick={closeModal}>
                  취소
                </ToolButton>
                <ToolButton
                  className="primary"
                  data-default-focus
                  disabled={!!busy}
                  onClick={discardSlide}
                >
                  저장하지 않고 종료
                </ToolButton>
                <ToolButton
                  icon={FloppyDisk}
                  disabled={!!busy}
                  onClick={async () => {
                    const name = (
                      slideSession.current?.pages[0]?.source.name || "문서.pdf"
                    ).replace(/\.pdf$/i, "");
                    if (await save(null, pagesRef.current, `${name}_수업.pdf`))
                      finishSlide();
                  }}
                >
                  저장하고 종료
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "compress" && (
            <>
              <p className="modal-description">
                페이지를 이미지로 변환해 저장합니다. 변환된 PDF에서는 글자
                검색·복사를 사용할 수 없습니다. 원본에 따라 용량이 커질 수도
                있어요.
              </p>
              <div className="compression-options">
                {compressionPresets.map((preset) => (
                  <label
                    key={preset.id}
                    className={`compression-option ${compression === preset.id ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="compression"
                      value={preset.id}
                      checked={compression === preset.id}
                      disabled={!!busy}
                      onChange={() => setCompression(preset.id)}
                    />
                    <span>
                      <strong>{preset.title}</strong>
                      <small>{preset.description}</small>
                    </span>
                    {compression === preset.id && (
                      <span className="recommendation">
                        {preset.id === 150 ? "추천" : "선택"}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <p className="modal-footnote">
                현재 원본 파일 합계 {readableSize(originalBytes)} · 편집한
                내용도 포함됩니다
              </p>
              <div className="modal-footer">
                <ToolButton disabled={!!busy} onClick={closeModal}>
                  취소
                </ToolButton>
                <ToolButton
                  icon={FileArrowDown}
                  className="primary"
                  disabled={!!busy}
                  onClick={() =>
                    save(compressionPresets.find((p) => p.id === compression))
                  }
                >
                  변환 후 다운로드
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "redact" && (
            <>
              <div className="notice-icon">
                <ShieldCheck size={30} />
              </div>
              <p className="modal-description">
                지정한 영역이나 검색한 단어를 흰색으로 가립니다. 안전한 공유를
                위해 저장할 때 문서 전체를 새 이미지 PDF로 만듭니다. 저장한
                파일에서는 원래 글자를 검색하거나 복사할 수 없습니다.
              </p>
              <div className="redaction-columns">
                <section
                  className="redaction-panel"
                  aria-labelledby="region-heading"
                >
                  <label className="redaction-panel-heading">
                    <input
                      type="checkbox"
                      name="redaction-region"
                      checked={redactionMethods.region}
                      onChange={(e) =>
                        setRedactionMethods((old) => ({
                          ...old,
                          region: e.target.checked,
                        }))
                      }
                    />
                    <strong id="region-heading">영역 관리</strong>
                    <small>기본값</small>
                  </label>
                  <p className="modal-footnote">
                    드래그한 영역을 흰색으로 가립니다.
                  </p>
                  <fieldset
                    className="redaction-scope"
                    disabled={!redactionMethods.region}
                  >
                    <legend>영역 작업 방식</legend>
                    {[
                      [
                        "single",
                        "선택한 페이지",
                        "지금 보고 있는 한 페이지에 직접 영역 지정",
                      ],
                      [
                        "manual",
                        "여러 페이지",
                        "페이지를 넘기며 각 페이지에 수작업으로 영역 지정",
                      ],
                      [
                        "repeat",
                        "반복 페이지",
                        "한 번 지정한 영역을 여러 페이지의 같은 위치에 자동 적용",
                      ],
                    ].map(([value, title, description]) => (
                      <label
                        key={value}
                        className={`compression-option ${regionMode === value ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="region-mode"
                          value={value}
                          checked={regionMode === value}
                          onChange={() => setRegionMode(value)}
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {regionMode === "repeat" && (
                    <fieldset
                      className="redaction-scope region-targets"
                      disabled={!redactionMethods.region}
                    >
                      <legend>같은 위치를 반복 적용할 페이지</legend>
                      {[
                        [
                          "selected",
                          `선택한 페이지 (현재 ${selected.size}쪽 선택)`,
                          "아래에서 여러 페이지를 선택하면 같은 위치를 선택한 페이지마다 가립니다.",
                        ],
                        [
                          "all",
                          `전체 페이지 (${pages.length}쪽)`,
                          "문서의 모든 페이지에서 같은 위치를 가립니다.",
                        ],
                      ].map(([value, title, description]) => (
                        <label
                          key={value}
                          className={`compression-option ${regionScope === value ? "selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="region-scope"
                            value={value}
                            checked={regionScope === value}
                            onChange={() => setRegionScope(value)}
                          />
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                      {regionScope === "selected" && (
                        <div className="repeat-page-picker">
                          <div className="repeat-page-actions">
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                setSelected(new Set(pages.map((p) => p.id)))
                              }
                            >
                              전체 선택
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setSelected(new Set())}
                            >
                              선택 해제
                            </button>
                          </div>
                          <div
                            className="repeat-page-list"
                            role="group"
                            aria-label="반복 가리기를 적용할 페이지 선택"
                          >
                            {pages.map((p, i) => (
                              <label
                                key={p.id}
                                title={`${p.source.name} · 원본 ${p.index + 1}쪽`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected.has(p.id)}
                                  aria-label={`반복 적용 ${i + 1}페이지 선택`}
                                  onChange={() =>
                                    setSelected((old) => {
                                      const next = new Set(old);
                                      next.has(p.id)
                                        ? next.delete(p.id)
                                        : next.add(p.id);
                                      return next;
                                    })
                                  }
                                />
                                {i + 1}쪽
                              </label>
                            ))}
                          </div>
                          <p className="modal-footnote">
                            표시된 쪽 수는 현재 선택한 페이지 수입니다. 위
                            미리보기 목록의 선택과 함께 바뀝니다.
                          </p>
                        </div>
                      )}
                    </fieldset>
                  )}
                  <p className="modal-footnote">
                    {regionMode === "repeat"
                      ? "같은 서식의 페이지에 사용하세요. 크기가 다르면 같은 비율의 위치에 적용됩니다. 저장 전 가린 위치를 확인하세요."
                      : regionMode === "manual"
                        ? "이전·다음 작업 페이지로 이동해 각각 가리세요. 다른 페이지에 영역이 자동 복사되지 않습니다."
                        : "전체 문서를 자유롭게 이동하며 현재 페이지에만 영역을 지정합니다."}
                  </p>
                </section>
                <section
                  className="redaction-panel"
                  aria-labelledby="ocr-heading"
                >
                  <label className="redaction-panel-heading">
                    <input
                      type="checkbox"
                      name="redaction-ocr"
                      checked={redactionMethods.ocr}
                      onChange={(e) =>
                        setRedactionMethods((old) => ({
                          ...old,
                          ocr: e.target.checked,
                        }))
                      }
                    />
                    <strong id="ocr-heading">OCR 관리</strong>
                  </label>
                  <p className="modal-footnote">
                    브라우저에서 한국어·영어를 인식해 단어를 찾습니다.
                  </p>
                  <fieldset
                    className="redaction-scope"
                    disabled={!redactionMethods.ocr}
                  >
                    <legend>단어를 검색할 페이지</legend>
                    {[
                      [
                        "current",
                        "현재 페이지",
                        "지금 보고 있는 한 페이지에서만 단어를 찾습니다.",
                      ],
                      [
                        "selected",
                        `선택한 페이지 (현재 ${selected.size}쪽 선택)`,
                        "상단 미리보기 목록에서 체크한 여러 페이지에서 단어를 찾습니다.",
                      ],
                      [
                        "all",
                        `전체 페이지 (${pages.length}쪽)`,
                        "문서의 모든 페이지에서 단어를 찾습니다.",
                      ],
                    ].map(([value, title, description]) => (
                      <label
                        key={value}
                        className={`compression-option ${ocrScope === value ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="ocr-scope"
                          value={value}
                          checked={ocrScope === value}
                          disabled={value === "selected" && !selected.size}
                          onChange={() => setOcrScope(value)}
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ))}
                    <div className="ocr-word-input">
                      <label htmlFor="ocr-terms">
                        가릴 단어 · 줄바꿈 또는 쉼표로 구분
                      </label>
                      <textarea
                        id="ocr-terms"
                        className="text-editor"
                        rows="3"
                        maxLength={5000}
                        value={ocrTerms}
                        onChange={(e) => setOcrTerms(e.target.value)}
                        placeholder={"한성\n한성여자고등학교"}
                      />
                    </div>
                  </fieldset>
                  <p className="modal-footnote">
                    최대 100개. OCR은 오인식·누락이 있을 수 있습니다. 인식된
                    위치를 확인한 뒤 적용하세요. 문서는 서버로 보내지 않습니다.
                  </p>
                </section>
              </div>
              {redactionMethods.region && redactionMethods.ocr && (
                <p className="inline-notice">
                  OCR 결과를 확인해 적용한 뒤, 추가로 가릴 영역을 직접 지정할 수
                  있습니다. 두 방식의 가림 영역은 함께 저장됩니다.
                </p>
              )}
              <div className="inline-notice">
                <LockKey size={18} />
                <span>
                  원본 파일은 그대로 유지됩니다. 공유할 때는 새로 저장한 파일을
                  사용하세요.
                </span>
              </div>
              <div className="modal-footer">
                <ToolButton onClick={closeModal}>취소</ToolButton>
                <ToolButton
                  icon={ShieldCheck}
                  className="primary"
                  disabled={
                    (!redactionMethods.region && !redactionMethods.ocr) ||
                    (redactionMethods.region &&
                      regionMode === "repeat" &&
                      regionScope === "selected" &&
                      !selected.size) ||
                    (redactionMethods.ocr &&
                      ocrScope === "selected" &&
                      !selected.size) ||
                    (redactionMethods.ocr && !parseTerms(ocrTerms).length)
                  }
                  onClick={redactionMethods.ocr ? startOcr : beginRegion}
                >
                  {redactionMethods.ocr ? "OCR로 단어 찾기" : "영역 지정"}
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "ocr-review" && ocrReview && (
            <>
              <p className="modal-description">
                {ocrReview.scannedPages}페이지에서 {ocrReview.matches.length}
                곳을 찾았습니다. 초록색 표시를 확인하고 가릴 결과를 선택하세요.
                검색되지 않은 개인정보가 있을 수 있으므로 적용 후에도 문서를
                확인하세요.
              </p>
              {ocrReview.matches.length ? (
                <div className="ocr-review-layout">
                  <div className="ocr-result-list">
                    <button
                      className="text-button"
                      onClick={() =>
                        setOcrReview((old) => ({
                          ...old,
                          selected:
                            old.selected.size === old.matches.length
                              ? new Set()
                              : new Set(old.matches.map((m) => m.id)),
                        }))
                      }
                    >
                      {ocrReview.selected.size === ocrReview.matches.length
                        ? "전체 선택 해제"
                        : "전체 선택"}
                    </button>
                    {ocrReview.matches.map((match) => (
                      <div
                        key={match.id}
                        className={`ocr-result ${match.pageId === ocrPreviewId ? "current" : ""}`}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={ocrReview.selected.has(match.id)}
                            onChange={() =>
                              setOcrReview((old) => {
                                const checked = new Set(old.selected);
                                checked.has(match.id)
                                  ? checked.delete(match.id)
                                  : checked.add(match.id);
                                return { ...old, selected: checked };
                              })
                            }
                          />
                          <span>
                            <strong>{match.term}</strong>
                            <small>
                              {pages.findIndex((p) => p.id === match.pageId) +
                                1}
                              페이지 · 인식 신뢰도 {match.confidence}%
                              {match.confidence < 70 ? " · 확인 필요" : ""}
                            </small>
                          </span>
                        </label>
                        <button
                          className="text-button"
                          onClick={() => setOcrPreviewId(match.pageId)}
                        >
                          위치 보기
                        </button>
                      </div>
                    ))}
                  </div>
                  {ocrPreview && (
                    <div className="ocr-preview">
                      <PageCanvas page={ocrPreview} width={270} />
                      <small>
                        초록색은 확인용 표시입니다. 저장할 때는 흰색으로
                        가립니다.
                      </small>
                    </div>
                  )}
                </div>
              ) : (
                <div className="inline-notice">
                  입력한 단어를 찾지 못했습니다. 철자나 인식 상태를 확인해 다시
                  검색하거나 영역 지정으로 가려 주세요.
                </div>
              )}
              <div className="modal-footer">
                <ToolButton onClick={closeModal}>취소</ToolButton>
                <ToolButton
                  className="primary"
                  disabled={
                    !ocrReview.selected.size && !ocrReview.continueRegion
                  }
                  onClick={acceptOcr}
                >
                  {ocrReview.continueRegion
                    ? `선택한 ${ocrReview.selected.size}곳 적용 후 영역 지정`
                    : `선택한 ${ocrReview.selected.size}곳 가리기`}
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "signature" && (
            <SignaturePad
              onCancel={closeModal}
              onApply={(s) => {
                setSignature(s);
                setTool("signature");
                setModal(null);
                notify("서명을 넣을 위치를 클릭하세요.");
              }}
            />
          )}
          {modal.type === "text" && (
            <>
              <p className="modal-description">
                클릭한 위치에 텍스트를 추가합니다.
              </p>
              <textarea
                autoFocus
                className="text-editor"
                aria-label="추가할 텍스트"
                rows="4"
                placeholder="내용을 입력하세요"
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                maxLength={2000}
              />
              <div className="text-settings">
                <label>
                  색상{" "}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </label>
                <span>글자 크기</span>
                <select
                  aria-label="텍스트 크기"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                >
                  <option value="0.016">작게</option>
                  <option value="0.025">보통</option>
                  <option value="0.04">크게</option>
                  <option value="0.06">아주 크게</option>
                </select>
              </div>
              <div className="modal-footer">
                <ToolButton onClick={closeModal}>취소</ToolButton>
                <ToolButton
                  icon={Check}
                  className="primary"
                  disabled={!textValue.trim()}
                  onClick={() => {
                    commit(
                      pages.map((p) =>
                        p.id === modal.pageId
                          ? {
                              ...p,
                              annotations: [
                                ...p.annotations,
                                {
                                  id: uid(),
                                  type: "text",
                                  ...modal.anchor,
                                  text: textValue.trim(),
                                  color,
                                  size: fontSize,
                                },
                              ],
                            }
                          : p,
                      ),
                    );
                    setModal(null);
                  }}
                >
                  텍스트 추가
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "new" && (
            <>
              <p className="modal-description">
                현재 문서를 닫고 빈 작업실로 돌아갑니다. 저장하지 않은 편집
                내용은 사라집니다. 필요한 경우 먼저 PDF를 저장해 주세요.
              </p>
              <div className="modal-footer">
                <ToolButton onClick={closeModal}>취소</ToolButton>
                <ToolButton icon={FilePlus} className="primary" onClick={reset}>
                  새 작업 시작
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "clear" && (
            <>
              <p className="modal-description">
                현재 페이지에 추가한 필기, 텍스트, 서명과 가림 영역을 모두
                지웁니다. 원본 PDF의 내용은 유지됩니다.
              </p>
              <div className="modal-footer">
                <ToolButton onClick={closeModal}>취소</ToolButton>
                <ToolButton
                  icon={Trash}
                  className="primary"
                  onClick={() => {
                    updateAnnotations([]);
                    setModal(null);
                  }}
                >
                  편집 지우기
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "shortcuts" && (
            <>
              <div className="shortcut-list">
                {[
                  ["이동", "Q"],
                  ["선택", "V"],
                  ["펜", "P"],
                  ["형광펜", "H"],
                  ["도형", "G"],
                  ["텍스트", "T"],
                  ["지우개", "E"],
                  ["레이저 포인터 켜기 / 끄기", "L"],
                  ["이전 / 다음 페이지", "← / →"],
                  ["실행 취소", "Ctrl / ⌘ + Z"],
                  ["다시 실행", "Ctrl / ⌘ + Shift + Z"],
                  ["PDF 저장", "Ctrl / ⌘ + S"],
                  ["슬라이드 종료", "Esc"],
                ].map(([name, shortcut]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <kbd>{shortcut}</kbd>
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <ToolButton className="primary" onClick={closeModal}>
                  확인
                </ToolButton>
              </div>
            </>
          )}
          {modal.type === "copy" && (
            <>
              <p className="modal-description">
                브라우저의 클립보드 접근이 제한되어 있습니다. 아래 내용을 선택해
                복사해 주세요.
              </p>
              <textarea
                className="text-editor"
                aria-label="복사할 PDF 텍스트"
                rows="10"
                readOnly
                value={textValue}
                onFocus={(e) => e.target.select()}
              />
              <div className="modal-footer">
                <ToolButton className="primary" onClick={closeModal}>
                  완료
                </ToolButton>
              </div>
            </>
          )}
          {["notice", "error"].includes(modal.type) && (
            <>
              <p className="modal-description preserve-lines">
                {modal.message}
              </p>
              <div className="modal-footer">
                <ToolButton className="primary" onClick={closeModal}>
                  확인
                </ToolButton>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
