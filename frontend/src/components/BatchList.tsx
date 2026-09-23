import { useState } from "react";
import type { BatchSummary } from "../lib/api";
import { updateBatchAlias } from "../lib/api";
import { displayFilename } from "../lib/filename";

interface BatchListProps {
  batches: BatchSummary[];
  selectedId: string | null;
  loading?: boolean;
  onSelect: (batch: BatchSummary) => void;
  onDelete: (batchId: string) => void;
  onAliasChange?: (batchId: string, alias: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function batchLabel(b: BatchSummary): string {
  return b.alias || `${b.id.slice(0, 8)}…`;
}

function InlineAlias({
  batch,
  onSave,
}: {
  batch: BatchSummary;
  onSave: (alias: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(batch.alias ?? "");

  const commit = async () => {
    const trimmed = value.trim();
    if (trimmed !== (batch.alias ?? "")) {
      try {
        await updateBatchAlias(batch.id, trimmed);
        onSave(trimmed);
      } catch { /* ignore */ }
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        className="batch-alias"
        title="双击编辑别名"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setValue(batch.alias ?? "");
          setEditing(true);
        }}
      >
        {batch.alias || <span className="muted">未命名</span>}
      </span>
    );
  }

  return (
    <input
      className="batch-alias-edit"
      value={value}
      autoFocus
      placeholder="输入别名"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

export default function BatchList({
  batches,
  selectedId,
  loading,
  onSelect,
  onDelete,
  onAliasChange,
}: BatchListProps) {
  const [expanded, setExpanded] = useState(false);

  const selected = batches.find((b) => b.id === selectedId);
  const summaryText = selected
    ? `${batchLabel(selected)} · 工参 ${
        selected.gongcanNames.length
      } · 路测前 ${selected.luceCount}${
        (selected.luceAfterCount ?? 0) > 0
          ? ` / 后 ${selected.luceAfterCount}`
          : ""
      }`
    : batches.length > 0
      ? `共 ${batches.length} 个批次`
      : "暂无批次";

  return (
    <section className={`batch-list${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="batch-list-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="batch-list-toggle-title">数据批次</span>
        <span className="batch-list-toggle-summary">{summaryText}</span>
        <span className="batch-list-chevron">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="batch-list-body">
          {loading ? (
            <p className="batch-list-empty">加载中…</p>
          ) : batches.length === 0 ? (
            <p className="batch-list-empty">上传工参与路测后将自动新建批次</p>
          ) : (
            <ul>
              {batches.map((b) => {
                const active = b.id === selectedId;
                const gongcanDisplay = b.gongcanNames.map(displayFilename);
                return (
                  <li key={b.id} className={active ? "active" : ""}>
                    <button
                      type="button"
                      className="batch-item-main"
                      onClick={() => onSelect(b)}
                    >
                      <span className="batch-item-top">
                        <InlineAlias
                          batch={b}
                          onSave={(alias) => onAliasChange?.(b.id, alias)}
                        />
                        <span className="batch-time">
                          {formatTime(b.createdAt)}
                        </span>
                      </span>
                      {gongcanDisplay.length > 0 ? (
                        <span
                          className="batch-gongcan"
                          title={gongcanDisplay.join("\n")}
                        >
                          工参：{gongcanDisplay[0]}
                          {gongcanDisplay.length > 1
                            ? ` 等 ${gongcanDisplay.length} 个`
                            : ""}
                        </span>
                      ) : (
                        <span className="batch-gongcan muted">工参：未上传</span>
                      )}
                      <span className="batch-meta">
                        路测前 {b.luceCount}
                        {(b.luceAfterCount ?? 0) > 0
                          ? ` · 后 ${b.luceAfterCount}`
                          : ""}
                        {b.cellsCount !== null
                          ? ` · 小区 ${b.cellsCount}`
                          : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="batch-delete"
                      title="删除批次"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `确定删除批次 ${batchLabel(b)}？\n将删除该批次下所有工参与路测文件。`
                          )
                        ) {
                          onDelete(b.id);
                        }
                      }}
                    >
                      删除
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
