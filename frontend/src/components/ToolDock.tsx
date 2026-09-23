import { useEffect, useRef, useState } from "react";
import "../tools/tools.css";

interface Props {
  batchId: string | null;
  onOpenQuickPath?: () => void;
}

export default function ToolDock({ batchId, onOpenQuickPath }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      const tab = document.getElementById("tool-dock-tab");
      if (tab?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = batchId ? `?batch=${encodeURIComponent(batchId)}` : "";

  return (
    <div className="tool-dock" ref={panelRef}>
      {open && (
        <div className="tool-dock-panel">
          <h3>分析工具</h3>
          <ul>
            <li>
              <button
                type="button"
                className="tool-dock-link-btn"
                onClick={() => {
                  onOpenQuickPath?.();
                  setOpen(false);
                }}
              >
                测试路径快速查看
              </button>
            </li>
            <li>
              <a
                href={`/tools/spatial-rsrp${q}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                主区栅格 RSRP 分布
              </a>
            </li>
            <li>
              <a
                href="/tools/path-adjust"
                target="_blank"
                rel="noopener noreferrer"
              >
                路测轨迹手工校正
              </a>
            </li>
            <li>
              <a
                href="/tools/path-shape-snap"
                target="_blank"
                rel="noopener noreferrer"
              >
                路测轨迹形状附着
              </a>
            </li>
          </ul>
          <p className="tool-dock-hint">
            在新页面打开，与主地图分离。可选当前批次优化前/后/分别分析。
          </p>
        </div>
      )}
      <button
        id="tool-dock-tab"
        type="button"
        className="tool-dock-tab"
        title="分析工具"
        onClick={() => setOpen((v) => !v)}
      >
        工具
      </button>
    </div>
  );
}
