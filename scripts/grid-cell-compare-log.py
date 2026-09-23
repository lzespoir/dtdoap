#!/usr/bin/env python3
"""
逐栅格对比：平台存盘 vs 从 TSV 样本重算（主服 PCI / Notebook 全点均值）。
输出详细 log：格子边界、中心、键、点数、RSRP、格内采样点列表。

用法:
  python3 scripts/grid-cell-compare-log.py [batch_id]
  BATCH_ID=xxx python3 scripts/grid-cell-compare-log.py
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PROJECT = Path(__file__).resolve().parents[1]
BATCHES = PROJECT / "data" / "batches"
M = 111_320
AWK_FILTER = PROJECT / "backend" / "scripts" / "luce-filter.awk"


@dataclass
class Sample:
    lon: float
    lat: float
    rsrp: float
    pci: int


@dataclass
class CellDetail:
    key: str
    gx: int
    gy: int
    west: float
    south: float
    east: float
    north: float
    center_lon: float
    center_lat: float
    rsrp: float
    pci: int
    count: int
    points: list[Sample] = field(default_factory=list)
    by_pci: dict[int, list[float]] = field(default_factory=dict)


def log(f, msg: str) -> None:
    f.write(msg + "\n")
    print(msg)


def grid_opts(settings: dict) -> tuple[str, float, float]:
    mode = settings.get("gridIndexMode", "global")
    ref_lat = settings.get("gridRefLat") or settings.get("regionCenterLat", 22.697092)
    ref_lon = settings.get("gridRefLon") or settings.get("regionCenterLon", 114.212309)
    return mode, float(ref_lat), float(ref_lon)


def gxgy(lon: float, lat: float, size: float, mode: str, ref_lat: float, ref_lon: float) -> tuple[int, int]:
    if mode == "dataset":
        cos_ref = math.cos(math.radians(ref_lat))
        gx = math.floor(((lon - ref_lon) * cos_ref * M) / size)
        gy = math.floor(((lat - ref_lat) * M) / size)
    else:
        cos_ref = math.cos(math.radians(ref_lat))
        gx = math.floor((lon * cos_ref * M) / size)
        gy = math.floor((lat * M) / size)
    return gx, gy


def bounds(gx: int, gy: int, size: float, mode: str, ref_lat: float, ref_lon: float) -> dict[str, float]:
    cos_ref = math.cos(math.radians(ref_lat))
    if mode == "dataset":
        west = ref_lon + (gx * size) / (M * cos_ref)
        south = ref_lat + (gy * size) / M
        east = west + size / (M * cos_ref)
        north = south + size / M
    else:
        south = (gy * size) / M
        north = ((gy + 1) * size) / M
        west = (gx * size) / (M * cos_ref)
        east = ((gx + 1) * size) / (M * cos_ref)
    return {
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "center_lon": (west + east) / 2,
        "center_lat": (south + north) / 2,
    }


def load_samples_awk(batch_id: str, variant: str, settings: dict) -> list[Sample]:
    cache = BATCHES / batch_id / f"luce-cache{'' if variant == 'before' else '-after'}"
    manifest_path = cache / "manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text())
    env = os.environ.copy()
    env.update(
        {
            "LUCE_SERVING_PCI": ",".join(str(x) for x in settings.get("servingPciFilter") or []),
            "LUCE_NEIGHBOR_PCI": ",".join(str(x) for x in settings.get("neighborPciFilter") or []),
            "LUCE_SERVING_PCI_EXCLUDE": ",".join(
                str(x) for x in settings.get("servingPciExclude") or []
            ),
            "LUCE_NEIGHBOR_PCI_EXCLUDE": ",".join(
                str(x) for x in settings.get("neighborPciExclude") or []
            ),
            "LUCE_INCLUDE_SERVING": "1" if settings.get("includeServing", True) else "0",
            "LUCE_INCLUDE_NEIGHBOR": "1" if settings.get("includeNeighbor") else "0",
            "LUCE_NEIGHBOR_SOURCE": settings.get("neighborSource", "listed"),
            "LUCE_MAX_SAMPLES": "0",
            "LUCE_USE_REGION": "1" if settings.get("useRegionFilter") else "0",
            "LUCE_CENTER_LON": str(settings.get("regionCenterLon", 114.212309)),
            "LUCE_CENTER_LAT": str(settings.get("regionCenterLat", 22.697092)),
            "LUCE_RADIUS_M": str(settings.get("regionRadiusMeters", 55)),
            "LUCE_USE_GRASSLAND": "1" if settings.get("useGrasslandFilter") else "0",
        }
    )
    if settings.get("useGrasslandFilter"):
        bb = settings.get("grasslandBbox") or {}
        env["LUCE_GRASS_LON_MIN"] = str(bb.get("lonMin", 0))
        env["LUCE_GRASS_LON_MAX"] = str(bb.get("lonMax", 0))
        env["LUCE_GRASS_LAT_MIN"] = str(bb.get("latMin", 0))
        env["LUCE_GRASS_LAT_MAX"] = str(bb.get("latMax", 0))

    out: list[Sample] = []
    for f in manifest.get("files", []):
        rel = f.get("extract")
        if not rel:
            continue
        tsv = BATCHES / batch_id / rel
        if not tsv.exists():
            continue
        proc = subprocess.run(
            ["gawk", "-f", str(AWK_FILTER), str(tsv)],
            capture_output=True,
            text=True,
            env=env,
        )
        for line in proc.stdout.splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 5:
                continue
            lon, lat, rsrp, pci = float(parts[0]), float(parts[1]), float(parts[2]), int(parts[3])
            out.append(Sample(lon, lat, rsrp, pci))
    return out


def build_from_samples(
    samples: list[Sample],
    size: float,
    mode: str,
    ref_lat: float,
    ref_lon: float,
    agg: str,
    preferred_pcis: list[int] | None = None,
) -> dict[str, CellDetail]:
    preferred = set(preferred_pcis or [])
    buckets: dict[str, dict] = defaultdict(lambda: {"points": [], "by_pci": defaultdict(list)})

    for s in samples:
        gx, gy = gxgy(s.lon, s.lat, size, mode, ref_lat, ref_lon)
        key = f"{gx},{gy}"
        b = buckets[key]
        b["gx"], b["gy"] = gx, gy
        b["points"].append(s)
        b["by_pci"][s.pci].append(s.rsrp)

    cells: dict[str, CellDetail] = {}
    for key, b in buckets.items():
        gx, gy = b["gx"], b["gy"]
        bd = bounds(gx, gy, size, mode, ref_lat, ref_lon)
        by_pci = dict(b["by_pci"])

        if agg == "dominant_pci":
            best_pci = max(
                by_pci.keys(),
                key=lambda p: (len(by_pci[p]), 1 if p in preferred else 0, p),
            )
            rs = by_pci[best_pci]
            rsrp = sum(rs) / len(rs)
            pci = best_pci
            count = len(rs)
        else:
            rs = [p.rsrp for p in b["points"]]
            rsrp = sum(rs) / len(rs)
            pci = -1
            count = len(rs)

        cells[key] = CellDetail(
            key=key,
            gx=gx,
            gy=gy,
            west=bd["west"],
            south=bd["south"],
            east=bd["east"],
            north=bd["north"],
            center_lon=bd["center_lon"],
            center_lat=bd["center_lat"],
            rsrp=rsrp,
            pci=pci,
            count=count,
            points=list(b["points"]),
            by_pci={k: list(v) for k, v in by_pci.items()},
        )
    return cells


def load_platform_grid(result_path: Path, size: float, mode: str, ref_lat: float, ref_lon: float) -> dict[str, CellDetail]:
    data = json.loads(result_path.read_text())
    cells = {}
    for c in data.get("grid") or []:
        gx, gy = gxgy(c["longitude"], c["latitude"], size, mode, ref_lat, ref_lon)
        key = f"{gx},{gy}"
        k2 = f"{int(c['longitude']*1e6)}"  # unused
        cells[key] = CellDetail(
            key=key,
            gx=gx,
            gy=gy,
            west=c["west"],
            south=c["south"],
            east=c["east"],
            north=c["north"],
            center_lon=c["longitude"],
            center_lat=c["latitude"],
            rsrp=c["rsrp"],
            pci=int(c["pci"]),
            count=int(c["count"]),
        )
        # key from stored center vs key from bounds gx,gy
        cells[key].__dict__["key_from_center"] = key
        gxb, gyb = gxgy(c["west"] + 1e-9, c["south"] + 1e-9, size, mode, ref_lat, ref_lon)
        cells[key].__dict__["key_from_corner"] = f"{gxb},{gyb}"
    return cells, data.get("settings", {}), data.get("processedAt")


def fmt_point(s: Sample) -> str:
    return f"({s.lon:.7f},{s.lat:.7f}) rsrp={s.rsrp:.2f} pci={s.pci}"


def compare_variant(
    f,
    batch_id: str,
    variant: str,
    settings: dict,
    max_detail: int = 25,
) -> dict[str, Any]:
    size = float(settings.get("gridSizeMeters", 5))
    mode, ref_lat, ref_lon = grid_opts(settings)
    label = "优化前" if variant == "before" else "优化后"
    result_name = "luce-result.json" if variant == "before" else "luce-result-after.json"
    result_path = BATCHES / batch_id / result_name

    log(f, f"\n{'='*72}")
    log(f, f"【{label}】 batch={batch_id}")
    agg = settings.get("gridAggMode", "dominant_pci")
    log(f, f"settings: gridIndexMode={mode} gridRefOrigin={settings.get('gridRefOrigin')} gridAggMode={agg}")
    log(f, f"gridRef=({ref_lon:.8f}, {ref_lat:.8f}) size={size}m")

    samples = load_samples_awk(batch_id, variant, settings)
    log(f, f"awk 采样点数: {len(samples)}")

    plat_cells, result_settings, processed_at = load_platform_grid(
        result_path, size, mode, ref_lat, ref_lon
    )
    log(f, f"平台存盘栅格数: {len(plat_cells)}  processedAt={processed_at}")
    if result_settings:
        rs_lon = result_settings.get("gridRefLon")
        rs_lat = result_settings.get("gridRefLat")
        log(f, f"result.settings gridRef=({rs_lon}, {rs_lat})")
        if rs_lon and abs(float(rs_lon) - ref_lon) > 1e-6:
            log(f, "  ⚠ luce-settings.json 与 luce-result.settings 的 gridRef 不一致!")

    recalc = build_from_samples(
        samples, size, mode, ref_lat, ref_lon, agg, settings.get("servingPciFilter")
    )
    recalc_nb = (
        build_from_samples(samples, size, mode, ref_lat, ref_lon, "all_points_mean", settings.get("servingPciFilter"))
        if agg != "all_points_mean"
        else None
    )

    log(f, f"样本重算栅格({agg}): {len(recalc)}  Notebook均值对照: {len(recalc_nb) if recalc_nb else '—'}")

    keys_plat = set(plat_cells)
    keys_rec = set(recalc)
    log(f, f"键集合: 平台={len(keys_plat)} 重算={len(keys_rec)} 交集={len(keys_plat & keys_rec)}")
    log(f, f"  仅平台有: {len(keys_plat - keys_rec)}  仅重算有: {len(keys_rec - keys_plat)}")

    issues = {
        "bounds_mismatch": 0,
        "rsrp_mismatch": 0,
        "count_mismatch": 0,
        "key_center_mismatch": 0,
        "plat_vs_nb_mean": 0,
    }
    detail_n = 0

    for key in sorted(keys_plat & keys_rec):
        p = plat_cells[key]
        r = recalc[key]
        dw = abs(p.west - r.west)
        ds = abs(p.south - r.south)
        drsrp = abs(p.rsrp - r.rsrp)
        dcnt = p.count - r.count

        k_center = f"{gxgy(p.center_lon, p.center_lat, size, mode, ref_lat, ref_lon)[0]},{gxgy(p.center_lon, p.center_lat, size, mode, ref_lat, ref_lon)[1]}"
        if k_center != key:
            issues["key_center_mismatch"] += 1

        if dw > 1e-8 or ds > 1e-8:
            issues["bounds_mismatch"] += 1
        if drsrp > 0.01:
            issues["rsrp_mismatch"] += 1
        if dcnt != 0:
            issues["count_mismatch"] += 1

        nb = recalc_nb.get(key) if recalc_nb else None
        if nb and abs(p.rsrp - nb.rsrp) > 0.5:
            issues["plat_vs_nb_mean"] += 1

        need_detail = (
            dw > 1e-6
            or ds > 1e-6
            or drsrp > 0.01
            or dcnt != 0
            or k_center != key
            or (nb and abs(p.rsrp - nb.rsrp) > 0.5)
        )
        if need_detail and detail_n < max_detail:
            detail_n += 1
            log(f, f"\n--- 栅格 key={key} gx,gy=({p.gx},{p.gy}) [{label}] ---")
            log(f, f"  平台存盘: west={p.west:.9f} south={p.south:.9f} east={p.east:.9f} north={p.north:.9f}")
            log(f, f"            center=({p.center_lon:.9f},{p.center_lat:.9f}) rsrp={p.rsrp:.4f} pci={p.pci} count={p.count}")
            log(f, f"  重算({agg}): west={r.west:.9f} south={r.south:.9f} rsrp={r.rsrp:.4f} pci={r.pci} count={r.count}")
            if nb:
                log(f, f"  NB均值:   rsrp={nb.rsrp:.4f} count={nb.count} |Δplat|={abs(p.rsrp-nb.rsrp):.3f}")
            log(f, f"  中心反算键={k_center} (应等于 {key})")
            log(f, f"  边界差(m): west={dw*M*math.cos(math.radians(ref_lat)):.4f} south={ds*M:.4f}")
            log(f, f"  PCI分布(重算): " + ", ".join(
                f"pci{k}:n{len(v)} avg={sum(v)/len(v):.2f}" for k, v in sorted(r.by_pci.items())
            ))
            log(f, f"  格内点({len(r.points)}个, 前20):")
            for s in r.points[:20]:
                log(f, f"    {fmt_point(s)}")
            if len(r.points) > 20:
                log(f, f"    ... 共 {len(r.points)} 点")

    log(f, f"\n【{label} 汇总】")
    if agg == "dominant_pci":
        log(f, "  说明: grid.count = 主服 PCI(众数) 样本数；plat_vs_nb_mean 大表示与 Notebook 全点均值聚合不同。")
    else:
        log(f, "  说明: grid.count = 格内全部采样点数（全点均值模式）。")
    log(f, f"  bounds_mismatch=0 表示格子地理位置与重算一致。")
    for k, v in issues.items():
        log(f, f"  {k}: {v}")

    total_pts = sum(len(c.points) for c in recalc.values())
    sum_plat_count = sum(c.count for c in plat_cells.values())
    log(f, f"  格内总采样点(重算): {total_pts}  平台 count 字段之和: {sum_plat_count}")

    return {"issues": issues, "samples": len(samples), "plat_cells": len(plat_cells)}


def compare_delta(f, batch_id: str, settings: dict, max_detail: int = 15) -> None:
    size = float(settings.get("gridSizeMeters", 5))
    mode, ref_lat, ref_lon = grid_opts(settings)
    agg = settings.get("gridAggMode", "dominant_pci")
    log(f, f"\n{'='*72}")
    log(f, "【前后栅格 RSRP 对比】")
    log(f, f"gridAggMode={agg}  gridRef=({ref_lon:.8f}, {ref_lat:.8f})")

    before_samples = load_samples_awk(batch_id, "before", settings)
    after_samples = load_samples_awk(batch_id, "after", settings)
    b_re = build_from_samples(
        before_samples, size, mode, ref_lat, ref_lon, agg, settings.get("servingPciFilter")
    )
    a_re = build_from_samples(
        after_samples, size, mode, ref_lat, ref_lon, agg, settings.get("servingPciFilter")
    )

    plat_b, sb, _ = load_platform_grid(BATCHES / batch_id / "luce-result.json", size, mode, ref_lat, ref_lon)
    plat_a, sa, _ = load_platform_grid(
        BATCHES / batch_id / "luce-result-after.json", size, mode, ref_lat, ref_lon
    )

    keys_b_plat, keys_a_plat = set(plat_b), set(plat_a)
    keys_b_re, keys_a_re = set(b_re), set(a_re)
    common_plat = keys_b_plat & keys_a_plat
    common_re = keys_b_re & keys_a_re
    common = common_plat & common_re

    log(f, f"优化前栅格: 平台={len(keys_b_plat)} 重算={len(keys_b_re)}")
    log(f, f"优化后栅格: 平台={len(keys_a_plat)} 重算={len(keys_a_re)}")
    log(f, f"仅优化前有栅格: 平台={len(keys_b_plat - keys_a_plat)}  仅优化后有: 平台={len(keys_a_plat - keys_b_plat)}")
    log(f, f"  → 切换「优化前/后」地图时，约 {len(keys_b_plat - keys_a_plat)}+{len(keys_a_plat - keys_b_plat)} 个格子会显隐，不是位置错位。")
    log(f, f"共同键(前后均有): 平台={len(common_plat)}  重算={len(common_re)}  交集={len(common)}")

    deltas_plat: list[float] = []
    deltas_re: list[float] = []
    rsrp_plat_mismatch = 0
    for key in common:
        pb, pa = plat_b[key], plat_a[key]
        rb, ra = b_re[key], a_re[key]
        dp = pa.rsrp - pb.rsrp
        dr = ra.rsrp - rb.rsrp
        deltas_plat.append(dp)
        deltas_re.append(dr)
        if abs(dp - dr) > 0.02:
            rsrp_plat_mismatch += 1

    if deltas_plat:
        deltas_plat.sort()
        n = len(deltas_plat)
        def pct(arr: list[float], p: float) -> float:
            i = min(n - 1, max(0, int(p / 100 * n)))
            return arr[i]

        gt05 = sum(1 for d in deltas_plat if abs(d) > 0.5)
        gt1 = sum(1 for d in deltas_plat if abs(d) > 1.0)
        improved = sum(1 for d in deltas_plat if d > 0.5)
        degraded = sum(1 for d in deltas_plat if d < -0.5)
        log(f, f"\n共同栅格 ΔRSRP（平台存盘 after−before，n={n}）:")
        log(f, f"  min={min(deltas_plat):.3f} max={max(deltas_plat):.3f} mean={sum(deltas_plat)/n:.3f} dB")
        log(f, f"  p10={pct(deltas_plat,10):.3f} p50={pct(deltas_plat,50):.3f} p90={pct(deltas_plat,90):.3f} dB")
        log(f, f"  |Δ|>0.5dB: {gt05} ({100*gt05/n:.1f}%)  |Δ|>1dB: {gt1} ({100*gt1/n:.1f}%)")
        log(f, f"  变好(Δ>0.5): {improved}  变差(Δ<-0.5): {degraded}")
        log(f, f"  平台 vs 样本重算 Δ 不一致(>0.02dB): {rsrp_plat_mismatch}")

    log(f, f"\n{'='*72}")
    log(f, "【Δ 视图 / 边界】")

    b_dom = b_re
    a_dom = a_re
    common_delta = common

    # 模拟前端 buildGridDelta：用 settings 的 gridRef 从中心算 key + 用存盘边界
    ui_issues = 0
    for key in list(common_delta)[:max_detail * 3]:
        pb, pa = plat_b[key], plat_a[key]
        # 键：从存盘中心用当前 settings
        kb = f"{gxgy(pb.center_lon, pb.center_lat, size, mode, ref_lat, ref_lon)[0]},{gxgy(pb.center_lon, pb.center_lat, size, mode, ref_lat, ref_lon)[1]}"
        ka = f"{gxgy(pa.center_lon, pa.center_lat, size, mode, ref_lat, ref_lon)[0]},{gxgy(pa.center_lon, pa.center_lat, size, mode, ref_lat, ref_lon)[1]}"
        if kb != key or ka != key:
            ui_issues += 1
        # Δ 边界若用 key 重算 vs 存盘
        bd = bounds(*map(int, key.split(",")), size, mode, ref_lat, ref_lon)
        shift_b = math.hypot(
            (pb.west - bd["west"]) * M * math.cos(math.radians(ref_lat)),
            (pb.south - bd["south"]) * M,
        )
        if shift_b > 0.01 and ui_issues < max_detail:
            ui_issues += 1
            log(f, f"\n--- Δ key={key} 存盘边界 vs 按key重算边界偏移 {shift_b:.3f}m ---")
            log(f, f"  before存盘 west={pb.west:.9f} south={pb.south:.9f}")
            log(f, f"  重算边界 west={bd['west']:.9f} south={bd['south']:.9f}")
            log(f, f"  before rsrp={pb.rsrp:.3f} after={pa.rsrp:.3f} Δ={pa.rsrp-pb.rsrp:.3f}")
            log(f, f"  重算 before rsrp={b_dom[key].rsrp:.3f} after={a_dom[key].rsrp:.3f}")

    log(f, f"Δ 视图潜在错位(中心键≠bucket键或边界重算偏移>1cm): 抽查 {ui_issues}")


def main() -> None:
    batch_id = os.environ.get("BATCH_ID") or (sys.argv[1] if len(sys.argv) > 1 else "5582748a-73a7-403c-99ee-b641ad267659")
    batch_dir = BATCHES / batch_id
    if not batch_dir.exists():
        print("批次不存在:", batch_dir)
        sys.exit(1)

    settings = json.loads((batch_dir / "luce-settings.json").read_text())
    log_path = batch_dir / "grid-compare-debug.log"

    with log_path.open("w", encoding="utf-8") as f:
        log(f, f"栅格详细对比 log — {batch_id}")
        log(f, f"时间: {__import__('datetime').datetime.now().isoformat()}")
        compare_variant(f, batch_id, "before", settings, max_detail=30)
        compare_variant(f, batch_id, "after", settings, max_detail=30)
        compare_delta(f, batch_id, settings, max_detail=20)

    print(f"\n完整 log 已写入: {log_path}")


if __name__ == "__main__":
    main()
