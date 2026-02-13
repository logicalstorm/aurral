import express from "express";
import registerStream from "./handlers/stream.js";
import registerArtists from "./handlers/artists.js";
import registerAlbums from "./handlers/albums.js";
import registerTracks from "./handlers/tracks.js";
import registerDownloads from "./handlers/downloads.js";
import registerMisc from "./handlers/misc.js";

const router = express.Router();
registerStream(router);
registerArtists(router);
registerAlbums(router);
registerTracks(router);
registerDownloads(router);
registerMisc(router);

export default router;
