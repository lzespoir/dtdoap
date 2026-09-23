import fs from "node:fs/promises";
import path from "node:path";
import { batchDir } from "./batchStorage.js";
import type { CellSite } from "./gongcanParser.js";

const CELLS_FILE = "cells.json";

export function cellsPath(batchId: string): string {
  return path.join(batchDir(batchId), CELLS_FILE);
}

export async function saveCells(
  batchId: string,
  cells: CellSite[]
): Promise<void> {
  await fs.writeFile(
    cellsPath(batchId),
    JSON.stringify({ cells, parsedAt: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

export async function loadCells(batchId: string): Promise<CellSite[] | null> {
  try {
    const raw = await fs.readFile(cellsPath(batchId), "utf-8");
    const data = JSON.parse(raw) as { cells: CellSite[] };
    return data.cells ?? [];
  } catch {
    return null;
  }
}
