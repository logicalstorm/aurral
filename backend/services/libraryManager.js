import fs from "fs/promises";
import path from "path";
import { dbOps } from "../config/db-helpers.js";
import { dbHelpers } from "../config/db-sqlite.js";
import { musicbrainzRequest } from "./apiClients.js";

const LIDARR_RETRY_MS = 60000;

let lidarrClient = null;
let _cachedArtists = [];
let _lastLidarrFailureAt = 0;
let _retryTimeoutId = null;

async function getLidarrClient() {
  if (!lidarrClient) {
    try {
      const mod = await import("./lidarrClient.js");
      lidarrClient = mod.lidarrClient;
    } catch (err) {}
  }
  return lidarrClient;
}

function scheduleLidarrRetry(instance) {
  if (_retryTimeoutId) return;
  _retryTimeoutId = setTimeout(() => {
    _retryTimeoutId = null;
    instance.getAllArtists().catch(() => {});
  }, LIDARR_RETRY_MS);
}

export function getCachedArtistCount() {
  return Array.isArray(_cachedArtists) ? _cachedArtists.length : 0;
}

function getSettings() {
  return dbOps.getSettings();
}

export class LibraryManager {
  async addArtist(mbid, artistName, options = {}) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { error: "Lidarr is not configured" };
    }
    try {
      const existing = await lidarr.getArtistByMbid(mbid);
      if (existing) {
        return this.mapLidarrArtist(existing);
      }
      const lidarrSettings = getSettings();
      const lidarrArtist = await lidarr.addArtist(mbid, artistName, {
        monitorOption: "none",
        qualityProfileId: lidarrSettings.integrations?.lidarr?.qualityProfileId,
      });
      console.log(`[LibraryManager] Added artist "${artistName}" to Lidarr`);
      return this.mapLidarrArtist(lidarrArtist);
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to add artist to Lidarr: ${error.message}`,
      );
      return { error: error.message };
    }
  }

  async fetchArtistAlbums(artistId, mbid) {
    try {
      const artistData = await musicbrainzRequest(`/artist/${mbid}`, {
        inc: "release-groups",
      });

      if (artistData["release-groups"]) {
        const releaseGroups = artistData["release-groups"].slice(0, 50);

        for (const rg of releaseGroups) {
          const result = await this.addAlbum(artistId, rg.id, rg.title, {
            releaseDate: rg["first-release-date"] || null,
            triggerSearch: false,
          });
          if (result?.error) {
            console.error(`Failed to add album ${rg.title}:`, result.error);
          }
        }
      }
    } catch (error) {
      console.error(
        `Failed to fetch albums for artist ${mbid}:`,
        error.message,
      );
    }
  }

  async fetchAlbumTracks(albumId, releaseGroupMbid) {
    try {
      const rgData = await musicbrainzRequest(
        `/release-group/${releaseGroupMbid}`,
        {
          inc: "releases",
        },
      );

      if (rgData.releases && rgData.releases.length > 0) {
        const releaseId = rgData.releases[0].id;

        const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
          inc: "recordings",
        });

        let tracksAdded = 0;
        if (releaseData.media && releaseData.media.length > 0) {
          for (const medium of releaseData.media) {
            if (medium.tracks) {
              for (const track of medium.tracks) {
                const recording = track.recording;
                if (recording) {
                  try {
                    await this.addTrack(
                      albumId,
                      recording.id,
                      recording.title,
                      track.position || 0,
                    );
                    tracksAdded++;
                  } catch (err) {
                    if (!err.message.includes("already exists")) {
                      console.error(
                        `Failed to add track ${recording.title}:`,
                        err.message,
                      );
                    }
                  }
                }
              }
            }
          }
        }

        if (tracksAdded > 0) {
          await this.updateAlbumStatistics(albumId);
        }
      }
    } catch (error) {
      console.error(
        `Failed to fetch tracks for album ${releaseGroupMbid}:`,
        error.message,
      );
    }
  }

  async getArtist(mbid) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return null;
    }
    try {
      const lidarrArtist = await lidarr.getArtistByMbid(mbid);
      if (!lidarrArtist) return null;
      return this.mapLidarrArtist(lidarrArtist);
    } catch {
      return null;
    }
  }

  async getArtistById(id) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return null;
    }
    try {
      const lidarrArtist = await lidarr.getArtist(id);
      return this.mapLidarrArtist(lidarrArtist);
    } catch (error) {
      return null;
    }
  }

  async getAllArtists() {
    try {
      const lidarr = await getLidarrClient();
      if (!lidarr || !lidarr.isConfigured()) {
        return _cachedArtists;
      }
      if (_lastLidarrFailureAt && Date.now() - _lastLidarrFailureAt < LIDARR_RETRY_MS) {
        scheduleLidarrRetry(this);
        return _cachedArtists;
      }
      try {
        const lidarrArtists = await lidarr.request("/artist");
        _lastLidarrFailureAt = 0;
        if (!Array.isArray(lidarrArtists)) {
          return _cachedArtists;
        }
        _cachedArtists = lidarrArtists.map((a) => this.mapLidarrArtist(a));
        return _cachedArtists;
      } catch (error) {
        const wasHealthy = _lastLidarrFailureAt === 0;
        _lastLidarrFailureAt = Date.now();
        scheduleLidarrRetry(this);
        if (wasHealthy) {
          const msg = (error && error.message) || String(error);
          console.warn(
            "[LibraryManager] Lidarr unavailable:",
            msg,
            "- using cached artists (if any). Retrying every 60s.",
          );
        }
        return _cachedArtists;
      }
    } catch (_) {
      return _cachedArtists;
    }
  }

  mapLidarrArtist(lidarrArtist) {
    const artistPath = lidarrArtist.path ?? null;
    return {
      id: lidarrArtist.id?.toString() || lidarrArtist.foreignArtistId,
      mbid: lidarrArtist.foreignArtistId,
      foreignArtistId: lidarrArtist.foreignArtistId,
      artistName: lidarrArtist.artistName,
      path: artistPath,
      addedAt: lidarrArtist.added || new Date().toISOString(),
      monitored: lidarrArtist.monitored || false,
      monitorOption:
        lidarrArtist.monitor || lidarrArtist.addOptions?.monitor || "none",
      monitorNewItems: lidarrArtist.monitorNewItems || "none",
      addOptions: {
        monitor:
          lidarrArtist.monitor || lidarrArtist.addOptions?.monitor || "none",
      },
      quality: lidarrArtist.qualityProfile?.name || "standard",
      albumFolders: true,
      statistics: lidarrArtist.statistics || {
        albumCount: 0,
        trackCount: 0,
        sizeOnDisk: 0,
      },
    };
  }

  async updateArtist(mbid, updates) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { error: "Lidarr is not configured" };
    }
    try {
      const lidarrArtist = await lidarr.getArtistByMbid(mbid);
      if (!lidarrArtist) return { error: "Artist not found in Lidarr" };
      if (
        updates.monitored !== undefined ||
        updates.monitorOption !== undefined
      ) {
        const monitorOption =
          updates.monitorOption || lidarrArtist.monitor || "none";
        await lidarr.updateArtistMonitoring(lidarrArtist.id, monitorOption);
        console.log(
          `[LibraryManager] Updated Lidarr monitoring for "${lidarrArtist.artistName}" to "${monitorOption}"`,
        );
        const updated = await lidarr.getArtist(lidarrArtist.id);
        const mapped = this.mapLidarrArtist(updated);
        if (mapped.monitored && mapped.monitorOption !== "none") {
          import("./monitoringService.js")
            .then(({ monitoringService }) => {
              monitoringService.processArtistMonitoring(mapped).catch((err) => {
                console.error(
                  `[LibraryManager] Error triggering monitoring for ${mapped.artistName}:`,
                  err.message,
                );
              });
            })
            .catch(() => {});
        }
        return mapped;
      }
      return this.mapLidarrArtist(lidarrArtist);
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to update artist in Lidarr: ${error.message}`,
      );
      return { error: error.message };
    }
  }

  async deleteArtist(mbid, deleteFiles = false) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { success: false, error: "Lidarr is not configured" };
    }
    try {
      const lidarrArtist = await lidarr.getArtistByMbid(mbid);
      if (!lidarrArtist) return { success: false, error: "Artist not found in Lidarr" };
      await lidarr.deleteArtist(lidarrArtist.id, deleteFiles);
      console.log(
        `[LibraryManager] Deleted artist "${lidarrArtist.artistName}" from Lidarr`,
      );
      return { success: true };
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to delete artist from Lidarr: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  async addAlbum(artistId, releaseGroupMbid, albumName, options = {}) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { error: "Lidarr is not configured" };
    }
    try {
      const lidarrArtist = await lidarr.getArtist(artistId);
      if (!lidarrArtist) return { error: "Artist not found in Lidarr" };
      const existing = await lidarr.getAlbumByMbid(releaseGroupMbid);
      if (existing) {
        return this.mapLidarrAlbum(existing, lidarrArtist);
      }
      const settings = getSettings();
      const searchOnAdd = settings.integrations?.lidarr?.searchOnAdd ?? false;
      const lidarrAlbum = await lidarr.addAlbum(
        artistId,
        releaseGroupMbid,
        albumName,
        {
          monitored: true,
          triggerSearch:
            options.triggerSearch === true ||
            (options.triggerSearch === undefined && searchOnAdd),
        },
      );
      const updatedArtist = await lidarr.getArtist(artistId);
      return this.mapLidarrAlbum(lidarrAlbum, updatedArtist);
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to add album to Lidarr: ${error.message}`,
      );
      return { error: error.message };
    }
  }

  async getAlbums(artistId) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return [];
    }
    try {
      const lidarrArtist = await lidarr.getArtist(artistId);
      if (!lidarrArtist) {
        return [];
      }
      const allAlbums = await lidarr.request("/album");
      const artistAlbums = Array.isArray(allAlbums)
        ? allAlbums.filter((a) => a.artistId === parseInt(artistId))
        : [];
      return artistAlbums.map((a) => this.mapLidarrAlbum(a, lidarrArtist));
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to fetch albums from Lidarr: ${error.message}`,
      );
      return [];
    }
  }

  async getAlbumById(id) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return null;
    }
    if (!id || id === "undefined" || id === "null") {
      return null;
    }
    try {
      const lidarrAlbum = await lidarr.getAlbum(id);
      if (!lidarrAlbum) {
        return null;
      }
      const lidarrArtist = await lidarr.getArtist(lidarrAlbum.artistId);
      return this.mapLidarrAlbum(lidarrAlbum, lidarrArtist);
    } catch (error) {
      if (error.response?.status === 404 || error.message?.includes("404")) {
        return null;
      }
      return null;
    }
  }

  mapLidarrAlbum(lidarrAlbum, lidarrArtist) {
    const albumPath =
      lidarrAlbum.path ??
      (lidarrArtist.path
        ? path.join(lidarrArtist.path, this.sanitizePath(lidarrAlbum.title))
        : null);

    const rawStats = lidarrAlbum.statistics || {};
    let percentOfTracks = rawStats.percentOfTracks;

    if (percentOfTracks !== undefined) {
      if (percentOfTracks > 1 && percentOfTracks <= 100) {
        percentOfTracks = percentOfTracks;
      } else if (percentOfTracks <= 1 && percentOfTracks >= 0) {
        percentOfTracks = Math.round(percentOfTracks * 100);
      } else if (percentOfTracks > 100) {
        percentOfTracks = Math.min(100, Math.round(percentOfTracks / 10));
      }
    }

    return {
      id: lidarrAlbum.id?.toString() || lidarrAlbum.foreignAlbumId,
      artistId: lidarrAlbum.artistId?.toString() || lidarrArtist.id?.toString(),
      artistName: lidarrArtist.name ?? null,
      mbid: lidarrAlbum.foreignAlbumId,
      foreignAlbumId: lidarrAlbum.foreignAlbumId,
      albumName: lidarrAlbum.title,
      path: albumPath,
      addedAt: lidarrAlbum.added || new Date().toISOString(),
      releaseDate: lidarrAlbum.releaseDate || null,
      monitored: lidarrAlbum.monitored || false,
      statistics: {
        trackCount: rawStats.trackCount || 0,
        sizeOnDisk: rawStats.sizeOnDisk || 0,
        percentOfTracks: percentOfTracks || 0,
      },
    };
  }

  async updateAlbum(id, updates) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { error: "Lidarr is not configured" };
    }
    try {
      const lidarrAlbum = await lidarr.getAlbum(id);
      if (!lidarrAlbum) return { error: "Album not found in Lidarr" };
      if (updates.monitored !== undefined) {
        await lidarr.monitorAlbum(id, updates.monitored);
      }
      const updated = await lidarr.getAlbum(id);
      const lidarrArtist = await lidarr.getArtist(updated.artistId);
      return this.mapLidarrAlbum(updated, lidarrArtist);
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to update album in Lidarr: ${error.message}`,
      );
      return { error: error.message };
    }
  }

  async deleteAlbum(id, deleteFiles = false) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return { success: false, error: "Lidarr is not configured" };
    }
    try {
      await lidarr.deleteAlbum(id, deleteFiles);
      return { success: true };
    } catch (error) {
      console.error(
        `[LibraryManager] Failed to delete album from Lidarr: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }

  async addTrack(albumId, trackMbid, trackName, trackNumber, options = {}) {
    const album = await this.getAlbumById(albumId);
    if (!album) {
      throw new Error("Album not found");
    }

    const tracks = await this.getTracks(albumId);
    const existing = tracks.find((t) => t.mbid === trackMbid);
    if (existing) {
      return existing;
    }

    return {
      id: `${albumId}-${trackNumber}`,
      albumId,
      artistId: album.artistId,
      mbid: trackMbid,
      trackName,
      trackNumber,
      path: null,
      quality: options.quality || null,
      size: 0,
      addedAt: new Date().toISOString(),
      hasFile: false,
    };
  }

  async getTracks(albumId) {
    if (!albumId || albumId === "undefined") {
      console.warn(
        "[LibraryManager] getTracks called with invalid albumId:",
        albumId,
      );
      return [];
    }

    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return [];
    }
    try {
      const lidarrAlbum = await lidarr.getAlbum(albumId);
      if (!lidarrAlbum) {
        return [];
      }

      const rawPercent = lidarrAlbum.statistics?.percentOfTracks || 0;
      const albumSizeOnDisk = lidarrAlbum.statistics?.sizeOnDisk || 0;
      let normalizedPercent = rawPercent;

      if (rawPercent > 1 && rawPercent <= 100) {
        normalizedPercent = rawPercent;
      } else if (rawPercent <= 1 && rawPercent >= 0) {
        normalizedPercent = Math.round(rawPercent * 100);
      } else if (rawPercent > 100) {
        normalizedPercent = Math.min(100, Math.round(rawPercent / 10));
      }

      const isAlbumComplete = normalizedPercent >= 100 || albumSizeOnDisk > 0;

      console.log(
        `[LibraryManager] Album ${albumId} - Raw percent: ${rawPercent}, Normalized: ${normalizedPercent}%, Complete: ${isAlbumComplete}`,
      );

      if (
        lidarrAlbum.tracks &&
        Array.isArray(lidarrAlbum.tracks) &&
        lidarrAlbum.tracks.length > 0
      ) {
        console.log(
          `[LibraryManager] Found ${lidarrAlbum.tracks.length} tracks in lidarrAlbum.tracks for album ${albumId}`,
        );
        const mappedTracks = lidarrAlbum.tracks.map((t, index) =>
          this.mapLidarrTrack(t, lidarrAlbum, index + 1, isAlbumComplete),
        );
        console.log(
          `[LibraryManager] Mapped tracks - hasFile counts: ${mappedTracks.filter((t) => t.hasFile).length}/${mappedTracks.length}`,
        );
        return mappedTracks;
      }

      if (lidarrAlbum.albumReleases && lidarrAlbum.albumReleases.length > 0) {
        for (const release of lidarrAlbum.albumReleases) {
          if (
            release.tracks &&
            Array.isArray(release.tracks) &&
            release.tracks.length > 0
          ) {
            console.log(
              `[LibraryManager] Found ${release.tracks.length} tracks in albumReleases for album ${albumId}`,
            );
            const mappedTracks = release.tracks.map((t, index) =>
              this.mapLidarrTrack(t, lidarrAlbum, index + 1, isAlbumComplete),
            );
            console.log(
              `[LibraryManager] Mapped tracks - hasFile counts: ${mappedTracks.filter((t) => t.hasFile).length}/${mappedTracks.length}`,
            );
            return mappedTracks;
          }
        }
      }

      if (
        lidarrAlbum.media &&
        Array.isArray(lidarrAlbum.media) &&
        lidarrAlbum.media.length > 0
      ) {
        const allTracks = [];
        for (const medium of lidarrAlbum.media) {
          if (medium.tracks && Array.isArray(medium.tracks)) {
            allTracks.push(...medium.tracks);
          }
        }
        if (allTracks.length > 0) {
          console.log(
            `[LibraryManager] Found ${allTracks.length} tracks in media for album ${albumId}`,
          );
          const mappedTracks = allTracks.map((t, index) =>
            this.mapLidarrTrack(t, lidarrAlbum, index + 1, isAlbumComplete),
          );
          console.log(
            `[LibraryManager] Mapped tracks - hasFile counts: ${mappedTracks.filter((t) => t.hasFile).length}/${mappedTracks.length}`,
          );
          return mappedTracks;
        }
      }

      console.warn(
        `[LibraryManager] No tracks found in album ${albumId} structure. Available keys: ${Object.keys(lidarrAlbum).join(", ")}`,
      );

      return [];
    } catch (error) {
      if (error.message && error.message.includes("404")) {
        return [];
      }
      console.error(
        `[LibraryManager] Failed to fetch tracks from Lidarr: ${error.message}`,
      );
      return [];
    }
  }

  mapLidarrTrack(
    lidarrTrack,
    lidarrAlbum,
    trackNumber = 0,
    albumIsComplete = false,
  ) {
    const path = lidarrTrack.path || null;
    const size = lidarrTrack.sizeOnDisk || lidarrTrack.size || 0;
    const hasFileExplicit = lidarrTrack.hasFile;
    const hasFileFromPathOrSize = !!(path || size > 0);
    const albumSizeOnDisk = lidarrAlbum.statistics?.sizeOnDisk || 0;

    let hasFile = false;

    if (albumIsComplete || albumSizeOnDisk > 0) {
      hasFile = true;
    } else if (hasFileExplicit === true) {
      hasFile = true;
    } else if (hasFileFromPathOrSize) {
      hasFile = true;
    } else if (hasFileExplicit === false) {
      hasFile = false;
    }

    console.log(
      `[LibraryManager] Track "${lidarrTrack.title || lidarrTrack.trackTitle}" - hasFile: ${hasFile}, albumIsComplete: ${albumIsComplete}, albumSizeOnDisk: ${albumSizeOnDisk}, hasFileExplicit: ${hasFileExplicit}, path: ${!!path}, size: ${size}`,
    );

    return {
      id:
        lidarrTrack.id?.toString() ||
        lidarrTrack.foreignRecordingId ||
        `${lidarrAlbum.id}-${trackNumber}`,
      albumId: lidarrAlbum.id?.toString(),
      artistId:
        lidarrAlbum.artistId?.toString() || lidarrAlbum.artist?.id?.toString(),
      mbid: lidarrTrack.foreignRecordingId || lidarrTrack.foreignTrackId,
      trackName: lidarrTrack.title || lidarrTrack.trackTitle,
      trackNumber: trackNumber || lidarrTrack.trackNumber || 0,
      path: path,
      hasFile: hasFile,
      size: size,
      quality:
        lidarrTrack.mediaInfo?.audioFormat ||
        lidarrTrack.quality?.quality?.name ||
        null,
      addedAt: lidarrTrack.added || new Date().toISOString(),
    };
  }

  async updateTrack(id, updates) {
    const lidarr = await getLidarrClient();
    if (!lidarr || !lidarr.isConfigured()) {
      return null;
    }
    try {
      const lidarrAlbum = await lidarr.getAlbum(id.split("-")[0]);
      if (!lidarrAlbum) return null;
      const tracks = await this.getTracks(lidarrAlbum.id.toString());
      const track = tracks.find((t) => t.id === id);
      if (!track) return null;
      return { ...track, ...updates };
    } catch {
      return null;
    }
  }

  async scanLibrary(discover = false) {
    const { fileScanner } = await import("./fileScanner.js");
    return await fileScanner.scanLibrary(discover);
  }

  async updateAlbumStatistics(albumId) {
    const album = await this.getAlbumById(albumId);
    if (!album) return album;

    return album;
  }

  async updateArtistStatistics(artistId) {
    const artist = await this.getArtistById(artistId);
    if (!artist) return artist;

    return artist;
  }

  sanitizePath(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").trim();
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export const libraryManager = new LibraryManager();
