import {
  BoundingSphere,
  CameraEventType,
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
  Matrix4,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
} from "cesium";
import { useEffect, useRef } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { DAYUN_STADIUM } from "../constants";
import type { PathAdjustLayer } from "../lib/pathAdjust";
import {
  offsetMeters,
  shapeToPolylinePositions,
  type LonLat,
} from "../lib/pathShapeGeometry";
import type { ReferenceShape, ShapeKind } from "../lib/pathShapeSnap";

const IMAGERY_LIGHT =
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png";
const IMAGERY_DARK =
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png";

export type PathShapeSnapMapMode = "navigate" | "draw" | "edit-shape";

interface Props {
  theme: "light" | "dark";
  layers: PathAdjustLayer[];
  displayTrails: Record<string, LonLat[]>;
  rangeHighlight?: {
    layerId: string;
    start: number;
    end: number;
    segment: LonLat[];
  } | null;
  trailRevision: number;
  shapes: ReferenceShape[];
  draftPoints: LonLat[];
  draftKind: ShapeKind;
  draftRadiiM?: { east: number; north: number };
  mode: PathShapeSnapMapMode;
  selectedShapeId: string | null;
  bindingHighlight?: { start: number; end: number } | null;
  onMapClick: (pt: LonLat) => void;
  onMapMove: (pt: LonLat) => void;
  onMapDoubleClick: () => void;
  onShapesChange: (shapes: ReferenceShape[]) => void;
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
): LonLat | null {
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

function clearViewerContainer(el: HTMLDivElement): void {
  try {
    el.replaceChildren();
  } catch {
    el.innerHTML = "";
  }
}

function lonLatsToPositions(pts: LonLat[], height = 3): Cartesian3[] {
  return pts.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, height));
}

function draftPolylinePositions(
  kind: ShapeKind,
  points: LonLat[],
  radiiM?: { east: number; north: number }
): LonLat[] {
  if (kind === "ellipse" && points.length >= 1 && radiiM) {
    const center = points[0]!;
    const steps = 64;
    const out: LonLat[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push(
        offsetMeters(
          center,
          radiiM.east * Math.cos(a),
          radiiM.north * Math.sin(a)
        )
      );
    }
    return out;
  }
  if (kind === "rectangle" && points.length >= 2) {
    const a = points[0]!;
    const b = points[1]!;
    return [
      a,
      { lon: b.lon, lat: a.lat },
      b,
      { lon: a.lon, lat: b.lat },
      a,
    ];
  }
  if (kind === "line" && points.length >= 2) {
    return [points[0]!, points[1]!];
  }
  return points;
}

function previewTrail(layer: PathAdjustLayer): LonLat[] {
  return layer.item.result.samples.map((s) => ({
    lon: s.longitude,
    lat: s.latitude,
  }));
}

function configureCameraForMode(viewer: Viewer, mode: PathShapeSnapMapMode) {
  const ctrl = viewer.scene.screenSpaceCameraController;
  if (mode === "navigate") {
    ctrl.enableInputs = true;
    ctrl.enableRotate = true;
    ctrl.enableTranslate = true;
    ctrl.enableZoom = true;
    ctrl.enableTilt = true;
    ctrl.translateEventTypes = [
      CameraEventType.LEFT_DRAG,
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.RIGHT_DRAG,
    ];
    ctrl.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
  } else {
    ctrl.enableInputs = true;
    ctrl.enableRotate = false;
    ctrl.enableTilt = false;
    ctrl.enableZoom = true;
    ctrl.enableTranslate = true;
    ctrl.translateEventTypes = [
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.RIGHT_DRAG,
    ];
    ctrl.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
  }
}

function ellipseRadiiFromCenter(center: LonLat, edge: LonLat) {
  const mPerDegLat = 111_320;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  return {
    east: Math.max(
      5,
      Math.abs((edge.lon - center.lon) * mPerDegLat * cosLat)
    ),
    north: Math.max(5, Math.abs((edge.lat - center.lat) * mPerDegLat)),
  };
}

