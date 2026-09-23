import type {
  LuceProcessEvent,
  LuceProcessResult,
} from "../types/luce";
import type {
  OptimizationCompare,
  OptimizationSuggestionResult,
} from "../types/optimize";

export async function fetchOptimizationSuggestions(
  batchId: string,
  options: { force?: boolean; pcis?: number[] } = {}
): Promise<OptimizationSuggestionResult> {
  if (options.force) {
    const res = await fetch(`/api/batches/${batchId}/optimize/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pcis: options.pcis }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "建议参数计算失败");
    return data.result;
  }
  const res = await fetch(`/api/batches/${batchId}/optimize/suggestions`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "建议参数加载失败");
  return data.result;
}

export async function runAfterOptimizationStream(
  batchId: string,
  onEvent: (e: LuceProcessEvent) => void,
  sourceDir?: string
): Promise<void> {
  const res = await fetch(`/api/batches/${batchId}/optimize/after/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sourceDir ? { sourceDir } : {}),
  });

  if (!res.ok || !res.body) {
    let err = "优化后处理请求失败";
    try {
      const j = await res.json();
      err = j.error ?? err;
    } catch {
      /* ignore */
    }
    throw new Error(err);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6)) as LuceProcessEvent;
      onEvent(ev);
      if (ev.type === "error") {
        throw new Error(ev.message ?? "优化后处理失败");
      }
    }
  }
}

export async function fetchOptimizationCompare(
  batchId: string,
  pcis?: number[],
  gridMatch?: import("../types/optimize").GridMatchMode
): Promise<{ result: OptimizationCompare; suggestion: OptimizationSuggestionResult | null }> {
  const params = new URLSearchParams();
  if (pcis && pcis.length > 0) params.set("pcis", pcis.join(","));
  if (gridMatch && gridMatch !== "default") params.set("gridMatch", gridMatch);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/batches/${batchId}/optimize/compare${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "对比加载失败");
  return { result: data.result, suggestion: data.suggestion };
}

import {
  fetchAfterLuceAvailable,
  fetchLuceResult,
} from "./luceApi";

export { fetchAfterLuceAvailable };

export async function fetchAfterLuceResult(
  batchId: string
): Promise<LuceProcessResult | null> {
  return fetchLuceResult(batchId, "after");
}
