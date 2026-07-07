import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and ignores the Vite splash.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    sourcemap: false,
    // No manualChunks: pdfjs-dist and react-markdown are only reachable from
    // lazy views, so the natural code-split already isolates them — the object
    // form also hoisted react into the markdown chunk, bloating startup.
  },
});
