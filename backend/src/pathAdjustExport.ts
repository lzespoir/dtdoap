import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { buildCsvLogicalPointIndexFromBuffer } from "./luceLogicalPoints.js";
import {
  coordOffsetKey,
  pathOffsetFromPatchesByPosition,
} from "./pathOffsetSpatial.js";
import type {
  ExportDebugReport,
  FilePathCorrection,
  RowOffsetDebug,
} from "./types/pathAdjustExport.js";

function offsetLonLat(
  lon: number,
  lat: number,
  eastM: number,
  northM: number
): { lon: number; lat: number } {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return {
    lon: lon + eastM / (mPerDegLat * cosLat),
    lat: lat + northM / mPerDegLat,
  };
}

function distanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mPerDegLat * cosLat;
  const dy = (lat2 - lat1) * mPerDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function sampleIndexForCsvRow(
  sampleCount: number,
  rowIndex: number,
  dataRowCount: number
): number {
  return Math.round(
    exactIndexForProportion(proportionForIndex(rowIndex, dataRowCount), sampleCount)
  );
}

function segmentKeyForCsvRow(
  timeline: FilePathCorrection["segmentTimeline"],
  rowIndex: number,
  dataRowCount: number
): string | null {
  if (!timeline || timeline.pathSegmentKeys.length === 0) return null;
  const { pathSegmentKeys } = timeline;
  if (dataRowCount <= 1) return pathSegmentKeys[0] ?? null;
  const pathIdx = Math.round(
    exactIndexForProportion(
      proportionForIndex(rowIndex, dataRowCount),
      pathSegmentKeys.length
    )
  );
  return pathSegmentKeys[pathIdx] ?? null;
}

function proportionForIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(1, index / (count - 1)));
}

function exactIndexForProportion(
  proportion: number,
  targetCount: number
): number {
  if (targetCount <= 1) return 0;
  const t = Math.max(0, Math.min(1, proportion));
  return t * (targetCount - 1);
}

function lerpOffset(
  a: { east: number; north: number },
  b: { east: number; north: number },
  frac: number
): { east: number; north: number } {
  return {
    east: a.east + (b.east - a.east) * frac,
    north: a.north + (b.north - a.north) * frac,
  };
}

function pathOffsetFromPatchesInterpolated(
  patches: FilePathCorrection["patches"],
  exactPathIdx: number,
  pathPointCount: number
): {
  east: number;
  north: number;
  exactPathIdx: number;
  matchedPathPatches: RowOffsetDebug["matchedPathPatches"];
} {
  if (pathPointCount <= 1) {
    const p = patches.find((x) => x.kind === "path" && x.pointIndex === 0);
    return {
      east: p?.dEast ?? 0,
      north: p?.dNorth ?? 0,
      exactPathIdx: 0,
      matchedPathPatches: p
        ? [
            {
              pointIndex: 0,
              dEast: p.dEast,
              dNorth: p.dNorth,
              segmentKey: p.segmentKey,
            },
          ]
        : [],
    };
  }
  const idx = Math.max(0, Math.min(pathPointCount - 1, exactPathIdx));
  const i0 = Math.floor(idx);
  const i1 = Math.min(pathPointCount - 1, i0 + 1);
  const frac = idx - i0;

  const offsetAt = (pointIndex: number) => {
    const p = patches.find(
      (x) => x.kind === "path" && x.pointIndex === pointIndex
    );
    return { east: p?.dEast ?? 0, north: p?.dNorth ?? 0, patch: p };
  };

  const o0 = offsetAt(i0);
  const o1 = offsetAt(i1);
  const blended = lerpOffset(o0, o1, frac);
  const matchedPathPatches: RowOffsetDebug["matchedPathPatches"] = [];
  if (o0.patch && frac < 1) {
    matchedPathPatches.push({
      pointIndex: i0,
      dEast: o0.patch.dEast,
      dNorth: o0.patch.dNorth,
      segmentKey: o0.patch.segmentKey,
    });
  }
  if (o1.patch && frac > 0 && i1 !== i0) {
    matchedPathPatches.push({
      pointIndex: i1,
      dEast: o1.patch.dEast,
      dNorth: o1.patch.dNorth,
      segmentKey: o1.patch.segmentKey,
    });
  }

  return {
    east: blended.east,
    north: blended.north,
    exactPathIdx: idx,
    matchedPathPatches,
  };
}

