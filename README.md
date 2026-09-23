# DTDOAP

**DTDOAP**（DriveTest Data Optimization and Analysis Platform）  
**路测数据优化分析平台**

支持工参与路测数据上传、路测栅格化处理、优化前后对比，并在 Cesium 三维地图上可视化 RSRP / SINR / PCI 分布。

## 功能概览

- **批次管理**：上传工参（xlsx/csv）与路测（csv），按批次组织数据
- **路测处理**：AWK 脚本提取与过滤路测样本，栅格聚合 RSRP / SINR
- **覆盖优化**：生成优化建议、处理优化后路测，对比优化前后指标
- **三维可视化**：Cesium 地图展示栅格热力、路测轨迹、小区工参与体育场 3D 模型

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、Vite、Cesium、TypeScript |
| 后端 | Node.js、Express、TypeScript |
| 脚本 | AWK、Python 3 |

## 环境要求

- Node.js 18+
- npm
- Python 3（优化建议脚本）
- bash、awk、sort（路测数据处理）

## 快速开始

```bash
# 克隆仓库
git clone git@github.com:lzespoir/dtdoap.git
cd dtdoap

# 安装依赖（根目录 + 前后端）
npm install
npm install --prefix backend
npm install --prefix frontend

# 同时启动前后端开发服务
npm run dev
```

启动后访问：

- 前端：<http://localhost:5174>
- 后端 API：<http://localhost:3001/api/health>

也可分别启动：

```bash
npm run dev:backend   # http://localhost:3001
npm run dev:frontend  # http://localhost:5174
```

## 本地数据准备

以下内容不在 Git 仓库中，克隆后需自行放置：

### 合成测试数据（已入库，推荐）

仓库自带浙江杭州合成场景：

- 工参：`data/synthetic/hangzhou-huanglong/gongcan/`
- 优化前路测：`data/synthetic/hangzhou-huanglong/before/`
- 优化后路测：`data/synthetic/hangzhou-huanglong/after/`
- 推荐设置：`data/synthetic/hangzhou-huanglong/scene.json`

重新生成：

```bash
python3 tools/generate_synthetic_drive_test.py
```

### 真实路测样例（本地，禁止提交）

将真实 CSV 放到 `data/sample/`（已 gitignore）。无上传优化后数据时，也可通过环境变量指向本地目录：

```bash
export LUCE_AFTER_DEFAULT_DIR=/path/to/after-sample-csv-dir
```

默认样例目录现指向合成数据 `data/synthetic/hangzhou-huanglong/`。

### 体育场 3D 模型

将 GLB 模型放到 `frontend/public/models/`，例如 `dayuntest1.glb`。位置与缩放参数见 `frontend/src/constants.ts` 中的 `STADIUM_GLB`，详细说明见 [frontend/public/models/README.md](frontend/public/models/README.md)。

## 目录结构

```
dtdoap/
├── backend/          # Express API、路测处理、优化对比
├── frontend/         # React + Cesium 前端
├── config/           # 区域 bbox 等共享配置
├── data/
│   ├── batches/      # 运行时上传批次（gitignore）
│   ├── sample/       # 真实路测样例（gitignore，勿提交）
│   └── synthetic/    # 合成测试数据（可入库）
├── docs/             # 计算逻辑说明
└── tools/            # 辅助脚本（含合成数据生成）
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端监听端口 |
| `MAX_UPLOAD_FILE_SIZE_MB` | `1024` | 单文件上传上限（MB） |
| `LUCE_AFTER_DEFAULT_DIR` | `data/sample/...` | 优化后样例路测目录 |
| `NETOPT_PYTHON` | `python3` | 优化脚本使用的 Python |

## 构建

```bash
npm run build
```

## 文档

- [覆盖优化计算逻辑核查说明](docs/compute-logic-audit.md)

## 版本标记

本项目使用 **日期 tag** 标记快照版本，格式为 `YYYY-MM-DD`，例如 `2026-06-02`。

```bash
git tag 2026-06-02
git push origin 2026-06-02
```

## License

Private — 暂未指定开源协议。
