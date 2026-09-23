import { Color } from "cesium";
import {
  DELTA_RSRP_RANGE,
  DELTA_SINR_RANGE,
  RSRP_RANGE,
  SINR_RANGE,
} from "../constants";
import type { LuceSettings, MetricColorRange } from "../types/luce";

export type { MetricColorRange };

export function metricRangesFromSettings(
  settings: Pick<
    LuceSettings,
    "rsrpRangeMin" | "rsrpRangeMax" | "sinrRangeMin" | "sinrRangeMax"
  >
): { rsrp: MetricColorRange; sinr: MetricColorRange } {
  return {
    rsrp: {
      min: settings.rsrpRangeMin ?? RSRP_RANGE.min,
      max: settings.rsrpRangeMax ?? RSRP_RANGE.max,
    },
    sinr: {
      min: settings.sinrRangeMin ?? SINR_RANGE.min,
      max: settings.sinrRangeMax ?? SINR_RANGE.max,
    },
  };
}

/** RSRP 色阶：固定红→绿形状，与绝对 dBm 无关 */
const RSRP_PALETTE: { t: number; hex: string }[] = [
  { t: 0, hex: "#b71c1c" },
  { t: 0.125, hex: "#e53935" },
  { t: 0.25, hex: "#ff6f00" },
  { t: 0.3125, hex: "#ffa000" },
  { t: 0.375, hex: "#ffca28" },
  { t: 0.4375, hex: "#dce775" },
  { t: 0.6, hex: "#aed581" },
  { t: 0.725, hex: "#66bb6a" },
  { t: 0.85, hex: "#43a047" },
  { t: 1, hex: "#1b5e20" },
];

function lerpHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** 在固定色阶上按归一化位置 0~1 取色 */
function hexAtNormalized(t: number, palette: { t: number; hex: string }[]): string {
  const u = Math.min(1, Math.max(0, t));
  if (u <= palette[0].t) return palette[0].hex;
  if (u >= palette[palette.length - 1].t) return palette[palette.length - 1].hex;
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i];
    const b = palette[i + 1];
    if (u >= a.t && u <= b.t) {
      const frac = (u - a.t) / (b.t - a.t || 1);
      return lerpHex(a.hex, b.hex, frac);
    }
  }
  return palette[palette.length - 1].hex;
}

function colorAtNormalized(t: number, palette: { t: number; hex: string }[]): Color {
  return Color.fromCssColorString(hexAtNormalized(t, palette));
}

