import express from "express";
import { registerAdminRoutes } from "./handlers/admin.js";
import { registerMainRoutes } from "./handlers/main.js";
import { registerTagRoutes } from "./handlers/tags.js";
import { registerFeedbackRoutes } from "./handlers/feedback.js";
import { registerAdoptRoutes } from "./handlers/adopt.js";
import { registerShowRoutes } from "./handlers/shows.js";
import { registerPreferenceRoutes } from "./handlers/preferences.js";

const router = express.Router();

registerAdminRoutes(router);
registerMainRoutes(router);
registerTagRoutes(router);
registerFeedbackRoutes(router);
registerAdoptRoutes(router);
registerShowRoutes(router);
registerPreferenceRoutes(router);

export default router;
