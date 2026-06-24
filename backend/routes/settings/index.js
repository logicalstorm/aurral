import express from "express";
import { requireAuth, requireAdmin } from "../../middleware/requirePermission.js";
import { registerGeneral } from "./handlers/general.js";
import { registerLidarr } from "./handlers/lidarr.js";
import { registerPlex } from "./handlers/plex.js";
import { registerDownloadClients } from "./handlers/downloadClients.js";
import { registerBrowse } from "./handlers/browse.js";
import { registerTasks } from "./handlers/tasks.js";
import { registerStorageHealth } from "./handlers/storageHealth.js";

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

registerGeneral(router);
registerLidarr(router);
registerPlex(router);
registerDownloadClients(router);
registerBrowse(router);
registerTasks(router);
registerStorageHealth(router);

export default router;
