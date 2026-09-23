import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const ToolsApp = lazy(() => import("./tools/ToolsApp"));

const isToolsRoute = window.location.pathname.startsWith("/tools");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isToolsRoute ? (
      <Suspense fallback={<div style={{ padding: 24, color: "#ccc" }}>加载工具页…</div>}>
        <ToolsApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);