function updateShapeVertex(
  shapes: ReferenceShape[],
  shapeId: string,
  vertexIndex: number,
  pt: LonLat
): ReferenceShape[] {
  return shapes.map((s) => {
    if (s.id !== shapeId) return s;
    if (s.kind === "ellipse") {
      const center = s.points[0]!;
      if (vertexIndex === 0) return { ...s, points: [pt] };
      if (vertexIndex === 1) {
        return { ...s, radiiM: ellipseRadiiFromCenter(center, pt) };
      }
      return s;
    }
    const points = [...s.points];
    if (vertexIndex >= 0 && vertexIndex < points.length) {
      points[vertexIndex] = pt;
    }
    return { ...s, points };
  });
}

function syncShapeEntities(
  viewer: Viewer,
  shapes: ReferenceShape[],
  selectedShapeId: string | null,
  entityIds: string[],
  replaceIds: string[]
) {
  for (const id of replaceIds) {
    try {
      viewer.entities.removeById(id);
    } catch {
      /* ignore */
    }
    const idx = entityIds.indexOf(id);
    if (idx >= 0) entityIds.splice(idx, 1);
  }

  for (const shape of shapes) {
    const positions = lonLatsToPositions(
      shapeToPolylinePositions({
        kind: shape.kind,
        points: shape.points,
        radiiM: shape.radiiM,
        startAngleRad: shape.startAngleRad,
      }),
      4
    );
    if (positions.length >= 2) {
      const lineId = `ref-shape-${shape.id}`;
      const existing = viewer.entities.getById(lineId);
      if (existing?.polyline) {
        existing.polyline.positions = new ConstantProperty(positions);
        existing.polyline.width = new ConstantProperty(
          shape.id === selectedShapeId ? 5 : 3
        );
      } else {
        viewer.entities.add({
          id: lineId,
          polyline: {
            positions,
            width: shape.id === selectedShapeId ? 5 : 3,
            material: Color.fromCssColorString(shape.color).withAlpha(
              shape.role === "constraint" ? 0.55 : 0.95
            ),
            clampToGround: true,
          },
        });
        entityIds.push(lineId);
      }
    }

    shape.points.forEach((pt, vi) => {
      if (shape.kind === "ellipse" && vi > 0) return;
      const handleId = `shape-vertex::${shape.id}::${vi}`;
      const pos = Cartesian3.fromDegrees(pt.lon, pt.lat, 5);
      const existing = viewer.entities.getById(handleId);
      if (existing) {
        existing.position = new ConstantPositionProperty(pos);
      } else {
        viewer.entities.add({
          id: handleId,
          position: pos,
          point: {
            pixelSize: shape.id === selectedShapeId ? 10 : 7,
            color: Color.fromCssColorString(shape.color),
            outlineColor: Color.WHITE,
            outlineWidth: 1,
          },
        });
        entityIds.push(handleId);
      }
    });

    if (shape.kind === "ellipse" && shape.radiiM && shape.points[0]) {
      const axisPt = offsetMeters(shape.points[0], shape.radiiM.east, 0);
      const handleId = `shape-vertex::${shape.id}::1`;
      const pos = Cartesian3.fromDegrees(axisPt.lon, axisPt.lat, 5);
      const existing = viewer.entities.getById(handleId);
      if (existing) {
        existing.position = new ConstantPositionProperty(pos);
      } else {
        viewer.entities.add({
          id: handleId,
          position: pos,
          point: {
            pixelSize: 8,
            color: Color.WHITE,
            outlineColor: Color.fromCssColorString(shape.color),
            outlineWidth: 2,
          },
        });
        entityIds.push(handleId);
      }
    }
  }
  viewer.scene.requestRender();
}

function syncDraftOverlay(
  viewer: Viewer,
  draftKind: ShapeKind,
  draftPoints: LonLat[],
  draftRadiiM?: { east: number; north: number }
) {
  try {
    viewer.entities.removeById("draft-shape");
    for (const e of viewer.entities.values) {
      const id = e.id;
      if (typeof id === "string" && id.startsWith("draft-pt-")) {
        viewer.entities.remove(e);
      }
    }
  } catch {
    /* ignore */
  }

  const draftLine = draftPolylinePositions(draftKind, draftPoints, draftRadiiM);
  if (draftLine.length >= 2) {
    viewer.entities.add({
      id: "draft-shape",
      polyline: {
        positions: lonLatsToPositions(draftLine, 5),
        width: 2,
        material: Color.CYAN.withAlpha(0.85),
        clampToGround: true,
      },
    });
    for (let i = 0; i < draftPoints.length; i++) {
      const p = draftPoints[i]!;
      viewer.entities.add({
        id: `draft-pt-${i}`,
        position: Cartesian3.fromDegrees(p.lon, p.lat, 6),
        point: {
          pixelSize: 8,
          color: Color.CYAN,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        },
      });
    }
  }
  viewer.scene.requestRender();
}

