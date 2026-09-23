import GroundOverlayDetailPanel from "./GroundOverlayDetailPanel";
import Model3dDetailPanel from "./Model3dDetailPanel";
import SiteMarkerLayerPanel from "./SiteMarkerLayerPanel";
import {
  MAP_LAYER_TYPE_META,
  type MapLayer,
  type MapLayerType,
} from "../types/mapLayers";

interface LayerDetailModalProps {
  layer: MapLayer;
  onChange: (next: MapLayer) => void;
  onClose: () => void;
}

export default function LayerDetailModal({
  layer,
  onChange,
  onClose,
}: LayerDetailModalProps) {
  const meta = MAP_LAYER_TYPE_META[layer.type as MapLayerType];

  return (
    <div className="layer-detail-modal" role="dialog" aria-label="图层设置">
      <div className="layer-detail-modal-backdrop" onClick={onClose} />
      <div className="layer-detail-modal-card">
        <header className="layer-detail-modal-header">
          <div>
            <h3>{layer.name}</h3>
            <p className="layer-detail-modal-type">{meta.title}</p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <div className="layer-detail-modal-body">
          {layer.type === "siteMarker" && (
            <SiteMarkerLayerPanel
              layer={layer}
              onChange={onChange as (n: typeof layer) => void}
            />
          )}
          {layer.type === "groundOverlay" && (
            <GroundOverlayDetailPanel
              layer={layer}
              onChange={onChange as (n: typeof layer) => void}
            />
          )}
          {layer.type === "model3d" && (
            <Model3dDetailPanel
              layer={layer}
              onChange={onChange as (n: typeof layer) => void}
            />
          )}
        </div>
        <footer className="layer-detail-modal-footer">
          <button type="button" className="primary-btn" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}
