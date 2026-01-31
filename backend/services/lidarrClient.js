import axios from "axios";
import https from "https";
import { dbOps } from "../config/db-helpers.js";

const CIRCUIT_COOLDOWN_MS = 60000;

export class LidarrClient {
  constructor() {
    this.config = null;
    this.apiPath = "/api/v1";
    this._circuitOpen = false;
    this._circuitOpenedAt = 0;
    this.updateConfig();
  }

  updateConfig() {
    const settings = dbOps.getSettings();
    const dbConfig = settings.integrations?.lidarr || {};
    let url = dbConfig.url || process.env.LIDARR_URL || "http://localhost:8686";

    url = url.replace(/\/+$/, "");

    const insecure =
      dbConfig.insecure === true ||
      process.env.LIDARR_INSECURE === "true" ||
      process.env.LIDARR_INSECURE === "1";

    const newConfig = {
      url: url,
      apiKey: (dbConfig.apiKey || process.env.LIDARR_API_KEY || "").trim(),
      insecure: !!insecure,
    };

    this.config = newConfig;
  }

  getConfig() {
    this.updateConfig();
    return this.config;
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  getAuthHeaders() {
    if (!this.config.apiKey) {
      return {};
    }
    return {
      "X-Api-Key": this.config.apiKey.trim(),
    };
  }

  async request(
    endpoint,
    method = "GET",
    data = null,
    skipConfigUpdate = false
  ) {
    if (!skipConfigUpdate) {
      this.updateConfig();
    }

    if (!this.isConfigured()) {
      throw new Error("Lidarr API key not configured");
    }

    const now = Date.now();
    if (this._circuitOpen) {
      if (now - this._circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
        throw new Error(
          "Lidarr unavailable (circuit open). Will retry after cooldown."
        );
      }
      this._circuitOpen = false;
    }

    const authHeaders = this.getAuthHeaders();

    try {
      const fullUrl = `${this.config.url}${this.apiPath}${endpoint}`;

      const requestConfig = {
        method,
        url: fullUrl,
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 8000,
        validateStatus: function (status) {
          return status < 500;
        },
      };

      if (
        this.config.insecure &&
        (fullUrl.startsWith("https:") || fullUrl.startsWith("HTTPS:"))
      ) {
        requestConfig.httpsAgent = new https.Agent({
          rejectUnauthorized: false,
        });
      }

      if (data) {
        requestConfig.data = data;
      }

      const response = await axios(requestConfig);

      if (response.status >= 400) {
        throw {
          response: {
            status: response.status,
            statusText: response.statusText,
            data: response.data,
            headers: response.headers,
          },
        };
      }

      return response.data;
    } catch (error) {
      if (
        !error.response &&
        (error.request || error.code === "ECONNABORTED")
      ) {
        this._circuitOpen = true;
        this._circuitOpenedAt = Date.now();
      }

      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const responseData = error.response.data;

        const isAlbum404 = status === 404 && endpoint.includes("/album/");
        if (!isAlbum404) {
          console.error(`Lidarr API error (${status}):`, {
            url: `${this.config.url}${this.apiPath}${endpoint}`,
            method: method,
            status: status,
            statusText: statusText,
            responseData: responseData,
            responseHeaders: error.response.headers,
          });
        }

        let errorMsg = statusText || "Unknown error";
        let errorDetails = "";

        if (typeof responseData === "string") {
          errorMsg = responseData;
          errorDetails = responseData;
        } else if (responseData) {
          errorMsg =
            responseData.message ||
            responseData.error ||
            responseData.title ||
            responseData.detail ||
            (typeof responseData === "object"
              ? JSON.stringify(responseData)
              : String(responseData));
          errorDetails = JSON.stringify(responseData, null, 2);
        }

        if (status === 400) {
          throw new Error(
            `Lidarr API returned 400 Bad Request: ${errorMsg}${
              errorDetails ? `\n\nFull Response: ${errorDetails}` : ""
            }`
          );
        }
        if (status === 401) {
          throw new Error(
            `Lidarr API authentication failed. Check your API key.`
          );
        }
        if (status === 404) {
          const isAlbumEndpoint = endpoint.includes("/album/");
          if (isAlbumEndpoint) {
            return null;
          }
          throw new Error(
            `Lidarr endpoint not found: ${endpoint}. Check if Lidarr is running and the API version is correct.`
          );
        }
        throw new Error(
          `Lidarr API error: ${status} - ${
            responseData?.message ||
            responseData?.error ||
            statusText ||
            "Unknown error"
          }`
        );
      } else if (error.request) {
        console.error(
          "Lidarr API request failed - no response:",
          error.message
        );
        throw new Error(
          `Cannot connect to Lidarr at ${this.config.url}. Check if Lidarr is running and the URL is correct.`
        );
      } else {
        console.error("Lidarr API error:", error.message);
        throw error;
      }
    }
  }

