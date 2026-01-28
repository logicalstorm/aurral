# Migration Plan: slskd → Lidarr + Simple Soulseek Client

## Overview

This plan outlines the migration from slskd to a split architecture:

- **Lidarr**: User-requested albums/tracks (reliable, battle-tested)
- **Simple Soulseek Client**: Weekly Flow only (best-effort, minimal complexity)

---

## Phase 1: Revert to Lidarr Integration

### Goal

Restore reliable Lidarr integration for all user-requested downloads (albums and tracks).

### Prerequisites

- Lidarr instance running and accessible
- Lidarr API key configured
- Lidarr configured with Soulseek download client

### Tasks

#### 1.1 Create Lidarr Client Service

**File**: `backend/services/lidarrClient.js`

**Requirements**:

- Basic REST API wrapper for Lidarr
- Methods needed:
  - `testConnection()` - Verify Lidarr connectivity
  - `addArtist(mbid, artistName, options)` - Add artist to Lidarr
  - `addAlbum(artistId, albumMbid, albumName)` - Request album download
  - `getArtist(artistId)` - Get artist info
  - `getAlbum(albumId)` - Get album info
  - `getQueue()` - Get download queue
  - `getHistory()` - Get download history
  - `monitorArtist(artistId, monitorOption)` - Set monitoring options

**API Endpoints to implement**:

- `GET /api/v1/system/status` - System status
- `POST /api/v1/artist` - Add artist
- `GET /api/v1/artist/:id` - Get artist
- `PUT /api/v1/artist/:id` - Update artist
- `GET /api/v1/queue` - Get queue
- `GET /api/v1/history` - Get history
- `POST /api/v1/command` - Trigger commands (SearchMissing, etc.)

#### 1.2 Add Lidarr Configuration

**File**: `backend/config/db-helpers.js` (settings)

**Settings to add**:

```javascript
integrations: {
  lidarr: {
    url: process.env.LIDARR_URL || 'http://localhost:8686',
    apiKey: process.env.LIDARR_API_KEY || '',
    enabled: true,
  }
}
```

**Environment Variables**:

- `LIDARR_URL` (already in docker-compose.dev.yml)
- `LIDARR_API_KEY` (already in docker-compose.dev.yml)

#### 1.3 Update downloadManager.downloadAlbum()

**File**: `backend/services/downloadManager.js`

**Changes**:

- Replace `slskdClient.downloadAlbum()` with `lidarrClient.addAlbum()`
- Use Lidarr's artist/album management instead of direct downloads
- Monitor Lidarr queue for completion instead of slskd

**Flow**:

1. Ensure artist exists in Lidarr (add if needed)
2. Request album via Lidarr API
3. Monitor Lidarr queue/history for completion
4. Process completed files from Lidarr's download directory

#### 1.4 Update downloadManager.downloadTrack()

**File**: `backend/services/downloadManager.js`

**Note**: Lidarr doesn't support individual track downloads natively. Options:

- **Option A**: Download the album and extract the track (not ideal)
- **Option B**: Use Lidarr's "Search Missing" for the album, then extract track
- **Option C**: Keep track downloads using simple Soulseek client (recommended for Phase 2)

**For Phase 1**: We'll implement Option B (temporary) - download album, extract track.

#### 1.5 Remove slskd Download Monitoring for Albums/Tracks

**File**: `backend/services/downloadManager.js`

**Changes**:

- Remove `checkCompletedDownloads()` calls for `type === 'album'` or `type === 'track'`
- Keep monitoring only for `type === 'weekly-flow'` (until Phase 2)
- Add Lidarr queue monitoring instead

#### 1.6 Add Lidarr Event Monitoring

**File**: `backend/services/lidarrClient.js` or new `lidarrMonitor.js`

**Options**:

- **Option A**: Poll Lidarr queue/history API every 30-60 seconds
- **Option B**: Use Lidarr webhooks (if supported)
- **Option C**: Monitor Lidarr download directory for new files

**Recommended**: Option A (polling) for Phase 1, can optimize later.

**Implementation**:

- Poll `/api/v1/queue` for active downloads
- Poll `/api/v1/history` for completed downloads
- Match completed downloads to our download records
- Process completed files

#### 1.7 Update downloadQueue Routing

**File**: `backend/services/downloadQueue.js`

**Changes**:

- In `processItem()`, route based on download type:
  - `type === 'album'` → Use Lidarr
  - `type === 'track'` → Use Lidarr (temporary, see 1.4)
  - `type === 'weekly-flow'` → Keep using slskd (until Phase 2)

#### 1.8 Test Album Downloads

**Test Cases**:

1. Request album download via UI
2. Verify artist added to Lidarr
3. Verify album requested in Lidarr
4. Verify download appears in Lidarr queue
5. Verify completion detected when album finishes
6. Verify files processed and added to library

#### 1.9 Test Track Downloads

**Test Cases**:

1. Request track download via UI
2. Verify album download triggered in Lidarr
3. Verify track extracted/processed correctly
4. Verify track added to library

**Note**: This is temporary - Phase 2 will use simple Soulseek client for tracks.

#### 1.10 Update Docker Compose

**File**: `docker-compose.dev.yml` and `docker-compose.yml`

**Changes**:

- Add Lidarr service (if not already present)
- Ensure network connectivity between Aurral and Lidarr
- Verify environment variables are passed correctly

---

## Phase 2: Build Simple Soulseek Client for Weekly Flow

### Goal

Create a minimal, best-effort Soulseek client specifically for Weekly Flow downloads.

### Prerequisites

