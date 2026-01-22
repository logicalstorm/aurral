import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { db } from "./config/db.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { probeLidarrUrl } from "./services/apiClients.js";
import { updateDiscoveryCache, getDiscoveryCache } from "./services/discoveryService.js";

import settingsRouter from "./routes/settings.js";
import artistsRouter from "./routes/artists.js";
import lidarrRouter from "./routes/lidarr.js";
import discoveryRouter from "./routes/discovery.js";
import requestsRouter from "./routes/requests.js";
import playlistsRouter from "./routes/playlists.js";
import healthRouter from "./routes/health.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(helmet());
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

setInterval(updateDiscoveryCache, 24 * 60 * 60 * 1000);

setTimeout(() => {
  const lastUpdated = db.data.discovery?.lastUpdated;
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (!lastUpdated || new Date(lastUpdated).getTime() < twentyFourHoursAgo) {
    updateDiscoveryCache();
  } else {
    console.log(
      `Discovery cache is fresh (last updated ${lastUpdated}). Skipping initial update.`,
    );
  }
}, 5000);

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const { getLidarrConfig, getLidarrBasepathDetected } = await import("./services/apiClients.js");
  const { url, apiKey } = getLidarrConfig();
  console.log(`Lidarr URL (configured): ${url}`);
  console.log(`Lidarr API Key configured: ${!!apiKey}`);

  if (apiKey) {
    await probeLidarrUrl();
    if (getLidarrBasepathDetected()) {
      console.log(`Lidarr URL (resolved): ${url}/lidarr`);
    }
  }
});
