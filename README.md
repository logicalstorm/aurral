# Aurral (Test Release)

<p align="center">
  <img src="frontend/public/arralogo.svg" width="128" height="128" alt="Aurral Logo">
</p>

This is the **test** branch: one combined image (frontend + backend in one container), so you run a single service and pull one image. The main branch uses separate backend and frontend images.

The app has been rewritten from the ground up. It’s still a self-hosted music discovery and library manager now with a **built-in Soulseek client**, **user accounts**, **notifications**, and **weekly custom playlists** based on your library and listening history. You get **granular control** over what gets added to your library and a more streamlined UI. All configuration is in **Settings** in the web UI.

**Required:** Lidarr, MusicBrainz  
**Highly recommended:** Last.fm (adds better discovery and imagery)  
**Needed for custom playlists:** Navidrome

---

## What’s different from main

- Single combined container (frontend + backend).
- Built-in user accounts and permissions.
- Weekly Flow system with custom playlists.
- Settings moved into the UI instead of a required `.env` workflow.
- More granular add/monitor controls for artists and albums.

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
      - DOWNLOAD_FOLDER=/your/downloads/folder
    volumes:
      - /your/downloads/folder:/app/downloads
      - ./data:/app/backend/data
```

2. Start it:

```bash
docker compose up -d
```

3. Open **http://localhost:3001**, create your admin account, and complete **Onboarding**.

---

## First-run setup (Onboarding)

1. Create your admin account.
2. Connect Lidarr (required).
3. Add your MusicBrainz email (required).
4. Connect Navidrome and Last.fm (optional but recommended).
5. Finish onboarding and sign in.

Everything can be edited later in **Settings**.

---

## Adding artists and albums to Lidarr

### Add an artist

1. Go to **Search** and find an artist.
2. Open the artist page and click **Add to Library**.
3. Use **Change Monitor Option** to choose how Lidarr should monitor that artist:
   - None (Artist only), All, Future, Missing, Latest, or First.

### Add a specific album

1. On the artist page, scroll to the release groups.
2. Click **Add Album** on the release you want.
3. If **Search on Add** is enabled in Settings, Lidarr will immediately search for that album.

---

## Weekly Flow system

Weekly Flow creates custom playlists from your library and listening history.

- Create flows in **Flow** by setting a name, mix (Discover / Mix / Trending), and size.
- Enabling a flow queues tracks and downloads them via the built-in Soulseek client.
- Weekly Flow writes to its own directory and does not touch your main music library:
  - `/app/downloads/aurral-weekly-flow/<flow-id>/<artist>/<album>/<track>`
- Aurral never writes to your root music folder directly. The only way it touches your main library is via Lidarr’s API.
- Each flow refreshes on a weekly schedule; you can toggle or reset it at any time.

---

## Navidrome playlists setup

Weekly Flow can create smart playlists in Navidrome without mixing files into your root music folder.

1. Configure Navidrome in **Settings → Integrations**.
2. Keep `DOWNLOAD_FOLDER` and the host path in the volume mapping the same.
3. Aurral creates a separate Weekly Flow library in Navidrome that points to:
   - `<DOWNLOAD_FOLDER>/aurral-weekly-flow`
4. Smart playlist files (`.nsp`) and downloaded tracks live inside that directory, and Navidrome should pick them up automatically.
5. Set Navidrome’s purge setting so when Weekly Flow replaces tracks, they are removed from the Navidrome library:
   - `ND_SCANNER_PURGEMISSING=always` (or `full`)

Example: `DOWNLOAD_FOLDER=/data/downloads/tmp` with volume `- /data/downloads/tmp:/app/downloads`.

---

## Updating from the original app (main branch)

1. Stop your existing Aurral containers.
2. Start the test image with the new compose file and port (**3001**).
3. Re-enter integrations in Onboarding or Settings (no `.env` migration).
4. Keep a separate `./data` volume for the test build:
   - Settings and users are stored in `/app/backend/data/aurral.db`.

---

## Reverse proxy note

If you run behind a reverse proxy and see `X-Forwarded-For` warnings, set:

```
TRUST_PROXY=true
```

in your container environment.

### Subpath hosting

To host Aurral under a subpath like `https://example.com/aurral`, set `VITE_BASE_PATH` to the subpath and make sure your reverse proxy forwards that path to the container.

Example `docker-compose.yml` addition:

```yaml
services:
  aurral:
    environment:
      - VITE_BASE_PATH=/aurral
```
