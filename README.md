# Aurral (Test Release)

<p align="center">
  <img src="frontend/public/arralogo.svg" width="128" height="128" alt="Aurral Logo">
</p>

This is the **test** branch: one combined image (frontend + backend in one container), so you run a single service and pull one image. The main branch uses separate backend and frontend images.

The app has been basically rewritten from the ground up. It’s still a self-hosted music discovery and library manager now with a **built-in custom Soulseek client**, **user accounts**, **notifications**, and **weekly custom playlists** based on your library and listening history. You get **granular control** over what gets added to your library. There are **lots of optimizations** and **a better UI**. All configuration is in **Settings** in the web UI.

**Required:** Lidarr, MusicBrainz  
**Highly recommended:** Last.fm (adds a lot of functionality)  
**Needed for custom playlists:** Navidrome

---

## Deploy and run

1. Create a directory and add a `docker-compose.yml`:

```yaml
services:
  aurral:
    image: ghcr.io/lklynet/aurral:test
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - DOWNLOAD_FOLDER=/data/downloads/tmp
    volumes:
      - /data/downloads/tmp:/app/downloads
      - ./data:/app/backend/data
```

For Weekly Flow custom playlists, keep `DOWNLOAD_FOLDER` and the host path in the volume (e.g. `/data/downloads/tmp`) the same, and use a path Navidrome can see.

2. Start it:

```bash
docker compose up -d
```

3. Open **http://localhost:3001**, create a user account, and configure everything in **Onboarding**.

---

## Configuration

All variables and integrations are managed in the app under **Settings**. Set up Lidarr and MusicBrainz (required), then Last.fm (recommended) and Navidrome (needed for weekly custom playlists).

**Weekly Flow custom playlists:** If you use Navidrome with custom playlists, `DOWNLOAD_FOLDER` must be the **same path** as the host side of the downloads volume mapping, and that path must be one **Navidrome can see**. Example: `DOWNLOAD_FOLDER=/data/downloads/tmp` with volume `- /data/downloads/tmp:/app/downloads`—use one host path for both, and ensure Navidrome has access to that path.
