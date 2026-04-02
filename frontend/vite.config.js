import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const apiTarget = env.VITE_API_BASE_URL || "http://localhost:8000";
  const wsTarget = env.VITE_WS_BASE_URL || "ws://localhost:8001";

  return {
    plugins: [
      react(),
      {
        name: "html-rewrites",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === "/terminal") req.url = "/terminal.html";
            next();
          });
        },
      },
    ],
    optimizeDeps: {
      include: ["zustand"],
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: apiTarget.startsWith("https"),
        },
        "/ws": {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          terminal: "terminal.html",
        },
      },
    },
  };
});
