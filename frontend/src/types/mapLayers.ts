import {
  DAYUN_STADIUM,
  STADIUM_GLB,
  STADIUM_GROUND,
} from "../constants";
import {
  defaultStadiumGroundTune,
  loadStadiumGroundTune,
} from "./stadiumGround";
import {
  defaultStadiumGlbTune,
  loadStadiumGlbTune,
} from "./stadiumGlbTune";

export type MapLayerType = "siteMarker" | "groundOverlay" | "model3d";

export interface MapLayerBase {
  id: string;
  name: string;
  visible: boolean;
  type: MapLayerType;
}

export interface SiteMarkerLayer extends MapLayerBase {
  type: "siteMarker";
  label: string;
  longitude: number;
  latitude: number;
}

export interface GroundOverlayLayer extends MapLayerBase {
  type: "groundOverlay";
  url: string;
  longitude: number;
  latitude: number;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  halfWidthMeters: number;
  halfLengthMeters: number;
  headingDegrees: number;
  heightMeters: number;
  opacity: number;
  /** 相对 halfWidth/halfLength 的缩放倍数 */
  scale: number;
}

export interface Model3dLayer extends MapLayerBase {
  type: "model3d";
  url: string;
  longitude: number;
  latitude: number;
  heightMeters: number;
  offsetEastMeters: number;
  offsetNorthMeters: number;
  headingDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
  scale: number;
  northSouthScale: number;
  minimumPixelSize: number;
}

export type MapLayer = SiteMarkerLayer | GroundOverlayLayer | Model3dLayer;

export interface MapLayersState {
  layers: MapLayer[];
}

const STORAGE_KEY = "netopt-map-layers";
const SCHEMA_VERSION = 4;

interface StoredMapLayersPayload {
  schemaVersion?: number;
  layers?: unknown[];
  siteMarker?: unknown;
  groundOverlay?: unknown;
  model3d?: unknown;
}

export function buildGroundOverlayFromLegacyTune(
  tune: {
    opacity?: number;
    scale?: number;
    offsetEastMeters?: number;
    offsetNorthMeters?: number;
  },
  overrides?: Partial<
    Pick<GroundOverlayLayer, "id" | "name" | "visible" | "url">
  >
): GroundOverlayLayer {
  const scale = num(tune.scale, 1);
  const extraEast = num(tune.offsetEastMeters, 0);
  const extraNorth = num(tune.offsetNorthMeters, 0);
  return {
    id: overrides?.id ?? newLayerId(),
    type: "groundOverlay",
    name: overrides?.name ?? "航拍底图",
    visible: overrides?.visible ?? STADIUM_GROUND.enabled,
    url: overrides?.url ?? STADIUM_GROUND.url,
    longitude: STADIUM_GROUND.longitude,
    latitude: STADIUM_GROUND.latitude,
    offsetEastMeters: STADIUM_GROUND.offsetEastMeters + extraEast,
    offsetNorthMeters: STADIUM_GROUND.offsetNorthMeters + extraNorth,
    halfWidthMeters: STADIUM_GROUND.halfWidthMeters * scale,
    halfLengthMeters: STADIUM_GROUND.halfLengthMeters * scale,
    headingDegrees: STADIUM_GROUND.headingDegrees,
    heightMeters: STADIUM_GROUND.heightMeters,
    opacity: clamp(num(tune.opacity, STADIUM_GROUND.opacity), 0.05, 1),
    scale: 1,
  };
}

