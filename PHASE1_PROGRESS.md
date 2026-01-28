# Phase 1 Implementation Progress

## ✅ Completed Tasks

### 1.1 ✅ Lidarr Client Service Created

**File**: `backend/services/lidarrClient.js`

**Features**:

- Full REST API wrapper for Lidarr
- Methods: `addArtist()`, `addAlbum()`, `getQueue()`, `getHistory()`, `updateArtistMonitoring()`, etc.
- Automatic configuration from settings or environment variables
- Error handling and connection testing

### 1.2 ✅ Configuration Added

- Lidarr client reads from `settings.integrations.lidarr` or `LIDARR_URL`/`LIDARR_API_KEY` env vars
- Uses existing docker-compose environment variables

### 1.3 ✅ downloadAlbum() Updated

**File**: `backend/services/downloadManager.js`

**Changes**:

- Replaced slskd logic with Lidarr integration
- Workflow:
  1. Ensures artist exists in Lidarr (adds with monitoring 'none' if needed)
  2. Adds album to Lidarr
  3. Triggers search in Lidarr
  4. Creates download record for tracking
- Removed ~150 lines of slskd-specific code

### 1.4 ✅ downloadTrack() Updated

**File**: `backend/services/downloadManager.js`

**Changes**:

- Since Lidarr doesn't support individual track downloads, downloads the full album
- Creates track-specific download record linked to album download
- Note: This is temporary - Phase 2 will use simple Soulseek client for tracks

### 1.5 ✅ slskd Monitoring Filtered

**File**: `backend/services/downloadManager.js`

**Changes**:

- `checkCompletedDownloads()` now only processes `type === 'weekly-flow'` downloads
- Album/track downloads are no longer checked via slskd
- Early return if no weekly-flow downloads exist

### 1.6 ✅ Lidarr Monitoring Added

**File**: `backend/services/downloadManager.js`

**New Methods**:

- `checkLidarrDownloads()` - Monitors Lidarr queue and history every 60 seconds
- `processCompletedLidarrAlbum()` - Processes completed albums from Lidarr

**Features**:

- Checks Lidarr queue for active downloads (updates progress)
- Checks Lidarr history for completed downloads
- Matches completed albums to download records
- Processes files using fileScanner
- Updates library automatically

### 1.7 ✅ downloadQueue Routing

- Already routes correctly via `downloadManager.downloadAlbum()` and `downloadManager.downloadTrack()`
- No changes needed - routing is automatic

### Additional Integration

**File**: `backend/services/libraryManager.js`

**Changes**:

- `addArtist()` now syncs with Lidarr (adds artist with monitoring 'none')
- `updateArtist()` now syncs monitoring changes with Lidarr
- Artists stay in sync between Aurral and Lidarr

## 🔄 Remaining Tasks

### 1.8-1.9 Testing (User Action Required)

- Test album downloads through Lidarr
- Test track downloads through Lidarr
- Verify monitoring sync works
- Verify completion detection works

### 1.10 Docker Compose

- Verify Lidarr service is in docker-compose (already has env vars)
- May need to add Lidarr service definition if not present

## 📝 Key Implementation Details

### Artist Workflow

1. User adds artist → Added to Aurral DB with `monitored: false, monitorOption: 'none'`
2. Artist also added to Lidarr with monitoring 'none' (no automatic downloads)
3. User changes monitoring → Updates both Aurral and Lidarr
4. User requests album → Album added to Lidarr, search triggered

### Download Flow

1. User requests album → `downloadManager.downloadAlbum()` called
2. Artist ensured in Lidarr (added if needed)
3. Album added to Lidarr
4. Search triggered in Lidarr
5. Download record created in Aurral DB
6. `checkLidarrDownloads()` monitors queue/history
7. On completion, files processed and library updated

### Monitoring

- **slskd**: Only for weekly-flow downloads (every 30 seconds)
- **Lidarr**: For album/track downloads (every 60 seconds)
- Both run independently

## 🐛 Known Limitations

1. **Track Downloads**: Currently download full album (Lidarr limitation)
   - Phase 2 will use simple Soulseek client for individual tracks
2. **File Path Detection**: Relies on Lidarr's root folder structure
   - Assumes: `rootFolder/Artist Name/Album Name/`
   - May need adjustment based on Lidarr configuration

3. **Progress Tracking**: Uses Lidarr queue sizeleft/size
   - May not be 100% accurate for all download clients

## 🚀 Next Steps

1. **Test Phase 1**:
   - Configure Lidarr URL and API key
   - Test adding an artist
   - Test requesting an album
   - Verify download completes and files are processed

2. **Phase 2**: Build simple Soulseek client for Weekly Flow
   - Install `slsk-client` package
   - Create minimal client
   - Update Weekly Flow downloads

## 📋 Configuration Required

**Environment Variables** (already in docker-compose.dev.yml):

- `LIDARR_URL` (default: `http://lidarr:8686`)
- `LIDARR_API_KEY` (required)

**Settings** (can be set via UI):

- `integrations.lidarr.url`
- `integrations.lidarr.apiKey`
