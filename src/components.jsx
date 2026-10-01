import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Check,
  UploadSimple,
  Eraser,
  WarningCircle,
} from "@phosphor-icons/react";
import { drawAnnotations, normalizeRotation } from "./pdf-engine.js";

export function ToolButton({
  icon: Icon,
  children,
  className = "",
  active,
  ...props
}) {
  return (
    <button
      className={`tool-button ${active ? "active" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon size={20} weight="regular" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button, input, textarea")?.focus();
    const key = (event) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const controls = [
          ...ref.current.querySelectorAll(
            'button:not(:disabled), input, textarea, select, [tabindex="0"]',
          ),
        ];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose, busy]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="닫기"
            onClick={onClose}
            disabled={busy}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function PageCanvas({
  page,
  width,
  draft,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  tool,
  thumbnail = false,
}) {
  const base = useRef(null);
  const overlay = useRef(null);
  const holder = useRef(null);
  const [visible, setVisible] = useState(!thumbnail);
  const [dimensions, setDimensions] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!thumbnail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let task;
    setDimensions(null);
    setError("");
    (async () => {
      const original = await page.source.document.getPage(page.index + 1);
      if (disposed) return;
      const initial = original.getViewport({
        scale: 1,
        rotation: normalizeRotation(page.baseRotation + page.rotation),
      });
      const ratio = thumbnail ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const viewport = original.getViewport({
        scale: (width / initial.width) * ratio,
        rotation: normalizeRotation(page.baseRotation + page.rotation),
      });
      base.current.width = Math.ceil(viewport.width);
      base.current.height = Math.ceil(viewport.height);
      task = original.render({
        canvasContext: base.current.getContext("2d"),
        viewport,
        background: "#fff",
      });
      await task.promise;
      if (!disposed)
        setDimensions({
          width: base.current.width,
          height: base.current.height,
        });
    })().catch((e) => {
      if (!disposed && e.name !== "RenderingCancelledException")
        setError(
          "페이지를 표시하지 못했습니다. 다른 PDF로 다시 시도해 주세요.",
        );
    });
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [page.id, page.rotation, width, visible, thumbnail]);
  useEffect(() => {
    if (!dimensions || !overlay.current) return;
    let disposed = false;
    const temporary = document.createElement("canvas");
    temporary.width = dimensions.width;
    temporary.height = dimensions.height;
    drawAnnotations(
      temporary.getContext("2d"),
      page,
      dimensions.width,
      dimensions.height,
      [...page.annotations, ...(draft ? [draft] : [])],
    )
      .then(() => {
        if (disposed || !overlay.current) return;
        overlay.current.width = dimensions.width;
        overlay.current.height = dimensions.height;
        overlay.current.getContext("2d").drawImage(temporary, 0, 0);
      })
      .catch(() => {
        if (!disposed) setError("주석을 표시하지 못했습니다.");
      });
    return () => {
      disposed = true;
    };
  }, [dimensions, page.annotations, page.rotation, draft]);
  const rotated = page.rotation % 180 !== 0;
  const height =
    width * (rotated ? page.width / page.height : page.height / page.width);
  return (
    <div
      ref={holder}
      className={`page-canvas ${thumbnail ? "thumbnail-canvas" : ""} tool-${tool || "move"}`}
      style={{ width, height, aspectRatio: `${width} / ${height}` }}
    >
      <canvas ref={base} aria-label={`PDF ${page.index + 1}페이지`} />
      <canvas
        ref={overlay}
        className="annotation-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {!dimensions && !error && (
        <div className="page-loading">
          <span className="spinner" />
          {!thumbnail && <span>페이지를 불러오는 중</span>}
        </div>
      )}
      {error && (
        <div className="page-error">
          <WarningCircle size={28} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export function SignaturePad({ onApply, onCancel }) {
  const canvas = useRef(null);
  const input = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [uploaded, setUploaded] = useState(null);
  const [error, setError] = useState("");
  const position = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * 600) / r.width,
      y: ((e.clientY - r.top) * 200) / r.height,
    };
  };
  const clear = () => {
    canvas.current?.getContext("2d").clearRect(0, 0, 600, 200);
    setHasInk(false);
    setUploaded(null);
    setError("");
  };
  return (
    <>
      <p className="modal-description">
        아래에 서명을 그리거나, 투명 배경의 서명 이미지를 추가하세요.
      </p>
      <div className="signature-pad">
        {uploaded ? (
          <img src={uploaded} alt="업로드한 서명" />
        ) : (
          <canvas
            ref={canvas}
            width="600"
            height="200"
            aria-label="서명을 그리는 영역"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              const p = position(e);
              const c = canvas.current.getContext("2d");
              c.beginPath();
              c.moveTo(p.x, p.y);
              c.lineCap = "round";
              c.lineJoin = "round";
              c.lineWidth = 3;
              c.strokeStyle = "#153c30";
              c.lineTo(p.x + 0.1, p.y);
              c.stroke();
              setHasInk(true);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const p = position(e);
              const c = canvas.current.getContext("2d");
              c.lineTo(p.x, p.y);
              c.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
        )}
        {!hasInk && !uploaded && (
          <span className="signature-hint">이곳에 서명해 주세요</span>
        )}
      </div>
      <div className="signature-actions">
        <ToolButton icon={UploadSimple} onClick={() => input.current.click()}>
          이미지 추가
        </ToolButton>
        <ToolButton icon={Eraser} onClick={clear}>
          지우기
        </ToolButton>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg"
        onChange={async (e) => {
          const file = e.target.files[0];
          e.target.value = "";
          if (!file) return;
          if (
            !["image/png", "image/jpeg"].includes(file.type) ||
            file.size > 5 * 1024 * 1024
          ) {
            setError("5MB 이하의 PNG 또는 JPG 이미지를 선택해 주세요.");
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            setUploaded(reader.result);
            setError("");
          };
          reader.readAsDataURL(file);
        }}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="modal-footer">
        <ToolButton onClick={onCancel}>취소</ToolButton>
        <ToolButton
          icon={Check}
          className="primary"
          disabled={!hasInk && !uploaded}
          onClick={async () => {
            const dataUrl = uploaded || canvas.current.toDataURL("image/png");
            const img = new Image();
            img.onload = () =>
              onApply({ dataUrl, aspect: img.width / img.height });
            img.onerror = () =>
              setError(
                "이미지를 읽지 못했습니다. 다른 이미지를 선택해 주세요.",
              );
            img.src = dataUrl;
          }}
        >
          서명 사용
        </ToolButton>
      </div>
    </>
  );
}
