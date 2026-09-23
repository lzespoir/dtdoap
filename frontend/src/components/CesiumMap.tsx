import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  ClassificationType,
  Color,
  Viewer,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  LabelStyle,
  HeightReference,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  HeadingPitchRange,
  HeadingPitchRoll,
  ImageMaterialProperty,
  Matrix4,
  Model,
  Transforms,
  defined,
  PointPrimitiveCollection,
  Rectangle,
  type ImageryLayer,
  Entity,
} from "cesium";
import { useEffect, useRef, useState } from "react";
import {
  DAYUN_STADIUM,
  LUCE_DRIVE_PATH,
  LUCE_GRID,
} from "../constants";
import { buildGridDeltaCells, type GridDeltaCell } from "../lib/gridDelta";
import {
  cellBoundsForDisplay,
  gridIndexOptionsFromSettings,
  gridSettingsAffectKeys,
} from "../lib/gridUtils";
import {
  deltaRsrpToColor,
  deltaSinrToColor,
  metricRangesFromSettings,
  rsrpToColor,
  sinrToColor,
  type MetricColorRange,
} from "../lib/rsrpColor";
import {
  pciToColor,
  buildPciColorMap,
  collectPcisFromLuce,
} from "../lib/pciColor";
import type { MapTheme, OptimizationView } from "../types";
import {
  resolveBaseMapConfig,
  type BaseMapConfig,
} from "../types/baseMap";
import type { MapColorMetric } from "../types/map";
import type {
  GroundOverlayLayer,
  MapLayersState,
  Model3dLayer,
  SiteMarkerLayer,
} from "../types/mapLayers";
import type { CellSite } from "../types/cell";
import {
  getDrivePathPolylines,
  getDrivePaths,
  PATH_LINE_COLORS,
} from "../lib/lucePaths";
import type {
  GridCell,
  LuceProcessResult,
  LuceSettings,
  RsrpSample,
} from "../types/luce";
import CellInfoPopup from "./CellInfoPopup";
import "cesium/Build/Cesium/Widgets/widgets.css";

const CELL_ICON = "/icons/jizhanlogo.png";
const MAX_CAMERA_RANGE_M = 8000;

const THEME_STYLES: Record<
  MapTheme,
  {
    background: Color;
    globeBase: Color;
    brightness: number;
    contrast: number;
    gamma: number;
  }
> = {
  light: {
    background: Color.fromCssColorString("#e8eef2"),
    globeBase: Color.fromCssColorString("#d0dae4"),
    brightness: 1.0,
    contrast: 1.05,
    gamma: 1.0,
  },
  dark: {
    background: Color.fromCssColorString("#1e2430"),
    globeBase: Color.fromCssColorString("#2c3544"),
    brightness: 1.35,
    contrast: 1.08,
    gamma: 0.95,
  },
};

function applyImageryTheme(
  viewer: Viewer,
  theme: MapTheme,
  baseMap: BaseMapConfig,
  onError: (message: string | null) => void
): ImageryLayer | null {
  viewer.imageryLayers.removeAll();
  const style = THEME_STYLES[theme];
  const resolved = resolveBaseMapConfig(baseMap, theme);
  onError(null);
  viewer.scene.backgroundColor = style.background.clone();
  viewer.scene.globe.baseColor = style.globeBase.clone();
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.show = true;
  if (!resolved.url) {
    onError("当前地图源缺少 XYZ URL，请在「图层」中完成基础地图配置。");
    return null;
  }
  const provider = new UrlTemplateImageryProvider({
    url: resolved.url,
    credit: resolved.credit,
    subdomains:
      resolved.subdomains.length > 0 ? resolved.subdomains : undefined,
    maximumLevel: resolved.maximumLevel,
  });
  provider.errorEvent.addEventListener((error) => {
    const detail =
      typeof error?.message === "string" && error.message
        ? `：${error.message}`
        : "";
    onError(`基础地图瓦片加载失败，请检查 URL、密钥或令牌${detail}`);
  });
  const layer = viewer.imageryLayers.addImageryProvider(
    provider
  );
  layer.brightness = style.brightness;
  layer.contrast = style.contrast;
  layer.gamma = style.gamma;
  return layer;
}

