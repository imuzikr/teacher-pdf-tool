import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/teacher-pdf-tool/" : "/",
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
}));
