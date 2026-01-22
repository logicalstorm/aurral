# Aurral

<p align="center">
  <img src="frontend/public/arralogo.svg" width="128" height="128" alt="Aurral Logo">
</p>

<p align="center">
  <strong>Streamlined Artist Request Manager for Lidarr</strong>
</p>

---

## What is Aurral?

Aurral is a simple web application that allows users to search for artists using the MusicBrainz database and seamlessly add them to their Lidarr music library. Think of it as an Overseerr or Jellyseerr, but specifically focused on music artists and Lidarr integration.

Aurral makes expanding your music collection effortless.

---

## Features

### Search & Discovery
- **Real-time Search:** Powered by the MusicBrainz API to find any artist in the world.
- **Deep Metadata:** View artist types, countries, active years, genres, and aliases.
- **Artist Details:** Explore full release groups (albums, EPs, singles) before adding them to your library.

### Advanced Recommendation Engine
- **Personalized Discover:** Analyzes your existing Lidarr library to suggest similar artists.
- **Genre Analysis:** Identifies your top genres and tags to help you explore new musical territories.

### Library Management
- **One-Click Requests:** Add artists to Lidarr with a single click.
- **Library Overview:** Browse your entire Lidarr collection in a grid view.
- **Status Tracking:** Visual indicators show what's already in your library and what's currently being requested.

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

Access the UI at `http://localhost:3001`. Configuration is done through the web interface - no environment variables needed!

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

All configuration is done through the web interface at `/settings`. No environment variables are required, but you can optionally set:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |

---

## Discovery Engine

Aurral features a discovery system that helps you find new music based on what you already love.

### How it works:
1. **Library Sampling:** The engine randomly samples artists from your current Lidarr collection.
2. **Tag Analysis:** It queries MusicBrainz to find the specific sub-genres and tags associated with your artists (e.g., "Post-Punk", "Synthpop").
3. **Similarity Search:** It looks for other bands matching those specific tag combinations.

---

## Troubleshooting

- **401 Unauthorized:** Configure your Lidarr API key in the Settings page.
- **Connection Refused:** Ensure Lidarr is reachable from the server running Aurral.
- **Slow Discovery:** The MusicBrainz API is rate-limited to 1 request per second. Aurral respects this limit, so discovery may take 10-20 seconds depending on library size.
- **Missing Images:** Configure a Last.fm API key in Settings for better artist imagery coverage.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
