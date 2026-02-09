# Aurral

<p align="center">
  <img src="frontend/public/arralogo.svg" width="128" height="128" alt="Aurral Logo">
</p>

<p align="center">
  <strong>Streamlined Artist Request Manager for Lidarr</strong>
</p>

---

## Notice: Test branch transition

We’re actively developing a new test branch with a rebuilt app and a single combined container image. It will merge into `main` in the coming weeks.

Please start transitioning to the test-branch `docker-compose` or pin your current deployment to a specific image tag instead of `latest` to avoid breaking changes during the merge.

Test branch details: https://github.com/lklynet/aurral/tree/test

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

The fastest way to get Aurral running is using Docker Compose.

### 1. Setup Environment
```bash
git clone https://github.com/lklynet/aurral.git
cd aurral
cp .env.example .env
```

### 2. Configure
Edit the `.env` file with your Lidarr details:
```env
LIDARR_URL=http://192.168.1.50:8686
LIDARR_API_KEY=your_api_key_here
CONTACT_EMAIL=your@email.com
```

### 3. Launch
```bash
docker-compose up -d
```
This will pull the latest pre-built images from the GitHub Container Registry (GHCR). Access the UI at `http://localhost:3000`.

---

## Installation

### Prerequisites
- **Lidarr:** A running instance with API access.
- **Node.js:** v18 or later (for manual installs).
- **Docker:** Recommended for production.

### Manual Setup (Development)

#### Docker (Recommended for Dev)
If you want to build and run from source:
```bash
docker-compose -f docker-compose.dev.yml up --build
```

#### Local Node.js
```bash
cd backend
npm install
# Create/edit .env with Lidarr credentials
npm start
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Discovery Engine

Aurral features a discovery system that helps you find new music based on what you already love.

### How it works:
1. **Library Sampling:** The engine randomly samples artists from your current Lidarr collection.
2. **Tag Analysis:** It queries MusicBrainz to find the specific sub-genres and tags associated with your artists (e.g., "Post-Punk", "Synthpop").
3. **Similarity Search:** It looks for other bands matching those specific tag combinations.

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LIDARR_URL` | Full URL to your Lidarr instance | `http://localhost:8686` |
| `LIDARR_API_KEY` | Your Lidarr API Key | `REQUIRED` |
| `CONTACT_EMAIL` | Required for MusicBrainz API User-Agent | `REQUIRED` |
| `PORT` | Backend API port | `3001` |
| `LASTFM_API_KEY`| (Optional) For enhanced artist images & discovery | `null` |
| `AUTH_PASSWORD` | (Optional) Password for basic authentication protection. Comma-separated for multiple passwords. | `null` |

---

## Troubleshooting

- **401 Unauthorized:** Check that your `LIDARR_API_KEY` is correct in the `.env` file.
- **Connection Refused:** Ensure the `LIDARR_URL` is reachable from the container/server running Aurral.
- **Slow Discovery:** The MusicBrainz API is rate-limited to 1 request per second. Aurral respects this limit, so discovery may take 10-20 seconds depending on library size.
- **Missing Images:** Provide a `LASTFM_API_KEY` in your configuration for significantly better artist imagery coverage.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
