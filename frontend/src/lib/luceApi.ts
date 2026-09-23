import type {
  LuceProcessEvent,
  LuceProcessResult,
  LuceSettings,
} from "../types/luce";

export async function fetchLuceSettings(
  batchId: string
): Promise<LuceSettings> {
  const res = await fetch(`/api/batches/${batchId}/luce/settings`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "加载路测设置失败");
  return data.settings;
}

export async function saveLuceSettings(
  batchId: string,
  settings: LuceSettings
): Promise<LuceSettings> {
  const res = await fetch(`/api/batches/${batchId}/luce/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "保存路测设置失败");
  return data.settings;
}

export type LuceVariant = "before" | "after";

export async function fetchLuceResult(
  batchId: string,
  variant: LuceVariant = "before"
): Promise<LuceProcessResult | null> {
  const qs = variant === "after" ? "?variant=after" : "";
  const res = await fetch(`/api/batches/${batchId}/luce/result${qs}`);
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "加载路测结果失败");
  return data.result;
}

export async function fetchAfterLuceAvailable(
  batchId: string
): Promise<boolean> {
  const res = await fetch(`/api/batches/${batchId}/luce/after/available`);
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.available);
}

export async function processLuceBatchStream(
  batchId: string,
  onEvent: (e: LuceProcessEvent) => void,
  settings?: Partial<LuceSettings>,
  variant: LuceVariant = "before"
): Promise<LuceProcessResult> {
  const res = await fetch(`/api/batches/${batchId}/luce/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(settings ? { settings } : {}),
      variant,
    }),
  });

  if (!res.ok || !res.body) {
    let err = "路测处理请求失败";
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
  let doneSeen = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!line) continue;
      const json = line.slice(6);
      const ev = JSON.parse(json) as LuceProcessEvent;
      onEvent(ev);
      if (ev.type === "error") {
        throw new Error(ev.message ?? "路测处理失败");
      }
      if (ev.type === "done") {
        doneSeen = true;
      }
    }
  }

  if (!doneSeen) {
    throw new Error("路测处理未返回结果");
  }

  const result = await fetchLuceResult(batchId, variant);
  if (!result) {
    throw new Error("路测结果加载失败");
  }
  return result;
}