  async testConnection(skipConfigUpdate = false) {
    if (!skipConfigUpdate) {
      this.updateConfig();
    }

    if (!this.isConfigured()) {
      return { connected: false, error: "Lidarr not configured" };
    }

    const apiPaths = ["/api/v1", "/api"];

    for (const apiPath of apiPaths) {
      this.apiPath = apiPath;

      try {
        try {
          const rootFolders = await this.request(
            "/rootFolder",
            "GET",
            null,
            skipConfigUpdate
          );
          return {
            connected: true,
            version: "connected",
            instanceName: "Lidarr",
            rootFoldersCount: Array.isArray(rootFolders)
              ? rootFolders.length
              : 0,
            apiPath: apiPath,
          };
        } catch (rootFolderError) {
          if (
            rootFolderError.message.includes("404") ||
            rootFolderError.message.includes("400")
          ) {
            try {
              const status = await this.request(
                "/system/status",
                "GET",
                null,
                skipConfigUpdate
              );
              return {
                connected: true,
                version: status.version || "unknown",
                instanceName: status.instanceName || "Lidarr",
                apiPath: apiPath,
              };
            } catch (statusError) {
              if (apiPath === "/api/v1" && apiPaths.length > 1) {
                continue;
              }
              throw rootFolderError;
            }
          }
          if (apiPath === "/api/v1" && apiPaths.length > 1) {
            continue;
          }
          throw rootFolderError;
        }
      } catch (error) {
        if (apiPath === apiPaths[apiPaths.length - 1]) {
          const errorMessage = error.message || "Unknown error";
          const errorDetails = error.response?.data
            ? typeof error.response.data === "string"
              ? error.response.data
              : JSON.stringify(error.response.data, null, 2)
            : "";

          const fullUrl = `${this.config.url}${apiPath}/rootFolder`;

          return {
            connected: false,
            error: errorMessage,
            details: errorDetails,
            url: this.config.url,
            fullUrl: fullUrl,
            statusCode: error.response?.status,
            apiPath: apiPath,
            responseHeaders: error.response?.headers,
          };
        }
        continue;
      }
    }

    return {
      connected: false,
      error: "Failed to connect with any API path",
      url: this.config.url,
    };
  }

  async getRootFolders() {
    return this.request("/rootFolder");
  }

  async addArtist(mbid, artistName, options = {}) {
    const rootFolders = await this.getRootFolders();
    if (!rootFolders || rootFolders.length === 0) {
      throw new Error("No root folders configured in Lidarr");
    }

    const rootFolder = rootFolders[0];
    const settings = dbOps.getSettings();

    const monitorOption = options.monitorOption || options.monitor || "none";
    const defaultQualityProfileId =
      settings.integrations?.lidarr?.qualityProfileId;
    const qualityProfileId =
      options.qualityProfileId || defaultQualityProfileId || 1;
    const metadataProfileId = options.metadataProfileId || 1;

    const lidarrArtist = {
      artistName: artistName,
      foreignArtistId: mbid,
      rootFolderPath: rootFolder.path,
      qualityProfileId: qualityProfileId,
      metadataProfileId: metadataProfileId,
      monitored: false,
      monitor: "none",
      monitorNewItems: "none",
      albumsToMonitor: [],
      addOptions: {
        monitor: "none",
        searchForMissingAlbums: false,
      },
    };

    const result = await this.request("/artist", "POST", lidarrArtist);
    return result;
  }

  async getArtist(artistId) {
    return this.request(`/artist/${artistId}`);
  }

  async getArtistByMbid(mbid) {
    const artists = await this.request("/artist");
    return artists.find((a) => a.foreignArtistId === mbid);
  }

  async updateArtist(artistId, updates) {
    const artist = await this.getArtist(artistId);

    const updated = {
      ...artist,
      ...updates,
    };

    return this.request(`/artist/${artistId}`, "PUT", updated);
  }

  async updateArtistMonitoring(artistId, monitorOption) {
    const artist = await this.getArtist(artistId);

    const updated = {
      ...artist,
      monitored: monitorOption !== "none",
      monitor: monitorOption,
      addOptions: {
        ...(artist.addOptions || {}),
        monitor: monitorOption,
      },
    };

    return this.request(`/artist/${artistId}`, "PUT", updated);
  }