function cameraOffset(range: number): HeadingPitchRange {
  return new HeadingPitchRange(
    CesiumMath.toRadians(DAYUN_STADIUM.heading),
    CesiumMath.toRadians(DAYUN_STADIUM.pitch),
    range
  );
}

function unlockCamera(viewer: Viewer): void {
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
}

function layerEntityId(layerId: string): string {
  return `map-layer-${layerId}`;
}

function offsetPosition(
  longitude: number,
  latitude: number,
  offsetEastMeters: number,
  offsetNorthMeters: number
): { longitude: number; latitude: number } {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  return {
    longitude: longitude + offsetEastMeters / (mPerDegLat * cosLat),
    latitude: latitude + offsetNorthMeters / mPerDegLat,
  };
}

function syncSiteMarkerLayer(viewer: Viewer, layer: SiteMarkerLayer): void {
  const id = layerEntityId(layer.id);
  viewer.entities.removeById(id);
  if (!layer.visible) return;

  const label = layer.label?.trim() || layer.name || "场地标注";
  viewer.entities.add({
    id,
    position: Cartesian3.fromDegrees(layer.longitude, layer.latitude),
    point: {
      pixelSize: 12,
      color: Color.CYAN,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text: label,
      font: "14px sans-serif",
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 2,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -12),
    },
  });
}

function syncGroundOverlayLayer(
  viewer: Viewer,
  layer: GroundOverlayLayer
): void {
  const id = layerEntityId(layer.id);
  viewer.entities.removeById(id);
  if (!layer.visible || !layer.url.trim()) return;

  const { longitude, latitude } = offsetPosition(
    layer.longitude,
    layer.latitude,
    layer.offsetEastMeters,
    layer.offsetNorthMeters
  );
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const halfW = layer.halfWidthMeters * layer.scale;
  const halfL = layer.halfLengthMeters * layer.scale;
  const dLon = halfW / (mPerDegLat * cosLat);
  const dLat = halfL / mPerDegLat;

  viewer.entities.add({
    id,
    rectangle: {
      coordinates: Rectangle.fromDegrees(
        longitude - dLon,
        latitude - dLat,
        longitude + dLon,
        latitude + dLat
      ),
      material: new ImageMaterialProperty({
        image: layer.url,
        color: Color.WHITE.withAlpha(layer.opacity),
        transparent: true,
      }),
      rotation: CesiumMath.toRadians(layer.headingDegrees),
      height: layer.heightMeters,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      classificationType: ClassificationType.TERRAIN,
    },
  });
}

function removeModel3dLayer(
  viewer: Viewer,
  layerId: string,
  modelPrimitives: Map<string, Model>
): void {
  const entityId = layerEntityId(layerId);
  const entity = viewer.entities.getById(entityId);
  if (entity) viewer.entities.remove(entity);
  const primitive = modelPrimitives.get(layerId);
  if (primitive) {
    viewer.scene.primitives.remove(primitive);
    modelPrimitives.delete(layerId);
  }
}

