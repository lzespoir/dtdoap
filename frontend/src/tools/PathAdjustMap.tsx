import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  Viewer,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  HeadingPitchRange,
  LabelStyle,
  Matrix4,
  Rectangle,
  VerticalOrigin,
  HorizontalOrigin,
} from "cesium";
import { useEffect, useRef } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { DAYUN_STADIUM } from "../constants";
import {
  applyFollowStraighten,
  collectAdjustPoints,
  effectiveLonLat,
  listSegmentPathRanges,
  pathIndicesInSegmentFrom,
  pathPolylineLonLats,
  pointKey,
  type AdjustPoint,
  type PathAdjustDisplay,
  type PathAdjustLayer,
  type PathFollowAnchor,
} from "../lib/pathAdjust";

const FOLLOW_THROTTLE_MS = 100;
/** 编辑右键拖动灵敏度（<1 减小单步位移） */
const EDIT_MOVE_SCALE = 0.62;
const EDIT_MOVE_THROTTLE_MS = 90;

const IMAGERY_LIGHT =
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png";
const IMAGERY_DARK =
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png";
const SELECT_RECT_ID = "select-rect-preview";

export type PathAdjustMapMode = "navigate" | "edit" | "follow";

interface Props {
  theme: "light" | "dark";
  layers: PathAdjustLayer[];
  display: PathAdjustDisplay;
  selectedKeys: Set<string>;
  mode: PathAdjustMapMode;
  followAnchor: PathFollowAnchor | null;
  onFollowAnchorChange: (anchor: PathFollowAnchor | null) => void;
  onSelectionChange: (keys: Set<string>) => void;
  onMoveDelta: (
    dEast: number,
    dNorth: number,
    target: "selection" | "layers"
  ) => void;
  onFollowCommit: (layers: PathAdjustLayer[]) => void;
}

function cameraOffset(range: number): HeadingPitchRange {
  return new HeadingPitchRange(
    CesiumMath.toRadians(DAYUN_STADIUM.heading),
    CesiumMath.toRadians(DAYUN_STADIUM.pitch),
    range
  );
}

function unlockCamera(viewer: Viewer): void {
  if (viewer.isDestroyed()) return;
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
}

function flyToPoints(viewer: Viewer, positions: Cartesian3[]): void {
  if (viewer.isDestroyed()) return;
  if (positions.length === 0) {
    const target = Cartesian3.fromDegrees(
      DAYUN_STADIUM.longitude,
      DAYUN_STADIUM.latitude
    );
    viewer.camera.lookAt(target, cameraOffset(DAYUN_STADIUM.viewRange));
    unlockCamera(viewer);
    return;
  }
  const sphere = BoundingSphere.fromPoints(positions);
  const range = Math.min(Math.max(sphere.radius * 2.8, 200), 8000);
  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(
    sphere.center
  );
  const target = Cartesian3.fromRadians(carto.longitude, carto.latitude);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 80), {
    offset: cameraOffset(range),
    duration: 0.8,
    complete: () => unlockCamera(viewer),
  });
}

function cartographicFromScreen(
  viewer: Viewer,
  position: Cartesian2
): { lon: number; lat: number } | null {
  if (viewer.isDestroyed()) return null;
  const ray = viewer.camera.getPickRay(position);
  if (!ray) return null;
  const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
  if (!cartesian) return null;
  const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
  };
}

function meterDelta(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number }
): { east: number; north: number } {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((from.lat * Math.PI) / 180);
  return {
    east: (to.lon - from.lon) * mPerDegLat * cosLat,
    north: (to.lat - from.lat) * mPerDegLat,
  };
}

function pointsInRect(
  points: AdjustPoint[],
  layers: PathAdjustLayer[],
  west: number,
  east: number,
  south: number,
  north: number
): string[] {
  const w = Math.min(west, east);
  const e = Math.max(west, east);
  const s = Math.min(south, north);
  const n = Math.max(south, north);
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const keys: string[] = [];
  for (const p of points) {
    const layer = layerMap.get(p.layerId);
    if (!layer || !layer.visible || layer.locked) continue;
    const pos = effectiveLonLat(layer, p.baseLon, p.baseLat, p.key);
    if (
      pos.longitude >= w &&
      pos.longitude <= e &&
      pos.latitude >= s &&
      pos.latitude <= n
    ) {
      keys.push(p.key);
    }
  }
  return keys;
}

