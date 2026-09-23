import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchMeta } from "./lib/api";
import type { CellSite } from "./types/cell";
import {
  DEFAULT_LUCE_SETTINGS,
  type LuceProcessResult,
  type LuceSettings,
} from "./types/luce";
import type {
  GridMatchMode,
  OptimizationCompare,
} from "./types/optimize";
import { DELTA_RSRP_RANGE, DELTA_SINR_RANGE } from "./constants";
import {
  deltaRsrpLegendGradientCss,
  deltaSinrLegendGradientCss,
  metricRangesFromSettings,
  rsrpLegendEndpointHexes,
  rsrpLegendGradientCss,
  sinrLegendEndpointHexes,
  sinrLegendGradientCss,
} from "./lib/rsrpColor";
import { saveLuceSettings } from "./lib/luceApi";
import ChatPanel from "./components/ChatPanel";
import CesiumMap from "./components/CesiumMap";
import ToolDock from "./components/ToolDock";
import LayerManagerDrawer from "./components/LayerManagerDrawer";
import SettingsDrawer from "./components/SettingsDrawer";
import OptimizationPanel from "./components/OptimizationPanel";
import QuickPathPreviewPanel from "./components/QuickPathPreviewPanel";
import { fetchAfterLuceResult, fetchOptimizationCompare } from "./lib/optimizeApi";
import { initialQuickPathState } from "./lib/quickPathApi";
import type { MapTheme, OptimizationView, WorkflowStep } from "./types";
import type { MapColorMetric } from "./types/map";
import { collectPcisFromLuce, pciLegendItems, buildPciColorMap } from "./lib/pciColor";
import {
  BASE_MAP_PROVIDERS,
  loadBaseMapConfig,
  type BaseMapConfig,
} from "./types/baseMap";
import { loadMapLayers, type MapLayersState } from "./types/mapLayers";
import "./App.css";

function nextMapMetric(
  current: MapColorMetric,
  deltaView: boolean
): MapColorMetric {
  if (deltaView) return current === "rsrp" ? "sinr" : "rsrp";
  if (current === "rsrp") return "sinr";
  if (current === "sinr") return "pci";
  return "rsrp";
}

function mapMetricToggleLabel(
  current: MapColorMetric,
  deltaView: boolean
): string {
  if (deltaView) return current === "rsrp" ? "切换 SINR" : "切换 RSRP";
  if (current === "rsrp") return "切换 SINR";
  if (current === "sinr") return "按 PCI 着色";
  return "切换 RSRP";
}

