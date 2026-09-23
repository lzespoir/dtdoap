import type { MapTheme } from "../types";

export type BaseMapProvider =
  | "carto"
  | "osm"
  | "amap"
  | "baidu"
  | "google"
  | "custom";

export interface BaseMapConfig {
  provider: BaseMapProvider;
  /** 标准 Web Mercator XYZ URL；留空时使用供应商默认值（若有） */
  urlTemplate: string;
  /** 替换 URL 中的 {key} 或 {token}；仅保存在当前浏览器 */
  credential: string;
  /** Cesium 子域列表，逗号分隔 */
  subdomains: string;
  /** 可覆盖供应商默认版权信息 */
  credit: string;
  maximumLevel: number;
}

export interface BaseMapProviderDefinition {
  label: string;
  lightUrlTemplate: string;
  darkUrlTemplate?: string;
  credit: string;
  defaultSubdomains: string;
  defaultMaximumLevel: number;
  help: string;
  coordinateWarning?: string;
}

export const BASE_MAP_PROVIDER_ORDER: BaseMapProvider[] = [
  "carto",
  "osm",
  "amap",
  "baidu",
  "google",
  "custom",
];

export const BASE_MAP_PROVIDERS: Record<
  BaseMapProvider,
  BaseMapProviderDefinition
> = {
  carto: {
    label: "CARTO（当前默认）",
    lightUrlTemplate:
      "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    darkUrlTemplate:
      "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    credit: "© OpenStreetMap © CARTO",
    defaultSubdomains: "",
    defaultMaximumLevel: 20,
    help: "无需密钥；留空 URL 时自动跟随明亮/暗黑主题。",
  },
  osm: {
    label: "OpenStreetMap",
    lightUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    credit: "© OpenStreetMap contributors",
    defaultSubdomains: "",
    defaultMaximumLevel: 19,
    help: "无需密钥。公开瓦片适合低频使用，正式发布应遵守 OSM Tile Usage Policy。",
  },
  amap: {
    label: "高德地图",
    lightUrlTemplate:
      "https://webrd0{s}.is.autonavi.com/appmaptile?style=7&x={x}&y={y}&z={z}",
    credit: "© 高德地图",
    defaultSubdomains: "1,2,3,4",
    defaultMaximumLevel: 18,
    help: "可覆盖为自己的标准 XYZ 服务地址；URL 可使用 {key} 或 {token}。",
    coordinateWarning:
      "高德原生瓦片通常采用 GCJ-02，而平台数据使用 WGS84，直接使用可能出现位置偏移。精确分析请配置已校正到 WGS84 的 XYZ 服务。",
  },
  baidu: {
    label: "百度地图",
    lightUrlTemplate: "",
    credit: "© 百度地图",
    defaultSubdomains: "",
    defaultMaximumLevel: 19,
    help: "请填写兼容标准 Web Mercator XYZ 的百度瓦片代理地址。",
    coordinateWarning:
      "百度原生瓦片采用 BD-09 且瓦片编号规则不同，不能直接与 Cesium/WGS84 数据对齐。需要使用已转换为标准 XYZ/WGS84 的服务。",
  },
  google: {
    label: "Google Maps",
    lightUrlTemplate: "",
    credit: "© Google",
    defaultSubdomains: "",
    defaultMaximumLevel: 22,
    help: "请填写已获授权的 Map Tiles API 会话 URL 或标准 XYZ 代理；会话令牌可用 {token} 占位。",
    coordinateWarning:
      "Google Map Tiles API 通常需要先用 API Key 创建有时效的 session token；仅填写 API Key 不能直接作为永久 XYZ 地址。",
  },
  custom: {
    label: "自定义 XYZ",
    lightUrlTemplate: "",
    credit: "",
    defaultSubdomains: "",
    defaultMaximumLevel: 20,
    help: "填写标准 Web Mercator XYZ 地址，例如 https://host/{z}/{x}/{y}.png。",
  },
};

export const DEFAULT_BASE_MAP_CONFIG: BaseMapConfig = {
  provider: "carto",
  urlTemplate: "",
  credential: "",
  subdomains: "",
  credit: "",
  maximumLevel: 20,
};

const STORAGE_KEY = "netopt-base-map";
const PROVIDERS = new Set<BaseMapProvider>(BASE_MAP_PROVIDER_ORDER);

export function resolveBaseMapConfig(
  config: BaseMapConfig,
  theme: MapTheme
): {
  url: string;
  credit: string;
  subdomains: string[];
  maximumLevel: number;
} {
  const definition = BASE_MAP_PROVIDERS[config.provider];
  const defaultUrl =
    theme === "dark" && definition.darkUrlTemplate
      ? definition.darkUrlTemplate
      : definition.lightUrlTemplate;
  const credential = encodeURIComponent(config.credential.trim());
  const url = (config.urlTemplate.trim() || defaultUrl)
    .replaceAll("{key}", credential)
    .replaceAll("{token}", credential);
  const subdomains = (config.subdomains.trim() || definition.defaultSubdomains)
    .split(/[,，;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    url,
    credit: config.credit.trim() || definition.credit,
    subdomains,
    maximumLevel: normalizeMaximumLevel(config.maximumLevel),
  };
}

export function loadBaseMapConfig(): BaseMapConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BASE_MAP_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BaseMapConfig>;
    const provider =
      typeof parsed.provider === "string" &&
      PROVIDERS.has(parsed.provider as BaseMapProvider)
        ? (parsed.provider as BaseMapProvider)
        : DEFAULT_BASE_MAP_CONFIG.provider;
    return {
      provider,
      urlTemplate:
        typeof parsed.urlTemplate === "string" ? parsed.urlTemplate : "",
      credential:
        typeof parsed.credential === "string" ? parsed.credential : "",
      subdomains:
        typeof parsed.subdomains === "string" ? parsed.subdomains : "",
      credit: typeof parsed.credit === "string" ? parsed.credit : "",
      maximumLevel: normalizeMaximumLevel(parsed.maximumLevel),
    };
  } catch {
    return { ...DEFAULT_BASE_MAP_CONFIG };
  }
}

export function saveBaseMapConfig(config: BaseMapConfig): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...config,
      maximumLevel: normalizeMaximumLevel(config.maximumLevel),
    })
  );
}

function normalizeMaximumLevel(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(24, Math.max(1, Math.round(parsed)))
    : DEFAULT_BASE_MAP_CONFIG.maximumLevel;
}
