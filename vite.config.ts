import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev-server port and a static build in ./dist.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  worker: { format: "es" },
  server: { port: 1420, strictPort: true },
  base: "/Clipforge/",
  build: { target: "safari15", outDir: "dist", emptyOutDir: true }
});