- Phase 1 complete and tested
- Soulseek account credentials
- `slsk-client` npm package available

### Tasks

#### 2.1 Install slsk-client Package

**File**: `backend/package.json`

```bash
npm install slsk-client
```

**Verify**: Package supports:

- Connection with username/password
- File search
- File download to disk

#### 2.2 Create Simple Soulseek Client

**File**: `backend/services/simpleSoulseekClient.js`

**Requirements**:

- Minimal implementation (~200-300 lines)
- Methods:
  - `connect()` - Connect to Soulseek (reuse connection)
  - `search(query, options)` - Simple search
  - `downloadTrack(artistName, trackName, destinationPath)` - Download to file
  - `pickBestMatch(results, trackName)` - Simple quality matching

**Features**:

- ✅ Connection management (connect once, reuse)
- ✅ Simple search
- ✅ Basic quality filtering (prefer FLAC, then MP3 320)
- ✅ Direct download to destination
- ❌ No complex retry logic
- ❌ No state machine
- ❌ No progress tracking (fire and forget)
- ❌ Accept failures silently

**Error Handling**:

- Log errors but don't throw (best-effort)
- Return `{ success: false, error: message }` on failure
- Don't block Weekly Flow rotation if download fails

#### 2.3 Add Soulseek Credentials to Settings

**File**: `backend/config/db-helpers.js`

**Settings to add**:

```javascript
integrations: {
  soulseek: {
    username: process.env.SOULSEEK_USERNAME || '',
    password: process.env.SOULSEEK_PASSWORD || '',
    enabled: true,
  }
}
```

**Environment Variables**:

- `SOULSEEK_USERNAME`
- `SOULSEEK_PASSWORD`

**Security**: Store password securely (consider encryption at rest).

#### 2.4 Update downloadManager.downloadWeeklyFlowTrack()

**File**: `backend/services/downloadManager.js`

**Changes**:

- Replace `slskdClient.downloadTrack()` with `simpleSoulseekClient.downloadTrack()`
- Simplify error handling (log and continue)
- Remove complex state tracking
- Direct download to Weekly Flow folder

**Flow**:

1. Search for track
2. Pick best match
3. Download directly to Weekly Flow folder
4. Mark as completed (or failed, but don't retry)
5. Continue with next track

#### 2.5 Remove Weekly Flow from slskd Monitoring

**File**: `backend/services/downloadManager.js`

**Changes**:

- Remove `checkCompletedDownloads()` entirely (or filter out weekly-flow)
- Weekly Flow downloads are fire-and-forget
- No need to monitor slskd for Weekly Flow

#### 2.6 Simplify Weekly Flow Download Tracking

**File**: `backend/services/downloadManager.js` and `downloadQueue.js`

**Changes**:

- Remove complex state machine for Weekly Flow
- Simple status: `requested` → `completed` or `failed`
- No retry logic
- No dead letter queue for Weekly Flow
- Accept failures as normal (tracks rotate weekly anyway)

#### 2.7 Test Weekly Flow Downloads

**Test Cases**:

1. Generate Weekly Flow playlist
2. Verify tracks queued for download
3. Verify simple client connects to Soulseek
4. Verify searches execute
5. Verify downloads complete (or fail gracefully)
6. Verify completed tracks appear in Weekly Flow folder
7. Verify failed downloads don't block rotation

#### 2.8 Make slskd Optional/Deprecated

**File**: Multiple files

**Changes**:

- Mark `slskdClient.js` as deprecated
- Add deprecation warnings
- Keep code for backward compatibility (if needed)
- Update README to reflect new architecture
- Remove slskd from docker-compose (if not needed)

---

## Testing Strategy

### Phase 1 Testing

1. **Unit Tests**: Test Lidarr client methods
2. **Integration Tests**: Test album/track download flow
3. **End-to-End Tests**: Full download cycle from UI to library

### Phase 2 Testing

1. **Unit Tests**: Test simple Soulseek client
2. **Integration Tests**: Test Weekly Flow download flow
3. **Failure Tests**: Verify failures don't break Weekly Flow rotation

---

## Rollback Plan

If issues arise:

### Phase 1 Rollback

- Keep slskd code intact
- Add feature flag to switch between Lidarr and slskd
- Revert downloadManager changes if needed

### Phase 2 Rollback

- Keep slskd for Weekly Flow as fallback
- Add feature flag to switch between simple client and slskd
- Simple client failures fall back to slskd (optional)

---

## Success Criteria

### Phase 1 Complete When:

- ✅ Album downloads work through Lidarr
- ✅ Track downloads work through Lidarr (temporary)
- ✅ Download completion detected automatically
- ✅ Files processed and added to library
- ✅ No regressions in existing functionality

### Phase 2 Complete When:

- ✅ Weekly Flow downloads work through simple client
- ✅ Failures don't break Weekly Flow rotation
- ✅ Simple client is < 300 lines of code
- ✅ slskd can be removed/deprecated
- ✅ Overall system is more reliable

---

## Timeline Estimate

- **Phase 1**: 2-3 days
  - Lidarr client: 4-6 hours
  - Integration: 4-6 hours
  - Testing: 4-6 hours

- **Phase 2**: 1-2 days
  - Simple client: 3-4 hours
  - Integration: 2-3 hours
  - Testing: 2-3 hours

**Total**: 3-5 days

---

## Notes

- Keep existing download queue system (it's good)
- Keep existing state machine (for Lidarr downloads)
- Simplify state machine for Weekly Flow (or remove entirely)
- Consider making slskd optional from the start (feature flag)