function rowExtraOffsetDetailed(
  correction: FilePathCorrection,
  logicalPointIndex: number,
  logicalPointCount: number,
  lon: number,
  lat: number,
  coordCache: Map<
    string,
    ReturnType<typeof pathOffsetFromPatchesByPosition>
  >
): {
  east: number;
  north: number;
  sampleIdx: number;
  rowSeg: string | null;
  sampleDirectEast: number;
  sampleDirectNorth: number;
  pathMappedEast: number;
  pathMappedNorth: number;
  pathMappedIndex: number;
  matchedPathPatches: RowOffsetDebug["matchedPathPatches"];
} {
  const timeline = correction.segmentTimeline;
  if (!timeline) {
    return {
      east: 0,
      north: 0,
      sampleIdx: 0,
      rowSeg: null,
      sampleDirectEast: 0,
      sampleDirectNorth: 0,
      pathMappedEast: 0,
      pathMappedNorth: 0,
      pathMappedIndex: 0,
      matchedPathPatches: [],
    };
  }

  const rowSeg = segmentKeyForCsvRow(
    timeline,
    logicalPointIndex,
    logicalPointCount
  );
  const previewCount =
    timeline.previewSampleCount ?? timeline.sampleCount;
  const sampleIdx = sampleIndexForCsvRow(
    previewCount,
    logicalPointIndex,
    logicalPointCount
  );

  let sampleDirectEast = 0;
  let sampleDirectNorth = 0;

  const logicalPatch = correction.patches.find(
    (p) => p.kind === "sample" && p.pointIndex === logicalPointIndex
  );
  if (logicalPatch) {
    sampleDirectEast = logicalPatch.dEast;
    sampleDirectNorth = logicalPatch.dNorth;
  } else {
    for (const p of correction.patches) {
      if (p.kind === "sample" && p.pointIndex === sampleIdx) {
        sampleDirectEast += p.dEast;
        sampleDirectNorth += p.dNorth;
      }
    }
  }

  const coordKey = coordOffsetKey(lon, lat);
  let pathOff = coordCache.get(coordKey);
  if (!pathOff) {
    pathOff = pathOffsetFromPatchesByPosition(correction.patches, lon, lat);
    coordCache.set(coordKey, pathOff);
  }

  return {
    east: sampleDirectEast + pathOff.east,
    north: sampleDirectNorth + pathOff.north,
    sampleIdx,
    rowSeg,
    sampleDirectEast,
    sampleDirectNorth,
    pathMappedEast: pathOff.east,
    pathMappedNorth: pathOff.north,
    pathMappedIndex: pathOff.matchedPathPatches[0]?.pointIndex ?? -1,
    matchedPathPatches: pathOff.matchedPathPatches.map((p) => ({
      pointIndex: p.pointIndex,
      dEast: p.dEast,
      dNorth: p.dNorth,
      segmentKey: p.segmentKey,
    })),
  };
}

function isValidLonLat(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    !(lon === 0 && lat === 0)
  );
}

