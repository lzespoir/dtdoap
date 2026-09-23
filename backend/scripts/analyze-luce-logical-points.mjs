#!/usr/bin/env node
/**
 * 分析路测 CSV 主区/邻区行结构，按「主区+同经纬度邻区=一个逻辑点」分组。
 *
 * 规则：
 * - 出现主区行（NR PCC Serving PCI 有效）时，若经纬度或主区 PCI 变化 → 新逻辑点
 * - 同一位置静止时：主区-邻区-邻区-主区… 每遇到新的主区行开启新逻辑点（同位置同 PCI 也新开）
 * - 邻区行（仅有 Listed/Detected）并入当前逻辑点（需同经纬度）
 */
import fs from "node:fs";
import readline from "node:readline";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("用法: node analyze-luce-logical-points.mjs <csv>");
  process.exit(1);
}

function splitCsvLine(line) {
  const out = [];
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

function colIndex(header, name) {
  const i = header.findIndex((h) => h.trim().replace(/^\ufeff/, "") === name);
  return i;
}

function hasValue(v) {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "NA" && s !== "N/A";
}

function num(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function sameCoord(a, b, eps = 1e-7) {
  return Math.abs(a.lon - b.lon) < eps && Math.abs(a.lat - b.lat) < eps;
}

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let header = null;
  let idx = {
    time: -1,
    lon: -1,
    lat: -1,
    servingPci: -1,
    servingRsrp: -1,
    listedPci: -1,
    listedRsrp: -1,
    detectedPci: -1,
    detectedRsrp: -1,
  };

  let totalRows = 0;
  let validCoordRows = 0;
  let servingRows = 0;
  let neighborOnlyRows = 0;
  let otherRows = 0;

  /** @type {Array<{startRow:number,endRow:number,lon:number,lat:number,servingPci:number,rowCount:number,servingCount:number,neighborCount:number,time:string}>} */
  const logicalPoints = [];
  /** @type {null | {startRow:number,lon:number,lat:number,servingPci:number,servingCount:number,neighborCount:number,rowCount:number,time:string,lastServingRow:number}} */
  let current = null;

  let prevServing = null;
  let cycleExamples = [];

  for await (const raw of rl) {
    const line = raw.replace(/\r$/, "");
    if (!header) {
      header = splitCsvLine(line);
      idx.time = colIndex(header, "Date & Time");
      idx.lon = colIndex(header, "Longitude");
      idx.lat = colIndex(header, "Latitude");
      idx.servingPci = colIndex(header, "NR PCC Serving PCI");
      idx.servingRsrp = colIndex(header, "NR PCC Serving SS-RSRP(dBm)");
      idx.listedPci = colIndex(header, "NR Listed PCI");
      idx.listedRsrp = colIndex(header, "NR Listed SS-RSRP(dBm)");
      idx.detectedPci = colIndex(header, "NR Detected PCI");
      idx.detectedRsrp = colIndex(header, "NR Detected SS-RSRP(dBm)");
      continue;
    }

    totalRows++;
    const cols = splitCsvLine(line);
    const lon = num(cols[idx.lon]);
    const lat = num(cols[idx.lat]);
    const time = idx.time >= 0 ? String(cols[idx.time] ?? "").trim() : "";

    if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) {
      continue;
    }
    validCoordRows++;

    const servingPciRaw = cols[idx.servingPci];
    const servingRsrpRaw = cols[idx.servingRsrp];
    const isServing =
      hasValue(servingPciRaw) &&
      hasValue(servingRsrpRaw) &&
      Number.isFinite(num(servingPciRaw));

    const hasListed =
      hasValue(cols[idx.listedPci]) && hasValue(cols[idx.listedRsrp]);
    const hasDetected =
      hasValue(cols[idx.detectedPci]) && hasValue(cols[idx.detectedRsrp]);
    const isNeighborOnly = !isServing && (hasListed || hasDetected);

    if (isServing) {
      servingRows++;
      const servingPci = num(servingPciRaw);
      const coord = { lon, lat };

      const posOrPciChanged =
        !prevServing ||
        !sameCoord(prevServing, coord) ||
        prevServing.servingPci !== servingPci;

      // 再次出现主区行 → 新逻辑点（同位置同 PCI 的周期性测量也分开）
      if (current) {
        logicalPoints.push({
          startRow: current.startRow,
          endRow: totalRows - 1,
          lon: current.lon,
          lat: current.lat,
          servingPci: current.servingPci,
          rowCount: current.rowCount,
          servingCount: current.servingCount,
          neighborCount: current.neighborCount,
          time: current.time,
        });
        current = null;
      }

      current = {
        startRow: totalRows,
        lon,
        lat,
        servingPci,
        servingCount: 1,
        neighborCount: 0,
        rowCount: 1,
        time,
        lastServingRow: totalRows,
      };
      prevServing = { lon, lat, servingPci };

      if (cycleExamples.length < 5 && logicalPoints.length > 0) {
        const last = logicalPoints[logicalPoints.length - 1];
        if (last.rowCount > 1 && sameCoord(last, coord) && last.servingPci === servingPci) {
          cycleExamples.push({
            prevPoint: last,
            newServingRow: totalRows,
            time,
          });
        }
      }
    } else if (isNeighborOnly) {
      neighborOnlyRows++;
      if (current && sameCoord(current, { lon, lat })) {
        current.neighborCount++;
        current.rowCount++;
      }
    } else {
      otherRows++;
    }
  }

  if (current) {
    logicalPoints.push({
      startRow: current.startRow,
      endRow: totalRows,
      lon: current.lon,
      lat: current.lat,
      servingPci: current.servingPci,
      rowCount: current.rowCount,
      servingCount: current.servingCount,
      neighborCount: current.neighborCount,
      time: current.time,
    });
  }

  const rowsPerPoint = logicalPoints.map((p) => p.rowCount);
  const neighborPerPoint = logicalPoints.map((p) => p.neighborCount);
  const avgRows =
    rowsPerPoint.reduce((a, b) => a + b, 0) / Math.max(1, logicalPoints.length);

  const dist = { "1": 0, "2": 0, "3": 0, "4-5": 0, "6+": 0 };
  for (const n of rowsPerPoint) {
    if (n === 1) dist["1"]++;
    else if (n === 2) dist["2"]++;
    else if (n === 3) dist["3"]++;
    else if (n <= 5) dist["4-5"]++;
    else dist["6+"]++;
  }

  const uniqueCoords = new Set(
    logicalPoints.map((p) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)}`)
  );

  console.log(JSON.stringify({
    file: csvPath.split("/").pop(),
    totalCsvRows: totalRows,
    validCoordRows,
    servingRows,
    neighborOnlyRows,
    otherRows,
    logicalPointCount: logicalPoints.length,
    uniqueLogicalCoords: uniqueCoords.size,
    avgRowsPerLogicalPoint: Number(avgRows.toFixed(2)),
    rowsPerPointDistribution: dist,
    avgNeighborsPerPoint: Number(
      (neighborPerPoint.reduce((a, b) => a + b, 0) / Math.max(1, logicalPoints.length)).toFixed(2)
    ),
    compressionRatio: Number((validCoordRows / Math.max(1, logicalPoints.length)).toFixed(2)),
    sampleLogicalPoints: logicalPoints.slice(0, 8),
    stationaryCycleExamples: cycleExamples.slice(0, 3),
    midSample: logicalPoints.slice(
      Math.floor(logicalPoints.length / 2),
      Math.floor(logicalPoints.length / 2) + 3
    ),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
