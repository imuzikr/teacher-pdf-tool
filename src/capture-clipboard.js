import { drawAnnotations } from "./pdf-engine.js";

export function capturePngBlob(image) {
  const prefix = "data:image/png;base64,";
  if (!image.dataUrl?.startsWith(prefix))
    throw new Error("PNG 캡처 이미지가 아닙니다.");
  const binary = atob(image.dataUrl.slice(prefix.length));
  return new Blob(
    [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
    { type: "image/png" },
  );
}

// Start the write in the pointer/click event, preserving user activation even
// while the PDF renderer or image decoding is still producing the PNG.
export async function copyCaptureImage(
  image,
  clipboard = globalThis.navigator?.clipboard,
  Item = globalThis.ClipboardItem,
) {
  if (!clipboard?.write || !Item) return { ok: false, reason: "unsupported" };
  const png = Promise.resolve(image).then(capturePngBlob);
  png.catch(() => {});
  try {
    await clipboard.write([new Item({ "image/png": png })]);
    return { ok: true };
  } catch {
    return { ok: false, reason: "blocked" };
  }
}

export async function captureWithWriting(
  capture,
  canvasFactory = () => document.createElement("canvas"),
) {
  if (!capture.strokes?.length) return capture;
  const image = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("캡처 이미지를 읽지 못했습니다."));
    image.src = capture.dataUrl;
  });
  const canvas = canvasFactory();
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  await drawAnnotations(
    context,
    {
      rotation: 0,
      width: canvas.width,
      height: canvas.height,
      annotations: capture.strokes.map((stroke) =>
        stroke.type === "highlight"
          ? {
              ...stroke,
              strokeWidth: stroke.size * 4,
              opacity: stroke.color === "#ffff00" ? 1 : 0.35,
            }
          : stroke,
      ),
    },
    canvas.width,
    canvas.height,
  );
  return { dataUrl: canvas.toDataURL("image/png") };
}
