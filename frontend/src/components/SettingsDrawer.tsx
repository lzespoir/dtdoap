import { useEffect, useState } from "react";
import {
  fetchRegionBboxPresets,
  resolveGrasslandBbox,
  type RegionBboxPreset,
} from "../lib/regionBboxPresets";
import { fetchAfterLuceAvailable, fetchLuceSettings, saveLuceSettings } from "../lib/luceApi";
import {
  DEFAULT_LUCE_SETTINGS,
  type GridAggMode,
  type GridRefOrigin,
  type LuceSettings,
  type RsrpDisplayMode,
} from "../types/luce";

interface SettingsDrawerProps {
  open: boolean;
  batchId: string | null;
  onClose: () => void;
  onSaved?: (settings: LuceSettings) => void;
  onReprocess?: (settings: LuceSettings) => void;
}

function parsePciList(raw: string): number[] {
  return raw
    .split(/[,，;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function pciListToString(list: number[]): string {
  return list.length ? list.join(", ") : "";
}

export default function SettingsDrawer({
  open,
  batchId,
  onClose,
  onSaved,
  onReprocess,
}: SettingsDrawerProps) {
  const [settings, setSettings] = useState<LuceSettings>(DEFAULT_LUCE_SETTINGS);
  const [servingPciText, setServingPciText] = useState("");
  const [neighborPciText, setNeighborPciText] = useState("");
  const [comparisonPciText, setComparisonPciText] = useState("");
  const [servingPciExcludeText, setServingPciExcludeText] = useState("");
  const [neighborPciExcludeText, setNeighborPciExcludeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [afterLuceAvailable, setAfterLuceAvailable] = useState(false);
  const [regionPresets, setRegionPresets] = useState<RegionBboxPreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/region-bbox-presets")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "加载区域预设失败");
        if (!Array.isArray(data.presets)) {
          throw new Error("region-bbox-presets.json 缺少 presets 数组");
        }
        setRegionPresets(data.presets as RegionBboxPreset[]);
        setPresetsError(null);
      })
      .catch(async (e) => {
        setPresetsError(
          e instanceof Error ? e.message : "区域预设加载失败"
        );
        const fallback = await fetchRegionBboxPresets();
        setRegionPresets(fallback);
      });
  }, [open]);

  useEffect(() => {
    if (!open || !batchId) return;
    setLoading(true);
    Promise.all([
      fetchLuceSettings(batchId),
      fetchAfterLuceAvailable(batchId).catch(() => false),
    ])
      .then(([s, afterAvail]) => {
        setAfterLuceAvailable(afterAvail);
        let next = s;
        if (s.gridRefOrigin === "notebook-combined" && !afterAvail) {
          next = { ...s, gridRefOrigin: "before" };
        }
        setSettings(next);
        setServingPciText(pciListToString(s.servingPciFilter));
        setNeighborPciText(pciListToString(s.neighborPciFilter));
        setComparisonPciText(pciListToString(s.comparisonTargetPcis ?? []));
        setServingPciExcludeText(pciListToString(s.servingPciExclude ?? []));
        setNeighborPciExcludeText(pciListToString(s.neighborPciExclude ?? []));
      })
      .catch(() => {
        setAfterLuceAvailable(false);
        setSettings(DEFAULT_LUCE_SETTINGS);
        setServingPciText("");
        setNeighborPciText("");
        setComparisonPciText("");
        setServingPciExcludeText("");
        setNeighborPciExcludeText("");
      })
      .finally(() => setLoading(false));
  }, [open, batchId]);

  useEffect(() => {
    if (afterLuceAvailable) return;
    setSettings((s) =>
      s.gridRefOrigin === "notebook-combined"
        ? { ...s, gridRefOrigin: "before" }
        : s
    );
  }, [afterLuceAvailable]);

  const applyPciFields = (): LuceSettings => {
    const gridRefOrigin =
      settings.gridRefOrigin === "notebook-combined" && !afterLuceAvailable
        ? "before"
        : (settings.gridRefOrigin ?? "before");
    return {
      ...settings,
      gridRefOrigin,
      servingPciFilter: parsePciList(servingPciText),
      neighborPciFilter: parsePciList(neighborPciText),
      comparisonTargetPcis: parsePciList(comparisonPciText),
      servingPciExclude: parsePciList(servingPciExcludeText),
      neighborPciExclude: parsePciList(neighborPciExcludeText),
    };
  };

  const handleSave = async () => {
    if (!batchId) return;
    const next = applyPciFields();
    setSaving(true);
    try {
      const saved = await saveLuceSettings(batchId, next);
      setSettings(saved);
      onSaved?.(saved);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndReprocess = async () => {
    if (!batchId) return;
    const next = applyPciFields();
    setSaving(true);
    try {
      const saved = await saveLuceSettings(batchId, next);
      setSettings(saved);
      onSaved?.(saved);
      onReprocess?.(saved);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {open && <SettingsBackdrop onClick={onClose} />}
      <aside className={`settings-drawer ${open ? "open" : ""}`}>
        <header className="settings-drawer-header">
          <h2>路测高级设置</h2>
          <button type="button" className="settings-close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="settings-drawer-scroll">
        {!batchId ? (
          <p className="settings-hint settings-hint-pad">
            请先上传或选择批次后再配置路测参数。
          </p>
        ) : loading ? (
          <p className="settings-hint settings-hint-pad">加载设置中…</p>
        ) : (
          <div className="settings-drawer-body">
            <section className="settings-section">
              <h3>PCI 过滤</h3>
              <label>
                主区 PCI（逗号分隔，留空=全部）
                <input
                  value={servingPciText}
                  onChange={(e) => setServingPciText(e.target.value)}
                  placeholder="例：958, 959"
                />
              </label>
              <label>
                邻区 PCI（逗号分隔，留空=全部）
                <input
                  value={neighborPciText}
                  onChange={(e) => setNeighborPciText(e.target.value)}
                  placeholder="例：100, 101"
                />
              </label>
              <label>
                排除主区 PCI（逗号分隔，留空=不排除）
                <input
                  value={servingPciExcludeText}
                  onChange={(e) => setServingPciExcludeText(e.target.value)}
                  placeholder="例：69, 330"
                />
              </label>
              <label>
                排除邻区 PCI（逗号分隔，留空=不排除）
                <input
                  value={neighborPciExcludeText}
                  onChange={(e) => setNeighborPciExcludeText(e.target.value)}
                  placeholder="例：100"
                />
              </label>
              <p className="settings-hint">
                先按上方主区/邻区白名单筛选，再应用排除列表；两者可同时使用。
              </p>
            </section>

            <section className="settings-section">
              <h3>对比关注小区组</h3>
              <label>
                小区组名称
                <input
                  value={settings.comparisonGroupName}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      comparisonGroupName: e.target.value,
                    })
                  }
                  placeholder="例：场内 4 个 AAU"
                />
              </label>
              <label>
                关注 PCI（逗号分隔，留空=不展示小区组指标）
                <input
                  value={comparisonPciText}
                  onChange={(e) => setComparisonPciText(e.target.value)}
                  placeholder="例：353, 294, 330, 69"
                />
              </label>
              <p className="settings-hint">
                用于查看对比中的主服务占比和按 PCI 拆分，不改变路测数据过滤范围；
                可配置任意数量的 PCI。保存设置后即可重新计算对比，无需重新处理路测。
              </p>
            </section>

            <section className="settings-section">
              <h3>空间范围</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.useRegionFilter}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      useRegionFilter: e.target.checked,
                    })
                  }
                />
                仅中场区域过滤（默认关闭；开启时请确认中心在当前工参区域）
              </label>
              {settings.useRegionFilter && (
                <>
                  <label>
                    中心经度 / 纬度
                    <span className="settings-inline-inputs">
                      <input
                        type="number"
                        step="0.000001"
                        value={settings.regionCenterLon}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            regionCenterLon: Number(e.target.value),
                          })
                        }
                      />
                      <input
                        type="number"
                        step="0.000001"
                        value={settings.regionCenterLat}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            regionCenterLat: Number(e.target.value),
                          })
                        }
                      />
                    </span>
                  </label>
                  <label>
                    半径 (m)
                    <input
                      type="number"
                      min={10}
                      max={200}
                      value={settings.regionRadiusMeters}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          regionRadiusMeters: Number(e.target.value) || 55,
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.useGrasslandFilter}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      useGrasslandFilter: e.target.checked,
                    })
                  }
                />
                仅草坪区域
              </label>
              {settings.useGrasslandFilter && (
                <>
                  <label>
                    区域范围
                    <select
                      value={settings.grasslandBboxSource ?? "custom"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSettings({
                          ...settings,
                          grasslandBboxSource: v,
                        });
                      }}
                    >
                      <option value="custom">自定义</option>
                      {regionPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {presetsError && (
                    <p className="settings-hint settings-error-hint">
                      区域预设配置异常：{presetsError}（已回退到构建时缓存）
                    </p>
                  )}
                  {(settings.grasslandBboxSource ?? "custom") !== "custom" &&
                    !regionPresets.some(
                      (p) => p.id === settings.grasslandBboxSource
                    ) && (
                      <p className="settings-hint settings-error-hint">
                        未找到预设 id「{settings.grasslandBboxSource}
                        」，请检查 config/region-bbox-presets.json 是否包含该
                        id，或改选其他区域。
                      </p>
                    )}
                  {(settings.grasslandBboxSource ?? "custom") === "custom" ? (
                    <label>
                      经度范围 / 纬度范围
                      <span className="settings-inline-inputs settings-bbox-inputs">
                        <input
                          type="number"
                          step="0.0000001"
                          value={settings.grasslandBbox.lonMin}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              grasslandBboxSource: "custom",
                              grasslandBbox: {
                                ...settings.grasslandBbox,
                                lonMin: Number(e.target.value),
                              },
                            })
                          }
                        />
                        <span className="settings-sep">~</span>
                        <input
                          type="number"
                          step="0.0000001"
                          value={settings.grasslandBbox.lonMax}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              grasslandBboxSource: "custom",
                              grasslandBbox: {
                                ...settings.grasslandBbox,
                                lonMax: Number(e.target.value),
                              },
                            })
                          }
                        />
                        <input
                          type="number"
                          step="0.0000001"
                          value={settings.grasslandBbox.latMin}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              grasslandBboxSource: "custom",
                              grasslandBbox: {
                                ...settings.grasslandBbox,
                                latMin: Number(e.target.value),
                              },
                            })
                          }
                        />
                        <span className="settings-sep">~</span>
                        <input
                          type="number"
                          step="0.0000001"
                          value={settings.grasslandBbox.latMax}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              grasslandBboxSource: "custom",
                              grasslandBbox: {
                                ...settings.grasslandBbox,
                                latMax: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </span>
                    </label>
                  ) : (
                    (() => {
                      const preset = regionPresets.find(
                        (p) => p.id === settings.grasslandBboxSource
                      );
                      const bb = resolveGrasslandBbox(settings, regionPresets);
                      return (
                        <p className="settings-hint">
                          {preset ? `${preset.label}（${preset.id}）` : settings.grasslandBboxSource}
                          ：经度 {bb.lonMin.toFixed(7)} ~ {bb.lonMax.toFixed(7)}，纬度{" "}
                          {bb.latMin.toFixed(7)} ~ {bb.latMax.toFixed(7)}
                          （来自 config/region-bbox-presets.json）
                        </p>
                      );
                    })()
                  )}
                </>
              )}
            </section>

            <section className="settings-section">
              <h3>RSRP 提取</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.includeServing}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      includeServing: e.target.checked,
                    })
                  }
                />
                主区 RSRP（NR PCC Serving）
              </label>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.includeNeighbor}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      includeNeighbor: e.target.checked,
                    })
                  }
                />
                邻区 RSRP（分号与 PCI 一一对应）
              </label>
              {settings.includeNeighbor && (
                <p className="settings-hint">
                  邻区 PCI 与主区相同时，栅格会在边线重复出现；中场栅格建议仅主区。
                </p>
              )}
              {settings.includeNeighbor && (
                <label>
                  邻区来源
                  <select
                    value={settings.neighborSource}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        neighborSource: e.target
                          .value as LuceSettings["neighborSource"],
                      })
                    }
                  >
                    <option value="listed">NR Listed</option>
                    <option value="detected">NR Detected</option>
                    <option value="both">两者</option>
                  </select>
                </label>
              )}
            </section>

            <section className="settings-section">
              <h3>地图显示</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.showDrivePath}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      showDrivePath: e.target.checked,
                    })
                  }
                />
                显示测试路径（经纬度轨迹）
              </label>
              <label>
                RSRP 显示模式
                <select
                  value={settings.displayMode}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      displayMode: e.target.value as RsrpDisplayMode,
                    })
                  }
                >
                  <option value="points">散点（不栅格）</option>
                  <option value="heatmap">热力图（栅格着色）</option>
                  <option value="grid">栅格块</option>
                </select>
              </label>
              <label>
                RSRP 图例范围 (dBm)
                <span className="settings-inline-inputs">
                  <input
                    type="number"
                    value={settings.rsrpRangeMin}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rsrpRangeMin: Number(e.target.value),
                      })
                    }
                  />
                  <span>~</span>
                  <input
                    type="number"
                    value={settings.rsrpRangeMax}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rsrpRangeMax: Number(e.target.value),
                      })
                    }
                  />
                </span>
              </label>
              <label>
                SINR 取值范围 (dB)
                <span className="settings-inline-inputs">
                  <input
                    type="number"
                    value={settings.sinrRangeMin}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sinrRangeMin: Number(e.target.value),
                      })
                    }
                  />
                  <span>~</span>
                  <input
                    type="number"
                    value={settings.sinrRangeMax}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        sinrRangeMax: Number(e.target.value),
                      })
                    }
                  />
                </span>
              </label>
              <p className="settings-hint">
                色标范围决定「最差→最好」对应的数值区间：左端恒为红、右端恒为绿，图例条形状不变；
                收窄范围可增强对比度。保存后立即生效，无需重新处理路测数据。
                PCI 自定义颜色可在地图图例中点击色块修改。
              </p>
              {(settings.displayMode !== "points" || settings.useGrid) && (
                <>
                  <label
                    title="全球 floor：gx=floor(经度×cos(regionCenterLat)×111320/边长)，行列对齐；regionCenterLat 仅作经度米制换算，与数据集无关。数据集原点：Notebook 对齐用。"
                  >
                    栅格划分方式
                    <select
                      value={settings.gridIndexMode ?? "global"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          gridIndexMode: e.target.value as LuceSettings["gridIndexMode"],
                        })
                      }
                    >
                      <option value="global">全球 floor（默认）</option>
                      <option value="dataset">数据集原点（Notebook）</option>
                    </select>
                  </label>
                  {settings.gridIndexMode === "dataset" && (
                    <>
                      <label
                        title="优化前：原点取优化前采样经纬度中位数（处理优化前时写入）。Notebook 合并：需已上传优化后 CSV；仅在处理优化后时按优化前+优化后合并采样写原点，此前地图仍用已保存原点；写入后请再重新处理优化前。"
                      >
                        数据集原点来源
                        <select
                          value={settings.gridRefOrigin ?? "before"}
                          disabled={!afterLuceAvailable}
                          onChange={(e) => {
                            const gridRefOrigin = e.target
                              .value as GridRefOrigin;
                            setSettings({
                              ...settings,
                              gridRefOrigin,
                              gridRefLon: undefined,
                              gridRefLat: undefined,
                            });
                          }}
                        >
                          <option value="before">
                            优化前中位数（默认）
                          </option>
                          <option value="notebook-combined">
                            Notebook：优化前+优化后合并中位数
                          </option>
                        </select>
                      </label>
                      {!afterLuceAvailable && (
                        <p className="settings-hint">
                          上传并具备优化后路测 CSV 后，才可选用 Notebook
                          合并原点；此前栅格仍按优化前原点或已存原点显示。
                        </p>
                      )}
                      {afterLuceAvailable &&
                        settings.gridRefOrigin === "notebook-combined" && (
                          <p className="settings-hint">
                            请先「保存并重新处理」优化后，再重新处理优化前，使前后栅格与
                            Notebook 一致。
                          </p>
                        )}
                      {Number.isFinite(settings.gridRefLon) &&
                        Number.isFinite(settings.gridRefLat) && (
                          <p className="settings-hint">
                            当前原点：{settings.gridRefLon!.toFixed(6)},{" "}
                            {settings.gridRefLat!.toFixed(6)}
                          </p>
                        )}
                    </>
                  )}
                  <label
                    title="主服 PCI 众数：格内样本数最多的 PCI，再对该 PCI 的 RSRP 取平均（平台默认）。格内全点均值：格内所有采样点 RSRP 算术平均，与 Notebook 栅格一致。"
                  >
                    栅格 RSRP 聚合
                    <select
                      value={settings.gridAggMode ?? "dominant_pci"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          gridAggMode: e.target
                            .value as GridAggMode,
                        })
                      }
                    >
                      <option value="dominant_pci">
                        主服 PCI 众数（默认）
                      </option>
                      <option value="all_points_mean">
                        格内全点均值（Notebook）
                      </option>
                    </select>
                  </label>
                  <label>
                    栅格边长 (m)
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={settings.gridSizeMeters}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          gridSizeMeters: Number(e.target.value) || 5,
                        })
                      }
                    />
                  </label>
                </>
              )}
              {settings.displayMode === "points" && (
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={settings.useGrid}
                    onChange={(e) =>
                      setSettings({ ...settings, useGrid: e.target.checked })
                    }
                  />
                  散点模式下仍生成栅格数据
                </label>
              )}
            </section>

            <section className="settings-section">
              <h3>统计计算</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.useLinearDomainAverage}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      useLinearDomainAverage: e.target.checked,
                    })
                  }
                />
                平均值使用线性域计算（dBm/dB 转线性后取均值）
              </label>
              <p className="settings-hint">
                关闭：直接对 dBm/dB 做算术平均；开启：先转线性域再均值后转回 dBm/dB。
              </p>
            </section>

            <p className="settings-hint">
              设置保存在当前批次目录下的 luce-settings.json，对优化前、优化后地图显示均生效。
              修改显示模式、栅格划分/聚合方式或栅格边长后请点「保存并重新处理」以同步两侧栅格数据。
            </p>
          </div>
        )}

        <section className="settings-section">
          <h3>优质栅格阈值（查看对比）</h3>
          <label>
            RSRP 优质栅格阈值 (dBm)
            <input
              type="number"
              step={1}
              value={settings.qualityRsrpThresholdDb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  qualityRsrpThresholdDb: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <label>
            SINR 优质栅格阈值 (dB)
            <input
              type="number"
              step={0.5}
              value={settings.qualitySinrThresholdDb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  qualitySinrThresholdDb: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <p className="settings-hint">
            用于「查看对比」中优质栅格比例 KPI：栅格指标 ≥ 阈值计为优质。默认 RSRP -85 dBm、SINR 0 dB；保存后若已打开对比面板将自动刷新。
          </p>
        </section>

        <section className="settings-section">
          <h3>优化后数据修正</h3>
          <label>
            优化后 RSRP 偏移 (dB)
            <input
              type="number"
              step={0.1}
              value={settings.afterRsrpOffsetDb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  afterRsrpOffsetDb: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <label>
            优化后 SINR 偏移 (dB)
            <input
              type="number"
              step={0.1}
              value={settings.afterSinrOffsetDb}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  afterSinrOffsetDb: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <p className="settings-hint">
            0 表示不偏移；正数表示整体上调，负数表示整体下调（如 −10 即减 10 dB）。
            仅影响优化后地图与对比展示，不修改原始 CSV；保存后立即生效。
          </p>
        </section>
        </div>

        <footer className="settings-drawer-footer">
          <button
            type="button"
            className="ghost-btn"
            disabled={!batchId || saving}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!batchId || saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!batchId || saving}
            onClick={handleSaveAndReprocess}
          >
            保存并重新处理
          </button>
        </footer>
      </aside>
    </>
  );
}

function SettingsBackdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onClick={onClick}
    />
  );
}
