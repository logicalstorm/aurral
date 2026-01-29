# Phase 2 Architecture: Weekly Flow with In-House Soulseek + Navidrome

## Current State (Phase 1)

- **Deploy**: Single `docker-compose`; no media volumes. Lidarr owns all media and is reached via API.
- **Album/track requests**: Handled entirely by Lidarr; Aurral never touches media paths.
- **Result**: User runs Aurral with minimal config (Lidarr URL + API key). No volume mapping for music.

## Phase 2 Goal

- **Weekly Flow**: Aurral runs a simple in-house Soulseek client, downloads temp tracks into a **dedicated folder** (`./weekly-flow`), creates Navidrome playlists that appear in the **user's main library** (no second library needed), and on a **weekly schedule** deletes those playlists and files and starts a new batch.
- **Multi-Playlist Support**: Each playlist type has its own subfolder (e.g., `./weekly-flow/discover/`, `./weekly-flow/recommended/`). All songs for a specific playlist go into that playlist's folder.
- **Constraint**: Do **not** write Weekly Flow files directly into the user's main media/library paths. Keep temp content isolated so deletes and re-downloads cannot affect Lidarr/Navidrome main library.
- **User Experience**: Playlists appear in the user's main Navidrome account (the one they configure in settings). No library switching required.

## Solution: Symlinks to Main Library

**Problem**: Navidrome's main library scans ONE root folder (`ND_MUSICFOLDER`). To make Weekly Flow songs appear in the main library without creating a second library, we need them to be accessible within that root folder.

**Solution**: Use **symlinks** from the main Navidrome library folder to our isolated `./weekly-flow` folder.

**Flow**:

1. **Download**: Aurral downloads tracks to playlist-specific folders: `./weekly-flow/{playlist-name}/Artist/Album/track.flac` (e.g., `./weekly-flow/discover/Artist/Album/track.flac`).
2. **Symlink**: Aurral creates symlinks in a subfolder of the main Navidrome library (e.g., `/music/.aurral-weekly-flow/{playlist-name}/Artist/Album/track.flac` → `/weekly-flow/{playlist-name}/Artist/Album/track.flac`).
3. **Index**: Navidrome scans its main library, follows symlinks, indexes the files. Songs appear in the main library.
4. **Playlist**: Aurral creates playlist (e.g., "Aurral Discover", "Aurral Recommended") via Navidrome API using song IDs (normal flow).
5. **Weekly Reset**: Delete playlists via API, delete symlinks, delete files in `./weekly-flow/{playlist-name}/`, start fresh.

**Benefits**:

- ✅ Songs appear in user's main Navidrome library (no second library needed).
- ✅ No library switching required.
- ✅ Temp files stay isolated in `./weekly-flow` (safe to delete).
- ✅ Symlinks are just pointers; deleting them doesn't affect the source files until we delete the source.
- ✅ Navidrome follows symlinks automatically during scans.

## Shared Volumes: Aurral + Navidrome

Weekly Flow requires **two** shared paths:

1. **`./weekly-flow`** (temp downloads folder):
   - **Aurral**: read/write (download, delete on weekly reset).
   - **Navidrome**: read-only (follows symlinks to read files).
   - **Lidarr**: not needed.

