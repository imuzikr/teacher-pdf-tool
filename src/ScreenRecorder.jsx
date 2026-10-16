import React, { useEffect, useRef, useState } from "react";
import { VideoCamera, Stop, DownloadSimple } from "@phosphor-icons/react";
import { Modal, ToolButton } from "./components.jsx";
import { startScreenRecording } from "./screen-recording.js";

export default function ScreenRecorder({ open, onClose }) {
  const [microphone, setMicrophone] = useState(false);
  const [mode, setMode] = useState("full");
  const [preview, setPreview] = useState(null);
  const [region, setRegion] = useState(null);
  const selection = useRef(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const session = useRef(null);
  const mounted = useRef(true);
  const resultUrl = useRef(null);
  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current?.reject(
        new DOMException("영역 선택 취소", "AbortError"),
      );
      session.current?.dispose();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, []);
  useEffect(() => {
    if (status !== "recording") return;
    const start = Date.now();
    const interval = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    const unload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", unload);
    };
  }, [status]);
  const download = (recording) => {
    const anchor = document.createElement("a");
    anchor.href = recording.url;
    anchor.download = recording.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };
  const begin = async () => {
    setError("");
    setStatus("starting");
    try {
      const active = await startScreenRecording({
        microphone,
        selectRegion:
          mode === "region"
            ? (stream) => {
                setStatus("selecting");
                setRegion(null);
                setPreview(stream);
                return new Promise((resolve, reject) => {
                  selection.current = { resolve, reject };
                });
              }
            : undefined,
        onError: (error) => {
          if (mounted.current) {
            setError(error.message);
            setStatus("idle");
            setShowResult(true);
          }
        },
        onComplete: (blob) => {
          if (!mounted.current) return;
          session.current = null;
          if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
          const url = URL.createObjectURL(blob);
          resultUrl.current = url;
          const filename = `HS_PDF_녹화_${new Date().toISOString().replace(/[:.]/g, "-")}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
          const recording = { url, filename };
          setResult(recording);
          setStatus("idle");
          setShowResult(true);
          download(recording);
        },
      });
      if (!mounted.current) {
        active.dispose();
        return;
      }
      session.current = active;
      setSeconds(0);
      setStatus("recording");
      setShowResult(false);
      onClose();
    } catch (error) {
      if (!mounted.current) return;
      setPreview(null);
      selection.current = null;
      setStatus("idle");
      setError(
        error.name === "NotAllowedError" || error.name === "AbortError"
          ? "화면 또는 마이크 사용이 취소되었거나 허용되지 않았습니다. 녹화 시작을 눌러 다시 선택해 주세요."
          : error.message,
      );
    }
  };
  const stop = () => {
    setStatus("stopping");
    session.current?.stop();
  };
  const confirmRegion = () => {
    if (!region) return;
    setStatus("starting");
    setPreview(null);
    selection.current?.resolve(region);
    selection.current = null;
  };
  const close = () => {
    if (selection.current) {
      selection.current.reject(
        new DOMException("영역 선택 취소", "AbortError"),
      );
      selection.current = null;
      setPreview(null);
    }
    setShowResult(false);
    onClose();
  };
  const active = status === "recording" || status === "stopping";
  return (
    <>
      {active && (
        <div className="recording-indicator" role="status">
          <span className="recording-dot" /> 녹화 중 {Math.floor(seconds / 60)}:
          {String(seconds % 60).padStart(2, "0")}
          <button
            className="text-button"
            onClick={stop}
            disabled={status === "stopping"}
          >
            <Stop size={18} />
            {status === "stopping" ? "영상 저장 중…" : "녹화 종료"}
          </button>
        </div>
      )}
      {(open || showResult) && (
        <Modal
          title="동영상 녹화"
          onClose={close}
          busy={status === "starting" || status === "stopping"}
        >
          {error && <p role="alert">{error}</p>}
          {status === "selecting" && preview ? (
            <>
              <p>
                공유 화면에서 녹화할 사각형을 드래그하세요. 선택한 영역 안의
                움직임만 녹화합니다.
              </p>
              <RecordingRegionPicker
                stream={preview}
                onSelect={setRegion}
                onError={(error) => selection.current?.reject(error)}
              />
            </>
          ) : active ? (
            <p>
              화면을 녹화하고 있습니다. 녹화를 종료하면 동영상 파일로
              다운로드합니다.
            </p>
          ) : (
            <>
              <p>
                녹화 방식을 선택하세요. 브라우저에서 공유할 화면을 고른 뒤, 영역
                지정 방식에서는 미리보기에 녹화할 사각형을 드래그합니다.
              </p>
              <fieldset
                className="recording-modes"
                disabled={status === "starting"}
              >
                <legend>녹화 방식</legend>
                <label>
                  <input
                    type="radio"
                    name="recording-mode"
                    value="full"
                    checked={mode === "full"}
                    onChange={() => setMode("full")}
                  />{" "}
                  전체 화면
                </label>
                <label>
                  <input
                    type="radio"
                    name="recording-mode"
                    value="region"
                    checked={mode === "region"}
                    onChange={() => setMode("region")}
                  />{" "}
                  영역 지정
                </label>
              </fieldset>
              <label className="recording-option">
                <input
                  type="checkbox"
                  checked={microphone}
                  onChange={(event) => setMicrophone(event.target.checked)}
                  disabled={status === "starting"}
                />{" "}
                마이크 음성 포함
              </label>
              <p className="recording-help">
                마이크는 선택한 경우에만 사용합니다. 탭·시스템 소리는 녹음하지
                않습니다.
              </p>
            </>
          )}
          {result && status === "idle" && (
            <div className="recording-result">
              <video
                controls
                src={result.url}
                aria-label="녹화 영상 미리보기"
              />
              <ToolButton
                icon={DownloadSimple}
                onClick={() => download(result)}
              >
                동영상 다시 다운로드
              </ToolButton>
            </div>
          )}
          <div className="modal-footer">
            <ToolButton
              onClick={close}
              disabled={status === "starting" || status === "stopping"}
            >
              닫기
            </ToolButton>
            {status === "selecting" ? (
              <ToolButton
                className="primary"
                icon={VideoCamera}
                disabled={!region}
                onClick={confirmRegion}
              >
                선택 영역 녹화 시작
              </ToolButton>
            ) : active ? (
              <ToolButton
                icon={Stop}
                className="primary"
                disabled={status === "stopping"}
                onClick={stop}
              >
                녹화 종료
              </ToolButton>
            ) : (
              <ToolButton
                icon={VideoCamera}
                className="primary"
                disabled={status === "starting"}
                onClick={begin}
              >
                {status === "starting" ? "화면·마이크 선택 중…" : "녹화 시작"}
              </ToolButton>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function RecordingRegionPicker({ stream, onSelect, onError }) {
  const video = useRef(null);
  const origin = useRef(null);
  const [rect, setRect] = useState(null);
  const [ratio, setRatio] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = video.current;
    element.srcObject = stream;
    element.play().catch(onError);
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);
  const point = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const update = (event) => {
    if (!origin.current) return null;
    const p = point(event),
      start = origin.current;
    const next = {
      x: Math.min(p.x, start.x),
      y: Math.min(p.y, start.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    };
    setRect(next);
    return next;
  };
  return (
    <>
      {!ready && <p role="status">공유 화면을 불러오는 중…</p>}
      <div
        className="recording-region-picker"
        aria-label="녹화 영역 지정 미리보기"
        style={{ aspectRatio: ratio, width: `min(100%, ${48 * ratio}vh)` }}
        onPointerDown={(event) => {
          if (!ready || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = point(event);
          setRect(null);
          onSelect(null);
        }}
        onPointerMove={update}
        onPointerUp={(event) => {
          if (!origin.current) return;
          const next = update(event);
          origin.current = null;
          if (next.width >= 0.005 && next.height >= 0.005) onSelect(next);
          else {
            setRect(null);
            onSelect(null);
          }
        }}
        onPointerCancel={() => {
          origin.current = null;
          setRect(null);
          onSelect(null);
        }}
      >
        <video
          ref={video}
          muted
          playsInline
          onLoadedMetadata={() => {
            if (video.current.videoWidth && video.current.videoHeight) {
              setRatio(video.current.videoWidth / video.current.videoHeight);
              setReady(true);
            }
          }}
        />
        {rect && (
          <div
            className="recording-region-rect"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        )}
      </div>
      <p className="recording-help">
        다시 드래그하면 영역을 바꿀 수 있습니다. 녹화 중에는 선택한 영역이
        고정됩니다.
      </p>
    </>
  );
}
