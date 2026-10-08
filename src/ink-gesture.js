import { toBasePoint, uid } from "./pdf-engine.js";

// Clip each physical pointer segment to the page rectangles. Coordinates outside
// a page must never be clamped onto its edge, which would create false strokes.
export function clipInkSegment(a, b, bounds) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  let enter = 0,
    exit = 1;
  const edges = [
    [-dx, a.x - bounds.left],
    [dx, bounds.left + bounds.width - a.x],
    [-dy, a.y - bounds.top],
    [dy, bounds.top + bounds.height - a.y],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  return {
    start: { x: a.x + enter * dx, y: a.y + enter * dy },
    end: { x: a.x + exit * dx, y: a.y + exit * dy },
    exit,
  };
}
const normalized = (point, target) =>
  toBasePoint(
    (point.x - target.bounds.left) / target.bounds.width,
    (point.y - target.bounds.top) / target.bounds.height,
    target.page.rotation,
  );
export function beginInkGesture(pages, template, start) {
  const targets = pages.map((target) => {
    const inside = !!clipInkSegment(start, start, target.bounds);
    return {
      ...target,
      connected: inside,
      strokes: inside
        ? [{ ...template, id: uid(), points: [normalized(start, target)] }]
        : [],
    };
  });
  return { ink: true, template, last: start, targets };
}
export function advanceInkGesture(gesture, end) {
  for (const target of gesture.targets) {
    const clipped = clipInkSegment(gesture.last, end, target.bounds);
    if (
      clipped &&
      Math.hypot(
        clipped.end.x - clipped.start.x,
        clipped.end.y - clipped.start.y,
      ) > 0.001
    ) {
      const start = normalized(clipped.start, target),
        finish = normalized(clipped.end, target);
      const previous = target.strokes.at(-1);
      const last = previous?.points.at(-1);
      if (
        target.connected &&
        last &&
        Math.hypot(last.x - start.x, last.y - start.y) < 1e-7
      ) {
        target.strokes = [
          ...target.strokes.slice(0, -1),
          { ...previous, points: [...previous.points, finish] },
        ];
      } else
        target.strokes = [
          ...target.strokes,
          { ...gesture.template, id: uid(), points: [start, finish] },
        ];
    }
    target.connected = !!clipped && clipped.exit >= 1 - 1e-9;
  }
  gesture.last = end;
}
export function inkDrafts(gesture) {
  return Object.fromEntries(
    gesture.targets.map((target) => [target.page.id, target.strokes]),
  );
}