  async addAlbum(artistId, albumMbid, albumName, options = {}) {
    const artist = await this.getArtist(artistId);
    if (!artist) {
      throw new Error(`Artist with ID ${artistId} not found in Lidarr`);
    }

    const lidarrAlbum = {
      title: albumName,
      foreignAlbumId: albumMbid,
      artistId: artistId,
      artist: artist,
      monitored: options.monitored !== false,
      anyReleaseOk: true,
      images: [],
    };

    const result = await this.request("/album", "POST", lidarrAlbum);

    if (options.triggerSearch === true) {
      await this.triggerAlbumSearch(result.id);
    }

    return result;
  }

  async getAlbum(albumId) {
    return this.request(`/album/${albumId}`);
  }

  async getAlbumByMbid(albumMbid) {
    const albums = await this.request("/album");
    return albums.find((a) => a.foreignAlbumId === albumMbid);
  }

  async updateAlbum(albumId, updates) {
    const album = await this.getAlbum(albumId);

    const updated = {
      ...album,
      ...updates,
    };

    return this.request(`/album/${albumId}`, "PUT", updated);
  }

  async monitorAlbum(albumId, monitored = true) {
    return this.updateAlbum(albumId, { monitored });
  }

  async triggerAlbumSearch(albumId) {
    return this.request("/command", "POST", {
      name: "AlbumSearch",
      albumIds: [albumId],
    });
  }

  async triggerArtistSearch(artistId) {
    return this.request("/command", "POST", {
      name: "ArtistSearch",
      artistIds: [artistId],
    });
  }

  async getQueue() {
    const response = await this.request("/queue");
    if (response && Array.isArray(response)) {
      return response;
    }
    return response.records || response || [];
  }

  async getQueueItem(queueId) {
    return this.request(`/queue/${queueId}`);
  }

  async getHistory(
    page = 1,
    pageSize = 20,
    sortKey = "date",
    sortDirection = "descending"
  ) {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
      sortKey,
      sortDirection,
    });
    return this.request(`/history?${params.toString()}`);
  }

  async getHistoryForAlbum(albumId) {
    const history = await this.getHistory(1, 100);
    return history.records?.filter((h) => h.albumId === albumId) || [];
  }

  async getHistoryForArtist(artistId) {
    const history = await this.getHistory(1, 100);
    return history.records?.filter((h) => h.artistId === artistId) || [];
  }

  async deleteArtist(artistId, deleteFiles = false) {
    const params = new URLSearchParams();
    if (deleteFiles) {
      params.append("deleteFiles", "true");
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/artist/${artistId}${query}`, "DELETE");
  }

  async deleteAlbum(albumId, deleteFiles = false) {
    const params = new URLSearchParams();
    if (deleteFiles) {
      params.append("deleteFiles", "true");
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/album/${albumId}${query}`, "DELETE");
  }

  async getQualityProfiles(skipConfigUpdate = false) {
    return this.request("/qualityprofile", "GET", null, skipConfigUpdate);
  }

  async getQualityProfile(profileId, skipConfigUpdate = false) {
    return this.request(
      `/qualityprofile/${profileId}`,
      "GET",
      null,
      skipConfigUpdate
    );
  }

  async createQualityProfile(profileData, skipConfigUpdate = false) {
    return this.request(
      "/qualityprofile",
      "POST",
      profileData,
      skipConfigUpdate
    );
  }

  async getCustomFormats(skipConfigUpdate = false) {
    return this.request("/customformat", "GET", null, skipConfigUpdate);
  }

  async createCustomFormat(formatData, skipConfigUpdate = false) {
    return this.request("/customformat", "POST", formatData, skipConfigUpdate);
  }

  async getNamingConfig(skipConfigUpdate = false) {
    return this.request("/config/naming", "GET", null, skipConfigUpdate);
  }

  async updateNamingConfig(configData, skipConfigUpdate = false) {
    return this.request("/config/naming", "PUT", configData, skipConfigUpdate);
  }

  async getQualityDefinitions(skipConfigUpdate = false) {
    return this.request("/qualitydefinition", "GET", null, skipConfigUpdate);
  }

  async updateQualityDefinition(id, data, skipConfigUpdate = false) {
    return this.request(
      `/qualitydefinition/${id}`,
      "PUT",
      data,
      skipConfigUpdate
    );
  }
}

export const lidarrClient = new LidarrClient();
