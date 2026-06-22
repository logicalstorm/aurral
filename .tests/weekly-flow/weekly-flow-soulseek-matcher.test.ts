import test from "node:test";
import assert from "node:assert/strict";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const [
  {
    buildFlowSearchTiers,
    rankFlowSearchResults,
    selectRankedMatchAttempts,
    validateDownloadedTrack,
  },
] = await Promise.all([
  importFromRepo("backend/services/weeklyFlowSoulseekMatcher.ts"),
]);

test("rankFlowSearchResults rejects same-title single matches from the wrong artist", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "wrongArtist",
        file: "Shared\\Sophia Stel\\Object Permanence {mbid:4d55c255-f2ae-4eb1-93e3-724898b132d0} {Single}\\Sophia Stel_Object Permanence_02_Object Permanence.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
    ],
    {
      artistName: "Arm's Length",
      trackName: "Object Permanence",
      albumName: "Object Permanence - Single",
      releaseYear: "2019",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, false);
  assert.equal(
    ranked[0].preDownloadRejectReason,
    "weak-artist-ambiguous-title-album",
  );
});

test("rankFlowSearchResults still accepts same-title single matches from the right artist", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "rightArtist",
        file: "Shared\\Arm's Length\\Object Permanence {Single}\\Arm's Length - Object Permanence.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
    ],
    {
      artistName: "Arm's Length",
      trackName: "Object Permanence",
      albumName: "Object Permanence - Single",
      releaseYear: "2019",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, true);
});
test("buildFlowSearchTiers uses a short album-first plan", () => {
  const tiers = buildFlowSearchTiers({
    artistName: "Massive Attack",
    trackName: "Teardrop",
    albumName: "Mezzanine",
    releaseYear: "1998",
    artistAliases: ["Massive Attk"],
  });

  assert.equal(tiers[0]?.name, "base_album");
  assert.ok(
    tiers[0].queries.includes("Massive Attack Mezzanine 1998"),
  );
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "wildcard_album" &&
        tier.queries.includes("*assive *ttack Mezzanine 1998"),
    ),
  );
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "album_track" &&
        tier.queries.includes("Mezzanine Teardrop"),
    ),
  );
});

test("rankFlowSearchResults prefers folders with a strong tracklist fingerprint", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "weakUser",
        file: "Franz Ferdinand\\Misc\\01 - Take Me Out.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "albumUser",
        file: "Franz Ferdinand\\Franz Ferdinand (2004)\\01 - Jacqueline.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
      {
        user: "albumUser",
        file: "Franz Ferdinand\\Franz Ferdinand (2004)\\02 - Tell Her Tonight.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
      {
        user: "albumUser",
        file: "Franz Ferdinand\\Franz Ferdinand (2004)\\03 - Take Me Out.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
    ],
    {
      artistName: "Franz Ferdinand",
      trackName: "Take Me Out",
      albumName: "Franz Ferdinand",
      releaseYear: "2004",
      artistAliases: [],
      albumTrackCount: 3,
      albumTrackTitles: ["Jacqueline", "Tell Her Tonight", "Take Me Out"],
      trackNumber: 3,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.match(ranked[0].raw.file, /03 - Take Me Out\.flac$/);
  assert.equal(ranked[0].releaseFolderFit, true);
});

test("rankFlowSearchResults rejects older self-titled album folders for a new self-titled release", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "oldAlbumUser",
        file: "Weezer\\Weezer (1994)\\01 - My Name Is Jonas.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
    ],
    {
      artistName: "Weezer",
      trackName: "My Name Is Jonas",
      albumName: "Weezer",
      releaseYear: "2026",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, false);
  assert.equal(ranked[0].preDownloadRejectReason, "self-titled-year-mismatch");
});

test("rankFlowSearchResults prefers the fitting album folder over a higher-scoring wrong-album file", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "wrongAlbumUser",
        file: "Dashboard Confessional\\2001 The Places You Have Come to Fear the Most\\0101 - The Brilliant Dance (FLAC).flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "rentalsUser",
        file: "The Rentals\\Return Of The Rentals [1995]\\02 - The Rentals - Brilliant Boy.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
      {
        user: "rentalsUser",
        file: "The Rentals\\Return Of The Rentals [1995]\\01 - The Rentals - Warm.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 700000,
      },
    ],
    {
      artistName: "The Rentals",
      trackName: "Brilliant Boy",
      albumName: "Return of the Rentals",
      releaseYear: "1995",
      artistAliases: [],
      albumTrackCount: 2,
      albumTrackTitles: ["Warm", "Brilliant Boy"],
      trackNumber: 2,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.match(ranked[0].raw.file, /Brilliant Boy\.flac$/);
  assert.equal(ranked[0].releaseFolderFit, true);
  assert.match(ranked[0].raw.file, /Return Of The Rentals/);
});

