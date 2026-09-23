# 杭州黄龙体育中心合成场景

本目录为**合成测试数据**，仅用于平台联调与演示。

- 省份/城市：浙江 · 杭州（黄龙体育中心附近公开坐标近似中心）
- 字段格式：Keysight 路测 CSV + 工参 CSV（平台已支持列名）
- **不含**真实路测或真实工参；真实数据请继续放在已 gitignore 的 `data/sample/`

## 文件

- `gongcan/hangzhou_huanglong_gongcan.csv`
- `before/hangzhou_huanglong_before_MS1.csv`
- `after/hangzhou_huanglong_after_MS1.csv`
- `scene.json`：推荐区域过滤与关注小区组设置

## 使用

1. 主界面上传工参 + 优化前 CSV，再上传优化后 CSV
2. 在设置中按 `scene.json` 写入中心坐标、半径与关注 PCI
3. 或将环境变量 / 默认样例目录指向本目录的 before/after

