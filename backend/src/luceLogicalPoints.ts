/**
 * 路测 CSV 逻辑采样点：每次出现主区行 = 一个时间点；
 * 紧随其后的同经纬度邻区行并入该点。
 */

export interface LogicalPointGroup {
  index: number;
  /** 首行 CSV 数据行序号（0-based，含无效行计数） */
  startDataRow: number;
  endDataRow: number;
  lon: number;
  lat: number;
  servingPci: number;
  rowCount: number;
}

export interface CsvLogicalPointIndex {
  logicalPointCount: number;
  groups: LogicalPointGroup[];
  /** 每个原始数据行序号 → 逻辑点下标，无则 -1 */
  dataRowToLogical: Int32Array;
  /** 仅含有效经纬度行的顺序号 → 逻辑点下标 */
  validRowToLogical: Int32Array;
  validRowCount: number;
  totalDataRows: number;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function findLonLatColumns(header: string[]): {
  lonIdx: number;
  latIdx: number;
  servingPciIdx: number;
  servingRsrpIdx: number;
  listedPciIdx: number;
  listedRsrpIdx: number;
  detectedPciIdx: number;
  detectedRsrpIdx: number;
} | null {
  let lonIdx = -1;
  let latIdx = -1;
  let servingPciIdx = -1;
  let servingRsrpIdx = -1;
  let listedPciIdx = -1;
  let listedRsrpIdx = -1;
  let detectedPciIdx = -1;
  let detectedRsrpIdx = -1;
  for (let i = 0; i < header.length; i++) {
    const h = header[i]!.trim().replace(/^\ufeff/, "");
    if (h === "Longitude") lonIdx = i;
    else if (h === "Latitude") latIdx = i;
    else if (h === "NR PCC Serving PCI") servingPciIdx = i;
    else if (h === "NR PCC Serving SS-RSRP(dBm)") servingRsrpIdx = i;
    else if (h === "NR Listed PCI") listedPciIdx = i;
    else if (h === "NR Listed SS-RSRP(dBm)") listedRsrpIdx = i;
    else if (h === "NR Detected PCI") detectedPciIdx = i;
    else if (h === "NR Detected SS-RSRP(dBm)") detectedRsrpIdx = i;
  }
  if (lonIdx < 0 || latIdx < 0) return null;
  return {
    lonIdx,
    latIdx,
    servingPciIdx,
    servingRsrpIdx,
    listedPciIdx,
    listedRsrpIdx,
    detectedPciIdx,
    detectedRsrpIdx,
  };
}

function hasValue(v: string | undefined): boolean {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "NA" && s !== "N/A";
}

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function isValidLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0);
}

function sameCoord(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  eps = 1e-7
): boolean {
  return Math.abs(a.lon - b.lon) < eps && Math.abs(a.lat - b.lat) < eps;
}

export function buildCsvLogicalPointIndex(lines: string[]): CsvLogicalPointIndex {
  if (lines.length === 0) {
    return {
      logicalPointCount: 0,
      groups: [],
      dataRowToLogical: new Int32Array(0),
      validRowToLogical: new Int32Array(0),
      validRowCount: 0,
      totalDataRows: 0,
    };
  }

  const header = splitCsvLine(lines[0]!);
  const cols = findLonLatColumns(header);
  if (!cols) {
    throw new Error("未找到 Longitude/Latitude 列");
  }

  const totalDataRows = lines.length - 1;
  const dataRowToLogical = new Int32Array(totalDataRows);
  dataRowToLogical.fill(-1);
  const validRowToLogical: number[] = [];

  const groups: LogicalPointGroup[] = [];
  let current: {
    index: number;
    startDataRow: number;
    lon: number;
    lat: number;
    servingPci: number;
    rowCount: number;
  } | null = null;

  const flush = (endDataRow: number) => {
    if (!current) return;
    groups.push({
      index: current.index,
      startDataRow: current.startDataRow,
      endDataRow,
      lon: current.lon,
      lat: current.lat,
      servingPci: current.servingPci,
      rowCount: current.rowCount,
    });
    current = null;
  };

  for (let li = 1; li < lines.length; li++) {
    const dataRow = li - 1;
    const rowCols = splitCsvLine(lines[li]!);
    if (rowCols.length <= Math.max(cols.lonIdx, cols.latIdx)) continue;

    const lon = num(rowCols[cols.lonIdx]);
    const lat = num(rowCols[cols.latIdx]);
    if (!isValidLonLat(lon, lat)) continue;

    const isServing =
      cols.servingPciIdx >= 0 &&
      cols.servingRsrpIdx >= 0 &&
      hasValue(rowCols[cols.servingPciIdx]) &&
      hasValue(rowCols[cols.servingRsrpIdx]) &&
      Number.isFinite(num(rowCols[cols.servingPciIdx]));

    const isNeighborOnly =
      !isServing &&
      ((cols.listedPciIdx >= 0 &&
        hasValue(rowCols[cols.listedPciIdx]) &&
        hasValue(rowCols[cols.listedRsrpIdx])) ||
        (cols.detectedPciIdx >= 0 &&
          hasValue(rowCols[cols.detectedPciIdx]) &&
          hasValue(rowCols[cols.detectedRsrpIdx])));

    if (isServing) {
      flush(dataRow - 1);
      const servingPci = num(rowCols[cols.servingPciIdx])!;
      current = {
        index: groups.length,
        startDataRow: dataRow,
        lon,
        lat,
        servingPci,
        rowCount: 1,
      };
      dataRowToLogical[dataRow] = current.index;
      validRowToLogical.push(current.index);
    } else if (isNeighborOnly && current && sameCoord(current, { lon, lat })) {
      current.rowCount++;
      dataRowToLogical[dataRow] = current.index;
      validRowToLogical.push(current.index);
    }
  }
  flush(totalDataRows - 1);

  return {
    logicalPointCount: groups.length,
    groups,
    dataRowToLogical,
    validRowToLogical: Int32Array.from(validRowToLogical),
    validRowCount: validRowToLogical.length,
    totalDataRows,
  };
}

export function buildCsvLogicalPointIndexFromBuffer(
  buffer: Buffer
): CsvLogicalPointIndex {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
  return buildCsvLogicalPointIndex(lines);
}
