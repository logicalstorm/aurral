# Phase 2 Testing Guide

## Prerequisites

1. **Restart the server** so `/api/weekly-flow` routes are mounted (root `server.js` mounts them).
2. **Auth**: If you use a password (Settings or `AUTH_PASSWORD`), add Basic auth to every curl:
   ```bash
   curl -u admin:YOUR_PASSWORD http://localhost:3001/api/weekly-flow/status
   ```

## Testing Without Navidrome

Since Navidrome is not available, we can test:

- ✅ Soulseek client connection
- ✅ Download tracking
- ✅ File downloads to weekly-flow folders
- ✅ Worker processing
- ⏭️ Symlink creation (skipped - needs Navidrome folder)
- ⏭️ Navidrome playlist creation (skipped - needs Navidrome)

## Step 1: Verify Soulseek Client

**Test connection:**

```bash
# Check if Soulseek credentials are auto-generated
curl http://localhost:3001/api/weekly-flow/status
```

The worker should show `soulseekClient.isConfigured() === true` (credentials auto-generated).

## Step 2: Start a Small Test Download

**Start discover playlist with just 3 tracks:**

```bash
curl -X POST http://localhost:3001/api/weekly-flow/start/discover \
  -H "Content-Type: application/json" \
  -d '{"limit": 3}'
```

**Expected response:**

```json
{
  "success": true,
  "playlistType": "discover",
  "tracksQueued": 3,
  "jobIds": ["uuid1", "uuid2", "uuid3"]
}
```

## Step 3: Monitor Download Progress

**Check status:**

```bash
curl http://localhost:3001/api/weekly-flow/status
```

**Expected response:**

```json
{
  "worker": {
    "running": true,
    "processing": true,
    "stats": {
      "total": 3,
      "pending": 0,
      "downloading": 1,
      "done": 2,
      "failed": 0
    }
  },
  "stats": { ... },
  "jobs": [ ... ]
}
```

**Check specific jobs:**

```bash
curl http://localhost:3001/api/weekly-flow/jobs/discover
```

## Step 4: Verify Files Downloaded

**Check weekly-flow folder:**

```bash
ls -la ./weekly-flow/discover/
# Should see: Artist Name/Album Name/track.ext
```

**Expected structure:**

```
./weekly-flow/
├── _staging/
│   └── {jobId}/
└── discover/
    ├── Artist Name/
    │   └── Unknown Album/
    │       └── Track Name.flac
    └── ...
```

## Step 5: Test Worker Control

**Stop worker:**

```bash
curl -X POST http://localhost:3001/api/weekly-flow/worker/stop
```

**Start worker:**

```bash
curl -X POST http://localhost:3001/api/weekly-flow/worker/start
```

## Step 6: Test Playlist Source

**Test getting tracks (without downloading):**

```bash
# This would need a test endpoint, or check logs
# The playlist source should fetch tracks from Last.fm
```

## Troubleshooting

### Soulseek Connection Fails

- Check logs for connection errors
- Verify Soulseek network is accessible
- Auto-generated credentials should work (no real account needed)

### Downloads Fail

- Check if tracks exist on Soulseek
- Some tracks may not be available
- Check worker logs for specific errors

### Files Not Appearing

- Check `./weekly-flow/discover/` folder exists
- Verify worker is running: `GET /api/weekly-flow/status`
- Check job status: `GET /api/weekly-flow/jobs`

### Worker Not Processing

- Ensure worker is started: `POST /api/weekly-flow/worker/start`
- Check if there are pending jobs: `GET /api/weekly-flow/jobs?status=pending`
- Check logs for errors

## What to Verify

✅ **Soulseek Client:**

- Auto-generates credentials on first use
- Connects successfully
- Can search for tracks
- Can download files

✅ **Download Tracker:**

- Jobs are created correctly
- Status updates (pending → downloading → done/failed)
- Can query by playlist type and status

✅ **Worker:**

- Processes pending jobs
- Downloads files to staging
- Moves files to playlist folders
- Updates tracker on completion

✅ **File Structure:**

- Files appear in `./weekly-flow/{playlistType}/Artist/Album/track.ext`
- Staging folder is cleaned up after download
- Folder structure is correct

## Next Steps (After Navidrome Available)

1. Mount Navidrome music folder in Docker
2. Test symlink creation
3. Test Navidrome playlist creation
4. Test full end-to-end flow
