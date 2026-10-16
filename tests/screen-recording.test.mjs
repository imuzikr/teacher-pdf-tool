import { test } from "node:test";
import assert from "node:assert/strict";
import { startScreenRecording } from "../src/screen-recording.js";

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
  const start = (microphone) =>
    startScreenRecording(
      {
        microphone,
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
