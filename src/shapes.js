export const shapeOptions = [
  ["line", "직선"],
  ["circle", "원"],
  ["triangle", "삼각형"],
  ["rectangle", "사각형"],
  ["pentagon", "오각형"],
  ["hexagon", "육각형"],
  ["axes2d", "2차원 좌표"],
  ["axes3d", "3차원 좌표"],
];

// Geometry is measured in page-width units so circles/polygons remain regular
// on portrait and landscape pages. Move markers keep separate axes disconnected.
export function shapePoints(kind, start, end, aspect = 1) {
  const points = [];
  const add = (x, y, move = false, label) =>
    points.push({
      x,
      y: y * aspect,
      ...(move ? { move: true } : {}),
      ...(label ? { label } : {}),
    });
  const sx = start.x,
    sy = start.y / aspect,
    ex = end.x,
    ey = end.y / aspect;
  const left = Math.min(sx, ex),
    right = Math.max(sx, ex),
    top = Math.min(sy, ey),
    bottom = Math.max(sy, ey);
  const w = right - left,
    h = bottom - top,
    cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const line = (ax, ay, bx, by) => {
    add(ax, ay, true);
    add(bx, by);
  };
  if (kind === "line") {
    line(sx, sy, ex, ey);
    return points;
  }
  if (kind === "rectangle") {
    add(left, top, true);
    add(right, top);
    add(right, bottom);
    add(left, bottom);
    add(left, top);
    return points;
  }
  if (kind === "axes2d" || kind === "axes3d") {
    if (!w || !h) return [];
    const head = Math.min(w, h) * 0.08;
    const arrow = (ax, ay, bx, by) => {
      line(ax, ay, bx, by);
      const angle = Math.atan2(by - ay, bx - ax);
      line(
        bx - head * Math.cos(angle - 0.5),
        by - head * Math.sin(angle - 0.5),
        bx,
        by,
      );
      line(
        bx,
        by,
        bx - head * Math.cos(angle + 0.5),
        by - head * Math.sin(angle + 0.5),
      );
    };
    if (kind === "axes2d") {
      arrow(left, cy, right, cy);
      arrow(cx, bottom, cx, top);
      add(right - head * 1.5, cy + head, true, "x");
      add(cx + head, top + head, true, "y");
    } else {
      const ox = left + w * 0.4,
        oy = top + h * 0.6;
      arrow(ox, oy, right, oy);
      arrow(ox, oy, ox, top);
      arrow(ox, oy, left, bottom);
      add(right - head * 1.5, oy + head, true, "x");
      add(left + head, bottom - head, true, "y");
      add(ox + head, top + head, true, "z");
    }
    return points;
  }
  const vertices = { circle: 64, triangle: 3, pentagon: 5, hexagon: 6 }[kind];
  if (!vertices) return [];
  const radius = Math.min(w, h) / 2;
  for (let i = 0; i <= vertices; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / vertices;
    add(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), i === 0);
  }
  return points;
}

export function shapePath(points, aspect = 1, scale = 1000) {
  return points
    .filter((p) => !p.label)
    .map(
      (p, i) =>
        `${p.move || i === 0 ? "M" : "L"}${p.x * scale},${(p.y * scale) / aspect}`,
    )
    .join(" ");
}

export function hitShape(points, point, aspect, tolerance) {
  return points.some((a, i) => {
    const b = points[i + 1];
    if (a.label || !b || b.move || b.label) return false;
    const dx = b.x - a.x,
      dy = (b.y - a.y) / aspect;
    const distance = dx * dx + dy * dy;
    const t = distance
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + ((point.y - a.y) / aspect) * dy) / distance,
          ),
        )
      : 0;
    return (
      Math.hypot(point.x - a.x - dx * t, (point.y - a.y) / aspect - dy * t) <=
      tolerance
    );
  });
}

export function visibleShapePoint(p, rotation = 0) {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90) return { ...p, x: 1 - p.y, y: p.x };
  if (r === 180) return { ...p, x: 1 - p.x, y: 1 - p.y };
  if (r === 270) return { ...p, x: p.y, y: 1 - p.x };
  return { ...p };
}
export function shapeBounds(points, rotation = 0) {
  const visible = points.map((p) => visibleShapePoint(p, rotation));
  const x = Math.min(...visible.map((p) => p.x)),
    y = Math.min(...visible.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(0.01, Math.max(...visible.map((p) => p.x)) - x),
    height: Math.max(0.01, Math.max(...visible.map((p) => p.y)) - y),
  };
}
export function resizeShape(points, before, after, rotation = 0) {
  return points.map((p) => {
    const v = visibleShapePoint(p, rotation);
    const resized = {
      ...v,
      x: after.x + ((v.x - before.x) * after.width) / before.width,
      y: after.y + ((v.y - before.y) * after.height) / before.height,
    };
    return visibleShapePoint(resized, -rotation);
  });
}
