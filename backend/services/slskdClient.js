import axios from "axios";
import { db } from "../config/db.js";

export class SlskdClient {
  constructor() {
    this.config = null;
    this.apiBasePath = null; // Will be detected on first use
    this.apiVersion = null; // Cache detected API version
    this.downloadDirectory = null; // Cache download directory
    this.lastConfigHash = null; // Track config changes
    this.authMethod = null; // Cache detected auth method: 'X-API-Key' or 'Bearer'
    this.updateConfig();
  }

  updateConfig() {
    const dbConfig = db.data?.settings?.integrations?.slskd || {};
    const newConfig = {
      url: (
        dbConfig.url ||
        process.env.SLSKD_URL ||
        "http://localhost:5000"
      ).replace(/\/+$/, ""),
      apiKey: dbConfig.apiKey || process.env.SLSKD_API_KEY || "",
    };
    
    // Create a hash to detect config changes
    const configHash = `${newConfig.url}:${newConfig.apiKey}`;
    
    // Only reset cached values if config actually changed
    if (this.lastConfigHash !== configHash) {
      this.apiBasePath = null;
      this.apiVersion = null;
      this.downloadDirectory = null;
      this.authMethod = null; // Reset auth method when config changes
      this.lastConfigHash = configHash;
    }
    
    this.config = newConfig;
  }

  // Get authentication headers based on detected method
  getAuthHeaders() {
    if (!this.config.apiKey) {
      return {};
    }

    // If we've detected the auth method, use it
    if (this.authMethod === 'Bearer') {
      return {
        'Authorization': `Bearer ${this.config.apiKey}`,
      };
    } else if (this.authMethod === 'X-API-Key') {
      return {
        'X-API-Key': this.config.apiKey,
      };
    }

    // Default to X-API-Key (will auto-detect if it fails)
    return {
      'X-API-Key': this.config.apiKey,
    };
  }

