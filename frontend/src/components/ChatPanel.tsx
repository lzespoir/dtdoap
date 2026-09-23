import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBatch,
  uploadBatchFiles,
  fetchBatchCells,
  listBatches,
  deleteBatch,
  fetchLuceDefaultSources,
  importLuceFromDefault,
  type BatchMeta,
  type BatchSummary,
  type LuceDefaultSources,
} from "../lib/api";
import {
  fetchAfterLuceAvailable,
  fetchLuceResult,
  fetchLuceSettings,
  processLuceBatchStream,
} from "../lib/luceApi";
import {
  fetchAfterLuceResult,
  fetchOptimizationCompare,
  runAfterOptimizationStream,
} from "../lib/optimizeApi";
import type { CellSite } from "../types/cell";
import type { LuceProcessResult, LuceSettings } from "../types/luce";
import type {
  GridMatchMode,
  OptimizationCompare,
} from "../types/optimize";
import type { OptimizationView, WorkflowStep, ChatMessage } from "../types";
import { displayFilename } from "../lib/filename";
import FileUploadZone from "./FileUploadZone";
import BatchList from "./BatchList";
import LuceSourceConfirmDialog from "./LuceSourceConfirmDialog";

interface ChatPanelProps {
  step: WorkflowStep;
  batch: BatchMeta | null;
  optView: OptimizationView;
  onStepChange: (step: WorkflowStep) => void;
  onBatchChange: (batch: BatchMeta | null) => void;
  onOptViewChange: (view: OptimizationView) => void;
  onCellsChange: (cells: CellSite[]) => void;
  onLuceDataChange: (data: LuceProcessResult | null) => void;
  onAfterLuceChange: (data: LuceProcessResult | null) => void;
  onCompareChange: (c: OptimizationCompare | null) => void;
  onShowOptPanel: (open: boolean) => void;
  onLuceSettingsChange: (settings: LuceSettings) => void;
  onRegisterReprocess: (fn: (settings: LuceSettings) => void) => void;
  gridMatchMode: GridMatchMode;
}

