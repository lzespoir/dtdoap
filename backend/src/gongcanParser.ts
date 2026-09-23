import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import { categoryDir } from "./batchStorage.js";

export interface CellSite {
  id: string;
  cellName: string;
  longitude: number;
  latitude: number;
  pci: number | null;
  stationName: string;
  azimuth: number | null;
  height: number | null;
  gnodeBId: string;
  band: string;
  aauModel: string;
  vendor: string;
  cgi: string;
  extra: Record<string, string | number>;
}

const CELL_NAME_KEYS = ["小区名称", "小区名", "cell name", "cellname"];
const LON_KEYS = ["经度", "longitude", "lon", "lng"];
const LAT_KEYS = ["纬度", "latitude", "lat"];
const PCI_KEYS = ["pci", "PCI"];

function normKey(k: string): string {
  return k.trim().toLowerCase();
}

function findColumn(row: Record<string, unknown>, keys: string[]): string | null {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) {
    map.set(normKey(k), k);
  }
  for (const key of keys) {
    const hit = map.get(normKey(key));
    if (hit) return hit;
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function cellId(name: string, lon: number, lat: number, pci: number | null): string {
  return `${name}|${lon.toFixed(6)}|${lat.toFixed(6)}|${pci ?? ""}`;
}

function rowToCell(row: Record<string, unknown>): CellSite | null {
  const nameCol = findColumn(row, CELL_NAME_KEYS);
  const lonCol = findColumn(row, LON_KEYS);
  const latCol = findColumn(row, LAT_KEYS);
  if (!nameCol || !lonCol || !latCol) return null;

  const cellName = toStr(row[nameCol]);
  const longitude = toNum(row[lonCol]);
  const latitude = toNum(row[latCol]);
  if (!cellName || longitude === null || latitude === null) return null;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }

  const pciCol = findColumn(row, PCI_KEYS);
  const pci = pciCol ? toNum(row[pciCol]) : null;

  const stationCol = findColumn(row, ["基站名称", "基站名", "站名"]);
  const azimuthCol = findColumn(row, ["方向角", "方位角"]);
  const heightCol = findColumn(row, ["天线挂高", "挂高", "站高"]);
  const gnbCol = findColumn(row, ["gnodeb_id", "gnodeB_ID", "gNodeB ID"]);
  const bandCol = findColumn(row, ["频段", "带宽", "band"]);
  const aauCol = findColumn(row, ["AAU型号", "aau型号"]);
  const vendorCol = findColumn(row, ["设备厂商", "厂商"]);
  const cgiCol = findColumn(row, ["CGI", "cgi"]);

  const known = new Set(
    [
      nameCol,
      lonCol,
      latCol,
      pciCol,
      stationCol,
      azimuthCol,
      heightCol,
      gnbCol,
      bandCol,
      aauCol,
      vendorCol,
      cgiCol,
    ].filter(Boolean) as string[]
  );

  const extra: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (known.has(k)) continue;
    const s = toStr(v);
    if (!s) continue;
    const n = toNum(v);
    extra[k] = n !== null ? n : s;
  }

  return {
    id: cellId(cellName, longitude, latitude, pci),
    cellName,
    longitude,
    latitude,
    pci: pci !== null ? Math.round(pci) : null,
    stationName: stationCol ? toStr(row[stationCol]) : "",
    azimuth: azimuthCol ? toNum(row[azimuthCol]) : null,
    height: heightCol ? toNum(row[heightCol]) : null,
    gnodeBId: gnbCol ? toStr(row[gnbCol]) : "",
    band: bandCol ? toStr(row[bandCol]) : "",
    aauModel: aauCol ? toStr(row[aauCol]) : "",
    vendor: vendorCol ? toStr(row[vendorCol]) : "",
    cgi: cgiCol ? toStr(row[cgiCol]) : "",
    extra,
  };
}

const SUMMARY_SHEET_NAMES = ["汇总"];

function parseSheetRows(
  rows: Record<string, unknown>[],
  seen: Set<string>,
  cells: CellSite[]
): void {
  if (!rows.length || !findColumn(rows[0], CELL_NAME_KEYS)) return;
  for (const row of rows) {
    const cell = rowToCell(row);
    if (!cell || seen.has(cell.id)) continue;
    seen.add(cell.id);
    cells.push(cell);
  }
}

function parseWorkbook(buffer: Buffer): CellSite[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const seen = new Set<string>();
  const cells: CellSite[] = [];

  // 工参模板常把本场站数据放在「汇总」，其它 sheet 为其它地市/场景样例
  const summarySheet = wb.SheetNames.find((n) =>
    SUMMARY_SHEET_NAMES.includes(n.trim())
  );
  if (summarySheet) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[summarySheet], {
      defval: "",
    }) as Record<string, unknown>[];
    parseSheetRows(rows, seen, cells);
    if (cells.length > 0) return cells;
  }

  for (const sheetName of wb.SheetNames) {
    if (sheetName === summarySheet) continue;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    }) as Record<string, unknown>[];
    parseSheetRows(rows, seen, cells);
  }

  return cells;
}

export async function parseGongcanFile(filePath: string): Promise<CellSite[]> {
  const buffer = await fs.readFile(filePath);
  return parseWorkbook(buffer);
}

export async function parseGongcanBatch(batchId: string): Promise<CellSite[]> {
  const dir = categoryDir(batchId, "gongcan");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const all: CellSite[] = [];
  const seen = new Set<string>();

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (![".xls", ".xlsx", ".csv"].includes(ext)) continue;
    const cells = await parseGongcanFile(path.join(dir, name));
    for (const c of cells) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
  }

  return all;
}