async function modelUrlAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function syncModel3dLayer(
  viewer: Viewer,
  layer: Model3dLayer,
  modelPrimitives: Map<string, Model>
): Promise<void> {
  removeModel3dLayer(viewer, layer.id, modelPrimitives);
  if (!layer.visible || !layer.url.trim()) return;
  if (!(await modelUrlAvailable(layer.url))) return;

  const { longitude, latitude } = offsetPosition(
    layer.longitude,
    layer.latitude,
    layer.offsetEastMeters,
    layer.offsetNorthMeters
  );
  const pos = Cartesian3.fromDegrees(longitude, latitude, layer.heightMeters);
  const hpr = new HeadingPitchRoll(
    CesiumMath.toRadians(layer.headingDegrees),
    CesiumMath.toRadians(layer.pitchDegrees),
    CesiumMath.toRadians(layer.rollDegrees)
  );
  const heightRef =
    layer.heightMeters === 0
      ? HeightReference.CLAMP_TO_GROUND
      : HeightReference.RELATIVE_TO_GROUND;

  if (
    !Number.isFinite(layer.northSouthScale) ||
    Math.abs(layer.northSouthScale - 1) < 0.001
  ) {
    const orientation = Transforms.headingPitchRollQuaternion(pos, hpr);
    viewer.entities.add({
      id: layerEntityId(layer.id),
      position: pos,
      orientation,
      model: {
        uri: layer.url,
        scale: layer.scale,
        minimumPixelSize: layer.minimumPixelSize,
        heightReference: heightRef,
      },
    });
    return;
  }

  const modelMatrix = Transforms.headingPitchRollToFixedFrame(pos, hpr);
  Matrix4.multiplyByScale(
    modelMatrix,
    new Cartesian3(1, layer.northSouthScale, 1),
    modelMatrix
  );

  const model = await Model.fromGltfAsync({
    url: layer.url,
    modelMatrix,
    scale: layer.scale,
    minimumPixelSize: layer.minimumPixelSize,
  });
  if (viewer.isDestroyed()) return;
  modelPrimitives.set(layer.id, model);
  viewer.scene.primitives.add(model);
}

async function syncDecorLayers(
  viewer: Viewer,
  state: MapLayersState,
  modelPrimitives: Map<string, Model>
): Promise<void> {
  const activeIds = new Set(state.layers.map((l) => l.id));

  for (const layerId of [...modelPrimitives.keys()]) {
    if (!activeIds.has(layerId)) {
      removeModel3dLayer(viewer, layerId, modelPrimitives);
    }
  }

  const entityIds = viewer.entities.values
    .map((e) => e.id)
    .filter((id): id is string => typeof id === "string" && id.startsWith("map-layer-"));
  for (const entityId of entityIds) {
    const layerId = entityId.replace(/^map-layer-/, "");
    if (!activeIds.has(layerId)) {
      viewer.entities.removeById(entityId);
    }
  }

  for (const layer of state.layers) {
    if (layer.type === "siteMarker") {
      syncSiteMarkerLayer(viewer, layer);
    } else if (layer.type === "groundOverlay") {
      syncGroundOverlayLayer(viewer, layer);
    }
  }

  for (const layer of state.layers) {
    if (layer.type === "model3d") {
      await syncModel3dLayer(viewer, layer, modelPrimitives);
      if (viewer.isDestroyed()) return;
    }
  }

  viewer.scene.requestRender();
}

/** lookAt 将目标置于视区中心，避免 flyTo 高度+俯仰导致中心偏下 */
function focusOnTarget(
  viewer: Viewer,
  longitude: number,
  latitude: number,
  range: number,
  duration = 0
): void {
  const target = Cartesian3.fromDegrees(longitude, latitude);
  const offset = cameraOffset(range);

  if (duration <= 0) {
    viewer.camera.lookAt(target, offset);
    unlockCamera(viewer);
    return;
  }

  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 80), {
    offset,
    duration,
    complete: () => unlockCamera(viewer),
  });
}


function flyToStadium(viewer: Viewer, duration = 0): void {
  focusOnTarget(
    viewer,
    DAYUN_STADIUM.longitude,
    DAYUN_STADIUM.latitude,
    DAYUN_STADIUM.viewRange,
    duration
  );
}

