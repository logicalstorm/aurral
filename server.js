import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { db } from "./backend/config/db.js";
import { createAuthMiddleware } from "./backend/middleware/auth.js";
import { probeLidarrUrl } from "./backend/services/apiClients.js";
import { updateDiscoveryCache, getDiscoveryCache } from "./backend/services/discoveryService.js";

import settingsRouter from "./backend/routes/settings.js";
import artistsRouter from "./backend/routes/artists.js";
import lidarrRouter from "./backend/routes/lidarr.js";
import discoveryRouter from "./backend/routes/discovery.js";
import requestsRouter from "./backend/routes/requests.js";
import playlistsRouter from "./backend/routes/playlists.js";
import healthRouter from "./backend/routes/health.js";

dotenv.config();

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(express.json());

app.use(createAuthMiddleware());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
});
app.use("/api/", limiter);

app.use("/api/settings", settingsRouter);
app.use("/api/search", artistsRouter);
app.use("/api/artists", artistsRouter);
app.use("/api/lidarr", lidarrRouter);
app.use("/api/discover", discoveryRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/playlists", playlistsRouter);
app.use("/api/health", healthRouter);

const frontendDist = path.join(__dirname, "frontend", "dist");

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.status(503).send("Frontend not built. Run 'npm run build' first.");
  });
}

setInterval(() => {
  updateDiscoveryCache().catch(err => {
    console.error("Error in scheduled discovery update:", err.message);
  });
}, 24 * 60 * 60 * 1000);

setTimeout(() => {
  const lastUpdated = db.data.discovery?.lastUpdated;
  const discoveryCache = getDiscoveryCache();
  const hasRecommendations = discoveryCache.recommendations && discoveryCache.recommendations.length > 0;
  const hasGenres = discoveryCache.topGenres && discoveryCache.topGenres.length > 0;
  
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const needsUpdate = !lastUpdated || 
                      new Date(lastUpdated).getTime() < twentyFourHoursAgo ||
                      !hasRecommendations ||
                      !hasGenres;
  
  if (needsUpdate) {
    console.log("Discovery cache needs update. Starting...");
    updateDiscoveryCache().catch(err => {
      console.error("Error in initial discovery update:", err.message);
    });
  } else {
    console.log(
      `Discovery cache is fresh (last updated ${lastUpdated}). Skipping initial update.`,
    );
  }
}, 5000);

const server = app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    const { getLidarrConfig, getLidarrBasepathDetected } = await import("./backend/services/apiClients.js");
    const { url, apiKey } = getLidarrConfig();
    console.log(`Lidarr URL (configured): ${url}`);
    console.log(`Lidarr API Key configured: ${!!apiKey}`);

    if (apiKey) {
      try {
        await probeLidarrUrl();
        if (getLidarrBasepathDetected()) {
          console.log(`Lidarr URL (resolved): ${url}/lidarr`);
        }
      } catch (error) {
        console.warn("Lidarr probe failed (this is okay if Lidarr isn't running):", error.message);
      }
    }
  } catch (error) {
    console.error("Error during server startup:", error.message);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please stop the other process or use a different port.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});
