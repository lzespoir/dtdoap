#!/usr/bin/env python3
"""Generate synthetic drive-test + gongcan data for a non-Guangdong venue.

Uses the same Keysight column names the platform already parses, and RF
statistics similar to real stadium walk tests, but all coordinates / PCI /
cell names are synthetic and fictional.

Default scene: Zhejiang Hangzhou Huanglong Sports Center vicinity (WGS84).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path


# Zhejiang Hangzhou — Huanglong Sports Center plaza (public map approx.)
SCENE_LON = 120.13085
SCENE_LAT = 30.27095
SCENE_NAME = "杭州黄龙体育中心合成场景"
PROVINCE = "浙江省"
CITY = "杭州市"
DISTRICT = "西湖区"

# Four fictional indoor/plaza AAUs around the plaza (~70–90 m offsets)
TARGET_CELLS = [
    {"pci": 411, "d_east_m": -55.0, "d_north_m": 70.0, "azimuth": 125, "ssb_az": 18.0},
    {"pci": 417, "d_east_m": 68.0, "d_north_m": 62.0, "azimuth": 235, "ssb_az": -22.0},
    {"pci": 423, "d_east_m": -48.0, "d_north_m": -58.0, "azimuth": 55, "ssb_az": -15.0},
    {"pci": 429, "d_east_m": 72.0, "d_north_m": -52.0, "azimuth": -55, "ssb_az": 12.0},
]

# Extra surrounding cells for "other PCI" share
OTHER_CELLS = [
    {"pci": 501, "d_east_m": -140.0, "d_north_m": 20.0, "azimuth": 90},
    {"pci": 507, "d_east_m": 150.0, "d_north_m": -10.0, "azimuth": 270},
    {"pci": 513, "d_east_m": 10.0, "d_north_m": 160.0, "azimuth": 180},
]


@dataclass(frozen=True)
class Cell:
    pci: int
    lon: float = 0.0
    lat: float = 0.0
    azimuth: float = 0.0
    ssb_az: float | None = None
    is_target: bool = False


def meters_to_deg(east_m: float, north_m: float, lat: float) -> tuple[float, float]:
    dlon = east_m / (111320.0 * math.cos(math.radians(lat)))
    dlat = north_m / 110540.0
    return dlon, dlat


def build_cells() -> list[Cell]:
    cells: list[Cell] = []
    for raw in TARGET_CELLS:
        dlon, dlat = meters_to_deg(raw["d_east_m"], raw["d_north_m"], SCENE_LAT)
        cells.append(
            Cell(
                pci=int(raw["pci"]),
                lon=SCENE_LON + dlon,
                lat=SCENE_LAT + dlat,
                azimuth=float(raw["azimuth"]),
                ssb_az=float(raw["ssb_az"]),
                is_target=True,
            )
        )
    for raw in OTHER_CELLS:
        dlon, dlat = meters_to_deg(raw["d_east_m"], raw["d_north_m"], SCENE_LAT)
        cells.append(
            Cell(
                pci=int(raw["pci"]),
                lon=SCENE_LON + dlon,
                lat=SCENE_LAT + dlat,
                azimuth=float(raw["azimuth"]),
                is_target=False,
            )
        )
    return cells


def path_points(n: int, rng: random.Random) -> list[tuple[float, float]]:
    """Walk a rounded rectangle around the plaza (~120m x 90m)."""
    half_w, half_h = 55.0, 40.0
    perimeter = 2 * (2 * half_w + 2 * half_h)
    pts: list[tuple[float, float]] = []
    for i in range(n):
        s = (i / n) * perimeter
        # add slight meander
        jitter_e = rng.uniform(-1.2, 1.2)
        jitter_n = rng.uniform(-1.2, 1.2)
        if s < 2 * half_w:
            e = -half_w + s
            n_m = half_h
        elif s < 2 * half_w + 2 * half_h:
            e = half_w
            n_m = half_h - (s - 2 * half_w)
        elif s < 4 * half_w + 2 * half_h:
            e = half_w - (s - 2 * half_w - 2 * half_h)
            n_m = -half_h
        else:
            e = -half_w
            n_m = -half_h + (s - 4 * half_w - 2 * half_h)
        e += jitter_e
        n_m += jitter_n
        dlon, dlat = meters_to_deg(e, n_m, SCENE_LAT)
        pts.append((SCENE_LON + dlon, SCENE_LAT + dlat))
    return pts


def dist_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon1 - lon2) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat1 - lat2) * 110540.0
    return math.hypot(dx, dy)


def bearing_deg(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * 110540.0
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def predict_rsrp(
    cell: Cell,
    lon: float,
    lat: float,
    rng: random.Random,
    *,
    boost_db: float,
) -> float:
    d = max(8.0, dist_m(lon, lat, cell.lon, cell.lat))
    # Calibrated to stadium-walk-like levels (~ -75…-95 dBm inside plaza)
    path = 18.0 + 22.0 * math.log10(d) + rng.gauss(0, 1.0)
    brg = bearing_deg(cell.lon, cell.lat, lon, lat)
    misalign = angle_diff(brg, cell.azimuth)
    beam = -0.035 * (misalign**1.25)
    rsrp = -38.0 - path + beam + boost_db + rng.gauss(0, 1.2)
    return max(-105.0, min(-68.0, rsrp))


def predict_sinr(best: float, second: float, rng: random.Random, boost_db: float) -> float:
    gap = best - second
    sinr = gap - 2.5 + boost_db * 0.5 + rng.gauss(0, 1.0)
    return max(-10.0, min(12.0, sinr))


def choose_serving(
    cells: list[Cell],
    lon: float,
    lat: float,
    rng: random.Random,
    *,
    prefer_target: float,
    boost_db: float,
    other_bias: float,
) -> tuple[Cell, float, list[tuple[Cell, float]]]:
    scored: list[tuple[Cell, float]] = []
    for c in cells:
        r = predict_rsrp(c, lon, lat, rng, boost_db=boost_db if c.is_target else 0.0)
        if c.is_target:
            r += prefer_target
        else:
            r += other_bias
        scored.append((c, r))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[0][0], scored[0][1], scored


LUCE_HEADERS = [
    "Date & Time",
    "Longitude",
    "Latitude",
    "GPS Hight",
    "GPS Speed",
    "GPS Satellites",
    "GPS Heading",
    "NR PCC Serving PCI",
    "NR PCC Serving SS-RSRP(dBm)",
    "NR PCC Serving SS-SINR(dB)",
    "NR Listed PCI",
    "NR Listed SS-RSRP(dBm)",
    "NR Detected PCI",
    "NR Detected SS-RSRP(dBm)",
]


def write_luce_csv(
    path: Path,
    cells: list[Cell],
    *,
    n_points: int,
    seed: int,
    prefer_target: float,
    boost_db: float,
    other_bias: float,
    start: datetime,
) -> dict:
    rng = random.Random(seed)
    pts = path_points(n_points, rng)
    path.parent.mkdir(parents=True, exist_ok=True)
    serving_counts: dict[int, int] = {}
    rsrps: list[float] = []
    sinrs: list[float] = []

    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LUCE_HEADERS)
        w.writeheader()
        t = start
        for lon, lat in pts:
            serving, best, scored = choose_serving(
                cells,
                lon,
                lat,
                rng,
                prefer_target=prefer_target,
                boost_db=boost_db,
                other_bias=other_bias,
            )
            second = scored[1][1] if len(scored) > 1 else best - 8
            sinr = predict_sinr(best, second, rng, boost_db=boost_db)
            listed = scored[1:4]
            listed_pci = ";".join(str(c.pci) for c, _ in listed)
            listed_rsrp = ";".join(f"{r:.2f}" for _, r in listed)
            detected = scored[1:3]
            detected_pci = ";".join(str(c.pci) for c, _ in detected)
            detected_rsrp = ";".join(f"{r:.2f}" for _, r in detected)

            w.writerow(
                {
                    "Date & Time": f"\t{t.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}",
                    "Longitude": f"{lon:.8f}",
                    "Latitude": f"{lat:.8f}",
                    "GPS Hight": f"{12.0 + rng.uniform(-0.5, 0.5):.2f}",
                    "GPS Speed": f"{rng.uniform(0.2, 1.4):.2f}",
                    "GPS Satellites": str(rng.randint(8, 14)),
                    "GPS Heading": f"{rng.uniform(0, 360):.1f}",
                    "NR PCC Serving PCI": str(serving.pci),
                    "NR PCC Serving SS-RSRP(dBm)": f"{best:.2f}",
                    "NR PCC Serving SS-SINR(dB)": f"{sinr:.2f}",
                    "NR Listed PCI": listed_pci,
                    "NR Listed SS-RSRP(dBm)": listed_rsrp,
                    "NR Detected PCI": detected_pci,
                    "NR Detected SS-RSRP(dBm)": detected_rsrp,
                }
            )
            serving_counts[serving.pci] = serving_counts.get(serving.pci, 0) + 1
            rsrps.append(best)
            sinrs.append(sinr)
            t += timedelta(milliseconds=rng.randint(180, 320))

    return {
        "points": n_points,
        "servingCounts": serving_counts,
        "rsrpMean": round(sum(rsrps) / len(rsrps), 2),
        "sinrMean": round(sum(sinrs) / len(sinrs), 2),
        "targetServingRatio": round(
            sum(serving_counts.get(c.pci, 0) for c in cells if c.is_target) / n_points,
            4,
        ),
    }


GONGCAN_HEADERS = [
    "小区名称",
    "基站名称",
    "经度",
    "纬度",
    "PCI",
    "方向角",
    "天线挂高",
    "gNodeB ID",
    "频段",
    "AAU型号",
    "设备厂商",
    "CGI",
    "城市",
    "区县",
    "测试场景",
    "覆盖场景",
    "SSB波束方位角(度)",
    "数字倾角(度)-华为设置值",
    "中心频点",
]


def write_gongcan_csv(path: Path, cells: list[Cell]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=GONGCAN_HEADERS)
        w.writeheader()
        for i, c in enumerate(cells, start=1):
            tag = "目标AAU" if c.is_target else "外围小区"
            w.writerow(
                {
                    "小区名称": f"合成-{CITY}-{tag}-PCI{c.pci}",
                    "基站名称": f"合成-{DISTRICT}-站{((i - 1) // 2) + 1}",
                    "经度": f"{c.lon:.8f}",
                    "纬度": f"{c.lat:.8f}",
                    "PCI": str(c.pci),
                    "方向角": str(int(c.azimuth)),
                    "天线挂高": "18",
                    "gNodeB ID": str(920000 + i),
                    "频段": "N78",
                    "AAU型号": "AAU5336e" if c.is_target else "RRU5901",
                    "设备厂商": "合成厂商",
                    "CGI": f"460-00-{920000 + i}-{i}",
                    "城市": CITY,
                    "区县": DISTRICT,
                    "测试场景": SCENE_NAME,
                    "覆盖场景": "体育场馆-合成",
                    "SSB波束方位角(度)": "" if c.ssb_az is None else f"{c.ssb_az:.2f}",
                    "数字倾角(度)-华为设置值": "12",
                    "中心频点": "3500",
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out-dir",
        default=str(
            Path(__file__).resolve().parents[1] / "data" / "synthetic" / "hangzhou-huanglong"
        ),
    )
    parser.add_argument("--points", type=int, default=2400)
    parser.add_argument("--seed", type=int, default=20260923)
    args = parser.parse_args()

    out = Path(args.out_dir)
    cells = build_cells()
    write_gongcan_csv(out / "gongcan" / "hangzhou_huanglong_gongcan.csv", cells)

    before = write_luce_csv(
        out / "before" / "hangzhou_huanglong_before_MS1.csv",
        cells,
        n_points=args.points,
        seed=args.seed,
        prefer_target=0.2,
        boost_db=0.0,
        other_bias=2.8,
        start=datetime(2026, 9, 20, 10, 0, 0),
    )
    after = write_luce_csv(
        out / "after" / "hangzhou_huanglong_after_MS1.csv",
        cells,
        n_points=args.points,
        seed=args.seed + 17,
        prefer_target=3.8,
        boost_db=3.2,
        other_bias=0.0,
        start=datetime(2026, 9, 20, 15, 30, 0),
    )

    scene = {
        "name": SCENE_NAME,
        "province": PROVINCE,
        "city": CITY,
        "district": DISTRICT,
        "note": "Fully synthetic. No real operator / venue measurement data.",
        "center": {"longitude": SCENE_LON, "latitude": SCENE_LAT},
        "recommendedSettings": {
            "useRegionFilter": True,
            "regionCenterLon": SCENE_LON,
            "regionCenterLat": SCENE_LAT,
            "regionRadiusMeters": 70,
            "useGrasslandFilter": False,
            "comparisonGroupName": "场内 4 个 AAU",
            "comparisonTargetPcis": [c.pci for c in cells if c.is_target],
            "gridSizeMeters": 5,
        },
        "targetPcis": [c.pci for c in cells if c.is_target],
        "beforeSummary": before,
        "afterSummary": after,
    }
    (out / "scene.json").write_text(
        json.dumps(scene, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "README.md").write_text(
        "\n".join(
            [
                f"# {SCENE_NAME}",
                "",
                "本目录为**合成测试数据**，仅用于平台联调与演示。",
                "",
                "- 省份/城市：浙江 · 杭州（黄龙体育中心附近公开坐标近似中心）",
                "- 字段格式：Keysight 路测 CSV + 工参 CSV（平台已支持列名）",
                "- **不含**真实路测或真实工参；真实数据请继续放在已 gitignore 的 `data/sample/`",
                "",
                "## 文件",
                "",
                "- `gongcan/hangzhou_huanglong_gongcan.csv`",
                "- `before/hangzhou_huanglong_before_MS1.csv`",
                "- `after/hangzhou_huanglong_after_MS1.csv`",
                "- `scene.json`：推荐区域过滤与关注小区组设置",
                "",
                "## 使用",
                "",
                "1. 主界面上传工参 + 优化前 CSV，再上传优化后 CSV",
                "2. 在设置中按 `scene.json` 写入中心坐标、半径与关注 PCI",
                "3. 或将环境变量 / 默认样例目录指向本目录的 before/after",
                "",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"out": str(out), "before": before, "after": after}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