export function buildModel3dFromLegacyTune(
  tune: { northSouthScale?: number },
  overrides?: Partial<Pick<Model3dLayer, "id" | "name" | "visible" | "url">>
): Model3dLayer {
  return {
    id: overrides?.id ?? newLayerId(),
    type: "model3d",
    name: overrides?.name ?? "3D 模型",
    visible: overrides?.visible ?? STADIUM_GLB.enabled,
    url: overrides?.url ?? STADIUM_GLB.url,
    longitude: STADIUM_GLB.longitude,
    latitude: STADIUM_GLB.latitude,
    heightMeters: STADIUM_GLB.heightMeters,
    offsetEastMeters: STADIUM_GLB.offsetEastMeters,
    offsetNorthMeters: STADIUM_GLB.offsetNorthMeters,
    headingDegrees: STADIUM_GLB.headingDegrees,
    pitchDegrees: STADIUM_GLB.pitchDegrees,
    rollDegrees: STADIUM_GLB.rollDegrees,
    scale: STADIUM_GLB.scale,
    northSouthScale: clamp(
      num(tune.northSouthScale, STADIUM_GLB.northSouthScale),
      0.3,
      3
    ),
    minimumPixelSize: STADIUM_GLB.minimumPixelSize,
  };
}

function isDefaultStadiumGroundLayer(layer: GroundOverlayLayer): boolean {
  return (
    layer.url === STADIUM_GROUND.url ||
    layer.url.endsWith("/stadium-ground.png")
  );
}

function isDefaultStadiumModelLayer(layer: Model3dLayer): boolean {
  return (
    layer.url === STADIUM_GLB.url ||
    layer.url.includes("dayuntest")
  );
}

function repairDefaultVenueLayers(state: MapLayersState): MapLayersState {
  const groundTune = loadStadiumGroundTune();
  const glbTune = loadStadiumGlbTune();
  return {
    layers: state.layers.map((layer) => {
      if (layer.type === "groundOverlay" && isDefaultStadiumGroundLayer(layer)) {
        const lostBaseOffset =
          Math.abs(layer.offsetEastMeters) < 0.5 &&
          Math.abs(layer.offsetNorthMeters) < 0.5 &&
          (Math.abs(STADIUM_GROUND.offsetEastMeters) > 0.5 ||
            Math.abs(STADIUM_GROUND.offsetNorthMeters) > 0.5);
        const scaleNotBaked = Math.abs(layer.scale - 1) > 0.01;
        if (lostBaseOffset || scaleNotBaked) {
          return buildGroundOverlayFromLegacyTune(
            lostBaseOffset
              ? groundTune
              : {
                  opacity: layer.opacity,
                  scale: layer.scale,
                  offsetEastMeters:
                    layer.offsetEastMeters - STADIUM_GROUND.offsetEastMeters,
                  offsetNorthMeters:
                    layer.offsetNorthMeters - STADIUM_GROUND.offsetNorthMeters,
                },
            { id: layer.id, name: layer.name, visible: layer.visible }
          );
        }
      }
      if (layer.type === "model3d" && isDefaultStadiumModelLayer(layer)) {
        const lostGlbOffset =
          Math.abs(layer.offsetEastMeters) < 0.5 &&
          Math.abs(STADIUM_GLB.offsetEastMeters) > 1;
        if (lostGlbOffset) {
          return buildModel3dFromLegacyTune(glbTune, {
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
          });
        }
      }
      return layer;
    }),
  };
}

function hideDefaultVenueVisuals(state: MapLayersState): MapLayersState {
  return {
    layers: state.layers.map((layer) => {
      if (
        (layer.type === "groundOverlay" &&
          isDefaultStadiumGroundLayer(layer)) ||
        (layer.type === "model3d" && isDefaultStadiumModelLayer(layer))
      ) {
        return { ...layer, visible: false };
      }
      return layer;
    }),
  };
}

export const MAP_LAYER_TYPE_META: Record<
  MapLayerType,
  { title: string; description: string }
> = {
  siteMarker: {
    title: "固定标注",
    description: "地图点位与文字标签",
  },
  groundOverlay: {
    title: "航拍底图",
    description: "贴在地表上的图片衬底",
  },
  model3d: {
    title: "3D 模型",
    description: "GLB 三维模型",
  },
};

