import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), cesium()],
  resolve: {
    alias: {
      "@netopt-config": path.resolve(__dirname, "../config"),
    },
  },
  optimizeDeps: {
    include: [
      "cesium",
      "@cesium/engine",
      "mersenne-twister",
      "urijs",
      "bitmap-sdf",
      "grapheme-splitter",
      "pako",
      "earcut",
      "rbush",
      "kdbush",
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
