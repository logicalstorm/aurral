import express from "express";
import { registerAdmin } from "./handlers/admin.js";
import { registerMain } from "./handlers/main.js";
import { registerTags } from "./handlers/tags.js";
import { registerFeedback } from "./handlers/feedback.js";
import { registerAdopt } from "./handlers/adopt.js";
import { registerShows } from "./handlers/shows.js";
import { registerPreferences } from "./handlers/preferences.js";

const router = express.Router();

registerAdmin(router);
registerMain(router);
registerTags(router);
registerFeedback(router);
registerAdopt(router);
registerShows(router);
registerPreferences(router);

export default router;
