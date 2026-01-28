import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { createAuthMiddleware } from "./backend/middleware/auth.js";
import {
  updateDiscoveryCache,
  getDiscoveryCache,
} from "./backend/services/discoveryService.js";

import settingsRouter from "./backend/routes/settings.js";
import artistsRouter from "./backend/routes/artists.js";
import libraryRouter from "./backend/routes/library.js";
import discoveryRouter from "./backend/routes/discovery.js";
import requestsRouter from "./backend/routes/requests.js";
import healthRouter from "./backend/routes/health.js";

// Get __dirname for .env file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the backend directory
dotenv.config({ path: path.join(__dirname, "backend", ".env") });

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
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
app.use("/api/library", libraryRouter);
app.use("/api/discover", discoveryRouter);
app.use("/api/requests", requestsRouter);
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

setInterval(
  () => {
    updateDiscoveryCache().catch((err) => {
      console.error("Error in scheduled discovery update:", err.message);
    });
  },
  24 * 60 * 60 * 1000,
);

setTimeout(async () => {
  const { getLastfmApiKey } = await import("./backend/services/apiClients.js");
  const { libraryManager } =
    await import("./backend/services/libraryManager.js");
  const { dbOps } = await import("./backend/config/db-helpers.js");

  const hasLastfm = !!getLastfmApiKey();
  const libraryArtists = await libraryManager.getAllArtists();
  const hasArtists = libraryArtists.length > 0;

  // If nothing is configured, clear discovery cache
  if (!hasLastfm && !hasArtists) {
    console.log(
      "Discovery not configured (no Last.fm key and no artists). Clearing cache.",
    );
    try {
      dbOps.updateDiscoveryCache({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      });
    } catch (error) {
      console.error("Failed to clear discovery cache:", error.message);
    }
    return;
  }

  const discoveryCache = dbOps.getDiscoveryCache();
  const lastUpdated = discoveryCache?.lastUpdated;
  const hasRecommendations =
    discoveryCache.recommendations && discoveryCache.recommendations.length > 0;
  const hasGenres =
    discoveryCache.topGenres && discoveryCache.topGenres.length > 0;

  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const needsUpdate =
    !lastUpdated ||
    new Date(lastUpdated).getTime() < twentyFourHoursAgo ||
    !hasRecommendations ||
    !hasGenres;

  if (needsUpdate) {
    console.log("Discovery cache needs update. Starting...");
    updateDiscoveryCache().catch((err) => {
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
    const { libraryManager } =
      await import("./backend/services/libraryManager.js");

    const rootFolder = libraryManager.getRootFolder();
    console.log(`Root folder: ${rootFolder || "Not configured"}`);
  } catch (error) {
    console.error("Error during server startup:", error.message);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Please stop the other process or use a different port.`,
    );
    process.exit(1);
  } else {
    console.error("Server error:", error);
  }
});
