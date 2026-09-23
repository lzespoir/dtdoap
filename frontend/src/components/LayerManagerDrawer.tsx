import { useEffect, useMemo, useState } from "react";
import LayerDetailModal from "./LayerDetailModal";
import {
  BASE_MAP_PROVIDERS,
  BASE_MAP_PROVIDER_ORDER,
  saveBaseMapConfig,
  type BaseMapConfig,
  type BaseMapProvider,
} from "../types/baseMap";
import {
  MAP_LAYER_TYPE_META,
  createLayer,
  saveMapLayers,
  type MapLayer,
  type MapLayerType,
  type MapLayersState,
} from "../types/mapLayers";

interface LayerManagerDrawerProps {
  open: boolean;
  onClose: () => void;
  layers: MapLayersState;
  onChange: (next: MapLayersState) => void;
  baseMap: BaseMapConfig;
  onBaseMapChange: (next: BaseMapConfig) => void;
}

function layerTypeLabel(type: MapLayerType): string {
  return MAP_LAYER_TYPE_META[type].title;
}

export default function LayerManagerDrawer({
  open,
  onClose,
  layers,
  onChange,
  baseMap,
  onBaseMapChange,
}: LayerManagerDrawerProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseMapDraft, setBaseMapDraft] = useState<BaseMapConfig>(baseMap);

  useEffect(() => {
    if (open) setBaseMapDraft(baseMap);
  }, [open, baseMap]);

  const displayLayers = useMemo(
    () => [...layers.layers].reverse(),
    [layers.layers]
  );

  const detailLayer = detailId
    ? layers.layers.find((l) => l.id === detailId) ?? null
    : null;

  const apply = (next: MapLayersState) => {
    onChange(next);
    saveMapLayers(next);
  };

  const updateLayer = (id: string, next: MapLayer) => {
    apply({
      layers: layers.layers.map((l) => (l.id === id ? next : l)),
    });
  };

  const toggleVisible = (id: string) => {
    apply({
      layers: layers.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    });
  };

  const removeLayer = (id: string) => {
    if (!window.confirm("确定删除该图层？")) return;
    apply({ layers: layers.layers.filter((l) => l.id !== id) });
    if (detailId === id) setDetailId(null);
    if (selectedId === id) setSelectedId(null);
  };

  const moveLayer = (id: string, direction: "up" | "down") => {
    const idx = layers.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const target = direction === "up" ? idx + 1 : idx - 1;
    if (target < 0 || target >= layers.layers.length) return;
    const next = [...layers.layers];
    [next[idx], next[target]] = [next[target], next[idx]];
    apply({ layers: next });
  };

  const addLayer = (type: MapLayerType) => {
    const layer = createLayer(type);
    apply({ layers: [...layers.layers, layer] });
    setAddMenuOpen(false);
    setDetailId(layer.id);
    setSelectedId(layer.id);
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setSelectedId(id);
  };

  const saveBaseMap = () => {
    saveBaseMapConfig(baseMapDraft);
    onBaseMapChange(baseMapDraft);
  };

  const baseMapDefinition = BASE_MAP_PROVIDERS[baseMapDraft.provider];

  return (
    <>
      {open && (
        <div
          className="settings-backdrop"
          role="presentation"
          onClick={onClose}
        />
      )}
      <aside
        className={`settings-drawer layer-manager-drawer${open ? " open" : ""}`}
        aria-hidden={!open}
      >
        <header className="settings-drawer-header">
          <h2>图层</h2>
          <button
            type="button"
            className="ghost-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="layer-manager-toolbar">
          <div className="layer-add-wrap">
            <button
              type="button"
              className="primary-btn layer-add-btn"
              onClick={() => setAddMenuOpen((v) => !v)}
            >
              + 添加图层
            </button>
            {addMenuOpen && (
              <ul className="layer-add-menu">
                {(
                  ["siteMarker", "groundOverlay", "model3d"] as MapLayerType[]
                ).map((type) => (
                  <li key={type}>
                    <button type="button" onClick={() => addLayer(type)}>
                      {layerTypeLabel(type)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="settings-drawer-scroll layer-manager-list">
          <section className="settings-section layer-base-map-settings">
            <h3>基础地图</h3>
            <label>
              地图供应商
              <select
                value={baseMapDraft.provider}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    provider: e.target.value as BaseMapProvider,
                    urlTemplate: "",
                    subdomains: "",
                    credit: "",
                    maximumLevel:
                      BASE_MAP_PROVIDERS[e.target.value as BaseMapProvider]
                        .defaultMaximumLevel,
                  }))
                }
              >
                {BASE_MAP_PROVIDER_ORDER.map((provider) => (
                  <option key={provider} value={provider}>
                    {BASE_MAP_PROVIDERS[provider].label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              XYZ URL 模板
              <input
                type="text"
                value={baseMapDraft.urlTemplate}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    urlTemplate: e.target.value,
                  }))
                }
                placeholder={
                  baseMapDefinition.lightUrlTemplate ||
                  "https://host/{z}/{x}/{y}.png"
                }
              />
            </label>
            <label>
              API Key / Session Token
              <input
                type="password"
                autoComplete="off"
                value={baseMapDraft.credential}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    credential: e.target.value,
                  }))
                }
                placeholder="替换 URL 中的 {key} 或 {token}"
              />
            </label>
            <label>
              瓦片子域（可选，逗号分隔）
              <input
                type="text"
                value={baseMapDraft.subdomains}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    subdomains: e.target.value,
                  }))
                }
                placeholder={baseMapDefinition.defaultSubdomains || "a,b,c"}
              />
            </label>
            <label>
              版权标注（可选）
              <input
                type="text"
                value={baseMapDraft.credit}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    credit: e.target.value,
                  }))
                }
                placeholder={baseMapDefinition.credit || "地图数据提供方"}
              />
            </label>
            <label>
              最大缩放级别
              <input
                type="number"
                min={1}
                max={24}
                value={baseMapDraft.maximumLevel}
                onChange={(e) =>
                  setBaseMapDraft((current) => ({
                    ...current,
                    maximumLevel: Number(e.target.value),
                  }))
                }
              />
            </label>
            <p className="settings-hint">{baseMapDefinition.help}</p>
            {baseMapDefinition.coordinateWarning && (
              <p className="settings-hint layer-base-map-warning">
                {baseMapDefinition.coordinateWarning}
              </p>
            )}
            <p className="settings-hint">
              密钥仅保存在当前浏览器 localStorage，并由浏览器直接发送给地图供应商，
              不会写入批次或后端。
            </p>
            <button
              type="button"
              className="primary-btn"
              onClick={saveBaseMap}
            >
              应用基础地图
            </button>
          </section>

          {displayLayers.length === 0 ? (
            <p className="settings-hint layer-manager-empty">
              暂无图层，点击「添加图层」创建。
            </p>
          ) : (
            <ul className="layer-stack">
              {displayLayers.map((layer) => {
                const selected = selectedId === layer.id;
                return (
                  <li
                    key={layer.id}
                    className={`layer-stack-item${selected ? " selected" : ""}${layer.visible ? "" : " hidden-layer"}`}
                    onClick={() => setSelectedId(layer.id)}
                    onDoubleClick={() => openDetail(layer.id)}
                  >
                    <button
                      type="button"
                      className={`layer-eye-btn${layer.visible ? " on" : ""}`}
                      title={layer.visible ? "隐藏图层" : "显示图层"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVisible(layer.id);
                      }}
                    >
                      {layer.visible ? "◉" : "○"}
                    </button>
                    <div className="layer-stack-main">
                      <span className="layer-stack-name">{layer.name}</span>
                      <span className="layer-stack-type">
                        {layerTypeLabel(layer.type)}
                      </span>
                    </div>
                    <div className="layer-stack-actions">
                      <button
                        type="button"
                        className="ghost-btn layer-order-btn"
                        title="上移（更靠前）"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveLayer(layer.id, "up");
                        }}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="ghost-btn layer-order-btn"
                        title="下移（更靠后）"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveLayer(layer.id, "down");
                        }}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="ghost-btn layer-settings-btn"
                        title="图层设置"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(layer.id);
                        }}
                      >
                        ⚙
                      </button>
                      <button
                        type="button"
                        className="ghost-btn layer-delete-btn"
                        title="删除图层"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLayer(layer.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="settings-hint layer-manager-hint">
            双击图层或点击 ⚙ 打开详细设置；列表上方图层叠在下方之上。
          </p>
        </div>
      </aside>

      {detailLayer && (
        <LayerDetailModal
          layer={detailLayer}
          onChange={(next) => updateLayer(detailLayer.id, next)}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}
