#!/usr/bin/env python3
"""大运体育场 AAU 参数优化建议（Demo）

读取 batches/<id>/cells.json + luce-result.json，输出 JSON 到 stdout：

{
  "method": "demo-static",
  "targetPcis": [353, 294, 330, 69],
  "suggestions": [
    {
      "pci": 353,
      "cellName": "...",
      "stationName": "...",
      "azimuthOriginal": -5,    # 原电子方位角（SSB 波束方位角）
      "downtiltOriginal": 12,   # 原数字下倾角
      "azimuthSuggest": 14.30,  # 建议电子方位角（=地理方位角）
      "downtiltSuggest": 12,
      "deltaAzimuth": 19.30,
      "deltaDowntilt": 0,
      "note": "电子方位角调整为地理方位角"
    }
  ],
  "notes": [...]
}

后续可替换为真实算法（仅替换 suggest_for_pci 内部逻辑即可）。
"""
import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional


# Demo 用静态建议表（与原型设计稿一致）
DEMO_TABLE: Dict[int, Dict[str, float]] = {
    353: {"azimuth": 14.30, "downtilt": 12.0},
    294: {"azimuth": -16.33, "downtilt": 12.0},
    330: {"azimuth": -16.69, "downtilt": 12.0},
    69:  {"azimuth": 13.28, "downtilt": 12.0},
}

DEFAULT_PCIS = [353, 294, 330, 69]


def load_cells(batch_dir: str) -> List[Dict[str, Any]]:
    p = os.path.join(batch_dir, "cells.json")
    if not os.path.exists(p):
        return []
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("cells", []) if isinstance(data, dict) else []


def find_cell(cells: List[Dict[str, Any]], pci: int) -> Optional[Dict[str, Any]]:
    """优先返回中心频点更高/AAU 类型的小区；否则首个匹配 PCI。"""
    matches = [c for c in cells if c.get("pci") == pci]
    if not matches:
        return None
    matches.sort(
        key=lambda c: (
            "AAU" in str(c.get("aauModel", "")).upper(),
            int(c.get("extra", {}).get("中心频点") or 0),
        ),
        reverse=True,
    )
    return matches[0]


def get_extra_num(cell: Dict[str, Any], key: str) -> Optional[float]:
    extra = cell.get("extra") or {}
    v = extra.get(key)
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def suggest_for_pci(pci: int, cell: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """生成单个 PCI 的优化建议。占位实现：使用 DEMO_TABLE。"""
    az_orig = None
    dt_orig = None
    cell_name = ""
    station = ""
    if cell:
        cell_name = cell.get("cellName", "")
        station = cell.get("stationName", "")
        az_orig = get_extra_num(cell, "SSB波束方位角(度)")
        if az_orig is None:
            az_orig = get_extra_num(cell, "电子方位角")
        dt_orig = get_extra_num(cell, "数字倾角(度)-华为设置值")
        if dt_orig is None:
            dt_orig = get_extra_num(cell, "电子下倾角")

    demo = DEMO_TABLE.get(pci)
    az_sug = demo["azimuth"] if demo else (az_orig or 0.0)
    dt_sug = demo["downtilt"] if demo else (dt_orig or 12.0)

    delta_az = az_sug - az_orig if az_orig is not None else None
    delta_dt = dt_sug - dt_orig if dt_orig is not None else None

    return {
        "pci": pci,
        "cellName": cell_name,
        "stationName": station,
        "azimuthOriginal": az_orig,
        "downtiltOriginal": dt_orig,
        "azimuthSuggest": round(az_sug, 2),
        "downtiltSuggest": round(dt_sug, 2),
        "deltaAzimuth": None if delta_az is None else round(delta_az, 2),
        "deltaDowntilt": None if delta_dt is None else round(delta_dt, 2),
        "note": "电子方位角调整为地理方位角；下倾角统一为 12°",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-dir", required=True, help="批次目录绝对路径")
    parser.add_argument(
        "--pci",
        default=",".join(str(p) for p in DEFAULT_PCIS),
        help="目标 PCI 列表，逗号分隔",
    )
    args = parser.parse_args()

    target_pcis: List[int] = []
    for s in str(args.pci).split(","):
        s = s.strip()
        if not s:
            continue
        try:
            target_pcis.append(int(s))
        except ValueError:
            pass
    if not target_pcis:
        target_pcis = list(DEFAULT_PCIS)

    cells = load_cells(args.batch_dir)
    suggestions = [suggest_for_pci(pci, find_cell(cells, pci)) for pci in target_pcis]

    out = {
        "method": "demo-static",
        "targetPcis": target_pcis,
        "suggestions": suggestions,
        "notes": [
            "电子方位角调整为地理方位角，使主瓣朝场中心收敛",
            "电子下倾角统一为 12°，覆盖延伸到中场区域",
            "Demo 实现：固定建议值，可替换为优化算法输出",
        ],
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