  // Detect authentication method by trying both
  async detectAuthMethod(basePath) {
    if (this.authMethod) {
      return this.authMethod;
    }

    // Try X-API-Key first (most common)
    try {
      const config = {
        method: 'GET',
        url: `${this.config.url}${basePath}/application`,
        headers: {
          'X-API-Key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      };

      const response = await axios(config);
      this.authMethod = 'X-API-Key';
      console.log(`✓ Detected slskd auth method: X-API-Key`);
      return this.authMethod;
    } catch (error) {
      // If 401 and Bearer in www-authenticate, try Bearer token
      if (error.response?.status === 401 && 
          error.response?.headers['www-authenticate']?.includes('Bearer')) {
        try {
          const config = {
            method: 'GET',
            url: `${this.config.url}${basePath}/application`,
            headers: {
              'Authorization': `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 5000,
          };

          const response = await axios(config);
          this.authMethod = 'Bearer';
          console.log(`✓ Detected slskd auth method: Bearer token`);
          return this.authMethod;
        } catch (bearerError) {
          // Both failed, default to X-API-Key
          console.warn(`Could not detect auth method, defaulting to X-API-Key`);
          this.authMethod = 'X-API-Key';
          return this.authMethod;
        }
      }
    }

    // Default to X-API-Key
    this.authMethod = 'X-API-Key';
    return this.authMethod;
  }

  getConfig() {
    this.updateConfig();
    return this.config;
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  async request(endpoint, method = "GET", data = null) {
    if (!this.isConfigured()) {
      throw new Error("slskd API key not configured");
    }

    const basePath = await this.detectApiBasePath();
    await this.detectAuthMethod(basePath);
    const authHeaders = this.getAuthHeaders();

    try {
      const config = {
        method,
        url: `${this.config.url}${basePath}${endpoint}`,
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.response) {
        console.error(
          `slskd API error (${error.response.status}):`,
          error.response.data || error.response.statusText,
        );
        if (error.response.status === 404) {
          throw new Error(
            `slskd endpoint not found: ${endpoint}. Check if slskd is running and the API version is correct.`,
          );
        }
        throw new Error(
          `slskd API error: ${error.response.status} - ${error.response.data?.message || error.response.statusText || "Unknown error"}`,
        );
      } else if (error.request) {
        console.error("slskd API request failed - no response:", error.message);
        throw new Error(
          `Cannot connect to slskd at ${this.config.url}. Check if slskd is running.`,
        );
      } else {
        console.error("slskd API error:", error.message);
        throw error;
      }
    }
  }

  // Test API connectivity and detect API version
  async testConnection() {
    if (!this.isConfigured()) {
      return { connected: false, error: "slskd not configured" };
    }

    // Return cached result if available and config hasn't changed
    if (this.apiBasePath && this.apiVersion && this.authMethod) {
      return {
        connected: true,
        version: this.apiVersion,
        basePath: this.apiBasePath,
        authMethod: this.authMethod,
      };
    }

    const testEndpoints = [
      { path: "/api/v2/application", version: "v2", base: "/api/v2" },
      { path: "/api/v1/application", version: "v1", base: "/api/v1" },
      { path: "/api/v0/application", version: "v0", base: "/api/v0" },
      { path: "/api/application", version: "non-versioned", base: "/api" },
    ];

    // Try both auth methods
    const authMethods = [
      { name: 'X-API-Key', header: { 'X-API-Key': this.config.apiKey } },
      { name: 'Bearer', header: { 'Authorization': `Bearer ${this.config.apiKey}` } },
    ];

    for (const test of testEndpoints) {
      for (const auth of authMethods) {
        try {
          const config = {
            method: "GET",
            url: `${this.config.url}${test.path}`,
            headers: {
              ...auth.header,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          };

          const response = await axios(config);
          console.log(`✓ slskd API detected: ${test.version} (${test.path}) with ${auth.name} auth`);
          
          // Cache the detected version and auth method
          this.apiVersion = test.version;
          this.apiBasePath = test.base;
          this.authMethod = auth.name;
          
          // Try to get version info from application endpoint
          let versionInfo = null;
          if (response.data && response.data.version) {
            versionInfo = response.data.version;
          }
          
          return {
            connected: true,
            version: test.version,
            basePath: test.base,
            authMethod: auth.name,
            slskdVersion: versionInfo,
          };
        } catch (error) {
          if (error.response?.status === 401) {
            // Wrong auth method, try next one
            continue;
          } else if (error.response?.status !== 404) {
            // If it's not a 404 or 401, we might have connected but got a different error
            // Cache it anyway since the endpoint exists
            this.apiVersion = test.version;
            this.apiBasePath = test.base;
            this.authMethod = auth.name;
            
            console.log(
              `✓ slskd API detected: ${test.version} (${test.path}) with ${auth.name} - status ${error.response?.status}`,
            );
            return {
              connected: true,
              version: test.version,
              basePath: test.base,
              authMethod: auth.name,
            };
          }
        }
      }
    }

    return { connected: false, error: "Could not detect slskd API version or authentication method" };
  }

  async detectApiBasePath() {
    // Return cached path if available
    if (this.apiBasePath) {
      // Ensure auth method is detected
      if (!this.authMethod) {
        await this.detectAuthMethod(this.apiBasePath);
      }
      return this.apiBasePath;
    }

    // Try testConnection first (it caches the result)
    const connectionTest = await this.testConnection();
    if (connectionTest.connected && connectionTest.basePath) {
      this.apiBasePath = connectionTest.basePath;
      this.apiVersion = connectionTest.version;
      this.authMethod = connectionTest.authMethod || this.authMethod;
      return this.apiBasePath;
    }

    console.log(
      `Attempting to detect slskd API base path for ${this.config.url}...`,
    );

    // Try to detect the API base path by testing various endpoints
    const testEndpoints = [
      { path: "/api/v2/application", base: "/api/v2", version: "v2" },
      { path: "/api/v1/application", base: "/api/v1", version: "v1" },
      { path: "/api/v0/application", base: "/api/v0", version: "v0" },
      { path: "/api/application", base: "/api", version: "non-versioned" },
      { path: "/api/v2/state", base: "/api/v2", version: "v2" },
      { path: "/api/v1/state", base: "/api/v1", version: "v1" },
      { path: "/api/v0/state", base: "/api/v0", version: "v0" },
      { path: "/api/state", base: "/api", version: "non-versioned" },
    ];

    // Try both auth methods for each endpoint
    const authMethods = [
      { name: 'X-API-Key', header: { 'X-API-Key': this.config.apiKey } },
      { name: 'Bearer', header: { 'Authorization': `Bearer ${this.config.apiKey}` } },
    ];

    for (const test of testEndpoints) {
      for (const auth of authMethods) {
        try {
          const config = {
            method: "GET",
            url: `${this.config.url}${test.path}`,
            headers: {
              ...auth.header,
              "Content-Type": "application/json",
            },
            timeout: 5000,
          };

          const response = await axios(config);
          this.apiBasePath = test.base;
          this.apiVersion = test.version;
          this.authMethod = auth.name;
          console.log(
            `✓ Detected slskd API base path: ${this.apiBasePath} (${test.version}) with ${auth.name} auth`,
          );
          return this.apiBasePath;
        } catch (error) {
          if (error.response) {
            // If we got a response (even if error), this might be the right base path
            // 401 means wrong auth method, try next
            if (error.response.status === 401) {
              continue; // Try next auth method
            }
            // 403/400 means endpoint exists but auth failed or bad request
            if (error.response.status !== 404) {
              this.apiBasePath = test.base;
              this.apiVersion = test.version;
              this.authMethod = auth.name;
              console.log(
                `✓ Detected slskd API base path: ${this.apiBasePath} (${test.version}) with ${auth.name} - status ${error.response.status}`,
              );
              return this.apiBasePath;
            }
          } else if (
            error.code === "ECONNREFUSED" ||
            error.code === "ETIMEDOUT"
          ) {
            // Connection issues - can't determine API version
            console.error(
              `✗ Cannot connect to slskd at ${this.config.url}: ${error.message}`,
            );
            throw new Error(
              `Cannot connect to slskd at ${this.config.url}. Check if slskd is running and the URL is correct.`,
            );
          }
        }
      }
    }

    // Default to /api/v1 if we can't detect
    console.warn("⚠ Could not detect slskd API version, defaulting to /api/v1");
    console.warn("  Please verify your slskd URL and API key are correct.");
    console.warn(`  Current URL: ${this.config.url}`);
    console.warn(`  API Key configured: ${this.config.apiKey ? "Yes" : "No"}`);
    this.apiBasePath = "/api/v1";
    this.apiVersion = "v1";
    return this.apiBasePath;
  }

  async search(query, options = {}) {
    // Detect API base path if not already known
    const basePath = await this.detectApiBasePath();

    // API v0 uses different field names than v1/v2
    let searchData;
    if (basePath === "/api/v0") {
      // API v0 expects SearchText (capital S and T)
      searchData = {
        SearchText: query,
        FileType: options.fileType || "Audio",
        MaxResults: options.maxResults || 100,
      };
    } else {
      // v1/v2 use lowercase field names
      searchData = {
        query,
        fileType: options.fileType || "Audio",
        maxResults: options.maxResults || 100,
      };
    }

    const fullUrl = `${this.config.url}${basePath}/searches`;
    console.log(`Attempting slskd search at: ${fullUrl}`);
    console.log(`Search data:`, JSON.stringify(searchData, null, 2));

    // Ensure auth method is detected
    await this.detectAuthMethod(basePath);
    const authHeaders = this.getAuthHeaders();

    try {
      const config = {
        method: "POST",
        url: fullUrl,
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        data: searchData,
        timeout: 30000,
      };

      const response = await axios(config);
      const searchResult = response.data;
      
      console.log(
        `✓ slskd search for "${query}" succeeded using ${basePath}/searches:`,
        {
          id: searchResult.id,
          state: searchResult.state,
          responseCount: searchResult.responseCount,
          fileCount: searchResult.fileCount,
          isComplete: searchResult.isComplete,
          hasResponses: !!(searchResult.responses),
          responsesLength: Array.isArray(searchResult.responses) ? searchResult.responses.length : 'N/A',
          keys: Object.keys(searchResult || {}),
        },
      );
      
      // For API v0, if includeResponses was used in the initial request, responses might already be there
      // But typically they're empty until we poll and then fetch with includeResponses=true
      return searchResult;
    } catch (error) {
      console.error(
        `✗ slskd search failed for query "${query}" using ${basePath}/searches`,
      );
      if (error.response) {
        console.error(`  Response status: ${error.response.status}`);
        console.error(
          `  Response data:`,
          JSON.stringify(error.response.data, null, 2),
        );
        console.error(`  Response headers:`, error.response.headers);

        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `slskd authentication failed. Check your API key. Status: ${error.response.status}`,
          );
        } else if (error.response.status === 404) {
          throw new Error(
            `slskd endpoint not found: ${fullUrl}. The API structure may be different. Please check your slskd version and API documentation.`,
          );
        } else if (error.response.status === 400) {
          throw new Error(
            `slskd API error: ${error.response.data || "Bad request"}. Check the request format.`,
          );
        }
      } else if (error.request) {
        console.error(`  No response received. Request config:`, {
          url: fullUrl,
          method: "POST",
          hasApiKey: !!this.config.apiKey,
        });
        throw new Error(
          `Cannot connect to slskd at ${this.config.url}. Check if slskd is running and the URL is correct.`,
        );
      } else {
        console.error(`  Request setup error:`, error.message);
      }
      throw error;
    }
  }

  async downloadFile(username, filename, size) {
    if (!username || !filename) {
      throw new Error("Username and filename are required for download");
    }

    // Use detected API base path
    const basePath = await this.detectApiBasePath();
    const apiVersion = this.apiVersion || "v1";

    // Build download request based on API version
    let endpoint;
    let downloadData;
    
    if (apiVersion === "v0" || basePath === "/api/v0") {
      // API v0: POST /transfers/downloads/{username} with array of SearchFile objects
      const encodedUsername = encodeURIComponent(username);
      endpoint = `/transfers/downloads/${encodedUsername}`;
      
      // SearchFile object structure for v0
      downloadData = [
        {
          filename: filename,
          size: size || 0,
        },
      ];
    } else {
      // API v1/v2: POST /downloads with object
      endpoint = "/downloads";
      downloadData = {
        username: username,
        filename: filename,
        size: size || 0,
      };
    }

    const fullUrl = `${this.config.url}${basePath}${endpoint}`;
    console.log(`Initiating download: ${filename} from ${username} via ${fullUrl}`);

    // Ensure auth method is detected
    await this.detectAuthMethod(basePath);
    const authHeaders = this.getAuthHeaders();

    try {
      const config = {
        method: "POST",
        url: fullUrl,
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        data: downloadData,
        timeout: 30000,
      };

      const response = await axios(config);
      
      // Handle different response formats
      const responseData = response.data;
      
      // API v0 returns: { enqueued: [{ id, ... }], failed: [] }
      if (responseData && responseData.enqueued && Array.isArray(responseData.enqueued)) {
        if (responseData.enqueued.length === 0) {
          throw new Error("Download was not enqueued. Check if file is available from user.");
        }
        
        const downloadObj = responseData.enqueued[0];
        console.log(`✓ Download enqueued: ID ${downloadObj.id}, ${filename} from ${username}`);
        
        return {
          id: downloadObj.id,
          username: username,
          filename: filename,
          size: size,
          ...downloadObj,
        };
      }
      
      // API v1/v2 might return the download object directly
      if (responseData && responseData.id) {
        console.log(`✓ Download initiated: ID ${responseData.id}, ${filename} from ${username}`);
        return {
          id: responseData.id,
          username: username,
          filename: filename,
          size: size,
          ...responseData,
        };
      }
      
      // Fallback: return response as-is
      console.log(`✓ Download initiated: ${filename} from ${username}`);
      return {
        username: username,
        filename: filename,
        size: size,
        ...responseData,
      };
    } catch (error) {
      // Enhanced error handling
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;
        
        console.error(`Download failed (${status}):`, {
          endpoint: fullUrl,
          username: username,
          filename: filename,
          error: errorData,
        });
        
        if (status === 401 || status === 403) {
          throw new Error(`slskd authentication failed. Check your API key.`);
        } else if (status === 404) {
          throw new Error(`Download endpoint not found. Check slskd API version compatibility.`);
        } else if (status === 400) {
          const errorMsg = errorData?.message || errorData || "Bad request";
          throw new Error(`Invalid download request: ${errorMsg}`);
        } else if (status === 409) {
          throw new Error(`Download conflict: File may already be downloading or queued.`);
        } else {
          throw new Error(
            `slskd API error (${status}): ${errorData?.message || JSON.stringify(errorData) || "Unknown error"}`
          );
        }
      } else if (error.request) {
        throw new Error(
          `Cannot connect to slskd at ${this.config.url}. Check if slskd is running and the URL is correct.`
        );
      } else {
        throw new Error(`Download request failed: ${error.message}`);
      }
    }
  }

  async getDownloadDirectory() {
    // Return cached directory if available
    if (this.downloadDirectory) {
      return this.downloadDirectory;
    }

    // Try to get download directory from slskd application/state endpoint
    const basePath = await this.detectApiBasePath();
    
    const endpoints = [
      `${basePath}/application`,
      `${basePath}/state`,
      `${basePath}/settings`,
      `${basePath}/configuration`,
    ];
    
    // Ensure auth method is detected
    await this.detectAuthMethod(basePath);
    const authHeaders = this.getAuthHeaders();

    for (const endpoint of endpoints) {
      try {
        const config = {
          method: "GET",
          url: `${this.config.url}${endpoint}`,
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        };
        
        const response = await axios(config);
        const data = response.data;
        
        // Try various possible field names for download directory
        // slskd may store it in different locations depending on version
        const downloadDir = 
          data.downloadDirectory ||
          data.downloadsDirectory ||
          data.downloads?.directory ||
          data.downloads?.path ||
          data.settings?.downloads?.directory ||
          data.settings?.downloads?.path ||
          data.settings?.downloadDirectory ||
          data.config?.downloads?.directory ||
          data.config?.downloads?.path ||
          data.config?.downloadDirectory ||
          data.options?.downloads?.directory ||
          data.options?.downloads?.path;
        
        if (downloadDir) {
          this.downloadDirectory = downloadDir;
          console.log(`✓ Found slskd download directory: ${downloadDir}`);
          return downloadDir;
        }
      } catch (error) {
        // Continue to next endpoint
        if (error.response?.status !== 404) {
          console.warn(`Error fetching ${endpoint}:`, error.message);
        }
      }
    }
    
    // If not found in API, return null (caller should use fallback)
    console.warn('Could not determine slskd download directory from API');
    return null;
  }

  async getDownloads() {
    // Use detected API base path
    const basePath = await this.detectApiBasePath();
    const apiVersion = this.apiVersion || "v1";

    // Try primary endpoint first
    const primaryEndpoints = [
      `${basePath}/downloads`,
      `${basePath}/transfers/downloads`,
      `${basePath}/transfers`,
    ];

    // Ensure auth method is detected
    await this.detectAuthMethod(basePath);
    const authHeaders = this.getAuthHeaders();

    for (const endpoint of primaryEndpoints) {
      try {
        const config = {
          method: "GET",
          url: `${this.config.url}${endpoint}`,
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        };

        const response = await axios(config);
        const data = response.data;
        
        // Helper function to flatten nested download structure
        const flattenDownloads = (data) => {
          if (Array.isArray(data)) {
            // Check if it's an array of user objects with nested directories/files
            if (data.length > 0 && data[0] && typeof data[0] === 'object' && data[0].directories) {
              // Flatten: extract files from directories
              const flattened = [];
              for (const userObj of data) {
                if (userObj.directories && Array.isArray(userObj.directories)) {
                  for (const dir of userObj.directories) {
                    if (dir.files && Array.isArray(dir.files)) {
                      flattened.push(...dir.files);
                    }
                  }
                }
              }
              return flattened.length > 0 ? flattened : data;
            }
            return data;
          } else if (data && typeof data === 'object') {
            // Check if it's a single user object with directories
            if (data.directories && Array.isArray(data.directories)) {
              const flattened = [];
              for (const dir of data.directories) {
                if (dir.files && Array.isArray(dir.files)) {
                  flattened.push(...dir.files);
                }
              }
              if (flattened.length > 0) {
                return flattened;
              }
            }
            // Check if it's wrapped in a downloads/items/data property
            if (Array.isArray(data.downloads)) {
              return flattenDownloads(data.downloads);
            } else if (Array.isArray(data.items)) {
              return flattenDownloads(data.items);
            } else if (Array.isArray(data.data)) {
              return flattenDownloads(data.data);
            }
            return data;
          }
          return data;
        };
        
        // Flatten the response data
        const flattened = flattenDownloads(data);
        
        // Log if we flattened anything (for debugging)
        if (flattened !== data && Array.isArray(flattened)) {
          console.log(`Flattened ${flattened.length} downloads from nested structure`);
        }
        
        return flattened;
      } catch (error) {
        if (error.response?.status === 404) {
          // Try next endpoint
          continue;
        } else if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error(`slskd authentication failed. Check your API key.`);
        } else if (error.response) {
          // Other HTTP error - log and try next endpoint
          console.warn(`Error fetching ${endpoint}: ${error.response.status}`);
          continue;
        } else {
          // Network error
          throw new Error(`Cannot connect to slskd: ${error.message}`);
        }
      }
    }

    // If all endpoints failed, return empty array
    console.warn(
      `slskd downloads endpoint not found. Tried: ${primaryEndpoints.join(", ")}. Returning empty array.`,
    );
    return [];
  }

  async getDownload(id) {
    return this.request(`/downloads/${id}`);
  }

  async cancelDownload(id) {
    return this.request(`/downloads/${id}`, "DELETE");
  }

  async searchAndDownload(query, options = {}) {
    // If excludeUsernames is provided, we'll filter out files from those users
    const excludeUsernames = options.excludeUsernames || [];
    try {
      // Search for files
      let searchResult = await this.search(query, options);

      // API v0 returns a search object with async results - may need to poll
      const basePath = await this.detectApiBasePath();
      
      // Check if responses are already in the initial search result (some API versions include them)
      if (searchResult.responses && Array.isArray(searchResult.responses) && searchResult.responses.length > 0) {
        console.log(`✓ Search result already contains ${searchResult.responses.length} responses, using them directly`);
      } else if (
        basePath === "/api/v0" &&
        searchResult.id &&
        !searchResult.isComplete
      ) {
        // Poll for search results if not complete
        // Soulseek searches can take 10-30 seconds to gather results from the network
        console.log(
          `Search ${searchResult.id} is not complete, polling for results...`,
        );
        // Tubifarry waits up to timeout (default 30s) with quadratic delay
        // They also give it 20s grace period after timeout before giving up
        const maxAttempts = 60; // 60 seconds total (more time for responses to populate)
        let pollInterval = 1000; // Start with 1 second

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // Use quadratic delay like Tubifarry (starts fast, slows down)
          if (attempt > 0) {
            const progress = Math.min((searchResult.fileCount || 0) / (options.maxResults || 100), 1.0);
            // Quadratic delay: a*x^2 + b*x + c where a=16, b=-16, c=5
            const delay = Math.max(0.5, Math.min(5.0, (16 * progress * progress) + (-16 * progress) + 5));
            pollInterval = delay * 1000;
          }
          
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          try {
            // Ensure auth method is detected
            await this.detectAuthMethod(basePath);
            const authHeaders = this.getAuthHeaders();
            
            // Get search status by ID - use includeResponses=true like Tubifarry does
            // This should return responses even if search is still in progress
            const statusConfig = {
              method: "GET",
              url: `${this.config.url}${basePath}/searches/${searchResult.id}?includeResponses=true`,
              headers: {
                ...authHeaders,
                "Content-Type": "application/json",
              },
              timeout: 30000,
            };
            const statusResponse = await axios(statusConfig);
            const statusData = statusResponse.data;
            
            // Update search result with latest status
            // Check for both lowercase and PascalCase (C# JSON serialization)
            const responses = statusData.responses || statusData.Responses || searchResult.responses;
            
            searchResult = {
              ...searchResult,
              ...statusData,
              // Preserve responses if they were returned (handle both cases)
              responses: responses,
            };
            
            // Also check if responses might be in a different property
            if (!responses || (Array.isArray(responses) && responses.length === 0)) {
              // Check all keys for potential response arrays
              for (const key of Object.keys(statusData || {})) {
                if (key.toLowerCase().includes('response') && Array.isArray(statusData[key]) && statusData[key].length > 0) {
                  const firstItem = statusData[key][0];
                  if (firstItem && typeof firstItem === 'object' && (firstItem.username || firstItem.user || firstItem.files)) {
                    searchResult.responses = statusData[key];
                    console.log(`✓ Found responses in property '${key}' (${statusData[key].length} items)`);
                    break;
                  }
                }
              }
            }

            console.log(
              `Poll ${attempt + 1}/${maxAttempts}: state=${searchResult.state}, responses=${searchResult.responseCount}, files=${searchResult.fileCount}, complete=${searchResult.isComplete}`,
            );
            
            // Check if we got responses even if search isn't complete
            // Tubifarry uses includeResponses=true which can return responses before completion
            if (searchResult.responses) {
              if (Array.isArray(searchResult.responses) && searchResult.responses.length > 0) {
                console.log(
                  `✓ Search ${searchResult.id} has ${searchResult.responses.length} responses (${searchResult.fileCount} files) - proceeding with available responses`,
                );
                break;
              } else if (Array.isArray(searchResult.responses) && searchResult.responses.length === 0 && searchResult.responseCount > 0) {
                // Responses array exists but is empty - log for debugging
                console.log(
                  `⚠ Search ${searchResult.id} has responseCount=${searchResult.responseCount} but responses array is empty (state: ${searchResult.state}, complete: ${searchResult.isComplete})`,
                );
              }
            }
            
            if (searchResult.isComplete) {
              console.log(
                `✓ Search ${searchResult.id} completed after ${attempt + 1} attempts with ${searchResult.responseCount} responses and ${searchResult.fileCount} files`,
              );
              break;
            }
            
            // If we have a good number of responses/files but search isn't complete, 
            // we can proceed after a reasonable wait (Tubifarry does this)
            // But only if we've waited long enough for responses to populate
            if (searchResult.responseCount >= 10 && searchResult.fileCount >= 50 && attempt >= 15) {
              console.log(
                `Search has ${searchResult.responseCount} responses with ${searchResult.fileCount} files after ${attempt + 1} attempts - proceeding to fetch responses (search may still be in progress)`,
              );
              break;
            }
          } catch (pollError) {
            console.warn(`Error polling search status (attempt ${attempt + 1}): ${pollError.message}`);
            // Continue polling unless it's a fatal error
            if (pollError.response?.status === 404) {
              console.error(`Search ${searchResult.id} not found, stopping poll`);
              break;
            }
            // For other errors, continue polling
          }
        }
        
        if (!searchResult.isComplete && searchResult.responseCount === 0) {
          console.warn(
            `Search ${searchResult.id} did not complete after ${maxAttempts} attempts. State: ${searchResult.state}`,
          );
        }
      }

      // slskd search returns results in different formats - handle both
      let files = [];
      
      // For API v0, Tubifarry makes a final GET request with includeResponses=true after polling
      // This is the key - we need to fetch the search result one more time with includeResponses=true
      if (basePath === "/api/v0" && searchResult.id && searchResult.responseCount > 0) {
        await this.detectAuthMethod(basePath);
        const authHeaders = this.getAuthHeaders();
        
        // Try multiple times with delays - responses might need time to populate
        let finalData = null;
        let attempts = 0;
        const maxFinalAttempts = 5;
        
        while (attempts < maxFinalAttempts) {
          try {
            // Final request with includeResponses=true - this is what Tubifarry does
            const finalRequest = {
              method: "GET",
              url: `${this.config.url}${basePath}/searches/${searchResult.id}?includeResponses=true`,
              headers: {
                ...authHeaders,
                "Content-Type": "application/json",
              },
              timeout: 30000,
            };
            
            if (attempts === 0) {
              console.log(`Making final request with includeResponses=true to get responses...`);
            } else {
              console.log(`Retrying final request (attempt ${attempts + 1}/${maxFinalAttempts})...`);
              // Wait a bit before retrying
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            const finalResponse = await axios(finalRequest);
            finalData = finalResponse.data;
            
            // Check if we got responses - handle both lowercase and PascalCase
            const responses = finalData.responses || finalData.Responses;
            if (responses && Array.isArray(responses) && responses.length > 0) {
              finalData.responses = responses; // Normalize to lowercase
              console.log(`✓ Got ${responses.length} responses on attempt ${attempts + 1}`);
              break;
            }
            
            // Also check all keys for response-like arrays
            if (!responses || (Array.isArray(responses) && responses.length === 0)) {
              for (const key of Object.keys(finalData || {})) {
                if (key.toLowerCase().includes('response') && Array.isArray(finalData[key]) && finalData[key].length > 0) {
                  const firstItem = finalData[key][0];
                  if (firstItem && typeof firstItem === 'object' && (firstItem.username || firstItem.user || firstItem.files)) {
                    finalData.responses = finalData[key];
                    console.log(`✓ Found ${finalData[key].length} responses in property '${key}'`);
                    break;
                  }
                }
              }
              
              if (finalData.responses && Array.isArray(finalData.responses) && finalData.responses.length > 0) {
                break;
              }
            }
            
            // If responses is empty but responseCount > 0, wait and retry
            if (finalData.responseCount > 0 && (!responses || (Array.isArray(responses) && responses.length === 0))) {
              attempts++;
              if (attempts < maxFinalAttempts) {
                console.log(`Responses array is empty but responseCount=${finalData.responseCount}, state=${finalData.state}, retrying...`);
                continue;
              }
            } else {
              // No responseCount or different structure, break
              break;
            }
          } catch (finalError) {
            console.warn(`Final request attempt ${attempts + 1} failed:`, finalError.message);
            attempts++;
            if (attempts >= maxFinalAttempts) {
              throw finalError;
            }
          }
        }
        
        if (finalData) {
          
          // Log the full response structure to understand what we're getting
          // This will help us see exactly what slskd is returning
          const responseStructure = {
            hasResponses: !!(finalData.responses),
            responsesType: typeof finalData.responses,
            responsesIsArray: Array.isArray(finalData.responses),
            responsesLength: Array.isArray(finalData.responses) ? finalData.responses.length : 'N/A',
            responseCount: finalData.responseCount,
            fileCount: finalData.fileCount,
            state: finalData.state,
            isComplete: finalData.isComplete,
            allKeys: Object.keys(finalData || {}),
          };
          
          // Only log the sample if responses exists and is not empty (to avoid huge logs)
          if (finalData.responses && (Array.isArray(finalData.responses) ? finalData.responses.length > 0 : true)) {
            responseStructure.responsesSample = JSON.stringify(finalData.responses).substring(0, 1000);
          }
          
          console.log(`Final response structure:`, responseStructure);
          
          // Also check if responses might be under a different case (case-insensitive check)
          // C# JSON serialization might use PascalCase
          const responsesKey = Object.keys(finalData || {}).find(k => 
            k.toLowerCase() === 'responses' && k !== 'responses'
          );
          if (responsesKey && !finalData.responses) {
            console.log(`Found responses under different case: '${responsesKey}'`);
            finalData.responses = finalData[responsesKey];
          }
          
          // Check for PascalCase (C# style) - Responses with capital R
          if (!finalData.responses && finalData.Responses) {
            console.log(`Found Responses (PascalCase) - converting to lowercase`);
            finalData.responses = finalData.Responses;
          }
          
          // Update searchResult with the final data that should include responses
          if (finalData.responses) {
            // Check if responses is actually populated
            if (Array.isArray(finalData.responses) && finalData.responses.length > 0) {
              searchResult.responses = finalData.responses;
              console.log(`✓ Final request returned ${finalData.responses.length} responses`);
            } else if (typeof finalData.responses === 'object' && !Array.isArray(finalData.responses)) {
              // Responses might be an object/dictionary
              const responseKeys = Object.keys(finalData.responses);
              console.log(`Responses is an object with ${responseKeys.length} keys: ${responseKeys.slice(0, 10).join(', ')}...`);
              
              // Try to extract arrays from the object
              const allResponses = [];
              for (const key of responseKeys) {
                const value = finalData.responses[key];
                if (Array.isArray(value)) {
                  allResponses.push(...value);
                } else if (value && typeof value === 'object' && (value.username || value.user || value.files)) {
                  allResponses.push(value);
                }
              }
              
              if (allResponses.length > 0) {
                searchResult.responses = allResponses;
                console.log(`✓ Extracted ${allResponses.length} responses from object structure`);
              }
            }
          }
          
          // Also update other fields
          searchResult = {
            ...searchResult,
            ...finalData,
            responses: finalData.responses || searchResult.responses,
          };
        } else {
          console.warn(`Final request with includeResponses failed after ${maxFinalAttempts} attempts`);
        }
      }
      
      // Check if we already have responses from the search result
      if (searchResult.responses && Array.isArray(searchResult.responses) && searchResult.responses.length > 0) {
        console.log(`Using ${searchResult.responses.length} responses from search result`);
      } else if (
        basePath === "/api/v0" &&
        searchResult.id &&
        searchResult.responseCount > 0 &&
        (!searchResult.responses || searchResult.responses.length === 0)
      ) {
        console.log(
          `Search has ${searchResult.responseCount} responses (${searchResult.fileCount} files) but responses array is empty. Fetching responses... (complete: ${searchResult.isComplete}, state: ${searchResult.state})`,
        );
        try {
          // Try to fetch responses with pagination - slskd might limit responses per request
          let allResponses = [];
          let page = 0;
          const pageSize = 100; // Try fetching in batches
          const maxPages = 10; // Limit to prevent infinite loops
          
          while (page < maxPages) {
            try {
              // Ensure auth method is detected
              await this.detectAuthMethod(basePath);
              const authHeaders = this.getAuthHeaders();
              
              const responsesConfig = {
                method: "GET",
                url: `${this.config.url}${basePath}/searches/${searchResult.id}/responses`,
                headers: {
                  ...authHeaders,
                  "Content-Type": "application/json",
                },
                params: page > 0 ? { skip: page * pageSize, take: pageSize } : { take: pageSize },
                timeout: 30000,
              };
              const responsesResponse = await axios(responsesConfig);
              
              const responseData = responsesResponse.data;
              let pageResponses = [];
              
              if (Array.isArray(responseData)) {
                pageResponses = responseData;
              } else if (responseData && Array.isArray(responseData.responses)) {
                pageResponses = responseData.responses;
              } else if (responseData && Array.isArray(responseData.items)) {
                pageResponses = responseData.items;
              }
              
              if (pageResponses.length === 0) {
                break; // No more responses
              }
              
              allResponses.push(...pageResponses);
              console.log(
                `Fetched page ${page + 1}: ${pageResponses.length} responses (total: ${allResponses.length})`,
              );
              
              // If we got fewer than pageSize, we've reached the end
              if (pageResponses.length < pageSize) {
                break;
              }
              
              page++;
            } catch (pageError) {
              if (page === 0) {
                // First page failed, try without pagination
                throw pageError;
              }
              // Subsequent pages failed, we're done
              break;
            }
          }
          
          if (allResponses.length > 0) {
            searchResult.responses = allResponses;
            console.log(
              `✓ Fetched ${allResponses.length} total responses from API`,
            );
          } else {
            // Try alternative: fetch files directly
            console.log("No responses from paginated endpoint, trying files endpoint...");
            throw new Error("No responses found, trying files endpoint");
          }
        } catch (fetchError) {
          console.warn(
            `Could not fetch responses from /searches/${searchResult.id}/responses: ${fetchError.message}`,
          );
          // Try alternative endpoint - get files directly
          try {
            // Ensure auth method is detected
            await this.detectAuthMethod(basePath);
            const authHeaders = this.getAuthHeaders();
            
            const filesConfig = {
              method: "GET",
              url: `${this.config.url}${basePath}/searches/${searchResult.id}/files`,
              headers: {
                ...authHeaders,
                "Content-Type": "application/json",
              },
              params: { take: 1000 }, // Try to get a large batch
              timeout: 30000,
            };
            const filesResponse = await axios(filesConfig);
            console.log(
              `Files endpoint response structure:`,
              JSON.stringify(
                {
                  isArray: Array.isArray(filesResponse.data),
                  type: typeof filesResponse.data,
                  keys: filesResponse.data
                    ? Object.keys(filesResponse.data)
                    : null,
                  length: Array.isArray(filesResponse.data)
                    ? filesResponse.data.length
                    : null,
                },
                null,
                2,
              ),
            );
            
            if (filesResponse.data && Array.isArray(filesResponse.data)) {
              files = filesResponse.data;
              console.log(`✓ Fetched ${files.length} files directly from API`);
            } else if (filesResponse.data && filesResponse.data.files) {
              files = filesResponse.data.files;
              console.log(`✓ Fetched ${files.length} files from nested property`);
            } else if (filesResponse.data && filesResponse.data.items) {
              files = filesResponse.data.items;
              console.log(`✓ Fetched ${files.length} files from items property`);
            }
          } catch (filesError) {
            console.warn(
              `Could not fetch files from /searches/${searchResult.id}/files: ${filesError.message}`,
            );
            // Last resort: try alternative endpoints or query parameters
            console.log("Trying alternative approaches to get files...");
            
            // Try with different query parameters - Tubifarry uses includeResponses=true on the search GET endpoint
            const alternativeEndpoints = [
              { url: `${this.config.url}${basePath}/searches/${searchResult.id}?includeResponses=true`, name: "search with includeResponses (Tubifarry method)" },
              { url: `${this.config.url}${basePath}/searches/${searchResult.id}?includeFiles=true`, name: "search with includeFiles" },
              { url: `${this.config.url}${basePath}/searches/${searchResult.id}?includeResponses=true&includeFiles=true`, name: "search with both includeResponses and includeFiles" },
              { url: `${this.config.url}${basePath}/searches/${searchResult.id}/results`, name: "/results endpoint" },
            ];
            
            for (const altEndpoint of alternativeEndpoints) {
              try {
                // Ensure auth method is detected
                await this.detectAuthMethod(basePath);
                const authHeaders = this.getAuthHeaders();
                
                const altConfig = {
                  method: "GET",
                  url: altEndpoint.url,
                  headers: {
                    ...authHeaders,
                    "Content-Type": "application/json",
                  },
                  timeout: 30000,
                };
                const altResponse = await axios(altConfig);
                console.log(`Tried ${altEndpoint.name}, got:`, {
                  isArray: Array.isArray(altResponse.data),
                  keys: altResponse.data ? Object.keys(altResponse.data) : null,
                  hasResponses: !!(altResponse.data?.responses),
                  hasFiles: !!(altResponse.data?.files),
                });
                
                // Check if responses exist and extract files from them
                // Tubifarry method: GET /api/v0/searches/{id}?includeResponses=true returns responses in the response object
                if (altResponse.data?.responses) {
                  if (Array.isArray(altResponse.data.responses) && altResponse.data.responses.length > 0) {
                    searchResult.responses = altResponse.data.responses;
                    console.log(`✓ Got ${searchResult.responses.length} responses from ${altEndpoint.name}`);
                    break;
                  } else if (typeof altResponse.data.responses === 'object' && !Array.isArray(altResponse.data.responses)) {
                    // Responses might be an object with nested arrays or a dictionary
                    const responseKeys = Object.keys(altResponse.data.responses);
                    console.log(`Responses is an object with keys: ${responseKeys.join(', ')}`);
                    // Try to find arrays within the responses object
                    for (const key of responseKeys) {
                      if (Array.isArray(altResponse.data.responses[key])) {
                        searchResult.responses = altResponse.data.responses[key];
                        console.log(`✓ Got ${searchResult.responses.length} responses from ${altEndpoint.name} (key: ${key})`);
                        break;
                      }
                    }
                    if (searchResult.responses && searchResult.responses.length > 0) {
                      break;
                    }
                  } else if (Array.isArray(altResponse.data.responses) && altResponse.data.responses.length === 0) {
                    // Empty array - log full response structure to understand what we're getting
                    console.log(`Response structure from ${altEndpoint.name}:`, {
                      responseCount: altResponse.data.responseCount,
                      fileCount: altResponse.data.fileCount,
                      responsesType: typeof altResponse.data.responses,
                      responsesIsArray: Array.isArray(altResponse.data.responses),
                      responsesLength: altResponse.data.responses.length,
                      allKeys: Object.keys(altResponse.data || {}),
                      state: altResponse.data?.state,
                      isComplete: altResponse.data?.isComplete,
                    });
                  }
                }
                
                if (altResponse.data?.files) {
                  if (Array.isArray(altResponse.data.files) && altResponse.data.files.length > 0) {
                    files = altResponse.data.files;
                    console.log(`✓ Got ${files.length} files from ${altEndpoint.name}`);
                    break;
                  }
                }
                
                // If we have responseCount but empty responses, the search might need more time
                // Or responses might be in a different structure - check all top-level keys
                if (altResponse.data && altResponse.data.responseCount > 0 && 
                    (!altResponse.data.responses || (Array.isArray(altResponse.data.responses) && altResponse.data.responses.length === 0))) {
                  console.log(`Search has ${altResponse.data.responseCount} responses but responses array is empty. Checking all response keys...`);
                  console.log(`Full response keys:`, Object.keys(altResponse.data));
                  
                  // Try to find responses in any array property
                  for (const key of Object.keys(altResponse.data)) {
                    const value = altResponse.data[key];
                    if (Array.isArray(value) && value.length > 0) {
                      // Check if this array contains response-like objects
                      const firstItem = value[0];
                      if (firstItem && typeof firstItem === 'object' && (firstItem.username || firstItem.user || firstItem.files)) {
                        searchResult.responses = value;
                        console.log(`✓ Found ${value.length} responses in property '${key}'`);
                        break;
                      }
                    }
                  }
                  
                  if (searchResult.responses && searchResult.responses.length > 0) {
                    break;
                  }
                }
              } catch (altError) {
                // Continue to next alternative
              }
            }
            
            // If still no files, log the search result structure for debugging
            if (files.length === 0 && (!searchResult.responses || searchResult.responses.length === 0)) {
              console.error(
                `Unable to fetch files/responses. Search has ${searchResult.responseCount} responses and ${searchResult.fileCount} files, but cannot access them via REST API.`,
              );
              console.error(
                `This appears to be a limitation of slskd API v0 - file details are only accessible via WebSocket connections, not REST API.`,
              );
              console.error(
                `The search ID is ${searchResult.id} - you can view it in the slskd web UI at ${this.config.url}.`,
              );
              
              // This is a known limitation of slskd API v0
              // The search status shows file counts, but the actual file details are not accessible via REST API
              // The files are only accessible through WebSocket connections or the slskd web UI
              throw new Error(
                `slskd API v0 limitation: Found ${searchResult.fileCount} files in ${searchResult.responseCount} responses, but file details are only accessible via WebSocket (not REST API). ` +
                `This is a known limitation of slskd API v0. ` +
                `Solutions: ` +
                `1) Upgrade slskd to a version that supports API v1/v2 (which has REST access to file details), ` +
                `2) Use the slskd web UI at ${this.config.url} to download files manually, or ` +
                `3) The search ID is ${searchResult.id} - you can view it in the slskd web UI.`,
              );
            }
          }
        }
      }
      
      if (files.length > 0) {
        // Files were fetched directly from /files endpoint
        console.log(`Using ${files.length} files fetched directly from API`);
      } else if (searchResult.responses) {
        // API v0: responses can be an array or object - handle both
        let responsesArray = [];
        
        if (Array.isArray(searchResult.responses)) {
          responsesArray = searchResult.responses;
        } else if (typeof searchResult.responses === 'object') {
          // Responses might be an object/dictionary - try to extract arrays
          const responseKeys = Object.keys(searchResult.responses);
          console.log(`Responses is an object with keys: ${responseKeys.join(', ')}`);
          
          // Try to find array values
          for (const key of responseKeys) {
            const value = searchResult.responses[key];
            if (Array.isArray(value) && value.length > 0) {
              // Check if this looks like response objects
              const firstItem = value[0];
              if (firstItem && typeof firstItem === 'object' && (firstItem.username || firstItem.user || firstItem.files)) {
                responsesArray = value;
                console.log(`✓ Found ${value.length} responses in property '${key}'`);
                break;
              }
            }
          }
          
          // If no array found, maybe responses is a dictionary keyed by username
          if (responsesArray.length === 0) {
            for (const key of responseKeys) {
              const value = searchResult.responses[key];
              if (value && typeof value === 'object') {
                // This might be a response object - add username if missing
                if (!value.username && !value.user) {
                  value.username = key; // Use the key as username
                }
                responsesArray.push(value);
              }
            }
          }
        }
        
        if (responsesArray.length > 0) {
          console.log(
            `Processing ${responsesArray.length} search responses...`,
          );
          for (const response of responsesArray) {
            // According to slskd API docs, SearchResponseItem has:
            // - username: string
            // - files: array of SearchFile objects
            // - fileCount: number
            // - lockedFiles: array (optional)
            const username = response.username || response.user || "";
            
            if (!username) {
              console.warn("Response missing username:", JSON.stringify(Object.keys(response || {}), null, 2));
            }
            
            // Extract files from the response
            // SearchFile objects have: filename, size, code, extension, bitRate, bitDepth, length, sampleRate, isLocked
            let responseFiles = [];
            if (response.files && Array.isArray(response.files)) {
              responseFiles = response.files;
            } else if (response.fileList && Array.isArray(response.fileList)) {
              responseFiles = response.fileList;
            } else if (response.filesList && Array.isArray(response.filesList)) {
              responseFiles = response.filesList;
            } else if (Array.isArray(response)) {
              // Response might be a direct array of files
              responseFiles = response;
            } else if (response.filename || response.fullname || response.name) {
              // Single file object (unlikely but handle it)
              responseFiles = [response];
            }
            
            // Add username to each file object so we can download it
            for (const file of responseFiles) {
              if (!file.username && username) {
                file.username = username;
              }
              files.push(file);
            }
          }
          console.log(
            `Extracted ${files.length} files from ${responsesArray.length} responses`,
          );
        } else {
          console.warn(`Responses exists but is empty or not parseable. Type: ${typeof searchResult.responses}, IsArray: ${Array.isArray(searchResult.responses)}`);
        }
      } else if (searchResult.files && Array.isArray(searchResult.files)) {
        files = searchResult.files;
      } else if (searchResult.results && Array.isArray(searchResult.results)) {
        files = searchResult.results;
      } else if (Array.isArray(searchResult)) {
        files = searchResult;
      }

      if (files.length === 0) {
        console.log(
          "Search result structure:",
          JSON.stringify(searchResult, null, 2),
        );
        throw new Error(
          `No files found for search query: "${query}". Search returned ${searchResult.responseCount || 0} responses but no files were extracted.`,
        );
      }

      // Get quality from options or default to 'standard'
      const quality = options.quality || "standard";

      // Filter by quality if specified
      files = await this.filterByQuality(files, quality);

      if (files.length === 0) {
        throw new Error(
          `No files matching quality "${quality}" found for query: "${query}"`,
        );
      }

      // Filter out full album files (very large files that are likely the entire album)
      // Prefer individual track files, especially if preferIndividualTracks option is set
      const preferIndividualTracks = options.preferIndividualTracks || false;
      const filteredFiles = files.filter((file) => {
        const filename = (file.filename || file.name || "").toLowerCase();
        const size = file.size || file.length || 0;
        
        // Filter out files that are likely full albums:
        // 1. Very large files (> 150MB are likely full albums for most albums)
        // 2. Files with album name but no track number or track name pattern
        const isLikelyFullAlbum = size > 150 * 1024 * 1024; // 150MB threshold
        
        // Check if filename suggests it's an individual track (has track indicators)
        const hasTrackNumber = /\d{1,2}[\s\-\.]/.test(filename) || 
                               /track\s*\d+/i.test(filename) ||
                               /^\d+[\s\-\.]/.test(filename) ||
                               /^\d{2}\s/.test(filename); // "01 Track Name"
        
        // Check if filename suggests it's a full album file
        // Full album files often have the album/artist name as the main filename without track numbers
        // Look for patterns like "Artist - Album.flac" or "Album.flac" (no track number)
        const pathParts = filename.split(/[\\/]/);
        const justFilename = pathParts[pathParts.length - 1] || filename;
        
        // Detect full album files:
        // 1. Large file (> 100MB)
        // 2. No track number in filename
        // 3. Filename matches common album file patterns (ends with .flac/.mp3, no numbers at start)
        // 4. Path structure suggests it's at album level (not in a numbered track file)
        const isFullAlbumFile = size > 100 * 1024 * 1024 && // > 100MB
                               !hasTrackNumber &&
                               (justFilename.endsWith('.flac') || justFilename.endsWith('.mp3')) &&
                               !filename.includes('disc') && // Multi-disc sets might be OK
                               !/^\d{1,2}[\s\-\.]/.test(justFilename) && // Doesn't start with track number
                               pathParts.length <= 3; // Likely "share/Artist/Album.flac" structure (not "share/Artist/Album/01 Track.flac")
        
        // If preferIndividualTracks is set, be more aggressive about filtering
        if (preferIndividualTracks) {
          // Filter out very large files without track indicators
          if (isLikelyFullAlbum && !hasTrackNumber) {
            return false;
          }
          // Also filter out files that look like full album files
          if (isFullAlbumFile) {
            return false;
          }
        } else {
          // Less aggressive filtering - only filter out very obvious full albums
          if (isLikelyFullAlbum && !hasTrackNumber && size > 300 * 1024 * 1024) {
            return false; // Only filter out very large files (> 300MB)
          }
        }
        
        return true;
      });
      
      // Filter out files from excluded usernames (for retries)
      if (excludeUsernames.length > 0) {
        const beforeExclude = filteredFiles.length > 0 ? filteredFiles : files;
        const afterExclude = beforeExclude.filter(
          file => !excludeUsernames.includes(file.username || file.user || ''),
        );
        if (afterExclude.length > 0) {
          console.log(
            `Excluded ${beforeExclude.length - afterExclude.length} files from previously tried users`,
          );
        }
        files = afterExclude.length > 0 ? afterExclude : beforeExclude;
      }
      
      // If we filtered out all files, use the original list
      const filesToUse = filteredFiles.length > 0 ? filteredFiles : files;
      
      if (filteredFiles.length < files.length) {
        console.log(
          `Filtered out ${files.length - filteredFiles.length} full album files, ${filteredFiles.length} individual tracks remaining`,
        );
      }

      // If we have a tracklist, match files against it and score them
      let scoredFiles = filesToUse;
      if (options.tracklist && options.tracklist.length > 0) {
        console.log(
          `Matching ${filesToUse.length} files against ${options.tracklist.length} official tracks from MusicBrainz...`,
        );
        
        scoredFiles = filesToUse.map((file) => {
          const filename = (file.filename || file.name || "").toLowerCase();
          const pathParts = filename.split(/[\\/]/);
          const justFilename = pathParts[pathParts.length - 1] || filename;
          
          // Extract track name from filename (remove track number, extension, etc.)
          let extractedTrackName = justFilename
            .replace(/\.(flac|mp3|m4a|ogg|wav)$/i, '') // Remove extension
            .replace(/^\d{1,2}[\s\-\.]+/, '') // Remove leading track number
            .replace(/^track\s*\d+[\s\-\.]+/i, '') // Remove "track 01 -"
            .trim();
          
          // Try to match against official tracklist
          let matchScore = 0;
          let matchedTrack = null;
          
          for (const track of options.tracklist) {
            const officialTitle = track.title.toLowerCase().trim();
            const normalizedOfficial = officialTitle.replace(/[^a-z0-9]/g, '');
            const normalizedExtracted = extractedTrackName.replace(/[^a-z0-9]/g, '');
            
            // Exact match
            if (normalizedExtracted === normalizedOfficial) {
              matchScore = 100;
              matchedTrack = track;
              break;
            }
            
            // Contains match (track name contains official title or vice versa)
            if (normalizedExtracted.includes(normalizedOfficial) || 
                normalizedOfficial.includes(normalizedExtracted)) {
              if (matchScore < 80) {
                matchScore = 80;
                matchedTrack = track;
              }
            }
            
            // Partial match (significant overlap)
            const minLength = Math.min(normalizedExtracted.length, normalizedOfficial.length);
            const maxLength = Math.max(normalizedExtracted.length, normalizedOfficial.length);
            if (minLength > 0 && maxLength > 0) {
              // Calculate similarity (simple character overlap)
              let commonChars = 0;
              const shorter = normalizedExtracted.length < normalizedOfficial.length 
                ? normalizedExtracted 
                : normalizedOfficial;
              const longer = normalizedExtracted.length >= normalizedOfficial.length 
                ? normalizedExtracted 
                : normalizedOfficial;
              
              for (let i = 0; i < shorter.length; i++) {
                if (longer.includes(shorter[i])) {
                  commonChars++;
                }
              }
              
              const similarity = (commonChars / maxLength) * 100;
              if (similarity > 60 && similarity > matchScore) {
                matchScore = similarity;
                matchedTrack = track;
              }
            }
          }
          
          // Store the matched track with MBID for later matching
          if (matchedTrack) {
            file._matchedTrack = {
              ...matchedTrack,
              mbid: matchedTrack.mbid, // Ensure MBID is preserved
            };
          }
          
          return {
            ...file,
            _matchScore: matchScore,
            _matchedTrack: matchedTrack ? {
              ...matchedTrack,
              mbid: matchedTrack.mbid, // Preserve MBID
            } : null,
            _extractedTrackName: extractedTrackName,
          };
        });
        
        // Sort by match score (highest first), then by quality
        scoredFiles.sort((a, b) => {
          if (a._matchScore !== b._matchScore) {
            return b._matchScore - a._matchScore; // Higher match score first
          }
          // If match scores are equal, use quality sorting
          return 0; // Will be sorted by quality next
        });
        
        const matchedCount = scoredFiles.filter(f => f._matchScore > 60).length;
        console.log(
          `Matched ${matchedCount} files to official tracks (score > 60). Best match: ${scoredFiles[0]?._matchedTrack?.title || 'none'} (score: ${scoredFiles[0]?._matchScore || 0})`,
        );
      } else {
        // No tracklist available, just use quality sorting
        scoredFiles = filesToUse;
      }
      
      // Sort by match score first (if available), then by quality
      // This ensures we prefer files that match the official tracklist
      const sortedFiles = scoredFiles.sort((a, b) => {
        // If match scores are available, prioritize them
        if (a._matchScore !== undefined && b._matchScore !== undefined) {
          if (a._matchScore !== b._matchScore) {
            return b._matchScore - a._matchScore; // Higher match score first
          }
        }
        
        // If match scores are equal or not available, sort by quality
        const aFilename = (a.filename || a.name || "").toLowerCase();
        const bFilename = (b.filename || b.name || "").toLowerCase();
        
        let aScore = 0;
        let bScore = 0;
        
        if (aFilename.includes('.flac') || aFilename.includes('lossless')) aScore += 10;
        else if (aFilename.includes('320')) aScore += 5;
        else if (aFilename.includes('256')) aScore += 3;
        else if (aFilename.includes('192')) aScore += 1;
        
        if (bFilename.includes('.flac') || bFilename.includes('lossless')) bScore += 10;
        else if (bFilename.includes('320')) bScore += 5;
        else if (bFilename.includes('256')) bScore += 3;
        else if (bFilename.includes('192')) bScore += 1;
        
        if (aScore !== bScore) return bScore - aScore;
        
        // If quality scores are equal, prefer larger files (generally better quality)
        return (b.size || 0) - (a.size || 0);
      });

      // For album downloads, download multiple tracks (one per track in tracklist)
      // For single track downloads, just download the best match
      if (options.tracklist && options.tracklist.length > 0 && options.preferIndividualTracks) {
        // Album download - download one file per track
        console.log(
          `Album download: Selecting files for ${options.tracklist.length} tracks...`,
        );
        
        const tracksToDownload = [];
        const downloadedTracks = new Set(); // Track which track positions we've selected
        
        // For each track in the official tracklist, find the best matching file
        for (const track of options.tracklist) {
          // Find files that match this track
          // Match by MBID if available, otherwise match by title
          let matchingFiles = sortedFiles.filter((file) => {
            if (!file._matchedTrack) return false;
            
            // If both have MBIDs, match by MBID
            if (track.mbid && file._matchedTrack.mbid) {
              return file._matchedTrack.mbid === track.mbid && file._matchScore > 60;
            }
            
            // Otherwise, match by title - check if the matched track title matches this track
            const matchedTitle = (file._matchedTrack.title || '').toLowerCase().trim();
            const trackTitle = (track.title || '').toLowerCase().trim();
            
            // Normalize for comparison
            const normalizedMatched = matchedTitle.replace(/[^a-z0-9]/g, '');
            const normalizedTrack = trackTitle.replace(/[^a-z0-9]/g, '');
            
            // Exact match or contains match
            const titleMatch = normalizedMatched === normalizedTrack ||
                              normalizedMatched.includes(normalizedTrack) ||
                              normalizedTrack.includes(normalizedMatched);
            
            return titleMatch && file._matchScore > 60;
          });
          
          if (matchingFiles.length > 0) {
            // Get the best match for this track (highest match score, then quality)
            const bestMatch = matchingFiles[0];
            if (!downloadedTracks.has(track.position)) {
              tracksToDownload.push({
                track: track,
                file: bestMatch,
              });
              downloadedTracks.add(track.position);
              console.log(
                `Selected track ${track.position}: "${track.title}" (match score: ${bestMatch._matchScore}, file: ${(bestMatch.filename || bestMatch.name || '').split(/[\\/]/).pop()})`,
              );
            }
          } else {
            console.warn(
              `No matching file found for track ${track.position}: "${track.title}"`,
            );
          }
        }
        
        if (tracksToDownload.length === 0) {
          // Fallback: if no tracks matched, download the best overall file
          console.log(
            `No tracks matched tracklist, downloading best overall match instead`,
          );
          const bestFile = sortedFiles[0];
          const username = bestFile.username || bestFile.user || "";
          const filename = bestFile.filename || bestFile.fullname || bestFile.name || "";
          const size = bestFile.size || bestFile.length || 0;
          
          if (!username || !filename) {
            throw new Error(
              `Invalid file data from search result - missing username or filename`,
            );
          }
          
          const downloadResult = await this.downloadFile(username, filename, size);
          if (downloadResult && typeof downloadResult === 'object') {
            downloadResult.username = username;
            downloadResult.filename = filename;
          }
          return downloadResult;
        }
        
        // Download all selected tracks
        console.log(
          `Downloading ${tracksToDownload.length} tracks for album...`,
        );
        const downloadResults = [];
        
        for (const { track, file } of tracksToDownload) {
          const username = file.username || file.user || "";
          const filename = file.filename || file.fullname || file.name || "";
          const size = file.size || file.length || 0;
          
          if (!username || !filename) {
            console.warn(
              `Skipping track "${track.title}" - invalid file data`,
            );
            continue;
          }
          
          try {
            console.log(
              `Downloading track ${track.position}: "${track.title}" from ${username}`,
            );
            const downloadResult = await this.downloadFile(username, filename, size);
            
            if (downloadResult && typeof downloadResult === 'object') {
              downloadResult.username = username;
              downloadResult.filename = filename;
              downloadResult.track = track;
            }
            
            downloadResults.push(downloadResult);
            
            // Small delay between downloads to avoid overwhelming the system
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            console.error(
              `Failed to download track "${track.title}":`,
              error.message,
            );
            // Continue with other tracks even if one fails
          }
        }
        
        if (downloadResults.length === 0) {
          throw new Error(
            `Failed to download any tracks for album. ${tracksToDownload.length} tracks were selected but all downloads failed.`,
          );
        }
        
        console.log(
          `Successfully initiated downloads for ${downloadResults.length}/${tracksToDownload.length} tracks`,
        );
        
        // Return array of all download results so downloadManager can track them all
        return downloadResults;
      } else {
        // Single track download - just download the best match
        const bestFile = sortedFiles[0];
        
        if (bestFile._matchedTrack) {
          console.log(
            `Selected file matches official track: "${bestFile._matchedTrack.title}" (match score: ${bestFile._matchScore})`,
          );
        }
        
        const username = bestFile.username || bestFile.user || "";
        const filename = bestFile.filename || bestFile.fullname || bestFile.name || "";
        const size = bestFile.size || bestFile.length || 0;

        if (!username || !filename) {
          console.error("Invalid file data from search result:", JSON.stringify(bestFile, null, 2));
          throw new Error(
            `Invalid file data from search result - missing username or filename. Username: ${username}, Filename: ${filename}`,
          );
        }
        
        console.log(`Downloading file: ${filename} from user: ${username} (size: ${size} bytes)`);

        const downloadResult = await this.downloadFile(username, filename, size);
        
        // Store the username in the result for tracking retries
        if (downloadResult && typeof downloadResult === 'object') {
          downloadResult.username = username;
          downloadResult.filename = filename;
        }
        
        return downloadResult;
      }
    } catch (error) {
      console.error(
        `Error in searchAndDownload for query "${query}":`,
        error.message,
      );
      if (error.response) {
        console.error(
          "slskd API response:",
          error.response.status,
          error.response.data,
        );
      }
      throw error;
    }
  }

  async filterByQuality(files, quality = "standard") {
    const { qualityManager } = await import("./qualityManager.js");
    // For Soulseek, we filter by format/bitrate but ignore torrent-specific "preferred groups"
    // since Soulseek doesn't use release groups like torrents
    return files.filter((file) => {
      const filename = file.filename || file.name || "";
      // Check format only - ignore preferredGroups for Soulseek
      const preset = qualityManager.getQualityPreset(quality);
      const lowerFilename = filename.toLowerCase();
      
      // Check format
      const hasAllowedFormat = preset.allowedFormats.some(format => {
        if (format === 'flac') return lowerFilename.includes('.flac');
        if (format === 'mp3-320') return lowerFilename.includes('320') || (lowerFilename.includes('.mp3') && !lowerFilename.includes('192') && !lowerFilename.includes('256'));
        if (format === 'mp3-256') return lowerFilename.includes('256');
        if (format === 'mp3-192') return lowerFilename.includes('192');
        return false;
      });
      
      return hasAllowedFormat;
    });
  }

  async sortByQuality(files, quality = "standard") {
    // For Soulseek, sort by format preference and file size
    // Don't use torrent-specific "preferred groups" scoring
    return files.sort((a, b) => {
      const aFilename = (a.filename || a.name || "").toLowerCase();
      const bFilename = (b.filename || b.name || "").toLowerCase();
      
      // Format scoring (simplified for Soulseek)
      let aScore = 0;
      let bScore = 0;
      
      if (aFilename.includes('.flac') || aFilename.includes('lossless')) aScore += 10;
      else if (aFilename.includes('320')) aScore += 5;
      else if (aFilename.includes('256')) aScore += 3;
      else if (aFilename.includes('192')) aScore += 1;
      
      if (bFilename.includes('.flac') || bFilename.includes('lossless')) bScore += 10;
      else if (bFilename.includes('320')) bScore += 5;
      else if (bFilename.includes('256')) bScore += 3;
      else if (bFilename.includes('192')) bScore += 1;

      if (aScore !== bScore) return bScore - aScore;

      // If scores are equal, prefer larger files (generally better quality)
      return (b.size || 0) - (a.size || 0);
    });
  }

  async downloadAlbum(artistName, albumName, options = {}) {
    // Check blocklist before downloading
    const { queueCleaner } = await import('./queueCleaner.js');
    if (queueCleaner.isBlocklisted(artistName, albumName)) {
      throw new Error(`Album "${albumName}" by "${artistName}" is blocklisted. It previously failed to import.`);
    }
    
    // For Soulseek, simpler queries work better
    // Remove special characters and use basic format: "Artist Album"
    const cleanArtist = artistName.replace(/[^\w\s]/g, ' ').trim();
    const cleanAlbum = albumName.replace(/[^\w\s]/g, ' ').trim();
    const query = `${cleanArtist} ${cleanAlbum}`.trim();
    console.log(`Searching Soulseek for album: "${query}"`);
    
    // For album downloads, prefer individual tracks over full album files
    // Pass tracklist if available for matching against MusicBrainz official tracklist
    return this.searchAndDownload(query, {
      ...options,
      fileType: "Audio",
      preferIndividualTracks: true, // Flag to prefer individual tracks
      tracklist: options.tracklist || [], // MusicBrainz tracklist for matching
      albumName: albumName, // Pass album name for better filtering
    });
  }

  async downloadTrack(artistName, trackName, options = {}) {
    const query = `${artistName} ${trackName}`;
    return this.searchAndDownload(query, {
      ...options,
      fileType: "Audio",
    });
  }
}

export const slskdClient = new SlskdClient();
