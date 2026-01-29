# Aurral

<p align="center">
  <img src="frontend/public/arralogo.svg" width="128" height="128" alt="Aurral Logo">
</p>

<p align="center">
  <strong>Self-hosted Music Discovery & Library Manager with SLSKD Integration</strong>
</p>

---

## What is Aurral?

Aurral is a comprehensive music discovery and library management application that integrates directly with [slskd](https://github.com/slskd/slskd) for downloading music from the Soulseek network. Think of it as a complete replacement for Lidarr, designed specifically for Soulseek users who want intelligent music discovery, library management, and automated downloading.

Aurral analyzes your existing music library and Last.fm listening history to provide personalized recommendations, manages your download queue with intelligent retry logic, and organizes your music collection seamlessly.

---

## Features

### Music Discovery
- **Personalized Recommendations:** Analyzes your library and Last.fm scrobbles to suggest new artists
- **Genre Analysis:** Identifies your top genres and tags to explore new musical territories
- **Global Trending:** Discover what's popular on Last.fm
- **Tag-Based Search:** Find artists by specific genres or tags
- **Discovery Preferences:** Exclude genres or artists from recommendations

### Library Management
- **Artist & Album Management:** Add artists to your library and select specific albums to download
- **Automatic Monitoring:** Configure monitoring options (all releases, latest, first, missing, future)
- **File Scanner:** Discover and import your existing music collection
- **Library Integrity:** Verify file integrity, detect duplicates, and find missing tracks
- **Statistics:** Track library size, completion percentage, and file counts

### Download Management
- **SLSKD Integration:** Direct integration with slskd for Soulseek downloads
- **Smart Queue System:** Priority-based queue with configurable concurrent downloads
- **State Machine:** Explicit state transitions (requested → searching → downloading → processing → completed)
- **Robust Error Handling:** Intelligent retry logic with error classification
- **Dead Letter Queue:** Failed downloads are tracked and can be retried later
- **Source Tracking:** Avoids bad peers on retry, tracks download speeds
- **Stalled Detection:** Automatically handles downloads stuck for 30+ minutes
- **Slow Transfer Abort:** Detects and aborts slow transfers to try alternative sources
- **Queue Scheduling:** Schedule downloads for specific times (e.g., night-time only)

### Weekly Flow
- **Discovery Playlist:** 40-track rotating playlist of new music
- **Automatic Rotation:** 10 tracks rotate weekly
- **Navidrome Sync:** Sync playlist to your Navidrome server

### Integrations
- **SLSKD:** Download music from Soulseek
- **MusicBrainz:** Artist and album metadata
- **Last.fm:** Scrobble history, recommendations, artist images
- **Deezer:** Artist images and 30s previews (no API key required)
- **Navidrome/Subsonic:** Playlist sync

### Technical Features
- **WebSocket Support:** Real-time UI updates without polling
- **Structured Logging:** Configurable log levels per category
- **Metrics & Health:** Download success rates, queue health, system status
- **Queue Export/Import:** Backup and restore queue state
- **File Integrity Checks:** Hash verification, duplicate detection

---

## Screenshots

### Desktop Experience
<p align="center">
  <img src="frontend/images/desktop-discovery.webp" width="800" alt="Desktop Discovery View">
</p>
<p align="center">
  <img src="frontend/images/desktop-library.webp" width="395" alt="Desktop Library View">
  <img src="frontend/images/desktop-artist.webp" width="395" alt="Desktop Artist Details">
</p>

### Mobile Experience
<p align="center">
  <img src="frontend/images/mobile-discovery.webp" width="190" alt="Mobile Discovery">
  <img src="frontend/images/mobile-discovery2.webp" width="190" alt="Mobile Discovery Alternate">
  <img src="frontend/images/mobile-search.webp" width="190" alt="Mobile Search">
  <img src="frontend/images/mobile-library.webp" width="190" alt="Mobile Library">
</p>

---

## Quick Start

### Docker Compose (Recommended)

```bash
git clone https://github.com/lklynet/aurral.git
cd aurral
docker-compose up -d
```

Access the UI at `http://localhost:3001`. Configuration is done through the web interface.

### Manual Installation

```bash
git clone https://github.com/lklynet/aurral.git
cd aurral
npm run install:all
npm run build
npm start
```

Access at `http://localhost:3001`.

---

## Configuration

All configuration is done through the web interface at `/settings`. 

### Required Setup
1. **SLSKD:** Configure your slskd URL and API key
2. **MusicBrainz:** Set your contact email (required for API access)

### Optional Integrations
- **Last.fm:** API key and username for personalized recommendations
- **Navidrome:** URL and credentials for playlist sync

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `MUSIC_ROOT` | Music library root path | `/data` |
| `SLSKD_COMPLETE_DIR` | slskd complete downloads directory | `/downloads` |

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│   SLSKD     │
│  (React)    │     │  (Express)  │     │ (Soulseek)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                          │
      ┌───────────────────┼───────────────────┐
      │                   │                   │
      ▼                   ▼                   ▼
┌───────────┐     ┌───────────┐     ┌───────────┐
│  SQLite   │     │ MusicBrainz│    │  Last.fm  │
│    DB     │     │    API     │     │   API     │
└───────────┘     └───────────┘     └───────────┘
```

### Key Services

- **Download Queue:** Manages all downloads with priority, retry logic, and scheduling
- **Download Manager:** Orchestrates album/track downloads with SLSKD
- **Library Manager:** Artist/album/track CRUD with file system integration
- **Discovery Service:** Generates recommendations from library and Last.fm
- **Source Manager:** Tracks peer quality and manages alternative sources
- **File Integrity Service:** Verifies files, detects duplicates, finds missing tracks

---

## API Endpoints

### Downloads
- `GET /api/downloads` - List all downloads
- `GET /api/downloads/queue` - Queue status
- `GET /api/downloads/health/metrics` - Health metrics
- `GET /api/downloads/dlq` - Dead letter queue
- `POST /api/downloads/dlq/:id/retry` - Retry from DLQ
- `GET /api/downloads/queue/schedule` - Get schedule
- `POST /api/downloads/queue/schedule` - Set schedule

### Library
- `GET /api/library/artists` - List artists
- `POST /api/library/downloads/album` - Queue album download
- `GET /api/library/integrity/missing/:artistId` - Find missing tracks
- `POST /api/library/integrity/albums/:albumId/requeue-missing` - Requeue missing

### Discovery
- `GET /api/discover` - Get recommendations
- `GET /api/discover/filtered` - Get filtered recommendations
- `GET /api/discover/preferences` - Get preferences
- `POST /api/discover/preferences` - Set preferences

### WebSocket
- `ws://localhost:3001/ws` - Real-time updates
  - Channels: `downloads`, `queue`, `library`, `discovery`, `notifications`

---

## Troubleshooting

- **SLSKD Connection Failed:** Verify slskd is running and API key is correct
- **No Recommendations:** Configure Last.fm API key and username, or add artists to library
- **Downloads Stuck:** Check slskd connectivity, view dead letter queue for failed items
- **Missing Files:** Use integrity check to find and requeue missing tracks

---

## Development

```bash
npm run install:all
npm run dev
```

Backend runs on port 3001; frontend Vite dev server runs on port 3000 with API proxy. Or use `docker-compose -f docker-compose.dev.yml up` for containerized dev.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

## Credits

- [MusicBrainz](https://musicbrainz.org/) for artist and album metadata
- [Last.fm](https://www.last.fm/) for recommendations and scrobble data
- [slskd](https://github.com/slskd/slskd) for Soulseek integration
