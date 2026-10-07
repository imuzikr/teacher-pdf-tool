import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileArrowDown,
  FolderPlus,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { PageCanvas, ToolButton } from "./components.jsx";
import { rotatedSize } from "./pdf-engine.js";
import useDragAutoScroll from "./useDragAutoScroll.js";
import {
  addAssemblyPages,
  moveAssemblyEntry,
  resolveAssemblyPages,
} from "./assembly.js";

function AssemblyPreview({ page }) {
  const { width, height } = rotatedSize(page);
  return (
    <div className="assembly-preview-box">
      <PageCanvas
        page={page}
        width={Math.min(105, (150 * width) / height)}
        thumbnail
      />
    </div>
  );
}

export default function PdfAssembler({
  pages,
  selected,
  setSelected,
  entries,
  onChange,
  onAddFiles,
  onSave,
  busy,
}) {
  const [filename, setFilename] = useState("SenPDF_새문서.pdf");
  const [dropOver, setDropOver] = useState(false);
  const root = useRef(null);
  const dragging = useRef(null);
  useDragAutoScroll(root, dragging, busy);
  const groups = [...new Set(pages.map((page) => page.source))];
  const draftPages = resolveAssemblyPages(entries, pages);
  const count = pages.filter((page) => selected.has(page.id)).length;
  const add = (ids) => {
    if (!busy && ids.size) onChange(addAssemblyPages(entries, pages, ids));
  };
  const select = (ids, checked) =>
    setSelected((old) => {
      const next = new Set(old);
      for (const id of ids) checked ? next.add(id) : next.delete(id);
      return next;
    });
  const startDrag = (event, value) => {
    dragging.current = value;
    event.dataTransfer.setData("application/x-senpdf-page", value.type);
    event.dataTransfer.effectAllowed =
      value.type === "source" ? "copy" : "move";
  };
  const drop = (event, index = entries.length - 1) => {
    if (!dragging.current || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const value = dragging.current;
    if (value.type === "source") add(new Set(value.ids));
    else onChange(moveAssemblyEntry(entries, value.id, index));
    dragging.current = null;
    setDropOver(false);
  };
  return (
    <div className="pdf-assembler" ref={root}>
      <div className="assembler-heading">
        <div>
          <h2>페이지 추출·병합</h2>
          <p>파일마다 필요한 페이지를 선택해 아래 새 문서에 추가하세요.</p>
        </div>
        <ToolButton icon={FolderPlus} disabled={busy} onClick={onAddFiles}>
          PDF 파일 추가
        </ToolButton>
      </div>
      <div className="assembly-source-list">
        {groups.map((source) => {
          const sourceList = pages.filter(
            (page) => page.source.id === source.id,
          );
          const chosen = sourceList.filter((page) => selected.has(page.id));
          return (
            <section
              className="assembly-source"
              key={source.id}
              aria-label={`${source.name} 페이지`}
            >
              <div className="assembly-file-heading">
                <strong title={source.name}>{source.name}</strong>
                <span>{sourceList.length}쪽</span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    select(
                      sourceList.map((page) => page.id),
                      chosen.length !== sourceList.length,
                    )
                  }
                >
                  {chosen.length === sourceList.length
                    ? "파일 선택 해제"
                    : "파일 전체 선택"}
                </button>
                <ToolButton
                  icon={Plus}
                  disabled={busy || !chosen.length}
                  onClick={() => add(new Set(chosen.map((page) => page.id)))}
                >
                  이 파일의 선택 페이지 추가 ({chosen.length}쪽)
                </ToolButton>
              </div>
              <div className="assembly-page-row">
                {sourceList.map((page) => (
                  <div
                    className={`assembly-source-page ${selected.has(page.id) ? "chosen" : ""}`}
                    key={page.id}
                    draggable={!busy}
                    onDragStart={(event) =>
                      startDrag(event, {
                        type: "source",
                        ids: selected.has(page.id)
                          ? pages
                              .filter((p) => selected.has(p.id))
                              .map((p) => p.id)
                          : [page.id],
                      })
                    }
                    onDragEnd={() => {
                      dragging.current = null;
                      setDropOver(false);
                    }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        className="assembly-source-checkbox"
                        checked={selected.has(page.id)}
                        disabled={busy}
                        onChange={(event) =>
                          select([page.id], event.target.checked)
                        }
                        aria-label={`${source.name} 원본 ${page.index + 1}쪽 선택`}
                      />
                      <AssemblyPreview page={page} />
                      <span>원본 {page.index + 1}쪽</span>
                    </label>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {!groups.length && (
          <p className="assembly-empty-source">
            PDF 파일을 추가해 페이지를 선택하세요. 여러 파일을 한 번에 추가할 수
            있습니다.
          </p>
        )}
      </div>
      <div className="assembly-add-bar">
        <span>
          {count}쪽 선택 · 선택한 페이지는 현재 원본 목록 순서로 추가됩니다.
        </span>
        <ToolButton
          icon={Plus}
          className="primary"
          disabled={busy || !count}
          onClick={() => add(selected)}
        >
          선택한 페이지 새 문서에 추가 ({count}쪽)
        </ToolButton>
      </div>
      <section
        className={`assembly-destination ${dropOver ? "drag-over" : ""}`}
        aria-label="새 문서 자리표시 영역"
        onDragOver={(event) => {
          if (dragging.current && !busy) {
            event.preventDefault();
            setDropOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setDropOver(false);
        }}
        onDrop={(event) => drop(event)}
      >
        <div className="assembly-file-heading">
          <h3>새 문서</h3>
          <span>{entries.length}쪽</span>
          <small>
            드래그 또는 이동 버튼으로 순서를 바꾸세요. 같은 페이지도 여러 번
            추가할 수 있습니다.
          </small>
        </div>
        {!entries.length ? (
          <div className="assembly-placeholder">
            <Plus size={28} />
            <strong>새 문서 자리표시 영역</strong>
            <p>위에서 페이지를 여기로 드래그하거나 추가 버튼을 누르세요.</p>
          </div>
        ) : (
          <div className="assembly-page-row assembly-draft-row">
            {entries.map((entry, index) => (
              <div
                className="assembly-draft-page"
                key={entry.id}
                draggable={!busy}
                onDragStart={(event) =>
                  startDrag(event, { type: "draft", id: entry.id })
                }
                onDragEnd={() => {
                  dragging.current = null;
                  setDropOver(false);
                }}
                onDrop={(event) => drop(event, index)}
              >
                <AssemblyPreview page={draftPages[index]} />
                <strong>새 문서 {index + 1}쪽</strong>
                <small title={entry.page.source.name}>
                  {entry.page.source.name}
                </small>
                <small>원본 {entry.page.index + 1}쪽</small>
                <div className="assembly-page-actions">
                  <button
                    className="icon-button"
                    aria-label={`새 문서 ${index + 1}쪽 앞으로 이동`}
                    disabled={busy || index === 0}
                    onClick={() =>
                      onChange(moveAssemblyEntry(entries, entry.id, index - 1))
                    }
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`새 문서 ${index + 1}쪽 뒤로 이동`}
                    disabled={busy || index === entries.length - 1}
                    onClick={() =>
                      onChange(moveAssemblyEntry(entries, entry.id, index + 1))
                    }
                  >
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`새 문서 ${index + 1}쪽 제거`}
                    disabled={busy}
                    onClick={() =>
                      onChange(entries.filter((item) => item.id !== entry.id))
                    }
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="assembly-save-bar">
        <label htmlFor="assembly-filename">새 문서 파일 이름</label>
        <input
          id="assembly-filename"
          value={filename}
          disabled={busy}
          maxLength={150}
          onChange={(event) => setFilename(event.target.value)}
        />
        <ToolButton
          icon={FileArrowDown}
          className="primary"
          disabled={busy || !entries.length || !filename.trim()}
          onClick={() =>
            onSave(draftPages, filename.trim().replace(/\.pdf$/i, "") + ".pdf")
          }
        >
          새 문서 PDF 저장
        </ToolButton>
      </div>
      <p className="modal-footnote">
        원본 파일과 페이지 목록은 유지됩니다. 새 문서에 포함된 편집 내용도
        저장하며, 개인정보 가림이 포함되면 새 문서 전체를 이미지 PDF로 만듭니다.
      </p>
    </div>
  );
}
