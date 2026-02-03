# Artist Details Page – API Calls

All API calls made when loading the artist details page, in order.

---

## 1. Frontend on mount

| Call                | Backend       | External | Notes            |
| ------------------- | ------------- | -------- | ---------------- |
| `GET /api/settings` | Settings (DB) | —        | getAppSettings() |

---

## 2. SSE stream (single GET, then server-driven events)

**Request:** `GET /api/artists/:mbid/stream?token=...&artistName=...`

### 2a. Stream handler – sequential (blocks first "artist" event)

| #   | Call                               | Service | Notes                                                                                                   |
| --- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Lidarr `GET /api/v1/artist`        | Lidarr  | **Fetches ALL artists**; then `.find(mbid)` in memory. Used by getArtistByMbid().                       |
| 2   | libraryManager.getArtist(mbid)     | Lidarr  | Same as above: **Lidarr GET /artist** again (all artists).                                              |
| 3   | libraryManager.getAlbums(artistId) | Lidarr  | Lidarr `GET /api/v1/artist/:id` + **Lidarr `GET /api/v1/album`** (all albums), then filter by artistId. |

If artist **not** in Lidarr:

| #   | Call                                                           | Service     | Notes                  |
| --- | -------------------------------------------------------------- | ----------- | ---------------------- |
| 4   | MusicBrainz `GET /artist/:mbid?inc=tags+genres+release-groups` | MusicBrainz | 2s timeout, may retry. |

### 2b. Critical tasks (parallel; "complete" fires when these finish)

| #   | Call                                         | Service  | Notes                                                                           |
| --- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| 5   | libraryManager.getArtist(mbid)               | Lidarr   | **Lidarr GET /artist** again (all artists) – used to get artist name for cover. |
| 6   | dbOps.getImage(mbid)                         | Local DB | Image cache lookup.                                                             |
| 7   | Deezer `GET /search/artist?q=...&limit=5`    | Deezer   | Only if no cached image.                                                        |
| 8   | Last.fm `artist.getSimilar` (mbid, limit 20) | Last.fm  | 1 call.                                                                         |

### 2c. Non-critical tasks (after "complete" sent; run in background)

| #   | Call                                     | Service           | Notes                                                         |
| --- | ---------------------------------------- | ----------------- | ------------------------------------------------------------- |
| 9   | CoverArtArchive `GET /release-group/:id` | Cover Art Archive | Up to 20 release groups, batched 4 at a time (only uncached). |
| 10  | Last.fm `album.getInfo` (artist, album)  | Last.fm           | Up to 20 albums, batched 5 at a time.                         |

---

## 3. Frontend after "complete" event

| #   | Call                                   | Backend                            | Notes                                                                   |
| --- | -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| 11  | `GET /api/library/lookup/:mbid`        | libraryManager.getArtist(mbid)     | **Lidarr GET /artist** again (all artists).                             |
| 12  | `GET /api/library/artists/:mbid`       | libraryManager.getArtist(mbid)     | **Lidarr GET /artist** again if artist in library.                      |
| 13  | `GET /api/library/albums?artistId=...` | libraryManager.getAlbums(artistId) | Lidarr `GET /artist/:id` + **Lidarr `GET /api/v1/album`** (all albums). |

---

## Summary

| Source                    | Lidarr /artist (all) | Lidarr /album (all) | Lidarr /artist/:id | MusicBrainz | Deezer  | Last.fm          | CoverArtArchive | Our API |
| ------------------------- | -------------------- | ------------------- | ------------------ | ----------- | ------- | ---------------- | --------------- | ------- |
| Stream start              | 2                    | 1                   | —                  | 0 or 1      | —       | —                | —               | —       |
| Critical tasks            | 1                    | —                   | —                  | —           | 0 or 1  | 1                | —               | —       |
| After complete (frontend) | 1–2                  | 1                   | 1                  | —           | —       | —                | —               | 3       |
| **Total**                 | **4–5**              | **2**               | **1**              | **0–1**     | **0–1** | **1 + up to 20** | **0–20**        | **4**   |

---

## Main bottlenecks

1. **Lidarr `GET /api/v1/artist`** – No filter by MBID; returns **every artist**. Called 4–5 times per artist details load (stream start, cover task, lookup, getLibraryArtist).
2. **Lidarr `GET /api/v1/album`** – Returns **every album**. Called at least twice (stream + getLibraryAlbums).
3. **Duplicate work** – Stream already loads Lidarr artist + albums, but frontend calls `/library/lookup`, `/library/artists/:mbid`, and `/library/albums` again after "complete", causing more full Lidarr pulls.
4. **CoverArtArchive** – Up to 20 requests (batched); adds latency for album art.
5. **Last.fm album.getInfo** – Up to 20 requests for ratings; adds latency.

---

## Optimizations applied

1. **Lidarr list cache** – `GET /artist` and `GET /album` responses are cached for 30s in `lidarrClient`. Repeated calls (stream + cover + lookup + getLibraryArtist + getLibraryAlbums) reuse the same data when within TTL.
2. **Library in stream** – When the artist is in Lidarr, the stream sends a `library` SSE event with `{ exists: true, artist, albums }`. The frontend uses this and skips `GET /library/lookup/:mbid`, `GET /library/artists/:mbid`, and `GET /library/albums`.
3. **Cover task** – No longer calls `libraryManager.getArtist(mbid)`; uses `artistData?.name` from the stream.