function clearViewerContainer(el: HTMLDivElement): void {
  try {
    el.replaceChildren();
  } catch {
    el.innerHTML = "";
  }
}

function safeDestroyHandler(handler: ScreenSpaceEventHandler | null): void {
  if (!handler) return;
  try {
    handler.destroy();
  } catch {
    /* already destroyed */
  }
}

function safeDestroyViewer(viewer: Viewer | null): void {
  if (!viewer || viewer.isDestroyed()) return;
  try {
    viewer.destroy();
  } catch {
    /* ignore */
  }
}

function updateSelectRectEntity(
  viewer: Viewer,
  start: Cartesian2,
  end: Cartesian2
): void {
  if (viewer.isDestroyed()) return;
  const a = cartographicFromScreen(viewer, start);
  const b = cartographicFromScreen(viewer, end);
  if (!a || !b) return;
  const coordinates = Rectangle.fromDegrees(
    Math.min(a.lon, b.lon),
    Math.min(a.lat, b.lat),
    Math.max(a.lon, b.lon),
    Math.max(a.lat, b.lat)
  );
  const existing = viewer.entities.getById(SELECT_RECT_ID);
  if (existing?.rectangle) {
    existing.rectangle.coordinates = new ConstantProperty(coordinates);
  } else {
    viewer.entities.add({
      id: SELECT_RECT_ID,
      rectangle: {
        coordinates,
        material: Color.CYAN.withAlpha(0.18),
        outline: true,
        outlineColor: Color.CYAN,
        outlineWidth: 2,
        height: 1,
      },
    });
  }
  viewer.scene.requestRender();
}

function removeSelectRectEntity(viewer: Viewer): void {
  if (viewer.isDestroyed()) return;
  try {
    viewer.entities.removeById(SELECT_RECT_ID);
  } catch {
    /* ignore */
  }
  viewer.scene.requestRender();
}

