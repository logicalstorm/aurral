import express from "express";
import registerSearch from "./handlers/search.js";
import registerReleaseGroup from "./handlers/releaseGroup.js";
import registerStream from "./handlers/stream.js";
import registerPreview from "./handlers/preview.js";
import registerDetails from "./handlers/details.js";
import registerCover from "./handlers/cover.js";
import registerSimilar from "./handlers/similar.js";

const router = express.Router();
registerSearch(router);
registerReleaseGroup(router);
registerStream(router);
registerPreview(router);
registerDetails(router);
registerCover(router);
registerSimilar(router);

export default router;
