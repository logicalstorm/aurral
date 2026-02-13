import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync, existsSync } from "fs";
import { cwd } from "process";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));
const rootPackageJson = existsSync("../package.json")
  ? JSON.parse(readFileSync("../package.json", "utf-8"))
  : null;
const appVersion =
  globalThis?.process?.env?.VITE_APP_VERSION ||
  rootPackageJson?.version ||
  packageJson.version ||
  "unknown";

const normalizeBasePath = (baseUrl) => {
  const raw = (baseUrl || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), "");
  const basePath = normalizeBasePath(env.VITE_BASE_PATH || "/");
  const isDev = mode === "development";

  return {
    base: isDev ? "/" : basePath,
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["arralogo.svg"],
        manifest: {
          name: "Aurral - Artist Request Manager",
          short_name: "Aurral",
          description: "Simple and elegant artist request manager",
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          start_url: basePath,
          icons: [
            {
              src: `${basePath}arralogo.svg`,
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
          ws: true,
          timeout: 10000,
          proxyTimeout: 10000,
        },
        "/ws": {
          target: "ws://localhost:3001",
          ws: true,
        },
      },
    },
  };
});
