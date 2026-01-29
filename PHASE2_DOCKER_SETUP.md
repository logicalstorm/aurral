# Phase 2 Docker Setup Guide

## Volume Configuration

For Phase 2 (Weekly Flow), you need **two additional volumes**:

1. **Weekly Flow temp folder** - where downloads are stored
2. **Navidrome music folder** - where symlinks are created

## Docker Configuration

**docker-compose.yml example:**

```yaml
services:
  aurral:
    build: .
    container_name: aurral
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./backend/data:/app/data
      - /data/downloads/tmp:/app/weekly-flow
      - /data/music:/app/navidrome-music:ro
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

**Notes:**

- `/data/downloads/tmp` = your **host** path for temporary downloads (can be any path)
- `/data/music` = your **host** path to Navidrome's music folder
- `/app/weekly-flow` = **container** path for downloads (hardcoded default)
- `/app/navidrome-music` = **container** path for symlinks (hardcoded default, no env var needed!)
- `:ro` (read-only) is recommended - Aurral only creates symlinks, doesn't need write access

**No environment variables needed!** The container paths are hardcoded defaults.

## Testing (Local Dev)

For local development without Docker, you can override the default:

**`.env` file (optional):**

```bash
NAVIDROME_MUSIC_FOLDER=/Users/yourname/Music/navidrome
```

Or set `integrations.navidrome.musicFolder` via the Settings API/UI.

**Note:** In Docker, the default `/app/navidrome-music` is used automatically - no configuration needed!

## Path Summary

| Context                       | Path Type            | Example                                    |
| ----------------------------- | -------------------- | ------------------------------------------ |
| **Host** (your machine)       | Actual filesystem    | `/data/music`                              |
| **Docker volume mount**       | Host → Container     | `/data/music:/app/navidrome-music`         |
| **Container** (inside Docker) | Where Aurral sees it | `/app/navidrome-music` (hardcoded default) |

## Important Notes

1. **No env var needed in Docker**: The container path `/app/navidrome-music` is the hardcoded default. Just mount your Navidrome music folder to that path.

2. **Read-only vs Read-write**:
   - `:ro` (read-only) is recommended - Aurral only creates symlinks
   - Remove `:ro` if you need write access (not required for symlinks)

3. **Weekly Flow folder**: Can be any path on host, mounted to `/app/weekly-flow` in container (hardcoded default).

4. **Symlink creation**: Aurral creates symlinks at:
   - Container: `/app/navidrome-music/.aurral-weekly-flow/{playlist-type}/...`
   - Which maps to host: `/data/music/.aurral-weekly-flow/{playlist-type}/...` (or whatever you mounted)
