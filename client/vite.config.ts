import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:3939";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/mcp": { target: API_TARGET, changeOrigin: true, ws: true },
      // Server-rendered viewers + content-addressed image serving are
      // owned by Express, not the SPA — proxy them through so deep links
      // like /mermaid/:pid/:idx, /chart/:pid/:idx, /img/<hash>.<ext>
      // work the same on the Vite dev port as on :3939.
      "/mermaid": { target: API_TARGET, changeOrigin: true },
      "/chart": { target: API_TARGET, changeOrigin: true },
      "/img": { target: API_TARGET, changeOrigin: true },
    },
  },
});
