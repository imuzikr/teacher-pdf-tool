import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { applyRedaction, drawAnnotations } from "../src/pdf-engine.js";

test("bulk masks preserve visible location across rotations and leave unselected pages unchanged", async () => {
  const pages = [0, 90, 180, 270].map((rotation, i) => ({
    id: `page-${i}`,
    rotation,
    width: 400,
    height: 600,
    annotations: [],
  }));
  const reference = pages[1];
  const region = {
    type: "redact",
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
    color: "#ffffff",
  };
  const applied = applyRedaction(
    pages,
    reference,
    region,
    new Set(["page-0", "page-1", "page-2"]),
  );
  assert.equal(applied[3], pages[3]);
  assert.ok(pages.every((p) => p.annotations.length === 0));
  assert.equal(
    new Set(applied.slice(0, 3).map((p) => p.annotations[0].id)).size,
    3,
  );
  for (const page of applied.slice(0, 3)) {
    const canvas = createCanvas(400, 600);
    const context = canvas.getContext("2d");
    context.fillStyle = "#555555";
    context.fillRect(0, 0, 400, 600);
    await drawAnnotations(context, page, 400, 600);
    const inside = context.getImageData(320, 120, 1, 1).data;
    assert.deepEqual([...inside], [255, 255, 255, 255]);
    const outside = context.getImageData(100, 400, 1, 1).data;
    assert.deepEqual([...outside], [85, 85, 85, 255]);
  }
});