function nowTime(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random()}`,
    role,
    text,
    time: nowTime(),
  };
}

function formatStat(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatDelta(
  v: number | null | undefined,
  unit: "dB" | "pp"
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const scaled = unit === "pp" ? v * 100 : v;
  const sign = scaled > 0 ? "+" : "";
  return `${sign}${scaled.toFixed(2)} ${unit}`;
}

const STEP_LABELS: Record<WorkflowStep, string> = {
  idle: "等待上传",
  uploaded: "已上传",
  extracting: "数据提取",
  before_shown: "优化前展示",
  analyzing: "数据分析",
  params_shown: "建议参数",
  ask_after: "确认优化后",
  after_shown: "优化后展示",
};

export default function ChatPanel({
  step,
  batch,
  optView: _optView,
  onStepChange,
  onBatchChange,
  onOptViewChange,
  onCellsChange,
  onLuceDataChange,
  onAfterLuceChange,
  onCompareChange,
  onShowOptPanel,
  onLuceSettingsChange,
  onRegisterReprocess,
  gridMatchMode,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    msg(
      "system",
      "请上传工参表与路测表。路测分优化前、优化后两组；未上传的一侧可使用 data/sample 下默认目录（需确认），目录为空则必须本地上传。"
    ),
  ]);
  const [gongcanFiles, setGongcanFiles] = useState<File[]>([]);
  const [luceBeforeFiles, setLuceBeforeFiles] = useState<File[]>([]);
  const [luceAfterFiles, setLuceAfterFiles] = useState<File[]>([]);
  const [defaultSources, setDefaultSources] =
    useState<LuceDefaultSources | null>(null);
  const [sourceConfirm, setSourceConfirm] = useState<{
    lines: {
      variant: "before" | "after";
      label: string;
      absolutePath: string;
      csvCount: number;
    }[];
    resolve: () => void;
    reject: () => void;
  } | null>(null);
  const [batchAlias, setBatchAlias] = useState("");
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [processingLuce, setProcessingLuce] = useState(false);
  const [processingAfter, setProcessingAfter] = useState(false);
  const progressMsgIdRef = useRef<string | null>(null);

  const push = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const updateProgress = useCallback((text: string) => {
    const id = progressMsgIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text } : m))
    );
  }, []);

  const startProgress = useCallback((text: string) => {
    const m = msg("assistant", text);
    progressMsgIdRef.current = m.id;
    setMessages((prev) => [...prev, m]);
  }, []);

  const endProgress = useCallback(() => {
    progressMsgIdRef.current = null;
  }, []);

  const refreshBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const list = await listBatches();
      setBatches(list);
    } catch {
      /* ignore */
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBatches();
  }, [refreshBatches]);

  useEffect(() => {
    void fetchLuceDefaultSources()
      .then(setDefaultSources)
      .catch(() => setDefaultSources(null));
  }, []);

  const loadBatchCells = async (batchId: string) => {
    try {
      const { cells } = await fetchBatchCells(batchId);
      onCellsChange(cells);
      return cells.length;
    } catch {
      onCellsChange([]);
      return 0;
    }
  };

  const loadLuceForBatch = async (batchId: string) => {
    try {
      const result = await fetchLuceResult(batchId);
      onLuceDataChange(result);
      return result;
    } catch {
      onLuceDataChange(null);
      return null;
    }
  };

  const processLuce = useCallback(
    async (
      batchId: string,
      settings?: Partial<LuceSettings>,
      variant: "before" | "after" = "before"
    ) => {
      const label = variant === "after" ? "优化后" : "优化前";
      setProcessingLuce(true);
      startProgress(`${label}路测数据处理：准备中…`);
      try {
        const result = await processLuceBatchStream(
          batchId,
          (ev) => {
            if (ev.type === "log" && ev.message) {
              push(msg("assistant", ev.message));
            }
            if (ev.type === "progress") {
              updateProgress(
                `${label}路测处理中… ${ev.percent ?? 0}%\n${ev.message ?? ""}`
              );
            }
            if (ev.type === "done" && ev.message) {
              push(msg("assistant", ev.message));
            }
          },
          settings,
          variant
        );
        if (variant === "after") {
          onAfterLuceChange(result);
        } else {
          onLuceDataChange(result);
        }
        endProgress();
        return result;
      } catch (e) {
        endProgress();
        push(
          msg(
            "system",
            e instanceof Error ? e.message : `${label}路测处理失败`
          )
        );
        if (variant === "after") {
          onAfterLuceChange(null);
        } else {
          onLuceDataChange(null);
        }
        return null;
      } finally {
        setProcessingLuce(false);
      }
    },
    [
      push,
      startProgress,
      updateProgress,
      endProgress,
      onLuceDataChange,
      onAfterLuceChange,
    ]
  );

  const reprocessBoth = useCallback(
    async (batchId: string, settings: Partial<LuceSettings>) => {
      onLuceSettingsChange(settings as LuceSettings);
      await processLuce(batchId, settings, "before");

      const afterAvailable = await fetchAfterLuceAvailable(batchId);
      if (afterAvailable) {
        push(msg("assistant", "按相同设置重新处理优化后路测…"));
        await processLuce(batchId, settings, "after");
      } else {
        push(msg("assistant", "尝试导入优化后路测数据…"));
        try {
          await runAfterOptimizationStream(batchId, (ev) => {
            if (ev.type === "log" && ev.message) {
              push(msg("assistant", ev.message));
            }
          });
        } catch {
          push(msg("system", "无可用优化后路测数据，跳过"));
          return;
        }
        const afterResult = await fetchAfterLuceResult(batchId);
        if (!afterResult) return;
        onAfterLuceChange(afterResult);
      }

      try {
        const { result } = await fetchOptimizationCompare(
          batchId,
          undefined,
          gridMatchMode
        );
        onCompareChange(result);
        onShowOptPanel(true);
        onStepChange("after_shown");
      } catch {
        /* ignore */
      }
    },
    [
      processLuce,
      push,
      onLuceSettingsChange,
      onCompareChange,
      onAfterLuceChange,
      onShowOptPanel,
      onStepChange,
      gridMatchMode,
    ]
  );

  useEffect(() => {
    onRegisterReprocess((s) => {
      if (batch?.id) void reprocessBoth(batch.id, s);
    });
  }, [batch?.id, onRegisterReprocess, reprocessBoth]);

  const handleSelectBatch = async (b: BatchSummary) => {
    onBatchChange(b);
    onStepChange("idle");
    onLuceDataChange(null);
    onAfterLuceChange(null);
    onCompareChange(null);
    onShowOptPanel(false);
    try {
      const s = await fetchLuceSettings(b.id);
      onLuceSettingsChange(s);
    } catch {
      /* use defaults */
    }
    const count = await loadBatchCells(b.id);
    const luce = await loadLuceForBatch(b.id);
    try {
      const afterLuce = await fetchAfterLuceResult(b.id);
      onAfterLuceChange(afterLuce);
      if (luce && afterLuce) {
        onStepChange("after_shown");
      } else if (luce) {
        onStepChange("before_shown");
      }
    } catch {
      onAfterLuceChange(null);
      if (luce) onStepChange("before_shown");
    }
    const gongcanHint =
      b.gongcanNames.length > 0
        ? `\n工参文件：${b.gongcanNames.map(displayFilename).join("、")}`
        : "";
    push(
      msg(
        "assistant",
        `已切换批次 ${b.id.slice(0, 8)}…，小区 ${count} 个。${gongcanHint}` +
          (luce
            ? `\n路测：${luce.stats.pathSegments ?? luce.paths?.length ?? 1} 条轨迹 ${luce.stats.pathPoints} 点，RSRP ${luce.stats.outputSamples} 个`
            : b.luceCount > 0
              ? "\n路测文件已上传，尚未处理"
              : "")
      )
    );
  };

  const handleAliasChange = (batchId: string, alias: string) => {
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, alias: alias || undefined } : b))
    );
    if (batch?.id === batchId) {
      onBatchChange({ ...batch, alias: alias || undefined });
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    try {
      await deleteBatch(batchId);
      if (batch?.id === batchId) {
        onBatchChange(null);
        onCellsChange([]);
        onLuceDataChange(null);
        onAfterLuceChange(null);
        onCompareChange(null);
        onShowOptPanel(false);
        onStepChange("idle");
      }
      await refreshBatches();
      push(msg("assistant", `已删除批次 ${batchId.slice(0, 8)}…`));
    } catch (e) {
      push(msg("system", e instanceof Error ? e.message : "删除失败"));
    }
  };

  const hasGongcan = gongcanFiles.length > 0;
  const hasLuceBefore = luceBeforeFiles.length > 0;
  const hasLuceAfter = luceAfterFiles.length > 0;
  const beforeFromDefault =
    !hasLuceBefore && defaultSources && !defaultSources.before.empty;
  const canStartAnalysis = hasGongcan && (hasLuceBefore || !!beforeFromDefault);

  const waitSourceConfirm = (
    lines: {
      variant: "before" | "after";
      label: string;
      absolutePath: string;
      csvCount: number;
    }[]
  ) =>
    new Promise<void>((resolve, reject) => {
      setSourceConfirm({ lines, resolve, reject });
    });

  const handleUpload = async () => {
    if (!hasGongcan) {
      push(
        msg(
          "system",
          "还缺少工参表，请上传工参表（xls / xlsx / csv）后再开始分析。"
        )
      );
      return;
    }

    let sources = defaultSources;
    if (!sources) {
      try {
        sources = await fetchLuceDefaultSources();
        setDefaultSources(sources);
      } catch (e) {
        push(
          msg(
            "system",
            e instanceof Error ? e.message : "无法读取默认路测目录"
          )
        );
        return;
      }
    }

    const needBeforeImport = !hasLuceBefore;
    const needAfterImport = !hasLuceAfter;

    if (needBeforeImport && sources.before.empty) {
      push(
        msg(
          "system",
          `请上传优化前路测表。默认目录为空或不存在，必须本地上传。\n路径：${sources.before.absolutePath}`
        )
      );
      return;
    }

    const confirmLines: {
      variant: "before" | "after";
      label: string;
      absolutePath: string;
      csvCount: number;
    }[] = [];

    if (needBeforeImport && !sources.before.empty) {
      confirmLines.push({
        variant: "before",
        label: "优化前",
        absolutePath: sources.before.absolutePath,
        csvCount: sources.before.csvCount,
      });
    }
    if (needAfterImport && !sources.after.empty) {
      confirmLines.push({
        variant: "after",
        label: "优化后",
        absolutePath: sources.after.absolutePath,
        csvCount: sources.after.csvCount,
      });
    }

    if (confirmLines.length > 0) {
      try {
        await waitSourceConfirm(confirmLines);
      } catch {
        return;
      }
    }

    setUploading(true);
    try {
      const currentBatch = await createBatch(batchAlias || undefined);
      onBatchChange(currentBatch);
      onCellsChange([]);
      onLuceDataChange(null);
      onAfterLuceChange(null);
      try {
        const s = await fetchLuceSettings(currentBatch.id);
        onLuceSettingsChange(s);
      } catch {
        /* defaults */
      }
      onStepChange("idle");

      const gongcanNames = gongcanFiles.map((f) => f.name).join("、");
      const uploadParts: string[] = [`上传工参：${gongcanNames}`];
      if (hasLuceBefore) {
        uploadParts.push(
          `优化前路测：${luceBeforeFiles.map((f) => f.name).join("、")}`
        );
      }
      if (hasLuceAfter) {
        uploadParts.push(
          `优化后路测：${luceAfterFiles.map((f) => f.name).join("、")}`
        );
      }
      push(msg("user", uploadParts.join("\n")));

      const result = await uploadBatchFiles(
        currentBatch.id,
        gongcanFiles,
        luceBeforeFiles,
        luceAfterFiles
      );
      onBatchChange(result.batch);
      await refreshBatches();

      const g = result.saved.filter((f) => f.category === "gongcan").length;
      const lb = result.saved.filter((f) => f.category === "luce").length;
      const la = result.saved.filter((f) => f.category === "luce-after").length;
      const savedLines = [`已保存：工参 ${g} 个`];
      if (lb > 0) savedLines.push(`优化前路测 ${lb} 个`);
      if (la > 0) savedLines.push(`优化后路测 ${la} 个`);

      const importLogs: string[] = [];
      if (needBeforeImport) {
        const imp = await importLuceFromDefault(currentBatch.id, "before");
        importLogs.push(
          `优化前：从目录导入 ${imp.total} 个 CSV（新复制 ${imp.copied}）`
        );
      }
      if (needAfterImport && !sources.after.empty) {
        const imp = await importLuceFromDefault(currentBatch.id, "after");
        importLogs.push(
          `优化后：从目录导入 ${imp.total} 个 CSV（新复制 ${imp.copied}）`
        );
      }

      push(
        msg(
          "assistant",
          savedLines.join("，") +
            "。" +
            (importLogs.length ? `\n${importLogs.join("\n")}` : "") +
            (result.errors?.length
              ? `\n跳过：${result.errors.join("；")}`
              : "")
        )
      );

      onStepChange("uploaded");
      setGongcanFiles([]);
      setLuceBeforeFiles([]);
      setLuceAfterFiles([]);
      setBatchAlias("");

      const cellsCount = result.cellsCount ?? 0;
      if (cellsCount > 0) {
        const { cells } = await fetchBatchCells(result.batch.id);
        onCellsChange(cells);
        const cities = [
          ...new Set(
            cells.map((c) => String(c.extra["城市"] ?? "")).filter(Boolean)
          ),
        ];
        const scenes = [
          ...new Set(
            cells
              .map((c) => String(c.extra["测试场景"] ?? ""))
              .filter(Boolean)
          ),
        ];
        push(
          msg(
            "assistant",
            `工参解析：共 ${cells.length} 个小区。\n` +
              (cities.length ? `涉及城市：${cities.join("、")}\n` : "") +
              (scenes.length ? `测试场景：${scenes.join("、")}` : "") +
              `\n请核对工参文件名与城市是否匹配。`
          )
        );
      }

      const afterReady =
        hasLuceAfter || (needAfterImport && !sources.after.empty);
      await runPipeline(result.batch.id, cellsCount, afterReady);
    } catch (e) {
      push(
        msg("system", e instanceof Error ? e.message : "上传失败，请重试。")
      );
    } finally {
      setUploading(false);
    }
  };

  const runPipeline = async (
    batchId: string,
    cellsCount: number,
    afterDataReady = false
  ) => {
    onStepChange("extracting");
    push(
      msg(
        "assistant",
        cellsCount > 0
          ? "步骤 1/3：工参小区已提取，开始路测数据处理…"
          : "步骤 1/3：开始路测数据处理…"
      )
    );

    const luce = await processLuce(batchId);
    if (luce) {
      push(
        msg(
          "assistant",
          `路测统计：扫描 ${luce.stats.totalRows.toLocaleString()} 行，` +
            `无坐标跳过 ${luce.stats.skippedNoLocation.toLocaleString()}，` +
            `主区采样 ${luce.stats.servingSamples.toLocaleString()}，` +
            `邻区采样 ${luce.stats.neighborSamples.toLocaleString()}。`
        )
      );
    }

    onStepChange("before_shown");
    onOptViewChange("before");
    push(
      msg(
        "assistant",
        luce
          ? "步骤 2/3：地图已展示路测轨迹与 RSRP（可在右上角「设置」调整过滤与显示模式）。"
          : "步骤 2/3：地图已切换为优化前状态（路测未成功加载）。"
      )
    );

    onStepChange("ask_after");
    push(
      msg(
        "assistant",
        afterDataReady
          ? "是否处理并查看优化后结果？（优化后路测已就绪）"
          : "是否查看优化后结果（导入并处理优化后路测）？"
      )
    );
  };

  const confirmAfter = useCallback(async () => {
    if (!batch?.id) return;
    setProcessingAfter(true);
    startProgress("优化后路测处理：准备中…");
    try {
      let afterResult: LuceProcessResult | null = null;
      await runAfterOptimizationStream(batch.id, (ev) => {
        if (ev.type === "log" && ev.message) {
          push(msg("assistant", ev.message));
        }
        if (ev.type === "progress") {
          updateProgress(
            `优化后路测处理中… ${ev.percent ?? 0}%\n${ev.message ?? ""}`
          );
        }
        if (ev.type === "done" && ev.message) {
          push(msg("assistant", ev.message));
        }
      });
      afterResult = await fetchAfterLuceResult(batch.id);
      onAfterLuceChange(afterResult);
      endProgress();

      const { result: compare } = await fetchOptimizationCompare(
        batch.id,
        undefined,
        gridMatchMode
      );
      onCompareChange(compare);
      onShowOptPanel(true);

      onOptViewChange("after");
      onStepChange("after_shown");
      push(
        msg(
          "assistant",
          `已切换优化后视图：采样 ${compare.after?.count ?? 0} 个，` +
            `平均 RSRP ${formatStat(compare.after?.avgRsrp)} dBm，` +
            `变化 ${formatDelta(compare.deltaAvg, "dB")}；` +
            `≥-95 覆盖 ${formatPercent(compare.after?.cover95)}（${formatDelta(compare.deltaCover95, "pp")}）。`
        )
      );
    } catch (e) {
      endProgress();
      push(
        msg("system", e instanceof Error ? e.message : "优化后处理失败")
      );
    } finally {
      setProcessingAfter(false);
    }
  }, [
    batch?.id,
    push,
    startProgress,
    updateProgress,
    endProgress,
    onAfterLuceChange,
    onCompareChange,
    onShowOptPanel,
    onOptViewChange,
    onStepChange,
    gridMatchMode,
  ]);

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <h1>DTDOAP</h1>
        <p>路测数据优化分析平台</p>
        <span className="step-badge">{STEP_LABELS[step]}</span>
      </header>

      <BatchList
        batches={batches}
        selectedId={batch?.id ?? null}
        loading={batchesLoading}
        onSelect={handleSelectBatch}
        onDelete={handleDeleteBatch}
        onAliasChange={handleAliasChange}
      />

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            <pre>{m.text}</pre>
            <time>{m.time}</time>
          </div>
        ))}
      </div>

      <div className="chat-upload">
        <input
          type="text"
          className="batch-alias-input"
          placeholder="批次别名（可选，如: 第3次优化）"
          value={batchAlias}
          onChange={(e) => setBatchAlias(e.target.value)}
          disabled={uploading}
        />
        <FileUploadZone
          label="工参表"
          hint="xls / xlsx / csv，可多选"
          accept=".xls,.xlsx,.csv"
          files={gongcanFiles}
          onChange={setGongcanFiles}
          disabled={uploading}
        />
        <FileUploadZone
          label="路测表（优化前）"
          hint="csv，可多选；未上传时可使用默认样例目录"
          accept=".csv"
          files={luceBeforeFiles}
          onChange={setLuceBeforeFiles}
          disabled={uploading}
        />
        <FileUploadZone
          label="路测表（优化后）"
          hint="csv，可多选；未上传时可使用默认样例目录"
          accept=".csv"
          files={luceAfterFiles}
          onChange={setLuceAfterFiles}
          disabled={uploading}
        />
        {!canStartAnalysis && !uploading && (
          <p className="upload-hint">
            需工参表与优化前路测（本地上传或默认目录有数据）
          </p>
        )}
        <button
          type="button"
          className="primary-btn"
          disabled={uploading || processingLuce || !canStartAnalysis}
          onClick={handleUpload}
        >
          {uploading
            ? "上传中…"
            : processingLuce
              ? "路测处理中…"
              : "上传并开始分析"}
        </button>
      </div>

      {sourceConfirm && (
        <LuceSourceConfirmDialog
          lines={sourceConfirm.lines}
          onConfirm={() => {
            sourceConfirm.resolve();
            setSourceConfirm(null);
          }}
          onCancel={() => {
            sourceConfirm.reject();
            setSourceConfirm(null);
          }}
        />
      )}

      {(step === "ask_after" || step === "after_shown") && (
        <div className="chat-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={processingAfter}
            onClick={confirmAfter}
          >
            {processingAfter
              ? "处理中…"
              : step === "after_shown"
                ? "刷新优化后结果"
                : "查看优化后结果"}
          </button>
          {step === "ask_after" && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => push(msg("user", "暂不查看优化后结果"))}
            >
              暂不查看
            </button>
          )}
          {step === "after_shown" && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => onShowOptPanel(true)}
            >
              查看对比面板
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