2. **Main Navidrome library folder** (where symlinks are created):
   - **Aurral**: write (create/delete symlinks in `.aurral-weekly-flow/` subfolder).
   - **Navidrome**: read (scans main library, follows symlinks).
   - **Lidarr**: not needed (Lidarr doesn't touch this).

**Configuration Requirement**:

- User must provide **Navidrome music folder path** in settings (or we detect it via API if possible).
- User mounts `./weekly-flow` to their own temp folder that Navidrome can access (via shared volume).
- Aurral creates symlinks at: `{navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/Artist/Album/track.flac` → `{weeklyFlowFolder}/{playlist-name}/Artist/Album/track.flac`
- Navidrome scans its main library, sees symlinks, indexes them. Songs appear in main library.

**Docker Volumes**:

- `./weekly-flow:/app/weekly-flow` (Aurral only - temp downloads).
- `{user's navidrome music folder}:/app/navidrome-music:ro` (Aurral read-only for symlink creation, or user mounts it read-write if they prefer).
- Navidrome already has access to its main music folder (user's existing setup).

## High-Level Data Flow

1. **Download (Aurral)**
   - Soulseek client downloads tracks to playlist-specific folders: `./weekly-flow/{playlist-name}/Artist/Album/track.flac`
   - Examples: `./weekly-flow/discover/Artist/Album/track.flac`, `./weekly-flow/recommended/Artist/Album/track.flac`

2. **Create Symlinks (Aurral)**
   - For each downloaded file, create symlink: `{navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/Artist/Album/track.flac` → `./weekly-flow/{playlist-name}/Artist/Album/track.flac`
   - Symlinks are created in a hidden subfolder (`.aurral-weekly-flow`) organized by playlist name so they don't clutter the main library view.

3. **Index (Navidrome)**
   - Navidrome scans its main library (file watcher or periodic scan).
   - Follows symlinks, indexes the files.
   - Songs appear in the main library (no second library needed).

4. **Playlist Creation (Aurral → Navidrome API)**
   - Aurral uses Navidrome API (`search3` or similar) to find the songs for each playlist and get their **song IDs**.
   - Creates/updates playlists (e.g., "Aurral Discover", "Aurral Recommended") with those song IDs.
   - Playlists appear in user's main Navidrome account.

5. **Weekly Reset**
   - Delete all Weekly Flow playlists via Navidrome API.
   - Delete all symlinks in `{navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/`.
   - Delete all files in `./weekly-flow/{playlist-name}/` for each playlist.
   - Optionally trigger Navidrome scan (`startScan`) so it drops DB entries for removed files.
   - Start next batch (downloads → symlinks → index → playlists).

## Docker / Volume Shape

- **Today**:
  - `docker-compose.yml`: only `./backend/data` for app data; no media volume.
  - Lidarr and Navidrome are external; user points Aurral at their URLs.

- **Phase 2 (minimal)**
  - Add **two** volumes:
    1. `./weekly-flow:/app/weekly-flow` - temp downloads (Aurral read/write).
    2. `{user's navidrome music folder}:/app/navidrome-music:ro` - for symlink creation (Aurral read-only, or read-write if user prefers).
  - **User responsibility**: Provide Navidrome music folder path in settings (or we auto-detect if possible).
  - No second library needed - symlinks make songs appear in main library.

**Example – Aurral volumes for Phase 2:**

```yaml
volumes:
  - ./backend/data:/app/data
  - ./weekly-flow:/app/weekly-flow
  - /path/to/user/music:/app/navidrome-music:ro
```

**Note**:

- User must configure their Navidrome music folder path in Aurral settings.
- User mounts `./weekly-flow` to their own temp folder (e.g., `/tmp/aurral-weekly-flow` or a named volume).
- Aurral will create symlinks at `/app/navidrome-music/.aurral-weekly-flow/{playlist-name}/` pointing to files in `/app/weekly-flow/{playlist-name}/`.
- Navidrome scans its main library and indexes the symlinked files automatically.
- Each playlist type has its own folder: `discover/`, `recommended/`, etc.

## Summary

| Question                                                               | Answer                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Do Aurral and Navidrome need access to the same volumes for Phase 2?   | **Yes** – `./weekly-flow` (temp downloads) and main Navidrome music folder (for symlinks).                                    |
| Do we have to put temp songs directly in the user's main media folder? | **No.** Download to `./weekly-flow`, create symlinks in main library. Temp files stay isolated.                               |
| Do users need to create a second Navidrome library?                    | **No.** Symlinks make songs appear in the main library automatically.                                                         |
| Do users need to switch libraries to see playlists?                    | **No.** Playlists appear in their main Navidrome account (the one they configure in settings).                                |
| Does this complicate the "simple deploy"?                              | Only for users who enable Weekly Flow: two extra volumes (weekly-flow + navidrome music folder). Lidarr-only users unchanged. |

This gives a clear, safe plan: isolated temp downloads in `./weekly-flow`, symlinks to main Navidrome library, playlists appear in main account, no second library needed.

---

## Multi-Playlist Folder Structure

**Internal Structure** (`./weekly-flow` inside container):

```
./weekly-flow/
├── _staging/
│   └── {jobId}/
│       └── (temp file while Soulseek downloads; moved to playlist folder on success)
├── discover/
│   ├── Artist Name/
│   │   └── Album Name/
│   │       └── 01 - Track.flac
│       └── ...
├── recommended/
│   ├── Artist Name/
│   │   └── Album Name/
│   │       └── 01 - Track.flac
│       └── ...
└── {future-playlist-types}/
    └── ...
```

Download flow (Soulseek client + tracker + worker) is described in **PHASE2_SOULSEEK_ARCHITECTURE.md**: get track lists from Last.fm or internal → queue jobs → Soulseek download → track status → on success move to playlist folder.

**Symlink Structure** (in Navidrome main library):

```
{navidromeMusicFolder}/.aurral-weekly-flow/
├── discover/
│   ├── Artist Name/
│   │   └── Album Name/
│   │       └── 01 - Track.flac → {weeklyFlowFolder}/discover/Artist Name/Album Name/01 - Track.flac
│       └── ...
├── recommended/
│   ├── Artist Name/
│   │   └── Album Name/
│   │       └── 01 - Track.flac → {weeklyFlowFolder}/recommended/Artist Name/Album Name/01 - Track.flac
│       └── ...
└── {future-playlist-types}/
    └── ...
```

**Benefits**:

- ✅ Each playlist type is isolated in its own folder.
- ✅ Easy to manage per-playlist (download, symlink, create playlist, reset).
- ✅ Can reset individual playlists without affecting others.
- ✅ Clear organization for debugging and maintenance.
- ✅ Scales to any number of playlist types.

**Playlist Types** (initial + future):

- `discover/` - "Aurral Discover" playlist
- `recommended/` - "Aurral Recommended" playlist
- Future: `trending/`, `new-releases/`, `similar-artists/`, etc.

## Implementation Notes

### Symlink Creation

**Path Structure**:

- Download: `./weekly-flow/{playlist-name}/Artist Name/Album Name/01 - Track.flac`
  - Examples: `./weekly-flow/discover/Artist/Album/track.flac`, `./weekly-flow/recommended/Artist/Album/track.flac`
- Symlink: `{navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/Artist Name/Album Name/01 - Track.flac` → `{weeklyFlowFolder}/{playlist-name}/Artist Name/Album Name/01 - Track.flac`

**Implementation**:

- After each download completes, create symlink maintaining the same folder structure within the playlist folder.
- Use `fs.symlink()` or `fs.promises.symlink()` (Node.js).
- Ensure parent directories exist before creating symlink (both in weekly-flow and in navidrome-music).
- Handle errors gracefully (permissions, path issues).
- Organize symlinks by playlist name for easy per-playlist cleanup.

**Cleanup**:

- On weekly reset, delete all symlinks in `.aurral-weekly-flow/{playlist-name}/` for each playlist.
- Delete recursively: `rm -rf {navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/*` or equivalent.
- Delete all files in `./weekly-flow/{playlist-name}/` for each playlist.
- Can reset all playlists at once, or reset individual playlists independently.

### Navidrome Music Folder Detection

**Options**:

1. **User Configuration**: Add setting `integrations.navidrome.musicFolder` (user provides path).
2. **API Detection**: If Navidrome exposes the music folder path via API, fetch it automatically.
3. **Environment Variable**: `NAVIDROME_MUSIC_FOLDER` (user sets in docker-compose).

**Recommendation**: Start with user configuration (most reliable). Add auto-detection later if Navidrome API supports it.

### Playlist Creation (Song IDs)

Navidrome playlists are built from **song IDs** (Subsonic API). Flow:

1. Aurral downloads tracks for a specific playlist to `./weekly-flow/{playlist-name}/Artist/Album/track.flac`.
2. Aurral creates symlinks in main Navidrome library: `{navidromeMusicFolder}/.aurral-weekly-flow/{playlist-name}/Artist/Album/track.flac`.
3. **Wait for Navidrome to index** (file watcher or trigger scan via `startScan` API).
4. Aurral calls Navidrome API (`search3` or browse) to find the songs for that playlist and get their `id`s.
5. Aurral creates/updates playlist (e.g., "Aurral Discover", "Aurral Recommended") with those song IDs.
6. Repeat for each playlist type.

**Timing**: May need to wait a few seconds after creating symlinks before Navidrome indexes them. Consider:

- Polling Navidrome search until songs appear.
- Or triggering `startScan` after creating symlinks (if available).
- Can process playlists in parallel or sequentially.

**Multi-Playlist Support**:

- Each playlist type has its own folder: `discover/`, `recommended/`, etc.
- Songs for a playlist are downloaded to that playlist's folder.
- Each playlist is created/updated independently.
- Weekly reset can be per-playlist or global (all playlists at once).

### After Weekly Delete

When we delete symlinks and files, Navidrome's DB will still have entries. Options:

- **Trigger a scan** via `startScan` API so Navidrome drops orphaned entries.
- Or rely on Navidrome's **periodic scan / file watcher** to eventually clean up.

**Recommendation**: Call `startScan` after weekly delete to keep the library clean immediately.

### Symlink Considerations

**Cross-Platform**: Symlinks work on Linux/macOS. On Windows, may need admin privileges or use junctions. Docker typically runs on Linux, so symlinks should work.

**Permissions**: Ensure Aurral container has write access to Navidrome music folder (for symlink creation). User may need to mount it read-write, or we document the permission requirements.

**Path Resolution**: Use absolute paths for symlinks to avoid issues with relative paths.
