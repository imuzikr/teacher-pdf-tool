import { useEffect } from "react";

// Native dragover events are intermittent. Keep scrolling between events while
// the pointer stays near the visible scroll container's edge.
export default function useDragAutoScroll(root, dragging, busy) {
  useEffect(() => {
    let frame = null;
    let point = null;
    let previousTime = null;
    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = point = previousTime = null;
    };
    const velocity = (position, start, end) => {
      const edge = Math.min(72, (end - start) / 3);
      if (edge <= 0) return 0;
      if (position < start + edge)
        return -18 * Math.min(1, (start + edge - position) / edge);
      if (position > end - edge)
        return 18 * Math.min(1, (position - end + edge) / edge);
      return 0;
    };
    const tick = (time) => {
      if (!dragging.current || !point) return stop();
      const workspace = root.current?.closest(".assembly-workspace");
      if (!workspace) return stop();
      const rect = workspace.getBoundingClientRect();
      const elapsed =
        previousTime === null ? 1 : Math.min(2, (time - previousTime) / 16.67);
      previousTime = time;
      workspace.scrollTop +=
        velocity(
          point.y,
          Math.max(0, rect.top),
          Math.min(window.innerHeight, rect.bottom),
        ) * elapsed;
      if (point.row?.isConnected) {
        const bounds = point.row.getBoundingClientRect();
        point.row.scrollLeft +=
          velocity(
            point.x,
            Math.max(0, bounds.left),
            Math.min(window.innerWidth, bounds.right),
          ) * elapsed;
      }
      frame = window.requestAnimationFrame(tick);
    };
    const track = (event) => {
      if (!dragging.current || busy) return;
      event.preventDefault();
      point = {
        x: event.clientX,
        y: event.clientY,
        row: event.target.closest?.(".assembly-page-row"),
      };
      if (frame === null) frame = window.requestAnimationFrame(tick);
    };
    const leaveWindow = (event) => {
      if (event.target === document.documentElement && !event.relatedTarget)
        stop();
    };
    document.addEventListener("dragover", track, true);
    document.addEventListener("drop", stop, true);
    document.addEventListener("dragend", stop, true);
    document.addEventListener("dragleave", leaveWindow, true);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      document.removeEventListener("dragover", track, true);
      document.removeEventListener("drop", stop, true);
      document.removeEventListener("dragend", stop, true);
      document.removeEventListener("dragleave", leaveWindow, true);
      window.removeEventListener("blur", stop);
    };
  }, [root, dragging, busy]);
}
