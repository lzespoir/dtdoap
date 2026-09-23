import { useCallback, useRef, useState } from "react";
import { fetchQuickPathPreview } from "../../lib/quickPathApi";
import {
  buildFileCorrections,
  layerFromPreview,
  type PathAdjustLayer,
} from "../../lib/pathAdjust";
import {
  downloadCsvBase64,
  exportAdjustedCsvFiles,
} from "../../lib/pathAdjustExport";
import { type LonLat } from "../../lib/pathShapeGeometry";
import {
  createBinding,
  createShape,
  logicalPointCountFromStats,
  trailSegmentForLogicalRange,
  type ReferenceShape,
  type ShapeKind,
  type ShapeRole,
  type TimeBinding,
} from "../../lib/pathShapeSnap";
import { applyShapeSnap } from "../../lib/pathShapeSnapApi";
import PathShapeSnapMap, {
  type PathShapeSnapMapMode,
} from "../PathShapeSnapMap";
import PathShapeSnapSidebar from "../PathShapeSnapSidebar";
import ToolsLayout from "../ToolsLayout";

function ellipseRadiiFromCenter(center: LonLat, edge: LonLat): {
  east: number;
  north: number;
} {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const east = Math.abs((edge.lon - center.lon) * mPerDegLat * cosLat);
  const north = Math.abs((edge.lat - center.lat) * mPerDegLat);
  return {
    east: Math.max(east, 5),
    north: Math.max(north, 5),
  };
}