function updateSelectBoxOverlay(
  el: HTMLDivElement | null,
  start: Cartesian2,
  end: Cartesian2
): void {
  if (!el) return;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  el.style.display = "block";
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

function hideSelectBoxOverlay(el: HTMLDivElement | null): void {
  if (!el) return;
  el.style.display = "none";
}

function pathTermMarkerId(
  layerId: string,
  pathIndex: number,
  segmentIndex: number,
  kind: "start" | "end"
): string {
  return `path-term-${layerId}-${pathIndex}-${segmentIndex}-${kind}`;
}

function pathTermLabel(kind: "start" | "end") {
  return kind === "start"
    ? {
        text: "早",
        fill: Color.fromCssColorString("#1b8a5a"),
        bg: Color.fromCssColorString("#1b8a5a").withAlpha(0.85),
      }
    : {
        text: "晚",
        fill: Color.WHITE,
        bg: Color.fromCssColorString("#b71c1c").withAlpha(0.88),
      };
}

function positionForPathIndex(
  layer: PathAdjustLayer,
  pathIndex: number
): Cartesian3 | null {
  let idx = 0;
  for (const path of layer.item.result.paths) {
    for (const p of path.points) {
      if (idx === pathIndex) {
        const key = pointKey(layer.id, "path", idx);
        const pos = effectiveLonLat(layer, p.longitude, p.latitude, key);
        return Cartesian3.fromDegrees(pos.longitude, pos.latitude, 3);
      }
      idx++;
    }
  }
  return null;
}

function upsertPathTermMarker(
  viewer: Viewer,
  layer: PathAdjustLayer,
  range: {
    pathIndex: number;
    segmentIndex: number;
    startIdx: number;
    endIdx: number;
  },
  kind: "start" | "end",
  entityIds: string[]
): void {
  if (viewer.isDestroyed()) return;
  const flatIdx = kind === "start" ? range.startIdx : range.endIdx;
  const position = positionForPathIndex(layer, flatIdx);
  if (!position) return;

  const id = pathTermMarkerId(
    layer.id,
    range.pathIndex,
    range.segmentIndex,
    kind
  );
  const style = pathTermLabel(kind);
  const existing = viewer.entities.getById(id);
  if (existing) {
    existing.position = new ConstantPositionProperty(position);
    return;
  }

  viewer.entities.add({
    id,
    position,
    label: {
      text: style.text,
      font: "bold 13px sans-serif",
      fillColor: style.fill,
      backgroundColor: style.bg,
      showBackground: true,
      style: LabelStyle.FILL,
      verticalOrigin: VerticalOrigin.CENTER,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cartesian2(0, kind === "start" ? -14 : 14),
    },
  });
  entityIds.push(id);
}

function syncPathTermMarkers(
  viewer: Viewer,
  layer: PathAdjustLayer,
  entityIds: string[]
): void {
  for (const range of listSegmentPathRanges(layer)) {
    if (range.startIdx === range.endIdx) continue;
    upsertPathTermMarker(viewer, layer, range, "start", entityIds);
    upsertPathTermMarker(viewer, layer, range, "end", entityIds);
  }
}

function updateLayerPolylines(viewer: Viewer, layer: PathAdjustLayer): void {
  if (viewer.isDestroyed()) return;
  const polylines = pathPolylineLonLats(layer);
  for (let pathIdx = 0; pathIdx < polylines.length; pathIdx++) {
    const lineId = `line-${layer.id}-${pathIdx}`;
    const ent = viewer.entities.getById(lineId);
    const pts = polylines[pathIdx];
    if (!ent?.polyline || !pts || pts.length < 2) continue;
    const positions = pts.map((p) =>
      Cartesian3.fromDegrees(p.longitude, p.latitude, 2)
    );
    ent.polyline.positions = new ConstantProperty(positions);
  }
  for (const range of listSegmentPathRanges(layer)) {
    if (range.startIdx === range.endIdx) continue;
    for (const kind of ["start", "end"] as const) {
      const id = pathTermMarkerId(
        layer.id,
        range.pathIndex,
        range.segmentIndex,
        kind
      );
      const ent = viewer.entities.getById(id);
      const flatIdx = kind === "start" ? range.startIdx : range.endIdx;
      const position = positionForPathIndex(layer, flatIdx);
      if (ent && position) {
        ent.position = new ConstantPositionProperty(position);
      }
    }
  }
  viewer.scene.requestRender();
}

function pickNearestPathAnchor(
  viewer: Viewer,
  layers: PathAdjustLayer[],
  screenPos: Cartesian2,
  maxPx = 16
): PathFollowAnchor | null {
  let best: PathFollowAnchor | null = null;
  let bestDist = maxPx;
  const scratch = new Cartesian2();
  for (const layer of layers) {
    if (!layer.visible || layer.locked || !layer.active) continue;
    let pathIdx = 0;
    for (const path of layer.item.result.paths) {
      for (const p of path.points) {
        const key = pointKey(layer.id, "path", pathIdx);
        const pos = effectiveLonLat(layer, p.longitude, p.latitude, key);
        const win = viewer.scene.cartesianToCanvasCoordinates(
          Cartesian3.fromDegrees(pos.longitude, pos.latitude),
          scratch
        );
        if (win) {
          const d = Cartesian2.distance(win, screenPos);
          if (d < bestDist) {
            bestDist = d;
            best = {
              layerId: layer.id,
              fileName: layer.fileName,
              pathIndex: pathIdx,
            };
          }
        }
        pathIdx++;
      }
    }
  }
  return best;
}

export default function PathAdjustMap({
  theme,
  layers,
  display,
  selectedKeys,
  mode,
  followAnchor,
  onFollowAnchorChange,
  onSelectionChange,
  onMoveDelta,
  onFollowCommit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectBoxRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const entityIdsRef = useRef<string[]>([]);
  const didFlyRef = useRef(false);
  const mountIdRef = useRef(0);

  const layersRef = useRef(layers);
  const displayRef = useRef(display);
  const selectedKeysRef = useRef(selectedKeys);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onMoveDeltaRef = useRef(onMoveDelta);
  const onFollowCommitRef = useRef(onFollowCommit);
  const onFollowAnchorChangeRef = useRef(onFollowAnchorChange);
  const modeRef = useRef(mode);

  layersRef.current = layers;
  displayRef.current = display;
  selectedKeysRef.current = selectedKeys;
  onSelectionChangeRef.current = onSelectionChange;
  onMoveDeltaRef.current = onMoveDelta;
  onFollowCommitRef.current = onFollowCommit;
  onFollowAnchorChangeRef.current = onFollowAnchorChange;
  modeRef.current = mode;

  const dragRef = useRef<{
    active: boolean;
    startGeo: { lon: number; lat: number } | null;
  }>({ active: false, startGeo: null });
  const editMoveAccumRef = useRef({ east: 0, north: 0 });
  const editMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushEditMove = () => {
    if (editMoveTimerRef.current !== null) {
      clearTimeout(editMoveTimerRef.current);
      editMoveTimerRef.current = null;
    }
    const { east, north } = editMoveAccumRef.current;
    editMoveAccumRef.current = { east: 0, north: 0 };
    if (Math.abs(east) < 1e-6 && Math.abs(north) < 1e-6) return;
    const target =
      selectedKeysRef.current.size > 0 ? "selection" : "layers";
    onMoveDeltaRef.current(east, north, target);
  };

  const scheduleEditMove = () => {
    if (editMoveTimerRef.current !== null) return;
    editMoveTimerRef.current = setTimeout(() => {
      editMoveTimerRef.current = null;
      flushEditMove();
    }, EDIT_MOVE_THROTTLE_MS);
  };
  const followDragRef = useRef<{
    active: boolean;
    anchor: PathFollowAnchor | null;
    lastLon: number;
    lastLat: number;
  }>({ active: false, anchor: null, lastLon: 0, lastLat: 0 });
  const followDraftLayersRef = useRef<PathAdjustLayer[] | null>(null);
  const followTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFollowPreviewRef = useRef<() => void>(() => {});
  runFollowPreviewRef.current = () => {
    const v = viewerRef.current;
    const anchor = followDragRef.current.anchor;
    const draft = followDraftLayersRef.current;
    if (!v || v.isDestroyed() || !anchor || !draft) return;
    const next = applyFollowStraighten(
      draft,
      anchor,
      followDragRef.current.lastLon,
      followDragRef.current.lastLat,
      { interactive: true, pathOnly: true }
    );
    followDraftLayersRef.current = next;
    const layer = next.find((l) => l.id === anchor.layerId);
    if (layer) updateLayerPolylines(v, layer);
  };

  const scheduleFollowPreview = (lon: number, lat: number) => {
    followDragRef.current.lastLon = lon;
    followDragRef.current.lastLat = lat;
    if (followTimerRef.current !== null) return;
    followTimerRef.current = setTimeout(() => {
      followTimerRef.current = null;
      runFollowPreviewRef.current();
    }, FOLLOW_THROTTLE_MS);
  };

  const flushFollowStraighten = () => {
    if (followTimerRef.current !== null) {
      clearTimeout(followTimerRef.current);
      followTimerRef.current = null;
    }
    const a = followDragRef.current.anchor;
    if (!a) return;
    const base = followDraftLayersRef.current ?? layersRef.current;
    const final = applyFollowStraighten(
      base,
      a,
      followDragRef.current.lastLon,
      followDragRef.current.lastLat,
      { interactive: false, pathOnly: false }
    );
    followDraftLayersRef.current = null;
    onFollowCommitRef.current(final);
  };
  const selectRef = useRef<{
    active: boolean;
    start: Cartesian2 | null;
    end: Cartesian2 | null;
  }>({ active: false, start: null, end: null });

  const cancelSelectDrag = (viewer: Viewer | null) => {
    selectRef.current = { active: false, start: null, end: null };
    hideSelectBoxOverlay(selectBoxRef.current);
    if (viewer && !viewer.isDestroyed()) {
      removeSelectRectEntity(viewer);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    clearViewerContainer(container);
    const mountId = ++mountIdRef.current;

    const viewer = new Viewer(container, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      creditContainer: document.createElement("div"),
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,
    });
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewerRef.current = viewer;

    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: theme === "light" ? IMAGERY_LIGHT : IMAGERY_DARK,
        maximumLevel: 18,
      })
    );

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    const getViewer = () => {
      const v = viewerRef.current;
      if (!v || v.isDestroyed() || mountIdRef.current !== mountId) return null;
      return v;
    };

    handler.setInputAction((click: { position: Cartesian2 }) => {
      const v = getViewer();
      if (!v) return;
      if (modeRef.current === "edit") {
        selectRef.current = {
          active: true,
          start: Cartesian2.clone(click.position),
          end: Cartesian2.clone(click.position),
        };
      } else if (modeRef.current === "follow") {
        const pick = pickNearestPathAnchor(v, layersRef.current, click.position);
        if (!pick) return;
        const geo = cartographicFromScreen(v, click.position);
        if (!geo) return;
        onFollowAnchorChangeRef.current(pick);
        followDraftLayersRef.current = layersRef.current.map((l) => ({
          ...l,
          pointOffsets: { ...l.pointOffsets },
        }));
        followDragRef.current = {
          active: true,
          anchor: pick,
          lastLon: geo.lon,
          lastLat: geo.lat,
        };
        runFollowPreviewRef.current();
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((click: { position: Cartesian2 }) => {
      const v = getViewer();
      if (!v || modeRef.current !== "edit") return;
      if (selectRef.current.active) {
        cancelSelectDrag(v);
      }
      const geo = cartographicFromScreen(v, click.position);
      if (!geo) return;
      dragRef.current = { active: true, startGeo: geo };
    }, ScreenSpaceEventType.RIGHT_DOWN);

    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const v = getViewer();
      if (!v) return;
      if (modeRef.current === "edit" && selectRef.current.active) {
        const start = selectRef.current.start;
        if (!start) return;
        const end = Cartesian2.clone(movement.endPosition);
        selectRef.current.end = end;
        updateSelectBoxOverlay(selectBoxRef.current, start, end);
        updateSelectRectEntity(v, start, end);
      } else if (
        modeRef.current === "edit" &&
        dragRef.current.active &&
        dragRef.current.startGeo
      ) {
        const geo = cartographicFromScreen(v, movement.endPosition);
        if (!geo || !dragRef.current.startGeo) return;
        const delta = meterDelta(dragRef.current.startGeo, geo);
        dragRef.current.startGeo = geo;
        const dEast = delta.east * EDIT_MOVE_SCALE;
        const dNorth = delta.north * EDIT_MOVE_SCALE;
        if (Math.abs(dEast) < 0.005 && Math.abs(dNorth) < 0.005) return;
        editMoveAccumRef.current.east += dEast;
        editMoveAccumRef.current.north += dNorth;
        scheduleEditMove();
      } else if (
        modeRef.current === "follow" &&
        followDragRef.current.active &&
        followDragRef.current.anchor
      ) {
        const geo = cartographicFromScreen(v, movement.endPosition);
        if (!geo) return;
        scheduleFollowPreview(geo.lon, geo.lat);
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      const v = getViewer();
      if (!v) return;
      if (modeRef.current === "edit") {
        const sel = selectRef.current;
        hideSelectBoxOverlay(selectBoxRef.current);
        removeSelectRectEntity(v);
        selectRef.current = { active: false, start: null, end: null };
        if (!sel.start || !sel.end) return;
        const dx = Math.abs(sel.end.x - sel.start.x);
        const dy = Math.abs(sel.end.y - sel.start.y);
        if (dx < 4 && dy < 4) return;
        const a = cartographicFromScreen(v, sel.start);
        const b = cartographicFromScreen(v, sel.end);
        if (!a || !b) return;
        const allPoints = layersRef.current.flatMap((l) =>
          collectAdjustPoints(l, displayRef.current)
        );
        const keys = pointsInRect(
          allPoints,
          layersRef.current,
          a.lon,
          b.lon,
          a.lat,
          b.lat
        );
        const next = new Set(selectedKeysRef.current);
        for (const k of keys) next.add(k);
        onSelectionChangeRef.current(next);
      } else if (modeRef.current === "follow") {
        followDragRef.current = {
          ...followDragRef.current,
          active: false,
        };
        flushFollowStraighten();
      }
      v.scene.requestRender();
    }, ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction(() => {
      const v = getViewer();
      if (!v) return;
      if (modeRef.current === "edit" && dragRef.current.active) {
        dragRef.current = { active: false, startGeo: null };
        flushEditMove();
        v.scene.requestRender();
      }
    }, ScreenSpaceEventType.RIGHT_UP);

    const preventContextMenu = (e: Event) => e.preventDefault();
    viewer.scene.canvas.addEventListener("contextmenu", preventContextMenu);

    const target = Cartesian3.fromDegrees(
      DAYUN_STADIUM.longitude,
      DAYUN_STADIUM.latitude
    );
    viewer.camera.lookAt(target, cameraOffset(DAYUN_STADIUM.viewRange));
    unlockCamera(viewer);

    return () => {
      mountIdRef.current += 1;
      const h = handlerRef.current;
      const v = viewerRef.current;
      handlerRef.current = null;
      viewerRef.current = null;
      entityIdsRef.current = [];
      didFlyRef.current = false;
      dragRef.current = { active: false, startGeo: null };
      followDragRef.current = { active: false, anchor: null, lastLon: 0, lastLat: 0 };
      followDraftLayersRef.current = null;
      if (followTimerRef.current !== null) {
        clearTimeout(followTimerRef.current);
        followTimerRef.current = null;
      }
      hideSelectBoxOverlay(selectBoxRef.current);
      selectRef.current = { active: false, start: null, end: null };
      try {
        if (v && !v.isDestroyed()) {
          v.scene.canvas.removeEventListener("contextmenu", preventContextMenu);
        }
      } catch {
        /* ignore */
      }
      safeDestroyHandler(h);
      safeDestroyViewer(v);
      clearViewerContainer(container);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewer mounts once per container
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: theme === "light" ? IMAGERY_LIGHT : IMAGERY_DARK,
        maximumLevel: 18,
      })
    );
    viewer.scene.requestRender();
  }, [theme]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (mode === "edit") {
      dragRef.current = { active: false, startGeo: null };
      editMoveAccumRef.current = { east: 0, north: 0 };
      if (editMoveTimerRef.current !== null) {
        clearTimeout(editMoveTimerRef.current);
        editMoveTimerRef.current = null;
      }
      cancelSelectDrag(viewer);
    }
    if (mode === "follow") {
      followDragRef.current = { active: false, anchor: null, lastLon: 0, lastLat: 0 };
      followDraftLayersRef.current = null;
      if (followTimerRef.current !== null) {
        clearTimeout(followTimerRef.current);
        followTimerRef.current = null;
      }
    }
    if (mode !== "follow") {
      onFollowAnchorChangeRef.current(null);
    }
    viewer.scene.screenSpaceCameraController.enableInputs = mode === "navigate";
    viewer.scene.requestRender();
  }, [mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const id of entityIdsRef.current) {
      try {
        viewer.entities.removeById(id);
      } catch {
        /* ignore */
      }
    }
    entityIdsRef.current = [];

    const flyPositions: Cartesian3[] = [];
    const followLayer = followAnchor
      ? layers.find((l) => l.id === followAnchor.layerId)
      : null;
    const followKeys =
      followLayer && followAnchor
        ? new Set(
            pathIndicesInSegmentFrom(followLayer, followAnchor.pathIndex).map(
              (i) => pointKey(followLayer.id, "path", i)
            )
          )
        : new Set<string>();
    const liteFollow = mode === "follow";
    const sampleCap = liteFollow ? 500 : 8000;
    const pathPointCap = liteFollow ? 800 : 1500;

    const pointVisual = (
      key: string,
      layerColor: string,
      selected: boolean,
      baseSize: number
    ) => {
      const isAnchor =
        followAnchor &&
        key === pointKey(followAnchor.layerId, "path", followAnchor.pathIndex);
      const inFollow = followKeys.has(key);
      if (isAnchor) {
        return {
          pixelSize: 14,
          color: Color.fromCssColorString("#ff6d00"),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
        };
      }
      if (selected) {
        return {
          pixelSize: baseSize + 4,
          color: Color.YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
        };
      }
      if (inFollow) {
        return {
          pixelSize: baseSize + 2,
          color: Color.fromCssColorString("#ffb74d").withAlpha(0.95),
          outlineColor: Color.fromCssColorString("#e65100"),
          outlineWidth: 1,
        };
      }
      return {
        pixelSize: baseSize,
        color: Color.fromCssColorString(layerColor).withAlpha(
          baseSize <= 4 ? 0.75 : 0.85
        ),
        outlineColor: Color.TRANSPARENT,
        outlineWidth: 0,
      };
    };

    for (const layer of layers) {
      if (!layer.visible) continue;
      let pathPointIdx = 0;
      for (let pathIdx = 0; pathIdx < layer.item.result.paths.length; pathIdx++) {
        const path = layer.item.result.paths[pathIdx];
        const positions: Cartesian3[] = [];
        for (const p of path.points) {
          const key = `${layer.id}:path:${pathPointIdx}`;
          const pos = effectiveLonLat(layer, p.longitude, p.latitude, key);
          const c = Cartesian3.fromDegrees(pos.longitude, pos.latitude, 2);
          positions.push(c);
          flyPositions.push(c);
          pathPointIdx++;
        }
        if (positions.length >= 2) {
          const lineId = `line-${layer.id}-${pathIdx}`;
          viewer.entities.add({
            id: lineId,
            polyline: {
              positions,
              width: 3,
              material: Color.fromCssColorString(layer.color).withAlpha(0.9),
            },
          });
          entityIdsRef.current.push(lineId);
        }
      }

      syncPathTermMarkers(viewer, layer, entityIdsRef.current);

      if (display === "samples" || display === "both") {
        const pts = collectAdjustPoints(layer, "samples", sampleCap);
        for (const p of pts) {
          const pos = effectiveLonLat(layer, p.baseLon, p.baseLat, p.key);
          const entId = `pt-${p.key}`;
          const selected = selectedKeys.has(p.key);
          const visual = pointVisual(p.key, layer.color, selected, 4);
          viewer.entities.add({
            id: entId,
            position: Cartesian3.fromDegrees(pos.longitude, pos.latitude, 2),
            point: visual,
          });
          entityIdsRef.current.push(entId);
        }
      }

      if (display === "path" || display === "both") {
        const pts = collectAdjustPoints(layer, "path");
        const step =
          pts.length > pathPointCap
            ? Math.ceil(pts.length / pathPointCap)
            : 1;
        for (let i = 0; i < pts.length; i += step) {
          const p = pts[i];
          const pos = effectiveLonLat(layer, p.baseLon, p.baseLat, p.key);
          const entId = `pt-${p.key}`;
          const selected = selectedKeys.has(p.key);
          const visual = pointVisual(p.key, layer.color, selected, 5);
          viewer.entities.add({
            id: entId,
            position: Cartesian3.fromDegrees(pos.longitude, pos.latitude, 2),
            point: visual,
          });
          entityIdsRef.current.push(entId);
        }
      }
    }

    if (!didFlyRef.current && flyPositions.length > 0) {
      didFlyRef.current = true;
      flyToPoints(viewer, flyPositions);
    }

    viewer.scene.requestRender();
  }, [layers, display, selectedKeys, followAnchor, mode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const v = viewerRef.current;
      if (selectRef.current.active) {
        cancelSelectDrag(v && !v.isDestroyed() ? v : null);
        return;
      }
      if (followDragRef.current.active) {
        followDragRef.current = {
          ...followDragRef.current,
          active: false,
        };
        followDraftLayersRef.current = null;
        if (followTimerRef.current !== null) {
          clearTimeout(followTimerRef.current);
          followTimerRef.current = null;
        }
        const anchor = followDragRef.current.anchor;
        if (v && !v.isDestroyed() && anchor) {
          const layer = layersRef.current.find((l) => l.id === anchor.layerId);
          if (layer) updateLayerPolylines(v, layer);
        }
        return;
      }
      if (modeRef.current === "follow") {
        onFollowAnchorChangeRef.current(null);
        return;
      }
      if (selectedKeysRef.current.size > 0) {
        onSelectionChangeRef.current(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className={`path-adjust-map-wrap${
        mode === "edit"
          ? " path-adjust-map-wrap--edit"
          : mode === "follow"
            ? " path-adjust-map-wrap--follow"
            : ""
      }`}
    >
      <div ref={containerRef} className="path-adjust-map" />
      <div ref={selectBoxRef} className="path-adjust-select-box" aria-hidden />
      {mode === "edit" && (
        <p className="path-adjust-map-hint">
          左键拖拽框选；右键拖动移动（有选区移选区，否则移已启用图层）。Esc
          取消框选或清空选区
        </p>
      )}
    </div>
  );
}
