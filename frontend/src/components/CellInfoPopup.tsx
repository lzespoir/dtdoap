import { useState } from "react";
import type { CellSite } from "../types/cell";

interface CellInfoPopupProps {
  cell: CellSite;
  x: number;
  y: number;
  onClose: () => void;
}

function fmt(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default function CellInfoPopup({
  cell,
  x,
  y,
  onClose,
}: CellInfoPopupProps) {
  const [expanded, setExpanded] = useState(false);
  const extraEntries = Object.entries(cell.extra).slice(0, 20);

  return (
    <div
      className="cell-popup"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="cell-popup-close" onClick={onClose}>
        ×
      </button>
      <h3>{cell.cellName}</h3>
      <dl className="cell-popup-summary">
        <div>
          <dt>PCI</dt>
          <dd>{fmt(cell.pci)}</dd>
        </div>
        <div>
          <dt>经度</dt>
          <dd>{cell.longitude.toFixed(6)}</dd>
        </div>
        <div>
          <dt>纬度</dt>
          <dd>{cell.latitude.toFixed(6)}</dd>
        </div>
        {cell.stationName ? (
          <div className="full">
            <dt>基站</dt>
            <dd>{cell.stationName}</dd>
          </div>
        ) : null}
      </dl>
      <button
        type="button"
        className="cell-popup-more"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "收起" : "更多"}
      </button>
      {expanded ? (
        <dl className="cell-popup-detail">
          <div>
            <dt>gNodeB ID</dt>
            <dd>{fmt(cell.gnodeBId)}</dd>
          </div>
          <div>
            <dt>方向角</dt>
            <dd>{fmt(cell.azimuth)}</dd>
          </div>
          <div>
            <dt>天线挂高</dt>
            <dd>{fmt(cell.height)}</dd>
          </div>
          <div>
            <dt>频段/带宽</dt>
            <dd>{fmt(cell.band)}</dd>
          </div>
          <div>
            <dt>AAU型号</dt>
            <dd>{fmt(cell.aauModel)}</dd>
          </div>
          <div>
            <dt>设备厂商</dt>
            <dd>{fmt(cell.vendor)}</dd>
          </div>
          <div>
            <dt>CGI</dt>
            <dd>{fmt(cell.cgi)}</dd>
          </div>
          {extraEntries.map(([k, v]) => (
            <div key={k} className="full">
              <dt>{k}</dt>
              <dd>{fmt(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
