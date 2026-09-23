# 预置演示批次

启动时若 `data/batches/<id>` 尚不存在，后端会把本目录下的批次复制过去。

当前包含：

| ID | 说明 |
|----|------|
| `demo-hangzhou-huanglong` | 杭州黄龙合成场景（已处理优化前/后结果） |

运行时上传仍写入 `data/batches/`（gitignore）。删除演示批次后，下次启动会重新灌入。
