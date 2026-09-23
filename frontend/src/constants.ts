/** 大运体育场初始视角 (WGS84) */
export const DAYUN_STADIUM = {
  longitude: 114.212309,
  latitude: 22.697092,
  /** 相机与目标距离 (m)，lookAt 使用 */
  viewRange: 400,
  heading: 0,
  /** 俯仰角（度），略平一些让目标在视区中上部 */
  pitch: -38,
  roll: 0,
} as const;

/**
 * 体育场 GLB 模型（放在 frontend/public/models/dayuntest1.glb）
 * ImageToStl 等转换的模型单位/朝向可能不准，用下面参数微调。
 */
export const STADIUM_GLB = {
  enabled: true,
  url: "/models/dayuntest2.glb",
  longitude: DAYUN_STADIUM.longitude,
  latitude: DAYUN_STADIUM.latitude,
  /** 相对地表高度 (m)，可为负；0 表示贴地 */
  heightMeters: 15,
  /** 平面偏移 (m)：正=向东（右），负=向西（左） */
  offsetEastMeters: -18.25,
  /** 平面偏移 (m)：正=向北（上），负=向南（下） */
  offsetNorthMeters: 3,
  /** 绕垂直轴旋转 (°)，与地图北向对齐时可调 */
  headingDegrees: 180,
  pitchDegrees: 0,
  rollDegrees: 0,
  /** 整体缩放；模型过大/过小时改此值（如 0.001 或 10） */
  scale: 0.00102,
  /** 南北方向缩放（ENU 北向 Y），1=不变，>1 拉长 */
  northSouthScale: 1.10,
  minimumPixelSize: 64,
} as const;

/**
 * 体育场航拍衬底（贴在瓦片上方、3D 模型与路测数据下方）
 * 贴图 671×1024，长边为南北向，halfLength 对应南北半长。
 */
export const STADIUM_GROUND = {
  enabled: true,
  url: "/images/stadium-ground.png",
  longitude: DAYUN_STADIUM.longitude,
  latitude: DAYUN_STADIUM.latitude,
  /** 平面偏移 (m)：正=向东（右），负=向西（左） */
  offsetEastMeters: 9,
  /** 平面偏移 (m)：正=向北（上），负=向南（下） */
  offsetNorthMeters: 0,
  /** 东西半宽 (m) */
  halfWidthMeters:70,
  /** 南北半长 (m) */
  halfLengthMeters: 106.7,
  /** 绕中心逆时针旋转 (°)，与地图北向对齐 */
  headingDegrees: 0,
  /** 相对地表高度 (m)，需低于栅格 LUCE_GRID */
  heightMeters: 0,
  /** 贴图不透明度 0~1 */
  opacity: 0.5,
  /**
   * 布局版本：修改 offset/halfWidth/halfLength 后递增，
   * 浏览器内保存的微调偏移/缩放会自动清零，避免与 constants 重复叠加。
   */
  layoutRevision: 2,
} as const;

/** 路测栅格/热力图矩形相对地表高度 (m) */
export const LUCE_GRID = {
  heightMeters: 0.1,
  /** 栅格模式填充不透明度 */
  gridAlpha: 0.9,
  /** 热力图模式填充不透明度 */
  heatmapAlpha: 0.82,
} as const;

/** 路测轨迹线（显示测试路径） */
export const LUCE_DRIVE_PATH = {
  /** 相对地表高度 (m)，建议高于 LUCE_GRID 以免被栅格遮挡 */
  heightMeters: 0.2,
  width: 3,
  alpha: 0.9,
} as const;

export const RSRP_RANGE = {
  min: -120,
  max: -60,
  unit: "dBm",
} as const;

export const SINR_RANGE = {
  min: -10,
  max: 10,
  unit: "dB",
} as const;

/** 栅格对比视图：Δ = 优化后 − 优化前 */
export const DELTA_RSRP_RANGE = {
  min: -15,
  max: 15,
  unit: "dB",
} as const;

export const DELTA_SINR_RANGE = {
  min: -10,
  max: 10,
  unit: "dB",
} as const;
