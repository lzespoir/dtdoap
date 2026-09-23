# 覆盖优化计算逻辑核查说明

本文用于人工核对当前系统的“路测处理 -> 栅格聚合 -> 优化对比 -> 可视化分布”计算过程。
不涉及 UI 展示细节，仅说明数据如何得到。

## 1. 输入与主数据文件

- 批次目录：`data/batches/<batchId>/`
- 关键结果文件：
  - `luce-result.json`（优化前）
  - `luce-result-after.json`（优化后）
- 关键设置文件：
  - `luce-settings.json`

处理入口与对比入口：

- 路测处理：`backend/src/luceProcessor.ts` `processLuceBatch()`
- 优化对比：`backend/src/optimize.ts` `computeCompare()`
- API：`GET /api/batches/:batchId/optimize/compare`

## 2. 路测统计（样本级）

在 `summarize()` / `statsForSamples()` 中：

- RSRP 指标基于 `serving` 样本：
  - 平均、min/max、p10/p50/p90
  - 覆盖率：`>= -90/-95/-100/-105/-110`
  - `weak`：`< -110`
  - 区间分布：
    - `rangeExcellent`: `>= -80`
    - `rangeGood`: `[-90, -80)`
    - `rangeMedium`: `[-100, -90)`
    - `rangeWeak`: `[-110, -100)`
- SINR 指标只对“有有效 SINR 值”的样本计算：
  - 平均、p50
  - 覆盖率：`>= 10/5/0/-5`
  - `sinrWeak`: `< -5`
  - 区间分布：
    - `sinrRangeExcellent`: `>= 10`
    - `sinrRangeGood`: `[5, 10)`
    - `sinrRangeMedium`: `[0, 5)`
    - `sinrRangeWeak`: `[-5, 0)`

## 3. 栅格化逻辑（Grid）

来源：`buildGrid()`（`backend/src/luceProcessor.ts`）。

### 3.1 栅格键计算

**global（全球 floor，默认）**：同一 WGS84 + 相同边长 + 相同 `regionCenterLat`（作 cos 参考纬）→ 同一 `(gx,gy)`；与数据集无关。

- `mPerDegLat = 111320`，`cosRef = cos(regionCenterLat)`
- `gy = floor(lat * mPerDegLat / gridSizeMeters)`
- `gx = floor(lon * cosRef * mPerDegLat / gridSizeMeters)`
- 栅格键：`"${gx},${gy}"`

**dataset（Notebook 对齐）**：相对 `gridRefLon/Lat`（数据集中位原点），见 `gridUtils.ts`。

### 3.2 每格主 PCI 选择

- 每个栅格先按 PCI 累加：
  - `rsrpSum`, `sinrSum`, `sinrCount`, `count`
- 主 PCI 选择规则：
  1. 选 `count` 最大的 PCI
  2. 若并列，优先命中 `preferredPcis`（当前来自 `servingPciFilter`）

### 3.3 每格代表值

- `rsrp = rsrpSum / count`（主 PCI 下）
- `sinr = sinrSum / sinrCount`（主 PCI 下；若 `sinrCount=0` -> `NaN`）
- `count = 主PCI样本数`
- 还包含栅格几何边界 `west/south/east/north` 与中心点经纬度

结论：每个栅格最终只有一组代表值 `(rsrp, sinr, pci, count)`。

## 4. 对比口径（gridMatchMode）

入口：`computeCompare(batchId, targetPcis, gridMatchMode)`

- 可选：
  - `default`
  - `before`
  - `after`
  - `intersection`

当 `gridMatchMode != default` 且前后都存在 `grid` 时，走“栅格口径对齐”：

1. 先建立前后栅格键集合（统一使用 `settings.regionCenterLat` 作为 refLat 计算 key）
2. 生成 `allowedKeys`：
   - `before`：前网格集合
   - `after`：后网格集合
   - `intersection`：前后交集
3. 过滤得到 `filteredBefore` / `filteredAfter`
4. 覆盖指标基于过滤后的栅格重算：`statsFromGridCells()`

当 `default` 或无法走栅格匹配时：

- 总体指标优先来自 `coverage`，必要时回退样本计算。

## 5. 网格改善统计（gridDelta）

`computeGridDelta()` 仅对“键相同栅格”比较：

- `d = after.rsrp - before.rsrp`
- `d > 0.5` -> improved
- `d < -0.5` -> degraded
- 其余 -> unchanged

## 6. 强度分布直方图（RSRP/SINR）

### 6.1 统计对象

当前逻辑优先按栅格代表值统计：

- 若能拿到前后 `grid`，则用 `cellsToMetricPoints()`：
  - 每个栅格贡献 1 个点（`count = 1`）
  - 值为该格代表值 `rsrp` 或 `sinr`
- 否则才回退样本点（每样本 `count = 1`）

`histogramByGrid` 会标记是否走了栅格统计。

### 6.2 分箱

`buildMetricHistogram()`：

- RSRP：`binSize = 2 dBm`
- SINR：`binSize = 1 dB`
- `start = floor(min / binSize) * binSize`
- `end = ceil(max / binSize) * binSize`（若与 start 相等则扩 1 个 bin）
- 每点按值映射到 bin（超边界会被 clamp）
- 输出每个 bin 的：
  - `from`, `to`
  - `beforeCount`, `afterCount`

## 7. 前端图表口径

前端 `OptimizationPanel`：

- 强度分布曲线读取 `compare.rsrpHistogram` / `compare.sinrHistogram`
- 纵轴当前为计数（对应 `beforeCount/afterCount`）
- 当 `histogramByGrid=true`，提示“按栅格聚合统计”

## 8. 你应重点核对的点

1. **栅格代表值是否符合预期**
   - 主 PCI 选择是否合理（特别是并列 tie）
2. **对比口径是否正确**
   - 默认是否是 `intersection`
   - `gridMatchInfo.matchedGridCount` 是否符合预期
3. **直方图是否按栅格而非采样点**
   - `histogramByGrid` 是否为 `true`
4. **SINR 空值处理**
   - 栅格 `sinr=NaN` 是否应纳入/剔除（当前剔除）

---

如果你要逐步验算，建议配合 `tools/verify_compare_metrics.py` 输出中间结果（键集合、过滤后栅格数、bin 明细、前后计数总和）。
