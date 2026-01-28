import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "http";

import { createAuthMiddleware } from "./middleware/auth.js";
import {
  updateDiscoveryCache,
  getDiscoveryCache,
} from "./services/discoveryService.js";
import { websocketService } from "./services/websocketService.js";

import settingsRouter from "./routes/settings.js";
import artistsRouter from "./routes/artists.js";
import libraryRouter from "./routes/library.js";
import discoveryRouter from "./routes/discovery.js";
import requestsRouter from "./routes/requests.js";
import healthRouter from "./routes/health.js";

// Load .env file from the backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

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
app.use("/api/library", libraryRouter);
app.use("/api/discover", discoveryRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/health", healthRouter);

setInterval(updateDiscoveryCache, 24 * 60 * 60 * 1000);

setTimeout(async () => {
  const { dbOps } = await import("./config/db-helpers.js");
  const discovery = dbOps.getDiscoveryCache();
  const lastUpdated = discovery?.lastUpdated;
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (!lastUpdated || new Date(lastUpdated).getTime() < twentyFourHoursAgo) {
    updateDiscoveryCache();
  } else {
    console.log(
      `Discovery cache is fresh (last updated ${lastUpdated}). Skipping initial update.`,
    );
  }
}, 5000);

const httpServer = createServer(app);

websocketService.initialize(httpServer);

httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
  const { libraryManager } = await import("./services/libraryManager.js");

  const rootFolder = libraryManager.getRootFolder();
  console.log(`Root folder: ${rootFolder || "Not configured"}`);
});
