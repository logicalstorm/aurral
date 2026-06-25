import { registerAdmin } from "./handlers/admin.js";
import { registerArtwork } from "./handlers/artwork.js";
import { registerMain } from "./handlers/main.js";
import { registerTags } from "./handlers/tags.js";
import { registerFeedback } from "./handlers/feedback.js";
import { registerAdopt } from "./handlers/adopt.js";
import { registerShows } from "./handlers/shows.js";
import { registerPreferences } from "./handlers/preferences.js";
import mountRoutes from "../shared/mountRoutes.js";

export default mountRoutes([
  registerAdmin,
  registerArtwork,
  registerMain,
  registerTags,
  registerFeedback,
  registerAdopt,
  registerShows,
  registerPreferences,
]);
