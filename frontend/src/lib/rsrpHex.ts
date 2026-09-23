import { RSRP_RANGE, SINR_RANGE } from "../constants";

const RSRP_STOPS: { rsrp: number; hex: string }[] = [
  { rsrp: -120, hex: "#b71c1c" },
  { rsrp: -110, hex: "#e53935" },
  { rsrp: -100, hex: "#ff6f00" },
  { rsrp: -95, hex: "#ffa000" },
  { rsrp: -90, hex: "#ffca28" },
  { rsrp: -85, hex: "#dce775" },
  { rsrp: -80, hex: "#aed581" },
  { rsrp: -75, hex: "#66bb6a" },
  { rsrp: -70, hex: "#43a047" },
  { rsrp: -60, hex: "#1b5e20" },
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

/** 主区 RSRP (dBm) → CSS 颜色，与主地图色标一致 */
export function rsrpToHex(rsrp: number): string {
  const { min, max } = RSRP_RANGE;
  if (!Number.isFinite(rsrp)) return "#555";
  if (rsrp <= min) return RSRP_STOPS[0].hex;
  if (rsrp >= max) return RSRP_STOPS[RSRP_STOPS.length - 1].hex;
  for (let i = 0; i < RSRP_STOPS.length - 1; i++) {
    const a = RSRP_STOPS[i];
    const b = RSRP_STOPS[i + 1];
    if (rsrp >= a.rsrp && rsrp <= b.rsrp) {
      const t = (rsrp - a.rsrp) / (b.rsrp - a.rsrp);
      return lerpHex(a.hex, b.hex, t);
    }
  }
  return RSRP_STOPS[RSRP_STOPS.length - 1].hex;
}

export function rsrpLegendGradientCss(): string {
  const { min, max } = RSRP_RANGE;
  const parts = RSRP_STOPS.map((s) => {
    const pct = ((s.rsrp - min) / (max - min)) * 100;
    return `${s.hex} ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** 格内极差色标：按 0~cap 归一化，色阶在 0~1 上均匀分布，gamma 压低中段偏红 */
const SPREAD_PALETTE: { t: number; hex: string }[] = [
  { t: 0, hex: "#f7f7f7" },
  { t: 0.14, hex: "#e8f4fc" },
  { t: 0.28, hex: "#90caf9" },
  { t: 0.42, hex: "#fff9c4" },
  { t: 0.56, hex: "#ffcc80" },
  { t: 0.7, hex: "#ff8a65" },
  { t: 0.84, hex: "#ef5350" },
  { t: 1, hex: "#7b0022" },
];

/** >1 时低极差更多落在蓝/黄段，红色仅集中在高端 */
const SPREAD_GAMMA = 1.35;

function spreadNormalized(spread: number, cap: number): number {
  if (!Number.isFinite(spread) || spread <= 0) return 0;
  const v = Math.min(spread / Math.max(1, cap), 1);
  return Math.pow(v, SPREAD_GAMMA);
}

function hexAtSpreadT(t: number): string {
  const u = Math.min(1, Math.max(0, t));
  if (u <= SPREAD_PALETTE[0].t) return SPREAD_PALETTE[0].hex;
  if (u >= SPREAD_PALETTE[SPREAD_PALETTE.length - 1].t) {
    return SPREAD_PALETTE[SPREAD_PALETTE.length - 1].hex;
  }
  for (let i = 0; i < SPREAD_PALETTE.length - 1; i++) {
    const a = SPREAD_PALETTE[i];
    const b = SPREAD_PALETTE[i + 1];
    if (u >= a.t && u <= b.t) {
      const frac = (u - a.t) / (b.t - a.t || 1);
      return lerpHex(a.hex, b.hex, frac);
    }
  }
  return SPREAD_PALETTE[SPREAD_PALETTE.length - 1].hex;
}

export function spreadToHex(spread: number, maxSpread: number): string {
  return hexAtSpreadT(spreadNormalized(spread, maxSpread));
}

const SINR_STOPS: { sinr: number; hex: string }[] = [
  { sinr: -10, hex: "#c62828" },
  { sinr: -5, hex: "#ef6c00" },
  { sinr: 0, hex: "#fff59d" },
  { sinr: 5, hex: "#7cb342" },
  { sinr: 10, hex: "#2e7d32" },
];

/** SINR (dB) → CSS 颜色，与主地图色标一致 */
export function sinrToHex(sinr: number): string {
  const { min, max } = SINR_RANGE;
  if (!Number.isFinite(sinr)) return "#555";
  if (sinr <= min) return SINR_STOPS[0].hex;
  if (sinr >= max) return SINR_STOPS[SINR_STOPS.length - 1].hex;
  for (let i = 0; i < SINR_STOPS.length - 1; i++) {
    const a = SINR_STOPS[i];
    const b = SINR_STOPS[i + 1];
    if (sinr >= a.sinr && sinr <= b.sinr) {
      const t = (sinr - a.sinr) / (b.sinr - a.sinr);
      return lerpHex(a.hex, b.hex, t);
    }
  }
  return SINR_STOPS[SINR_STOPS.length - 1].hex;
}

export function spreadLegendGradientCss(maxSpread: number): string {
  const steps = 12;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const pct = (i / steps) * 100;
    const spread = (i / steps) * Math.max(1, maxSpread);
    parts.push(`${spreadToHex(spread, maxSpread)} ${pct.toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