test("rankFlowSearchResults prefers album-matching directories with the target track", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "albumUser",
        file: "Artist Name\\Album Name (1999)\\01 - Correct Track.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "albumUser",
        file: "Artist Name\\Album Name (1999)\\02 - Other Song.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "singleUser",
        file: "Artist Name\\Misc Folder\\Correct Track.mp3",
        size: 100,
        slots: true,
        bitrate: 320,
        speed: 600000,
      },
    ],
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
      releaseYear: "1999",
      artistAliases: [],
      albumTrackCount: 2,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.match(ranked[0].raw.file, /Album Name/);
  assert.equal(ranked[0].ext, ".flac");
  assert.equal(ranked[0].isLikelyMatch, true);
  assert.ok(ranked[0].score > ranked[ranked.length - 1].score);
});

test("rankFlowSearchResults falls back to a valid track outside the album folder when the album folder lacks it", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "albumUser",
        file: "Artist Name\\Album Name (1999)\\02 - Other Song.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "singleUser",
        file: "Artist Name\\Misc Folder\\Correct Track.mp3",
        size: 100,
        slots: true,
        bitrate: 320,
        speed: 600000,
      },
    ],
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
      releaseYear: "1999",
      artistAliases: [],
      albumTrackCount: 2,
      albumTrackTitles: ["Correct Track", "Other Song"],
      trackNumber: 1,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.match(ranked[0].raw.file, /Correct Track\.mp3$/);
  assert.equal(
    ranked.some((entry) => /Other Song/.test(entry.raw.file)),
    false,
  );
});

test("rankFlowSearchResults penalizes live variants when the requested track is plain", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "liveUser",
        file: "Artist Name\\Album Name\\01 - Correct Track (Live).flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "studioUser",
        file: "Artist Name\\Singles\\Correct Track.mp3",
        size: 100,
        slots: true,
        bitrate: 320,
        speed: 450000,
      },
    ],
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.match(ranked[0].raw.file, /Correct Track\.mp3$/);
});

test("rankFlowSearchResults accepts strong title and album matches without artist in path", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "albumUser",
        file: "Misc\\Demon Days\\03 - Feel Good Inc..flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
    ],
    {
      artistName: "Gorillaz",
      trackName: "Feel Good Inc.",
      albumName: "Demon Days",
      releaseYear: "2005",
      artistAliases: [],
      albumTrackCount: 15,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, true);
  assert.equal(ranked[0].isLikelyMatch, true);
});

test("rankFlowSearchResults ignores locked slskd files for downloads", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "lockedUser",
        file: "Artist Name\\Album Name\\01 - Correct Track.flac",
        size: 100,
        slots: false,
        locked: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "openUser",
        file: "Artist Name\\Album Name\\01 - Correct Track.mp3",
        size: 100,
        slots: true,
        locked: false,
        bitrate: 320,
        speed: 700000,
      },
    ],
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.equal(ranked.some((entry) => entry.raw.user === "lockedUser"), false);
  assert.equal(ranked[0].raw.user, "openUser");
});

test("rankFlowSearchResults skips blacklisted users and penalizes queued users", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "deadUser",
        file: "Artist Name\\Album Name\\01 - Correct Track.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "queuedUser",
        file: "Artist Name\\Album Name\\01 - Correct Track.flac",
        size: 100,
        slots: true,
        bitrate: 900,
        speed: 900000,
      },
      {
        user: "healthyUser",
        file: "Artist Name\\Album Name\\01 - Correct Track.mp3",
        size: 100,
        slots: true,
        bitrate: 320,
        speed: 700000,
      },
    ],
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
      artistAliases: [],
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
      isUserBlacklisted: (user) => user === "deadUser",
      getUserQueuePenalty: (user) => (user === "queuedUser" ? 200 : 0),
    },
  );

  assert.equal(ranked.some((entry) => entry.raw.user === "deadUser"), false);
  assert.equal(ranked[0].raw.user, "healthyUser");
});