export default function PathShapeSnapPage() {
  const [theme] = useState<"light" | "dark">("light");
  const [layers, setLayers] = useState<PathAdjustLayer[]>([]);
  const [fileMap] = useState(() => new Map<string, File>());
  const [displayTrails, setDisplayTrails] = useState<
    Record<string, LonLat[]>
  >({});
  const [shapes, setShapes] = useState<ReferenceShape[]>([]);
  const [bindings, setBindings] = useState<TimeBinding[]>([]);
  const [mode, setMode] = useState<PathShapeSnapMapMode>("navigate");
  const [drawKind, setDrawKind] = useState<ShapeKind>("polyline");
  const [drawRole, setDrawRole] = useState<ShapeRole>("target");
  const [draftPoints, setDraftPoints] = useState<LonLat[]>([]);
  const [draftRadiiM, setDraftRadiiM] = useState<
    { east: number; north: number } | undefined
  >();
  const [cursorPt, setCursorPt] = useState<LonLat | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [corridorWidthM, setCorridorWidthM] = useState(15);
  const [bindingDraft, setBindingDraft] = useState({
    start: 0,
    end: 100,
    targetShapeId: "",
    constraintShapeIds: [] as string[],
  });
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const [trailRevision, setTrailRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shapeCountRef = useRef(0);

  const activeLayer =
    layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? null;

  const syncDraftIntoBindings = useCallback(
    (prev: TimeBinding[]): TimeBinding[] => {
      if (!activeLayer || !bindingDraft.targetShapeId) return prev;
      if (editingBindingId) {
        return prev.map((b) =>
          b.id === editingBindingId
            ? {
                ...b,
                startLogicalIndex: bindingDraft.start,
                endLogicalIndex: bindingDraft.end,
                targetShapeId: bindingDraft.targetShapeId,
                constraintShapeIds: bindingDraft.constraintShapeIds.length
                  ? bindingDraft.constraintShapeIds
                  : undefined,
              }
            : b
        );
      }
      return prev;
    },
    [activeLayer, bindingDraft, editingBindingId]
  );

  const handleBindingDraftChange = useCallback(
    (draft: typeof bindingDraft) => {
      setBindingDraft(draft);
      if (editingBindingId) {
        setBindings((prev) =>
          prev.map((b) =>
            b.id === editingBindingId
              ? {
                  ...b,
                  startLogicalIndex: draft.start,
                  endLogicalIndex: draft.end,
                  targetShapeId: draft.targetShapeId,
                  constraintShapeIds: draft.constraintShapeIds.length
                    ? draft.constraintShapeIds
                    : undefined,
                }
              : b
          )
        );
      }
    },
    [editingBindingId]
  );

  const bindingEqualsDraft = useCallback(
    (b: TimeBinding, draft: typeof bindingDraft) =>
      b.targetShapeId === draft.targetShapeId &&
      b.startLogicalIndex === draft.start &&
      b.endLogicalIndex === draft.end,
    []
  );

  const resolveEffectiveBindings = useCallback((): TimeBinding[] => {
    if (!activeLayer) return [...bindings];
    if (!bindingDraft.targetShapeId) {
      return editingBindingId ? syncDraftIntoBindings(bindings) : [...bindings];
    }

    let list = [...bindings];

    if (editingBindingId) {
      list = syncDraftIntoBindings(list);
    } else if (!list.some((b) => bindingEqualsDraft(b, bindingDraft))) {
      list = [
        ...list,
        createBinding(
          activeLayer.id,
          bindingDraft.start,
          bindingDraft.end,
          bindingDraft.targetShapeId,
          bindingDraft.constraintShapeIds.length
            ? bindingDraft.constraintShapeIds
            : undefined
        ),
      ];
    }

    if (list.length === 0) {
      list = [
        createBinding(
          activeLayer.id,
          bindingDraft.start,
          bindingDraft.end,
          bindingDraft.targetShapeId,
          bindingDraft.constraintShapeIds.length
            ? bindingDraft.constraintShapeIds
            : undefined
        ),
      ];
    }

    return list;
  }, [
    activeLayer,
    bindings,
    bindingDraft,
    bindingEqualsDraft,
    editingBindingId,
    syncDraftIntoBindings,
  ]);

  const selectBinding = useCallback((binding: TimeBinding) => {
    setEditingBindingId(binding.id);
    setBindingDraft({
      start: binding.startLogicalIndex,
      end: binding.endLogicalIndex,
      targetShapeId: binding.targetShapeId,
      constraintShapeIds: binding.constraintShapeIds ?? [],
    });
  }, []);

  const handleImport = () => inputRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setLoading(true);
    setError(null);
    try {
      const list = [...files];
      const { items, errors } = await fetchQuickPathPreview(list, null, {
        shapeSnapPreview: true,
      });
      const newLayers = items.map((item, i) =>
        layerFromPreview(item, layers.length + i)
      );
      for (let i = 0; i < list.length; i++) {
        const item = items[i];
        if (item) fileMap.set(item.fileName, list[i]!);
      }
      setLayers((prev) => {
        const merged = [...prev, ...newLayers];
        if (!activeLayerId && merged[0]) {
          setActiveLayerId(merged[0].id);
          const count = logicalPointCountFromStats(merged[0].item.result.stats);
          setBindingDraft((d) => ({
            ...d,
            end: Math.min(d.end, Math.max(0, count - 1)),
          }));
        }
        return merged;
      });
      if (errors?.length) setError(errors.join("；"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const finishDraftShape = useCallback(
    (points: LonLat[], radiiM?: { east: number; north: number }) => {
      if (drawKind === "ellipse") {
        if (points.length < 1 || !radiiM) return;
      } else if (drawKind === "polyline") {
        if (points.length < 2) return;
      } else if (points.length < 2) {
        return;
      }
      const shape = createShape(
        drawKind,
        drawKind === "ellipse" ? [points[0]!] : points,
        shapeCountRef.current++,
        drawRole,
        radiiM
      );
      setShapes((prev) => [...prev, shape]);
      setDraftPoints([]);
      setDraftRadiiM(undefined);
      setCursorPt(null);
      setMode("navigate");
      if (drawRole === "target") {
        setBindingDraft((d) => ({ ...d, targetShapeId: shape.id }));
        setEditingBindingId(null);
      }
    },
    [drawKind, drawRole]
  );

  const onMapClick = useCallback(
    (pt: LonLat) => {
      if (mode !== "draw") return;
      if (drawKind === "ellipse") {
        if (draftPoints.length === 0) {
          setDraftPoints([pt]);
          return;
        }
        const radii =
          draftRadiiM ?? ellipseRadiiFromCenter(draftPoints[0]!, pt);
        finishDraftShape(draftPoints, radii);
        return;
      }
      if (drawKind === "line" || drawKind === "rectangle") {
        const next = draftPoints.length === 0 ? [pt] : [draftPoints[0]!, pt];
        setDraftPoints(next);
        if (next.length >= 2) finishDraftShape(next);
        return;
      }
      setDraftPoints((prev) => [...prev, pt]);
    },
    [mode, drawKind, draftPoints, draftRadiiM, finishDraftShape]
  );

  const onMapMove = useCallback(
    (pt: LonLat) => {
      if (mode !== "draw") return;
      setCursorPt(pt);
      if (drawKind === "ellipse" && draftPoints.length === 1) {
        setDraftRadiiM(ellipseRadiiFromCenter(draftPoints[0]!, pt));
      }
    },
    [mode, drawKind, draftPoints]
  );

  const onMapDoubleClick = useCallback(() => {
    if (mode !== "draw" || drawKind !== "polyline") return;
    if (draftPoints.length >= 2) {
      finishDraftShape(draftPoints);
    } else {
      setDraftPoints([]);
      setCursorPt(null);
    }
  }, [mode, drawKind, draftPoints, finishDraftShape]);

  const onShapesChange = useCallback((next: ReferenceShape[]) => {
    setShapes(next);
  }, []);

  const resetLayer = (id: string) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              offsetEastMeters: 0,
              offsetNorthMeters: 0,
              pointOffsets: {},
              shapeSnapPatches: undefined,
            }
          : l
      )
    );
    setDisplayTrails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBindings((prev) => prev.filter((b) => b.layerId !== id));
  };

  const removeLayer = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (layer) fileMap.delete(layer.fileName);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setDisplayTrails((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBindings((prev) => prev.filter((b) => b.layerId !== id));
    if (activeLayerId === id) {
      setActiveLayerId(layers.find((l) => l.id !== id)?.id ?? null);
    }
  };

  const removeShape = (id: string) => {
    setShapes((prev) => prev.filter((s) => s.id !== id));
    setBindings((prev) =>
      prev.filter(
        (b) =>
          b.targetShapeId !== id && !b.constraintShapeIds?.includes(id)
      )
    );
    if (selectedShapeId === id) setSelectedShapeId(null);
  };

  const addBinding = () => {
    if (!activeLayer || !bindingDraft.targetShapeId) {
      setError("请选择图层与目标形状");
      return;
    }
    const binding = createBinding(
      activeLayer.id,
      bindingDraft.start,
      bindingDraft.end,
      bindingDraft.targetShapeId,
      bindingDraft.constraintShapeIds.length
        ? bindingDraft.constraintShapeIds
        : undefined
    );
    setBindings((prev) => [...prev, binding]);
    setEditingBindingId(binding.id);
    setError(null);
  };

  const updateBinding = () => {
    if (!editingBindingId) return;
    setBindings((prev) => syncDraftIntoBindings(prev));
    setError(null);
  };

  const applyBindings = async () => {
    if (!activeLayer) return;
    const effectiveBindings = resolveEffectiveBindings();
    if (effectiveBindings.length === 0) return;
    setComputing(true);
    setError(null);
    try {
      const layerIds = [...new Set(effectiveBindings.map((b) => b.layerId))];
      const nextTrails: Record<string, LonLat[]> = {};
      const updatedLayers = [...layers];

      for (const layerId of layerIds) {
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) continue;
        const file = fileMap.get(layer.fileName);
        if (!file) {
          throw new Error(`找不到 ${layer.fileName} 的原始 CSV`);
        }
        const layerBindings = effectiveBindings.filter(
          (b) => b.layerId === layerId
        );
        const result = await applyShapeSnap(file, {
          layerId: layer.id,
          fileName: layer.fileName,
          offsetEastMeters: layer.offsetEastMeters,
          offsetNorthMeters: layer.offsetNorthMeters,
          shapes,
          bindings: layerBindings,
          corridorWidthM,
        });
        const idx = updatedLayers.findIndex((l) => l.id === layerId);
        if (idx >= 0) {
          updatedLayers[idx] = {
            ...updatedLayers[idx]!,
            pointOffsets: { ...result.pointOffsets },
            shapeSnapPatches: result.patches,
          };
        }
        nextTrails[layerId] = [...result.displayTrail];
      }

      setBindings(effectiveBindings);
      setLayers(updatedLayers);
      setDisplayTrails(nextTrails);
      setTrailRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "附着计算失败");
    } finally {
      setComputing(false);
    }
  };

  const exportCsv = async () => {
    setLoading(true);
    setError(null);
    try {
      const activeLayers = layers.filter((l) => l.active);
      const corrections = buildFileCorrections(activeLayers);
      if (corrections.length === 0) {
        throw new Error("请勾选需要导出的文件");
      }
      const files: File[] = [];
      for (const c of corrections) {
        const f = fileMap.get(c.fileName);
        if (f) files.push(f);
      }
      if (files.length === 0) {
        throw new Error("找不到原始 CSV，请重新导入");
      }
      const { files: out } = await exportAdjustedCsvFiles(files, corrections);
      for (const o of out) {
        downloadCsvBase64(o.fileName, o.csvBase64);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setLoading(false);
    }
  };

  const draftForMap =
    drawKind === "polyline" && cursorPt && draftPoints.length > 0
      ? [...draftPoints, cursorPt]
      : draftPoints;

  const rangeHighlight =
    activeLayer && bindingDraft.targetShapeId
      ? {
          layerId: activeLayer.id,
          start: Math.min(bindingDraft.start, bindingDraft.end),
          end: Math.max(bindingDraft.start, bindingDraft.end),
          segment: trailSegmentForLogicalRange(
            activeLayer.item.result.samples,
            logicalPointCountFromStats(activeLayer.item.result.stats),
            bindingDraft.start,
            bindingDraft.end
          ),
        }
      : null;

  return (
    <ToolsLayout title="路测轨迹形状附着">
      <p className="tools-note path-adjust-intro">
        绘制参考形状并绑定时间段后点击「计算附着」；服务端按 CSV
        主区逻辑点计算（连续同坐标复用结果），地图仅预览主区路径。
      </p>
      {error && <p className="path-adjust-error">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="path-adjust-file-input"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <div className="path-adjust-layout">
        <PathShapeSnapSidebar
          layers={layers}
          activeLayerId={activeLayerId ?? activeLayer?.id ?? null}
          shapes={shapes}
          bindings={bindings}
          editingBindingId={editingBindingId}
          mode={mode}
          drawKind={drawKind}
          drawRole={drawRole}
          bindingDraft={bindingDraft}
          corridorWidthM={corridorWidthM}
          loading={loading || computing}
          selectedShapeId={selectedShapeId}
          onActiveLayerChange={setActiveLayerId}
          onLayersChange={setLayers}
          onModeChange={setMode}
          onDrawKindChange={setDrawKind}
          onDrawRoleChange={setDrawRole}
          onBindingDraftChange={handleBindingDraftChange}
          onSelectBinding={selectBinding}
          onCorridorWidthChange={setCorridorWidthM}
          onSelectedShapeChange={setSelectedShapeId}
          onImport={handleImport}
          onApplyBindings={() => void applyBindings()}
          onResetLayer={resetLayer}
          onRemoveLayer={removeLayer}
          onRemoveShape={removeShape}
          onAddBinding={addBinding}
          onUpdateBinding={updateBinding}
          onRemoveBinding={(id: string) => {
            setBindings((prev) => prev.filter((b) => b.id !== id));
            if (editingBindingId === id) setEditingBindingId(null);
          }}
          onExportCsv={() => void exportCsv()}
          exportableCount={layers.filter((l) => l.active).length}
        />
        <PathShapeSnapMap
          theme={theme}
          layers={layers}
          displayTrails={displayTrails}
          rangeHighlight={rangeHighlight}
          trailRevision={trailRevision}
          shapes={shapes}
          draftPoints={draftForMap}
          draftKind={drawKind}
          draftRadiiM={draftRadiiM}
          mode={mode}
          selectedShapeId={selectedShapeId}
          onMapClick={onMapClick}
          onMapMove={onMapMove}
          onMapDoubleClick={onMapDoubleClick}
          onShapesChange={onShapesChange}
        />
      </div>
    </ToolsLayout>
  );
}