function syncRangeHighlight(
  viewer: Viewer,
  rangeHighlight: Props["rangeHighlight"]
) {
  const ids = [
    "range-highlight-line",
    "range-highlight-start",
    "range-highlight-end",
  ];
  for (const id of ids) {
    try {
      viewer.entities.removeById(id);
    } catch {
      /* ignore */
    }
  }
  if (!rangeHighlight || rangeHighlight.segment.length < 2) {
    viewer.scene.requestRender();
    return;
  }
  const positions = lonLatsToPositions(rangeHighlight.segment, 4);
  viewer.entities.add({
    id: "range-highlight-line",
    polyline: {
      positions,
      width: 6,
      material: Color.YELLOW.withAlpha(0.95),
      clampToGround: true,
    },
  });
  const start = rangeHighlight.segment[0]!;
  const end = rangeHighlight.segment[rangeHighlight.segment.length - 1]!;
  viewer.entities.add({
    id: "range-highlight-start",
    position: Cartesian3.fromDegrees(start.lon, start.lat, 6),
    label: {
      text: "起",
      font: "bold 12px sans-serif",
      fillColor: Color.BLACK,
      backgroundColor: Color.YELLOW.withAlpha(0.9),
      showBackground: true,
      style: LabelStyle.FILL,
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cartesian2(0, -8),
    },
    point: {
      pixelSize: 10,
      color: Color.YELLOW,
      outlineColor: Color.BLACK,
      outlineWidth: 2,
    },
  });
  viewer.entities.add({
    id: "range-highlight-end",
    position: Cartesian3.fromDegrees(end.lon, end.lat, 6),
    label: {
      text: "止",
      font: "bold 12px sans-serif",
      fillColor: Color.WHITE,
      backgroundColor: Color.fromCssColorString("#e65100").withAlpha(0.9),
      showBackground: true,
      style: LabelStyle.FILL,
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cartesian2(0, -8),
    },
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString("#e65100"),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
    },
  });
  viewer.scene.requestRender();
}