export default function App() {
  const [theme, setTheme] = useState<MapTheme>("light");
  const [optView, setOptView] = useState<OptimizationView>("before");
  const [step, setStep] = useState<WorkflowStep>("idle");
  const [batch, setBatch] = useState<BatchMeta | null>(null);
  const [cells, setCells] = useState<CellSite[]>([]);
  const [luceData, setLuceData] = useState<LuceProcessResult | null>(null);
  const [afterLuceData, setAfterLuceData] = useState<LuceProcessResult | null>(
    null
  );
  const [luceSettings, setLuceSettings] = useState<LuceSettings>(
    DEFAULT_LUCE_SETTINGS
  );
  const [compare, setCompare] = useState<OptimizationCompare | null>(null);
  const [showOptPanel, setShowOptPanel] = useState(false);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [gridMatchMode, setGridMatchMode] =
    useState<GridMatchMode>("intersection");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapLayers, setMapLayers] = useState<MapLayersState>(loadMapLayers);
  const [baseMap, setBaseMap] =
    useState<BaseMapConfig>(loadBaseMapConfig);
  const [reprocessHandler, setReprocessHandler] = useState<
    ((s: LuceSettings) => void) | null
  >(null);
  const [mapMetric, setMapMetric] = useState<MapColorMetric>("rsrp");
  const [quickPath, setQuickPath] = useState(initialQuickPathState);

  const registerReprocess = useCallback((fn: (s: LuceSettings) => void) => {
    setReprocessHandler(() => fn);
  }, []);

  const mapLuceData = optView === "after" ? afterLuceData : luceData;

  const quickActiveItem =
    quickPath.open && quickPath.activeId
      ? quickPath.items.find((i) => i.id === quickPath.activeId) ?? null
      : null;
  const mapDisplayLuce = quickActiveItem?.result ?? mapLuceData;
  const mapDisplaySettings =
    quickActiveItem?.result.settings ??
    quickPath.settings ??
    luceSettings;
  const mapDisplayMetric = quickPath.open ? quickPath.metric : mapMetric;
  const mapDisplayOptView: OptimizationView =
    quickPath.open && quickActiveItem ? "before" : optView;

  const { rsrp: rsrpRange, sinr: sinrRange } =
    metricRangesFromSettings(mapDisplaySettings);
  const rsrpEndpoints = rsrpLegendEndpointHexes(rsrpRange);
  const sinrEndpoints = sinrLegendEndpointHexes(sinrRange);
  const pciLegendPcis =
    mapDisplayMetric === "pci" && mapDisplayOptView !== "delta"
      ? collectPcisFromLuce(mapDisplayLuce)
      : [];
  const pciColorMap =
    pciLegendPcis.length > 0
      ? buildPciColorMap(
          pciLegendPcis,
          mapDisplaySettings.pciColorOverrides
        )
      : undefined;
  const pciColorInputRef = useRef<HTMLInputElement>(null);
  const editingPciRef = useRef<number | null>(null);

  const handlePciColorPick = useCallback(
    (pci: number, hex: string) => {
      setLuceSettings((prev) => {
        const next = {
          ...prev,
          pciColorOverrides: {
            ...prev.pciColorOverrides,
            [String(pci)]: hex,
          },
        };
        if (batch?.id) {
          void saveLuceSettings(batch.id, next).catch(() => {});
        }
        return next;
      });
    },
    [batch?.id]
  );
  const pciLegend =
    pciColorMap != null
      ? pciLegendItems(pciLegendPcis, pciColorMap)
      : [];

  useEffect(() => {
    if (optView === "delta" && mapMetric === "pci") {
      setMapMetric("rsrp");
    }
  }, [optView, mapMetric]);

  const switchToAfter = useCallback(async () => {
    if (optView === "after" && afterLuceData) return;
    if (afterLuceData) {
      setOptView("after");
      return;
    }
    if (!batch?.id) return;
    try {
      const after = await fetchAfterLuceResult(batch.id);
      if (!after) {
        setOptError("尚无优化后路测结果，请先在对话中点击「查看优化后结果」完成处理。");
        return;
      }
      setAfterLuceData(after);
      setOptView("after");
      if (step === "ask_after" || step === "params_shown") {
        setStep("after_shown");
      }
    } catch (e) {
      setOptError(e instanceof Error ? e.message : "加载优化后数据失败");
    }
  }, [afterLuceData, batch?.id, optView, step]);

  const switchToDelta = useCallback(async () => {
    if (!luceData) return;
    if (optView === "delta" && afterLuceData) return;
    if (!afterLuceData) {
      if (!batch?.id) return;
      try {
        const after = await fetchAfterLuceResult(batch.id);
        if (!after) {
          setOptError(
            "尚无优化后路测结果，请先在对话中点击「查看优化后结果」完成处理。"
          );
          return;
        }
        setAfterLuceData(after);
      } catch (e) {
        setOptError(e instanceof Error ? e.message : "加载优化后数据失败");
        return;
      }
    }
    setOptView("delta");
  }, [afterLuceData, batch?.id, luceData, optView]);

  const recomputeCompare = useCallback(
    async (mode?: GridMatchMode) => {
      if (!batch?.id) return;
      const effectiveMode = mode ?? gridMatchMode;
      setOptLoading(true);
      setOptError(null);
      try {
        const { result } = await fetchOptimizationCompare(
          batch.id,
          undefined,
          effectiveMode
        );
        setCompare(result);
      } catch (e) {
        setOptError(e instanceof Error ? e.message : "对比刷新失败");
      } finally {
        setOptLoading(false);
      }
    },
    [batch?.id, gridMatchMode]
  );

  const handleGridMatchChange = useCallback(
    (mode: GridMatchMode) => {
      setGridMatchMode(mode);
      void recomputeCompare(mode);
    },
    [recomputeCompare]
  );

  const refreshAfterViewData = useCallback(async () => {
    if (!batch?.id) return;
    try {
      const after = await fetchAfterLuceResult(batch.id);
      setAfterLuceData(after);
      if (compare) {
        await recomputeCompare();
      }
    } catch {
      /* ignore refresh errors */
    }
  }, [batch?.id, compare, recomputeCompare]);

  return (
    <div className="app-layout">
      <ChatPanel
        step={step}
        batch={batch}
        optView={optView}
        onStepChange={setStep}
        onBatchChange={setBatch}
        onOptViewChange={setOptView}
        onCellsChange={setCells}
        onLuceDataChange={setLuceData}
        onAfterLuceChange={setAfterLuceData}
        onCompareChange={setCompare}
        onShowOptPanel={setShowOptPanel}
        onLuceSettingsChange={setLuceSettings}
        onRegisterReprocess={registerReprocess}
        gridMatchMode={gridMatchMode}
      />

      <main className="map-area">
        <div className="map-toolbar">
          <div className="toolbar-group">
            <span className="toolbar-label">视图</span>
            <button
              type="button"
              className={optView === "before" ? "active" : ""}
              disabled={!luceData}
              onClick={() => setOptView("before")}
            >
              优化前
            </button>
            <button
              type="button"
              className={optView === "after" ? "active" : ""}
              disabled={!luceData}
              title={
                afterLuceData
                  ? "切换为优化后栅格/热力图"
                  : "加载并显示优化后路测（需已处理）"
              }
              onClick={() => void switchToAfter()}
            >
              优化后
            </button>
            <button
              type="button"
              className={optView === "delta" ? "active" : ""}
              disabled={!luceData}
              title={
                afterLuceData
                  ? "按栅格显示优化后相对优化前的增量（绿=变好，红=变差）"
                  : "加载优化后数据并显示栅格增量对比"
              }
              onClick={() => void switchToDelta()}
            >
              对比
            </button>
            {compare && (
              <button
                type="button"
                className="opt-toggle-btn"
                onClick={() => setShowOptPanel((v) => !v)}
                title="切换优化对比面板"
              >
                {showOptPanel ? "隐藏对比" : "查看对比"}
              </button>
            )}
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="active"
              title={`当前${theme === "light" ? "明亮" : "暗黑"}，点击切换`}
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
            >
              {theme === "light" ? "明亮" : "暗黑"}
            </button>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className={layersOpen ? "active" : ""}
              title={`管理基础地图与图层；当前：${BASE_MAP_PROVIDERS[baseMap.provider].label}`}
              onClick={() => setLayersOpen(true)}
            >
              地图 / 图层
            </button>
            <button
              type="button"
              className="settings-gear-btn"
              title="路测高级设置"
              onClick={() => setSettingsOpen(true)}
            >
              设置
            </button>
          </div>

          <div
            className={`rsrp-legend${mapDisplayMetric === "pci" && mapDisplayOptView !== "delta" ? " rsrp-legend--pci" : ""}${quickPath.open ? " rsrp-legend--dimmed" : ""}`}
          >
            {quickPath.open && quickActiveItem && (
              <span className="quick-path-map-badge">
                快速预览：{quickActiveItem.fileName}
              </span>
            )}
            {mapDisplayMetric === "pci" && mapDisplayOptView !== "delta" ? (
              <>
                <span className="pci-legend-title">
                  栅格按 PCI 着色（点击色块可改色）
                </span>
                <input
                  ref={pciColorInputRef}
                  type="color"
                  className="pci-color-input-hidden"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    const pci = editingPciRef.current;
                    if (pci == null) return;
                    handlePciColorPick(pci, e.target.value);
                  }}
                />
                <ul className="pci-map-legend">
                  {pciLegend.length === 0 ? (
                    <li className="pci-map-legend-empty">无栅格数据</li>
                  ) : (
                    pciLegend.map(({ pci, hex }) => (
                      <li key={pci}>
                        <button
                          type="button"
                          className="pci-legend-swatch"
                          title={`PCI ${pci}，点击修改颜色`}
                          style={{ background: hex }}
                          onClick={() => {
                            editingPciRef.current = pci;
                            const input = pciColorInputRef.current;
                            if (!input) return;
                            input.value = hex;
                            input.click();
                          }}
                        />
                        PCI {pci}
                      </li>
                    ))
                  )}
                </ul>
              </>
            ) : (
              <>
                <span>
                  {mapDisplayOptView === "delta"
                    ? mapDisplayMetric === "rsrp"
                      ? `ΔRSRP ${DELTA_RSRP_RANGE.min} ~ +${DELTA_RSRP_RANGE.max} ${DELTA_RSRP_RANGE.unit}`
                      : `ΔSINR ${DELTA_SINR_RANGE.min} ~ +${DELTA_SINR_RANGE.max} ${DELTA_SINR_RANGE.unit}`
                    : mapDisplayMetric === "rsrp"
                      ? `RSRP ${rsrpRange.min} ~ ${rsrpRange.max} dBm`
                      : `SINR ${sinrRange.min} ~ ${sinrRange.max} dB`}
                </span>
                <div
                  className="gradient-bar"
                  style={{
                    background:
                      mapDisplayOptView === "delta"
                        ? mapDisplayMetric === "rsrp"
                          ? deltaRsrpLegendGradientCss()
                          : deltaSinrLegendGradientCss()
                        : mapDisplayMetric === "rsrp"
                          ? rsrpLegendGradientCss(rsrpRange)
                          : sinrLegendGradientCss(sinrRange),
                  }}
                />
                <span
                  className="legend-red"
                  style={
                    mapDisplayOptView !== "delta"
                      ? {
                          color:
                            mapDisplayMetric === "rsrp"
                              ? rsrpEndpoints.low
                              : sinrEndpoints.low,
                        }
                      : undefined
                  }
                >
                  {mapDisplayOptView === "delta" ? "变差" : "差"}
                </span>
                <span
                  className="legend-green"
                  style={
                    mapDisplayOptView !== "delta"
                      ? {
                          color:
                            mapDisplayMetric === "rsrp"
                              ? rsrpEndpoints.high
                              : sinrEndpoints.high,
                        }
                      : undefined
                  }
                >
                  {mapDisplayOptView === "delta" ? "变好" : "好"}
                </span>
              </>
            )}
            {!quickPath.open && (
            <button
              type="button"
              className="opt-toggle-btn"
              onClick={() =>
                setMapMetric((m) => nextMapMetric(m, optView === "delta"))
              }
            >
              {mapMetricToggleLabel(mapMetric, optView === "delta")}
            </button>
            )}
          </div>
        </div>

        <ToolDock
          batchId={batch?.id ?? null}
          onOpenQuickPath={() =>
            setQuickPath((s) => ({ ...s, open: true }))
          }
        />

        {quickPath.open && (
          <QuickPathPreviewPanel
            batchId={batch?.id ?? null}
            state={quickPath}
            onChange={setQuickPath}
            onClose={() => setQuickPath((s) => ({ ...s, open: false }))}
          />
        )}

        <CesiumMap
          theme={theme}
          baseMap={baseMap}
          optimizationView={mapDisplayOptView}
          cells={cells}
          luceData={mapDisplayLuce}
          beforeLuceData={quickPath.open ? null : luceData}
          afterLuceData={quickPath.open ? null : afterLuceData}
          mapSettings={mapDisplaySettings}
          mapFlyKey={batch?.id ?? ""}
          luceFlyKey={quickActiveItem ? `quick-${quickActiveItem.id}` : ""}
          metric={mapDisplayMetric}
          pciColorMap={pciColorMap}
          mapLayers={mapLayers}
        />

        <LayerManagerDrawer
          open={layersOpen}
          onClose={() => setLayersOpen(false)}
          layers={mapLayers}
          onChange={setMapLayers}
          baseMap={baseMap}
          onBaseMapChange={setBaseMap}
        />

        <SettingsDrawer
          open={settingsOpen}
          batchId={batch?.id ?? null}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setLuceSettings(s);
            void refreshAfterViewData();
          }}
          onReprocess={(s) => {
            setLuceSettings(s);
            reprocessHandler?.(s);
            void refreshAfterViewData();
          }}
        />

        {showOptPanel && compare && (
          <OptimizationPanel
            compare={compare}
            loading={optLoading}
            error={optError}
            gridMatchMode={gridMatchMode}
            onGridMatchChange={handleGridMatchChange}
            onClose={() => setShowOptPanel(false)}
            onRecompute={() => void recomputeCompare()}
          />
        )}
      </main>
    </div>
  );
}
