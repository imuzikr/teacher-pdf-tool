import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startScreenRecording,
  createRegionStream,
} from "../src/screen-recording.js";

function fixture({
  micError = false,
  videoEnds = false,
  unsupported = false,
  mp4 = false,
} = {}) {
  const track = (kind) => ({
    kind,
    readyState: "live",
    stopCount: 0,
    stop() {
      this.stopCount++;
      this.readyState = "ended";
    },
    addEventListener(type, callback) {
      this[type] = callback;
    },
  });
  const video = track("video"),
    audio = track("audio");
  class Stream {
    constructor(tracks) {
      this.tracks = tracks;
    }
    getTracks() {
      return this.tracks;
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === "video");
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === "audio");
    }
  }
  const calls = [];
  let recorder;
  class Recorder {
    static isTypeSupported(type) {
      return mp4 ? type === "video/mp4" : type === "video/webm";
    }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options?.mimeType;
      this.state = "inactive";
      recorder = this;
    }
    start(ms) {
      this.interval = ms;
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(["recorded-video"]) });
        this.onstop();
      });
    }
  }
  const env = {
    MediaStream: Stream,
    MediaRecorder: unsupported ? null : Recorder,
    navigator: {
      mediaDevices: {
        getDisplayMedia(options) {
          calls.push(["display", options]);
          return Promise.resolve(new Stream([video]));
        },
        getUserMedia(options) {
          calls.push(["mic", options]);
          if (micError) return Promise.reject(new Error("mic denied"));
          if (videoEnds) video.readyState = "ended";
          return Promise.resolve(new Stream([audio]));
        },
      },
    },
  };
  const results = [],
    errors = [];
  const start = (microphone, selectRegion) =>
    startScreenRecording(
      {
        microphone,
        selectRegion,
        onComplete: (blob) => results.push(blob),
        onError: (error) => errors.push(error),
      },
      env,
    );
  return {
    start,
    calls,
    video,
    audio,
    results,
    errors,
    get recorder() {
      return recorder;
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("silent screen recording starts chooser immediately, saves once, and releases screen", async () => {
  const f = fixture();
  const pending = f.start(false);
  assert.equal(f.calls[0][0], "display");
  const session = await pending;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].audio, false);
  assert.deepEqual(f.recorder.stream.getTracks(), [f.video]);
  session.stop();
  session.stop();
  await tick();
  assert.equal(f.results.length, 1);
  assert.equal(await f.results[0].text(), "recorded-video");
  assert.equal(f.results[0].type, "video/webm");
  assert.equal(f.video.readyState, "ended");
});

test("optional microphone joins video; browser sharing stop finishes recording and releases both", async () => {
  const f = fixture({ mp4: true });
  await f.start(true);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["display", "mic"],
  );
  assert.deepEqual(f.recorder.stream.getTracks(), [f.video, f.audio]);
  f.video.ended();
  await tick();
  assert.equal(f.results[0].type, "video/mp4");
  assert.equal(f.audio.readyState, "ended");
  assert.equal(f.video.readyState, "ended");
});

test("microphone denial and interrupted sharing release acquired media without starting recording", async () => {
  for (const options of [{ micError: true }, { videoEnds: true }]) {
    const f = fixture(options);
    await assert.rejects(f.start(true));
    assert.equal(f.video.readyState, "ended");
    assert.equal(f.recorder, undefined);
    assert.equal(f.results.length, 0);
  }
});

test("dispose stops media without downloading and unsupported browsers do not request sharing", async () => {
  const f = fixture();
  const session = await f.start(true);
  session.dispose();
  await tick();
  assert.equal(f.results.length, 0);
  assert.equal(f.audio.readyState, "ended");
  assert.equal(f.video.readyState, "ended");
  const unsupported = fixture({ unsupported: true });
  await assert.rejects(unsupported.start(false), /지원하지 않습니다/);
  assert.equal(unsupported.calls.length, 0);
});

test("recorder failure salvages available data and releases all tracks", async () => {
  const f = fixture();
  await f.start(true);
  f.recorder.onerror();
  await tick();
  assert.equal(f.errors.length, 1);
  assert.equal(f.results.length, 1);
  assert.equal(f.audio.readyState, "ended");
  assert.equal(f.video.readyState, "ended");
});

test("region selection cancellation or sharing stop releases the source before requesting microphone", async () => {
  const cancelled = fixture();
  await assert.rejects(
    cancelled.start(true, async () => {
      throw new Error("cancelled");
    }),
    /cancelled/,
  );
  assert.equal(cancelled.video.readyState, "ended");
  assert.deepEqual(
    cancelled.calls.map((c) => c[0]),
    ["display"],
  );
  const ended = fixture();
  const pending = ended.start(true, () => new Promise(() => {}));
  await tick();
  ended.video.ended();
  await assert.rejects(pending, /공유가 종료/);
  assert.equal(ended.video.readyState, "ended");
  assert.equal(ended.recorder, undefined);
});

test("region output contains only selected pixels, updates moving frames, and scales resized sources", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const source = createCanvas(400, 200);
  const output = createCanvas(1, 1);
  let nextFrame,
    cancelled,
    paused = false;
  Object.defineProperty(source, "videoWidth", { get: () => source.width });
  Object.defineProperty(source, "videoHeight", { get: () => source.height });
  source.play = async () => {};
  source.pause = () => {
    paused = true;
  };
  source.requestVideoFrameCallback = (callback) => {
    nextFrame = callback;
    return 42;
  };
  source.cancelVideoFrameCallback = (id) => {
    cancelled = id;
  };
  output.captureStream = (fps) => {
    assert.equal(fps, 30);
    return { cropped: true };
  };
  const ctx = source.getContext("2d");
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = "blue";
  ctx.fillRect(200, 0, 200, 200);
  const display = {};
  const env = {
    document: { createElement: (tag) => (tag === "video" ? source : output) },
  };
  const capture = await createRegionStream(
    display,
    { x: 0.5, y: 0, width: 0.5, height: 1 },
    env,
  );
  assert.equal(capture.stream.cropped, true);
  assert.equal(output.width, 200);
  assert.equal(output.height, 200);
  assert.deepEqual(
    [...output.getContext("2d").getImageData(0, 0, 1, 1).data],
    [0, 0, 255, 255],
  );
  source.width = 800;
  source.height = 400;
  const resized = source.getContext("2d");
  resized.fillStyle = "red";
  resized.fillRect(0, 0, 400, 400);
  resized.fillStyle = "#00ff00";
  resized.fillRect(400, 0, 400, 400);
  nextFrame();
  assert.equal(output.width, 200);
  assert.deepEqual(
    [...output.getContext("2d").getImageData(199, 199, 1, 1).data],
    [0, 255, 0, 255],
  );
  capture.dispose();
  assert.equal(paused, true);
  assert.equal(cancelled, 42);
  assert.equal(source.srcObject, null);
});

test("invalid or unavailable region capture fails without leaving video playback running", async () => {
  await assert.rejects(
    createRegionStream({}, { x: 0.9, y: 0, width: 0.2, height: 1 }, {}),
    /다시 지정/,
  );
  let paused = false;
  const video = {
    videoWidth: 100,
    videoHeight: 100,
    play: async () => {},
    pause() {
      paused = true;
    },
  };
  await assert.rejects(
    createRegionStream(
      {},
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { document: { createElement: (tag) => (tag === "video" ? video : {}) } },
    ),
    /영역 녹화를 지원하지/,
  );
  assert.equal(paused, true);
  assert.equal(video.srcObject, null);
});