export function newLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultSiteMarkerLayer(
  overrides?: Partial<Pick<SiteMarkerLayer, "name" | "label">>
): SiteMarkerLayer {
  const name = overrides?.name ?? "大运体育场";
  return {
    id: newLayerId(),
    type: "siteMarker",
    name,
    visible: true,
    label: overrides?.label ?? name,
    longitude: DAYUN_STADIUM.longitude,
    latitude: DAYUN_STADIUM.latitude,
  };
}

export function defaultGroundOverlayLayer(
  overrides?: Partial<Pick<GroundOverlayLayer, "name" | "url" | "visible">>
): GroundOverlayLayer {
  return buildGroundOverlayFromLegacyTune(defaultStadiumGroundTune(), {
    name: overrides?.name ?? "航拍底图",
    visible: overrides?.visible ?? STADIUM_GROUND.enabled,
    url: overrides?.url,
  });
}

export function defaultModel3dLayer(
  overrides?: Partial<Pick<Model3dLayer, "name" | "url" | "visible">>
): Model3dLayer {
  return buildModel3dFromLegacyTune(defaultStadiumGlbTune(), {
    name: overrides?.name ?? "3D 模型",
    visible: overrides?.visible ?? STADIUM_GLB.enabled,
    url: overrides?.url,
  });
}

export function createLayer(type: MapLayerType, name?: string): MapLayer {
  switch (type) {
    case "siteMarker":
      return defaultSiteMarkerLayer(name ? { name, label: name } : undefined);
    case "groundOverlay":
      return defaultGroundOverlayLayer(name ? { name } : undefined);
    case "model3d":
      return defaultModel3dLayer(name ? { name } : undefined);
  }
}

export function defaultMapLayers(): MapLayersState {
  return {
    layers: [
      defaultGroundOverlayLayer({
        name: "大运体育场底图",
        visible: false,
      }),
      defaultModel3dLayer({
        name: "大运体育场模型",
        visible: false,
      }),
      defaultSiteMarkerLayer(),
    ],
  };
}

export function loadMapLayers(): MapLayersState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredMapLayersPayload;
      let state = normalizeMapLayers(parsed);
      const version = parsed.schemaVersion ?? 0;
      if (version < SCHEMA_VERSION) {
        state = repairDefaultVenueLayers(state);
        if (version < 4) {
          state = hideDefaultVenueVisuals(state);
        }
        saveMapLayers(state);
      }
      return state;
    }
  } catch {
    /* fall through */
  }
  const migrated = migrateLegacyMapLayers();
  saveMapLayers(migrated);
  return migrated;
}

