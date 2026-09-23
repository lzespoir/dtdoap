import { Color } from "cesium";
import type { GridCell, RsrpSample } from "../types/luce";

/**
 * 按出现顺序分配色板。前 4 色针对半透明栅格叠在草坪航拍上优化：
 * 不用蓝/绿（易与草地、彼此混淆），改用红、黄、品红、橙。
 */
const PCI_DISTINCT_HEX = [
  "#ff1744", // 1 亮红
  "#ffc400", // 2 金黄
  "#d500f9", // 3 品红
  "#ff6d00", // 4 深橙
  "#304ffe", // 5 靛蓝
  "#00b8d4", // 6 亮青
  "#76ff03", // 7 黄绿（偏黄）
  "#5d4037", // 8 棕
  "#7c4dff", // 9 紫
  "#c51162", // 10 玫红
  "#1565c0", // 11 蓝
  "#2e7d32", // 12 绿（靠后使用）
];

function isHexColor(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/** 当前可见 PCI 升序 → 依次取色（不用 PCI 取模，避免不同 PCI 撞同色） */
export function buildPciColorMap(
  pcis: number[],
  overrides?: Record<string, string>
): Map<number, string> {
  const sorted = [...new Set(pcis.filter(Number.isFinite))].sort((a, b) => a - b);
  const map = new Map<number, string>();
  sorted.forEach((pci, i) => {
    const custom = overrides?.[String(pci)];
    map.set(
      pci,
      custom && isHexColor(custom)
        ? custom
        : PCI_DISTINCT_HEX[i % PCI_DISTINCT_HEX.length]
    );
  });
  return map;
}

export function pciToHex(pci: number, colorMap?: Map<number, string>): string {
  if (colorMap?.has(pci)) return colorMap.get(pci)!;
  return PCI_DISTINCT_HEX[0];
}

export function pciToColor(
  pci: number,
  colorMap?: Map<number, string>
): Color {
  return Color.fromCssColorString(pciToHex(pci, colorMap));
}

/** 从栅格列表收集出现过的 PCI（升序） */
export function collectPcisFromGrid(cells: GridCell[] | undefined): number[] {
  if (!cells?.length) return [];
  const set = new Set<number>();
  for (const c of cells) {
    if (Number.isFinite(c.pci)) set.add(c.pci);
  }
  return [...set].sort((a, b) => a - b);
}

export function collectPcisFromSamples(
  samples: RsrpSample[] | undefined
): number[] {
  if (!samples?.length) return [];
  const set = new Set<number>();
  for (const s of samples) {
    if (Number.isFinite(s.pci)) set.add(s.pci);
  }
  return [...set].sort((a, b) => a - b);
}

/** 与地图着色一致：有栅格用栅格 PCI，否则用散点 samples */
export function collectPcisFromLuce(
  luce: { grid?: GridCell[]; samples: RsrpSample[] } | null | undefined
): number[] {
  if (!luce) return [];
  const grid = luce.grid ?? [];
  if (grid.length > 0) return collectPcisFromGrid(grid);
  return collectPcisFromSamples(luce.samples);
}

export type PciLegendItem = { pci: number; hex: string };

export function pciLegendItems(
  pcis: number[],
  colorMap?: Map<number, string>
): PciLegendItem[] {
  const map = colorMap ?? buildPciColorMap(pcis);
  return pcis.map((pci) => ({ pci, hex: pciToHex(pci, map) }));
}
