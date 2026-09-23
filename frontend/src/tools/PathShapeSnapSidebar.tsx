import type { PathAdjustLayer } from "../lib/pathAdjust";
import {
  logicalPointCountFromStats,
  type ReferenceShape,
  type ShapeKind,
  type ShapeRole,
  type TimeBinding,
} from "../lib/pathShapeSnap";

interface Props {
  layers: PathAdjustLayer[];
  activeLayerId: string | null;
  shapes: ReferenceShape[];
  bindings: TimeBinding[];
  editingBindingId: string | null;
  mode: "navigate" | "draw" | "edit-shape";
  drawKind: ShapeKind;
  drawRole: ShapeRole;
  bindingDraft: {
    start: number;
    end: number;
    targetShapeId: string;
    constraintShapeIds: string[];
  };
  corridorWidthM: number;
  loading: boolean;
  selectedShapeId: string | null;
  onActiveLayerChange: (id: string | null) => void;
  onLayersChange: (layers: PathAdjustLayer[]) => void;
  onModeChange: (m: "navigate" | "draw" | "edit-shape") => void;
  onDrawKindChange: (k: ShapeKind) => void;
  onDrawRoleChange: (r: ShapeRole) => void;
  onBindingDraftChange: (d: Props["bindingDraft"]) => void;
  onSelectBinding: (binding: TimeBinding) => void;
  onCorridorWidthChange: (m: number) => void;
  onSelectedShapeChange: (id: string | null) => void;
  onImport: () => void;
  onApplyBindings: () => void;
  onResetLayer: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  onRemoveShape: (id: string) => void;
  onAddBinding: () => void;
  onUpdateBinding: () => void;
  onRemoveBinding: (id: string) => void;
  onExportCsv: () => void;
  exportableCount: number;
}

const DRAW_KINDS: { id: ShapeKind; label: string }[] = [
  { id: "polyline", label: "折线" },
  { id: "line", label: "直线" },
  { id: "rectangle", label: "矩形" },
  { id: "ellipse", label: "椭圆" },
];

