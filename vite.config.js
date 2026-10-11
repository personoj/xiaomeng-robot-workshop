import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: "frontend",
  build: {
    outDir: "../src/embodied_jev/web", emptyOutDir: true,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./frontend/index.html', import.meta.url)),
      modelStudio: fileURLToPath(new URL('./frontend/model-studio.html', import.meta.url)),
      weldEffects: fileURLToPath(new URL('./frontend/weld-effects-studio.html', import.meta.url)),
      principleStudio: fileURLToPath(new URL('./frontend/principle-studio.html', import.meta.url)),
    } },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8090",
        configure(proxy) {
          proxy.on("proxyReq", (req) =>
            req.setHeader("origin", "http://127.0.0.1:8090"),
          );
        },
      },
    },
  },
});
