import type { PathAdjustDisplay, PathAdjustLayer } from "../lib/pathAdjust";

interface Props {
  layers: PathAdjustLayer[];
  display: PathAdjustDisplay;
  selectedCount: number;
  mode: "navigate" | "edit";
  loading: boolean;
  onModeChange: (mode: "navigate" | "edit") => void;
  onDisplayChange: (display: PathAdjustDisplay) => void;
  onLayersChange: (layers: PathAdjustLayer[]) => void;
  onClearSelection: () => void;
  onImport: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onResetLayer: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  exportableCount: number;
}

export default function PathAdjustSidebar({
  layers,
  display,
  selectedCount,
  mode,
  loading,
  onModeChange,
  onDisplayChange,
  onLayersChange,
  onClearSelection,
  onImport,
  onExportJson,
  onExportCsv,
  onResetLayer,
  onRemoveLayer,
  exportableCount,
}: Props) {
  const patchLayer = (id: string, patch: Partial<PathAdjustLayer>) => {
    onLayersChange(
      layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
    );
  };

  return (
    <aside className="path-adjust-sidebar">
      <section className="path-adjust-section">
        <h2>文件</h2>
        <div className="path-adjust-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={loading}
            onClick={onImport}
          >
            {loading ? "处理中…" : "导入 CSV"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={exportableCount === 0}
            onClick={onExportCsv}
          >
            导出校正 CSV
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={exportableCount === 0}
            onClick={onExportJson}
          >
            导出参数 JSON
          </button>
        </div>
        <p className="path-adjust-hint">
          图层列表中勾选表示参与编辑与导出；未勾选文件不会写入导出结果。
        </p>
      </section>

      <section className="path-adjust-section">
        <h2>显示</h2>
        <p className="path-adjust-term-legend">
          轨迹按采集时间绘制：<span className="path-term-early">早</span>{" "}
          为时间起点，<span className="path-term-late">晚</span> 为时间终点（每段各一对）。
        </p>
        <div className="path-adjust-seg">
          {(
            [
              ["path", "轨迹线"],
              ["samples", "采样点"],
              ["both", "轨迹+点"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={display === v ? "active" : ""}
              onClick={() => onDisplayChange(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="path-adjust-section">
        <h2>工具</h2>
        <div className="path-adjust-seg">
          {(
            [
              ["navigate", "浏览"],
              ["edit", "编辑"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={mode === v ? "active" : ""}
              onClick={() => onModeChange(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="path-adjust-hint">
          {mode === "edit" &&
            "编辑：左键框选，右键拖动移动（有选区仅移选区）。交叉轨迹仅影响已选点。"}
          {mode === "navigate" && "浏览：拖拽平移、滚轮缩放地图。"}
          {mode === "edit" && (
            <>
              {" "}
              当前选区 {selectedCount} 点。
            </>
          )}
          {" "}
          Esc 取消当前操作。
        </p>
        <button
          type="button"
          className="ghost-btn"
          disabled={selectedCount === 0}
          onClick={onClearSelection}
        >
          清空选区
        </button>
      </section>

      <section className="path-adjust-section path-adjust-layers">
        <h2>图层 ({layers.length})</h2>
        <p className="path-adjust-hint path-adjust-layer-hint">
          勾选参与校正与导出；眼睛控制显示，锁防止误拖。
        </p>
        <ul className="path-adjust-layer-list">
          {layers.length === 0 ? (
            <li className="path-adjust-empty">导入路测文件后显示图层</li>
          ) : (
            layers.map((layer) => (
              <li
                key={layer.id}
                className={`path-adjust-layer-item${layer.active ? " active" : ""}`}
              >
                <div className="path-adjust-layer-row">
                  <button
                    type="button"
                    className={`layer-eye-btn${layer.visible ? " on" : ""}`}
                    title={layer.visible ? "隐藏" : "显示"}
                    onClick={() =>
                      patchLayer(layer.id, { visible: !layer.visible })
                    }
                  >
                    {layer.visible ? "◉" : "○"}
                  </button>
                  <button
                    type="button"
                    className={`path-adjust-lock${layer.locked ? " on" : ""}`}
                    title={layer.locked ? "已锁定" : "未锁定"}
                    onClick={() =>
                      patchLayer(layer.id, { locked: !layer.locked })
                    }
                  >
                    {layer.locked ? "🔒" : "🔓"}
                  </button>
                  <label className="path-adjust-layer-check">
                    <input
                      type="checkbox"
                      checked={layer.active}
                      onChange={(e) =>
                        patchLayer(layer.id, { active: e.target.checked })
                      }
                    />
                    <span
                      className="path-adjust-swatch"
                      style={{ background: layer.color }}
                    />
                    <span className="path-adjust-layer-name">{layer.fileName}</span>
                  </label>
                  <button
                    type="button"
                    className="path-adjust-remove"
                    title="移除文件"
                    onClick={() => onRemoveLayer(layer.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="path-adjust-layer-meta">
                  偏移 东 {layer.offsetEastMeters.toFixed(1)} m / 北{" "}
                  {layer.offsetNorthMeters.toFixed(1)} m
                  <button
                    type="button"
                    className="ghost-btn path-adjust-reset"
                    onClick={() => onResetLayer(layer.id)}
                  >
                    重置
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </aside>
  );
}
