#!/usr/bin/env python3
"""
独立校验脚本：输出优化对比过程中的关键中间数据（不修改主程序）。

用途：
1) 复现 gridMatch 过滤后的前后栅格数量
2) 复现 RSRP/SINR 强度分布直方图（按栅格代表值，每栅格计 1）
3) 输出可人工核对的摘要和前若干个分箱细节

示例：
  python tools/verify_compare_metrics.py --batch-id <id>
  python tools/verify_compare_metrics.py --batch-id <id> --grid-match intersection --dump-bins 30
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


M_PER_DEG_LAT = 111_320.0


@dataclass
class MetricPoint:
    value: float
    count: int = 1


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def grid_key(cell: dict, size_m: float, ref_lat: float) -> str:
    cos_ref = math.cos(math.radians(ref_lat))
    gx = math.floor((float(cell["longitude"]) * cos_ref * M_PER_DEG_LAT) / size_m)
    gy = math.floor((float(cell["latitude"]) * M_PER_DEG_LAT) / size_m)
    return f"{gx},{gy}"


def build_key_set(grid: List[dict], size_m: float, ref_lat: float) -> set[str]:
    return {grid_key(c, size_m, ref_lat) for c in grid}


def filter_grid_by_keys(grid: List[dict], keys: set[str], size_m: float, ref_lat: float) -> List[dict]:
    return [c for c in grid if grid_key(c, size_m, ref_lat) in keys]


def cells_to_metric_points(cells: List[dict], metric: str) -> List[MetricPoint]:
    out: List[MetricPoint] = []
    for c in cells:
        v = c.get(metric)
        if v is None:
            continue
        try:
            fv = float(v)
        except Exception:
            continue
        if not math.isfinite(fv):
            continue
        out.append(MetricPoint(value=fv, count=1))
    return out


def build_histogram(before: List[MetricPoint], after: List[MetricPoint], metric: str) -> dict:
    if not before and not after:
        return {"metric": metric, "bins": [], "binSize": 2 if metric == "rsrp" else 1}

    all_pts = before + after
    bin_size = 2 if metric == "rsrp" else 1
    unit = "dBm" if metric == "rsrp" else "dB"
    min_v = min(p.value for p in all_pts)
    max_v = max(p.value for p in all_pts)
    start = math.floor(min_v / bin_size) * bin_size
    end = math.ceil(max_v / bin_size) * bin_size
    if end <= start:
        end = start + bin_size
    bin_count = max(1, math.ceil((end - start) / bin_size))

    before_bins = [0] * bin_count
    after_bins = [0] * bin_count

    def to_idx(v: float) -> int:
        raw = math.floor((v - start) / bin_size)
        return max(0, min(bin_count - 1, raw))

    for p in before:
        before_bins[to_idx(p.value)] += p.count
    for p in after:
        after_bins[to_idx(p.value)] += p.count

    bins = []
    for i in range(bin_count):
        left = round(start + i * bin_size, 3)
        right = round(left + bin_size, 3)
        bins.append(
            {
                "from": left,
                "to": right,
                "beforeCount": int(before_bins[i]),
                "afterCount": int(after_bins[i]),
            }
        )

    return {
        "metric": metric,
        "unit": unit,
        "binSize": bin_size,
        "bins": bins,
        "beforeTotal": int(sum(before_bins)),
        "afterTotal": int(sum(after_bins)),
    }


def choose_allowed_keys(
    mode: str, before_keys: set[str], after_keys: set[str]
) -> set[str]:
    if mode == "before":
        return set(before_keys)
    if mode == "after":
        return set(after_keys)
    if mode == "intersection":
        return before_keys & after_keys
    # default: 不做 key 对齐；返回空集给调用方自行处理
    return set()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch-id", required=True, help="批次 ID")
    ap.add_argument(
        "--grid-match",
        default="intersection",
        choices=["default", "before", "after", "intersection"],
        help="对齐口径（默认 intersection）",
    )
    ap.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="项目根目录（默认自动推断）",
    )
    ap.add_argument("--dump-bins", type=int, default=20, help="最多打印多少个 bin")
    ap.add_argument("--json", action="store_true", help="输出完整 JSON")
    args = ap.parse_args()

    repo = Path(args.repo_root).resolve()
    batch_dir = repo / "data" / "batches" / args.batch_id
    before_path = batch_dir / "luce-result.json"
    after_path = batch_dir / "luce-result-after.json"
    settings_path = batch_dir / "luce-settings.json"

    if not before_path.exists() or not after_path.exists():
        raise SystemExit("缺少 luce-result.json 或 luce-result-after.json")
    if not settings_path.exists():
        raise SystemExit("缺少 luce-settings.json")

    before = load_json(before_path)
    after = load_json(after_path)
    settings = load_json(settings_path)

    before_grid: List[dict] = before.get("grid") or []
    after_grid: List[dict] = after.get("grid") or []
    if not before_grid or not after_grid:
        raise SystemExit("前后结果缺少 grid，当前脚本仅校验栅格口径。")

    size_m = float(settings.get("gridSizeMeters", 10))
    ref_lat = float(settings.get("regionCenterLat", 22.697092))

    before_keys = build_key_set(before_grid, size_m, ref_lat)
    after_keys = build_key_set(after_grid, size_m, ref_lat)

    if args.grid_match == "default":
        used_before = before_grid
        used_after = after_grid
        matched_keys = None
    else:
        allowed = choose_allowed_keys(args.grid_match, before_keys, after_keys)
        used_before = filter_grid_by_keys(before_grid, allowed, size_m, ref_lat)
        used_after = filter_grid_by_keys(after_grid, allowed, size_m, ref_lat)
        matched_keys = len(allowed)

    rsrp_before_pts = cells_to_metric_points(used_before, "rsrp")
    rsrp_after_pts = cells_to_metric_points(used_after, "rsrp")
    sinr_before_pts = cells_to_metric_points(used_before, "sinr")
    sinr_after_pts = cells_to_metric_points(used_after, "sinr")

    rsrp_hist = build_histogram(rsrp_before_pts, rsrp_after_pts, "rsrp")
    sinr_hist = build_histogram(sinr_before_pts, sinr_after_pts, "sinr")

    result = {
        "batchId": args.batch_id,
        "gridMatchMode": args.grid_match,
        "settings": {
            "gridSizeMeters": size_m,
            "regionCenterLat": ref_lat,
        },
        "gridCounts": {
            "beforeGridCount": len(before_grid),
            "afterGridCount": len(after_grid),
            "beforeUsedForCompare": len(used_before),
            "afterUsedForCompare": len(used_after),
            "matchedGridCount": matched_keys,
        },
        "histogramByGrid": True,
        "rsrpHistogram": rsrp_hist,
        "sinrHistogram": sinr_hist,
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("=== Compare Verification ===")
    print(f"batchId: {args.batch_id}")
    print(f"gridMatchMode: {args.grid_match}")
    print(
        "grid counts:",
        result["gridCounts"],
    )
    print(
        f"RSRP bins={len(rsrp_hist['bins'])}, totals(before/after)="
        f"{rsrp_hist['beforeTotal']}/{rsrp_hist['afterTotal']}"
    )
    print(
        f"SINR bins={len(sinr_hist['bins'])}, totals(before/after)="
        f"{sinr_hist['beforeTotal']}/{sinr_hist['afterTotal']}"
    )

    n = max(0, args.dump_bins)
    if n > 0:
        print("\n-- RSRP bins (head) --")
        for b in rsrp_hist["bins"][:n]:
            print(
                f"[{b['from']},{b['to']}) => before={b['beforeCount']}, after={b['afterCount']}"
            )
        print("\n-- SINR bins (head) --")
        for b in sinr_hist["bins"][:n]:
            print(
                f"[{b['from']},{b['to']}) => before={b['beforeCount']}, after={b['afterCount']}"
            )


if __name__ == "__main__":
    main()

