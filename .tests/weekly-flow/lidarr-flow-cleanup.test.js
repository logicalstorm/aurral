import assert from "node:assert/strict";
import {
  buildAcquisitionTagLabel,
  parseAcquisitionTagLabel,
  isLibraryGraduatedAlbum,
} from "../../backend/services/lidarrPlaylistTagService.js";

const playlistId = "202f5fe0-d59e-40f1-8e9e-3297258ee1ba";
const albumMbid = "b561d09c-3674-3dae-8956-bd68a398bdfc";
const label = buildAcquisitionTagLabel(playlistId, albumMbid);

assert.equal(label, `aurral:pl:${playlistId}:alb:${albumMbid}`);
assert.deepEqual(parseAcquisitionTagLabel(label), { playlistId, albumMbid });
assert.equal(parseAcquisitionTagLabel("aurral:other"), null);

assert.equal(isLibraryGraduatedAlbum({ monitored: true, trackMonitorMode: "album" }), true);
assert.equal(isLibraryGraduatedAlbum({ monitored: false, trackMonitorMode: "selected" }), false);

console.log("lidarr-flow-cleanup.test.js ok");
