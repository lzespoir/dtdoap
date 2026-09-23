# DTDOAP

**DTDOAP**（DriveTest Data Optimization and Analysis Platform）  
**路测数据优化分析平台**

上传工参与路测数据，完成栅格化处理、优化前后对比，并在 Cesium 地图上展示 RSRP / SINR / PCI 分布。

## 功能

- **批次管理**：按批次组织工参（xlsx/csv）与路测（csv）
- **路测处理**：提取与过滤采样点，栅格聚合 RSRP / SINR
- **效果对比**：优化前后覆盖与质量指标对比
- **地图可视化**：栅格、轨迹、小区工参及可选 3D / 航拍图层

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19、Vite、Cesium、TypeScript |
| 后端 | Node.js、Express、TypeScript |
| 脚本 | AWK、Python 3 |

## 环境要求

- Node.js 18+
- npm
- Python 3
- bash、awk、sort

## 快速开始

```bash
git clone git@github.com:lzespoir/dtdoap.git
cd dtdoap

npm install
npm install --prefix backend
npm install --prefix frontend

npm run dev
```

- 前端：<http://localhost:5174>
- 后端：<http://localhost:3001/api/health>

分别启动：

```bash
npm run dev:backend   # http://localhost:3001
npm run dev:frontend  # http://localhost:5174
```

```bash
npm run build
```

## 测试数据

仓库提供合成示例（浙江杭州场景），可直接用于联调：

| 内容 | 路径 |
|------|------|
| 工参 | `data/synthetic/hangzhou-huanglong/gongcan/` |
| 优化前路测 | `data/synthetic/hangzhou-huanglong/before/` |
| 优化后路测 | `data/synthetic/hangzhou-huanglong/after/` |
| 推荐设置 | `data/synthetic/hangzhou-huanglong/scene.json` |

重新生成合成数据：

```bash
python3 tools/generate_synthetic_drive_test.py
```

默认无上传数据时，样例目录指向上述合成路径。也可通过环境变量覆盖：

```bash
export LUCE_AFTER_DEFAULT_DIR=/path/to/after-csv-dir
```

运行时上传数据保存在 `data/batches/`（已忽略，不进入版本库）。自有路测文件可放在本地 `data/sample/`（同样已忽略）。

可选：将 GLB 模型放入 `frontend/public/models/`，参数见 `frontend/src/constants.ts` 与 [frontend/public/models/README.md](frontend/public/models/README.md)。

## 目录结构

```
dtdoap/
├── backend/       # API、路测处理、对比计算
├── frontend/      # React + Cesium
├── config/        # 共享配置
├── data/
│   ├── batches/   # 运行时批次（gitignore）
│   ├── sample/    # 本地样例（gitignore）
│   └── synthetic/ # 合成示例数据
├── docs/
└── tools/
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端端口 |
| `MAX_UPLOAD_FILE_SIZE_MB` | `1024` | 单文件上传上限（MB） |
| `LUCE_AFTER_DEFAULT_DIR` | `data/synthetic/hangzhou-huanglong/after` | 优化后默认样例目录 |
| `NETOPT_PYTHON` | `python3` | 优化脚本所用 Python |

## 文档

- [覆盖对比计算逻辑说明](docs/compute-logic-audit.md)

## License

未指定开源协议。版权归作者所有。
