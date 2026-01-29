# Phase 2: Internal Soulseek Client Architecture

## Overview

This document describes the internal Soulseek client and download-tracking design for Weekly Flow playlists. Flow: get track lists (Last.fm or internal) → send each track to Soulseek → track which song goes to which playlist and status (downloading/done/failed) → on completion move file to the correct playlist folder.

## 1. Playlist Source (Track Lists)

We need **track-level** data: `{ artistName, trackName }[]` per playlist type.

**Options**:

- **Last.fm**: Use existing discovery cache (artists) and/or call Last.fm for tracks.
  - `chart.getTopTracks` – trending tracks (we already use this for artists; can keep full track info).
  - `user.getTopTracks` – user’s top tracks (period).
  - `tag.getTopTracks` – top tracks for a tag/genre.
  - `artist.getTopTracks` – top tracks per artist (for “recommended” from discovery artists).
- **Internal**: Build track list from discovery cache (recommendations, globalTop, basedOn) by resolving “top tracks” per artist (e.g. via Last.fm `artist.getTopTracks` or a fixed sample).

**Output per playlist type**:

- `discover`: e.g. N tracks from Last.fm chart/tag or from discovery “recommendations” + artist.getTopTracks.
- `recommended`: e.g. N tracks from discovery “globalTop” or “basedOn” + artist.getTopTracks.

**Module**: `weeklyFlowPlaylistSource` (or extend `discoveryService`).

- `getTracksForPlaylist(playlistType, limit)` → `Promise<{ artistName, trackName }[]>`.
- Implementations: Last.fm-only, internal-only, or hybrid (internal artists + Last.fm to get track names).
- No Soulseek or file I/O here; pure “list of tracks to download.”

## 2. Download Job and Tracker

Each unit of work is a **download job**: one track, one playlist type.

**Job shape** (in-memory or DB):

```ts
{
  id: string;              // uuid or slug
  artistName: string;
  trackName: string;
  playlistType: string;     // "discover" | "recommended" | ...
  status: "pending" | "downloading" | "done" | "failed";
  error?: string;           // if failed
  stagingPath?: string;     // temp path while downloading (if using staging)
  finalPath?: string;       // weekly-flow/{playlistType}/Artist/Album/track.ext
  startedAt?: number;
  completedAt?: number;
}
```

**Tracker responsibilities**:

- Add jobs (from playlist source).
- Assign “pending” → “downloading” when worker picks a job.
- Update “done” (and optional `finalPath`) or “failed” (and `error`) when Soulseek callback fires.
- Query: by playlistType, by status, list all for a run.

**Module**: `weeklyFlowDownloadTracker` (or `downloadTracker`).

- `addJob(artistName, trackName, playlistType)` → job id.
- `addJobs(tracks[], playlistType)` → job ids.
- `getNextPending()` or `getPending(limit)` for workers.
- `setDownloading(id)`, `setDone(id, finalPath)`, `setFailed(id, error)`.
- `getByPlaylistType(playlistType)`, `getAll()`, optional persistence (SQLite like rest of app).

Start in-memory; add DB later if we need persistence across restarts.

## 3. Soulseek Client (Internal)

Minimal client that:

- Connects with user credentials (from settings/env).
- **Search**: `search(artistName, trackName)` → list of results (e.g. `{ username, path, size, ... }`).
- **Pick best**: `pickBestMatch(results, trackName)` → one result (e.g. prefer FLAC, then MP3 320).
- **Download**: `download(result, destinationPath)` → stream/write file to `destinationPath`. Callback or Promise on done/fail.

**Download destination strategy**:

- **Option A – Staging then move**: Download to a staging dir, e.g. `./weekly-flow/_staging/{jobId}/filename.ext`. On success: move/rename to `./weekly-flow/{playlistType}/Artist/Album/track.ext` (derive from metadata or job). On failure: delete staging file if any; tracker marks failed.
- **Option B – Direct to playlist folder**: If the client supports “save to this path,” download straight to `./weekly-flow/{playlistType}/Artist/Album/track.ext`. Tracker only needs to record `finalPath` when done.

**Module**: `simpleSoulseekClient.js` (or `soulseekClient.js`).

- `connect()`, `disconnect()`, `isConnected()`.
- `search(artistName, trackName)` → results.
- `pickBestMatch(results, trackName)` → single result.
- `download(result, destinationPath)` → Promise<void> or callback; on success file exists at `destinationPath`, on failure reject or callback(err).

Dependencies: e.g. `slsk-client` (or chosen npm package). Keep this module thin: no playlist logic, no tracker logic—only connect, search, pick best, download to path.

