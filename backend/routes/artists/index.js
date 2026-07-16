import { registerReleaseGroup } from "./handlers/releaseGroup.js";
import { registerStream } from "./handlers/stream.js";
import { registerPreview } from "./handlers/preview.js";
import { registerDetails } from "./handlers/details.js";
import { registerCover } from "./handlers/cover.js";
import { registerSimilar } from "./handlers/similar.js";
import { registerVideo } from "./handlers/video.js";
import { registerAppearsOn } from "./handlers/appearsOn.js";
import mountRoutes from "../shared/mountRoutes.js";

export default mountRoutes([
  registerReleaseGroup,
  registerStream,
  registerPreview,
  registerDetails,
  registerCover,
  registerSimilar,
  registerVideo,
  registerAppearsOn,
]);