export default function PathShapeSnapSidebar({
  layers,
  activeLayerId,
  shapes,
  bindings,
  editingBindingId,
  mode,
  drawKind,
  drawRole,
  bindingDraft,
  corridorWidthM,
  loading,
  selectedShapeId,
  onActiveLayerChange,
  onLayersChange,
  onModeChange,
  onDrawKindChange,
  onDrawRoleChange,
  onBindingDraftChange,
  onSelectBinding,
  onCorridorWidthChange,
  onSelectedShapeChange,
  onImport,
  onApplyBindings,
  onResetLayer,
  onRemoveLayer,
  onRemoveShape,
  onAddBinding,
  onUpdateBinding,
  onRemoveBinding,
  onExportCsv,
  exportableCount,
}: Props) {
  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const logicalMax = activeLayer
    ? Math.max(
        0,
        logicalPointCountFromStats(activeLayer.item.result.stats) - 1
      )
    : 0;
  const targetShapes = shapes.filter((s) => s.role === "target");
  const constraintShapes = shapes.filter((s) => s.role === "constraint");

  const patchLayer = (id: string, patch: Partial<PathAdjustLayer>) => {
    onLayersChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
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
            disabled={exportableCount === 0 || loading}
            onClick={onExportCsv}
          >
            导出校正 CSV
          </button>
        </div>
        <p className="path-adjust-hint">
          导入后绘制参考形状并绑定时间段；点击「计算附着」后由服务端按 CSV
          主区逻辑点计算，地图仅显示主区路径。
        </p>
      </section>

      <section className="path-adjust-section">
        <h2>图层</h2>
        {layers.length === 0 ? (
          <p className="path-adjust-empty">请先导入路测 CSV</p>
        ) : (
          <ul className="path-adjust-layer-list">
            {layers.map((layer) => (
              <li
                key={layer.id}
                className={`path-adjust-layer-item${layer.id === activeLayerId ? " active" : ""}`}
              >
                <div className="path-adjust-layer-row">
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
                    className="path-adjust-reset"
                    onClick={() => onActiveLayerChange(layer.id)}
                  >
                    选中
                  </button>
                  <button
                    type="button"
                    className="path-adjust-reset"
                    onClick={() => onResetLayer(layer.id)}
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    className="path-adjust-remove"
                    onClick={() => onRemoveLayer(layer.id)}
                  >
                    ×
                  </button>
                </div>
                <p className="path-adjust-layer-meta">
                  主区逻辑点{" "}
                  {logicalPointCountFromStats(
                    layer.item.result.stats
                  ).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="path-adjust-section">
        <h2>地图模式</h2>
        <div className="path-adjust-seg">
          {(
            [
              ["navigate", "导航"],
              ["draw", "绘制"],
              ["edit-shape", "编辑形状"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={mode === id ? "active" : ""}
              onClick={() => onModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="path-adjust-section">
        <h2>绘制工具</h2>
        <div className="path-adjust-seg">
          {DRAW_KINDS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={drawKind === id ? "active" : ""}
              onClick={() => {
                onDrawKindChange(id);
                onModeChange("draw");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="path-adjust-seg" style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            className={drawRole === "target" ? "active" : ""}
            onClick={() => onDrawRoleChange("target")}
          >
            目标形状
          </button>
          <button
            type="button"
            className={drawRole === "constraint" ? "active" : ""}
            onClick={() => onDrawRoleChange("constraint")}
          >
            约束形状
          </button>
        </div>
      </section>

      <section className="path-adjust-section">
        <h2>参考形状 ({shapes.length})</h2>
        {shapes.length === 0 ? (
          <p className="path-adjust-empty">在绘制模式下于地图落点</p>
        ) : (
          <ul className="path-adjust-layer-list">
            {shapes.map((s) => (
              <li
                key={s.id}
                className={`path-adjust-layer-item${s.id === selectedShapeId ? " active" : ""}`}
              >
                <div className="path-adjust-layer-row">
                  <span
                    className="path-adjust-swatch"
                    style={{ background: s.color }}
                  />
                  <button
                    type="button"
                    className="path-adjust-layer-name"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "inherit",
                    }}
                    onClick={() => {
                      onSelectedShapeChange(s.id);
                      onModeChange("edit-shape");
                    }}
                  >
                    {s.name} ({s.kind})
                  </button>
                  <button
                    type="button"
                    className="path-adjust-remove"
                    onClick={() => onRemoveShape(s.id)}
                  >
                    ×
                  </button>
                </div>
                <p className="path-adjust-layer-meta">
                  {s.role === "constraint" ? "约束" : "目标"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="path-adjust-section">
        <h2>时间段绑定</h2>
        {activeLayer && (
          <>
            <label className="path-adjust-hint">
              起始点
              <input
                type="range"
                min={0}
                max={logicalMax}
                value={bindingDraft.start}
                onChange={(e) =>
                  onBindingDraftChange({
                    ...bindingDraft,
                    start: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
              {bindingDraft.start}
            </label>
            <label className="path-adjust-hint">
              结束点
              <input
                type="range"
                min={0}
                max={logicalMax}
                value={bindingDraft.end}
                onChange={(e) =>
                  onBindingDraftChange({
                    ...bindingDraft,
                    end: Number(e.target.value),
                  })
                }
                style={{ width: "100%" }}
              />
              {bindingDraft.end}
            </label>
            <label className="path-adjust-hint">
              目标形状
              <select
                value={bindingDraft.targetShapeId}
                onChange={(e) =>
                  onBindingDraftChange({
                    ...bindingDraft,
                    targetShapeId: e.target.value,
                  })
                }
                style={{ width: "100%", marginTop: "0.25rem" }}
              >
                <option value="">请选择</option>
                {targetShapes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {constraintShapes.length > 0 && (
              <fieldset className="path-adjust-hint" style={{ border: "none", padding: 0 }}>
                <legend>约束形状（可选）</legend>
                {constraintShapes.map((s) => (
                  <label key={s.id} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={bindingDraft.constraintShapeIds.includes(s.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...bindingDraft.constraintShapeIds, s.id]
                          : bindingDraft.constraintShapeIds.filter(
                              (id) => id !== s.id
                            );
                        onBindingDraftChange({
                          ...bindingDraft,
                          constraintShapeIds: ids,
                        });
                      }}
                    />{" "}
                    {s.name}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="path-adjust-hint">
              走廊宽度 (m)
              <input
                type="number"
                min={1}
                max={200}
                value={corridorWidthM}
                onChange={(e) =>
                  onCorridorWidthChange(Number(e.target.value) || 15)
                }
                style={{ width: "100%", marginTop: "0.25rem" }}
              />
            </label>
            <div className="path-adjust-actions">
              <button type="button" className="ghost-btn" onClick={onAddBinding}>
                添加绑定
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={!editingBindingId}
                onClick={onUpdateBinding}
              >
                更新选中
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={
                  (bindings.length === 0 && !bindingDraft.targetShapeId) ||
                  loading
                }
                onClick={onApplyBindings}
              >
                {loading ? "计算中…" : "计算附着"}
              </button>
            </div>
            <p className="path-adjust-hint">
              每个椭圆/形状需单独「添加绑定」；多段附着会一并计算。拖动滑块可看黄色高亮。
            </p>
          </>
        )}
        {bindings.length > 0 && (
          <ul className="path-adjust-layer-list" style={{ marginTop: "0.75rem" }}>
            {bindings.map((b) => {
              const target = shapes.find((s) => s.id === b.targetShapeId);
              return (
                <li
                  key={b.id}
                  className={`path-adjust-layer-item${b.id === editingBindingId ? " active" : ""}`}
                >
                  <div className="path-adjust-layer-row">
                    <button
                      type="button"
                      className="path-adjust-layer-name"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        color: "inherit",
                        flex: 1,
                      }}
                      onClick={() => onSelectBinding(b)}
                    >
                      {b.startLogicalIndex}–{b.endLogicalIndex} →{" "}
                      {target?.name ?? "?"}
                    </button>
                    <button
                      type="button"
                      className="path-adjust-remove"
                      onClick={() => onRemoveBinding(b.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
