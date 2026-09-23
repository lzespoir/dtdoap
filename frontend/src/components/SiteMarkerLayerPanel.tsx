import type { SiteMarkerLayer } from "../types/mapLayers";

interface Props {
  layer: SiteMarkerLayer;
  onChange: (next: SiteMarkerLayer) => void;
}

export default function SiteMarkerLayerPanel({ layer, onChange }: Props) {
  const patch = (partial: Partial<SiteMarkerLayer>) => {
    onChange({ ...layer, ...partial });
  };

  return (
    <div className="layer-detail-panel">
      <label>
        图层名称
        <input
          type="text"
          value={layer.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label>
        标注文字
        <input
          type="text"
          placeholder="场地名称"
          value={layer.label}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </label>
      <label>
        经度
        <input
          type="number"
          step={0.000001}
          value={layer.longitude}
          onChange={(e) => patch({ longitude: Number(e.target.value) })}
        />
      </label>
      <label>
        纬度
        <input
          type="number"
          step={0.000001}
          value={layer.latitude}
          onChange={(e) => patch({ latitude: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
