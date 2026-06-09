import test from "node:test";
import assert from "node:assert/strict";
import { WeeklyFlowPlaylistSource } from "../../backend/services/weeklyFlowPlaylistSource.js";

test("harvest limit scales with target without over-fetching", () => {
  const source = new WeeklyFlowPlaylistSource();
  assert.equal(source._harvestLimitFor(10), 30);
  assert.equal(source._harvestLimitFor(30), 72);
  assert.equal(source._harvestLimitFor(100), 72);
});

test("mix album pick prefers top track list metadata before track.getInfo", () => {
  const source = new WeeklyFlowPlaylistSource();
  const ownedTitles = new Set(["owned track"]);
  const ownedAlbums = new Set(["owned album"]);
  const trackList = [
    { name: "Owned Track", album: { title: "Owned Album" } },
    { name: "Fresh Track", album: { title: "New Album" } },
  ];
  const picked = source._pickTrackFromRangesWithOwnedAlbumsUsingListMetadata(
    trackList,
    ownedTitles,
    ownedAlbums,
    [{ start: 0, end: 5 }],
  );
  assert.equal(picked?.pick?.name, "Fresh Track");
  assert.equal(picked?.albumName, "New Album");
});