## 4. Worker: Tie Tracker + Soulseek + Playlist Folders

A single worker (or a small pool) processes jobs:

1. **Take job**: `job = tracker.getNextPending()` (or get N and process one by one). If none, sleep and retry.
2. **Set status**: `tracker.setDownloading(job.id)`.
3. **Resolve path**:
   - If staging: `stagingPath = ./weekly-flow/_staging/{job.id}/` (client will write a file here; we may get filename from Soulseek).
   - Final path: `finalPath = ./weekly-flow/{job.playlistType}/{Artist}/{Album}/{filename}`. Artist/Album can come from Soulseek result metadata or be defaulted (e.g. job.artistName / “Unknown Album”) if the client doesn’t provide it.
4. **Soulseek**: `client.search(job.artistName, job.trackName)` → `pickBestMatch` → `download(result, stagingPath)` (or `download(result, finalPath)` if direct).
5. **On success**:
   - If staging: move file from staging to `finalPath` (create `Artist/Album` dirs under `./weekly-flow/{job.playlistType}/`), then delete staging dir.
   - If direct: no move.
   - `tracker.setDone(job.id, finalPath)`.
6. **On failure**: `tracker.setFailed(job.id, error.message)`. Optionally delete partial file in staging.

**Concurrency**: Process one job at a time per worker to avoid overloading Soulseek; multiple workers possible later with a simple queue.

**Module**: `weeklyFlowWorker.js` (or `soulseekDownloadWorker.js`).

- Uses: tracker, Soulseek client, config (weeklyFlowRoot, paths).
- Loop or interval: get pending job → download → update tracker → move to playlist folder (if staging).
- No playlist-source logic here; only “consume tracker jobs and drive Soulseek + file moves.”

## 5. End-to-End Flow (Single Playlist Type)

1. **Build track list**: `tracks = await getTracksForPlaylist("discover", 30)` (Last.fm or internal).
2. **Enqueue jobs**: `tracker.addJobs(tracks, "discover")`.
3. **Worker** (already running or started):
   - Picks pending job (artistName, trackName, playlistType = "discover").
   - Downloads via Soulseek to staging (or direct to `./weekly-flow/discover/...`).
   - On done: move to `./weekly-flow/discover/Artist/Album/track.ext` if staging; update tracker done.
   - On fail: update tracker failed.
4. **Later**: Symlink + Navidrome playlist creation (see PHASE2_ARCHITECTURE.md) use files under `./weekly-flow/discover/`.

Multiple playlist types: repeat steps 1–2 for `recommended` (and others); same worker pool processes all jobs; `job.playlistType` drives the `finalPath` and thus the playlist folder.

## 6. File Paths and Move Logic

- **Staging**: `./weekly-flow/_staging/{jobId}/` – one dir per job; Soulseek client writes one (or more) files there. After success we move the main file (e.g. by extension or single file) to the final path and remove the staging dir.
- **Final**: `./weekly-flow/{playlistType}/{artistName}/{albumName}/{filename}`.
  - `artistName` / `albumName`: from Soulseek result if available, else fallback to `job.artistName` and e.g. `"Unknown Album"`.
  - Sanitize dir names (remove path separators, etc.).
- **Move**: Use `fs.rename` or copy+unlink; ensure parent dirs exist (`mkdirp`).

## 7. Summary Table

| Component        | Responsibility                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Playlist source  | Get `{ artistName, trackName }[]` per playlist type (Last.fm or internal).                    |
| Download tracker | Store jobs (artist, track, playlistType, status); pending → downloading → done/failed.        |
| Soulseek client  | Connect, search, pick best match, download to a given path.                                   |
| Worker           | Poll tracker, run Soulseek download, on success move to playlist folder, update tracker.      |
| Playlist folder  | `./weekly-flow/{playlistType}/Artist/Album/track.ext` (and symlinks per PHASE2_ARCHITECTURE). |

## 8. Implementation Order

1. **Download tracker** – in-memory job store + add/get/update APIs.
2. **Soulseek client** – connect, search, pickBestMatch, download to path (staging or final).
3. **Worker** – consume tracker, call client, move to `./weekly-flow/{playlistType}/...`, update tracker.
4. **Playlist source** – `getTracksForPlaylist(playlistType, limit)` using Last.fm (and/or discovery cache + artist.getTopTracks).
5. **Orchestration** – “start weekly flow for discover”: get tracks → add jobs → ensure worker running. Same for `recommended` when added.

This keeps “get playlists from Last.fm or internal” separate from “send to Soulseek, track, move to playlist folder,” and makes it clear how each song is tied to a playlist and status until it’s in the right folder.
