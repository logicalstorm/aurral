import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { db } from "./config/db.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { updateDiscoveryCache, getDiscoveryCache } from "./services/discoveryService.js";

import settingsRouter from "./routes/settings.js";
import artistsRouter from "./routes/artists.js";
import libraryRouter from "./routes/library.js";
import discoveryRouter from "./routes/discovery.js";
import requestsRouter from "./routes/requests.js";
import playlistsRouter from "./routes/playlists.js";
import healthRouter from "./routes/health.js";
import downloadsRouter from "./routes/downloads.js";

// Load .env file from the backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

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
app.use("/api/playlists", playlistsRouter);
app.use("/api/downloads", downloadsRouter);
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
  const { libraryManager } = await import("./services/libraryManager.js");
  const { slskdClient } = await import("./services/slskdClient.js");
  const { downloadManager } = await import("./services/downloadManager.js");
  
  // Initialize Library Monitor
  try {
    const { libraryMonitor } = await import("./services/libraryMonitor.js");
    await libraryMonitor.start();
    console.log(`✓ Library Monitor initialized and started`);
  } catch (error) {
    console.error(`✗ Failed to start Library Monitor: ${error.message}`);
    console.error(error.stack);
  }
  
  // Initialize Monitoring Service
  try {
    const { monitoringService } = await import("./services/monitoringService.js");
    await monitoringService.start();
    console.log(`✓ Monitoring Service initialized and started`);
  } catch (error) {
    console.error(`✗ Failed to start Monitoring Service: ${error.message}`);
    console.error(error.stack);
  }
  
  // Initialize QueueCleaner
  try {
    const { queueCleaner } = await import("./services/queueCleaner.js");
    console.log(`Queue Cleaner initialized (enabled: ${queueCleaner.config.enabled})`);
  } catch (error) {
    console.warn(`Queue Cleaner not available: ${error.message}`);
    console.warn(`  Install music-metadata: npm install music-metadata`);
  }
  
  // Initialize Download Queue
  try {
    const { downloadQueue } = await import("./services/downloadQueue.js");
    console.log(`✓ Download Queue initialized`);
    const status = downloadQueue.getStatus();
    console.log(`  Queue: ${status.total} items, ${status.processing} processing`);
  } catch (error) {
    console.error(`✗ Failed to initialize Download Queue: ${error.message}`);
  }
  
  const rootFolder = libraryManager.getRootFolder();
  console.log(`Root folder: ${rootFolder || 'Not configured'}`);
  console.log(`slskd configured: ${slskdClient.isConfigured()}`);
  console.log(`Download manager initialized`);
});