export function saveMapLayers(state: MapLayersState): void {
  const normalized = normalizeMapLayers({ layers: state.layers });
  const payload: StoredMapLayersPayload = {
    schemaVersion: SCHEMA_VERSION,
    layers: normalized.layers,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function migrateLegacyMapLayers(): MapLayersState {
  return {
    layers: [
      buildGroundOverlayFromLegacyTune(loadStadiumGroundTune(), {
        name: "大运体育场底图",
        visible: false,
      }),
      buildModel3dFromLegacyTune(loadStadiumGlbTune(), {
        name: "大运体育场模型",
        visible: false,
      }),
      defaultSiteMarkerLayer(),
    ],
  };
}

function normalizeMapLayers(raw: unknown): MapLayersState {
  if (raw && typeof raw === "object") {
    const payload = raw as StoredMapLayersPayload;
    if (Array.isArray(payload.layers)) {
      const layers = payload.layers
        .map((item) => normalizeLayer(item))
        .filter((l): l is MapLayer => l != null);
      if (layers.length > 0) return { layers };
    }
  }

  // v1: { siteMarker, groundOverlay, model3d }
  if (raw && typeof raw === "object" && "siteMarker" in raw) {
    const v1 = raw as StoredMapLayersPayload & {
      siteMarker?: Partial<SiteMarkerLayer> & { visible?: boolean; label?: string };
      groundOverlay?: Partial<StadiumGroundTuneLike> & { visible?: boolean };
      model3d?: { visible?: boolean; northSouthScale?: number };
    };
    const layers: MapLayer[] = [];
    if (v1.groundOverlay) {
      layers.push(
        buildGroundOverlayFromLegacyTune(v1.groundOverlay, {
          name: "航拍底图",
          visible: v1.groundOverlay.visible !== false,
        })
      );
    }
    if (v1.model3d) {
      layers.push(
        buildModel3dFromLegacyTune(v1.model3d, {
          name: "3D 模型",
          visible: v1.model3d.visible !== false,
        })
      );
    }
    if (v1.siteMarker) {
      const s = defaultSiteMarkerLayer();
      layers.push(
        normalizeLayer({
          ...s,
          ...v1.siteMarker,
          type: "siteMarker",
          id: s.id,
        })!
      );
    }
    if (layers.length > 0) return { layers };
  }

  return defaultMapLayers();
}

interface StadiumGroundTuneLike {
  opacity?: number;
  scale?: number;
  offsetEastMeters?: number;
  offsetNorthMeters?: number;
}

function normalizeLayer(raw: unknown): MapLayer | null {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return null;
  const id = typeof record.id === "string" ? record.id : newLayerId();
  const name = typeof record.name === "string" ? record.name : "未命名图层";
  const visible = record.visible !== false;

  if (type === "siteMarker") {
    const d = defaultSiteMarkerLayer();
    const r = raw as Partial<SiteMarkerLayer>;
    return {
      ...d,
      ...r,
      id,
      type: "siteMarker",
      name,
      visible,
      label: typeof r.label === "string" ? r.label : d.label,
      longitude: num(r.longitude, d.longitude),
      latitude: num(r.latitude, d.latitude),
    };
  }

  if (type === "groundOverlay") {
    const d = defaultGroundOverlayLayer();
    const r = raw as Partial<GroundOverlayLayer>;
    return {
      ...d,
      ...r,
      id,
      type: "groundOverlay",
      name,
      visible,
      url: typeof r.url === "string" ? r.url : d.url,
      longitude: num(r.longitude, d.longitude),
      latitude: num(r.latitude, d.latitude),
      offsetEastMeters: num(r.offsetEastMeters, d.offsetEastMeters),
      offsetNorthMeters: num(r.offsetNorthMeters, d.offsetNorthMeters),
      halfWidthMeters: clamp(num(r.halfWidthMeters, d.halfWidthMeters), 5, 500),
      halfLengthMeters: clamp(num(r.halfLengthMeters, d.halfLengthMeters), 5, 500),
      headingDegrees: num(r.headingDegrees, d.headingDegrees),
      heightMeters: num(r.heightMeters, d.heightMeters),
      opacity: clamp(num(r.opacity, d.opacity), 0.05, 1),
      scale: clamp(num(r.scale, d.scale), 0.2, 3),
    };
  }

  if (type === "model3d") {
    const d = defaultModel3dLayer();
    const r = raw as Partial<Model3dLayer>;
    return {
      ...d,
      ...r,
      id,
      type: "model3d",
      name,
      visible,
      url: typeof r.url === "string" ? r.url : d.url,
      longitude: num(r.longitude, d.longitude),
      latitude: num(r.latitude, d.latitude),
      heightMeters: num(r.heightMeters, d.heightMeters),
      offsetEastMeters: num(r.offsetEastMeters, d.offsetEastMeters),
      offsetNorthMeters: num(r.offsetNorthMeters, d.offsetNorthMeters),
      headingDegrees: num(r.headingDegrees, d.headingDegrees),
      pitchDegrees: num(r.pitchDegrees, d.pitchDegrees),
      rollDegrees: num(r.rollDegrees, d.rollDegrees),
      scale: clamp(num(r.scale, d.scale), 0.00001, 100),
      northSouthScale: clamp(num(r.northSouthScale, d.northSouthScale), 0.3, 3),
      minimumPixelSize: clamp(num(r.minimumPixelSize, d.minimumPixelSize), 0, 256),
    };
  }

  return null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