function findLonLatColumns(header: string[]): {
  lonIdx: number;
  latIdx: number;
} | null {
  let lonIdx = -1;
  let latIdx = -1;
  for (let i = 0; i < header.length; i++) {
    const h = header[i].trim();
    if (h === "Longitude") lonIdx = i;
    else if (h === "Latitude") latIdx = i;
  }
  if (lonIdx < 0 || latIdx < 0) return null;
  return { lonIdx, latIdx };
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

function shouldSampleRow(rowIndex: number, dataRowCount: number): boolean {
  if (dataRowCount <= 1) return rowIndex === 0;
  const marks = new Set([
    0,
    Math.floor(dataRowCount * 0.25),
    Math.floor(dataRowCount * 0.5),
    Math.floor(dataRowCount * 0.75),
    dataRowCount - 1,
  ]);
  return marks.has(rowIndex);
}

function logExportDebug(report: ExportDebugReport): void {
  console.log(
    `[path-adjust-export] ${report.fileName}`,
    JSON.stringify(
      {
        dataRowCount: report.dataRowCount,
        logicalPointCount: report.dataRowCount,
        validCoordRows: report.validCoordRows,
        sampleCount: report.sampleCount,
        pathSegmentKeyCount: report.pathSegmentKeyCount,
        patchCount: report.patchCount,
        pathPatchCount: report.pathPatchCount,
        samplePatchCount: report.samplePatchCount,
        layerOffset: {
          east: report.layerOffsetEast,
          north: report.layerOffsetNorth,
        },
        rowsWithShiftOver10m: report.rowsWithShiftOver10m,
        rowsWithShiftOver50m: report.rowsWithShiftOver50m,
        rowsWithShiftOver100m: report.rowsWithShiftOver100m,
        maxShiftRow: report.maxShiftRow,
        sampledRows: report.sampledRows,
      },
      null,
      2
    )
  );
}

export async function applyCorrectionToCsv(
  buffer: Buffer,
  correction: FilePathCorrection
): Promise<{ buffer: Buffer; debug: ExportDebugReport }> {
  const rawLines: string[] = [];
  const rl = createInterface({
    input: Readable.from(buffer),
    crlfDelay: Infinity,
  });
  for await (const raw of rl) {
    rawLines.push(raw.replace(/\r$/, ""));
  }
  if (rawLines.length === 0) {
    return {
      buffer,
      debug: {
        fileName: correction.fileName,
        dataRowCount: 0,
        sampleCount: correction.segmentTimeline?.sampleCount ?? 0,
        pathSegmentKeyCount:
          correction.segmentTimeline?.pathSegmentKeys.length ?? 0,
        patchCount: correction.patches.length,
        pathPatchCount: correction.patches.filter((p) => p.kind === "path")
          .length,
        samplePatchCount: correction.patches.filter((p) => p.kind === "sample")
          .length,
        layerOffsetEast: correction.offsetEastMeters,
        layerOffsetNorth: correction.offsetNorthMeters,
        sampledRows: [],
        maxShiftRow: null,
        rowsWithShiftOver10m: 0,
        rowsWithShiftOver50m: 0,
        rowsWithShiftOver100m: 0,
      },
    };
  }

  const header = splitCsvLine(rawLines[0]!);
  const cols = findLonLatColumns(header);
  if (!cols) {
    throw new Error(
      `${correction.fileName}：未找到 Longitude/Latitude 列，无法导出`
    );
  }
  const { lonIdx, latIdx } = cols;
  const logical = buildCsvLogicalPointIndexFromBuffer(buffer);

  const lines: string[] = [rawLines[0]!];
  const coordCache = new Map<
    string,
    ReturnType<typeof pathOffsetFromPatchesByPosition>
  >();
  const sampledRows: RowOffsetDebug[] = [];
  let maxShiftRow: RowOffsetDebug | null = null;
  let rowsWithShiftOver10m = 0;
  let rowsWithShiftOver50m = 0;
  let rowsWithShiftOver100m = 0;

  for (let li = 1; li < rawLines.length; li++) {
    const line = rawLines[li]!;
    const dataRow = li - 1;
    const rowCols = splitCsvLine(line);

    if (rowCols.length <= Math.max(lonIdx, latIdx)) {
      lines.push(line);
      continue;
    }

    const lon = Number(rowCols[lonIdx]);
    const lat = Number(rowCols[latIdx]);
    if (!isValidLonLat(lon, lat)) {
      lines.push(line);
      continue;
    }

    const logicalIdx = logical.dataRowToLogical[dataRow] ?? -1;
    const patch =
      logicalIdx >= 0
        ? rowExtraOffsetDetailed(
            correction,
            logicalIdx,
            logical.logicalPointCount,
            lon,
            lat,
            coordCache
          )
        : {
            east: 0,
            north: 0,
            sampleIdx: -1,
            rowSeg: null,
            sampleDirectEast: 0,
            sampleDirectNorth: 0,
            pathMappedEast: 0,
            pathMappedNorth: 0,
            pathMappedIndex: 0,
            matchedPathPatches: [],
          };
    const totalEast = correction.offsetEastMeters + patch.east;
    const totalNorth = correction.offsetNorthMeters + patch.north;
    const next = offsetLonLat(lon, lat, totalEast, totalNorth);
    const shiftMeters = distanceMeters(lon, lat, next.lon, next.lat);

    if (shiftMeters > 10) rowsWithShiftOver10m++;
    if (shiftMeters > 50) rowsWithShiftOver50m++;
    if (shiftMeters > 100) rowsWithShiftOver100m++;

    const rowDebug: RowOffsetDebug = {
      rowIndex: logicalIdx >= 0 ? logicalIdx : dataRow,
      lon,
      lat,
      sampleIdx: patch.sampleIdx,
      rowSeg: patch.rowSeg,
      layerEast: correction.offsetEastMeters,
      layerNorth: correction.offsetNorthMeters,
      patchEast: patch.east,
      patchNorth: patch.north,
      totalEast,
      totalNorth,
      shiftMeters,
      outLon: next.lon,
      outLat: next.lat,
      sampleDirectEast: patch.sampleDirectEast,
      sampleDirectNorth: patch.sampleDirectNorth,
      pathMappedEast: patch.pathMappedEast,
      pathMappedNorth: patch.pathMappedNorth,
      pathMappedIndex: patch.pathMappedIndex,
      matchedPathPatchCount: patch.matchedPathPatches.length,
      matchedPathPatches: patch.matchedPathPatches,
    };

    if (!maxShiftRow || shiftMeters > maxShiftRow.shiftMeters) {
      maxShiftRow = rowDebug;
    }
    if (
      (logicalIdx >= 0 &&
        shouldSampleRow(logicalIdx, logical.logicalPointCount)) ||
      shiftMeters > 50 ||
      patch.matchedPathPatches.length >= 2
    ) {
      sampledRows.push(rowDebug);
    }

    rowCols[lonIdx] = String(next.lon);
    rowCols[latIdx] = String(next.lat);
    lines.push(rowCols.join(","));
  }

  const debug: ExportDebugReport = {
    fileName: correction.fileName,
    dataRowCount: logical.logicalPointCount,
    validCoordRows: logical.validRowCount,
    sampleCount: correction.segmentTimeline?.sampleCount ?? 0,
    pathSegmentKeyCount:
      correction.segmentTimeline?.pathSegmentKeys.length ?? 0,
    patchCount: correction.patches.length,
    pathPatchCount: correction.patches.filter((p) => p.kind === "path").length,
    samplePatchCount: correction.patches.filter((p) => p.kind === "sample")
      .length,
    layerOffsetEast: correction.offsetEastMeters,
    layerOffsetNorth: correction.offsetNorthMeters,
    sampledRows,
    maxShiftRow,
    rowsWithShiftOver10m,
    rowsWithShiftOver50m,
    rowsWithShiftOver100m,
  };

  logExportDebug(debug);

  return {
    buffer: Buffer.from(lines.join("\n"), "utf-8"),
    debug,
  };
}
