// All media stays in the browser. Only the video and optional microphone track
// selected for this session are recorded.
export async function startScreenRecording(
  { microphone = false, selectRegion, onComplete, onError },
  env = globalThis,
) {
  const devices = env.navigator?.mediaDevices;
  if (!devices?.getDisplayMedia || !env.MediaRecorder)
    throw new Error(
      "이 브라우저는 화면 녹화를 지원하지 않습니다. 데스크톱 Chrome 또는 Edge를 사용해 주세요.",
    );
  const streams = [];
  let recorder;
  let crop;
  let disposed = false;
  let completed = false;
  const cleanup = () => {
    crop?.dispose();
    streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
  };
  const stop = () => {
    if (recorder?.state !== "inactive") recorder?.stop();
  };
  try {
    // Keep this request before the first await to retain the button's activation.
    const display = await devices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    streams.push(display);
    const video = display.getVideoTracks()[0];
    if (!video) throw new Error("녹화할 화면을 선택하지 못했습니다.");
    let region;
    if (selectRegion) {
      let ended;
      try {
        region = await Promise.race([
          selectRegion(display),
          new Promise((_, reject) => {
            ended = () =>
              reject(new Error("영역 선택 중 화면 공유가 종료되었습니다."));
            video.addEventListener("ended", ended, { once: true });
          }),
        ]);
      } finally {
        video.removeEventListener?.("ended", ended);
      }
      crop = await createRegionStream(display, region, env);
      streams.push(crop.stream);
    }
    const tracks = [crop ? crop.stream.getVideoTracks()[0] : video];
    if (microphone) {
      if (!devices.getUserMedia)
        throw new Error("이 브라우저에서는 마이크를 사용할 수 없습니다.");
      const mic = await devices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      streams.push(mic);
      if (!mic.getAudioTracks().length)
        throw new Error("마이크 음성을 가져오지 못했습니다.");
      tracks.push(...mic.getAudioTracks());
    }
    if (video.readyState === "ended")
      throw new Error("화면 공유가 종료되었습니다. 다시 시작해 주세요.");
    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((type) => env.MediaRecorder.isTypeSupported?.(type));
    recorder = new env.MediaRecorder(
      new env.MediaStream(tracks),
      mimeType ? { mimeType } : undefined,
    );
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (completed) return;
      completed = true;
      cleanup();
      if (!disposed) {
        const blob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "video/webm",
        });
        if (blob.size) onComplete(blob);
        else onError(new Error("녹화된 영상이 없습니다. 다시 녹화해 주세요."));
      }
    };
    recorder.onerror = () => {
      if (!disposed)
        onError(
          new Error(
            "녹화 중 오류가 발생했습니다. 완료된 영상이 있으면 저장합니다.",
          ),
        );
      stop();
    };
    video.addEventListener("ended", stop, { once: true });
    recorder.start(1000);
    return {
      stop,
      dispose() {
        disposed = true;
        stop();
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// Keep output dimensions fixed while scaling the chosen relative rectangle if
// the source window changes resolution during recording.
export async function createRegionStream(display, region, env = globalThis) {
  if (
    !region ||
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1.000001 ||
    region.y + region.height > 1.000001
  )
    throw new Error("녹화할 영역을 다시 지정해 주세요.");
  const video = env.document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = display;
  let frame;
  let timer;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    if (timer !== undefined) env.clearTimeout(timer);
    video.pause();
    video.srcObject = null;
  };
  try {
    await video.play();
    if (!video.videoWidth || !video.videoHeight)
      throw new Error("공유 화면을 읽지 못했습니다. 다시 선택해 주세요.");
    const canvas = env.document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(video.videoWidth * region.width));
    canvas.height = Math.max(2, Math.round(video.videoHeight * region.height));
    if (!canvas.captureStream)
      throw new Error(
        "이 브라우저는 영역 녹화를 지원하지 않습니다. 데스크톱 Chrome 또는 Edge를 사용해 주세요.",
      );
    const context = canvas.getContext("2d", { alpha: false });
    const paint = () => {
      if (disposed) return;
      context.drawImage(
        video,
        region.x * video.videoWidth,
        region.y * video.videoHeight,
        region.width * video.videoWidth,
        region.height * video.videoHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      if (video.requestVideoFrameCallback)
        frame = video.requestVideoFrameCallback(paint);
      else timer = env.setTimeout(paint, 1000 / 30);
    };
    paint();
    return { stream: canvas.captureStream(30), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
