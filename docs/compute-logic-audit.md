# 覆盖对比计算逻辑说明

说明路测处理、栅格聚合、优化对比与强度分布的计算口径。不含 UI 布局细节。

## 1. 输入与结果文件

批次目录：`data/batches/<batchId>/`

| 文件 | 说明 |
|------|------|
| `luce-result.json` | 优化前处理结果 |
| `luce-result-after.json` | 优化后处理结果 |
| `luce-settings.json` | 批次设置 |

相关代码：

- 路测处理：`backend/src/luceProcessor.ts` → `processLuceBatch()`
- 优化对比：`backend/src/optimize.ts` → `computeCompare()`
- API：`GET /api/batches/:batchId/optimize/compare`

## 2. 路测统计（样本级）

实现：`summarize()` / `statsForSamples()`。

### RSRP（`serving` 样本）

- 均值、min / max、p10 / p50 / p90
- 覆盖率阈值：`>= -90 / -95 / -100 / -105 / -110`
- `weak`：`< -110`
- 区间分布：
  - `rangeExcellent`：`>= -80`
  - `rangeGood`：`[-90, -80)`
  - `rangeMedium`：`[-100, -90)`
  - `rangeWeak`：`[-110, -100)`

### SINR（仅有效 SINR 样本）

- 均值、p50
- 覆盖率阈值：`>= 10 / 5 / 0 / -5`
- `sinrWeak`：`< -5`
- 区间分布：
  - `sinrRangeExcellent`：`>= 10`
  - `sinrRangeGood`：`[5, 10)`
  - `sinrRangeMedium`：`[0, 5)`
  - `sinrRangeWeak`：`[-5, 0)`

## 3. 栅格化

实现：`buildGrid()`（`backend/src/luceProcessor.ts`）。

### 3.1 栅格键

**global（默认）**：同一 WGS84、相同边长与 `regionCenterLat`（经度米制参考纬）→ 同一 `(gx, gy)`。

- `mPerDegLat = 111320`，`cosRef = cos(regionCenterLat)`
- `gy = floor(lat * mPerDegLat / gridSizeMeters)`
- `gx = floor(lon * cosRef * mPerDegLat / gridSizeMeters)`
- 键：`"${gx},${gy}"`

**dataset**：相对 `gridRefLon` / `gridRefLat`（数据集原点），见 `gridUtils.ts`。

### 3.2 格内主 PCI

格内按 PCI 累计 `rsrpSum`、`sinrSum`、`sinrCount`、`count`。主 PCI：

1. `count` 最大
2. 并列时优先命中 `preferredPcis`（来自 `servingPciFilter`）

### 3.3 格代表值

- `rsrp = rsrpSum / count`（主 PCI）
- `sinr = sinrSum / sinrCount`（主 PCI；`sinrCount = 0` 时为 `NaN`，统计时剔除）
- `count`：主 PCI 样本数
- 另含边界 `west/south/east/north` 与中心经纬度

每个栅格输出一组 `(rsrp, sinr, pci, count)`。

另有聚合模式 `all_points_mean`（格内全点均值），与 Notebook 对齐时使用；默认 `dominant_pci`。

## 4. 对比口径（gridMatchMode）

入口：`computeCompare(batchId, targetPcis, gridMatchMode)`。

可选：`default` | `before` | `after` | `intersection`。

当 `gridMatchMode ≠ default` 且前后均有 `grid` 时：

1. 用当前设置计算前后栅格键集合
2. 生成 `allowedKeys`：
   - `before`：优化前键集
   - `after`：优化后键集
   - `intersection`：交集
3. 过滤得到参与对比的栅格
4. 覆盖指标由 `statsFromGridCells()` 基于过滤结果重算

`default` 或不具备栅格匹配条件时：总体指标优先取 `coverage`，必要时回退样本统计。

前端默认对比口径为 `intersection`。

## 5. 栅格改善统计（gridDelta）

`computeGridDelta()` 仅比较键相同的栅格：

- `d = after.rsrp - before.rsrp`
- `d > 0.5`：improved
- `d < -0.5`：degraded
- 其余：unchanged

## 6. 强度分布直方图

### 6.1 统计对象

优先使用栅格代表值：

- 存在前后 `grid` 时：`cellsToMetricPoints()`，每格计 1（`count = 1`）
- 否则回退样本点，每样本计 1

`histogramByGrid` 标识是否按栅格统计。

另：优质栅格比例使用设置中的 `qualityRsrpThresholdDb` / `qualitySinrThresholdDb`（默认 -85 dBm / 0 dB），对参与对比的指标点做 `value >= 阈值` 占比。

### 6.2 分箱

`buildMetricHistogram()`：

- RSRP：`binSize = 2 dBm`
- SINR：`binSize = 1 dB`
- `start = floor(min / binSize) * binSize`
- `end = ceil(max / binSize) * binSize`（与 start 相等时扩展一个 bin）
- 超出范围的点 clamp 到边界 bin
- 每个 bin 输出 `from`、`to`、`beforeCount`、`afterCount`

## 7. 前端展示口径

`OptimizationPanel`：

- 强度分布读取 `compare.rsrpHistogram` / `compare.sinrHistogram`
- 纵轴为计数（`beforeCount` / `afterCount`）
- `histogramByGrid = true` 时提示按栅格聚合

关注小区组（`comparisonTargetPcis`）仅用于主服务占比与按 PCI 拆分，不改变整体 KPI 的栅格统计范围。

## 8. 口径核对要点

| 项 | 说明 |
|----|------|
| 栅格代表值 | 主 PCI 选择及并列时的 `preferredPcis` 规则 |
| 对比口径 | 前端默认 `intersection`；核对 `gridMatchInfo.matchedGridCount` |
| 直方图 | `histogramByGrid` 是否为 true（按栅格而非采样点） |
| SINR 空值 | 栅格 `sinr = NaN` 不计入 SINR 相关统计 |

验算脚本：`tools/verify_compare_metrics.py`（可输出键集合、过滤后栅格数、分箱与前后计数）。
