import { renderPage, rotatedSize, toBasePoint, uid } from "./pdf-engine.js";

export function parseTerms(value) {
  return [
    ...new Set(
      value
        .split(/[,\n;]+/)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
}

const normalized = (text) =>
  text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

// Match within a line, including Korean names split into multiple OCR words.
// Without character boxes, conservatively cover the whole recognized word.
export function findOcrMatches(data, terms, width, height) {
  const matches = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const characters = [];
        for (const word of line.words || []) {
          const symbols = word.symbols?.length
            ? word.symbols
            : [
                {
                  text: word.text,
                  bbox: word.bbox,
                  confidence: word.confidence,
                },
              ];
          for (const symbol of symbols) {
            for (const char of normalized(symbol.text || "").split("")) {
              if (symbol.bbox)
                characters.push({
                  char,
                  bbox: symbol.bbox,
                  confidence: symbol.confidence ?? word.confidence ?? 0,
                });
            }
          }
        }
        const text = characters.map((c) => c.char).join("");
        const used = new Set();
        for (const term of terms) {
          const needle = normalized(term);
          if (!needle) continue;
          let start = 0;
          while ((start = text.indexOf(needle, start)) !== -1) {
            const end = start + needle.length;
            if (
              ![...Array(needle.length)].some((_, i) => used.has(start + i))
            ) {
              const chars = characters.slice(start, end);
              const left = Math.max(
                0,
                Math.min(...chars.map((c) => c.bbox.x0)) - 2,
              );
              const top = Math.max(
                0,
                Math.min(...chars.map((c) => c.bbox.y0)) - 2,
              );
              const right = Math.min(
                width,
                Math.max(...chars.map((c) => c.bbox.x1)) + 2,
              );
              const bottom = Math.min(
                height,
                Math.max(...chars.map((c) => c.bbox.y1)) + 2,
              );
              if (right > left && bottom > top)
                matches.push({
                  id: uid(),
                  term,
                  recognized: chars.map((c) => c.char).join(""),
                  confidence: Math.round(
                    Math.min(...chars.map((c) => c.confidence)),
                  ),
                  x: left / width,
                  y: top / height,
                  width: (right - left) / width,
                  height: (bottom - top) / height,
                });
              for (let i = start; i < end; i++) used.add(i);
            }
            start = end;
          }
        }
      }
    }
  }
  // Several substring matches can fall in one whole-word bounding box.
  const unique = new Map();
  for (const match of matches) {
    const key = [match.x, match.y, match.width, match.height].join(":");
    if (!unique.has(key)) unique.set(key, match);
  }
  return [...unique.values()];
}

export function matchAnnotation(match, page, type = "redact") {
  const corners = [
    [match.x, match.y],
    [match.x + match.width, match.y],
    [match.x, match.y + match.height],
    [match.x + match.width, match.y + match.height],
  ].map(([x, y]) => toBasePoint(x, y, page.rotation));
  const x = Math.min(...corners.map((p) => p.x));
  const y = Math.min(...corners.map((p) => p.y));
  return {
    id: uid(),
    type,
    color: "#ffffff",
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
}

export function applyOcrMatches(pages, matches) {
  return pages.map((page) => {
    const found = matches.filter((match) => match.pageId === page.id);
    return found.length
      ? {
          ...page,
          annotations: [
            ...page.annotations,
            ...found.map((match) => matchAnnotation(match, page)),
          ],
        }
      : page;
  });
}

export async function scanPdfWords(
  pages,
  terms,
  { createWorker, onProgress, signal, canvasFactory } = {},
) {
  if (!pages.length || !terms.length) return { matches: [], scannedPages: 0 };
  let worker;
  const abortError = () =>
    new DOMException("OCR을 취소했습니다.", "AbortError");
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(abortError());
  signal?.addEventListener("abort", abort, { once: true });
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  const matches = [];
  let scannedPages = 0;
  try {
    check();
    onProgress?.({ stage: "initializing", page: 0, total: pages.length });
    const initializing = createWorker((message) =>
      onProgress?.({
        stage: "engine",
        message,
        page: scannedPages + 1,
        total: pages.length,
      }),
    );
    initializing.then(
      (created) => {
        if (signal?.aborted) created.terminate().catch(() => {});
      },
      () => {},
    );
    worker = await Promise.race([initializing, aborted]);
    for (const page of pages) {
      check();
      onProgress?.({
        stage: "page",
        page: scannedPages + 1,
        total: pages.length,
      });
      const size = rotatedSize(page);
      const canvas = await renderPage(
        page,
        Math.min(2.5, 3500 / Math.max(size.width, size.height)),
        canvasFactory,
      );
      try {
        check();
        const { data } = await Promise.race([
          worker.recognize(
            canvas.toDataURL("image/png"),
            {},
            { text: true, blocks: true },
          ),
          aborted,
        ]);
        check();
        for (const match of findOcrMatches(
          data,
          terms,
          canvas.width,
          canvas.height,
        ))
          matches.push({ ...match, pageId: page.id });
        scannedPages++;
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    return { matches, scannedPages };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (worker) await worker.terminate().catch(() => {});
  }
}