/** 将实测值映射到设置范围内的 0~1 位置 */
function normalizedInRange(
  value: number,
  range: MetricColorRange
): number {
  const { min, max } = range;
  if (!Number.isFinite(value) || min >= max) return 0;
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

function fixedPaletteLegendGradientCss(
  palette: { t: number; hex: string }[]
): string {
  const parts = palette.map(
    (s) => `${s.hex} ${(s.t * 100).toFixed(1)}%`
  );
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** 图例渐变：始终完整红→绿，不随设置范围改变形状 */
export function rsrpLegendGradientCss(
  _range?: MetricColorRange
): string {
  return fixedPaletteLegendGradientCss(RSRP_PALETTE);
}

export function rsrpLegendEndpointHexes(
  _range?: MetricColorRange
): { low: string; high: string } {
  return {
    low: RSRP_PALETTE[0].hex,
    high: RSRP_PALETTE[RSRP_PALETTE.length - 1].hex,
  };
}

/** RSRP (dBm) → Cesium Color；设置范围仅决定数值落在色阶上的位置 */
export function rsrpToColor(
  rsrp: number,
  range: MetricColorRange = RSRP_RANGE
): Color {
  return colorAtNormalized(normalizedInRange(rsrp, range), RSRP_PALETTE);
}

/** SINR 色阶：固定红→绿形状 */
const SINR_PALETTE: { t: number; hex: string }[] = [
  { t: 0, hex: "#c62828" },
  { t: 0.25, hex: "#ef6c00" },
  { t: 0.5, hex: "#fff59d" },
  { t: 0.75, hex: "#7cb342" },
  { t: 1, hex: "#2e7d32" },
];

export function sinrLegendGradientCss(
  _range?: MetricColorRange
): string {
  return fixedPaletteLegendGradientCss(SINR_PALETTE);
}

export function sinrLegendEndpointHexes(
  _range?: MetricColorRange
): { low: string; high: string } {
  return {
    low: SINR_PALETTE[0].hex,
    high: SINR_PALETTE[SINR_PALETTE.length - 1].hex,
  };
}

/** SINR (dB) → Cesium Color；NaN 时退回中性灰 */
export function sinrToColor(
  sinr: number | undefined | null,
  range: MetricColorRange = SINR_RANGE
): Color {
  if (sinr == null || !Number.isFinite(sinr)) {
    return Color.fromCssColorString("#9e9e9e");
  }
  return colorAtNormalized(normalizedInRange(sinr, range), SINR_PALETTE);
}

/** Δ 色标：负(红) → 0(灰) → 正(绿) */
function buildDeltaStops(min: number, max: number) {
  const mid = (min + max) / 2;
  return [
    { v: min, hex: "#b71c1c" },
    { v: min + (mid - min) * 0.35, hex: "#e53935" },
    { v: min + (mid - min) * 0.7, hex: "#ff8a65" },
    { v: 0, hex: "#eceff1" },
    { v: max - (max - mid) * 0.7, hex: "#aed581" },
    { v: max - (max - mid) * 0.35, hex: "#66bb6a" },
    { v: max, hex: "#1b5e20" },
  ];
}

const DELTA_RSRP_STOPS = buildDeltaStops(
  DELTA_RSRP_RANGE.min,
  DELTA_RSRP_RANGE.max
).map((s) => ({ ...s, color: Color.fromCssColorString(s.hex) }));

const DELTA_SINR_STOPS = buildDeltaStops(
  DELTA_SINR_RANGE.min,
  DELTA_SINR_RANGE.max
).map((s) => ({ ...s, color: Color.fromCssColorString(s.hex) }));

function deltaLegendGradientCss(min: number, max: number): string {
  const stops = buildDeltaStops(min, max);
  const parts = stops.map((s) => {
    const pct = ((s.v - min) / (max - min)) * 100;
    return `${s.hex} ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

export function deltaRsrpLegendGradientCss(): string {
  return deltaLegendGradientCss(DELTA_RSRP_RANGE.min, DELTA_RSRP_RANGE.max);
}

export function deltaSinrLegendGradientCss(): string {
  return deltaLegendGradientCss(DELTA_SINR_RANGE.min, DELTA_SINR_RANGE.max);
}

function deltaToColor(
  delta: number,
  min: number,
  max: number,
  stops: { v: number; color: Color }[]
): Color {
  if (!Number.isFinite(delta)) {
    return Color.fromCssColorString("#9e9e9e");
  }
  if (delta <= min) return stops[0].color.clone();
  if (delta >= max) return stops[stops.length - 1].color.clone();

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (delta >= a.v && delta <= b.v) {
      const t = (delta - a.v) / (b.v - a.v);
      return Color.lerp(a.color, b.color, t, new Color());
    }
  }
  return stops[stops.length - 1].color.clone();
}

export function deltaRsrpToColor(delta: number): Color {
  return deltaToColor(
    delta,
    DELTA_RSRP_RANGE.min,
    DELTA_RSRP_RANGE.max,
    DELTA_RSRP_STOPS
  );
}

export function deltaSinrToColor(delta: number): Color {
  return deltaToColor(
    delta,
    DELTA_SINR_RANGE.min,
    DELTA_SINR_RANGE.max,
    DELTA_SINR_STOPS
  );
}