function flyToLuce(viewer: Viewer, luce: LuceProcessResult): void {
  const positions: Cartesian3[] = [];
  for (const path of getDrivePaths(luce)) {
    for (const seg of getDrivePathPolylines(path)) {
      for (const p of seg.points) {
        positions.push(Cartesian3.fromDegrees(p.longitude, p.latitude));
      }
    }
  }
  const display = pickDisplaySamples(luce);
  for (const s of display.slice(0, 5000)) {
    positions.push(Cartesian3.fromDegrees(s.longitude, s.latitude));
  }
  if (positions.length === 0) {
    flyToStadium(viewer, 0.8);
    return;
  }
  const sphere = BoundingSphere.fromPoints(positions);
  const range = Math.min(Math.max(sphere.radius * 2.5, 400), MAX_CAMERA_RANGE_M);
  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(
    sphere.center
  );
  focusOnTarget(
    viewer,
    CesiumMath.toDegrees(carto.longitude),
    CesiumMath.toDegrees(carto.latitude),
    range,
    1.0
  );
}

function pickDisplaySamples(luce: LuceProcessResult): RsrpSample[] {
  const mode = luce.settings.displayMode;
  if ((mode === "grid" || mode === "heatmap") && luce.grid?.length) {
    return luce.grid.map((g) => ({
      longitude: g.longitude,
      latitude: g.latitude,
      rsrp: g.rsrp,
      pci: 0,
      kind: "serving" as const,
    }));
  }
  return luce.samples;
}

function flyToCells(viewer: Viewer, cells: CellSite[]): void {
  if (cells.length === 0) {
    flyToStadium(viewer, 0.8);
    return;
  }

  const positions = cells.map((c) =>
    Cartesian3.fromDegrees(c.longitude, c.latitude)
  );
  const sphere = BoundingSphere.fromPoints(positions);

  if (sphere.radius > 50_000) {
    flyToStadium(viewer, 1.0);
    return;
  }

  const range = Math.min(
    Math.max(sphere.radius * 3, DAYUN_STADIUM.viewRange * 0.6),
    MAX_CAMERA_RANGE_M
  );

  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(
    sphere.center
  );
  focusOnTarget(
    viewer,
    CesiumMath.toDegrees(carto.longitude),
    CesiumMath.toDegrees(carto.latitude),
    range,
    1.0
  );
}

interface CesiumMapProps {
  theme: MapTheme;
  baseMap: BaseMapConfig;
  optimizationView: OptimizationView;
  cells: CellSite[];
  luceData: LuceProcessResult | null;
  /** 对比视图：优化前栅格 */
  beforeLuceData?: LuceProcessResult | null;
  /** 对比视图：优化后栅格 */
  afterLuceData?: LuceProcessResult | null;
  /** 批次统一设置，优化前/后共用同一显示模式与栅格参数 */
  mapSettings: LuceSettings | null;
  mapFlyKey: string;
  /** 变化时飞到当前路测范围（快速预览切换文件） */
  luceFlyKey?: string;
  /** 地图栅格着色：RSRP / SINR / PCI */
  metric?: MapColorMetric;
  /** PCI 着色时与图例共用的配色表 */
  pciColorMap?: Map<number, string>;
  /** 地图装饰图层（标注、底图、3D 模型） */
  mapLayers: MapLayersState;
}