test("selectRankedMatchAttempts spreads early attempts across users before reusing one", () => {
  const selected = selectRankedMatchAttempts(
    [
      {
        score: 100,
        raw: { user: "queuedUser", file: "A\\Album\\01 - Song.flac" },
      },
      {
        score: 99,
        raw: { user: "queuedUser", file: "A\\Album\\01 - Song.mp3" },
      },
      {
        score: 98,
        raw: { user: "altUser", file: "B\\Album\\01 - Song.flac" },
      },
      {
        score: 97,
        raw: { user: "thirdUser", file: "C\\Album\\01 - Song.flac" },
      },
    ],
    3,
  );

  assert.deepEqual(
    selected.map((entry) => entry.raw.user),
    ["queuedUser", "altUser", "thirdUser"],
  );
});

test("validateDownloadedTrack rejects obvious live mismatches from the remote filename", async () => {
  const validation = await validateDownloadedTrack(
    "/tmp/does-not-exist.mp3",
    {
      raw: {
        file: "Artist Name\\Album Name\\01 - Correct Track (Live).mp3",
      },
    },
    {
      artistName: "Artist Name",
      trackName: "Correct Track",
      albumName: "Album Name",
    },
  );

  assert.equal(validation.valid, false);
  assert.equal(validation.scores.trackNumberMismatch, false);
  assert.ok(validation.scores.variant < 0);
});

test("validateDownloadedTrack accepts candidates that pass pre-download thresholds", async () => {
  const validation = await validateDownloadedTrack(
    "/tmp/does-not-exist.flac",
    {
      raw: {
        file: "Of Mice & Men\\Of Mice & Men\\03 - Second & Sebring.flac",
      },
    },
    {
      artistName: "Of Mice & Men",
      trackName: "Second & Sebring",
      albumName: "Of Mice & Men",
      trackNumber: 3,
    },
  );

  assert.equal(validation.valid, true);
  assert.ok(validation.scores.title >= 82);
});

test("validateDownloadedTrack still scores preDownloadValid candidates", async () => {
  const validation = await validateDownloadedTrack(
    "/tmp/does-not-exist.flac",
    {
      preDownloadValid: true,
      raw: {
        file: "Of Mice & Men\\Of Mice & Men\\03 - Second & Sebring.flac",
      },
    },
    {
      artistName: "Of Mice & Men",
      trackName: "Second & Sebring",
      albumName: "Of Mice & Men",
      trackNumber: 3,
      durationMs: 433000,
    },
  );

  assert.equal(validation.valid, true);
  assert.notEqual(validation.scores.matchReason, "pre-download-trusted");
  assert.equal(validation.scores.preDownloadValid, true);
  assert.ok(validation.scores.title >= 82);
});

test("rankFlowSearchResults accepts soulseek backslash paths for albums with live in the title", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "deveng",
        file: "music\\From Autumn To Ashes\\The Fiction We Live\\01 The After Dinner Payback.flac",
        slots: 1,
        speed: 7440000,
      },
      {
        user: "PassOnTheTorch",
        file: "music\\From Autumn to Ashes\\The Fiction We Live\\01 The After Dinner Payback.flac",
        slots: 1,
        speed: 6000000,
      },
    ],
    {
      artistName: "From Autumn to Ashes",
      trackName: "The After Dinner Payback",
      albumName: "The Fiction We Live",
      releaseYear: "2003",
      trackNumber: 1,
      albumTrackCount: 12,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, true);
  assert.equal(ranked[0].preDownloadRejectReason, null);
  assert.match(ranked[0].raw.file, /After Dinner Payback\.flac$/);
});

test("rankFlowSearchResults does not treat live as a variant in ordinary title words", () => {
  const ranked = rankFlowSearchResults(
    [
      {
        user: "albumUser",
        file: "Artist\\The Fiction We Live\\03 - The Fiction We Live.flac",
        slots: 1,
        speed: 700000,
      },
    ],
    {
      artistName: "From Autumn to Ashes",
      trackName: "The Fiction We Live",
      albumName: "The Fiction We Live",
      releaseYear: "2003",
      trackNumber: 3,
    },
    {
      preferredFormat: "flac",
      strictFormat: false,
    },
  );

  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].preDownloadValid, true);
  assert.equal(ranked[0].breakdown.variantHardMismatch, false);
});
