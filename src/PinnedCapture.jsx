import React, { useRef } from "react";
import { Minus, Plus, X, ArrowsDownUp } from "@phosphor-icons/react";

export default function PinnedCapture({ capture, onChange, onClose }) {
  const drag = useRef(null);
  const resize = (factor) =>
    onChange({
      ...capture,
      width: Math.max(
        120,
        Math.min(window.innerWidth - 24, capture.width * factor),
      ),
      x: Math.min(
        capture.x,
        Math.max(
          0,
          window.innerWidth -
            Math.min(window.innerWidth - 24, capture.width * factor),
        ),
      ),
    });
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
        onPointerDown={(e) => {
          if (e.target.closest("button") || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: capture.x,
            top: capture.y,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onChange({
            ...capture,
            x: Math.max(
              0,
              Math.min(
                window.innerWidth - capture.width,
                drag.current.left + e.clientX - drag.current.x,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                window.innerHeight - 60,
                drag.current.top + e.clientY - drag.current.y,
              ),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span>
          <ArrowsDownUp size={14} /> 캡처 · 드래그로 이동
        </span>
        <div>
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
          <button
            className="icon-button"
            aria-label="캡처 닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="capture-image">
        <img src={capture.dataUrl} alt="선택 영역 캡처" draggable={false} />
      </div>
    </section>
  );
}
