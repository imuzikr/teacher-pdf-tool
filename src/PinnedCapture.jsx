import React, { useRef, useState, useEffect } from "react";
import { Minus, Plus, X, ArrowsDownUp } from "@phosphor-icons/react";

export default function PinnedCapture({
  capture,
  onChange,
  onClose,
  tool,
  color,
  size,
  onLaserMove,
  onLaserLeave,
}) {
  const interaction = useRef(null);
  const drawing = useRef(null);
  const [draft, setDraft] = useState(null);
  const aspect = capture.aspectRatio || 1;
  const strokes = capture.strokes || [];
  useEffect(() => {
    drawing.current = null;
    setDraft(null);
  }, [tool]);
  const resize = (factor) =>
    onChange({
      ...capture,
      width: Math.max(
        120,
        Math.min(window.innerWidth - capture.x - 12, capture.width * factor),
      ),
    });
  const point = (e) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)),
    };
  };
  const strokeHit = (stroke, p) => {
    const q = { x: p.x, y: p.y / aspect };
    return stroke.points.some((a, i) => {
      const b = stroke.points[i + 1] || a;
      const dx = b.x - a.x,
        dy = (b.y - a.y) / aspect;
      const distance = dx * dx + dy * dy;
      const t = distance
        ? Math.max(
            0,
            Math.min(
              1,
              ((q.x - a.x) * dx + (q.y - a.y / aspect) * dy) / distance,
            ),
          )
        : 0;
      return (
        Math.hypot(q.x - a.x - dx * t, q.y - a.y / aspect - dy * t) <
        stroke.size / 2 + 0.015
      );
    });
  };
  const startInteraction = (e, edge) => {
    if (e.button !== 0 || (!edge && e.target.closest("button"))) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    interaction.current = {
      edge,
      x: e.clientX,
      y: e.clientY,
      left: capture.x,
      top: capture.y,
      width: capture.width,
    };
  };
  const moveInteraction = (e) => {
    const current = interaction.current;
    if (!current) return;
    e.stopPropagation();
    const dx = e.clientX - current.x,
      dy = e.clientY - current.y;
    if (!current.edge) {
      onChange({
        ...capture,
        x: Math.max(
          0,
          Math.min(window.innerWidth - capture.width, current.left + dx),
        ),
        y: Math.max(0, Math.min(window.innerHeight - 60, current.top + dy)),
      });
      return;
    }
    const west = current.edge.includes("w"),
      north = current.edge.includes("n");
    const horizontal = current.edge.includes("e") || west;
    const vertical = current.edge.includes("s") || north;
    const horizontalDelta = west ? -dx : dx;
    const verticalDelta = (north ? -dy : dy) * aspect;
    const delta =
      horizontal && vertical
        ? Math.abs(horizontalDelta) > Math.abs(verticalDelta)
          ? horizontalDelta
          : verticalDelta
        : horizontal
          ? horizontalDelta
          : verticalDelta;
    const maxWidth = west
      ? current.width + current.left
      : window.innerWidth - current.left - 12;
    const width = Math.max(
      120,
      Math.min(
        maxWidth,
        north ? current.width + current.top * aspect : Infinity,
        current.width + delta,
      ),
    );
    onChange({
      ...capture,
      width,
      x: west ? current.left + current.width - width : current.left,
      y: north ? current.top + (current.width - width) / aspect : current.top,
    });
  };
  const endInteraction = () => {
    interaction.current = null;
  };
  return (
    <section
      className="pinned-capture"
      aria-label="고정된 캡처"
      style={{ left: capture.x, top: capture.y, width: capture.width }}
    >
      <div
        className="capture-handle"
        tabIndex={0}
        aria-label="캡처 이동 · 드래그 또는 방향키"
        onKeyDown={(e) => {
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
          }[e.key];
          if (!delta || e.target !== e.currentTarget) return;
          e.preventDefault();
          e.stopPropagation();
          onChange({
            ...capture,
            x: Math.max(
              0,
              Math.min(window.innerWidth - capture.width, capture.x + delta[0]),
            ),
            y: Math.max(
              0,
              Math.min(window.innerHeight - 60, capture.y + delta[1]),
            ),
          });
        }}
        onPointerDown={(e) => startInteraction(e)}
        onPointerMove={moveInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
      >
        <div className="capture-size-buttons">
          <button
            className="icon-button"
            aria-label="캡처 축소"
            onClick={() => resize(1 / 1.2)}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="캡처 확대"
            onClick={() => resize(1.2)}
          >
            <Plus size={16} />
          </button>
        </div>
        <span>
          <ArrowsDownUp size={14} /> 캡처 · 드래그로 이동
        </span>
        <button
          className="icon-button"
          aria-label="캡처 닫기"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className={`capture-image ${tool === "laser" ? "laser-active" : ""}`}
      >
        <div className="capture-drawing-area">
          <img src={capture.dataUrl} alt="선택 영역 캡처" draggable={false} />
          <svg
            className="capture-drawing"
            aria-label="캡처 위 필기 영역"
            viewBox={`0 0 1000 ${1000 / aspect}`}
            style={{
              pointerEvents: ["pen", "highlight", "erase", "laser"].includes(
                tool,
              )
                ? "auto"
                : "none",
              touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (
                e.button !== 0 ||
                !["pen", "highlight", "erase"].includes(tool)
              )
                return;
              e.preventDefault();
              e.stopPropagation();
              const p = point(e);
              if (tool === "erase") {
                const hit = [...strokes]
                  .reverse()
                  .find((stroke) => strokeHit(stroke, p));
                if (hit)
                  onChange({
                    ...capture,
                    strokes: strokes.filter((stroke) => stroke.id !== hit.id),
                  });
                return;
              }
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drawing.current = {
                id: crypto.randomUUID(),
                type: tool,
                color,
                size,
                points: [p],
              };
              setDraft(drawing.current);
            }}
            onPointerMove={(e) => {
              if (tool === "laser") {
                onLaserMove?.(e);
                return;
              }
              if (!drawing.current) return;
              drawing.current = {
                ...drawing.current,
                points: [...drawing.current.points, point(e)],
              };
              setDraft(drawing.current);
            }}
            onPointerUp={(e) => {
              if (!drawing.current) return;
              const stroke = {
                ...drawing.current,
                points: [...drawing.current.points, point(e)],
              };
              drawing.current = null;
              setDraft(null);
              onChange({ ...capture, strokes: [...strokes, stroke] });
            }}
            onPointerCancel={() => {
              drawing.current = null;
              setDraft(null);
            }}
            onPointerLeave={onLaserLeave}
          >
            {[...strokes, ...(draft ? [draft] : [])].map((stroke) => (
              <polyline
                key={stroke.id}
                points={stroke.points
                  .map((p) => `${p.x * 1000},${(p.y * 1000) / aspect}`)
                  .join(" ")}
                fill="none"
                stroke={stroke.color}
                strokeWidth={
                  stroke.size * 1000 * (stroke.type === "highlight" ? 4 : 1)
                }
                opacity={stroke.type === "highlight" ? 0.35 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
        </div>
      </div>
      {[
        ["n", "위쪽"],
        ["s", "아래쪽"],
        ["e", "오른쪽"],
        ["w", "왼쪽"],
        ["nw", "왼쪽 위"],
        ["ne", "오른쪽 위"],
        ["sw", "왼쪽 아래"],
        ["se", "오른쪽 아래"],
      ].map(([edge, label]) => (
        <div
          key={edge}
          className={`capture-resize capture-resize-${edge}`}
          role="button"
          tabIndex={0}
          aria-label={`캡처 ${label} 경계 크기 조절`}
          onPointerDown={(e) => startInteraction(e, edge)}
          onPointerMove={moveInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
          onKeyDown={(e) => {
            if (
              !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            e.stopPropagation();
            resize(["ArrowRight", "ArrowDown"].includes(e.key) ? 1.1 : 1 / 1.1);
          }}
        />
      ))}
    </section>
  );
}