export default function PathShapeSnapMap({
  theme,
  layers,
  displayTrails,
  rangeHighlight,
  trailRevision,
  shapes,
  draftPoints,
  draftKind,
  draftRadiiM,
  mode,
  selectedShapeId,
  onMapClick,
  onMapMove,
  onMapDoubleClick,
  onShapesChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entityIdsRef = useRef<string[]>([]);
  const mountIdRef = useRef(0);
  const flewRef = useRef(false);
  const onMapClickRef = useRef(onMapClick);
  const onMapMoveRef = useRef(onMapMove);
  const onMapDoubleClickRef = useRef(onMapDoubleClick);
  const onShapesChangeRef = useRef(onShapesChange);
  const modeRef = useRef(mode);
  const shapesRef = useRef(shapes);
  const dragRef = useRef<{
    shapeId: string;
    vertexIndex: number;
    live: ReferenceShape[];
  } | null>(null);

  onMapClickRef.current = onMapClick;
  onMapMoveRef.current = onMapMove;
  onMapDoubleClickRef.current = onMapDoubleClick;
  onShapesChangeRef.current = onShapesChange;
  modeRef.current = mode;
  shapesRef.current = shapes;

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
    });
    viewerRef.current = viewer;
    configureCameraForMode(viewer, "navigate");

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const geo = cartographicFromScreen(viewer, movement.position);
      if (!geo) return;
      if (modeRef.current === "draw") {
        onMapClickRef.current(geo);
        return;
      }
      if (modeRef.current === "edit-shape") {
        const picked = viewer.scene.pick(movement.position);
        const id = picked?.id?.id as string | undefined;
        if (id?.startsWith("shape-vertex::")) {
          const body = id.slice("shape-vertex::".length);
          const sep = body.lastIndexOf("::");
          if (sep > 0) {
            const shapeId = body.slice(0, sep);
            const vertexIndex = Number(body.slice(sep + 2));
            if (shapeId && Number.isFinite(vertexIndex)) {
              dragRef.current = {
                shapeId,
                vertexIndex,
                live: [...shapesRef.current],
              };
            }
          }
        }
      }
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      const geo = cartographicFromScreen(viewer, movement.endPosition);
      if (!geo) return;
      if (modeRef.current === "draw") {
        onMapMoveRef.current(geo);
        return;
      }
      const drag = dragRef.current;
      if (drag && modeRef.current === "edit-shape") {
        drag.live = updateShapeVertex(
          drag.live,
          drag.shapeId,
          drag.vertexIndex,
          geo
        );
        const shapeIds = drag.live.map((s) => `ref-shape-${s.id}`);
        const handleIds = drag.live.flatMap((s) => {
          const ids = [`shape-vertex::${s.id}::0`];
          if (s.kind === "ellipse") ids.push(`shape-vertex::${s.id}::1`);
          else
            s.points.forEach((_, vi) => {
              if (vi > 0) ids.push(`shape-vertex::${s.id}::${vi}`);
            });
          return ids;
        });
        syncShapeEntities(
          viewer,
          drag.live,
          selectedShapeId,
          entityIdsRef.current,
          [...shapeIds, ...handleIds]
        );
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      const drag = dragRef.current;
      if (drag) {
        onShapesChangeRef.current(drag.live);
        dragRef.current = null;
      }
    }, ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction(() => {
      if (modeRef.current === "draw") {
        onMapDoubleClickRef.current();
      }
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modeRef.current === "draw") {
        onMapDoubleClickRef.current();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      if (mountId !== mountIdRef.current) return;
      try {
        handler.destroy();
      } catch {
        /* ignore */
      }
      try {
        if (!viewer.isDestroyed()) viewer.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
      clearViewerContainer(container);
    };
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
    configureCameraForMode(viewer, mode);
    viewer.scene.requestRender();
  }, [mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    syncDraftOverlay(viewer, draftKind, draftPoints, draftRadiiM);
  }, [draftKind, draftPoints, draftRadiiM]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    syncRangeHighlight(viewer, rangeHighlight);
  }, [rangeHighlight]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (dragRef.current) return;

    for (const id of entityIdsRef.current) {
      try {
        viewer.entities.removeById(id);
      } catch {
        /* ignore */
      }
    }
    entityIdsRef.current = [];

    const flyPositions: Cartesian3[] = [];

    for (const layer of layers) {
      if (!layer.visible) continue;
      const trail = displayTrails[layer.id] ?? previewTrail(layer);
      if (trail.length >= 2) {
        const positions = trail.map((p) => {
          const c = Cartesian3.fromDegrees(p.lon, p.lat, 2);
          flyPositions.push(c);
          return c;
        });
        const lineId = `trail-${layer.id}`;
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

    syncShapeEntities(
      viewer,
      shapes,
      selectedShapeId,
      entityIdsRef.current,
      []
    );

    if (!flewRef.current && flyPositions.length > 0) {
      flewRef.current = true;
      flyToPoints(viewer, flyPositions);
    } else {
      viewer.scene.requestRender();
    }
  }, [layers, displayTrails, shapes, selectedShapeId, trailRevision]);

  const wrapClass =
    mode === "draw" || mode === "edit-shape"
      ? "path-adjust-map-wrap path-adjust-map-wrap--edit"
      : "path-adjust-map-wrap";

  return (
    <div className={wrapClass}>
      <div ref={containerRef} className="path-adjust-map" />
      <p className="path-adjust-map-hint">
        {mode === "navigate" && "导航：左键平移，滚轮缩放"}
        {mode === "draw" &&
          "绘制：左键落点，滚轮缩放，右键/中键平移；折线双击结束"}
        {mode === "edit-shape" &&
          "编辑：拖动控制点；滚轮缩放，右键/中键平移"}
      </p>
    </div>
  );
}
