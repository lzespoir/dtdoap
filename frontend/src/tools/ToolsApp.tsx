import { useMemo } from "react";
import ToolsHubPage from "./pages/ToolsHubPage";
import PathAdjustPage from "./pages/PathAdjustPage";
import PathShapeSnapPage from "./pages/PathShapeSnapPage";
import SpatialRsrpDistancePage from "./pages/SpatialRsrpDistancePage";
import "./tools.css";

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export default function ToolsApp() {
  const path = useMemo(() => currentPath(), []);

  if (path === "/tools/spatial-rsrp") {
    return <SpatialRsrpDistancePage />;
  }
  if (path === "/tools/path-adjust") {
    return <PathAdjustPage />;
  }
  if (path === "/tools/path-shape-snap") {
    return <PathShapeSnapPage />;
  }
  return <ToolsHubPage />;
}