export default function CesiumMap({
  theme,
  baseMap,
  optimizationView,
  cells,
  luceData,
  beforeLuceData = null,
  afterLuceData = null,
  mapSettings,
  mapFlyKey,
  luceFlyKey = "",
  metric = "rsrp",
  pciColorMap: pciColorMapProp,
  mapLayers,
}: CesiumMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const modelPrimitivesRef = useRef<Map<string, Model>>(new Map());
  const cellEntityIdsRef = useRef<string[]>([]);
  const luceEntityIdsRef = useRef<string[]>([]);
  const pointCollectionRef = useRef<PointPrimitiveCollection | null>(null);
  const cellByEntityIdRef = useRef<Map<string, CellSite>>(new Map());
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const lastFlyKeyRef = useRef<string>("");

  const [selectedCell, setSelectedCell] = useState<CellSite | null>(null);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [baseMapError, setBaseMapError] = useState<string | null>(null);

  const lastLuceFlyKeyRef = useRef<string>("");

  const resizeViewer = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.resize();
    viewer.scene.requestRender();
  };

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,
      msaaSamples: 2,
    });

    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.fog.enabled = false;
    applyImageryTheme(viewer, theme, baseMap, setBaseMapError);

    flyToStadium(viewer, 0);

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(click.position);
      if (!defined(picked) || !(picked.id instanceof Entity)) {
        setSelectedCell(null);
        return;
      }
      const cell = cellByEntityIdRef.current.get(picked.id.id as string);
      if (!cell) {
        setSelectedCell(null);
        return;
      }
      setPopupPos({ x: click.position.x + 12, y: click.position.y + 12 });
      setSelectedCell(cell);
    }, ScreenSpaceEventType.LEFT_CLICK);

    handlerRef.current = handler;
    viewerRef.current = viewer;

    const t = window.setTimeout(resizeViewer, 100);

    return () => {
      window.clearTimeout(t);
      for (const layerId of [...modelPrimitivesRef.current.keys()]) {
        removeModel3dLayer(viewer, layerId, modelPrimitivesRef.current);
      }
      handler.destroy();
      handlerRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
      lastFlyKeyRef.current = "";
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => resizeViewer());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    applyImageryTheme(viewer, theme, baseMap, setBaseMapError);
    resizeViewer();
  }, [theme, baseMap]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    void syncDecorLayers(viewer, mapLayers, modelPrimitivesRef.current);
  }, [mapLayers]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !luceFlyKey || !luceData) return;
    if (luceFlyKey === lastLuceFlyKeyRef.current) return;
    lastLuceFlyKeyRef.current = luceFlyKey;
    flyToLuce(viewer, luceData);
  }, [luceFlyKey, luceData]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const id of cellEntityIdsRef.current) {
      viewer.entities.removeById(id);
    }
    cellEntityIdsRef.current = [];
    cellByEntityIdRef.current.clear();

    for (const cell of cells) {
      const entityId = `cell-${cell.id}`;
      viewer.entities.add({
        id: entityId,
        position: Cartesian3.fromDegrees(cell.longitude, cell.latitude, 0),
        billboard: {
          image: CELL_ICON,
          width: 36,
          height: 36,
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: cell.pci !== null ? `PCI ${cell.pci}` : "",
          font: "11px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.TOP,
          pixelOffset: new Cartesian2(0, 6),
          show: cell.pci !== null,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      cellEntityIdsRef.current.push(entityId);
      cellByEntityIdRef.current.set(entityId, cell);
    }

    if (mapFlyKey && cells.length > 0) {
      const flySignature = `${mapFlyKey}:${cells.length}:${cells[0]?.id ?? ""}`;
      if (flySignature !== lastFlyKeyRef.current) {
        flyToCells(viewer, cells);
        lastFlyKeyRef.current = flySignature;
      }
    }

    resizeViewer();
  }, [cells, mapFlyKey]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const id of luceEntityIdsRef.current) {
      viewer.entities.removeById(id);
    }
    luceEntityIdsRef.current = [];

    if (pointCollectionRef.current) {
      viewer.scene.primitives.remove(pointCollectionRef.current);
      pointCollectionRef.current = null;
    }

    const isDeltaView = optimizationView === "delta";
    const deltaSource =
      isDeltaView && beforeLuceData && afterLuceData
        ? { before: beforeLuceData, after: afterLuceData }
        : null;

    if (!luceData && !deltaSource) {
      resizeViewer();
      return;
    }

    const settings =
      mapSettings ?? luceData?.settings ?? beforeLuceData?.settings;
    if (!settings) {
      resizeViewer();
      return;
    }

    const pathLuce = luceData ?? beforeLuceData;
    if (settings.showDrivePath && pathLuce) {
      let lineIdx = 0;
      for (const path of getDrivePaths(pathLuce)) {
        for (const seg of getDrivePathPolylines(path)) {
          const pathId = `luce-path-${lineIdx}`;
          const color =
            PATH_LINE_COLORS[lineIdx % PATH_LINE_COLORS.length] ?? "#00bcd4";
          viewer.entities.add({
            id: pathId,
            polyline: {
              positions: seg.points.map((p) =>
                Cartesian3.fromDegrees(
                  p.longitude,
                  p.latitude,
                  LUCE_DRIVE_PATH.heightMeters
                )
              ),
              width: LUCE_DRIVE_PATH.width,
              material: Color.fromCssColorString(color).withAlpha(
                LUCE_DRIVE_PATH.alpha
              ),
              clampToGround: false,
            },
          });
          luceEntityIdsRef.current.push(pathId);
          lineIdx++;
        }
      }
    }

    const mode = settings.displayMode;
    const showAsGrid =
      mode === "grid" || mode === "heatmap" || settings.useGrid;

    const gridMetric: MapColorMetric =
      deltaSource && metric === "pci" ? "rsrp" : metric;

    const { rsrp: rsrpRange, sinr: sinrRange } = metricRangesFromSettings(
      settings
    );

    let pciColorMap = pciColorMapProp;
    if (metric === "pci" && luceData && !deltaSource && !pciColorMap) {
      pciColorMap = buildPciColorMap(
        collectPcisFromLuce(luceData),
        settings.pciColorOverrides
      );
    }

    if (deltaSource && showAsGrid) {
      const beforeGrid = deltaSource.before.grid ?? [];
      const afterGrid = deltaSource.after.grid ?? [];
      if (beforeGrid.length > 0 && afterGrid.length > 0) {
        const bSet = deltaSource.before.settings;
        const aSet = deltaSource.after.settings;
        if (
          bSet &&
          aSet &&
          gridSettingsAffectKeys(bSet, aSet)
        ) {
          console.warn(
            "[栅格] 优化前/后处理时的栅格设置不一致（划分方式、边长或原点不同），" +
              "请用当前设置对两侧均「保存并重新处理」以完全对齐。"
          );
        }
        const deltaCells = buildGridDeltaCells(
          beforeGrid,
          afterGrid,
          settings
        );
        if (deltaCells.length > 0) {
          renderDeltaGridCells(
            viewer,
            deltaCells,
            mode === "heatmap",
            gridMetric,
            luceEntityIdsRef.current
          );
        }
      }
    } else if (luceData) {
      const gridCells = luceData.grid ?? [];
      if (showAsGrid && gridCells.length > 0) {
        renderGridCells(
          viewer,
          gridCells,
          settings,
          mode === "heatmap",
          gridMetric,
          luceEntityIdsRef.current,
          pciColorMap,
          rsrpRange,
          sinrRange
        );
      } else if (luceData.samples.length > 0) {
      const collection = new PointPrimitiveCollection();
      const maxPts = 25_000;
      const step = Math.max(1, Math.floor(luceData.samples.length / maxPts));
      for (let i = 0; i < luceData.samples.length; i += step) {
        const s = luceData.samples[i];
        collection.add({
          position: Cartesian3.fromDegrees(s.longitude, s.latitude, 2),
          color:
            metric === "pci"
              ? pciToColor(s.pci, pciColorMap)
              : metric === "rsrp"
                ? rsrpToColor(s.rsrp, rsrpRange)
                : sinrToColor(s.sinr as number, sinrRange),
          pixelSize: 5,
        });
      }
      viewer.scene.primitives.add(collection);
      pointCollectionRef.current = collection;
      }
    }

    resizeViewer();
  }, [
    luceData,
    beforeLuceData,
    afterLuceData,
    mapSettings,
    optimizationView,
    metric,
    pciColorMapProp,
  ]);

  return (
    <div
      ref={wrapRef}
      className={`cesium-map-wrap cesium-map--${theme}`}
      data-optimization-view={optimizationView}
    >
      <div ref={containerRef} className="cesium-map" />
      {baseMapError && (
        <div className="cesium-basemap-error" role="alert">
          {baseMapError}
        </div>
      )}
      {selectedCell && (
        <CellInfoPopup
          cell={selectedCell}
          x={popupPos.x}
          y={popupPos.y}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
}

type GridBounds = Pick<
  GridCell,
  "longitude" | "latitude" | "west" | "south" | "east" | "north"
>;

function boundsToRectangle(
  c: GridBounds,
  heatmap: boolean
): Rectangle {
  if (heatmap) {
    const padLon = (c.east - c.west) * 0.02;
    const padLat = (c.north - c.south) * 0.02;
    return Rectangle.fromDegrees(
      c.west - padLon,
      c.south - padLat,
      c.east + padLon,
      c.north + padLat
    );
  }
  return Rectangle.fromDegrees(c.west, c.south, c.east, c.north);
}

function gridCellColor(
  c: GridCell,
  metric: MapColorMetric,
  pciColorMap: Map<number, string> | undefined,
  rsrpRange: MetricColorRange,
  sinrRange: MetricColorRange
): Color {
  if (metric === "pci") return pciToColor(c.pci, pciColorMap);
  if (metric === "sinr") return sinrToColor(c.sinr as number, sinrRange);
  return rsrpToColor(c.rsrp, rsrpRange);
}

function renderDeltaGridCells(
  viewer: Viewer,
  cells: GridDeltaCell[],
  heatmap: boolean,
  metric: MapColorMetric,
  entityIds: string[]
): void {
  const maxCells = 15_000;
  const step = Math.max(1, Math.floor(cells.length / maxCells));
  for (let i = 0; i < cells.length; i += step) {
    const c = cells[i];
    const delta = metric === "rsrp" ? c.deltaRsrp : c.deltaSinr;
    const color =
      metric === "rsrp"
        ? deltaRsrpToColor(delta)
        : deltaSinrToColor(delta);
    const alpha = heatmap ? LUCE_GRID.heatmapAlpha : LUCE_GRID.gridAlpha;
    const id = `luce-delta-${i}`;
    viewer.entities.add({
      id,
      rectangle: {
        coordinates: boundsToRectangle(c, heatmap),
        material: color.withAlpha(alpha),
        outline: !heatmap,
        outlineColor: Color.BLACK.withAlpha(0.35),
        outlineWidth: 1,
        height: LUCE_GRID.heightMeters,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        classificationType: ClassificationType.TERRAIN,
      },
    });
    entityIds.push(id);
  }
}

function renderGridCells(
  viewer: Viewer,
  cells: GridCell[],
  settings: LuceSettings,
  heatmap: boolean,
  metric: MapColorMetric,
  entityIds: string[],
  pciColorMap: Map<number, string> | undefined,
  rsrpRange: MetricColorRange,
  sinrRange: MetricColorRange
): void {
  const sizeM = settings.gridSizeMeters;
  const gridOpts = gridIndexOptionsFromSettings(settings);
  const maxCells = 15_000;
  const step = Math.max(1, Math.floor(cells.length / maxCells));
  for (let i = 0; i < cells.length; i += step) {
    const c = cells[i];
    const color = gridCellColor(c, metric, pciColorMap, rsrpRange, sinrRange);
    const alpha = heatmap ? LUCE_GRID.heatmapAlpha : LUCE_GRID.gridAlpha;
    const id = `luce-grid-${i}`;
    const bounds = cellBoundsForDisplay(c, sizeM, gridOpts);
    viewer.entities.add({
      id,
      rectangle: {
        coordinates: boundsToRectangle(bounds, heatmap),
        material: color.withAlpha(alpha),
        outline: !heatmap,
        outlineColor: Color.BLACK.withAlpha(0.35),
        outlineWidth: 1,
        height: LUCE_GRID.heightMeters,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        classificationType: ClassificationType.TERRAIN,
      },
    });
    entityIds.push(id);
  }
}
