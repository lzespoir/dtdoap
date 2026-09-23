import { useMemo, useRef } from "react";
import type { MapColorMetric } from "../types/map";
import {
  fetchQuickPathPreview,
  filterItemsByRegion,
  type QuickPathPreviewState,
} from "../lib/quickPathApi";

interface Props {
  batchId: string | null;
  state: QuickPathPreviewState;
  onChange: (next: QuickPathPreviewState) => void;
  onClose: () => void;
}

function nextMetric(m: MapColorMetric): MapColorMetric {
  if (m === "rsrp") return "sinr";
  if (m === "sinr") return "pci";
  return "rsrp";
}

function metricLabel(m: MapColorMetric): string {
  if (m === "rsrp") return "RSRP";
  if (m === "sinr") return "SINR";
  return "PCI";
}

export default function QuickPathPreviewPanel({
  batchId,
  state,
  onChange,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItem =
    state.items.find((i) => i.id === state.activeId) ?? null;

  const visibleItems = useMemo(() => {
    if (!state.sameRegionOnly) return state.items;
    return filterItemsByRegion(
      state.items,
      activeItem,
      state.regionRadiusM
    );
  }, [state.items, state.sameRegionOnly, state.regionRadiusM, activeItem]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    onChange({ ...state, loading: true, error: null });
    try {
      const { items, settings, errors } = await fetchQuickPathPreview(
        list,
        batchId
      );
      const merged = [...state.items, ...items];
      const firstNew = items[0]?.id ?? state.activeId;
      onChange({
        ...state,
        loading: false,
        items: merged,
        settings,
        activeId: state.activeId ?? firstNew ?? null,
        error: errors?.length ? errors.join("；") : null,
      });
    } catch (e) {
      onChange({
        ...state,
        loading: false,
        error: e instanceof Error ? e.message : "导入失败",
      });
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const selectItem = (id: string) => {
    onChange({ ...state, activeId: id });
  };

  const clearAll = () => {
    onChange({
      ...state,
      items: [],
      activeId: null,
      error: null,
    });
  };

  return (
    <aside className="quick-path-panel" aria-label="测试路径快速查看">
      <header className="quick-path-header">
        <h3>测试路径快速查看</h3>
        <button type="button" className="ghost-btn" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="quick-path-toolbar">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="quick-path-file-input"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          className="primary-btn"
          disabled={state.loading}
          onClick={() => inputRef.current?.click()}
        >
          {state.loading ? "处理中…" : "导入 CSV"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={state.items.length === 0}
          onClick={clearAll}
        >
          清空
        </button>
        <button
          type="button"
          className="opt-toggle-btn"
          onClick={() =>
            onChange({ ...state, metric: nextMetric(state.metric) })
          }
        >
          {metricLabel(state.metric)}
        </button>
      </div>

      <label className="quick-path-filter">
        <input
          type="checkbox"
          checked={state.sameRegionOnly}
          disabled={!activeItem}
          onChange={(e) =>
            onChange({ ...state, sameRegionOnly: e.target.checked })
          }
        />
        仅显示与当前选中同区域（半径
        <input
          type="number"
          min={50}
          max={2000}
          step={50}
          value={state.regionRadiusM}
          disabled={!state.sameRegionOnly}
          onChange={(e) =>
            onChange({
              ...state,
              regionRadiusM: Number(e.target.value) || 300,
            })
          }
        />
        m）
      </label>

      {state.error && <p className="quick-path-error">{state.error}</p>}

      <p className="settings-hint quick-path-hint">
        点击列表项在地图上查看轨迹与栅格；不写入批次、刷新后清空。处理参数沿用当前批次栅格设置（已关闭区域过滤以便看全路径）。
      </p>

      <ul className="quick-path-list">
        {visibleItems.length === 0 ? (
          <li className="quick-path-empty">导入路测 CSV 后开始预览</li>
        ) : (
          visibleItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`quick-path-item${item.id === state.activeId ? " active" : ""}`}
                onClick={() => selectItem(item.id)}
              >
                <span className="quick-path-name">{item.fileName}</span>
                <span className="quick-path-meta">
                  中心 {item.bbox.centerLon.toFixed(5)},{" "}
                  {item.bbox.centerLat.toFixed(5)} · 采样{" "}
                  {item.sampleCount.toLocaleString()} · 轨迹{" "}
                  {item.pathPointCount.toLocaleString()} 点
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
