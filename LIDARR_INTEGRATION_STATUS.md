# Lidarr Integration Status

## ✅ Fully Using Lidarr (Everything Except Weekly Flow)

### Backend Services

#### ✅ **downloadManager.js**

- `downloadAlbum()` - Uses Lidarr to add artists/albums and trigger searches
- `downloadTrack()` - Uses Lidarr (downloads full album, Lidarr limitation)
- `checkLidarrDownloads()` - Monitors Lidarr queue and history every 60 seconds
- `processCompletedLidarrAlbum()` - Processes completed albums from Lidarr
- `startDownloadMonitor()` - Starts Lidarr monitoring interval

#### ✅ **libraryManager.js**

- `addArtist()` - Syncs with Lidarr (adds artist with monitoring 'none')
- `updateArtist()` - Syncs monitoring changes with Lidarr

#### ✅ **lidarrClient.js**

- Full REST API wrapper for Lidarr
- Methods: `addArtist()`, `addAlbum()`, `getQueue()`, `getHistory()`, `updateArtistMonitoring()`, etc.
- Uses quality profile from settings

#### ✅ **monitoringService.js**

- Uses `downloadManager.downloadAlbum()` which routes to Lidarr
- Automatically triggers Lidarr downloads for monitored albums

### Backend Routes

#### ✅ **routes/library.js**

- `/library/downloads` - Returns Lidarr queue + slskd weekly-flow only
- `/library/downloads/status` - Uses download records (updated by Lidarr monitoring)
- Artist/album operations sync with Lidarr

#### ✅ **routes/health.js**

- Shows `lidarrConfigured` status
- Also shows `slskdConfigured` (for weekly flow)

#### ✅ **routes/settings.js**

- `/settings/lidarr/profiles` - Fetches quality profiles from Lidarr
- `/settings/lidarr/test` - Tests Lidarr connection

### Frontend Pages

#### ✅ **SettingsPage.jsx**

- Lidarr connection settings (URL, API key)
- Quality profile selection
- Shows Lidarr connection status in System tab

#### ✅ **LibraryPage.jsx**

- Shows artists from database (synced with Lidarr)
- Download status from download records (updated by Lidarr monitoring)

#### ✅ **ArtistDetailsPage.jsx**

- Shows download status from download records
- Album status from database (updated by Lidarr monitoring)

#### ✅ **DiscoverPage.jsx**

- Shows library status from database
- Download status from download records

### Download Flow

1. **User adds artist** → `libraryManager.addArtist()` → Syncs to Lidarr
2. **User requests album** → `downloadManager.downloadAlbum()` → Adds to Lidarr, triggers search
3. **Monitoring detects new album** → `monitoringService` → `downloadManager.downloadAlbum()` → Lidarr
4. **Lidarr downloads** → `checkLidarrDownloads()` monitors queue/history → Updates database
5. **Frontend polls** → Reads download status from database records

## ⚠️ Still Using slskd (Weekly Flow Only)

### Backend Services

#### ⚠️ **downloadManager.js**

- `downloadWeeklyFlowTrack()` - Still uses slskdClient
- `checkCompletedDownloads()` - Only processes `type === 'weekly-flow'` downloads

#### ⚠️ **slskdClient.js**

- Still used for weekly-flow track downloads
- Will be replaced in Phase 2 with simple Soulseek client

### Backend Routes

#### ⚠️ **routes/library.js**

- `/library/downloads` - Returns slskd downloads filtered to weekly-flow only

## 📋 Summary

### ✅ Using Lidarr:

- ✅ Adding artists
- ✅ Adding albums
- ✅ Monitoring artists/albums
- ✅ Downloading albums
- ✅ Downloading tracks (via full album)
- ✅ Queue status
- ✅ Download status
- ✅ Library sync
- ✅ Quality profile management

### ⚠️ Still Using slskd:

- ⚠️ Weekly Flow track downloads (Phase 2 will replace with simple Soulseek client)

### 🔄 Database Records:

- All download records stored in database
- Updated by `checkLidarrDownloads()` for album/track downloads
- Updated by `checkCompletedDownloads()` for weekly-flow downloads
- Frontend reads from database records (not directly from Lidarr/slskd)

## 🧪 Testing Checklist

- [ ] Add artist → Verify appears in Lidarr
- [ ] Request album → Verify appears in Lidarr queue
- [ ] Check download status → Verify shows from Lidarr queue
- [ ] Monitor artist → Verify new albums trigger Lidarr downloads
- [ ] Complete download → Verify files processed and library updated
- [ ] Settings → Verify Lidarr connection and quality profile selection
- [ ] Health check → Verify shows Lidarr status
