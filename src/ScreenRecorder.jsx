import React, { useEffect, useRef, useState } from "react";
import { VideoCamera, Stop, DownloadSimple } from "@phosphor-icons/react";
import { Modal, ToolButton } from "./components.jsx";
import { startScreenRecording } from "./screen-recording.js";

export default function ScreenRecorder({ open, onClose }) {
  const [microphone, setMicrophone] = useState(false);
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
  const close = () => {
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
          {active ? (
            <p>
              화면을 녹화하고 있습니다. 녹화를 종료하면 동영상 파일로
              다운로드합니다.
            </p>
          ) : (
            <>
              <p>
                브라우저에서 녹화할 탭, 창 또는 전체 화면을 선택하세요. 종료하면
                동영상 파일로 다운로드합니다.
              </p>
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
          {result && (
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
            {active ? (
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
